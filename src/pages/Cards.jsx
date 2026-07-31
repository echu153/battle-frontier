import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import {
  GAME_DEFS, GAME_HELP, playersLabel, TURN_SEC_TRUMP, isRed, isNpcId, randomTrump,
  createTrumpGame, applyTrump, npcTrump, autoTrump, trumpWinnerId, dfMatchStandings,
  sevensPlayable, speedCanAnyPlay, dfSetStrength, SUIT_LABEL, RANK_LABEL,
} from '../lib/trump'
import { wagerJoin, wagerReport, wagerForfeit, wagerPing, wagerSettleRanked, MAX_BET } from '../lib/wager'
import { StampBar, StampOverlay } from '../components/StampBar'
import { RoomChat } from '../components/RoomChat'
import { InvitePanel } from '../components/InvitePanel'
import { FinalResult } from '../components/FinalResult'
import { containsNgWord } from '../lib/nameFilter'
import { publishRoomDb, closeRoomDb, listRoomsDb, mergeRooms } from '../lib/gameRooms'

// ============================================================
// トランプ広場 — 開発限定(大富豪/スピード/7ならべ/ババ抜き)
// 部屋: Supabase Realtime presence(ロビー) + broadcast(同期)・ホスト権威型・SQL不要
// Gold賭け(任意): supabase_game_wager.sql の供託/過半数一致精算を使用
// ============================================================

// 切断とみなすまでの猶予。スマホで画面を離れても1分程度は部屋が保たれるようにする
const DISCONNECT_GRACE = 75000
const LOBBY_CHANNEL = 'trump-lobby'
const roomChannelName = (roomId) => `trump-room-${roomId}`
const NPC_NAMES = ['トラン子', 'カード丸', 'ジョー化', 'スペ太', 'ハート美']
const BET_PRESETS = [0, 100, 1000, 10000, 100000]

const btnStyle = (color, extra = {}) => ({
  background: 'none', border: `1px solid ${color}`, color, padding: '6px 10px',
  cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'nowrap', ...extra,
})

// ---- カード表示 ----
function TCard({ c, small, sel, dim, onClick }) {
  const w = small ? 26 : 38, h = small ? 36 : 54
  const color = c.joker ? '#8833cc' : isRed(c) ? '#cc2233' : '#222a33'
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        width: w, height: h, padding: 0, borderRadius: 4,
        background: '#faf7ef', border: sel ? '2px solid #ffcc44' : '1px solid #998',
        color, fontFamily: 'monospace', fontWeight: 'bold', fontSize: small ? 10 : 13,
        cursor: onClick ? 'pointer' : 'default', opacity: dim ? 0.4 : 1,
        display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        transform: sel ? 'translateY(-5px)' : 'none', lineHeight: 1.1,
      }}
    >
      {c.joker ? <span style={{ fontSize: small ? 8 : 10 }}>JOKER</span> : (<>
        <span>{SUIT_LABEL[c.s]}</span>
        <span>{RANK_LABEL[c.r - 1]}</span>
      </>)}
    </button>
  )
}
function TBack({ small, onClick }) {
  const w = small ? 26 : 38, h = small ? 36 : 54
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      width: w, height: h, padding: 0, borderRadius: 4, background: '#2c5f8a',
      border: '1px solid #1a3a55', cursor: onClick ? 'pointer' : 'default', display: 'inline-flex',
    }} />
  )
}

export default function Cards() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState('lobby')
  const [rooms, setRooms] = useState([])
  const [lobbyNonce, setLobbyNonce] = useState(0) // 🔄でロビーを購読し直して一覧を引き直す
  const [dbRooms, setDbRooms] = useState([])      // DBに保存された部屋(presenceの取りこぼし対策)
  const [roomTitle, setRoomTitle] = useState('')
  // 部屋の設定はホストが入室後に決める(全員へbroadcast同期)
  // 大富豪のルールは既定で全部ON(ホストが個別にOFFにできる)
  const DEFAULT_SETTINGS = { gameType: 'daifugo', rules: { kakumei: true, spade3: true, kaidan: true, shibari: true, miyako: true }, bet: 0, matchLen: 3 }
  const DF_MATCH_PTS = [4, 2, 1, 0] // 大富豪マッチ: 順位ごとの獲得pt(1位→4位)
  const rankColor = (r) => (r === 1 ? '#ffcc44' : r === 2 ? '#c8d2e0' : r === 3 ? '#cc8850' : '#7788aa') // 金/銀/銅/灰
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const settingsRef = useRef(DEFAULT_SETTINGS)

  const [room, setRoom] = useState(null) // { id, title, hostId, hostName, gameType, bet }
  const [members, setMembers] = useState([])
  const [npcs, setNpcs] = useState([])
  const [game, setGame] = useState(null)
  const [toast, setToast] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [selCards, setSelCards] = useState([]) // 大富豪: 選択中cardId / スピード: [slot]
  const [betBusy, setBetBusy] = useState(false)
  const [stamps, setStamps] = useState([]) // 表示中スタンプ
  const stampSeqRef = useRef(0)
  const stampCdRef = useRef(0)
  const [chatOn, setChatOn] = useState(false) // 運営(is_admin)が建てた部屋のみフリーチャット解放
  const [chatMsgs, setChatMsgs] = useState([])
  const chatSeqRef = useRef(0)
  const chatCdRef = useRef(0)
  const [showHelp, setShowHelp] = useState(false) // 対局中のルール確認パネル
  const [splash, setSplash] = useState(null) // 大きな演出文言(8切り！/革命！など)
  const splashTimerRef = useRef(null)
  const [kiriFlash, setKiriFlash] = useState(null) // 8切り: 流れる前に一瞬場に見せるカード
  const kiriTimerRef = useRef(null)
  const [showFinal, setShowFinal] = useState(false) // 最終結果の表示(自動では消さない)
  const showFinalRef = useRef(false)
  const finalShownRef = useRef(null) // 表示済みの終局キー(再配信で開き直さないため)
  const [omSel, setOmSel] = useState(null)         // ババ抜き: 並べ替えで選択中の位置
  const [moveFlash, setMoveFlash] = useState(null) // 並べ替えの演出 { seat, from, to }
  const moveTimerRef = useRef(null)
  const [deadline, setDeadline] = useState(null) // 持ち時間の期限(全員共通)
  const [nowTick, setNowTick] = useState(0)      // 残り秒の再描画用
  const [clearFlash, setClearFlash] = useState(null) // 場が流れる直前の様子 { cards, passedSeats }
  const clearTimerRef = useRef(null)
  const [exchangeInfo, setExchangeInfo] = useState(null) // カード交換の結果(一呼吸おいて表示)
  const exchangeTimerRef = useRef(null)
  const [matchInfo, setMatchInfo] = useState(null) // 大富豪マッチ { len, round, points, names, lastRanks, over }
  const matchRef = useRef(null)

  const lobbyChRef = useRef(null)
  const roomChRef = useRef(null)
  const gameRef = useRef(null)
  const stateSeqRef = useRef(0)
  const meRef = useRef(null)
  const roomRef = useRef(null)
  const membersRef = useRef([])
  const npcsRef = useRef([])
  const autoRef = useRef(new Set())
  const npcTimerRef = useRef(null)
  const deadlineTimerRef = useRef(null)
  const [ready, setReady] = useState(false) // 自分の準備OK
  const readyRef = useRef(false)
  const myJoinedAtRef = useRef(0)
  const wagerKeyRef = useRef(null)
  const hostGraceRef = useRef(null) // ホスト不在の猶予タイマー(リロード復帰待ち)
  const betPendingRef = useRef(null) // ホスト: { key, need:Set, ok:Set, order }
  const reportedRef = useRef(new Set())
  const lastChampionRef = useRef(null) // 都落ち用: この部屋の前回大富豪(1位)のid
  const lastRankingRef = useRef(null)   // カード交換用: 前局の順位順id配列
  const settleWagerRef = useRef(null)

  useEffect(() => { gameRef.current = game }, [game])
  useEffect(() => { meRef.current = me }, [me])
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { readyRef.current = ready }, [ready])
  useEffect(() => { showFinalRef.current = showFinal }, [showFinal])
  useEffect(() => { npcsRef.current = npcs }, [npcs])
  useEffect(() => { settingsRef.current = settings }, [settings])

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // ---- 認証 ----
  //   ※プロフィール取得が失敗(ネットワーク瞬断等)しても loading を必ず解除する。
  //     以前は profiles クエリが reject すると setLoading(false) に到達せず「読み込み中」で
  //     永久に固まる穴があった(finallyで確実に解除する)。
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let user
      try {
        const r = await supabase.auth.getUser()
        user = r?.data?.user || null
      } catch { user = null }
      if (cancelled) return
      if (!user) { nav('/login'); return }
      let name = '名無し'
      try {
        const { data: prof } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
        if (prof?.username) name = prof.username
      } catch { /* プロフィール取得失敗でも入室は許可(名前は既定) */ }
      if (cancelled) return
      setMe({ id: user.id, name })
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [nav])

  // ---- ホスト: ロビーへ部屋情報を掲示 ----
  //   ロビーのuseEffectより前に定義する(後ろに置くと参照が巻き上げになりReact Compilerの最適化が外れる)
  //   presence(即時)とDB(耐久・90秒猶予)の両方へ出す。presenceだけだとホストの通信が
  //   一瞬切れただけで他の人の一覧から部屋が消えてしまう。
  const publishRoom = useCallback(async (status) => {
    const r = roomRef.current
    if (!r || r.hostId !== meRef.current?.id) return
    const s = settingsRef.current
    const meta = {
      gameType: s.gameType, bet: s.bet, rules: s.gameType === 'daifugo' ? s.rules : null,
      count: membersRef.current.length + npcsRef.current.length,
    }
    publishRoomDb('cards', r, status, meta)
    if (!lobbyChRef.current) return
    await lobbyChRef.current.track({
      roomId: r.id, title: r.title, hostId: r.hostId, hostName: r.hostName, ...meta, status,
    })
  }, [])
  const publishStatus = () => (gameRef.current?.phase === 'playing' ? 'playing' : 'waiting')

  // ---- ロビー ----
  useEffect(() => {
    if (!me) return
    const ch = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key: me.id } } })
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      const list = []
      for (const key of Object.keys(st)) {
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

  // ---- DB側の部屋一覧(ロビー表示中のみ12秒ごと。presenceが落ちていても見つかるように) ----
  useEffect(() => {
    if (!me || view !== 'lobby') return
    let alive = true
    const pull = async () => {
      const list = await listRoomsDb('cards')
      if (alive) setDbRooms(list)
    }
    pull()
    const iv = setInterval(pull, 12000)
    return () => { alive = false; clearInterval(iv) }
  }, [me, view, lobbyNonce])

  // 掲示のキープアライブ: 電波の瞬断などでtrackが落ちて一覧から消えたままになるのを防ぐ
  useEffect(() => {
    if (!room || room.hostId !== me?.id) return
    const iv = setInterval(() => publishRoom(publishStatus()), 25000)
    return () => clearInterval(iv)
  }, [room, me, publishRoom])

  // ---- 部屋設定の変更(ホストのみ・全員へ同期) ----
  const updateSettings = useCallback((patch) => {
    // 賭けありの大富豪マッチ進行中はゲーム変更不可(供託がマッチ全体に乗っているため)
    if (patch.gameType && patch.gameType !== 'daifugo' && matchRef.current && !matchRef.current.over && wagerKeyRef.current) {
      showToast('賭けマッチ進行中はゲームを変更できません')
      return
    }
    // 賭けが進行中は額/種別を変更できない(供託額の偽装・途中変更を防ぐ)
    if (wagerKeyRef.current && (patch.bet !== undefined || patch.gameType)) {
      showToast('賭け対局の進行中は設定を変更できません')
      return
    }
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    roomChRef.current?.send({ type: 'broadcast', event: 'settings', payload: { settings: next } })
    publishRoom(gameRef.current?.phase === 'playing' ? 'playing' : 'waiting')
    // リロード復帰用に設定も保存
    try {
      const saved = JSON.parse(sessionStorage.getItem('bf-cards-room') || 'null')
      if (saved) sessionStorage.setItem('bf-cards-room', JSON.stringify({ ...saved, settings: next }))
    } catch { /* 無視 */ }
  }, [publishRoom])

  // ---- ホスト: エンジン適用→配信 ----
  // 手番が変わった時だけ持ち時間をリセットする(並べ替え等では延長させない)
  const deadlineRef = useRef(null)
  const turnKeyRef = useRef(null)
  const hostDeadline = useCallback((st) => {
    const timed = (st.phase === 'playing' || st.phase === 'exchange') && st.mode !== 'speed'
    if (!timed) { deadlineRef.current = null; turnKeyRef.current = null; return null }
    const key = st.phase === 'exchange'
      ? `ex:${(st.exchange?.pending || []).join(',')}`
      : `turn:${st.turn}`
    if (key !== turnKeyRef.current || !deadlineRef.current) {
      deadlineRef.current = Date.now() + TURN_SEC_TRUMP * 1000
      turnKeyRef.current = key
    }
    return deadlineRef.current
  }, [])

  const hostBroadcast = useCallback((newState, events = []) => {
    gameRef.current = newState
    stateSeqRef.current += 1
    roomChRef.current?.send({
      type: 'broadcast', event: 'state',
      payload: {
        seq: stateSeqRef.current, game: newState, events, wagerKey: wagerKeyRef.current,
        match: matchRef.current, // 大富豪マッチの進行状況
        disconnected: [...autoRef.current], // 切断して自動プレイ中の席(無効試合精算で負け扱いにする)
        // 持ち時間の期限。手番(または交換の未提出者)が変わった時だけ更新するので、
        // 手札の並べ替えなど手番を消費しない操作では時間が延びない
        deadline: hostDeadline(newState),
      },
    })
  }, [hostDeadline])

  // 大富豪マッチ: 局が終わるたびにポイントを加算(ホストのみ)
  const hostUpdateMatch = useCallback((endedState) => {
    const m = matchRef.current
    if (!m || endedState.mode !== 'daifugo' || endedState.phase !== 'ended') return
    for (const r of endedState.result.ranking) {
      const p = endedState.players[r.seat]
      m.points[p.id] = (m.points[p.id] || 0) + (DF_MATCH_PTS[r.rank - 1] || 0)
      m.names[p.id] = p.name
      m.lastRanks[p.id] = r.rank
    }
    if (m.round >= m.len) m.over = true
    else m.round += 1
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hostApply = useCallback((playerId, action) => {
    const cur = gameRef.current
    if (!cur) return false
    const r = applyTrump(cur, playerId, action)
    if (r.error) {
      roomChRef.current?.send({ type: 'broadcast', event: 'reject', payload: { playerId, msg: r.error } })
      return false
    }
    if (r.state.phase === 'ended') hostUpdateMatch(r.state) // 大富豪マッチのpt加算(broadcast前)
    hostBroadcast(r.state, r.events)
    if (r.state.phase !== 'playing') publishRoom('waiting')
    return true
  }, [hostBroadcast, publishRoom, hostUpdateMatch])

  // ---- 対局開始(ホスト)。賭けありなら先に全員の供託を待つ ----
  const actuallyStart = useCallback((order, wKey) => {
    wagerKeyRef.current = wKey
    const s = settingsRef.current
    // 大富豪はマッチ(ポイント制)。新規開始ならここで生成(供託完了後なので空マッチができない)
    if (s.gameType === 'daifugo') {
      if (!matchRef.current || matchRef.current.over) {
        // betters = 供託した人(初戦の人間参加者)。途中参加者を分配対象に混ぜない
        const betters = wKey ? order.filter((p) => !isNpcId(p.id)).map((p) => p.id) : []
        matchRef.current = { len: s.matchLen || 3, round: 1, points: {}, names: {}, lastRanks: {}, over: false, betters }
      }
      setMatchInfo(matchRef.current)
    } else {
      matchRef.current = null
      setMatchInfo(null)
    }
    hostBroadcast(createTrumpGame(s.gameType, order, {
      rules: s.rules || {},
      champion: lastChampionRef.current,
      prevRanking: lastRankingRef.current, // 2戦目以降のカード交換に使う
    }), [])
    publishRoom('playing')
  }, [hostBroadcast, publishRoom])

  // ---- 賭け精算(切断=無効試合なら落ちた人を負けにして残りへ払い出す) ----
  const settleWager = useCallback(async (key, g, lostIds, match = null) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    if (lostIds && lostIds.length > 0) {
      showToast('💰 相手の切断を確認中…精算まで少しお待ちください')
      // 切断者を負け扱いにする。プレゼンス確定(~40秒)まで数回リトライ
      const pending = new Set(lostIds)
      for (let attempt = 0; attempt < 6 && pending.size > 0; attempt++) {
        for (const lid of [...pending]) {
          const r = await wagerForfeit(key, lid)
          if (r?.status === 'settled') {
            const wName = g.players.find((p) => p.id === r.winner)?.name
            showToast(`💰 相手の切断により ${wName || '?'} が ${r.pot}G 獲得！`)
            return
          }
          if (r?.forfeited || r?.status === 'refunded') pending.delete(lid) // 離脱確定/精算済
        }
        if (pending.size > 0) await sleep(15000)
      }
    }
    // 離脱者確定後、順位に応じた分配で精算(NPC・離脱者は分配から除外)
    // 分配率: 2人=勝者総取り / 3人=70/30/0 / 4人=60/25/15/0 / 5人=60/20/15/5/0(1位は常に60%以上)
    const excluded = new Set(lostIds || [])
    let rankedIds = []
    if (match && g.mode === 'daifugo') {
      // 大富豪マッチ: 合計ptで順位(同点は最終戦の順位→id順で決定的に)
      // ※供託したのは初戦の参加者だけなので、途中参加者(match.pointsにしか居ない人)は分配対象外
      const betters = new Set(match.betters || Object.keys(match.points))
      // 最終結果画面と同じ順序で分配する(dfMatchStandingsに一本化。別ソートにすると表示とズレる)
      rankedIds = dfMatchStandings(match, {
        ids: Object.keys(match.points).filter((id) => !isNpcId(id) && !excluded.has(id) && betters.has(id)),
      }).map((r) => r.id)
    } else if (g.mode === 'speed') {
      const wid = g.result?.winner != null ? g.players[g.result.winner]?.id : null
      if (wid) rankedIds = [wid, ...g.players.map((p) => p.id).filter((id) => id !== wid)].filter((id) => !isNpcId(id) && !excluded.has(id))
    } else if (g.result?.ranking) {
      rankedIds = g.result.ranking.map((r) => g.players[r.seat].id).filter((id) => !isNpcId(id) && !excluded.has(id))
    }
    if (rankedIds.length >= 2) {
      const res = await wagerSettleRanked(key, rankedIds)
      if (res?.status === 'settled') {
        const names = rankedIds.map((id) => g.players.find((p) => p.id === id)?.name || match?.names?.[id] || '?')
        showToast(`💰 分配精算完了！ 1位 ${names[0]} が ${res.top_gain ?? res.pot}G 獲得`)
        return
      }
      if (res?.status === 'refunded') { showToast('💰 全員に返金されました'); return }
      if (res?.error && !res.error.includes('SQL更新')) { showToast(`💰 ${res.error}`); return }
      // SQL未更新環境では従来の勝者総取りにフォールバック
      if (res?.error) {
        const winnerHuman = rankedIds[0] || null
        const res2 = await wagerReport(key, winnerHuman)
        if (res2?.status === 'settled') showToast(`💰 精算完了: ${g.players.find((p) => p.id === winnerHuman)?.name} が ${res2.pot}G 獲得！`)
        else if (res2?.error) showToast(`💰 ${res2.error}`)
        return
      }
      return // pending(他の参加者の報告待ち)
    }
    // 分配対象が2人未満(引き分け等) → 返金
    const res = await wagerReport(key, null)
    if (res?.status === 'refunded') showToast('💰 引き分けのため全員に返金されました')
    else if (res?.error) showToast(`💰 ${res.error}`)
  }, [])
  useEffect(() => { settleWagerRef.current = settleWager }, [settleWager])

  // ---- 賭け中は在室ハートビート(切断者だけを離脱指定できるように) ----
  // 終局後も精算が終わるまで継続する(終局直後に「切断した」と後出しで申告されるのを防ぐ)
  const inWagerMatch = !!(room && game && wagerKeyRef.current
    && me && game.players?.some((p) => p.id === me.id))
  useEffect(() => {
    if (!inWagerMatch) return
    const key = wagerKeyRef.current
    wagerPing(key)
    const iv = setInterval(() => wagerPing(key), 15000)
    return () => clearInterval(iv)
  }, [inWagerMatch])

  // ---- 部屋 ----
  const joinRoom = useCallback((roomInfo, asSpectator = false) => {
    const myself = meRef.current
    const ch = supabase.channel(roomChannelName(roomInfo.id), {
      config: { presence: { key: myself.id }, broadcast: { self: true } },
    })
    let hostSeen = false
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      const list = Object.keys(st).map((key) => {
        const meta = st[key][st[key].length - 1]
        return { id: key, name: meta?.name || '?', spectator: !!meta?.spectator, ready: !!meta?.ready, joinedAt: meta?.joinedAt || 0 }
      })
      list.sort((a, b) => a.joinedAt - b.joinedAt)
      const cap = 5 + 100 // 席(最大5) + 観戦100
      if (list.length > cap && list.findIndex((m) => m.id === myself.id) >= cap) {
        showToast('満員のため入室できません')
        leaveRoomRef.current?.()
        return
      }
      setMembers(list)
      membersRef.current = list
      if (roomInfo.hostId === myself.id) {
        for (const m of list) autoRef.current.delete(m.id)
        publishRoom(gameRef.current && gameRef.current.phase === 'playing' ? 'playing' : 'waiting')
        // 途中参加者に現在の設定とstateを再配信
        ch.send({ type: 'broadcast', event: 'settings', payload: { settings: settingsRef.current } })
        if (gameRef.current) {
          ch.send({ type: 'broadcast', event: 'state', payload: { seq: stateSeqRef.current, game: gameRef.current, events: [], wagerKey: wagerKeyRef.current, match: matchRef.current, disconnected: [...autoRef.current] } })
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
          // 進行中の賭けがあれば、居なくなった対局者(ホスト含む)を負け扱いにして精算してから退室
          const g = gameRef.current
          const wk = wagerKeyRef.current
          if (g && wk && !reportedRef.current.has(wk)) {
            const seated2 = g.players.map((p) => p.id)
            if (seated2.includes(myself.id)) {
              const present = new Set(membersRef.current.map((m) => m.id))
              const lostIds = seated2.filter((id) => id && id !== myself.id && !isNpcId(id) && !present.has(id))
              if (lostIds.length > 0) {
                reportedRef.current.add(wk)
                settleWagerRef.current?.(wk, g, lostIds)
              }
            }
          }
          showToast('ホストが退室したため部屋は解散しました')
          leaveRoomRef.current?.()
        }, DISCONNECT_GRACE)
      }
    })
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      if (roomInfo.hostId !== myself.id) return
      const cur = gameRef.current
      if (cur && cur.phase === 'playing' && cur.players.some((p) => p.id === key)) {
        autoRef.current.add(key) // 切断者は自動プレイに切替
      }
    })
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (gameRef.current && payload.seq < stateSeqRef.current) return
      stateSeqRef.current = payload.seq
      // 選択はカードid基準なので途中同期では消さない(新しい対局の開始時のみクリア)
      const prevG = gameRef.current
      if (!prevG || (prevG.phase !== 'playing' && payload.game.phase === 'playing')) setSelCards([])
      gameRef.current = payload.game
      wagerKeyRef.current = payload.wagerKey || null
      setGame(payload.game)
      setDeadline(payload.deadline || null)
      setBetBusy(false)
      // 特殊イベントは大きな演出文言で表示(8切り/革命/しばり/階段/都落ち/バースト)
      const evs = payload.events || []
      const fx = []
      const playEv = evs.find((e) => e.t === 'play')
      for (const ev of evs) {
        if (ev.t === 'revolution') fx.push({ main: ev.on ? '⚡ 革命！' : '⚡ 革命返し！' })
        if (ev.t === 'clear' && ev.kiri) fx.push({ main: '✂ 8切り！' })
        if (ev.t === 'clear' && ev.spade3) fx.push({ main: '♠3返し！' })
        if (ev.t === 'shibari') fx.push({ main: '🔒 しばり！', sub: ev.suits.map((s) => SUIT_LABEL[s]).join('') + ' 限定' })
        if (ev.t === 'miyako') fx.push({ name: payload.game.players[ev.seat]?.name, main: '⛰ 都落ち！' })
        if (ev.t === 'burst') fx.push({ name: payload.game.players[ev.seat]?.name, main: '💥 バースト！' })
        if (ev.t === 'play' && ev.seq) fx.push({ main: '📶 階段！' })
        if (ev.t === 'foul') fx.push({ name: ev.name, main: '🚫 反則上がり！', sub: ev.reasons.join('・') + ' で上がったため最下位' })
        // 誰が上がったかを演出で出す
        if (ev.t === 'out') {
          const nm = payload.game.players[ev.seat]?.id === myself.id ? 'あなた' : payload.game.players[ev.seat]?.name
          fx.push({ name: nm, main: '🎉 上がり！', sub: `${ev.rank}位` })
        }
        // ババ抜きの並べ替え: 動いた位置を光らせる(中身は見えない)
        if (ev.t === 'shuffleMove') {
          setMoveFlash({ seat: ev.seat, from: ev.from, to: ev.to })
          if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
          moveTimerRef.current = setTimeout(() => setMoveFlash(null), 900)
        }
        // カード交換の結果は一呼吸おいて内容を見せる
        if (ev.t === 'exchangeDone') {
          setExchangeInfo(ev.moves)
          if (exchangeTimerRef.current) clearTimeout(exchangeTimerRef.current)
          exchangeTimerRef.current = setTimeout(() => setExchangeInfo(null), 8000)
        }
      }
      // 場が流れる時: 直前の場と「パス」表示を一瞬見せてから消す
      const clearEv = evs.find((e) => e.t === 'clear' && !e.kiri && !e.spade3)
      if (clearEv?.cards) {
        setClearFlash({ cards: clearEv.cards, passedSeats: clearEv.passedSeats || [] })
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
        clearTimerRef.current = setTimeout(() => setClearFlash(null), 1400)
      }
      if (fx.length > 0) {
        setSplash(fx)
        if (splashTimerRef.current) clearTimeout(splashTimerRef.current)
        splashTimerRef.current = setTimeout(() => setSplash(null), 1800)
      }
      // 8切り/スペ3返し: 出したカードを一瞬場に見せてから流す
      if (evs.some((e) => e.t === 'clear' && (e.kiri || e.spade3)) && playEv?.cardObjs) {
        setKiriFlash(playEv.cardObjs)
        if (kiriTimerRef.current) clearTimeout(kiriTimerRef.current)
        kiriTimerRef.current = setTimeout(() => setKiriFlash(null), 1300)
      }
      // 都落ち・カード交換用: 直近の順位を記録
      if (payload.game.phase === 'ended' && payload.game.mode === 'daifugo') {
        lastChampionRef.current = trumpWinnerId(payload.game)
        lastRankingRef.current = payload.game.result?.ranking?.map((r) => payload.game.players[r.seat].id) || null
      }
      // 大富豪マッチの進行状況を同期
      matchRef.current = payload.match || null
      setMatchInfo(payload.match || null)
      // 賭け精算: 終局時に分配報告(大富豪マッチは最終戦が終わるまで精算しない)
      const g = payload.game
      const matchOngoing = g.mode === 'daifugo' && payload.match && !payload.match.over
      if (g.phase === 'ended' && payload.wagerKey && !matchOngoing && !reportedRef.current.has(payload.wagerKey)) {
        const meSeated = g.players.some((p) => p.id === myself.id)
        if (meSeated) {
          reportedRef.current.add(payload.wagerKey)
          // 切断して自動プレイ中だった席は「無効試合の原因」= 負け扱いにする
          const disc = new Set(payload.disconnected || [])
          const lostIds = g.players.filter((p) => disc.has(p.id) && !isNpcId(p.id)).map((p) => p.id)
          settleWagerRef.current(payload.wagerKey, g, lostIds, payload.match || null)
        }
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
    // チャット受信(運営部屋のみUI表示。受信側でもNGワードは破棄)
    ch.on('broadcast', { event: 'chat' }, ({ payload }) => {
      if (typeof payload?.text !== 'string' || containsNgWord(payload.text)) return
      const id = ++chatSeqRef.current
      setChatMsgs((prev) => [...prev.slice(-99), { id, name: String(payload.name ?? '?').slice(0, 16), senderId: payload.senderId, text: payload.text.slice(0, 100) }])
    })
    // 持ち時間切れ(ランダムな手が自動で出される)
    ch.on('broadcast', { event: 'timeup' }, ({ payload }) => {
      const nm = gameRef.current?.players[payload.seat]?.name
      showToast(`⏱ ${nm || '?'} 時間切れ(自動で出しました)`)
    })
    // リロード復帰者からの状態要求: 誰でも持っていれば現在のstate/設定を返す(ホストのリロードにも対応)
    ch.on('broadcast', { event: 'statereq' }, () => {
      if (gameRef.current) {
        ch.send({ type: 'broadcast', event: 'state', payload: { seq: stateSeqRef.current, game: gameRef.current, events: [], wagerKey: wagerKeyRef.current, match: matchRef.current } })
      }
      ch.send({ type: 'broadcast', event: 'settings', payload: { settings: settingsRef.current } })
      // NPCはホストのローカル状態なので、ホストだけが配信元になる(下のnpcs同期)
      if (roomInfo.hostId === myself.id) {
        ch.send({ type: 'broadcast', event: 'npcs', payload: { npcs: npcsRef.current } })
      }
    })
    // ---- 部屋設定の同期 ----
    ch.on('broadcast', { event: 'settings' }, ({ payload }) => {
      settingsRef.current = payload.settings
      setSettings(payload.settings)
    })
    // ---- NPCの同期(ホスト→全員) ----
    //   NPCはホストのローカル状態のため、以前はゲスト側の待機画面に出ず「一戦終わるとNPCが
    //   抜けた」ように見えていた(対局中はホスト配信の盤面に居るので見える)。ホストが変更時と
    //   復帰要求時に配信し、ゲストはそれをそのまま表示に使う。
    ch.on('broadcast', { event: 'npcs' }, ({ payload }) => {
      if (roomInfo.hostId === myself.id) return // ホストは自分の状態が正
      setNpcs(payload.npcs || [])
    })
    // ---- 賭けの供託フロー ----
    ch.on('broadcast', { event: 'betcall' }, async ({ payload }) => {
      if (!payload.humanIds.includes(myself.id)) return
      // 供託額はホストの申告ではなく「自分が画面で見ている設定値」を使う(額の偽装対策)
      const myBet = settingsRef.current.bet
      const myType = settingsRef.current.gameType
      if (!myBet || myBet <= 0 || myBet !== payload.bet || myType !== payload.gameType) {
        ch.send({ type: 'broadcast', event: 'betfail', payload: { playerId: myself.id, key: payload.key, msg: '賭け設定が一致しません' } })
        return
      }
      // 観戦者は供託しない(席に着いている人だけ)
      if (membersRef.current.find((m) => m.id === myself.id)?.spectator) {
        ch.send({ type: 'broadcast', event: 'betfail', payload: { playerId: myself.id, key: payload.key, msg: '観戦者は参加できません' } })
        return
      }
      setBetBusy(true)
      const res = await wagerJoin(payload.key, myType, myBet)
      if (res?.ok) {
        ch.send({ type: 'broadcast', event: 'betok', payload: { playerId: myself.id, key: payload.key } })
      } else {
        ch.send({ type: 'broadcast', event: 'betfail', payload: { playerId: myself.id, key: payload.key, msg: res?.error || '供託に失敗しました' } })
      }
    })
    ch.on('broadcast', { event: 'betok' }, ({ payload }) => {
      const bp = betPendingRef.current
      if (roomInfo.hostId !== myself.id || !bp || bp.key !== payload.key) return
      bp.ok.add(payload.playerId)
      if ([...bp.need].every((id) => bp.ok.has(id))) {
        betPendingRef.current = null
        setBetBusy(false)
        actuallyStart(bp.order, bp.key)
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
      // 供託済みの人は返金希望を報告(過半数一致で返金)
      await wagerReport(payload.key, null)
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
    roomChRef.current = ch
    setRoom(roomInfo); roomRef.current = roomInfo
    setView('room')
    setGame(null); gameRef.current = null
    stateSeqRef.current = 0
    autoRef.current = new Set()
    wagerKeyRef.current = null
    lastChampionRef.current = null
    matchRef.current = null
    setMatchInfo(null)
    settingsRef.current = DEFAULT_SETTINGS
    setSettings(DEFAULT_SETTINGS)
    setLastResult(null)
    setBetBusy(false)
    // リロードしても部屋に戻れるよう保存(明示退室/解散でクリア)
    try { sessionStorage.setItem('bf-cards-room', JSON.stringify({ roomInfo, spectator: asSpectator, settings: settingsRef.current })) } catch { /* 無視 */ }
  }, [hostApply, publishRoom, actuallyStart]) // eslint-disable-line react-hooks/exhaustive-deps

  const leaveRoom = useCallback(() => {
    const r = roomRef.current
    if (r && r.hostId === meRef.current?.id) {
      roomChRef.current?.send({ type: 'broadcast', event: 'closed', payload: {} })
      lobbyChRef.current?.untrack()
      closeRoomDb(r.id) // DB側の掲示も消す(残すと90秒だけ幽霊部屋が出る)
    }
    if (roomChRef.current) { supabase.removeChannel(roomChRef.current); roomChRef.current = null }
    if (npcTimerRef.current) clearTimeout(npcTimerRef.current)
    if (deadlineTimerRef.current) clearTimeout(deadlineTimerRef.current)
    setRoom(null); roomRef.current = null
    setGame(null); gameRef.current = null
    setMembers([]); membersRef.current = []
    setNpcs([]); npcsRef.current = []
    setLastResult(null); setSelCards([]); setBetBusy(false)
    setStamps([])
    setSplash(null); setKiriFlash(null); setClearFlash(null); setExchangeInfo(null)
    setOmSel(null); setMoveFlash(null)
    setShowFinal(false); showFinalRef.current = false; finalShownRef.current = null
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
    deadlineRef.current = null; turnKeyRef.current = null; setDeadline(null)
    if (splashTimerRef.current) clearTimeout(splashTimerRef.current)
    if (kiriTimerRef.current) clearTimeout(kiriTimerRef.current)
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    if (exchangeTimerRef.current) clearTimeout(exchangeTimerRef.current)
    matchRef.current = null
    setMatchInfo(null)
    betPendingRef.current = null
    if (hostGraceRef.current) { clearTimeout(hostGraceRef.current); hostGraceRef.current = null }
    setReady(false); readyRef.current = false
    try { sessionStorage.removeItem('bf-cards-room') } catch { /* 無視 */ }
    setView('lobby')
  }, [])
  const leaveRoomRef = useRef(leaveRoom)
  useEffect(() => { leaveRoomRef.current = leaveRoom }, [leaveRoom])

  // ---- リロード復帰: 保存済みの部屋があれば自動で入り直す(設定も復元) ----
  useEffect(() => {
    if (!me || roomRef.current) return
    try {
      const saved = JSON.parse(sessionStorage.getItem('bf-cards-room') || 'null')
      if (saved?.roomInfo) {
        joinRoom(saved.roomInfo, !!saved.spectator)
        if (saved.settings) { settingsRef.current = saved.settings; setSettings(saved.settings) }
      }
    } catch { /* 無視 */ }
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    // 街へ戻る等のページ遷移: ホストなら部屋を畳む(DB掲示を残すと幽霊部屋になる)
    const r = roomRef.current
    if (r && r.hostId === meRef.current?.id) {
      roomChRef.current?.send({ type: 'broadcast', event: 'closed', payload: {} })
      closeRoomDb(r.id)
    }
    if (roomChRef.current) supabase.removeChannel(roomChRef.current)
    if (lobbyChRef.current) supabase.removeChannel(lobbyChRef.current)
    if (npcTimerRef.current) clearTimeout(npcTimerRef.current)
    if (deadlineTimerRef.current) clearTimeout(deadlineTimerRef.current)
    if (hostGraceRef.current) clearTimeout(hostGraceRef.current)
    // 街へ戻る等のページ遷移では部屋の保存を消す(リロードではこのクリーンアップは走らないので残る)
    try { sessionStorage.removeItem('bf-cards-room') } catch { /* 無視 */ }
  }, [])

  const createRoom = () => {
    const title = roomTitle.trim() || `${me.name}の部屋`
    const roomId = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 13)
    joinRoom({ id: roomId, title, hostId: me.id, hostName: me.name })
  }
  const rulesLabel = (rules) => {
    if (!rules) return ''
    const on = [rules.kakumei === false && '革命なし', rules.spade3 === false && 'スペ3なし', rules.kaidan && '階段', rules.shibari && 'しばり', rules.miyako && '都落ち'].filter(Boolean)
    return on.length > 0 ? on.join('/') : ''
  }

  const def = GAME_DEFS[settings.gameType] || GAME_DEFS.daifugo
  const seated = room ? [...members.filter((m) => !m.spectator), ...npcs].slice(0, def.max) : []

  const addNpc = () => {
    if (membersRef.current.filter((m) => !m.spectator).length + npcsRef.current.length >= def.max) { showToast(`最大${def.max}人です`); return }
    const used = new Set(npcsRef.current.map((n) => n.name))
    const base = NPC_NAMES.find((n) => !used.has(`🤖${n}`)) || `NPC${npcsRef.current.length + 1}`
    setNpcs((prev) => [...prev, { id: `npc-${prev.length + 1}-${Date.now() % 100000}`, name: `🤖${base}` }])
  }
  const removeNpc = (id) => setNpcs((prev) => prev.filter((n) => n.id !== id))
  useEffect(() => {
    if (!room || room.hostId !== me?.id) return
    publishRoom(game?.phase === 'playing' ? 'playing' : 'waiting')
    // NPCの増減をゲストにも反映(ゲスト側の待機画面からNPCが消えて見える問題の対策)
    roomChRef.current?.send({ type: 'broadcast', event: 'npcs', payload: { npcs } })
  }, [npcs]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const startGame = () => {
    const s = settingsRef.current
    const d = GAME_DEFS[s.gameType]
    const list = [...membersRef.current.filter((m) => !m.spectator), ...npcsRef.current].slice(0, d.max)
    if (list.length < d.min) { showToast(`${d.name}は${playersLabel(d)}です。NPCを追加してください`); return }
    // ホスト以外の対局者(人間)が全員「準備OK」でないと開始できない(NPCは対象外)
    const notReady = list.filter((p) => !isNpcId(p.id) && p.id !== roomRef.current.hostId && !p.ready)
    if (notReady.length > 0) {
      showToast(`準備OKが揃っていません: ${notReady.map((p) => p.name).join(`・`)}`)
      return
    }
    const order = list.map((p) => ({ id: p.id, name: p.name }))
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const humans = order.filter((p) => !isNpcId(p.id)).map((p) => p.id)
    // ---- 大富豪マッチ(3/5/7戦のポイント制) ----
    if (s.gameType === 'daifugo' && matchRef.current && !matchRef.current.over) {
      // マッチ継続中: 供託は初戦で済んでいるので同じ賭けキーで次戦へ(マッチ生成はactuallyStart側)
      actuallyStart(order, wagerKeyRef.current)
      return
    }
    if (s.gameType !== 'daifugo' && matchRef.current && !matchRef.current.over && wagerKeyRef.current) {
      showToast('大富豪マッチが進行中です(終わるまで他のゲームは開始できません)')
      return
    }
    if (s.bet > 0 && humans.length >= 2) {
      const key = `${roomRef.current.id}:${Date.now()}`
      betPendingRef.current = { key, need: new Set(humans), ok: new Set(), order }
      setBetBusy(true)
      roomChRef.current?.send({ type: 'broadcast', event: 'betcall', payload: { key, humanIds: humans, gameType: s.gameType, bet: s.bet } })
      // 15秒で不成立
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

  const sendAction = useCallback((action) => {
    roomChRef.current?.send({ type: 'broadcast', event: 'action', payload: { playerId: meRef.current.id, action } })
  }, [])

  // ---- 残り時間の1秒ごと更新 ----
  useEffect(() => {
    if (!deadline) return
    const iv = setInterval(() => setNowTick(Date.now()), 500)
    return () => clearInterval(iv)
  }, [deadline])
  const remainSec = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null

  // ---- スタンプ送信(1.5秒クールダウン) ----
  const sendStamp = useCallback((text) => {
    const now = Date.now()
    if (now - stampCdRef.current < 1500) return
    stampCdRef.current = now
    roomChRef.current?.send({ type: 'broadcast', event: 'stamp', payload: { name: meRef.current.name, text, senderId: meRef.current.id } })
  }, [])

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

  // ---- NPC/切断者の自動進行(ホスト・ターン制＋大富豪の交換フェーズ) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.mode === 'speed') return
    if (game.phase !== 'playing' && game.phase !== 'exchange') return
    // 交換フェーズ: 未提出のNPC/切断者を自動提出させる
    const seat = game.phase === 'exchange'
      ? game.exchange.pending.find((s) => isNpcId(game.players[s].id) || autoRef.current.has(game.players[s].id))
      : game.turn
    if (seat === undefined) return
    const p = game.players[seat]
    if (!isNpcId(p.id) && !autoRef.current.has(p.id)) return
    const seq = stateSeqRef.current
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return
      const cur = gameRef.current
      if (!cur || (cur.phase !== 'playing' && cur.phase !== 'exchange')) return
      const s = cur.phase === 'exchange'
        ? cur.exchange.pending.find((x) => isNpcId(cur.players[x].id) || autoRef.current.has(cur.players[x].id))
        : cur.turn
      if (s === undefined) return
      // 切断者もNPCと同じ思考で代打ち(復帰したら操作権が戻る)
      const action = npcTrump(cur, s) || autoTrump(cur, s)
      if (action) hostApply(cur.players[s].id, action)
    }, 900)
    npcTimerRef.current = t
    return () => clearTimeout(t)
  }, [game, room, me, hostApply])

  // ---- ターン/交換のタイムアウト(ホスト) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.mode === 'speed') return
    if (game.phase !== 'playing' && game.phase !== 'exchange') return
    const seq = stateSeqRef.current
    // 残り時間で発火(並べ替え等で状態が更新されても持ち時間が延びない)
    const wait = Math.max(0, (deadlineRef.current || Date.now() + TURN_SEC_TRUMP * 1000) - Date.now())
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return
      const cur = gameRef.current
      if (!cur) return
      if (cur.phase === 'exchange') {
        // 未提出者を自動提出(弱い札を渡す)
        for (const s of [...cur.exchange.pending]) {
          const a = autoTrump(cur, s)
          if (a) { hostApply(cur.players[s].id, a); return }
        }
        return
      }
      if (cur.phase !== 'playing') return
      // 時間切れ: 出せる手からランダムに選んで出す
      const action = randomTrump(cur, cur.turn) || autoTrump(cur, cur.turn)
      if (action) {
        roomChRef.current?.send({ type: 'broadcast', event: 'timeup', payload: { seat: cur.turn } })
        hostApply(cur.players[cur.turn].id, action)
      }
    }, wait + 300)
    deadlineTimerRef.current = t
    return () => clearTimeout(t)
  }, [game, room, me, hostApply])

  // ---- スピード: NPC着手+手詰まりめくり(ホスト) ----
  // NPCの着手と手詰まり時のめくりを1秒間隔のインターバルで回す
  // (setGameで再描画を誘発する方式だと人間の思考中ずっと再レンダリングし続けるため)
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.mode !== 'speed' || game.phase !== 'playing') return
    const iv = setInterval(() => {
      const cur = gameRef.current
      if (!cur || cur.mode !== 'speed' || cur.phase !== 'playing') return
      for (let s = 0; s < 2; s++) {
        const pid = cur.players[s].id
        if (isNpcId(pid) || autoRef.current.has(pid)) {
          const a = npcTrump(cur, s)
          if (a) { hostApply(pid, a); return }
        }
      }
      if (!speedCanAnyPlay(cur)) hostApply(meRef.current.id, { type: 'flip' })
    }, 1000)
    return () => clearInterval(iv)
  }, [room, me, hostApply, game?.mode, game?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- マッチ最終順位(表示・分配で共通のdfMatchStandingsを使う) ----
  const matchStandings = useCallback((m) => dfMatchStandings(m), [])

  // ---- 結果を閉じて待機画面へ(自動では戻らない。プレイヤーが任意のタイミングで押す) ----
  const returnToWaiting = useCallback(() => {
    const g = gameRef.current
    const m = matchRef.current
    if (g?.result) {
      // 待機画面に残す「前回の結果」。マッチならその最終順位、単発ならその対局の順位
      if (g.mode === 'speed') {
        setLastResult(g.result.winner === null ? '引き分け' : `${g.players[g.result.winner].name}の勝ち！`)
      } else if (g.mode === 'daifugo' && m?.over) {
        setLastResult(matchStandings(m).map((r) => `${r.rank}位 ${r.name}(${r.pt}pt)`).join(' / '))
      } else {
        setLastResult(g.result.ranking.map((r) => `${r.rank}位 ${r.name}`).join(' / '))
      }
    }
    setShowFinal(false)
    setGame(null)
    gameRef.current = null
    deadlineRef.current = null; turnKeyRef.current = null; setDeadline(null)
  }, [matchStandings])

  // ---- 終局時の扱い ----
  //   大富豪マッチが継続中(最終戦でない)なら、6秒だけ結果を見せてホストが次戦を自動開始する。
  //   最終戦/単発ゲームの結果は「最終結果」として自動で消さない(returnToWaitingを押すまで残す)。
  useEffect(() => {
    if (game?.phase !== 'ended' || !game.result) {
      finalShownRef.current = null
      if (showFinalRef.current) setShowFinal(false)
      return
    }
    const m = matchRef.current
    if (game.mode === 'daifugo' && m && !m.over) {
      const t = setTimeout(() => { if (room?.hostId === me?.id) startGame() }, 6000)
      return () => clearTimeout(t)
    }
    // 同じ終局でstateが再配信されても、閉じた最終結果を再度開かない
    const key = `${game.mode}|${m?.round || 0}|${m?.over ? 1 : 0}|${game.result.ranking ? game.result.ranking.map((r) => r.seat).join(',') : game.result.winner}`
    if (finalShownRef.current !== key) {
      finalShownRef.current = key
      setShowFinal(true)
    }
  }, [game, room, me, showFinal]) // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // 描画
  // ============================================================
  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#0d1020', color: '#88ccff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>読み込み中…</div>
  }
  const wrap = (children) => (
    <div style={{ minHeight: '100vh', background: '#0d1020', color: '#cde', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 12 }}>
      <style>{'@keyframes cfsplash { 0% { transform: scale(2.2); opacity: 0 } 18% { transform: scale(1); opacity: 1 } 78% { opacity: 1 } 100% { opacity: 0 } }'}</style>
      {children}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#112244', border: '1px solid #4488cc', color: '#cde', padding: '8px 16px', fontSize: 12, zIndex: 60, whiteSpace: 'nowrap' }}>{toast}</div>
      )}
      {/* 演出文言は画面下寄り(手札より下の余白)に出す。場のカードや手札に被らないように */}
      {/* 演出: 名前/本文/補足を縦に分けて表示(文字が潰れないように) */}
      {splash && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: '18vh',
          display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
          pointerEvents: 'none', zIndex: 70, padding: '0 8px',
        }}>
          {(Array.isArray(splash) ? splash : [{ main: splash }]).map((fx, i) => (
            <div key={i} style={{
              animation: 'cfsplash 1.8s ease-out both',
              background: 'rgba(10,16,32,0.72)', borderRadius: 12, padding: '6px 20px',
              textAlign: 'center', maxWidth: '96vw',
              fontFamily: "'Hiragino Mincho ProN','Yu Mincho',serif", fontWeight: 'bold',
            }}>
              {fx.name && (
                <div style={{
                  fontSize: 20, color: '#ffcc44', lineHeight: 1.25,
                  textShadow: '0 0 10px rgba(0,0,0,0.95), 2px 2px 0 #553300',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90vw',
                }}>{fx.name}</div>
              )}
              <div style={{
                fontSize: 38, color: '#ff4422', lineHeight: 1.2, whiteSpace: 'nowrap',
                textShadow: '0 0 24px rgba(0,0,0,0.95), 3px 3px 0 #550000, -2px -2px 0 #ffcc44',
              }}>{fx.main}</div>
              {fx.sub && (
                <div style={{
                  fontSize: 15, color: '#ffddaa', lineHeight: 1.4, marginTop: 2,
                  textShadow: '0 0 8px rgba(0,0,0,0.95)',
                }}>{fx.sub}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ---- ロビー ----
  if (view === 'lobby') {
    // presence(即時)とDB(耐久)をマージ。どちらか片方にしか無い部屋も見つかるようにする
    const roomList = mergeRooms(rooms, dbRooms)
    return wrap(
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <button onClick={() => nav('/game')} style={btnStyle('#88ccff')}>← 街に戻る</button>
          <div style={{ color: '#ffcc44', fontSize: 14 }}>🃏 トランプ広場</div>
          <div style={{ width: 76 }} />
        </div>
        <div style={{ border: '1px solid #224466', padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#88ccff', marginBottom: 8 }}>部屋を立てる</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} maxLength={20}
              placeholder={`${me.name}の部屋`}
              style={{ flex: 1, background: '#001122', border: '1px solid #224466', color: '#cde', padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}
            />
            <button onClick={createRoom} style={btnStyle('#ffcc44')}>作成</button>
          </div>
          <div style={{ fontSize: 10, color: '#668', marginTop: 6 }}>ゲームの種類・ルール・賭けGoldは部屋に入ってからホストが設定します</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: '#88ccff' }}>部屋一覧</div>
          <button onClick={() => setLobbyNonce((n) => n + 1)} style={btnStyle('#88ccff', { padding: '2px 10px', fontSize: 11 })}>🔄 更新</button>
        </div>
        {roomList.length === 0 && <div style={{ fontSize: 12, color: '#668' }}>現在開いている部屋はありません</div>}
        {roomList.map((r) => (
          <div key={r.roomId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #224466', padding: '10px 12px', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13 }}>
                <span style={{ color: '#ffcc44' }}>[{GAME_DEFS[r.gameType]?.name}]</span> {r.title}
                {r.bet > 0 && <span style={{ color: '#ffaa00', marginLeft: 6 }}>💰{Number(r.bet).toLocaleString()}G</span>}
              </div>
              <div style={{ fontSize: 10, color: '#668' }}>
                主: {r.hostName} / {r.count}人 / {r.status === 'playing' ? '🟢 対局中(観戦可)' : '🟡 募集中'}
                {rulesLabel(r.rules) && <span style={{ color: '#aa88cc' }}> / {rulesLabel(r.rules)}</span>}
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
  const isHost = room.hostId === me.id
  const mySeat = game ? game.players.findIndex((p) => p.id === me.id) : -1
  const playing = game?.phase === 'playing'
  const myTurn = playing && game.mode !== 'speed' && game.turn === mySeat
  const meSpec = !!members.find((m) => m.id === me.id)?.spectator
  // スタンプ(共通コンポーネント)。観戦者は応援カテゴリ付きの別セット
  const amSpectator = game ? mySeat === -1 : (meSpec || !seated.some((s) => s.id === me.id))
  const cheerTargets = game ? game.players.map((p) => ({ id: p.id, name: p.name })) : seated
  const stampUI = (
    <>
      <StampBar spectator={amSpectator} players={cheerTargets} onSend={sendStamp} />
      <StampOverlay stamps={stamps} />
      {chatOn && <RoomChat messages={chatMsgs} onSend={sendChat} meId={me?.id} />}
    </>
  )

  const helpPanelBody = showHelp && (() => {
    // 対局中はその局のルール、待機中は現在の部屋設定を表示
    const mode = game?.mode || settings.gameType
    const h = GAME_HELP[mode]
    if (!h) return null
    const rules = game?.rules || settings.rules || {}
    return (
      <div onClick={() => setShowHelp(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 80, padding: 12 }}>
        <div onClick={(e) => e.stopPropagation()}
          style={{
            background: '#0d1728', border: '2px solid #4488cc', borderRadius: 10, padding: 14,
            maxWidth: 520, width: '100%', maxHeight: '86vh', overflowY: 'auto',
            textAlign: 'left', // 親の中央寄せを継承しない(本文は必ず左揃え)
          }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ color: '#ffcc44', fontSize: 15 }}>📖 {h.name}のルール</div>
            <button onClick={() => setShowHelp(false)} style={btnStyle('#88ccff', { padding: '4px 10px' })}>閉じる</button>
          </div>
          {/* 箇条書きは「・」をぶら下げインデントにして折り返しを揃える */}
          <ul style={{ fontSize: 12, lineHeight: 1.8, color: '#cde', margin: 0, paddingLeft: '1.1em', listStyle: 'disc' }}>
            {h.basic.map((line, i) => <li key={i} style={{ marginBottom: 6 }}>{line}</li>)}
          </ul>
          {h.always && (
            <div style={{ marginTop: 12, border: '1px solid #8a7a33', background: 'rgba(255,204,68,0.07)', borderRadius: 6, padding: '8px 10px' }}>
              {[h.always, ...(h.alwaysMore || [])].map(([label, desc], i) => (
                <div key={i} style={{ marginTop: i > 0 ? 8 : 0 }}>
                  <div style={{ color: '#ffcc44', fontSize: 12, marginBottom: 2 }}>{label}（常に有効）</div>
                  <div style={{ fontSize: 12, color: '#cde', lineHeight: 1.8 }}>{desc}</div>
                </div>
              ))}
            </div>
          )}
          {Object.keys(h.special).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#88ccff', fontSize: 12, marginBottom: 6 }}>この部屋の特殊ルール</div>
              {Object.entries(h.special).map(([key, [label, desc]]) => {
                const on = (key === 'kakumei' || key === 'spade3') ? rules[key] !== false : !!rules[key]
                return (
                  <div key={key} style={{
                    marginBottom: 8, paddingLeft: 8,
                    borderLeft: `2px solid ${on ? '#8a7a33' : '#2a3344'}`,
                    opacity: on ? 1 : 0.5,
                  }}>
                    <div style={{ marginBottom: 1 }}>
                      <span style={{ color: on ? '#ffcc44' : '#7788aa', fontSize: 12 }}>{on ? '✓ ' : '－ '}{label}</span>
                      <span style={{ color: on ? '#ff8866' : '#556', fontSize: 10, marginLeft: 6 }}>{on ? 'あり' : 'なし'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#cde', lineHeight: 1.8 }}>{desc}</div>
                  </div>
                )
              })}
            </div>
          )}
          {h.match && matchInfo && (
            <div style={{ marginTop: 12, border: '1px solid #335577', background: 'rgba(68,136,204,0.08)', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#cde', lineHeight: 1.8 }}>
              {h.match}
              <div style={{ color: '#88ccff', marginTop: 2 }}>現在: 第{Math.min(matchInfo.round, matchInfo.len)}戦 / 全{matchInfo.len}戦</div>
            </div>
          )}
          {settings.bet > 0 && wagerKeyRef.current && (
            <div style={{ marginTop: 12, border: '1px solid #8a6a22', background: 'rgba(255,170,0,0.08)', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#ffaa00', lineHeight: 1.8 }}>
              💰 賭け対局中（1人 {Number(settings.bet).toLocaleString()}G）。<br />
              最終順位で分配されます（2人=勝者総取り / 3人=70:30 / 4人=60:25:15 / 5人=60:20:15:5）。
            </div>
          )}
        </div>
      </div>
    )
  })()

  // ---- 待機画面 ----
  if (!game) {
    return wrap(
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={leaveRoom} style={btnStyle('#88ccff')}>← 退室</button>
          <div style={{ color: '#ffcc44', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '48%' }}>[{def.name}] {room.title}</div>
          {isHost ? <button onClick={startGame} disabled={betBusy} style={btnStyle('#ffcc44', { opacity: betBusy ? 0.5 : 1 })}>{betBusy ? '供託待ち…' : '対局開始'}</button> : <div style={{ width: 60 }} />}
        </div>
        <div style={{ border: '1px solid #224466', padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ color: '#88ccff' }}>ゲーム設定{!isHost && '(ホストが変更できます)'}</span>
            <button onClick={() => setShowHelp(true)} style={btnStyle('#88ccff', { padding: '3px 8px', fontSize: 11 })}>📖 ルール</button>
          </div>
          {isHost ? (
            <>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                {Object.entries(GAME_DEFS).map(([key, d]) => (
                  <button key={key} onClick={() => updateSettings({ gameType: key })}
                    style={btnStyle(settings.gameType === key ? '#ffcc44' : '#446688', { fontSize: 11, background: settings.gameType === key ? 'rgba(255,204,68,0.1)' : 'none' })}>
                    {d.name}({playersLabel(d)})
                  </button>
                ))}
              </div>
              {settings.gameType === 'daifugo' && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[['kakumei', '革命'], ['spade3', 'スペ3返し'], ['kaidan', '階段'], ['shibari', 'しばり'], ['miyako', '都落ち']].map(([key, label]) => {
                      const on = (key === 'kakumei' || key === 'spade3') ? settings.rules[key] !== false : !!settings.rules[key]
                      return (
                        <button key={key} onClick={() => updateSettings({ rules: { ...settings.rules, [key]: !on } })}
                          style={btnStyle(on ? '#ffcc44' : '#446688', { fontSize: 11, background: on ? 'rgba(255,204,68,0.1)' : 'none' })}>
                          {on ? '✓ ' : ''}{label}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: 9, color: '#668', marginTop: 3 }}>革命=4枚以上出しで強さ反転 / スペ3返し=ジョーカー単騎に♠3で返せる(場が流れる) / 階段=同スート3枚以上の連番 / しばり=スート一致で以後同スート限定 / 都落ち=前回1位が1位を逃すと即最下位(2戦目から)</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: '#88ccff' }}>マッチ:</span>
                    {[3, 5, 7].map((n) => (
                      <button key={n} onClick={() => updateSettings({ matchLen: n })}
                        style={btnStyle((settings.matchLen || 3) === n ? '#ffcc44' : '#446688', { fontSize: 11 })}>
                        {n}戦
                      </button>
                    ))}
                    <span style={{ fontSize: 9, color: '#668' }}>順位でpt獲得(1位4/2位2/3位1/4位0)・合計ptで最終順位</span>
                  </div>
                </div>
              )}
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
            </>
          ) : (
            <div style={{ fontSize: 12 }}>
              <span style={{ color: '#ffcc44' }}>{def.name}</span>
              {settings.gameType === 'daifugo' && <span style={{ color: '#88ccff', marginLeft: 8 }}>{settings.matchLen || 3}戦マッチ</span>}
              {settings.gameType === 'daifugo' && rulesLabel(settings.rules) && <span style={{ color: '#aa88cc', marginLeft: 8 }}>{rulesLabel(settings.rules)}</span>}
              <span style={{ color: '#ffaa00', marginLeft: 8 }}>{settings.bet > 0 ? `💰${Number(settings.bet).toLocaleString()}G` : '賭けなし'}</span>
            </div>
          )}
        </div>
        <div style={{ border: '1px solid #224466', padding: '8px 12px', fontSize: 12 }}>
          {settings.bet > 0 && (
            <div style={{ border: '1px solid #8a6a22', background: 'rgba(255,170,0,0.08)', padding: '4px 8px', marginBottom: 6, color: '#ffaa00', fontSize: 11 }}>
              💰 賭け対局: 1人 {Number(settings.bet).toLocaleString()}G(人間2人以上で成立・最終順位で分配(1位60%以上)・NPC勝ち/引き分けは返金)
            </div>
          )}
          {/* 前回のマッチ最終結果(次のマッチを始めるまで残す) */}
          {matchInfo?.over && (
            <div style={{ border: '1px solid #8a6a22', background: 'rgba(255,204,68,0.07)', padding: '6px 8px', marginBottom: 6, fontSize: 11 }}>
              <div style={{ color: '#ffcc44', marginBottom: 2 }}>🏆 前回のマッチ最終結果(全{matchInfo.len}戦)</div>
              {matchStandings(matchInfo).map((r) => (
                <div key={r.id} style={{ color: rankColor(r.rank) }}>{r.rank}位 {r.name}: {r.pt}pt</div>
              ))}
            </div>
          )}
          {lastResult && !matchInfo?.over && (
            <div style={{ border: '1px solid #665522', background: 'rgba(255,204,68,0.07)', padding: '4px 8px', marginBottom: 6, color: '#ffcc44', fontSize: 11 }}>
              前回の結果: {lastResult}
            </div>
          )}
          {/* 大富豪マッチの途中経過 */}
          {matchInfo && !matchInfo.over && (
            <div style={{ border: '1px solid #335577', background: 'rgba(68,136,204,0.08)', padding: '4px 8px', marginBottom: 6, fontSize: 11 }}>
              <span style={{ color: '#88ccff' }}>🏁 マッチ進行中: 第{matchInfo.round}戦/{matchInfo.len}戦</span>
              <span style={{ color: '#cde', marginLeft: 8 }}>
                {Object.keys(matchInfo.points).sort((a, b) => matchInfo.points[b] - matchInfo.points[a]).map((id) => `${matchInfo.names[id]} ${matchInfo.points[id]}pt`).join(' / ')}
              </span>
              {isHost && <span style={{ color: '#ffcc44', marginLeft: 8 }}>「対局開始」で次戦へ</span>}
            </div>
          )}
          <div style={{ color: '#88ccff', marginBottom: 4 }}>対局者({playersLabel(def)})</div>
          {seated.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{i + 1}. {p.name}{p.id === room.hostId ? ' (ホスト)' : ''}</span>
              {(() => { if (isNpcId(p.id) || p.id === room.hostId) return null; return p.ready ? <span style={{ color: '#44dd88', marginLeft: 6 }}>✓準備OK</span> : <span style={{ color: '#886', marginLeft: 6 }}>準備中…</span> })()}
              {isHost && isNpcId(p.id) && <button onClick={() => removeNpc(p.id)} style={btnStyle('#ff6644', { padding: '1px 6px', fontSize: 10 })}>削除</button>}
            </div>
          ))}
          {seated.length < def.max && <div style={{ color: '#668' }}>{seated.length + 1}. 募集中…</div>}
          {isHost && seated.length < def.max && (
            <button onClick={addNpc} style={btnStyle('#44dd88', { marginTop: 6, padding: '2px 8px', fontSize: 11 })}>+ NPC追加</button>
          )}
          {(() => {
            const specs = members.filter((m) => !seated.some((s) => s.id === m.id))
            if (specs.length === 0) return null
            return <div style={{ color: '#668', marginTop: 4 }}>▼ 観戦者: {specs.map((m) => m.name).join('　')}</div>
          })()}
          <InvitePanel me={me} room={room} path="/cards" />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {/* 準備OK(ホスト以外の対局者が全員押すまでホストは開始できない) */}
            {!meSpec && me.id !== room.hostId && (
              <button onClick={toggleReady} style={btnStyle(ready ? '#44dd88' : '#ffcc44', { padding: '4px 10px', fontSize: 11, background: ready ? 'rgba(68,221,136,0.12)' : 'rgba(255,204,68,0.12)' })}>
                {ready ? '✓ 準備OK（取消）' : '準備OKにする'}
              </button>
            )}
            <button onClick={() => setSpectatorMode(!meSpec)} style={btnStyle(meSpec ? '#44dd88' : '#88ccff', { padding: '4px 10px', fontSize: 11 })}>
              {meSpec ? '⚔ 対局に参加する' : '👀 観戦にまわる'}
            </button>
          </div>
        </div>
        {stampUI}
        {helpPanelBody}
      </div>
    )
  }

  // ---- ゲーム画面(共通ヘッダー) ----
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, width: '100%', gap: 6 }}>
      <button onClick={leaveRoom} style={btnStyle('#88ccff')}>← 退室</button>
      <div style={{ color: '#ffcc44', fontSize: 12, flex: 1, textAlign: 'center' }}>
        [{GAME_DEFS[game.mode]?.name || def.name}] {settings.bet > 0 && wagerKeyRef.current ? `💰${Number(settings.bet).toLocaleString()}G` : ''}
        {mySeat === -1 && <span style={{ color: '#668', marginLeft: 6 }}>👀観戦中</span>}
      </div>
      <button onClick={() => setShowHelp(true)} style={btnStyle('#88ccff', { padding: '6px 9px' })}>📖 ルール</button>
    </div>
  )

  // ---- 対局中のルール確認パネル ----
  // ターン制ゲーム共通: 誰のターンかを大きく表示
  const turnBanner = playing && game.mode !== 'speed' && game.players[game.turn] ? (
    <div style={{
      textAlign: 'center', fontSize: 14, fontWeight: 'bold', width: '100%',
      color: game.players[game.turn].id === me.id ? '#ffcc44' : '#88ccff',
      background: game.players[game.turn].id === me.id ? 'rgba(255,204,68,0.12)' : 'rgba(68,136,204,0.08)',
      border: `1px solid ${game.players[game.turn].id === me.id ? '#8a7a33' : '#335577'}`,
      borderRadius: 8, padding: '4px 0', margin: '2px 0 8px',
    }}>
      ▶ {game.players[game.turn].id === me.id ? 'あなた' : game.players[game.turn].name}のターン
      {remainSec !== null && (
        <span style={{ marginLeft: 10, color: remainSec <= 10 ? '#ff4444' : remainSec <= 20 ? '#ffcc44' : '#88ccff' }}>
          ⏱{remainSec}秒
        </span>
      )}
    </div>
  ) : null

  // マッチが継続中(次戦が自動で始まる)か、これが最終結果か
  const matchGoing = game.mode === 'daifugo' && matchInfo && !matchInfo.over
  const isFinalEnd = game.phase === 'ended' && !matchGoing
  const standings = game.mode === 'daifugo' && matchInfo ? matchStandings(matchInfo) : []
  // 最終結果に並べる行: 大富豪マッチは合計ptの最終順位、それ以外はその対局の順位
  const finalRows = game.phase !== 'ended' ? [] : (
    game.mode === 'daifugo' && matchInfo
      ? standings.map((r) => ({ key: r.id, rank: r.rank, name: r.name, sub: `${r.pt}pt` }))
      : game.mode === 'speed'
        ? (game.result.winner === null
          ? [{ key: 'draw', rank: 0, name: '引き分け', sub: `残り ${game.result.left[0]} - ${game.result.left[1]}` }]
          : game.players
            .map((p, s) => ({ key: p.id, rank: s === game.result.winner ? 1 : 2, name: p.name, sub: `残り${game.result.left[s]}枚` }))
            .sort((a, b) => a.rank - b.rank))
        : game.result.ranking.map((r) => ({
          key: r.seat, rank: r.rank, name: r.name,
          sub: [r.burst ? 'バースト' : null, r.foul ? `🚫反則(${r.foul})` : null].filter(Boolean).join(' '),
        }))
  )

  const resultPanel = game.phase === 'ended' && (
    <>
      <div style={{ border: '1px solid #ffcc44', padding: 10, marginTop: 10, width: '100%' }}>
        <div style={{ color: '#ffcc44', fontSize: 13, marginBottom: 6 }}>
          {matchGoing ? `第${Math.max(1, matchInfo.round - 1)}戦の結果` : '結果'}
        </div>
        {game.mode === 'speed' ? (
          <div style={{ fontSize: 13 }}>{game.result.winner === null ? '引き分け' : `🏆 ${game.players[game.result.winner].name} の勝ち！`}
            <span style={{ color: '#668', fontSize: 11, marginLeft: 8 }}>残り枚数 {game.result.left[0]} - {game.result.left[1]}</span>
          </div>
        ) : (
          game.result.ranking.map((r) => (
            <div key={r.seat} style={{ fontSize: 12, color: rankColor(r.rank) }}>
              {r.rank}位 {r.name}{r.burst ? ' (バースト)' : ''}
              {r.foul && <span style={{ color: '#ff4444', marginLeft: 4 }}>🚫反則上がり({r.foul})</span>}
              {game.mode === 'daifugo' && matchInfo && <span style={{ color: '#88ccff', marginLeft: 6 }}>+{DF_MATCH_PTS[r.rank - 1] || 0}pt</span>}
            </div>
          ))
        )}
        {/* 大富豪マッチの累計/最終順位 */}
        {game.mode === 'daifugo' && matchInfo && (
          <div style={{ marginTop: 8, borderTop: '1px solid #334466', paddingTop: 6 }}>
            <div style={{ color: matchInfo.over ? '#ffcc44' : '#88ccff', fontSize: 12, marginBottom: 4 }}>
              {matchInfo.over ? `🏆 マッチ終了！(全${matchInfo.len}戦)` : `🏁 マッチ途中経過(次は第${matchInfo.round}戦/${matchInfo.len}戦)`}
            </div>
            {standings.map((r) => (
              <div key={r.id} style={{ fontSize: 12, color: rankColor(r.rank) }}>
                {matchInfo.over ? `${r.rank}位 ` : ''}{r.name}: {r.pt}pt
              </div>
            ))}
          </div>
        )}
        {matchGoing ? (
          <div style={{ fontSize: 10, color: '#668', marginTop: 6 }}>まもなく次の対局が始まります…</div>
        ) : (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={returnToWaiting} style={btnStyle('#ffcc44', { padding: '4px 12px', fontSize: 12 })}>待機画面に戻る</button>
            {!showFinal && <button onClick={() => setShowFinal(true)} style={btnStyle('#88ccff', { padding: '4px 12px', fontSize: 12 })}>最終結果をもう一度見る</button>}
          </div>
        )}
      </div>

      {/* 最終結果(全画面)。自動では消えない=見逃さない。盤面を見たい時は「盤面を確認」で閉じる */}
      {isFinalEnd && showFinal && (
        <FinalResult
          subtitle={game.mode === 'daifugo' && matchInfo ? `${def.name} 全${matchInfo.len}戦 マッチ終了` : def.name}
          rows={finalRows}
          footNote={game.mode === 'daifugo' && matchInfo
            ? `最終戦の順位: ${game.result.ranking.map((r) => `${r.rank}位 ${r.name}`).join(' / ')}`
            : null}
          betNote={settings.bet > 0 ? '💰 賭けの精算結果は画面下の通知に出ます' : null}
          onClose={() => setShowFinal(false)}
          onReturn={returnToWaiting}
        />
      )}
    </>
  )

  // ---- ババ抜き ----
  if (game.mode === 'oldmaid') {
    const target = playing ? (() => {
      const n = game.players.length
      for (let i = 1; i <= n; i++) { const c = (game.turn + i) % n; if (!game.players[c].out) return c }
      return -1
    })() : -1
    return wrap(
      <div style={{ width: '100%', maxWidth: 560 }}>
        {header}
        {turnBanner}
        {game.players.map((p, s) => (
          <div key={s} style={{ border: `1px solid ${playing && game.turn === s ? '#ffcc44' : '#223355'}`, padding: '6px 8px', marginBottom: 6, background: s === mySeat ? '#101830' : 'transparent' }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: playing && game.turn === s ? '#ffcc44' : '#cde' }}>{p.name}{s === mySeat ? '(あなた)' : ''}</span>
              <span style={{ color: '#668', marginLeft: 8 }}>{p.out ? `${p.rank}位あがり` : `残り${p.hand.length}枚`}</span>
              {playing && game.turn === s && <span style={{ color: '#ff8866', marginLeft: 8 }}>← 引く番</span>}
            </div>
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
              {s === mySeat
                ? p.hand.map((c, i) => (
                  <span key={c.id} style={{
                    display: 'inline-flex',
                    // 自分が動かした札は少し浮かせて位置がわかるように
                    transform: moveFlash?.seat === s && moveFlash.to === i ? 'translateY(-4px)' : 'none',
                    transition: 'transform 0.2s',
                  }}>
                    <TCard c={c} small sel={omSel === i}
                      onClick={p.out ? undefined : () => setOmSel(omSel === i ? null : i)} />
                  </span>
                ))
                : p.hand.map((c, i) => (
                  <span key={c.id} style={{
                    display: 'inline-flex',
                    // 他人の手札: 動いた札を光らせて「入れ替えた」ことがわかるように
                    transform: moveFlash?.seat === s && moveFlash.to === i ? 'translateY(-5px)' : 'none',
                    transition: 'transform 0.25s',
                    boxShadow: moveFlash?.seat === s && (moveFlash.to === i || moveFlash.from === i)
                      ? '0 0 8px 2px rgba(255,204,68,0.9)' : 'none',
                    borderRadius: 4,
                  }}>
                    <TBack small
                      onClick={myTurn && s === target ? () => sendAction({ type: 'draw', index: i }) : undefined} />
                  </span>
                ))}
            </div>
            {/* 自分の手札の並べ替え(心理戦用・いつでも動かせる) */}
            {s === mySeat && !p.out && playing && (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center', marginTop: 4 }}>
                <button
                  onClick={() => { if (omSel !== null && omSel > 0) { sendAction({ type: 'shuffleMove', index: omSel, dir: 'left' }); setOmSel(omSel - 1) } }}
                  disabled={omSel === null || omSel === 0}
                  style={btnStyle(omSel !== null && omSel > 0 ? '#ffcc44' : '#445', { padding: '2px 12px', fontSize: 14, opacity: omSel !== null && omSel > 0 ? 1 : 0.4 })}>←</button>
                <span style={{ fontSize: 10, color: omSel === null ? '#668' : '#ffcc44' }}>
                  {omSel === null ? '札をタップして選ぶと並べ替えできます' : '選択中の札を移動'}
                </span>
                <button
                  onClick={() => { if (omSel !== null && omSel < p.hand.length - 1) { sendAction({ type: 'shuffleMove', index: omSel, dir: 'right' }); setOmSel(omSel + 1) } }}
                  disabled={omSel === null || omSel >= p.hand.length - 1}
                  style={btnStyle(omSel !== null && omSel < p.hand.length - 1 ? '#ffcc44' : '#445', { padding: '2px 12px', fontSize: 14, opacity: omSel !== null && omSel < p.hand.length - 1 ? 1 : 0.4 })}>→</button>
              </div>
            )}
          </div>
        ))}
        {myTurn && <div style={{ color: '#9fd', fontSize: 12, textAlign: 'center' }}>▲ {game.players[target]?.name} の札を1枚タップして引く</div>}
        {resultPanel}
        {stampUI}
        {helpPanelBody}
      </div>
    )
  }

  // ---- 7ならべ ----
  if (game.mode === 'sevens') {
    const myHand = mySeat >= 0 ? game.players[mySeat].hand : []
    return wrap(
      <div style={{ width: '100%', maxWidth: 600 }}>
        {header}
        {turnBanner}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, marginBottom: 6 }}>
          {game.players.map((p, s) => (
            <span key={s} style={{ color: playing && game.turn === s ? '#ffcc44' : p.out ? '#556' : '#cde' }}>
              {p.name}: {p.out ? (game.bursted.includes(s) ? '💥' : `${p.rank || '✓'}`) : `${p.hand.length}枚`}
              <span style={{ color: '#668' }}>(パス残{3 - p.passes})</span>
            </span>
          ))}
        </div>
        <div style={{ background: '#0a2a18', border: '2px solid #1a5535', borderRadius: 6, padding: 4, width: '100%', overflowX: 'auto' }}>
          {[0, 1, 2, 3].map((su) => (
            <div key={su} style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
              {Array.from({ length: 13 }, (_, i) => i + 1).map((r) => (
                <div key={r} style={{
                  width: 34, height: 30, borderRadius: 3, flexShrink: 0,
                  background: game.placed[su][r] ? '#faf7ef' : 'rgba(255,255,255,0.06)',
                  color: su === 1 || su === 2 ? '#cc2233' : '#222a33',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 'bold', fontFamily: 'monospace',
                }}>
                  {game.placed[su][r] ? `${SUIT_LABEL[su]}${RANK_LABEL[r - 1]}` : ''}
                </div>
              ))}
            </div>
          ))}
        </div>
        {mySeat >= 0 && game.phase !== 'ended' && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
              {myHand.map((c) => {
                const ok = sevensPlayable(game, c)
                return <TCard key={c.id} c={c} sel={false} dim={myTurn && !ok}
                  onClick={myTurn && ok ? () => sendAction({ type: 'play', cardId: c.id }) : undefined} />
              })}
            </div>
            {myTurn && (
              <div style={{ textAlign: 'center' }}>
                <button onClick={() => sendAction({ type: 'pass' })} style={btnStyle('#ff8866', { marginTop: 8 })}>
                  パス(残{3 - game.players[mySeat].passes}回 / 0で💥バースト)
                </button>
              </div>
            )}
          </div>
        )}
        {resultPanel}
        {stampUI}
        {helpPanelBody}
      </div>
    )
  }

  // ---- 大富豪 ----
  if (game.mode === 'daifugo') {
    const myHand = mySeat >= 0 ? game.players[mySeat].hand : []
    const toggleSel = (id) => setSelCards((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
    const selObjs = selCards.map((id) => myHand.find((c) => c.id === id)).filter(Boolean)
    const canPlay = myTurn && selObjs.length > 0 && dfSetStrength(selObjs, game.field, game.revolution, game.rules) !== null
    return wrap(
      <div style={{ width: '100%', maxWidth: 560 }}>
        {header}
        {turnBanner}
        <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'stretch' }}>
          {/* プレイヤーは縦並び・パス欄は固定幅(テキストがずれない) */}
          <div style={{ flex: 1, border: '1px solid #223355', borderRadius: 6, padding: '4px 8px' }}>
            {game.players.map((p, s) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', fontSize: 12, padding: '2px 0' }}>
                <span style={{ flex: 1, color: playing && game.turn === s ? '#ffcc44' : p.out ? '#556' : '#cde', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {playing && game.turn === s ? '▶ ' : ''}{p.name}
                </span>
                {matchInfo && <span style={{ width: 34, textAlign: 'right', color: '#88ccff' }}>{matchInfo.points[p.id] || 0}pt</span>}
                {/* 残り枚数は少なくなるほど警告色(6枚以下=黄 / 3枚以下=赤) */}
                <span style={{
                  width: 44, textAlign: 'right', fontWeight: !p.out && p.hand.length <= 6 ? 'bold' : 'normal',
                  color: p.out ? rankColor(p.rank) : p.hand.length <= 3 ? '#ff4444' : p.hand.length <= 6 ? '#ffcc44' : '#668',
                }}>{p.out ? `${p.rank}位` : `${p.hand.length}枚`}</span>
                {/* パス表示。場が流れた直後も一瞬だけ残して「最後のパス」が見えるようにする */}
                <span style={{ width: 40, textAlign: 'center', color: '#ff8866' }}>
                  {!p.out && (game.passed[s] || clearFlash?.passedSeats?.includes(s)) ? 'パス' : ''}
                </span>
              </div>
            ))}
          </div>
          {/* 適用ルールと現在の状態 */}
          <div style={{ width: 108, border: '1px solid #334466', borderRadius: 6, padding: '4px 8px', fontSize: 11, flexShrink: 0 }}>
            {matchInfo && <div style={{ color: '#ffcc44', marginBottom: 2 }}>🏁第{Math.min(matchInfo.round, matchInfo.len)}/{matchInfo.len}戦</div>}
            <div style={{ color: '#88ccff', marginBottom: 2 }}>ルール</div>
            {[['kakumei', '革命'], ['spade3', 'スペ3返し'], ['kaidan', '階段'], ['shibari', 'しばり'], ['miyako', '都落ち']].map(([k, l]) => {
              const on = (k === 'kakumei' || k === 'spade3') ? game.rules?.[k] !== false : !!game.rules?.[k]
              return <div key={k} style={{ color: on ? '#ffcc44' : '#445566' }}>{on ? '✓ ' : '－ '}{l}</div>
            })}
            {game.revolution && <div style={{ color: '#ff4444', marginTop: 2 }}>⚡革命中</div>}
            {game.field?.lock && <div style={{ color: '#ffcc44', marginTop: 2 }}>🔒{game.field.lock.map((s) => SUIT_LABEL[s]).join('')}しばり中</div>}
          </div>
        </div>
        {/* 場: 誰が出したかを表示 */}
        <div style={{ background: '#0a2a18', border: '2px solid #1a5535', borderRadius: 6, padding: '6px 10px 10px', minHeight: 84, width: '100%' }}>
          <div style={{ fontSize: 11, textAlign: 'center', marginBottom: 4, minHeight: 15, color: clearFlash ? '#ff8866' : '#7ab88f' }}>
            {game.field
              ? <>{game.players[game.field.by]?.id === me.id ? 'あなた' : game.players[game.field.by]?.name} が出した札</>
              : clearFlash ? '全員パス → 場が流れます' : ''}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center', minHeight: 54 }}>
            {game.field
              ? game.field.cards.map((c) => <TCard key={c.id} c={c} />)
              : kiriFlash
                ? kiriFlash.map((c) => <TCard key={c.id} c={c} sel />)
                : clearFlash
                  ? clearFlash.cards.map((c) => <TCard key={c.id} c={c} dim />)
                  : <span style={{ color: '#557', fontSize: 12 }}>場は空(好きな札を出せます)</span>}
          </div>
        </div>
        {/* カード交換の結果(成立後に一呼吸おいて内容を見せる) */}
        {exchangeInfo && (
          <div style={{ border: '2px solid #ffcc44', background: 'rgba(255,204,68,0.1)', borderRadius: 8, padding: '8px 10px', marginTop: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: '#ffcc44' }}>🔄 カード交換の結果</span>
              <button onClick={() => setExchangeInfo(null)} style={btnStyle('#88ccff', { padding: '2px 8px', fontSize: 11 })}>✕</button>
            </div>
            {/* 自分がもらった札・渡した札を先に強調 */}
            {mySeat >= 0 && exchangeInfo.filter((m) => m.to === mySeat).map((m, i) => (
              <div key={'r' + i} style={{ marginBottom: 6 }}>
                <div style={{ color: '#44dd88', marginBottom: 2 }}>▼ あなたが受け取った札（{m.fromName} から）</div>
                <div style={{ display: 'flex', gap: 3 }}>{m.cardObjs.map((c) => <TCard key={c.id} c={c} sel />)}</div>
              </div>
            ))}
            {mySeat >= 0 && exchangeInfo.filter((m) => m.from === mySeat).map((m, i) => (
              <div key={'g' + i} style={{ marginBottom: 6 }}>
                <div style={{ color: '#ff8866', marginBottom: 2 }}>▲ あなたが渡した札（{m.toName} へ{m.auto ? '・自動' : ''}）</div>
                <div style={{ display: 'flex', gap: 3 }}>{m.cardObjs.map((c) => <TCard key={c.id} c={c} small dim />)}</div>
              </div>
            ))}
            {/* 自分が関わっていない交換は見せない(観戦者には全体の有無だけ伝える) */}
            {mySeat === -1 && (
              <div style={{ color: '#668', lineHeight: 1.7 }}>交換が行われました（内容は対局者のみ確認できます）</div>
            )}
            {mySeat >= 0 && !exchangeInfo.some((m) => m.from === mySeat || m.to === mySeat) && (
              <div style={{ color: '#668', lineHeight: 1.7 }}>あなたは今回の交換の対象外です</div>
            )}
          </div>
        )}
        {/* カード交換フェーズ(2戦目以降) */}
        {game.phase === 'exchange' && (() => {
          const ex = game.exchange
          const myPair = mySeat >= 0 ? ex.pairs.find((p) => !p.auto && p.from === mySeat) : null
          const iMustPick = !!myPair && ex.pending.includes(mySeat)
          return (
            <div style={{ border: '2px solid #ffcc44', background: 'rgba(255,204,68,0.08)', borderRadius: 8, padding: '8px 10px', marginTop: 8, fontSize: 12 }}>
              <div style={{ color: '#ffcc44', marginBottom: 4 }}>
                🔄 カード交換
                {remainSec !== null && (
                  <span style={{ marginLeft: 8, color: remainSec <= 10 ? '#ff4444' : '#88ccff' }}>⏱{remainSec}秒</span>
                )}
              </div>
              <div style={{ color: '#cde', lineHeight: 1.7 }}>
                {ex.pairs.filter((p) => p.auto).map((p, i) => (
                  <div key={i}>・{game.players[p.from].name} → {game.players[p.to].name} に強い札{p.count}枚（自動）</div>
                ))}
                {ex.pairs.filter((p) => !p.auto).map((p, i) => (
                  <div key={i} style={{ color: ex.pending.includes(p.from) ? '#ffcc44' : '#668' }}>
                    ・{game.players[p.from].name} → {game.players[p.to].name} に好きな札{p.count}枚
                    {ex.pending.includes(p.from) ? '（選択中…）' : '（提出済み）'}
                  </div>
                ))}
              </div>
              {iMustPick && (
                <div style={{ marginTop: 6, color: '#ffcc44' }}>
                  渡す札を{myPair.count}枚選んでください（{selObjs.length}/{myPair.count}）
                </div>
              )}
            </div>
          )
        })()}
        {mySeat >= 0 && game.phase !== 'ended' && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
              {myHand.map((c) => {
                const inExchange = game.phase === 'exchange'
                const canTap = inExchange
                  ? !!game.exchange.pairs.find((p) => !p.auto && p.from === mySeat) && game.exchange.pending.includes(mySeat)
                  : myTurn
                return (
                  <TCard key={c.id} c={c} sel={selCards.includes(c.id)}
                    onClick={canTap ? () => toggleSel(c.id) : undefined} />
                )
              })}
            </div>
            {/* 交換の提出ボタン */}
            {game.phase === 'exchange' && (() => {
              const myPair = game.exchange.pairs.find((p) => !p.auto && p.from === mySeat)
              if (!myPair || !game.exchange.pending.includes(mySeat)) return null
              const ok = selObjs.length === myPair.count
              return (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'center' }}>
                  <button onClick={() => { sendAction({ type: 'exchange', cardIds: selObjs.map((c) => c.id) }); setSelCards([]) }} disabled={!ok}
                    style={btnStyle(ok ? '#ffcc44' : '#445', { fontSize: 14, opacity: ok ? 1 : 0.5 })}>
                    この{myPair.count}枚を渡す
                  </button>
                </div>
              )
            })()}
            {myTurn && game.phase === 'playing' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'center' }}>
                <button onClick={() => { sendAction({ type: 'play', cardIds: selObjs.map((c) => c.id) }); setSelCards([]) }} disabled={!canPlay}
                  style={btnStyle(canPlay ? '#ffcc44' : '#445', { fontSize: 14, opacity: canPlay ? 1 : 0.5 })}>出す({selObjs.length}枚)</button>
                {game.field && <button onClick={() => { sendAction({ type: 'pass' }); setSelCards([]) }} style={btnStyle('#ff8866', { fontSize: 14 })}>パス</button>}
              </div>
            )}
            {/* 反則上がりの注意 */}
            {myTurn && game.phase === 'playing' && myHand.length <= 3 && (
              <div style={{ fontSize: 10, color: '#ff8866', textAlign: 'center', marginTop: 4 }}>
                ⚠ 最後の1手が {game.revolution ? '3' : '2'}・JOKER・8切り だと反則上がり（最下位）になります
              </div>
            )}
          </div>
        )}
        {resultPanel}
        {stampUI}
        {helpPanelBody}
      </div>
    )
  }

  // ---- スピード ----
  if (game.mode === 'speed') {
    // 2タップ式: 札をタップして選択(カードid基準なので同期が入っても選択は消えない)→台札をタップして置く
    const speedAdjOk = (a, b) => { const d = Math.abs(a - b); return d === 1 || d === 12 }
    const mySlots = mySeat >= 0 ? game.players[mySeat].slots : []
    const selId = selCards[0] ?? null
    const selCard = selId !== null ? mySlots.find((c) => c && c.id === selId) : null // 手放したら自然に無効
    const playTo = (pileIdx) => {
      if (!selCard) return
      const slot = mySlots.findIndex((c) => c && c.id === selCard.id)
      if (slot === -1) { setSelCards([]); return }
      sendAction({ type: 'play', slot, pile: pileIdx })
      setSelCards([])
    }
    const renderSide = (seat, mine) => {
      const p = game.players[seat]
      return (
        <div style={{ border: '1px solid #223355', padding: 8, width: '100%' }}>
          <div style={{ fontSize: 11, color: '#cde', marginBottom: 4, textAlign: 'center' }}>{p.name}{mine ? '(あなた)' : ''} <span style={{ color: '#668' }}>山札{p.stock.length}枚</span></div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            {p.slots.map((c, i) => c
              ? <TCard key={c.id} c={c}
                  sel={mine && playing && selCard?.id === c.id}
                  dim={mine && playing && selCard && selCard.id !== c.id}
                  onClick={mine && playing ? () => setSelCards(selCard?.id === c.id ? [] : [c.id]) : undefined} />
              : <div key={i} style={{ width: 38, height: 54 }} />)}
          </div>
        </div>
      )
    }
    return wrap(
      <div style={{ width: '100%', maxWidth: 420 }}>
        {header}
        {turnBanner}
        {mySeat !== 0 && renderSide(0, mySeat === 0)}
        {mySeat === 0 && renderSide(1, false)}
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', margin: '10px 0', alignItems: 'center' }}>
          {game.piles.map((c, i) => {
            const ok = !!(selCard && c && speedAdjOk(selCard.r, c.r))
            const clickable = mySeat >= 0 && playing && !!selCard
            // ★台札はdivにする(内側のTCard=disabled buttonをbuttonで包むと入れ子ボタンになり、
            //   タップが内側に吸われてplayToが発火しない=札が出せなくなるため)。
            //   内側はpointerEvents:noneでクリックを外側divへ通す。
            return (
              <div key={i} role="button" onClick={clickable ? () => playTo(i) : undefined}
                style={{
                  background: 'none', borderRadius: 8, padding: 4,
                  border: ok ? '2px dashed #ffcc44' : '2px solid transparent',
                  boxShadow: ok ? '0 0 10px rgba(255,204,68,0.5)' : 'none',
                  cursor: clickable ? 'pointer' : 'default',
                }}>
                <span style={{ pointerEvents: 'none', display: 'inline-flex' }}>
                  {c ? <TCard c={c} /> : <div style={{ width: 38, height: 54 }} />}
                </span>
              </div>
            )
          })}
        </div>
        {renderSide(mySeat >= 0 ? mySeat : 1, mySeat >= 0)}
        {mySeat >= 0 && playing && (
          <div style={{ fontSize: 11, color: '#9fd', textAlign: 'center', marginTop: 6 }}>
            {selCard ? '置きたい台札(±1)をタップ！' : '出したい札をタップ → 台札をタップ。早い者勝ち！'}
          </div>
        )}
        {resultPanel}
        {stampUI}
        {helpPanelBody}
      </div>
    )
  }

  return wrap(<div>不明なゲームです</div>)
}
