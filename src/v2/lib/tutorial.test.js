// バトルフロンティアⅡ チュートリアルのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { TUTORIALS, TUTORIAL_KEYS, tutorialOf, seenKey } from './tutorial.js'

const srcOf = (name) => readFileSync(new URL(`../components/${name}`, import.meta.url), 'utf8')
const components = readdirSync(new URL('../components/', import.meta.url)).filter(n => n.endsWith('.jsx'))
// ★ホームの中で描いている画面（スキルセット・神殿）もあるので pages も見る
const pages = readdirSync(new URL('../pages/', import.meta.url)).filter(n => n.endsWith('.jsx'))
const allJsx = [
  ...components.map(n => srcOf(n)),
  ...pages.map(n => readFileSync(new URL(`../pages/${n}`, import.meta.url), 'utf8')),
].join('\n')

// 画面が置いている <V2Help id="..." /> を全部拾う
const usedIds = [
  ...[...allJsx.matchAll(/<V2Help\s+id="(\w+)"/g)].map(m => m[1]),
  // id を式で渡しているところ（ホームのスキルセット・神殿）も拾う
  ...[...allJsx.matchAll(/<V2Help\s+id=\{[^}]*?'(\w+)'\s*:\s*'(\w+)'\}/g)].flatMap(m => [m[1], m[2]]),
]

test('チュートリアルの中身がそろっている', () => {
  assert.ok(TUTORIAL_KEYS.length >= 8, `チュートリアルは${TUTORIAL_KEYS.length}件`)
  for (const [id, t] of Object.entries(TUTORIALS)) {
    assert.ok(t.icon, `${id} にアイコンが無い`)
    assert.ok(t.title, `${id} に見出しが無い`)
    assert.ok((t.lines || []).length >= 1, `${id} に説明が無い`)
    for (const l of t.lines) assert.ok(l.length > 5, `${id} の説明が短すぎる`)
    for (const l of t.tips || []) assert.ok(l.length > 3, `${id} の注意書きが短すぎる`)
  }
  assert.equal(tutorialOf('知らないキー'), null)
  assert.equal(seenKey('market'), 'tutorial:market')
})

// ★画面が置いた id と名簿がズレると、ヘルプを押しても何も出ない（無言で壊れる）
test('★画面が置いた <V2Help id> は全部 tutorial.js にある', () => {
  const missing = [...new Set(usedIds)].filter(id => !TUTORIALS[id])
  assert.deepEqual(missing, [], `名簿に無いidを画面が置いている: ${missing.join(', ')}`)
})

// ★書いたのに読めないチュートリアルを残さない（どこからも開けない＝無いのと同じ）
test('★どのチュートリアルも、どこかの画面から開ける', () => {
  const orphan = TUTORIAL_KEYS.filter(id => !usedIds.includes(id))
  assert.deepEqual(orphan, [], `どこからも開けないチュートリアル: ${orphan.join(', ')}`)
})

// ★どのコンテンツにもチュートリアルを付ける（2026-08-23 ユーザー指示）。付け忘れをここで落とす
test('★主なコンテンツの画面には必ずヘルプが置いてある', () => {
  const NEED = {
    'V2Sortie.jsx': 'sortie',
    'V2Arena.jsx':  'arena',
    'V2Atb.jsx':    'atb',
    'V2Smith.jsx':  'smith',
    'V2Enchant.jsx':'enchant',
    'V2Tree.jsx':   'tree',
    'V2Base.jsx':   'base',
    'V2Market.jsx': 'market',
    'V2Storage.jsx':'storage',
    'V2Daily.jsx':  'daily',
  }
  const bad = []
  for (const [file, id] of Object.entries(NEED)) {
    assert.ok(components.includes(file), `${file} が無い`)
    if (!srcOf(file).includes(`<V2Help id="${id}"`)) bad.push(`${file}（id=${id}）`)
  }
  assert.deepEqual(bad, [], `ヘルプが置かれていない画面: ${bad.join(' / ')}`)
})

// ★説明の文章は tutorial.js が正。画面に直接書くと直すときに探すことになる
test('チュートリアルの文章を画面側にコピーしていない', () => {
  const sample = TUTORIALS.market.lines[0]
  assert.ok(!allJsx.includes(sample), '取引所の説明が画面にコピーされている')
  assert.ok(!srcOf('V2Help.jsx').includes(sample), 'V2Help に文章が書かれている')
})
