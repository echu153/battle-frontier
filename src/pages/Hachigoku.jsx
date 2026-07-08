import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useScarecrowBlock, ScarecrowBlockScreen } from '../components/ScarecrowGuard'
import { getWeaponGroup } from '../lib/stats'
import { evoOnHit, evoOnDamaged, evoOnEvade, evoTakenMult, evoAllSkillsSet, evoAtkMult, evoMatkMult } from '../lib/evoCombat'
import { emblemDmgMult, emblemDrainAmount, emblemDotMult, emblemBlocksAilment } from '../lib/emblemCombat'
import { petPlayerBonus, charmPlayerBonus } from '../constants/pets'
import { selectBattleSkillSets } from '../lib/loadout'
import { reportDevAccess } from '../lib/devAccess'
import { buildSummon, summonAnnounce, summonAttackDamage, summonAbsorbBasic, summonEndOfTurn, tryPetCommand, BREEDER_COMMANDS } from '../lib/summon'
import {
  calcEffectiveStats,
  calcEvasionRate,
  calcExtraActionRate,
  calcCritRate,
  calcDefReduction,
  applyEquipmentEffects,
  ailmentShieldBlocks,
  executeSkill,
  extractStatuses,
  BattleLogLine,
  MULTI_HIT_SKILLS,
} from './Game'
import { HACHIGOKU_HELLS, HACHIGOKU_DIFFICULTIES, HACHIGOKU_DAILY_WINS, makeHachigokuEnemy } from '../lib/hachigoku'

const fmt = (n) => Number(n).toLocaleString()
const HACHIGOKU_CD = 5  // 挑戦クールダウン(秒・共有CD)

// ============================================================
// 八獄 戦闘シミュレーション（完全PvE）
// Abyss.jsx の simulateAbyssBattle をベースに、階数DRを外し
// 地獄ごとの固有ギミック（enemy.mods）を解釈する。
//  ・常にフルHP/MPから開始する「決闘」形式（街のHPは消費しない）
//  ・EXP/Goldなし（報酬はサーバRPC hachigoku_result で付与）
// 戻り値: { logs, win }
// ============================================================
function simulateHachigokuBattle(eff, equipment, skillSets, profile, enemy) {
  const logs = []
  const mods = enemy.mods || {}
  const hellDR = 1 - Math.min(0.9, mods.flatDR || 0)  // 叫喚: 敵の被ダメ一律軽減（DoTは貫通）
  let playerHp = eff.hp_max
  let playerMp = eff.mp_max
  let enemyHp = enemy.hp
  const enemyMaxHp = enemy.hp
  let turn = 1, skillIndex = 0
  let playerBuffs = {}, enemyBuffs = {}
  let prevSkillName = null
  let playerAttacking = false
  let rokkanStacks = 0
  let seimitsuStacks = 0

  const equippedWeaponItem = equipment.find(e => e.slot === 'weapon' && e.equipped)
  const ondmgSpdUp = eff.ondmgSpdUp || 0
  const hasAmagoiShield = equipment.some(e => e.equipped && e.bonus_effect === 'battle_start_ailment_shield')
  const isArtifact = equippedWeaponItem?.bonus_effect === 'artifact'

  const passiveNames = skillSets.filter(ss => ss.skills?.type === 'パッシブ').map(ss => ss.skills.name)
  const hasIai        = passiveNames.includes('居合の構え') || passiveNames.includes('心眼')
  const hasBerserk    = passiveNames.includes('バーサク')
  const hasTakaNoMe   = passiveNames.includes('鷹ノ目')
  const hasKakushin   = passiveNames.includes('執行本能')
  const hasShinkoka   = passiveNames.includes('神聖加護')
  const hasTenki      = passiveNames.includes('天啓')
  const hasRokkan     = passiveNames.includes('第六感')
  const hasSeimitsu   = passiveNames.includes('精密照準')
  const hasTosoHonno  = passiveNames.includes('闘争本能')
  const hasOnmi       = passiveNames.includes('隠身')
  const hasGambleBody = passiveNames.includes('ギャンブルボディ')
  const hasMadokenJutsu = passiveNames.includes('魔導剣術')
  const hasHolyKnightPassive = passiveNames.includes('聖騎士の心得')

  const rtCur = (profile.retraining || {})[profile.class] || 0
  const pe = (cls) => profile.class === cls && rtCur >= 3

  const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.25 : 0
  const passiveDmgMult      = (hasBerserk ? (pe('狂戦士')?1.40:1.15) : 1.0) * (hasKakushin ? (pe('異端審問官')?1.40:1.20) : 1.0) * (eff.weaponDmgMult || 1)
  const passiveHealMult     = (hasShinkoka ? 1.5 : 1.0) * (hasKakushin ? 0.5 : 1.0)
  const passiveMatkMult     = hasShinkoka ? 1.1 : 1.0
  const passiveMpCostMult   = (hasTenki ? (pe('賢者')?0.5:0.7) : 1.0) * (eff.weaponMpCostMult || 1)
  const passiveMatkMultTenki = hasTenki ? (pe('賢者')?1.4:1.2) : 1.0
  const passiveHitBonus     = (hasRokkan ? 10 : 0) + (hasSeimitsu ? 10 : 0) + (hasTakaNoMe ? (pe('狩人')?20:10) : 0)
  const passiveHealReflect  = (hasShinkoka && pe('聖職者'))
  if (profile.class === '精霊召喚士' && rtCur >= 1 && passiveNames.includes('精霊共鳴')) {
    const boostedMp = Math.floor(eff.mp_max * 1.2)
    playerMp = Math.min(boostedMp, profile.mp_current ?? boostedMp)
  }
  const hasRyurin  = passiveNames.includes('竜鱗の加護')
  const ryurinMult = hasRyurin ? (pe('竜騎士') ? 1.4 : 1.2) : 1.0
  const ryurinReduce = () => (hasRyurin && Math.random() < 0.3) ? (pe('竜騎士') ? 0.80 : 0.95) : 1.0
  const summon = buildSummon(profile, passiveNames, profile.activePet)
  summonAnnounce(summon, logs)

  const iaiSetSkills = skillSets.filter(ss => ss.skills && ss.skills.type !== 'パッシブ')
  const iaiLoadoutOK = iaiSetSkills.length > 0 && iaiSetSkills.every(ss => (ss.use_count ?? 1) === 1)
  const iaiPhysMult   = (hasIai && iaiLoadoutOK) ? (pe('侍')?1.70:1.40) : 1.0
  const takaAtkBonus  = (hasTakaNoMe && pe('狩人')) ? Math.floor((eff.spd||0) * 0.1) : 0
  const madokenAtkMult = (hasMadokenJutsu && pe('魔法剣士')) ? 1.1 : 1.0

  logs.push({ text:`🔥 獄卒 ${enemy.name}が立ちはだかった！`, color:'#ff6644' })

  playerBuffs = applyEquipmentEffects(equipment, profile, playerBuffs, logs)

  const effectiveSpdForCalc = eff.spd
  const weaponType = equippedWeaponItem?.weapons?.weapon_type || 'sword'
  const isMagical = getWeaponGroup(weaponType) === 'magical'
  const expandedSkillSet = []
  for (const ss of skillSets) {
    if (ss.skills?.type === 'パッシブ') continue
    const count = ss.use_count || 1
    for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
  }
  const allSkillsSet = evoAllSkillsSet(skillSets)

  const playerSpd = effectiveSpdForCalc
  const enemySpd = enemy.spd || 5
  const playerExtraRate = calcExtraActionRate(playerSpd, enemySpd)
  const enemyExtraRate  = calcExtraActionRate(enemySpd, playerSpd)
  const playerCritRate  = calcCritRate(playerSpd, enemySpd) + (eff.critBonus || 0)
  // 黒縄: 敵クリティカル率ブースト（紋章のクリティカル抵抗で減らせる）
  const enemyCritRate   = Math.max(0, calcCritRate(enemySpd, playerSpd) + (mods.critBoost || 0) - (eff.critResist || 0))
  const enemyCritMult   = 1.5 + (mods.critDmgPlus || 0)
  const enemyEvasionRate  = calcEvasionRate(enemySpd, effectiveSpdForCalc)
  const playerHitBonus = (eff.hitBonus || 0) + passiveHitBonus

  const doPlayerAttack = (isExtra = false) => {
    playerAttacking = true
    const holyFieldDef = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
    const holyKnightMult = hasHolyKnightPassive ? (pe('聖騎士')?2.0:1.5) : 1.0
    const kabeDefP = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
    const pDef   = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1) * holyFieldDef * holyKnightMult * kabeDefP
    const pMdef  = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * holyFieldDef * holyKnightMult * kabeDefP
    const burnDebuffP = playerBuffs.burn?.turns > 0 ? 0.9 : 1.0
    const madokenBonus = hasMadokenJutsu ? Math.floor(eff.matk * (pe('魔法剣士')?0.6:0.3)) : 0
    const pMatk  = (eff.matk - madokenBonus) * (playerBuffs.matkUp ? playerBuffs.matkUp.rate : 1) * passiveMatkMult * passiveMatkMultTenki * burnDebuffP * evoMatkMult(eff, allSkillsSet)
    const pAtk   = (eff.atk + madokenBonus + takaAtkBonus) * madokenAtkMult * (playerBuffs.atkUp  ? playerBuffs.atkUp.rate  : 1) * (playerBuffs.atkDown ? playerBuffs.atkDown.rate : 1) * burnDebuffP * evoAtkMult(eff, allSkillsSet)
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
    const nextSkill = expandedSkillSet.length > 0 ? expandedSkillSet[Math.max(0, peekIdx)]?.skills : null
    const nextSkillName = nextSkill?.name || null
    let mpLack = false
    if (nextSkill) {
      let peekMpCost = Math.floor((isArtifact ? (nextSkill.mp_cost||0)*2 : (nextSkill.mp_cost||0)) * passiveMpCostMult)
      if (nextSkill.name === 'マナボルト') peekMpCost = Math.max(1, Math.floor(playerMp * 0.1))
      mpLack = playerMp < peekMpCost
      if (mpLack) logs.push({ text:`💧 MPが足りなくてスキルが使えない！`, color:'#6699ff' })
    }
    const isSureHit = !mpLack && nextSkillName === '絶影狙撃'
    const isSelfSkill = !mpLack && nextSkill && (nextSkill.type === '強化' || nextSkill.type === '回復')
    const isMultiHitSkill = !mpLack && nextSkill && MULTI_HIT_SKILLS.has(nextSkill.name)
    const skillExtraHit = (nextSkillName === '連装銃撃' && profile.class === '魔銃士' && rtCur >= 2) ? 10 : 0
    const baseEnemyEvasion = Math.max(0, enemyEvasionRate - playerHitBonus - buffHitBonus - skillExtraHit)
    const effectiveEnemyEvasion = (isSureHit || isSelfSkill || isMultiHitSkill) ? 0 : baseEnemyEvasion
    if (effectiveEnemyEvasion > 0 && Math.random()*100 < effectiveEnemyEvasion) {
      logs.push({ text:`${prefix}${nextSkillName && !mpLack ? `${nextSkillName}！` : '攻撃！'} しかし${enemy.name}に回避された！`, color:'#446688' })
      if (nextSkill && !mpLack) {
        const resPeek = executeSkill(nextSkill, effBuff, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
        if (resPeek.followup && resPeek.followup.dmg > 0) {
          const adjED = Math.max(1, Math.floor((enemy.def||0)*eDefRate))
          const fScale = effBuff.atk / (effBuff.atk + adjED)
          const fCrit = Math.random()*100 < playerCritRate
          const fCritMult = fCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
          const dr = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
          let fDmg = Math.floor(resPeek.followup.dmg * fScale * fCritMult * passiveDmgMult * dr * hellDR * (0.9 + Math.random()*0.2))
          fDmg = Math.max(1, fDmg)
          enemyHp -= fDmg
          logs.push({ text:`↳ 追撃！${resPeek.followup.label?`（${resPeek.followup.label}）`:''} ${enemy.name}に${fDmg}ダメージ！${fCrit?' 💥クリティカル！':''}`, color: fCrit?'#ffaa00':'#ffaa66' })
        }
      }
      if (expandedSkillSet.length > 0) skillIndex++
      return
    }

    if (playerBuffs.berserk?.turns > 0 && playerBuffs.berserk.lockedSkill) {
      const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
      if (lockedIdx >= 0) skillIndex = lockedIdx
    }
    if (playerBuffs.tenkaiCharge?.turns > 0) {
      const tIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === '天墜竜閃')
      if (tIdx >= 0) skillIndex = tIdx
    }
    let skillUsed = false
    if (expandedSkillSet.length > 0) {
      const cs = expandedSkillSet[skillIndex % expandedSkillSet.length]
      let mpCost = Math.floor((isArtifact ? (cs?.skills?.mp_cost||0)*2 : (cs?.skills?.mp_cost||0)) * passiveMpCostMult)
      if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(playerMp * 0.1))
      if (cs?.skills?.name === '天墜竜閃' && playerBuffs.tenkaiCharge?.turns > 0) mpCost = 0
      const isBreederCmd = cs?.skills?.name && BREEDER_COMMANDS.has(cs.skills.name)
      if (isBreederCmd) {
        const cmd = tryPetCommand(cs.skills.name, summon, { def: enemy.def, mdef: enemy.mdef, atk: enemy.atk, matk: enemy.matk, type: enemy.type, name: enemy.name, evasionRate: 0 }, enemyBuffs, playerBuffs, rtCur, playerMp, mpCost, eff.hp_max, logs, `${turn}ターン目: `)
        if (cmd.handled) {
          playerMp -= cmd.mpUsed
          if (cmd.enemyDamage > 0) enemyHp -= Math.floor(cmd.enemyDamage * hellDR)
          if (cmd.playerHeal > 0) playerHp = Math.min(eff.hp_max, playerHp + cmd.playerHeal)
          prevSkillName = cs.skills.name
          skillUsed = true; skillIndex++
        }
      } else if (cs && cs.skills && playerMp >= mpCost) {
        playerMp -= mpCost
        const hasGensoKyomei = passiveNames.includes('元素共鳴')
        const gensoMult = (hasGensoKyomei && prevSkillName && prevSkillName !== cs.skills.name && cs.skills.type === '魔法攻撃') ? (pe('元素使い')?1.50:1.30) : 1.0
        if (hasSeimitsu && pe('魔銃士')) seimitsuStacks = (prevSkillName && prevSkillName === cs.skills.name) ? Math.min(3, seimitsuStacks+1) : 0
        const seimitsuMult = 1 + 0.10 * seimitsuStacks
        const seimitsuCritBonus = 2 * seimitsuStacks
        prevSkillName = cs.skills.name
        const res = executeSkill(cs.skills, {...effBuff, lastMpCost:mpCost}, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
        const rokkanMult = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05*Math.min(6, rokkanStacks)) : 1.0
        const iaiMult = (cs.skills?.type === '物理攻撃') ? iaiPhysMult : 1.0
        const finalCrit = res.dmg > 0 && (isCrit || ((res.bonusCritRate > 0 || seimitsuCritBonus > 0) && Math.random()*100 < playerCritRate + res.bonusCritRate + seimitsuCritBonus))
        const finalCritMult = finalCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
        const tosoMult = hasTosoHonno ? (playerHp <= eff.hp_max*0.3 ? (pe('体術師')?2.0:1.6) : playerHp <= eff.hp_max*0.5 ? (pe('体術師')?1.4:1.2) : 1.0) : 1.0
        let defScale = 1.0
        if (res.dmg > 0) {
          const sType = cs.skills?.type
          const skillCls = cs.skills?.class_name
          const buffPen = playerBuffs.mukyoPen?.turns > 0 ? playerBuffs.mukyoPen.rate : 0
          const spMdefPen = playerBuffs.spiritMdefPen?.turns > 0 ? playerBuffs.spiritMdefPen.rate : 0  // ノクス：魔法防御貫通バフ
          const adjED  = Math.max(1, Math.floor((enemy.def ||0)*eDefRate*(1-Math.min(0.8,(res.defPen||0)+buffPen))))
          const adjEMD = Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate*(1-Math.min(0.8,(res.mdefPen||0)+spMdefPen))))
          // サイコブラスト/マインドブレイク等、およびサイキッカー・魔銃士の全スキルは敵DEF・MDEFの低い方で軽減（Game.jsxと同構造）
          const useLowDef = cs.skills?.name === 'サイコブラスト' || res.useMinDef || skillCls === 'サイキッカー' || skillCls === '魔銃士'
          if (res.physScaleMatk) defScale = effBuff.matk / (effBuff.matk + adjED)  // 物理ダメだが火力参照は特殊攻撃（オオカミ召喚/シルフ等）
          else if (useLowDef) defScale = effBuff.matk / (effBuff.matk + Math.min(adjED, adjEMD))
          else if (sType === '物理攻撃') defScale = effBuff.atk  / (effBuff.atk  + adjED)
          else if (sType === '魔法攻撃') defScale = effBuff.matk / (effBuff.matk + adjEMD)
        }
        const allinDebuffOutMult = playerBuffs.allinDebuff?.turns > 0 ? 0.7 : 1.0
        const nextBoostMult = (res.dmg > 0 && playerBuffs.nextSkillBoost) ? playerBuffs.nextSkillBoost.rate : 1.0  // 半月蹴りの溜め（次の一撃強化）
        if (nextBoostMult > 1.0 && cs.skills?.name !== '半月蹴り') res.newPlayerBuffs.nextSkillBoost = undefined  // 消費
        const enemyDmgReduceMult = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
        const isPhysSkill = cs.skills?.type === '物理攻撃'
        const emMult = emblemDmgMult(eff, isPhysSkill)  // 紋章: 物理/特殊ダメージUP
        const isMulti = Array.isArray(res.hitDmgs) && res.hitDmgs.length > 0 && res.dmg > 0
        let finalDmg, resLog, multiCritAny = false
        if (isMulti) {
          const hitMult = defScale * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * nextBoostMult * enemyDmgReduceMult * hellDR * emMult
          const parts = []
          finalDmg = 0
          for (const hd of res.hitDmgs) {
            if (baseEnemyEvasion > 0 && Math.random()*100 < baseEnemyEvasion) { parts.push('回避された！'); continue }
            const hCrit = Math.random()*100 < (playerCritRate + (res.bonusCritRate||0) + seimitsuCritBonus)
            const hMult = hCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
            let hDmg = Math.max(1, Math.floor(hd * hitMult * hMult * (0.9 + Math.random()*0.2)))
            if (hCrit) multiCritAny = true
            finalDmg += hDmg
            parts.push(`${hDmg}ダメージ！${hCrit ? '💥' : ''}`)
          }
          resLog = `${res.log.split('！')[0]}！ ${enemy.name}に ${parts.join(' ')}`
        } else {
          finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * nextBoostMult * enemyDmgReduceMult * hellDR * emMult * (0.9 + Math.random() * 0.2))
          resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
        }
        if (res.selfDmg > 0) playerHp = Math.max(0, playerHp - res.selfDmg)
        enemyHp -= finalDmg
        // 紋章: 物理/特殊吸収（与ダメの一定割合を回復・回復封じ中は無効）
        { const emDrain = emblemDrainAmount(eff, finalDmg, isPhysSkill); if (emDrain > 0 && !(playerBuffs.healSeal?.turns > 0)) { playerHp = Math.min(eff.hp_max, playerHp + emDrain); logs.push({ text:`💠 紋章の吸収！ HPが${emDrain}回復！`, color:'#66ddff' }) } }
        if (hasRokkan && pe('サイキッカー') && finalDmg > 0 && cs.skills?.type === '魔法攻撃') rokkanStacks = Math.min(6, rokkanStacks+1)
        if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
          enemyBuffs.healDown = { turns: 2, rate: 0.7 }
          logs.push({ text: `🗡 ${equippedWeaponItem?.weapons?.name || '武器'}の効果！ ${enemy.name}の回復力が2ターンの間-30%！`, color: '#ff8844' })
        }
        if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_spd_down_5') {
          const curSd = enemyBuffs.spdDown
          const amzSt = Math.min(4, ((curSd?.turns > 0 && curSd.amazaneStacks) || 0) + 1)
          const amzRate = Math.round((1 - 0.05 * amzSt) * 100) / 100
          if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) {
            enemyBuffs.spdDown = { turns: 2, rate: amzRate, amazaneStacks: amzSt }
          }
        }
        evoOnHit(eff, finalDmg, enemyBuffs, enemy.name, logs)
        if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(enemyBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
          enemyBuffs.paralysis = { turns: 3, skipRate: 0.25, spdRate: 0.8 }
          logs.push({ text: `⚡ 蒼雷の短刃の追撃！ ${enemy.name}を麻痺させた！`, color: '#ffe066' })
        }
        const healAmt = playerBuffs.healSeal?.turns > 0 ? 0 : Math.floor(res.heal * passiveHealMult * (playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1))  // ルミナ等の回復力アップを反映
        playerHp = Math.min(eff.hp_max, playerHp + healAmt)
        if (passiveHealReflect && healAmt > 0) {
          const reflectDmg = healAmt
          enemyHp -= reflectDmg
          logs.push({ text:`✨ 神聖加護の反射！ ${enemy.name}に${reflectDmg}ダメージ！`, color:'#ffdd44' })
        }
        if (playerBuffs.spellBladeSealed?.turns > 0) {
          const blockedKeys2 = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune','holyField','holyAwakening','flashCombo','spellBladeExhaust','nextSkillBoost']
          const hadBuff2 = blockedKeys2.some(k => res.newPlayerBuffs[k] !== playerBuffs[k] && res.newPlayerBuffs[k] !== undefined)
          for (const k of blockedKeys2) { if (res.newPlayerBuffs[k] !== playerBuffs[k]) res.newPlayerBuffs[k] = playerBuffs[k] }
          if (hadBuff2) logs.push({ text:`⚔ 魔剣開放の反動中！ バフが効かない！`, color:'#ff4444' })
        }
        if (playerBuffs.allinDebuff?.turns > 0) {
          const blockedKeys = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune','nextSkillBoost']
          const hadBuff = blockedKeys.some(k => res.newPlayerBuffs[k] !== playerBuffs[k] && res.newPlayerBuffs[k] !== undefined)
          for (const k of blockedKeys) { if (res.newPlayerBuffs[k] !== playerBuffs[k]) res.newPlayerBuffs[k] = playerBuffs[k] }
          if (hadBuff) logs.push({ text:`💸 オールインの反動中！ バフが効かない！`, color:'#ff4444' })
        }
        playerBuffs = res.newPlayerBuffs; enemyBuffs = res.newEnemyBuffs
        // 精霊共鳴：同じ精霊召喚を3回でtripled→次の行動で確定追加行動（Game.jsxと同構造）
        if (passiveNames.includes('精霊共鳴') && playerBuffs.spiritCombo?.tripled) {
          playerBuffs.guaranteedExtra = true
          playerBuffs.spiritCombo = { ...playerBuffs.spiritCombo, tripled:false }
          logs.push({ text: `🌟 精霊共鳴！ 精霊の力が高まり、追加行動を得る！`, color:'#ffdd66' })
        }
        const critInsert = (finalCrit && !isMulti) ? '💥クリティカル！ ' : ''
        const dmgIdx = resLog.indexOf(enemy.name + 'に')
        const logWithCrit = critInsert
          ? (dmgIdx >= 0 ? resLog.slice(0, dmgIdx) + critInsert + resLog.slice(dmgIdx) : resLog + ' ' + critInsert)
          : resLog
        logs.push({ text:`${prefix}${logWithCrit}`, color:(finalCrit && !isMulti) || multiCritAny ? '#ffff00' : '#88ccff' })
        if (res.followup && res.followup.dmg > 0) {
          const fCrit = Math.random()*100 < (playerCritRate + (res.bonusCritRate||0) + seimitsuCritBonus)
          const fCritMult = fCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
          let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * enemyDmgReduceMult * hellDR * emMult * (0.9 + Math.random()*0.2))
          fDmg = Math.max(1, fDmg)
          enemyHp -= fDmg
          logs.push({ text:`↳ 追撃！${res.followup.label?`（${res.followup.label}）`:''} ${enemy.name}に${fDmg}ダメージ！${fCrit?' 💥クリティカル！':''}`, color: fCrit?'#ffaa00':'#ffaa66' })
        }
        if (playerAttacking && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(eff.hp_max * 0.2))
          playerHp = Math.min(eff.hp_max, playerHp + rageCure)
          logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
        }
        if (playerBuffs.holyAwakening?.turns > 0 && finalDmg > 0) {
          const holyBonusDmg = Math.floor((pDef * playerBuffs.holyAwakening.defMult + pMdef * playerBuffs.holyAwakening.defMult))
          enemyHp -= holyBonusDmg
          logs.push({ text:`✨ 神聖覚醒の追撃！ ${enemy.name}に${holyBonusDmg}ダメージ！`, color:'#ffeeaa' })
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
      const iaiNormalMult = isMagical ? 1.0 : iaiPhysMult
      const rokkanMultN = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05 * Math.min(6, rokkanStacks)) : 1.0
      seimitsuStacks = 0; prevSkillName = null
      let finalDmg = Math.floor(baseDmg*0.7*critMult*(isArtifact?1.3:1.0)*passiveDmgMult*iaiNormalMult*rokkanMultN*enemyDmgReduceMult2*hellDR*emblemDmgMult(eff, !isMagical)*(0.9+Math.random()*0.2))
      enemyHp -= finalDmg
      // 紋章: 物理/特殊吸収
      { const emDrain = emblemDrainAmount(eff, finalDmg, !isMagical); if (emDrain > 0 && !(playerBuffs.healSeal?.turns > 0)) { playerHp = Math.min(eff.hp_max, playerHp + emDrain); logs.push({ text:`💠 紋章の吸収！ HPが${emDrain}回復！`, color:'#66ddff' }) } }
      if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
        enemyBuffs.healDown = { turns: 2, rate: 0.7 }
        logs.push({ text: `🗡 ${equippedWeaponItem?.weapons?.name || '武器'}の効果！ ${enemy.name}の回復力が2ターンの間-30%！`, color: '#ff8844' })
      }
      if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_spd_down_5') {
        const curSd = enemyBuffs.spdDown
        const amzSt = Math.min(4, ((curSd?.turns > 0 && curSd.amazaneStacks) || 0) + 1)
        const amzRate = Math.round((1 - 0.05 * amzSt) * 100) / 100
        if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) {
          enemyBuffs.spdDown = { turns: 2, rate: amzRate, amazaneStacks: amzSt }
        }
      }
      evoOnHit(eff, finalDmg, enemyBuffs, enemy.name, logs)
      const critText = isCrit ? '💥クリティカル！ ' : ''
      logs.push({ text:`${prefix}${critText}攻撃！ ${enemy.name}に${finalDmg}ダメージ！`, color:'#ffcc00' })
      if (playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
        const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(eff.hp_max * 0.2))
        playerHp = Math.min(eff.hp_max, playerHp + rageCure)
        logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
      }
      if (expandedSkillSet.length > 0) skillIndex++
    }
    playerAttacking = false
  }

  // 敵の攻撃命中時: 地獄ごとの状態異常付与（哭雨の羽衣/紋章耐性/狂信で防げる）
  const AIL_LABEL = { burn:'やけど', poison:'毒', bleed:'出血', paralysis:'麻痺', stun:'スタン' }
  const applyOnHitAilments = () => {
    if (!mods.onHitAilment || playerHp <= 0) return
    if (playerBuffs.statusImmune?.turns > 0) return
    for (const { key, chance } of mods.onHitAilment) {
      if (Math.random() * 100 >= chance) continue
      if (key !== 'stun' && key !== 'bleed' && playerBuffs[key]?.turns > 0) continue
      if (ailmentShieldBlocks(playerBuffs, logs)) continue
      if (emblemBlocksAilment(eff, key, logs)) continue
      if (key === 'burn')      playerBuffs.burn = { turns:5, dmgRate:0.02 }
      else if (key === 'poison')    playerBuffs.poison = { turns:4, dmgRate:0.03 }
      else if (key === 'paralysis') playerBuffs.paralysis = { turns:4, skipRate:0.25, spdRate:0.8 }
      else if (key === 'stun')      playerBuffs.stun = { turns:1 }
      else if (key === 'bleed') {
        const b = playerBuffs.bleed
        playerBuffs.bleed = { stacks: Math.min(5, (b?.stacks || 0) + 1), lastTurn: 0 }
      }
      logs.push({ text:`🌫 ${enemy.name}の獄気！ ${AIL_LABEL[key]}を負わされた！`, color:'#aa66ff' })
    }
  }

  const doEnemyAttack = (isExtra = false) => {
    if (summonAbsorbBasic(summon, { atk: enemy.atk, matk: enemy.matk, type: enemy.type }, enemyBuffs, turn, logs)) return
    const holyFieldDefE = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
    const holyKnightMultE = hasHolyKnightPassive ? (pe('聖騎士')?2.0:1.5) : 1.0
    const kabeDefE = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
    // 針山: 敵の攻撃はプレイヤー防御を割合無視（mods.defPen）
    const penMult = 1 - (mods.defPen || 0)
    const pDef  = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1) * holyFieldDefE * holyKnightMultE * kabeDefE * ryurinMult * penMult
    const pMdef = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1) * holyFieldDefE * holyKnightMultE * kabeDefE * ryurinMult * penMult
    const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
    const berserkDmgRate = hasBerserk ? (pe('狂戦士')?1.20:1.15) : 1.0
    const isEM = enemy.type === 'magical'
    const burnDebuffE = enemyBuffs.burn?.turns > 0 ? 0.9 : 1.0
    const eAtk = isEM
      ? (enemy.matk||0) * (enemyBuffs.matkUp ? enemyBuffs.matkUp.rate : 1) * burnDebuffE
      : enemy.atk * (enemyBuffs.atkUp ? enemyBuffs.atkUp.rate : 1) * burnDebuffE
    const isCrit = Math.random()*100 < enemyCritRate
    const defForCalc = isEM ? Math.max(1, pMdef) : Math.max(1, pDef)
    const baseDmg = Math.max(1, Math.floor(eAtk*eAtk/Math.max(1,eAtk+defForCalc))+Math.floor(Math.random()*3))
    const enemySpdBuff = enemyBuffs.spdUp ? enemyBuffs.spdUp.rate : 1
    const enemySpdDebuff = enemyBuffs.spdDown?.turns > 0 ? enemyBuffs.spdDown.rate : 1
    const playerSpdDebuff = playerBuffs.spdDown ? playerBuffs.spdDown.rate : 1
    const effectivePlayerSpd = effectiveSpdForCalc * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1) * playerSpdDebuff
    const effectiveEnemySpd = enemySpd * enemySpdBuff * enemySpdDebuff
    const evasionRate = calcEvasionRate(effectivePlayerSpd, effectiveEnemySpd) + (eff.evasionBonus || 0) + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0) + (hasOnmi ? 5 : 0)
    if (evasionRate > 0 && Math.random()*100 < evasionRate) {
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
      logs.push({ text:`${prefix}${enemy.name}の攻撃！ しかし回避した！`, color:'#44ff88' })
      evoOnEvade(eff, playerBuffs, logs)
      return
    }
    const enemyDmgDownRate = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
    // 針山: ランク軽減も無効化される
    const playerDefRankReduction = mods.defPen ? calcDefReduction(isEM ? eff.mdef : eff.def) * penMult : calcDefReduction(isEM ? eff.mdef : eff.def)
    const gambleBodyMult = hasGambleBody ? (pe('ギャンブラー') ? (0.5+Math.random()*0.7) : (0.7+Math.random()*0.6)) : 1.0
    const allinDebuffInMult = playerBuffs.allinDebuff?.turns > 0 ? 1.3 : 1.0
    const finalDmg = Math.floor(baseDmg*(isCrit?enemyCritMult:1.0)*dmgReduceRate*berserkDmgRate*enemyDmgDownRate*(1-playerDefRankReduction)*gambleBodyMult*allinDebuffInMult*evoTakenMult(eff, !isEM)*ryurinReduce()*(0.9+Math.random()*0.2))
    playerHp -= finalDmg
    { const refl = evoOnDamaged(eff, finalDmg, enemyBuffs, enemy.name, logs); if (refl > 0) enemyHp -= refl }
    if (playerBuffs.dmgReduce?.isGainoKabe) playerBuffs.dmgReduce = null
    const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
    const critText = isCrit ? ' 💥クリティカル！' : ''
    logs.push({ text:`${prefix}${enemy.name}の攻撃！ あなたに${finalDmg}ダメージ…${critText}`, color:isCrit?'#ff2200':'#ff6644' })
    // 餓鬼: 与えたダメージの一定割合を吸収して回復
    if (mods.lifesteal && finalDmg > 0 && enemyHp > 0) {
      const heal = Math.floor(finalDmg * mods.lifesteal)
      if (heal > 0) {
        enemyHp = Math.min(enemyMaxHp, enemyHp + heal)
        logs.push({ text:`🧛 ${enemy.name}はあなたの生気を喰らい${heal}回復した！`, color:'#cc66aa' })
      }
    }
    if (finalDmg > 0) applyOnHitAilments()
  }

  while (playerHp > 0 && enemyHp > 0 && turn <= 50) {
    const hpBeforeTurn = playerHp
    if (passiveNames.includes('骸の壁') && (turn === 1 || turn % 4 === 0)) {
      playerBuffs.dmgReduce = { turns:999, rate:0.7, isGainoKabe:true }
      logs.push({ text:`💀 骸の壁発動！ 次に攻撃を受けるまで被ダメ-30%！`, color:'#cc44ff' })
    }
    // 敵への持続ダメージ（固定割合DoT＝叫喚のflatDRは貫通）
    if (enemyBuffs.severePoisoin?.turns > 0) {
      const spDmg = Math.floor(enemyMaxHp * 0.05 * emblemDotMult(eff, 'poison')); enemyHp -= spDmg
      logs.push({ text:`🤢 猛毒ダメージ！ ${enemy.name}に${spDmg}ダメージ！`, color:'#aa44ff' })
      if (enemyHp <= 0) break
    }
    {
      const sEnemy = { def: enemy.def, mdef: enemy.mdef, atk: enemy.atk, matk: enemy.matk, type: enemy.type, name: enemy.name, evasionRate: 0 }
      const sd = summonAttackDamage(summon, sEnemy, enemyBuffs, playerBuffs, eff, rtCur, logs)
      if (sd > 0) enemyHp -= Math.floor(sd * hellDR)
      if (enemyHp <= 0) break
    }
    if (enemyBuffs.burn?.turns > 0) {
      const burnDmg = Math.floor(enemyMaxHp * 0.02 * emblemDotMult(eff, 'burn')); enemyHp -= burnDmg
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
      const poisonDmg = Math.floor(enemy.hp * enemyBuffs.poison.dmgRate * emblemDotMult(eff, 'poison')); enemyHp -= poisonDmg
      logs.push({ text:`☠ 毒ダメージ！ ${enemy.name}に${poisonDmg}ダメージ！`, color:'#44ff44' })
      if (enemyHp <= 0) break
    }
    // プレイヤーへの持続ダメージ
    if (playerBuffs.severePoisoin?.turns > 0) {
      const spDmgP = Math.floor(eff.hp_max * 0.05); playerHp = Math.max(0, playerHp - spDmgP)
      logs.push({ text:`🤢 猛毒ダメージ！ あなたに${spDmgP}ダメージ！`, color:'#aa44ff' })
      if (playerHp <= 0) break
    }
    if (playerBuffs.burn?.turns > 0) {
      const burnDmgP = Math.floor(eff.hp_max * 0.02); playerHp = Math.max(0, playerHp - burnDmgP)
      logs.push({ text:`🔥 やけどダメージ！ あなたに${burnDmgP}ダメージ！`, color:'#ff6622' })
      if (playerHp <= 0) break
    }
    if (playerBuffs.poison?.turns > 0) {
      const poisonDmgP = Math.floor(eff.hp_max * (playerBuffs.poison.dmgRate || 0.03)); playerHp = Math.max(0, playerHp - poisonDmgP)
      logs.push({ text:`☠ 毒ダメージ！ あなたに${poisonDmgP}ダメージ！`, color:'#44ff44' })
      if (playerHp <= 0) break
    }
    if (playerBuffs.bleed) {
      const bleedDmgP = Math.floor(playerHp * 0.01 * playerBuffs.bleed.stacks); playerHp = Math.max(0, playerHp - bleedDmgP)
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
      playerHp = Math.min(eff.hp_max, playerHp + healAmt)
      logs.push({ text:`💚 回復効果でHPが${healAmt}回復した！`, color:'#44ff88' })
      if (passiveHealReflect && healAmt > 0) {
        const reflectDmg = healAmt; enemyHp -= reflectDmg
        logs.push({ text:`✨ 神聖加護の反射！ ${enemy.name}に${reflectDmg}ダメージ！`, color:'#ffdd44' })
      }
    }
    if (!isHealSealed && playerBuffs.delayHeal && turn === playerBuffs.delayHeal.triggerTurn) {
      playerHp = Math.min(eff.hp_max, playerHp + playerBuffs.delayHeal.amount)
      logs.push({ text:`💚 装備効果でHPが${playerBuffs.delayHeal.amount}回復した！`, color:'#44ff88' })
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
      const spiritExtra = !!playerBuffs.guaranteedExtra  // 精霊共鳴の確定追加行動
      if (playerBuffs.guaranteedExtra) playerBuffs.guaranteedExtra = false
      if (!(playerBuffs.tenkaiCharge?.turns > 0) && (spiritExtra || (playerExtraRate > 0 && Math.random()*100 < playerExtraRate))) { doPlayerAttack(true); if (enemyHp <= 0) break }
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
      doEnemyAttack(false)
      if (playerHp <= 0) break
      if (enemyExtraRate > 0 && Math.random()*100 < enemyExtraRate) doEnemyAttack(true)
    }
    if (playerHp <= 0) break

    if (enemyBuffs.bleed) {
      const bleedDmg = Math.floor(enemyHp * 0.01 * enemyBuffs.bleed.stacks * emblemDotMult(eff, 'bleed')); enemyHp -= bleedDmg
      logs.push({ text:`🩸 出血ダメージ！ ${enemy.name}に${bleedDmg}ダメージ（${enemyBuffs.bleed.stacks}スタック）！`, color:'#ff4466' })
      if (enemyHp <= 0) break
      enemyBuffs.bleed.lastTurn = (enemyBuffs.bleed.lastTurn || 0) + 1
      if (enemyBuffs.bleed.lastTurn >= 3) delete enemyBuffs.bleed
    }

    const berserkWasActive = playerBuffs.berserk?.turns > 0
    Object.keys(playerBuffs).forEach(k => { if (playerBuffs[k]?.turns > 0) playerBuffs[k].turns-- })
    Object.keys(enemyBuffs).forEach(k =>  { if (enemyBuffs[k]?.turns  > 0) enemyBuffs[k].turns-- })
    summonEndOfTurn(summon)
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
    Object.keys(playerBuffs).forEach(k => { if (playerBuffs[k]?.turns === 0) delete playerBuffs[k] })
    Object.keys(enemyBuffs).forEach(k  => { if (enemyBuffs[k]?.turns === 0)  delete enemyBuffs[k] })
    if (ondmgSpdUp > 1 && playerHp < hpBeforeTurn && !(playerBuffs.spdUp?.turns > 0 && playerBuffs.spdUp.rate >= ondmgSpdUp)) {
      playerBuffs.spdUp = { turns: 2, rate: ondmgSpdUp }
      logs.push({ text:`⚙ 雷鋼の機神鎧が起動！ 2ターンの間 素早さ+${Math.round((ondmgSpdUp - 1) * 100)}%！`, color:'#66ccff' })
    }
    if (hasAmagoiShield && turn % 5 === 0 && playerHp > 0 && !(playerBuffs.ailmentShield?.charges > 0)) {
      playerBuffs.ailmentShield = { charges: 1 }
      logs.push({ text:`🛡 哭雨の羽衣の加護！ 状態異常を1回無効化するバフを獲得！`, color:'#66ccff' })
    }
    logs.push({ type:'hp', turn, playerHp:Math.max(0,playerHp), playerMax:eff.hp_max, playerName:profile.username, enemyHp:Math.max(0,enemyHp), enemyMax:enemyMaxHp, enemyName:enemy.name, playerStatus:extractStatuses(playerBuffs), enemyStatus:extractStatuses(enemyBuffs) })
    turn++
  }

  const win = enemyHp <= 0
  logs.push(win
    ? { text:`${enemy.name}を打ち倒した！`, color:'#44ff88' }
    : { text:`敗北… 獄卒はあまりに強大だった。（敗北は挑戦回数を消費しません）`, color:'#ff4444' })
  return { logs, win }
}

export default function Hachigoku() {
  const scarecrowBlock = useScarecrowBlock()
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [skillSets, setSkillSets] = useState([])
  const [abilityTitle, setAbilityTitle] = useState(null)
  const [winsToday, setWinsToday] = useState(0)
  const [clears, setClears] = useState({})
  const [selectedHell, setSelectedHell] = useState(null)   // hell key
  const [selectedDiff, setSelectedDiff] = useState('easy') // difficulty key
  const [scene, setScene] = useState('lobby')
  const [battleLogs, setBattleLogs] = useState([])
  const [battling, setBattling] = useState(false)
  const [battleInfo, setBattleInfo] = useState(null)  // { hell, diff }
  const [reward, setReward] = useState(null)
  const [resultMsg, setResultMsg] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const cdRef = useRef(null)
  const logsEndRef = useRef(null)

  useEffect(() => { init() }, [])
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [battleLogs])

  useEffect(() => {
    clearInterval(cdRef.current)
    if (remaining > 0) {
      cdRef.current = setInterval(() => {
        setRemaining(prev => { if (prev <= 0.2) { clearInterval(cdRef.current); return 0 } return prev - 0.2 })
      }, 200)
    }
    return () => clearInterval(cdRef.current)
  }, [remaining])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const [{ data: prof }, { data: eq }, { data: prof2 }, { data: ss }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('proficiency').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('skill_sets').select('*, skills(*)').eq('player_id', user.id).order('slot_order'),
    ])
    if (!prof) { nav('/create'); return }
    // 開発限定: 非管理者のアクセスを管理者へ通知（表示自体は開発中スクリーンでブロック済み）
    if (!prof.is_admin) reportDevAccess('hachigoku', '八獄(/hachigoku)')
    let petCharm = null, petStat = null, activePet = null
    try {
      const { data: ap } = await supabase.from('pets').select('species, level, evolved, charm_id').eq('owner_id', user.id).eq('is_active', true).maybeSingle()
      if (ap) { activePet = ap; petStat = petPlayerBonus(ap); if (ap.charm_id) { const { data: c } = await supabase.from('player_charms').select('*').eq('id', ap.charm_id).maybeSingle(); if (c) petCharm = charmPlayerBonus(c) } }
    } catch { /* ペット未導入時は無視 */ }
    // 紋章の割り振りを反映（未導入/未付与なら無視）
    let emblemAlloc = null
    try {
      const { data: em } = await supabase.from('player_emblem').select('alloc').eq('player_id', user.id).maybeSingle()
      if (em?.alloc && Object.keys(em.alloc).length > 0) emblemAlloc = em.alloc
    } catch { /* 紋章未導入時は無視 */ }
    setProfile({ ...prof, petCharm, petStat, activePet, emblemAlloc })
    setEquipment(eq || [])
    setProficiency(prof2 || [])
    setSkillSets(selectBattleSkillSets(ss, 'challenge'))
    if (prof.ability_title_id) {
      const { data: at } = await supabase.from('titles').select('*').eq('id', prof.ability_title_id).single()
      setAbilityTitle(at || null)
    }
    await fetchStatus()
  }

  const fetchStatus = async () => {
    try {
      const { data } = await supabase.rpc('emblem_get')
      if (data?.ok) {
        setWinsToday(data.wins_today || 0)
        setClears(data.clears || {})
      }
    } catch { /* SQL未適用時は無視 */ }
  }

  const winsLeft = Math.max(0, HACHIGOKU_DAILY_WINS - winsToday)

  const handleChallenge = async () => {
    if (!selectedHell || !profile || battling || remaining > 0) return
    if (winsLeft <= 0) return
    const hell = HACHIGOKU_HELLS.find(h => h.key === selectedHell)
    const enemy = makeHachigokuEnemy(selectedHell, selectedDiff)
    if (!hell || !enemy) return
    setBattleInfo({ hell, diff: selectedDiff })
    setBattling(true); setScene('battle'); setBattleLogs([]); setReward(null); setResultMsg(null)
    setRemaining(HACHIGOKU_CD)

    // 何が起きても必ず setBattling(false) に到達させ、「戦闘中...」で固まらないようにする。
    try {
      const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
      let curSets = skillSets
      if (curSets.length === 0) {
        const { data: ss2 } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', profile.id).order('slot_order')
        if (Array.isArray(ss2) && ss2.length) {
          curSets = selectBattleSkillSets(ss2, 'challenge')
          setSkillSets(curSets)
        }
      }
      const { logs, win } = simulateHachigokuBattle(eff, equipment, curSets, profile, { ...enemy })
      setBattleLogs(logs)

      if (win) {
        const diffIdx = HACHIGOKU_DIFFICULTIES.findIndex(d => d.key === selectedDiff)
        const { data, error } = await supabase.rpc('hachigoku_result', { p_hell: selectedHell, p_diff: diffIdx })
        if (error || data?.error) {
          const code = data?.error || error?.message
          setResultMsg(code === 'daily_limit'
            ? '本日の挑戦回数（3勝）を使い切っています。報酬はありません。'
            : `報酬の受け取りに失敗しました（${code}）。SQL未実行の可能性: supabase_emblem_hachigoku.sql を実行してください。`)
        } else {
          setReward(data)
          await fetchStatus()
        }
      }
    } catch (e) {
      console.error('[hachigoku] handleChallenge failed:', e)
      setResultMsg('戦闘処理でエラーが発生しました。再挑戦してください。')
    } finally {
      setBattling(false)
    }
  }

  if (scarecrowBlock) return <ScarecrowBlockScreen endsAt={scarecrowBlock.ends_at} />
  if (!profile) {
    return <div style={{ color:'#ff8866', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>
  }

  // 開発アカウント限定
  if (!profile.is_admin) {
    return (
      <div style={{ minHeight:'100vh', background:'#100505', padding:'12px', fontFamily:'monospace' }}>
        <div style={{ maxWidth:'640px', margin:'0 auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #5a1f1f', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#100505' }}>
            <div style={{ color:'#ff9977', fontSize:'16px', letterSpacing:'3px' }}>🔥 八獄</div>
            <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #aa4444', color:'#cc7766', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
          </div>
          <div style={{ border:'1px solid #6a2a2a', background:'#220a0a', padding:'24px', textAlign:'center', color:'#dd9988', fontSize:'13px', lineHeight:'1.9' }}>
            🚧 八獄は現在【開発中】です。<br/>調整が完了するまでお待ちください。
          </div>
        </div>
      </div>
    )
  }

  const hell = selectedHell ? HACHIGOKU_HELLS.find(h => h.key === selectedHell) : null
  const diffIdxOf = (k) => HACHIGOKU_DIFFICULTIES.findIndex(d => d.key === k)
  const canChallenge = !!selectedHell && winsLeft > 0 && remaining <= 0 && !battling

  return (
    <div style={{ minHeight:'100vh', background:'#100505', padding:'12px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'680px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #5a1f1f', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#100505' }}>
          <div style={{ color:'#ff9977', fontSize:'16px', letterSpacing:'3px' }}>🔥 八獄</div>
          <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #aa4444', color:'#cc7766', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
        </div>

        {scene === 'lobby' && (
          <>
            <div style={{ border:'1px solid #6a2a2a', background:'#1c0808', padding:'12px', marginBottom:'12px' }}>
              <div style={{ color:'#dd9988', fontSize:'12px', lineHeight:'1.9' }}>
                本日の残り挑戦回数: <span style={{ color: winsLeft > 0 ? '#ffcc66' : '#ff5555', fontWeight:'bold' }}>{winsLeft}</span> ／ {HACHIGOKU_DAILY_WINS}回
                <span style={{ color:'#aa6655', fontSize:'10px', marginLeft:'8px' }}>(開発アカウント限定)</span>
              </div>
              <div style={{ color:'#aa6655', fontSize:'10px', marginTop:'4px', lineHeight:'1.7' }}>
                八つの地獄の主に挑み、紋章を鍛える<span style={{ color:'#ffaa88' }}>結晶・紋章の欠片・獄卒の魂</span>を勝ち取ろう（報酬は確率ドロップ）。<br/>
                挑戦は1日{HACHIGOKU_DAILY_WINS}回まで（毎朝5時リセット）。<span style={{ color:'#88ccff' }}>敗北しても回数は減りません。</span><br/>
                各地獄の<span style={{ color:'#cc66ff' }}>Hell初回クリア</span>で紋章の最終上限開放に必要な「記憶」を獲得。
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'8px' }}>
              {HACHIGOKU_HELLS.map(h => {
                const sel = selectedHell === h.key
                const cl = clears[h.key]
                const maxDiff = cl?.maxDiff ?? -1
                return (
                  <div key={h.key} onClick={()=>setSelectedHell(sel ? null : h.key)}
                    style={{ border:`1px solid ${sel ? '#ff8855' : '#5a2a2a'}`, background: sel ? '#2a0e08' : '#180808', padding:'12px', cursor:'pointer' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                        {h.img
                          ? <img src={h.img} alt={h.boss} style={{ width:'44px', height:'44px', objectFit:'contain' }} />
                          : <div style={{ width:'44px', height:'44px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'26px', background:'#0d0404', border:'1px solid #3a1a1a' }}>👹</div>}
                        <div>
                          <div style={{ color: sel ? '#ffbb99' : '#dd9977', fontSize:'14px', fontWeight:'bold' }}>{h.name}　<span style={{ fontSize:'12px' }}>{h.boss}</span></div>
                          <div style={{ color:'#aa6655', fontSize:'10px', marginTop:'2px' }}>テーマ: {h.theme} ／ ドロップ: {h.crystals.length}種の結晶</div>
                        </div>
                      </div>
                      <div style={{ textAlign:'right', fontSize:'10px', lineHeight:'1.8' }}>
                        {maxDiff >= 0 && <div style={{ color:'#66cc88' }}>✓ {HACHIGOKU_DIFFICULTIES[maxDiff]?.label}撃破</div>}
                        {cl?.memory && <div style={{ color:'#cc88ff' }}>📿 記憶 獲得済</div>}
                      </div>
                    </div>
                    {sel && (
                      <div style={{ marginTop:'10px', borderTop:'1px solid #3a1a1a', paddingTop:'10px' }}>
                        <div style={{ color:'#cc8877', fontSize:'11px', lineHeight:'1.7', marginBottom:'8px' }}>{h.desc}</div>
                        <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }} onClick={e=>e.stopPropagation()}>
                          {HACHIGOKU_DIFFICULTIES.map(d => {
                            const selD = selectedDiff === d.key
                            return (
                              <button key={d.key} onClick={()=>setSelectedDiff(d.key)}
                                style={{ padding:'6px 10px', background: selD ? '#331111' : '#150606', border:`1px solid ${selD ? d.color : '#3a1a1a'}`, color: selD ? d.color : '#886655', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                                {d.label}<span style={{ fontSize:'9px', marginLeft:'4px' }}>推奨{fmt(d.target)}</span>
                              </button>
                            )
                          })}
                        </div>
                        <div style={{ marginTop:'8px', fontSize:'10px', color:'#aa6655' }}>
                          対応する結晶: {h.crystals.length}種 ／ 魂ドロップ率は高難易度ほどUP（Hellで大幅UP）
                        </div>
                        <button onClick={(e)=>{ e.stopPropagation(); handleChallenge() }} disabled={!canChallenge}
                          style={{ width:'100%', marginTop:'10px', padding:'12px', background: canChallenge ? '#401510' : '#1c0a08', border:`1px solid ${canChallenge ? '#ff8855' : '#4a2a22'}`, color: canChallenge ? '#ffbb99' : '#6a4a44', cursor: canChallenge ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'13px', letterSpacing:'2px' }}>
                          {winsLeft <= 0 ? '本日の挑戦回数を使い切った（毎朝5時リセット）'
                            : remaining > 0 ? `⏳ ${remaining.toFixed(1)}秒`
                            : `⚔ ${h.name}【${HACHIGOKU_DIFFICULTIES[diffIdxOf(selectedDiff)]?.label}】に挑む`}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {scene === 'battle' && battleInfo && (
          <div style={{ border:'1px solid #6a2a2a', background:'#1a0808', padding:'12px' }}>
            <div style={{ color:'#ff9977', fontSize:'13px', marginBottom:'10px' }}>
              ⚔ {battleInfo.hell.name}【{HACHIGOKU_DIFFICULTIES[diffIdxOf(battleInfo.diff)]?.label}】 {battleInfo.hell.boss} 戦
            </div>
            {battling && <div style={{ color:'#cc8866', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
            <div style={{ marginBottom:'12px', maxHeight:'46vh', overflowY:'auto' }}>
              {battleLogs.map((l,i)=>(<BattleLogLine key={i} l={l} />))}
              <div ref={logsEndRef} />
            </div>

            {reward && (
              <div style={{ border:'1px solid #ffcc44', background:'#1a1400', padding:'12px', marginBottom:'10px' }}>
                <div style={{ color:'#ffcc44', fontSize:'13px', marginBottom:'6px' }}>🎉 勝利！ 報酬獲得（残り{reward.wins_left}回）</div>
                <div style={{ fontSize:'11px', color:'#ffcc66', lineHeight:'1.9' }}>
                  {Object.entries(reward.drops || {}).map(([name, n]) => (
                    <div key={name}>{name.includes('魂') ? '👹' : name.includes('記憶') ? '📿' : name.includes('欠片') ? '🧩' : '💠'} {name} ×{n}</div>
                  ))}
                  {Object.keys(reward.drops || {}).length === 0 && <div>（今回はドロップなし…）</div>}
                </div>
                {reward.got_memory && <div style={{ color:'#cc88ff', fontSize:'10px', marginTop:'6px' }}>Hell初回クリア！「記憶」を手に入れた！</div>}
              </div>
            )}
            {resultMsg && (
              <div style={{ border:'1px solid #aa4466', background:'#1a0a14', padding:'10px', marginBottom:'10px', color:'#ff8899', fontSize:'11px' }}>{resultMsg}</div>
            )}

            {!battling && (
              <button onClick={()=>{ setScene('lobby'); setBattleLogs([]) }}
                style={{ width:'100%', padding:'10px', background:'#301010', border:'1px solid #aa4444', color:'#cc8877', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                ← 戻る
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
