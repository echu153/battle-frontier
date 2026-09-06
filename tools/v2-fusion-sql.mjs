// ============================================================
// 合成素材の名簿（src/v2/lib/fusion.js）から、SQLの INSERT を作り直す
// ------------------------------------------------------------
// 敵270体＋レイドボス5体＝275行。敵を足したら fusion.js が自動で増えるので、
// このコマンドで supabase_v2_raid_20260906.sql の INSERT を貼り直す。
//
//   node tools/v2-fusion-sql.mjs          … 差分があるか見るだけ
//   node tools/v2-fusion-sql.mjs --write  … SQLへ書き戻す
//
// ⚠ raid.test.js が「SQLの名簿と fusion.js が一致しているか」を見張っているので、
//   ズレたまま気づかずに進むことはない。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs'

const SQL_PATH = new URL('../supabase_v2_raid_20260906.sql', import.meta.url)
const { FUSIONS } = await import(new URL('../src/v2/lib/fusion.js', import.meta.url).href)

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"
const rows = FUSIONS
  .map(f => `  (${q(f.id)}, ${q(f.name)}, ${q(f.source)}, ${q(f.boss)}, ${q(f.crown)})`)
  .join(',\n')

const HEAD = 'insert into public.v2_fusion_materials (id, name, source, boss, crown) values'
const TAIL = 'on conflict (id) do update set'

const sql = readFileSync(SQL_PATH, 'utf8')
const eol = sql.includes('\r\n') ? '\r\n' : '\n'
const i = sql.indexOf(HEAD)
const j = sql.indexOf(TAIL, i)
if (i < 0 || j < 0) throw new Error('SQLの INSERT が見つからない')

const next = sql.slice(0, i) + (HEAD + '\n' + rows + '\n').split('\n').join(eol) + sql.slice(j)
const same = next === sql

console.log(`合成素材 ${FUSIONS.length}件（敵 ${FUSIONS.filter(f => f.source === 'enemy').length} ／ レイド ${FUSIONS.filter(f => f.source === 'raid').length}）`)
if (same) { console.log('✅ SQLの名簿は fusion.js と一致しています'); process.exit(0) }

if (process.argv.includes('--write')) {
  writeFileSync(SQL_PATH, next)
  console.log('✏ SQLへ書き戻しました')
} else {
  console.log('⚠ SQLの名簿がズレています。`node tools/v2-fusion-sql.mjs --write` で貼り直してください')
  process.exit(1)
}
