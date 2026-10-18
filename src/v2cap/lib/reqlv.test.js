// v2cap：必要LV（2026-10-13 一度エピック・レジェンダリーを −5 にして、同じ日にユーザー「やっぱ必要レベル戻していいや」で元の表に戻した）：node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { ITEMS, ITEM_BY_ID, STARTER_ITEMS, needLvOf, reqLvOf, REQ_LV_DISCOUNT } from './equipment.js'
import { powerAt, effectivePowerAt, isUnderLv } from './gear.js'

test('【確定】必要LVはアイテムLVと同じ（元の表に戻した）', () => {
  assert.deepEqual(REQ_LV_DISCOUNT, { N:0, R:0, E:0, L:0 })
  for (const item of ITEMS) {
    assert.equal(item.lv, reqLvOf(item.area, item.rarity), 'アイテムLVは前の表のまま')
    assert.equal(needLvOf(item), item.lv, item.id)
  }
  // 始まりの森：ノーマル5・レア10・エピック15・レジェンダリー20
  const forest = (r) => needLvOf(ITEMS.find(i => i.area === 1 && i.rarity === r))
  assert.deepEqual(['N', 'R', 'E', 'L'].map(forest), [5, 10, 15, 20])
  // 深淵の海溝：75/80/85/90
  const abyss = (r) => needLvOf(ITEMS.find(i => i.area === 15 && i.rarity === r))
  assert.deepEqual(['N', 'R', 'E', 'L'].map(abyss), [75, 80, 85, 90])
  for (const it of Object.values(STARTER_ITEMS || {})) assert.equal(needLvOf(it), 1, '初期装備はLV1')
  assert.equal(needLvOf({ rarity:'L', lv:0 }), 1, '1より下にはならない')
})

test('【確定】強さはアイテムLVで決まる・足りないかは必要LV（＝アイテムLV）で見る', () => {
  const l = ITEMS.find(i => i.area === 4 && i.rarity === 'L' && i.part === '武器')   // アイテムLV35・必要LV35
  const prev = ITEMS.find(i => i.area === 3 && i.rarity === 'L' && i.type === l.type)   // 必要LV30
  assert.equal(l.lv, 35)
  assert.equal(prev.lv, 30)
  assert.equal(powerAt(l, l.lv), powerAt(ITEM_BY_ID[l.id], 35))
  assert.equal(isUnderLv(l, l.lv, 35), false)
  assert.equal(isUnderLv(l, l.lv, 34), true)
  assert.equal(effectivePowerAt(l, l.lv, 35), powerAt(l, l.lv), '足りていれば元のまま')
  assert.equal(effectivePowerAt(l, l.lv, 30), powerAt(prev, prev.lv), '5足りないと、必要LV30の同じレア度・同じ種類と同じ（2026-10-18〜）')
})

test('★必要LVに足りない装備は必ず LV相当（effectivePowerAt／statsAt にいまのLV）：前の「効果%を掛ける」書き方が戻らないように', () => {
  // 2026-10-18 ユーザー選択「そのLV相当にする」。前は reqPctOf・effectPct・underLvPowerOf で効果%を掛けていた（最低10%）
  const old = /\b(reqPctOf|effectPct|underLvPowerOf|PENALTY_PER_LV|PENALTY_MIN_PCT)\b|statsAt\([^)]*\bpct\b/
  const dirs = [new URL('../components/', import.meta.url), new URL('./', import.meta.url)]
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter(n => /\.(jsx?|mjs)$/.test(n) && !/\.test\.js$/.test(n))) {
      const src = readFileSync(new URL(f, dir), 'utf8')
      assert.ok(!old.test(src), `${f}：効果%ではなく effectivePowerAt(item, ilv, lv, plus)／statsAt(item, ilv, lv, plus) を使う`)
    }
  }
  const sim = readFileSync(new URL('../../../tools/v2cap-progress.mjs', import.meta.url), 'utf8')
  assert.ok(!old.test(sim), 'シミュレーターも LV相当で数える')
})
