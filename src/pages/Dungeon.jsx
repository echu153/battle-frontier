import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useScarecrowBlock, ScarecrowBlockScreen } from '../components/ScarecrowGuard'
import { petStats, speciesEmoji, petImage, getSkill, PET_ITEMS, DUNGEON_ITEMS, bagCapacity, expForLevel, DUNGEONS, getDungeon, areaForFloor, enemiesForFloor, dungeonEnemyStatsFor, pickEnemyImage, enemySkillsFor, POISON_INTERVAL, POISON_PCT, getCharm, applyCharmStats, charmHasEffect, charmsForFloor, dgTileSrc, dgWallTiles, dgWallVariant, dgWaterWall, isWaterFloor, isAquatic, SCROLL_KEYS, getScroll, petItemImg, isBossFloor, DEVIL_PAPIA, assetSrc, ASSET_VER } from '../constants/pets'
import { GEM_DATA } from './Game'
import SortiePanel from '../components/SortiePanel'


// ============================================================
// 不思議のダンジョン風（一般公開）
//  - 部屋＋通路を自動生成。階段はどこかの部屋にある
//  - 視界(フォグ)：通路は周囲のみ／部屋に入ると部屋全体が見える
//  - 敵AI：ペットが見えないとランダム徘徊、視界に入るとBFS最短経路で接近
//  - 戦闘：体当たりで選択スキル発動。敵の攻撃は1体ずつ順番に
//  - 戦利品・EXPはサーバーRPC(dungeon_*)で抽選・検証・付与（不正対策）
// ============================================================

// 区画グリッド（部屋スロット）
const RC = 3, RR = 2, CW = 9, CH = 9  // 区画を広げ、大きい部屋も出るように
const MAP_W = RC * CW, MAP_H = RR * CH
// 表示ビューポート（プレイヤー中心）
const VW = 11, VH = 10 // 上部のステータス表示分だけ縦に1行伸ばす

const FALLBACK_PET = { name: '仮ペット', emoji: '🐾', image_url: null, maxHp: 40, atk: 12, def: 4, mdef: 4, atkType: 'phys', skillSlots: ['tackle'] }
const MAX_FULLNESS = 100      // 満腹度の上限（100スタート）
const HP_REGEN_EVERY = 10     // 満腹なら10ターンごとにHP+1
const FULLNESS_EVERY = 10     // 10ターンごとに満腹度-1
const SPAWN_EVERY = 40        // 40ターンごとに敵が1体湧く
const SPAWN_CAP = 12          // フロアの敵がこの数以上なら湧かせない（過密防止）
// 状態異常
const PARALYZE_TURNS = 5      // 麻痺の持続ターン
const PARALYZE_FAIL = 0.30    // 麻痺中、攻撃が失敗する確率
const BURN_INTERVAL = 20      // やけど：このターンごとにダメージ
const BURN_PCT = 0.03         // やけど：最大HPのこの割合ダメージ
const BURN_ATK_DOWN = 0.10    // やけど中：攻撃/特攻ダウン率
const STAT_DOWN_PCT = 0.30    // 敵のデバフ：対象ステータスを30%減
const ENEMY_BUFF_MULT = 1.3   // 敵の自己バフ：攻撃1.3倍
const ENEMY_BUFF_TURNS = 4    // 敵の自己バフ持続
const PET_ATKUP_MULT = 1.3    // ペットの攻撃バフ：攻撃1.3倍

// 床に置く戦利品の抽選テーブル（クライアントで決定→床に実アイコン表示→拾得時サーバー検証）
const DG_SEEDS = ['atk_seed', 'spatk_seed', 'def_seed', 'spdef_seed', 'hp_seed']
const STONE_RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS']
const DG_GEMS = ['peridot', 'lapis', 'ruby', 'sapphire', 'amethyst', 'emerald', 'topaz', 'rosequartz', 'turquoise', 'morganite', 'kunzite', 'citrine', 'onyx', 'opal', 'moonstone', 'petalite']
const DG_CHARMS = ['antidote', 'guard']
// エリア別の装備（本編AREASのcommonDrops/rareDropsから武器のみ抽出）
const AREA_EQUIPS = {
  1: ['木の盾', '木の靴', '粗悪な布', '粗悪な鎧', '粗悪な指輪', '粗悪なピアス', 'ロングソード', 'マチェット', '丈夫な弓', '見習いの杖', '見習い魔導書', '魔導の杖', '魔術教本'],
  2: ['鋼鉄の剣', '鋭利なナイフ', '狩人の弓', '魔導の杖', '魔術教本', '戦士の指輪', '略奪の腕輪'],
  3: ['鋼鉄の剣', '鋭利なナイフ', '狩人の弓', '魔導の杖', '魔術教本', '古代の護符', '秘術の首飾り'],
  4: ['重鋼剣', '双牙短剣', '疾風の弓', '蒼木の杖', '精霊魔導典', '海流の腕輪', '蒼海の大剣', '海狼短剣', '蒼潮の弓', '海晶の杖', '海霊詠唱録', '蒼海の護符'],
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
// 装備が落ちるエリア（フロア→エリア）。d30=①1-5/②6-9/③10-19/④20-29、d10=①1-5/②6-、その他はエリア④寄り
function equipAreaFor(dungeonId, floor) {
  if (dungeonId === 'd30') return floor <= 5 ? 1 : floor <= 9 ? 2 : floor <= 19 ? 3 : 4
  if (dungeonId === 'd10') return floor <= 5 ? 1 : 2
  return 4
}
// 強化石ランク：10Fごとに1段上げる（1-9=F/E/D、10-19=E/D/C …）
function stoneRankForFloor(floor) {
  const tier = Math.floor((floor - 1) / 10)
  const baseIdx = Math.floor(Math.random() * 3) // 0,1,2 = F,E,D
  return STONE_RANKS[Math.min(STONE_RANKS.length - 1, baseIdx + tier)]
}
// 戦利品枠の抽選：素50 / 強化石10 / 宝石10 / チャーム4 / 装備6（合計80）
//  チャームはフロア解禁制。20F以降は0.1%で幸せのチャーム（超レア）
function rollFloorLoot(dungeonId, floor) {
  const r = Math.random() * 80
  if (r < 50) return { type: 'seed', seedKey: pick(DG_SEEDS), qty: 1 }
  if (r < 60) return { type: 'stone', rank: stoneRankForFloor(floor) }
  if (r < 70) return { type: 'gem', gemType: pick(DG_GEMS) }
  if (r < 74) {
    if (floor >= 20 && Math.random() < 0.001) return { type: 'charm', ctype: 'lucky' } // 0.1% 幸せのチャーム
    const pool = charmsForFloor(floor)
    return { type: 'charm', ctype: pool.length ? pick(pool) : 'guard' }
  }
  return { type: 'equip', name: pick(AREA_EQUIPS[equipAreaFor(dungeonId, floor)] || AREA_EQUIPS[1]) }
}

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1))

// この端末の固有ID（ダンジョンの1端末専用ロック用）。端末ごとに永続。
const getDeviceId = () => {
  let d = localStorage.getItem('bf_device_id')
  if (!d) {
    d = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem('bf_device_id', d)
  }
  return d
}
const inBounds = (x, y) => x >= 0 && x < MAP_W && y >= 0 && y < MAP_H

// ---- 多セル（ボス）ヘルパー ----
const enemyCells = (e) => {
  const n = e?.size || 1
  const cells = []
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) cells.push([e.x + dx, e.y + dy])
  return cells
}
const enemyAt = (enemies, x, y) => enemies.find((e) => enemyCells(e).some(([cx, cy]) => cx === x && cy === y))
// (px,py) が敵の占有マスのいずれかにチェビシェフ1で隣接しているか（内部は除く）
const enemyAdjacent = (e, px, py) => {
  const cells = enemyCells(e)
  if (cells.some(([cx, cy]) => cx === px && cy === py)) return false // 内部は不可
  return cells.some(([cx, cy]) => Math.max(Math.abs(cx - px), Math.abs(cy - py)) === 1)
}

// ボスフロア生成：正方形の部屋の中央に2×2ボス。雑魚・アイテムなし
function generateBossFloor(dungeon) {
  const grid = Array.from({ length: MAP_H }, () => Array(MAP_W).fill('#'))
  const RW = 15, RH = 13 // ボス部屋（正方形寄り）
  const rx = Math.floor((MAP_W - RW) / 2), ry = Math.floor((MAP_H - RH) / 2)
  for (let y = ry; y < ry + RH; y++) for (let x = rx; x < rx + RW; x++) grid[y][x] = '.'
  const room = { x: rx, y: ry, w: RW, h: RH, gx: 0, gy: 0, cx: Math.floor(rx + RW / 2), cy: Math.floor(ry + RH / 2) }
  // プレイヤーは部屋の下端中央
  const player = { x: room.cx, y: ry + RH - 2 }
  // ボスは中央（2×2の左上）
  const ph = DEVIL_PAPIA.phases[0]
  const boss = {
    id: 'boss', boss: true, size: DEVIL_PAPIA.size, phase: 0,
    x: room.cx - 1, y: ry + 2,
    name: DEVIL_PAPIA.name, type: ph.type, mix: !!ph.mix, image: assetSrc(ph.image),
    skills: ph.skills, reach: 1, canSwim: false,
    hp: ph.hp, maxHp: ph.hp, atk: ph.atk, def: ph.def, mdef: ph.mdef,
  }
  return { grid, rooms: [room], player, enemies: [boss], items: [], stairs: { x: -9, y: -9 }, explored: new Set() }
}

// ---- フロア自動生成 ----
function generateFloor(floorNum, dungeon) {
  if (isBossFloor(dungeon?.id, floorNum)) return generateBossFloor(dungeon)
  const grid = Array.from({ length: MAP_H }, () => Array(MAP_W).fill('#'))
  const rooms = []
  for (let gy = 0; gy < RR; gy++) {
    for (let gx = 0; gx < RC; gx++) {
      // 最低3×4（幅3・高さ4）以上の部屋にする（小さすぎる部屋を出さない）
      const rw = rand(3, CW - 2), rh = rand(4, CH - 2)
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
  const pool = enemiesForFloor(dungeon, floorNum)
  const enemies = []
  const enemyCount = Math.min(8, 3 + Math.floor(floorNum / 3))
  for (let i = 0; i < enemyCount; i++) {
    const room = otherRooms[rand(0, otherRooms.length - 1)]
    const t = randTileInRoom(room)
    if (t) {
      mark(t.x, t.y)
      const kind = pool[rand(0, pool.length - 1)]
      // 強さは初登場フロアの値で固定（深い階でも同種は同じ強さ）
      const es = dungeonEnemyStatsFor(dungeon, kind)
      enemies.push({ id: 'e' + i, x: t.x, y: t.y, name: kind.name, type: kind.type, image: pickEnemyImage(kind), skills: kind.skills || enemySkillsFor(kind.name), canSwim: isAquatic(kind.name), reach: kind.reach || 1, hp: es.maxHp, maxHp: es.maxHp, atk: es.atk, def: es.def, mdef: es.mdef })
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
    // ドロップ確率: 木の実8 / おにぎり8 / スキルの書4(10F+) / 残り80%=素50・石10・宝石10・チャーム4・装備6
    //  ※床に実アイテムのアイコンを表示（置いてある時点で何か分かる）。✨マーカーは廃止
    const r = Math.random()
    if (r < 0.08) items.push({ id: 'f' + i, x: t.x, y: t.y, kind: 'food', key: 'konomi' })
    else if (r < 0.16) items.push({ id: 'f' + i, x: t.x, y: t.y, kind: 'food', key: 'onigiri' })
    else if (r < 0.20 && floorNum >= 10) items.push({ id: 's' + i, x: t.x, y: t.y, kind: 'food', key: SCROLL_KEYS[rand(0, SCROLL_KEYS.length - 1)] }) // スキルの書（拾うと袋へ）
    else items.push({ id: 'i' + i, x: t.x, y: t.y, kind: 'loot', loot: rollFloorLoot(dungeon?.id, floorNum) })
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

// ダメージ計算: 割合軽減方式（物理=def / 特殊=mdef 共通）
//  ダメージ = 攻撃² ÷ (攻撃 + 防御)。防御は「割合カット」として効く
//  ・防御=攻撃と同値 → 半減 / 防御=攻撃の2倍 → 1/3 …とゼロにはならず必ず通る
//  ・能力差が開きすぎても 引き算式のような「1しか通らない/素通し」の極端さが出ない
function calcDamage(rawAtk, guard) {
  return Math.max(1, Math.round((rawAtk * rawAtk) / (rawAtk + Math.max(0, guard))))
}

export default function Dungeon() {
  const scarecrowBlock = useScarecrowBlock()
  const nav = useNavigate()
  const [allowed, setAllowed] = useState(undefined)
  const [pet, setPet] = useState(FALLBACK_PET)
  const [floorNum, setFloorNum] = useState(1)
  const [state, setState] = useState(null)
  const [petHp, setPetHp] = useState(FALLBACK_PET.maxHp)
  const [turns, setTurns] = useState(0)
  const [fullness, setFullness] = useState(MAX_FULLNESS)
  const [poisoned, setPoisoned] = useState(false) // 毒状態（次フロアで回復）
  const [paralyzed, setParalyzed] = useState(0)   // 麻痺＝あと何ターン麻痺するか（攻撃が確率で失敗）
  const [burned, setBurned] = useState(false)     // やけど（次フロアで回復・攻撃/特攻ダウン）
  const [debuff, setDebuff] = useState({ atk: 0, def: 0, mdef: 0 }) // 各ステのダウン残ターン（敵デバフ・30%減）
  const [shield, setShield] = useState(0)         // 結界/障壁＝あと何ターン被ダメ軽減か
  const shieldRateRef = useRef(1)                 // 軽減率（被ダメ×rate）
  const [regen, setRegen] = useState(0)           // 聖域＝あと何ターン毎ターン回復か
  const regenAmtRef = useRef(0)                   // 1ターンの回復量
  const [petAtkUp, setPetAtkUp] = useState(0)     // 自分の攻撃バフ＝あと何ターン攻撃1.3倍か
  const [padSide, setPadSide] = useState(() => { const v = localStorage.getItem('bf_dg_padside'); return (v === 'right' || v === 'center') ? v : 'left' }) // 移動キーの配置: left|center|right
  const setPad = (n) => { setPadSide(n); try { localStorage.setItem('bf_dg_padside', n) } catch { /* ignore */ } }
  const [seOn, setSeOn] = useState(() => localStorage.getItem('bf_dg_se') !== 'off') // 効果音 ON/OFF（全体ONなら既定オン）
  const [seVol, setSeVol] = useState(() => { const v = parseInt(localStorage.getItem('bf_dg_sevol') || '70', 10); return isNaN(v) ? 70 : Math.min(100, Math.max(0, v)) }) // SE音量 0〜100
  const seVolRef = useRef(seVol / 100)
  useEffect(() => { seVolRef.current = seVol / 100; try { localStorage.setItem('bf_dg_sevol', String(seVol)) } catch { /* ignore */ } }, [seVol])
  const [masterOn, setMasterOn] = useState(() => localStorage.getItem('bf_dg_master2') === 'on') // 全体音量のON/OFF（初期OFF。キー更新で過去のonをリセット）
  const [masterVol, setMasterVol] = useState(() => { const v = parseInt(localStorage.getItem('bf_dg_mastervol') || '70', 10); return isNaN(v) ? 70 : Math.min(100, Math.max(0, v)) }) // 全体音量 0〜100
  const masterRef = useRef(masterOn ? masterVol / 100 : 0)
  useEffect(() => { masterRef.current = masterOn ? masterVol / 100 : 0; try { localStorage.setItem('bf_dg_master2', masterOn ? 'on' : 'off'); localStorage.setItem('bf_dg_mastervol', String(masterVol)) } catch { /* ignore */ } }, [masterOn, masterVol])
  const toggleSe = () => setSeOn((v) => { const n = !v; try { localStorage.setItem('bf_dg_se', n ? 'on' : 'off') } catch { /* ignore */ } return n })
  const [showSettings, setShowSettings] = useState(false) // 設定パネル（歯車）
  const [log, setLog] = useState([])
  const [logHidden, setLogHidden] = useState(false) // 2秒間ログ更新が無ければフェードアウト
  useEffect(() => {
    if (log.length === 0) return
    setLogHidden(false)
    const t = setTimeout(() => setLogHidden(true), 2000)
    return () => clearTimeout(t)
  }, [log])
  const [status, setStatus] = useState('select') // select | exploring | cleared | dead | escaped
  const [reward, setReward] = useState(null)
  const [selectedSkill, setSelectedSkill] = useState('tackle') // ダンジョン内で選択中のスキル
  const [inventory, setInventory] = useState({}) // 消耗品の持ち物 { item_key: qty }
  const [lootBag, setLootBag] = useState([])     // 持ち帰り待ちのルート品（装備/強化石/宝石）。生還で付与
  const [dropMode, setDropMode] = useState(false) // 「捨てる」モード（持ち物を選ぶと足元に置く）
  const [dungeon, setDungeon] = useState(null) // 選択中のダンジョン定義
  const [isAdmin, setIsAdmin] = useState(false) // 開発アカウント（comingSoonダンジョンに入れる）
  const [transition, setTransition] = useState(null) // フロア遷移演出 { floor, black, title }
  const [lockedOut, setLockedOut] = useState(false)   // 別端末でプレイ中＝この端末はロック
  const [bgmOn, setBgmOn] = useState(() => localStorage.getItem('bf_dg_bgm') !== 'off') // BGM ON/OFF（全体ONなら既定オン）。追憶の遺跡(d30)でのみ再生
  const [bgmVol, setBgmVol] = useState(() => { const v = parseInt(localStorage.getItem('bf_dg_bgmvol') || '35', 10); return isNaN(v) ? 35 : Math.min(100, Math.max(0, v)) }) // 0〜100
  // 30Fボスはボス専用BGM、それ以外はダンジョンのBGM
  const bgmSrc = isBossFloor(dungeon?.id, floorNum) ? '/30FBoos.mp3' : (dungeon?.bgm || null)
  const bgmDungeon = !!bgmSrc // BGMが設定されているフロアで再生
  // BGMはWeb Audioでギャップレスにループ（HTMLAudioの継ぎ目をなくす）
  const bgmGainRef = useRef(null)
  const bgmSrcRef = useRef(null)
  const bgmCurRef = useRef(null) // 現在鳴らしている曲のパス（フロアで切替検知）
  const bgmBufRef = useRef({})
  const bgmVolRef = useRef(bgmVol)
  useEffect(() => { bgmVolRef.current = bgmVol; try { localStorage.setItem('bf_dg_bgmvol', String(bgmVol)) } catch { /* ignore */ } }, [bgmVol])
  const applyBgmGain = () => { const g = bgmGainRef.current; if (g) g.gain.value = (bgmVolRef.current / 100) * masterRef.current }
  const stopBgm = () => { const s = bgmSrcRef.current; if (s) { try { s.stop() } catch { /* ignore */ } try { s.disconnect() } catch { /* ignore */ } bgmSrcRef.current = null } bgmCurRef.current = null }
  const startBgm = async (srcPath) => {
    const ctx = audioCtxRef.current
    if (!ctx || !srcPath) return
    if (bgmSrcRef.current && bgmCurRef.current === srcPath) return // 同じ曲が再生中
    if (ctx.state === 'suspended') { try { await ctx.resume() } catch { /* ignore */ } }
    if (!bgmGainRef.current) { const g = ctx.createGain(); g.connect(ctx.destination); bgmGainRef.current = g }
    applyBgmGain()
    let buf = bgmBufRef.current[srcPath]
    if (!buf) {
      try { const res = await fetch(encodeURI(srcPath) + `?v=${ASSET_VER}`); buf = await ctx.decodeAudioData(await res.arrayBuffer()); bgmBufRef.current[srcPath] = buf }
      catch { return }
    }
    stopBgm() // 別の曲が鳴っていれば止めて差し替え
    const src = ctx.createBufferSource()
    src.buffer = buf; src.loop = true // バッファ全体をギャップレスにループ
    src.connect(bgmGainRef.current); src.start(0)
    bgmSrcRef.current = src; bgmCurRef.current = srcPath
  }
  // 音量（BGM音量×全体音量）を即時反映
  useEffect(() => { applyBgmGain() }, [bgmVol, masterOn, masterVol])
  // 探索中＆ON＆全体ON で再生／それ以外は停止。フロアで曲が変わったら差し替え
  useEffect(() => {
    if (bgmOn && bgmSrc && masterOn && status === 'exploring') startBgm(bgmSrc)
    else stopBgm()
  }, [bgmOn, bgmSrc, masterOn, status, dungeon])
  useEffect(() => () => stopBgm(), [])
  const ensureBgm = () => { if (bgmOn && bgmSrc && masterOn && (!bgmSrcRef.current || bgmCurRef.current !== bgmSrc)) startBgm(bgmSrc) }
  const toggleBgm = () => setBgmOn((v) => { const n = !v; try { localStorage.setItem('bf_dg_bgm', n ? 'on' : 'off') } catch { /* ignore */ } return n })
  // 効果音（SE）：事前にデコードして「触れた瞬間」に遅延なく鳴らす（Web Audio）
  const seOnRef = useRef(seOn)
  useEffect(() => { seOnRef.current = seOn }, [seOn])
  const audioCtxRef = useRef(null)
  const seBufRef = useRef({})
  useEffect(() => {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    audioCtxRef.current = ctx
    ;['aitemu', 'kaidan', 'kougeki', '被ダメ', 'バフ', 'bosukeitaihenkazi'].forEach(async (name) => {
      try {
        const res = await fetch(encodeURI(`/${name}.mp3`) + `?v=${ASSET_VER}`)
        const arr = await res.arrayBuffer()
        seBufRef.current[name] = await ctx.decodeAudioData(arr)
      } catch { /* デコード失敗時は new Audio にフォールバック */ }
    })
    return () => { try { ctx.close() } catch { /* ignore */ } }
  }, [])
  const playSe = (name) => {
    if (!seOnRef.current) return
    const m = masterRef.current
    if (m <= 0) return // 全体ミュート中は鳴らさない
    const rate = name === 'kaidan' ? 1.2 : 1 // 階段は1.2倍速で再生
    const baseVol = name === 'aitemu' ? 2.0 : (name === 'kougeki' || name === '被ダメ') ? 0.6 : 0.35 // アイテム大きめ・攻撃/被ダメ中・階段控えめ
    const vol = baseVol * seVolRef.current * m // SE音量×全体音量
    if (vol <= 0) return
    const ctx = audioCtxRef.current, buf = seBufRef.current[name]
    if (!ctx || !buf) { // まだデコード前なら従来方式で鳴らす
      try { const a = new Audio(encodeURI(`/${name}.mp3`) + `?v=${ASSET_VER}`); a.volume = Math.min(1, vol); a.playbackRate = rate; a.play().catch(() => {}) } catch { /* ignore */ }
      return
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate
    const g = ctx.createGain(); g.gain.value = vol
    src.connect(g); g.connect(ctx.destination); src.start(0)
  }
  const gridRef = useRef(null)
  const [cellPx, setCellPx] = useState(0) // 1マスのピクセル幅（床をワールド固定で敷くため）

  // グリッドの実寸からマスのpxを測る（レスポンシブ対応）
  useEffect(() => {
    const measure = () => {
      const el = gridRef.current
      if (!el) return
      setCellPx((el.clientWidth - 12) / VW) // padding 6*2 を除く
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && gridRef.current) ro.observe(gridRef.current)
    window.addEventListener('resize', measure)
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [state])

  // タイル画像（床/壁/階段/アイテム）を選択ダンジョンが決まった時点でプリロード。
  // 初めて見えたマスで画像読込待ちにならず即時表示される。
  useEffect(() => {
    if (!dungeon?.id) return
    for (const key of ['floor', 'stairs', 'item']) {
      const src = dgTileSrc(dungeon.id, key)
      if (src) { const im = new Image(); im.src = src }
    }
    for (const src of dgWallTiles(dungeon.id)) { const im = new Image(); im.src = src }
  }, [dungeon?.id])
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
  // 頭上に浮かぶダメージ/回復の数字（敵味方共通。ダメージ=赤 -n / 回復=緑 +n）
  const [pops, setPops] = useState([])
  const popSeq = useRef(0)
  const addPop = (x, y, text, color, opts = {}) => {
    popSeq.current += 1
    const id = popSeq.current
    // 同時に複数出ても重なりにくいよう少し横にずらす
    setPops((ps) => [...ps, { id, x, y, text, color, dx: Math.round(Math.random() * 14 - 7), below: !!opts.below, follow: !!opts.follow }])
    const tid = setTimeout(() => setPops((ps) => ps.filter((p) => p.id !== id)), opts.below ? 1100 : 1500)
    turnTimers.current.push(tid)
  }
  // opts.follow=true でキャラの移動に追従（自分が受けたダメージ・回復に使う）
  const popDmg = (x, y, n, opts = {}) => addPop(x, y, `-${n}`, '#ff5555', opts)
  const popHeal = (x, y, n, opts = {}) => addPop(x, y, `+${n}`, '#66ff99', opts)
  const popExp = (x, y, n) => addPop(x, y, `＋Exp ${n}`, '#8fd0ff', { below: true, follow: true }) // 経験値は明るい青で自分の下に（キャラ追従）

  // レベルアップ演出（キャラの上に虹色アーチで LEVEL UP・約4秒）
  const [levelUp, setLevelUp] = useState(null) // { x, y, id }
  const [cheer, setCheer] = useState(0)        // レベルアップ時にキャラが喜んで2回小ジャンプ
  const levelUpSeq = useRef(0)
  const triggerLevelUp = (x, y) => {
    levelUpSeq.current += 1
    const id = levelUpSeq.current
    setLevelUp({ x, y, id })
    setCheer(id) // ジャンプ演出（keyを変えてアニメ再生）
    const tid = setTimeout(() => setLevelUp((lu) => (lu && lu.id === id ? null : lu)), 3000)
    const tid2 = setTimeout(() => setCheer((c) => (c === id ? 0 : c)), 1000)
    turnTimers.current.push(tid, tid2)
  }
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
  const fullHealRef = useRef(null) // レベルアップでHP全回復させる予約（commitTurnで確実に反映）
  const userIdRef = useRef(null)
  const saveKey = () => (userIdRef.current ? `bf_dungeon2_${userIdRef.current}` : null)
  const enemiesRef = useRef(0)
  const floorsRef = useRef(0)
  const itemsRef = useRef(0)
  const saveTimer = useRef(null) // サーバー保存のデバウンス用

  // ラン開始（選択中ペットがある場合のみ報酬対象）
  const startRun = useCallback(async (petId, dungeonId = 'd10') => {
    finishedRef.current = false
    enemiesRef.current = 0; floorsRef.current = 0; itemsRef.current = 0
    runIdRef.current = null
    setReward(null)
    if (!petId) return
    const { data, error } = await supabase.rpc('dungeon_start', { p_pet_id: petId, p_dungeon_id: dungeonId })
    if (!error) {
      runIdRef.current = data
      setLockedOut(false)
      // この端末を操作端末として主張（別端末はロックされる）
      if (data) supabase.rpc('dungeon_claim_device', { p_run_id: data, p_device: getDeviceId() }).then(() => {}, () => {})
    }
  }, [])

  // 敵撃破：EXPを即時付与（サーバー）。レベルアップでステータスも即反映
  const grantKill = useCallback(async (floor, name = '敵', px = null, py = null) => {
    if (!runIdRef.current) return
    // EXPは敵ごと（倍率はサーバー側の表で検証）。幸せのチャーム装備時はサーバーが50%で+50%
    const lucky = charmHasEffect(pet.charm, 'lucky')
    const { data, error } = await supabase.rpc('dungeon_kill', { p_run_id: runIdRef.current, p_floor: floor, p_enemy: name, p_lucky: lucky })
    if (error || !data) { addLog(`⚔ ${name}を撃破！`); return }
    addLog(`⚔ ${name}を撃破！ ＋EXP${data.exp_gain}${data.lucky ? '🍀' : ''}${data.leveled ? `（Lv${data.level}に！）` : ''}`)
    // 経験値ポップ（自分の下に青で）＋レベルアップ時は虹アーチ演出
    if (px != null && py != null) {
      if (data.exp_gain > 0) popExp(px, py, data.exp_gain)
      if (data.leveled) triggerLevelUp(px, py)
    }
    let newMax = null
    setPet((p) => {
      if (!p?.species) return p
      const st = applyCharmStats(petStats({ species: p.species, level: data.level, evolved: p.evolved }), p.charm)
      newMax = st.maxHp
      return { ...p, level: data.level, exp: data.exp, ...st }
    })
    // レベルアップしたらHP全回復（commitTurnのHP確定で上書きされないようrefに予約）
    if (data.leveled && newMax != null) {
      fullHealRef.current = newMax
      setPetHp(newMax)
      if (px != null && py != null) popHeal(px, py, newMax, { follow: true })
      addLog('💚 レベルアップ！HPが全回復した')
    }
  }, [])

  // ✨のルート品はサーバー(dungeon_pickup)が抽選・保持し、生還時(dungeon_finish)に付与する。
  // クライアントは表示するだけ。サーバー戻り値の素のentryに表示用の label/emoji を付ける。
  const lootDisplay = (e) => {
    if (!e) return { label: '?', emoji: '✨' }
    if (e.type === 'seed') { const d = PET_ITEMS[e.seedKey]; return { label: d?.name || e.seedKey, emoji: d?.emoji || '🔹', img: petItemImg(e.seedKey) } }
    if (e.type === 'stone') return { label: `強化石(${e.rank})`, emoji: '🪨' }
    if (e.type === 'gem') return { label: `${GEM_DATA[e.gemType]?.name || '宝石'}(F)`, emoji: '💍' }
    if (e.type === 'equip') return { label: e.name, emoji: '🎁' }
    if (e.type === 'charm') return { label: getCharm(e.ctype).name, emoji: getCharm(e.ctype).emoji }
    if (e.type === 'shard') return { label: '神秘の欠片', emoji: '🔮' }
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
    const pool = enemiesForFloor(dungeon, floorNum)
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
      const es = dungeonEnemyStatsFor(dungeon, kind)
      spawnSeq.current += 1
      return {
        id: 'es' + spawnSeq.current, x, y, name: kind.name, type: kind.type, image: pickEnemyImage(kind), skills: kind.skills || enemySkillsFor(kind.name), canSwim: isAquatic(kind.name), reach: kind.reach || 1,
        hp: es.maxHp, maxHp: es.maxHp, atk: es.atk, def: es.def, mdef: es.mdef,
      }
    }
    return null
  }

  // ラン精算（サーバーが報酬を計算して付与）
  const finishRun = useCallback(async (cleared, died = false) => {
    if (saveKey()) localStorage.removeItem(saveKey()) // 中断データを破棄
    if (finishedRef.current || !runIdRef.current) return
    finishedRef.current = true
    // ルート品の付与はサーバー(dungeon_finish)が実行。生還＝全部／死亡＝ランダムで半分失い残りは持ち帰り
    const lootList = lootBag.map((l) => `${l.emoji || ''}${l.label}${(l.qty || 1) > 1 ? `×${l.qty}` : ''}`)
    setLootBag([])
    const { data, error } = await supabase.rpc('dungeon_finish', {
      p_run_id: runIdRef.current, p_floors: floorsRef.current,
      p_enemies: enemiesRef.current, p_items: itemsRef.current, p_cleared: cleared, p_died: died,
    })
    if (!error && data) {
      // 死亡時はサーバーが残した分(kept_loot)を表示。旧SQL(kept_lootなし)では従来どおり全ロスト表示
      const kept = Array.isArray(data.kept_loot)
        ? data.kept_loot.map((e) => { const d = lootDisplay(e); return `${d.emoji}${d.label}${(e.qty || 1) > 1 ? `×${e.qty}` : ''}` })
        : null
      setReward({
        ...data,
        lootGranted: data.loot_granted || 0,
        lootList: died ? (kept || []) : lootList,
        lostHalf: died && (data.loot_granted || 0) >= 0 && kept !== null,
      })
    }
  }, [lootBag])

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      userIdRef.current = user.id
      const { data: prof } = await supabase.from('profiles').select('id, is_admin').eq('id', user.id).maybeSingle()
      if (!prof) { setAllowed(false); return }
      setIsAdmin(!!prof.is_admin)
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

      // 中断していた探索を復元。サーバー優先＝どの端末からでも最新状態を続行できる。
      let restored = false
      if (ap) {
        let sv = null
        // ① サーバーのアクティブ探索（最新）の保存状態を優先
        const { data: activeRun } = await supabase.from('dungeon_runs')
          .select('id, dungeon_id, client_state')
          .eq('owner_id', user.id).eq('status', 'active')
          .order('started_at', { ascending: false }).limit(1).maybeSingle()
        if (activeRun?.client_state?.state) {
          sv = activeRun.client_state
          runIdRef.current = activeRun.id
        } else {
          // ② サーバーに状態が無ければ localStorage（その端末のリロード継続）。runがactiveな時のみ採用
          try {
            const raw = localStorage.getItem(`bf_dungeon2_${user.id}`)
            if (raw) {
              const j = JSON.parse(raw)
              if (j?.runId && j?.state) {
                const { data: rr } = await supabase.from('dungeon_runs').select('status').eq('id', j.runId).maybeSingle()
                if (rr?.status === 'active') { sv = j; runIdRef.current = j.runId }
              }
            }
          } catch { /* 壊れていたら無視 */ }
        }
        if (sv?.state) {
          // この端末を操作端末として主張（別端末で開いていたらそちらがロックされる）
          if (runIdRef.current) { setLockedOut(false); supabase.rpc('dungeon_claim_device', { p_run_id: runIdRef.current, p_device: getDeviceId() }).then(() => {}, () => {}) }
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
          playFloorIntro(sv.floorNum, getDungeon(sv.dungeonId)) // 再開時もダンジョン名・フロア表示
          restored = true
        }
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
    setParalyzed(0)    // 麻痺も次フロアで回復
    setBurned(false)   // やけども次フロアで回復
    setDebuff({ atk: 0, def: 0, mdef: 0 }) // ステータスダウンも次フロアで回復
    setShield(0); shieldRateRef.current = 1   // バフも次フロアで切れる
    setRegen(0); regenAmtRef.current = 0
    setPetAtkUp(0)
  }, [])

  // ダンジョンを選んで開始
  const beginDungeon = (d) => {
    setDungeon(d)
    setFloorNum(1); setPetHp(pet.maxHp); setTurns(0); setFullness(MAX_FULLNESS); setPoisoned(false); setParalyzed(0); setBurned(false); setDebuff({ atk: 0, def: 0, mdef: 0 }); setShield(0); shieldRateRef.current = 1; setRegen(0); regenAmtRef.current = 0; setPetAtkUp(0); setLootBag([]); setDropMode(false); setLog([]); setReward(null); setStatus('exploring')
    enterFloor(1, d)
    playFloorIntro(1, d) // 入場時にダンジョン名・フロア表示
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
      // サーバーにも保存（複数端末同期）。デバウンスして書き込みすぎを防ぐ
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const runId = runIdRef.current
      saveTimer.current = setTimeout(() => {
        supabase.rpc('dungeon_save_state', { p_run_id: runId, p_state: sv, p_device: getDeviceId() })
          .then(({ data }) => { if (data && data.ok === false && data.locked) setLockedOut(true) }, () => {})
      }, 700)
    } else if (status === 'cleared' || status === 'dead' || status === 'escaped') {
      localStorage.removeItem(key)
    }
  }, [status, state, petHp, fullness, turns, selectedSkill, inventory, lootBag, floorNum, dungeon, pet.id])

  // side: 'left'=自分/全般 / 'right'=敵の行動
  const addLog = (msg, side = 'left', icon = null) => setLog((l) => [{ msg, side, icon }, ...l].slice(0, 30))

  // 持ち物の合計数（だっしゅつの翼も含む＝消耗品＋戦利品）。上限を超えたら拾えない
  const bagCount = () => Object.values(inventory).reduce((s, q) => s + (q || 0), 0) + lootBag.length
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

  // フロア遷移演出：階段フェードアウト→暗転→「ダンジョン名 フロア数」を1秒表示→フェードインでフロア表示
  const descendFloor = (next) => {
    busyRef.current = true
    const hold = isBossFloor(dungeon?.id, next) ? 5000 : 1000 // ボスフロアは長めに見せる
    setTransition({ floor: next, black: 0, title: 0, name: dungeon?.name, emoji: dungeon?.emoji, boss: isBossFloor(dungeon?.id, next) })
    setTimeout(() => setTransition((t) => t && { ...t, black: 1 }), 30)                 // 暗転フェードイン
    setTimeout(() => { setFloorNum(next); enterFloor(next, dungeon); setTransition((t) => t && { ...t, title: 1 }) }, 470) // 完全暗転でフロア差替＋タイトル表示
    setTimeout(() => setTransition((t) => t && { ...t, title: 0 }), 470 + hold)          // タイトルフェードアウト
    setTimeout(() => setTransition((t) => t && { ...t, black: 0 }), 470 + hold + 450)    // 暗転フェードアウト＝フロア出現
    setTimeout(() => { setTransition(null); busyRef.current = false }, 470 + hold + 450 + 470)
  }

  // ダンジョン入場/再開時にも同じ「ダンジョン名 フロア数」演出を出す（フロアは差し替えず現在のまま）。
  // リロードで床が一瞬見えないよう、最初から真っ暗(black:1)＋タイトル表示で始める。
  const playFloorIntro = (floor, dg) => {
    const meta = dg || dungeon
    busyRef.current = true
    setTransition({ floor, black: 1, title: 1, name: meta?.name, emoji: meta?.emoji })
    setTimeout(() => setTransition((t) => t && { ...t, title: 0 }), 1000)               // タイトルフェードアウト
    setTimeout(() => setTransition((t) => t && { ...t, black: 0 }), 1000 + 450)          // 暗転フェードアウト＝フロア出現
    setTimeout(() => { setTransition(null); busyRef.current = false }, 1000 + 450 + 470)
  }

  const tryMove = (dx, dy) => {
    ensureBgm() // 操作時にBGM再生を確実に開始（自動再生ブロック対策）
    if (!state || status !== 'exploring' || busyRef.current || transition || lockedOut) return
    let s = state
    const px = s.player.x, py = s.player.y
    const nx = px + dx, ny = py + dy
    if (!inBounds(nx, ny) || s.grid[ny][nx] === '#') return
    // 斜め移動は壁の角を抜けられない（両脇のどちらかが壁なら不可）
    if (dx !== 0 && dy !== 0 && (s.grid[py][nx] === '#' || s.grid[ny][px] === '#')) return

    let curPetHp = petHp
    let enemies = s.enemies
    let player = s.player
    let fullCost = 0

    // 敵への体当たり＝選択中スキルが発動（コスト分の満腹度を消費）
    const target = enemyAt(enemies, nx, ny) // 多セル(ボス)対応
    if (target) {
      const sk = getSkill(selectedSkill)
      const cost = sk.cost || 0
      if (cost > fullness) { addLog(`🍖 満腹度が足りない（${sk.name}は${cost}必要）たいあたりに切替を`); return }
      // 麻痺：30%で体がしびれて攻撃失敗（満腹は消費せず1ターン経過）
      if (paralyzed > 0 && Math.random() < PARALYZE_FAIL) {
        addLog('⚡ 体がしびれて攻撃できない！')
        applyFx({ pet: { flash: true } })
        setState({ ...s })
        busyRef.current = true
        const tid = setTimeout(() => commitTurn(s, s.player, s.enemies, curPetHp, 0), BREATH_MS)
        turnTimers.current.push(tid)
        return
      }
      fullCost = cost
      playSe('kougeki') // 攻撃SE
      const hits = sk.hits || 1
      // たいあたりは攻撃(物理)と特攻(特殊)の高いほうを参照（チャーム成長を両方活かせる）。
      // スキルは従来どおり攻撃タイプ準拠。同値なら攻撃タイプ側
      let useAtk = pet.atk, useType = pet.atkType
      if (selectedSkill === 'tackle') {
        const p = pet.atkPhys ?? pet.atk, sp2 = pet.atkSpec ?? pet.atk
        if (sp2 > p) { useAtk = sp2; useType = 'spec' }
        else if (p > sp2) { useAtk = p; useType = 'phys' }
      }
      // やけど・ステータスダウン中は攻撃/特攻が下がる。攻撃バフ中は上がる
      const atkMul = (burned ? 1 - BURN_ATK_DOWN : 1) * (debuff.atk > 0 ? 1 - STAT_DOWN_PCT : 1) * (petAtkUp > 0 ? PET_ATKUP_MULT : 1)
      useAtk = useAtk * atkMul
      // 敵の防御。デバフ（防御down）を受けている敵は軽減が弱まる
      const baseGuard = useType === 'spec' ? (target.mdef || 0) : (target.def || 0)
      const guard = (target.defDown > 0) ? baseGuard * (1 - STAT_DOWN_PCT) : baseGuard
      // ダメージは1発ごとに 0.9〜1.1 の乱数補正（最低1）
      const vary = (n) => Math.max(1, Math.round(n * (0.9 + Math.random() * 0.2)))
      const hitDmgs = Array.from({ length: hits }, () => vary(calcDamage(Math.round(useAtk * (sk.mult || 1)), guard)))
      const total = hitDmgs.reduce((a, b) => a + b, 0)
      const newHp = target.hp - total
      const skillTag = selectedSkill === 'tackle' ? '' : `【${sk.name}】`
      const HIT_MS = 170 // 連打は1発ずつ表示する間隔
      // 連打スキルはまとめず1発ずつポップ＆ログを出す
      hitDmgs.forEach((d, i) => {
        const show = () => { popDmg(target.x, target.y, d); addLog(`⚔${skillTag} ${target.name}に${d}ダメージ！`) }
        if (i === 0) show()
        else { const t2 = setTimeout(show, i * HIT_MS); turnTimers.current.push(t2) }
      })
      if (sk.lifesteal) { const heal = Math.floor(total * sk.lifesteal); const healed = Math.min(pet.maxHp, curPetHp + heal) - curPetHp; curPetHp += healed; if (healed > 0) { addLog(`💚 ${healed}回復`); popHeal(px, py, healed, { follow: true }) } }
      // 自分バフ技（攻撃up / 結界）
      if (sk.selfBuff) {
        playSe('バフ') // バフSE（全キャラ共通）
        if (sk.selfBuff.kind === 'atkup') { setPetAtkUp(sk.selfBuff.turns); addLog(`🔺 ${sk.name}！攻撃が上がった`) }
        else if (sk.selfBuff.kind === 'shield') { setShield(sk.selfBuff.turns); shieldRateRef.current = sk.selfBuff.rate || 0.7; addLog(`🛡 ${sk.name}！被ダメを軽減`) }
      }
      const killed = newHp <= 0
      // ボスは2段階：第1形態を倒すと第2形態へ（HP全回復・防御down/攻撃up・物理特殊ミックス）
      if (killed && target.boss && target.phase === 0) {
        const p2 = DEVIL_PAPIA.phases[1]
        // 第2形態のステ/HPにするが、画像は第1のまま2秒点滅 → その後第2形態画像へ差し替え
        enemies = enemies.map((e) => e.id === target.id ? {
          ...e, phase: 1, type: p2.type, mix: !!p2.mix, image: assetSrc(DEVIL_PAPIA.phases[0].image), skills: p2.skills,
          hp: p2.hp, maxHp: p2.hp, atk: p2.atk, def: p2.def, mdef: p2.mdef, buff: 0, atkDown: 0, defDown: 0, healedOnce: false, blink: true,
        } : e)
        addLog('💀 デビルパピアが力を取り戻していく…！', 'right')
        playSe('bosukeitaihenkazi') // 形態変化SE
        triggerShake('kill')
        applyFx({ pet: { lunge: { dx, dy } }, enemies: {} })
        setState({ ...s, player, enemies })
        busyRef.current = true
        const tid = setTimeout(() => {
          setState((prev) => prev ? { ...prev, enemies: prev.enemies.map((e) => e.id === target.id ? { ...e, image: assetSrc(p2.image), blink: false } : e) } : prev)
          addLog('💀 デビルパピア 第2形態！', 'right')
          busyRef.current = false
        }, 2000)
        turnTimers.current.push(tid)
        return
      }
      if (killed && target.boss && target.phase === 1) {
        // ボス討伐＝ダンジョンクリア。神秘の欠片を確定ドロップ
        setStatus('cleared'); addLog('🏁 デビルパピアを討伐！ダンジョンクリア！'); enemiesRef.current += 1
        grantKill(floorNum, target.name, px, py)
        setState({ ...s, player, enemies: enemies.filter((e) => e.id !== target.id) })
        if (dungeon) setCleared((c) => new Set(c).add(dungeon.id))
        addLog('🔮 神秘の欠片を手に入れた！')
        const shardEntry = { type: 'shard' }
        if (runIdRef.current) {
          supabase.rpc('dungeon_pickup', { p_run_id: runIdRef.current, p_entry: shardEntry }).then(({ data }) => { addLootToBag(data || shardEntry); finishRun(true) }, () => finishRun(true))
        } else finishRun(true)
        return
      }
      if (killed) { enemies = enemies.filter((e) => e.id !== target.id); enemiesRef.current += 1; grantKill(floorNum, target.name, px, py); triggerShake('kill') }
      else {
        // 敵デバフ技（攻撃/防御ダウンを対象に付与）
        enemies = enemies.map((e) => {
          if (e.id !== target.id) return e
          let ne = { ...e, hp: newHp }
          if (sk.enemyDebuff) {
            if (sk.enemyDebuff.stat === 'atk') ne.atkDown = sk.enemyDebuff.turns
            else if (sk.enemyDebuff.stat === 'def') ne.defDown = sk.enemyDebuff.turns
          }
          return ne
        })
        if (sk.enemyDebuff) addLog(`🔻 ${sk.name}！${target.name}の${sk.enemyDebuff.stat === 'atk' ? '攻撃' : '防御'}が下がった`)
        triggerShake('hit')
      }

      // 体当たり演出：ペットを相手方向へ突進、被弾した敵を点滅させる
      applyFx({ pet: { lunge: { dx, dy } }, enemies: killed ? {} : { [target.id]: { flash: true } } })
      // 敵HPを即時反映してから、一呼吸おいて敵のターン（反撃）へ（連打分の表示が終わってから）
      setState({ ...s, player, enemies })
      busyRef.current = true
      const tid = setTimeout(() => commitTurn(s, player, enemies, curPetHp, fullCost), BREATH_MS + (hits - 1) * HIT_MS)
      turnTimers.current.push(tid)
      return
    } else {
      // アイテム取得
      const itemHere = s.items.find((it) => it.x === nx && it.y === ny)
      let items = s.items
      const isEscapePickup = itemHere && itemHere.kind === 'dropFood' && itemHere.key === 'escape'
      if (itemHere && !isEscapePickup && bagCount() >= bagCapacity(cleared.size)) {
        // 持ち物が満杯：拾わずに床へ残す（足元のアイテムが何か分かるよう名前を表示）
        const onName = itemHere.kind === 'dropLoot' ? itemHere.loot?.label
          : (itemHere.kind === 'food' || itemHere.kind === 'dropFood') ? (PET_ITEMS[itemHere.key]?.name || 'アイテム')
          : '✨ なにか'
        addLog(`🎒 足元に「${onName}」があるが持ち物がいっぱい`)
      } else if (itemHere) {
        items = items.filter((it) => it.id !== itemHere.id); itemsRef.current += 1
        { const t = setTimeout(() => playSe('aitemu'), 90); turnTimers.current.push(t) } // アイテム取得SE（ほんの少し遅らせる）
        if (itemHere.kind === 'food') {
          // 床の消耗品をアイテム袋へ（名前は分かっているので即ログ・通信は裏で）
          const fdef = PET_ITEMS[itemHere.key]
          addLog(`${fdef?.emoji || '🎁'} ${fdef?.name || 'アイテム'}を拾って袋に入れた`)
          grantFood(itemHere.key).then((ok) => { if (!ok) addLog('🎒 袋がいっぱいで拾えなかった') })
        } else if (itemHere.kind === 'dropLoot' && itemHere.loot) {
          // 自分が捨てたルート品を拾い直す（名前は既知なので即ログ・サーバー復帰は裏で）
          const d0 = lootDisplay(itemHere.loot); addLog(d0.img ? `${d0.label}を拾った` : `${d0.emoji} ${d0.label}を拾った`, 'left', d0.img)
          supabase.rpc('dungeon_repick_loot', { p_run_id: runIdRef.current, p_loot_id: itemHere.loot.id }).then(({ data, error }) => {
            if (error) { addLog('拾えなかった'); return }
            addLootToBag(data || itemHere.loot)
          })
        } else if (itemHere.kind === 'dropFood' && itemHere.key) {
          const fdef = PET_ITEMS[itemHere.key]
          addLog(`${fdef?.emoji || '🎁'} ${fdef?.name || 'アイテム'}を拾った`)
          grantFood(itemHere.key).then((ok) => { if (!ok) addLog('🎒 袋がいっぱいで拾えなかった') })
        } else if (itemHere.loot) {
          // 床の戦利品（素/石/宝石/チャーム）。中身は既知なので即ログ＋サーバーで検証・保持
          const d = lootDisplay(itemHere.loot)
          addLog(d.img ? `${d.label}を拾った！` : `${d.emoji} ${d.label}を拾った！`, 'left', d.img)
          supabase.rpc('dungeon_pickup', { p_run_id: runIdRef.current, p_entry: itemHere.loot }).then(({ data, error }) => {
            if (error || !data) { addLog('🎒 持ち帰れなかった'); return }
            addLootToBag(data) // サーバーが採番したentry（id付き）で袋に反映
          })
        }
      }
      player = { x: nx, y: ny }
      s = { ...s, items }

      // 階段
      if (player.x === s.stairs.x && player.y === s.stairs.y) {
        floorsRef.current += 1
        playSe('kaidan') // 階段SE
        if (floorNum >= (dungeon?.floors || 10)) { setStatus('cleared'); addLog('🏁 最深部を踏破！ダンジョンクリア！'); setState({ ...s, player }); if (dungeon) setCleared((c) => new Set(c).add(dungeon.id)); finishRun(true); return }
        addLog(`⬇ B${floorNum + 1}Fへ降りた`)
        setState({ ...s, player }) // 階段に乗った姿を見せてからフェード
        descendFloor(floorNum + 1)
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
    // 水エリア：泳げる敵は水(壁)も通れる。プレイヤー・地上の敵は通れない
    const waterFloor = isWaterFloor(dungeon?.id, floorNum)
    const canPass = (e, x, y) => inBounds(x, y) && (s.grid[y][x] === '.' || (waterFloor && e.canSwim && s.grid[y][x] === '#'))
    // プレイヤーが今見えているマス（見えていない敵には攻撃させない）
    const visNow = computeVisible(s.rooms, player.x, player.y)
    // プレイヤーからの最短距離マップ（BFS）。視界に入った敵はこれに沿って詰めてくる
    const dist = new Map()
    {
      const q = [[player.x, player.y]]
      dist.set(player.x + ',' + player.y, 0)
      while (q.length) {
        const [cx, cy] = q.shift()
        const cd = dist.get(cx + ',' + cy)
        if (cd >= 24) continue // 探索範囲は十分広く・無限拡散は防ぐ
        for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx2 = cx + ddx, ny2 = cy + ddy, k = nx2 + ',' + ny2
          if (isFloor(nx2, ny2) && !dist.has(k)) { dist.set(k, cd + 1); q.push([nx2, ny2]) }
        }
      }
    }
    let willPoison = false // このターンに毒を受けたか
    let willParalyze = false // このターンに麻痺を受けたか
    let willBurn = false   // このターンにやけどを受けたか
    const willDebuff = { atk: 0, def: 0, mdef: 0 } // このターンに受けたデバフの残ターン
    const attackers = []   // 隣接して攻撃してくる敵（1体ずつ順番に演出する）
    enemies = enemies.map((e) => {
      // スキルの書「しびれ」効果中の敵は行動できない（1ターン消費）。自己バフは減衰
      if (e.stun > 0) return { ...e, stun: e.stun - 1, buff: Math.max(0, (e.buff || 0) - 1), atkDown: Math.max(0, (e.atkDown || 0) - 1), defDown: Math.max(0, (e.defDown || 0) - 1) }
      // プレイヤーが見えている敵だけが追跡・攻撃する（霧の中からの不可視の急襲を防ぐ）
      //  ＝ 同じ部屋/接近(enemySeesPet) または プレイヤーの視界内(visNow) の敵のみ
      const sees = enemySeesPet(s.rooms, e, player.x, player.y) || visNow.has(e.x + ',' + e.y)
      // 攻撃可能判定：reach マス以内＆直線(縦横/斜め)＆間に壁が無い。reach=1は従来の隣接攻撃
      const adx = e.x - player.x, ady = e.y - player.y
      const cheb = Math.max(Math.abs(adx), Math.abs(ady))
      const reach = e.reach || 1
      const straight = adx === 0 || ady === 0 || Math.abs(adx) === Math.abs(ady)
      const sx = Math.sign(player.x - e.x), sy = Math.sign(player.y - e.y)
      let lineClear = true
      for (let k = 1; k < cheb; k++) { if (s.grid[e.y + sy * k]?.[e.x + sx * k] === '#') { lineClear = false; break } } // 間に壁
      // 隣接(1マス)は斜め角の抜け不可も判定
      const diagBlocked = cheb === 1 && adx !== 0 && ady !== 0 && (s.grid[player.y]?.[e.x] === '#' || s.grid[e.y]?.[player.x] === '#')
      // ボスは4マスのいずれかに隣接で攻撃可能。通常敵はreach判定
      const canAttack = e.boss ? enemyAdjacent(e, player.x, player.y) : (sees && inRange && visNow.has(e.x + ',' + e.y))
      // 回避のチャーム：5%で敵の攻撃を完全回避
      if (canAttack && charmHasEffect(pet.charm, 'evade') && Math.random() < 0.05) {
        addLog(`💨 ${e.name}の攻撃を回避した！`, 'right')
        return { ...e, atkDown: Math.max(0, (e.atkDown || 0) - 1), defDown: Math.max(0, (e.defDown || 0) - 1) }
      }
      // ボス第2形態は物理/特殊ミックス（攻撃ごとにランダム）
      const atkType = (e.boss && e.mix) ? (Math.random() < 0.5 ? 'spec' : 'phys') : e.type
      if (canAttack) {
        // 敵の攻撃タイプに応じて pet.def(物理)/mdef(特殊)で軽減。防御/特防ダウン中は軽減を弱める
        const baseGuard = atkType === 'spec' ? (pet.mdef || 0) : (pet.def || 0)
        const guardDown = atkType === 'spec' ? (debuff.mdef > 0) : (debuff.def > 0)
        const guard = guardDown ? baseGuard * (1 - STAT_DOWN_PCT) : baseGuard
        // 敵の攻撃力（自己バフ中は ENEMY_BUFF_MULT 倍／攻撃ダウン中は減）
        const eAtk = (e.atk || 1) * ((e.buff || 0) > 0 ? ENEMY_BUFF_MULT : 1) * ((e.atkDown || 0) > 0 ? 1 - STAT_DOWN_PCT : 1)
        // 敵のダメージも 0.9〜1.1 の乱数補正（最低1）
        let dmg = Math.max(1, Math.round(calcDamage(eAtk, guard) * (0.9 + Math.random() * 0.2)))
        // 敵スキル（確率発動）。ボスはHP50%以下で「復讐」を追加
        const bossPh = e.boss ? DEVIL_PAPIA.phases[e.phase] : null
        const lowHp = (e.hp || 0) <= (e.maxHp || 1) * 0.5
        const sks = (lowHp && bossPh?.lowHpSkill) ? [...(e.skills || []), bossPh.lowHpSkill] : (e.skills || [])
        const notes = []
        let heal = 0; let gotBuff = false; let reviveHeal = 0
        // 第2形態：HP50%以下で1度だけ最大HPの reviveHealPct を回復
        if (e.boss && e.phase === 1 && lowHp && !e.healedOnce && bossPh?.reviveHealPct) {
          reviveHeal = Math.ceil((e.maxHp || 1) * bossPh.reviveHealPct)
        }
        const antidote = getCharm(pet.charm?.ctype).effect === 'antidote'
        for (const sk of sks) {
          // 解毒のチャーム装備時は毒の発動確率を50%に
          const chance = sk.type === 'poison' && antidote ? sk.chance * 0.5 : sk.chance
          if (Math.random() >= chance) continue
          if (sk.type === 'heavy') { dmg = Math.round(dmg * (sk.mult || 1)); notes.push(sk.name) }
          // 溶解液：特殊判定（ペットの特防で軽減）の×mult攻撃。物理の敵でも特防に当たる
          else if (sk.type === 'spec_heavy') { dmg = Math.max(1, Math.round(calcDamage(Math.round(eAtk * (sk.mult || 1)), pet.mdef || 0) * (0.9 + Math.random() * 0.2))); notes.push(sk.name) }
          else if (sk.type === 'poison') { willPoison = true; notes.push(sk.name) }
          else if (sk.type === 'paralyze') { willParalyze = true; notes.push(sk.name) }
          else if (sk.type === 'burn') { willBurn = true; notes.push(sk.name) }
          else if (sk.type === 'weaken') { const st = sk.stat || 'atk'; willDebuff[st] = Math.max(willDebuff[st], sk.turns || 4); notes.push(sk.name) }
          else if (sk.type === 'selfbuff') { gotBuff = true; notes.push(sk.name); playSe('バフ') }
          else if (sk.type === 'vamp') { heal = Math.floor(dmg * (sk.frac || 0.5)); notes.push(sk.name) }
        }
        const healShown = heal > 0 ? Math.min(heal, e.maxHp - e.hp) : 0
        attackers.push({ id: e.id, name: e.name, x: e.x, y: e.y, dmg, notes, healShown,
          lunge: { dx: Math.sign(player.x - e.x), dy: Math.sign(player.y - e.y) } })
        let ne = { ...e, atkDown: Math.max(0, (e.atkDown || 0) - 1), defDown: Math.max(0, (e.defDown || 0) - 1) } // デバフ減衰
        if (heal > 0) ne = { ...ne, hp: Math.min(e.maxHp, e.hp + heal) }
        if (reviveHeal > 0) { ne = { ...ne, hp: Math.min(e.maxHp, ne.hp + reviveHeal), healedOnce: true }; addLog(`✨ ${e.name}はHPを回復した！`, 'right') }
        if (gotBuff) ne = { ...ne, buff: ENEMY_BUFF_TURNS }
        else if ((e.buff || 0) > 0) ne = { ...ne, buff: e.buff - 1 } // 攻撃したターンもバフ減衰
        return ne
      }
      // ボスは2×2ブロックでプレイヤーへ接近（4マス全部が床＆プレイヤー非占有なら移動）
      if (e.boss) {
        const blockOk = (nx2, ny2) => {
          for (let ddy = 0; ddy < e.size; ddy++) for (let ddx = 0; ddx < e.size; ddx++) {
            const cx = nx2 + ddx, cy = ny2 + ddy
            if (!inBounds(cx, cy) || s.grid[cy][cx] === '#') return false
            if (cx === player.x && cy === player.y) return false
          }
          return true
        }
        const bcx = e.x + 0.5, bcy = e.y + 0.5 // ブロック中心
        const moves = [{ x: e.x + 1, y: e.y }, { x: e.x - 1, y: e.y }, { x: e.x, y: e.y + 1 }, { x: e.x, y: e.y - 1 }]
          .filter((c) => blockOk(c.x, c.y))
          .filter((c) => Math.abs(c.x + 0.5 - player.x) + Math.abs(c.y + 0.5 - player.y) < Math.abs(bcx - player.x) + Math.abs(bcy - player.y))
          .sort((a, b) => (Math.abs(a.x + 0.5 - player.x) + Math.abs(a.y + 0.5 - player.y)) - (Math.abs(b.x + 0.5 - player.x) + Math.abs(b.y + 0.5 - player.y)))
        if (moves.length) return { ...e, x: moves[0].x, y: moves[0].y, buff: Math.max(0, (e.buff || 0) - 1), atkDown: Math.max(0, (e.atkDown || 0) - 1), defDown: Math.max(0, (e.defDown || 0) - 1) }
        return { ...e, buff: Math.max(0, (e.buff || 0) - 1), atkDown: Math.max(0, (e.atkDown || 0) - 1), defDown: Math.max(0, (e.defDown || 0) - 1) }
      }
      const chase = (c) => {
        const gx = Math.abs(c.x - player.x), gy = Math.abs(c.y - player.y)
        return Math.max(gx, gy) * 1000 + (gx + gy) // チェビシェフ優先→マンハッタン
      }
      const swims = waterFloor && e.canSwim
      let cands
      if (swims && sees) {
        // 泳ぐ敵は水(壁)も通り、迷路を無視してプレイヤーへ直進的に接近
        cands = [{ x: e.x + 1, y: e.y }, { x: e.x - 1, y: e.y }, { x: e.x, y: e.y + 1 }, { x: e.x, y: e.y - 1 }]
          .filter((c) => chase(c) < chase(e)) // 近づく手のみ
          .sort((a, b) => chase(a) - chase(b))
      } else if (sees) {
        // 最短距離マップに沿って詰める（距離が縮まる隣マスを優先。袋小路や別ルートにも対応）
        cands = [{ x: e.x + 1, y: e.y }, { x: e.x - 1, y: e.y }, { x: e.x, y: e.y + 1 }, { x: e.x, y: e.y - 1 }]
          .filter((c) => dist.has(c.x + ',' + c.y))
        const cur = dist.get(e.x + ',' + e.y)
        if (cur != null) cands = cands.filter((c) => dist.get(c.x + ',' + c.y) < cur) // 遠ざかる動きはしない
        cands.sort((a, b) => (dist.get(a.x + ',' + a.y) - dist.get(b.x + ',' + b.y)) || (chase(a) - chase(b)))
      } else {
        cands = [{ x: e.x + 1, y: e.y }, { x: e.x - 1, y: e.y }, { x: e.x, y: e.y + 1 }, { x: e.x, y: e.y - 1 }]
          .sort(() => Math.random() - 0.5)
      }
      const decayed = { ...e, buff: Math.max(0, (e.buff || 0) - 1), atkDown: Math.max(0, (e.atkDown || 0) - 1), defDown: Math.max(0, (e.defDown || 0) - 1) } // 移動ターンも各効果を減衰
      for (const c of cands) {
        const ck = c.x + ',' + c.y
        // 泳ぐ敵は水も通行可。それ以外は床のみ
        if (canPass(e, c.x, c.y) && !taken.has(ck) && !(c.x === player.x && c.y === player.y)) {
          taken.delete(e.x + ',' + e.y); taken.add(ck) // 移動先を占有・元を解放
          return { ...decayed, x: c.x, y: c.y }
        }
      }
      return decayed
    })

    // ---- 移動と視界は即時反映（攻撃演出はこの後1体ずつ） ----
    const nowVis = computeVisible(s.rooms, player.x, player.y)
    const explored = new Set(s.explored); nowVis.forEach((k) => explored.add(k))
    setState({ ...s, player, enemies, explored })
    if (attackers.length === 0) applyFx({}) // 直前の体当たり演出をクリア

    // ---- ターン終了処理（敵の攻撃演出がすべて終わってから実行） ----
    const nextTurns = turns + 1
    const finalize = (hp, died) => {
      setTurns(nextTurns)
      let dead = died
      let curHp = hp
      let nextFull = Math.max(0, Math.min(MAX_FULLNESS, fullness - fullCost)) // スキル消費/食料回復を反映
      if (!dead) {
        if (nextTurns % FULLNESS_EVERY === 0 && nextFull > 0) { nextFull -= 1; if (nextFull === 0) addLog('🍖 満腹度が0になった…！') }
        if (nextFull <= 0) {
          curHp -= 1; addLog('🥀 空腹で1ダメージ'); popDmg(player.x, player.y, 1, { follow: true })
          if (curHp <= 0) dead = true
        } else if (nextTurns % HP_REGEN_EVERY === 0 && curHp < pet.maxHp) {
          curHp += 1
        }
        // 毒：POISON_INTERVAL ターンごとに最大HPの POISON_PCT ダメージ（次フロアで回復）
        if (poisoned && nextTurns % POISON_INTERVAL === 0) {
          const pd = Math.max(1, Math.ceil(pet.maxHp * POISON_PCT))
          curHp -= pd; addLog(`☠ 毒で${pd}ダメージ`); popDmg(player.x, player.y, pd, { follow: true })
          if (curHp <= 0) dead = true
        }
        // やけど：BURN_INTERVAL ターンごとに最大HPの BURN_PCT ダメージ（次フロアで回復）
        if (burned && nextTurns % BURN_INTERVAL === 0) {
          const bd = Math.max(1, Math.ceil(pet.maxHp * BURN_PCT))
          curHp -= bd; addLog(`🔥 やけどで${bd}ダメージ`); popDmg(player.x, player.y, bd, { follow: true })
          if (curHp <= 0) dead = true
        }
        // 聖域：毎ターン回復
        if (regen > 0 && curHp < pet.maxHp) {
          const rh = Math.min(regenAmtRef.current, pet.maxHp - curHp)
          if (rh > 0) { curHp += rh; popHeal(player.x, player.y, rh, { follow: true }) }
        }
      }
      // バフ・状態の減衰
      if (shield > 0) setShield((v) => Math.max(0, v - 1))
      if (regen > 0) setRegen((v) => Math.max(0, v - 1))
      if (petAtkUp > 0) setPetAtkUp((v) => Math.max(0, v - 1))
      setFullness(nextFull)
      // レベルアップ全回復の予約があれば最終HPを最大に（commitTurnの順番に依存しないように）
      if (!dead && fullHealRef.current != null) { curHp = fullHealRef.current; fullHealRef.current = null }
      setPetHp(curHp)
      // 状態異常カウントの減衰（毎ターン）
      if (paralyzed > 0) setParalyzed((p) => Math.max(0, p - 1))
      if (debuff.atk > 0 || debuff.def > 0 || debuff.mdef > 0) setDebuff((d) => ({ atk: Math.max(0, d.atk - 1), def: Math.max(0, d.def - 1), mdef: Math.max(0, d.mdef - 1) }))
      // 新たに受けた状態異常を付与
      if (willPoison && !poisoned) { setPoisoned(true); addLog('☠ 毒におかされた…！', 'right') }
      if (willBurn && !burned) { setBurned(true); addLog('🔥 やけどを負った…！', 'right') }
      if (willParalyze) { setParalyzed(PARALYZE_TURNS); addLog('⚡ 体がしびれた…！（しばらく攻撃が失敗することがある）', 'right') }
      if (willDebuff.atk || willDebuff.def || willDebuff.mdef) {
        setDebuff((d) => ({ atk: Math.max(d.atk, willDebuff.atk), def: Math.max(d.def, willDebuff.def), mdef: Math.max(d.mdef, willDebuff.mdef) }))
        const names = [willDebuff.atk && '攻撃', willDebuff.def && '防御', willDebuff.mdef && '特防'].filter(Boolean).join('・')
        addLog(`▼ ${names}が下がった…！`, 'right')
      }
      if (dead) { setStatus('dead'); addLog('💀 ペットは力尽きた…'); finishRun(false, true) }

      // ---- 40ターンごとに敵が1体湧く ----
      if (!dead && !isBossFloor(dungeon?.id, floorNum) && nextTurns % SPAWN_EVERY === 0 && enemies.length < SPAWN_CAP) {
        const born = spawnEnemy(s, enemies, player)
        if (born) { enemies = [...enemies, born]; addLog('物音がした…新たな敵が現れた 👁', 'right'); setState({ ...s, player, enemies, explored }) }
      }
      busyRef.current = false
    }

    if (attackers.length === 0) { finalize(curPetHp, false); return }

    // ---- 敵の攻撃は1体ずつワンテンポずつ（最初の1体もひと呼吸おいて） ----
    busyRef.current = true
    const STEP_MS = 330
    let hpNow = curPetHp
    let diedMid = false
    const shieldOn = shield > 0 ? shieldRateRef.current : 1 // 結界/障壁の被ダメ軽減
    attackers.forEach((a, i) => {
      const tid = setTimeout(() => {
        if (diedMid) return // 既に倒れていたら残りの攻撃はなし
        const dmg = Math.max(1, Math.round(a.dmg * shieldOn))
        hpNow -= dmg
        playSe('被ダメ') // 被ダメSE
        popDmg(player.x, player.y, dmg, { follow: true })
        if (a.healShown > 0) popHeal(a.x, a.y, a.healShown)
        const tag = a.notes.length ? `【${a.notes.join('・')}】` : '攻撃'
        addLog(`${a.name}の${tag}！ ${dmg}ダメージ${shieldOn < 1 ? '🛡' : ''} 💥`, 'right')
        applyFx({ pet: { flash: true }, enemies: { [a.id]: { lunge: a.lunge } } })
        triggerShake('hit')
        setPetHp(hpNow)
        if (hpNow <= 0) { diedMid = true; finalize(hpNow, true); return }
        if (i === attackers.length - 1) finalize(hpNow, false)
      }, (i + 1) * STEP_MS)
      turnTimers.current.push(tid)
    })
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
    if (def?.scroll) { castScroll(key); return } // スキルの書を発動（1ターン経過は内部で）
    if (def?.healPct) {
      const heal = Math.ceil(pet.maxHp * def.healPct)
      const healed = Math.min(pet.maxHp, petHp + heal)
      addLog(`${def.emoji} ${def.name}を食べた（HP+${healed - petHp}）`)
      if (healed - petHp > 0) popHeal(state.player.x, state.player.y, healed - petHp, { follow: true })
      commitTurn(state, state.player, state.enemies, healed) // 1ターン経過＋HP回復を反映
    } else if (def?.fullness) {
      addLog(`${def.emoji} ${def.name}を食べた（満腹+${def.fullness}）`)
      commitTurn(state, state.player, state.enemies, petHp, -def.fullness) // 1ターン経過＋満腹回復
    }
  }

  // スキルの書を発動。対象選定（範囲/斜め/全体）→ 威力Lv×2×mult のダメージ＋効果。1ターン消費
  const castScroll = (key) => {
    const sc = getScroll(key)
    if (!sc || !state) return
    const px = state.player.x, py = state.player.y
    const lv = pet.level || 1
    // 威力は「1回の使用で合計 Lv×5×乱数」。多段は hits で割って1発あたりにする
    const dmgPerHit = (hits) => Math.max(1, Math.round((lv * 5 / hits) * (0.85 + Math.random() * 0.3)))
    const dmgDice = (d, hits) => Math.max(1, Math.round((lv * 5 / hits) * (d[0] + Math.random() * (d[1] - d[0]))))

    // --- 自分バフ系（結界/障壁/聖域） ---
    if (sc.target === 'self') {
      playSe('バフ') // バフSE
      if (sc.shieldRate) { setShield(sc.shieldTurns); shieldRateRef.current = sc.shieldRate }
      if (sc.regenPct) { setRegen(sc.regenTurns); regenAmtRef.current = Math.max(1, Math.ceil(pet.maxHp * sc.regenPct)) }
      addLog(`${sc.emoji} ${sc.name}を唱えた！`)
      commitTurn(state, state.player, state.enemies, petHp) // 1ターン経過
      return
    }

    // --- 攻撃系：対象の敵を選ぶ ---
    const range = sc.range || 1
    const inLine = (e) => {
      const dx = e.x - px, dy = e.y - py
      const cheb = Math.max(Math.abs(dx), Math.abs(dy))
      if (cheb < 1 || cheb > range) return false
      const straight = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy) // 直線(縦横)or斜め
      if (Math.abs(dx) === Math.abs(dy) && !sc.diag) return false // 斜め不可スキル
      return straight
    }
    let targets = []
    if (sc.target === 'aoe') {
      targets = state.enemies.filter((e) => Math.max(Math.abs(e.x - px), Math.abs(e.y - py)) === 1) // 周囲8マス
    } else {
      const cand = state.enemies.filter(inLine).sort((a, b) =>
        (Math.max(Math.abs(a.x - px), Math.abs(a.y - py))) - (Math.max(Math.abs(b.x - px), Math.abs(b.y - py))))
      if (cand.length) targets = [cand[0]] // 最寄りの1体
    }
    if (targets.length === 0) { addLog(`${sc.emoji} ${sc.name}！ しかし届く敵がいない…`); commitTurn(state, state.player, state.enemies, petHp); return }

    let enemies = state.enemies
    let healBack = 0
    let totalDealt = 0
    for (const tg of targets) {
      const hits = sc.hits || 1
      let dealt = 0
      for (let h = 0; h < hits; h++) dealt += sc.dice ? dmgDice(sc.dice, hits) : dmgPerHit(hits)
      const cur = enemies.find((e) => e.id === tg.id)
      if (!cur) continue
      const newHp = cur.hp - dealt
      totalDealt += dealt
      popDmg(cur.x, cur.y, dealt)
      if (sc.stun && Math.random() < sc.stun) addLog(`⚡ ${cur.name}はしびれた！`)
      if (newHp <= 0) { enemies = enemies.filter((e) => e.id !== cur.id); enemiesRef.current += 1; grantKill(floorNum, cur.name, px, py) }
      else enemies = enemies.map((e) => e.id === cur.id ? { ...e, hp: newHp, stun: (sc.stun && Math.random() < sc.stun) ? 1 : (e.stun || 0) } : e)
    }
    if (sc.drain) healBack = Math.floor(totalDealt * sc.drain)
    addLog(`${sc.emoji} ${sc.name}！ ${targets.length > 1 ? `${targets.length}体に` : ''}${totalDealt}ダメージ`)
    triggerShake('hit')

    let curHp = petHp
    if (healBack > 0) { const h = Math.min(pet.maxHp, curHp + healBack) - curHp; if (h > 0) { curHp += h; addLog(`💚 ${h}回復`); popHeal(px, py, h, { follow: true }) } }
    if (sc.recoil) { const rc = Math.max(1, Math.round(totalDealt * sc.recoil)); curHp -= rc; addLog(`💢 反動で${rc}ダメージ`); popDmg(px, py, rc, { follow: true }) }

    setState({ ...state, enemies })
    if (curHp <= 0) { setPetHp(0); setStatus('dead'); addLog('💀 ペットは力尽きた…'); finishRun(false, true); return }
    busyRef.current = true
    const tid = setTimeout(() => commitTurn({ ...state, enemies }, state.player, enemies, curHp), BREATH_MS)
    turnTimers.current.push(tid)
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

  // 街に戻る：探索中は「中断（進行状況を保存してラン継続）」。クリア/死亡/脱出後はそのまま戻る
  const leaveToTown = async () => {
    if (status === 'exploring') {
      if (!window.confirm('ダンジョンを中断して街に戻りますか？\n（進行状況は保存され、次回続きから再開できます）')) return
      // デバウンス待たずにサーバーへ即保存（別端末でも続きから再開できるように）
      if (runIdRef.current && state && pet.id) {
        const sv = {
          runId: runIdRef.current, dungeonId: dungeon?.id, floorNum, petHp, fullness, turns,
          selectedSkill, inventory, lootBag, kills: enemiesRef.current, floorsCleared: floorsRef.current, itemsCollected: itemsRef.current,
          state: { ...state, explored: [...state.explored] },
        }
        try { localStorage.setItem(saveKey(), JSON.stringify(sv)) } catch { /* 容量超過は無視 */ }
        try { await supabase.rpc('dungeon_save_state', { p_run_id: runIdRef.current, p_state: sv, p_device: getDeviceId() }) } catch { /* オフライン等は無視 */ }
        // 中断＝プレイ中ではない。出撃を許可できるよう suspended を立てる
        try { await supabase.rpc('dungeon_set_suspended', { p_run_id: runIdRef.current, p_suspended: true }) } catch { /* 無視 */ }
      }
    }
    nav('/game')
  }

  // あきらめる（倒された時と同じ仕様＝なつき-3・戦利品ランダム半分ロスト）
  const giveUp = async () => {
    if (status !== 'exploring' || busyRef.current) return
    if (!window.confirm('あきらめますか？ 倒された時と同じく、なつき度が下がり戦利品の一部を失います。')) return
    setStatus('dead'); addLog('🏳 あきらめた…'); await finishRun(false, true)
  }

  if (scarecrowBlock) return <ScarecrowBlockScreen endsAt={scarecrowBlock.ends_at} />
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
            <div style={{ color: '#aa88ff', letterSpacing: 2 }}>🕳 ダンジョン選択</div>
            <Btn onClick={() => nav('/pets')}>🐾 ペット</Btn>
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 12, marginBottom: 12, alignItems: 'center' }}>
            {pet.image_url ? <img src={pet.image_url} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }} /> : <span style={{ fontSize: 22 }}>{pet.emoji}</span>}
            <span>{pet.name}　Lv{pet.level ?? 1}{pet.id ? '' : '（ペット未選択＝報酬なし）'}</span>
          </div>

          {/* 持ち物プレビュー＆だっしゅつの翼の警告（なくても挑める） */}
          {(inventory.escape || 0) < 1 && (
            <div style={{ background: '#1a0e00', border: '1px solid #cc7733', color: '#ffaa66', padding: 8, fontSize: 12, marginBottom: 10 }}>
              ⚠ だっしゅつの翼を持っていません。途中で帰る手段がなくなります（倉庫から持ち物へ移すのを忘れずに）
            </div>
          )}
          <div style={{ background: '#000610', border: '1px solid #113355', padding: 8, marginBottom: 12 }}>
            <div style={{ color: '#88aacc', fontSize: 11, marginBottom: 6 }}>🎒 持ち物（ダンジョンに持っていく分）</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(inventory).filter(([, q]) => (q || 0) > 0).map(([k, q]) => {
                const def = PET_ITEMS[k]
                return (
                  <span key={k} style={{ background: '#0a1424', border: '1px solid #335588', color: '#cce6ff', padding: '4px 8px', fontSize: 12 }}>
                    {def?.emoji || '🔹'} {def?.name || k}×{q}
                  </span>
                )
              })}
              {Object.values(inventory).every((q) => (q || 0) < 1) && <span style={{ color: '#445566', fontSize: 11 }}>（なし）</span>}
            </div>
            <div style={{ marginTop: 6, textAlign: 'right' }}><Btn onClick={() => nav('/pet-storage')}>🏬 倉庫で入れ替える</Btn></div>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {DUNGEONS.map((d) => {
              // 開発アカウントは comingSoon でも入れる（テスト用）
              const unlocked = (!d.comingSoon || isAdmin) && (!d.requires || cleared.has(d.requires) || isAdmin)
              const isCleared = cleared.has(d.id)
              return (
                <div key={d.id} onClick={() => unlocked && beginDungeon(d)}
                  style={{ border: `1px solid ${unlocked ? '#335588' : '#223344'}`, background: unlocked ? '#00102a' : '#080c14', padding: 12, cursor: unlocked ? 'pointer' : 'default', opacity: unlocked ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 30 }}>{d.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#cce6ff', fontSize: 14 }}>{d.name} <span style={{ color: '#6699cc', fontSize: 11 }}>全{d.floors}階</span> {isCleared && <span style={{ color: '#44ff88', fontSize: 10 }}>✓クリア済</span>}</div>
                    <div style={{ color: unlocked ? '#6699cc' : '#aa6644', fontSize: 11, marginTop: 2 }}>
                      {d.comingSoon && isAdmin ? '🛠 [開発] テスト挑戦可' : d.comingSoon ? '🔒 近日公開（後日のアップデートで開放）' : unlocked ? 'タップして挑戦' : `${getDungeon(d.requires).name} をクリアで開放`}
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
  const floorTile = dgTileSrc(dungeon?.id, 'floor', floorNum)
  const wallTile = dgTileSrc(dungeon?.id, 'wall', floorNum)
  const stairsTile = dgTileSrc(dungeon?.id, 'stairs', floorNum)
  const itemTile = dgTileSrc(dungeon?.id, 'item', floorNum)
  const waterWall = dgWaterWall(dungeon?.id, floorNum) // 壁＝半透明の水たまり描画にするか
  // 床はグリッド全体に1枚だけ敷く（シームレス）。床マスは透過してその床を見せる。
  const floorBg = floorTile ? 'transparent' : C.floorVis
  const cellAt = (x, y) => {
    if (!inBounds(x, y)) return { ch: '', bg: C.unknown }
    const vis = isVisible(x, y)
    if (!vis) return { ch: '', bg: C.unknown } // 現在見えていない所は完全に真っ暗（記憶表示なし）
    const wall = state.grid[y][x] === '#'
    // 現在視界：エンティティ優先（足元は床。floorTile時は透過で下地の床画像を見せる）
    if (state.player.x === x && state.player.y === y) return { ch: pet.emoji || '🐾', img: pet.image_url, bg: floorBg, fx: fx.pet, poison: poisoned, paralyze: paralyzed > 0, burn: burned, cheer: cheer || 0, isPet: true }
    const e = enemyAt(state.enemies, x, y)
    if (e) {
      // ボス(2×2)は左上セルにだけ画像を描き、4マスぶんに広げる。他3マスは透過
      if (e.boss) {
        if (e.x === x && e.y === y) return { ch: '👹', img: e.image || null, bg: floorBg, fx: fx.enemies[e.id] || null, bossImg: true, bossE: e }
        return { ch: '', bg: floorBg } // 残り3マスは透過（左上の画像が覆う）
      }
      return { ch: '👹', img: e.image || null, bg: floorBg, fx: fx.enemies[e.id] || null }
    }
    const it = state.items.find((o) => o.x === x && o.y === y)
    if (it) {
      // 床アイテムは実アイコンを表示（素=画像／食料・スキル書=絵文字／戦利品=lootDisplay）
      const d = (it.kind === 'food' || it.kind === 'dropFood')
        ? { emoji: PET_ITEMS[it.key]?.emoji || '🎁', img: petItemImg(it.key) }
        : lootDisplay(it.loot) // loot / dropLoot とも it.loot を持つ
      return { ch: d.emoji || '🎁', img: d.img || null, item: true, bg: floorBg, overlay: d.img ? null : itemTile }
    }
    if (state.stairs.x === x && state.stairs.y === y) return { ch: '▼', bg: floorBg, overlay: stairsTile, stairsGlow: true, water: waterWall }
    // 壁マスは壁画像を1マスごとに表示（複数あればマス座標でランダム）。床マスは透過。
    if (wall) return { ch: '', bg: waterWall ? floorBg : (wallTile ? '#08060a' : C.wallVis), wallImg: dgWallVariant(dungeon?.id, x, y, floorNum) || wallTile, water: waterWall }
    return { ch: '', bg: floorBg }
  }

  const adjClick = (vx, vy) => {
    const x = ox + vx, y = oy + vy
    const dx = x - state.player.x, dy = y - state.player.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) tryMove(dx, dy) // 斜めも含む8方向
  }

  return (
    <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', padding: '10px 8px' }}>
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
        /* レベルアップ時に喜んで2回小ジャンプ（間隔短め） */
        @keyframes bf-cheer {
          0%   { transform: translateY(0) scaleY(1); }
          10%  { transform: translateY(2%) scaleY(0.9); }
          26%  { transform: translateY(-26%) scaleY(1.05); }
          40%  { transform: translateY(0) scaleY(0.95); }
          48%  { transform: translateY(2%) scaleY(0.92); }
          64%  { transform: translateY(-20%) scaleY(1.04); }
          80%  { transform: translateY(0) scaleY(0.98); }
          100% { transform: translateY(0) scaleY(1); }
        }
        @keyframes bf-boss-blink {
          0%, 49% { opacity: 1; filter: brightness(2) drop-shadow(0 0 8px #ff3366); }
          50%, 100% { opacity: 0.15; }
        }
        @keyframes bf-popnum {
          0%   { transform: translate(-50%, 0); opacity: 0; }
          10%  { transform: translate(-50%, -5px); opacity: 1; }
          75%  { transform: translate(-50%, -16px); opacity: 1; }
          100% { transform: translate(-50%, -22px); opacity: 0; }
        }
        @keyframes bf-popexp {
          0%   { transform: translate(-50%, -2px); opacity: 0; }
          20%  { transform: translate(-50%, 4px); opacity: 1; }
          75%  { transform: translate(-50%, 8px); opacity: 1; }
          100% { transform: translate(-50%, 14px); opacity: 0; }
        }
        @keyframes bf-levelup-c {
          0%   { transform: translate(-50%, -100%); opacity: 0; }
          8%   { transform: translate(-50%, -100%); opacity: 1; }
          100% { transform: translate(-50%, -106%); opacity: 1; }
        }
        /* 文字ごとの退場（1文字目から順に下へ消える） */
        @keyframes bf-letter-out {
          0%   { opacity: 1; transform: translate(-50%, -50%) rotate(var(--r,0deg)) scale(1); }
          100% { opacity: 0; transform: translate(-50%, 20%) rotate(var(--r,0deg)) scale(0.7); }
        }
        @keyframes bf-letter-pop {
          0%   { opacity: 0; transform: translate(-50%, 40%) rotate(var(--r,0deg)) scale(0.3); }
          60%  { opacity: 1; transform: translate(-50%, -60%) rotate(var(--r,0deg)) scale(1.25); }
          100% { opacity: 1; transform: translate(-50%, -50%) rotate(var(--r,0deg)) scale(1); }
        }
        /* ✨がその場で出て下へこぼれ落ちる（流れ星風） */
        @keyframes bf-spark-fall {
          0%   { opacity: 0; transform: translate(-50%, -60%) scale(0.3) rotate(0deg); }
          25%  { opacity: 1; transform: translate(-50%, -30%) scale(1.3) rotate(20deg); }
          100% { opacity: 0; transform: translate(calc(-50% + var(--dx, 0px)), 240%) scale(0.5) rotate(80deg); }
        }
        /* マップは画面幅いっぱいに広げる */
        .bf-dg-wrap { max-width: min(96vw, 820px); margin: 0 auto; }
        @media (min-width: 900px) {
          .bf-dg-wrap { max-width: 920px; }
        }
        /* メイン画面(マップ)はウィンドウを広げても大きくなりすぎないよう上限を設ける */
        .bf-dg-grid { width: 100%; max-width: 440px; margin: 0 auto; }
      `}</style>
      <div className="bf-dg-wrap">
        <div className="bf-dg-main">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #003366', paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ color: '#ffcc00', fontSize: 16, letterSpacing: 3 }}>BATTLE FRONTIER</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Btn onClick={leaveToTown}>← 街に戻る</Btn>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ color: '#aa88ff', letterSpacing: 2 }}>{dungeon?.emoji || '🕳'} {dungeon?.name || 'ダンジョン'}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
            {/* 全体音量（オン/オフ＋スライダー）。出撃の左 */}
            <button onClick={() => setMasterOn((v) => !v)} title="全体の音 ON/OFF"
              style={{ background: masterOn ? '#101a30' : '#0a0a14', border: `1px solid ${masterOn ? '#0088ff' : '#334455'}`, color: masterOn ? '#66bbff' : '#556677', padding: '4px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13 }}>
              {masterOn ? '🔊' : '🔇'}
            </button>
            <input type="range" min="0" max="100" value={masterVol} onChange={(e) => setMasterVol(Number(e.target.value))}
              disabled={!masterOn} title={`全体音量 ${masterVol}%`} style={{ width: 64, accentColor: '#0088ff', cursor: masterOn ? 'pointer' : 'not-allowed' }} />
            {/* 簡易出撃のクイックボタン（SortiePanelがポータルで描画。エリア選択は下のメニューから） */}
            <span id="bf-sortie-quick" />
            {/* 設定（歯車）：移動キー左右・BGM・SE */}
            <button onClick={() => setShowSettings((v) => !v)} title="設定"
              style={{ background: showSettings ? '#101a30' : '#0a1424', border: `1px solid ${showSettings ? '#0088ff' : '#335588'}`, color: '#88bbff', padding: '4px 9px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13 }}>⚙</button>
            {showSettings && (
              <div style={{ position: 'absolute', top: '110%', right: 0, zIndex: 30, background: '#001026', border: '1px solid #335588', padding: 10, width: 220, fontFamily: 'monospace', boxShadow: '0 6px 18px rgba(0,0,0,0.6)' }}>
                <div style={{ color: '#88bbff', fontSize: 12, marginBottom: 8 }}>⚙ 設定</div>
                {/* 移動キーの左右 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: '#aaccee', fontSize: 11 }}>移動キーの位置</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[['left', '左'], ['center', '中央'], ['right', '右']].map(([v, label]) => (
                      <button key={v} onClick={() => setPad(v)}
                        style={{ background: padSide === v ? '#241640' : '#0a1424', border: `1px solid ${padSide === v ? '#aa88ff' : '#335588'}`, color: padSide === v ? '#cba6ff' : '#88aacc', padding: '3px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {!masterOn && <div style={{ color: '#7799aa', fontSize: 10, marginBottom: 6 }}>※「🔊全体」をオンにするとBGM/SEを切り替えられます</div>}
                {/* BGM */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: bgmOn && bgmDungeon && masterOn ? 4 : 8, opacity: masterOn ? 1 : 0.5 }}>
                  <span style={{ color: '#aaccee', fontSize: 11 }}>BGM{bgmDungeon ? '' : '（このダンジョンは無し）'}</span>
                  <button onClick={toggleBgm} disabled={!bgmDungeon || !masterOn}
                    style={{ background: bgmOn ? '#101a30' : '#0a0a14', border: `1px solid ${bgmOn ? '#0088ff' : '#334455'}`, color: bgmOn ? '#66bbff' : '#556677', padding: '3px 10px', cursor: (bgmDungeon && masterOn) ? 'pointer' : 'not-allowed', fontFamily: 'monospace', fontSize: 11 }}>
                    {bgmOn ? '🔊 ON' : '🔇 OFF'}
                  </button>
                </div>
                {bgmDungeon && bgmOn && masterOn && (
                  <input type="range" min="0" max="100" value={bgmVol} onChange={(e) => setBgmVol(Number(e.target.value))}
                    title={`音量 ${bgmVol}%`} style={{ width: '100%', accentColor: '#0088ff', cursor: 'pointer', marginBottom: 8 }} />
                )}
                {/* SE */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: seOn && masterOn ? 4 : 0, opacity: masterOn ? 1 : 0.5 }}>
                  <span style={{ color: '#aaccee', fontSize: 11 }}>効果音（SE）</span>
                  <button onClick={toggleSe} disabled={!masterOn}
                    style={{ background: seOn ? '#101a30' : '#0a0a14', border: `1px solid ${seOn ? '#0088ff' : '#334455'}`, color: seOn ? '#66bbff' : '#556677', padding: '3px 10px', cursor: masterOn ? 'pointer' : 'not-allowed', fontFamily: 'monospace', fontSize: 11 }}>
                    {seOn ? '🔊 ON' : '🔇 OFF'}
                  </button>
                </div>
                {seOn && masterOn && (
                  <input type="range" min="0" max="100" value={seVol} onChange={(e) => setSeVol(Number(e.target.value))}
                    title={`SE音量 ${seVol}%`} style={{ width: '100%', accentColor: '#0088ff', cursor: 'pointer' }} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* マップ（ビューポート）。接触時に少し震える戦闘演出 */}
        <div ref={gridRef} className="bf-dg-grid" style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${VW}, 1fr)`, gap: 0, background: '#000208', padding: 6, border: '1px solid #113355', willChange: 'transform', animation: shake === 'kill' ? 'bf-dungeon-shake-kill 0.36s ease-in-out' : shake === 'hit' ? 'bf-dungeon-shake-hit 0.22s ease-in-out' : 'none' }}>
          {/* 床はワールド(ダンジョン)に固定＝壁と一緒にスクロール。キャラ移動で床がズレない。1タイル=約4マス */}
          {floorTile && (
            <div style={{ position: 'absolute', inset: 6, backgroundImage: `url(${floorTile})`, backgroundRepeat: 'repeat',
              backgroundSize: cellPx > 0 ? `${cellPx * 4}px auto` : `${(4 / VW) * 100}% auto`,
              backgroundPosition: cellPx > 0 ? `${-ox * cellPx}px ${-oy * cellPx}px` : 'center',
              filter: 'brightness(0.72) saturate(0.95)', zIndex: 0, pointerEvents: 'none' }} />
          )}
          {/* 照明・ビネット：中央を明るく端を暗く＝1枚絵のような奥行きを出す */}
          {floorTile && (
            <div style={{ position: 'absolute', inset: 6, zIndex: 0, pointerEvents: 'none',
              background: 'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(255,210,130,0.16) 0%, rgba(0,0,0,0) 45%), radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,2,8,0.72) 100%)' }} />
          )}
          {/* ステータス表示（マップ上部に重ねる）。2段目に状態異常（異常時のみ） */}
          {(() => {
            const chips = []
            if (poisoned) chips.push({ k: 'poison', label: '☠ 毒', col: '#cc77ff' })
            if (paralyzed > 0) chips.push({ k: 'para', label: `⚡ 麻痺 残${paralyzed}`, col: '#ffe066' })
            if (burned) chips.push({ k: 'burn', label: '🔥 やけど', col: '#ff7755' })
            if (burned || debuff.atk > 0) chips.push({ k: 'datk', label: '▼ 攻撃ダウン', col: '#88bbdd' })
            if (debuff.def > 0) chips.push({ k: 'ddef', label: '▼ 防御ダウン', col: '#88bbdd' })
            if (debuff.mdef > 0) chips.push({ k: 'dmdef', label: '▼ 特防ダウン', col: '#88bbdd' })
            if (shield > 0) chips.push({ k: 'shield', label: `🛡 結界 残${shield}`, col: '#66ddff' })
            if (petAtkUp > 0) chips.push({ k: 'atkup', label: `🔺 攻撃アップ 残${petAtkUp}`, col: '#ffcc66' })
            if (regen > 0) chips.push({ k: 'regen', label: `🕊 聖域 残${regen}`, col: '#aaffcc' })
            if (fullness <= 0) chips.push({ k: 'hungry', label: '🥀 空腹', col: '#ff8855' })
            return (
              <div style={{ position: 'absolute', top: 6, left: 6, right: 6, zIndex: 6, pointerEvents: 'none',
                display: 'flex', flexDirection: 'column', gap: 3,
                padding: '5px 8px', background: 'linear-gradient(180deg, rgba(0,4,12,0.82) 0%, rgba(0,4,12,0.55) 100%)', borderBottom: '1px solid rgba(80,120,180,0.35)' }}>
                <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>B{floorNum}/{dungeon?.floors || 10}F</span>
                  <span style={{ color: '#9fd' }}>Lv{pet.level}{pet.exp != null ? `（EXP ${pet.exp}/${expForLevel(pet.level || 1)}）` : ''}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: petHp > pet.maxHp * 0.3 ? '#44ff88' : '#ff5555' }}>
                    {pet.image_url ? <img src={pet.image_url} alt="" style={{ width: 14, height: 14, objectFit: 'cover', borderRadius: 3 }} /> : <span>{pet.emoji}</span>}
                    {pet.name} HP {petHp}/{pet.maxHp}
                  </span>
                  <span style={{ color: fullness > 0 ? '#ffcc44' : '#ff5555' }}>🍖 満腹 {fullness}/{MAX_FULLNESS}</span>
                </div>
                {chips.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, fontSize: 11, flexWrap: 'wrap', alignItems: 'center' }}>
                    {chips.map((c) => <span key={c.k} style={{ color: c.col, whiteSpace: 'nowrap' }}>{c.label}</span>)}
                  </div>
                )}
                {/* ボスHPバー（大） */}
                {(() => {
                  const boss = state.enemies.find((e) => e.boss)
                  if (!boss) return null
                  const r = Math.max(0, Math.min(1, (boss.hp || 0) / (boss.maxHp || 1)))
                  return (
                    <div style={{ marginTop: 2 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: boss.phase === 1 ? '#ff77aa' : '#ffaa66' }}>
                        <span>👿 {boss.name}{boss.phase === 1 ? '（第2形態）' : '（第1形態）'}</span>
                        <span>{boss.hp}/{boss.maxHp}</span>
                      </div>
                      <div style={{ height: 7, background: 'rgba(0,4,10,0.85)', border: '1px solid #000', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${r * 100}%`, height: '100%', background: boss.phase === 1 ? '#ff4488' : '#ff8844', transition: 'width 0.25s ease' }} />
                      </div>
                    </div>
                  )
                })()}
              </div>
            )
          })()}
          {Array.from({ length: VH }).map((_, vy) => Array.from({ length: VW }).map((_, vx) => {
            const x = ox + vx, y = oy + vy
            const c = cellAt(x, y)
            const cdx = x - state.player.x, cdy = y - state.player.y
            const cornerBlocked = cdx !== 0 && cdy !== 0 &&
              (state.grid[state.player.y]?.[x] === '#' || state.grid[y]?.[state.player.x] === '#')
            const clickable = status === 'exploring' && isVisible(x, y) && inBounds(x, y) && state.grid[y]?.[x] !== '#' &&
              Math.max(Math.abs(cdx), Math.abs(cdy)) === 1 && !cornerBlocked
            // 毒状態のペットはうっすら紫に染める
            // 状態異常の色付け：やけど=赤＞麻痺=黄＞毒=紫 の優先で1色を重ねる
            const statusFilter = c.burn ? 'sepia(0.7) saturate(3) hue-rotate(-25deg) brightness(1.05) drop-shadow(0 0 3px #ff5533)'
              : c.paralyze ? 'sepia(0.8) saturate(2.2) hue-rotate(-12deg) brightness(1.08) drop-shadow(0 0 3px #ffe066)'
              : c.poison ? 'sepia(0.6) hue-rotate(230deg) saturate(1.8) drop-shadow(0 0 3px #aa55ff)'
              : 'none'
            const inner = (c.bossImg && c.img)
              // ボスは左上セルから2×2マスに広げて表示（overflow visibleで隣にはみ出す）＋頭上HPバー
              ? <div style={{ position: 'absolute', left: 0, top: 0, width: '200%', height: '200%', zIndex: 4, pointerEvents: 'none' }}>
                  <img src={c.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', animation: c.bossE?.blink ? 'bf-boss-blink 0.22s steps(1) infinite' : undefined }} />
                </div>
              : c.img
              ? (c.item
                  // 床アイテムは小さめ＆全体が見えるよう contain
                  ? <img src={c.img} alt="" style={{ width: '72%', height: '72%', objectFit: 'contain', display: 'block', margin: 'auto' }} />
                  : <img src={c.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: statusFilter }} />)
              : (
                <span style={{ filter: statusFilter, position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%',
                  color: c.stairsGlow ? (c.water ? '#9ff0ff' : '#ffe680') : undefined,
                  textShadow: c.stairsGlow ? (c.water ? '0 0 6px #33ddee, 0 0 12px #0099bb' : '0 0 6px #ffcc33, 0 0 12px #ff9900') : undefined }}>
                  {c.ch}
                  {/* 階段・アイテムのカスタム画像（無ければonErrorで隠れ絵文字のまま）。水エリアは青緑に色変換 */}
                  {c.overlay && <img src={c.overlay} alt="" onError={(ev) => { ev.target.style.display = 'none' }}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block',
                      filter: c.stairsGlow
                        ? (c.water
                            ? 'sepia(0.85) saturate(1.7) hue-rotate(178deg) brightness(0.6) drop-shadow(0 0 5px #33ddee) drop-shadow(0 0 10px #0099bb)'
                            : 'drop-shadow(0 0 5px #ffcc33) drop-shadow(0 0 9px #ff9900) brightness(1.15)')
                        : undefined }} />}
                  {/* 階段の強調（静的な発光リング）。水エリアは青緑 */}
                  {c.stairsGlow && <span style={{ position: 'absolute', inset: '8%', borderRadius: '50%', boxShadow: c.water ? '0 0 8px 2px rgba(60,210,235,0.7)' : '0 0 8px 2px rgba(255,200,60,0.7)', pointerEvents: 'none' }} />}
                </span>
              )
            const anims = []
            if (c.fx?.lunge) anims.push('bf-lunge 0.26s ease-out')
            if (c.fx?.flash) anims.push('bf-flash 0.42s ease-in-out')
            if (c.cheer) anims.push('bf-cheer 0.7s ease-in-out') // レベルアップで2回小ジャンプ
            const fxStyle = (c.fx || c.cheer) ? {
              width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: anims.join(', '), willChange: 'transform, opacity',
              '--lx': c.fx?.lunge ? `${Math.sign(c.fx.lunge.dx) * 40}%` : '0%',
              '--ly': c.fx?.lunge ? `${Math.sign(c.fx.lunge.dy) * 40}%` : '0%',
            } : null
            const fxKey = c.cheer ? `cheer${c.cheer}` : `fx${fx.t}`
            // 壁マスは「1枚で完結した岩タイル」を1マス＝1枚で表示（複数種からマスごとにランダム）。
            // 壁は暗め＋やや寒色グレー寄りにして、暖色の床とハッキリ見分けられるようにする。
            const wallImg = c.wallImg
            const tileStyle = wallImg
              ? (c.water
                  // 水たまり＝渡れない深い水。床(水辺床)とハッキリ区別できるよう濃い青で暗めに＋縁取り
                  ? { backgroundImage: `url(${wallImg})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'brightness(0.62) saturate(1.7) hue-rotate(8deg)' }
                  : { backgroundImage: `url(${wallImg})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'brightness(0.4) saturate(0.5) hue-rotate(-8deg)' })
              : { backgroundImage: 'none' }
            // グリッド線対策：マス間のサブピクセル隙間を「そのマス自身の色」で埋める。
            //  透過の床マスはそのまま（継ぎ目なし）、壁マス・暗いマスは自色（暗）で塞ぐ。
            const gapFill = floorTile
              ? (c.bg !== 'transparent' ? `0 0 0 0.7px ${c.bg}` : 'none')
              : `0 0 0 0.6px ${c.bg}`
            return (
              <div key={`${vx}-${vy}`} onClick={() => clickable && adjClick(vx, vy)}
                style={{ position: 'relative', zIndex: c.bossImg ? 3 : c.isPet ? 4 : 1, aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, background: c.bg, ...tileStyle, opacity: c.dim ? 0.5 : 1, cursor: clickable ? 'pointer' : 'default', overflow: 'visible', boxShadow: gapFill }}>
                {fxStyle ? <div key={fxKey} style={fxStyle}>{inner}</div> : inner}
                {/* 自分のキャラに重ねるHPバー（足元寄り） */}
                {c.isPet && (() => {
                  const ratio = Math.max(0, Math.min(1, petHp / (pet.maxHp || 1)))
                  const barCol = ratio > 0.5 ? '#44dd66' : ratio > 0.25 ? '#ffcc33' : '#ff4444'
                  return (
                    <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: '4%', height: 4, background: 'rgba(0,4,10,0.85)', border: '1px solid #000', borderRadius: 2, overflow: 'hidden', zIndex: 5, pointerEvents: 'none' }}>
                      <div style={{ width: `${ratio * 100}%`, height: '100%', background: barCol, transition: 'width 0.25s ease, background 0.25s ease' }} />
                    </div>
                  )
                })()}
              </div>
            )
          }))}
          {/* 通路では円形ビネットを重ねて視界を円に見せる（プレイヤー＝中央50%） */}
          {inCorridor && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
              background: 'radial-gradient(ellipse 29% 31.9% at 50% 55%, transparent 80%, #000208 100%)' }} />
          )}
          {/* 別端末でプレイ中＝この端末はロック */}
          {lockedOut && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,2,8,0.86)', textAlign: 'center', padding: 16 }}>
              <div>
                <div style={{ fontSize: 34, marginBottom: 8 }}>📱🔒</div>
                <div style={{ color: '#ffcc44', fontSize: 14, marginBottom: 6 }}>別の端末でプレイ中です</div>
                <div style={{ color: '#aaccff', fontSize: 11, lineHeight: 1.7, marginBottom: 14 }}>
                  ダンジョンは複数の端末で同時にプレイできません。<br />この端末で続けるには再読み込みしてください（操作権を取り戻します）。
                </div>
                <button onClick={() => window.location.reload()}
                  style={{ background: '#001840', border: '1px solid #0088ff', color: '#0088ff', padding: '8px 18px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>🔄 再読み込みして続ける</button>
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => nav('/pets')} style={{ background: 'none', border: '1px solid #446688', color: '#88aacc', padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>🐾 ペットへ</button>
                </div>
              </div>
            </div>
          )}
          {/* フロア遷移演出：暗転＋「ダンジョン名 フロア数」 */}
          {transition && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#000208', opacity: transition.black, transition: 'opacity 0.45s ease' }}>
              <div style={{ textAlign: 'center', opacity: transition.title, transition: 'opacity 0.4s ease' }}>
                <div style={{ color: '#c8a0ff', fontSize: 20, letterSpacing: 4 }}>{transition.emoji || dungeon?.emoji} {transition.name || dungeon?.name}</div>
                <div style={{ color: '#ffcc66', fontSize: 26, letterSpacing: 3, marginTop: 10 }}>B{transition.floor}F</div>
              </div>
            </div>
          )}
          {/* 頭上に浮かぶダメージ(-赤)/回復(+緑)の数字 */}
          {pops.map((p) => {
            // follow=true（経験値）はキャラの現在位置に追従。それ以外は出した場所に固定
            const wx = p.follow ? state.player.x : p.x
            const wy = p.follow ? state.player.y : p.y
            const vx = wx - ox, vy = wy - oy
            if (vx < 0 || vx >= VW || vy < 0 || vy >= VH) return null
            return (
              <span key={p.id} style={{
                position: 'absolute', zIndex: 8, pointerEvents: 'none',
                left: `calc(${((vx + 0.5) / VW) * 100}% + ${p.dx}px)`,
                top: p.below ? `${((vy + 0.95) / VH) * 100}%` : `${(vy / VH) * 100}%`,
                color: p.color, fontSize: 15, fontWeight: 'bold', fontFamily: 'monospace',
                textShadow: '0 0 2px #000, 0 1px 3px #000, 0 0 6px #000, -1px 0 1px #000, 1px 0 1px #000', whiteSpace: 'nowrap',
                animation: p.below ? 'bf-popexp 1.1s ease-out forwards' : 'bf-popnum 1.5s ease-out forwards',
              }}>{p.text}</span>
            )
          })}
          {/* レベルアップ：キャラの少し上に虹色アーチで LEVEL UP を1文字ずつ＋各文字でキラキラ（約4秒） */}
          {levelUp && (() => {
            // キャラの現在位置に追従（移動・カメラスクロールしてもキャラの上に出る）
            const vx = state.player.x - ox, vy = state.player.y - oy
            if (vx < 0 || vx >= VW || vy < 0 || vy >= VH) return null
            const cellW = 100 / VW, cellH = 100 / VH
            const W = 168, H = 82, cx = W / 2, cy = 74, rx = 66, ry = 50
            const chars = 'LEVEL UP'.split('')
            const n = chars.length
            return (
              <div key={levelUp.id} style={{
                position: 'absolute', zIndex: 6, pointerEvents: 'none',
                left: `${(vx + 0.5) * cellW}%`, top: `${(vy - 0.2) * cellH}%`,
                transform: 'translate(-50%, -100%)', width: W, height: H,
                animation: 'bf-levelup-c 3s ease-out forwards',
              }}>
                {chars.map((ch, i) => {
                  const t = n > 1 ? i / (n - 1) : 0.5
                  const ang = Math.PI * (1 - t)              // 180°→0°（左から右へ上を通る）
                  const x = cx + rx * Math.cos(ang)
                  const y = cy - ry * Math.sin(ang)
                  const rot = (t - 0.5) * 100                // 端ほど傾けてアーチに沿わせる
                  const hue = Math.round(t * 300)            // 赤→紫の虹
                  const delay = `${i * 0.07}s`
                  const exitDelay = `${1.9 + i * 0.09}s` // 消える時も1文字目から順に
                  if (ch === ' ') return null
                  return (
                    <span key={i}>
                      <span style={{
                        position: 'absolute', left: x, top: y, '--r': `${rot}deg`,
                        transformOrigin: 'center', fontFamily: 'monospace', fontWeight: 900, fontSize: 21,
                        WebkitTextStroke: '1.4px #000', // 黒で縁取りして太く見やすく
                        color: `hsl(${hue},92%,60%)`, textShadow: '0 0 3px #000, 0 2px 4px #000, 0 0 8px rgba(255,255,255,0.55)',
                        opacity: 0, animation: `bf-letter-pop 0.5s ease-out ${delay} forwards, bf-letter-out 0.45s ease-in ${exitDelay} forwards`,
                      }}>{ch}</span>
                      {/* 出現時に✨がこぼれ落ちる（流れ星風） */}
                      <span style={{
                        position: 'absolute', left: x, top: y, '--dx': `${((i % 2 ? 1 : -1) * (5 + (i * 7) % 9))}px`,
                        fontSize: 15, opacity: 0, animation: `bf-spark-fall 0.9s ease-in ${delay} forwards`,
                      }}>✨</span>
                      {/* 消える時も1文字ずつ✨がこぼれ落ちる */}
                      <span style={{
                        position: 'absolute', left: x, top: y, '--dx': `${((i % 2 ? -1 : 1) * (6 + (i * 5) % 8))}px`,
                        fontSize: 15, opacity: 0, animation: `bf-spark-fall 0.9s ease-in ${exitDelay} forwards`,
                      }}>✨</span>
                    </span>
                  )
                })}
              </div>
            )
          })()}
          {/* マップ右下：背景透過の文字だけログ（直近数件・2秒無更新でフェードアウト） */}
          <div style={{ position: 'absolute', right: 8, bottom: 6, zIndex: 4, pointerEvents: 'none',
            width: 'min(62%, 360px)', textAlign: 'right', lineHeight: 1.5,
            opacity: logHidden ? 0 : 1, transition: 'opacity 0.7s ease' }}>
            {log.slice(0, 4).reverse().map((l, i, arr) => (
              <div key={i} style={{
                fontSize: 11, fontFamily: 'monospace',
                color: i === arr.length - 1 ? '#eaf4ff' : (l.side === 'right' ? '#ffb0b0' : '#bcd6ff'),
                opacity: 0.45 + 0.55 * ((i + 1) / arr.length), // 古いほど薄く
                textShadow: '0 1px 2px #000, 0 0 4px #000, 0 0 2px #000',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{l.icon && <img src={l.icon} alt="" style={{ width: 13, height: 13, objectFit: 'contain', verticalAlign: 'middle', marginRight: 3 }} />}{l.msg}</div>
            ))}
          </div>
        </div>

        {status === 'exploring' && (() => {
          const padEl = (
            <div key="pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 44px)', gridAutoRows: '44px', gap: 4 }}>
              <PadBtn onClick={() => tryMove(-1, -1)}>◤</PadBtn><PadBtn onClick={() => tryMove(0, -1)}>▲</PadBtn><PadBtn onClick={() => tryMove(1, -1)}>◥</PadBtn>
              <PadBtn onClick={() => tryMove(-1, 0)}>◀</PadBtn><PadBtn onClick={stepInPlace}>■</PadBtn><PadBtn onClick={() => tryMove(1, 0)}>▶</PadBtn>
              <PadBtn onClick={() => tryMove(-1, 1)}>◣</PadBtn><PadBtn onClick={() => tryMove(0, 1)}>▼</PadBtn><PadBtn onClick={() => tryMove(1, 1)}>◢</PadBtn>
            </div>
          )
          const skillsEl = (
            <div key="skills" style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
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
          )
          const itemsEl = (
            <div key="items" style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
              {DUNGEON_ITEMS.filter((it) => (inventory[it.key] || 0) > 0).map((it) => (
                <button key={it.key} onClick={() => (dropMode ? dropItem({ kind: 'consumable', key: it.key }) : useItem(it.key))}
                  style={{ background: dropMode ? '#1a0e08' : '#0a1424', border: `1px solid ${dropMode ? '#cc7755' : '#335588'}`, color: '#cce6ff', padding: '6px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, minWidth: 96, textAlign: 'left' }}>
                  {it.emoji} {it.name}×{inventory[it.key]}
                </button>
              ))}
              {DUNGEON_ITEMS.every((it) => (inventory[it.key] || 0) < 1) && (
                <span style={{ color: '#445566', fontSize: 10 }}>使えるアイテムなし</span>
              )}
            </div>
          )
          // 中央＝スキル｜移動キー｜アイテム / 左＝移動キー＋(スキル/アイテム) / 右＝その逆
          if (padSide === 'center') {
            return (
              <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'flex-start', marginTop: 12 }}>
                {skillsEl}{padEl}{itemsEl}
              </div>
            )
          }
          return (
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'flex-start', marginTop: 12,
              flexDirection: padSide === 'right' ? 'row-reverse' : 'row' }}>
              {padEl}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>{skillsEl}{itemsEl}</div>
            </div>
          )
        })()}
        {status === 'exploring' && (() => {
          const bagMax = bagCapacity(cleared.size)
          const empty = lootBag.length === 0
          return (
            <div style={{ marginTop: 12, background: '#000610', border: `1px solid ${dropMode ? '#cc7755' : '#113355'}`, padding: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ color: '#88aacc', fontSize: 11 }}>🎒 持ち物 <span style={{ color: bagCount() >= bagMax ? '#ff7777' : '#5e7fa0' }}>{bagCount()}/{bagMax}</span>（翼も含む）{dropMode && <span style={{ color: '#ff9966' }}>　捨てるモード：押すと足元に置く</span>}</div>
                <button onClick={() => setDropMode((d) => !d)}
                  style={{ background: dropMode ? '#2a1000' : '#0a1424', border: `1px solid ${dropMode ? '#ff9966' : '#335588'}`, color: dropMode ? '#ff9966' : '#88aacc', padding: '3px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                  🗑 捨てる{dropMode ? '（ON）' : ''}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {lootBag.map((l) => (
                  <button key={l.id} onClick={() => dropMode && dropItem({ kind: 'loot', loot: l })}
                    style={{ background: dropMode ? '#1a0e08' : '#0a1a14', border: `1px solid ${dropMode ? '#cc7755' : '#2a5544'}`, color: '#bfe6cc', padding: '6px 10px', cursor: dropMode ? 'pointer' : 'default', fontFamily: 'monospace', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {l.img ? <img src={l.img} alt="" style={{ width: 16, height: 16, objectFit: 'contain' }} /> : l.emoji} {l.label}{(l.qty || 1) > 1 ? `×${l.qty}` : ''}
                  </button>
                ))}
                {empty && <span style={{ color: '#445566', fontSize: 11 }}>（戦利品なし。食料・翼はスキル横から使えます）</span>}
              </div>
              {lootBag.length > 0 && <div style={{ color: '#557766', fontSize: 10, marginTop: 6 }}>※戦利品は生きて帰ると全部入手（やられるとランダムで半分失う）</div>}
            </div>
          )
        })()}
        {status === 'exploring' && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <button onClick={giveUp}
              style={{ background: '#1a0808', border: '1px solid #aa4444', color: '#cc6666', padding: '6px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>
              🏳 あきらめる
            </button>
            {/* 開発アカウント用フロアワープ */}
            {isAdmin && dungeon && [29, 30].filter((f) => f <= (dungeon.floors || 10)).map((f) => (
              <button key={f} onClick={() => { if (busyRef.current) return; setFloorNum(f); enterFloor(f, dungeon); floorsRef.current = Math.max(floorsRef.current, f - 1); addLog(`🛠 ${f}Fへワープ（開発）`) }}
                style={{ background: '#0a1424', border: '1px solid #335588', color: '#88aacc', padding: '6px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>🛠 {f}F</button>
            ))}
          </div>
        )}
        {status === 'cleared' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#ffcc44' }}>🏁 ダンジョンクリア！<RewardPanel reward={reward} pet={pet} /><Btn onClick={restart}>もう一度</Btn> <Btn onClick={backToSelect}>ダンジョン選択</Btn> <Btn onClick={() => nav('/pets')}>🐾 ペット</Btn> <Btn onClick={leaveToTown}>街に戻る</Btn></div>
        )}
        {status === 'dead' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#ff5555' }}>💀 ペットは力尽きた…（なつき-3）<br /><span style={{ fontSize: 11, color: '#cc8888' }}>戦利品のランダム半分を失った…残りは持ち帰った</span><RewardPanel reward={reward} pet={pet} /><Btn onClick={restart}>再挑戦</Btn> <Btn onClick={backToSelect}>ダンジョン選択</Btn> <Btn onClick={() => nav('/pets')}>🐾 ペット</Btn> <Btn onClick={leaveToTown}>街に戻る</Btn></div>
        )}
        {status === 'escaped' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#cc88ff' }}>🪽 ダンジョンから脱出した<RewardPanel reward={reward} pet={pet} /><Btn onClick={restart}>もう一度</Btn> <Btn onClick={backToSelect}>ダンジョン選択</Btn> <Btn onClick={() => nav('/pets')}>🐾 ペット</Btn> <Btn onClick={leaveToTown}>街に戻る</Btn></div>
        )}


        {/* ⚔ 簡易出撃（カジノと同じ・自キャラを並行して育成できる）。エリア選択はここを開いて行う */}
        <SortiePanel quickSlotId="bf-sortie-quick" collapsible activitySignal={floorNum} />
        </div>

      </div>
    </div>
  )
}

// ログ表示（見出し＋スクロール枠）。スマホ＝下部／PC＝右カラムで共用
function LogView({ log, height }) {
  return (
    <>
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '0 2px 4px', borderBottom: '1px solid #113355' }}>
        <span style={{ color: '#5588bb' }}>◀ 自分のログ</span>
        <span style={{ color: '#cc8888' }}>敵のログ ▶</span>
      </div>
      <div style={{ background: '#000610', border: '1px solid #113355', borderTop: 'none', padding: 8, height, overflowY: 'auto', fontSize: 11 }}>
        {log.length === 0 ? <span style={{ color: '#335577' }}>隣のマスをクリック、または矢印で移動。部屋に入ると視界が開ける。👹に触れると戦闘、▼で次の階へ。</span>
          : log.map((l, i) => <div key={i} style={{ color: i === 0 ? '#aaddff' : l.side === 'right' ? '#cc8888' : '#5588bb', textAlign: l.side === 'right' ? 'right' : 'left' }}>{l.icon && <img src={l.icon} alt="" style={{ width: 13, height: 13, objectFit: 'contain', verticalAlign: 'middle', marginRight: 3 }} />}{l.msg}</div>)}
      </div>
    </>
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
// 十字キー用：44×44の正方形で記号を中央寄せ（字形差で大きさがバラつかないよう固定）
// 押した瞬間に少し光らせて「どこを押したか」分かるようにする
function PadBtn({ children, onClick }) {
  const [pressed, setPressed] = useState(false)
  const hold = () => { setPressed(true); setTimeout(() => setPressed(false), 180) }
  return (
    <button onPointerDown={hold} onClick={onClick}
      style={{ width: 44, height: 44, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
        background: pressed ? '#0a3b6e' : '#001840', border: `1px solid ${pressed ? '#33bbff' : '#0088ff'}`, color: pressed ? '#bfe6ff' : '#0088ff',
        transform: pressed ? 'scale(0.92)' : 'none', transition: 'background 0.05s, transform 0.05s',
        cursor: 'pointer', fontFamily: 'monospace', fontSize: 16 }}>{children}</button>
  )
}
