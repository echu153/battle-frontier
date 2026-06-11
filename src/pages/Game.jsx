import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import papiaIcon from '../assets/papia.png'
import { GEM_DATA, GEM_RANKS, GEM_TYPES, PEN_CAP, gemEffectValue, calcDefReduction } from '../lib/stats'
import { charmPlayerBonus } from '../constants/pets'
import { countClaimableTitles } from '../lib/titles'
// Equipment.jsx 等が './Game' から参照しているため再export
export { GEM_DATA, GEM_RANKS, GEM_TYPES, gemEffectValue, calcDefReduction } from '../lib/stats'

export const WAIT_SECONDS = 10
const REGEN_SECONDS = 60

export const ARTIFACT_BASE_NAMES = [
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたオーブ'
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
const MATERIAL_NAMES = ['森の生命液','荒野の薬草','古代の精髄','蒼海の精気','雷鳴の精気','霜の精気']
const HP_MATERIAL_NAMES = ['森の生命液','荒野の薬草','古代の精髄']
const MP_MATERIAL_NAMES = ['蒼海の精気','雷鳴の精気','霜の精気']

export const AREAS = [
  {
    id: 1, name: '始まりの森',
    enemies: [
      { name:'スライム',   hp:30,  atk:8,   def:3,  matk:0,  mdef:3,  spd:3,  type:'physical', gold:5  },
      { name:'コウモリ',   hp:37,  atk:10,  def:3,  matk:0,  mdef:3,  spd:15, type:'physical', gold:6  },
      { name:'毒キノコ',   hp:60,  atk:3,   def:4,  matk:12, mdef:7,  spd:2,  type:'magical',  gold:8  },
    ],
    boss: { name:'ビッグスライム', hp:500, atk:28, def:28, matk:5, mdef:30, spd:15, gold:50, isBoss:true, type:'physical' },
    commonDrops: ['木の盾','木の靴','粗悪な布','粗悪な鎧','粗悪な指輪','粗悪なピアス','ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書'],
    rareDrops: ['ロングソード','マチェット','丈夫な弓','見習いの杖','見習い魔導書','魔導の杖','魔術教本'],
    bossDrops: ['スライムの指輪','蒼粘剣'],
    bossSpecialDrop: { name:'ぷよぷよロッド', rate:5 },
    materialDrops: ['森の生命液'],
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
    bossSpecialDrop: { name:'怪盗の指輪', rate:5 },
    materialDrops: ['荒野の薬草'],
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
    bossSpecialDrop: { name:'結晶グリーブ', rate:5 },
    materialDrops: ['古代の精髄'],
  },
  {
    id: 4, name: '蒼海の入り江',
    enemies: [
      { name:'深海魚人', hp:900,  atk:200, def:220, matk:40,  mdef:200, spd:200, type:'physical', gold:150 },
      { name:'海賊',     hp:1000, atk:230, def:240, matk:20,  mdef:180, spd:240, type:'physical', gold:180 },
      { name:'毒クラゲ', hp:800,  atk:80,  def:180, matk:180, mdef:240, spd:210, type:'magical',  gold:160 },
    ],
    boss: {
      name:'シーサーペント', hp:18000, atk:680, def:360, matk:550, mdef:400, spd:360, gold:2500, isBoss:true, type:'physical',
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
    materialDrops: ['蒼海の精気'],
  },
  {
    id: 5, name: '巨峰山脈',
    enemies: [
      { name:'山岳ゴブリン', hp:1500, atk:640, def:510, matk:0,   mdef:450, spd:380, type:'physical', gold:250 },
      { name:'岩石ゴーレム', hp:2000, atk:760, def:660, matk:0,   mdef:420, spd:400, type:'physical', gold:300 },
      { name:'グリフォン',   hp:1800, atk:700, def:540, matk:120, mdef:510, spd:450, type:'physical', gold:280 },
    ],
    boss: {
      name:'雷鷲サンダーロック', hp:35000, atk:750, def:960, matk:250, mdef:900, spd:1175, gold:6000, isBoss:true, type:'physical',
      skills: [
        { name:'雷爪乱舞', type:'physical_multi', mult:0.7, hits:3 },
        { name:'雷光閃',   type:'physical', mult:1.8, paralysisRate:0.3 },
        { name:'嵐の加護', type:'buff',     effect:'atkSpdUp', atkRate:1.5, spdRate:1.5, turns:3 },
        { name:'雷鳴',     type:'heal',     rate:0.1 },
      ],
      specialMove: { name:'天穿雷撃', type:'physical', mult:2.5, defDownRate:0.9, turns:3 },
    },
    commonDrops: ['山岳の斧','岩砕の拳','霞散弾銃','嵐のオーブ','峰岳の兜','岩石鎧','山岳の靴','岩石の護符'],
    rareDrops:   ['雷砕斧','鷹爪の拳','雷鳴銃','雷晶オーブ','嵐の兜','雷鷲鎧','疾風の靴','峰岳の守護輪'],
    bossDrops:   ['雷鷲の爪牙','嵐の重装甲'],
    materialDrops: ['雷鳴の精気'],
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
      name:'氷霊フロストバーン', hp:60000, atk:850, def:1700, matk:2000, mdef:1800, spd:1400, gold:12500, isBoss:true, type:'magical',
      skills: [
        { name:'氷柱連打',   type:'magical_multi', mult:0.5, hits:4 },
        { name:'絶対零度',   type:'magical',  mult:2.2, stunRate:0.3 },
        { name:'氷の鎧',     type:'buff',     effect:'defMdefUp', defRate:1.4, mdefRate:1.4, turns:3 },
        { name:'氷獄の恩寵', type:'heal',     rate:0.25, regenRate:0.03, regenTurns:4 },
      ],
      specialMove: { name:'氷棺葬送', type:'magical', mult:2.5, stun:true },
    },
    commonDrops: ['氷刃の剣','霜穿の槍','吹雪の弓','氷晶の杖','凍月刀','氷晶の護符'],
    rareDrops:   ['白銀の大剣','氷河長槍','極雪の弓','霜嵐の杖','凍蒼の刀','霜の宝珠'],
    bossDrops:   ['絶零の魔導砲','フロストバーンの聖鎧'],
    materialDrops: ['霜の精気'],
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
      name:'深紅のサラマンダー', hp:100000, atk:2500, def:2800, matk:1400, mdef:2300, spd:2100, gold:25000, isBoss:true, type:'physical',
      skills: [
        { name:'溶岩爪撃',   type:'physical', mult:2.0, burnRate:0.3 },
        { name:'業火放射',   type:'magical',  mult:2.2, debuff:'mdefDown', debuffRate:0.8, debuffTurns:3 },
        { name:'煉獄の覇気', type:'buff',     effect:'atkMatkUp', atkRate:1.8, matkRate:1.8, turns:5 },
        { name:'火焔転生',   type:'heal',     rate:0.3, dmgReduceRate:0.7, dmgReduceTurns:2 },
      ],
      specialMove: { name:'炎獄の審判', type:'physical', mult:2.5, burn:true, healSealTurns:4 },
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
  '戦士':    { hp_max:80, mp_max:10, atk:10, def:8,  matk:1,  mdef:3,  spd:5  },
  '弓使い':  { hp_max:60, mp_max:15, atk:8,  def:4,  matk:2,  mdef:3,  spd:10 },
  '魔法使い':{ hp_max:45, mp_max:50, atk:2,  def:2,  matk:14, mdef:4,  spd:4  },
  '僧侶':    { hp_max:55, mp_max:45, atk:2,  def:3,  matk:7,  mdef:12, spd:3  },
  '格闘家':  { hp_max:70, mp_max:10, atk:10, def:6,  matk:2,  mdef:5,  spd:7  },
}
// 上位クラスはJOB_BASEを持たず、requires元の基本クラスのJOB_BASEを引き継ぐ
const getBaseClassStats = (className) => {
  if (JOB_BASE[className]) return JOB_BASE[className]
  const adv = ADVANCED_CLASSES[className]
  return JOB_BASE[adv?.requires] || JOB_BASE['戦士']
}

export const JOB_GROWTH = {
  '戦士':      { hp:20, mp:5,  atk:1, def:2, matk:0, mdef:1, spd:1 },
  '弓使い':    { hp:10, mp:5,  atk:2, def:1, matk:0, mdef:1, spd:2 },
  '魔法使い':  { hp:10, mp:10, atk:0, def:1, matk:2, mdef:1, spd:1 },
  '僧侶':      { hp:10, mp:5,  atk:0, def:2, matk:1, mdef:2, spd:1 },
  '侍':        { hp:20, mp:5,  atk:2, def:1, matk:1, mdef:1, spd:2 },
  '狂戦士':    { hp:20, mp:5,  atk:3, def:1, matk:1, mdef:1, spd:1 },
  '狩人':      { hp:20, mp:5,  atk:2, def:1, matk:1, mdef:1, spd:2 },
  '暗殺者':    { hp:10, mp:5,  atk:2, def:1, matk:1, mdef:1, spd:3 },
  '元素使い':  { hp:10, mp:10, atk:1, def:1, matk:3, mdef:1, spd:1 },
  '死霊使い':  { hp:10, mp:10, atk:1, def:1, matk:2, mdef:2, spd:1 },
  '聖職者':    { hp:10, mp:10, atk:0, def:2, matk:2, mdef:2, spd:1 },
  '異端審問官':{ hp:10, mp:10, atk:0, def:2, matk:2, mdef:2, spd:1 },
  '賢者':      { hp:10, mp:10, atk:1, def:1, matk:2, mdef:2, spd:1 },
  '格闘家':    { hp:10, mp:5,  atk:2, def:1, matk:0, mdef:2, spd:1 },
  'サイキッカー':{ hp:10, mp:5, atk:2, def:1, matk:2, mdef:1, spd:2 },
  '体術師':    { hp:20, mp:5,  atk:2, def:1, matk:1, mdef:1, spd:2 },
  '魔銃士':    { hp:10, mp:5,  atk:2, def:1, matk:2, mdef:1, spd:2 },
  'ギャンブラー':{ hp:10, mp:10, atk:1, def:2, matk:1, mdef:2, spd:1 },
  '魔法剣士':  { hp:10, mp:10, atk:2, def:1, matk:2, mdef:1, spd:1 },
  '聖騎士':    { hp:20, mp:5,  atk:1, def:2, matk:1, mdef:2, spd:1 },
}

export const JOB_LEVEL3_BONUS = {}

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
  'ギャンブラー':{ requiresItem:'gambler_proof' },
  '魔法剣士':  { requires:'戦士', requiresLv:50, requires2:'魔法使い', requires2Lv:50 },
  '聖騎士':    { requires:'戦士', requiresLv:50, requires2:'僧侶',    requires2Lv:50 },
}

const CLASS_LEVEL_CAP = {
  '戦士':100, '弓使い':100, '魔法使い':100, '僧侶':100, '格闘家':100,
  '侍':100, '狂戦士':100, '狩人':100, '暗殺者':100,
  '元素使い':100, '死霊使い':100, '聖職者':100, '異端審問官':100, '賢者':100,
  'サイキッカー':100, '体術師':100, '魔銃士':100,
  'ギャンブラー':100,
  '魔法剣士':100, '聖騎士':100,
}
// 再修練5回でそのクラスのレベルキャップが300に解放される
// 再修練強化の表示用説明（上から1段ずつ＝再修練1回ごとに解放）
export const RETRAINING_ENHANCEMENTS = {
  '侍': ['居合斬：倍率 ATK×1.3＋SPD×0.4', '断空：防御無視 50%', '心眼：与ダメ+5%（合計+10%）', '明鏡止水：命中+15', '月影：倍率 ATK×2.2'],
  '狂戦士': ['マッドラッシュ：倍率 ATK×1.9', 'すてみ：反動 5%', 'バーサク：与ダメ+5%（合計+20%）', 'ブラッティロア：攻撃力上昇 ×1.3', 'フルブレイカー：防御無視 50%'],
  '狩人': ['毒矢：毒付与 100%', '三連射：倍率 ATK×0.6/hit', '鷹ノ目：命中+10（基本と合計+20）', '狩猟本能：攻撃・素早さ ×1.5', '絶影狙撃：倍率 ATK×2.2'],
  '暗殺者': ['瞬歩瞬殺：出血確率 100%', '鬼影閃：出血確率 80%', '隠身：クリティカル威力+20%', '影歩き：効果8ターン', '急所突き：出血スタック×20%追撃（最大100%）→出血消費'],
  '元素使い': ['アクアショット：倍率 MATK×1.6', 'アースクエイク：スタン60%', '元素共鳴：与ダメ+25%', 'ライトニングボルト：倍率 MATK×1.7', 'フレイムバースト：やけど100%'],
  '死霊使い': ['骸骨召喚：倍率 MATK×0.8', 'ソウルドレイン：倍率 MATK×1.4', '骸の壁：バリア中 防御・特防×1.2', '腐敗霧：防御・特防低下 ×0.6', '幽世ノ門：効果5ターン'],
  '聖職者': ['ホーリーライト：30%で回復阻害50%', '奇跡：毎ターン最大HP15%回復', '神聖加護：回復×1.4＋回復量の50%を敵に', '祈りの結界：6ターン', '神罰執行：倍率 MATK×2.0'],
  '異端審問官': ['粛清：倍率 MATK×1.4＋MDEF×0.4', '狂信：特殊攻撃×1.3 追加', '執行本能：与ダメ+15%', '聖なる裁き：倍率 MATK×1.9', '断罪：回復封じ 60%'],
  '賢者': ['サンダーストライク：倍率 MATK×1.6', 'マナボルト：消費MP×6', '天啓：MATK×1.3', '氷の障壁：4ターン', 'メテオストライク：2〜5ヒット（2:30/3:40/4:20/5:10%）'],
  '聖騎士': ['ホーリーエッジ：倍率 ATK×1.6＋MATK×0.6', 'ディバインスマイト：与ダメ低下付与 50%', '聖騎士の心得：防御・特防×1.3', '聖域展開：毎ターン最大HP10%回復', '神聖覚醒：追撃 防御・特防の60%'],
  '魔法剣士': ['雷光斬：倍率 ATK×1.3＋MATK×0.6', '閃光：連続強化×1.2（最大4重複）', '魔導剣術：変換率60%', '魔剣開放：反動2ターンに短縮', 'エレメンタルエッジ：倍率 ATK×1.7＋MATK×0.8'],
  '魔銃士': ['魔弾：倍率 ATK×1.0＋MATK×1.0', '連装銃撃：命中+10', '精密照準：同スキル連続で威力×1.1', '強化装填：5ターン', 'キャノネスチュームビンド：連続強化×1.3が最大2重複'],
  'サイキッカー': ['サイコショット：倍率 ATK×1.3＋MATK×0.6', 'マインドブレイク：40%でスタン', '第六感：与ダメ+5%（合計+10%）', '精神集中：×1.8・3ターン', 'サイコブラスト：倍率 ATK×1.8＋MATK×1.0'],
  '体術師': ['半月蹴り：次のスキルの威力×1.5', '五連殺：各ヒット20%で出血', '闘争本能：HP50%以下で与ダメ+25%', '破衝掌：防御無視 50%', '飛天三角蹴り：ミス撤廃＋各ヒットATK+0.1'],
  'ギャンブラー': ['ジャグリング：4ヒット', 'ラッキーダイス：×0.9〜2.2', 'ギャンブルボディ：被ダメ ×0.7〜1.1', 'オールイン：効果・反動6ターン', 'ジャックポット：2倍確率10%'],
}

export const getEffectiveCap = (className, retraining) => {
  const cnt = (retraining || {})[className] || 0
  if (cnt >= 5) return 300
  return CLASS_LEVEL_CAP[className] || 100
}

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
// 防御ランク→被ダメージ軽減率（calcDefReduction）は ../lib/stats に集約。
// 上部で import / 再export 済み。

// ATK²/(ATK+DEF) 比率式ベースダメージ
const calcRatioDmg = (atk, enemyDef, mult, am) => {
  const adjDef = Math.max(0, enemyDef)
  return Math.floor((atk * atk / Math.max(1, atk + adjDef)) * mult * am)
}

const getStatRank = (val, type) => {
  let thresholds
  if (type === 'hp') thresholds = [550,1500,3000,5500,9000,15000,22000,33000]
  else if (type === 'mp') thresholds = [280,750,1500,2800,4500,7500,11000,16500]
  else thresholds = [55,150,300,550,950,1500,2200,3300]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (val <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank:'SSS', color:'#ffcc00' }
}

const calcTotal = (p) => Math.floor((p.hp_max/10)+(p.mp_max/5)+p.atk+p.def+p.matk+p.mdef+p.spd)

// EXP凍結中か（手動のexp_frozen、または期限付きのexp_frozen_until）
const expIsFrozen = (p) => !!(p && (p.exp_frozen || (p.exp_frozen_until && new Date(p.exp_frozen_until) > new Date())))
// オートクリッカー検知：直近サンプル数と、間隔のばらつき許容幅(ms)
const AUTOCLICK_SAMPLES = 60  // 約10分相当（通常出撃CD10秒 × 60回）連続で規則的ならBOT確認
const AUTOCLICK_SPREAD_MS = 1000

const getTotalRank = (total) => {
  const thresholds = [250,600,1200,2500,5000,8500,14000,20000]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (total <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank:'SSS', color:'#ffcc00' }
}

export const calcExpNext = (lv) => {
  // LV100超（再修練でキャップ300になったクラス）の必要経験値
  if (lv >= 100) {
    if (lv <= 150) return 150  // LV100〜150
    if (lv <= 200) return 160  // LV151〜200
    if (lv <= 250) return 170  // LV201〜250
    return 180                 // LV251〜300
  }
  const lvInBlock = (lv - 1) % 100
  if (lvInBlock < 9)  return 80   // LV1〜9
  if (lvInBlock < 29) return 100  // LV10〜29
  if (lvInBlock < 59) return 120  // LV30〜59
  return 140                      // LV60〜99
}

const WEAPON_TYPE_GROUP = {
  sword:'physical', axe:'physical', spear:'physical', bow:'physical', dagger:'physical',
  knuckle:'physical', gun:'physical', katana:'physical',
  staff:'magical', wand:'magical', tome:'magical', orb:'magical',
}
const getWeaponGroup = (weaponType) => WEAPON_TYPE_GROUP[weaponType] || 'physical'

const getProfPrefix = (profLv) => {
  if (profLv >= 2000) return '【伝説】'
  if (profLv >= 1000) return '【神】'
  if (profLv >= 600)  return '【覇】'
  if (profLv >= 300)  return '【極】'
  if (profLv >= 200)  return '【真】'
  if (profLv >= 100)  return '【改】'
  return ''
}

// 熟練度ボーナス（stats.jsと同一ロジック）
const calcProfBonus = (prof, weapon) => {
  if (!prof || !weapon) return {}
  const profLv = prof.prof_lv || 0
  let rate
  if (profLv <= 300) {
    rate = profLv * 0.01 + Math.floor(profLv / 100) * 0.5
  } else {
    const base = 4.5
    const lv300  = Math.min(profLv, 600) - 300
    const lv600  = Math.max(0, Math.min(profLv, 1000) - 600)
    const lv1000 = Math.max(0, Math.min(profLv, 2000) - 1000)
    const lv2000 = Math.max(0, profLv - 2000)
    rate = base
      + Math.floor(lv300  / 10)  * 0.01
      + Math.floor(lv600  / 20)  * 0.01
      + Math.floor(lv1000 / 50)  * 0.01
      + Math.floor(lv2000 / 100) * 0.01
  }
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
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたオーブ'
])

const calcEnhancedStat = (base, plus) => {
  if (!plus || plus <= 0 || base <= 0) return base
  return Math.ceil(base * Math.pow(1.5, plus))
}

export const calcEffectiveStats = (profile, equipment, proficiency, titleBonus = null) => {
  const bonus = { atk:0, def:0, matk:0, mdef:0, spd:0, hp:0, mp:0 }
  let matkPct = 0
  let hitBonus = 0
  let critBonus = 0
  let evasionBonus = 0
  let critResist = 0
  let defPen = 0   // 防御貫通%（宝石）
  let mdefPen = 0  // 魔法防御貫通%（宝石）
  let critDmg = 0  // クリティカル威力%（宝石）
  for (const item of equipment) {
    if (!item.equipped || !item.weapons) continue
    // 埋め込み宝石の効果
    if (item.gem_type && item.gem_rank) {
      const g = GEM_DATA[item.gem_type]
      const v = gemEffectValue(item.gem_type, item.gem_rank)
      if (g) {
        switch (g.effect) {
          case 'hp':   bonus.hp += v; break
          case 'mp':   bonus.mp += v; break
          case 'atk':  bonus.atk += v; break
          case 'def':  bonus.def += v; break
          case 'matk': bonus.matk += v; break
          case 'mdef': bonus.mdef += v; break
          case 'spd':  bonus.spd += v; break
          case 'atk_matk': bonus.atk += v; bonus.matk += v; break
          case 'def_mdef': bonus.def += v; bonus.mdef += v; break
          case 'def_pen':     defPen += v; break
          case 'mdef_pen':    mdefPen += v; break
          case 'crit':        critBonus += v; break
          case 'crit_resist': critResist += v; break
          case 'hit':         hitBonus += v; break
          case 'evasion':     evasionBonus += v; break
          case 'crit_dmg':    critDmg += v; break
        }
      }
    }
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
    critBonus   += w.crit_bonus  || 0   // 武器固有クリティカル率
    critResist  += w.crit_resist || 0   // 武器固有クリティカル抵抗
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
  const baseMatk = profile.matk + bonus.matk + (profile.museum_matk || 0)
  const finalMatk = matkPct > 0 ? Math.floor(baseMatk * (1 + matkPct/100)) : baseMatk
  const tb = titleBonus || {}
  // 選択ペットの装備チャーム反映（profile.petCharm が無ければ無影響）。守りは防御+10%
  const pc = profile.petCharm || {}
  let defVal = profile.def + bonus.def + (profile.museum_def || 0) + (tb.def_bonus || 0) + (pc.def || 0)
  if (pc.guard) defVal = Math.round(defVal * 1.1)
  return {
    atk:    profile.atk  + bonus.atk  + (profile.museum_atk || 0) + (tb.atk_bonus || 0) + (pc.atk || 0),
    def:    defVal,
    matk:   finalMatk + (tb.matk_bonus || 0) + (pc.matk || 0),
    mdef:   profile.mdef + bonus.mdef + (profile.museum_mdef || 0) + (tb.mdef_bonus || 0) + (pc.mdef || 0),
    spd:    profile.spd  + bonus.spd  + (profile.museum_spd || 0) + (tb.spd_bonus || 0),
    hp_max: profile.hp_max + bonus.hp + (profile.museum_hp || 0) + (tb.hp_bonus || 0) + (pc.hp || 0),
    mp_max: profile.mp_max + bonus.mp + (profile.museum_mp || 0) + (tb.mp_bonus || 0),
    bonus,
    hitBonus,
    critBonus,
    evasionBonus,
    critResist,
    defPen:  Math.min(PEN_CAP, defPen/100),   // 0〜0.8 の係数
    mdefPen: Math.min(PEN_CAP, mdefPen/100),
    critDmg: critDmg/100,  // クリティカル威力の加算分（係数）
  }
}

// 回避率計算（防御側SPD > 攻撃側SPDのとき回避率UP、最大10%）
// 回避率：相手より速いほど上昇。上限20%（相手の2倍速で上限到達）
export const calcEvasionRate = (defenderSpd, attackerSpd) => {
  if (defenderSpd <= attackerSpd) return 0
  return Math.min(20, (defenderSpd - attackerSpd) / attackerSpd * 20)
}

export const calcExtraActionRate = (mySpd, enemySpd) => {
  if (mySpd <= enemySpd) return 0
  const diff = mySpd - enemySpd
  const rawRate = (diff/enemySpd)*50
  if (rawRate <= 50) return rawRate
  return 50 + (rawRate-50)*0.5
}

// クリティカル率：素早さ(SPD)の値で決まる。防御の軽減ボーナス(calcDefReduction)と同じ補間方式。
// F=0% ～ SSS=20%（均等カーブ）。閾値は SPD ランク（=物理/防御系）と一致。
// ※ 第2引数(enemySpd)は後方互換のため残すが未使用。
const CRIT_SPD_THRESHOLDS = [55, 150, 300, 550, 950, 1500, 2200, 3300]
const CRIT_RATE_TIERS     = [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]  // F..SSS（素早さ補正ぶん）
const CRIT_BASE_RATE = 100 / 24  // 基礎クリ率（約4.17%）。これに素早さ補正を加算する
export const calcCritRate = (mySpd, _enemySpd) => {
  // 素早さ補正（F=0% 〜 SSS=20%）を線形補間で算出
  let spdBonus = 0
  if (mySpd && mySpd > 0) {
    const thresholds = [0, ...CRIT_SPD_THRESHOLDS]
    const rates = CRIT_RATE_TIERS
    if (mySpd >= thresholds[thresholds.length - 1]) spdBonus = rates[rates.length - 1]
    else {
      for (let i = 1; i < thresholds.length; i++) {
        if (mySpd <= thresholds[i]) {
          const progress = (mySpd - thresholds[i - 1]) / (thresholds[i] - thresholds[i - 1])
          spdBonus = rates[i - 1] + (rates[i] - rates[i - 1]) * progress
          break
        }
      }
    }
  }
  return CRIT_BASE_RATE + spdBonus  // 基礎(1/24) ＋ 素早さ補正
}

const RARITY_BONUS_COUNT = { f:1, e:1, d:2, c:2, b:3, a:3, s:4, ss:4, sss:4 }

export const generateDropBonus = (weapon) => {
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

export const applyEquipmentEffects = (equipment, profile, playerBuffs, logs) => {
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
export const executeSkill = (skill, eff, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkill = '') => {
  const result = { dmg:0, heal:0, log:'', newEnemyBuffs:{ ...enemyBuffs }, newPlayerBuffs:{ ...playerBuffs }, selfDmg:0, bonusCritRate:0 }
  const randMult = (min, max) => min + Math.random()*(max-min)
  const am = isArtifact ? 1.2 : 1.0
  // 再修練強化：現在クラスがそのスキルのクラスと一致する場合のみ、再修練回数ぶん段階強化が乗る
  const rt = (profile?.class === skill?.class_name) ? ((profile?.retraining||{})[skill?.class_name]||0) : 0
  // 敵DEF・MDEF の低い方で軽減する計算（ハイブリッドスキル用）
  const calcMinDef = () => {
    const edr = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
    const emr = (enemyBuffs.mdefDown?.rate||1)*(enemyBuffs.mdefUp?.rate||1)
    return Math.min(Math.floor((enemy.def||0)*edr/2), Math.floor((enemy.mdef||0)*emr/2))
  }
  const r = () => 0.85 + Math.random()*0.3
  switch (skill.name) {
    case '体当たり':    result.dmg = Math.floor(eff.atk*1.2*am); result.log = `⚔ 体当たり！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    case '強撃':        result.dmg = Math.floor(eff.atk*1.4*am); result.log = `💥 強撃！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    case '防御崩し': {
      result.dmg = Math.floor(eff.atk*1.3*am)
      const defBreakHit = Math.random()*100 < 30
      if (defBreakHit) result.newEnemyBuffs.defDown={turns:4,rate:0.8}
      result.log = `🗡 防御崩し！ ${enemy.name}に${result.dmg}の物理ダメージ！${defBreakHit ? ' 防御力が低下した！' : ''}`
      break
    }
    case '防御態勢':    result.newPlayerBuffs.defUp={turns:4,rate:1.3}; result.log = `🛡 防御態勢！ 4ターンの間防御力と特殊防御力が上昇した！`; break
    case '応急手当':    result.heal = Math.floor(profile.hp_max*0.15); result.log = `💊 応急手当！ HPを${result.heal}回復した！`; break
    case 'シールドアタック': result.dmg = Math.floor((eff.atk*0.8+eff.def*0.4)*am); result.log = `🛡 シールドアタック！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    case '狙撃':        result.dmg = Math.floor(eff.spd*1.2*am); result.log = `🏹 狙撃！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    case '駆け足':      result.newPlayerBuffs.spdUp={turns:4,rate:1.3}; result.log = `💨 駆け足！ 4ターンの間素早さが上昇した！`; break
    case '貫通射撃': {
      const edr_p = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
      const defVal_p = Math.floor((enemy.def||0)*edr_p*0.8/2)
      result.dmg = Math.max(1, Math.floor(eff.atk*1.2*am) - defVal_p)
      result.log = `🏹 貫通射撃！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    }
    case '疾風矢':      result.dmg = Math.floor((eff.atk*1.0+eff.spd*0.5)*am); result.log = `💨 疾風矢！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    case '剛射':        result.dmg = Math.floor(eff.atk*1.2*am); result.log = `🏹 剛射！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    case 'マジックアロー': {
      const ma1 = Math.floor(eff.matk*0.7*am*r()), ma2 = Math.floor(eff.matk*0.7*am*r())
      result.dmg = ma1+ma2
      result.log = `🔮 マジックアロー！ ${enemy.name}に${ma1}の特殊ダメージ！${ma2}の特殊ダメージ！`; break
    }
    case 'ファイア': {
      result.dmg = Math.floor(eff.matk*1.3*am)
      const burnHit = Math.random()*100 < 20
      if (burnHit) result.newEnemyBuffs.burn = { turns:5, dmgRate:0.02 }
      result.log = `🔥 ファイア！ ${enemy.name}に${result.dmg}の特殊ダメージ！${burnHit ? ' やけど状態！' : ''}`
      break
    }
    case '精神統一':    result.newPlayerBuffs.matkUp={turns:4,rate:1.3}; result.log = `✨ 精神統一！ 4ターンの間特殊攻撃力が上昇した！`; break
    case 'サンダー': {
      result.dmg = Math.floor(eff.matk*1.4*am)
      const pHit = Math.random()*100 < 20
      if (pHit && !(enemyBuffs.paralysis?.turns > 0)) result.newEnemyBuffs.paralysis = { turns:5, skipRate:0.25, spdRate:0.8 }
      result.log = `⚡ サンダー！ ${enemy.name}に${result.dmg}の特殊ダメージ！${pHit && !(enemyBuffs.paralysis?.turns > 0) ? ' 麻痺した！' : ''}`
      break
    }
    case 'アイスランス': {
      result.dmg = Math.floor(eff.matk*1.6*am)
      const slowHit = Math.random()*100 < 40
      if (slowHit) result.newEnemyBuffs.spdDown = { turns:3, rate:0.5 }
      result.log = `❄ アイスランス！ ${enemy.name}に${result.dmg}の特殊ダメージ！${slowHit ? ' スロー状態！' : ''}`
      break
    }
    case 'ライト':      result.dmg = Math.floor(eff.matk*1.3*am); result.log = `✨ ライト！ ${enemy.name}に${result.dmg}の特殊ダメージ！`; break
    case 'ヒール':      result.heal = Math.floor(profile.hp_max*0.15+eff.matk*0.2); result.log = `💚 ヒール！ HPを${result.heal}回復した！`; break
    case 'プロテク':    result.newPlayerBuffs.defUp={turns:4,rate:1.2}; result.log = `🛡 プロテク！ 4ターンの間防御力と特殊防御力が上昇した！`; break
    case '祈祷':        result.newPlayerBuffs.regenHeal={turns:4,amount:Math.floor(profile.hp_max*0.1)}; result.log = `🙏 祈祷！ 4ターンの間毎ターンHPが回復するようになった！`; break
    case 'ライトニング': {
      result.dmg = Math.floor(eff.matk*1.5*am)
      const mdefHit = Math.random()*100 < 30
      if (mdefHit) result.newEnemyBuffs.mdefDown={turns:3,rate:0.7}
      result.log = `⚡ ライトニング！ ${enemy.name}に${result.dmg}の特殊ダメージ！${mdefHit ? ' 特殊防御力が低下した！' : ''}`
      break
    }
    case '居合斬': {
      result.dmg = Math.floor((eff.atk*(rt>=1?1.3:1.1)+eff.spd*0.4)*am)
      const bleedHit1 = Math.random()*100 < 20
      if (bleedHit1) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `⚔ 居合斬！ ${enemy.name}に${result.dmg}の物理ダメージ！${bleedHit1 ? ` ${enemy.name}は出血した！` : ''}`
      break
    }
    case '断空': {
      const edr_dk = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
      const defVal_dk = Math.floor((enemy.def||0)*edr_dk*(rt>=2?0.5:0.7)/2)
      result.dmg = Math.max(1, Math.floor(eff.atk*1.6*am) - defVal_dk)
      result.log = `⚔ 断空！ ${enemy.name}の防御を断ち切り${result.dmg}の物理ダメージ！`
      break
    }
    case '明鏡止水':    result.newPlayerBuffs.atkUp={turns:4,rate:1.5}; result.newPlayerBuffs.hitBonus={turns:4,value:rt>=4?15:5}; result.log = `✨ 明鏡止水！ 4ターンの間攻撃力が上昇し命中率UP！`; break
    case '月影': {
      result.dmg = Math.floor(eff.atk*(rt>=5?2.2:2.0)*am)
      const bleedHit6 = Math.random()*100 < 40
      if (bleedHit6) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `🌙 月影！ ${enemy.name}に${result.dmg}の物理ダメージ！${bleedHit6 ? ` ${enemy.name}は出血した！` : ''}`
      break
    }
    case 'マッドラッシュ': {
      result.dmg = Math.floor(eff.atk*(rt>=1?1.9:1.8)*am)
      if (playerBuffs.berserk?.turns > 0) {
        result.log = `💢 マッドラッシュ！ ${enemy.name}に${result.dmg}の物理ダメージ！（狂乱中）`
      } else {
        result.newPlayerBuffs.berserk = { turns:3, lockedSkill:'マッドラッシュ' }
        result.log = `💢 マッドラッシュ！ ${enemy.name}に${result.dmg}の物理ダメージ！ 狂乱状態になった！`
      }
      break
    }
    case 'すてみ':      result.dmg = Math.floor(eff.atk*1.8*am); result.selfDmg = Math.floor(result.dmg*(rt>=2?0.05:0.2)); result.log = `💢 すてみ！ ${enemy.name}に${result.dmg}の物理ダメージ！ 自分も${result.selfDmg}ダメージ！`; break
    case 'ブラッティロア': result.newPlayerBuffs.atkUp={turns:4,rate:rt>=4?1.3:1.1}; result.newPlayerBuffs.bloodRage={turns:4,healRate:0.3}; result.log = `🩸 ブラッティロア！ 4ターンの間、攻撃力UP・与えたダメージを回復！`; break
    case 'フルブレイカー': {
      const edr_fb = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
      const defVal_fb = Math.floor((enemy.def||0)*edr_fb*(rt>=5?0.5:0.7)/2)
      result.dmg = Math.max(1, Math.floor(eff.atk*2.0*am) - defVal_fb)
      result.log = `💥 フルブレイカー！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    }
    case '毒矢': {
      result.dmg = Math.floor(eff.atk*1.1*am)
      const poisonHit = Math.random()*100 < (rt>=1?100:90)
      if (poisonHit) result.newEnemyBuffs.poison = { turns:4, dmgRate:0.03 }
      result.log = `🏹 毒矢！ ${enemy.name}に${result.dmg}の物理ダメージ！${poisonHit ? ' 毒状態に！' : ''}`
      break
    }
    case '三連射': {
      const tlMult = rt>=2?0.6:0.5
      const s1=Math.floor(eff.atk*tlMult*am*r()), s2=Math.floor(eff.atk*tlMult*am*r()), s3=Math.floor(eff.atk*tlMult*am*r())
      result.dmg = s1+s2+s3
      result.log = `🏹 三連射！ ${enemy.name}に${s1}の物理ダメージ！${s2}の物理ダメージ！${s3}の物理ダメージ！`; break
    }
    case '狩猟本能':    { const huntRate = rt>=4?1.5:1.3; result.newPlayerBuffs.atkUp={turns:4,rate:huntRate}; result.newPlayerBuffs.spdUp={turns:4,rate:huntRate}; result.log = `🌲 狩猟本能！ 4ターンの間、攻撃力・素早さが上昇！`; break }
    case '絶影狙撃':    result.dmg = Math.floor(eff.atk*(rt>=5?2.2:2.0)*am); result.log = `🏹 絶影狙撃！ 必中！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    case '瞬歩瞬殺': {
      result.dmg = Math.floor((eff.atk*1.0+eff.spd*0.5)*am)
      const bleedHit3 = Math.random()*100 < (rt>=1?100:50)
      if (bleedHit3) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `🌙 瞬歩瞬殺！ ${enemy.name}に${result.dmg}の物理ダメージ！${bleedHit3 ? ` ${enemy.name}は出血した！` : ''}`
      break
    }
    case '鬼影閃': {
      result.dmg = Math.floor(eff.atk*1.5*am)
      // 影歩き(回避バフ)中は別ヒットの追撃を付与（メインとは独立してダメージ判定）
      if (playerBuffs.evasion?.turns > 0) {
        result.followup = { dmg: Math.floor(eff.spd*0.3*am*(0.85+Math.random()*0.3)), label:'影歩き' }
      }
      const bleedHit4 = Math.random()*100 < (rt>=2?80:40)
      if (bleedHit4) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `🌙 鬼影閃！ ${enemy.name}に${result.dmg}の物理ダメージ！${bleedHit4 ? ` ${enemy.name}は出血した！` : ''}`
      break
    }
    case '影歩き':      { const swT = rt>=4?8:4; result.newPlayerBuffs.spdUp={turns:swT,rate:1.5}; result.newPlayerBuffs.evasion={turns:swT,rate:0.05}; result.log = `🌙 影歩き！ ${swT}ターンの間、素早さ大幅上昇・回避率UP！`; break }
    case '急所突き': {
      result.dmg = Math.floor(eff.atk*1.8*am); result.bonusCritRate=30
      let kyushoBleed = ''
      if (rt>=5) {
        const stacks = enemyBuffs.bleed?.stacks || 0
        if (stacks > 0) {
          const bonusRate = Math.min(stacks*0.2, 1.0)  // 5スタックで+100%
          // 追撃ではなく1発のダメージに集約（出血ぶんを加算）してスタック消費
          result.dmg += Math.floor(result.dmg * bonusRate)
          result.newEnemyBuffs.bleed = undefined  // 出血スタック全削除
          kyushoBleed = ` 出血${stacks}スタックを消費！`
        }
      }
      result.log = `🌙 急所突き！ ${enemy.name}に${result.dmg}の物理ダメージ！${kyushoBleed}`; break
    }
    case 'アクアショット': {
      result.dmg = Math.floor(eff.matk*(rt>=1?1.6:1.4)*am)
      const aquaSlowHit = Math.random()*100 < 50
      if (aquaSlowHit) result.newEnemyBuffs.spdDown={turns:2,rate:0.7}
      result.log = `🌊 アクアショット！ ${enemy.name}に${result.dmg}の特殊ダメージ！${aquaSlowHit ? ' 素早さ低下！' : ''}`
      break
    }
    case 'アースクエイク': {
      result.dmg = Math.floor(eff.matk*1.6*am)
      const stunResist = enemyBuffs.stunResist ?? 1.0
      // 再修練強化：元素使い(2段)でスタン確率30%
      const eqStunBoost = (skill.class_name==='元素使い' && rt>=2)
      const stunHit = Math.random()*100 < (eqStunBoost?60:30) * stunResist
      if (stunHit) {
        result.newEnemyBuffs.stun = { turns:1 }
        result.newEnemyBuffs.stunResist = stunResist * 0.5
      }
      result.log = `🌊 アースクエイク！ ${enemy.name}に${result.dmg}の特殊ダメージ！${stunHit ? ' スタン！' : ''}`
      break
    }
    case 'サンダーストライク': {
      result.dmg = Math.floor(eff.matk*(rt>=1?1.6:1.4)*am)
      result.mdefPen = 0.3  // 敵の魔法防御を30%無視
      result.log = `⚡ サンダーストライク！ ${enemy.name}の魔法防御を貫通し${result.dmg}の特殊ダメージ！`
      break
    }
    case 'ライトニングボルト': {
      result.dmg = Math.floor(eff.matk*(rt>=4?1.7:1.5)*am)
      const paralysisHit = Math.random()*100 < 30
      if (paralysisHit && !(enemyBuffs.paralysis?.turns > 0)) result.newEnemyBuffs.paralysis = { turns:5, skipRate:0.25, spdRate:0.8 }
      result.log = `⚡ ライトニングボルト！ ${enemy.name}に${result.dmg}の特殊ダメージ！${paralysisHit && !(enemyBuffs.paralysis?.turns > 0) ? ' 麻痺した！' : ''}`
      break
    }
    case 'フレイムバースト': {
      result.dmg = Math.floor(eff.matk*1.9*am)
      const fbBurnHit = Math.random()*100 < (rt>=5?100:55)
      if (fbBurnHit) result.newEnemyBuffs.burn = { turns:5, dmgRate:0.02 }
      result.log = `🔥 フレイムバースト！ ${enemy.name}に${result.dmg}の特殊ダメージ！${fbBurnHit ? ' やけど状態！' : ''}`
      break
    }
    case '骸骨召喚':    result.dmg = Math.floor(eff.matk*(rt>=1?0.8:0.7)*am); result.newPlayerBuffs.skeletonDmg={turns:2,dmg:result.dmg}; result.log = `💀 骸骨召喚！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 2ターン持続！`; break
    case 'ソウルドレイン': {
      result.dmg = Math.floor(eff.matk*(rt>=2?1.4:1.2)*am)
      result.heal = Math.min(Math.floor(result.dmg*0.2), Math.floor(profile.hp_max*0.2))
      result.log = `💀 ソウルドレイン！ ${enemy.name}に${result.dmg}の特殊ダメージ！ HPを${result.heal}回復！`; break
    }
    case '腐敗霧':      { const fhRate = rt>=4?0.6:0.7; result.newEnemyBuffs.defDown={turns:4,rate:fhRate}; result.newEnemyBuffs.mdefDown={turns:4,rate:fhRate}; result.newEnemyBuffs.severePoisoin={turns:5,dmgRate:0.05}; result.log = `💀 腐敗霧！ 4ターンの間、対象の防御力・特殊防御力低下！ 猛毒状態！`; break }
    case '幽世ノ門': {
      const curseDmgAmt = Math.floor(eff.matk*0.4*am)
      const ywT = rt>=5?5:3
      result.newEnemyBuffs.curseDmg = { turns:ywT, dmg:curseDmgAmt }
      result.newEnemyBuffs.dmgDown = { turns:ywT, rate:0.8 }
      result.newEnemyBuffs.spdDown = { turns:ywT, rate:0.8 }
      result.log = `💀 幽世ノ門！ 3ターンの間、呪縛ダメージ・与ダメ低下・素早さ低下！`; break
    }
    case 'ホーリーライト': {
      result.dmg = Math.floor(eff.matk*1.5*am)
      let hlSeal = ''
      if (rt>=1 && Math.random()*100 < 30) { result.newEnemyBuffs.healDown={turns:3,rate:0.5}; hlSeal = ' 回復阻害！' }
      result.log = `✨ ホーリーライト！ ${enemy.name}に${result.dmg}の特殊ダメージ！${hlSeal}`; break
    }
    case '奇跡':        result.newPlayerBuffs.regenHeal={turns:4,amount:Math.floor(profile.hp_max*(rt>=2?0.15:0.10)+eff.matk*0.2)}; result.log = `✨ 奇跡！ 4ターンの間、毎ターンHPが回復！`; break
    case '祈りの結界':  result.newPlayerBuffs.dmgReduce={turns:rt>=4?6:4,rate:0.7}; result.log = `✨ 祈りの結界！ ${rt>=4?6:4}ターンの間、受けるダメージ軽減！`; break
    case '神罰執行': {
      result.dmg = Math.floor(eff.matk*(rt>=5?2.0:1.8)*am)
      const healDownHit = Math.random()*100 < 50
      if (healDownHit) result.newEnemyBuffs.healDown={turns:3,rate:0.5}
      result.log = `✨ 神罰執行！ ${enemy.name}に${result.dmg}の特殊ダメージ！${healDownHit ? ' 回復封じ！' : ''}`
      break
    }
    case '粛清':        result.dmg = Math.floor((eff.matk*(rt>=1?1.4:1.3)+eff.mdef*(rt>=1?0.4:0.3))*am); result.log = `⚖ 粛清！ ${enemy.name}に${result.dmg}の特殊ダメージ！`; break
    case '狂信':        result.newPlayerBuffs.statusImmune={turns:4}; if (rt>=2) result.newPlayerBuffs.matkUp={turns:4,rate:1.3}; result.log = `⚖ 狂信！ 4ターンの間、ステータス減少を無効化！${rt>=2?' 特殊攻撃力上昇！':''}`; break
    case '聖なる裁き': {
      result.dmg = Math.floor(eff.matk*(rt>=4?1.9:1.7)*am)
      const sealHit1 = Math.random()*100 < 20
      if (sealHit1) result.newEnemyBuffs.healDown={turns:3,rate:0.0}
      result.log = `⚖ 聖なる裁き！ ${enemy.name}に${result.dmg}の特殊ダメージ！${sealHit1 ? ' 回復封じ！' : ''}` ; break
    }
    case '断罪': {
      result.dmg = Math.floor((eff.matk*1.6+eff.mdef*1.0)*am)
      const sealHit2 = Math.random()*100 < (rt>=5?60:30)
      if (sealHit2) result.newEnemyBuffs.healDown={turns:3,rate:0.0}
      result.log = `⚖ 断罪！ ${enemy.name}に${result.dmg}の特殊ダメージ！${sealHit2 ? ' 回復封じ！' : ''}`
      break
    }
    case 'マナボルト': {
      const consumed = eff.lastMpCost || 0
      result.dmg = consumed * (rt>=2?6:4)
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
    case '氷の障壁':    { const ibT = rt>=4?4:2; result.newPlayerBuffs.dmgReduce={turns:ibT,rate:0.6}; result.newPlayerBuffs.critResist={turns:ibT,value:20}; result.log = `❄ 氷の障壁！ ${ibT}ターンの間、受けるダメージ大幅軽減・クリティカル抵抗UP！`; break }
    case 'メテオストライク': {
      const rand = Math.random()*100
      // 再修練5段で2〜5発（2:30% 3:40% 4:20% 5:10%）、通常は1〜4発（1:10% 2:40% 3:40% 4:10%）
      const hits = rt>=5
        ? (rand < 30 ? 2 : rand < 70 ? 3 : rand < 90 ? 4 : 5)
        : (rand < 10 ? 1 : rand < 50 ? 2 : rand < 90 ? 3 : 4)
      let meteoBurned = false
      const hitDmgs = []
      for (let h = 0; h < hits; h++) {
        hitDmgs.push(Math.floor(eff.matk*0.7*am*r()))
        if (!meteoBurned && Math.random()*100 < 10) { meteoBurned = true; result.newEnemyBuffs.burn = { turns:5, dmgRate:0.02 } }
      }
      result.dmg = hitDmgs.reduce((a,b)=>a+b,0)
      result.log = `☄ メテオストライク！ ${enemy.name}に${hitDmgs.map(d=>`${d}の特殊ダメージ`).join('！')}！${meteoBurned ? ' やけど状態！' : ''}`
      break
    }
    // ── 格闘家 ──
    case '打撃':   result.dmg = Math.floor(eff.atk*1.2*am); result.log = `👊 打撃！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    case '連打': {
      const c1=Math.floor(eff.atk*0.4*am*r()), c2=Math.floor(eff.atk*0.4*am*r()), c3=Math.floor(eff.atk*0.4*am*r())
      result.dmg = c1+c2+c3
      result.log = `👊 連打！ ${enemy.name}に${c1}の物理ダメージ！${c2}の物理ダメージ！${c3}の物理ダメージ！`; break
    }
    case '残心':   result.newPlayerBuffs.spdUp={turns:4,rate:1.1}; result.newPlayerBuffs.hitBonus={turns:4,value:10}; result.log = `🧘 残心！ 4ターンの間、命中・素早さが上昇！`; break
    case '鉄拳': {
      const edr_k = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
      const defVal_k = Math.floor((enemy.def||0)*edr_k*0.8/2)
      result.dmg = Math.max(1, Math.floor(eff.atk*1.3*am) - defVal_k)
      result.log = `👊 鉄拳！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    }
    case '爆裂拳': {
      result.dmg = Math.floor(eff.atk*1.4*am)
      const sr_ep = enemyBuffs.stunResist ?? 1.0
      const sh_ep = Math.random()*100 < 40 * sr_ep
      if (sh_ep) { result.newEnemyBuffs.stun={turns:1}; result.newEnemyBuffs.stunResist=sr_ep*0.5 }
      result.log = `💥 爆裂拳！ ${enemy.name}に${result.dmg}の物理ダメージ！${sh_ep?' スタン！':''}`; break
    }
    // ── サイキッカー ──
    case 'サイコショット': {
      result.dmg = Math.floor((eff.atk*(rt>=1?1.3:1.2)+eff.matk*(rt>=1?0.6:0.5))*am)
      result.log = `🔮 サイコショット！ ${enemy.name}に${result.dmg}の特殊ダメージ！`; break
    }
    case 'マインドブレイク': {
      result.dmg = Math.floor((eff.atk*1.2+eff.matk*0.7)*am)
      let mbStun = ''
      if (rt>=2) {
        const sr_mb = enemyBuffs.stunResist ?? 1.0
        if (Math.random()*100 < 40 * sr_mb) { result.newEnemyBuffs.stun={turns:1}; result.newEnemyBuffs.stunResist=sr_mb*0.5; mbStun=' スタン！' }
      }
      result.log = `🔮 マインドブレイク！ ${enemy.name}に${result.dmg}の特殊ダメージ！${mbStun}`; break
    }
    case '第六感':    result.log = `🔮 第六感【パッシブ】 命中率+5%（常時自動発動）`; break
    case '精神集中': { const ssT = rt>=4?3:2; const ssR = rt>=4?1.8:1.6; result.newPlayerBuffs.atkUp={turns:ssT,rate:ssR}; result.newPlayerBuffs.matkUp={turns:ssT,rate:ssR}; result.log = `🔮 精神集中！ ${ssT}ターンの間、攻撃力・特殊攻撃力が大幅上昇！`; break }
    case 'サイコブラスト': {
      result.dmg = Math.floor((eff.atk*(rt>=5?1.8:1.7)+eff.matk*(rt>=5?1.0:0.9))*am)
      result.log = `🔮 サイコブラスト！ ${enemy.name}に${result.dmg}の特殊ダメージ！`; break
    }
    // ── 体術師 ──
    case '半月蹴り':   result.dmg = Math.floor(eff.atk*1.4*am); if (rt>=1) result.newPlayerBuffs.nextSkillBoost={rate:1.5}; result.log = `🦵 半月蹴り！ ${enemy.name}に${result.dmg}の物理ダメージ！${rt>=1?' 次の一撃を強化！':''}`; break
    case '五連殺': {
      const ds = Array.from({length:5}, ()=>Math.floor(eff.atk*0.3*am*r()))
      result.dmg = ds.reduce((a,b)=>a+b,0)
      if (rt>=2) {
        let added = 0
        for (let i=0;i<5;i++) { if (Math.random()*100 < 20) added++ }
        if (added > 0) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+added), lastTurn:0 } }
      }
      result.log = `🦵 五連殺！ ${enemy.name}に${ds.map(d=>`${d}の物理ダメージ`).join('！')}！`; break
    }
    case '闘争本能': result.log = `🔥 闘争本能【パッシブ】 HP50%以下の間、与ダメージ+10%（常時自動発動）`; break
    case '破衝掌': {
      const edr_hs = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
      const defVal_hs = Math.floor((enemy.def||0)*edr_hs*(rt>=4?0.5:0.7)/2)
      result.dmg = Math.max(1, Math.floor(eff.atk*1.7*am) - defVal_hs)
      result.log = `🦵 破衝掌！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    }
    case '飛天三角蹴り': {
      const htMiss = rt>=5 ? 0 : 0.05  // 再修練5段でスキル内ミス撤廃（通常回避は別途）
      const htAdd = rt>=5 ? 0.1 : 0     // 再修練5段で各ヒットの倍率+0.1
      if (Math.random() < htMiss) { result.dmg=0; result.log=`🦵 飛天三角蹴り！ 1撃目が外れた！`; break }
      const h1 = Math.floor(eff.atk*(0.5+htAdd)*am*r())
      if (Math.random() < htMiss) { result.dmg=h1; result.log=`🦵 飛天三角蹴り！ ${h1}の物理ダメージ！ 2撃目が外れた！`; break }
      const h2 = Math.floor(eff.atk*(0.8+htAdd)*am*r())
      if (Math.random() < htMiss) { result.dmg=h1+h2; result.log=`🦵 飛天三角蹴り！ ${h1}の物理ダメージ！${h2}の物理ダメージ！ 3撃目が外れた！`; break }
      const h3 = Math.floor(eff.atk*(1.2+htAdd)*am*r())
      result.dmg = h1+h2+h3; result.log=`🦵 飛天三角蹴り！ ${h1}の物理ダメージ！${h2}の物理ダメージ！${h3}の物理ダメージ！`; break
    }
    // ── 魔銃士 ──
    case '魔弾': {
      const mdMult = (rt>=1?0.8:0.7)+0.2
      result.dmg = Math.floor((eff.atk*mdMult+eff.matk*mdMult)*am)
      result.log = `🔫 魔弾！ ${enemy.name}に${result.dmg}の特殊ダメージ！`; break
    }
    case '連装銃撃': {
      const gs = Array.from({length:4}, ()=>Math.floor((eff.atk*0.25+eff.matk*0.25)*am*r()))
      result.dmg = gs.reduce((a,b)=>a+b,0)
      result.log = `🔫 連装銃撃！ ${enemy.name}に${gs.map(d=>`${d}の特殊ダメージ`).join('！')}！`; break
    }
    case '精密照準':   result.log = `🔫 精密照準【パッシブ】 命中率+5%（常時自動発動）`; break
    case '強化装填':   { const klT = rt>=4?5:3; result.newPlayerBuffs.atkUp={turns:klT,rate:1.5}; result.newPlayerBuffs.matkUp={turns:klT,rate:1.5}; result.log = `🔫 強化装填！ ${klT}ターンの間、攻撃力・特殊攻撃力が大幅上昇！`; break }
    case 'キャノネスチュームビンド': {
      let cannonStack
      if (rt>=5) {
        // 連続使用で×1.3が最大2重複
        cannonStack = prevSkill === 'キャノネスチュームビンド' ? Math.min((playerBuffs.cannonCombo?.count||0)+1, 2) : 0
        result.newPlayerBuffs.cannonCombo = { count: cannonStack }
      } else {
        cannonStack = prevSkill === 'キャノネスチュームビンド' ? 1 : 0
      }
      const cannonMult = Math.pow(1.3, cannonStack)
      result.dmg = Math.floor((eff.atk*1.2+eff.matk*1.2)*am*cannonMult)
      result.log = `🔫 キャノネスチュームビンド！ ${enemy.name}に${result.dmg}の特殊ダメージ！${cannonMult>1.0?` 連続使用で威力上昇（×${cannonMult.toFixed(2)}）！`:''}`; break
    }
    // ── ギャンブラー ──
    case 'ジャグリング': {
      const jugN = rt>=1?4:3
      const jugC = 0.2 + 0.2/jugN  // 技全体で+ATK0.2/+MATK0.2（各ヒットに均等配分）
      const jugHits = Array.from({length:jugN}, ()=>Math.floor((eff.atk*jugC+eff.matk*jugC)*am*r()))
      result.dmg = jugHits.reduce((a,b)=>a+b,0)
      result.log = `🎭 ジャグリング！ ${enemy.name}に${jugHits.join('、')}の混合ダメージ！`; break
    }
    case 'ラッキーダイス': {
      const statVal = Math.max(eff.atk, eff.matk)
      const roll = (rt>=2?0.9:0.7) + Math.random() * 1.3
      result.dmg = Math.floor(statVal * roll * am)
      result.log = `🎲 ラッキーダイス！ ${enemy.name}に${result.dmg}のダメージ！（${roll.toFixed(2)}倍）`; break
    }
    case 'ギャンブルボディ': result.log = `🎭 ギャンブルボディ【パッシブ】 被ダメージがランダムに変動（常時自動発動）`; break
    case 'オールイン': {
      if (playerBuffs.allinDebuff?.turns > 0) { result.log = `💸 オールイン！ 反動中のため使用できない！`; break }
      const aiT = rt>=4?6:4
      result.newPlayerBuffs.atkUp = { turns:aiT, rate:1.5 }
      result.newPlayerBuffs.matkUp = { turns:aiT, rate:1.5 }
      result.newPlayerBuffs.spdUp = { turns:aiT, rate:1.5 }
      result.newPlayerBuffs.dmgReduce = { turns:aiT, rate:0.67 }
      result.newPlayerBuffs.allinActive = { turns:aiT, reactTurns:aiT }
      result.log = `💸 オールイン！ ${aiT}ターンの間、全ステータスが大幅上昇！`; break
    }
    case 'ジャックポット': {
      result.dmg = Math.floor((eff.atk*1.2 + eff.matk*1.2) * am)
      const jackpot = Math.random()*100 < (rt>=5?10:5)
      if (jackpot) result.dmg *= 2
      result.log = `🎰 ジャックポット！ ${enemy.name}に${result.dmg}のダメージ！${jackpot ? ' 💥 JACKPOT！ ダメージ2倍！！' : ''}`; break
    }
    // ── 魔法剣士 ──
    case '雷光斬': {
      result.dmg = Math.floor((eff.atk*(rt>=1?1.3:1.2) + eff.matk*(rt>=1?0.6:0.5))*am)
      const raiHit = Math.random()*100 < 30
      if (raiHit && !(enemyBuffs.paralysis?.turns > 0)) result.newEnemyBuffs.paralysis = { turns:3, skipRate:0.25, spdRate:0.8 }
      result.log = `⚡⚔ 雷光斬！ ${enemy.name}に${result.dmg}のダメージ！${raiHit && !(enemyBuffs.paralysis?.turns > 0) ? ' 麻痺した！' : ''}`
      break
    }
    case '閃光': {
      const flashMax = rt>=2?4:3
      const flashStep = rt>=2?1.2:1.15
      const flashCount = prevSkill === '閃光' ? Math.min((playerBuffs.flashCombo?.count||0)+1, flashMax) : 0
      const flashMult = flashCount > 0 ? Math.pow(flashStep, flashCount) : 1.0
      result.dmg = Math.floor((eff.atk*0.8 + eff.matk*0.8)*am*flashMult)
      result.newPlayerBuffs.flashCombo = { count: flashCount > 0 ? flashCount : 1 }
      const comboText = flashCount > 0 ? ` 連続${flashCount+1}回（×${flashMult.toFixed(2)}）！` : ''
      result.log = `✨⚔ 閃光！ ${enemy.name}に${result.dmg}のダメージ！${comboText}`
      break
    }
    case '魔導剣術': result.log = `⚔ 魔導剣術【パッシブ】 特殊攻撃力の30%を攻撃力に変換（常時発動）`; break
    case '魔剣開放': {
      if (playerBuffs.spellBladeSealed?.turns > 0) {
        result.log = `⚔ 魔剣開放！ バフ不可状態のため発動できない！`; break
      }
      result.newPlayerBuffs.atkUp  = { turns:4, rate:2.0 }
      result.newPlayerBuffs.matkUp = { turns:4, rate:2.0 }
      const sealAfter = rt>=4?2:4
      result.newPlayerBuffs.spellBladeExhaust = { turns:4, sealTurns:sealAfter }
      result.log = `⚔💥 魔剣開放！ 4ターンの間、攻撃力・特殊攻撃力が2倍！ その後${sealAfter}ターンバフ不可状態！`
      break
    }
    case 'エレメンタルエッジ': {
      result.dmg = Math.floor((eff.atk*(rt>=5?1.7:1.5) + eff.matk*0.8)*am)
      const elemHit = Math.random()*100 < 36
      if (elemHit) {
        // やけど・麻痺・スタンを均等抽選（スタン2倍化：発動率36%×1/3で各12%）
        const elemRoll = Math.random()*100
        let statusName = ''
        if (elemRoll < 33.34) {
          result.newEnemyBuffs.burn = { turns:5, dmgRate:0.02 }; statusName = 'やけど'
        } else if (elemRoll < 66.67) {
          if (!(enemyBuffs.paralysis?.turns > 0)) result.newEnemyBuffs.paralysis = { turns:3, skipRate:0.25, spdRate:0.8 }
          statusName = '麻痺'
        } else {
          const sr = enemyBuffs.stunResist??1.0; result.newEnemyBuffs.stun={turns:1}; result.newEnemyBuffs.stunResist=sr*0.5; statusName='スタン'
        }
        result.log = `⚔✨ エレメンタルエッジ！ ${enemy.name}に${result.dmg}のダメージ！ ${statusName}状態！`
      } else {
        result.log = `⚔✨ エレメンタルエッジ！ ${enemy.name}に${result.dmg}のダメージ！`
      }
      break
    }
    // ── 聖騎士 ──
    case 'ホーリーエッジ': {
      result.dmg = Math.floor((eff.atk*(rt>=1?1.6:1.5) + eff.matk*(rt>=1?0.6:0.5))*am)
      result.log = `✨⚔ ホーリーエッジ！ ${enemy.name}に${result.dmg}のダメージ！`; break
    }
    case 'ディバインスマイト': {
      result.dmg = Math.floor((eff.atk*1.2 + eff.matk*0.7)*am)
      const dmgDownHit = Math.random()*100 < (rt>=2?50:30)
      if (dmgDownHit) result.newEnemyBuffs.dmgDown = { turns:3, rate:0.85 }
      result.log = `✨⚔ ディバインスマイト！ ${enemy.name}に${result.dmg}のダメージ！${dmgDownHit ? ' 3Tの間、相手の与ダメ-15%！' : ''}`
      break
    }
    case '聖騎士の心得': result.log = `🛡 聖騎士の心得【パッシブ】 防御力・特殊防御力が1.2倍（常時発動）`; break
    case '聖域展開': {
      const seikiHeal = rt>=4?0.10:0.05
      result.newPlayerBuffs.regenHeal = { turns:4, amount:Math.floor(profile.hp_max*seikiHeal) }
      result.newPlayerBuffs.holyField = { turns:4, rate:1.5 }
      result.log = `✨ 聖域展開！ 4ターンの間、毎ターン最大HP${Math.round(seikiHeal*100)}%回復・防御力と特殊防御力1.5倍！`; break
    }
    case '神聖覚醒': {
      result.newPlayerBuffs.holyAwakening = { turns:5, defMult:rt>=5?0.6:0.4 }
      result.log = `✨ 神聖覚醒！ 5ターンの間、攻撃ごとに防御力・特殊防御力に基づく追撃を与える！`; break
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
export const executeEnemySkill = (skill, enemy, enemyHp, enemyMaxHp, playerHp, profileHpMax, playerBuffs, enemyBuffs, logs, eff) => {
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
      if (skill.paralysisRate && Math.random() < skill.paralysisRate && !(newPlayerBuffs.paralysis?.turns > 0)) {
        newPlayerBuffs.paralysis = { turns:5, skipRate:0.25, spdRate:0.8 }
        logs.push({ text:`⚡ 麻痺した！`, color:'#ffaa00' })
      }
      if (skill.burnRate && Math.random() < skill.burnRate && !(newPlayerBuffs.burn?.turns > 0)) {
        newPlayerBuffs.burn = { turns:3 }
        logs.push({ text:`🔥 やけど状態になった！`, color:'#ff6622' })
      }
      if (skill.burn && !(newPlayerBuffs.burn?.turns > 0)) {
        newPlayerBuffs.burn = { turns:3 }
        logs.push({ text:`🔥 やけど状態になった！`, color:'#ff6622' })
      }
      if (skill.defDownRate) {
        newPlayerBuffs.defDown = { turns: skill.turns||3, rate: skill.defDownRate }
        logs.push({ text:`🛡 防御力が低下した！`, color:'#ff8844' })
      }
      if (skill.healSealTurns) {
        newPlayerBuffs.healSeal = { turns: skill.healSealTurns }
        logs.push({ text:`🚫 ${skill.healSealTurns}ターンの間回復が封じられた！`, color:'#ff4488' })
      }
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
      if (skill.stunRate && Math.random() < skill.stunRate && !(newPlayerBuffs.stun?.turns > 0)) {
        newPlayerBuffs.stun = { turns:1 }
        logs.push({ text:`💫 スタン！ 次のターン行動不能！`, color:'#ffaa00' })
      }
      if (skill.stun) {
        newPlayerBuffs.stun = { turns:1 }
        logs.push({ text:`💫 スタン！ 次のターン行動不能！`, color:'#ffaa00' })
      }
      break
    }
    case 'magical_multi': {
      const pMdef2 = Math.max(1, (eff?.mdef || 0) * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1))
      const eMatk2 = enemy.matk || enemy.atk
      const base2 = Math.floor(eMatk2 * eMatk2 / Math.max(1, eMatk2 + pMdef2))
      const perHit2 = Math.max(1, Math.floor(base2 * skill.mult))
      const dmgReduceRate2 = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const defRankRed2 = calcDefReduction(eff?.mdef || 0)
      dmgToPlayer = Math.floor(perHit2 * (skill.hits||1) * enemyDmgDown * dmgReduceRate2 * (1 - defRankRed2) * (0.9 + Math.random() * 0.2))
      logs.push({ text:`✨ ${enemy.name}の「${skill.name}」！ ${perHit2}×${skill.hits}回＝${dmgToPlayer}の魔法ダメージ！`, color:'#cc44ff' })
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
      if (skill.regenRate && skill.regenTurns) {
        newEnemyBuffs.regen = { turns: skill.regenTurns, rate: skill.regenRate }
        logs.push({ text:`✨ ${skill.regenTurns}ターンの間毎ターンHP${Math.floor(skill.regenRate*100)}%回復！`, color:'#44ff88' })
      }
      if (skill.dmgReduceRate && skill.dmgReduceTurns) {
        newEnemyBuffs.dmgReduce = { turns: skill.dmgReduceTurns, rate: skill.dmgReduceRate }
        logs.push({ text:`🛡 ${skill.dmgReduceTurns}ターンの間ダメージを軽減！`, color:'#ffaa00' })
      }
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

// デイリーダンジョンの「日付」文字列：朝5時(JST)を境にリセット
// JST(+9h)から5h引いた基準で日付を算出 → JST05:00でロールオーバー
const getDungeonDateStr = () => new Date(Date.now() + (9 - 5)*60*60*1000).toISOString().slice(0, 10)

// デイリーダンジョン：種類ごとに1日5回。type→DB列名／表示名／一覧
const DUNGEON_DAILY_LIMIT = 5
const DUNGEON_TYPE_COL = { exp:'cnt_exp', gold:'cnt_gold', stone:'cnt_stone', prof:'cnt_prof', gem:'cnt_gem' }
const DUNGEON_TYPE_LABEL = { exp:'経験値', gold:'ゴールド', stone:'強化石', prof:'熟練度', gem:'宝石' }
const DUNGEON_LIST = [
  { type:'exp',   label:'経験値ダンジョン' },
  { type:'gold',  label:'ゴールドダンジョン' },
  { type:'stone', label:'強化石ダンジョン' },
  { type:'prof',  label:'熟練度ダンジョン' },
  { type:'gem',   label:'宝石ダンジョン' },
]

// お知らせのカテゴリ別タブ（DBの announcements.category と対応）
const ANNOUNCE_TABS = [
  { key:'update', label:'アップデート', icon:'🆕' },
  { key:'bug',    label:'不具合',       icon:'🛠' },
  { key:'event',  label:'イベント',     icon:'🎉' },
  { key:'past',   label:'過去',         icon:'🗂' },
]
// カテゴリ正規化：未設定や未知カテゴリ（旧 'notice' 含む）は先頭タブに寄せて非表示化を防ぐ
const annCat = (a) => (ANNOUNCE_TABS.some(t => t.key === a.category) ? a.category : ANNOUNCE_TABS[0].key)

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
  const [currentEnemy, setCurrentEnemy] = useState(null)
  const [botCheck, setBotCheck] = useState(null)  // BOT確認チャレンジ {top,left} or null
  const [loading, setLoading] = useState(false)
  const [pendingPoints, setPendingPoints] = useState(0)
  const [statPoints, setStatPoints] = useState({})
  const [showStatPanel, setShowStatPanel] = useState(false)
  // ステータス欄・施設ボタン欄の展開/折りたたみ（localStorageに保存しページ遷移後も維持）
  const [statExpanded, setStatExpanded] = useState(() => localStorage.getItem('statExpanded') !== '0')
  const [facilitiesExpanded, setFacilitiesExpanded] = useState(() => localStorage.getItem('facilitiesExpanded') !== '0')
  const toggleStatExpanded = () => setStatExpanded(v => { localStorage.setItem('statExpanded', v ? '0' : '1'); return !v })
  const toggleFacilitiesExpanded = () => setFacilitiesExpanded(v => { localStorage.setItem('facilitiesExpanded', v ? '0' : '1'); return !v })
  const [selectedArea, setSelectedArea] = useState(() => Number(localStorage.getItem('selectedArea') || 1))
  const [regenRemaining, setRegenRemaining] = useState(0)
  const [innMessage, setInnMessage] = useState('')
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [classLevels, setClassLevels] = useState([])
  const [templeMessage, setTempleMessage] = useState('')
  const [hasGamblerProof, setHasGamblerProof] = useState(false)
  const [skillSets, setSkillSets] = useState([])          // 出撃(sortie)セット
  const [papiaSkillSets, setPapiaSkillSets] = useState([]) // パピア限定セット（空なら出撃にフォールバック）
  const [playerItem, setPlayerItem] = useState(null)
  const [abilityTitle, setAbilityTitle] = useState(null)
  const [expDungeonTicket, setExpDungeonTicket] = useState(null)  // { id, quantity }
  // 種類ごとの当日選択回数。読み込み完了まではlimit(=disabled)で初期化
  const [dungeonCounts, setDungeonCounts] = useState({ exp:DUNGEON_DAILY_LIMIT, gold:DUNGEON_DAILY_LIMIT, stone:DUNGEON_DAILY_LIMIT, prof:DUNGEON_DAILY_LIMIT, gem:DUNGEON_DAILY_LIMIT })
  const [showDungeonPanel, setShowDungeonPanel] = useState(false)
  const [showChallengePanel, setShowChallengePanel] = useState(false)
  const challengePanelRef = useRef(null)
  // 挑戦パネルを開いたら、その位置まで自動スクロール（スマホで画面外に出るのを防ぐ）
  useEffect(() => {
    if (showChallengePanel) {
      requestAnimationFrame(() => challengePanelRef.current?.scrollIntoView({ behavior:'smooth', block:'center' }))
    }
  }, [showChallengePanel])
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [showMenu, setShowMenu] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [contactForm, setContactForm] = useState({ category: 'bug', body: '' })
  const [contactSent, setContactSent] = useState(false)
  const [contactLoading, setContactLoading] = useState(false)
  const [showAnnouncements, setShowAnnouncements] = useState(false)
  const [announceTab, setAnnounceTab] = useState('update')   // お知らせモーダルの選択中タブ
  const [announcements, setAnnouncements] = useState([])
  const [claimableTitles, setClaimableTitles] = useState(0)  // 獲得可能な称号数（街のバナー表示用）
  const [showGuide, setShowGuide] = useState(false)
  const [openGuideId, setOpenGuideId] = useState(null)
  const [openAnnouncementId, setOpenAnnouncementId] = useState(null)
  const [pendingClassChange, setPendingClassChange] = useState(null)
  const [hasNewAnnouncements, setHasNewAnnouncements] = useState(false)
  const [retrainingModal, setRetrainingModal] = useState(false)
  const [raidStatus, setRaidStatus] = useState(null) // null | 'active' | 'pre' | 'defeated' | 'expired'
  const [raidPreCountdown, setRaidPreCountdown] = useState('')
  const [raidBossData, setRaidBossData] = useState(null) // { boss, participants }
  const [selectedCarrySkill, setSelectedCarrySkill] = useState(null)
  const [retrainingSkills, setRetrainingSkills] = useState([])
  const [retrainingClass, setRetrainingClass] = useState(null)
  const [retrainingMessage, setRetrainingMessage] = useState('')
  const [newAnnouncementPopup, setNewAnnouncementPopup] = useState(false)
  const [seenAnnouncementIds, setSeenAnnouncementIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bf_seenAnnouncements') || '[]') } catch { return [] }
  })
  const battleCountTrackerRef = useRef({ start: null, count: 0 })
  const sortieTimesRef = useRef([])  // オートクリッカー検知：出撃時刻の履歴
  const botCheckTimerRef = useRef(null)  // BOT確認チャレンジのタイマー
  const botCheckActiveRef = useRef(false)  // チャレンジ中フラグ
  const botCheckDeadlineRef = useRef(null)  // タイマー一時停止用：期限の絶対時刻
  const regenningRef = useRef(false)
  const innBusyRef = useRef(false)  // 宿屋利用の二重実行ガード（連打対策）
  const [canLeaveBattle, setCanLeaveBattle] = useState(true)  // 出撃後2秒は「街に戻る」を押せない（オートクリッカー連打対策）
  const leaveTimerRef = useRef(null)

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

  // レイドボス出現前カウントダウン（preステータス中、1秒ごと更新）
  useEffect(() => {
    if (raidStatus !== 'pre') { setRaidPreCountdown(''); return }
    const update = () => {
      const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
      const spawn = new Date(jstNow)
      spawn.setHours(21, 0, 0, 0)
      const diff = Math.max(0, spawn - jstNow)
      const m = Math.floor(diff / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setRaidPreCountdown(`${m}:${String(s).padStart(2,'0')}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [raidStatus])

  // レイドボス状態チェック（60秒ごと）
  useEffect(() => {
    const checkRaid = async () => {
      const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
      const h = jstNow.getHours(), m = jstNow.getMinutes()
      const { data } = await supabase.rpc('spawn_raid_boss_if_needed')
      const status = data?.status
      if (status === 'active' || status === 'defeated' || status === 'expired') {
        setRaidStatus(status)
        if (data?.id) {
          const { data: parts } = await supabase
            .from('raid_participants')
            .select('player_id, damage_dealt, attack_count, reward_claimed, profiles(username)')
            .eq('raid_id', data.id)
            .order('damage_dealt', { ascending: false })
            .limit(5)
          setRaidBossData({ boss: data, participants: parts || [] })
        }
      } else if (h === 20 && m >= 30) {
        setRaidStatus('pre'); setRaidBossData(null)
      } else {
        setRaidStatus(null); setRaidBossData(null)
      }
    }
    checkRaid()
    const id = setInterval(checkRaid, 30000) // 30秒ごと（21時スポーン検知を早める）
    return () => clearInterval(id)
  }, [])

  // 獲得可能な称号があれば街にバナーを表示
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setClaimableTitles(await countClaimableTitles(user.id))
    })()
  }, [])

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const [{ data }, { data: cl }, { data: gpCheck }, { data: ticketRow }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('class_levels').select('*').eq('player_id', user.id),
      supabase.from('player_items').select('id, items!inner(effect)').eq('player_id', user.id).eq('items.effect', 'gambler_proof').maybeSingle(),
      supabase.from('player_items').select('id, quantity, items!inner(effect)').eq('player_id', user.id).eq('items.effect', 'exp_dungeon_ticket').maybeSingle(),
    ])
    setExpDungeonTicket(ticketRow ? { id: ticketRow.id, quantity: ticketRow.quantity } : null)
    if (!data) { nav('/create'); return }
    if (Array.isArray(cl)) setClassLevels(cl)
    setHasGamblerProof(!!gpCheck)
    // クラス成長分を毎回再計算してステータスを上書き（JOB_GROWTH変更が全員に反映される）
    // 全クラスのレベルアップ分を合算する（転職で積み上げたステータスも反映）
    const _base = getBaseClassStats(data.class)
    const _statKeys = ['hp_max','mp_max','atk','def','matk','mdef','spd']
    const _allClassBonus = Object.fromEntries(_statKeys.map(k => [k, 0]))
    for (const clRow of (Array.isArray(cl) ? cl : [])) {
      const b = calcLvBonus(clRow.class_name, clRow.lv)
      const isCurrentClass = clRow.class_name === data.class
      const isInitialClass = INITIAL_CLASSES.includes(clRow.class_name)
      const retrainCount = (data.retraining || {})[clRow.class_name] || 0
      // 現在クラス: 100% + 再修練★×10%（そのクラスでプレイ中のみ成長分が増加）
      // 非現在・通常クラス: 50% + 再修練★×10%（最大100%）
      // 非現在・初期クラス: 50% + 再修練★×30%（キャップなし。初期クラスの再修練価値を強化）
      const rate = isCurrentClass
        ? (1.0 + retrainCount * 0.1)
        : isInitialClass
          ? (0.5 + retrainCount * 0.3)
          : Math.min(1.0, 0.5 + retrainCount * 0.1)
      for (const k of _statKeys) _allClassBonus[k] += Math.floor((b[k] || 0) * rate)
    }
    // キャラクターボーナス: 全クラス合計のレベルアップ数に応じて 1LVごとにHP+1・5LVごとにMP+1
    const _totalLvUps = (Array.isArray(cl) ? cl : []).reduce((s, r) => s + Math.max(0, (r.lv || 1) - 1), 0)
    _allClassBonus.hp_max += _totalLvUps
    _allClassBonus.mp_max += Math.floor(_totalLvUps / 5)
    const _spent = data.stat_point_spent || {}
    const _computed = {
      hp_max: _base.hp_max + _allClassBonus.hp_max + (_spent.hp  ||0)*10,
      mp_max: _base.mp_max + _allClassBonus.mp_max + (_spent.mp  ||0)*5,
      atk:    _base.atk   + _allClassBonus.atk    + (_spent.atk ||0),
      def:    _base.def   + _allClassBonus.def    + (_spent.def  ||0),
      matk:   _base.matk  + _allClassBonus.matk   + (_spent.matk||0),
      mdef:   _base.mdef  + _allClassBonus.mdef   + (_spent.mdef||0),
      spd:    _base.spd   + _allClassBonus.spd    + (_spent.spd  ||0),
    }
    // exp_nextも現在のLVから再計算して同期
    _computed.exp_next = calcExpNext(data.lv)
    // DBにも書き戻す（Profile・Rankingページが正しい値を読めるようにする）
    const _needsUpdate = [..._statKeys, 'exp_next'].some(k => data[k] !== _computed[k])
    if (_needsUpdate) {
      await supabase.from('profiles').update(_computed).eq('id', user.id)
    }
    // ログイン時にセッションをまたいだ連続出撃カウントをリセット
    await supabase.from('profiles').update({ consecutive_battle_count: 0 }).eq('id', user.id)
    // 選択中ペットの装備チャーム効果をプレイヤー本体へ反映（未導入時は無視）
    let petCharm = null
    try {
      const { data: ap } = await supabase.from('pets').select('charm_id').eq('owner_id', user.id).eq('is_active', true).maybeSingle()
      if (ap?.charm_id) {
        const { data: c } = await supabase.from('player_charms').select('*').eq('id', ap.charm_id).maybeSingle()
        if (c) petCharm = charmPlayerBonus(c)
      }
    } catch { /* チャーム未導入時は無視 */ }
    setProfile({ ...data, ..._computed, petCharm, consecutive_battle_count: 0 })
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
    const { data: ss } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', user.id).order('slot_order')
    if (Array.isArray(ss)) {
      const sortie = ss.filter(r => (r.set_type || 'sortie') === 'sortie')
      const papia  = ss.filter(r => r.set_type === 'papia')
      setSkillSets(sortie)
      // パピアセットにアクティブスキルが1つも無ければ出撃を流用（パッシブのみだと全部通常攻撃になるため）
      const papiaHasActive = papia.some(r => r.skills?.type !== 'パッシブ')
      setPapiaSkillSets(papiaHasActive ? papia : sortie)
    }
    const { data: pi } = await supabase.from('player_items').select('*, items(*)').eq('player_id', user.id).eq('equipped', true).single()
    setPlayerItem(pi || null)
    if (data?.ability_title_id) {
      const { data: at } = await supabase.from('titles').select('*').eq('id', data.ability_title_id).single()
      setAbilityTitle(at || null)
    } else {
      setAbilityTitle(null)
    }
    const today = getDungeonDateStr()
    try {
      const { data: da } = await supabase.from('dungeon_attempts').select('cnt_exp,cnt_gold,cnt_stone,cnt_prof,cnt_gem').eq('player_id', user.id).eq('date', today).maybeSingle()
      setDungeonCounts({ exp:da?.cnt_exp||0, gold:da?.cnt_gold||0, stone:da?.cnt_stone||0, prof:da?.cnt_prof||0, gem:da?.cnt_gem||0 })
    } catch { setDungeonCounts({ exp:0, gold:0, stone:0, prof:0, gem:0 }) }
  }

  const doRegen = async () => {
    if (!profile) return
    if (regenningRef.current) return  // 多重起動ガード
    if (innBusyRef.current) return    // 宿屋利用中は回復処理と競合させない（宿屋の全回復が上書きされるのを防ぐ）
    regenningRef.current = true
    try {
      // ★ サーバーから最新のHP/MP/瀕死/前回回復時刻を取得（古いクロージャで上書きしないため）
      const { data: sp } = await supabase.from('profiles')
        .select('hp_current, mp_current, hp_max, mp_max, is_dying, last_regen_at')
        .eq('id', profile.id).single()
      if (!sp) return
      // サーバー時刻基準で回復間隔をまだ満たしていなければ何もしない（宿屋直後の二重発火対策）
      const serverElapsed = (Date.now() - new Date(sp.last_regen_at).getTime())/1000
      if (serverElapsed < REGEN_SECONDS) { await fetchProfile(); return }
      const current = sp.hp_current ?? sp.hp_max
      const newHp = Math.min(sp.hp_max, Math.floor(current+sp.hp_max*0.2))
      const newMp = Math.min(sp.mp_max, Math.floor((sp.mp_current??sp.mp_max)+sp.mp_max*0.2))
      const newIsDying = newHp >= sp.hp_max ? false : sp.is_dying
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
    const { data, error } = await supabase.rpc('switch_class', { p_target_class: targetClass })
    if (error || !data?.ok) {
      await fetchProfile()
      setTempleMessage('転職に失敗しました'); setLoading(false); return
    }
    // 転職時：新クラスで使えなくなるスキルだけセットから外す
    // （共通スキル・再修練の持ち越しスキル・新クラスのスキルはセットに残す）
    const { data: setsNow } = await supabase.from('skill_sets').select('skill_id, skills(class_name)').eq('player_id', profile.id)
    const { data: carried } = await supabase.from('player_skills').select('skill_id').eq('player_id', profile.id).eq('is_carried_over', true)
    const carriedIds = new Set((carried || []).map(c => c.skill_id))
    const removeSkillIds = [...new Set((setsNow || []).filter(s => {
      const cls = s.skills?.class_name
      const usable = cls === targetClass || cls === '共通' || carriedIds.has(s.skill_id)
      return !usable
    }).map(s => s.skill_id))]
    if (removeSkillIds.length) {
      await supabase.from('skill_sets').delete().eq('player_id', profile.id).in('skill_id', removeSkillIds)
    }
    await fetchProfile()
    setTempleMessage(`${targetClass}に転職しました！（使えなくなったスキルのみセットから外れました）`)
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

    // レベルリセット（char_lvはそのまま維持）、ステータスはfetchProfile時に自動再計算される
    const { data, error } = await supabase.rpc('retrain_class', { p_target_class: targetClass })
    if (error || !data?.ok) {
      await fetchProfile()
      setRetrainingMessage('再修練に失敗しました'); setLoading(false); return
    }

    if (selectedCarrySkill) {
      await supabase.from('player_skills').update({ is_carried_over: true })
        .eq('player_id', profile.id).eq('skill_id', selectedCarrySkill)
    }
    await fetchProfile()
    setRetrainingModal(false)
    setSelectedCarrySkill(null)
    setRetrainingClass(null)
    const stars = '★'.repeat(currentCount + 1)
    setRetrainingMessage(`再修練完了！ ${targetClass}${stars} LV1にリセット！`)
    setLoading(false)
  }

  const useExpDungeonTicket = async () => {
    if (loading || !expDungeonTicket) return
    setLoading(true)
    const { data, error } = await supabase.rpc('use_exp_dungeon_ticket', { p_player_id: profile.id })
    if (error || !data?.ok) {
      setBattleLogs([{ text:`📜 ${data?.error || '使用できませんでした'}`, color:'#ff8844' }])
      setScene('battle')
      setLoading(false)
      return
    }
    // 残り枚数をstateに反映
    const remaining = data.remaining_tickets
    if (remaining <= 0) setExpDungeonTicket(null)
    else setExpDungeonTicket(prev => ({ ...prev, quantity: remaining }))
    // ダンジョン回数を更新
    setDungeonCounts(prev => ({ ...prev, exp: Math.max(0, prev.exp - 1) }))
    setBattleLogs([{ text:'📜 経験値ダンジョン使用回数券を使用！ 挑戦回数が1回回復した！', color:'#cc44ff' }])
    setScene('battle')
    setLoading(false)
  }

  const doDungeon = async (type) => {
    if (loading) return
    setLoading(true)

    // stateではなくDBから直接カウント取得（state操作による回避を防ぐ）
    const today = getDungeonDateStr()
    const col = DUNGEON_TYPE_COL[type]
    let dungeonRow = null
    try {
      const { data: da } = await supabase.from('dungeon_attempts').select('*').eq('player_id', profile.id).eq('date', today).maybeSingle()
      dungeonRow = da
    } catch {}
    const typeCount = dungeonRow?.[col] || 0
    // 当日分(5回)使い切った後の選択＝6回目以上＝グリッチとみなし即停止
    if (typeCount >= DUNGEON_DAILY_LIMIT) {
      await suspendAccount(`デイリーダンジョン(${DUNGEON_TYPE_LABEL[type]})を1日${DUNGEON_DAILY_LIMIT+1}回以上選択`)
      setLoading(false)
      return
    }

    // 出撃と共通の10秒クールダウン＋釣り中チェック（サーバー側）
    const { data: latestForDungeon } = await supabase.from('profiles').select('last_action_at, is_fishing').eq('id', profile.id).single()
    const dungeonElapsed = (Date.now() - new Date(latestForDungeon.last_action_at).getTime()) / 1000
    if (dungeonElapsed < WAIT_SECONDS) {
      // クールダウン中は無言で止めず、残り秒数を表示して「進行しない」ように見えるのを防ぐ
      const wait = Math.max(1, Math.ceil(WAIT_SECONDS - dungeonElapsed))
      setBattleLogs([{ text:`⏳ クールダウン中です。あと${wait}秒お待ちください。`, color:'#ffcc44' }])
      setScene('battle'); setLoading(false); return
    }
    if (latestForDungeon.is_fishing) {
      setBattleLogs([{ text:'🎣 釣り中はデイリーダンジョンに入れません。先に釣りを終了してください。', color:'#ff8844' }])
      setScene('battle'); setLoading(false); return
    }

    setScene('battle'); setBattleLogs([])

    const DUNGEON_ENEMIES = {
      exp:   { name:'かもすけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      gold:  { name:'かねすけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      stone: { name:'いしすけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      prof:  { name:'かかし',   hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      gem:   { name:'たますけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
    }
    const dungeonEnemy = DUNGEON_ENEMIES[type]
    const logs = []
    logs.push({ text:`✨ デイリーダンジョン: ${dungeonEnemy.name}が現れた！`, color:'#cc44ff' })

    const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
    const dmg = Math.max(1, Math.floor(eff.atk * (0.9 + Math.random() * 0.2)))
    logs.push({ text:`1ターン目: あなたの攻撃！ ${dungeonEnemy.name}に${dmg}ダメージ！`, color:'#ffcc00' })
    logs.push({ text:`${dungeonEnemy.name}を倒した！`, color:'#44ff88' })

    const newCount = typeCount + 1

    // EXP以外のダンジョン（gold/stone/prof/gem）に付与するおまけ経験値（8〜11）。
    // 表示ログを積み、RPCへ渡す値を返す（適用・レベルアップはサーバー側 apply_dungeon_reward が実施）。
    const grantBonusExpLogs = () => {
      const bonusExp = Math.floor(8 + Math.random() * 4)  // 8〜11
      const curClassLv = classLevels.find(cl => cl.class_name === profile.class)?.lv || profile.lv
      const cap = getEffectiveCap(profile.class, profile.retraining)
      if (expIsFrozen(profile)) {
        logs.push({ text:`EXP +${bonusExp}（調査中につき停止）`, color:'#446688' })
        return bonusExp
      }
      if (curClassLv >= cap) {
        logs.push({ text:`⚠ レベルキャップに達しています（EXP +0）`, color:'#ff8844' })
        return 0
      }
      let dispExp = profile.exp + bonusExp, dispLv = profile.lv, dispExpNext = profile.exp_next
      while (dispExp >= dispExpNext && dispLv < cap) {
        dispExp -= dispExpNext; dispLv++; dispExpNext = calcExpNext(dispLv)
        logs.push({ text:`★ LEVEL UP！ ${profile.class} LV${dispLv}！`, color:'#cc44ff' })
      }
      logs.push({ text:`EXP +${bonusExp}`, color:'#cc8800' })
      return bonusExp
    }

    // 報酬処理は途中で例外が出ても必ず loading を解除し結果を表示する
    // （強化石/熟練度/宝石ダンジョンが「戦闘中...」のまま固まる不具合への対策）
    try {
    if (type === 'exp') {
      const expGained = Math.floor(50 + Math.random() * 51)
      const currentClassLvD = classLevels.find(cl => cl.class_name === profile.class)?.lv || profile.lv
      const capD = getEffectiveCap(profile.class, profile.retraining)
      if (expIsFrozen(profile)) {
        logs.push({ text:`EXP +${expGained}（調査中につき停止）`, color:'#446688' })
      } else if (currentClassLvD < capD) {
        // レベルアップ表示はクライアントで計算、DB更新はRPC経由
        let dispExp = profile.exp + expGained
        let dispLv = profile.lv
        let dispExpNext = profile.exp_next
        while (dispExp >= dispExpNext && dispLv < capD) {
          dispExp -= dispExpNext; dispLv++; dispExpNext = calcExpNext(dispLv)
          logs.push({ text:`★ LEVEL UP！ ${profile.class} LV${dispLv}！`, color:'#cc44ff' })
        }
        await supabase.rpc('apply_dungeon_reward', { p_type:'exp', p_claimed_exp:expGained })
        logs.push({ text:`EXP +${expGained}`, color:'#cc8800' })
      } else {
        logs.push({ text:`⚠ レベルキャップに達しています（EXP +0）`, color:'#ff8844' })
      }
    } else if (type === 'gold') {
      const charLvG = profile.char_lv || profile.lv
      // 基礎: キャラLv×30〜45。キャラLv300以下は育成支援ボーナス×1.5
      const lvBonus = charLvG <= 300 ? 1.5 : 1.0
      const goldGained = Math.floor(charLvG * 30 * (1.0 + Math.random() * 0.5) * lvBonus * 1.5)  // デイリーダンジョン ゴールド1.5倍
      logs.push({ text:`Gold +${goldGained}${lvBonus > 1 ? '（キャラLv300までボーナス ×1.5！）' : ''}`, color:'#ffcc00' })
      const bonusExp = grantBonusExpLogs()
      await supabase.rpc('apply_dungeon_reward', { p_type:'gold', p_claimed_gold:goldGained, p_claimed_exp:bonusExp })
    } else if (type === 'stone') {
      const r = Math.random() * 100
      const stoneName = r < 10 ? '強化石(F)' : r < 25 ? '強化石(E)' : r < 55 ? '強化石(D)' : r < 80 ? '強化石(C)' : r < 95 ? '強化石(B)' : '強化石(A)'
      const { data: stoneItem } = await supabase.from('items').select('id').eq('name', stoneName).maybeSingle()
      if (!stoneItem) {
        // items テーブルに該当行が無いと付与されず「入手」表示だけ出てしまう不具合への対策
        logs.push({ text:`⚠ ${stoneName} の付与に失敗しました（アイテム未登録）。運営に連絡してください`, color:'#ff8844' })
      } else {
        // 既存所持があれば加算、無ければ新規。upsert_player_item RPC に依存せず確実に反映させる
        const { data: ownStone } = await supabase.from('player_items')
          .select('id, quantity').eq('player_id', profile.id).eq('item_id', stoneItem.id).maybeSingle()
        if (ownStone) {
          await supabase.from('player_items').update({ quantity: (ownStone.quantity || 1) + 1 }).eq('id', ownStone.id)
        } else {
          await supabase.from('player_items').insert({ player_id: profile.id, item_id: stoneItem.id, quantity: 1, equipped: false })
        }
        logs.push({ text:`💎 ${stoneName} を入手！`, color:'#6699cc' })
      }
    } else if (type === 'prof') {
      const profGained = Math.floor(50 + Math.random() * 51)
      const eqWeapon = equipment.find(e => e.slot==='weapon' && e.equipped)
      if (eqWeapon) {
        const prof = proficiency.find(p => p.equipment_id===eqWeapon.id)
        if (prof) {
          let totalExp = prof.prof_exp + profGained
          let newProfLv = prof.prof_lv
          while (totalExp >= 100) { totalExp -= 100; newProfLv++ }

          await supabase.from('proficiency').update({ prof_exp:totalExp, prof_lv:newProfLv }).eq('id', prof.id)
          if (newProfLv > prof.prof_lv) logs.push({ text:`⚔ 武器熟練度UP！ ${getProfPrefix(newProfLv)}${eqWeapon.weapons?.name || '武器'} LV${newProfLv}`, color:'#aa44ff' })
          logs.push({ text:`⚔ 武器熟練度 +${profGained}`, color:'#aa44ff' })
        } else {
          logs.push({ text:`武器熟練度なし`, color:'#446688' })
        }
      } else {
        logs.push({ text:`武器が装備されていません`, color:'#446688' })
      }
    } else if (type === 'gem') {
      // ランダムでFランク宝石を1個獲得
      const gemType = GEM_TYPES[Math.floor(Math.random()*GEM_TYPES.length)]
      try {
        const { data: existing } = await supabase.from('player_gems')
          .select('*').eq('player_id', profile.id).eq('gem_type', gemType).eq('rank', 'F').single()
        if (existing) {
          await supabase.from('player_gems').update({ quantity:(existing.quantity||1)+1 }).eq('id', existing.id)
        } else {
          await supabase.from('player_gems').insert({ player_id:profile.id, gem_type:gemType, rank:'F', quantity:1 })
        }
      } catch {
        try { await supabase.from('player_gems').insert({ player_id:profile.id, gem_type:gemType, rank:'F', quantity:1 }) } catch {}
      }
      logs.push({ text:`💍 宝石「${GEM_DATA[gemType].name}(F)」を入手！`, color:'#ff66cc' })
    }

    // gold以外のEXP以外ダンジョン（stone/prof/gem）にもおまけ経験値（8〜11）を付与
    // ※ gold は上のRPC呼び出しに同梱済み
    if (type === 'stone' || type === 'prof' || type === 'gem') {
      const bonusExp = grantBonusExpLogs()
      await supabase.rpc('apply_dungeon_reward', { p_type: type, p_claimed_exp: bonusExp })
    }

    // dungeon_attempts更新（種類ごとの列を加算）
    try {
      if (dungeonRow) {
        await supabase.from('dungeon_attempts').update({ [col]: newCount }).eq('id', dungeonRow.id)
      } else {
        await supabase.from('dungeon_attempts').insert({ player_id:profile.id, date:today, count:0, [col]:1 })
      }
    } catch {
      try { await supabase.from('dungeon_attempts').insert({ player_id:profile.id, date:today, count:0, [col]:1 }) } catch {}
    }
    await supabase.from('profiles').update({ last_action_at: new Date().toISOString() }).eq('id', profile.id)
    setDungeonCounts(prev => ({ ...prev, [type]: newCount }))
    } catch (e) {
      console.error('doDungeon error:', e)
      logs.push({ text:`⚠ 報酬処理でエラーが発生しました（${e?.message || e}）`, color:'#ff8844' })
    }
    // 結果は fetchProfile を待たずに即表示（出撃と同じ体感速度）。プロフィール再取得は背景で実行
    setBattleLogs([...logs])
    setLoading(false)
    fetchProfile().catch(() => {})
  }

  const DEV_ACCOUNTS = ['おれおれお']  // 開発者アカウント
  const suspendAccount = async (reason) => {
    await supabase.from('profiles').update({
      is_suspended: true,
      suspension_reason: reason,
      suspicious_flag: true,
    }).eq('id', profile.id)
    await supabase.from('battle_logs').insert({
      player_id: profile.id,
      area_id: selectedArea,
      is_boss: false, is_papia: false, win: false,
      exp_gained: 0, gold_gained: 0,
      suspicious: true,
      reason,
    })
    setBattleLogs([{ text:`⛔ 不正行為が検出されました。アカウントを停止します。`, color:'#ff4444' }])
    setScene('battle')
    setTimeout(async () => { await supabase.auth.signOut() }, 3000)
  }

  const BOT_CHECK_MS = 5 * 60 * 1000  // 5分

  // BOT確認チャレンジ：ランダム位置にボタンを出し、5分以内に押さなければ停止措置
  const triggerBotCheck = () => {
    const top = Math.floor(15 + Math.random()*65)
    const left = Math.floor(5 + Math.random()*65)
    botCheckActiveRef.current = true
    botCheckDeadlineRef.current = Date.now() + BOT_CHECK_MS
    setBotCheck({ top, left })
    if (botCheckTimerRef.current) clearTimeout(botCheckTimerRef.current)
    botCheckTimerRef.current = setTimeout(async () => {
      botCheckTimerRef.current = null
      if (!botCheckActiveRef.current) return
      botCheckActiveRef.current = false
      setBotCheck(null)
      await suspendAccount('BOT確認ボタンを5分以内に押せなかった')
    }, BOT_CHECK_MS)
  }
  const passBotCheck = () => {
    botCheckActiveRef.current = false
    if (botCheckTimerRef.current) { clearTimeout(botCheckTimerRef.current); botCheckTimerRef.current = null }
    botCheckDeadlineRef.current = null
    setBotCheck(null)
    sortieTimesRef.current = []
  }
  // タブ非アクティブ時にBOTタイマーを一時停止・復帰
  useEffect(() => {
    const handleVisibility = () => {
      if (!botCheckActiveRef.current) return
      if (document.hidden) {
        // 非アクティブ：タイマー停止、残り時間を保存
        if (botCheckTimerRef.current) {
          clearTimeout(botCheckTimerRef.current)
          botCheckTimerRef.current = null
        }
      } else {
        // 復帰：残り時間で再セット
        const remaining = (botCheckDeadlineRef.current || 0) - Date.now()
        if (remaining > 0) {
          botCheckTimerRef.current = setTimeout(async () => {
            botCheckTimerRef.current = null
            if (!botCheckActiveRef.current) return
            botCheckActiveRef.current = false
            setBotCheck(null)
            await suspendAccount('BOT確認ボタンを5分以内に押せなかった')
          }, remaining)
        } else if (botCheckActiveRef.current) {
          // 期限切れ（長時間放置）でも停止しない：ユーザーが戻ってきたのでキャンセル扱い
          passBotCheck()
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (botCheckTimerRef.current) clearTimeout(botCheckTimerRef.current)
    }
  }, [])

  const botCheckOverlay = botCheck && (
    <div style={{ position:'fixed', inset:0, zIndex:99999, background:'rgba(0,0,0,0.88)' }}>
      <div style={{ position:'absolute', top:'24px', left:0, right:0, textAlign:'center', color:'#ffcc00', fontFamily:'monospace', fontSize:'13px', padding:'0 16px' }}>
        ⚠ 自動操作の疑いがあります。<br/>1分以内に下のボタンを押してください（未操作の場合アカウントを停止します）
      </div>
      <button onClick={passBotCheck}
        style={{ position:'absolute', top:`${botCheck.top}vh`, left:`${botCheck.left}vw`, padding:'14px 22px', background:'#1a0000', border:'2px solid #ff4444', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'14px', whiteSpace:'nowrap' }}>
        🤖 私はBOTではありません
      </button>
    </div>
  )

  const doBattle = async (e) => {
    if (!canAct || loading) return
    if (botCheck) return  // BOT確認チャレンジ中は出撃不可
    // 自動操作検知（isTrusted=falseはSelenium等ブラウザ自動化ツールの特徴）
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
    if (profile.battle_ban_until && new Date(profile.battle_ban_until) > new Date()) {
      const banEnd = new Date(profile.battle_ban_until)
      const diffMs = banEnd - new Date()
      const diffH = Math.floor(diffMs / 3600000)
      const diffM = Math.ceil((diffMs % 3600000) / 60000)
      setBattleLogs([{ text:`⛔ 異常な行動が検出されました。出撃禁止中（残り${diffH}時間${diffM}分）`, color:'#ff4444' }])
      setScene('battle')
      return
    }


    // 街に戻らず連続出撃10回でBOTチャレンジ発動（F5連打＋オートクリック対策）
    if (true) {
      const newConsec = (profile.consecutive_battle_count || 0) + 1
      if (newConsec >= 10) {
        await supabase.from('profiles').update({ consecutive_battle_count: 0, suspicious_flag: true }).eq('id', profile.id)
        await supabase.from('battle_logs').insert({
          player_id: profile.id, area_id: selectedArea,
          is_boss: false, is_papia: false, win: false,
          exp_gained: 0, gold_gained: 0,
          suspicious: true, reason: '街に戻らず連続10回出撃（BOTチャレンジ発動）',
        })
        triggerBotCheck()
        setLoading(false)
        return
      }
      await supabase.from('profiles').update({ consecutive_battle_count: newConsec }).eq('id', profile.id)
      setProfile(p => ({ ...p, consecutive_battle_count: newConsec }))
    }

    const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
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

    setLoading(true); setScene('battle'); setBattleLogs([]); setCurrentEnemy(enemy)
    // 出撃直後2秒は「街に戻る」を無効化（その場連打＋オートクリッカー自動化対策）
    setCanLeaveBattle(false)
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => setCanLeaveBattle(true), 2000)

    // Atomic lock: last_action_atが古い場合のみUPDATE（複数端末同時出撃・釣り中出撃を防ぐ）
    const lockTime = new Date(Date.now() - WAIT_SECONDS * 1000).toISOString()
    const now = new Date().toISOString()
    const { data: locked } = await supabase.from('profiles')
      .update({ last_action_at: now })
      .eq('id', profile.id)
      .lt('last_action_at', lockTime)
      .eq('is_fishing', false)
      .select('id')
    if (!locked || locked.length === 0) {
      setLoading(false); setScene('town'); await fetchProfile(); return
    }
    setProfile(p => ({ ...p, last_action_at: now }))

    // オートクリッカー検知：出撃間隔が異常に規則的（一定間隔の機械的連打）なら12時間出撃禁止
    {
      const times = sortieTimesRef.current
      times.push(Date.now())
      if (times.length > AUTOCLICK_SAMPLES) times.shift()
      if (times.length >= AUTOCLICK_SAMPLES) {
        const intervals = times.slice(1).map((t,i) => t - times[i])
        const spread = Math.max(...intervals) - Math.min(...intervals)
        if (spread < AUTOCLICK_SPREAD_MS) {
          triggerBotCheck()
          setLoading(false); return
        }
      }
    }

    const currentClassLv = classLevels.find(cl => cl.class_name === profile.class)?.lv || profile.lv
    const cap = getEffectiveCap(profile.class, profile.retraining)
    const isAtCap = currentClassLv >= cap

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
    let bossHealCount = 0
    let bossHealCooldown = 0
    let bossSpecialUsed = false
    let bossBuff1Used = false   // HP70%以下で発動
    let bossBuff2Used = false   // HP30%以下で発動
    let bossHeal1Used = false   // HP60%以下で発動
    let bossHeal2Used = false   // HP30%以下で発動
    let papiaEscaped = false
    let playerAttacking = false  // bloodRage：直接攻撃中のみtrue

    const equippedWeaponItem = equipment.find(e => e.slot==='weapon' && e.equipped)
    const isArtifact = equippedWeaponItem?.bonus_effect === 'artifact'

    // 状況別スキルセット：パピア遭遇時はパピア限定セット、それ以外は出撃セット
    // ページ遷移直後など、読み込み未完了/失敗でstateが空のままだとスキル無し戦闘になるため、空ならDBから取り直す
    let curSortieSets = skillSets, curPapiaSets = papiaSkillSets
    if (curSortieSets.length === 0) {
      const { data: ss2 } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', profile.id).order('slot_order')
      if (Array.isArray(ss2) && ss2.length) {
        curSortieSets = ss2.filter(r => (r.set_type || 'sortie') === 'sortie')
        const papia2 = ss2.filter(r => r.set_type === 'papia')
        curPapiaSets = papia2.some(r => r.skills?.type !== 'パッシブ') ? papia2 : curSortieSets
        setSkillSets(curSortieSets)
        setPapiaSkillSets(curPapiaSets)
      }
    }
    const activeSkillSets = isPapiaEncounter ? curPapiaSets : curSortieSets
    const passiveNames = activeSkillSets.filter(ss => ss.skills?.type === 'パッシブ').map(ss => ss.skills.name)
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

    // 再修練3段でパッシブ強化（現在クラス一致＆再修練3回以上＆そのパッシブをセット中）
    const rtCur = (profile.retraining||{})[profile.class]||0
    const pe = (cls) => profile.class === cls && rtCur >= 3

    const passiveCritBonus   = (hasShingan ? 5 : 0) + (hasSeimitsu ? 5 : 0)
    const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.2 : 0  // 隠身強化：クリ威力+20%
    const passiveDmgMult     = (hasShingan ? (pe('侍')?1.10:1.05) : 1.0) * (hasBerserk ? (pe('狂戦士')?1.20:1.15) : 1.0) * (hasKakushin ? (pe('異端審問官')?1.15:1.1) : 1.0) * (hasRokkan ? (pe('サイキッカー')?1.10:1.05) : 1.0)
    const passiveHealMult    = (hasShinkoka ? (pe('聖職者')?1.4:1.2) : 1.0) * (hasKakushin ? 0.7 : 1.0)
    const passiveMatkMult    = hasShinkoka ? 1.1 : 1.0
    const passiveMpCostMult  = hasTenki ? 0.9 : 1.0
    const passiveMatkMultTenki = hasTenki ? (pe('賢者')?1.3:1.1) : 1.0
    const passiveHitBonus    = (hasRokkan ? 5 : 0) + (hasSeimitsu ? 5 : 0) + (hasTakaNoMe ? (pe('狩人')?20:10) : 0)
    const passiveHealReflect = (hasShinkoka && pe('聖職者'))  // 神聖加護強化：回復量の50%を敵に
    const hasGambleBody       = passiveNames.includes('ギャンブルボディ')
    const hasMadokenJutsu     = passiveNames.includes('魔導剣術')
    const hasHolyKnightPassive= passiveNames.includes('聖騎士の心得')

    if (isBossEncounter) {
      // セット中(equipped=true)の魔よけのお守りを直接DBから取得する。
      // playerItem(.single())は装備中アイテムが2個以上あるとnullになるため、それに依存しない
      let charm = (currentItem && currentItem.items?.effect === 'boss_avoid') ? currentItem : null
      if (!charm) {
        const { data: equippedCharm } = await supabase.from('player_items')
          .select('*, items!inner(effect)')
          .eq('player_id', profile.id).eq('equipped', true).eq('items.effect', 'boss_avoid')
          .gt('quantity', 0).limit(1).maybeSingle()
        if (equippedCharm) charm = equippedCharm
      }
      if (charm) {
        logs.push({ text:`🧿 魔よけのお守りが光り、ボスとの戦闘を避けた！`, color:'#cc44ff' })
        setBattleLogs([...logs])
        const newQty = (charm.quantity||1)-1
        if (newQty <= 0) await supabase.from('player_items').delete().eq('id', charm.id).gt('quantity', 0)
        else await supabase.from('player_items').update({ quantity:newQty }).eq('id', charm.id).gte('quantity', charm.quantity)
        await supabase.from('profiles').update({ boss_encounter_rate:0, last_action_at:new Date().toISOString() }).eq('id', profile.id)
        await fetchProfile(); setLoading(false); return
      }
    }

    logs.push(isBossEncounter
      ? { text:`⚠ ボス出現！ ${enemy.name}が現れた！`, color:'#ff4444' }
      : { text:`${enemy.name}が現れた！`, color:'#88ccff' }
    )

    playerBuffs = applyEquipmentEffects(equipment, profile, playerBuffs, logs)

    const effectiveSpdForCalc = hasTakaNoMe ? Math.floor(eff.spd * 1.2) : eff.spd
    const weaponType = equippedWeaponItem?.weapons?.weapon_type || 'sword'
    const isMagical = getWeaponGroup(weaponType) === 'magical'
    const expandedSkillSet = []
    for (const ss of activeSkillSets) {
      if (ss.skills?.type === 'パッシブ') continue
      const count = ss.use_count || 1
      for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
    }

    const playerSpd = effectiveSpdForCalc
    const enemySpd = enemy.spd||5
    const playerExtraRate = calcExtraActionRate(playerSpd, enemySpd)
    const enemyExtraRate  = calcExtraActionRate(enemySpd, playerSpd)
    const playerCritRate  = calcCritRate(playerSpd, enemySpd) + passiveCritBonus + (eff.critBonus || 0)
    const enemyCritRate   = Math.max(0, calcCritRate(enemySpd, playerSpd) - (eff.critResist||0) - (playerBuffs.critResist?.turns > 0 ? (playerBuffs.critResist.value||0) : 0))

    // プレイヤーの回避率（敵が攻撃するとき）
    const playerEvasionRate = calcEvasionRate(effectiveSpdForCalc, enemySpd)
    // 敵の回避率（プレイヤーが攻撃するとき）
    const enemyEvasionRate  = calcEvasionRate(enemySpd, effectiveSpdForCalc)
    // プレイヤーの命中ボーナス（アクアクラウンなど）
    const playerHitBonus = (eff.hitBonus || 0) + passiveHitBonus

    const doPlayerAttack = (isExtra=false) => {
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
      // 宝石の防御貫通/魔法防御貫通（敵DEF/MDEFを%無視）を倍率に折り込む
      const eDefRate  = (enemyBuffs.defDown  ? enemyBuffs.defDown.rate  : 1) * (enemyBuffs.defUp  ? enemyBuffs.defUp.rate  : 1) * (1 - (eff.defPen || 0))
      const eMdefRate = (enemyBuffs.mdefDown ? enemyBuffs.mdefDown.rate : 1) * (enemyBuffs.mdefUp ? enemyBuffs.mdefUp.rate : 1) * (1 - (eff.mdefPen || 0))
      const prefix = isExtra ? `${profile.username} の追加攻撃！ ` : `${turn}ターン目: ${profile.username} の`
      const isCrit = Math.random()*100 < playerCritRate
      const critMult = isCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0

      // 敵の回避判定（プレイヤーの命中ボーナスで相殺、パピアは+50%）
      const buffHitBonus = playerBuffs.hitBonus?.turns > 0 ? playerBuffs.hitBonus.value : 0
      // 次のスキルが絶影狙撃（必中）なら回避無効
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
      // 連装銃撃の再修練強化：このスキルの命中+10%
      const skillExtraHit = (nextSkillName === '連装銃撃' && profile.class === '魔銃士' && rtCur >= 2) ? 10 : 0
      const effectiveEnemyEvasion = (isSureHit || isSelfSkill) ? 0 : Math.max(0, enemyEvasionRate - playerHitBonus - buffHitBonus - skillExtraHit) + (enemy.isPapia ? 50 : 0)
      if (effectiveEnemyEvasion > 0 && Math.random()*100 < effectiveEnemyEvasion) {
        logs.push({ text:`${prefix}${nextSkillName && !mpLack ? `${nextSkillName}！` : '攻撃！'} しかし${enemy.name}に回避された！`, color:'#446688' })
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
          const gensoMult = (hasGensoKyomei && prevSkillName && prevSkillName !== cs.skills.name) ? (pe('元素使い')?1.25:1.15) : 1.0
          // 精密照準：再修練3段で「同スキル連続使用時×1.1」が付く（素の精密照準は命中+5のみ）
          const seimitsuMult = (hasSeimitsu && pe('魔銃士') && prevSkillName && prevSkillName === cs.skills.name) ? 1.1 : 1.0
          prevSkillName = cs.skills.name
          const res = executeSkill(cs.skills, {...effBuff, lastMpCost:mpCost}, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
          const finalCrit = res.dmg > 0 && (isCrit || (res.bonusCritRate > 0 && Math.random()*100 < playerCritRate + res.bonusCritRate))
          const finalCritMult = finalCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
          const tosoMult = (hasTosoHonno && playerHp <= profile.hp_max * 0.5) ? (pe('体術師')?1.25:1.1) : 1.0
          // ②DEFスケーリング：物理=ATK/(ATK+敵DEF)、魔法=MATK/(MATK+敵MDEF)
          let defScale = 1.0
          if (res.dmg > 0) {
            const sType = cs.skills?.type
            const skillCls = cs.skills?.class_name
            const adjED  = Math.max(1, Math.floor((enemy.def ||0)*eDefRate))
            const adjEMD = Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate*(1-(res.mdefPen||0))))
            // サイコブラスト/マインドブレイク等、およびサイキッカー・魔銃士の全スキルは敵DEF・MDEFの低い方で軽減
            const useLowDef = cs.skills?.name === 'サイコブラスト' || res.useMinDef || skillCls === 'サイキッカー' || skillCls === '魔銃士'
            if (useLowDef) {
              defScale = effBuff.matk / (effBuff.matk + Math.min(adjED, adjEMD))
            } else if (sType === '物理攻撃') defScale = effBuff.atk  / (effBuff.atk  + adjED)
            else if (sType === '魔法攻撃') defScale = effBuff.matk / (effBuff.matk + adjEMD)
          }
          const allinDebuffOutMult = playerBuffs.allinDebuff?.turns > 0 ? 0.7 : 1.0
          const enemyDmgReduceMult = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
          // 半月蹴りの溜め：次のダメージスキルの威力を強化（消費）
          const nextBoostMult = (res.dmg > 0 && playerBuffs.nextSkillBoost) ? playerBuffs.nextSkillBoost.rate : 1.0
          if (nextBoostMult > 1.0 && cs.skills?.name !== '半月蹴り') res.newPlayerBuffs.nextSkillBoost = undefined
          let finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * enemyDmgReduceMult * nextBoostMult * (0.9 + Math.random() * 0.2))
          if (enemy.isPapia && res.dmg > 0) finalDmg = 1
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
          // 魔剣開放の反動中はバフ系スキルを無効化
          if (playerBuffs.spellBladeSealed?.turns > 0) {
            const blockedKeys2 = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune','holyField','holyAwakening','flashCombo','spellBladeExhaust','nextSkillBoost']
            const hadBuff2 = blockedKeys2.some(k => res.newPlayerBuffs[k] !== playerBuffs[k] && res.newPlayerBuffs[k] !== undefined)
            for (const k of blockedKeys2) { if (res.newPlayerBuffs[k] !== playerBuffs[k]) res.newPlayerBuffs[k] = playerBuffs[k] }
            if (hadBuff2) logs.push({ text:`⚔ 魔剣開放の反動中！ バフが効かない！`, color:'#ff4444' })
          }
          // オールインデバフ中はバフ系スキルを無効化
          if (playerBuffs.allinDebuff?.turns > 0) {
            const blockedKeys = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune','nextSkillBoost']
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
          // 追撃（影歩き/出血消費など）を別ヒットとして適用：メインとは独立したダメージ判定
          if (res.followup && res.followup.dmg > 0) {
            const fCrit = Math.random()*100 < (playerCritRate + (res.bonusCritRate||0))
            const fCritMult = fCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
            let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * enemyDmgReduceMult * (0.9 + Math.random()*0.2))
            if (enemy.isPapia) fDmg = 1
            fDmg = Math.max(1, fDmg)
            enemyHp -= fDmg
            logs.push({ text:`↳ 追撃！${res.followup.label?`（${res.followup.label}）`:''} ${enemy.name}に${fDmg}ダメージ！${fCrit?' 💥クリティカル！':''}`, color: fCrit?'#ffaa00':'#ffaa66' })
          }
          if (playerAttacking && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
            const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(profile.hp_max * 0.2))
            playerHp = Math.min(profile.hp_max, playerHp + rageCure)
            logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
          }
          // 神聖覚醒：攻撃ごとに追撃
          if (playerBuffs.holyAwakening?.turns > 0 && finalDmg > 0) {
            const holyBonusDmg = Math.floor((pDef * playerBuffs.holyAwakening.defMult + pMdef * playerBuffs.holyAwakening.defMult))
            enemyHp -= holyBonusDmg
            logs.push({ text:`✨ 神聖覚醒の追撃！ ${enemy.name}に${holyBonusDmg}ダメージ！`, color:'#ffeeaa' })
            if (enemyHp <= 0) { skillUsed = true; skillIndex++; return }
          }
          skillUsed = true; skillIndex++
        }
      }
      if (!skillUsed) {
        const baseAtk = isMagical ? effBuff.matk : effBuff.atk
        const eDefVal = isMagical ? Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate)) : Math.max(1, Math.floor(enemy.def*eDefRate))
        // ②通常攻撃: ATK²/(ATK+敵DEF)
        const baseDmg = Math.max(1, Math.floor(baseAtk*baseAtk/Math.max(1,baseAtk+eDefVal))+Math.floor(Math.random()*4))
        const enemyDmgReduceMult2 = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
        let finalDmg = Math.floor(baseDmg*0.7*critMult*(isArtifact?1.2:1.0)*passiveDmgMult*enemyDmgReduceMult2*(0.9+Math.random()*0.2))
        if (enemy.isPapia) finalDmg = 1
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

    const doEnemyAttack = (isExtra=false) => {
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
      // ②敵攻撃: eATK²/(eATK+プレイヤーDEF)
      const defForCalc = isEM ? Math.max(1, pMdef) : Math.max(1, pDef)
      const baseDmg = Math.max(1, Math.floor(eAtk*eAtk/Math.max(1,eAtk+defForCalc))+Math.floor(Math.random()*3))
      const enemySpdBuff = enemyBuffs.spdUp ? enemyBuffs.spdUp.rate : 1
      const playerSpdDebuff = playerBuffs.spdDown ? playerBuffs.spdDown.rate : 1

      // プレイヤーの回避判定（素早さバフ/デバフ考慮）
      const effectivePlayerSpd = effectiveSpdForCalc * (playerBuffs.spdUp ? playerBuffs.spdUp.rate : 1) * playerSpdDebuff
      const effectiveEnemySpd = enemySpd * enemySpdBuff
      const evasionRate = calcEvasionRate(effectivePlayerSpd, effectiveEnemySpd) + (eff.evasionBonus || 0) + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0) + (hasOnmi ? 5 : 0)
      if (evasionRate > 0 && Math.random()*100 < evasionRate) {
        const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
        logs.push({ text:`${prefix}${enemy.name}の攻撃！ しかし回避した！`, color:'#44ff88' })
        return
      }

      const enemyDmgDownRate = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
      // ③プレイヤーDEFランクによるボーナス軽減
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

    // 敵スキル使用（BOSSおよび⑥⑦雑魚）
    const doEnemySkillAttack = () => {
      if (!enemy.skills || enemy.skills.length === 0) return
      // BOSS回復処理：HP60%以下で1回目、HP30%以下で2回目の自動発動
      const healSkill = enemy.skills.find(s => s.type === 'heal')
      if (healSkill) {
        const hpRate = enemyHp / enemyMaxHp
        if (!bossHeal2Used && hpRate <= 0.3) {
          bossHealCount = 2; bossHeal1Used = true; bossHeal2Used = true
          const result = executeEnemySkill(healSkill, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
          enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
          Object.assign(enemyBuffs, result.newEnemyBuffs)
          return
        } else if (!bossHeal1Used && hpRate <= 0.6) {
          bossHealCount = 1; bossHeal1Used = true
          const result = executeEnemySkill(healSkill, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
          enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
          Object.assign(enemyBuffs, result.newEnemyBuffs)
          return
        }
      }
      // 大技：HP10%以下で1回限り
      if (enemy.specialMove && !bossSpecialUsed && enemyHp / enemyMaxHp <= 0.1) {
        bossSpecialUsed = true
        logs.push({ text:`💥 ${enemy.name}の「${enemy.specialMove.name}」！！`, color:'#ff0000' })
        const result = executeEnemySkill(enemy.specialMove, enemy, enemyHp, enemyMaxHp, playerHp, profile.hp_max, playerBuffs, enemyBuffs, logs, eff)
        playerHp -= result.dmgToPlayer
        Object.assign(playerBuffs, result.newPlayerBuffs)
        return
      }
      // バフスキル：HP閾値で自動発動（ランダム選択から除外）
      const buffSkills = enemy.skills.filter(s => s.type === 'buff')
      if (buffSkills.length > 0) {
        const hpRate = enemyHp / enemyMaxHp
        if (!bossBuff2Used && hpRate <= 0.3) {
          bossBuff1Used = true
          bossBuff2Used = true
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
      // 攻撃/デバフスキル
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
      const isHealSealed = playerBuffs.healSeal?.turns > 0
      if (isHealSealed) {
        logs.push({ text:`🚫 回復封じ中！ 回復効果が無効化された！`, color:'#ff4488' })
      }
      if (!isHealSealed && playerBuffs.regenHeal?.turns > 0) {
        const healAmt = Math.floor(playerBuffs.regenHeal.amount * passiveHealMult)
        playerHp = Math.min(profile.hp_max, playerHp + healAmt)
        logs.push({ text:`💚 回復効果でHPが${healAmt}回復した！`, color:'#44ff88' })
        if (passiveHealReflect && healAmt > 0) {
          const reflectDmg = Math.floor(healAmt * 0.5)
          enemyHp -= reflectDmg
          logs.push({ text:`✨ 神聖加護の反射！ ${enemy.name}に${reflectDmg}ダメージ！`, color:'#ffdd44' })
        }
      }
      if (!isHealSealed && playerBuffs.delayHeal && turn === playerBuffs.delayHeal.triggerTurn) {
        playerHp = Math.min(profile.hp_max, playerHp + playerBuffs.delayHeal.amount)
        logs.push({ text:`💚 装備効果でHPが${playerBuffs.delayHeal.amount}回復した！`, color:'#44ff88' })
      }
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
            if (isInfinite) {
              playerBuffs.potionCooldown = { turns:5 }
              logs.push({ text:`⏳ 5ターンのクールダウンが入った！`, color:'#aaaaaa' })
            } else {
              itemUsed = true
              const newQty = (currentItem.quantity||1)-1
              if (newQty <= 0) await supabase.from('player_items').delete().eq('id', currentItem.id).gt('quantity', 0)
              else await supabase.from('player_items').update({ quantity:newQty }).eq('id', currentItem.id).gte('quantity', currentItem.quantity)
              currentItem = null
            }
          } else if ((effect==='mp_pct' || effect==='mp_pct_infinite') && playerMp/profile.mp_max*100 <= threshold) {
            const healAmt = Math.floor(profile.mp_max*currentItem.items.value/100)
            playerMp = Math.min(profile.mp_max, playerMp+healAmt)
            logs.push({ text:`🧪 ${currentItem.items.name}を使用！ MPが${healAmt}回復した！`, color:'#4488ff' })
            if (isInfinite) {
              playerBuffs.potionCooldown = { turns:5 }
              logs.push({ text:`⏳ 5ターンのクールダウンが入った！`, color:'#aaaaaa' })
            } else {
              itemUsed = true
              const newQty = (currentItem.quantity||1)-1
              if (newQty <= 0) await supabase.from('player_items').delete().eq('id', currentItem.id)
              else await supabase.from('player_items').update({ quantity:newQty }).eq('id', currentItem.id)
              currentItem = null
            }
          }
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
            if (Math.random() < 0.9) doEnemySkillAttack()
            else doEnemyAttack(false)
          } else {
            doEnemyAttack(false)
          }
          if (playerHp <= 0) break
          if (enemyExtraRate > 0 && Math.random()*100 < enemyExtraRate) doEnemyAttack(true)
        }
      }
      if (playerHp <= 0) break

      // 敵出血ダメージ（敵ターン終了時）
      if (enemyBuffs.bleed) {
        const bleedDmg = Math.floor(enemyMaxHp * 0.01 * enemyBuffs.bleed.stacks)
        enemyHp -= bleedDmg
        logs.push({ text:`🩸 出血ダメージ！ ${enemy.name}に${bleedDmg}ダメージ（${enemyBuffs.bleed.stacks}スタック）！`, color:'#ff4466' })
        if (enemyHp <= 0) break
        enemyBuffs.bleed.lastTurn = (enemyBuffs.bleed.lastTurn || 0) + 1
        if (enemyBuffs.bleed.lastTurn >= 3) delete enemyBuffs.bleed
      }

      // バフ/デバフのターン減少
      const berserkWasActive = playerBuffs.berserk?.turns > 0
      Object.keys(playerBuffs).forEach(k => { if (playerBuffs[k]?.turns > 0) playerBuffs[k].turns-- })
      Object.keys(enemyBuffs).forEach(k =>  { if (enemyBuffs[k]?.turns  > 0) enemyBuffs[k].turns-- })
      // 狂乱解除時：skillIndexをマッドラッシュの次に進める
      if (berserkWasActive && playerBuffs.berserk?.turns === 0 && expandedSkillSet.length > 0) {
        const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
        if (lockedIdx >= 0) skillIndex = lockedIdx + 1
      }
      // 魔剣開放：バフ期間終了後にバフ不可状態移行
      if (playerBuffs.spellBladeExhaust?.turns === 0) {
        const sealT = playerBuffs.spellBladeExhaust.sealTurns || 4
        delete playerBuffs.spellBladeExhaust
        playerBuffs.spellBladeSealed = { turns:sealT }
        logs.push({ text:`⚔ 魔剣開放の反動！ ${sealT}ターンの間バフ不可状態になった！`, color:'#ff4444' })
      }
      // オールイン：バフ期間終了後にデバフ移行
      if (playerBuffs.allinActive?.turns === 0) {
        const reactT = playerBuffs.allinActive.reactTurns || 2
        delete playerBuffs.allinActive
        delete playerBuffs.atkUp; delete playerBuffs.matkUp; delete playerBuffs.spdUp; delete playerBuffs.dmgReduce
        playerBuffs.allinDebuff = { turns:reactT, rate:0.7 }
        logs.push({ text:`💸 オールインの効果が切れた！ ${reactT}ターンの間全ステータスが低下し、バフが使えない！`, color:'#ff4444' })
        setBattleLogs([...logs])
      }
      if (bossHealCooldown > 0) bossHealCooldown--
      // 毎ターン終了時のHPスナップショット（表示用）
      logs.push({ type:'hp', turn, playerHp:Math.max(0,playerHp), playerMax:profile.hp_max, playerName:profile.username, enemyHp:Math.max(0,enemyHp), enemyMax:enemyMaxHp, enemyName:enemy.name, playerStatus:extractStatuses(playerBuffs), enemyStatus:extractStatuses(enemyBuffs) })
      turn++
    }

    playerHp = Math.max(0, playerHp)
    const win = enemyHp <= 0
    const expGained = isAtCap ? 0
      : papiaEscaped ? 0
      : isPapiaEncounter ? 200
      : isBossEncounter ? 13
      : Math.floor(Math.random()*4)+8
    const goldGained = (win && !papiaEscaped) ? Math.floor((enemy.gold||0) * 1.5) : 0  // 出撃ゴールド1.5倍


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
        // エリア固有の追加ボスドロップ（独立判定・5%）
        if (area.bossSpecialDrop && Math.random()*100 < area.bossSpecialDrop.rate) {
          droppedItems.push(area.bossSpecialDrop.name)
        }
      } else {
        const commonDrops = area.commonDrops||[]
        const rareDrops = area.rareDrops||[]
        if (commonDrops.length > 0 && Math.random()*100 < 3) {
          if (rareDrops.length > 0 && Math.random()*100 < 30) {
            droppedItems = [rareDrops[Math.floor(Math.random()*rareDrops.length)]]
          } else {
            droppedItems = [commonDrops[Math.floor(Math.random()*commonDrops.length)]]
          }
        }
      }
      if (Math.random()*100 < 0.1) {
        droppedItems.push(ARTIFACT_BASE_NAMES[Math.floor(Math.random()*ARTIFACT_BASE_NAMES.length)])
      }
      // 素材ドロップ（0.1%）：素材所持中 or 無限ポーション所持中はドロップしない
      const matDrops = area.materialDrops || []
      if (matDrops.length > 0 && Math.random()*100 < 0.1) {
        const matName = matDrops[0]
        const isHpMat = HP_MATERIAL_NAMES.includes(matName)
        const potionEffect = isHpMat ? 'hp_pct_infinite' : 'mp_pct_infinite'
        // limit(1)+maybeSingle: 同名/同effectが重複登録されていてもエラーで判定が壊れないように
        const { data: matItemRow } = await supabase.from('items').select('id').eq('name', matName).limit(1).maybeSingle()
        const { data: potionItemRow } = await supabase.from('items').select('id').eq('effect', potionEffect).limit(1).maybeSingle()
        const hasMat = matItemRow
          ? (await supabase.from('player_items').select('id').eq('player_id', profile.id).eq('item_id', matItemRow.id).maybeSingle()).data
          : null
        const hasPotion = potionItemRow
          ? (await supabase.from('player_items').select('id').eq('player_id', profile.id).eq('item_id', potionItemRow.id).maybeSingle()).data
          : null
        if (!hasMat && !hasPotion) droppedItems.push(matName)
      }
      for (const itemName of droppedItems) {
        if (itemName.startsWith('強化石') || MATERIAL_NAMES.includes(itemName)) {
          // サーバー側RPCで原子的に付与（SELECT→INSERTの隙間で失敗していた旧方式を置換）
          // 失敗しても最大3回まで自動リトライして取りこぼしを防ぐ
          let granted = false
          for (let attempt = 0; attempt < 3 && !granted; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 600))
            const { data: gr, error: ge } = await supabase.rpc('grant_battle_item', { p_item_name: itemName })
            if (!ge && gr?.ok) granted = true
            else if (attempt === 2) console.error('drop grant error:', itemName, ge || gr)
          }
          if (granted) {
            const isMat = MATERIAL_NAMES.includes(itemName)
            logs.push({ text:`${isMat ? '✨' : '💎'} ${itemName} を入手した！`, color: isMat ? '#44ffaa' : '#6699cc' })
          } else {
            logs.push({ text:`⚠ ${itemName} の付与に失敗しました。運営に連絡してください`, color:'#ff8844' })
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
        while (totalExp >= 100) { totalExp -= 100; newProfLv++ }
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

    // 3ターン以内のボス撃破で次エリアの簡易出撃許可証を付与（一度きり）
    if (win && isBossEncounter && turn <= 3) {
      const passArea = selectedArea
      if (passArea >= 2 && passArea <= 7) {
        const passEffect = `casino_area_${passArea}`
        const { data: passItem } = await supabase.from('items').select('*').eq('effect', passEffect).maybeSingle()
        if (passItem) {
          const { data: existing } = await supabase.from('player_items').select('id').eq('player_id', profile.id).eq('item_id', passItem.id).maybeSingle()
          if (!existing) {
            await supabase.from('player_items').insert({ player_id: profile.id, item_id: passItem.id, quantity: 1, equipped: false })
            logs.push({ text:`🎫 ${passItem.name} を入手！（${turn}ターン以内クリア報酬）`, color:'#ffcc00' })
            setBattleLogs([...logs])
          }
        }
      }
    }

    const frozenExp = expIsFrozen(profile)
    let newExp = frozenExp ? profile.exp : profile.exp + expGained
    let newGold = profile.gold + goldGained
    let newLv = profile.lv
    let newExpNext = profile.exp_next
    let newPendingPoints = profile.pending_stat_points||0
    let newCharLv = profile.char_lv || 1

    if (frozenExp && expGained > 0) {
      logs.push({ text:`EXP +${expGained}（調査中につき停止）`, color:'#446688' })
      setBattleLogs([...logs])
    }

    if (!isAtCap && !frozenExp) {
      while (newExp >= newExpNext && newLv < cap) {
        newExp -= newExpNext; newLv++; newExpNext = calcExpNext(newLv); newPendingPoints++
        newCharLv++
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

    // ① サーバー側でGold・EXPを検証してから適用（クライアント改ざん対策）
    const { data: rpcResult } = await supabase.rpc('apply_battle_result', {
      p_area_id: selectedArea,
      p_is_boss: isBossEncounter,
      p_is_papia: isPapiaEncounter,
      p_papia_escaped: papiaEscaped || false,
      p_win: win,
      p_claimed_exp: expGained,
      p_claimed_gold: goldGained,
      p_hp_current: playerHp,
      p_mp_current: playerMp,
    })

    await fetchProfile()
    setLoading(false)
  }

  const useInn = async () => {
    if (loading || innBusyRef.current) return  // 連打・二重実行ガード（refで同期的に即ブロック）
    innBusyRef.current = true
    setLoading(true)
    const isDying = profile.is_dying||false
    const charLvForCost = profile.char_lv || profile.lv
    const normalCost = charLvForCost*2
    const dyingCost = charLvForCost*15

    // ★ サーバーから最新のゴールドを取得（複数タブ同時利用対策）
    const { data: serverProfile } = await supabase.from('profiles').select('gold, hp_max, mp_max').eq('id', profile.id).single()
    if (!serverProfile) { setLoading(false); innBusyRef.current = false; return }
    const serverCost = isDying ? Math.min(dyingCost, serverProfile.gold) : normalCost
    if (!isDying && serverProfile.gold < normalCost) { setLoading(false); innBusyRef.current = false; return }

    // ★ 楽観ロック: ゴールドが読み取り時と同じ場合のみ更新（別タブが先に利用してたら失敗）
    const { data: locked } = await supabase.from('profiles').update({
      hp_current: serverProfile.hp_max,
      mp_current: serverProfile.mp_max,
      gold: serverProfile.gold - serverCost,
      is_dying: false,
      last_regen_at: new Date().toISOString(),  // 自然回復タイマーをリセット（回復直後の上書き発火を防ぐ）
    }).eq('id', profile.id).eq('gold', serverProfile.gold).select('id')

    if (!locked || locked.length === 0) {
      await fetchProfile()
      setLoading(false)
      innBusyRef.current = false
      return
    }
    await fetchProfile()
    setLoading(false)
    setInnMessage('HPとMPが回復しました！')
    setTimeout(() => { setInnMessage(''); setScene('town'); innBusyRef.current = false }, 1500)
  }

  const confirmStatPoints = async () => {
    const total = Object.values(statPoints).reduce((a,b)=>a+b,0)
    if (total <= 0) return
    const { data, error } = await supabase.rpc('allocate_stat_points', {
      p_alloc: {
        hp:   statPoints.hp  ||0,
        mp:   statPoints.mp  ||0,
        atk:  statPoints.atk ||0,
        def:  statPoints.def ||0,
        matk: statPoints.matk||0,
        mdef: statPoints.mdef||0,
        spd:  statPoints.spd ||0,
      },
    })
    if (error || !data?.ok) { await fetchProfile(); setStatPoints({}); return }
    await fetchProfile()
    setPendingPoints(data.pending_stat_points || 0); setStatPoints({}); setShowStatPanel(false)
  }

  const backToTown = () => {
    setScene('town'); setBattleLogs([]); setLoading(false)
    if (profile?.id) supabase.from('profiles').update({ consecutive_battle_count: 0 }).eq('id', profile.id)
  }
  const logout = async () => { await supabase.auth.signOut(); nav('/login') }

  const submitContact = async () => {
    if (!contactForm.body.trim()) return
    setContactLoading(true)
    await supabase.from('contact_messages').insert({
      player_id: profile.id,
      player_name: profile.name,
      category: contactForm.category,
      body: contactForm.body.trim(),
    })
    setContactSent(true)
    setContactLoading(false)
  }

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
      id: 'getstrong', title: '💪 強くなる方法',
      content: `強さの土台は「レベル」。まずは出撃を重ね、コツコツとレベルを上げていこう。これがすべての基本だ。

そのうえで、ステータスを伸ばす手段はたくさんある。

● 装備の強化：ボーナス値は納得がいくまで厳選しよう
● 武器の熟練度：同じ武器を使い続けると能力が伸びていく
● 宝石：装備のソケットに埋め込めば、さらにステータスを底上げできる
● デイリーダンジョン：とてもお得なので、毎日忘れずにこなそう

クラス育成のコツとして、転職しても再修練してもステータスポイントは引き継がれる。スキルを持ち越したいなら再修練を活用しよう。また、再修練を重ねるとスキルが強化されたり、LV上限が解放されたりする。

すぐには強くなれない。あらゆる手段を少しずつ積み重ねて、着実に強くなっていこう。`,
    },
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
      content: `初期クラスは戦士・弓使い・魔法使い・僧侶・格闘家の5種類。

● 各クラスのレベルキャップはLV100
● LV1から神殿で他のクラスに転職できる
● 全クラス通算のレベルアップ回数がキャラクターレベルになる（総合力の指標）
● 転職すると、セット中のスキルは全て外れる（習得済みスキルは消えない）
● LV100に達したクラスから上位クラスに転職可能（侍・暗殺者・元素使い など）
● 神殿の「再修練」では、クラスをLV1に戻す代わりにスキルを1つ他クラスへ持ち越せる
● 再修練を重ねるとスキルが段階的に強化される（1回ごとに1つ解放）
● 再修練5回でそのクラスのLV上限が300に解放される`,
    },
    {
      id: 'skills', title: '⚡ スキル',
      content: `● レベルアップで自動習得。スキルページでスロット（最大5個）にセット
● 戦闘ではスロット順に上から繰り返し使用する
● パッシブスキルはスロットにセットすると常時発動（パッシブは1つまでしかセットできない）
● MPが足りないとスキルが発動しないので、宿屋でMP補充しておこう
● 転職するとセット中のスキルは全て外れるので、転職後にセットし直そう`,
    },
    {
      id: 'classguide', title: '🎭 クラス紹介',
      content: `【初期クラス】

⚔ 戦士
高HP・高防御の前衛タンク。物理攻撃に特化。
→ 上位：侍（速度＋複合スキル）／狂戦士（超火力・反動あり）／魔法剣士（戦士×魔法使い LV50〜）／聖騎士（戦士×僧侶 LV50〜）

🏹 弓使い
素早さ・命中に優れた後衛アタッカー。
→ 上位：狩人（毒・連射）／暗殺者（出血・クリティカル）／魔銃士（弓使い×魔法使い LV50〜）

🔮 魔法使い
特殊攻撃力（MATK）が飛びぬけて高い魔法特化。MPが多く必要。
→ 上位：元素使い（属性・スタン）／死霊使い（召喚・デバフ）／賢者（僧侶×魔法使い LV50〜）

🙏 僧侶
特殊防御・回復に強い支援型。回復スキルで長期戦を制す。
→ 上位：聖職者（強力回復・毎ターン回復）／異端審問官（特防参照攻撃・デバフ）／賢者（僧侶×魔法使い LV50〜）

👊 格闘家
素手系の近接アタッカー。クセのあるスキル構成。
→ 上位：サイキッカー（物理×魔法複合）／体術師（出血・防御無視）

🎲 ギャンブラー
特殊条件で解放される隠しクラス。ランダム性の高いスキルで一発逆転を狙う。

【上位クラスの転職条件】
● 通常上位職：対応する初期クラスがLV100に到達
● 複合上位職（魔法剣士・聖騎士・魔銃士・賢者）：対応する2クラスがそれぞれLV50以上
● ギャンブラー：特定アイテムを所持（賭博場で入手できるかも…？）`,
    },
    {
      id: 'equipment', title: '🗡 装備・強化',
      content: `● 戦闘でドロップした武器は「装備」ページで確認・装備できる
● 鍛冶屋では同名の武器か強化石を使って武器を強化
● 強化石はエリア2以降の敵からドロップ、デイリーダンジョン（石）や武器の加工でも入手できる
● 武器を使い続けると熟練度が上がりボーナスが付く
● 鍛冶屋で「再評価」すると、付与された特殊効果を別の効果に変更できる
● 「再鑑定」では武器についているボーナスステータスを振り直せる
● 各装備には宝石を1つ埋め込めるソケットがある（「宝石」の項目を参照）`,
    },
    {
      id: 'gem', title: '💍 宝石',
      content: `● 装備のソケットに埋め込むと、HP・攻撃・防御・クリティカル・貫通など様々な効果が得られる
● 各装備に1つずつ装着できる（装備ページの「宝石」タブで合成・埋め込み）
● デイリーダンジョンの「宝石ダンジョン」で入手できる（今後、入手機会は順次追加予定）
● ランクはF〜SSS。同じ宝石を3個合成すると1ランクUP（効果は1.5倍に上昇）
● 装着できる部位に制限あり
　・%系（貫通・クリティカル・命中・回避）… 装飾品のみ
　・HP / MP … 防具・装飾品
　・攻撃系 … 武器・装飾品
　・防御系 … 防具・装飾品`,
    },
    {
      id: 'inn', title: '🏨 宿屋・回復',
      content: `● 戦闘でHPが0になると「瀕死状態」になり出撃不可になる
● 宿屋でHP・MPを全回復（Goldがかかる）
● 瀕死状態の回復は通常よりGoldが多くかかる
● 時間経過でも自然回復する（瀕死状態も回復する）`,
    },
    {
      id: 'dungeon', title: '✨ デイリーダンジョン',
      content: `● 街の画面から「デイリーダンジョン」を選択
● EXP / Gold / 強化石 / 武器熟練度 / 宝石 の5種類、それぞれ1日5回まで
● リセットは毎日朝5時（日本時間）`,
    },
    {
      id: 'fishing', title: '🎣 釣り',
      content: `● 釣りページで竿を垂らして魚を釣ることができる
● 釣り中は出撃・デイリーダンジョンに入れない
● はじめて釣った魚は図鑑に登録され、永続的なステータスボーナスが獲得できる
● 同じ魚を釣っても2回目以降は図鑑登録・ステータスボーナスはない`,
    },
    {
      id: 'shop', title: '🛒 その他のページ',
      content: `● 商店：回復アイテムや補助アイテムを購入できる（解放エリアで品揃えが変わる）
● 賭博場：Goldをメダルに替え、スロットやハイ&ローで遊べる。簡易出撃でまとめて周回もできる
● 美容院：キャラクターの見た目を変更できる
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

  if (showContact) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'#001020', border:'1px solid #446688', padding:'20px', maxWidth:'460px', width:'100%', fontFamily:'monospace' }}>
        <div style={{ color:'#88ccff', fontSize:'14px', marginBottom:'12px' }}>📩 お問い合わせ</div>
        {contactSent ? (
          <>
            <div style={{ color:'#44ff88', fontSize:'13px', textAlign:'center', padding:'20px 0' }}>送信しました。ありがとうございます。</div>
            <button onClick={()=>{ setShowContact(false); setContactSent(false); setContactForm({ category:'bug', body:'' }) }}
              style={{ width:'100%', padding:'10px', background:'none', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>閉じる</button>
          </>
        ) : (
          <>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px', lineHeight:'1.6' }}>
              不具合・アカウント停止への異議・その他ご意見をお送りください。
            </div>
            <div style={{ marginBottom:'10px' }}>
              <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>カテゴリ</div>
              <select value={contactForm.category} onChange={e=>setContactForm(f=>({...f, category:e.target.value}))}
                style={{ width:'100%', padding:'8px', background:'#001040', border:'1px solid #446688', color:'#88ccff', fontFamily:'monospace', fontSize:'12px' }}>
                <option value="bug">不具合報告</option>
                <option value="ban_appeal">アカウント停止への異議</option>
                <option value="other">その他</option>
              </select>
            </div>
            <div style={{ marginBottom:'12px' }}>
              <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>内容</div>
              <textarea value={contactForm.body} onChange={e=>setContactForm(f=>({...f, body:e.target.value}))}
                rows={6} placeholder="詳しく教えてください..."
                style={{ width:'100%', padding:'8px', background:'#001040', border:'1px solid #446688', color:'#ccddff', fontFamily:'monospace', fontSize:'12px', resize:'vertical', boxSizing:'border-box' }} />
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={()=>setShowContact(false)}
                style={{ flex:1, padding:'10px', background:'none', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>キャンセル</button>
              <button onClick={submitContact} disabled={contactLoading || !contactForm.body.trim()}
                style={{ flex:1, padding:'10px', background:'#001840', border:'1px solid #88ccff', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', opacity: contactForm.body.trim() ? 1 : 0.4 }}>
                {contactLoading ? '送信中...' : '送信する'}
              </button>
            </div>
          </>
        )}
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
      <div style={{ background:'#001040', border:'2px solid #ff8844', padding:'28px 24px', maxWidth:'420px', width:'100%', maxHeight:'90vh', overflowY:'auto', textAlign:'center' }}>
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
        <div style={{ marginTop:'16px', borderTop:'1px solid #003366', paddingTop:'12px' }}>
          <button onClick={logout}
            style={{ background:'none', border:'1px solid #884444', color:'#cc6666', padding:'5px 16px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
            ログアウト
          </button>
        </div>
      </div>
    </div>
  )

  if (showAnnouncements) {
    const tabAnns = announcements.filter(a => a.title !== 'MAINTENANCE' && annCat(a) === announceTab)
    return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'#001040', border:'1px solid #ff8844', padding:'16px', maxWidth:'600px', width:'100%', maxHeight:'80vh', display:'flex', flexDirection:'column', fontFamily:'monospace' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', borderBottom:'1px solid #003366', paddingBottom:'8px', flexShrink:0 }}>
          <div style={{ color:'#ff8844', fontSize:'14px' }}>📢 お知らせ</div>
          <button onClick={()=>{ setShowAnnouncements(false); setOpenAnnouncementId(null) }} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'2px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>✕ 閉じる</button>
        </div>
        {/* カテゴリ別タブ */}
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'10px', flexShrink:0 }}>
          {ANNOUNCE_TABS.map(t => {
            const on = announceTab === t.key
            const hasNew = announcements.some(a => a.title !== 'MAINTENANCE' && annCat(a) === t.key && !seenAnnouncementIds.includes(a.id))
            return (
              <button key={t.key} onClick={()=>{ setAnnounceTab(t.key); setOpenAnnouncementId(null) }}
                style={{ flex:'1 1 56px', minWidth:'56px', padding:'6px 2px', background: on?'#1a0c00':'#000818', border:`1px solid ${on?'#ff8844':'#223344'}`, color: on?'#ffaa66':'#557799', cursor:'pointer', fontFamily:'monospace', fontSize:'10px', position:'relative', whiteSpace:'nowrap' }}>
                {t.icon} {t.label}
                {hasNew && <span style={{ position:'absolute', top:'-5px', right:'-3px', background:'#ff4400', color:'#fff', fontSize:'7px', padding:'1px 4px', borderRadius:'6px' }}>NEW</span>}
              </button>
            )
          })}
        </div>
        <div style={{ overflowY:'auto' }}>
        {tabAnns.length === 0 && <div style={{ color:'#446688', fontSize:'12px' }}>このカテゴリのお知らせはありません</div>}
        {tabAnns.map(a => {
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
    </div>
    )
  }

  if (!profile) return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>

  // メンテナンス中チェック
  const maintenanceAnnouncement = announcements.find(a => a.title === 'MAINTENANCE')
  if (maintenanceAnnouncement) return (
    <div style={{ minHeight:'100vh', background:'#000820', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'monospace' }}>
      <div style={{ textAlign:'center', padding:'32px', border:'1px solid #ffcc00', background:'#001020', maxWidth:'400px' }}>
        <div style={{ fontSize:'32px', marginBottom:'16px' }}>🔧</div>
        <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'2px', marginBottom:'12px' }}>メンテナンス中</div>
        <div style={{ color:'#88ccff', fontSize:'12px', lineHeight:'1.8', whiteSpace:'pre-wrap' }}>{maintenanceAnnouncement.content}</div>
        <div style={{ marginTop:'20px', borderTop:'1px solid #003366', paddingTop:'14px' }}>
          <button onClick={logout}
            style={{ background:'none', border:'1px solid #884444', color:'#cc6666', padding:'6px 18px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
            ログアウト
          </button>
        </div>
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
  // デイリーダンジョン：全種使い切ったらパネル自体を開けない／残り合計
  const dungeonAllUsedUp = DUNGEON_LIST.every(d => (dungeonCounts[d.type]||0) >= DUNGEON_DAILY_LIMIT)
  const charLv = profile.char_lv || profile.lv
  const innCost = isDying ? Math.min(charLv*15,profile.gold) : charLv*2
  const allocatedPoints = Object.values(statPoints).reduce((a,b)=>a+b,0)
  const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
  const total = calcTotal(eff)
  const totalRank = getTotalRank(total)
  const currentClassLv = classLevels.find(cl => cl.class_name === profile.class)?.lv || profile.lv
  const cap = getEffectiveCap(profile.class, profile.retraining)
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
    return { name, lv:cl?cl.lv:1, canChange, requires, reqLv, requiresLv, requires2, req2Lv, requires2Lv, requiresItem:req.requiresItem }
  })

  // 証明書職(requiresItem)は専用セクションで別途表示するため、上位職/特殊上位職からは除外
  const normalAdvanced = advancedAvailable.filter(c => !c.requires2 && !c.requiresItem)
  const specialAdvanced = advancedAvailable.filter(c => c.requires2 && !c.requiresItem)

  const TempleContent = () => (
    <div style={{ border:'1px solid #886600', background:'#001020', padding:'16px' }}>
      <div style={{ color:'#ccaa00', fontSize:'14px', marginBottom:'4px' }}>⛩ 神殿</div>
      <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
        現在のクラス: <span style={{color:'#88ccff'}}>{profile.class}</span><span style={{color:'#ffcc00'}}>{getRetrainingStars(profile.class, profile.retraining)}</span> LV<span style={{color:'#ffcc00'}}>{currentClassLv}</span>／{cap}
      </div>
      {RETRAINING_ENHANCEMENTS[profile.class] && (
        <div style={{ border:'1px solid #443300', background:'#0a0800', padding:'10px', marginBottom:'12px' }}>
          <div style={{ color:'#ffaa44', fontSize:'11px', marginBottom:'6px' }}>⚡ 再修練による強化（{retrainingCount}/5 発動中）</div>
          {RETRAINING_ENHANCEMENTS[profile.class].map((desc, i) => {
            const active = i < retrainingCount
            return (
              <div key={i} style={{ fontSize:'10px', lineHeight:'1.7', color: active ? '#88ffaa' : '#445566' }}>
                {active ? '✔' : '✖'} <span style={{color:'#ccaa00'}}>{'★'.repeat(i+1)}</span> {desc}
              </div>
            )
          })}
        </div>
      )}
      {templeMessage && <div style={{ color:'#44ff88', fontSize:'13px', textAlign:'center', padding:'10px', marginBottom:'12px', border:'1px solid #44ff88' }}>{templeMessage}</div>}
      {/* 再修練セクション：キャップ到達時のみ表示 */}
      {isAtCap && retrainingCount < 5 && <div style={{ border:'1px solid #664400', background:'#0a0800', padding:'12px', marginBottom:'12px' }}>
        <div style={{ color:'#ffaa44', fontSize:'12px', marginBottom:'6px' }}>🔄 再修練</div>
        <div style={{ color:'#446688', fontSize:'10px', marginBottom:'8px', lineHeight:'1.6' }}>
          レベルキャップ到達時に再修練できます。<br/>
          再修練するとLV1にリセット・スキル1つを持ち越せます。<br/>
          再修練するごとに、そのクラスのスキルが上から1つずつ段階強化されます（そのクラスでプレイ中のみ有効）。<br/>
          さらに、そのクラスでプレイ中はレベル成長分のステータスが★の数×10%上昇します（★5で成長分+50%）。<br/>
          他クラスに転職後も各クラスの成長分は加算されます（通常クラス: 50%＋★×10%・最大100% ／ <span style={{color:'#ffcc00'}}>初期クラス: 50%＋★×30%（上限なし・★5で200%）</span>）。<br/>
          上限5回まで（★★★★★）。5回到達でこのクラスのレベル上限が300に解放されます。
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
                <div style={{ color:'#446688', fontSize:'10px' }}>LV {c.lv} / {getEffectiveCap(c.name, profile.retraining)}</div>
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
                <div style={{ color:'#446688', fontSize:'10px' }}>{c.requires} LV{c.reqLv}/{c.requiresLv}　クラスLV{c.lv}/{getEffectiveCap(c.name, profile.retraining)}</div>
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
                <div style={{ color:'#446688', fontSize:'10px' }}>クラスLV{c.lv}/{getEffectiveCap(c.name, profile.retraining)}</div>
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
      <div style={{ color:'#ffcc00', fontSize:'11px', marginBottom:'6px' }}>── 証明書職（アイテムで解放）──</div>
      <div style={{ marginBottom:'12px' }}>
        {(() => {
          const isCurrent = profile.class === 'ギャンブラー'
          const cl = classLevels.find(x=>x.class_name==='ギャンブラー')
          const canChange = !isCurrent && hasGamblerProof
          return (
            <div style={{ border:`1px solid ${isCurrent?'#445566':canChange?'#886600':'#002244'}`, background:isCurrent?'#001828':'#001028', padding:'8px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ color:isCurrent?'#88aabb':canChange?'#ffcc00':'#446688', fontSize:'12px' }}>
                    ギャンブラー{isCurrent&&<span style={{color:'#446688',fontSize:'9px',marginLeft:'6px'}}>（現在）</span>}
                  </div>
                  <div style={{ color:'#446688', fontSize:'10px' }}>ギャンブラーの証が必要</div>
                  <div style={{ color:'#446688', fontSize:'10px' }}>クラスLV{cl?cl.lv:1}/{getEffectiveCap('ギャンブラー', profile.retraining)}</div>
                </div>
                <button onClick={()=>setPendingClassChange('ギャンブラー')} disabled={isCurrent||!canChange||loading}
                  style={{ padding:'4px 8px', background:isCurrent?'#001':canChange?'#1a1000':'#001', border:`1px solid ${isCurrent?'#334455':canChange?'#886600':'#002244'}`, color:isCurrent?'#334455':canChange?'#ffcc00':'#334455', cursor:isCurrent||!canChange?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                  {isCurrent?'現在':'転職'}
                </button>
              </div>
            </div>
          )
        })()}
      </div>
      <button onClick={backToTown} style={{ width:'100%', padding:'10px', background:'#001840', border:'1px solid #0088ff', color:'#0088ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏰 街に戻る</button>
    </div>
  )

  // ===== スマホレイアウト =====
  if (isMobile) {
    return (
      <div style={{ minHeight:'100vh', background:'#000820', fontFamily:'monospace' }}>
        {botCheckOverlay}
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
            <button onClick={()=>{ nav('/museum'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ccaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🏛 博物館</button>
            <button onClick={()=>{ nav('/barber'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>✂ 美容院</button>
            <button onClick={()=>{ nav('/casino'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🎰 賭博場</button>
            <button onClick={()=>{ nav('/fishing'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🎣 釣り場</button>
            <button onClick={()=>{ nav('/exchange'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🔄 交換所</button>
            <button onClick={()=>{ nav('/raid'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>⚔ レイドボス</button>
            <button onClick={()=>{ nav('/pets'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🐾 ペット</button>
            <button onClick={()=>{ nav('/dungeon'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🕳 ダンジョン</button>
            {profile?.is_admin && (
              <button onClick={()=>{ nav('/status'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📊 ステータス詳細[開発]</button>
            )}
            <button onClick={()=>{ nav('/abyss'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#c08cff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>⚔ 挑戦/奈落闘技場</button>
            <button onClick={()=>{ setShowContact(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📩 お問い合わせ</button>
            <button onClick={()=>{ logout(); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🚪 ログアウト</button>
          </div>
        )}
        {showMenu && <div onClick={()=>setShowMenu(false)} style={{ position:'fixed', inset:0, zIndex:150 }} />}

        <div style={{ padding:'8px 12px' }}>
          {claimableTitles > 0 && (
            <button onClick={()=>nav('/titles')}
              style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#001a08', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🎉 獲得できる称号があります！（{claimableTitles}件）→ 称号ページへ
            </button>
          )}
          <div style={{ border:`1px solid ${isDying?'#660000':'#0044aa'}`, background:'#001040', padding:'10px', marginBottom:'8px' }}>
            {isDying && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'6px', border:'1px solid #660000', padding:'3px', background:'#1a0000' }}>⚠ 瀕死状態　HP全回復まで出撃不可</div>}
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
              {profile.avatar_url && <img src={profile.avatar_url} alt="avatar" style={{ width:'48px', height:'48px', objectFit:'cover', flexShrink:0 }} />}
              <div style={{ flex:1 }}>
                <div style={{ color:'#ffcc00', fontSize:'13px' }}>
                  {profile.display_title && <span style={{ color:'#aaaaff', fontSize:'11px', marginRight:'4px' }}>{profile.display_title}</span>}
                  {profile.username}
                </div>
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
            {statExpanded && (<>
              <MiniBar label="EXP" val={`${profile.exp}/${profile.exp_next}`} pct={expPct} color="#cc8800" />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#446688', marginBottom:'2px' }}>
                <span>自然回復</span><span style={{color:'#44ccff'}}>{regenRemaining>0?`${Math.ceil(regenRemaining)}秒`:'回復中...'}</span>
              </div>
              <div style={{ background:'#001028', height:'3px', border:'1px solid #002244', marginBottom:'8px' }}>
                <div style={{ height:'100%', width:`${regenPct}%`, background:'linear-gradient(90deg,#003333,#44ccff)' }} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'2px', fontSize:'10px', marginBottom:'6px' }}>
                <StatMini label="攻撃" base={eff.atk  - eff.bonus.atk}  bonus={eff.bonus.atk}  color="#ffcc00" type="atk" />
                <StatMini label="防御" base={eff.def  - eff.bonus.def}  bonus={eff.bonus.def}  color="#88aaff" type="def" />
                <StatMini label="特攻" base={eff.matk - eff.bonus.matk} bonus={eff.bonus.matk} color="#cc44ff" type="matk" />
                <StatMini label="特防" base={eff.mdef - eff.bonus.mdef} bonus={eff.bonus.mdef} color="#44ccff" type="mdef" />
                <StatMini label="速さ" base={eff.spd  - eff.bonus.spd}  bonus={eff.bonus.spd}  color="#ff8844" type="spd" />
              </div>
              {pendingPoints > 0 && (
                <button onClick={()=>{ setShowStatPanel(true); setStatPoints({hp:0,mp:0,atk:0,def:0,matk:0,mdef:0,spd:0}) }}
                  style={{ width:'100%', padding:'6px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                  ★ ステータスを振り分ける（{pendingPoints}pt）
                </button>
              )}
            </>)}
            <button onClick={toggleStatExpanded}
              style={{ width:'100%', padding:'4px', marginTop:'6px', background:'#000e1a', border:'1px solid #003366', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
              {statExpanded ? '▲ ステータスを閉じる' : '▼ ステータスを表示'}
            </button>
          </div>

          {showStatPanel && (
            <div style={{ border:'1px solid #cc44ff', background:'#0a0020', padding:'12px', marginBottom:'8px' }}>
              <div style={{ color:'#cc44ff', fontSize:'13px', marginBottom:'6px' }}>ステータスポイント振り分け（残り {pendingPoints-allocatedPoints}pt）</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'10px' }}>
                {Object.entries(STAT_LABELS).map(([stat,label])=>(
                  <div key={stat} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', border:`1px solid ${(statPoints[stat]||0)>0?'#cc44ff':'#003366'}`, background:(statPoints[stat]||0)>0?'#1a0030':'#000818', padding:'6px 8px' }}>
                    <span style={{ color:'#88ccff', fontSize:'10px' }}>{label}</span>
                    <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
                      <button onClick={()=>{ setStatPoints(p=>({...p,[stat]:Math.max(0,(p[stat]||0)-10)})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 4px', fontFamily:'monospace', fontSize:'10px' }}>-10</button>
                      <button onClick={()=>{ if((statPoints[stat]||0)>0) setStatPoints(p=>({...p,[stat]:p[stat]-1})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>-</button>
                      <span style={{ color:'#cc44ff', fontSize:'11px', minWidth:'16px', textAlign:'center' }}>{statPoints[stat]||0}</span>
                      <button onClick={()=>{ if(allocatedPoints<pendingPoints) setStatPoints(p=>({...p,[stat]:(p[stat]||0)+1})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>+</button>
                      <button onClick={()=>{ const room=pendingPoints-allocatedPoints; if(room>0) setStatPoints(p=>({...p,[stat]:(p[stat]||0)+Math.min(10,room)})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 4px', fontFamily:'monospace', fontSize:'10px' }}>+10</button>
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
              {(() => {
                const raidSeenKey = raidBossData ? `bf_raid_seen_${raidBossData.boss.id}` : null
                const isSeen = raidSeenKey && localStorage.getItem(raidSeenKey)
                const b = raidBossData?.boss
                const parts = raidBossData?.participants || []
                const hpRatio = b ? b.hp_current / b.hp_max : 0
                const totalDmg = parts.reduce((s,p) => s + Number(p.damage_dealt), 0)
                const todayJst = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'})).toISOString().slice(0,10)
                const waitingSeen = localStorage.getItem(`bf_raid_waiting_seen_${todayJst}`)
                if ((raidStatus === 'defeated' || raidStatus === 'expired') && isSeen) return null
                if ((!raidStatus || raidStatus === null) && waitingSeen) return null
                if (raidStatus === 'pre') return (
                  <div style={{ background:'#1a0a00', border:'1px solid #ff4444', padding:'6px 10px', marginBottom:'8px', textAlign:'center', fontSize:'11px' }}>
                    <span style={{ color:'#ff8844' }}>⚔ レイドボスまもなく出現！</span>
                    {raidPreCountdown && <span style={{ color:'#446688', marginLeft:'8px' }}>出現まで {raidPreCountdown}</span>}
                  </div>
                )
                return (
                  <div style={{ border:'1px solid #440000', background:'#0a0010', padding:'10px', marginBottom:'8px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                      <span style={{ color:'#ff4444', fontSize:'11px', letterSpacing:'1px' }}>⚔ レイドボス</span>
                      {(raidStatus === 'defeated' || raidStatus === 'expired') && raidSeenKey && (
                        <span style={{ color:'#446688', fontSize:'10px', cursor:'pointer' }}
                          onClick={()=>{ localStorage.setItem(raidSeenKey,'1'); setRaidStatus(null); setRaidBossData(null) }}>× 閉じる</span>
                      )}
                    </div>
                    {raidStatus === 'active' && b && (
                      <>
                        <div style={{ height:'6px', background:'#111122', border:'1px solid #223344', borderRadius:'2px', overflow:'hidden', marginBottom:'5px' }}>
                          <div style={{ height:'100%', width:`${Math.max(0,hpRatio)*100}%`, background: hpRatio>0.5?'#44ff88':hpRatio>0.25?'#ffcc00':'#ff4444' }} />
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#446688', marginBottom: parts.length>0?'6px':'0' }}>
                          <span>HP: {Number(b.hp_current).toLocaleString()} / {Number(b.hp_max).toLocaleString()}</span>
                          <span>総ダメージ: {totalDmg.toLocaleString()}</span>
                        </div>
                        {parts.length > 0 && (
                          <div style={{ borderTop:'1px solid #112233', paddingTop:'4px', marginBottom:'6px' }}>
                            {parts.slice(0,3).map((p,i) => (
                              <div key={p.player_id} style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#556677', lineHeight:'1.7' }}>
                                <span>{i===0?'👑':i+1+'.'} {p.profiles?.username}</span>
                                <span style={{ color:'#cc8844' }}>{Number(p.damage_dealt).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <button onClick={()=>nav('/raid')} style={{ width:'100%', padding:'6px', background:'#1a0000', border:'1px solid #ff4422', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>参加する →</button>
                      </>
                    )}
                    {raidStatus === 'defeated' && b && (
                      <div style={{ fontSize:'10px', color:'#446688' }}>
                        <span style={{ color:'#44ff88' }}>✓ 討伐完了</span>　総ダメージ: {totalDmg.toLocaleString()}
                        {parts.length > 0 && <div style={{ marginTop:'4px' }}>MVP: 👑 {parts[0].profiles?.username}</div>}
                      </div>
                    )}
                    {raidStatus === 'expired' && (
                      <div style={{ fontSize:'10px', color:'#886644' }}>⌛ 時間切れ（討伐失敗）</div>
                    )}
                    {(!raidStatus || raidStatus === null) && (() => {
                      const todayJst = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'})).toISOString().slice(0,10)
                      if (localStorage.getItem(`bf_raid_waiting_seen_${todayJst}`)) return null
                      return (
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ fontSize:'10px', color:'#335566' }}>毎日21:00 JST 出現</span>
                          <button onClick={()=>{ const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'})).toISOString().slice(0,10); localStorage.setItem(`bf_raid_waiting_seen_${d}`,'1'); nav('/raid') }} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'3px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>確認する</button>
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}
              <button onClick={(e)=>doBattle(e)} disabled={!canAct||loading||!canBattle}
                style={{ width:'100%', padding:'14px', background:'#001840', border:`1px solid ${canAct&&canBattle?'#ffcc00':'#003366'}`, color:canAct&&canBattle?'#ffcc00':'#446688', cursor:canAct&&canBattle?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'10px' }}>
                {isBanned?'⛔ 出撃禁止中':isDying&&!canBattle?'💀 瀕死中':canAct?`⚔ ${AREAS.find(a=>a.id===selectedArea)?.name}へ出撃！`:'⏳ 待機中...'}
              </button>
              <button onClick={()=>setShowDungeonPanel(!showDungeonPanel)} disabled={dungeonAllUsedUp||loading||isBanned}
                style={{ width:'100%', padding:'12px', background:'#0a001a', border:`1px solid ${dungeonAllUsedUp||isBanned?'#333':'#cc44ff'}`, color:dungeonAllUsedUp||isBanned?'#333':'#cc44ff', cursor:dungeonAllUsedUp||isBanned?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'13px', marginBottom:'10px', opacity:dungeonAllUsedUp||isBanned?0.4:1 }}>
                ⚔ デイリーダンジョン
              </button>
              {showDungeonPanel && (
                <div style={{ border:'1px solid #440088', background:'#0a001a', padding:'10px', marginBottom:'10px' }}>
                  <div style={{ color:'#cc44ff', fontSize:'11px', marginBottom:'8px' }}>ダンジョンを選択（各{DUNGEON_DAILY_LIMIT}回/日）</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                    {DUNGEON_LIST.map(d => {
                      const used = dungeonCounts[d.type]||0
                      const full = used >= DUNGEON_DAILY_LIMIT
                      const dis = full || loading || !canAct
                      return (
                      <button key={d.type} disabled={dis} onClick={() => { doDungeon(d.type); setShowDungeonPanel(false) }}
                        style={{ padding:'10px', background:'#001020', border:`1px solid ${dis?'#333':'#440088'}`, color:dis?'#333':'#cc44ff', cursor:dis?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'11px', opacity:dis?0.4:1 }}>
                        {d.label}<br/><span style={{fontSize:'10px',color:dis?'#333':'#446688'}}>{!full&&!canAct?`待機 ${remaining.toFixed(0)}秒`:`残り${DUNGEON_DAILY_LIMIT-used}/${DUNGEON_DAILY_LIMIT}`}</span>
                      </button>
                      )
                    })}
                  </div>
                  {expDungeonTicket && (
                    <div style={{ marginTop:'8px', borderTop:'1px solid #330066', paddingTop:'8px' }}>
                      <button onClick={useExpDungeonTicket} disabled={loading || dungeonCounts.exp <= 0}
                        style={{ width:'100%', padding:'8px', background:'#001020', border:`1px solid ${dungeonCounts.exp <= 0 ? '#333' : '#cc44ff'}`, color: dungeonCounts.exp <= 0 ? '#333' : '#cc44ff', cursor: dungeonCounts.exp <= 0 ? 'not-allowed' : 'pointer', fontFamily:'monospace', fontSize:'10px', opacity: dungeonCounts.exp <= 0 ? 0.4 : 1 }}>
                        📜 経験値ダンジョン使用回数券を使う（残り{expDungeonTicket.quantity}枚）
                      </button>
                    </div>
                  )}
                </div>
              )}
              {facilitiesExpanded && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                <button onClick={()=>{ setScene('inn'); setInnMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #0088aa', color:'#00aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏨 宿屋</button>
                <button onClick={()=>{ setScene('temple'); setTempleMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ccaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⛩ 神殿</button>
                <button onClick={()=>nav('/shop')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aa44', color:'#44aa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🛒 商店</button>
                <button onClick={()=>nav('/smithy')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚒ 鍛冶屋</button>
                <button onClick={()=>nav('/museum')} style={{ padding:'10px', background:'#001020', border:'1px solid #ccaa44', color:'#ccaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏛 博物館</button>
                <button onClick={()=>nav('/barber')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff88cc', color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✂ 美容院</button>
                <button onClick={()=>nav('/casino')} style={{ padding:'10px', background:'#001020', border:'1px solid #ffaa00', color:'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎰 賭博場</button>
                <button onClick={()=>nav('/fishing')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎣 釣り場</button>
                <button onClick={()=>nav('/exchange')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff6644', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🔄 交換所</button>
                <button onClick={()=>nav('/pets')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa88ff', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🐾 ペット</button>
              </div>
              )}
              <button onClick={toggleFacilitiesExpanded}
                style={{ width:'100%', padding:'4px', marginTop:'6px', background:'#000e1a', border:'1px solid #003366', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                {facilitiesExpanded ? '▲ 施設を閉じる' : '▼ 施設を表示'}
              </button>
              <button onClick={()=>setShowChallengePanel(!showChallengePanel)} style={{ width:'100%', padding:'14px', marginTop:'10px', background:'#1a0a0e', border:'1px solid #e05a62', color:'#ff6464', cursor:'pointer', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>⚔ 挑戦</button>
              {showChallengePanel && (
                <div ref={challengePanelRef} style={{ border:'1px solid #8a3a44', background:'#160809', padding:'10px', marginTop:'10px' }}>
                  <div style={{ color:'#ff6464', fontSize:'11px', marginBottom:'8px' }}>挑戦するコンテンツを選択</div>
                  <button onClick={()=>{ nav('/abyss'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', background:'#1a0c2a', border:'1px solid #a060ff', color:'#d0a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🕯 奈落闘技場</button>
                  {profile?.is_admin && (
                    <button onClick={()=>{ nav('/tenkyuu'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🌌 天穹十二宮 <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                  )}
                </div>
              )}
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
                    <button onClick={useInn} disabled={loading||(!isDying&&profile.gold<innCost)}
                      style={{ flex:2, padding:'10px', background:'#001830', border:'1px solid #0088aa', color:'#00aacc', cursor:(loading||(!isDying&&profile.gold<innCost))?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', opacity:(loading||(!isDying&&profile.gold<innCost))?0.4:1 }}>
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
                {currentEnemy?.isPapia && (
                  <div style={{ textAlign:'center', marginBottom:'10px' }}>
                    <img src={papiaIcon} alt="パピア" style={{ width:'50px', height:'50px', objectFit:'contain', imageRendering:'pixelated' }} />
                  </div>
                )}
                {battleLogs.map((l,i)=>(
                  <BattleLogLine key={i} l={l} />
                ))}
              </div>
              <button onClick={backToTown} disabled={!canLeaveBattle} style={{ width:'100%', padding:'10px', background: canLeaveBattle?'#001840':'#000a18', border:`1px solid ${canLeaveBattle?'#0088ff':'#13405f'}`, color: canLeaveBattle?'#0088ff':'#2a4a66', cursor: canLeaveBattle?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'13px' }}>🏰 街に戻る</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ===== PCレイアウト =====
  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      {botCheckOverlay}
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

        {claimableTitles > 0 && (
          <button onClick={()=>nav('/titles')}
            style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#001a08', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🎉 獲得できる称号があります！（{claimableTitles}件）→ 称号ページへ
          </button>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:'12px' }}>
          <div style={{ border:`1px solid ${isDying?'#660000':'#0044aa'}`, background:'#001040', padding:'10px', alignSelf:'start' }}>
            {isDying && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'8px', border:'1px solid #660000', padding:'4px', background:'#1a0000' }}>⚠ 瀕死状態　HP全回復まで出撃不可</div>}
            <div style={{ borderBottom:'1px dashed #003366', paddingBottom:'8px', marginBottom:'8px' }}>
              {profile.avatar_url && <img src={profile.avatar_url} alt="avatar" style={{ width:'60px', height:'60px', objectFit:'cover', display:'block', margin:'0 auto 6px' }} />}
              <div style={{ color:'#ffcc00', fontSize:'12px', textAlign:'center' }}>
                {profile.display_title && <span style={{ color:'#aaaaff', fontSize:'10px', marginRight:'4px' }}>{profile.display_title}</span>}
                {profile.username}
              </div>
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
            {statExpanded && (<>
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
                <StatLine label="攻撃力"     base={eff.atk  - eff.bonus.atk}  bonus={eff.bonus.atk}  color="#ffcc00" statType="atk" />
                <StatLine label="防御力"     base={eff.def  - eff.bonus.def}  bonus={eff.bonus.def}  color="#88aaff" statType="def" />
                <StatLine label="特殊攻撃力" base={eff.matk - eff.bonus.matk} bonus={eff.bonus.matk} color="#cc44ff" statType="matk" />
                <StatLine label="特殊防御力" base={eff.mdef - eff.bonus.mdef} bonus={eff.bonus.mdef} color="#44ccff" statType="mdef" />
                <StatLine label="素早さ"     base={eff.spd  - eff.bonus.spd}  bonus={eff.bonus.spd}  color="#ff8844" statType="spd" />
                <span>ゴールド: <span style={{color:'#ffcc00'}}>{profile.gold}</span></span>
              </div>
              {pendingPoints > 0 && (
                <button onClick={()=>{ setShowStatPanel(true); setStatPoints({hp:0,mp:0,atk:0,def:0,matk:0,mdef:0,spd:0}) }}
                  style={{ width:'100%', padding:'6px', background:'#1a0030', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                  ★ ステータスを振り分ける（{pendingPoints}pt）
                </button>
              )}
            </>)}
            <button onClick={toggleStatExpanded}
              style={{ width:'100%', padding:'4px', marginTop:'6px', background:'#000e1a', border:'1px solid #003366', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
              {statExpanded ? '▲ ステータスを閉じる' : '▼ ステータスを表示'}
            </button>
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
                        <button onClick={()=>{ setStatPoints(p=>({...p,[stat]:Math.max(0,(p[stat]||0)-10)})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 4px', fontFamily:'monospace', fontSize:'10px' }}>-10</button>
                        <button onClick={()=>{ if((statPoints[stat]||0)>0) setStatPoints(p=>({...p,[stat]:p[stat]-1})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>-</button>
                        <span style={{ color:'#cc44ff', fontSize:'11px', minWidth:'16px', textAlign:'center' }}>{statPoints[stat]||0}</span>
                        <button onClick={()=>{ if(allocatedPoints<pendingPoints) setStatPoints(p=>({...p,[stat]:(p[stat]||0)+1})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 5px', fontFamily:'monospace' }}>+</button>
                        <button onClick={()=>{ const room=pendingPoints-allocatedPoints; if(room>0) setStatPoints(p=>({...p,[stat]:(p[stat]||0)+Math.min(10,room)})) }} style={{ background:'#001', border:'1px solid #446688', color:'#88ccff', cursor:'pointer', padding:'0 4px', fontFamily:'monospace', fontSize:'10px' }}>+10</button>
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
                {(() => {
                  const raidSeenKey = raidBossData ? `bf_raid_seen_${raidBossData.boss.id}` : null
                  const isSeen = raidSeenKey && localStorage.getItem(raidSeenKey)
                  const b = raidBossData?.boss
                  const parts = raidBossData?.participants || []
                  const hpRatio = b ? b.hp_current / b.hp_max : 0
                  const totalDmg = parts.reduce((s,p) => s + Number(p.damage_dealt), 0)
                  const hasUnclaimed = raidStatus === 'defeated' && parts.some(p => p.player_id === profile?.id && !p.reward_claimed)
                  const todayJst2 = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'})).toISOString().slice(0,10)
                  const waitingSeen2 = localStorage.getItem(`bf_raid_waiting_seen_${todayJst2}`)
                  if ((raidStatus === 'defeated' || raidStatus === 'expired') && isSeen && !hasUnclaimed) return null
                  if ((!raidStatus || raidStatus === null) && waitingSeen2) return null
                  if (raidStatus === 'pre') return (
                    <div style={{ background:'#1a0a00', border:'1px solid #ff4444', padding:'6px 10px', marginBottom:'8px', textAlign:'center', fontSize:'11px' }}>
                      <span style={{ color:'#ff8844' }}>⚔ レイドボスまもなく出現！</span>
                      {raidPreCountdown && <span style={{ color:'#446688', marginLeft:'8px' }}>出現まで {raidPreCountdown}</span>}
                    </div>
                  )
                  return (
                    <div style={{ border:'1px solid #440000', background:'#0a0010', padding:'10px', marginBottom:'8px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                        <span style={{ color:'#ff4444', fontSize:'11px', letterSpacing:'1px' }}>⚔ レイドボス</span>
                        {(raidStatus === 'defeated' || raidStatus === 'expired') && raidSeenKey && (
                          <span style={{ color:'#446688', fontSize:'10px', cursor:'pointer' }}
                            onClick={()=>{ localStorage.setItem(raidSeenKey,'1'); setRaidStatus(null); setRaidBossData(null) }}>× 閉じる</span>
                        )}
                      </div>
                      {raidStatus === 'active' && b && (
                        <>
                          <div style={{ height:'6px', background:'#111122', border:'1px solid #223344', borderRadius:'2px', overflow:'hidden', marginBottom:'5px' }}>
                            <div style={{ height:'100%', width:`${Math.max(0,hpRatio)*100}%`, background: hpRatio>0.5?'#44ff88':hpRatio>0.25?'#ffcc00':'#ff4444' }} />
                          </div>
                          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#446688', marginBottom: parts.length>0?'6px':'0' }}>
                            <span>HP: {Number(b.hp_current).toLocaleString()} / {Number(b.hp_max).toLocaleString()}</span>
                            <span>総ダメージ: {totalDmg.toLocaleString()}</span>
                          </div>
                          {parts.length > 0 && (
                            <div style={{ borderTop:'1px solid #112233', paddingTop:'4px', marginBottom:'6px' }}>
                              {parts.slice(0,3).map((p,i) => (
                                <div key={p.player_id} style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#556677', lineHeight:'1.7' }}>
                                  <span>{i===0?'👑':i+1+'.'} {p.profiles?.username}</span>
                                  <span style={{ color:'#cc8844' }}>{Number(p.damage_dealt).toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <button onClick={()=>nav('/raid')} style={{ width:'100%', padding:'6px', background:'#1a0000', border:'1px solid #ff4422', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>参加する →</button>
                        </>
                      )}
                      {hasUnclaimed && (
                        <div onClick={()=>nav('/raid')} style={{ background:'#1a0a00', border:'1px solid #ffaa00', padding:'6px 8px', marginBottom:'6px', cursor:'pointer', borderRadius:'2px' }}>
                          <span style={{ color:'#ffaa00', fontSize:'11px' }}>🎁 未受け取りの報酬があります →</span>
                        </div>
                      )}
                    {raidStatus === 'defeated' && b && !hasUnclaimed && (
                        <div style={{ fontSize:'10px', color:'#446688' }}>
                          <span style={{ color:'#44ff88' }}>✓ 討伐完了</span>　総ダメージ: {totalDmg.toLocaleString()}
                          {parts.length > 0 && <div style={{ marginTop:'4px' }}>MVP: 👑 {parts[0].profiles?.username}</div>}
                        </div>
                      )}
                      {raidStatus === 'expired' && (
                        <div style={{ fontSize:'10px', color:'#886644' }}>⌛ 時間切れ（討伐失敗）</div>
                      )}
                      {(!raidStatus || raidStatus === null) && (() => {
                        const todayJst = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'})).toISOString().slice(0,10)
                        if (localStorage.getItem(`bf_raid_waiting_seen_${todayJst}`)) return null
                        return (
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ fontSize:'10px', color:'#335566' }}>毎日21:00 JST 出現</span>
                            <button onClick={()=>{ const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'})).toISOString().slice(0,10); localStorage.setItem(`bf_raid_waiting_seen_${d}`,'1'); nav('/raid') }} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'3px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>確認する</button>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })()}
                <button onClick={(e)=>doBattle(e)} disabled={!canAct||loading||!canBattle}
                  style={{ width:'100%', padding:'12px', background:'#001840', border:`1px solid ${canAct&&canBattle?'#ffcc00':'#003366'}`, color:canAct&&canBattle?'#ffcc00':'#446688', cursor:canAct&&canBattle?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'8px' }}>
                  {isBanned?'⛔ 出撃禁止中':isDying&&!canBattle?'💀 瀕死中（HP全回復まで出撃不可）':canAct?`⚔ ${AREAS.find(a=>a.id===selectedArea)?.name}へ出撃！`:'⏳ 待機中...'}
                </button>
                <button onClick={()=>setShowDungeonPanel(!showDungeonPanel)} disabled={dungeonAllUsedUp||loading}
                  style={{ width:'100%', padding:'10px', background:'#0a001a', border:`1px solid ${dungeonAllUsedUp?'#333':'#cc44ff'}`, color:dungeonAllUsedUp?'#333':'#cc44ff', cursor:dungeonAllUsedUp?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px', opacity:dungeonAllUsedUp?0.4:1 }}>
                  ⚔ デイリーダンジョン
                </button>
                {showDungeonPanel && (
                  <div style={{ border:'1px solid #440088', background:'#0a001a', padding:'10px', marginBottom:'8px' }}>
                    <div style={{ color:'#cc44ff', fontSize:'11px', marginBottom:'8px' }}>ダンジョンを選択（各{DUNGEON_DAILY_LIMIT}回/日）</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                      {DUNGEON_LIST.map(d => {
                        const used = dungeonCounts[d.type]||0
                        const full = used >= DUNGEON_DAILY_LIMIT
                        const dis = full || loading || !canAct
                        return (
                        <button key={d.type} disabled={dis} onClick={() => { doDungeon(d.type); setShowDungeonPanel(false) }}
                          style={{ padding:'10px', background:'#001020', border:`1px solid ${dis?'#333':'#440088'}`, color:dis?'#333':'#cc44ff', cursor:dis?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'11px', opacity:dis?0.4:1 }}>
                          {d.label}<br/><span style={{fontSize:'10px',color:dis?'#333':'#446688'}}>{!full&&!canAct?`待機 ${remaining.toFixed(0)}秒`:`残り${DUNGEON_DAILY_LIMIT-used}/${DUNGEON_DAILY_LIMIT}`}</span>
                        </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {facilitiesExpanded && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                  <button onClick={()=>{ setScene('inn'); setInnMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #0088aa', color:'#00aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏨 宿屋へ</button>
                  <button onClick={()=>{ setScene('temple'); setTempleMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ccaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⛩ 神殿へ</button>
                  <button onClick={()=>nav('/shop')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aa44', color:'#44aa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🛒 商店へ</button>
                  <button onClick={()=>nav('/smithy')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚒ 鍛冶屋へ</button>
                  <button onClick={()=>nav('/museum')} style={{ padding:'10px', background:'#001020', border:'1px solid #ccaa44', color:'#ccaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏛 博物館へ</button>
                  <button onClick={()=>nav('/barber')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff88cc', color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✂ 美容院へ</button>
                  <button onClick={()=>nav('/casino')} style={{ padding:'10px', background:'#001020', border:'1px solid #ffaa00', color:'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎰 賭博場へ</button>
                  <button onClick={()=>nav('/fishing')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎣 釣り場へ</button>
                  <button onClick={()=>nav('/exchange')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff6644', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🔄 交換所へ</button>
                  <button onClick={()=>nav('/pets')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa88ff', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🐾 ペット</button>
                </div>
                )}
                <button onClick={toggleFacilitiesExpanded}
                  style={{ width:'100%', padding:'4px', marginTop:'6px', background:'#000e1a', border:'1px solid #003366', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                  {facilitiesExpanded ? '▲ 施設を閉じる' : '▼ 施設を表示'}
                </button>
                <button onClick={()=>setShowChallengePanel(!showChallengePanel)} style={{ width:'100%', padding:'14px', marginTop:'10px', background:'#1a0a0e', border:'1px solid #e05a62', color:'#ff6464', cursor:'pointer', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>⚔ 挑戦</button>
                {showChallengePanel && (
                  <div ref={challengePanelRef} style={{ border:'1px solid #8a3a44', background:'#160809', padding:'10px', marginTop:'10px' }}>
                    <div style={{ color:'#ff6464', fontSize:'11px', marginBottom:'8px' }}>挑戦するコンテンツを選択</div>
                    <button onClick={()=>{ nav('/abyss'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', background:'#1a0c2a', border:'1px solid #a060ff', color:'#d0a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🕯 奈落闘技場</button>
                    {profile?.is_admin && (
                      <button onClick={()=>{ nav('/tenkyuu'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🌌 天穹十二宮 <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                    )}
                  </div>
                )}
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
                      <button onClick={useInn} disabled={loading||(!isDying&&profile.gold<innCost)}
                        style={{ flex:2, padding:'10px', background:'#001830', border:'1px solid #0088aa', color:'#00aacc', cursor:(loading||(!isDying&&profile.gold<innCost))?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', opacity:(loading||(!isDying&&profile.gold<innCost))?0.4:1 }}>
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
                  {currentEnemy?.isPapia && (
                    <div style={{ textAlign:'center', marginBottom:'10px' }}>
                      <img src={papiaIcon} alt="パピア" style={{ width:'50px', height:'50px', objectFit:'contain', imageRendering:'pixelated' }} />
                    </div>
                  )}
                  {battleLogs.map((l,i)=>(
                    <BattleLogLine key={i} l={l} />
                  ))}
                </div>
                <button onClick={backToTown} disabled={!canLeaveBattle} style={{ width:'100%', padding:'10px', background: canLeaveBattle?'#001840':'#000a18', border:`1px solid ${canLeaveBattle?'#0088ff':'#13405f'}`, color: canLeaveBattle?'#0088ff':'#2a4a66', cursor: canLeaveBattle?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'13px' }}>🏰 街に戻る</button>
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

const BUFF_LABELS = {
  atkUp:'⚔攻↑', atkDown:'⚔攻↓', defUp:'🛡防↑', defDown:'🛡防↓',
  mdefUp:'🔮魔防↑', mdefDown:'🔮魔防↓', matkUp:'🔮魔攻↑',
  spdUp:'💨速↑', spdDown:'💨速↓',
  burn:'🔥火傷', paralysis:'⚡麻痺', stun:'💫気絶',
  poison:'🟢毒', severePoisoin:'☠猛毒',
  healDown:'💉回復↓', dmgDown:'⬇被ダメ↓', dmgReduce:'🛡軽減',
  regenHeal:'💚再生', skeletonDmg:'💀骸骨',
  berserk:'😡狂乱', holyField:'✨聖域', holyAwakening:'✨神聖覚醒',
  critResist:'クリ耐', hitBonus:'🎯命中↑', evasion:'💨回避↑',
  allinActive:'🎲全賭け', allinDebuff:'💸反動',
  spellBladeExhaust:'⚔魔剣', spellBladeSealed:'🚫バフ封',
  flashCombo:'⚡閃光連撃', cannonCombo:'🔫連装',
  statusImmune:'🔰状態免疫', stunResist:'💫スタン耐',
  curseDmg:'💜呪い', healSeal:'🚫回復封',
  bloodRage:'🩸ブラッティロア',
}
export function extractStatuses(buffs) {
  const out = []
  for (const k of Object.keys(buffs || {})) {
    const b = buffs[k]
    if (!b) continue
    const active = (b.turns > 0) || (k === 'bleed' && b.stacks > 0)
    if (!active) continue
    // 出血はスタック数表示
    if (k === 'bleed') {
      out.push({ label: `🩸出血×${b.stacks}`, color: '#ff8866' })
      continue
    }
    const label = BUFF_LABELS[k] || k
    const positive = /↑|軽減|聖域|命中↑|全賭け|魔剣|ブラッティロア|再生|骸骨|覚醒|回避↑|閃光連撃|連装|状態免疫|スタン耐/.test(label)
    out.push({ label, color: positive ? '#66ddaa' : '#ff8866' })
  }
  return out
}

export function BattleLogLine({ l }) {
  if (l.type === 'hp') {
    const pPct = Math.max(0, Math.min(100, (l.playerHp / l.playerMax) * 100))
    const ePct = Math.max(0, Math.min(100, (l.enemyHp / l.enemyMax) * 100))
    const statusRow = (list, align) => (
      <div style={{ display:'flex', flexWrap:'wrap', gap:'3px', justifyContent:align, minHeight:'14px', marginBottom:'2px' }}>
        {(list || []).map((s,idx)=>(
          <span key={idx} style={{ fontSize:'9px', color:s.color, background:'#0e1c30', border:'1px solid #244', borderRadius:'3px', padding:'0 3px', whiteSpace:'nowrap' }}>{s.label}</span>
        ))}
      </div>
    )
    const col = (key, name, cur, max, pct, color, status, align) => (
      <div key={key} style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
        {statusRow(status, align)}
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#b8d0e8', gap:'4px' }}>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
          <span style={{ color, flexShrink:0, fontWeight:'bold' }}>{Math.max(0,cur).toLocaleString()} / {max.toLocaleString()}</span>
        </div>
        <div style={{ background:'#13243a', height:'6px', border:'1px solid #2a456a' }}>
          <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,#0a3,${color})` }} />
        </div>
      </div>
    )
    // 双子(第3宮)など複数の敵HPバーに対応：l.twin があれば各体を個別のバーで表示
    const enemyCols = Array.isArray(l.twin)
      ? l.twin.map((b, i) => col(`e${i}`, `${b.name}${b.down ? '（蘇生中）' : ''}`, b.hp, b.max, Math.max(0, Math.min(100, (b.hp / b.max) * 100)), b.down ? '#8866aa' : '#ff6655', null, 'flex-end'))
      : col('e', l.enemyName, l.enemyHp, l.enemyMax, ePct, '#ff6655', l.enemyStatus, 'flex-end')
    return (
      <div style={{ borderBottom:'1px solid #24405e', padding:'6px 6px', background:'#16263c', borderRadius:'3px', margin:'2px 0' }}>
        <div style={{ fontSize:'9px', color:'#7fa8d0', marginBottom:'3px', textAlign:'center' }}>━ {l.turn}ターン終了時 ━</div>
        <div style={{ display:'flex', gap:'12px', alignItems:'flex-end' }}>
          {col('p', l.playerName, l.playerHp, l.playerMax, pPct, '#33dd66', l.playerStatus, 'flex-start')}
          {enemyCols}
        </div>
      </div>
    )
  }
  return <div style={{ color:l.color, fontSize:'12px', lineHeight:'2', borderBottom:'1px solid #001428', padding:'2px 0', textAlign:'left' }}>{l.text}</div>
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
