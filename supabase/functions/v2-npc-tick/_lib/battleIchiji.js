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

// 溜め（気・照準・装填・詠唱・薬効・死霊・式神・分身）
export const STK_KEYS = ['ki', 'aim', 'load', 'chant', 'potion', 'undead', 'shiki', 'clone']
export const STK_LABEL = { ki:'気', aim:'照準', load:'装填', chant:'詠唱', potion:'薬効', undead:'死霊', shiki:'式神', clone:'分身' }
// 受けるダメージの軽減をいくつ重ねても、ここで頭を打つ
export const GUARD_CUT_MAX = 80

// パッシブで新しく持てる項目（collectPassives が pa.ex に畳む）
export const EX_PASSIVE_KEYS = [
  'lowHpDmg', 'immune', 'landPct', 'combo', 'counterOnDodge', 'perStackDmg', 'perFoeBleed', 'cloneFollow', 'noCloneAgi',
  'perFoeAil', 'critFollow', 'vsAnyAil', 'whileStackGuard', 'elemSwitch', 'chantBonus', 'extraIfFaster', 'guardPerStack',
  'whileSummonOrGuard', 'vsRaceOrAil', 'bothAil', 'vsDebuff',
]
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
  side.nextBoost = {}       // 照準・詠唱：{ key: { kind, per } }
  side.summonMult = {}      // 召喚1体の攻撃の倍率 { undead: 0.25, shiki: 0.5 }
  side.summonBoost = {}     // { key: { pct, turns } }
  side.summonHits = {}      // { key: { hits, turns } }
  side.debuffImmune = 0     // 能力低下を受けない残りターン（狂信）
  side.lastElem = null      // 直前に使った魔法の属性（元素共鳴）
  side.race = fighter?.race || null   // 敵の種族（アンデッド・悪魔など。★あとでまとめて足す＝いまは無い）
}

export const hpPctOf = (side) => (Math.max(0, side.hp) / Math.max(1, side.base.hp)) * 100
export const ailCount = (side) => AIL_KEYS.filter(k => hasAilment(side?.ail || {}, k)).length
const activeGuard = (side) => (side.guardsT || []).some(g => g.turns > 0)
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
  if (x.perStackDmg) pct += (me.stk?.[x.perStackDmg.key] || 0) * x.perStackDmg.pct
  if (x.perFoeBleed) pct += (foe.ail?.bleed?.stacks || 0) * x.perFoeBleed
  if (x.perFoeAil) pct += Math.min(x.perFoeAil.max, ailCount(foe) * x.perFoeAil.pct)
  if (x.vsAnyAil && ailCount(foe) > 0) pct += x.vsAnyAil
  if (x.whileSummonOrGuard && ((me.stk?.shiki || 0) > 0 || activeGuard(me))) pct += x.whileSummonOrGuard
  if (x.vsRaceOrAil) {
    const v = x.vsRaceOrAil
    if ((foe.race && v.races.includes(foe.race)) || hasAilment(foe.ail || {}, v.ailKey)) pct += v.pct
  }
  if (x.bothAil && x.bothAil.keys.every(k => hasAilment(foe.ail || {}, k))) pct += x.bothAil.pct
  if (x.vsDebuff && x.vsDebuff.stats.some(s => statDown(foe, s))) pct += x.vsDebuff.pct
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
  if (skill.kind === 'buff' && g && !skill.buff && (side.stk?.[g.key] || 0) >= g.max) return true
  return false
}

// ===== 攻撃スキルの準備（1回の行動につき1回）=====
// 倍率・連撃数・クリティカル率・上乗せダメージを決め、溜めを使う（消費は当たり外れに関係なく起きる）
export const ichijiSkillPrep = (me, foe, skill, eMe, eFoe, log) => {
  const out = { mult: 1, addMult: 0, hits: null, crit: 0, flat: 0, drainAdd: 0, sureCrit: false }
  const x = me.pa?.ex || {}
  if (skill.selfLowHp && hpPctOf(me) <= skill.selfLowHp.at) out.mult *= skill.selfLowHp.mult
  if (skill.afterLand && (me.turn || 0) - me.landedTurn === 1) out.mult *= skill.afterLand
  if (skill.firstTurn && (me.turn || 0) === 0) { out.mult *= skill.firstTurn.mult; out.crit += skill.firstTurn.crit || 0 }
  if (skill.critBonus) out.crit += skill.critBonus
  if (skill.critIfDodged && me.ctx?.dodged) out.sureCrit = true
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
  if (skill.perStack) out.mult *= 1 + (me.stk[skill.perStack.key] || 0) * skill.perStack.pct / 100
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

// ===== HPを戻す（回復した量を数える）=====
export const gainHp = (side, amt) => {
  const before = side.hp
  side.hp = Math.min(side.base.hp, side.hp + Math.max(0, amt))
  const got = side.hp - before
  side.healedTotal = (side.healedTotal || 0) + got
  return got
}

// ===== 行動のあとに乗る効果（攻撃・補助・回復のどれでも）=====
// heal … battle.js の healAmount（回復量の補正を通した値を返す）
export const ichijiAfterAction = (me, foe, skill, log) => {
  if (skill.gain) {
    const g = skill.gain
    me.stk[g.key] = Math.min(g.max, (me.stk[g.key] || 0) + g.n)
    log.push({ side: me.name, type: 'stackGain', skill: skill.name, stack: STK_LABEL[g.key], n: me.stk[g.key] })
  }
  if (skill.nextBoost) me.nextBoost[skill.nextBoost.key] = { kind: skill.nextBoost.kind, per: skill.nextBoost.per }
  if (skill.summon) {
    const s = skill.summon
    me.stk[s.key] = Math.min(s.max, (me.stk[s.key] || 0) + s.n)
    me.summonMult[s.key] = s.mult
    log.push({ side: me.name, type: 'summon', skill: skill.name, stack: STK_LABEL[s.key], n: me.stk[s.key] })
  }
  if (skill.summonBoost) {
    me.summonBoost[skill.summonBoost.key] = { pct: skill.summonBoost.pct, turns: skill.summonBoost.turns }
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.summonHits) {
    me.summonHits[skill.summonHits.key] = { hits: skill.summonHits.hits, turns: skill.summonHits.turns }
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.guard) {
    me.guardsT.push({ cut: skill.guard.cut, turns: skill.guard.turns, healPct: skill.guard.healPct || 0 })
    log.push({ side: me.name, type: 'guardUp', skill: skill.name, cut: skill.guard.cut, turns: skill.guard.turns })
  }
  if (skill.lifeSteal) {
    me.lifeSteal = { ...skill.lifeSteal }
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.endure) {
    me.endure = { turns: skill.endure.turns, pct: skill.endure.pct, acc: 0 }
    log.push({ side: me.name, type: 'endureStart', skill: skill.name, turns: skill.endure.turns })
  }
  if (skill.dodgeBoost) {
    me.dodgeBoost = { ...skill.dodgeBoost }
    me.dodgeBoostPct = skill.dodgeBoost.pct
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.revive) {
    me.reviveReady = skill.revive.pct
    log.push({ side: me.name, type: 'reviveReady', skill: skill.name })
  }
  if (skill.debuffImmune) {
    me.debuffImmune = skill.debuffImmune.turns
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  if (skill.critUp) me.critUp = (me.critUp || 0) + skill.critUp
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
  if (side.dodgeBoost?.turns > 0 && --side.dodgeBoost.turns <= 0) side.dodgeBoost = null
  if (side.debuffImmune > 0) side.debuffImmune -= 1
  for (const m of [side.summonBoost, side.summonHits]) {
    for (const [k, v] of Object.entries(m || {})) if (v.turns > 0 && --v.turns <= 0) delete m[k]
  }
  if (side.endure?.turns > 0 && --side.endure.turns <= 0) {
    release = Math.floor((side.endure.acc || 0) * side.endure.pct / 100)
    side.endure = null
  }
  return release
}
