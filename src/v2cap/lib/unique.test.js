// v2cap：ユニーク装備（ボス固有・2026-10-21）のテスト（node --test）
// ★ユーザー「一旦今のままで実装して、効果がすべて発動するかも実機確認して」
//   ・60個の一覧がユーザーの決まりどおりか（ボス・種類の数・必要LV・ステ）
//   ・60個すべての固有の能力が、本物の戦闘エンジンで発動するか（uniqueCheck.js＝ゲームの開発用の欄でも同じものが走る）
//   ・同じユニークは1つまで・装備とセットの毎ターン回復は合計6%まで（ユーザー選択）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UNIQUE_DEFS } from './uniqueDefs.js'
import {
  UNIQUE_ITEMS, UNIQUE_LV, ITEM_BY_ID, ITEMS, KINDS, WEAPON_TYPES, isUnique, uniquesOfSpot, uniqueIdOf, RARITY_COLOR, RARITY_LABEL,
} from './equipment.js'
import { SPOTS } from './areas.js'
import { statsAt, effectivePowerAt, powerAt, isUnderLv } from './gear.js'
import { equippedItems, toFighter, wornUniquesOf } from './loadout.js'
import { combinedFxOf, mergeFx } from './fxMerge.js'
import { setFxOf, armorSetsOf, isSetPiece } from './armorSets.js'
import { checkAllUniques, CHECK } from './uniqueCheck.js'
import { createSide, runBattle } from '../core/battle.js'
import { regenPctOf, REGEN_CAP_PCT } from '../core/battleSet.js'
import { UNIQUE_COLOR } from '../core/battleLog.js'
import { canCraft, craftErrorOf, scrapYieldOf, bulkPickable } from './smith.js'
import { dropLineOf } from './settleLines.js'

const POINTS = { 武器: 160, 鎧: 105, 頭: 80, 腕: 80, 足: 80, アクセ: 65 }
const sum = (s) => Object.values(s).reduce((t, v) => t + v, 0)

test('【確定】ユニークはボスだけが落とす：①②のボスは1つ・大ボス（③）は2つ＝60個。ボスの名前は場所の名簿と同じ', () => {
  assert.equal(UNIQUE_ITEMS.length, 60)
  for (const s of SPOTS) {
    const list = uniquesOfSpot(s.id)
    assert.equal(list.length, s.sub === 3 ? 2 : 1, `${s.name}`)
    for (const u of list) assert.equal(u.boss, s.roster.boss.name, `${u.name} のボス`)
    if (list.length === 2) assert.notEqual(list[0].kind, list[1].kind, '大ボスの2つは別の種類')
  }
  assert.equal(new Set(UNIQUE_ITEMS.map(u => u.id)).size, 60, 'id は重ならない')
  assert.equal(new Set(UNIQUE_ITEMS.map(u => u.name)).size, 60, '名前は重ならない')
  const taken = new Set(ITEMS.map(i => i.name))
  for (const u of UNIQUE_ITEMS) assert.ok(!taken.has(u.name), `${u.name} はふつうの装備の名前とかぶらない`)
})

test('【確定】種類：26種どれも2つ以上・武器は14種×2つ・防具はどの種類も3つまで', () => {
  const count = {}
  for (const u of UNIQUE_ITEMS) count[u.kind] = (count[u.kind] || 0) + 1
  for (const k of KINDS) {
    assert.ok((count[k.key] || 0) >= 2, `${k.key} は2つ以上`)
    if (k.line) assert.ok(count[k.key] <= 3, `${k.key} は3つまで`)
  }
  for (const w of WEAPON_TYPES) assert.equal(count[w], 2, `${w} は2つ`)
})

test('【確定】必要LVはどれも80。ステはユーザーが決めた値（LV80・+0）＝部位ごとのポイント（年輪の書だけユーザーの入力のまま161）', () => {
  for (const u of UNIQUE_ITEMS) {
    assert.equal(u.lv, UNIQUE_LV)
    assert.equal(u.rarity, 'U')
    const want = u.name === '年輪の書' ? 161 : POINTS[u.part]
    assert.equal(sum(u.dist), want, `${u.name} のステの合計`)
    // LV80・+0 のステは決めた値そのまま・+10 でちょうど2倍
    const s = statsAt(u, UNIQUE_LV, UNIQUE_LV, 0)
    for (const [k, v] of Object.entries(u.dist)) assert.equal(s[k], v, `${u.name} の ${k}`)
    const s10 = statsAt(u, UNIQUE_LV, UNIQUE_LV, 10)
    for (const [k, v] of Object.entries(u.dist)) assert.equal(s10[k], v * 2, `${u.name} +10 の ${k}`)
  }
  assert.equal(RARITY_LABEL.U, 'ユニーク')
  // 【確定】2026-10-21 ユーザー指定「この色ね」＝案のシートの「ユニーク」の文字の色。戦闘ログの行（今のⅡの battleLog.js）も同じ色
  assert.equal(RARITY_COLOR.U, '#ff6b82', '名前の色（赤）')
  assert.equal(UNIQUE_COLOR, RARITY_COLOR.U, '戦闘ログの「💎 ◯◯の△△！」の行も同じ色')
})

test('【確定】LV80より低いLVで着けると、ステは同じ割合のままそのLV相当に小さくなる（能力は全部効く）', () => {
  const u = ITEM_BY_ID[uniqueIdOf(1, '短剣')]
  assert.ok(isUnderLv(u, UNIQUE_LV, 20))
  const p20 = effectivePowerAt(u, UNIQUE_LV, 20, 0)
  const p80 = powerAt(u, UNIQUE_LV, 0)
  assert.ok(p20 < p80 && p20 > 0, `LV20では小さい（${p20} < ${p80}）`)
  const s = statsAt(u, UNIQUE_LV, 20, 0)
  // 割合はそのまま（AGIがいちばん多い・DEXとLUKも残る）
  assert.ok(s.agi >= s.luk && s.luk >= s.dex && s.dex >= s.str, JSON.stringify(s))
  // 能力（fx）は LV によらず同じものを渡す
  const prof = { class: '盗賊', lv: 20, equipped: { weapon: 1 } }
  const inv = [{ id: 1, base_id: u.id, ilv: UNIQUE_LV, plus: 0 }]
  assert.deepEqual(toFighter(prof, inv).setFx.onHitAils, u.fx.onHitAils)
})

test('【確定】60個すべての固有の能力が、本物の戦闘エンジンで発動する（ゲームの開発用の欄と同じ確かめ）', () => {
  const all = checkAllUniques()
  const bad = all.filter(r => !r.ok)
  assert.equal(bad.length, 0, bad.map(r => `${r.item.name}：${r.checks.filter(c => !c.ok).map(c => `${c.key} ${c.detail}`).join('／')}`).join('\n'))
  // 能力の項目はどれも確かめ方がある（新しい項目を足したら CHECK も足す）
  for (const u of UNIQUE_ITEMS) for (const k of Object.keys(u.fx)) assert.ok(CHECK[k], `${u.name} の ${k} の確かめ方`)
})

test('【確定】2026-10-21 ユーザー選択：同じユニークは1つまで（装飾品の2枠に同じものは着けられない・後ろの枠は数えない）', () => {
  const ring = UNIQUE_ITEMS.find(u => u.kind === 'リング')
  const inv = [{ id: 1, base_id: ring.id, ilv: 80 }, { id: 2, base_id: ring.id, ilv: 80 }]
  const prof = { class: '剣士', lv: 80, equipped: { acc1: 1, acc2: 2 } }
  const w = equippedItems(prof, inv)
  assert.ok(w.acc1 && !w.acc2, '2つ目は数えない')
  assert.equal(wornUniquesOf(prof, inv).length, 1)
  // ちがうユニークなら2つ着けられる
  const ring2 = UNIQUE_ITEMS.find(u => u.kind === 'リング' && u.id !== ring.id)
  const both = equippedItems({ ...prof }, [{ id: 1, base_id: ring.id, ilv: 80 }, { id: 2, base_id: ring2.id, ilv: 80 }])
  assert.ok(both.acc1 && both.acc2)
})

test('【確定】2026-10-21 ユーザー選択：装備とセットの毎ターン回復は合計6%まで（千年根の具足＋九頭の鱗衣＋ビッグスライムの指輪＋森の恵み）', () => {
  assert.equal(REGEN_CAP_PCT, 6)
  const pick = (n) => UNIQUE_ITEMS.find(u => u.name === n)
  const set = setFxOf(armorSetsOf([]))   // セットなし
  const fx = combinedFxOf(mergeFx(set, { regenPct: 2 }, '森の恵み'), [pick('千年根の具足'), pick('九頭の鱗衣'), pick('ビッグスライムの指輪')])
  assert.equal(fx.regenPct, 2 + 3 + 2 + 3, '足すと10%')
  const side = createSide({ name: 'a', cls: '剣士', kind: 'phys', stats: { hp: 1000, mp: 100, str: 10, dex: 10, agi: 10, int_stat: 10, vit: 10, luk: 10 }, slots: [], passives: [], setFx: fx })
  assert.equal(regenPctOf(side), 6, '6%で止まる')
  side.hp = 300
  assert.equal(regenPctOf(side), 6, 'HPが低くても6%まで')
  // 1つだけなら今のまま
  const one = createSide({ name: 'b', cls: '剣士', kind: 'phys', stats: { hp: 1000, mp: 100, str: 10, dex: 10, agi: 10, int_stat: 10, vit: 10, luk: 10 }, slots: [], passives: [], setFx: combinedFxOf(null, [pick('千年根の具足')]) })
  assert.equal(regenPctOf(one), 3)
})

test('セット能力とユニークは1つの入れ物にまとめる：受けるダメージ−% は掛け算・数は足す・名前はつなぐ', () => {
  const slime = UNIQUE_ITEMS.find(u => u.name === 'ビッグスライムの指輪')
  const fx = combinedFxOf({ physCut: 8, names: { physCut: '珊瑚の甲殻' } }, [slime])
  assert.equal(fx.physCut, 17.2, '−8% と −10% で −17.2%')
  assert.equal(fx.names.physCut, '珊瑚の甲殻・ビッグスライムの指輪')
  assert.equal(fx.regenPct, 3)
  // ウォードラムベルト（はじめの7ターン）とセットの迅雷（はじめの3ターン）は両方持てる
  const drum = UNIQUE_ITEMS.find(u => u.name === 'ウォードラムベルト')
  const both = combinedFxOf({ earlyBuff: { turns: 3, table: { agi: 20 } }, names: { earlyBuff: '迅雷' } }, [drum])
  const s = createSide({ name: 'a', cls: '剣士', kind: 'phys', stats: { hp: 1000, mp: 100, str: 10, dex: 10, agi: 10, int_stat: 10, vit: 10, luk: 10 }, slots: [], passives: [], setFx: both })
  assert.deepEqual(s.timedBuffs.map(t => t.turns).sort(), [3, 7])
  // 何も無ければ null（今までと同じ）
  assert.equal(combinedFxOf(null, []), null)
})

test('ユニークの防具はそのボスのエリアのセットに数える・作れない・分解で残骸50・まとめての分解には入れない', () => {
  const armor = UNIQUE_ITEMS.filter(u => u.line)
  for (const u of armor) assert.ok(isSetPiece(u), `${u.name} はセットに数える`)
  const u = UNIQUE_ITEMS[0]
  assert.ok(!canCraft(u))
  assert.equal(craftErrorOf(u, {}), 'ユニークの装備は作れません')
  assert.equal(scrapYieldOf(u), 50)
  assert.ok(!bulkPickable({ inv: { id: 9, plus: 0 }, item: u }, new Set()), 'まとめての分解に入れない')
  assert.ok(isUnique(u) && !isUnique(ITEMS[0]))
})

test('今のⅡの戦闘（setFx を持たないキャラ）にはユニークの行が出ない', () => {
  const f = (name) => ({ name, cls: '剣士', kind: 'phys', stats: { hp: 3000, mp: 300, str: 200, dex: 200, agi: 150, int_stat: 100, vit: 120, luk: 80 } })
  let seed = 7
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const r = runBattle(f('a'), f('b'), { rng })
  assert.ok(!r.log.some(l => l.type === 'uniqueFx' || l.type === 'uniqueAct'))
  assert.equal(r.a.uq, undefined)
})

test('【確定】2026-10-21 ユーザー指示：ユニークが落ちた行はふつうの装備と同じ形（「ユニーク」の文字なし・名前だけユニークの赤・ふつうの大きさ）', () => {
  const u = UNIQUE_ITEMS.find(x => x.name === '影縫いのブーツ')
  const l = dropLineOf(u)
  const text = l.parts.map(p => p.text).join('')
  assert.equal(text, '🎁 「影縫いのブーツ」を入手！')
  assert.ok(!text.includes('ユニーク'), '「ユニーク」の文字は付けない')
  assert.equal(l.parts.find(p => p.text === u.name).color, RARITY_COLOR.U, '名前はユニークの赤')
  assert.ok(!l.big, '大きな字にしない')
})

test('一覧（uniqueDefs.js）は案のシートの名前・能力の文をそのまま持つ（手で書き写していない）', () => {
  assert.equal(UNIQUE_DEFS.length, 60)
  for (const d of UNIQUE_DEFS) {
    assert.ok(d.text && d.text.length > 3, `${d.name} の能力の文`)
    assert.ok(d.fx && Object.keys(d.fx).length > 0, `${d.name} の戦闘の中身`)
  }
})

test('【確定】2026-10-21 ユーザー指示：時星龍アイオーンの弓は「刻弓レトログラード」（前の「刻弓レトログラー」に戻さない）', () => {
  assert.equal(ITEM_BY_ID[uniqueIdOf(42, '弓')].name, '刻弓レトログラード')
  assert.ok(!UNIQUE_DEFS.some(d => /レトログラー(?!ド)/.test(d.name)), '「ド」の抜けた名前が残っていない')
})
