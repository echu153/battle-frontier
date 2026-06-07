import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { getWeaponGroup } from '../lib/stats'
import {
  WAIT_SECONDS,
  calcEffectiveStats,
  calcEvasionRate,
  calcExtraActionRate,
  calcCritRate,
  calcDefReduction,
  applyEquipmentEffects,
  executeSkill,
  executeEnemySkill,
  extractStatuses,
  BattleLogLine,
} from './Game'
import { ABYSS_FLOOR_COUNT, ABYSS_DEFINED_FLOORS, getAbyssFloor } from '../lib/abyss'

const STONE_NAME = (r) => `強化石(${r})`
const fmt = (n) => Number(n).toLocaleString()

const GEM_RANK_COLOR = {
  F:'#888888', E:'#6699cc', D:'#ff8844', C:'#44bb44', B:'#4488ff',
  A:'#ff4444', S:'#ffcc00', SS:'#ffcc00', SSS:'#ffcc00',
}

// ============================================================
// 奈落闘技場 戦闘シミュレーション（完全PvE）
// Game.jsx の doBattle のロジックを忠実に移植したもの。
// 街の通常出撃には手を入れず、奈落専用に複製している（RaidBoss.jsx と同じ方針）。
// 相違点：
//  ・常にフルHP/MPから開始する「決闘」形式（敗北しても再挑戦できるよう街のHPは消費しない）
//  ・パピア/ボス遭遇/エリアドロップ/EXP/Gold の概念なし（報酬はサーバRPCで付与）
//  ・ポーションは消費せず効果のみ適用（再挑戦のたびに失わないように）
// 戻り値: { logs, win }
// ============================================================
function simulateAbyssBattle(eff, equipment, skillSets, profile, enemy, playerItem) {
  const logs = []
  let playerHp = profile.hp_max
  let playerMp = profile.mp_max
  let enemyHp = enemy.hp
  const enemyMaxHp = enemy.hp
  let turn = 1, skillIndex = 0
  let playerBuffs = {}, enemyBuffs = {}
  let currentItem = playerItem ? { ...playerItem } : null
  let itemUsed = false
  let prevSkillName = null
  let bossHealCooldown = 0
  let bossSpecialUsed = false
  let bossBuff1Used = false
  let bossBuff2Used = false
  let bossHeal1Used = false
  let bossHeal2Used = false
  let playerAttacking = false

  const equippedWeaponItem = equipment.find(e => e.slot === 'weapon' && e.equipped)
  const isArtifact = equippedWeaponItem?.bonus_effect === 'artifact'

  const passiveNames = skillSets.filter(ss => ss.skills?.type === 'パッシブ').map(ss => ss.skills.name)
  const hasShingan    = passiveNames.includes('心眼')
  const hasBerserk    = passiveNames.includes('バーサク')
  const hasTakaNoMe   = passiveNames.includes('鷹ノ目')
  const hasKakushin   = passiveNames.includes('執行本能')
  const hasShinkoka   = passiveNames.includes('神聖加護')
  const hasTenki      = passiveNames.includes('天啓')
  const hasRokkan     = passiveNames.includes('第六感')
  const hasSeimitsu   = passiveNames.includes('精密照準')
  const hasTosoHonno  = passiveNames.includes('闘争本能')
  const hasOnmi       = passiveNames.includes('隠身')

  const rtCur = (profile.retraining || {})[profile.class] || 0
  const pe = (cls) => profile.class === cls && rtCur >= 3

  const passiveCritBonus    = hasShingan ? 5 : 0
  const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.2 : 0
  const passiveDmgMult      = (hasShingan ? (pe('侍')?1.10:1.05) : 1.0) * (hasBerserk ? (pe('狂戦士')?1.20:1.15) : 1.0) * (hasKakushin ? (pe('異端審問官')?1.15:1.1) : 1.0) * (hasRokkan ? (pe('サイキッカー')?1.10:1.05) : 1.0)
  const passiveHealMult     = (hasShinkoka ? (pe('聖職者')?1.4:1.2) : 1.0) * (hasKakushin ? 0.7 : 1.0)
  const passiveMatkMult     = hasShinkoka ? 1.1 : 1.0
  const passiveMpCostMult   = hasTenki ? 0.9 : 1.0
  const passiveMatkMultTenki = hasTenki ? (pe('賢者')?1.3:1.1) : 1.0
  const passiveHitBonus     = (hasRokkan ? 5 : 0) + (hasSeimitsu ? 5 : 0) + ((hasTakaNoMe && pe('狩人')) ? 10 : 0)
  const passiveHealReflect  = (hasShinkoka && pe('聖職者'))
  const hasGambleBody       = passiveNames.includes('ギャンブルボディ')
  const hasMadokenJutsu     = passiveNames.includes('魔導剣術')
  const hasHolyKnightPassive= passiveNames.includes('聖騎士の心得')

  logs.push({ text:`⚔ ${enemy.name}が立ちはだかった！`, color:'#ff6644' })

  playerBuffs = applyEquipmentEffects(equipment, profile, playerBuffs, logs)

  const effectiveSpdForCalc = hasTakaNoMe ? Math.floor(eff.spd * 1.2) : eff.spd
  const weaponType = equippedWeaponItem?.weapons?.weapon_type || 'sword'
  const isMagical = getWeaponGroup(weaponType) === 'magical'
  const expandedSkillSet = []
  for (const ss of skillSets) {
    if (ss.skills?.type === 'パッシブ') continue
    const count = ss.use_count || 1
    for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
  }

  const playerSpd = effectiveSpdForCalc
  const enemySpd = enemy.spd || 5
  const playerExtraRate = calcExtraActionRate(playerSpd, enemySpd)
  const enemyExtraRate  = calcExtraActionRate(enemySpd, playerSpd)
  const playerCritRate  = calcCritRate(playerSpd, enemySpd) + passiveCritBonus + (eff.critBonus || 0)
  const enemyCritRate   = Math.max(0, calcCritRate(enemySpd, playerSpd) - (eff.critResist || 0) - (playerBuffs.critResist?.turns > 0 ? (playerBuffs.critResist.value || 0) : 0))
  const enemyEvasionRate  = calcEvasionRate(enemySpd, effectiveSpdForCalc)
  const playerHitBonus = (eff.hitBonus || 0) + passiveHitBonus

  const doPlayerAttack = (isExtra = false) => {
    playerAttacking = true
    const holyFieldDef = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
    const holyKnightMult = hasHolyKnightPassive ? (pe('聖騎士')?1.3:1.2) : 1.0
    const kabeDefP = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 1.2 : 1.0
    const pDef   = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1) * holyFieldDef * holyKnightMult * kabeDefP
    const pMdef  = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * holyFieldDef * holyKnightMult * kabeDefP
    const burnDebuffP = playerBuffs.burn?.turns > 0 ? 0.9 : 1.0
    const madokenBonus = hasMadokenJutsu ? Math.floor(eff.matk * (pe('魔法剣士')?0.6:0.3)) : 0
    const pMatk  = (eff.matk - madokenBonus) * (playerBuffs.matkUp ? playerBuffs.matkUp.rate : 1) * passiveMatkMult * passiveMatkMultTenki * burnDebuffP
    const pAtk   = (eff.atk + madokenBonus)  * (playerBuffs.atkUp  ? playerBuffs.atkUp.rate  : 1) * (playerBuffs.atkDown ? playerBuffs.atkDown.rate : 1) * burnDebuffP
    const paralysisSpdP = playerBuffs.paralysis?.turns > 0 ? (playerBuffs.paralysis.spdRate || 0.8) : 1.0
    const pSpd   = effectiveSpdForCalc * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1) * paralysisSpdP
    const effBuff = { ...eff, atk:pAtk, def:pDef, mdef:pMdef, matk:pMatk, spd:pSpd }
    const eDefRate  = (enemyBuffs.defDown  ? enemyBuffs.defDown.rate  : 1) * (enemyBuffs.defUp  ? enemyBuffs.defUp.rate  : 1) * (1 - (eff.defPen || 0))
    const eMdefRate = (enemyBuffs.mdefDown ? enemyBuffs.mdefDown.rate : 1) * (enemyBuffs.mdefUp ? enemyBuffs.mdefUp.rate : 1) * (1 - (eff.mdefPen || 0))
    const prefix = isExtra ? `${profile.username} の追加攻撃！ ` : `${turn}ターン目: ${profile.username} の`
    const isCrit = Math.random()*100 < playerCritRate
    const critMult = isCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0

    const buffHitBonus = playerBuffs.hitBonus?.turns > 0 ? playerBuffs.hitBonus.value : 0
    const peekIdx = playerBuffs.berserk?.turns > 0 && playerBuffs.berserk.lockedSkill
      ? expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
      : (skillIndex % (expandedSkillSet.length || 1))
    const nextSkillName = expandedSkillSet.length > 0 ? expandedSkillSet[Math.max(0, peekIdx)]?.skills?.name : null
    const isSureHit = nextSkillName === '絶影狙撃'
    const skillExtraHit = (nextSkillName === '連装銃撃' && profile.class === '魔銃士' && rtCur >= 2) ? 10 : 0
    const effectiveEnemyEvasion = isSureHit ? 0 : Math.max(0, enemyEvasionRate - playerHitBonus - buffHitBonus - skillExtraHit)
    if (effectiveEnemyEvasion > 0 && Math.random()*100 < effectiveEnemyEvasion) {
      logs.push({ text:`${prefix}攻撃！ しかし${enemy.name}に回避された！`, color:'#446688' })
      if (expandedSkillSet.length > 0) skillIndex++
      return
    }

    if (playerBuffs.berserk?.turns > 0 && playerBuffs.berserk.lockedSkill) {
      const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
      if (lockedIdx >= 0) skillIndex = lockedIdx
    }
    let skillUsed = false
    if (expandedSkillSet.length > 0) {
      const cs = expandedSkillSet[skillIndex % expandedSkillSet.length]
      let mpCost = Math.floor((isArtifact ? (cs?.skills?.mp_cost||0)*2 : (cs?.skills?.mp_cost||0)) * passiveMpCostMult)
      if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(playerMp * 0.1))
      if (cs && cs.skills && playerMp >= mpCost) {
        playerMp -= mpCost
        const hasGensoKyomei = passiveNames.includes('元素共鳴')
        const gensoMult = (hasGensoKyomei && prevSkillName && prevSkillName !== cs.skills.name) ? (pe('元素使い')?1.25:1.15) : 1.0
        const seimitsuMult = (hasSeimitsu && pe('魔銃士') && prevSkillName && prevSkillName === cs.skills.name) ? 1.1 : 1.0
        prevSkillName = cs.skills.name
        const res = executeSkill(cs.skills, {...effBuff, lastMpCost:mpCost}, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
        const finalCrit = res.dmg > 0 && (isCrit || (res.bonusCritRate > 0 && Math.random()*100 < playerCritRate + res.bonusCritRate))
        const finalCritMult = finalCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
        const tosoMult = (hasTosoHonno && playerHp <= profile.hp_max * 0.5) ? (pe('体術師')?1.25:1.1) : 1.0
        let defScale = 1.0
        if (res.dmg > 0) {
          const sType = cs.skills?.type
          const adjED  = Math.max(1, Math.floor((enemy.def ||0)*eDefRate))
          const adjEMD = Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate))
          if (cs.skills?.name === 'サイコブラスト' || res.useMinDef) {
            defScale = effBuff.matk / (effBuff.matk + Math.min(adjED, adjEMD))
          } else if (sType === '物理攻撃') defScale = effBuff.atk  / (effBuff.atk  + adjED)
          else if (sType === '魔法攻撃') defScale = effBuff.matk / (effBuff.matk + adjEMD)
        }
        const allinDebuffOutMult = playerBuffs.allinDebuff?.turns > 0 ? 0.7 : 1.0
        const enemyDmgReduceMult = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
        let finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * enemyDmgReduceMult * (0.9 + Math.random() * 0.2))
        const resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
        if (res.selfDmg > 0) playerHp = Math.max(0, playerHp - res.selfDmg)
        enemyHp -= finalDmg
        if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
          enemyBuffs.healDown = { turns: 2, rate: 0.9 }
          logs.push({ text: `🗡 ヴァルブレイカーの効果！ ${enemy.name}の回復力が2ターンの間-10%！`, color: '#ff8844' })
        }
        const healAmt = playerBuffs.healSeal?.turns > 0 ? 0 : Math.floor(res.heal * passiveHealMult)
        playerHp = Math.min(profile.hp_max, playerHp + healAmt)
        if (passiveHealReflect && healAmt > 0) {
          const reflectDmg = Math.floor(healAmt * 0.5)
          enemyHp -= reflectDmg
          logs.push({ text:`✨ 神聖加護の反射！ ${enemy.name}に${reflectDmg}ダメージ！`, color:'#ffdd44' })
        }
        if (playerBuffs.spellBladeSealed?.turns > 0) {
          const blockedKeys2 = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune','holyField','holyAwakening','flashCombo','spellBladeExhaust']
          const hadBuff2 = blockedKeys2.some(k => res.newPlayerBuffs[k] !== playerBuffs[k] && res.newPlayerBuffs[k] !== undefined)
          for (const k of blockedKeys2) { if (res.newPlayerBuffs[k] !== playerBuffs[k]) res.newPlayerBuffs[k] = playerBuffs[k] }
          if (hadBuff2) logs.push({ text:`⚔ 魔剣開放の反動中！ バフが効かない！`, color:'#ff4444' })
        }
        if (playerBuffs.allinDebuff?.turns > 0) {
          const blockedKeys = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune']
          const hadBuff = blockedKeys.some(k => res.newPlayerBuffs[k] !== playerBuffs[k] && res.newPlayerBuffs[k] !== undefined)
          for (const k of blockedKeys) { if (res.newPlayerBuffs[k] !== playerBuffs[k]) res.newPlayerBuffs[k] = playerBuffs[k] }
          if (hadBuff) logs.push({ text:`💸 オールインの反動中！ バフが効かない！`, color:'#ff4444' })
        }
        playerBuffs = res.newPlayerBuffs; enemyBuffs = res.newEnemyBuffs
        const critInsert = finalCrit ? '💥クリティカル！ ' : ''
        const dmgIdx = resLog.indexOf(enemy.name + 'に')
        const logWithCrit = critInsert
          ? (dmgIdx >= 0 ? resLog.slice(0, dmgIdx) + critInsert + resLog.slice(dmgIdx) : resLog + ' ' + critInsert)
          : resLog
        logs.push({ text:`${prefix}${logWithCrit}`, color:finalCrit?'#ffff00':'#88ccff' })
        if (playerAttacking && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(profile.hp_max * 0.2))
          playerHp = Math.min(profile.hp_max, playerHp + rageCure)
          logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
        }
        if (playerBuffs.holyAwakening?.turns > 0 && finalDmg > 0) {
          const holyBonusDmg = Math.floor((pDef * playerBuffs.holyAwakening.defMult + pMdef * playerBuffs.holyAwakening.defMult))
          enemyHp -= holyBonusDmg
          logs.push({ text:`✨ 神聖覚醒の追加ダメージ！ ${enemy.name}に${holyBonusDmg}ダメージ！`, color:'#ffeeaa' })
          if (enemyHp <= 0) { skillIndex++; return }
        }
        skillUsed = true; skillIndex++
      }
    }
    if (!skillUsed) {
      const baseAtk = isMagical ? effBuff.matk : effBuff.atk
      const eDefVal = isMagical ? Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate)) : Math.max(1, Math.floor(enemy.def*eDefRate))
      const baseDmg = Math.max(1, Math.floor(baseAtk*baseAtk/Math.max(1,baseAtk+eDefVal))+Math.floor(Math.random()*4))
      const enemyDmgReduceMult2 = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
      let finalDmg = Math.floor(baseDmg*0.7*critMult*(isArtifact?1.2:1.0)*passiveDmgMult*enemyDmgReduceMult2*(0.9+Math.random()*0.2))
      enemyHp -= finalDmg
      if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
        enemyBuffs.healDown = { turns: 2, rate: 0.9 }
        logs.push({ text: `🗡 ヴァルブレイカーの効果！ ${enemy.name}の回復力が2ターンの間-10%！`, color: '#ff8844' })
      }
      const critText = isCrit ? '💥クリティカル！ ' : ''
      logs.push({ text:`${prefix}${critText}攻撃！ ${enemy.name}に${finalDmg}ダメージ！`, color:'#ffcc00' })
      if (playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
        const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(profile.hp_max * 0.2))
        playerHp = Math.min(profile.hp_max, playerHp + rageCure)
        logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
      }
      if (expandedSkillSet.length > 0) skillIndex++
    }
    playerAttacking = false
  }

  const doEnemyAttack = (isExtra = false) => {
    const holyFieldDefE = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
    const holyKnightMultE = hasHolyKnightPassive ? (pe('聖騎士')?1.3:1.2) : 1.0
    const kabeDefE = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 1.2 : 1.0
    const pDef  = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1) * holyFieldDefE * holyKnightMultE * kabeDefE
    const pMdef = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1) * holyFieldDefE * holyKnightMultE * kabeDefE
    const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
    const berserkDmgRate = hasBerserk ? 1.1 : 1.0
    const isEM = enemy.type === 'magical'
    const burnDebuffE = enemyBuffs.burn?.turns > 0 ? 0.9 : 1.0
    const eAtk = isEM
      ? (enemy.matk||0) * (enemyBuffs.matkUp ? enemyBuffs.matkUp.rate : 1) * burnDebuffE
      : enemy.atk * (enemyBuffs.atkUp ? enemyBuffs.atkUp.rate : 1) * burnDebuffE
    const isCrit = Math.random()*100 < enemyCritRate
    const defForCalc = isEM ? Math.max(1, pMdef) : Math.max(1, pDef)
    const baseDmg = Math.max(1, Math.floor(eAtk*eAtk/Math.max(1,eAtk+defForCalc))+Math.floor(Math.random()*3))
    const enemySpdBuff = enemyBuffs.spdUp ? enemyBuffs.spdUp.rate : 1
    const playerSpdDebuff = playerBuffs.spdDown ? playerBuffs.spdDown.rate : 1
    const effectivePlayerSpd = effectiveSpdForCalc * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1) * playerSpdDebuff
    const effectiveEnemySpd = enemySpd * enemySpdBuff
    const evasionRate = calcEvasionRate(effectivePlayerSpd, effectiveEnemySpd) + (eff.evasionBonus || 0) + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0) + (hasOnmi ? 5 : 0)
    if (evasionRate > 0 && Math.random()*100 < evasionRate) {
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
      logs.push({ text:`${prefix}${enemy.name}の攻撃！ しかし回避した！`, color:'#44ff88' })
      return
    }
    const enemyDmgDownRate = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
    const playerDefRankReduction = calcDefReduction(isEM ? eff.mdef : eff.def)
    const gambleBodyMult = hasGambleBody ? (0.7 + Math.random() * (pe('ギャンブラー')?0.4:0.6)) : 1.0
    const allinDebuffInMult = playerBuffs.allinDebuff?.turns > 0 ? 1.3 : 1.0
    const finalDmg = Math.floor(baseDmg*(isCrit?1.5:1.0)*dmgReduceRate*berserkDmgRate*enemyDmgDownRate*(1-playerDefRankReduction)*gambleBodyMult*allinDebuffInMult*(0.9+Math.random()*0.2))
    playerHp -= finalDmg
    if (playerBuffs.dmgReduce?.isGainoKabe) playerBuffs.dmgReduce = null
    const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
    const critText = isCrit ? ' 💥クリティカル！' : ''
    logs.push({ text:`${prefix}${enemy.name}の攻撃！ あなたに${finalDmg}ダメージ…${critText}`, color:isCrit?'#ff2200':'#ff6644' })
  }

  const doEnemySkillAttack = () => {
    if (!enemy.skills || enemy.skills.length === 0) return
    const healSkill = enemy.skills.find(s => s.type === 'heal')
    if (healSkill) {
      const hpRate = enemyHp / enemyMaxHp
      if (!bossHeal2Used && hpRate <= 0.3) {
        bossHeal1Used = true; bossHeal2Used = true
        const result = executeEnemySkill(healSkill, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
        enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
        Object.assign(enemyBuffs, result.newEnemyBuffs)
        return
      } else if (!bossHeal1Used && hpRate <= 0.6) {
        bossHeal1Used = true
        const result = executeEnemySkill(healSkill, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
        enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
        Object.assign(enemyBuffs, result.newEnemyBuffs)
        return
      }
    }
    if (enemy.specialMove && !bossSpecialUsed && enemyHp / enemyMaxHp <= 0.1) {
      bossSpecialUsed = true
      logs.push({ text:`💥 ${enemy.name}の「${enemy.specialMove.name}」！！`, color:'#ff0000' })
      const result = executeEnemySkill(enemy.specialMove, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
      playerHp -= result.dmgToPlayer
      Object.assign(playerBuffs, result.newPlayerBuffs)
      return
    }
    const buffSkills = enemy.skills.filter(s => s.type === 'buff')
    if (buffSkills.length > 0) {
      const hpRate = enemyHp / enemyMaxHp
      if (!bossBuff2Used && hpRate <= 0.3) {
        bossBuff1Used = true; bossBuff2Used = true
        const buffSkill = buffSkills[buffSkills.length > 1 ? 1 : 0]
        logs.push({ text:`⚡ ${enemy.name}の「${buffSkill.name}」！`, color:'#ff8844' })
        const result = executeEnemySkill(buffSkill, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
        playerHp -= result.dmgToPlayer
        Object.assign(playerBuffs, result.newPlayerBuffs)
        Object.assign(enemyBuffs, result.newEnemyBuffs)
        return
      } else if (!bossBuff1Used && hpRate <= 0.7) {
        bossBuff1Used = true
        const buffSkill = buffSkills[0]
        logs.push({ text:`⚡ ${enemy.name}の「${buffSkill.name}」！`, color:'#ff8844' })
        const result = executeEnemySkill(buffSkill, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
        playerHp -= result.dmgToPlayer
        Object.assign(playerBuffs, result.newPlayerBuffs)
        Object.assign(enemyBuffs, result.newEnemyBuffs)
        return
      }
    }
    const nonHealSkills = enemy.skills.filter(s => s.type !== 'heal' && s.type !== 'buff')
    if (nonHealSkills.length === 0) return
    const skill = nonHealSkills[Math.floor(Math.random()*nonHealSkills.length)]
    const result = executeEnemySkill(skill, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
    playerHp -= result.dmgToPlayer
    enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
    Object.assign(playerBuffs, result.newPlayerBuffs)
    Object.assign(enemyBuffs, result.newEnemyBuffs)
  }

  while (playerHp > 0 && enemyHp > 0 && turn <= 50) {
    if (passiveNames.includes('骸の壁') && (turn === 1 || turn % 5 === 0)) {
      playerBuffs.dmgReduce = { turns:999, rate:0.7, isGainoKabe:true }
      logs.push({ text:`💀 骸の壁発動！ 次に攻撃を受けるまで被ダメ-30%！`, color:'#cc44ff' })
    }
    // 敵への持続ダメージ
    if (enemyBuffs.severePoisoin?.turns > 0) {
      const spDmg = Math.floor(enemyMaxHp * 0.05); enemyHp -= spDmg
      logs.push({ text:`🤢 猛毒ダメージ！ ${enemy.name}に${spDmg}ダメージ！`, color:'#aa44ff' })
      if (enemyHp <= 0) break
    }
    if (enemyBuffs.burn?.turns > 0) {
      const burnDmg = Math.floor(enemyMaxHp * 0.02); enemyHp -= burnDmg
      logs.push({ text:`🔥 やけどダメージ！ ${enemy.name}に${burnDmg}ダメージ！`, color:'#ff6622' })
      if (enemyHp <= 0) break
    }
    if (enemyBuffs.curseDmg?.turns > 0) {
      enemyHp -= enemyBuffs.curseDmg.dmg
      logs.push({ text:`💀 呪縛ダメージ！ ${enemy.name}に${enemyBuffs.curseDmg.dmg}ダメージ！`, color:'#cc44ff' })
      if (enemyHp <= 0) break
    }
    if (enemyBuffs.regen?.turns > 0) {
      const regenAmt = Math.floor(enemyMaxHp * enemyBuffs.regen.rate)
      enemyHp = Math.min(enemyMaxHp, enemyHp + regenAmt)
      logs.push({ text:`💚 ${enemy.name}のリジェネ！ HPが${regenAmt}回復した！`, color:'#44ff88' })
    }
    if (enemyBuffs.poison?.turns > 0) {
      const poisonDmg = Math.floor(enemy.hp * enemyBuffs.poison.dmgRate); enemyHp -= poisonDmg
      logs.push({ text:`☠ 毒ダメージ！ ${enemy.name}に${poisonDmg}ダメージ！`, color:'#44ff44' })
      if (enemyHp <= 0) break
    }
    // プレイヤーへの持続ダメージ
    if (playerBuffs.severePoisoin?.turns > 0) {
      const spDmgP = Math.floor(profile.hp_max * 0.05); playerHp = Math.max(0, playerHp - spDmgP)
      logs.push({ text:`🤢 猛毒ダメージ！ あなたに${spDmgP}ダメージ！`, color:'#aa44ff' })
      if (playerHp <= 0) break
    }
    if (playerBuffs.burn?.turns > 0) {
      const burnDmgP = Math.floor(profile.hp_max * 0.02); playerHp = Math.max(0, playerHp - burnDmgP)
      logs.push({ text:`🔥 やけどダメージ！ あなたに${burnDmgP}ダメージ！`, color:'#ff6622' })
      if (playerHp <= 0) break
    }
    if (playerBuffs.bleed) {
      const bleedDmgP = Math.floor(profile.hp_max * 0.01 * playerBuffs.bleed.stacks); playerHp = Math.max(0, playerHp - bleedDmgP)
      logs.push({ text:`🩸 出血ダメージ！ あなたに${bleedDmgP}ダメージ（${playerBuffs.bleed.stacks}スタック）！`, color:'#ff4466' })
      if (playerHp <= 0) break
      playerBuffs.bleed.lastTurn = (playerBuffs.bleed.lastTurn || 0) + 1
      if (playerBuffs.bleed.lastTurn >= 3) delete playerBuffs.bleed
    }
    if (playerBuffs.skeletonDmg?.turns > 0) {
      enemyHp -= playerBuffs.skeletonDmg.dmg
      logs.push({ text:`💀 骸骨の持続ダメージ！ ${enemy.name}に${playerBuffs.skeletonDmg.dmg}ダメージ！`, color:'#cc44ff' })
      if (enemyHp <= 0) break
    }
    const isHealSealed = playerBuffs.healSeal?.turns > 0
    if (isHealSealed) logs.push({ text:`🚫 回復封じ中！ 回復効果が無効化された！`, color:'#ff4488' })
    if (!isHealSealed && playerBuffs.regenHeal?.turns > 0) {
      const healAmt = Math.floor(playerBuffs.regenHeal.amount * passiveHealMult)
      playerHp = Math.min(profile.hp_max, playerHp + healAmt)
      logs.push({ text:`💚 回復効果でHPが${healAmt}回復した！`, color:'#44ff88' })
      if (passiveHealReflect && healAmt > 0) {
        const reflectDmg = Math.floor(healAmt * 0.5); enemyHp -= reflectDmg
        logs.push({ text:`✨ 神聖加護の反射！ ${enemy.name}に${reflectDmg}ダメージ！`, color:'#ffdd44' })
      }
    }
    if (!isHealSealed && playerBuffs.delayHeal && turn === playerBuffs.delayHeal.triggerTurn) {
      playerHp = Math.min(profile.hp_max, playerHp + playerBuffs.delayHeal.amount)
      logs.push({ text:`💚 装備効果でHPが${playerBuffs.delayHeal.amount}回復した！`, color:'#44ff88' })
    }
    // ポーション（奈落では消費せず効果のみ適用）
    if (!isHealSealed && currentItem) {
      const threshold = currentItem.use_threshold||50
      const effect = currentItem.items.effect
      const isInfinite = effect === 'hp_pct_infinite' || effect === 'mp_pct_infinite'
      const onCooldown = (playerBuffs.potionCooldown?.turns || 0) > 0
      const canUse = isInfinite ? !onCooldown : !itemUsed
      if (canUse) {
        if ((effect==='hp_pct' || effect==='hp_pct_infinite') && playerHp/profile.hp_max*100 <= threshold) {
          const healAmt = Math.floor(profile.hp_max*currentItem.items.value/100)
          playerHp = Math.min(profile.hp_max, playerHp+healAmt)
          logs.push({ text:`🧪 ${currentItem.items.name}を使用！ HPが${healAmt}回復した！`, color:'#44ff88' })
          if (isInfinite) { playerBuffs.potionCooldown = { turns:5 }; logs.push({ text:`⏳ 5ターンのクールダウンが入った！`, color:'#aaaaaa' }) }
          else itemUsed = true
        } else if ((effect==='mp_pct' || effect==='mp_pct_infinite') && playerMp/profile.mp_max*100 <= threshold) {
          const healAmt = Math.floor(profile.mp_max*currentItem.items.value/100)
          playerMp = Math.min(profile.mp_max, playerMp+healAmt)
          logs.push({ text:`🧪 ${currentItem.items.name}を使用！ MPが${healAmt}回復した！`, color:'#4488ff' })
          if (isInfinite) { playerBuffs.potionCooldown = { turns:5 }; logs.push({ text:`⏳ 5ターンのクールダウンが入った！`, color:'#aaaaaa' }) }
          else itemUsed = true
        }
      }
    }

    // プレイヤー行動スキップ判定（スタン・麻痺）
    let playerSkipped = false
    if (playerBuffs.stun?.turns > 0) {
      logs.push({ text:`${turn}ターン目: スタン！ あなたは行動できない！`, color:'#ffaa00' })
      playerSkipped = true; delete playerBuffs.stun
    } else if (playerBuffs.paralysis?.turns > 0 && Math.random() < playerBuffs.paralysis.skipRate) {
      logs.push({ text:`${turn}ターン目: 麻痺で行動不能！`, color:'#ffaa00' })
      playerSkipped = true; playerBuffs.paralysis.skipRate *= 0.5
    }
    if (!playerSkipped) {
      doPlayerAttack(false)
      if (enemyHp <= 0) break
      if (playerExtraRate > 0 && Math.random()*100 < playerExtraRate) { doPlayerAttack(true); if (enemyHp <= 0) break }
    }

    // 敵のターン
    let enemySkipped = false
    if (enemyBuffs.stun?.turns > 0) {
      logs.push({ text:`${turn}ターン目: ${enemy.name}はスタンして行動できない！`, color:'#ffaa00' })
      enemySkipped = true; delete enemyBuffs.stun
    } else if (enemyBuffs.paralysis?.turns > 0 && Math.random() < enemyBuffs.paralysis.skipRate) {
      logs.push({ text:`${turn}ターン目: ${enemy.name}は麻痺で行動不能！`, color:'#ffaa00' })
      enemySkipped = true; enemyBuffs.paralysis.skipRate *= 0.5
    }
    if (!enemySkipped) {
      if (enemy.skills && enemy.skills.length > 0) {
        if (Math.random() < 0.9) doEnemySkillAttack()
        else doEnemyAttack(false)
      } else {
        doEnemyAttack(false)
      }
      if (playerHp <= 0) break
      if (enemyExtraRate > 0 && Math.random()*100 < enemyExtraRate) doEnemyAttack(true)
    }
    if (playerHp <= 0) break

    if (enemyBuffs.bleed) {
      const bleedDmg = Math.floor(enemyMaxHp * 0.01 * enemyBuffs.bleed.stacks); enemyHp -= bleedDmg
      logs.push({ text:`🩸 出血ダメージ！ ${enemy.name}に${bleedDmg}ダメージ（${enemyBuffs.bleed.stacks}スタック）！`, color:'#ff4466' })
      if (enemyHp <= 0) break
      enemyBuffs.bleed.lastTurn = (enemyBuffs.bleed.lastTurn || 0) + 1
      if (enemyBuffs.bleed.lastTurn >= 3) delete enemyBuffs.bleed
    }

    const berserkWasActive = playerBuffs.berserk?.turns > 0
    Object.keys(playerBuffs).forEach(k => { if (playerBuffs[k]?.turns > 0) playerBuffs[k].turns-- })
    Object.keys(enemyBuffs).forEach(k =>  { if (enemyBuffs[k]?.turns  > 0) enemyBuffs[k].turns-- })
    if (berserkWasActive && playerBuffs.berserk?.turns === 0 && expandedSkillSet.length > 0) {
      const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
      if (lockedIdx >= 0) skillIndex = lockedIdx + 1
    }
    if (playerBuffs.spellBladeExhaust?.turns === 0) {
      const sealT = playerBuffs.spellBladeExhaust.sealTurns || 4
      delete playerBuffs.spellBladeExhaust
      playerBuffs.spellBladeSealed = { turns:sealT }
      logs.push({ text:`⚔ 魔剣開放の反動！ ${sealT}ターンの間バフ不可状態になった！`, color:'#ff4444' })
    }
    if (playerBuffs.allinActive?.turns === 0) {
      const reactT = playerBuffs.allinActive.reactTurns || 2
      delete playerBuffs.allinActive
      delete playerBuffs.atkUp; delete playerBuffs.matkUp; delete playerBuffs.spdUp; delete playerBuffs.dmgReduce
      playerBuffs.allinDebuff = { turns:reactT, rate:0.7 }
      logs.push({ text:`💸 オールインの効果が切れた！ ${reactT}ターンの間全ステータスが低下し、バフが使えない！`, color:'#ff4444' })
    }
    if (bossHealCooldown > 0) bossHealCooldown--
    logs.push({ type:'hp', turn, playerHp:Math.max(0,playerHp), playerMax:profile.hp_max, playerName:profile.username, enemyHp:Math.max(0,enemyHp), enemyMax:enemyMaxHp, enemyName:enemy.name, playerStatus:extractStatuses(playerBuffs), enemyStatus:extractStatuses(enemyBuffs) })
    turn++
  }

  const win = enemyHp <= 0
  logs.push(win
    ? { text:`${enemy.name}を倒した！`, color:'#44ff88' }
    : { text:`敗北… また挑もう。`, color:'#ff4444' })
  return { logs, win }
}

export default function Abyss() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [skillSets, setSkillSets] = useState([])
  const [playerItem, setPlayerItem] = useState(null)
  const [abilityTitle, setAbilityTitle] = useState(null)
  const [status, setStatus] = useState(null)   // { cleared_floor, can_challenge, next_floor, reset_at }
  const [scene, setScene] = useState('lobby')   // 'lobby' | 'battle'
  const [battleLogs, setBattleLogs] = useState([])
  const [battling, setBattling] = useState(false)
  const [reward, setReward] = useState(null)
  const [resultMsg, setResultMsg] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const [now, setNow] = useState(Date.now())
  const cdRef = useRef(null)
  const logsEndRef = useRef(null)

  useEffect(() => { init() }, [])
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [battleLogs])

  // 共有CDカウントダウン
  useEffect(() => {
    clearInterval(cdRef.current)
    if (remaining > 0) {
      cdRef.current = setInterval(() => {
        setRemaining(prev => { if (prev <= 0.2) { clearInterval(cdRef.current); return 0 } return prev - 0.2 })
      }, 200)
    }
    return () => clearInterval(cdRef.current)
  }, [remaining])

  // リセット時刻までのカウントダウン表示用
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }

    const [{ data: prof }, { data: eq }, { data: prof2 }, { data: ss }, { data: pi }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('proficiency').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('skill_sets').select('*, skills(*)').eq('player_id', user.id).order('slot_order'),
      supabase.from('player_items').select('*, items(*)').eq('player_id', user.id).eq('equipped', true).maybeSingle(),
    ])
    if (!prof) { nav('/create'); return }
    // 管理者限定[開発]
    if (!prof.is_admin) { nav('/game'); return }
    setProfile(prof)
    setEquipment(eq || [])
    setProficiency(prof2 || [])
    setSkillSets(ss || [])
    setPlayerItem(pi || null)

    if (prof.ability_title_id) {
      const { data: at } = await supabase.from('titles').select('*').eq('id', prof.ability_title_id).single()
      setAbilityTitle(at || null)
    }
    if (prof.last_action_at) {
      const elapsed = (Date.now() - new Date(prof.last_action_at).getTime()) / 1000
      setRemaining(Math.max(0, WAIT_SECONDS - elapsed))
    }
    await fetchStatus()
  }

  const fetchStatus = async () => {
    const { data, error } = await supabase.rpc('get_abyss_status')
    if (error) { setStatus({ cleared_floor:0, can_challenge:true, next_floor:1, reset_at:null }); return }
    setStatus(data)
  }

  const targetFloor = status?.next_floor || 1
  const floorData = getAbyssFloor(targetFloor)
  const isAllCleared = (status?.cleared_floor || 0) >= ABYSS_FLOOR_COUNT
  // 次の階がまだ未実装（16階以降など）：制覇ではないが今は挑戦できない
  const notYetAvailable = !isAllCleared && !floorData
  const canChallenge = !!status?.can_challenge && !isAllCleared && !notYetAvailable && remaining <= 0 && !battling

  const handleChallenge = async () => {
    if (!floorData || !profile || battling) return
    if (!status?.can_challenge) return
    if (remaining > 0) return
    setBattling(true); setScene('battle'); setBattleLogs([]); setReward(null); setResultMsg(null)

    // 共有CDロック（10秒に1回まで）。並行端末/連打対策。
    const lockTime = new Date(Date.now() - WAIT_SECONDS * 1000).toISOString()
    const nowIso = new Date().toISOString()
    const { data: locked } = await supabase.from('profiles')
      .update({ last_action_at: nowIso })
      .eq('id', profile.id)
      .lt('last_action_at', lockTime)
      .select('id')
    if (!locked || locked.length === 0) {
      setBattling(false); setScene('lobby')
      const elapsed = (Date.now() - new Date(profile.last_action_at || 0).getTime()) / 1000
      setRemaining(Math.max(1, WAIT_SECONDS - elapsed))
      return
    }
    setProfile(p => ({ ...p, last_action_at: nowIso }))
    setRemaining(WAIT_SECONDS)

    const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
    const { logs, win } = simulateAbyssBattle(eff, equipment, skillSets, profile, { ...floorData.enemy }, playerItem)
    setBattleLogs(logs)

    if (win) {
      const { data, error } = await supabase.rpc('claim_abyss_floor', { p_floor: targetFloor })
      if (error || data?.error) {
        setResultMsg(data?.error || '報酬の受け取りに失敗しました')
      } else {
        setReward(data)
        await fetchStatus()
      }
    }
    setBattling(false)
  }

  const fmtCountdown = (iso) => {
    if (!iso) return '—'
    const ms = new Date(iso).getTime() - now
    if (ms <= 0) return 'まもなく'
    const d = Math.floor(ms / 86400000)
    const h = Math.floor((ms % 86400000) / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    if (d > 0) return `${d}日${h}時間`
    if (h > 0) return `${h}時間${m}分`
    return `${m}分`
  }

  if (!profile || !status) {
    return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>
  }

  const e = floorData?.enemy

  return (
    <div style={{ minHeight:'100vh', background:'#0a0612', padding:'12px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'640px', margin:'0 auto' }}>
        {/* ヘッダー */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #3a1f5a', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#c08cff', fontSize:'16px', letterSpacing:'3px' }}>🕯 奈落闘技場 <span style={{ fontSize:'10px', color:'#7755aa' }}>[開発]</span></div>
          <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #6644aa', color:'#9977cc', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
        </div>

        {scene === 'lobby' && (
          <>
            {/* 進行状況 */}
            <div style={{ border:'1px solid #4a2a6a', background:'#150a22', padding:'12px', marginBottom:'10px' }}>
              <div style={{ color:'#b088dd', fontSize:'12px', lineHeight:'1.9' }}>
                到達階層: <span style={{ color:'#ffcc66', fontWeight:'bold' }}>{status.cleared_floor || 0}</span> / {ABYSS_FLOOR_COUNT} 階
              </div>
              <div style={{ color:'#7766aa', fontSize:'10px', marginTop:'4px', lineHeight:'1.7' }}>
                1階を倒すと次の階へ。勝利すると次の月曜朝5時まで再挑戦できません。<br/>
                敗北しても挑戦回数は減りません（勝つまで何度でも挑戦可）。
              </div>
            </div>

            {isAllCleared ? (
              <div style={{ border:'1px solid #ffcc44', background:'#1a1400', padding:'24px', textAlign:'center' }}>
                <div style={{ color:'#ffcc44', fontSize:'15px', marginBottom:'8px' }}>👑 全{ABYSS_FLOOR_COUNT}階制覇！</div>
                <div style={{ color:'#ccaa66', fontSize:'11px' }}>奈落の頂点に立った。新たな挑戦をお待ちください。</div>
              </div>
            ) : notYetAvailable ? (
              <div style={{ border:'1px solid #6a5a9a', background:'#120c1e', padding:'24px', textAlign:'center' }}>
                <div style={{ color:'#b0a0dd', fontSize:'14px', marginBottom:'8px' }}>🚧 {ABYSS_DEFINED_FLOORS}階まで制覇！</div>
                <div style={{ color:'#9988bb', fontSize:'11px', lineHeight:'1.8' }}>{targetFloor}階以降は現在準備中です。<br/>続きの実装をお待ちください。</div>
              </div>
            ) : !status.can_challenge ? (
              <div style={{ border:'1px solid #aa4466', background:'#1a0a14', padding:'20px', textAlign:'center' }}>
                <div style={{ color:'#ff6688', fontSize:'13px', marginBottom:'8px' }}>⛔ 今週はすでにクリア済みです</div>
                <div style={{ color:'#cc7799', fontSize:'11px', lineHeight:'1.8' }}>
                  次の挑戦まで: <span style={{ color:'#ffcc66' }}>{fmtCountdown(status.reset_at)}</span><br/>
                  <span style={{ fontSize:'10px', color:'#996688' }}>（毎週月曜 朝5時にリセット）</span>
                </div>
              </div>
            ) : (
              <div style={{ border:'1px solid #6a3a9a', background:'#160c26', padding:'16px' }}>
                <div style={{ color:'#9977cc', fontSize:'10px', marginBottom:'6px' }}>次の挑戦相手</div>
                <div style={{ marginBottom:'12px' }}>
                  <div style={{ color:'#e0b0ff', fontSize:'16px', fontWeight:'bold', marginBottom:'10px' }}>{targetFloor}階　{e?.name}</div>
                  <div style={{ background:'#0d0618', border:'1px solid #2a1840', padding:'8px 10px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ color:'#7766aa', fontSize:'11px' }}>推奨総合力</span>
                    <span style={{ color:'#ffcc66', fontSize:'15px', fontWeight:'bold' }}>{fmt(floorData.target)}</span>
                  </div>
                </div>

                {/* 報酬プレビュー */}
                <div style={{ borderTop:'1px solid #3a2052', paddingTop:'8px', marginBottom:'12px' }}>
                  <div style={{ color:'#9977cc', fontSize:'10px', marginBottom:'4px' }}>勝利報酬</div>
                  <RewardLine reward={floorData.reward} />
                </div>

                <button onClick={handleChallenge} disabled={!canChallenge}
                  style={{ width:'100%', padding:'12px', background: canChallenge ? '#2a1040' : '#140a1c', border:`1px solid ${canChallenge ? '#a060ff' : '#3a2a4a'}`, color: canChallenge ? '#d0a0ff' : '#5a4a6a', cursor: canChallenge ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
                  {remaining > 0 ? `⏳ ${remaining.toFixed(1)}秒` : `⚔ ${targetFloor}階に挑む`}
                </button>
              </div>
            )}
          </>
        )}

        {scene === 'battle' && (
          <div style={{ border:'1px solid #6a3a9a', background:'#140a22', padding:'12px' }}>
            <div style={{ color:'#c08cff', fontSize:'13px', marginBottom:'10px' }}>⚔ {targetFloor}階　{e?.name} 戦</div>
            {battling && <div style={{ color:'#9977aa', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
            <div style={{ marginBottom:'12px', maxHeight:'46vh', overflowY:'auto' }}>
              {battleLogs.map((l,i)=>(<BattleLogLine key={i} l={l} />))}
              <div ref={logsEndRef} />
            </div>

            {reward && (
              <div style={{ border:'1px solid #ffcc44', background:'#1a1400', padding:'12px', marginBottom:'10px' }}>
                <div style={{ color:'#ffcc44', fontSize:'13px', marginBottom:'6px' }}>🎉 {targetFloor}階クリア！ 報酬獲得</div>
                <div style={{ fontSize:'11px', color:'#ffcc66', lineHeight:'1.9' }}>
                  <div>💰 Gold +{fmt(reward.gold)}</div>
                  {reward.stone && <div>💎 {STONE_NAME(reward.stone)} ×{reward.stone_count}</div>}
                  {reward.gem_count > 0 && <div style={{ color: GEM_RANK_COLOR[reward.gem_rank] || '#ccc' }}>💠 宝石（{reward.gem_rank}ランク）×{reward.gem_count}</div>}
                </div>
                <div style={{ color:'#cc9944', fontSize:'10px', marginTop:'6px' }}>次の挑戦は月曜朝5時から。次は {Math.min(targetFloor+1, ABYSS_FLOOR_COUNT)}階だ。</div>
              </div>
            )}
            {resultMsg && (
              <div style={{ border:'1px solid #aa4466', background:'#1a0a14', padding:'10px', marginBottom:'10px', color:'#ff8899', fontSize:'11px' }}>{resultMsg}</div>
            )}

            {!battling && (
              <button onClick={()=>{ setScene('lobby'); setBattleLogs([]) }}
                style={{ width:'100%', padding:'10px', background:'#1a1030', border:'1px solid #6644aa', color:'#9977cc', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                ← 戻る
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RewardLine({ reward }) {
  if (!reward) return null
  return (
    <div style={{ fontSize:'11px', color:'#ccaa66', lineHeight:'1.8' }}>
      <span>💰 {fmt(reward.gold)}G</span>
      <span style={{ marginLeft:'10px' }}>💎 {STONE_NAME(reward.stone)}×{reward.stoneCount}</span>
      <span style={{ marginLeft:'10px', color: GEM_RANK_COLOR[reward.gem] || '#ccc' }}>💠 宝石({reward.gem})×{reward.gemCount}</span>
    </div>
  )
}
