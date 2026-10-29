// ============================================================
// v2cap のダンジョンのボスのイラスト版：姿勢を1コマずつ大きな絵に描き出す（動きの数字を直すときの確かめ用・画面と同じ重ね方と回し方）
// ------------------------------------------------------------
// 2026-10-28 ユーザー「羽の付け根が外れて見えてる」：画面の枠は 300px までで細部が見えないので、立ち絵の大きさ（640px）で描いて確かめる
//   重ねる順・子のパーツ（下あご）・回す順は V2capAtbStage.jsx の IllustRig と同じ。口の中は暗い赤で塗るだけ（牙・光・残像は描かない）
// 使い方：node tools/v2cap-boss-pose.mjs <技のキー|idle|cast> <時刻ミリ秒,…> [出す PNG] [--key varuzenoku] [--scale 0.5]
//   cast＝構え（大技の詠唱）のあいだ（時刻は構えはじめてから）
//   例）node tools/v2cap-boss-pose.mjs gale 0,400,480,560 out.png   … 横に並べる（左から時刻の順）。idle の時刻は待機の時計
//   例）node tools/v2cap-boss-pose.mjs idle 0-10000 idle.webp --anim 50 --scale 0.5   … 動く WebP（2026-10-29 黒龍の待機の確かめ）
//   黒龍の待機の口の火の玉・しっぽの砂ぼこりも描く（画面の RigPart・RigDust と同じ）
// ============================================================
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRgba } from './v2cap-motion.mjs'
import { bossIllustOf, illustPoseAt, illustCastPoseAt, illustFreePoseAt, rotPoint, swapOpacityOf, dustEllipsesOf, bendFramesOf, illustShowAt, illustGhostsAt } from '../src/v2cap/lib/bossIllust.js'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..')
const PAD = { l: 160, t: 160, r: 60, b: 60 }   // 踏み込み・のけぞりで枠の外へ出るぶん

// 1コマ：{ W, H, data }（RGBA）。art＝bossIllustOf・imgs＝パーツの絵（art.parts と同じ並び）
//   freePose＝体の動きから切り離したパーツ（p.free・雨摩座の水の帯）の姿勢（画面と同じ＝待機のまま）
//   orbImg＝口の火の玉の絵（黒龍の待機・あれば描く）。砂ぼこり（pose.dust）は画面の RigDust と同じ楕円を、ぼかした色で重ねる
//   bendImgs＝曲げるパーツ（p.bend）の、曲げた絵を並べた1枚（パーツのキー → 絵）。画面の BendFrames と同じく、角度に近い2枚を重ねる
//   arts＝技のポーズの絵（2026-10-30）：{ show（illustShowAt）, ghosts:[{ name, pose, op }], poses（技の poses）, imgs（名前 → 絵） }。画面の IllustRig と同じ重ね方
export const renderPose = (art, imgs, pose, freePose = pose, orbImg = null, bendImgs = {}, arts = null) => {
  const S = art.base, W = S + PAD.l + PAD.r, H = S + PAD.t + PAD.b
  const out = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) { out[i * 4] = 8; out[i * 4 + 1] = 22; out[i * 4 + 2] = 50; out[i * 4 + 3] = 255 }
  const byKey = Object.fromEntries(art.parts.map((p, i) => [p.key, { p, img: imgs[i] }]))
  // 画面の点 → パーツの絵の上の点（全体→親→パーツの順に戻す）
  const chainOf = (key) => { const c = []; for (let q = key; q && byKey[q]; q = byKey[q].p.parent) c.unshift(byKey[q].p); return c }
  const toLocal = (X, Y, chain, pose) => {
    let pt = [X - PAD.l - pose.x * S, Y - PAD.t - pose.y * S]
    pt = rotPoint(pt, art.pivot, -pose.r)
    for (const p of chain) {
      // partMove（縮めてから回す）の逆：戻してから伸ばす
      if (p.bend) continue   // 曲げるパーツは回さない
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
  // op＝親から受けた濃さ。腕の構えの絵（p.swap）は切り替える割合で濃さを変える（画面の RigPart と同じ）
  const drawPart = (key, op = 1) => {
    const { p, img } = byKey[key], chain = chainOf(key)
    const ps = p.free ? freePose : pose
    const o = op * (p.swap ? swapOpacityOf(p.swap, ps) : 1)
    if (o <= 0) return
    const inside = key === 'head' && art.jaw && (pose.jaw || 0) < -0.5
      ? [...art.jaw.line, ...art.jaw.line.map(q => rotPoint(q, art.jaw.pivot, pose.jaw)).reverse()] : null
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const [u, v] = toLocal(X, Y, chain, ps)
      const i = (Y * W + X) * 4
      if (inside && inPolygon(inside, u, v)) over(i, 42 + 200 * (pose.glow || 0), 3 + 90 * (pose.glow || 0), 6, 255)
      if (p.bend && bendImgs[key]) {
        const b = p.bend, sh = bendImgs[key], fw = sh.W / b.n, { i: f0, j: f1, k } = bendFramesOf(b, ps[key] || 0)
        const bx = (u - b.x) / b.w * fw - 0.5, by = (v - b.y) / b.h * sh.H - 0.5
        if (bx < -1 || by < -1 || bx > fw || by > sh.H) continue
        for (const [n, w] of [[f0, 1], [f1, f1 === f0 ? 0 : k]]) {
          if (w <= 0.01) continue
          const xx = Math.min(fw - 1, Math.max(0, Math.round(bx))) + n * fw, yy = Math.min(sh.H - 1, Math.max(0, Math.round(by)))
          over(i, sample(sh, xx, yy, 0), sample(sh, xx, yy, 1), sample(sh, xx, yy, 2), sample(sh, xx, yy, 3) * o * w)
        }
        continue
      }
      const x = u - p.x - 0.5, y = v - p.y - 0.5
      if (x < -1 || y < -1 || x > p.w || y > p.h) continue
      const sx = x * img.W / p.w, sy = y * img.H / p.h
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0
      const px = [0, 1, 2, 3].map(ch => (sample(img, x0, y0, ch) * (1 - fx) + sample(img, x0 + 1, y0, ch) * fx) * (1 - fy)
        + (sample(img, x0, y0 + 1, ch) * (1 - fx) + sample(img, x0 + 1, y0 + 1, ch) * fx) * fy)
      over(i, px[0], px[1], px[2], px[3] * o)
    }
    for (const c of art.parts) if (c.nest && c.parent === key) drawPart(c.key, o)
    // 口の火の玉（画面の RigPart と同じ：頭の中・回ってゆらめく）
    if (key === 'head' && orbImg && art.orb && pose.orb > 0.001) {
      const s = art.orb.size * S * pose.orb * (1 + 0.05 * Math.sin(pose.orbT / 45)) / orbImg.W, rot = pose.orbT * 0.12
      for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
        const [u, v] = toLocal(X, Y, chain, ps)
        const [ru, rv] = rotPoint([u, v], art.orb.at, -rot)
        const sx = (ru - art.orb.at[0]) / s + orbImg.W / 2, sy = (rv - art.orb.at[1]) / s + orbImg.H / 2
        if (sx < 0 || sy < 0 || sx >= orbImg.W - 1 || sy >= orbImg.H - 1) continue
        const x0 = Math.floor(sx), y0 = Math.floor(sy)
        const i = (Y * W + X) * 4
        over(i, sample(orbImg, x0, y0, 0), sample(orbImg, x0, y0, 1), sample(orbImg, x0, y0, 2), sample(orbImg, x0, y0, 3) * o * pose.orbOp)
      }
    }
  }
  // ポーズの絵（全体の姿勢 pz で動かす・立ち絵の px で置く）
  const drawPoseArt = (name, pz, op) => {
    const p = arts.poses[name], img = arts.imgs[name]
    if (!p || !img || op <= 0.001) return
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
      const [u, v] = rotPoint([X - PAD.l - pz.x * S, Y - PAD.t - pz.y * S], art.pivot, -pz.r)
      const sx = (u - p.x) / p.w * img.W - 0.5, sy = (v - p.y) / p.h * img.H - 0.5
      if (sx < -1 || sy < -1 || sx > img.W || sy > img.H) continue
      const xx = Math.min(img.W - 1, Math.max(0, Math.round(sx))), yy = Math.min(img.H - 1, Math.max(0, Math.round(sy)))
      over((Y * W + X) * 4, sample(img, xx, yy, 0), sample(img, xx, yy, 1), sample(img, xx, yy, 2), sample(img, xx, yy, 3) * op)
    }
  }
  const rigOp = arts?.show ? arts.show.rig : 1
  for (const p of art.parts) if (!p.nest && p.free) drawPart(p.key)
  for (const g of arts?.ghosts || []) drawPoseArt(g.name, g.pose, g.op)
  if (rigOp > 0.001) for (const p of art.parts) if (!p.nest && !p.free) drawPart(p.key, rigOp)
  for (const sp of arts?.show?.poses || []) drawPoseArt(sp.name, pose, sp.op)
  // 砂ぼこり（画面の RigDust と同じ楕円・真ん中ほど濃い）
  if (art.dust && pose.dust > 0) {
    for (const { cx, cy, rx, ry, op } of dustEllipsesOf(art.dust, pose.dust)) {
      for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
        let [u, v] = [X - PAD.l - pose.x * S, Y - PAD.t - pose.y * S]
        ;[u, v] = rotPoint([u, v], art.pivot, -pose.r)
        const q = Math.hypot((u - cx) / rx, (v - cy) / ry)
        if (q >= 1) continue
        const a = q < 0.6 ? 0.85 - (0.85 - 0.45) * q / 0.6 : 0.45 * (1 - (q - 0.6) / 0.4)
        over((Y * W + X) * 4, 112, 98, 88, 255 * a * op)
      }
    }
  }
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
  const key = opt('--key', 'varuzenoku'), scale = +opt('--scale', '0.5'), anim = +opt('--anim', '0')
  const [mk, times = '0', out = path.join(ROOT, `pose-${args[0] || 'idle'}.png`)] = args
  const art = bossIllustOf(key)
  if (!art) throw new Error(`イラスト版が無い：${key}`)
  const motion = mk === 'idle' || mk === 'cast' ? null : art.motions[mk]
  if (mk !== 'idle' && mk !== 'cast' && !motion) throw new Error(`技が無い：${mk}（${Object.keys(art.motions).join('・')}・idle）`)
  const load = (src) => readRgba(path.join(ROOT, 'public', decodeURI(src.split('?')[0])))
  const imgs = art.parts.map(p => load(p.src)), orbImg = art.orb ? load(art.orb.src) : null
  const bendImgs = Object.fromEntries(art.parts.filter(p => p.bend).map(p => [p.key, load(p.bend.src)]))
  const poseAt = (ms) => mk === 'cast' ? illustCastPoseAt(key, ms, 0) : illustPoseAt(key, motion, motion ? ms : 0, motion ? 0 : ms)
  const freeAt = (ms) => illustFreePoseAt(key, motion || mk === 'cast' ? 0 : ms)
  // 技のポーズの絵（できているものだけ）
  const poseImgs = Object.fromEntries(Object.entries(motion?.poses || {}).map(([n, p]) => [n, load(p.src)]))
  const artsAt = (ms) => motion?.poses ? { show: illustShowAt(motion, ms), ghosts: illustGhostsAt(motion, ms).map(g => ({ ...g, pose: poseAt(g.ms) })), poses: motion.poses, imgs: poseImgs } : null
  // --anim <ミリ秒>：時刻を「はじめ-おわり」で渡すと、その間隔のコマを動く WebP にする（例：idle 0-10000 out.webp --anim 50）
  if (anim) {
    const [t0, t1] = times.split('-').map(Number), list = []
    for (let t = t0; t < t1; t += anim) list.push(renderPose(art, imgs, poseAt(t), freeAt(t), orbImg, bendImgs, artsAt(t)))
    const W = list[0].W, H = list[0].H
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(1000 / anim), '-i', '-',
      '-vf', `scale=${Math.round(W * scale)}:-1:flags=area`, '-c:v', 'libwebp', '-loop', '0', '-quality', '70', out], { input: Buffer.concat(list.map(f => f.data)), maxBuffer: 1 << 30 })
    console.log(`→ ${path.relative(ROOT, out) || out}（${list.length}コマ・動く）`)
    process.exit(0)
  }
  const frames = times.split(',').map(Number).map(ms => renderPose(art, imgs, poseAt(ms), freeAt(ms), orbImg, bendImgs, artsAt(ms)))
  const W = frames[0].W, H = frames[0].H
  const all = Buffer.alloc(W * frames.length * H * 4)
  frames.forEach((f, n) => { for (let y = 0; y < H; y++) f.data.copy(all, (y * W * frames.length + n * W) * 4, y * W * 4, (y + 1) * W * 4) })
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W * frames.length}x${H}`, '-i', '-',
    '-vf', `scale=${Math.round(W * frames.length * scale)}:-1:flags=area`, out], { input: all, maxBuffer: 1 << 28 })
  console.log(`→ ${path.relative(ROOT, out) || out}（${frames.length}コマ）`)
}
