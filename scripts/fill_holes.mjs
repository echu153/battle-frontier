// 八獄ボス画像: 背景透過で生じた「体内側の閉じた透過穴」を周囲の色で補間して埋める
// 使い方: node scripts/fill_holes.mjs <file...>
//   ・画像外周と透過で繋がっている領域＝本当の背景（そのまま）
//   ・繋がっていない閉じた透過領域のうち「小さいもの」＝キャラ内の穴 → インペインティングで埋める
//   ・大きな閉じ領域（布や枝の間の本来見通せる隙間）は埋めない（埋めるとスミアで不自然になる）
import fs from 'node:fs'
import { PNG } from 'pngjs'

const MAX_FILL = 3500   // これより大きい閉じ領域は「意図された隙間」とみなして埋めない(px)
const MIN_RING_LUM = 175 // 穴の周囲(不透過リング)の平均輝度がこれ未満なら埋めない
                         // （暗い布・枝の間の隙間は暗背景で自然に見えるため。黒穴として目立つのは明るい絵柄の中の穴だけ）

for (const file of process.argv.slice(2)) {
  const png = PNG.sync.read(fs.readFileSync(file))
  const { width: w, height: h, data: d } = png
  const idx = (x, y) => y * w + x

  // 外周と繋がった透過領域
  const outside = new Uint8Array(w * h)
  {
    const stack = []
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const i = idx(x, y)
      if (outside[i] || d[i * 4 + 3] !== 0) return
      outside[i] = 1
      stack.push(i)
    }
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
    while (stack.length) {
      const i = stack.pop()
      const x = i % w, y = (i / w) | 0
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
    }
  }

  // 閉じ穴 = 透過かつ outside でない。連結成分ごとに MAX_FILL 以下だけ埋める
  const fillable = new Uint8Array(w * h)
  let holes = 0
  {
    const comp = new Int32Array(w * h).fill(-1)
    let id = 0
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      const si = idx(sx, sy)
      if (d[si * 4 + 3] !== 0 || outside[si] || comp[si] !== -1) continue
      const mem = [si]
      comp[si] = id
      for (let head = 0; head < mem.length; head++) {
        const i = mem[head]
        const x = i % w, y = (i / w) | 0
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = idx(nx, ny)
          if (d[ni * 4 + 3] !== 0 || outside[ni] || comp[ni] !== -1) continue
          comp[ni] = id
          mem.push(ni)
        }
      }
      id++
      if (mem.length > MAX_FILL) continue
      // 周囲リングの平均輝度を計測（8近傍の不透過ピクセル）
      let lum = 0, ln = 0
      for (const i of mem) {
        const x = i % w, y = (i / w) | 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const np = idx(nx, ny) * 4
          if (d[np + 3] === 0) continue
          lum += (d[np] + d[np + 1] + d[np + 2]) / 3; ln++
        }
      }
      if (ln === 0 || lum / ln < MIN_RING_LUM) continue
      for (const i of mem) fillable[i] = 1
      holes += mem.length
    }
  }
  // 埋めない閉じ領域は outside 扱いにする（インペインティング対象から外す）
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] === 0 && !outside[i] && !fillable[i]) outside[i] = 1

  // 玉ねぎ剥きインペインティング: 不透過に接する穴ピクセルから順に、周囲8近傍の不透過色の平均で埋める
  let remaining = holes
  while (remaining > 0) {
    const fills = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = idx(x, y)
      if (d[i * 4 + 3] !== 0 || outside[i]) continue
      let r = 0, g = 0, b = 0, n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const np = idx(nx, ny) * 4
        if (d[np + 3] === 0) continue
        r += d[np]; g += d[np + 1]; b += d[np + 2]; n++
      }
      if (n >= 2) fills.push([i, Math.round(r / n), Math.round(g / n), Math.round(b / n)])
    }
    if (fills.length === 0) break
    for (const [i, r, g, b] of fills) {
      const p = i * 4
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255
      remaining--
    }
  }

  fs.writeFileSync(file, PNG.sync.write(png))
  console.log(file, `閉じ穴 ${holes}px を補間で埋めた`)
}
