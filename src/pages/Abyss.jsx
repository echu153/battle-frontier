import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useScarecrowBlock, ScarecrowBlockScreen } from '../components/ScarecrowGuard'
import { getWeaponGroup } from '../lib/stats'
import { evoOnHit, evoOnDamaged, evoOnEvade, evoTakenMult, evoAllSkillsSet, evoAtkMult, evoMatkMult } from '../lib/evoCombat'
import { emblemDmgMult, emblemDrainAmount, emblemDotMult, emblemResistNewAilments, emblemBlocksAilment } from '../lib/emblemCombat'
import { petPlayerBonus, charmPlayerBonus } from '../constants/pets'
import { selectBattleSkillSets } from '../lib/loadout'
import { buildSummon, summonAnnounce, summonAttackDamage, summonAbsorbBasic, summonAbsorbSkill, summonEndOfTurn, tryPetCommand, BREEDER_COMMANDS } from '../lib/summon'
import {
  calcEffectiveStats,
  calcEvasionRate,
  calcExtraActionRate,
  calcCritRate,
  calcDefReduction,
  applyEquipmentEffects,
  consumeAilmentShield,
  ailmentShieldBlocks,
  executeSkill,
  extractStatuses,
  BattleLogLine,
  MULTI_HIT_SKILLS,
} from './Game'
import { ABYSS_FLOOR_COUNT, ABYSS_DEFINED_FLOORS, getAbyssFloor } from '../lib/abyss'

const STONE_NAME = (r) => `強化石(${r})`
const fmt = (n) => Number(n).toLocaleString()
const floorLabel = (n) => `地下${n}階`
const ABYSS_CD = 5  // 奈落の挑戦クールダウン(秒)

// ネットワーク応答が返らない場合に「戦闘中...」で永久停止するのを防ぐタイムアウト付きラッパー。
// Supabaseのfetchがハングしても一定時間で例外化し、finallyでbattlingを必ず解除できるようにする。
const withTimeout = (promise, ms = 15000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])

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
function simulateAbyssBattle(eff, equipment, skillSets, profile, enemy, playerItem, floor = 1) {
  const logs = []
  // 奈落限定ルール: 敵は階数×2%の被ダメージ軽減（プレイヤーの与ダメに乗算）
  const abyssEnemyDR = 1 - Math.min(0.9, floor * 0.02)
  let playerHp = eff.hp_max
  let playerMp = eff.mp_max
  let enemyHp = enemy.hp
  const enemyMaxHp = enemy.hp
  let turn = 1, skillIndex = 0
  let playerBuffs = {}, enemyBuffs = {}
  let currentItem = playerItem ? { ...playerItem } : null
  let itemUsed = false
  let prevSkillName = null
  let playerAttacking = false
  let rokkanStacks = 0    // 第六感(再修練)：魔法攻撃ヒット毎に+5%・最大6
  let seimitsuStacks = 0  // 精密照準(再修練)：同スキル連続で+10%/クリ+2%・最大3

  // ===== 敵スキルAI 状態（kit駆動） =====
  // 敵はMP消費なしでスキル撃ち放題。HP閾値で発動スキルが1度だけ切り替わる。
  let enUsedT75 = false, enUsedT40 = false, enUsedSpecial = false
  let enLockedSkill = null           // persist/thenOnly でロックされたスキル（毎ターンこれ）
  let prevEnemySkill = ''
  // 永続強化（絶影/天の祝福/影強化 など custom大技で付与）
  const enPerm = { atkMult:1, matkMult:1, defMult:1, mdefMult:1, spdMult:1, critDmgPlus:0, convertCtoA:false, followupAtk:0 }
  // 敵をプレイヤーに見立てた施術用プロフィール（executeSkill 用）
  const enemyProfile = { hp_max: enemyMaxHp, mp_max: 999999, class: '', retraining: {}, username: enemy.name }

  const equippedWeaponItem = equipment.find(e => e.slot === 'weapon' && e.equipped)
  const ondmgSpdUp = eff.ondmgSpdUp || 0  // 雷鋼の機神鎧: 被ダメ時に付与する素早さ倍率（0=なし）
  const hasAmagoiShield = equipment.some(e => e.equipped && e.bonus_effect === 'battle_start_ailment_shield')  // 哭雨の羽衣: 5Tごとに異常無効バフ再付与
  const isArtifact = equippedWeaponItem?.bonus_effect === 'artifact'

  const passiveNames = skillSets.filter(ss => ss.skills?.type === 'パッシブ').map(ss => ss.skills.name)
  const hasIai        = passiveNames.includes('居合の構え') || passiveNames.includes('心眼')  // 居合の構え（旧:心眼）
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

  const passiveCritBonus    = 0  // 精密照準のクリは再修練のスタックへ移行（素のクリ加算なし）
  const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.25 : 0  // 隠身強化：クリ威力+25%
  // 心眼(居合の構え)は物理ダメ専用のため passiveDmgMult からは除外（iaiPhysMult で別管理）
  // 第六感の素の与ダメ強化は廃止（再修練スタックへ移行）
  const passiveDmgMult      = (hasBerserk ? (pe('狂戦士')?1.40:1.15) : 1.0) * (hasKakushin ? (pe('異端審問官')?1.40:1.20) : 1.0) * (eff.weaponDmgMult || 1)
  const passiveHealMult     = (hasShinkoka ? 1.5 : 1.0) * (hasKakushin ? 0.5 : 1.0)  // 執行本能：回復量×0.5（常時）
  const passiveMatkMult     = hasShinkoka ? 1.1 : 1.0
  const passiveMpCostMult   = (hasTenki ? (pe('賢者')?0.5:0.7) : 1.0) * (eff.weaponMpCostMult || 1)  // 天啓：MP消費 通常×0.7／再修練×0.5
  const passiveMatkMultTenki = hasTenki ? (pe('賢者')?1.4:1.2) : 1.0  // 天啓：MATK 通常×1.2／再修練×1.4
  const passiveHitBonus     = (hasRokkan ? 10 : 0) + (hasSeimitsu ? 10 : 0) + (hasTakaNoMe ? (pe('狩人')?20:10) : 0)  // 第六感/精密照準=命中+10、鷹ノ目=+10/+20
  const passiveHealReflect  = (hasShinkoka && pe('聖職者'))
  const hasGambleBody       = passiveNames.includes('ギャンブルボディ')
  const hasMadokenJutsu     = passiveNames.includes('魔導剣術')
  const hasHolyKnightPassive= passiveNames.includes('聖騎士の心得')
  // 精霊共鳴（精霊召喚士・再修練1+）：最大MP+20%（開始MPを引き上げ・出撃と同一挙動）
  if (profile.class === '精霊召喚士' && rtCur >= 1 && passiveNames.includes('精霊共鳴')) {
    const boostedMp = Math.floor(eff.mp_max * 1.2)
    playerMp = Math.min(boostedMp, profile.mp_current ?? boostedMp)
  }
  // 竜鱗の加護（竜騎士）：防御×1.2（再修練×1.4）＋被ダメ時30%で軽減（-5%／再修練-20%）
  const hasRyurin  = passiveNames.includes('竜鱗の加護')
  const ryurinMult = hasRyurin ? (pe('竜騎士') ? 1.4 : 1.2) : 1.0
  const ryurinReduce = () => (hasRyurin && Math.random() < 0.3) ? (pe('竜騎士') ? 0.80 : 0.95) : 1.0
  // 召喚系パッシブ（式神召喚／ペット召喚）
  const summon = buildSummon(profile, passiveNames, profile.activePet)
  summonAnnounce(summon, logs)

  // 居合の構え：セット中の通常スキルが全て使用回数1のとき発動（物理ダメージ専用 通常+40%／再修練+70%）
  const iaiSetSkills = skillSets.filter(ss => ss.skills && ss.skills.type !== 'パッシブ')
  const iaiLoadoutOK = iaiSetSkills.length > 0 && iaiSetSkills.every(ss => (ss.use_count ?? 1) === 1)
  const iaiPhysMult   = (hasIai && iaiLoadoutOK) ? (pe('侍')?1.70:1.40) : 1.0
  const takaAtkBonus  = (hasTakaNoMe && pe('狩人')) ? Math.floor((eff.spd||0) * 0.1) : 0  // 鷹ノ目強化：素早さの10%を攻撃に加算
  const madokenAtkMult = (hasMadokenJutsu && pe('魔法剣士')) ? 1.1 : 1.0  // 魔導剣術強化：攻撃力×1.1

  logs.push({ text:`⚔ ${enemy.name}が立ちはだかった！`, color:'#ff6644' })

  playerBuffs = applyEquipmentEffects(equipment, profile, playerBuffs, logs)

  const effectiveSpdForCalc = eff.spd  // 鷹ノ目のSPD×1.2は廃止（命中+ATK加算へ仕様変更）
  const weaponType = equippedWeaponItem?.weapons?.weapon_type || 'sword'
  const isMagical = getWeaponGroup(weaponType) === 'magical'
  const expandedSkillSet = []
  for (const ss of skillSets) {
    if (ss.skills?.type === 'パッシブ') continue
    const count = ss.use_count || 1
    for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
  }
  const allSkillsSet = evoAllSkillsSet(skillSets)  // 深紅の牙輪/魔眼石の真化条件

  const playerSpd = effectiveSpdForCalc
  const enemySpd = enemy.spd || 5
  const playerExtraRate = calcExtraActionRate(playerSpd, enemySpd)
  const enemyExtraRate  = calcExtraActionRate(enemySpd, playerSpd)
  // 天墜竜閃を使ったターン（溜め・解放とも）は追加行動を出さない（tenkaiChargeは解放時にクリアされタイミング依存になるため明示フラグで抑止）
  let tenkaiActedThisTurn
  const playerCritRate  = calcCritRate(playerSpd, enemySpd) + passiveCritBonus + (eff.critBonus || 0)
  const enemyCritRate   = Math.max(0, calcCritRate(enemySpd, playerSpd) - (eff.critResist || 0) - (playerBuffs.critResist?.turns > 0 ? (playerBuffs.critResist.value || 0) : 0))
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
    // MP不足なら今ターンはスキル不可：明示メッセージを出して通常攻撃にフォールバック
    let mpLack = false
    if (nextSkill) {
      let peekMpCost = Math.floor((isArtifact ? (nextSkill.mp_cost||0)*2 : (nextSkill.mp_cost||0)) * passiveMpCostMult)
      if (nextSkill.name === 'マナボルト') peekMpCost = Math.max(1, Math.floor(playerMp * 0.1))
      mpLack = playerMp < peekMpCost
      if (mpLack) logs.push({ text:`💧 MPが足りなくてスキルが使えない！`, color:'#6699ff' })
    }
    const isSureHit = !mpLack && nextSkillName === '絶影狙撃'
    // バフ・回復スキルは自分にかけるものなので敵に回避されない（MP不足時は通常攻撃なので回避判定あり）
    const isSelfSkill = !mpLack && nextSkill && (nextSkill.type === '強化' || nextSkill.type === '回復')
    // 多段ヒットスキルは行動全体の回避判定をスキップし、1発ごとに回避判定する
    const isMultiHitSkill = !mpLack && nextSkill && MULTI_HIT_SKILLS.has(nextSkill.name)
    const skillExtraHit = (nextSkillName === '連装銃撃' && profile.class === '魔銃士' && rtCur >= 2) ? 10 : 0
    const baseEnemyEvasion = Math.max(0, enemyEvasionRate - playerHitBonus - buffHitBonus - skillExtraHit)
    const effectiveEnemyEvasion = (isSureHit || isSelfSkill || isMultiHitSkill) ? 0 : baseEnemyEvasion
    if (effectiveEnemyEvasion > 0 && Math.random()*100 < effectiveEnemyEvasion) {
      logs.push({ text:`${prefix}${nextSkillName && !mpLack ? `${nextSkillName}！` : '攻撃！'} しかし${enemy.name}に回避された！`, color:'#446688' })
      // 追撃系（鬼影閃の影歩き追撃など）はメインが回避されても独立ヒットとして発動する
      if (nextSkill && !mpLack) {
        const resPeek = executeSkill(nextSkill, effBuff, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
        if (resPeek.followup && resPeek.followup.dmg > 0) {
          const adjED = Math.max(1, Math.floor((enemy.def||0)*eDefRate*enPerm.defMult))
          const fScale = effBuff.atk / (effBuff.atk + adjED)
          const fCrit = Math.random()*100 < playerCritRate
          const fCritMult = fCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
          const dr = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
          let fDmg = Math.floor(resPeek.followup.dmg * fScale * fCritMult * passiveDmgMult * dr * abyssEnemyDR * (0.9 + Math.random()*0.2))
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
    // 天墜竜閃の溜め中は次手番を必ず天墜竜閃(解放)に固定（無いと溜めっぱなしで攻撃しない）
    if (playerBuffs.tenkaiCharge?.turns > 0) {
      const tIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === '天墜竜閃')
      if (tIdx >= 0) skillIndex = tIdx
    }
    let skillUsed = false
    if (expandedSkillSet.length > 0) {
      const cs = expandedSkillSet[skillIndex % expandedSkillSet.length]
      let mpCost = Math.floor((isArtifact ? (cs?.skills?.mp_cost||0)*2 : (cs?.skills?.mp_cost||0)) * passiveMpCostMult)
      if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(playerMp * 0.1))
        if (cs?.skills?.name === '天墜竜閃' && playerBuffs.tenkaiCharge?.turns > 0) mpCost = 0  // 解放ターンはMP消費なし（溜め時に消費済み）
      const isBreederCmd = cs?.skills?.name && BREEDER_COMMANDS.has(cs.skills.name)
      if (isBreederCmd) {
        // ブリーダーのコマンドスキル（executeSkillを通さず専用処理）
        const cmd = tryPetCommand(cs.skills.name, summon, { def: enemy.def, mdef: enemy.mdef, atk: enemy.atk, matk: enemy.matk, type: enemy.type, name: enemy.name, evasionRate: 0 }, enemyBuffs, playerBuffs, rtCur, playerMp, mpCost, eff.hp_max, logs, `${turn}ターン目: `)
        if (cmd.handled) {
          playerMp -= cmd.mpUsed
          if (cmd.enemyDamage > 0) enemyHp -= cmd.enemyDamage
          if (cmd.playerHeal > 0) playerHp = Math.min(eff.hp_max, playerHp + cmd.playerHeal)
          prevSkillName = cs.skills.name
          skillUsed = true; skillIndex++
          if (enemyHp <= 0) { /* 撃破はループ先頭のwhile条件で判定 */ }
        }
      } else if (cs && cs.skills && playerMp >= mpCost) {
        playerMp -= mpCost
        if (cs.skills.name === '天墜竜閃') tenkaiActedThisTurn = true  // 溜め/解放どちらでも当ターンは追加行動なし
        const hasGensoKyomei = passiveNames.includes('元素共鳴')
        const gensoMult = (hasGensoKyomei && prevSkillName && prevSkillName !== cs.skills.name && cs.skills.type === '魔法攻撃') ? (pe('元素使い')?1.50:1.30) : 1.0
        // 精密照準（再修練）：同スキルを連続使用するたびに与ダメ+10%・クリ率+2%（重複3／別スキルでリセット）
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
          // スキルの防御貫通(res.defPen/res.mdefPen)＋明鏡止水等の貫通バフ(mukyoPen)を反映（Game.jsxと同様）
          const skillCls = cs.skills?.class_name
          const buffPen = playerBuffs.mukyoPen?.turns > 0 ? playerBuffs.mukyoPen.rate : 0
          const spMdefPen = playerBuffs.spiritMdefPen?.turns > 0 ? playerBuffs.spiritMdefPen.rate : 0  // ノクス：魔法防御貫通バフ
          const adjED  = Math.max(1, Math.floor((enemy.def ||0)*eDefRate*enPerm.defMult*(1-Math.min(0.8,(res.defPen||0)+buffPen))))
          const adjEMD = Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate*enPerm.mdefMult*(1-Math.min(0.8,(res.mdefPen||0)+spMdefPen))))
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
        // 多段ヒットスキル：1発ごとに回避・クリティカル・ダメージ判定
        const isMulti = Array.isArray(res.hitDmgs) && res.hitDmgs.length > 0 && res.dmg > 0
        let finalDmg, resLog, multiCritAny = false
        if (isMulti) {
          const hitMult = defScale * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * nextBoostMult * enemyDmgReduceMult * abyssEnemyDR * emMult
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
          finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * nextBoostMult * enemyDmgReduceMult * abyssEnemyDR * emMult * (0.9 + Math.random() * 0.2))
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
          // 濡羽杖アマザネ: 攻撃ヒット時 2Tの間対象SPD-5%（最大4重複=-20%・ヒット毎に持続リフレッシュ）
          const curSd = enemyBuffs.spdDown
          const amzSt = Math.min(4, ((curSd?.turns > 0 && curSd.amazaneStacks) || 0) + 1)
          const amzRate = Math.round((1 - 0.05 * amzSt) * 100) / 100
          if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) {
            enemyBuffs.spdDown = { turns: 2, rate: amzRate, amazaneStacks: amzSt }
          }
        }
        evoOnHit(eff, finalDmg, enemyBuffs, enemy.name, logs)
        // 蒼雷の短刃: 追加行動の攻撃ヒット時、eff.extraParaChance%で相手を麻痺
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
        // 追撃（影歩き/出血消費など）を別ヒットとして適用：メインとは独立したダメージ判定
        if (res.followup && res.followup.dmg > 0) {
          const fCrit = Math.random()*100 < (playerCritRate + (res.bonusCritRate||0) + seimitsuCritBonus)
          const fCritMult = fCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
          let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * enemyDmgReduceMult * abyssEnemyDR * emMult * (0.9 + Math.random()*0.2))
          fDmg = Math.max(1, fDmg)
          enemyHp -= fDmg
          logs.push({ text:`↳ 追撃！${res.followup.label?`（${res.followup.label}）`:''} ${enemy.name}に${fDmg}ダメージ！${fCrit?' 💥クリティカル！':''}`, color: fCrit?'#ffaa00':'#ffaa66' })
        }
        // 与ダメ割合回復の1ヒット上限：基本 最大HP20%、クリティカル時35%（血の狂気/ソウルドレイン/ルミナ・レイ共通）
        const healCapPct = (finalCrit || multiCritAny) ? 0.35 : 0.20
        if (playerAttacking && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(eff.hp_max * healCapPct))
          playerHp = Math.min(eff.hp_max, playerHp + rageCure)
          logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
        }
        // 与ダメ割合回復(ソウルドレイン/ルミナ・レイ等)：実際の与ダメージ(クリティカル込み)から回復
        if (res.drainRate > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const drainHeal = Math.min(Math.floor(finalDmg * res.drainRate), Math.floor(eff.hp_max * healCapPct))
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
      const eDefVal = isMagical ? Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate*enPerm.mdefMult)) : Math.max(1, Math.floor(enemy.def*eDefRate*enPerm.defMult))
      const baseDmg = Math.max(1, Math.floor(baseAtk*baseAtk/Math.max(1,baseAtk+eDefVal))+Math.floor(Math.random()*4))
      const enemyDmgReduceMult2 = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
      const iaiNormalMult = isMagical ? 1.0 : iaiPhysMult  // 居合の構え：物理通常攻撃のみ強化
      const rokkanMultN = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05 * Math.min(6, rokkanStacks)) : 1.0
      // 通常攻撃でスキル連続が途切れる → 精密照準/元素共鳴のチェーンをリセット
      seimitsuStacks = 0; prevSkillName = null
      let finalDmg = Math.floor(baseDmg*0.7*critMult*(isArtifact?1.3:1.0)*passiveDmgMult*iaiNormalMult*rokkanMultN*enemyDmgReduceMult2*abyssEnemyDR*emblemDmgMult(eff, !isMagical)*(0.9+Math.random()*0.2))
      enemyHp -= finalDmg
      // 紋章: 物理/特殊吸収
      { const emDrain = emblemDrainAmount(eff, finalDmg, !isMagical); if (emDrain > 0 && !(playerBuffs.healSeal?.turns > 0)) { playerHp = Math.min(eff.hp_max, playerHp + emDrain); logs.push({ text:`💠 紋章の吸収！ HPが${emDrain}回復！`, color:'#66ddff' }) } }
      if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
        enemyBuffs.healDown = { turns: 2, rate: 0.7 }
        logs.push({ text: `🗡 ${equippedWeaponItem?.weapons?.name || '武器'}の効果！ ${enemy.name}の回復力が2ターンの間-30%！`, color: '#ff8844' })
      }
      if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_spd_down_5') {
        // 濡羽杖アマザネ: 攻撃ヒット時 2Tの間対象SPD-5%（最大4重複=-20%・ヒット毎に持続リフレッシュ）
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
        const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(eff.hp_max * (isCrit ? 0.35 : 0.20)))
        playerHp = Math.min(eff.hp_max, playerHp + rageCure)
        logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
      }
      if (expandedSkillSet.length > 0) skillIndex++
    }
    playerAttacking = false
  }

  const doEnemyAttack = (isExtra = false) => {
    // ペット召喚：50%で敵の通常攻撃をペットが受ける（プレイヤーHP無傷）
    if (summonAbsorbBasic(summon, { atk: enemy.atk, matk: enemy.matk, type: enemy.type }, enemyBuffs, turn, logs)) return
    const holyFieldDefE = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
    const holyKnightMultE = hasHolyKnightPassive ? (pe('聖騎士')?2.0:1.5) : 1.0
    const kabeDefE = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
    const pDef  = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1) * holyFieldDefE * holyKnightMultE * kabeDefE * ryurinMult
    const pMdef = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1) * holyFieldDefE * holyKnightMultE * kabeDefE * ryurinMult
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
    const enemySpdDebuff = enemyBuffs.spdDown?.turns > 0 ? enemyBuffs.spdDown.rate : 1  // 濡羽杖アマザネ/スライムの指輪等
    const playerSpdDebuff = playerBuffs.spdDown ? playerBuffs.spdDown.rate : 1
    const effectivePlayerSpd = effectiveSpdForCalc * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1) * playerSpdDebuff
    const effectiveEnemySpd = enemySpd * enemySpdBuff * enemySpdDebuff
    const evasionRate = calcEvasionRate(effectivePlayerSpd, effectiveEnemySpd) + (eff.evasionBonus || 0) + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0) + (hasOnmi ? 5 : 0)
    if (evasionRate > 0 && Math.random()*100 < evasionRate) {
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
      logs.push({ text:`${prefix}${enemy.name}の攻撃！ しかし回避した！`, color:'#44ff88' })
      evoOnEvade(eff, playerBuffs, logs)  // 影踏みのブーツ
      return
    }
    const enemyDmgDownRate = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
    const playerDefRankReduction = calcDefReduction(isEM ? eff.mdef : eff.def)
    const gambleBodyMult = hasGambleBody ? (pe('ギャンブラー') ? (0.5+Math.random()*0.7) : (0.7+Math.random()*0.6)) : 1.0
    const allinDebuffInMult = playerBuffs.allinDebuff?.turns > 0 ? 1.3 : 1.0
    const finalDmg = Math.floor(baseDmg*(isCrit?1.5:1.0)*dmgReduceRate*berserkDmgRate*enemyDmgDownRate*(1-playerDefRankReduction)*gambleBodyMult*allinDebuffInMult*evoTakenMult(eff, !isEM)*ryurinReduce()*(0.9+Math.random()*0.2))
    playerHp -= finalDmg
    { const refl = evoOnDamaged(eff, finalDmg, enemyBuffs, enemy.name, logs); if (refl > 0) enemyHp -= refl }  // 嵐の重装甲/聖鎧/インフェルノ
    if (playerBuffs.dmgReduce?.isGainoKabe) playerBuffs.dmgReduce = null
    const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
    const critText = isCrit ? ' 💥クリティカル！' : ''
    logs.push({ text:`${prefix}${enemy.name}の攻撃！ あなたに${finalDmg}ダメージ…${critText}`, color:isCrit?'#ff2200':'#ff6644' })
  }

  // 敵の現在の施術ステータス（永続強化＋バフを反映）
  const enemyCastStats = () => {
    let atk  = enemy.atk  * enPerm.atkMult  * (enemyBuffs.atkUp?.rate  || 1) * (enemyBuffs.burn?.turns > 0 ? 0.9 : 1)
    let matk = enemy.matk * enPerm.matkMult * (enemyBuffs.matkUp?.rate || 1) * (enemyBuffs.burn?.turns > 0 ? 0.9 : 1)
    if (enPerm.convertCtoA) { atk += matk; matk = 0 }
    const def  = enemy.def  * enPerm.defMult  * (enemyBuffs.defUp?.rate || 1)
    const mdef = enemy.mdef * enPerm.mdefMult * (enemyBuffs.defUp?.rate || 1)
    const spd  = enemy.spd  * enPerm.spdMult  * (enemyBuffs.spdUp?.rate || 1) * (enemyBuffs.spdDown?.turns > 0 ? enemyBuffs.spdDown.rate : 1)
    return { atk, def, matk, mdef, spd, hp_max:enemyMaxHp, mp_max:999999, critDmg:0, defPen:0, mdefPen:0, hitBonus:0, critBonus:0, evasionBonus:0, critResist:0 }
  }

  // 物理/魔法/ハイブリッドの被ダメ計算（プレイヤーDEF/MDEFで軽減）
  const scaleDamageToPlayer = (raw, atkStat, useStat /* 'atk'|'matk'|'hybrid' */, isCrit) => {
    let pDef, rankStat
    if (useStat === 'hybrid') { pDef = Math.min(eff.def, eff.mdef); rankStat = Math.min(eff.def, eff.mdef) }
    else if (useStat === 'matk') { pDef = eff.mdef; rankStat = eff.mdef }
    else { pDef = eff.def; rankStat = eff.def }
    const defScale = atkStat / (atkStat + Math.max(1, pDef))
    const critMult = isCrit ? (1.5 + enPerm.critDmgPlus) : 1.0
    const rankRed = calcDefReduction(rankStat)
    const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
    // ボス装備 真化: 被ダメ%軽減（海竜/蒼粘）＋ 反撃/反射（嵐/聖鎧/インフェルノ）。敵スキルダメージの共通経路。
    const dmg = Math.max(0, Math.floor(raw * defScale * critMult * (1 - rankRed) * dmgReduceRate * evoTakenMult(eff, useStat !== 'matk') * (0.9 + Math.random()*0.2)))
    const refl = evoOnDamaged(eff, dmg, enemyBuffs, enemy.name, logs); if (refl > 0) enemyHp -= refl
    return dmg
  }

  // 敵スキルダメージ：50%でペットが肩代わり（summonAbsorbSkill）。受けなければプレイヤーが被弾
  const skillHitPlayer = (dmg) => { if (summonAbsorbSkill(summon, dmg, logs)) return; playerHp -= dmg }

  // 影強化の追撃（A2.0の物理追撃）
  const doFollowup = () => {
    if (enPerm.followupAtk <= 0) return
    const eStats = enemyCastStats()
    const raw = eStats.atk * enPerm.followupAtk
    const dmg = scaleDamageToPlayer(raw, eStats.atk, 'atk', false)
    skillHitPlayer(dmg)
    logs.push({ text:`↳ ${enemy.name}の追撃！ あなたに${dmg}ダメージ！`, color:'#ff8866' })
  }

  // 既存スキル（executeSkillのswitchで定義済み）を敵が詠唱
  const castExistingSkill = (def) => {
    const eStats = enemyCastStats()
    const playerTarget = { name:profile.username, def:eff.def, mdef:eff.mdef, hp:eff.hp_max, hp_max:eff.hp_max, type:'physical' }
    // executeSkill: caster=enemy(eStats/enemyProfile), target=player。
    // 戻り値 newPlayerBuffs=詠唱者(敵)バフ, newEnemyBuffs=対象(プレイヤー)デバフ
    const prevPlayerBuffs = playerBuffs  // 哭雨の羽衣: 新規状態異常の差分検知用
    const res = executeSkill({ name:def.name }, eStats, enemyProfile, playerTarget, playerBuffs, enemyBuffs, false, prevEnemySkill)
    prevEnemySkill = def.name
    const isMag = enemy.type === 'magical'
    let finalDmg = 0
    if (res.dmg > 0) {
      const atkStat = isMag ? eStats.matk : eStats.atk
      const isCrit = Math.random()*100 < enemyCritRate
      finalDmg = scaleDamageToPlayer(res.dmg, atkStat, isMag ? 'matk' : 'atk', isCrit)
      skillHitPlayer(finalDmg)
    }
    if (res.selfDmg > 0) enemyHp = Math.max(0, enemyHp - res.selfDmg)
    if (res.heal > 0) enemyHp = Math.min(enemyMaxHp, enemyHp + (enemyBuffs.healDown?.turns > 0 ? Math.floor(res.heal * enemyBuffs.healDown.rate) : res.heal))
    enemyBuffs = res.newPlayerBuffs
    playerBuffs = res.newEnemyBuffs
    consumeAilmentShield(prevPlayerBuffs, playerBuffs, logs)  // 哭雨の羽衣: 新規状態異常を1回無効化
    emblemResistNewAilments(eff, prevPlayerBuffs, playerBuffs, logs)  // 紋章: 個別状態異常耐性
    // 確定出血（瞬歩瞬殺/鬼影閃）
    if (def.guaranteedBleed && !ailmentShieldBlocks(playerBuffs, logs) && !emblemBlocksAilment(eff, 'bleed', logs)) {
      const b = playerBuffs.bleed
      playerBuffs.bleed = { stacks: Math.min(5, (b?.stacks || 0) + 1), lastTurn: 0 }
    }
    // 鬼影閃コンボ：出血最大時に追撃して出血消費
    if (def.name === '鬼影閃' && (playerBuffs.bleed?.stacks || 0) >= 5) {
      const eStats2 = enemyCastStats()
      const bonus = scaleDamageToPlayer(eStats2.atk * (Math.min(1.0, playerBuffs.bleed.stacks * 0.2)) * 1.5, eStats2.atk, 'atk', false)
      skillHitPlayer(bonus)
      delete playerBuffs.bleed
      logs.push({ text:`🩸 急所突き自動発動！ 出血を爆発させ${bonus}ダメージ！`, color:'#ff3366' })
    }
    const shown = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
    logs.push({ text:`▶ ${enemy.name}の${shown}`, color: res.dmg > 0 ? '#ff7755' : '#ffaa66' })
    // executeSkill由来の追撃（敵の影歩き鬼影閃など）を別ヒットとして適用
    if (res.followup && res.followup.dmg > 0) {
      const fCrit = Math.random()*100 < enemyCritRate
      const fDmg = scaleDamageToPlayer(res.followup.dmg, isMag ? eStats.matk : eStats.atk, isMag ? 'matk' : 'atk', fCrit)
      skillHitPlayer(fDmg)
      logs.push({ text:`↳ ${enemy.name}の追撃！${res.followup.label?`（${res.followup.label}）`:''} あなたに${fDmg}ダメージ！${fCrit?' 💥クリティカル！':''}`, color:'#ff6655' })
    }
    doFollowup()
  }

  // HP15%大技 ＋ 影強化/絶影 など 新規(custom)スキルを敵が使用
  const castCustomSkill = (def) => {
    // 純バフ/変身（ダメージなし）
    const isPureBuff = !def.atk && !def.matk
    if (isPureBuff) {
      if (def.fullHeal) enemyHp = enemyMaxHp
      if (def.allStatsMult) { enPerm.atkMult*=def.allStatsMult; enPerm.matkMult*=def.allStatsMult; enPerm.defMult*=def.allStatsMult; enPerm.mdefMult*=def.allStatsMult; enPerm.spdMult*=def.allStatsMult }
      if (def.convertCtoA) enPerm.convertCtoA = true
      if (def.addFollowup) enPerm.followupAtk = def.addFollowup.atk
      if (def.buff?.atkMult)  enPerm.atkMult  *= def.buff.atkMult
      if (def.buff?.matkMult) enPerm.matkMult *= def.buff.matkMult
      if (def.buff?.spdMult)  enPerm.spdMult  *= def.buff.spdMult
      if (def.critDmgPlus) enPerm.critDmgPlus += def.critDmgPlus
      logs.push({ text:`✦ ${enemy.name}の「${def.name}」！ 力が解放された！`, color:'#ff66cc' })
      return
    }
    // ダメージ大技
    const hits = def.hits || 1
    const useStat = (def.atk && def.matk) ? 'hybrid' : (def.matk ? 'matk' : 'atk')
    let total = 0
    for (let h = 0; h < hits; h++) {
      const eStats = enemyCastStats()
      const raw = (def.atk ? eStats.atk * def.atk : 0) + (def.matk ? eStats.matk * def.matk : 0)
      const atkStat = useStat === 'hybrid' ? (eStats.atk + eStats.matk) / 2 : (useStat === 'matk' ? eStats.matk : eStats.atk)
      const isCrit = def.critGuaranteed || (Math.random()*100 < enemyCritRate)
      total += scaleDamageToPlayer(raw, atkStat, useStat, isCrit)
    }
    skillHitPlayer(total)
    if (def.lifesteal && total > 0) enemyHp = Math.min(enemyMaxHp, enemyHp + Math.floor(total * def.lifesteal))
    logs.push({ text:`💥 ${enemy.name}の「${def.name}」！ あなたに${total}ダメージ！${def.critGuaranteed?' 💥確定クリティカル！':''}`, color:'#ff2200' })
    // 付随効果
    if (def.executeHpBelow && playerHp > 0 && playerHp <= def.executeHpBelow) {
      playerHp = 0
      logs.push({ text:`☠ ${def.name}の追い打ち！ 致命の一撃で即死した…！`, color:'#ff0000' })
    }
    if (def.stunGuaranteed && !ailmentShieldBlocks(playerBuffs, logs) && !emblemBlocksAilment(eff, 'stun', logs)) { playerBuffs.stun = { turns:1 }; logs.push({ text:`⚡ スタンした！ 次のターン行動できない！`, color:'#ffaa00' }) }
    if (def.healBlock && !ailmentShieldBlocks(playerBuffs, logs)) { playerBuffs.healSeal = { turns:999 }; logs.push({ text:`🚫 ${def.name}！ 以降あなたは回復できない！`, color:'#ff4488' }) }
    if (def.dispelPlayerBuffs) { playerBuffs = {}; logs.push({ text:`🌀 ${def.name}！ あなたの強化が全て消し去られた！`, color:'#cc66ff' }) }
    if (def.inflict) {
      for (const st of def.inflict) {
        if (st === 'paralysis' && !(playerBuffs.paralysis?.turns > 0) && !ailmentShieldBlocks(playerBuffs, logs) && !emblemBlocksAilment(eff, 'paralysis', logs)) playerBuffs.paralysis = { turns:4, skipRate:0.25, spdRate:0.8 }
        if (st === 'burn' && !(playerBuffs.burn?.turns > 0) && !ailmentShieldBlocks(playerBuffs, logs) && !emblemBlocksAilment(eff, 'burn', logs)) playerBuffs.burn = { turns:5, dmgRate:0.02 }
        if (st === 'stun' && !ailmentShieldBlocks(playerBuffs, logs) && !emblemBlocksAilment(eff, 'stun', logs)) playerBuffs.stun = { turns:1 }
      }
      logs.push({ text:`🌫 ${def.name}の状態異常！ 麻痺・やけど・スタンが付与された！`, color:'#aa66ff' })
    }
    if (def.debuff?.mdef) { playerBuffs.mdefDown = { turns:5, rate: Math.max(0.1, 1 + def.debuff.mdef/100) }; logs.push({ text:`🔻 ${def.name}！ 特殊防御力が低下した！`, color:'#88aaff' }) }
    doFollowup()
  }

  // 注記付きの既存バフスキル（狂信A+C2倍10T・強化装填永続1.5倍・影歩き永続クリ威力+50%・氷の障壁10T 等）
  const applyAnnotatedBuff = (def) => {
    if (def.permanent) {
      if (def.effectMult)     enPerm.atkMult  *= def.effectMult
      if (def.critDmgPlus)    enPerm.critDmgPlus += def.critDmgPlus
      if (def.buff?.atkMult)  enPerm.atkMult  *= def.buff.atkMult
      if (def.buff?.matkMult) enPerm.matkMult *= def.buff.matkMult
      if (def.buff?.spdMult)  enPerm.spdMult  *= def.buff.spdMult
    } else {
      const dur = def.duration || 4
      if (def.buff?.atkMult)  enemyBuffs.atkUp  = { turns:dur, rate:def.buff.atkMult }
      if (def.buff?.matkMult) enemyBuffs.matkUp = { turns:dur, rate:def.buff.matkMult }
      if (def.buff?.spdMult)  enemyBuffs.spdUp  = { turns:dur, rate:def.buff.spdMult }
      if (def.name === '氷の障壁') enemyBuffs.defUp = { turns:dur, rate:1.5 }
    }
    logs.push({ text:`✦ ${enemy.name}の「${def.name}」！ 力を高めた！`, color:'#ff99dd' })
  }

  const resolveSlot = (def) => {
    if (def.custom) { castCustomSkill(def); return }
    if (def.buff || def.permanent || def.duration) { applyAnnotatedBuff(def); return }
    castExistingSkill(def)
  }

  // 1ターン分の敵行動（kit駆動）。kitが無ければ通常攻撃。
  const doEnemyKitTurn = () => {
    const kit = enemy.kit
    if (!kit) { doEnemyAttack(false); return }
    if (enLockedSkill) { resolveSlot(enLockedSkill); return }
    const hpRate = enemyHp / enemyMaxHp
    // 75%スキル(パッシブ枠)は閾値初回に「自動発動」し、ターンを消費しない（その後そのまま行動する）
    if (!enUsedT75 && hpRate <= 0.75 && kit.trigger75) {
      enUsedT75 = true
      const t75 = (typeof kit.trigger75 === 'string') ? { name: kit.trigger75 } : kit.trigger75
      resolveSlot(t75)
      if (playerHp <= 0 || enemyHp <= 0) return
    }
    // 通常行動（大技15% > 40% > 通常）
    let slot, isSpecial = false
    if (!enUsedSpecial && hpRate <= 0.15)      { slot = kit.special;   enUsedSpecial = true; isSpecial = true }
    else if (!enUsedT40 && hpRate <= 0.40)     { slot = kit.trigger40; enUsedT40 = true }
    else                                       { slot = (hpRate <= 0.60 && kit.normalLow) ? kit.normalLow : kit.normal }
    const def = (typeof slot === 'string') ? { name: slot } : slot
    resolveSlot(def)
    // 大技の「以降このスキルのみ／毎ターン使用」ロック
    if (isSpecial) {
      if (def.persist) enLockedSkill = def
      else if (def.thenOnlySkill) enLockedSkill = { name: def.thenOnlySkill }
    }
  }

  while (playerHp > 0 && enemyHp > 0 && turn <= 50) {
    const hpBeforeTurn = playerHp  // 雷鋼の機神鎧: このターンに被ダメしたか判定用
    if (passiveNames.includes('骸の壁') && (turn === 1 || turn % 4 === 0)) {
      playerBuffs.dmgReduce = { turns:999, rate:0.7, isGainoKabe:true }
      logs.push({ text:`💀 骸の壁発動！ 次に攻撃を受けるまで被ダメ-30%！`, color:'#cc44ff' })
    }
    // 敵への持続ダメージ
    if (enemyBuffs.severePoisoin?.turns > 0) {
      const spDmg = Math.floor(enemyMaxHp * 0.05 * emblemDotMult(eff, 'poison')); enemyHp -= spDmg
      logs.push({ text:`🤢 猛毒ダメージ！ ${enemy.name}に${spDmg}ダメージ！`, color:'#aa44ff' })
      if (enemyHp <= 0) break
    }
    // 召喚（式神／ペット）のターン開始攻撃
    {
      const sEnemy = { def: enemy.def, mdef: enemy.mdef, atk: enemy.atk, matk: enemy.matk, type: enemy.type, name: enemy.name, evasionRate: 0 }
      enemyHp -= summonAttackDamage(summon, sEnemy, enemyBuffs, playerBuffs, eff, rtCur, logs)
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
      const healAmt = Math.floor(playerBuffs.regenHeal.amount * passiveHealMult * (playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1))
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
    // ポーションは出撃のみ適用（奈落では無限・通常とも発動しない）
    const POTIONS_ENABLED = false // 奈落ではポーション無効（意図的に無効化）
    if (POTIONS_ENABLED && !isHealSealed && currentItem) {
      const threshold = currentItem.use_threshold||50
      const effect = currentItem.items.effect
      const isInfinite = effect === 'hp_pct_infinite' || effect === 'mp_pct_infinite'
      const canUse = isInfinite ? false : !itemUsed
      if (canUse) {
        if ((effect==='hp_pct' || effect==='hp_pct_infinite') && playerHp/eff.hp_max*100 <= threshold) {
          const healAmt = Math.floor(eff.hp_max*currentItem.items.value/100)
          playerHp = Math.min(eff.hp_max, playerHp+healAmt)
          logs.push({ text:`🧪 ${currentItem.items.name}を使用！ HPが${healAmt}回復した！`, color:'#44ff88' })
          if (isInfinite) { playerBuffs.potionCooldown = { turns:5 }; logs.push({ text:`⏳ 5ターンのクールダウンが入った！`, color:'#aaaaaa' }) }
          else itemUsed = true
        } else if ((effect==='mp_pct' || effect==='mp_pct_infinite') && playerMp/eff.mp_max*100 <= threshold) {
          const healAmt = Math.floor(eff.mp_max*currentItem.items.value/100)
          playerMp = Math.min(eff.mp_max, playerMp+healAmt)
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
      tenkaiActedThisTurn = false
      doPlayerAttack(false)
      if (enemyHp <= 0) break
      const spiritExtra = !!playerBuffs.guaranteedExtra  // 精霊共鳴の確定追加行動
      if (playerBuffs.guaranteedExtra) playerBuffs.guaranteedExtra = false
      if (!tenkaiActedThisTurn && (spiritExtra || (playerExtraRate > 0 && Math.random()*100 < playerExtraRate))) { doPlayerAttack(true); if (enemyHp <= 0) break }
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
      doEnemyKitTurn()
      if (playerHp <= 0) break
      // 素早さによる追加行動（通常攻撃で表現）
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
    summonEndOfTurn(summon) // ペットの被ダメ軽減ターン減衰
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
    // turns===0 の一時バフ/デバフを掃除（truthy読みで永続するのを防ぐ。Game.jsxと同様）
    Object.keys(playerBuffs).forEach(k => { if (playerBuffs[k]?.turns === 0) delete playerBuffs[k] })
    Object.keys(enemyBuffs).forEach(k  => { if (enemyBuffs[k]?.turns === 0)  delete enemyBuffs[k] })
    // 雷鋼の機神鎧: このターンに被ダメージしたら2ターン素早さ+15%（既存の上位spdUpは上書きしない）
    if (ondmgSpdUp > 1 && playerHp < hpBeforeTurn && !(playerBuffs.spdUp?.turns > 0 && playerBuffs.spdUp.rate >= ondmgSpdUp)) {
      playerBuffs.spdUp = { turns: 2, rate: ondmgSpdUp }
      logs.push({ text:`⚙ 雷鋼の機神鎧が起動！ 2ターンの間 素早さ+${Math.round((ondmgSpdUp - 1) * 100)}%！`, color:'#66ccff' })
    }
    // 哭雨の羽衣: 5ターンごとに状態異常無効バフを再獲得（既にバフがある場合は重複しない）
    if (hasAmagoiShield && turn % 5 === 0 && playerHp > 0 && !(playerBuffs.ailmentShield?.charges > 0)) {
      playerBuffs.ailmentShield = { charges: 1 }
      logs.push({ text:`🛡 哭雨の羽衣の加護！ 状態異常を1回無効化するバフを獲得！`, color:'#66ccff' })
    }
    logs.push({ type:'hp', turn, playerHp:Math.max(0,playerHp), playerMax:eff.hp_max, playerName:profile.username, enemyHp:Math.max(0,enemyHp), enemyMax:enemyMaxHp, enemyName:enemy.name, playerStatus:extractStatuses(playerBuffs), enemyStatus:extractStatuses(enemyBuffs) })
    turn++
  }

  const win = enemyHp <= 0
  const turns = Math.min(turn, 50)  // 撃破にかかったターン数（ランキングのタイブレーク用）
  logs.push(win
    ? { text:`${enemy.name}を ${turns}ターンで倒した！`, color:'#44ff88' }
    : { text:`敗北… また挑もう。`, color:'#ff4444' })
  return { logs, win, turns }
}

export default function Abyss() {
  const scarecrowBlock = useScarecrowBlock()
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
  const [battleFloor, setBattleFloor] = useState(null)  // 戦闘中に挑んでいる階（勝利後にtargetFloorが進んでも表示がズレないよう固定）
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
    // 選択中ペットの本体ステ(100%)＋装備チャームをプレイヤーへ反映（街と同じ。これが無いとペット分が戦闘に乗らない）
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
    // 挑戦用スキルセット（challenge・未設定なら出撃にフォールバック）＋パッシブは全セットから常時反映
    setSkillSets(selectBattleSkillSets(ss, 'challenge'))
    setPlayerItem(pi || null)

    if (prof.ability_title_id) {
      const { data: at } = await supabase.from('titles').select('*').eq('id', prof.ability_title_id).single()
      setAbilityTitle(at || null)
    }
    if (prof.last_action_at) {
      const elapsed = (Date.now() - new Date(prof.last_action_at).getTime()) / 1000
      setRemaining(Math.max(0, ABYSS_CD - elapsed))
    }
    await fetchStatus()
  }

  const fetchStatus = async () => {
    const { data, error } = await supabase.rpc('get_abyss_status')
    if (error) { setStatus({ cleared_floor:0, can_challenge:true, next_floor:1, reset_at:null }); return }
    setStatus(data)
  }

  const handleReset = async () => {
    if (!profile?.is_admin) return
    if (!window.confirm('奈落の進行状況を初期化します（1階から）。よろしいですか？')) return
    const { data, error } = await supabase.rpc('reset_abyss_progress')
    if (error || data?.error) { alert(data?.error || error?.message || 'リセットに失敗しました'); return }
    setScene('lobby'); setBattleLogs([]); setReward(null); setResultMsg(null)
    await fetchStatus()
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
    setBattleFloor(targetFloor)  // 戦う階を固定（勝利後にtargetFloorが進んでも表示を保つ）
    setBattling(true); setScene('battle'); setBattleLogs([]); setReward(null); setResultMsg(null)

    // 何が起きても必ず setBattling(false) に到達させ、「戦闘中...」で固まらないようにする。
    try {
      // 共有CDロック（10秒に1回まで）。並行端末/連打対策。
      const lockTime = new Date(Date.now() - ABYSS_CD * 1000).toISOString()
      const nowIso = new Date().toISOString()
      const { data: locked } = await withTimeout(supabase.from('profiles')
        .update({ last_action_at: nowIso })
        .eq('id', profile.id)
        .lt('last_action_at', lockTime)
        .select('id'))
      if (!locked || locked.length === 0) {
        setScene('lobby')
        const elapsed = (Date.now() - new Date(profile.last_action_at || 0).getTime()) / 1000
        setRemaining(Math.max(1, ABYSS_CD - elapsed))
        return
      }
      setProfile(p => ({ ...p, last_action_at: nowIso }))
      setRemaining(ABYSS_CD)

      const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
      // 読み込み未完了/失敗でstateが空のままだとスキル無し戦闘になるため、空ならDBから取り直す
      let curSets = skillSets
      if (curSets.length === 0) {
        const { data: ss2 } = await withTimeout(supabase.from('skill_sets').select('*, skills(*)').eq('player_id', profile.id).order('slot_order'))
        if (Array.isArray(ss2) && ss2.length) {
          curSets = selectBattleSkillSets(ss2, 'challenge')
          setSkillSets(curSets)
        }
      }
      const { logs, win, turns } = simulateAbyssBattle(eff, equipment, curSets, profile, { ...floorData.enemy }, playerItem, targetFloor)
      setBattleLogs(logs)

      if (win) {
        const { data, error } = await withTimeout(supabase.rpc('claim_abyss_floor', { p_floor: targetFloor, p_turns: turns }))
        if (error || data?.error) {
          setResultMsg((data?.error || error?.message || '報酬の受け取りに失敗しました') + '（SQL未実行の可能性: supabase_abyss.sql を実行してください）')
        } else {
          setReward(data)
          await withTimeout(fetchStatus())
        }
      }
    } catch (e) {
      // 戦闘計算の例外・通信タイムアウトなど。ここで握らないと battling が true のまま固まる。
      console.error('[abyss] handleChallenge failed:', e)
      setResultMsg(e?.message === 'timeout'
        ? '通信がタイムアウトしました。時間をおいて再挑戦してください。'
        : '戦闘処理でエラーが発生しました。再挑戦してください。')
    } finally {
      setBattling(false)
    }
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

  if (scarecrowBlock) return <ScarecrowBlockScreen endsAt={scarecrowBlock.ends_at} />
  if (!profile || !status) {
    return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>
  }

  const e = floorData?.enemy

  return (
    <div style={{ minHeight:'100vh', background:'#0a0612', padding:'12px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'640px', margin:'0 auto' }}>
        {/* ヘッダー */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #3a1f5a', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#0a0612' }}>
          <div style={{ color:'#c08cff', fontSize:'16px', letterSpacing:'3px' }}>🕯 奈落闘技場</div>
          <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #6644aa', color:'#9977cc', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
        </div>

        {scene === 'lobby' && (
          <>
            {/* 進行状況 */}
            <div style={{ border:'1px solid #4a2a6a', background:'#150a22', padding:'12px', marginBottom:'10px' }}>
              <div style={{ color:'#b088dd', fontSize:'12px', lineHeight:'1.9' }}>
                到達: <span style={{ color:'#ffcc66', fontWeight:'bold' }}>{(status.cleared_floor||0) > 0 ? floorLabel(status.cleared_floor) : '地上'}</span> ／ 全{ABYSS_FLOOR_COUNT}階
              </div>
              <div style={{ color:'#7766aa', fontSize:'10px', marginTop:'4px', lineHeight:'1.7' }}>
                地下へ1階ずつ潜っていく。各階を倒すと次の階へ。<span style={{ color:'#b088dd' }}>週内は何度でも挑戦できます。</span><br/>
                敗北しても挑戦回数は減りません（勝つまで何度でも挑戦可）。<br/>
                <span style={{ color:'#cc9944' }}>進行は毎週月曜 朝5時(JST)にリセット</span>され、また1階から挑戦できます（報酬も再獲得）。
              </div>
              {profile?.is_admin && (
                <button onClick={handleReset} style={{ marginTop:'8px', padding:'5px 10px', background:'#1a0a14', border:'1px solid #aa4466', color:'#ff6688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>🔄 進行リセット(管理者)</button>
              )}
            </div>

            {/* 撃破済みの階（グレーアウトで上に積まれる） */}
            {Array.from({ length: status.cleared_floor || 0 }, (_, i) => i + 1).map(f => {
              const fd = getAbyssFloor(f)
              return (
                <div key={f} style={{ border:'1px solid #2a1f3a', background:'#0d0a14', padding:'10px 12px', marginBottom:'8px', display:'flex', justifyContent:'space-between', alignItems:'center', opacity:0.5 }}>
                  <span style={{ color:'#8a7aaa', fontSize:'13px' }}>{floorLabel(f)}　{fd?.name}</span>
                  <span style={{ color:'#55aa77', fontSize:'11px' }}>✓ 撃破済</span>
                </div>
              )
            })}

            {isAllCleared ? (
              <div style={{ border:'1px solid #ffcc44', background:'#1a1400', padding:'24px', textAlign:'center' }}>
                <div style={{ color:'#ffcc44', fontSize:'15px', marginBottom:'8px' }}>👑 全{ABYSS_FLOOR_COUNT}階制覇！</div>
                <div style={{ color:'#ccaa66', fontSize:'11px' }}>奈落の最深部を踏破した。新たな挑戦をお待ちください。</div>
              </div>
            ) : notYetAvailable ? (
              <div style={{ border:'1px solid #6a5a9a', background:'#120c1e', padding:'24px', textAlign:'center' }}>
                <div style={{ color:'#b0a0dd', fontSize:'14px', marginBottom:'8px' }}>🚧 {floorLabel(ABYSS_DEFINED_FLOORS)}まで制覇！</div>
                <div style={{ color:'#9988bb', fontSize:'11px', lineHeight:'1.8' }}>{floorLabel(targetFloor)}以降は現在準備中です。<br/>続きの実装をお待ちください。</div>
              </div>
            ) : !status.can_challenge ? (
              <div style={{ border:'1px solid #aa4466', background:'#1a0a14', padding:'20px', textAlign:'center' }}>
                <div style={{ color:'#ff6688', fontSize:'13px', marginBottom:'8px' }}>🏆 今週は全階制覇！</div>
                <div style={{ color:'#cc7799', fontSize:'11px', lineHeight:'1.8' }}>
                  次回リセット（また1階から）まで: <span style={{ color:'#ffcc66' }}>{fmtCountdown(status.reset_at)}</span><br/>
                  <span style={{ fontSize:'10px', color:'#996688' }}>（毎週月曜 朝5時にリセット・報酬も再獲得）</span>
                </div>
              </div>
            ) : (
              <div style={{ border:'1px solid #6a3a9a', background:'#160c26', padding:'16px' }}>
                <div style={{ color:'#9977cc', fontSize:'10px', marginBottom:'6px' }}>▼ 次の挑戦相手</div>
                <div style={{ marginBottom:'12px' }}>
                  <div style={{ color:'#e0b0ff', fontSize:'16px', fontWeight:'bold', marginBottom:'10px' }}>{floorLabel(targetFloor)}　{e?.name}</div>
                  <div style={{ background:'#0d0618', border:'1px solid #2a1840', padding:'8px 10px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ color:'#7766aa', fontSize:'11px' }}>推奨総合力</span>
                    <span style={{ color:'#ffcc66', fontSize:'15px', fontWeight:'bold' }}>{fmt(floorData.target)}<span style={{ fontSize:'11px', color:'#cc9944' }}> 以上</span></span>
                  </div>
                </div>

                {/* 報酬プレビュー */}
                <div style={{ borderTop:'1px solid #3a2052', paddingTop:'8px', marginBottom:'12px' }}>
                  <div style={{ color:'#9977cc', fontSize:'10px', marginBottom:'4px' }}>勝利報酬</div>
                  <RewardLine reward={floorData.reward} />
                </div>

                <button onClick={handleChallenge} disabled={!canChallenge}
                  style={{ width:'100%', padding:'12px', background: canChallenge ? '#2a1040' : '#140a1c', border:`1px solid ${canChallenge ? '#a060ff' : '#3a2a4a'}`, color: canChallenge ? '#d0a0ff' : '#5a4a6a', cursor: canChallenge ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
                  {remaining > 0 ? `⏳ ${remaining.toFixed(1)}秒` : `⚔ ${floorLabel(targetFloor)}に挑む`}
                </button>
              </div>
            )}
          </>
        )}

        {scene === 'battle' && (() => {
          const bf = battleFloor || targetFloor
          const bEnemy = getAbyssFloor(bf)?.enemy
          return (
          <div style={{ border:'1px solid #6a3a9a', background:'#140a22', padding:'12px' }}>
            <div style={{ color:'#c08cff', fontSize:'13px', marginBottom:'10px' }}>⚔ {floorLabel(bf)}　{bEnemy?.name} 戦</div>
            {battling && <div style={{ color:'#9977aa', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
            <div style={{ marginBottom:'12px', maxHeight:'46vh', overflowY:'auto' }}>
              {battleLogs.map((l,i)=>(<BattleLogLine key={i} l={l} />))}
              <div ref={logsEndRef} />
            </div>

            {reward && (
              <div style={{ border:'1px solid #ffcc44', background:'#1a1400', padding:'12px', marginBottom:'10px' }}>
                <div style={{ color:'#ffcc44', fontSize:'13px', marginBottom:'6px' }}>🎉 {floorLabel(reward.floor)}クリア！ 報酬獲得</div>
                <div style={{ fontSize:'11px', color:'#ffcc66', lineHeight:'1.9' }}>
                  <div>💰 Gold +{fmt(reward.gold)}</div>
                  {reward.stone && <div>💎 {STONE_NAME(reward.stone)} ×{reward.stone_count}</div>}
                  {reward.gem_count > 0 && <div>💍 宝石（{reward.gem_rank}ランク）×{reward.gem_count}</div>}
                  {reward.book && <div>📖 {reward.book} ×1</div>}
                </div>
                <div style={{ color:'#cc9944', fontSize:'10px', marginTop:'6px' }}>{reward.floor >= ABYSS_DEFINED_FLOORS ? '現在実装ぶんはここまで。進行は毎週月曜 朝5時にリセット（また1階から）。' : `次は ${floorLabel(reward.floor + 1)}だ。`}</div>
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
          )
        })()}
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
      <span style={{ marginLeft:'10px' }}>💍 宝石({reward.gem})×{reward.gemCount}</span>
      {reward.book && <span style={{ marginLeft:'10px' }}>📖 匠の秘伝書{reward.book}×1</span>}
    </div>
  )
}
