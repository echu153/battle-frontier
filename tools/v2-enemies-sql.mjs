// ============================================================
// v2_enemies の種（supabase_v2_core.sql §14）を enemies.js から作り直す
//   node tools/v2-enemies-sql.mjs
// ------------------------------------------------------------
// ★enemies.js が正・SQLはその写し。手で書き写すとズレるのでこれで作る。
//   ズレていることは src/v2/lib/v2sql.test.js が気付く（が、直すのはこちら）。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs'

const { AREAS_SORTED } = await import(new URL('../src/v2/lib/enemies.js', import.meta.url).href)

const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`)
const rows = []
for (const a of AREAS_SORTED) {
  const put = (e, slot) => rows.push(
    `  (${q(e.name)}, ${a.id}, ${a.tier}, ${q(slot)}, ${q(e.band || null)}, ${q(e.kind)}, ${e.power})`)
  for (const e of a.enemies) put(e, 'normal')
  for (const e of a.timed) put(e, 'timed')
  for (const e of a.rares) put(e, 'rare')
  put(a.boss, 'boss')
}

const file = new URL('../supabase_v2_core.sql', import.meta.url)
const sql = readFileSync(file, 'utf8')
const crlf = sql.includes('\r\n')
const text = crlf ? sql.split('\r\n').join('\n') : sql

const head = 'insert into public.v2_enemies (name, area, tier, slot, band, kind, power) values\n'
const at = text.indexOf(head)
if (at < 0) { console.error('NG: v2_enemies の insert が見つからない'); process.exit(1) }
const tailAt = text.indexOf('on conflict', at)
if (tailAt < 0) { console.error('NG: insert の終わり（on conflict）が見つからない'); process.exit(1) }

const next = text.slice(0, at + head.length) + rows.join(',\n') + '\n' + text.slice(tailAt)
writeFileSync(file, crlf ? next.split('\n').join('\r\n') : next)
console.log(`v2_enemies を ${rows.length} 行に作り直した`)
