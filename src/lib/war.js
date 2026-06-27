// ============================================================
// 戦争システムの戦闘計算（M1）
// ------------------------------------------------------------
// ※M1はコア戦の数値感とパイプライン検証が目的。複雑なPvPエンジン(pvp.js)には
//   依存せず、実効攻撃力ベースでコア攻撃の生ダメージを「概算」する安定実装。
//   厳密なスキル計算（持続HP/相互戦闘）はM2の戦争エンジンで差し替える。
// ============================================================
import { getWeaponGroup } from './stats'

// 戦争用ダメージ圧縮（軽め）。レイドの compressRaidDmg と同型だが
// PIVOT高め・指数大きめ＝圧縮を弱める＝「弱者は少し底上げ／強者は緩やかに頭打ち／戦力差は概ね保持」。
// 戦力差が大きければ弱者は基本勝てない、というユーザー方針に合わせた初期値（要バランス調整）。
export const WAR_DMG_PIVOT = 8000
export const WAR_DMG_EXP = 0.7
export function compressWarDmg(d) {
  if (d <= 0) return 0
  return Math.max(1, Math.floor(WAR_DMG_PIVOT * Math.pow(d / WAR_DMG_PIVOT, WAR_DMG_EXP)))
}

export const WAR_CORE_HP = 300000        // サーバ war_tick と一致（表示用・要調整）
export const WAR_CORE_REDUCTION = 0.9    // サーバ war_attack_core が適用（表示用）
export const WAR_CORE_TURNS = 10         // コア戦ターン数（概算係数の根拠）

// コア攻撃の生ダメージ概算（M1）。
//  eff/equipment: loadLoadout の戻り（実効ステ＋装備）。
//  戻り値はサーバ war_attack_core に渡す「圧縮済み・90%軽減前」の生ダメージ。
//  ※10ターン × 平均スキル倍率(約1.5)相当を実効攻撃力から概算。M2で厳密版に差し替え。
export function estimateCoreDamageRaw(eff, equipment) {
  if (!eff) return 1
  const weaponItem = (equipment || []).find(e => e.slot === 'weapon' && e.equipped)
  const wtype = weaponItem?.weapons?.weapon_type || 'sword'
  const isMagical = getWeaponGroup(wtype) === 'magical'
  const off = isMagical ? (eff.matk || 0) : (eff.atk || 0)
  const rawOutput = off * WAR_CORE_TURNS * 1.5
  return compressWarDmg(rawOutput)
}
