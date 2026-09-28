// ============================================================
// レイドの帯テーブル（supabase_v2_raid_20260906.sql の v2_raid_tiers）を
// JS の名簿から作り直す
//   node tools/v2-raid-sql.mjs          … ズレているか見るだけ
//   node tools/v2-raid-sql.mjs --write  … SQLへ書き戻す
// ------------------------------------------------------------
// ★raid.js が正。SQLはその写し。**HPは tools/v2-raid-tune.mjs で測って raid.js へ貼る**、
//   そのあとこのコマンドでSQLへ流し込む、という順番。手で書き写すとズレる
//   （raid.test.js が突き合わせているので気付けるが、直すのはこちら）。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs'

const B = new URL('../src/v2/lib/', import.meta.url).href
const { TIERS, raidPowerOfTier, raidHpOfTier, ultraPctOf } = await import(B + 'raid.js')

const file = new URL('../supabase_v2_raid_20260906.sql', import.meta.url)
const raw = readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
const text = crlf ? raw.split('\r\n').join('\n') : raw

const head = 'insert into public.v2_raid_tiers (tier, power, hp, ultra_pct) values\n'
const at = text.indexOf(head)
if (at < 0) { console.error('NG: v2_raid_tiers の insert が見つからない'); process.exit(1) }
const tail = text.indexOf('\non conflict', at)
if (tail < 0) { console.error('NG: insert の終わりが見つからない'); process.exit(1) }

const w = (s, n) => String(s).padStart(n)
const rows = TIERS.map(t =>
  `  (${w(t, 1)}, ${w(raidPowerOfTier(t), 6)}, ${w(raidHpOfTier(t), 11)}, ${w(ultraPctOf(t), 1)})`
).join(',\n')

const next = text.slice(0, at + head.length) + rows + text.slice(tail)
if (next === text) { console.log('✓ SQLはJSと一致しています'); process.exit(0) }
console.log('帯 ' + TIERS.length + '行。HP = ' + TIERS.map(t => raidHpOfTier(t).toLocaleString()).join(' / '))
if (!process.argv.includes('--write')) {
  console.log('⚠ SQLがズレています。`node tools/v2-raid-sql.mjs --write` で貼り直してください')
  process.exit(1)
}
writeFileSync(file, crlf ? next.split('\n').join('\r\n') : next)
console.log('✏ SQLへ書き戻しました')
