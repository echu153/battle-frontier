// ============================================================
// バトルフロンティアⅡ（リメイク版）— 武器の進化：効果の部品（アトム）
// ------------------------------------------------------------
// 進化で付く能力は、この**52個の部品の組み合わせ**でできている。
//   例）「クリティカル時、最大HPの1%を失うが クリティカルの与ダメージ+20%」
//       ＝ critDmg（得）＋ critHpCost（代償）
//
// ★1つの能力＝得1〜2個＋代償0〜1個。代償を背負うものほど得の倍率が大きい。
//   こうすると「強いが噛み合う人にしか噛み合わない」能力を量産しても壊れない。
//
// ★ここに部品を足すときは battle.js の実装も必ず一緒に足すこと。
//   足し忘れを検出するテストが evolve.test.js にある（全アトムが戦闘に効くか総当たり）。
//
// up   … 得として付いたときの文
// down … 代償として付いたときの文（undefined＝代償にはできない部品）
// slot … battle.js が畳み込む先（collectEvolutions が使う）
// unit … **重さの換算値**（既定1）。1回きりの「+1%」を1としたときの効き目。
//        毎ターン／当てるたびに積み上がる部品は同じ1%でも遥かに強いので大きい。
//        ★得と代償を比べるのはこの換算後の値。倍率(w)だけで比べると釣り合わない
// ============================================================
import { STAT_DEFS } from './stats.js'

const pct = (v) => `${v}%`

// ステータス%（8種）は同じ形なので機械的に作る
const statAtoms = () => {
  const out = {}
  for (const [k, d] of Object.entries(STAT_DEFS)) {
    out[`st_${k}`] = {
      slot: 'stat', stat: k,
      up:   (v) => `${d.label}+${pct(v)}`,
      down: (v) => `${d.label}-${pct(v)}`,
    }
  }
  return out
}

// 積み上がる部品の重さ。ここに無いものは1
const UNIT = {
  regen: 8, mpRegen: 6, drain: 4, ailDrain: 8,
  onHitHeal: 12, onHitMp: 10, onDodgeHeal: 10, onHurtMp: 8,
  onDodgeAgi: 4, onHurtStr: 4,
  critHpHeal: 4, critHpCost: 4, critMpHeal: 3, critMpCost: 3, critAil: 0.6,
  st_hp: 1.5, st_mp: 0.5,
}

export const ATOMS = {
  ...statAtoms(),

  // ===== 攻撃 =====
  critRate: { slot:'critRate', up:(v) => `クリティカル率+${pct(v)}`,       down:(v) => `クリティカル率-${pct(v)}` },
  critDmg:  { slot:'critDmg',  up:(v) => `クリティカルの与ダメージ+${pct(v)}` },
  dmg:      { slot:'dmg.always',      up:(v) => `与ダメージ+${pct(v)}`,                     down:(v) => `与ダメージ-${pct(v)}` },
  dmgLow:   { slot:'dmg.low',         up:(v) => `HP30%以下のとき与ダメージ+${pct(v)}` },
  dmgHigh:  { slot:'dmg.high',        up:(v) => `HP70%以上のとき与ダメージ+${pct(v)}` },
  dmgFull:  { slot:'dmg.full',        up:(v) => `HPが満タンのとき与ダメージ+${pct(v)}` },
  dmgFirst: { slot:'dmg.first',       up:(v) => `最初の3回の行動で与ダメージ+${pct(v)}` },
  dmgLate:  { slot:'dmg.late',        up:(v) => `6回目以降の行動で与ダメージ+${pct(v)}` },
  dmgBig:   { slot:'dmg.big',         up:(v) => `戦闘力が上の相手への与ダメージ+${pct(v)}` },
  dmgSmall: { slot:'dmg.small',       up:(v) => `戦闘力が下の相手への与ダメージ+${pct(v)}` },
  dmgBoss:  { slot:'dmg.boss',        up:(v) => `ボスへの与ダメージ+${pct(v)}` },
  dmgPhys:  { slot:'dmg.phys',        up:(v) => `物理の与ダメージ+${pct(v)}`,   down:(v) => `物理の与ダメージ-${pct(v)}` },
  dmgMag:   { slot:'dmg.mag',         up:(v) => `魔法の与ダメージ+${pct(v)}`,   down:(v) => `魔法の与ダメージ-${pct(v)}` },
  dmgSkill: { slot:'dmg.skill',       up:(v) => `スキルの与ダメージ+${pct(v)}`, down:(v) => `スキルの与ダメージ-${pct(v)}` },
  dmgNormal:{ slot:'dmg.normal',      up:(v) => `通常攻撃の与ダメージ+${pct(v)}` },
  dmgMulti: { slot:'dmg.multi',       up:(v) => `多段スキルの与ダメージ+${pct(v)}` },
  dmgAil:   { slot:'dmg.ail',         up:(v) => `状態異常の相手への与ダメージ+${pct(v)}` },
  dmgDodge: { slot:'dmg.afterDodge',  up:(v) => `かわした次の攻撃の与ダメージ+${pct(v)}` },
  dmgHurt:  { slot:'dmg.afterHurt',   up:(v) => `被弾した次の攻撃の与ダメージ+${pct(v)}` },
  dmgCombo: { slot:'dmg.combo',       up:(v) => `行動するたび与ダメージ+${pct(v)}（最大10回）` },
  // ★仕留め際。**相手のHP**を見る唯一の条件（ほかは全部“自分の”HPを見ている）
  dmgFinish:{ slot:'dmg.finish',      up:(v) => `相手がHP30%以下のとき与ダメージ+${pct(v)}` },
  hitFinish:{ slot:'hitFinish',       up:(v) => `相手がHP30%以下のとき命中率+${pct(v)}` },
  critFinish:{slot:'critFinish',      up:(v) => `相手がHP30%以下のときクリティカル率+${pct(v)}` },
  defPen:   { slot:'defPen',          up:(v) => `防御無視+${pct(v)}` },

  // ===== 防御 =====
  cut:      { slot:'cut.always', up:(v) => `被ダメージ-${pct(v)}` },
  cutLow:   { slot:'cut.low',    up:(v) => `HP30%以下のとき被ダメージ-${pct(v)}` },
  cutPhys:  { slot:'cut.phys',   up:(v) => `物理の被ダメージ-${pct(v)}` },
  cutMag:   { slot:'cut.mag',    up:(v) => `魔法の被ダメージ-${pct(v)}` },
  taken:    { slot:'taken',      up:undefined, down:(v) => `被ダメージ+${pct(v)}` },
  eva:      { slot:'eva',        up:(v) => `回避率+${pct(v)}`, down:(v) => `回避率-${pct(v)}` },
  hit:      { slot:'hit',        up:(v) => `命中率+${pct(v)}`, down:(v) => `命中率-${pct(v)}` },
  evaLow:   { slot:'evaLow',     up:(v) => `HP30%以下のとき回避率+${pct(v)}` },
  guts:     { slot:'guts',       up:(v) => `${pct(v)}で致命傷をHP1で耐える（1戦に1回）` },

  // ===== クリティカルしたとき =====
  critHpCost:{ slot:'onCrit.hpCost', up:undefined, down:(v) => `クリティカル時に最大HPの${pct(v)}を失う` },
  critHpHeal:{ slot:'onCrit.hpHeal', up:(v) => `クリティカル時に最大HPの${pct(v)}回復` },
  critMpHeal:{ slot:'onCrit.mpHeal', up:(v) => `クリティカル時に最大MPの${pct(v)}回復` },
  critMpCost:{ slot:'onCrit.mpCost', up:undefined, down:(v) => `クリティカル時に最大MPの${pct(v)}を失う` },
  critAil:   { slot:'onCrit.ail',    up:(v) => `クリティカル時に${pct(v)}で出血させる` },

  // ===== 当てたとき・かわしたとき・被弾したとき =====
  onHitHeal:  { slot:'onHit.hpHeal',   up:(v) => `攻撃を当てるたび最大HPの${pct(v)}回復` },
  onHitMp:    { slot:'onHit.mpHeal',   up:(v) => `攻撃を当てるたび最大MPの${pct(v)}回復` },
  onDodgeHeal:{ slot:'onDodge.hpHeal', up:(v) => `かわすたび最大HPの${pct(v)}回復` },
  onDodgeAgi: { slot:'onDodge.agi',    up:(v) => `かわすたびAGI+${pct(v)}（最大5回）` },
  onHurtStr:  { slot:'onHurt.str',     up:(v) => `被弾するたびSTR+${pct(v)}（最大5回）` },
  onHurtMp:   { slot:'onHurt.mpHeal',  up:(v) => `被弾するたび最大MPの${pct(v)}回復` },

  // ===== 状態異常 =====
  ailRate:  { slot:'ail.rate',   up:(v) => `状態異常の付与率+${pct(v)}` },
  ailDmg:   { slot:'ail.dmg',    up:(v) => `出血・毒のダメージ+${pct(v)}` },
  ailResist:{ slot:'ail.resist', up:(v) => `状態異常になる確率-${pct(v)}` },
  ailWeak:  { slot:'ail.weak',   up:undefined, down:(v) => `状態異常になる確率+${pct(v)}` },
  ailDrain: { slot:'ail.drain',  up:(v) => `相手が状態異常のとき毎ターン最大HPの${pct(v)}回復` },

  // ===== 回復・MP =====
  heal:    { slot:'heal',    up:(v) => `受ける回復量+${pct(v)}`, down:(v) => `受ける回復量-${pct(v)}` },
  drain:   { slot:'drain',   up:(v) => `与ダメージの${pct(v)}を吸収` },
  regen:   { slot:'regen',   up:(v) => `毎ターン最大HPの${pct(v)}回復` },
  mpCost:  { slot:'mpCost',  up:(v) => `消費MP-${pct(v)}`, down:(v) => `消費MP+${pct(v)}` },
  mpRegen: { slot:'mpRegen', up:(v) => `毎ターン最大MPの${pct(v)}回復` },

  // ===== 行動 =====
  proc:      { slot:'proc',       up:(v) => `スキルの発動率+${pct(v)}`, down:(v) => `スキルの発動率-${pct(v)}` },
  extra:     { slot:'extra',      up:(v) => `追加行動率+${pct(v)}` },
  first:     { slot:'first',      up:(v) => `${pct(v)}で先手を取る` },
  misfireDmg:{ slot:'misfireDmg', up:(v) => `不発のときの通常攻撃の威力+${pct(v)}` },
}

for (const [k, a] of Object.entries(ATOMS)) a.unit = UNIT[k] ?? 1

export const ATOM_KEYS = Object.keys(ATOMS)
// 部品1つぶんの重さ（倍率 × 換算値）。得と代償の釣り合いを見るのに使う
export const atomWeight = (key, w) => w * (ATOMS[key]?.unit ?? 1)

// 1つぶんの文。cost=true なら代償の言い回しになる
export const atomText = (key, value, cost = false) => {
  const a = ATOMS[key]
  if (!a) return ''
  const f = cost ? a.down : a.up
  return f ? f(value) : ''
}
