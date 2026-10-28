// ============================================================
// v2cap のダンジョンのボスのイラスト版：姿勢を1コマずつ大きな絵に描き出す（動きの数字を直すときの確かめ用・画面と同じ重ね方と回し方）
// ------------------------------------------------------------
// 2026-10-28 ユーザー「羽の付け根が外れて見えてる」：画面の枠は 300px までで細部が見えないので、立ち絵の大きさ（640px）で描いて確かめる
//   重ねる順・子のパーツ（下あご）・回す順は V2capAtbStage.jsx の IllustRig と同じ。口の中は暗い赤で塗るだけ（牙・光・残像は描かない）
// 使い方：node tools/v2cap-boss-pose.mjs <技のキー|idle> <時刻ミリ秒,…> [出す PNG] [--key varuzenoku] [--scale 0.5]
//   例）node tools/v2cap-boss-pose.mjs gale 0,400,480,560 out.png   … 横に並べる（左から時刻の順）。idle の時刻は待機の時計
// ============================================================
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRgba } from './v2cap-motion.mjs'
import { bossIllustOf, illustPoseAt, rotPoint } from '../src/v2cap/lib/bossIllust.js'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..')
const PAD = { l: 160, t: 160, r: 60, b: 60 }   // 踏み込み・のけぞりで枠の外へ出るぶん

// 1コマ：{ W, H, data }（RGBA）。art＝bossIllustOf・imgs＝パーツの絵（art.parts と同じ並び）
export const renderPose = (art, imgs, pose) => {
  const S = art.base, W = S + PAD.l + PAD.r, H = S + PAD.t + PAD.b
  const out = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) { out[i * 4] = 8; out[i * 4 + 1] = 22; out[i * 4 + 2] = 50; out[i * 4 + 3] = 255 }
  const byKey = Object.fromEntries(art.parts.map((p, i) => [p.key, { p, img: imgs[i] }]))
  // 画面の点 → パーツの絵の上の点（全体→親→パーツの順に戻す）
  const chainOf = (key) => { const c = []; for (let q = key; q && byKey[q]; q = byKey[q].p.parent) c.unshift(byKey[q].p); return c }
  const toLocal = (X, Y, chain) => {
    let pt = [X - PAD.l - pose.x * S, Y - PAD.t - pose.y * S]
    pt = rotPoint(pt, art.pivot, -pose.r)
    for (const p of chain) {
      // partMove（縮めてから回す）の逆：戻してから伸ばす
      const c = [p.px, p.py], sq = pose[`${p.key}Sq`] || 0
      pt = rotPoint(pt, c, -(pose[p.key] || 0))
      if (sq) { pt = rotPoint(pt, c, -(p.ax || 0)); pt = rotPoint([c[0] + (pt[0] - c[0]) / (1 - sq), pt[1]], c, p.ax || 0) }
    }
    return pt
  }
  const over = (i, r, g, b, a) => {
    if (a <= 0) return
    const k = a / 255
    out[i] = out[i] * (1 - k) + r * k; out[i + 1] = out[i + 1] * (1 - k) + g * k; out[i + 2] = out[i + 2] * (1 - k) + b * k
  }
  const sample = (img, x, y, ch) => (x < 0 || y < 0 || x >= img.W || y >= img.H) ? 0 : img.data[(y * img.W + x) * 4 + ch]
  const drawPart = (key) => {
    const { p, img } = byKey[key], chain = chainOf(key)
    const inside = key === 'head' && art.jaw && (pose.jaw || 0) < -0.5
      ? [...art.jaw.line, ...art.jaw.line.map(q => rotPoint(q, art.jaw.pivot, pose.jaw)).reverse()] : null
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const [u, v] = toLocal(X, Y, chain)
      const i = (Y * W + X) * 4
      if (inside && inPolygon(inside, u, v)) over(i, 42 + 200 * (pose.glow || 0), 3 + 90 * (pose.glow || 0), 6, 255)
      const x = u - p.x - 0.5, y = v - p.y - 0.5
      if (x < -1 || y < -1 || x > p.w || y > p.h) continue
      const sx = x * img.W / p.w, sy = y * img.H / p.h
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0
      const px = [0, 1, 2, 3].map(ch => (sample(img, x0, y0, ch) * (1 - fx) + sample(img, x0 + 1, y0, ch) * fx) * (1 - fy)
        + (sample(img, x0, y0 + 1, ch) * (1 - fx) + sample(img, x0 + 1, y0 + 1, ch) * fx) * fy)
      over(i, px[0], px[1], px[2], px[3])
    }
    for (const c of art.parts) if (c.nest && c.parent === key) drawPart(c.key)
  }
  for (const p of art.parts) if (!p.nest) drawPart(p.key)
  return { W, H, data: out }
}
const inPolygon = (poly, x, y) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c
  }
  return c
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const args = process.argv.slice(2)
  const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v }
  const key = opt('--key', 'varuzenoku'), scale = +opt('--scale', '0.5')
  const [mk, times = '0', out = path.join(ROOT, `pose-${args[0] || 'idle'}.png`)] = args
  const art = bossIllustOf(key)
  if (!art) throw new Error(`イラスト版が無い：${key}`)
  const motion = mk === 'idle' ? null : art.motions[mk]
  if (mk !== 'idle' && !motion) throw new Error(`技が無い：${mk}（${Object.keys(art.motions).join('・')}・idle）`)
  const imgs = art.parts.map(p => readRgba(path.join(ROOT, 'public', decodeURI(p.src.split('?')[0]))))
  const frames = times.split(',').map(Number).map(ms => renderPose(art, imgs, illustPoseAt(key, motion, motion ? ms : 0, motion ? 0 : ms)))
  const W = frames[0].W, H = frames[0].H
  const all = Buffer.alloc(W * frames.length * H * 4)
  frames.forEach((f, n) => { for (let y = 0; y < H; y++) f.data.copy(all, (y * W * frames.length + n * W) * 4, y * W * 4, (y + 1) * W * 4) })
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W * frames.length}x${H}`, '-i', '-',
    '-vf', `scale=${Math.round(W * frames.length * scale)}:-1:flags=area`, out], { input: all, maxBuffer: 1 << 28 })
  console.log(`→ ${path.relative(ROOT, out) || out}（${frames.length}コマ）`)
}
