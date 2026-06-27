// ============================================================
// 戦争システムの戦闘計算（M1）
// ------------------------------------------------------------
// コア攻撃は「実効 攻撃力＋特攻」をもとにしたシンプルなダメージ（±10%乱数あり）。
//   power = eff.atk + eff.matk（装備/ペット/称号/熟練 込みの実効値）
//   raw   = floor(power × WAR_CORE_DMG_MULT × 乱数)   ← サーバ送信用の生ダメ
// 攻撃と特攻を両方足すので、物理型・魔法型・両刀型のいずれも公平に評価される。
// ※サーバ(war_attack_core)がこの生ダメージをさらに90%軽減して敵コアへ適用する。
//   （10ターン戦闘シミュ方式は出血等のDoTがコアの巨大HPで膨張するため廃止）
// ============================================================

export const WAR_CORE_HP = 300000        // サーバ war_tick と一致（表示用）
export const WAR_CORE_REDUCTION = 0.9    // サーバ war_attack_core が適用（表示用）
// 全体スケールの最終つまみ。(攻撃力+特攻) に掛ける。サーバ側でさらに×0.1(90%軽減)。
// 較正(2026-06-28): 実測 power=6,619 → 6,619×7.55×0.1 ≒ 約5,000/発(目標)。
//   実効スケール = WAR_CORE_DMG_MULT × 0.1。CD20秒・コアHP30万で単独約20分。
export const WAR_CORE_DMG_MULT = 7.55

// コア攻撃（M1）。実効「攻撃力＋特攻」から ±10% の乱数込みでダメージを算出。
//  loadout: loadLoadout の戻り（自分の eff/equipment/skillSets 等）。
//  戻り: { raw=サーバ送信用の生ダメ(90%軽減前)・atk・matk・power=atk+matk }
export function simulateCoreAttack(loadout) {
  if (!loadout?.eff) return { raw: 1, atk: 0, matk: 0, power: 0 }
  const atk = Math.max(0, Math.floor(loadout.eff.atk || 0))
  const matk = Math.max(0, Math.floor(loadout.eff.matk || 0))
  const power = atk + matk
  const variance = 0.9 + Math.random() * 0.2  // ±10%（他の戦闘と同方針）
  const raw = Math.max(1, Math.floor(power * WAR_CORE_DMG_MULT * variance))
  return { raw, atk, matk, power }
}
