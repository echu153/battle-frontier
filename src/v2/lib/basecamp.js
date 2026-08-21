// ============================================================
// バトルフロンティアⅡ（リメイク版）— 拠点
// ------------------------------------------------------------
// 設計は docs/v2-kyoten-design.md。
//
//   ルーン素材を資材に交換 → 労働者をGoldで雇う → 放置で資材が貯まる
//                          → 施設を拡張（グレード1〜9）→ かかしのEXPが増える
//
// ★**権威はサーバー**（supabase_v2_core.sql の §11）。このファイルは
//   「画面の表示」と「テストで仕様を固定する」ためのもの。
//   **数式を変えるときは必ず両方を直すこと**（basecamp.test.js が並びを固定してある）。
//
// ★釣り場は第2段階。ここには施設の枠だけ用意してあり、レートはまだ入れていない。
// ============================================================
import { MATERIAL_BY_ID } from './material.js'
import { fishPerHour } from './fishing.js'

// ===== 資材 =====
// ⚠ゲーム内の「素材」はルーン素材（material.js）を指す。拠点のものは必ず「資材」と呼ぶ
export const MATERIAL_KINDS = [
  { key: 'wood',  name: '木材', color: '#c69a5c' },
  { key: 'stone', name: '石材', color: '#a8c4d6' },
  { key: 'mana',  name: '魔石', color: '#b988ff' },
]
export const KIND_BY_KEY = Object.fromEntries(MATERIAL_KINDS.map(k => [k.key, k]))
export const KIND_KEYS = MATERIAL_KINDS.map(k => k.key)

// グレードは1〜9。表記はローマ数字（エリアの丸数字 ①〜⑧ と見分けが付くように）
export const GRADE_MAX = 9
export const ROMAN = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ']
export const gradeLabel = (grade) => ROMAN[grade] || String(grade)
export const materialName = (kind, grade) => `${KIND_BY_KEY[kind]?.name || kind}${gradeLabel(grade)}`

// ===== 施設 =====
// ⚠アイコンは古くから在る絵文字だけを使う（新しいものは環境によって豆腐□になる）
export const FACILITIES = [
  { key: 'lumber',    name: '伐採所', icon: '🌲', color: '#c69a5c', produces: 'wood',  hasWorkers: true },
  { key: 'quarry',    name: '採掘場', icon: '⛏', color: '#a8c4d6', produces: 'stone', hasWorkers: true },
  { key: 'manaforge', name: '魔石炉', icon: '🔮', color: '#b988ff', produces: 'mana',  hasWorkers: true },
  { key: 'scarecrow', name: 'かかし', icon: '🎯', color: '#44ff88', produces: null,    hasWorkers: false },
  { key: 'fishing',   name: '釣り場', icon: '🎣', color: '#66ccff', produces: null,    hasWorkers: false },
]
export const FACILITY_BY_KEY = Object.fromEntries(FACILITIES.map(f => [f.key, f]))
export const PRODUCERS = FACILITIES.filter(f => f.hasWorkers)

// ===== 蓄積 =====
// 全施設そろえて8時間で満杯（ユーザー決定。ばらけていると回収の段取りを覚えられない）
export const CAP_HOURS = 8
// 生産施設の産出。**グレードでは増えない**。上がるのは「出る資材のグレード」だけ
export const PRODUCE_PER_HOUR = 30

// ===== かかし =====
// ユーザー決定：グレード1で8時間300EXP、グレード9で8時間1200EXP
export const SCARECROW_8H = [300, 400, 500, 600, 700, 800, 900, 1000, 1200]
export const scarecrowPerHour = (grade) => (SCARECROW_8H[grade - 1] || 0) / CAP_HOURS

// ===== 労働者 =====
export const WORKER_MAX = 9                                   // 拠点全体
export const workerLimitOf = (grade) => (grade <= 3 ? 1 : grade <= 6 ? 2 : 3)
// 何人目かで上がる（拠点全体の通し）。9人ぜんぶ雇うと合計およそ2,700万G
export const HIRE_COST = [10000, 30000, 80000, 200000, 500000, 1200000, 3000000, 7000000, 15000000]
export const hireCostOf = (hired) => (hired >= 0 && hired < HIRE_COST.length ? HIRE_COST[hired] : null)
// ★労働者は**買いきり**（2026-08-17 ユーザー決定）。維持費は無い。
//   ＝生産が止まるのは「満杯になったとき」だけになった

// ===== レートと上限 =====
export const rateOf = (key, grade, workers) => {
  if (key === 'scarecrow') return scarecrowPerHour(grade)
  if (key === 'fishing') return fishPerHour(grade)
  return FACILITY_BY_KEY[key]?.hasWorkers ? PRODUCE_PER_HOUR * Math.max(0, workers) : 0
}
export const capOf = (key, grade, workers) => rateOf(key, grade, workers) * CAP_HOURS

// ===== 拡張 =====
// グレードNへ上げるのに必要な「グレード(N-1)の資材」3種の各個数とGold
export const UPGRADE_COST = {
  2: { qty:   50, gold:       5000 },
  3: { qty:   80, gold:      20000 },
  4: { qty:  130, gold:      60000 },
  5: { qty:  200, gold:     150000 },
  6: { qty:  320, gold:     400000 },
  7: { qty:  500, gold:    1000000 },
  8: { qty:  800, gold:    2500000 },
  9: { qty: 1300, gold:    6000000 },
}
export const upgradeCostOf = (grade) => UPGRADE_COST[grade + 1] || null
// グレード③以降は**エリアボスの討伐**が条件（ユーザー決定）。
// 判定は「難易度帯Nのエリアが解放されている」で、代表としてエリアIDのNを見る
// （id 1〜8 は各帯の最初のエリア＝その帯が開けば必ず入っている・enemies.js の tier）。
// ⚠④以降は帯を全部踏破しないと次が開かないので、条件は前より重い
export const reqAreaOf = (grade) => (grade >= 3 ? grade - 1 : 0)
export const upgradeBlockOf = (grade, unlockedAreas) => {
  if (grade >= GRADE_MAX) return '最大グレードです'
  const need = reqAreaOf(grade + 1)
  if (need > 0 && !(unlockedAreas || []).includes(need)) return `エリア${'①②③④⑤⑥⑦⑧'[need - 1]}の解放が必要です`
  return null
}

// ===== ルーン素材 → 資材 =====
// **難易度帯**Nの素材がグレードNの資材になる（④の帯ならどのエリアの素材でもグレード4）。
// 比率（1:4:20）は売却と同じにしてあるので、「売る」と「資材にする」がきれいに天秤に乗る。
// ⚠グレードは m.area（エリアID）ではなく **m.tier**。サーバー（v2_base_exchange）も同じ
export const EXCHANGE_RATE = { normal: 3, rare: 12, ultra: 60 }
// [{ id, qty }] → { グレード: 個数 }。持っている数を超えていないかは呼び出し側とサーバーが見る
export const exchangeGainOf = (items) => {
  const out = {}
  for (const it of items || []) {
    const m = MATERIAL_BY_ID[it?.id]
    const qty = Math.max(0, Math.floor(it?.qty || 0))
    if (!m || !qty) continue
    out[m.tier] = (out[m.tier] || 0) + EXCHANGE_RATE[m.rarity] * qty
  }
  return out
}
export const exchangeTotalOf = (items) =>
  Object.values(exchangeGainOf(items)).reduce((a, b) => a + b, 0)

// ===== 資材 → Gold =====
// ★**グレードに関係なく全部売れる**（2026-08-17 ユーザー決定）。
//   これがないと、最終グレードの施設が出す資材（木材Ⅸなど）に使い道が無くなる。
// ⚠**Goldの2本目の湧き口**。目安は「グレードNの資材3個 ≒ エリアNの通常素材1個」の
//   売値のおよそ1/4。**サーバーにも同じ表がある**（v2_base_material_sell）
export const MATERIAL_SELL = [3, 7, 15, 25, 40, 60, 100, 200, 320]
export const sellPriceOf = (grade) => MATERIAL_SELL[grade - 1] || 0
// [{ kind, grade, qty }] の合計。持っている数を超えていないかは呼び出し側とサーバーが見る
export const sellTotalOf = (items) =>
  (items || []).reduce((t, it) => t + sellPriceOf(it?.grade) * Math.max(0, Math.floor(it?.qty || 0)), 0)

// ===== 表示用の見込み =====
// ⚠**確定させるのはサーバー**（v2_base_settle）。ここは画面のカウンタを進めるためだけに使う。
//   SQL側と同じ式にしてあるので、片方を直したらもう片方も直すこと。
//
//   生産していた時間 = LEAST(経過時間, 満杯までの時間)
//   ★維持費が無くなったので、Goldは見込みに関係しなくなった
export const previewOf = (f, at = new Date()) => {
  const rate = Number(f?.rate || 0)
  const cap = Number(f?.cap || 0)
  const pending = Number(f?.pending || 0)
  const elapsedH = Math.max(0, (at.getTime() - new Date(f?.accrued_from || at).getTime()) / 3600000)
  const roomH = rate > 0 ? Math.max(0, (cap - pending) / rate) : 0
  const workH = Math.min(elapsedH, roomH)
  return {
    pending: Math.min(cap, pending + rate * workH),
    // ⚠**動いていない施設を「満杯」にしない。** 労働者がいないと rate も cap も0で
    //   「残り0時間」になるため、素直に書くと労働者0の伐採所が「満杯です」と出る
    full: rate > 0 && (roomH <= 0 || workH >= roomH - 1e-9),
  }
}

// 「あと何分で満杯か」。満杯・生産していないときは null
export const fullInOf = (f, at = new Date()) => {
  const rate = Number(f?.rate || 0)
  if (rate <= 0) return null
  const p = previewOf(f, at)
  if (p.full) return null
  return ((Number(f.cap) - p.pending) / rate) * 60
}
