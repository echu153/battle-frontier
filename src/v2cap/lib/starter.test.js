// v2cap：初期装備（キャラ作成で配る）の決まりを固定するテスト（node --test）
// 【確定】2026-10-12 ユーザー指示「キャラ作成時そのクラスに対応する装備一式（lv１）」＋案を承認（「装飾品だけ古びた○○にして」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { START_CLASSES, canEquipType, attackKindOf } from './jobs.js'
import { ITEMS, ITEM_BY_ID, STARTER_ITEMS, STARTER_SET, STARTER_LV, STARTER_AREA, starterIdsOf, SLOTS, slotsFor } from './equipment.js'
import { powerAt } from './gear.js'
import { bodyPowerAt } from './level.js'
import { scrapAreaOf, canCraft, enhanceCostOf } from './smith.js'

test('どの初期職にも7枠そろった初期装備がある（枠の順・必要LV1・その職業が装備できる武器）', () => {
  assert.deepEqual(Object.keys(STARTER_SET).sort(), [...START_CLASSES].sort())
  for (const cls of START_CLASSES) {
    const ids = starterIdsOf(cls)
    assert.equal(ids.length, SLOTS.length, cls)
    ids.forEach((id, i) => {
      const item = ITEM_BY_ID[id]
      assert.ok(item, `${cls}の${id}が一覧にある`)
      assert.deepEqual([item.lv, item.area, item.rarity], [STARTER_LV, STARTER_AREA, 'N'], id)
      assert.ok(slotsFor(item).includes(SLOTS[i]), `${id}は${SLOTS[i]}に着けられる`)
    })
    assert.ok(canEquipType(cls, ITEM_BY_ID[ids[0]].type), `${cls}は初期装備の武器を装備できる`)
  }
  assert.deepEqual(starterIdsOf('狂戦士'), [], '上位職には無い（キャラ作成で選べない）')
  assert.deepEqual(starterIdsOf('ないクラス'), [])
})

test('案のとおり：前に出る職業（戦士・槍使い・僧侶）は重鎧・ほかは軽装／物理職は耳飾り・魔法職は指輪／武器は職業の代表', () => {
  for (const cls of START_CLASSES) {
    const s = STARTER_SET[cls]
    assert.equal(s.line, ['戦士', '槍使い', '僧侶'].includes(cls) ? '重鎧' : '軽装', cls)
    assert.equal(s.acc, attackKindOf(cls) === 'mag' ? 'リング' : 'イヤリング', cls)
  }
  assert.deepEqual(Object.fromEntries(START_CLASSES.map(c => [c, STARTER_SET[c].weapon])), {
    剣士:'刀', 戦士:'両手剣', 槍使い:'槍', 格闘家:'拳', 盗賊:'短剣', 弓使い:'弓', 銃士:'銃', 魔法使い:'杖', 呪術師:'杖', 僧侶:'杖', 薬師:'書',
  })
})

test('名前は「見習いの◯◯」、装飾品だけ「古びた◯◯」（ユーザー指示）。名前は1560点とも初期装備どうしとも重ならない', () => {
  for (const it of STARTER_ITEMS) {
    if (it.part === 'アクセ') assert.match(it.name, /^古びた/, it.id)
    else assert.match(it.name, /^見習いの/, it.id)
  }
  assert.equal(ITEM_BY_ID['0N:イヤリング'].name, '古びた耳飾り')
  assert.equal(ITEM_BY_ID['0N:リング'].name, '古びた指輪')
  const names = [...ITEMS, ...STARTER_ITEMS].map(i => i.name)
  assert.equal(new Set(STARTER_ITEMS.map(i => i.name)).size, STARTER_ITEMS.length)
  for (const it of STARTER_ITEMS) assert.equal(names.filter(n => n === it.name).length, 1, `${it.name}は1つだけ`)
})

test('初期装備はどこにも落ちない・作れない（エリア×レア度の1560点には入らない）。7枠そろうとLV1の本体くらいの強さ', () => {
  assert.equal(ITEMS.length, 1560)
  for (const it of STARTER_ITEMS) {
    assert.ok(!ITEMS.includes(it), `${it.id}は落ちる・作る一覧に入らない`)
    assert.equal(canCraft(it), false)
    assert.equal(scrapAreaOf(it), 1, '分解すると始まりの森の残骸')
    assert.equal(enhanceCostOf(it, { ilv: STARTER_LV, plus: 0 }).scrap, 0, '強化は残骸なし（Goldだけ・2026-10-12 ユーザー指示）')
  }
  for (const cls of START_CLASSES) {
    const total = starterIdsOf(cls).reduce((t, id) => t + powerAt(ITEM_BY_ID[id], STARTER_LV), 0)
    assert.ok(Math.abs(total - bodyPowerAt(1)) <= 3, `${cls}：7枠で${total}（LV1の本体は${bodyPowerAt(1)}）`)
  }
  // 始まりの森のノーマル（必要LV5）のほうが強い＝拾ったら着け替える
  assert.ok(powerAt(ITEM_BY_ID['1N:刀'], 5) > powerAt(ITEM_BY_ID['0N:刀'], 1))
})
