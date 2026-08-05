// 立ち絵の透明な余白を切り落とす（枠の大きさは変えず、中身が枠を使い切るようにする）
// ============================================================
// なぜ必要か:
//   立ち絵は maxHeight:34vh で「枠の高さ」が決まる。ところが生成された画像は
//   1024x1536 の縦長canvasに中身が64〜92%しか入っておらず、枠の高さを使い切れず
//   小さく見えていた（2026-08-05 指摘）。canvasを中身ぴったりに詰めれば、
//   枠の指定は一切変えずに中身だけが枠いっぱいまで伸びる。
//
// 使い方:
//   node _touTrim.mjs public/tou                      … 下見（数字を出すだけ）
//   node _touTrim.mjs public/tou --apply --backup <退避先>
//
// ⚠退避先を public/ の下にしてはいけない（原本ごと配信されて容量が倍になる）。
//   実行時に弾いている。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const MARGIN = 2        // 端が欠けないための保険（px）
const ALPHA_MIN = 8     // これ未満のαは余白とみなす

const dir = process.argv[2]
const APPLY = process.argv.includes('--apply')
const bi = process.argv.indexOf('--backup')
const backupDir = bi > 0 ? process.argv[bi + 1] : null

if (!dir || !fs.existsSync(dir)) { console.error('対象ディレクトリを指定してください'); process.exit(1) }
if (APPLY) {
  if (!backupDir) { console.error('--apply には --backup <退避先> が必須です（原本を消さないため）'); process.exit(1) }
  const norm = path.resolve(backupDir).replace(/\\/g, '/')
  if (/\/public\//.test(norm + '/')) { console.error('退避先を public/ の下に置かないでください（原本ごと配信されます）'); process.exit(1) }
  fs.mkdirSync(backupDir, { recursive: true })
}

const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png'))
  .sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0) || a.localeCompare(b))

console.log(`${APPLY ? '■ 切り落とし実行' : '■ 下見（--apply --backup <退避先> で実行）'}  対象: ${dir}`)
console.log('ファイル          切る前        切った後      縦横比        枠での中身の見え方       容量')
for (const f of files) {
  const src = path.join(dir, f)
  const png = PNG.sync.read(fs.readFileSync(src))
  const { width: W, height: H, data } = png

  let minX = W, minY = H, maxX = -1, maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] >= ALPHA_MIN) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) { console.log(`${f.padEnd(16)} 中身が無い（全部透過）ので飛ばす`); continue }

  // 枠の高さを1としたときの、切る前の中身の大きさ
  const hBefore = (maxY - minY + 1) / H     // 高さ方向の占有
  const wBefore = (maxX - minX + 1) / H     // 幅（枠の高さ基準）

  minX = Math.max(0, minX - MARGIN); minY = Math.max(0, minY - MARGIN)
  maxX = Math.min(W - 1, maxX + MARGIN); maxY = Math.min(H - 1, maxY + MARGIN)
  const nw = maxX - minX + 1, nh = maxY - minY + 1
  if (nw === W && nh === H) { console.log(`${f.padEnd(16)} ${W}x${H} … 余白なし。そのまま`); continue }

  const out = new PNG({ width: nw, height: nh })
  for (let y = 0; y < nh; y++) {
    const s = ((y + minY) * W + minX) * 4
    data.copy(out.data, y * nw * 4, s, s + nw * 4)
  }
  const buf = PNG.sync.write(out, { deflateLevel: 9 })

  console.log(
    `${f.padEnd(16)} ${`${W}x${H}`.padEnd(13)} ${`${nw}x${nh}`.padEnd(13)} ` +
    `${(W / H).toFixed(2)}→${(nw / nh).toFixed(2)}   ` +
    `高さ ${(hBefore * 100).toFixed(0)}%→100% 幅 ${(wBefore * 100).toFixed(0)}%→${(nw / nh * 100).toFixed(0)}%   ` +
    `${(fs.statSync(src).size / 1024).toFixed(0)}KB→${(buf.length / 1024).toFixed(0)}KB`
  )

  if (APPLY) {
    const bak = path.join(backupDir, f)
    if (!fs.existsSync(bak)) fs.copyFileSync(src, bak)   // 既存の退避は上書きしない（原本を守る）
    fs.writeFileSync(src, buf)
  }
}
if (APPLY) console.log(`\n原本は ${backupDir} に退避済み。`)
