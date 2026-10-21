// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 装備の能力を戦闘の1つの入れ物にまとめる
// ------------------------------------------------------------
// 防具のセット能力（armorSets.js の setFxOf）と、着けているユニークの固有の能力（uniqueDefs.js の fx）を、
// 戦闘に渡す fighter.setFx 1つにまとめる（項目の意味は src/v2cap/core/battleSet.js の冒頭）。
// ★1つにまとめるので、出撃・ボス・覇天塔（守護者のスナップショットも setFx を持ち運ぶ＝tower.js の snapshotOf）のどれでも同じに効く
// 重ね方（2026-10-21）：
//   ・受けるダメージ−% は掛け算（−10% と −15% で −23.5%＝今のセット能力と同じ考え方・ユーザーに伝えた「こちらで決める」）
//   ・確率の倍率（かかりにくさ・付けやすさ・レアの落ちやすさ）は掛ける
//   ・ステ+% などの数は足す・配列（当てたときの状態異常など）はつなぐ
//   ・1回だけのもの（HP30%以下で回復・復活）は大きいほう
//   ・形のある1つだけのもの（デスロールの積み上げ など）は先に入っていたほう（ユニークは同じものを1つまでしか着けない）
// names … ログに出す能力の名前（同じ項目を2つが持てば「森の恵み・千年根の具足」のようにつなぐ）
// ============================================================

const CUT = new Set(['takenCut', 'physCut', 'magCut', 'vsSlowCut', 'calmCut', 'critTakenCut', 'nextSameCut'])
const MULT = new Set(['resistAll', 'rareDropMult', 'inflictUpAll'])
const MULT_MAP = new Set(['resist', 'inflictUp'])
const ADD_MAP = new Set(['statPct', 'whileAilStat', 'allSkillsBuff', 'defIgnore', 'kindDeal'])
const LIST = new Set(['vsAilDmg', 'convertAdds', 'counterAil', 'onHitAils', 'onHitAilIf', 'onHitStack', 'onHitTimed',
  'drainIfAil', 'lowHpDeal', 'hpDeal', 'turnGrow', 'hitGrow', 'chaseIfAil', 'addDmg', 'counterAilIf', 'earlyBuffs'])
const UNION = new Set(['immune', 'dispelTurns'])
const OR = new Set(['gutsOnce', 'dodgeOnce'])

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

// base に add（名前 name）を重ねた新しい入れ物を返す。base・add は書き換えない。どちらも無ければ null
export const mergeFx = (base, add, name = '') => {
  if (!add) return base ? clone(base) : null
  const fx = base ? clone(base) : {}
  const names = { ...(fx.names || {}) }
  delete fx.names
  for (const [k, v] of Object.entries(add)) {
    if (k === 'names') continue
    // earlyBuff（1つの形）は配列の earlyBuffs へ（セットの迅雷とユニークのウォードラムベルトを両方持てる）
    const key = k === 'earlyBuff' ? 'earlyBuffs' : k
    const val = k === 'earlyBuff' ? [v] : v
    if (CUT.has(key)) fx[key] = Math.round((100 - (100 - (fx[key] || 0)) * (100 - val) / 100) * 100) / 100
    else if (MULT.has(key)) fx[key] = (fx[key] ?? 1) * val
    else if (MULT_MAP.has(key)) {
      const m = { ...(fx[key] || {}) }
      for (const [a, x] of Object.entries(val)) m[a] = (m[a] ?? 1) * x
      fx[key] = m
    } else if (ADD_MAP.has(key)) {
      const m = { ...(fx[key] || {}) }
      for (const [a, x] of Object.entries(val)) m[a] = (m[a] || 0) + x
      fx[key] = m
    } else if (LIST.has(key)) fx[key] = [...(fx[key] || []), ...clone(val)]
    else if (UNION.has(key)) fx[key] = [...new Set([...(fx[key] || []), ...val])]
    else if (OR.has(key)) fx[key] = !!(fx[key] || val)
    else if (key === 'revive') fx[key] = Math.max(fx[key] || 0, val)
    else if (key === 'lowHpHealOnce') fx[key] = !fx[key] || val.pct > fx[key].pct ? clone(val) : fx[key]
    else if (typeof val === 'number') fx[key] = (fx[key] || 0) + val
    else if (fx[key] === undefined) fx[key] = clone(val)
    else continue   // 形のある1つだけのもの：先に入っていたほうを残す（名前もつながない）
    if (name) names[key] = names[key] && !names[key].split('・').includes(name) ? `${names[key]}・${name}` : (names[key] || name)
  }
  return { ...fx, names }
}

// 防具のセット能力（setFxOf の返り値・null 可）に、着けているユニーク（equipment.js の UNIQUE_ITEMS の1件）の能力を重ねる。
// どちらも無ければ null（今までと同じ＝setFx を持たない）
export const combinedFxOf = (setFx, uniques = []) => {
  let fx = setFx ? clone(setFx) : null
  for (const u of uniques) if (u?.fx) fx = mergeFx(fx, u.fx, u.name)
  return fx
}
