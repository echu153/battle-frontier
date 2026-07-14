// 八獄ボス画像: 焼き込まれたチェック柄背景を透過化する一回限りのツール（v3）
// 使い方: node scripts/remove_checker_bg.mjs <file...>
//  1) 外周フラッドフィル（v1と同じ安全な条件）
//  2) 閉ポケット: チェック柄の「白」と「薄グレー」の両方を含み・平坦・一定面積の連結成分だけ透過
//     （マスクや氷の白い絵柄はグラデーション/単色なので条件を満たさず残る）
//  3) 白ポツ掃除: 透過に囲まれた小さな明るい無彩色の孤立成分を透過
//  4) ハロー除去: 透過に隣接する「ほぼ純白」の縁1〜2pxだけ剥がす（厳格条件）
import fs from 'node:fs'
import { PNG } from 'pngjs'

const isBg = (r, g, b) => (Math.max(r, g, b) - Math.min(r, g, b)) <= 10 && Math.min(r, g, b) >= 180
// チェック柄の2色クラス（実測: 白=251〜255 / 薄グレー=232〜246・いずれも無彩色）
const isCheckWhite = (r, g, b) => (Math.max(r, g, b) - Math.min(r, g, b)) <= 8 && Math.min(r, g, b) >= 247
const isCheckGray  = (r, g, b) => (Math.max(r, g, b) - Math.min(r, g, b)) <= 8 && Math.min(r, g, b) >= 228 && Math.max(r, g, b) <= 249

for (const file of process.argv.slice(2)) {
  const png = PNG.sync.read(fs.readFileSync(file))
  const { width: w, height: h, data: d } = png
  const idx = (x, y) => y * w + x
  const clear = new Uint8Array(w * h)

  // 1) 外周フラッドフィル
  {
    const stack = []
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const i = idx(x, y)
      if (clear[i]) return
      const p = i * 4
      if (d[p + 3] !== 0 && !isBg(d[p], d[p + 1], d[p + 2])) return
      clear[i] = 1
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

  // 2) 閉ポケットのチェック柄（白+薄グレー両方を含む・平坦・面積100px以上）
  //    3) 小さな孤立成分（25px未満）は無条件で透過（白ポツ掃除）
  {
    const comp = new Int32Array(w * h).fill(-1)
    let compId = 0
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      const si = idx(sx, sy)
      if (clear[si] || comp[si] !== -1) continue
      const sp = si * 4
      if (!isBg(d[sp], d[sp + 1], d[sp + 2])) continue
      const members = [si]
      comp[si] = compId
      for (let head = 0; head < members.length; head++) {
        const i = members[head]
        const x = i % w, y = (i / w) | 0
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = idx(nx, ny)
          if (clear[ni] || comp[ni] !== -1) continue
          const np = ni * 4
          if (!isBg(d[np], d[np + 1], d[np + 2])) continue
          comp[ni] = compId
          members.push(ni)
        }
      }
      compId++
      if (members.length < 25) {
        // 小成分: 透過領域に接している（＝背景の取り残し）場合のみ透過。
        // キャラ内部の小さな白ハイライト（周囲が不透過）は残す。
        let touchTrans = 0
        for (const i of members) {
          const x = i % w, y = (i / w) | 0
          for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            if (clear[idx(nx, ny)]) { touchTrans++; break }
          }
        }
        if (touchTrans / members.length >= 0.3) for (const i of members) clear[i] = 1
        continue
      }
      let white = 0, gray = 0, flat = 0
      for (const i of members) {
        const p = i * 4
        if (isCheckWhite(d[p], d[p + 1], d[p + 2])) white++
        else if (isCheckGray(d[p], d[p + 1], d[p + 2])) gray++
        const x = i % w, y = (i / w) | 0
        let ok = true
        for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
          if (nx >= w || ny >= h) continue
          const ni = idx(nx, ny)
          if (comp[ni] !== compId) continue
          const np = ni * 4
          if (Math.abs(d[p] - d[np]) > 4 || Math.abs(d[p + 1] - d[np + 1]) > 4 || Math.abs(d[p + 2] - d[np + 2]) > 4) { ok = false; break }
        }
        if (ok) flat++
      }
      const n = members.length
      // (a) 白+グレーの2色チェック柄ポケット / (b) チェック柄1マス分の単色白ポケット
      //     （キャラの白い絵柄＝マスクや氷は暖色/青みがあり両クラスに入らないため除外される・実測済）
      if (n >= 100 && ((white / n >= 0.15 && gray / n >= 0.15 && flat / n >= 0.75) || (white + gray) / n >= 0.55)) {
        for (const i of members) clear[i] = 1  // チェック柄ポケットと判定
      }
    }
  }

  for (let i = 0; i < w * h; i++) if (clear[i]) d[i * 4 + 3] = 0

  // 4) ハロー除去（厳格: ほぼ純白のみ・2周）
  for (let pass = 0; pass < 2; pass++) {
    const kill = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = idx(x, y) * 4
      if (d[p + 3] === 0) continue
      const mx = Math.max(d[p], d[p + 1], d[p + 2]), mn = Math.min(d[p], d[p + 1], d[p + 2])
      if (mx - mn > 10 || mn < 225) continue
      const tr = (xx, yy) => xx >= 0 && yy >= 0 && xx < w && yy < h && d[(idx(xx, yy)) * 4 + 3] === 0
      if (tr(x + 1, y) || tr(x - 1, y) || tr(x, y + 1) || tr(x, y - 1)) kill.push(p)
    }
    for (const p of kill) d[p + 3] = 0
    if (kill.length === 0) break
  }

  // 5) デスペックル: 周囲がほぼ透過の白っぽい孤立点/断片を除去（2周）
  for (let pass = 0; pass < 2; pass++) {
    const kill = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = idx(x, y) * 4
      if (d[p + 3] === 0) continue
      const mx = Math.max(d[p], d[p + 1], d[p + 2]), mn = Math.min(d[p], d[p + 1], d[p + 2])
      if (mx - mn > 28 || mn < 165) continue
      let trans = 0, total = 0
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        total++
        if (d[(idx(nx, ny)) * 4 + 3] === 0) trans++
      }
      if (total > 0 && trans / total >= 0.6) kill.push(p)
    }
    for (const p of kill) d[p + 3] = 0
    if (kill.length === 0) break
  }

  // 縁のフェザリング: 透過に隣接する縁は半透明化（白っぽい縁はより薄く＝チェック柄の混じり残りをなじませる）
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = idx(x, y) * 4
    if (d[p + 3] === 0) continue
    const tr = (xx, yy) => xx >= 0 && yy >= 0 && xx < w && yy < h && d[(idx(xx, yy)) * 4 + 3] === 0
    if (!(tr(x + 1, y) || tr(x - 1, y) || tr(x, y + 1) || tr(x, y - 1))) continue
    const mx = Math.max(d[p], d[p + 1], d[p + 2]), mn = Math.min(d[p], d[p + 1], d[p + 2])
    const whitish = (mx - mn) <= 16 && mn >= 200
    d[p + 3] = Math.min(d[p + 3], whitish ? 100 : 150)
  }

  fs.writeFileSync(file, PNG.sync.write(png))
  let cleared = 0
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] === 0) cleared++
  console.log(file, `${w}x${h}`, `透過: ${Math.round(cleared / (w * h) * 100)}%`)
}
