// ============================================================
// バトルフロンティアⅡ（リメイク版）— モンスター図鑑
// ------------------------------------------------------------
// ★図鑑は**倒した敵・拾った素材だけ**が見える（2026-08-26 ユーザー指示）。
//   まだのものは名前も中身も ??? のまま。
//
// ★討伐数は**サーバーが数える**（v2_kills）。クライアントの申告は
//   v2_sortie_settle が v2_enemies と突き合わせて弾く＝盛れない。
// ============================================================

export const UNKNOWN = '???'

// ===== 討伐数によるステータス上昇 =====
// ⚠**値はまだ決まっていない**（2026-08-26 ユーザー「※後で設定」）。
//   ここに段を足すだけで効くようにしてある。足すときは：
//     ・KILL_TIERS に { n:必要な討伐数, pct:上がる割合 } を**討伐数の小さい順**で並べる
//     ・サーバー側（v2_profiles の再計算）にも同じ表を置くこと。片方だけ直すと表示と実値がズレる
//   例： [{ n:10, pct:1 }, { n:50, pct:2 }, { n:100, pct:3 }]
export const KILL_TIERS = []

// その敵を n 体倒したときに乗る割合(%)。段を越えるたびに置き換わる（積み上げではない）
export const killBonusPct = (n = 0) => {
  let pct = 0
  for (const t of KILL_TIERS) if (n >= t.n) pct = t.pct
  return pct
}

// 次の段まであと何体か。段が無い／全部越えていれば null
export const nextKillTier = (n = 0) => KILL_TIERS.find(t => n < t.n) || null

// 図鑑がどれだけ埋まったか
export const dexProgress = (names, kills) => {
  const done = names.filter(name => (kills[name] || 0) > 0).length
  return { done, total: names.length, pct: names.length ? Math.round(done / names.length * 100) : 0 }
}

// 討伐数の一覧（サーバーの行）を名前→数の形にする
export const killMapOf = (rows) =>
  Object.fromEntries((rows || []).map(r => [r.enemy, r.n]))

// 見つけた素材のidの集合
export const foundSetOf = (rows) => new Set((rows || []).map(r => r.material_id))
