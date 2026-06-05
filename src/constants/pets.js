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

// レベルアップに必要な累計経験値（レベル×10）
export const expForLevel = (lv) => lv * 10
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
// Lvで自動習得。mult=攻撃倍率, hits=攻撃回数, lifesteal=与ダメ回復率
export const SKILLS = {
  tackle:      { name: 'たいあたり',   learnLv: 1,  mult: 1.0, hits: 1, desc: '通常の体当たり' },
  powerStrike: { name: 'ヘビーアタック', learnLv: 3,  mult: 1.7, hits: 1, desc: '強めの一撃（1.7倍）' },
  doubleHit:   { name: 'にれんだ',     learnLv: 6,  mult: 0.75, hits: 2, desc: '2回攻撃（各0.75倍）' },
  drain:       { name: 'すいとり',     learnLv: 10, mult: 1.0, hits: 1, lifesteal: 0.5, desc: '与ダメの半分HP回復' },
}
export const learnedSkills = (level) => Object.entries(SKILLS).filter(([, s]) => s.learnLv <= (level || 1)).map(([id, s]) => ({ id, ...s }))
export const getSkill = (id) => SKILLS[id] || SKILLS.tackle

export function speciesLabel(pet) {
  return (SPECIES[pet.species] || {}).label || '???'
}
export function speciesEmoji(pet) {
  return (SPECIES[pet.species] || {}).emoji || '🐾'
}
