// ============================================================
// 「レベルキャップあり」版（v2cap）— タカラモチ（日替わりクエストの宝箱の魔物）の待機の動き（純関数）
// ------------------------------------------------------------
// 【確定】2026-11-07 ユーザー「タカラモチの待機モーション欲しい」→ 選んだ3つ（どれも推奨）：
//   ・ふたの開け閉め：息をするようにゆっくり少し閉じて戻る（ふたを押し上げる右手もいっしょ）
//   ・金貨の腕とコイントス：金貨をつまんだ腕がゆらゆら揺れ、ときどき指で金貨をはじいて、くるくる回して受け止める
//   ・目と口の光・まばたき：光る目と笑い口がゆっくり脈打ち、ときどきまばたきする（閉じた目は光る細い線）
//   部品と切る位置は lib/cofferArt.js の COFFER_CUTS、描くのは components/V2capCofferParts.jsx。殴られたときに傾く動き（wobble）はそのまま
//   ★戦闘の時計（ミリ秒）だけで決まる（同じ時刻なら同じ形・乱数を使わない）
// ============================================================

export const COFFER_LID_MS = 3600        // ふたの1往復
export const COFFER_LID_SQ = 0.05        // いちばん閉じたときの縦の縮み（ちょうつがいの高さへ）
export const COFFER_ARM_MS = 2800        // 腕のゆらゆらの1往復
export const COFFER_ARM_DEG = 1.4        // 腕のゆらゆらの大きさ（度・＋で手が上がる）
export const COFFER_COIN_TWIRL = 5       // 指先の金貨のゆらぎ（度）
export const COFFER_TOSS_AT = 2400       // 最初のコイントス（戦闘の始めから）
export const COFFER_TOSS_EVERY = 7000    // コイントスの間隔
export const COFFER_TOSS_MS = 1300       // コイントス1回の長さ
export const COFFER_TOSS_UP = 0.11       // 金貨が飛ぶ高さ（立ち絵の枠の高さに対する割合・0.13 ではいちばん上でふたの角に重なった）
export const COFFER_TOSS_TURNS = 3       // 飛んでいるあいだに回る数
export const COFFER_BLINK_EVERY = 3800   // まばたきの間隔（だいたい・毎回少しずれる）
// コイントスの中の時刻（ミリ秒）：ため→はじく→飛ぶ→受け止める→戻る
export const TOSS = { dip: 200, flick: 300, launch: 260, land: 960, settle: 1080 }

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const smooth = (a, b, t) => { const u = clamp01((t - a) / (b - a)); return u * u * (3 - 2 * u) }
const easeOut = (u) => 1 - (1 - u) * (1 - u)
const lerp = (a, b, u) => a + (b - a) * u
// 決まった数からの 0〜1（まばたきのずれ）
const hash01 = (n) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296 }

// いちばん近いコイントスの中の時刻（始まる前は負・前のトスのあとは TOSS_MS より大きい）
export const tossClockOf = (t) => {
  if (t < COFFER_TOSS_AT - COFFER_TOSS_EVERY / 2) return t - COFFER_TOSS_AT
  const n = Math.round((t - COFFER_TOSS_AT - COFFER_TOSS_MS / 2) / COFFER_TOSS_EVERY)
  return t - (COFFER_TOSS_AT + Math.max(0, n) * COFFER_TOSS_EVERY)
}
// コイントスの腕の角度（度）：沈めてためる→はじき上げる→ゆるむ→受け止めて沈む→戻る
const tossArmOf = (d) => {
  if (d <= 0 || d >= COFFER_TOSS_MS) return 0
  if (d < TOSS.dip) return lerp(0, -3, smooth(0, TOSS.dip, d))
  if (d < TOSS.flick) return lerp(-3, 4.5, easeOut((d - TOSS.dip) / (TOSS.flick - TOSS.dip)))
  if (d < TOSS.land) return lerp(4.5, 0.5, smooth(TOSS.flick, TOSS.land, d))
  if (d < TOSS.settle) return lerp(0.5, -2.2, easeOut((d - TOSS.land) / (TOSS.settle - TOSS.land)))
  return lerp(-2.2, 0, smooth(TOSS.settle, COFFER_TOSS_MS, d))
}
// まばたきの閉じ具合（0＝開いている・1＝閉じている）：90ms で閉じ、少し止めて、150ms で開く
const blinkShape = (o) => (o < 0 ? 0 : o < 90 ? smooth(0, 90, o) : o < 150 ? 1 : o < 300 ? 1 - smooth(150, 300, o) : 0)
export const blinkOf = (t) => {
  const c = Math.floor(t / COFFER_BLINK_EVERY)
  let k = 0
  for (const cc of [c - 1, c]) {
    const o = t - cc * COFFER_BLINK_EVERY - (600 + hash01(cc + 1) * 1400)
    k = Math.max(k, blinkShape(o))
    if (hash01(cc + 77) < 0.3) k = Math.max(k, blinkShape(o - 330))   // ときどき2回つづけて
  }
  return k
}

// t＝戦闘の時計（ミリ秒）。返す形：
//   lid＝ふたの縦の倍率（1＝絵のまま・小さいほど閉じる）／arm＝左腕の角度（度）／
//   coin＝{ dy＝枠の高さに対する上下（負で上）, sx＝横の倍率（回って見える）, rot＝傾き（度）}／glint＝{ op, s }＝金貨のきらめき／
//   glow＝目と口の光を足す濃さ／blink＝まばたきの閉じ具合
export const cofferIdleAt = (t) => {
  const d = tossClockOf(t)
  // コイントスのあいだはゆらゆらを止める（前後 150ms でなめらかに）
  const env = smooth(-150, 0, d) * (1 - smooth(COFFER_TOSS_MS, COFFER_TOSS_MS + 150, d))
  const lid = 1 - COFFER_LID_SQ * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / COFFER_LID_MS))
  const arm = COFFER_ARM_DEG * Math.sin(2 * Math.PI * t / COFFER_ARM_MS) * (1 - env) + tossArmOf(d)
  // 金貨：はじいたら放物線で上がって落ちる・横に縮んで回って見える（受け止めたら元の向き）
  const u = d > TOSS.launch && d < TOSS.land ? (d - TOSS.launch) / (TOSS.land - TOSS.launch) : null
  const coin = u === null
    ? { dy: 0, sx: 1, rot: COFFER_COIN_TWIRL * Math.sin(2 * Math.PI * t / 2100) * (1 - env) }
    : { dy: -COFFER_TOSS_UP * 4 * u * (1 - u), sx: Math.cos(2 * Math.PI * COFFER_TOSS_TURNS * u), rot: 0 }
  // きらめき：ふだんはゆっくりまたたく。はじく直前に消え、受け止めた瞬間にぱっと光る
  const tw = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 1400)
  let glint = { op: 0.7 + 0.3 * tw, s: 0.85 + 0.25 * tw }
  if (d > 220 && d < TOSS.land) glint = { op: glint.op * (1 - smooth(220, TOSS.launch + 20, d)), s: glint.s }
  else if (d >= TOSS.land && d < TOSS.land + 600) {
    const e = Math.exp(-(d - TOSS.land) / 140)
    glint = { op: lerp(glint.op, 1, e), s: glint.s + 0.9 * e }
  }
  // 目と口の光：ゆっくり脈打つ・コイントスのあいだは少し強く（楽しそう）
  const glow = 0.15 + 0.3 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / 2400)) + 0.25 * env
  // まばたき：コイントスのあいだはしない（金貨を見ている）
  const blink = blinkOf(t) * (1 - env)
  return { lid, arm, coin, glint, glow, blink }
}
