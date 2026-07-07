import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
// public/ 配下の安定URL参照（ハッシュ付きバンドルだとデプロイ後にキャッシュ不整合で404→画像が出ないため）
const papiaIcon = '/papia.png'
import { GEM_DATA, GEM_TYPES, calcDefReduction, calcEffectiveStats } from '../lib/stats'
import { charmPlayerBonus, petPlayerBonus, petStats } from '../constants/pets'
import { countClaimableTitles } from '../lib/titles'
import { reportDevAccess } from '../lib/devAccess'
import { myAreaShares, dropBonusPP, EXPAND_COOLDOWN_MS, rankColor } from '../lib/territory'
import AIAssistant from '../components/AIAssistant'
import RaidNotify from '../components/RaidNotify'
// 対人戦(PvP)パネルは循環import回避のため遅延ロード（pvp.js が ./Game を参照するため）
const PvpPanel = lazy(() => import('../components/PvpPanel'))
// 組み手パネル（対人戦の準備施設・一般公開）も同様に遅延ロード
const KumitePanel = lazy(() => import('../components/KumitePanel'))
// アリーナパネル（梯子型対人・一般公開）。pvp.js が ./Game を参照するため遅延ロード
const ArenaPanel = lazy(() => import('../components/ArenaPanel'))
// Equipment.jsx 等が './Game' から参照しているため再export
// ★ステータス計算は lib/stats.js の1実装に統一（表示系と戦闘系で値がズレないように）
export { GEM_DATA, GEM_RANKS, GEM_TYPES, gemEffectValue, calcDefReduction, calcEffectiveStats } from '../lib/stats'

export const WAIT_SECONDS = 20      // 通常出撃クールダウン秒（街の出撃・デイリーダンジョン共通）
export const BOOST_WAIT = 10        // ブーストタイム中の出撃クールダウン秒（1日1回30分・街の出撃のみ。レイド/簡易出撃は対象外）
export const BOOST_DURATION_MIN = 30 // ブーストタイムの継続分数
// ブーストが有効か（profiles.boost_active_until が未来）。nowMs は省略時 Date.now()
export const isBoostActive = (profile, nowMs = Date.now()) =>
  !!(profile?.boost_active_until && new Date(profile.boost_active_until).getTime() > nowMs)
// 現在の有効クールダウン秒。★2026-06-20: 全プレイヤー公開。通常20秒・ブースト中10秒（街の出撃・デイリーダンジョン）
export const LEGACY_WAIT = 10
// 出撃CDモード（10秒/20秒選択式・週1変更）。★2026-06-26 全員公開（ブースト廃止）。
//  profiles.sortie_mode（10 or 20、既定20）を全プレイヤーで採用。10秒は報酬減（exp5-6/boss7/gold半分）。
export const is10sMode = (profile) => profile?.sortie_mode === 10
export const effWait = (profile, _nowMs = Date.now()) =>
  profile?.sortie_mode === 10 ? BOOST_WAIT : WAIT_SECONDS
// 新UIレイアウトの有効フラグ。
// 本番にも反映中（true）。旧UIに戻したいときは下行を import.meta.env.DEV（開発のみ）か
// false（全環境で旧UI）に変更すればワンタッチで戻せる。git tag `ui-classic` も旧UI状態の復元ポイント。
const NEW_UI = true

// ☰メニューのカテゴリ区切り。accordion=true（開発限定）のときは見出しタップで開閉、
// false のときは従来通り見出し＋中身を常時表示。気に入らなければ呼び出し側で accordion を渡さなければ元に戻る。
function MenuCat({ title, catKey, accordion, open, onToggle, children }) {
  if (!accordion) {
    return (
      <>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'12px 0 6px', color:'#446688', fontSize:'10px' }}>
          <span style={{ flex:1, borderTop:'1px solid #224466' }}/>{title}<span style={{ flex:1, borderTop:'1px solid #224466' }}/>
        </div>
        {children}
      </>
    )
  }
  return (
    <>
      <button onClick={() => onToggle(catKey)}
        style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', margin:'10px 0 0', padding:'8px 10px', background:'#00111f', border:'1px solid #224466', color:'#88aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', letterSpacing:'1px' }}>
        <span>{title}</span>
        <span style={{ color:'#446688' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ marginTop:'6px' }}>{children}</div>}
    </>
  )
}

// ☰メニュー項目の定義と段階開放。unlock=解放に必要なキャラクターLV（0=常時表示）。
// 新規プレイヤーが序盤に機能過多で迷わないよう、進行に応じて施設を開放する。
const MENU_DEFS = {
  equipment: { label:'🗡 装備',          color:'#44aaff', path:'/equipment?view=gear', unlock:0 },
  skills:    { label:'⚡ スキル',         color:'#cc44ff', path:'/skills',  unlock:0 },
  profile:   { label:'👤 プロフィール',   color:'#44ff88', path:'/profile', unlock:0 },
  shop:      { label:'🛒 商店',           color:'#44aa44', path:'/shop',    unlock:0 },
  smithy:    { label:'⚒ 鍛冶屋',          color:'#aa6644', path:'/smithy',  unlock:0 },
  fishing:   { label:'🎣 釣り場',         color:'#44aaff', path:'/fishing', unlock:5 },
  museum:    { label:'🏛 博物館',         color:'#ccaa44', path:'/museum',  unlock:5 },
  barber:    { label:'✂ 美容院',          color:'#ff88cc', path:'/barber',  unlock:5 },
  exchange:  { label:'🔄 交換所',         color:'#ff6644', path:'/exchange',unlock:5 },
  marketplace:{ label:'🏷 取引所',        color:'#44ddaa', path:'/marketplace',unlock:10 },
  casino:    { label:'🎰 賭博場',         color:'#ffaa00', path:'/casino',  unlock:10 },
  pets:      { label:'🐾 ペット',         color:'#aa88ff', path:'/pets',    unlock:10 },
  dungeon:   { label:'🕳 ダンジョン',     color:'#aa88ff', path:'/dungeon', unlock:10 },
  scarecrow: { label:'🌾 かかし修練場',   color:'#ffcc44', path:'/scarecrow',unlock:10 },
  alchemy:   { label:'🧪 錬金部屋',       color:'#44ddaa', path:'/alchemy', unlock:10 },
  raid:      { label:'⚔ レイドボス',      color:'#ff6644', path:'/raid',    unlock:30 },
  abyss:     { label:'⚔ 挑戦/奈落闘技場', color:'#c08cff', path:'/abyss',   unlock:30 },
  territory: { label:'🏰 領地',           color:'#ffcc44', path:'/territory',unlock:0 },
}
// 期間限定イベント「出撃ポイントラリー」の開催期間（JST 2026/6/22 05:00 〜 7/13 05:00・1週間延長）。
// クライアントの表示判定用（ポイント加算・受取の実体はサーバーRPCが期間管理）。
export const EVENT_START_MS = Date.UTC(2026, 5, 21, 20, 0, 0) // JST 6/22 05:00
export const EVENT_END_MS   = Date.UTC(2026, 6, 12, 20, 0, 0) // JST 7/13 05:00（1週間延長）

// 多段ヒットスキル：行動全体ではなく1発ごとに回避・クリティカル・ダメージ判定する
export const MULTI_HIT_SKILLS = new Set(['マジックアロー','三連射','メテオストライク','連打','五連殺','飛天三角蹴り','連装銃撃','群れの号令','符術・式打ち'])

// 精霊召喚士の精霊召喚スキル（連続使用で 1段目→2段目→3段目 にエスカレート）
export const SPIRIT_SUMMONS = new Set(['サラマンド','ウンディーネ','シルフ','ノーム','ルミナ','ノクス'])

// ブリーダーのペット系コマンドスキル（ペット不在時は失敗＝通常攻撃）
export const BREEDER_PET_SKILLS = new Set(['攻撃して！','一緒に頑張ろう！','休憩しよう！','やっちゃえ！'])
// 精霊召喚のコンボ状態を解決：直前に同じ精霊召喚を使っていれば段階が上がる
// tier 0=召喚 / 1=2段目 / 2=3段目（最大段階を維持）。newCount は連続使用回数
const spiritComboState = (skillName, playerBuffs) => {
  const sc = playerBuffs.spiritCombo
  const cont = !!sc && sc.name === skillName
  const count = cont ? (sc.count || 0) : 0
  return { tier: Math.min(count, 2), newCount: count + 1 }
}
const REGEN_SECONDS = 60
// 戦争中の最大HP補正（HPのみ）。lib/war.js の WAR_HP_BONUS と同値。
// （Game→war→pvp→Game の循環import回避のためここで再定義）
const WAR_HP_BONUS = 10000

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

export const AREAS = [
  {
    id: 1, name: '始まりの森',
    enemies: [
      { name:'スライム',   hp:30,  atk:6,   def:3,  matk:0,  mdef:3,  spd:3,  type:'physical', gold:20 },
      { name:'コウモリ',   hp:37,  atk:7,   def:3,  matk:0,  mdef:3,  spd:15, type:'physical', gold:25 },
      { name:'毒キノコ',   hp:60,  atk:2,   def:4,  matk:8,  mdef:7,  spd:2,  type:'magical',  gold:30 },
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
      { name:'ゴブリン', hp:160, atk:35, def:20, matk:0,  mdef:28, spd:40, type:'physical', gold:40 },
      { name:'野良犬',   hp:200, atk:45, def:24, matk:0,  mdef:25, spd:45, type:'physical', gold:50 },
      { name:'盗賊',     hp:240, atk:55, def:28, matk:10, mdef:35, spd:42, type:'physical', gold:60 },
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
      { name:'コボルト',   hp:400, atk:100, def:55, matk:0,  mdef:60,  spd:100, type:'physical', gold:80  },
      { name:'スケルトン', hp:500, atk:120, def:65, matk:30, mdef:75,  spd:110, type:'physical', gold:100 },
      { name:'ゴーレム',   hp:600, atk:150, def:85, matk:0,  mdef:65,  spd:120, type:'physical', gold:120 },
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
      { name:'海賊',     hp:1000, atk:230, def:240, matk:20,  mdef:180, spd:240, type:'physical', gold:200 },
      { name:'毒クラゲ', hp:800,  atk:80,  def:180, matk:180, mdef:240, spd:210, type:'magical',  gold:175 },
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
      { name:'山岳ゴブリン', hp:1500, atk:640, def:510, matk:0,   mdef:450, spd:380, type:'physical', gold:240 },
      { name:'岩石ゴーレム', hp:2000, atk:760, def:660, matk:0,   mdef:420, spd:400, type:'physical', gold:300 },
      { name:'グリフォン',   hp:1800, atk:700, def:540, matk:120, mdef:510, spd:450, type:'physical', gold:270 },
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
        name:'雪男',       hp:3750, atk:750, def:780, matk:0,   mdef:660, spd:975, type:'physical', gold:350,
        skills: [
          { name:'雪崩拳',       type:'physical', mult:1.4 },
        ],
      },
      {
        name:'氷河ドラゴン', hp:4500, atk:825, def:840, matk:225, mdef:840, spd:1050, type:'physical', gold:450,
        skills: [
          { name:'氷河ブレス', type:'magical',  mult:1.5 },
        ],
      },
      {
        name:'霜の精霊',   hp:3300, atk:300, def:600, matk:600, mdef:960, spd:1125, type:'magical', gold:400,
        skills: [
          { name:'霜の矢',   type:'magical',  mult:1.3 },
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
        name:'炎の精霊',   hp:10500, atk:2100, def:1920, matk:1500, mdef:2280, spd:3000, type:'magical', gold:500,
        skills: [
          { name:'火炎弾', type:'magical',  mult:1.5 },
        ],
      },
      {
        name:'溶岩ゴーレム', hp:15000, atk:2550, def:2700, matk:0, mdef:1920, spd:3300, type:'physical', gold:600,
        skills: [
          { name:'溶岩拳',   type:'physical', mult:1.6 },
        ],
      },
      {
        name:'ファイアドレイク', hp:12000, atk:2340, def:2280, matk:900, mdef:2400, spd:3600, type:'physical', gold:550,
        skills: [
          { name:'炎爪連撃', type:'physical_multi', mult:0.8, hits:2 },
          { name:'業火ブレス', type:'magical',  mult:1.7 },
        ],
      },
    ],
    boss: {
      name:'深紅のサラマンダー', hp:200000, atk:3750, def:4200, matk:2100, mdef:3450, spd:3150, gold:25000, isBoss:true, type:'physical',
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
// 【変異】ボス（char_lv 500以上・エリア①〜④のボス出現時に置き換え）
//  原種を底上げしてエリア⑤級の強さに。Gold=4500(×2倍で9000=エリア⑤相当)。
//  血/心臓ドロップは selectedArea 基準なので据え置き（①ならスライムの血）。EXPは通常ボス据え置き。
// ============================================================
export const MUTANT_BOSSES = {
  1: { name:'【変異】ビッグスライム', hp:35000, atk:700, def:1300, matk:200, mdef:1200, spd:600, gold:6000, isBoss:true, type:'physical',
    skills:[
      { name:'粘殻砕き', type:'physical', mult:1.7 },
      { name:'酸蝕',     type:'debuff',   effect:'atkDown', rate:0.8, turns:3 },
      { name:'増殖再生', type:'heal',     rate:0.15 },
    ],
    specialMove:{ name:'融解の津波', type:'physical', mult:2.5 } },
  2: { name:'【変異】盗賊団のリーダー', hp:32000, atk:900, def:800, matk:200, mdef:850, spd:1300, gold:6000, isBoss:true, type:'physical',
    skills:[
      { name:'乱刃',     type:'physical_multi', mult:0.7, hits:3 },
      { name:'急所抉り', type:'physical', mult:2.0 },
      { name:'韋駄天',   type:'buff',     effect:'atkSpdUp', atkRate:1.3, spdRate:1.3, turns:3 },
    ],
    specialMove:{ name:'百花繚乱', type:'physical', mult:2.5 } },
  3: { name:'【変異】古代の番人', hp:36000, atk:600, def:1000, matk:1100, mdef:1000, spd:900, gold:6000, isBoss:true, type:'magical',
    skills:[
      { name:'古代の波動', type:'magical', mult:1.6 },
      { name:'停滞の呪',   type:'debuff',  effect:'spdDown', rate:0.7, turns:3 },
      { name:'守護結界',   type:'buff',    effect:'defMdefUp', defRate:1.4, mdefRate:1.4, turns:3 },
    ],
    specialMove:{ name:'古代神の裁き', type:'magical', mult:2.5 } },
  4: { name:'【変異】シーサーペント', hp:40000, atk:950, def:950, matk:650, mdef:900, spd:850, gold:6000, isBoss:true, type:'physical',
    skills:[
      { name:'大海嘯',   type:'physical', mult:1.8 },
      { name:'深海の渦', type:'debuff',   effect:'spdDown', rate:0.6, turns:3 },
      { name:'潮癒',     type:'heal',     rate:0.15 },
    ],
    specialMove:{ name:'大渦呑', type:'physical', mult:2.5 } },
}
export const MUTANT_BOSS_LV = 500  // 変異ボスの出現に必要な char_lv

// ============================================================
// クラス定義
// ============================================================
const JOB_BASE = {
  '戦士':    { hp_max:80, mp_max:10, atk:10, def:8,  matk:1,  mdef:3,  spd:5  },
  '弓使い':  { hp_max:60, mp_max:15, atk:8,  def:4,  matk:2,  mdef:3,  spd:10 },
  '魔法使い':{ hp_max:45, mp_max:50, atk:2,  def:2,  matk:14, mdef:4,  spd:4  },
  '僧侶':    { hp_max:55, mp_max:45, atk:2,  def:3,  matk:7,  mdef:12, spd:3  },
  '格闘家':  { hp_max:70, mp_max:10, atk:10, def:6,  matk:2,  mdef:5,  spd:7  },
  'サモナー':{ hp_max:50, mp_max:48, atk:2,  def:3,  matk:9,  mdef:8,  spd:5  },
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
  'サモナー':  { hp:10, mp:10, atk:0, def:1, matk:1, mdef:2, spd:1 },
  '精霊召喚士':{ hp:10, mp:10, atk:0, def:2, matk:2, mdef:2, spd:1 },
  '式神使い':  { hp:10, mp:10, atk:0, def:1, matk:3, mdef:1, spd:2 },
  'ブリーダー':{ hp:10, mp:10, atk:2, def:1, matk:2, mdef:1, spd:1 },
  'サイキッカー':{ hp:10, mp:5, atk:2, def:1, matk:2, mdef:1, spd:2 },
  '体術師':    { hp:20, mp:5,  atk:2, def:1, matk:1, mdef:1, spd:2 },
  '魔銃士':    { hp:10, mp:5,  atk:2, def:1, matk:2, mdef:1, spd:2 },
  'ギャンブラー':{ hp:10, mp:10, atk:1, def:2, matk:1, mdef:2, spd:1 },
  '魔法剣士':  { hp:10, mp:10, atk:2, def:1, matk:2, mdef:1, spd:1 },
  '聖騎士':    { hp:20, mp:5,  atk:1, def:2, matk:1, mdef:2, spd:1 },
  '竜騎士':    { hp:20, mp:5,  atk:1, def:2, matk:1, mdef:2, spd:1 },
}

export const JOB_LEVEL3_BONUS = {}

const INITIAL_CLASSES = ['戦士','弓使い','魔法使い','僧侶','格闘家','サモナー']
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
  '竜騎士':    { requiresItem:'dragon_knight_proof' },
  '精霊召喚士':{ requires:'サモナー' },
  '式神使い':  { requires:'サモナー' },
  'ブリーダー':{ requiresItem:'breeder_proof' },
}

// is_admin 限定先行公開の上位職（一般プレイヤーには転職候補に出さない）
// ※サモナー系3職は一般公開済みのため空。今後の先行公開職をここに入れる
const ADMIN_ONLY_CLASSES = new Set([])
// 再修練しても他クラスへ持ち越せない（＝他クラスで使用不可）スキルを持つクラス
const NON_CARRYOVER_CLASSES = new Set(['精霊召喚士','ブリーダー'])

const CLASS_LEVEL_CAP = {
  '戦士':100, '弓使い':100, '魔法使い':100, '僧侶':100, '格闘家':100, 'サモナー':100,
  '侍':100, '狂戦士':100, '狩人':100, '暗殺者':100,
  '元素使い':100, '死霊使い':100, '聖職者':100, '異端審問官':100, '賢者':100,
  'サイキッカー':100, '体術師':100, '魔銃士':100,
  'ギャンブラー':100,
  '魔法剣士':100, '聖騎士':100, '竜騎士':100,
  '精霊召喚士':100, '式神使い':100, 'ブリーダー':100,
}
// 再修練5回でそのクラスのレベルキャップが300に解放される
// 再修練強化の表示用説明（上から1段ずつ＝再修練1回ごとに解放）
export const RETRAINING_ENHANCEMENTS = {
  '侍': ['居合斬：倍率 ATK×1.3＋SPD×0.4', '断空：防御無視 50%', '居合の構え：セット中スキルが全て使用回数1のとき物理ダメ+40%（再修練+70%）', '明鏡止水：4ターン防御貫通30%', '月影：倍率 ATK×2.2'],
  '狂戦士': ['マッドラッシュ：倍率 ATK×1.9', 'すてみ：反動 5%', 'バーサク：与ダメ+15%・被ダメ+15%（再修練 与ダメ+40%・被ダメ+20%）', 'ブラッティロア：攻撃力上昇 ×1.3', 'フルブレイカー：防御無視 50%'],
  '狩人': ['毒矢：毒付与 100%', '三連射：倍率 ATK×0.6/hit', '鷹ノ目：命中+10（再修練 命中+20＋素早さの10%を攻撃に加算）', '狩猟本能：攻撃・素早さ ×2.0', '絶影狙撃：倍率 ATK×2.2'],
  '暗殺者': ['瞬歩瞬殺：出血確率 100%', '鬼影閃：出血確率 80%', '隠身：回避率+5%（再修練 クリ威力+25%）', '影歩き：効果8ターン', '急所突き：出血スタック×25%追撃（最大125%）→出血消費'],
  '元素使い': ['アクアショット：倍率 MATK×1.6', 'アースクエイク：スタン60%', '元素共鳴：別スキル連携で魔法ダメ+30%（再修練+50%）', 'ライトニングボルト：倍率 MATK×1.7', 'フレイムバースト：やけど100%'],
  '死霊使い': ['骸骨召喚：倍率 MATK×0.8', 'ソウルドレイン：倍率 MATK×1.4', '骸の壁：T1・4の倍数で被ダメ-30%（再修練 バリア中 防御・特防×2.0）', '腐敗霧：防御・特防低下 ×0.6', '幽世ノ門：効果5ターン'],
  '聖職者': ['ホーリーライト：30%で回復阻害50%', '奇跡：毎ターン最大HP15%回復', '神聖加護：回復量×1.5・MATK×1.1（再修練 回復量の100%を敵に反射）', '祈りの結界：6ターン', '神罰執行：倍率 MATK×2.0'],
  '異端審問官': ['粛清：倍率 MATK×1.4＋MDEF×0.4', '狂信：特殊攻撃×1.3 追加', '執行本能：与ダメ+20%・回復量×0.5（再修練 与ダメ+40%）', '聖なる裁き：倍率 MATK×1.9', '断罪：回復封じ 60%'],
  '賢者': ['サンダーストライク：倍率 MATK×1.6', 'マナボルト：消費MP×6', '天啓：MP消費×0.7・MATK×1.2（再修練 MP消費×0.5・MATK×1.4）', '氷の障壁：4ターン', 'メテオストライク：2〜5ヒット（2:30/3:40/4:20/5:10%）'],
  '聖騎士': ['ホーリーエッジ：倍率 ATK×1.7＋MATK×1.1', 'ディバインスマイト：与ダメ低下付与 50%', '聖騎士の心得：防御・特防×1.5（再修練×2.0）', '聖域展開：毎ターン最大HP10%回復', '神聖覚醒：追撃 防御・特防の60%'],
  '魔法剣士': ['雷光斬：倍率 ATK×1.4＋MATK×1.0', '閃光：連続強化×1.2（最大4重複）', '魔導剣術：特攻の30%を攻撃に変換（再修練 60%変換＋攻撃×1.1）', '魔剣開放：反動2ターンに短縮', 'エレメンタルエッジ：倍率 ATK×1.7＋MATK×1.7'],
  '魔銃士': ['魔弾：倍率 ATK×1.4＋MATK×1.3', '連装銃撃：命中+10', '精密照準：命中+10（再修練 同スキル連続で与ダメ+10%・クリ+2%／重複3）', '強化装填：5ターン', 'キャノネスチュームビンド：連続強化×1.3が最大2重複'],
  'サイキッカー': ['サイコショット：倍率 ATK×1.4＋MATK×1.1', 'マインドブレイク：40%でスタン', '第六感：命中+10（再修練 魔法ヒット毎に与ダメ+5%／重複6）', '精神集中：×1.8・3ターン', 'サイコブラスト：倍率 ATK×1.9＋MATK×1.5'],
  '体術師': ['半月蹴り：次のスキルの威力×1.8', '五連殺：各ヒット20%で出血', '闘争本能：HP50%以下+20%／HP30%以下+60%（再修練 +40%／+100%）', '破衝掌：防御無視 50%', '飛天三角蹴り：ミス撤廃＋各ヒットATK+0.1'],
  'ギャンブラー': ['ジャグリング：4ヒット', 'ラッキーダイス：×0.9〜2.2', 'ギャンブルボディ：被ダメ×0.7〜1.3（再修練 ×0.5〜1.2）', 'オールイン：効果・反動6ターン', 'ジャックポット：2倍確率10%'],
  '竜騎士': ['ドラゴンスラスト：防御貫通 30%', 'ドラゴンファング：倍率 0.9', '竜鱗の加護：防御×1.2・30%で5%軽減（再修練 防御×1.4・20%軽減）', 'ドラゴンロア：自身の攻撃力×1.3（3T）', '天墜竜閃：威力 4.5'],
  '精霊召喚士': ['精霊共鳴：最大MP+20%を追加', '召喚（1段目）：倍率 1.4→1.5', '召喚バフ：1.3→1.4倍／ノクスの魔法防御貫通 5%→8%', '2段目スキル：倍率すべて+0.1', '3段目スキル：倍率すべて+0.2'],
  '式神使い': ['式神召喚：式神の毎ターン攻撃 特殊攻撃力×0.5→0.8', '符術・式打ち：特殊攻撃力×0.8→0.9', '呪符・魂削り：特殊防御30%ダウン(3T)→35%ダウン(4T)', '陰陽結界：被ダメ20%減・50%回復→30%減・60%回復', '禁術・神降ろし：特殊攻撃力×2.2→2.4'],
  'ブリーダー': ['ペット召喚：ペットの攻撃に種族別の追加効果を付与', '攻撃して！：倍率 ×3.0→×3.5', '一緒に頑張ろう！：効果3ターン→6ターン', '休憩しよう！：1ターン被ダメ30%カットを追加', 'やっちゃえ！：倍率 ×5.0→×6.0'],
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

// ★2026-06-20: 全プレイヤー公開。必要EXPは「半減＋10」（サーバー calc_exp_next と一致させること）
// 第2引数 isAdmin は後方互換で残置（値に影響しない）
export const calcExpNext = (lv, _isAdmin = false) => {
  let base
  if (lv >= 100) {
    // LV100超（再修練でキャップ300になったクラス）の必要経験値
    base = lv <= 150 ? 150 : lv <= 200 ? 160 : lv <= 250 ? 170 : 180
  } else {
    const lvInBlock = (lv - 1) % 100
    base = lvInBlock < 9 ? 80 : lvInBlock < 29 ? 100 : lvInBlock < 59 ? 120 : 140
  }
  return Math.floor(base / 2) + 10
}

const WEAPON_TYPE_GROUP = {
  sword:'physical', axe:'physical', spear:'physical', bow:'physical', dagger:'physical',
  knuckle:'physical', gun:'physical', katana:'physical',
  staff:'magical', wand:'magical', tome:'magical', orb:'magical',
}
const getWeaponGroup = (weaponType) => WEAPON_TYPE_GROUP[weaponType] || 'physical'

const getProfPrefix = (profLv) => {
  // 熟練度LVは300以上も青天井だが、表示ランクは極(300)で打ち止め（覇/神/伝説は廃止）
  if (profLv >= 300)  return '【極】'
  if (profLv >= 200)  return '【真】'
  if (profLv >= 100)  return '【改】'
  return ''
}

// calcEffectiveStats は lib/stats.js に一本化（上部で import＋再export 済み）。
// 旧Game.jsxローカル版は釣りボーナス(fishing_*)が抜けており、表示系(Profile/ランキング/詳細)と
// 戦闘系で値がズレていたため削除した。

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
    if (effect === 'battle_start_ailment_shield') { newBuffs.ailmentShield = { charges:1 }; logs.push({ text:`🛡 哭雨の羽衣の加護！ 状態異常を1回無効化する！`, color:'#66ccff' }) }
  }
  return newBuffs
}

// ============================================================
// 哭雨の羽衣: 状態異常無効バフ（全戦闘エンジン共用ヘルパー）
// ============================================================
export const AILMENT_KEYS = ['paralysis','burn','poison','severePoisoin','stun','bleed','healSeal','healBlock','curseDmg']
// 差分検知型: prevBuffs に無かった状態異常が newBuffs に新規付与されていたら1つ無効化して消費
export const consumeAilmentShield = (prevBuffs, newBuffs, logs) => {
  if (!(newBuffs.ailmentShield?.charges > 0)) return
  const got = AILMENT_KEYS.find(k => newBuffs[k] && !prevBuffs?.[k])
  if (got) {
    delete newBuffs[got]
    delete newBuffs.ailmentShield
    logs.push({ text:`🛡 哭雨の羽衣の加護！ 状態異常を無効化した！`, color:'#66ccff' })
  }
}
// 直接付与型: 付与直前に呼ぶ。バフが残っていれば消費して true（呼び出し側は付与をスキップ）
export const ailmentShieldBlocks = (playerBuffs, logs) => {
  if (!(playerBuffs.ailmentShield?.charges > 0)) return false
  delete playerBuffs.ailmentShield
  logs.push({ text:`🛡 哭雨の羽衣の加護！ 状態異常を無効化した！`, color:'#66ccff' })
  return true
}

// ============================================================
// プレイヤースキル実行
// ============================================================
export const executeSkill = (skill, eff, profile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkill = '') => {
  const result = { dmg:0, heal:0, log:'', newEnemyBuffs:{ ...enemyBuffs }, newPlayerBuffs:{ ...playerBuffs }, selfDmg:0, bonusCritRate:0 }
  const am = isArtifact ? 1.3 : 1.0
  // 再修練強化：現在クラスがそのスキルのクラスと一致する場合のみ、再修練回数ぶん段階強化が乗る
  const rt = (profile?.class === skill?.class_name) ? ((profile?.retraining||{})[skill?.class_name]||0) : 0
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
      result.hitDmgs = [ma1, ma2]
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
    case '明鏡止水':    result.newPlayerBuffs.atkUp={turns:4,rate:1.5}; result.newPlayerBuffs.hitBonus={turns:4,value:5}; if (rt>=4) result.newPlayerBuffs.mukyoPen={turns:4,rate:0.30}; result.log = `✨ 明鏡止水！ 4ターンの間攻撃力が上昇し命中率UP！${rt>=4?' 防御貫通30%獲得！':''}`; break
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
      result.hitDmgs = [s1, s2, s3]
      result.log = `🏹 三連射！ ${enemy.name}に${s1}の物理ダメージ！${s2}の物理ダメージ！${s3}の物理ダメージ！`; break
    }
    case '狩猟本能':    { const huntRate = rt>=4?2.0:1.5; result.newPlayerBuffs.atkUp={turns:4,rate:huntRate}; result.newPlayerBuffs.spdUp={turns:4,rate:huntRate}; result.log = `🌲 狩猟本能！ 4ターンの間、攻撃力・素早さが上昇！`; break }
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
        result.followup = { dmg: Math.floor(eff.spd*0.5*am*(0.85+Math.random()*0.3)), label:'影歩き' }
      }
      const bleedHit4 = Math.random()*100 < (rt>=2?80:40)
      if (bleedHit4) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `🌙 鬼影閃！ ${enemy.name}に${result.dmg}の物理ダメージ！${bleedHit4 ? ` ${enemy.name}は出血した！` : ''}`
      break
    }
    case '影歩き':      { const swT = rt>=4?8:4; result.newPlayerBuffs.spdUp={turns:swT,rate:1.5}; result.newPlayerBuffs.evasion={turns:swT,rate:0.10}; result.log = `🌙 影歩き！ ${swT}ターンの間、素早さ大幅上昇・回避率UP！`; break }
    case '急所突き': {
      result.dmg = Math.floor(eff.atk*1.8*am); result.bonusCritRate=30
      let kyushoBleed = ''
      if (rt>=5) {
        const stacks = enemyBuffs.bleed?.stacks || 0
        if (stacks > 0) {
          const bonusRate = Math.min(stacks*0.25, 1.25)  // 5スタックで+125%
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
      const curseDmgAmt = Math.floor(eff.matk*0.8*am)
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
      result.hitDmgs = hitDmgs
      result.log = `☄ メテオストライク！ ${enemy.name}に${hitDmgs.map(d=>`${d}の特殊ダメージ`).join('！')}！${meteoBurned ? ' やけど状態！' : ''}`
      break
    }
    // ── 格闘家 ──
    case '打撃':   result.dmg = Math.floor(eff.atk*1.2*am); result.log = `👊 打撃！ ${enemy.name}に${result.dmg}の物理ダメージ！`; break
    case '連打': {
      const c1=Math.floor(eff.atk*0.4*am*r()), c2=Math.floor(eff.atk*0.4*am*r()), c3=Math.floor(eff.atk*0.4*am*r())
      result.dmg = c1+c2+c3
      result.hitDmgs = [c1, c2, c3]
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
      const psA = rt>=1?1.4:1.2, psC = rt>=1?1.1:1.0
      result.dmg = Math.floor((eff.atk*psA+eff.matk*psC)*am)
      result.log = `🔮 サイコショット！ ${enemy.name}に${result.dmg}の特殊ダメージ！`; break
    }
    case 'マインドブレイク': {
      result.dmg = Math.floor((eff.atk*1.2+eff.matk*1.3)*am)
      let mbStun = ''
      if (rt>=2) {
        const sr_mb = enemyBuffs.stunResist ?? 1.0
        if (Math.random()*100 < 40 * sr_mb) { result.newEnemyBuffs.stun={turns:1}; result.newEnemyBuffs.stunResist=sr_mb*0.5; mbStun=' スタン！' }
      }
      result.log = `🔮 マインドブレイク！ ${enemy.name}に${result.dmg}の特殊ダメージ！${mbStun}`; break
    }
    case '第六感':    result.log = `🔮 第六感【パッシブ】 命中+10（再修練：魔法攻撃ヒット毎に与ダメ+5%・最大6）`; break
    case '精神集中': { const ssT = rt>=4?3:2; const ssR = rt>=4?1.8:1.6; result.newPlayerBuffs.atkUp={turns:ssT,rate:ssR}; result.newPlayerBuffs.matkUp={turns:ssT,rate:ssR}; result.log = `🔮 精神集中！ ${ssT}ターンの間、攻撃力・特殊攻撃力が大幅上昇！`; break }
    case 'サイコブラスト': {
      const pbA = rt>=5?1.9:1.7, pbC = rt>=5?1.5:1.4
      result.dmg = Math.floor((eff.atk*pbA+eff.matk*pbC)*am)
      result.log = `🔮 サイコブラスト！ ${enemy.name}に${result.dmg}の特殊ダメージ！`; break
    }
    // ── 体術師 ──
    case '半月蹴り':   result.dmg = Math.floor(eff.atk*1.4*am); if (rt>=1) result.newPlayerBuffs.nextSkillBoost={rate:1.8}; result.log = `🦵 半月蹴り！ ${enemy.name}に${result.dmg}の物理ダメージ！${rt>=1?' 次の一撃を強化！':''}`; break
    case '五連殺': {
      const ds = Array.from({length:5}, ()=>Math.floor(eff.atk*0.3*am*r()))
      result.dmg = ds.reduce((a,b)=>a+b,0)
      if (rt>=2) {
        let added = 0
        for (let i=0;i<5;i++) { if (Math.random()*100 < 20) added++ }
        if (added > 0) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+added), lastTurn:0 } }
      }
      result.hitDmgs = ds
      result.log = `🦵 五連殺！ ${enemy.name}に${ds.map(d=>`${d}の物理ダメージ`).join('！')}！`; break
    }
    case '闘争本能': result.log = `🔥 闘争本能【パッシブ】 HP50%以下+20%／HP30%以下+60%（再修練：+40%／+100%）`; break
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
      if (Math.random() < htMiss) { result.dmg=h1; result.hitDmgs=[h1]; result.log=`🦵 飛天三角蹴り！ ${h1}の物理ダメージ！ 2撃目が外れた！`; break }
      const h2 = Math.floor(eff.atk*(0.8+htAdd)*am*r())
      if (Math.random() < htMiss) { result.dmg=h1+h2; result.hitDmgs=[h1,h2]; result.log=`🦵 飛天三角蹴り！ ${h1}の物理ダメージ！${h2}の物理ダメージ！ 3撃目が外れた！`; break }
      const h3 = Math.floor(eff.atk*(1.2+htAdd)*am*r())
      result.dmg = h1+h2+h3; result.hitDmgs=[h1,h2,h3]; result.log=`🦵 飛天三角蹴り！ ${h1}の物理ダメージ！${h2}の物理ダメージ！${h3}の物理ダメージ！`; break
    }
    // ── 魔銃士 ──
    case '魔弾': {
      const mdA = rt>=1?1.4:1.2, mdC = rt>=1?1.3:1.2
      result.dmg = Math.floor((eff.atk*mdA+eff.matk*mdC)*am)
      result.log = `🔫 魔弾！ ${enemy.name}に${result.dmg}の特殊ダメージ！`; break
    }
    case '連装銃撃': {
      const lzC = 0.5
      const gs = Array.from({length:4}, ()=>Math.floor((eff.atk*lzC+eff.matk*lzC)*am*r()))
      result.dmg = gs.reduce((a,b)=>a+b,0)
      result.hitDmgs = gs
      result.log = `🔫 連装銃撃！ ${enemy.name}に${gs.map(d=>`${d}の特殊ダメージ`).join('！')}！`; break
    }
    case '精密照準':   result.log = `🔫 精密照準【パッシブ】 命中+10（再修練：同スキル連続で与ダメ+10%・クリ+2%・最大3）`; break
    case '強化装填':   { const klT = rt>=4?5:3; result.newPlayerBuffs.atkUp={turns:klT,rate:1.7}; result.newPlayerBuffs.matkUp={turns:klT,rate:1.7}; result.log = `🔫 強化装填！ ${klT}ターンの間、攻撃力・特殊攻撃力が大幅上昇！`; break }
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
      const cbC = 1.5
      result.dmg = Math.floor((eff.atk*cbC+eff.matk*cbC)*am*cannonMult)
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
    case 'ギャンブルボディ': result.log = `🎭 ギャンブルボディ【パッシブ】 被ダメ×0.7〜1.3（再修練：×0.5〜1.2）`; break
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
      const jpC = 1.7
      result.dmg = Math.floor((eff.atk*jpC + eff.matk*jpC) * am)
      const jackpot = Math.random()*100 < (rt>=5?10:5)
      if (jackpot) result.dmg *= 2
      result.log = `🎰 ジャックポット！ ${enemy.name}に${result.dmg}のダメージ！${jackpot ? ' 💥 JACKPOT！ ダメージ2倍！！' : ''}`; break
    }
    // ── 魔法剣士 ──
    case '雷光斬': {
      const raiAtkMult = rt>=1?1.4:1.2  // 再修練1段でATK倍率1.2→1.4（素はそのまま）
      result.dmg = Math.floor((eff.atk*raiAtkMult + eff.matk*1.0)*am)
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
      const flC = 1.0
      result.dmg = Math.floor((eff.atk*flC + eff.matk*flC)*am*flashMult)
      result.newPlayerBuffs.flashCombo = { count: flashCount > 0 ? flashCount : 1 }
      const comboText = flashCount > 0 ? ` 連続${flashCount+1}回（×${flashMult.toFixed(2)}）！` : ''
      result.log = `✨⚔ 閃光！ ${enemy.name}に${result.dmg}のダメージ！${comboText}`
      break
    }
    case '魔導剣術': result.log = `⚔ 魔導剣術【パッシブ】 特殊攻撃力の30%を攻撃力に変換（再修練：60%変換＋攻撃×1.1）`; break
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
      const eeMult = rt>=5?1.7:1.5  // 再修練5段で倍率1.5→1.7（素はそのまま）
      result.dmg = Math.floor((eff.atk*eeMult + eff.matk*eeMult)*am)
      const elemHit = Math.random()*100 < 36
      if (elemHit) {
        // やけど・麻痺・スタンを均等抽選（スタン2倍化：発動率36%×1/3で各12%）
        const elemRoll = Math.random()*100
        let statusName
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
      const heA = rt>=1?1.7:1.5, heC = rt>=1?1.1:1.0
      result.dmg = Math.floor((eff.atk*heA + eff.matk*heC)*am)
      result.log = `✨⚔ ホーリーエッジ！ ${enemy.name}に${result.dmg}のダメージ！`; break
    }
    case 'ディバインスマイト': {
      result.dmg = Math.floor((eff.atk*1.2 + eff.matk*1.2)*am)
      const dmgDownHit = Math.random()*100 < (rt>=2?50:30)
      if (dmgDownHit) result.newEnemyBuffs.dmgDown = { turns:3, rate:0.85 }
      result.log = `✨⚔ ディバインスマイト！ ${enemy.name}に${result.dmg}のダメージ！${dmgDownHit ? ' 3Tの間、相手の与ダメ-15%！' : ''}`
      break
    }
    case '聖騎士の心得': result.log = `🛡 聖騎士の心得【パッシブ】 防御力・特殊防御力が1.5倍（再修練：2.0倍）`; break
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
    // ── 竜騎士 ──
    case 'ドラゴンスラスト': {
      result.dmg = Math.floor(eff.atk*1.5*am)
      result.defPen = rt>=1?0.30:0.10  // 防御貫通10%（再修練1段で30%）
      result.log = `🐉 ドラゴンスラスト！ ${enemy.name}に${result.dmg}の物理ダメージ！（防御貫通）`
      break
    }
    case 'ドラゴンファング': {
      const dfMult = rt>=2?0.9:0.8  // 倍率0.8（再修練2段で0.9）
      const h1=Math.floor(eff.atk*dfMult*am*r()), h2=Math.floor(eff.atk*dfMult*am*r())
      result.dmg = h1+h2
      result.hitDmgs = [h1, h2]
      result.defPen = 0.20  // 防御貫通20%
      result.log = `🐉 ドラゴンファング！ ${enemy.name}に${h1}・${h2}の物理ダメージ！（2連撃・防御貫通）`
      break
    }
    case '竜鱗の加護': result.log = `🛡 竜鱗の加護【パッシブ】 防御力1.2倍・被ダメ時30%で5%軽減（再修練：防御1.4倍・20%軽減）`; break
    case 'ドラゴンロア': {
      result.newEnemyBuffs.atkDown = { turns:3, rate:0.7 }   // 攻撃・特攻を30%減（3T）
      result.newEnemyBuffs.matkDown = { turns:3, rate:0.7 }
      if (rt>=4) result.newPlayerBuffs.atkUp = { turns:3, rate:1.3 }  // 再修練4段：自身の攻撃力×1.3（3T）
      result.log = `🐉 ドラゴンロア！ 3ターンの間、${enemy.name}の攻撃・特殊攻撃を低下させた！${rt>=4?' 自身の攻撃力上昇！':''}`
      break
    }
    case '天墜竜閃': {
      if (playerBuffs.tenkaiCharge?.turns > 0) {
        // 解放ターン：大ダメージ＋防御貫通30%
        result.dmg = Math.floor(eff.atk*(rt>=5?4.5:4.0)*am)  // 威力4.0（再修練5段で4.5）
        result.defPen = 0.3
        result.newPlayerBuffs.tenkaiCharge = undefined // 溜め解除
        result.log = `🐉💥 天墜竜閃・解放！ ${enemy.name}に${result.dmg}の物理ダメージ！（防御貫通）`
      } else {
        // 溜めターン：1ターン受けダメ-20%＆待機（追加行動なし）
        result.newPlayerBuffs.dmgReduce = { turns:1, rate:0.8 }
        result.newPlayerBuffs.tenkaiCharge = { turns:2 } // 次ターンに解放（ターン経過で1減るので2を入れる）
        result.charging = true
        result.log = `🐉 天墜竜閃！ 力を溜めている…（次ターンに解き放つ／受けるダメージ-20%）`
      }
      break
    }
    // ── サモナー ──
    case 'オオカミ召喚': {
      // 物理ダメージ（敵DEFで軽減）だが火力参照は特殊攻撃力
      result.dmg = Math.floor(eff.matk*1.1*am)
      result.physScaleMatk = true
      const wolfBleed = Math.random()*100 < 30
      if (wolfBleed) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
      result.log = `🐺 オオカミ召喚！ ${enemy.name}に${result.dmg}の物理ダメージ！${wolfBleed ? ` ${enemy.name}は出血した！` : ''}`
      break
    }
    case '小悪魔召喚': {
      result.dmg = Math.floor(eff.matk*1.4*am)
      result.log = `😈 小悪魔召喚！ ${enemy.name}に${result.dmg}の特殊ダメージ！`; break
    }
    case '魔力供給': {
      result.newPlayerBuffs.regenMp = { turns:4, rate:0.2 }
      result.log = `🔵 魔力供給！ 4ターンの間、毎ターン最大MPの20%が回復する！`; break
    }
    case 'グリフォン召喚': {
      result.dmg = Math.floor(eff.matk*1.3*am)
      result.newPlayerBuffs.spdUp = { turns:2, rate:1.2 }
      result.log = `🦅 グリフォン召喚！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 2ターンの間、素早さが20%上昇！`; break
    }
    case '群れの号令': {
      const swarmHits = Math.random() < 0.5 ? 3 : 4
      const swarm = Array.from({length:swarmHits}, ()=>Math.floor(eff.matk*(0.4+Math.random()*0.1)*am*r()))
      result.dmg = swarm.reduce((a,b)=>a+b,0)
      result.hitDmgs = swarm
      result.log = `🐾 群れの号令！ ${enemy.name}に${swarm.map(d=>`${d}の特殊ダメージ`).join('！')}！`; break
    }
    // ── 精霊召喚士（連続使用で段階上昇）──
    case 'サラマンド': {
      const { tier, newCount } = spiritComboState('サラマンド', playerBuffs)
      if (tier === 0) {
        result.dmg = Math.floor(eff.matk*(rt>=2?1.5:1.4)*am)
        result.newPlayerBuffs.matkUp = { turns:3, rate:(rt>=3?1.4:1.3) }
        result.log = `🔥 火精召喚：サラマンド！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 3ターンの間、特殊攻撃力が上昇！`
      } else if (tier === 1) {
        result.dmg = Math.floor(eff.matk*(1.8+(rt>=4?0.1:0))*am)
        const burn = Math.random()*100 < 50
        if (burn) result.newEnemyBuffs.burn = { turns:5, dmgRate:0.02 }
        result.log = `🔥 紅蓮の息吹！ ${enemy.name}に${result.dmg}の特殊ダメージ！${burn?' やけど状態！':''}`
      } else {
        result.dmg = Math.floor(eff.matk*(2.2+(rt>=5?0.2:0))*am)
        const burn = Math.random()*100 < 80
        if (burn) result.newEnemyBuffs.burn = { turns:5, dmgRate:0.02 }
        result.log = `🔥 インフェルノブレス！ ${enemy.name}に${result.dmg}の特殊ダメージ！${burn?' やけど状態！':''}`
      }
      result.newPlayerBuffs.spiritCombo = { name:'サラマンド', count:newCount, tripled: newCount%3===0 }
      break
    }
    case 'ウンディーネ': {
      const { tier, newCount } = spiritComboState('ウンディーネ', playerBuffs)
      if (tier === 0) {
        result.dmg = Math.floor(eff.matk*(rt>=2?1.5:1.4)*am)
        result.newPlayerBuffs.mdefUp = { turns:3, rate:(rt>=3?1.4:1.3) }
        result.log = `🌊 水精召喚：ウンディーネ！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 3ターンの間、特殊防御力が上昇！`
      } else if (tier === 1) {
        result.dmg = Math.floor(eff.matk*(1.4+(rt>=4?0.1:0))*am)
        const buffKeys = Object.keys(enemyBuffs).filter(k => enemyBuffs[k]?.turns > 0)
        let dispelTxt = ''
        if (buffKeys.length > 0) {
          const removeKey = buffKeys[Math.floor(Math.random()*buffKeys.length)]
          result.newEnemyBuffs[removeKey] = { turns:0, rate:1 }
          dispelTxt = ' 相手のバフを1つ消去！'
        }
        result.log = `🌊 アクアレイン！ ${enemy.name}に${result.dmg}の特殊ダメージ！${dispelTxt}`
      } else {
        // 静水の加護：攻撃せず4ターン被ダメージ30%減
        result.newPlayerBuffs.dmgReduce = { turns:4, rate:0.7 }
        result.log = `🌊 静水の加護！ 4ターンの間、受けるダメージが30%減少！`
      }
      result.newPlayerBuffs.spiritCombo = { name:'ウンディーネ', count:newCount, tripled: newCount%3===0 }
      break
    }
    case 'シルフ': {
      const { tier, newCount } = spiritComboState('シルフ', playerBuffs)
      if (tier === 0) {
        result.dmg = Math.floor(eff.matk*(rt>=2?1.5:1.4)*am)
        result.newPlayerBuffs.spdUp = { turns:3, rate:(rt>=3?1.4:1.3) }
        result.log = `🌪 風精召喚：シルフ！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 3ターンの間、素早さが上昇！`
      } else if (tier === 1) {
        // 特攻参照だが物理攻撃（敵DEFのみで軽減）
        result.dmg = Math.floor(eff.matk*(1.7+(rt>=4?0.1:0))*am)
        result.physScaleMatk = true
        const bleed = Math.random()*100 < 30
        if (bleed) { const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 } }
        result.log = `🌪 翠嵐の刃！ ${enemy.name}に${result.dmg}の物理ダメージ！${bleed?` ${enemy.name}は出血した！`:''}`
      } else {
        result.dmg = Math.floor(eff.matk*(2.0+(rt>=5?0.2:0))*am)
        result.physScaleMatk = true
        const b = enemyBuffs.bleed; result.newEnemyBuffs.bleed = { stacks:Math.min(5,(b?.stacks||0)+1), lastTurn:0 }
        result.log = `🌪 テンペストエッジ！ ${enemy.name}に${result.dmg}の物理ダメージ！ ${enemy.name}は出血した！`
      }
      result.newPlayerBuffs.spiritCombo = { name:'シルフ', count:newCount, tripled: newCount%3===0 }
      break
    }
    case 'ノーム': {
      const { tier, newCount } = spiritComboState('ノーム', playerBuffs)
      if (tier === 0) {
        result.dmg = Math.floor(eff.matk*(rt>=2?1.5:1.4)*am)
        result.newPlayerBuffs.defUp = { turns:3, rate:(rt>=3?1.4:1.3) }
        result.log = `⛰ 土精召喚：ノーム！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 3ターンの間、防御力が上昇！`
      } else if (tier === 1) {
        result.dmg = Math.floor(eff.matk*(1.7+(rt>=4?0.1:0))*am)
        const sr = enemyBuffs.stunResist ?? 1.0
        const stun = Math.random()*100 < 30 * sr
        if (stun) { result.newEnemyBuffs.stun = { turns:1 }; result.newEnemyBuffs.stunResist = sr*0.5 }
        result.log = `⛰ 岩霊の鉄槌！ ${enemy.name}に${result.dmg}の特殊ダメージ！${stun?' スタン！':''}`
      } else {
        // 岩石砲：命中90%（10%で外れる）
        if (Math.random() < 0.1) { result.dmg = 0; result.log = `⛰ 岩石砲！ しかし外れた！` }
        else { result.dmg = Math.floor(eff.matk*(2.5+(rt>=5?0.2:0))*am); result.log = `⛰ 岩石砲！ ${enemy.name}に${result.dmg}の特殊ダメージ！` }
      }
      result.newPlayerBuffs.spiritCombo = { name:'ノーム', count:newCount, tripled: newCount%3===0 }
      break
    }
    case 'ルミナ': {
      const { tier, newCount } = spiritComboState('ルミナ', playerBuffs)
      if (tier === 0) {
        result.dmg = Math.floor(eff.matk*(rt>=2?1.5:1.4)*am)
        result.newPlayerBuffs.healUp = { turns:3, rate:(rt>=3?1.4:1.3) }
        result.log = `🌟 光精召喚：ルミナ！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 3ターンの間、回復力が上昇！`
      } else if (tier === 1) {
        result.dmg = Math.floor(eff.matk*1.0*am)
        result.heal = Math.floor(profile.hp_max*0.15)
        result.log = `🌟 浄化の輝き！ ${enemy.name}に${result.dmg}の特殊ダメージ！ HPを${result.heal}回復！`
      } else {
        result.dmg = Math.floor(eff.matk*(2.0+(rt>=5?0.2:0))*am)
        result.heal = Math.floor(result.dmg*0.5)
        result.log = `🌟 ルミナ・レイ！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 与えたダメージの半分を回復！`
      }
      result.newPlayerBuffs.spiritCombo = { name:'ルミナ', count:newCount, tripled: newCount%3===0 }
      break
    }
    case 'ノクス': {
      const { tier, newCount } = spiritComboState('ノクス', playerBuffs)
      if (tier === 0) {
        result.dmg = Math.floor(eff.matk*(rt>=2?1.5:1.4)*am)
        result.newPlayerBuffs.spiritMdefPen = { turns:3, rate:(rt>=3?0.08:0.05) }
        result.log = `🌑 闇精召喚：ノクス！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 3ターンの間、魔法防御貫通を得る！`
      } else if (tier === 1) {
        result.dmg = Math.floor(eff.matk*(1.5+(rt>=4?0.1:0))*am)
        result.newEnemyBuffs.dmgDown = { turns:3, rate:0.9 }
        result.log = `🌑 深淵の囁き！ ${enemy.name}に${result.dmg}の特殊ダメージ！ 3ターンの間、相手の与ダメージ10%減！`
      } else {
        result.dmg = Math.floor(eff.matk*(2.2+(rt>=5?0.2:0))*am)
        result.mdefPen = 0.3
        result.log = `🌑 ノクターン！ ${enemy.name}の魔法防御を貫通し${result.dmg}の特殊ダメージ！`
      }
      result.newPlayerBuffs.spiritCombo = { name:'ノクス', count:newCount, tripled: newCount%3===0 }
      break
    }
    // ── 式神使い ──
    case '符術・式打ち': {
      const m = rt>=2 ? 0.9 : 0.8
      const h1 = Math.floor(eff.matk*m*am*r()), h2 = Math.floor(eff.matk*m*am*r())
      result.dmg = h1+h2
      result.hitDmgs = [h1, h2]
      result.log = `📜 符術・式打ち！ ${enemy.name}に${h1}・${h2}の特殊ダメージ！`
      break
    }
    case '呪符・魂削り': {
      result.dmg = Math.floor(eff.matk*1.7*am)
      const turns = rt>=3 ? 4 : 3
      const rate = rt>=3 ? 0.65 : 0.7
      result.newEnemyBuffs.mdefDown = { turns, rate }
      result.log = `📜 呪符・魂削り！ ${enemy.name}に${result.dmg}の特殊ダメージ！ ${turns}ターンの間、特殊防御力を${Math.round((1-rate)*100)}%低下！`
      break
    }
    case '陰陽結界': {
      const reduce = rt>=4 ? 0.3 : 0.2
      const healRate = rt>=4 ? 0.6 : 0.5
      result.newPlayerBuffs.dmgReduce = { turns:3, rate: 1 - reduce }
      result.newPlayerBuffs.onmyoHeal = { turns:3, reduce, healRate }
      result.log = `🔯 陰陽結界！ 3ターンの間、受けるダメージを${Math.round(reduce*100)}%軽減し、軽減分の${Math.round(healRate*100)}%を回復！`
      break
    }
    case '禁術・神降ろし': {
      if (playerBuffs.kinjutsuLock) {
        result.dmg = 0
        result.log = `📿 禁術・神降ろし！ しかし連続では使えず、失敗した！`
      } else {
        result.dmg = Math.floor(eff.matk*(rt>=5?2.4:2.2)*am)
        result.newPlayerBuffs.kinjutsuLock = true
        result.log = `📿 禁術・神降ろし！ ${enemy.name}に${result.dmg}の特殊ダメージ！`
      }
      break
    }
    default: result.dmg = Math.max(1,eff.atk*am); result.log = `攻撃！ ${enemy.name}に${result.dmg}ダメージ！`
  }
  // 精霊召喚士コンボ：精霊召喚以外のスキルを使ったらコンボをリセット
  if (!SPIRIT_SUMMONS.has(skill.name) && playerBuffs.spiritCombo) {
    result.newPlayerBuffs.spiritCombo = undefined
  }
  // 禁術・神降ろし：他スキルを使ったら連続使用ロックを解除
  if (skill.name !== '禁術・神降ろし' && playerBuffs.kinjutsuLock) {
    result.newPlayerBuffs.kinjutsuLock = undefined
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
export const executeEnemySkill = (skill, enemy, enemyHp, enemyMaxHp, playerHp, profileHpMax, playerBuffs, enemyBuffs, logs, eff, playerDefMult = 1, incomingDmgMult = 1) => {
  let dmgToPlayer = 0
  let healEnemy = 0
  const newPlayerBuffs = { ...playerBuffs }
  const newEnemyBuffs = { ...enemyBuffs }

  const enemyDmgDown = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
  switch (skill.type) {
    case 'physical': {
      const pDef = Math.max(1, (eff?.def || 0) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * playerDefMult)
      const base = Math.floor(enemy.atk * enemy.atk / Math.max(1, enemy.atk + pDef))
      const rawDmg = Math.max(1, Math.floor(base * skill.mult))
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const defRankRed = calcDefReduction(eff?.def || 0)
      dmgToPlayer = Math.floor(rawDmg * enemyDmgDown * dmgReduceRate * (1 - defRankRed) * incomingDmgMult * (0.9 + Math.random() * 0.2))
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
      const pMdef = Math.max(1, (eff?.mdef || 0) * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1) * playerDefMult)
      const eMatk = enemy.matk || enemy.atk
      const base = Math.floor(eMatk * eMatk / Math.max(1, eMatk + pMdef))
      const rawDmg = Math.max(1, Math.floor(base * skill.mult))
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const defRankRed = calcDefReduction(eff?.mdef || 0)
      dmgToPlayer = Math.floor(rawDmg * enemyDmgDown * dmgReduceRate * (1 - defRankRed) * incomingDmgMult * (0.9 + Math.random() * 0.2))
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
      const pMdef2 = Math.max(1, (eff?.mdef || 0) * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1) * playerDefMult)
      const eMatk2 = enemy.matk || enemy.atk
      const base2 = Math.floor(eMatk2 * eMatk2 / Math.max(1, eMatk2 + pMdef2))
      const perHit2 = Math.max(1, Math.floor(base2 * skill.mult))
      const dmgReduceRate2 = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const defRankRed2 = calcDefReduction(eff?.mdef || 0)
      dmgToPlayer = Math.floor(perHit2 * (skill.hits||1) * enemyDmgDown * dmgReduceRate2 * (1 - defRankRed2) * incomingDmgMult * (0.9 + Math.random() * 0.2))
      logs.push({ text:`✨ ${enemy.name}の「${skill.name}」！ ${perHit2}×${skill.hits}回＝${dmgToPlayer}の魔法ダメージ！`, color:'#cc44ff' })
      break
    }
    case 'physical_multi': {
      const pDef = Math.max(1, (eff?.def || 0) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * playerDefMult)
      const base = Math.floor(enemy.atk * enemy.atk / Math.max(1, enemy.atk + pDef))
      const perHit = Math.max(1, Math.floor(base * skill.mult))
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const defRankRed = calcDefReduction(eff?.def || 0)
      dmgToPlayer = Math.floor(perHit * (skill.hits||1) * enemyDmgDown * dmgReduceRate * (1 - defRankRed) * incomingDmgMult * (0.9 + Math.random() * 0.2))
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
  // 哭雨の羽衣: 状態異常無効バフ（1回）。新規付与された状態異常を1つ無効化
  consumeAilmentShield(playerBuffs, newPlayerBuffs, logs)
  // アクアクラウン(真化): 状態異常になる確率-eff.evoAilmentResist%。新規付与された状態異常を確率で無効化
  if ((eff?.evoAilmentResist || 0) > 0) {
    const ailKeys2 = ['paralysis','burn','poison','severePoisoin','stun','bleed','healSeal','curseDmg']
    const got2 = ailKeys2.find(k => newPlayerBuffs[k] && !playerBuffs[k])
    if (got2 && Math.random()*100 < eff.evoAilmentResist) {
      delete newPlayerBuffs[got2]
      logs.push({ text:`💧 アクアクラウンの真化！ 状態異常を防いだ！`, color:'#66ccff' })
    }
  }
  return { dmgToPlayer, healEnemy, newPlayerBuffs, newEnemyBuffs }
}

// デイリーダンジョンの「日付」文字列：朝5時(JST)を境にリセット
// JST(+9h)から5h引いた基準で日付を算出 → JST05:00でロールオーバー
const getDungeonDateStr = () => new Date(Date.now() + (9 - 5)*60*60*1000).toISOString().slice(0, 10)

// デイリーダンジョン：種類ごとに1日5回。type→DB列名／表示名／一覧
const DUNGEON_DAILY_LIMIT = 5
// ★is_admin限定先行: 出撃CD20秒化に伴いデイリーダンジョンは管理者のみ1日3回（一般は従来5回）。
//   回数が5→3に減るぶん、1回あたりの報酬を×5/3にして1日の総取得量を維持（gold/expはサーバー上限も要調整）。
const dungeonDailyLimitFor = (_p) => 3   // ★2026-06-20: 全プレイヤー公開（1日3回）
const DUNGEON_REWARD_MULT = 5 / 3   // 管理者の1回あたり報酬倍率（3回で従来5回ぶん相当）
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
  { key:'past',   label:'その他',       icon:'🗂' },
]
// カテゴリ正規化：未設定や未知カテゴリ（旧 'notice' 含む）は先頭タブに寄せて非表示化を防ぐ
const annCat = (a) => (ANNOUNCE_TABS.some(t => t.key === a.category) ? a.category : ANNOUNCE_TABS[0].key)

// パピア出現率アップイベント時間帯（JST）。
//   ★2026-06-20公開: 各プレイヤーが最大2枠を自分で選択（profiles.papia_hour / papia_hour2）。
//   未設定なら出現率アップは発生しない（固定4枠デフォルトは廃止）。
const getPapiaEventStatus = (profile) => {
  const now = Date.now()
  const jstNow = new Date(now + 9*60*60*1000)
  const h = jstNow.getUTCHours()
  const m = jstNow.getUTCMinutes()
  const totalMin = h * 60 + m
  const hours = [profile?.papia_hour, profile?.papia_hour2].filter(Number.isInteger)
  for (const startH of hours) {
    const startMin = startH * 60
    const endMin = startMin + 30
    if (totalMin >= startMin && totalMin < endMin) {
      const remaining = endMin - totalMin - 1
      const remainSec = 60 - jstNow.getUTCSeconds()
      return { active: true, remainingMin: remaining, remainingSec: remainSec }
    }
  }
  if (hours.length === 0) return { active: false, untilNextMin: null }
  const allMins = hours.map(hh => hh * 60)
  const nextMin = allMins.find(mm => mm > totalMin) ?? (allMins[0] + 24*60)
  const untilNext = nextMin - totalMin
  return { active: false, untilNextMin: untilNext }
}

// お宝素材ドロップ2倍イベント（JST 2026/6/12 5:00 〜 6/15 4:59）
//   JST05:00 = UTC前日20:00。開始 6/11 20:00 UTC 〜 終了 6/14 20:00 UTC（6/15 5:00JST）。
//   時間になると自動で開始/終了する（クライアント時刻基準）。
const MATERIAL_EVENT_START = Date.UTC(2026, 5, 11, 20, 0, 0) // 6/12 05:00 JST
const MATERIAL_EVENT_END   = Date.UTC(2026, 5, 14, 20, 0, 0) // 6/15 05:00 JST（4:59まで有効）
const getMaterialEventStatus = () => {
  const now = Date.now()
  const active = now >= MATERIAL_EVENT_START && now < MATERIAL_EVENT_END
  if (!active) return { active: false }
  const remMs = MATERIAL_EVENT_END - now
  const remHour = Math.floor(remMs / (60*60*1000))
  const remMin = Math.floor((remMs % (60*60*1000)) / (60*1000))
  return { active: true, remainingHour: remHour, remainingMin: remMin }
}

// ============================================================
// メインコンポーネント
// ============================================================
export default function Game() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const profileRef = useRef(null)  // 常に最新のprofileを保持（focus/visibility等の空依存useEffectから参照するため）
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
  // お宝素材2倍イベントのバナーを「1日1回（朝5時境界）」だけ表示するための確認済み日付
  const [matEventSeenDate, setMatEventSeenDate] = useState(() => localStorage.getItem('bf_mat_event_seen') || '')
  // ステータス欄・施設ボタン欄の展開/折りたたみ（localStorageに保存しページ遷移後も維持）
  const [statExpanded, setStatExpanded] = useState(() => localStorage.getItem('statExpanded') !== '0')
  const [facilitiesExpanded, setFacilitiesExpanded] = useState(() => localStorage.getItem('facilitiesExpanded') !== '0')
  const toggleStatExpanded = () => setStatExpanded(v => { localStorage.setItem('statExpanded', v ? '0' : '1'); return !v })
  const toggleFacilitiesExpanded = () => setFacilitiesExpanded(v => { localStorage.setItem('facilitiesExpanded', v ? '0' : '1'); return !v })
  // ☰メニュー内のカテゴリ別アコーディオン（一般公開済み。戻すならMenuCatのaccordion指定をfalseに）
  const [openMenuCats, setOpenMenuCats] = useState(() => { try { return JSON.parse(localStorage.getItem('openMenuCats') || '{}') } catch { return {} } })
  const toggleMenuCat = (k) => setOpenMenuCats(p => { const n = { ...p, [k]: !p[k] }; localStorage.setItem('openMenuCats', JSON.stringify(n)); return n })
  const [selectedArea, setSelectedArea] = useState(() => Number(localStorage.getItem('selectedArea') || 1))
  // 領地：自国のエリア別シェア（装備ドロップ率ボーナス用）。{ areaId: 0..1 }
  const [areaShareMap, setAreaShareMap] = useState({})
  const [regenRemaining, setRegenRemaining] = useState(0)
  const [innMessage, setInnMessage] = useState('')
  const [equipment, setEquipment] = useState([])
  const [proficiency, setProficiency] = useState([])
  const [classLevels, setClassLevels] = useState([])
  const [templeMessage, setTempleMessage] = useState('')
  const [hasGamblerProof, setHasGamblerProof] = useState(false)
  const [hasDragonKnightProof, setHasDragonKnightProof] = useState(false)
  const [hasBreederProof, setHasBreederProof] = useState(false)
  const [skillSets, setSkillSets] = useState([])          // 出撃(sortie)セット
  const [papiaSkillSets, setPapiaSkillSets] = useState([]) // パピア限定セット（空なら出撃にフォールバック）
  const [playerItem, setPlayerItem] = useState(null)
  const [abilityTitle, setAbilityTitle] = useState(null)
  const [expDungeonTicket, setExpDungeonTicket] = useState(null)  // { id, quantity }
  // 種類ごとの当日選択回数。読み込み完了まではlimit(=disabled)で初期化
  const [dungeonCounts, setDungeonCounts] = useState({ exp:DUNGEON_DAILY_LIMIT, gold:DUNGEON_DAILY_LIMIT, stone:DUNGEON_DAILY_LIMIT, prof:DUNGEON_DAILY_LIMIT, gem:DUNGEON_DAILY_LIMIT })
  const [showDungeonPanel, setShowDungeonPanel] = useState(false)
  const [showChallengePanel, setShowChallengePanel] = useState(false)
  const [showPvp, setShowPvp] = useState(false)  // 対人戦(PvP)パネル開閉（is_admin限定）
  const [showKumite, setShowKumite] = useState(false)  // 組み手パネル開閉（一般公開）
  const [showArena, setShowArena] = useState(false)  // アリーナパネル開閉（一般公開）
  const [autoSortie, setAutoSortie] = useState(false)  // 🔁 自動出撃[開発]（is_admin限定。リロードでOFF＝永続化しない）
  const challengePanelRef = useRef(null)
  // 挑戦パネルを開いたら、その位置まで自動スクロール（スマホで画面外に出るのを防ぐ）
  useEffect(() => {
    if (showChallengePanel) {
      requestAnimationFrame(() => challengePanelRef.current?.scrollIntoView({ behavior:'smooth', block:'center' }))
    }
  }, [showChallengePanel])
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [showMenu, setShowMenu] = useState(false)
  const [aiOpen, setAiOpen] = useState(false) // AI戦闘民族ジェミータ（☰メニューから開く）
  const [raidNotifyOpen, setRaidNotifyOpen] = useState(false) // レイド通知（Web Push）設定パネル
  const [showContact, setShowContact] = useState(false)
  const [showOptions, setShowOptions] = useState(false)   // ⚙ 出撃設定（出撃時間/パピア/変異ボス）
  // 【変異】ボスを出現させるか（char_lv500+のエリア①〜④）。localStorage・既定ON。
  const [mutantEnabled, setMutantEnabled] = useState(() => localStorage.getItem('bf_mutantBoss') !== '0')
  const toggleMutant = () => setMutantEnabled(v => { localStorage.setItem('bf_mutantBoss', v ? '0' : '1'); return !v })
  const [showInstallGuide, setShowInstallGuide] = useState(false)  // 📱 ホーム画面に追加の手順
  const [installTab, setInstallTab] = useState(() => (/android/i.test(navigator.userAgent) ? 'android' : 'iphone'))
  const [sortieModeLoading, setSortieModeLoading] = useState(false)  // ⚡ 出撃CDモード(10/20)変更中
  const [papiaHourLoading, setPapiaHourLoading] = useState(false)
  const [papiaSel, setPapiaSel] = useState(20)            // パピア枠1の選択値（デフォルト20時）
  const [papiaSel2, setPapiaSel2] = useState(-1)          // パピア枠2の選択値（-1=なし）
  const [contactForm, setContactForm] = useState({ category: 'bug', body: '' })
  const [contactSent, setContactSent] = useState(false)
  const [contactLoading, setContactLoading] = useState(false)
  const [contactView, setContactView] = useState('new')    // 'new'=新規問い合わせ / 'history'=過去の問い合わせと返信
  const [myContacts, setMyContacts] = useState([])          // 自分の過去問い合わせ（reply列含む）
  const [contactsLoading, setContactsLoading] = useState(false)
  const [adminReplyDrafts, setAdminReplyDrafts] = useState({}) // is_admin用: {contact_id: 返信文}の下書き
  const [adminReplyingId, setAdminReplyingId] = useState(null)  // 送信中のお問い合わせID
  const [userReplyDrafts, setUserReplyDrafts] = useState({})    // ユーザーの追い返信の下書き {contact_id: 文}
  const [contactPostingId, setContactPostingId] = useState(null) // スレッド追記の送信中ID
  const [adminContactFilter, setAdminContactFilter] = useState('unreplied') // 管理人受信一覧の絞り込み: 'unreplied'=未返信 / 'replied'=返信済み
  const [showAnnouncements, setShowAnnouncements] = useState(false)
  const [announceTab, setAnnounceTab] = useState('update')   // お知らせモーダルの選択中タブ
  const [announcements, setAnnouncements] = useState([])
  const [claimableTitles, setClaimableTitles] = useState(0)  // 獲得可能な称号数（街のバナー表示用）
  const [soldNotice, setSoldNotice] = useState(0)            // 取引所で売れた未確認の出品数（街のバナー表示用）
  const [unreadReplies, setUnreadReplies] = useState(0)      // お問い合わせへの運営返信で未確認の件数（街のバナー表示用）
  const [unrepliedContacts, setUnrepliedContacts] = useState(0)  // 管理人(おれおれお)向け: 未返信のお問い合わせ件数（街のバナー表示用）
  const [alchemyReady, setAlchemyReady] = useState(0)        // 錬金部屋で受け取れる強化石の数（街のバナー表示用・is_admin限定先行）
  const [alchemyEmpty, setAlchemyEmpty] = useState(0)        // 錬金部屋の空き枠数（街のバナー表示用・is_admin限定先行）
  const [territoryExpandable, setTerritoryExpandable] = useState(false)  // 領地拡大が可能か（街のバナー表示用・is_admin限定先行）
  const [boxAvailable, setBoxAvailable] = useState(0)        // ボス装備進化支援箱の所持数（街のバナー表示用）
  const [subsidyAvailable, setSubsidyAvailable] = useState(false)  // 国の補助金が未受取か（街のバナー表示用）
  const [scarecrowState, setScarecrowState] = useState(null)       // かかし修練: 'training'(中) | 'done'(完了・受取待ち) | null
  const [myCountryName, setMyCountryName] = useState('')     // 所属国名（ホーム/プロフィールの所属国表示用・is_admin限定先行）
  const [atWar, setAtWar] = useState(false)                  // 自国が交戦中（active）か。戦争中はホームのHP/MP表示を戦争用に切替
  const [activeWarId, setActiveWarId] = useState(null)       // 交戦中の戦争ID（開戦時の満タン参戦を1戦争1回にするため）
  const warFilledRef = useRef(null)                          // 満タン参戦を適用済みの戦争ID（多重適用ガード）
  const [showGuide, setShowGuide] = useState(false)
  const [showDyingTip, setShowDyingTip] = useState(false)  // 初めて瀕死になったとき1回だけ案内
  const [openGuideId, setOpenGuideId] = useState(null)
  const [guideView, setGuideView] = useState('select')  // 'select' | 'guide' | 'help'
  const [openHelpId, setOpenHelpId] = useState(null)
  const [openHelpSubs, setOpenHelpSubs] = useState({})  // HELPの中項目(【】)の開閉。キー = `${sectionId}:${index}`
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
  const [adminMsgOpen, setAdminMsgOpen] = useState(false)  // 運営からのお知らせ（個別宛）モーダル
  const [seenAdminMsgIds, setSeenAdminMsgIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bf_seenAdminMsgs') || '[]') } catch { return [] }
  })
  const [seenAnnouncementIds, setSeenAnnouncementIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bf_seenAnnouncements') || '[]') } catch { return [] }
  })
  const sortieTimesRef = useRef([])  // オートクリッカー検知：出撃時刻の履歴
  const botCheckTimerRef = useRef(null)  // BOT確認チャレンジのタイマー
  const botCheckActiveRef = useRef(false)  // チャレンジ中フラグ
  const botCheckDeadlineRef = useRef(null)  // タイマー一時停止用：期限の絶対時刻
  const regenningRef = useRef(false)
  const innBusyRef = useRef(false)  // 宿屋利用の二重実行ガード（連打対策）
  const battleBusyRef = useRef(false)  // 出撃の二重発火ガード（スマホ2連タップ対策）
  const clockOffsetRef = useRef(0)  // サーバー時刻 - 端末時刻(ms)。クールダウンのズレ補正用
  const serverNow = () => Date.now() + clockOffsetRef.current
  const lastRemTickRef = useRef(-1)    // 出撃CD表示の前回tick(0.1秒単位)。再描画抑制用
  const lastRegenSecRef = useRef(-1)   // 自然回復表示の前回秒。再描画抑制用
  // クールダウン終了時刻（端末時計基準の相対値）。サーバーの成功/残り秒数レスポンスから設定するため
  // 時計のズレ・オフセット推定誤差の影響を受けない。null の間は last_action_at から計算（初期表示用）
  const cdEndRef = useRef(null)
  const [canLeaveBattle, setCanLeaveBattle] = useState(true)  // 出撃後2秒は「街に戻る」を押せない（オートクリッカー連打対策）
  const leaveTimerRef = useRef(null)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => { fetchProfile() }, [])
  useEffect(() => { fetchAnnouncements() }, [])

  // キャラ作成直後は初心者ガイドを自動で1回開く（受動プレイヤー向けオンボーディング）
  useEffect(() => {
    if (localStorage.getItem('bf_show_guide_onload') === '1') {
      localStorage.removeItem('bf_show_guide_onload')
      setGuideView('select'); setOpenGuideId(null); setOpenHelpId(null); setShowGuide(true)
    }
  }, [])

  // 初めて瀕死状態になったとき、宿屋で回復するよう1回だけ案内する
  useEffect(() => {
    if (profile?.is_dying && !localStorage.getItem('bf_dying_tip_seen')) {
      localStorage.setItem('bf_dying_tip_seen', '1')
      setShowDyingTip(true)
    }
  }, [profile?.is_dying])

  // サーバー時刻オフセットを測定（端末時計のズレでクールダウンが解消しない問題の対策）
  useEffect(() => {
    const sync = async () => {
      try {
        const t0 = Date.now()
        const { data, error } = await supabase.rpc('server_now')
        if (error || !data) return
        const t1 = Date.now()
        // 往復遅延の半分を見込んでサーバー時刻を推定
        const serverMs = new Date(data).getTime() + (t1 - t0) / 2
        clockOffsetRef.current = serverMs - t1
      } catch { /* 意図的に無視 */ }
    }
    sync()
    const id = setInterval(sync, 60000)
    return () => clearInterval(id)
  }, [])

  // profileRef を常に最新へ。空依存のfocus/visibility effectから古いnull profileを参照しないように。
  useEffect(() => { profileRef.current = profile }, [profile])

  useEffect(() => {
    const onFocus = () => { fetchProfile(); refreshTownNotices() }
    const onVisibility = () => { if (document.visibilityState === 'visible') { fetchProfile(); refreshTownNotices() } }
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
      // ★2026-06-20公開: 全員ブーストでCDが動的(20⇔10)に変わるため、毎tick last_action_at＋現在のeffWait で
      //   再評価＝サーバー(sortie_lock)の v_wait 判定と一致。固定 cdEndRef だと開始/終了跨ぎでズレる。
      const rem = profile.last_action_at
        ? Math.max(0, effWait(profile, serverNow()) - (serverNow()-new Date(profile.last_action_at).getTime())/1000)
        : 0
      // canAct(ボタン有効)は毎回反映（同値ならReactが再描画スキップ＝負荷ゼロ）。
      // ガード内に入れるとスマホの一時停止→復帰でtickを取りこぼし、押せなくなることがあった。
      setCanAct(rem === 0)
      // 残り秒数の表示は0.1秒精度が変わった時だけ更新＝無駄な再描画を抑制（待機中は0固定→再描画なし）
      const remTick = Math.round(rem*10)
      if (remTick !== lastRemTickRef.current) {
        lastRemTickRef.current = remTick
        setRemaining(rem)
      }
      const regenElapsed = (Date.now()-new Date(profile.last_regen_at).getTime())/1000
      const regenRem = Math.max(0, REGEN_SECONDS-regenElapsed)
      // 自然回復は整数秒表示なので、秒が変わった時だけ更新（常時5回/秒の再描画を防ぐ）
      const regenSec = Math.ceil(regenRem)
      if (regenSec !== lastRegenSecRef.current) {
        lastRegenSecRef.current = regenSec
        setRegenRemaining(regenRem)
      }
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
      // レイド時間帯（20:30〜23:59）以外は通信せず即終了（Egress削減）。
      // 昼間は街にタブを開いているだけで30秒ごとにDBを叩いていたため、その無駄を排除。
      const inRaidWindow = h > 20 || (h === 20 && m >= 30)
      if (!inRaidWindow) { setRaidStatus(null); setRaidBossData(null); return }
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
      // 取引所：自分の出品が売れて未確認の件数
      const { count } = await supabase.from('marketplace_listings')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', user.id).eq('status', 'sold').eq('seller_seen', false)
      setSoldNotice(count || 0)
      // お問い合わせへの運営返信の未確認件数（reply_at が既読保存より新しいもの）
      await refreshUnreadReplies(user.id)
    })()
  }, [])

  // お問い合わせ返信の未読件数を再計算（reply有りの自分の問い合わせ × ローカル既読リスト）
  const refreshUnreadReplies = async (uid) => {
    try {
      const userId = uid || (await supabase.auth.getUser()).data?.user?.id
      if (!userId) return
      const { data } = await supabase.from('contact_messages')
        .select('id, reply_at')
        .eq('player_id', userId)
        .not('reply', 'is', null)
      let seen = {}
      try { seen = JSON.parse(localStorage.getItem('bf_seenContactReplies') || '{}') } catch { /* 意図的に無視 */ }
      // 既読保存時刻より reply_at が新しい（＝再返信含む）ものを未読とみなす。
      // ※タイムスタンプは文字列でなく数値(getTime)で比較（フォーマット差による誤判定を防ぐ）。
      const unread = (data || []).filter(r => {
        if (!r.reply_at) return false
        const seenAt = seen[r.id]
        if (!seenAt) return true
        return new Date(seenAt).getTime() < new Date(r.reply_at).getTime()
      })
      setUnreadReplies(unread.length)
    } catch { /* 列が無い旧環境などは無視 */ }
  }

  // 管理人(おれおれお)向け: 未返信のお問い合わせ件数を再計算（街のバナー表示用）
  const refreshUnrepliedContacts = async (uname) => {
    try {
      const name = uname ?? profile?.username
      if (name !== 'おれおれお') { setUnrepliedContacts(0); return }
      // 「未返信」＝最後のメッセージがユーザー（未返信の新規＋ユーザーの追い返信）。threadも加味して数える。
      const { data: rows } = await supabase.from('contact_messages').select('id, body, created_at, reply, reply_at, admin_ack_at')
      if (!rows) { setUnrepliedContacts(0); return }
      const ids = rows.map(r => r.id)
      const byC = {}
      if (ids.length > 0) {
        try {
          const { data: th } = await supabase.from('contact_thread').select('contact_id, sender, body, created_at').in('contact_id', ids)
          for (const t of (th || [])) (byC[t.contact_id] ||= []).push(t)
        } catch { /* contact_thread未導入時は reply 列のみで判定 */ }
      }
      const cnt = rows.filter(r => needsAdminReply({ ...r, thread: byC[r.id] || [] })).length
      setUnrepliedContacts(cnt)
    } catch { /* 旧環境などは無視 */ }
  }
  // プロフィール確定後（おれおれおログイン時）に未返信件数を取得
  useEffect(() => { refreshUnrepliedContacts(profile?.username) }, [profile?.username])

  // 街バナー: 錬金部屋の強化石が受け取れる / 領地を広げられる を検出（全プレイヤー）
  const refreshTownNotices = async (p) => {
    // p未指定でも profileRef（常に最新）→ profile の順でフォールバック。
    // focus/visibility から引数なしで呼ばれた際に古いnullを掴んで表示を消すのを防ぐ。
    const prof = p || profileRef.current || profile
    // profile未確定のうちは現在の表示を維持（国名等を空にしない）。ログアウト等はホーム自体が出ない。
    if (!prof) return
    // 錬金部屋: 完成済み（受取可能）の枠数。エリア③ボス撃破で開放（=エリア4解放）が前提。
    if ((prof.unlocked_areas || [1]).includes(4)) {
      try {
        const { data: res } = await supabase.rpc('alchemy_get')
        if (res?.ok) {
          const slots = res.slots || 0
          // 解放枠(slot<=slots)に絞ったジョブ。alchemy_get は解放枠外(slot>slots)の取り残し
          // (例: 奈落の週次リセットで枠数が減った後)も返すため、ページUIに揃える。
          const unlockedJobs = (res.jobs || []).filter(j => (j.slot || 1) <= slots)
          setAlchemyReady(unlockedJobs.filter(j => j.ready).length)          // 受取可能（サーバー判定ready）
          setAlchemyEmpty(Math.max(0, slots - unlockedJobs.length))          // 空き枠（解放済みで稼働ジョブなし）
        }
      } catch { /* 未導入時は無視 */ }
    } else { setAlchemyReady(0); setAlchemyEmpty(0) }
    // 領地拡大: 加盟国に所属 かつ 亡命ロックなし かつ クールダウン明け（Territory.jsxの拡大ボタン条件と一致）
    if (prof.country_id) {
      try {
        const { data: c, error } = await supabase.from('countries').select('name, is_unaffiliated').eq('id', prof.country_id).maybeSingle()
        const lastExpand = prof.last_expand_at ? new Date(prof.last_expand_at).getTime() : 0
        const lockUntil = prof.territory_locked_until ? new Date(prof.territory_locked_until).getTime() : 0
        // 取得成功時のみ更新。通信失敗・一時的なnullで既に表示中の国名を消さない（ちらつき防止）。
        if (!error && c) {
          setMyCountryName(c.name || '')
          const affiliated = !c.is_unaffiliated
          setTerritoryExpandable(affiliated && Date.now() >= lastExpand + EXPAND_COOLDOWN_MS && Date.now() >= lockUntil)
          // 補助金バナー: 加盟国＋貢献度>0＋本日(朝5時JST境界)未受取
          const subsidyDay = new Date(Date.now() + 9*3600*1000 - 5*3600*1000).toISOString().slice(0, 10)
          const subAmt = Math.min(Math.max(Math.floor(prof.country_contrib || 0), 0), 200000)
          setSubsidyAvailable(affiliated && subAmt > 0 && prof.subsidy_claimed_day !== subsidyDay)
        }
      } catch { /* 領地未導入/通信失敗時は既存表示を維持（国名を消さない） */ }
      // 自国が交戦中(active)か。戦争中はホームのHP/MPを戦争用表示(上限+10000)に切替。
      try {
        const { data: w } = await supabase.from('wars').select('id')
          .eq('status', 'active')
          .or(`attacker_country_id.eq.${prof.country_id},defender_country_id.eq.${prof.country_id}`)
          .limit(1)
        setAtWar(!!(w && w.length))
        setActiveWarId(w?.[0]?.id || null)
      } catch { /* 戦争SQL未適用なら無視 */ setAtWar(false); setActiveWarId(null) }
    } else { setTerritoryExpandable(false); setMyCountryName(''); setAtWar(false); setActiveWarId(null); setSubsidyAvailable(false) }
    // かかし修練: 中(training)/完了(done・受取待ち)をバナー用に判定
    try {
      const { data: sc } = await supabase.from('scarecrow_sessions').select('ends_at').eq('player_id', prof.id).eq('status', 'active').maybeSingle()
      setScarecrowState(sc ? (new Date(sc.ends_at) > new Date() ? 'training' : 'done') : null)
    } catch { /* 未導入時は無視 */ }
  }
  // プロフィール確定時＋60秒ごとに再計算（クールダウン明け・錬金完成を取り込む）
  useEffect(() => {
    if (!profile?.id) return
    refreshTownNotices(profile)
    const id = setInterval(() => refreshTownNotices(profile), 60000)
    return () => clearInterval(id)
  }, [profile?.id, profile?.is_admin, profile?.country_id, profile?.last_expand_at, profile?.territory_locked_until])

  // 満タン参戦: 交戦中(active)を検知したら war_self_buff RPC を呼ぶ（サーバー権威・1戦争1回・冪等）。
  // 実効最大HP(装備込み)を渡し、war_participants.hp_maxを実効値へ自己上書き＋現在HPを戦争上限へ満タン化。
  useEffect(() => {
    if (!atWar || !activeWarId || !profile?.id) return
    if (warFilledRef.current === activeWarId) return
    warFilledRef.current = activeWarId
    ;(async () => {
      try {
        const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
        const warMax = eff.hp_max + WAR_HP_BONUS
        // 楽観更新: 先に画面上のHPを満タン(戦争上限)へ。上限+1万と満タン化を同時に見せる（ラグ解消）。
        setProfile(p => p ? { ...p, hp_current: Math.max(p.hp_current ?? 0, warMax), is_dying: false } : p)
        const { error } = await supabase.rpc('war_self_buff', { p_war_id: activeWarId, p_eff_hp_max: eff.hp_max })
        if (error) { warFilledRef.current = null; return }  // RPC未適用などは次回再試行
        await fetchProfile()
      } catch { warFilledRef.current = null }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atWar, activeWarId, profile?.id])

  // 表示中の返信をすべて既読にする（idごとに reply_at を保存）
  const markContactRepliesSeen = (rows) => {
    try {
      const list = rows || myContacts
      const seen = JSON.parse(localStorage.getItem('bf_seenContactReplies') || '{}')
      for (const c of list) if (c.reply) seen[c.id] = c.reply_at || new Date().toISOString()
      localStorage.setItem('bf_seenContactReplies', JSON.stringify(seen))
    } catch { /* 意図的に無視 */ }
    setUnreadReplies(0)
  }

  // 返信バナーの「✓確認」: 開かずにその場で既読化してバナーを消す。
  const dismissReplyBanner = async () => {
    try {
      const { data } = await supabase.from('contact_messages')
        .select('id, reply, reply_at')
        .eq('player_id', profile.id)
        .not('reply', 'is', null)
      markContactRepliesSeen(data || [])
    } catch {
      setUnreadReplies(0)
    }
  }

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const [{ data }, { data: cl }, { data: gpCheck }, { data: ticketRow }, { data: dkCheck }, { data: bpCheck }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('class_levels').select('*').eq('player_id', user.id),
      supabase.from('player_items').select('id, items!inner(effect)').eq('player_id', user.id).eq('items.effect', 'gambler_proof').maybeSingle(),
      supabase.from('player_items').select('id, quantity, items!inner(effect)').eq('player_id', user.id).eq('items.effect', 'exp_dungeon_ticket').maybeSingle(),
      supabase.from('player_items').select('id, items!inner(effect)').eq('player_id', user.id).eq('items.effect', 'dragon_knight_proof').maybeSingle(),
      supabase.from('player_items').select('id, items!inner(effect)').eq('player_id', user.id).eq('items.effect', 'breeder_proof').maybeSingle(),
    ])
    setExpDungeonTicket(ticketRow ? { id: ticketRow.id, quantity: ticketRow.quantity } : null)
    if (!data) { nav('/create'); return }
    // ログイン特典: ボス装備進化支援箱（7/31までログインで全員に1回付与）。サーバーRPCが二重付与・締切を判定。
    try { await supabase.rpc('claim_evo_support_box') } catch { /* 未適用時は無視 */ }
    // 進化支援箱の所持チェック（街バナー用）
    try {
      const { data: boxRow } = await supabase.from('player_items')
        .select('quantity, items!inner(effect)').eq('player_id', user.id).eq('items.effect', 'boss_blood_box').maybeSingle()
      setBoxAvailable(boxRow?.quantity || 0)
    } catch { setBoxAvailable(0) }
    if (Array.isArray(cl)) setClassLevels(cl)
    setHasGamblerProof(!!gpCheck)
    setHasDragonKnightProof(!!dkCheck)
    setHasBreederProof(!!bpCheck)
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
    _computed.exp_next = calcExpNext(data.lv, data.is_admin)
    // DBにも書き戻す（Profile・Rankingページが正しい値を読めるようにする）
    const _needsUpdate = [..._statKeys, 'exp_next'].some(k => data[k] !== _computed[k])
    if (_needsUpdate) {
      await supabase.from('profiles').update(_computed).eq('id', user.id)
    }
    // ログイン時にセッションをまたいだ連続出撃カウントをリセット
    await supabase.from('profiles').update({ consecutive_battle_count: 0 }).eq('id', user.id)
    // 選択中ペットの本体ステ(100%反映)＋装備チャーム効果をプレイヤー本体へ反映（未導入時は無視）
    let petCharm = null
    let petStat = null
    let activePet = null
    try {
      const { data: ap } = await supabase.from('pets').select('species, level, evolved, charm_id').eq('owner_id', user.id).eq('is_active', true).maybeSingle()
      if (ap) {
        activePet = ap
        petStat = petPlayerBonus(ap)
        if (ap.charm_id) {
          const { data: c } = await supabase.from('player_charms').select('*').eq('id', ap.charm_id).maybeSingle()
          if (c) petCharm = charmPlayerBonus(c)
        }
      }
    } catch { /* ペット未導入時は無視 */ }
    setProfile({ ...data, ..._computed, petCharm, petStat, activePet, consecutive_battle_count: 0 })
    setPendingPoints(data.pending_stat_points || 0)
    // selectedAreaがこのアカウントで解放済みかチェック（別アカウントのlocalStorage値を弾く）
    const unlocked = data.unlocked_areas || [1]
    const savedArea = Number(localStorage.getItem('selectedArea') || 1)
    if (!unlocked.includes(savedArea)) {
      setSelectedArea(1)
      localStorage.setItem('selectedArea', 1)
    }
    // 領地：自国のエリア別シェアを取得（装備ドロップ率ボーナス算出用。テーブル未作成でも無視）
    if (data.country_id) {
      try {
        const { data: catRows } = await supabase.from('country_area_territory').select('country_id, area_id, amount')
        setAreaShareMap(myAreaShares(catRows || [], data.country_id))
      } catch { /* 領地未導入時は無視 */ }
    } else {
      setAreaShareMap({})
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
      // 装備・釣り等込みの実効最大まで自然回復する
      const _rEff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
      const hpMaxR = _rEff.hp_max, mpMaxR = _rEff.mp_max
      const hpCapR = atWar ? hpMaxR + WAR_HP_BONUS : hpMaxR   // 戦争中はHP上限+10000まで回復
      const current = sp.hp_current ?? hpMaxR
      const curMp = sp.mp_current ?? mpMaxR
      // ★回復は「上げるだけ」。現在HPが上限超(戦争+1万バッファ等)でも絶対に減らさない。
      //   atWar検知ラグ中にhpCapRがeff止まりでもバッファを削らないようにする（終戦バッファ解除はサーバ_war_resolveが担当）。
      const newHp = Math.max(current, Math.min(hpCapR, Math.floor(current+hpCapR*0.2)))
      const newMp = Math.max(curMp, Math.min(mpMaxR, Math.floor(curMp+mpMaxR*0.2)))
      const newIsDying = newHp >= hpMaxR ? false : sp.is_dying   // 瀕死解除は通常上限基準（復帰を難しくしない）
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
    if (atWar) { setTempleMessage('⚔ 戦争中は転職できません。'); return }
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
    // 精霊召喚士のスキルは持ち越し禁止（他クラスで使用不可）
    const classSkills = (ps || []).filter(s =>
      s.skills?.class_name === targetClass && !s.is_carried_over && !NON_CARRYOVER_CLASSES.has(s.skills?.class_name)
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

    // 精霊召喚士スキルは持ち越し禁止（防御的チェック：候補にも出さないが念のため）
    if (selectedCarrySkill && !NON_CARRYOVER_CLASSES.has(targetClass)) {
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

    // かかし修練中はデイリーダンジョン不可（サーバー側 apply_dungeon_reward でも拒否される）
    {
      const { data: sc } = await supabase.from('scarecrow_sessions')
        .select('ends_at').eq('player_id', profile.id).eq('status', 'active').maybeSingle()
      if (sc && new Date(sc.ends_at) > new Date()) {
        setBattleLogs([{ text:'🌾 かかし修練中はダンジョンに入れません。修練が終わるまで待ちましょう。', color:'#ffcc44' }])
        setScene('battle')
        setLoading(false)
        return
      }
    }

    // ★2026-06-20公開: 回数/CD/釣り/探索中チェックと「回数消費」をサーバーで原子的に実行（二端末バイパス対策）。
    //   ok のときだけ報酬処理へ進む。回数・last_action_at はサーバーが消費済み。
    const { data: consumeRes, error: consumeErr } = await supabase.rpc('dungeon_consume', { p_type: type })
    if (consumeErr || !consumeRes?.ok) {
      const reason = consumeRes?.reason || consumeErr?.message
      let msg = '⚠ ダンジョンを開始できませんでした。少し待ってお試しください。'
      if (reason === 'cooldown') msg = `⏳ クールダウン中です。あと${Math.max(1, Math.ceil(Number(consumeRes?.seconds_left) || 1))}秒お待ちください。`
      else if (reason === 'daily_limit') msg = `本日分のこのダンジョンは終了しました（1日${dungeonDailyLimitFor(profile)}回）。`
      else if (reason === 'dungeon_active') msg = '🕳 ペットダンジョン探索中はデイリーダンジョンに入れません。'
      else if (reason === 'fishing') msg = '🎣 釣り中はデイリーダンジョンに入れません。先に釣りを終了してください。'
      setBattleLogs([{ text: msg, color:'#ffcc44' }])
      setCurrentEnemy(null); setScene('battle'); setLoading(false); return
    }
    const newCount = consumeRes.count   // サーバーが消費した後の回数
    // ★2026-06-26: デイリーダンジョンはCDなし（サーバーも last_action_at 非更新）。街出撃のCDタイマーも触らない。

    setScene('battle'); setBattleLogs([])

    const DUNGEON_ENEMIES = {
      exp:   { name:'かもすけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      gold:  { name:'かねすけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      stone: { name:'いしすけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      prof:  { name:'かかし',   hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
      gem:   { name:'たますけ', hp:1, atk:1, def:1, matk:1, mdef:1, spd:1, type:'physical' },
    }
    const dungeonEnemy = DUNGEON_ENEMIES[type]
    setCurrentEnemy(dungeonEnemy)  // パピア等の前回敵画像が残らないように更新
    const logs = []
    logs.push({ text:`✨ デイリーダンジョン: ${dungeonEnemy.name}が現れた！`, color:'#cc44ff' })

    const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
    const dmg = Math.max(1, Math.floor(eff.atk * (0.9 + Math.random() * 0.2)))
    logs.push({ text:`1ターン目: あなたの攻撃！ ${dungeonEnemy.name}に${dmg}ダメージ！`, color:'#ffcc00' })
    logs.push({ text:`${dungeonEnemy.name}を倒した！`, color:'#44ff88' })

    // ★newCount は dungeon_consume が消費済みの値（上で取得済み）。回数とCDはサーバーで確保済み。
    // 報酬本体(exp/gold)の拒否時は理由を表示（回数は既に消費されているため返却はしない＝二重取得防止）
    let rewardFailed = false, rewardFailReason = ''

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
        dispExp -= dispExpNext; dispLv++; dispExpNext = calcExpNext(dispLv, profile.is_admin)
        logs.push({ text:`★ LEVEL UP！ ${profile.class} LV${dispLv}！`, color:'#cc44ff' })
      }
      logs.push({ text:`EXP +${bonusExp}`, color:'#cc8800' })
      return bonusExp
    }

    // 報酬処理は途中で例外が出ても必ず loading を解除し結果を表示する
    // （強化石/熟練度/宝石ダンジョンが「戦闘中...」のまま固まる不具合への対策）
    try {
    if (type === 'exp') {
      let expGained = Math.floor(50 + Math.random() * 51)
      // キャラクターLV100未満は経験値1.5倍（出撃と同じ。サーバー apply_dungeon_reward の上限も1.5倍にしてある）
      if ((profile.char_lv||1) < 100) expGained = Math.floor(expGained * 1.5)
      // ★2026-06-20公開: 経験値ダンジョンは「獲得半減(×1/2)」＋「3回化の内容補正(×5/3)」＝実質×5/6。
      //   base100×1.5×5/6=125 ≤ サーバー上限150。
      expGained = Math.floor(expGained * 5 / 6)
      const currentClassLvD = classLevels.find(cl => cl.class_name === profile.class)?.lv || profile.lv
      const capD = getEffectiveCap(profile.class, profile.retraining)
      if (expIsFrozen(profile)) {
        logs.push({ text:`EXP +${expGained}（調査中につき停止）`, color:'#446688' })
      } else if (currentClassLvD < capD) {
        // DB更新はRPC経由。★[CODEX]83 #2: 拒否時に偽の「LEVEL UP/EXP+」を出さないよう、成功時のみ表示ログを積む
        const { data: expRes, error: expErr } = await supabase.rpc('apply_dungeon_reward', { p_type:'exp', p_claimed_exp:expGained })
        if (expErr || expRes?.ok === false) { rewardFailed = true; rewardFailReason = expRes?.reason || expErr?.message || 'unknown' }
        else {
          // レベルアップ表示はクライアントで計算（サーバーで反映済み）
          let dispExp = profile.exp + expGained
          let dispLv = profile.lv
          let dispExpNext = profile.exp_next
          while (dispExp >= dispExpNext && dispLv < capD) {
            dispExp -= dispExpNext; dispLv++; dispExpNext = calcExpNext(dispLv, profile.is_admin)
            logs.push({ text:`★ LEVEL UP！ ${profile.class} LV${dispLv}！`, color:'#cc44ff' })
          }
          logs.push({ text:`EXP +${expGained}`, color:'#cc8800' })
        }
      } else {
        logs.push({ text:`⚠ レベルキャップに達しています（EXP +0）`, color:'#ff8844' })
      }
    } else if (type === 'gold') {
      const charLvG = profile.char_lv || profile.lv
      // 基礎: キャラLv×30〜45。キャラLv300以下は育成支援ボーナス×1.5
      const lvBonus = charLvG <= 300 ? 1.5 : 1.0
      let goldGained = Math.floor(charLvG * 30 * (1.0 + Math.random() * 0.5) * lvBonus * 1.5)  // デイリーダンジョン ゴールド1.5倍
      // ★2026-06-20公開: 3回化の内容補正（×5/3）。サーバー apply_dungeon_reward のGold上限も×5/3。
      goldGained = Math.floor(goldGained * DUNGEON_REWARD_MULT)
      const bonusExp = grantBonusExpLogs()
      const { data: goldRes, error: goldErr } = await supabase.rpc('apply_dungeon_reward', { p_type:'gold', p_claimed_gold:goldGained, p_claimed_exp:bonusExp })
      if (goldErr || goldRes?.ok === false) { rewardFailed = true; rewardFailReason = goldRes?.reason || goldErr?.message || 'unknown' }
      else logs.push({ text:`Gold +${goldGained}${lvBonus > 1 ? '（キャラLV300までボーナス ×1.5！）' : ''}`, color:'#ffcc00' })
    } else if (type === 'stone') {
      const r = Math.random() * 100
      const stoneName = r < 10 ? '強化石(F)' : r < 25 ? '強化石(E)' : r < 55 ? '強化石(D)' : r < 80 ? '強化石(C)' : r < 95 ? '強化石(B)' : '強化石(A)'
      const { data: stoneItem } = await supabase.from('items').select('id').eq('name', stoneName).maybeSingle()
      if (!stoneItem) {
        // items テーブルに該当行が無いと付与されず「入手」表示だけ出てしまう不具合への対策
        logs.push({ text:`⚠ ${stoneName} の付与に失敗しました（アイテム未登録）。運営に連絡してください`, color:'#ff8844' })
      } else {
        // ★2026-06-20公開: 3回化の内容補正（×5/3）。1個＋2/3の確率でもう1個（平均1.67個）
        const stoneQty = Math.random() < (DUNGEON_REWARD_MULT - 1) ? 2 : 1
        // 既存所持があれば加算、無ければ新規。upsert_player_item RPC に依存せず確実に反映させる
        const { data: ownStone } = await supabase.from('player_items')
          .select('id, quantity').eq('player_id', profile.id).eq('item_id', stoneItem.id).maybeSingle()
        if (ownStone) {
          await supabase.from('player_items').update({ quantity: (ownStone.quantity || 1) + stoneQty }).eq('id', ownStone.id)
        } else {
          await supabase.from('player_items').insert({ player_id: profile.id, item_id: stoneItem.id, quantity: stoneQty, equipped: false })
        }
        logs.push({ text:`💎 ${stoneName} を入手！${stoneQty > 1 ? `（×${stoneQty}）` : ''}`, color:'#6699cc' })
      }
    } else if (type === 'prof') {
      let profGained = Math.floor(50 + Math.random() * 51)
      profGained = Math.floor(profGained * DUNGEON_REWARD_MULT)  // ★2026-06-20公開: 3回化の内容補正×5/3
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
      // ランダムでFランク宝石を獲得（★is_admin先行: 3回化の内容補正で1個＋2/3の確率でもう1個）
      const gemType = GEM_TYPES[Math.floor(Math.random()*GEM_TYPES.length)]
      const gemQty = Math.random() < (DUNGEON_REWARD_MULT - 1) ? 2 : 1
      try {
        const { data: existing } = await supabase.from('player_gems')
          .select('*').eq('player_id', profile.id).eq('gem_type', gemType).eq('rank', 'F').single()
        if (existing) {
          await supabase.from('player_gems').update({ quantity:(existing.quantity||1)+gemQty }).eq('id', existing.id)
        } else {
          await supabase.from('player_gems').insert({ player_id:profile.id, gem_type:gemType, rank:'F', quantity:gemQty })
        }
      } catch {
        try { await supabase.from('player_gems').insert({ player_id:profile.id, gem_type:gemType, rank:'F', quantity:gemQty }) } catch { /* 意図的に無視 */ }
      }
      logs.push({ text:`💍 宝石「${GEM_DATA[gemType].name}(F)」を入手！${gemQty > 1 ? `（×${gemQty}）` : ''}`, color:'#ff66cc' })
    }

    // gold以外のEXP以外ダンジョン（stone/prof/gem）にもおまけ経験値（8〜11）を付与
    // ※ gold は上のRPC呼び出しに同梱済み
    if (type === 'stone' || type === 'prof' || type === 'gem') {
      const bonusExp = grantBonusExpLogs()
      // stone/gem/profは本体（アイテム/熟練度）を付与済みなので、おまけEXP拒否は警告のみ（回数は消費する）
      const { data: bRes, error: bErr } = await supabase.rpc('apply_dungeon_reward', { p_type: type, p_claimed_exp: bonusExp })
      if (bErr || bRes?.ok === false) logs.push({ text:`⚠ おまけEXPは反映されませんでした（理由: ${bRes?.reason || bErr?.message || 'unknown'}）`, color:'#ff8844' })
    }

    // 報酬本体(exp/gold)が拒否された場合は警告のみ（回数・CDは dungeon_consume で消費済み）
    if (rewardFailed) {
      logs.push({ text:`⚠ 報酬が反映されなかった可能性があります（理由: ${rewardFailReason}）。`, color:'#ff8844' })
    }
    // ★2026-06-26: デイリーダンジョンはCDなし。街出撃のCDタイマー(cdEndRef)は触らない。回数のみ更新。
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
        ⚠ 自動操作の疑いがあります。<br/>5分以内に下のボタンを押してください（未操作の場合アカウントを停止します）
      </div>
      <button onClick={passBotCheck}
        style={{ position:'absolute', top:`${botCheck.top}vh`, left:`${botCheck.left}vw`, padding:'14px 22px', background:'#1a0000', border:'2px solid #ff4444', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'14px', whiteSpace:'nowrap' }}>
        🤖 私はBOTではありません
      </button>
    </div>
  )

  const doBattle = async (e) => {
    if (!canAct || loading) return
    // スマホの2連タップ等でstate更新(loading/scene)が反映される前に二重発火するのを同期的に防ぐ。
    // 数百msの連打窓だけ塞げば十分（その後はloading/canActガードが効く）ので、タイマーで自動解放する。
    if (battleBusyRef.current) return
    battleBusyRef.current = true
    setTimeout(() => { battleBusyRef.current = false }, 1500)
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
    // かかし修練中は出撃不可（サーバー側 apply_battle_result でも拒否される）
    {
      const { data: sc } = await supabase.from('scarecrow_sessions')
        .select('ends_at').eq('player_id', profile.id).eq('status', 'active').maybeSingle()
      if (sc && new Date(sc.ends_at) > new Date()) {
        setBattleLogs([{ text:'🌾 かかし修練中は出撃できません。修練が終わるまで待ちましょう。', color:'#ffcc44' }])
        setScene('battle'); return
      }
    }
    // ペットダンジョンを「現在プレイ中」のときだけ出撃不可（中断中は出撃OK・別端末対策はサーバーでも拒否）
    {
      const { data: dr } = await supabase.from('dungeon_runs')
        .select('id, suspended').eq('owner_id', profile.id).eq('status', 'active').maybeSingle()
      if (dr && !dr.suspended) {
        setBattleLogs([{ text:'🕳 ダンジョン探索中は出撃できません。中断するか終えてからにしましょう。', color:'#ffcc44' }])
        setScene('battle'); return
      }
    }
    // 戦争中は通常出撃不可（戦争に専念。HP/MPは戦争と共有のため街で削れるのを防ぐ意図も）
    if (atWar) {
      setBattleLogs([{ text:'⚔ 戦争中は通常の出撃ができません。戦争ページで戦いましょう。', color:'#ff8a6a' }])
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
    {
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
    // 装備・釣り等込みの実効最大HP/MP。戦闘の最大HP/MPプール・回復上限・%計算はこれを使う
    const maxHp = eff.hp_max
    let maxMp = eff.mp_max
    const battleProfile = { ...profile, hp_max: maxHp, mp_max: maxMp }
    // サーバーのHP検証用に実効最大HPをキャッシュ（apply_battle_result が eff_hp_max を上限に使う）
    await supabase.from('profiles').update({ eff_hp_max: maxHp }).eq('id', profile.id)
    const area = AREAS.find(a => a.id === selectedArea)
    const bossRate = profile.boss_encounter_rate || 0
    const isBossEncounter = Math.random()*100 < bossRate
    const papiaRate = getPapiaEventStatus(profile).active ? 2 : 1
    const isPapiaEncounter = !isBossEncounter && Math.random()*100 < papiaRate
    // 【変異】段階: char_lv 500以上＋エリア①〜④（トグル無関係の対象判定）。
    const mutantHigh = selectedArea <= 4 && (profile.char_lv || 1) >= MUTANT_BOSS_LV
    // 変異ボスの出現は出撃設定ONのときだけ。雑魚Goldの強化は「撃破済みか」だけで決まる（下記）。
    const useMutantBoss = isBossEncounter && mutantHigh && mutantEnabled && MUTANT_BOSSES[selectedArea]
    const enemyIdx = Math.floor(Math.random() * area.enemies.length)
    const enemy = isPapiaEncounter
      ? { ...PAPIA }
      : isBossEncounter
        ? { ...(useMutantBoss ? MUTANT_BOSSES[selectedArea] : area.boss) }
        : { ...area.enemies[enemyIdx] }
    const enemyMaxHp = enemy.hp

    setLoading(true); setScene('battle'); setBattleLogs([]); setCurrentEnemy(enemy)
    // 出撃直後2秒は「街に戻る」を無効化（その場連打＋オートクリッカー自動化対策）
    setCanLeaveBattle(false)
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => setCanLeaveBattle(true), 2000)

    // 出撃ロック: 判定・記録とも100%サーバー時計のRPC（端末時計に一切依存しない）
    const now = new Date(serverNow()).toISOString()
    let lockOk
    const { data: lock, error: lockErr } = await supabase.rpc('sortie_lock')
    if (lockErr) {
      // RPC未適用/通信失敗時のフォールバック: 旧アトミックUPDATE方式
      const lockTime = new Date(serverNow() - effWait(profile, serverNow()) * 1000).toISOString()
      const { data: locked } = await supabase.from('profiles')
        .update({ last_action_at: now })
        .eq('id', profile.id)
        .lt('last_action_at', lockTime)
        .eq('is_fishing', false)
        .select('id')
      lockOk = !!(locked && locked.length > 0)
      if (!lockOk) {
        setBattleLogs([{ text:`⏳ クールダウン中です。少し待ってから再度お試しください。`, color:'#ffcc44' }])
        setScene('battle'); setLoading(false); await fetchProfile(); return
      }
    } else if (!lock?.ok) {
      if (lock?.reason === 'fishing') {
        setBattleLogs([{ text:'🎣 釣り中は出撃できません。先に釣りを終了してください。', color:'#ff8844' }])
      } else if (lock?.reason === 'cooldown') {
        // サーバーが返した残り秒数に完全同期（以後のカウントダウンもこの値基準）
        const left = Math.max(0.5, Number(lock.seconds_left) || 1)
        cdEndRef.current = Date.now() + left * 1000
        setRemaining(left)
        setBattleLogs([{ text:`⏳ クールダウン中です。あと${Math.max(1, Math.ceil(left))}秒お待ちください。`, color:'#ffcc44' }])
      } else {
        setBattleLogs([{ text:'⚠ 出撃処理に失敗しました。少し待ってから再度お試しください。', color:'#ff8844' }])
      }
      setScene('battle'); setLoading(false); await fetchProfile(); return
    } else {
      /* 何もしない */
    }
    // ロック成功＝サーバーが今この瞬間からCD開始。相対カウントダウンを開始
    cdEndRef.current = Date.now() + effWait(profile, serverNow()) * 1000
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
    let playerHp = Math.min(hpCurrent, maxHp)
    let playerMp = Math.min(profile.mp_current ?? maxMp, maxMp)
    let enemyHp = enemy.hp
    let turn = 1, skillIndex = 0
    let playerBuffs = {}, enemyBuffs = {}
    let currentItem = playerItem ? { ...playerItem } : null
    let itemUsed = false
    let prevSkillName = null
    // BOSS回復管理
    let bossHealCooldown = 0
    let bossSpecialUsed = false
    let bossBuff1Used = false   // HP70%以下で発動
    let bossBuff2Used = false   // HP30%以下で発動
    let bossHeal1Used = false   // HP60%以下で発動
    let bossHeal2Used = false   // HP30%以下で発動
    let papiaEscaped = false
    let playerAttacking = false  // bloodRage：直接攻撃中のみtrue
    let rokkanStacks = 0    // 第六感(再修練)：魔法攻撃ヒット毎に+5%・最大6
    let seimitsuStacks = 0  // 精密照準(再修練)：同スキル連続で+10%/クリ+2%・最大3

    const equippedWeaponItem = equipment.find(e => e.slot==='weapon' && e.equipped)
    const ondmgSpdUp = eff.ondmgSpdUp || 0  // 雷鋼の機神鎧: 被ダメ時に付与する素早さ倍率（0=なし）
    const hasAmagoiShield = equipment.some(e => e.equipped && e.bonus_effect === 'battle_start_ailment_shield')  // 哭雨の羽衣: 5Tごとに異常無効バフ再付与
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

    // 再修練3段でパッシブ強化（現在クラス一致＆再修練3回以上＆そのパッシブをセット中）
    const rtCur = (profile.retraining||{})[profile.class]||0
    const pe = (cls) => profile.class === cls && rtCur >= 3

    // 精霊共鳴（再修練1+）: 最大MP+20%
    if (profile.class === '精霊召喚士' && rtCur >= 1 && passiveNames.includes('精霊共鳴')) {
      maxMp = Math.floor(maxMp * 1.2)
      battleProfile.mp_max = maxMp
      playerMp = Math.min(maxMp, profile.mp_current ?? maxMp)
    }

    // ブリーダー：ペット召喚（パッシブ）。選択ペットをステ×2・HP×5で独立エンティティとして召喚
    // ・毎ターン×1.0で自動攻撃 ・敵は50%でペットを狙う ・ペット撃破後はプレイヤーのみが対象
    // ・rt1で種族別の攻撃時追加効果 ・ペットの攻撃は素早さの影響を受けない（敵回避は受ける）
    let petActive = false, petHp = 0, petMaxHp = 0, petAtk = 0, petDef = 0, petMdef = 0
    let petAtkType = 'phys', petSpecies = null
    const petBuffs = { reduce: 0, reduceTurns: 0 }  // 休憩しよう！rt4: 1T被ダメ30%カット
    if (profile.class === 'ブリーダー' && passiveNames.includes('ペット召喚') && profile.activePet?.species) {
      const ps = petStats(profile.activePet)
      petAtk = ps.atk * 2; petDef = ps.def * 2; petMdef = ps.mdef * 2
      petMaxHp = ps.maxHp * 5; petHp = petMaxHp
      petAtkType = ps.atkType; petSpecies = profile.activePet.species
      petActive = true
    }

    const passiveCritBonus   = 0  // 精密照準のクリは再修練のスタックへ移行（素のクリ加算なし）
    const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.25 : 0  // 隠身強化：クリ威力+25%
    // 心眼(居合の構え)は物理ダメ専用のため passiveDmgMult からは除外（iaiPhysMult で別管理）
    // 第六感の素の与ダメ強化は廃止（再修練スタックへ移行）
    const passiveDmgMult     = (hasBerserk ? (pe('狂戦士')?1.40:1.15) : 1.0) * (hasKakushin ? (pe('異端審問官')?1.40:1.20) : 1.0) * (eff.weaponDmgMult || 1)
    const passiveHealMult    = (hasShinkoka ? 1.5 : 1.0) * (hasKakushin ? 0.5 : 1.0)  // 執行本能：回復量×0.5（常時）
    const passiveMatkMult    = hasShinkoka ? 1.1 : 1.0
    const passiveMpCostMult  = (hasTenki ? (pe('賢者')?0.5:0.7) : 1.0) * (eff.weaponMpCostMult || 1)  // 天啓：MP消費 通常×0.7／再修練×0.5
    const passiveMatkMultTenki = hasTenki ? (pe('賢者')?1.4:1.2) : 1.0  // 天啓：MATK 通常×1.2／再修練×1.4
    const passiveHitBonus    = (hasRokkan ? 10 : 0) + (hasSeimitsu ? 10 : 0) + (hasTakaNoMe ? (pe('狩人')?20:10) : 0)  // 第六感/精密照準=命中+10、鷹ノ目=+10/+20
    const passiveHealReflect = (hasShinkoka && pe('聖職者'))  // 神聖加護強化：回復量を敵に反射  // 神聖加護強化：回復量の50%を敵に
    const hasGambleBody       = passiveNames.includes('ギャンブルボディ')
    const hasMadokenJutsu     = passiveNames.includes('魔導剣術')
    const hasHolyKnightPassive= passiveNames.includes('聖騎士の心得')
    const hasRyurin           = passiveNames.includes('竜鱗の加護') // 防御×1.2（再修練×1.4）＋被ダメ時30%で軽減
    const ryurinMult          = hasRyurin ? (pe('竜騎士')?1.4:1.2) : 1.0
    // 竜鱗の加護：被ダメ時に30%で軽減倍率を返す（通常-5%／再修練3段で-20%）
    const ryurinReduce = () => (hasRyurin && Math.random() < 0.3) ? (pe('竜騎士')?0.80:0.95) : 1.0

    // 居合の構え：セット中の通常スキルが全て使用回数1のとき発動（物理ダメージ専用 通常+40%／再修練+70%）
    const iaiSetSkills = activeSkillSets.filter(ss => ss.skills && ss.skills.type !== 'パッシブ')
    const iaiLoadoutOK = iaiSetSkills.length > 0 && iaiSetSkills.every(ss => (ss.use_count ?? 1) === 1)
    const iaiPhysMult   = (hasIai && iaiLoadoutOK) ? (pe('侍')?1.70:1.40) : 1.0
    const takaAtkBonus  = (hasTakaNoMe && pe('狩人')) ? Math.floor((eff.spd||0) * 0.1) : 0  // 鷹ノ目強化：素早さの10%を攻撃に加算
    const madokenAtkMult = (hasMadokenJutsu && pe('魔法剣士')) ? 1.1 : 1.0  // 魔導剣術強化：攻撃力×1.1
    // プレイヤーの防御パッシブ/フィールドバフ合算（聖騎士の心得・聖域展開・竜鱗・骸の壁）。
    // doEnemyAttackと同じ係数を敵スキル経路(executeEnemySkill)にも渡すための関数。
    const playerPassiveDefMult = () => {
      const hf = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
      const hk = hasHolyKnightPassive ? (pe('聖騎士')?2.0:1.5) : 1.0
      const kb = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
      return hf * hk * ryurinMult * kb
    }

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

    playerBuffs = applyEquipmentEffects(equipment, battleProfile, playerBuffs, logs)

    const effectiveSpdForCalc = eff.spd  // 鷹ノ目のSPD×1.2は廃止（命中+ATK加算へ仕様変更）
    const weaponType = equippedWeaponItem?.weapons?.weapon_type || 'sword'
    const isMagical = getWeaponGroup(weaponType) === 'magical'
    const expandedSkillSet = []
    for (const ss of activeSkillSets) {
      if (ss.skills?.type === 'パッシブ') continue
      const count = ss.use_count || 1
      for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
    }
    // 全スキルセット判定（アクティブスロット5枠すべてに通常スキルがセット済み）= 深紅の牙輪/魔眼石の真化条件
    const allSkillsSet = activeSkillSets.filter(ss => ss.skills && ss.skills.type !== 'パッシブ').length >= 5

    const playerSpd = effectiveSpdForCalc
    const enemySpd = enemy.spd||5
    const playerExtraRate = calcExtraActionRate(playerSpd, enemySpd)
    const enemyExtraRate  = calcExtraActionRate(enemySpd, playerSpd)
    const playerCritRate  = calcCritRate(playerSpd, enemySpd) + passiveCritBonus + (eff.critBonus || 0)
    const enemyCritRate   = Math.max(0, calcCritRate(enemySpd, playerSpd) - (eff.critResist||0) - (playerBuffs.critResist?.turns > 0 ? (playerBuffs.critResist.value||0) : 0))

    // 敵の回避率（プレイヤーが攻撃するとき）
    const enemyEvasionRate  = calcEvasionRate(enemySpd, effectiveSpdForCalc)
    // プレイヤーの命中ボーナス（アクアクラウンなど）
    const playerHitBonus = (eff.hitBonus || 0) + passiveHitBonus

    // ボス装備 真化: プレイヤーの攻撃ヒット時の効果（スライムの指輪=SPD-10% / 略奪者の短剣=出血 / 絶零の魔導砲=スタン）
    const applyEvoHitEffects = (dmg) => {
      if (dmg <= 0) return
      if (eff.evoHitSpdDown && !(enemyBuffs.spdDown?.turns > 0 && enemyBuffs.spdDown.rate <= 0.9)) {
        enemyBuffs.spdDown = { turns: 2, rate: 0.9 }
        logs.push({ text:`💧 真化効果！ ${enemy.name}の素早さが2ターン-10%！`, color:'#66ccff' })
      }
      if ((eff.evoHitBleed||0) > 0 && Math.random()*100 < eff.evoHitBleed) {
        enemyBuffs.bleed = { stacks: Math.min(5, (enemyBuffs.bleed?.stacks||0)+1), lastTurn: 0 }
        logs.push({ text:`🩸 真化効果！ ${enemy.name}が出血した！`, color:'#ff4444' })
      }
      if ((eff.evoHitStun||0) > 0 && !(enemyBuffs.stun?.turns > 0) && Math.random()*100 < eff.evoHitStun) {
        enemyBuffs.stun = { turns: 1 }
        logs.push({ text:`💫 真化効果！ ${enemy.name}をスタンさせた！`, color:'#ffaa00' })
      }
    }
    // ボス装備 真化: プレイヤー被ダメージ時の効果（嵐の重装甲=反射 / フロストバーンの聖鎧=スタン / インフェルノバスティオン=やけど）
    const onPlayerDamaged = (dmg) => {
      if (dmg <= 0) return
      if ((eff.evoReflectPct||0) > 0) {
        const refl = Math.max(1, Math.floor(dmg * eff.evoReflectPct / 100))
        enemyHp -= refl
        logs.push({ text:`🛡 真化効果！ 受けたダメージの${eff.evoReflectPct}%（${refl}）を反射！`, color:'#88ccff' })
      }
      if ((eff.evoOndmgStun||0) > 0 && !(enemyBuffs.stun?.turns > 0) && Math.random()*100 < eff.evoOndmgStun) {
        enemyBuffs.stun = { turns: 1 }
        logs.push({ text:`💫 真化効果！ 反撃で${enemy.name}をスタンさせた！`, color:'#ffaa00' })
      }
      if ((eff.evoOndmgBurn||0) > 0 && !(enemyBuffs.burn?.turns > 0) && Math.random()*100 < eff.evoOndmgBurn) {
        enemyBuffs.burn = { turns: 5, dmgRate: 0.02 }
        logs.push({ text:`🔥 真化効果！ 反撃で${enemy.name}をやけどさせた！`, color:'#ff8844' })
      }
    }

    const doPlayerAttack = (isExtra=false) => {
      playerAttacking = true
      const holyFieldDef = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
      const holyKnightMult = hasHolyKnightPassive ? (pe('聖騎士')?2.0:1.5) : 1.0
      const kabeDefP = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
      const pDef   = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1) * holyFieldDef * holyKnightMult * ryurinMult * kabeDefP
      const pMdef  = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * holyFieldDef * holyKnightMult * ryurinMult * kabeDefP
      const burnDebuffP = playerBuffs.burn?.turns > 0 ? 0.9 : 1.0
      const madokenBonus = hasMadokenJutsu ? Math.floor(eff.matk * (pe('魔法剣士')?0.6:0.3)) : 0
      // ボス装備 真化: 全スキルセット時の攻撃/特攻+10%（深紅の牙輪/魔眼石）
      const evoAllAtkMult  = (allSkillsSet && (eff.evoAllskillAtk||0)  > 0) ? 1 + eff.evoAllskillAtk/100  : 1
      const evoAllMatkMult = (allSkillsSet && (eff.evoAllskillMatk||0) > 0) ? 1 + eff.evoAllskillMatk/100 : 1
      const pMatk  = (eff.matk - madokenBonus) * (playerBuffs.matkUp ? playerBuffs.matkUp.rate : 1) * passiveMatkMult * passiveMatkMultTenki * burnDebuffP * evoAllMatkMult
      const pAtk   = (eff.atk + madokenBonus + takaAtkBonus) * madokenAtkMult * (playerBuffs.atkUp  ? playerBuffs.atkUp.rate  : 1) * (playerBuffs.atkDown ? playerBuffs.atkDown.rate : 1) * burnDebuffP * evoAllAtkMult
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
        if (nextSkill.name === 'マナボルト') peekMpCost = Math.max(1, Math.floor(playerMp * 0.2))
        mpLack = playerMp < peekMpCost
        if (mpLack) logs.push({ text:`💧 MPが足りなくてスキルが使えない！`, color:'#6699ff' })
      }
      const isSureHit = !mpLack && nextSkillName === '絶影狙撃'
      // バフ・回復スキルは自分にかけるものなので敵に回避されない（MP不足時は通常攻撃なので回避判定あり）
      const isSelfSkill = !mpLack && nextSkill && (nextSkill.type === '強化' || nextSkill.type === '回復')
      // 多段ヒットスキルは行動全体の回避判定をスキップし、1発ごとに回避判定する
      const isMultiHitSkill = !mpLack && nextSkill && MULTI_HIT_SKILLS.has(nextSkill.name)
      // ウンディーネ3段目（静水の加護）はダメージ0の自己バフなので回避対象外
      const isOndoBuff = !mpLack && nextSkill?.name === 'ウンディーネ' &&
        (playerBuffs.spiritCombo?.name === 'ウンディーネ' ? (playerBuffs.spiritCombo.count || 0) : 0) >= 2
      // 連装銃撃の再修練強化：このスキルの命中+10%
      const skillExtraHit = (nextSkillName === '連装銃撃' && profile.class === '魔銃士' && rtCur >= 2) ? 10 : 0
      const baseEnemyEvasion = Math.max(0, enemyEvasionRate - playerHitBonus - buffHitBonus - skillExtraHit) + (enemy.isPapia ? 50 : 0)
      const effectiveEnemyEvasion = (isSureHit || isSelfSkill || isMultiHitSkill || isOndoBuff) ? 0 : baseEnemyEvasion
      if (effectiveEnemyEvasion > 0 && Math.random()*100 < effectiveEnemyEvasion) {
        logs.push({ text:`${prefix}${nextSkillName && !mpLack ? `${nextSkillName}！` : '攻撃！'} しかし${enemy.name}に回避された！`, color:'#446688' })
        // 追撃系（鬼影閃の影歩き追撃など）はメインが回避されても独立ヒットとして発動する
        if (nextSkill && !mpLack) {
          const resPeek = executeSkill(nextSkill, effBuff, battleProfile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
          if (resPeek.followup && resPeek.followup.dmg > 0) {
            const adjED = Math.max(1, Math.floor((enemy.def||0)*eDefRate))
            const fScale = effBuff.atk / (effBuff.atk + adjED)
            const fCrit = Math.random()*100 < playerCritRate
            const fCritMult = fCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
            const dr = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
            let fDmg = Math.floor(resPeek.followup.dmg * fScale * fCritMult * passiveDmgMult * dr * (0.9 + Math.random()*0.2))
            if (enemy.isPapia) fDmg = 1
            fDmg = Math.max(1, fDmg)
            enemyHp -= fDmg
            logs.push({ text:`↳ 追撃！${resPeek.followup.label?`（${resPeek.followup.label}）`:''} ${enemy.name}に${fDmg}ダメージ！${fCrit?' 💥クリティカル！':''}`, color: fCrit?'#ffaa00':'#ffaa66' })
          }
        }
        if (expandedSkillSet.length > 0) skillIndex++
        return
      }

      // 狂乱: 指定スキルに固定
      if (playerBuffs.berserk?.turns > 0 && playerBuffs.berserk.lockedSkill) {
        const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
        if (lockedIdx >= 0) skillIndex = lockedIdx
      }
      // 天墜竜閃の溜め中：次ターンは必ず天墜竜閃（解放）を出す
      if (playerBuffs.tenkaiCharge?.turns > 0) {
        const tIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === '天墜竜閃')
        if (tIdx >= 0) skillIndex = tIdx
      }
      let skillUsed = false
      if (expandedSkillSet.length > 0) {
        const cs = expandedSkillSet[skillIndex % expandedSkillSet.length]
        let mpCost = Math.floor((isArtifact ? (cs?.skills?.mp_cost||0)*2 : (cs?.skills?.mp_cost||0)) * passiveMpCostMult)
        // マナボルト: 現在MPの20%（最低1）を消費
        if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(playerMp * 0.2))
        if (cs?.skills?.name === '天墜竜閃' && playerBuffs.tenkaiCharge?.turns > 0) mpCost = 0  // 解放ターンはMP消費なし（溜め時に消費済み）
        // ブリーダー：ペット系コマンド（ペット不在/MP不足は失敗＝通常攻撃へフォールバック）
        if (cs?.skills && BREEDER_PET_SKILLS.has(cs.skills.name)) {
          const petAlive = petActive && petHp > 0
          if (petAlive && playerMp >= mpCost) {
            playerMp -= mpCost
            const nm = cs.skills.name
            if (nm === '攻撃して！') doPetAttack(rtCur>=2?3.5:3.0, '攻撃して！')
            else if (nm === 'やっちゃえ！') doPetAttack(rtCur>=5?6.0:5.0, 'やっちゃえ！')
            else if (nm === '一緒に頑張ろう！') {
              const t = rtCur>=3?6:3
              playerBuffs.breederDmgUp = { turns:t, rate:1.5 }
              logs.push({ text:`${prefix}一緒に頑張ろう！ ${t}ターンの間、自分とペットの与ダメージ+50%！`, color:'#ffcc66' })
            } else if (nm === '休憩しよう！') {
              const ph = Math.floor(maxHp*0.2); playerHp = Math.min(maxHp, playerHp + ph)
              const pph = Math.floor(petMaxHp*0.2); petHp = Math.min(petMaxHp, petHp + pph)
              let cutTxt = ''
              if (rtCur>=4) { playerBuffs.dmgReduce = { turns:1, rate:0.7 }; petBuffs.reduce = 0.3; petBuffs.reduceTurns = 1; cutTxt = ' 1ターン被ダメ30%カット！' }
              logs.push({ text:`${prefix}休憩しよう！ 自分のHP+${ph}・ペットのHP+${pph}！${cutTxt}`, color:'#66ddaa' })
            }
            skillIndex++
            playerAttacking = false
            return
          } else if (!petAlive) {
            logs.push({ text:`${prefix}${cs.skills.name}！ しかしペットがいない…通常攻撃になった！`, color:'#888888' })
            // skillUsed=false のまま下の通常攻撃へフォールバック（MP消費なし）
          }
          // ※petAlive かつ MP不足のときは下の MP不足ログ＋通常攻撃に流れる（BREEDER_PET_SKILLSは executeSkill 対象外）
        }
        if (cs && cs.skills && !BREEDER_PET_SKILLS.has(cs.skills.name) && playerMp >= mpCost) {
          playerMp -= mpCost
          const hasGensoKyomei = passiveNames.includes('元素共鳴')
          const gensoMult = (hasGensoKyomei && prevSkillName && prevSkillName !== cs.skills.name && cs.skills.type === '魔法攻撃') ? (pe('元素使い')?1.50:1.30) : 1.0
          // 精密照準（再修練）：同スキルを連続使用するたびに与ダメ+10%・クリ率+2%（重複3／別スキルでリセット）
          if (hasSeimitsu && pe('魔銃士')) {
            seimitsuStacks = (prevSkillName && prevSkillName === cs.skills.name) ? Math.min(3, seimitsuStacks + 1) : 0
          }
          const seimitsuMult = 1 + 0.10 * seimitsuStacks
          const seimitsuCritBonus = 2 * seimitsuStacks
          prevSkillName = cs.skills.name
          const res = executeSkill(cs.skills, {...effBuff, lastMpCost:mpCost}, battleProfile, enemy, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
          // 第六感（再修練）：これまでの魔法攻撃ヒット数に応じ全与ダメ+5%/スタック（最大6＝+30%）
          const rokkanMult = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05 * Math.min(6, rokkanStacks)) : 1.0
          const bcr = res.bonusCritRate || 0
          const finalCrit = res.dmg > 0 && (isCrit || ((bcr + seimitsuCritBonus) > 0 && Math.random()*100 < playerCritRate + bcr + seimitsuCritBonus))
          const finalCritMult = finalCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
          const tosoMult = hasTosoHonno ? (playerHp <= maxHp * 0.3 ? (pe('体術師')?2.0:1.6) : playerHp <= maxHp * 0.5 ? (pe('体術師')?1.4:1.2) : 1.0) : 1.0  // 闘争本能：HP50%以下/30%以下で与ダメ強化（再修練で増加）
          // 居合の構え：物理攻撃スキルのみ物理ダメ強化（魔法には乗らない）
          const iaiMult = (cs.skills?.type === '物理攻撃') ? iaiPhysMult : 1.0
          // ②DEFスケーリング：物理=ATK/(ATK+敵DEF)、魔法=MATK/(MATK+敵MDEF)
          let defScale = 1.0
          if (res.dmg > 0) {
            const sType = cs.skills?.type
            const skillCls = cs.skills?.class_name
            const buffPen = playerBuffs.mukyoPen?.turns > 0 ? playerBuffs.mukyoPen.rate : 0  // 明鏡止水(rt4)等の防御貫通バフ
            const spMdefPen = playerBuffs.spiritMdefPen?.turns > 0 ? playerBuffs.spiritMdefPen.rate : 0  // ノクス：魔法防御貫通バフ
            const adjED  = Math.max(1, Math.floor((enemy.def ||0)*eDefRate*(1-Math.min(0.8,(res.defPen||0)+buffPen))))
            const adjEMD = Math.max(1, Math.floor((enemy.mdef||0)*eMdefRate*(1-Math.min(0.8,(res.mdefPen||0)+spMdefPen))))
            // サイコブラスト/マインドブレイク等、およびサイキッカー・魔銃士の全スキルは敵DEF・MDEFの低い方で軽減
            const useLowDef = cs.skills?.name === 'サイコブラスト' || res.useMinDef || skillCls === 'サイキッカー' || skillCls === '魔銃士'
            if (res.physScaleMatk) {
              // 物理ダメージ（敵DEFで軽減）だが火力参照は特殊攻撃（オオカミ召喚など）
              defScale = effBuff.matk / (effBuff.matk + adjED)
            } else if (useLowDef) {
              defScale = effBuff.matk / (effBuff.matk + Math.min(adjED, adjEMD))
            } else if (sType === '物理攻撃') defScale = effBuff.atk  / (effBuff.atk  + adjED)
            else if (sType === '魔法攻撃') defScale = effBuff.matk / (effBuff.matk + adjEMD)
          }
          const allinDebuffOutMult = playerBuffs.allinDebuff?.turns > 0 ? 0.7 : 1.0
          const enemyDmgReduceMult = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
          // 半月蹴りの溜め：次のダメージスキルの威力を強化（消費）
          const nextBoostMult = (res.dmg > 0 && playerBuffs.nextSkillBoost) ? playerBuffs.nextSkillBoost.rate : 1.0
          if (nextBoostMult > 1.0 && cs.skills?.name !== '半月蹴り') res.newPlayerBuffs.nextSkillBoost = undefined
          // 多段ヒットスキル：1発ごとに回避・クリティカル・ダメージ判定（パピアにも1発ごとに1ダメージ）
          const isMulti = Array.isArray(res.hitDmgs) && res.hitDmgs.length > 0 && res.dmg > 0
          let finalDmg, resLog, multiCritAny = false
          if (isMulti) {
            const hitMult = defScale * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * enemyDmgReduceMult * nextBoostMult
            const parts = []
            finalDmg = 0
            for (const hd of res.hitDmgs) {
              if (baseEnemyEvasion > 0 && Math.random()*100 < baseEnemyEvasion) { parts.push('回避された！'); continue }
              const hCrit = Math.random()*100 < (playerCritRate + (res.bonusCritRate||0) + seimitsuCritBonus)
              const hMult = hCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
              let hDmg = Math.max(1, Math.floor(hd * hitMult * hMult * (0.9 + Math.random()*0.2)))
              if (enemy.isPapia) hDmg = 1
              if (hCrit) multiCritAny = true
              finalDmg += hDmg
              parts.push(`${hDmg}ダメージ！${hCrit ? '💥' : ''}`)
            }
            resLog = `${res.log.split('！')[0]}！ ${enemy.name}に ${parts.join(' ')}`
          } else {
            finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * enemyDmgReduceMult * nextBoostMult * (0.9 + Math.random() * 0.2))
            if (enemy.isPapia && res.dmg > 0) finalDmg = 1
            resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
          }
          if (res.selfDmg > 0) playerHp = Math.max(0, playerHp - res.selfDmg)
          enemyHp -= finalDmg
          // 第六感（再修練）：魔法攻撃がヒットしたらスタック+1（最大6・戦闘中持続）
          if (hasRokkan && pe('サイキッカー') && finalDmg > 0 && cs.skills?.type === '魔法攻撃') rokkanStacks = Math.min(6, rokkanStacks + 1)
          if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
            enemyBuffs.healDown = { turns: 2, rate: 0.7 }
            logs.push({ text: `🗡 ${equippedWeaponItem?.weapons?.name || '武器'}の効果！ ${enemy.name}の回復力が2ターンの間-30%！`, color: '#ff8844' })
          }
          if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_spd_down_5') {
            // 濡羽杖アマザネ: 攻撃ヒット時 2Tの間対象SPD-5%（最大4重複=-20%・ヒット毎に持続リフレッシュ）
            const curSd = enemyBuffs.spdDown
            const amzSt = Math.min(4, ((curSd?.turns > 0 && curSd.amazaneStacks) || 0) + 1)
            const amzRate = Math.round((1 - 0.05 * amzSt) * 100) / 100
            // 他ソースのより強いspdDownが掛かっている間は上書きしない
            if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) {
              enemyBuffs.spdDown = { turns: 2, rate: amzRate, amazaneStacks: amzSt }
            }
          }
          applyEvoHitEffects(finalDmg)
          const healUpMult = playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1
          const healAmt = playerBuffs.healSeal?.turns > 0 ? 0 : Math.floor(res.heal * passiveHealMult * healUpMult)
          playerHp = Math.min(maxHp, playerHp + healAmt)
          if (passiveHealReflect && healAmt > 0) {
            const reflectDmg = healAmt  // 神聖加護強化：回復量の100%を反射
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
          // 直前に付与した武器デバフ(回復ダウン/素早さダウン等)を捨てないようマージ（=で置換すると消える）
          playerBuffs = { ...playerBuffs, ...res.newPlayerBuffs }; enemyBuffs = { ...enemyBuffs, ...res.newEnemyBuffs }
          // 精霊共鳴：同じ精霊召喚を3回使うたび、次の行動で確定追加行動
          if (passiveNames.includes('精霊共鳴') && playerBuffs.spiritCombo?.tripled) {
            playerBuffs.guaranteedExtra = true
            playerBuffs.spiritCombo = { ...playerBuffs.spiritCombo, tripled:false }
            logs.push({ text:`🌟 精霊共鳴！ 精霊の力が高まり、追加行動を得る！`, color:'#ffdd66' })
          }
          const critInsert = (finalCrit && !isMulti) ? '💥クリティカル！ ' : ''
          const dmgIdx = resLog.indexOf(enemy.name + 'に')
          const logWithCrit = critInsert
            ? (dmgIdx >= 0 ? resLog.slice(0, dmgIdx) + critInsert + resLog.slice(dmgIdx) : resLog + ' ' + critInsert)
            : resLog
          logs.push({ text:`${prefix}${logWithCrit}`, color:(finalCrit && !isMulti) || multiCritAny ? '#ffff00' : '#88ccff' })
          // 追撃（影歩き/出血消費など）を別ヒットとして適用：メインとは独立したダメージ判定
          if (res.followup && res.followup.dmg > 0) {
            const fCrit = Math.random()*100 < (playerCritRate + (res.bonusCritRate||0))
            const fCritMult = fCrit ? (1.5 + (eff.critDmg||0) + passiveCritDmgBonus) : 1.0
            let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * enemyDmgReduceMult * (0.9 + Math.random()*0.2))
            if (enemy.isPapia) fDmg = 1
            fDmg = Math.max(1, fDmg)
            enemyHp -= fDmg
            logs.push({ text:`↳ 追撃！${res.followup.label?`（${res.followup.label}）`:''} ${enemy.name}に${fDmg}ダメージ！${fCrit?' 💥クリティカル！':''}`, color: fCrit?'#ffaa00':'#ffaa66' })
          }
          if (playerAttacking && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
            const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(maxHp * 0.2))
            playerHp = Math.min(maxHp, playerHp + rageCure)
            logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
          }
          // 神聖覚醒：攻撃ごとに追撃
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
        // ②通常攻撃: ATK²/(ATK+敵DEF)
        const baseDmg = Math.max(1, Math.floor(baseAtk*baseAtk/Math.max(1,baseAtk+eDefVal))+Math.floor(Math.random()*4))
        const enemyDmgReduceMult2 = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
        const breederDmgMult = playerBuffs.breederDmgUp?.turns > 0 ? playerBuffs.breederDmgUp.rate : 1.0
        const iaiNormalMult = isMagical ? 1.0 : iaiPhysMult  // 居合の構え：物理通常攻撃のみ強化
        const rokkanMultN = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05 * Math.min(6, rokkanStacks)) : 1.0
        // 通常攻撃でスキル連続が途切れる → 精密照準/元素共鳴のチェーンをリセット
        seimitsuStacks = 0; prevSkillName = null
        let finalDmg = Math.floor(baseDmg*0.7*critMult*(isArtifact?1.3:1.0)*passiveDmgMult*iaiNormalMult*rokkanMultN*enemyDmgReduceMult2*breederDmgMult*(0.9+Math.random()*0.2))
        if (enemy.isPapia) finalDmg = 1
        enemyHp -= finalDmg
        if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
          enemyBuffs.healDown = { turns: 2, rate: 0.7 }
          logs.push({ text: `🗡 ${equippedWeaponItem?.weapons?.name || '武器'}の効果！ ${enemy.name}の回復力が2ターンの間-30%！`, color: '#ff8844' })
        }
        if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_spd_down_5') {
          // 濡羽杖アマザネ: 攻撃ヒット時 2Tの間対象SPD-5%（最大4重複=-20%・ヒット毎に持続リフレッシュ）
          const curSd = enemyBuffs.spdDown
          const amzSt = Math.min(4, ((curSd?.turns > 0 && curSd.amazaneStacks) || 0) + 1)
          const amzRate = Math.round((1 - 0.05 * amzSt) * 100) / 100
          // 他ソースのより強いspdDownが掛かっている間は上書きしない
          if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) {
            enemyBuffs.spdDown = { turns: 2, rate: amzRate, amazaneStacks: amzSt }
          }
        }
        applyEvoHitEffects(finalDmg)
        // 蒼雷の短刃: 追加行動の攻撃ヒット時、eff.extraParaChance%で相手を麻痺
        if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(enemyBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
          enemyBuffs.paralysis = { turns: 3, skipRate: 0.25, spdRate: 0.8 }
          logs.push({ text: `⚡ 蒼雷の短刃の追撃！ ${enemy.name}を麻痺させた！`, color: '#ffe066' })
        }
        const critText = isCrit ? '💥クリティカル！ ' : ''
        logs.push({ text:`${prefix}${critText}攻撃！ ${enemy.name}に${finalDmg}ダメージ！`, color:'#ffcc00' })
        if (playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const rageCure = Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(maxHp * 0.2))
          playerHp = Math.min(maxHp, playerHp + rageCure)
          logs.push({ text:`🩸 血の狂気で${rageCure}回復！`, color:'#ff4444' })
        }
        // 通常攻撃は精霊召喚でも神降ろしでもない → コンボ/連続使用ロックを解除
        if (playerBuffs.spiritCombo) playerBuffs.spiritCombo = undefined
        if (playerBuffs.kinjutsuLock) playerBuffs.kinjutsuLock = undefined
        if (expandedSkillSet.length > 0) skillIndex++
      }
      playerAttacking = false
    }

    const doEnemyAttack = (isExtra=false) => {
      // ブリーダー：ペット生存中は50%で敵がペットを狙う（ペットは独自の防御で軽減・素早さ無関係）
      if (petActive && petHp > 0 && Math.random() < 0.5) {
        const isEM = enemy.type === 'magical'
        const eAtk = isEM ? (enemy.matk||0)*(enemyBuffs.matkUp?.rate||1) : enemy.atk*(enemyBuffs.atkUp?.rate||1)
        const petDefVal = Math.max(1, isEM ? petMdef : petDef)
        const baseDmg = Math.max(1, Math.floor(eAtk*eAtk/Math.max(1,eAtk+petDefVal)))
        const cut = petBuffs.reduceTurns > 0 ? (1 - petBuffs.reduce) : 1.0
        let dmg = Math.max(1, Math.floor(baseDmg * cut * (0.9 + Math.random()*0.2)))
        petHp = Math.max(0, petHp - dmg)
        const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
        logs.push({ text:`${prefix}${enemy.name}はペットを攻撃！ ペットに${dmg}ダメージ！（残りHP${petHp}）`, color:'#ff8844' })
        if (petHp <= 0) logs.push({ text:`💥 ペットは倒れてしまった…`, color:'#ff4444' })
        return
      }
      const holyFieldDefE = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
      const holyKnightMultE = hasHolyKnightPassive ? (pe('聖騎士')?2.0:1.5) : 1.0
      const kabeDefE = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
      const pDef  = eff.def  * (playerBuffs.defUp  ? playerBuffs.defUp.rate  : 1) * holyFieldDefE * holyKnightMultE * ryurinMult * kabeDefE
      const pMdef = eff.mdef * (playerBuffs.mdefUp ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp ? playerBuffs.defUp.rate : 1) * (playerBuffs.mdefDown ? playerBuffs.mdefDown.rate : 1) * holyFieldDefE * holyKnightMultE * ryurinMult * kabeDefE
      const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
      const berserkDmgRate = hasBerserk ? (pe('狂戦士')?1.20:1.15) : 1.0  // バーサク：被ダメ+15%（再修練3で+20%）
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
      const enemySpdDebuff = enemyBuffs.spdDown?.turns > 0 ? enemyBuffs.spdDown.rate : 1  // 濡羽杖アマザネ/スライムの指輪等
      const effectiveEnemySpd = enemySpd * enemySpdBuff * enemySpdDebuff
      const evasionRate = calcEvasionRate(effectivePlayerSpd, effectiveEnemySpd) + (eff.evasionBonus || 0) + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0) + (hasOnmi ? 5 : 0)
      if (evasionRate > 0 && Math.random()*100 < evasionRate) {
        const prefix = isExtra ? '追加攻撃！ ' : `${turn}ターン目: `
        logs.push({ text:`${prefix}${enemy.name}の攻撃！ しかし回避した！`, color:'#44ff88' })
        // ボス装備 真化: 影踏みのブーツ — 回避時2ターン素早さ+10%
        if (eff.evoEvadeSpdUp && !(playerBuffs.spdUp?.turns > 0 && playerBuffs.spdUp.rate >= 1.1)) {
          playerBuffs.spdUp = { turns: 2, rate: 1.1 }
          logs.push({ text:`💨 真化効果！ 回避して素早さ+10%（2ターン）！`, color:'#66ccff' })
        }
        return
      }

      const enemyDmgDownRate = enemyBuffs.dmgDown?.turns > 0 ? enemyBuffs.dmgDown.rate : 1.0
      // ③プレイヤーDEFランクによるボーナス軽減
      const playerDefRankReduction = calcDefReduction(isEM ? eff.mdef : eff.def)
      const gambleBodyMult = hasGambleBody ? (pe('ギャンブラー') ? (0.5 + Math.random()*0.7) : (0.7 + Math.random()*0.6)) : 1.0  // 通常0.7〜1.3／再修練0.5〜1.2
      const allinDebuffInMult = playerBuffs.allinDebuff?.turns > 0 ? 1.3 : 1.0
      // ボス装備 真化: 被ダメージ%軽減（海竜の鱗=全体-5% / 蒼粘剣=物理-10%）
      const evoTakenMult = (eff.evoDmgTakenMult||1) * (!isEM ? (eff.evoPhysDmgTakenMult||1) : 1)
      const finalDmg = Math.floor(baseDmg*(isCrit?1.5:1.0)*dmgReduceRate*berserkDmgRate*enemyDmgDownRate*(1-playerDefRankReduction)*gambleBodyMult*allinDebuffInMult*ryurinReduce()*evoTakenMult*(0.9+Math.random()*0.2))
      playerHp -= finalDmg
      onPlayerDamaged(finalDmg)
      if (playerBuffs.dmgReduce?.isGainoKabe) playerBuffs.dmgReduce = null
      // 陰陽結界：軽減した分の一定割合を回復
      if (playerBuffs.onmyoHeal?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
        const oh = playerBuffs.onmyoHeal
        const healBack = Math.floor(finalDmg * (oh.reduce / (1 - oh.reduce)) * oh.healRate)
        if (healBack > 0) {
          playerHp = Math.min(maxHp, playerHp + healBack)
          logs.push({ text:`🔯 陰陽結界！ 軽減した分から${healBack}回復した！`, color:'#66ddaa' })
        }
      }
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
          bossHeal1Used = true; bossHeal2Used = true
          const result = executeEnemySkill(healSkill, enemy, enemyHp, enemyMaxHp, playerHp, maxHp, playerBuffs, enemyBuffs, logs, eff, playerPassiveDefMult(), ryurinReduce())
          enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
          Object.assign(enemyBuffs, result.newEnemyBuffs)
          return
        } else if (!bossHeal1Used && hpRate <= 0.6) {
          bossHeal1Used = true
          const result = executeEnemySkill(healSkill, enemy, enemyHp, enemyMaxHp, playerHp, maxHp, playerBuffs, enemyBuffs, logs, eff, playerPassiveDefMult(), ryurinReduce())
          enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
          Object.assign(enemyBuffs, result.newEnemyBuffs)
          return
        }
      }
      // 大技：HP10%以下で1回限り
      if (enemy.specialMove && !bossSpecialUsed && enemyHp / enemyMaxHp <= 0.1) {
        bossSpecialUsed = true
        logs.push({ text:`💥 ${enemy.name}の「${enemy.specialMove.name}」！！`, color:'#ff0000' })
        const result = executeEnemySkill(enemy.specialMove, enemy, enemyHp, enemyMaxHp, playerHp, maxHp, playerBuffs, enemyBuffs, logs, eff, playerPassiveDefMult(), ryurinReduce())
        damageTarget(result.dmgToPlayer, !((enemy.specialMove.type||'').includes('magical')))
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
          const result = executeEnemySkill(buffSkill, enemy, enemyHp, enemyMaxHp, playerHp, maxHp, playerBuffs, enemyBuffs, logs, eff, playerPassiveDefMult(), ryurinReduce())
          damageTarget(result.dmgToPlayer)
          Object.assign(playerBuffs, result.newPlayerBuffs)
          Object.assign(enemyBuffs, result.newEnemyBuffs)
          return
        } else if (!bossBuff1Used && hpRate <= 0.7) {
          bossBuff1Used = true
          const buffSkill = buffSkills[0]
          logs.push({ text:`⚡ ${enemy.name}の「${buffSkill.name}」！`, color:'#ff8844' })
          const result = executeEnemySkill(buffSkill, enemy, enemyHp, enemyMaxHp, playerHp, maxHp, playerBuffs, enemyBuffs, logs, eff, playerPassiveDefMult(), ryurinReduce())
          damageTarget(result.dmgToPlayer)
          Object.assign(playerBuffs, result.newPlayerBuffs)
          Object.assign(enemyBuffs, result.newEnemyBuffs)
          return
        }
      }
      // 攻撃/デバフスキル
      const nonHealSkills = enemy.skills.filter(s => s.type !== 'heal' && s.type !== 'buff')
      if (nonHealSkills.length === 0) return
      const skill = nonHealSkills[Math.floor(Math.random()*nonHealSkills.length)]
      const result = executeEnemySkill(skill, enemy, enemyHp, enemyMaxHp, playerHp, maxHp, playerBuffs, enemyBuffs, logs, eff, playerPassiveDefMult(), ryurinReduce())
      damageTarget(result.dmgToPlayer, !((skill.type||'').includes('magical')))
      enemyHp = Math.min(enemyMaxHp, enemyHp + result.healEnemy)
      Object.assign(playerBuffs, result.newPlayerBuffs)
      Object.assign(enemyBuffs, result.newEnemyBuffs)
    }

    // ブリーダー：ペットの攻撃（自動攻撃・コマンド共通）。素早さ非依存、敵回避は受ける
    const doPetAttack = (mult, label) => {
      if (!petActive || petHp <= 0) return
      const baseEv = Math.max(0, enemyEvasionRate) + (enemy.isPapia ? 50 : 0)
      if (baseEv > 0 && Math.random()*100 < baseEv) {
        logs.push({ text:`🐾 ペットの${label}！ しかし${enemy.name}に回避された！`, color:'#446688' })
        return
      }
      const isSpec = petAtkType === 'spec'
      const edr = (enemyBuffs.defDown?.rate||1)*(enemyBuffs.defUp?.rate||1)
      const emr = (enemyBuffs.mdefDown?.rate||1)*(enemyBuffs.mdefUp?.rate||1)
      const adjDef = Math.max(1, Math.floor(isSpec ? (enemy.mdef||0)*emr : (enemy.def||0)*edr))
      const base = petAtk * mult
      const dmgUp = playerBuffs.breederDmgUp?.turns > 0 ? playerBuffs.breederDmgUp.rate : 1.0
      let dmg = Math.max(1, Math.floor(base * (base/(base+adjDef)) * dmgUp * (0.9 + Math.random()*0.2)))
      if (enemy.isPapia) dmg = 1
      enemyHp -= dmg
      let extra = ''
      if (rtCur >= 1 && !enemy.isPapia) {
        if (petSpecies === 'flame' && Math.random()*100 < 30) { const b=enemyBuffs.bleed; enemyBuffs.bleed={stacks:Math.min(5,(b?.stacks||0)+1),lastTurn:0}; extra=` ${enemy.name}は出血した！` }
        else if (petSpecies === 'aqua' && Math.random()*100 < 40) { enemyBuffs.spdDown={turns:3,rate:0.7}; extra=' 素早さ低下！' }
        else if (petSpecies === 'leaf') { const sr=enemyBuffs.stunResist??1.0; if (Math.random()*100 < 30*sr) { enemyBuffs.stun={turns:1}; enemyBuffs.stunResist=sr*0.5; extra=' スタン！' } }
      }
      logs.push({ text:`🐾 ペットの${label}！ ${enemy.name}に${dmg}ダメージ！${extra}`, color:'#ffaa44' })
    }
    // ブリーダー：敵スキル等のダメージも50%でペットが受ける（ペット生存時）
    const damageTarget = (dmg, isPhysical = true) => {
      if (dmg <= 0) { return }
      if (petActive && petHp > 0 && Math.random() < 0.5) {
        const cut = petBuffs.reduceTurns > 0 ? (1 - petBuffs.reduce) : 1.0
        const d = Math.max(1, Math.floor(dmg * cut))
        petHp = Math.max(0, petHp - d)
        logs.push({ text:`↳ 攻撃はペットに！ ペットに${d}ダメージ！（残りHP${petHp}）`, color:'#ff8844' })
        if (petHp <= 0) logs.push({ text:`💥 ペットは倒れてしまった…`, color:'#ff4444' })
      } else {
        // ボス装備 真化: 被ダメージ%軽減（プレイヤーが受ける時のみ・敵スキルにも適用）
        const evoTakenMult = (eff.evoDmgTakenMult||1) * (isPhysical ? (eff.evoPhysDmgTakenMult||1) : 1)
        if (evoTakenMult !== 1) dmg = Math.max(1, Math.floor(dmg * evoTakenMult))
        playerHp -= dmg
        onPlayerDamaged(dmg)
        // 陰陽結界：敵スキルダメージでも軽減分の一定割合を回復
        if (playerBuffs.onmyoHeal?.turns > 0 && dmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const oh = playerBuffs.onmyoHeal
          const healBack = Math.floor(dmg * (oh.reduce / (1 - oh.reduce)) * oh.healRate)
          if (healBack > 0) {
            playerHp = Math.min(maxHp, playerHp + healBack)
            logs.push({ text:`🔯 陰陽結界！ 軽減した分から${healBack}回復した！`, color:'#66ddaa' })
          }
        }
      }
    }
    if (petActive) logs.push({ text:`🐾 ペットを召喚！（HP${petMaxHp}）`, color:'#ffcc66' })

    while (playerHp > 0 && enemyHp > 0 && turn <= 50) {
      const hpBeforeTurn = playerHp  // 雷鋼の機神鎧: このターンに被ダメしたか判定用
      if (passiveNames.includes('骸の壁') && (turn === 1 || turn % 4 === 0)) {
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
        const spDmgP = Math.floor(maxHp * 0.05)
        playerHp = Math.max(0, playerHp - spDmgP)
        logs.push({ text:`🤢 猛毒ダメージ！ あなたに${spDmgP}ダメージ！`, color:'#aa44ff' })
        if (playerHp <= 0) break
      }
      if (playerBuffs.burn?.turns > 0) {
        const burnDmgP = Math.floor(maxHp * 0.02)
        playerHp = Math.max(0, playerHp - burnDmgP)
        logs.push({ text:`🔥 やけどダメージ！ あなたに${burnDmgP}ダメージ！`, color:'#ff6622' })
        if (playerHp <= 0) break
      }
      if (playerBuffs.bleed) {
        const bleedDmgP = Math.floor(playerHp * 0.01 * playerBuffs.bleed.stacks)  // 現在HPの1%×スタック
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
      // 式神召喚（パッシブ）：毎ターン終了後、特殊攻撃力×0.5（再修練1で0.8）の式神攻撃
      if (passiveNames.includes('式神召喚')) {
        const shikiMult = rtCur >= 1 ? 0.8 : 0.5
        const eMdefR = (enemyBuffs.mdefDown ? enemyBuffs.mdefDown.rate : 1) * (enemyBuffs.mdefUp ? enemyBuffs.mdefUp.rate : 1)
        const adjEMD = Math.max(1, Math.floor((enemy.mdef||0) * eMdefR))
        let shikiDmg = Math.max(1, Math.floor(eff.matk * shikiMult * (eff.matk/(eff.matk + adjEMD)) * (0.9 + Math.random()*0.2)))
        if (enemy.isPapia) shikiDmg = 1
        enemyHp -= shikiDmg
        logs.push({ text:`👹 式神の攻撃！ ${enemy.name}に${shikiDmg}の特殊ダメージ！`, color:'#cc88ff' })
        if (enemyHp <= 0) break
      }
      // ブリーダー：召喚ペットの毎ターン自動攻撃（×1.0）
      if (petActive && petHp > 0) {
        doPetAttack(1.0, 'こうげき')
        if (enemyHp <= 0) break
      }
      const isHealSealed = playerBuffs.healSeal?.turns > 0
      if (isHealSealed) {
        logs.push({ text:`🚫 回復封じ中！ 回復効果が無効化された！`, color:'#ff4488' })
      }
      if (!isHealSealed && playerBuffs.regenHeal?.turns > 0) {
        const healAmt = Math.floor(playerBuffs.regenHeal.amount * passiveHealMult * (playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1))
        playerHp = Math.min(maxHp, playerHp + healAmt)
        logs.push({ text:`💚 回復効果でHPが${healAmt}回復した！`, color:'#44ff88' })
        if (passiveHealReflect && healAmt > 0) {
          const reflectDmg = healAmt  // 神聖加護強化：回復量の100%を反射
          enemyHp -= reflectDmg
          logs.push({ text:`✨ 神聖加護の反射！ ${enemy.name}に${reflectDmg}ダメージ！`, color:'#ffdd44' })
        }
      }
      if (playerBuffs.regenMp?.turns > 0) {
        const mpAmt = Math.floor(maxMp * playerBuffs.regenMp.rate)
        if (mpAmt > 0 && playerMp < maxMp) {
          playerMp = Math.min(maxMp, playerMp + mpAmt)
          logs.push({ text:`🔵 魔力供給でMPが${mpAmt}回復した！`, color:'#4488ff' })
        }
      }
      if (!isHealSealed && playerBuffs.delayHeal && turn === playerBuffs.delayHeal.triggerTurn) {
        playerHp = Math.min(maxHp, playerHp + playerBuffs.delayHeal.amount)
        logs.push({ text:`💚 装備効果でHPが${playerBuffs.delayHeal.amount}回復した！`, color:'#44ff88' })
      }
      if (!isHealSealed && currentItem) {
        const threshold = currentItem.use_threshold||50
        const effect = currentItem.items.effect
        const isInfinite = effect === 'hp_pct_infinite' || effect === 'mp_pct_infinite'
        const onCooldown = (playerBuffs.potionCooldown?.turns || 0) > 0
        const canUse = isInfinite ? !onCooldown : !itemUsed
        if (canUse) {
          if ((effect==='hp_pct' || effect==='hp_pct_infinite') && playerHp/maxHp*100 <= threshold) {
            const healAmt = Math.floor(maxHp*currentItem.items.value/100)
            playerHp = Math.min(maxHp, playerHp+healAmt)
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
          } else if ((effect==='mp_pct' || effect==='mp_pct_infinite') && playerMp/maxMp*100 <= threshold) {
            const healAmt = Math.floor(maxMp*currentItem.items.value/100)
            playerMp = Math.min(maxMp, playerMp+healAmt)
            logs.push({ text:`🧪 ${currentItem.items.name}を使用！ MPが${healAmt}回復した！`, color:'#4488ff' })
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
        // 精霊共鳴：確定追加行動（消費）
        const spiritExtra = !!playerBuffs.guaranteedExtra
        if (playerBuffs.guaranteedExtra) playerBuffs.guaranteedExtra = false
        // 天墜竜閃の溜めターンは追加行動なし
        if (!(playerBuffs.tenkaiCharge?.turns > 0) && (spiritExtra || (playerExtraRate > 0 && Math.random()*100 < playerExtraRate))) {
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
        const bleedDmg = Math.floor(enemyHp * 0.01 * enemyBuffs.bleed.stacks)  // 現在HPの1%×スタック
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
      if (petBuffs.reduceTurns > 0) petBuffs.reduceTurns--
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
      // turns が0になった一時バフ/デバフを掃除する。
      // atkDown/defUp/spdDown 等は「truthy ? rate : 1」で読まれる箇所があり、削除しないと
      // turns:0 のまま効果が永続してしまう（減衰ループは0を再減算しないため）。
      // ※ berserk/spellBladeExhaust/allinActive の turns===0 ハンドラは上で処理済み。
      //   charges 等 turns を持たないバフ（ailmentShield 等）は turns===0 にならず対象外。
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
      if (bossHealCooldown > 0) bossHealCooldown--
      // 毎ターン終了時のHPスナップショット（表示用）
      logs.push({ type:'hp', turn, playerHp:Math.max(0,playerHp), playerMax:maxHp, playerName:profile.username, enemyHp:Math.max(0,enemyHp), enemyMax:enemyMaxHp, enemyName:enemy.name, playerStatus:extractStatuses(playerBuffs), enemyStatus:extractStatuses(enemyBuffs), petHp: petActive ? Math.max(0,petHp) : null, petMax: petActive ? petMaxHp : null })
      turn++
    }

    playerHp = Math.max(0, playerHp)
    const win = enemyHp <= 0
    // ★2026-06-26 10秒モード(is_admin先行): 出撃EXP 5-6 / ボス 7 / Gold半分（クライアントが低い値を送るのみ。サーバー上限は20秒モードの高い方のままなので検証は通る＝誤検知なし）
    const tenSec = is10sMode(profile)
    let expGained = isAtCap ? 0
      : papiaEscaped ? 0
      : isPapiaEncounter ? 150
      : isBossEncounter ? (tenSec ? 7 : 13)
      : tenSec ? (Math.floor(Math.random()*2)+5) : (Math.floor(Math.random()*4)+8)
    // キャラクターLV100まで経験値1.5倍（サーバー apply_battle_result の検証上限も1.5倍にしてある）
    const expBoosted = expGained > 0 && (profile.char_lv||1) < 100
    if (expBoosted) expGained = Math.floor(expGained * 1.5)
    const expBoostNote = expBoosted ? '（✨LV100まで経験値1.5倍）' : ''
    // 出撃ゴールド。雑魚は各エリアの設定値（=10秒モードの取得額）そのまま。20秒モードは2倍。
    // ★2026-07-04: 旧CD補正のエリア別倍率(×2/×1.5)は廃止。ボスのみ従来補正を維持（設定Goldは据置）。
    // 【変異】段階のGold（エリア⑤相当）。変異ボス撃破=9000。雑魚は「そのエリアの変異ボスを1回撃破済み」かつ変異トグルON時のみ強化。
    const mutantCleared = mutantEnabled && mutantHigh && (profile.mutant_cleared_areas || []).includes(selectedArea)
    const goldGained = (() => {
      if (!win || papiaEscaped) return 0
      if (!isPapiaEncounter) {
        if (useMutantBoss) return Math.floor((enemy.gold || 6000) * 1.5 * (tenSec ? 0.5 : 1))  // 変異ボス撃破=エリア⑤相当
        if (!isBossEncounter && mutantCleared) return Math.floor((AREAS[4].enemies[enemyIdx]?.gold || 270) * (tenSec ? 1 : 2))  // 撃破済みエリアの雑魚（エリア⑤相当）
      }
      if (isBossEncounter) return Math.floor((enemy.gold || 0) * (selectedArea <= 4 ? 2 : 1.5) * (tenSec ? 0.5 : 1))  // ボスは従来のCD補正を維持
      return Math.floor((enemy.gold || 0) * (tenSec ? 1 : 2))  // 雑魚: 10秒=設定値 / 20秒=2倍
    })()


    if (!papiaEscaped) {
      if (win) {
        logs.push({ text:`${enemy.name}を倒した！`, color:'#44ff88' })
        if (isAtCap) {
          logs.push({ text:`⚠ ${profile.class}はレベルキャップに達しています。経験値は入りません。`, color:'#ff8844' })
          logs.push({ text:`Gold + ${goldGained}`, color:'#ffcc00' })
        } else {
          logs.push({ text:`EXP + ${expGained}${expBoostNote}　Gold + ${goldGained}`, color:'#ffcc00' })
        }
      } else {
        logs.push({ text:`敗北…`, color:'#ff4444' })
        if (isBossEncounter) logs.push({ text:`💡 ボスに勝てないときは、商店の「魔よけのお守り」を装備するとボス戦を回避できます。`, color:'#cc44ff' })
        if (!isAtCap) logs.push({ text:`EXP + ${expGained}${expBoostNote}`, color:'#ff6644' })
      }
    }

    if (playerHp === 0) {
      logs.push({ text:`⚠ 瀕死状態！宿屋でHP全回復してください。`, color:'#ff4444' })
    }
    setBattleLogs(logs)

    if (win && !isPapiaEncounter) {
      let droppedItems = []
      // 領地ボーナス：自国がこのエリアで占める領地シェアに応じて装備ドロップ率を加算（最大+2%）
      const dropBonus = dropBonusPP(areaShareMap[area.id] || 0)
      if (isBossEncounter) {
        const dropList = area.bossDrops || []
        if (dropList.length > 0) {
          const drop0 = Math.random()*100 < (3 + dropBonus)
          const drop1 = dropList.length > 1 && Math.random()*100 < (3 + dropBonus)
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
        if (commonDrops.length > 0 && Math.random()*100 < (3 + dropBonus)) {
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
      const matEventRate = getMaterialEventStatus().active ? 2 : 1  // お宝素材2倍イベント
      if (matDrops.length > 0 && Math.random()*100 < 0.1 * matEventRate) {
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
        let profExpGained = Math.floor(Math.random()*4)+8
        profExpGained *= 2  // ★2026-06-20公開: 出撃CD20秒化の補正で武器熟練度×2
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
    let newLv = profile.lv
    let newExpNext = profile.exp_next

    if (frozenExp && expGained > 0) {
      logs.push({ text:`EXP +${expGained}（調査中につき停止）`, color:'#446688' })
      setBattleLogs([...logs])
    }

    if (!isAtCap && !frozenExp) {
      while (newExp >= newExpNext && newLv < cap) {
        newExp -= newExpNext; newLv++; newExpNext = calcExpNext(newLv, profile.is_admin)
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
        logs.push({ text:`🎯 ${profile.class}がレベルキャップ(LV${cap})に到達！`, color:'#ffcc00' })
        setBattleLogs([...logs])
      }
    }

    // ① サーバー側でGold・EXPを検証してから適用（クライアント改ざん対策）
    const { data: rpcResult, error: rpcError } = await supabase.rpc('apply_battle_result', {
      p_area_id: selectedArea,
      p_is_boss: isBossEncounter,
      p_is_papia: isPapiaEncounter,
      p_papia_escaped: papiaEscaped || false,
      p_win: win,
      p_claimed_exp: expGained,
      p_claimed_gold: goldGained,
      p_hp_current: playerHp,
      p_mp_current: playerMp,
      p_mutant_boss: !!useMutantBoss,  // 実際に変異ボスと戦ったか（トグルOFF＝通常ボスでは変異攻略を記録しない）
    })

    // ★サーバーが戦果を拒否した場合は、握り潰さず理由を表示（EXP/Goldが入らない原因の可視化）
    if (rpcError || (rpcResult && rpcResult.ok === false)) {
      const reason = rpcResult?.reason || rpcError?.message || 'unknown'
      logs.push({ text: `⚠ サーバーが戦果を適用しませんでした（理由: ${reason}）。EXP/Goldは反映されていません。`, color: '#ff4444' })
      setBattleLogs([...logs])
    }

    // 【変異】初撃破通知（サーバーが mutant_cleared_areas に記録した時だけ返る）
    if (rpcResult?.mutant_first_clear) {
      logs.push({ text: `🧬 エリア${selectedArea}の【変異】を攻略！ 以降このエリアの雑魚はエリア⑤相当のGoldを落とす！`, color: '#cc44ff' })
      setBattleLogs([...logs])
    }

    // かかし修練場のチャージ完了通知
    if (rpcResult?.scarecrow_charged) {
      logs.push({ text: `🌾 かかし修練場のチャージが1回分完了！（現在${rpcResult.scarecrow_charges}回）`, color: '#ffcc44' })
      setBattleLogs([...logs])
    }

    // ボス装備 進化ドロップ（エリアボス撃破時・サーバー側RNG。確率は grant_boss_evo_drop 内で管理＝血70%/イベント中90%/心臓0.5%）
    if (win && isBossEncounter && !isPapiaEncounter) {
      try {
        const { data: evoDrop } = await supabase.rpc('grant_boss_evo_drop', { p_area_id: selectedArea })
        if (evoDrop?.ok) {
          if (evoDrop.blood) logs.push({ text: `🩸 ${evoDrop.blood} を獲得した！`, color: '#ff6688' })
          if (evoDrop.heart) logs.push({ text: `💖 ${evoDrop.heart} を獲得した！`, color: '#ff44aa' })
          if (evoDrop.blood || evoDrop.heart) setBattleLogs([...logs])
        }
      } catch { /* RPC未適用時は無視 */ }
    }

    await fetchProfile()
    setLoading(false)
  }

  const useInn = async () => {
    if (loading || innBusyRef.current) return  // 連打・二重実行ガード（refで同期的に即ブロック）
    if (atWar) { setInnMessage('⚔ 戦争中は宿屋を利用できません。'); return }  // 戦争中はHP/MP共有のため宿屋禁止
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

    // 装備・釣り等込みの実効最大まで全回復する
    const _innEff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)

    // ★ 楽観ロック: ゴールドが読み取り時と同じ場合のみ更新（別タブが先に利用してたら失敗）
    const { data: locked } = await supabase.from('profiles').update({
      hp_current: _innEff.hp_max,
      mp_current: _innEff.mp_max,
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

  // 🔁 自動出撃[開発]: ONの間、CD明けごとに選択中エリアへ「街に戻る→出撃」を自動で繰り返す（is_admin限定）
  // 出撃できない状態（釣り中/戦争中/HP切れ/BOTチャレンジ）は自動OFFにして空振りループを防ぐ
  useEffect(() => {
    if (!autoSortie) return
    if (!profile?.is_admin) { reportDevAccess('auto_sortie', '自動出撃[開発]トグル'); setAutoSortie(false); return }
    const iv = setInterval(() => {
      const p = profileRef.current
      if (!p) return
      const hpCur = p.hp_current ?? p.hp_max
      if (hpCur <= 0 || (p.is_dying && hpCur < p.hp_max)) { setAutoSortie(false); return }
      if (p.is_fishing || atWar || botCheck) { setAutoSortie(false); return }
      if (!canAct || loading) return
      if (scene === 'battle') backToTown()
      else if (scene !== 'town') return
      doBattle()
    }, 2000)
    return () => clearInterval(iv)
  }, [autoSortie, canAct, loading, scene, botCheck, atWar, profile?.is_admin])

  // ⚡ 出撃CDモード（10秒/20秒）の変更（is_admin限定先行・週1回変更不可）
  const setSortieModeMode = async (mode) => {
    if (sortieModeLoading) return
    if (mode !== 10 && mode !== 20) return
    setSortieModeLoading(true)
    try {
      const { data, error } = await supabase.rpc('set_sortie_mode', { p_mode: mode })
      if (error) { alert('設定に失敗しました。少し待ってからお試しください。'); return }
      if (!data?.ok) {
        if (data?.reason === 'locked') alert(`出撃時間の変更は1週間に1回だけです。次に変更できるのは ${new Date(data.unlock_at).toLocaleString('ja-JP')} 以降です。`)
        else if (data?.reason === 'not_admin') alert('現在は管理者のみ変更できます。')
        else if (data?.reason === 'invalid_mode') alert('指定が不正です（10 または 20）。')
        else alert('設定に失敗しました。')
        await fetchProfile()
        return
      }
      setProfile(p => p ? { ...p, sortie_mode: data.sortie_mode, sortie_mode_set_at: new Date().toISOString() } : p)
      alert(`出撃の待機時間を ${data.sortie_mode}秒 に設定しました（1週間変更不可）`)
    } finally {
      setSortieModeLoading(false)
    }
  }

  // 🌟 パピア出現時間帯の設定（is_admin限定先行・1か月変更不可）
  const savePapiaHour = async () => {
    if (papiaHourLoading) return
    setPapiaHourLoading(true)
    try {
      const p_hour2 = papiaSel2 >= 0 ? papiaSel2 : null
      const { data, error } = await supabase.rpc('set_papia_hour', { p_hour: papiaSel, p_hour2 })
      if (error) { alert('設定に失敗しました。少し待ってからお試しください。'); return }
      if (!data?.ok) {
        if (data?.reason === 'locked') alert(`パピア時間帯は1か月に1回しか変更できません。次に変更できるのは ${new Date(data.unlock_at).toLocaleString('ja-JP')} 以降です。`)
        else if (data?.reason === 'not_admin') alert('現在は管理者のみ設定できます。')
        else if (data?.reason === 'invalid_hour') alert('時刻の指定が不正です。')
        else alert('設定に失敗しました。')
        await fetchProfile()
        return
      }
      setProfile(p => p ? { ...p, papia_hour: data.papia_hour, papia_hour2: data.papia_hour2, papia_hour_set_at: new Date().toISOString() } : p)
      const fmtH = (h) => Number.isInteger(h) ? `${String(h).padStart(2,'0')}:00〜${String(h).padStart(2,'0')}:30` : null
      const slots = [fmtH(data.papia_hour), fmtH(data.papia_hour2)].filter(Boolean).join(' と ')
      alert(`パピア出現時間帯を ${slots} に設定しました（1か月変更不可）`)
    } finally {
      setPapiaHourLoading(false)
    }
  }

  // お問い合わせの管理（全件閲覧・返信）は管理人「おれおれお」のみ。
  // 他の is_admin（えちゅ等の開発アカウント）は自分の問い合わせのみ閲覧で、返信権限なし。
  const isContactAdmin = profile?.username === 'おれおれお'

  const submitContact = async () => {
    if (!contactForm.body.trim()) return
    setContactLoading(true)
    await supabase.from('contact_messages').insert({
      player_id: profile.id,
      player_name: profile.username,
      category: contactForm.category,
      body: contactForm.body.trim(),
    })
    setContactSent(true)
    setContactLoading(false)
    fetchMyContacts()  // 履歴を最新化
  }

  const CONTACT_CAT_LABEL = { bug:'不具合報告', request:'ご意見・ご要望', ban_appeal:'アカウント停止への異議', other:'その他' }

  // 1件の問い合わせを「初回質問(body) → 初回運営返信(reply) → 以降の往復(thread)」の時系列メッセージ配列に展開
  const buildThread = (c) => {
    const msgs = [{ sender: 'user', body: c.body, at: c.created_at }]
    if (c.reply) msgs.push({ sender: 'admin', body: c.reply, at: c.reply_at || c.created_at })
    for (const t of (c.thread || [])) msgs.push({ sender: t.sender, body: t.body, at: t.created_at })
    msgs.sort((a, b) => new Date(a.at) - new Date(b.at))
    return msgs
  }
  // 最後のメッセージがユーザー＝運営の返信待ち（管理人の「未返信」判定）。
  // ただし管理人が「確認済み(admin_ack_at)」にした後、新しいユーザー発言が無ければ未返信扱いにしない
  // （例: 「直りました、ありがとう」など返信不要な締めにも対応）。
  const needsAdminReply = (c) => {
    const m = buildThread(c)
    if (m.length === 0) return true
    const last = m[m.length - 1]
    if (last.sender !== 'user') return false
    const ackAt = c.admin_ack_at ? new Date(c.admin_ack_at).getTime() : 0
    return new Date(last.at).getTime() > ackAt
  }

  // 過去のお問い合わせを取得。is_admin は全員分、一般は自分の分のみ（reply列＋thread＝往復履歴を含む）
  const fetchMyContacts = async () => {
    setContactsLoading(true)
    try {
      // 管理人が開いたタイミングで、返信済み2週間超のメッセージを自動削除（cron無し環境のフォールバック）
      if (isContactAdmin) { try { await supabase.rpc('purge_old_replied_contacts') } catch { /* 意図的に無視 */ } }
      let q = supabase.from('contact_messages').select('*').order('created_at', { ascending: false })
      if (!isContactAdmin) q = q.eq('player_id', profile.id)
      const { data, error } = await q
      if (error) throw error
      let rows = data || []
      // 各問い合わせの往復履歴(contact_thread)を取得して紐付け（未導入の旧環境は無視）
      const ids = rows.map(r => r.id)
      if (ids.length > 0) {
        try {
          const { data: th } = await supabase.from('contact_thread').select('*').in('contact_id', ids).order('created_at', { ascending: true })
          const byC = {}
          for (const t of (th || [])) (byC[t.contact_id] ||= []).push(t)
          rows = rows.map(r => ({ ...r, thread: byC[r.id] || [] }))
        } catch { /* contact_thread未導入時は無視 */ }
      }
      // 管理者表示用: player_name が未保存の古いレコードは profiles.username で補完
      if (isContactAdmin && rows.length > 0) {
        const pids = [...new Set(rows.filter(r => !r.player_name && r.player_id).map(r => r.player_id))]
        if (pids.length > 0) {
          const { data: profs } = await supabase.from('profiles').select('id, username').in('id', pids)
          const nameMap = Object.fromEntries((profs || []).map(p => [p.id, p.username]))
          rows = rows.map(r => r.player_name ? r : { ...r, player_name: nameMap[r.player_id] || r.player_name })
        }
      }
      setMyContacts(rows)
      if (isContactAdmin) setUnrepliedContacts(rows.filter(needsAdminReply).length)
      return rows
    } catch (e) {
      setMyContacts([])
      return []
    } finally {
      setContactsLoading(false)
    }
  }

  // ユーザー/管理人がスレッドに追記（運営返信への返信・運営の追い返信）。送信者はサーバー側でロール判定。
  const postContactMessage = async (id, body, draftSetter) => {
    const text = (body || '').trim()
    if (!text) return
    setContactPostingId(id)
    try {
      const { error } = await supabase.rpc('contact_post_message', { p_contact_id: id, p_body: text })
      if (error) throw error
      draftSetter(d => { const n = { ...d }; delete n[id]; return n })
      await fetchMyContacts()
    } catch (e) {
      alert('送信に失敗しました。' + (e?.message ? `\n${e.message}` : ''))
    } finally {
      setContactPostingId(null)
    }
  }

  // is_admin: 返信せずに「確認済み」にして未返信一覧から外す（返信不要な締め向け）
  const adminAckContact = async (id) => {
    setAdminReplyingId(id)
    try {
      const { error } = await supabase.rpc('admin_ack_contact', { p_id: id })
      if (error) throw error
      await fetchMyContacts()
    } catch (e) {
      alert('確認処理に失敗しました。' + (e?.message ? `\n${e.message}` : ''))
    } finally {
      setAdminReplyingId(null)
    }
  }

  // is_admin: 返信を送信。初回は admin_reply_contact(reply列)、以降は contact_post_message(thread)。
  const adminReplyContact = async (id) => {
    const existing = myContacts.find(c => c.id === id)
    const text = (adminReplyDrafts[id] || '').trim()
    if (!text) return
    if (!window.confirm(`この内容で返信を送信します。よろしいですか？\n\n──────────\n${text}\n──────────`)) return
    setAdminReplyingId(id)
    try {
      if (existing?.reply) {
        const { error } = await supabase.rpc('contact_post_message', { p_contact_id: id, p_body: text })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('admin_reply_contact', { p_id: id, p_reply: text })
        if (error) throw error
      }
      setAdminReplyDrafts(d => { const n = { ...d }; delete n[id]; return n })
      await fetchMyContacts()
    } catch (e) {
      alert('返信の送信に失敗しました。' + (e?.message ? `\n${e.message}` : ''))
    } finally {
      setAdminReplyingId(null)
    }
  }

  const fetchAnnouncements = async () => {
    // 全体向け(target_player_id=null)＋自分宛(target_player_id=自分)のみ取得
    const { data: { user } } = await supabase.auth.getUser()
    let data
    try {
      let q = supabase.from('announcements').select('*').eq('is_active', true)
      q = user ? q.or(`target_player_id.is.null,target_player_id.eq.${user.id}`) : q.is('target_player_id', null)
      const res = await q.order('created_at', { ascending: false })
      if (res.error) throw res.error
      data = res.data
    } catch {
      // target_player_id 列が無い旧環境向けフォールバック（全件取得）
      const res = await supabase.from('announcements').select('*').eq('is_active', true).order('created_at', { ascending: false })
      data = res.data
    }
    const fetched = data || []
    setAnnouncements(fetched)
    try {
      const hadSeenRecord = localStorage.getItem('bf_seenAnnouncements') !== null
      let seen = JSON.parse(localStorage.getItem('bf_seenAnnouncements') || '[]')
      // 初回起動（既読記録なし＝新端末/キャッシュ削除後）は、過去の全体お知らせを既読扱いで初期化する。
      // これをしないとログインのたびに過去分を全部さかのぼらされる。以後の新着のみ通知する。
      if (!hadSeenRecord) {
        seen = fetched.filter(a => !a.target_player_id).map(a => a.id)
        try { localStorage.setItem('bf_seenAnnouncements', JSON.stringify(seen)) } catch { /* 意図的に無視 */ }
      }
      setSeenAnnouncementIds(seen)
      const seenAdmin = JSON.parse(localStorage.getItem('bf_seenAdminMsgs') || '[]')
      setSeenAdminMsgIds(seenAdmin)
      // 運営メッセージ（個別宛）は専用の既読キーで管理し、未読があれば優先で自動ポップアップ
      const hasNewAdmin = fetched.some(a => a.target_player_id && !seenAdmin.includes(a.id))
      // 全体お知らせ（個別宛を除く）の新着
      const hasNewGlobal = fetched.some(a => !a.target_player_id && !seen.includes(a.id))
      setHasNewAnnouncements(hasNewGlobal)
      if (hasNewAdmin) setAdminMsgOpen(true)
      else if (hasNewGlobal) setNewAnnouncementPopup(true)
    } catch { /* 意図的に無視 */ }
  }

  const markAllAnnouncementsSeen = () => {
    const ids = announcements.map(a => a.id)
    try { localStorage.setItem('bf_seenAnnouncements', JSON.stringify(ids)) } catch { /* 意図的に無視 */ }
    // 一度見たら即NEWを外す。以前はlocalStorageのみ更新でstateが古いまま残り、
    // 同一セッション中はNEWバッジ・NEW通知が消えなかった。
    setSeenAnnouncementIds(ids)
    setHasNewAnnouncements(false)
  }

  // 運営からのお知らせ（個別宛）を既読にする（専用キー bf_seenAdminMsgs）
  const markAdminMsgsSeen = () => {
    const ids = announcements.filter(a => a.target_player_id).map(a => a.id)
    setSeenAdminMsgIds(prev => {
      const next = [...new Set([...prev, ...ids])]
      try { localStorage.setItem('bf_seenAdminMsgs', JSON.stringify(next)) } catch { /* 意図的に無視 */ }
      return next
    })
  }

  const GUIDE_SECTIONS = [
    {
      id: 'm_sortie', title: '⚔ 出撃',
      content: `● エリアを選んで「出撃」を押すと自動で戦闘が始まる、最も基本の行動
● 勝利するとEXP・Goldを獲得。レベルアップでステータスが上昇する
● レベルアップでステータスポイントが1pt貰える（街の画面から割り振り）
● クールダウン（20秒）が終わると再び出撃できる
● ボスを倒すと次のエリアが解放される
● 強くなる土台は「レベル」。まずは出撃を重ねてコツコツ育てよう`,
    },
    {
      id: 'm_dungeon', title: '✨ デイリーダンジョン',
      content: `● EXP / Gold / 強化石 / 武器熟練度 / 宝石 の5種類
● それぞれ1日3回まで・毎日朝5時（日本時間）リセット
● 通常出撃より報酬効率が良いので、毎日忘れずにこなそう`,
    },
    {
      id: 'm_equip', title: '🛡 装備',
      content: `● 戦闘でドロップした武器・防具は「装備」ページで確認・装備できる
● 各装備には宝石を1つ埋め込めるソケットがある
● 武器を使い続けると熟練度が上がりボーナスが付く
〔💍 宝石〕
● ソケットに埋め込むとHP・攻撃・防御・クリティカル・貫通などの効果が得られる
● 各装備に1つずつ装着（装備ページの「宝石」タブで合成・埋め込み）
● デイリーダンジョンの「宝石ダンジョン」で入手。ランクはF〜SSS
● 同じ宝石を3個合成すると1ランクUP（効果は1.5倍）
● 装着部位に制限あり：%系（貫通/クリ/命中/回避）=装飾品のみ／HP・MP=防具・装飾品／攻撃系=武器・装飾品／防御系=防具・装飾品`,
    },
    {
      id: 'm_skill', title: '⚡ スキル',
      content: `● レベルアップで自動習得。スキルページでスロット（最大5個）にセット
● 戦闘ではスロット順に上から繰り返し使用する
● パッシブスキルはセットで常時発動（パッシブは1つまで）
● MPが足りないとスキルが発動しない（宿屋でMP補充）
● 転職するとセット中のスキルは全て外れるので、転職後にセットし直そう`,
    },
    {
      id: 'm_profile', title: '👤 プロフィール',
      content: `● 自分や他のプレイヤーの詳細ステータスを確認できる
● 全クラス通算のレベルアップ回数がキャラクターレベル（総合力の指標）`,
    },
    {
      id: 'm_item', title: '🎒 アイテム',
      content: `● 所持している回復・補助アイテムや各種素材を確認・使用できる
● 回数券などの便利アイテムもここから使う`,
    },
    {
      id: 'm_inn', title: '🏨 宿屋',
      content: `● 戦闘でHPが0になると「瀕死状態」になり出撃不可になる
● 宿屋でHP・MPを全回復（Goldがかかる）
● 瀕死状態の回復は通常よりGoldが多くかかる
● 時間経過でも自然回復する（瀕死状態も回復する）`,
    },
    {
      id: 'm_temple', title: '⛩ 神殿（クラス・転職）',
      content: `● 初期クラスは戦士・弓使い・魔法使い・僧侶・格闘家の5種類（各LV上限100）
● LV1から他クラスに転職できる（ステータスポイントは引き継がれる）
● 転職するとセット中のスキルは全て外れる（習得済みは消えない）
● LV100到達クラスから上位職へ転職可能（侍・暗殺者・元素使い など）
● 複合上位職（魔法剣士・聖騎士・魔銃士・賢者）は対応2クラスがLV50以上で解放
● 「再修練」：クラスをLV1に戻す代わりにスキルを1つ他クラスへ持ち越せる
● 再修練を重ねるとスキルが段階的に強化、5回でそのクラスのLV上限が300に解放`,
    },
    {
      id: 'm_shop', title: '🛒 商店',
      content: `● 回復アイテムや補助アイテムを購入できる
● 解放エリアが進むと品揃えが変わる`,
    },
    {
      id: 'm_smithy', title: '⚒ 鍛冶屋',
      content: `● 同名の武器か強化石を使って武器を強化できる
● 強化石はエリア2以降の敵・デイリーダンジョン（石）・武器の加工で入手
● 「再評価」：付与された特殊効果を別の効果に変更
● 「再鑑定」：武器のボーナスステータスを振り直す`,
    },
    {
      id: 'm_museum', title: '🏛 博物館',
      content: `● 入手した装備（武器・防具・装飾品）を寄贈して展示できる
● 寄贈すると永続的なステータスボーナスを獲得
● 収集状況に応じたランキングもある`,
    },
    {
      id: 'm_exchange', title: '🔄 交換所',
      content: `● レイドボスなどで集めた素材を、専用装備や強化石と交換
● ラインナップはイベントやボスによって変わる`,
    },
    {
      id: 'm_casino', title: '🎰 賭博場',
      content: `● Goldをメダルに替え、スロットやハイ&ローで遊べる
● 簡易出撃でまとめて周回もできる`,
    },
    {
      id: 'm_barber', title: '✂ 美容院',
      content: `● キャラクターの見た目を変更できる`,
    },
    {
      id: 'm_fishing', title: '🎣 釣り場',
      content: `● 竿を垂らして魚を釣ることができる
● 釣り中は出撃・デイリーダンジョンに入れない
● はじめて釣った魚は図鑑に登録され、永続的なステータスボーナスを獲得
● 同じ魚の2回目以降は図鑑登録・ボーナスなし`,
    },
    {
      id: 'm_scarecrow', title: '🌾 かかし修練場',
      content: `● かかし相手にスキルの威力やコンボを試せる修練施設
● 修練中は出撃・デイリーダンジョンに入れない（終わるまで待とう）`,
    },
    {
      id: 'm_alchemy', title: '🧪 錬金部屋',
      content: `● 時間経過で強化石（F〜A）を自動生成する施設（最大4枠）
● 錬金用素材を使うと生成時間を短縮できる
● 各枠はエリアボス撃破・ダンジョン踏破などで順次解放される
● ※先行公開中の機能です`,
    },
    {
      id: 'm_pet', title: '🐾 ペット',
      content: `● スターターを選んで育成できる相棒システム
● 選択中（出撃中）のペットのステータスは主人公に100%反映される
● チャームの装備・進化で強化、ペット専用ダンジョンにも挑戦できる`,
    },
    {
      id: 'm_challenge', title: '⚔ 挑戦（奈落・天穹）',
      content: `やり込み向けの高難度コンテンツへの入口。
● 🕯 奈落闘技場：20階を順番に攻略。報酬はGold・強化石・宝石
● 🌌 天穹十二宮：全12宮のエンドコンテンツ（［開発］段階）
● 一部は管理者・先行公開中の場合があります`,
    },
    {
      id: 'm_rumor', title: '📜 うわさ話',
      content: `● 世の中には「アーティファクト」と呼ばれる武器があるらしい。
  現代では風化してしまっているが、手入れをすればまた使えるようになるかも…`,
    },
  ]

  // HELP：初心者ガイドより詳細な仕様解説。少しずつ項目を追加していく。
  const HELP_SECTIONS = [
    {
      id: 'h_player', title: '👤 プレイヤー',
      content: `【基本情報】
● クラスレベル：現在のクラスのレベル
● キャラクターレベル：これまで上げた全クラスのレベルの合計
● 総合力：各ステータスの合計（強さの目安）
● Gold：宿屋・商店・強化など様々な用途で使用する

【ステータスポイント】
● レベルアップ時に1獲得し、好きなステータスに割り振れる
● 転職しても減衰しない（振ったポイントは引き継がれる）
● 1ptあたりの上昇量：HP +10 ／ MP +5 ／ 攻撃・防御・特攻・特防・素早さは各 +1

【各種ステータス（総合力に反映）】
● HP：体力。0になると瀕死状態になり出撃できなくなる
● MP：スキルの発動に消費する。足りないとスキルが出ず通常攻撃になる
● 攻撃：物理攻撃に影響
● 防御：物理攻撃へのダメージ軽減率に影響
● 特攻：特殊攻撃に影響
● 特防：特殊攻撃へのダメージ軽減率に影響
● 素早さ：追加攻撃・回避率・クリティカル確率に影響

【その他ステータス（総合力には反映されません）】
● 物理ダメージ軽減：受ける物理ダメージを直接軽減
● 特殊ダメージ軽減：受ける特殊ダメージを直接軽減
● クリティカル率：クリティカルの発生率
● クリティカル抵抗：相手から受けるクリティカルの発生を抑える
● クリティカル威力：クリティカル時のダメージ倍率を上げる
● 命中率：攻撃の当たりやすさ
● 回避率：相手の攻撃を避ける確率
● 防御貫通：相手の防御力を一定割合無視する
● 特殊防御貫通：相手の特殊防御力を一定割合無視する

【実効ステータス】
● 表示される実効値＝基礎ステータス＋装備＋武器熟練度＋宝石＋称号＋釣り図鑑＋博物館などの各種ボーナスの合計
● 攻撃%などの倍率ボーナスも実効値・表示に反映される

【回復】
● HP/MPは宿屋で全回復（Goldが必要）。時間経過でも自然回復する
● 瀕死状態の回復は通常よりGoldが多くかかる`,
    },
    {
      id: 'h_class', title: '🎭 クラス',
      content: `【基本ルール】
● 初期クラスは戦士・弓使い・魔法使い・僧侶・格闘家の5種類
● 各クラスのLV上限は100（再修練5回でそのクラスのみ上限300に解放）
● 神殿でいつでも他クラスへ転職できる。ステータスポイントは引き継がれる
● 転職するとセット中のスキルは全て外れる（習得済みスキルは消えない）

【再修練】
● クラスをLV1に戻す代わりに、スキルを1つ他クラスへ持ち越せる
● 再修練を重ねるとスキルが段階的に強化される（1回ごとに1つ解放）
● 再修練5回でそのクラスのLV上限が300に解放
〔共通の効果〕
・他クラスでのステータス反映率+10%
・スキルを1つ選んで、どのクラスでも使えるようにできる
〔初期クラスで再修練すると〕
・再修練によるステータス反映率ボーナスが+30%になる
〔上位クラスで再修練すると〕
・そのクラスにいる間、スキルが強化される

【上位クラスへの転職条件】
● 通常上位職：対応する初期クラスがLV100に到達
● 複合上位職：対応する2クラスがそれぞれLV50以上
● 特殊上位職：特定のアイテムを所持していると転職可能`,
    },
    {
      id: 'h_equip', title: '🛡 装備',
      content: `【装備部位】
● 武器 ／ 防具 ／ 装飾品①・② を装備できる
● 戦闘でドロップした装備は「装備」ページで確認・装備する

【装備に付く要素】
● ボーナスステータス：装備ごとに攻撃・防御などの追加値が付く
● 特殊効果：開幕バフ・命中時デバフなど、装備固有の効果
● 宝石ソケット：各装備に1つ宝石を埋め込める
● 武器熟練度：同じ武器を使い続けると熟練度が上がり、ボーナスが伸びる

【アイテム】
● 出撃で使用するポーションなどをセットできる

【宝石】
● ソケットに埋め込むとHP・攻撃・防御・クリティカル・貫通などの効果が得られる
● ランクはF〜SSS。同じ宝石を3個合成すると1ランクUP（効果1.5倍）
● 装着部位の制限：
　・%系（貫通/クリ/命中/回避）… 装飾品のみ
　・HP / MP … 防具・装飾品
　・攻撃系 … 武器・装飾品
　・防御系 … 防具・装飾品`,
    },
    {
      id: 'h_enhance', title: '⚒ 装備の強化',
      content: `【強化の基本】
● 鍛冶屋で武器を +0 から最大 +16 まで強化できる
● 強化するとステータスが上昇する
● 必要素材は「同名の武器」か「強化石（同ランク）」のどちらかを選択
● 強化済み（+1以上）の装備は素材に使えない
● 古びた特別な武器は強化できない

【必要素材の個数】
● +1〜+5：1個
● +6〜+10：2個
● +11〜+15：3個
● +16：4個

【失敗時】
● +10まで：失敗しても強化値は下がらない（素材は消費）
● +11以降：失敗すると強化値が1段階下がる

【強化石について】
● ランクはF〜SSS。武器のランクに合った強化石を使う
● 入手先：エリア2以降の敵ドロップ／デイリーダンジョン（石）／錬金部屋
● 加工：装備3個を強化石1個に変換できる

【再鑑定】
● 装備のボーナスを「種類・値ともに」すべて引き直す
● 再鑑定依頼書を使用（必要枚数は装備ランクで変動）
● 古びた特別な武器は対象外

【再評価】
● ボーナスの種類は固定したまま「値だけ」を引き直す
● 再評価依頼書を使用（要：先に再鑑定でボーナスを付与）
● 古びた特別な武器は対象外`,
    },
    {
      id: 'h_battle', title: '⚔ 戦闘系',
      content: `【戦闘の流れ】
● 出撃すると自動でターン制の戦闘が進行する
● 行動順は素早さ（SPD）が高いほうが先攻
● スキルはスロットの上から順番に繰り返し使用。MPが足りないと通常攻撃になる
● パッシブスキルはセット中ずっと効果が続く（1つまで）

【ダメージ計算】
● 物理か特殊かは「スキルごと」に決まる（スキルの種類による）。通常攻撃は装備武器の種類で決まる（杖・魔導書・オーブなど魔法系＝特殊、それ以外＝物理）
● 物理は「攻撃力」と「敵の防御力」、特殊は「特殊攻撃力」と「敵の特殊防御力」で計算する
● 攻撃力が高いほど大きく、敵の防御力が高いほど軽減される（攻撃力が敵防御を上回るほど軽減は小さくなる）
● スキルにはスキルごとの威力倍率が上乗せされる

【追加行動】
● 敵より素早さ（SPD）が高いと、その差の割合に応じて1ターンに追加で行動できることがある
● 差が大きいほど追加行動が出やすい

【クリティカル】
● クリティカル率に応じて発生。発生すると基本ダメージが1.5倍
● 「クリティカル威力」ボーナスがあると倍率がさらに上昇
● クリティカル抵抗を持つ相手には発生しにくくなる

【命中・回避】
● 命中率が高いほど攻撃が当たりやすい
● 回避率が高い相手には攻撃が外れることがある

【貫通】
● 防御貫通：相手の防御力を一定割合無視して物理ダメージを通す
● 魔法防御貫通：同様に相手の特殊防御力を無視する
● スキルの中には「防御無視」を持つものもある

【バフ・デバフ】
● 攻撃力UP・防御UPなどのバフ／対象の能力を下げるデバフがある
● 効果はターン数で管理され、時間経過で切れる

【状態異常】
● やけど：毎ターン継続ダメージ＋攻撃力・特殊攻撃力が低下
● 毒：毎ターン継続ダメージ
● 猛毒：毒より強い継続ダメージ
● 出血：重ねがけでき（最大5）、毎ターンスタックが多いほど大きなダメージ
● 麻痺：一定確率で行動できなくなり、素早さも低下する
● 気絶（スタン）：1ターン行動できない
● 回復阻害：受ける回復量が減る／回復が無効になる
● いずれもターン数で管理され、時間経過で切れる`,
    },
  ]

  if (pendingClassChange) return (
    <div style={{ minHeight:'100vh', background:'#000820', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ background:'#001040', border:'1px solid #ccaa00', padding:'32px', maxWidth:'360px', width:'100%', textAlign:'center' }}>
        <div style={{ color:'#ccaa00', fontSize:'18px', marginBottom:'8px' }}>⛩</div>
        <div style={{ color:'#ccaa00', fontSize:'15px', marginBottom:'16px', letterSpacing:'2px' }}>{pendingClassChange}に転職します！</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'24px' }}>よろしいですか？</div>
        <div style={{ display:'flex', gap:'12px', justifyContent:'center' }}>
          <button onClick={async ()=>{ await doChangeClass(pendingClassChange); setPendingClassChange(null) }} disabled={loading||atWar}
            style={{ padding:'10px 24px', background:'#1a1000', border:'1px solid #ccaa00', color:'#ccaa00', cursor:(loading||atWar)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', opacity:(loading||atWar)?0.5:1 }}>
            {atWar ? '戦争中は不可' : (loading ? '処理中...' : '転職する')}
          </button>
          <button onClick={()=>setPendingClassChange(null)} disabled={loading}
            style={{ padding:'10px 24px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )

  if (showOptions) {
    const papiaLocked = profile?.papia_hour_set_at && (Date.now() < new Date(profile.papia_hour_set_at).getTime() + 30*24*60*60*1000)
    const papiaUnlockAt = profile?.papia_hour_set_at ? new Date(new Date(profile.papia_hour_set_at).getTime() + 30*24*60*60*1000) : null
    const pad2 = (n) => String(n).padStart(2,'0')
    // ⚡ 出撃CDモード（is_admin限定先行・週1変更）
    const curMode = profile?.sortie_mode === 10 ? 10 : 20
    const modeLocked = profile?.sortie_mode_set_at && (Date.now() < new Date(profile.sortie_mode_set_at).getTime() + 7*24*60*60*1000)
    const modeUnlockAt = profile?.sortie_mode_set_at ? new Date(new Date(profile.sortie_mode_set_at).getTime() + 7*24*60*60*1000) : null
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
        <div style={{ background:'#001020', border:'1px solid #446688', padding:'20px', maxWidth:'460px', width:'100%', fontFamily:'monospace' }}>
          <div style={{ color:'#ffcc44', fontSize:'14px', marginBottom:'16px' }}>⚙ 出撃設定</div>
          <div style={{ border:'1px solid #335577', background:'#000a18', padding:'14px', marginBottom:'16px' }}>
            <div style={{ color:'#ffcc44', fontSize:'13px', marginBottom:'6px' }}>⚡ 出撃の待機時間</div>
            <div style={{ color:'#88aacc', fontSize:'11px', lineHeight:'1.7', marginBottom:'12px' }}>
              街の出撃・<strong style={{color:'#ffcc44'}}>デイリーダンジョン</strong>のクールダウンを<strong style={{color:'#ffcc44'}}>10秒</strong>か<strong style={{color:'#ffcc44'}}>20秒</strong>から選べます。<br/>
              ・<strong style={{color:'#ffcc44'}}>10秒</strong>は報酬が控えめ（出撃EXP5〜6 / ボス7 / Gold半分）<br/>
              ・<strong style={{color:'#ffcc44'}}>20秒</strong>は現状どおり（報酬そのまま）<br/>
              ・簡易出撃は1分・レイドは10秒で固定<br/>
              ・<strong style={{color:'#ffcc44'}}>変更は1週間に1回</strong>まで
            </div>
            <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px' }}>現在の設定: <strong style={{color:'#ffcc44'}}>{curMode}秒</strong></div>
            {modeLocked ? (
              <div style={{ textAlign:'center', color:'#886633', fontSize:'11px', padding:'8px', border:'1px solid #332a14', background:'#0a0800' }}>
                次に変更できるのは {modeUnlockAt.toLocaleString('ja-JP')} 以降です
              </div>
            ) : (
              <div style={{ display:'flex', gap:'8px' }}>
                {[10,20].map(m => (
                  <button key={m} onClick={()=>setSortieModeMode(m)} disabled={sortieModeLoading || m===curMode}
                    style={{ flex:1, padding:'12px', background: m===curMode?'#1a2a00':'#1a1400', border:`1px solid ${m===curMode?'#88cc44':'#ffcc44'}`, color: m===curMode?'#88cc44':'#ffcc44', cursor:(sortieModeLoading||m===curMode)?'default':'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                    {m===curMode ? `✅ ${m}秒（設定中）` : `${m}秒にする`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 🌟 パピア出現時間帯（プレイヤー選択・1か月変更不可） */}
          <div style={{ border:'1px solid #335577', background:'#000a18', padding:'14px', marginBottom:'16px' }}>
            <div style={{ color:'#ffaa00', fontSize:'13px', marginBottom:'6px' }}>🌟 パピア出現時間帯</div>
            <div style={{ color:'#88aacc', fontSize:'11px', lineHeight:'1.7', marginBottom:'10px' }}>
              選んだ時刻から<strong style={{color:'#ffaa00'}}>30分間</strong>、パピアの出現率がアップします（毎日その時刻）。<br/>
              ・<strong style={{color:'#ffaa00'}}>2枠まで</strong>設定できます<br/>
              ・<strong style={{color:'#ffaa00'}}>一度決めると1か月は変更できません</strong>
            </div>
            <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px' }}>
              現在の設定: {[profile?.papia_hour, profile?.papia_hour2].filter(Number.isInteger).map(h=>`${pad2(h)}:00〜${pad2(h)}:30`).join(' / ') || '未設定'}
            </div>
            {papiaLocked ? (
              <div style={{ textAlign:'center', color:'#886633', fontSize:'11px', padding:'8px', border:'1px solid #332a14', background:'#0a0800' }}>
                変更は {papiaUnlockAt.toLocaleString('ja-JP')} 以降に可能
              </div>
            ) : (
              <>
                <div style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'8px' }}>
                  <span style={{ color:'#446688', fontSize:'11px', width:'42px' }}>枠1</span>
                  <select value={papiaSel} onChange={e=>setPapiaSel(Number(e.target.value))}
                    style={{ flex:1, padding:'8px', background:'#001040', border:'1px solid #446688', color:'#88ccff', fontFamily:'monospace', fontSize:'12px' }}>
                    {Array.from({length:24},(_,h)=>(<option key={h} value={h}>{pad2(h)}:00〜{pad2(h)}:30</option>))}
                  </select>
                </div>
                <div style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'10px' }}>
                  <span style={{ color:'#446688', fontSize:'11px', width:'42px' }}>枠2</span>
                  <select value={papiaSel2} onChange={e=>setPapiaSel2(Number(e.target.value))}
                    style={{ flex:1, padding:'8px', background:'#001040', border:'1px solid #446688', color:'#88ccff', fontFamily:'monospace', fontSize:'12px' }}>
                    <option value={-1}>なし</option>
                    {Array.from({length:24},(_,h)=>(<option key={h} value={h}>{pad2(h)}:00〜{pad2(h)}:30</option>))}
                  </select>
                </div>
                <button onClick={savePapiaHour} disabled={papiaHourLoading}
                  style={{ width:'100%', padding:'10px', background:'#1a1400', border:'1px solid #ffaa00', color:'#ffaa00', cursor: papiaHourLoading?'default':'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                  {papiaHourLoading ? '設定中…' : 'この時刻で設定（1か月変更不可）'}
                </button>
              </>
            )}
          </div>

          {/* 🧬 変異ボス出現（char_lv500以上のみ） */}
          {(profile?.char_lv || 1) >= MUTANT_BOSS_LV && (
            <div style={{ border:'1px solid #335577', background:'#000a18', padding:'14px', marginBottom:'16px' }}>
              <div style={{ color:'#ff88cc', fontSize:'13px', marginBottom:'6px' }}>🧬 変異ボスの出現</div>
              <div style={{ color:'#88aacc', fontSize:'11px', lineHeight:'1.7', marginBottom:'10px' }}>
                エリア①〜④のボスを<strong style={{color:'#ff88cc'}}>【変異】ボス</strong>（エリア⑤級の強さ・Goldもエリア⑤相当）にします。<br/>
                OFFにすると通常のボスが出現します（Goldも通常どおり）。
              </div>
              <button onClick={toggleMutant}
                style={{ width:'100%', padding:'12px', background: mutantEnabled?'#2a0018':'#0a0a12', border:`1px solid ${mutantEnabled?'#ff88cc':'#446688'}`, color: mutantEnabled?'#ff88cc':'#88aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
                {mutantEnabled ? '✅ 変異ボス：ON（クリックでOFF）' : '⬜ 変異ボス：OFF（クリックでON）'}
              </button>
            </div>
          )}

          <button onClick={()=>setShowOptions(false)}
            style={{ width:'100%', padding:'10px', background:'none', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>閉じる</button>
        </div>
      </div>
    )
  }

  if (showInstallGuide) {
    const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true
    const tab = installTab
    const tabBtn = (key, label) => (
      <button onClick={()=>setInstallTab(key)} style={{ flex:1, padding:'10px', background: tab===key?'#0a2440':'#001020', border:`1px solid ${tab===key?'#44aaff':'#234'}`, color: tab===key?'#aad4ff':'#557', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', fontWeight: tab===key?'bold':'normal' }}>{label}</button>
    )
    const stepBox = { border:'1px solid #234', background:'#000a18', padding:'12px 14px', marginBottom:'10px', borderRadius:'4px' }
    const num = { color:'#44aaff', fontWeight:'bold', marginRight:'6px' }
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', overflowY:'auto' }}>
        <div style={{ background:'#001020', border:'1px solid #446688', padding:'20px', maxWidth:'460px', width:'100%', fontFamily:'monospace', maxHeight:'90vh', overflowY:'auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'14px' }}>
            <div style={{ color:'#44aaff', fontSize:'15px' }}>📱 ホーム画面に追加</div>
            <button onClick={()=>setShowInstallGuide(false)} style={{ background:'none', border:'none', color:'#557', cursor:'pointer', fontFamily:'monospace', fontSize:'18px' }}>✕</button>
          </div>

          <div style={{ border:'1px solid #234', background:'#000a18', padding:'12px 14px', marginBottom:'14px', borderRadius:'4px', color:'#9cf', fontSize:'12px', lineHeight:'1.9' }}>
            <div>✅ ホーム画面からワンタップで起動</div>
            <div>✅ 全画面表示でアプリのように快適</div>
          </div>

          {isStandalone && (
            <div style={{ textAlign:'center', color:'#44ff88', fontSize:'12px', padding:'10px', border:'1px solid #225544', background:'#001810', marginBottom:'14px' }}>
              🎉 すでにアプリとして起動中です！
            </div>
          )}

          <div style={{ display:'flex', gap:'8px', marginBottom:'14px' }}>
            {tabBtn('iphone', 'iPhone')}
            {tabBtn('android', 'Android')}
          </div>

          {tab === 'iphone' ? (
            <div>
              <div style={{ color:'#88aacc', fontSize:'11px', marginBottom:'10px', lineHeight:'1.7' }}>
                ⚠️ <strong style={{color:'#ffcc44'}}>Safari</strong> で開いてください（Chromeやアプリ内ブラウザでは「ホーム画面に追加」が出ません）
              </div>
              <div style={stepBox}><span style={num}>1.</span>画面下（または上）のメニューバーの<strong style={{color:'#aad4ff'}}>「共有」ボタン</strong>（□に↑の形）をタップ</div>
              <div style={stepBox}><span style={num}>2.</span>メニューを下にスクロールして<strong style={{color:'#aad4ff'}}>「ホーム画面に追加」</strong>を選ぶ</div>
              <div style={stepBox}><span style={num}>3.</span>右上の<strong style={{color:'#aad4ff'}}>「追加」</strong>をタップ</div>
            </div>
          ) : (
            <div>
              <div style={{ color:'#88aacc', fontSize:'11px', marginBottom:'10px', lineHeight:'1.7' }}>
                <strong style={{color:'#ffcc44'}}>Chrome</strong> で開くのがおすすめです
              </div>
              <div style={stepBox}><span style={num}>1.</span>右上の<strong style={{color:'#aad4ff'}}>「⋮」（その他）</strong>をタップ</div>
              <div style={stepBox}><span style={num}>2.</span><strong style={{color:'#aad4ff'}}>「アプリをインストール」</strong>または<strong style={{color:'#aad4ff'}}>「ホーム画面に追加」</strong>を選ぶ</div>
              <div style={stepBox}><span style={num}>3.</span><strong style={{color:'#aad4ff'}}>「インストール」/「追加」</strong>をタップ</div>
            </div>
          )}

          <div style={{ color:'#557', fontSize:'10px', lineHeight:'1.7', marginTop:'6px', marginBottom:'14px' }}>
            ※ 追加したアイコンを押すと、アドレスバーの無い全画面でゲームが起動します。<br/>
            ※ ゲームを更新してもアイコンを作り直す必要はありません。
          </div>

          <button onClick={()=>setShowInstallGuide(false)}
            style={{ width:'100%', padding:'10px', background:'none', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>閉じる</button>
        </div>
      </div>
    )
  }

  if (showContact) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'#001020', border:'1px solid #446688', padding:'20px', maxWidth:'460px', width:'100%', maxHeight:'90vh', overflowY:'auto', fontFamily:'monospace', boxSizing:'border-box' }}>
        <div style={{ color:'#88ccff', fontSize:'14px', marginBottom:'12px' }}>📩 お問い合わせ</div>
        {/* 新規 / 履歴 切り替えタブ */}
        <div style={{ display:'flex', gap:'6px', marginBottom:'14px' }}>
          {[{ key:'new', label:'新規お問い合わせ' }, { key:'history', label: isContactAdmin ? '受信一覧・返信' : '過去のお問い合わせ' }].map(t => {
            const on = contactView === t.key
            return (
              <button key={t.key} onClick={()=>{ setContactView(t.key); if (t.key==='history') fetchMyContacts().then(rows => markContactRepliesSeen(rows)) }}
                style={{ flex:1, padding:'8px 4px', background: on?'#001840':'#000818', border:`1px solid ${on?'#88ccff':'#223344'}`, color: on?'#88ccff':'#557799', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                {t.label}
              </button>
            )
          })}
        </div>

        {contactView === 'history' ? (() => {
          // 管理人は「未返信/返信済み」で絞り込み。一般ユーザーは全件。
          const shownContacts = isContactAdmin
            ? myContacts.filter(c => adminContactFilter === 'replied' ? !needsAdminReply(c) : needsAdminReply(c))
            : myContacts
          return (
          <>
            {/* 管理人のみ: 未返信 / 返信済み サブタブ */}
            {isContactAdmin && (
              <div style={{ display:'flex', gap:'6px', marginBottom:'10px' }}>
                {[{ key:'unreplied', label:'未返信' }, { key:'replied', label:'返信済み' }].map(f => {
                  const on = adminContactFilter === f.key
                  const cnt = myContacts.filter(c => f.key === 'replied' ? !needsAdminReply(c) : needsAdminReply(c)).length
                  return (
                    <button key={f.key} onClick={()=>setAdminContactFilter(f.key)}
                      style={{ flex:1, padding:'6px 4px', background: on?'#1a1400':'#000818', border:`1px solid ${on?'#ffcc44':'#223344'}`, color: on?'#ffcc44':'#557799', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                      {f.label}（{cnt}）
                    </button>
                  )
                })}
              </div>
            )}
            {isContactAdmin && adminContactFilter === 'replied' && (
              <div style={{ color:'#886644', fontSize:'10px', marginBottom:'8px', lineHeight:'1.6' }}>※ 返信済みのメッセージは返信から2週間後に自動削除されます。</div>
            )}
            {contactsLoading && <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'16px 0' }}>読み込み中...</div>}
            {!contactsLoading && shownContacts.length === 0 && (
              <div style={{ color:'#446688', fontSize:'12px', textAlign:'center', padding:'16px 0', lineHeight:'1.8' }}>
                {isContactAdmin ? (adminContactFilter === 'replied' ? '返信済みのお問い合わせはありません。' : '未返信のお問い合わせはありません。') : 'これまでのお問い合わせはありません。'}
              </div>
            )}
            {!contactsLoading && shownContacts.map(c => {
              const thread = buildThread(c)
              const hasAdminMsg = thread.some(m => m.sender === 'admin')
              return (
              <div key={c.id} style={{ marginBottom:'12px', border:'1px solid #223344', background:'#000818' }}>
                <div style={{ padding:'10px 12px', borderBottom:'1px solid #112233' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ color:'#88ccff', fontSize:'11px' }}>{CONTACT_CAT_LABEL[c.category] || c.category}</span>
                    <span style={{ color:'#446688', fontSize:'10px' }}>{new Date(c.created_at).toLocaleDateString('ja-JP')}</span>
                  </div>
                  {isContactAdmin && <div style={{ color:'#6699cc', fontSize:'10px', marginTop:'4px' }}>from: {c.player_name || c.player_id}</div>}
                </div>
                {/* 会話スレッド（吹き出し） */}
                <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:'8px' }}>
                  {thread.map((m, i) => {
                    const isAdminMsg = m.sender === 'admin'
                    const mine = isContactAdmin ? isAdminMsg : !isAdminMsg
                    const label = isAdminMsg ? '📩 運営' : (isContactAdmin ? `🙋 ${c.player_name || 'ユーザー'}` : '🙋 あなた')
                    return (
                      <div key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth:'85%' }}>
                        <div style={{ color: isAdminMsg ? '#ffcc44' : '#88ccff', fontSize:'9px', marginBottom:'2px', textAlign: mine ? 'right' : 'left' }}>
                          {label}{m.at && <span style={{ color:'#446688', marginLeft:'4px' }}>{new Date(m.at).toLocaleDateString('ja-JP')}</span>}
                        </div>
                        <div style={{ background: isAdminMsg ? '#001828' : '#0a1430', border:`1px solid ${isAdminMsg ? '#2a4a66' : '#26406a'}`, borderRadius:'6px', padding:'7px 10px', color: isAdminMsg ? '#aaddff' : '#ccddff', fontSize:'12px', lineHeight:'1.7', whiteSpace:'pre-wrap' }}>{m.body}</div>
                      </div>
                    )
                  })}
                </div>
                {/* 入力欄：管理人は常に返信可。ユーザーは運営返信後に追い返信可。 */}
                {isContactAdmin ? (
                  <div style={{ padding:'10px 12px', borderTop:'1px solid #112233' }}>
                    <textarea value={adminReplyDrafts[c.id] || ''} onChange={e=>setAdminReplyDrafts(d=>({ ...d, [c.id]: e.target.value }))}
                      rows={3} placeholder="返信内容を入力..."
                      style={{ width:'100%', padding:'6px', background:'#001040', border:'1px solid #335577', color:'#ccddff', fontFamily:'monospace', fontSize:'11px', resize:'vertical', boxSizing:'border-box', marginBottom:'6px' }} />
                    <button onClick={()=>adminReplyContact(c.id)} disabled={adminReplyingId===c.id || !(adminReplyDrafts[c.id] || '').trim()}
                      style={{ width:'100%', padding:'8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', opacity:(adminReplyDrafts[c.id] || '').trim() ? 1 : 0.4, marginBottom: needsAdminReply(c) ? '6px' : 0 }}>
                      {adminReplyingId===c.id ? '送信中...' : '返信を送信'}
                    </button>
                    {needsAdminReply(c) && (
                      <button onClick={()=>adminAckContact(c.id)} disabled={adminReplyingId===c.id}
                        style={{ width:'100%', padding:'8px', background:'#0a1a08', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                        ✓ 確認済みにする（返信せず未返信から外す）
                      </button>
                    )}
                  </div>
                ) : hasAdminMsg ? (
                  <div style={{ padding:'10px 12px', borderTop:'1px solid #112233' }}>
                    <textarea value={userReplyDrafts[c.id] || ''} onChange={e=>setUserReplyDrafts(d=>({ ...d, [c.id]: e.target.value }))}
                      rows={2} placeholder="運営への返信を入力..."
                      style={{ width:'100%', padding:'6px', background:'#001040', border:'1px solid #335577', color:'#ccddff', fontFamily:'monospace', fontSize:'11px', resize:'vertical', boxSizing:'border-box', marginBottom:'6px' }} />
                    <button onClick={()=>postContactMessage(c.id, userReplyDrafts[c.id], setUserReplyDrafts)} disabled={contactPostingId===c.id || !(userReplyDrafts[c.id] || '').trim()}
                      style={{ width:'100%', padding:'8px', background:'#001840', border:'1px solid #88ccff', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', opacity:(userReplyDrafts[c.id] || '').trim() ? 1 : 0.4 }}>
                      {contactPostingId===c.id ? '送信中...' : '返信する'}
                    </button>
                  </div>
                ) : (
                  <div style={{ padding:'8px 12px', color:'#557799', fontSize:'10px', borderTop:'1px solid #112233' }}>運営からの返信をお待ちください。</div>
                )}
              </div>
              )
            })}
            <button onClick={()=>setShowContact(false)}
              style={{ width:'100%', padding:'10px', marginTop:'4px', background:'none', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>閉じる</button>
          </>
          )
        })() : contactSent ? (
          <>
            <div style={{ color:'#44ff88', fontSize:'13px', textAlign:'center', padding:'20px 0' }}>送信しました。ありがとうございます。</div>
            <div style={{ color:'#446688', fontSize:'11px', textAlign:'center', marginBottom:'12px' }}>運営からの返信は「過去のお問い合わせ」から確認できます。</div>
            <button onClick={()=>{ setContactSent(false); setContactForm({ category:'bug', body:'' }); setContactView('history'); fetchMyContacts().then(rows => markContactRepliesSeen(rows)) }}
              style={{ width:'100%', padding:'10px', marginBottom:'8px', background:'#001840', border:'1px solid #88ccff', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>過去のお問い合わせを見る</button>
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
                <option value="request">ご意見・ご要望</option>
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
            <div style={{ color:'#446688', fontSize:'11px', textAlign:'center', padding:'12px' }}>
              {NON_CARRYOVER_CLASSES.has(retrainingClass) ? `${retrainingClass}のスキルは他クラスへ持ち越せません` : '習得済みスキルがありません'}
            </div>
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

  // HELPの content を【見出し】単位の中項目に分割する
  const parseHelpSubs = (content) => {
    const lines = content.split('\n')
    const subs = []
    let cur = null
    for (const line of lines) {
      const m = line.match(/^【(.+)】\s*$/)
      if (m) {
        cur = { heading: m[1], body: '' }
        subs.push(cur)
      } else if (cur) {
        cur.body += (cur.body ? '\n' : '') + line
      }
    }
    return subs.length ? subs : [{ heading: '詳細', body: content }]
  }

  if (showGuide) {
    const inHelp = guideView === 'help'
    const accent = inHelp ? '#ffaa44' : '#44aaff'
    const accentSub = inHelp ? '#ffcc88' : '#88ccff'
    const sections = inHelp ? HELP_SECTIONS : GUIDE_SECTIONS
    const openId = inHelp ? openHelpId : openGuideId
    const setOpenId = inHelp ? setOpenHelpId : setOpenGuideId
    return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'16px', gap:'10px' }}>
      <div style={{ width:'100%', maxWidth:'600px', display:'flex', justifyContent:'flex-end' }}>
        <button onClick={()=>{ setShowGuide(false); setOpenGuideId(null); setOpenHelpId(null); setGuideView('select') }} style={{ background:'#001040', border:`1px solid ${accent}`, color:accentSub, padding:'5px 12px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', borderRadius:'4px' }}>✕ 閉じる</button>
      </div>

      {guideView === 'select' ? (
        <div style={{ background:'#001040', border:'1px solid #44aaff', padding:'20px 16px', maxWidth:'600px', width:'100%', fontFamily:'monospace', textAlign:'left' }}>
          <div style={{ color:'#44aaff', fontSize:'14px', marginBottom:'16px', borderBottom:'1px solid #003366', paddingBottom:'8px' }}>📚 ヘルプ</div>
          <div style={{ color:'#557799', fontSize:'11px', marginBottom:'14px' }}>見たい項目を選んでください。</div>
          <button onClick={()=>{ setGuideView('guide'); setOpenGuideId(null) }}
            style={{ width:'100%', padding:'16px', marginBottom:'12px', background:'#001830', border:'1px solid #44aaff', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', textAlign:'left' }}>
            📖 初心者ガイド（各項目説明）
            <div style={{ color:'#446688', fontSize:'10px', marginTop:'4px' }}>各メニュー・施設の使い方をざっくり確認</div>
          </button>
          <button onClick={()=>{ setGuideView('help'); setOpenHelpId(null) }}
            style={{ width:'100%', padding:'16px', background:'#1a1000', border:'1px solid #ffaa44', color:'#ffcc88', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', textAlign:'left' }}>
            ❓ HELP（詳細）
            <div style={{ color:'#aa7733', fontSize:'10px', marginTop:'4px' }}>ステータスや戦闘などの詳しい仕様を解説</div>
          </button>
        </div>
      ) : (
      <div style={{ background:'#001040', border:`1px solid ${accent}`, padding:'16px', maxWidth:'600px', width:'100%', maxHeight:'78vh', overflowY:'auto', fontFamily:'monospace', textAlign:'left' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'12px', borderBottom:`1px solid ${inHelp?'#332200':'#003366'}`, paddingBottom:'8px' }}>
          <button onClick={()=>{ setGuideView('select'); setOpenGuideId(null); setOpenHelpId(null) }} style={{ background:'none', border:`1px solid ${accent}`, color:accentSub, padding:'3px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', borderRadius:'4px' }}>← 戻る</button>
          <div style={{ color:accent, fontSize:'14px' }}>{inHelp ? '❓ HELP（詳細）' : '📖 初心者ガイド（各項目説明）'}</div>
        </div>
        {sections.map(sec => (
          <div key={sec.id} style={{ marginBottom:'6px', border:`1px solid ${inHelp?'#332200':'#002244'}`, background:'#000818' }}>
            <button onClick={()=>setOpenId(openId===sec.id?null:sec.id)}
              style={{ width:'100%', padding:'10px 12px', background:'none', border:'none', color:accentSub, cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>{sec.title}</span>
              <span style={{ color:'#446688', fontSize:'10px' }}>{openId===sec.id?'▲':'▼'}</span>
            </button>
            {openId===sec.id && (
              inHelp ? (
                <div style={{ padding:'8px', borderTop:`1px solid #332200` }}>
                  {parseHelpSubs(sec.content).map((sub, i) => {
                    const subKey = `${sec.id}:${i}`
                    const subOpen = !!openHelpSubs[subKey]
                    return (
                      <div key={subKey} style={{ marginBottom:'5px', border:'1px solid #2a1c00', background:'#0a0600' }}>
                        <button onClick={()=>setOpenHelpSubs(s=>({ ...s, [subKey]: !s[subKey] }))}
                          style={{ width:'100%', padding:'8px 10px', background:'none', border:'none', color:'#ffcc88', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', textAlign:'left', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span>{sub.heading}</span>
                          <span style={{ color:'#aa7733', fontSize:'9px' }}>{subOpen?'▲':'▼'}</span>
                        </button>
                        {subOpen && (
                          <div style={{ padding:'8px 10px', borderTop:'1px solid #2a1c00', color:'#ffcc88', fontSize:'11px', lineHeight:'2.0', whiteSpace:'pre-wrap', textAlign:'left' }}>
                            {sub.body}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
              <div style={{ padding:'12px', borderTop:`1px solid ${inHelp?'#332200':'#002244'}`, color:accentSub, fontSize:'11px', lineHeight:'2.0', whiteSpace:'pre-wrap', textAlign:'left' }}>
                {sec.content}
              </div>
            ))}
          </div>
        ))}
      </div>
      )}
    </div>
  ) }

  if (showDyingTip) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.88)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ background:'#1a0000', border:'2px solid #ff4444', padding:'28px 24px', maxWidth:'380px', width:'100%', textAlign:'center' }}>
        <div style={{ color:'#ff4444', fontSize:'24px', marginBottom:'8px' }}>⚠</div>
        <div style={{ color:'#ff4444', fontSize:'15px', marginBottom:'14px', letterSpacing:'2px' }}>瀕死状態になりました</div>
        <div style={{ color:'#ffaaaa', fontSize:'12px', lineHeight:'1.9', marginBottom:'20px', textAlign:'left' }}>
          HPが0になり、このままでは<span style={{color:'#ff6666'}}>出撃できません</span>。<br/>
          街の<span style={{color:'#ffcc44'}}>宿屋</span>でHPを全回復してから、また冒険に出かけましょう。
        </div>
        <button onClick={()=>setShowDyingTip(false)}
          style={{ width:'100%', padding:'12px', background:'#000810', border:'1px solid #ff4444', color:'#ff6666', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', letterSpacing:'1px' }}>
          OK
        </button>
      </div>
    </div>
  )

  if (adminMsgOpen) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.9)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ background:'#001040', border:'2px solid #ffcc44', padding:'24px', maxWidth:'460px', width:'100%', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ color:'#ffcc44', fontSize:'15px', marginBottom:'16px', letterSpacing:'2px', textAlign:'center' }}>📩 運営からのお知らせ</div>
        {announcements.filter(a => a.target_player_id && !seenAdminMsgIds.includes(a.id)).map(a => (
          <div key={a.id} style={{ marginBottom:'14px', padding:'12px', background:'#000818', border:'1px solid #443300' }}>
            <div style={{ color:'#ffcc88', fontSize:'13px', marginBottom:'6px' }}>{a.title}</div>
            <div style={{ color:'#446688', fontSize:'10px', marginBottom:'8px' }}>{new Date(a.created_at).toLocaleDateString('ja-JP')}</div>
            <div style={{ color:'#aaccee', fontSize:'12px', lineHeight:'1.9', whiteSpace:'pre-wrap' }}>{a.content}</div>
          </div>
        ))}
        <button onClick={()=>{ setAdminMsgOpen(false); markAdminMsgsSeen() }}
          style={{ width:'100%', marginTop:'4px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', padding:'10px', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
          確認しました
        </button>
      </div>
    </div>
  )

  if (newAnnouncementPopup) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.88)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ background:'#001040', border:'2px solid #ff8844', padding:'28px 24px', maxWidth:'420px', width:'100%', maxHeight:'90vh', overflowY:'auto', textAlign:'center' }}>
        <div style={{ color:'#ff8844', fontSize:'22px', marginBottom:'8px' }}>📢</div>
        <div style={{ color:'#ff8844', fontSize:'15px', marginBottom:'16px', letterSpacing:'2px' }}>新着お知らせ</div>
        <div style={{ marginBottom:'20px', textAlign:'left' }}>
          {announcements.filter(a => !a.target_player_id && !seenAnnouncementIds.includes(a.id)).map(a => (
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
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:1000, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'16px', gap:'10px' }}>
      <div style={{ width:'100%', maxWidth:'600px', display:'flex', justifyContent:'flex-end' }}>
        <button onClick={()=>{ setShowAnnouncements(false); setOpenAnnouncementId(null) }} style={{ background:'#001040', border:'1px solid #ff8844', color:'#ffaa66', padding:'5px 12px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', borderRadius:'4px' }}>✕ 閉じる</button>
      </div>
      <div style={{ background:'#001040', border:'1px solid #ff8844', padding:'16px', maxWidth:'600px', width:'100%', height:'78vh', display:'flex', flexDirection:'column', fontFamily:'monospace' }}>
        <div style={{ marginBottom:'12px', borderBottom:'1px solid #003366', paddingBottom:'8px', flexShrink:0 }}>
          <div style={{ color:'#ff8844', fontSize:'14px' }}>📢 お知らせ</div>
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
        <div style={{ overflowY:'auto', flex:1 }}>
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

  // メンテナンス中チェック（★管理者(is_admin)はメンテ中でもプレイ可＝動作確認用）
  const maintenanceAnnouncement = announcements.find(a => a.title === 'MAINTENANCE')
  if (maintenanceAnnouncement && !profile?.is_admin) return (
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

  // 装備・釣り・博物館・称号込みの実効最大HP/MP（街表示・回復・戦闘プールはこれを使う）
  const _effMax = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
  const hpMaxEff = _effMax.hp_max
  const mpMaxEff = _effMax.mp_max
  // 戦争中はHP上限+10000（満タン参戦）。MPは据え置き。終戦後はhpCurrentが通常上限へ自然収束。
  const hpMaxDisp = atWar ? hpMaxEff + WAR_HP_BONUS : hpMaxEff
  const hpCurrent = Math.max(0, Math.min(profile.hp_current??hpMaxDisp, hpMaxDisp))
  const mpCurrent = Math.max(0, profile.mp_current??mpMaxEff)
  const isDying = profile.is_dying||false
  const isBanned = profile.battle_ban_until && new Date(profile.battle_ban_until) > new Date()
  const papiaEvent = getPapiaEventStatus(profile)
  const boostActive = isBoostActive(profile)
  const boostRemainMin = boostActive ? Math.max(1, Math.ceil((new Date(profile.boost_active_until).getTime() - Date.now())/60000)) : 0
  // ★2026-06-20公開: パピア時間は未設定だと出現率アップが無いため、未設定なら街に設定通知（押すと設定画面へ）
  const papiaNeedsSetup = !Number.isInteger(profile?.papia_hour) && !Number.isInteger(profile?.papia_hour2)
  const materialEvent = getMaterialEventStatus()
  const matEventBannerVisible = materialEvent.active && matEventSeenDate !== getDungeonDateStr()
  const dismissMatEventBanner = () => {
    const d = getDungeonDateStr()
    localStorage.setItem('bf_mat_event_seen', d)
    setMatEventSeenDate(d)
  }
  // レイドボス通知の「確認」はアカウント単位・1日1回。端末ローカルでなくprofiles.raid_seen_dateに
  // JST日付を保存し、スマホで確認すればPCでも当日は再確認不要にする。
  const raidJstDateStr = () => new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Tokyo'})).toISOString().slice(0,10)
  const raidNoticeSeenToday = profile.raid_seen_date === raidJstDateStr()
  const markRaidNoticeSeen = async () => {
    const d = raidJstDateStr()
    if (profile.raid_seen_date === d) return
    setProfile(p => p ? { ...p, raid_seen_date: d } : p)
    try { await supabase.from('profiles').update({ raid_seen_date: d }).eq('id', profile.id) } catch { /* 列未追加の旧環境などは無視 */ }
  }
  const banRemaining = isBanned ? (() => {
    const diffMs = new Date(profile.battle_ban_until) - new Date()
    const h = Math.floor(diffMs / 3600000)
    const m = Math.ceil((diffMs % 3600000) / 60000)
    return `${h}時間${m}分`
  })() : null
  const canBattle = !isBanned && !atWar && (!isDying || hpCurrent >= hpMaxEff)
  const hpPct = Math.min(100,(hpCurrent/hpMaxDisp)*100)
  const mpPct = Math.min(100,(mpCurrent/mpMaxEff)*100)
  const expPct = Math.min(100,(profile.exp/profile.exp_next)*100)
  const _waitSecs = effWait(profile, serverNow())
  const timerPct = ((_waitSecs-remaining)/_waitSecs)*100
  const regenPct = ((REGEN_SECONDS-regenRemaining)/REGEN_SECONDS)*100
  const unlockedAreas = profile.unlocked_areas||[1]
  const availableAreas = AREAS.filter(a=>unlockedAreas.includes(a.id))
  // デイリーダンジョン：全種使い切ったらパネル自体を開けない／残り合計
  const dungeonAllUsedUp = DUNGEON_LIST.every(d => (dungeonCounts[d.type]||0) >= dungeonDailyLimitFor(profile))
  const charLv = profile.char_lv || profile.lv
  const innCost = isDying ? Math.min(charLv*15,profile.gold) : charLv*2
  // 公開：開催期間中は全プレイヤーに表示（管理者は期間外でも常時表示）
  const eventVisible = (() => {
    const now = serverNow()
    return !!profile?.is_admin || (now >= EVENT_START_MS && now < EVENT_END_MS)
  })()

  // 解放判定：基本はキャラLv。錬金部屋のみエリア③ボス撃破（=エリア4解放）が条件。
  const isMenuUnlocked = (key) => {
    if (key === 'alchemy') return (profile.unlocked_areas||[1]).includes(4)
    return charLv >= (MENU_DEFS[key]?.unlock || 0)
  }
  const menuLockLabel = (key) => {
    if (key === 'alchemy') return 'エリア③ボス撃破で解放'
    return `LV${MENU_DEFS[key]?.unlock || 0}で解放`
  }


  // 街画面の施設パネル（グリッド）用：未到達Lvならボタンをロックセルに差し替える。
  // node=解放時に表示する元のボタン。key=MENU_DEFSのキー。
  const lockOr = (key, node) => {
    // 釣り中はレベル未解放でも「釣り場」を必ず開放（終了ボタンに到達できず詰むのを防ぐ）
    if (key === 'fishing' && profile?.is_fishing) return node
    if (isMenuUnlocked(key)) return node
    const label = (MENU_DEFS[key]?.label || '').replace(/^\S+\s/, '')
    return (
      <div key={key} style={{ flex:1, padding:'10px', background:'#000a14', border:'1px solid #1c2a3a', color:'#33445a', fontFamily:'monospace', fontSize:'11px', textAlign:'center', cursor:'not-allowed', boxSizing:'border-box' }}>
        🔒 {label}<br/><span style={{ color:'#886633', fontSize:'9px' }}>{menuLockLabel(key)}</span>
      </div>
    )
  }

  // 「次にやること」ヒント（街画面に表示）。優先度順で1つだけ提示。
  const nextHint = isDying ? null
    : (pendingPoints > 0 && charLv < 50) ? '★ ステータスポイントが余っています。左の「ステータスを振り分ける」で強化しよう！'
    : (charLv < 3) ? '⚔ まずは「出撃」して敵を倒し、レベルを上げよう！　✨「デイリーダンジョン」の経験値ダンジョンでも効率よくLVアップできます。LVが上がると新しい施設も開放されます。'
    : (charLv < 8) ? '🛒 「商店」で装備や回復アイテムを揃えると戦いがぐっと楽になります。'
    : null
  const allocatedPoints = Object.values(statPoints).reduce((a,b)=>a+b,0)
  // ※ここは早期returnの後なのでフック(useMemo)は使えない。通常計算に戻す。
  //   常時再描画の主因はタイマーのstate更新だったため、そちらの抑制(下記interval)で軽量化を達成。
  const eff = calcEffectiveStats(profile, equipment, proficiency, abilityTitle)
  const total = calcTotal(eff)
  // 運営からのお知らせ（個別宛＝target_player_id付き）の未読件数。ホームのバナー表示用
  const unreadAdminMsgs = announcements.filter(a => a.target_player_id && !seenAdminMsgIds.includes(a.id))
  const totalRank = getTotalRank(total)
  const currentClassLv = classLevels.find(cl => cl.class_name === profile.class)?.lv || profile.lv
  const cap = getEffectiveCap(profile.class, profile.retraining)
  const isAtCap = currentClassLv >= cap
  const retrainingCount = (profile.retraining || {})[profile.class] || 0

  const availableClasses = INITIAL_CLASSES.map(c=>{
    const cl = classLevels.find(x=>x.class_name===c)
    return { name:c, lv:cl?cl.lv:1, canChange: c !== profile.class }
  })
  const advancedAvailable = Object.entries(ADVANCED_CLASSES)
    // is_admin 限定先行公開の上位職は一般プレイヤーには出さない
    .filter(([name]) => !ADMIN_ONLY_CLASSES.has(name) || profile?.is_admin)
    .map(([name, req])=>{
    const requires = req.requires
    const requiresLv = req.requiresLv || 100
    const requires2 = req.requires2
    const requires2Lv = req.requires2Lv || 0
    const reqCl = classLevels.find(x=>x.class_name===requires)
    const reqLv = reqCl?reqCl.lv:0
    const req2Cl = requires2 ? classLevels.find(x=>x.class_name===requires2) : null
    const req2Lv = req2Cl?req2Cl.lv:0
    const cl = classLevels.find(x=>x.class_name===name)
    // 1度でも転職したことのあるクラス（class_levels に記録あり）は条件なしで再転職可
    const hasBeenClass = !!cl
    const canChange = name !== profile.class && (hasBeenClass || (requires2
      ? reqLv>=requiresLv && req2Lv>=requires2Lv
      : reqLv>=requiresLv))
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
              <div key={i} style={{ fontSize:'10px', lineHeight:'1.7', color: active ? '#88ffaa' : '#445566', textAlign:'left' }}>
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
      <div style={{ color:'#ffcc00', fontSize:'11px', marginBottom:'6px' }}>── 特殊上位職（アイテムで解放）──</div>
      <div style={{ marginBottom:'12px' }}>
        {(() => {
          const isCurrent = profile.class === 'ギャンブラー'
          const cl = classLevels.find(x=>x.class_name==='ギャンブラー')
          const canChange = !isCurrent && (hasGamblerProof || !!cl)
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
        {(() => {
          const isCurrent = profile.class === '竜騎士'
          const cl = classLevels.find(x=>x.class_name==='竜騎士')
          const canChange = !isCurrent && (hasDragonKnightProof || !!cl)
          return (
            <div style={{ border:`1px solid ${isCurrent?'#445566':canChange?'#886600':'#002244'}`, background:isCurrent?'#001828':'#001028', padding:'8px', marginTop:'8px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ color:isCurrent?'#88aabb':canChange?'#ffcc00':'#446688', fontSize:'12px' }}>
                    竜騎士{isCurrent&&<span style={{color:'#446688',fontSize:'9px',marginLeft:'6px'}}>（現在）</span>}
                  </div>
                  <div style={{ color:'#446688', fontSize:'10px' }}>竜騎士の証が必要</div>
                  <div style={{ color:'#446688', fontSize:'10px' }}>クラスLV{cl?cl.lv:1}/{getEffectiveCap('竜騎士', profile.retraining)}</div>
                </div>
                <button onClick={()=>setPendingClassChange('竜騎士')} disabled={isCurrent||!canChange||loading}
                  style={{ padding:'4px 8px', background:isCurrent?'#001':canChange?'#1a1000':'#001', border:`1px solid ${isCurrent?'#334455':canChange?'#886600':'#002244'}`, color:isCurrent?'#334455':canChange?'#ffcc00':'#334455', cursor:isCurrent||!canChange?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'10px' }}>
                  {isCurrent?'現在':'転職'}
                </button>
              </div>
            </div>
          )
        })()}
        {(() => {
          const isCurrent = profile.class === 'ブリーダー'
          const cl = classLevels.find(x=>x.class_name==='ブリーダー')
          const canChange = !isCurrent && (hasBreederProof || !!cl)
          return (
            <div style={{ border:`1px solid ${isCurrent?'#445566':canChange?'#886600':'#002244'}`, background:isCurrent?'#001828':'#001028', padding:'8px', marginTop:'8px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ color:isCurrent?'#88aabb':canChange?'#ffcc00':'#446688', fontSize:'12px' }}>
                    ブリーダー{isCurrent&&<span style={{color:'#446688',fontSize:'9px',marginLeft:'6px'}}>（現在）</span>}
                  </div>
                  <div style={{ color:'#446688', fontSize:'10px' }}>ブリーダーの証が必要</div>
                  <div style={{ color:'#446688', fontSize:'10px' }}>クラスLV{cl?cl.lv:1}/{getEffectiveCap('ブリーダー', profile.retraining)}</div>
                </div>
                <button onClick={()=>setPendingClassChange('ブリーダー')} disabled={isCurrent||!canChange||loading}
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
        {autoSortie && (
          <button onClick={()=>setAutoSortie(false)} style={{ position:'fixed', bottom:'14px', left:'50%', transform:'translateX(-50%)', zIndex:250, padding:'8px 14px', background:'#1a0e00', border:'1px solid #ffaa44', color:'#ffaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', whiteSpace:'nowrap' }}>🔁 自動出撃中（タップで停止）</button>
        )}
        <div style={{ background:'#000820', borderBottom:'1px solid #003366', padding:'6px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:100 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <div style={{ color:'#ffcc00', fontSize:'13px', letterSpacing:'2px' }}>BATTLE FRONTIER</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
            <button onClick={()=>{ setShowAnnouncements(true); markAllAnnouncementsSeen() }} style={{ background:'none', border:`1px solid ${hasNewAnnouncements?'#ffaa22':'#ff8844'}`, color:`${hasNewAnnouncements?'#ffaa22':'#ff8844'}`, padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', position:'relative' }}>
              📢{hasNewAnnouncements && <span style={{ marginLeft:'2px', background:'#ff4400', color:'#fff', fontSize:'7px', padding:'1px 3px', borderRadius:'2px', verticalAlign:'middle' }}>NEW</span>}
            </button>
            <button onClick={()=>{ setGuideView("select"); setOpenGuideId(null); setOpenHelpId(null); setShowGuide(true) }} style={{ background:'none', border:'1px solid #44aaff', color:'#44aaff', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>📖</button>
            <button onClick={()=>nav('/ranking')} style={{ background:'none', border:'1px solid #ffcc00', color:'#ffcc00', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏆</button>
            <button onClick={()=>setShowMenu(!showMenu)} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>☰ メニュー</button>
          </div>
        </div>
        {showMenu && (
          <div style={{ position:'fixed', top:'40px', right:'12px', background:'#001040', border:'1px solid #446688', zIndex:200, minWidth:'120px' }}>
            {/* ★2026-06-20公開: 全プレイヤーに新メニュー（お知らせ/ヘルプ/オプション）。施設は街本文の☰メニュー▼から */}
            <button onClick={()=>{ setShowAnnouncements(true); markAllAnnouncementsSeen(); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ff8844', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📢 お知らせ</button>
            <button onClick={()=>{ setGuideView("select"); setOpenGuideId(null); setOpenHelpId(null); setShowGuide(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📖 ヘルプ</button>
            <button onClick={()=>{ window.open('https://foamy-cathedral-702.notion.site/BATTLE-FRONTIER-38b3081b1d0180ebbfb8dafcc0b01444', '_blank', 'noopener,noreferrer'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ffd700', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📚 攻略データ（Wiki）</button>
            <button onClick={()=>{ setShowOptions(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>⚙ 出撃設定</button>
            {profile?.is_admin && (
              <button onClick={()=>{ nav('/status'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📊 ステータス詳細[開発]</button>
            )}
            {profile?.is_admin && (
              <button onClick={()=>{ nav('/idle'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44ffaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🏕 自動遠征[開発]</button>
            )}
            {profile?.is_admin && (
              <button onClick={()=>{ setAutoSortie(v=>!v); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color: autoSortie?'#ff6644':'#ffaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🔁 自動出撃[開発] {autoSortie?'ON（タップで停止）':'OFF'}</button>
            )}
            {profile?.is_admin && (
              <button onClick={()=>{ nav('/card-battle'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🎴 幻札バトル[開発]</button>
            )}
            <button onClick={()=>{ nav('/action-rpg'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#9fe', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🗡 アクションRPG <span style={{ fontSize:'9px', color:'#8877aa' }}>(お試し)</span></button>
            <button onClick={()=>{ setAiOpen(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🤖 AI戦闘民族ジェミータ（β版）</button>
            <button onClick={()=>{ setRaidNotifyOpen(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ff8866', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🔔 レイド通知</button>
            <button onClick={()=>{ setShowContact(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📩 お問い合わせ</button>
            <button onClick={()=>{ setShowInstallGuide(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📱 ホーム画面に追加</button>
            <button onClick={()=>{ logout(); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🚪 ログアウト</button>
          </div>
        )}
        {showMenu && <div onClick={()=>setShowMenu(false)} style={{ position:'fixed', inset:0, zIndex:150 }} />}

        <div style={{ padding:'8px 12px' }}>
          {unreadAdminMsgs.length > 0 && (
            <button onClick={()=>setAdminMsgOpen(true)}
              style={{ width:'100%', padding:'10px', marginBottom:'8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', animation:'none' }}>
              📩 運営からのお知らせ（{unreadAdminMsgs.length}件）→ タップで確認
            </button>
          )}
          {soldNotice > 0 && (
            <button onClick={()=>{ setSoldNotice(0); nav('/marketplace?tab=history') }}
              style={{ width:'100%', padding:'10px', marginBottom:'8px', background:'#001a14', border:'1px solid #44ddaa', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
              🏷 取引所に登録したアイテムが売れました！（{soldNotice}件）
            </button>
          )}
          {claimableTitles > 0 && (
            <button onClick={()=>nav('/titles')}
              style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#001a08', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🎉 獲得できる称号があります！（{claimableTitles}件）→ 称号ページへ
            </button>
          )}
          {unreadReplies > 0 && (
            <div style={{ display:'flex', gap:'6px', marginBottom:'8px' }}>
              <button onClick={()=>{ setShowContact(true); setContactView('history'); fetchMyContacts().then(rows => markContactRepliesSeen(rows)) }}
                style={{ flex:1, padding:'8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                📩 お問い合わせに運営からの返信が届いています！（{unreadReplies}件）→ 確認する
              </button>
              <button onClick={dismissReplyBanner} title="既読にしてこの通知を消す"
                style={{ flexShrink:0, padding:'8px 12px', background:'#0a1a08', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✓</button>
            </div>
          )}
          {isContactAdmin && unrepliedContacts > 0 && (
            <button onClick={()=>{ setShowContact(true); setContactView('history'); setAdminContactFilter('unreplied'); fetchMyContacts() }}
              style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#1a0a14', border:'1px solid #ff66aa', color:'#ff88bb', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              📨 未返信のお問い合わせがあります（{unrepliedContacts}件）→ 受信一覧へ
            </button>
          )}
          {papiaNeedsSetup && (
            <button onClick={()=>setShowOptions(true)}
              style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#1a1200', border:'1px solid #ffaa00', color:'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🌟 パピア出現率アップの時間が未設定です（設定するまで発生しません）→ 設定する
            </button>
          )}
          {alchemyReady > 0 && (
            <button onClick={()=>nav('/alchemy')}
              style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#021410', border:'1px solid #44ddaa', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🧪 錬金部屋で強化石を受け取れます！（{alchemyReady}件）→ 錬金部屋へ
            </button>
          )}
          {alchemyEmpty > 0 && (
            <button onClick={()=>nav('/alchemy')}
              style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#0a1408', border:'1px solid #88cc66', color:'#aadd88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🧪 錬金部屋に空きがあります（{alchemyEmpty}枠）→ 錬金を始める
            </button>
          )}
          {atWar && (
            <button onClick={()=>nav('/war')}
              style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#2a0808', border:'1px solid #e05a62', color:'#ff8a6a', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', letterSpacing:'1px' }}>
              ⚔ 戦争中！国の存亡をかけた戦いに参加 → 戦争ページへ
            </button>
          )}
          {territoryExpandable && (
            <button onClick={()=>nav('/territory')}
              style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🗺 領地を広げられます！→ 領地へ
            </button>
          )}
          {boxAvailable > 0 && (
            <button onClick={()=>nav('/equipment?view=items')}
              style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#1a0010', border:'1px solid #ff88aa', color:'#ff99cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🎁 ボス装備進化支援箱を{boxAvailable}個所持中！→ アイテム画面で使う
            </button>
          )}
          {scarecrowState === 'done' && (
            <button onClick={()=>nav('/scarecrow')} style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#0a0800', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🌾 かかし修練が完了！報酬を受け取れます → 修練場へ
            </button>
          )}
          {scarecrowState === 'training' && (
            <button onClick={()=>nav('/scarecrow')} style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#0a0800', border:'1px solid #886600', color:'#ccaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🌾 かかし修練中… → 修練場へ
            </button>
          )}
          {profile?.is_fishing && (
            <button onClick={()=>nav('/fishing')} style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#001420', border:'1px solid #33aadd', color:'#66ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              🎣 釣り中… → 釣り場へ
            </button>
          )}
          {subsidyAvailable && (
            <button onClick={()=>nav('/territory')} style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              💰 本日の補助金を受け取れます → 領地へ
            </button>
          )}
          <div style={{ border:`1px solid ${isDying?'#660000':'#0044aa'}`, background:'#001040', padding:'10px', marginBottom:'8px' }}>
            {isDying && <div style={{ color:'#ff4444', fontSize:'11px', textAlign:'center', marginBottom:'6px', border:'1px solid #660000', padding:'3px', background:'#1a0000' }}>⚠ 瀕死状態　HP全回復まで出撃不可</div>}
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
              {profile.avatar_url && <img src={profile.avatar_url} alt="avatar" style={{ width: NEW_UI ? '76px' : '48px', height: NEW_UI ? '76px' : '48px', objectFit:'cover', flexShrink:0 }} />}
              <div style={{ flex:1, textAlign: NEW_UI ? 'left' : undefined, display: NEW_UI ? 'flex' : undefined, justifyContent: NEW_UI ? 'space-between' : undefined, alignItems: NEW_UI ? 'flex-start' : undefined }}>
                <div>
                  <div style={{ color:'#ffcc00', fontSize:'13px' }}>
                    {profile.display_title && <span style={{ color:'#aaaaff', fontSize:'11px', marginRight:'4px' }}>{profile.display_title}</span>}
                    {profile.username}
                  </div>
                  <div style={{ fontSize:'11px', color:'#6688aa' }}>
                    <span style={{color:'#88ccff'}}>{profile.class}</span><span style={{color:'#ffcc00'}}>{getRetrainingStars(profile.class, profile.retraining)}</span> <span style={{color:'#ffcc00'}}>LV{currentClassLv}</span>／{cap}
                  </div>
                  <div style={{ fontSize:'11px', color:'#6688aa' }}>
                    キャラクターLV: <span style={{color:'#ffcc00'}}>{charLv}</span>{!NEW_UI && <>　<span style={{color:'#44ff88'}}>{total}</span> <span style={{color:totalRank.color}}>{totalRank.rank}</span></>}
                  </div>
                  {NEW_UI && (
                    <div style={{ fontSize:'11px', color:'#6688aa' }}>
                      総合力: <span style={{color:'#44ff88'}}>{total}</span> <span style={{color:totalRank.color}}>{totalRank.rank}</span>
                    </div>
                  )}
                  <div style={{ fontSize:'11px', color:'#6688aa' }}>Gold: <span style={{color:'#ffcc00'}}>{profile.gold}</span></div>
                </div>
                {profile.country_id && (
                  <div style={{ textAlign:'right', fontSize:'11px', color:'#6688aa', lineHeight:'1.7', flexShrink:0, marginLeft:'8px' }}>
                    <div>所属国</div>
                    <div style={{ color:'#88ccff' }}>{myCountryName || '—'}</div>
                    <div>階級：<span style={{ color: rankColor(profile.country_rank) }}>{profile.country_rank || '—'}</span></div>
                  </div>
                )}
              </div>
            </div>
            {atWar && (
              <div style={{ display:'flex', alignItems:'center', gap:'6px', background:'#2a0808', border:'1px solid #e05a62', color:'#ff8a6a', fontSize:'11px', padding:'3px 8px', marginBottom:'4px', letterSpacing:'1px' }}>
                <span>⚔ 戦争中</span><span style={{ color:'#cc8866', fontSize:'10px' }}>HP上限 +{WAR_HP_BONUS.toLocaleString()}（満タン参戦）</span>
              </div>
            )}
            <MiniBar label="HP" val={`${hpCurrent}/${hpMaxDisp}`} pct={hpPct} color={isDying?'#ff2200':(atWar?'#ff6644':'#00cc44')} />
            <MiniBar label="MP" val={`${mpCurrent}/${mpMaxEff}`} pct={mpPct} color="#4488ff" />
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
              {!NEW_UI && <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'8px' }}>🏰 街</div>}
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
              {nextHint && (
                <div style={{ background:'#001626', border:'1px solid #2a6699', color:'#88ccff', padding:'7px 10px', marginBottom:'8px', fontSize:'11px', lineHeight:'1.5', borderRadius:'3px' }}>
                  💡 {nextHint}
                </div>
              )}
              {papiaEvent.active && (
                <div style={{ background:'#1a0a00', border:'1px solid #ffaa00', padding:'6px 10px', marginBottom:'8px', textAlign:'center', fontSize:'11px' }}>
                  <span style={{ color:'#ffaa00' }}>🌟 パピア出現率アップ中！</span>
                  <span style={{ color:'#446688', marginLeft:'8px' }}>残り{papiaEvent.remainingMin}分{papiaEvent.remainingSec}秒</span>
                </div>
              )}
              {boostActive && (
                <div style={{ background:'#1a1400', border:'1px solid #ffcc44', padding:'6px 10px', marginBottom:'8px', textAlign:'center', fontSize:'11px' }}>
                  <span style={{ color:'#ffcc44' }}>⚡ ブーストタイム中！</span>
                  <span style={{ color:'#446688', marginLeft:'8px' }}>残り約{boostRemainMin}分（出撃が{BOOST_WAIT}秒に短縮）</span>
                </div>
              )}
              {matEventBannerVisible && (
                <div style={{ background:'#001a0f', border:'1px solid #44ffaa', padding:'8px 10px', marginBottom:'8px', fontSize:'11px' }}>
                  <div style={{ color:'#44ffaa', textAlign:'center', fontWeight:'bold', marginBottom:'4px' }}>
                    ✨ お宝素材ドロップ2倍イベント開催中！
                  </div>
                  <div style={{ color:'#446688', textAlign:'center', marginBottom:'5px' }}>
                    管理人がお宝作成達成記念 ／ 残り{materialEvent.remainingHour}時間{materialEvent.remainingMin}分
                  </div>
                  <div style={{ color:'#88ccbb', fontSize:'10px', lineHeight:'1.5' }}>
                    森の生命液…始まりの森 ／ 荒野の薬草…荒廃した草原 ／ 古代の精髄…古代の洞窟<br/>
                    蒼海の精気…蒼海の入り江 ／ 雷鳴の精気…巨峰山脈 ／ 霜の精気…白銀の霊峰
                  </div>
                  <div style={{ textAlign:'center', marginTop:'6px' }}>
                    <button onClick={dismissMatEventBanner} style={{ padding:'3px 16px', background:'#001a08', border:'1px solid #44ffaa', color:'#44ffaa', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>確認（次の日まで非表示）</button>
                  </div>
                </div>
              )}
              {(() => {
                const isSeen = raidNoticeSeenToday
                const b = raidBossData?.boss
                const parts = raidBossData?.participants || []
                const hpRatio = b ? b.hp_current / b.hp_max : 0
                const totalDmg = parts.reduce((s,p) => s + Number(p.damage_dealt), 0)
                const waitingSeen = raidNoticeSeenToday
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
                      {(raidStatus === 'defeated' || raidStatus === 'expired') && (
                        <span style={{ color:'#446688', fontSize:'10px', cursor:'pointer' }}
                          onClick={()=>{ markRaidNoticeSeen(); setRaidStatus(null); setRaidBossData(null) }}>× 閉じる</span>
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
                      if (raidNoticeSeenToday) return null
                      return (
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ fontSize:'10px', color:'#335566' }}>毎日21:00 JST 出現</span>
                          <button onClick={()=>{ markRaidNoticeSeen(); nav('/raid') }} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'3px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>確認する</button>
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}
              <button onClick={(e)=>doBattle(e)} disabled={!canAct||loading||!canBattle}
                style={{ width:'100%', padding:'14px', background:'#001840', border:`1px solid ${canAct&&canBattle?'#ffcc00':'#003366'}`, color:canAct&&canBattle?'#ffcc00':'#446688', cursor:canAct&&canBattle?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'10px' }}>
                {atWar?'⚔ 戦争中（出撃不可）':isBanned?'⛔ 出撃禁止中':isDying&&!canBattle?'💀 瀕死中':canAct?`⚔ ${AREAS.find(a=>a.id===selectedArea)?.name}へ出撃！`:'⏳ 待機中...'}
              </button>
              <button onClick={()=>setShowDungeonPanel(!showDungeonPanel)} disabled={dungeonAllUsedUp||loading||isBanned}
                style={{ width:'100%', padding:'12px', background:'#0a001a', border:`1px solid ${dungeonAllUsedUp||isBanned?'#333':'#cc44ff'}`, color:dungeonAllUsedUp||isBanned?'#333':'#cc44ff', cursor:dungeonAllUsedUp||isBanned?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'13px', marginBottom:'10px', opacity:dungeonAllUsedUp||isBanned?0.4:1 }}>
                ⚔ デイリーダンジョン
              </button>
              {showDungeonPanel && (
                <div style={{ border:'1px solid #440088', background:'#0a001a', padding:'10px', marginBottom:'10px' }}>
                  <div style={{ color:'#cc44ff', fontSize:'11px', marginBottom:'8px' }}>ダンジョンを選択（各{dungeonDailyLimitFor(profile)}回/日）</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                    {DUNGEON_LIST.map(d => {
                      const used = dungeonCounts[d.type]||0
                      const full = used >= dungeonDailyLimitFor(profile)
                      const dis = full || loading   // ★2026-06-26: デイリーダンジョンはCDなし（回数のみ制限）
                      return (
                      <button key={d.type} disabled={dis} onClick={() => { doDungeon(d.type); setShowDungeonPanel(false) }}
                        style={{ padding:'10px', background:'#001020', border:`1px solid ${dis?'#333':'#440088'}`, color:dis?'#333':'#cc44ff', cursor:dis?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'11px', opacity:dis?0.4:1 }}>
                        {d.label}<br/><span style={{fontSize:'10px',color:dis?'#333':'#446688'}}>{`残り${dungeonDailyLimitFor(profile)-used}/${dungeonDailyLimitFor(profile)}`}</span>
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
              {NEW_UI ? (
                <>
                  {/* メニュー（展開式） */}
                  <button onClick={toggleFacilitiesExpanded}
                    style={{ width:'100%', padding:'12px', marginTop:'10px', background:'#000e1a', border:'1px solid #336699', color:'#88aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', letterSpacing:'2px' }}>
                    {facilitiesExpanded ? '▲ メニューを閉じる' : '☰ メニュー ▼'}
                  </button>
                  {facilitiesExpanded && (
                    <div style={{ border:'1px solid #003366', background:'#000a14', padding:'10px', marginTop:'8px' }}>
                      {(() => { const acc = true; return (<>
                      <MenuCat title="コンテンツ" catKey="content" accordion={acc} open={openMenuCats.content !== undefined ? !!openMenuCats.content : eventVisible} onToggle={toggleMenuCat}>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                        {eventVisible && (
                          <button onClick={()=>nav('/event')} style={{ gridColumn:'1 / -1', padding:'12px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', letterSpacing:'2px' }}>🎫 イベント開催中！</button>
                        )}
                        <button onClick={()=>nav('/territory')} style={{ padding:'10px', background:'#001020', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏰 領地</button>
                        <button onClick={()=>nav('/pets')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa88ff', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🐾 ペット</button>
                        <button onClick={()=>nav('/raid')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff6644', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚔ レイドボス</button>
                        {lockOr('abyss', <button key="challenge" onClick={()=>setShowChallengePanel(!showChallengePanel)} style={{ padding:'10px', background:'#1a0a0e', border:'1px solid #e05a62', color:'#ff6464', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚔ 挑戦</button>)}
                      </div>
                      {showChallengePanel && (
                        <div ref={challengePanelRef} style={{ border:'1px solid #8a3a44', background:'#160809', padding:'10px', marginTop:'8px' }}>
                          <div style={{ color:'#ff6464', fontSize:'11px', marginBottom:'8px' }}>挑戦するコンテンツを選択</div>
                          <button onClick={()=>{ nav('/abyss'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', background:'#1a0c2a', border:'1px solid #a060ff', color:'#d0a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🕯 奈落闘技場</button>
                          {profile?.is_admin && (
                          <button onClick={()=>{ setShowArena(true); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #a060e0', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🏛 アリーナ <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                          )}
                          {profile?.is_admin && (
                            <button onClick={()=>{ nav('/tenkyuu'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🌌 天穹十二宮 <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                          )}
                          {profile?.is_admin && (
                            <button onClick={()=>{ setShowPvp(true); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#1a0a14', border:'1px solid #e05a8a', color:'#ff8ab0', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>⚔ 対人戦 <span style={{ fontSize:'9px', color:'#aa7788' }}>[開発]</span></button>
                          )}
                        </div>
                      )}
                      </MenuCat>
                      <MenuCat title="キャラクター" catKey="character" accordion={acc} open={!!openMenuCats.character} onToggle={toggleMenuCat}>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                        <button onClick={()=>nav('/equipment?view=gear')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🗡 装備</button>
                        <button onClick={()=>nav('/skills')} style={{ padding:'10px', background:'#001020', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚡ スキル</button>
                        <button onClick={()=>nav('/profile')} style={{ padding:'10px', background:'#001020', border:'1px solid #44ff88', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>👤 プロフィール</button>
                        <button onClick={()=>nav('/equipment?view=items')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎒 アイテム</button>
                      </div>
                      </MenuCat>
                      <MenuCat title="施設" catKey="facility" accordion={acc} open={!!openMenuCats.facility} onToggle={toggleMenuCat}>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                        <button onClick={()=>{ setScene('inn'); setInnMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #0088aa', color:'#00aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏨 宿屋</button>
                        <button onClick={()=>{ setScene('temple'); setTempleMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ccaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⛩ 神殿</button>
                        <button onClick={()=>nav('/shop')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aa44', color:'#44aa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🛒 商店</button>
                        <button onClick={()=>nav('/smithy')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚒ 鍛冶屋</button>
                        {lockOr('museum', <button key="museum" onClick={()=>nav('/museum')} style={{ padding:'10px', background:'#001020', border:'1px solid #ccaa44', color:'#ccaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏛 博物館</button>)}
                        {lockOr('exchange', <button key="exchange" onClick={()=>nav('/exchange')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff6644', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🔄 交換所</button>)}
                        {lockOr('marketplace', <button key="marketplace" onClick={()=>nav('/marketplace')} style={{ padding:'10px', background:'#001020', border:'1px solid #1a8a6a', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏷 取引所</button>)}
                        {lockOr('casino', <button key="casino" onClick={()=>nav('/casino')} style={{ padding:'10px', background:'#001020', border:'1px solid #ffaa00', color:'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎰 賭博場</button>)}
                        {lockOr('barber', <button key="barber" onClick={()=>nav('/barber')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff88cc', color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✂ 美容院</button>)}
                        <button key="kumite" onClick={()=>setShowKumite(true)} style={{ padding:'10px', background:'#001020', border:'1px solid #5ab0e0', color:'#8ad0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🥊 組み手</button>
                      </div>
                      </MenuCat>
                      <MenuCat title="放置コンテンツ" catKey="idle" accordion={acc} open={!!openMenuCats.idle} onToggle={toggleMenuCat}>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                        {lockOr('fishing', <button key="fishing" onClick={()=>nav('/fishing')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎣 釣り場</button>)}
                        {lockOr('scarecrow', <button key="scarecrow" onClick={()=>nav('/scarecrow')} style={{ padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🌾 かかし修練場</button>)}
                        {lockOr('alchemy', <button key="alchemy" onClick={()=>nav('/alchemy')} style={{ padding:'10px', background:'#001020', border:'1px solid #1a8a6a', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🧪 錬金部屋</button>)}
                      </div>
                      </MenuCat>
                      </>) })()}
                    </div>
                  )}
                </>
              ) : (
                <>
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
                <button onClick={()=>nav('/scarecrow')} style={{ padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🌾 かかし修練場</button>
                <button onClick={()=>nav('/pets')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa88ff', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🐾 ペット</button>
                <button onClick={()=>setShowKumite(true)} style={{ padding:'10px', background:'#001020', border:'1px solid #5ab0e0', color:'#8ad0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🥊 組み手</button>
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
                          <button onClick={()=>{ setShowArena(true); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #a060e0', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🏛 アリーナ <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                          )}
                  {profile?.is_admin && (
                    <button onClick={()=>{ nav('/tenkyuu'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🌌 天穹十二宮 <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                  )}
                  {profile?.is_admin && (
                    <button onClick={()=>{ setShowPvp(true); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#1a0a14', border:'1px solid #e05a8a', color:'#ff8ab0', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>⚔ 対人戦 <span style={{ fontSize:'9px', color:'#aa7788' }}>[開発]</span></button>
                  )}
                </div>
              )}
                </>
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
                    <button onClick={useInn} disabled={loading||atWar||(!isDying&&profile.gold<innCost)}
                      style={{ flex:2, padding:'10px', background:'#001830', border:'1px solid #0088aa', color:'#00aacc', cursor:(loading||atWar||(!isDying&&profile.gold<innCost))?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', opacity:(loading||atWar||(!isDying&&profile.gold<innCost))?0.4:1 }}>
                      {atWar ? '戦争中は利用不可' : '利用する'}
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
        <AIAssistant ctx={{ profile, eff, equipment }} open={aiOpen} onClose={()=>setAiOpen(false)} />
        <RaidNotify open={raidNotifyOpen} onClose={()=>setRaidNotifyOpen(false)} />
        {showPvp && <Suspense fallback={null}><PvpPanel onClose={()=>setShowPvp(false)} /></Suspense>}
        {showKumite && <Suspense fallback={null}><KumitePanel onClose={()=>setShowKumite(false)} /></Suspense>}
        {showArena && <Suspense fallback={null}><ArenaPanel onClose={()=>setShowArena(false)} /></Suspense>}
      </div>
    )
  }

  // ===== PCレイアウト =====
  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      {botCheckOverlay}
        {autoSortie && (
          <button onClick={()=>setAutoSortie(false)} style={{ position:'fixed', bottom:'14px', left:'50%', transform:'translateX(-50%)', zIndex:250, padding:'8px 14px', background:'#1a0e00', border:'1px solid #ffaa44', color:'#ffaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', whiteSpace:'nowrap' }}>🔁 自動出撃中（タップで停止）</button>
        )}
      <div style={{ maxWidth:'900px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          </div>
          <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
            <button onClick={()=>{ setShowAnnouncements(true); markAllAnnouncementsSeen() }} style={{ background:'none', border:`1px solid ${hasNewAnnouncements?'#ffaa22':'#ff8844'}`, color:`${hasNewAnnouncements?'#ffaa22':'#ff8844'}`, padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', position:'relative' }}>
              📢 お知らせ{hasNewAnnouncements && <span style={{ marginLeft:'4px', background:'#ff4400', color:'#fff', fontSize:'8px', padding:'1px 4px', borderRadius:'2px', verticalAlign:'middle' }}>NEW</span>}
            </button>
            <button onClick={()=>{ setGuideView("select"); setOpenGuideId(null); setOpenHelpId(null); setShowGuide(true) }} style={{ background:'none', border:'1px solid #44aaff', color:'#44aaff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>📖 ガイド</button>
            <button onClick={()=>nav('/ranking')} style={{ background:'none', border:'1px solid #ffcc00', color:'#ffcc00', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏆 ランキング</button>
            <button onClick={()=>setShowMenu(!showMenu)} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>☰ メニュー</button>
          </div>
        </div>
        {showMenu && (
          <div style={{ position:'fixed', top:'48px', right:'16px', background:'#001040', border:'1px solid #446688', zIndex:200, minWidth:'150px' }}>
            {/* ★2026-06-20公開: 全プレイヤーに新メニュー（お知らせ/ヘルプ/オプション）。施設は街本文の☰メニュー▼から */}
            <button onClick={()=>{ setShowAnnouncements(true); markAllAnnouncementsSeen(); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ff8844', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📢 お知らせ</button>
            <button onClick={()=>{ setGuideView("select"); setOpenGuideId(null); setOpenHelpId(null); setShowGuide(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📖 ヘルプ</button>
            <button onClick={()=>{ window.open('https://foamy-cathedral-702.notion.site/BATTLE-FRONTIER-38b3081b1d0180ebbfb8dafcc0b01444', '_blank', 'noopener,noreferrer'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ffd700', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📚 攻略データ（Wiki）</button>
            <button onClick={()=>{ setShowOptions(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>⚙ 出撃設定</button>
            {profile?.is_admin && (
              <button onClick={()=>{ nav('/status'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📊 ステータス詳細[開発]</button>
            )}
            {profile?.is_admin && (
              <button onClick={()=>{ nav('/idle'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44ffaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🏕 自動遠征[開発]</button>
            )}
            {profile?.is_admin && (
              <button onClick={()=>{ setAutoSortie(v=>!v); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color: autoSortie?'#ff6644':'#ffaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🔁 自動出撃[開発] {autoSortie?'ON（タップで停止）':'OFF'}</button>
            )}
            {profile?.is_admin && (
              <button onClick={()=>{ nav('/card-battle'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🎴 幻札バトル[開発]</button>
            )}
            <button onClick={()=>{ nav('/action-rpg'); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#9fe', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🗡 アクションRPG <span style={{ fontSize:'9px', color:'#8877aa' }}>(お試し)</span></button>
            <button onClick={()=>{ setAiOpen(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🤖 AI戦闘民族ジェミータ（β版）</button>
            <button onClick={()=>{ setRaidNotifyOpen(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#ff8866', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🔔 レイド通知</button>
            <button onClick={()=>{ setShowContact(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#88ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📩 お問い合わせ</button>
            <button onClick={()=>{ setShowInstallGuide(true); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', borderBottom:'1px solid #002244', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>📱 ホーム画面に追加</button>
            <button onClick={()=>{ logout(); setShowMenu(false) }} style={{ display:'block', width:'100%', padding:'10px 16px', background:'none', border:'none', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>🚪 ログアウト</button>
          </div>
        )}
        {showMenu && <div onClick={()=>setShowMenu(false)} style={{ position:'fixed', inset:0, zIndex:150 }} />}

        {unreadAdminMsgs.length > 0 && (
          <button onClick={()=>setAdminMsgOpen(true)}
            style={{ width:'100%', padding:'10px', marginBottom:'12px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
            📩 運営からのお知らせ（{unreadAdminMsgs.length}件）→ タップで確認
          </button>
        )}
        {soldNotice > 0 && (
          <button onClick={()=>{ setSoldNotice(0); nav('/marketplace?tab=history') }}
            style={{ width:'100%', padding:'10px', marginBottom:'12px', background:'#001a14', border:'1px solid #44ddaa', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
            🏷 取引所に登録したアイテムが売れました！（{soldNotice}件）
          </button>
        )}
        {claimableTitles > 0 && (
          <button onClick={()=>nav('/titles')}
            style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#001a08', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🎉 獲得できる称号があります！（{claimableTitles}件）→ 称号ページへ
          </button>
        )}
        {unreadReplies > 0 && (
          <div style={{ display:'flex', gap:'6px', marginBottom:'12px' }}>
            <button onClick={()=>{ setShowContact(true); setContactView('history'); fetchMyContacts().then(rows => markContactRepliesSeen(rows)) }}
              style={{ flex:1, padding:'8px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
              📩 お問い合わせに運営からの返信が届いています！（{unreadReplies}件）→ 確認する
            </button>
            <button onClick={dismissReplyBanner} title="既読にしてこの通知を消す"
              style={{ flexShrink:0, padding:'8px 12px', background:'#0a1a08', border:'1px solid #44aa44', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✓</button>
          </div>
        )}
        {isContactAdmin && unrepliedContacts > 0 && (
          <button onClick={()=>{ setShowContact(true); setContactView('history'); setAdminContactFilter('unreplied'); fetchMyContacts() }}
            style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#1a0a14', border:'1px solid #ff66aa', color:'#ff88bb', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            📨 未返信のお問い合わせがあります（{unrepliedContacts}件）→ 受信一覧へ
          </button>
        )}
        {papiaNeedsSetup && (
          <button onClick={()=>setShowOptions(true)}
            style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#1a1200', border:'1px solid #ffaa00', color:'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🌟 パピアの出現時間が未設定です！→ 出撃設定へ
          </button>
        )}
        {alchemyReady > 0 && (
          <button onClick={()=>nav('/alchemy')}
            style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#021410', border:'1px solid #44ddaa', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🧪 錬金部屋で強化石を受け取れます！（{alchemyReady}件）→ 錬金部屋へ
          </button>
        )}
        {alchemyEmpty > 0 && (
          <button onClick={()=>nav('/alchemy')}
            style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#0a1408', border:'1px solid #88cc66', color:'#aadd88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🧪 錬金部屋に空きがあります（{alchemyEmpty}枠）→ 錬金を始める
          </button>
        )}
        {atWar && (
          <button onClick={()=>nav('/war')}
            style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#2a0808', border:'1px solid #e05a62', color:'#ff8a6a', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', letterSpacing:'1px' }}>
            ⚔ 戦争中！国の存亡をかけた戦いに参加 → 戦争ページへ
          </button>
        )}
        {territoryExpandable && (
          <button onClick={()=>nav('/territory')}
            style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🗺 領地を広げられます！→ 領地へ
          </button>
        )}
        {boxAvailable > 0 && (
          <button onClick={()=>nav('/equipment?view=items')}
            style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#1a0010', border:'1px solid #ff88aa', color:'#ff99cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🎁 ボス装備進化支援箱を{boxAvailable}個所持中！→ アイテム画面で使う
          </button>
        )}
        {scarecrowState === 'done' && (
          <button onClick={()=>nav('/scarecrow')} style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#0a0800', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🌾 かかし修練が完了！報酬を受け取れます → 修練場へ
          </button>
        )}
        {scarecrowState === 'training' && (
          <button onClick={()=>nav('/scarecrow')} style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#0a0800', border:'1px solid #886600', color:'#ccaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🌾 かかし修練中… → 修練場へ
          </button>
        )}
        {profile?.is_fishing && (
          <button onClick={()=>nav('/fishing')} style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#001420', border:'1px solid #33aadd', color:'#66ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🎣 釣り中… → 釣り場へ
          </button>
        )}
        {subsidyAvailable && (
          <button onClick={()=>nav('/territory')} style={{ width:'100%', padding:'8px', marginBottom:'12px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            💰 本日の補助金を受け取れます → 領地へ
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
            {profile.country_id && (
              <div style={{ textAlign:'right', fontSize:'11px', color:'#6688aa', lineHeight:'1.6', marginBottom:'6px' }}>
                所属国 <span style={{ color:'#88ccff' }}>{myCountryName || '—'}</span>
                <span style={{ marginLeft:'8px' }}>階級：<span style={{ color: rankColor(profile.country_rank) }}>{profile.country_rank || '—'}</span></span>
              </div>
            )}
            <div style={{ fontSize:'11px', color:'#6688aa', marginBottom:'2px' }}>
              クラス: <span style={{color:'#88ccff'}}>{profile.class}</span> <span style={{color:'#ffcc00'}}>LV{currentClassLv}</span>／<span style={{color:'#6688aa'}}>{cap}</span>
            </div>
            <div style={{ fontSize:'11px', color:'#6688aa', marginBottom:'2px' }}>
              キャラクターLV: <span style={{color:'#ffcc00'}}>{charLv}</span>
            </div>
            <div style={{ fontSize:'11px', color:'#6688aa', marginBottom:'6px', display:'flex', justifyContent:'space-between' }}>
              <span>総合力: <span style={{color:'#44ff88', fontWeight:'bold'}}>{total}</span></span>
              <span style={{color:totalRank.color, fontWeight:'bold'}}>{totalRank.rank}</span>
            </div>
            {atWar && (
              <div style={{ display:'flex', alignItems:'center', gap:'6px', background:'#2a0808', border:'1px solid #e05a62', color:'#ff8a6a', fontSize:'11px', padding:'3px 8px', marginBottom:'4px', letterSpacing:'1px' }}>
                <span>⚔ 戦争中</span><span style={{ color:'#cc8866', fontSize:'10px' }}>HP上限 +{WAR_HP_BONUS.toLocaleString()}（満タン参戦）</span>
              </div>
            )}
            <StatBar label="HP" val={`${hpCurrent}/${hpMaxDisp}`} pct={hpPct} color={isDying?'#ff2200':(atWar?'#ff6644':'#00cc44')} />
            <StatBar label="MP" val={`${mpCurrent}/${mpMaxEff}`} pct={mpPct} color="#4488ff" />
            {statExpanded && (<>
              <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginTop:'6px' }}>
                <span>EXP</span><span style={{color:'#cc8800'}}>{profile.exp}/{profile.exp_next}</span>
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
                <span>Gold: <span style={{color:'#ffcc00'}}>{profile.gold}</span></span>
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
                {!NEW_UI && <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'8px' }}>🏰 街</div>}
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
                {nextHint && (
                  <div style={{ background:'#001626', border:'1px solid #2a6699', color:'#88ccff', padding:'7px 10px', marginBottom:'8px', fontSize:'11px', lineHeight:'1.5', borderRadius:'3px' }}>
                    💡 {nextHint}
                  </div>
                )}
                {papiaEvent.active && (
                  <div style={{ background:'#1a0a00', border:'1px solid #ffaa00', padding:'6px 10px', marginBottom:'8px', textAlign:'center', fontSize:'11px' }}>
                    <span style={{ color:'#ffaa00' }}>🌟 パピア出現率アップ中！</span>
                    <span style={{ color:'#446688', marginLeft:'8px' }}>残り{papiaEvent.remainingMin}分{papiaEvent.remainingSec}秒</span>
                  </div>
                )}
                {boostActive && (
                  <div style={{ background:'#1a1400', border:'1px solid #ffcc44', padding:'6px 10px', marginBottom:'8px', textAlign:'center', fontSize:'11px' }}>
                    <span style={{ color:'#ffcc44' }}>⚡ ブーストタイム中！</span>
                    <span style={{ color:'#446688', marginLeft:'8px' }}>残り約{boostRemainMin}分（出撃が{BOOST_WAIT}秒に短縮）</span>
                  </div>
                )}
                {matEventBannerVisible && (
                  <div style={{ background:'#001a0f', border:'1px solid #44ffaa', padding:'8px 10px', marginBottom:'8px', fontSize:'11px' }}>
                    <div style={{ color:'#44ffaa', textAlign:'center', fontWeight:'bold', marginBottom:'4px' }}>
                      ✨ お宝素材ドロップ2倍イベント開催中！
                    </div>
                    <div style={{ color:'#446688', textAlign:'center', marginBottom:'5px' }}>
                      管理人がお宝作成達成記念 ／ 残り{materialEvent.remainingHour}時間{materialEvent.remainingMin}分
                    </div>
                    <div style={{ color:'#88ccbb', fontSize:'10px', lineHeight:'1.5' }}>
                      森の生命液…始まりの森 ／ 荒野の薬草…荒廃した草原 ／ 古代の精髄…古代の洞窟<br/>
                      蒼海の精気…蒼海の入り江 ／ 雷鳴の精気…巨峰山脈 ／ 霜の精気…白銀の霊峰
                    </div>
                    <div style={{ textAlign:'center', marginTop:'6px' }}>
                      <button onClick={dismissMatEventBanner} style={{ padding:'3px 16px', background:'#001a08', border:'1px solid #44ffaa', color:'#44ffaa', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>確認（次の日まで非表示）</button>
                    </div>
                  </div>
                )}
                {(() => {
                  const isSeen = raidNoticeSeenToday
                  const b = raidBossData?.boss
                  const parts = raidBossData?.participants || []
                  const hpRatio = b ? b.hp_current / b.hp_max : 0
                  const totalDmg = parts.reduce((s,p) => s + Number(p.damage_dealt), 0)
                  const hasUnclaimed = raidStatus === 'defeated' && parts.some(p => p.player_id === profile?.id && !p.reward_claimed)
                  const waitingSeen2 = raidNoticeSeenToday
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
                        {(raidStatus === 'defeated' || raidStatus === 'expired') && (
                          <span style={{ color:'#446688', fontSize:'10px', cursor:'pointer' }}
                            onClick={()=>{ markRaidNoticeSeen(); setRaidStatus(null); setRaidBossData(null) }}>× 閉じる</span>
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
                        if (raidNoticeSeenToday) return null
                        return (
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ fontSize:'10px', color:'#335566' }}>毎日21:00 JST 出現</span>
                            <button onClick={()=>{ markRaidNoticeSeen(); nav('/raid') }} style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'3px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>確認する</button>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })()}
                <button onClick={(e)=>doBattle(e)} disabled={!canAct||loading||!canBattle}
                  style={{ width:'100%', padding:'12px', background:'#001840', border:`1px solid ${canAct&&canBattle?'#ffcc00':'#003366'}`, color:canAct&&canBattle?'#ffcc00':'#446688', cursor:canAct&&canBattle?'pointer':'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px', marginBottom:'8px' }}>
                  {atWar?'⚔ 戦争中（出撃不可）':isBanned?'⛔ 出撃禁止中':isDying&&!canBattle?'💀 瀕死中（HP全回復まで出撃不可）':canAct?`⚔ ${AREAS.find(a=>a.id===selectedArea)?.name}へ出撃！`:'⏳ 待機中...'}
                </button>
                <button onClick={()=>setShowDungeonPanel(!showDungeonPanel)} disabled={dungeonAllUsedUp||loading}
                  style={{ width:'100%', padding:'10px', background:'#0a001a', border:`1px solid ${dungeonAllUsedUp?'#333':'#cc44ff'}`, color:dungeonAllUsedUp?'#333':'#cc44ff', cursor:dungeonAllUsedUp?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', marginBottom:'8px', opacity:dungeonAllUsedUp?0.4:1 }}>
                  ⚔ デイリーダンジョン
                </button>
                {showDungeonPanel && (
                  <div style={{ border:'1px solid #440088', background:'#0a001a', padding:'10px', marginBottom:'8px' }}>
                    <div style={{ color:'#cc44ff', fontSize:'11px', marginBottom:'8px' }}>ダンジョンを選択（各{dungeonDailyLimitFor(profile)}回/日）</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                      {DUNGEON_LIST.map(d => {
                        const used = dungeonCounts[d.type]||0
                        const full = used >= dungeonDailyLimitFor(profile)
                        const dis = full || loading || !canAct
                        return (
                        <button key={d.type} disabled={dis} onClick={() => { doDungeon(d.type); setShowDungeonPanel(false) }}
                          style={{ padding:'10px', background:'#001020', border:`1px solid ${dis?'#333':'#440088'}`, color:dis?'#333':'#cc44ff', cursor:dis?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'11px', opacity:dis?0.4:1 }}>
                          {d.label}<br/><span style={{fontSize:'10px',color:dis?'#333':'#446688'}}>{`残り${dungeonDailyLimitFor(profile)-used}/${dungeonDailyLimitFor(profile)}`}</span>
                        </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {NEW_UI ? (
                  <>
                    {/* メニュー（展開式） */}
                    <button onClick={toggleFacilitiesExpanded}
                      style={{ width:'100%', padding:'12px', marginTop:'10px', background:'#000e1a', border:'1px solid #336699', color:'#88aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', letterSpacing:'2px' }}>
                      {facilitiesExpanded ? '▲ メニューを閉じる' : '☰ メニュー ▼'}
                    </button>
                    {facilitiesExpanded && (
                      <div style={{ border:'1px solid #003366', background:'#000a14', padding:'10px', marginTop:'8px' }}>
                        {(() => { const acc = true; return (<>
                        <MenuCat title="コンテンツ" catKey="content" accordion={acc} open={openMenuCats.content !== undefined ? !!openMenuCats.content : eventVisible} onToggle={toggleMenuCat}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                          {eventVisible && (
                            <button onClick={()=>nav('/event')} style={{ gridColumn:'1 / -1', padding:'12px', background:'#1a1400', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'13px', letterSpacing:'2px' }}>🎫 イベント開催中！</button>
                          )}
                          <button onClick={()=>nav('/territory')} style={{ padding:'10px', background:'#001020', border:'1px solid #ffcc44', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏰 領地</button>
                          <button onClick={()=>nav('/pets')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa88ff', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🐾 ペット</button>
                          <button onClick={()=>nav('/raid')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff6644', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚔ レイドボス</button>
                          {lockOr('abyss', <button key="challenge" onClick={()=>setShowChallengePanel(!showChallengePanel)} style={{ padding:'10px', background:'#1a0a0e', border:'1px solid #e05a62', color:'#ff6464', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚔ 挑戦</button>)}
                        </div>
                        {showChallengePanel && (
                          <div ref={challengePanelRef} style={{ border:'1px solid #8a3a44', background:'#160809', padding:'10px', marginTop:'8px' }}>
                            <div style={{ color:'#ff6464', fontSize:'11px', marginBottom:'8px' }}>挑戦するコンテンツを選択</div>
                            <button onClick={()=>{ nav('/abyss'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', background:'#1a0c2a', border:'1px solid #a060ff', color:'#d0a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🕯 奈落闘技場</button>
                          {profile?.is_admin && (
                          <button onClick={()=>{ setShowArena(true); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #a060e0', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🏛 アリーナ <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                          )}
                            {profile?.is_admin && (
                              <button onClick={()=>{ nav('/tenkyuu'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🌌 天穹十二宮 <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                            )}
                            {profile?.is_admin && (
                              <button onClick={()=>{ setShowPvp(true); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#1a0a14', border:'1px solid #e05a8a', color:'#ff8ab0', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>⚔ 対人戦 <span style={{ fontSize:'9px', color:'#aa7788' }}>[開発]</span></button>
                            )}
                          </div>
                        )}
                        </MenuCat>
                        <MenuCat title="キャラクター" catKey="character" accordion={acc} open={!!openMenuCats.character} onToggle={toggleMenuCat}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                          <button onClick={()=>nav('/equipment?view=gear')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🗡 装備</button>
                          <button onClick={()=>nav('/skills')} style={{ padding:'10px', background:'#001020', border:'1px solid #cc44ff', color:'#cc44ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚡ スキル</button>
                          <button onClick={()=>nav('/profile')} style={{ padding:'10px', background:'#001020', border:'1px solid #44ff88', color:'#44ff88', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>👤 プロフィール</button>
                          <button onClick={()=>nav('/equipment?view=items')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎒 アイテム</button>
                        </div>
                        </MenuCat>
                        <MenuCat title="施設" catKey="facility" accordion={acc} open={!!openMenuCats.facility} onToggle={toggleMenuCat}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                          <button onClick={()=>{ setScene('inn'); setInnMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #0088aa', color:'#00aacc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏨 宿屋へ</button>
                          <button onClick={()=>{ setScene('temple'); setTempleMessage('') }} style={{ padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ccaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⛩ 神殿へ</button>
                          <button onClick={()=>nav('/shop')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aa44', color:'#44aa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🛒 商店へ</button>
                          <button onClick={()=>nav('/smithy')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa6644', color:'#aa6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>⚒ 鍛冶屋へ</button>
                          {lockOr('museum', <button key="museum" onClick={()=>nav('/museum')} style={{ padding:'10px', background:'#001020', border:'1px solid #ccaa44', color:'#ccaa44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏛 博物館へ</button>)}
                          {lockOr('exchange', <button key="exchange" onClick={()=>nav('/exchange')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff6644', color:'#ff6644', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🔄 交換所へ</button>)}
                          {lockOr('marketplace', <button key="marketplace" onClick={()=>nav('/marketplace')} style={{ padding:'10px', background:'#001020', border:'1px solid #1a8a6a', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏷 取引所へ</button>)}
                          {lockOr('casino', <button key="casino" onClick={()=>nav('/casino')} style={{ padding:'10px', background:'#001020', border:'1px solid #ffaa00', color:'#ffaa00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎰 賭博場へ</button>)}
                          {lockOr('barber', <button key="barber" onClick={()=>nav('/barber')} style={{ padding:'10px', background:'#001020', border:'1px solid #ff88cc', color:'#ff88cc', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>✂ 美容院へ</button>)}
                          <button key="kumite" onClick={()=>setShowKumite(true)} style={{ padding:'10px', background:'#001020', border:'1px solid #5ab0e0', color:'#8ad0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🥊 組み手</button>
                        </div>
                        </MenuCat>
                        <MenuCat title="放置コンテンツ" catKey="idle" accordion={acc} open={!!openMenuCats.idle} onToggle={toggleMenuCat}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                          {lockOr('fishing', <button key="fishing" onClick={()=>nav('/fishing')} style={{ padding:'10px', background:'#001020', border:'1px solid #44aaff', color:'#44aaff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🎣 釣り場へ</button>)}
                          {lockOr('scarecrow', <button key="scarecrow" onClick={()=>nav('/scarecrow')} style={{ padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🌾 かかし修練場へ</button>)}
                          {lockOr('alchemy', <button key="alchemy" onClick={()=>nav('/alchemy')} style={{ padding:'10px', background:'#001020', border:'1px solid #1a8a6a', color:'#44ddaa', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🧪 錬金部屋へ</button>)}
                        </div>
                        </MenuCat>
                        </>) })()}
                      </div>
                    )}
                  </>
                ) : (
                  <>
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
                  <button onClick={()=>nav('/scarecrow')} style={{ padding:'10px', background:'#001020', border:'1px solid #886600', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🌾 かかし修練場へ</button>
                  <button onClick={()=>nav('/pets')} style={{ padding:'10px', background:'#001020', border:'1px solid #aa88ff', color:'#aa88ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🐾 ペット</button>
                  <button onClick={()=>setShowKumite(true)} style={{ padding:'10px', background:'#001020', border:'1px solid #5ab0e0', color:'#8ad0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🥊 組み手</button>
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
                          <button onClick={()=>{ setShowArena(true); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #a060e0', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🏛 アリーナ <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                          )}
                    {profile?.is_admin && (
                      <button onClick={()=>{ nav('/tenkyuu'); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#150a26', border:'1px solid #8a60ff', color:'#c8a0ff', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>🌌 天穹十二宮 <span style={{ fontSize:'9px', color:'#8877aa' }}>[開発]</span></button>
                    )}
                    {profile?.is_admin && (
                      <button onClick={()=>{ setShowPvp(true); setShowChallengePanel(false) }} style={{ width:'100%', padding:'12px', marginTop:'8px', background:'#1a0a14', border:'1px solid #e05a8a', color:'#ff8ab0', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>⚔ 対人戦 <span style={{ fontSize:'9px', color:'#aa7788' }}>[開発]</span></button>
                    )}
                  </div>
                )}
                  </>
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
                      {!isDying && profile.gold<innCost && <span style={{color:'#ff4444'}}> （Goldが足りません）</span>}
                    </div>
                    <div style={{ display:'flex', gap:'8px' }}>
                      <button onClick={backToTown} style={{ flex:1, padding:'10px', background:'#001840', border:'1px solid #0088ff', color:'#0088ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🏰 街に戻る</button>
                      <button onClick={useInn} disabled={loading||atWar||(!isDying&&profile.gold<innCost)}
                        style={{ flex:2, padding:'10px', background:'#001830', border:'1px solid #0088aa', color:'#00aacc', cursor:(loading||atWar||(!isDying&&profile.gold<innCost))?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px', opacity:(loading||atWar||(!isDying&&profile.gold<innCost))?0.4:1 }}>
                        {atWar ? '戦争中は利用不可' : '利用する'}
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
      <AIAssistant ctx={{ profile, eff, equipment }} open={aiOpen} onClose={()=>setAiOpen(false)} />
      <RaidNotify open={raidNotifyOpen} onClose={()=>setRaidNotifyOpen(false)} />
      {showPvp && <Suspense fallback={null}><PvpPanel onClose={()=>setShowPvp(false)} /></Suspense>}
      {showKumite && <Suspense fallback={null}><KumitePanel onClose={()=>setShowKumite(false)} /></Suspense>}
        {showArena && <Suspense fallback={null}><ArenaPanel onClose={()=>setShowArena(false)} /></Suspense>}
    </div>
  )
}

// ============================================================
// サブコンポーネント
// ============================================================
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
  mdefUp:'🔮特防↑', mdefDown:'🔮特防↓', matkUp:'🔮特攻↑',
  spdUp:'💨速↑', spdDown:'💨速↓',
  burn:'🔥火傷', paralysis:'⚡麻痺', stun:'💫気絶',
  poison:'🟢毒', severePoisoin:'☠猛毒',
  healDown:'💉回復↓', dmgDown:'⬇被ダメ↓', dmgReduce:'🛡軽減',
  regenHeal:'💚再生', regenMp:'🔵魔力供給', skeletonDmg:'💀骸骨',
  healUp:'💚回復力↑', spiritMdefPen:'🌑魔貫↑', breederDmgUp:'🐾与ダメ↑',
  berserk:'😡狂乱', holyField:'✨聖域', holyAwakening:'✨神聖覚醒',
  critResist:'クリ耐', hitBonus:'🎯命中↑', evasion:'💨回避↑',
  allinActive:'🎲全賭け', allinDebuff:'💸反動',
  spellBladeExhaust:'⚔魔剣', spellBladeSealed:'🚫バフ封',
  flashCombo:'⚡閃光連撃', cannonCombo:'🔫連装',
  statusImmune:'🔰状態免疫', stunResist:'💫スタン耐',
  curseDmg:'💜呪い', healSeal:'🚫回復封',
  bloodRage:'🩸ブラッティロア',
  matkDown:'🔮特攻↓', mukyoPen:'🗡防御貫通', tenkaiCharge:'🐉溜め',
  onmyoHeal:'💚陰陽の理', regen:'💚再生', ailmentShield:'🛡異常無効',
  spiritCombo:'✨精霊連',
}
// アイコン表示しない内部用フラグ（ターン内で消費される一時フラグ・内部CD）
const STATUS_HIDDEN = new Set(['potionCooldown', 'nextSkillBoost', 'guaranteedExtra', 'kinjutsuLock'])
export function extractStatuses(buffs) {
  const out = []
  for (const k of Object.keys(buffs || {})) {
    const b = buffs[k]
    if (!b) continue
    if (STATUS_HIDDEN.has(k)) continue
    // 出血はスタック数表示
    if (k === 'bleed') {
      if (b.stacks > 0) out.push({ label: `🩸出血×${b.stacks}`, color: '#ff8866' })
      continue
    }
    // 状態異常シールド（残回数）・精霊連（カウント）は turns を持たないので個別判定
    if (k === 'ailmentShield') {
      if ((b.charges || 0) > 0) out.push({ label: `🛡異常無効×${b.charges}`, color: '#66ddaa' })
      continue
    }
    if (k === 'spiritCombo') {
      if ((b.count || 0) > 0) out.push({ label: `✨精霊連×${b.count}`, color: '#66ddaa' })
      continue
    }
    if (!(b.turns > 0)) continue
    const label = BUFF_LABELS[k] || k
    const positive = /↑|軽減|聖域|命中↑|全賭け|魔剣|ブラッティロア|再生|骸骨|覚醒|回避↑|閃光連撃|連装|状態免疫|スタン耐|防御貫通|溜め|陰陽|異常無効|精霊連/.test(label)
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
    // curMp/maxMp を渡すと MP も表示（PvP用。PvEは未指定なので従来どおり非表示）
    const col = (key, name, cur, max, pct, color, status, align, curMp, maxMp) => (
      <div key={key} style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
        {statusRow(status, align)}
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#b8d0e8', gap:'4px' }}>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
          <span style={{ color, flexShrink:0, fontWeight:'bold' }}>{Math.max(0,cur).toLocaleString()} / {max.toLocaleString()}</span>
        </div>
        <div style={{ background:'#13243a', height:'6px', border:'1px solid #2a456a' }}>
          <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,#0a3,${color})` }} />
        </div>
        {maxMp != null && (<>
          <div style={{ display:'flex', justifyContent:'flex-end', fontSize:'9px', color:'#6aa6e0', gap:'4px', marginTop:'1px' }}>
            <span style={{ flexShrink:0 }}>MP {Math.max(0,curMp).toLocaleString()} / {maxMp.toLocaleString()}</span>
          </div>
          <div style={{ background:'#11203a', height:'4px', border:'1px solid #244a6a' }}>
            <div style={{ height:'100%', width:`${Math.max(0,Math.min(100,(curMp/Math.max(1,maxMp))*100))}%`, background:'#3a78d8' }} />
          </div>
        </>)}
      </div>
    )
    // 双子(第3宮)など複数の敵HPバーに対応：l.twin があれば各体を個別のバーで表示
    const enemyCols = Array.isArray(l.twin)
      ? l.twin.map((b, i) => col(`e${i}`, `${b.name}${b.down ? '（蘇生中）' : ''}`, b.hp, b.max, Math.max(0, Math.min(100, (b.hp / b.max) * 100)), b.down ? '#8866aa' : '#ff6655', null, 'flex-end'))
      : col('e', l.enemyName, l.enemyHp, l.enemyMax, ePct, '#ff6655', l.enemyStatus, 'flex-end', l.enemyMp, l.enemyMpMax)
    return (
      <div style={{ borderBottom:'1px solid #24405e', padding:'6px 6px', background:'#16263c', borderRadius:'3px', margin:'2px 0' }}>
        <div style={{ fontSize:'9px', color:'#7fa8d0', marginBottom:'3px', textAlign:'center' }}>━ {l.turn}ターン終了時 ━</div>
        <div style={{ display:'flex', gap:'12px', alignItems:'flex-end' }}>
          {col('p', l.playerName, l.playerHp, l.playerMax, pPct, '#33dd66', l.playerStatus, 'flex-start', l.playerMp, l.playerMpMax)}
          {enemyCols}
        </div>
        {l.petMax != null && (
          <div style={{ marginTop:'4px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'9px', color:'#ffcc66', gap:'4px' }}>
              <span>🐾 ペット{l.petHp <= 0 ? '（戦闘不能）' : ''}</span>
              <span style={{ flexShrink:0, fontWeight:'bold' }}>{Math.max(0,l.petHp).toLocaleString()} / {l.petMax.toLocaleString()}</span>
            </div>
            <div style={{ background:'#2a1f10', height:'5px', border:'1px solid #5a4420' }}>
              <div style={{ height:'100%', width:`${Math.max(0, Math.min(100,(l.petHp/Math.max(1,l.petMax))*100))}%`, background:'linear-gradient(90deg,#a70,#ffaa44)' }} />
            </div>
          </div>
        )}
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
        <span style={{color:rank.color, fontSize:'9px', marginLeft:'2px'}}>{rank.rank}</span>
      </span>
    </div>
  )
}
