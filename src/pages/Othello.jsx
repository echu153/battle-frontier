import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
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

const LOBBY_CHANNEL = 'othello-lobby'
const roomChannelName = (roomId) => `othello-room-${roomId}`

const NPC_NAMES = ['オセロ丸', 'リバー子', 'カドトリ翁', 'スミゾメ', 'シロタエ']
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
  const [roomTitle, setRoomTitle] = useState('')

  // 部屋の状態
  const [room, setRoom] = useState(null) // { id, title, hostId, hostName }
  const [members, setMembers] = useState([]) // presenceから [{ id, name }]
  const [npcs, setNpcs] = useState([]) // ホストが追加したNPC [{ id, name, level }]
  const [game, setGame] = useState(null)
  const [toast, setToast] = useState(null)
  const [passNote, setPassNote] = useState(null)
  const [lastResult, setLastResult] = useState(null) // 直前の対局結果(待機画面に表示)

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
  useEffect(() => { npcsRef.current = npcs }, [npcs])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // ---- 認証(一般公開・2026-07-17) ----
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
      const list = Object.keys(st).map((key) => ({ id: key, name: st[key][0]?.name || '?', spectator: !!st[key][0]?.spectator }))
      list.sort((a, b) => (st[a.id][0]?.joinedAt || 0) - (st[b.id][0]?.joinedAt || 0))
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
      // ホストが消えたら解散(在室を一度確認できた後のみ判定)
      if (list.some((m) => m.id === roomInfo.hostId)) {
        hostSeen = true
      } else if (hostSeen) {
        showToast('ホストが退室したため部屋は解散しました')
        leaveRoomRef.current?.()
      }
    })
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      // ホスト: 対局中の切断は不戦勝(2人) / 手番スキップ(多人数)
      if (roomInfo.hostId !== myself.id || gameRef.current?.phase !== 'playing') return
      const cur = gameRef.current
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
    })
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      if (gameRef.current && payload.seq < stateSeqRef.current) return // 途中参加向け再配信は初回のみ受理
      stateSeqRef.current = payload.seq
      gameRef.current = payload.game
      setGame(payload.game)
      for (const ev of payload.events || []) {
        if (ev.t === 'pass') setPassNote(`${ev.name} はパス！`)
        if (ev.t === 'forfeit') showToast(`${ev.name} が切断したため不戦勝`)
        if (ev.t === 'left') showToast(`${ev.name} が切断しました(手番スキップ)`)
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
        await ch.track({ name: myself.name, joinedAt: Date.now(), spectator: asSpectator })
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
    setLastResult(null)
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

  // ---- 対局席: 入室順(ホスト含む・観戦希望を除く) + NPC で最大5席。あふれた人は観戦 ----
  const seatedOf = (mems, nps) => [...mems.filter((m) => !m.spectator), ...nps].slice(0, MAX_MULTI_PLAYERS)
  const seated = seatedOf(members, npcs)

  // ---- 勝敗確定後は結果を数秒見せて待機画面へ戻る ----
  useEffect(() => {
    if (game?.phase !== 'ended' || !game.result) return
    const t = setTimeout(() => {
      let txt
      if (game.mode === 'multi') {
        txt = game.result.standings
          .map((s, i) => `${i + 1}位 ${s.name}(${s.count})${s.left ? '×' : ''}`)
          .join(' / ')
      } else {
        const w = game.result.winner ? game.players[game.result.winner] : null
        txt = w
          ? `${game.result.forfeit ? '(不戦勝) ' : ''}${w.name}の勝ち ⚫${game.result.black}-⚪${game.result.white}`
          : `引き分け ⚫${game.result.black}-⚪${game.result.white}`
      }
      setLastResult(txt)
      setGame(null)
      gameRef.current = null
    }, 5000)
    return () => clearTimeout(t)
  }, [game])

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
  const startGame = () => {
    const list = seatedOf(membersRef.current, npcsRef.current)
    if (list.length < 2) { showToast('対戦相手がいません(NPCを追加するか入室を待ってください)'); return }
    // 手番順をシャッフル
    const order = list.map((p) => ({ id: p.id, name: p.name }))
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    setPassNote(null)
    if (order.length === 2) {
      hostBroadcast(createGame({ black: order[0], white: order[1] }), [])
    } else {
      hostBroadcast(createMultiGame(order), [])
    }
    publishRoom('playing')
  }

  // ---- 着手送信(全員共通・ホストも同じ経路) ----
  const sendMove = (idx) => {
    roomChRef.current?.send({ type: 'broadcast', event: 'action', payload: { action: { playerId: me.id, idx } } })
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

        <div style={{ fontSize: '12px', color: '#88ccff', marginBottom: '8px' }}>部屋一覧</div>
        {rooms.length === 0 && <div style={{ fontSize: '12px', color: '#668' }}>現在開いている部屋はありません</div>}
        {rooms.map((r) => (
          <div key={r.roomId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #224466', padding: '10px 12px', marginBottom: '8px' }}>
            <div>
              <div style={{ fontSize: '13px' }}>{r.title}</div>
              <div style={{ fontSize: '10px', color: '#668' }}>主: {r.hostName} / {r.count}人 / {r.status === 'playing' ? '🟢 対局中(観戦可)' : '🟡 募集中'}</div>
            </div>
            {r.status === 'playing' ? (
              <button onClick={() => joinRoom({ id: r.roomId, title: r.title, hostId: r.hostId, hostName: r.hostName })} style={btnStyle('#88ccff')}>観戦入室</button>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
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
      if (isMyTurn) hints = new Set(legalMovesMulti(game.board, game.size, myColor).moves)
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
          <button onClick={startGame} disabled={playing} style={btnStyle(playing ? '#446' : '#ffcc44', { opacity: playing ? 0.5 : 1 })}>{game ? '再戦' : '対局開始'}</button>
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
                  <div key={p.color} style={{ color: isTurn ? '#ffcc44' : p.left ? '#556' : '#cde', textDecoration: p.left ? 'line-through' : 'none' }}>
                    <span style={stoneStyle(p.color)} /> {p.name}: {multiCounts[p.color] || 0}
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ color: playing && game.turn === BLACK ? '#ffcc44' : '#cde' }}>
                <span style={stoneStyle(BLACK)} /> {game.players[BLACK]?.name}: {classicCounts.black}
              </div>
              <div style={{ color: playing && game.turn === WHITE ? '#ffcc44' : '#cde' }}>
                <span style={stoneStyle(WHITE)} /> {game.players[WHITE]?.name}: {classicCounts.white}
              </div>
            </div>
          )
        ) : (
          <div>
            {lastResult && (
              <div style={{ border: '1px solid #665522', background: 'rgba(255,204,68,0.07)', padding: '4px 8px', marginBottom: '6px', color: '#ffcc44', fontSize: '11px' }}>
                前回の結果: {lastResult}
              </div>
            )}
            <div style={{ color: '#88ccff', marginBottom: '4px' }}>対局者(最大{MAX_MULTI_PLAYERS}人 / 3人以上は盤が拡大: {seated.length >= 2 ? `${multiBoardSize(Math.max(seated.length, 2))}×${multiBoardSize(Math.max(seated.length, 2))}` : '8×8'})</div>
            {seated.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{i + 1}. {p.name}{p.id === room.hostId ? ' (ホスト)' : ''}</span>
                {isHost && isNpcId(p.id) && <button onClick={() => removeNpc(p.id)} style={btnStyle('#ff6644', { padding: '1px 6px', fontSize: '10px' })}>削除</button>}
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
    </div>
  )
}
