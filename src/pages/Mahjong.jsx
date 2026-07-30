import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import {
  KIND_NAMES, DEFAULT_MJ_RULES, createMahjongGame, applyMahjong, getTurnOptions, getClaimOptions,
  npcDecide, autoActionFor, isNpcId, doraFromIndicator, waitsOf,
  MIN_MAHJONG_PLAYERS, MAX_MAHJONG_PLAYERS, TURN_SEC, CLAIM_SEC,
} from '../lib/mahjong'
import { TileFace, TileBackFace } from '../components/MahjongTile'
import { StampBar, StampOverlay } from '../components/StampBar'
import { wagerJoin, wagerReport, wagerForfeit, wagerPing, wagerSettleRanked, MAX_BET } from '../lib/wager'

const BET_PRESETS = [0, 100, 1000, 10000, 100000]
const rankColor = (r) => (r === 1 ? '#ffcc44' : r === 2 ? '#c8d2e0' : r === 3 ? '#cc8850' : '#7788aa')

// ============================================================
// 麻雀(雀魂風) — 開発限定のミニゲーム(娯楽・ステ影響なし)
// 部屋: Supabase Realtime presence(ロビー一覧) + broadcast(ゲーム同期)
// ホスト権威型・SQLテーブル不要。4人東風戦 / 3人サンマ東風戦
// ============================================================

// 切断とみなすまでの猶予。スマホで画面を離れても1分程度は部屋が保たれるようにする
const DISCONNECT_GRACE = 75000
const LOBBY_CHANNEL = 'mahjong-lobby'
const roomChannelName = (roomId) => `mahjong-room-${roomId}`
const NPC_NAMES = ['ツモ吉', 'ロン子', 'カン太', 'ポン美']
const WINDS = ['東', '南', '西', '北']

const btnStyle = (color, extra = {}) => ({
  background: 'none', border: `1px solid ${color}`, color, padding: '6px 10px',
  cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', ...extra,
})

// ---- 牌表示(SVG描画) ----
// glow: ドラ=金の光 / 赤5=赤の光
function Tile({ k, r, small, dim, onClick, sel, disabled, glow }) {
  const size = small ? { w: 24, h: 32 } : { w: 36, h: 48 }
  const glowShadow = glow ? (r ? '0 0 7px 2px rgba(255,70,50,0.85)' : '0 0 7px 2px rgba(255,215,80,0.85)') : 'none'
  return (
    <button
      onClick={onClick}
      disabled={disabled || !onClick}
      style={{
        width: size.w, height: size.h, padding: 0,
        background: 'none',
        border: sel ? '2px solid #ffcc44' : 'none',
        borderRadius: 4, cursor: onClick && !disabled ? 'pointer' : 'default',
        opacity: dim ? 0.45 : 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transform: sel ? 'translateY(-4px)' : 'none',
        boxShadow: glowShadow,
      }}
    >
      <TileFace k={k} r={r} w={sel ? size.w - 4 : size.w} h={sel ? size.h - 4 : size.h} />
    </button>
  )
}
function TileBack({ small }) {
  const size = small ? { w: 24, h: 32 } : { w: 36, h: 48 }
  return <span style={{ display: 'inline-flex' }}><TileBackFace w={size.w} h={size.h} /></span>
}

export default function Mahjong() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState('lobby')
  const [rooms, setRooms] = useState([])
  const [roomTitle, setRoomTitle] = useState('')

  const [room, setRoom] = useState(null)
  const [members, setMembers] = useState([])
  const [npcs, setNpcs] = useState([])
  const [game, setGame] = useState(null)
  const [toast, setToast] = useState(null)
  const [riichiMode, setRiichiMode] = useState(false)
  const [hoverWait, setHoverWait] = useState(null) // { k, waits } 打牌候補ホバー時の待ち表示
  const [lastResult, setLastResult] = useState(null) // 直前の対局結果(待機画面に表示)
  const [stamps, setStamps] = useState([]) // 表示中スタンプ
  const stampSeqRef = useRef(0)
  const stampCdRef = useRef(0)
  const hostGraceRef = useRef(null) // ホスト不在の猶予タイマー(リロード復帰待ち)
  // 部屋設定(ホストが部屋内で変更・全員へ同期)
  const DEFAULT_SETTINGS = { rules: { ...DEFAULT_MJ_RULES }, bet: 0 }
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const settingsRef = useRef(DEFAULT_SETTINGS)
  const [betBusy, setBetBusy] = useState(false)
  const wagerKeyRef = useRef(null)
  const betPendingRef = useRef(null)
  const reportedRef = useRef(new Set())
  const settleWagerRef = useRef(null)
  const myJoinedAtRef = useRef(0)

  // 終局後は結果を数秒見せて待機画面へ戻る
  useEffect(() => {
    if (game?.phase !== 'ended' || !game.finalStandings) return
    const t = setTimeout(() => {
      setLastResult(game.finalStandings.map((s, i) => `${i + 1}位 ${s.name}(${s.score})`).join(' / '))
      setGame(null)
      gameRef.current = null
    }, 7000)
    return () => clearTimeout(t)
  }, [game])
  const [chiPick, setChiPick] = useState(null) // 複数チー候補
  const [kanPick, setKanPick] = useState(null)
  const [nowTick, setNowTick] = useState(0) // 残り秒表示用

  const lobbyChRef = useRef(null)
  const roomChRef = useRef(null)
  const gameRef = useRef(null)
  const stateSeqRef = useRef(0)
  const meRef = useRef(null)
  const roomRef = useRef(null)
  const membersRef = useRef([])
  const npcsRef = useRef([])
  const autoRef = useRef(new Set()) // 切断中プレイヤーid(ホスト管理)
  const pendingBroadcastRef = useRef(false) // ダミー時間中フラグ(ホスト)
  const splashTimerRef = useRef(null)
  const [splash, setSplash] = useState(null) // { what, name } 大きな宣言演出
  const npcTimerRef = useRef(null)
  const deadlineTimerRef = useRef(null)

  useEffect(() => { gameRef.current = game }, [game])
  useEffect(() => { meRef.current = me }, [me])
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { npcsRef.current = npcs }, [npcs])
  useEffect(() => { settingsRef.current = settings }, [settings])

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  // ---- 賭け精算(順位分配・切断者は負け扱い) ----
  const settleWager = useCallback(async (key, g, lostIds) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const nameOf = (id) => g.players.find((p) => p.id === id)?.name || '?'
    if (lostIds && lostIds.length > 0) {
      showToast('💰 切断を確認中…精算まで少しお待ちください')
      const pending = new Set(lostIds)
      for (let attempt = 0; attempt < 6 && pending.size > 0; attempt++) {
        for (const lid of [...pending]) {
          const r = await wagerForfeit(key, lid)
          if (r?.status === 'settled') { showToast(`💰 切断により ${nameOf(r.winner)} が ${r.pot}G 獲得！`); return }
          if (r?.forfeited || r?.status === 'refunded') pending.delete(lid)
        }
        if (pending.size > 0) await sleep(15000)
      }
    }
    // 最終順位(素点順)で分配。NPC・離脱者は除外
    const excluded = new Set(lostIds || [])
    const ranked = (g.finalStandings || [])
      .map((s) => g.players[s.seat].id)
      .filter((id) => !isNpcId(id) && !excluded.has(id))
    if (ranked.length >= 2) {
      const res = await wagerSettleRanked(key, ranked)
      if (res?.status === 'settled') { showToast(`💰 分配精算完了！ 1位 ${nameOf(ranked[0])} が ${res.top_gain ?? res.pot}G 獲得`); return }
      if (res?.status === 'refunded') { showToast('💰 全員に返金されました'); return }
      if (res?.error?.includes('SQL更新')) {
        const res2 = await wagerReport(key, ranked[0])
        if (res2?.status === 'settled') showToast(`💰 精算完了: ${nameOf(ranked[0])} が ${res2.pot}G 獲得！`)
        else if (res2?.error) showToast(`💰 ${res2.error}`)
        return
      }
      if (res?.error) showToast(`💰 ${res.error}`)
      return
    }
    const res = await wagerReport(key, null)
    if (res?.status === 'refunded') showToast('💰 全員に返金されました')
    else if (res?.error) showToast(`💰 ${res.error}`)
  }, [])
  useEffect(() => { settleWagerRef.current = settleWager }, [settleWager])

  // ---- 賭け中は在室ハートビート ----
  // 終局後も精算が終わるまで継続する(終局直後に「切断した」と後出しで申告されるのを防ぐ)
  const inWagerMatch = !!(room && game && wagerKeyRef.current && me
    && game.players?.some((p) => p.id === me.id))
  useEffect(() => {
    if (!inWagerMatch) return
    const key = wagerKeyRef.current
    wagerPing(key)
    const iv = setInterval(() => wagerPing(key), 15000)
    return () => clearInterval(iv)
  }, [inWagerMatch])

  // ---- 認証 + is_adminゲート ----
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

  // ---- ロビー ----
  useEffect(() => {
    if (!me) return
    const ch = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key: me.id } } })
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      const list = []
      for (const key of Object.keys(st)) {
        // 同一ユーザー(key)の古いmetaは無視して最新のみ
        const metas = st[key].filter((m) => m.roomId)
        if (metas.length > 0) list.push(metas[metas.length - 1])
      }
      setRooms(list)
    })
    ch.subscribe()
    lobbyChRef.current = ch
    return () => { supabase.removeChannel(ch); lobbyChRef.current = null }
  }, [me])

  const publishRoom = useCallback(async (status) => {
    const r = roomRef.current
    if (!r || r.hostId !== meRef.current?.id || !lobbyChRef.current) return
    const s = settingsRef.current
    await lobbyChRef.current.track({
      roomId: r.id, title: r.title, hostId: r.hostId, hostName: r.hostName,
      bet: s.bet || 0, hanchan: !!s.rules?.hanchan,
      count: membersRef.current.length + npcsRef.current.length, status,
    })
  }, [])

  // ---- 部屋設定の変更(ホストのみ・全員へ同期) ----
  const updateSettings = useCallback((patch) => {
    // 賭けが進行中は設定を変更できない(供託額の偽装・途中変更を防ぐ)
    if (wagerKeyRef.current) { showToast('賭け対局の進行中は設定を変更できません'); return }
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    roomChRef.current?.send({ type: 'broadcast', event: 'settings', payload: { settings: next } })
    publishRoom(gameRef.current?.phase === 'playing' ? 'playing' : 'waiting')
    try {
      const saved = JSON.parse(sessionStorage.getItem('bf-mahjong-room') || 'null')
      if (saved) sessionStorage.setItem('bf-mahjong-room', JSON.stringify({ ...saved, settings: next }))
    } catch { /* 無視 */ }
  }, [publishRoom])

  // ---- ホスト: エンジン適用→配信 ----
  const hostBroadcast = useCallback((newState, events = []) => {
    // 応答期限を刻む
    if (newState.await) {
      newState.await.deadline = Date.now() + (newState.await.type === 'turn' ? TURN_SEC : CLAIM_SEC) * 1000
    }
    gameRef.current = newState
    stateSeqRef.current += 1
    roomChRef.current?.send({
      type: 'broadcast', event: 'state',
      payload: {
        seq: stateSeqRef.current, game: newState, events,
        wagerKey: wagerKeyRef.current, disconnected: [...autoRef.current],
      },
    })
  }, [])

  const hostApply = useCallback((playerId, action) => {
    if (pendingBroadcastRef.current) return false // ダミー時間中は操作を受けない
    const cur = gameRef.current
    if (!cur) return false
    const r = applyMahjong(cur, playerId, action)
    if (r.error) {
      roomChRef.current?.send({ type: 'broadcast', event: 'reject', payload: { playerId, msg: r.error } })
      return false
    }
    const finish = () => {
      pendingBroadcastRef.current = false
      if (!roomChRef.current) return
      hostBroadcast(r.state, r.events)
      if (r.state.phase !== 'playing') publishRoom('waiting')
    }
    // ダミー思考時間: 誰も鳴けない打牌でもランダムに間を置き、
    // 「止まった=誰かが鳴ける」と他家に悟られないようにする
    const straightTurn = r.state.await?.type === 'turn' && (action.type === 'discard' || action.type === 'riichi')
    if (straightTurn && Math.random() < 0.45) {
      pendingBroadcastRef.current = true
      setTimeout(finish, 500 + Math.random() * 1100)
    } else finish()
    return true
  }, [hostBroadcast, publishRoom])

  // ---- 部屋 ----
  // asSpectator: trueなら観戦専用(席決めから除外)
  const joinRoom = useCallback((roomInfo, asSpectator = false) => {
    const myself = meRef.current
    const ch = supabase.channel(roomChannelName(roomInfo.id), {
      config: { presence: { key: myself.id }, broadcast: { self: true } },
    })
    let hostSeen = false
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      // 再trackで同一キーに古いmetaが残ることがあるため常に最新のmetaを読む
      const list = Object.keys(st).map((key) => {
        const meta = st[key][st[key].length - 1]
        return { id: key, name: meta?.name || '?', spectator: !!meta?.spectator, joinedAt: meta?.joinedAt || 0 }
      })
      list.sort((a, b) => a.joinedAt - b.joinedAt)
      // 部屋の上限 = 席4 + 観戦100。入室順であふれた人は自動退室(UIには明記しない)
      const cap = MAX_MAHJONG_PLAYERS + 100
      if (list.length > cap && list.findIndex((m) => m.id === myself.id) >= cap) {
        showToast('満員のため入室できません')
        leaveRoomRef.current?.()
        return
      }
      setMembers(list)
      membersRef.current = list
      if (roomInfo.hostId === myself.id) {
        // 復帰したプレイヤーは自動打ちを解除
        for (const m of list) autoRef.current.delete(m.id)
        publishRoom(gameRef.current && gameRef.current.phase !== 'ended' ? 'playing' : 'waiting')
        if (gameRef.current) {
          ch.send({ type: 'broadcast', event: 'state', payload: { seq: stateSeqRef.current, game: gameRef.current, events: [], wagerKey: wagerKeyRef.current, disconnected: [...autoRef.current] } })
        }
        return
      }
      // ホストが消えたら15秒待って解散(リロード復帰の猶予)
      if (list.some((m) => m.id === roomInfo.hostId)) {
        hostSeen = true
        if (hostGraceRef.current) { clearTimeout(hostGraceRef.current); hostGraceRef.current = null }
      } else if (hostSeen && !hostGraceRef.current) {
        hostGraceRef.current = setTimeout(() => {
          hostGraceRef.current = null
          if (membersRef.current.some((m) => m.id === roomInfo.hostId)) return // ホスト復帰済み
          showToast('ホストが退室したため部屋は解散しました')
          leaveRoomRef.current?.()
        }, DISCONNECT_GRACE)
      }
    })
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      // ホスト: 対局中の切断は自動打ち(ツモ切り)に切替
      if (roomInfo.hostId !== myself.id) return
      const cur = gameRef.current
      if (cur && cur.phase !== 'ended' && cur.players.some((p) => p.id === key)) {
        autoRef.current.add(key)
      }
    })
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (gameRef.current && payload.seq < stateSeqRef.current) return
      stateSeqRef.current = payload.seq
      gameRef.current = payload.game
      wagerKeyRef.current = payload.wagerKey || null
      setGame(payload.game)
      setBetBusy(false)
      setRiichiMode(false); setChiPick(null); setKanPick(null); setHoverWait(null)
      // 途中流局/流し満貫の演出
      for (const ev of payload.events || []) {
        if (ev.t === 'abort') setSplash({ what: ev.label, name: '途中流局' })
        if (ev.t === 'nagashi') setSplash({ what: '流し満貫', name: ev.seats.map((s) => payload.game.players[s]?.name).join(' / ') })
        if (ev.t === 'pao') showToast(`⚠ ${payload.game.players[ev.paoSeat]?.name} の責任払い(パオ)`)
      }
      // 賭け精算(終局時のみ)
      const g = payload.game
      if (g.phase === 'ended' && payload.wagerKey && !reportedRef.current.has(payload.wagerKey)) {
        if (g.players.some((p) => p.id === myself.id)) {
          reportedRef.current.add(payload.wagerKey)
          const disc = new Set(payload.disconnected || [])
          const lostIds = g.players.filter((p) => disc.has(p.id) && !isNpcId(p.id)).map((p) => p.id)
          settleWagerRef.current?.(payload.wagerKey, g, lostIds)
        }
      }
      const calls = (payload.events || []).filter((ev) => ev.t === 'call')
      if (calls.length > 0) {
        // 大きな宣言演出(雀魂風)
        setSplash({
          what: calls.map((c) => c.what).join('・'),
          name: calls.map((c) => payload.game.players[c.seat]?.name).join(' / '),
        })
        if (splashTimerRef.current) clearTimeout(splashTimerRef.current)
        splashTimerRef.current = setTimeout(() => setSplash(null), 1700)
      }
    })
    ch.on('broadcast', { event: 'action' }, ({ payload }) => {
      if (roomInfo.hostId !== myself.id) return
      hostApply(payload.playerId, payload.action)
    })
    ch.on('broadcast', { event: 'reject' }, ({ payload }) => {
      if (payload.playerId === myself.id) showToast(payload.msg)
    })
    ch.on('broadcast', { event: 'closed' }, () => {
      showToast('部屋が解散されました')
      leaveRoomRef.current?.()
    })
    ch.on('broadcast', { event: 'stamp' }, ({ payload }) => {
      const id = ++stampSeqRef.current
      setStamps((prev) => [...prev.slice(-4), { id, name: payload.name, text: payload.text }])
      setTimeout(() => setStamps((prev) => prev.filter((s) => s.id !== id)), 2600)
    })
    // ---- 部屋設定の同期 ----
    ch.on('broadcast', { event: 'settings' }, ({ payload }) => {
      settingsRef.current = payload.settings
      setSettings(payload.settings)
    })
    // ---- 賭けの供託フロー ----
    ch.on('broadcast', { event: 'betcall' }, async ({ payload }) => {
      if (!payload.humanIds.includes(myself.id)) return
      // 供託額はホストの申告ではなく「自分が画面で見ている設定値」を使う(額の偽装対策)
      const myBet = settingsRef.current.bet
      if (!myBet || myBet <= 0 || myBet !== payload.bet) {
        ch.send({ type: 'broadcast', event: 'betfail', payload: { playerId: myself.id, key: payload.key, msg: '賭け設定が一致しません' } })
        return
      }
      // 観戦者は供託しない(席に着いている人だけ)
      if (membersRef.current.find((m) => m.id === myself.id)?.spectator) {
        ch.send({ type: 'broadcast', event: 'betfail', payload: { playerId: myself.id, key: payload.key, msg: '観戦者は参加できません' } })
        return
      }
      setBetBusy(true)
      const res = await wagerJoin(payload.key, 'mahjong', myBet)
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
      await wagerReport(payload.key, null)
    })
    // リロード復帰者からの状態要求: 誰でも持っていれば現在のstateを返す(ホストのリロードにも対応)
    ch.on('broadcast', { event: 'statereq' }, () => {
      if (gameRef.current) {
        ch.send({ type: 'broadcast', event: 'state', payload: { seq: stateSeqRef.current, game: gameRef.current, events: [], wagerKey: wagerKeyRef.current, disconnected: [...autoRef.current] } })
      }
      ch.send({ type: 'broadcast', event: 'settings', payload: { settings: settingsRef.current } })
    })
    myJoinedAtRef.current = 0 // 新しい入室なので入室時刻をリセット(再接続時のみ保持される)
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // 再接続(SUBSCRIBEDは再購読でも発火)で席順が入れ替わらないよう初回の時刻を保持
        if (!myJoinedAtRef.current) myJoinedAtRef.current = Date.now()
        await ch.track({ name: myself.name, joinedAt: myJoinedAtRef.current, spectator: asSpectator })
        ch.send({ type: 'broadcast', event: 'statereq', payload: {} }) // リロード復帰時の状態再取得
      }
    })
    // リロードしても部屋に戻れるよう保存(明示退室/解散でクリア)
    try { sessionStorage.setItem('bf-mahjong-room', JSON.stringify({ roomInfo, spectator: asSpectator, settings: settingsRef.current })) } catch { /* 無視 */ }
    roomChRef.current = ch
    setRoom(roomInfo); roomRef.current = roomInfo
    setView('room')
    setGame(null); gameRef.current = null
    stateSeqRef.current = 0
    autoRef.current = new Set()
    wagerKeyRef.current = null
    betPendingRef.current = null
    setBetBusy(false)
    settingsRef.current = DEFAULT_SETTINGS
    setSettings(DEFAULT_SETTINGS)
    setLastResult(null)
  }, [hostApply, publishRoom]) // eslint-disable-line react-hooks/exhaustive-deps

  const leaveRoom = useCallback(() => {
    const r = roomRef.current
    if (r && r.hostId === meRef.current?.id) {
      roomChRef.current?.send({ type: 'broadcast', event: 'closed', payload: {} })
      lobbyChRef.current?.untrack()
    }
    if (roomChRef.current) { supabase.removeChannel(roomChRef.current); roomChRef.current = null }
    if (npcTimerRef.current) clearTimeout(npcTimerRef.current)
    if (deadlineTimerRef.current) clearTimeout(deadlineTimerRef.current)
    if (splashTimerRef.current) clearTimeout(splashTimerRef.current)
    pendingBroadcastRef.current = false
    setSplash(null)
    setRoom(null); roomRef.current = null
    setGame(null); gameRef.current = null
    setMembers([]); membersRef.current = []
    setNpcs([]); npcsRef.current = []
    setLastResult(null)
    setStamps([])
    wagerKeyRef.current = null
    betPendingRef.current = null
    setBetBusy(false)
    if (hostGraceRef.current) { clearTimeout(hostGraceRef.current); hostGraceRef.current = null }
    try { sessionStorage.removeItem('bf-mahjong-room') } catch { /* 無視 */ }
    setView('lobby')
  }, [])
  const leaveRoomRef = useRef(leaveRoom)
  useEffect(() => { leaveRoomRef.current = leaveRoom }, [leaveRoom])

  // ---- リロード復帰: 保存済みの部屋があれば自動で入り直す ----
  useEffect(() => {
    if (!me || roomRef.current) return
    try {
      const saved = JSON.parse(sessionStorage.getItem('bf-mahjong-room') || 'null')
      if (saved?.roomInfo) {
        joinRoom(saved.roomInfo, !!saved.spectator)
        if (saved.settings) { settingsRef.current = saved.settings; setSettings(saved.settings) }
      }
    } catch { /* 無視 */ }
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (roomChRef.current) supabase.removeChannel(roomChRef.current)
    if (lobbyChRef.current) supabase.removeChannel(lobbyChRef.current)
    if (npcTimerRef.current) clearTimeout(npcTimerRef.current)
    if (deadlineTimerRef.current) clearTimeout(deadlineTimerRef.current)
    if (hostGraceRef.current) clearTimeout(hostGraceRef.current)
    // 街へ戻る等のページ遷移では部屋の保存を消す(リロードではこのクリーンアップは走らないので残る)
    try { sessionStorage.removeItem('bf-mahjong-room') } catch { /* 無視 */ }
  }, [])

  const createRoom = () => {
    const title = roomTitle.trim() || `${me.name}の卓`
    const roomId = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 13)
    joinRoom({ id: roomId, title, hostId: me.id, hostName: me.name })
  }

  const seated = [...members.filter((m) => !m.spectator), ...npcs].slice(0, MAX_MAHJONG_PLAYERS)
  const addNpc = () => {
    if (membersRef.current.filter((m) => !m.spectator).length + npcsRef.current.length >= MAX_MAHJONG_PLAYERS) { showToast(`最大${MAX_MAHJONG_PLAYERS}人です`); return }
    const used = new Set(npcsRef.current.map((n) => n.name))
    const base = NPC_NAMES.find((n) => !used.has(`🀄${n}`)) || `NPC${npcsRef.current.length + 1}`
    setNpcs((prev) => [...prev, { id: `npc-lv3-${prev.length + 1}-${Date.now() % 100000}`, name: `🀄${base}` }])
  }
  const removeNpc = (id) => setNpcs((prev) => prev.filter((n) => n.id !== id))
  useEffect(() => {
    if (room && room.hostId === me?.id) publishRoom(game && game.phase !== 'ended' ? 'playing' : 'waiting')
  }, [npcs]) // eslint-disable-line react-hooks/exhaustive-deps

  const startGame = () => {
    const list = [...membersRef.current.filter((m) => !m.spectator), ...npcsRef.current].slice(0, MAX_MAHJONG_PLAYERS)
    if (list.length < MIN_MAHJONG_PLAYERS) { showToast(`麻雀は${MIN_MAHJONG_PLAYERS}人から。NPCを追加してください`); return }
    const order = list.map((p) => ({ id: p.id, name: p.name }))
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const s = settingsRef.current
    const actuallyStart = (wKey) => {
      wagerKeyRef.current = wKey
      hostBroadcast(createMahjongGame({ players: order, rules: s.rules }), [])
      publishRoom('playing')
    }
    // 賭けあり(人間2人以上)なら先に全員の供託を待つ
    const humans = order.filter((p) => !isNpcId(p.id)).map((p) => p.id)
    if (s.bet > 0 && humans.length >= 2) {
      const key = `${roomRef.current.id}:${Date.now()}`
      betPendingRef.current = { key, need: new Set(humans), ok: new Set(), start: actuallyStart }
      setBetBusy(true)
      roomChRef.current?.send({ type: 'broadcast', event: 'betcall', payload: { key, humanIds: humans, bet: s.bet } })
      setTimeout(() => {
        if (betPendingRef.current?.key === key) {
          betPendingRef.current = null
          roomChRef.current?.send({ type: 'broadcast', event: 'betabort', payload: { key, msg: '供託が揃いませんでした(対局中止)' } })
        }
      }, 15000)
    } else actuallyStart(null)
  }

  // ---- プレイ⇔観戦の切替 ----
  const setSpectatorMode = (next) => {
    roomChRef.current?.track({ name: meRef.current.name, joinedAt: myJoinedAtRef.current, spectator: next })
  }

  const sendAction = useCallback((action) => {
    roomChRef.current?.send({ type: 'broadcast', event: 'action', payload: { playerId: meRef.current.id, action } })
  }, [])

  // ---- スタンプ送信(1.5秒クールダウン) ----
  const sendStamp = useCallback((text) => {
    const now = Date.now()
    if (now - stampCdRef.current < 1500) return
    stampCdRef.current = now
    roomChRef.current?.send({ type: 'broadcast', event: 'stamp', payload: { name: meRef.current.name, text, senderId: meRef.current.id } })
  }, [])

  // ---- NPC/切断者の自動進行(ホスト) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game) return
    const isBot = (id) => isNpcId(id) || autoRef.current.has(id)
    let actorId = null
    if (game.phase === 'playing' && game.await?.type === 'turn') {
      const p = game.players[game.await.seat]
      if (isBot(p.id)) actorId = p.id
    } else if (game.phase === 'playing' && game.await?.type === 'claims') {
      const s = game.await.pending.find((x) => isBot(game.players[x].id))
      if (s !== undefined) actorId = game.players[s].id
    }
    if (!actorId) return
    const seq = stateSeqRef.current
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return
      const cur = gameRef.current
      if (!cur || cur.phase !== 'playing') return
      const seat = cur.players.findIndex((p) => p.id === actorId)
      // 切断者もNPCと同じ思考で代打ち(復帰したら操作権が戻る)
      const action = npcDecide(cur, seat) || autoActionFor(cur, seat)
      if (action) hostApply(actorId, action)
      // 反応時間をランダム化(鳴き判断の有無を時間で悟られないように)
    }, game.await.type === 'claims' ? 600 + Math.random() * 1100 : 800 + Math.random() * 800)
    npcTimerRef.current = t
    return () => clearTimeout(t)
  }, [game, room, me, hostApply])

  // ---- タイムアウト監視(ホスト) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.phase !== 'playing' || !game.await?.deadline) return
    const wait = Math.max(0, game.await.deadline - Date.now())
    const seq = stateSeqRef.current
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return
      const cur = gameRef.current
      if (!cur || cur.phase !== 'playing' || !cur.await) return
      if (cur.await.type === 'turn') {
        const p = cur.players[cur.await.seat]
        const opts = getTurnOptions(cur, cur.await.seat)
        // リーチ済みでツモれるなら自動ツモ、それ以外はツモ切り
        const action = (cur.riichis[cur.await.seat] && opts?.canTsumo) ? { type: 'tsumo' } : autoActionFor(cur, cur.await.seat)
        if (action) hostApply(p.id, action)
      } else if (cur.await.type === 'claims') {
        const s = cur.await.pending[0]
        if (s !== undefined) hostApply(cur.players[s].id, { type: 'pass' })
      }
    }, wait + 400)
    deadlineTimerRef.current = t
    return () => clearTimeout(t)
  }, [game, room, me, hostApply])

  // 残り秒表示
  useEffect(() => {
    if (!game?.await?.deadline) return
    const iv = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [game])

  // ============================================================
  // 描画
  // ============================================================
  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#0a1a0f', color: '#88ccff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>読み込み中…</div>
  }
  const wrap = (children) => (
    <div style={{ minHeight: '100vh', background: '#0a1a0f', color: '#cde', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px' }}>
      <style>{`
        @keyframes mjsplash { 0% { transform: scale(2.4); opacity: 0 } 18% { transform: scale(1); opacity: 1 } 78% { opacity: 1 } 100% { opacity: 0 } }
        @keyframes mjpulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255, 204, 68, 0.75) } 50% { box-shadow: 0 0 0 10px rgba(255, 204, 68, 0) } }
      `}</style>
      {children}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#112244', border: '1px solid #4488cc', color: '#cde', padding: '8px 16px', fontSize: 12, zIndex: 50 }}>{toast}</div>
      )}
      {splash && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 70 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 4, maxWidth: '96vw',
            fontFamily: "'Hiragino Mincho ProN','Yu Mincho',serif", fontWeight: 'bold',
            animation: 'mjsplash 1.7s ease-out both',
          }}>
            <span style={{ fontSize: 30, color: '#ffcc44', textShadow: '0 0 12px rgba(0,0,0,0.9), 2px 2px 0 #553300' }}>{splash.name}が</span>
            <span style={{ fontSize: 66, color: '#ff4422', textShadow: '0 0 24px rgba(0,0,0,0.9), 3px 3px 0 #550000, -2px -2px 0 #ffcc44' }}>{splash.what}！</span>
          </div>
        </div>
      )}
    </div>
  )

  // ---- ロビー ----
  if (view === 'lobby') {
    return wrap(
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <button onClick={() => nav('/game')} style={btnStyle('#88ccff')}>← 街に戻る</button>
          <div style={{ color: '#ffcc44', fontSize: 14 }}>🀄 麻雀</div>
          <div style={{ width: 76 }} />
        </div>
        <div style={{ border: '1px solid #224466', padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#88ccff', marginBottom: 8 }}>卓を立てる</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} maxLength={20}
              placeholder={`${me.name}の卓`}
              style={{ flex: 1, background: '#001122', border: '1px solid #224466', color: '#cde', padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}
            />
            <button onClick={createRoom} style={btnStyle('#ffcc44')}>作成</button>
          </div>
          <div style={{ fontSize: 10, color: '#668', marginTop: 6 }}>4人=東風戦 / 3人=サンマ東風戦(2〜8萬なし・北抜きドラ・ツモ損)。赤5あり・NPC可</div>
        </div>
        <div style={{ fontSize: 12, color: '#88ccff', marginBottom: 8 }}>卓一覧</div>
        {rooms.length === 0 && <div style={{ fontSize: 12, color: '#668' }}>現在開いている卓はありません</div>}
        {rooms.map((r) => (
          <div key={r.roomId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #224466', padding: '10px 12px', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13 }}>{r.title}</div>
              <div style={{ fontSize: 10, color: '#668' }}>
                主: {r.hostName} / {r.count}人 / {r.status === 'playing' ? '🟢 対局中(観戦可)' : '🟡 募集中'}
                <span style={{ color: '#aa88cc' }}> / {r.hanchan ? '半荘' : '東風'}</span>
                {r.bet > 0 && <span style={{ color: '#ffaa00' }}> / 💰{Number(r.bet).toLocaleString()}G</span>}
              </div>
            </div>
            {r.status === 'playing' ? (
              <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName })} style={btnStyle('#88ccff')}>観戦入室</button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName })} style={btnStyle('#44dd88')}>プレイ</button>
                <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName }, true)} style={btnStyle('#88ccff')}>観戦</button>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // ---- 部屋 ----
  const isHost = room?.hostId === me?.id
  const mySeat = game ? game.players.findIndex((p) => p.id === me.id) : -1
  const isSpectator = game && mySeat === -1
  const playing = game?.phase === 'playing'
  const turnOpts = playing && mySeat >= 0 ? getTurnOptions(game, mySeat) : null
  const claimOpts = playing && mySeat >= 0 ? getClaimOptions(game, mySeat) : null
  const myTurn = !!turnOpts
  const remain = game?.await?.deadline ? Math.max(0, Math.ceil((game.await.deadline - Date.now()) / 1000)) : null

  // 待機画面
  if (!game) {
    return wrap(
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={leaveRoom} style={btnStyle('#88ccff')}>← 退室</button>
          <div style={{ color: '#ffcc44', fontSize: 13 }}>{room.title}</div>
          {isHost
            ? <button onClick={startGame} disabled={betBusy} style={btnStyle(betBusy ? '#446' : '#ffcc44', { opacity: betBusy ? 0.5 : 1 })}>{betBusy ? '供託待ち…' : '対局開始'}</button>
            : <div style={{ width: 60 }} />}
        </div>
        {/* ゲーム設定(ホストが変更・全員へ同期) */}
        <div style={{ border: '1px solid #224466', padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>
          <div style={{ color: '#88ccff', marginBottom: 6 }}>ゲーム設定{!isHost && '(ホストが変更できます)'}</div>
          {isHost ? (
            <>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                {[[false, '東風戦'], [true, '半荘戦']].map(([v, label]) => (
                  <button key={label} onClick={() => updateSettings({ rules: { ...settings.rules, hanchan: v } })}
                    style={btnStyle(!!settings.rules.hanchan === v ? '#ffcc44' : '#446688', { fontSize: 11, background: !!settings.rules.hanchan === v ? 'rgba(255,204,68,0.1)' : 'none' })}>
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                {[['kuikae', '喰い替え許可'], ['agariyame', 'アガリやめ'], ['nagashi', '流し満貫'], ['uma', 'ウマ・オカ'], ['tochu', '途中流局']].map(([k, label]) => {
                  const on = k === 'kuikae' ? !!settings.rules.kuikae : settings.rules[k] !== false
                  return (
                    <button key={k} onClick={() => updateSettings({ rules: { ...settings.rules, [k]: !on } })}
                      style={btnStyle(on ? '#ffcc44' : '#446688', { fontSize: 11, background: on ? 'rgba(255,204,68,0.1)' : 'none' })}>
                      {on ? '✓ ' : ''}{label}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#ffaa00' }}>💰</span>
                {BET_PRESETS.map((b) => (
                  <button key={b} onClick={() => updateSettings({ bet: b })}
                    style={btnStyle(Number(settings.bet) === b ? '#ffcc44' : '#446688', { fontSize: 11 })}>
                    {b === 0 ? '賭けなし' : `${b.toLocaleString()}G`}
                  </button>
                ))}
                <input type="number" value={settings.bet} min={0} max={MAX_BET}
                  onChange={(e) => updateSettings({ bet: Math.max(0, Math.min(MAX_BET, Math.floor(Number(e.target.value) || 0))) })}
                  style={{ width: 90, background: '#001122', border: '1px solid #224466', color: '#ffaa00', padding: '4px 6px', fontFamily: 'monospace', fontSize: 11 }} />
              </div>
              <div style={{ fontSize: 9, color: '#668', marginTop: 4 }}>賭けは人間2人以上で成立・最終順位で分配(1位60%以上)・NPC勝ち/引き分けは返金</div>
            </>
          ) : (
            <div style={{ fontSize: 12 }}>
              <span style={{ color: '#ffcc44' }}>{settings.rules.hanchan ? '半荘戦' : '東風戦'}</span>
              <span style={{ color: '#aa88cc', marginLeft: 8 }}>
                {[settings.rules.kuikae && '喰い替え可', settings.rules.agariyame !== false && 'アガリやめ', settings.rules.nagashi !== false && '流し満貫', settings.rules.uma !== false && 'ウマ', settings.rules.tochu !== false && '途中流局'].filter(Boolean).join('/')}
              </span>
              <span style={{ color: '#ffaa00', marginLeft: 8 }}>{settings.bet > 0 ? `💰${Number(settings.bet).toLocaleString()}G` : '賭けなし'}</span>
            </div>
          )}
        </div>
        <div style={{ border: '1px solid #224466', padding: '8px 12px', fontSize: 12 }}>
          {settings.bet > 0 && (
            <div style={{ border: '1px solid #8a6a22', background: 'rgba(255,170,0,0.08)', padding: '4px 8px', marginBottom: 6, color: '#ffaa00', fontSize: 11 }}>
              💰 賭け対局: 1人 {Number(settings.bet).toLocaleString()}G
            </div>
          )}
          {lastResult && (
            <div style={{ border: '1px solid #665522', background: 'rgba(255,204,68,0.07)', padding: '4px 8px', marginBottom: 6, color: '#ffcc44', fontSize: 11 }}>
              前回の結果: {lastResult}
            </div>
          )}
          <div style={{ color: '#88ccff', marginBottom: 4 }}>対局者(3人=サンマ / 4人=四麻)</div>
          {seated.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{i + 1}. {p.name}{p.id === room.hostId ? ' (ホスト)' : ''}</span>
              {isHost && isNpcId(p.id) && <button onClick={() => removeNpc(p.id)} style={btnStyle('#ff6644', { padding: '1px 6px', fontSize: 10 })}>削除</button>}
            </div>
          ))}
          {seated.length < MAX_MAHJONG_PLAYERS && <div style={{ color: '#668' }}>{seated.length + 1}. 募集中…</div>}
          {isHost && seated.length < MAX_MAHJONG_PLAYERS && (
            <button onClick={addNpc} style={btnStyle('#44dd88', { marginTop: 6, padding: '2px 8px', fontSize: 11 })}>+ NPC追加</button>
          )}
          {(() => {
            const specs = members.filter((m) => !seated.some((s) => s.id === m.id))
            if (specs.length === 0) return null
            return <div style={{ color: '#668', marginTop: 4 }}>▼ 観戦者: {specs.map((m) => m.name).join('　')}</div>
          })()}
          {(() => {
            const meSpec = !!members.find((m) => m.id === me.id)?.spectator
            return (
              <button onClick={() => setSpectatorMode(!meSpec)} style={btnStyle(meSpec ? '#44dd88' : '#88ccff', { marginTop: 8, padding: '4px 10px', fontSize: 11 })}>
                {meSpec ? '⚔ 対局に参加する' : '👀 観戦にまわる'}
              </button>
            )
          })()}
        </div>
        <StampBar spectator={!seated.some((s) => s.id === me.id)} players={seated} onSend={sendStamp} />
        <StampOverlay stamps={stamps} bottom={150} />
      </div>
    )
  }

  // ---- 対局画面 ----
  const n = game.players.length
  const dora = game.doraTiles.slice(0, game.doraRevealed)
  const doraSet = new Set(dora.map(doraFromIndicator))
  const isGlow = (k, r) => r || doraSet.has(k)
  const windOf = (seat) => WINDS[(seat - game.round.dealer + n) % n]

  // ---- 待ち牌計算(自分用) ----
  const tileCounts = (tiles) => { const c = new Array(34).fill(0); for (const t of tiles) c[t.k]++; return c }
  const myHand = mySeat >= 0 ? game.hands[mySeat] : []
  const myDrawn = game.drawn && game.drawnBy === mySeat ? game.drawn : null
  const myHand14 = myDrawn ? [...myHand, myDrawn] : myHand
  // 13枚形(相手の番)ならそのまま待ちを表示
  const myWaits = (playing && mySeat >= 0 && !myTurn && myHand.length % 3 === 1)
    ? waitsOf(tileCounts(myHand), game.melds[mySeat].length, game.sanma)
    : []
  // 14枚形(打牌前)なら「切ると待ちになる牌」を計算
  const discardWaits = {} // kind -> waits[]
  if (playing && myTurn && myHand14.length % 3 === 2 && !game.riichis[mySeat]) {
    const seen = new Set()
    for (const t of myHand14) {
      if (seen.has(t.k)) continue
      seen.add(t.k)
      const c = tileCounts(myHand14); c[t.k]--
      const w = waitsOf(c, game.melds[mySeat].length, game.sanma)
      if (w.length > 0) discardWaits[t.k] = w
    }
  }

  const renderPlayerRow = (seat) => {
    const p = game.players[seat]
    const isTurnSeat = playing && ((game.await?.type === 'turn' && game.await.seat === seat) || (game.await?.type === 'claims' && game.await.pending.includes(seat)))
    const riichi = game.riichis[seat]
    return (
      <div key={seat} style={{ border: `1px solid ${isTurnSeat ? '#ffcc44' : '#224433'}`, padding: '6px 8px', marginBottom: 6, background: seat === mySeat ? '#0d2417' : 'transparent' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
          <span style={{ color: '#ffcc44' }}>{windOf(seat)}</span>
          <span style={{ color: isTurnSeat ? '#ffcc44' : '#cde' }}>{p.name}{seat === mySeat ? '(あなた)' : ''}</span>
          <span style={{ color: '#88ccff' }}>{p.score}点</span>
          {riichi && <span style={{ color: '#ff6644' }}>リーチ{riichi.ippatsu ? '(一発)' : ''}</span>}
          {game.sanma && game.kitaCounts[seat] > 0 && <span style={{ color: '#dd88ff' }}>北×{game.kitaCounts[seat]}</span>}
          {isTurnSeat && remain !== null && <span style={{ color: '#ff8866' }}>⏱{remain}</span>}
        </div>
        {/* 河と鳴きを明確に分離 */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'stretch' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.25)', border: '1px dashed #2a4a3a', borderRadius: 4, padding: '3px 4px' }}>
            <div style={{ fontSize: 9, color: '#5a7a6a', marginBottom: 2 }}>捨て牌</div>
            <div style={{ display: 'flex', gap: 1, flexWrap: 'wrap', minHeight: 32 }}>
              {game.discards[seat].map((d, i) => (
                <span key={i} style={{ transform: d.riichi ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>
                  <Tile k={d.k} r={d.r} small dim={d.called} glow={isGlow(d.k, d.r)} />
                </span>
              ))}
            </div>
          </div>
          {game.melds[seat].length > 0 && (
            <div style={{ background: 'rgba(255,204,68,0.08)', border: '1px solid #8a7a33', borderRadius: 4, padding: '3px 5px' }}>
              <div style={{ fontSize: 9, color: '#ccaa44', marginBottom: 2 }}>鳴き(ポン/チー/カン)</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {game.melds[seat].map((m, i) => (
                  <span key={i} style={{ display: 'inline-flex', gap: 1 }}>
                    {m.type === 'ankan'
                      ? (<><TileBack small /><Tile k={m.k} small glow={isGlow(m.k, false)} /><Tile k={m.k} small glow={isGlow(m.k, false)} /><TileBack small /></>)
                      : m.tiles.map((t, j) => <Tile key={j} k={t.k} r={t.r} small glow={isGlow(t.k, t.r)} />)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 自分の操作ボタン
  const actionButtons = []
  if (turnOpts) {
    if (turnOpts.canTsumo) actionButtons.push(<button key="tsumo" onClick={() => sendAction({ type: 'tsumo' })} style={btnStyle('#ff6644', { fontSize: 14 })}>ツモ！</button>)
    if (turnOpts.riichiTiles.length > 0 && !riichiMode) actionButtons.push(<button key="riichi" onClick={() => setRiichiMode(true)} style={btnStyle('#ffcc44', { fontSize: 14 })}>リーチ</button>)
    if (riichiMode) actionButtons.push(<button key="riichi-c" onClick={() => setRiichiMode(false)} style={btnStyle('#668')}>リーチ取消</button>)
    if (turnOpts.kans.length > 0) {
      actionButtons.push(<button key="kan" onClick={() => {
        if (turnOpts.kans.length === 1) sendAction({ type: 'kan', kanType: turnOpts.kans[0].kanType, kind: turnOpts.kans[0].kind })
        else setKanPick(turnOpts.kans)
      }} style={btnStyle('#44dd88', { fontSize: 14 })}>カン</button>)
    }
    if (turnOpts.canKita) actionButtons.push(<button key="kita" onClick={() => sendAction({ type: 'kita' })} style={btnStyle('#dd88ff', { fontSize: 14 })}>北抜き</button>)
    if (turnOpts.canKyuushu) actionButtons.push(<button key="kyuushu" onClick={() => sendAction({ type: 'kyuushu' })} style={btnStyle('#88ccff', { fontSize: 14 })}>九種九牌</button>)
  }
  // 鳴き/ロンの反応は目立つ専用パネルに出す
  const claimButtons = []
  if (claimOpts) {
    const big = (color) => btnStyle(color, { fontSize: 18, padding: '10px 18px', fontWeight: 'bold', background: '#1a0f00', whiteSpace: 'nowrap', flexShrink: 0 })
    if (claimOpts.canRon) claimButtons.push(<button key="ron" onClick={() => sendAction({ type: 'ron' })} style={big('#ff4422')}>ロン！</button>)
    if (claimOpts.canPon) claimButtons.push(<button key="pon" onClick={() => sendAction({ type: 'pon' })} style={big('#44dd88')}>ポン</button>)
    if (claimOpts.canMinkan) claimButtons.push(<button key="mkan" onClick={() => sendAction({ type: 'minkan' })} style={big('#44dd88')}>カン</button>)
    if (claimOpts.chis.length > 0) {
      claimButtons.push(<button key="chi" onClick={() => {
        if (claimOpts.chis.length === 1) sendAction({ type: 'chi', chi: claimOpts.chis[0] })
        else setChiPick(claimOpts.chis)
      }} style={big('#44dd88')}>チー</button>)
    }
    if (claimButtons.length > 0) {
      claimButtons.push(<button key="pass" onClick={() => sendAction({ type: 'pass' })} style={btnStyle('#99a', { fontSize: 14, padding: '10px 14px', background: '#1a0f00', whiteSpace: 'nowrap', flexShrink: 0 })}>スルー</button>)
    }
  }

  const riichiDiscardable = (k) => !riichiMode || turnOpts?.riichiTiles.includes(k)
  const onTileClick = (t) => {
    if (!turnOpts) return
    if (game.riichis[mySeat]) {
      // リーチ中はツモ切りのみ(ツモ牌クリック)
      if (game.drawn && t.id === game.drawn.id) sendAction({ type: 'discard', tileId: t.id })
      return
    }
    if (riichiMode) {
      if (turnOpts.riichiTiles.includes(t.k)) sendAction({ type: 'riichi', tileId: t.id })
      return
    }
    sendAction({ type: 'discard', tileId: t.id })
  }

  return wrap(
    <div style={{ width: '100%', maxWidth: 560 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <button onClick={leaveRoom} style={btnStyle('#88ccff')}>← 退室</button>
        <div style={{ fontSize: 12, color: '#ffcc44' }}>
          {WINDS[game.round.wind || 0]}{game.round.num}局 {game.round.honba > 0 ? `${game.round.honba}本場` : ''} 供託{game.round.sticks}
          {wagerKeyRef.current && settings.bet > 0 && <span style={{ color: '#ffaa00', marginLeft: 6 }}>💰{Number(settings.bet).toLocaleString()}G</span>}
        </div>
        <div style={{ fontSize: 11, color: '#668' }}>山 {game.wall.length}枚</div>
      </div>

      {/* ドラ表示 */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8, fontSize: 11 }}>
        <span style={{ color: '#88ccff' }}>ドラ表示:</span>
        {dora.map((k, i) => <Tile key={i} k={k} small />)}
        <span style={{ color: '#668', marginLeft: 6 }}>(ドラ: {dora.map((k) => KIND_NAMES[doraFromIndicator(k)]).join(' ')})</span>
      </div>

      {/* ターンバナー */}
      {playing && game.await?.type === 'turn' && game.players[game.await.seat] && (
        <div style={{
          textAlign: 'center', fontSize: 14, fontWeight: 'bold', width: '100%',
          color: game.await.seat === mySeat ? '#ffcc44' : '#88ccff',
          background: game.await.seat === mySeat ? 'rgba(255,204,68,0.12)' : 'rgba(68,136,204,0.08)',
          border: `1px solid ${game.await.seat === mySeat ? '#8a7a33' : '#335577'}`,
          borderRadius: 8, padding: '4px 0', margin: '2px 0 8px',
        }}>
          ▶ {game.await.seat === mySeat ? 'あなた' : game.players[game.await.seat].name}のターン
        </div>
      )}

      {/* 各家 */}
      {game.players.map((_, s) => (s !== mySeat ? renderPlayerRow(s) : null))}
      {mySeat >= 0 && renderPlayerRow(mySeat)}

      {/* 自分の手牌 */}
      {mySeat >= 0 && game.phase !== 'ended' && (
        <div style={{ marginTop: 8 }}>
          {/* 待ち表示: ホバー中はその牌を切った時の待ち / 13枚テンパイ時は現在の待ち */}
          {(hoverWait || myWaits.length > 0) && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6, fontSize: 12, background: 'rgba(255,204,68,0.1)', border: '1px solid #8a7a33', borderRadius: 4, padding: '4px 8px', flexWrap: 'wrap' }}>
              {hoverWait
                ? <span style={{ color: '#ffcc44' }}>{KIND_NAMES[hoverWait.k]}切り → 待ち:</span>
                : <span style={{ color: '#ff6644', fontWeight: 'bold' }}>テンパイ！待ち:</span>}
              {(hoverWait ? hoverWait.waits : myWaits).map((k) => <Tile key={k} k={k} small glow={isGlow(k, false)} />)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {game.hands[mySeat].map((t) => (
              <span key={t.id} style={{ position: 'relative', display: 'inline-flex' }}
                onMouseEnter={discardWaits[t.k] ? () => setHoverWait({ k: t.k, waits: discardWaits[t.k] }) : undefined}
                onMouseLeave={() => setHoverWait(null)}
              >
                <Tile k={t.k} r={t.r} glow={isGlow(t.k, t.r)}
                  onClick={myTurn ? () => onTileClick(t) : undefined}
                  disabled={!!game.riichis[mySeat] || (riichiMode && !riichiDiscardable(t.k))}
                  dim={riichiMode && !riichiDiscardable(t.k)}
                />
                {discardWaits[t.k] && <span style={{ position: 'absolute', top: -4, right: -2, width: 8, height: 8, borderRadius: '50%', background: '#44ff88', boxShadow: '0 0 4px #44ff88', pointerEvents: 'none' }} />}
              </span>
            ))}
            {game.drawn && game.drawnBy === mySeat && (
              <span
                style={{ marginLeft: 10, border: '2px solid #ffcc44', borderRadius: 6, padding: 2, boxShadow: '0 0 8px rgba(255,204,68,0.5)', position: 'relative', display: 'inline-flex' }}
                onMouseEnter={discardWaits[game.drawn.k] ? () => setHoverWait({ k: game.drawn.k, waits: discardWaits[game.drawn.k] }) : undefined}
                onMouseLeave={() => setHoverWait(null)}
              >
                <Tile k={game.drawn.k} r={game.drawn.r} glow={isGlow(game.drawn.k, game.drawn.r)}
                  onClick={myTurn ? () => onTileClick(game.drawn) : undefined}
                  dim={riichiMode && !riichiDiscardable(game.drawn.k)}
                />
                {discardWaits[game.drawn.k] && <span style={{ position: 'absolute', top: -6, right: -4, width: 8, height: 8, borderRadius: '50%', background: '#44ff88', boxShadow: '0 0 4px #44ff88', pointerEvents: 'none' }} />}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', minHeight: 34 }}>
            {actionButtons}
            {myTurn && !game.riichis[mySeat] && !riichiMode && <span style={{ fontSize: 11, color: '#9fd', alignSelf: 'center' }}>捨てる牌をタップ</span>}
            {riichiMode && <span style={{ fontSize: 11, color: '#ffcc44', alignSelf: 'center' }}>リーチ宣言牌をタップ</span>}
          </div>
        </div>
      )}
      {isSpectator && <div style={{ color: '#668', fontSize: 12, marginTop: 6 }}>👀 観戦中</div>}

      {/* 鳴き/ロン反応パネル(目立つ・点滅) */}
      {claimButtons.length > 0 && !chiPick && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          background: '#1a0f00', border: '2px solid #ffcc44', borderRadius: 8,
          padding: '12px 16px', zIndex: 45, display: 'flex', gap: 10, alignItems: 'center',
          animation: 'mjpulse 1.1s infinite', whiteSpace: 'nowrap', maxWidth: '96vw', overflowX: 'auto',
        }}>
          <span style={{ color: '#ffcc44', fontSize: 15, fontWeight: 'bold', flexShrink: 0 }}>⏱{remain}</span>
          {/* 対象の牌(誰が何を捨てたか) */}
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: '#cde' }}>{game.players[game.await.fromSeat]?.name}{game.await.chankan ? 'の加槓' : 'の捨て牌'}</span>
            <Tile k={game.await.tileKind} r={game.await.tileRed} />
          </span>
          {claimButtons}
        </div>
      )}

      {/* チー/カン候補選択 */}
      {chiPick && (
        <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: '#112233', border: '1px solid #4488cc', padding: 12, zIndex: 40, display: 'flex', gap: 12 }}>
          {chiPick.map((c, i) => (
            <button key={i} onClick={() => { sendAction({ type: 'chi', chi: c }); setChiPick(null) }} style={btnStyle('#44dd88', { display: 'flex', gap: 2 })}>
              <Tile k={c[0]} small /><Tile k={c[1]} small />
            </button>
          ))}
          <button onClick={() => setChiPick(null)} style={btnStyle('#668')}>×</button>
        </div>
      )}
      {kanPick && (
        <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: '#112233', border: '1px solid #4488cc', padding: 12, zIndex: 40, display: 'flex', gap: 12 }}>
          {kanPick.map((k, i) => (
            <button key={i} onClick={() => { sendAction({ type: 'kan', kanType: k.kanType, kind: k.kind }); setKanPick(null) }} style={btnStyle('#44dd88')}>
              {KIND_NAMES[k.kind]}{k.kanType === 'ankan' ? '(暗槓)' : '(加槓)'}
            </button>
          ))}
          <button onClick={() => setKanPick(null)} style={btnStyle('#668')}>×</button>
        </div>
      )}

      {/* 観戦者一覧 */}
      {(() => {
        const seatedIds = new Set(game.players.map((p) => p.id))
        const specs = members.filter((m) => !seatedIds.has(m.id))
        if (specs.length === 0) return null
        return (
          <div style={{ marginTop: 10, fontSize: 12, textAlign: 'center', width: '100%' }}>
            <div style={{ color: '#668', marginBottom: 2 }}>▼ 観戦者</div>
            <div style={{ color: '#88ccff' }}>{specs.map((s) => s.name).join('　')}</div>
          </div>
        )
      })()}

      {/* スタンプ(観戦者は応援カテゴリ付き) */}
      <StampBar spectator={mySeat === -1} players={game.players.map((p) => ({ id: p.id, name: p.name }))} onSend={sendStamp} />
      <StampOverlay stamps={stamps} bottom={150} />

      {/* 局結果 */}
      {game.phase === 'roundEnd' && game.roundResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div style={{ background: '#0d2417', border: '2px solid #ffcc44', padding: 16, maxWidth: 500, width: '92%', maxHeight: '85vh', overflowY: 'auto' }}>
            {game.roundResult.type === 'win' ? (
              game.roundResult.results.map((w, i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  <div style={{ color: '#ffcc44', fontSize: 15, marginBottom: 6 }}>
                    {w.name} {w.tsumo ? 'ツモ' : 'ロン'}和了！ {w.rank && <span style={{ color: '#ff6644' }}>{w.rank}</span>} +{w.gain}点
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 6 }}>
                    {w.hand.map((t, j) => <Tile key={j} k={t.k} r={t.r} small />)}
                    <span style={{ margin: '0 4px', color: '#ffcc44' }}>+</span>
                    <Tile k={w.winTile.k} r={w.winTile.r} small sel />
                    {w.melds.map((m, j) => (
                      <span key={j} style={{ marginLeft: 6, display: 'inline-flex', gap: 1 }}>
                        {m.tiles.map((t, x) => <Tile key={x} k={t.k} r={t.r} small />)}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: '#cde' }}>
                    {w.yakuman > 0
                      ? w.yaku.map((y, j) => <div key={j} style={{ color: '#ff6644' }}>{y[0]}</div>)
                      : (<>
                        {w.yaku.map((y, j) => <div key={j}>{y[0]} {y[1]}翻</div>)}
                        {w.dora > 0 && <div>ドラ {w.dora}翻</div>}
                        <div style={{ color: '#ffcc44', marginTop: 4 }}>{w.totalHan}翻 {w.fu}符</div>
                      </>)}
                    {w.ura.length > 0 && (
                      <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginTop: 4 }}>
                        <span>裏ドラ表示:</span>{w.ura.map((k, j) => <Tile key={j} k={k} small />)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div>
                {game.roundResult.type === 'abort' ? (
                  <>
                    <div style={{ color: '#ff8866', fontSize: 15, marginBottom: 8 }}>途中流局({game.roundResult.label})</div>
                    <div style={{ fontSize: 11, color: '#668' }}>点棒の移動なし・親は流れません(本場+1)</div>
                  </>
                ) : game.roundResult.type === 'nagashi' ? (
                  <>
                    <div style={{ color: '#ffcc44', fontSize: 15, marginBottom: 8 }}>🎊 流し満貫</div>
                    {game.roundResult.results.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>{r.name}: +{r.gain}点</div>
                    ))}
                  </>
                ) : (
                  <>
                    <div style={{ color: '#ffcc44', fontSize: 15, marginBottom: 8 }}>流局</div>
                    {game.players.map((p, s) => (
                      <div key={s} style={{ fontSize: 12, marginBottom: 4 }}>
                        {p.name}: {game.roundResult.tenpai?.[s] ? <span style={{ color: '#44dd88' }}>テンパイ</span> : <span style={{ color: '#668' }}>ノーテン</span>}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#88ccff', marginTop: 8 }}>
              {game.players.map((p, s) => <div key={s}>{p.name}: {p.score}点</div>)}
            </div>
            {/* 局送りは対局者なら誰でも(ホストが観戦中でも進行が止まらないように) */}
            {mySeat >= 0 && (
              <button onClick={() => sendAction({ type: 'next' })} style={btnStyle('#ffcc44', { marginTop: 12, fontSize: 14 })}>
                {game.roundResult.gameOver ? '最終結果へ' : '次の局へ'}
              </button>
            )}
            {mySeat === -1 && <div style={{ fontSize: 11, color: '#668', marginTop: 10 }}>対局者の進行を待っています…</div>}
          </div>
        </div>
      )}

      {/* 最終結果 */}
      {game.phase === 'ended' && game.finalStandings && (
        <div style={{ border: '1px solid #ffcc44', padding: 12, marginTop: 10 }}>
          <div style={{ color: '#ffcc44', fontSize: 14, marginBottom: 8 }}>最終結果</div>
          {game.finalStandings.map((s, i) => (
            <div key={s.seat} style={{ fontSize: 13, color: rankColor(i + 1) }}>
              {i + 1}位 {s.name}: {s.score}点
              {s.pt !== undefined && <span style={{ color: s.pt >= 0 ? '#44dd88' : '#ff8866', marginLeft: 8 }}>{s.pt >= 0 ? '+' : ''}{s.pt}pt</span>}
            </div>
          ))}
          {isHost && <button onClick={startGame} style={btnStyle('#ffcc44', { marginTop: 10 })}>もう一局</button>}
        </div>
      )}
    </div>
  )
}
