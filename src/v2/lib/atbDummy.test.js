// ATBの仮想敵（試し撃ち用のかかし）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dummyFoes, bossHpOf, KITS } from './atbDummy.js'
import { createAtb, step } from './atb.js'
import { calcPower } from './stats.js'

const me = { name:'自分', cls:'戦士', stats:{ hp:4000, mp:400, str:300, dex:200, agi:200, int_stat:100, vit:250, luk:120 }, slots: [] }

test('bossHpOf はユニークボスの式のまま（設計の記録。仮想敵はもう使っていない）', () => {
  assert.equal(bossHpOf(2000), 192000)                    // 96 × P（P=2000が基準）
  assert.ok(bossHpOf(4000) / bossHpOf(2000) > 2, '戦闘力2倍でHPは2倍より厚くなる')
  assert.ok(bossHpOf(4000) / bossHpOf(2000) < 2.5)
})

test('仮想敵は自分の戦闘力とAGIから組み立てられる', () => {
  const list = dummyFoes(me)
  const p = calcPower(me.stats)
  const even = list.find(d => d.key === 'even')
  assert.equal(even.power, p, '【等速】は自分と同じ戦闘力')
  // ★2026-08-23：HPはユニークボスの式ではなく「同じ戦闘力のキャラのHP×BOSS_HP_MULT」
  assert.ok(even.hp > 0)
  assert.equal(even.hp, even.make().stats.hp, '一覧のHPと実物のHPが合っている')
  assert.ok(even.hp < bossHpOf(p) / 10, '昔のユニークボス式ほど厚くない（測定にならないため）')
  assert.equal(even.make().stats.agi, me.stats.agi, '【等速】はAGIも同じ')
  assert.equal(list.find(d => d.key === 'fast').make().stats.agi, me.stats.agi * 2)
  assert.equal(list.find(d => d.key === 'slow').make().stats.agi, me.stats.agi * 0.5)
  assert.equal(list.find(d => d.key === 'x2').power, p * 2)
  // 技は5枠・使用回数が多い（かかしなので途中で手が止まらない）
  for (const d of list.filter(d => d.key !== 'mokujin')) {
    const f = d.make()
    assert.equal(f.slots.length, 5, d.key)
    assert.ok(f.slots[0].uses >= 99, d.key)
    assert.ok(f.stats.mp > 0, d.key)
  }
})

test('木人は殴り返してこない', () => {
  const st = createAtb(me, dummyFoes(me).find(d => d.key === 'mokujin').make(), { maxSec: 120 })
  for (let i = 0; i < 600; i++) step(st, 0.1)   // 60秒
  assert.equal(st.a.hp, st.a.base.hp, '自分のHPが1も減らない')
  assert.ok(st.b.base.hp - st.b.hp > 0, 'こちらの与ダメージだけが溜まる')
})

test('仮想ボスは大技（必要ゲージの重い技）を持っている', () => {
  for (const [key, kit] of Object.entries(KITS)) {
    assert.ok(kit.some(s => s.proc <= 60), `${key} に大技が無い`)
    assert.equal(kit.length, 5, key)
  }
})
