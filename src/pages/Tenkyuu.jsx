import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { getWeaponGroup } from '../lib/stats'
import {
  calcEffectiveStats,
  calcEvasionRate,
  calcExtraActionRate,
  calcCritRate,
  calcDefReduction,
  applyEquipmentEffects,
  executeSkill,
  extractStatuses,
  BattleLogLine,
} from './Game'
import {
  TENKYUU_PALACES,
  TENKYUU_PALACE_COUNT,
  getPalace,
  applyStatCap,
} from '../lib/tenkyuu'

const fmt = (n) => Number(n).toLocaleString()
const TENKYUU_CD = 3  // 連打対策のクライアントCD(秒)

// ============================================================
// 天穹十二宮 戦闘シミュレーション（完全PvE）
// 奈落闘技場の simulateAbyssBattle を複製し、固有ギミック(enemy.mods)用フックを追加したもの。
// 街の通常戦闘・奈落には手を入れず、十二宮専用に複製している（raid/abyss と同じ方針）。
// 相違点：
//  ・プレイヤーに共通のステータス上限を適用（過剰分5%／applyStatCap）
//  ・abyssの階数被ダメ軽減は無し。代わりに enemy.mods による固有ギミックを解釈
//  ・報酬・進捗はクライアント側（称号は後日）
// 戻り値: { logs, win, turns }
// ============================================================
function simulateTenkyuuBattle(effRaw, equipment, skillSets, profileRaw, enemy, playerItem) {
  const logs = []
  const mods = enemy.mods || {}

  // ステータス上限（過剰分5%）を適用。上限は宮ごと(enemy.cap)に設定。
  const capped = applyStatCap(effRaw, profileRaw.hp_max, enemy.cap || mods.capOverride)
  const eff = capped.eff
  const profile = { ...profileRaw, hp_max: capped.hpMax }

  let playerHp = profile.hp_max
  let playerMp = profile.mp_max
  let enemyHp = enemy.hp
  const enemyMaxHp = enemy.hp
  let turn = 1, skillIndex = 0
  let playerBuffs = {}, enemyBuffs = {}
  let currentItem = playerItem ? { ...playerItem } : null
  let itemUsed = false
  let prevSkillName = null
  let playerAttacking = false

  // ===== 敵スキルAI 状態（kit駆動。十二宮の Phase1 宮は kit 無し＝通常攻撃＋mods） =====
  let enUsedT75 = false, enUsedT40 = false, enUsedSpecial = false
  let enLockedSkill = null
  let prevEnemySkill = ''
  const enPerm = { atkMult:1, matkMult:1, defMult:1, mdefMult:1, spdMult:1, critDmgPlus:0, convertCtoA:false, followupAtk:0 }
  const enemyProfile = { hp_max: enemyMaxHp, mp_max: 999999, class: '', retraining: {}, username: enemy.name }

  // ===== 固有ギミック用の内部状態 =====
  let hpThreshDone = false       // hpThreshAtk を適用済みか
  let healBlockApplied = false   // healBlock を適用済みか
  let enemyActionStreak = 0      // escalatingHit 用：連続行動カウント（敵ターン開始で0）

  // mods: プレイヤー→敵 ダメージ倍率（flatDR）。固定割合DoTには掛けない（貫通させる）
  const playerDmgMult = 1 - (mods.flatDR || 0)
  // mods: プレイヤーが1ヒットで受ける最大ダメージ上限
  const capPlayerDmg = (d) => mods.dmgTakenCap ? Math.min(d, Math.floor(profile.hp_max * mods.dmgTakenCap)) : d

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

  logs.push({ text:`✦ ${enemy.name}が天穹より降臨した！`, color:'#c8a0ff' })
  if (capped.wasCapped) logs.push({ text:`⚖ 天穹の理：過剰なステータスは5%しか発揮されない…`, color:'#88ccff' })

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
  // 敵の回避率（mods.evasion を加算）
  const enemyEvasionRate  = calcEvasionRate(enemySpd, effectiveSpdForCalc) + (mods.evasion || 0)
  const playerHitBonus = (eff.hitBonus || 0) + passiveHitBonus

  // プレイヤーが敵に付与した状態異常を無効化（mods.statusImmune）
  const STATUS_KEYS = ['poison','severePoisoin','burn','bleed','paralysis','stun','curseDmg','defDown','mdefDown','atkDown','spdDown','healDown']
  const stripEnemyStatuses = (before) => {
    if (!mods.statusImmune) return
    let stripped = false
    for (const k of STATUS_KEYS) {
      if (enemyBuffs[k] && enemyBuffs[k] !== before[k]) { delete enemyBuffs[k]; stripped = true }
    }
    if (stripped) logs.push({ text:`🛡 ${enemy.name}は状態異常を寄せ付けない！`, color:'#aab0ff' })
  }

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
      playerAttacking = false
      if (mods.healOnPlayerAction) doHealOnPlayerAction()
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
        const buffsBefore = { ...enemyBuffs }
        const res = executeSkill(cs.skills, {...effBuff, lastMpCost:mpCost}, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
        const finalCrit = res.dmg > 0 && (isCrit || (res.bonusCritRate > 0 && Math.random()*100 < playerCritRate + res.bonusCritRate))
        const finalCritMult = finalCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
        const tosoMult = (hasTosoHonno && playerHp <= profile.hp_max * 0.5) ? (pe('体術師')?1.25:1.1) : 1.0
        let defScale = 1.0
        if (res.dmg > 0) {
          const sType = cs.skills?.type
          const adjED  = Math.max(1, Math.floor((enemy.def ||0)*eDefRate*enPerm.defMult))
          const adjEMD = Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate*enPerm.mdefMult))
          if (cs.skills?.name === 'サイコブラスト' || res.useMinDef) {
            defScale = effBuff.matk / (effBuff.matk + Math.min(adjED, adjEMD))
          } else if (sType === '物理攻撃') defScale = effBuff.atk  / (effBuff.atk  + adjED)
          else if (sType === '魔法攻撃') defScale = effBuff.matk / (effBuff.matk + adjEMD)
        }
        const allinDebuffOutMult = playerBuffs.allinDebuff?.turns > 0 ? 0.7 : 1.0
        const enemyDmgReduceMult = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
        let finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * enemyDmgReduceMult * playerDmgMult * (0.9 + Math.random() * 0.2))
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
        stripEnemyStatuses(buffsBefore)
        const critInsert = finalCrit ? '💥クリティカル！ ' : ''
        const dmgIdx = resLog.indexOf(enemy.name + 'に')
        const logWithCrit = critInsert
          ? (dmgIdx >= 0 ? resLog.slice(0, dmgIdx) + critInsert + resLog.slice(dmgIdx) : resLog + ' ' + critInsert)
          : resLog
        logs.push({ text:`${prefix}${logWithCrit}`, color:finalCrit?'#ffff00':'#88ccff' })
        if (res.followup && res.followup.dmg > 0) {
          const fCrit = Math.random()*100 < (playerCritRate + (res.bonusCritRate||0))
          const fCritMult = fCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
          let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * enemyDmgReduceMult * playerDmgMult * (0.9 + Math.random()*0.2))
          fDmg = Math.max(1, fDmg)
          enemyHp -= fDmg
          logs.push({ text:`↳ 追撃！${res.followup.label?`（${res.followup.label}）`:''} ${enemy.name}に${fDmg}ダメージ！${fCrit?' 💥クリティカル！':''}`, color: fCrit?'#ffaa00':'#ffaa66' })
        }
        if (playerAttacking && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(profile.hp_max * 0.2))
          playerHp = Math.min(profile.hp_max, playerHp + rageCure)
          logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
        }
        if (playerBuffs.holyAwakening?.turns > 0 && finalDmg > 0) {
          const holyBonusDmg = Math.floor((pDef * playerBuffs.holyAwakening.defMult + pMdef * playerBuffs.holyAwakening.defMult))
          enemyHp -= holyBonusDmg
          logs.push({ text:`✨ 神聖覚醒の追撃！ ${enemy.name}に${holyBonusDmg}ダメージ！`, color:'#ffeeaa' })
          if (enemyHp <= 0) { skillIndex++; playerAttacking=false; if (mods.healOnPlayerAction) doHealOnPlayerAction(); return }
        }
        skillUsed = true; skillIndex++
      }
    }
    if (!skillUsed) {
      const baseAtk = isMagical ? effBuff.matk : effBuff.atk
      const eDefVal = isMagical ? Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate*enPerm.mdefMult)) : Math.max(1, Math.floor(enemy.def*eDefRate*enPerm.defMult))
      const baseDmg = Math.max(1, Math.floor(baseAtk*baseAtk/Math.max(1,baseAtk+eDefVal))+Math.floor(Math.random()*4))
      const enemyDmgReduceMult2 = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
      let finalDmg = Math.floor(baseDmg*0.7*critMult*(isArtifact?1.2:1.0)*passiveDmgMult*enemyDmgReduceMult2*playerDmgMult*(0.9+Math.random()*0.2))
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
    // mods: プレイヤーが行動するたびに敵が回復
    if (mods.healOnPlayerAction) doHealOnPlayerAction()
  }

  // mods: プレイヤー行動時の敵回復（黒角デネブ）
  const doHealOnPlayerAction = () => {
    if (enemyHp <= 0) return
    const amt = Math.floor(enemyMaxHp * mods.healOnPlayerAction)
    if (amt <= 0) return
    enemyHp = Math.min(enemyMaxHp, enemyHp + amt)
    logs.push({ text:`💚 ${enemy.name}は${profile.username}の動きを糧に${amt}回復した！`, color:'#66ddaa' })
  }

  // 敵の現在の施術ステータス（永続強化＋バフを反映）
  const enemyCastStats = () => {
    let atk  = enemy.atk  * enPerm.atkMult  * (enemyBuffs.atkUp?.rate  || 1) * (enemyBuffs.burn?.turns > 0 ? 0.9 : 1)
    let matk = enemy.matk * enPerm.matkMult * (enemyBuffs.matkUp?.rate || 1) * (enemyBuffs.burn?.turns > 0 ? 0.9 : 1)
    if (enPerm.convertCtoA) { atk += matk; matk = 0 }
    const def  = enemy.def  * enPerm.defMult  * (enemyBuffs.defUp?.rate || 1)
    const mdef = enemy.mdef * enPerm.mdefMult * (enemyBuffs.defUp?.rate || 1)
    const spd  = enemy.spd  * enPerm.spdMult  * (enemyBuffs.spdUp?.rate || 1)
    return { atk, def, matk, mdef, spd, hp_max:enemyMaxHp, mp_max:999999, critDmg:0, defPen:0, mdefPen:0, hitBonus:0, critBonus:0, evasionBonus:0, critResist:0 }
  }

  // 物理/魔法/ハイブリッドの被ダメ計算（プレイヤーDEF/MDEFで軽減）。mods.defPen で防御無視、dmgTakenCap で上限。
  const scaleDamageToPlayer = (raw, atkStat, useStat /* 'atk'|'matk'|'hybrid' */, isCrit) => {
    let pDef, rankStat
    if (mods.defPen) { pDef = 1; rankStat = 0 }
    else if (useStat === 'hybrid') { pDef = Math.min(eff.def, eff.mdef); rankStat = Math.min(eff.def, eff.mdef) }
    else if (useStat === 'matk') { pDef = eff.mdef; rankStat = eff.mdef }
    else { pDef = eff.def; rankStat = eff.def }
    const defScale = atkStat / (atkStat + Math.max(1, pDef))
    const critMult = isCrit ? (1.5 + enPerm.critDmgPlus) : 1.0
    const rankRed = calcDefReduction(rankStat)
    const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
    return capPlayerDmg(Math.max(0, Math.floor(raw * defScale * critMult * (1 - rankRed) * dmgReduceRate * (0.9 + Math.random()*0.2))))
  }

  // mods: 敵の攻撃が命中したときの追加処理（スタン・状態異常付与・毒追撃）
  const onEnemyHit = () => {
    if (playerHp <= 0) return
    // hitStun（獅子レグルス）。プレイヤーの状態異常無効/スタン耐性で防げる
    if (mods.hitStun && !(playerBuffs.statusImmune?.turns > 0)) {
      if (Math.random() < mods.hitStun) {
        playerBuffs.stun = { turns:1 }
        logs.push({ text:`⚡ ${enemy.name}の一撃でスタン！ 次のターン行動できない！`, color:'#ffaa00' })
      }
    }
    // statusOnHit（乙女スピカ／天蠍アンタレス）
    if (mods.statusOnHit && mods.statusOnHit.length && !(playerBuffs.statusImmune?.turns > 0)) {
      const st = mods.statusOnHit[(turn - 1) % mods.statusOnHit.length]
      if (st === 'poison'   && !(playerBuffs.poison?.turns > 0))     { playerBuffs.poison = { turns:5, dmgRate:0.04 }; logs.push({ text:`☠ ${enemy.name}の毒が回った！`, color:'#44ff44' }) }
      if (st === 'burn'     && !(playerBuffs.burn?.turns > 0))       { playerBuffs.burn = { turns:5, dmgRate:0.02 }; logs.push({ text:`🔥 ${enemy.name}にやけどを負わされた！`, color:'#ff6622' }) }
      if (st === 'paralysis'&& !(playerBuffs.paralysis?.turns > 0))  { playerBuffs.paralysis = { turns:4, skipRate:0.25, spdRate:0.8 }; logs.push({ text:`⚡ ${enemy.name}に麻痺させられた！`, color:'#ffdd44' }) }
    }
    // bonusVsStatus（天蠍アンタレス：毒状態の敵に追撃）
    if (mods.bonusVsStatus && playerBuffs[mods.bonusVsStatus.st]?.turns > 0) {
      const eStats = enemyCastStats()
      const isMag = enemy.type === 'magical'
      const atkStat = isMag ? eStats.matk : eStats.atk
      const dmg = scaleDamageToPlayer(atkStat * mods.bonusVsStatus.mult, atkStat, isMag ? 'matk' : 'atk', false)
      playerHp -= dmg
      logs.push({ text:`↳ ${enemy.name}の追撃！ 弱った身体に${dmg}ダメージ！`, color:'#88dd44' })
    }
  }

  const doEnemyAttack = (isExtra = false) => {
    const holyFieldDefE = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
    const holyKnightMultE = hasHolyKnightPassive ? (pe('聖騎士')?1.3:1.2) : 1.0
    const kabeDefE = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 1.2 : 1.0
    const defPenN = mods.defPen ? 1 : 0
    const pDef  = mods.defPen ? 1 : eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1) * holyFieldDefE * holyKnightMultE * kabeDefE
    const pMdef = mods.defPen ? 1 : eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1) * holyFieldDefE * holyKnightMultE * kabeDefE
    const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
    const berserkDmgRate = hasBerserk ? 1.1 : 1.0
    const isEM = enemy.type === 'magical'
    const burnDebuffE = enemyBuffs.burn?.turns > 0 ? 0.9 : 1.0
    const eAtk = (isEM
      ? (enemy.matk||0) * enPerm.matkMult * (enemyBuffs.matkUp ? enemyBuffs.matkUp.rate : 1) * burnDebuffE
      : enemy.atk * enPerm.atkMult * (enemyBuffs.atkUp ? enemyBuffs.atkUp.rate : 1) * burnDebuffE)
    const isCrit = Math.random()*100 < enemyCritRate
    const defForCalc = isEM ? Math.max(1, pMdef) : Math.max(1, pDef)
    const baseDmg = Math.max(1, Math.floor(eAtk*eAtk/Math.max(1,eAtk+defForCalc))+Math.floor(Math.random()*3))
    const enemySpdBuff = enemyBuffs.spdUp ? enemyBuffs.spdUp.rate : 1
    const playerSpdDebuff = playerBuffs.spdDown ? playerBuffs.spdDown.rate : 1
    const effectivePlayerSpd = effectiveSpdForCalc * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1) * playerSpdDebuff
    const effectiveEnemySpd = enemySpd * enemySpdBuff
    // mods.alwaysHit（蒼穹アウストラリス）：必中＝プレイヤー回避無効
    const evasionRate = mods.alwaysHit ? 0 : (calcEvasionRate(effectivePlayerSpd, effectiveEnemySpd) + (eff.evasionBonus || 0) + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0) + (hasOnmi ? 5 : 0))
    if (evasionRate > 0 && Math.random()*100 < evasionRate) {
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
      logs.push({ text:`${prefix}${enemy.name}の攻撃！ しかし回避した！`, color:'#44ff88' })
      return
    }
    enemyActionStreak++
    const escalateMult = mods.escalatingHit ? (1 + mods.escalatingHit * (enemyActionStreak - 1)) : 1.0
    const enemyDmgDownRate = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
    const playerDefRankReduction = mods.defPen ? 0 : calcDefReduction(isEM ? eff.mdef : eff.def)
    const gambleBodyMult = hasGambleBody ? (0.7 + Math.random() * (pe('ギャンブラー')?0.4:0.6)) : 1.0
    const allinDebuffInMult = playerBuffs.allinDebuff?.turns > 0 ? 1.3 : 1.0
    let finalDmg = Math.floor(baseDmg*(isCrit?1.5:1.0)*dmgReduceRate*berserkDmgRate*enemyDmgDownRate*escalateMult*(1-playerDefRankReduction)*gambleBodyMult*allinDebuffInMult*(0.9+Math.random()*0.2))
    finalDmg = capPlayerDmg(finalDmg)
    playerHp -= finalDmg
    if (playerBuffs.dmgReduce?.isGainoKabe) playerBuffs.dmgReduce = null
    const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
    const critText = isCrit ? ' 💥クリティカル！' : ''
    const escalateText = (mods.escalatingHit && enemyActionStreak > 1) ? ` 🌀連撃×${enemyActionStreak}！` : ''
    logs.push({ text:`${prefix}${enemy.name}の攻撃！ あなたに${finalDmg}ダメージ…${critText}${escalateText}`, color:isCrit?'#ff2200':'#ff6644' })
    onEnemyHit()
  }

  // 1ターン分の敵行動。Phase1の宮は kit を持たないので通常攻撃。
  const doEnemyKitTurn = () => {
    const kit = enemy.kit
    if (!kit) { doEnemyAttack(false); return }
    // （kit 駆動の宮は後続フェーズで実装）
    doEnemyAttack(false)
  }

  // 開幕大ダメージ（白羊ハマル）
  if (mods.openingBurst) {
    const eStats = enemyCastStats()
    const isMag = enemy.type === 'magical'
    const stat = mods.openingBurst.stat === 'matk' ? eStats.matk : eStats.atk
    const dmg = scaleDamageToPlayer(stat * mods.openingBurst.mult, stat, mods.openingBurst.stat === 'matk' ? 'matk' : 'atk', false)
    playerHp -= dmg
    logs.push({ text:`💥 ${enemy.name}の開幕奇襲！ あなたに${dmg}ダメージ！`, color:'#ff2200' })
  }

  while (playerHp > 0 && enemyHp > 0 && turn <= 50) {
    // ===== ターン開始: mods による敵能力スケーリング =====
    if (mods.turnScaleAtk) { const m = 1 + mods.turnScaleAtk * (turn - 1); enPerm.atkMult = m; enPerm.matkMult = m }
    if (mods.turnScaleAll) { const m = 1 + mods.turnScaleAll * (turn - 1); enPerm.atkMult = m; enPerm.matkMult = m; enPerm.defMult = m; enPerm.mdefMult = m; enPerm.spdMult = m }
    if (mods.hpScaleDef)   { const missing = 1 - enemyHp / enemyMaxHp; const m = 1 + missing * (mods.hpScaleDef - 1); enPerm.defMult = m; enPerm.mdefMult = m }
    if (mods.hpThreshAtk && !hpThreshDone && enemyHp / enemyMaxHp <= mods.hpThreshAtk.below) {
      hpThreshDone = true; enPerm.atkMult *= mods.hpThreshAtk.mult; enPerm.matkMult *= mods.hpThreshAtk.mult
      logs.push({ text:`🔥 ${enemy.name}が本気を出した！ 攻撃力が上昇！`, color:'#ff8844' })
    }
    // healBlock（断絶アクベンス）: 回復阻害を付与
    if (mods.healBlock && !healBlockApplied) {
      healBlockApplied = true; playerBuffs.healSeal = { turns:999 }
      logs.push({ text:`🚫 ${enemy.name}の断絶！ あなたは回復できない！`, color:'#ff4488' })
    }
    // dispelPerTurn（断絶アクベンス）: こちらのバフを解除
    if (mods.dispelPerTurn && turn > 1) {
      const POS = ['atkUp','matkUp','spdUp','defUp','mdefUp','dmgReduce','regenHeal','evasion','hitBonus','bloodRage','statusImmune','holyField','holyAwakening','critResist']
      let removed = 0
      for (const k of POS) {
        if (removed >= mods.dispelPerTurn) break
        if (playerBuffs[k] && (playerBuffs[k].turns > 0 || playerBuffs[k].turns === undefined)) { delete playerBuffs[k]; removed++ }
      }
      if (removed > 0) logs.push({ text:`🌀 ${enemy.name}がバフを${removed}つ解除した！`, color:'#cc66ff' })
    }

    // 敵への持続ダメージ（固定割合DoT＝flatDR貫通）
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
    if (playerBuffs.poison?.turns > 0) {
      const poisonDmgP = Math.floor(profile.hp_max * playerBuffs.poison.dmgRate); playerHp = Math.max(0, playerHp - poisonDmgP)
      logs.push({ text:`☠ 毒ダメージ！ あなたに${poisonDmgP}ダメージ！`, color:'#44ff44' })
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
    // ポーション（十二宮では消費せず効果のみ適用）
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
    enemyActionStreak = 0
    let enemySkipped = false
    if (mods.ccImmune) {
      // 行動妨害無効（金牛アルデバラン）：スタン/麻痺を無視して必ず行動
      if (enemyBuffs.stun) delete enemyBuffs.stun
      if (enemyBuffs.paralysis) delete enemyBuffs.paralysis
    } else if (enemyBuffs.stun?.turns > 0) {
      logs.push({ text:`${turn}ターン目: ${enemy.name}はスタンして行動できない！`, color:'#ffaa00' })
      enemySkipped = true; delete enemyBuffs.stun
    } else if (enemyBuffs.paralysis?.turns > 0 && Math.random() < enemyBuffs.paralysis.skipRate) {
      logs.push({ text:`${turn}ターン目: ${enemy.name}は麻痺で行動不能！`, color:'#ffaa00' })
      enemySkipped = true; enemyBuffs.paralysis.skipRate *= 0.5
    }
    if (!enemySkipped) {
      doEnemyKitTurn()
      if (playerHp <= 0) break
      // 素早さによる追加行動（mods.extraActionCap まで連続）
      const cap = mods.extraActionCap || 1
      let extras = 0
      while (extras < cap && enemyExtraRate > 0 && Math.random()*100 < enemyExtraRate) {
        doEnemyAttack(true); extras++
        if (playerHp <= 0) break
      }
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
    logs.push({ type:'hp', turn, playerHp:Math.max(0,playerHp), playerMax:profile.hp_max, playerName:profile.username, enemyHp:Math.max(0,enemyHp), enemyMax:enemyMaxHp, enemyName:enemy.name, playerStatus:extractStatuses(playerBuffs), enemyStatus:extractStatuses(enemyBuffs) })
    turn++
  }

  const win = enemyHp <= 0
  const turns = Math.min(turn, 50)
  logs.push(win
    ? { text:`✦ ${enemy.name}を ${turns}ターンで打ち倒した！`, color:'#ffcc44' }
    : { text:`敗北… 天穹の頂きは遠い。`, color:'#ff4444' })
  return { logs, win, turns }
}

export default function Tenkyuu() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [skillSets, setSkillSets] = useState([])
  const [playerItem, setPlayerItem] = useState(null)
  const [abilityTitle, setAbilityTitle] = useState(null)
  const [cleared, setCleared] = useState([])           // 制覇した宮番号（現状セッション内のみ。永続化は後日）
  const [scene, setScene] = useState('lobby')          // 'lobby' | 'battle'
  const [battlePalace, setBattlePalace] = useState(null)
  const [battleLogs, setBattleLogs] = useState([])
  const [battling, setBattling] = useState(false)
  const [resultWin, setResultWin] = useState(null)
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
    const [{ data: prof }, { data: eq }, { data: prof2 }, { data: ss }, { data: pi }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('proficiency').select('*, weapons(*)').eq('player_id', user.id),
      supabase.from('skill_sets').select('*, skills(*)').eq('player_id', user.id).order('slot_order'),
      supabase.from('player_items').select('*, items(*)').eq('player_id', user.id).eq('equipped', true).maybeSingle(),
    ])
    if (!prof) { nav('/create'); return }
    setProfile(prof)
    setEquipment(eq || [])
    setProficiency(prof2 || [])
    {
      const all = ss || []
      const challenge = all.filter(r => r.set_type === 'challenge')
      const sortie = all.filter(r => (r.set_type || 'sortie') === 'sortie')
      setSkillSets(challenge.length ? challenge : sortie)
    }
    setPlayerItem(pi || null)
    if (prof.ability_title_id) {
      const { data: at } = await supabase.from('titles').select('*').eq('id', prof.ability_title_id).single()
      setAbilityTitle(at || null)
    }
  }

  const handleChallenge = (palace) => {
    const pd = getPalace(palace)
    if (!pd || pd.wip || !profile || battling || remaining > 0) return
    setBattlePalace(palace)
    setBattling(true); setScene('battle'); setBattleLogs([]); setResultWin(null)
    setRemaining(TENKYUU_CD)

    const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
    const { logs, win } = simulateTenkyuuBattle(eff, equipment, skillSets, profile, { ...pd.enemy }, playerItem)
    setBattleLogs(logs)
    setResultWin(win)
    if (win) setCleared(prev => prev.includes(palace) ? prev : [...prev, palace])
    setBattling(false)
  }

  if (!profile) {
    return <div style={{ color:'#c8a0ff', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>
  }

  // 開発アカウント限定
  if (!profile.is_admin) {
    return (
      <div style={{ minHeight:'100vh', background:'#070310', padding:'12px', fontFamily:'monospace' }}>
        <div style={{ maxWidth:'640px', margin:'0 auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #2a1f5a', paddingBottom:'8px', marginBottom:'12px' }}>
            <div style={{ color:'#c8a0ff', fontSize:'16px', letterSpacing:'3px' }}>🌌 天穹十二宮</div>
            <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #6644aa', color:'#9977cc', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
          </div>
          <div style={{ border:'1px solid #4a2a6a', background:'#120a22', padding:'24px', textAlign:'center', color:'#b088dd', fontSize:'13px', lineHeight:'1.9' }}>
            🚧 天穹十二宮は現在【開発中】です。<br/>調整が完了するまでお待ちください。
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight:'100vh', background:'#070310', padding:'12px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'680px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #2a1f5a', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#c8a0ff', fontSize:'16px', letterSpacing:'3px' }}>🌌 天穹十二宮</div>
          <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #6644aa', color:'#9977cc', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
        </div>

        {scene === 'lobby' && (
          <>
            <div style={{ border:'1px solid #4a2a6a', background:'#120a22', padding:'12px', marginBottom:'12px' }}>
              <div style={{ color:'#b088dd', fontSize:'12px', lineHeight:'1.9' }}>
                制覇: <span style={{ color:'#ffcc66', fontWeight:'bold' }}>{cleared.length}</span> ／ 全{TENKYUU_PALACE_COUNT}宮
                <span style={{ color:'#7766aa', fontSize:'10px', marginLeft:'8px' }}>(開発アカウント限定)</span>
              </div>
              <div style={{ color:'#7766aa', fontSize:'10px', marginTop:'4px', lineHeight:'1.7' }}>
                現状最強の十二宮と戦うエンドコンテンツ。好きな宮から挑戦できる。<br/>
                <span style={{ color:'#88ccff' }}>過剰なステータスは5%しか発揮されない（天穹の理）。上限は宮ごとに異なる</span>。敵に合わせてビルドとスキルを調整しよう。<br/>
                <span style={{ color:'#cc9944' }}>※称号報酬・進捗の保存は後日実装。現状の制覇マークはこの画面内のみ。</span>
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'8px' }}>
              {TENKYUU_PALACES.map(p => {
                const done = cleared.includes(p.palace)
                const locked = p.wip
                const canFight = !locked && remaining <= 0 && !battling
                return (
                  <div key={p.palace} style={{ border:`1px solid ${done ? '#3a6a4a' : locked ? '#2a2440' : '#4a2a6a'}`, background: done ? '#0c160e' : locked ? '#0c0a16' : '#140c22', padding:'12px', opacity: locked ? 0.6 : 1 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                      <div style={{ color: done ? '#88ddaa' : '#e0b0ff', fontSize:'14px', fontWeight:'bold' }}>
                        第{p.palace}宮　{p.name}
                      </div>
                      {done && <span style={{ color:'#55cc88', fontSize:'11px' }}>✓ 制覇</span>}
                      {locked && <span style={{ color:'#9988bb', fontSize:'10px' }}>準備中</span>}
                    </div>
                    <div style={{ color:'#aa99cc', fontSize:'10px', lineHeight:'1.7', marginBottom:'8px' }}>
                      <span style={{ color:'#cc88dd' }}>特徴:</span> {p.feature}
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ color:'#7766aa', fontSize:'10px' }}>推奨総合力 <span style={{ color:'#ffcc66', fontWeight:'bold' }}>{fmt(p.target)}</span></span>
                      <button onClick={()=>handleChallenge(p.palace)} disabled={!canFight}
                        style={{ padding:'7px 18px', background: canFight ? '#2a1040' : '#140a1c', border:`1px solid ${canFight ? '#a060ff' : '#3a2a4a'}`, color: canFight ? '#d0a0ff' : '#5a4a6a', cursor: canFight ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'12px', letterSpacing:'1px' }}>
                        {locked ? '準備中' : remaining > 0 ? `⏳ ${remaining.toFixed(1)}s` : '⚔ 挑む'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {scene === 'battle' && (() => {
          const pd = getPalace(battlePalace)
          return (
            <div style={{ border:'1px solid #6a3a9a', background:'#120a22', padding:'12px' }}>
              <div style={{ color:'#c8a0ff', fontSize:'13px', marginBottom:'10px' }}>⚔ 第{battlePalace}宮　{pd?.name} 戦</div>
              {battling && <div style={{ color:'#9977aa', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
              <div style={{ marginBottom:'12px', maxHeight:'52vh', overflowY:'auto' }}>
                {battleLogs.map((l,i)=>(<BattleLogLine key={i} l={l} />))}
                <div ref={logsEndRef} />
              </div>

              {!battling && resultWin === true && (
                <div style={{ border:'1px solid #ffcc44', background:'#1a1400', padding:'12px', marginBottom:'10px', textAlign:'center' }}>
                  <div style={{ color:'#ffcc44', fontSize:'14px', marginBottom:'4px' }}>✦ 第{battlePalace}宮 制覇！</div>
                  <div style={{ color:'#ccaa66', fontSize:'10px' }}>称号報酬は後日実装予定です。</div>
                </div>
              )}
              {!battling && resultWin === false && (
                <div style={{ border:'1px solid #aa4466', background:'#1a0a14', padding:'10px', marginBottom:'10px', color:'#ff8899', fontSize:'12px', textAlign:'center' }}>敗北… スキルを調整して再挑戦しよう。</div>
              )}

              {!battling && (
                <button onClick={()=>{ setScene('lobby'); setBattleLogs([]); setResultWin(null) }}
                  style={{ width:'100%', padding:'10px', background:'#1a1030', border:'1px solid #6644aa', color:'#9977cc', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                  ← 宮の選択に戻る
                </button>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
