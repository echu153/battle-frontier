// ============================================================
// ステータス計算 共通モジュール
// Game.jsx / Profile.jsx / Ranking.jsx で共通利用
// （表示と実効果のロジックズレを防ぐため一元管理）
// ============================================================

export const WEAPON_TYPE_GROUP = {
  sword:'physical', axe:'physical', spear:'physical', bow:'physical', dagger:'physical',
  knuckle:'physical', gun:'physical', katana:'physical',
  staff:'magical', wand:'magical', tome:'magical', orb:'magical',
}
export const getWeaponGroup = (weaponType) => WEAPON_TYPE_GROUP[weaponType] || 'physical'

export const ARTIFACT_BASE_NAMES_SET = new Set([
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたオーブ'
])

// 熟練度ボーナス：武器の固定ボーナス各種に倍率をかける
// 倍率 = LV×1% + floor(LV/100)×50%（LV300で+450%）
// 対象：atk/def/matk/mdef/spd/hp/mp の固定ボーナスのみ（%ボーナスは対象外）
export const calcProfBonus = (prof, weapon) => {
  if (!prof || !weapon) return {}
  const profLv = prof.prof_lv || 0
  const rate = profLv * 0.01 + Math.floor(profLv/100) * 0.5
  if (rate <= 0) return {}
  const result = {}
  const atk  = Math.floor((weapon.atk_bonus ||0) * rate); if (atk  > 0) result.atk  = atk
  const def  = Math.floor((weapon.def_bonus ||0) * rate); if (def  > 0) result.def  = def
  const matk = Math.floor((weapon.matk_bonus||0) * rate); if (matk > 0) result.matk = matk
  const mdef = Math.floor((weapon.mdef_bonus||0) * rate); if (mdef > 0) result.mdef = mdef
  const spd  = Math.floor((weapon.spd_bonus ||0) * rate); if (spd  > 0) result.spd  = spd
  const hp   = Math.floor((weapon.hp_bonus  ||0) * rate); if (hp   > 0) result.hp   = hp
  const mp   = Math.floor((weapon.mp_bonus  ||0) * rate); if (mp   > 0) result.mp   = mp
  return result
}

// 装備＋熟練度込みの実効ステータス
export const calcEffectiveStats = (profile, equipment, proficiency) => {
  const bonus = { atk:0, def:0, matk:0, mdef:0, spd:0, hp:0, mp:0 }
  let matkPct = 0
  let hitBonus = 0
  let critBonus = 0
  let evasionBonus = 0
  let critResist = 0
  for (const item of equipment) {
    if (!item.equipped || !item.weapons) continue
    const w = item.weapons
    const plus = item.enhance_plus || 0
    const isArtifactBase = ARTIFACT_BASE_NAMES_SET.has(w.name)
    const mult = (plus > 0 && !isArtifactBase) ? Math.pow(1.5, plus) : 1
    bonus.atk  += Math.ceil((w.atk_bonus||0)  * mult) + (item.bonus_atk||0)
    bonus.def  += Math.ceil((w.def_bonus||0)  * mult) + (item.bonus_def||0)
    bonus.matk += Math.ceil((w.matk_bonus||0) * mult) + (item.bonus_matk||0)
    bonus.mdef += Math.ceil((w.mdef_bonus||0) * mult) + (item.bonus_mdef||0)
    bonus.spd  += Math.ceil((w.spd_bonus||0)  * mult) + (item.bonus_spd||0)
    bonus.hp   += Math.ceil((w.hp_bonus||0)   * mult) + (item.bonus_hp||0)
    bonus.mp   += Math.ceil((w.mp_bonus||0)   * mult) + (item.bonus_mp||0)
    if (w.hp_bonus_pct > 0)  bonus.hp  += Math.floor(profile.hp_max * w.hp_bonus_pct/100)
    if (w.mp_bonus_pct > 0)  bonus.mp  += Math.floor(profile.mp_max * w.mp_bonus_pct/100)
    if (w.spd_bonus_pct > 0) bonus.spd += Math.floor(profile.spd   * w.spd_bonus_pct/100)
    if (w.matk_bonus_pct > 0) matkPct  += w.matk_bonus_pct
    if (w.hit_bonus > 0) hitBonus += w.hit_bonus
    critBonus   += w.crit_bonus  || 0   // 武器固有クリティカル率
    critResist  += w.crit_resist || 0   // 武器固有クリティカル抵抗
    hitBonus    += item.bonus_hit     || 0
    critBonus   += item.bonus_crit    || 0
    evasionBonus += item.bonus_evasion || 0
    if (item.slot === 'weapon') {
      const prof = proficiency.find(p => p.equipment_id === item.id)
      if (prof) {
        const pb = calcProfBonus(prof, w)
        bonus.atk  += pb.atk  || 0
        bonus.def  += pb.def  || 0
        bonus.matk += pb.matk || 0
        bonus.mdef += pb.mdef || 0
        bonus.spd  += pb.spd  || 0
        bonus.hp   += pb.hp   || 0
        bonus.mp   += pb.mp   || 0
      }
    }
  }
  const baseMatk = profile.matk + bonus.matk
  const finalMatk = matkPct > 0 ? Math.floor(baseMatk * (1 + matkPct/100)) : baseMatk
  return {
    atk:    profile.atk  + bonus.atk,
    def:    profile.def  + bonus.def,
    matk:   finalMatk,
    mdef:   profile.mdef + bonus.mdef,
    spd:    profile.spd  + bonus.spd,
    hp_max: profile.hp_max + bonus.hp,
    mp_max: profile.mp_max + bonus.mp,
    bonus,
    hitBonus,
    critBonus,
    evasionBonus,
    critResist,
  }
}

export const calcTotal = (p) => Math.floor((p.hp_max/10)+(p.mp_max/5)+p.atk+p.def+p.matk+p.mdef+p.spd)

export const getTotalRank = (total) => {
  const thresholds = [200,500,1000,2000,4000,7000,11000,16000]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (total <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank:'SSS', color:'#ffcc00' }
}

// 装備＋熟練度込みの総合力
export const calcEffectiveTotal = (profile, equipment, proficiency) =>
  calcTotal(calcEffectiveStats(profile, equipment, proficiency))
