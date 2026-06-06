// ペット種族の定義とステータス計算（ペット画面・ダンジョンで共有）
// 画像(image_url)が未設定のときは emoji を代替表示する。

export const SPECIES = {
  // --- スターター（最初に1体選択）---
  flame:  { label: 'フラム',  emoji: '🦎', starter: true,  base: { hp: 40, atk: 12, def: 4 }, grow: { hp: 6, atk: 2, def: 1 } },
  aqua:   { label: 'アクー',  emoji: '🐟', starter: true,  base: { hp: 48, atk: 9,  def: 6 }, grow: { hp: 8, atk: 1, def: 1 } },
  leaf:   { label: 'リーフィ', emoji: '🐛', starter: true,  base: { hp: 44, atk: 11, def: 5 }, grow: { hp: 7, atk: 2, def: 1 } },
  // --- 卵から孵る種族（Phase2後半で入手手段を実装）---
  spark:  { label: 'スパーク', emoji: '🐭', starter: false, base: { hp: 38, atk: 14, def: 3 }, grow: { hp: 5, atk: 3, def: 1 } },
  stone:  { label: 'ストーン', emoji: '🐢', starter: false, base: { hp: 60, atk: 8,  def: 9 }, grow: { hp: 10, atk: 1, def: 2 } },
  wind:   { label: 'ウィン',  emoji: '🦅', starter: false, base: { hp: 42, atk: 13, def: 4 }, grow: { hp: 6, atk: 2, def: 1 } },
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
    maxHp: sp.base.hp + sp.grow.hp * (lv - 1),
    atk:   sp.base.atk + sp.grow.atk * (lv - 1),
    def:   sp.base.def + sp.grow.def * (lv - 1),
  }
}

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
export const DUNGEONS = [
  { id: 'd10', name: '初級の洞窟', floors: 10, requires: null, emoji: '🕳' },
  { id: 'd30', name: '深淵の遺跡', floors: 30, requires: 'd10', emoji: '🏛' },
]
export const getDungeon = (id) => DUNGEONS.find((d) => d.id === id) || DUNGEONS[0]

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
