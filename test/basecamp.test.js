import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ============================================================
// 拠点（Basecamp）v1 の仕様固定テスト
//
//   ローカルに Postgres が無いので SQL は実行できない。代わりに
//   supabase_kyoten_20260728.sql を「テキストとして読んで契約どおりの数値・キー・
//   権限になっているか」を検証する（test/raidSchedule.test.js と同じ流儀）。
//
//   ここが落ちたら「実装が契約から外れた」か「契約を変えたのにテストを直していない」
//   のどちらか。数値を変えるときは必ずこのファイルも一緒に直すこと。
// ============================================================

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SQL_PATH = join(repoRoot, 'supabase_kyoten_20260728.sql')
const LIB_PATH = join(repoRoot, 'src/lib/basecamp.js')

// ─────────────────────────────────────────────
// 契約（docs/kyoten-design.md ＋ 実装契約）。この定数群が「正」。
// ─────────────────────────────────────────────
const MATERIALS = ['wood', 'stone', 'herb', 'mana']
const APTS = ['chop', 'mine', 'gather', 'water']
const FACILITIES = ['lumber', 'quarry', 'herbfield', 'manaspring', 'warehouse']
const PRODUCERS = ['lumber', 'quarry', 'herbfield', 'manaspring']   // 倉庫以外＝産出する施設

const BASE_RATE = { lumber: 20, quarry: 20, herbfield: 12, manaspring: 6, warehouse: 0 }
const FACILITY_MATERIAL = { lumber: 'wood', quarry: 'stone', herbfield: 'herb', manaspring: 'mana', warehouse: null }
const SLOT_COUNT = { lumber: 1, quarry: 1, herbfield: 2, manaspring: 1, warehouse: 0 }
// slot1 に要る適性（薬草畑だけ slot2＝水やり を持つ）
const SLOT1_APT = { lumber: 'chop', quarry: 'mine', herbfield: 'gather', manaspring: 'gather' }

const APT_MULT = { 1: 1.0, 2: 1.5, 3: 2.2 }           // 適性0は配置不可
const WATER_MULT = { 0: 0.5, 1: 1.0, 2: 1.2, 3: 1.4 } // 0 = slot2 未配置
const LV_BONUS = { 1: 1.0, 2: 1.0, 3: 1.0, 4: 1.1, 5: 1.2 }
const WORKER_CAP = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 }
const UNLOCKED_AT = { lumber: 1, quarry: 1, herbfield: 2, manaspring: 3, warehouse: 5 }
const MAX_LV = 5
const STORAGE_HOURS = 12
const WAREHOUSE_MULT = 1.5
const WORKER_LIMIT = 10

const UPGRADE_COST = {
  2: { wood: 100,  stone: 60,   herb: 0,   mana: 0,   gold: 5000 },
  3: { wood: 300,  stone: 200,  herb: 0,   mana: 0,   gold: 20000 },
  4: { wood: 800,  stone: 600,  herb: 100, mana: 0,   gold: 60000 },
  5: { wood: 2000, stone: 1500, herb: 300, mana: 100, gold: 150000 },
}

const SPECIES = {
  slime:      { chop: 0, mine: 0, gather: 2, water: 3 },
  touzoku:    { chop: 1, mine: 2, gather: 2, water: 0 },
  yeti:       { chop: 3, mine: 1, gather: 0, water: 0 },
  yukionna:   { chop: 0, mine: 0, gather: 3, water: 2 },
  lavagolem:  { chop: 1, mine: 3, gather: 0, water: 0 },
  magmaslime: { chop: 0, mine: 2, gather: 3, water: 0 },
}

// v1 で拠点LVアップ時に加入する仲間。lavagolem / magmaslime は v2 の証ドロップ専用＝加入しない
const JOIN_AT_LV = { 2: 'touzoku', 3: 'yeti', 4: 'yukionna' }
const V2_ONLY = ['lavagolem', 'magmaslime']

// authenticated に公開してよい RPC はこれだけ。これ以外に GRANT が付いたら落とす。
const PUBLIC_RPCS = ['base_init', 'base_get', 'base_assign', 'base_collect', 'base_upgrade', 'base_dev_reset']
// 設計書にはあるが v1 契約では必須ではない（実装されていれば公開してよい）
const OPTIONAL_RPCS = ['base_rename_worker']

// ─────────────────────────────────────────────
// 産出式の参照実装（JS）
//
//   ※ これは「仕様の固定」であって画面では使わない。クライアントは base_get() の
//     返り値をそのまま表示する契約（レイドの出現予定をクライアントで再計算して
//     予告と実出現が食い違った事故と同じ根を、最初から作らないため）。
//     SQL を実行できない環境で数値契約を凍結するためだけに、ここに式を写している。
//     SQL 側の式を変えたら、この参照実装も必ず同時に直すこと。
// ─────────────────────────────────────────────

/** 施設の毎時産出。slot1 が空 or 適性0 なら 0 */
function ratePerHour({ facility, lv, slot1 = null, slot2 = null }) {
  if (BASE_RATE[facility] === 0) return 0                // 倉庫は産出なし
  if (lv < UNLOCKED_AT[facility]) return 0               // 未解放
  if (!slot1) return 0                                   // slot1 が空なら（slot2 が埋まっていても）0
  const apt = SPECIES[slot1][SLOT1_APT[facility]]
  if (apt === 0) return 0                                // 適性なし＝配置不可
  let r = BASE_RATE[facility] * APT_MULT[apt]
  if (facility === 'herbfield') {
    r *= WATER_MULT[slot2 ? SPECIES[slot2].water : 0]
  }
  return r * LV_BONUS[lv]
}

/** 保管上限 = レート × 12時間 ×（倉庫解放済み＝拠点LV5なら 1.5）。rate=0 なら 0 */
function storageCap({ facility, lv, slot1 = null, slot2 = null }) {
  const rate = ratePerHour({ facility, lv, slot1, slot2 })
  if (rate === 0) return 0
  return rate * STORAGE_HOURS * (lv >= UNLOCKED_AT.warehouse ? WAREHOUSE_MULT : 1.0)
}

/**
 * 精算。pending と accrued_from だけが権威（ハートビートは使わない＝閉じても進む）。
 *   ★素の LEAST(cap, ...) ではなく GREATEST(現在値, ...) で挟む。
 *     仲間を外して rate=0 → cap=0 になった時に、素の LEAST だと貯まっていた
 *     pending が丸ごと消える。「上限を超えて増えない」だけにして、既に貯まった
 *     ぶんは回収するまで絶対に減らさない。
 */
// 戻り: { pending, spilled }。spilled は cap を超えていて自動回収された量（資材へ移る）。
//   capが下がったとき(仲間を外す等)に
//     ・素の LEAST(cap,…)      → 貯まっていたぶんが消える
//     ・GREATEST(現在値, …)    → pending>cap の間ずっと産出が止まる（凍結）
//   のどちらの事故も起こさないため、超過ぶんは先に資材へ吐き出してから加算する。
function settle({ pending, rate, cap, hours }) {
  let spilled = 0
  if (pending > cap) {
    spilled = Math.floor(pending - cap)
    pending -= spilled
  }
  return { pending: Math.min(cap, pending + rate * Math.max(0, hours)), spilled }
}

/** その仲間をその枠に置けるか（枠が存在し、必要適性が1以上か） */
function canAssign({ facility, slot, species }) {
  const apt = slot === 1 ? SLOT1_APT[facility] : (facility === 'herbfield' && slot === 2 ? 'water' : null)
  if (!apt) return false                                  // 存在しない枠（倉庫・薬草畑以外のslot2）
  return SPECIES[species][apt] >= 1
}

const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} ≠ ${expected}`)

// ─────────────────────────────────────────────
// SQL / JS をテキストとして読むための道具
// ─────────────────────────────────────────────

/** SQLコメントを剥がす。ヘッダに「apply_battle_result は触らない」と書いてあるだけで
 *  禁止事項テストが落ちるのを防ぐため、禁止語チェックは必ずこの結果に対して行う。 */
const stripSqlComments = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

/** 数値リテラルが「単語として」出るか（20 と 2.0 や 200 を取り違えない） */
const numRe = v => new RegExp(`(?<![\\w.])${String(v).replace('.', '\\.')}(?![\\w.])`)

const sqlExists = existsSync(SQL_PATH)
const rawSql = sqlExists ? readFileSync(SQL_PATH, 'utf8') : ''
const sql = stripSqlComments(rawSql)
const requireSql = () =>
  assert.ok(sqlExists, `supabase_kyoten_20260728.sql が無い（拠点のSQLは ${SQL_PATH} に置く契約）`)

const libExists = existsSync(LIB_PATH)
const rawLib = libExists ? readFileSync(LIB_PATH, 'utf8') : ''
const requireLib = () =>
  assert.ok(libExists, `src/lib/basecamp.js が無い（拠点のキー定義は ${LIB_PATH} に置く契約）`)

/** 関数定義の本体を丸ごと取り出す（末尾は行頭の `$$;`）。数値の正はこの関数たち。 */
function fnBody(name) {
  requireSql()
  const m = sql.match(new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${name}\\s*\\([\\s\\S]*?\\n\\$\\$;`, 'i'))
  assert.ok(m, `SQL に関数 ${name} が無い（拠点の数値・判定はこの関数が唯一の正）`)
  return m[0]
}

/** 本体に pattern があること */
function fnHas(name, pattern, why) {
  const body = fnBody(name)
  assert.ok(pattern.test(body), `${name}: ${why}\n  期待するパターン: ${pattern}`)
}

/**
 * species の適性4値を、書き方に依らず読み取る。
 *   (a) 適性キー名つき : WHEN 'chop' THEN 1 ... / { chop: 1, mine: 2, ... }
 *   (b) 位置指定       : ('slime', 0, 0, 2, 3)
 * 出現箇所ごとに候補を集め、「どこかに契約どおりの定義がある」ことを確かめる。
 */
function aptCandidates(text, anchor) {
  const out = []
  for (let i = text.indexOf(anchor); i !== -1; i = text.indexOf(anchor, i + 1)) {
    const win = text.slice(i + anchor.length, i + anchor.length + 400)
    const named = {}
    for (const k of APTS) {
      const m = win.match(new RegExp(`${k}[^0-9]{0,24}?([0-3])(?![\\w.])`))
      if (m) named[k] = Number(m[1])
    }
    if (APTS.every(k => k in named)) { out.push(named); continue }
    const nums = [...win.matchAll(/(?<![\w.])([0-3])(?![\w.])/g)].map(m => Number(m[1]))
    if (nums.length >= 4) out.push(Object.fromEntries(APTS.map((k, n) => [k, nums[n]])))
  }
  return out
}

const sameApt = (a, b) => APTS.every(k => a[k] === b[k])

// ============================================================
// 1. SQL が契約どおりの数値を持っている
// ============================================================

test('SQL: 施設の基礎レートが 伐採所20 / 採石場20 / 薬草畑12 / 魔力泉6・倉庫は産出なし', () => {
  for (const f of PRODUCERS) {
    fnHas('base_facility_base_rate', new RegExp(`'${f}'\\s*THEN\\s*${BASE_RATE[f]}(?![\\w.])`),
      `${f} の基礎レートが ${BASE_RATE[f]} になっていない`)
  }
  fnHas('base_facility_base_rate', /ELSE\s+0\s*END/i, '倉庫・不明キーが産出0になっていない')
  // 20 と 12 と 6 の取り違え（伐採所と薬草畑を入れ替える等）を潰す
  const body = fnBody('base_facility_base_rate')
  assert.ok(!/'warehouse'\s*THEN\s*[1-9]/.test(body), '倉庫に基礎レートが付いている（倉庫は保管上限だけ）')
})

test('SQL: 施設と産出資材の対応（伐採所→木材 / 採石場→石材 / 薬草畑→薬草 / 魔力泉→魔力の欠片）', () => {
  for (const f of PRODUCERS) {
    fnHas('base_facility_material', new RegExp(`'${f}'\\s*THEN\\s*'${FACILITY_MATERIAL[f]}'`),
      `${f} の産出資材が ${FACILITY_MATERIAL[f]} になっていない（別の資材が出ると経済が壊れる）`)
  }
  fnHas('base_facility_material', /ELSE\s+NULL\s*END/i, '倉庫の産出資材が NULL になっていない')
})

test('SQL: 適性倍率が 適性1→1.0 / 適性2→1.5 / 適性3→2.2、適性0は産出0', () => {
  for (const [lv, mult] of Object.entries(APT_MULT)) {
    fnHas('base_apt_mult', new RegExp(`WHEN\\s+${lv}\\s+THEN\\s+${String(mult).includes('.') ? String(mult).replace('.', '\\.') : `${mult}(\\.0)?`}(?![\\w.])`),
      `適性${lv} の倍率が ${mult} になっていない`)
  }
  fnHas('base_apt_mult', /ELSE\s+0(\.0)?\s*END/i,
    '適性0（＝配置不可）が倍率0になっていない。万一DBに入り込んだ時に産出させないための保険')
})

test('SQL: 水やり係数が 未配置0.5 / 適性1→1.0 / 適性2→1.2 / 適性3→1.4', () => {
  fnHas('base_water_mult', /WHEN\s+1\s+THEN\s+1(\.0)?(?![\w.])/, '水やり適性1が 1.0 になっていない')
  fnHas('base_water_mult', /WHEN\s+2\s+THEN\s+1\.2(?![\w.])/, '水やり適性2が 1.2 になっていない')
  fnHas('base_water_mult', /WHEN\s+3\s+THEN\s+1\.4(?![\w.])/, '水やり適性3が 1.4 になっていない')
  fnHas('base_water_mult', /ELSE\s+0\.5(?![\w.])/, '水やり枠が空のときの係数が 0.5 になっていない')
})

test('SQL: 拠点LVボーナスが LV1〜3=1.0 / LV4=1.1 / LV5=1.2', () => {
  fnHas('base_lv_bonus', />=\s*5\s+THEN\s+1\.2(?![\w.])/, 'LV5 のボーナスが 1.2 になっていない')
  fnHas('base_lv_bonus', /=\s*4\s+THEN\s+1\.1(?![\w.])/, 'LV4 のボーナスが 1.1 になっていない')
  fnHas('base_lv_bonus', /ELSE\s+1(\.0)?\s*END/i, 'LV1〜3 のボーナスが 1.0 になっていない')
  const body = fnBody('base_lv_bonus')
  assert.ok(!/1\.3|1\.4|1\.5/.test(body), '拠点LVボーナスに契約外の倍率がある（最大は LV5 の 1.2）')
})

test('SQL: 配置上限が LV1〜5 で 2/3/4/5/6、最大LVは5、仲間の所持上限は10体', () => {
  for (const lv of [1, 2, 3, 4]) {
    fnHas('base_worker_cap', new RegExp(`WHEN\\s+${lv}\\s+THEN\\s+${WORKER_CAP[lv]}(?![\\w.])`),
      `LV${lv} の配置上限が ${WORKER_CAP[lv]} になっていない`)
  }
  fnHas('base_worker_cap', /ELSE\s+6\s*END/i, 'LV5 の配置上限が 6 になっていない')
  fnHas('base_upgrade', new RegExp(`v_lv\\s*>=\\s*${MAX_LV}`), `最大LV ${MAX_LV} で強化が止まらない`)
  fnHas('base_join_worker', new RegExp(`>=\\s*${WORKER_LIMIT}`), `仲間の所持上限 ${WORKER_LIMIT} 体が効いていない`)
  assert.ok(new RegExp(`'max_lv',\\s*${MAX_LV}`).test(fnBody('base_get')),
    `base_get が max_lv:${MAX_LV} を返していない`)
})

test('SQL: 保管上限が「レート × 12時間 ×（倉庫あり1.5）」', () => {
  fnHas('base_cap', new RegExp(`\\*\\s*${STORAGE_HOURS}(?![\\w.])`), `保管上限の ${STORAGE_HOURS} 時間が無い`)
  fnHas('base_cap', new RegExp(`${String(WAREHOUSE_MULT).replace('.', '\\.')}(?![\\w.])`),
    `倉庫の保管上限 ×${WAREHOUSE_MULT} が無い`)
  fnHas('base_cap', /base_facility_unlocked\(\s*v_lv\s*,\s*'warehouse'\s*\)/,
    '倉庫ボーナスが「倉庫の解放」で判定されていない')
  fnHas('base_cap', /v_rate\s*<=\s*0\s+THEN\s+RETURN\s+0/i,
    'レート0のときに上限が0になっていない（空の施設に保管上限だけ付く）')
})

test('SQL: 強化コスト4段（LV2〜LV5）が契約どおり', () => {
  for (const [lv, c] of Object.entries(UPGRADE_COST)) {
    const row = new RegExp(
      `'lv'\\s*,\\s*${lv}\\s*,\\s*'wood'\\s*,\\s*${c.wood}\\s*,\\s*'stone'\\s*,\\s*${c.stone}\\s*,` +
      `\\s*'herb'\\s*,\\s*${c.herb}\\s*,\\s*'mana'\\s*,\\s*${c.mana}\\s*,\\s*'gold'\\s*,\\s*${c.gold}(?![\\w.])`)
    fnHas('base_next_cost', row,
      `LV${lv} の強化コストが 木${c.wood}/石${c.stone}/薬${c.herb}/魔${c.mana}/${c.gold}G になっていない`)
  }
  fnHas('base_next_cost', /ELSE\s+NULL/i, '最大LVで next_cost が NULL になっていない')
})

test('SQL: 施設の解放LVが 伐採所/採石場=1・薬草畑=2・魔力泉=3・倉庫=5', () => {
  // 解放LVの正は base_facility_unlock_lv ただ1つ（UIの「拠点LV◯で解放」もこれを表示する）。
  // base_facility_unlocked はそこから導出するだけで、自前の表を持たないこと。
  for (const [f, lv] of Object.entries(UNLOCKED_AT)) {
    fnHas('base_facility_unlock_lv', new RegExp(`'${f}'\\s*THEN\\s*${lv}(?![\\w.])`),
      `${f} の解放LVが ${lv} になっていない`)
  }
  fnHas('base_facility_unlock_lv', /ELSE\s+NULL/i, '不明な施設キーに解放LVが付いている')
  fnHas('base_facility_unlocked', /base_facility_unlock_lv\s*\(/,
    'base_facility_unlocked が解放LVの表を二重に持っている（unlock_lv から導出すること）')
})

test('SQL: 施設の枠と必要適性（薬草畑だけ2枠・slot2=水やり / 倉庫は0枠）', () => {
  for (const [f, apt] of Object.entries(SLOT1_APT)) {
    fnHas('base_slot_apt', new RegExp(`'${f}'\\s*AND\\s*p_slot\\s*=\\s*1\\s*THEN\\s*'${apt}'`),
      `${f} の slot1 が要求する適性が ${apt} になっていない`)
  }
  fnHas('base_slot_apt', /'herbfield'\s*AND\s*p_slot\s*=\s*2\s*THEN\s*'water'/,
    '薬草畑の slot2 が水やりになっていない')
  fnHas('base_slot_apt', /ELSE\s+NULL/i, '存在しない枠が NULL（＝配置不可）になっていない')
  fnHas('base_slot_count', /'herbfield'\s*THEN\s*2(?![\w.])/, '薬草畑が2枠になっていない')
  for (const f of ['lumber', 'quarry', 'manaspring']) {
    fnHas('base_slot_count', new RegExp(`'${f}'\\s*THEN\\s*1(?![\\w.])`), `${f} が1枠になっていない`)
  }
  fnHas('base_slot_count', /ELSE\s+0\s*END/i, '倉庫が0枠（配置不要）になっていない')
})

test('SQL: 産出式が 基礎 × 適性倍率 × 拠点LVボーナス、薬草畑だけ水やり係数を掛ける', () => {
  const body = fnBody('base_rate')
  assert.ok(/base_apt_mult\(\s*base_apt\(/.test(body), 'base_rate が適性倍率を掛けていない')
  assert.ok(/base_lv_bonus\(\s*v_lv\s*\)/.test(body), 'base_rate が拠点LVボーナスを掛けていない')
  assert.ok(/p_key\s*=\s*'herbfield'[\s\S]*base_water_mult\(/.test(body),
    '水やり係数が薬草畑限定で掛かっていない')
  assert.ok(/slot\s*=\s*1[\s\S]*?v_s1\s+IS\s+NULL\s+THEN\s+RETURN\s+0/i.test(body),
    'slot1（主役）が空のときに 0 を返していない（薬草畑は slot2 だけ埋めても産出0の契約）')
  assert.ok(/NOT\s+base_facility_unlocked\([\s\S]{0,40}THEN\s+RETURN\s+0/i.test(body),
    '未解放の施設が産出0になっていない')
})

test('SQL: 拠点LVアップで加入する仲間が LV2=盗賊 / LV3=雪男 / LV4=雪女', () => {
  const body = fnBody('base_upgrade')
  for (const [lv, sp] of Object.entries(JOIN_AT_LV)) {
    assert.ok(new RegExp(`v_lv\\s*=\\s*${lv}\\s+THEN\\s+v_joined\\s*:=\\s*'${sp}'`).test(body),
      `LV${lv} で ${sp} が加入しない`)
  }
  for (const sp of V2_ONLY) {
    assert.ok(!body.includes(sp),
      `${sp} が base_upgrade に出てくる（v2 の証ドロップ専用で、v1 では加入しない契約）`)
  }
  // 開始時の確定配布はスライム1体
  assert.ok(/base_join_worker\(\s*v_uid\s*,\s*'slime'\s*\)/.test(fnBody('base_init')),
    'base_init が開始時にスライムを配っていない')
})

// ============================================================
// 2. 6種族 × 4適性が契約表と一致する
// ============================================================

test('SQL: 6種族すべての適性値が契約表と一致する', () => {
  requireSql()
  for (const [sp, want] of Object.entries(SPECIES)) {
    assert.ok(sql.includes(`'${sp}'`), `SQL に種族 ${sp} が無い`)
    const cands = aptCandidates(sql, `'${sp}'`)
    assert.ok(cands.some(c => sameApt(c, want)),
      `${sp} の適性が契約と違う。期待 ${JSON.stringify(want)} / SQLから読めた候補 ${JSON.stringify(cands)}`)
  }
  fnHas('base_apt', /ELSE\s+0\s*END/i, '未知の種族が適性0（＝配置不可）になっていない')
})

test('SQL: 種族の既定表示名が UI（src/lib/basecamp.js）と揃っている', () => {
  for (const [sp, name] of Object.entries({
    slime: 'スライム', touzoku: '盗賊', yeti: '雪男',
    yukionna: '雪女', lavagolem: '溶岩ゴーレム', magmaslime: 'マグマスライム',
  })) {
    fnHas('base_species_name', new RegExp(`'${sp}'\\s*THEN\\s*'${name}'`),
      `${sp} の既定表示名が「${name}」になっていない`)
  }
})

test('種族の適性: 契約表そのものの健全性（配置先が無い種族がいない・上限3）', () => {
  for (const [sp, apt] of Object.entries(SPECIES)) {
    for (const k of APTS) {
      assert.ok(k in apt, `${sp} に適性 ${k} が無い`)
      assert.ok(apt[k] >= 0 && apt[k] <= 3, `${sp}.${k} が範囲外（${apt[k]}）`)
    }
    assert.ok(APTS.some(k => apt[k] >= 1), `${sp} はどこにも配置できない（全適性0）`)
  }
  // 契約表の直値を凍結（表を書き換えたらここも直す）
  assert.deepEqual(SPECIES.slime, { chop: 0, mine: 0, gather: 2, water: 3 })
  assert.deepEqual(SPECIES.touzoku, { chop: 1, mine: 2, gather: 2, water: 0 })
  assert.deepEqual(SPECIES.yeti, { chop: 3, mine: 1, gather: 0, water: 0 })
  assert.deepEqual(SPECIES.yukionna, { chop: 0, mine: 0, gather: 3, water: 2 })
  assert.deepEqual(SPECIES.lavagolem, { chop: 1, mine: 3, gather: 0, water: 0 })
  assert.deepEqual(SPECIES.magmaslime, { chop: 0, mine: 2, gather: 3, water: 0 })
})

// ============================================================
// 3. セキュリティ（サーバー権威を迂回されない）
// ============================================================

test('SQL: SECURITY DEFINER の内部ヘルパが REVOKE ... FROM PUBLIC されている', () => {
  requireSql()
  const defined = [...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)]
    .map(m => m[1].toLowerCase())
  assert.ok(defined.length > 0, 'SQL に関数定義が1つも無い')
  // ★「FROM PUBLIC」まで見る。DOブロック内の
  //   EXECUTE 'REVOKE ... FROM anon, authenticated' だけでは PUBLIC の EXECUTE は剥がれない
  const revoked = new Set([...sql.matchAll(
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\([^)]*\)\s*FROM\s+PUBLIC/gi)]
    .map(m => m[1].toLowerCase()))

  for (const name of new Set(defined)) {
    if (PUBLIC_RPCS.includes(name) || OPTIONAL_RPCS.includes(name)) continue
    assert.ok(revoked.has(name),
      `内部ヘルパ ${name} が REVOKE ALL ON FUNCTION ... FROM PUBLIC されていない。` +
      'PostgreSQL は新規関数の EXECUTE を既定で PUBLIC に与えるので、剥がさないと ' +
      '「他人のIDで精算」「仲間を無限に増やす」がサーバー権威を迂回して通る')
  }
  // 他人の uuid を引数に取るヘルパは特に危険。名指しで確認する。
  for (const n of ['base_settle', 'base_join_worker', 'base_ensure_facility_rows', 'base_rate', 'base_cap']) {
    if (defined.includes(n)) {
      assert.ok(revoked.has(n), `${n} は uuid を受け取る内部ヘルパ。REVOKE 必須`)
    }
  }
})

test('SQL: authenticated に公開されているのは base_* の RPC だけ', () => {
  requireSql()
  const granted = [...sql.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\([^)]*\)\s*TO\s+authenticated/gi)]
    .map(m => m[1].toLowerCase())
  for (const rpc of PUBLIC_RPCS) {
    assert.ok(granted.includes(rpc),
      `${rpc} に GRANT EXECUTE ... TO authenticated が無い（クライアントから呼べない）`)
  }
  for (const name of new Set(granted)) {
    assert.ok(PUBLIC_RPCS.includes(name) || OPTIONAL_RPCS.includes(name),
      `${name} が authenticated に公開されている（公開してよいのは ${PUBLIC_RPCS.join(' / ')} だけ）`)
  }
})

test('SQL: RLS が有効で、SELECT ポリシーだけしか作られていない', () => {
  requireSql()
  const tables = ['base_camp', 'base_materials', 'base_workers', 'base_facilities']
  for (const t of tables) {
    assert.ok(new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(sql),
      `${t} で RLS が有効化されていない`)
  }
  const policies = [...sql.matchAll(/CREATE\s+POLICY\s+[a-z0-9_"]+\s+ON\s+(?:public\.)?([a-z0-9_]+)\s+FOR\s+([a-z]+)/gi)]
  assert.ok(policies.length > 0, 'RLS ポリシーが1つも作られていない（本人の SELECT すら出来ない）')
  for (const [, table, cmd] of policies) {
    assert.equal(cmd.toUpperCase(), 'SELECT',
      `${table} に ${cmd.toUpperCase()} のポリシーがある。書込は全て SECURITY DEFINER の RPC 経由の契約` +
      '（INSERT/UPDATE/DELETE/ALL のポリシーを作るとクライアントから資材を直接書ける）')
  }
  for (const t of tables) {
    const p = policies.find(x => x[1].toLowerCase() === t)
    assert.ok(p, `${t} に本人SELECTのポリシーが無い`)
  }
  // 本人限定になっているか（auth.uid() 無しの USING (true) を弾く）
  const usings = [...sql.matchAll(/CREATE\s+POLICY[\s\S]{0,120}?USING\s*\(([^)]*\))/gi)].map(m => m[1])
  for (const u of usings) {
    assert.ok(/auth\.uid\(\)/.test(u), `他人の拠点が見えるポリシーがある: USING (${u}`)
  }
})

test('SQL: すべての RPC に is_admin ゲートが入っている（先行公開の約束）', () => {
  requireSql()
  for (const rpc of PUBLIC_RPCS) {
    const body = fnBody(rpc)
    assert.ok(/is_admin/.test(body), `${rpc} に is_admin ゲートが無い（★is_admin限定先行の契約）`)
    assert.ok(/NOT\s+v_is_admin\s+THEN\s+RETURN/i.test(body),
      `${rpc} が is_admin でないユーザーを弾いていない`)
  }
  // 公開時に外す箇所が機械的に見つかるよう、目印コメントが残っていること（生SQLで確認）
  const marks = rawSql.match(/★is_admin限定先行/g) || []
  assert.ok(marks.length >= PUBLIC_RPCS.length - 1,
    `「★is_admin限定先行: 公開時はこの判定を外す」の目印が足りない（${marks.length}箇所）`)
})

test('SQL: エラーは例外ではなく {ok:false, reason} で返す（既存 alchemy_* と同じ流儀）', () => {
  for (const rpc of PUBLIC_RPCS) {
    const body = fnBody(rpc)
    assert.ok(/json_build_object\(\s*'ok'\s*,\s*false\s*,\s*'reason'/.test(body) || rpc === 'base_dev_reset',
      `${rpc} が {ok:false, reason} を返していない`)
  }
  fnHas('base_assign', /'slot_taken'/, "枠が埋まっているときの reason が 'slot_taken' でない")
  for (const r of ['no_aptitude', 'worker_cap', 'facility_locked', 'invalid_slot', 'not_your_worker']) {
    fnHas('base_assign', new RegExp(`'${r}'`), `base_assign に reason '${r}' が無い`)
  }
  for (const r of ['max_lv', 'not_enough_material', 'not_enough_gold']) {
    fnHas('base_upgrade', new RegExp(`'${r}'`), `base_upgrade に reason '${r}' が無い`)
  }
})

test('SQL: base_assign がサーバー側で配置を検証する（クライアント検証に頼らない）', () => {
  const body = fnBody('base_assign')
  assert.ok(/player_id\s*=\s*v_uid/.test(body), '自分の仲間かを確認していない')
  assert.ok(/base_apt\(\s*v_worker\.species[\s\S]{0,40}<\s*1/.test(body),
    '必要適性1以上の検証が無い（適性0の仲間を置けてしまう）')
  assert.ok(/base_worker_cap\(\s*v_lv\s*\)/.test(body), '配置上限の検証が無い')
  assert.ok(/v_worker\.facility\s+IS\s+NULL/i.test(body),
    '「解除→配置の入替」を配置上限に数えない分岐が無い（入替が上限で弾かれる）')
  assert.ok(/base_facility_unlocked\(\s*v_lv\s*,\s*p_facility\s*\)/.test(body), '施設の解放判定が無い')
  // DB制約でも二重配置を止める（最後の砦）
  assert.ok(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS[\s\S]{0,160}base_workers\(player_id,\s*facility,\s*slot\)[\s\S]{0,60}WHERE\s+facility\s+IS\s+NOT\s+NULL/i.test(sql),
    '1枠1体を保証する部分UNIQUEインデックスが無い')
})

// ============================================================
// 4. 禁止事項（触らない約束の機械的な担保）
// ============================================================

test('SQL: apply_battle_result / protect_profile_stats / ALTER TABLE profiles を含まない', () => {
  requireSql()
  // ※ コメントは剥がして判定する（ヘッダの「触らない」という注記で落とさないため）
  assert.ok(!/apply_battle_result/.test(sql),
    'apply_battle_result を触っている。SQL適用順の地雷（「最後に流す正」）を踏むので v1 では絶対に触らない')
  assert.ok(!/protect_profile_stats/.test(sql),
    'protect_profile_stats を触っている。profiles に列を足さない契約なので再定義は不要')
  assert.ok(!/ALTER\s+TABLE\s+(?:public\.)?profiles/i.test(sql),
    'ALTER TABLE profiles がある。profiles には列を追加しない契約（保護トリガーに波及する）')
  for (const fn of ['apply_dungeon_reward', 'casino_settle_sortie', 'class_level_cap', 'calc_exp_next']) {
    assert.ok(!new RegExp(`FUNCTION\\s+(?:public\\.)?${fn}\\b`).test(sql),
      `拠点と無関係な既存関数 ${fn} を再定義している`)
  }
  assert.ok(!/app\.allow_stat_change/.test(sql),
    '保護列を書こうとしている（拠点は profiles の保護列に一切触らない）')
})

test('SQL: profiles への書込は Gold の消費だけ', () => {
  requireSql()
  const updates = [...sql.matchAll(/UPDATE\s+(?:public\.)?profiles\s+SET\s+([\s\S]{0,200}?)(?:WHERE|;)/gi)]
  for (const [, body] of updates) {
    const cols = [...body.matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*=/gi)].map(m => m[1].toLowerCase())
    for (const c of cols) {
      assert.equal(c, 'gold', `UPDATE profiles で ${c} を書き換えている（拠点が書いてよいのは gold の消費だけ）`)
    }
    assert.ok(/gold\s*-\s*/.test(body), 'profiles.gold を減らす以外の更新をしている（Goldを増やしていないか）')
  }
  assert.ok(/UPDATE\s+profiles\s+SET\s+gold[\s\S]{0,80}gold\s*>=/i.test(sql),
    'Gold の消費に「gold >= 必要額」の条件が無い（同時実行でマイナスになりうる）')
})

test('SQL: 冪等（何度流しても壊れない）', () => {
  requireSql()
  assert.equal((rawSql.match(/CREATE\s+TABLE(?!\s+IF\s+NOT\s+EXISTS)/gi) || []).length, 0,
    'CREATE TABLE IF NOT EXISTS になっていない箇所がある')
  assert.equal((rawSql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX(?!\s+IF\s+NOT\s+EXISTS)/gi) || []).length, 0,
    'CREATE INDEX IF NOT EXISTS になっていない箇所がある')
  assert.ok(!/CREATE\s+FUNCTION\s/i.test(sql), 'CREATE OR REPLACE FUNCTION になっていない関数がある')
  for (const p of [...sql.matchAll(/CREATE\s+POLICY\s+([a-z0-9_]+)/gi)].map(m => m[1])) {
    assert.ok(new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+${p}\\b`, 'i').test(sql),
      `ポリシー ${p} に DROP POLICY IF EXISTS が無い（再実行で落ちる）`)
  }
  assert.ok(/ON\s+CONFLICT[\s\S]{0,60}DO\s+NOTHING/i.test(fnBody('base_init')),
    'base_init が冪等でない（2回呼ぶと仲間が増える／行が重複する）')
})

test('SQL: 時刻はすべてサーバー now()（クライアントから経過時間を受け取らない）', () => {
  requireSql()
  assert.ok(/now\(\)/i.test(sql), 'now() が使われていない')
  const args = sql.match(/FUNCTION\s+(?:public\.)?base_assign\s*\(([^)]*)\)/i)
  assert.ok(args, 'base_assign が見つからない')
  assert.ok(!/timestamp|interval|elapsed|p_now|p_hours/i.test(args[1]),
    `base_assign がクライアントから時刻・経過時間を受け取っている: (${args[1]})`)
  for (const rpc of ['base_get', 'base_collect', 'base_upgrade', 'base_init', 'base_dev_reset']) {
    const m = sql.match(new RegExp(`FUNCTION\\s+(?:public\\.)?${rpc}\\s*\\(([^)]*)\\)`, 'i'))
    if (m) assert.equal(m[1].trim(), '', `${rpc} は引数なしの契約（クライアント申告を受けない）`)
  }
  assert.ok(/EXTRACT\(EPOCH\s+FROM\s*\(\s*now\(\)\s*-\s*[\w.]*accrued_from/i.test(sql),
    '経過時間が now() - accrued_from で計算されていない')
})

test('SQL: base_get は書き込まない（読み取りで settle しない）', () => {
  const body = fnBody('base_get')
  assert.ok(!/\bUPDATE\s+[a-z_]|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b/i.test(body),
    'base_get が書き込んでいる。base_get は STABLE で非破壊、実体の作成は base_init() の契約')
  assert.ok(!/base_settle\s*\(/.test(body), 'base_get が base_settle を呼んでいる（読み取りで書き込む）')
  assert.ok(/\bSTABLE\b/.test(body), 'base_get に STABLE が付いていない')
  assert.ok(/'initialized'/.test(body),
    'base_get が initialized を返していない（クライアントが base_init を呼ぶ契機を失う）')
  // 契約の返り値キーが揃っているか
  for (const k of ['lv', 'worker_cap', 'gold', 'materials', 'facilities', 'workers', 'next_cost',
                   'max_lv', 'storage_mult', 'server_now']) {
    assert.ok(new RegExp(`'${k}'`).test(body), `base_get が ${k} を返していない`)
  }
  assert.ok(/FLOOR\(\s*v_shown\s*\)/i.test(body) && /FLOOR\(\s*v_cap\s*\)/i.test(body),
    'pending / cap が整数（floor）で返されていない')
})

test('SQL: settle が 配置変更・回収・強化 の全てで、状態を変える【前】に呼ばれる', () => {
  requireSql()
  const settleName = (sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(base_[a-z0-9_]*settle[a-z0-9_]*)\s*\(/i) || [])[1]
  assert.ok(settleName, 'settle 用のヘルパ関数（base_*settle*）が無い')
  for (const rpc of ['base_assign', 'base_collect', 'base_upgrade']) {
    assert.ok(new RegExp(`${settleName}\\s*\\(`, 'i').test(fnBody(rpc)),
      `${rpc} が ${settleName} を呼んでいない（直前ぶんが取りこぼされる／新レートで水増しされる）`)
  }
  // base_assign: 配置を書き換える UPDATE の【前】に settle していること
  const assign = fnBody('base_assign')
  const firstSettle = assign.indexOf(settleName)
  const lastSettle = assign.lastIndexOf(settleName)
  const setFacility = assign.search(/UPDATE\s+base_workers\s+SET\s+facility\s*=\s*p_facility/i)
  assert.ok(firstSettle !== -1 && setFacility !== -1 && firstSettle < setFacility,
    'base_assign が配置を書き換える前に settle していない（直前ぶんが新レートで再計算される）')
  // 書き換えた【後】にも settle すること＝下がった cap の超過ぶんをその場で資材へ回収する。
  // これが無いと pending>cap のまま残り、産出が止まったように見える。
  assert.ok(lastSettle > setFacility,
    'base_assign が配置を書き換えた後に settle していない（下がった上限の超過ぶんが宙に浮く）')
  // 移動元と移動先の両方
  assert.ok(new RegExp(`${settleName}\\(\\s*v_uid\\s*,\\s*v_worker\\.facility\\s*\\)`).test(assign),
    'base_assign が移動元の施設を settle していない')
  assert.ok(new RegExp(`${settleName}\\(\\s*v_uid\\s*,\\s*p_facility\\s*\\)`).test(assign),
    'base_assign が移動先の施設を settle していない（空のまま残った accrued_from で水増しされる）')
  // base_upgrade: LV を上げる前（cap も rate も変わるため）
  const up = fnBody('base_upgrade')
  const upSettle = up.lastIndexOf(settleName)
  const lvUp = up.search(/UPDATE\s+base_camp\s+SET\s+lv/i)
  assert.ok(upSettle !== -1 && lvUp !== -1 && upSettle < lvUp,
    'base_upgrade が LV を上げた【後】に settle している（新しい cap / rate で過去ぶんが再計算される）')
})

test('SQL: settle は貯まった pending を消さず、凍結もさせない（capが下がったら資材へ吐き出す）', () => {
  const body = fnBody('base_settle')
  // ① cap超過ぶんを検出して
  assert.ok(/v_pending\s*>\s*v_cap/i.test(body),
    'settle が「pending が cap を超えている」場合を見ていない。素の LEAST(cap, ...) だと ' +
    '仲間を外して rate=0 → cap=0 になった瞬間に、貯まっていた資材が丸ごと消える')
  // ② その場で資材へ回収し（消さない）
  assert.ok(/INSERT\s+INTO\s+base_materials/i.test(body),
    'settle が cap超過ぶんを資材へ回収していない（消えるか、GREATEST で凍結するかのどちらかになる）')
  // ③ 以後は素直に上限で頭打ち＝pending>cap が続かない＝産出が止まらない
  assert.ok(/pending\s*=\s*LEAST\(\s*v_cap/i.test(body),
    'settle が LEAST(cap, ...) で頭打ちにしていない（超過が残ると次回以降ずっと産出が止まる）')
  assert.ok(/GREATEST\(\s*[\w.]*pending\s*,\s*LEAST\(/i.test(body) === false,
    'GREATEST(pending, LEAST(cap, ...)) は pending>cap の間ずっと産出を凍結させるので使わないこと')
  assert.ok(/FOR\s+UPDATE/i.test(body), 'settle が対象行をロックしていない（同時実行で二重計上しうる）')
  assert.ok(/GREATEST\(\s*0\s*,\s*EXTRACT/i.test(body), '経過時間が負になりうる（時刻巻き戻しで巻き戻る）')
  // 回収は floor して端数を施設に残す
  assert.ok(/FLOOR\(/i.test(fnBody('base_collect')), 'base_collect が floor していない')
  assert.ok(/pending\s*=\s*pending\s*-\s*v_take/i.test(fnBody('base_collect')),
    'base_collect が回収したぶんを pending から引いていない（無限に回収できる）')
})

// ============================================================
// 5. 産出式の参照実装（代表ケースの期待値を固定）
// ============================================================

test('産出: LV1・伐採所にスライム → 伐採適性0なので配置できない', () => {
  assert.equal(SPECIES.slime.chop, 0)
  assert.equal(canAssign({ facility: 'lumber', slot: 1, species: 'slime' }), false)
  assert.equal(ratePerHour({ facility: 'lumber', lv: 1, slot1: 'slime' }), 0)
})

test('産出: LV1・伐採所に雪男（伐採3）→ 20×2.2×1.0 = 44/h、上限 44×12 = 528', () => {
  const arg = { facility: 'lumber', lv: 1, slot1: 'yeti' }
  assert.equal(canAssign({ facility: 'lumber', slot: 1, species: 'yeti' }), true)
  close(ratePerHour(arg), 44, '伐採所のレート')
  close(storageCap(arg), 528, '伐採所の保管上限')
})

test('産出: LV1・採石場に盗賊（採掘2）→ 20×1.5 = 30/h、上限 360', () => {
  const arg = { facility: 'quarry', lv: 1, slot1: 'touzoku' }
  close(ratePerHour(arg), 30, '採石場のレート')
  close(storageCap(arg), 360, '採石場の保管上限')
})

test('産出: LV5・薬草畑に雪女（採集3）＋スライム（水やり3）→ 12×2.2×1.4×1.2 = 44.352/h', () => {
  const arg = { facility: 'herbfield', lv: 5, slot1: 'yukionna', slot2: 'slime' }
  close(ratePerHour(arg), 12 * 2.2 * 1.4 * 1.2, '薬草畑のレート')
  close(ratePerHour(arg), 44.352, '薬草畑のレート（直値）')
  // 拠点LV5＝倉庫解放なので保管上限は ×1.5
  close(storageCap(arg), 44.352 * 12 * 1.5, '薬草畑の保管上限')
  close(storageCap(arg), 798.336, '薬草畑の保管上限（直値）')
  assert.equal(Math.floor(storageCap(arg)), 798, 'base_get が返す cap（floor）')
})

test('産出: 薬草畑は slot1（採集役）が空なら slot2 が埋まっていても 0', () => {
  assert.equal(ratePerHour({ facility: 'herbfield', lv: 5, slot1: null, slot2: 'slime' }), 0)
  assert.equal(storageCap({ facility: 'herbfield', lv: 5, slot1: null, slot2: 'slime' }), 0)
})

test('産出: 薬草畑の水やり枠が空なら係数0.5（LV1・雪女単独 → 12×2.2×0.5 = 13.2/h）', () => {
  close(ratePerHour({ facility: 'herbfield', lv: 2, slot1: 'yukionna' }), 13.2, '水やり未配置の薬草畑')
  close(ratePerHour({ facility: 'herbfield', lv: 2, slot1: 'yukionna', slot2: 'yukionna' }), 12 * 2.2 * 1.2, '水やり適性2')
  close(ratePerHour({ facility: 'herbfield', lv: 2, slot1: 'yukionna', slot2: 'slime' }), 12 * 2.2 * 1.4, '水やり適性3')
  // 水やり役を入れると必ず増える（0.5 → 1.0 以上）
  const bare = ratePerHour({ facility: 'herbfield', lv: 2, slot1: 'yukionna' })
  for (const sp of ['yukionna', 'slime']) {
    assert.ok(ratePerHour({ facility: 'herbfield', lv: 2, slot1: 'yukionna', slot2: sp }) > bare,
      `${sp} を水やりに入れても増えない`)
  }
})

test('産出: 拠点LVボーナスは LV4 から効く（魔力泉にスライム：採集2）', () => {
  const at = lv => ratePerHour({ facility: 'manaspring', lv, slot1: 'slime' })
  assert.equal(at(1), 0, '魔力泉は拠点LV3まで未解放')
  assert.equal(at(2), 0, '魔力泉は拠点LV3まで未解放')
  close(at(3), 9, '魔力泉 LV3')     // 6 × 1.5 × 1.0
  close(at(4), 9.9, '魔力泉 LV4')   // × 1.1
  close(at(5), 10.8, '魔力泉 LV5')  // × 1.2
})

test('産出: 倉庫は産出0・保管上限0（配置枠も無い）', () => {
  assert.equal(ratePerHour({ facility: 'warehouse', lv: 5 }), 0)
  assert.equal(storageCap({ facility: 'warehouse', lv: 5 }), 0)
  assert.equal(canAssign({ facility: 'warehouse', slot: 1, species: 'yeti' }), false)
  assert.equal(SLOT_COUNT.warehouse, 0)
})

test('産出: 空き施設は rate=0 かつ cap=0（上限だけ先に付かない）', () => {
  for (const f of PRODUCERS) {
    assert.equal(ratePerHour({ facility: f, lv: 5, slot1: null }), 0, `${f} の空きレート`)
    assert.equal(storageCap({ facility: f, lv: 5, slot1: null }), 0, `${f} の空き上限`)
  }
})

test('産出: 未解放の施設は産出しない（伐採所/採石場=LV1・薬草畑=LV2・魔力泉=LV3）', () => {
  assert.equal(ratePerHour({ facility: 'herbfield', lv: 1, slot1: 'yukionna' }), 0, '薬草畑は LV2 から')
  assert.ok(ratePerHour({ facility: 'herbfield', lv: 2, slot1: 'yukionna' }) > 0)
  assert.equal(ratePerHour({ facility: 'manaspring', lv: 2, slot1: 'slime' }), 0, '魔力泉は LV3 から')
  assert.ok(ratePerHour({ facility: 'manaspring', lv: 3, slot1: 'slime' }) > 0)
})

test('配置可否: 必要適性が0の枠には置けない（薬草畑の水やり枠を含む）', () => {
  assert.equal(canAssign({ facility: 'quarry', slot: 1, species: 'yukionna' }), false)   // 採掘0
  assert.equal(canAssign({ facility: 'manaspring', slot: 1, species: 'yeti' }), false)   // 採集0
  assert.equal(canAssign({ facility: 'herbfield', slot: 2, species: 'touzoku' }), false) // 水やり0
  assert.equal(canAssign({ facility: 'herbfield', slot: 2, species: 'yukionna' }), true) // 水やり2
  assert.equal(canAssign({ facility: 'lumber', slot: 2, species: 'yeti' }), false)       // 伐採所に slot2 は無い
  assert.equal(canAssign({ facility: 'quarry', slot: 2, species: 'touzoku' }), false)
})

test('精算: 上限で頭打ちになり、回収すると再開する', () => {
  const rate = 44, cap = 528                              // LV1・伐採所に雪男
  close(settle({ pending: 0, rate, cap, hours: 1 }).pending, 44, '1時間ぶん')
  close(settle({ pending: 0, rate, cap, hours: 12 }).pending, 528, '12時間で満杯')
  close(settle({ pending: 0, rate, cap, hours: 100 }).pending, 528, '放置しても上限まで')
  close(settle({ pending: 528, rate, cap, hours: 5 }).pending, 528, '満杯のまま増えない')
  // 回収（floor して pending から引く）→ また貯まり始める
  const afterCollect = 528 - Math.floor(528)
  close(settle({ pending: afterCollect, rate, cap, hours: 2 }).pending, 88, '回収後に再開する')
})

test('精算: capが下がっても貯まったぶんは消えず、産出も凍結しない', () => {
  // ① 仲間を外して rate=0 / cap=0。素の LEAST(cap, …) だと未回収ぶんが丸ごと消える
  const off = settle({ pending: 300, rate: 0, cap: 0, hours: 3 })
  assert.equal(off.spilled, 300, '外したときに未回収ぶんが資材へ回収されていない')
  close(off.pending + off.spilled, 300, '外しても総量は1つも減らない')

  // ② 強い仲間→弱い仲間で上限だけ下がった場合も、超過ぶんは資材へ移すだけ
  const weak = settle({ pending: 500, rate: 20, cap: 240, hours: 0 })
  assert.equal(weak.spilled, 260, '超過ぶんが資材へ回収されていない')
  close(weak.pending + weak.spilled, 500, '上限が下がっても総量は減らない')

  // ③ ★凍結しないこと。精算後は必ず pending <= cap になる。
  //    GREATEST(pending, LEAST(cap, …)) 実装だと pending=500 が cap=240 を超えたまま残り、
  //    以後どれだけ時間が経っても1つも増えない＝その間の産出が黙って消える。
  assert.ok(weak.pending <= 240, '精算後も pending が上限を超えている（この状態だと産出が永久に止まる）')
  const frozen = settle({ pending: 500, rate: 20, cap: 240, hours: 24 })
  assert.ok(frozen.pending <= 240 && frozen.spilled === 260,
    '超過状態で24時間経ってもぶら下がったまま＝凍結している')
})

test('精算: 時刻が巻き戻っても増減しない', () => {
  close(settle({ pending: 100, rate: 44, cap: 528, hours: -5 }).pending, 100, '負の経過時間で増減しない')
})

test('強化コスト: 4段すべての直値を凍結（バランス調整時にここも直す）', () => {
  assert.deepEqual(UPGRADE_COST[2], { wood: 100, stone: 60, herb: 0, mana: 0, gold: 5000 })
  assert.deepEqual(UPGRADE_COST[3], { wood: 300, stone: 200, herb: 0, mana: 0, gold: 20000 })
  assert.deepEqual(UPGRADE_COST[4], { wood: 800, stone: 600, herb: 100, mana: 0, gold: 60000 })
  assert.deepEqual(UPGRADE_COST[5], { wood: 2000, stone: 1500, herb: 300, mana: 100, gold: 150000 })
  for (const k of ['wood', 'stone', 'gold']) {
    for (const lv of [3, 4, 5]) {
      assert.ok(UPGRADE_COST[lv][k] > UPGRADE_COST[lv - 1][k], `LV${lv} の ${k} が LV${lv - 1} 以下`)
    }
  }
  assert.equal(UPGRADE_COST[MAX_LV + 1], undefined, '最大LVを超える強化コストがある')
  // 薬草/魔力の欠片は、その資材を作れる施設が解放された後でしか要求されない
  assert.equal(UPGRADE_COST[3].herb, 0, '薬草畑（LV2解放）の直後に薬草を要求している')
  assert.ok(UPGRADE_COST[4].herb > 0 && UPGRADE_COST[4].mana === 0,
    'LV4 のコストが 薬草あり・魔力の欠片なし になっていない（魔力泉は LV3 解放）')
  assert.ok(UPGRADE_COST[5].mana > 0, 'LV5 で魔力の欠片を要求していない')
})

test('LV1構成（伐採所＋採石場に適性1が2体）で木材20/h・石材20/h＝LV2到達に約5時間', () => {
  // 設計書 3-3 の想定。適性1の仲間なら基礎レートそのままになる
  const wood = BASE_RATE.lumber * APT_MULT[1] * LV_BONUS[1]
  const stone = BASE_RATE.quarry * APT_MULT[1] * LV_BONUS[1]
  close(wood, 20, '適性1の木材レート')
  close(stone, 20, '適性1の石材レート')
  close(UPGRADE_COST[2].wood / wood, 5, 'LV2 到達までの木材時間')
  close(UPGRADE_COST[2].stone / stone, 3, 'LV2 到達までの石材時間')
  // 12時間の保管上限（240）を超えないので、寝ている間に無駄にならない
  assert.ok(UPGRADE_COST[2].wood <= wood * STORAGE_HOURS, 'LV2 のコストが1回の満タンで届かない')
})

test('配置上限と枠数・仲間の入手が LV ごとにかみ合っている', () => {
  const slotsAt = lv => PRODUCERS.filter(f => UNLOCKED_AT[f] <= lv).reduce((n, f) => n + SLOT_COUNT[f], 0)
  assert.equal(slotsAt(1), 2, 'LV1: 伐採所 + 採石場')
  assert.equal(slotsAt(2), 4, 'LV2: + 薬草畑（2枠）')
  assert.equal(slotsAt(3), 5, 'LV3: + 魔力泉')
  assert.equal(slotsAt(5), 5, 'LV5 でも枠は5（倉庫は配置不要）')
  assert.deepEqual(Object.values(WORKER_CAP), [2, 3, 4, 5, 6])
  // v1 の入手経路は「開始時のスライム＋LV2〜4の加入」だけ＝最大4体。
  // 配置上限（LV5で6）に届かないのは想定内（v2の証ドロップで埋まる）
  const owned = lv => 1 + Object.keys(JOIN_AT_LV).filter(l => Number(l) <= lv).length
  assert.equal(owned(1), 1, '開始時はスライム1体')
  assert.equal(owned(5), 4, 'v1 で持てるのは4体まで')
  for (const lv of [1, 2, 3, 4, 5]) {
    assert.ok(owned(lv) <= WORKER_CAP[lv],
      `LV${lv}: 持っている ${owned(lv)} 体を配置上限 ${WORKER_CAP[lv]} に置き切れない`)
    assert.ok(owned(lv) <= WORKER_LIMIT, `LV${lv}: 所持上限 ${WORKER_LIMIT} 体を超える`)
  }
})

// ============================================================
// 6. src/lib/basecamp.js とのキー一致（SQL と JS のドリフト検出）
// ============================================================

const loadLib = async () => {
  requireLib()
  return await import('../src/lib/basecamp.js')
}

test('lib: 資材4種・適性4種・施設5種・種族6種のキーが SQL と過不足なく一致する', async () => {
  const m = await loadLib()
  assert.deepEqual(Object.keys(m.MATERIALS).sort(), [...MATERIALS].sort(), '資材のキーが契約と違う')
  assert.deepEqual(Object.keys(m.APTITUDES).sort(), [...APTS].sort(), '適性のキーが契約と違う')
  assert.deepEqual(Object.keys(m.FACILITIES).sort(), [...FACILITIES].sort(), '施設のキーが契約と違う')
  assert.deepEqual(Object.keys(m.SPECIES).sort(), Object.keys(SPECIES).sort(), '種族のキーが契約と違う')
  // 同じキーが SQL 側にも出ていること（片方だけ改名すると base_get の返り値を引けなくなる）
  requireSql()
  for (const k of [...MATERIALS, ...APTS, ...FACILITIES, ...Object.keys(SPECIES)]) {
    assert.ok(sql.includes(`'${k}'`), `SQL にキー '${k}' が無い（JS 側だけに存在している）`)
  }
})

test('lib: 表示名が表記ルールどおり（資材・適性・施設）', async () => {
  const m = await loadLib()
  assert.deepEqual(Object.fromEntries(Object.entries(m.MATERIALS).map(([k, v]) => [k, v.name])),
    { wood: '木材', stone: '石材', herb: '薬草', mana: '魔力の欠片' })
  assert.deepEqual(Object.fromEntries(Object.entries(m.APTITUDES).map(([k, v]) => [k, v.name])),
    { chop: '伐採', mine: '採掘', gather: '採集', water: '水やり' })
  assert.deepEqual(Object.fromEntries(Object.entries(m.FACILITIES).map(([k, v]) => [k, v.name])),
    { lumber: '伐採所', quarry: '採石場', herbfield: '薬草畑', manaspring: '魔力泉', warehouse: '倉庫' })
})

test('lib: 種族の表示名と画像が契約どおり（画像は既存スプライトの流用）', async () => {
  const m = await loadLib()
  assert.deepEqual(Object.fromEntries(Object.entries(m.SPECIES).map(([k, v]) => [k, v.name])), {
    slime: 'スライム', touzoku: '盗賊', yeti: '雪男',
    yukionna: '雪女', lavagolem: '溶岩ゴーレム', magmaslime: 'マグマスライム',
  })
  assert.deepEqual(Object.fromEntries(Object.entries(m.SPECIES).map(([k, v]) => [k, v.image])), {
    slime: '/suraimu.png', touzoku: '/touzoku.png', yeti: '/yukiotoko.png',
    yukionna: '/yukionna.png', lavagolem: '/yougango-remu.png', magmaslime: '/magumasuraimu.png',
  })
})

test('lib: 表示テキストに「素材」を使わない（お宝素材と混同するので拠点側は「資材」）', async () => {
  const m = await loadLib()
  const texts = [m.MATERIALS, m.APTITUDES, m.FACILITIES, m.SPECIES]
    .flatMap(o => Object.values(o).map(v => v.name))
  for (const t of texts) {
    assert.ok(!t.includes('素材'),
      `表示名「${t}」に「素材」が入っている。お宝素材（無限ポーション用）と衝突するので拠点側は「資材」`)
  }
})

test('lib: クライアントは産出レートを再計算しない（数値を一切持たない）', async () => {
  const m = await loadLib()
  // 適性倍率・水やり係数・保管上限・強化コストを JS 側にも持つと、SQL とズレた瞬間に
  // 表示と実際の産出が食い違う（レイドの出現予定をクライアントで再計算して事故った件と同じ根）。
  // 表示は base_get() の返り値をそのまま出す契約なので、このファイルは数値を持たない。
  for (const [name, obj] of Object.entries({
    MATERIALS: m.MATERIALS, APTITUDES: m.APTITUDES, FACILITIES: m.FACILITIES, SPECIES: m.SPECIES,
  })) {
    for (const [k, v] of Object.entries(obj)) {
      for (const [field, val] of Object.entries(v)) {
        assert.notEqual(typeof val, 'number',
          `${name}.${k}.${field} が数値。産出に関わる数値の正はサーバー（base_get / base_upgrade）だけ`)
      }
    }
  }
  const src = rawLib.replace(/\/\/[^\n]*/g, ' ')   // コメント内の注記は対象外
  for (const v of ['2.2', '1.5', '1.4', '1.2', '1.1', '0.5']) {
    assert.ok(!numRe(v).test(src),
      `src/lib/basecamp.js に産出係数 ${v} がある。レート計算はサーバー（base_get）だけの契約`)
  }
  for (const v of [5000, 20000, 60000, 150000, 2000, 1500]) {
    assert.ok(!numRe(v).test(src), `src/lib/basecamp.js に強化コスト ${v} がある（SQL と二重定義）`)
  }
})
