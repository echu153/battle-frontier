// ペット種族の定義とステータス計算（ペット画面・ダンジョンで共有）
// 画像(image_url)が未設定のときは emoji を代替表示する。

// ペットのステータス: hp / atk(攻撃 or 特殊攻撃) / def(防御) / mdef(特防)
//  atkType 'phys'=物理(敵のdefで軽減) / 'spec'=特殊(敵のmdefで軽減)
//  被ダメは敵の攻撃タイプに応じて pet.def(物理) / pet.mdef(特殊) で軽減
export const SPECIES = {
  // --- スターター（最初に1体選択）---
  flame:  { label: 'フラム',  emoji: '🦎', starter: true,  atkType: 'phys', base: { hp: 40, atk: 12, def: 5,  mdef: 4 }, grow: { hp: 6, atk: 2, def: 1.2, mdef: 0.9 } },
  aqua:   { label: 'アクー',  emoji: '🐟', starter: true,  atkType: 'spec', base: { hp: 48, atk: 12, def: 4,  mdef: 6 }, grow: { hp: 8, atk: 2, def: 0.9, mdef: 1.2 } },
  leaf:   { label: 'リーフィ', emoji: '🐛', starter: true,  atkType: 'phys', base: { hp: 44, atk: 11, def: 5,  mdef: 5 }, grow: { hp: 7, atk: 1.8, def: 1.1, mdef: 1.1 } },
  // --- 卵から孵る種族（入手手段は今後）---
  spark:  { label: 'スパーク', emoji: '🐭', starter: false, atkType: 'spec', base: { hp: 38, atk: 15, def: 3,  mdef: 4 }, grow: { hp: 5, atk: 2.6, def: 0.8, mdef: 1.0 } },
  stone:  { label: 'ストーン', emoji: '🐢', starter: false, atkType: 'phys', base: { hp: 60, atk: 8,  def: 9,  mdef: 7 }, grow: { hp: 10, atk: 1.2, def: 2.0, mdef: 1.4 } },
  wind:   { label: 'ウィン',  emoji: '🦅', starter: false, atkType: 'phys', base: { hp: 42, atk: 13, def: 4,  mdef: 4 }, grow: { hp: 6, atk: 2.1, def: 1.0, mdef: 1.0 } },
}

export const STARTERS = Object.entries(SPECIES).filter(([, s]) => s.starter).map(([id, s]) => ({ id, ...s }))
export const HATCHABLE = Object.entries(SPECIES).filter(([, s]) => !s.starter).map(([id, s]) => ({ id, ...s }))

export const AFFECTION_MAX = 100

// 現在レベルから次レベルへ上がるのに必要な経験値（レベル×10）。レベルごとに0から貯める
export const expForLevel = (lv) => (lv || 1) * 10
export const MAX_LEVEL = 50

// ペットの現在ステータス（種族＋レベル）
export function petStats(pet) {
  const sp = SPECIES[pet.species] || SPECIES.flame
  const lv = pet.level || 1
  return {
    maxHp:  Math.round(sp.base.hp + sp.grow.hp * (lv - 1)),
    atk:    Math.round(sp.base.atk + sp.grow.atk * (lv - 1)),
    def:    Math.round(sp.base.def + sp.grow.def * (lv - 1)),
    mdef:   Math.round(sp.base.mdef + sp.grow.mdef * (lv - 1)),
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
// ※現状は全種族で共通の習得テーブル。将来は種族別にする予定（フラムは暫定でこのまま）
// Lvで自動習得。mult=攻撃倍率, hits=攻撃回数, lifesteal=与ダメ回復率
export const MAX_SKILL_SLOTS = 4  // 持っていけるスキル数（たいあたり固定込み＝実質3つ選べる）
// cost = 発動時に消費する満腹度。たいあたりは固定習得・消費なし。強いスキルほど消費が大きい。
export const SKILLS = {
  tackle:      { name: 'たいあたり',   learnLv: 1,  mult: 1.0, hits: 1, cost: 0, fixed: true, desc: '通常の体当たり（満腹消費なし・固定装備）' },
  powerStrike: { name: 'ヘビーアタック', learnLv: 3,  mult: 1.7, hits: 1, cost: 5, desc: '強めの一撃（1.7倍／満腹5）' },
  doubleHit:   { name: 'にれんだ',     learnLv: 6,  mult: 0.75, hits: 2, cost: 6, desc: '2回攻撃（各0.75倍／満腹6）' },
  drain:       { name: 'すいとり',     learnLv: 10, mult: 1.0, hits: 1, lifesteal: 0.25, cost: 8, desc: '与ダメの1/4HP回復（満腹8）' },
}
export const learnedSkills = (level) => Object.entries(SKILLS).filter(([, s]) => s.learnLv <= (level || 1)).map(([id, s]) => ({ id, ...s }))
export const getSkill = (id) => SKILLS[id] || SKILLS.tackle

// ダンジョン定義（まず2種。requires をクリアすると開放。以降は今後追加）
//  areas: 出現するエリア（深いフロアほど後ろのエリアの敵が出る）
export const DUNGEONS = [
  { id: 'd10', name: '初級の洞窟', floors: 10, requires: null, emoji: '🕳', areas: [1, 2] },
  { id: 'd30', name: '深淵の遺跡', floors: 30, requires: 'd10', emoji: '🏛', areas: [1, 2, 3, 4] },
]
export const getDungeon = (id) => DUNGEONS.find((d) => d.id === id) || DUNGEONS[0]

// エリア①〜④の敵（既存ゲームのキャラ名を流用。type: phys=物理 / spec=特殊）
// ステータスはダンジョン用に dungeonEnemyStats でフロア深度に応じてスケールする
export const AREA_ENEMIES = {
  1: [{ name: 'スライム', type: 'phys' }, { name: 'コウモリ', type: 'phys' }, { name: '毒キノコ', type: 'spec' }],
  2: [{ name: 'ゴブリン', type: 'phys' }, { name: '野良犬', type: 'phys' }, { name: '盗賊', type: 'phys' }],
  3: [{ name: 'コボルト', type: 'phys' }, { name: 'スケルトン', type: 'phys' }, { name: 'ゴーレム', type: 'phys' }],
  4: [{ name: '深海魚人', type: 'phys' }, { name: '海賊', type: 'phys' }, { name: '毒クラゲ', type: 'spec' }],
}

// そのフロアで出現するエリアID（浅い→areas先頭、深い→後ろ）
export function areaForFloor(dungeon, floor) {
  const areas = dungeon?.areas || [1]
  const idx = Math.min(areas.length - 1, Math.floor(((floor - 1) / Math.max(1, (dungeon?.floors || 10))) * areas.length))
  return areas[idx]
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

// 持ち物の上限（食料など消費アイテムの合計数。※だっしゅつの翼は対象外）
export const INV_MAX = 20
// ペットアイテム定義（価格はサーバーRPC pet_item_price と一致させること）
//  dungeon=true: ダンジョンで使用可能 / capped=true: 持ち物上限(INV_MAX)の対象
export const PET_ITEMS = {
  escape:  { key: 'escape',  name: 'だっしゅつの翼',   emoji: '🪽', price: 500,   dungeon: true,  capped: false, desc: 'ダンジョンからいつでも脱出（使い切り）' },
  onigiri: { key: 'onigiri', name: 'おにぎり',         emoji: '🍙', price: 200,   dungeon: true,  capped: true, fullness: 30, desc: '満腹度を30回復' },
  rename:  { key: 'rename',  name: 'ニックネーム変更券', emoji: '🎫', price: 10000, dungeon: false, capped: false, desc: 'ペットの名前を変更できる' },
}
export const SHOP_ITEMS = Object.values(PET_ITEMS)
export const DUNGEON_ITEMS = Object.values(PET_ITEMS).filter((i) => i.dungeon)
export const CAPPED_ITEMS = Object.values(PET_ITEMS).filter((i) => i.capped)

export function speciesLabel(pet) {
  return (SPECIES[pet.species] || {}).label || '???'
}
export function speciesEmoji(pet) {
  return (SPECIES[pet.species] || {}).emoji || '🐾'
}
