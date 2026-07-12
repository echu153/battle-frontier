import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { getWeaponGroup } from '../lib/stats'
import { evoOnEvade, evoTakenMult, evoAllSkillsSet, evoAtkMult, evoMatkMult } from '../lib/evoCombat'
import { emblemDmgMult, emblemDrainAmount, emblemBlocksAilment } from '../lib/emblemCombat'
import { petPlayerBonus, charmPlayerBonus } from '../constants/pets'
import { selectBattleSkillSets } from '../lib/loadout'
import { buildSummon, summonAnnounce, summonAttackDamage, summonAbsorbBasic, summonAbsorbSkill, summonEndOfTurn, tryPetCommand, BREEDER_COMMANDS } from '../lib/summon'
import { pushSupported, pushConfigured, getPushStatus, enableRaidPush, disableRaidPush } from '../lib/push'
import {
  WAIT_SECONDS,
  calcEffectiveStats,
  calcEvasionRate,
  calcExtraActionRate,
  calcCritRate,
  calcDefReduction,
  applyEquipmentEffects,
  ailmentShieldBlocks,
  executeSkill,
} from './Game'

const POLL_MS = 5000
// レイド出撃CD。★2026-06-26 全員公開: レイドは10秒固定（10/20モードに関係なく）。
const raidWaitFor = () => 10
const BOSS_NAME = '黒龍ヴァルゼノク'
const BOSS_ZERUGIASU = '雷鋼機神ゼルギアス'
// レイドボスの3体ローテ（21時/22時の2枠を3日周期で全員が回る）
const RAID_BOSS_CYCLE = ['黒龍ヴァルゼノク', '雨摩座', '雷鋼機神ゼルギアス']
// レイドボスの表示画像（ボス名→画像）
const RAID_IMG_VER = '2'  // 画像差し替え時に上げるとキャッシュを無効化
const bossImage = (name) => (name === '雨摩座' ? '/amaza.png' : name === BOSS_ZERUGIASU ? '/zerugiasu.png' : '/varuzenoku.png') + `?v=${RAID_IMG_VER}`
const BOSS_DEF  = 1000
const BOSS_MDEF = 1000
const BOSS_SPD  = 1200

const TIER_INFO = [
  { pct:  7, attacks: 50, tier: 'A', label: '貢献度7%以上 or 出撃50回', gold: 150000, stones: ['B','C','D'], gemCount: 2, gemRank: 'D', scaleCount: '8~10', rareChance: '15%', book: 'Ⅲ', color: '#ffcc00' },
  { pct:  4, attacks: 20, tier: 'B', label: '貢献度4%以上 or 出撃20回',  gold: 90000, stones: ['C','D','E'], gemCount: 2, gemRank: 'E', scaleCount: '6~8',  rareChance: '8%',  book: 'Ⅱ', color: '#44aaff' },
  { pct:  2, attacks:  5, tier: 'C', label: '貢献度2%以上 or 出撃5回',   gold: 30000, stones: ['D','E','F'], gemCount: 2, gemRank: 'F', scaleCount: '4~6',  rareChance: '3%',  book: 'Ⅰ', color: '#44ff88' },
  { pct:  0, attacks:  0, tier: 'D', label: '参加',                       gold: 15000, stones: ['E','F'],    gemCount: 2, gemRank: 'F', scaleCount: '1~3',  rareChance: '0%',  book: null, color: '#888888' },
]

// ★2026-06-20公開: 全プレイヤーの出撃回数ティア保証を A=20 / B=10 / C=5 に（claim_raid_rewards と一致）。
// ★2026-06-26 全員公開: レイド10秒固定で出撃回数が増えるため、出撃回数ティア保証を倍に（A=40/B=20/C=10）。
const PUBLIC_TIER_ATTACKS = { A: 40, B: 20, C: 10 }
const tierAttacks = (t) => (t.attacks > 0 ? (PUBLIC_TIER_ATTACKS[t.tier] ?? t.attacks) : t.attacks)
function getTier(pct, attackCount = 0) {
  return TIER_INFO.find(t => pct >= t.pct || (attackCount >= tierAttacks(t) && t.attacks > 0)) || TIER_INFO[TIER_INFO.length - 1]
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
  const mult = t >= 8 ? 10.0 : t >= 4 ? 2.0 : 1.0
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

// レイドの与ダメ制限は2段構え。
//   仕組みA（累計・サーバー側 attack_raid_boss）：レイド中の累計ダメージが30万に達したら、
//     それ以降の戦闘ダメージは99%カット（×0.01）。
//   仕組みB（1ヒット・クライアント側=この関数）：Aと無関係に、1発が1万を超えたら
//     ダメージ量に応じて段階的に大幅カット（大きいほどカット率UP）。
//     〜1万:カットなし / 1万〜5万:50%カット / 5万〜10万:80%カット / 10万〜:95%カット
function cutRaidHit(d) {
  if (d <= 10000) return d
  let kept = 10000
  kept += (Math.min(d, 50000) - 10000) * 0.5            // 1万〜5万：50%カット
  if (d > 50000)  kept += (Math.min(d, 100000) - 50000) * 0.2  // 5万〜10万：80%カット
  if (d > 100000) kept += (d - 100000) * 0.05           // 10万〜：95%カット
  return Math.floor(kept)
}

// レイドバトルシミュレーション（最大10ターン）
function simulateRaidBattle(eff, equipment, skillSets, profile, bossName = BOSS_NAME) {
  const logs = []
  let playerHp = Math.max(1, profile.hp_current ?? eff.hp_max)
  let playerMp = profile.mp_current ?? eff.mp_max
  let totalDamage = 0
  let skillIndex = 0
  let prevSkillName = null
  let playerBuffs = {}
  let playerDied = false
  let rokkanStacks = 0
  let seimitsuStacks = 0

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
  const allSkillsSet = evoAllSkillsSet(skillSets)  // 深紅の牙輪/魔眼石の真化条件

  const hasIai        = passiveNames.includes('居合の構え') || passiveNames.includes('心眼')  // 居合の構え（旧:心眼）
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

  const passiveCritBonus  = 0  // 精密照準のクリは再修練のスタックへ移行（素のクリ加算なし）
  const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.25 : 0  // 隠身強化：クリ威力+25%
  // 心眼(居合の構え)は物理ダメ専用のため passiveDmgMult からは除外（iaiPhysMult で別管理）
  // 第六感の素の与ダメ強化は廃止（再修練スタックへ移行）
  const passiveDmgMult    = (hasBerserk ? (pe('狂戦士')?1.40:1.15) : 1.0) * (hasKakushin ? (pe('異端審問官')?1.40:1.20) : 1.0) * (eff.weaponDmgMult || 1)
  const passiveHealMult   = (hasShinkoka ? 1.5 : 1.0) * (hasKakushin ? 0.5 : 1.0)  // 神聖加護回復×1.5固定・執行本能回復×0.5固定
  const passiveHealReflect = (hasShinkoka && pe('聖職者'))
  const passiveMatkMult   = hasShinkoka ? 1.1 : 1.0
  const passiveMpCostMult = (hasTenki ? (pe('賢者')?0.5:0.7) : 1.0) * (eff.weaponMpCostMult || 1)  // 天啓：MP消費 通常×0.7／再修練×0.5
  const passiveMatkMultTenki = hasTenki ? (pe('賢者')?1.4:1.2) : 1.0  // 天啓：MATK 通常×1.2／再修練×1.4
  // 精霊共鳴（精霊召喚士・再修練1+）：最大MP+20%（開始MPを引き上げ・出撃と同一挙動）
  if (profile.class === '精霊召喚士' && rtCur >= 1 && passiveNames.includes('精霊共鳴')) {
    const boostedMp = Math.floor(eff.mp_max * 1.2)
    playerMp = Math.min(boostedMp, profile.mp_current ?? boostedMp)
  }
  // 竜鱗の加護（竜騎士パッシブ）：防御×1.2（再修練×1.4）＋被ダメ時30%で軽減（-5%／再修練-20%）
  const hasRyurin  = passiveNames.includes('竜鱗の加護')
  const ryurinMult = hasRyurin ? (pe('竜騎士') ? 1.4 : 1.2) : 1.0
  const ryurinReduce = () => (hasRyurin && Math.random() < 0.3) ? (pe('竜騎士') ? 0.80 : 0.95) : 1.0
  const effectiveSpdForCalc = eff.spd

  // 居合の構え：セット中の通常スキルが全て使用回数1のとき発動（物理ダメージ専用 通常+40%／再修練+70%）
  const iaiSetSkills = skillSets.filter(ss => ss.skills && ss.skills.type !== 'パッシブ')
  const iaiLoadoutOK = iaiSetSkills.length > 0 && iaiSetSkills.every(ss => (ss.use_count ?? 1) === 1)
  const iaiPhysMult   = (hasIai && iaiLoadoutOK) ? (pe('侍')?1.70:1.40) : 1.0
  const takaAtkBonus  = (hasTakaNoMe && pe('狩人')) ? Math.floor((eff.spd||0) * 0.1) : 0  // 鷹ノ目強化：素早さの10%を攻撃に加算
  const madokenAtkMult = (hasMadokenJutsu && pe('魔法剣士')) ? 1.1 : 1.0  // 魔導剣術強化：攻撃力×1.1

  let   playerCritRate  = calcCritRate(effectiveSpdForCalc, BOSS_SPD) + passiveCritBonus + (eff.critBonus || 0)
  const bossCritRate    = Math.max(0, calcCritRate(BOSS_SPD, effectiveSpdForCalc))
  let   playerEvasion   = calcEvasionRate(effectiveSpdForCalc, BOSS_SPD) + (eff.evasionBonus || 0)
  let   playerExtraRate = calcExtraActionRate(effectiveSpdForCalc, BOSS_SPD)
  const bossExtraRate   = calcExtraActionRate(BOSS_SPD, effectiveSpdForCalc)
  // 天墜竜閃を使ったターン（溜め・解放とも）は追加行動を出さない（tenkaiChargeは解放時にクリアされタイミング依存になるため明示フラグで抑止）
  let tenkaiActedThisTurn

  // ボス差別化：物理被ダメ+10%/特殊-10% のボス（雨摩座・ゼルギアス）／ヴァルゼノクは逆
  const isAmaza = bossName === '雨摩座'
  const isZerugiasu = bossName === BOSS_ZERUGIASU
  const physWeakBoss = isAmaza || isZerugiasu
  const weakMult = (isPhysical) => physWeakBoss ? (isPhysical ? 1.1 : 0.9) : (isPhysical ? 0.9 : 1.1)
  // 雷鋼の機神鎧：被ダメージ時に2ターン素早さ+15%（eff.ondmgSpdUp = 倍率1.15／0=効果なし）
  const ondmgSpdUp = eff.ondmgSpdUp || 0
  const hasAmagoiShield = equipment.some(e => e.equipped && e.bonus_effect === 'battle_start_ailment_shield')  // 哭雨の羽衣: 5Tごとに異常無効バフ再付与

  playerBuffs = applyEquipmentEffects(equipment, profile, playerBuffs, logs)

  // 召喚系パッシブ（式神召喚／ペット召喚）。ボスへの与ダメは totalDamage に加算、被狙いで tank
  const summon = buildSummon(profile, passiveNames, profile.activePet)

  logs.push({ text: `⚠ ${bossName}が現れた！`, color: '#ff4444' })
  summonAnnounce(summon, logs)

  for (let turn = 1; turn <= 10; turn++) {
    // 骸の壁：ターン1と4の倍数で被ダメ-30%バリア
    if (hasGainoKabe && (turn === 1 || turn % 4 === 0)) {
      playerBuffs.dmgReduce = { turns: 999, rate: 0.7, isGainoKabe: true }
      logs.push({ text: `💀 骸の壁発動！ 次に攻撃を受けるまで被ダメ-30%！`, color: '#cc44ff' })
    }
    // バフ段階のアナウンス
    if (turn === 4) logs.push({ text: `━━ ${bossName}が覚醒した！全ステータス2倍！ ━━`, color: '#ff8844' })
    if (turn === 8) logs.push({ text: `━━ ${bossName}が暴走状態に！全ステータス10倍！ ━━`, color: '#ff2222' })

    // ターン10: 滅びの一撃（強制終了）
    if (turn === 10) {
      const t10name = isAmaza ? '水禍創世' : isZerugiasu ? '神雷終焉' : '滅びの咆哮'
      logs.push({ text: `${turn}ターン目: ${bossName}の「${t10name}」！`, color: '#ff0000' })
      logs.push({ text: `999,999の壊滅ダメージ！（なんとか生き延びた…HP→1）`, color: '#ff4444' })
      break
    }

    const boss = getBossForTurn(turn, bossName)
    const enemyBuffs = {} // ボスはデバフ無効なので常に空
    const hpBeforeTurn = playerHp // 雷鋼の機神鎧: このターンに被ダメしたか判定用

    // 召喚（式神／ペット）のターン開始攻撃。ボスへの与ダメを totalDamage に加算
    {
      const sEnemy = { def: BOSS_DEF, mdef: BOSS_MDEF, atk: boss.atk, matk: boss.atk, type: 'physical', name: bossName, evasionRate: 0 }
      totalDamage += summonAttackDamage(summon, sEnemy, enemyBuffs, playerBuffs, eff, rtCur, logs)
    }

    // ========== プレイヤー攻撃 ==========
    const doPlayerAttack = (isExtra = false) => {
      if (playerDied) return  // 死亡後は同ターン内でも行動させない（死亡後に攻撃が続く不具合の修正）
      const madokenBonus = hasMadokenJutsu ? Math.floor(eff.matk * (pe('魔法剣士')?0.6:0.3)) : 0
      const holyKnightMult = hasHolyKnightPassive ? (pe('聖騎士')?2.0:1.5) : 1.0
      const kabeDefP = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
      const pAtk  = (eff.atk + madokenBonus + takaAtkBonus) * madokenAtkMult * (playerBuffs.atkUp?.rate  || 1) * (playerBuffs.atkDown?.rate || 1) * (playerBuffs.burn?.turns > 0 ? 0.9 : 1) * evoAtkMult(eff, allSkillsSet)
      const pMatk = (eff.matk - madokenBonus) * (playerBuffs.matkUp?.rate || 1) * passiveMatkMult * passiveMatkMultTenki * (playerBuffs.burn?.turns > 0 ? 0.9 : 1) * evoMatkMult(eff, allSkillsSet)
      const pDef  = eff.def  * (playerBuffs.defUp?.rate  || 1) * holyKnightMult * kabeDefP * ryurinMult
      const pMdef = eff.mdef * (playerBuffs.mdefUp?.rate || 1) * (playerBuffs.defUp?.rate || 1) * holyKnightMult * kabeDefP * ryurinMult
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
      // 天墜竜閃の溜め中：次の手番は必ず天墜竜閃（解放）を出す。
      // （Game.jsxと同様。これが無いとレイドでは溜めた後に解放されず、次の通常スキルが出てしまう）
      if (playerBuffs.tenkaiCharge?.turns > 0) {
        const tIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === '天墜竜閃')
        if (tIdx >= 0) skillIndex = tIdx
      }
      let skillUsed = false, mpShort = false
      if (expandedSkillSet.length > 0) {
        const cs = expandedSkillSet[skillIndex % expandedSkillSet.length]
        let mpCost = Math.floor((isArtifact ? (cs?.skills?.mp_cost || 0) * 2 : (cs?.skills?.mp_cost || 0)) * passiveMpCostMult)
        if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(playerMp * 0.1))
        if (cs?.skills?.name === '天墜竜閃' && playerBuffs.tenkaiCharge?.turns > 0) mpCost = 0  // 解放ターンはMP消費なし（溜め時に消費済み）
        const isBreederCmd = cs?.skills?.name && BREEDER_COMMANDS.has(cs.skills.name)
        if (isBreederCmd) {
          // ブリーダーのコマンドスキル（executeSkillを通さず専用処理）
          const cmd = tryPetCommand(cs.skills.name, summon, { def: BOSS_DEF, mdef: BOSS_MDEF, atk: boss.atk, matk: boss.atk, type: 'physical', name: bossName, evasionRate: 0 }, enemyBuffs, playerBuffs, rtCur, playerMp, mpCost, eff.hp_max, logs, prefix)
          if (cmd.handled) {
            playerMp -= cmd.mpUsed
            totalDamage += cmd.enemyDamage
            if (cmd.playerHeal > 0) playerHp = Math.min(eff.hp_max, playerHp + cmd.playerHeal)
            prevSkillName = cs.skills.name
            skillUsed = true; skillIndex++
          }
          // handled=false（ペット不在/MP不足）は skillUsed=false のまま下の通常攻撃へ
        } else if (cs && cs.skills && playerMp >= mpCost) {
          playerMp -= mpCost
          if (cs.skills.name === '天墜竜閃') tenkaiActedThisTurn = true  // 溜め/解放どちらでも当ターンは追加行動なし
          const gensoMult = (hasGensoKyomei && prevSkillName && prevSkillName !== cs.skills.name) ? (pe('元素使い')?1.50:1.30) : 1.0
          // 精密照準（再修練）：同スキルを連続使用するたびに与ダメ+10%・クリ率+2%（重複3／別スキルでリセット）
          if (hasSeimitsu && pe('魔銃士')) seimitsuStacks = (prevSkillName && prevSkillName === cs.skills.name) ? Math.min(3, seimitsuStacks+1) : 0
          const seimitsuMult = 1 + 0.10 * seimitsuStacks
          const seimitsuCritBonus = 2 * seimitsuStacks
          prevSkillName = cs.skills.name
          const res = executeSkill(cs.skills, { ...effBuff, lastMpCost: mpCost }, profile, boss, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
          // 第六感（再修練）：これまでの魔法攻撃ヒット数に応じ全与ダメ+5%/スタック（最大6＝+30%）
          const rokkanMult = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05*Math.min(6, rokkanStacks)) : 1.0
          // 居合の構え：物理攻撃スキルのみ物理ダメ強化（魔法には乗らない）
          const iaiMult = (cs.skills?.type === '物理攻撃') ? iaiPhysMult : 1.0
          const finalCrit = res.dmg > 0 && (isCrit || ((res.bonusCritRate + seimitsuCritBonus) > 0 && Math.random() * 100 < playerCritRate + res.bonusCritRate + seimitsuCritBonus))
          const finalCritMult = finalCrit ? (1.5 + (eff.critDmg || 0) + passiveCritDmgBonus) : 1.0
          const tosoMult = hasTosoHonno ? (playerHp <= eff.hp_max * 0.3 ? (pe('体術師')?2.0:1.6) : playerHp <= eff.hp_max * 0.5 ? (pe('体術師')?1.4:1.2) : 1.0) : 1.0
          let defScale = 1.0
          if (res.dmg > 0) {
            const sType = cs.skills?.type
            // 防御貫通を反映（宝石eff.defPen + スキルres.defPen + 明鏡止水等mukyoPen）。Game.jsxと同構造
            const skillCls = cs.skills?.class_name
            const buffPen = playerBuffs.mukyoPen?.turns > 0 ? playerBuffs.mukyoPen.rate : 0
            const spMdefPen = playerBuffs.spiritMdefPen?.turns > 0 ? playerBuffs.spiritMdefPen.rate : 0  // ノクス：魔法防御貫通バフ
            const bDef  = Math.max(1, Math.floor(BOSS_DEF  * (1-(eff.defPen||0))  * (1-Math.min(0.8,(res.defPen||0)+buffPen))))
            const bMdef = Math.max(1, Math.floor(BOSS_MDEF * (1-(eff.mdefPen||0)) * (1-Math.min(0.8,(res.mdefPen||0)+spMdefPen))))
            // サイコブラスト/マインドブレイク等、およびサイキッカー・魔銃士の全スキルは敵DEF・MDEFの低い方で軽減（Game.jsxと同構造）
            const useLowDef = cs.skills?.name === 'サイコブラスト' || res.useMinDef || skillCls === 'サイキッカー' || skillCls === '魔銃士'
            if (res.physScaleMatk) defScale = effBuff.matk / (effBuff.matk + bDef)  // 物理ダメだが火力参照は特殊攻撃（オオカミ召喚/シルフ等）
            else if (useLowDef) defScale = effBuff.matk / (effBuff.matk + Math.min(bDef, bMdef))
            else if (sType === '物理攻撃') defScale = effBuff.atk / (effBuff.atk + bDef)
            else if (sType === '魔法攻撃') defScale = effBuff.matk / (effBuff.matk + bMdef)
          }
          const skillPhysical = !(cs.skills?.type === '魔法攻撃' || cs.skills?.name === 'サイコブラスト' || res.useMinDef)
          const allinDebuffOutMult = playerBuffs.allinDebuff?.turns > 0 ? 0.7 : 1.0  // オールイン反動中は与ダメ-30%
          const nextBoostMult = (res.dmg > 0 && playerBuffs.nextSkillBoost) ? playerBuffs.nextSkillBoost.rate : 1.0  // 半月蹴りの溜め（次の一撃強化）
          if (nextBoostMult > 1.0 && cs.skills?.name !== '半月蹴り') res.newPlayerBuffs.nextSkillBoost = undefined  // 消費
          let finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * nextBoostMult * emblemDmgMult(eff, skillPhysical) * (0.9 + Math.random() * 0.2))
          if (res.dmg > 0) finalDmg = cutRaidHit(Math.floor(finalDmg * weakMult(skillPhysical))) // 弱点補正＋1ヒット段階カット
          // 第六感（再修練）：魔法攻撃がヒットしたらスタック+1（最大6・戦闘中持続）
          if (hasRokkan && pe('サイキッカー') && finalDmg > 0 && cs.skills?.type === '魔法攻撃') rokkanStacks = Math.min(6, rokkanStacks + 1)
          if (res.selfDmg > 0) playerHp = Math.max(1, playerHp - res.selfDmg)
          const isHealBlocked = playerBuffs.healBlock?.turns > 0
          // 与ダメ割合回復の1ヒット上限：基本 最大HP20%、クリティカル時35%（血の狂気/ソウルドレイン/ルミナ・レイ共通）
          const healCapPct = finalCrit ? 0.35 : 0.20
          if (!isHealBlocked && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0) {
            const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(eff.hp_max * healCapPct))
            playerHp = Math.min(eff.hp_max, playerHp + rageCure)
            logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
          }
          // 与ダメ割合回復(ソウルドレイン/ルミナ・レイ等)：実際の与ダメージ(クリティカル込み)から回復
          if (!isHealBlocked && res.drainRate > 0 && finalDmg > 0) {
            const drainHeal = Math.min(Math.floor(finalDmg * res.drainRate), Math.floor(eff.hp_max * healCapPct))
            playerHp = Math.min(eff.hp_max, playerHp + drainHeal)
            logs.push({ text: `💚 HPを${drainHeal}回復！`, color: '#66ffaa' })
          }
          totalDamage += finalDmg
          // 紋章: 物理/特殊吸収（与ダメの一定割合を回復・回復封印中は無効）
          { const emDrain = emblemDrainAmount(eff, finalDmg, skillPhysical); if (emDrain > 0 && !isHealBlocked) { playerHp = Math.min(eff.hp_max, playerHp + emDrain); logs.push({ text: `💠 紋章の吸収！ HPが${fmt(emDrain)}回復！`, color: '#66ddff' }) } }
          if (!isHealBlocked) {
            const healAmt = Math.floor(res.heal * passiveHealMult * (playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1))  // ルミナ等の回復力アップを反映
            playerHp = Math.min(eff.hp_max, playerHp + healAmt)
            if (passiveHealReflect && healAmt > 0) {
              const reflectDmg = healAmt  // 神聖加護強化：回復量の100%を反射
              totalDamage += reflectDmg
              logs.push({ text: `✨ 神聖加護の反射！ ${bossName}に${fmt(reflectDmg)}ダメージ！`, color: '#ffdd44' })
            }
          } else if (res.heal > 0) {
            logs.push({ text: `回復封印中！ 回復効果が無効化された！`, color: '#aa22ff' })
          }
          // 魔剣開放/オールインの反動中はバフ系スキルを無効化（Game.jsxと同構造）
          if (playerBuffs.spellBladeSealed?.turns > 0) {
            const bk = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune','holyField','holyAwakening','flashCombo','spellBladeExhaust','nextSkillBoost']
            for (const k of bk) { if (res.newPlayerBuffs[k] !== playerBuffs[k]) res.newPlayerBuffs[k] = playerBuffs[k] }
          }
          if (playerBuffs.allinDebuff?.turns > 0) {
            const bk = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune','nextSkillBoost']
            for (const k of bk) { if (res.newPlayerBuffs[k] !== playerBuffs[k]) res.newPlayerBuffs[k] = playerBuffs[k] }
          }
          // ボスにはデバフ・状態異常無効（newEnemyBuffsは捨てる）
          playerBuffs = { ...playerBuffs, ...res.newPlayerBuffs }
          // 精霊共鳴：同じ精霊召喚を3回でtripled→次の行動で確定追加行動（Game.jsxと同構造）
          if (passiveNames.includes('精霊共鳴') && playerBuffs.spiritCombo?.tripled) {
            playerBuffs.guaranteedExtra = true
            playerBuffs.spiritCombo = { ...playerBuffs.spiritCombo, tripled:false }
            logs.push({ text: `🌟 精霊共鳴！ 精霊の力が高まり、追加行動を得る！`, color:'#ffdd66' })
          }
          const critText = finalCrit ? ' 💥クリティカル！' : ''
          // ダメージ表記：多段ヒット(res.hitDmgs)はログに合計(res.dmg)の文字列が現れず replace が効かない＝
          // 生のヒット内訳(未圧縮)が表示され、実際の与ダメ(finalDmg)と食い違う。実際の与ダメで作り直す。
          let resLog
          if (Array.isArray(res.hitDmgs) && res.hitDmgs.length > 1 && res.dmg > 0) {
            // ダメージ内訳のみ合計表示に差し替え、スキル名(先頭)と末尾の補足
            // （「2連撃・防御貫通」「○撃目が外れた」「やけど状態」等＝'ダメージ'を含まない節）は温存する
            const segs = res.log.split('！')
            const head = segs[0]
            const tail = []
            for (let i = segs.length - 1; i >= 1; i--) {
              const s = segs[i]
              if (s === '') continue
              if (s.includes('ダメージ')) break  // ここはヒット内訳なので停止
              tail.unshift(s)
            }
            const suffix = tail.length ? ' ' + tail.join('！') + (res.log.endsWith('！') ? '！' : '') : ''
            resLog = `${head}！ ${bossName}に合計${fmt(finalDmg)}ダメージ！（${res.hitDmgs.length}回ヒット）${suffix}`
          } else {
            resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), fmt(finalDmg)) : res.log
          }
          logs.push({ text: `${prefix}${resLog}${critText}`, color: finalCrit ? '#ff4444' : '#88ccff' })
          // 追撃（影歩き/出血消費など）を別ヒットとして適用：メインとは独立したダメージ判定
          if (res.followup && res.followup.dmg > 0) {
            const fCrit = Math.random() * 100 < (playerCritRate + (res.bonusCritRate || 0))
            const fCritMult = fCrit ? (1.5 + (eff.critDmg || 0) + passiveCritDmgBonus) : 1.0
            let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * emblemDmgMult(eff, skillPhysical) * (0.9 + Math.random() * 0.2))
            fDmg = cutRaidHit(Math.max(1, Math.floor(fDmg * weakMult(skillPhysical))))
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
        const tosoMult = hasTosoHonno ? (playerHp <= eff.hp_max * 0.3 ? (pe('体術師')?2.0:1.6) : playerHp <= eff.hp_max * 0.5 ? (pe('体術師')?1.4:1.2) : 1.0) : 1.0
        // 通常攻撃：物理時のみ居合の構えを乗算／第六感スタックを乗算
        const naIaiMult = isMagical ? 1.0 : iaiPhysMult
        const naRokkanMult = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05*Math.min(6, rokkanStacks)) : 1.0
        let finalDmg = Math.floor(baseDmg * critMult * (isArtifact ? 1.3 : 1.0) * passiveDmgMult * tosoMult * naIaiMult * naRokkanMult * emblemDmgMult(eff, !isMagical) * (0.9 + Math.random() * 0.2))
        finalDmg = cutRaidHit(Math.floor(finalDmg * weakMult(!isMagical))) // 弱点補正＋1ヒット段階カット
        // 通常攻撃は精密照準スタックをリセット（連続スキルが途切れる）
        seimitsuStacks = 0; prevSkillName = null
        if (!playerBuffs.healBlock?.turns && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0) {
          const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(eff.hp_max * (isCrit ? 0.35 : 0.20)))
          playerHp = Math.min(eff.hp_max, playerHp + rageCure)
          logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
        }
        totalDamage += finalDmg
        // 紋章: 物理/特殊吸収
        { const emDrain = emblemDrainAmount(eff, finalDmg, !isMagical); if (emDrain > 0 && !(playerBuffs.healBlock?.turns > 0)) { playerHp = Math.min(eff.hp_max, playerHp + emDrain); logs.push({ text: `💠 紋章の吸収！ HPが${fmt(emDrain)}回復！`, color: '#66ddff' }) } }
        const critText = isCrit ? ' 💥クリティカル！' : ''
        logs.push({ text: `${prefix}あなたの攻撃！ ${bossName}に${fmt(finalDmg)}ダメージ！${critText}`, color: isCrit ? '#ff4444' : '#ffcc00' })
        if (expandedSkillSet.length > 0) skillIndex++
      }
    }

    // ========== ボス攻撃（HPは変動するが結果をDBに保存しない） ==========
    const doBossAttack = (isExtra = false) => {
      if (playerDied) return  // 死亡後は追撃も含めて行動を止める（死亡後にターン継続する不具合の修正）
      const holyKnightMultE = hasHolyKnightPassive ? (pe('聖騎士')?2.0:1.5) : 1.0
      const kabeDefE = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
      const pDef  = eff.def  * (playerBuffs.defUp?.rate  || 1) * holyKnightMultE * kabeDefE * ryurinMult
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const berserkDmgRate = hasBerserk ? (pe('狂戦士')?1.20:1.15) : 1.0
      const eAtk = boss.atk
      const defForCalc = Math.max(1, pDef)
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `

      // ターン4: 特殊スキル（倍率1.5）。ボスごとに効果が異なる
      if (turn === 4 && !isExtra) {
        let specialDmg = Math.max(1, Math.floor(eAtk * eAtk / Math.max(1, eAtk + defForCalc) * 1.5 * (0.9 + Math.random() * 0.2)))
        specialDmg = Math.max(1, Math.floor(specialDmg * evoTakenMult(eff, false) * ryurinReduce()))  // 真化: 被ダメ%軽減(海竜)＋竜鱗の加護
        // ペット召喚：50%でペットがダメージを肩代わり（状態異常は下でプレイヤーに付与）
        if (!summonAbsorbSkill(summon, specialDmg, logs)) {
          playerHp -= specialDmg
          if ((eff.evoReflectPct||0) > 0) { const r = Math.max(1, Math.floor(specialDmg * eff.evoReflectPct/100)); totalDamage += r; logs.push({ text:`🛡 真化効果！ 反射で${fmt(r)}ダメージ！`, color:'#88ccff' }) }
        }
        if (isAmaza) {
          // 深淵の水葬：10ターンの間 素早さ-50%（クリ・回避・追加行動率を半減SPDで再計算）
          playerBuffs.spdDown = { turns: 10, rate: 0.5 }
          const halfSpd = Math.floor(effectiveSpdForCalc * 0.5)
          playerCritRate  = calcCritRate(halfSpd, BOSS_SPD) + passiveCritBonus + (eff.critBonus || 0)
          playerEvasion   = calcEvasionRate(halfSpd, BOSS_SPD) + (eff.evasionBonus || 0)
          playerExtraRate = calcExtraActionRate(halfSpd, BOSS_SPD)
          logs.push({ text: `${prefix}${bossName}の「深淵の水葬」！ ${fmt(specialDmg)}ダメージ！ 10ターンの間 素早さ-50%！`, color: '#2299ff' })
        } else if (isZerugiasu) {
          // 神雷崩撃：本物の麻痺（10ターン・素早さ-20%＋25%で行動不能）。哭雨の羽衣で無効化可
          logs.push({ text: `${prefix}${bossName}の「神雷崩撃」！ ${fmt(specialDmg)}ダメージ！`, color: '#ffcc00' })
          if (!ailmentShieldBlocks(playerBuffs, logs) && !emblemBlocksAilment(eff, 'paralysis', logs)) {
            playerBuffs.paralysis = { turns: 10, skipRate: 0.25, spdRate: 0.8 }
            const paraSpd = Math.floor(effectiveSpdForCalc * 0.8)
            playerCritRate  = calcCritRate(paraSpd, BOSS_SPD) + passiveCritBonus + (eff.critBonus || 0)
            playerEvasion   = calcEvasionRate(paraSpd, BOSS_SPD) + (eff.evasionBonus || 0)
            playerExtraRate = calcExtraActionRate(paraSpd, BOSS_SPD)
            logs.push({ text: `⚡ 麻痺した！（素早さ低下＋行動不能の危険）`, color: '#ffcc00' })
          }
        } else {
          // 暗黒侵食：回復無効を永続化。哭雨の羽衣で無効化可
          logs.push({ text: `${prefix}${bossName}の「暗黒侵食」！ ${fmt(specialDmg)}ダメージ！`, color: '#aa22ff' })
          if (!ailmentShieldBlocks(playerBuffs, logs)) {
            playerBuffs.healBlock = { turns: 999 }
            logs.push({ text: `🚫 回復が永続的に封印された！`, color: '#aa22ff' })
          }
        }
        if (playerHp <= 0) { playerHp = 0; logs.push({ text: `力尽きた…（バトル終了）`, color: '#ff4444' }); playerDied = true }
        return
      }

      // ペット召喚：50%で敵の通常攻撃をペットが受ける（回避判定より前＝他エンジンと統一。受けたらプレイヤーHP無傷・骸の壁も消費しない）
      if (summonAbsorbBasic(summon, { atk: boss.atk, matk: boss.atk, type: 'physical' }, enemyBuffs, turn, logs)) return

      const isCrit = Math.random() * 100 < bossCritRate
      const baseDmg = Math.max(1, Math.floor(eAtk * eAtk / Math.max(1, eAtk + defForCalc)) + Math.floor(Math.random() * 3))
      // プレイヤー回避
      const evasionRate = playerEvasion + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0)
      if (evasionRate > 0 && Math.random() * 100 < evasionRate) {
        logs.push({ text: `${prefix}${bossName}の攻撃！ しかし回避した！`, color: '#44ff88' })
        evoOnEvade(eff, playerBuffs, logs)  // 影踏みのブーツ
        return
      }
      const playerDefRankReduction = calcDefReduction(pDef)
      const gambleBodyMult = hasGambleBody ? (pe('ギャンブラー') ? (0.5+Math.random()*0.7) : (0.7+Math.random()*0.6)) : 1.0
      const finalDmg = Math.floor(baseDmg * (isCrit ? 1.5 : 1.0) * dmgReduceRate * berserkDmgRate * (1 - playerDefRankReduction) * gambleBodyMult * evoTakenMult(eff, true) * ryurinReduce() * (0.9 + Math.random() * 0.2))
      playerHp -= finalDmg
      if ((eff.evoReflectPct||0) > 0 && finalDmg > 0) { const r = Math.max(1, Math.floor(finalDmg * eff.evoReflectPct/100)); totalDamage += r; logs.push({ text:`🛡 真化効果！ 反射で${fmt(r)}ダメージ！`, color:'#88ccff' }) }
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
    // 追加行動判定：精霊共鳴の確定追加行動(guaranteedExtra)を最優先で消費、無ければ素早さ由来の確率
    const canPlayerExtra = () => {
      if (tenkaiActedThisTurn) return false  // 天墜竜閃を撃ったターン（溜め・解放とも）は追加行動なし
      if (playerBuffs.guaranteedExtra) { playerBuffs.guaranteedExtra = false; return true }
      return Math.random() * 100 < playerExtraRate
    }
    // 麻痺による行動不能判定（神雷崩撃で付与・25%で行動不能、発動ごとに半減）
    let playerSkipped = false
    if (playerBuffs.paralysis?.turns > 0 && Math.random() < playerBuffs.paralysis.skipRate) {
      logs.push({ text: `${turn}ターン目: 麻痺で行動不能！`, color: '#ffaa00' })
      playerSkipped = true
      playerBuffs.paralysis.skipRate *= 0.5
    }
    const doPlayerTurn = () => {
      if (playerSkipped) return
      tenkaiActedThisTurn = false
      doPlayerAttack()
      if (canPlayerExtra()) doPlayerAttack(true)
    }
    if (playerFirst) {
      doPlayerTurn()
      doBossAttack()
      if (Math.random() * 100 < bossExtraRate) doBossAttack(true)
    } else {
      doBossAttack()
      if (Math.random() * 100 < bossExtraRate) doBossAttack(true)
      doPlayerTurn()
    }

    if (playerDied) break

    // バフターン減算
    const berserkWasActive = playerBuffs.berserk?.turns > 0
    for (const k of Object.keys(playerBuffs)) {
      if (playerBuffs[k]?.turns > 0) playerBuffs[k] = { ...playerBuffs[k], turns: playerBuffs[k].turns - 1 }
    }
    summonEndOfTurn(summon) // ペットの被ダメ軽減ターン減衰
    // 狂乱解除時：skillIndexをマッドラッシュの次に進める
    if (berserkWasActive && (playerBuffs.berserk?.turns ?? 0) === 0 && expandedSkillSet.length > 0) {
      const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk?.lockedSkill)
      if (lockedIdx >= 0) skillIndex = lockedIdx + 1
    }
    // turns===0 の一時バフを掃除（atkUp等は ?.rate||1 で読まれるため、削除しないと永続する。Game.jsxと同様）
    for (const k of Object.keys(playerBuffs)) { if (playerBuffs[k]?.turns === 0) delete playerBuffs[k] }
    // 雷鋼の機神鎧: このターンに被ダメージしたら2ターン素早さ+15%（既存の上位spdUpは上書きしない）
    if (ondmgSpdUp > 1 && playerHp < hpBeforeTurn && !(playerBuffs.spdUp?.turns > 0 && playerBuffs.spdUp.rate >= ondmgSpdUp)) {
      playerBuffs.spdUp = { turns: 2, rate: ondmgSpdUp }
      logs.push({ text: `⚙ 雷鋼の機神鎧が起動！ 2ターンの間 素早さ+${Math.round((ondmgSpdUp - 1) * 100)}%！`, color: '#66ccff' })
    }
    // 哭雨の羽衣: 5ターンごとに状態異常無効バフを再獲得（既にバフがある場合は重複しない）
    if (hasAmagoiShield && turn % 5 === 0 && playerHp > 0 && !(playerBuffs.ailmentShield?.charges > 0)) {
      playerBuffs.ailmentShield = { charges: 1 }
      logs.push({ text: `🛡 哭雨の羽衣の加護！ 状態異常を1回無効化するバフを獲得！`, color: '#66ccff' })
    }
    // リジェネ・遅延ヒール（回復封印中は無効）
    const isHealBlockedTick = playerBuffs.healBlock?.turns > 0
    if (playerBuffs.regenHeal?.turns > 0) {
      if (!isHealBlockedTick) {
        const healAmt = Math.floor(playerBuffs.regenHeal.amount * passiveHealMult * (playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1))
        playerHp = Math.min(eff.hp_max, playerHp + healAmt)
        logs.push({ text: `💚 リジェネ！ HPが${fmt(healAmt)}回復！`, color: '#44ff88' })
        // 神聖加護（聖職者・再修練）：回復量の100%を敵に反射（出撃と同様。奇跡等の毎ターン回復にも乗る）
        if (passiveHealReflect && healAmt > 0) {
          totalDamage += healAmt
          logs.push({ text: `✨ 神聖加護の反射！ ${bossName}に${fmt(healAmt)}ダメージ！`, color: '#ffdd44' })
        }
      }
    }
    if (playerBuffs.delayHeal?.triggerTurn === turn) {
      if (!isHealBlockedTick) {
        playerHp = Math.min(eff.hp_max, playerHp + playerBuffs.delayHeal.amount)
        logs.push({ text: `💚 ${playerBuffs.delayHeal.amount}HP回復！`, color: '#44ff88' })
      }
    }
  }

  // 圧縮はサーバー側で累計に適用するため、ここでは生ダメージをそのまま返す
  logs.push({ text: `──────────────────`, color: '#223344' })
  logs.push({ text: `合計 ${fmt(totalDamage)} ダメージを与えた！`, color: '#ffcc44' })

  return { logs, totalDamage, playerDied }
}

export default function RaidBoss() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [abilityTitle, setAbilityTitle] = useState(null)  // 称号ボーナス（calcEffectiveStatsに渡す）
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
  const [pendingRewards, setPendingRewards] = useState([]) // 過去レイドの未受取報酬（次のボスが出て画面から消えた分の救済）
  const [pendingMsg, setPendingMsg] = useState({})         // raid_id→結果メッセージ
  const pollRef = useRef(null)
  const cdRef = useRef(null)
  const logsEndRef = useRef(null)
  const attackingRef = useRef(false)  // 連打ガード（state更新前の多重発火を防ぐ）
  const clockOffsetRef = useRef(0)    // サーバー時刻 - 端末時刻(ms)。端末時計ズレでCDが解消しない問題の補正
  const serverNow = () => Date.now() + clockOffsetRef.current

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
    // 称号ボーナスを取得（戦闘ステータスに反映）
    if (prof.ability_title_id) {
      const { data: at } = await supabase.from('titles').select('*').eq('id', prof.ability_title_id).single()
      setAbilityTitle(at || null)
    } else { setAbilityTitle(null) }

    // サーバー時刻オフセットを測定（端末時計のズレでレイドCDが解消しない問題の対策）
    try {
      const t0 = Date.now()
      const { data: sn } = await supabase.rpc('server_now')
      if (sn) {
        const t1 = Date.now()
        const serverMs = new Date(sn).getTime() + (t1 - t0) / 2
        clockOffsetRef.current = serverMs - t1
      }
    } catch { /* 意図的に無視 */ }
    setEquipment(eq || [])
    setProficiency(prof2 || [])
    // レイド用スキルセット（raid・未設定なら出撃にフォールバック）＋パッシブは全セットから常時反映
    setSkillSets(selectBattleSkillSets(ss, 'raid'))

    // 共有CD残り計算（サーバー時刻基準。端末時計がズレていてもCDが解消する）
    if (prof.last_action_at) {
      const elapsed = (serverNow() - new Date(prof.last_action_at).getTime()) / 1000
      setRemaining(Math.max(0, raidWaitFor(prof) - elapsed))
    }

    const curBoss = await fetchBoss(user.id)
    await fetchPendingRewards(user.id, curBoss?.id)
    pollRef.current = setInterval(() => fetchBoss(user.id), POLL_MS)
  }

  // 過去レイドの未受取報酬（討伐/時間切れ済み・reward_claimed=false）を拾う。
  // 次のボスが出現すると現在ボスの画面からは消えるため、ここで救済表示する。
  const fetchPendingRewards = async (playerId, currentBossId) => {
    const { data } = await supabase
      .from('raid_participants')
      .select('raid_id, attack_count, damage_dealt, reward_claimed, raid_boss!inner(id, status, boss_name, defeated_at)')
      .eq('player_id', playerId)
      .eq('reward_claimed', false)
      .in('raid_boss.status', ['defeated', 'expired'])
    // 現在画面に出ているボスは通常のリワード欄で扱うので除外
    const list = (data || []).filter(r => r.raid_id !== currentBossId)
    setPendingRewards(list)
  }

  const claimPending = async (raidId) => {
    setPendingMsg(m => ({ ...m, [raidId]: '処理中...' }))
    const { data, error } = await supabase.rpc('claim_raid_rewards', { p_raid_id: raidId })
    if (error || data?.error) {
      setPendingMsg(m => ({ ...m, [raidId]: data?.error || 'エラーが発生しました' }))
    } else {
      const parts = [`${data.tier}ティア`, `Gold+${fmt(data.gold)}`, `強化石${(data.stones||[]).map(s=>`(${s})`).join('・')}×2`, `宝石(${data.gem_rank})×${data.gem_count}`, `通常素材：${data.mat_name||'素材'}×${data.scale_count}`]
      if (data.got_gyaku) parts.push(`⭐レア素材：${data.rare_name||'レア素材'}×1`)
      if (data.book) parts.push(`📖${data.book}×1`)
      if (data.top_rank >= 1 && data.top_rank <= 3) parts.push(`🏅与ダメ${data.top_rank}位ボーナス：Gold+${fmt(data.top_gold)}・📖${data.top_book}×1`)
      const bossNm = pendingRewards.find(r => r.raid_id === raidId)?.raid_boss?.boss_name
      setPendingMsg(m => ({ ...m, [raidId]: `✓ ${bossNm ? bossNm + '：' : ''}受け取り完了！ ${parts.join(' / ')}` }))
      setPendingRewards(prev => prev.filter(r => r.raid_id !== raidId))
    }
  }

  const fetchBoss = async (playerId) => {
    const { data } = await supabase.rpc('spawn_raid_boss_if_needed')
    if (!data) return null

    setNextSpawn(data.next_spawn || null)
    setNextBossName(data.next_boss_name || null)

    if (data.status === 'waiting') {
      setBoss(false)
      return null
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
    return data
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

      const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
      // 読み込み未完了/失敗でstateが空のままだとスキル無し戦闘になるため、空ならDBから取り直す
      let curSets = skillSets
      if (curSets.length === 0) {
        const { data: ss2 } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', profile.id).order('slot_order')
        if (Array.isArray(ss2) && ss2.length) {
          curSets = selectBattleSkillSets(ss2, 'raid')
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
        // 累計50万到達で与ダメ半減中は、実際に通ったダメージ（サーバー確定値）を明示
        if (data.halved) {
          setBattleLogs(prev => [...prev, { text: `⚠ このボスへの累計ダメージが50万を超えたため、以降の与ダメージは半減します（実ダメージ ${fmt(data.damage)}）`, color: '#ffaa44' }])
        }
        setRemaining(raidWaitFor(profile))
        // HP/MP全回復 + 出撃EXP はサーバ側(attack_raid_boss)で付与済み。実際の付与量を表示する。
        // サーバーが exp_gain を返せばそれを、無ければ (新exp − 旧exp) から算出。
        const expGain = (typeof data.exp_gain === 'number') ? data.exp_gain
          : (typeof data.exp === 'number') ? Math.max(0, data.exp - (profile.exp || 0))
          : 0
        const newExp = data.exp ?? ((profile.exp || 0) + expGain)
        setProfile(prev => ({ ...prev, hp_current: eff.hp_max, mp_current: eff.mp_max, exp: newExp }))
        if (expGain === 0) {
          setBattleLogs(prev => [...prev, { text: '🌾 かかし修練中のため出撃報酬のEXPはもらえません', color: '#ffcc44' }])
        } else {
          setBattleLogs(prev => [...prev, { text: `EXP +${expGain}（出撃報酬）`, color: '#44ff88' }])
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
      clearInterval(pollRef.current)  // 受取後はポーリングを止め、報酬画面を維持する
    }
    setClaiming(false)
  }

  const totalEff = participants.reduce((s, p) => s + Number(p.damage_dealt) + Number(p.attack_count || 0) * 500, 0) || 1
  const myEff = myPart ? Number(myPart.damage_dealt) + Number(myPart.attack_count || 0) * 500 : 0
  const myContribPct = myEff / totalEff * 100
  const myTier = getTier(myContribPct, Number(myPart?.attack_count || 0), profile?.is_admin)
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

  // 本日のレイドスケジュール（21時/22時の出現ボス）。サーバーの日替わり交互と一致させる
  const epochDays = Math.floor(Date.UTC(jst.getFullYear(), jst.getMonth(), jst.getDate()) / 86400000)
  const baseDays  = Math.floor(Date.UTC(2000, 0, 1) / 86400000)
  // 3体ローテ（%3）: 21時=cycle[d] / 22時=cycle[d+1]。サーバ raid_boss_for_slot と一致させる
  const cycleIdx   = (((epochDays - baseDays) % 3) + 3) % 3
  const slot21Boss = RAID_BOSS_CYCLE[cycleIdx]
  const slot22Boss = RAID_BOSS_CYCLE[(cycleIdx + 1) % 3]
  const curHM = jst.getHours() * 60 + jst.getMinutes()
  const slotActive = (start) => curHM >= start && curHM < start + 30  // 出現中の枠か

  const base = { minHeight: '100vh', background: '#000820', color: '#aaccff', fontFamily: 'monospace', padding: '16px', boxSizing: 'border-box' }

  if (boss === undefined) {
    return <div style={{ ...base, textAlign: 'center', paddingTop: '40vh', color: '#0088ff' }}>読み込み中...</div>
  }

  return (
    <div style={base}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#000820' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>
        <div style={{ color:'#ff4444', fontSize:'14px', marginBottom:'12px' }}>⚔ レイドボス</div>

        {/* 本日の出現スケジュール（21時/22時） */}
        <div style={{ border:'1px solid #2a2a44', background:'#080814', padding:'10px 12px', marginBottom:'14px' }}>
          <div style={{ color:'#8899bb', fontSize:'11px', marginBottom:'6px' }}>🗓 本日のレイドボス（JST）</div>
          {[{ t:'21:00〜21:30', start:21*60, name:slot21Boss }, { t:'22:00〜22:30', start:22*60, name:slot22Boss }].map(s => {
            const live = slotActive(s.start)
            return (
              <div key={s.t} style={{ display:'flex', alignItems:'center', gap:'10px', fontSize:'12px', padding:'2px 0' }}>
                <span style={{ color: live ? '#ffcc44' : '#667799', minWidth:'92px' }}>{s.t}</span>
                <span style={{ color: s.name==='雨摩座' ? '#66bbff' : s.name===BOSS_ZERUGIASU ? '#ffdd44' : '#ff6666', fontWeight:'bold' }}>{s.name}</span>
                {live && <span style={{ color:'#44ff88', fontSize:'10px' }}>● 出現中</span>}
              </div>
            )
          })}
          <div style={{ color:'#556688', fontSize:'9px', marginTop:'6px' }}>※ 各30分・HP700万。3体が日替わりで入れ替わります（3日周期で全員登場）。</div>
        </div>

      {/* 未受取の過去レイド報酬（次のボスが出て画面から消えた分の救済） */}
      {pendingRewards.length > 0 && (
        <div style={{ border:'1px solid #886600', background:'#1a1400', padding:'12px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc44', fontSize:'12px', marginBottom:'8px' }}>🎁 未受取のレイド報酬があります</div>
          {pendingRewards.map(r => (
            <div key={r.raid_id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px', marginBottom:'6px', flexWrap:'wrap' }}>
              <span style={{ color:'#ccbb88', fontSize:'11px' }}>
                {r.raid_boss?.boss_name || 'レイドボス'}（出撃{r.attack_count}回）
              </span>
              <button onClick={() => claimPending(r.raid_id)} disabled={pendingMsg[r.raid_id]==='処理中...'}
                style={{ padding:'5px 16px', background:'#002200', border:'1px solid #44ff88', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                受け取る
              </button>
              {pendingMsg[r.raid_id] && <div style={{ color:'#88ccaa', fontSize:'10px', width:'100%' }}>{pendingMsg[r.raid_id]}</div>}
            </div>
          ))}
        </div>
      )}
      {/* 受け取り完了メッセージ（1個受け取るごとに即表示・残りがあっても出す） */}
      {Object.values(pendingMsg).some(m => m.startsWith('✓')) && (
        <div style={{ border:'1px solid #224422', background:'#001a00', padding:'10px', marginBottom:'12px' }}>
          {Object.entries(pendingMsg).filter(([,m])=>m.startsWith('✓')).map(([rid,m]) => (
            <div key={rid} style={{ color:'#44ff88', fontSize:'11px' }}>{m}</div>
          ))}
        </div>
      )}

      {/* 【開発】管理者専用テストパネル */}
      {profile?.is_admin && (
        <div style={{ border:'1px solid #3a2a6a', background:'#0a0820', padding:'10px', marginBottom:'12px' }}>
          <div style={{ color:'#a890ff', fontSize:'11px', marginBottom:'6px' }}>🔧 開発テスト（管理者のみ・一般には非表示）</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
            <button onClick={() => devSpawn('雨摩座')} style={{ padding:'5px 10px', background:'#1a0e2a', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>雨摩座を今出現</button>
            <button onClick={() => devSpawn('黒龍ヴァルゼノク')} style={{ padding:'5px 10px', background:'#1a0e2a', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>ヴァルゼノクを今出現</button>
            <button onClick={() => devSpawn('雷鋼機神ゼルギアス')} style={{ padding:'5px 10px', background:'#1a0e2a', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>ゼルギアスを今出現</button>
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
              <div style={{ color: '#446688', fontSize: '10px', marginTop: '2px' }}>毎日21:00／22:00 JST出現（各30分・3体が日替わり）/ HP 7,000,000</div>
            </div>
            <div style={{ fontSize: '10px', color: '#335566', lineHeight: '1.8' }}>
              全プレイヤーで協力して討伐！貢献度に応じてリワードが変わります。
            </div>
          </div>

          <RewardTable isAdmin={profile?.is_admin} />
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
                <div style={{ height: '100%', width: `${((raidWaitFor(profile) - remaining) / raidWaitFor(profile)) * 100}%`, background: canAct ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition: 'width 0.2s' }} />
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
                    {(reward.stones || []).map(s => `強化石(${s})×2`).join('　')}
                  </div>
                  <div style={{ color: '#ff66cc' }}>宝石({reward.gem_rank}) × {reward.gem_count}個（ランダム種類）</div>
                  <div style={{ color: '#cc8844' }}>通常素材：{reward.mat_name || '黒龍の鱗'} × {reward.scale_count}個</div>
                  {reward.got_gyaku && <div style={{ color: '#ffcc00' }}>⭐ レア素材：{reward.rare_name || '黒龍の逆鱗'} × 1個（レアドロップ！）</div>}
                  {reward.book && <div style={{ color: '#ffaa44' }}>📖 {reward.book} × 1個</div>}
                  {reward.top_rank >= 1 && reward.top_rank <= 3 && (
                    <div style={{ color: '#ffdd44', marginTop: '2px' }}>
                      🏅 与ダメージ{reward.top_rank}位ボーナス！ Gold +{fmt(reward.top_gold)}／📖 {reward.top_book} × 1個
                    </div>
                  )}
                  <div style={{ color: '#44ff88', marginTop: '4px' }}>✓ 受け取り完了！</div>
                </div>
              ) : myPart.reward_claimed ? (
                <div style={{ color: '#446688', fontSize: '12px' }}>✓ 既に受け取り済みです</div>
              ) : (
                <>
                  <div style={{ fontSize: '12px', color: '#aaaaaa', marginBottom: '10px', lineHeight: '1.8' }}>
                    予定リワード: {myTier.tier}ティア / Gold {fmt(myTier.gold)} / 強化石{myTier.stones.map(s=>`(${s})`).join('・')}×2 / 宝石{myTier.gemRank}×{myTier.gemCount}
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
                    const tier = getTier(pct, Number(p.attack_count || 0), profile?.is_admin && p.player_id === profile.id)
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

          <RewardTable isAdmin={profile?.is_admin} />
        </div>
      )}

        {/* レイド通知（Web Push）設定。ページ下部に常設 */}
        <RaidPushSettings />
      </div>
    </div>
  )
}

// レイド通知（Web Push）のON/OFFをページ内に常設するパネル。端末ごとの購読。
function RaidPushSettings() {
  const [status, setStatus] = useState('loading') // loading|unsupported|notconfigured|denied|on|off
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let s
      if (!pushSupported()) s = 'unsupported'
      else if (!pushConfigured()) s = 'notconfigured'
      else s = await getPushStatus()
      if (!cancelled) setStatus(s)
    })()
    return () => { cancelled = true }
  }, [])

  const toggle = async () => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      if (status === 'on') { setStatus(await disableRaidPush()); setMsg('レイド通知をOFFにしました。') }
      else { setStatus(await enableRaidPush()); setMsg('レイド通知をONにしました。毎日21時・22時にお知らせします。') }
    } catch (e) {
      const m = e?.message || ''
      if (m === 'denied') setMsg('通知が許可されていません。端末／ブラウザの設定で通知を許可してください。')
      else if (m === 'not_configured') setMsg('通知はまだ準備中です（サーバー設定待ち）。')
      else if (m === 'unsupported') setMsg('この端末／ブラウザは通知に対応していません。')
      else if (m === 'unauth') setMsg('ログインし直してからお試しください。')
      else setMsg('うまくいきませんでした。時間を置いて、もう一度お試しください。')
    } finally { setBusy(false) }
  }

  const isOn = status === 'on'
  const canToggle = status === 'on' || status === 'off'

  return (
    <div style={{ border: '1px solid #1a4a3a', background: '#001810', padding: '14px', marginTop: '16px' }}>
      <div style={{ color: '#44ddaa', fontSize: '13px', marginBottom: '8px' }}>🔔 レイド通知設定</div>
      <p style={{ fontSize: '12px', lineHeight: 1.7, color: '#88bbaa', margin: '0 0 10px' }}>
        ONにすると、レイドボスが出現する<b style={{ color: '#aaffdd' }}>毎日21時・22時</b>に、アプリを閉じていても端末へ通知が届きます。
      </p>
      {status === 'unsupported' && <p style={{ fontSize: '11px', color: '#cc9944', margin: '0 0 8px' }}>この端末／ブラウザは通知に対応していません。</p>}
      {status === 'notconfigured' && <p style={{ fontSize: '11px', color: '#cc9944', margin: '0 0 8px' }}>通知はまだ準備中です（サーバー設定待ち）。</p>}
      {status === 'denied' && <p style={{ fontSize: '11px', color: '#cc9944', margin: '0 0 8px' }}>通知がブロックされています。端末／ブラウザの設定で、このサイトの通知を「許可」にしてから開き直してください。</p>}
      {status === 'loading' && <p style={{ fontSize: '11px', color: '#557', margin: '0 0 8px' }}>…確認中</p>}
      {canToggle && (
        <button onClick={toggle} disabled={busy} style={{
          width: '100%', padding: '12px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer',
          fontFamily: 'monospace', fontSize: '13px',
          background: isOn ? '#0a3a2a' : '#0a1530', border: `1px solid ${isOn ? '#44ddaa' : '#446688'}`, color: isOn ? '#44ddaa' : '#88bbee',
        }}>
          {busy ? '…処理中' : isOn ? '✅ 通知ON（タップでOFF）' : '🔔 レイド通知をONにする'}
        </button>
      )}
      {msg && <p style={{ fontSize: '11px', color: '#9bd', marginTop: '8px', lineHeight: 1.6 }}>{msg}</p>}
      <p style={{ fontSize: '10px', color: '#557', marginTop: '10px', lineHeight: 1.6 }}>
        ※通知は端末ごとの設定です（スマホとPCで別々）。<br />
        ※iPhoneは「ホーム画面に追加」してアプリとして開いてからでないとONにできません（iOS16.4以降）。
      </p>
    </div>
  )
}

function RewardTable({ isAdmin = false }) {
  return (
    <div style={{ border: '1px solid #112233', background: '#000810', padding: '14px', marginTop: '16px' }}>
      <div style={{ color: '#335566', fontSize: '11px', marginBottom: '8px' }}>討伐報酬</div>
      {TIER_INFO.map(t => (
        <div key={t.pct} style={{ fontSize: '11px', padding: '4px 0', borderBottom: '1px solid #0a1220' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: t.color }}>{t.tier}ティア　{t.attacks > 0 ? `貢献度${t.pct}%以上 or 出撃${tierAttacks(t, isAdmin)}回` : t.label}</span>
            <span style={{ color: '#ffcc00' }}>Gold {fmt(t.gold)}</span>
          </div>
          <div style={{ color: '#446688', marginTop: '2px' }}>
            強化石{t.stones.map(s=>`(${s})`).join('・')}×2　宝石{t.gemRank}×{t.gemCount}　通常素材×{t.scaleCount}{t.tier !== 'D' ? `　レア素材${t.rareChance}` : ''}{t.book ? `　匠の秘伝書${t.book}×1` : ''}
          </div>
        </div>
      ))}
      <div style={{ color: '#ffdd44', fontSize: '10px', marginTop: '8px', lineHeight: 1.7 }}>
        🏅 与ダメージ上位3名には追加報酬（tier報酬とは別途）: 1位 Gold+100,000＋匠の秘伝書Ⅴ / 2位 Gold+100,000＋匠の秘伝書Ⅳ / 3位 Gold+100,000＋匠の秘伝書Ⅲ
      </div>
      <div style={{ color: '#334455', fontSize: '10px', marginTop: '6px' }}>※ 出撃回数でもティア保証: {tierAttacks(TIER_INFO[2], isAdmin)}回→C / {tierAttacks(TIER_INFO[1], isAdmin)}回→B / {tierAttacks(TIER_INFO[0], isAdmin)}回→A。時間切れでもその時点の報酬を獲得可</div>
      <div style={{ color: '#446655', fontSize: '10px', marginTop: '4px', lineHeight: 1.7 }}>※ 討伐支援: 出現から25分経過（残り5分）以降は与ダメージ制限が緩和され討伐しやすくなります。ただしこの間に与えたダメージはランキング（貢献度・与ダメ順位）には加算されません。</div>
    </div>
  )
}
