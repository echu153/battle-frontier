// ============================================================
// v2のライブラリを Edge Function 側へコピーする（node tools/v2-npc-fn-sync.mjs）
// ------------------------------------------------------------
// Edge Function（supabase/functions/v2-npc-tick）は Deno で動くので、
// **supabase/functions の外にあるファイルは配布物に入らない**。
// そこで src/v2/lib/*.js をそのまま _lib/ へコピーして使う。
//   ・素のESM（reactもnpmも使っていない）なので、Denoはそのまま読める
//   ・テストファイル（*.test.js）はコピーしない
//
// ⚠コピーなので放っておくとズレる。src/v2/lib/npc.fn.test.js が中身を突き合わせていて、
//   `npm test` で気付ける。ズレていたらこのコマンドを流し直す。
// ============================================================
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'

const SRC = new URL('../src/v2/lib/', import.meta.url)
const DST = new URL('../supabase/functions/v2-npc-tick/_lib/', import.meta.url)

// *.test.js は配らない（Denoが node:test を読もうとして落ちる）。
// react を読むファイル（tutorial.js など画面まわり）も配らない＝Deno側に持っていけない
export const filesToSync = () =>
  readdirSync(SRC)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .filter(f => !/from '(react|\.\.\/)/.test(readFileSync(new URL(f, SRC), 'utf8')))
    .sort()

// ★コマンドとして呼ばれたときだけコピーする（テストからは filesToSync だけを使う）
if (import.meta.main) {
  rmSync(DST, { recursive: true, force: true })
  mkdirSync(DST, { recursive: true })
  const files = filesToSync()
  for (const f of files) writeFileSync(new URL(f, DST), readFileSync(new URL(f, SRC)))
  console.log(`_lib/ へ ${files.length} ファイルをコピーしました`)
}
