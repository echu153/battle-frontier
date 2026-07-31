// ============================================================
// リボン取りこぼし検知（node --test）
// ------------------------------------------------------------
// pets.ribbon_id を読み忘れると「フェイトコアで引いた回避3%が
// プレイヤーに乗らない」類の不具合が静かに再発するため、
// ソースを機械的に走査して穴を塞いだままか確認する。
// ============================================================
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const FILES = walk(SRC)
  .filter((p) => /\.jsx?$/.test(p) && !p.endsWith('.test.js'))
  .map((p) => ({ path: relative(SRC, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }))

// pets テーブルから charm_id を取るクエリは ribbon_id も必ず取る
//  （lib/petBonus.js の PET_STAT_SELECT を使うのが基本。個別に列挙する場合も両方書く）
test('pets の charm_id 取得は ribbon_id もセットで取る', () => {
  const bad = []
  for (const { path, src } of FILES) {
    for (const m of src.matchAll(/from\('pets'\)\s*\.select\('([^']*)'\)/g)) {
      if (m[1].includes('charm_id') && !m[1].includes('ribbon_id')) bad.push(`${path}: ${m[1]}`)
    }
  }
  assert.deepEqual(bad, [], 'charm_id だけ取っている＝リボン分が落ちる')
})

// charmPlayerBonus は必ず (charm, ribbon) の2引数で呼ぶ
//  （pets.js の定義本体と、両方を渡すローダー lib/petBonus.js のみ例外）
test('charmPlayerBonus は charm と ribbon の両方を渡して呼ぶ', () => {
  const bad = []
  for (const { path, src } of FILES) {
    if (path === 'constants/pets.js') continue
    for (const m of src.matchAll(/charmPlayerBonus\(([^)]*)\)/g)) {
      const args = m[1].trim()
      if (!args || args.includes(',')) continue     // import文（引数なし）／2引数はOK
      bad.push(`${path}: charmPlayerBonus(${args})`)
    }
  }
  assert.deepEqual(bad, [], 'リボンを渡していない呼び出しがある')
})
