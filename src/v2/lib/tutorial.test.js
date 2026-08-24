// バトルフロンティアⅡ チュートリアルのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { TUTORIALS, TUTORIAL_KEYS, tutorialOf, seenKey } from './tutorial.js'

const srcOf = (name) => readFileSync(new URL(`../components/${name}`, import.meta.url), 'utf8')
const components = readdirSync(new URL('../components/', import.meta.url)).filter(n => n.endsWith('.jsx'))
// ★ホームの中で描いている画面（スキルセット・神殿）もあるので pages も見る
const pages = readdirSync(new URL('../pages/', import.meta.url)).filter(n => n.endsWith('.jsx'))
const fileOf = (n) => (components.includes(n)
  ? srcOf(n)
  : readFileSync(new URL(`../pages/${n}`, import.meta.url), 'utf8'))
const allFiles = [...components, ...pages]
const allJsx = allFiles.map(fileOf).join('\n')

// その1ファイルが置いている <V2Help id=...> を拾う（式で渡しているものも含む）
const idsIn = (src) => [
  ...[...src.matchAll(/<V2Help\s+id="(\w+)"/g)].map(m => m[1]),
  ...[...src.matchAll(/<V2Help\s+id=\{[^}]*?'(\w+)'\s*:\s*'(\w+)'\}/g)].flatMap(m => [m[1], m[2]]),
]
const usedIds = idsIn(allJsx)

test('チュートリアルの中身がそろっている', () => {
  assert.ok(TUTORIAL_KEYS.length >= 8, `チュートリアルは${TUTORIAL_KEYS.length}件`)
  for (const [id, t] of Object.entries(TUTORIALS)) {
    assert.ok(t.icon, `${id} にアイコンが無い`)
    assert.ok(t.title, `${id} に見出しが無い`)
    assert.ok((t.lines || []).length >= 3, `${id} の説明が短すぎる（3文以上）`)
    for (const l of t.lines) assert.ok(l.length > 10, `${id} に短すぎる行がある`)
  }
  assert.equal(tutorialOf('知らないキー'), null)
  assert.equal(seenKey('market'), 'tutorial:market')
})

// ★です・ます調の説明文にする（2026-08-25 ユーザー指示）。
//   箇条書きの「おぼえておくこと」はやめて、補足は最後の1文にまとめる
test('★説明はです・ます調。箇条書きの注意書きは持たない', () => {
  for (const [id, t] of Object.entries(TUTORIALS)) {
    assert.equal(t.tips, undefined, `${id} に箇条書きの注意書きが残っている`)
    for (const l of t.lines) {
      assert.match(l, /(ます|ません|です|ください)。$/, `${id} がです・ます調で終わっていない：${l}`)
    }
    if (t.note) {
      assert.ok(t.note.startsWith('なお、'), `${id} の補足が「なお、」で始まっていない`)
      assert.match(t.note, /(ます|ません|です|ください)。$/, `${id} の補足がです・ます調で終わっていない`)
    }
  }
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

// ★1つの画面にヘルプを2つ置くと画面が崩れることがある（2026-08-25 ユーザー報告）
test('★1つの画面にヘルプは1つまで', () => {
  const bad = []
  for (const name of allFiles) {
    const n = idsIn(fileOf(name)).length
    // ホームのスキルセット・神殿は id を式で切り替えていて、出るのは同時に1つだけ
    if (name === 'V2Home.jsx') { if (n > 2) bad.push(`${name}（${n}個）`); continue }
    if (n > 1) bad.push(`${name}（${n}個）`)
  }
  assert.deepEqual(bad, [], `ヘルプが2つ以上ある画面: ${bad.join(' / ')}`)
})

// ★どのコンテンツにもチュートリアルを付ける。付け忘れをここで落とす
//   ⚠出撃とデイリーは**付けない**（2026-08-25 ユーザー指示）
test('★主なコンテンツの画面には必ずヘルプが置いてある', () => {
  const NEED = {
    'V2Arena.jsx':  'arena',
    'V2Atb.jsx':    'atb',
    'V2Smith.jsx':  'smith',
    'V2Enchant.jsx':'enchant',
    'V2Tree.jsx':   'tree',
    'V2Base.jsx':   'base',
    'V2Market.jsx': 'market',
    'V2Storage.jsx':'storage',
  }
  const bad = []
  for (const [file, id] of Object.entries(NEED)) {
    assert.ok(components.includes(file), `${file} が無い`)
    if (!srcOf(file).includes(`<V2Help id="${id}"`)) bad.push(`${file}（id=${id}）`)
  }
  assert.deepEqual(bad, [], `ヘルプが置かれていない画面: ${bad.join(' / ')}`)
  // 出撃とデイリーには置かない
  for (const [file, id] of [['V2Sortie.jsx', 'sortie'], ['V2Daily.jsx', 'daily']]) {
    assert.ok(!srcOf(file).includes('<V2Help'), `${file} にヘルプが戻っている`)
    assert.equal(TUTORIALS[id], undefined, `${id} のチュートリアルが戻っている`)
  }
})

// ★説明の文章は tutorial.js が正。画面に直接書くと直すときに探すことになる
test('チュートリアルの文章を画面側にコピーしていない', () => {
  const sample = TUTORIALS.market.lines[0]
  assert.ok(!allJsx.includes(sample), '取引所の説明が画面にコピーされている')
  assert.ok(!srcOf('V2Help.jsx').includes(sample), 'V2Help に文章が書かれている')
})
