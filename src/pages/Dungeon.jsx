import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { petStats, speciesEmoji } from '../constants/pets'

// ============================================================
// 不思議のダンジョン風プロトタイプ（Phase 1：クライアントのみ・報酬なし）
// 開発者(is_admin)だけが入れる隠しコンテンツ。
//  - 部屋＋通路を自動生成。階段はどこかの部屋にある
//  - 視界(フォグ)：通路は周囲のみ／部屋に入ると部屋全体が見える。既知地形は薄く記憶
//  - 敵AI：ペットが見えないとランダム徘徊、見えると接近
//  - 戦闘：体当たりで1撃ずつ殴り合う（敵からも殴られる）
// ※報酬付与は Phase 3 で RPC を介してサーバー検証してから実装する。
// ============================================================

const FLOORS = 5
// 区画グリッド（部屋スロット）
const RC = 3, RR = 2, CW = 7, CH = 6
const MAP_W = RC * CW, MAP_H = RR * CH
// 表示ビューポート（プレイヤー中心）
const VW = 11, VH = 9

const FALLBACK_PET = { name: '仮ペット', emoji: '🐾', image_url: null, maxHp: 40, atk: 12, def: 4 }
const MAX_FULLNESS = 100      // 満腹度の上限（100スタート）
const HP_REGEN_EVERY = 10     // 満腹なら10ターンごとにHP+1
const FULLNESS_EVERY = 10     // 10ターンごとに満腹度-1
const enemyStatsFor = (floor) => ({ maxHp: 14 + floor * 5, atk: 5 + floor * 2, def: floor })

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const inBounds = (x, y) => x >= 0 && x < MAP_W && y >= 0 && y < MAP_H

// ---- フロア自動生成 ----
function generateFloor(floorNum) {
  const grid = Array.from({ length: MAP_H }, () => Array(MAP_W).fill('#'))
  const rooms = []
  for (let gy = 0; gy < RR; gy++) {
    for (let gx = 0; gx < RC; gx++) {
      const rw = rand(3, CW - 2), rh = rand(3, CH - 2)
      const rx = gx * CW + rand(1, CW - rw - 1)
      const ry = gy * CH + rand(1, CH - rh - 1)
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) grid[y][x] = '.'
      rooms.push({ x: rx, y: ry, w: rw, h: rh, gx, gy, cx: Math.floor(rx + rw / 2), cy: Math.floor(ry + rh / 2) })
    }
  }
  const roomAt = (gx, gy) => rooms.find((r) => r.gx === gx && r.gy === gy)
  const carveH = (y, x1, x2) => { for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) grid[y][x] = '.' }
  const carveV = (x, y1, y2) => { for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) grid[y][x] = '.' }
  const connect = (a, b) => {
    if (Math.random() < 0.5) { carveH(a.cy, a.cx, b.cx); carveV(b.cx, a.cy, b.cy) }
    else { carveV(a.cx, a.cy, b.cy); carveH(b.cy, a.cx, b.cx) }
  }
  // 右隣・下隣を繋ぐ（グリッド全体が連結される）
  for (const r of rooms) {
    const right = roomAt(r.gx + 1, r.gy); if (right) connect(r, right)
    const down = roomAt(r.gx, r.gy + 1); if (down) connect(r, down)
  }

  // 配置用：部屋内のランダム床タイル
  const occupied = new Set()
  const mark = (x, y) => occupied.add(x + ',' + y)
  const isFree = (x, y) => grid[y][x] === '.' && !occupied.has(x + ',' + y)
  const randTileInRoom = (room) => {
    for (let t = 0; t < 30; t++) {
      const x = rand(room.x, room.x + room.w - 1), y = rand(room.y, room.y + room.h - 1)
      if (isFree(x, y)) return { x, y }
    }
    return null
  }

  // プレイヤー開始：rooms[0] の中心
  const start = rooms[0]
  const player = { x: start.cx, y: start.cy }; mark(player.x, player.y)

  // 階段：開始部屋以外のどこかの部屋
  const stairRoom = rooms[rand(1, rooms.length - 1)]
  let stairs = randTileInRoom(stairRoom) || { x: stairRoom.cx, y: stairRoom.cy }
  mark(stairs.x, stairs.y)

  // 敵・アイテム配置（開始部屋は避ける）
  const otherRooms = rooms.filter((r) => r !== start)
  const es = enemyStatsFor(floorNum)
  const enemies = []
  const enemyCount = 2 + floorNum
  for (let i = 0; i < enemyCount; i++) {
    const room = otherRooms[rand(0, otherRooms.length - 1)]
    const t = randTileInRoom(room)
    if (t) { mark(t.x, t.y); enemies.push({ id: 'e' + i, x: t.x, y: t.y, hp: es.maxHp }) }
  }
  const items = []
  const itemCount = rand(2, 3)
  for (let i = 0; i < itemCount; i++) {
    const room = rooms[rand(0, rooms.length - 1)]
    const t = randTileInRoom(room)
    if (t) { mark(t.x, t.y); items.push({ id: 'i' + i, x: t.x, y: t.y }) }
  }

  return { grid, rooms, player, enemies, items, stairs, explored: new Set() }
}

// ある座標が属する部屋（なければ null = 通路）
const roomOf = (rooms, x, y) => rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null

// プレイヤーから見える座標集合
function computeVisible(rooms, px, py) {
  const vis = new Set()
  const add = (x, y) => { if (inBounds(x, y)) vis.add(x + ',' + y) }
  // 周囲（通路・全般）：3x3
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(px + dx, py + dy)
  // 部屋にいるなら部屋全体＋外周1マス
  const room = roomOf(rooms, px, py)
  if (room) {
    for (let y = room.y - 1; y <= room.y + room.h; y++)
      for (let x = room.x - 1; x <= room.x + room.w; x++) add(x, y)
  }
  return vis
}

// 敵がペットを視認できるか
function enemySeesPet(rooms, e, px, py) {
  const er = roomOf(rooms, e.x, e.y), pr = roomOf(rooms, px, py)
  if (er && er === pr) return true // 同じ部屋
  return Math.max(Math.abs(e.x - px), Math.abs(e.y - py)) <= 2 // 通路で接近
}

export default function Dungeon() {
  const nav = useNavigate()
  const [allowed, setAllowed] = useState(undefined)
  const [pet, setPet] = useState(FALLBACK_PET)
  const [floorNum, setFloorNum] = useState(1)
  const [state, setState] = useState(null)
  const [petHp, setPetHp] = useState(FALLBACK_PET.maxHp)
  const [turns, setTurns] = useState(0)
  const [fullness, setFullness] = useState(MAX_FULLNESS)
  const [log, setLog] = useState([])
  const [status, setStatus] = useState('exploring') // exploring | cleared | dead
  const [reward, setReward] = useState(null)

  // 探索の集計（不正対策のためサーバーへ渡す素の値）
  const runIdRef = useRef(null)
  const finishedRef = useRef(false)
  const enemiesRef = useRef(0)
  const floorsRef = useRef(0)
  const itemsRef = useRef(0)

  // ラン開始（選択中ペットがある場合のみ報酬対象）
  const startRun = useCallback(async (petId) => {
    finishedRef.current = false
    enemiesRef.current = 0; floorsRef.current = 0; itemsRef.current = 0
    runIdRef.current = null
    setReward(null)
    if (!petId) return
    const { data, error } = await supabase.rpc('dungeon_start', { p_pet_id: petId })
    if (!error) runIdRef.current = data
  }, [])

  // ラン精算（サーバーが報酬を計算して付与）
  const finishRun = useCallback(async (cleared) => {
    if (finishedRef.current || !runIdRef.current) return
    finishedRef.current = true
    const { data, error } = await supabase.rpc('dungeon_finish', {
      p_run_id: runIdRef.current, p_floors: floorsRef.current,
      p_enemies: enemiesRef.current, p_items: itemsRef.current, p_cleared: cleared,
    })
    if (!error && data) setReward(data)
  }, [])

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      if (!data?.is_admin) { setAllowed(false); return }
      // 選択中のペットを読み込む
      const { data: ap } = await supabase.from('pets').select('*').eq('owner_id', user.id).eq('is_active', true).maybeSingle()
      if (ap) {
        const st = petStats(ap)
        setPet({ id: ap.id, name: ap.name, emoji: speciesEmoji(ap), image_url: ap.image_url, ...st })
        setPetHp(st.maxHp)
        startRun(ap.id)
      }
      setAllowed(true)
    })()
  }, [nav, startRun])

  const enterFloor = useCallback((num) => {
    const f = generateFloor(num)
    // 初期視界を記憶に反映
    f.explored = computeVisible(f.rooms, f.player.x, f.player.y)
    setState(f)
  }, [])

  useEffect(() => { if (allowed) enterFloor(1) }, [allowed, enterFloor])

  const addLog = (msg) => setLog((l) => [msg, ...l].slice(0, 30))

  const tryMove = (dx, dy) => {
    if (!state || status !== 'exploring') return
    let s = state
    const px = s.player.x, py = s.player.y
    const nx = px + dx, ny = py + dy
    if (!inBounds(nx, ny) || s.grid[ny][nx] === '#') return

    let curPetHp = petHp
    let enemies = s.enemies
    let player = s.player

    // 敵への体当たり＝1撃
    const target = enemies.find((e) => e.x === nx && e.y === ny)
    if (target) {
      const es = enemyStatsFor(floorNum)
      const dmg = Math.max(1, pet.atk - es.def)
      const newHp = target.hp - dmg
      if (newHp <= 0) { enemies = enemies.filter((e) => e.id !== target.id); enemiesRef.current += 1; addLog(`⚔ 敵に${dmg}ダメージ → 撃破！`) }
      else { enemies = enemies.map((e) => e.id === target.id ? { ...e, hp: newHp } : e); addLog(`⚔ 敵に${dmg}ダメージ（残りHP${newHp}）`) }
      // プレイヤーはその場に留まる
    } else {
      // アイテム取得
      const itemHere = s.items.find((it) => it.x === nx && it.y === ny)
      let items = s.items
      if (itemHere) { items = items.filter((it) => it.id !== itemHere.id); itemsRef.current += 1; addLog('✨ アイテムを拾った') }
      player = { x: nx, y: ny }
      s = { ...s, items }

      // 階段
      if (player.x === s.stairs.x && player.y === s.stairs.y) {
        floorsRef.current += 1
        if (floorNum >= FLOORS) { setStatus('cleared'); addLog('🏁 最深部を踏破！ダンジョンクリア！'); setState({ ...s, player }); finishRun(true); return }
        addLog(`⬇ B${floorNum + 1}Fへ降りた`)
        setFloorNum(floorNum + 1)
        enterFloor(floorNum + 1)
        return
      }
    }

    commitTurn(s, player, enemies, curPetHp)
  }

  // 1ターン経過の共通処理：敵の行動／満腹度・HPの増減／視界更新
  const commitTurn = (s, player, enemies, curPetHp) => {
    // ---- 敵のターン ----
    const es = enemyStatsFor(floorNum)
    const occ = (x, y, self) => enemies.some((e) => e !== self && e.x === x && e.y === y)
    const isFloor = (x, y) => inBounds(x, y) && s.grid[y][x] === '.'
    let dead = false
    enemies = enemies.map((e) => {
      const sees = enemySeesPet(s.rooms, e, player.x, player.y)
      const adjacent = Math.abs(e.x - player.x) + Math.abs(e.y - player.y) === 1
      if (sees && adjacent) {
        const dmg = Math.max(1, es.atk - pet.def)
        curPetHp -= dmg
        addLog(`💥 敵の攻撃！ ${dmg}ダメージ`)
        if (curPetHp <= 0) dead = true
        return e
      }
      let cands
      if (sees) {
        cands = []
        const sx = Math.sign(player.x - e.x), sy = Math.sign(player.y - e.y)
        if (Math.abs(player.x - e.x) >= Math.abs(player.y - e.y)) {
          if (sx) cands.push({ x: e.x + sx, y: e.y }); if (sy) cands.push({ x: e.x, y: e.y + sy })
        } else {
          if (sy) cands.push({ x: e.x, y: e.y + sy }); if (sx) cands.push({ x: e.x + sx, y: e.y })
        }
      } else {
        cands = [{ x: e.x + 1, y: e.y }, { x: e.x - 1, y: e.y }, { x: e.x, y: e.y + 1 }, { x: e.x, y: e.y - 1 }]
          .sort(() => Math.random() - 0.5)
      }
      for (const c of cands) {
        if (isFloor(c.x, c.y) && !occ(c.x, c.y, e) && !(c.x === player.x && c.y === player.y)) return { ...e, x: c.x, y: c.y }
      }
      return e
    })

    // ---- 満腹度・HP ----
    const nextTurns = turns + 1
    setTurns(nextTurns)
    let nextFull = fullness
    if (!dead) {
      if (nextTurns % FULLNESS_EVERY === 0 && nextFull > 0) { nextFull -= 1; if (nextFull === 0) addLog('🍖 満腹度が0になった…！') }
      if (nextFull <= 0) {
        curPetHp -= 1; addLog('🥀 空腹で1ダメージ')
        if (curPetHp <= 0) dead = true
      } else if (nextTurns % HP_REGEN_EVERY === 0 && curPetHp < pet.maxHp) {
        curPetHp += 1
      }
    }
    setFullness(nextFull)
    setPetHp(curPetHp)
    if (dead) { setStatus('dead'); addLog('💀 ペットは力尽きた…'); finishRun(false) }

    // 視界を更新して記憶へ追記
    const nowVis = computeVisible(s.rooms, player.x, player.y)
    const explored = new Set(s.explored); nowVis.forEach((k) => explored.add(k))
    setState({ ...s, player, enemies, explored })
  }

  // 足踏み：その場で1ターン経過
  const stepInPlace = () => {
    if (!state || status !== 'exploring') return
    addLog('🚶 足踏みした')
    commitTurn(state, state.player, state.enemies, petHp)
  }

  const restart = () => { setFloorNum(1); setPetHp(pet.maxHp); setTurns(0); setFullness(MAX_FULLNESS); setLog([]); setStatus('exploring'); enterFloor(1); startRun(pet.id) }

  // 街に戻る（探索中なら現在の進捗で精算してから離脱）
  const leaveToTown = async () => { await finishRun(false); nav('/game') }

  if (allowed === undefined) return <Center>読み込み中...</Center>
  if (!allowed) return <Center>このページは開発中です（権限がありません）<br /><Btn onClick={() => nav('/game')}>🏰 街に戻る</Btn></Center>
  if (!state) return <Center>生成中...</Center>

  const visible = computeVisible(state.rooms, state.player.x, state.player.y)
  const isVisible = (x, y) => visible.has(x + ',' + y)
  const isExplored = (x, y) => state.explored.has(x + ',' + y)

  // ビューポート描画（プレイヤー中心）
  const ox = state.player.x - Math.floor(VW / 2)
  const oy = state.player.y - Math.floor(VH / 2)
  // 配色：壁＝明るいスレート、床＝暗いネイビーで明確に区別
  const C = {
    unknown: '#000208',
    floorVis: '#0d2347',   // 視界内の床（暗いネイビー）
    wallVis: '#5a6f93',    // 視界内の壁（明るいスレート）
    floorMem: '#0a1526',   // 記憶の床
    wallMem: '#313c52',    // 記憶の壁
  }
  const cellAt = (x, y) => {
    if (!inBounds(x, y)) return { ch: '', bg: C.unknown }
    const vis = isVisible(x, y)
    if (!vis && !isExplored(x, y)) return { ch: '', bg: C.unknown } // 未踏
    const wall = state.grid[y][x] === '#'
    if (!vis) {
      // 記憶（薄い地形＋階段のみ）
      if (!wall && state.stairs.x === x && state.stairs.y === y) return { ch: '▼', bg: C.floorMem, dim: true }
      return { ch: '', bg: wall ? C.wallMem : C.floorMem }
    }
    // 現在視界：エンティティ優先（足元は床色）
    if (state.player.x === x && state.player.y === y) return { ch: pet.emoji || '🐾', img: pet.image_url, bg: C.floorVis }
    const e = state.enemies.find((o) => o.x === x && o.y === y)
    if (e) return { ch: '👹', bg: C.floorVis }
    const it = state.items.find((o) => o.x === x && o.y === y)
    if (it) return { ch: '✨', bg: C.floorVis }
    if (state.stairs.x === x && state.stairs.y === y) return { ch: '▼', bg: C.floorVis }
    return { ch: '', bg: wall ? C.wallVis : C.floorVis }
  }

  const adjClick = (vx, vy) => {
    const x = ox + vx, y = oy + vy
    const dx = x - state.player.x, dy = y - state.player.y
    if (Math.abs(dx) + Math.abs(dy) === 1) tryMove(dx, dy)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', padding: '16px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ color: '#aa88ff', letterSpacing: 2 }}>🕳 不思議のダンジョン <span style={{ fontSize: 11, color: '#4466aa' }}>[開発中]</span></div>
          <Btn onClick={leaveToTown}>🏰 街</Btn>
        </div>

        <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <span>B{floorNum}F</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: petHp > pet.maxHp * 0.3 ? '#44ff88' : '#ff5555' }}>
            {pet.image_url ? <img src={pet.image_url} alt="" style={{ width: 16, height: 16, objectFit: 'cover', borderRadius: 3 }} /> : <span>{pet.emoji}</span>}
            {pet.name} HP {petHp}/{pet.maxHp}
          </span>
          <span style={{ color: fullness > 0 ? '#ffcc44' : '#ff5555' }}>🍖 満腹 {fullness}/{MAX_FULLNESS}</span>
        </div>

        {/* マップ（ビューポート） */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${VW}, 1fr)`, gap: 0, background: '#000208', padding: 6, border: '1px solid #113355' }}>
          {Array.from({ length: VH }).map((_, vy) => Array.from({ length: VW }).map((_, vx) => {
            const x = ox + vx, y = oy + vy
            const c = cellAt(x, y)
            const clickable = status === 'exploring' && isVisible(x, y) && inBounds(x, y) && state.grid[y]?.[x] !== '#' &&
              Math.abs(x - state.player.x) + Math.abs(y - state.player.y) === 1
            return (
              <div key={`${vx}-${vy}`} onClick={() => clickable && adjClick(vx, vy)}
                style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, background: c.bg, opacity: c.dim ? 0.5 : 1, cursor: clickable ? 'pointer' : 'default' }}>
                {c.img ? <img src={c.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : c.ch}
              </div>
            )
          }))}
        </div>

        {status === 'exploring' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 48px)', gap: 4, justifyContent: 'center', marginTop: 12 }}>
            <span /><Btn onClick={() => tryMove(0, -1)}>▲</Btn><span />
            <Btn onClick={() => tryMove(-1, 0)}>◀</Btn><Btn onClick={stepInPlace}>足踏</Btn><Btn onClick={() => tryMove(1, 0)}>▶</Btn>
            <span /><Btn onClick={() => tryMove(0, 1)}>▼</Btn><span />
          </div>
        )}
        {status === 'cleared' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#ffcc44' }}>🏁 ダンジョンクリア！<RewardPanel reward={reward} pet={pet} /><br /><Btn onClick={restart}>もう一度</Btn> <Btn onClick={leaveToTown}>街に戻る</Btn></div>
        )}
        {status === 'dead' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#ff5555' }}>💀 ペットは力尽きた…<RewardPanel reward={reward} pet={pet} /><br /><Btn onClick={restart}>再挑戦</Btn> <Btn onClick={leaveToTown}>街に戻る</Btn></div>
        )}

        <div style={{ marginTop: 16, background: '#000610', border: '1px solid #113355', padding: 8, height: 140, overflowY: 'auto', fontSize: 11 }}>
          {log.length === 0 ? <span style={{ color: '#335577' }}>隣のマスをクリック、または矢印で移動。部屋に入ると視界が開ける。👹に触れると戦闘、▼で次の階へ。</span>
            : log.map((l, i) => <div key={i} style={{ color: i === 0 ? '#aaddff' : '#5588bb' }}>{l}</div>)}
        </div>
      </div>
    </div>
  )
}

function RewardPanel({ reward, pet }) {
  if (!reward) {
    if (!pet?.id) return <div style={{ color: '#5577aa', fontSize: 11, margin: '8px 0' }}>（ペット未選択のため報酬なし）</div>
    return <div style={{ color: '#5577aa', fontSize: 11, margin: '8px 0' }}>報酬を精算中…</div>
  }
  return (
    <div style={{ background: '#001026', border: '1px solid #335588', padding: 10, margin: '10px auto', maxWidth: 280, fontSize: 12, color: '#cce6ff' }}>
      <div>獲得EXP +{reward.exp_gain}　なつき +{reward.aff_gain}</div>
      <div style={{ marginTop: 4, color: '#88bbee' }}>Lv{reward.level}（EXP {reward.exp}） / なつき {reward.affection}/100</div>
      {reward.leveled && <div style={{ marginTop: 4, color: '#ffcc44' }}>⬆ レベルアップ！</div>}
    </div>
  )
}
function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>{children}</div>
}
function Btn({ children, onClick }) {
  return <button onClick={onClick} style={{ background: '#001840', border: '1px solid #0088ff', color: '#0088ff', padding: '6px 12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13 }}>{children}</button>
}
