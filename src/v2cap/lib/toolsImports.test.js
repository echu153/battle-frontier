// tools/ の道具が読む src のファイルが、どれもある（node --test）
//   2026-10-23：V2（初期構成）を消して土台を src/v2cap/core へ移したとき（dcb0987e）、tools/v2cap-progress.mjs が
//   src/v2/lib/battle.js・stats.js を読んだままで動かなくなっていた（技を覚える CLASS LV の変更で測ろうとして見つけた）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const TOOLS = new URL('../../../tools/', import.meta.url)
const SRC = new URL('../../', import.meta.url)

test('tools/ の道具が読む src のファイルはどれもある（土台を移したら道具の読み込み先も直す）', () => {
  let n = 0
  for (const f of readdirSync(TOOLS).filter(x => x.endsWith('.mjs'))) {
    const text = readFileSync(new URL(f, TOOLS), 'utf8')
    const paths = [
      ...[...text.matchAll(/import\(\s*B\s*\+\s*'([^']+)'\s*\)/g)].map(m => m[1]),                 // const B = new URL('../src/', …)
      ...[...text.matchAll(/new URL\(\s*'\.\.\/src\/([^']+)'\s*,\s*import\.meta\.url\s*\)/g)].map(m => m[1]),
    ]
    for (const p of paths) {
      n++
      assert.ok(existsSync(new URL(p, SRC)), `${f} が読む src/${p} がある`)
    }
    assert.ok(!/['"`][^'"`]*\bv2\/lib\//.test(text), `${f} は消した src/v2/lib を読まない`)
  }
  assert.ok(n >= 20, `読み込みを見た数（${n}）`)
})
