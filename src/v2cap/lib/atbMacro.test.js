// v2cap の ATB戦闘のマクロ（登録・保存の形）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MACRO_COUNT, MACRO_STEPS, STEP_NORMAL, STEP_GUARD, emptyMacros, normalizeMacros, macrosOf, validateMacros, macroEntriesOf, stepLabel,
} from './atbMacro.js'

test('【確定】2026-10-26 マクロは①〜③の3つ・1つ8個まで（ユーザー選択）', () => {
  assert.equal(MACRO_COUNT, 3)
  assert.equal(MACRO_STEPS, 8)
  assert.deepEqual(emptyMacros(), [{ steps: [], loop: false }, { steps: [], loop: false }, { steps: [], loop: false }])
})

test('保存の形をそろえる：職業ごと・足りなければ空・9個目から先と文字でないものは落とす', () => {
  const prof = { class: '侍', atb_macros: { 侍: [{ steps: ['居合斬', 3, '納刀'], loop: true }], 剣士: [{ steps: ['一閃'] }] } }
  const m = macrosOf(prof)
  assert.deepEqual(m[0], { steps: ['居合斬', '納刀'], loop: true })
  assert.deepEqual(m[1], { steps: [], loop: false })
  assert.equal(macrosOf(prof, '剣士')[0].steps[0], '一閃', '職業ごとに持つ')
  assert.equal(normalizeMacros([{ steps: Array(12).fill('a') }])[0].steps.length, 8)
  assert.deepEqual(macrosOf({ class: '侍' }), emptyMacros(), 'まだ無ければ空の3つ')
})

test('保存の前の確かめ：使える覚えた技・通常攻撃・防御だけ／8個まで', () => {
  const usable = ['居合斬', '納刀']
  const ok = [{ steps: ['居合斬', STEP_NORMAL, STEP_GUARD, '居合斬'], loop: true }, { steps: [], loop: false }, { steps: ['納刀'], loop: false }]
  assert.equal(validateMacros(ok, usable), null)
  assert.match(validateMacros([ok[0], ok[1]], usable), /3つ/)
  assert.match(validateMacros([{ steps: Array(9).fill('納刀') }, ok[1], ok[2]], usable), /マクロ①は8個まで/)
  assert.match(validateMacros([ok[0], { steps: ['ファイア'] }, ok[2]], usable), /ファイアはいまのクラスで使える覚えた技ではありません/)
})

test('戦闘に渡す形：技は並びの番号・通常攻撃と防御は印・見つからない技は飛ばす', () => {
  const slots = [{ skill: { name: '居合斬' } }, { skill: { name: '納刀' } }]
  assert.deepEqual(macroEntriesOf({ steps: ['納刀', STEP_NORMAL, '消えた技', STEP_GUARD, '居合斬'] }, slots),
    [{ idx: 1 }, { idx: null }, { guard: true }, { idx: 0 }])
  assert.equal(stepLabel(STEP_NORMAL), '通常攻撃')
  assert.equal(stepLabel(STEP_GUARD), '🛡 防御')
  assert.equal(stepLabel('納刀'), '納刀')
})
