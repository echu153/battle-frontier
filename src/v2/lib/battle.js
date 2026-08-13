// ============================================================
// バトルフロンティアⅡ（リメイク版）— 戦闘ループ
// ------------------------------------------------------------
// スキルの回り方はあるけみすと準拠：
//   ・セットした枠を順に1巡し、それぞれの枠に設定した「使用回数」だけ使う（ABCDE→ABCDE…）
//   ・使用回数を使い切った枠・空の枠・MPが足りない枠は飛ばす
//   ・不発のときは MP も使用回数も減らず、**ポインタも進まない**（同じ枠を撃ち直す）
//     → 発動率の低い技を上に置くとそこで詰まる。並び順が戦術になる
//   ・不発のターンと、撃てる枠が無いときは通常攻撃（消費MP0）
//
// 行動順・追加行動・命中・クリティカル・ダメージは combat.js の関数をそのまま使う。
// ステータスの増減バフは**戦闘中ずっと続き、重ねがけで加算**される（あるけみすと準拠）。
// 状態異常（毒・麻痺など）はまだ入れていない。入れるときはここにフェーズを足す。
//
// ★純関数。rng を渡せば結果が再現する（テストとバランス検証のため）。
// ============================================================
import {
  resolveAttack, healOf, roll, goesFirst, rollExtraAction,
} from './combat.js'
import { STAT_KEYS } from './stats.js'
import { skillsOf, isPassive } from './skills.js'
import { classBonusOf } from './classBonus.js'

export const NORMAL_ATTACK_MULT = 1.0 // 通常攻撃の倍率（消費MP0）
export const MAX_TURNS = 100          // これを超えたら引き分け

// 職業の攻撃型。攻撃スキルの種別から決める（通常攻撃がSTR参照かINT参照か）
export const attackKindOf = (cls) => {
  const atk = skillsOf(cls).filter(s => s.kind === 'phys' || s.kind === 'mag')
  return atk.some(s => s.kind === 'mag') && !atk.some(s => s.kind === 'phys') ? 'mag' : 'phys'
}

// ステータスの増減バフは**戦闘中ずっと続き、重ねがけで加算**される（あるけみすと準拠）。
//   あるけみすとのバフにはターン数の記載が無く、「重ね掛け可能」「回避成功毎に+3%」と
//   累積前提で書かれている（ターン数が明記されているのは麻痺1T・沈黙2Tなどのデバフ側）。
// 下限は -90%（デバフを重ねてもステータスが0以下にならないように）
export const BUFF_MIN_PCT = -90
const effectiveStats = (base, buffs) => {
  const out = {}
  for (const k of STAT_KEYS) {
    const pct = buffs[k] || 0
    out[k] = pct ? Math.max(0, Math.round((base[k] || 0) * (1 + pct / 100))) : (base[k] || 0)
  }
  return out
}

const applyBuff = (buffs, table) => {
  for (const [k, pct] of Object.entries(table || {})) {
    buffs[k] = Math.max(BUFF_MIN_PCT, (buffs[k] || 0) + pct)
  }
}

// ===== パッシブ =====
// セットしたパッシブを1つのまとめ（pa）に畳む。**パッシブは複数セットできる**ので、
// 数で書けるものは足し算、形のあるものは配列で持つ。
const collectPassives = (passives) => {
  const pa = {
    hitBonus: 0, evaBonus: 0, critBonus: 0, procBonus: 0, defPenBonus: 0, healBonus: 0,
    misfireAtkMult: 1, debuffGuard: 0,
    statPct: {}, converts: [], rages: [], switches: [], lowHps: [],
    wall: null, gamble: null, dodgeCut: null,
  }
  for (const s of passives) {
    const p = s?.passive
    if (!p) continue
    for (const k of ['hitBonus', 'evaBonus', 'critBonus', 'procBonus', 'defPenBonus', 'healBonus', 'debuffGuard']) {
      if (p[k]) pa[k] += p[k]
    }
    if (p.misfireAtkMult) pa.misfireAtkMult = Math.max(pa.misfireAtkMult, p.misfireAtkMult)
    if (p.statPct) for (const [k, v] of Object.entries(p.statPct)) pa.statPct[k] = (pa.statPct[k] || 0) + v
    if (p.convert)    pa.converts.push(p.convert)
    if (p.rage)       pa.rages.push(p.rage)
    if (p.switchStat) pa.switches.push(p.switchStat)
    if (p.lowHp)      pa.lowHps.push(p.lowHp)
    if (p.wall)     pa.wall = p.wall
    if (p.gamble)   pa.gamble = p.gamble
    if (p.dodgeCut) pa.dodgeCut = p.dodgeCut
  }
  return pa
}

// いまのステータス。土台のバフに、状況で変わるパッシブぶんを足してから計算する。
//   acting=true … 自分の行動を解決している最中（元素共鳴のような「その行動だけ」の補正を含める）
export const liveStats = (side, acting = false) => {
  const b = { ...side.buffs }
  const add = (k, pct) => { b[k] = Math.max(BUFF_MIN_PCT, (b[k] || 0) + pct) }
  // バーサク・執行本能：ダメージを与えるたびに乗るスタック
  if (side.rage > 0) for (const r of side.pa.rages) add(r.stat, Math.min(r.max, r.per * side.rage))
  // 闘争本能：HPが減るほど上がる（at% まで下がると max% で頭打ち）
  for (const l of side.pa.lowHps) {
    const hpPct = (side.hp / Math.max(1, side.base.hp)) * 100
    const t = Math.min(1, Math.max(0, (100 - hpPct) / Math.max(1, 100 - l.at)))
    if (t > 0) add(l.stat, l.max * t)
  }
  // 元素共鳴：直前と違うスキルを使うときだけ（重複しない＝毎回同じ+10%）
  if (acting && side.switchOn) for (const s of side.pa.switches) add(s.stat, s.pct)
  const eff = effectiveStats(side.base, b)
  // 魔導剣術：INTの20%をSTRへ「変換」する。移した元は減る
  for (const c of side.pa.converts) {
    const moved = Math.round((eff[c.from] || 0) * (c.pct / 100))
    eff[c.from] = Math.max(0, (eff[c.from] || 0) - moved)
    eff[c.to] = (eff[c.to] || 0) + moved
  }
  return eff
}

// 戦闘用の1サイドを作る。slots = [{ skill, uses }]（順番が発動順）
// ★パッシブは発動順のローテーションから外す。職業補正はスキルとは別枠で常時かかる
export const createSide = (fighter) => {
  const stats = {}
  for (const k of STAT_KEYS) stats[k] = fighter.stats?.[k] ?? fighter[k] ?? 0
  const all = (fighter.slots || skillsOf(fighter.cls).map(s => ({ skill: s, uses: 3 })))
    .filter(s => s?.skill)
    .map(s => ({ skill: s.skill, uses: s.uses ?? 3 }))
  const passives = all.filter(s => isPassive(s.skill)).map(s => s.skill)
  const pa = collectPassives(passives)
  const bonus = classBonusOf(fighter.cls)
  const buffs = {}
  if (bonus?.stats) applyBuff(buffs, bonus.stats)   // 職業補正（就いている職業だけ）
  applyBuff(buffs, pa.statPct)                      // パッシブの常時ステータス補正
  return {
    name: fighter.name || fighter.cls || '?',
    cls: fighter.cls,
    kind: fighter.kind || attackKindOf(fighter.cls),
    base: stats,
    hp: stats.hp,
    mp: stats.mp,
    slots: all.filter(s => !isPassive(s.skill)),  // 発動順に回るのはパッシブ以外だけ
    passives,
    pa,
    healMult: bonus?.healMult ?? 1,   // 異端審問官は自身の回復量0.8倍
    ptr: 0,
    buffs,          // 自分にかかっているバフ（職業補正とパッシブぶんを最初から乗せておく）
    regen: null,    // { rate, turns }
    mpRegen: null,  // { rate, turns }
    rage: 0,        // バーサク・執行本能のスタック数
    acts: 0,        // 自分が行動した回数（骸の壁が5回ごとに見る）
    wallPct: pa.wall ? pa.wall.pct : 0,  // 骸の壁は戦闘開始時から乗る（重複しない）
    guards: pa.debuffGuard,              // 心身一如：デバフを打ち消せる残り回数
    lastSkill: null,                     // 元素共鳴が見る「直前に使ったスキル」
    switchOn: false,
  }
}

// このスキルを撃つのに要るMP。mpPct を持つスキルは「そのときの残りMPの割合」を払う
// （マナボルト＝現在MPの20%。撃つほど1回の消費が減るので、実質的に撃ち切れない）
export const mpCostOf = (side, skill) =>
  skill?.mpPct ? Math.floor((side?.mp || 0) * skill.mpPct) : (skill?.mp || 0)

// いま撃てる枠を ptr から探す。見つからなければ null（＝通常攻撃）
const findSlot = (side) => {
  const n = side.slots.length
  for (let i = 0; i < n; i++) {
    const idx = (side.ptr + i) % n
    const s = side.slots[idx]
    if (!s || !s.skill) continue
    if (s.uses <= 0) continue
    // MP不足の枠は飛ばす（使用回数は減らない）。割合消費はMPが1でも残っていれば撃てる
    if (s.skill.mpPct) { if (side.mp <= 0) continue }
    else if (s.skill.mp > side.mp) continue
    return idx
  }
  return null
}

// このターン使うスキル（発動判定の前）。行動順の優先度を知るために先に覗く
export const peekSkill = (side) => {
  const idx = findSlot(side)
  return idx === null ? null : side.slots[idx].skill
}

// 受けるとき側の軽減。骸の壁（常時）と竜鱗の加護（確率）はここでまとめて掛ける
const applyIncoming = (foe, dmg, rng, log) => {
  if (dmg <= 0) return 0
  let d = dmg
  if (foe.wallPct) d *= (1 - foe.wallPct / 100)
  const dc = foe.pa.dodgeCut
  if (dc && roll(dc.pct, rng)) {
    d *= (1 - dc.cut / 100)
    log.push({ side: foe.name, type: 'dodgeCut' })
  }
  const out = Math.max(1, Math.floor(d))
  foe.hp -= out
  return out
}

// 回復量。聖職者の「回復量+20%」と、異端審問官の「自身の回復量0.8倍」がここで効く
const healAmount = (side, eff, rate) =>
  Math.max(1, Math.floor(healOf(eff, rate) * (1 + side.pa.healBonus / 100) * side.healMult))

// デバフを相手へ入れる。心身一如を持っていると1回だけ打ち消される
const applyDebuff = (foe, table, log) => {
  const isDebuff = Object.values(table || {}).some(v => v < 0)
  if (isDebuff && foe.guards > 0) {
    foe.guards -= 1
    log.push({ side: foe.name, type: 'debuffGuard' })
    return
  }
  applyBuff(foe.buffs, table)
}

// 1回の行動を解決する。戻り値はログ用の1件
const takeAction = (me, foe, rng, log) => {
  const idx = findSlot(me)
  const slot = idx === null ? null : me.slots[idx]
  const skill = slot?.skill || null

  // 発動判定。不発ならMPも使用回数も減らず、ポインタも進めない
  //   ★不発はバーサク・執行本能のスタックをリセットする
  if (skill && !roll(skill.proc + me.pa.procBonus, rng)) {
    log.push({ side: me.name, type: 'misfire', skill: skill.name })
    me.rage = 0
    normalAttack(me, foe, rng, log, me.pa.misfireAtkMult)  // 居合の構えはここで威力2倍
    return
  }
  if (!skill) { me.rage = 0; normalAttack(me, foe, rng, log); return }

  me.mp -= mpCostOf(me, skill)
  slot.uses -= 1
  me.ptr = (idx + 1) % me.slots.length

  // 元素共鳴：直前に使ったスキルと違えば、この行動だけ補正が乗る
  me.switchOn = me.lastSkill !== null && me.lastSkill !== skill.name
  me.lastSkill = skill.name
  me.acts += 1

  const eMe = liveStats(me, true)
  const eFoe = liveStats(foe)

  if (skill.kind === 'phys' || skill.kind === 'mag') {
    let raw = 0
    let crit = false
    let hits = 0
    // 第六感の「貫通+10%」はスキルの防御貫通に足す
    const defPen = Math.min(1, (skill.defPen || 0) + me.pa.defPenBonus / 100)
    for (let h = 0; h < (skill.hits || 1); h++) {
      const r = resolveAttack({
        attacker: eMe, defender: eFoe, mult: skill.mult, kind: skill.kind,
        defPen, add: skill.add || null,
        sureHit: !!skill.sureHit, sureCrit: !!skill.sureCrit, noCrit: !!skill.noCrit,
        hitBonus: me.pa.hitBonus, evaBonus: foe.pa.evaBonus, critBonus: me.pa.critBonus,
      }, rng)
      raw += r.damage
      if (r.hit) hits++
      if (r.crit && r.hit) crit = true
    }
    // ギャンブルボディ：当たったとき、確率で威力が振れる
    const g = me.pa.gamble
    if (g && hits > 0) {
      const v = rng() * 100
      if (v < g.up) raw = Math.floor(raw * g.upMult)
      else if (v < g.up + g.down) raw = Math.floor(raw * g.downMult)
    }
    const dmg = applyIncoming(foe, raw, rng, log)
    // バーサク・執行本能：ダメージを与えたら+1スタック、全部外れたらリセット
    if (me.pa.rages.length) me.rage = hits > 0 ? me.rage + 1 : 0
    // 吸収：与えたダメージの一定割合を自分のHPへ（ソウルドレイン・ブラッティロアなど）
    let drained = 0
    if (skill.drain > 0 && dmg > 0) {
      drained = Math.max(1, Math.floor(dmg * skill.drain))
      me.hp = Math.min(me.base.hp, me.hp + drained)
    }
    log.push({ side: me.name, type: 'skill', skill: skill.name, damage: dmg, crit, hits, of: skill.hits || 1, drain: drained })
  } else if (skill.kind === 'heal') {
    if (skill.heal) {
      const amt = healAmount(me, eMe, skill.heal.rate)
      me.hp = Math.min(me.base.hp, me.hp + amt)
      log.push({ side: me.name, type: 'heal', skill: skill.name, heal: amt })
    }
    if (skill.regen)   { me.regen   = { ...skill.regen };   log.push({ side: me.name, type: 'regen', skill: skill.name }) }
    if (skill.mpRegen) { me.mpRegen = { ...skill.mpRegen }; log.push({ side: me.name, type: 'mpRegen', skill: skill.name }) }
  }

  // 骸の壁：戦闘開始時と自分の行動5回ごとに得る（重複しないので、掛け直すだけ）
  if (me.pa.wall && me.acts % me.pa.wall.every === 0) me.wallPct = me.pa.wall.pct

  // バフ・デバフ（攻撃スキルに付いていることもある）
  if (skill.buff) {
    if (skill.buff.self)  applyBuff(me.buffs, skill.buff.self)
    if (skill.buff.enemy) applyDebuff(foe, skill.buff.enemy, log)
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
}

// 通常攻撃。mult は居合の構え（不発時2倍）のための倍率
const normalAttack = (me, foe, rng, log, multScale = 1) => {
  const eMe = liveStats(me, true)
  const eFoe = liveStats(foe)
  const r = resolveAttack({
    attacker: eMe, defender: eFoe, mult: NORMAL_ATTACK_MULT * multScale, kind: me.kind,
    defPen: me.pa.defPenBonus / 100,
    hitBonus: me.pa.hitBonus, evaBonus: foe.pa.evaBonus, critBonus: me.pa.critBonus,
  }, rng)
  const dmg = applyIncoming(foe, r.damage, rng, log)
  log.push({ side: me.name, type: 'normal', damage: dmg, crit: r.crit, hit: r.hit, mult: multScale })
}

// ターン終了時の持続効果（回復）
const tickRegen = (side, log) => {
  const eff = liveStats(side)
  if (side.regen?.turns > 0) {
    const amt = healAmount(side, eff, side.regen.rate)
    side.hp = Math.min(side.base.hp, side.hp + amt)
    side.regen.turns -= 1
    log.push({ side: side.name, type: 'regenTick', heal: amt })
  }
  if (side.mpRegen?.turns > 0) {
    const amt = healAmount(side, eff, side.mpRegen.rate)
    side.mp = Math.min(side.base.mp, side.mp + amt)
    side.mpRegen.turns -= 1
    log.push({ side: side.name, type: 'mpRegenTick', mp: amt })
  }
}

// 戦闘を最後まで回す。fighters は createSide に渡せる形
export const runBattle = (fighterA, fighterB, { rng = Math.random, maxTurns = MAX_TURNS } = {}) => {
  const a = createSide(fighterA)
  const b = createSide(fighterB)
  const log = []
  let turn = 1

  for (; turn <= maxTurns; turn++) {
    // 行動順：このターン撃つ予定のスキルの優先度 → AGI → ランダム
    const eA = liveStats(a)
    const eB = liveStats(b)
    const pA = peekSkill(a)?.priority || 0
    const pB = peekSkill(b)?.priority || 0
    const order = goesFirst(eA, eB, pA, pB, rng) ? [[a, b], [b, a]] : [[b, a], [a, b]]

    for (const [me, foe] of order) {
      if (a.hp <= 0 || b.hp <= 0) break
      takeAction(me, foe, rng, log)
      if (foe.hp <= 0) break
      // 追加行動（相手よりAGIが高いときだけ・上限50%）
      const em = liveStats(me)
      const ef = liveStats(foe)
      if (rollExtraAction(em, ef, rng)) {
        log.push({ side: me.name, type: 'extra' })
        takeAction(me, foe, rng, log)
      }
    }

    if (a.hp <= 0 || b.hp <= 0) break
    tickRegen(a, log)
    tickRegen(b, log)
    if (a.hp <= 0 || b.hp <= 0) break
  }

  const winner = a.hp <= 0 && b.hp <= 0 ? 'draw' : a.hp <= 0 ? 'b' : b.hp <= 0 ? 'a' : 'draw'
  return { winner, turns: Math.min(turn, maxTurns), log, a, b }
}
