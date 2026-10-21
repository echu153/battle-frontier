// v2cap：旧版（V1）の画面のファイルを読み込まないことを固定するテスト（node --test）
// 2026-10-22 ユーザー「V2capに移行するとして、V1,V2（初期構成）の内容って重い要因になったりする？」
//   → V2LogLine が旧版のホーム画面（pages/Game.jsx）から BattleLogLine を1つ借りていたため、
//     /v2cap を開くと旧版のホーム画面まるごと（約400KB）を読み込んでいた。
//     BattleLogLine は components/BattleLogLine.jsx に移した。
//   v2cap が使う V2 の部品（src/v2）も同じく見る。画面のファイル（src/pages）から何かを取ると、
//   その画面が使う物ぜんぶが一緒に付いてくる。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../..', import.meta.url))
const PAGES = join(SRC, 'pages')
const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const IMPORT = /(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g

test('v2cap（V2 から移した core も）は旧版の画面（src/pages）から import しない', () => {
  const files = [...walk(join(SRC, 'v2cap'))]   // src/v2（V2 初期構成）は 2026-10-22 に v2cap へまとめた
    .filter(p => /\.(js|jsx|mjs)$/.test(p) && !p.endsWith('.test.js'))
  const bad = files.flatMap(p => [...readFileSync(p, 'utf8').matchAll(IMPORT)]
    .filter(m => resolve(dirname(p), m[1]).startsWith(PAGES))
    .map(m => `${relative(SRC, p)} → ${m[1]}`))
  assert.deepEqual(bad, [], '画面のファイルから取らず、部品を src/components や src/lib に移して使う')
})

test('戦闘ログの1行（BattleLogLine）は画面のファイルの外にある', () => {
  const comp = readFileSync(join(SRC, 'components/BattleLogLine.jsx'), 'utf8')
  assert.match(comp, /export function BattleLogLine\(/)
  const game = readFileSync(join(PAGES, 'Game.jsx'), 'utf8')
  assert.ok(!/function BattleLogLine\(/.test(game), 'Game.jsx に戻さない')
  // 旧版の画面（タワー・奈落・対人戦など）は今までどおり './Game' から取れる
  assert.match(game, /export \{ BattleLogLine \}/)
})

test('ログイン後の V1 の先読みは V1 の画面にいるときだけ（Ⅱでは読まない）', () => {
  // 2026-10-22 前はどの画面でも V1 の18画面（約640KB）を先読みしていた
  const app = readFileSync(join(SRC, 'App.jsx'), 'utf8')
  const m = app.match(/const NOT_V1 = \/(.+)\/\r?\n/)
  assert.ok(m, 'App.jsx に NOT_V1（先読みしない画面）がある')
  const NOT_V1 = new RegExp(m[1])
  for (const p of ['/v2cap', '/v2', '/login', '/create']) assert.ok(NOT_V1.test(p), `${p} では先読みしない`)
  for (const p of ['/game', '/equipment', '/tower', '/profile/abc']) assert.ok(!NOT_V1.test(p), `${p} では先読みする`)
  // 先読みは V1Prefetch の中だけ（App の本体に戻さない）
  const body = app.slice(app.indexOf('function App()'))
  assert.ok(!body.includes("import('./pages/Pets')"), '先読みの一覧は V1Prefetch の中に置く')
  assert.match(body, /<V1Prefetch \/>/)
})
