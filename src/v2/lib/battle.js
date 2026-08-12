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
// 状態異常（毒・麻痺など）はまだ入れていない。入れるときはここにフェーズを足す。
//
// ★純関数。rng を渡せば結果が再現する（テストとバランス検証のため）。
// ============================================================
import {
  resolveAttack, healOf, roll, goesFirst, rollExtraAction,
} from './combat.js'
import { STAT_KEYS } from './stats.js'
import { skillsOf } from './skills.js'

export const NORMAL_ATTACK_MULT = 1.0 // 通常攻撃の倍率（消費MP0）
export const MAX_TURNS = 100          // これを超えたら引き分け

// 職業の攻撃型。攻撃スキルの種別から決める（通常攻撃がSTR参照かINT参照か）
export const attackKindOf = (cls) => {
  const atk = skillsOf(cls).filter(s => s.kind === 'phys' || s.kind === 'mag')
  return atk.some(s => s.kind === 'mag') && !atk.some(s => s.kind === 'phys') ? 'mag' : 'phys'
}

// バフ（%）を乗せた実効ステータス。重ねがけは上書き（ターン数もリセット）
const effectiveStats = (base, buffs) => {
  const out = {}
  for (const k of STAT_KEYS) {
    const pct = buffs[k]?.pct || 0
    out[k] = pct ? Math.max(0, Math.round((base[k] || 0) * (1 + pct / 100))) : (base[k] || 0)
  }
  return out
}

const applyBuff = (buffs, table, turns) => {
  for (const [k, pct] of Object.entries(table || {})) buffs[k] = { pct, turns }
}

// ターン終了時にバフの残りターンを減らす
const tickBuffs = (buffs) => {
  for (const k of Object.keys(buffs)) {
    buffs[k].turns -= 1
    if (buffs[k].turns <= 0) delete buffs[k]
  }
}

// 戦闘用の1サイドを作る。slots = [{ skill, uses }]（順番が発動順）
export const createSide = (fighter) => {
  const stats = {}
  for (const k of STAT_KEYS) stats[k] = fighter.stats?.[k] ?? fighter[k] ?? 0
  const slots = (fighter.slots || skillsOf(fighter.cls).map(s => ({ skill: s, uses: 3 })))
    .map(s => ({ skill: s.skill, uses: s.uses ?? 3 }))
  return {
    name: fighter.name || fighter.cls || '?',
    cls: fighter.cls,
    kind: fighter.kind || attackKindOf(fighter.cls),
    base: stats,
    hp: stats.hp,
    mp: stats.mp,
    slots,
    ptr: 0,
    buffs: {},      // 自分にかかっているバフ
    regen: null,    // { rate, turns }
    mpRegen: null,  // { rate, turns }
  }
}

// いま撃てる枠を ptr から探す。見つからなければ null（＝通常攻撃）
const findSlot = (side) => {
  const n = side.slots.length
  for (let i = 0; i < n; i++) {
    const idx = (side.ptr + i) % n
    const s = side.slots[idx]
    if (!s || !s.skill) continue
    if (s.uses <= 0) continue
    if (s.skill.mp > side.mp) continue   // MP不足の枠は飛ばす（使用回数は減らない）
    return idx
  }
  return null
}

// このターン使うスキル（発動判定の前）。行動順の優先度を知るために先に覗く
export const peekSkill = (side) => {
  const idx = findSlot(side)
  return idx === null ? null : side.slots[idx].skill
}

// 1回の行動を解決する。戻り値はログ用の1件
const takeAction = (me, foe, rng, log) => {
  const idx = findSlot(me)
  const slot = idx === null ? null : me.slots[idx]
  const skill = slot?.skill || null

  // 発動判定。不発ならMPも使用回数も減らず、ポインタも進めない
  if (skill && !roll(skill.proc, rng)) {
    log.push({ side: me.name, type: 'misfire', skill: skill.name })
    normalAttack(me, foe, rng, log)
    return
  }
  if (!skill) { normalAttack(me, foe, rng, log); return }

  me.mp -= skill.mp
  slot.uses -= 1
  me.ptr = (idx + 1) % me.slots.length

  const eMe = effectiveStats(me.base, me.buffs)
  const eFoe = effectiveStats(foe.base, foe.buffs)

  if (skill.kind === 'phys' || skill.kind === 'mag') {
    let dmg = 0
    let crit = false
    let hits = 0
    for (let h = 0; h < (skill.hits || 1); h++) {
      const r = resolveAttack({
        attacker: eMe, defender: eFoe, mult: skill.mult, kind: skill.kind,
        defPen: skill.defPen || 0, add: skill.add || null,
        sureHit: !!skill.sureHit, sureCrit: !!skill.sureCrit, noCrit: !!skill.noCrit,
      }, rng)
      dmg += r.damage
      if (r.hit) hits++
      if (r.crit && r.hit) crit = true
    }
    foe.hp -= dmg
    log.push({ side: me.name, type: 'skill', skill: skill.name, damage: dmg, crit, hits, of: skill.hits || 1 })
  } else if (skill.kind === 'heal') {
    if (skill.heal) {
      const amt = healOf(eMe, skill.heal.rate)
      me.hp = Math.min(me.base.hp, me.hp + amt)
      log.push({ side: me.name, type: 'heal', skill: skill.name, heal: amt })
    }
    if (skill.regen)   { me.regen   = { ...skill.regen };   log.push({ side: me.name, type: 'regen', skill: skill.name }) }
    if (skill.mpRegen) { me.mpRegen = { ...skill.mpRegen }; log.push({ side: me.name, type: 'mpRegen', skill: skill.name }) }
  }

  // バフ・デバフ（攻撃スキルに付いていることもある）
  if (skill.buff) {
    if (skill.buff.self)  applyBuff(me.buffs,  skill.buff.self,  skill.buff.turns)
    if (skill.buff.enemy) applyBuff(foe.buffs, skill.buff.enemy, skill.buff.turns)
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
}

const normalAttack = (me, foe, rng, log) => {
  const eMe = effectiveStats(me.base, me.buffs)
  const eFoe = effectiveStats(foe.base, foe.buffs)
  const r = resolveAttack({ attacker: eMe, defender: eFoe, mult: NORMAL_ATTACK_MULT, kind: me.kind }, rng)
  foe.hp -= r.damage
  log.push({ side: me.name, type: 'normal', damage: r.damage, crit: r.crit, hit: r.hit })
}

// ターン終了時の持続効果（回復）
const tickRegen = (side, log) => {
  const eff = effectiveStats(side.base, side.buffs)
  if (side.regen?.turns > 0) {
    const amt = healOf(eff, side.regen.rate)
    side.hp = Math.min(side.base.hp, side.hp + amt)
    side.regen.turns -= 1
    log.push({ side: side.name, type: 'regenTick', heal: amt })
  }
  if (side.mpRegen?.turns > 0) {
    const amt = healOf(eff, side.mpRegen.rate)
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
    const eA = effectiveStats(a.base, a.buffs)
    const eB = effectiveStats(b.base, b.buffs)
    const pA = peekSkill(a)?.priority || 0
    const pB = peekSkill(b)?.priority || 0
    const order = goesFirst(eA, eB, pA, pB, rng) ? [[a, b], [b, a]] : [[b, a], [a, b]]

    for (const [me, foe] of order) {
      if (a.hp <= 0 || b.hp <= 0) break
      takeAction(me, foe, rng, log)
      if (foe.hp <= 0) break
      // 追加行動（相手よりAGIが高いときだけ・上限50%）
      const em = effectiveStats(me.base, me.buffs)
      const ef = effectiveStats(foe.base, foe.buffs)
      if (rollExtraAction(em, ef, rng)) {
        log.push({ side: me.name, type: 'extra' })
        takeAction(me, foe, rng, log)
      }
    }

    if (a.hp <= 0 || b.hp <= 0) break
    tickRegen(a, log)
    tickRegen(b, log)
    tickBuffs(a.buffs)
    tickBuffs(b.buffs)
    if (a.hp <= 0 || b.hp <= 0) break
  }

  const winner = a.hp <= 0 && b.hp <= 0 ? 'draw' : a.hp <= 0 ? 'b' : b.hp <= 0 ? 'a' : 'draw'
  return { winner, turns: Math.min(turn, maxTurns), log, a, b }
}
