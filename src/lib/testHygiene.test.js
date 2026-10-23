// ============================================================
// テストそのものが動く形になっているかを見張る
// ------------------------------------------------------------
// ★2026-09-05に見つけた穴。`src/lib/fishing.test.js` と
//   `src/components/IdleGuard.test.js` が `import ... from 'vitest'` のままで、
//   `npm test`（node --test）では**ファイルごと落ちて中身が1つも走っていなかった**。
//   落ちていても「1ファイル失敗」としか出ないので、9件のテストが
//   ずっと素通りしていたのに気付けなかった。
//
//   同じ形の穴は「拡張子なしの相対import」でも起きる（vitestは解決するがnodeは落ちる）。
//   どちらも機械的に見つかるので、ここで全テストファイルを見張る。
// ============================================================
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const testFiles = (dir = SRC, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) testFiles(p, out)
    else if (name.endsWith('.test.js') || name.endsWith('.test.jsx')) out.push(p)
  }
  return out
}

// ★このファイル自身は「vitest」という字を説明のために書いているので外す
const FILES = testFiles().filter(f => !f.endsWith('testHygiene.test.js'))
const rel = (f) => f.slice(f.lastIndexOf('src')).split('\\').join('/')

test('テストファイルを見つけられている', () => {
  assert.ok(FILES.length > 30, `テストファイルが${FILES.length}個しか見つからない`)
})

// ★vitest は入れていない。書いた瞬間そのファイルは丸ごと動かなくなる
test('vitest を読んでいるテストがない', () => {
  const bad = FILES.filter(f => /from ['"]vitest['"]/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(bad.map(rel), [],
    'node --test では動かない。src/lib/testExpect.js の expect を使うこと')
})

// ★node は拡張子を補ってくれない。'./fishing' と書くと ERR_MODULE_NOT_FOUND
test('相対importに拡張子が付いている', () => {
  const bad = []
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/from\s+['"](\.[^'"]*)['"]/g)) {
      if (!/\.(js|jsx|json|mjs|css)$/.test(m[1])) bad.push(`${f.replace(SRC, '')} → ${m[1]}`)
    }
  }
  assert.deepEqual(bad, [], '拡張子なしの相対importは node --test で落ちる')
})

// ★2026-10-24 に見つけた穴。src/v2cap/lib/museum.test.js が画面のファイルを split('\n') で行に分けてから
//   行ごとに // の説明を消していたが、Windows の作業場所（git の autocrlf で CRLF）では行末に \r が残る。
//   //.*$ の . は \r に合わないので説明が消えずに残り、LF のファイルなら通るテストが CRLF では必ず落ちていた。
//   作業場所の改行で結果が変わらないように、行に分けるのは split(/\r?\n/) にそろえる（test/ のテストも見る）
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const ALL_FILES = [...FILES, ...testFiles(join(ROOT, 'test'))]
// '\n'・"\n"・`\n`・/\n/ と、その \r\n の形で分けている所
const SPLIT_NL = /\.split\(\s*(?:(['"`])(?:\\r)?\\n\1|\/(?:\\r)?\\n\/)\s*\)/
test('行に分けるのは split(/\\r?\\n/)（作業場所の改行が LF でも CRLF でも同じ行になる）', () => {
  assert.ok(ALL_FILES.length > FILES.length, 'test/ のテストも見ている')
  const bad = []
  for (const f of ALL_FILES) {
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (SPLIT_NL.test(line)) bad.push(`${relative(ROOT, f).split('\\').join('/')}:${i + 1}`)
    })
  }
  assert.deepEqual(bad, [], "split('\\n') や split('\\r\\n') は CRLF か LF の片方で行がずれる。split(/\\r?\\n/) にすること")
})
