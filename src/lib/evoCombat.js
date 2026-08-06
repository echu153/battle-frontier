// ============================================================
// ボス装備 真化トリガー効果（複数の戦闘エンジン共通ヘルパー）
//  - eff.* フラグは stats.js calcEffectiveStats が公開（進化装備未所持なら全て0/false/1）
//  - Game.jsx の出撃ループと同じ挙動を Abyss/Tenkyuu/PvP/Raid でも再現するため共通化
//  - 発動ログは出さない（2026-07-14仕様: 勝手に発動・表示なし）。装備の出所もログに書かない。
//    ただし反射だけは敵HPが動くため、出所を伏せて事象のみログに残す（logs引数を使用）
// ============================================================

// 天空⑧ 真化スタック効果の初期化。eff は戦闘ごとに calcEffectiveStats で新規生成されるので
//  スタック値・基準値を eff に直接保持してよい（戦闘をまたいで漏れない）。
const initEvoStacks = (eff) => {
  if (!eff || eff._evoStackInit) return
  eff._evoStackInit = true
  eff._critDmgBase = eff.critDmg || 0   // 天砲: クリ威力の基準（指輪の固有クリ威力等を含む）
  eff._atkBase  = eff.atk  || 0         // 指輪: 攻撃の基準
  eff._matkBase = eff.matk || 0         // 指輪: 特攻の基準
  eff._tenpaStack  = 0                  // ウラノスの天砲: クリ威力+5%×最大4
  eff._ringStack   = 0                  // 蒼天龍の指輪: 攻/特攻+1%×最大15
  eff._seigaiStack = 0                  // 覇龍の聖鎧: 被ダメ軽減+1%×最大10
}

// プレイヤーの攻撃が敵にヒットした時：敵に状態異常を付与＋自己スタック蓄積（enemyBuffs/eff を破壊的に更新）
//  isCrit = そのヒットがクリティカルだったか（指輪の発動判定に使用）
export const evoOnHit = (eff, dmg, enemyBuffs, _enemyName, _logs, isCrit = false) => {
  if (!eff || dmg <= 0) return
  if (enemyBuffs) {
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
  // 天空⑧ ウラノスの天砲（真化）: 攻撃ヒット時 クリ威力+5%（最大4重複）。eff.critDmg に畳み込む＝各エンジンのクリ式が自動反映。
  if (eff.evoHitCritDmg) {
    initEvoStacks(eff)
    if (eff._tenpaStack < 4) { eff._tenpaStack++; eff.critDmg = eff._critDmgBase + eff._tenpaStack * 0.05 }
  }
  // 天空⑧ 蒼天龍の指輪（真化）: クリティカル時 攻撃・特攻+1%（最大15重複）。eff.atk/matk を基準×倍率で更新。
  if (eff.evoCritAtkMatk && isCrit) {
    initEvoStacks(eff)
    if (eff._ringStack < 15) {
      eff._ringStack++
      eff.atk  = Math.round(eff._atkBase  * (1 + eff._ringStack * 0.01))
      eff.matk = Math.round(eff._matkBase * (1 + eff._ringStack * 0.01))
    }
  }
}

// プレイヤーが被ダメージした時：反撃の状態異常付与＋反射。反射ダメージ量を返す（敵HPに反映するのは呼び出し側）。
export const evoOnDamaged = (eff, dmg, enemyBuffs, enemyName, logs) => {
  let reflect = 0
  if (!eff || dmg <= 0) return reflect
  if ((eff.evoReflectPct||0) > 0) {
    reflect = Math.max(1, Math.floor(dmg * eff.evoReflectPct / 100))
    // 敵HPが理由なく減って見えないよう事象だけ残す（出所＝真化かどうかは書かない）
    if (logs) logs.push({ text:`🛡 反射！ ${enemyName}に${reflect}ダメージ！`, color:'#66ccff' })
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

// ============================================================
// アクアクラウン（真化）: 状態異常になる確率 -eff.evoAilmentResist%
//  哭雨の羽衣(ailmentShieldBlocks) / 紋章耐性(emblemBlocksAilment) と同じ列に並べて使う。
//  ※以前は出撃(Game.jsx)にべた書きで、奈落/八獄/タワー/天穹/レイド/対人戦では効いていなかった。
//    新しい戦闘エンジンを足したら必ずこの2つを通すこと（test/equipEffectCoverage.test.js が検査）。
// ============================================================
const EVO_AIL_KEYS = ['paralysis', 'burn', 'poison', 'severePoisoin', 'stun', 'bleed', 'healSeal', 'curseDmg']

// 直接付与サイト用: 付与しようとしている状態異常1件を確率で無効化（trueで付与を止める）
//  ログは出さない（装備の出所を書かない方針）。付与が起きないだけなので画面上の数値は動かない。
//  _logs は各エンジンの呼び出しの字面を変えないために残す（未使用）。
export const evoBlocksAilment = (eff, _ailKey, _logs) => {
  const pct = eff?.evoAilmentResist || 0
  return pct > 0 && Math.random() * 100 < pct
}

// 差分検知型: 敵スキル解決後、新規付与された状態異常を1つ確率で無効化（curBuffs を破壊的に更新）
//  ログは出さない（装備の出所を書かない方針）。_logs は呼び出しの字面を変えないために残す（未使用）。
export const evoResistNewAilments = (eff, prevBuffs, curBuffs, _logs) => {
  if (!((eff?.evoAilmentResist || 0) > 0) || !curBuffs) return
  const got = EVO_AIL_KEYS.find(k => curBuffs[k] && !prevBuffs?.[k])
  if (got && Math.random() * 100 < eff.evoAilmentResist) delete curBuffs[got]
}

// プレイヤーが回避した時：自分に素早さバフ（playerBuffs を破壊的に更新）
export const evoOnEvade = (eff, playerBuffs, _logs) => {
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

// 被ダメージ%軽減倍率（海竜の鱗=全体-5% / 蒼粘剣=物理-10% / 冥府王の獄衣=全体-5%かつ瀕死で-10%
//  / 天空⑧ 覇龍の聖鎧=被ダメ毎に-1%累積・最大-10%）
//  ※聖鎧のスタックは「今回の被弾に現スタックを適用→その後+1」。被弾ごとに1回呼ばれる前提（各エンジンの
//    被ダメ計算箇所で1回。多段攻撃は1発ごとに加算）。
export const evoTakenMult = (eff, isPhysical, hpRatio = 1) => {
  const base = (eff?.evoDmgTakenMult || 1) * (isPhysical ? (eff?.evoPhysDmgTakenMult || 1) : 1) * gokuiTakenMult(eff, hpRatio)
  if (!eff?.evoDmgReduceStack) return base
  initEvoStacks(eff)
  const mult = base * (1 - eff._seigaiStack * 0.01)
  if (eff._seigaiStack < 10) eff._seigaiStack++
  return mult
}

// 全アクティブスキルスロット(5枠)を埋めているか
export const evoAllSkillsSet = (activeSkillSets) =>
  (activeSkillSets || []).filter(ss => ss?.skills && ss.skills.type !== 'パッシブ').length >= 5

// 全スキルセット時の攻撃/特攻倍率（深紅の牙輪/魔眼石）
export const evoAtkMult  = (eff, allSet) => (allSet && (eff?.evoAllskillAtk||0)  > 0) ? 1 + eff.evoAllskillAtk/100  : 1
export const evoMatkMult = (eff, allSet) => (allSet && (eff?.evoAllskillMatk||0) > 0) ? 1 + eff.evoAllskillMatk/100 : 1
