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
} from './Game'

const POLL_MS = 5000
const BOSS_NAME = '黒龍ヴァルゼノク'
// レイドボスの表示画像（ボス名→画像）。あまざ用は /public/raid-boss-amaza.png を配置
const bossImage = (name) => name === 'あまざ' ? '/amaza.png' : '/varuzenoku.png'
const BOSS_DEF  = 1000
const BOSS_MDEF = 1000
const BOSS_SPD  = 1200

const TIER_INFO = [
  { pct: 10, attacks: 50, tier: 'A', label: '貢献度10%以上 or 出撃50回', gold: 50000, stones: ['B','C','D'], gemCount: 3, gemRank: 'D', scaleCount: '8~10', rareChance: '15%', color: '#ffcc00' },
  { pct:  6, attacks: 20, tier: 'B', label: '貢献度6%以上 or 出撃20回',  gold: 30000, stones: ['C','D','E'], gemCount: 2, gemRank: 'E', scaleCount: '6~8',  rareChance: '8%',  color: '#44aaff' },
  { pct:  3, attacks:  5, tier: 'C', label: '貢献度3%以上 or 出撃5回',   gold: 10000, stones: ['D','E','F'], gemCount: 1, gemRank: 'F', scaleCount: '4~6',  rareChance: '3%',  color: '#44ff88' },
  { pct:  0, attacks:  0, tier: 'D', label: '参加',                       gold:  5000, stones: ['E','F'],    gemCount: 1, gemRank: 'F', scaleCount: '1~3',  rareChance: '0%',  color: '#888888' },
]

function getTier(pct, attackCount = 0) {
  return TIER_INFO.find(t => pct >= t.pct || attackCount >= t.attacks && t.attacks > 0) || TIER_INFO[TIER_INFO.length - 1]
}
function hpColor(r) { return r > 0.5 ? '#44ff88' : r > 0.25 ? '#ffcc00' : '#ff4444' }
function fmt(n) { return Number(n).toLocaleString() }

function jstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
}

function Countdown({ targetIso }) {
  const [left, setLeft] = useState('')
  useEffect(() => {
    const tick = () => {
      const diff = new Date(targetIso) - Date.now()
      if (diff <= 0) { setLeft('まもなく'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setLeft(`${h > 0 ? h + '時間' : ''}${m}分${s}秒`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])
  return <span style={{ color: '#ffcc44' }}>{left}</span>
}

// ボス統計（ターンごとに変化）
function getBossForTurn(t, name = BOSS_NAME) {
  const atkBase = 100 + (t - 1) * 300
  const defBase = 1000 + (t - 1) * 100
  const mult = t >= 8 ? 5.0 : t >= 4 ? 2.0 : 1.0
  return {
    name,
    atk:  Math.floor(atkBase * mult),
    matk: Math.floor(atkBase * mult),
    def:  Math.floor(defBase * mult),
    mdef: Math.floor(defBase * mult),
    spd:  BOSS_SPD,
    type: 'physical',
  }
}

// レイドバトルシミュレーション（最大10ターン）
// レイドの与ダメ圧縮：高火力は頭打ち（伸びを抑える）、低火力は底上げ（通りやすく）。
//  PIVOT以下のダメージは LOW倍、超過分は HIGH倍に圧縮。これで火力差の開きを縮める。
//  ※およそ PIVOT*LOW/(1-HIGH) … 付近で交差（それ未満=底上げ／超過=減少）。数値は調整ポイント。
const RAID_DMG_PIVOT = 700
const RAID_DMG_LOW = 1.5   // 低火力の底上げ倍率（↑強化:弱い人も通りやすく）
const RAID_DMG_HIGH = 0.25 // 高火力の超過分の倍率（↓強化:強い人はより頭打ち）
function compressRaidDmg(d) {
  if (d <= 0) return d
  return Math.max(1, Math.floor(d <= RAID_DMG_PIVOT ? d * RAID_DMG_LOW : RAID_DMG_PIVOT * RAID_DMG_LOW + (d - RAID_DMG_PIVOT) * RAID_DMG_HIGH))
}

function simulateRaidBattle(eff, equipment, skillSets, profile, bossName = BOSS_NAME) {
  const logs = []
  let playerHp = Math.max(1, profile.hp_current ?? profile.hp_max)
  let playerMp = profile.mp_current ?? profile.mp_max
  let totalDamage = 0
  let skillIndex = 0
  let prevSkillName = null
  let playerBuffs = {}
  let playerDied = false

  const equippedWeapon = equipment.find(e => e.slot === 'weapon' && e.equipped)
  const isArtifact = equippedWeapon?.bonus_effect === 'artifact'
  const weaponType = equippedWeapon?.weapons?.weapon_type || 'sword'
  const isMagical = getWeaponGroup(weaponType) === 'magical'

  const passiveNames = skillSets.filter(ss => ss.skills?.type === 'パッシブ').map(ss => ss.skills.name)
  const expandedSkillSet = []
  for (const ss of skillSets) {
    if (ss.skills?.type === 'パッシブ') continue
    const count = ss.use_count || 1
    for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
  }

  const hasShingan    = passiveNames.includes('心眼')
  const hasBerserk    = passiveNames.includes('バーサク')
  const hasKakushin   = passiveNames.includes('執行本能')
  const hasShinkoka   = passiveNames.includes('神聖加護')
  const hasTenki      = passiveNames.includes('天啓')
  const hasRokkan     = passiveNames.includes('第六感')
  const hasSeimitsu   = passiveNames.includes('精密照準')
  const hasTosoHonno  = passiveNames.includes('闘争本能')
  const hasTakaNoMe   = passiveNames.includes('鷹ノ目')
  const hasGensoKyomei = passiveNames.includes('元素共鳴')
  const hasGambleBody = passiveNames.includes('ギャンブルボディ')
  const hasOnmi       = passiveNames.includes('隠身')
  const hasMadokenJutsu = passiveNames.includes('魔導剣術')
  const hasHolyKnightPassive = passiveNames.includes('聖騎士の心得')
  const hasGainoKabe  = passiveNames.includes('骸の壁')

  // 再修練3段でパッシブ強化（現在クラス一致＆再修練3回以上＆そのパッシブをセット中）
  const rtCur = (profile.retraining || {})[profile.class] || 0
  const pe = (cls) => profile.class === cls && rtCur >= 3

  const passiveCritBonus  = hasShingan ? 5 : 0
  const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.2 : 0
  const passiveDmgMult    = (hasShingan ? (pe('侍')?1.10:1.05) : 1.0) * (hasBerserk ? (pe('狂戦士')?1.20:1.15) : 1.0) * (hasKakushin ? (pe('異端審問官')?1.15:1.1) : 1.0) * (hasRokkan ? (pe('サイキッカー')?1.10:1.05) : 1.0)
  const passiveHealMult   = (hasShinkoka ? (pe('聖職者')?1.4:1.2) : 1.0) * (hasKakushin ? 0.7 : 1.0)
  const passiveHealReflect = (hasShinkoka && pe('聖職者'))
  const passiveMatkMult   = hasShinkoka ? 1.1 : 1.0
  const passiveMpCostMult = hasTenki ? 0.9 : 1.0
  const passiveMatkMultTenki = hasTenki ? (pe('賢者')?1.3:1.1) : 1.0
  const passiveHitBonus   = (hasRokkan ? 5 : 0) + (hasSeimitsu ? 5 : 0) + ((hasTakaNoMe && pe('狩人')) ? 10 : 0)
  const effectiveSpdForCalc = hasTakaNoMe ? Math.floor(eff.spd * 1.2) : eff.spd

  let   playerCritRate  = calcCritRate(effectiveSpdForCalc, BOSS_SPD) + passiveCritBonus + (eff.critBonus || 0)
  const bossCritRate    = Math.max(0, calcCritRate(BOSS_SPD, effectiveSpdForCalc))
  const playerHitBonus  = (eff.hitBonus || 0) + passiveHitBonus
  let   playerEvasion   = calcEvasionRate(effectiveSpdForCalc, BOSS_SPD) + (eff.evasionBonus || 0)
  let   playerExtraRate = calcExtraActionRate(effectiveSpdForCalc, BOSS_SPD)
  const bossExtraRate   = calcExtraActionRate(BOSS_SPD, effectiveSpdForCalc)

  // ボス差別化：あまざ=物理被ダメ+10%/特殊-10%、ヴァルゼノク=その逆
  const isAmaza = bossName === 'あまざ'
  const weakMult = (isPhysical) => isAmaza ? (isPhysical ? 1.1 : 0.9) : (isPhysical ? 0.9 : 1.1)

  playerBuffs = applyEquipmentEffects(equipment, profile, playerBuffs, logs)

  logs.push({ text: `⚠ ${bossName}が現れた！`, color: '#ff4444' })

  for (let turn = 1; turn <= 10; turn++) {
    // 骸の壁：ターン1と5の倍数で被ダメ-30%バリア
    if (hasGainoKabe && (turn === 1 || turn % 5 === 0)) {
      playerBuffs.dmgReduce = { turns: 999, rate: 0.7, isGainoKabe: true }
      logs.push({ text: `💀 骸の壁発動！ 次に攻撃を受けるまで被ダメ-30%！`, color: '#cc44ff' })
    }
    // バフ段階のアナウンス
    if (turn === 4) logs.push({ text: `━━ ${bossName}が覚醒した！全ステータス2倍！ ━━`, color: '#ff8844' })
    if (turn === 8) logs.push({ text: `━━ ${bossName}が暴走状態に！全ステータス5倍！ ━━`, color: '#ff2222' })

    // ターン10: 滅びの一撃（強制終了）
    if (turn === 10) {
      const t10name = isAmaza ? '水禍創世' : '滅びの咆哮'
      logs.push({ text: `${turn}ターン目: ${bossName}の「${t10name}」！`, color: '#ff0000' })
      logs.push({ text: `999,999の壊滅ダメージ！（なんとか生き延びた…HP→1）`, color: '#ff4444' })
      break
    }

    const boss = getBossForTurn(turn, bossName)
    const enemyBuffs = {} // ボスはデバフ無効なので常に空

    // ========== プレイヤー攻撃 ==========
    const doPlayerAttack = (isExtra = false) => {
      const madokenBonus = hasMadokenJutsu ? Math.floor(eff.matk * (pe('魔法剣士')?0.6:0.3)) : 0
      const holyKnightMult = hasHolyKnightPassive ? (pe('聖騎士')?1.3:1.2) : 1.0
      const kabeDefP = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 1.2 : 1.0
      const pAtk  = (eff.atk + madokenBonus) * (playerBuffs.atkUp?.rate  || 1) * (playerBuffs.atkDown?.rate || 1) * (playerBuffs.burn?.turns > 0 ? 0.9 : 1)
      const pMatk = (eff.matk - madokenBonus) * (playerBuffs.matkUp?.rate || 1) * passiveMatkMult * passiveMatkMultTenki * (playerBuffs.burn?.turns > 0 ? 0.9 : 1)
      const pDef  = eff.def  * (playerBuffs.defUp?.rate  || 1) * holyKnightMult * kabeDefP
      const pMdef = eff.mdef * (playerBuffs.mdefUp?.rate || 1) * (playerBuffs.defUp?.rate || 1) * holyKnightMult * kabeDefP
      const pSpd  = effectiveSpdForCalc * (playerBuffs.spdUp?.rate || 1) * (playerBuffs.paralysis?.turns > 0 ? (playerBuffs.paralysis.spdRate || 0.8) : 1)
      const effBuff = { ...eff, atk: pAtk, def: pDef, mdef: pMdef, matk: pMatk, spd: pSpd }

      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
      const isCrit = Math.random() * 100 < playerCritRate
      const critMult = isCrit ? (1.5 + (eff.critDmg || 0) + passiveCritDmgBonus) : 1.0

      // 狂乱: 指定スキルに固定
      if (playerBuffs.berserk?.turns > 0 && playerBuffs.berserk.lockedSkill) {
        const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
        if (lockedIdx >= 0) skillIndex = lockedIdx
      }
      let skillUsed = false, mpShort = false
      if (expandedSkillSet.length > 0) {
        const cs = expandedSkillSet[skillIndex % expandedSkillSet.length]
        let mpCost = Math.floor((isArtifact ? (cs?.skills?.mp_cost || 0) * 2 : (cs?.skills?.mp_cost || 0)) * passiveMpCostMult)
        if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(playerMp * 0.1))
        if (cs && cs.skills && playerMp >= mpCost) {
          playerMp -= mpCost
          const gensoMult = (hasGensoKyomei && prevSkillName && prevSkillName !== cs.skills.name) ? (pe('元素使い')?1.25:1.15) : 1.0
          const seimitsuMult = (hasSeimitsu && pe('魔銃士') && prevSkillName && prevSkillName === cs.skills.name) ? 1.1 : 1.0
          prevSkillName = cs.skills.name
          const res = executeSkill(cs.skills, { ...effBuff, lastMpCost: mpCost }, profile, boss, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
          const finalCrit = res.dmg > 0 && (isCrit || (res.bonusCritRate > 0 && Math.random() * 100 < playerCritRate + res.bonusCritRate))
          const finalCritMult = finalCrit ? (1.5 + (eff.critDmg || 0) + passiveCritDmgBonus) : 1.0
          const tosoMult = (hasTosoHonno && playerHp <= profile.hp_max * 0.5) ? (pe('体術師')?1.25:1.1) : 1.0
          let defScale = 1.0
          if (res.dmg > 0) {
            const sType = cs.skills?.type
            if (cs.skills?.name === 'サイコブラスト' || res.useMinDef) defScale = effBuff.matk / (effBuff.matk + Math.min(BOSS_DEF, BOSS_MDEF))
            else if (sType === '物理攻撃') defScale = effBuff.atk / (effBuff.atk + BOSS_DEF)
            else if (sType === '魔法攻撃') defScale = effBuff.matk / (effBuff.matk + BOSS_MDEF)
          }
          const skillPhysical = !(cs.skills?.type === '魔法攻撃' || cs.skills?.name === 'サイコブラスト' || res.useMinDef)
          let finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * (0.9 + Math.random() * 0.2))
          if (res.dmg > 0) finalDmg = compressRaidDmg(Math.floor(finalDmg * weakMult(skillPhysical))) // 弱点補正→高火力頭打ち・低火力底上げ
          if (res.selfDmg > 0) playerHp = Math.max(1, playerHp - res.selfDmg)
          const isHealBlocked = playerBuffs.healBlock?.turns > 0
          if (!isHealBlocked && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0) {
            const rageCure = Math.floor(finalDmg * playerBuffs.bloodRage.healRate)
            playerHp = Math.min(profile.hp_max, playerHp + rageCure)
            logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
          }
          totalDamage += finalDmg
          if (!isHealBlocked) {
            const healAmt = Math.floor(res.heal * passiveHealMult)
            playerHp = Math.min(profile.hp_max, playerHp + healAmt)
            if (passiveHealReflect && healAmt > 0) {
              const reflectDmg = Math.floor(healAmt * 0.5)
              totalDamage += reflectDmg
              logs.push({ text: `✨ 神聖加護の反射！ ${bossName}に${fmt(reflectDmg)}ダメージ！`, color: '#ffdd44' })
            }
          } else if (res.heal > 0) {
            logs.push({ text: `回復封印中！ 回復効果が無効化された！`, color: '#aa22ff' })
          }
          // ボスにはデバフ・状態異常無効（newEnemyBuffsは捨てる）
          playerBuffs = { ...playerBuffs, ...res.newPlayerBuffs }
          const critText = finalCrit ? ' 💥クリティカル！' : ''
          const resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
          logs.push({ text: `${prefix}${resLog}${critText}`, color: finalCrit ? '#ff4444' : '#88ccff' })
          // 追撃（影歩き/出血消費など）を別ヒットとして適用：メインとは独立したダメージ判定
          if (res.followup && res.followup.dmg > 0) {
            const fCrit = Math.random() * 100 < (playerCritRate + (res.bonusCritRate || 0))
            const fCritMult = fCrit ? (1.5 + (eff.critDmg || 0) + passiveCritDmgBonus) : 1.0
            let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * (0.9 + Math.random() * 0.2))
            fDmg = compressRaidDmg(Math.max(1, Math.floor(fDmg * weakMult(skillPhysical))))
            totalDamage += fDmg
            logs.push({ text: `↳ 追撃！${res.followup.label ? `（${res.followup.label}）` : ''} ${bossName}に${fmt(fDmg)}ダメージ！${fCrit ? ' 💥クリティカル！' : ''}`, color: fCrit ? '#ffaa00' : '#ffaa66' })
          }
          skillUsed = true
          skillIndex++
        } else if (cs && cs.skills) { mpShort = true }
      }
      if (!skillUsed) {
        if (mpShort) logs.push({ text: `💧 MPが足りなくてスキルが使えない！`, color: '#6699ff' })
        const baseAtk = isMagical ? effBuff.matk : effBuff.atk
        const eDef = isMagical ? BOSS_MDEF : BOSS_DEF
        const baseDmg = Math.max(1, Math.floor(baseAtk * baseAtk / Math.max(1, baseAtk + eDef)) + Math.floor(Math.random() * 4))
        const tosoMult = (hasTosoHonno && playerHp <= profile.hp_max * 0.5) ? (pe('体術師')?1.25:1.1) : 1.0
        let finalDmg = Math.floor(baseDmg * critMult * (isArtifact ? 1.2 : 1.0) * passiveDmgMult * tosoMult * (0.9 + Math.random() * 0.2))
        finalDmg = compressRaidDmg(Math.floor(finalDmg * weakMult(!isMagical))) // 弱点補正→高火力頭打ち・低火力底上げ
        if (!playerBuffs.healBlock?.turns && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0) {
          const rageCure = Math.floor(finalDmg * playerBuffs.bloodRage.healRate)
          playerHp = Math.min(profile.hp_max, playerHp + rageCure)
          logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
        }
        totalDamage += finalDmg
        const critText = isCrit ? ' 💥クリティカル！' : ''
        logs.push({ text: `${prefix}あなたの攻撃！ ${bossName}に${fmt(finalDmg)}ダメージ！${critText}`, color: isCrit ? '#ff4444' : '#ffcc00' })
        if (expandedSkillSet.length > 0) skillIndex++
      }
    }

    // ========== ボス攻撃（HPは変動するが結果をDBに保存しない） ==========
    const doBossAttack = (isExtra = false) => {
      const holyKnightMultE = hasHolyKnightPassive ? (pe('聖騎士')?1.3:1.2) : 1.0
      const kabeDefE = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 1.2 : 1.0
      const pDef  = eff.def  * (playerBuffs.defUp?.rate  || 1) * holyKnightMultE * kabeDefE
      const pMdef = eff.mdef * (playerBuffs.mdefUp?.rate || 1) * (playerBuffs.defUp?.rate || 1) * holyKnightMultE * kabeDefE
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const berserkDmgRate = hasBerserk ? 1.1 : 1.0
      const eAtk = boss.atk
      const defForCalc = Math.max(1, pDef)
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `

      // ターン4: 特殊スキル（倍率1.5）。ボスごとに効果が異なる
      if (turn === 4 && !isExtra) {
        const specialDmg = Math.max(1, Math.floor(eAtk * eAtk / Math.max(1, eAtk + defForCalc) * 1.5 * (0.9 + Math.random() * 0.2)))
        playerHp -= specialDmg
        if (isAmaza) {
          // 深淵の水葬：10ターンの間 素早さ-50%（クリ・回避・追加行動率を半減SPDで再計算）
          playerBuffs.spdDown = { turns: 10, rate: 0.5 }
          const halfSpd = Math.floor(effectiveSpdForCalc * 0.5)
          playerCritRate  = calcCritRate(halfSpd, BOSS_SPD) + passiveCritBonus + (eff.critBonus || 0)
          playerEvasion   = calcEvasionRate(halfSpd, BOSS_SPD) + (eff.evasionBonus || 0)
          playerExtraRate = calcExtraActionRate(halfSpd, BOSS_SPD)
          logs.push({ text: `${prefix}${bossName}の「深淵の水葬」！ ${fmt(specialDmg)}ダメージ！ 10ターンの間 素早さ-50％！`, color: '#2299ff' })
        } else {
          // 暗黒侵食：回復無効を永続化
          playerBuffs.healBlock = { turns: 999 }
          logs.push({ text: `${prefix}${bossName}の「暗黒侵食」！ ${fmt(specialDmg)}ダメージ！ 回復が永続的に封印された！`, color: '#aa22ff' })
        }
        if (playerHp <= 0) { playerHp = 0; logs.push({ text: `力尽きた…（バトル終了）`, color: '#ff4444' }); playerDied = true }
        return
      }

      const isCrit = Math.random() * 100 < bossCritRate
      const baseDmg = Math.max(1, Math.floor(eAtk * eAtk / Math.max(1, eAtk + defForCalc)) + Math.floor(Math.random() * 3))
      // プレイヤー回避
      const evasionRate = playerEvasion + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0)
      if (evasionRate > 0 && Math.random() * 100 < evasionRate) {
        logs.push({ text: `${prefix}${bossName}の攻撃！ しかし回避した！`, color: '#44ff88' })
        return
      }
      const playerDefRankReduction = calcDefReduction(pDef)
      const gambleBodyMult = hasGambleBody ? (0.7 + Math.random() * (pe('ギャンブラー')?0.4:0.6)) : 1.0
      const finalDmg = Math.floor(baseDmg * (isCrit ? 1.5 : 1.0) * dmgReduceRate * berserkDmgRate * (1 - playerDefRankReduction) * gambleBodyMult * (0.9 + Math.random() * 0.2))
      playerHp -= finalDmg
      if (playerBuffs.dmgReduce?.isGainoKabe) playerBuffs.dmgReduce = null
      const critText = isCrit ? ' 💥クリティカル！' : ''
      logs.push({ text: `${prefix}${bossName}の攻撃！ あなたに${fmt(finalDmg)}ダメージ…${critText}`, color: isCrit ? '#ff2200' : '#ff6644' })
      if (playerHp <= 0) {
        playerHp = 0
        logs.push({ text: `力尽きた…（バトル終了）`, color: '#ff4444' })
        playerDied = true
      }
    }

    // SPD差による行動順
    const playerFirst = effectiveSpdForCalc >= BOSS_SPD
    if (playerFirst) {
      doPlayerAttack()
      if (Math.random() * 100 < playerExtraRate) doPlayerAttack(true)
      doBossAttack()
      if (Math.random() * 100 < bossExtraRate) doBossAttack(true)
    } else {
      doBossAttack()
      if (Math.random() * 100 < bossExtraRate) doBossAttack(true)
      doPlayerAttack()
      if (Math.random() * 100 < playerExtraRate) doPlayerAttack(true)
    }

    if (playerDied) break

    // バフターン減算
    const berserkWasActive = playerBuffs.berserk?.turns > 0
    for (const k of Object.keys(playerBuffs)) {
      if (playerBuffs[k]?.turns > 0) playerBuffs[k] = { ...playerBuffs[k], turns: playerBuffs[k].turns - 1 }
    }
    // 狂乱解除時：skillIndexをマッドラッシュの次に進める
    if (berserkWasActive && (playerBuffs.berserk?.turns ?? 0) === 0 && expandedSkillSet.length > 0) {
      const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk?.lockedSkill)
      if (lockedIdx >= 0) skillIndex = lockedIdx + 1
    }
    // リジェネ・遅延ヒール（回復封印中は無効）
    const isHealBlockedTick = playerBuffs.healBlock?.turns > 0
    if (playerBuffs.regenHeal?.turns > 0) {
      if (!isHealBlockedTick) {
        playerHp = Math.min(profile.hp_max, playerHp + playerBuffs.regenHeal.amount)
        logs.push({ text: `💚 リジェネ！ HPが${playerBuffs.regenHeal.amount}回復！`, color: '#44ff88' })
      }
    }
    if (playerBuffs.delayHeal?.triggerTurn === turn) {
      if (!isHealBlockedTick) {
        playerHp = Math.min(profile.hp_max, playerHp + playerBuffs.delayHeal.amount)
        logs.push({ text: `💚 ${playerBuffs.delayHeal.amount}HP回復！`, color: '#44ff88' })
      }
    }
  }

  logs.push({ text: `──────────────────`, color: '#223344' })
  logs.push({ text: `合計 ${fmt(totalDamage)} ダメージを与えた！`, color: '#ffcc44' })

  return { logs, totalDamage, playerDied }
}

export default function RaidBoss() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [skillSets, setSkillSets] = useState([])
  const [boss, setBoss] = useState(undefined)
  const [nextSpawn, setNextSpawn] = useState(null)
  const [nextBossName, setNextBossName] = useState(null)  // 次回出現ボス名（2枠日替わり）
  const [participants, setParticipants] = useState([])
  const [myPart, setMyPart] = useState(null)
  const [scene, setScene] = useState('boss') // 'boss' | 'battle'
  const [battling, setBattling] = useState(false)
  const [battleLogs, setBattleLogs] = useState([])
  const [claiming, setClaiming] = useState(false)
  const [reward, setReward] = useState(null)
  const [claimError, setClaimError] = useState(null)
  const [remaining, setRemaining] = useState(0) // 共有CDの残り秒数
  const pollRef = useRef(null)
  const cdRef = useRef(null)
  const logsEndRef = useRef(null)
  const attackingRef = useRef(false)  // 連打ガード（state更新前の多重発火を防ぐ）

  useEffect(() => {
    init()
    return () => { clearInterval(pollRef.current); clearInterval(cdRef.current) }
  }, [])

  // バトルログの末尾に自動スクロール
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [battleLogs])

  // 共有CDカウントダウン
  useEffect(() => {
    clearInterval(cdRef.current)
    if (remaining > 0) {
      cdRef.current = setInterval(() => {
        setRemaining(prev => {
          if (prev <= 0.2) { clearInterval(cdRef.current); return 0 }
          return prev - 0.2
        })
      }, 200)
    }
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
    setProfile(prof)
    setEquipment(eq || [])
    setProficiency(prof2 || [])
    // レイド用スキルセット（raid）。未設定なら出撃(sortie)にフォールバック
    {
      const all = ss || []
      const raid = all.filter(r => r.set_type === 'raid')
      const sortie = all.filter(r => (r.set_type || 'sortie') === 'sortie')
      // アクティブスキルが1つも無いセットは未設定扱い（パッシブのみだと全部通常攻撃になるため）
      setSkillSets(raid.some(r => r.skills?.type !== 'パッシブ') ? raid : sortie)
    }

    // 共有CD残り計算
    if (prof.last_action_at) {
      const elapsed = (Date.now() - new Date(prof.last_action_at).getTime()) / 1000
      setRemaining(Math.max(0, WAIT_SECONDS - elapsed))
    }

    await fetchBoss(user.id)
    pollRef.current = setInterval(() => fetchBoss(user.id), POLL_MS)
  }

  const fetchBoss = async (playerId) => {
    const { data } = await supabase.rpc('spawn_raid_boss_if_needed')
    if (!data) return

    setNextSpawn(data.next_spawn || null)
    setNextBossName(data.next_boss_name || null)

    if (data.status === 'waiting') {
      setBoss(false)
      return
    }

    setBoss(data)

    if (data.id) {
      const { data: parts } = await supabase
        .from('raid_participants')
        .select('player_id, damage_dealt, attack_count, last_attack_at, reward_claimed, profiles(username)')
        .eq('raid_id', data.id)
        .order('damage_dealt', { ascending: false })

      setParticipants(parts || [])
      setMyPart((parts || []).find(p => p.player_id === playerId) || null)
    }
  }

  // 【開発】管理者がテスト用にボスを即出現/終了（is_devフラグ・一般プレイヤーには見えない）
  const devSpawn = async (name) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.rpc('spawn_raid_boss_dev', { p_boss_name: name })
    if (error) { alert('開発スポーン失敗: ' + error.message); return }
    await fetchBoss(user.id)
    setScene('boss')
  }
  const devEnd = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.rpc('end_raid_boss_dev')
    if (error) { alert('終了失敗: ' + error.message); return }
    await fetchBoss(user.id)
  }

  const handleAttack = async () => {
    if (!boss || !profile || remaining > 0 || battling) return
    if (attackingRef.current) return  // 連打ガード（state更新前の多重クリックを同期的に弾く）
    attackingRef.current = true
    try {
      setBattling(true)
      setBattleLogs([])
      setScene('battle')

      const eff = calcEffectiveStats(profile, equipment, proficiency)
      // 読み込み未完了/失敗でstateが空のままだとスキル無し戦闘になるため、空ならDBから取り直す
      let curSets = skillSets
      if (curSets.length === 0) {
        const { data: ss2 } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', profile.id).order('slot_order')
        if (Array.isArray(ss2) && ss2.length) {
          const raid2 = ss2.filter(r => r.set_type === 'raid')
          const sortie2 = ss2.filter(r => (r.set_type || 'sortie') === 'sortie')
          curSets = raid2.some(r => r.skills?.type !== 'パッシブ') ? raid2 : sortie2
          setSkillSets(curSets)
        }
      }
      const { logs, totalDamage } = simulateRaidBattle(eff, equipment, curSets, profile, boss?.boss_name || BOSS_NAME)

      // サーバーが権威。RPCを先に確定させ、成功した時だけ戦闘ログを表示する
      // （cooldownで弾かれたのに戦闘ログが出て「0秒で出撃できた」ように見えるのを防ぐ）
      const { data, error } = await supabase.rpc('attack_raid_boss', {
        p_raid_id: boss.id,
        p_damage: totalDamage,
      })

      if (error || data?.error) {
        if (data?.error === 'cooldown') {
          // サーバーのCD残りに同期（クライアントのremainingがズレていた場合の是正）
          const left = Number(data.seconds_left) || WAIT_SECONDS
          setRemaining(left)
          setBattleLogs([{ text: `⏳ クールダウン中です。あと${Math.max(1, Math.ceil(left))}秒お待ちください。`, color: '#ffcc44' }])
        } else {
          setBattleLogs([{ text: data?.error || error?.message || 'エラーが発生しました', color: '#ff4444' }])
        }
      } else {
        setBattleLogs(logs)
        setBoss(prev => ({ ...prev, hp_current: data.hp_current, status: data.status }))
        setRemaining(WAIT_SECONDS)
        // HP/MP全回復 + 出撃EXP はサーバ側(attack_raid_boss)で付与済み（かかし修練中はEXPなし）
        const newExp = data.exp ?? ((profile.exp || 0) + 10)
        setProfile(prev => ({ ...prev, hp_current: eff.hp_max, mp_current: eff.mp_max, exp: newExp }))
        if (data.exp_gained === 0) {
          setBattleLogs(prev => [...prev, { text: '🌾 かかし修練中のため出撃報酬のEXPはもらえません', color: '#ffcc44' }])
        } else {
          setBattleLogs(prev => [...prev, { text: 'EXP +10（出撃報酬）', color: '#44ff88' }])
        }
        await fetchBoss(profile.id)
      }
    } finally {
      setBattling(false)
      attackingRef.current = false
    }
  }

  const handleClaim = async () => {
    if (!boss || !myPart || myPart.reward_claimed || claiming) return
    setClaiming(true)
    setClaimError(null)
    const { data, error } = await supabase.rpc('claim_raid_rewards', { p_raid_id: boss.id })
    if (error || data?.error) {
      setClaimError(data?.error || 'エラーが発生しました')
    } else {
      setReward(data)
      await fetchBoss(profile.id)
    }
    setClaiming(false)
  }

  const totalEff = participants.reduce((s, p) => s + Number(p.damage_dealt) + Number(p.attack_count || 0) * 500, 0) || 1
  const myEff = myPart ? Number(myPart.damage_dealt) + Number(myPart.attack_count || 0) * 500 : 0
  const myContribPct = myEff / totalEff * 100
  const myTier = getTier(myContribPct, Number(myPart?.attack_count || 0))
  const hpRatio = boss ? boss.hp_current / boss.hp_max : 0
  const canAct = remaining <= 0

  const jst = jstNow()
  // 各枠（21:00 / 22:00）の30分前から予告（20:30〜 と 21:30〜）
  const isPreSpawn = boss === false && ((jst.getHours() === 20 && jst.getMinutes() >= 30) || (jst.getHours() === 21 && jst.getMinutes() >= 30))
  const getPreSpawnTarget = () => {
    if (nextSpawn) return nextSpawn
    const t = jstNow(); t.setHours(21, 0, 0, 0)
    return t.toISOString()
  }
  const previewName = nextBossName || BOSS_NAME

  const base = { minHeight: '100vh', background: '#000820', color: '#aaccff', fontFamily: 'monospace', padding: '16px', boxSizing: 'border-box' }

  if (boss === undefined) {
    return <div style={{ ...base, textAlign: 'center', paddingTop: '40vh', color: '#0088ff' }}>読み込み中...</div>
  }

  return (
    <div style={base}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>
        <div style={{ color:'#ff4444', fontSize:'14px', marginBottom:'16px' }}>⚔ レイドボス</div>

      {/* 【開発】管理者専用テストパネル */}
      {profile?.is_admin && (
        <div style={{ border:'1px solid #3a2a6a', background:'#0a0820', padding:'10px', marginBottom:'12px' }}>
          <div style={{ color:'#a890ff', fontSize:'11px', marginBottom:'6px' }}>🔧 開発テスト（管理者のみ・一般には非表示）</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
            <button onClick={() => devSpawn('あまざ')} style={{ padding:'5px 10px', background:'#1a0e2a', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>あまざを今出現</button>
            <button onClick={() => devSpawn('黒龍ヴァルゼノク')} style={{ padding:'5px 10px', background:'#1a0e2a', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>ヴァルゼノクを今出現</button>
            <button onClick={devEnd} style={{ padding:'5px 10px', background:'#1a0a0a', border:'1px solid #aa4444', color:'#ff8888', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>テストボス終了</button>
          </div>
        </div>
      )}

      {/* スポーン待ち */}
      {boss === false && (
        <div>
          {isPreSpawn ? (
            <div style={{ border: '1px solid #440000', background: '#0a0010', padding: '16px', marginBottom: '16px', textAlign: 'center' }}>
              <div style={{ color: '#ffcc44', fontSize: '13px', marginBottom: '8px' }}>⚠ まもなくレイドボスが出現します！</div>
              <div style={{ fontSize: '22px', fontWeight: 'bold' }}><Countdown targetIso={getPreSpawnTarget()} /></div>
            </div>
          ) : (
            <div style={{ border: '1px solid #002244', background: '#000e20', padding: '12px', marginBottom: '16px' }}>
              <div style={{ color: '#446688', fontSize: '12px', marginBottom: '4px' }}>現在レイドボスは出現していません</div>
              <div style={{ color: '#556677', fontSize: '11px' }}>次の出現{nextBossName ? `（${nextBossName}）` : ''}: {nextSpawn ? <Countdown targetIso={nextSpawn} /> : '毎日21:00／22:00 JST'}</div>
            </div>
          )}

          {/* 次回出現ボス */}
          <div style={{ border: '1px solid #440000', background: '#0a0010', padding: '14px', marginBottom: '16px' }}>
            <div style={{ color: '#446688', fontSize: '10px', marginBottom: '8px' }}>次回出現ボス</div>
            <img src={bossImage(previewName)} alt={previewName}
              style={{ width: '100%', maxHeight: '180px', objectFit: 'contain', display: 'block', marginBottom: '8px' }}
              onError={e => { e.target.style.display = 'none' }} />
            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
              <div style={{ color: '#ff4444', fontSize: '16px', letterSpacing: '1px' }}>{previewName}</div>
              <div style={{ color: '#446688', fontSize: '10px', marginTop: '2px' }}>毎日21:00／22:00 JST出現（各30分・2体が日替わり交互）/ HP 1,000,000</div>
            </div>
            <div style={{ fontSize: '10px', color: '#335566', lineHeight: '1.8' }}>
              全プレイヤーで協力して討伐！貢献度に応じてリワードが変わります。
            </div>
          </div>

          <RewardTable />
        </div>
      )}

      {/* バトルシーン */}
      {boss && scene === 'battle' && (
        <div>
          {/* コンパクトHPバー */}
          <div style={{ border: '1px solid #440000', background: '#0a0010', padding: '12px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#446688', marginBottom: '4px' }}>
              <span style={{ color: '#ff4444' }}>{boss.boss_name || BOSS_NAME}</span>
              <span>{fmt(boss.hp_current)} / {fmt(boss.hp_max)}</span>
            </div>
            <div style={{ height: '8px', background: '#111122', border: '1px solid #223344', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${hpRatio * 100}%`, background: hpColor(hpRatio), transition: 'width 0.4s ease' }} />
            </div>
          </div>

          {/* バトルログ */}
          <div style={{ border: '1px solid #112233', background: '#000515', padding: '12px', marginBottom: '16px', minHeight: '200px', maxHeight: '420px', overflowY: 'auto' }}>
            {battling && battleLogs.length === 0 && (
              <div style={{ color: '#446688', fontSize: '12px' }}>バトル開始中...</div>
            )}
            {battleLogs.map((l, i) => (
              <div key={i} style={{ color: l.color, fontSize: '12px', lineHeight: '1.8' }}>{l.text}</div>
            ))}
            <div ref={logsEndRef} />
          </div>

          {/* 戻るボタン（バトル終了後） */}
          {!battling && (
            <button
              onClick={() => setScene('boss')}
              style={{ width: '100%', padding: '12px', background: '#001020', border: '1px solid #0088ff', color: '#0088ff', cursor: 'pointer', fontFamily: 'monospace', fontSize: '13px' }}
            >
              ← 戻る
            </button>
          )}
        </div>
      )}

      {/* ボスメイン画面 */}
      {boss && scene === 'boss' && (
        <div>

          {/* ボスカード */}
          <div style={{ border: `1px solid ${boss.status === 'active' ? '#660000' : '#446600'}`, background: '#0a0010', padding: '20px', marginBottom: '16px' }}>
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <img src={bossImage(boss.boss_name)} alt={boss.boss_name || BOSS_NAME}
                style={{ width: '100%', maxHeight: '200px', objectFit: 'contain', display: 'block' }}
                onError={e => { e.target.style.display = 'none' }} />
              <div style={{ color: '#ff4444', fontSize: '16px', letterSpacing: '2px', marginTop: '8px' }}>
                {boss.boss_name || BOSS_NAME}{boss.is_dev && <span style={{ color: '#8a60ff', fontSize: '10px', marginLeft: '6px' }}>[開発テスト]</span>}
              </div>
            </div>
            {boss.status === 'active' && boss.spawned_at && (() => {
              const expireAt = new Date(new Date(boss.spawned_at).getTime() + 30 * 60 * 1000)
              return (
                <div style={{ color: '#ffcc44', fontSize: '11px', marginBottom: '8px' }}>
                  ⏱ 残り時間: <Countdown targetIso={expireAt.toISOString()} />
                </div>
              )
            })()}
            {boss.status === 'defeated' && (
              <div style={{ color: '#44ff44', fontSize: '12px', marginBottom: '8px' }}>
                ✓ 討伐完了 ({new Date(boss.defeated_at).toLocaleTimeString('ja-JP')})
              </div>
            )}
            {boss.status === 'expired' && (
              <div style={{ color: '#886644', fontSize: '12px', marginBottom: '8px' }}>
                ⌛ 時間切れ（討伐失敗）— その時点までの貢献に応じた報酬を受け取れます
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#446688', marginBottom: '4px' }}>
              <span>HP</span><span>{fmt(boss.hp_current)} / {fmt(boss.hp_max)}</span>
            </div>
            <div style={{ height: '16px', background: '#111122', border: '1px solid #223344', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${hpRatio * 100}%`, background: hpColor(hpRatio), transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: '10px', color: '#335566', textAlign: 'right', marginTop: '4px' }}>
              {participants.length}人参加中 | 総ダメージ: {fmt(participants.reduce((s, p) => s + Number(p.damage_dealt), 0))}
            </div>
          </div>

          {/* 挑戦ボタン・CDバー */}
          {boss.status === 'active' && scene === 'boss' && (
            <div style={{ border: '1px solid #002244', background: '#000e20', padding: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                <span style={{ color: '#446688' }}>次の挑戦まで</span>
                <span style={{ color: canAct ? '#44ff88' : '#ffcc00' }}>{canAct ? '▶ 挑戦可能！' : `${remaining.toFixed(1)}秒`}</span>
              </div>
              <div style={{ background: '#001028', height: '6px', border: '1px solid #002244', marginBottom: '12px' }}>
                <div style={{ height: '100%', width: `${((WAIT_SECONDS - remaining) / WAIT_SECONDS) * 100}%`, background: canAct ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition: 'width 0.2s' }} />
              </div>
              <button
                onClick={handleAttack}
                disabled={!canAct || battling}
                style={{
                  width: '100%', padding: '14px',
                  background: canAct ? '#1a0000' : '#001020',
                  border: `1px solid ${canAct ? '#ff4444' : '#003366'}`,
                  color: canAct ? '#ff6666' : '#446688',
                  cursor: canAct ? 'pointer' : 'not-allowed',
                  fontFamily: 'monospace', fontSize: '14px', letterSpacing: '2px',
                }}
              >
                {canAct ? `⚔ ${boss?.boss_name || BOSS_NAME}に挑戦する！` : '準備中...'}
              </button>
            </div>
          )}

          {/* リワード受け取り */}
          {(boss.status === 'defeated' || boss.status === 'expired') && myPart && (
            <div style={{ border: '1px solid #224422', background: '#001a00', padding: '16px', marginBottom: '16px' }}>
              <div style={{ color: '#44ff88', fontSize: '13px', marginBottom: '12px' }}>🎁 リワード</div>
              {reward ? (
                <div style={{ fontSize: '12px', lineHeight: '2.2' }}>
                  <div style={{ color: '#ffcc44' }}>{reward.tier}ティア　貢献度: {reward.contribution_pct}%</div>
                  <div style={{ color: '#ffcc00' }}>Gold: +{fmt(reward.gold)}</div>
                  <div style={{ color: '#6699cc' }}>
                    {(reward.stones || []).map(s => `強化石(${s})×3`).join('　')}
                  </div>
                  <div style={{ color: '#ff66cc' }}>宝石({reward.gem_rank}) × {reward.gem_count}個（ランダム種類）</div>
                  <div style={{ color: '#cc8844' }}>黒龍の鱗 × {reward.scale_count}個</div>
                  {reward.got_gyaku && <div style={{ color: '#ffcc00' }}>⭐ 黒龍の逆鱗 × 1個（レアドロップ！）</div>}
                  <div style={{ color: '#44ff88', marginTop: '4px' }}>✓ 受け取り完了！</div>
                </div>
              ) : myPart.reward_claimed ? (
                <div style={{ color: '#446688', fontSize: '12px' }}>✓ 既に受け取り済みです</div>
              ) : (
                <>
                  <div style={{ fontSize: '12px', color: '#aaaaaa', marginBottom: '10px', lineHeight: '1.8' }}>
                    予定リワード: {myTier.tier}ティア / Gold {fmt(myTier.gold)} / 強化石{myTier.stones.map(s=>`(${s})`).join('・')}×3 / 宝石{myTier.gemRank}×{myTier.gemCount}
                  </div>
                  {claimError && <div style={{ color: '#ff4444', fontSize: '12px', marginBottom: '8px' }}>{claimError}</div>}
                  <button onClick={handleClaim} disabled={claiming}
                    style={{ padding: '8px 24px', background: '#002200', border: '1px solid #44ff88', color: '#44ff88', cursor: 'pointer', fontFamily: 'monospace', fontSize: '13px' }}>
                    {claiming ? '処理中...' : '受け取る'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* 参加者リスト */}
          {participants.length > 0 && (
            <div style={{ border: '1px solid #002244', background: '#000e20', padding: '16px', marginBottom: '16px' }}>
              <div style={{ color: '#446688', fontSize: '12px', marginBottom: '10px' }}>参加者 ({participants.length}人)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ color: '#335566', borderBottom: '1px solid #112233' }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>#</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px' }}>プレイヤー</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px' }}>ダメージ</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px' }}>出撃</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px' }}>貢献</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p, i) => {
                    const eff2 = Number(p.damage_dealt) + Number(p.attack_count || 0) * 500
                    const pct = eff2 / totalEff * 100
                    const tier = getTier(pct, Number(p.attack_count || 0))
                    const isMe = profile && p.player_id === profile.id
                    return (
                      <tr key={p.player_id} style={{ borderBottom: '1px solid #0a1a2a', background: isMe ? '#001122' : 'transparent' }}>
                        <td style={{ padding: '5px 6px', color: i === 0 ? '#ffcc00' : '#335566' }}>{i === 0 ? '👑' : i + 1}</td>
                        <td style={{ padding: '5px 6px', color: isMe ? '#aaddff' : '#778899' }}>{p.profiles?.username || '???'}{isMe ? ' (自分)' : ''}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: '#cc8844' }}>{fmt(p.damage_dealt)}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: '#668866' }}>{p.attack_count || 0}回</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: tier.color }}>{pct.toFixed(1)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <RewardTable />
        </div>
      )}
      </div>
    </div>
  )
}

function RewardTable() {
  return (
    <div style={{ border: '1px solid #112233', background: '#000810', padding: '14px', marginTop: '16px' }}>
      <div style={{ color: '#335566', fontSize: '11px', marginBottom: '8px' }}>討伐報酬</div>
      {TIER_INFO.map(t => (
        <div key={t.pct} style={{ fontSize: '11px', padding: '4px 0', borderBottom: '1px solid #0a1220' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: t.color }}>{t.tier}ティア　{t.label}</span>
            <span style={{ color: '#ffcc00' }}>Gold {fmt(t.gold)}</span>
          </div>
          <div style={{ color: '#446688', marginTop: '2px' }}>
            強化石{t.stones.map(s=>`(${s})`).join('・')}×3　宝石{t.gemRank}×{t.gemCount}　通常素材×{t.scaleCount}{t.tier !== 'D' ? `　レア素材${t.rareChance}` : ''}
          </div>
        </div>
      ))}
      <div style={{ color: '#334455', fontSize: '10px', marginTop: '6px' }}>※ 出撃回数でもティア保証: 5回→C / 20回→B / 50回→A。時間切れでもその時点の報酬を獲得可</div>
    </div>
  )
}
