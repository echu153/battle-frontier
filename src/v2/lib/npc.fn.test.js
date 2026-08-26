// Edge Function 側のライブラリのコピーがズレていないか（node --test）
// ------------------------------------------------------------
// supabase/functions/v2-npc-tick は Deno で動くので、**supabase/functions の外にある
// ファイルは配布物に入らない**。そのため src/v2/lib/*.js を _lib/ へコピーして使っている。
// コピーである以上、片方だけ直すと**サーバーのNPCだけ古い数字で動く**ことになる。
//   ⇒ ここで中身を1バイトずつ突き合わせる。落ちたら node tools/v2-npc-fn-sync.mjs を流し直す。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { filesToSync } from '../../../tools/v2-npc-fn-sync.mjs'

const SRC = new URL('./', import.meta.url)
const DST = new URL('../../../supabase/functions/v2-npc-tick/_lib/', import.meta.url)

test('_lib のコピーが src/v2/lib と一致している（ズレたら tools/v2-npc-fn-sync.mjs を流す）', () => {
  const files = filesToSync()
  assert.ok(files.includes('npc.js') && files.includes('battle.js') && files.includes('arena.js'))
  for (const f of files) {
    const dst = new URL(f, DST)
    assert.ok(existsSync(dst), `_lib/${f} が無い（node tools/v2-npc-fn-sync.mjs）`)
    assert.equal(
      readFileSync(dst, 'utf8'),
      readFileSync(new URL(f, SRC), 'utf8'),
      `_lib/${f} の中身が古い（node tools/v2-npc-fn-sync.mjs）`,
    )
  }
  // テストファイルは配布しない（Denoが node:test を読もうとして落ちる）
  for (const f of readdirSync(DST)) assert.ok(!f.endsWith('.test.js'), `_lib に ${f} が混ざっている`)
})

test('Edge Function から辿れるファイルが _lib に全部そろっている（Denoが読めない import が無い）', () => {
  // ★_lib へ配るのは「reactを読まないファイル」だけ（prefs.js などは配れない）。
  //   将来 battle.js などがそういうファイルを読むようになると、**デプロイして初めて壊れる**。
  //   ここで index.ts から実際に辿って、届く範囲が全部そろっているか確かめる。
  const entry = readFileSync(new URL('../../../supabase/functions/v2-npc-tick/index.ts', import.meta.url), 'utf8')
  const importsOf = (src) => [...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1])
  const queue = importsOf(entry).filter(p => p.startsWith('./_lib/')).map(p => p.slice('./_lib/'.length))
  const seen = new Set()
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f)) continue
    seen.add(f)
    const url = new URL(f, DST)
    assert.ok(existsSync(url), `_lib/${f} が無い（reactを読むファイルは配れない＝そこを参照しないようにする）`)
    for (const p of importsOf(readFileSync(url, 'utf8'))) {
      assert.ok(p.startsWith('./'), `_lib/${f} が ${p} を読んでいる（Denoでは解決できない）`)
      queue.push(p.slice(2))
    }
  }
  assert.ok(seen.has('battle.js') && seen.has('npc.js'), '辿れていない')
})

test('Edge Function の本体が _lib だけを読んでいる（外のパスを参照していない）', () => {
  const src = readFileSync(new URL('../../../supabase/functions/v2-npc-tick/index.ts', import.meta.url), 'utf8')
  const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map(m => m[1])
  for (const p of imports) {
    assert.ok(
      p.startsWith('./_lib/') || p.startsWith('https://'),
      `${p} は配布物に入らない（./_lib/ か https:// だけにする）`,
    )
  }
})
