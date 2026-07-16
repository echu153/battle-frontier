import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EFFECT_DESC, effectLabel } from '../src/constants/effectLabels.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// SQL に書いた reward_bonus_effect を全て拾う。
// 「SQLに効果を足したのに画面のラベルを足し忘れて、説明が出ない」を検出する
// （閻魔装備の hit_poison_20 等で実際に踏んだ。5画面に表がコピーされていたのが原因）。
const sqlEffects = () => {
  const found = new Map()
  for (const f of readdirSync(repoRoot).filter(n => n.endsWith('.sql'))) {
    const sql = readFileSync(join(repoRoot, f), 'utf8')
    // 'weapon', '装備名', '効果キー' の並び（exchange_shop の INSERT）
    for (const m of sql.matchAll(/'weapon',\s*'[^']+',\s*'([a-z0-9_]+)'/g)) found.set(m[1], f)
  }
  return found
}

test('SQL の reward_bonus_effect は全て EFFECT_DESC に説明がある', () => {
  const missing = [...sqlEffects()].filter(([key]) => !EFFECT_DESC[key])
  assert.deepEqual(missing.map(([k, f]) => `${k} (${f})`), [],
    'src/constants/effectLabels.js に説明が無い効果があります。' +
    '交換所・マーケット・装備・プロフィール・鍛冶屋の全画面で説明が出なくなります')
})

test('閻魔装備の3効果に説明がある', () => {
  for (const k of ['hit_poison_20', 'dmg_taken_down_5_hp50_x2', 'atk_to_matk_2']) {
    assert.ok(EFFECT_DESC[k], `${k} の説明が無い`)
    assert.notEqual(effectLabel(k), k, `${k} が生のキーのまま表示される`)
  }
})

test('effectLabel は【】で囲む。真化ラベルは元から【】付きなので二重にしない', () => {
  assert.equal(effectLabel('mdef_pen_5'), '【魔法防御貫通+5%】')
  assert.equal(effectLabel('evo_dmg_taken_down_5'), '【真化・被ダメージ-5%】')
  assert.equal(effectLabel('unknown_key'), 'unknown_key')  // 未知のキーはそのまま返す
})

test('効果ラベルの表は effectLabels.js だけが持つ（画面ごとにコピーしない）', () => {
  const screens = ['src/pages/Exchange.jsx', 'src/pages/Marketplace.jsx',
                   'src/pages/Equipment.jsx', 'src/pages/Profile.jsx', 'src/pages/Smithy.jsx']
  for (const f of screens) {
    const src = readFileSync(join(repoRoot, f), 'utf8')
    assert.ok(!/const BONUS_EFFECT_DESC = \{/.test(src),
      `${f}: 独自の BONUS_EFFECT_DESC を持っている。effectLabels.js に足しても反映されず、片方だけ古くなる`)
    assert.ok(!/'hit_spd_down_5'\s*:/.test(src),
      `${f}: 効果の説明文を直書きしている。src/constants/effectLabels.js を参照すること`)
  }
})
