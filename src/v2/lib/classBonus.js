// ============================================================
// バトルフロンティアⅡ（リメイク版）— 職業補正（常時発動）
// ------------------------------------------------------------
// スキルとは別枠の、**その職業に就いている間だけ常時かかる補正**。
//   ・枠を使わない（スキルセットの5枠を消費しない）
//   ・転職して別の職業になると、その時点で効かなくなる
//   ・上位職・複合上位職・特殊職だけが持つ。初期職6職とノーブルは補正なし
//     （初期職は通過点なので数字を増やさない／上位職に就いた実感を出すため）
//
// ★これが「いまの職業」に意味を持たせている唯一の要素。
//   スキルは習得済みで転職後も残るので、職業補正が無いと現在の職業が
//   ただのスキル習得先になってしまう。
//
// stats    : ステータスの増減(%)。戦闘中はスキルのバフと同じ土俵で加算される
// healMult : 自分が受ける回復量の倍率（異端審問官だけ 0.8）
// ============================================================
import { STAT_DEFS } from './stats.js'

export const CLASS_BONUS = {
  // ---- 上位職 ----
  侍:           { stats: { str: 5 } },
  狂戦士:       { stats: { str: 10, vit: -5 } },
  狩人:         { stats: { dex: 5 } },
  暗殺者:       { stats: { agi: 5 } },
  元素使い:     { stats: { int_stat: 5 } },
  死霊使い:     { stats: { vit: 5 } },
  聖職者:       { stats: { int_stat: 5 } },
  異端審問官:   { stats: { int_stat: 10 }, healMult: 0.8 },
  サイキッカー: { stats: { dex: 5 } },
  体術師:       { stats: { str: 5 } },
  精霊召喚士:   { stats: { int_stat: 5 } },
  式神使い:     { stats: { int_stat: 5 } },
  // ---- 複合上位職 ----
  賢者:               { stats: { int_stat: 5 } },
  聖騎士:             { stats: { vit: 5 } },
  魔法剣士:           { stats: { str: 3, int_stat: 3 } },
  魔銃士:             { stats: { dex: 5 } },
  武僧:               { stats: { vit: 5 } },
  ビーストレンジャー: { stats: { agi: 5 } },
  // ---- 特殊職 ----
  ギャンブラー: { stats: { luk: 10 } },
  竜騎士:       { stats: { vit: 5 } },
  ブリーダー:   { stats: { str: 3, int_stat: 3 } },
}

export const classBonusOf = (cls) => CLASS_BONUS[cls] || null

// 「STR+5%」「STR+10%・VIT-5%」のような表示用テキスト
export const classBonusText = (cls) => {
  const b = classBonusOf(cls)
  if (!b) return ''
  const parts = Object.entries(b.stats || {})
    .map(([k, v]) => `${STAT_DEFS[k]?.label || k}${v >= 0 ? '+' : ''}${v}%`)
  if (b.healMult && b.healMult !== 1) parts.push(`自身の回復量${b.healMult}倍`)
  return parts.join('・')
}
