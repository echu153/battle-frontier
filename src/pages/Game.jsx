import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const WAIT_SECONDS = 10
const REGEN_SECONDS = 60

const ARTIFACT_BASE_NAMES = [
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたハンマー'
]

const AREAS = [
  {
    id: 1, name: '始まりの森',
    enemies: [
      { name:'スライム',   hp:30,  atk:8,   def:3,  matk:0,  mdef:3,  spd:3,  type:'physical', gold:5  },
      { name:'コウモリ',   hp:37,  atk:10,  def:3,  matk:0,  mdef:3,  spd:15, type:'physical', gold:6  },
      { name:'毒キノコ',   hp:60,  atk:3,   def:4,  matk:12, mdef:7,  spd:2,  type:'magical',  gold:8  },
    ],
    boss: { name:'ビッグスライム', hp:500, atk:28, def:22, matk:5, mdef:12, spd:8, gold:100, isBoss:true, type:'physical' },
    commonDrops: ['木の盾','木の靴','粗悪な布','粗悪な鎧','粗悪な指輪','粗悪なピアス','ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書'],
    rareDrops: ['ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書'],
    bossDrops: ['スライムの指輪','蒼粘剣'],
    bossRareDrops: [],
  },
  {
    id: 2, name: '荒廃した草原',
    enemies: [
      { name:'ゴブリン',   hp:160, atk:35,  def:16, matk:0,  mdef:10, spd:10, type:'physical', gold:20 },
      { name:'野良犬',     hp:200, atk:45,  def:20, matk:0,  mdef:10, spd:20, type:'physical', gold:25 },
      { name:'盗賊',       hp:240, atk:55,  def:24, matk:10, mdef:16, spd:12, type:'physical', gold:30 },
    ],
    boss: { name:'盗賊団のリーダー', hp:2000, atk:84, def:30, matk:20, mdef:22, spd:15, gold:500, isBoss:true, type:'physical' },
    commonDrops: ['ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書'],
    rareDrops: ['鋼鉄の剣','鋭利なナイフ','狩人の弓','魔導の杖','魔術教本'],
    bossDrops: ['略奪者の短剣','影踏みのブーツ'],
    bossRareDrops: [],
  },
  {
    id: 3, name: '古代の洞窟',
    enemies: [
      { name:'コボルト',   hp:400, atk:100, def:50, matk:0,  mdef:30, spd:12, type:'physical', gold:60  },
      { name:'スケルトン', hp:500, atk:120, def:60, matk:30, mdef:40, spd:10, type:'physical', gold:80  },
      { name:'ゴーレム',   hp:600, atk:150, def:80, matk:0,  mdef:40, spd:3,  type:'physical', gold:100 },
    ],
    boss: { name:'古代の番人', hp:8000, atk:210, def:80, matk:80, mdef:60, spd:10, gold:2000, isBoss:true, type:'magical' },
    commonDrops: [],
    rareDrops: [],
    bossDrops: [],
    bossRareDrops: [],
  },
]

const JOB_BASE = {
  '戦士':    { hp_max:80,  mp_max:10, atk:10, def:8,  matk:1,  mdef:3,  spd:5  },
  '弓使い':  { hp_max:60,  mp_max:15, atk:8,  def:4,  matk:2,  mdef:3,  spd:10 },
  '魔法使い':{ hp_max:45,  mp_max:50, atk:2,  def:2,  matk:14, mdef:4,  spd:4  },
  '僧侶':    { hp_max:55,  mp_max:45, atk:2,  def:3,  matk:7,  mdef:12, spd:3  },
  '侍':      { hp_max:100, mp_max:15, atk:13, def:10, matk:4,  mdef:4,  spd:8  },
  '狂戦士':  { hp_max:110, mp_max:10, atk:16, def:8,  matk:4,  mdef:4,  spd:4  },
  '狩人':    { hp_max:80,  mp_max:20, atk:13, def:6,  matk:4,  mdef:4,  spd:13 },
  '暗殺者':  { hp_max:70,  mp_max:20, atk:10, def:4,  matk:4,  mdef:4,  spd:18 },
  '元素使い':{ hp_max:55,  mp_max:70, atk:5,  def:2,  matk:17, mdef:5,  spd:4  },
  '死霊使い':{ hp_max:60,  mp_max:80, atk:4,  def:4,  matk:12, mdef:4,  spd:8  },
  '司祭':    { hp_max:70,  mp_max:60, atk:4,  def:8,  matk:8,  mdef:12, spd:4  },
  '賢者':    { hp_max:60,  mp_max:65, atk:4,  def:4,  matk:12, mdef:16, spd:3  },
}

const JOB_GROWTH = {
  '戦士':    { hp:20, mp:5,  atk:2, def:2, matk:0, mdef:1, spd:1 },
  '弓使い':  { hp:15, mp:5,  atk:2, def:1, matk:0, mdef:1, spd:2 },
  '魔法使い':{ hp:10, mp:15, atk:0, def:1, matk:3, mdef:1, spd:1 },
  '僧侶':    { hp:15, mp:15, atk:0, def:1, matk:1, mdef:2, spd:1 },
  '侍':      { hp:20, mp:5,  atk:3, def:2, matk:0, mdef:1, spd:1 },
  '狂戦士':  { hp:20, mp:5,  atk:4, def:1, matk:0, mdef:0, spd:0 },
  '狩人':    { hp:10, mp:5,  atk:3, def:1, matk:0, mdef:0, spd:3 },
  '暗殺者':  { hp:10, mp:5,  atk:2, def:1, matk:0, mdef:0, spd:4 },
  '元素使い':{ hp:10, mp:10, atk:0, def:0, matk:4, mdef:1, spd:0 },
  '死霊使い':{ hp:10, mp:10, atk:0, def:0, matk:3, mdef:1, spd:2 },
  '司祭':    { hp:10, mp:10, atk:0, def:2, matk:1, mdef:3, spd:0 },
  '賢者':    { hp:10, mp:10, atk:0, def:1, matk:2, mdef:3, spd:0 },
}

const JOB_LEVEL3_BONUS = {
  '戦士':    ['matk'],
  '弓使い':  ['matk'],
  '魔法使い':['atk'],
  '僧侶':    ['atk'],
  '侍':      ['matk'],
  '狂戦士':  ['matk','mdef','spd'],
  '狩人':    ['matk','mdef'],
  '暗殺者':  ['matk','mdef'],
  '元素使い':['atk','def','spd'],
  '死霊使い':['atk','def'],
  '司祭':    ['atk','spd'],
  '賢者':    ['atk','spd'],
}

const INITIAL_CLASSES = ['戦士','弓使い','魔法使い','僧侶']
const ADVANCED_CLASSES = {
  '侍':      { requires:'戦士' },
  '狂戦士':  { requires:'戦士' },
  '狩人':    { requires:'弓使い' },
  '暗殺者':  { requires:'弓使い' },
  '元素使い':{ requires:'魔法使い' },
  '死霊使い':{ requires:'魔法使い' },
  '司祭':    { requires:'僧侶' },
  '賢者':    { requires:'僧侶' },
}

const STAT_LABELS = {
  hp:'HP (+10)', mp:'MP (+5)', atk:'攻撃力 (+1)', def:'防御力 (+1)',
  matk:'特殊攻撃力 (+1)', mdef:'特殊防御力 (+1)', spd:'素早さ (+1)'
}

const getStatRank = (val, type) => {
  let thresholds
  if (type === 'hp') thresholds = [450, 1200, 2400, 4500, 7500, 12000, 18000, 27000]
  else if (type === 'mp') thresholds = [225, 600, 1200, 2250, 3750, 6000, 9000, 13500]
  else thresholds = [45, 120, 240, 450, 750, 1200, 1800, 2700]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (val <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank: 'SSS', color: '#ffcc00' }
}

const calcTotal = (p) => Math.floor(
  (p.hp_max / 10) + (p.mp_max / 5) +
  p.atk + p.def + p.matk + p.mdef + p.spd
)

const getTotalRank = (total) => {
  const thresholds = [200, 500, 1000, 2000, 4000, 7000, 11000, 16000]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (total <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank: 'SSS', color: '#ffcc00' }
}

const calcExpNext = (lv) => {
  const tier = Math.floor((lv - 1) / 10)
  return 100 + tier * 10
}

const WEAPON_TYPE_GROUP = {
  sword:'physical', axe:'physical', spear:'physical', bow:'physical',
  staff:'magical', wand:'magical', tome:'magical',
}
const getWeaponGroup = (weaponType) => WEAPON_TYPE_GROUP[weaponType] || 'physical'

const getProfPrefix = (profLv) => {
  if (profLv >= 300) return '【極】'
  if (profLv >= 200) return '【真】'
  if (profLv >= 100) return '【改】'
  return ''
}

const calcProfBonus = (prof, weapon) => {
  if (!prof || !weapon) return {}
  const profLv = prof.prof_lv || 1
  const bonuses = {
    atk:  weapon.atk_bonus  || 0,
    def:  weapon.def_bonus  || 0,
    matk: weapon.matk_bonus || 0,
    mdef: weapon.mdef_bonus || 0,
    spd:  weapon.spd_bonus  || 0,
  }
  let multiplier = 1
  if (profLv >= 300) multiplier = 4
  else if (profLv >= 200) multiplier = 3
  else if (profLv >= 100) multiplier = 2
  const scaledBonuses = {}
  for (const [k, v] of Object.entries(bonuses)) {
    scaledBonuses[k] = v * multiplier
  }
  const pctBonus = Math.floor(profLv / 10)
  const fixedBonuses = Object.entries(scaledBonuses).filter(([, v]) => v > 0)
  if (fixedBonuses.length > 0 && pctBonus > 0) {
    const maxVal = Math.max(...fixedBonuses.map(([, v]) => v))
    const maxKeys = fixedBonuses.filter(([, v]) => v === maxVal).map(([k]) => k)
    const targetKey = maxKeys[Math.floor(Math.random() * maxKeys.length)]
    scaledBonuses[targetKey] = Math.floor(scaledBonuses[targetKey] * (1 + pctBonus / 100))
  }
  const result = {}
  for (const [k, v] of Object.entries(scaledBonuses)) {
    if (v > 0) result[k] = v
  }
  return result
}

const calcEffectiveStats = (profile, equipment, proficiency) => {
  const bonus = { atk:0, def:0, matk:0, mdef:0, spd:0, hp:0, mp:0 }
  for (const item of equipment) {
    if (!item.equipped || !item.weapons) continue
    const w = item.weapons
    bonus.atk  += (w.atk_bonus  || 0) + (item.bonus_atk  || 0)
    bonus.def  += (w.def_bonus  || 0) + (item.bonus_def  || 0)
    bonus.matk += (w.matk_bonus || 0) + (item.bonus_matk || 0)
    bonus.mdef += (w.mdef_bonus || 0) + (item.bonus_mdef || 0)
    bonus.spd  += (w.spd_bonus  || 0) + (item.bonus_spd  || 0)
    bonus.hp   += (w.hp_bonus   || 0) + (item.bonus_hp   || 0)
    bonus.mp   += (w.mp_bonus   || 0) + (item.bonus_mp   || 0)
    if (w.hp_bonus_pct > 0) bonus.hp += Math.floor(profile.hp_max * w.hp_bonus_pct / 100)
    if (w.mp_bonus_pct > 0) bonus.mp += Math.floor(profile.mp_max * w.mp_bonus_pct / 100)
    if (w.spd_bonus_pct > 0) bonus.spd += Math.floor(profile.spd * w.spd_bonus_pct / 100)
    if (item.slot === 'weapon') {
      const prof = proficiency.find(p => p.weapon_id === w.id)
      if (prof) {
        const pb = calcProfBonus(prof, w)
        bonus.atk  += pb.atk  || 0
        bonus.def  += pb.def  || 0
        bonus.matk += pb.matk || 0
        bonus.mdef += pb.mdef || 0
        bonus.spd  += pb.spd  || 0
      }
    }
  }
  return {
    atk:    profile.atk  + bonus.atk,
    def:    profile.def  + bonus.def,
    matk:   profile.matk + bonus.matk,
    mdef:   profile.mdef + bonus.mdef,
    spd:    profile.spd  + bonus.spd,
    hp_max: profile.hp_max + bonus.hp,
    mp_max: profile.mp_max + bonus.mp,
    bonus,
  }
}

const calcClassStats = (className, lv) => {
  const base = JOB_BASE[className]
  const growth = JOB_GROWTH[className]
  if (!base || !growth) return null
  const bonusSlots = JOB_LEVEL3_BONUS[className] || []
  let stats = { ...base }
  for (let i = 1; i < lv; i++) {
    stats.hp_max += growth.hp
    stats.mp_max += growth.mp
    stats.atk    += growth.atk
    stats.def    += growth.def
    stats.matk   += growth.matk
    stats.mdef   += growth.mdef
    stats.spd    += growth.spd
    if (i % 3 === 0 && bonusSlots.length > 0) {
      const bonusIndex = Math.floor(i / 3 - 1) % bonusSlots.length
      stats[bonusSlots[bonusIndex]] += 1
    }
  }
  return stats
}

const calcExtraActionRate = (mySpd, enemySpd) => {
  if (mySpd <= enemySpd) return 0
  const diff = mySpd - enemySpd
  const rawRate = (diff / enemySpd) * 50
  if (rawRate <= 50) return rawRate
  return 50 + (rawRate - 50) * 0.5
}

// クリティカル確率計算
const calcCritRate = (mySpd, enemySpd) => {
  const base = 100 / 24
  if (mySpd <= enemySpd) return base
  const bonus = Math.min(5, (mySpd - enemySpd) / enemySpd * 2 * 100)
  return base + bonus
}

// レアリティ別ボーナス数
const RARITY_BONUS_COUNT = { common: 1, rare: 2, epic: 3, legendary: 4 }

// ランダムボーナス生成
const generateDropBonus = (weapon) => {
  const statKeys = ['atk_bonus','def_bonus','matk_bonus','mdef_bonus','spd_bonus','hp_bonus','mp_bonus']
  const eligible = statKeys.filter(k => (weapon[k] || 0) > 0)
  if (eligible.length === 0) return {}

  const bonusCount = RARITY_BONUS_COUNT[weapon.rarity] || 1
  const result = {}

  // アーティファクト系はボーナスなし（古びた系のみ）
  if (ARTIFACT_BASE_NAMES.includes(weapon.name)) return {}

  for (let i = 0; i < bonusCount; i++) {
    const isSpecial = Math.random() < 0.1
    if (isSpecial && i === 0) {
      const effects = [
        'open_atk_10_2t','open_atk_20_1t','open_def_10_2t','open_def_20_1t',
        'open_matk_10_2t','open_matk_20_1t','open_mdef_10_2t','open_mdef_20_1t',
        'open_spd_10_2t','open_spd_20_1t','delay_heal_10','regen_heal_5_3t',
      ]
      result.bonus_effect = effects[Math.floor(Math.random() * effects.length)]
    } else {
      const targetKey = eligible[Math.floor(Math.random() * eligible.length)]
      const baseVal = weapon[targetKey] || 0
      const maxBonus = Math.max(1, Math.floor(baseVal * 0.5))
      const bonusVal = Math.floor(Math.random() * maxBonus) + 1
      const bonusMap = {
        atk_bonus:  'bonus_atk',
        def_bonus:  'bonus_def',
        matk_bonus: 'bonus_matk',
        mdef_bonus: 'bonus_mdef',
        spd_bonus:  'bonus_spd',
        hp_bonus:   'bonus_hp',
        mp_bonus:   'bonus_mp',
      }
      const bonusKey = bonusMap[targetKey]
      result[bonusKey] = (result[bonusKey] || 0) + bonusVal
    }
  }
  return result
}

const getEffectLabel = (effect) => {
  const labels = {
    'open_atk_10_2t':  '【開幕2T・攻撃力+10%】',
    'open_atk_20_1t':  '【開幕1T・攻撃力+20%】',
    'open_def_10_2t':  '【開幕2T・防御力+10%】',
    'open_def_20_1t':  '【開幕1T・防御力+20%】',
    'open_matk_10_2t': '【開幕2T・特殊攻撃力+10%】',
    'open_matk_20_1t': '【開幕1T・特殊攻撃力+20%】',
    'open_mdef_10_2t': '【開幕2T・特殊防御力+10%】',
    'open_mdef_20_1t': '【開幕1T・特殊防御力+20%】',
    'open_spd_10_2t':  '【開幕2T・素早さ+10%】',
    'open_spd_20_1t':  '【開幕1T・素早さ+20%】',
    'delay_heal_10':   '【3T後・HP10%回復】',
    'regen_heal_5_3t': '【開幕3T・毎T HP5%回復】',
    'artifact':        '【消費MP2倍・与ダメージ1.2倍】',
  }
  return labels[effect] || effect
}

const applyEquipmentEffects = (equipment, profile, playerBuffs, logs) => {
  const newBuffs = { ...playerBuffs }
  for (const item of equipment) {
    if (!item.equipped || !item.bonus_effect) continue
    const effect = item.bonus_effect
    if (effect === 'open_atk_10_2t')  { newBuffs.atkUp  = { turns: 2, rate: 1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間攻撃力+10%！`, color:'#ffcc00' }) }
    if (effect === 'open_atk_20_1t')  { newBuffs.atkUp  = { turns: 1, rate: 1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間攻撃力+20%！`, color:'#ffcc00' }) }
    if (effect === 'open_def_10_2t')  { newBuffs.defUp  = { turns: 2, rate: 1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間防御力+10%！`, color:'#88aaff' }) }
    if (effect === 'open_def_20_1t')  { newBuffs.defUp  = { turns: 1, rate: 1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間防御力+20%！`, color:'#88aaff' }) }
    if (effect === 'open_matk_10_2t') { newBuffs.matkUp = { turns: 2, rate: 1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間特殊攻撃力+10%！`, color:'#cc44ff' }) }
    if (effect === 'open_matk_20_1t') { newBuffs.matkUp = { turns: 1, rate: 1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間特殊攻撃力+20%！`, color:'#cc44ff' }) }
    if (effect === 'open_mdef_10_2t') { newBuffs.mdefUp = { turns: 2, rate: 1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間特殊防御力+10%！`, color:'#44ccff' }) }
    if (effect === 'open_mdef_20_1t') { newBuffs.mdefUp = { turns: 1, rate: 1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間特殊防御力+20%！`, color:'#44ccff' }) }
    if (effect === 'open_spd_10_2t')  { newBuffs.spdUp  = { turns: 2, rate: 1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間素早さ+10%！`, color:'#ff8844' }) }
    if (effect === 'open_spd_20_1t')  { newBuffs.spdUp  = { turns: 1, rate: 1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間素早さ+20%！`, color:'#ff8844' }) }
    if (effect === 'regen_heal_5_3t') { newBuffs.regenHeal = { turns: 3, amount: Math.floor(profile.hp_max * 0.05) }; logs.push({ text:`✨ 装備効果発動！ 3ターンの間毎ターンHP5%回復！`, color:'#44ff88' }) }
    if (effect === 'delay_heal_10')   { newBuffs.delayHeal = { triggerTurn: 3, amount: Math.floor(profile.hp_max * 0.1) }; logs.push({ text:`✨ 装備効果発動！ 3ターン後にHP10%回復！`, color:'#44ff88' }) }
  }
  return newBuffs
}

const executeSkill = (skill, eff, profile, enemy, enemyBuffs, playerBuffs, isArtifact) => {
  const result = { dmg: 0, heal: 0, log: '', newEnemyBuffs: { ...enemyBuffs }, newPlayerBuffs: { ...playerBuffs } }
  const randMult = (min, max) => min + Math.random() * (max - min)
  const artifactMult = isArtifact ? 1.2 : 1.0
  switch (skill.name) {
    case '体当たり': result.dmg = Math.floor(eff.atk * randMult(1.1, 1.2) * artifactMult); result.log = `⚔ 体当たり！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '強撃': result.dmg = Math.floor(eff.atk * randMult(1.3, 1.4) * artifactMult); result.log = `💥 強撃！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '防御崩し': result.dmg = Math.floor(eff.atk * 1.2 * artifactMult); result.newEnemyBuffs.defDown = { turns: 4, rate: 0.8 }; result.log = `🗡 防御崩し！ ${enemy.name}に${result.dmg}ダメージ！ 防御力が低下した！`; break
    case '防御態勢': result.newPlayerBuffs.defUp = { turns: 4, rate: 1.5 }; result.log = `🛡 防御態勢！ 4ターンの間防御力と特殊防御力が上昇した！`; break
    case '応急手当': result.heal = Math.floor(eff.matk * randMult(1.1, 1.2)); result.log = `💊 応急手当！ HPを${result.heal}回復した！`; break
    case '狙撃': result.dmg = Math.floor(eff.spd * randMult(1.1, 1.2) * artifactMult); result.log = `🏹 狙撃！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '駆け足': result.newPlayerBuffs.spdUp = { turns: 5, rate: 1.5 }; result.log = `💨 駆け足！ 5ターンの間素早さが上昇した！`; break
    case '貫通射撃': result.dmg = Math.floor(eff.atk * randMult(1.2, 1.3) * artifactMult); result.log = `🏹 貫通射撃！ ${enemy.name}の防御を貫いて${result.dmg}ダメージ！`; break
    case '疾風矢': result.dmg = Math.floor((eff.atk * 1.0 + eff.spd * 0.4) * artifactMult); result.log = `💨 疾風矢！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case 'ファイア': result.dmg = Math.floor(eff.matk * randMult(1.3, 1.5) * artifactMult); result.log = `🔥 ファイア！ ${enemy.name}に${result.dmg}の魔法ダメージ！`; break
    case '精神統一': result.newPlayerBuffs.matkUp = { turns: 5, rate: 1.5 }; result.log = `✨ 精神統一！ 5ターンの間特殊攻撃力が上昇した！`; break
    case 'サンダー': result.dmg = Math.floor(eff.matk * randMult(1.4, 1.6) * artifactMult); result.log = `⚡ サンダー！ ${enemy.name}に${result.dmg}の魔法ダメージ！`; break
    case 'アイスランス': result.dmg = Math.floor(eff.matk * randMult(1.6, 1.9) * artifactMult); result.log = `❄ アイスランス！ ${enemy.name}に${result.dmg}の魔法ダメージ！`; break
    case 'ライト': result.dmg = Math.floor(eff.matk * randMult(1.3, 1.5) * artifactMult); result.log = `✨ ライト！ ${enemy.name}に${result.dmg}の魔法ダメージ！`; break
    case 'ヒール': result.heal = Math.floor(profile.hp_max * 0.1 + eff.matk * randMult(1.1, 1.2)); result.log = `💚 ヒール！ HPを${result.heal}回復した！`; break
    case 'プロテク': result.newPlayerBuffs.defUp = { turns: 3, rate: 1.6 }; result.log = `🛡 プロテク！ 3ターンの間防御力と特殊防御力が上昇した！`; break
    case '祈祷': result.newPlayerBuffs.regenHeal = { turns: 4, amount: Math.floor(profile.hp_max * 0.1) }; result.log = `🙏 祈祷！ 4ターンの間毎ターンHPが回復するようになった！`; break
    case 'ライトニング': result.dmg = Math.floor(eff.matk * randMult(1.5, 1.7) * artifactMult); result.newEnemyBuffs.mdefDown = { turns: 3, rate: 0.7 }; result.log = `⚡ ライトニング！ ${enemy.name}に${result.dmg}の魔法ダメージ！ 特殊防御力が低下した！`; break
    default: result.dmg = Math.max(1, eff.atk * artifactMult); result.log = `攻撃！ ${enemy.name}に${result.dmg}ダメージ！`
  }
  return result
}

export default function Game() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const [canAct, setCanAct] = useState(false)
  const [scene, setScene] = useState('town')
  const [battleLogs, setBattleLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [pendingPoints, setPendingPoints] = useState(0)
  const [statPoints, setStatPoints] = useState({})
  const [showStatPanel, setShowStatPanel] = useState(false)
  const [selectedArea, setSelectedArea] = useState(1)
  const [regenRemaining, setRegenRemaining] = useState(0)
  const [innMessage, setInnMessage] = useState('')
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [classLevels, setClassLevels] = useState([])
  const [templeMessage, setTempleMessage] = useState('')
  const [skillSets, setSkillSets] = useState([])
  const [playerItem, setPlayerItem] = useState(null)

  useEffect(() => { fetchProfile() }, [])

  useEffect(() => {
    if (!profile) return
    const id = setInterval(() => {
      const elapsed = (Date.now() - new Date(profile.last_action_at).getTime()) / 1000
      const rem = Math.max(0, WAIT_SECONDS - elapsed)
      setRemaining(rem)
      setCanAct(rem === 0)
      const regenElapsed = (Date.now() - new Date(profile.last_regen_at).getTime()) / 1000
      const regenRem = Math.max(0, REGEN_SECONDS - regenElapsed)
      setRegenRemaining(regenRem)
      if (regenRem === 0) doRegen()
    }, 200)
    return () => clearInterval(id)
  }, [profile])

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!data) { nav('/create'); return }
    setProfile(data)
    setPendingPoints(data.pending_stat_points || 0)
    const unlocked = data.unlocked_areas || [1]
    if (!unlocked.includes(selectedArea)) setSelectedArea(unlocked[0])
    const { data: eq } = await supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id)
    setEquipment(eq || [])
    const { data: prof } = await supabase.from('proficiency').select('*, weapons(*)').eq('player_id', user.id)
    setProficiency(prof || [])
    const { data: cl } = await supabase.from('class_levels').select('*').eq('player_id', user.id)
    setClassLevels(cl || [])
    const { data: ss } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', user.id).order('slot_order')
    setSkillSets(ss || [])
    const { data: pi } = await supabase.from('player_items').select('*, items(*)').eq('player_id', user.id).eq('equipped', true).single()
    setPlayerItem(pi || null)
  }

  const doRegen = async () => {
    if (!profile) return
    const current = profile.hp_current ?? profile.hp_max
    const newHp = Math.min(profile.hp_max, Math.floor(current + profile.hp_max * 0.2))
    const newMp = Math.min(profile.mp_max, Math.floor((profile.mp_current ?? profile.mp_max) + profile.mp_max * 0.2))
    const newIsDying = newHp >= profile.hp_max ? false : profile.is_dying
    await supabase.from('profiles').update({
      hp_current: newHp, mp_current: newMp,
      is_dying: newIsDying,
      last_regen_at: new Date().toISOString(),
    }).eq('id', profile.id)
    await fetchProfile()
  }

  const doChangeClass = async (targetClass) => {
    setLoading(true)
    setTempleMessage('')
    const currentClassData = classLevels.find(cl => cl.class_name === profile.class)
    if (currentClassData) {
      await supabase.from('class_levels').update({ lv: profile.lv, exp: profile.exp }).eq('id', currentClassData.id)
    }
    const targetClassData = classLevels.find(cl => cl.class_name === targetClass)
    const targetLv = targetClassData ? targetClassData.lv : 1
    const targetExp = targetClassData ? targetClassData.exp : 0
    const newStats = calcClassStats(targetClass, targetLv)
    if (!newStats) { setLoading(false); return }
    if (!targetClassData) {
      await supabase.from('class_levels').insert({ player_id: profile.id, class_name: targetClass, lv: 1, exp: 0 })
    }
    await supabase.from('profiles').update({
      class: targetClass, lv: targetLv, exp: targetExp,
      exp_next: calcExpNext(targetLv),
      hp_max: newStats.hp_max, mp_max: newStats.mp_max,
      hp_current: newStats.hp_max, mp_current: newStats.mp_max,
      atk: newStats.atk, def: newStats.def, matk: newStats.matk, mdef: newStats.mdef, spd: newStats.spd,
      is_dying: false,
    }).eq('id', profile.id)
    await fetchProfile()
    setTempleMessage(`${targetClass}に転職しました！`)
    setLoading(false)
  }

  const doBattle = async () => {
    if (!canAct || loading) return
    const hpCurrent = profile.hp_current ?? profile.hp_max
    if (hpCurrent <= 0) return
    if (profile.is_dying && hpCurrent < profile.hp_max) return
    setLoading(true)
    setScene('battle')
    setBattleLogs([])

    const eff = calcEffectiveStats(profile, equipment, proficiency)
    const area = AREAS.find(a => a.id === selectedArea)
    const bossRate = profile.boss_encounter_rate || 0
    const isBossEncounter = Math.random() * 100 < bossRate
    const enemy = isBossEncounter ? { ...area.boss } : { ...area.enemies[Math.floor(Math.random() * area.enemies.length)] }

    const logs = []
    let playerHp = hpCurrent
    let playerMp = profile.mp_current ?? profile.mp_max
    let enemyHp = enemy.hp
    let turn = 1
    let skillIndex = 0
    let playerBuffs = {}
    let enemyBuffs = {}
    let currentItem = playerItem ? { ...playerItem } : null
    let itemUsed = false

    // アーティファクト武器チェック
    const equippedWeaponItem = equipment.find(e => e.slot === 'weapon' && e.equipped)
    const isArtifact = equippedWeaponItem?.bonus_effect === 'artifact'

    if (isBossEncounter && currentItem && currentItem.items.effect === 'boss_avoid') {
      logs.push({ text:`🧿 魔よけのお守りが光り、ボスとの戦闘を避けた！`, color:'#cc44ff' })
      setBattleLogs([...logs])
      await supabase.from('player_items').delete().eq('id', currentItem.id)
      await supabase.from('profiles').update({ boss_encounter_rate: 0, last_action_at: new Date().toISOString() }).eq('id', profile.id)
      await fetchProfile()
      setLoading(false)
      return
    }

    if (isBossEncounter) {
      logs.push({ text:`⚠ ボス出現！ ${enemy.name}が現れた！`, color:'#ff4444' })
    } else {
      logs.push({ text:`${enemy.name}が現れた！`, color:'#88ccff' })
    }

    if (isArtifact) {
      logs.push({ text:`⚔ アーティファクト発動！ 消費MP2倍・与ダメージ1.2倍！`, color:'#ffcc00' })
    }

    playerBuffs = applyEquipmentEffects(equipment, profile, playerBuffs, logs)

    const weaponType = equippedWeaponItem?.weapons?.weapon_type || 'sword'
    const isMagical = getWeaponGroup(weaponType) === 'magical'

    const expandedSkillSet = []
    for (const ss of skillSets) {
      const count = ss.use_count || 1
      for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
    }

    const playerSpd = eff.spd
    const enemySpd = enemy.spd || 5
    const playerExtraRate = calcExtraActionRate(playerSpd, enemySpd)
    const enemyExtraRate = calcExtraActionRate(enemySpd, playerSpd)
    const playerCritRate = calcCritRate(playerSpd, enemySpd)
    const enemyCritRate = calcCritRate(enemySpd, playerSpd)

    const doPlayerAttack = (isExtra = false) => {
      const playerDef  = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1)
      const playerMdef = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1)
      const playerMatk = eff.matk * (playerBuffs.matkUp ? playerBuffs.matkUp.rate : 1)
      const playerAtkBuff = eff.atk * (playerBuffs.atkUp ? playerBuffs.atkUp.rate : 1)
      const playerSpdBuff = eff.spd * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1)
      const effWithBuff = { ...eff, atk: playerAtkBuff, def: playerDef, mdef: playerMdef, matk: playerMatk, spd: playerSpdBuff }
      const enemyDefRate  = enemyBuffs.defDown  ? enemyBuffs.defDown.rate  : 1
      const enemyMdefRate = enemyBuffs.mdefDown ? enemyBuffs.mdefDown.rate : 1
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
      const isCrit = Math.random() * 100 < playerCritRate
      const critMult = isCrit ? 1.5 : 1.0

      let skillUsed = false
      if (expandedSkillSet.length > 0) {
        const currentSkill = expandedSkillSet[skillIndex % expandedSkillSet.length]
        const mpCost = isArtifact ? (currentSkill?.skills?.mp_cost || 0) * 2 : (currentSkill?.skills?.mp_cost || 0)
        if (currentSkill && currentSkill.skills && playerMp >= mpCost) {
          playerMp -= mpCost
          const result = executeSkill(currentSkill.skills, effWithBuff, profile, enemy, enemyBuffs, playerBuffs, isArtifact)
          const finalDmg = Math.floor(result.dmg * critMult)
          enemyHp -= finalDmg
          playerHp = Math.min(profile.hp_max, playerHp + result.heal)
          playerBuffs = result.newPlayerBuffs
          enemyBuffs = result.newEnemyBuffs
          const critText = isCrit ? ' 💥クリティカル！' : ''
          logs.push({ text:`${prefix}${result.log}${critText}`, color: isCrit ? '#ff4444' : '#88ccff' })
          skillUsed = true
          skillIndex++
        }
      }
      if (!skillUsed) {
        const baseAtk = isMagical ? effWithBuff.matk : effWithBuff.atk
        const enemyDefVal = isMagical
          ? Math.floor((enemy.mdef || 0) / 2 * enemyMdefRate)
          : Math.floor(enemy.def / 2 * enemyDefRate)
        const baseDmg = Math.max(1, baseAtk - enemyDefVal + Math.floor(Math.random() * 4))
        const finalDmg = Math.floor(baseDmg * critMult * (isArtifact ? 1.2 : 1.0))
        enemyHp -= finalDmg
        const critText = isCrit ? ' 💥クリティカル！' : ''
        logs.push({ text:`${prefix}あなたの攻撃！ ${enemy.name}に${finalDmg}ダメージ！${critText}`, color: isCrit ? '#ff4444' : '#ffcc00' })
        if (expandedSkillSet.length > 0) skillIndex++
      }
    }

    const doEnemyAttack = (isExtra = false) => {
      const playerDef  = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1)
      const playerMdef = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1)
      const isEnemyMagical = enemy.type === 'magical'
      const enemyAtk = isEnemyMagical ? (enemy.matk || 0) : enemy.atk
      const defVal = isEnemyMagical ? Math.floor(playerMdef / 2) : Math.floor(playerDef / 2)
      const isCrit = Math.random() * 100 < enemyCritRate
      const baseDmg = Math.max(1, enemyAtk - defVal + Math.floor(Math.random() * 3))
      const finalDmg = Math.floor(baseDmg * (isCrit ? 1.5 : 1.0))
      playerHp -= finalDmg
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
      const critText = isCrit ? ' 💥クリティカル！' : ''
      logs.push({ text:`${prefix}${enemy.name}の攻撃！ あなたに${finalDmg}ダメージ…${critText}`, color: isCrit ? '#ff2200' : '#ff6644' })
    }

    while (playerHp > 0 && enemyHp > 0 && turn <= 50) {
      if (playerBuffs.regenHeal && playerBuffs.regenHeal.turns > 0) {
        playerHp = Math.min(profile.hp_max, playerHp + playerBuffs.regenHeal.amount)
        logs.push({ text:`💚 回復効果でHPが${playerBuffs.regenHeal.amount}回復した！`, color:'#44ff88' })
      }
      if (playerBuffs.delayHeal && turn === playerBuffs.delayHeal.triggerTurn) {
        playerHp = Math.min(profile.hp_max, playerHp + playerBuffs.delayHeal.amount)
        logs.push({ text:`💚 装備効果でHPが${playerBuffs.delayHeal.amount}回復した！`, color:'#44ff88' })
      }

      if (currentItem && !itemUsed) {
        const threshold = currentItem.use_threshold || 50
        const effect = currentItem.items.effect
        if (effect === 'hp_pct' && playerHp / profile.hp_max * 100 <= threshold) {
          const healAmt = Math.floor(profile.hp_max * currentItem.items.value / 100)
          playerHp = Math.min(profile.hp_max, playerHp + healAmt)
          logs.push({ text:`🧪 ${currentItem.items.name}を使用！ HPが${healAmt}回復した！`, color:'#44ff88' })
          itemUsed = true
          await supabase.from('player_items').delete().eq('id', currentItem.id)
          currentItem = null
        } else if (effect === 'mp_pct' && playerMp / profile.mp_max * 100 <= threshold) {
          const healAmt = Math.floor(profile.mp_max * currentItem.items.value / 100)
          playerMp = Math.min(profile.mp_max, playerMp + healAmt)
          logs.push({ text:`🧪 ${currentItem.items.name}を使用！ MPが${healAmt}回復した！`, color:'#4488ff' })
          itemUsed = true
          await supabase.from('player_items').delete().eq('id', currentItem.id)
          currentItem = null
        }
      }

      doPlayerAttack(false)
      if (enemyHp <= 0) break
      if (playerExtraRate > 0 && Math.random() * 100 < playerExtraRate) {
        doPlayerAttack(true)
        if (enemyHp <= 0) break
      }
      doEnemyAttack(false)
      if (playerHp <= 0) break
      if (enemyExtraRate > 0 && Math.random() * 100 < enemyExtraRate) {
        doEnemyAttack(true)
      }

      Object.keys(playerBuffs).forEach(k => { if (playerBuffs[k]?.turns > 0) playerBuffs[k].turns-- })
      Object.keys(enemyBuffs).forEach(k => { if (enemyBuffs[k]?.turns > 0) enemyBuffs[k].turns-- })
      turn++
    }

    playerHp = Math.max(0, playerHp)
    const win = enemyHp <= 0
    const expGained = isBossEncounter ? 13 : Math.floor(Math.random() * 4) + 8
    const goldGained = win ? (enemy.gold || 0) : 0

    if (win) {
      logs.push({ text:`${enemy.name}を倒した！`, color:'#44ff88' })
      logs.push({ text:`EXP + ${expGained}　Gold + ${goldGained}`, color:'#ffcc00' })
    } else {
      logs.push({ text:`敗北…`, color:'#ff4444' })
      logs.push({ text:`EXP + ${expGained}`, color:'#ff6644' })
    }

    let newIsDying = profile.is_dying || false
    if (playerHp === 0) {
      newIsDying = true
      logs.push({ text:`⚠ 瀕死状態！宿屋でHP全回復してください。`, color:'#ff4444' })
    }
    setBattleLogs(logs)

    // ドロップ処理
    if (win) {
      let droppedItems = []
      if (isBossEncounter) {
        const dropList = area.bossDrops || []
        if (dropList.length > 0) {
          const drop0 = Math.random() * 100 < 3
          const drop1 = dropList.length > 1 && Math.random() * 100 < 3
          if (drop0 && drop1) droppedItems = [dropList[Math.random() < 0.5 ? 0 : 1]]
          else if (drop0) droppedItems = [dropList[0]]
          else if (drop1) droppedItems = [dropList[1]]
        }
      } else {
        const commonDrops = area.commonDrops || []
        const rareDrops = area.rareDrops || []
        if (commonDrops.length > 0 && Math.random() * 100 < 3) {
          if (rareDrops.length > 0 && Math.random() * 100 < 10) {
            droppedItems = [rareDrops[Math.floor(Math.random() * rareDrops.length)]]
          } else {
            droppedItems = [commonDrops[Math.floor(Math.random() * commonDrops.length)]]
          }
        }
      }

      // アーティファクトドロップ（勝利時0.1%）
      if (Math.random() * 100 < 0.1) {
        const artifactName = ARTIFACT_BASE_NAMES[Math.floor(Math.random() * ARTIFACT_BASE_NAMES.length)]
        droppedItems.push(artifactName)
      }

      for (const itemName of droppedItems) {
        const { data: weapon } = await supabase.from('weapons').select('*').eq('name', itemName).single()
        if (weapon) {
          const isArtifactDrop = ARTIFACT_BASE_NAMES.includes(weapon.name)
          const bonusData = isArtifactDrop ? {} : generateDropBonus(weapon)
          await supabase.from('player_equipment').insert({
            player_id: profile.id, weapon_id: weapon.id, slot: weapon.slot, equipped: false,
            ...bonusData,
          })
          const isRare = area.rareDrops?.includes(itemName)
          const color = isArtifactDrop ? '#ffcc00' : isRare ? '#44ff88' : '#ffcc00'
          const prefix = isArtifactDrop ? '🌟' : isRare ? '💎✨' : '💎'
          logs.push({ text:`${prefix} ${itemName} を入手した！`, color })
        }
      }
    }
    setBattleLogs([...logs])

    // 熟練度更新
    if (equippedWeaponItem) {
      const prof = proficiency.find(p => p.weapon_id === equippedWeaponItem.weapons.id)
      if (prof) {
        const profExpGained = Math.floor(Math.random() * 4) + 8
        let totalExp = prof.prof_exp + profExpGained
        let newProfLv = prof.prof_lv
        while (totalExp >= 100) { totalExp -= 100; newProfLv++ }
        await supabase.from('proficiency').update({ prof_exp: totalExp, prof_lv: newProfLv }).eq('id', prof.id)
        if (newProfLv > prof.prof_lv) {
          const prefix = getProfPrefix(newProfLv)
          logs.push({ text:`⚔ 武器熟練度UP！ ${prefix}${equippedWeaponItem.weapons.name} LV${newProfLv}`, color:'#aa44ff' })
          setBattleLogs([...logs])
        }
      }
    }

    // スキル自動習得
    const { data: classSkills } = await supabase.from('skills').select('*').eq('class_name', profile.class)
    const { data: learnedSkills } = await supabase.from('player_skills').select('skill_id').eq('player_id', profile.id)
    const learnedIds = (learnedSkills || []).map(s => s.skill_id)
    const toLearn = (classSkills || []).filter(s => s.required_lv <= profile.lv && !learnedIds.includes(s.id))
    for (const skill of toLearn) {
      await supabase.from('player_skills').insert({ player_id: profile.id, skill_id: skill.id })
      logs.push({ text:`⚡ スキル「${skill.name}」を習得した！`, color:'#cc44ff' })
    }
    if (toLearn.length > 0) setBattleLogs([...logs])

    const newBossRate = isBossEncounter ? 0 : bossRate + 0.5
    let newUnlockedAreas = [...(profile.unlocked_areas || [1])]
    if (win && enemy.isBoss && !newUnlockedAreas.includes(selectedArea + 1)) {
      const nextArea = selectedArea + 1
      if (nextArea <= AREAS.length) {
        newUnlockedAreas.push(nextArea)
        logs.push({ text:`🎉 新エリア「${AREAS.find(a => a.id === nextArea)?.name}」が解放された！`, color:'#cc44ff' })
        setBattleLogs([...logs])
      }
    }

    let newExp = profile.exp + expGained
    let newGold = profile.gold + goldGained
    let newLv = profile.lv
    let newExpNext = profile.exp_next
    let newPendingPoints = profile.pending_stat_points || 0
    const growth = JOB_GROWTH[profile.class] || JOB_GROWTH['戦士']
    const bonusSlots = JOB_LEVEL3_BONUS[profile.class] || []
    let statUpdates = {}
    while (newExp >= newExpNext) {
      newExp -= newExpNext
      newLv++
      newExpNext = calcExpNext(newLv)
      newPendingPoints++
      const base = statUpdates
      statUpdates = {
        hp_max: (base.hp_max || profile.hp_max) + growth.hp,
        mp_max: (base.mp_max || profile.mp_max) + growth.mp,
        atk:    (base.atk    || profile.atk)    + growth.atk,
        def:    (base.def    || profile.def)    + growth.def,
        matk:   (base.matk   || profile.matk)   + growth.matk,
        mdef:   (base.mdef   || profile.mdef)   + growth.mdef,
        spd:    (base.spd    || profile.spd)    + growth.spd,
      }
      if (bonusSlots.length > 0 && newLv % 3 === 0) {
        const bonusIndex = Math.floor(newLv / 3 - 1) % bonusSlots.length
        statUpdates[bonusSlots[bonusIndex]] = (statUpdates[bonusSlots[bonusIndex]] || 0) + 1
      }
      logs.push({ text:`★ LEVEL UP！ LV${newLv} になった！ ステータスポイント+1`, color:'#cc44ff' })
      setBattleLogs([...logs])
    }

    await supabase.from('profiles').update({
      exp: newExp, exp_next: newExpNext, lv: newLv, gold: newGold,
      hp_current: playerHp, mp_current: playerMp,
      is_dying: newIsDying,
      boss_encounter_rate: newBossRate,
      unlocked_areas: newUnlockedAreas,
      pending_stat_points: newPendingPoints,
      last_action_at: new Date().toISOString(),
      ...statUpdates,
    }).eq('id', profile.id)
    await fetchProfile()
    setLoading(false)
  }

  const useInn = async () => {
    const isDying = profile.is_dying || false
    const normalCost = profile.lv * 2
    const dyingCost = profile.lv * 15
    const cost = isDying ? Math.min(dyingCost, profile.gold) : normalCost
    if (profile.gold < normalCost && !isDying) return
    await supabase.from('profiles').update({
      hp_current: profile.hp_max, mp_current: profile.mp_max,
      gold: profile.gold - cost, is_dying: false,
    }).eq('id', profile.id)
    await fetchProfile()
    setInnMessage('HPとMPが回復しました！')
    setTimeout(() => { setInnMessage(''); setScene('town') }, 1500)
  }

  const confirmStatPoints = async () => {
    const total = Object.values(statPoints).reduce((a, b) => a + b, 0)
    if (total !== pendingPoints) return
    const updates = {
      hp_max: profile.hp_max + (statPoints.hp || 0) * 10,
      mp_max: profile.mp_max + (statPoints.mp || 0) * 5,
      atk:    profile.atk   + (statPoints.atk  || 0),
      def:    profile.def   + (statPoints.def  || 0),
      matk:   profile.matk  + (statPoints.matk || 0),
      mdef:   profile.mdef  + (statPoints.mdef || 0),
      spd:    profile.spd   + (statPoints.spd  || 0),
      pending_stat_points: 0,
    }
    await supabase.from('profiles').update(updates).eq('id', profile.id)
    await fetchProfile()
    setPendingPoints(0)
    setStatPoints({})
    setShowStatPanel(false)
  }

  const backToTown = () => { setScene('town'); setBattleLogs([]) }
  const logout = async () => { await supabase.auth.signOut(); nav('/login') }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  const hpCurrent = Math.max(0, profile.hp_current ?? profile.hp_max)
  const mpCurrent = Math.max(0, profile.mp_current ?? profile.mp_max)
  const isDying = profile.is_dying || false
  const canBattle = !isDying || hpCurrent >= profile.hp_max
  const hpPct = Math.min(100, (hpCurrent / profile.hp_max) * 100)
  const mpPct = Math.min(100, (mpCurrent / profile.mp_max) * 100)
  const expPct = Math.min(100, (profile.exp / profile.exp_next) * 100)
  const timerPct = ((WAIT_SECONDS - remaining) / WAIT_SECONDS) * 100
  const regenPct = ((REGEN_SECONDS - regenRemaining) / REGEN_SECONDS) * 100
  const unlockedAreas = profile.unlocked_areas || [1]
  const availableAreas = AREAS.filter(a => unlockedAreas.includes(a.id))
  const innCost = isDying ? Math.min(profile.lv * 15, profile.gold) : profile.lv * 2
  const allocatedPoints = Object.values(statPoints).reduce((a, b) => a + b, 0)
  const total = calcTotal(profile)
  const eff = calcEffectiveStats(profile, equipment, proficiency)
  const totalRank = getTotalRank(total)
  const availableClasses = INITIAL_CLASSES.filter(c => c !== profile.class).map(c => {
    const cl = classLevels.find(x => x.class_name === c)
    return { name: c, lv: cl ? cl.lv : 1, canChange: profile.lv >= 30 }
  })
  const advancedAvailable = Object.entries(ADVANCED_CLASSES).map(([name, { requires }]) => {
    const reqCl = classLevels.find(x => x.class_name === requires)
    const reqLv = reqCl ? reqCl.lv : 0
    const cl = classLevels.find(x => x.class_name === name)
    return { name, lv: cl ? cl.lv : 1, canChange: reqLv >= 100 && profile.lv >= 30, requires, reqLv }
  })

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'900px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={() => nav('/equipment')} style={{ background:'none', border:'1px solid #44aaff', color:'#44aaff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🗡 装備</button>
            <button onClick={() => nav('/skills')} style={{ background:'none', border:'1px solid #cc44ff', color:'#cc44ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>⚡ スキル</button>
            <button onClick={() => nav('/profile')} style={{ background:'none', border:'1px solid #44ff88', color:'#44ff88', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>👤 プロフィール</button>
            <button onClick={() => nav('/ranking')} style={{ background:'none', border:'1px solid #ffcc00', color:'#ffcc00', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏆 ランキング</button>
            <button onClick={logout} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>ログアウト</button>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:'12px' }}>
          <div style={{ border:`1px solid ${isDying ? '#660000' : '#0044aa'}`, background:'#001040', padding:'10px', alignSelf:'start' }}>
            {isDying && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'8px', border:'1px solid #660000', padding:'4px', background:'#1a0000' }}>⚠ 瀕死状態　HP全回復まで出撃不可</div>}
            <div style={{ color:'#ffcc00', fontSize:'12px', borderBottom:'1px dashed #003366', paddingBottom:'4px', marginBottom:'8px' }}>{profile.username}</div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'2px' }}>クラス: <span style={{color:'#88ccff'}}>{profile.class}</span></div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'2px' }}>LV: <span style={{color:'#ffcc00'}}>{profile.lv}</span></div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'6px', display:'flex', justifyContent:'space-between' }}>
              <span>総合力: <span style={{color:'#44ff88', fontWeight:'bold'}}>{total}</span></span>
              <span style={{color: totalRank.color, fontWeight:'bold'}}>{totalRank.rank}</span>
            </div>
            <StatBar label="HP" val={`${hpCurrent}/${profile.hp_max}`} pct={hpPct} color={isDying ? '#ff2200' : '#00cc44'} />
            <StatBar label="MP" val={`${mpCurrent}/${profile.mp_max}`} pct={mpPct} color="#4488ff" />
            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginTop:'6px' }}>
              <span>経験値</span><span style={{color:'#cc8800'}}>{profile.exp}/{profile.exp_next}</span>
            </div>
            <div style={{ background:'#001028', height:'5px', border:'1px solid #002244', marginBottom:'4px' }}>
              <div style={{ height:'100%', width:`${expPct}%`, background:'linear-gradient(90deg,#331100,#cc8800)', transition:'width 0.4s' }} />
            </div>
            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'2px' }}>
              <span>自然回復まで</span>
              <span style={{color:'#44ccff'}}>{regenRemaining > 0 ? `${Math.ceil(regenRemaining)}秒` : '回復中...'}</span>
            </div>
            <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'8px' }}>
              <div style={{ height:'100%', width:`${regenPct}%`, background:'linear-gradient(90deg,#003333,#44ccff)', transition:'width 0.2s' }} />
            </div>
            <div style={{ fontSize:'11px', display:'grid', gridTemplateColumns:'1fr', gap:'2px', color:'#446688', marginBottom:'8px' }}>
              <StatLine label="攻撃力" base={profile.atk} bonus={eff.bonus.atk} color="#ffcc00" statType="atk" />
              <StatLine label="防御力" base={profile.def} bonus={eff.bonus.def} color="#88aaff" statType="def" />
              <StatLine label="特殊攻撃力" base={profile.matk} bonus={eff.bonus.matk} color="#cc44ff" statType="matk" />
              <StatLine label="特殊防御力" base={profile.mdef} bonus={eff.bonus.mdef} color="#44ccff" statType="mdef" />
              <StatLine label="素早さ" base={profile.spd} bonus={eff.bonus.spd} color="#ff8844" statType="spd" />
              <span>ゴールド: <span style={{color:'#ffcc00'}}>{profile.gold}</span></span>
            </div>
            {pendingPoints > 0 && (
              <button onClick={() => { setShowStatPanel(true); setStatPoints({ hp:0, mp:0, atk:0, def:0, matk:0, mdef:0, spd:0 }) }}
                style={{ width:'100%', padding:'6px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                ★ ステータスを振り分ける（{pendingPoints}pt）
              </button>
            )}
          </div>

          <div>
            {showStatPanel && (
              <div style={{ border:'1px solid #cc44ff', background:'#0a0020', padding:'12px', marginBottom:'8px' }}>
                <div style={{ color:'#cc44ff', fontSize:'13px', marginBottom:'6px' }}>ステータスポイント振り分け（残り {pendingPoints - allocatedPoints}pt）</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'10px' }}>
                  {Object.entries(STAT_LABELS).map(([stat, label]) => (
                    <div key={stat} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', border:`1px solid ${(statPoints[stat]||0) > 0 ? '#cc44ff' : '#003366'}`, background:(statPoints[stat]||0) > 0 ? '#1a0030' : '#000818', padding:'6px 8px' }}>
                      <span style={{ color:'#88ccff', fontSize:'10px' }}>{label}</span>
                      <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
                        <button onClick={() => { if ((statPoints[stat]||0) > 0) setStatPoints(p => ({ ...p, [stat]: p[stat] - 1 })) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>-</button>
                        <span style={{ color:'#cc44ff', fontSize:'11px', minWidth:'16px', textAlign:'center' }}>{statPoints[stat]||0}</span>
                        <button onClick={() => { if (allocatedPoints < pendingPoints) setStatPoints(p => ({ ...p, [stat]: (p[stat]||0) + 1 })) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', gap:'8px' }}>
                  <button onClick={() => setShowStatPanel(false)} style={{ flex:1, padding:'8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>後で振り分ける</button>
                  <button onClick={confirmStatPoints} disabled={allocatedPoints !== pendingPoints} style={{ flex:2, padding:'8px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', opacity: allocatedPoints !== pendingPoints ? 0.4 : 1 }}>決定する</button>
                </div>
              </div>
            )}

            {scene === 'town' && (
              <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', marginBottom:'8px' }}>
                <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'8px' }}>🏰 街</div>
                {isDying && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'10px', border:'1px solid #660000', padding:'8px', background:'#1a0000' }}>⚠ 瀕死状態です。宿屋でHP全回復してください。</div>}
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
                  <span style={{ color:'#446688' }}>次の行動まで</span>
                  <span style={{ color: canAct ? '#44ff88' : '#ffcc00' }}>{canAct ? '▶ 出撃可能！' : `${remaining.toFixed(1)}秒`}</span>
                </div>
                <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'12px' }}>
                  <div style={{ height:'100%', width:`${timerPct}%`, background: canAct ? '#44ff88' : 'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
                </div>
                <div style={{ marginBottom:'10px' }}>
                  <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>エリア選択</div>
                  <select value={selectedArea} onChange={e => setSelectedArea(Number(e.target.value))} style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'6px', fontFamily:'monospace', fontSize:'12px' }}>
                    {availableAreas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
                  </select>
                </div>
                <button onClick={doBattle} disabled={!canAct || loading || !canBattle}
                  style={{ width:'100%', padding:'12px', background:'#001840', border:`1px solid ${canAct && canBattle ? '#ffcc00' : '#003366'}`, color: canAct && canBattle ? '#ffcc00' : '#446688', cursor: canAct && canBattle ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'8px' }}>
                  {isDying && !canBattle ? '💀 瀕死中（HP全回復まで出撃不可）' : canAct ? `⚔ ${AREAS.find(a=>a.id===selectedArea)?.name}へ出撃！` : '⏳ 待機中...'}
                </button>
                <button onClick={() => { setScene('inn'); setInnMessage('') }} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #0088aa', color:'#00aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>🏨 宿屋へ</button>
                <button onClick={() => { setScene('temple'); setTempleMessage('') }} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ccaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>⛩ 神殿へ</button>
                <button onClick={() => nav('/shop')} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #44aa44', color:'#44aa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>🛒 商店へ</button>
                <button onClick={() => nav('/smithy')} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚒ 鍛冶屋へ</button>
              </div>
            )}

            {scene === 'inn' && (
              <div style={{ border:'1px solid #0088aa', background:'#001030', padding:'20px', textAlign:'center' }}>
                <div style={{ color:'#00aacc', fontSize:'14px', marginBottom:'16px' }}>🏨 宿屋</div>
                {innMessage ? (
                  <div style={{ color:'#44ff88', fontSize:'14px', padding:'20px' }}>{innMessage}</div>
                ) : (
                  <>
                    <div style={{ color:'#88ccff', fontSize:'12px', lineHeight:'2', marginBottom:'16px' }}>
                      {isDying ? <>これはひどいお姿で…。特別なお手当が必要でございます。<br/>
                        <span style={{color:'#ffcc00'}}>{profile.lv * 15}G</span> のところ、所持金 <span style={{color:'#ffcc00'}}>{innCost}G</span> で承ります。</>
                        : <>一泊 <span style={{color:'#ffcc00'}}>{innCost}G</span> でございます。<br/>ゆっくりお休みになりますか？</>}
                    </div>
                    <div style={{ color:'#446688', fontSize:'11px', marginBottom:'16px' }}>
                      所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span>
                      {!isDying && profile.gold < innCost && <span style={{color:'#ff4444'}}> （ゴールドが足りません）</span>}
                    </div>
                    <div style={{ display:'flex', gap:'8px' }}>
                      <button onClick={backToTown} style={{ flex:1, padding:'10px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>街に戻る</button>
                      <button onClick={useInn} disabled={!isDying && profile.gold < innCost}
                        style={{ flex:2, padding:'10px', background:'#001830', border:'1px solid #0088aa', color:'#00aacc', cursor: (!isDying && profile.gold < innCost) ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'12px', opacity: (!isDying && profile.gold < innCost) ? 0.4 : 1 }}>
                        利用する
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {scene === 'temple' && (
              <div style={{ border:'1px solid #886600', background:'#001020', padding:'16px' }}>
                <div style={{ color:'#ccaa00', fontSize:'14px', marginBottom:'4px' }}>⛩ 神殿</div>
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
                  現在のクラス: <span style={{color:'#88ccff'}}>{profile.class}</span> LV<span style={{color:'#ffcc00'}}>{profile.lv}</span>　（転職にはLV30以上が必要）
                </div>
                {templeMessage && <div style={{ color:'#44ff88', fontSize:'13px', textAlign:'center', padding:'10px', marginBottom:'12px', border:'1px solid #44ff88' }}>{templeMessage}</div>}
                <div style={{ color:'#ccaa00', fontSize:'11px', marginBottom:'6px' }}>── 初期職 ──</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'12px' }}>
                  {availableClasses.map(c => (
                    <div key={c.name} style={{ border:`1px solid ${c.canChange ? '#886600' : '#002244'}`, background:'#001028', padding:'8px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <div style={{ color: c.canChange ? '#ccaa00' : '#446688', fontSize:'12px' }}>{c.name}</div>
                          <div style={{ color:'#446688', fontSize:'10px' }}>LV {c.lv}</div>
                        </div>
                        <button onClick={() => doChangeClass(c.name)} disabled={!c.canChange || loading}
                          style={{ padding:'4px 8px', background: c.canChange ? '#1a1000' : '#001', border:`1px solid ${c.canChange ? '#886600' : '#002244'}`, color: c.canChange ? '#ccaa00' : '#334455', cursor: c.canChange ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>転職</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ color:'#ccaa00', fontSize:'11px', marginBottom:'6px' }}>── 上位職（初期職LV100で解放）──</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'12px' }}>
                  {advancedAvailable.map(c => (
                    <div key={c.name} style={{ border:`1px solid ${c.canChange ? '#664400' : '#002244'}`, background:'#001028', padding:'8px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div>
                          <div style={{ color: c.canChange ? '#ff8800' : '#446688', fontSize:'12px' }}>{c.name}</div>
                          <div style={{ color:'#446688', fontSize:'10px' }}>{c.requires} LV{c.reqLv}/100</div>
                        </div>
                        <button onClick={() => doChangeClass(c.name)} disabled={!c.canChange || loading}
                          style={{ padding:'4px 8px', background: c.canChange ? '#1a0800' : '#001', border:`1px solid ${c.canChange ? '#664400' : '#002244'}`, color: c.canChange ? '#ff8800' : '#334455', cursor: c.canChange ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'10px' }}>転職</button>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={backToTown} style={{ width:'100%', padding:'10px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>街に戻る</button>
              </div>
            )}

            {scene === 'battle' && (
              <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
                <div style={{ color:'#ff6644', fontSize:'13px', marginBottom:'10px' }}>⚔ バトル！</div>
                {loading && <div style={{ color:'#446688', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
                <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
                  {battleLogs.map((l, i) => (
                    <div key={i} style={{ color: l.color, fontSize:'12px', lineHeight:'2', borderBottom:'1px solid #001428', padding:'2px 0' }}>{l.text}</div>
                  ))}
                </div>
                {!loading && <button onClick={backToTown} style={{ width:'100%', padding:'10px', background:'#001840', border:'1px solid #0088ff', color:'#0088ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🏰 街に戻る</button>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatBar({ label, val, pct, color }) {
  return (
    <>
      <div style={{ fontSize:'11px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'2px' }}>
        <span>{label}</span><span style={{color}}>{val}</span>
      </div>
      <div style={{ background:'#001028', height:'5px', border:'1px solid #002244', marginBottom:'4px' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,#001,${color})` }} />
      </div>
    </>
  )
}

function StatLine({ label, base, bonus, color, statType }) {
  const rank = getStatRank(base + bonus, statType)
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span>
        {label}: <span style={{color}}>{base + bonus}</span>
        {bonus > 0 && <span style={{color:'#44ccff', fontSize:'10px'}}> (+{bonus})</span>}
      </span>
      <span style={{ color: rank.color, fontSize:'10px', fontWeight:'bold' }}>{rank.rank}</span>
    </div>
  )
}