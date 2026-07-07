// 召喚系パッシブの共通ロジック（全戦闘エンジンで使用）
//  ・式神召喚（式神使い）：毎ターン、特殊攻撃力×0.5(再修練1で0.8)の式神ダメージ。エンティティ無し
//  ・ペット召喚（ブリーダー）：選択ペットをステ×2・HP×5で召喚。毎ターン×1.0自動攻撃／敵は50%でペットを狙う／
//    撃破後はプレイヤーのみ対象／再修練1で種族別の攻撃時追加効果（出血/素早さ低下/スタン）
//  ※出撃(Game.jsx)の実装を忠実に共通化したもの。敵HPの適用は呼び出し側（レイド=totalDamage / 奈落・天穹=enemy.hp）。
import { petStats } from '../constants/pets'

// 召喚状態を構築。profile.class / passiveNames から判定
export function buildSummon(profile, passiveNames, activePet) {
  const hasShiki = Array.isArray(passiveNames) && passiveNames.includes('式神召喚')
  let pet = null
  const ap = activePet || profile?.activePet
  if (profile?.class === 'ブリーダー' && Array.isArray(passiveNames) && passiveNames.includes('ペット召喚') && ap?.species) {
    const ps = petStats(ap)
    pet = {
      active: true, hp: ps.maxHp * 5, maxHp: ps.maxHp * 5,
      atk: ps.atk * 2, def: ps.def * 2, mdef: ps.mdef * 2,
      atkType: ps.atkType, species: ap.species,
      buffs: { reduce: 0, reduceTurns: 0 },
    }
  }
  return { pet, hasShiki }
}

export function summonAnnounce(s, logs) {
  if (s?.pet?.active) logs.push({ text: `🐾 ペットを召喚！（HP${s.pet.maxHp}）`, color: '#ffcc66' })
}

// ターン開始時の召喚攻撃（式神＋ペット自動攻撃）。敵へ与える合計ダメージを返す（呼び出し側が敵HP/totalDamageへ反映）
//  enemy: { def, mdef, atk, matk, type('magical'で特殊), name, evasionRate(0-100) }
//  enemyBuffs: 敵の被デバフ（species効果の書き込み先。無いエンジンは {} を渡す）
//  playerBuffs: breederDmgUp を参照（無ければ 1.0）
export function summonAttackDamage(s, enemy, enemyBuffs, playerBuffs, eff, rtCur, logs) {
  let dealt = 0
  const eb = enemyBuffs || {}
  // 式神召喚
  if (s?.hasShiki) {
    const shikiMult = rtCur >= 1 ? 0.8 : 0.5
    const eMdefR = (eb.mdefDown?.rate || 1) * (eb.mdefUp?.rate || 1)
    const adjEMD = Math.max(1, Math.floor((enemy.mdef || 0) * eMdefR))
    const matk = eff?.matk || 0
    const d = Math.max(1, Math.floor(matk * shikiMult * (matk / (matk + adjEMD)) * (0.9 + Math.random() * 0.2)))
    dealt += d
    logs.push({ text: `👹 式神の攻撃！ ${enemy.name}に${d}の特殊ダメージ！`, color: '#cc88ff' })
  }
  // ペット召喚 自動攻撃（×1.0）
  const pet = s?.pet
  if (pet?.active && pet.hp > 0) {
    const baseEv = Math.max(0, enemy.evasionRate || 0)
    if (baseEv > 0 && Math.random() * 100 < baseEv) {
      logs.push({ text: `🐾 ペットのこうげき！ しかし${enemy.name}に回避された！`, color: '#446688' })
    } else {
      const isSpec = pet.atkType === 'spec'
      const edr = (eb.defDown?.rate || 1) * (eb.defUp?.rate || 1)
      const emr = (eb.mdefDown?.rate || 1) * (eb.mdefUp?.rate || 1)
      const adjDef = Math.max(1, Math.floor(isSpec ? (enemy.mdef || 0) * emr : (enemy.def || 0) * edr))
      const base = pet.atk * 1.0
      const dmgUp = playerBuffs?.breederDmgUp?.turns > 0 ? playerBuffs.breederDmgUp.rate : 1.0
      const d = Math.max(1, Math.floor(base * (base / (base + adjDef)) * dmgUp * (0.9 + Math.random() * 0.2)))
      dealt += d
      let extra = ''
      if (rtCur >= 1) {
        if (pet.species === 'flame' && Math.random() * 100 < 30) { const b = eb.bleed; eb.bleed = { stacks: Math.min(5, (b?.stacks || 0) + 1), lastTurn: 0 }; extra = ` ${enemy.name}は出血した！` }
        else if (pet.species === 'aqua' && Math.random() * 100 < 40) { eb.spdDown = { turns: 3, rate: 0.7 }; extra = ' 素早さ低下！' }
        else if (pet.species === 'leaf') { const sr = eb.stunResist ?? 1.0; if (Math.random() * 100 < 30 * sr) { eb.stun = { turns: 1 }; eb.stunResist = sr * 0.5; extra = ' スタン！' } }
      }
      logs.push({ text: `🐾 ペットのこうげき！ ${enemy.name}に${d}ダメージ！${extra}`, color: '#ffaa44' })
    }
  }
  return dealt
}

// 敵の通常攻撃を50%でペットが受ける。受けたら true（呼び出し側はプレイヤーへのダメージを飛ばす）
//  enemy: { atk, matk, type }, enemyBuffs: { atkUp, matkUp }
export function summonAbsorbBasic(s, enemy, enemyBuffs, turn, logs) {
  const pet = s?.pet
  if (!(pet?.active && pet.hp > 0) || Math.random() >= 0.5) return false
  const eb = enemyBuffs || {}
  const isEM = enemy.type === 'magical'
  const eAtk = isEM ? (enemy.matk || 0) * (eb.matkUp?.rate || 1) : (enemy.atk || 0) * (eb.atkUp?.rate || 1)
  const petDefVal = Math.max(1, isEM ? pet.mdef : pet.def)
  const baseDmg = Math.max(1, Math.floor(eAtk * eAtk / Math.max(1, eAtk + petDefVal)))
  const cut = pet.buffs.reduceTurns > 0 ? (1 - pet.buffs.reduce) : 1.0
  const dmg = Math.max(1, Math.floor(baseDmg * cut * (0.9 + Math.random() * 0.2)))
  pet.hp = Math.max(0, pet.hp - dmg)
  logs.push({ text: `${turn}ターン目: ${enemy.name}はペットを攻撃！ ペットに${dmg}ダメージ！（残りHP${pet.hp}）`, color: '#ff8844' })
  if (pet.hp <= 0) logs.push({ text: `💥 ペットは倒れてしまった…`, color: '#ff4444' })
  return true
}

// 敵スキル等のダメージを50%でペットが受ける（既算出dmgをそのまま・cutのみ適用）。受けたら true
export function summonAbsorbSkill(s, dmg, logs) {
  const pet = s?.pet
  if (!(pet?.active && pet.hp > 0) || dmg <= 0 || Math.random() >= 0.5) return false
  const cut = pet.buffs.reduceTurns > 0 ? (1 - pet.buffs.reduce) : 1.0
  const d = Math.max(1, Math.floor(dmg * cut))
  pet.hp = Math.max(0, pet.hp - d)
  logs.push({ text: `↳ 攻撃はペットに！ ペットに${d}ダメージ！（残りHP${pet.hp}）`, color: '#ff8844' })
  if (pet.hp <= 0) logs.push({ text: `💥 ペットは倒れてしまった…`, color: '#ff4444' })
  return true
}

export function summonEndOfTurn(s) {
  if (s?.pet?.buffs?.reduceTurns > 0) s.pet.buffs.reduceTurns--
}
