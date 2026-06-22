// ============================================================
// 対人戦（PvP）戦闘シミュレーション
// ------------------------------------------------------------
// 既存PvE戦闘エンジン（Game.jsx の executeSkill 等）を、両プレイヤーへ
// 対称適用したもの。Tenkyuu/Abyss の doPlayerAttack を一般化し、
// 「攻撃側(att)」「防御側(def)」のどちらもフルスキルで殴り合う。
//
// PvP固有ルール（要件）:
//  ・与ダメージ軽減は「攻撃力側」で行う。防御との突き合わせ(defScale=atk/(atk+def))に
//    使う攻撃値を ratioAtkMult 倍に縮小し、防御(def/mdef)のレバレッジを大きくする。
//    さらに最終倍率 dmgMult で全体量を調整。これにより防御特化が効く。
//    ※ executeSkill に渡すステ自体は縮小しない＝**回復(ヒール/吸収)量は満額のまま**。
//  ・回復量は減少なし（×1.0）               … PVP.healMult
//  ・素早さ由来のクリティカル率・回避率は上限2倍（速さ補正ぶんのみ×2）
//  ・素早さが速い方が先攻。HP0で決着。ターン上限到達はHP割合が高い方の勝ち（同率は引分）。
//
// スキルは各自の「出撃」スキルセットを反映（呼び出し側で sortie を渡す）。
// 報酬・永続化は無し（呼び出し側で勝敗のみ一時記録）。
//
// 戻り値: { logs, winner /* 'A' | 'B' | 'draw' */, turns, aHpPct, bHpPct }
// ============================================================
import { getWeaponGroup } from './stats'
import {
  calcEvasionRate,
  calcExtraActionRate,
  calcCritRate,
  calcDefReduction,
  applyEquipmentEffects,
  executeSkill,
  extractStatuses,
  MULTI_HIT_SKILLS,
} from '../pages/Game'

const PVP = {
  ratioAtkMult: 0.25, // defScale で使う攻撃値の縮小率（小さいほど防御が効く＝防御レバレッジ大）
  dmgMult: 0.125,     // 最終ダメージ倍率（全体量の調整つまみ。0.25→0.125で全体ダメージ半減）
  healMult: 1.0,      // 回復量は減少なし
  turnCap: 60,        // ターン上限
}
const CRIT_BASE_RATE = 100 / 24  // calcCritRate の基礎クリ率（速さ補正を除いた素の値）

// 素早さ由来のクリ率を2倍に（基礎ぶんは据え置き、速さ補正ぶんのみ倍化＝実質「上限2倍」）
const pvpCritFromSpd = (spd) => CRIT_BASE_RATE + (calcCritRate(spd) - CRIT_BASE_RATE) * 2
// 素早さ由来の回避率を2倍に（上限2倍）
const pvpEvasionFromSpd = (defSpd, atkSpd) => calcEvasionRate(defSpd, atkSpd) * 2

// 1プレイヤー分の戦闘状態を組み立てる。
//  input: { eff, equipment, skillSets, proficiency, profile, playerItem }
function buildSide(input, key) {
  const { eff, equipment, skillSets, profile } = input
  const equippedWeaponItem = equipment.find(e => e.slot === 'weapon' && e.equipped)
  const weaponType = equippedWeaponItem?.weapons?.weapon_type || 'sword'
  const isMagical = getWeaponGroup(weaponType) === 'magical'
  const isArtifact = equippedWeaponItem?.bonus_effect === 'artifact'

  const passiveNames = skillSets.filter(ss => ss.skills?.type === 'パッシブ').map(ss => ss.skills.name)
  const has = (n) => passiveNames.includes(n)
  const rtCur = (profile.retraining || {})[profile.class] || 0
  const pe = (cls) => profile.class === cls && rtCur >= 3

  const hasShingan   = has('心眼')
  const hasBerserk   = has('バーサク')
  const hasTakaNoMe  = has('鷹ノ目')
  const hasKakushin  = has('執行本能')
  const hasShinkoka  = has('神聖加護')
  const hasTenki     = has('天啓')
  const hasRokkan    = has('第六感')
  const hasSeimitsu  = has('精密照準')
  const hasTosoHonno = has('闘争本能')
  const hasOnmi      = has('隠身')

  const passiveCritBonus    = hasShingan ? 5 : 0
  const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.2 : 0
  const passiveDmgMult      = (hasShingan ? (pe('侍') ? 1.10 : 1.05) : 1.0) * (hasBerserk ? (pe('狂戦士') ? 1.20 : 1.15) : 1.0) * (hasKakushin ? (pe('異端審問官') ? 1.15 : 1.1) : 1.0) * (hasRokkan ? (pe('サイキッカー') ? 1.10 : 1.05) : 1.0)
  const passiveHealMult     = (hasShinkoka ? (pe('聖職者') ? 1.4 : 1.2) : 1.0) * (hasKakushin ? 0.7 : 1.0)
  const passiveMatkMult     = hasShinkoka ? 1.1 : 1.0
  const passiveMpCostMult   = hasTenki ? 0.9 : 1.0
  const passiveMatkMultTenki = hasTenki ? (pe('賢者') ? 1.3 : 1.1) : 1.0
  const passiveHitBonus     = (hasRokkan ? 5 : 0) + (hasSeimitsu ? 5 : 0) + ((hasTakaNoMe && pe('狩人')) ? 10 : 0)
  const passiveHealReflect  = (hasShinkoka && pe('聖職者'))
  const hasMadokenJutsu     = has('魔導剣術')
  const hasHolyKnightPassive = has('聖騎士の心得')

  const expandedSkillSet = []
  for (const ss of skillSets) {
    if (ss.skills?.type === 'パッシブ') continue
    const count = ss.use_count || 1
    for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
  }

  const effectiveSpdForCalc = hasTakaNoMe ? Math.floor(eff.spd * 1.2) : eff.spd
  const ondmgSpdUp = eff.ondmgSpdUp || 0

  return {
    key,
    eff,
    profile,
    equipment,
    isMagical,
    isArtifact,
    equippedWeaponItem,
    effectiveSpdForCalc,
    ondmgSpdUp,
    expandedSkillSet,
    // 状態
    hp: eff.hp_max,
    mp: eff.mp_max,
    buffs: {},
    skillIndex: 0,
    prevSkillName: null,
    prevDmgSkillName: null,
    // パッシブ
    rtCur, pe,
    hasBerserk, hasOnmi, hasMadokenJutsu, hasHolyKnightPassive, hasTosoHonno,
    passiveCritBonus, passiveCritDmgBonus, passiveDmgMult, passiveHealMult,
    passiveMatkMult, passiveMpCostMult, passiveMatkMultTenki, passiveHitBonus, passiveHealReflect,
    // 速さ由来の命中・クリ
    playerHitBonus: (eff.hitBonus || 0) + passiveHitBonus,
    baseCritRate: pvpCritFromSpd(effectiveSpdForCalc) + passiveCritBonus + (eff.critBonus || 0),
  }
}

// 防御側の executeSkill 用「enemy」オブジェクト（参照する項目のみ）
const defenderEnemyObj = (def) => ({
  name: def.profile.username,
  def: def.eff.def,
  mdef: def.eff.mdef,
  isPapia: false,
})

// att が def を攻撃する（PvE doPlayerAttack の対称版）
function doAttack(att, def, isExtra, ctx) {
  const logs = ctx.logs
  const turn = ctx.turn
  const eff = att.eff
  const attBuffs = att.buffs
  const defBuffs = def.buffs
  const profile = att.profile
  const enemyName = def.profile.username
  const enemyObj = defenderEnemyObj(def)

  // ===== 施術ステータス（自分のバフ反映） =====
  const holyFieldDef = attBuffs.holyField?.turns > 0 ? attBuffs.holyField.rate : 1.0
  const holyKnightMult = att.hasHolyKnightPassive ? (att.pe('聖騎士') ? 1.3 : 1.2) : 1.0
  const kabeDefP = (attBuffs.dmgReduce?.isGainoKabe && att.pe('死霊使い')) ? 1.2 : 1.0
  const pDef  = eff.def  * (attBuffs.defUp ? attBuffs.defUp.rate : 1) * holyFieldDef * holyKnightMult * kabeDefP
  const pMdef = eff.mdef * (attBuffs.mdefUp ? attBuffs.mdefUp.rate : 1) * (attBuffs.defUp ? attBuffs.defUp.rate : 1) * holyFieldDef * holyKnightMult * kabeDefP
  const burnDebuffP = attBuffs.burn?.turns > 0 ? 0.9 : 1.0
  const madokenBonus = att.hasMadokenJutsu ? Math.floor(eff.matk * (att.pe('魔法剣士') ? 0.6 : 0.3)) : 0
  const pMatk = (eff.matk - madokenBonus) * (attBuffs.matkUp ? attBuffs.matkUp.rate : 1) * att.passiveMatkMult * att.passiveMatkMultTenki * burnDebuffP
  const pAtk  = (eff.atk + madokenBonus) * (attBuffs.atkUp ? attBuffs.atkUp.rate : 1) * (attBuffs.atkDown ? attBuffs.atkDown.rate : 1) * burnDebuffP
  const paralysisSpdP = attBuffs.paralysis?.turns > 0 ? (attBuffs.paralysis.spdRate || 0.8) : 1.0
  const pSpd = att.effectiveSpdForCalc * (attBuffs.spdUp ? attBuffs.spdUp.rate : 1) * paralysisSpdP
  const effBuff = { ...eff, atk: pAtk, def: pDef, mdef: pMdef, matk: pMatk, spd: pSpd }
  // 防御との突き合わせ(defScale)に使う攻撃値だけを縮小（防御のレバレッジを上げる）。
  // res.dmg / res.heal は満額の effBuff から算出されるので回復量には影響しない。
  const ratioAtk  = pAtk  * PVP.ratioAtkMult
  const ratioMatk = pMatk * PVP.ratioAtkMult

  // 防御側の防御率（バフ＋攻撃側の貫通）
  const eDefRate  = (defBuffs.defDown  ? defBuffs.defDown.rate  : 1) * (defBuffs.defUp  ? defBuffs.defUp.rate  : 1) * (1 - (eff.defPen  || 0))
  const eMdefRate = (defBuffs.mdefDown ? defBuffs.mdefDown.rate : 1) * (defBuffs.mdefUp ? defBuffs.mdefUp.rate : 1) * (1 - (eff.mdefPen || 0))

  const prefix = isExtra ? `${profile.username} の追加攻撃！ ` : `${turn}ターン目: ${profile.username} の`

  // クリティカル率（防御側のクリ抵抗で減算）／回避率
  const critRate = Math.max(0, att.baseCritRate - (def.eff.critResist || 0) - (defBuffs.critResist?.turns > 0 ? (defBuffs.critResist.value || 0) : 0))
  const isCrit = Math.random() * 100 < critRate
  const critMult = isCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0

  // 防御側の回避率
  const defSpdEff = def.effectiveSpdForCalc * (defBuffs.spdUp ? defBuffs.spdUp.rate : 1) * (defBuffs.spdDown ? defBuffs.spdDown.rate : 1)
  const atkSpdEff = pSpd
  const defEvasion = pvpEvasionFromSpd(defSpdEff, atkSpdEff) + (def.eff.evasionBonus || 0) + (defBuffs.evasion?.turns > 0 ? defBuffs.evasion.rate * 100 : 0) + (def.hasOnmi ? 5 : 0)
  const buffHitBonus = attBuffs.hitBonus?.turns > 0 ? attBuffs.hitBonus.value : 0

  // 与ダメージを防御側HPへ適用するヘルパ
  const dealToDef = (amt) => { if (amt > 0) def.hp -= amt }
  // 防御側の被ダメ軽減（ランク軽減＋dmgReduceバフ）。物理/特殊で参照ステ切替
  const defReduceMult = (useMagical) => {
    const rankRed = calcDefReduction(useMagical ? def.eff.mdef : def.eff.def)
    const dr = defBuffs.dmgReduce?.turns > 0 ? defBuffs.dmgReduce.rate : 1.0
    return (1 - rankRed) * dr
  }

  // 次に使うスキルを覗き見（MP不足判定・必中判定）
  const peekIdx = attBuffs.berserk?.turns > 0 && attBuffs.berserk.lockedSkill
    ? att.expandedSkillSet.findIndex(ss => ss.skills?.name === attBuffs.berserk.lockedSkill)
    : (att.skillIndex % (att.expandedSkillSet.length || 1))
  const nextSkill = att.expandedSkillSet.length > 0 ? att.expandedSkillSet[Math.max(0, peekIdx)]?.skills : null
  const nextSkillName = nextSkill?.name || null
  let mpLack = false
  if (nextSkill) {
    let peekMpCost = Math.floor((att.isArtifact ? (nextSkill.mp_cost || 0) * 2 : (nextSkill.mp_cost || 0)) * att.passiveMpCostMult)
    if (nextSkill.name === 'マナボルト') peekMpCost = Math.max(1, Math.floor(att.mp * 0.1))
    mpLack = att.mp < peekMpCost
    if (mpLack) logs.push({ text: `💧 ${profile.username}はMPが足りなくてスキルが使えない！`, color: '#6699ff' })
  }
  const isSureHit = !mpLack && nextSkillName === '絶影狙撃'
  const isSelfSkill = !mpLack && nextSkill && (nextSkill.type === '強化' || nextSkill.type === '回復')
  const isMultiHitSkill = !mpLack && nextSkill && MULTI_HIT_SKILLS.has(nextSkill.name)
  const skillExtraHit = (nextSkillName === '連装銃撃' && profile.class === '魔銃士' && att.rtCur >= 2) ? 10 : 0
  const baseDefEvasion = Math.max(0, defEvasion - att.playerHitBonus - buffHitBonus - skillExtraHit)
  const effectiveDefEvasion = (isSureHit || isSelfSkill || isMultiHitSkill) ? 0 : baseDefEvasion

  // 回避された場合（追撃系はメイン回避でも独立発動）
  if (effectiveDefEvasion > 0 && Math.random() * 100 < effectiveDefEvasion) {
    logs.push({ text: `${prefix}${nextSkillName && !mpLack ? `${nextSkillName}！` : '攻撃！'} しかし${enemyName}に回避された！`, color: '#446688' })
    if (nextSkill && !mpLack) {
      const resPeek = executeSkill(nextSkill, effBuff, profile, enemyObj, defBuffs, attBuffs, att.isArtifact, att.prevSkillName)
      if (resPeek.followup && resPeek.followup.dmg > 0) {
        const adjED = Math.max(1, Math.floor((def.eff.def || 0) * eDefRate))
        const fScale = ratioAtk / (ratioAtk + adjED)
        const fCrit = Math.random() * 100 < critRate
        const fCritMult = fCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0
        const dr = defBuffs.dmgReduce?.turns > 0 ? defBuffs.dmgReduce.rate : 1.0
        let fDmg = Math.floor(resPeek.followup.dmg * fScale * fCritMult * att.passiveDmgMult * dr * (1 - calcDefReduction(def.eff.def)) * PVP.dmgMult * (0.9 + Math.random() * 0.2))
        fDmg = Math.max(1, fDmg)
        dealToDef(fDmg)
        logs.push({ text: `↳ 追撃！${resPeek.followup.label ? `（${resPeek.followup.label}）` : ''} ${enemyName}に${fDmg}ダメージ！${fCrit ? ' 💥クリティカル！' : ''}`, color: fCrit ? '#ffaa00' : '#ffaa66' })
      }
    }
    if (att.expandedSkillSet.length > 0) att.skillIndex++
    return
  }

  // バーサク中はロックされたスキルに固定
  if (attBuffs.berserk?.turns > 0 && attBuffs.berserk.lockedSkill) {
    const lockedIdx = att.expandedSkillSet.findIndex(ss => ss.skills?.name === attBuffs.berserk.lockedSkill)
    if (lockedIdx >= 0) att.skillIndex = lockedIdx
  }

  let skillUsed = false
  if (att.expandedSkillSet.length > 0) {
    const cs = att.expandedSkillSet[att.skillIndex % att.expandedSkillSet.length]
    let mpCost = Math.floor((att.isArtifact ? (cs?.skills?.mp_cost || 0) * 2 : (cs?.skills?.mp_cost || 0)) * att.passiveMpCostMult)
    if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(att.mp * 0.1))
    if (cs?.skills?.name === '天墜竜閃' && attBuffs.tenkaiCharge?.turns > 0) mpCost = 0
    if (cs && cs.skills && att.mp >= mpCost) {
      att.mp -= mpCost
      const hasGensoKyomei = att.expandedSkillSet.some(ss => ss.skills?.name === '元素共鳴') // 安全側（パッシブはexpandedに無いので実質false）
      void hasGensoKyomei
      const gensoMult = 1.0  // 元素共鳴はパッシブ枠のため expanded には入らない。PvEと厳密一致は後日。
      const seimitsuMult = 1.0
      att.prevSkillName = cs.skills.name
      const res = executeSkill(cs.skills, { ...effBuff, lastMpCost: mpCost }, profile, enemyObj, defBuffs, attBuffs, att.isArtifact, att.prevSkillName)
      const finalCrit = res.dmg > 0 && (isCrit || (res.bonusCritRate > 0 && Math.random() * 100 < critRate + res.bonusCritRate))
      const finalCritMult = finalCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0
      const tosoMult = (att.hasTosoHonno && att.hp <= eff.hp_max * 0.5) ? (att.pe('体術師') ? 1.25 : 1.1) : 1.0
      const sType = cs.skills?.type
      let defScale = 1.0
      let useMagicalRank = sType === '魔法攻撃'
      if (res.dmg > 0) {
        const buffPen = attBuffs.mukyoPen?.turns > 0 ? attBuffs.mukyoPen.rate : 0
        const adjED  = Math.max(1, Math.floor((def.eff.def  || 0) * eDefRate  * (1 - Math.min(0.8, (res.defPen || 0) + buffPen))))
        const adjEMD = Math.max(1, Math.floor((def.eff.mdef || 0) * eMdefRate * (1 - (res.mdefPen || 0))))
        if (res.physScaleMatk) {
          // 物理ダメージ（敵DEFで軽減）だが火力参照は特殊攻撃（オオカミ召喚など）
          defScale = ratioMatk / (ratioMatk + adjED); useMagicalRank = false
        } else if (cs.skills?.name === 'サイコブラスト' || res.useMinDef) {
          defScale = ratioMatk / (ratioMatk + Math.min(adjED, adjEMD))
          useMagicalRank = adjEMD <= adjED
        } else if (sType === '物理攻撃') { defScale = ratioAtk / (ratioAtk + adjED); useMagicalRank = false }
        else if (sType === '魔法攻撃') { defScale = ratioMatk / (ratioMatk + adjEMD); useMagicalRank = true }
      }
      const allinDebuffOutMult = attBuffs.allinDebuff?.turns > 0 ? 0.7 : 1.0
      const reduceMult = defReduceMult(useMagicalRank)

      const isMulti = Array.isArray(res.hitDmgs) && res.hitDmgs.length > 0 && res.dmg > 0
      let finalDmg, resLog, multiCritAny = false
      if (isMulti) {
        const hitMult = defScale * att.passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * reduceMult * PVP.dmgMult
        const parts = []
        finalDmg = 0
        for (const hd of res.hitDmgs) {
          if (baseDefEvasion > 0 && Math.random() * 100 < baseDefEvasion) { parts.push('回避された！'); continue }
          const hCrit = Math.random() * 100 < (critRate + (res.bonusCritRate || 0))
          const hMult = hCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0
          const hDmg = Math.max(1, Math.floor(hd * hitMult * hMult * (0.9 + Math.random() * 0.2)))
          if (hCrit) multiCritAny = true
          finalDmg += hDmg
          parts.push(`${hDmg}ダメージ！${hCrit ? '💥' : ''}`)
        }
        resLog = `${res.log.split('！')[0]}！ ${enemyName}に ${parts.join(' ')}`
      } else {
        finalDmg = Math.floor(res.dmg * defScale * finalCritMult * att.passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * reduceMult * PVP.dmgMult * (0.9 + Math.random() * 0.2))
        resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
      }
      if (res.dmg > 0) att.prevDmgSkillName = cs.skills?.name
      if (res.selfDmg > 0) att.hp = Math.max(0, att.hp - res.selfDmg)
      dealToDef(finalDmg)
      if (finalDmg > 0 && att.equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(defBuffs.healDown?.turns > 0)) {
        defBuffs.healDown = { turns: 2, rate: 0.9 }
        logs.push({ text: `🗡 ヴァルブレイカーの効果！ ${enemyName}の回復力が2ターンの間-10%！`, color: '#ff8844' })
      }
      if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(defBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
        defBuffs.paralysis = { turns: 3, skipRate: 0.25, spdRate: 0.8 }
        logs.push({ text: `⚡ 蒼雷の短刃の追撃！ ${enemyName}を麻痺させた！`, color: '#ffe066' })
      }
      const healAmt = attBuffs.healSeal?.turns > 0 ? 0 : Math.floor(res.heal * att.passiveHealMult * PVP.healMult)
      att.hp = Math.min(eff.hp_max, att.hp + healAmt)
      if (att.passiveHealReflect && healAmt > 0) {
        const reflectDmg = Math.floor(healAmt * 0.5)
        dealToDef(reflectDmg)
        logs.push({ text: `✨ 神聖加護の反射！ ${enemyName}に${reflectDmg}ダメージ！`, color: '#ffdd44' })
      }
      // バフ封じ（魔剣開放／オールイン反動）中は付与バフを無効化
      if (attBuffs.spellBladeSealed?.turns > 0) {
        const blocked = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune','holyField','holyAwakening','flashCombo','spellBladeExhaust']
        const had = blocked.some(k => res.newPlayerBuffs[k] !== attBuffs[k] && res.newPlayerBuffs[k] !== undefined)
        for (const k of blocked) { if (res.newPlayerBuffs[k] !== attBuffs[k]) res.newPlayerBuffs[k] = attBuffs[k] }
        if (had) logs.push({ text: `⚔ 魔剣開放の反動中！ バフが効かない！`, color: '#ff4444' })
      }
      if (attBuffs.allinDebuff?.turns > 0) {
        const blocked = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune']
        const had = blocked.some(k => res.newPlayerBuffs[k] !== attBuffs[k] && res.newPlayerBuffs[k] !== undefined)
        for (const k of blocked) { if (res.newPlayerBuffs[k] !== attBuffs[k]) res.newPlayerBuffs[k] = attBuffs[k] }
        if (had) logs.push({ text: `💸 オールインの反動中！ バフが効かない！`, color: '#ff4444' })
      }
      att.buffs = res.newPlayerBuffs; def.buffs = res.newEnemyBuffs
      const critInsert = (finalCrit && !isMulti) ? '💥クリティカル！ ' : ''
      const dmgIdx = resLog.indexOf(enemyName + 'に')
      const logWithCrit = critInsert ? (dmgIdx >= 0 ? resLog.slice(0, dmgIdx) + critInsert + resLog.slice(dmgIdx) : resLog + ' ' + critInsert) : resLog
      logs.push({ text: `${prefix}${logWithCrit}`, color: (finalCrit && !isMulti) || multiCritAny ? '#ffff00' : '#88ccff' })
      // 追撃
      if (res.followup && res.followup.dmg > 0) {
        const fCrit = Math.random() * 100 < (critRate + (res.bonusCritRate || 0))
        const fCritMult = fCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0
        let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * att.passiveDmgMult * tosoMult * allinDebuffOutMult * reduceMult * PVP.dmgMult * (0.9 + Math.random() * 0.2))
        fDmg = Math.max(1, fDmg)
        dealToDef(fDmg)
        logs.push({ text: `↳ 追撃！${res.followup.label ? `（${res.followup.label}）` : ''} ${enemyName}に${fDmg}ダメージ！${fCrit ? ' 💥クリティカル！' : ''}`, color: fCrit ? '#ffaa00' : '#ffaa66' })
      }
      // 血の狂気（回復補正は PVP.healMult）
      if (att.buffs.bloodRage?.turns > 0 && finalDmg > 0 && !(att.buffs.healSeal?.turns > 0)) {
        const rageCure = Math.min(Math.floor(finalDmg * att.buffs.bloodRage.healRate * PVP.healMult), Math.floor(eff.hp_max * 0.2))
        att.hp = Math.min(eff.hp_max, att.hp + rageCure)
        logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
      }
      // 神聖覚醒の追撃
      if (att.buffs.holyAwakening?.turns > 0 && finalDmg > 0) {
        const holyBonusDmg = Math.floor((pDef * att.buffs.holyAwakening.defMult + pMdef * att.buffs.holyAwakening.defMult) * PVP.dmgMult)
        dealToDef(holyBonusDmg)
        logs.push({ text: `✨ 神聖覚醒の追撃！ ${enemyName}に${holyBonusDmg}ダメージ！`, color: '#ffeeaa' })
      }
      skillUsed = true; att.skillIndex++
    }
  }

  // 通常攻撃（スキル不使用時）
  if (!skillUsed) {
    const baseAtk = att.isMagical ? effBuff.matk : effBuff.atk
    const ratioBaseAtk = baseAtk * PVP.ratioAtkMult  // 防御レバレッジ用に縮小（スキルと同方針）
    const eDefVal = att.isMagical ? Math.max(1, Math.floor((def.eff.mdef || 0) * eMdefRate)) : Math.max(1, Math.floor(def.eff.def * eDefRate))
    const baseDmg = Math.max(1, Math.floor(baseAtk * ratioBaseAtk / Math.max(1, ratioBaseAtk + eDefVal)) + Math.floor(Math.random() * 4))
    const reduceMult = defReduceMult(att.isMagical)
    const finalDmg = Math.floor(baseDmg * 0.7 * critMult * (att.isArtifact ? 1.2 : 1.0) * att.passiveDmgMult * reduceMult * PVP.dmgMult * (0.9 + Math.random() * 0.2))
    dealToDef(finalDmg)
    const critText = isCrit ? '💥クリティカル！ ' : ''
    logs.push({ text: `${prefix}${critText}攻撃！ ${enemyName}に${finalDmg}ダメージ！`, color: '#ffcc00' })
    if (att.buffs.bloodRage?.turns > 0 && finalDmg > 0 && !(att.buffs.healSeal?.turns > 0)) {
      const rageCure = Math.min(Math.floor(finalDmg * att.buffs.bloodRage.healRate * PVP.healMult), Math.floor(eff.hp_max * 0.2))
      att.hp = Math.min(eff.hp_max, att.hp + rageCure)
      logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
    }
    if (att.expandedSkillSet.length > 0) att.skillIndex++
  }
}

// ターン開始時の持続効果（毒/やけど/出血/呪/骸骨/リジェネ/リジェネ回復/遅延回復）
// side 自身のDoT/回復を処理し、skeletonDmg は opp へ。死亡時 true を返す。
function applyTurnStart(side, opp, ctx) {
  const logs = ctx.logs
  const name = side.profile.username
  const maxHp = side.eff.hp_max
  const b = side.buffs

  if (b.severePoisoin?.turns > 0) {
    const d = Math.floor(maxHp * 0.05); side.hp = Math.max(0, side.hp - d)
    logs.push({ text: `🤢 猛毒ダメージ！ ${name}に${d}ダメージ！`, color: '#aa44ff' })
    if (side.hp <= 0) return true
  }
  if (b.burn?.turns > 0) {
    const d = Math.floor(maxHp * 0.02); side.hp = Math.max(0, side.hp - d)
    logs.push({ text: `🔥 やけどダメージ！ ${name}に${d}ダメージ！`, color: '#ff6622' })
    if (side.hp <= 0) return true
  }
  if (b.poison?.turns > 0) {
    const d = Math.floor(maxHp * b.poison.dmgRate); side.hp = Math.max(0, side.hp - d)
    logs.push({ text: `☠ 毒ダメージ！ ${name}に${d}ダメージ！`, color: '#44ff44' })
    if (side.hp <= 0) return true
  }
  if (b.curseDmg?.turns > 0) {
    side.hp = Math.max(0, side.hp - b.curseDmg.dmg)
    logs.push({ text: `💀 呪縛ダメージ！ ${name}に${b.curseDmg.dmg}ダメージ！`, color: '#cc44ff' })
    if (side.hp <= 0) return true
  }
  if (b.bleed) {
    const d = Math.floor(side.hp * 0.01 * b.bleed.stacks); side.hp = Math.max(0, side.hp - d)
    logs.push({ text: `🩸 出血ダメージ！ ${name}に${d}ダメージ（${b.bleed.stacks}スタック）！`, color: '#ff4466' })
    if (side.hp <= 0) return true
    b.bleed.lastTurn = (b.bleed.lastTurn || 0) + 1
    if (b.bleed.lastTurn >= 3) delete b.bleed
  }
  // 骸骨：相手へ持続ダメージ
  if (b.skeletonDmg?.turns > 0) {
    const d = Math.floor(b.skeletonDmg.dmg * PVP.dmgMult)
    opp.hp -= d
    logs.push({ text: `💀 ${name}の骸骨の持続ダメージ！ ${opp.profile.username}に${d}ダメージ！`, color: '#cc44ff' })
    if (opp.hp <= 0) return true
  }
  const sealed = b.healSeal?.turns > 0
  if (sealed) logs.push({ text: `🚫 ${name}は回復封じ中！ 回復効果が無効化された！`, color: '#ff4488' })
  if (b.regen?.turns > 0) {
    const amt = Math.floor(maxHp * b.regen.rate * PVP.healMult)
    side.hp = Math.min(maxHp, side.hp + amt)
    logs.push({ text: `💚 ${name}のリジェネ！ HPが${amt}回復した！`, color: '#44ff88' })
  }
  if (!sealed && b.regenHeal?.turns > 0) {
    const amt = Math.floor(b.regenHeal.amount * side.passiveHealMult * PVP.healMult)
    side.hp = Math.min(maxHp, side.hp + amt)
    logs.push({ text: `💚 ${name}の回復効果でHPが${amt}回復した！`, color: '#44ff88' })
  }
  if (b.regenMp?.turns > 0) {
    const maxMp = side.eff.mp_max
    const amt = Math.floor(maxMp * b.regenMp.rate)
    if (amt > 0 && side.mp < maxMp) {
      side.mp = Math.min(maxMp, side.mp + amt)
      logs.push({ text: `🔵 ${name}の魔力供給でMPが${amt}回復した！`, color: '#4488ff' })
    }
  }
  if (!sealed && b.delayHeal && ctx.turn === b.delayHeal.triggerTurn) {
    const amt = Math.floor(b.delayHeal.amount * PVP.healMult)
    side.hp = Math.min(maxHp, side.hp + amt)
    logs.push({ text: `💚 ${name}の装備効果でHPが${amt}回復した！`, color: '#44ff88' })
  }
  return false
}

// 行動スキップ判定（スタン/麻痺）。スキップ時 true。
function checkSkip(side, ctx) {
  const b = side.buffs
  const name = side.profile.username
  if (b.stun?.turns > 0) {
    ctx.logs.push({ text: `${ctx.turn}ターン目: ${name}はスタンして行動できない！`, color: '#ffaa00' })
    delete b.stun; return true
  }
  if (b.paralysis?.turns > 0 && Math.random() < b.paralysis.skipRate) {
    ctx.logs.push({ text: `${ctx.turn}ターン目: ${name}は麻痺で行動不能！`, color: '#ffaa00' })
    b.paralysis.skipRate *= 0.5; return true
  }
  return false
}

// 1サイドの行動（メイン＋素早さ追加行動）。相手死亡で true。
function takeTurn(att, def, ctx) {
  if (checkSkip(att, ctx)) return false
  doAttack(att, def, false, ctx)
  if (def.hp <= 0) return true
  const extraRate = calcExtraActionRate(
    att.effectiveSpdForCalc * (att.buffs.spdUp ? att.buffs.spdUp.rate : 1),
    def.effectiveSpdForCalc * (def.buffs.spdUp ? def.buffs.spdUp.rate : 1)
  )
  if (extraRate > 0 && Math.random() * 100 < extraRate) {
    doAttack(att, def, true, ctx)
    if (def.hp <= 0) return true
  }
  return false
}

// ターン終了時のバフ更新（PvE と同様の掃除）
function endTurnBuffs(side, ctx, hpBeforeTurn) {
  const b = side.buffs
  const logs = ctx.logs
  const berserkWasActive = b.berserk?.turns > 0
  Object.keys(b).forEach(k => { if (b[k]?.turns > 0) b[k].turns-- })
  if (berserkWasActive && b.berserk?.turns === 0 && side.expandedSkillSet.length > 0) {
    const lockedIdx = side.expandedSkillSet.findIndex(ss => ss.skills?.name === b.berserk.lockedSkill)
    if (lockedIdx >= 0) side.skillIndex = lockedIdx + 1
  }
  if (b.spellBladeExhaust?.turns === 0) {
    const sealT = b.spellBladeExhaust.sealTurns || 4
    delete b.spellBladeExhaust
    b.spellBladeSealed = { turns: sealT }
    logs.push({ text: `⚔ ${side.profile.username}の魔剣開放の反動！ ${sealT}ターンの間バフ不可状態になった！`, color: '#ff4444' })
  }
  if (b.allinActive?.turns === 0) {
    const reactT = b.allinActive.reactTurns || 2
    delete b.allinActive
    delete b.atkUp; delete b.matkUp; delete b.spdUp; delete b.dmgReduce
    b.allinDebuff = { turns: reactT, rate: 0.7 }
    logs.push({ text: `💸 ${side.profile.username}のオールインの効果が切れた！ ${reactT}ターンの間全ステータスが低下し、バフが使えない！`, color: '#ff4444' })
  }
  Object.keys(b).forEach(k => { if (b[k]?.turns === 0) delete b[k] })
  // 雷鋼の機神鎧: 被ダメで2ターン素早さ+5%
  if (side.ondmgSpdUp > 1 && side.hp < hpBeforeTurn && !(b.spdUp?.turns > 0 && b.spdUp.rate >= side.ondmgSpdUp)) {
    b.spdUp = { turns: 2, rate: side.ondmgSpdUp }
    logs.push({ text: `⚙ ${side.profile.username}の雷鋼の機神鎧が起動！ 2ターンの間 素早さ+${Math.round((side.ondmgSpdUp - 1) * 100)}％！`, color: '#66ccff' })
  }
}

// ============================================================
// メイン：対人戦シミュレーション
//  inputA / inputB: { eff, equipment, skillSets, proficiency, profile, playerItem }
//  A = 挑戦者（先攻判定が同速のときAが先攻）
// ============================================================
export function simulatePvpBattle(inputA, inputB) {
  const logs = []
  const A = buildSide(inputA, 'A')
  const B = buildSide(inputB, 'B')

  logs.push({ text: `⚔ 対人戦開始！ ${A.profile.username} vs ${B.profile.username}`, color: '#ffcc66' })
  logs.push({ text: `（与ダメージは防御力で大きく軽減／回復は通常どおり／素早さによるクリ・回避は上限2倍）`, color: '#88aacc' })

  // 開幕の装備効果バフ
  A.buffs = applyEquipmentEffects(A.equipment, { ...A.profile, hp_max: A.eff.hp_max }, A.buffs, logs)
  B.buffs = applyEquipmentEffects(B.equipment, { ...B.profile, hp_max: B.eff.hp_max }, B.buffs, logs)

  const ctx = { logs, turn: 1 }

  while (A.hp > 0 && B.hp > 0 && ctx.turn <= PVP.turnCap) {
    // 先攻＝素早さが速い方（同速なら A）
    const aSpd = A.effectiveSpdForCalc * (A.buffs.spdUp ? A.buffs.spdUp.rate : 1)
    const bSpd = B.effectiveSpdForCalc * (B.buffs.spdUp ? B.buffs.spdUp.rate : 1)
    const order = aSpd >= bSpd ? [A, B] : [B, A]
    const aHpBefore = A.hp, bHpBefore = B.hp

    // ターン開始: 持続効果（先攻側→後攻側）
    let dead = false
    for (const s of order) {
      const opp = s === A ? B : A
      if (applyTurnStart(s, opp, ctx)) { dead = true; break }
    }
    if (dead || A.hp <= 0 || B.hp <= 0) break

    // 行動（先攻→後攻）
    const first = order[0], second = order[1]
    if (takeTurn(first, second, ctx) || second.hp <= 0) break
    if (takeTurn(second, first, ctx) || first.hp <= 0) break

    // ターン終了: バフ更新
    endTurnBuffs(A, ctx, aHpBefore)
    endTurnBuffs(B, ctx, bHpBefore)

    logs.push({
      type: 'hp', turn: ctx.turn,
      playerHp: Math.max(0, A.hp), playerMax: A.eff.hp_max, playerName: A.profile.username,
      enemyHp: Math.max(0, B.hp), enemyMax: B.eff.hp_max, enemyName: B.profile.username,
      playerMp: Math.max(0, A.mp), playerMpMax: A.eff.mp_max,
      enemyMp: Math.max(0, B.mp), enemyMpMax: B.eff.mp_max,
      playerStatus: extractStatuses(A.buffs), enemyStatus: extractStatuses(B.buffs),
    })
    ctx.turn++
  }

  const aHpPct = Math.max(0, A.hp) / A.eff.hp_max
  const bHpPct = Math.max(0, B.hp) / B.eff.hp_max
  let winner
  if (B.hp <= 0 && A.hp > 0) winner = 'A'
  else if (A.hp <= 0 && B.hp > 0) winner = 'B'
  else if (A.hp <= 0 && B.hp <= 0) winner = 'draw'
  else winner = aHpPct > bHpPct ? 'A' : (bHpPct > aHpPct ? 'B' : 'draw')  // ターン上限：HP割合判定

  const turns = Math.min(ctx.turn, PVP.turnCap)
  if (winner === 'A') logs.push({ text: `✦ ${A.profile.username} の勝利！（${turns}ターン）`, color: '#ffcc44' })
  else if (winner === 'B') logs.push({ text: `✦ ${B.profile.username} の勝利！（${turns}ターン）`, color: '#ffcc44' })
  else logs.push({ text: `引き分け…（${turns}ターン）`, color: '#aaaaaa' })

  return { logs, winner, turns, aHpPct, bHpPct }
}
