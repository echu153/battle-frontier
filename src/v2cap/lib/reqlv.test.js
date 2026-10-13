// v2cap：必要LV（2026-10-13 ユーザー指示「レア、エピック、レジェンドの必要レベル5さげて、戦闘力はそのままでいい」）：node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { ITEMS, ITEM_BY_ID, STARTER_ITEMS, needLvOf, reqLvOf, REQ_LV_DISCOUNT } from './equipment.js'
import { powerAt, effectPct, reqPctOf, PENALTY_PER_LV } from './gear.js'

test('【確定】必要LV＝アイテムLV − 5（レア・エピック・レジェンダリー）・ノーマルと初期装備はそのまま', () => {
  assert.deepEqual(REQ_LV_DISCOUNT, { N:0, R:5, E:5, L:5 })
  for (const item of ITEMS) {
    assert.equal(item.lv, reqLvOf(item.area, item.rarity), 'アイテムLVは前の表のまま')
    assert.equal(needLvOf(item), item.rarity === 'N' ? item.lv : item.lv - 5, item.id)
  }
  // 始まりの森：ノーマル5・レア5・エピック10・レジェンダリー15（前は 5/10/15/20）
  const forest = (r) => needLvOf(ITEMS.find(i => i.area === 1 && i.rarity === r))
  assert.deepEqual(['N', 'R', 'E', 'L'].map(forest), [5, 5, 10, 15])
  // 深淵の海溝：75/75/80/85（前は 75/80/85/90）
  const abyss = (r) => needLvOf(ITEMS.find(i => i.area === 15 && i.rarity === r))
  assert.deepEqual(['N', 'R', 'E', 'L'].map(abyss), [75, 75, 80, 85])
  for (const it of Object.values(STARTER_ITEMS || {})) assert.equal(needLvOf(it), 1, '初期装備はLV1')
  assert.equal(needLvOf({ rarity:'L', lv:3 }), 1, '1より下にはならない')
})

test('【確定】戦闘力はそのまま（アイテムLVで決まる）・効果の下がり方だけ必要LVで見る', () => {
  const l = ITEMS.find(i => i.area === 4 && i.rarity === 'L' && i.part === '武器')   // アイテムLV35・必要LV30
  assert.equal(l.lv, 35)
  // 強さはアイテムLVのまま（必要LVの数字では計算しない）
  assert.equal(powerAt(l, l.lv), powerAt(ITEM_BY_ID[l.id], 35))
  assert.notEqual(powerAt(l, l.lv), powerAt(l, needLvOf(l)))
  // LV30なら100%（前はアイテムLV35と比べて75%だった）
  assert.equal(reqPctOf(l, l.lv, 30), 100)
  assert.equal(effectPct(l.lv, 30), 100 - PENALTY_PER_LV * 5, '（前の見方なら75%）')
  assert.equal(reqPctOf(l, l.lv, 28), 100 - PENALTY_PER_LV * 2)
})

test('★装備の効果%は必ず reqPctOf（必要LV）で出す：effectPct にアイテムLVをそのまま渡す書き方が戻らないように', () => {
  const dirs = [new URL('../components/', import.meta.url), new URL('./', import.meta.url)]
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter(n => /\.(jsx?|mjs)$/.test(n) && !/\.test\.js$/.test(n))) {
      const src = readFileSync(new URL(f, dir), 'utf8')
      if (f === 'gear.js') continue
      assert.ok(!/\beffectPct\(/.test(src), `${f}：effectPct を直接呼ばず reqPctOf(item, ilv, lv) を使う`)
    }
  }
  const sim = readFileSync(new URL('../../../tools/v2cap-progress.mjs', import.meta.url), 'utf8')
  assert.ok(!/\beffectPct\(/.test(sim), 'シミュレーターも reqPctOf を使う')
})
