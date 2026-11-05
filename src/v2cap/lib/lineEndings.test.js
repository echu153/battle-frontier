import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// 【確定】2026-11-06 設計書に node で行を足したとき、改行（\r\n）の \r と \n のあいだに差しこんで、\r\r\n（単独の \r）ができた（c58c37fe）。
//   git は単独の \r があるファイルの改行をそろえないので、ファイル全体が CRLF のまま保存され、別のセッションの変更と全体がぶつかった。
//   行を足すときは改行のあと（indexOf('\n') + 1）に足す
test('文字のファイルに単独の \\r（\\r\\r\\n など）が無い（改行の中へ差しこむと、git がファイル全体を CRLF のまま保存する）', () => {
  const bad = []
  const walk = (p) => {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) if (f !== 'node_modules' && !f.startsWith('.')) walk(path.join(p, f))
      return
    }
    if (!/\.(js|jsx|mjs|md|css|sql|json|html)$/.test(p)) return
    const b = readFileSync(p)
    for (let k = 0; k < b.length; k++) if (b[k] === 13 && b[k + 1] !== 10) { bad.push(path.relative(ROOT, p)); break }
  }
  for (const r of ['src', 'docs', 'tools', 'api']) if (existsSync(path.join(ROOT, r))) walk(path.join(ROOT, r))
  assert.deepEqual(bad, [])
})
