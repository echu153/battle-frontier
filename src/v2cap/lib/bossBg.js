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
// ============================================================
export const BOSS_BG_DIR = '/v2cap-art/boss'   // lib/bossArt.js の BOSS_ART_DIR と同じ（テストあり）

export const BOSS_BG_DEFS = {
  // 灼熱の洞窟：火の粉が立ちのぼる・溶岩の滝が流れる・溶岩の明かりがゆっくり脈打つ
  varuzenoku: {
    under: '#100605', dark: 0.08, crop: 0.14,
    fx: {
      embers: { n: 26, x: [0, 1536], y: [640, 960], rise: 560, life: [2600, 4600], r: [2.5, 6], color: '255,150,70' },
      glows: [
        { x: 575, y: 620, r: 300, op: 0.26, amp: 0.16, periodMs: 4300, color: '255,110,40' },
        { x: 560, y: 380, r: 190, op: 0.14, amp: 0.1, periodMs: 3700, color: '255,130,50' },
        { x: 268, y: 460, r: 130, op: 0.12, amp: 0.1, periodMs: 5100, color: '255,110,40' },
        { x: 1305, y: 410, r: 130, op: 0.12, amp: 0.1, periodMs: 4700, color: '255,110,40' },
      ],
      flows: [
        { x: 520, w: 110, y: 240, h: 430, n: 16, speed: 520, len: [36, 90], width: [3, 7], op: 0.6, color: '255,226,150' },
        { x: 252, w: 34, y: 330, h: 250, n: 5, speed: 420, len: [24, 56], width: [2, 4], op: 0.5, color: '255,210,130' },
        { x: 1290, w: 30, y: 280, h: 250, n: 5, speed: 420, len: [24, 56], width: [2, 4], op: 0.5, color: '255,210,130' },
        { x: 815, w: 18, y: 390, h: 180, n: 3, speed: 380, len: [20, 44], width: [2, 3], op: 0.45, color: '255,200,120' },
      ],
    },
  },
  // 雨の庭園：水面に波紋・細かい雨・霧が流れる・灯籠の灯りが揺れる・遠くの滝が流れる（篠突く雨のあとの雨は別＝lib/bossIllust.js）
  amaza: {
    under: '#060b14', dark: 0.06, crop: 0.14,
    fx: {
      ripples: { n: 10, x: [60, 1480], y: [715, 960], lifeMs: 1500, r: [10, 78], color: '195,228,255' },
      drizzle: { n: 30, speed: 1700, len: [60, 120], slant: -0.1, op: [0.12, 0.3], color: '205,228,255' },
      mist: [
        { x: 960, y: 500, rx: 420, ry: 74, drift: 130, periodMs: 26000, op: 0.2, color: '160,190,225' },
        { x: 380, y: 300, rx: 340, ry: 60, drift: 100, periodMs: 34000, op: 0.14, color: '160,190,225' },
        { x: 1240, y: 340, rx: 330, ry: 66, drift: 110, periodMs: 30000, op: 0.16, color: '160,190,225' },
      ],
      glows: [
        { x: 105, y: 380, r: 92, op: 0.2, amp: 0.14, periodMs: 900, color: '255,170,90' },
        { x: 330, y: 505, r: 70, op: 0.2, amp: 0.14, periodMs: 1100, color: '255,170,90' },
        { x: 710, y: 478, r: 70, op: 0.2, amp: 0.14, periodMs: 1000, color: '255,170,90' },
        { x: 222, y: 436, r: 56, op: 0.18, amp: 0.12, periodMs: 1300, color: '255,170,90' },
        { x: 380, y: 380, r: 50, op: 0.18, amp: 0.12, periodMs: 800, color: '255,170,90' },
        { x: 566, y: 386, r: 50, op: 0.18, amp: 0.12, periodMs: 1200, color: '255,170,90' },
        { x: 647, y: 408, r: 50, op: 0.18, amp: 0.12, periodMs: 950, color: '255,170,90' },
      ],
      flows: [
        { x: 772, w: 46, y: 325, h: 90, n: 5, speed: 300, len: [16, 34], width: [1.5, 3], op: 0.4, color: '205,228,255' },
        { x: 1208, w: 26, y: 395, h: 90, n: 4, speed: 300, len: [16, 34], width: [1.5, 3], op: 0.32, color: '205,228,255' },
      ],
    },
  },
}

// 背景の決まり：{ src, w, h, under, dark, crop, fx }。絵が無いボスは null
export const bossBgOf = (key) => {
  const e = BOSS_BG[key], def = BOSS_BG_DEFS[key]
  if (!e || !def) return null
  return { ...def, w: e.w, h: e.h, src: `${BOSS_BG_DIR}/${key}-bg.webp?v=${e.v}` }
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
// 背景の動くもの（いまの時刻 tMs）→ { glows, mist, flows, embers, ripples, drizzle }（どれも元の絵の px）
export const bgFxAt = (fx, tMs) => {
  const out = { glows: [], mist: [], flows: [], embers: [], ripples: [], drizzle: [] }
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
