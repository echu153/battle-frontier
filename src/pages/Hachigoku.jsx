import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useScarecrowBlock, ScarecrowBlockScreen } from '../components/IdleGuard'
import { getWeaponGroup } from '../lib/stats'
import { evoOnHit, evoOnDamaged, evoOnEvade, evoTakenMult, evoAllSkillsSet, evoAtkMult, evoMatkMult, evoBlocksAilment } from '../lib/evoCombat'
import { emblemDmgMult, emblemDrainAmount, emblemDotMult, emblemBlocksAilment } from '../lib/emblemCombat'
import { petPlayerBonus } from '../constants/pets'
import { loadCharmBonus, PET_STAT_SELECT } from '../lib/petBonus'
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
import { HACHIGOKU_HELLS, HACHIGOKU_DIFFICULTIES, HACHIGOKU_DAILY_WINS, HACHIGOKU_DMG_COMPRESS, makeHachigokuEnemy, isHachigokuUnlocked } from '../lib/hachigoku'
import { EMBLEM_CRYSTALS } from '../lib/emblem'

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
export function simulateHachigokuBattle(eff, equipment, skillSets, profile, enemy) {
  const logs = []
  const mods = enemy.mods || {}
  // 与ダメ・敵HPを同率圧縮（撃破ターン数は不変・与ダメ比例回復だけを抑える）
  // DoTは敵最大HP割合ダメージなのでHP圧縮と一緒に自動で縮む（hellDRは掛けない）
  enemy.hp = Math.max(1, Math.round(enemy.hp * HACHIGOKU_DMG_COMPRESS))
  const hellDR = (1 - Math.min(0.9, mods.flatDR || 0)) * HACHIGOKU_DMG_COMPRESS  // 敵の被ダメ一律軽減（DoTは貫通）＋全地獄共通の与ダメ圧縮
  // 焦熱=特殊半減/氷結=物理半減/血池=両方半減 等。物理/特殊で敵の被ダメ倍率を分ける（DoTは対象外）
  const typeTakenMult = (isPhys) => isPhys ? (mods.physTakenMult ?? 1) : (mods.specialTakenMult ?? 1)
  // 血池: 状態異常DoTダメージ3倍（敵が受けるDoT tickに乗算）
  const dotTakenMult = mods.dotTakenMult || 1
  // 餓鬼: プレイヤーの全回復量の倍率（回復スキル/リジェネ/ブラッディロア/紋章吸収/持続回復）
  const hellHealMult = mods.playerHealMult || 1
  // 鏡獄: プレイヤーの実効ステ(A/B/C/D/S)を×nで自身に反映（HPは難易度準拠のまま）
  if (mods.mirrorPlayerStats > 0) {
    const m = mods.mirrorPlayerStats
    enemy.atk  = Math.max(1, Math.round(eff.atk  * m))
    enemy.matk = Math.max(1, Math.round(eff.matk * m))
    enemy.def  = Math.max(1, Math.round(eff.def  * m))
    enemy.mdef = Math.max(1, Math.round(eff.mdef * m))
    enemy.spd  = Math.max(1, Math.round(eff.spd  * m))
  }
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
  if (enemy.passive) logs.push({ text:`👁 パッシブ「${enemy.passive}」`, color:'#ffaa66' })

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

  // 針山: 防御・特防を常時3倍 ／ 叫喚: ターン経過ごとに累積1.1倍（呼び出し時点のturnで算出）／ 大技の自己防御バフ
  let ultDefMult = 1  // 針山の大技: 発動後、防御・特防を追加でn倍
  const enemyDefMult = () => (mods.selfDefMult || 1) * (mods.defRamp ? Math.pow(mods.defRamp, Math.max(0, turn - 1)) : 1) * ultDefMult
  let permLifesteal = 0  // 餓鬼の大技: 戦闘終了まで与ダメ×nを回復
  let permBleed = false  // 血池の大技: 以降、攻撃命中ごとに出血を確定付与

  const playerSpd = effectiveSpdForCalc
  const enemySpd = enemy.spd || 5
  const playerExtraRate = calcExtraActionRate(playerSpd, enemySpd)
  const enemyExtraRate  = calcExtraActionRate(enemySpd, playerSpd)
  // 天墜竜閃を使ったターン（溜め・解放とも）は追加行動を出さない（tenkaiChargeは解放時にクリアされタイミング依存になるため明示フラグで抑止）
  let tenkaiActedThisTurn
  const playerCritRate  = calcCritRate(playerSpd, enemySpd) + (eff.critBonus || 0)
  // 黒縄: 敵クリティカル率ブースト（紋章のクリティカル抵抗で減らせる）
  const enemyCritRate   = Math.max(0, calcCritRate(enemySpd, playerSpd) + (mods.critBoost || 0) - (eff.critResist || 0))
  const enemyCritMult   = 1.5 + (mods.critDmgPlus || 0)
  const enemyEvasionRate  = calcEvasionRate(enemySpd, effectiveSpdForCalc)
  const playerHitBonus = (eff.hitBonus || 0) + passiveHitBonus

  const doPlayerAttack = (isExtra = false) => {
    playerAttacking = true
    const enemyAilBefore = snapshotEnemyAil()  // 鏡獄: 状態異常反射の差分検知用
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
    const prefix = isExtra ? `↳ ${profile.username} の` : `${profile.username} の`
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
          const adjED = Math.max(1, Math.floor((enemy.def||0)*enemyDefMult()*eDefRate))
          const fScale = effBuff.atk / (effBuff.atk + adjED)
          const fCrit = Math.random()*100 < playerCritRate
          const fCritMult = fCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
          const dr = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
          let fDmg = Math.floor(resPeek.followup.dmg * fScale * fCritMult * passiveDmgMult * dr * hellDR * typeTakenMult(nextSkill.type === '物理攻撃') * (0.9 + Math.random()*0.2))
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
        const cmd = tryPetCommand(cs.skills.name, summon, { def: enemy.def, mdef: enemy.mdef, atk: enemy.atk, matk: enemy.matk, type: enemy.type, name: enemy.name, evasionRate: 0 }, enemyBuffs, playerBuffs, rtCur, playerMp, mpCost, eff.hp_max, logs, ``)
        if (cmd.handled) {
          playerMp -= cmd.mpUsed
          // 召喚ダメージは物理/特殊が混在するため、被ダメ半減パッシブは強い方の軽減を適用（迂回防止）
          if (cmd.enemyDamage > 0) enemyHp -= Math.floor(cmd.enemyDamage * hellDR * Math.min(typeTakenMult(true), typeTakenMult(false)))
          if (cmd.playerHeal > 0) playerHp = Math.min(eff.hp_max, playerHp + Math.floor(cmd.playerHeal * hellHealMult))
          prevSkillName = cs.skills.name
          skillUsed = true; skillIndex++
        }
      } else if (cs && cs.skills && playerMp >= mpCost) {
        playerMp -= mpCost
        if (cs.skills.name === '天墜竜閃') tenkaiActedThisTurn = true  // 溜め/解放どちらでも当ターンは追加行動なし
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
          const adjED  = Math.max(1, Math.floor((enemy.def ||0)*enemyDefMult()*eDefRate*(1-Math.min(0.8,(res.defPen||0)+buffPen))))
          const adjEMD = Math.max(1, Math.floor((enemy.mdef||0)*enemyDefMult()*eMdefRate*(1-Math.min(0.8,(res.mdefPen||0)+spMdefPen))))
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
          const hitMult = defScale * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * nextBoostMult * enemyDmgReduceMult * hellDR * typeTakenMult(isPhysSkill) * emMult
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
          finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * nextBoostMult * enemyDmgReduceMult * hellDR * typeTakenMult(isPhysSkill) * emMult * (0.9 + Math.random() * 0.2))
          resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
        }
        if (res.selfDmg > 0) playerHp = Math.max(0, playerHp - res.selfDmg)
        enemyHp -= finalDmg
        // 紋章: 物理/特殊吸収（与ダメの一定割合を回復・回復封じ中は無効）
        // HPが動くので事象は残すが、出所（紋章）は書かない
        { const emDrain = Math.floor(emblemDrainAmount(eff, finalDmg, isPhysSkill) * hellHealMult); if (emDrain > 0 && !(playerBuffs.healSeal?.turns > 0)) { playerHp = Math.min(eff.hp_max, playerHp + emDrain); logs.push({ text:`💚 HPが${emDrain}回復した！`, color:'#44ff88' }) } }
        if (hasRokkan && pe('サイキッカー') && finalDmg > 0 && cs.skills?.type === '魔法攻撃') rokkanStacks = Math.min(6, rokkanStacks+1)
        if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
          enemyBuffs.healDown = { turns: 2, rate: 0.7 }  // 装備由来なので無言で付与（発動ログは出さない）
        }
        if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_spd_down_5') {
          const curSd = enemyBuffs.spdDown
          const amzSt = Math.min(4, ((curSd?.turns > 0 && curSd.amazaneStacks) || 0) + 1)
          const amzRate = Math.round((1 - 0.05 * amzSt) * 100) / 100
          if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) {
            enemyBuffs.spdDown = { turns: 2, rate: amzRate, amazaneStacks: amzSt }
          }
        }
        evoOnHit(eff, finalDmg, enemyBuffs, enemy.name, logs, isMulti ? multiCritAny : finalCrit)
        if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(enemyBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
          enemyBuffs.paralysis = { turns: 3, skipRate: 0.25, spdRate: 0.8 }  // 装備由来なので無言で付与（発動ログは出さない）
        }
        const healAmt = playerBuffs.healSeal?.turns > 0 ? 0 : Math.floor(res.heal * passiveHealMult * hellHealMult * (playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1))  // ルミナ等の回復力アップ＋餓鬼の回復半減を反映
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
        // 直前に付与した装備デバフ(毒/出血/素早さダウン等)を捨てないようマージ（=で置換すると消える。Game.jsxと同構造）
        playerBuffs = { ...playerBuffs, ...res.newPlayerBuffs }; enemyBuffs = { ...enemyBuffs, ...res.newEnemyBuffs }
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
          let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * enemyDmgReduceMult * hellDR * typeTakenMult(isPhysSkill) * emMult * (0.9 + Math.random()*0.2))
          fDmg = Math.max(1, fDmg)
          enemyHp -= fDmg
          logs.push({ text:`↳ 追撃！${res.followup.label?`（${res.followup.label}）`:''} ${enemy.name}に${fDmg}ダメージ！${fCrit?' 💥クリティカル！':''}`, color: fCrit?'#ffaa00':'#ffaa66' })
        }
        // 与ダメ割合回復の1ヒット上限：基本 最大HP20%、クリティカル時35%（血の狂気/ソウルドレイン/ルミナ・レイ共通）
        const healCapPct = (finalCrit || multiCritAny) ? 0.35 : 0.20
        if (playerAttacking && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate * hellHealMult), Math.floor(eff.hp_max * healCapPct))
          playerHp = Math.min(eff.hp_max, playerHp + rageCure)
          logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
        }
        // 与ダメ割合回復(ソウルドレイン/ルミナ・レイ等)：実際の与ダメージ(クリティカル込み)から回復（餓鬼の回復半減も適用）
        if (res.drainRate > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const drainHeal = Math.min(Math.floor(finalDmg * res.drainRate * hellHealMult), Math.floor(eff.hp_max * healCapPct))
          playerHp = Math.min(eff.hp_max, playerHp + drainHeal)
          logs.push({ text:`💚 HPを${drainHeal}回復！`, color:'#66ffaa' })
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
      const eDefVal = isMagical ? Math.max(1, Math.floor((enemy.mdef||0)*enemyDefMult()*eMdefRate)) : Math.max(1, Math.floor(enemy.def*enemyDefMult()*eDefRate))
      const baseDmg = Math.max(1, Math.floor(baseAtk*baseAtk/Math.max(1,baseAtk+eDefVal))+Math.floor(Math.random()*4))
      const enemyDmgReduceMult2 = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
      const iaiNormalMult = isMagical ? 1.0 : iaiPhysMult
      const rokkanMultN = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05 * Math.min(6, rokkanStacks)) : 1.0
      seimitsuStacks = 0; prevSkillName = null
      let finalDmg = Math.floor(baseDmg*0.7*critMult*(isArtifact?1.3:1.0)*passiveDmgMult*iaiNormalMult*rokkanMultN*enemyDmgReduceMult2*hellDR*typeTakenMult(!isMagical)*emblemDmgMult(eff, !isMagical)*(0.9+Math.random()*0.2))
      enemyHp -= finalDmg
      // 紋章: 物理/特殊吸収
      // HPが動くので事象は残すが、出所（紋章）は書かない
      { const emDrain = Math.floor(emblemDrainAmount(eff, finalDmg, !isMagical) * hellHealMult); if (emDrain > 0 && !(playerBuffs.healSeal?.turns > 0)) { playerHp = Math.min(eff.hp_max, playerHp + emDrain); logs.push({ text:`💚 HPが${emDrain}回復した！`, color:'#44ff88' }) } }
      if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
        enemyBuffs.healDown = { turns: 2, rate: 0.7 }  // 装備由来なので無言で付与（発動ログは出さない）
      }
      if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_spd_down_5') {
        const curSd = enemyBuffs.spdDown
        const amzSt = Math.min(4, ((curSd?.turns > 0 && curSd.amazaneStacks) || 0) + 1)
        const amzRate = Math.round((1 - 0.05 * amzSt) * 100) / 100
        if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) {
          enemyBuffs.spdDown = { turns: 2, rate: amzRate, amazaneStacks: amzSt }
        }
      }
      evoOnHit(eff, finalDmg, enemyBuffs, enemy.name, logs, isCrit)
      // 装備由来: 追加行動の攻撃ヒット時、eff.extraParaChance%で相手を麻痺（無言で付与）
      if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(enemyBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
        enemyBuffs.paralysis = { turns: 3, skipRate: 0.25, spdRate: 0.8 }
      }
      const critText = isCrit ? '💥クリティカル！ ' : ''
      logs.push({ text:`${prefix}${critText}攻撃！ ${enemy.name}に${finalDmg}ダメージ！`, color:'#ffcc00' })
      if (playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
        const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate * hellHealMult), Math.floor(eff.hp_max * (isCrit ? 0.35 : 0.20)))
        playerHp = Math.min(eff.hp_max, playerHp + rageCure)
        logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
      }
      if (expandedSkillSet.length > 0) skillIndex++
    }
    reflectNewAilments(enemyAilBefore)  // 鏡獄: この攻撃で敵に付けた状態異常を跳ね返す
    playerAttacking = false
  }

  // 状態異常を1件付与（装備のシールド ailmentShield/紋章耐性/狂信で防げる）。付与できたら true
  const AIL_LABEL = { burn:'やけど', poison:'毒', bleed:'出血', paralysis:'麻痺', stun:'スタン' }
  const inflictAilment = (key, msg) => {
    if (playerHp <= 0) return false
    if (playerBuffs.statusImmune?.turns > 0) return false
    if (key !== 'stun' && key !== 'bleed' && playerBuffs[key]?.turns > 0) return false
    if (ailmentShieldBlocks(playerBuffs, logs)) return false
    if (emblemBlocksAilment(eff, key, logs)) return false
    if (evoBlocksAilment(eff, key, logs)) return false  // アクアクラウン(真化)
    if (key === 'burn')      playerBuffs.burn = { turns:5, dmgRate:0.02 }
    else if (key === 'poison')    playerBuffs.poison = { turns:4, dmgRate:0.03 }
    else if (key === 'paralysis') playerBuffs.paralysis = { turns:4, skipRate:0.25, spdRate:0.8 }
    else if (key === 'stun')      playerBuffs.stun = { turns:1 }
    else if (key === 'bleed') {
      const b = playerBuffs.bleed
      playerBuffs.bleed = { stacks: Math.min(5, (b?.stacks || 0) + 1), lastTurn: 0 }
    }
    logs.push({ text: msg || `🌫 ${enemy.name}の獄気！ ${AIL_LABEL[key]}を負わされた！`, color:'#aa66ff' })
    return true
  }

  // 敵の攻撃命中時: 地獄ごとの状態異常付与（確率）
  const applyOnHitAilments = () => {
    if (!mods.onHitAilment || playerHp <= 0) return
    for (const { key, chance } of mods.onHitAilment) {
      if (Math.random() * 100 >= chance) continue
      inflictAilment(key)
    }
  }

  // 鏡獄: 状態異常反射。プレイヤーが敵に付与した状態異常を、同じものプレイヤーへ跳ね返す。
  const AIL_REFLECT_KEYS = ['burn', 'poison', 'severePoisoin', 'bleed', 'paralysis', 'stun']
  const snapshotEnemyAil = () => {
    if (!mods.reflectAilments) return null
    const s = {}
    for (const k of AIL_REFLECT_KEYS) s[k] = k === 'bleed' ? (enemyBuffs.bleed?.stacks || 0) : (enemyBuffs[k]?.turns > 0 ? 1 : 0)
    return s
  }
  const reflectNewAilments = (before) => {
    if (!mods.reflectAilments || !before || playerHp <= 0) return
    for (const k of AIL_REFLECT_KEYS) {
      const now = k === 'bleed' ? (enemyBuffs.bleed?.stacks || 0) : (enemyBuffs[k]?.turns > 0 ? 1 : 0)
      if (now > before[k]) {
        const rk = k === 'severePoisoin' ? 'poison' : k  // 猛毒は毒として反射
        inflictAilment(rk, `🪞 ${enemy.name}の鏡映！ 与えた${AIL_LABEL[rk]}が跳ね返った！`)
      }
    }
  }

  // 全ボス共通: プレイヤーの強化バフを解除（状態異常デバフは残す）。行動には含まれない。
  // ※Hell限定ギミック。Easy〜EXTREMEでは発動しない。
  const EMBLEM_POS_BUFFS = ['atkUp','matkUp','spdUp','defUp','mdefUp','dmgReduce','regenHeal','evasion','hitBonus','bloodRage','statusImmune','holyField','holyAwakening','flashCombo','critResist','healUp','ailmentShield','nextSkillBoost','mukyoPen','tenkaiCharge']
  const dispelPlayerBuffs = () => {
    if (!enemy.isHell) return
    let removed = 0
    for (const k of EMBLEM_POS_BUFFS) {
      if (playerBuffs[k] && (playerBuffs[k].turns > 0 || playerBuffs[k].turns === undefined || playerBuffs[k].charges > 0)) { delete playerBuffs[k]; removed++ }
    }
    if (removed > 0) logs.push({ text:`🌀 ${enemy.name}の獄気！ あなたの強化を${removed}つ解除した！`, color:'#cc66ff' })
  }

  // cast: 敵スキル/大技 { name, mult, isUlt, inflict, critGuaranteed, lifesteal, randomAilments }（nullなら通常攻撃）
  const doEnemyAttack = (isExtra = false, cast = null) => {
    if (summonAbsorbBasic(summon, { atk: enemy.atk, matk: enemy.matk, type: enemy.type, name: enemy.name }, enemyBuffs, turn, logs)) return
    const holyFieldDefE = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
    const holyKnightMultE = hasHolyKnightPassive ? (pe('聖騎士')?2.0:1.5) : 1.0
    const kabeDefE = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
    // 針山: 敵の攻撃はプレイヤー防御を割合無視（mods.defPen）。大技はさらに強い貫通（cast.pen）
    const penMult = 1 - Math.max(mods.defPen || 0, cast?.pen || 0)
    const pDef  = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1) * holyFieldDefE * holyKnightMultE * kabeDefE * ryurinMult * penMult
    const pMdef = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1) * holyFieldDefE * holyKnightMultE * kabeDefE * ryurinMult * penMult
    const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
    const berserkDmgRate = hasBerserk ? (pe('狂戦士')?1.20:1.15) : 1.0
    const isEM = enemy.type === 'magical'
    const isHybrid = !!mods.hybridAttack  // 両刀: A(攻撃)とC(特攻)の平均で殴り、対プレイヤーは低い方の防御を参照
    const burnDebuffE = enemyBuffs.burn?.turns > 0 ? 0.9 : 1.0
    const eAtk = isHybrid
      ? (((enemy.atk||0) * (enemyBuffs.atkUp ? enemyBuffs.atkUp.rate : 1) + (enemy.matk||0) * (enemyBuffs.matkUp ? enemyBuffs.matkUp.rate : 1)) / 2) * burnDebuffE
      : isEM
      ? (enemy.matk||0) * (enemyBuffs.matkUp ? enemyBuffs.matkUp.rate : 1) * burnDebuffE
      : enemy.atk * (enemyBuffs.atkUp ? enemyBuffs.atkUp.rate : 1) * burnDebuffE
    // 大技の高クリ率(critChance)は会耐(eff.critResist)で下げられる。critGuaranteedは会耐無視の確定クリ（下位互換）
    const isCrit = cast?.critGuaranteed ? true
      : cast?.critChance ? Math.random()*100 < Math.max(0, cast.critChance - (eff.critResist || 0))
      : Math.random()*100 < enemyCritRate
    const defForCalc = isHybrid ? Math.max(1, Math.min(pDef, pMdef)) : isEM ? Math.max(1, pMdef) : Math.max(1, pDef)
    const baseDmg = Math.max(1, Math.floor(eAtk*eAtk/Math.max(1,eAtk+defForCalc) * (cast?.mult || 1))+Math.floor(Math.random()*3))
    const enemySpdBuff = enemyBuffs.spdUp ? enemyBuffs.spdUp.rate : 1
    const enemySpdDebuff = enemyBuffs.spdDown?.turns > 0 ? enemyBuffs.spdDown.rate : 1
    const playerSpdDebuff = playerBuffs.spdDown ? playerBuffs.spdDown.rate : 1
    const effectivePlayerSpd = effectiveSpdForCalc * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1) * playerSpdDebuff
    const effectiveEnemySpd = enemySpd * enemySpdBuff * enemySpdDebuff
    // 大技（isUlt）は必中。通常攻撃・通常スキルは回避可能
    const evasionRate = cast?.isUlt ? 0 : calcEvasionRate(effectivePlayerSpd, effectiveEnemySpd) + (eff.evasionBonus || 0) + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0) + (hasOnmi ? 5 : 0)
    if (evasionRate > 0 && Math.random()*100 < evasionRate) {
      const prefix = isExtra ? '↳ ' : ''
      logs.push({ text:`${prefix}${enemy.name}の${cast ? `「${cast.name}」` : '攻撃'}！ しかし回避した！`, color:'#44ff88' })
      evoOnEvade(eff, playerBuffs, logs)
      return
    }
    const enemyDmgDownRate = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
    // 針山: ランク軽減も無効化される ／ 両刀: 低い方の防御ランクを参照
    const rankDefStat = isHybrid ? Math.min(eff.def, eff.mdef) : (isEM ? eff.mdef : eff.def)
    const playerDefRankReduction = penMult < 1 ? calcDefReduction(rankDefStat) * penMult : calcDefReduction(rankDefStat)
    const gambleBodyMult = hasGambleBody ? (pe('ギャンブラー') ? (0.5+Math.random()*0.7) : (0.7+Math.random()*0.6)) : 1.0
    const allinDebuffInMult = playerBuffs.allinDebuff?.turns > 0 ? 1.3 : 1.0
    // 黒縄: クリティカル以外のダメージ半減（mods.nonCritMult）
    const critOrNotMult = isCrit ? enemyCritMult : (mods.nonCritMult || 1)
    // 叫喚の大技: 自身と相手の(防御+特防)の差が大きいほど与ダメ増加（最大3倍）
    let gapMult = 1
    if (cast?.defGapScale) {
      const eSum = (enemy.def + enemy.mdef) * enemyDefMult()
      const pSum = Math.max(1, eff.def + eff.mdef)
      gapMult = Math.min(3, Math.max(1, 1 + Math.max(0, eSum - pSum) / pSum))
    }
    const finalDmg = Math.floor(baseDmg*critOrNotMult*gapMult*dmgReduceRate*berserkDmgRate*enemyDmgDownRate*(1-playerDefRankReduction)*gambleBodyMult*allinDebuffInMult*evoTakenMult(eff, !isEM, playerHp / eff.hp_max)*ryurinReduce()*(0.9+Math.random()*0.2))
    playerHp -= finalDmg
    { const refl = evoOnDamaged(eff, finalDmg, enemyBuffs, enemy.name, logs); if (refl > 0) enemyHp -= refl }
    if (playerBuffs.dmgReduce?.isGainoKabe) playerBuffs.dmgReduce = null
    const prefix = isExtra ? '↳ ' : ''
    const critText = isCrit ? ' 💥クリティカル！' : ''
    logs.push({ text:`${prefix}${enemy.name}の${cast ? `「${cast.name}」` : '攻撃'}！ あなたに${finalDmg}ダメージ…${critText}`, color: cast?.isUlt ? '#ff2266' : isCrit ? '#ff2200' : '#ff6644' })
    // 餓鬼: 与えたダメージの一定割合を吸収して回復（自身の回復2倍＋大技後は永続100%吸収）
    const lsRate = Math.max(mods.lifesteal || 0, cast?.lifesteal || 0, permLifesteal)
    if (lsRate > 0 && finalDmg > 0 && enemyHp > 0) {
      // 濡羽杖等の回復力ダウン(healDown)を敵の吸収回復にも適用
      const enHealDown = enemyBuffs.healDown?.turns > 0 ? enemyBuffs.healDown.rate : 1
      const heal = Math.floor(finalDmg * lsRate * (mods.selfHealMult || 1) * enHealDown)
      if (heal > 0) {
        enemyHp = Math.min(enemyMaxHp, enemyHp + heal)
        logs.push({ text:`🧛 ${enemy.name}はあなたの生気を喰らい${heal}回復した！`, color:'#cc66aa' })
      }
    }
    if (finalDmg > 0) applyOnHitAilments()
    // 血池の大技発動後: 以降の攻撃命中ごとに出血を確定付与（羽衣/紋章耐性/狂信で防げる）
    if (finalDmg > 0 && permBleed) inflictAilment('bleed')
    // 大技の確定付与（羽衣/紋章耐性/狂信で防げる）
    if (finalDmg > 0 && cast?.inflict) for (const key of cast.inflict) inflictAilment(key)
    // 血池の大技: 出血を一気にnスタック
    if (finalDmg > 0 && (cast?.bleedStacks || 0) > 0 && playerHp > 0 && !(playerBuffs.statusImmune?.turns > 0)
        && !ailmentShieldBlocks(playerBuffs, logs) && !emblemBlocksAilment(eff, 'bleed', logs) && !evoBlocksAilment(eff, 'bleed', logs)) {
      const b = playerBuffs.bleed
      playerBuffs.bleed = { stacks: Math.min(5, (b?.stacks || 0) + cast.bleedStacks), lastTurn: 0 }
      logs.push({ text:`🩸 傷口が一斉に開いた！ 出血${playerBuffs.bleed.stacks}スタック！`, color:'#ff3366' })
    }
    // 大技の追加効果: 自己回復（血池）／永続吸収（餓鬼）。healDown(回復力ダウン)も適用
    if (cast?.selfHealPct > 0 && enemyHp > 0) {
      const heal = Math.floor(enemyMaxHp * cast.selfHealPct * (mods.selfHealMult || 1) * (enemyBuffs.healDown?.turns > 0 ? enemyBuffs.healDown.rate : 1))
      enemyHp = Math.min(enemyMaxHp, enemyHp + heal)
      logs.push({ text:`💚 ${enemy.name}は血の池に浸りHPを${heal}回復した！`, color:'#44ff88' })
    }
    if (cast?.permLifesteal > 0 && permLifesteal < cast.permLifesteal) {
      permLifesteal = cast.permLifesteal
      logs.push({ text:`🧛 ${enemy.name}の飢えが臨界に達した！ 以降、与えたダメージをすべて喰らい尽くす！`, color:'#cc66aa' })
    }
    if (cast?.permBleed && !permBleed) {
      permBleed = true
      logs.push({ text:`🩸 ${enemy.name}の刃が血に飢えた！ 以降、攻撃を受けるたびに出血する！`, color:'#ff3366' })
    }
    // 針山の大技: 発動後、自身の防御・特防をn倍（パッシブの3倍にさらに乗算）
    if (cast?.selfDefBoost > 1 && ultDefMult < cast.selfDefBoost) {
      ultDefMult = cast.selfDefBoost
      logs.push({ text:`🛡 ${enemy.name}の甲殻が硬質化！ 防御・特殊防御が${cast.selfDefBoost}倍になった！`, color:'#88ccff' })
    }
    // 鏡獄の大技: ランダムな状態異常をn種付与
    if (finalDmg > 0 && (cast?.randomAilments || 0) > 0) {
      const pool = ['burn', 'poison', 'paralysis', 'bleed', 'stun'].sort(() => Math.random() - 0.5)
      let applied = 0
      for (const key of pool) {
        if (applied >= cast.randomAilments) break
        if (inflictAilment(key)) applied++
      }
    }
  }

  // 鏡獄の大技: プレイヤーがセットしている全アクティブスキルを1ターンで撃ち返す（効果は mirrorFrac 倍）
  //  ・攻撃スキル→プレイヤーへダメージ ・回復スキル→敵が回復 ・強化スキル→敵に自己バフ（いずれも frac 倍）
  const MIRROR_BOSS_BUFFS = ['atkUp','matkUp','defUp','mdefUp','spdUp','dmgReduce','regen','regenHeal','statusImmune','holyField','holyAwakening','bloodRage','evasion','hitBonus','critResist','healUp']
  const MIRROR_MULT_KEYS = new Set(['atkUp','matkUp','defUp','mdefUp','spdUp','dmgReduce'])
  const scaleBossBuff = (k, v, frac) => {
    if (!v || typeof v !== 'object') return v
    const c = { ...v }
    if (typeof c.rate === 'number') c.rate = MIRROR_MULT_KEYS.has(k) ? 1 + (c.rate - 1) * frac : c.rate * frac
    if (typeof c.amount === 'number') c.amount = Math.max(1, Math.floor(c.amount * frac))
    if (typeof c.value === 'number') c.value = c.value * frac
    if (typeof c.healRate === 'number') c.healRate = c.healRate * frac
    if (typeof c.dmg === 'number') c.dmg = Math.max(1, Math.floor(c.dmg * frac))
    return c
  }
  const castMirrorSkills = (ult) => {
    const frac = ult.mirrorFrac || (1 / 4)
    const activeSkills = skillSets.filter(ss => ss.skills && ss.skills.type !== 'パッシブ').map(ss => ss.skills)
    const seen = new Set(), uniq = []
    for (const sk of activeSkills) { if (sk?.name && !seen.has(sk.name)) { seen.add(sk.name); uniq.push(sk) } }
    if (uniq.length === 0) { doEnemyAttack(false, { ...ult, isUlt: true }); return }  // スキル未設定なら通常大技
    logs.push({ text:`🪞 ${enemy.name}の「${ult.name}」！ あなたの技をすべて鏡に映し出す…！`, color:'#cc66ff' })
    const casterStats = { atk: enemy.atk, matk: enemy.matk, def: enemy.def, mdef: enemy.mdef, spd: enemy.spd, hp_max: enemyMaxHp, mp_max: 999999, critDmg:0, defPen:0, mdefPen:0, hitBonus:0, critBonus:0, evasionBonus:0, critResist:0 }
    const casterProfile = { hp_max: enemyMaxHp, mp_max: 999999, class:'', retraining:{}, username: enemy.name }
    const playerTarget = { name: profile.username, def: eff.def, mdef: eff.mdef, hp: eff.hp_max, hp_max: eff.hp_max, type:'physical' }
    for (const sk of uniq) {
      if (playerHp <= 0) break
      // executeSkill: caster=敵, target=プレイヤー。newEnemyBuffs=対象(プレイヤー)デバフ / newPlayerBuffs=詠唱者(敵)バフ
      const prevPB = playerBuffs  // 反射デバフの防御判定用スナップショット
      const res = executeSkill({ name: sk.name }, casterStats, casterProfile, playerTarget, playerBuffs, enemyBuffs, false, null)
      const isPhys = sk.type === '物理攻撃'
      let noteBuff = false, noteHeal = 0
      if (res.dmg > 0) {
        const atkStat = isPhys ? casterStats.atk : casterStats.matk
        const pDef = isPhys ? eff.def : eff.mdef
        const defScale = atkStat / (atkStat + Math.max(1, pDef))
        const rankRed = calcDefReduction(isPhys ? eff.def : eff.mdef)
        const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
        let dmg = Math.max(0, Math.floor(res.dmg * defScale * (1 - rankRed) * dmgReduceRate * evoTakenMult(eff, isPhys, playerHp / eff.hp_max) * frac * (0.9 + Math.random() * 0.2)))
        playerHp -= dmg
        logs.push({ text:`🪞 ${enemy.name}が「${sk.name}」を映し返す！ あなたに${dmg}ダメージ！`, color:'#cc66ff' })
      } else {
        logs.push({ text:`🪞 ${enemy.name}が「${sk.name}」を映し返す！`, color:'#cc66ff' })
      }
      // 回復スキル: 敵が frac 倍回復（healDown=回復力ダウンも適用）
      if (res.heal > 0 && enemyHp > 0) { const h = Math.floor(res.heal * frac * (enemyBuffs.healDown?.turns > 0 ? enemyBuffs.healDown.rate : 1)); if (h > 0) { noteHeal = h; enemyHp = Math.min(enemyMaxHp, enemyHp + h) } }
      // 強化スキル: 敵の自己バフ（res.newPlayerBuffs）を frac 倍で反映
      for (const k of MIRROR_BOSS_BUFFS) {
        const nv = res.newPlayerBuffs?.[k]
        if (nv && nv !== enemyBuffs[k]) { enemyBuffs[k] = scaleBossBuff(k, nv, frac); noteBuff = true }
      }
      if (noteHeal > 0) logs.push({ text:`💚 ${enemy.name}はHPを${noteHeal}回復した！`, color:'#44ff88' })
      if (noteBuff) logs.push({ text:`✦ ${enemy.name}は自らを強化した！`, color:'#ff99dd' })
      // スキルが付与する状態異常デバフは playerBuffs へ反映。
      // ただし「新規に付いた状態異常」には通常経路と同じ防御判定（狂信/装備のシールド/紋章耐性）を適用する
      {
        const newPB = res.newEnemyBuffs
        const MIRROR_AILS = ['burn', 'poison', 'severePoisoin', 'paralysis', 'stun', 'bleed', 'healSeal', 'curseDmg']
        for (const k of MIRROR_AILS) {
          const isNew = k === 'bleed'
            ? (newPB.bleed?.stacks || 0) > (prevPB.bleed?.stacks || 0)
            : (newPB[k] && !prevPB[k])
          if (!isNew) continue
          const resKey = k === 'severePoisoin' ? 'poison' : k
          if (prevPB.statusImmune?.turns > 0 || ailmentShieldBlocks(newPB, logs) || emblemBlocksAilment(eff, resKey, logs) || evoBlocksAilment(eff, resKey, logs)) {
            if (k === 'bleed') { if (prevPB.bleed) newPB.bleed = prevPB.bleed; else delete newPB.bleed }
            else delete newPB[k]
          }
        }
        playerBuffs = newPB
      }
    }
  }

  // 1ターン分の敵行動: HP50%以下で1度だけ大技 → everyターンごとに通常スキル → 通常攻撃
  let ultUsed = false
  let dispel75Done = false  // HP75%以下の自動バフ解除を1度だけ発動させるフラグ
  const doEnemyTurn = () => {
    const ult = enemy.ultimate
    if (ult && !ultUsed && enemyHp / enemyMaxHp <= (ult.hpBelow || 0.5)) {
      ultUsed = true
      dispelPlayerBuffs()  // 大技使用時に自動バフ解除（行動には含まれない）
      logs.push({ text:`━━ ${enemy.name}が大技を放つ！ ━━`, color:'#ff44aa' })
      if (ult.mirrorAllSkills) { castMirrorSkills(ult); return }
      doEnemyAttack(false, { ...ult, isUlt: true })
      // 氷結の大技: 直後に確定で追加行動
      if (ult.extraAction && playerHp > 0) doEnemyAttack(true)
      return
    }
    const sk = enemy.skill
    if (sk && sk.every > 0 && turn % sk.every === 0) { doEnemyAttack(false, sk); return }
    doEnemyAttack(false)
  }

    // 戦闘状況（HP/MPバー）は各ターンの先頭に1回だけ出す。
    const pushHp = () => {
      logs.push({ type:'hp', turn, playerHp:Math.max(0,playerHp), playerMax:eff.hp_max, playerName:profile.username, enemyHp:Math.max(0,enemyHp), enemyMax:enemyMaxHp, enemyName:enemy.name, playerStatus:extractStatuses(playerBuffs), enemyStatus:extractStatuses(enemyBuffs) })
    }

  while (playerHp > 0 && enemyHp > 0 && turn <= 50) {
    pushHp()
    const hpBeforeTurn = playerHp
    if (passiveNames.includes('骸の壁') && (turn === 1 || turn % 4 === 0)) {
      playerBuffs.dmgReduce = { turns:999, rate:0.7, isGainoKabe:true }
      logs.push({ text:`💀 骸の壁発動！ 次に攻撃を受けるまで被ダメ-30%！`, color:'#cc44ff' })
    }
    // 敵への持続ダメージ（固定割合DoT＝叫喚のflatDRは貫通）
    if (enemyBuffs.severePoisoin?.turns > 0) {
      const spDmg = Math.floor(enemyMaxHp * 0.05 * emblemDotMult(eff, 'poison') * dotTakenMult); enemyHp -= spDmg
      logs.push({ text:`🤢 猛毒ダメージ！ ${enemy.name}に${spDmg}ダメージ！`, color:'#aa44ff' })
      if (enemyHp <= 0) break
    }
    {
      const sEnemy = { def: enemy.def, mdef: enemy.mdef, atk: enemy.atk, matk: enemy.matk, type: enemy.type, name: enemy.name, evasionRate: 0 }
      const sd = summonAttackDamage(summon, sEnemy, enemyBuffs, playerBuffs, eff, rtCur, logs)
      // 召喚（式神=特殊/ペット=物理or特殊）は合算値のため、被ダメ半減パッシブは強い方の軽減を適用（迂回防止）
      if (sd > 0) enemyHp -= Math.floor(sd * hellDR * Math.min(typeTakenMult(true), typeTakenMult(false)))
      if (enemyHp <= 0) break
    }
    if (enemyBuffs.burn?.turns > 0) {
      const burnDmg = Math.floor(enemyMaxHp * 0.02 * emblemDotMult(eff, 'burn') * dotTakenMult); enemyHp -= burnDmg
      logs.push({ text:`🔥 やけどダメージ！ ${enemy.name}に${burnDmg}ダメージ！`, color:'#ff6622' })
      if (enemyHp <= 0) break
    }
    if (enemyBuffs.curseDmg?.turns > 0) {
      enemyHp -= enemyBuffs.curseDmg.dmg
      logs.push({ text:`💀 呪縛ダメージ！ ${enemy.name}に${enemyBuffs.curseDmg.dmg}ダメージ！`, color:'#cc44ff' })
      if (enemyHp <= 0) break
    }
    if (enemyBuffs.regen?.turns > 0) {
      const regenAmt = Math.floor(enemyMaxHp * enemyBuffs.regen.rate * (enemyBuffs.healDown?.turns > 0 ? enemyBuffs.healDown.rate : 1))
      enemyHp = Math.min(enemyMaxHp, enemyHp + regenAmt)
      logs.push({ text:`💚 ${enemy.name}のリジェネ！ HPが${regenAmt}回復した！`, color:'#44ff88' })
    }
    if (enemyBuffs.poison?.turns > 0) {
      const poisonDmg = Math.floor(enemy.hp * enemyBuffs.poison.dmgRate * emblemDotMult(eff, 'poison') * dotTakenMult); enemyHp -= poisonDmg
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
      const healAmt = Math.floor(playerBuffs.regenHeal.amount * passiveHealMult * hellHealMult * (playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1))
      playerHp = Math.min(eff.hp_max, playerHp + healAmt)
      logs.push({ text:`💚 回復効果でHPが${healAmt}回復した！`, color:'#44ff88' })
      if (passiveHealReflect && healAmt > 0) {
        const reflectDmg = healAmt; enemyHp -= reflectDmg
        logs.push({ text:`✨ 神聖加護の反射！ ${enemy.name}に${reflectDmg}ダメージ！`, color:'#ffdd44' })
      }
    }
    if (!isHealSealed && playerBuffs.delayHeal && turn === playerBuffs.delayHeal.triggerTurn) {
      { const dAmt = Math.floor(playerBuffs.delayHeal.amount * hellHealMult)
        playerHp = Math.min(eff.hp_max, playerHp + dAmt)
        logs.push({ text:`💚 HPが${dAmt}回復した！`, color:'#44ff88' }) }  // HPが動くので事象は残し、出所だけ外す
    }

    // プレイヤー行動スキップ判定（スタン・麻痺）
    let playerSkipped = false
    if (playerBuffs.stun?.turns > 0) {
      logs.push({ text:`スタン！ あなたは行動できない！`, color:'#ffaa00' })
      playerSkipped = true; delete playerBuffs.stun
    } else if (playerBuffs.paralysis?.turns > 0 && Math.random() < playerBuffs.paralysis.skipRate) {
      logs.push({ text:`麻痺で行動不能！`, color:'#ffaa00' })
      playerSkipped = true; playerBuffs.paralysis.skipRate *= 0.5
    }
    if (!playerSkipped) {
      tenkaiActedThisTurn = false
      doPlayerAttack(false)
      if (enemyHp <= 0) break
      const spiritExtra = !!playerBuffs.guaranteedExtra  // 精霊共鳴の確定追加行動
      if (playerBuffs.guaranteedExtra) playerBuffs.guaranteedExtra = false
      if (!tenkaiActedThisTurn && (spiritExtra || (playerExtraRate > 0 && Math.random()*100 < playerExtraRate))) { logs.push({ text:'⚡ 追加行動！', color:'#ffdd44' }); doPlayerAttack(true); if (enemyHp <= 0) break }
    }

    // Hell限定: HP75%以下に落ちた最初のターンに自動でプレイヤーのバフ解除（行動には含まれない・スタン中でも発動）
    if (enemy.isHell && !dispel75Done && enemyHp / enemyMaxHp <= 0.75) {
      dispel75Done = true
      dispelPlayerBuffs()
    }

    // 敵のターン
    let enemySkipped = false
    if (enemyBuffs.stun?.turns > 0) {
      logs.push({ text:`${enemy.name}はスタンして行動できない！`, color:'#ffaa00' })
      enemySkipped = true; delete enemyBuffs.stun
    } else if (enemyBuffs.paralysis?.turns > 0 && Math.random() < enemyBuffs.paralysis.skipRate) {
      logs.push({ text:`${enemy.name}は麻痺で行動不能！`, color:'#ffaa00' })
      enemySkipped = true; enemyBuffs.paralysis.skipRate *= 0.5
    }
    if (!enemySkipped) {
      doEnemyTurn()
      if (playerHp <= 0) break
      if (enemyExtraRate > 0 && Math.random()*100 < enemyExtraRate) {
        logs.push({ text:'⚡ 追加行動！', color:'#ffdd44' })
        doEnemyAttack(true)
      }
    }
    if (playerHp <= 0) break

    if (enemyBuffs.bleed) {
      const bleedDmg = Math.floor(enemyHp * 0.01 * enemyBuffs.bleed.stacks * emblemDotMult(eff, 'bleed') * dotTakenMult); enemyHp -= bleedDmg
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
    }
    if (hasAmagoiShield && turn % 5 === 0 && playerHp > 0 && !(playerBuffs.ailmentShield?.charges > 0)) {
      playerBuffs.ailmentShield = { charges: 1 }  // 装備由来なので無言で付与（発動ログは出さない）
    }
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
  const [devUnlimited, setDevUnlimited] = useState(false)  // 🔧 開発無限モード（is_admin限定・OFF=1日5勝モードで実プレイヤーと同条件・リロードでOFF）
  const cdRef = useRef(null)
  const logsEndRef = useRef(null)
  const cardRefs = useRef({})  // 地獄カードごとのDOM参照（選択時にスクロールして合わせる）

  useEffect(() => { init() }, [])
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [battleLogs])

  // 地獄カードを選ぶと、展開した内容が見切れないよう選択カードへスクロールして合わせる（奈落と同様）
  useEffect(() => {
    if (!selectedHell) return
    const el = cardRefs.current[selectedHell]
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [selectedHell])

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
    // エリア⑤踏破で解放。未踏破アクセスは管理者へ通知（表示は下のロック画面でブロック）
    if (!isHachigokuUnlocked(prof)) reportDevAccess('hachigoku', '八獄(/hachigoku)')
    let petCharm = null, petStat = null, activePet = null
    try {
      const { data: ap } = await supabase.from('pets').select(PET_STAT_SELECT).eq('owner_id', user.id).eq('is_active', true).maybeSingle()
      if (ap) { activePet = ap; petStat = petPlayerBonus(ap); petCharm = await loadCharmBonus(ap) }  // チャーム＋リボン（リボンは特殊能力のみ引き継ぎ）
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
    setSkillSets(selectBattleSkillSets(ss, 'hachigoku'))
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
  const unlimited = !!profile?.is_admin && devUnlimited  // 管理者が開発無限モードON時のみ回数無制限（OFF=1日5勝で実プレイヤーと同条件）

  const handleChallenge = async () => {
    if (!selectedHell || !profile || battling || remaining > 0) return
    if (winsLeft <= 0 && !unlimited) return
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
          curSets = selectBattleSkillSets(ss2, 'hachigoku')
          setSkillSets(curSets)
        }
      }
      const { logs, win } = simulateHachigokuBattle(eff, equipment, curSets, profile, { ...enemy })
      setBattleLogs(logs)

      if (win) {
        const diffIdx = HACHIGOKU_DIFFICULTIES.findIndex(d => d.key === selectedDiff)
        const { data, error } = await supabase.rpc('hachigoku_result', { p_hell: selectedHell, p_diff: diffIdx, p_dev_unlimited: unlimited })
        if (error || data?.error) {
          const code = data?.error || error?.message
          setResultMsg(code === 'daily_limit'
            ? '本日の挑戦回数（5勝）を使い切っています。報酬はありません。'
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

  // エリア⑤踏破で解放（管理者は常時可）
  if (!isHachigokuUnlocked(profile)) {
    return (
      <div style={{ minHeight:'100vh', background:'#100505', padding:'12px', fontFamily:'monospace' }}>
        <div style={{ maxWidth:'640px', margin:'0 auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #5a1f1f', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#100505' }}>
            <div style={{ color:'#ff9977', fontSize:'16px', letterSpacing:'3px' }}>🔥 八獄</div>
            <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #aa4444', color:'#cc7766', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
          </div>
          <div style={{ border:'1px solid #6a2a2a', background:'#220a0a', padding:'24px', textAlign:'center', color:'#dd9988', fontSize:'13px', lineHeight:'1.9' }}>
            🔒 八獄は<span style={{ color:'#ffaa88' }}>エリア⑤を踏破</span>すると挑戦できます。<br/>まずは冒険を進めて第5エリアのボスを倒しましょう。
          </div>
        </div>
      </div>
    )
  }

  const hell = selectedHell ? HACHIGOKU_HELLS.find(h => h.key === selectedHell) : null
  const diffIdxOf = (k) => HACHIGOKU_DIFFICULTIES.findIndex(d => d.key === k)
  const canChallenge = !!selectedHell && (winsLeft > 0 || unlimited) && remaining <= 0 && !battling

  return (
    <div style={{ minHeight:'100vh', background:'#100505', padding:'12px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'680px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #5a1f1f', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#100505' }}>
          <div style={{ color:'#ff9977', fontSize:'16px', letterSpacing:'3px' }}>🔥 八獄</div>
          <div style={{ display:'flex', gap:'6px' }}>
            <button onClick={()=>nav('/emblem')} style={{ background:'none', border:'1px solid #a060e0', color:'#c8a0ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🔮 紋章</button>
            <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #aa4444', color:'#cc7766', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
          </div>
        </div>

        {scene === 'lobby' && (
          <>
            <div style={{ border:'1px solid #6a2a2a', background:'#1c0808', padding:'12px', marginBottom:'12px' }}>
              <div style={{ color:'#dd9988', fontSize:'12px', lineHeight:'1.9' }}>
                {unlimited ? (
                  <>本日の残り挑戦回数: <span style={{ color:'#66ff99', fontWeight:'bold' }}>無制限</span><span style={{ color:'#aa6655', fontSize:'10px', marginLeft:'6px' }}>（開発無限モード・本日{winsToday}勝）</span></>
                ) : (
                  <>本日の残り挑戦回数: <span style={{ color: winsLeft > 0 ? '#ffcc66' : '#ff5555', fontWeight:'bold' }}>{winsLeft}</span> ／ {HACHIGOKU_DAILY_WINS}回</>
                )}
              </div>
              {profile?.is_admin && (
                <button onClick={()=>setDevUnlimited(v=>!v)} style={{ marginTop:'8px', background: devUnlimited ? '#0a2a14' : '#26120a', border:`1px solid ${devUnlimited ? '#44cc77' : '#aa7744'}`, color: devUnlimited ? '#66ff99' : '#ffbb66', padding:'5px 12px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                  🔧 {devUnlimited ? '開発無限モード（タップで1日5勝モードへ）' : '1日5勝モード（タップで開発無限モードへ）'}
                </button>
              )}
              <div style={{ color:'#aa6655', fontSize:'10px', marginTop:'4px', lineHeight:'1.7' }}>
                八つの地獄の主に挑み、紋章を鍛える<span style={{ color:'#ffaa88' }}>結晶・紋章の成長石・獄卒の魂</span>を勝ち取ろう（報酬は確率ドロップ）。<br/>
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
                  <div key={h.key} ref={el => { cardRefs.current[h.key] = el }} onClick={()=>setSelectedHell(sel ? null : h.key)}
                    style={{ border:`1px solid ${sel ? '#ff8855' : '#5a2a2a'}`, background: sel ? '#2a0e08' : '#180808', padding:'12px', cursor:'pointer', scrollMarginTop:'56px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'10px', flex:1, minWidth:0, textAlign:'left' }}>
                        {h.img
                          ? <img src={h.img} alt={h.boss} style={{ width:'84px', height:'84px', objectFit:'contain', flexShrink:0 }} />
                          : <div style={{ width:'84px', height:'84px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'44px', background:'#0d0404', border:'1px solid #3a1a1a', flexShrink:0 }}>👹</div>}
                        <div style={{ minWidth:0 }}>
                          <div style={{ color: sel ? '#ffbb99' : '#dd9977', fontSize:'14px', fontWeight:'bold' }}>{h.name}　<span style={{ fontSize:'12px' }}>{h.boss}</span></div>
                          <div style={{ color:'#aa6655', fontSize:'10px', marginTop:'4px', lineHeight:'1.7' }}>
                            テーマ：{h.theme}<br/>
                            ドロップ：{h.crystals.map((k, i) => {
                              const nm = EMBLEM_CRYSTALS[k]?.name
                              if (!nm) return null
                              return <span key={k} style={{ whiteSpace:'nowrap' }}>{i > 0 ? '、' : ''}{nm}</span>
                            })}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign:'right', fontSize:'10px', lineHeight:'1.8', flexShrink:0, marginLeft:'8px' }}>
                        {maxDiff >= 0 && <div style={{ color: HACHIGOKU_DIFFICULTIES[maxDiff]?.color || '#66cc88' }}>✓ {HACHIGOKU_DIFFICULTIES[maxDiff]?.label}撃破</div>}
                        {cl?.memory && <div style={{ color:'#cc88ff' }}>📿 記憶 獲得済</div>}
                      </div>
                    </div>
                    {sel && (
                      <div style={{ marginTop:'10px', borderTop:'1px solid #3a1a1a', paddingTop:'10px' }}>
                        <div style={{ color:'#cc8877', fontSize:'11px', lineHeight:'1.7', marginBottom:'8px' }}>{h.desc}</div>
                        {h.passive && <div style={{ color:'#ffaa66', fontSize:'10px', marginBottom:'8px' }}>👁 パッシブ: {h.passive}</div>}
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
                          対応する結晶: {h.crystals.length}種 ／ 魂ドロップ率は高難易度ほどUP（Hellで大幅UP）<br/>
                          <span style={{ color:'#cc88ff' }}>Hellのみ: HP75%到達時と大技使用時にプレイヤーの強化バフを解除</span>
                        </div>
                        <button onClick={(e)=>{ e.stopPropagation(); handleChallenge() }} disabled={!canChallenge}
                          style={{ width:'100%', marginTop:'10px', padding:'12px', background: canChallenge ? '#401510' : '#1c0a08', border:`1px solid ${canChallenge ? '#ff8855' : '#4a2a22'}`, color: canChallenge ? '#ffbb99' : '#6a4a44', cursor: canChallenge ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'13px', letterSpacing:'2px' }}>
                          {winsLeft <= 0 && !unlimited ? '本日の挑戦回数を使い切った（毎朝5時リセット）'
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
            {battleInfo.hell.img && (
              <div style={{ textAlign:'center', marginBottom:'10px' }}>
                {/* 立ち絵は正方形(1254x1254)。上限が小さすぎて枠を使い切れていなかったので広げた。
                    画面が低いときのために vh 側の上限も持たせる（下のログ枠46vhと合わせて90vh） */}
                <img src={battleInfo.hell.img} alt={battleInfo.hell.boss} style={{ maxWidth:'100%', maxHeight:'min(440px, 44vh)', objectFit:'contain', filter:'drop-shadow(0 0 14px rgba(255,60,30,0.35))' }} />
              </div>
            )}
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
                    <div key={name}>{name.includes('魂') ? '👹' : name.includes('記憶') ? '📿' : name.includes('成長石') ? '🧩' : '💠'} {name} ×{n}</div>
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
