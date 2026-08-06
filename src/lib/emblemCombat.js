// ============================================================
// 紋章の戦闘時効果 共通ヘルパー（evoCombat.js と同じ方針）
// 全戦闘エンジン（出撃/レイド/奈落/天穹/八獄/PvP系）から呼ぶ。
// eff.emblem が無い（結晶未割り振り）場合はすべて無効果で素通しする。
// ============================================================

// 与ダメージ倍率（物理/特殊）。isPhys=true なら物理ダメージUPを適用。
export const emblemDmgMult = (eff, isPhys) => {
  const em = eff?.emblem
  if (!em) return 1
  const pct = isPhys ? (em.physDmg || 0) : (em.specialDmg || 0)
  return pct > 0 ? 1 + pct / 100 : 1
}

// 与ダメ吸収（物理吸収/特殊吸収）。与えたダメージ×吸収%ぶんHP回復。
// 戻り値: 回復量（0なら効果なし）。呼び出し側で playerHp へ加算する。
export const emblemDrainAmount = (eff, dmg, isPhys) => {
  const em = eff?.emblem
  if (!em || dmg <= 0) return 0
  const pct = isPhys ? (em.physDrain || 0) : (em.specialDrain || 0)
  if (pct <= 0) return 0
  return Math.floor(dmg * pct / 100)
}

// 敵への状態異常ダメージ倍率（出血/やけど/毒・猛毒のDoT tick に乗算）
// key: 'bleed' | 'burn' | 'poison'（猛毒も poison を使う）
export const emblemDotMult = (eff, key) => {
  const em = eff?.emblem
  if (!em) return 1
  const pct = em.dotUp?.[key] || 0
  return pct > 0 ? 1 + pct / 100 : 1
}

// 個別状態異常耐性: 敵の行動後、プレイヤーに「新規付与」された状態異常を
// 確率で無効化する（哭雨の羽衣 consumeAilmentShield と同じ差分検知方式）。
// prevBuffs=敵行動前の playerBuffs スナップショット / curBuffs=行動後（直接書き換える）
const EMBLEM_RES_KEYS = {
  poison: 'poison', severePoisoin: 'poison',  // 猛毒も毒耐性で判定
  paralysis: 'paralysis', burn: 'burn', bleed: 'bleed', stun: 'stun',
}
// 直接付与サイト用: 付与しようとしている状態異常1件を確率で無効化（trueで付与を止める）
// 例: if (!ailmentShieldBlocks(...) && !emblemBlocksAilment(eff, 'stun', logs)) playerBuffs.stun = ...
// 発動ログは出さない（紋章という出所を書かない方針。付与が起きないだけで画面の数値は動かない）。
// _logs は各エンジンの呼び出しの字面を変えないために残す（未使用）。
export const emblemBlocksAilment = (eff, ailKey, _logs) => {
  const em = eff?.emblem
  if (!em) return false
  const resKey = EMBLEM_RES_KEYS[ailKey]
  const pct = (resKey && em.ailRes?.[resKey]) || 0
  return pct > 0 && Math.random() * 100 < pct
}

// こちらも発動ログは出さない（_logs は未使用）。
export const emblemResistNewAilments = (eff, prevBuffs, curBuffs, _logs) => {
  const em = eff?.emblem
  if (!em || !curBuffs) return
  for (const [ailKey, resKey] of Object.entries(EMBLEM_RES_KEYS)) {
    if (!curBuffs[ailKey]) continue
    if (prevBuffs && prevBuffs[ailKey]) continue  // 既存の異常（新規付与ではない）
    const pct = em.ailRes?.[resKey] || 0
    if (pct > 0 && Math.random() * 100 < pct) delete curBuffs[ailKey]
  }
}
