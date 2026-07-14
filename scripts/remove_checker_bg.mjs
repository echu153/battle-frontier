// 八獄ボス画像: 焼き込まれたチェック柄背景を透過化する一回限りのツール
// 使い方: node scripts/remove_checker_bg.mjs <file...>
//   外周からフラッドフィルし、「無彩色かつ明るい」ピクセル（チェック柄の白/薄グレー）を透過にする。
//   キャラ本体の白っぽい部分は色味（青み等）があるか、外周と繋がっていないため残る。
import fs from 'node:fs'
import { PNG } from 'pngjs'

const isBg = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  return (mx - mn) <= 10 && mn >= 180  // ほぼ無彩色かつ明るい＝チェック柄
}

for (const file of process.argv.slice(2)) {
  const png = PNG.sync.read(fs.readFileSync(file))
  const { width: w, height: h, data: d } = png
  const visited = new Uint8Array(w * h)
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = y * w + x
    if (visited[i]) return
    const p = i * 4
    if (!isBg(d[p], d[p + 1], d[p + 2])) return
    visited[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (stack.length) {
    const i = stack.pop()
    const x = i % w, y = (i / w) | 0
    d[i * 4 + 3] = 0
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }
  // 縁の1pxを半透明にしてジャギを軽減（透過ピクセルに隣接する不透過ピクセル）
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (visited[i]) continue
    const p = i * 4
    if (d[p + 3] === 0) continue
    const near = (xx, yy) => xx >= 0 && yy >= 0 && xx < w && yy < h && visited[yy * w + xx]
    if (near(x + 1, y) || near(x - 1, y) || near(x, y + 1) || near(x, y - 1)) d[p + 3] = 160
  }
  fs.writeFileSync(file, PNG.sync.write(png))
  const cleared = visited.reduce((s, v) => s + v, 0)
  console.log(file, `${w}x${h}`, `透過化: ${cleared}px (${Math.round(cleared / (w * h) * 100)}%)`)
}
