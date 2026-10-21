import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ★2026-09-06 の事故を二度と起こさないための見張り。
// ------------------------------------------------------------
// 「gitに入っていないファイル」を import したコードをコミットすると、
// **手元では通るのに本番のビルドだけが落ちる**（手元はディスクに実体があるため）。
// 実際 PixelBreathingSprite.jsx を入れ忘れて、Vercelのビルドが
//   Could not resolve '../../components/PixelBreathingSprite.jsx'
// で30分ほど止まった。気づけたのは本番のバンドルを見に行ったから。
//
// ここでは **gitが知っているファイルだけ**を辿って、相対importの行き先が
// 全部 git に入っていることを確かめる。入れ忘れるとその場で落ちる。

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })

// 拡張子を補って解決する（vite と同じ順番）
const CANDIDATES = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx']
// import で読むが解決の対象にしないもの（画像・音・CSSはそのままの名前で置いてある）
const ASSET = /\.(css|png|jpe?g|gif|svg|webp|mp3|wav|json)$/i

test('★コミットしたコードが、gitに入っていないファイルを読んでいない', () => {
  const tracked = new Set(git('ls-files').split('\n').map(s => s.trim()).filter(Boolean))
  const code = [...tracked].filter(f => /^src\/.*\.(jsx?|tsx?)$/.test(f) && !/\.test\.jsx?$/.test(f))
  assert.ok(code.length > 50, `対象のファイルを拾えている（${code.length}件）`)

  const missing = []
  for (const f of code) {
    const src = readFileSync(path.join(ROOT, f), 'utf8')
    const dir = path.posix.dirname(f)
    for (const m of src.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      const spec = m[1]
      const base = path.posix.normalize(path.posix.join(dir, spec))
      const hit = CANDIDATES.some(ext => tracked.has(base + ext))
      if (!hit) missing.push(`${f} → ${spec}${ASSET.test(spec) ? '' : '（拡張子も試した）'}`)
    }
  }
  assert.deepEqual(missing, [],
    'gitに入っていないファイルを読んでいる（git add の入れ忘れ。本番のビルドだけが落ちる）:\n  ' + missing.join('\n  '))
})
