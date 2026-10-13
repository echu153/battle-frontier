// v2cap：装備画面の見せ方（2026-10-14 ユーザー指示）が戻らないように：node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// コメント（/* */ と //）を外した中身
const codeOf = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const EQUIP = codeOf('../components/V2capEquip.jsx')
const GEAR = codeOf('../components/v2capGear.jsx')

test('【確定】装備中の説明文（装備できる武器・重鎧と軽装・必要LV・強化の説明）は出さない', () => {
  assert.ok(!/装備できる武器は/.test(EQUIP), '装備できる武器の説明は出さない')
  assert.ok(!/を部位ごとに選べます/.test(EQUIP), '重鎧と軽装の説明は出さない')
  assert.ok(!/鍛冶屋で行います/.test(EQUIP), '強化・分解・作成の説明は出さない')
})

test('【確定】装備中の行にLVは出さない・持っている装備の右は「要求レベル〇LV」', () => {
  assert.ok(!/needLvOf\(w\.item/.test(EQUIP), '装備中の行（w.item）に必要LVを出さない')
  assert.ok(/>要求レベル\{needLvOf\(item, inv\.ilv\)\}LV</.test(EQUIP), '持っている装備の右は「要求レベル〇LV」')
  assert.ok(!/>LV\{needLvOf/.test(EQUIP), '「LV〇」の書き方は使わない')
})

test('【確定】絞り込みは 部位・レア度・エリア の3つのプルダウンを横並び（ボタンの列に戻さない）', () => {
  const bar = GEAR.slice(GEAR.indexOf('export function GearFilterBar'))
  const selects = [...bar.matchAll(/<select value=\{g\.(\w+)\}/g)].map(m => m[1])
  assert.deepEqual(selects, ['part', 'rarity', 'area'])
  assert.ok(!/onClick=\{\(\) => g\.set(Part|Rarity)\(/.test(bar), '部位・レア度はボタンにしない')
})
