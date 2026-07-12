import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { reportDevAccess } from '../lib/devAccess'
import {
  KIND_NAMES, createMahjongGame, applyMahjong, getTurnOptions, getClaimOptions,
  npcDecide, autoActionFor, isNpcId, doraFromIndicator,
  MIN_MAHJONG_PLAYERS, MAX_MAHJONG_PLAYERS, TURN_SEC, CLAIM_SEC,
} from '../lib/mahjong'
import { TileFace, TileBackFace } from '../components/MahjongTile'

// ============================================================
// 麻雀(雀魂風) — 開発限定のミニゲーム(娯楽・ステ影響なし)
// 部屋: Supabase Realtime presence(ロビー一覧) + broadcast(ゲーム同期)
// ホスト権威型・SQLテーブル不要。4人東風戦 / 3人サンマ東風戦
// ============================================================

const LOBBY_CHANNEL = 'mahjong-lobby'
const roomChannelName = (roomId) => `mahjong-room-${roomId}`
const NPC_NAMES = ['ツモ吉', 'ロン子', 'カン太', 'ポン美']
const WINDS = ['東', '南', '西', '北']

const btnStyle = (color, extra = {}) => ({
  background: 'none', border: `1px solid ${color}`, color, padding: '6px 10px',
  cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', ...extra,
})

// ---- 牌表示(SVG描画) ----
function Tile({ k, r, small, dim, onClick, sel, disabled }) {
  const size = small ? { w: 24, h: 32 } : { w: 36, h: 48 }
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
  const [blocked, setBlocked] = useState(false)
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

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  // ---- 認証 + is_adminゲート ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).maybeSingle()
      if (cancelled) return
      if (!prof?.is_admin) {
        reportDevAccess('mahjong', '麻雀(/mahjong)')
        setBlocked(true)
        setLoading(false)
        return
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
    await lobbyChRef.current.track({
      roomId: r.id, title: r.title, hostId: r.hostId, hostName: r.hostName,
      count: membersRef.current.length + npcsRef.current.length, status,
    })
  }, [])

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
      payload: { seq: stateSeqRef.current, game: newState, events },
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
  const joinRoom = useCallback((roomInfo) => {
    const myself = meRef.current
    const ch = supabase.channel(roomChannelName(roomInfo.id), {
      config: { presence: { key: myself.id }, broadcast: { self: true } },
    })
    let hostSeen = false
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      const list = Object.keys(st).map((key) => ({ id: key, name: st[key][0]?.name || '?' }))
      list.sort((a, b) => (st[a.id][0]?.joinedAt || 0) - (st[b.id][0]?.joinedAt || 0))
      setMembers(list)
      membersRef.current = list
      if (roomInfo.hostId === myself.id) {
        // 復帰したプレイヤーは自動打ちを解除
        for (const m of list) autoRef.current.delete(m.id)
        publishRoom(gameRef.current && gameRef.current.phase !== 'ended' ? 'playing' : 'waiting')
        if (gameRef.current) {
          ch.send({ type: 'broadcast', event: 'state', payload: { seq: stateSeqRef.current, game: gameRef.current, events: [] } })
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
      setGame(payload.game)
      setRiichiMode(false); setChiPick(null); setKanPick(null)
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
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await ch.track({ name: myself.name, joinedAt: Date.now() })
    })
    roomChRef.current = ch
    setRoom(roomInfo); roomRef.current = roomInfo
    setView('room')
    setGame(null); gameRef.current = null
    stateSeqRef.current = 0
    autoRef.current = new Set()
  }, [hostApply, publishRoom])

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
    const title = roomTitle.trim() || `${me.name}の卓`
    const roomId = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 13)
    joinRoom({ id: roomId, title, hostId: me.id, hostName: me.name })
  }

  const seated = [...members, ...npcs].slice(0, MAX_MAHJONG_PLAYERS)
  const addNpc = () => {
    if (membersRef.current.length + npcsRef.current.length >= MAX_MAHJONG_PLAYERS) { showToast(`最大${MAX_MAHJONG_PLAYERS}人です`); return }
    const used = new Set(npcsRef.current.map((n) => n.name))
    const base = NPC_NAMES.find((n) => !used.has(`🀄${n}`)) || `NPC${npcsRef.current.length + 1}`
    setNpcs((prev) => [...prev, { id: `npc-lv3-${prev.length + 1}-${Date.now() % 100000}`, name: `🀄${base}` }])
  }
  const removeNpc = (id) => setNpcs((prev) => prev.filter((n) => n.id !== id))
  useEffect(() => {
    if (room && room.hostId === me?.id) publishRoom(game && game.phase !== 'ended' ? 'playing' : 'waiting')
  }, [npcs]) // eslint-disable-line react-hooks/exhaustive-deps

  const startGame = () => {
    const list = [...membersRef.current, ...npcsRef.current].slice(0, MAX_MAHJONG_PLAYERS)
    if (list.length < MIN_MAHJONG_PLAYERS) { showToast(`麻雀は${MIN_MAHJONG_PLAYERS}人から。NPCを追加してください`); return }
    const order = list.map((p) => ({ id: p.id, name: p.name }))
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    hostBroadcast(createMahjongGame({ players: order }), [])
    publishRoom('playing')
  }

  const sendAction = useCallback((action) => {
    roomChRef.current?.send({ type: 'broadcast', event: 'action', payload: { playerId: meRef.current.id, action } })
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
      const action = isNpcId(actorId) ? npcDecide(cur, seat) : autoActionFor(cur, seat)
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
  if (blocked) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a1a0f', color: '#ff6644', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
        <div>この機能は現在開発中です</div>
        <button onClick={() => nav('/game')} style={btnStyle('#88ccff', { padding: '8px 16px' })}>街に戻る</button>
      </div>
    )
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
        <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 70 }}>
          <div style={{
            fontSize: 68, fontWeight: 'bold', color: '#ff4422', fontFamily: "'Hiragino Mincho ProN','Yu Mincho',serif",
            textShadow: '0 0 24px rgba(0,0,0,0.9), 3px 3px 0 #550000, -2px -2px 0 #ffcc44',
            animation: 'mjsplash 1.7s ease-out both',
          }}>{splash.what}！</div>
          <div style={{ fontSize: 16, color: '#ffcc44', textShadow: '0 0 8px #000', marginTop: 4, animation: 'mjsplash 1.7s ease-out both' }}>{splash.name}</div>
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
          <div style={{ color: '#ffcc44', fontSize: 14 }}>🀄 麻雀[開発]</div>
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
              <div style={{ fontSize: 10, color: '#668' }}>主: {r.hostName} / {r.count}人 / {r.status === 'playing' ? '🟢 対局中(観戦可)' : '🟡 募集中'}</div>
            </div>
            <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName })} style={btnStyle('#44dd88')}>入室</button>
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
          {isHost ? <button onClick={startGame} style={btnStyle('#ffcc44')}>対局開始</button> : <div style={{ width: 60 }} />}
        </div>
        <div style={{ border: '1px solid #224466', padding: '8px 12px', fontSize: 12 }}>
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
          {[...members, ...npcs].length > MAX_MAHJONG_PLAYERS && (
            <div style={{ color: '#668', marginTop: 4 }}>観戦: {[...members, ...npcs].slice(MAX_MAHJONG_PLAYERS).map((m) => m.name).join(', ')}</div>
          )}
        </div>
      </div>
    )
  }

  // ---- 対局画面 ----
  const n = game.players.length
  const dora = game.doraTiles.slice(0, game.doraRevealed)
  const windOf = (seat) => WINDS[(seat - game.round.dealer + n) % n]

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
                  <Tile k={d.k} r={d.r} small dim={d.called} />
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
                      ? (<><TileBack small /><Tile k={m.k} small /><Tile k={m.k} small /><TileBack small /></>)
                      : m.tiles.map((t, j) => <Tile key={j} k={t.k} r={t.r} small />)}
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

  const canDiscard = turnOpts && !turnOpts.riichi
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
          東{game.round.num}局 {game.round.honba > 0 ? `${game.round.honba}本場` : ''} 供託{game.round.sticks}
        </div>
        <div style={{ fontSize: 11, color: '#668' }}>山 {game.wall.length}枚</div>
      </div>

      {/* ドラ表示 */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8, fontSize: 11 }}>
        <span style={{ color: '#88ccff' }}>ドラ表示:</span>
        {dora.map((k, i) => <Tile key={i} k={k} small />)}
        <span style={{ color: '#668', marginLeft: 6 }}>(ドラ: {dora.map((k) => KIND_NAMES[doraFromIndicator(k)]).join(' ')})</span>
      </div>

      {/* 各家 */}
      {game.players.map((_, s) => (s !== mySeat ? renderPlayerRow(s) : null))}
      {mySeat >= 0 && renderPlayerRow(mySeat)}

      {/* 自分の手牌 */}
      {mySeat >= 0 && game.phase !== 'ended' && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {game.hands[mySeat].map((t) => (
              <Tile key={t.id} k={t.k} r={t.r}
                onClick={myTurn ? () => onTileClick(t) : undefined}
                disabled={!!game.riichis[mySeat] || (riichiMode && !riichiDiscardable(t.k))}
                dim={riichiMode && !riichiDiscardable(t.k)}
              />
            ))}
            {game.drawn && game.drawnBy === mySeat && (
              <span style={{ marginLeft: 10, border: '2px solid #ffcc44', borderRadius: 6, padding: 2, boxShadow: '0 0 8px rgba(255,204,68,0.5)' }}>
                <Tile k={game.drawn.k} r={game.drawn.r}
                  onClick={myTurn ? () => onTileClick(game.drawn) : undefined}
                  dim={riichiMode && !riichiDiscardable(game.drawn.k)}
                />
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
                <div style={{ color: '#ffcc44', fontSize: 15, marginBottom: 8 }}>流局</div>
                {game.players.map((p, s) => (
                  <div key={s} style={{ fontSize: 12, marginBottom: 4 }}>
                    {p.name}: {game.roundResult.tenpai[s] ? <span style={{ color: '#44dd88' }}>テンパイ</span> : <span style={{ color: '#668' }}>ノーテン</span>}
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#88ccff', marginTop: 8 }}>
              {game.players.map((p, s) => <div key={s}>{p.name}: {p.score}点</div>)}
            </div>
            {isHost && (
              <button onClick={() => sendAction({ type: 'next' })} style={btnStyle('#ffcc44', { marginTop: 12, fontSize: 14 })}>
                {game.roundResult.gameOver ? '最終結果へ' : '次の局へ'}
              </button>
            )}
            {!isHost && <div style={{ fontSize: 11, color: '#668', marginTop: 10 }}>ホストの進行を待っています…</div>}
          </div>
        </div>
      )}

      {/* 最終結果 */}
      {game.phase === 'ended' && game.finalStandings && (
        <div style={{ border: '1px solid #ffcc44', padding: 12, marginTop: 10 }}>
          <div style={{ color: '#ffcc44', fontSize: 14, marginBottom: 8 }}>最終結果</div>
          {game.finalStandings.map((s, i) => (
            <div key={s.seat} style={{ fontSize: 13, color: i === 0 ? '#ffcc44' : '#cde' }}>
              {i + 1}位 {s.name}: {s.score}点
            </div>
          ))}
          {isHost && <button onClick={startGame} style={btnStyle('#ffcc44', { marginTop: 10 })}>もう一局</button>}
        </div>
      )}
    </div>
  )
}
