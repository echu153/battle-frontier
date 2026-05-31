import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const WAIT_SECONDS = 10
const REGEN_SECONDS = 60

const ARTIFACT_BASE_NAMES = [
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたハンマー'
]

// パピア
const PAPIA = {
  name:'パピア', hp:3, atk:1, def:1, matk:1, mdef:1, spd:10000,
  type:'physical', gold:0, isPapia:true,
}
const PAPIA_TURNS = [
  'パピアは驚いている',
  'パピアはあたふたしている',
  '逃走準備',
  '次のターン逃げられそうだ',
  'ああ、逃げられる！',
  '逃走',
]

// ============================================================
// エリア定義
// ============================================================
const AREAS = [
  {
    id: 1, name: '始まりの森',
    enemies: [
      { name:'スライム',   hp:30,  atk:8,   def:3,  matk:0,  mdef:3,  spd:3,  type:'physical', gold:5  },
      { name:'コウモリ',   hp:37,  atk:10,  def:3,  matk:0,  mdef:3,  spd:15, type:'physical', gold:6  },
      { name:'毒キノコ',   hp:60,  atk:3,   def:4,  matk:12, mdef:7,  spd:2,  type:'magical',  gold:8  },
    ],
    boss: { name:'ビッグスライム', hp:500, atk:28, def:28, matk:5, mdef:30, spd:15, gold:50, isBoss:true, type:'physical' },
    commonDrops: ['木の盾','木の靴','粗悪な布','粗悪な鎧','粗悪な指輪','粗悪なピアス','ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書'],
    rareDrops: ['ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書'],
    bossDrops: ['スライムの指輪','蒼粘剣'],
  },
  {
    id: 2, name: '荒廃した草原',
    enemies: [
      { name:'ゴブリン', hp:160, atk:35, def:20, matk:0,  mdef:28, spd:40, type:'physical', gold:20 },
      { name:'野良犬',   hp:200, atk:45, def:24, matk:0,  mdef:25, spd:45, type:'physical', gold:25 },
      { name:'盗賊',     hp:240, atk:55, def:28, matk:10, mdef:35, spd:42, type:'physical', gold:30 },
    ],
    boss: { name:'盗賊団のリーダー', hp:2000, atk:84, def:38, matk:20, mdef:55, spd:65, gold:250, isBoss:true, type:'physical' },
    commonDrops: ['鋼鉄の剣','鋭利なナイフ','狩人の弓','魔導の杖','魔術教本','強化石(F)','戦士の指輪'],
    rareDrops: ['鋼鉄の剣','鋭利なナイフ','狩人の弓','魔導の杖','魔術教本','略奪の腕輪'],
    bossDrops: ['略奪者の短剣','影踏みのブーツ'],
  },
  {
    id: 3, name: '古代の洞窟',
    enemies: [
      { name:'コボルト',   hp:400, atk:100, def:55, matk:0,  mdef:60,  spd:100, type:'physical', gold:60  },
      { name:'スケルトン', hp:500, atk:120, def:65, matk:30, mdef:75,  spd:110, type:'physical', gold:80  },
      { name:'ゴーレム',   hp:600, atk:150, def:85, matk:0,  mdef:65,  spd:120, type:'physical', gold:100 },
    ],
    boss: { name:'古代の番人', hp:8000, atk:210, def:90, matk:80, mdef:110, spd:175, gold:1000, isBoss:true, type:'magical' },
    commonDrops: ['鋼鉄の剣','鋭利なナイフ','狩人の弓','魔導の杖','魔術教本','古代の護符'],
    rareDrops: ['鋼鉄の剣','鋭利なナイフ','狩人の弓','魔導の杖','魔術教本','秘術の首飾り'],
    bossDrops: ['古代魔導コア','虚無の杖'],
  },
  {
    id: 4, name: '蒼海の入り江',
    enemies: [
      { name:'深海魚人', hp:900,  atk:200, def:220, matk:40,  mdef:200, spd:200, type:'physical', gold:150 },
      { name:'海賊',     hp:1000, atk:230, def:240, matk:20,  mdef:180, spd:240, type:'physical', gold:180 },
      { name:'毒クラゲ', hp:800,  atk:80,  def:180, matk:180, mdef:240, spd:210, type:'magical',  gold:160 },
    ],
    boss: {
      name:'シーサーペント', hp:20000, atk:380, def:360, matk:150, mdef:400, spd:360, gold:2500, isBoss:true, type:'physical',
      skills: [
        { name:'海嵐の一撃', type:'physical', mult:1.6 },
        { name:'深海波動',   type:'magical',  mult:1.5 },
        { name:'潮流操作',   type:'debuff',   effect:'spdDown', rate:0.7, turns:3 },
        { name:'海流回復',   type:'heal',     rate:0.2 },
      ],
    },
    commonDrops: ['重鋼剣','双牙短剣','疾風の弓','蒼木の杖','精霊魔導典','海流の腕輪'],
    rareDrops: ['蒼海の大剣','海狼短剣','蒼潮の弓','海晶の杖','海霊詠唱録','蒼海の護符'],
    bossDrops: ['海竜の鱗','アクアクラウン'],
  },
  {
    id: 5, name: '巨峰山脈',
    enemies: [
      { name:'山岳ゴブリン', hp:1500, atk:640, def:510, matk:0,   mdef:450, spd:380, type:'physical', gold:250 },
      { name:'岩石ゴーレム', hp:2000, atk:760, def:660, matk:0,   mdef:420, spd:400, type:'physical', gold:300 },
      { name:'グリフィン',   hp:1800, atk:700, def:540, matk:120, mdef:510, spd:450, type:'physical', gold:280 },
    ],
    boss: {
      name:'雷鷲サンダーロック', hp:45000, atk:600, def:560, matk:250, mdef:600, spd:675, gold:6000, isBoss:true, type:'physical',
      skills: [
        { name:'雷爪乱舞', type:'physical_multi', mult:0.7, hits:3 },
        { name:'雷光閃',   type:'magical',  mult:1.8 },
        { name:'嵐の加護', type:'buff',     effect:'atkSpdUp', atkRate:1.3, spdRate:1.2, turns:3 },
        { name:'雷鳴回復', type:'heal',     rate:0.2 },
      ],
    },
    commonDrops: ['山岳の斧','岩砕の拳','霞散弾銃','嵐のオーブ','峰岳の兜','岩石鎧','山岳の靴','岩石の護符'],
    rareDrops:   ['雷砕斧','鷹爪の拳','雷鳴銃','雷晶オーブ','嵐の兜','雷鷲鎧','疾風の靴','峰岳の守護輪'],
    bossDrops:   ['雷鷲の爪牙','嵐の重装甲'],
  },
  {
    id: 6, name: '白銀の霊峰',
    enemies: [
      {
        name:'雪男',       hp:2500, atk:500, def:520, matk:0,   mdef:440, spd:650, type:'physical', gold:400,
        skills: [
          { name:'雪崩拳',       type:'physical', mult:1.4 },
          { name:'凍てつく咆哮', type:'debuff',   effect:'atkDown', rate:0.85, turns:2 },
        ],
      },
      {
        name:'氷河ドラゴン', hp:3000, atk:550, def:560, matk:150, mdef:560, spd:700, type:'physical', gold:450,
        skills: [
          { name:'氷河ブレス', type:'magical',  mult:1.5 },
          { name:'凍結の鱗',   type:'buff',     effect:'defUp', rate:1.25, turns:2 },
        ],
      },
      {
        name:'霜の精霊',   hp:2200, atk:200, def:400, matk:400, mdef:640, spd:750, type:'magical', gold:420,
        skills: [
          { name:'霜の矢',   type:'magical',  mult:1.3 },
          { name:'冷気まとい', type:'buff',   effect:'mdefUp', rate:1.3, turns:2 },
        ],
      },
    ],
    boss: {
      name:'氷霊フロストバーン', hp:90000, atk:850, def:800, matk:600, mdef:1000, spd:1100, gold:12500, isBoss:true, type:'magical',
      skills: [
        { name:'氷柱連打', type:'physical_multi', mult:0.6, hits:4 },
        { name:'絶対零度', type:'magical',  mult:2.0 },
        { name:'氷の鎧',   type:'buff',     effect:'defMdefUp', defRate:1.4, mdefRate:1.4, turns:3 },
        { name:'氷結回復', type:'heal',     rate:0.25 },
      ],
    },
    commonDrops: ['氷刃の剣','霜穿の槍','吹雪の弓','氷晶の杖','凍月刀','氷晶の護符'],
    rareDrops:   ['白銀の大剣','氷河長槍','極雪の弓','霜嵐の杖','凍蒼の刀','霜の宝珠'],
    bossDrops:   ['絶零の魔導砲','フロストバーンの聖鎧'],
  },
  {
    id: 7, name: '煉獄火山',
    enemies: [
      {
        name:'炎の精霊',   hp:3500, atk:700, def:640, matk:500, mdef:760, spd:1000, type:'magical', gold:600,
        skills: [
          { name:'火炎弾', type:'magical',  mult:1.5 },
          { name:'炎の衣', type:'buff',     effect:'matkUp', rate:1.25, turns:2 },
        ],
      },
      {
        name:'溶岩ゴーレム', hp:5000, atk:850, def:900, matk:0, mdef:640, spd:1100, type:'physical', gold:700,
        skills: [
          { name:'溶岩拳',   type:'physical', mult:1.6 },
          { name:'岩盤防御', type:'buff',     effect:'defUp', rate:1.35, turns:2 },
        ],
      },
      {
        name:'ファイアドレイク', hp:4000, atk:780, def:760, matk:300, mdef:800, spd:1200, type:'physical', gold:650,
        skills: [
          { name:'炎爪連撃', type:'physical_multi', mult:0.8, hits:2 },
          { name:'業火ブレス', type:'magical',  mult:1.7 },
        ],
      },
    ],
    boss: {
      name:'深紅のサラマンダー', hp:180000, atk:1200, def:1200, matk:900, mdef:1500, spd:1800, gold:25000, isBoss:true, type:'physical',
      skills: [
        { name:'溶岩爪撃',   type:'physical', mult:2.0 },
        { name:'業火放射',   type:'magical',  mult:2.2, debuff:'mdefDown', debuffRate:0.8, debuffTurns:3 },
        { name:'煉獄の覇気', type:'buff',     effect:'atkMatkUp', atkRate:1.4, matkRate:1.4, turns:3 },
        { name:'炎の再生',   type:'heal',     rate:0.25 },
      ],
    },
    commonDrops: ['業火の短剣','炎のワンド','煉獄魔導書','炎の兜','溶岩鎧','紅蓮の靴','溶岩の指輪'],
    rareDrops:   ['サラマンダーブレード','フェニックスワンド','煉獄のコデックス','溶鉄のクラウン','ドレイクアーマー','ヴァルカンブーツ','業炎の指輪'],
    bossDrops:   ['深紅の牙輪','深紅の魔眼石','インフェルノバスティオン'],
  },
]

// ============================================================
// クラス定義
// ============================================================
const JOB_BASE = {
  '戦士':      { hp_max:80,  mp_max:10, atk:10, def:8,  matk:1,  mdef:3,  spd:5  },
  '弓使い':    { hp_max:60,  mp_max:15, atk:8,  def:4,  matk:2,  mdef:3,  spd:10 },
  '魔法使い':  { hp_max:45,  mp_max:50, atk:2,  def:2,  matk:14, mdef:4,  spd:4  },
  '僧侶':      { hp_max:55,  mp_max:45, atk:2,  def:3,  matk:7,  mdef:12, spd:3  },
  '侍':        { hp_max:100, mp_max:15, atk:13, def:10, matk:4,  mdef:4,  spd:8  },
  '狂戦士':    { hp_max:110, mp_max:10, atk:16, def:8,  matk:4,  mdef:4,  spd:4  },
  '狩人':      { hp_max:80,  mp_max:20, atk:13, def:6,  matk:4,  mdef:4,  spd:13 },
  '暗殺者':    { hp_max:70,  mp_max:20, atk:10, def:4,  matk:4,  mdef:4,  spd:18 },
  '元素使い':  { hp_max:55,  mp_max:70, atk:5,  def:2,  matk:17, mdef:5,  spd:4  },
  '死霊使い':  { hp_max:60,  mp_max:80, atk:4,  def:4,  matk:12, mdef:4,  spd:8  },
  '聖職者':    { hp_max:70,  mp_max:60, atk:4,  def:8,  matk:8,  mdef:12, spd:4  },
  '異端審問官':{ hp_max:60,  mp_max:65, atk:4,  def:4,  matk:12, mdef:16, spd:3  },
  '賢者':      { hp_max:65,  mp_max:70, atk:3,  def:3,  matk:15, mdef:14, spd:4  },
}

const JOB_GROWTH = {
  '戦士':      { hp:20, mp:5,  atk:2, def:2, matk:0, mdef:1, spd:1 },
  '弓使い':    { hp:15, mp:5,  atk:2, def:1, matk:0, mdef:1, spd:2 },
  '魔法使い':  { hp:10, mp:15, atk:0, def:1, matk:3, mdef:1, spd:1 },
  '僧侶':      { hp:15, mp:15, atk:0, def:1, matk:1, mdef:2, spd:1 },
  '侍':        { hp:20, mp:5,  atk:3, def:2, matk:0, mdef:1, spd:1 },
  '狂戦士':    { hp:20, mp:5,  atk:4, def:1, matk:0, mdef:0, spd:0 },
  '狩人':      { hp:10, mp:5,  atk:3, def:1, matk:0, mdef:0, spd:3 },
  '暗殺者':    { hp:10, mp:5,  atk:2, def:1, matk:0, mdef:0, spd:4 },
  '元素使い':  { hp:10, mp:10, atk:0, def:0, matk:4, mdef:1, spd:0 },
  '死霊使い':  { hp:10, mp:10, atk:0, def:0, matk:3, mdef:1, spd:2 },
  '聖職者':    { hp:10, mp:10, atk:0, def:2, matk:1, mdef:3, spd:0 },
  '異端審問官':{ hp:10, mp:10, atk:0, def:1, matk:2, mdef:3, spd:0 },
  '賢者':      { hp:10, mp:12, atk:0, def:1, matk:3, mdef:3, spd:0 },
}

const JOB_LEVEL3_BONUS = {
  '戦士':      ['matk'],
  '弓使い':    ['matk'],
  '魔法使い':  ['atk'],
  '僧侶':      ['atk'],
  '侍':        ['matk'],
  '狂戦士':    ['matk','mdef','spd'],
  '狩人':      ['matk','mdef'],
  '暗殺者':    ['matk','mdef'],
  '元素使い':  ['atk','def','spd'],
  '死霊使い':  ['atk','def'],
  '聖職者':    ['atk','spd'],
  '異端審問官':['atk','spd'],
  '賢者':      ['atk','spd'],
}

const INITIAL_CLASSES = ['戦士','弓使い','魔法使い','僧侶','格闘家']
const ADVANCED_CLASSES = {
  '侍':        { requires:'戦士' },
  '狂戦士':    { requires:'戦士' },
  '狩人':      { requires:'弓使い' },
  '暗殺者':    { requires:'弓使い' },
  '元素使い':  { requires:'魔法使い' },
  '死霊使い':  { requires:'魔法使い' },
  '聖職者':    { requires:'僧侶' },
  '異端審問官':{ requires:'僧侶' },
  '賢者':      { requires:'僧侶', requires2:'魔法使い', requires2Lv:50, requiresLv:50 },
  'サイキッカー': { requires:'格闘家' },
  '体術師':    { requires:'格闘家' },
  '魔銃士':    { requires:'弓使い', requiresLv:50, requires2:'魔法使い', requires2Lv:50 },
}

const CLASS_LEVEL_CAP = {
  '戦士':100, '弓使い':100, '魔法使い':100, '僧侶':100, '格闘家':100,
  '侍':100, '狂戦士':100, '狩人':100, '暗殺者':100,
  '元素使い':100, '死霊使い':100, '聖職者':100, '異端審問官':100, '賢者':100,
  'サイキッカー':100, '体術師':100, '魔銃士':100,
}
const getEffectiveCap = (className) => CLASS_LEVEL_CAP[className] || 100

// LV1からupToLevelまでのステータス上昇量を計算
const calcLvBonus = (className, upToLevel) => {
  const growth = JOB_GROWTH[className] || JOB_GROWTH['戦士']
  const bonusSlots = JOB_LEVEL3_BONUS[className] || []
  const levels = upToLevel - 1
  const bonus = {
    hp_max: growth.hp * levels,
    mp_max: growth.mp * levels,
    atk:    growth.atk * levels,
    def:    growth.def * levels,
    matk:   growth.matk * levels,
    mdef:   growth.mdef * levels,
    spd:    growth.spd * levels,
  }
  for (let lv = 3; lv <= upToLevel; lv += 3) {
    if (bonusSlots.length > 0) {
      const bi = Math.floor(lv / 3 - 1) % bonusSlots.length
      const stat = bonusSlots[bi]
      bonus[stat] = (bonus[stat] || 0) + 1
    }
  }
  return bonus
}
const calcLv20Bonus = (className) => calcLvBonus(className, 20)
const getRetrainingStars = (className, retraining) => {
  const count = (retraining || {})[className] || 0
  return '★'.repeat(count)
}

const STAT_LABELS = {
  hp:'HP (+10)', mp:'MP (+5)', atk:'攻撃力 (+1)', def:'防御力 (+1)',
  matk:'特殊攻撃力 (+1)', mdef:'特殊防御力 (+1)', spd:'素早さ (+1)'
}

// ============================================================
// ユーティリティ
// ============================================================
// ★ ステータスのF~SSSランク閾値（見直し時はここを変更）
const DEF_STAT_THRESHOLDS = [45, 120, 240, 450, 750, 1200, 1800, 2700]
// ★ 防御ランクに対応するダメージ軽減率(%) F=0%〜SSS=30%（見直し時はここを変更）
const DEF_REDUCTION_RATES = [0, 4, 8, 11, 15, 19, 23, 26, 30]

// 防御値からダメージ軽減率(0〜1)を線形補間で算出
const calcDefReduction = (defVal) => {
  if (defVal <= 0) return 0
  const thresholds = [0, ...DEF_STAT_THRESHOLDS]
  const rates = DEF_REDUCTION_RATES
  if (defVal >= thresholds[thresholds.length - 1]) return rates[rates.length - 1] / 100
  for (let i = 1; i < thresholds.length; i++) {
    if (defVal <= thresholds[i]) {
      const progress = (defVal - thresholds[i-1]) / (thresholds[i] - thresholds[i-1])
      return (rates[i-1] + (rates[i] - rates[i-1]) * progress) / 100
    }
  }
  return rates[rates.length - 1] / 100
}

// ATK²/(ATK+DEF) 比率式ベースダメージ
const calcRatioDmg = (atk, enemyDef, mult, am) => {
  const adjDef = Math.max(0, enemyDef)
  return Math.floor((atk * atk / Math.max(1, atk + adjDef)) * mult * am)
}

const getStatRank = (val, type) => {
  let thresholds
  if (type === 'hp') thresholds = [450,1200,2400,4500,7500,12000,18000,27000]
  else if (type === 'mp') thresholds = [225,600,1200,2250,3750,6000,9000,13500]
  else thresholds = DEF_STAT_THRESHOLDS
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (val <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank:'SSS', color:'#ffcc00' }
}

const calcTotal = (p) => Math.floor((p.hp_max/10)+(p.mp_max/5)+p.atk+p.def+p.matk+p.mdef+p.spd)

const getTotalRank = (total) => {
  const thresholds = [200,500,1000,2000,4000,7000,11000,16000]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (total <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank:'SSS', color:'#ffcc00' }
}

const calcExpNext = (lv) => {
  const lvInBlock = (lv - 1) % 100
  const tier = Math.floor(lvInBlock / 10)
  return 100 + tier * 10
}

const WEAPON_TYPE_GROUP = {
  sword:'physical', axe:'physical', spear:'physical', bow:'physical', dagger:'physical',
  knuckle:'physical', gun:'physical', katana:'physical',
  staff:'magical', wand:'magical', tome:'magical', orb:'magical',
}
const getWeaponGroup = (weaponType) => WEAPON_TYPE_GROUP[weaponType] || 'physical'

const getProfPrefix = (profLv) => {
  if (profLv >= 300) return '【極】'
  if (profLv >= 200) return '【真】'
  if (profLv >= 100) return '【改】'
  return ''
}

// 熟練度ボーナス：物理武器→ATK / 特殊武器→MATK
// 上昇値 = floor(元ステータス × (LV×1% + floor(LV/100)×50%))
const calcProfBonus = (prof, weapon) => {
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

const ARTIFACT_BASE_NAMES_SET = new Set([
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたハンマー'
])

const calcEnhancedStat = (base, plus) => {
  if (!plus || plus <= 0 || base <= 0) return base
  return Math.ceil(base * Math.pow(1.5, plus))
}

const calcEffectiveStats = (profile, equipment, proficiency) => {
  const bonus = { atk:0, def:0, matk:0, mdef:0, spd:0, hp:0, mp:0 }
  let matkPct = 0
  let hitBonus = 0
  let critBonus = 0
  let evasionBonus = 0
  for (const item of equipment) {
    if (!item.equipped || !item.weapons) continue
    const w = item.weapons
    const plus = item.enhance_plus || 0
    // enhance_plusによる強化倍率を適用（古びた○○は除外）
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
  }
}

// 回避率計算（防御側SPD > 攻撃側SPDのとき回避率UP、最大10%）
const calcEvasionRate = (defenderSpd, attackerSpd) => {
  if (defenderSpd <= attackerSpd) return 0
  return Math.min(10, (defenderSpd - attackerSpd) / attackerSpd * 10)
}

const calcExtraActionRate = (mySpd, enemySpd) => {
  if (mySpd <= enemySpd) return 0
  const diff = mySpd - enemySpd
  const rawRate = (diff/enemySpd)*50
  if (rawRate <= 50) return rawRate
  return 50 + (rawRate-50)*0.5
}

const calcCritRate = (mySpd, enemySpd) => {
  const base = 100/48
  if (mySpd <= enemySpd) return base
  const bonus = Math.min(5, (mySpd-enemySpd)/enemySpd*2*100)
  return base + bonus
}

const RARITY_BONUS_COUNT = { f:1, e:1, d:2, c:2, b:3, a:3, s:4, ss:4, sss:4 }

const generateDropBonus = (weapon) => {
  const statKeys = ['atk_bonus','def_bonus','matk_bonus','mdef_bonus','spd_bonus','hp_bonus','mp_bonus']
  const eligible = statKeys.filter(k => (weapon[k]||0) > 0)
  if (eligible.length === 0) return {}
  if (ARTIFACT_BASE_NAMES.includes(weapon.name)) return {}
  const bonusCount = RARITY_BONUS_COUNT[weapon.rarity] || 1
  const result = {}
  for (let i = 0; i < bonusCount; i++) {
    const isSpecial = Math.random() < 0.1
    if (isSpecial && i === 0) {
      const effects = [
        'open_atk_10_2t','open_atk_20_1t','open_def_10_2t','open_def_20_1t',
        'open_matk_10_2t','open_matk_20_1t','open_mdef_10_2t','open_mdef_20_1t',
        'open_spd_10_2t','open_spd_20_1t','delay_heal_10','regen_heal_5_3t',
      ]
      result.bonus_effect = effects[Math.floor(Math.random()*effects.length)]
    } else {
      const targetKey = eligible[Math.floor(Math.random()*eligible.length)]
      const baseVal = weapon[targetKey] || 0
      const maxBonus = Math.max(1, Math.floor(baseVal*0.5))
      const bonusVal = Math.floor(Math.random()*maxBonus)+1
      const bonusMap = {
        atk_bonus:'bonus_atk', def_bonus:'bonus_def', matk_bonus:'bonus_matk',
        mdef_bonus:'bonus_mdef', spd_bonus:'bonus_spd', hp_bonus:'bonus_hp', mp_bonus:'bonus_mp',
      }
      const bonusKey = bonusMap[targetKey]
      result[bonusKey] = (result[bonusKey]||0) + bonusVal
    }
  }
  return result
}

const applyEquipmentEffects = (equipment, profile, playerBuffs, logs) => {
  const newBuffs = { ...playerBuffs }
  for (const item of equipment) {
    if (!item.equipped || !item.bonus_effect) continue
    const effect = item.bonus_effect
    if (effect === 'open_atk_10_2t')  { newBuffs.atkUp  = { turns:2, rate:1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間攻撃力+10%！`, color:'#ffcc00' }) }
    if (effect === 'open_atk_20_1t')  { newBuffs.atkUp  = { turns:1, rate:1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間攻撃力+20%！`, color:'#ffcc00' }) }
    if (effect === 'open_def_10_2t')  { newBuffs.defUp  = { turns:2, rate:1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間防御力+10%！`, color:'#88aaff' }) }
    if (effect === 'open_def_20_1t')  { newBuffs.defUp  = { turns:1, rate:1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間防御力+20%！`, color:'#88aaff' }) }
    if (effect === 'open_matk_10_2t') { newBuffs.matkUp = { turns:2, rate:1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間特殊攻撃力+10%！`, color:'#cc44ff' }) }
    if (effect === 'open_matk_20_1t') { newBuffs.matkUp = { turns:1, rate:1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間特殊攻撃力+20%！`, color:'#cc44ff' }) }
    if (effect === 'open_mdef_10_2t') { newBuffs.mdefUp = { turns:2, rate:1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間特殊防御力+10%！`, color:'#44ccff' }) }
    if (effect === 'open_mdef_20_1t') { newBuffs.mdefUp = { turns:1, rate:1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間特殊防御力+20%！`, color:'#44ccff' }) }
    if (effect === 'open_spd_10_2t')  { newBuffs.spdUp  = { turns:2, rate:1.1 }; logs.push({ text:`✨ 装備効果発動！ 2ターンの間素早さ+10%！`, color:'#ff8844' }) }
    if (effect === 'open_spd_20_1t')  { newBuffs.spdUp  = { turns:1, rate:1.2 }; logs.push({ text:`✨ 装備効果発動！ 1ターンの間素早さ+20%！`, color:'#ff8844' }) }
    if (effect === 'regen_heal_5_3t') { newBuffs.regenHeal = { turns:3, amount:Math.floor(profile.hp_max*0.05) }; logs.push({ text:`✨ 装備効果発動！ 3ターンの間毎ターンHP5%回復！`, color:'#44ff88' }) }
    if (effect === 'delay_heal_10')   { newBuffs.delayHeal = { triggerTurn:3, amount:Math.floor(profile.hp_max*0.1) }; logs.push({ text:`✨ 装備効果発動！ 3ターン後にHP10%回復！`, color:'#44ff88' }) }
  }
  return newBuffs
}

// ============================================================
// プレイヤースキル実行
// ============================================================
const executeSkill = (skill, eff, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkill = '') => {
  const result = { dmg:0, heal:0, log:'', newEnemyBuffs:{ ...enemyBuffs }, newPlayerBuffs:{ ...playerBuffs }, selfDmg:0, bonusCritRate:0 }
  const randMult = (min, max) => min + Math.random()*(max-min)
  const am = isArtifact ? 1.2 : 1.0
  // 敵DEF・MDEF の低い方で軽減する計算（ハイブリッドスキル用）
  const calcMinDef = () => {
    const edr = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
    const emr = (enemyBuffs.mdefDown?.rate||1)*(enemyBuffs.mdefUp?.rate||1)
    return Math.min(Math.floor((enemy.def||0)*edr/2), Math.floor((enemy.mdef||0)*emr/2))
  }
  switch (skill.name) {
    case '体当たり':    result.dmg = Math.floor(eff.atk*1.2*am); result.log = `⚔ 体当たり！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '強撃':        result.dmg = Math.floor(eff.atk*1.4*am); result.log = `💥 強撃！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '防御崩し': {
      result.dmg = Math.floor(eff.atk*1.3*am)
      const defBreakHit = Math.random()*100 < 30
      if (defBreakHit) result.newEnemyBuffs.defDown={turns:4,rate:0.8}
      result.log = `🗡 防御崩し！ ${enemy.name}に${result.dmg}ダメージ！${defBreakHit ? ' 防御力が低下した！' : ''}`
      break
    }
    case '防御態勢':    result.newPlayerBuffs.defUp={turns:4,rate:1.3}; result.log = `🛡 防御態勢！ 4ターンの間防御力と特殊防御力が上昇した！`; break
    case '応急手当':    result.heal = Math.floor(profile.hp_max*0.15); result.log = `💊 応急手当！ HPを${result.heal}回復した！`; break
    case 'シールドアタック': result.dmg = Math.floor((eff.atk*0.8+eff.def*0.4)*am); result.log = `🛡 シールドアタック！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '狙撃':        result.dmg = Math.floor(eff.spd*1.2*am); result.log = `🏹 狙撃！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '駆け足':      result.newPlayerBuffs.spdUp={turns:4,rate:1.3}; result.log = `💨 駆け足！ 4ターンの間素早さが上昇した！`; break
    case '貫通射撃': {
      const edr_p = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
      const defVal_p = Math.floor((enemy.def||0)*edr_p*0.8/2)
      result.dmg = Math.max(1, Math.floor(eff.atk*1.2*am) - defVal_p)
      result.log = `🏹 貫通射撃！ ${enemy.name}の防御を貫いて${result.dmg}ダメージ！`; break
    }
    case '疾風矢':      result.dmg = Math.floor((eff.atk*1.0+eff.spd*0.5)*am); result.log = `💨 疾風矢！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '剛射':        result.dmg = Math.floor(eff.atk*1.2*am); result.log = `🏹 剛射！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case 'マジックアロー': {
      const mad = Math.floor(eff.matk*0.7*am)
      result.dmg = mad*2; result.log = `🔮 マジックアロー！ ${enemy.name}に${mad}×2=${result.dmg}の魔法ダメージ！`; break
    }
    case 'ファイア': {
      result.dmg = Math.floor(eff.matk*1.3*am)
      const burnHit = Math.random()*100 < 20
      if (burnHit) result.newEnemyBuffs.burn = { turns:5, dmgRate:0.02 }
      result.log = `🔥 ファイア！ ${enemy.name}に${result.dmg}の魔法ダメージ！${burnHit ? ' やけど状態！' : ''}`
      break
    }
    case '精神統一':    result.newPlayerBuffs.matkUp={turns:4,rate:1.3}; result.log = `✨ 精神統一！ 4ターンの間特殊攻撃力が上昇した！`; break
    case 'サンダー': {
      result.dmg = Math.floor(eff.matk*1.4*am)
      const pHit = Math.random()*100 < 20
      if (pHit && !(enemyBuffs.paralysis?.turns > 0)) result.newEnemyBuffs.paralysis = { turns:5, skipRate:0.25, spdRate:0.8 }
      result.log = `⚡ サンダー！ ${enemy.name}に${result.dmg}の魔法ダメージ！${pHit && !(enemyBuffs.paralysis?.turns > 0) ? ' 麻痺した！' : ''}`
      break
    }
    case 'アイスランス': {
      result.dmg = Math.floor(eff.matk*1.6*am)
      const slowHit = Math.random()*100 < 40
      if (slowHit) result.newEnemyBuffs.spdDown = { turns:3, rate:0.5 }
      result.log = `❄ アイスランス！ ${enemy.name}に${result.dmg}の魔法ダメージ！${slowHit ? ' スロー状態！' : ''}`
      break
    }
    case 'ライト':      result.dmg = Math.floor(eff.matk*1.3*am); result.log = `✨ ライト！ ${enemy.name}に${result.dmg}の魔法ダメージ！`; break
    case 'ヒール':      result.heal = Math.floor(profile.hp_max*0.15+eff.matk*0.2); result.log = `💚 ヒール！ HPを${result.heal}回復した！`; break
    case 'プロテク':    result.newPlayerBuffs.defUp={turns:4,rate:1.2}; result.log = `🛡 プロテク！ 4ターンの間防御力と特殊防御力が上昇した！`; break
    case '祈祷':        result.newPlayerBuffs.regenHeal={turns:4,amount:Math.floor(profile.hp_max*0.1)}; result.log = `🙏 祈祷！ 4ターンの間毎ターンHPが回復するようになった！`; break
    case 'ライトニング': {
      result.dmg = Math.floor(eff.matk*1.5*am)
      const mdefHit = Math.random()*100 < 30
      if (mdefHit) result.newEnemyBuffs.mdefDown={turns:3,rate:0.7}
      result.log = `⚡ ライトニング！ ${enemy.name}に${result.dmg}の魔法ダメージ！${mdefHit ? ' 特殊防御力が低下した！' : ''}`
      break
    }
    case '居合斬': {
      result.dmg = Math.floor((eff.atk*1.1+eff.spd*0.4)*am)
      const bleedHit1 = Math.random()*100 < 20
      if (bleedHit1) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `⚔ 居合斬！ ${enemy.name}に${result.dmg}ダメージ！${bleedHit1 ? ' 出血状態！' : ''}`
      break
    }
    case '断空': {
      result.dmg = Math.floor(eff.atk*1.6*am)
      const bleedHit2 = Math.random()*100 < 30
      if (bleedHit2) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `⚔ 断空！ ${enemy.name}の防御を断ち切り${result.dmg}ダメージ！${bleedHit2 ? ' 出血状態！' : ''}`
      break
    }
    case '明鏡止水':    result.newPlayerBuffs.atkUp={turns:4,rate:1.5}; result.newPlayerBuffs.hitBonus={turns:4,value:5}; result.log = `✨ 明鏡止水！ 4ターンの間攻撃力が上昇し命中率UP！`; break
    case '月影': {
      result.dmg = Math.floor(eff.atk*2.0*am)
      const bleedHit6 = Math.random()*100 < 40
      if (bleedHit6) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `🌙 月影！ ${enemy.name}に${result.dmg}の強烈なダメージ！${bleedHit6 ? ' 出血！' : ''}`
      break
    }
    case 'マッドラッシュ': {
      result.dmg = Math.floor(eff.atk*1.7*am)
      result.newPlayerBuffs.berserk = { turns:3, lockedSkill:'マッドラッシュ' }
      result.log = `💢 マッドラッシュ！ ${enemy.name}に${result.dmg}ダメージ！ 狂乱状態になった！`
      break
    }
    case 'すてみ':      result.dmg = Math.floor(eff.atk*1.7*am); result.selfDmg = Math.floor(result.dmg*0.2); result.log = `💢 すてみ！ ${enemy.name}に${result.dmg}ダメージ！ 自分も${result.selfDmg}ダメージ！`; break
    case 'ブラッティロア': result.newPlayerBuffs.atkUp={turns:4,rate:1.1}; result.newPlayerBuffs.bloodRage={turns:4,healRate:0.3}; result.log = `🩸 ブラッティロア！ 4ターンの間、攻撃力UP・与えたダメージを回復！`; break
    case 'フルブレイカー': {
      const edr_fb = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
      const defVal_fb = Math.floor((enemy.def||0)*edr_fb*0.7/2)
      result.dmg = Math.max(1, Math.floor(eff.atk*1.9*am) - defVal_fb)
      result.log = `💥 フルブレイカー！ ${enemy.name}に${result.dmg}の壊滅的ダメージ！ 防御無視！`; break
    }
    case '毒矢': {
      result.dmg = Math.floor(eff.atk*1.1*am)
      const poisonHit = Math.random()*100 < 90
      if (poisonHit) result.newEnemyBuffs.poison = { turns:4, dmgRate:0.03 }
      result.log = `🏹 毒矢！ ${enemy.name}に${result.dmg}ダメージ！${poisonHit ? ' 毒状態に！' : ''}`
      break
    }
    case '三連射':      result.dmg = Math.floor(eff.atk*0.5*am)*3; result.log = `🏹 三連射！ ${enemy.name}に${Math.floor(eff.atk*0.5*am)}×3=${result.dmg}ダメージ！`; break
    case '狩猟本能':    result.newPlayerBuffs.atkUp={turns:4,rate:1.3}; result.newPlayerBuffs.spdUp={turns:4,rate:1.3}; result.log = `🌲 狩猟本能！ 4ターンの間、攻撃力・素早さが上昇！`; break
    case '絶影狙撃':    result.dmg = Math.floor(eff.atk*2.0*am); result.log = `🏹 絶影狙撃！ 必中！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '瞬歩瞬殺': {
      result.dmg = Math.floor((eff.atk*1.0+eff.spd*0.5)*am)
      const bleedHit3 = Math.random()*100 < 40
      if (bleedHit3) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `🌙 瞬歩瞬殺！ ${enemy.name}に${result.dmg}ダメージ！${bleedHit3 ? ' 出血状態！' : ''}`
      break
    }
    case '鬼影閃': {
      let kiDmg = Math.floor(eff.atk*1.5*am)
      const hasShadowWalk = playerBuffs.evasion?.turns > 0
      let bonusDmg = 0
      if (hasShadowWalk) {
        bonusDmg = Math.floor(eff.spd*0.3*am)
        kiDmg += bonusDmg
      }
      result.dmg = kiDmg
      const bleedHit4 = Math.random()*100 < 20
      if (bleedHit4) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `🌙 鬼影閃！ ${enemy.name}に${result.dmg}ダメージ！${hasShadowWalk ? ` 影歩き追撃(+${bonusDmg})！` : ''}${bleedHit4 ? ' 出血！' : ''}`
      break
    }
    case '影歩き':      result.newPlayerBuffs.spdUp={turns:4,rate:1.5}; result.newPlayerBuffs.evasion={turns:4,rate:0.05}; result.log = `🌙 影歩き！ 4ターンの間、素早さ大幅上昇・回避率UP！`; break
    case '急所突き':    result.dmg = Math.floor(eff.atk*1.8*am); result.bonusCritRate=30; result.log = `🌙 急所突き！ ${enemy.name}に${result.dmg}ダメージ！ クリティカル確率大幅UP！`; break
    case 'アクアショット': {
      result.dmg = Math.floor(eff.matk*1.4*am)
      const aquaSlowHit = Math.random()*100 < 55
      if (aquaSlowHit) result.newEnemyBuffs.spdDown={turns:2,rate:0.9}
      result.log = `🌊 アクアショット！ ${enemy.name}に${result.dmg}の魔法ダメージ！${aquaSlowHit ? ' 素早さ低下！' : ''}`
      break
    }
    case 'アースクエイク': {
      result.dmg = Math.floor(eff.matk*1.6*am)
      const stunResist = enemyBuffs.stunResist ?? 1.0
      const stunHit = Math.random()*100 < 15 * stunResist
      if (stunHit) {
        result.newEnemyBuffs.stun = { turns:1 }
        result.newEnemyBuffs.stunResist = stunResist * 0.5
      }
      result.log = `🌊 アースクエイク！ ${enemy.name}に${result.dmg}の魔法ダメージ！${stunHit ? ' スタン！' : ''}`
      break
    }
    case 'ライトニングボルト': {
      result.dmg = Math.floor(eff.matk*1.5*am)
      const paralysisHit = Math.random()*100 < 30
      if (paralysisHit && !(enemyBuffs.paralysis?.turns > 0)) result.newEnemyBuffs.paralysis = { turns:5, skipRate:0.25, spdRate:0.8 }
      result.log = `⚡ ライトニングボルト！ ${enemy.name}に${result.dmg}の魔法ダメージ！${paralysisHit && !(enemyBuffs.paralysis?.turns > 0) ? ' 麻痺した！' : ''}`
      break
    }
    case 'フレイムバースト': {
      result.dmg = Math.floor(eff.matk*1.9*am)
      const fbBurnHit = Math.random()*100 < 55
      if (fbBurnHit) result.newEnemyBuffs.burn = { turns:5, dmgRate:0.02 }
      result.log = `🔥 フレイムバースト！ ${enemy.name}に${result.dmg}の爆炎ダメージ！${fbBurnHit ? ' やけど状態！' : ''}`
      break
    }
    case '骸骨召喚':    result.dmg = Math.floor(eff.matk*0.7*am); result.newPlayerBuffs.skeletonDmg={turns:2,dmg:result.dmg}; result.log = `💀 骸骨召喚！ ${enemy.name}に${result.dmg}ダメージ！ 2ターン持続！`; break
    case 'ソウルドレイン': result.dmg = Math.floor(eff.matk*1.4*am); result.heal = Math.floor(result.dmg*0.2); result.log = `💀 ソウルドレイン！ ${enemy.name}に${result.dmg}ダメージ！ HPを${result.heal}回復！`; break
    case '腐敗霧':      result.newEnemyBuffs.defDown={turns:4,rate:0.7}; result.newEnemyBuffs.mdefDown={turns:4,rate:0.7}; result.newEnemyBuffs.severePoisoin={turns:5,dmgRate:0.05}; result.log = `💀 腐敗霧！ 4ターンの間、対象の防御力・特殊防御力低下！ 猛毒状態！`; break
    case '幽世ノ門': {
      const curseDmgAmt = Math.floor(eff.matk*0.3*am)
      result.newEnemyBuffs.curseDmg = { turns:3, dmg:curseDmgAmt }
      result.newEnemyBuffs.dmgDown = { turns:3, rate:0.8 }
      result.newEnemyBuffs.spdDown = { turns:3, rate:0.8 }
      result.log = `💀 幽世ノ門！ 3ターンの間、呪縛ダメージ・与ダメ低下・素早さ低下！`; break
    }
    case 'ホーリーライト': result.dmg = Math.floor(eff.matk*1.5*am); result.log = `✨ ホーリーライト！ ${enemy.name}に${result.dmg}の聖なるダメージ！`; break
    case '奇跡':        result.newPlayerBuffs.regenHeal={turns:4,amount:Math.floor(profile.hp_max*0.10+eff.matk*0.2)}; result.log = `✨ 奇跡！ 4ターンの間、毎ターンHPが回復！`; break
    case '祈りの結界':  result.newPlayerBuffs.dmgReduce={turns:4,rate:0.7}; result.log = `✨ 祈りの結界！ 4ターンの間、受けるダメージ軽減！`; break
    case '神罰執行': {
      result.dmg = Math.floor(eff.matk*1.8*am)
      const healDownHit = Math.random()*100 < 50
      if (healDownHit) result.newEnemyBuffs.healDown={turns:3,rate:0.5}
      result.log = `✨ 神罰執行！ ${enemy.name}に${result.dmg}ダメージ！${healDownHit ? ' 回復封じ！' : ''}`
      break
    }
    case '粛清':        result.dmg = Math.floor((eff.matk*1.3+eff.mdef*0.3)*am); result.log = `⚖ 粛清！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '狂信':        result.newPlayerBuffs.statusImmune={turns:4}; result.log = `⚖ 狂信！ 4ターンの間、ステータス減少を無効化！`; break
    case '聖なる裁き': {
      result.dmg = Math.floor(eff.matk*1.7*am)
      const sealHit1 = Math.random()*100 < 20
      if (sealHit1) result.newEnemyBuffs.healDown={turns:3,rate:0.0}
      result.log = `⚖ 聖なる裁き！ ${enemy.name}に${result.dmg}の裁きのダメージ！${sealHit1 ? ' 回復封じ！' : ''}` ; break
    }
    case '断罪': {
      result.dmg = Math.floor((eff.matk*1.6+eff.mdef*1.0)*am)
      const sealHit2 = Math.random()*100 < 30
      if (sealHit2) result.newEnemyBuffs.healDown={turns:3,rate:0.0}
      result.log = `⚖ 断罪！ ${enemy.name}に${result.dmg}の断罪ダメージ！${sealHit2 ? ' 回復封じ！' : ''}`
      break
    }
    case 'マナボルト': {
      const consumed = eff.lastMpCost || 0
      result.dmg = consumed * 3
      result.log = `✨ マナボルト！ MP${consumed}を消費して${result.dmg}の特殊ダメージ！`; break
    }
    case 'ディスペル': {
      const buffKeys = Object.keys(enemyBuffs).filter(k => enemyBuffs[k]?.turns > 0)
      if (buffKeys.length > 0) {
        const removeKey = buffKeys[Math.floor(Math.random()*buffKeys.length)]
        result.newEnemyBuffs[removeKey] = { turns:0, rate:1 }
        result.log = `✨ ディスペル！ ${enemy.name}のバフを1つ消去した！`
      } else {
        result.log = `✨ ディスペル！ しかし消去するバフがなかった！`
      }
      break
    }
    case '氷の障壁':    result.newPlayerBuffs.dmgReduce={turns:2,rate:0.6}; result.newPlayerBuffs.critResist={turns:2,value:20}; result.log = `❄ 氷の障壁！ 2ターンの間、受けるダメージ大幅軽減・クリティカル抵抗UP！`; break
    case 'メテオストライク': {
      const rand = Math.random()*100
      const hits = rand < 20 ? 1 : rand < 60 ? 2 : rand < 90 ? 3 : 4
      const hitDmg = Math.floor(eff.matk*0.8*am)
      result.dmg = hitDmg * hits
      let meteoBurned = false
      for (let h = 0; h < hits; h++) {
        if (Math.random()*100 < 5) { meteoBurned = true; result.newEnemyBuffs.burn = { turns:5, dmgRate:0.02 }; break }
      }
      result.log = `☄ メテオストライク！ ${hits}回ヒット！ ${enemy.name}に${result.dmg}の魔法ダメージ！${meteoBurned ? ' やけど状態！' : ''}`
      break
    }
    // ── 格闘家 ──
    case '打撃':   result.dmg = Math.floor(eff.atk*1.2*am); result.log = `👊 打撃！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '連打':   result.dmg = Math.floor(eff.atk*0.4*am)*3; result.log = `👊 連打！ ${enemy.name}に${Math.floor(eff.atk*0.4*am)}×3=${result.dmg}ダメージ！`; break
    case '残心':   result.newPlayerBuffs.spdUp={turns:4,rate:1.1}; result.newPlayerBuffs.hitBonus={turns:4,value:10}; result.log = `🧘 残心！ 4ターンの間、命中・素早さが上昇！`; break
    case '鉄拳': {
      const edr_k = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
      const defVal_k = Math.floor((enemy.def||0)*edr_k*0.8/2)
      result.dmg = Math.max(1, Math.floor(eff.atk*1.3*am) - defVal_k)
      result.log = `👊 鉄拳！ ${enemy.name}に${result.dmg}ダメージ！ 防御貫通！`; break
    }
    case '爆裂拳': {
      result.dmg = Math.floor(eff.atk*1.4*am)
      const sr_ep = enemyBuffs.stunResist ?? 1.0
      const sh_ep = Math.random()*100 < 20 * sr_ep
      if (sh_ep) { result.newEnemyBuffs.stun={turns:1}; result.newEnemyBuffs.stunResist=sr_ep*0.5 }
      result.log = `💥 爆裂拳！ ${enemy.name}に${result.dmg}ダメージ！${sh_ep?' スタン！':''}`; break
    }
    // ── サイキッカー ──
    case 'サイコショット': {
      result.dmg = Math.max(1, Math.floor((eff.atk*1.0+eff.matk*0.3)*am) - calcMinDef())
      result.log = `🔮 サイコショット！ ${enemy.name}に${result.dmg}ダメージ！`; break
    }
    case 'マインドブレイク': {
      result.dmg = Math.max(1, Math.floor((eff.atk*1.0+eff.matk*0.5)*am) - calcMinDef())
      result.log = `🔮 マインドブレイク！ ${enemy.name}に${result.dmg}ダメージ！`; break
    }
    case '精神集中': result.newPlayerBuffs.atkUp={turns:2,rate:1.6}; result.newPlayerBuffs.matkUp={turns:2,rate:1.6}; result.log = `🔮 精神集中！ 2ターンの間、攻撃力・特殊攻撃力が大幅上昇！`; break
    case 'サイコブラスト': {
      result.dmg = Math.max(1, Math.floor((eff.atk*1.5+eff.matk*0.7)*am) - calcMinDef())
      result.log = `🔮 サイコブラスト！ ${enemy.name}に${result.dmg}の念動力ダメージ！`; break
    }
    // ── 体術師 ──
    case '半月蹴り':   result.dmg = Math.floor(eff.atk*1.3*am); result.log = `🦵 半月蹴り！ ${enemy.name}に${result.dmg}ダメージ！`; break
    case '五連殺': {
      const d1 = Math.floor(eff.atk*0.3*am)
      result.dmg = d1*5; result.log = `🦵 五連殺！ ${enemy.name}に${d1}×5=${result.dmg}ダメージ！`; break
    }
    case '破衝掌':     result.dmg = Math.floor(eff.atk*1.7*am); result.log = `🦵 破衝掌！ ${enemy.name}に${result.dmg}の衝撃ダメージ！`; break
    case '飛天三角蹴り': {
      const h1 = Math.floor(eff.atk*0.4*am)
      if (Math.random() < 0.2) { result.dmg=0; result.log=`🦵 飛天三角蹴り！ 1撃目が外れた！`; break }
      const h2 = Math.floor(eff.atk*0.7*am)
      if (Math.random() < 0.2) { result.dmg=h1; result.log=`🦵 飛天三角蹴り！ ${h1}ダメージ → 2撃目が外れた！`; break }
      const h3 = Math.floor(eff.atk*1.1*am)
      result.dmg = h1+h2+h3; result.log=`🦵 飛天三角蹴り！ ${h1}→${h2}→${h3}！ 合計${result.dmg}ダメージ！`; break
    }
    // ── 魔銃士 ──
    case '魔弾': {
      result.dmg = Math.max(1, Math.floor((eff.atk*0.7+eff.matk*0.7)*am) - calcMinDef())
      result.log = `🔫 魔弾！ ${enemy.name}に${result.dmg}ダメージ！`; break
    }
    case '連装銃撃': {
      const hitDmg = Math.max(1, Math.floor((eff.atk*0.2+eff.matk*0.2)*am))
      result.dmg = Math.max(1, hitDmg*4 - calcMinDef())
      result.log = `🔫 連装銃撃！ ${enemy.name}に${hitDmg}×4=${result.dmg}ダメージ！`; break
    }
    case '強化装填':   result.newPlayerBuffs.atkUp={turns:3,rate:1.5}; result.newPlayerBuffs.matkUp={turns:3,rate:1.5}; result.log = `🔫 強化装填！ 3ターンの間、攻撃力・特殊攻撃力が大幅上昇！`; break
    case 'キャノネスチュームビンド': {
      const cannonMult = prevSkill === 'キャノネスチュームビンド' ? 1.1 : 1.0
      result.dmg = Math.max(1, Math.floor((eff.atk*1.0+eff.matk*1.0)*am*cannonMult) - calcMinDef())
      result.log = `🔫 キャノネスチュームビンド！ ${enemy.name}に${result.dmg}の魔法ダメージ！${cannonMult>1.0?' 連続使用で威力上昇！':''}`; break
    }
    default: result.dmg = Math.max(1,eff.atk*am); result.log = `攻撃！ ${enemy.name}に${result.dmg}ダメージ！`
  }
  // パピアは状態異常・ステータス減少免疫
  if (enemy.isPapia) {
    const immuneKeys = ['defDown','mdefDown','atkDown','matkDown','spdDown','poison','bleed','burn','stun','paralysis','healDown','dmgDown','severePoisoin','curseDmg']
    immuneKeys.forEach(k => { result.newEnemyBuffs[k] = enemyBuffs[k] })
  }
  return result
}

// ============================================================
// 敵スキル実行（BOSSと一部雑魚）
// ============================================================
const executeEnemySkill = (skill, enemy, enemyHp, enemyMaxHp, playerHp, profileHpMax, playerBuffs, enemyBuffs, logs, eff) => {
  let dmgToPlayer = 0
  let healEnemy = 0
  const newPlayerBuffs = { ...playerBuffs }
  const newEnemyBuffs = { ...enemyBuffs }

  const enemyDmgDown = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
  switch (skill.type) {
    case 'physical': {
      const pDef = Math.max(1, (eff?.def || 0) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1))
      const base = Math.floor(enemy.atk * enemy.atk / Math.max(1, enemy.atk + pDef))
      const rawDmg = Math.max(1, Math.floor(base * skill.mult))
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const defRankRed = calcDefReduction(eff?.def || 0)
      dmgToPlayer = Math.floor(rawDmg * enemyDmgDown * dmgReduceRate * (1 - defRankRed) * (0.9 + Math.random() * 0.2))
      logs.push({ text:`⚔ ${enemy.name}の「${skill.name}」！ あなたに${dmgToPlayer}ダメージ！`, color:'#ff4444' })
      break
    }
    case 'magical': {
      const pMdef = Math.max(1, (eff?.mdef || 0) * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1))
      const eMatk = enemy.matk || enemy.atk
      const base = Math.floor(eMatk * eMatk / Math.max(1, eMatk + pMdef))
      const rawDmg = Math.max(1, Math.floor(base * skill.mult))
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const defRankRed = calcDefReduction(eff?.mdef || 0)
      dmgToPlayer = Math.floor(rawDmg * enemyDmgDown * dmgReduceRate * (1 - defRankRed) * (0.9 + Math.random() * 0.2))
      logs.push({ text:`✨ ${enemy.name}の「${skill.name}」！ あなたに${dmgToPlayer}の魔法ダメージ！`, color:'#cc44ff' })
      if (skill.debuff === 'mdefDown') {
        newPlayerBuffs.mdefDown = { turns: skill.debuffTurns||2, rate: skill.debuffRate||0.8 }
        logs.push({ text:`特殊防御力が低下した！`, color:'#cc44ff' })
      }
      break
    }
    case 'physical_multi': {
      const pDef = Math.max(1, (eff?.def || 0) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1))
      const base = Math.floor(enemy.atk * enemy.atk / Math.max(1, enemy.atk + pDef))
      const perHit = Math.max(1, Math.floor(base * skill.mult))
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const defRankRed = calcDefReduction(eff?.def || 0)
      dmgToPlayer = Math.floor(perHit * (skill.hits||1) * enemyDmgDown * dmgReduceRate * (1 - defRankRed) * (0.9 + Math.random() * 0.2))
      logs.push({ text:`⚔ ${enemy.name}の「${skill.name}」！ ${perHit}×${skill.hits}回＝${dmgToPlayer}ダメージ！`, color:'#ff4444' })
      break
    }
    case 'heal': {
      const healDownRate = enemyBuffs.healDown?.turns > 0 ? enemyBuffs.healDown.rate : 1.0
      healEnemy = Math.floor(enemyMaxHp * skill.rate * healDownRate)
      logs.push({ text:`💚 ${enemy.name}の「${skill.name}」！ HPが${healEnemy}回復した！`, color:'#44ff88' })
      break
    }
    case 'debuff': {
      if (playerBuffs.statusImmune?.turns > 0) {
        logs.push({ text:`🛡 ${enemy.name}の「${skill.name}」！ しかし狂信で無効化した！`, color:'#ffcc00' })
      } else {
        if (skill.effect === 'spdDown') newPlayerBuffs.spdDown = { turns: skill.turns||2, rate: skill.rate||0.8 }
        if (skill.effect === 'atkDown') newPlayerBuffs.atkDown = { turns: skill.turns||2, rate: skill.rate||0.8 }
        logs.push({ text:`⬇ ${enemy.name}の「${skill.name}」！ あなたのステータスが低下した！`, color:'#ff8844' })
      }
      break
    }
    case 'buff': {
      if (skill.effect === 'defUp')     newEnemyBuffs.defUp    = { turns: skill.turns||2, rate: skill.rate||1.25 }
      if (skill.effect === 'mdefUp')    newEnemyBuffs.mdefUp   = { turns: skill.turns||2, rate: skill.rate||1.25 }
      if (skill.effect === 'atkSpdUp')  { newEnemyBuffs.atkUp  = { turns: skill.turns||2, rate: skill.atkRate||1.3 }; newEnemyBuffs.spdUp = { turns: skill.turns||2, rate: skill.spdRate||1.2 } }
      if (skill.effect === 'defMdefUp') { newEnemyBuffs.defUp  = { turns: skill.turns||2, rate: skill.defRate||1.4 }; newEnemyBuffs.mdefUp = { turns: skill.turns||2, rate: skill.mdefRate||1.4 } }
      if (skill.effect === 'atkMatkUp') { newEnemyBuffs.atkUp  = { turns: skill.turns||2, rate: skill.atkRate||1.4 }; newEnemyBuffs.matkUp = { turns: skill.turns||2, rate: skill.matkRate||1.4 } }
      if (skill.effect === 'matkUp')    newEnemyBuffs.matkUp   = { turns: skill.turns||2, rate: skill.rate||1.25 }
      logs.push({ text:`⬆ ${enemy.name}の「${skill.name}」！ ${enemy.name}のステータスが上昇した！`, color:'#ffaa00' })
      break
    }
  }
  return { dmgToPlayer, healEnemy, newPlayerBuffs, newEnemyBuffs }
}

// JST日付文字列（ダンジョン0時リセット用）
const getJSTDateStr = () => new Date(Date.now() + 9*60*60*1000).toISOString().slice(0, 10)

// パピア出現率アップイベント時間帯（JST）: 8:00 / 12:00 / 16:00 / 22:00 から30分
const PAPIA_EVENT_HOURS = [8, 12, 16, 22]
const getPapiaEventStatus = () => {
  const now = Date.now()
  const jstNow = new Date(now + 9*60*60*1000)
  const h = jstNow.getUTCHours()
  const m = jstNow.getUTCMinutes()
  const totalMin = h * 60 + m
  for (const startH of PAPIA_EVENT_HOURS) {
    const startMin = startH * 60
    const endMin = startMin + 30
    if (totalMin >= startMin && totalMin < endMin) {
      const remaining = endMin - totalMin - 1
      const remainSec = 60 - jstNow.getUTCSeconds()
      return { active: true, remainingMin: remaining, remainingSec: remainSec }
    }
  }
  const allMins = PAPIA_EVENT_HOURS.map(h => h * 60)
  const nextMin = allMins.find(m => m > totalMin) ?? (allMins[0] + 24*60)
  const untilNext = nextMin - totalMin
  return { active: false, untilNextMin: untilNext }
}

// ============================================================
// メインコンポーネント
// ============================================================
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
  const [selectedArea, setSelectedArea] = useState(() => Number(localStorage.getItem('selectedArea') || 1))
  const [regenRemaining, setRegenRemaining] = useState(0)
  const [innMessage, setInnMessage] = useState('')
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [classLevels, setClassLevels] = useState([])
  const [templeMessage, setTempleMessage] = useState('')
  const [skillSets, setSkillSets] = useState([])
  const [playerItem, setPlayerItem] = useState(null)
  const [dungeonAttempts, setDungeonAttempts] = useState(5)
  const [showDungeonPanel, setShowDungeonPanel] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [showMenu, setShowMenu] = useState(false)
  const [showAnnouncements, setShowAnnouncements] = useState(false)
  const [announcements, setAnnouncements] = useState([])
  const [showGuide, setShowGuide] = useState(false)
  const [openGuideId, setOpenGuideId] = useState(null)
  const [openAnnouncementId, setOpenAnnouncementId] = useState(null)
  const [pendingClassChange, setPendingClassChange] = useState(null)
  const [hasNewAnnouncements, setHasNewAnnouncements] = useState(false)
  const [retrainingModal, setRetrainingModal] = useState(false)
  const [selectedCarrySkill, setSelectedCarrySkill] = useState(null)
  const [retrainingSkills, setRetrainingSkills] = useState([])
  const [retrainingClass, setRetrainingClass] = useState(null)
  const [retrainingMessage, setRetrainingMessage] = useState('')
  const [newAnnouncementPopup, setNewAnnouncementPopup] = useState(false)
  const [seenAnnouncementIds, setSeenAnnouncementIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bf_seenAnnouncements') || '[]') } catch { return [] }
  })
  const expTrackerRef = useRef({ start: null, total: 0 })
  const battleCountTrackerRef = useRef({ start: null, count: 0 })
  const regenningRef = useRef(false)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => { fetchProfile() }, [])
  useEffect(() => { fetchAnnouncements() }, [])

  useEffect(() => {
    const onFocus = () => { fetchProfile() }
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchProfile() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (!profile) return
    const id = setInterval(() => {
      const elapsed = (Date.now()-new Date(profile.last_action_at).getTime())/1000
      const rem = Math.max(0, WAIT_SECONDS-elapsed)
      setRemaining(rem)
      setCanAct(rem === 0)
      const regenElapsed = (Date.now()-new Date(profile.last_regen_at).getTime())/1000
      const regenRem = Math.max(0, REGEN_SECONDS-regenElapsed)
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
    // selectedAreaがこのアカウントで解放済みかチェック（別アカウントのlocalStorage値を弾く）
    const unlocked = data.unlocked_areas || [1]
    const savedArea = Number(localStorage.getItem('selectedArea') || 1)
    if (!unlocked.includes(savedArea)) {
      setSelectedArea(1)
      localStorage.setItem('selectedArea', 1)
    }
    // クエリ失敗時(null)は既存ステートを保持し、正常な空配列のみ反映する
    const { data: eq } = await supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', user.id)
    if (Array.isArray(eq)) setEquipment(eq)
    const { data: prof } = await supabase.from('proficiency').select('*, weapons(*)').eq('player_id', user.id)
    if (Array.isArray(prof)) setProficiency(prof)
    const { data: cl } = await supabase.from('class_levels').select('*').eq('player_id', user.id)
    if (Array.isArray(cl)) setClassLevels(cl)
    const { data: ss } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', user.id).order('slot_order')
    if (Array.isArray(ss)) setSkillSets(ss)
    const { data: pi } = await supabase.from('player_items').select('*, items(*)').eq('player_id', user.id).eq('equipped', true).single()
    setPlayerItem(pi || null)
    const today = getJSTDateStr()
    try {
      const { data: da } = await supabase.from('dungeon_attempts').select('count').eq('player_id', user.id).eq('date', today).single()
      setDungeonAttempts(da?.count || 0)
    } catch { setDungeonAttempts(0) }
  }

  const doRegen = async () => {
    if (!profile) return
    if (regenningRef.current) return  // 多重起動ガード
    regenningRef.current = true
    try {
      const current = profile.hp_current ?? profile.hp_max
      const newHp = Math.min(profile.hp_max, Math.floor(current+profile.hp_max*0.2))
      const newMp = Math.min(profile.mp_max, Math.floor((profile.mp_current??profile.mp_max)+profile.mp_max*0.2))
      const newIsDying = newHp >= profile.hp_max ? false : profile.is_dying
      await supabase.from('profiles').update({
        hp_current:newHp, mp_current:newMp, is_dying:newIsDying,
        last_regen_at:new Date().toISOString(),
      }).eq('id', profile.id)
      await fetchProfile()
    } finally {
      regenningRef.current = false
    }
  }

  const doChangeClass = async (targetClass) => {
    setLoading(true); setTempleMessage('')
    const currentClassData = classLevels.find(cl => cl.class_name === profile.class)
    if (currentClassData) {
      await supabase.from('class_levels').update({ lv:profile.lv, exp:profile.exp }).eq('id', currentClassData.id)
    }
    const targetClassData = classLevels.find(cl => cl.class_name === targetClass)
    const targetLv = targetClassData ? targetClassData.lv : 1
    const targetExp = targetClassData ? targetClassData.exp : 0
    if (!targetClassData) {
      await supabase.from('class_levels').insert({ player_id:profile.id, class_name:targetClass, lv:1, exp:0 })
    }
    const { data: allCl } = await supabase.from('class_levels').select('*').eq('player_id', profile.id)
    const updatedCls = (allCl||[]).map(cl => cl.class_name === profile.class ? { ...cl, lv:profile.lv } : cl)
    const targetExists = updatedCls.find(cl => cl.class_name === targetClass)
    if (!targetExists) updatedCls.push({ class_name:targetClass, lv:1 })
    const newCharLv = updatedCls.reduce((sum, cl) => {
      if (cl.class_name === targetClass) return sum + (cl.lv || 1)
      return cl.lv > 1 ? sum + cl.lv : sum
    }, 0)
    await supabase.from('profiles').update({
      class:targetClass, lv:targetLv, exp:targetExp, exp_next:calcExpNext(targetLv),
      char_lv:newCharLv,
    }).eq('id', profile.id)
    await fetchProfile()
    setTempleMessage(`${targetClass}に転職しました！`)
    setLoading(false)
  }

  const openRetrainingModal = async () => {
    const targetClass = profile.class  // モーダルを開いた時点のクラスを記録
    const { data: ps } = await supabase.from('player_skills')
      .select('*, skills(*)')
      .eq('player_id', profile.id)
    const classSkills = (ps || []).filter(s =>
      s.skills?.class_name === targetClass && !s.is_carried_over
    )
    setRetrainingClass(targetClass)
    setRetrainingSkills(classSkills)
    setSelectedCarrySkill(null)
    setRetrainingModal(true)
  }

  const doRetraining = async () => {
    const targetClass = retrainingClass || profile.class
    const currentCount = (profile.retraining || {})[targetClass] || 0
    if (currentCount >= 5) return
    setLoading(true)

    // 現LVまでのステータスを引いてLV20ボーナスを足す（案B）
    const currentLvStats = calcLvBonus(targetClass, profile.lv)
    const lv20Stats      = calcLvBonus(targetClass, 20)
    const statKeys = ['hp_max','mp_max','atk','def','matk','mdef','spd']
    const statUpdates = {}
    for (const k of statKeys) {
      statUpdates[k] = profile[k] - (currentLvStats[k] || 0) + (lv20Stats[k] || 0)
    }

    // レベルリセット（char_lvはそのまま維持）
    const newRetraining = { ...(profile.retraining || {}), [targetClass]: currentCount + 1 }
    await supabase.from('profiles').update({
      retraining: newRetraining,
      lv: 1,
      exp: 0,
      exp_next: calcExpNext(1),
      ...statUpdates,
    }).eq('id', profile.id)

    // class_levelsもリセット
    const clData = classLevels.find(cl => cl.class_name === targetClass)
    if (clData) await supabase.from('class_levels').update({ lv:1, exp:0 }).eq('id', clData.id)

    if (selectedCarrySkill) {
      await supabase.from('player_skills').update({ is_carried_over: true })
        .eq('player_id', profile.id).eq('skill_id', selectedCarrySkill)
    }
    await fetchProfile()
    setRetrainingModal(false)
    setSelectedCarrySkill(null)
    setRetrainingClass(null)
    const stars = '★'.repeat(currentCount + 1)
    setRetrainingMessage(`再修練完了！ ${targetClass}${stars} LV1にリセット・LV20分のステータス永続付与！`)
    setLoading(false)
  }

  const doDungeon = async (type) => {
    if (loading) return
    setLoading(true)

    // stateではなくDBから直接カウント取得（state操作による回避を防ぐ）
    const today = getJSTDateStr()
    let serverCount = 0
    try {
      const { data: da } = await supabase.from('dungeon_attempts').select('count').eq('player_id', profile.id).eq('date', today).single()
      serverCount = da?.count || 0
    } catch {}
    if (serverCount >= 6) {
      await suspendAccount('特殊ダンジョンを1日6回以上利用')
      setLoading(false)
      return
    }
    if (serverCount >= 5) {
      await suspendAccount('特殊ダンジョンを1日6回以上利用')
      setLoading(false)
      return
    }

    // 出撃と共通の10秒クールダウン＋釣り中チェック（サーバー側）
    const { data: latestForDungeon } = await supabase.from('profiles').select('last_action_at, is_fishing').eq('id', profile.id).single()
    const dungeonElapsed = (Date.now() - new Date(latestForDungeon.last_action_at).getTime()) / 1000
    if (dungeonElapsed < WAIT_SECONDS) { setLoading(false); return }
    if (latestForDungeon.is_fishing) {
      setBattleLogs([{ text:'🎣 釣り中は特殊ダンジョンに入れません。先に釣りを終了してください。', color:'#ff8844' }])
      setScene('battle'); setLoading(false); return
    }

    setScene('battle'); setBattleLogs([])

    const DUNGEON_ENEMIES = {
      exp:   { name:'かもすけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      gold:  { name:'かねすけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      stone: { name:'いしすけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      prof:  { name:'かかし',   hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
    }
    const dungeonEnemy = DUNGEON_ENEMIES[type]
    const logs = []
    logs.push({ text:`✨ 特殊ダンジョン: ${dungeonEnemy.name}が現れた！`, color:'#cc44ff' })

    const eff = calcEffectiveStats(profile, equipment, proficiency)
    const dmg = Math.max(1, Math.floor(eff.atk * (0.9 + Math.random() * 0.2)))
    logs.push({ text:`1ターン目: あなたの攻撃！ ${dungeonEnemy.name}に${dmg}ダメージ！`, color:'#ffcc00' })
    logs.push({ text:`${dungeonEnemy.name}を倒した！`, color:'#44ff88' })

    const newCount = serverCount + 1

    if (type === 'exp') {
      const expGained = Math.floor(50 + Math.random() * 51)
      const currentClassLvD = classLevels.find(cl => cl.class_name === profile.class)?.lv || profile.lv
      const capD = getEffectiveCap(profile.class)
      if (profile.exp_frozen) {
        logs.push({ text:`EXP +${expGained}（調査中につき停止）`, color:'#446688' })
      } else if (currentClassLvD < capD) {
        let newExp = profile.exp + expGained
        let newLv = profile.lv
        let newExpNext = profile.exp_next
        let newPendingPoints = profile.pending_stat_points || 0
        let newCharLv = profile.char_lv || 1
        const growth = JOB_GROWTH[profile.class] || JOB_GROWTH['戦士']
        const bonusSlots = JOB_LEVEL3_BONUS[profile.class] || []
        let statUpdates = {}
        while (newExp >= newExpNext && newLv < capD) {
          newExp -= newExpNext; newLv++; newExpNext = calcExpNext(newLv); newPendingPoints++; newCharLv++
          statUpdates = {
            hp_max:(statUpdates.hp_max||profile.hp_max)+growth.hp, mp_max:(statUpdates.mp_max||profile.mp_max)+growth.mp,
            atk:(statUpdates.atk||profile.atk)+growth.atk, def:(statUpdates.def||profile.def)+growth.def,
            matk:(statUpdates.matk||profile.matk)+growth.matk, mdef:(statUpdates.mdef||profile.mdef)+growth.mdef,
            spd:(statUpdates.spd||profile.spd)+growth.spd,
          }
          if (bonusSlots.length > 0 && newLv%3===0) {
            const bi = Math.floor(newLv/3-1)%bonusSlots.length
            statUpdates[bonusSlots[bi]] = (statUpdates[bonusSlots[bi]]||0)+1
          }
          logs.push({ text:`★ LEVEL UP！ ${profile.class} LV${newLv}！`, color:'#cc44ff' })
        }
        await supabase.from('profiles').update({
          exp:newExp, exp_next:newExpNext, lv:newLv,
          pending_stat_points:newPendingPoints, char_lv:newCharLv, ...statUpdates,
        }).eq('id', profile.id)
        const clData = classLevels.find(cl => cl.class_name === profile.class)
        if (clData) await supabase.from('class_levels').update({ lv:newLv, exp:newExp }).eq('id', clData.id)
        logs.push({ text:`EXP +${expGained}`, color:'#cc8800' })
      } else {
        logs.push({ text:`⚠ レベルキャップに達しています（EXP +0）`, color:'#ff8844' })
      }
    } else if (type === 'gold') {
      const goldGained = Math.floor((profile.char_lv || profile.lv) * 10 * (1.0 + Math.random() * 0.5))
      await supabase.from('profiles').update({ gold: profile.gold + goldGained }).eq('id', profile.id)
      logs.push({ text:`Gold +${goldGained}`, color:'#ffcc00' })
    } else if (type === 'stone') {
      const r = Math.random() * 100
      const stoneName = r < 10 ? '強化石(F)' : r < 25 ? '強化石(E)' : r < 55 ? '強化石(D)' : r < 80 ? '強化石(C)' : r < 95 ? '強化石(B)' : '強化石(A)'
      const { data: stoneItem } = await supabase.from('items').select('*').eq('name', stoneName).single()
      if (stoneItem) {
        let existing = null
        try { const res = await supabase.from('player_items').select('*').eq('player_id', profile.id).eq('item_id', stoneItem.id).single(); existing = res.data } catch {}
        if (existing) {
          await supabase.from('player_items').update({ quantity:(existing.quantity||1)+1 }).eq('id', existing.id)
        } else {
          await supabase.from('player_items').insert({ player_id:profile.id, item_id:stoneItem.id, quantity:1, equipped:false })
        }
      }
      logs.push({ text:`💎 ${stoneName} を入手！`, color:'#6699cc' })
    } else if (type === 'prof') {
      const profGained = Math.floor(50 + Math.random() * 51)
      const eqWeapon = equipment.find(e => e.slot==='weapon' && e.equipped)
      if (eqWeapon) {
        const prof = proficiency.find(p => p.equipment_id===eqWeapon.id)
        if (prof) {
          let totalExp = prof.prof_exp + profGained
          let newProfLv = prof.prof_lv
          while (totalExp >= 100 && newProfLv < 300) { totalExp -= 100; newProfLv++ }
          if (newProfLv >= 300) totalExp = 0
          await supabase.from('proficiency').update({ prof_exp:totalExp, prof_lv:newProfLv }).eq('id', prof.id)
          if (newProfLv > prof.prof_lv) logs.push({ text:`⚔ 武器熟練度UP！ ${getProfPrefix(newProfLv)}${eqWeapon.weapons.name} LV${newProfLv}`, color:'#aa44ff' })
          logs.push({ text:`⚔ 武器熟練度 +${profGained}`, color:'#aa44ff' })
        } else {
          logs.push({ text:`武器熟練度なし`, color:'#446688' })
        }
      } else {
        logs.push({ text:`武器が装備されていません`, color:'#446688' })
      }
    }

    // dungeon_attempts更新
    try {
      const { data: da } = await supabase.from('dungeon_attempts').select('*').eq('player_id', profile.id).eq('date', today).single()
      if (da) {
        await supabase.from('dungeon_attempts').update({ count: newCount }).eq('id', da.id)
      } else {
        await supabase.from('dungeon_attempts').insert({ player_id:profile.id, date:today, count:1 })
      }
    } catch {
      try { await supabase.from('dungeon_attempts').insert({ player_id:profile.id, date:today, count:1 }) } catch {}
    }
    await supabase.from('profiles').update({ last_action_at: new Date().toISOString() }).eq('id', profile.id)
    setDungeonAttempts(newCount)
    setBattleLogs(logs)
    await fetchProfile()
    setLoading(false)
  }

  const DEV_ACCOUNTS = ['おれおれお']
  const suspendAccount = async (reason) => {
    if (DEV_ACCOUNTS.includes(profile.username)) return  // 開発用アカウントはBAN対象外
    await supabase.from('profiles').update({
      is_suspended: true,
      suspension_reason: reason,
    }).eq('id', profile.id)
    setBattleLogs([{ text:`⛔ 不正行為が検出されました。アカウントを停止します。`, color:'#ff4444' }])
    setScene('battle')
    setTimeout(async () => { await supabase.auth.signOut() }, 3000)
  }

  const doBattle = async (e) => {
    if (!canAct || loading) return
    // 自動操作検知（isTrusted=falseは人間の操作ではない）
    if (e && !e.isTrusted) { await suspendAccount('自動操作が検出されました'); return }
    // 未解放エリアへのアクセスガード（localStorage汚染対策）
    const unlockedAreas = profile.unlocked_areas || [1]
    if (!unlockedAreas.includes(selectedArea)) {
      setSelectedArea(1); localStorage.setItem('selectedArea', 1); return
    }
    // 釣り中は出撃不可
    if (profile.is_fishing) {
      setBattleLogs([{ text:'🎣 釣り中は出撃できません。先に釣りを終了してください。', color:'#ff8844' }])
      setScene('battle'); return
    }
    const hpCurrent = profile.hp_current ?? profile.hp_max
    if (hpCurrent <= 0) return
    if (profile.is_dying && hpCurrent < profile.hp_max) return
    if (!DEV_ACCOUNTS.includes(profile.username) && profile.battle_ban_until && new Date(profile.battle_ban_until) > new Date()) {
      const banEnd = new Date(profile.battle_ban_until)
      const diffMs = banEnd - new Date()
      const diffH = Math.floor(diffMs / 3600000)
      const diffM = Math.ceil((diffMs % 3600000) / 60000)
      setBattleLogs([{ text:`⛔ 異常な行動が検出されました。出撃禁止中（残り${diffH}時間${diffM}分）`, color:'#ff4444' }])
      setScene('battle')
      return
    }
    // 出撃回数カウント（1分間7回以上でアカウント停止）
    const nowBattle = Date.now()
    const bTracker = battleCountTrackerRef.current
    if (!bTracker.start || nowBattle - bTracker.start > 60000) {
      battleCountTrackerRef.current = { start: nowBattle, count: 1 }
    } else {
      battleCountTrackerRef.current = { ...bTracker, count: bTracker.count + 1 }
    }
    if (battleCountTrackerRef.current.count >= 7) {
      await suspendAccount('1分間に7回以上出撃')
      return
    }

    setLoading(true); setScene('battle'); setBattleLogs([])

    // Atomic lock: last_action_atが古い場合のみUPDATE（複数端末同時出撃・釣り中出撃を防ぐ）
    const lockTime = new Date(Date.now() - WAIT_SECONDS * 1000).toISOString()
    const { data: locked } = await supabase.from('profiles')
      .update({ last_action_at: new Date().toISOString() })
      .eq('id', profile.id)
      .lt('last_action_at', lockTime)
      .eq('is_fishing', false)
      .select('id')
    if (!locked || locked.length === 0) {
      setLoading(false); setScene('town'); await fetchProfile(); return
    }

    const currentClassLv = classLevels.find(cl => cl.class_name === profile.class)?.lv || profile.lv
    const cap = getEffectiveCap(profile.class)
    const isAtCap = currentClassLv >= cap

    const eff = calcEffectiveStats(profile, equipment, proficiency)
    const area = AREAS.find(a => a.id === selectedArea)
    const bossRate = profile.boss_encounter_rate || 0
    const isBossEncounter = Math.random()*100 < bossRate
    const papiaRate = getPapiaEventStatus().active ? 2 : 1
    const isPapiaEncounter = !isBossEncounter && Math.random()*100 < papiaRate
    const enemy = isPapiaEncounter
      ? { ...PAPIA }
      : isBossEncounter
        ? { ...area.boss }
        : { ...area.enemies[Math.floor(Math.random()*area.enemies.length)] }
    const enemyMaxHp = enemy.hp

    const logs = []
    let playerHp = hpCurrent
    let playerMp = profile.mp_current ?? profile.mp_max
    let enemyHp = enemy.hp
    let turn = 1, skillIndex = 0
    let playerBuffs = {}, enemyBuffs = {}
    let currentItem = playerItem ? { ...playerItem } : null
    let itemUsed = false
    let prevSkillName = null
    // BOSS回復管理
    let bossHealUsed = false
    let bossHealCooldown = 0
    let papiaEscaped = false

    const equippedWeaponItem = equipment.find(e => e.slot==='weapon' && e.equipped)
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

    const passiveCritBonus   = hasShingan ? 5 : 0
    const passiveDmgMult     = (hasShingan ? 1.05 : 1.0) * (hasBerserk ? 1.2 : 1.0) * (hasKakushin ? 1.1 : 1.0)
    const passiveHealMult    = (hasShinkoka ? 1.2 : 1.0) * (hasKakushin ? 0.7 : 1.0)
    const passiveMatkMult    = hasShinkoka ? 1.1 : 1.0
    const passiveMpCostMult  = hasTenki ? 0.9 : 1.0
    const passiveMatkMultTenki = hasTenki ? 1.1 : 1.0
    const passiveHitBonus    = (hasRokkan ? 5 : 0) + (hasSeimitsu ? 5 : 0)

    if (isBossEncounter && currentItem && currentItem.items.effect === 'boss_avoid') {
      logs.push({ text:`🧿 魔よけのお守りが光り、ボスとの戦闘を避けた！`, color:'#cc44ff' })
      setBattleLogs([...logs])
      const newQty = (currentItem.quantity||1)-1
      if (newQty <= 0) await supabase.from('player_items').delete().eq('id', currentItem.id)
      else await supabase.from('player_items').update({ quantity:newQty }).eq('id', currentItem.id)
      await supabase.from('profiles').update({ boss_encounter_rate:0, last_action_at:new Date().toISOString() }).eq('id', profile.id)
      await fetchProfile(); setLoading(false); return
    }

    logs.push(isBossEncounter
      ? { text:`⚠ ボス出現！ ${enemy.name}が現れた！`, color:'#ff4444' }
      : { text:`${enemy.name}が現れた！`, color:'#88ccff' }
    )
    if (isArtifact) logs.push({ text:`⚔ アーティファクト発動！ 消費MP2倍・与ダメージ1.2倍！`, color:'#ffcc00' })
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
    const enemySpd = enemy.spd||5
    const playerExtraRate = calcExtraActionRate(playerSpd, enemySpd)
    const enemyExtraRate  = calcExtraActionRate(enemySpd, playerSpd)
    const playerCritRate  = calcCritRate(playerSpd, enemySpd) + passiveCritBonus + (eff.critBonus || 0)
    const enemyCritRate   = Math.max(0, calcCritRate(enemySpd, playerSpd) - (playerBuffs.critResist?.turns > 0 ? (playerBuffs.critResist.value||0) : 0))

    // プレイヤーの回避率（敵が攻撃するとき）
    const playerEvasionRate = calcEvasionRate(effectiveSpdForCalc, enemySpd)
    // 敵の回避率（プレイヤーが攻撃するとき）
    const enemyEvasionRate  = calcEvasionRate(enemySpd, effectiveSpdForCalc)
    // プレイヤーの命中ボーナス（アクアクラウンなど）
    const playerHitBonus = (eff.hitBonus || 0) + passiveHitBonus

    const doPlayerAttack = (isExtra=false) => {
      const pDef   = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1)
      const pMdef  = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1)
      const burnDebuffP = playerBuffs.burn?.turns > 0 ? 0.9 : 1.0
      const pMatk  = eff.matk * (playerBuffs.matkUp ? playerBuffs.matkUp.rate : 1) * passiveMatkMult * passiveMatkMultTenki * burnDebuffP
      const pAtk   = eff.atk  * (playerBuffs.atkUp  ? playerBuffs.atkUp.rate  : 1) * (playerBuffs.atkDown ? playerBuffs.atkDown.rate : 1) * burnDebuffP
      const paralysisSpdP = playerBuffs.paralysis?.turns > 0 ? (playerBuffs.paralysis.spdRate || 0.8) : 1.0
      const pSpd   = effectiveSpdForCalc * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1) * paralysisSpdP
      const effBuff = { ...eff, atk:pAtk, def:pDef, mdef:pMdef, matk:pMatk, spd:pSpd }
      const eDefRate  = (enemyBuffs.defDown  ? enemyBuffs.defDown.rate  : 1) * (enemyBuffs.defUp  ? enemyBuffs.defUp.rate  : 1)
      const eMdefRate = (enemyBuffs.mdefDown ? enemyBuffs.mdefDown.rate : 1) * (enemyBuffs.mdefUp ? enemyBuffs.mdefUp.rate : 1)
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
      const isCrit = Math.random()*100 < playerCritRate
      const critMult = isCrit ? 1.5 : 1.0

      // 敵の回避判定（プレイヤーの命中ボーナスで相殺、パピアは+50%）
      const buffHitBonus = playerBuffs.hitBonus?.turns > 0 ? playerBuffs.hitBonus.value : 0
      // 次のスキルが絶影狙撃（必中）なら回避無効
      const peekIdx = playerBuffs.berserk?.turns > 0 && playerBuffs.berserk.lockedSkill
        ? expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
        : (skillIndex % (expandedSkillSet.length || 1))
      const nextSkillName = expandedSkillSet.length > 0 ? expandedSkillSet[Math.max(0, peekIdx)]?.skills?.name : null
      const isSureHit = nextSkillName === '絶影狙撃'
      const effectiveEnemyEvasion = isSureHit ? 0 : Math.max(0, enemyEvasionRate - playerHitBonus - buffHitBonus) + (enemy.isPapia ? 50 : 0)
      if (effectiveEnemyEvasion > 0 && Math.random()*100 < effectiveEnemyEvasion) {
        logs.push({ text:`${prefix}${enemy.name}に攻撃！ しかし回避された！`, color:'#446688' })
        if (expandedSkillSet.length > 0) skillIndex++
        return
      }

      // 狂乱: 指定スキルに固定
      if (playerBuffs.berserk?.turns > 0 && playerBuffs.berserk.lockedSkill) {
        const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
        if (lockedIdx >= 0) skillIndex = lockedIdx
      }
      let skillUsed = false
      if (expandedSkillSet.length > 0) {
        const cs = expandedSkillSet[skillIndex % expandedSkillSet.length]
        let mpCost = Math.floor((isArtifact ? (cs?.skills?.mp_cost||0)*2 : (cs?.skills?.mp_cost||0)) * passiveMpCostMult)
        // マナボルト: 現在MPの10%（最低1）を消費
        if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(playerMp * 0.1))
        if (cs && cs.skills && playerMp >= mpCost) {
          playerMp -= mpCost
          const hasGensoKyomei = passiveNames.includes('元素共鳴')
          const gensoMult = (hasGensoKyomei && prevSkillName && prevSkillName !== cs.skills.name) ? 1.1 : 1.0
          prevSkillName = cs.skills.name
          const res = executeSkill(cs.skills, {...effBuff, lastMpCost:mpCost}, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
          const finalCrit = res.dmg > 0 && (isCrit || (res.bonusCritRate > 0 && Math.random()*100 < playerCritRate + res.bonusCritRate))
          const finalCritMult = finalCrit ? 1.5 : 1.0
          const tosoMult = (hasTosoHonno && playerHp <= profile.hp_max * 0.5) ? 1.1 : 1.0
          // ②DEFスケーリング：物理=ATK/(ATK+敵DEF)、魔法=MATK/(MATK+敵MDEF)
          let defScale = 1.0
          if (res.dmg > 0) {
            const sType = cs.skills?.type
            const adjED  = Math.max(1, Math.floor((enemy.def ||0)*eDefRate))
            const adjEMD = Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate))
            if (sType === '物理攻撃') defScale = effBuff.atk  / (effBuff.atk  + adjED)
            else if (sType === '魔法攻撃') defScale = effBuff.matk / (effBuff.matk + adjEMD)
          }
          let finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * (0.9 + Math.random() * 0.2))
          if (enemy.isPapia && res.dmg > 0) finalDmg = 1
          const resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
          if (res.selfDmg > 0) playerHp = Math.max(0, playerHp - res.selfDmg)
          if (playerBuffs.bloodRage?.turns > 0 && finalDmg > 0) {
            const rageCure = Math.floor(finalDmg * playerBuffs.bloodRage.healRate)
            playerHp = Math.min(profile.hp_max, playerHp + rageCure)
            logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
          }
          enemyHp -= finalDmg
          const healAmt = Math.floor(res.heal * passiveHealMult)
          playerHp = Math.min(profile.hp_max, playerHp + healAmt)
          playerBuffs = res.newPlayerBuffs; enemyBuffs = res.newEnemyBuffs
          const critText = finalCrit ? ' 💥クリティカル！' : ''
          logs.push({ text:`${prefix}${resLog}${critText}`, color:finalCrit?'#ff4444':'#88ccff' })
          skillUsed = true; skillIndex++
        }
      }
      if (!skillUsed) {
        const baseAtk = isMagical ? effBuff.matk : effBuff.atk
        const eDefVal = isMagical ? Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate)) : Math.max(1, Math.floor(enemy.def*eDefRate))
        // ②通常攻撃: ATK²/(ATK+敵DEF)
        const baseDmg = Math.max(1, Math.floor(baseAtk*baseAtk/Math.max(1,baseAtk+eDefVal))+Math.floor(Math.random()*4))
        let finalDmg = Math.floor(baseDmg*critMult*(isArtifact?1.2:1.0)*passiveDmgMult*(0.9+Math.random()*0.2))
        if (enemy.isPapia) finalDmg = 1
        if (playerBuffs.bloodRage?.turns > 0 && finalDmg > 0) {
          const rageCure = Math.floor(finalDmg * playerBuffs.bloodRage.healRate)
          playerHp = Math.min(profile.hp_max, playerHp + rageCure)
          logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
        }
        enemyHp -= finalDmg
        const critText = isCrit ? ' 💥クリティカル！' : ''
        logs.push({ text:`${prefix}あなたの攻撃！ ${enemy.name}に${finalDmg}ダメージ！${critText}`, color:isCrit?'#ff4444':'#ffcc00' })
        if (expandedSkillSet.length > 0) skillIndex++
      }
    }

    const doEnemyAttack = (isExtra=false) => {
      const pDef  = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1)
      const pMdef = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1)
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const berserkDmgRate = hasBerserk ? 1.1 : 1.0
      const isEM = enemy.type === 'magical'
      const burnDebuffE = enemyBuffs.burn?.turns > 0 ? 0.9 : 1.0
      const eAtk = isEM
        ? (enemy.matk||0) * (enemyBuffs.matkUp ? enemyBuffs.matkUp.rate : 1) * burnDebuffE
        : enemy.atk * (enemyBuffs.atkUp ? enemyBuffs.atkUp.rate : 1) * burnDebuffE
      const isCrit = Math.random()*100 < enemyCritRate
      // ②敵攻撃: eATK²/(eATK+プレイヤーDEF)
      const defForCalc = isEM ? Math.max(1, pMdef) : Math.max(1, pDef)
      const baseDmg = Math.max(1, Math.floor(eAtk*eAtk/Math.max(1,eAtk+defForCalc))+Math.floor(Math.random()*3))
      const enemySpdBuff = enemyBuffs.spdUp ? enemyBuffs.spdUp.rate : 1
      const playerSpdDebuff = playerBuffs.spdDown ? playerBuffs.spdDown.rate : 1

      // プレイヤーの回避判定（素早さバフ/デバフ考慮）
      const effectivePlayerSpd = effectiveSpdForCalc * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1) * playerSpdDebuff
      const effectiveEnemySpd = enemySpd * enemySpdBuff
      const evasionRate = calcEvasionRate(effectivePlayerSpd, effectiveEnemySpd) + (eff.evasionBonus || 0) + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0)
      if (evasionRate > 0 && Math.random()*100 < evasionRate) {
        const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
        logs.push({ text:`${prefix}${enemy.name}の攻撃！ しかし回避した！`, color:'#44ff88' })
        return
      }

      const enemyDmgDownRate = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
      // ③プレイヤーDEFランクによるボーナス軽減
      const playerDefRankReduction = calcDefReduction(isEM ? eff.mdef : eff.def)
      const finalDmg = Math.floor(baseDmg*(isCrit?1.5:1.0)*dmgReduceRate*berserkDmgRate*enemyDmgDownRate*(1-playerDefRankReduction)*(0.9+Math.random()*0.2))
      playerHp -= finalDmg
      const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
      const critText = isCrit ? ' 💥クリティカル！' : ''
      logs.push({ text:`${prefix}${enemy.name}の攻撃！ あなたに${finalDmg}ダメージ…${critText}`, color:isCrit?'#ff2200':'#ff6644' })
    }

    // 敵スキル使用（BOSSおよび⑥⑦雑魚）
    const doEnemySkillAttack = () => {
      if (!enemy.skills || enemy.skills.length === 0) return
      // BOSS回復処理
      const healSkill = enemy.skills.find(s => s.type === 'heal')
      if (healSkill && enemyHp / enemyMaxHp < 0.5) {
        if (!bossHealUsed) {
          // 1回目は確定
          const result = executeEnemySkill(healSkill, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
          enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
          bossHealUsed = true
          bossHealCooldown = Math.floor(Math.random()*3)+2
          return
        } else if (bossHealCooldown <= 0) {
          // 2回目以降は2〜4ターンごと
          const result = executeEnemySkill(healSkill, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
          enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
          bossHealCooldown = Math.floor(Math.random()*3)+2
          return
        }
      }
      // 攻撃/バフ/デバフスキル
      const nonHealSkills = enemy.skills.filter(s => s.type !== 'heal')
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
        playerBuffs.dmgReduce = { turns:1, rate:0.7 }
        logs.push({ text:`💀 骸の壁発動！ このターン受けるダメージ-30%！`, color:'#cc44ff' })
      }
      // --- 状態異常ターン開始処理 ---
      // 敵への持続ダメージ
      if (enemyBuffs.severePoisoin?.turns > 0) {
        const spDmg = Math.floor(enemyMaxHp * 0.05)
        enemyHp -= spDmg
        logs.push({ text:`🤢 猛毒ダメージ！ ${enemy.name}に${spDmg}ダメージ！`, color:'#aa44ff' })
        if (enemyHp <= 0) break
      }
      if (enemyBuffs.burn?.turns > 0) {
        const burnDmg = Math.floor(enemyMaxHp * 0.02)
        enemyHp -= burnDmg
        logs.push({ text:`🔥 やけどダメージ！ ${enemy.name}に${burnDmg}ダメージ！`, color:'#ff6622' })
        if (enemyHp <= 0) break
      }
      if (enemyBuffs.bleed) {
        const bleedDmg = Math.floor(enemyMaxHp * 0.01 * enemyBuffs.bleed.stacks)
        enemyHp -= bleedDmg
        logs.push({ text:`🩸 出血ダメージ！ ${enemy.name}に${bleedDmg}ダメージ（${enemyBuffs.bleed.stacks}スタック）！`, color:'#ff4466' })
        if (enemyHp <= 0) break
        enemyBuffs.bleed.lastTurn = (enemyBuffs.bleed.lastTurn || 0) + 1
        if (enemyBuffs.bleed.lastTurn >= 3) delete enemyBuffs.bleed
      }
      if (enemyBuffs.curseDmg?.turns > 0) {
        enemyHp -= enemyBuffs.curseDmg.dmg
        logs.push({ text:`💀 呪縛ダメージ！ ${enemy.name}に${enemyBuffs.curseDmg.dmg}ダメージ！`, color:'#cc44ff' })
        if (enemyHp <= 0) break
      }
      if (enemyBuffs.poison?.turns > 0) {
        const poisonDmg = Math.floor(enemy.hp * enemyBuffs.poison.dmgRate)
        enemyHp -= poisonDmg
        logs.push({ text:`☠ 毒ダメージ！ ${enemy.name}に${poisonDmg}ダメージ！`, color:'#44ff44' })
        if (enemyHp <= 0) break
      }
      // プレイヤーへの持続ダメージ
      if (playerBuffs.severePoisoin?.turns > 0) {
        const spDmgP = Math.floor(profile.hp_max * 0.05)
        playerHp = Math.max(0, playerHp - spDmgP)
        logs.push({ text:`🤢 猛毒ダメージ！ あなたに${spDmgP}ダメージ！`, color:'#aa44ff' })
        if (playerHp <= 0) break
      }
      if (playerBuffs.burn?.turns > 0) {
        const burnDmgP = Math.floor(profile.hp_max * 0.02)
        playerHp = Math.max(0, playerHp - burnDmgP)
        logs.push({ text:`🔥 やけどダメージ！ あなたに${burnDmgP}ダメージ！`, color:'#ff6622' })
        if (playerHp <= 0) break
      }
      if (playerBuffs.bleed) {
        const bleedDmgP = Math.floor(profile.hp_max * 0.01 * playerBuffs.bleed.stacks)
        playerHp = Math.max(0, playerHp - bleedDmgP)
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
      if (playerBuffs.regenHeal?.turns > 0) {
        const healAmt = Math.floor(playerBuffs.regenHeal.amount * passiveHealMult)
        playerHp = Math.min(profile.hp_max, playerHp + healAmt)
        logs.push({ text:`💚 回復効果でHPが${healAmt}回復した！`, color:'#44ff88' })
      }
      if (playerBuffs.delayHeal && turn === playerBuffs.delayHeal.triggerTurn) {
        playerHp = Math.min(profile.hp_max, playerHp + playerBuffs.delayHeal.amount)
        logs.push({ text:`💚 装備効果でHPが${playerBuffs.delayHeal.amount}回復した！`, color:'#44ff88' })
      }
      if (currentItem && !itemUsed) {
        const threshold = currentItem.use_threshold||50
        const effect = currentItem.items.effect
        if (effect==='hp_pct' && playerHp/profile.hp_max*100 <= threshold) {
          const healAmt = Math.floor(profile.hp_max*currentItem.items.value/100)
          playerHp = Math.min(profile.hp_max, playerHp+healAmt)
          logs.push({ text:`🧪 ${currentItem.items.name}を使用！ HPが${healAmt}回復した！`, color:'#44ff88' })
          itemUsed = true
          const newQty = (currentItem.quantity||1)-1
          if (newQty <= 0) await supabase.from('player_items').delete().eq('id', currentItem.id)
          else await supabase.from('player_items').update({ quantity:newQty }).eq('id', currentItem.id)
          currentItem = null
        } else if (effect==='mp_pct' && playerMp/profile.mp_max*100 <= threshold) {
          const healAmt = Math.floor(profile.mp_max*currentItem.items.value/100)
          playerMp = Math.min(profile.mp_max, playerMp+healAmt)
          logs.push({ text:`🧪 ${currentItem.items.name}を使用！ MPが${healAmt}回復した！`, color:'#4488ff' })
          itemUsed = true
          const newQty = (currentItem.quantity||1)-1
          if (newQty <= 0) await supabase.from('player_items').delete().eq('id', currentItem.id)
          else await supabase.from('player_items').update({ quantity:newQty }).eq('id', currentItem.id)
          currentItem = null
        }
      }

      // プレイヤー行動スキップ判定（スタン・麻痺）
      let playerSkipped = false
      if (playerBuffs.stun?.turns > 0) {
        logs.push({ text:`${turn}ターン目: スタン！ あなたは行動できない！`, color:'#ffaa00' })
        playerSkipped = true
        delete playerBuffs.stun
      } else if (playerBuffs.paralysis?.turns > 0 && Math.random() < playerBuffs.paralysis.skipRate) {
        logs.push({ text:`${turn}ターン目: 麻痺で行動不能！`, color:'#ffaa00' })
        playerSkipped = true
        playerBuffs.paralysis.skipRate *= 0.5
      }
      if (!playerSkipped) {
        doPlayerAttack(false)
        if (enemyHp <= 0) break
        if (playerExtraRate > 0 && Math.random()*100 < playerExtraRate) {
          doPlayerAttack(true); if (enemyHp <= 0) break
        }
      }

      // 敵のターン：スキルを持つ敵はスキルを使う確率
      if (enemy.isPapia) {
        const papiaMsg = PAPIA_TURNS[turn - 1] || '逃走'
        if (turn >= 6) {
          logs.push({ text:`${turn}ターン目: ${papiaMsg}！ パピアは逃げた！`, color:'#ff8844' })
          papiaEscaped = true
          break
        }
        logs.push({ text:`${turn}ターン目: ${papiaMsg}`, color:'#ff8844' })
      } else {
        // 敵行動スキップ判定（スタン・麻痺）
        let enemySkipped = false
        if (enemyBuffs.stun?.turns > 0) {
          logs.push({ text:`${turn}ターン目: ${enemy.name}はスタンして行動できない！`, color:'#ffaa00' })
          enemySkipped = true
          delete enemyBuffs.stun
        } else if (enemyBuffs.paralysis?.turns > 0 && Math.random() < enemyBuffs.paralysis.skipRate) {
          logs.push({ text:`${turn}ターン目: ${enemy.name}は麻痺で行動不能！`, color:'#ffaa00' })
          enemySkipped = true
          enemyBuffs.paralysis.skipRate *= 0.5
        }
        if (!enemySkipped) {
          if (enemy.skills && enemy.skills.length > 0) {
            if (Math.random() < 0.4) doEnemySkillAttack()
            else doEnemyAttack(false)
          } else {
            doEnemyAttack(false)
          }
          if (playerHp <= 0) break
          if (enemyExtraRate > 0 && Math.random()*100 < enemyExtraRate) doEnemyAttack(true)
        }
      }
      if (playerHp <= 0) break

      // バフ/デバフのターン減少
      Object.keys(playerBuffs).forEach(k => { if (playerBuffs[k]?.turns > 0) playerBuffs[k].turns-- })
      Object.keys(enemyBuffs).forEach(k =>  { if (enemyBuffs[k]?.turns  > 0) enemyBuffs[k].turns-- })
      if (bossHealCooldown > 0) bossHealCooldown--
      turn++
    }

    playerHp = Math.max(0, playerHp)
    const win = enemyHp <= 0
    const expGained = isAtCap ? 0
      : papiaEscaped ? 0
      : isPapiaEncounter ? 200
      : isBossEncounter ? 13
      : Math.floor(Math.random()*4)+8
    const goldGained = (win && !papiaEscaped) ? (enemy.gold||0) : 0

    // 不正検知：特殊ダンジョン・パピア以外で1分間に100EXP以上取得→12時間BAN
    if (!isPapiaEncounter && expGained > 0) {
      const now = Date.now()
      const tracker = expTrackerRef.current
      if (!tracker.start || now - tracker.start > 60000) {
        expTrackerRef.current = { start: now, total: expGained }
      } else {
        expTrackerRef.current = { ...tracker, total: tracker.total + expGained }
      }
      if (expTrackerRef.current.total >= 100) {
        const banUntil = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
        await supabase.from('profiles').update({ battle_ban_until: banUntil }).eq('id', profile.id)
        expTrackerRef.current = { start: null, total: 0 }
        setBattleLogs([{ text:`⛔ 異常な行動が検出されました。12時間の出撃禁止が適用されました。`, color:'#ff4444' }])
        await fetchProfile()
        setLoading(false)
        return
      }
    }

    if (!papiaEscaped) {
      if (win) {
        logs.push({ text:`${enemy.name}を倒した！`, color:'#44ff88' })
        if (isAtCap) {
          logs.push({ text:`⚠ ${profile.class}はレベルキャップに達しています。経験値は入りません。`, color:'#ff8844' })
          logs.push({ text:`Gold + ${goldGained}`, color:'#ffcc00' })
        } else {
          logs.push({ text:`EXP + ${expGained}　Gold + ${goldGained}`, color:'#ffcc00' })
        }
      } else {
        logs.push({ text:`敗北…`, color:'#ff4444' })
        if (!isAtCap) logs.push({ text:`EXP + ${expGained}`, color:'#ff6644' })
      }
    }

    let newIsDying = profile.is_dying || false
    if (playerHp === 0) {
      newIsDying = true
      logs.push({ text:`⚠ 瀕死状態！宿屋でHP全回復してください。`, color:'#ff4444' })
    }
    setBattleLogs(logs)

    if (win && !isPapiaEncounter) {
      let droppedItems = []
      if (isBossEncounter) {
        const dropList = area.bossDrops || []
        if (dropList.length > 0) {
          const drop0 = Math.random()*100 < 3
          const drop1 = dropList.length > 1 && Math.random()*100 < 3
          if (drop0 && drop1) droppedItems = [dropList[Math.random()<0.5?0:1]]
          else if (drop0) droppedItems = [dropList[0]]
          else if (drop1) droppedItems = [dropList[1]]
        }
      } else {
        const commonDrops = area.commonDrops||[]
        const rareDrops = area.rareDrops||[]
        if (commonDrops.length > 0 && Math.random()*100 < 3) {
          if (rareDrops.length > 0 && Math.random()*100 < 10) {
            droppedItems = [rareDrops[Math.floor(Math.random()*rareDrops.length)]]
          } else {
            droppedItems = [commonDrops[Math.floor(Math.random()*commonDrops.length)]]
          }
        }
      }
      if (Math.random()*100 < 0.1) {
        droppedItems.push(ARTIFACT_BASE_NAMES[Math.floor(Math.random()*ARTIFACT_BASE_NAMES.length)])
      }
      for (const itemName of droppedItems) {
        if (itemName.startsWith('強化石')) {
          const { data: stoneItem } = await supabase.from('items').select('*').eq('name', itemName).single()
          if (stoneItem) {
            let existing = null
            try { const res = await supabase.from('player_items').select('*').eq('player_id', profile.id).eq('item_id', stoneItem.id).single(); existing = res.data } catch {}
            if (existing) {
              await supabase.from('player_items').update({ quantity: (existing.quantity||1)+1 }).eq('id', existing.id)
            } else {
              await supabase.from('player_items').insert({ player_id: profile.id, item_id: stoneItem.id, quantity: 1, equipped: false })
            }
            logs.push({ text:`💎 ${itemName} を入手した！`, color:'#6699cc' })
          }
          continue
        }
        const { data: weapon } = await supabase.from('weapons').select('*').eq('name', itemName).single()
        if (weapon) {
          const isArtifactDrop = ARTIFACT_BASE_NAMES.includes(weapon.name)
          const bonusData = isArtifactDrop ? {} : generateDropBonus(weapon)
          await supabase.from('player_equipment').insert({
            player_id:profile.id, weapon_id:weapon.id, slot:weapon.slot, equipped:false, ...bonusData,
          })
          const isRareDrop = area.rareDrops?.includes(itemName)
          const color = isArtifactDrop ? '#ffcc00' : isRareDrop ? '#44ff88' : '#ffcc00'
          const prefix = isArtifactDrop ? '🌟' : isRareDrop ? '💎✨' : '💎'
          logs.push({ text:`${prefix} ${itemName} を入手した！`, color })
          // 古びた装備を初めて入手した時だけ説明テロップ
          if (isArtifactDrop) {
            const hasExisting = equipment.some(e => ARTIFACT_BASE_NAMES.includes(e.weapons?.name))
            if (!hasExisting) {
              logs.push({ text:`📜 古びた装備を手に入れました！使い続ければまた別の使い道があるのかも…`, color:'#ffaa44' })
            }
          }
        }
      }
    }
    setBattleLogs([...logs])

    if (equippedWeaponItem) {
      const prof = proficiency.find(p => p.equipment_id===equippedWeaponItem.id)
      if (prof) {
        const profExpGained = Math.floor(Math.random()*4)+8
        let totalExp = prof.prof_exp+profExpGained
        let newProfLv = prof.prof_lv
        while (totalExp >= 100 && newProfLv < 300) { totalExp -= 100; newProfLv++ }
        if (newProfLv >= 300) totalExp = 0
        await supabase.from('proficiency').update({ prof_exp:totalExp, prof_lv:newProfLv }).eq('id', prof.id)
        if (newProfLv > prof.prof_lv) {
          logs.push({ text:`⚔ 武器熟練度UP！ ${getProfPrefix(newProfLv)}${equippedWeaponItem.weapons.name} LV${newProfLv}`, color:'#aa44ff' })
          setBattleLogs([...logs])
        }
      }
    }

    const newBossRate = isBossEncounter ? 0 : bossRate+0.5
    let newUnlockedAreas = [...(profile.unlocked_areas||[1])]
    if (win && enemy.isBoss && !newUnlockedAreas.includes(selectedArea+1)) {
      const nextArea = selectedArea+1
      if (nextArea <= AREAS.length) {
        newUnlockedAreas.push(nextArea)
        logs.push({ text:`🎉 新エリア「${AREAS.find(a=>a.id===nextArea)?.name}」が解放された！`, color:'#cc44ff' })
        setBattleLogs([...logs])
      }
    }

    const frozenExp = profile.exp_frozen
    let newExp = frozenExp ? profile.exp : profile.exp + expGained
    let newGold = profile.gold + goldGained
    let newLv = profile.lv
    let newExpNext = profile.exp_next
    let newPendingPoints = profile.pending_stat_points||0
    const growth = JOB_GROWTH[profile.class]||JOB_GROWTH['戦士']
    const bonusSlots = JOB_LEVEL3_BONUS[profile.class]||[]
    let statUpdates = {}
    let newCharLv = profile.char_lv || 1

    if (frozenExp && expGained > 0) {
      logs.push({ text:`EXP +${expGained}（調査中につき停止）`, color:'#446688' })
      setBattleLogs([...logs])
    }

    if (!isAtCap && !frozenExp) {
      while (newExp >= newExpNext && newLv < cap) {
        newExp -= newExpNext; newLv++; newExpNext = calcExpNext(newLv); newPendingPoints++
        newCharLv++
        const base = statUpdates
        statUpdates = {
          hp_max: (base.hp_max||profile.hp_max)+growth.hp,
          mp_max: (base.mp_max||profile.mp_max)+growth.mp,
          atk:    (base.atk   ||profile.atk)  +growth.atk,
          def:    (base.def   ||profile.def)  +growth.def,
          matk:   (base.matk  ||profile.matk) +growth.matk,
          mdef:   (base.mdef  ||profile.mdef) +growth.mdef,
          spd:    (base.spd   ||profile.spd)  +growth.spd,
        }
        if (bonusSlots.length > 0 && newLv%3===0) {
          const bonusIndex = Math.floor(newLv/3-1)%bonusSlots.length
          statUpdates[bonusSlots[bonusIndex]] = (statUpdates[bonusSlots[bonusIndex]]||0)+1
        }
        logs.push({ text:`★ LEVEL UP！ ${profile.class} LV${newLv}！ ステータスポイント+1`, color:'#cc44ff' })
        setBattleLogs([...logs])
        const { data: lvupSkills } = await supabase.from('skills').select('*').eq('class_name', profile.class).eq('required_lv', newLv)
        const { data: alreadyLearned } = await supabase.from('player_skills').select('skill_id').eq('player_id', profile.id)
        const alreadyIds = (alreadyLearned||[]).map(s => s.skill_id)
        for (const skill of (lvupSkills||[])) {
          if (!alreadyIds.includes(skill.id)) {
            await supabase.from('player_skills').insert({ player_id:profile.id, skill_id:skill.id })
            logs.push({ text:`⚡ スキル「${skill.name}」を習得した！`, color:'#cc44ff' })
            setBattleLogs([...logs])
          }
        }
      }
      if (newLv >= cap) {
        newExp = 0; newExpNext = calcExpNext(cap)
        logs.push({ text:`🎯 ${profile.class}がレベルキャップ(LV${cap})に到達！`, color:'#ffcc00' })
        setBattleLogs([...logs])
      }
    }

    await supabase.from('profiles').update({
      exp:newExp, exp_next:newExpNext, lv:newLv, gold:newGold,
      hp_current:playerHp, mp_current:playerMp, is_dying:newIsDying,
      boss_encounter_rate:newBossRate, unlocked_areas:newUnlockedAreas,
      pending_stat_points:newPendingPoints, last_action_at:new Date().toISOString(),
      char_lv:newCharLv,
      ...statUpdates,
    }).eq('id', profile.id)

    const currentClassData = classLevels.find(cl => cl.class_name === profile.class)
    if (currentClassData && !isAtCap && !frozenExp) {
      await supabase.from('class_levels').update({ lv:newLv, exp:newExp }).eq('id', currentClassData.id)
    }

    await fetchProfile()
    setLoading(false)
  }

  const useInn = async () => {
    const isDying = profile.is_dying||false
    const charLvForCost = profile.char_lv || profile.lv
    const normalCost = charLvForCost*2
    const dyingCost = charLvForCost*15

    // ★ サーバーから最新のゴールドを取得（複数タブ同時利用対策）
    const { data: serverProfile } = await supabase.from('profiles').select('gold, hp_max, mp_max').eq('id', profile.id).single()
    if (!serverProfile) return
    const serverCost = isDying ? Math.min(dyingCost, serverProfile.gold) : normalCost
    if (!isDying && serverProfile.gold < normalCost) return

    // ★ 楽観ロック: ゴールドが読み取り時と同じ場合のみ更新（別タブが先に利用してたら失敗）
    const { data: locked } = await supabase.from('profiles').update({
      hp_current: serverProfile.hp_max,
      mp_current: serverProfile.mp_max,
      gold: serverProfile.gold - serverCost,
      is_dying: false,
    }).eq('id', profile.id).eq('gold', serverProfile.gold).select('id')

    if (!locked || locked.length === 0) {
      await fetchProfile()
      return
    }
    await fetchProfile()
    setInnMessage('HPとMPが回復しました！')
    setTimeout(() => { setInnMessage(''); setScene('town') }, 1500)
  }

  const confirmStatPoints = async () => {
    const total = Object.values(statPoints).reduce((a,b)=>a+b,0)
    if (total <= 0) return
    const remaining = pendingPoints - total
    const prev = profile.stat_point_spent || {}
    const updates = {
      hp_max: profile.hp_max+(statPoints.hp||0)*10,
      mp_max: profile.mp_max+(statPoints.mp||0)*5,
      atk:    profile.atk  +(statPoints.atk ||0),
      def:    profile.def  +(statPoints.def  ||0),
      matk:   profile.matk +(statPoints.matk ||0),
      mdef:   profile.mdef +(statPoints.mdef ||0),
      spd:    profile.spd  +(statPoints.spd  ||0),
      pending_stat_points: Math.max(0, remaining),
      stat_point_spent: {
        hp:   (prev.hp  ||0)+(statPoints.hp  ||0),
        mp:   (prev.mp  ||0)+(statPoints.mp  ||0),
        atk:  (prev.atk ||0)+(statPoints.atk ||0),
        def:  (prev.def ||0)+(statPoints.def ||0),
        matk: (prev.matk||0)+(statPoints.matk||0),
        mdef: (prev.mdef||0)+(statPoints.mdef||0),
        spd:  (prev.spd ||0)+(statPoints.spd ||0),
      },
    }
    await supabase.from('profiles').update(updates).eq('id', profile.id)
    await fetchProfile()
    setPendingPoints(Math.max(0, remaining)); setStatPoints({}); setShowStatPanel(false)
  }

  const backToTown = () => { setScene('town'); setBattleLogs([]) }
  const logout = async () => { await supabase.auth.signOut(); nav('/login') }

  const fetchAnnouncements = async () => {
    const { data } = await supabase.from('announcements').select('*').eq('is_active', true).order('created_at', { ascending: false })
    const fetched = data || []
    setAnnouncements(fetched)
    try {
      const seen = JSON.parse(localStorage.getItem('bf_seenAnnouncements') || '[]')
      setSeenAnnouncementIds(seen)
      const hasNew = fetched.some(a => !seen.includes(a.id))
      if (hasNew) {
        setHasNewAnnouncements(true)
        setNewAnnouncementPopup(true)
      }
    } catch {}
  }

  const markAllAnnouncementsSeen = () => {
    const ids = announcements.map(a => a.id)
    try { localStorage.setItem('bf_seenAnnouncements', JSON.stringify(ids)) } catch {}
    setHasNewAnnouncements(false)
  }

  const GUIDE_SECTIONS = [
    {
      id: 'basics', title: '⚔ 基本の進め方',
      content: `① エリアを選んで「出撃」ボタンを押すと自動で戦闘が始まる
② 勝利するとEXP・Goldを獲得。レベルアップでステータスが上昇する
③ レベルアップするとステータスポイントが1pt貰える（街の画面から割り振り）
④ クールダウン（10秒）が終わったら再び出撃できる
⑤ ボスを倒すと次のエリアが解放される`,
    },
    {
      id: 'class', title: '🎭 クラスシステム',
      content: `初期クラスは戦士・弓使い・魔法使い・僧侶の4種類。

● 各クラスのレベルキャップはLV100
● 神殿でLV30以上になると他のクラスに転職できる
● 各クラスのレベルの合計がキャラクターレベルになる
● LV100に達したクラスから上位クラスに転職可能（侍・暗殺者・元素使い など）
● 上位クラスのレベルキャップはLV300`,
    },
    {
      id: 'skills', title: '⚡ スキル',
      content: `● レベルアップで自動習得。スキルページでスロット（最大5個）にセット
● 戦闘ではスロット順に上から繰り返し使用する
● パッシブスキルはスロットにセットすると常時発動
● MPが足りないとスキルが発動しないので、宿屋でMP補充しておこう`,
    },
    {
      id: 'equipment', title: '🗡 装備・強化',
      content: `● 戦闘でドロップした武器は「装備」ページで確認・装備できる
● 鍛冶屋では同名の武器か強化石を使って武器を強化
● 強化石はエリア2以降の敵からドロップ、特殊ダンジョン（石）や武器の加工でも入手できる
● 武器を使い続けると熟練度が上がりボーナスが付く
● 鍛冶屋で「再評価」すると、付与された特殊効果を別の効果に変更できる
● 「再鑑定」では武器についているボーナスステータスを振り直せる`,
    },
    {
      id: 'inn', title: '🏨 宿屋・回復',
      content: `● 戦闘でHPが0になると「瀕死状態」になり出撃不可になる
● 宿屋でHP・MPを全回復（Goldがかかる）
● 瀕死状態の回復は通常よりGoldが多くかかる
● 時間経過でも自然回復する（瀕死状態も回復する）`,
    },
    {
      id: 'dungeon', title: '✨ 特殊ダンジョン',
      content: `● 街の画面から「特殊ダンジョン」を選択（1日5回まで）
● EXP / Gold / 強化石 / 武器熟練度 の4種類から選べる
● リセットは毎日0時（日本時間）`,
    },
    {
      id: 'fishing', title: '🎣 釣り',
      content: `● 釣りページで竿を垂らして魚を釣ることができる
● 釣り中は出撃・特殊ダンジョンに入れない
● はじめて釣った魚は図鑑に登録され、永続的なステータスボーナスが獲得できる
● 同じ魚を釣っても2回目以降は図鑑登録・ステータスボーナスはない`,
    },
    {
      id: 'shop', title: '🛒 その他のページ',
      content: `● 商店：回復アイテムや補助アイテムを購入できる（解放エリアで品揃えが変わる）
● 床屋：キャラクターの見た目を変更できる
● ランキング：全プレイヤーのキャラLVランキングを確認できる
● プロフィール：自分や他のプレイヤーの詳細ステータスを確認できる

📜 うわさ話
● 世の中には「アーティファクト」と呼ばれる武器があるらしい
  現代では風化してしまっているが、手入れをすれば
  また使えるようになるかも…`,
    },
  ]

  if (pendingClassChange) return (
    <div style={{ minHeight:'100vh', background:'#000820', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ background:'#001040', border:'1px solid #ccaa00', padding:'32px', maxWidth:'360px', width:'100%', textAlign:'center' }}>
        <div style={{ color:'#ccaa00', fontSize:'18px', marginBottom:'8px' }}>⛩</div>
        <div style={{ color:'#ccaa00', fontSize:'15px', marginBottom:'16px', letterSpacing:'2px' }}>{pendingClassChange}に転職します！</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'24px' }}>よろしいですか？</div>
        <div style={{ display:'flex', gap:'12px', justifyContent:'center' }}>
          <button onClick={async ()=>{ await doChangeClass(pendingClassChange); setPendingClassChange(null) }} disabled={loading}
            style={{ padding:'10px 24px', background:'#1a1000', border:'1px solid #ccaa00', color:'#ccaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            {loading ? '処理中...' : '転職する'}
          </button>
          <button onClick={()=>setPendingClassChange(null)} disabled={loading}
            style={{ padding:'10px 24px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )

  if (retrainingModal) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'#001020', border:'1px solid #ffaa44', padding:'16px', maxWidth:'500px', width:'100%', maxHeight:'80vh', overflowY:'auto', fontFamily:'monospace' }}>
        <div style={{ color:'#ffaa44', fontSize:'14px', marginBottom:'4px' }}>🔄 再修練</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
          持ち越すスキルを1つ選んでください。<br/>
          選んだスキルは他のクラスでも使えるようになります。
        </div>
        <div style={{ marginBottom:'12px' }}>
          {retrainingSkills.length === 0 ? (
            <div style={{ color:'#446688', fontSize:'11px', textAlign:'center', padding:'12px' }}>習得済みスキルがありません</div>
          ) : (
            retrainingSkills.map(ps => (
              <div key={ps.skill_id} onClick={()=>setSelectedCarrySkill(selectedCarrySkill===ps.skill_id?null:ps.skill_id)}
                style={{ padding:'8px 10px', marginBottom:'4px', border:`1px solid ${selectedCarrySkill===ps.skill_id?'#ffaa44':'#002244'}`, background:selectedCarrySkill===ps.skill_id?'#1a0800':'#000818', cursor:'pointer' }}>
                <div style={{ color:selectedCarrySkill===ps.skill_id?'#ffaa44':'#88ccff', fontSize:'12px' }}>{ps.skills?.name}</div>
                <div style={{ color:'#446688', fontSize:'10px' }}>LV{ps.skills?.required_lv} / {ps.skills?.type}</div>
              </div>
            ))
          )}
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          <button onClick={()=>{ setRetrainingModal(false); setSelectedCarrySkill(null) }}
            style={{ flex:1, padding:'10px', background:'none', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            キャンセル
          </button>
          <button onClick={doRetraining} disabled={loading}
            style={{ flex:1, padding:'10px', background:'#1a0800', border:'1px solid #ffaa44', color:'#ffaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            {selectedCarrySkill ? '再修練する' : 'スキルなしで再修練'}
          </button>
        </div>
      </div>
    </div>
  )

  if (showGuide) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'#001040', border:'1px solid #44aaff', padding:'16px', maxWidth:'600px', width:'100%', maxHeight:'80vh', overflowY:'auto', fontFamily:'monospace', textAlign:'left' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', borderBottom:'1px solid #003366', paddingBottom:'8px' }}>
          <div style={{ color:'#44aaff', fontSize:'14px' }}>📖 初心者ガイド</div>
          <button onClick={()=>{ setShowGuide(false); setOpenGuideId(null) }} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'2px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>✕ 閉じる</button>
        </div>
        {GUIDE_SECTIONS.map(sec => (
          <div key={sec.id} style={{ marginBottom:'6px', border:'1px solid #002244', background:'#000818' }}>
            <button onClick={()=>setOpenGuideId(openGuideId===sec.id?null:sec.id)}
              style={{ width:'100%', padding:'10px 12px', background:'none', border:'none', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>{sec.title}</span>
              <span style={{ color:'#446688', fontSize:'10px' }}>{openGuideId===sec.id?'▲':'▼'}</span>
            </button>
            {openGuideId===sec.id && (
              <div style={{ padding:'12px', borderTop:'1px solid #002244', color:'#88ccff', fontSize:'11px', lineHeight:'2.0', whiteSpace:'pre-wrap', textAlign:'left' }}>
                {sec.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  if (newAnnouncementPopup) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.88)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ background:'#001040', border:'2px solid #ff8844', padding:'28px 24px', maxWidth:'420px', width:'100%', textAlign:'center' }}>
        <div style={{ color:'#ff8844', fontSize:'22px', marginBottom:'8px' }}>📢</div>
        <div style={{ color:'#ff8844', fontSize:'15px', marginBottom:'16px', letterSpacing:'2px' }}>新着お知らせ</div>
        <div style={{ marginBottom:'20px', textAlign:'left' }}>
          {announcements.filter(a => !seenAnnouncementIds.includes(a.id)).map(a => (
            <div key={a.id} style={{ marginBottom:'6px', padding:'8px 10px', background:'#000818', border:'1px solid #332200' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                <span style={{ color:'#ff8844', fontSize:'9px', padding:'1px 4px', border:'1px solid #ff8844' }}>NEW</span>
                <span style={{ color:'#88ccff', fontSize:'12px' }}>{a.title}</span>
              </div>
              <div style={{ color:'#446688', fontSize:'10px', marginTop:'3px' }}>{new Date(a.created_at).toLocaleDateString('ja-JP')}</div>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:'10px', justifyContent:'center' }}>
          <button onClick={()=>{ setNewAnnouncementPopup(false); setShowAnnouncements(true); markAllAnnouncementsSeen() }}
            style={{ background:'#1a0800', border:'1px solid #ff8844', color:'#ff8844', padding:'8px 20px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            詳しく見る
          </button>
          <button onClick={()=>{ setNewAnnouncementPopup(false); markAllAnnouncementsSeen() }}
            style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'8px 20px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )

  if (showAnnouncements) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'#001040', border:'1px solid #ff8844', padding:'16px', maxWidth:'600px', width:'100%', maxHeight:'80vh', overflowY:'auto', fontFamily:'monospace' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', borderBottom:'1px solid #003366', paddingBottom:'8px' }}>
          <div style={{ color:'#ff8844', fontSize:'14px' }}>📢 お知らせ</div>
          <button onClick={()=>{ setShowAnnouncements(false); setOpenAnnouncementId(null) }} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'2px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>✕ 閉じる</button>
        </div>
        {announcements.length === 0 && <div style={{ color:'#446688', fontSize:'12px' }}>お知らせはありません</div>}
        {announcements.map(a => {
          const isNew = !seenAnnouncementIds.includes(a.id)
          return (
            <div key={a.id} style={{ marginBottom:'8px', border:`1px solid ${isNew?'#443300':'#002244'}`, background:'#000818' }}>
              <button onClick={()=>setOpenAnnouncementId(openAnnouncementId===a.id?null:a.id)}
                style={{ width:'100%', padding:'10px 12px', background:'none', border:'none', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                  <span style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                    {isNew && <span style={{ color:'#ff8844', fontSize:'9px', padding:'1px 4px', border:'1px solid #ff8844' }}>NEW</span>}
                    <span>{a.title}</span>
                  </span>
                  <span style={{ color:'#446688', fontSize:'10px' }}>{new Date(a.created_at).toLocaleDateString('ja-JP')}</span>
                </span>
                <span style={{ color:'#446688', fontSize:'10px' }}>{openAnnouncementId===a.id?'▲':'▼'}</span>
              </button>
              {openAnnouncementId===a.id && (
                <div style={{ padding:'12px', borderTop:'1px solid #002244', color:'#88ccff', fontSize:'11px', lineHeight:'1.8', whiteSpace:'pre-wrap', textAlign:'left' }}>
                  {a.content}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  // メンテナンス中チェック
  const maintenanceAnnouncement = announcements.find(a => a.title === 'MAINTENANCE')
  if (maintenanceAnnouncement) return (
    <div style={{ minHeight:'100vh', background:'#000820', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'monospace' }}>
      <div style={{ textAlign:'center', padding:'32px', border:'1px solid #ffcc00', background:'#001020', maxWidth:'400px' }}>
        <div style={{ fontSize:'32px', marginBottom:'16px' }}>🔧</div>
        <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'2px', marginBottom:'12px' }}>メンテナンス中</div>
        <div style={{ color:'#88ccff', fontSize:'12px', lineHeight:'1.8', whiteSpace:'pre-wrap' }}>{maintenanceAnnouncement.content}</div>
      </div>
    </div>
  )

  const hpCurrent = Math.max(0, profile.hp_current??profile.hp_max)
  const mpCurrent = Math.max(0, profile.mp_current??profile.mp_max)
  const isDying = profile.is_dying||false
  const isBanned = profile.battle_ban_until && new Date(profile.battle_ban_until) > new Date()
  const papiaEvent = getPapiaEventStatus()
  const banRemaining = isBanned ? (() => {
    const diffMs = new Date(profile.battle_ban_until) - new Date()
    const h = Math.floor(diffMs / 3600000)
    const m = Math.ceil((diffMs % 3600000) / 60000)
    return `${h}時間${m}分`
  })() : null
  const canBattle = !isBanned && (!isDying || hpCurrent >= profile.hp_max)
  const hpPct = Math.min(100,(hpCurrent/profile.hp_max)*100)
  const mpPct = Math.min(100,(mpCurrent/profile.mp_max)*100)
  const expPct = Math.min(100,(profile.exp/profile.exp_next)*100)
  const timerPct = ((WAIT_SECONDS-remaining)/WAIT_SECONDS)*100
  const regenPct = ((REGEN_SECONDS-regenRemaining)/REGEN_SECONDS)*100
  const unlockedAreas = profile.unlocked_areas||[1]
  const availableAreas = AREAS.filter(a=>unlockedAreas.includes(a.id))
  const charLv = profile.char_lv || profile.lv
  const innCost = isDying ? Math.min(charLv*15,profile.gold) : charLv*2
  const allocatedPoints = Object.values(statPoints).reduce((a,b)=>a+b,0)
  const eff = calcEffectiveStats(profile, equipment, proficiency)
  const total = calcTotal(eff)
  const totalRank = getTotalRank(total)
  const currentClassLv = classLevels.find(cl => cl.class_name === profile.class)?.lv || profile.lv
  const cap = getEffectiveCap(profile.class)
  const isAtCap = currentClassLv >= cap
  const retrainingCount = (profile.retraining || {})[profile.class] || 0

  const availableClasses = INITIAL_CLASSES.map(c=>{
    const cl = classLevels.find(x=>x.class_name===c)
    return { name:c, lv:cl?cl.lv:1, canChange: c !== profile.class }
  })
  const advancedAvailable = Object.entries(ADVANCED_CLASSES).map(([name, req])=>{
    const requires = req.requires
    const requiresLv = req.requiresLv || 100
    const requires2 = req.requires2
    const requires2Lv = req.requires2Lv || 0
    const reqCl = classLevels.find(x=>x.class_name===requires)
    const reqLv = reqCl?reqCl.lv:0
    const req2Cl = requires2 ? classLevels.find(x=>x.class_name===requires2) : null
    const req2Lv = req2Cl?req2Cl.lv:0
    const cl = classLevels.find(x=>x.class_name===name)
    const canChange = name !== profile.class && (requires2
      ? reqLv>=requiresLv && req2Lv>=requires2Lv
      : reqLv>=requiresLv)
    return { name, lv:cl?cl.lv:1, canChange, requires, reqLv, requiresLv, requires2, req2Lv, requires2Lv }
  })

  const normalAdvanced = advancedAvailable.filter(c => !c.requires2)
  const specialAdvanced = advancedAvailable.filter(c => c.requires2)

  const TempleContent = () => (
    <div style={{ border:'1px solid #886600', background:'#001020', padding:'16px' }}>
      <div style={{ color:'#ccaa00', fontSize:'14px', marginBottom:'4px' }}>⛩ 神殿</div>
      <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
        現在のクラス: <span style={{color:'#88ccff'}}>{profile.class}</span><span style={{color:'#ffcc00'}}>{getRetrainingStars(profile.class, profile.retraining)}</span> LV<span style={{color:'#ffcc00'}}>{currentClassLv}</span>／{cap}
      </div>
      {templeMessage && <div style={{ color:'#44ff88', fontSize:'13px', textAlign:'center', padding:'10px', marginBottom:'12px', border:'1px solid #44ff88' }}>{templeMessage}</div>}
      {/* 再修練セクション：キャップ到達時のみ表示 */}
      {isAtCap && retrainingCount < 5 && <div style={{ border:'1px solid #664400', background:'#0a0800', padding:'12px', marginBottom:'12px' }}>
        <div style={{ color:'#ffaa44', fontSize:'12px', marginBottom:'6px' }}>🔄 再修練</div>
        <div style={{ color:'#446688', fontSize:'10px', marginBottom:'8px', lineHeight:'1.6' }}>
          レベルキャップ到達時に再修練できます。<br/>
          再修練するとLV1にリセット・LV20分のステータス永続付与・スキル1つを持ち越せます。<br/>
          上限5回まで（★★★★★）
        </div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'8px' }}>
          再修練回数: <span style={{color:'#ffcc00', letterSpacing:'2px'}}>{getRetrainingStars(profile.class, profile.retraining) || 'なし'}</span>
          <span style={{color:'#446688'}}> ({retrainingCount}/5)</span>
        </div>
        {retrainingMessage && (
          <div style={{ color:'#ffaa44', fontSize:'12px', textAlign:'center', padding:'8px', border:'1px solid #ffaa44', marginBottom:'8px' }}>{retrainingMessage}</div>
        )}
        <button onClick={openRetrainingModal} disabled={loading}
          style={{ width:'100%', padding:'10px', background:'#1a0800', border:'1px solid #ffaa44', color:'#ffaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
          🔄 再修練する
        </button>
      </div>}
      <div style={{ color:'#ccaa00', fontSize:'11px', marginBottom:'6px' }}>── 初期職（LV100キャップ）──</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'12px' }}>
        {availableClasses.map(c=>{
          const isCurrent = c.name === profile.class
          return (
          <div key={c.name} style={{ border:`1px solid ${isCurrent?'#445566':c.canChange?'#886600':'#002244'}`, background:isCurrent?'#001828':'#001028', padding:'8px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ color:isCurrent?'#88aabb':c.canChange?'#ccaa00':'#446688', fontSize:'12px' }}>
                  {c.name}{isCurrent&&<span style={{color:'#446688',fontSize:'9px',marginLeft:'6px'}}>（現在）</span>}
                </div>
                <div style={{ color:'#446688', fontSize:'10px' }}>LV {c.lv} / {getEffectiveCap(c.name)}</div>
              </div>
              <button onClick={()=>setPendingClassChange(c.name)} disabled={isCurrent||loading}
                style={{ padding:'4px 8px', background:isCurrent?'#001':'#1a1000', border:`1px solid ${isCurrent?'#334455':c.canChange?'#886600':'#002244'}`, color:isCurrent?'#334455':c.canChange?'#ccaa00':'#334455', cursor:isCurrent?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                {isCurrent?'現在':'転職'}
              </button>
            </div>
          </div>
          )
        })}
      </div>
      <div style={{ color:'#ccaa00', fontSize:'11px', marginBottom:'6px' }}>── 上位職（初期職LV100で解放）──</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'12px' }}>
        {normalAdvanced.map(c=>{
          const isCurrent = c.name === profile.class
          return (
          <div key={c.name} style={{ border:`1px solid ${isCurrent?'#445566':c.canChange?'#664400':'#002244'}`, background:isCurrent?'#001828':'#001028', padding:'8px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ color:isCurrent?'#88aabb':c.canChange?'#ff8800':'#446688', fontSize:'12px' }}>
                  {c.name}{isCurrent&&<span style={{color:'#446688',fontSize:'9px',marginLeft:'6px'}}>（現在）</span>}
                </div>
                <div style={{ color:'#446688', fontSize:'10px' }}>{c.requires} LV{c.reqLv}/{c.requiresLv}　クラスLV{c.lv}/{getEffectiveCap(c.name)}</div>
              </div>
              <button onClick={()=>setPendingClassChange(c.name)} disabled={isCurrent||!c.canChange||loading}
                style={{ padding:'4px 8px', background:isCurrent?'#001':c.canChange?'#1a0800':'#001', border:`1px solid ${isCurrent?'#334455':c.canChange?'#664400':'#002244'}`, color:isCurrent?'#334455':c.canChange?'#ff8800':'#334455', cursor:isCurrent||!c.canChange?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                {isCurrent?'現在':'転職'}
              </button>
            </div>
          </div>
          )
        })}
      </div>
      <div style={{ color:'#cc88ff', fontSize:'11px', marginBottom:'6px' }}>── 特殊上位職（複合条件で解放）──</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'12px' }}>
        {specialAdvanced.map(c=>{
          const isCurrent = c.name === profile.class
          return (
          <div key={c.name} style={{ border:`1px solid ${isCurrent?'#445566':c.canChange?'#664488':'#002244'}`, background:isCurrent?'#001828':'#001028', padding:'8px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ color:isCurrent?'#88aabb':c.canChange?'#cc88ff':'#446688', fontSize:'12px' }}>
                  {c.name}{isCurrent&&<span style={{color:'#446688',fontSize:'9px',marginLeft:'6px'}}>（現在）</span>}
                </div>
                <div style={{ color:'#446688', fontSize:'10px' }}>{c.requires} LV{c.reqLv}/{c.requiresLv}</div>
                <div style={{ color:'#446688', fontSize:'10px' }}>{c.requires2} LV{c.req2Lv}/{c.requires2Lv}</div>
                <div style={{ color:'#446688', fontSize:'10px' }}>クラスLV{c.lv}/{getEffectiveCap(c.name)}</div>
              </div>
              <button onClick={()=>setPendingClassChange(c.name)} disabled={isCurrent||!c.canChange||loading}
                style={{ padding:'4px 8px', background:isCurrent?'#001':c.canChange?'#1a0830':'#001', border:`1px solid ${isCurrent?'#334455':c.canChange?'#664488':'#002244'}`, color:isCurrent?'#334455':c.canChange?'#cc88ff':'#334455', cursor:isCurrent||!c.canChange?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                {isCurrent?'現在':'転職'}
              </button>
            </div>
          </div>
          )
        })}
      </div>
      <button onClick={backToTown} style={{ width:'100%', padding:'10px', background:'#001840', border:'1px solid #0088ff', color:'#0088ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏰 街に戻る</button>
    </div>
  )

  // ===== スマホレイアウト =====
  if (isMobile) {
    return (
      <div style={{ minHeight:'100vh', background:'#000820', fontFamily:'monospace' }}>
        <div style={{ background:'#000820', borderBottom:'1px solid #003366', padding:'6px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:100 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <div style={{ color:'#ffcc00', fontSize:'13px', letterSpacing:'2px' }}>BATTLE FRONTIER</div>
            <button onClick={()=>{ setShowAnnouncements(true); markAllAnnouncementsSeen() }} style={{ background:'none', border:`1px solid ${hasNewAnnouncements?'#ffaa22':'#ff8844'}`, color:`${hasNewAnnouncements?'#ffaa22':'#ff8844'}`, padding:'2px 6px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px', position:'relative' }}>
              📢{hasNewAnnouncements && <span style={{ marginLeft:'2px', background:'#ff4400', color:'#fff', fontSize:'7px', padding:'1px 3px', borderRadius:'2px', verticalAlign:'middle' }}>NEW</span>}
            </button>
            <button onClick={()=>setShowGuide(true)} style={{ background:'none', border:'1px solid #44aaff', color:'#44aaff', padding:'2px 6px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>📖</button>
          </div>
          <div style={{ display:'flex', gap:'6px' }}>
            <button onClick={()=>nav('/equipment')} style={{ background:'none', border:'1px solid #44aaff', color:'#44aaff', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🗡</button>
            <button onClick={()=>nav('/skills')} style={{ background:'none', border:'1px solid #cc44ff', color:'#cc44ff', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>⚡</button>
            <button onClick={()=>nav('/profile')} style={{ background:'none', border:'1px solid #44ff88', color:'#44ff88', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>👤</button>
            <button onClick={()=>nav('/ranking')} style={{ background:'none', border:'1px solid #ffcc00', color:'#ffcc00', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏆</button>
            <button onClick={()=>setShowMenu(!showMenu)} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>☰</button>
          </div>
        </div>
        {showMenu && (
          <div style={{ position:'fixed', top:'40px', right:'12px', background:'#001040', border:'1px solid #446688', zIndex:200, minWidth:'120px' }}>
            <button onClick={()=>{ nav('/shop'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44aa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🛒 商店</button>
            <button onClick={()=>{ nav('/smithy'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>⚒ 鍛冶屋</button>
            <button onClick={()=>{ nav('/fishing'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🎣 釣り場</button>
            <button onClick={()=>{ nav('/barber'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>✂ 美容院</button>
            <button onClick={()=>{ logout(); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🚪 ログアウト</button>
          </div>
        )}
        {showMenu && <div onClick={()=>setShowMenu(false)} style={{ position:'fixed', inset:0, zIndex:150 }} />}

        <div style={{ padding:'8px 12px' }}>
          <div style={{ border:`1px solid ${isDying?'#660000':'#0044aa'}`, background:'#001040', padding:'10px', marginBottom:'8px' }}>
            {isDying && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'6px', border:'1px solid #660000', padding:'3px', background:'#1a0000' }}>⚠ 瀕死状態　HP全回復まで出撃不可</div>}
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
              {profile.avatar_url && <img src={profile.avatar_url} alt="avatar" style={{ width:'48px', height:'48px', objectFit:'cover', flexShrink:0 }} />}
              <div style={{ flex:1 }}>
                <div style={{ color:'#ffcc00', fontSize:'13px' }}>{profile.username}</div>
                <div style={{ fontSize:'11px', color:'#446688' }}>
                  <span style={{color:'#88ccff'}}>{profile.class}</span><span style={{color:'#ffcc00'}}>{getRetrainingStars(profile.class, profile.retraining)}</span> <span style={{color:'#ffcc00'}}>LV{currentClassLv}</span>／{cap}
                </div>
                <div style={{ fontSize:'11px', color:'#446688' }}>
                  キャラクターLV: <span style={{color:'#ffcc00'}}>{charLv}</span>　<span style={{color:'#44ff88'}}>{total}</span> <span style={{color:totalRank.color}}>{totalRank.rank}</span>
                </div>
                <div style={{ fontSize:'10px', color:'#446688' }}>Gold: <span style={{color:'#ffcc00'}}>{profile.gold}</span></div>
              </div>
            </div>
            <MiniBar label="HP" val={`${hpCurrent}/${profile.hp_max}`} pct={hpPct} color={isDying?'#ff2200':'#00cc44'} />
            <MiniBar label="MP" val={`${mpCurrent}/${profile.mp_max}`} pct={mpPct} color="#4488ff" />
            <MiniBar label="EXP" val={`${profile.exp}/${profile.exp_next}`} pct={expPct} color="#cc8800" />
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#446688', marginBottom:'2px' }}>
              <span>自然回復</span><span style={{color:'#44ccff'}}>{regenRemaining>0?`${Math.ceil(regenRemaining)}秒`:'回復中...'}</span>
            </div>
            <div style={{ background:'#001028', height:'3px', border:'1px solid #002244', marginBottom:'8px' }}>
              <div style={{ height:'100%', width:`${regenPct}%`, background:'linear-gradient(90deg,#003333,#44ccff)' }} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'2px', fontSize:'10px', marginBottom:'6px' }}>
              <StatMini label="攻撃" base={profile.atk} bonus={eff.bonus.atk} color="#ffcc00" type="atk" />
              <StatMini label="防御" base={profile.def} bonus={eff.bonus.def} color="#88aaff" type="def" />
              <StatMini label="特攻" base={profile.matk} bonus={eff.bonus.matk} color="#cc44ff" type="matk" />
              <StatMini label="特防" base={profile.mdef} bonus={eff.bonus.mdef} color="#44ccff" type="mdef" />
              <StatMini label="速さ" base={profile.spd} bonus={eff.bonus.spd} color="#ff8844" type="spd" />
            </div>
            {pendingPoints > 0 && (
              <button onClick={()=>{ setShowStatPanel(true); setStatPoints({hp:0,mp:0,atk:0,def:0,matk:0,mdef:0,spd:0}) }}
                style={{ width:'100%', padding:'6px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                ★ ステータスを振り分ける（{pendingPoints}pt）
              </button>
            )}
          </div>

          {showStatPanel && (
            <div style={{ border:'1px solid #cc44ff', background:'#0a0020', padding:'12px', marginBottom:'8px' }}>
              <div style={{ color:'#cc44ff', fontSize:'13px', marginBottom:'6px' }}>ステータスポイント振り分け（残り {pendingPoints-allocatedPoints}pt）</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'10px' }}>
                {Object.entries(STAT_LABELS).map(([stat,label])=>(
                  <div key={stat} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', border:`1px solid ${(statPoints[stat]||0)>0?'#cc44ff':'#003366'}`, background:(statPoints[stat]||0)>0?'#1a0030':'#000818', padding:'6px 8px' }}>
                    <span style={{ color:'#88ccff', fontSize:'10px' }}>{label}</span>
                    <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
                      <button onClick={()=>{ if((statPoints[stat]||0)>0) setStatPoints(p=>({...p,[stat]:p[stat]-1})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>-</button>
                      <span style={{ color:'#cc44ff', fontSize:'11px', minWidth:'16px', textAlign:'center' }}>{statPoints[stat]||0}</span>
                      <button onClick={()=>{ if(allocatedPoints<pendingPoints) setStatPoints(p=>({...p,[stat]:(p[stat]||0)+1})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={()=>setShowStatPanel(false)} style={{ flex:1, padding:'8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>後で</button>
                <button onClick={confirmStatPoints} disabled={allocatedPoints===0||loading} style={{ flex:2, padding:'8px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', opacity:allocatedPoints===0?0.4:1 }}>決定する{pendingPoints-allocatedPoints>0?`（残り${pendingPoints-allocatedPoints}pt）`:''}</button>
              </div>
            </div>
          )}

          {scene==='town' && (
            <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
              <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'8px' }}>🏰 街</div>
              {isBanned && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'8px', border:'1px solid #880000', padding:'8px', background:'#200000' }}>⛔ 出撃禁止中（残り{banRemaining}）<br/><span style={{color:'#884444',fontSize:'10px'}}>異常な行動が検出されました</span></div>}
              {isDying && !isBanned && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'8px', border:'1px solid #660000', padding:'6px', background:'#1a0000' }}>⚠ 瀕死状態です。宿屋でHP全回復してください。</div>}
              {isAtCap && <div style={{ color:'#ff8844', fontSize:'11px', textAlign:'center', marginBottom:'8px', border:'1px solid #664400', padding:'4px', background:'#1a0800' }}>⚠ {profile.class}はレベルキャップ(LV{cap})に達しています</div>}
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
                <span style={{ color:'#446688' }}>次の行動まで</span>
                <span style={{ color:canAct?'#44ff88':'#ffcc00' }}>{canAct?'▶ 出撃可能！':`${remaining.toFixed(1)}秒`}</span>
              </div>
              <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'10px' }}>
                <div style={{ height:'100%', width:`${timerPct}%`, background:canAct?'#44ff88':'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
              </div>
              <select value={selectedArea} onChange={e=>{ const v=Number(e.target.value); setSelectedArea(v); localStorage.setItem('selectedArea',v) }} style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>
                {availableAreas.map(area=><option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
              {papiaEvent.active && (
                <div style={{ background:'#1a0a00', border:'1px solid #ffaa00', padding:'6px 10px', marginBottom:'8px', textAlign:'center', fontSize:'11px' }}>
                  <span style={{ color:'#ffaa00' }}>🌟 パピア出現率アップ中！</span>
                  <span style={{ color:'#446688', marginLeft:'8px' }}>残り{papiaEvent.remainingMin}分{papiaEvent.remainingSec}秒</span>
                </div>
              )}
              <button onClick={(e)=>doBattle(e)} disabled={!canAct||loading||!canBattle}
                style={{ width:'100%', padding:'14px', background:'#001840', border:`1px solid ${canAct&&canBattle?'#ffcc00':'#003366'}`, color:canAct&&canBattle?'#ffcc00':'#446688', cursor:canAct&&canBattle?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'10px' }}>
                {isBanned?'⛔ 出撃禁止中':isDying&&!canBattle?'💀 瀕死中':canAct?`⚔ ${AREAS.find(a=>a.id===selectedArea)?.name}へ出撃！`:'⏳ 待機中...'}
              </button>
              <button onClick={()=>setShowDungeonPanel(!showDungeonPanel)} disabled={dungeonAttempts>=5||loading||isBanned}
                style={{ width:'100%', padding:'12px', background:'#0a001a', border:`1px solid ${dungeonAttempts>=5||isBanned?'#333':'#cc44ff'}`, color:dungeonAttempts>=5||isBanned?'#333':'#cc44ff', cursor:dungeonAttempts>=5||isBanned?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'13px', marginBottom:'10px', opacity:dungeonAttempts>=5||isBanned?0.4:1 }}>
                ⚔ 特殊ダンジョン　<span style={{fontSize:'11px',color:dungeonAttempts>=5?'#333':'#446688'}}>残り{5-dungeonAttempts}/5</span>
              </button>
              {showDungeonPanel && (
                <div style={{ border:'1px solid #440088', background:'#0a001a', padding:'10px', marginBottom:'10px' }}>
                  <div style={{ color:'#cc44ff', fontSize:'11px', marginBottom:'8px' }}>ダンジョンを選択</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                    {[
                      { type:'exp',   label:'経験値ダンジョン' },
                      { type:'gold',  label:'ゴールドダンジョン' },
                      { type:'stone', label:'強化石ダンジョン' },
                      { type:'prof',  label:'熟練度ダンジョン' },
                    ].map(d => (
                      <button key={d.type} onClick={() => { doDungeon(d.type); setShowDungeonPanel(false) }}
                        style={{ padding:'10px', background:'#001020', border:'1px solid #440088', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                <button onClick={()=>{ setScene('inn'); setInnMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #0088aa', color:'#00aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏨 宿屋</button>
                <button onClick={()=>{ setScene('temple'); setTempleMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ccaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⛩ 神殿</button>
                <button onClick={()=>nav('/shop')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aa44', color:'#44aa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🛒 商店</button>
                <button onClick={()=>nav('/smithy')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚒ 鍛冶屋</button>
                <button onClick={()=>nav('/fishing')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎣 釣り場</button>
                <button onClick={()=>nav('/barber')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff88cc', color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✂ 美容院</button>
              </div>
            </div>
          )}

          {scene==='inn' && (
            <div style={{ border:'1px solid #0088aa', background:'#001030', padding:'20px', textAlign:'center' }}>
              <div style={{ color:'#00aacc', fontSize:'14px', marginBottom:'16px' }}>🏨 宿屋</div>
              {innMessage ? (
                <div style={{ color:'#44ff88', fontSize:'14px', padding:'20px' }}>{innMessage}</div>
              ) : (
                <>
                  <div style={{ color:'#88ccff', fontSize:'12px', lineHeight:'2', marginBottom:'16px' }}>
                    {isDying
                      ? profile.gold < charLv*15
                        ? <>これはひどいお姿で…。<br/><span style={{color:'#ffcc00'}}>{charLv*15}G</span> のところ、所持金 <span style={{color:'#ffcc00'}}>{innCost}G</span> で承ります。</>
                        : <>これはひどいお姿で…。<br/>特別なお手当として <span style={{color:'#ffcc00'}}>{innCost}G</span> でございます。</>
                      : <>一泊 <span style={{color:'#ffcc00'}}>{innCost}G</span> でございます。<br/>ゆっくりお休みになりますか？</>}
                  </div>
                  <div style={{ color:'#446688', fontSize:'11px', marginBottom:'16px' }}>
                    所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span>
                    {!isDying && profile.gold<innCost && <span style={{color:'#ff4444'}}> （不足）</span>}
                  </div>
                  <div style={{ display:'flex', gap:'8px' }}>
                    <button onClick={backToTown} style={{ flex:1, padding:'10px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>戻る</button>
                    <button onClick={useInn} disabled={!isDying&&profile.gold<innCost}
                      style={{ flex:2, padding:'10px', background:'#001830', border:'1px solid #0088aa', color:'#00aacc', cursor:(!isDying&&profile.gold<innCost)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', opacity:(!isDying&&profile.gold<innCost)?0.4:1 }}>
                      利用する
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {scene==='temple' && TempleContent()}

          {scene==='battle' && (
            <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
              <div style={{ color:'#ff6644', fontSize:'13px', marginBottom:'10px' }}>⚔ バトル！</div>
              {loading && <div style={{ color:'#446688', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
              <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
                {battleLogs.map((l,i)=>(
                  <div key={i} style={{ color:l.color, fontSize:'12px', lineHeight:'2', borderBottom:'1px solid #001428', padding:'2px 0' }}>{l.text}</div>
                ))}
              </div>
              {!loading && <button onClick={backToTown} style={{ width:'100%', padding:'10px', background:'#001840', border:'1px solid #0088ff', color:'#0088ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🏰 街に戻る</button>}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ===== PCレイアウト =====
  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'900px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
            <button onClick={()=>{ setShowAnnouncements(true); markAllAnnouncementsSeen() }} style={{ background:'none', border:`1px solid ${hasNewAnnouncements?'#ffaa22':'#ff8844'}`, color:`${hasNewAnnouncements?'#ffaa22':'#ff8844'}`, padding:'2px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', position:'relative' }}>
              📢 お知らせ{hasNewAnnouncements && <span style={{ marginLeft:'4px', background:'#ff4400', color:'#fff', fontSize:'8px', padding:'1px 4px', borderRadius:'2px', verticalAlign:'middle' }}>NEW</span>}
            </button>
            <button onClick={()=>setShowGuide(true)} style={{ background:'none', border:'1px solid #44aaff', color:'#44aaff', padding:'2px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>📖 ガイド</button>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={()=>nav('/equipment')} style={{ background:'none', border:'1px solid #44aaff', color:'#44aaff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🗡 装備</button>
            <button onClick={()=>nav('/skills')} style={{ background:'none', border:'1px solid #cc44ff', color:'#cc44ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>⚡ スキル</button>
            <button onClick={()=>nav('/profile')} style={{ background:'none', border:'1px solid #44ff88', color:'#44ff88', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>👤 プロフィール</button>
            <button onClick={()=>nav('/ranking')} style={{ background:'none', border:'1px solid #ffcc00', color:'#ffcc00', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏆 ランキング</button>
            <button onClick={()=>nav('/fishing')} style={{ background:'none', border:'1px solid #44aaff', color:'#44aaff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🎣 釣り</button>
            <button onClick={logout} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>ログアウト</button>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:'12px' }}>
          <div style={{ border:`1px solid ${isDying?'#660000':'#0044aa'}`, background:'#001040', padding:'10px', alignSelf:'start' }}>
            {isDying && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'8px', border:'1px solid #660000', padding:'4px', background:'#1a0000' }}>⚠ 瀕死状態　HP全回復まで出撃不可</div>}
            <div style={{ borderBottom:'1px dashed #003366', paddingBottom:'8px', marginBottom:'8px' }}>
              {profile.avatar_url && <img src={profile.avatar_url} alt="avatar" style={{ width:'60px', height:'60px', objectFit:'cover', display:'block', margin:'0 auto 6px' }} />}
              <div style={{ color:'#ffcc00', fontSize:'12px', textAlign:'center' }}>{profile.username}</div>
            </div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'2px' }}>
              クラス: <span style={{color:'#88ccff'}}>{profile.class}</span> <span style={{color:'#ffcc00'}}>LV{currentClassLv}</span>／<span style={{color:'#446688'}}>{cap}</span>
            </div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'2px' }}>
              キャラクターLV: <span style={{color:'#ffcc00'}}>{charLv}</span>
            </div>
            <div style={{ fontSize:'11px', color:'#446688', marginBottom:'6px', display:'flex', justifyContent:'space-between' }}>
              <span>総合力: <span style={{color:'#44ff88', fontWeight:'bold'}}>{total}</span></span>
              <span style={{color:totalRank.color, fontWeight:'bold'}}>{totalRank.rank}</span>
            </div>
            <StatBar label="HP" val={`${hpCurrent}/${profile.hp_max}`} pct={hpPct} color={isDying?'#ff2200':'#00cc44'} />
            <StatBar label="MP" val={`${mpCurrent}/${profile.mp_max}`} pct={mpPct} color="#4488ff" />
            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginTop:'6px' }}>
              <span>経験値</span><span style={{color:'#cc8800'}}>{profile.exp}/{profile.exp_next}</span>
            </div>
            <div style={{ background:'#001028', height:'5px', border:'1px solid #002244', marginBottom:'4px' }}>
              <div style={{ height:'100%', width:`${expPct}%`, background:'linear-gradient(90deg,#331100,#cc8800)', transition:'width 0.4s' }} />
            </div>
            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'2px' }}>
              <span>自然回復まで</span>
              <span style={{color:'#44ccff'}}>{regenRemaining>0?`${Math.ceil(regenRemaining)}秒`:'回復中...'}</span>
            </div>
            <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'8px' }}>
              <div style={{ height:'100%', width:`${regenPct}%`, background:'linear-gradient(90deg,#003333,#44ccff)', transition:'width 0.2s' }} />
            </div>
            <div style={{ fontSize:'11px', display:'grid', gridTemplateColumns:'1fr', gap:'2px', color:'#446688', marginBottom:'8px' }}>
              <StatLine label="攻撃力"     base={profile.atk}  bonus={eff.bonus.atk}  color="#ffcc00" statType="atk" />
              <StatLine label="防御力"     base={profile.def}  bonus={eff.bonus.def}  color="#88aaff" statType="def" />
              <StatLine label="特殊攻撃力" base={profile.matk} bonus={eff.bonus.matk} color="#cc44ff" statType="matk" />
              <StatLine label="特殊防御力" base={profile.mdef} bonus={eff.bonus.mdef} color="#44ccff" statType="mdef" />
              <StatLine label="素早さ"     base={profile.spd}  bonus={eff.bonus.spd}  color="#ff8844" statType="spd" />
              <span>ゴールド: <span style={{color:'#ffcc00'}}>{profile.gold}</span></span>
            </div>
            {pendingPoints > 0 && (
              <button onClick={()=>{ setShowStatPanel(true); setStatPoints({hp:0,mp:0,atk:0,def:0,matk:0,mdef:0,spd:0}) }}
                style={{ width:'100%', padding:'6px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                ★ ステータスを振り分ける（{pendingPoints}pt）
              </button>
            )}
          </div>

          <div>
            {showStatPanel && (
              <div style={{ border:'1px solid #cc44ff', background:'#0a0020', padding:'12px', marginBottom:'8px' }}>
                <div style={{ color:'#cc44ff', fontSize:'13px', marginBottom:'6px' }}>ステータスポイント振り分け（残り {pendingPoints-allocatedPoints}pt）</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'10px' }}>
                  {Object.entries(STAT_LABELS).map(([stat,label])=>(
                    <div key={stat} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', border:`1px solid ${(statPoints[stat]||0)>0?'#cc44ff':'#003366'}`, background:(statPoints[stat]||0)>0?'#1a0030':'#000818', padding:'6px 8px' }}>
                      <span style={{ color:'#88ccff', fontSize:'10px' }}>{label}</span>
                      <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
                        <button onClick={()=>{ if((statPoints[stat]||0)>0) setStatPoints(p=>({...p,[stat]:p[stat]-1})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>-</button>
                        <span style={{ color:'#cc44ff', fontSize:'11px', minWidth:'16px', textAlign:'center' }}>{statPoints[stat]||0}</span>
                        <button onClick={()=>{ if(allocatedPoints<pendingPoints) setStatPoints(p=>({...p,[stat]:(p[stat]||0)+1})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', gap:'8px' }}>
                  <button onClick={()=>setShowStatPanel(false)} style={{ flex:1, padding:'8px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>後で</button>
                  <button onClick={confirmStatPoints} disabled={allocatedPoints===0||loading} style={{ flex:2, padding:'8px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', opacity:allocatedPoints===0?0.4:1 }}>決定する{pendingPoints-allocatedPoints>0?`（残り${pendingPoints-allocatedPoints}pt）`:''}</button>
                </div>
              </div>
            )}

            {scene==='town' && (
              <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', marginBottom:'8px' }}>
                <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'8px' }}>🏰 街</div>
                {isDying && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'10px', border:'1px solid #660000', padding:'8px', background:'#1a0000' }}>⚠ 瀕死状態です。宿屋でHP全回復してください。</div>}
                {isAtCap && <div style={{ color:'#ff8844', fontSize:'11px', textAlign:'center', marginBottom:'8px', border:'1px solid #664400', padding:'4px', background:'#1a0800' }}>⚠ {profile.class}はレベルキャップ(LV{cap})に達しています</div>}
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', marginBottom:'3px' }}>
                  <span style={{ color:'#446688' }}>次の行動まで</span>
                  <span style={{ color:canAct?'#44ff88':'#ffcc00' }}>{canAct?'▶ 出撃可能！':`${remaining.toFixed(1)}秒`}</span>
                </div>
                <div style={{ background:'#001028', height:'6px', border:'1px solid #002244', marginBottom:'12px' }}>
                  <div style={{ height:'100%', width:`${timerPct}%`, background:canAct?'#44ff88':'linear-gradient(90deg,#003366,#0088ff)', transition:'width 0.2s' }} />
                </div>
                <div style={{ marginBottom:'10px' }}>
                  <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>エリア選択</div>
                  <select value={selectedArea} onChange={e=>{ const v=Number(e.target.value); setSelectedArea(v); localStorage.setItem('selectedArea',v) }} style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'6px', fontFamily:'monospace', fontSize:'12px' }}>
                    {availableAreas.map(area=><option key={area.id} value={area.id}>{area.name}</option>)}
                  </select>
                </div>
                {papiaEvent.active && (
                  <div style={{ background:'#1a0a00', border:'1px solid #ffaa00', padding:'6px 10px', marginBottom:'8px', textAlign:'center', fontSize:'11px' }}>
                    <span style={{ color:'#ffaa00' }}>🌟 パピア出現率アップ中！</span>
                    <span style={{ color:'#446688', marginLeft:'8px' }}>残り{papiaEvent.remainingMin}分{papiaEvent.remainingSec}秒</span>
                  </div>
                )}
                <button onClick={(e)=>doBattle(e)} disabled={!canAct||loading||!canBattle}
                  style={{ width:'100%', padding:'12px', background:'#001840', border:`1px solid ${canAct&&canBattle?'#ffcc00':'#003366'}`, color:canAct&&canBattle?'#ffcc00':'#446688', cursor:canAct&&canBattle?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'8px' }}>
                  {isBanned?'⛔ 出撃禁止中':isDying&&!canBattle?'💀 瀕死中（HP全回復まで出撃不可）':canAct?`⚔ ${AREAS.find(a=>a.id===selectedArea)?.name}へ出撃！`:'⏳ 待機中...'}
                </button>
                <button onClick={()=>setShowDungeonPanel(!showDungeonPanel)} disabled={dungeonAttempts>=5||loading}
                  style={{ width:'100%', padding:'10px', background:'#0a001a', border:`1px solid ${dungeonAttempts>=5?'#333':'#cc44ff'}`, color:dungeonAttempts>=5?'#333':'#cc44ff', cursor:dungeonAttempts>=5?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px', opacity:dungeonAttempts>=5?0.4:1 }}>
                  ⚔ 特殊ダンジョン　<span style={{fontSize:'11px',color:dungeonAttempts>=5?'#333':'#446688'}}>残り{5-dungeonAttempts}/5</span>
                </button>
                {showDungeonPanel && (
                  <div style={{ border:'1px solid #440088', background:'#0a001a', padding:'10px', marginBottom:'8px' }}>
                    <div style={{ color:'#cc44ff', fontSize:'11px', marginBottom:'8px' }}>ダンジョンを選択</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                      {[
                        { type:'exp',   label:'経験値ダンジョン' },
                        { type:'gold',  label:'ゴールドダンジョン' },
                        { type:'stone', label:'強化石ダンジョン' },
                        { type:'prof',  label:'熟練度ダンジョン' },
                      ].map(d => (
                        <button key={d.type} onClick={() => { doDungeon(d.type); setShowDungeonPanel(false) }}
                          style={{ padding:'10px', background:'#001020', border:'1px solid #440088', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={()=>{ setScene('inn'); setInnMessage('') }} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #0088aa', color:'#00aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>🏨 宿屋へ</button>
                <button onClick={()=>{ setScene('temple'); setTempleMessage('') }} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ccaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>⛩ 神殿へ</button>
                <button onClick={()=>nav('/shop')} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #44aa44', color:'#44aa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>🛒 商店へ</button>
                <button onClick={()=>nav('/smithy')} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>⚒ 鍛冶屋へ</button>
                <button onClick={()=>nav('/fishing')} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px' }}>🎣 釣り場へ</button>
                <button onClick={()=>nav('/barber')} style={{ width:'100%', padding:'10px', background:'#001020', border:'1px solid #ff88cc', color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✂ 美容院へ</button>
              </div>
            )}

            {scene==='inn' && (
              <div style={{ border:'1px solid #0088aa', background:'#001030', padding:'20px', textAlign:'center' }}>
                <div style={{ color:'#00aacc', fontSize:'14px', marginBottom:'16px' }}>🏨 宿屋</div>
                {innMessage ? (
                  <div style={{ color:'#44ff88', fontSize:'14px', padding:'20px' }}>{innMessage}</div>
                ) : (
                  <>
                    <div style={{ color:'#88ccff', fontSize:'12px', lineHeight:'2', marginBottom:'16px' }}>
                      {isDying
                        ? profile.gold < charLv*15
                          ? <>これはひどいお姿で…。特別なお手当が必要でございます。<br/><span style={{color:'#ffcc00'}}>{charLv*15}G</span> のところ、所持金 <span style={{color:'#ffcc00'}}>{innCost}G</span> で承ります。</>
                          : <>これはひどいお姿で…。特別なお手当として <span style={{color:'#ffcc00'}}>{innCost}G</span> でございます。</>
                        : <>一泊 <span style={{color:'#ffcc00'}}>{innCost}G</span> でございます。<br/>ゆっくりお休みになりますか？</>}
                    </div>
                    <div style={{ color:'#446688', fontSize:'11px', marginBottom:'16px' }}>
                      所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span>
                      {!isDying && profile.gold<innCost && <span style={{color:'#ff4444'}}> （ゴールドが足りません）</span>}
                    </div>
                    <div style={{ display:'flex', gap:'8px' }}>
                      <button onClick={backToTown} style={{ flex:1, padding:'10px', background:'#001840', border:'1px solid #0088ff', color:'#0088ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏰 街に戻る</button>
                      <button onClick={useInn} disabled={!isDying&&profile.gold<innCost}
                        style={{ flex:2, padding:'10px', background:'#001830', border:'1px solid #0088aa', color:'#00aacc', cursor:(!isDying&&profile.gold<innCost)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', opacity:(!isDying&&profile.gold<innCost)?0.4:1 }}>
                        利用する
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {scene==='temple' && TempleContent()}

            {scene==='battle' && (
              <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px' }}>
                <div style={{ color:'#ff6644', fontSize:'13px', marginBottom:'10px' }}>⚔ バトル！</div>
                {loading && <div style={{ color:'#446688', fontSize:'12px', marginBottom:'10px' }}>戦闘中...</div>}
                <div style={{ marginBottom:'12px', maxHeight:'300px', overflowY:'auto' }}>
                  {battleLogs.map((l,i)=>(
                    <div key={i} style={{ color:l.color, fontSize:'12px', lineHeight:'2', borderBottom:'1px solid #001428', padding:'2px 0' }}>{l.text}</div>
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

// ============================================================
// サブコンポーネント
// ============================================================
function effectiveEvasionRate(rate) { return rate }

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
  const rank = getStatRank(base+bonus, statType)
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span>
        {label}: <span style={{color}}>{base+bonus}</span>
        {bonus > 0 && <span style={{color:'#44ccff', fontSize:'10px'}}> (+{bonus})</span>}
      </span>
      <span style={{ color:rank.color, fontSize:'10px', fontWeight:'bold' }}>{rank.rank}</span>
    </div>
  )
}

function MiniBar({ label, val, pct, color }) {
  return (
    <>
      <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'1px' }}>
        <span>{label}</span><span style={{color}}>{val}</span>
      </div>
      <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'4px' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,#001,${color})` }} />
      </div>
    </>
  )
}

function StatMini({ label, base, bonus, color, type }) {
  const rank = getStatRank(base+bonus, type)
  return (
    <div style={{ background:'#000818', border:'1px solid #002244', padding:'3px 6px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span style={{ color:'#446688', fontSize:'9px' }}>{label}</span>
      <span>
        <span style={{color, fontSize:'10px'}}>{base+bonus}</span>
        {bonus > 0 && <span style={{color:'#44ccff', fontSize:'9px'}}>(+{bonus})</span>}
        <span style={{color:rank.color, fontSize:'9px', marginLeft:'2px'}}>{rank.rank}</span>
      </span>
    </div>
  )
}
