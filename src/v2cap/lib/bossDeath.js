import { motionPoseAt } from './bossIllust.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ボスの倒れる動き（lib/bossIllust.js の BOSS_ILLUST_DEFS の death）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザーが選んだ「ボスの倒れる動き」（前は待機の動きのまま薄くなるだけ）。新しい絵は描かない＝節目のバフと技のポーズの絵を使う。
//   流れ：止まる（倒した瞬間の形で一瞬止まって白く光る）→ 断末魔（roar の絵・衝撃の輪）→ 倒れる（fall の絵へ・着いた瞬間に揺れと砂ぼこり）→
//     光が消える（ash）→ 消える（components/BossDissolve.jsx・ふちが光りながら少しずつ消えて、火の粉や水の粒が残る）
//   どれも「倒れてからの ms」だけで決まる（乱数は決まった種＝同じ時刻なら同じ絵・止めて確かめられる）。場所は立ち絵の px
//   画面（V2capAtbStage.jsx）は、ボスのHPが0になったあと、止めの一撃の数字が出る時刻から流す
// ============================================================
const clamp01 = (k) => Math.min(1, Math.max(0, k))
const smooth = (k) => { const c = clamp01(k); return c * c * (3 - 2 * c) }
const hash01 = (i, salt) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x) }
const ART_MS = 70        // 絵を切り替える長さ（lib/bossIllust.js の ART_FADE_MS と同じ）
const KEEP_MS = 140      // 止めた形のずれ（傾きなど）を断末魔の形へつなぐ長さ

// 倒れきって着く時刻
export const deathLandMs = (d) => d.fallAt + d.fallMs
// 体のまわりの決まった点（楕円の中）
const inBody = (b, i, salt) => {
  const a = hash01(i, salt) * Math.PI * 2, r = Math.sqrt(hash01(i, salt + 1))
  return [b.c[0] + b.rx * r * Math.cos(a), b.c[1] + b.ry * r * Math.sin(a)]
}
// 舞台の揺れ（list＝[始まる時刻, 大きさ px, 長さ]）。始まった瞬間がいちばん強い
const shakeAt = (list, t) => list.reduce(([x, y], [at, amp, dur]) => {
  const h = t - at
  if (h < 0 || h >= dur) return [x, y]
  const a = amp * (1 - h / dur) ** 1.5
  return [x + a * Math.sin(h / 23), y + a * 0.6 * Math.sin(h / 31 + 1.3)]
}, [0, 0])
// 舞台ぜんぶの光（list＝[始まる時刻, 濃さ, 長さ]）
const flashAt = (list, t) => list.reduce((m, [at, op, dur]) => {
  const h = t - at
  return h >= 0 && h < dur ? Math.max(m, op * (1 - h / dur) ** 2) : m
}, 0)

// 足元から噴き上がる粒（断末魔・burst）
const burstSparks = (b, t, from, thin) => {
  const out = []
  for (let i = 0; i < Math.ceil(b.n * thin); i++) {
    const T = (t - from - hash01(i, 1) * (b.spreadMs ?? 500)) / (900 + hash01(i, 2) * 700)
    if (T <= 0 || T >= 1) continue
    const x0 = b.x[0] + (b.x[1] - b.x[0]) * hash01(i, 3)
    out.push({ x: x0 + Math.sin(T * 6 + i) * 10, y: b.y - (b.rise || 380) * (1 - (1 - T) ** 2) * (0.55 + 0.45 * hash01(i, 4)),
      r: (2.5 + 3 * hash01(i, 5)) * (1 - 0.5 * T) * (b.size || 1), op: (T < 0.15 ? T / 0.15 : 1) * (1 - T) })
  }
  return out
}
// 消えていく体から立ちのぼる粒（火の粉・光の粒）：from〜to のあいだに体のあちこちから生まれる
const riseSparks = (e, b, t, from, to, thin) => {
  const out = []
  for (let i = 0; i < Math.ceil(e.n * thin); i++) {
    const born = from + (to - from) * hash01(i, 11), life = e.lifeMs * (0.7 + 0.6 * hash01(i, 12))
    const T = (t - born) / life
    if (T <= 0 || T >= 1) continue
    const [x0, y0] = inBody(b, i, 13)
    out.push({ x: x0 + Math.sin(T * 5 + i) * 14 + (e.drift || 0) * T, y: y0 - e.rise * (1 - (1 - T) ** 2) * (0.6 + 0.4 * hash01(i, 15)),
      r: (1.6 + 2.6 * hash01(i, 16)) * (1 - 0.45 * T) * (e.size || 1), op: (T < 0.12 ? T / 0.12 : 1) * (1 - T) })
  }
  return out
}
// 体から落ちる水の粒（drops）：地面（y）まで、だんだん速く
const dropSparks = (e, b, t, from, to, thin) => {
  const out = []
  for (let i = 0; i < Math.ceil(e.n * thin); i++) {
    const born = from + (to - from) * hash01(i, 21), life = e.lifeMs * (0.7 + 0.6 * hash01(i, 22))
    const T = (t - born) / life
    if (T <= 0 || T >= 1) continue
    const [x0, y0] = inBody(b, i, 23)
    out.push({ x: x0, y: y0 + (e.y - y0) * T * T, r: (1.4 + 2 * hash01(i, 26)) * (e.size || 1), op: Math.min(1, T / 0.1) * (T > 0.85 ? (1 - T) / 0.15 : 1) })
  }
  return out
}
// 地面に広がる輪（ripples・倒れた所の輪と水の波紋）：flat＝縦につぶす
const flatRings = (list, t) => list.flatMap(({ at, x, y, maxR, durMs, flat = 0.26, k = 1 }) => {
  const T = (t - at) / durMs
  return T > 0 && T < 1 ? [{ x, y, r: 16 + maxR * (1 - (1 - T) ** 2), op: k * (1 - T) ** 1.2, w: 9 * (1 - T) + 1.5, flat }] : []
})

// いまの形。d＝bossIllustOf の death・ms＝倒れてからのミリ秒・thin＝粒の数の割合（軽い表示）→
//   rig（止めた形の濃さ）・poses（[{ name: 'roar', op }]・立ち絵とポーズの絵の切り替えは illustShowAt と同じ＝新しい絵が前半で出きり、前の絵は後半で消える）・
//   burn（fall の絵・{ op, k（消えた割合）, ash（光が消えた割合） }）・keep・x・y・r・lean（deathPoseOf）・bright（体の明るさ）・freeOp・freeY（切り離したパーツ＝水の帯の濃さと落ちる量）・
//   behind（竜の後ろの色を抜く濃さ・lib/bossBg.js）・puffs（砂ぼこりと煙の楕円・c＝'dust'|'smoke'）・gone（もう体は見えない）・
//   scene（lib/bossIllust.js の buffSceneAt と同じ形＝舞台の暗さ・揺れ・光と、BuffSparks の輪と粒）
export const deathAt = (d, ms, thin = 1) => {
  const t = Math.max(0, ms), land = deathLandMs(d), burnEnd = d.burnAt + d.burnMs
  const toRoar = clamp01((t - d.stopMs) / ART_MS), toFall = clamp01((t - d.fallAt) / ART_MS)
  const rig = 1 - smooth(2 * toRoar - 1)
  const roarOp = smooth(2 * toRoar) * (1 - smooth(2 * toFall - 1))
  const k = motionPoseAt(d.keys, Math.min(t, d.keys.at(-1)[0] - 1))
  const h = t - land
  const bright = 1 + (t < d.stopMs + 60 ? 1.3 * (1 - t / (d.stopMs + 60)) ** 2 : 0) + (h >= 0 && h < 200 ? 0.35 * (1 - h / 200) ** 2 : 0)
  const dim = (d.dim || 0) * smooth(t / 260) * (1 - smooth((t - d.dimOutAt) / d.dimOutMs))
  const rings = []
  if (d.rings) for (let i = 0; i < d.rings.n; i++) {
    const T = (t - d.stopMs - 60 - i * d.rings.everyMs) / d.rings.durMs
    if (T > 0 && T < 1) rings.push({ x: d.rings.at[0], y: d.rings.at[1], r: 30 + d.rings.maxR * (1 - (1 - T) ** 2), op: (1 - T) ** 1.2, w: 14 * (1 - T) + 2 })
  }
  // 地面の輪：倒れた所（d.landRings）と、消えていくあいだの水の波紋（d.ripples）
  const flats = [...(d.landRings || []).map(r => ({ ...r, at: land + (r.at || 0) }))]
  if (d.ripples) for (let i = 0; i < Math.ceil(d.ripples.n * thin); i++) {
    flats.push({ at: d.ripples.from + (d.ripples.to - d.ripples.from) * hash01(i, 31), x: d.ripples.x[0] + (d.ripples.x[1] - d.ripples.x[0]) * hash01(i, 32),
      y: d.ripples.y + 8 * hash01(i, 33), maxR: d.ripples.maxR * (0.6 + 0.4 * hash01(i, 34)), durMs: d.ripples.durMs })
  }
  rings.push(...flatRings(flats, t))
  const sparks = [
    ...(d.burst ? burstSparks(d.burst, t, d.stopMs, thin) : []),
    ...(d.landBurst ? burstSparks(d.landBurst, t, land, thin) : []),
    ...(d.embers ? riseSparks(d.embers, d.body, t, d.burnAt - 100, burnEnd, thin) : []),
    ...(d.drops ? dropSparks(d.drops, d.body, t, d.fallAt + 200, burnEnd, thin) : []),
  ]
  const puffs = []
  // 倒れた所の砂ぼこり：左右へ広がる3つずつ（はじめの 12% で濃くなる）
  if (d.dust && h >= 0 && h < d.dust.ms) {
    const K = h / d.dust.ms, e = 1 - (1 - K) ** 2, op = Math.min(1, K / 0.12) * (1 - K) * (d.dust.op ?? 0.95), g = d.dust.scale || 1
    for (const [x, y] of d.dust.pts) for (const s of [-1, 0, 1]) puffs.push({ c: 'dust', cx: x + s * 48 * e * g, cy: y - (s ? 10 : 24) * e * g, rx: (26 + (s ? 44 : 34) * e) * g, ry: (11 + (s ? 15 : 20) * e) * g, op })
  }
  // 消えていくあいだの煙（もや）：体のあちこちから生まれて、広がりながら上へ
  if (d.smoke) for (let i = 0; i < Math.ceil(d.smoke.n * thin); i++) {
    const born = d.burnAt - 200 + (d.burnMs + 200) * hash01(i, 41), T = (t - born) / (d.smoke.lifeMs * (0.8 + 0.4 * hash01(i, 42)))
    if (T <= 0 || T >= 1) continue
    const [x0, y0] = inBody(d.body, i, 43), R = d.smoke.r * (0.7 + 0.6 * hash01(i, 45))
    puffs.push({ c: 'smoke', cx: x0 + (d.smoke.drift || 0) * T, cy: y0 - d.smoke.rise * T, rx: R * (0.6 + 0.8 * T), ry: R * (0.45 + 0.6 * T), op: (d.smoke.op ?? 0.6) * Math.min(1, T / 0.2) * (1 - T) })
  }
  const punch = d.punch && t >= d.stopMs ? 1 + d.punch * (t < d.stopMs + 160 ? smooth((t - d.stopMs) / 160) : 1 - smooth((t - d.stopMs - 160) / 700)) * (1 - smooth((t - d.fallAt) / 80)) : 1
  return {
    rig, poses: roarOp > 0.001 ? [{ name: 'roar', op: roarOp }] : [],
    burn: { op: smooth(2 * toFall), k: clamp01((t - d.burnAt) / d.burnMs), ash: smooth((t - d.ashAt) / d.ashMs) * (d.burn.ashMax ?? 1) },
    keep: 1 - smooth((t - d.stopMs) / KEEP_MS), x: k.x, y: k.y, r: k.r, lean: k.lean, bright,
    freeOp: d.freeOut ? 1 - smooth((t - d.freeOut.at) / d.freeOut.ms) : 1, freeY: d.freeOut ? (d.freeOut.y || 0) * clamp01((t - d.freeOut.at) / d.freeOut.ms) ** 2 : 0,
    behind: 1 - smooth((t - d.burnAt) / (d.burnMs * 0.7)), puffs, gone: t >= burnEnd,
    scene: { dim, dimColor: d.dimColor || null, shake: shakeAt(d.shakes || [], t), punch, rings, sparks, ringColor: d.rings?.color || d.ringColor || null, sparkColor: d.sparkColor || null,
      ringCore: d.rings?.core || null, sparkCore: d.sparkCore || null, bolts: [], boltColor: null, flash: flashAt(d.flashes || [], t), flashColor: d.flashColor || null, rain: null },
  }
}
// 止めた形（pose）に倒れる動きの全体のずれを足す（はじめは止めた形のずれをそのまま・断末魔の絵へ替わるあいだに消す）
export const deathPoseOf = (pose, s) => ({ ...pose, x: pose.x * s.keep + s.x, y: pose.y * s.keep + s.y, r: pose.r * s.keep + s.r, lean: pose.lean * s.keep + s.lean, dust: pose.dust * s.rig })
// 止めた形で出ていた絵（show・技のポーズの絵）の上に、倒れる動きの絵を重ねる（止めた形の絵は s.rig で消える）
export const deathShowOf = (show, s) => ({ rig: (show ? show.rig : 1) * s.rig, poses: [...(show?.poses || []).map(p => ({ ...p, op: p.op * s.rig })), ...s.poses] })
