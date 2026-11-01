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
// 【確定】2026-11-01 閻魔（ユーザー「閻魔も作ったから最後まで全部つくって」）：魂火＝'hands' の色違い（tone 'soul'）／業火断罪＝'burst'（杖を突いた瞬間に光って揺れ、相手の足元で火の粉・輪・煙）／
//   業縛の鎖＝'coil' の絵の動きだけ（chains＝水の輪と泡は出さない・tone 'fire'）／無間地獄＝'doom' から奔流を抜いた形（noBeam・炎は下から噴き上がる絵＝画面の rise）
// 【確定】2026-11-01 ユーザー「断罪はもっと炎っぽく、無間地獄も炎をしっかりモーションして、手のモーションもつけて」「鎖もモーションしっかり動くようにして」：
//   炎の絵は components/BossFireFx.jsx で燃やす・火の粉が絶えず立ちのぼる（embersUp）・無間地獄は地の底から亡者の腕が伸びて指を開いて握る（deadHandsAt・deadHandPathOf）。
//   鎖は絵の1枚を出すのをやめ、絵から切った鎖のひと続きを、足元から体のまわりへらせんに並べて伸ばし、締め上げるたび巻き直して細り、最後にちぎれ飛ぶ（chainTilesAt）。
//   wrapped＝炎や鎖に巻かれて、自分の体が熱く光る強さ（外れたときは 0）。動かさない＝ユーザー「プレイヤーの被ダメージのグラグラモーションはいらない」
// 【確定】2026-10-30 ユーザー「終焉の黒焔もっと大技っぽくしてほしい、貯める動作も長く」（kind 'doom'）：
//   ため＝舞台が赤黒く暗くなり、火の粉が広い所から口へ渦を巻いて吸い込まれ、口の光が育ち、竜の体が赤く光を増す（震えない＝ユーザー「溜めるとき、別に震えなくていい」）。
//   吐きつけ＝光・揺れと一緒に、口から相手へ黒焔の奔流（beam・画面 SceneLayer）。当たると大きく光って揺れ、火の粉・炎の柱・足元の輪・黒い煙・足元の残り火。
//   色は tone 'fire'（画面の色が水から炎へ替わる）・暗さの色は dimColor
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
// 終焉の黒焔（kind 'doom'）：dim＝ためのあいだの暗さ・castDim＝構えの暗さ・hitDim＝当たったあと・after＝当たってから暗さが戻りはじめるまで（ms）・
//   beamTail＝当たったあと奔流が残る長さ（ms・吐きつけの絵が出ているあいだ）・reach＝火の粉を吸い込む広さ（水天葬の何倍）
export const DOOM = {
  color: '22,0,0', dim: 0.62, castDim: 0.62, hitDim: 0.78, after: 1300, fade: 500, beamTail: 300, motes: 30, reach: 2.4,
  splash: 90, jets: 18, mist: 14, rings: [[0, 1.1], [130, 0.85], [300, 0.65], [520, 0.5]], blobs: 42,
}
// 飛ぶエフェクトの進み（p＝飛んだ時間の割合 0〜1 → 口から相手までの割合）：はじめは少しゆっくり。画面の飛ぶ絵と奔流の先が同じ（火の玉が先頭）
export const flyPosOf = (p) => p * (0.7 + 0.3 * p)
const SPIN_UP_MS = 1600   // 水天葬の渦が振り下ろす前にだんだん速くなる長さ
const G = 5.5   // しぶきの落ちる速さ（枠の幅/秒²）
// 水縛の帯（kind 'coil'）：叩きつけて（I）から squeezes の時刻に締め上げ、burstMs ではじける。輪は体の真ん中（BODY_Y）のまわりに3つ
export const COIL = { dim: 0.42, squeezes: [300, 600, 900], burstMs: 1100, rings: [-0.2, 0, 0.2], bubbles: 12 }
// 足元で噴き上がる技（kind 'burst'・業火断罪）：dim＝暗さ・after＝当たってから暗さが戻りはじめるまで（ms）・splash＝火の粉・jets＝炎の筋・rings＝足元の輪・mist＝煙
export const BURST = { dim: 0.42, after: 620, fade: 400, splash: 46, jets: 12, mist: 6, rings: [[0, 1], [130, 0.75], [300, 0.55]] }
// 業縛の鎖（chainTilesAt）：strands＝本数・wraps＝1本が巻く回数・rx＝巻く半径・flat＝斜めから見た縦のつぶれ・thick＝鎖の太さ・pitch＝切った絵のひと続きの間隔（どれも相手の絵の枠の幅が1）・
//   heights＝1本ずつの巻き終わりの高さ・squeezes＝巻きついてから締め上げる時刻（ms）・burstMs＝ちぎれる時刻・flyMs＝飛び散る長さ
export const CHAIN = { strands: 2, wraps: 2, rx: 0.56, flat: 0.3, thick: 0.2, pitch: 0.42, heights: [0.7, 0.42], squeezes: [140, 380, 620], burstMs: 860, flyMs: 420 }
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
  : m?.scene?.kind === 'doom' ? m.impactMs + DOOM.after + DOOM.fade + 900
  : m?.scene?.kind === 'burst' ? m.impactMs + BURST.after + BURST.fade + 600
  : m?.scene?.kind === 'hands' ? (handFxOf(m)?.ts ?? 0) + 600
  : m?.scene?.kind === 'gun' ? m.impactMs + (m.strikes?.at(-1).atMs || 0) + 800
  : m?.scene?.kind === 'slash' ? m.impactMs + 1100 : 0)

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
const motes = (items, n, ms, op, hands = 1, reach = 1) => {
  if (op <= 0) return
  for (let i = 0; i < n; i++) {
    const per = 620 + 260 * rnd(i, 31), p = (ms / per + rnd(i, 32)) % 1
    const d = (70 + 70 * rnd(i, 33)) * reach * (1 - easeOut(p)), a = rnd(i, 34) * Math.PI * 2 + p * 2.4
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
  if (m?.scene?.kind === 'doom' && castMs >= 0) return doomCastSceneAt(m, castMs)
  if (m?.scene?.kind !== 'pour' || castMs < 0) return out
  const k = smooth(castMs / 1200)
  out.dim = P.castDim * k
  rain(out.items, P.rain, castMs, 0.6 * smooth(castMs / 1500))
  motes(out.items, P.motes, castMs, 0.8 * k, handFxOf(m)?.nw || 1)
  out.cloud = { spin: (P.spin * castMs) / 1000, glow: (0.35 + 0.1 * Math.sin(castMs / 260)) * k, flicker: flickerAt(castMs) * k }
  out.hand = { r: 24 + 4 * Math.sin(castMs / 130), op: smooth(castMs / 600) }
  return out
}

// 技のあいだ（ms＝技を出しはじめてから・after＝構えのすぐあと・landed＝当たったか）
//   【確定】2026-10-31 ユーザー「回避されてもモーションは継続するようにして」：外れても演出は当たったときと同じに最後まで流す（前は滝が落ちず、光らず、揺れなかった）。
//   landed で変わるのは相手の反応（水縛の帯で縮む squeeze）だけ。数字の代わりに「Miss」が出る（lib/atbFx.js）
//   → { dim, flash（0〜1）, shake: [x, y]（px）, items, cloud: { spin, glow, flicker }, hand: { r, op } }
export const sceneAt = (m, ms, { after = false, landed = true } = {}, P = POUR) => {
  if (m?.scene?.kind === 'coil') return coilSceneAt(m, ms, landed)
  if (m?.scene?.kind === 'doom') return doomSceneAt(m, ms, DOOM, landed)
  if (m?.scene?.kind === 'burst') return burstSceneAt(m, ms, BURST, landed)
  if (m?.scene?.kind === 'gun') return gunSceneAt(m, ms)
  if (m?.scene?.kind === 'slash') return slashSceneAt(m, ms, landed)
  const out = { dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null, tone: m?.scene?.tone || null }
  if (m?.scene?.kind === 'hands') { if (ms >= 0 && ms < sceneEndMsOf(m)) handFxAt(m, ms, out); return out }
  if (m?.scene?.kind !== 'pour') return out
  const { H, I, L, E, T, end } = pourTimesOf(m, P)
  if (ms < 0 || ms >= end) return out
  const e = ms - I
  // 構えのすぐあと（after）は技の途中（castSkipMs）から流す＝そこから振り下ろすまでで数える（構えの終わりの暗さ・手の光・渦の角度からつながる）
  const from = after ? (m.castSkipMs || 0) : 0
  const toHit = (x) => smooth((x - from) / Math.max(1, H - from))
  // 暗さ：振り下ろすまでに暗くなり（構えのすぐあとは構えの暗さから）、落ち終わったら戻る
  const d0 = after ? P.castDim : 0
  out.dim = ms < H ? d0 + (P.dim - d0) * toHit(ms) : ms < E ? P.dim : P.dim * (1 - smooth((ms - E) / 600))
  // 光：振り下ろした瞬間に少し・叩きつけた瞬間に大きく
  const f1 = ms >= H && ms < H + 180 ? 0.3 * (1 - (ms - H) / 180) : 0
  const f2 = e >= 0 && e < 380 ? 0.85 * (e < 40 ? e / 40 : Math.pow(1 - (e - 40) / 340, 1.5)) : 0
  out.flash = Math.max(f1, f2)
  // 揺れ：叩きつけた瞬間に大きく（だんだん小さく）・落ちているあいだは小さく揺れ続ける
  if (e >= 0 && ms < E + 200) {
    const k = clamp01(e / 700), rumble = ms < E ? 1.8 : 1.8 * (1 - (ms - E) / 200)
    const amp = 11 * (1 - k) * (1 - k) + rumble
    out.shake = [amp * Math.sin(e * 0.11), amp * 0.65 * Math.cos(e * 0.153)]
  }
  // 小雨と手の光：振り下ろすまで（構えずに流したときは出はじめを薄く）
  if (ms < H) {
    const a = after ? 1 : smooth(ms / 600)
    rain(out.items, P.rain, ms, 0.6 * a)
    motes(out.items, P.motes, ms, 0.8 * a, handFxOf(m)?.nw || 1)
    out.hand = { r: 26 + 18 * toHit(ms) + 4 * Math.sin(ms / 110), op: after ? 1 : smooth(ms / 300) }
  }
  // 振り下ろした瞬間（振り抜きの絵に替わる時刻）に両手ではじける（ほかの技と同じ・構えの手の光と粒は上の水天葬の分）
  handFxAt(m, ms, out, { gather: false })
  // 雲：振り下ろすまで渦がだんだん速く回り（最後の SPIN_UP_MS で速くなる）、まん中が明るくなる。滝が落ちているあいだも回り続ける
  const t = Math.max(0, Math.min(ms, H) - (after ? from : Math.max(0, H - SPIN_UP_MS))) / 1000
  const base = after ? P.spin * (m.castSkipMs ? m.castSkipMs / 1000 : CAST_SEC) : 0
  const spin = base + P.spin * ((ms - from) / 1000) + 1.6 * t * t + (ms > H ? (3.2 * SPIN_UP_MS / 1000) * ((ms - H) / 1000) : 0)
  const glow = ms < H ? 0.45 + 0.55 * toHit(ms) : ms < E ? 0.75 + 0.25 * Math.sin(ms / 60) : Math.max(0, 1 - (ms - E) / T)
  out.cloud = { spin, glow, flicker: ms < E ? flickerAt(ms) : 0 }
  // 流れ落ちる水の筋（雲から足元へ・いまの滝の先まで）。落ち終わると上から切れる
  if (ms >= H && ms < E + T) {
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
  if (e >= 0) {
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
  // chains＝描いた鎖の絵だけ（業縛の鎖・水の輪と泡は出さない・しぶきは火の粉の色）
  const chains = !!m.scene.chains
  if (chains) C = { ...C, squeezes: CHAIN.squeezes, burstMs: CHAIN.burstMs }
  const out = { dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null, squeeze: null, tone: m.scene.tone || null, dimColor: m.scene.dimColor || null, wrapped: 0 }
  const H = m.hitMs, I = m.impactMs, B = I + C.burstMs, end = sceneEndMsOf(m)
  if (ms < 0 || ms >= end) return out
  const e = ms - I
  // 暗さ：胸元でためるあいだに少し暗く・はじけたら戻る
  out.dim = ms < H ? C.dim * smooth((ms - 120) / (H - 120)) : ms < B + 150 ? C.dim : C.dim * (1 - smooth((ms - B - 150) / 400))
  // 構えの手に水が集まり、振り抜きの手ではじける（ほかの技と同じ）
  handFxAt(m, ms, out)
  // 鎖が地面から出るところ：足元の外に火の粉と輪
  if (chains && ms >= H && e < 200) {
    for (let i = 0; i < CHAIN.strands; i++) {
      const a = chainStartAngleOf(i), gx = Math.cos(a) * CHAIN.rx * 1.55, gy = Math.sin(a) * CHAIN.rx * 1.55 * CHAIN.flat, q = (ms - H) / 420
      drops(out.items, 8, 9700 + i * 30, ms - H, [0.4, 1], [260, 420], [0.005, 0.012], 0.12, { oy: gy })
      if (q < 1) out.items.push({ t: 'ring', x: gx, y: gy, rx: 0.05 + 0.16 * easeOut(q), ry: (0.05 + 0.16 * easeOut(q)) * 0.3, w: 0.012 * (1 - q) + 0.003, op: 0.9 * (1 - q) })
    }
  }
  if (e < 0) return out
  // 光と揺れ：巻きついた瞬間・締め上げるたび・はじけた瞬間
  const sq = C.squeezes.map(t => e - t)
  out.flash = Math.max(0.5 * pulse(e, 260), ...sq.map(d => 0.2 * pulse(d, 160)), 0.45 * pulse(ms - B, 280))
  const amp = 6 * pulse(e, 400) + sq.reduce((a, d) => a + 3.5 * pulse(d, 220), 0) + 5 * pulse(ms - B, 320)
  out.shake = [amp * Math.sin(e * 0.13), amp * 0.6 * Math.cos(e * 0.17)]
  // 相手が縮む（締め上げるたび横に縮んで縦に伸びる）。外れたときは縮まない
  const b = Math.max(0.7 * bump(e, 180), ...sq.map(d => bump(d, 200)))
  if (landed && ms < B) out.squeeze = [1 - 0.09 * b, 1 + 0.04 * b]
  // 鎖に巻かれて光る（締め上げるたび強く）・体のまわりが赤く熱い
  if (chains) {
    if (landed && ms < B) out.wrapped = 0.45 + 0.55 * b
    if (ms < B + 200) out.items.push({ t: 'glow', x: 0, y: BODY_Y, r: 0.42, op: (0.08 + 0.2 * b) * Math.min(1, e / 80) * (1 - clamp01((ms - B) / 200)) })
  }
  // 水の輪：はじめは大きく、すぐ巻きついて細る・締め上げるたび細る・回り続ける・はじけたら外へ広がって消える
  const snap = easeOut(e / 180), tight = Math.max(...sq.map(d => bump(d, 200)))
  const burst = clamp01((ms - B) / 260)
  if (!chains && ms < B + 260) C.rings.forEach((dy, i) => {
    const rx = (0.82 - 0.4 * snap) * (1 - 0.14 * tight) * (1 + 1.4 * easeOut(burst)) * (1 - 0.06 * Math.abs(dy) / 0.2)
    out.items.push({ t: 'coil', x: 0, y: BODY_Y + dy * (1 + 0.5 * burst), rx, ry: rx * 0.28, w: 0.035 * (1 - 0.6 * burst), dash: ms * 0.6 + i * 47,
      op: Math.min(1, e / 60) * (1 - burst) })
  })
  // しぶき：締め上げるたび体のまわりへ・はじけたら大きく
  C.squeezes.forEach((t, j) => drops(out.items, 12, 9000 + j * 40, e - t, [0.5, 1.2], [350, 550], chains ? [0.003, 0.007] : [0.006, 0.014], 0.5, { oy: BODY_Y, around: true }))
  drops(out.items, chains ? 30 : 46, 9500, ms - B, [0.8, 2.0], [500, 850], chains ? [0.003, 0.008] : [0.008, 0.02], 0.4, { oy: BODY_Y, around: true })
  // はじけたとき足元に波紋
  if (ms >= B && ms < B + 650) { const k = (ms - B) / 650, rx = 0.15 + 0.9 * easeOut(k); out.items.push({ t: 'ring', x: 0, y: -0.01, rx, ry: rx * 0.24, w: 0.02 * (1 - k) + 0.004, op: 0.8 * (1 - k) }) }
  // 泡：足元から体のまわりを立ちのぼる（水の中に閉じこめられる）
  if (!chains) for (let i = 0; i < C.bubbles; i++) {
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

// 黒焔の奔流の炎のかたまり（棒に見えないように・絵の塗りになじむ）：口から相手へ流れ、先へ行くほど広がって大きくなる。3つに1つは黒い煙（黒焔）。
//   p＝口から相手までの進み（head まで）・off＝流れの横へのずれ（枠の幅が1）・r＝半径（枠の幅が1）・dark＝黒い煙
const doomBlobs = (ms, head, D = DOOM) => {
  const out = []
  for (let i = 0; i < D.blobs; i++) {
    const per = 260 + 160 * rnd(i, 81), q = (ms / per + rnd(i, 82)) % 1, p = q * head
    const spread = 0.025 + 0.09 * q
    out.push({ p, off: spread * (rnd(i, 83) - 0.5) * 2 + 0.018 * Math.sin(ms / 60 + i * 1.7), r: (0.035 + 0.07 * q) * (0.7 + 0.6 * rnd(i, 84)),
      op: Math.min(1, q / 0.1) * (1 - 0.45 * q), dark: i % 3 === 2 })
  }
  return out
}
// 終焉の黒焔のためるあいだ（構えの5秒・技の ため）：k＝ためた割合 0〜1・a＝出てくる割合。火の粉が広い所から口へ吸い込まれ、口の光が育つ
//   【確定】2026-11-01 ユーザー「これ大技の時のふわふわなのか、そしたら黒龍には合わないからいらない」：竜の体のまわりの赤い光（bossGlow）はやめた
const doomGather = (out, ms, k, a, D = DOOM) => {
  motes(out.items, D.motes, ms, 0.95 * a, 1, D.reach)
  out.hand = { r: 12 + 34 * k + 3 * Math.sin(ms / 120), op: a }
}
// 構えのあいだ：ためた割合は構えの長さ（＝技の途中から流す時刻 castSkipMs・lib/dungeon.js の castSec と同じ）で数える
const doomCastSceneAt = (m, castMs, D = DOOM) => {
  const out = { dim: D.castDim * smooth(castMs / 1200), flash: 0, shake: [0, 0], items: [], cloud: null, hand: null, tone: m.scene.tone || 'fire', dimColor: m.scene.dimColor || D.color, beam: null }
  doomGather(out, castMs, clamp01(castMs / (m.castSkipMs || CAST_SEC * 1000)), smooth(castMs / 500))
  return out
}
// 技のあいだ（ms＝技を出しはじめてから）→ sceneAt と同じ形＋ tone・dimColor・beam: { head（口から相手までの進み 0〜1）, w（太さの割合）, op }
//   ★構えのあとは技の途中（castSkipMs）から流す＝どの時刻から見ても同じ形（暗さ・口の光は構えのおわりとつながる）
export const doomSceneAt = (m, ms, D = DOOM, landed = true) => {
  //   tone・dimColor＝ボスごとの色（無ければ炎＝黒龍。ゼルギアスの神雷終焉は 'thunder'＝青白い）
  const out = { dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null, tone: m.scene?.tone || 'fire', dimColor: m.scene?.dimColor || D.color, beam: null, wrapped: 0 }
  const H = m.hitMs, I = m.impactMs, end = sceneEndMsOf(m)
  if (ms < 0 || ms >= end) return out
  const e = ms - I, s = ms - H
  // 暗さ：ためるあいだに暗くなり、当たるともっと暗く・after のあと戻る
  const base = ms < H ? D.dim * smooth(ms / 900) : e >= 0 ? D.hitDim : D.dim
  out.dim = ms < I + D.after ? base : base * (1 - smooth((ms - I - D.after) / D.fade))
  if (ms < H) {
    doomGather(out, ms, clamp01(ms / (m.castSkipMs || H)), smooth(ms / 400))
    return out
  }
  // 吐いた瞬間：少し光って揺れ、口で光がはじける
  out.flash = 0.45 * pulse(s, 220)
  let amp = 7 * pulse(s, 320)
  if (s < 280) out.hand = { r: 30 + 60 * easeOut(s / 220), op: 1 - s / 280 }
  // 黒焔の奔流：口から相手へ伸び、当たったあと beamTail のあいだ細りながら残る
  const tail = I + D.beamTail
  if (ms < tail && !m.scene?.noBeam) {
    const fade = ms < I ? 1 : 1 - (ms - I) / D.beamTail
    const head = flyPosOf(clamp01(s / (I - H)))
    out.beam = { head, w: (0.45 + 0.55 * easeOut(s / 140)) * fade, op: Math.min(1, s / 50) * Math.sqrt(fade), blobs: doomBlobs(ms, head, D) }
  }
  if (e >= 0) {
    // 当たった瞬間：大きく光り、大きく揺れる（だんだん小さく）
    out.flash = Math.max(out.flash, 0.95 * (e < 40 ? e / 40 : pulse(e - 40, 520)))
    const k = clamp01(e / 1000), rumble = e < 800 ? 1.6 * (1 - e / 800) : 0
    amp += 15 * (1 - k) * (1 - k) + rumble
    // 地の底から業火（無間地獄）：火の粉が絶えず立ちのぼる・亡者の腕が伸びる・炎に巻かれて光る
    if (m.scene?.hands) {
      embersUp(out.items, 46, 18000, e, 2.1, 1.7, D.after + 200)
      deadHandsAt(out.items, e)
      if (landed) out.wrapped = 1 - smooth((e - D.after) / D.fade)
    }
    // 火の粉・炎の柱・足元の輪・黒い煙・足元の残り火
    drops(out.items, D.splash, 12000, e, [0.8, 2.2], [600, 1100], [0.006, 0.018], 0.5)
    drops(out.items, 40, 13000, e - 120, [0.5, 1.5], [500, 900], [0.006, 0.015], 0.5, { oy: BODY_Y, around: true })
    jets(out.items, D.jets, 14000, e, 1.5)
    jets(out.items, 10, 15000, e - 180, 1.1)
    for (const [at, size] of D.rings) {
      const q = (e - at) / 700
      if (q < 0 || q >= 1) continue
      const rx = (0.12 + 1.1 * easeOut(q)) * size
      out.items.push({ t: 'ring', x: 0, y: -0.01, rx, ry: rx * 0.24, w: 0.026 * (1 - q) + 0.004, op: 0.9 * (1 - q) })
    }
    for (let i = 0; i < D.mist; i++) {
      const life = 1500 + 600 * rnd(i, 71), q = (e - 50 * i) / life
      if (q < 0 || q >= 1) continue
      const dir = i % 2 ? 1 : -1, v = easeOut(q)
      out.items.push({ t: 'mist', x: dir * (0.04 + (0.28 + 0.5 * rnd(i, 72)) * v), y: -0.05 - (0.12 + 0.55 * rnd(i, 73)) * v, r: 0.12 + (0.25 + 0.28 * rnd(i, 74)) * v, op: 0.8 * Math.min(1, q / 0.08) * (1 - q) })
    }
    if (e < D.after + D.fade) {
      const a = e < 80 ? e / 80 : e < D.after ? 1 : 1 - (e - D.after) / D.fade
      out.items.push({ t: 'foam', x: 0, y: -0.02, rx: 0.5 + 0.03 * Math.sin(ms / 60), ry: 0.11 + 0.012 * Math.sin(ms / 47), op: 0.85 * a })
    }
  }
  out.shake = [amp * Math.sin(ms * 0.11), amp * 0.65 * Math.cos(ms * 0.153)]
  return out
}

// 炎から立ちのぼる火の粉（足元から上へ・左右にゆれて消える）：spread＝広さ・rise＝高さ（枠の幅が1）・until＝ここから薄れる（ms）
const embersUp = (items, n, seed, e, spread, rise, until) => {
  const all = 1 - smooth((e - until) / 320)
  if (e < 0 || all <= 0) return
  for (let i = 0; i < n; i++) {
    const per = 480 + 520 * rnd(seed + i, 1), k = ((e + rnd(seed + i, 2) * per) % per) / per
    const r = 0.004 + 0.008 * rnd(seed + i, 5)
    items.push({ t: 'drop', x: (rnd(seed + i, 3) - 0.5) * spread + 0.04 * Math.sin(e / 90 + i), y: -0.02 - rise * (0.25 + 0.75 * rnd(seed + i, 4)) * easeOut(k), rx: r * 2.2, ry: r, rot: 90, op: all * Math.min(1, k / 0.1) * (1 - k) })
  }
}
// 亡者の腕の形（手首が原点・指先が上・大きさ1）：curl＝指の曲がり（＋で握る・−で開いて爪を立てる）。fill で塗る1本のパス。画面は枠の幅 × s に広げて回す
const HAND_FINGERS = [[-0.3, -0.2, -64, 0.5, 0.09], [-0.25, -0.5, -22, 0.66, 0.08], [-0.08, -0.56, -6, 0.76, 0.082], [0.1, -0.54, 9, 0.7, 0.078], [0.26, -0.43, 26, 0.54, 0.066]]
const poly = (arr) => `M${arr.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join('L')}Z`
export const deadHandPathOf = (curl) => {
  let d = poly([[-0.17, 0.02], [-0.34, -0.24], [-0.31, -0.54], [0.3, -0.5], [0.36, -0.22], [0.17, 0.02]]) + poly([[-0.17, 0], [0.17, 0], [0.24, 1.7], [-0.24, 1.7]])
  for (const [bx, by, a, len, w] of HAND_FINGERS) {
    const dir = a < 0 ? 1 : -1, L = [], R = []
    let ang = a * (1 - 0.3 * Math.max(0, curl)), x = bx, y = by
    for (const [k, bend, wk] of [[0.42, 12, 1], [0.33, 30, 0.82], [0.25, 40, 0.6]]) {
      const th = (ang * Math.PI) / 180, nx = Math.cos(th), ny = Math.sin(th)
      L.push([x - nx * w * wk, y - ny * w * wk])
      R.push([x + nx * w * wk, y + ny * w * wk])
      x += Math.sin(th) * len * k
      y -= Math.cos(th) * len * k
      ang += dir * bend * curl
    }
    d += poly([...L, [x, y], ...R.reverse()])
  }
  return d
}
// 亡者の腕（無間地獄）：地の底から突き上がり、指を開いて → 握って → 開いて → 握りながら沈む。奥（上）は小さく、手前（下）は大きい。e＝当たってからの ms
//   x・h＝足元からの場所と手首の高さ（枠の幅が1）・s＝大きさ・lean＝傾き（相手へ向かう）・at＝出る時刻・life＝長さ
const HELL_HANDS = [
  { x: -0.2, h: 1.04, s: 0.2, lean: 6, at: 90, life: 1100 }, { x: 0.24, h: 1.12, s: 0.2, lean: -8, at: 220, life: 1000 },
  { x: -0.74, h: 0.98, s: 0.18, lean: 14, at: 260, life: 950 }, { x: 0.78, h: 0.92, s: 0.18, lean: -14, at: 300, life: 950 },
  { x: -0.58, h: 0.62, s: 0.3, lean: 10, at: 0, life: 1240 }, { x: 0.62, h: 0.58, s: 0.31, lean: -12, at: 130, life: 1120 },
  { x: -0.92, h: 0.3, s: 0.34, lean: 16, at: 40, life: 1180 }, { x: 0.96, h: 0.28, s: 0.36, lean: -18, at: 80, life: 1150 },
  { x: -0.34, h: 0.2, s: 0.27, lean: 20, at: 200, life: 1050 }, { x: 0.38, h: 0.18, s: 0.28, lean: -22, at: 160, life: 1080 },
]
export const deadHandsAt = (items, e) => {
  HELL_HANDS.forEach((h, i) => {
    const p = (e - h.at) / h.life
    if (p < 0 || p >= 1) return
    const rise = easeOut(p / 0.22), sink = smooth((p - 0.8) / 0.2)
    //   thin＝軽い表示では出さない腕（左右の組ごと）。並びの何番目かで間引くと、左右の片方だけ残って、腕が増えるたび入れ替わる
    items.push({ t: 'dhand', thin: Math.floor(i / 2) % 2 === 1, x: h.x + 0.015 * Math.sin(e / 170 + i), y: 0.3 - (h.h + 0.3) * rise + 0.3 * sink, s: h.s,
      rot: h.lean * (1 + 0.8 * (1 - rise)) + 7 * Math.sin(e / 150 + i * 1.7),
      curl: -0.85 + 1.6 * smooth((p - 0.28) / 0.2) - 0.9 * smooth((p - 0.56) / 0.14) + 0.8 * smooth((p - 0.76) / 0.14),
      op: Math.min(1, p / 0.06) * (p > 0.86 ? (1 - p) / 0.14 : 1) })
  })
}
// 業縛の鎖の1本の上の点（t＝0 地面の外〜1 巻き終わり）：地面の遠くから体へ渦を巻いて寄り、巻きながら上がる。x・y＝足元から（枠の幅が1）・z＝手前ほど＋（sin）
const chainStartAngleOf = (i) => (i * 2 * Math.PI) / CHAIN.strands + 0.6
const chainPointAt = (i, t, tight, slide, C) => {
  const a = chainStartAngleOf(i) + 2 * Math.PI * C.wraps * t + slide, sn = Math.sin(a)
  const r = C.rx * (1 - 0.2 * tight) * (1 + 0.55 * (1 - smooth(t / 0.16)))
  return { x: r * Math.cos(a), y: -C.heights[i] * smooth((t - 0.1) / 0.9) + r * C.flat * sn, z: sn }
}
// 業縛の鎖のいまの形（ms＝技を出しはじめてから・lead のあいだに伸びて、当たる時刻に巻き終わる）→ [{ x, y, rot（ラジアン・進む向き）, s（遠近の倍率）, front（体より手前）, op }]（頭の側から順＝根もとの側が上に重なる）。
//   締め上げるたび細って、巻きが進む（slide）。ちぎれると外へ飛び散る
export const chainTilesAt = (m, ms, C = CHAIN) => {
  const lead = m.fx?.hit?.lead || 0, e = ms - m.impactMs, k = (e - C.burstMs) / C.flyMs
  if (e < -lead || k >= 1) return []
  const head = e < 0 ? easeOut((e + lead) / Math.max(1, lead)) : 1
  const steps = C.squeezes.map(t => smooth((e - t) / 90)), tc = steps.reduce((a, v) => a + v, 0) / C.squeezes.length
  const snap = e >= 0 ? 0.12 * pulse(e, 160) : 0.12
  const tight = tc + 0.3 * Math.max(0, ...C.squeezes.map(t => bump(e - t, 200))) - snap
  const slide = 0.7 * tc + Math.max(0, e) * 0.00035
  const out = []
  for (let i = 0; i < C.strands; i++) {
    const tiles = []
    const N = 130
    let p = chainPointAt(i, 0, tight, slide, C), acc = C.pitch
    for (let j = 1; j <= N; j++) {
      const t = (j / N) * head, q = chainPointAt(i, t, tight, slide, C), d = Math.hypot(q.x - p.x, q.y - p.y)
      acc += d
      if (acc >= C.pitch) {
        acc -= C.pitch
        tiles.push({ x: q.x, y: q.y, rot: Math.atan2(q.y - p.y, q.x - p.x), s: 0.82 + 0.28 * q.z, front: q.z >= 0, op: 1 })
      }
      p = q
    }
    out.push(...tiles.reverse().map((c, n) => (k < 0 ? c : { ...c, x: c.x * (1 + 1.7 * k), y: c.y - 0.2 * k + 1.1 * k * k, rot: c.rot + ((n % 2 ? 1 : -1) * 3.2 * k), op: 1 - k * k })))
  }
  return out
}
// 足元で噴き上がる技（kind 'burst'・業火断罪）のあいだ（ms＝技を出しはじめてから）→ sceneAt と同じ形＋ tone・dimColor
//   構えで暗くなり手に光が集まる → 振り抜きの絵で手の光がはじける・少し光って揺れる → 当たった瞬間に大きく光って揺れ、相手の足元で火の粉・炎の筋・輪・煙
export const burstSceneAt = (m, ms, B = BURST, landed = true) => {
  const out = { dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null, tone: m.scene.tone || null, dimColor: m.scene.dimColor || null, wrapped: 0 }
  const H = m.hitMs, I = m.impactMs
  if (ms < 0 || ms >= sceneEndMsOf(m)) return out
  const e = ms - I, s = ms - H
  out.dim = ms < H ? B.dim * smooth((ms - 100) / Math.max(1, H - 100)) : e < B.after ? B.dim : B.dim * (1 - smooth((e - B.after) / B.fade))
  handFxAt(m, ms, out)
  out.flash = 0.3 * pulse(s, 180)
  let amp = 6 * pulse(s, 260)
  if (e >= 0) {
    out.flash = Math.max(out.flash, 0.6 * (e < 40 ? e / 40 : pulse(e - 40, 320)))
    amp += 9 * (1 - clamp01(e / 600)) ** 2
    // 火の粉が絶えず立ちのぼる・炎に巻かれて光る
    embersUp(out.items, 30, 19000, e, 1.05, 1.5, B.after)
    if (landed) out.wrapped = 1 - smooth((e - B.after) / B.fade)
    drops(out.items, B.splash, 16000, e, [0.7, 1.9], [500, 950], [0.006, 0.016], 0.42)
    jets(out.items, B.jets, 17000, e, 1.1)
    for (const [at, size] of B.rings) {
      const q = (e - at) / 650
      if (q < 0 || q >= 1) continue
      const rx = (0.12 + 0.95 * easeOut(q)) * size
      out.items.push({ t: 'ring', x: 0, y: -0.01, rx, ry: rx * 0.24, w: 0.022 * (1 - q) + 0.004, op: 0.85 * (1 - q) })
    }
    for (let i = 0; i < B.mist; i++) {
      const life = 1100 + 400 * rnd(i, 91), q = (e - 60 * i) / life
      if (q < 0 || q >= 1) continue
      const dir = i % 2 ? 1 : -1, v = easeOut(q)
      out.items.push({ t: 'mist', x: dir * (0.04 + (0.24 + 0.4 * rnd(i, 92)) * v), y: -0.04 - (0.1 + 0.4 * rnd(i, 93)) * v, r: 0.1 + (0.2 + 0.2 * rnd(i, 94)) * v, op: 0.65 * Math.min(1, q / 0.08) * (1 - q) })
    }
  }
  out.shake = [amp * Math.sin(ms * 0.11), amp * 0.65 * Math.cos(ms * 0.153)]
  return out
}

// ===== 大砲と剣の技（ゼルギアス）=====
// 【確定】2026-11-01 ユーザー「大技以外のモーションがすべてしょぼすぎる」「エフェクト細いし」「もっと派手に動いて」「銃で放つときのモーションもなんか安っぽい」：
//   kind 'gun'（雷鋼弾・雷霆掃射）：撃つ前に砲口へ光が集まる → 撃つたび砲口で閃光がはじけ（mflash）・衝撃の輪（mring）・火花（hdrop）・太い雷の筋が相手まで走り（tracer）、舞台が暗く光って揺れる。
//     当たるたび足元に輪と火花が広がる（相手が押されるのは全部のボスと同じ＝lib/atbFx.js の hitReactOf）
//   kind 'slash'（神雷崩撃）：振りかぶるあいだ暗くなり、空から雷が剣に落ちて（tracer の sky）剣先が光る → 突進の筋（speed）→ 当たると大きく光って揺れ、輪・火花・相手が縮む
//   外れても演出は同じ（2026-10-31 の決まり）。変わるのは相手の反応（squeeze）だけ
export const GUN = { chargeMs: 260, flashMs: 170, ringMs: 320, tail: 130, w: 0.11, dim: 0.34 }
export const SLASH = { dim: 0.5, hitDim: 0.62, after: 480, fade: 320, w: 0.16, rush: 14 }
const ONE_SHOT = [{ atMs: 0 }]
const sceneBase = (m) => ({ dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null, tone: m.scene?.tone || 'fire', dimColor: m.scene?.dimColor || null, beam: null })
// 稲妻の折れ線（画面の px）：(x0, y0) から (x1, y1) まで n 区間・amp＝横へのぶれの大きさ（両はしは小さく）。同じ seed なら同じ形
export const boltPathOf = (x0, y0, x1, y1, seed, n, amp) => {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, out = [[x0, y0]]
  for (let i = 1; i < n; i++) {
    const p = i / n, off = (rnd(seed, i) - 0.5) * 2 * amp * Math.sin(Math.PI * p) ** 0.7
    out.push([x0 + dx * p + nx * off, y0 + dy * p + ny * off])
  }
  out.push([x1, y1])
  return out
}
// 砲口の閃光の星形（中心からのずれ・px）：相手の方（aim＝ラジアン）のとげほど長い
export const flashStarOf = (r, aim, seed, n = 7) => Array.from({ length: n * 2 }, (_, i) => {
  const a = aim + (i * Math.PI) / n + (rnd(seed, i) - 0.5) * 0.3, front = Math.max(0, Math.cos(a - aim))
  const R = i % 2 ? r * (0.26 + 0.1 * rnd(seed, i + 20)) : r * (0.55 + 0.35 * rnd(seed, i + 40)) * (1 + 1.5 * front * front)
  return [Math.cos(a) * R, Math.sin(a) * R]
})
// 当たった所：足元の輪・はね上がる火花・吹き上がる光の筋。P＝強さ
const impactAt = (items, e, seed, P) => {
  drops(items, Math.round(34 * P), seed, e, [0.7, 1.9], [320, 620], [0.006, 0.016], 0.45)
  drops(items, Math.round(20 * P), seed + 500, e, [0.6, 1.5], [240, 480], [0.006, 0.014], 0.3, { oy: BODY_Y, around: true })
  jets(items, Math.round(10 * P), seed + 900, e, 1.1 * P)
  for (const [at, size] of [[0, 1], [90, 0.7]]) {
    const q = (e - at) / 420
    if (q < 0 || q >= 1) continue
    const rx = (0.1 + 0.85 * easeOut(q)) * size * P
    items.push({ t: 'ring', x: 0, y: -0.01, rx, ry: rx * 0.26, w: 0.034 * (1 - q) + 0.004, op: 0.95 * (1 - q) })
  }
}
// 大砲の技（ms＝技を出しはじめてから）→ sceneAt と同じ形
export const gunSceneAt = (m, ms, G = GUN) => {
  const out = sceneBase(m)
  if (ms < 0 || ms >= sceneEndMsOf(m)) return out
  const strikes = m.strikes || ONE_SHOT, first = m.hitMs + (m.shots[0].delayMs || 0), chargeMs = m.scene.chargeMs ?? G.chargeMs
  if (ms < first && ms >= first - chargeMs) {
    const k = (ms - first + chargeMs) / chargeMs
    motes(out.items, 16, ms, 0.95 * smooth(k * 3), 1, 0.85)
    out.hand = { r: 8 + 26 * k * k + 2 * Math.sin(ms / 30), op: smooth(k * 3) }
  }
  let amp = 0
  m.shots.forEach((sh, i) => {
    const P = sh.size ?? 1, at = m.hitMs + (sh.delayMs || 0), s = ms - at
    if (s < 0) return
    const st = strikes[i] || strikes[0], land = m.impactMs + (st.atMs || 0), e = ms - land, seed = 900 + i * 37
    if (s < G.flashMs) {
      const k = s / G.flashMs
      out.items.push({ t: 'mflash', space: 'hand', r: 120 * P * (0.7 + 0.6 * easeOut(k)), op: 1 - k * k, seed })
      out.hand = { r: 46 * P + 70 * P * easeOut(k), op: 1 - k }
    }
    for (const [ringAt, size] of [[0, 1], [70, 0.65]]) {
      const q = (s - ringAt) / G.ringMs
      if (q >= 0 && q < 1) out.items.push({ t: 'mring', space: 'hand', r: (22 + 130 * easeOut(q)) * size * P, w: (1 - q) * 13 * P + 1, op: (1 - q) * 0.95, off: 44 * easeOut(q) * P })
    }
    for (let j = 0; j < 14; j++) {
      const sd = seed + 200 + j, life = 170 + 120 * rnd(sd, 61)
      if (s >= life) continue
      const ang = Math.PI - 0.45 + (rnd(sd, 62) - 0.5) * 1.6, sp = 320 + 520 * rnd(sd, 63), t = s / 1000, r = 2.5 + 3 * rnd(sd, 64)
      const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp
      out.items.push({ t: 'hdrop', space: 'hand', hi: 0, x: vx * t, y: vy * t + 300 * t * t, rx: r * 2.6, ry: r, rot: (Math.atan2(vy + 600 * t, vx) * 180) / Math.PI, op: 1 - s / life })
    }
    // 太い雷の筋：砲口から相手へ、弾といっしょに伸びる。当たったあと tail で細く消える。形は少しずつ変わる
    const tail = e > 0 ? e / G.tail : 0
    if (tail < 1) out.items.push({ t: 'tracer', space: 'hand', x: st.dx || 0, y: BODY_Y + (st.dy || 0), k: flyPosOf(clamp01(s / Math.max(1, land - at))), w: G.w * P * (0.55 + 0.45 * easeOut(s / 60)) * (1 - 0.5 * tail),
      op: Math.min(1, s / 20) * (1 - tail), seed: seed + Math.floor(ms / 36) * 7, amp: 0.045, n: 8 })
    out.flash = Math.max(out.flash, 0.4 * P * pulse(s, 130))
    out.dim = Math.max(out.dim, G.dim * pulse(s, 320))
    amp += 8 * P * pulse(s, 230)
    if (e >= 0) {
      out.flash = Math.max(out.flash, 0.55 * P * pulse(e, 240))
      amp += 12 * P * pulse(e, 340)
      impactAt(out.items, e, 1200 + i * 71, P)
    }
  })
  out.shake = [amp * Math.sin(ms * 0.13), amp * 0.7 * Math.cos(ms * 0.17)]
  return out
}
// 剣の技（ms＝技を出しはじめてから）。scene.windMs＝振りかぶり終わる時刻（ここから突進）・boltsAt＝空から雷が剣に落ちる時刻
export const slashSceneAt = (m, ms, landed = true, D = SLASH) => {
  const out = sceneBase(m)
  if (ms < 0 || ms >= sceneEndMsOf(m)) return out
  const S = m.scene, I = m.impactMs, e = ms - I, W = S.windMs
  let amp = 0
  if (ms < I) {
    motes(out.items, 18, ms, 0.95 * smooth(ms / 140), 1, 1.2)
    out.hand = { r: 12 + 34 * clamp01(ms / W) + 3 * Math.sin(ms / 28), op: smooth(ms / 120) }
  }
  S.boltsAt.forEach((at, i) => {
    const q = (ms - at) / 150
    if (q < 0 || q >= 1) return
    out.items.push({ t: 'tracer', space: 'hand', sky: true, ox: i % 2 ? 0.5 : -0.5, k: 1, w: D.w * (1 - 0.5 * q), op: 1 - q * q, seed: 3000 + i * 11 + Math.floor(ms / 30) * 7, amp: 0.07, n: 9 })
    out.flash = Math.max(out.flash, 0.4 * (1 - q))
    amp += 5 * (1 - q)
  })
  // 突進のあいだの風の筋（相手のいる所から、元の場所のほうへ）
  if (ms >= W && ms < I) {
    const k = (ms - W) / (I - W)
    for (let i = 0; i < D.rush; i++) {
      const x0 = 0.2 + 2.4 * rnd(i, 92), len = 0.5 + 0.9 * rnd(i, 93)
      out.items.push({ t: 'speed', x1: x0 - 0.6 * k, x2: x0 - 0.6 * k + len, y: -0.05 - rnd(i, 91), w: 0.012 + 0.03 * rnd(i, 94), op: (0.35 + 0.4 * rnd(i, 95)) * Math.sin(Math.PI * k) })
    }
  }
  if (e >= 0) {
    out.flash = Math.max(out.flash, 0.95 * (e < 30 ? e / 30 : pulse(e - 30, 380)))
    amp += 18 * pulse(e, 620)
    if (landed) {
      const q = pulse(e, 260)
      out.squeeze = [1 + 0.1 * q, 1 - 0.16 * q]
    }
    impactAt(out.items, e, 2200, 1.6)
    impactAt(out.items, e - 130, 2600, 1.1)
  }
  out.dim = ms < I ? D.dim * smooth(ms / 240) : e < D.after ? D.hitDim : D.hitDim * (1 - smooth((e - D.after) / D.fade))
  out.shake = [amp * Math.sin(ms * 0.11), amp * 0.65 * Math.cos(ms * 0.153)]
  return out
}

// 画面ぜんたい：いま流れている技（acts＝[{ m, ms, after }]）と構え（cast＝{ m, ms }）を合わせる
//   暗さと光はいちばん強いもの・揺れは足す・描くものは並べる・雲と手は新しいほう（acts の after・landed は sceneAt と同じ）
//   相手の縮みはかけ合わせる
export const stageSceneOf = (acts, cast) => {
  const out = { dim: 0, flash: 0, shake: [0, 0], items: [], cloud: null, hand: null, squeeze: null, tone: null, dimColor: null, beam: null, wrapped: 0 }
  const add = (s) => {
    out.wrapped = Math.max(out.wrapped, s.wrapped || 0)
    if (s.tone && (s.dim > 0 || s.items.length || s.hand || s.beam)) { out.tone = s.tone; out.dimColor = s.dimColor }
    if (s.beam) out.beam = s.beam
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
