import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { reportDevAccess } from '../lib/devAccess'
import {
  BLACK, WHITE, EMPTY, SIZE,
  validMoves, countStones, cpuChooseMove,
  createGame, applyGameMove, forfeitGame, colorOf, isNpcId,
} from '../lib/othello'

// ============================================================
// オセロ — 開発限定のミニゲーム(娯楽・ステ影響なし)
// 部屋: Supabase Realtime presence(ロビー一覧) + broadcast(ゲーム同期)
// ホスト権威型: 部屋主のクライアントだけがエンジンを実行しstateを配信
// SQLテーブル不要(RealtimeチャンネルのみでDBに一切書き込まない)
// ============================================================

const LOBBY_CHANNEL = 'othello-lobby'
const roomChannelName = (roomId) => `othello-room-${roomId}`

const NPC_NAMES = ['オセロ丸', 'リバー子', 'カドトリ翁']
const CPU_DELAY_MS = 800
// NPCの強さはidに埋め込む(npc-lv{n}-...)。stateの再配信/観戦でも失われない
const npcLevelOf = (id) => {
  const m = /^npc-lv(\d)-/.exec(id || '')
  return m ? Number(m[1]) : 3
}

const btnStyle = (color, extra = {}) => ({
  background: 'none', border: `1px solid ${color}`, color, padding: '6px 10px',
  cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', ...extra,
})

const stoneStyle = (color) => ({
  display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', verticalAlign: 'middle',
  background: color === BLACK ? 'radial-gradient(circle at 35% 30%, #555, #000)' : 'radial-gradient(circle at 35% 30%, #fff, #aaa)',
  border: '1px solid #333',
})

export default function Othello() {
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
  const [npc, setNpc] = useState(null) // ホストが追加したNPC { id, name }
  const [game, setGame] = useState(null)
  const [toast, setToast] = useState(null)
  const [passNote, setPassNote] = useState(null)

  const lobbyChRef = useRef(null)
  const roomChRef = useRef(null)
  const gameRef = useRef(null)   // ホスト用: 最新state
  const stateSeqRef = useRef(0)
  const meRef = useRef(null)
  const roomRef = useRef(null)
  const membersRef = useRef([])
  const npcRef = useRef(null)
  const cpuTimerRef = useRef(null)

  useEffect(() => { gameRef.current = game }, [game])
  useEffect(() => { meRef.current = me }, [me])
  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { membersRef.current = members }, [members])
  useEffect(() => { npcRef.current = npc }, [npc])

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
        reportDevAccess('othello', 'オセロ(/othello)')
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
      count: membersRef.current.length + (npcRef.current ? 1 : 0), status, // waiting | playing
    })
  }, [])

  // ---- ゲーム進行(ホストのみ): エンジン適用→配信 ----
  const hostBroadcast = useCallback((newState, events = []) => {
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
    const r = applyGameMove(cur, action.playerId, action.idx)
    if (r.error) {
      roomChRef.current?.send({ type: 'broadcast', event: 'reject', payload: { playerId: action.playerId, msg: r.error } })
      return false
    }
    hostBroadcast(r.state, r.events)
    if (r.state.phase === 'ended') publishRoom('waiting')
    return true
  }, [hostBroadcast, publishRoom])

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
      list.sort((a, b) => (st[a.id][0]?.joinedAt || 0) - (st[b.id][0]?.joinedAt || 0))
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
      // ホストが消えたら解散(在室を一度確認できた後のみ判定)
      if (list.some((m) => m.id === roomInfo.hostId)) {
        hostSeen = true
      } else if (hostSeen) {
        showToast('ホストが退室したため部屋は解散しました')
        leaveRoomRef.current?.()
      }
    })
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      // ホスト: 対局中の切断は不戦勝
      if (roomInfo.hostId === myself.id && gameRef.current?.phase === 'playing') {
        const ended = forfeitGame(gameRef.current, key)
        if (ended) {
          hostBroadcast(ended, [{ t: 'forfeit', name: gameRef.current.players[colorOf(gameRef.current, key)]?.name || '?' }])
          publishRoom('waiting')
        }
      }
    })
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (gameRef.current && payload.seq < stateSeqRef.current) return // 途中参加向け再配信は初回のみ受理
      stateSeqRef.current = payload.seq
      gameRef.current = payload.game
      setGame(payload.game)
      for (const ev of payload.events || []) {
        if (ev.t === 'pass') setPassNote(`${ev.name} はパス！`)
        if (ev.t === 'forfeit') showToast(`${ev.name} が切断したため不戦勝`)
      }
      if (!(payload.events || []).some((ev) => ev.t === 'pass')) setPassNote(null)
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
    setPassNote(null)
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
    setNpc(null); npcRef.current = null
    setPassNote(null)
    setView('lobby')
  }, [])
  const leaveRoomRef = useRef(leaveRoom)
  useEffect(() => { leaveRoomRef.current = leaveRoom }, [leaveRoom])

  // アンマウント時にチャンネルを確実に掃除
  useEffect(() => () => {
    if (roomChRef.current) supabase.removeChannel(roomChRef.current)
    if (lobbyChRef.current) supabase.removeChannel(lobbyChRef.current)
    if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current)
  }, [])

  // ---- 部屋を立てる ----
  const createRoom = () => {
    const title = roomTitle.trim() || `${me.name}の部屋`
    const roomId = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 13)
    joinRoom({ id: roomId, title, hostId: me.id, hostName: me.name })
  }

  // ---- NPC追加/削除(ホスト・対局中以外) ----
  const addNpc = (level) => {
    const name = NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)]
    setNpc({ id: `npc-lv${level}-${Date.now() % 100000}`, name: `🤖${name} LV${level}`, level })
  }
  const removeNpc = () => setNpc(null)

  // NPCの有無が変わったらロビーの人数掲示を更新
  useEffect(() => {
    if (room && room.hostId === me?.id) publishRoom(game?.phase === 'playing' ? 'playing' : 'waiting')
  }, [npc]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 対局者2名の決定: ホスト + (NPC or 最初に入室したゲスト) ----
  const pickOpponent = () => {
    if (npcRef.current) return npcRef.current
    return membersRef.current.find((m) => m.id !== meRef.current.id) || null
  }

  // ---- ゲーム開始(ホスト・色はランダム) ----
  const startGame = () => {
    const opp = pickOpponent()
    if (!opp) { showToast('対戦相手がいません(NPCを追加するか入室を待ってください)'); return }
    const hostP = { id: me.id, name: me.name }
    const [black, white] = Math.random() < 0.5 ? [hostP, opp] : [opp, hostP]
    setPassNote(null)
    hostBroadcast(createGame({ black, white }), [])
    publishRoom('playing')
  }

  // ---- 着手送信(全員共通・ホストも同じ経路) ----
  const sendMove = (idx) => {
    roomChRef.current?.send({ type: 'broadcast', event: 'action', payload: { action: { playerId: me.id, idx } } })
  }

  // ---- NPC自動着手(ホストが実行) ----
  useEffect(() => {
    if (!room || room.hostId !== me?.id || !game || game.phase !== 'playing') return
    const curPlayer = game.players[game.turn]
    if (!curPlayer || !isNpcId(curPlayer.id)) return
    const seq = stateSeqRef.current
    const t = setTimeout(() => {
      if (stateSeqRef.current !== seq) return // 既に別の手で進行済み
      const cur = gameRef.current
      if (!cur || cur.phase !== 'playing') return
      const mv = cpuChooseMove(cur.board, cur.turn, npcLevelOf(curPlayer.id))
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
  if (blocked) {
    return (
      <div style={{ minHeight: '100vh', background: '#000a14', color: '#ff6644', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
        <div>この機能は現在開発中です</div>
        <button onClick={() => nav('/game')} style={btnStyle('#88ccff', { padding: '8px 16px' })}>街に戻る</button>
      </div>
    )
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
          <div style={{ color: '#ffcc44', fontSize: '14px' }}>⚫ オセロ[開発]</div>
          <div style={{ width: '76px' }} />
        </div>

        <div style={{ border: '1px solid #224466', padding: '12px', marginBottom: '14px' }}>
          <div style={{ fontSize: '12px', color: '#88ccff', marginBottom: '8px' }}>部屋を立てる</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} maxLength={20}
              placeholder={`${me.name}の部屋`}
              style={{ flex: 1, background: '#001122', border: '1px solid #224466', color: '#cde', padding: '6px 8px', fontFamily: 'monospace', fontSize: '12px' }}
            />
            <button onClick={createRoom} style={btnStyle('#ffcc44')}>作成</button>
          </div>
          <div style={{ fontSize: '10px', color: '#668', marginTop: '6px' }}>プレイヤーが来なくてもNPC(CPU)と対局できます</div>
        </div>

        <div style={{ fontSize: '12px', color: '#88ccff', marginBottom: '8px' }}>部屋一覧</div>
        {rooms.length === 0 && <div style={{ fontSize: '12px', color: '#668' }}>現在開いている部屋はありません</div>}
        {rooms.map((r) => (
          <div key={r.roomId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #224466', padding: '10px 12px', marginBottom: '8px' }}>
            <div>
              <div style={{ fontSize: '13px' }}>{r.title}</div>
              <div style={{ fontSize: '10px', color: '#668' }}>主: {r.hostName} / {r.count}人 / {r.status === 'playing' ? '🟢 対局中(観戦可)' : '🟡 募集中'}</div>
            </div>
            <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName })} style={btnStyle('#44dd88')}>入室</button>
          </div>
        ))}
      </div>
    )
  }

  // ---- 部屋 ----
  const isHost = room?.hostId === me?.id
  const myColor = game ? colorOf(game, me.id) : null
  const isSpectator = game && !myColor
  const playing = game?.phase === 'playing'
  const isMyTurn = playing && myColor === game.turn
  const { black, white } = game ? countStones(game.board) : { black: 2, white: 2 }
  const hints = isMyTurn ? new Set(validMoves(game.board, myColor)) : new Set()
  const opp = npc || members.find((m) => m.id !== room?.hostId) || null

  let statusMsg = ''
  if (!game) statusMsg = isHost ? '「対局開始」で始められます' : 'ホストの開始を待っています…'
  else if (playing) {
    const cur = game.players[game.turn]
    statusMsg = isMyTurn ? 'あなたの番です' : `${cur?.name || '?'} の番です…`
  } else if (game.result) {
    const w = game.result.winner ? game.players[game.result.winner] : null
    statusMsg = w
      ? `${game.result.forfeit ? '(不戦勝) ' : ''}${w.name} の勝ち！ ⚫${game.result.black} - ⚪${game.result.white}`
      : `引き分け ⚫${game.result.black} - ⚪${game.result.white}`
  }

  return wrap(
    <div style={{ width: '100%', maxWidth: '480px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <button onClick={leaveRoom} style={btnStyle('#88ccff')}>← 退室</button>
        <div style={{ color: '#ffcc44', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{room.title}</div>
        {isHost ? (
          <button onClick={startGame} disabled={playing} style={btnStyle(playing ? '#446' : '#ffcc44', { opacity: playing ? 0.5 : 1 })}>{game ? '再戦' : '対局開始'}</button>
        ) : <div style={{ width: '60px' }} />}
      </div>

      {/* 対局者/メンバー */}
      <div style={{ border: '1px solid #224466', padding: '8px 12px', marginBottom: '10px', fontSize: '12px' }}>
        {game ? (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ color: playing && game.turn === BLACK ? '#ffcc44' : '#cde' }}>
              <span style={stoneStyle(BLACK)} /> {game.players[BLACK]?.name}: {black}
            </div>
            <div style={{ color: playing && game.turn === WHITE ? '#ffcc44' : '#cde' }}>
              <span style={stoneStyle(WHITE)} /> {game.players[WHITE]?.name}: {white}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: '#88ccff', marginBottom: '4px' }}>対局者</div>
            <div>1. {room.hostName} (ホスト)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>2. {opp ? opp.name : '募集中…'}</span>
              {isHost && npc && <button onClick={removeNpc} style={btnStyle('#ff6644', { padding: '2px 8px', fontSize: '11px' })}>NPC削除</button>}
            </div>
            {isHost && !npc && !opp && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ color: '#44dd88', fontSize: '11px', marginBottom: '4px' }}>+ NPCを追加(強さを選択 / 9=最強AI)</div>
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
            {members.length > (opp && !npc ? 2 : 1) && (
              <div style={{ color: '#668', marginTop: '4px' }}>観戦: {members.filter((m) => m.id !== room.hostId && m.id !== opp?.id).map((m) => m.name).join(', ')}</div>
            )}
          </div>
        )}
        {game && isSpectator && <div style={{ color: '#668', marginTop: '4px' }}>👀 観戦中</div>}
        {game && myColor && <div style={{ color: '#668', marginTop: '4px' }}>あなたは <span style={stoneStyle(myColor)} /> {myColor === BLACK ? '黒(先手)' : '白(後手)'}</div>}
      </div>

      {/* 盤面 */}
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gap: '2px',
        background: '#0a3320', border: '3px solid #1a5535', borderRadius: '4px', padding: '4px',
        width: '100%', aspectRatio: '1',
      }}>
        {(game ? game.board : new Array(SIZE * SIZE).fill(EMPTY)).map((cell, i) => (
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
                background: cell === BLACK ? 'radial-gradient(circle at 35% 30%, #555, #000)' : 'radial-gradient(circle at 35% 30%, #fff, #bbb)',
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
    </div>
  )
}
