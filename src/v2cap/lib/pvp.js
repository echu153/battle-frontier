// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 対人戦の決まり（塔・あとで作る紛争地帯で共通）
// ------------------------------------------------------------
// 【確定】2026-10-14 ユーザー決定（docs/v2cap-design.md §10）：対人戦は **8〜10ターンで決着** させる。
//   やり方は **対人だけHPを増やす**（出撃・ボス戦はそのまま）。測った倍率：LV25 ×3.5・LV50 ×5・LV80以上 ×6（初期職どうし）
//   いまは対人が2〜4ターン（装備にHPが付かないので、LVが上がるほど攻撃だけ伸びて短くなる）＝技・バフ・回復が活きない
// こちらで決めた既定（2026-10-14 塔を作るとき）：
//   ・LVの間は線でつなぐ（LV25より下は×3.5・LV80より上は×6）
//   ・2人のLVが違うときは、**高いほうのLVの倍率を2人とも**に掛ける（同じ倍率で戦う）
// ⚠一次職を入れたら測り直す（設計書 §10）。毒などを倍率の前のHPで数える・クリティカルの扱いは、まだ決めていない
// ============================================================

// [LV, 倍率] の並び（LVの小さい順）
export const PVP_HP_POINTS = [[25, 3.5], [50, 5], [80, 6]]

// そのLVの対人のHP倍率（小数2桁）
export const pvpHpMultOf = (lv) => {
  const x = Math.max(1, Math.floor(Number(lv) || 1))
  const pts = PVP_HP_POINTS
  if (x <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    const [l1, m1] = pts[i]
    if (x <= l1) {
      const [l0, m0] = pts[i - 1]
      return Math.round((m0 + (m1 - m0) * (x - l0) / (l1 - l0)) * 100) / 100
    }
  }
  return pts[pts.length - 1][1]
}

// 2人のLVから、2人とも同じに掛ける倍率（高いほうのLVで決める）
export const pvpHpMultFor = (lvA, lvB) => pvpHpMultOf(Math.max(Number(lvA) || 1, Number(lvB) || 1))

// 戦闘用のキャラのHPに倍率を掛けたもの（ほかのステはそのまま）
export const withPvpHp = (fighter, mult) => ({
  ...fighter,
  stats: { ...fighter.stats, hp: Math.max(1, Math.round((fighter.stats?.hp || 0) * mult)) },
})
