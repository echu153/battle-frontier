import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { wagerJoin, wagerReport, wagerForfeit, wagerPing, wagerSettleRanked, MAX_BET } from '../lib/wager'
import { StampBar } from '../components/StampBar'
import { RoomChat } from '../components/RoomChat'
import { InvitePanel } from '../components/InvitePanel'
import { FinalResult } from '../components/FinalResult'
import { containsNgWord } from '../lib/nameFilter'
import {
  BLACK, WHITE, EMPTY, SIZE,
  validMoves, countStones, cpuChooseMove,
  createGame, applyGameMove, forfeitGame, colorOf, isNpcId,
  MAX_MULTI_PLAYERS, multiBoardSize, createMultiGame, applyMultiMove, multiPlayerLeft,
  legalMovesMulti, countsByColor, cpuChooseMoveMulti,
} from '../lib/othello'

// ============================================================
// 盤上遊戯「双極盤」(オセロ) — 開発限定のミニゲーム(娯楽・ステ影響なし)
// 部屋: Supabase Realtime presence(ロビー一覧) + broadcast(ゲーム同期)
// ホスト権威型: 部屋主のクライアントだけがエンジンを実行しstateを配信
// SQLテーブル不要(RealtimeチャンネルのみでDBに一切書き込まない)
// 2人=クラシック8x8 / 3〜5人=多人数モード(人数+1ごとに盤が縦横+1マス)
// ============================================================

// 切断とみなすまでの猶予。スマホで画面を離れても1分程度は部屋が保たれるようにする
const DISCONNECT_GRACE = 75000
const LOBBY_CHANNEL = 'othello-lobby'
const roomChannelName = (roomId) => `othello-room-${roomId}`

const NPC_NAMES = ['オセロ丸', 'リバー子', 'カドトリ翁', 'スミゾメ', 'シロタエ']
// スタンプは共通コンポーネント(StampBar)を使用。対局者/観戦者でカテゴリが異なる
const CPU_DELAY_MS = 800
// NPCの強さはidに埋め込む(npc-lv{n}-...)。stateの再配信/観戦でも失われない
const npcLevelOf = (id) => {
  const m = /^npc-lv(\d)-/.exec(id || '')
  return m ? Number(m[1]) : 3
}

// 石の色(1..5): 黒/白/赤/青/緑
const STONE_CSS = {
  1: 'radial-gradient(circle at 35% 30%, #555, #000)',
  2: 'radial-gradient(circle at 35% 30%, #fff, #bbb)',
  3: 'radial-gradient(circle at 35% 30%, #ff8877, #aa1111)',
  4: 'radial-gradient(circle at 35% 30%, #88aaff, #1133aa)',
  5: 'radial-gradient(circle at 35% 30%, #88ee99, #117733)',
}
const STONE_LABEL = { 1: '黒', 2: '白', 3: '赤', 4: '青', 5: '緑' }

const btnStyle = (color, extra = {}) => ({
  background: 'none', border: `1px solid ${color}`, color, padding: '6px 10px',
  cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', ...extra,
})

const stoneStyle = (color) => ({
  display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', verticalAlign: 'middle',
  background: STONE_CSS[color] || '#666',
  border: '1px solid #333',
})

export default function Othello() {
  const nav = useNavigate()
  const [me, setMe] = useState(null) // { id, name }
  const [loading, setLoading] = useState(true)

  // view: lobby | room
  const [view, setView] = useState('lobby')
  const [rooms, setRooms] = useState([])
  const [lobbyNonce, setLobbyNonce] = useState(0) // 🔄でロビーを購読し直して一覧を引き直す
  const [showFinal, setShowFinal] = useState(false) // 最終結果の表示(自動では消さない)
  const showFinalRef = useRef(false)
  const finalShownRef = useRef(null) // 表示済みの終局キー(再配信で開き直さないため)
  const [roomTitle, setRoomTitle] = useState('')
  const [bet, setBet] = useState(0) // 💰賭けGold(0=なし)
  const [betBusy, setBetBusy] = useState(false)

  // 部屋の状態
  const [room, setRoom] = useState(null) // { id, title, hostId, hostName }
  const [members, setMembers] = useState([]) // presenceから [{ id, name }]
  const [npcs, setNpcs] = useState([]) // ホストが追加したNPC [{ id, name, level }]
  const [game, setGame] = useState(null)
  const [toast, setToast] = useState(null)
  const [passNote, setPassNote] = useState(null)
  const [lastResult, setLastResult] = useState(null) // 直前の対局結果(待機画面に表示)
  const [stamps, setStamps] = useState([]) // 表示中スタンプ [{ id, name, text }]
  const stampSeqRef = useRef(0)
  const stampCdRef = useRef(0) // 連打防止クールダウン
  const [chatOn, setChatOn] = useState(false) // 運営(is_admin)が建てた部屋のみフリーチャット解放
  const [chatMsgs, setChatMsgs] = useState([])
  const chatSeqRef = useRef(0)
  const chatCdRef = useRef(0)
  const [ready, setReady] = useState(false) // 自分の準備OK
  const readyRef = useRef(false)
  const myJoinedAtRef = useRef(0) // 入室時刻(観戦切替時も席順を維持するため保持)
  const hostGraceRef = useRef(null) // ホスト不在の猶予タイマー(リロード復帰待ち)
  const pendingLeaveRef = useRef(new Map()) // ホスト: 切断者の不戦勝猶予タイマー playerId→timeout
  const wagerKeyRef = useRef(null) // 進行中の賭けキー
  const betPendingRef = useRef(null) // ホスト: 供託待ち { key, need:Set, ok:Set, start:fn }
  const reportedRef = useRef(new Set()) // 精算報告済みの賭けキー
  const settleWagerRef = useRef(null)

  const lobbyChRef = useRef(null)
  const roomChRef = useRef(null)
  const gameRef = useRef(null)   // ホスト用: 最新state
  const stateSeqRef = useRef(0)
  const meRef = useRef(null)
  const roomRef = useRef(null)
  const membersRef = useRef([])
  const npcsRef = useRef([])
  const cpuTimerRef = useRef(null)

  useEffect(() => { gameRef.current = game }, [game])
  useEffect(() => { meRef.current = me }, [me])
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { readyRef.current = ready }, [ready])
  useEffect(() => { showFinalRef.current = showFinal }, [showFinal])
  useEffect(() => { npcsRef.current = npcs }, [npcs])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // ---- 認証(一般公開・2026-07-18) ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
      if (cancelled) return
      setMe({ id: user.id, name: prof?.username || '名無し' })
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [nav])

  // ---- ホスト: ロビーへ部屋情報を掲示 ----
  //   ロビーのuseEffectより前に定義する(後ろに置くと参照が巻き上げになりReact Compilerの最適化が外れる)
  const publishRoom = useCallback(async (status) => {
    const r = roomRef.current
    if (!r || r.hostId !== meRef.current?.id || !lobbyChRef.current) return
    await lobbyChRef.current.track({
      roomId: r.id, title: r.title, hostId: r.hostId, hostName: r.hostName, bet: r.bet || 0,
      count: membersRef.current.length + npcsRef.current.length, status, // waiting | playing
    })
  }, [])
  const publishStatus = () => (gameRef.current && gameRef.current.phase === 'playing' ? 'playing' : 'waiting')

  // ---- ロビー: 部屋一覧(presence) ----
  useEffect(() => {
    if (!me) return
    const ch = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key: me.id } } })
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      const list = []
      for (const key of Object.keys(st)) {
        // 同一ユーザー(key)に古いソケットのmetaが残ることがあるため最新の1件のみ採用
        // (1ユーザーが立てられる部屋は1つ)
        const metas = st[key].filter((m) => m.roomId)
        if (metas.length > 0) list.push(metas[metas.length - 1])
      }
      setRooms(list)
    })
    // 再接続(SUBSCRIBEDは再購読でも発火)でロビーのtrackは消えるため、掲示中の部屋を再掲示する
    // (これが消えたままだと他の人から「部屋が見つからない」状態になる)
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') publishRoom(publishStatus())
    })
    lobbyChRef.current = ch
    return () => { supabase.removeChannel(ch); lobbyChRef.current = null }
  }, [me, lobbyNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // 掲示のキープアライブ: 電波の瞬断などでtrackが落ちて一覧から消えたままになるのを防ぐ
  useEffect(() => {
    if (!room || room.hostId !== me?.id) return
    const iv = setInterval(() => publishRoom(publishStatus()), 25000)
    return () => clearInterval(iv)
  }, [room, me, publishRoom])

  // ---- ゲーム進行(ホストのみ): エンジン適用→配信 ----
  const hostBroadcast = useCallback((newState, events = []) => {
    gameRef.current = newState
    stateSeqRef.current += 1
    roomChRef.current?.send({
      type: 'broadcast', event: 'state',
      payload: { seq: stateSeqRef.current, game: newState, events, wagerKey: wagerKeyRef.current },
    })
  }, [])

  const hostApply = useCallback((action) => {
    const cur = gameRef.current
    if (!cur) return false
    const r = cur.mode === 'multi'
      ? applyMultiMove(cur, action.playerId, action.idx)
      : applyGameMove(cur, action.playerId, action.idx)
    if (r.error) {
      roomChRef.current?.send({ type: 'broadcast', event: 'reject', payload: { playerId: action.playerId, msg: r.error } })
      return false
    }
    hostBroadcast(r.state, r.events)
    if (r.state.phase === 'ended') publishRoom('waiting')
    return true
  }, [hostBroadcast, publishRoom])

  // ---- 賭け精算(切断=無効試合なら落ちた人を負けにして残りへ払い出す) ----
  const settleWager = useCallback(async (key, lostIds, rankedIds, nameOf) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    if (lostIds && lostIds.length > 0) {
      showToast('💰 相手の切断を確認中…精算まで少しお待ちください')
      // 切断者を負け扱いにする。プレゼンス確定(~40秒)まで数回リトライ
      const pending = new Set(lostIds)
      for (let attempt = 0; attempt < 6 && pending.size > 0; attempt++) {
        for (const lid of [...pending]) {
          const r = await wagerForfeit(key, lid)
          if (r?.status === 'settled') {
            showToast(`💰 相手の切断により ${nameOf(r.winner) || '?'} が ${r.pot}G 獲得！`)
            return
          }
          if (r?.forfeited || r?.status === 'refunded') pending.delete(lid)
        }
        if (pending.size > 0) await sleep(15000)
      }
    }
    // 多人数戦は順位分配(2人=70%…ではなく勝者総取り相当のn=2表を含めSQL側の分配率で処理)
    const ranked = (rankedIds || []).filter((id) => !(lostIds || []).includes(id) && !isNpcId(id))
    if (ranked.length >= 2) {
      const res = await wagerSettleRanked(key, ranked)
      if (res?.status === 'settled') { showToast(`💰 分配精算完了！ 1位 ${nameOf(ranked[0])} が ${res.top_gain ?? res.pot}G 獲得`); return }
      if (res?.status === 'refunded') { showToast('💰 全員に返金されました'); return }
      if (res?.error && res.error.includes('SQL更新')) {
        // SQL未更新環境では従来の勝者総取りにフォールバック
        const res2 = await wagerReport(key, ranked[0])
        if (res2?.status === 'settled') showToast(`💰 精算完了: ${nameOf(ranked[0])} が ${res2.pot}G 獲得！`)
        else if (res2?.error) showToast(`💰 ${res2.error}`)
        return
      }
      if (res?.error) showToast(`💰 ${res.error}`)
      return // pending含む
    }
    // 分配できない(引き分け/NPC勝ち等) → 返金
    const res = await wagerReport(key, null)
    if (res?.status === 'refunded') showToast('💰 引き分け/NPC勝ちのため全員に返金されました')
    else if (res?.error) showToast(`💰 ${res.error}`)
  }, [])
  useEffect(() => { settleWagerRef.current = settleWager }, [settleWager])

  // ---- 賭け中は在室ハートビート(切断者だけを離脱指定できるように) ----
  const inWagerMatch = !!(room && game?.phase === 'playing' && wagerKeyRef.current && me
    && (game.mode === 'multi'
      ? game.players?.some((p) => p.id === me.id)
      : (game.players?.[BLACK]?.id === me.id || game.players?.[WHITE]?.id === me.id)))
  useEffect(() => {
    if (!inWagerMatch) return
    const key = wagerKeyRef.current
    wagerPing(key)
    const iv = setInterval(() => wagerPing(key), 15000)
    return () => clearInterval(iv)
  }, [inWagerMatch])

  // ---- 部屋チャンネル(入室) ----
  // asSpectator: trueなら観戦専用(席決めから除外)
  const joinRoom = useCallback((roomInfo, asSpectator = false) => {
    const myself = meRef.current
    const ch = supabase.channel(roomChannelName(roomInfo.id), {
      config: { presence: { key: myself.id }, broadcast: { self: true } },
    })
    let hostSeen = false // 初回syncは自分のtrack反映前に来るため、ホスト在室を一度確認してから不在判定する
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      // 再track(観戦切替など)で同一キーに古いmetaが残ることがあるため常に最新のmetaを読む
      const list = Object.keys(st).map((key) => {
        const meta = st[key][st[key].length - 1]
        return { id: key, name: meta?.name || '?', spectator: !!meta?.spectator, ready: !!meta?.ready, joinedAt: meta?.joinedAt || 0 }
      })
      list.sort((a, b) => a.joinedAt - b.joinedAt)
      // 部屋の上限 = 席5 + 観戦100。入室順であふれた人は自動退室(UIには明記しない)
      const cap = MAX_MULTI_PLAYERS + 100
      if (list.length > cap && list.findIndex((m) => m.id === myself.id) >= cap) {
        showToast('満員のため入室できません')
        leaveRoomRef.current?.()
        return
      }
      setMembers(list)
      membersRef.current = list
      // ホスト: 掲示更新 + 途中参加者に現在のstateを再配信
      if (roomInfo.hostId === myself.id) {
        publishRoom(gameRef.current && gameRef.current.phase === 'playing' ? 'playing' : 'waiting')
        if (gameRef.current) {
          ch.send({ type: 'broadcast', event: 'state', payload: { seq: stateSeqRef.current, game: gameRef.current, events: [] } })
        }
        return
      }
      // 復帰した人の不戦勝猶予タイマーを解除
      for (const m of list) {
        const t = pendingLeaveRef.current.get(m.id)
        if (t) { clearTimeout(t); pendingLeaveRef.current.delete(m.id) }
      }
      // ホストが消えたら15秒待って解散(リロード復帰の猶予)
      if (list.some((m) => m.id === roomInfo.hostId)) {
        hostSeen = true
        if (hostGraceRef.current) { clearTimeout(hostGraceRef.current); hostGraceRef.current = null }
      } else if (hostSeen && !hostGraceRef.current) {
        hostGraceRef.current = setTimeout(() => {
          hostGraceRef.current = null
          if (membersRef.current.some((m) => m.id === roomInfo.hostId)) return // ホスト復帰済み
          // 進行中の賭けがあれば、居なくなった対局者(ホスト含む)を負け扱いにして精算してから退室
          const g = gameRef.current
          const wk = wagerKeyRef.current
          if (g && wk && !reportedRef.current.has(wk)) {
            const seated2 = g.mode === 'multi' ? g.players.map((p) => p.id) : [g.players[BLACK]?.id, g.players[WHITE]?.id]
            if (seated2.includes(myself.id)) {
              const present = new Set(membersRef.current.map((m) => m.id))
              const lostIds = seated2.filter((id) => id && id !== myself.id && !isNpcId(id) && !present.has(id))
              if (lostIds.length > 0) {
                reportedRef.current.add(wk)
                const nameOf = (id) => g.mode === 'multi'
                  ? g.players.find((p) => p.id === id)?.name
                  : Object.values(g.players).find((p) => p?.id === id)?.name
                settleWagerRef.current?.(wk, lostIds, null, nameOf)
              }
            }
          }
          showToast('ホストが退室したため部屋は解散しました')
          leaveRoomRef.current?.()
        }, DISCONNECT_GRACE)
      }
    })
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      // ホスト: 対局中の切断は15秒待ってから不戦勝(2人)/手番スキップ(多人数)。
      // リロード等で戻ってきたらsyncでタイマー解除される
      if (roomInfo.hostId !== myself.id || gameRef.current?.phase !== 'playing') return
      if (pendingLeaveRef.current.has(key)) return
      const t = setTimeout(() => {
        pendingLeaveRef.current.delete(key)
        if (membersRef.current.some((m) => m.id === key)) return // 復帰済み
        const cur = gameRef.current
        if (cur?.phase !== 'playing') return
        if (cur.mode === 'multi') {
          const leftName = cur.players.find((p) => p.id === key)?.name
          const ended = multiPlayerLeft(cur, key)
          if (ended) {
            hostBroadcast(ended, leftName ? [{ t: 'left', name: leftName }] : [])
            if (ended.phase === 'ended') publishRoom('waiting')
          }
        } else {
          const color = colorOf(cur, key)
          const ended = forfeitGame(cur, key)
          if (ended) {
            hostBroadcast(ended, [{ t: 'forfeit', name: cur.players[color]?.name || '?' }])
            publishRoom('waiting')
          }
        }
      }, DISCONNECT_GRACE)
      pendingLeaveRef.current.set(key, t)
    })
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (gameRef.current && payload.seq < stateSeqRef.current) return // 途中参加向け再配信は初回のみ受理
      stateSeqRef.current = payload.seq
      gameRef.current = payload.game
      wagerKeyRef.current = payload.wagerKey || null
      setGame(payload.game)
      setBetBusy(false)
      for (const ev of payload.events || []) {
        if (ev.t === 'pass') setPassNote(`${ev.name} はパス！`)
        if (ev.t === 'forfeit') showToast(`${ev.name} が切断したため不戦勝`)
        if (ev.t === 'left') showToast(`${ev.name} が切断しました(手番スキップ)`)
      }
      if (!(payload.events || []).some((ev) => ev.t === 'pass')) setPassNote(null)
      // 賭け精算: 終局時に各対局者(人間)が勝者を報告(過半数一致で払い出し)
      const g = payload.game
      if (g?.phase === 'ended' && payload.wagerKey && !reportedRef.current.has(payload.wagerKey)) {
        const seatedIds = g.mode === 'multi' ? g.players.map((p) => p.id) : [g.players[BLACK]?.id, g.players[WHITE]?.id]
        if (seatedIds.includes(myself.id)) {
          reportedRef.current.add(payload.wagerKey)
          // 名前解決(勝者トースト用)
          const nameOf = (id) => g.mode === 'multi'
            ? g.players.find((p) => p.id === id)?.name
            : Object.values(g.players).find((p) => p?.id === id)?.name
          // 切断した席 = 無効試合の原因 → 負け扱いにする
          let lostIds = []
          if (g.mode === 'multi') {
            lostIds = g.players.filter((p) => p.left && !isNpcId(p.id)).map((p) => p.id)
          } else if (g.result?.forfeit && g.result?.winner) {
            const loserColor = g.result.winner === BLACK ? WHITE : BLACK
            const lid = g.players[loserColor]?.id
            if (lid && !isNpcId(lid)) lostIds = [lid]
          }
          // 順位リスト(多人数=石数順位で分配 / 2人=勝者総取り)。1位タイやNPC勝ちは返金へ
          let rankedIds = null
          if (g.mode === 'multi') {
            if (g.result?.winners?.length === 1) {
              rankedIds = g.result.standings.map((s) => g.players.find((p) => p.color === s.color)?.id).filter(Boolean)
            }
          } else if (g.result?.winner) {
            const wId = g.players[g.result.winner]?.id
            const lId = g.players[g.result.winner === BLACK ? WHITE : BLACK]?.id
            if (wId && !isNpcId(wId)) rankedIds = [wId, lId].filter(Boolean)
          }
          settleWagerRef.current(payload.wagerKey, lostIds, rankedIds, nameOf)
        }
      }
    })
    // ---- 賭けの供託フロー ----
    ch.on('broadcast', { event: 'betcall' }, async ({ payload }) => {
      if (!payload.humanIds.includes(myself.id)) return
      setBetBusy(true)
      const res = await wagerJoin(payload.key, 'othello', roomInfo.bet || 0)
      if (res?.ok) ch.send({ type: 'broadcast', event: 'betok', payload: { playerId: myself.id, key: payload.key } })
      else ch.send({ type: 'broadcast', event: 'betfail', payload: { playerId: myself.id, key: payload.key, msg: res?.error || '供託に失敗しました' } })
    })
    ch.on('broadcast', { event: 'betok' }, ({ payload }) => {
      const bp = betPendingRef.current
      if (roomInfo.hostId !== myself.id || !bp || bp.key !== payload.key) return
      bp.ok.add(payload.playerId)
      if ([...bp.need].every((id) => bp.ok.has(id))) {
        betPendingRef.current = null
        setBetBusy(false)
        bp.start(bp.key)
      }
    })
    ch.on('broadcast', { event: 'betfail' }, ({ payload }) => {
      if (roomInfo.hostId === myself.id && betPendingRef.current?.key === payload.key) {
        betPendingRef.current = null
        ch.send({ type: 'broadcast', event: 'betabort', payload: { key: payload.key, msg: `${payload.msg}(対局中止)` } })
      }
    })
    ch.on('broadcast', { event: 'betabort' }, async ({ payload }) => {
      setBetBusy(false)
      showToast(`💰 ${payload.msg}`)
      await wagerReport(payload.key, null) // 供託済みなら返金希望を報告
    })
    ch.on('broadcast', { event: 'action' }, ({ payload }) => {
      if (roomInfo.hostId !== myself.id) return // エンジンはホストのみ実行
      hostApply(payload.action)
    })
    ch.on('broadcast', { event: 'reject' }, ({ payload }) => {
      if (payload.playerId === myself.id) showToast(payload.msg)
    })
    ch.on('broadcast', { event: 'closed' }, () => {
      showToast('部屋が解散されました')
      leaveRoomRef.current?.()
    })
    // リロード復帰者からの状態要求: 誰でも持っていれば現在のstateを返す(ホストのリロードにも対応)
    ch.on('broadcast', { event: 'statereq' }, () => {
      if (gameRef.current) {
        ch.send({ type: 'broadcast', event: 'state', payload: { seq: stateSeqRef.current, game: gameRef.current, events: [], wagerKey: wagerKeyRef.current } })
      }
    })
    ch.on('broadcast', { event: 'stamp' }, ({ payload }) => {
      const id = ++stampSeqRef.current
      setStamps((prev) => [...prev.slice(-5), { id, name: payload.name, text: payload.text, senderId: payload.senderId }])
      setTimeout(() => setStamps((prev) => prev.filter((s) => s.id !== id)), 2600)
    })
    // チャット受信(運営部屋のみUI表示。受信側でもNGワードは破棄)
    ch.on('broadcast', { event: 'chat' }, ({ payload }) => {
      if (typeof payload?.text !== 'string' || containsNgWord(payload.text)) return
      const id = ++chatSeqRef.current
      setChatMsgs((prev) => [...prev.slice(-99), { id, name: String(payload.name ?? '?').slice(0, 16), senderId: payload.senderId, text: payload.text.slice(0, 100) }])
    })
    myJoinedAtRef.current = 0 // 新しい入室なので入室時刻をリセット(再接続時のみ保持される)
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // 再接続(SUBSCRIBEDは再購読でも発火)で席順が入れ替わらないよう初回の時刻を保持
        if (!myJoinedAtRef.current) myJoinedAtRef.current = Date.now()
        await ch.track({ name: myself.name, joinedAt: myJoinedAtRef.current, spectator: asSpectator, ready: readyRef.current })
        ch.send({ type: 'broadcast', event: 'statereq', payload: {} }) // リロード復帰時の状態再取得
      }
    })
    // リロードしても部屋に戻れるよう保存(明示退室/解散でクリア)
    try { sessionStorage.setItem('bf-othello-room', JSON.stringify({ roomInfo, spectator: asSpectator })) } catch { /* 無視 */ }
    roomChRef.current = ch
    setRoom(roomInfo)
    roomRef.current = roomInfo
    setView('room')
    setGame(null)
    gameRef.current = null
    stateSeqRef.current = 0
    setPassNote(null)
    setLastResult(null)
    wagerKeyRef.current = null
    betPendingRef.current = null
    setBetBusy(false)
  }, [hostApply, hostBroadcast, publishRoom])

  // ---- 退室 ----
  const leaveRoom = useCallback(() => {
    const r = roomRef.current
    if (r && r.hostId === meRef.current?.id) {
      roomChRef.current?.send({ type: 'broadcast', event: 'closed', payload: {} })
      lobbyChRef.current?.untrack()
    }
    if (roomChRef.current) { supabase.removeChannel(roomChRef.current); roomChRef.current = null }
    if (cpuTimerRef.current) { clearTimeout(cpuTimerRef.current); cpuTimerRef.current = null }
    setRoom(null); roomRef.current = null
    setGame(null); gameRef.current = null
    setMembers([]); membersRef.current = []
    setNpcs([]); npcsRef.current = []
    setPassNote(null)
    setLastResult(null)
    setStamps([])
    setShowFinal(false); showFinalRef.current = false; finalShownRef.current = null
    wagerKeyRef.current = null
    betPendingRef.current = null
    setBetBusy(false)
    if (hostGraceRef.current) { clearTimeout(hostGraceRef.current); hostGraceRef.current = null }
    for (const t of pendingLeaveRef.current.values()) clearTimeout(t)
    pendingLeaveRef.current = new Map()
    setReady(false); readyRef.current = false
    try { sessionStorage.removeItem('bf-othello-room') } catch { /* 無視 */ }
    setView('lobby')
  }, [])
  const leaveRoomRef = useRef(leaveRoom)
  useEffect(() => { leaveRoomRef.current = leaveRoom }, [leaveRoom])

  // ---- リロード復帰: 保存済みの部屋があれば自動で入り直す ----
  useEffect(() => {
    if (!me || roomRef.current) return
    try {
      const saved = JSON.parse(sessionStorage.getItem('bf-othello-room') || 'null')
      if (saved?.roomInfo) joinRoom(saved.roomInfo, !!saved.spectator)
    } catch { /* 無視 */ }
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  // アンマウント時にチャンネルを確実に掃除
  useEffect(() => () => {
    if (roomChRef.current) supabase.removeChannel(roomChRef.current)
    if (lobbyChRef.current) supabase.removeChannel(lobbyChRef.current)
    if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current)
    if (hostGraceRef.current) clearTimeout(hostGraceRef.current)
    for (const t of pendingLeaveRef.current.values()) clearTimeout(t)
    // 街へ戻る等のページ遷移では部屋の保存を消す(リロードではこのクリーンアップは走らないので残る)
    try { sessionStorage.removeItem('bf-othello-room') } catch { /* 無視 */ }
  }, [])

  // ---- 部屋を立てる ----
  const createRoom = () => {
    const b = Math.max(0, Math.min(MAX_BET, Math.floor(Number(bet) || 0)))
    const title = roomTitle.trim() || `${me.name}の部屋`
    const roomId = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 13)
    joinRoom({ id: roomId, title, hostId: me.id, hostName: me.name, bet: b })
  }

  // ---- 対局席: 入室順(ホスト含む・観戦希望を除く) + NPC で最大5席。あふれた人は観戦 ----
  const seatedOf = (mems, nps) => [...mems.filter((m) => !m.spectator), ...nps].slice(0, MAX_MULTI_PLAYERS)
  const seated = seatedOf(members, npcs)

  // ---- 結果を閉じて待機画面へ(自動では戻らない。任意のタイミングで押す) ----
  const returnToWaiting = useCallback(() => {
    const g = gameRef.current
    if (g?.result) {
      let txt
      if (g.mode === 'multi') {
        txt = g.result.standings
          .map((s, i) => `${i + 1}位 ${s.name}(${s.count})${s.left ? '×' : ''}`)
          .join(' / ')
      } else {
        const w = g.result.winner ? g.players[g.result.winner] : null
        txt = w
          ? `${g.result.forfeit ? '(不戦勝) ' : ''}${w.name}の勝ち ⚫${g.result.black}-⚪${g.result.white}`
          : `引き分け ⚫${g.result.black}-⚪${g.result.white}`
      }
      setLastResult(txt)
    }
    setShowFinal(false)
    setGame(null)
    gameRef.current = null
  }, [])

  // ---- 勝敗確定で最終結果を表示(自動では消さない=見逃さない) ----
  useEffect(() => {
    if (game?.phase !== 'ended' || !game.result) {
      finalShownRef.current = null
      if (showFinalRef.current) setShowFinal(false)
      return
    }
    // 同じ終局でstateが再配信されても、閉じた最終結果を開き直さない
    const r = game.result
    const key = game.mode === 'multi'
      ? `m|${r.standings.map((s) => `${s.name}:${s.count}`).join(',')}`
      : `s|${r.winner}|${r.black}|${r.white}`
    if (finalShownRef.current !== key) {
      finalShownRef.current = key
      setShowFinal(true)
    }
  }, [game, showFinal])

  // ---- NPC追加/削除(ホスト・対局中以外) ----
  const addNpc = (level) => {
    if (membersRef.current.filter((m) => !m.spectator).length + npcsRef.current.length >= MAX_MULTI_PLAYERS) { showToast(`最大${MAX_MULTI_PLAYERS}人です`); return }
    const used = new Set(npcsRef.current.map((n) => n.name.replace(/^🤖| LV\d$/g, '')))
    const base = NPC_NAMES.find((n) => !used.has(n)) || `NPC${npcsRef.current.length + 1}`
    setNpcs((prev) => [...prev, { id: `npc-lv${level}-${prev.length + 1}-${Date.now() % 100000}`, name: `🤖${base} LV${level}`, level }])
  }
  const removeNpc = (id) => setNpcs((prev) => prev.filter((n) => n.id !== id))

  // NPC数が変わったらロビーの人数掲示を更新
  useEffect(() => {
    if (room && room.hostId === me?.id) publishRoom(game?.phase === 'playing' ? 'playing' : 'waiting')
  }, [npcs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- ゲーム開始(ホスト・手番/色はランダム) ----
  const actuallyStart = (order, wKey) => {
    wagerKeyRef.current = wKey
    setPassNote(null)
    if (order.length === 2) {
      hostBroadcast(createGame({ black: order[0], white: order[1] }), [])
    } else {
      hostBroadcast(createMultiGame(order), [])
    }
    publishRoom('playing')
  }
  const startGame = () => {
    const list = seatedOf(membersRef.current, npcsRef.current)
    if (list.length < 2) { showToast('対戦相手がいません(NPCを追加するか入室を待ってください)'); return }
    // ホスト以外の対局者(人間)が全員「準備OK」でないと開始できない(NPCは対象外)
    const notReady = list.filter((p) => !isNpcId(p.id) && p.id !== roomRef.current.hostId && !p.ready)
    if (notReady.length > 0) {
      showToast(`準備OKが揃っていません: ${notReady.map((p) => p.name).join(`・`)}`)
      return
    }
    // 手番順をシャッフル
    const order = list.map((p) => ({ id: p.id, name: p.name }))
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    // 賭けあり(人間2人以上)なら先に全員の供託を待つ
    const humans = order.filter((p) => !isNpcId(p.id)).map((p) => p.id)
    const roomBet = roomRef.current?.bet || 0
    if (roomBet > 0 && humans.length >= 2) {
      const key = `${roomRef.current.id}:${Date.now()}`
      betPendingRef.current = { key, need: new Set(humans), ok: new Set(), start: (k) => actuallyStart(order, k) }
      setBetBusy(true)
      roomChRef.current?.send({ type: 'broadcast', event: 'betcall', payload: { key, humanIds: humans } })
      setTimeout(() => {
        if (betPendingRef.current?.key === key) {
          betPendingRef.current = null
          roomChRef.current?.send({ type: 'broadcast', event: 'betabort', payload: { key, msg: '供託が揃いませんでした(対局中止)' } })
        }
      }, 15000)
    } else {
      actuallyStart(order, null)
    }
  }

  // ---- 着手送信(全員共通・ホストも同じ経路) ----
  const sendMove = (idx) => {
    roomChRef.current?.send({ type: 'broadcast', event: 'action', payload: { action: { playerId: me.id, idx } } })
  }

  // ---- プレイ⇔観戦の切替(ホストも可・presenceを再trackするだけ) ----
  // ---- 準備OKの切替(presenceに載せて全員へ同期) ----
  const toggleReady = () => {
    const next = !readyRef.current
    readyRef.current = next
    setReady(next)
    const meSpec = !!membersRef.current.find((m) => m.id === meRef.current.id)?.spectator
    roomChRef.current?.track({ name: meRef.current.name, joinedAt: myJoinedAtRef.current, spectator: meSpec, ready: next })
  }

  const setSpectatorMode = (next) => {
    roomChRef.current?.track({ name: meRef.current.name, joinedAt: myJoinedAtRef.current, spectator: next, ready: next ? false : readyRef.current })
  }

  // ---- スタンプ送信(観戦者含む全員・1.5秒クールダウン) ----
  const sendStamp = (text) => {
    const now = Date.now()
    if (now - stampCdRef.current < 1500) return
    stampCdRef.current = now
    roomChRef.current?.send({ type: 'broadcast', event: 'stamp', payload: { name: meRef.current.name, text, senderId: meRef.current.id } })
  }

  // ---- チャット(運営が建てた部屋のみ) ----
  useEffect(() => {
    let alive = true
    setChatOn(false); setChatMsgs([])
    const hostId = room?.hostId
    if (!hostId) return
    supabase.from('profiles').select('is_admin').eq('id', hostId).maybeSingle()
      .then(({ data }) => { if (alive && data?.is_admin) setChatOn(true) })
      .catch(() => {})
    return () => { alive = false }
  }, [room?.hostId])

  const sendChat = (text) => {
    const t = (text ?? '').trim().slice(0, 100)
    if (!t || !roomChRef.current || !meRef.current) return false
    if (containsNgWord(t)) { showToast('使用できない言葉が含まれています'); return false }
    const now = Date.now()
    if (now - chatCdRef.current < 2000) { showToast('少し間をあけてください'); return false }
    chatCdRef.current = now
    roomChRef.current.send({ type: 'broadcast', event: 'chat', payload: { name: meRef.current.name, senderId: meRef.current.id, text: t } })
    return true
  }

  // 対局者のスタンプ吹き出し(名前の下に表示)
  const stampBubbleStyle = {
    background: 'rgba(10,20,40,0.92)', border: '1px solid #ffcc44', borderRadius: '12px',
    padding: '4px 10px', fontSize: '12px', color: '#fff', whiteSpace: 'nowrap',
    animation: 'okstamp 2.6s ease-out both', boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
  }
  const stampBubbles = (playerId, align = 'left') => {
    const list = stamps.filter((s) => s.senderId === playerId)
    if (list.length === 0) return null
    return (
      <div style={{
        position: 'absolute', top: '100%', [align]: 0, marginTop: '4px',
        display: 'flex', flexDirection: 'column', gap: '4px', zIndex: 55, pointerEvents: 'none',
        alignItems: align === 'right' ? 'flex-end' : 'flex-start',
      }}>
        {list.map((s) => (
          <div key={s.id} style={stampBubbleStyle}>
            <span style={{ color: '#ffcc44' }}>{s.name}</span>: {s.text}
          </div>
        ))}
      </div>
    )
  }

  // ---- NPC自動着手(ホストが実行) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.phase !== 'playing') return
    const curPlayer = game.mode === 'multi' ? game.players[game.turnIdx] : game.players[game.turn]
    if (!curPlayer || !isNpcId(curPlayer.id)) return
    const seq = stateSeqRef.current
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return // 既に別の手で進行済み
      const cur = gameRef.current
      if (!cur || cur.phase !== 'playing') return
      const mv = cur.mode === 'multi'
        ? cpuChooseMoveMulti(cur, npcLevelOf(curPlayer.id))
        : cpuChooseMove(cur.board, cur.turn, npcLevelOf(curPlayer.id))
      if (mv !== null) hostApply({ playerId: curPlayer.id, idx: mv })
    }, CPU_DELAY_MS)
    cpuTimerRef.current = t
    return () => clearTimeout(t)
  }, [game, room, me, hostApply])

  // ============================================================
  // 描画
  // ============================================================
  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#000a14', color: '#88ccff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>読み込み中…</div>
  }
  const wrap = (children) => (
    <div style={{ minHeight: '100vh', background: '#000a14', color: '#cde', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px' }}>
      {children}
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: '#112244', border: '1px solid #4488cc', color: '#cde', padding: '8px 16px', fontSize: '12px', zIndex: 50 }}>{toast}</div>
      )}
    </div>
  )

  // ---- ロビー ----
  if (view === 'lobby') {
    return wrap(
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <button onClick={() => nav('/game')} style={btnStyle('#88ccff')}>← 街に戻る</button>
          <div style={{ color: '#ffcc44', fontSize: '13px' }}>⚫ 盤上遊戯「双極盤」</div>
          <div style={{ width: '76px' }} />
        </div>

        <div style={{ border: '1px solid #224466', padding: '12px', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', color: '#88ccff', marginBottom: '8px' }}>部屋を立てる</div>
          <div style={{ fontSize: '11px', color: '#88ccff', marginBottom: '4px' }}>💰 賭けGold(0=賭けなし・人間2人以上で成立・1位総取り)</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
            {[0, 100, 1000, 10000, 100000].map((b) => (
              <button key={b} onClick={() => setBet(b)} style={btnStyle(Number(bet) === b ? '#ffcc44' : '#446688', { fontSize: '11px' })}>
                {b === 0 ? 'なし' : `${b.toLocaleString()}G`}
              </button>
            ))}
            <input type="number" value={bet} min={0} max={MAX_BET} onChange={(e) => setBet(e.target.value)}
              style={{ width: '100px', background: '#001122', border: '1px solid #224466', color: '#ffcc44', padding: '4px 6px', fontFamily: 'monospace', fontSize: '11px' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} maxLength={20}
              placeholder={`${me.name}の部屋`}
              style={{ flex: 1, background: '#001122', border: '1px solid #224466', color: '#cde', padding: '6px 8px', fontFamily: 'monospace', fontSize: '12px' }}
            />
            <button onClick={createRoom} style={btnStyle('#ffcc44')}>作成</button>
          </div>
          <div style={{ fontSize: '10px', color: '#668', marginTop: '6px' }}>最大5人。2人=8×8 / 3人=9×9 / 4人=10×10 / 5人=11×11。NPC(CPU)も混ぜられます</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontSize: '12px', color: '#88ccff' }}>部屋一覧</div>
          <button onClick={() => setLobbyNonce((n) => n + 1)} style={btnStyle('#88ccff', { padding: '2px 10px', fontSize: '11px' })}>🔄 更新</button>
        </div>
        {rooms.length === 0 && <div style={{ fontSize: '12px', color: '#668' }}>現在開いている部屋はありません</div>}
        {rooms.map((r) => (
          <div key={r.roomId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #224466', padding: '10px 12px', marginBottom: '8px' }}>
            <div>
              <div style={{ fontSize: '13px' }}>
                {r.title}
                {r.bet > 0 && <span style={{ color: '#ffaa00', marginLeft: '6px' }}>💰{Number(r.bet).toLocaleString()}G</span>}
              </div>
              <div style={{ fontSize: '10px', color: '#668' }}>主: {r.hostName} / {r.count}人 / {r.status === 'playing' ? '🟢 対局中(観戦可)' : '🟡 募集中'}</div>
            </div>
            {r.status === 'playing' ? (
              <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName, bet: r.bet || 0 })} style={btnStyle('#88ccff')}>観戦入室</button>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName, bet: r.bet || 0 })} style={btnStyle('#44dd88')}>プレイ</button>
                <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName, bet: r.bet || 0 }, true)} style={btnStyle('#88ccff')}>観戦</button>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // ---- 部屋 ----
  const isHost = room?.hostId === me?.id
  const playing = game?.phase === 'playing'
  const isMulti = game?.mode === 'multi'
  const boardSize = isMulti ? game.size : SIZE
  const boardArr = game ? game.board : new Array(SIZE * SIZE).fill(EMPTY)

  // 自分の手番と置けるマス
  let myColor = null, isMyTurn = false, isSpectator = false
  let hints = new Set()
  if (game) {
    if (isMulti) {
      const meP = game.players.find((p) => p.id === me.id)
      myColor = meP?.color || null
      isSpectator = !meP
      isMyTurn = playing && game.players[game.turnIdx]?.id === me.id
      if (isMyTurn) hints = new Set(legalMovesMulti(game.board, game.size, myColor, game.players.filter((p) => !p.left).map((p) => p.color)).moves)
    } else {
      myColor = colorOf(game, me.id)
      isSpectator = !myColor
      isMyTurn = playing && myColor === game.turn
      if (isMyTurn) hints = new Set(validMoves(game.board, myColor))
    }
  }

  let statusMsg = ''
  if (!game) statusMsg = isHost ? '「対局開始」で始められます' : 'ホストの開始を待っています…'
  else if (playing) {
    const cur = isMulti ? game.players[game.turnIdx] : game.players[game.turn]
    statusMsg = isMyTurn ? 'あなたの番です' : `${cur?.name || '?'} の番です…`
  } else if (game.result) {
    if (isMulti) {
      const ws = game.result.winners.map((c) => game.players.find((p) => p.color === c)?.name).filter(Boolean)
      statusMsg = ws.length === 1 ? `${ws[0]} の勝ち！` : ws.length > 1 ? `引き分け(${ws.join(' / ')})` : '終局'
    } else {
      const w = game.result.winner ? game.players[game.result.winner] : null
      statusMsg = w
        ? `${game.result.forfeit ? '(不戦勝) ' : ''}${w.name} の勝ち！ ⚫${game.result.black} - ⚪${game.result.white}`
        : `引き分け ⚫${game.result.black} - ⚪${game.result.white}`
    }
  }

  const multiCounts = isMulti ? countsByColor(game.board) : null
  const classicCounts = game && !isMulti ? countStones(game.board) : { black: 2, white: 2 }

  return wrap(
    <div style={{ width: '100%', maxWidth: '520px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <button onClick={leaveRoom} style={btnStyle('#88ccff')}>← 退室</button>
        <div style={{ color: '#ffcc44', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{room.title}</div>
        {isHost ? (
          <button onClick={startGame} disabled={playing || betBusy} style={btnStyle(playing || betBusy ? '#446' : '#ffcc44', { opacity: playing || betBusy ? 0.5 : 1 })}>{betBusy ? '供託待ち…' : game ? '再戦' : '対局開始'}</button>
        ) : <div style={{ width: '60px' }} />}
      </div>

      {/* 対局者/メンバー */}
      <div style={{ border: '1px solid #224466', padding: '8px 12px', marginBottom: '10px', fontSize: '12px' }}>
        {game ? (
          isMulti ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
              {game.players.map((p) => {
                const isTurn = playing && game.players[game.turnIdx]?.id === p.id
                return (
                  <div key={p.color} style={{ color: isTurn ? '#ffcc44' : p.left ? '#556' : '#cde', textDecoration: p.left ? 'line-through' : 'none', position: 'relative' }}>
                    <span style={stoneStyle(p.color)} /> {p.name}: {multiCounts[p.color] || 0}
                    {stampBubbles(p.id, 'left')}
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ color: playing && game.turn === BLACK ? '#ffcc44' : '#cde', position: 'relative' }}>
                <span style={stoneStyle(BLACK)} /> {game.players[BLACK]?.name}: {classicCounts.black}
                {stampBubbles(game.players[BLACK]?.id, 'left')}
              </div>
              <div style={{ color: playing && game.turn === WHITE ? '#ffcc44' : '#cde', position: 'relative' }}>
                <span style={stoneStyle(WHITE)} /> {game.players[WHITE]?.name}: {classicCounts.white}
                {stampBubbles(game.players[WHITE]?.id, 'right')}
              </div>
            </div>
          )
        ) : (
          <div>
            {(room.bet || 0) > 0 && (
              <div style={{ border: '1px solid #8a6a22', background: 'rgba(255,170,0,0.08)', padding: '4px 8px', marginBottom: '6px', color: '#ffaa00', fontSize: '11px' }}>
                💰 賭け対局: 1人 {Number(room.bet).toLocaleString()}G(人間2人以上で成立・勝者総取り・NPC勝ち/引き分けは返金)
              </div>
            )}
            {lastResult && (
              <div style={{ border: '1px solid #665522', background: 'rgba(255,204,68,0.07)', padding: '4px 8px', marginBottom: '6px', color: '#ffcc44', fontSize: '11px' }}>
                前回の結果: {lastResult}
              </div>
            )}
            <div style={{ color: '#88ccff', marginBottom: '4px' }}>対局者(最大{MAX_MULTI_PLAYERS}人 / 3人以上は盤が拡大: {seated.length >= 2 ? `${multiBoardSize(Math.max(seated.length, 2))}×${multiBoardSize(Math.max(seated.length, 2))}` : '8×8'})</div>
            {seated.length >= 3 && <div style={{ color: '#446688', fontSize: '10px', marginBottom: '4px' }}>※3人以上: 初期配置は各2個・他プレイヤーの石を全滅させる手は打てません(その手しか無い場合を除く)</div>}
            {seated.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                <span>{i + 1}. {p.name}{p.id === room.hostId ? ' (ホスト)' : ''}</span>
                {(() => { if (isNpcId(p.id) || p.id === room.hostId) return null; return p.ready ? <span style={{ color: '#44dd88', marginLeft: 6 }}>✓準備OK</span> : <span style={{ color: '#886', marginLeft: 6 }}>準備中…</span> })()}
                {isHost && isNpcId(p.id) && <button onClick={() => removeNpc(p.id)} style={btnStyle('#ff6644', { padding: '1px 6px', fontSize: '10px' })}>削除</button>}
                {stampBubbles(p.id, 'left')}
              </div>
            ))}
            {seated.length < MAX_MULTI_PLAYERS && <div style={{ color: '#668' }}>{seated.length + 1}. 募集中…</div>}
            {isHost && seated.length < MAX_MULTI_PLAYERS && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ color: '#44dd88', fontSize: '11px', marginBottom: '4px' }}>+ NPCを追加(強さを選択 / 9=最強AI ※3人以上の対局では4以上は同じ思考)</div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => (
                    <button key={lv} onClick={() => addNpc(lv)}
                      style={btnStyle(lv >= 9 ? '#ff6644' : lv >= 7 ? '#ffcc44' : '#44dd88', { padding: '4px 0', fontSize: '12px', width: '32px', textAlign: 'center' })}>
                      {lv}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(() => {
              const specs = members.filter((m) => !seated.some((s) => s.id === m.id))
              if (specs.length === 0) return null
              return <div style={{ color: '#668', marginTop: '4px' }}>▼ 観戦者: {specs.map((m) => m.name).join('　')}</div>
            })()}
            <InvitePanel me={me} room={room} path="/othello" />
            {/* プレイ⇔観戦の切替(ホストも可) */}
            {(() => {
              const meSpec = !!members.find((m) => m.id === me.id)?.spectator
              return (
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {!meSpec && me.id !== room.hostId && (
                    <button onClick={toggleReady} style={btnStyle(ready ? '#44dd88' : '#ffcc44', { padding: '4px 10px', fontSize: '11px', background: ready ? 'rgba(68,221,136,0.12)' : 'rgba(255,204,68,0.12)' })}>
                      {ready ? '✓ 準備OK（取消）' : '準備OKにする'}
                    </button>
                  )}
                  <button onClick={() => setSpectatorMode(!meSpec)} style={btnStyle(meSpec ? '#44dd88' : '#88ccff', { padding: '4px 10px', fontSize: '11px' })}>
                    {meSpec ? '⚔ 対局に参加する' : '👀 観戦にまわる'}
                  </button>
                </div>
              )
            })()}
          </div>
        )}
        {game && isSpectator && <div style={{ color: '#668', marginTop: '4px' }}>👀 観戦中</div>}
        {game && myColor && (
          <div style={{ color: '#668', marginTop: '4px' }}>
            あなたは <span style={stoneStyle(myColor)} /> {STONE_LABEL[myColor] || '?'}
            {!isMulti && (myColor === BLACK ? '(先手)' : '(後手)')}
          </div>
        )}
      </div>

      {/* 盤面 */}
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${boardSize}, 1fr)`, gap: '2px',
        background: '#0a3320', border: '3px solid #1a5535', borderRadius: '4px', padding: '4px',
        width: '100%', aspectRatio: '1',
      }}>
        {boardArr.map((cell, i) => (
          <button
            key={i}
            onClick={() => { if (hints.has(i)) sendMove(i) }}
            style={{
              background: game && i === game.lastMove ? '#1e7a48' : '#146038',
              border: 'none', borderRadius: '2px', cursor: hints.has(i) ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
          >
            {cell !== EMPTY && (
              <div style={{
                width: '78%', height: '78%', borderRadius: '50%',
                background: STONE_CSS[cell] || '#666',
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }} />
            )}
            {cell === EMPTY && hints.has(i) && (
              <div style={{ width: '26%', height: '26%', borderRadius: '50%', background: 'rgba(255, 220, 80, 0.45)' }} />
            )}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '12px', fontSize: '14px', color: game?.phase === 'ended' ? '#ffcc44' : '#9fd', minHeight: '20px', textAlign: 'center' }}>
        {statusMsg}
        {passNote && <div style={{ fontSize: '12px', color: '#ff8866', marginTop: '4px' }}>{passNote}</div>}
      </div>

      {/* スタンプバー(カテゴリを押すと文言が展開・対局者と観戦者でカテゴリが異なる) */}
      {(() => {
        const amSpectator = game ? isSpectator : !seated.some((s) => s.id === me.id)
        const cheerTargets = game
          ? (isMulti ? game.players.map((p) => ({ id: p.id, name: p.name })) : [game.players[BLACK], game.players[WHITE]].filter(Boolean))
          : seated
        return <StampBar spectator={amSpectator} players={cheerTargets} onSend={sendStamp} />
      })()}
      {chatOn && <RoomChat messages={chatMsgs} onSend={sendChat} meId={me?.id} />}

      {/* 観戦者のスタンプは下部に表示(対局者のは名前の下) */}
      <style>{'@keyframes okstamp { 0% { transform: translateY(8px) scale(0.8); opacity: 0 } 15% { transform: none; opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }'}</style>
      {(() => {
        const seatedIds = new Set(game
          ? (isMulti ? game.players.map((p) => p.id) : [game.players[BLACK]?.id, game.players[WHITE]?.id])
          : seated.map((s) => s.id))
        const specStamps = stamps.filter((s) => !seatedIds.has(s.senderId))
        if (specStamps.length === 0) return null
        return (
          <div style={{ position: 'fixed', bottom: '64px', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center', zIndex: 55, pointerEvents: 'none' }}>
            {specStamps.map((s) => (
              <div key={s.id} style={{
                background: 'rgba(10,20,40,0.92)', border: '1px solid #88ccff', borderRadius: '14px',
                padding: '6px 14px', fontSize: '13px', color: '#fff', whiteSpace: 'nowrap',
                animation: 'okstamp 2.6s ease-out both', boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
              }}>
                <span style={{ color: '#88ccff' }}>👀{s.name}</span>: {s.text}
              </div>
            ))}
          </div>
        )
      })()}

      {/* 観戦者一覧 */}
      {game && (() => {
        const seatedIds = new Set(isMulti ? game.players.map((p) => p.id) : [game.players[BLACK]?.id, game.players[WHITE]?.id])
        const specs = members.filter((m) => !seatedIds.has(m.id))
        if (specs.length === 0) return null
        return (
          <div style={{ marginTop: '10px', fontSize: '12px', textAlign: 'center', width: '100%' }}>
            <div style={{ color: '#668', marginBottom: '2px' }}>▼ 観戦者</div>
            <div style={{ color: '#88ccff' }}>{specs.map((s) => s.name).join('　')}</div>
          </div>
        )
      })()}

      {/* 多人数の最終結果 */}
      {isMulti && game.phase === 'ended' && game.result?.standings && (
        <div style={{ border: '1px solid #224466', padding: '8px 12px', marginTop: '10px', fontSize: '12px', width: '100%' }}>
          {game.result.standings.map((s, i) => (
            <div key={s.color} style={{ color: s.left ? '#556' : i === 0 ? '#ffcc44' : '#cde' }}>
              {i + 1}位 <span style={stoneStyle(s.color)} /> {s.name}: {s.count}{s.left ? ' (切断)' : ''}
            </div>
          ))}
        </div>
      )}

      {/* 終局後の操作(自動では戻らない。任意のタイミングで待機画面へ) */}
      {game.phase === 'ended' && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={returnToWaiting} style={btnStyle('#ffcc44', { padding: '6px 14px', fontSize: '12px' })}>待機画面に戻る</button>
          {!showFinal && <button onClick={() => setShowFinal(true)} style={btnStyle('#88ccff', { padding: '6px 14px', fontSize: '12px' })}>最終結果をもう一度見る</button>}
        </div>
      )}

      {/* 最終結果(全画面・自動では消えない) */}
      {game.phase === 'ended' && game.result && showFinal && (() => {
        const r = game.result
        const rows = isMulti
          ? r.standings.map((s, i) => ({
            key: s.color, rank: i + 1,
            name: `${STONE_LABEL[s.color] || '?'} ${s.name}`,
            sub: `${s.count}個${s.left ? ' (切断)' : ''}`,
          }))
          : [BLACK, WHITE].map((c) => ({
            key: c,
            rank: r.winner ? (c === r.winner ? 1 : 2) : 0,
            name: `${STONE_LABEL[c]} ${game.players[c]?.name || '?'}`,
            sub: `${c === BLACK ? r.black : r.white}個`,
          })).sort((a, b) => a.rank - b.rank)
        return (
          <FinalResult
            subtitle={isMulti ? `双極盤 ${game.players.length}人戦` : '双極盤'}
            rows={rows}
            headline={!isMulti && !r.winner ? '引き分け' : null}
            footNote={r.forfeit ? '相手の退室による不戦勝です' : null}
            betNote={room.bet > 0 ? '💰 賭けの精算結果は画面下の通知に出ます' : null}
            onClose={() => setShowFinal(false)}
            onReturn={returnToWaiting}
          />
        )
      })()}
    </div>
  )
}
