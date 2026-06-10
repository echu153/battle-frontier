// ペット種族の定義とステータス計算（ペット画面・ダンジョンで共有）
// 画像(image_url)が未設定のときは emoji を代替表示する。

// ペットのステータス: hp / atk(攻撃 or 特殊攻撃) / def(防御) / mdef(特防)
//  atkType 'phys'=物理(敵のdefで軽減) / 'spec'=特殊(敵のmdefで軽減)
//  被ダメは敵の攻撃タイプに応じて pet.def(物理) / pet.mdef(特殊) で軽減
export const SPECIES = {
  // 総合力を3体で統一（HP10=1点 / 攻・防・特防=各1点 → 合計が一致）。基礎=20点(全員HP20)・成長=4.8点/Lvで全レベル同値
  flame:  { label: 'ヴォル', emoji: '🐺', image: '/voru.png',  starter: true, atkType: 'phys', base: { hp: 20, atk: 10, def: 5, mdef: 3 }, grow: { hp: 6, atk: 2.4, def: 1.1, mdef: 0.7 }, evolve: { label: 'ヴォルガノフ', emoji: '🐺', image: '/voruganohu.png' } },
  aqua:   { label: 'アルル', emoji: '🦊', image: '/aruru.png', starter: true, atkType: 'spec', base: { hp: 20, atk: 10, def: 2, mdef: 6 }, grow: { hp: 4, atk: 2.4, def: 0.8, mdef: 1.2 }, evolve: { label: 'アルミラ',   emoji: '🦊', image: '/arumira.png' } },
  leaf:   { label: 'ドラム', emoji: '🐢', image: '/doramu.png', starter: true, atkType: 'phys', base: { hp: 20, atk: 6,  def: 6, mdef: 6 }, grow: { hp: 8, atk: 1.0, def: 1.5, mdef: 1.5 }, evolve: { label: 'ガルガノス', emoji: '🐢', image: '/garuganos.png' } },
}

export const STARTERS = Object.entries(SPECIES).map(([id, s]) => ({ id, ...s }))

export const AFFECTION_MAX = 100

// 現在レベルから次レベルへ上がるのに必要な経験値（レベル×10）。レベルごとに0から貯める
export const expForLevel = (lv) => (lv || 1) * 10
export const MAX_LEVEL = 50            // 進化前のレベル上限（Lv50で進化が必要）
export const MAX_LEVEL_EVOLVED = 9999  // 進化後は実質無限（サーバ側の暴走防止のため大きな値）
export const EVOLVE_LEVEL = 50         // この Lv で進化できる
export const EVOLVE_MULT = 1.5         // 進化時に現在ステを ×1.5
export const EVOLVE_GROW_MULT = 2      // 進化後はレベル成長量 ×2
// レベル上限：進化前は50、進化後は実質無限（Infinity）
export const petMaxLevel = (pet) => (pet?.evolved ? Infinity : MAX_LEVEL)
// 進化可能か（Lv50到達・未進化・進化形が定義されている）
export const canEvolve = (pet) => !!pet && !pet.evolved && (pet.level || 1) >= EVOLVE_LEVEL && !!(SPECIES[pet.species]?.evolve)
// 進化後の名前（未定義なら null）
export const evolvedName = (pet) => SPECIES[pet?.species]?.evolve?.label || null

// 1ステの値を算出。進化後は「Lv50時点ステ×1.5」を基点に、以降は成長量×2でLv100まで伸びる
//  ・未進化: base + grow*(lv-1)
//  ・進化済: (base + grow*49)*1.5 + grow*2*(lv-50)   ← 進化はLv50固定なので「現在ステ×1.5」と一致
function statValue(base, grow, lv, evolved) {
  if (!evolved) return base + grow * (lv - 1)
  const base50 = base + grow * (EVOLVE_LEVEL - 1)
  return base50 * EVOLVE_MULT + grow * EVOLVE_GROW_MULT * Math.max(0, lv - EVOLVE_LEVEL)
}

// ペットの現在ステータス（種族＋レベル＋進化状態）
export function petStats(pet) {
  const sp = SPECIES[pet.species] || SPECIES.flame
  const lv = pet.level || 1
  const evo = !!pet.evolved
  return {
    maxHp:  Math.round(statValue(sp.base.hp,   sp.grow.hp,   lv, evo)),
    atk:    Math.round(statValue(sp.base.atk,  sp.grow.atk,  lv, evo)),
    def:    Math.round(statValue(sp.base.def,  sp.grow.def,  lv, evo)),
    mdef:   Math.round(statValue(sp.base.mdef, sp.grow.mdef, lv, evo)),
    atkType: sp.atkType,
  }
}
export const atkLabel = (pet) => ((SPECIES[pet.species] || SPECIES.flame).atkType === 'spec' ? '特攻' : '攻撃')

// なつき度によるプレイヤーへのステータス変換率の上限（後で調整しやすいよう定数化）
export const CONVERSION_MAX = 1.00  // なつき満タンで最大100%
// なつき度によるプレイヤーへのステータス変換率（0% 〜 CONVERSION_MAX）
// 実適用（街/戦闘への反映）はPhase2後半
export function affectionConversion(affection) {
  return CONVERSION_MAX * Math.min(1, (affection || 0) / AFFECTION_MAX)
}

// ペット専用スキル（体当たり時に「選択中スキル」が発動する）
// 種族別の習得テーブル。各種族 Lv3/8/20/50/80/120 で1つずつ習得（たいあたりは全種族Lv1固定）。
// Lvで自動習得。mult=攻撃倍率, hits=攻撃回数, lifesteal=与ダメ回復率, cost=消費満腹度, species=対象種族('all'=全種族)
export const MAX_SKILL_SLOTS = 4  // 持っていけるスキル数（たいあたり固定込み＝実質3つ選べる）
export const SKILL_LEARN_LEVELS = [3, 8, 20, 50, 80, 120]
export const SKILLS = {
  // --- 全種族共通（固定）---
  tackle:        { name: 'たいあたり', species: 'all',   learnLv: 1,   mult: 1.0, hits: 1, cost: 0,  fixed: true, desc: '通常の体当たり（満腹消費なし・固定装備）' },

  // --- 🐺 ヴォル / ヴォルガノフ（物理・牙と爪の狼）---
  voru_bite:     { name: 'かみつき',       species: 'flame', learnLv: 3,   mult: 1.4,  hits: 1, cost: 2,  desc: '鋭い牙で噛みつく一撃（1.4倍／満腹2）' },
  voru_claw:     { name: 'つめ裂き',       species: 'flame', learnLv: 8,   mult: 0.75, hits: 2, cost: 3,  desc: '両の爪で2回引き裂く（各0.75倍／満腹3）' },
  voru_fangrush: { name: '牙突進',         species: 'flame', learnLv: 20,  mult: 1.9,  hits: 1, cost: 5, desc: '牙を剥いて突進する大技（1.9倍／満腹5）' },
  voru_bloodfang:{ name: '月下の吸血牙',   species: 'flame', learnLv: 50,  mult: 1.2,  hits: 1, lifesteal: 0.3, cost: 5, desc: '与ダメの3割を回復する牙（1.2倍／満腹5）' },
  voru_pack:     { name: '群狼乱舞',       species: 'flame', learnLv: 80,  mult: 0.8,  hits: 3, cost: 8, desc: '群れの如く3回連撃（各0.8倍／満腹8）' },
  voru_alpha:    { name: '狼神・絶牙閃',   species: 'flame', learnLv: 120, mult: 3.0,  hits: 1, cost: 12, desc: '狼神の牙を宿す必殺の一撃（3.0倍／満腹12）' },

  // --- 🦊 アルル / アルミラ（特殊・妖術の狐）---
  aruru_foxfire: { name: 'きつね火',       species: 'aqua',  learnLv: 3,   mult: 1.4,  hits: 1, cost: 2,  desc: '青白い狐火を放つ（1.4倍／満腹2）' },
  aruru_illusion:{ name: '幻惑連弾',       species: 'aqua',  learnLv: 8,   mult: 0.75, hits: 2, cost: 3,  desc: '幻の弾を2連射（各0.75倍／満腹3）' },
  aruru_blaze:   { name: '妖狐の業火',     species: 'aqua',  learnLv: 20,  mult: 1.9,  hits: 1, cost: 5, desc: '妖力の業火で焼く大技（1.9倍／満腹5）' },
  aruru_drain:   { name: '生命吸収術',     species: 'aqua',  learnLv: 50,  mult: 1.2,  hits: 1, lifesteal: 0.3, cost: 5, desc: '与ダメの3割を吸収する術（1.2倍／満腹5）' },
  aruru_ninetail:{ name: '九尾乱舞',       species: 'aqua',  learnLv: 80,  mult: 0.8,  hits: 3, cost: 8, desc: '九つの尾で3連撃（各0.8倍／満腹8）' },
  aruru_celestial:{ name: '天狐・霊滅閃',  species: 'aqua',  learnLv: 120, mult: 3.0,  hits: 1, cost: 12, desc: '天狐の霊力を放つ必殺技（3.0倍／満腹12）' },

  // --- 🐢 ドラム / ガルガノス（物理・大地と甲羅の守護者）---
  doramu_shell:  { name: 'こうら打ち',     species: 'leaf',  learnLv: 3,   mult: 1.4,  hits: 1, cost: 2,  desc: '硬い甲羅を叩きつける（1.4倍／満腹2）' },
  doramu_rock:   { name: '岩石連打',       species: 'leaf',  learnLv: 8,   mult: 0.75, hits: 2, cost: 3,  desc: '岩の拳で2回殴る（各0.75倍／満腹3）' },
  doramu_quake:  { name: '大地割り',       species: 'leaf',  learnLv: 20,  mult: 1.9,  hits: 1, cost: 5, desc: '大地を割る重い一撃（1.9倍／満腹5）' },
  doramu_counter:{ name: 'グランドドレイン', species: 'leaf',  learnLv: 50,  mult: 1.2,  hits: 1, lifesteal: 0.3, cost: 5, desc: '大地に染みた血を吸い上げ、与ダメの3割を回復（1.2倍／満腹5）' },
  doramu_tremor: { name: '連震撃',         species: 'leaf',  learnLv: 80,  mult: 0.8,  hits: 3, cost: 8, desc: '地響きで3連撃（各0.8倍／満腹8）' },
  doramu_guardian:{ name: '守護神・大地崩撃',species: 'leaf', learnLv: 120, mult: 3.0,  hits: 1, cost: 12, desc: '守護神の力で大地ごと砕く（3.0倍／満腹12）' },
}
// その種族が持つスキル一覧（たいあたり＋種族スキル。習得Lv順）
export const skillsForSpecies = (species) =>
  Object.entries(SKILLS).filter(([, s]) => s.species === 'all' || s.species === species)
    .map(([id, s]) => ({ id, ...s })).sort((a, b) => a.learnLv - b.learnLv)
// 習得済みスキル（種族＋レベル）
export const learnedSkills = (pet) => skillsForSpecies(pet?.species).filter((s) => s.learnLv <= (pet?.level || 1))
export const getSkill = (id) => SKILLS[id] || SKILLS.tackle

// ダンジョン定義（まず2種。requires をクリアすると開放。以降は今後追加）
//  areas: 出現するエリア（深いフロアほど後ろのエリアの敵が出る）
export const DUNGEONS = [
  {
    id: 'd10', name: '初級の洞窟', floors: 10, requires: null, emoji: '🕳', areas: [1, 2], charms: ['antidote', 'guard'],
    floorTable: [
      { from: 1,  to: 2,  enemies: [{ name: 'スライム', type: 'phys', images: ['/suraimu.png', '/suraimu2.png', '/suraimu3.png'], statMult: 0.5 }] },
      { from: 3,  to: 5,  enemies: [{ name: 'スライム', type: 'phys', images: ['/suraimu.png', '/suraimu2.png', '/suraimu3.png'], statMult: 0.5 }, { name: 'コウモリ', type: 'phys', image: '/koumori.png',     statMult: 0.75 }, { name: '毒キノコ', type: 'spec', image: '/dokukinoko.png', statMult: 1.0 }] },
      { from: 6,  to: 7,  enemies: [{ name: 'コウモリ', type: 'phys', image: '/koumori.png',    statMult: 0.75 }, { name: '毒キノコ', type: 'spec', image: '/dokukinoko.png', statMult: 1.0 }, { name: 'ゴブリン', type: 'phys', image: '/goburin.png', statMult: 1.0 }] },
      { from: 8,  to: 10, enemies: [{ name: 'ゴブリン', type: 'phys', image: '/goburin.png', statMult: 1.0 }, { name: '野良犬', type: 'phys', images: ['/norainu1.png', '/norainu2.png'], statMult: 1.0 }, { name: '盗賊', type: 'phys', image: '/touzoku.png', statMult: 1.1 }] },
    ],
  },
  { id: 'd30', name: '深淵の遺跡', floors: 30, requires: 'd10', emoji: '🏛', areas: [1, 2, 3, 4], comingSoon: true }, // 後日のアップデートで開放
]
export const getDungeon = (id) => DUNGEONS.find((d) => d.id === id) || DUNGEONS[0]

// 敵スキル（攻撃時に確率で発動）。type: poison=毒付与 / heavy=ダメージ倍率 / vamp=与ダメの一部を自己回復
//  ※毒キノコは毒、盗賊は2つ持ち。名前で引くので敵定義側は変更不要
export const ENEMY_SKILLS = {
  'コウモリ': [{ name: 'きゅうけつ', chance: 0.30, type: 'vamp', frac: 0.3 }],
  '毒キノコ': [{ name: 'どくのこな', chance: 0.45, type: 'poison' }],
  'ゴブリン': [{ name: 'つよ打ち',   chance: 0.30, type: 'heavy', mult: 1.5 }],
  '野良犬':   [{ name: 'かみつき',   chance: 0.30, type: 'heavy', mult: 1.4 }],
  '盗賊':     [{ name: 'ふいうち',   chance: 0.25, type: 'heavy', mult: 1.6 }, { name: 'どくナイフ', chance: 0.20, type: 'poison' }],
}
export const enemySkillsFor = (name) => ENEMY_SKILLS[name] || []
// 毒：POISON_INTERVAL ターンごとに最大HPの POISON_PCT を失う（次フロアで回復）
export const POISON_INTERVAL = 10
export const POISON_PCT = 0.02

// 敵の表示画像を決める（images配列があればランダムで1枚、無ければimage、どちらも無ければnull）
export function pickEnemyImage(kind) {
  const img = kind?.images?.length ? kind.images[Math.floor(Math.random() * kind.images.length)] : (kind?.image || null)
  return assetSrc(img)
}

export function enemiesForFloor(dungeon, floor) {
  if (dungeon?.floorTable) {
    const row = dungeon.floorTable.find((r) => floor >= r.from && floor <= r.to)
    if (row) return row.enemies
  }
  return AREA_ENEMIES[areaForFloor(dungeon, floor)] || AREA_ENEMIES[1]
}

// エリア①〜④の敵（既存ゲームのキャラ名を流用。type: phys=物理 / spec=特殊）
// ステータスはダンジョン用に dungeonEnemyStats でフロア深度に応じてスケールする
export const AREA_ENEMIES = {
  1: [{ name: 'スライム', type: 'phys', images: ['/suraimu.png', '/suraimu2.png', '/suraimu3.png'] }, { name: 'コウモリ', type: 'phys', image: '/koumori.png' }, { name: '毒キノコ', type: 'spec', image: '/dokukinoko.png' }],
  2: [{ name: 'ゴブリン', type: 'phys', image: '/goburin.png' }, { name: '野良犬', type: 'phys', images: ['/norainu1.png', '/norainu2.png'] }, { name: '盗賊', type: 'phys', image: '/touzoku.png' }],
  3: [{ name: 'コボルト', type: 'phys' }, { name: 'スケルトン', type: 'phys' }, { name: 'ゴーレム', type: 'phys' }],
  4: [{ name: '深海魚人', type: 'phys' }, { name: '海賊', type: 'phys' }, { name: '毒クラゲ', type: 'spec' }],
}

// そのフロアで出現するエリアID（浅い→areas先頭、深い→後ろ）
export function areaForFloor(dungeon, floor) {
  const areas = dungeon?.areas || [1]
  const idx = Math.min(areas.length - 1, Math.floor(((floor - 1) / Math.max(1, (dungeon?.floors || 10))) * areas.length))
  return areas[idx]
}

// その敵が最初に出現するフロア（floorTableの先頭から探す）。
// 敵の強さは「初登場フロアの値」で固定する（深い階でも同種は同じ強さ）
export function enemyFirstFloor(dungeon, name) {
  if (dungeon?.floorTable) {
    for (const row of dungeon.floorTable) {
      if ((row.enemies || []).some((e) => e.name === name)) return row.from
    }
  }
  return 1
}
// 種族ごとの実ステータス（初登場フロア基準＋種族倍率を適用）
export function dungeonEnemyStatsFor(dungeon, kind) {
  const ff = enemyFirstFloor(dungeon, kind?.name)
  const es = dungeonEnemyStats(ff, areaForFloor(dungeon, ff))
  const m = kind?.statMult ?? 1.0
  return {
    maxHp: Math.round(es.maxHp * m),
    atk:   Math.round(es.atk * m),
    def:   Math.round(es.def * m),
    mdef:  Math.round(es.mdef * m),
  }
}

// 敵ステータス（フロア深度＋エリア段階でスケール）。何度か挑戦してクリアする難度想定。
//  ※数値はバランス調整ポイント。きつ/緩は係数を変えるだけ。
export function dungeonEnemyStats(floor, areaId) {
  const t = areaId || 1
  return {
    maxHp: Math.round(22 + floor * 8 + t * t * 9),
    atk:   Math.round(7 + floor * 2.4 + t * t * 2),
    def:   Math.round(2 + floor * 1.1 + t * 2),
    mdef:  Math.round(2 + floor * 1.1 + t * 2),
  }
}

// アイテム袋の上限（潜る前の所持：だっしゅつの翼以外の合計）。ダンジョン中は別途20まで
export const INV_MAX = 10
// ペットアイテム定義（価格はサーバーRPC pet_item_price と一致させること）
//  dungeon=true: ダンジョンで使用可能 / capped=true: アイテム袋の上限(INV_MAX)の対象（だっしゅつの翼以外すべて）
export const PET_ITEMS = {
  escape:  { key: 'escape',  name: 'だっしゅつの翼',   emoji: '🪽', price: 500,   dungeon: true,  capped: false, desc: 'ダンジョンからいつでも脱出（使い切り・袋の対象外）' },
  onigiri: { key: 'onigiri', name: 'おにぎり',         emoji: '🍙', price: 200,   dungeon: true,  capped: true, fullness: 30, desc: '満腹度を30回復' },
  konomi:  { key: 'konomi',  name: '木の実',           emoji: '🍒', price: 300,   dungeon: true,  capped: true, healPct: 0.2, desc: '最大HPの20%を回復' },
  rename:  { key: 'rename',  name: 'ニックネーム変更券', emoji: '🎫', price: 100000, dungeon: false, capped: true,  desc: 'ペットの名前を変更できる' },
  // チャーム強化用の素（ダンジョンで拾う。チャームページで使用）
  atk_seed:   { key: 'atk_seed',   name: '攻撃の素',  emoji: '🔴', price: 0, dungeon: false, capped: true, seed: 'atk',   up: 1,  desc: 'チャームの攻撃を+1' },
  spatk_seed: { key: 'spatk_seed', name: '特攻の素',  emoji: '🟣', price: 0, dungeon: false, capped: true, seed: 'spatk', up: 1,  desc: 'チャームの特攻を+1' },
  def_seed:   { key: 'def_seed',   name: '防御の素',  emoji: '🔵', price: 0, dungeon: false, capped: true, seed: 'def',   up: 1,  desc: 'チャームの防御を+1' },
  spdef_seed: { key: 'spdef_seed', name: '特防の素',  emoji: '🟢', price: 0, dungeon: false, capped: true, seed: 'spdef', up: 1,  desc: 'チャームの特防を+1' },
  hp_seed:    { key: 'hp_seed',    name: 'HPの素',    emoji: '🟡', price: 0, dungeon: false, capped: true, seed: 'hp',    up: 5,  desc: 'チャームのHPを+5（消費1）' },
}
export const SHOP_ITEMS = Object.values(PET_ITEMS).filter((i) => !i.seed)   // 商店は素を除く
export const SEED_ITEMS = Object.values(PET_ITEMS).filter((i) => i.seed)
export const DUNGEON_ITEMS = Object.values(PET_ITEMS).filter((i) => i.dungeon)
export const CAPPED_ITEMS = Object.values(PET_ITEMS).filter((i) => i.capped)

// チャーム定義。effect: null=なし / 'antidote'=毒確率50%減 / 'guard'=防御+10%
// 強化は「素の合計使用数」が CHARM_TOTAL_MAX(150) まで。各素は消費1。HPの素のみ1個=HP+5、他は1個=+1
export const CHARM_TOTAL_MAX = 150
export const CHARM_HP_PER = 5
export const CHARM_STATS = ['hp', 'atk', 'spatk', 'def', 'spdef']
export const CHARMS = {
  hajimari: { type: 'hajimari', name: 'はじまりのチャーム', emoji: '🔰', effect: null,       desc: '追加能力なし' },
  antidote: { type: 'antidote', name: '解毒のチャーム',     emoji: '🧪', effect: 'antidote', desc: '毒になる確率が50%減る' },
  guard:    { type: 'guard',    name: '守りのチャーム',     emoji: '🛡️', effect: 'guard',    desc: '防御＋10%' },
}
export const getCharm = (t) => CHARMS[t] || CHARMS.hajimari
// 使用した素の合計数（=強化ゲージ。CHARM_TOTAL_MAX まで）
export const charmTotal = (c) => (c?.atk || 0) + (c?.spatk || 0) + (c?.def || 0) + (c?.spdef || 0) + (c?.hp || 0)
// HPボーナス（HPの素は1個=+CHARM_HP_PER）。hp列は「使った個数」を保持
export const charmHpBonus = (c) => (c?.hp || 0) * CHARM_HP_PER
// 表示名（素を使った分だけ ＋N がつく）
export function charmDisplayName(charm) {
  const base = getCharm(charm?.ctype).name
  const t = charmTotal(charm)
  return t > 0 ? `${base}＋${t}` : base
}
// 装備チャームをプレイヤー本体ステへ反映する分（攻→atk / 特攻→matk / 特防→mdef / HPは×CHARM_HP_PER）
export function charmPlayerBonus(charm) {
  if (!charm) return null
  return {
    hp: charmHpBonus(charm), atk: charm.atk || 0, matk: charm.spatk || 0, def: charm.def || 0, mdef: charm.spdef || 0,
    guard: getCharm(charm.ctype).effect === 'guard',       // 防御+10%
    antidote: getCharm(charm.ctype).effect === 'antidote', // 毒確率50%減
  }
}
// チャームのステ成長を加算したペットステを返す（ダンジョン/反映で使用）
export function applyCharmStats(stats, charm) {
  if (!charm) return { ...stats, atkPhys: stats.atk, atkSpec: stats.atk }
  let { maxHp, atk, def, mdef } = stats
  maxHp += charmHpBonus(charm)
  // チャーム込みの物理値/特殊値を両方持つ（たいあたりは高いほうを参照して攻撃する）
  const atkPhys = atk + (charm.atk || 0)
  const atkSpec = atk + (charm.spatk || 0)
  // 表示用のメイン攻撃値は従来どおり攻撃タイプ側
  atk = stats.atkType === 'spec' ? atkSpec : atkPhys
  def += charm.def || 0
  mdef += charm.spdef || 0
  let out = { ...stats, maxHp, atk, atkPhys, atkSpec, def, mdef }
  if (getCharm(charm.ctype).effect === 'guard') out.def = Math.round(out.def * 1.1)
  return out
}

export function speciesLabel(pet) {
  const sp = SPECIES[pet?.species] || {}
  if (pet?.evolved && sp.evolve) return sp.evolve.label
  return sp.label || '???'
}
export function speciesEmoji(pet) {
  const sp = SPECIES[pet?.species] || {}
  if (pet?.evolved && sp.evolve) return sp.evolve.emoji || sp.emoji
  return sp.emoji || '🐾'
}
// 画像キャッシュ対策：public/ の画像を「同じ名前で」差し替えたら、この数字を上げると最新が表示される
export const ASSET_VER = '2'
// 静的画像(先頭/)にだけ ?v= を付けてキャッシュを無効化。外部URL(http...)はそのまま
export const assetSrc = (src) => (src && src.startsWith('/') ? `${src}?v=${ASSET_VER}` : src)

// 種族デフォルト画像（進化済みなら進化形イラスト）。未設定なら null
export function speciesImage(pet) {
  const sp = SPECIES[pet?.species] || {}
  const img = (pet?.evolved && sp.evolve?.image) ? sp.evolve.image : (sp.image || null)
  return assetSrc(img)
}
// 進化形イラストの素のパス（進化時に image_url へ保存する用。表示時は petImage が ?v を付ける）
export const evolvedImage = (pet) => SPECIES[pet?.species]?.evolve?.image || null
// 実際に表示する画像：カスタム(image_url) 優先、無ければ種族デフォルト
export const petImage = (pet) => assetSrc(pet?.image_url) || speciesImage(pet)
