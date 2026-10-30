import { CAST_SEC } from '../core/atb.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ボスの技の派手な演出（lib/bossIllust.js の motions の scene）
// ------------------------------------------------------------
// 【確定】2026-10-29 ユーザー「もっとモーションを豪華にしたい、グラブルに近づけたい」「今同じ絵柄だから単調に見える」
//   「水天葬だったらほんとに滝が叩きつけてるようなエフェクトにしてほしい、派手に」：
//   描いてもらったエフェクトの絵（1枚）はそのまま使い、その上に動くもの（流れ落ちる水の筋・しぶき・波紋・もや・雲の渦の光・
//   掲げた手に集まる光）と、画面ぜんたいの動き（暗くなる・光る・揺れる）を足す（画面 V2capAtbStage.jsx の SceneLayer）。
//   どれも「技を出しはじめてからの ms」だけで決まる（乱数は決まった種＝同じ時刻なら同じ絵・止めて確かめられる）。
//   場所の単位は相手の絵の枠の幅（1＝枠の幅）・原点は相手の足元の真ん中（上が −）。揺れだけは画面の px、
//   手に集まる光（space: 'hand'）は掲げた手の指先からのずれ（立ち絵の px）
// 【確定】2026-10-30 ユーザー「滝流すモーションが止まってるから躍動感がない、しっかり水が流れるようにしてほしい」
//   「水縛りの帯もしょぼい、もっと豪華にして」：滝は水の絵そのものを流す（画面の PourFlow・流れる水の絵＝lib/bossIllust.js の flow）。
//   水縛の帯（kind 'coil'）＝相手の体に3重の水の輪が巻きついて3回締め上げ（しぶき・相手が縮む）、最後にはじけて解ける（泡が立ちのぼる）
// 【確定】2026-10-30 ユーザー「氷雨、水天葬、これもっと上から降らせて」「水縛の帯 紐いらない」：
//   水天葬の雲は相手の頭のすぐ上（FX_HEAD_Y）から空の上のほう（FX_SKY_Y）へ上げ、滝はその雲から足元まで流れる（SCENE_TOP）。
//   水縛の帯の水の綱（tether）と綱を伝う光はやめた（帯は飛ぶ絵だけで相手へ）
// 【確定】2026-10-30 ユーザー「イラスト差し替えたんだからエフェクト更新して」→選んだ「今の絵のまま合わせ直す」：
//   ポーズの絵（構え・振り抜き）に合わせて、構えの絵のあいだ絵の上の手（anchors の hand・hand2）に水の粒が渦を巻いて吸い込まれて手が光り、
//   振り抜きの絵に替わった瞬間に振り抜きの手で光がはじけ、水しぶきが相手の方へ扇形に飛び散る（handFxAt・4つの技すべて）。
//   雨礫・氷雨は演出の種類 'hands'（手の光と粒だけ・暗くも揺れもしない）。水天葬は両手（hand2）
// ============================================================

// 相手の頭上・足元に出すエフェクト（on）の場所（相手の絵の枠の上からの割合）：頭上＝枠の少し上（頭にかからない）・足元＝枠の下のはし
export const FX_HEAD_Y = -0.12
export const FX_FEET_Y = 0.97
// 空の上のほう（水天葬の雲・氷雨の雲のあたり）：相手の絵の枠の上からの割合。自分の絵は枠の 0.48 倍なので、頭の上には枠2つぶんほど空がある
export const FX_SKY_Y = -0.75
// 雲の高さ（足元から・枠の幅が1）＝滝が落ちはじめる所
export const SCENE_TOP = FX_SKY_Y - FX_FEET_Y

// 水天葬（kind 'pour'）：雲から滝が落ちて叩きつけ、pourMs のあいだ落ち続けて、tailMs で上から切れる
//   dim＝背景の暗さ（構えのあいだは castDim まで）・width＝水の筋が落ちる幅・spin＝雲の渦の回る速さ（rad/秒）
export const POUR = {
  dim: 0.62, castDim: 0.45, pourMs: 1000, tailMs: 380, width: 0.56,
  streaks: 30, splash: 90, jets: 14, burstEvery: 110, mist: 10, rain: 18, motes: 14, spin: 0.9,
  rings: [[0, 1], [150, 0.85], [330, 0.7], [560, 0.6], [800, 0.5]],   // [叩きつけてからの ms, 大きさ]
}
const G = 5.5   // しぶきの落ちる速さ（枠の幅/秒²）
// 水縛の帯（kind 'coil'）：叩きつけて（I）から squeezes の時刻に締め上げ、burstMs ではじける。輪は体の真ん中（BODY_Y）のまわりに3つ
export const COIL = { dim: 0.42, squeezes: [300, 600, 900], burstMs: 1100, rings: [-0.2, 0, 0.2], bubbles: 12 }
export const FX_TARGET_Y = 0.58
const BODY_Y = FX_TARGET_Y - FX_FEET_Y   // 体の真ん中（足元から）

const hash = (n) => {
  let t = (n * 0x9E3779B1 + 0x6D2B79F5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const rnd = (i, j) => hash(i * 131 + j * 7919 + 17)
const clamp01 = (k) => Math.min(1, Math.max(0, k))
const smooth = (k) => { const c = clamp01(k); return c * c * (3 - 2 * c) }
const easeOut = (k) => { const c = clamp01(k); return 1 - (1 - c) * (1 - c) }

// 時刻の区切り：H＝手を振り下ろす（撃つ）・I＝滝が叩きつける（ダメージ）・E＝落ち終わる（そこから tailMs で上から切れる）
export const pourTimesOf = (m, P = POUR) => {
  const H = m.hitMs, I = m.impactMs
  return { H, I, L: Math.max(1, I - H), E: I + P.pourMs, T: P.tailMs, end: I + P.pourMs + 2000 }
}
// 演出が終わる時刻（技を出しはじめてから ms）。画面はこの時刻まで技の印を覚えておく（戦闘の画面が古い印を片付けても切れない）
export const sceneEndMsOf = (m) => (m?.scene?.kind === 'pour' ? pourTimesOf(m).end : m?.scene?.kind === 'coil' ? m.impactMs + COIL.burstMs + 900
  : m?.scene?.kind === 'hands' ? (handFxOf(m)?.ts ?? 0) + 600 : 0)

// しぶき（n 粒・上へはね上がって落ちる）。e＝はねてからの ms・spread＝はねる所の広さ・oy＝はねる高さ（足元から）・around＝まわりじゅうへ
const drops = (items, n, seed, e, v, life, size, spread, { oy = 0, around = false } = {}) => {
  const t = e / 1000
  for (let i = 0; i < n; i++) {
    const li = life[0] + (life[1] - life[0]) * rnd(seed + i, 1)
    if (e < 0 || e >= li) continue
    const ang = around ? Math.PI * 2 * rnd(seed + i, 2) : Math.PI * (0.12 + 0.76 * rnd(seed + i, 2)), sp = v[0] + (v[1] - v[0]) * rnd(seed + i, 3)
    const vx = Math.cos(ang) * sp, vy = -Math.sin(ang) * sp * (around ? 1 : 1.5)
    const x = (rnd(seed + i, 4) - 0.5) * spread + vx * t, y = oy + vy * t + 0.5 * G * t * t
    if (y > 0.02) continue   // 地面より下は描かない
    const r = size[0] + (size[1] - size[0]) * rnd(seed + i, 5), k = e / li
    items.push({ t: 'drop', x, y, rx: r * 2.4, ry: r, rot: (Math.atan2(vy + G * t, vx) * 180) / Math.PI, op: k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4 })
  }
}
// 足元から吹き上がる水しぶきの柱（叩きつけた瞬間・落ちているあいだの小さなしぶき）：下が白く、上は透ける筋
const jets = (items, n, seed, e, size) => {
  const k = e / 380
  if (k < 0 || k >= 1) return
  for (let i = 0; i < n; i++) {
    const x = (rnd(seed + i, 11) - 0.5) * 0.55, h = (0.18 + 0.5 * rnd(seed + i, 12)) * size * easeOut(k / 0.7)
    items.push({ t: 'jet', x: x * (1 + 0.4 * k), y1: -h - 0.02, y2: -0.02 - h * 0.25 * k, w: 0.012 + 0.016 * rnd(seed + i, 13), op: 0.9 * (1 - k) })
  }
}
// 雲から降る小雨（構えと、振り下ろすまで）：斜めの細い線
const rain = (items, n, ms, op) => {
  if (op <= 0) return
  for (let i = 0; i < n; i++) {
    const per = 380 + 220 * rnd(i, 21), p = (ms / per + rnd(i, 22)) % 1
    const x = (rnd(i, 23) - 0.5) * 0.95 - 0.1 * p, y = SCENE_TOP * (1 - p)
    if (y > -0.02) continue
    items.push({ t: 'rain', x1: x + 0.025, y1: y - 0.13, x2: x, y2: y, w: 0.006, op: op * (0.45 + 0.4 * rnd(i, 24)) * Math.min(1, p / 0.15) })
  }
}
// 掲げた手に集まる光の粒（指先からのずれ・立ち絵の px）：外から渦を巻いて吸い込まれる。hands＝手の数（hi＝何番目の手に吸い込まれるか）
const motes = (items, n, ms, op, hands = 1) => {
  if (op <= 0) return
  for (let i = 0; i < n; i++) {
    const per = 620 + 260 * rnd(i, 31), p = (ms / per + rnd(i, 32)) % 1
    const d = (70 + 70 * rnd(i, 33)) * (1 - easeOut(p)), a = rnd(i, 34) * Math.PI * 2 + p * 2.4
    items.push({ t: 'mote', space: 'hand', hi: i % hands, x: Math.cos(a) * d, y: Math.sin(a) * d, r: 3 + 3 * rnd(i, 35), op: op * Math.sin(Math.PI * p) })
  }
}
// 構えと振り抜きの手（ポーズの絵）：技の art（構え・振り抜きの時刻）と anchors（絵の上の手・hand と hand2）から { tw, ts, nw（構えの手の数）, ns（振り抜きの手の数） }
const HAND_NAMES = ['hand', 'hand2']
export const handFxOf = (m) => {
  const art = m?.art, an = m?.anchors
  if (!art || !an) return null
  const tw = art.find(([, n]) => n === 'windup')?.[0], ts = art.find(([, n]) => n === 'strike')?.[0]
  if (tw == null || ts == null) return null
  const count = (p) => HAND_NAMES.filter(n => an[p]?.[n]).length
  return { tw, ts, nw: count('windup'), ns: count('strike') }
}
export const HAND_BURST_MS = 230
// 構えの絵のあいだ：手に水の粒が吸い込まれて手が光る（gather）／振り抜きの絵に替わった瞬間：手で光がはじけ、水しぶきが相手の方（左）へ扇形に飛ぶ
//   （hdrop＝手からのずれ・立ち絵の px）。out.hand＝手の光（画面はいま出ている絵の手ぜんぶに描く）
const handFxAt = (m, ms, out, { gather = true } = {}) => {
  const h = handFxOf(m)
  if (!h) return
  if (gather && h.nw && ms >= h.tw && ms < h.ts) {
    const k = smooth((ms - h.tw) / 150)
    motes(out.items, 8 * h.nw, ms, 0.85 * k, h.nw)
    out.hand = { r: 13 + 7 * smooth((ms - h.tw) / Math.max(1, h.ts - h.tw)) + 2 * Math.sin(ms / 90), op: k }
  }
  const e = ms - h.ts
  if (h.ns && e >= 0 && e < HAND_BURST_MS) {
    out.hand = { r: 22 + 52 * easeOut(e / 180), op: 1 - e / HAND_BURST_MS }   // 構えの光（水天葬は大きい）より大きくはじける
    for (let hi = 0; hi < h.ns; hi++) for (let i = 0; i < 12; i++) {
      const seed = 400 + hi * 40 + i, life = 170 + 90 * rnd(seed, 61)
      if (e >= life) continue
      const ang = Math.PI + (rnd(seed, 62) - 0.5) * 2.2, sp = 260 + 380 * rnd(seed, 63), t = e / 1000
      const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp, r = 2.5 + 3 * rnd(seed, 64)
      out.items.push({ t: 'hdrop', space: 'hand', hi, x: vx * t, y: vy * t + 300 * t * t, rx: r * 2.4, ry: r,
        rot: (Math.atan2(vy + 600 * t, vx) * 180) / Math.PI, op: 1 - e / life })
    }
  }
}
// 雲の稲光（ときどき一瞬明るく）
const flickerAt = (ms) => (hash(Math.floor(ms / 70) + 99) > 0.93 ? 1 : 0)

// 構え（5秒）のあいだ：背景がだんだん暗く・雲から小雨・雲の渦が回る・掲げた手に光が集まる
export const castSceneAt = (m, castMs, P = POUR) => {
  const out = { dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null }
  if (m?.scene?.kind !== 'pour' || castMs < 0) return out
  const k = smooth(castMs / 1200)
  out.dim = P.castDim * k
  rain(out.items, P.rain, castMs, 0.6 * smooth(castMs / 1500))
  motes(out.items, P.motes, castMs, 0.8 * k, handFxOf(m)?.nw || 1)
  out.cloud = { spin: (P.spin * castMs) / 1000, glow: (0.35 + 0.1 * Math.sin(castMs / 260)) * k, flicker: flickerAt(castMs) * k }
  out.hand = { r: 24 + 4 * Math.sin(castMs / 130), op: smooth(castMs / 600) }
  return out
}

// 技のあいだ（ms＝技を出しはじめてから・after＝構えのすぐあと・landed＝当たったか＝外れたら滝は落ちない（暗さ・雲・手の光だけ））
//   → { dim, flash（0〜1）, shake: [x, y]（px）, items, cloud: { spin, glow, flicker }, hand: { r, op } }
export const sceneAt = (m, ms, { after = false, landed = true } = {}, P = POUR) => {
  if (m?.scene?.kind === 'coil') return coilSceneAt(m, ms, landed)
  const out = { dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null }
  if (m?.scene?.kind === 'hands') { if (ms >= 0 && ms < sceneEndMsOf(m)) handFxAt(m, ms, out); return out }
  if (m?.scene?.kind !== 'pour') return out
  const { H, I, L, E, T, end } = pourTimesOf(m, P)
  if (ms < 0 || ms >= end) return out
  const e = ms - I
  // 暗さ：振り下ろすまでに暗くなり（構えのすぐあとは構えの暗さから）、落ち終わったら戻る
  const d0 = after ? P.castDim : 0
  out.dim = ms < H ? d0 + (P.dim - d0) * smooth(ms / H) : ms < E ? P.dim : P.dim * (1 - smooth((ms - E) / 600))
  // 光：振り下ろした瞬間に少し・叩きつけた瞬間に大きく
  const f1 = ms >= H && ms < H + 180 ? 0.3 * (1 - (ms - H) / 180) : 0
  const f2 = landed && e >= 0 && e < 380 ? 0.85 * (e < 40 ? e / 40 : Math.pow(1 - (e - 40) / 340, 1.5)) : 0
  out.flash = Math.max(f1, f2)
  // 揺れ：叩きつけた瞬間に大きく（だんだん小さく）・落ちているあいだは小さく揺れ続ける
  if (landed && e >= 0 && ms < E + 200) {
    const k = clamp01(e / 700), rumble = ms < E ? 1.8 : 1.8 * (1 - (ms - E) / 200)
    const amp = 11 * (1 - k) * (1 - k) + rumble
    out.shake = [amp * Math.sin(e * 0.11), amp * 0.65 * Math.cos(e * 0.153)]
  }
  // 小雨と手の光：振り下ろすまで（構えずに流したときは出はじめを薄く）
  if (ms < H) {
    const a = after ? 1 : smooth(ms / 600)
    rain(out.items, P.rain, ms, 0.6 * a)
    motes(out.items, P.motes, ms, 0.8 * a, handFxOf(m)?.nw || 1)
    out.hand = { r: 26 + 18 * smooth(ms / H) + 4 * Math.sin(ms / 110), op: after ? 1 : smooth(ms / 300) }
  }
  // 振り下ろした瞬間（振り抜きの絵に替わる時刻）に両手ではじける（ほかの技と同じ・構えの手の光と粒は上の水天葬の分）
  handFxAt(m, ms, out, { gather: false })
  // 雲：振り下ろすまで渦がだんだん速く回り、まん中が明るくなる。滝が落ちているあいだも回り続ける
  const t = Math.min(ms, H) / 1000, base = after ? (P.spin * CAST_SEC) : 0
  const spin = base + P.spin * (ms / 1000) + 1.6 * t * t + (ms > H ? 3.2 * t * ((ms - H) / 1000) : 0)
  const glow = ms < H ? 0.45 + 0.55 * smooth(ms / H) : ms < E ? 0.75 + 0.25 * Math.sin(ms / 60) : Math.max(0, 1 - (ms - E) / T)
  out.cloud = { spin, glow, flicker: ms < E ? flickerAt(ms) : 0 }
  // 流れ落ちる水の筋（雲から足元へ・いまの滝の先まで）。落ち終わると上から切れる
  if (landed && ms >= H && ms < E + T) {
    const cut = ms < E ? 0 : smooth((ms - E) / T)
    const y0 = SCENE_TOP * (1 - cut), y1 = ms < I ? SCENE_TOP * (1 - easeOut((ms - H) / L)) : 0
    const span = -SCENE_TOP + 0.6
    for (let i = 0; i < P.streaks; i++) {
      const len = 0.16 + 0.32 * rnd(i, 2), per = 170 + 140 * rnd(i, 3)
      const head = SCENE_TOP + (((ms - H) / per + rnd(i, 4)) % 1) * span
      const a = Math.max(y0, head - len), b = Math.min(y1, head)
      if (b - a < 0.01) continue
      const wide = 0.8 + 0.2 * (1 - (a + b) / 2 / SCENE_TOP)   // 下ほど少し広がる
      out.items.push({ t: 'streak', x: (rnd(i, 1) - 0.5) * P.width * wide, y1: a, y2: b, w: 0.006 + 0.014 * rnd(i, 6), op: 0.3 + 0.5 * rnd(i, 5) })
    }
    // 落ちてくる滝の先（叩きつけるまで）：白く泡立つ
    if (ms < I) for (const [dx, r, op] of [[0, 0.2, 0.85], [-0.13, 0.11, 0.6], [0.13, 0.11, 0.6]]) out.items.push({ t: 'glow', x: dx, y: y1, r, op })
  }
  // 叩きつけた所：大きなしぶき・落ち続けるあいだの小さなしぶき・波紋・もや
  if (landed && e >= 0) {
    drops(out.items, P.splash, 1000, e, [0.7, 2.0], [550, 950], [0.006, 0.018], 0.36)
    for (let j = 0, tb = I + 120; tb < E; j++, tb += P.burstEvery) {
      drops(out.items, 10, 5000 + j * 50, ms - tb, [0.5, 1.3], [400, 620], [0.005, 0.013], 0.42)
      jets(out.items, 4, 8000 + j * 30, ms - tb, 0.5)
    }
    jets(out.items, P.jets, 7000, e, 1)
    // 足元の白い泡立ち（落ちているあいだ・脈打つ）
    if (ms < E + T) {
      const k = ms < E ? Math.min(1, e / 80) : 1 - (ms - E) / T
      out.items.push({ t: 'foam', x: 0, y: -0.02, rx: 0.44 + 0.04 * Math.sin(ms / 45), ry: 0.1 + 0.015 * Math.sin(ms / 37), op: 0.75 * k })
    }
    for (const [at, size] of P.rings) {
      const k = (e - at) / 700
      if (k < 0 || k >= 1) continue
      const rx = (0.12 + 1.05 * easeOut(k)) * size
      out.items.push({ t: 'ring', x: 0, y: -0.01, rx, ry: rx * 0.24, w: 0.022 * (1 - k) + 0.004, op: 0.85 * (1 - k) })
    }
    for (let i = 0; i < P.mist; i++) {
      const life = 1500 + 500 * rnd(i, 41), k = (e - 60 * i) / life
      if (k < 0 || k >= 1) continue
      const dir = i % 2 ? 1 : -1, q = easeOut(k)
      out.items.push({ t: 'mist', x: dir * (0.06 + (0.35 + 0.55 * rnd(i, 42)) * q), y: -0.03 - (0.06 + 0.28 * rnd(i, 43)) * q,
        r: 0.1 + (0.22 + 0.25 * rnd(i, 44)) * q, op: 0.55 * Math.min(1, k / 0.08) * (1 - k) })
    }
  }
  return out
}
// 滝の絵（描いてもらった1枚）の動き（叩きつけた所で横へふくらみ・落ちているあいだ小さく脈打ち・光ったときは明るく・
//   落ち終わったら上から切れる＝cut 0〜1）。ms＝技を出しはじめてから。出ていないときは null
export const fallAt = (m, ms, P = POUR) => {
  if (m?.scene?.kind !== 'pour') return null
  const { H, I, E, T } = pourTimesOf(m, P)
  if (ms < H || ms >= E + T) return null
  const e = ms - I, b = e >= 0 && e < 260 ? Math.sin((Math.PI * e) / 260) : 0
  const f2 = e >= 0 && e < 380 ? 0.85 * (e < 40 ? e / 40 : Math.pow(1 - (e - 40) / 340, 1.5)) : 0
  return { sx: 1 + 0.025 * Math.sin(ms * 0.07) + 0.08 * b, sy: 1 - 0.03 * b, bright: 1 + 0.5 * f2 + 0.08 * Math.sin(ms * 0.05),
    cut: ms < E ? 0 : smooth((ms - E) / T) }
}

// 0 → 1 → 0 の山（at から len ms）
const bump = (e, len) => (e >= 0 && e < len ? Math.sin((Math.PI * e) / len) : 0)
// 光・揺れの1回ぶん（at で一気に、len でおさまる）
const pulse = (e, len) => (e >= 0 && e < len ? Math.pow(1 - e / len, 1.5) : 0)

// 水縛の帯（kind 'coil'）のあいだ（ms＝技を出しはじめてから）
//   → sceneAt と同じ形＋ squeeze（相手の縮み [横, 縦]）
export const coilSceneAt = (m, ms, landed = true, C = COIL) => {
  const out = { dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null, squeeze: null }
  const H = m.hitMs, I = m.impactMs, B = I + C.burstMs, end = sceneEndMsOf(m)
  if (ms < 0 || ms >= end) return out
  const e = ms - I
  // 暗さ：胸元でためるあいだに少し暗く・はじけたら戻る
  out.dim = ms < H ? C.dim * smooth((ms - 120) / (H - 120)) : ms < B + 150 ? C.dim : C.dim * (1 - smooth((ms - B - 150) / 400))
  // 構えの手に水が集まり、振り抜きの手ではじける（ほかの技と同じ）
  handFxAt(m, ms, out)
  if (!landed || e < 0) return out
  // 光と揺れ：巻きついた瞬間・締め上げるたび・はじけた瞬間
  const sq = C.squeezes.map(t => e - t)
  out.flash = Math.max(0.5 * pulse(e, 260), ...sq.map(d => 0.2 * pulse(d, 160)), 0.45 * pulse(ms - B, 280))
  const amp = 6 * pulse(e, 400) + sq.reduce((a, d) => a + 3.5 * pulse(d, 220), 0) + 5 * pulse(ms - B, 320)
  out.shake = [amp * Math.sin(e * 0.13), amp * 0.6 * Math.cos(e * 0.17)]
  // 相手が縮む（締め上げるたび横に縮んで縦に伸びる）
  const b = Math.max(0.7 * bump(e, 180), ...sq.map(d => bump(d, 200)))
  if (ms < B) out.squeeze = [1 - 0.09 * b, 1 + 0.04 * b]
  // 水の輪：はじめは大きく、すぐ巻きついて細る・締め上げるたび細る・回り続ける・はじけたら外へ広がって消える
  const snap = easeOut(e / 180), tight = Math.max(...sq.map(d => bump(d, 200)))
  const burst = clamp01((ms - B) / 260)
  if (ms < B + 260) C.rings.forEach((dy, i) => {
    const rx = (0.82 - 0.4 * snap) * (1 - 0.14 * tight) * (1 + 1.4 * easeOut(burst)) * (1 - 0.06 * Math.abs(dy) / 0.2)
    out.items.push({ t: 'coil', x: 0, y: BODY_Y + dy * (1 + 0.5 * burst), rx, ry: rx * 0.28, w: 0.035 * (1 - 0.6 * burst), dash: ms * 0.6 + i * 47,
      op: Math.min(1, e / 60) * (1 - burst) })
  })
  // しぶき：締め上げるたび体のまわりへ・はじけたら大きく
  C.squeezes.forEach((t, j) => drops(out.items, 12, 9000 + j * 40, e - t, [0.5, 1.2], [350, 550], [0.006, 0.014], 0.5, { oy: BODY_Y, around: true }))
  drops(out.items, 46, 9500, ms - B, [0.8, 2.0], [500, 850], [0.008, 0.02], 0.4, { oy: BODY_Y, around: true })
  // はじけたとき足元に波紋
  if (ms >= B && ms < B + 650) { const k = (ms - B) / 650, rx = 0.15 + 0.9 * easeOut(k); out.items.push({ t: 'ring', x: 0, y: -0.01, rx, ry: rx * 0.24, w: 0.02 * (1 - k) + 0.004, op: 0.8 * (1 - k) }) }
  // 泡：足元から体のまわりを立ちのぼる（水の中に閉じこめられる）
  for (let i = 0; i < C.bubbles; i++) {
    const per = 900 + 500 * rnd(i, 51), k = ((e + rnd(i, 52) * per) % per) / per
    if (ms >= B + 200) break
    const r = 0.012 + 0.02 * rnd(i, 53)
    out.items.push({ t: 'bubble', x: (rnd(i, 54) - 0.5) * 0.7 + 0.03 * Math.sin(ms / 140 + i), y: -0.04 - k * 0.95, r, op: 0.8 * Math.sin(Math.PI * k) * Math.min(1, e / 200) })
  }
  return out
}

// 水縛の帯の当たる絵（相手の体に巻きつく絵）の動き：大きく出て一気に締まり・締め上げるたび縮み・小さく揺れ・はじけたら広がって消える
//   ms＝技を出しはじめてから。出ていないときは null
export const coilAt = (m, ms, C = COIL) => {
  if (m?.scene?.kind !== 'coil') return null
  const I = m.impactMs, B = I + C.burstMs, e = ms - I
  if (e < 0 || ms >= B + 280) return null
  const tight = Math.max(...C.squeezes.map(t => bump(e - t, 200))), burst = clamp01((ms - B) / 280)
  return { s: (1.55 - 0.55 * easeOut(e / 160)) * (1 - 0.08 * tight) * (1 + 0.35 * easeOut(burst)), rot: Math.sin(ms / 85) * 0.03,
    op: Math.min(1, e / 50) * (1 - burst), bright: 1 + 0.5 * pulse(e, 260) + 0.25 * tight }
}

// 画面ぜんたい：いま流れている技（acts＝[{ m, ms, after }]）と構え（cast＝{ m, ms }）を合わせる
//   暗さと光はいちばん強いもの・揺れは足す・描くものは並べる・雲と手は新しいほう（acts の after・landed は sceneAt と同じ）
//   相手の縮みはかけ合わせる
export const stageSceneOf = (acts, cast) => {
  const out = { dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null, squeeze: null }
  const add = (s) => {
    out.dim = Math.max(out.dim, s.dim)
    out.flash = Math.max(out.flash, s.flash)
    out.shake = [out.shake[0] + s.shake[0], out.shake[1] + s.shake[1]]
    out.items.push(...s.items)
    if (s.cloud) out.cloud = s.cloud
    if (s.hand) out.hand = s.hand
    if (s.squeeze) out.squeeze = out.squeeze ? [out.squeeze[0] * s.squeeze[0], out.squeeze[1] * s.squeeze[1]] : s.squeeze
  }
  if (cast?.m) add(castSceneAt(cast.m, cast.ms))
  for (const a of acts) add(sceneAt(a.m, a.ms, a))
  return out
}
