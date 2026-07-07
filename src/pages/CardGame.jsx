import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { reportDevAccess } from '../lib/devAccess'
import {
  CARDS, createGame, applyAction, applyDefenseTimeout, forfeitPlayer,
  npcChooseAction, isNpcId,
  MAX_PLAYERS, MAX_HP, MAX_MP, DEFENSE_TIMEOUT_SEC,
} from '../lib/cardbattle'

const NPC_NAMES = ['ゴブ太', 'スラりん', 'ドラ子', 'ケルベロ', 'ゾンビ夫', 'メデュ子', 'オーク蔵']

// ============================================================
// 幻札(げんさつ)バトル — 開発限定のカードバトル(娯楽・ステ影響なし)
// 部屋: Supabase Realtime presence(ロビー一覧) + broadcast(ゲーム同期)
// ホスト権威型: 部屋主のクライアントだけがエンジンを実行しstateを配信
// SQLテーブル不要(RealtimeチャンネルのみでDBに一切書き込まない)
// ============================================================

const LOBBY_CHANNEL = 'gensatsu-lobby'
const roomChannelName = (roomId) => `gensatsu-room-${roomId}`

const KIND_STYLE = {
  weapon:  { color: '#ff6644', icon: '⚔', label: '攻撃' },
  defense: { color: '#44aaff', icon: '🛡', label: '防御' },
  magic:   { color: '#aa88ff', icon: '✨', label: '魔法' },
  amulet:  { color: '#ffcc44', icon: '🔮', label: 'アミュレット' },
}

const btnStyle = (color, extra = {}) => ({
  background: 'none', border: `1px solid ${color}`, color, padding: '6px 10px',
  cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', ...extra,
})

export default function CardGame() {
  const nav = useNavigate()
  const [me, setMe] = useState(null) // { id, name }
  const [blocked, setBlocked] = useState(false)
  const [loading, setLoading] = useState(true)

  // view: lobby | room
  const [view, setView] = useState('lobby')
  const [rooms, setRooms] = useState([])
  const [roomTitle, setRoomTitle] = useState('')

  // 部屋の状態
  const [room, setRoom] = useState(null) // { id, title, hostId, hostName }
  const [members, setMembers] = useState([]) // presenceから [{ id, name }]
  const [npcs, setNpcs] = useState([]) // ホストが追加したNPC [{ id, name }]
  const [game, setGame] = useState(null)
  const [log, setLog] = useState([])
  const [toast, setToast] = useState(null)
  const [peekInfo, setPeekInfo] = useState(null) // 千里眼の結果 { targetName, hand }

  // 操作UI
  const [selCard, setSelCard] = useState(null) // 対象選択中のカードuid
  const [selEvolve, setSelEvolve] = useState(false)
  const [exchangeMode, setExchangeMode] = useState(false)
  const [exchangeSel, setExchangeSel] = useState([])
  const [alchemyCard, setAlchemyCard] = useState(null) // 錬成: 捨て札選択中のカードuid
  const [defLeft, setDefLeft] = useState(0)

  const lobbyChRef = useRef(null)
  const roomChRef = useRef(null)
  const gameRef = useRef(null)       // ホスト用: 最新state
  const stateSeqRef = useRef(0)
  const meRef = useRef(null)
  const roomRef = useRef(null)
  const membersRef = useRef([])
  const npcsRef = useRef([])
  const defTimerRef = useRef(null)
  const logEndRef = useRef(null)

  useEffect(() => { gameRef.current = game }, [game])
  useEffect(() => { meRef.current = me }, [me])
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { npcsRef.current = npcs }, [npcs])
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [log])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // ---- 認証 + is_adminゲート ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).maybeSingle()
      if (cancelled) return
      if (!prof?.is_admin) {
        reportDevAccess('cardbattle', '幻札バトル(/card-battle)')
        setBlocked(true)
        setLoading(false)
        return
      }
      setMe({ id: user.id, name: prof.username || '名無し' })
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [nav])

  // ---- ロビー: 部屋一覧(presence) ----
  // 常時接続: ホストは部屋にいる間もこのチャンネルで部屋を掲示し続ける
  useEffect(() => {
    if (!me) return
    const ch = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key: me.id } } })
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      const list = []
      for (const key of Object.keys(st)) {
        for (const meta of st[key]) {
          if (meta.roomId) list.push(meta)
        }
      }
      setRooms(list)
    })
    ch.subscribe()
    lobbyChRef.current = ch
    return () => { supabase.removeChannel(ch); lobbyChRef.current = null }
  }, [me])

  // ---- ホスト: ロビーへ部屋情報を掲示 ----
  const publishRoom = useCallback(async (status) => {
    const r = roomRef.current
    if (!r || r.hostId !== meRef.current?.id || !lobbyChRef.current) return
    await lobbyChRef.current.track({
      roomId: r.id, title: r.title, hostId: r.hostId, hostName: r.hostName,
      count: membersRef.current.length + npcsRef.current.length, status, // waiting | playing
    })
  }, [])

  // ---- ゲーム進行(ホストのみ): エンジン適用→配信 ----
  const hostBroadcast = useCallback((newState, events) => {
    gameRef.current = newState
    stateSeqRef.current += 1
    roomChRef.current?.send({
      type: 'broadcast', event: 'state',
      payload: { seq: stateSeqRef.current, game: newState, events },
    })
  }, [])

  const hostApply = useCallback((action) => {
    const cur = gameRef.current
    if (!cur) return false
    const r = applyAction(cur, action)
    if (r.error) {
      roomChRef.current?.send({ type: 'broadcast', event: 'reject', payload: { playerId: action.playerId, msg: r.error } })
      return false
    }
    // 応戦フェーズならタイムアウト期限を刻む
    if (r.state.pendingAttack) r.state.pendingAttack.deadline = Date.now() + DEFENSE_TIMEOUT_SEC * 1000
    hostBroadcast(r.state, r.events)
    return true
  }, [hostBroadcast])

  // ---- 部屋チャンネル(入室) ----
  const joinRoom = useCallback((roomInfo) => {
    const myself = meRef.current
    const ch = supabase.channel(roomChannelName(roomInfo.id), {
      config: { presence: { key: myself.id }, broadcast: { self: true } },
    })
    let hostSeen = false // 初回syncは自分のtrack反映前に来るため、ホスト在室を一度確認してから不在判定する
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState()
      const list = Object.keys(st).map((key) => ({ id: key, name: st[key][0]?.name || '?' }))
      // 入室順を安定させる(joined_atで整列)
      list.sort((a, b) => (st[a.id][0]?.joinedAt || 0) - (st[b.id][0]?.joinedAt || 0))
      setMembers(list)
      membersRef.current = list
      // ホスト: 掲示更新 + 途中参加者に現在のstateを再配信
      if (roomInfo.hostId === myself.id) {
        publishRoom(gameRef.current && gameRef.current.phase !== 'ended' ? 'playing' : 'waiting')
        if (gameRef.current) {
          ch.send({ type: 'broadcast', event: 'state', payload: { seq: stateSeqRef.current, game: gameRef.current, events: [] } })
        }
        return // 自分がホストなら不在判定は不要
      }
      // ホストが消えたら解散(在室を一度確認できた後のみ判定)
      if (list.some((m) => m.id === roomInfo.hostId)) {
        hostSeen = true
      } else if (hostSeen) {
        showToast('ホストが退室したため部屋は解散しました')
        leaveRoomRef.current?.()
      }
    })
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      // ホスト: 対戦中の切断は強制敗退
      if (roomInfo.hostId === myself.id && gameRef.current && gameRef.current.phase !== 'ended') {
        const r = forfeitPlayer(gameRef.current, key)
        if (r.events.length > 0) {
          if (r.state.pendingAttack) r.state.pendingAttack.deadline = Date.now() + DEFENSE_TIMEOUT_SEC * 1000
          hostBroadcast(r.state, r.events)
        }
      }
    })
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (payload.seq <= stateSeqRef.current && roomInfo.hostId !== myself.id) {
        // 同一seq再配信(途中参加向け)は初回のみ受理
        if (gameRef.current && payload.seq < stateSeqRef.current) return
      }
      stateSeqRef.current = payload.seq
      gameRef.current = payload.game
      setGame(payload.game)
      if (payload.events?.length) {
        setLog((prev) => [...prev.slice(-120), ...payload.events])
        for (const ev of payload.events) {
          if (ev.t === 'peek' && ev.actor === myself.id) {
            const target = payload.game.players.find((p) => p.id === ev.target)
            setPeekInfo({ targetName: target?.name || '?', hand: ev.hand })
          }
        }
      }
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
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ name: myself.name, joinedAt: Date.now() })
      }
    })
    roomChRef.current = ch
    setRoom(roomInfo)
    roomRef.current = roomInfo
    setView('room')
    setGame(null)
    gameRef.current = null
    stateSeqRef.current = 0
    setLog([])
  }, [hostApply, hostBroadcast, publishRoom])

  // ---- 退室 ----
  const leaveRoom = useCallback(() => {
    const r = roomRef.current
    if (r && r.hostId === meRef.current?.id) {
      roomChRef.current?.send({ type: 'broadcast', event: 'closed', payload: {} })
      lobbyChRef.current?.untrack()
    }
    if (roomChRef.current) { supabase.removeChannel(roomChRef.current); roomChRef.current = null }
    if (defTimerRef.current) { clearTimeout(defTimerRef.current); defTimerRef.current = null }
    setRoom(null); roomRef.current = null
    setGame(null); gameRef.current = null
    setMembers([]); membersRef.current = []
    setNpcs([]); npcsRef.current = []
    setLog([]); setSelCard(null); setExchangeMode(false); setExchangeSel([]); setAlchemyCard(null); setPeekInfo(null)
    setView('lobby')
  }, [])
  const leaveRoomRef = useRef(leaveRoom)
  useEffect(() => { leaveRoomRef.current = leaveRoom }, [leaveRoom])

  // アンマウント時にチャンネルを確実に掃除
  useEffect(() => () => {
    if (roomChRef.current) supabase.removeChannel(roomChRef.current)
    if (lobbyChRef.current) supabase.removeChannel(lobbyChRef.current)
    if (defTimerRef.current) clearTimeout(defTimerRef.current)
  }, [])

  // ---- 部屋を立てる ----
  const createRoom = () => {
    const title = roomTitle.trim() || `${me.name}の部屋`
    const roomId = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 13)
    joinRoom({ id: roomId, title, hostId: me.id, hostName: me.name })
  }

  // ---- NPC追加/削除(ホスト・待機中のみ) ----
  const addNpc = () => {
    if (membersRef.current.length + npcsRef.current.length >= MAX_PLAYERS) { showToast(`最大${MAX_PLAYERS}人です`); return }
    const used = new Set(npcsRef.current.map((n) => n.name))
    const name = NPC_NAMES.find((n) => !used.has(n)) || `NPC${npcsRef.current.length + 1}`
    setNpcs((prev) => [...prev, { id: `npc-${prev.length + 1}-${Date.now() % 100000}`, name: `🤖${name}` }])
  }
  const removeNpc = (id) => setNpcs((prev) => prev.filter((n) => n.id !== id))

  // NPC数が変わったらロビーの人数掲示を更新
  useEffect(() => {
    if (room && room.hostId === me?.id) publishRoom(game && game.phase !== 'ended' ? 'playing' : 'waiting')
  }, [npcs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- ゲーム開始(ホスト) ----
  const startGame = () => {
    const list = [...membersRef.current, ...npcsRef.current].slice(0, MAX_PLAYERS)
    if (list.length < 2) { showToast('NPCを追加するか、2人以上で開始してください'); return }
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
    const { state, events } = createGame({ players: list, seed })
    setLog([])
    hostBroadcast(state, events)
    publishRoom('playing')
  }

  // ---- アクション送信(全員共通・ホストも同じ経路) ----
  const sendAction = useCallback((action) => {
    roomChRef.current?.send({ type: 'broadcast', event: 'action', payload: { action } })
  }, [])

  // ---- 応戦タイムアウト(ホストが監視) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id) return
    if (defTimerRef.current) { clearTimeout(defTimerRef.current); defTimerRef.current = null }
    const pa = game?.pendingAttack
    if (!pa || game.phase !== 'defense') return
    const wait = Math.max(0, (pa.deadline || 0) - Date.now())
    defTimerRef.current = setTimeout(() => {
      const cur = gameRef.current
      if (cur?.phase === 'defense' && cur.pendingAttack &&
          cur.pendingAttack.attackerId === pa.attackerId && cur.pendingAttack.targetId === pa.targetId) {
        const r = applyDefenseTimeout(cur)
        if (r.state.pendingAttack) r.state.pendingAttack.deadline = Date.now() + DEFENSE_TIMEOUT_SEC * 1000
        hostBroadcast(r.state, [{ t: 'info', msg: '⌛ 時間切れ！' }, ...r.events])
      }
    }, wait + 300)
    return () => { if (defTimerRef.current) clearTimeout(defTimerRef.current) }
  }, [game, room, me, hostBroadcast])

  // ---- NPC自動進行(ホストが実行) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.phase === 'ended') return
    let npcId = null
    if (game.phase === 'defense') {
      if (isNpcId(game.pendingAttack?.targetId)) npcId = game.pendingAttack.targetId
    } else if (game.phase === 'main') {
      const cur = game.players[game.turnIndex]
      if (cur?.alive && isNpcId(cur.id)) npcId = cur.id
    }
    if (!npcId) return
    const seq = stateSeqRef.current
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return // 既に別の手で進行済み
      const cur = gameRef.current
      if (!cur || cur.phase === 'ended') return
      const action = npcChooseAction(cur, npcId)
      const ok = action ? hostApply(action) : false
      if (!ok) {
        // 想定外の手詰まりでもゲームを止めない(パス/素受けで進める)
        hostApply(cur.phase === 'defense'
          ? { type: 'defend', playerId: npcId, cardUid: null }
          : { type: 'pass', playerId: npcId })
      }
    }, 1000)
    return () => clearTimeout(t)
  }, [game, room, me, hostApply])

  // ---- 応戦の残り秒表示 ----
  useEffect(() => {
    const pa = game?.pendingAttack
    if (!pa || game.phase !== 'defense') { setDefLeft(0); return }
    const tick = () => setDefLeft(Math.max(0, Math.ceil(((pa.deadline || 0) - Date.now()) / 1000)))
    tick()
    const iv = setInterval(tick, 500)
    return () => clearInterval(iv)
  }, [game])

  // ---- カード操作 ----
  const myPlayer = game?.players.find((p) => p.id === me?.id)
  const isMyTurn = game && game.phase === 'main' && game.players[game.turnIndex]?.id === me?.id
  const isDefending = game?.phase === 'defense' && game.pendingAttack?.targetId === me?.id
  const isSpectator = game && !myPlayer

  const onCardClick = (card) => {
    if (!game || game.phase === 'ended') return
    const def = CARDS[card.id]
    // 応戦中: 防御カードのみ
    if (isDefending) {
      if (def.kind === 'defense') sendAction({ type: 'defend', playerId: me.id, cardUid: card.uid })
      else showToast('応戦には防御カードしか使えません')
      return
    }
    if (!isMyTurn) { showToast('あなたのターンではありません'); return }
    if (exchangeMode) {
      setExchangeSel((prev) => prev.includes(card.uid) ? prev.filter((u) => u !== card.uid) : (prev.length < 3 ? [...prev, card.uid] : prev))
      return
    }
    if (alchemyCard) {
      // 錬成の捨て札選択
      sendAction({ type: 'magic', playerId: me.id, cardUid: alchemyCard, discardUid: card.uid })
      setAlchemyCard(null)
      return
    }
    if (def.kind === 'defense') { showToast('防御カードは攻撃された時に使います'); return }
    if (def.kind === 'amulet') { sendAction({ type: 'amulet', playerId: me.id, cardUid: card.uid }); return }
    if (def.kind === 'magic') {
      if (def.alchemy) { setAlchemyCard(card.uid); showToast('捨てるカードを選んでください'); return }
      if (def.targeted) { setSelCard(card.uid); setSelEvolve(false); return }
      sendAction({ type: 'magic', playerId: me.id, cardUid: card.uid })
      return
    }
    // weapon
    if (def.aoe || def.multi) { sendAction({ type: 'attack', playerId: me.id, cardUid: card.uid }); return }
    setSelCard(card.uid)
    setSelEvolve(false)
  }

  const onTargetClick = (targetId) => {
    if (!selCard) return
    const card = myPlayer?.hand.find((c) => c.uid === selCard)
    if (!card) { setSelCard(null); return }
    const def = CARDS[card.id]
    if (def.kind === 'magic') sendAction({ type: 'magic', playerId: me.id, cardUid: selCard, targetId })
    else sendAction({ type: 'attack', playerId: me.id, cardUid: selCard, targetId, evolve: selEvolve })
    setSelCard(null); setSelEvolve(false)
  }

  // ============================================================
  // 描画
  // ============================================================
  if (loading) return <div style={{ minHeight: '100vh', background: '#000818', color: '#8899aa', fontFamily: 'monospace', padding: '40px', textAlign: 'center' }}>読み込み中…</div>

  if (blocked) return (
    <div style={{ minHeight: '100vh', background: '#000818', color: '#8899aa', fontFamily: 'monospace', padding: '40px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: '28px', marginBottom: '12px' }}>🎴</div>
      <div style={{ color: '#ffcc44', marginBottom: '8px' }}>幻札バトルは現在開発中です</div>
      <div style={{ fontSize: '12px', marginBottom: '24px' }}>公開までお待ちください</div>
      <button onClick={() => nav('/game')} style={btnStyle('#446688')}>← 街に戻る</button>
    </div>
  )

  const selDef = selCard ? CARDS[myPlayer?.hand.find((c) => c.uid === selCard)?.id]?.kind === 'weapon' : false

  return (
    <div style={{ minHeight: '100vh', background: '#000818', color: '#ccddee', fontFamily: 'monospace', paddingBottom: '40px' }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #223355', background: '#00101f' }}>
        <div style={{ color: '#ffcc44', fontSize: '14px' }}>🎴 幻札バトル <span style={{ fontSize: '10px', color: '#8877aa' }}>[開発]</span></div>
        {view === 'lobby'
          ? <button onClick={() => nav('/game')} style={btnStyle('#446688')}>← 街に戻る</button>
          : <button onClick={leaveRoom} style={btnStyle('#ff6644')}>🚪 退室</button>}
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: '52px', left: '50%', transform: 'translateX(-50%)', background: '#331100', border: '1px solid #ff8844', color: '#ffaa66', padding: '8px 16px', zIndex: 300, fontSize: '12px' }}>{toast}</div>
      )}

      {/* ================= ロビー ================= */}
      {view === 'lobby' && (
        <div style={{ maxWidth: '560px', margin: '0 auto', padding: '16px 12px' }}>
          <div style={{ fontSize: '11px', color: '#667788', marginBottom: '16px', lineHeight: 1.7 }}>
            配られたカードで殴り合い、最後まで生き残った者が勝つカードバトル。<br />
            ファンファーレ・ラストワード・アミュレット・進化などの能力を駆使しよう。<br />
            ※娯楽コンテンツです。ステータス・報酬には一切影響しません。最大{MAX_PLAYERS}人。
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
            <input value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} placeholder="部屋名(省略可)" maxLength={20}
              style={{ flex: 1, background: '#001028', border: '1px solid #334466', color: '#ccddee', padding: '8px', fontFamily: 'monospace', fontSize: '12px' }} />
            <button onClick={createRoom} style={btnStyle('#44ddaa', { padding: '8px 14px' })}>＋ 部屋を立てる</button>
          </div>

          <div style={{ color: '#88aacc', fontSize: '12px', marginBottom: '8px' }}>― 部屋一覧 ―</div>
          {rooms.length === 0 && <div style={{ color: '#556677', fontSize: '12px', padding: '16px', textAlign: 'center' }}>部屋がありません。立ててみよう！</div>}
          {rooms.map((r) => (
            <div key={r.roomId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #223355', background: '#001028', padding: '10px 12px', marginBottom: '8px' }}>
              <div>
                <div style={{ fontSize: '13px', color: '#ffcc44' }}>{r.title}</div>
                <div style={{ fontSize: '10px', color: '#667788' }}>ホスト: {r.hostName} ／ {r.count}人 ／ {r.status === 'playing' ? '🔴 対戦中' : '🟢 募集中'}</div>
              </div>
              <button
                disabled={r.status === 'playing' || r.count >= MAX_PLAYERS}
                onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName })}
                style={btnStyle(r.status === 'playing' || r.count >= MAX_PLAYERS ? '#445566' : '#44aaff', { opacity: r.status === 'playing' || r.count >= MAX_PLAYERS ? 0.5 : 1 })}>
                入室
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ================= 部屋(待機/対戦) ================= */}
      {view === 'room' && room && (
        <div style={{ maxWidth: '640px', margin: '0 auto', padding: '12px' }}>
          {/* --- 待機中 --- */}
          {!game && (
            <div>
              <div style={{ color: '#ffcc44', fontSize: '13px', marginBottom: '4px' }}>{room.title}</div>
              <div style={{ fontSize: '11px', color: '#667788', marginBottom: '16px' }}>ホスト: {room.hostName} ／ {members.length + npcs.length}/{MAX_PLAYERS}人</div>
              <div style={{ marginBottom: '20px' }}>
                {members.map((m, i) => (
                  <div key={m.id} style={{ padding: '8px 12px', border: '1px solid #223355', background: '#001028', marginBottom: '6px', fontSize: '12px' }}>
                    {i + 1}. {m.name} {m.id === room.hostId && <span style={{ color: '#ffcc44', fontSize: '10px' }}>👑 ホスト</span>} {m.id === me.id && <span style={{ color: '#44ddaa', fontSize: '10px' }}>(あなた)</span>}
                  </div>
                ))}
                {npcs.map((n, i) => (
                  <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid #223355', background: '#0a0d20', marginBottom: '6px', fontSize: '12px' }}>
                    <span>{members.length + i + 1}. {n.name} <span style={{ color: '#8877aa', fontSize: '10px' }}>NPC</span></span>
                    {room.hostId === me.id && <button onClick={() => removeNpc(n.id)} style={btnStyle('#ff6644', { fontSize: '10px', padding: '2px 8px' })}>外す</button>}
                  </div>
                ))}
              </div>
              {room.hostId === me.id && (
                <button onClick={addNpc} disabled={members.length + npcs.length >= MAX_PLAYERS}
                  style={btnStyle(members.length + npcs.length >= MAX_PLAYERS ? '#445566' : '#aa88ff', { width: '100%', padding: '10px', marginBottom: '8px', opacity: members.length + npcs.length >= MAX_PLAYERS ? 0.5 : 1 })}>
                  🤖 NPCを追加
                </button>
              )}
              {room.hostId === me.id
                ? <button onClick={startGame} disabled={members.length + npcs.length < 2} style={btnStyle(members.length + npcs.length >= 2 ? '#44ddaa' : '#445566', { width: '100%', padding: '12px', fontSize: '14px', opacity: members.length + npcs.length >= 2 ? 1 : 0.5 })}>
                    ▶ ゲーム開始 {members.length + npcs.length < 2 && '(NPC追加でひとりでも遊べます)'}
                  </button>
                : <div style={{ textAlign: 'center', color: '#667788', fontSize: '12px' }}>ホストの開始を待っています…</div>}
            </div>
          )}

          {/* --- 対戦中 --- */}
          {game && (
            <div>
              {/* プレイヤーボード */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px', marginBottom: '10px' }}>
                {game.players.map((p) => {
                  const isTurn = game.phase !== 'ended' && game.players[game.turnIndex]?.id === p.id
                  const isTargetable = selCard && p.alive && p.id !== me.id
                  const isDefTarget = game.phase === 'defense' && game.pendingAttack?.targetId === p.id
                  return (
                    <div key={p.id} onClick={() => isTargetable && onTargetClick(p.id)}
                      style={{
                        border: `1px solid ${isTurn ? '#ffcc44' : isTargetable ? '#ff6644' : '#223355'}`,
                        background: p.alive ? (isTargetable ? '#200800' : '#001028') : '#0a0a12',
                        padding: '6px 8px', fontSize: '11px', opacity: p.alive ? 1 : 0.45,
                        cursor: isTargetable ? 'pointer' : 'default',
                        boxShadow: isTurn ? '0 0 6px #ffcc4455' : 'none',
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: p.id === me.id ? '#44ddaa' : '#ccddee' }}>{!p.alive && '💀'}{isTurn && '▶'}{p.name}</span>
                        {isDefTarget && <span style={{ color: '#ff8844', fontSize: '9px' }}>応戦中{defLeft}s</span>}
                      </div>
                      <div style={{ color: '#ff6666' }}>HP {p.hp}/{MAX_HP} <span style={{ color: '#223355' }}>|</span> <span style={{ color: '#66aaff' }}>MP {p.mp}/{MAX_MP}</span></div>
                      <div style={{ fontSize: '9px', color: '#8899aa' }}>
                        札{p.hand.length} 進化{'★'.repeat(p.evolveStock)}{p.poison > 0 && <span style={{ color: '#aa66ff' }}> ☠毒{p.poison}</span>}
                      </div>
                      {p.amulets.length > 0 && (
                        <div style={{ fontSize: '9px', color: '#ffcc44' }}>
                          {p.amulets.map((am) => `🔮${CARDS[am.id].name}(${am.count})`).join(' ')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 状況バー */}
              <div style={{ border: '1px solid #223355', background: '#000d1a', padding: '6px 10px', fontSize: '11px', marginBottom: '8px', color: '#ffcc44' }}>
                {game.phase === 'ended'
                  ? <span>🏁 対戦終了！ {room.hostId === me.id && <button onClick={startGame} style={btnStyle('#44ddaa', { marginLeft: '8px', fontSize: '11px', padding: '2px 8px' })}>もう一度</button>}</span>
                  : game.phase === 'defense'
                    ? (isDefending
                        ? <span style={{ color: '#ff8844' }}>⚔ {game.players.find((p) => p.id === game.pendingAttack.attackerId)?.name} の {game.pendingAttack.cardName}({game.pendingAttack.dmg}ダメージ)が飛んでくる！ 防御カードを選ぶか受け止めろ！({defLeft}s)</span>
                        : <span>{game.players.find((p) => p.id === game.pendingAttack.targetId)?.name} の応戦を待っています…({defLeft}s)</span>)
                    : isMyTurn
                      ? <span style={{ color: '#44ffaa' }}>▶ あなたのターン！ {selCard ? (selDef ? '攻撃対象をタップ' : '対象をタップ') : 'カードを選ぼう'}</span>
                      : <span>{game.players[game.turnIndex]?.name} のターン…</span>}
              </div>

              {/* ログ */}
              <div style={{ border: '1px solid #223355', background: '#000a14', height: '120px', overflowY: 'auto', padding: '6px 10px', fontSize: '10px', lineHeight: 1.7, marginBottom: '10px', color: '#99aabb' }}>
                {log.map((ev, i) => <div key={i} style={{ color: ev.t === 'death' ? '#ff6666' : ev.t === 'end' ? '#ffcc44' : ev.t === 'turn' ? '#557799' : undefined }}>{ev.msg}</div>)}
                <div ref={logEndRef} />
              </div>

              {/* 操作列 */}
              {myPlayer?.alive && game.phase !== 'ended' && (
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  {isMyTurn && !selCard && !exchangeMode && !alchemyCard && (
                    <>
                      <button onClick={() => { setExchangeMode(true); setExchangeSel([]) }} style={btnStyle('#88aacc')}>♻ カード交換(1〜3枚)</button>
                      <button onClick={() => sendAction({ type: 'pass', playerId: me.id })} style={btnStyle('#667788')}>⏭ パス</button>
                    </>
                  )}
                  {isMyTurn && selCard && selDef && myPlayer.evolveStock > 0 && (
                    <button onClick={() => setSelEvolve((v) => !v)} style={btnStyle(selEvolve ? '#ffcc44' : '#8877aa')}>
                      {selEvolve ? '★ 進化する(+3ダメージ)' : '☆ 進化を使う？(残' + myPlayer.evolveStock + ')'}
                    </button>
                  )}
                  {(selCard || alchemyCard) && (
                    <button onClick={() => { setSelCard(null); setSelEvolve(false); setAlchemyCard(null) }} style={btnStyle('#667788')}>✕ キャンセル</button>
                  )}
                  {exchangeMode && (
                    <>
                      <button disabled={exchangeSel.length === 0} onClick={() => { sendAction({ type: 'exchange', playerId: me.id, cardUids: exchangeSel }); setExchangeMode(false); setExchangeSel([]) }} style={btnStyle(exchangeSel.length ? '#44ddaa' : '#445566')}>交換する({exchangeSel.length}枚)</button>
                      <button onClick={() => { setExchangeMode(false); setExchangeSel([]) }} style={btnStyle('#667788')}>✕ やめる</button>
                    </>
                  )}
                  {isDefending && (
                    <button onClick={() => sendAction({ type: 'defend', playerId: me.id, cardUid: null })} style={btnStyle('#ff8844')}>🤜 防御せず受ける</button>
                  )}
                </div>
              )}

              {/* 手札 */}
              {myPlayer && (
                <div>
                  <div style={{ fontSize: '10px', color: '#667788', marginBottom: '4px' }}>― あなたの手札 ―</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}>
                    {myPlayer.hand.map((card) => {
                      const def = CARDS[card.id]
                      const ks = KIND_STYLE[def.kind]
                      const selected = selCard === card.uid || exchangeSel.includes(card.uid) || alchemyCard === card.uid
                      const usable = isDefending ? def.kind === 'defense' : isMyTurn
                      return (
                        <div key={card.uid} onClick={() => onCardClick(card)}
                          style={{
                            border: `1px solid ${selected ? '#ffcc44' : ks.color}`,
                            background: selected ? '#1a1400' : '#000d1a',
                            padding: '6px 8px', cursor: 'pointer', fontSize: '11px',
                            opacity: usable ? 1 : 0.55,
                          }}>
                          <div style={{ color: ks.color }}>{ks.icon} {def.name}{def.kind === 'magic' && <span style={{ color: '#66aaff', fontSize: '9px' }}> MP{def.mp}</span>}</div>
                          <div style={{ fontSize: '9px', color: '#8899aa', lineHeight: 1.5 }}>{def.desc}</div>
                        </div>
                      )
                    })}
                    {myPlayer.hand.length === 0 && <div style={{ color: '#556677', fontSize: '11px' }}>手札がありません</div>}
                  </div>
                </div>
              )}
              {isSpectator && <div style={{ textAlign: 'center', color: '#667788', fontSize: '12px', marginTop: '12px' }}>👀 観戦中(次のゲームから参加できます)</div>}
              {myPlayer && !myPlayer.alive && game.phase !== 'ended' && <div style={{ textAlign: 'center', color: '#ff6666', fontSize: '12px', marginTop: '12px' }}>💀 敗退… 決着まで観戦できます</div>}
            </div>
          )}
        </div>
      )}

      {/* 千里眼の結果 */}
      {peekInfo && (
        <div onClick={() => setPeekInfo(null)} style={{ position: 'fixed', inset: 0, background: '#000c', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#001028', border: '1px solid #aa88ff', padding: '16px', maxWidth: '360px', width: '90%' }}>
            <div style={{ color: '#aa88ff', fontSize: '13px', marginBottom: '10px' }}>👁 {peekInfo.targetName} の手札</div>
            {peekInfo.hand.map((id, i) => (
              <div key={i} style={{ fontSize: '11px', padding: '4px 0', borderBottom: '1px solid #112244', color: KIND_STYLE[CARDS[id].kind].color }}>
                {KIND_STYLE[CARDS[id].kind].icon} {CARDS[id].name}
              </div>
            ))}
            <button onClick={() => setPeekInfo(null)} style={btnStyle('#667788', { marginTop: '12px', width: '100%' })}>閉じる</button>
          </div>
        </div>
      )}
    </div>
  )
}
