// ============================================================
// 戦闘 — 一次職の仕組み（「レベルキャップあり」版 src/v2cap の一次職20職・2026-10-10）
// ------------------------------------------------------------
// 技・パッシブの項目は src/v2cap/lib/skillsIchiji.js の冒頭に一覧がある。
// ★今のⅡの技・敵はこの項目を持たないので、ここは何もしない（今のⅡの戦闘は変わらない）。
//   battle.js は決まった場所でここを呼ぶだけ。ダメージの解決（resolveAttack）が要るもの
//   （着地・反撃・追撃・召喚の攻撃）は battle.js 側に置いてある。
// ★純関数ではなく side（createSide の戻り値）を書き換える。rng は使わない（再現性は battle.js と同じ）。
// ============================================================
import { AIL_KEYS, AIL_LABEL, hasAilment } from './ailments.js'
import { setTurnsUp } from './battleSet.js'

// 溜め（気・照準・装填・詠唱・薬効・死霊・式神・分身）
export const STK_KEYS = ['ki', 'aim', 'load', 'chant', 'potion', 'undead', 'shiki', 'clone']
export const STK_LABEL = { ki:'気', aim:'照準', load:'装填', chant:'詠唱', potion:'薬効', undead:'死霊', shiki:'式神', clone:'分身' }
// 受けるダメージの軽減をいくつ重ねても、ここで頭を打つ
export const GUARD_CUT_MAX = 80

// パッシブで新しく持てる項目（collectPassives が pa.ex に畳む）
// ★2026-10-15 上位クラスの作り直し（チャット版の設計）で足したもの：
//   misfireStance（居合の構え：不発の通常攻撃のあと納刀）・imbue（エンチャント：属性の宿り）・holy（聖騎士の心得：聖光）・
//   misfireChase（精神感応：相手の不発に念動の追撃）・cloneGuard（影の連携：分身が身代わりになる確率）・mpPower（魔弾）・
//   reso（元素共鳴：共鳴）・overShield（神聖加護：あふれた回復をバリアに）・vsRace（退魔の心得）・sin（退魔の心得：罪）
export const EX_PASSIVE_KEYS = [
  'lowHpDmg', 'immune', 'landPct', 'combo', 'counterOnDodge', 'perStackDmg', 'perFoeBleed', 'cloneFollow', 'noCloneAgi',
  'perFoeAil', 'critFollow', 'vsAnyAil', 'whileStackGuard', 'elemSwitch', 'chantBonus', 'extraIfFaster', 'guardPerStack',
  'whileSummonOrGuard', 'vsRaceOrAil', 'bothAil', 'vsDebuff',
  'misfireStance', 'imbue', 'holy', 'misfireChase', 'cloneGuard', 'mpPower', 'reso', 'overShield', 'vsRace', 'sin',
  // 2026-10-17 体術師の地上と空中：counterAirMult（空中にいるあいだの反撃の倍率・0＝空中では反撃しない）
  'counterAirMult',
]

// ===== 魔法剣士：属性の宿り（2026-10-15）=====
// 属性の剣技を当てると、その属性が剣に宿る（1つだけ・別の属性で上書き）。宿っている間は物理の技と通常攻撃に追加効果が乗る
//   炎 … INT×0.2の追撃（魔法）・15%で火傷／氷 … 相手のAGI−5%（宿りで下げるのは合計−20%まで）・15%で鈍足／雷 … 防御を15%無視・5%で麻痺
// k … 効果の倍（エレメンタルエッジ＝2倍）
export const IMBUE_FX = {
  fire:    { label: '炎', chase: 0.2, ail: 'burn', chance: 15 },
  ice:     { label: '氷', agi: -5, agiMax: -20, ail: 'slow', chance: 15 },
  thunder: { label: '雷', defPen: 0.15, ail: 'paralyze', chance: 5 },
}
// 宿りを消して付ける状態異常（マナバースト）
export const IMBUE_AIL = { fire: 'burn', ice: 'slow', thunder: 'paralyze' }
// その攻撃に乗る宿り（物理の技と通常攻撃だけ）。{ elem, k } か null
export const imbueFxOf = (me, skill = null) => {
  if (!me?.pa?.ex?.imbue || !(me.imbue?.turns > 0)) return null
  if (skill && skill.kind !== 'phys') return null
  return { elem: me.imbue.elem, k: skill?.imbueMult || 1 }
}

// ===== 動揺（サイキッカー）：相手のスキル発動率−3%/つ（最大5つ）=====
export const AGIT_PER = 3
export const AGIT_MAX = 5
export const agitCutOf = (side) => (side?.agit || 0) * AGIT_PER

// ===== 罠（狩人）：2つまで。相手が攻撃するとき、古い罠から1つ発動して消える =====
export const TRAP_MAX = 2

// ===== 聖職者のバリア：あふれた回復ぶん（上限は最大HPの%）。ゴスペルの間は上限が伸びる =====
export const shieldCapOf = (side) => {
  const base = side?.pa?.ex?.overShield?.cap || 0
  const g = side?.gospel?.turns > 0 ? (side.gospel.shieldCap || 0) : 0
  return Math.floor((side?.base?.hp || 0) * Math.max(base, g) / 100)
}
// 受けたダメージをバリアで先に受ける。HPから減らすぶんを返す
export const shieldAbsorb = (side, dmg) => {
  if (!(side?.shield > 0) || dmg <= 0) return { left: dmg, absorbed: 0 }
  const absorbed = Math.min(side.shield, dmg)
  side.shield -= absorbed
  return { left: dmg - absorbed, absorbed }
}

// ===== 聖騎士の聖光：防御や軽減で減らしたダメージの◯%を溜める（上限は最大HPの◯%）=====
export const holyGain = (side, reduced) => {
  const h = side?.pa?.ex?.holy
  if (!h || !(reduced > 0)) return 0
  const up = (side.holyUp?.turns > 0 ? side.holyUp.pct : 0)
  const add = Math.floor(reduced * h.pct / 100 * (side.holyTurnMult || 1) * (1 + up / 100))
  const cap = Math.floor(side.base.hp * h.cap / 100)
  const before = side.holy || 0
  side.holy = Math.min(cap, before + add)
  return side.holy - before
}
// ホーリーケアのアセンション：回復した量の◯%を聖光として溜める（上限は同じ）
export const holyFromHeal = (side, healed, pct) => {
  const h = side?.pa?.ex?.holy
  if (!h || !(healed > 0) || !(pct > 0)) return 0
  const cap = Math.floor(side.base.hp * h.cap / 100)
  const before = side.holy || 0
  side.holy = Math.min(cap, before + Math.floor(healed * pct / 100))
  return side.holy - before
}

// ===== 狩人の罠・死の刻印など「状態異常を付ける確率+」=====
export const ailUpOf = (side, key) => {
  let pct = 0
  for (const u of side?.ailUps || []) if (u.turns > 0 && (u.key === key || u.key === '*')) pct += u.pct
  if (side?.philo?.turns > 0) pct += side.philo.ailUp || 0
  return pct
}

// 結界があるか（陰陽結界・封縛結界＝張れるのは1つ）
export const barrierOn = (side) => (side?.guardsT || []).some(g => g.turns > 0 && g.barrier) || side?.bind?.turns > 0
export const collectExPassives = (passives) => {
  const ex = {}
  for (const s of passives || []) {
    const p = s?.passive
    if (!p) continue
    for (const k of EX_PASSIVE_KEYS) if (p[k] !== undefined) ex[k] = p[k]
  }
  return ex
}

// createSide が呼ぶ：一次職の状態を side に足す
export const initIchiji = (side, fighter) => {
  side.stk = Object.fromEntries(STK_KEYS.map(k => [k, 0]))
  side.guardsT = []         // 期限つきの軽減 [{ cut, turns, healPct }]
  side.lifeSteal = null     // { pct, turns }
  side.endure = null        // { turns, pct, acc }
  side.jumping = null       // { left, mult, name } 跳んでいるあいだは攻撃が当たらない
  side.landedTurn = -9      // 着地したターン（天墜竜閃が見る）
  side.dodgeBoost = null    // { turns, pct, max } 流水の構え
  side.dodgeStacks = 0
  side.stunned = 0          // 行動できない残りターン（フルバースト）
  side.quickUsed = 0        // クイックを使った回数
  side.reviveReady = 0      // リザレクション：立ち上がるときのHP%
  side.reviveUsed = false
  side.healedTotal = 0      // この戦闘で回復したHP（セイクリッドノヴァ）
  side.takenLog = []        // [{ turn, dmg }] 受けたダメージ（リワインド）
  side.lastTaken = 0        // 直前に受けたダメージ（報復の一撃）
  side.combo = 0            // 槍の型のコンボ
  side.critUp = 0           // 息を止める：クリティカル率+（戦闘中ずっと）
  side.nextCrit = false     // 隠形のアセンション：次の攻撃の技が必ずクリティカル
  side.nextBoost = {}       // 照準・詠唱：{ key: { kind, per } }
  side.summonMult = {}      // 召喚1体の攻撃の倍率 { undead: 0.25, shiki: 0.5 }
  side.summonBoost = {}     // { key: { pct, turns } }
  side.summonHits = {}      // { key: { hits, turns } }
  side.debuffImmune = 0     // 能力低下を受けない残りターン（狂信）
  side.lastElem = null      // 直前に使った魔法の属性（元素共鳴）
  side.race = fighter?.race || null   // 敵の種族（アンデッド・悪魔など。★あとでまとめて足す＝いまは無い）
  // ===== 2026-10-15 上位クラスの作り直し =====
  side.prevStanced = false  // 直前に撃った技が納刀つきだったか（二の太刀）
  side.imbue = null         // 魔法剣士の宿り { elem, turns }
  side.iceDown = 0          // 氷の宿りで下げた相手のAGI（%・マイナス）
  side.holy = 0             // 聖騎士の聖光（ダメージの量）
  side.holyTurnMult = 1     // 大防御のターンは聖光が2倍
  side.holyUp = null        // 不動の誓い：溜まる聖光+% { pct, turns }
  side.berserk = null       // 狂鬼化（2026-10-16）：{ turns }＝そのあいだHPが1より下がらず、回復を受けない（STR+は timedBuffs）
  side.lastPaid = 0         // この行動で払ったHP（ブラッドサクリファイス）
  side.soar = null          // 竜翔 { turns, land, proc }
  side.comboBoost = null    // 嵐の構え { turns, n }
  side.counterBoost = null  // 後の先 { turns, pct }
  side.dodgeCount = 0       // この戦闘で回避した回数（流転掌）
  side.agit = 0             // 動揺（かけられている数）
  side.ailUps = []          // 状態異常を付ける確率+ [{ key, pct, turns }]（死の刻印）
  side.traps = []           // 置いた罠 [{ name, mult, ail, debuff }]
  side.aimCritPer = 0       // 照準1つのクリティカル率+
  side.lockOn = null        // ロックオン { turns, critDmg }
  side.mpPaid = 0           // この行動で払ったMP（魔弾・オーバーロードショット）
  side.mpBefore = 0         // 払う前のMP（エーテルバレット・アルカナバレット）
  side.reso = 0             // 元素使いの共鳴
  side.extraActs = 0        // この戦闘で追加で動いた回数（パラドックス）
  side.summonMax = {}       // 召喚の最大数の上書き（レイズデッド）
  side.bind = null          // 封縛結界 { turns, ailExtend }
  side.shield = 0           // 聖職者のバリア
  side.shieldStat = null    // 光の帳：バリアがある間のステ+%
  side.gospel = null        // ゴスペル { turns, healMult, shieldCap }
  side.sin = 0              // 異端審問官の罪
  side.ailImmune = 0        // 状態異常にかからない残りターン（不動の誓い・ゴスペル）
  side.philo = null         // 賢者の石 { turns, ailUp, react }
  side.lastExec = null      // 直前に撃った技（リピート）
}

export const hpPctOf = (side) => (Math.max(0, side.hp) / Math.max(1, side.base.hp)) * 100
export const ailCount = (side) => AIL_KEYS.filter(k => hasAilment(side?.ail || {}, k)).length
const activeGuard = (side) => (side.guardsT || []).some(g => g.turns > 0) || side.bind?.turns > 0
// 相手のそのステが下がっているか（ずっと続くデバフ・期限つきのデバフのどちらでも）
const statDown = (side, stat) => (side.buffs?.[stat] || 0) < 0
  || (side.timedBuffs || []).some(t => t.turns > 0 && (t.table?.[stat] || 0) < 0)

// ===== 与ダメージ+%（パッシブ・状況）＝スキルと通常攻撃の両方に掛ける =====
export const passiveDealMult = (me, foe) => {
  const x = me.pa?.ex
  if (!x) return 1
  let pct = 0
  if (x.lowHpDmg) {
    const hp = hpPctOf(me)
    const hit = x.lowHpDmg.filter(t => hp <= t.at).sort((a, b) => a.at - b.at)[0]
    if (hit) pct += hit.pct
  }
  if (x.combo) pct += Math.min(x.combo.max, me.combo || 0) * x.combo.pct
  if (x.perStackDmg) pct += Math.min(x.perStackDmg.max ?? Infinity, (me.stk?.[x.perStackDmg.key] || 0) * x.perStackDmg.pct)
  if (x.perFoeBleed) pct += (foe.ail?.bleed?.stacks || 0) * x.perFoeBleed
  if (x.perFoeAil) pct += Math.min(x.perFoeAil.max, ailCount(foe) * x.perFoeAil.pct)
  if (x.vsAnyAil && ailCount(foe) > 0) pct += x.vsAnyAil
  if (x.whileSummonOrGuard && ((me.stk?.shiki || 0) > 0 || activeGuard(me))) pct += x.whileSummonOrGuard
  if (x.vsRaceOrAil) {
    const v = x.vsRaceOrAil
    if ((foe.race && v.races.includes(foe.race)) || hasAilment(foe.ail || {}, v.ailKey)) pct += v.pct
  }
  // 化学反応（賢者の石の間は上乗せが伸びる）
  if (x.bothAil && x.bothAil.keys.every(k => hasAilment(foe.ail || {}, k))) pct += x.bothAil.pct + (me.philo?.turns > 0 ? (me.philo.react || 0) : 0)
  if (x.vsDebuff && x.vsDebuff.stats.some(s => statDown(foe, s))) pct += x.vsDebuff.pct
  // 2026-10-15：共鳴（元素使い）・罪（異端審問官）・種族（退魔の心得）
  if (x.reso) pct += Math.min(x.reso.max, me.reso || 0) * x.reso.pct
  if (x.sin) pct += Math.min(x.sin.max, me.sin || 0) * x.sin.pct
  if (x.vsRace && foe.race && x.vsRace.races.includes(foe.race)) pct += x.vsRace.pct
  return 1 + pct / 100
}

// ===== 撃てるか（findSlot が見る）=====
// 溜めが足りない技・続けて使えない技・使い切った技・溜めが満杯で意味の無い技は飛ばす
export const ichijiSkip = (side, skill) => {
  if (!skill) return false
  if (skill.needStack && (side.stk?.[skill.needStack.key] || 0) < skill.needStack.n) return true
  if (skill.noRepeat && side.lastSkill === skill.name) return true
  if (skill.extraTurn && (side.quickUsed || 0) >= skill.extraTurn.max) return true
  if (skill.revive && (side.reviveReady || side.reviveUsed)) return true
  // 溜める・呼ぶだけの補助技は、満杯なら撃たない（ほかの効果を持つ技は撃つ）
  const g = skill.gain || skill.summon
  if (skill.kind === 'buff' && g && !skill.buff && !skill.mpGainPct && (side.stk?.[g.key] || 0) >= Math.max(g.max, side.summonMax?.[g.key] || 0)) return true
  // 狂鬼化：続いているあいだは撃ち直さない
  if (skill.berserk && side.berserk?.turns > 0) return true
  // HPがこの%より多いあいだは使わない（狂鬼化＝30%・2026-10-17）。編成の順で回ってきたときに見る
  if (skill.useBelowHp && hpPctOf(side) > skill.useBelowHp) return true
  return false
}

// ===== 攻撃スキルの威力の上乗せのうち、MPで決まるもの（魔銃士）=====
// 払ったMP（me.mpPaid）と払う前のMP（me.mpBefore）を見る。どちらも takeAction が技ごとに入れる
const mpMultOf = (me, skill) => {
  let m = 1
  const x = me.pa?.ex || {}
  const maxMp = Math.max(1, me.base?.mp || 1)
  if (x.mpPower && me.mpPaid > 0) m *= 1 + Math.min(x.mpPower.max, me.mpPaid * x.mpPower.per) / 100
  if (skill.mpRatioPower) m *= 1 + (skill.mpRatioPower.max / 100) * Math.min(1, (me.mpBefore || 0) / maxMp)
  if (skill.mpAbove && (me.mpBefore || 0) / maxMp * 100 >= skill.mpAbove.at) m *= skill.mpAbove.mult
  if (skill.mpUsedPower) {
    const u = skill.mpUsedPower
    m *= 1 + Math.min(u.max, Math.floor((me.mpPaid || 0) / u.perMp) * u.per) / 100
  }
  return m
}

// ===== 攻撃スキルの準備（1回の行動につき1回）=====
// 倍率・連撃数・クリティカル率・上乗せダメージを決め、溜めを使う（消費は当たり外れに関係なく起きる）
export const ichijiSkillPrep = (me, foe, skill, eMe, eFoe, log) => {
  // defPen … 防御無視の上乗せ／sureHit … 必中にする（ロックオン）／reStance … 当てたら納刀（二の太刀）／
  // imbueAil … 当てたら付ける宿りの状態異常（マナバースト）／resoAils … 当てたら付ける状態異常（プリズムバースト）／
  // resoUsed・sinUsed … 撃ったあと共鳴・罪を0に
  const out = { mult: 1, addMult: 0, hits: null, crit: 0, flat: 0, drainAdd: 0, sureCrit: false,
    defPen: 0, sureHit: false, reStance: false, imbueAil: null, resoAils: null, resoUsed: false, sinUsed: false }
  const x = me.pa?.ex || {}
  // ===== 2026-10-15 上位クラスの作り直し =====
  // 二の太刀：直前の技を納刀中に撃っていれば威力+・当てたらもう一度納刀
  if (skill.afterStance && me.prevStanced) { out.mult *= skill.afterStance.mult; out.reStance = !!skill.afterStance.reStance }
  // 魔法剣士：宿りがあれば威力+（双極斬）／宿りを消して威力+・その属性の状態異常（マナバースト）
  if (skill.whileImbue && me.imbue?.turns > 0) out.mult *= skill.whileImbue.mult
  if (skill.consumeImbue && me.imbue?.turns > 0) {
    out.mult *= skill.consumeImbue.mult
    out.imbueAil = { key: IMBUE_AIL[me.imbue.elem], chance: skill.consumeImbue.ailChance }
    log.push({ side: me.name, type: 'imbueUse', elem: IMBUE_FX[me.imbue.elem]?.label || me.imbue.elem })
    me.imbue = null
  }
  // 狂戦士：払ったHPの一部を上乗せ（防御無視）
  if (skill.paidDmg && me.lastPaid > 0) out.flat += Math.floor(me.lastPaid * skill.paidDmg)
  // 聖騎士：聖光を使って上乗せ（防御無視）
  if (skill.useHoly && me.holy > 0) {
    const used = Math.floor(me.holy * skill.useHoly.frac)
    if (used > 0) {
      me.holy -= used
      out.flat += Math.floor(used * (skill.useHoly.mult || 1))   // アセンションで聖光の追加ダメージ×1.3など
      log.push({ side: me.name, type: 'holyUse', n: used, left: me.holy })
    }
  }
  // ストームランサー：コンボで威力+／コンボが多ければ防御無視
  if (skill.comboPower) out.mult *= 1 + Math.min(skill.comboPower.max, (me.combo || 0) * skill.comboPower.per) / 100
  if (skill.comboDefPen && (me.combo || 0) >= skill.comboDefPen.at) out.defPen += skill.comboDefPen.defPen
  // 体術師（2026-10-17）：地上と空中で同じ技の効き目が変わる。撃ち始めの状態（me.air）で onGround／inAir を足す
  //   mult＝威力+%・crit＝クリティカル率+・defPen＝防御無視+・hits＝連撃+n（跳び上がる・留まるは battle.js の空中の所）
  const st = me.air ? skill.inAir : skill.onGround
  if (st) {
    if (st.mult) out.mult *= 1 + st.mult / 100
    if (st.crit) out.crit += st.crit
    if (st.defPen) out.defPen += st.defPen
    if (st.hits) out.hits = (out.hits ?? (skill.hitMults ? skill.hitMults.length : (skill.hits || 1))) + st.hits
  }
  // 体術師：この戦闘で回避した回数で威力+
  if (skill.dodgeCountPower) out.mult *= 1 + Math.min(skill.dodgeCountPower.max, (me.dodgeCount || 0) * skill.dodgeCountPower.per) / 100
  // サイキッカー：相手の動揺で威力+（動揺は残る）
  if (skill.agitPower) out.mult *= 1 + Math.min(skill.agitPower.max, (foe.agit || 0) * skill.agitPower.per) / 100
  // 暗殺者：相手のHPが低ければ威力×（首狩り・絶命）
  if (skill.foeLowHp && hpPctOf(foe) <= skill.foeLowHp.at) out.mult *= skill.foeLowHp.mult
  // 魔銃士：MPで決まる上乗せ
  const mpm = mpMultOf(me, skill)
  if (mpm !== 1) out.mult *= mpm
  // 元素使い：共鳴（属性の魔法を撃つたび。同じ属性を続けると0）
  if (skill.elem && x.reso) {
    if (me.lastElem && me.lastElem !== skill.elem) me.reso = Math.min(x.reso.max, (me.reso || 0) + 1 + (skill.resoBonus || 0))
    else if (me.lastElem === skill.elem) me.reso = 0
  }
  // プリズムバースト：共鳴を全部使って威力+（撃ったあとで0にする＝この技にも共鳴の与ダメージ+は乗る）
  if (skill.useReso) {
    const u = skill.useReso
    const n = me.reso || 0
    out.mult *= 1 + Math.min(u.max, n * u.per) / 100
    if (u.fullAils && n >= u.fullAils.at) out.resoAils = u.fullAils.keys.map(key => ({ key, chance: u.fullAils.chance }))
    out.resoUsed = true
  }
  // クロノマンサー：この戦闘で追加で動いた回数で威力+
  if (skill.extraCountPower) out.mult *= 1 + Math.min(skill.extraCountPower.max, (me.extraActs || 0) * skill.extraCountPower.per) / 100
  // 死霊使い：死霊1体につき倍率+（死霊は消えない）
  if (skill.perStackAdd) out.addMult += (me.stk?.[skill.perStackAdd.key] || 0) * skill.perStackAdd.addMult
  // 式神使い：結界があれば威力+
  if (skill.whileBarrier && barrierOn(me)) out.mult *= skill.whileBarrier.mult
  // 異端審問官：罪を全部使って威力+（撃ったあとで0にする）
  if (skill.useSin) { out.mult *= 1 + (me.sin || 0) * skill.useSin.per / 100; out.sinUsed = true }
  // 霊薬師：薬効で防御無視
  if (skill.defPenPerStack) {
    const d = skill.defPenPerStack
    out.defPen += Math.min(d.max, (me.stk?.[d.key] || 0) * d.per)
  }
  // 狩人：相手の状態異常の数で連撃+
  if (skill.hitsByAil) {
    const n = ailCount(foe)
    let add = 0
    for (const t of skill.hitsByAil) if (n >= t.at) add = Math.max(add, t.n)
    if (add) out.hits = (skill.hits || 1) + add
  }
  // アークアーチャー：照準1つにつきクリティカル率+（減らない）・ロックオンの間は必中
  if (me.aimCritPer) out.crit += (me.stk?.aim || 0) * me.aimCritPer
  if (me.lockOn?.turns > 0) out.sureHit = true
  // デストロイヤー：撃つ前の装填で連撃+、そのあと装填を使う（カーペットボム）
  if (skill.hitsPerStackUse) {
    const u = skill.hitsPerStackUse
    const n = me.stk?.[u.key] || 0
    out.hits = (skill.hits || 1) + Math.min(u.max, n) * u.n
    if (n >= u.use) {
      me.stk[u.key] -= u.use
      log.push({ side: me.name, type: 'stackUse', stack: STK_LABEL[u.key], n: u.use, left: me.stk[u.key] })
    }
  }
  if (skill.selfLowHp && hpPctOf(me) <= skill.selfLowHp.at) out.mult *= skill.selfLowHp.mult
  if (skill.afterLand && (me.turn || 0) - me.landedTurn === 1) out.mult *= skill.afterLand
  // 影討ち：1ターン目だけ（アセンションで turns:2＝2ターン目まで）
  if (skill.firstTurn && (me.turn || 0) < (skill.firstTurn.turns || 1)) { out.mult *= skill.firstTurn.mult; out.crit += skill.firstTurn.crit || 0 }
  if (skill.critBonus) out.crit += skill.critBonus
  if (skill.critIfDodged && me.ctx?.dodged) out.sureCrit = true
  // 隠形のアセンション：次に撃つ攻撃の技が必ずクリティカル（クリティカルしない技では使わずに残す）
  if (me.nextCrit && !skill.noCrit) { out.sureCrit = true; me.nextCrit = false }
  // 溜めを使う
  if (skill.useOne) {
    const u = skill.useOne
    if ((me.stk[u.key] || 0) >= u.n) {
      me.stk[u.key] -= u.n
      out.mult *= u.mult
      log.push({ side: me.name, type: 'stackUse', stack: STK_LABEL[u.key], n: u.n, left: me.stk[u.key] })
    }
  }
  if (skill.useAll) {
    const u = skill.useAll
    const n = me.stk[u.key] || 0
    if (n > 0) {
      me.stk[u.key] = 0
      if (u.per) out.mult *= 1 + u.per * n
      if (u.addMult) out.addMult += u.addMult * n
      log.push({ side: me.name, type: 'stackUse', stack: STK_LABEL[u.key], n, left: 0 })
    }
  }
  // 相手の出血を全部使って威力+（急所突き）。今のⅡの consumeAil と違い、副参照のぶんにも掛かる
  if (skill.burstAil) {
    const b = skill.burstAil
    const st = b.key === 'bleed' ? (foe.ail?.bleed?.stacks || 0) : (hasAilment(foe.ail || {}, b.key) ? 1 : 0)
    if (st > 0) {
      const m = 1 + b.perStack * st
      out.mult *= m
      delete foe.ail[b.key]
      log.push({ side: foe.name, type: 'consumeAil', ail: AIL_LABEL[b.key], stacks: st, mult: m })
    }
  }
  if (skill.perStack) out.mult *= 1 + Math.min(skill.perStack.max ?? Infinity, (me.stk[skill.perStack.key] || 0) * skill.perStack.pct) / 100
  if (skill.drainPerStack) out.drainAdd += (me.stk[skill.drainPerStack.key] || 0) * skill.drainPerStack.pct
  if (skill.hitsPerStack) out.hits = (skill.hits || 1) + (me.stk[skill.hitsPerStack.key] || 0) * skill.hitsPerStack.n
  if (skill.comboHits && (me.combo || 0) >= skill.comboHits.at) out.hits = skill.comboHits.hits
  // 照準・詠唱：次の物理／魔法の攻撃で全部使う
  for (const [key, nb] of Object.entries(me.nextBoost || {})) {
    const n = me.stk[key] || 0
    if (nb.kind !== skill.kind || n <= 0) continue
    out.mult *= 1 + nb.per * n / 100
    if (key === 'chant' && x.chantBonus) out.mult *= 1 + x.chantBonus / 100
    me.stk[key] = 0
    log.push({ side: me.name, type: 'stackUse', stack: STK_LABEL[key], n, left: 0 })
  }
  if (skill.vsAilMult && hasAilment(foe.ail || {}, skill.vsAilMult.key)) out.mult *= skill.vsAilMult.mult
  if (skill.vsRace && foe.race && skill.vsRace.races.includes(foe.race)) out.mult *= skill.vsRace.mult
  if (skill.agiDiff) {
    const d = ((eMe.agi || 0) / Math.max(1, eFoe.agi || 0) - 1) * 100
    out.mult *= 1 + Math.min(skill.agiDiff.max, Math.max(0, d) * skill.agiDiff.per) / 100
  }
  if (skill.consumeAllAil) {
    const keys = AIL_KEYS.filter(k => hasAilment(foe.ail || {}, k))
    if (keys.length) {
      for (const k of keys) delete foe.ail[k]
      const pct = Math.min(skill.consumeAllAil.max, keys.length * skill.consumeAllAil.per)
      out.mult *= 1 + pct / 100
      log.push({ side: foe.name, type: 'ailBurst', n: keys.length, ails: keys.map(k => AIL_LABEL[k]).join('・'), pct })
    }
  }
  if (skill.revenge && me.lastTaken > 0) out.flat += Math.floor(me.lastTaken * skill.revenge)
  if (skill.healDmg) out.flat += Math.floor(Math.min(me.healedTotal * skill.healDmg.pct / 100, (eMe.int_stat || 0) * skill.healDmg.capMult))
  // 元素共鳴：直前と違う属性の魔法
  if (skill.elem) {
    if (x.elemSwitch && me.lastElem && me.lastElem !== skill.elem) out.mult *= 1 + x.elemSwitch / 100
    me.lastElem = skill.elem
  }
  // 流水の構え：回避で溜めたぶん（次の攻撃で使う）
  out.mult *= consumeDodgeBoost(me)
  return out
}
// 流水の構えの溜め（スキルでも通常攻撃でも、次の攻撃で使い切る）
export const consumeDodgeBoost = (me) => {
  if (!(me.dodgeStacks > 0) || !me.dodgeBoostPct) return 1
  const m = 1 + me.dodgeStacks * me.dodgeBoostPct / 100
  me.dodgeStacks = 0
  return m
}

// ===== 受けるダメージの軽減（applyIncoming が掛ける）=====
// 期限つきの軽減（受け止め・気の鎧・結界）＋装填がある間（砲台の構え）＋死霊1体ごと（死者の盾）
export const incomingCut = (side) => {
  let cut = 0
  for (const g of side.guardsT || []) if (g.turns > 0) cut += g.cut
  const x = side.pa?.ex || {}
  if (x.whileStackGuard && (side.stk?.[x.whileStackGuard.key] || 0) >= 1) cut += x.whileStackGuard.cut
  if (x.guardPerStack) cut += (side.stk?.[x.guardPerStack.key] || 0) * x.guardPerStack.cut
  return Math.min(GUARD_CUT_MAX, cut)
}
// 軽減したぶんを回復する結界（陰陽結界）の割合
export const guardHealPct = (side) => {
  let p = 0
  for (const g of side.guardsT || []) if (g.turns > 0 && g.healPct) p = Math.max(p, g.healPct)
  return p
}

// ===== 狂鬼化（2026-10-16）=====
// 続いているあいだは回復を受けない（battle.js の回復はどれもここを見る）・HPが1より下がらない（HPが減る所のあとで呼ぶ）
export const canHeal = (side) => !(side?.berserk?.turns > 0)
export const keepAlive = (side, log) => {
  if (side.hp >= 1 || !(side.berserk?.turns > 0)) return
  side.hp = 1
  if (log) log.push({ side: side.name, type: 'berserkHold' })
}

// ===== HPを戻す（回復した量を数える）=====
// ★聖職者（神聖加護）：満タンからあふれたぶんはバリアになる（上限は最大HPの%）。バリアになったぶんも「回復した量」に数える
export const gainHp = (side, amt) => {
  if (!canHeal(side)) return 0
  const before = side.hp
  const want = Math.max(0, amt)
  side.hp = Math.min(side.base.hp, side.hp + want)
  const got = side.hp - before
  let toShield = 0
  if (want > got && side.pa?.ex?.overShield) {
    const room = Math.max(0, shieldCapOf(side) - (side.shield || 0))
    toShield = Math.min(room, want - got)
    side.shield = (side.shield || 0) + toShield
  }
  side.healedTotal = (side.healedTotal || 0) + got + toShield
  return got
}

// ===== 行動のあとに乗る効果（攻撃・補助・回復のどれでも）=====
// heal … battle.js の healAmount（回復量の補正を通した値を返す）
export const ichijiAfterAction = (me, foe, skill, log) => {
  // ★防具のセット能力（v2cap）：悠久の守り＝自分にかける期限つきの効果の持続+（持っていなければ0）
  const up = setTurnsUp(me)
  if (skill.gain) {
    const g = skill.gain
    me.stk[g.key] = Math.min(g.max, (me.stk[g.key] || 0) + g.n)
    log.push({ side: me.name, type: 'stackGain', skill: skill.name, stack: STK_LABEL[g.key], n: me.stk[g.key] })
  }
  if (skill.nextBoost) me.nextBoost[skill.nextBoost.key] = { kind: skill.nextBoost.kind, per: skill.nextBoost.per }
  if (skill.summon) {
    const s = skill.summon
    // レイズデッド：この戦闘の間、最大数が伸びる
    if (s.setMax) me.summonMax[s.key] = Math.max(me.summonMax[s.key] || 0, s.setMax)
    const max = Math.max(s.max, me.summonMax[s.key] || 0)
    me.stk[s.key] = Math.min(max, (me.stk[s.key] || 0) + s.n)
    me.summonMult[s.key] = s.mult
    log.push({ side: me.name, type: 'summon', skill: skill.name, stack: STK_LABEL[s.key], n: me.stk[s.key] })
  }
  // ===== 2026-10-15 上位クラスの作り直し（補助の技の効果）=====
  if (skill.imbueExtend && me.imbue?.turns > 0) {
    me.imbue.turns += skill.imbueExtend
    log.push({ side: me.name, type: 'imbue', elem: IMBUE_FX[me.imbue.elem]?.label || me.imbue.elem, turns: me.imbue.turns })
  }
  // ★狂鬼化（2026-10-16 ユーザーがシートで書き直した）：HPを1にする。turns ターンのあいだHPが1より下がらず・回復を受けない・STR+%。
  //   3つとも同じターン数（timedBuffs と同じくターンの終わりに1つ減る＝使ったターンも数える）
  if (skill.berserk) {
    const turns = skill.berserk.turns + up
    if (me.hp > 1) me.hp = 1
    me.berserk = { turns }
    if (skill.berserk.str) me.timedBuffs.push({ table: { str: skill.berserk.str }, turns })
    log.push({ side: me.name, type: 'berserkUp', skill: skill.name, turns, str: skill.berserk.str || 0 })
  }
  if (skill.holyTurn) me.holyTurnMult = skill.holyTurn
  if (skill.vow) {
    const v = skill.vow
    me.guardsT.push({ cut: v.cut, turns: v.turns + up, healPct: 0 })
    me.ailImmune = Math.max(me.ailImmune || 0, v.turns + up)
    me.holyUp = { pct: v.holyPct, turns: v.turns + up }
    log.push({ side: me.name, type: 'guardUp', skill: skill.name, cut: v.cut, turns: v.turns + up })
  }
  if (skill.soar) { me.soar = { ...skill.soar, turns: skill.soar.turns + up }; log.push({ side: me.name, type: 'buff', skill: skill.name }) }
  if (skill.comboBoost) { me.comboBoost = { ...skill.comboBoost, turns: skill.comboBoost.turns + up } }
  if (skill.counterBoost) { me.counterBoost = { ...skill.counterBoost, turns: skill.counterBoost.turns + up }; log.push({ side: me.name, type: 'buff', skill: skill.name }) }
  if (skill.ailUp) { me.ailUps.push({ ...skill.ailUp, turns: skill.ailUp.turns + up }); log.push({ side: me.name, type: 'buff', skill: skill.name }) }
  if (skill.trap) {
    me.traps.push({ name: skill.name, ...skill.trap })
    while (me.traps.length > TRAP_MAX) me.traps.shift()
    log.push({ side: me.name, type: 'trapSet', skill: skill.name, n: me.traps.length })
  }
  if (skill.aimCrit) me.aimCritPer = Math.max(me.aimCritPer || 0, skill.aimCrit)
  if (skill.lockOn) { me.lockOn = { ...skill.lockOn, turns: skill.lockOn.turns + up }; log.push({ side: me.name, type: 'buff', skill: skill.name }) }
  // MPを戻す補助の技（魔力装填＝最大MPの%・詠唱＝決まった量）
  if (skill.kind === 'buff' && (skill.mpGainPct || skill.mpGain)) {
    const add = (skill.mpGainPct ? Math.floor(me.base.mp * skill.mpGainPct / 100) : 0) + (skill.mpGain || 0)
    const before = me.mp
    me.mp = Math.min(me.base.mp, me.mp + add)
    log.push({ side: me.name, type: 'mpGain', skill: skill.name, mp: me.mp - before })
  }
  if (skill.resoGain && me.pa?.ex?.reso) {
    me.reso = Math.min(me.pa.ex.reso.max, (me.reso || 0) + skill.resoGain)
    log.push({ side: me.name, type: 'reso', n: me.reso })
  }
  // 結界（張れるのは1つ。張り直すと上書き）
  if (skill.barrier) {
    me.guardsT = me.guardsT.filter(g => !g.barrier)
    me.bind = null
    if (skill.guard) me.guardsT.push({ cut: skill.guard.cut, turns: skill.guard.turns + up, healPct: skill.guard.healPct || 0, barrier: true })
    if (skill.bind) {
      me.bind = { ...skill.bind, turns: skill.bind.turns + up }
      if (skill.bind.foeAgi) {
        if (foe.debuffImmune > 0) log.push({ side: foe.name, type: 'debuffImmune' })
        else foe.timedBuffs.push({ table: { agi: skill.bind.foeAgi }, turns: skill.bind.turns + up })
      }
      log.push({ side: me.name, type: 'barrier', skill: skill.name, turns: me.bind.turns })
    }
  }
  if (skill.shieldGain) {
    const cap = shieldCapOf(me)
    const before = me.shield || 0
    me.shield = Math.min(cap, before + Math.floor(me.base.hp * skill.shieldGain.pct / 100))
    if (skill.shieldGain.stat) me.shieldStat = { ...skill.shieldGain.stat }
    log.push({ side: me.name, type: 'shieldUp', skill: skill.name, n: me.shield - before, total: me.shield })
  }
  if (skill.gospel) {
    me.gospel = { ...skill.gospel, turns: skill.gospel.turns + up }
    me.ailImmune = Math.max(me.ailImmune || 0, skill.gospel.turns + up)
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.sinGain && me.pa?.ex?.sin) {
    me.sin = Math.min(me.pa.ex.sin.max, (me.sin || 0) + skill.sinGain)
    log.push({ side: me.name, type: 'sin', n: me.sin })
  }
  if (skill.philo) { me.philo = { ...skill.philo, turns: skill.philo.turns + up }; log.push({ side: me.name, type: 'buff', skill: skill.name }) }
  if (skill.summonBoost) {
    me.summonBoost[skill.summonBoost.key] = { pct: skill.summonBoost.pct, turns: skill.summonBoost.turns + up }
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.summonHits) {
    me.summonHits[skill.summonHits.key] = { hits: skill.summonHits.hits, turns: skill.summonHits.turns + up }
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.guard) {
    // 結界（barrier）の技は下の「結界」で張る（ほかの結界と入れ替わる）
    if (!skill.barrier) me.guardsT.push({ cut: skill.guard.cut, turns: skill.guard.turns + up, healPct: skill.guard.healPct || 0 })
    log.push({ side: me.name, type: 'guardUp', skill: skill.name, cut: skill.guard.cut, turns: skill.guard.turns + up })
  }
  if (skill.lifeSteal) {
    me.lifeSteal = { ...skill.lifeSteal, ...(up ? { turns: skill.lifeSteal.turns + up } : {}) }
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.endure) {
    me.endure = { turns: skill.endure.turns, pct: skill.endure.pct, acc: 0 }
    log.push({ side: me.name, type: 'endureStart', skill: skill.name, turns: skill.endure.turns })
  }
  if (skill.dodgeBoost) {
    me.dodgeBoost = { ...skill.dodgeBoost, ...(up ? { turns: skill.dodgeBoost.turns + up } : {}) }
    me.dodgeBoostPct = skill.dodgeBoost.pct
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.revive) {
    me.reviveReady = skill.revive.pct
    log.push({ side: me.name, type: 'reviveReady', skill: skill.name })
  }
  if (skill.debuffImmune) {
    me.debuffImmune = skill.debuffImmune.turns + up
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.critUp) me.critUp = (me.critUp || 0) + skill.critUp
  if (skill.nextCrit) me.nextCrit = true
  if (skill.evaUp) me.evaUp = Math.max(me.evaUp || 0, skill.evaUp)   // 受け流しのアセンション（重複不可）
  if (skill.selfStun) me.stunned = skill.selfStun
}

// ===== ターンの終わり =====
// 期限つきの効果を1つ減らす。忍耐が終わったら、溜めたダメージの割合を返す（battle.js が相手へ与える）
export const tickIchiji = (side) => {
  let release = 0
  if (side.guardsT?.length) {
    for (const g of side.guardsT) g.turns -= 1
    side.guardsT = side.guardsT.filter(g => g.turns > 0)
  }
  if (side.lifeSteal?.turns > 0 && --side.lifeSteal.turns <= 0) side.lifeSteal = null
  if (side.berserk?.turns > 0 && --side.berserk.turns <= 0) side.berserk = null   // 狂鬼化（STR+は timedBuffs が同じターンで切れる）
  if (side.dodgeBoost?.turns > 0 && --side.dodgeBoost.turns <= 0) side.dodgeBoost = null
  if (side.debuffImmune > 0) side.debuffImmune -= 1
  for (const m of [side.summonBoost, side.summonHits]) {
    for (const [k, v] of Object.entries(m || {})) if (v.turns > 0 && --v.turns <= 0) delete m[k]
  }
  if (side.endure?.turns > 0 && --side.endure.turns <= 0) {
    release = Math.floor((side.endure.acc || 0) * side.endure.pct / 100)
    side.endure = null
  }
  // ===== 2026-10-15 上位クラスの作り直し（期限つきのもの）=====
  if (side.imbue?.turns > 0 && --side.imbue.turns <= 0) side.imbue = null
  for (const k of ['soar', 'comboBoost', 'counterBoost', 'lockOn', 'bind', 'gospel', 'philo', 'holyUp']) {
    if (side[k]?.turns > 0 && --side[k].turns <= 0) side[k] = null
  }
  if (side.ailUps?.length) {
    for (const u of side.ailUps) u.turns -= 1
    side.ailUps = side.ailUps.filter(u => u.turns > 0)
  }
  if (side.ailImmune > 0) side.ailImmune -= 1
  side.holyTurnMult = 1   // 大防御の「聖光2倍」はそのターンだけ
  return release
}
