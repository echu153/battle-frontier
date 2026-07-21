import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { reportDevAccess } from '../lib/devAccess'
import {
  GAME_DEFS, TURN_SEC_TRUMP, cardLabel, isRed, isNpcId,
  createTrumpGame, applyTrump, npcTrump, autoTrump, trumpWinnerId,
  sevensPlayable, speedCanAnyPlay, dfSetStrength, SUIT_LABEL, RANK_LABEL,
} from '../lib/trump'
import { wagerJoin, wagerReport, MAX_BET } from '../lib/wager'

// ============================================================
// トランプ広場 — 開発限定(大富豪/スピード/7ならべ/ババ抜き)
// 部屋: Supabase Realtime presence(ロビー) + broadcast(同期)・ホスト権威型・SQL不要
// Gold賭け(任意): supabase_game_wager.sql の供託/過半数一致精算を使用
// ============================================================

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
  const [blocked, setBlocked] = useState(false)
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState('lobby')
  const [rooms, setRooms] = useState([])
  const [roomTitle, setRoomTitle] = useState('')
  const [gameType, setGameType] = useState('daifugo')
  const [bet, setBet] = useState(0)
  const [dfRules, setDfRules] = useState({ kaidan: false, shibari: false, miyako: false }) // 大富豪の選択ルール

  const [room, setRoom] = useState(null) // { id, title, hostId, hostName, gameType, bet }
  const [members, setMembers] = useState([])
  const [npcs, setNpcs] = useState([])
  const [game, setGame] = useState(null)
  const [toast, setToast] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [selCards, setSelCards] = useState([]) // 大富豪: 選択中cardId / スピード: [slot]
  const [betBusy, setBetBusy] = useState(false)

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
  const myJoinedAtRef = useRef(0)
  const wagerKeyRef = useRef(null)
  const betPendingRef = useRef(null) // ホスト: { key, need:Set, ok:Set, order }
  const reportedRef = useRef(new Set())
  const lastChampionRef = useRef(null) // 都落ち用: この部屋の前回大富豪(1位)のid

  useEffect(() => { gameRef.current = game }, [game])
  useEffect(() => { meRef.current = me }, [me])
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { npcsRef.current = npcs }, [npcs])

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // ---- 認証 + is_adminゲート ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).maybeSingle()
      if (cancelled) return
      if (!prof?.is_admin) {
        reportDevAccess('cards', 'トランプ広場(/cards)')
        setBlocked(true); setLoading(false); return
      }
      setMe({ id: user.id, name: prof.username || '名無し' })
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
    await lobbyChRef.current.track({
      roomId: r.id, title: r.title, hostId: r.hostId, hostName: r.hostName,
      gameType: r.gameType, bet: r.bet, rules: r.rules || null,
      count: membersRef.current.length + npcsRef.current.length, status,
    })
  }, [])

  // ---- ホスト: エンジン適用→配信 ----
  const hostBroadcast = useCallback((newState, events = []) => {
    gameRef.current = newState
    stateSeqRef.current += 1
    roomChRef.current?.send({
      type: 'broadcast', event: 'state',
      payload: { seq: stateSeqRef.current, game: newState, events, wagerKey: wagerKeyRef.current },
    })
  }, [])

  const hostApply = useCallback((playerId, action) => {
    const cur = gameRef.current
    if (!cur) return false
    const r = applyTrump(cur, playerId, action)
    if (r.error) {
      roomChRef.current?.send({ type: 'broadcast', event: 'reject', payload: { playerId, msg: r.error } })
      return false
    }
    hostBroadcast(r.state, r.events)
    if (r.state.phase !== 'playing') publishRoom('waiting')
    return true
  }, [hostBroadcast, publishRoom])

  // ---- 対局開始(ホスト)。賭けありなら先に全員の供託を待つ ----
  const actuallyStart = useCallback((order, wKey) => {
    wagerKeyRef.current = wKey
    hostBroadcast(createTrumpGame(roomRef.current.gameType, order, {
      rules: roomRef.current.rules || {},
      champion: lastChampionRef.current,
    }), [])
    publishRoom('playing')
  }, [hostBroadcast, publishRoom])

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
        return { id: key, name: meta?.name || '?', spectator: !!meta?.spectator, joinedAt: meta?.joinedAt || 0 }
      })
      list.sort((a, b) => a.joinedAt - b.joinedAt)
      const cap = GAME_DEFS[roomInfo.gameType].max + 100
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
        if (gameRef.current) {
          ch.send({ type: 'broadcast', event: 'state', payload: { seq: stateSeqRef.current, game: gameRef.current, events: [], wagerKey: wagerKeyRef.current } })
        }
        return
      }
      if (list.some((m) => m.id === roomInfo.hostId)) hostSeen = true
      else if (hostSeen) {
        showToast('ホストが退室したため部屋は解散しました')
        leaveRoomRef.current?.()
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
      gameRef.current = payload.game
      wagerKeyRef.current = payload.wagerKey || null
      setGame(payload.game)
      setSelCards([])
      setBetBusy(false)
      for (const ev of payload.events || []) {
        if (ev.t === 'revolution') showToast(ev.on ? '⚡ 革命！' : '⚡ 革命返し！')
        if (ev.t === 'burst') showToast(`💥 ${payload.game.players[ev.seat]?.name} バースト！`)
        if (ev.t === 'shibari') showToast(`🔒 しばり発生！(${ev.suits.map((s) => SUIT_LABEL[s]).join('')})`)
        if (ev.t === 'miyako') showToast(`⛰ ${payload.game.players[ev.seat]?.name} 都落ち！`)
      }
      // 都落ち用: この部屋の直近の大富豪(1位)を記録
      if (payload.game.phase === 'ended' && payload.game.mode === 'daifugo') {
        lastChampionRef.current = trumpWinnerId(payload.game)
      }
      // 賭け精算: 終局時に各参加者(人間)が勝者を報告
      const g = payload.game
      if (g.phase === 'ended' && payload.wagerKey && !reportedRef.current.has(payload.wagerKey)) {
        const meSeated = g.players.some((p) => p.id === myself.id)
        if (meSeated) {
          reportedRef.current.add(payload.wagerKey)
          const wid = trumpWinnerId(g)
          const winnerHuman = wid && !isNpcId(wid) ? wid : null
          wagerReport(payload.wagerKey, winnerHuman).then((res) => {
            if (res?.status === 'settled') {
              const wName = g.players.find((p) => p.id === winnerHuman)?.name
              showToast(`💰 精算完了: ${wName} が ${res.pot}G 獲得！`)
            } else if (res?.status === 'refunded') {
              showToast('💰 引き分け/NPC勝ちのため全員に返金されました')
            } else if (res?.error) showToast(`💰 ${res.error}`)
          })
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
    // ---- 賭けの供託フロー ----
    ch.on('broadcast', { event: 'betcall' }, async ({ payload }) => {
      if (!payload.humanIds.includes(myself.id)) return
      setBetBusy(true)
      const res = await wagerJoin(payload.key, roomInfo.gameType, roomInfo.bet)
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
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        myJoinedAtRef.current = Date.now()
        await ch.track({ name: myself.name, joinedAt: myJoinedAtRef.current, spectator: asSpectator })
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
    setLastResult(null)
    setBetBusy(false)
  }, [hostApply, publishRoom, actuallyStart])

  const leaveRoom = useCallback(() => {
    const r = roomRef.current
    if (r && r.hostId === meRef.current?.id) {
      roomChRef.current?.send({ type: 'broadcast', event: 'closed', payload: {} })
      lobbyChRef.current?.untrack()
    }
    if (roomChRef.current) { supabase.removeChannel(roomChRef.current); roomChRef.current = null }
    if (npcTimerRef.current) clearTimeout(npcTimerRef.current)
    if (deadlineTimerRef.current) clearTimeout(deadlineTimerRef.current)
    setRoom(null); roomRef.current = null
    setGame(null); gameRef.current = null
    setMembers([]); membersRef.current = []
    setNpcs([]); npcsRef.current = []
    setLastResult(null); setSelCards([]); setBetBusy(false)
    betPendingRef.current = null
    setView('lobby')
  }, [])
  const leaveRoomRef = useRef(leaveRoom)
  useEffect(() => { leaveRoomRef.current = leaveRoom }, [leaveRoom])

  useEffect(() => () => {
    if (roomChRef.current) supabase.removeChannel(roomChRef.current)
    if (lobbyChRef.current) supabase.removeChannel(lobbyChRef.current)
    if (npcTimerRef.current) clearTimeout(npcTimerRef.current)
    if (deadlineTimerRef.current) clearTimeout(deadlineTimerRef.current)
  }, [])

  const createRoom = () => {
    const b = Math.max(0, Math.min(MAX_BET, Math.floor(Number(bet) || 0)))
    const title = roomTitle.trim() || `${me.name}の${GAME_DEFS[gameType].name}`
    const roomId = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 13)
    joinRoom({ id: roomId, title, hostId: me.id, hostName: me.name, gameType, bet: b, rules: gameType === 'daifugo' ? dfRules : null })
  }
  const rulesLabel = (rules) => {
    if (!rules) return ''
    const on = [rules.kaidan && '階段', rules.shibari && 'しばり', rules.miyako && '都落ち'].filter(Boolean)
    return on.length > 0 ? on.join('/') : ''
  }

  const def = room ? GAME_DEFS[room.gameType] : null
  const seated = room ? [...members.filter((m) => !m.spectator), ...npcs].slice(0, def.max) : []

  const addNpc = () => {
    if (membersRef.current.filter((m) => !m.spectator).length + npcsRef.current.length >= def.max) { showToast(`最大${def.max}人です`); return }
    const used = new Set(npcsRef.current.map((n) => n.name))
    const base = NPC_NAMES.find((n) => !used.has(`🤖${n}`)) || `NPC${npcsRef.current.length + 1}`
    setNpcs((prev) => [...prev, { id: `npc-${prev.length + 1}-${Date.now() % 100000}`, name: `🤖${base}` }])
  }
  const removeNpc = (id) => setNpcs((prev) => prev.filter((n) => n.id !== id))
  useEffect(() => {
    if (room && room.hostId === me?.id) publishRoom(game?.phase === 'playing' ? 'playing' : 'waiting')
  }, [npcs]) // eslint-disable-line react-hooks/exhaustive-deps

  const setSpectatorMode = (next) => {
    roomChRef.current?.track({ name: meRef.current.name, joinedAt: myJoinedAtRef.current, spectator: next })
  }

  const startGame = () => {
    const list = [...membersRef.current.filter((m) => !m.spectator), ...npcsRef.current].slice(0, def.max)
    if (list.length < def.min) { showToast(`${def.name}は${def.min}人から。NPCを追加してください`); return }
    const order = list.map((p) => ({ id: p.id, name: p.name }))
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const humans = order.filter((p) => !isNpcId(p.id)).map((p) => p.id)
    if (room.bet > 0 && humans.length >= 2) {
      const key = `${room.id}:${Date.now()}`
      betPendingRef.current = { key, need: new Set(humans), ok: new Set(), order }
      setBetBusy(true)
      roomChRef.current?.send({ type: 'broadcast', event: 'betcall', payload: { key, humanIds: humans } })
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

  // ---- NPC/切断者の自動進行(ホスト・ターン制) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.phase !== 'playing' || game.mode === 'speed') return
    const p = game.players[game.turn]
    const isBot = isNpcId(p.id) || autoRef.current.has(p.id)
    if (!isBot) return
    const seq = stateSeqRef.current
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return
      const cur = gameRef.current
      if (!cur || cur.phase !== 'playing') return
      const seat = cur.turn
      const action = isNpcId(cur.players[seat].id) ? npcTrump(cur, seat) : autoTrump(cur, seat)
      if (action) hostApply(cur.players[seat].id, action)
    }, 900)
    npcTimerRef.current = t
    return () => clearTimeout(t)
  }, [game, room, me, hostApply])

  // ---- ターンタイムアウト(ホスト・ターン制) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.phase !== 'playing' || game.mode === 'speed') return
    const seq = stateSeqRef.current
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return
      const cur = gameRef.current
      if (!cur || cur.phase !== 'playing') return
      const action = autoTrump(cur, cur.turn)
      if (action) hostApply(cur.players[cur.turn].id, action)
    }, TURN_SEC_TRUMP * 1000)
    deadlineTimerRef.current = t
    return () => clearTimeout(t)
  }, [game, room, me, hostApply])

  // ---- スピード: NPC着手+手詰まりめくり(ホスト) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.phase !== 'playing' || game.mode !== 'speed') return
    const seq = stateSeqRef.current
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return
      const cur = gameRef.current
      if (!cur || cur.phase !== 'playing') return
      // NPC/切断者が出せるなら1枚出す
      for (let s = 0; s < 2; s++) {
        const pid = cur.players[s].id
        if (isNpcId(pid) || autoRef.current.has(pid)) {
          const a = npcTrump(cur, s)
          if (a) { hostApply(pid, a); return }
        }
      }
      // 誰も出せない → めくる
      if (!speedCanAnyPlay(cur)) hostApply(meRef.current.id, { type: 'flip' })
      else {
        // 人間の思考待ち: 状態は変わらないので再スケジュールのためダミー更新はせず再走查
        stateSeqRef.current += 0
        setGame((g) => (g === cur ? { ...cur } : g)) // 再評価トリガー
      }
    }, 1000)
    npcTimerRef.current = t
    return () => clearTimeout(t)
  }, [game, room, me, hostApply])

  // ---- 終局後は結果を数秒見せて待機画面へ ----
  useEffect(() => {
    if (game?.phase !== 'ended' || !game.result) return
    const t = setTimeout(() => {
      let txt
      if (game.mode === 'speed') {
        txt = game.result.winner === null ? '引き分け' : `${game.players[game.result.winner].name}の勝ち！`
      } else {
        txt = game.result.ranking.map((r) => `${r.rank}位 ${r.name}`).join(' / ')
      }
      setLastResult(txt)
      setGame(null)
      gameRef.current = null
    }, 6000)
    return () => clearTimeout(t)
  }, [game])

  // ============================================================
  // 描画
  // ============================================================
  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#0d1020', color: '#88ccff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>読み込み中…</div>
  }
  if (blocked) {
    return (
      <div style={{ minHeight: '100vh', background: '#0d1020', color: '#ff6644', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
        <div>この機能は現在開発中です</div>
        <button onClick={() => nav('/game')} style={btnStyle('#88ccff', { padding: '8px 16px' })}>街に戻る</button>
      </div>
    )
  }

  const wrap = (children) => (
    <div style={{ minHeight: '100vh', background: '#0d1020', color: '#cde', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 12 }}>
      {children}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#112244', border: '1px solid #4488cc', color: '#cde', padding: '8px 16px', fontSize: 12, zIndex: 60, whiteSpace: 'nowrap' }}>{toast}</div>
      )}
    </div>
  )

  // ---- ロビー ----
  if (view === 'lobby') {
    return wrap(
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <button onClick={() => nav('/game')} style={btnStyle('#88ccff')}>← 街に戻る</button>
          <div style={{ color: '#ffcc44', fontSize: 14 }}>🃏 トランプ広場[開発]</div>
          <div style={{ width: 76 }} />
        </div>
        <div style={{ border: '1px solid #224466', padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: '#88ccff', marginBottom: 8 }}>部屋を立てる</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {Object.entries(GAME_DEFS).map(([key, d]) => (
              <button key={key} onClick={() => setGameType(key)}
                style={btnStyle(gameType === key ? '#ffcc44' : '#446688', { fontSize: 12, background: gameType === key ? 'rgba(255,204,68,0.1)' : 'none' })}>
                {d.name}({d.min}〜{d.max}人)
              </button>
            ))}
          </div>
          {gameType === 'daifugo' && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: '#88ccff', marginBottom: 4 }}>大富豪の追加ルール</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[['kaidan', '階段'], ['shibari', 'しばり'], ['miyako', '都落ち']].map(([key, label]) => (
                  <button key={key} onClick={() => setDfRules((r) => ({ ...r, [key]: !r[key] }))}
                    style={btnStyle(dfRules[key] ? '#ffcc44' : '#446688', { fontSize: 11, background: dfRules[key] ? 'rgba(255,204,68,0.1)' : 'none' })}>
                    {dfRules[key] ? '✓ ' : ''}{label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 9, color: '#668', marginTop: 3 }}>階段=同スート3枚以上の連番 / しばり=スート一致で以後同スート限定 / 都落ち=前回1位が1位を逃すと即最下位(2戦目から)</div>
            </div>
          )}
          <div style={{ fontSize: 11, color: '#88ccff', marginBottom: 4 }}>💰 賭けGold(0=賭けなし・人間2人以上で成立・1位総取り)</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {BET_PRESETS.map((b) => (
              <button key={b} onClick={() => setBet(b)}
                style={btnStyle(Number(bet) === b ? '#ffcc44' : '#446688', { fontSize: 11 })}>
                {b === 0 ? 'なし' : `${b.toLocaleString()}G`}
              </button>
            ))}
            <input type="number" value={bet} min={0} max={MAX_BET} onChange={(e) => setBet(e.target.value)}
              style={{ width: 100, background: '#001122', border: '1px solid #224466', color: '#ffcc44', padding: '4px 6px', fontFamily: 'monospace', fontSize: 11 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} maxLength={20}
              placeholder={`${me.name}の${GAME_DEFS[gameType].name}`}
              style={{ flex: 1, background: '#001122', border: '1px solid #224466', color: '#cde', padding: '6px 8px', fontFamily: 'monospace', fontSize: 12 }}
            />
            <button onClick={createRoom} style={btnStyle('#ffcc44')}>作成</button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#88ccff', marginBottom: 8 }}>部屋一覧</div>
        {rooms.length === 0 && <div style={{ fontSize: 12, color: '#668' }}>現在開いている部屋はありません</div>}
        {rooms.map((r) => (
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
              <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName, gameType: r.gameType, bet: r.bet, rules: r.rules })} style={btnStyle('#88ccff')}>観戦入室</button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName, gameType: r.gameType, bet: r.bet, rules: r.rules })} style={btnStyle('#44dd88')}>プレイ</button>
                <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName, gameType: r.gameType, bet: r.bet, rules: r.rules }, true)} style={btnStyle('#88ccff')}>観戦</button>
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

  // ---- 待機画面 ----
  if (!game) {
    return wrap(
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={leaveRoom} style={btnStyle('#88ccff')}>← 退室</button>
          <div style={{ color: '#ffcc44', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '48%' }}>[{def.name}] {room.title}</div>
          {isHost ? <button onClick={startGame} disabled={betBusy} style={btnStyle('#ffcc44', { opacity: betBusy ? 0.5 : 1 })}>{betBusy ? '供託待ち…' : '対局開始'}</button> : <div style={{ width: 60 }} />}
        </div>
        <div style={{ border: '1px solid #224466', padding: '8px 12px', fontSize: 12 }}>
          {room.bet > 0 && (
            <div style={{ border: '1px solid #8a6a22', background: 'rgba(255,170,0,0.08)', padding: '4px 8px', marginBottom: 6, color: '#ffaa00', fontSize: 11 }}>
              💰 賭け対局: 1人 {Number(room.bet).toLocaleString()}G(人間2人以上で成立・1位総取り・NPC勝ち/引き分けは返金)
            </div>
          )}
          {lastResult && (
            <div style={{ border: '1px solid #665522', background: 'rgba(255,204,68,0.07)', padding: '4px 8px', marginBottom: 6, color: '#ffcc44', fontSize: 11 }}>
              前回の結果: {lastResult}
            </div>
          )}
          <div style={{ color: '#88ccff', marginBottom: 4 }}>
            対局者({def.min}〜{def.max}人)
            {room.gameType === 'daifugo' && rulesLabel(room.rules) && <span style={{ color: '#aa88cc', marginLeft: 8 }}>ルール: {rulesLabel(room.rules)}</span>}
          </div>
          {seated.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{i + 1}. {p.name}{p.id === room.hostId ? ' (ホスト)' : ''}</span>
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
          <button onClick={() => setSpectatorMode(!meSpec)} style={btnStyle(meSpec ? '#44dd88' : '#88ccff', { marginTop: 8, padding: '4px 10px', fontSize: 11 })}>
            {meSpec ? '⚔ 対局に参加する' : '👀 観戦にまわる'}
          </button>
        </div>
      </div>
    )
  }

  // ---- ゲーム画面(共通ヘッダー) ----
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, width: '100%' }}>
      <button onClick={leaveRoom} style={btnStyle('#88ccff')}>← 退室</button>
      <div style={{ color: '#ffcc44', fontSize: 12 }}>
        [{def.name}] {room.bet > 0 && wagerKeyRef.current ? `💰${Number(room.bet).toLocaleString()}G` : ''}
      </div>
      <div style={{ fontSize: 11, color: '#668' }}>{mySeat === -1 ? '👀 観戦中' : ''}</div>
    </div>
  )

  const resultPanel = game.phase === 'ended' && (
    <div style={{ border: '1px solid #ffcc44', padding: 10, marginTop: 10, width: '100%' }}>
      <div style={{ color: '#ffcc44', fontSize: 13, marginBottom: 6 }}>結果</div>
      {game.mode === 'speed' ? (
        <div style={{ fontSize: 13 }}>{game.result.winner === null ? '引き分け' : `🏆 ${game.players[game.result.winner].name} の勝ち！`}
          <span style={{ color: '#668', fontSize: 11, marginLeft: 8 }}>残り枚数 {game.result.left[0]} - {game.result.left[1]}</span>
        </div>
      ) : (
        game.result.ranking.map((r) => (
          <div key={r.seat} style={{ fontSize: 12, color: r.rank === 1 ? '#ffcc44' : '#cde' }}>
            {r.rank}位 {r.name}{r.burst ? ' (バースト)' : ''}
          </div>
        ))
      )}
      <div style={{ fontSize: 10, color: '#668', marginTop: 6 }}>まもなく待機画面に戻ります…</div>
    </div>
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
        {game.players.map((p, s) => (
          <div key={s} style={{ border: `1px solid ${playing && game.turn === s ? '#ffcc44' : '#223355'}`, padding: '6px 8px', marginBottom: 6, background: s === mySeat ? '#101830' : 'transparent' }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: playing && game.turn === s ? '#ffcc44' : '#cde' }}>{p.name}{s === mySeat ? '(あなた)' : ''}</span>
              <span style={{ color: '#668', marginLeft: 8 }}>{p.out ? `${p.rank}位あがり` : `残り${p.hand.length}枚`}</span>
              {playing && game.turn === s && <span style={{ color: '#ff8866', marginLeft: 8 }}>← 引く番</span>}
            </div>
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {s === mySeat
                ? p.hand.map((c) => <TCard key={c.id} c={c} small />)
                : p.hand.map((c, i) => (
                  <TBack key={c.id} small
                    onClick={myTurn && s === target ? () => sendAction({ type: 'draw', index: i }) : undefined} />
                ))}
            </div>
          </div>
        ))}
        {myTurn && <div style={{ color: '#9fd', fontSize: 12, textAlign: 'center' }}>▲ {game.players[target]?.name} の札を1枚タップして引く</div>}
        {resultPanel}
      </div>
    )
  }

  // ---- 7ならべ ----
  if (game.mode === 'sevens') {
    const myHand = mySeat >= 0 ? game.players[mySeat].hand : []
    return wrap(
      <div style={{ width: '100%', maxWidth: 600 }}>
        {header}
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
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {myHand.map((c) => {
                const ok = sevensPlayable(game, c)
                return <TCard key={c.id} c={c} sel={false} dim={myTurn && !ok}
                  onClick={myTurn && ok ? () => sendAction({ type: 'play', cardId: c.id }) : undefined} />
              })}
            </div>
            {myTurn && (
              <button onClick={() => sendAction({ type: 'pass' })} style={btnStyle('#ff8866', { marginTop: 8 })}>
                パス(残{3 - game.players[mySeat].passes}回 / 0で💥バースト)
              </button>
            )}
          </div>
        )}
        {resultPanel}
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, marginBottom: 6 }}>
          {game.players.map((p, s) => (
            <span key={s} style={{ color: playing && game.turn === s ? '#ffcc44' : p.out ? '#556' : '#cde' }}>
              {p.name}: {p.out ? `${p.rank}位` : `${p.hand.length}枚`}
              {game.passed[s] && !p.out ? <span style={{ color: '#668' }}>(パス)</span> : ''}
            </span>
          ))}
          {game.revolution && <span style={{ color: '#ff4444' }}>⚡革命中</span>}
          {game.field?.lock && <span style={{ color: '#ffcc44' }}>🔒しばり({game.field.lock.map((s) => SUIT_LABEL[s]).join('')})</span>}
        </div>
        <div style={{ background: '#0a2a18', border: '2px solid #1a5535', borderRadius: 6, padding: 10, minHeight: 70, display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          {game.field
            ? game.field.cards.map((c) => <TCard key={c.id} c={c} />)
            : <span style={{ color: '#557', fontSize: 12 }}>場は空(好きな札を出せます)</span>}
        </div>
        {mySeat >= 0 && game.phase !== 'ended' && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {myHand.map((c) => (
                <TCard key={c.id} c={c} sel={selCards.includes(c.id)}
                  onClick={myTurn ? () => toggleSel(c.id) : undefined} />
              ))}
            </div>
            {myTurn && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => { sendAction({ type: 'play', cardIds: selCards }); }} disabled={!canPlay}
                  style={btnStyle(canPlay ? '#ffcc44' : '#445', { fontSize: 14, opacity: canPlay ? 1 : 0.5 })}>出す({selCards.length}枚)</button>
                {game.field && <button onClick={() => sendAction({ type: 'pass' })} style={btnStyle('#ff8866', { fontSize: 14 })}>パス</button>}
              </div>
            )}
          </div>
        )}
        {resultPanel}
      </div>
    )
  }

  // ---- スピード ----
  if (game.mode === 'speed') {
    const opSeat = mySeat === 0 ? 1 : 0
    const renderSide = (seat, mine) => {
      const p = game.players[seat]
      return (
        <div style={{ border: '1px solid #223355', padding: 8, width: '100%' }}>
          <div style={{ fontSize: 11, color: '#cde', marginBottom: 4 }}>{p.name}{mine ? '(あなた)' : ''} <span style={{ color: '#668' }}>山札{p.stock.length}枚</span></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {p.slots.map((c, i) => c
              ? <TCard key={c.id} c={c} sel={mine && selCards[0] === i}
                  onClick={mine && playing ? () => setSelCards([i]) : undefined} />
              : <div key={i} style={{ width: 38, height: 54 }} />)}
          </div>
        </div>
      )
    }
    return wrap(
      <div style={{ width: '100%', maxWidth: 420 }}>
        {header}
        {mySeat !== 0 && renderSide(0, mySeat === 0)}
        {mySeat === 0 && renderSide(1, false)}
        {mySeat === -1 && null}
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', margin: '10px 0', alignItems: 'center' }}>
          {game.piles.map((c, i) => (
            <button key={i} onClick={mySeat >= 0 && playing && selCards.length > 0 ? () => { sendAction({ type: 'play', slot: selCards[0], pile: i }); setSelCards([]) } : undefined}
              disabled={!(mySeat >= 0 && playing && selCards.length > 0)}
              style={{ background: 'none', border: selCards.length > 0 ? '2px dashed #ffcc44' : 'none', borderRadius: 6, padding: 4, cursor: selCards.length > 0 ? 'pointer' : 'default' }}>
              {c ? <TCard c={c} /> : <div style={{ width: 38, height: 54 }} />}
            </button>
          ))}
        </div>
        {renderSide(mySeat >= 0 ? mySeat : 1, mySeat >= 0)}
        {mySeat >= 0 && playing && <div style={{ fontSize: 11, color: '#9fd', textAlign: 'center', marginTop: 6 }}>自分の札をタップ → 台札(±1)をタップ。早い者勝ち！</div>}
        {resultPanel}
      </div>
    )
  }

  return wrap(<div>不明なゲームです</div>)
}
