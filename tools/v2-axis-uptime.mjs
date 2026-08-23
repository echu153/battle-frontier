// ============================================================
// バトルフロンティアⅡ — 「職の軸」が実戦でどれくらい乗っているかを測る
// ------------------------------------------------------------
// 使い方: node tools/v2-axis-uptime.mjs [職業名]
//
// ★狙い：条件つきの効果（相手が出血していれば／溜めがあれば／空中なら…）は、
//   「実装されている」だけでは意味がなく、**実戦で条件が揃わないと死に効果**になる。
//   2026-08-23、暗殺者の起爆（急所突き）が実機で光らないことに気づいて作った。
//
// 測り方：
//   ・編成は2通り。「軸ねらい」＝軸に関わる技を優先して5枠／「ざっくり」＝ランダム5枠。
//     プレイヤーが軸を意識して組んだときと、適当に組んだときの両方を見る。
//   ・相手も2通り。ふつうの相手（殴ってくる）と、状態異常やバフを撒いてくる相手。
//   ・ATB とオート戦闘の両方で、**撃つ直前の実際の状態**を見て条件が揃っていたか数える。
// ============================================================
import { SKILLS, skillsOf, SKILL_BY_NAME } from '../src/v2/lib/skills.js'
import { CLASS_BONUS } from '../src/v2/lib/classBonus.js'
import { createAtb, step } from '../src/v2/lib/atb.js'
import {
  createSide, takeAction, tickAil, tickRegen, tickForesight, tickBleedAfterAct,
  lowHpMultOf, highHpMultOf,
} from '../src/v2/lib/battle.js'
import { hasAilment } from '../src/v2/lib/ailments.js'

const STATS = { hp: 4200, mp: 1600, str: 600, dex: 620, agi: 660, int_stat: 620, vit: 610, luk: 560 }
const SETS = 8       // 1職・1条件あたり何通りの編成を試すか
const RUNS = 3       // 1編成あたり何戦するか

// 条件つきの効果と、「乗っていたか」の見かた
const AXES = {
  consumeAil:  { label:'起爆（状態異常を消費）', on: (s, me, foe) => stacksOf(foe, s.consumeAil.key) > 0 },
  vsAil:       { label:'相手の状態異常の数で伸びる', on: (s, me, foe) => Object.keys(foe.ail || {}).length > 0 },
  vsBuff:      { label:'相手のバフの数で伸びる', on: (s, me, foe) => buffCount(foe) > 0 },
  drainIfAil:  { label:'相手が状態異常なら吸収', on: (s, me, foe) => hasAilment(foe.ail, s.drainIfAil.key) },
  whileStack:  { label:'溜めがあれば伸びる', on: (s, me) => (me[s.whileStack.key] || 0) > 0 },
  useRitual:   { label:'呪力を使い切る', on: (s, me) => (me.ritual || 0) > 0 },
  useCharge:   { label:'竜気を使い切る', on: (s, me) => (me.charge || 0) > 0 },
  whileForm:   { label:'獣を連れていれば伸びる', on: (s, me) => !!me.form },
  whileAir:    { label:'空中なら伸びる', on: (s, me) => !!me.air },
  whileGround: { label:'地上なら伸びる', on: (s, me) => !me.air },
  whileStance: { label:'納刀中なら伸びる', on: (s, me) => !!me.stance },
  combo:       { label:'直前の技しだいで伸びる', on: (s, me) => (s.combo.after || []).includes(me.lastSkill) },
  switchKind:  { label:'物理と魔法を交互に', on: (s, me) => !!me.lastKind && me.lastKind !== s.kind },
  repeat:      { label:'続けて撃つほど伸びる', on: (s, me) => (me.repeatCount || 0) > 0 },
  // ★この2つは「乗る／乗らない」ではなく段階的に伸びる。**実際に何%伸びたか**で測る
  lowHpBonus:  { label:'相手のHPが低いほど', grade: (s, me, foe) => (lowHpMultOf(s, foe) - 1) / (s.lowHpBonus.max / 100) },
  highHpBonus: { label:'自分のHPが高いほど', grade: (s, me) => (highHpMultOf(s, me) - 1) / (s.highHpBonus.max / 100) },
}
const KEYS = Object.keys(AXES)

const stacksOf = (side, key) => key === 'bleed' ? (side.ail.bleed?.stacks || 0) : (side.ail[key] ? 1 : 0)
const buffCount = (side) => Object.values(side.buffs || {}).filter(v => v > 0).length
const kindOf = (cls) => (CLASS_BONUS[cls]?.main === 'int_stat' ? 'mag' : 'phys')

const shuffle = (list) => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// 「軸ねらい」の編成：軸に関わる技（条件つきの技と、その条件を作る技）を先に入れる
const AXIS_MAKERS = {
  consumeAil:  (s) => !!s.ail || !!s.ailPerHit,
  vsAil:       (s) => !!s.ail || !!s.ailPerHit,
  drainIfAil:  (s) => !!s.ail || !!s.ailPerHit,
  whileStack:  (s) => !!s.ritual || !!s.chargeUp,
  useRitual:   (s) => !!s.ritual,
  useCharge:   (s) => !!s.chargeUp,
  whileForm:   (s) => !!s.form,
  whileAir:    (s) => !!s.airUp,
  whileGround: (s) => !s.airUp,
  whileStance: (s) => !!s.stance,
  combo:       (s, sk) => (sk.combo?.after || []).includes(s.name),
  switchKind:  (s, sk) => s.kind !== sk.kind && (s.kind === 'phys' || s.kind === 'mag'),
  repeat:      () => false,   // 連打は「枠を絞る」ことでしか作れない（後述）
}
const axisSlots = (cls) => {
  const list = skillsOf(cls)
  const users = list.filter(s => KEYS.some(k => s[k] !== undefined))
  if (!users.length) return null
  const sk = shuffle(users)[0]
  const key = KEYS.find(k => sk[k] !== undefined)
  // 連打・続けて撃つ系は、枠を1つに絞らないと条件が作れない（枠は順番に回るため）
  if (key === 'repeat') return [{ skill: sk, uses: 99 }]
  const makers = list.filter(s => s !== sk && (AXIS_MAKERS[key] ? AXIS_MAKERS[key](s, sk) : false))
  const rest = list.filter(s => s !== sk && !makers.includes(s))
  // ★条件を作る技を**先**に置く（枠は上から順に回るので、作る→使う の並びで毎周つながる）
  const maker = shuffle(makers)[0]
  const head = maker ? [maker, sk] : [sk]
  return [...head, ...shuffle(rest).slice(0, 1)].slice(0, 5).map(s => ({ skill: s, uses: 99 }))
}
const randomSlots = (cls) => shuffle(skillsOf(cls)).slice(0, 5).map(s => ({ skill: s, uses: 99 }))

// 相手：ふつう（殴るだけ）と、状態異常＆バフを撒いてくる相手
const FOES = {
  ふつう: () => ({ name:'foe', cls:'戦士', kind:'phys', stats: { ...STATS, hp: 9000 }, slots: [] }),
  搦め手: () => ({ name:'foe', cls:'戦士', kind:'phys', stats: { ...STATS, hp: 9000 }, slots: [
    { skill: SKILL_BY_NAME['防御態勢'], uses: 99 },
    { skill: SKILL_BY_NAME['毒刃'], uses: 99 },
    { skill: SKILL_BY_NAME['気合い'], uses: 99 },
    { skill: SKILL_BY_NAME['猛り斬り'], uses: 99 },
  ].filter(x => x.skill) }),
}

const tally = {}   // cls|key|編成 -> { atbOn, atbAll, autoOn, autoAll }
const bump = (cls, key, plan, mode, on) => {
  const t = ((tally[`${cls}\t${key}\t${plan}`] ||= { atbOn:0, atbAll:0, autoOn:0, autoAll:0 }))
  t[mode + 'All'] += 1
  if (on) t[mode + 'On'] += 1
}

const snapshot = (me, foe) => ({
  me: { air: me.air, form: me.form, ritual: me.ritual, charge: me.charge, stance: me.stance,
    lastKind: me.lastKind, lastSkill: me.lastSkill, repeatCount: me.repeatCount, hp: me.hp, base: me.base },
  foe: { ail: JSON.parse(JSON.stringify(foe.ail || {})), buffs: { ...foe.buffs }, hp: foe.hp, base: foe.base },
})

// オート戦闘を1ターンずつ回す（runBattle と同じ手順。途中の状態を見たいので自前で回す）
const runAutoWatched = (meF, foeF, onShot) => {
  const a = createSide(meF)
  const b = createSide(foeF)
  const log = []
  for (let turn = 1; turn <= 40; turn++) {
    for (const [me, foe] of [[a, b], [b, a]]) {
      if (a.hp <= 0 || b.hp <= 0) break
      const snap = snapshot(me, foe)
      const n = log.length
      takeAction(me, foe, Math.random, log)
      tickBleedAfterAct(me, log, foe)
      if (me === a) {
        for (const l of log.slice(n)) if (l.type === 'skill' && l.side === a.name) onShot(l, snap)
      }
    }
    if (a.hp <= 0 || b.hp <= 0) break
    a.bigGuard = 0; b.bigGuard = 0
    tickAil(a, log, b); tickAil(b, log, a)
    if (a.hp <= 0 || b.hp <= 0) break
    tickRegen(a, log, b); tickRegen(b, log, a)
    tickForesight(a); tickForesight(b)
  }
}

const only = process.argv[2]
const classes = [...new Set(SKILLS.map(s => s.cls))].filter(c => !only || c === only)

for (const cls of classes) {
  const list = skillsOf(cls)
  if (!list.some(s => KEYS.some(k => s[k] !== undefined))) continue
  for (const [planName, mk] of [['軸ねらい', axisSlots], ['ざっくり', randomSlots]]) {
    for (let n = 0; n < SETS; n++) {
      const slots = mk(cls)
      if (!slots) continue
      const me = { name:'me', cls, kind: kindOf(cls), stats: STATS, slots }
      const mkFoe = n % 2 ? FOES.搦め手 : FOES.ふつう

      for (let r = 0; r < RUNS; r++) {
        // ===== ATB =====
        const s = createAtb(me, mkFoe(), { rng: Math.random })
        s.a.auto = true; s.b.auto = true
        let seen = 0
        for (let i = 0; i < 900 && !s.over; i++) {
          const snap = snapshot(s.a, s.b)
          step(s, 0.1)
          for (const l of s.log.slice(seen)) {
            if (l.type !== 'skill' || l.side !== 'me') continue
            const sk = SKILL_BY_NAME[l.skill]
            if (!sk) continue
            for (const k of KEYS) if (sk[k] !== undefined) bump(cls, k, planName, 'atb', (AXES[k].grade || AXES[k].on)(sk, snap.me, snap.foe))
          }
          seen = s.log.length
        }
        // ===== オート戦闘 =====
        runAutoWatched(me, mkFoe(), (l, snap) => {
          const sk = SKILL_BY_NAME[l.skill]
          if (!sk) return
          for (const k of KEYS) if (sk[k] !== undefined) bump(cls, k, planName, 'auto', (AXES[k].grade || AXES[k].on)(sk, snap.me, snap.foe))
        })
      }
    }
  }
}

// ===== 出力 =====
const pct = (on, all) => all ? Math.round(on / all * 100) : null
const rows = []
for (const [id, t] of Object.entries(tally)) {
  const [cls, k, plan] = id.split('\t')
  rows.push({ cls, k, plan, atb: pct(t.atbOn, t.atbAll), auto: pct(t.autoOn, t.autoAll), n: t.atbAll + t.autoAll })
}
// 「軸ねらい」で組んでも乗らないものが本当の問題。そこを上に出す
const key = (r) => (r.plan === '軸ねらい' ? 0 : 1000) + Math.min(r.atb ?? 999, r.auto ?? 999)
rows.sort((a, b) => key(a) - key(b))
console.log('■ 職の軸が実戦で乗っている割合')
console.log('   「軸ねらい」＝軸に沿って組んだとき／「ざっくり」＝適当に5枠組んだとき')
console.log('   ⚠ は軸ねらいでも40%未満＝**組んでも揃わない**もの\n')
for (const r of rows) {
  const bad = r.plan === '軸ねらい' && ((r.atb ?? 100) < 40 || (r.auto ?? 100) < 40)
  console.log(`${bad ? '⚠' : ' '} ${r.cls.padEnd(10)} ${AXES[r.k].label.padEnd(22)} ${r.plan}  ATB ${String(r.atb ?? '-').padStart(3)}%  オート ${String(r.auto ?? '-').padStart(3)}%  （${r.n}回）`)
}
