// ============================================================
// v2cap のダンジョンのボスの絵（ChatGPT で作った「2段に並べたコマ・真緑の背景」と遭遇のイラスト）を、画面で使う形にする
// ------------------------------------------------------------
// 元の絵（ユーザーが置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/（決まりは src/v2cap/lib/bossArt.js の BOSS_DEFS）
//   待機.png・<技の名前>.png・イラスト.png（ドット絵版。フォルダの中のフォルダ＝イラスト版は読まない）。コマは3列×2段（6コマ）か4列×2段（8コマ・2026-10-28 ユーザー選択）＝列の数は絵から数える
// 作るもの：
//   public/v2cap-art/boss/<key>-idle.webp   … 待機のコマをくり返す動くWebP（base×base・コマごとの長さ idleMs）
//   public/v2cap-art/boss/<key>-<技>.webp    … 最初と最後を除いたコマを横に並べた1枚（透明つき）
//   public/v2cap-art/boss/<key>-illust.webp … 遭遇のイラスト（768×768）
//   public/v2cap-art/boss/<key>-fx-<技>-<fly|hit>.webp … エフェクト（<技の名前>_飛ぶ.png・_当たる.png・3列×2段）の6コマを横に並べた1枚
//   src/v2cap/lib/bossArtList.js           … 一覧（コマの数・1コマの大きさ・ずらし・速さ）
// 手順：
//   ① 真緑を抜く（tools/v2cap-motion.mjs の keyGreen）
//   ② ひとつながりの絵（まとまり）を拾い、まとまりの真ん中があるマスのコマに入れる＝隣のマスまで伸びた体や炎も切れない
//   ②' 待機は、体の動かない場所（anchor＝竜なら脚と尾）が①と重なるように、2コマ目からをずらしてそろえる
//      【確定】2026-10-28 ユーザー「羽動かすときに体も揺れすぎ、ゴムみたいになってる」：ChatGPT の6コマは体が上下に最大22px（元の絵）浮き沈みしていた
//   ②'' 技の絵は1枚ずつ別に作るので、①の竜の大きさ（高さ）を待機の①に合わせて縮め、体の動かない場所で待機の①に重ねる
//   ③ 待機のコマがぜんぶ収まる正方形を「待機の枠」にする。技のコマは、待機の枠とそのコマがぜんぶ収まる大きさにして、
//      待機の枠がどこにあるか（ox・oy）を一覧に書く
//   ④ 縮める（SCALE_OF：3列は半分・4列は3/4＝どちらも竜が約250px）。クラスの攻撃の絵とドットの細かさがそろう
// 使い方：
//   node tools/v2cap-boss-art.mjs          … 元の絵が新しくなったボスだけ作り直す
//   node tools/v2cap-boss-art.mjs --force  … 全部作り直す
// ★元の絵が無くても（別のPCなど）、作ってある絵と一覧は消さない
// ★ffmpeg（libwebp）を使う
// ============================================================
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, bleed, alphaBox, encodeSquare, versionOf } from './v2cap-art-lib.mjs'
import { keyGreen, componentsOf, readRgba, scaleRgba } from './v2cap-motion.mjs'
import { BOSS_DEFS, BOSS_ART_SRC_DIR, BOSS_ART_DIR, BOSS_SHEET_COLS, BOSS_SHEET_ROWS, BOSS_ILLUST_SIZE, BOSS_HIT_OF, BOSS_FX_COLS, bossFileOf, bossFxKindOf } from '../src/v2cap/lib/bossArt.js'
import { ENEMY_ART_SRC_DIR } from '../src/v2cap/lib/enemyArt.js'
import { BOSS_ART } from '../src/v2cap/lib/bossArtList.js'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..')
const SRC = path.join(ROOT, 'public', ENEMY_ART_SRC_DIR, BOSS_ART_SRC_DIR)
const OUT = path.join(ROOT, 'public', BOSS_ART_DIR.slice(1))
const LIST = path.join(ROOT, 'src', 'v2cap', 'lib', 'bossArtList.js')
const FORCE = process.argv.includes('--force')
// 縮める倍率（列の数ごと）。q＝範囲をそろえる刻み（縮めたとき位置がちょうど整数になる）
//   【確定】2026-10-28 8コマ（4列）の絵も、ChatGPT は竜を6コマのときとほぼ同じ高さ（約450px・マスの横からはみ出しぎみ）で描いた
//   ＝どちらも半分にする（はじめ4列は3/4にしたら待機の枠が345pxと大きすぎた）
export const SCALE_OF = { 3: { k: 1 / 2, q: 2 }, 4: { k: 1 / 2, q: 2 } }
const PAD = 4              // 待機の枠のまわりの余白（元の絵のpx）
const QUALITY = 90         // 劣化ありで書き出す。ChatGPT のドット絵は色がざらついていて、劣化なしだと1枚250〜320KBと重い（劣化ありは約3分の1・2026-10-28 見比べて差が見えなかった）
const TICK = 10            // 動くWebPの刻み（ミリ秒）。長いコマは同じ絵を続けて渡す（libwebp が1コマにまとめて長さを足す）
const SAME_SIZE = 0.03     // 技の絵の竜の高さが待機とこれ以内の違いなら縮めない（ドット絵をぼかさない）

// 列の数：段ごとの大きいまとまり（その段でいちばん大きいものの3割以上）の数の多いほう。3か4でなければ null
//   （2026-10-28 黒翼烈風の上の段は②と③の翼の先がつながって3つに見えた＝つながると少なく数えるので、多い段を使う）
export const colsOf = (img, comps) => {
  const counts = Array.from({ length: BOSS_SHEET_ROWS }, (_, r) => {
    const row = comps.filter(c => Math.floor((c.y0 + c.y1) / 2 / (img.H / BOSS_SHEET_ROWS)) === r)
    const max = Math.max(0, ...row.map(c => c.n))
    return row.filter(c => c.n >= max * 0.3).length
  }).filter(n => BOSS_SHEET_COLS.includes(n))
  return counts.length ? Math.max(...counts) : null
}

// 隣のコマの竜どうしがくっついた1つのまとまり（マスの幅の SPLIT_W 倍より広い）は、真ん中に近いマスの境目のまわり
//   （マスの幅の4分の1まで）で、いちばん細い列から右を別のまとまりにする。1つの竜がはみ出したぶん（炎など）は切らない
const SPLIT_W = 1.25
const splitWide = (W, H, labels, comps, cw) => {
  for (let id = 0; id < comps.length; id++) {
    const c = comps[id]
    if (c.x1 - c.x0 + 1 <= cw * SPLIT_W) continue
    const cnt = new Int32Array(c.x1 - c.x0 + 1)
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (labels[y * W + x] === id) cnt[x - c.x0]++
    const bx = Math.round((c.x0 + c.x1) / 2 / cw) * cw
    let cut = -1
    for (let x = Math.max(c.x0 + 1, Math.round(bx - cw / 4)); x <= Math.min(c.x1, Math.round(bx + cw / 4)); x++) if (cut < 0 || cnt[x - c.x0] < cnt[cut - c.x0]) cut = x
    if (cut < 0) continue
    const nid = comps.length, L = { n: 0, x0: W, x1: -1, y0: H, y1: -1 }, R = { n: 0, x0: W, x1: -1, y0: H, y1: -1 }
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      const p = y * W + x
      if (labels[p] !== id) continue
      const t = x >= cut ? R : L
      if (x >= cut) labels[p] = nid
      t.n++; t.x0 = Math.min(t.x0, x); t.x1 = Math.max(t.x1, x); t.y0 = Math.min(t.y0, y); t.y1 = Math.max(t.y1, y)
    }
    comps[id] = L
    comps.push(R)
    id--   // 左のぶんがまだ広ければ、もう一度切る
  }
}

// ② マスごとのコマ → { labels, comps, cw, ch, cells:[{ ox, oy（読む位置）, ids（まとまり）, box（マスの左上からの範囲） }] }（左上から右へ、下の段へ）
export const cellsOf = (img, cols = BOSS_SHEET_COLS[0], rows = BOSS_SHEET_ROWS, cc = componentsOf(img)) => {
  const { labels, comps } = cc
  const cw = img.W / cols, ch = img.H / rows
  splitWide(img.W, img.H, labels, comps, cw)
  const cells = Array.from({ length: cols * rows }, (_, k) => ({ k, ox: Math.round((k % cols) * cw), oy: Math.round(Math.floor(k / cols) * ch), ids: new Set(), box: null }))
  comps.forEach((c, id) => {
    const col = Math.min(cols - 1, Math.floor((c.x0 + c.x1) / 2 / cw)), row = Math.min(rows - 1, Math.floor((c.y0 + c.y1) / 2 / ch))
    const cell = cells[row * cols + col]
    cell.ids.add(id)
    const b = { x0: c.x0 - cell.ox, y0: c.y0 - cell.oy, x1: c.x1 - cell.ox, y1: c.y1 - cell.oy }
    cell.box = cell.box ? union(cell.box, b) : b
  })
  return { labels, comps, cells, cw, ch }
}

const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })
// 範囲を q の倍数にそろえる（縮めたとき、待機の枠の位置がちょうど整数になる）
const snap = (b, q) => {
  const x0 = Math.floor(b.x0 / q) * q, y0 = Math.floor(b.y0 / q) * q
  const x1 = x0 + Math.ceil((b.x1 - x0 + 1) / q) * q - 1, y1 = y0 + Math.ceil((b.y1 - y0 + 1) / q) * q - 1
  return { x0, y0, x1, y1 }
}
const shiftCell = (c, dx, dy) => {
  c.ox += dx; c.oy += dy
  if (c.box) c.box = { x0: c.box.x0 - dx, y0: c.box.y0 - dy, x1: c.box.x1 - dx, y1: c.box.y1 - dy }
}
// コマのいちばん大きいまとまり（竜の体）の範囲（マスの左上から）
const bodyBoxOf = (sh, cell) => {
  let best = null
  for (const id of cell.ids) if (!best || sh.comps[id].n > best.n) best = sh.comps[id]
  return best && { x0: best.x0 - cell.ox, y0: best.y0 - cell.oy, x1: best.x1 - cell.ox, y1: best.y1 - cell.oy }
}

// 1コマを、マスの左上からの範囲 box で切り出して k 倍に縮める（そのコマのまとまりだけ）
const frameOf = (sh, cell, box, k) => {
  const { img, labels } = sh
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1
  const data = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = cell.ox + box.x0 + x, Y = cell.oy + box.y0 + y
    if (X < 0 || Y < 0 || X >= img.W || Y >= img.H) continue
    const p = Y * img.W + X
    if (labels[p] < 0 || !cell.ids.has(labels[p])) continue
    img.data.copy(data, (y * w + x) * 4, p * 4, p * 4 + 4)
  }
  const f = { W: w, H: h, data }
  bleed(f)
  return scaleRgba(f, k)
}

// いちばん左（相手の方）の先 → { x, y }（コマの左上から）。小さな火の粉は数えない（どれかのコマで縦に MIN_COL px 以上ある列から）。
//   y はその列から右へ5列の見えている画素の高さの平均。飛ぶエフェクトの先と、当たるコマの竜のいちばん前（飛ぶ絵が出るところ）に使う
const MIN_COL = 4
export const tipOf = (fs) => {
  const { W, H } = fs[0]
  const colN = (f, x) => { let n = 0; for (let y = 0; y < H; y++) if (f.data[(y * W + x) * 4 + 3]) n++; return n }
  let x0 = 0
  while (x0 < W - 1 && !fs.some(f => colN(f, x0) >= MIN_COL)) x0++
  let sy = 0, n = 0
  for (const f of fs) for (let x = x0; x < Math.min(W, x0 + 5); x++) for (let y = 0; y < H; y++) if (f.data[(y * W + x) * 4 + 3]) { sy += y; n++ }
  return { x: x0, y: n ? Math.round(sy / n) : Math.round(H / 2) }
}

// noGreen … 緑を使わないボス（黒龍）。真緑の背景が映り込んで緑がかった煙・風（黒翼烈風・終焉の黒焔）を、緑の無い色にする
//   【確定】2026-10-28 終焉の黒焔⑤の煙を測った：緑がかった色は色相55〜106°・明るさ70〜140（炎の黄色は明るさ200より上）
//   ＝色相52〜170°で暗いものは灰色（少し暖かい）に、明るいものは黄色に寄せる
export const dropGreen = (img) => {
  const d = img.data
  for (let p = 0; p < img.W * img.H; p++) {
    const i = p * 4
    if (!d[i + 3]) continue
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (mx - mn < 8) continue
    let h = mx === r ? 60 * (((g - b) / (mx - mn)) % 6) : mx === g ? 60 * ((b - r) / (mx - mn) + 2) : 60 * ((r - g) / (mx - mn) + 4)
    if (h < 0) h += 360
    if (h >= 52 && h <= 170) {
      if (mx < 170) { const L = 0.3 * r + 0.59 * g + 0.11 * b; d[i] = Math.round(L); d[i + 1] = Math.round(L * 0.94); d[i + 2] = Math.round(L * 0.88) }
      else d[i + 1] = Math.min(g, r)
    } else d[i + 1] = Math.min(g, Math.max(r, b))
  }
  return img
}

// ②'・②'' 2つのコマの形（見えているか・半分の細かさ）を比べて、b のコマを a のコマに重ねるずれ（元の絵px）を探す
//   anchor＝a のマスの中の割合で、比べる場所（竜なら脚と尾）。start＝探しはじめのずれ（体の外枠で先に合わせたもの）
const ALIGN_RANGE = 40
export const shiftToMatch = (A, a, B, b, anchor, start = { dx: 0, dy: 0 }) => {
  const K2 = 2, S = Math.ceil(Math.max(A.cw, B.cw) / K2), SH = Math.ceil(Math.max(A.ch, B.ch) / K2)
  const maskOf = (sh, c, ox, oy) => {
    const m = new Uint8Array(S * SH)
    for (let y = 0; y < SH; y++) for (let x = 0; x < S; x++) {
      const X = c.ox + ox + x * K2, Y = c.oy + oy + y * K2
      if (X < 0 || Y < 0 || X >= sh.img.W || Y >= sh.img.H) continue
      const l = sh.labels[Y * sh.img.W + X]
      if (l >= 0 && c.ids.has(l)) m[y * S + x] = 1
    }
    return m
  }
  const ma = maskOf(A, a, 0, 0), mb = maskOf(B, b, start.dx, start.dy)
  const aw = A.cw / K2, ah = A.ch / K2
  const R = { x0: Math.round(aw * anchor.x0), x1: Math.round(aw * anchor.x1) - 1, y0: Math.round(ah * anchor.y0), y1: Math.round(ah * anchor.y1) - 1 }
  const diff = (dx, dy) => {
    let d = 0
    for (let y = R.y0; y <= R.y1; y++) for (let x = R.x0; x <= R.x1; x++) {
      const xx = x + dx, yy = y + dy
      d += ma[y * S + x] ^ (xx >= 0 && yy >= 0 && xx < S && yy < SH ? mb[yy * S + xx] : 0)
    }
    return d
  }
  const r = ALIGN_RANGE / K2
  let best = { d: Infinity, dx: 0, dy: 0 }
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const d = diff(dx, dy); if (d < best.d) best = { d, dx, dy } }
  return { dx: start.dx + best.dx * K2, dy: start.dy + best.dy * K2 }
}
// 待機：2コマ目からを①にそろえる
export const alignCells = (sh, anchor) => sh.cells.map((c, k) => {
  if (k === 0) return { dx: 0, dy: 0 }
  const t = shiftToMatch(sh, sh.cells[0], sh, c, anchor)
  shiftCell(c, t.dx, t.dy)
  return t
})

// 元の絵を読む（緑を抜く・列を数える・マスに分ける）。scale を渡すとその倍率に縮めてから分ける
const loadSheet = (file, def, scale = 1, cols0 = null) => {
  let img = keyGreen(readRgba(file))
  if (def.noGreen) dropGreen(img)
  if (scale !== 1) { bleed(img); img = scaleRgba(img, scale) }
  const cc = componentsOf(img)
  const cols = cols0 || colsOf(img, cc.comps)
  if (!cols) throw new Error(`${path.basename(file)}：コマが3列か4列の2段になっていない（上の段の竜の数が数えられない）`)
  return { img, cols, ...cellsOf(img, cols, BOSS_SHEET_ROWS, cc) }
}

// 動くWebP：コマごとの長さ（ミリ秒）。同じ絵を TICK ごとに続けて渡す
const writeAnim = (frames, ms, out) => {
  const { W, H } = frames[0]
  const input = Buffer.concat(frames.flatMap((f, i) => Array.from({ length: Math.max(1, Math.round(ms[i] / TICK)) }, () => f.data)))
  return writeWebp(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', String(1000 / TICK), '-i', '-',
    '-c:v', 'libwebp_anim', '-loop', '0'], out, input)
}
// 同じ大きさのコマを横に並べた1枚
const writeStrip = (fs, out) => {
  const w = fs[0].W, h = fs[0].H, u = fs.length
  const strip = Buffer.alloc(w * u * h * 4)
  fs.forEach((f, i) => { for (let y = 0; y < h; y++) f.data.copy(strip, (y * w * u + i * w) * 4, y * w * 4, (y + 1) * w * 4) })
  return writeWebp(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w * u}x${h}`, '-i', '-', '-c:v', 'libwebp'], out, strip)
}
const writeWebp = (args, out, input) => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-pix_fmt', 'yuva420p', '-quality', String(QUALITY), '-compression_level', '6', out], { input, maxBuffer: 1 << 28 })
  return statSync(out).size
}

const build = (key, def, dir) => {
  const need = (name) => {
    const f = path.join(dir, `${name}.png`)
    if (!existsSync(f)) throw new Error(`元の絵が無い：${path.relative(ROOT, f)}`)
    return f
  }
  mkdirSync(OUT, { recursive: true })
  const sizes = [], notes = []
  // 待機
  const idle = loadSheet(need('待機'), def)
  const n = idle.cells.length
  if (idle.cells.some(c => !c.box)) throw new Error(`待機の${n}コマのどれかが空`)
  const shifts = def.idleAnchor ? alignCells(idle, def.idleAnchor) : []
  const { k, q } = SCALE_OF[idle.cols]
  const ib = idle.cells.reduce((b, c) => union(b, c.box), idle.cells[0].box)
  const side = Math.max(ib.x1 - ib.x0, ib.y1 - ib.y0) + 1 + PAD * 2
  const cx = (ib.x0 + ib.x1 + 1) / 2
  const base = snap({ x0: Math.round(cx - side / 2), y0: ib.y1 + PAD + 1 - side, x1: Math.round(cx - side / 2) + side - 1, y1: ib.y1 + PAD }, q)
  const frames = idle.cells.map(c => frameOf(idle, c, base, k))
  const idleMs = def.idleMs?.[n] || Array(n).fill(150)
  sizes.push(['idle', writeAnim(frames, idleMs, path.join(OUT, bossFileOf(key, 'idle')))])
  notes.push(`待機 ${n}コマ${shifts.length ? `（そろえたずれ ${shifts.map(t => `${t.dx},${t.dy}`).join(' ')}）` : ''}`)
  const entry = { base: frames[0].W, idle: { frames: n, ms: idleMs }, illust: false, motions: {} }
  const idleBody = bodyBoxOf(idle, idle.cells[0])
  // 技
  for (const m of def.motions) {
    const file = need(m.file)
    // ②'' ①の竜の高さを待機の①に合わせて縮め、待機の①に重ねる
    let sh = loadSheet(file, def)
    const b0 = bodyBoxOf(sh, sh.cells[0])
    let s = (idleBody.y1 - idleBody.y0 + 1) / (b0.y1 - b0.y0 + 1)
    if (Math.abs(s - 1) <= SAME_SIZE) s = 1
    else sh = loadSheet(file, def, s, sh.cols)
    const b1 = bodyBoxOf(sh, sh.cells[0])
    const t = shiftToMatch(idle, idle.cells[0], sh, sh.cells[0], def.idleAnchor || { x0: 0, x1: 1, y0: 0, y1: 1 },
      { dx: Math.round(b1.x0 - idleBody.x0), dy: Math.round(b1.y1 - idleBody.y1) })
    for (const c of sh.cells) shiftCell(c, t.dx, t.dy)
    const used = sh.cells.slice(1, -1)
    if (used.some(c => !c.box)) throw new Error(`${m.file}：コマのどれかが空`)
    const box = snap(used.reduce((b, c) => union(b, c.box), base), q)
    const fs = used.map(c => frameOf(sh, c, box, k))
    const w = fs[0].W, h = fs[0].H, u = fs.length
    sizes.push([m.key, writeStrip(fs, path.join(OUT, bossFileOf(key, m.key)))])
    notes.push(`${m.file} ${sh.cells.length}コマ（倍率${s.toFixed(2)}・ずれ ${t.dx},${t.dy}）`)
    const ox = (base.x0 - box.x0) * k, oy = (base.y0 - box.y0) * k, hit = BOSS_HIT_OF[u] ?? Math.floor(u / 2)
    const tip = tipOf([fs[hit]])
    entry.motions[m.key] = { frames: u, w, h, ox, oy, ms: m.ms[u] || Array(u).fill(150), hit, front: [tip.x - ox, tip.y - oy] }
  }
  // エフェクト（あるものだけ）。竜と同じ細かさに縮めてから size 倍。コマの位置はマスの中の位置のまま（ChatGPT はどのマスも同じところに描く）
  //   飛ぶ＝先（いちばん左）・当たる＝真ん中を、画面で相手の真ん中に合わせる
  entry.fx = {}
  for (const e of def.effects || []) {
    const file = path.join(dir, `${e.file}.png`)
    if (!existsSync(file)) { notes.push(`${e.file}：まだ無い`); continue }
    const sh = loadSheet(file, def, 1, BOSS_FX_COLS)
    if (sh.cells.some(c => !c.box)) throw new Error(`${e.file}：コマのどれかが空`)
    const box = snap(sh.cells.reduce((b, c) => union(b, c.box), sh.cells[0].box), q)
    const fs = sh.cells.map(c => frameOf(sh, c, box, k * (e.size || 1)))
    const w = fs[0].W, h = fs[0].H
    const a = e.kind === 'fly' ? tipOf(fs) : { x: Math.round(w / 2), y: Math.round(h / 2) }
    sizes.push([e.file, writeStrip(fs, path.join(OUT, bossFileOf(key, bossFxKindOf(e.motion, e.kind))))])
    entry.fx[e.motion] = { ...entry.fx[e.motion], [e.kind]: { frames: fs.length, w, h, ax: a.x, ay: a.y } }
  }
  // 遭遇のイラスト（透明な背景のまま・体がちょうど収まる正方形）
  const illustFile = path.join(dir, 'イラスト.png')
  if (existsSync(illustFile)) {
    const img = decode(illustFile, 1600, 'rgba')
    bleed(img)
    const box = alphaBox(img)
    if (box) {
      const out = path.join(OUT, bossFileOf(key, 'illust'))
      encodeSquare(img, box, out, { size: BOSS_ILLUST_SIZE, margin: 0.02, quality: 84 })
      entry.illust = true
      sizes.push(['illust', statSync(out).size])
    }
  }
  return { entry, sizes, notes }
}

const writeList = (art) => {
  const lines = ['// tools/v2cap-boss-art.mjs が書くファイル（手で直さない）。ボス → 待機の枠・待機・技ごとのコマ',
    '//   base … 待機の枠の大きさ（正方形・px）／idle … 待機のコマの数と1コマずつの長さ（ミリ秒）／illust … 遭遇のイラストがあるか',
    '//   motions … 技のキー → コマの数・1コマの大きさ（w・h）・待機の枠の左上が1コマの中のどこにあるか（ox・oy）・1コマの長さ・当たるコマ（0から）',
    '//             front … 当たるコマの竜のいちばん前（待機の枠の左上から・飛ぶエフェクトが出るところ）',
    '//   fx … 技のキー → fly（飛ぶ）・hit（当たる）のエフェクト：コマの数・1コマの大きさ（待機の枠と同じpx）・合わせる点（ax・ay＝飛ぶは先・当たるは真ん中）',
    '//   v … 絵ごとの中身の印（画面のアドレスの ?v=・描き直したら変わる＝古い絵がキャッシュから出ない）',
    'export const BOSS_ART = {']
  for (const [key, e] of Object.entries(art)) {
    const kinds = ['idle', ...Object.keys(e.motions), ...Object.entries(e.fx || {}).flatMap(([mk, f]) => Object.keys(f).map(kind => bossFxKindOf(mk, kind))),
      ...(e.illust ? ['illust'] : [])]
    const v = kinds.map(k => [k, path.join(OUT, bossFileOf(key, k))]).filter(([, f]) => existsSync(f)).map(([k, f]) => `'${k}': '${versionOf(f)}'`)
    lines.push(`  ${key}: {`, `    base: ${e.base}, illust: ${e.illust},`, `    idle: { frames: ${e.idle.frames}, ms: [${[].concat(e.idle.ms).join(', ')}] },`, '    motions: {')
    for (const [mk, m] of Object.entries(e.motions)) {
      lines.push(`      ${mk}: { frames: ${m.frames}, w: ${m.w}, h: ${m.h}, ox: ${m.ox}, oy: ${m.oy}, ms: [${m.ms.join(', ')}], hit: ${m.hit}${m.front ? `, front: [${m.front.join(', ')}]` : ''} },`)
    }
    lines.push('    },', '    fx: {')
    for (const [mk, f] of Object.entries(e.fx || {})) {
      lines.push(`      ${mk}: { ${Object.entries(f).map(([kind, a]) => `${kind}: { frames: ${a.frames}, w: ${a.w}, h: ${a.h}, ax: ${a.ax}, ay: ${a.ay} }`).join(', ')} },`)
    }
    lines.push('    },', `    v: { ${v.join(', ')} },`, '  },')
  }
  lines.push('}', '')
  writeFileSync(LIST, lines.join('\n'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const art = JSON.parse(JSON.stringify(BOSS_ART))
  let made = 0
  for (const [key, def] of Object.entries(BOSS_DEFS)) {
    const dir = path.join(SRC, def.dir)
    if (!existsSync(dir)) { console.log(`  - ${def.name}：元の絵のフォルダが無い（${path.relative(ROOT, dir)}）`); continue }
    // 見本_〜.png はプロンプトに添付する見本（道具は読まない）。エフェクトは名前だけ知っている（画面に入れるのは絵が届いてから）
    const known = new Set(['待機', 'イラスト', ...def.motions.map(m => m.file), ...(def.effects || []).map(e => e.file)])
    const isSample = (f) => f.startsWith('見本')
    // フォルダの中のフォルダ（イラスト版の絵）は読まない（2026-10-28 ユーザー「今のドット絵VERも試したいから、それぞれ分けて作れるようにして」）
    const files = readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name)
    for (const f of files) if (!isSample(f) && !known.has(path.basename(f, path.extname(f)))) console.log(`  ? ${def.name}：使わない絵（名前が決まりと違う）：${f}`)
    const srcs = files.filter(f => !isSample(f)).map(f => statSync(path.join(dir, f)).mtimeMs)
    const fxs = (def.effects || []).filter(e => files.includes(`${e.file}.png`)).map(e => bossFxKindOf(e.motion, e.kind))
    const outs = ['idle', ...def.motions.map(m => m.key), ...fxs].map(k => path.join(OUT, bossFileOf(key, k)))
    const fresh = !FORCE && art[key] && outs.every(o => existsSync(o) && statSync(o).mtimeMs >= Math.max(...srcs))
    if (fresh) continue
    try {
      const r = build(key, def, dir)
      art[key] = r.entry
      made++
      console.log(`  ✓ ${def.name}：待機の枠 ${r.entry.base}px・${r.sizes.map(([k, s]) => `${k} ${Math.round(s / 1024)}KB`).join('・')}`)
      for (const t of r.notes) console.log(`    ${t}`)
    } catch (e) {
      console.log(`  ✗ ${def.name}：${e.message}`)
      process.exitCode = 1
    }
  }
  writeList(art)
  console.log(`作った ${made} → src/v2cap/lib/bossArtList.js`)
}
