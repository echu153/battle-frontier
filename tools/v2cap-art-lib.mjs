// ============================================================
// v2cap の絵を軽い版にするツールの共通部品（tools/v2cap-enemy-art.mjs・tools/v2cap-art.mjs）
// ------------------------------------------------------------
// ・読み込みは ffmpeg で生の画素にする（長いほうの辺を maxSide に縮める・縦横比はそのまま）
// ・透明なところの色を近くの体の色で埋めてから縮める（bleed）。
//   ffmpeg の縮小は透明を考えずに色を混ぜるので、透明なところに隠れた色（灰色の背景など）が縁ににじむため
// ・体がちょうど収まる正方形に切り取って、size×size の透明つき WebP にする（encodeSquare）
// 画素の並びは { data, W, H }（data は1画素 3バイト（rgb24）か4バイト（rgba））
// ============================================================
import { execFileSync } from 'node:child_process'

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
export const each4 = (W, H, p, fn) => {
  const x = p % W, y = (p / W) | 0
  for (const [dx, dy] of N4) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) fn(yy * W + xx) }
}

export const probe = (file) => {
  const [w, h, fmt] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', file]).toString().trim().split(',')
  return { w: Number(w), h: Number(h), fmt, alpha: /^(rgba|bgra|argb|abgr|ya8|ya16|gbrap|yuva|pal8)/.test(fmt) }
}

// fmt は 'rgb24' か 'rgba'
export const decode = (file, maxSide, fmt) => {
  const { w, h } = probe(file)
  const k = Math.min(1, maxSide / Math.max(w, h))
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k))
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', fmt, '-'], { maxBuffer: 1 << 28 })
  return { data, W, H }
}

// 透明（アルファ0）なところの色を、まわりの見えている色で埋める（steps px ぶん外へ広げる）
export const bleed = ({ data: rgba, W, H }, steps = 12) => {
  const N = W * H
  const filled = new Uint8Array(N)
  for (let p = 0; p < N; p++) if (rgba[p * 4 + 3] > 0) filled[p] = 1
  let ring = []
  for (let p = 0; p < N; p++) if (!filled[p]) { let near = false; each4(W, H, p, r => { if (filled[r]) near = true }); if (near) ring.push(p) }
  for (let step = 0; step < steps && ring.length; step++) {
    const next = []
    for (const p of ring) {
      if (filled[p]) continue
      let n = 0; const s = [0, 0, 0]
      each4(W, H, p, r => { if (filled[r]) { n++; for (let c = 0; c < 3; c++) s[c] += rgba[r * 4 + c] } })
      if (!n) continue
      for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.round(s[c] / n)
      next.push(p)
    }
    for (const p of next) filled[p] = 1
    ring = []
    for (const p of next) each4(W, H, p, r => { if (!filled[r]) ring.push(r) })
  }
}

// 見えているところ（アルファ thr 以上）の範囲。何も無ければ null
export const alphaBox = ({ data: rgba, W, H }, thr = 8) => {
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let p = 0; p < W * H; p++) {
    if (rgba[p * 4 + 3] < thr) continue
    const x = p % W, y = (p / W) | 0
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

// box を真ん中にした正方形（余白 margin）に切り取り、size×size の WebP（透明つき）で書く。はみ出すぶんは透明で足す
export const encodeSquare = ({ data: rgba, W, H }, box, out, { size = 192, margin = 0.04, quality = 82 } = {}) => {
  const side = Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1)
  const S = Math.round(side * (1 + 2 * margin))
  const X = Math.round((box.x0 + box.x1 + 1) / 2 - S / 2), Y = Math.round((box.y0 + box.y1 + 1) / 2 - S / 2)
  const P = S
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-',
    '-vf', `pad=iw+${2 * P}:ih+${2 * P}:${P}:${P}:color=0x00000000,crop=${S}:${S}:${X + P}:${Y + P},scale=${size}:${size}:flags=lanczos`,
    '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(quality), '-frames:v', '1', out], { input: rgba })
}
