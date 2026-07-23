// ============================================================
// ボス装備 進化システム 定義（2026-06-27〜 / is_admin限定先行）
//  - エリアボス撃破で「○○の血(50%)」「○○の心臓(0.5%)」をドロップ
//  - 血50個 → 心臓1個 に変換可能
//  - ボス装備のみ 5段階まで累進進化（鍛冶屋）
//  - 各段で基礎ステ×(1+0.2*stage)。5段=真化＝基礎ステ×2＋レアS＋特殊能力解放
//  仕様詳細: memory/boss-equip-evolution-spec.md
// ============================================================

export const MAX_EVO_STAGE = 5
export const BLOOD_PER_HEART = 50

// 段階ごとのコスト（次段に上げるのに必要な素材）
export const EVO_COST = {
  1: { type: 'blood', amount: 10 },
  2: { type: 'blood', amount: 20 },
  3: { type: 'blood', amount: 30 },
  4: { type: 'blood', amount: 40 },
  5: { type: 'heart', amount: 1 },
}

// 基礎ステ倍率（5段で×2.0）。stats.js と一致させること。
export const evoMultiplier = (stage) => 1 + 0.2 * (stage || 0)

// エリアボスごとの 血/心臓 と ボス装備（装備→特殊能力）
export const BOSS_LINES = [
  {
    area: 1, boss: 'ビッグスライム', blood: 'スライムの血', heart: 'スライムの心臓',
    equips: [
      { name: 'スライムの指輪', effect: 'evo_phys_dmg_taken_down_10' },
      { name: '蒼粘剣',         effect: 'evo_hit_spd_down_10_2t' },
    ],
  },
  {
    area: 2, boss: '盗賊団のリーダー', blood: '盗賊の血', heart: '盗賊の心臓',
    equips: [
      { name: '略奪者の短剣',   effect: 'evo_hit_bleed_30' },
      { name: '影踏みのブーツ', effect: 'evo_evade_spd_up_10_2t' },
    ],
  },
  {
    area: 3, boss: '古代の番人', blood: '番人の血', heart: '番人の心臓',
    equips: [
      { name: '古代魔導コア', effect: 'evo_mp_to_matk_5' },
      { name: '虚無の杖',     effect: 'evo_mdef_pen_10' },
    ],
  },
  {
    area: 4, boss: 'シーサーペント', blood: '海竜の血', heart: '海竜の心臓',
    equips: [
      { name: '海竜の鱗',     effect: 'evo_dmg_taken_down_5' },
      { name: 'アクアクラウン', effect: 'evo_ailment_resist_5' },
    ],
  },
  {
    area: 5, boss: '雷鷲サンダーロック', blood: '雷鷲の血', heart: '雷鷲の心臓',
    equips: [
      { name: '雷鷲の爪牙',   effect: 'evo_spd_to_atk_3' },
      { name: '嵐の重装甲',   effect: 'evo_reflect_5' },
    ],
  },
  {
    area: 6, boss: '氷霊フロストバーン', blood: '氷霊の血', heart: '氷霊の心臓',
    equips: [
      { name: '絶零の魔導砲',           effect: 'evo_hit_stun_20' },
      { name: 'フロストバーンの聖鎧',   effect: 'evo_ondmg_stun_20' },
    ],
  },
  {
    area: 7, boss: '深紅のサラマンダー', blood: 'サラマンダーの血', heart: 'サラマンダーの心臓',
    equips: [
      { name: '深紅の牙輪',           effect: 'evo_allskill_atk_10' },
      { name: '深紅の魔眼石',         effect: 'evo_allskill_matk_10' },
      { name: 'インフェルノバスティオン', effect: 'evo_ondmg_burn_50' },
    ],
  },
  {
    // エリア⑧ 天空覇龍ウラノス: 進化・真化は可能だが特殊能力なし（真化=基礎ステ×2＋S表示のみ）
    area: 8, boss: '天空覇龍ウラノス', blood: '覇龍の血', heart: '覇龍の心臓',
    equips: [
      { name: 'ウラノスの天砲', effect: null },
      { name: '覇龍の聖鎧',     effect: null },
      { name: '蒼天龍の指輪',   effect: null },
    ],
  },
]

// 真化（5段）で解放される特殊能力ラベル
export const EVO_EFFECT_LABELS = {
  evo_hit_spd_down_10_2t:    '【真化・攻撃ヒット時 対象の素早さ2T-10%】',
  evo_phys_dmg_taken_down_10:'【真化・物理被ダメージ-10%】',
  evo_hit_bleed_30:          '【真化・攻撃ヒット時 30%で出血】',
  evo_evade_spd_up_10_2t:    '【真化・回避時 2T素早さ+10%】',
  evo_mp_to_matk_5:          '【真化・最大MPの5%を特攻に加算】',
  evo_mdef_pen_10:           '【真化・魔法防御貫通+10%】',
  evo_dmg_taken_down_5:      '【真化・被ダメージ-5%】',
  evo_ailment_resist_5:      '【真化・状態異常になる確率-5%】',
  evo_spd_to_atk_3:          '【真化・素早さの3%を攻撃に加算】',
  evo_reflect_5:             '【真化・被ダメージ時 ダメージの5%反射】',
  evo_hit_stun_20:           '【真化・攻撃ヒット時 20%でスタン】',
  evo_ondmg_stun_20:         '【真化・被ダメージ時 20%で相手をスタン】',
  evo_allskill_atk_10:       '【真化・全スキルセット時 攻撃+10%】',
  evo_allskill_matk_10:      '【真化・全スキルセット時 特攻+10%】',
  evo_ondmg_burn_50:         '【真化・被ダメージ時 50%で相手をやけど】',
}

// 装備名 → 所属ボスライン（血/心臓/特殊能力）の逆引き
export const EQUIP_TO_LINE = {}
for (const line of BOSS_LINES) {
  for (const eq of line.equips) {
    EQUIP_TO_LINE[eq.name] = { ...line, effect: eq.effect }
  }
}

export const EVO_EQUIP_NAMES = new Set(Object.keys(EQUIP_TO_LINE))
export const isEvolvableEquip = (name) => EVO_EQUIP_NAMES.has(name)

// 次段のコスト説明（UI用）
export const nextEvoCost = (stage) => EVO_COST[(stage || 0) + 1] || null

// 真化済みか（5段到達）
export const isShinka = (item) => (item?.evolve_stage || 0) >= MAX_EVO_STAGE

// 表示用レアリティ: 真化(5段)はS表示に上書き。weapons.rarity自体は共有列のため変更しない。
//  item = player_equipment行（weapons結合済み）。fallback はweaponsが無い場合の素のrarity。
export const displayRarity = (item, fallback) =>
  isShinka(item) ? 's' : (item?.weapons?.rarity ?? fallback ?? 'f')
