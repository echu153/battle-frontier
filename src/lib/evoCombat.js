// ============================================================
// ボス装備 真化トリガー効果（複数の戦闘エンジン共通ヘルパー）
//  - eff.* フラグは stats.js calcEffectiveStats が公開（進化装備未所持なら全て0/false/1）
//  - Game.jsx の出撃ループと同じ挙動を Abyss/Tenkyuu/PvP/Raid でも再現するため共通化
//  - 発動ログは出さない（2026-07-14仕様変更: 勝手に発動・表示なし。logs引数は互換のため残置）
// ============================================================

// プレイヤーの攻撃が敵にヒットした時：敵に状態異常を付与（enemyBuffs を破壊的に更新）
export const evoOnHit = (eff, dmg, enemyBuffs, enemyName, logs) => {
  if (!eff || dmg <= 0 || !enemyBuffs) return
  if (eff.evoHitSpdDown && !(enemyBuffs.spdDown?.turns > 0 && enemyBuffs.spdDown.rate <= 0.9)) {
    enemyBuffs.spdDown = { turns: 2, rate: 0.9 }
  }
  if ((eff.evoHitBleed||0) > 0 && Math.random()*100 < eff.evoHitBleed) {
    enemyBuffs.bleed = { stacks: Math.min(5, (enemyBuffs.bleed?.stacks||0)+1), lastTurn: 0 }
  }
  if ((eff.evoHitStun||0) > 0 && !(enemyBuffs.stun?.turns > 0) && Math.random()*100 < eff.evoHitStun) {
    enemyBuffs.stun = { turns: 1 }
  }
  // 冥獄宝珠・断罪（レイド装備）: 攻撃ヒット時 eff.hitPoisonChance% で毒。毒の数値は毒矢と同じ（4T・敵HPの3%/T）
  if ((eff.hitPoisonChance||0) > 0 && !(enemyBuffs.poison?.turns > 0) && Math.random()*100 < eff.hitPoisonChance) {
    enemyBuffs.poison = { turns: 4, dmgRate: 0.03 }
  }
}

// プレイヤーが被ダメージした時：反撃の状態異常付与＋反射。反射ダメージ量を返す（敵HPに反映するのは呼び出し側）。
export const evoOnDamaged = (eff, dmg, enemyBuffs, enemyName, logs) => {
  let reflect = 0
  if (!eff || dmg <= 0) return reflect
  if ((eff.evoReflectPct||0) > 0) {
    reflect = Math.max(1, Math.floor(dmg * eff.evoReflectPct / 100))
  }
  if (enemyBuffs) {
    if ((eff.evoOndmgStun||0) > 0 && !(enemyBuffs.stun?.turns > 0) && Math.random()*100 < eff.evoOndmgStun) {
      enemyBuffs.stun = { turns: 1 }
    }
    if ((eff.evoOndmgBurn||0) > 0 && !(enemyBuffs.burn?.turns > 0) && Math.random()*100 < eff.evoOndmgBurn) {
      enemyBuffs.burn = { turns: 5, dmgRate: 0.02 }
    }
  }
  return reflect
}

// プレイヤーが回避した時：自分に素早さバフ（playerBuffs を破壊的に更新）
export const evoOnEvade = (eff, playerBuffs, logs) => {
  if (!eff || !playerBuffs) return
  if (eff.evoEvadeSpdUp && !(playerBuffs.spdUp?.turns > 0 && playerBuffs.spdUp.rate >= 1.1)) {
    playerBuffs.spdUp = { turns: 2, rate: 1.1 }
  }
}

// 冥府王の獄衣: 被ダメージ-5%。HPが半分以下なら軽減率が2倍(-10%)になる。
//  hpRatio = 被弾時点の playerHp / hp_max。呼び出し側が渡さない場合は全快扱い（=通常の軽減率）。
const gokuiTakenMult = (eff, hpRatio) => {
  const pct = eff?.gokuiTakenPct || 0
  if (pct <= 0) return 1
  return 1 - (pct * ((hpRatio ?? 1) <= 0.5 ? 2 : 1)) / 100
}

// 被ダメージ%軽減倍率（海竜の鱗=全体-5% / 蒼粘剣=物理-10% / 冥府王の獄衣=全体-5%かつ瀕死で-10%）
export const evoTakenMult = (eff, isPhysical, hpRatio = 1) =>
  (eff?.evoDmgTakenMult || 1) * (isPhysical ? (eff?.evoPhysDmgTakenMult || 1) : 1) * gokuiTakenMult(eff, hpRatio)

// 全アクティブスキルスロット(5枠)を埋めているか
export const evoAllSkillsSet = (activeSkillSets) =>
  (activeSkillSets || []).filter(ss => ss?.skills && ss.skills.type !== 'パッシブ').length >= 5

// 全スキルセット時の攻撃/特攻倍率（深紅の牙輪/魔眼石）
export const evoAtkMult  = (eff, allSet) => (allSet && (eff?.evoAllskillAtk||0)  > 0) ? 1 + eff.evoAllskillAtk/100  : 1
export const evoMatkMult = (eff, allSet) => (allSet && (eff?.evoAllskillMatk||0) > 0) ? 1 + eff.evoAllskillMatk/100 : 1
