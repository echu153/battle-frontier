// ============================================================
// 武器の進化まわりのSQL（supabase_v2_core.sql）を JS の名簿から作り直す
//   node tools/v2-evolve-sql.mjs          … ズレているか見るだけ
//   node tools/v2-evolve-sql.mjs --write  … SQLへ書き戻す
// ------------------------------------------------------------
// ★evolveTraits.js の TRAITS と evolve.js の LEVELS が正。SQLはその写し。
//   値はサーバーが名簿の倍率から計算し直すので、**ズレると画面と実際の効果が食い違う**。
//   手で書き写すと必ずズレるのでこれで作る（v2sql.test.js が突き合わせている）。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs'

const B = new URL('../src/v2/lib/', import.meta.url).href
const { TRAITS } = await import(B + 'evolveTraits.js')
const { LEVELS } = await import(B + 'evolve.js')

const file = new URL('../supabase_v2_core.sql', import.meta.url)
const raw = readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
let text = crlf ? raw.split('\r\n').join('\n') : raw

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"

// ===== ① 能力の名簿 =====
const rows = TRAITS.map(t => {
  const atoms = [
    ...t.gain.map(([a, w]) => ({ a, w, c: false })),
    ...t.cost.map(([a, w]) => ({ a, w, c: true })),
  ]
  return `  (${q(t.key)},${q(t.axis)},${q(t.name)},${q(JSON.stringify(atoms))})`
}).join(',\n')

const head = 'insert into public.v2_evolve_traits (key, axis, name, atoms) values\n'
const at = text.indexOf(head)
if (at < 0) { console.error('NG: v2_evolve_traits の insert が見つからない'); process.exit(1) }
// ★この insert は最後の行が ; で終わる（on conflict は付いていない）
 const tail0 = text.indexOf(';' + String.fromCharCode(10), at)
 const tail = tail0
if (tail < 0) { console.error('NG: insert の終わり（on conflict）が見つからない'); process.exit(1) }
const before = text
text = text.slice(0, at + head.length) + rows + text.slice(tail)

// ===== ② 覚醒レベル（2か所にある）=====
const want = `array[${LEVELS.join(', ')}]`
const levelLines = [...text.matchAll(/(c_levels\s+constant int\[\]\s*:=\s*)array\[[^\]]*\]/g)]
if (levelLines.length === 0) { console.error('NG: c_levels が見つからない'); process.exit(1) }
text = text.replace(/(c_levels\s+constant int\[\]\s*:=\s*)array\[[^\]]*\]/g, `$1${want}`)

const changed = text !== before
console.log(`能力 ${TRAITS.length}種 ／ 覚醒レベル ${LEVELS.join(', ')}（SQLの${levelLines.length}か所）`)
if (!changed) { console.log('✓ SQLはJSと一致しています'); process.exit(0) }
if (!process.argv.includes('--write')) {
  console.log('⚠ SQLがズレています。`node tools/v2-evolve-sql.mjs --write` で貼り直してください')
  process.exit(1)
}
writeFileSync(file, crlf ? text.split('\n').join('\r\n') : text)
console.log('✏ SQLへ書き戻しました')
