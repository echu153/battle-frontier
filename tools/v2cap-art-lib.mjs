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
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

// 絵の中身から作る印（8文字）。画面ではアドレスの後ろに ?v=印 を付ける（lib/bossArt.js・lib/motionArt.js）
//   【確定】2026-10-28 ユーザー「攻撃モーションのとき、枠に収まりきってないよ」（PCの本番）：サービスワーカー（public/sw.js）は
//   絵をまずキャッシュから出して裏で入れ替えるので、同じ名前で絵を描き直すと、次に開いたときだけ古い絵（コマの数・大きさが違う）が
//   新しい一覧の割り方で出て、竜がずれて切れた。中身が変わればアドレスも変わるようにする
export const versionOf = (file) => createHash('md5').update(readFileSync(file)).digest('hex').slice(0, 8)
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
    // 次の輪は同じ画素を1回だけ（2026-10-28 40px 広げたら同じ画素が何重にも入って配列があふれた。色の結果は前と同じ）
    ring = []
    const queued = new Uint8Array(N)
    for (const p of next) each4(W, H, p, r => { if (!filled[r] && !queued[r]) { queued[r] = 1; ring.push(r) } })
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

// ===== 背景を抜く（モンスターの絵・tools/v2cap-enemy-art.mjs）=====
// 背景の見立ては縁の色から決める（bgModelOf）：
//   flat    … 1色（縁の色の中央値）。エリア①②の灰色の背景
//   checker … 2色の灰色のチェック模様。AIが「透明」を絵として描き込んだもの（2026-10-14 エリア③のコボルト・スケルトン）。
//             暗いほうと明るいほうの色、そのあいだの色（升目の境のぼかし）を背景とみなす
// ★透明つきの元の絵（PNG の透明）は抜かずに、その透明をそのまま使う（transparentBorderRatio で見分ける・2026-10-14）
export const borderOf = (W, H) => {
  const border = []
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x)
  for (let y = 1; y < H - 1; y++) border.push(y * W, y * W + W - 1)
  return border
}

// 縁の画素のうち、透明（アルファ16未満）なものの割合。rgba だけ
export const transparentBorderRatio = ({ data: rgba, W, H }) => {
  const border = borderOf(W, H)
  return border.filter(p => rgba[p * 4 + 3] < 16).length / border.length
}

export const KEY = {
  T_IN: 14,          // 背景の色からこれ以内（RGBのいちばん大きい差）なら背景
  T_OUT: 40,         // 縁の近くでこれ以上離れていれば体（あいだは半透明）
  BAND: 3,           // 半透明にする幅（px）
  POCKET_MIN: 25,    // 体に囲まれたすき間を抜く大きさ（px）
  POCKET_MEAN: 6,    // flat：すき間の背景の色との差の平均がこれ以下なら抜く
  // flat の「ゆるいすき間」（loosePockets を付けた絵だけ）：大きくて（px）・なめらかで（明るさのばらつき）・差の平均がこれ以下なら抜く。
  //   【確定】2026-10-26 煙や砂の渦に囲まれた背景（トオボエウルフなど）は、背景のうっすらしたむらで差の平均が6.7〜9.7になり抜けなかった。
  //   ⚠全部の絵には使わない：海賊砲手の灰色のズボン（差の平均6.8・ばらつき3.6）まで抜けて穴が開く。目で確かめた絵だけ（tools/v2cap-enemy-art.mjs）
  POCKET_LOOSE_MIN: 300,
  POCKET_LOOSE_STD: 4,
  POCKET_LOOSE_MEAN: 10,
  POCKET_TONE: 0.15, // checker：すき間に2色の両方がこの割合以上あれば抜く（1色だけのかたまりは体の白・灰色として残す）
  CHECKER_GAP: 24,   // checker と見る2色の明るさの差（これ以上）
  CHECKER_MASS: 0.25,// checker と見る、縁に占める2色それぞれの割合（これ以上）
  CHECKER_SAT: 6,    // checker と見る、縁の色の鮮やかさ（RGBの最大−最小）の上限（95%の画素）
  CHECKER_MIN_LUM: 150, // checker の暗いほうの明るさの下限（AIの透明の模様は白と薄い灰色）
}

const lumOf = (rgb, p) => (rgb[p * 3] + rgb[p * 3 + 1] + rgb[p * 3 + 2]) / 3

export const bgModelOf = ({ data: rgb, W, H }, k = KEY) => {
  const border = borderOf(W, H)
  const med = [0, 1, 2].map(c => { const v = border.map(p => rgb[p * 3 + c]).sort((a, b) => a - b); return v[v.length >> 1] })
  const flat = { mode: 'flat', bg: med }
  // 2色のチェック模様か：縁の明るさに、CHECKER_GAP 以上離れた2つの山があり、どちらも縁の CHECKER_MASS 以上を占め、色が無い（灰色）
  const sats = border.map(p => Math.max(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]) - Math.min(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2])).sort((a, b) => a - b)
  if (sats[Math.floor(0.95 * (sats.length - 1))] > k.CHECKER_SAT) return flat
  const hist = new Array(256).fill(0)
  for (const p of border) hist[Math.round(lumOf(rgb, p))]++
  const mass = (l) => { let s = 0; for (let v = Math.max(0, l - 10); v <= Math.min(255, l + 10); v++) s += hist[v]; return s / border.length }
  let a = 0
  for (let v = 0; v < 256; v++) if (mass(v) > mass(a)) a = v
  let b = -1
  for (let v = 0; v < 256; v++) if (Math.abs(v - a) >= k.CHECKER_GAP && (b < 0 || mass(v) > mass(b))) b = v
  if (b < 0 || mass(a) < k.CHECKER_MASS || mass(b) < k.CHECKER_MASS || Math.min(a, b) < k.CHECKER_MIN_LUM) return flat
  const [lo, hi] = a < b ? [a, b] : [b, a]
  const meanColor = (l) => {
    const s = [0, 0, 0]; let n = 0
    for (const p of border) if (Math.abs(lumOf(rgb, p) - l) <= 10) { n++; for (let c = 0; c < 3; c++) s[c] += rgb[p * 3 + c] }
    return s.map(v => v / n)
  }
  return { mode: 'checker', lo: meanColor(lo), hi: meanColor(hi) }
}

// 背景を抜いた rgba を返す：{ img, clear（透明にできた割合）, mode, edgeLeft（抜いたあとも縁に残った体の割合） }
// opts.loosePockets … flat の絵で「ゆるいすき間」も抜く（KEY.POCKET_LOOSE_*・目で確かめた絵だけに付ける）
// opts.softPockets … { min, mean, std, haze:{ sat, lum } } 「ゆるいすき間」の条件を絵ごとに決める（loosePockets の代わり）。haze は霧のふちのにじみも抜く。
//   これも目で確かめた絵だけに付ける（tools/v2cap-enemy-art.mjs の SOFT_POCKETS）
export const keyBackground = (img, k = KEY, opts = {}) => {
  const { data: rgb, W, H } = img
  const N = W * H
  const model = bgModelOf(img, k)
  const border = borderOf(W, H)
  // 画素ごとの「背景の色」と、そこからの差
  const bgAt = new Float32Array(N * 3)
  const dist = new Float32Array(N)
  const tone = new Float32Array(N)   // checker：暗いほう0〜明るいほう1
  if (model.mode === 'flat') {
    const bg = model.bg
    for (let p = 0; p < N; p++) {
      dist[p] = Math.max(Math.abs(rgb[p * 3] - bg[0]), Math.abs(rgb[p * 3 + 1] - bg[1]), Math.abs(rgb[p * 3 + 2] - bg[2]))
      bgAt[p * 3] = bg[0]; bgAt[p * 3 + 1] = bg[1]; bgAt[p * 3 + 2] = bg[2]
    }
  } else {
    const { lo, hi } = model
    const L0 = (lo[0] + lo[1] + lo[2]) / 3, L1 = (hi[0] + hi[1] + hi[2]) / 3
    for (let p = 0; p < N; p++) {
      const t = Math.min(1, Math.max(0, (lumOf(rgb, p) - L0) / (L1 - L0)))
      tone[p] = t
      let d = 0
      for (let c = 0; c < 3; c++) {
        const q = lo[c] + t * (hi[c] - lo[c])
        bgAt[p * 3 + c] = q
        d = Math.max(d, Math.abs(rgb[p * 3 + c] - q))
      }
      dist[p] = d
    }
  }
  const each = (p, fn) => each4(W, H, p, fn)
  // 縁からつながる背景（lay 0）
  const lay = new Int16Array(N).fill(-1)
  const core = []
  for (const p of border) if (lay[p] < 0 && dist[p] <= k.T_IN) { lay[p] = 0; core.push(p) }
  for (let h = 0; h < core.length; h++) each(core[h], r => { if (lay[r] < 0 && dist[r] <= k.T_IN) { lay[r] = 0; core.push(r) } })
  // 体に囲まれたすき間
  const seen = new Uint8Array(N)
  for (let s = 0; s < N; s++) {
    if (seen[s] || lay[s] >= 0 || dist[s] > k.T_IN) continue
    const blob = [s]; seen[s] = 1; let sum = 0, dark = 0, light = 0, ls = 0, ls2 = 0
    for (let h = 0; h < blob.length; h++) {
      const p = blob[h]
      sum += dist[p]
      const l = lumOf(rgb, p); ls += l; ls2 += l * l
      if (tone[p] < 0.35) dark++
      else if (tone[p] > 0.65) light++
      each(p, r => { if (!seen[r] && lay[r] < 0 && dist[r] <= k.T_IN) { seen[r] = 1; blob.push(r) } })
    }
    const n = blob.length
    const soft = opts.softPockets
    const loose = () => (soft
      ? n >= soft.min && sum / n <= soft.mean && Math.sqrt(Math.max(0, ls2 / n - (ls / n) ** 2)) <= soft.std
      : opts.loosePockets && n >= k.POCKET_LOOSE_MIN && sum / n <= k.POCKET_LOOSE_MEAN
        && Math.sqrt(Math.max(0, ls2 / n - (ls / n) ** 2)) <= k.POCKET_LOOSE_STD)
    const isBg = n >= k.POCKET_MIN && (model.mode === 'flat'
      ? sum / n <= k.POCKET_MEAN || loose()
      : dark / n >= k.POCKET_TONE && light / n >= k.POCKET_TONE)
    if (isBg) for (const p of blob) { lay[p] = 0; core.push(p) }
  }
  // 霧のふちのにじみ（opts.softPockets.haze を付けた絵だけ）：抜いた所から、色がほとんど無くて明るさが背景に近い画素へ広げる
  //   sat＝RGBの最大−最小の上限・lum＝背景との明るさの差の上限。flat の絵だけ
  const haze = opts.softPockets?.haze
  if (haze && model.mode === 'flat') {
    const bgLum = (model.bg[0] + model.bg[1] + model.bg[2]) / 3
    const hazy = (p) => Math.abs(lumOf(rgb, p) - bgLum) <= haze.lum
      && Math.max(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]) - Math.min(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]) <= haze.sat
    for (let h = 0; h < core.length; h++) each(core[h], r => { if (lay[r] < 0 && hazy(r)) { lay[r] = 0; core.push(r) } })
  }
  // 背景のまわり BAND px（lay 1..BAND）。checker は、いちばん近い背景の画素の色をその場所の背景の色にする
  //   （升目の色はとなりで変わるので、明るさから決めた色より正確。flat は1色なので同じ）
  const from = new Int32Array(N).fill(-1)
  for (const p of core) from[p] = p
  let front = core
  for (let b = 1; b <= k.BAND; b++) {
    const next = []
    for (const p of front) each(p, r => { if (lay[r] < 0) { lay[r] = b; from[r] = from[p]; next.push(r) } })
    front = next
  }
  if (model.mode === 'checker') {
    for (let p = 0; p < N; p++) {
      if (!(lay[p] > 0)) continue
      const q = from[p]
      let d = 0
      for (let c = 0; c < 3; c++) { bgAt[p * 3 + c] = rgb[q * 3 + c]; d = Math.max(d, Math.abs(rgb[p * 3 + c] - rgb[q * 3 + c])) }
      dist[p] = d
    }
  }
  const rgba = Buffer.alloc(N * 4)
  for (let p = 0; p < N; p++) {
    const a = lay[p] === 0 ? 0 : lay[p] > 0 ? Math.min(1, Math.max(0, (dist[p] - k.T_IN) / (k.T_OUT - k.T_IN))) : 1
    for (let c = 0; c < 3; c++) {
      let v = rgb[p * 3 + c]
      const q = bgAt[p * 3 + c]
      if (a > 0 && a < 1) v = q + (v - q) / a   // 混ざった背景の色を差し引く
      rgba[p * 4 + c] = Math.max(0, Math.min(255, Math.round(v)))
    }
    rgba[p * 4 + 3] = Math.round(a * 255)
  }
  const out = { data: rgba, W, H }
  return { img: out, clear: core.length / N, mode: model.mode, edgeLeft: border.filter(p => rgba[p * 4 + 3] > 128).length / border.length }
}

// ★縮めるのは rgba のまま行い（SCALE_KEEP_ALPHA の format=rgba）、そのあとで WebP の yuva420p に変える。
//   【2026-10-26 直した】lanczos の縮小と yuva420p への変換を ffmpeg が1回でまとめてやると、透明（0）が 1 になり、
//   透明なところ全体にうっすら暗い膜がかかっていた（鍛冶屋の親方の絵で、まわりが暗い四角に見えて分かった。看板娘の絵も同じだった）
const SCALE_KEEP_ALPHA = 'format=rgba'

// box（まわりに余白 margin＝長いほうの辺に対する割合）を長方形のまま切り取り、高さ height の WebP（透明つき・縦横比はそのまま）で書く。
// はみ出すぶんは透明で足す。幅は偶数にそろえる（yuva420p は奇数の幅にできない）。書いた大きさ { w, h } を返す（看板娘・鍛冶屋の親方の絵）
export const encodeRect = ({ data: rgba, W, H }, box, out, { height = 640, margin = 0, quality = 82 } = {}) => {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1
  const m = Math.round(Math.max(bw, bh) * margin)
  const CW = bw + 2 * m, CH = bh + 2 * m
  const w = Math.max(2, Math.round(CW * height / CH / 2) * 2)
  const P = m
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-',
    '-vf', `pad=iw+${2 * P}:ih+${2 * P}:${P}:${P}:color=0x00000000,crop=${CW}:${CH}:${box.x0 - m + P}:${box.y0 - m + P},scale=${w}:${height}:flags=lanczos,${SCALE_KEEP_ALPHA}`,
    '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(quality), '-frames:v', '1', out], { input: rgba })
  return { w, h: height }
}

// box を真ん中にした正方形（余白 margin）に切り取り、size×size の WebP（透明つき）で書く。はみ出すぶんは透明で足す
export const encodeSquare = ({ data: rgba, W, H }, box, out, { size = 192, margin = 0.04, quality = 82 } = {}) => {
  const side = Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1)
  const S = Math.round(side * (1 + 2 * margin))
  const X = Math.round((box.x0 + box.x1 + 1) / 2 - S / 2), Y = Math.round((box.y0 + box.y1 + 1) / 2 - S / 2)
  const P = S
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-',
    '-vf', `pad=iw+${2 * P}:ih+${2 * P}:${P}:${P}:color=0x00000000,crop=${S}:${S}:${X + P}:${Y + P},scale=${size}:${size}:flags=lanczos,${SCALE_KEEP_ALPHA}`,
    '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-quality', String(quality), '-frames:v', '1', out], { input: rgba })
}
