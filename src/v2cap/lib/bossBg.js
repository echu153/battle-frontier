import { BOSS_BG } from './bossBgList.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ダンジョンのボス戦の背景
// ------------------------------------------------------------
// 【確定】2026-10-30 ユーザー「こくりゅう、あまざのダンジョンの背景を作りたい、それぞれのモンスターにあった背景にしたい。グラブルのボスとかを参考」：
//   黒龍＝灼熱の洞窟・雨摩座＝雨の庭園。絵はユーザーが作る（tools/v2cap-boss-bg.mjs で WebP に）。プレイヤーが左・ボスが右の前提で描いてある
//   （光の見せ場は左から3〜5割・ボスの後ろは暗い）。舞台の絵の所にだけ敷く（HPの行は under の色のまま）。画面は V2capAtbStage.jsx の BossBackground。
//   動くもの（bgFxAt）はどれも元の絵の px で決める＝絵といっしょに縮む。時刻だけで決まる（止めて確かめられる）
//   crop＝絵の下のはしを、足元より下へ何割はみ出させるか（足元が床のまん中あたりに来る・下の縁取りの岩が足にかからない）
//   dark＝絵ぜんたいを暗くする濃さ（キャラが浮く）
//   【確定】2026-10-30 ユーザー「黒龍の溶岩ちゃんと動かしてほしい」：絵の形はそのまま、溶岩の色を流す（flow＝流れ図・画面は BossFlowCanvas.jsx・図は tools/v2cap-boss-bg.mjs が絵から作る）。
//     periodMs＝ムラの1周の時間・dist＝向き1のときの1周の進み（絵の高さの割合）・wobble＝絵をゆらす大きさ（元の絵の px）
//     regions＝どこがどの向きに流れるか（元の絵の px・上から順に見て最初に当たった所）。rect＝[x0, y0, x1, y1]・dir＝向きと速さ（1で dist）・
//     radial＝そこから外へ向かう・flat＝横にだけ・pick＝動かす色の選び方（flowPickOf）・gain＝動かす強さ
//     mask＝画面で動かす画素を色から選ぶ重み（R・G・B）・gain（flow の）＝ムラで色をどれだけ動かすか（R・G・B）・hot＝いちばん明るい筋に足す色
//   【確定】2026-10-30 ユーザー「あまざの背景はもう少しファンタジー感を出してほしい」→ 2026-10-31 ユーザーが「空に浮かぶ庭」の絵を描いた（背景2.png＝source。前の背景.png は置いたまま）。
//     動くもの：滝の水（flow）・床の映りこみのゆらぎ（flow）・灯籠の揺れと水の玉の光（glows・絵の場所に合わせてある）・水の精の光の粒（motes）・足元の水の紋（ring）・波紋・雨・雲。
//     ★雨摩座自身の絵はこれで完成（ユーザー）＝見た目を変えるなら背景で
//   【確定】2026-10-31 ユーザー「ヴァルゼノクが背景と同じ色だから少しわかりずらいかも」：黒と赤の竜が赤黒い洞窟に溶けこむ。behind＝ボスの後ろの色を抜いて（sat）薄い灰色の煙をかける
//     （haze・hazeColor＝暗い体より少し明るくして形を浮かせる。cy・rx・ry＝場所と大きさ・ボスの絵の枠の割合）。rim＝体の縁の光（CSS の filter）。溶岩のある左から当たる光にして、切り抜きの絵に見えないように。
//     火の粉は色を抜く所より上に描く。雨摩座には要らない（白い着物が暗い奥から浮く）
// ============================================================
export const BOSS_BG_DIR = '/v2cap-art/boss'   // lib/bossArt.js の BOSS_ART_DIR と同じ（テストあり）

export const BOSS_BG_DEFS = {
  // 灼熱の洞窟：火の粉が立ちのぼる・溶岩の滝が流れる・溶岩の明かりがゆっくり脈打つ
  varuzenoku: {
    under: '#100605', dark: 0.08, crop: 0.14,
    behind: { sat: 0.7, haze: 0.16, hazeColor: '125,112,108', cy: 0.55, rx: 0.72, ry: 0.72 },
    rim: 'drop-shadow(-1px 0 1px rgba(255,175,105,0.9)) drop-shadow(0 0 1px rgba(255,170,120,0.3))',
    flow: {
      periodMs: 2400, dist: 0.26, wobble: [7, 5], size: [384, 256], mask: [1, 0, 0], gain: [0.1, 0.62, 1], hot: [0.35, 0.28, 0.12],
      regions: [
        { rect: [500, 232, 660, 700], dir: [0, 1], pick: 'hot' },        // いちばん太い滝
        { rect: [432, 176, 540, 245], dir: [0.6, 0.5], pick: 'hot' },    // そこへ左上から流れこむ所
        { rect: [455, 225, 505, 470], dir: [0, 0.75], pick: 'hot' },     // その左の細い筋
        { rect: [200, 150, 300, 645], dir: [0, 0.7], pick: 'hot' },      // 左の滝
        { rect: [70, 280, 110, 520], dir: [0, 0.6], pick: 'hot' },       // 左端の滝
        { rect: [790, 290, 870, 625], dir: [0, 0.6], pick: 'hot' },      // まん中の細い滝
        { rect: [1265, 190, 1330, 560], dir: [0, 0.7], pick: 'hot' },    // 右の滝
        { rect: [1222, 580, 1270, 655], dir: [0, 0.7], pick: 'hot' },
        { rect: [1490, 340, 1536, 540], dir: [0, 0.6], pick: 'hot' },    // 右端の滝
        { rect: [0, 600, 1536, 682], dir: [0, -0.1], pick: 'hot', gain: 0.6 },    // 溶岩の湖の上の光る煙（ゆっくり昇る）
        { rect: [0, 680, 1536, 716], radial: [575, 698], speed: 0.35, flat: true, pick: 'hot' },   // 床の奥の溶岩の湖（滝の下から左右へ）
        { rect: [0, 716, 1536, 1024], radial: [575, 690], speed: 0.09, pick: 'crack' },            // 床のひび（ゆっくり広がって脈打つ）
      ],
    },
    fx: {
      embers: { n: 26, x: [0, 1536], y: [640, 960], rise: 560, life: [2600, 4600], r: [2.5, 6], color: '255,150,70' },
      spatter: { n: 18, x: [510, 650], y: 684, v: [240, 560], life: [520, 900], r: [2, 5], color: '255,190,90' },
      glows: [
        { x: 575, y: 620, r: 300, op: 0.26, amp: 0.16, periodMs: 4300, color: '255,110,40' },
        { x: 560, y: 380, r: 190, op: 0.14, amp: 0.1, periodMs: 3700, color: '255,130,50' },
        { x: 268, y: 460, r: 130, op: 0.12, amp: 0.1, periodMs: 5100, color: '255,110,40' },
        { x: 1305, y: 410, r: 130, op: 0.12, amp: 0.1, periodMs: 4700, color: '255,110,40' },
      ],
    },
  },
  // 空に浮かぶ庭：滝の水が流れる・床の映りこみがゆらぐ・波紋・細かい雨・雲が流れる・灯籠の灯りが揺れる・水の玉が光る（篠突く雨のあとの雨は別＝lib/bossIllust.js）
  amaza: {
    source: '背景2.png', under: '#060b14', dark: 0.06, crop: 0.24,
    flow: {
      periodMs: 1500, dist: 0.26, wobble: [5, 4], size: [384, 256], mask: [0.33, 0.33, 0.34], gain: [0.55, 0.45, 0.25], hot: [0.3, 0.33, 0.38],
      regions: [
        { rect: [84, 285, 134, 415], dir: [0, 1], pick: 'water' },     // 左の小島の滝
        { rect: [209, 488, 278, 632], dir: [0, 1], pick: 'water' },    // 橋の左の島の滝
        { rect: [426, 382, 492, 448], dir: [0, 1], pick: 'water' },    // 社の島の滝
        { rect: [509, 385, 554, 475], dir: [0, 1], pick: 'water' },
        { rect: [626, 395, 704, 515], dir: [0, 1], pick: 'water' },
        { rect: [731, 408, 776, 540], dir: [0, 1], pick: 'water' },
        { rect: [550, 497, 640, 660], dir: [0, 1], pick: 'water' },    // 橋の右の島のいちばん太い滝
        { rect: [0, 668, 1536, 1024], dir: [0, 0.12], pick: 'shine', gain: 0.55 },   // 床の映りこみ（ゆっくりゆらぐ）
      ],
    },
    fx: {
      motes: { n: 30, x: [0, 1536], y: [300, 900], rise: 260, life: [5000, 9000], r: [5, 11], color: '150,225,255' },
      ring: { rx: 330, ry: 66, periodMs: 26000, color: '130,215,255' },
      ripples: { n: 10, x: [60, 1480], y: [715, 960], lifeMs: 1500, r: [10, 78], color: '195,228,255' },
      drizzle: { n: 30, speed: 1700, len: [60, 120], slant: -0.1, op: [0.12, 0.3], color: '205,228,255' },
      mist: [
        { x: 420, y: 625, rx: 360, ry: 50, drift: 90, periodMs: 30000, op: 0.16, color: '170,195,235' },
        { x: 1050, y: 600, rx: 420, ry: 60, drift: 130, periodMs: 26000, op: 0.18, color: '160,190,225' },
        { x: 1320, y: 430, rx: 300, ry: 60, drift: 100, periodMs: 34000, op: 0.14, color: '160,190,225' },
      ],
      glows: [
        // 灯籠（絵の場所）
        { x: 135, y: 435, r: 84, op: 0.2, amp: 0.14, periodMs: 900, color: '255,170,90' },
        { x: 238, y: 458, r: 56, op: 0.18, amp: 0.12, periodMs: 1300, color: '255,170,90' },
        { x: 285, y: 435, r: 50, op: 0.18, amp: 0.12, periodMs: 1100, color: '255,170,90' },
        { x: 485, y: 435, r: 50, op: 0.18, amp: 0.12, periodMs: 800, color: '255,170,90' },
        { x: 545, y: 462, r: 54, op: 0.18, amp: 0.12, periodMs: 1200, color: '255,170,90' },
        { x: 378, y: 525, r: 54, op: 0.18, amp: 0.12, periodMs: 1000, color: '255,170,90' },
        { x: 645, y: 498, r: 50, op: 0.18, amp: 0.12, periodMs: 950, color: '255,170,90' },
        { x: 737, y: 505, r: 54, op: 0.18, amp: 0.12, periodMs: 1250, color: '255,170,90' },
        { x: 257, y: 315, r: 56, op: 0.18, amp: 0.12, periodMs: 1150, color: '255,170,90' },
        { x: 385, y: 378, r: 44, op: 0.16, amp: 0.1, periodMs: 1050, color: '255,170,90' },
        { x: 600, y: 370, r: 96, op: 0.12, amp: 0.06, periodMs: 2300, color: '255,170,90' },   // 社の窓
        // 水の玉（絵の場所）：ゆっくり光る
        { x: 65, y: 397, r: 62, op: 0.22, amp: 0.16, periodMs: 3100, color: '130,205,255' },
        { x: 180, y: 258, r: 86, op: 0.2, amp: 0.14, periodMs: 3700, color: '130,205,255' },
        { x: 302, y: 390, r: 44, op: 0.22, amp: 0.16, periodMs: 2900, color: '130,205,255' },
        { x: 630, y: 470, r: 54, op: 0.22, amp: 0.16, periodMs: 3400, color: '130,205,255' },
        { x: 707, y: 290, r: 50, op: 0.2, amp: 0.14, periodMs: 4100, color: '130,205,255' },
        { x: 712, y: 605, r: 50, op: 0.22, amp: 0.16, periodMs: 3000, color: '130,205,255' },
        { x: 762, y: 558, r: 34, op: 0.2, amp: 0.14, periodMs: 2600, color: '130,205,255' },
      ],
    },
  },
}

// 背景の決まり：{ src, w, h, under, dark, crop, fx }。絵が無いボスは null
export const bossBgOf = (key) => {
  const e = BOSS_BG[key], def = BOSS_BG_DEFS[key]
  if (!e || !def) return null
  return { ...def, w: e.w, h: e.h, src: `${BOSS_BG_DIR}/${key}-bg.webp?v=${e.v}`, flowSrc: e.flow ? `${BOSS_BG_DIR}/${key}-bg-flow.webp?v=${e.flow}` : null }
}

// 溶岩を流すムラ（BossFlowCanvas.jsx）。つなぎ目なく並ぶ GRAIN_SIZE 四方の RGBA（R・G＝別々のムラ）。種は固定＝いつも同じ・1回だけ作る
export const GRAIN_SIZE = 256
let grain = null
export const grainOf = () => {
  if (grain) return grain
  const N = GRAIN_SIZE, sm = (t) => t * t * (3 - 2 * t), out = new Uint8Array(N * N * 4)
  for (let ch = 0; ch < 2; ch++) {
    const sum = new Float32Array(N * N)
    let seed = 20261030 + ch
    for (const [cells, amp] of [[16, 1], [32, 0.55], [64, 0.3]]) {
      const lat = Array.from({ length: cells * cells }, () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
      const at = (ix, iy) => lat[(iy % cells) * cells + (ix % cells)]
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells, fy = (y / N) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0)
        sum[y * N + x] += amp * ((at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty)
      }
    }
    let lo = Infinity, hi = -Infinity
    for (const s of sum) { if (s < lo) lo = s; if (s > hi) hi = s }
    for (let i = 0; i < N * N; i++) out[i * 4 + ch] = Math.round((255 * (sum[i] - lo)) / (hi - lo))
  }
  for (let i = 0; i < N * N; i++) out[i * 4 + 3] = 255
  grain = out
  return grain
}

// 流れ図の1か所（元の絵の px）→ { dx, dy（向きと速さ・1で dist）, pick, gain } か null（動かさない所）。regions は上から順に見る。
//   gain は領域のふちで 0 へ（FLOW_FEATHER px・絵のはしは除く）＝隣の領域と向きが違っても、境目に四角いふちが見えない
const FLOW_FEATHER = 14
const featherOf = ([x0, y0, x1, y1], x, y) => {
  const near = Math.min(x0 <= 0 ? Infinity : x - x0, x1 >= 1536 ? Infinity : x1 - x, y0 <= 0 ? Infinity : y - y0, y1 >= 1024 ? Infinity : y1 - y)
  return Math.min(1, near / FLOW_FEATHER)
}
export const flowAt = (regions, x, y) => {
  for (const r of regions || []) {
    const [x0, y0, x1, y1] = r.rect
    if (x < x0 || x >= x1 || y < y0 || y >= y1) continue
    const gain = (r.gain ?? 1) * featherOf(r.rect, x, y)
    if (r.dir) return { dx: r.dir[0], dy: r.dir[1], pick: r.pick, gain }
    const vx = x - r.radial[0], vy = r.flat ? 0 : y - r.radial[1], len = Math.hypot(vx, vy) || 1
    return { dx: (vx / len) * r.speed, dy: (vy / len) * r.speed, pick: r.pick, gain }
  }
  return null
}
// 動かす色か（0〜1）：絵の色（r・g・b）から。hot＝明るい溶岩・crack＝床のひびの赤・water＝滝の白い水・shine＝床の映りこみ（暗い石は選ばない）
const cl01 = (k) => Math.max(0, Math.min(1, k))
export const flowPickOf = (pick, r, g, b) => {
  if (pick === 'crack') return cl01((r - 105) / 80) * cl01((r - g - 30) / 60)
  if (pick === 'water') return cl01((r - 135) / 60) * cl01((g - 150) / 50)
  if (pick === 'shine') return cl01((Math.max(r, g, b) - 105) / 70)
  return cl01((r - 150) / 70) * cl01((g - 45) / 70) * cl01((r - b - 60) / 60)
}

// ボスの後ろの色を抑える所（box＝ボスの絵の枠・舞台の px）→ { x, y, w, h }
export const behindRectOf = (behind, box) => {
  const cx = box.x + box.w / 2, cy = box.y + box.h * behind.cy, rx = box.w * behind.rx, ry = box.h * behind.ry
  return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }
}

// 絵の場所：幅 W・高さ H の枠（下のはし＝足元）に、絵を敷く → { x, y, w, h, k（絵の1pxが画面の何px）}（枠の左上から）
//   枠を埋める大きさで、絵の下から crop の高さが枠の下のはしに来る。横は真ん中（はみ出したぶんは左右で切れる）
export const bgRectOf = (bg, W, H) => {
  const k = Math.max(W / bg.w, H / ((1 - bg.crop) * bg.h))
  const w = bg.w * k, h = bg.h * k
  return { x: (W - w) / 2, y: H - h * (1 - bg.crop), w, h, k }
}

// 決まった乱れ（0〜1・同じ i と salt なら同じ値）
const hash01 = (i, salt) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x) }
const lerp = ([a, b], t) => a + (b - a) * t
// 背景の動くもの（いまの時刻 tMs）→ { glows, mist, flows, embers, spatter, motes, ripples, drizzle }（どれも元の絵の px）
export const bgFxAt = (fx, tMs) => {
  const out = { glows: [], mist: [], flows: [], embers: [], spatter: [], motes: [], ripples: [], drizzle: [] }
  if (!fx) return out
  for (const g of fx.glows || []) {
    // 2つの波を足す（同じ形のくり返しに見えない）
    const w = Math.sin((2 * Math.PI * tMs) / g.periodMs) * 0.65 + Math.sin((2 * Math.PI * tMs) / (g.periodMs * 0.37) + g.x) * 0.35
    out.glows.push({ x: g.x, y: g.y, r: g.r, op: Math.max(0, g.op + g.amp * w), color: g.color })
  }
  for (const m of fx.mist || []) {
    const p = (2 * Math.PI * tMs) / m.periodMs
    out.mist.push({ x: m.x + m.drift * Math.sin(p), y: m.y + 8 * Math.sin(p * 1.7), rx: m.rx, ry: m.ry, op: m.op * (0.8 + 0.2 * Math.cos(p)), color: m.color })
  }
  ;(fx.flows || []).forEach((f, fi) => {
    for (let i = 0; i < f.n; i++) {
      const seed = fi * 50 + i, len = lerp(f.len, hash01(seed, 1)), span = f.h + len
      const q = ((tMs * f.speed) / 1000 / span + hash01(seed, 2)) % 1
      const y2 = f.y + q * span, y1 = y2 - len
      const a = Math.max(f.y, y1), b = Math.min(f.y + f.h, y2)
      if (b - a < 1) continue
      const x = f.x + f.w * hash01(seed, 3)
      out.flows.push({ x, y1: a, y2: b, width: lerp(f.width, hash01(seed, 4)), op: f.op * (0.5 + 0.5 * hash01(seed, 5)), color: f.color })
    }
  })
  if (fx.embers) {
    const e = fx.embers
    for (let i = 0; i < e.n; i++) {
      const life = lerp(e.life, hash01(i, 11)), t = ((tMs + hash01(i, 12) * life) % life) / life
      out.embers.push({ x: lerp(e.x, hash01(i, 13)) + Math.sin(t * 7 + i) * 18, y: lerp(e.y, hash01(i, 14)) - e.rise * (1 - (1 - t) ** 2) * (0.55 + 0.45 * hash01(i, 15)),
        r: lerp(e.r, hash01(i, 16)) * (1 - 0.5 * t), op: (t < 0.12 ? t / 0.12 : 1) * (1 - t), color: e.color })
    }
  }
  if (fx.spatter) {
    // 滝の下ではねる溶岩のしずく（上へ飛んで落ちる）
    const e = fx.spatter
    for (let i = 0; i < e.n; i++) {
      const life = lerp(e.life, hash01(i, 41)), cycle = (tMs + hash01(i, 42) * life) / life, round = Math.floor(cycle), t = cycle - round
      const seed = i + round * 13, sp = lerp(e.v, hash01(seed, 43)), ang = -Math.PI / 2 + (hash01(seed, 44) - 0.5) * 1.5, sec = (t * life) / 1000
      out.spatter.push({ x: lerp(e.x, hash01(seed, 45)) + Math.cos(ang) * sp * sec, y: e.y + Math.sin(ang) * sp * sec + 0.5 * 1500 * sec * sec,
        r: lerp(e.r, hash01(seed, 46)) * (1 - 0.4 * t), op: t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9, color: e.color })
    }
  }
  if (fx.motes) {
    // 水の精の光の粒：ふわふわ昇り、またたく
    const e = fx.motes
    for (let i = 0; i < e.n; i++) {
      const life = lerp(e.life, hash01(i, 51)), t = ((tMs + hash01(i, 52) * life) % life) / life
      out.motes.push({ x: lerp(e.x, hash01(i, 53)) + Math.sin(t * 9 + i) * 26, y: lerp(e.y, hash01(i, 54)) - e.rise * t,
        r: lerp(e.r, hash01(i, 55)), op: Math.sin(Math.PI * t) * (0.55 + 0.45 * Math.sin(tMs / 260 + i * 2.1)), color: e.color })
    }
  }
  if (fx.ripples) {
    const r = fx.ripples
    for (let i = 0; i < r.n; i++) {
      // 同じ所に出続けないよう、1回ごとに場所を変える（何回目かを種にする）
      const cycle = (tMs + hash01(i, 21) * r.lifeMs * 2) / (r.lifeMs * 2), round = Math.floor(cycle), t = (cycle - round) * 2
      if (t >= 1) continue
      const seed = i + round * 17, y = lerp(r.y, hash01(seed, 22))
      // 手前（下）ほど大きい
      const near = (y - r.y[0]) / (r.y[1] - r.y[0]), rx = lerp(r.r, 1 - (1 - t) ** 2) * (0.5 + 0.8 * near)
      out.ripples.push({ x: lerp(r.x, hash01(seed, 23)), y, rx, ry: rx * 0.26, op: 0.75 * (1 - t), color: r.color })
    }
  }
  if (fx.drizzle) {
    const d = fx.drizzle, H = 1024
    for (let i = 0; i < d.n; i++) {
      const len = lerp(d.len, hash01(i, 31)), span = H + len
      const y2 = (((tMs * d.speed) / 1000 / span + hash01(i, 32)) % 1) * span, x2 = 1536 * hash01(i, 33) + y2 * d.slant
      out.drizzle.push({ x1: x2 - len * d.slant, y1: y2 - len, x2, y2, op: lerp(d.op, hash01(i, 34)), color: d.color })
    }
  }
  return out
}
