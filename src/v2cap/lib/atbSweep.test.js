// v2cap の ATB戦闘：全職業の全部の技をマクロでくり返し撃って、止まらないか・数がおかしくならないかを見る（node --test）
// ★技に新しい仕組みを足したとき、ATB（ターンの無い戦闘）で落ちたら気づけるように
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAtb, startMacro, runFor } from '../core/atb.js'
import { SKILLS, passiveOf } from './skills.js'
import { usableSkillNames } from './jobs.js'
import { slotsOf } from './loadout.js'
import { SPOTS, toFighter as enemyFighter } from './areas.js'
import { CAP_RULES } from './rules.js'

const makeRng = (seed) => {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const CLASSES = [...new Set(SKILLS.map(s => s.cls))]
const ALL_NAMES = SKILLS.map(s => s.name)

const player = (cls) => ({
  ...CAP_RULES, name: cls, cls,
  stats: { hp: 60000, mp: 3000, str: 400, dex: 300, agi: 300, int_stat: 400, vit: 300, luk: 150 },
  slots: slotsOf(usableSkillNames(cls, ALL_NAMES).map(name => ({ name, uses: 1 })), cls),
  passives: passiveOf(cls) ? [passiveOf(cls)] : [],
})

test('全職業：持っている技を全部マクロでくり返し撃っても止まらない・HPとMPが数のまま', () => {
  // 120秒もつように、HPだけ大きくしたボス（エリア10の③）
  const base = enemyFighter(SPOTS[29].roster.boss, 8)
  const boss = { ...base, boss: true, stats: { ...base.stats, hp: base.stats.hp * 1000 } }
  for (const cls of CLASSES) {
    const st = createAtb(player(cls), boss, { rng: makeRng(cls.length * 7 + 1), maxSec: 120 })
    // マクロは画面とサーバーでは8個までだが、エンジンは長さを問わない＝全部の技を1つのマクロでくり返す
    startMacro(st, 1, st.a.slots.map((_, i) => ({ idx: i })), true)
    runFor(st, 120)
    for (const s of [st.a, st.b]) {
      assert.ok(Number.isFinite(s.hp) && Number.isFinite(s.mp), `${cls}：HP・MPが数でなくなった`)
      assert.ok(Number.isFinite(s.gauge), `${cls}：ゲージが数でなくなった`)
      for (const v of Object.values(s.buffs)) assert.ok(Number.isFinite(v), `${cls}：バフが数でなくなった`)
    }
    const used = new Set(st.log.filter(l => l.side === cls && l.skill).map(l => l.skill))
    assert.ok(used.size >= 3, `${cls}：技がほとんど出ていない（${[...used].join('・')}）`)
    assert.ok(st.a.acted >= 20, `${cls}：120秒で行動が少なすぎる（${st.a.acted}回）`)
  }
})

test('上位職は自分の10個＋初期職の7個＝17個の技をATBで使える', () => {
  const st = createAtb(player('聖騎士'), { ...enemyFighter(SPOTS[0].roster.boss, 8) }, { rng: makeRng(1) })
  assert.equal(st.a.slots.length, 17)
  // ATBは回数でなくクールダウンで回す（回数の上限を持つ技＝狂鬼化などだけ、その上限）
  assert.ok(st.a.slots.every(s => s.uses === (s.skill.usesMax ?? 9999)))
})
