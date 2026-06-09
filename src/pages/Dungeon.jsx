import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { petStats, speciesEmoji, petImage, getSkill, PET_ITEMS, DUNGEON_ITEMS, expForLevel, DUNGEONS, getDungeon, areaForFloor, enemiesForFloor, dungeonEnemyStats, pickEnemyImage, enemySkillsFor, POISON_INTERVAL, POISON_PCT, getCharm, applyCharmStats } from '../constants/pets'
import { GEM_DATA } from './Game'
import SortiePanel from '../components/SortiePanel'

const DUNGEON_BAG_MAX = 20 // ダンジョン中に持てる持ち物の上限（だっしゅつの翼は対象外）

// ============================================================
// 不思議のダンジョン風プロトタイプ（Phase 1：クライアントのみ・報酬なし）
// 開発者(is_admin)だけが入れる隠しコンテンツ。
//  - 部屋＋通路を自動生成。階段はどこかの部屋にある
//  - 視界(フォグ)：通路は周囲のみ／部屋に入ると部屋全体が見える。既知地形は薄く記憶
//  - 敵AI：ペットが見えないとランダム徘徊、見えると接近
//  - 戦闘：体当たりで1撃ずつ殴り合う（敵からも殴られる）
// ※報酬付与は Phase 3 で RPC を介してサーバー検証してから実装する。
// ============================================================

// 区画グリッド（部屋スロット）
const RC = 3, RR = 2, CW = 9, CH = 9  // 区画を広げ、大きい部屋も出るように
const MAP_W = RC * CW, MAP_H = RR * CH
// 表示ビューポート（プレイヤー中心）
const VW = 11, VH = 9

const FALLBACK_PET = { name: '仮ペット', emoji: '🐾', image_url: null, maxHp: 40, atk: 12, def: 4, mdef: 4, atkType: 'phys', skillSlots: ['tackle'] }
const MAX_FULLNESS = 100      // 満腹度の上限（100スタート）
const HP_REGEN_EVERY = 10     // 満腹なら10ターンごとにHP+1
const FULLNESS_EVERY = 10     // 10ターンごとに満腹度-1
const SPAWN_EVERY = 40        // 40ターンごとに敵が1体湧く
const SPAWN_CAP = 12          // フロアの敵がこの数以上なら湧かせない（過密防止）

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const inBounds = (x, y) => x >= 0 && x < MAP_W && y >= 0 && y < MAP_H

// ---- フロア自動生成 ----
function generateFloor(floorNum, dungeon) {
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
  // 通路は部屋の「間（ギャップ）」で曲げ、各部屋へは必ず1マス幅のドアで出入りする
  const connect = (a, b) => {
    if (b.gx > a.gx) {
      // 右隣：A右壁→ギャップで縦に曲げ→B左壁（各部屋の入口は1マス）
      const midX = Math.floor((a.x + a.w + b.x - 1) / 2)
      carveH(a.cy, a.cx, midX)
      carveV(midX, a.cy, b.cy)
      carveH(b.cy, midX, b.cx)
    } else {
      // 下隣：A下壁→ギャップで横に曲げ→B上壁（各部屋の入口は1マス）
      const midY = Math.floor((a.y + a.h + b.y - 1) / 2)
      carveV(a.cx, a.cy, midY)
      carveH(midY, a.cx, b.cx)
      carveV(b.cx, midY, b.cy)
    }
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
  // 部屋の内側（外周ぶんを除く）。階段を出入り口に置かないために使う
  const randInnerTileInRoom = (room) => {
    if (room.w < 3 || room.h < 3) return randTileInRoom(room)
    for (let t = 0; t < 30; t++) {
      const x = rand(room.x + 1, room.x + room.w - 2), y = rand(room.y + 1, room.y + room.h - 2)
      if (isFree(x, y)) return { x, y }
    }
    return randTileInRoom(room)
  }

  // プレイヤー開始：rooms[0] の中心
  const start = rooms[0]
  const player = { x: start.cx, y: start.cy }; mark(player.x, player.y)

  // 階段：開始部屋以外のどこかの部屋の「内側」（出入り口を塞がない）
  const stairRoom = rooms[rand(1, rooms.length - 1)]
  let stairs = randInnerTileInRoom(stairRoom) || { x: stairRoom.cx, y: stairRoom.cy }
  mark(stairs.x, stairs.y)

  // 敵・アイテム配置（開始部屋は避ける）
  const otherRooms = rooms.filter((r) => r !== start)
  const areaId = areaForFloor(dungeon, floorNum)
  const pool = enemiesForFloor(dungeon, floorNum)
  const es = dungeonEnemyStats(floorNum, areaId)
  const enemies = []
  const enemyCount = Math.min(8, 3 + Math.floor(floorNum / 3))
  for (let i = 0; i < enemyCount; i++) {
    const room = otherRooms[rand(0, otherRooms.length - 1)]
    const t = randTileInRoom(room)
    if (t) {
      mark(t.x, t.y)
      const kind = pool[rand(0, pool.length - 1)]
      const m = kind.statMult ?? 1.0
      enemies.push({ id: 'e' + i, x: t.x, y: t.y, name: kind.name, type: kind.type, image: pickEnemyImage(kind), skills: enemySkillsFor(kind.name), hp: Math.round(es.maxHp * m), maxHp: Math.round(es.maxHp * m), atk: Math.round(es.atk * m), def: Math.round(es.def * m), mdef: Math.round(es.mdef * m) })
    }
  }
  // アイテム（✨/木の実/おにぎり 全部込み）を1フロア3〜5個ランダム
  const items = []
  const itemCount = rand(3, 5)
  for (let i = 0; i < itemCount; i++) {
    const room = rooms[rand(0, rooms.length - 1)]
    const t = randInnerTileInRoom(room) // 出入り口（部屋の外周）には置かない
    if (!t) continue
    mark(t.x, t.y)
    const r = Math.random() // ✨80% / 木の実10% / おにぎり10%
    if (r < 0.10) items.push({ id: 'f' + i, x: t.x, y: t.y, kind: 'food', key: 'konomi' })
    else if (r < 0.20) items.push({ id: 'f' + i, x: t.x, y: t.y, kind: 'food', key: 'onigiri' })
    else items.push({ id: 'i' + i, x: t.x, y: t.y, kind: 'loot' })
  }

  return { grid, rooms, player, enemies, items, stairs, explored: new Set() }
}

// ある座標が属する部屋（なければ null = 通路）
const roomOf = (rooms, x, y) => rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null

// プレイヤーから見える座標集合
function computeVisible(rooms, px, py) {
  const vis = new Set()
  const add = (x, y) => { if (inBounds(x, y)) vis.add(x + ',' + y) }
  const room = roomOf(rooms, px, py)
  if (room) {
    // 部屋にいるとき：部屋全体＋外周1マスのみ（通路は1マスだけ覗ける）
    for (let y = room.y - 1; y <= room.y + room.h; y++)
      for (let x = room.x - 1; x <= room.x + room.w; x++) add(x, y)
  } else {
    // 通路にいるとき：自分中心の6x6相当(±3)。縁は上から重ねる円ビネットでぼかす
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) add(px + dx, py + dy)
  }
  return vis
}

// 敵がペットを視認できるか
function enemySeesPet(rooms, e, px, py) {
  const er = roomOf(rooms, e.x, e.y), pr = roomOf(rooms, px, py)
  if (er && er === pr) return true // 同じ部屋
  return Math.max(Math.abs(e.x - px), Math.abs(e.y - py)) <= 2 // 通路で接近（ペットの5x5視界と一致）
}

// ダメージ計算: 攻撃と防御の差が過剰だと効率が逓減する（物理=def / 特殊=mdef 共通）
//  ・防御が攻撃を上回る → 素攻撃の10%は最低保証で通す
//  ・差(攻撃-防御)が「攻撃の50%」までは等倍、それを超えた分は効率半減
function calcDamage(rawAtk, guard) {
  const d = rawAtk - guard
  if (d <= 0) return Math.max(1, Math.round(rawAtk * 0.10))
  const cap = rawAtk * 0.5
  return Math.max(1, Math.round(d <= cap ? d : cap + (d - cap) * 0.5))
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
  const [poisoned, setPoisoned] = useState(false) // 毒状態（次フロアで回復）
  const [log, setLog] = useState([])
  const [status, setStatus] = useState('select') // select | exploring | cleared | dead | escaped
  const [reward, setReward] = useState(null)
  const [selectedSkill, setSelectedSkill] = useState('tackle') // ダンジョン内で選択中のスキル
  const [inventory, setInventory] = useState({}) // 消耗品の持ち物 { item_key: qty }
  const [lootBag, setLootBag] = useState([])     // 持ち帰り待ちのルート品（装備/強化石/宝石）。生還で付与
  const [dropMode, setDropMode] = useState(false) // 「捨てる」モード（持ち物を選ぶと足元に置く）
  const [dungeon, setDungeon] = useState(null) // 選択中のダンジョン定義
  const [cleared, setCleared] = useState(new Set()) // クリア済みダンジョンID
  const [shake, setShake] = useState(null) // 戦闘演出：接触時のマップ揺れ（'hit' | 'kill'）
  const shakeTimer = useRef(null)
  // 接触時にマップを少し震わせる（撃破時はやや大きめ）
  const triggerShake = (kind = 'hit') => {
    setShake(kind)
    if (shakeTimer.current) clearTimeout(shakeTimer.current)
    shakeTimer.current = setTimeout(() => setShake(null), kind === 'kill' ? 360 : 220)
  }
  // 戦闘エフェクト（被弾点滅／体当たりの突進）。pet と enemies[id] ごとに保持
  const [fx, setFx] = useState({ pet: null, enemies: {}, t: 0 })
  const fxId = useRef(0)
  const applyFx = (next) => { fxId.current += 1; setFx({ pet: null, enemies: {}, ...next, t: fxId.current }) }
  const busyRef = useRef(false) // 体当たり〜敵反撃の演出中は入力をロック
  const spawnSeq = useRef(0) // 湧いた敵の連番ID用
  const dropSeq = useRef(0)  // 床に置いたアイテムの連番ID用
  const turnTimers = useRef([])
  useEffect(() => () => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current)
    turnTimers.current.forEach(clearTimeout)
  }, [])
  const BREATH_MS = 340 // 体当たり後、敵が反撃してくるまでの一呼吸

  // 探索の集計（不正対策のためサーバーへ渡す素の値）
  const runIdRef = useRef(null)
  const finishedRef = useRef(false)
  const userIdRef = useRef(null)
  const saveKey = () => (userIdRef.current ? `bf_dungeon2_${userIdRef.current}` : null)
  const enemiesRef = useRef(0)
  const floorsRef = useRef(0)
  const itemsRef = useRef(0)

  // ラン開始（選択中ペットがある場合のみ報酬対象）
  const startRun = useCallback(async (petId, dungeonId = 'd10') => {
    finishedRef.current = false
    enemiesRef.current = 0; floorsRef.current = 0; itemsRef.current = 0
    runIdRef.current = null
    setReward(null)
    if (!petId) return
    const { data, error } = await supabase.rpc('dungeon_start', { p_pet_id: petId, p_dungeon_id: dungeonId })
    if (!error) runIdRef.current = data
  }, [])

  // 敵撃破：EXPを即時付与（サーバー）。レベルアップでステータスも即反映
  const grantKill = useCallback(async (floor, name = '敵') => {
    if (!runIdRef.current) return
    const { data, error } = await supabase.rpc('dungeon_kill', { p_run_id: runIdRef.current, p_floor: floor })
    if (error || !data) { addLog(`⚔ ${name}を撃破！`); return }
    addLog(`⚔ ${name}を撃破！ ＋EXP${data.exp_gain}${data.leveled ? `（Lv${data.level}に！）` : ''}`)
    setPet((p) => {
      if (!p?.species) return p
      const st = applyCharmStats(petStats({ species: p.species, level: data.level, evolved: p.evolved }), p.charm)
      return { ...p, level: data.level, exp: data.exp, ...st }
    })
  }, [])

  // ✨のルート品はサーバー(dungeon_pickup)が抽選・保持し、生還時(dungeon_finish)に付与する。
  // クライアントは表示するだけ。サーバー戻り値の素のentryに表示用の label/emoji を付ける。
  const lootDisplay = (e) => {
    if (!e) return { label: '?', emoji: '✨' }
    if (e.type === 'seed') { const d = PET_ITEMS[e.seedKey]; return { label: d?.name || e.seedKey, emoji: d?.emoji || '🔹' } }
    if (e.type === 'stone') return { label: `強化石(${e.rank})`, emoji: '🪨' }
    if (e.type === 'gem') return { label: `${GEM_DATA[e.gemType]?.name || '宝石'}(F)`, emoji: '💍' }
    if (e.type === 'equip') return { label: e.name, emoji: '🎁' }
    if (e.type === 'charm') return { label: getCharm(e.ctype).name, emoji: getCharm(e.ctype).emoji }
    return { label: '?', emoji: '✨' }
  }

  // 床の消耗品（木の実・おにぎり）をアイテム袋へ。残数を更新
  const grantFood = useCallback(async (key) => {
    const { data, error } = await supabase.rpc('pet_grant_item', { p_key: key, p_qty: 1 })
    if (error || !data || !data.granted) return false
    setInventory((inv) => ({ ...inv, [key]: (inv[key] || 0) + data.granted }))
    return true
  }, [])

  // 40ターンごとの湧き：プレイヤーから離れた床マスに敵を1体生成
  const spawnEnemy = (s, enemies, player) => {
    const areaId = areaForFloor(dungeon, floorNum)
    const pool = enemiesForFloor(dungeon, floorNum)
    const es = dungeonEnemyStats(floorNum, areaId)
    const rooms = s.rooms || []
    const occupied = (x, y) => enemies.some((e) => e.x === x && e.y === y) ||
      (player.x === x && player.y === y) || (s.stairs.x === x && s.stairs.y === y) ||
      s.items.some((it) => it.x === x && it.y === y)
    for (let tries = 0; tries < 40; tries++) {
      const room = rooms[rand(0, rooms.length - 1)]
      if (!room) break
      const x = room.x + rand(0, room.w - 1)
      const y = room.y + rand(0, room.h - 1)
      if (s.grid[y]?.[x] !== '.' || occupied(x, y)) continue
      if (Math.abs(x - player.x) + Math.abs(y - player.y) < 4) continue // 目の前には湧かせない
      const kind = pool[rand(0, pool.length - 1)]
      const m = kind.statMult ?? 1.0
      spawnSeq.current += 1
      return {
        id: 'es' + spawnSeq.current, x, y, name: kind.name, type: kind.type, image: pickEnemyImage(kind), skills: enemySkillsFor(kind.name),
        hp: Math.round(es.maxHp * m), maxHp: Math.round(es.maxHp * m),
        atk: Math.round(es.atk * m), def: Math.round(es.def * m), mdef: Math.round(es.mdef * m),
      }
    }
    return null
  }

  // ラン精算（サーバーが報酬を計算して付与）
  const finishRun = useCallback(async (cleared, died = false) => {
    if (saveKey()) localStorage.removeItem(saveKey()) // 中断データを破棄
    if (finishedRef.current || !runIdRef.current) return
    finishedRef.current = true
    // ルート品の付与はサーバー(dungeon_finish)が生還時のみ実行。クライアントは表示用に一覧を保持
    const lootList = died ? [] : lootBag.map((l) => `${l.emoji || ''}${l.label}${(l.qty || 1) > 1 ? `×${l.qty}` : ''}`)
    setLootBag([])
    const { data, error } = await supabase.rpc('dungeon_finish', {
      p_run_id: runIdRef.current, p_floors: floorsRef.current,
      p_enemies: enemiesRef.current, p_items: itemsRef.current, p_cleared: cleared, p_died: died,
    })
    if (!error && data) setReward({ ...data, lootGranted: died ? 0 : (data.loot_granted || 0), lootList })
  }, [lootBag])

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      userIdRef.current = user.id
      const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      if (!prof?.is_admin) { setAllowed(false); return } // 一般公開は不正対策(RPC化)後まで停止
      // 選択中のペットを読み込む
      const { data: ap } = await supabase.from('pets').select('*').eq('owner_id', user.id).eq('is_active', true).maybeSingle()
      if (ap) {
        // 装備中チャームを取得してステに反映（チャーム成長値＋守り＝防御+10%）
        let charm = null
        if (ap.charm_id) { const { data: c } = await supabase.from('player_charms').select('*').eq('id', ap.charm_id).maybeSingle(); charm = c }
        const st = applyCharmStats(petStats(ap), charm)
        const slots = Array.isArray(ap.skill_slots) && ap.skill_slots.length ? ap.skill_slots : ['tackle']
        setPet({ id: ap.id, species: ap.species, evolved: ap.evolved, charm, name: ap.name, emoji: speciesEmoji(ap), image_url: petImage(ap), skillSlots: slots, level: ap.level, exp: ap.exp, ...st })
        setSelectedSkill(slots[0])
        setPetHp(st.maxHp)
      }
      const { data: its } = await supabase.from('pet_items').select('item_key, qty').eq('owner_id', user.id)
      setInventory(Object.fromEntries((its || []).map((r) => [r.item_key, r.qty])))
      // クリア済みダンジョン（開放判定用）
      const { data: cl } = await supabase.from('dungeon_runs').select('dungeon_id').eq('owner_id', user.id).eq('cleared', true)
      if (cl) setCleared(new Set(cl.map((r) => r.dungeon_id)))

      // 中断していた探索を復元（リロードしても継続）
      let restored = false
      const raw = ap ? localStorage.getItem(`bf_dungeon2_${user.id}`) : null
      if (raw) {
        try {
          const sv = JSON.parse(raw)
          if (sv?.runId && sv?.state) {
            runIdRef.current = sv.runId
            finishedRef.current = false
            enemiesRef.current = sv.kills || 0
            floorsRef.current = sv.floorsCleared || 0
            itemsRef.current = sv.itemsCollected || 0
            setDungeon(getDungeon(sv.dungeonId))
            setFloorNum(sv.floorNum)
            setPetHp(sv.petHp)
            setFullness(sv.fullness)
            setTurns(sv.turns)
            setSelectedSkill(sv.selectedSkill || 'tackle')
            if (sv.inventory) setInventory(sv.inventory)
            if (Array.isArray(sv.lootBag)) setLootBag(sv.lootBag)
            setState({ ...sv.state, explored: new Set(sv.state.explored) })
            setStatus('exploring')
            restored = true
          }
        } catch { /* 壊れていたら無視 */ }
      }
      if (!restored) setStatus('select')
      setAllowed(true)
    })()
  }, [nav])

  const enterFloor = useCallback((num, dg) => {
    const f = generateFloor(num, dg)
    // 初期視界を記憶に反映
    f.explored = computeVisible(f.rooms, f.player.x, f.player.y)
    setState(f)
    setPoisoned(false) // 次フロアに行くと毒は回復
  }, [])

  // ダンジョンを選んで開始
  const beginDungeon = (d) => {
    setDungeon(d)
    setFloorNum(1); setPetHp(pet.maxHp); setTurns(0); setFullness(MAX_FULLNESS); setPoisoned(false); setLootBag([]); setDropMode(false); setLog([]); setReward(null); setStatus('exploring')
    enterFloor(1, d)
    startRun(pet.id, d.id)
  }

  // 探索中はlocalStorageへ保存（リロードで継続）／終了したら破棄
  useEffect(() => {
    const key = saveKey()
    if (!key) return
    if (status === 'exploring' && state && pet.id && runIdRef.current) {
      const sv = {
        runId: runIdRef.current, dungeonId: dungeon?.id, floorNum, petHp, fullness, turns,
        selectedSkill, inventory, lootBag, kills: enemiesRef.current, floorsCleared: floorsRef.current, itemsCollected: itemsRef.current,
        state: { ...state, explored: [...state.explored] },
      }
      try { localStorage.setItem(key, JSON.stringify(sv)) } catch { /* 容量超過などは無視 */ }
    } else if (status === 'cleared' || status === 'dead' || status === 'escaped') {
      localStorage.removeItem(key)
    }
  }, [status, state, petHp, fullness, turns, selectedSkill, inventory, lootBag, floorNum, dungeon, pet.id])

  // side: 'left'=自分/全般 / 'right'=敵の行動
  const addLog = (msg, side = 'left') => setLog((l) => [{ msg, side }, ...l].slice(0, 30))

  // 持ち物の合計数（だっしゅつの翼は対象外＝消耗品＋戦利品）。上限を超えたら拾えない
  const bagCount = () => Object.entries(inventory).filter(([k]) => k !== 'escape').reduce((s, [, q]) => s + (q || 0), 0) + lootBag.length
  // ルート品を持ち物へ（表示用 label/emoji を付与）。素は同種でスタック（1枠扱い）、それ以外は個別
  const addLootToBag = (raw) => {
    const loot = { ...raw, ...lootDisplay(raw) }
    setLootBag((b) => {
      if (loot.type === 'seed') {
        const i = b.findIndex((x) => x.type === 'seed' && x.seedKey === loot.seedKey)
        if (i >= 0) { const c = [...b]; c[i] = { ...c[i], qty: (c[i].qty || 1) + (loot.qty || 1) }; return c }
        return [...b, { ...loot, qty: loot.qty || 1 }]
      }
      return [...b, loot]
    })
  }

  const tryMove = (dx, dy) => {
    if (!state || status !== 'exploring' || busyRef.current) return
    let s = state
    const px = s.player.x, py = s.player.y
    const nx = px + dx, ny = py + dy
    if (!inBounds(nx, ny) || s.grid[ny][nx] === '#') return

    let curPetHp = petHp
    let enemies = s.enemies
    let player = s.player
    let fullCost = 0

    // 敵への体当たり＝選択中スキルが発動（コスト分の満腹度を消費）
    const target = enemies.find((e) => e.x === nx && e.y === ny)
    if (target) {
      const sk = getSkill(selectedSkill)
      const cost = sk.cost || 0
      if (cost > fullness) { addLog(`🍖 満腹度が足りない（${sk.name}は${cost}必要）たいあたりに切替を`); return }
      fullCost = cost
      const hits = sk.hits || 1
      // ペットの攻撃タイプに応じて敵の def(物理)/mdef(特殊)で軽減
      const guard = pet.atkType === 'spec' ? (target.mdef || 0) : (target.def || 0)
      const perHit = calcDamage(Math.round(pet.atk * (sk.mult || 1)), guard)
      const total = perHit * hits
      const newHp = target.hp - total
      const skillTag = selectedSkill === 'tackle' ? '' : `【${sk.name}】`
      const hitTxt = hits > 1 ? `${perHit}×${hits}=` : ''
      if (sk.lifesteal) { const heal = Math.floor(total * sk.lifesteal); curPetHp = Math.min(pet.maxHp, curPetHp + heal); if (heal > 0) addLog(`💚 ${heal}回復`) }
      const killed = newHp <= 0
      if (killed) { enemies = enemies.filter((e) => e.id !== target.id); enemiesRef.current += 1; grantKill(floorNum, target.name); triggerShake('kill') }
      else { enemies = enemies.map((e) => e.id === target.id ? { ...e, hp: newHp } : e); addLog(`⚔${skillTag} ${target.name}に${hitTxt}${total}`); triggerShake('hit') }

      // 体当たり演出：ペットを相手方向へ突進、被弾した敵を点滅させる
      applyFx({ pet: { lunge: { dx, dy } }, enemies: killed ? {} : { [target.id]: { flash: true } } })
      // 敵HPを即時反映してから、一呼吸おいて敵のターン（反撃）へ
      setState({ ...s, player, enemies })
      busyRef.current = true
      const tid = setTimeout(() => commitTurn(s, player, enemies, curPetHp, fullCost), BREATH_MS)
      turnTimers.current.push(tid)
      return
    } else {
      // アイテム取得
      const itemHere = s.items.find((it) => it.x === nx && it.y === ny)
      let items = s.items
      const isEscapePickup = itemHere && itemHere.kind === 'dropFood' && itemHere.key === 'escape'
      if (itemHere && !isEscapePickup && bagCount() >= DUNGEON_BAG_MAX) {
        // 持ち物が満杯：拾わずに床へ残す（足元のアイテムが何か分かるよう名前を表示）
        const onName = itemHere.kind === 'dropLoot' ? itemHere.loot?.label
          : (itemHere.kind === 'food' || itemHere.kind === 'dropFood') ? (PET_ITEMS[itemHere.key]?.name || 'アイテム')
          : '✨ なにか'
        addLog(`🎒 足元に「${onName}」があるが持ち物がいっぱい`)
      } else if (itemHere) {
        items = items.filter((it) => it.id !== itemHere.id); itemsRef.current += 1
        if (itemHere.kind === 'food') {
          // 床の消耗品をアイテム袋へ
          const fdef = PET_ITEMS[itemHere.key]
          grantFood(itemHere.key).then((ok) => addLog(ok ? `${fdef?.emoji || '🎁'} ${fdef?.name || 'アイテム'}を拾って袋に入れた` : '🎒 袋がいっぱいで拾えなかった'))
        } else if (itemHere.kind === 'dropLoot' && itemHere.loot) {
          // 自分が捨てたルート品を拾い直す（サーバーで pending へ戻す）
          supabase.rpc('dungeon_repick_loot', { p_run_id: runIdRef.current, p_loot_id: itemHere.loot.id }).then(({ data, error }) => {
            if (error) { addLog('拾えなかった'); return }
            const e = data || itemHere.loot; addLootToBag(e); const d = lootDisplay(e); addLog(`${d.emoji} ${d.label}を拾った`)
          })
        } else if (itemHere.kind === 'dropFood' && itemHere.key) {
          const fdef = PET_ITEMS[itemHere.key]
          grantFood(itemHere.key).then((ok) => addLog(ok ? `${fdef?.emoji || '🎁'} ${fdef?.name || 'アイテム'}を拾った` : '🎒 袋がいっぱいで拾えなかった'))
        } else {
          // ✨：サーバーが抽選して保持（生還で入手）
          supabase.rpc('dungeon_pickup', { p_run_id: runIdRef.current }).then(({ data, error }) => {
            if (error || !data) { addLog('✨ アイテムを拾った'); return }
            addLootToBag(data); const d = lootDisplay(data); addLog(`${d.emoji} ${d.label}を拾った`)
          })
        }
      }
      player = { x: nx, y: ny }
      s = { ...s, items }

      // 階段
      if (player.x === s.stairs.x && player.y === s.stairs.y) {
        floorsRef.current += 1
        if (floorNum >= (dungeon?.floors || 10)) { setStatus('cleared'); addLog('🏁 最深部を踏破！ダンジョンクリア！'); setState({ ...s, player }); if (dungeon) setCleared((c) => new Set(c).add(dungeon.id)); finishRun(true); return }
        addLog(`⬇ B${floorNum + 1}Fへ降りた`)
        setFloorNum(floorNum + 1)
        enterFloor(floorNum + 1, dungeon)
        return
      }
    }

    commitTurn(s, player, enemies, curPetHp, fullCost)
  }

  // 1ターン経過の共通処理：敵の行動／満腹度・HPの増減／視界更新
  //  fullCost: このターンに消費(正)/回復(負)する満腹度
  const commitTurn = (s, player, enemies, curPetHp, fullCost = 0) => {
    // ---- 敵のターン ----
    // 敵が重ならないよう、移動済みの位置も含めて占有マスを管理する
    const taken = new Set(enemies.map((e) => e.x + ',' + e.y))
    const isFloor = (x, y) => inBounds(x, y) && s.grid[y][x] === '.'
    // プレイヤーが今見えているマス（見えていない敵には攻撃させない）
    const visNow = computeVisible(s.rooms, player.x, player.y)
    let dead = false
    const attackerFx = {} // 反撃してきた敵の突進演出
    let petHit = false
    let willPoison = false // このターンに毒を受けたか
    enemies = enemies.map((e) => {
      const sees = enemySeesPet(s.rooms, e, player.x, player.y)
      const adjacent = Math.abs(e.x - player.x) + Math.abs(e.y - player.y) === 1
      if (sees && adjacent && visNow.has(e.x + ',' + e.y)) {
        // 敵の攻撃タイプに応じて pet.def(物理)/mdef(特殊)で軽減
        const guard = e.type === 'spec' ? (pet.mdef || 0) : (pet.def || 0)
        let dmg = calcDamage(e.atk || 1, guard)
        // 敵スキル（確率発動）：heavy=倍率／poison=毒／vamp=自己回復
        const notes = []
        let heal = 0
        const antidote = getCharm(pet.charm?.ctype).effect === 'antidote'
        for (const sk of (e.skills || [])) {
          // 解毒のチャーム装備時は毒の発動確率を50%に
          const chance = sk.type === 'poison' && antidote ? sk.chance * 0.5 : sk.chance
          if (Math.random() >= chance) continue
          if (sk.type === 'heavy') { dmg = Math.round(dmg * (sk.mult || 1)); notes.push(sk.name) }
          else if (sk.type === 'poison') { willPoison = true; notes.push(sk.name) }
          else if (sk.type === 'vamp') { heal = Math.floor(dmg * (sk.frac || 0.5)); notes.push(sk.name) }
        }
        curPetHp -= dmg
        const tag = notes.length ? `【${notes.join('・')}】` : '攻撃'
        addLog(`${e.name}の${tag}！ ${dmg}ダメージ 💥`, 'right')
        attackerFx[e.id] = { lunge: { dx: Math.sign(player.x - e.x), dy: Math.sign(player.y - e.y) } }
        petHit = true
        if (curPetHp <= 0) dead = true
        return heal > 0 ? { ...e, hp: Math.min(e.maxHp, e.hp + heal) } : e
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
        const ck = c.x + ',' + c.y
        if (isFloor(c.x, c.y) && !taken.has(ck) && !(c.x === player.x && c.y === player.y)) {
          taken.delete(e.x + ',' + e.y); taken.add(ck) // 移動先を占有・元を解放
          return { ...e, x: c.x, y: c.y }
        }
      }
      return e
    })

    // ---- 満腹度・HP ----
    const nextTurns = turns + 1
    setTurns(nextTurns)
    let nextFull = Math.max(0, Math.min(MAX_FULLNESS, fullness - fullCost)) // スキル消費/食料回復を反映
    if (!dead) {
      if (nextTurns % FULLNESS_EVERY === 0 && nextFull > 0) { nextFull -= 1; if (nextFull === 0) addLog('🍖 満腹度が0になった…！') }
      if (nextFull <= 0) {
        curPetHp -= 1; addLog('🥀 空腹で1ダメージ')
        if (curPetHp <= 0) dead = true
      } else if (nextTurns % HP_REGEN_EVERY === 0 && curPetHp < pet.maxHp) {
        curPetHp += 1
      }
      // 毒：POISON_INTERVAL ターンごとに最大HPの POISON_PCT ダメージ（次フロアで回復）
      if (poisoned && nextTurns % POISON_INTERVAL === 0) {
        const pd = Math.max(1, Math.ceil(pet.maxHp * POISON_PCT))
        curPetHp -= pd; addLog(`☠ 毒で${pd}ダメージ`)
        if (curPetHp <= 0) dead = true
      }
    }
    setFullness(nextFull)
    setPetHp(curPetHp)
    if (willPoison && !poisoned) { setPoisoned(true); addLog('☠ 毒におかされた…！', 'right') }
    if (dead) { setStatus('dead'); addLog('💀 ペットは力尽きた…'); finishRun(false, true) }

    // ---- 40ターンごとに敵が1体湧く ----
    if (!dead && nextTurns % SPAWN_EVERY === 0 && enemies.length < SPAWN_CAP) {
      const born = spawnEnemy(s, enemies, player)
      if (born) { enemies = [...enemies, born]; addLog('物音がした…新たな敵が現れた 👁', 'right') }
    }

    // 敵の反撃演出（突進＋ペット点滅）。被弾時はマップも軽く揺らす
    if (Object.keys(attackerFx).length) {
      applyFx({ pet: petHit ? { flash: true } : null, enemies: attackerFx })
      if (petHit) triggerShake('hit')
    } else {
      applyFx({}) // 直前の体当たり演出をクリア
    }
    busyRef.current = false

    // 視界を更新して記憶へ追記
    const nowVis = computeVisible(s.rooms, player.x, player.y)
    const explored = new Set(s.explored); nowVis.forEach((k) => explored.add(k))
    setState({ ...s, player, enemies, explored })
  }

  // 持ち物の使用（食料＝満腹回復・1ターン経過 / だっしゅつの翼＝脱出）
  const useItem = async (key) => {
    if (status !== 'exploring' || busyRef.current || (inventory[key] || 0) < 1) return
    const def = PET_ITEMS[key]
    // だっしゅつの翼は使い切り＝消費確認をはさむ
    if (key === 'escape') {
      if (!window.confirm('だっしゅつの翼を使ってダンジョンから戻りますか？（1個消費します）')) return
    }
    const { error } = await supabase.rpc('pet_consume_item', { p_key: key })
    if (error) { addLog('アイテムを持っていない'); return }
    setInventory((inv) => ({ ...inv, [key]: (inv[key] || 1) - 1 }))
    if (key === 'escape') {
      setStatus('escaped'); addLog('🪽 ダンジョンから脱出した'); finishRun(false); return
    }
    if (def?.healPct) {
      const heal = Math.ceil(pet.maxHp * def.healPct)
      const healed = Math.min(pet.maxHp, petHp + heal)
      addLog(`${def.emoji} ${def.name}を食べた（HP+${healed - petHp}）`)
      commitTurn(state, state.player, state.enemies, healed) // 1ターン経過＋HP回復を反映
    } else if (def?.fullness) {
      addLog(`${def.emoji} ${def.name}を食べた（満腹+${def.fullness}）`)
      commitTurn(state, state.player, state.enemies, petHp, -def.fullness) // 1ターン経過＋満腹回復
    }
  }

  // 持ち物を足元に置く（捨てる）。足元に既にアイテムがあると不可。1ターン消費
  const dropItem = async (entry) => {
    if (!state || status !== 'exploring' || busyRef.current) return
    const px = state.player.x, py = state.player.y
    if (state.items.some((it) => it.x === px && it.y === py)) { addLog('🎒 足元にアイテムがあるので置けない'); return }
    let floorItem, label
    if (entry.kind === 'loot') {
      // サーバーで pending → dropped へ移す
      const { error } = await supabase.rpc('dungeon_drop_loot', { p_run_id: runIdRef.current, p_loot_id: entry.loot.id })
      if (error) { addLog('置けなかった'); return }
      floorItem = { id: 'd' + entry.loot.id, x: px, y: py, kind: 'dropLoot', loot: entry.loot }
      label = entry.loot.label
      setLootBag((b) => b.filter((l) => l.id !== entry.loot.id))
    } else {
      if ((inventory[entry.key] || 0) < 1) return
      const { error } = await supabase.rpc('pet_consume_item', { p_key: entry.key })
      if (error) { addLog('置けなかった'); return }
      setInventory((inv) => ({ ...inv, [entry.key]: (inv[entry.key] || 1) - 1 }))
      dropSeq.current += 1
      floorItem = { id: 'df' + dropSeq.current, x: px, y: py, kind: 'dropFood', key: entry.key }
      label = PET_ITEMS[entry.key]?.name || 'アイテム'
    }
    addLog(`🎒 ${label}を足元に置いた`)
    commitTurn({ ...state, items: [...state.items, floorItem] }, state.player, state.enemies, petHp) // 1ターン消費
  }

  // 足踏み：その場で1ターン経過
  const stepInPlace = () => {
    if (!state || status !== 'exploring' || busyRef.current) return
    addLog('🚶 足踏みした')
    commitTurn(state, state.player, state.enemies, petHp)
  }

  const restart = () => { if (dungeon) beginDungeon(dungeon) }

  // ダンジョン選択へ戻る（探索中なら現在の進捗で精算）
  const backToSelect = async () => { await finishRun(false); setDungeon(null); setStatus('select') }

  // 街に戻る（探索中なら現在の進捗で精算してから離脱）
  const leaveToTown = async () => { await finishRun(false); nav('/game') }

  if (allowed === undefined) return <Center>読み込み中...</Center>
  if (!allowed) return <Center>このページは開発中です（権限がありません）<br /><Btn onClick={() => nav('/game')}>🏰 街に戻る</Btn></Center>

  // ダンジョン選択画面
  if (status === 'select') {
    return (
      <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', padding: 16 }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #003366', paddingBottom: 8, marginBottom: 10 }}>
            <div style={{ color: '#ffcc00', fontSize: 16, letterSpacing: 3 }}>BATTLE FRONTIER</div>
            <Btn onClick={() => nav('/game')}>← 街に戻る</Btn>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ color: '#aa88ff', letterSpacing: 2 }}>🕳 ダンジョン選択 <span style={{ fontSize: 11, color: '#4466aa' }}>[開発中]</span></div>
            <Btn onClick={() => nav('/pets')}>🐾 ペット</Btn>
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 12, marginBottom: 12, alignItems: 'center' }}>
            {pet.image_url ? <img src={pet.image_url} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }} /> : <span style={{ fontSize: 22 }}>{pet.emoji}</span>}
            <span>{pet.name}　Lv{pet.level ?? 1}{pet.id ? '' : '（ペット未選択＝報酬なし）'}</span>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {DUNGEONS.map((d) => {
              const unlocked = !d.comingSoon && (!d.requires || cleared.has(d.requires))
              const isCleared = cleared.has(d.id)
              return (
                <div key={d.id} onClick={() => unlocked && beginDungeon(d)}
                  style={{ border: `1px solid ${unlocked ? '#335588' : '#223344'}`, background: unlocked ? '#00102a' : '#080c14', padding: 12, cursor: unlocked ? 'pointer' : 'default', opacity: unlocked ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 30 }}>{d.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#cce6ff', fontSize: 14 }}>{d.name} <span style={{ color: '#6699cc', fontSize: 11 }}>全{d.floors}階</span> {isCleared && <span style={{ color: '#44ff88', fontSize: 10 }}>✓クリア済</span>}</div>
                    <div style={{ color: unlocked ? '#6699cc' : '#aa6644', fontSize: 11, marginTop: 2 }}>
                      {d.comingSoon ? '🔒 近日公開（後日のアップデートで開放）' : unlocked ? 'タップして挑戦' : `${getDungeon(d.requires).name} をクリアで開放`}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ color: '#557799', fontSize: 10, marginTop: 12 }}>※さらに深いダンジョンは今後のアップデートで追加予定</div>
        </div>
      </div>
    )
  }

  if (!state) return <Center>生成中...</Center>

  const visible = computeVisible(state.rooms, state.player.x, state.player.y)
  const isVisible = (x, y) => visible.has(x + ',' + y)
  const isExplored = (x, y) => state.explored.has(x + ',' + y)

  // ビューポート描画（プレイヤー中心）
  const ox = state.player.x - Math.floor(VW / 2)
  const oy = state.player.y - Math.floor(VH / 2)
  // 通路にいるときは円形マスク（ビネット）で視界を完全な円に見せる。部屋では従来どおり
  const inCorridor = !roomOf(state.rooms, state.player.x, state.player.y)
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
    if (!vis) return { ch: '', bg: C.unknown } // 現在見えていない所は完全に真っ暗（記憶表示なし）
    const wall = state.grid[y][x] === '#'
    // 現在視界：エンティティ優先（足元は床色）
    if (state.player.x === x && state.player.y === y) return { ch: pet.emoji || '🐾', img: pet.image_url, bg: C.floorVis, fx: fx.pet }
    const e = state.enemies.find((o) => o.x === x && o.y === y)
    if (e) return { ch: '👹', img: e.image || null, bg: C.floorVis, fx: fx.enemies[e.id] || null }
    const it = state.items.find((o) => o.x === x && o.y === y)
    if (it) {
      const ch = (it.kind === 'food' || it.kind === 'dropFood') ? (PET_ITEMS[it.key]?.emoji || '🍙')
        : it.kind === 'dropLoot' ? (it.loot?.emoji || '🎁') : '✨'
      return { ch, bg: C.floorVis }
    }
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
      <style>{`
        @keyframes bf-dungeon-shake-hit {
          0%,100% { transform: translate(0,0); }
          20% { transform: translate(-3px, 1px); }
          40% { transform: translate(3px, -2px); }
          60% { transform: translate(-2px, 2px); }
          80% { transform: translate(2px, -1px); }
        }
        @keyframes bf-dungeon-shake-kill {
          0%,100% { transform: translate(0,0) scale(1); }
          15% { transform: translate(-6px, 2px) scale(1.015); }
          30% { transform: translate(6px, -4px) scale(1.015); }
          45% { transform: translate(-5px, 3px) scale(1.01); }
          60% { transform: translate(5px, -2px) scale(1.01); }
          80% { transform: translate(-2px, 1px) scale(1); }
        }
        @keyframes bf-flash {
          0%,100% { opacity: 1; filter: none; }
          20% { opacity: 0.15; }
          45% { opacity: 1; filter: brightness(2.4) drop-shadow(0 0 4px #fff); }
          70% { opacity: 0.3; }
        }
        @keyframes bf-lunge {
          0%,100% { transform: translate(0,0); }
          45% { transform: translate(var(--lx,0), var(--ly,0)); }
        }
      `}</style>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #003366', paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ color: '#ffcc00', fontSize: 16, letterSpacing: 3 }}>BATTLE FRONTIER</div>
          <Btn onClick={leaveToTown}>← 街に戻る</Btn>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ color: '#aa88ff', letterSpacing: 2 }}>{dungeon?.emoji || '🕳'} {dungeon?.name || 'ダンジョン'} <span style={{ fontSize: 11, color: '#4466aa' }}>[開発中]</span></div>
        </div>

        <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <span>B{floorNum}/{dungeon?.floors || 10}F</span>
          <span style={{ color: '#9fd' }}>Lv{pet.level}{pet.exp != null ? `（EXP ${pet.exp}/${expForLevel(pet.level || 1)}）` : ''}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: petHp > pet.maxHp * 0.3 ? '#44ff88' : '#ff5555' }}>
            {pet.image_url ? <img src={pet.image_url} alt="" style={{ width: 16, height: 16, objectFit: 'cover', borderRadius: 3 }} /> : <span>{pet.emoji}</span>}
            {pet.name} HP {petHp}/{pet.maxHp}
          </span>
          {poisoned && <span style={{ color: '#cc77ff' }}>☠ 毒</span>}
          <span style={{ color: fullness > 0 ? '#ffcc44' : '#ff5555' }}>🍖 満腹 {fullness}/{MAX_FULLNESS}</span>
          <span style={{ color: '#aa88ff' }}>⚡{getSkill(selectedSkill).name}</span>
        </div>

        {/* マップ（ビューポート）。接触時に少し震える戦闘演出 */}
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${VW}, 1fr)`, gap: 0, background: '#000208', padding: 6, border: '1px solid #113355', willChange: 'transform', animation: shake === 'kill' ? 'bf-dungeon-shake-kill 0.36s ease-in-out' : shake === 'hit' ? 'bf-dungeon-shake-hit 0.22s ease-in-out' : 'none' }}>
          {Array.from({ length: VH }).map((_, vy) => Array.from({ length: VW }).map((_, vx) => {
            const x = ox + vx, y = oy + vy
            const c = cellAt(x, y)
            const clickable = status === 'exploring' && isVisible(x, y) && inBounds(x, y) && state.grid[y]?.[x] !== '#' &&
              Math.abs(x - state.player.x) + Math.abs(y - state.player.y) === 1
            const inner = c.img ? <img src={c.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : c.ch
            const anims = []
            if (c.fx?.lunge) anims.push('bf-lunge 0.26s ease-out')
            if (c.fx?.flash) anims.push('bf-flash 0.42s ease-in-out')
            const fxStyle = c.fx ? {
              width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: anims.join(', '), willChange: 'transform, opacity',
              '--lx': c.fx.lunge ? `${Math.sign(c.fx.lunge.dx) * 40}%` : '0%',
              '--ly': c.fx.lunge ? `${Math.sign(c.fx.lunge.dy) * 40}%` : '0%',
            } : null
            return (
              <div key={`${vx}-${vy}`} onClick={() => clickable && adjClick(vx, vy)}
                style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, background: c.bg, opacity: c.dim ? 0.5 : 1, cursor: clickable ? 'pointer' : 'default', overflow: 'visible', boxShadow: `0 0 0 0.6px ${c.bg}` }}>
                {fxStyle ? <div key={`fx${fx.t}`} style={fxStyle}>{inner}</div> : inner}
              </div>
            )
          }))}
          {/* 通路では円形ビネットを重ねて視界を円に見せる（プレイヤー＝中央50%） */}
          {inCorridor && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
              background: 'radial-gradient(ellipse 29% 35.4% at 50% 50%, transparent 80%, #000208 100%)' }} />
          )}
        </div>

        {status === 'exploring' && (
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center', marginTop: 12 }}>
            {/* 十字キー */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gap: 4 }}>
              <span /><Btn onClick={() => tryMove(0, -1)}>▲</Btn><span />
              <Btn onClick={() => tryMove(-1, 0)}>◀</Btn><Btn onClick={stepInPlace}>足踏</Btn><Btn onClick={() => tryMove(1, 0)}>▶</Btn>
              <span /><Btn onClick={() => tryMove(0, 1)}>▼</Btn><span />
            </div>
            {/* 十字の隣にスキル（選択中を体当たりで発動） */}
            <div style={{ display: 'grid', gap: 4 }}>
              {(pet.skillSlots || ['tackle']).map((id) => {
                const on = selectedSkill === id
                return (
                  <button key={id} onClick={() => setSelectedSkill(id)}
                    style={{ background: on ? '#241640' : '#000a18', border: `1px solid ${on ? '#aa88ff' : '#224466'}`, color: on ? '#cba6ff' : '#5e7fa0', padding: '6px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, minWidth: 110, textAlign: 'left' }}>
                    {on ? '▶ ' : ''}{getSkill(id).name}{getSkill(id).cost > 0 ? ` (満腹${getSkill(id).cost})` : ''}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {status === 'exploring' && (() => {
          const consumables = DUNGEON_ITEMS.filter((it) => (inventory[it.key] || 0) > 0)
          const empty = consumables.length === 0 && lootBag.length === 0
          return (
            <div style={{ marginTop: 12, background: '#000610', border: `1px solid ${dropMode ? '#cc7755' : '#113355'}`, padding: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ color: '#88aacc', fontSize: 11 }}>🎒 持ち物 <span style={{ color: bagCount() >= DUNGEON_BAG_MAX ? '#ff7777' : '#5e7fa0' }}>{bagCount()}/{DUNGEON_BAG_MAX}</span>（翼は対象外）{dropMode && <span style={{ color: '#ff9966' }}>　捨てるモード：押すと足元に置く</span>}</div>
                <button onClick={() => setDropMode((d) => !d)}
                  style={{ background: dropMode ? '#2a1000' : '#0a1424', border: `1px solid ${dropMode ? '#ff9966' : '#335588'}`, color: dropMode ? '#ff9966' : '#88aacc', padding: '3px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                  🗑 捨てる{dropMode ? '（ON）' : ''}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {consumables.map((it) => (
                  <button key={it.key} onClick={() => (dropMode ? dropItem({ kind: 'consumable', key: it.key }) : useItem(it.key))}
                    style={{ background: dropMode ? '#1a0e08' : '#0a1424', border: `1px solid ${dropMode ? '#cc7755' : '#335588'}`, color: '#cce6ff', padding: '6px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>
                    {it.emoji} {it.name}×{inventory[it.key]}
                  </button>
                ))}
                {lootBag.map((l) => (
                  <button key={l.id} onClick={() => dropMode && dropItem({ kind: 'loot', loot: l })}
                    style={{ background: dropMode ? '#1a0e08' : '#0a1a14', border: `1px solid ${dropMode ? '#cc7755' : '#2a5544'}`, color: '#bfe6cc', padding: '6px 10px', cursor: dropMode ? 'pointer' : 'default', fontFamily: 'monospace', fontSize: 12 }}>
                    {l.emoji} {l.label}{(l.qty || 1) > 1 ? `×${l.qty}` : ''}
                  </button>
                ))}
                {empty && <span style={{ color: '#445566', fontSize: 11 }}>（持ち物なし）</span>}
              </div>
              {lootBag.length > 0 && <div style={{ color: '#557766', fontSize: 10, marginTop: 6 }}>※装備・宝石・強化石は生きて帰ると入手（やられると失う）</div>}
            </div>
          )
        })()}
        {status === 'cleared' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#ffcc44' }}>🏁 ダンジョンクリア！<br /><br /><Btn onClick={restart}>もう一度</Btn> <Btn onClick={backToSelect}>ダンジョン選択</Btn> <Btn onClick={() => nav('/pets')}>🐾 ペット</Btn> <Btn onClick={leaveToTown}>街に戻る</Btn></div>
        )}
        {status === 'dead' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#ff5555' }}>💀 ペットは力尽きた…（なつき-3）<br /><br /><Btn onClick={restart}>再挑戦</Btn> <Btn onClick={backToSelect}>ダンジョン選択</Btn> <Btn onClick={() => nav('/pets')}>🐾 ペット</Btn> <Btn onClick={leaveToTown}>街に戻る</Btn></div>
        )}
        {status === 'escaped' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#cc88ff' }}>🪽 ダンジョンから脱出した<br /><br /><Btn onClick={restart}>もう一度</Btn> <Btn onClick={backToSelect}>ダンジョン選択</Btn> <Btn onClick={() => nav('/pets')}>🐾 ペット</Btn> <Btn onClick={leaveToTown}>街に戻る</Btn></div>
        )}

        {/* ログ見出し：左＝自分の行動／右＝敵の行動 */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '0 2px 4px', borderBottom: '1px solid #113355' }}>
          <span style={{ color: '#5588bb' }}>◀ 自分のログ</span>
          <span style={{ color: '#cc8888' }}>敵のログ ▶</span>
        </div>
        <div style={{ background: '#000610', border: '1px solid #113355', borderTop: 'none', padding: 8, height: 140, overflowY: 'auto', fontSize: 11 }}>
          {log.length === 0 ? <span style={{ color: '#335577' }}>隣のマスをクリック、または矢印で移動。部屋に入ると視界が開ける。👹に触れると戦闘、▼で次の階へ。</span>
            : log.map((l, i) => <div key={i} style={{ color: i === 0 ? '#aaddff' : l.side === 'right' ? '#cc8888' : '#5588bb', textAlign: l.side === 'right' ? 'right' : 'left' }}>{l.msg}</div>)}
        </div>

        {/* ⚔ 簡易出撃（カジノと同じ・自キャラを並行して育成できる） */}
        <SortiePanel />
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
      <div style={{ color: '#88bbee' }}>Lv{reward.level}（EXP {reward.exp}） / なつき {reward.affection}/100</div>
      {reward.aff_delta ? <div style={{ marginTop: 4, color: reward.aff_delta < 0 ? '#ff7777' : '#88ffaa' }}>なつき {reward.aff_delta > 0 ? '+' : ''}{reward.aff_delta}</div> : null}
      {reward.aff_bonus > 0 ? <div style={{ marginTop: 2, color: '#88ffaa', fontSize: 10 }}>🎉 ダンジョン{reward.clears}回達成！なつき+1</div> : (reward.clears != null ? <div style={{ marginTop: 2, color: '#7799bb', fontSize: 10 }}>ダンジョン{reward.clears}回（あと{10 - (reward.clears % 10)}回でなつき+1）</div> : null)}
      {reward.lootGranted > 0 && (
        <div style={{ marginTop: 4, color: '#bfe6cc', fontSize: 11 }}>
          🎁 持ち帰った戦利品 {reward.lootGranted}個 を入手！
          {Array.isArray(reward.lootList) && reward.lootList.length > 0 && (
            <div style={{ marginTop: 2, color: '#9ccbb0', fontSize: 10, lineHeight: 1.6 }}>{reward.lootList.join('、')}</div>
          )}
        </div>
      )}
      <div style={{ marginTop: 4, color: '#7799bb', fontSize: 10 }}>※EXPは撃破ごとに付与済み</div>
    </div>
  )
}
function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>{children}</div>
}
function Btn({ children, onClick }) {
  return <button onClick={onClick} style={{ background: '#001840', border: '1px solid #0088ff', color: '#0088ff', padding: '6px 12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13 }}>{children}</button>
}
