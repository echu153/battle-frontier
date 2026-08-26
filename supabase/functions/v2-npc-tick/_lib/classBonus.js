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
// ===== 転職を重ねると伸びる（2026-08-16 追加）=====
// **その職業に何回転職したか**（v2_profiles.job_counts）で職業補正が伸びる。
// 同じ職業を選び続ける動機を作るための仕組み。
//   ・伸びるのは2回目の転職から（1回目は もともとの補正値 のまま）
//   ・メインステータス … 1回ごとに +0.1%
//   ・サブステータス   … 5回ごとに +0.1%
//   ・100回を超えたぶんは上がり幅が半分（+0.05%）になる
//
// ★main / sub の割り振りは**マスクデータ**（画面には出さない）。
//   プレイヤーに見せるのは「いまの職業補正がいくつか」だけで、
//   どちらがメインでどれだけ伸びるかは公表しない。
//   ⚠ここを画面に出す実装を足さないこと。出すなら別途指示をもらう。
//
// stats    : ステータスの増減(%)。戦闘中はスキルのバフと同じ土俵で加算される
// main/sub : 転職回数で伸びるステータス（マスク）
// healMult : 自分が受ける回復量の倍率（異端審問官だけ 0.8）
// ============================================================
import { STAT_DEFS } from './stats.js'

export const CLASS_BONUS = {
  // ---- 上位職 ----
  侍:           { stats: { str: 5 },            main:'str',      sub:'dex' },
  狂戦士:       { stats: { str: 10, vit: -5 },  main:'str',      sub:'agi' },
  狩人:           { stats: { str: 5 }, main:'str', sub:'dex' },
  暗殺者:          { stats: { str: 5 }, main:'str', sub:'agi' },
  元素使い:     { stats: { int_stat: 5 },       main:'int_stat', sub:'dex' },
  死霊使い:         { stats: { int_stat: 5 }, main:'int_stat', sub:'vit' },
  聖職者:       { stats: { int_stat: 5 },       main:'int_stat', sub:'vit' },
  異端審問官:   { stats: { int_stat: 10 }, healMult: 0.8, main:'int_stat', sub:'luk' },
  // ★STRで殴るのに相手の特防で受ける「特殊アタッカー」（2026-08-23 ユーザー指定のコンセプト）
  //   ＝威力の参照がSTRなので、伸ばすのもSTR。魔法剣士（両刀）とは別物にする
  サイキッカー: { stats: { str: 5 },            main:'str',      sub:'int_stat' },
  体術師:       { stats: { str: 5 },            main:'str',      sub:'agi' },
  精霊召喚士:   { stats: { int_stat: 5 },       main:'int_stat', sub:'agi' },
  式神使い:     { stats: { int_stat: 5 },       main:'int_stat', sub:'dex' },
  // ---- 複合上位職 ----
  // ★オールラウンダー（2026-08-23 ユーザー指定のコンセプト）。
  //   v2は覚えたスキルが転職後も残るので、「どの職の技でも使いこなす」を職業の個性にする
  //   ＝他職スキルの威力低下（0.8倍）と追加MP（2倍）が半分になる
  賢者:               { stats: { int_stat: 5 },      main:'int_stat', sub:'luk', offClassCut: 50 },
  聖騎士:          { stats: { str: 5 }, main:'str', sub:'vit' },
  魔法剣士:           { stats: { str: 3, int_stat: 3 }, main:'str',   sub:'int_stat' },
  魔銃士:          { stats: { str: 5 }, main:'str', sub:'dex' },
  武僧:           { stats: { str: 5 }, main:'str', sub:'vit' },
  ビーストレンジャー:          { stats: { str: 5 }, main:'str', sub:'agi' },
  // ---- 特殊職 ----
  ギャンブラー:       { stats: { str: 5, luk: 5 }, main:'str', sub:'luk' },
  竜騎士:          { stats: { str: 5 }, main:'str', sub:'vit' },
}

// ===== 伸び方の定数（ここだけ触れば調整できる）=====
export const GROWTH_FROM   = 2     // この回数目の転職から伸び始める
export const MAIN_STEP     = 0.1   // メインは1回ごとに +0.1%
export const SUB_EVERY     = 5     // サブは5回ごと
export const SUB_STEP      = 0.1   // その5回ごとに +0.1%
export const HALVE_AFTER   = 100   // これを超えたぶんは
export const HALVE_RATE    = 0.5   // 上がり幅が半分になる

const round2 = (v) => Number(v.toFixed(2))

// 転職回数から伸びぶん(%)を出す。{ main, sub }
// ★100回を超えたぶんだけ半減する（100回目までは満額）
export const growthOf = (count = 0) => {
  const steps = Math.max(0, Math.floor(count) - (GROWTH_FROM - 1))
  const mainFull = Math.min(steps, HALVE_AFTER)
  const mainHalf = Math.max(0, steps - HALVE_AFTER)
  const main = mainFull * MAIN_STEP + mainHalf * MAIN_STEP * HALVE_RATE

  const subSteps = Math.floor(steps / SUB_EVERY)
  const subCap   = Math.floor(HALVE_AFTER / SUB_EVERY)
  const subFull  = Math.min(subSteps, subCap)
  const subHalf  = Math.max(0, subSteps - subCap)
  const sub = subFull * SUB_STEP + subHalf * SUB_STEP * HALVE_RATE

  return { main: round2(main), sub: round2(sub) }
}

// いまの職業補正。count＝**その職業に転職した回数**（v2_profiles.job_counts）
export const classBonusOf = (cls, count = 0) => {
  const base = CLASS_BONUS[cls]
  if (!base) return null
  const g = growthOf(count)
  if (!g.main && !g.sub) return base
  const stats = { ...base.stats }
  if (base.main && g.main) stats[base.main] = round2((stats[base.main] || 0) + g.main)
  if (base.sub  && g.sub)  stats[base.sub]  = round2((stats[base.sub]  || 0) + g.sub)
  return { ...base, stats }
}

// 「STR+5%」「STR+10%・VIT-5%」のような表示用テキスト。
// ★出すのは**いまの合計**だけ。どれがメインでどう伸びたかは出さない（マスク）
export const classBonusText = (cls, count = 0) => {
  const b = classBonusOf(cls, count)
  if (!b) return ''
  const parts = Object.entries(b.stats || {})
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${STAT_DEFS[k]?.label || k}${v >= 0 ? '+' : ''}${v}%`)
  if (b.healMult && b.healMult !== 1) parts.push(`自身の回復量${b.healMult}倍`)
  // ★数字のステータス以外の効果も必ず出す（出さないと持っていることに気づけない）
  if (b.offClassCut) parts.push(`他職スキルの不利が${b.offClassCut}%減る`)
  return parts.join('・')
}

// その職業に何回転職したか。プロフィールから引く小道具
export const jobCountOf = (profile, cls = null) =>
  Number(profile?.job_counts?.[cls || profile?.class] || 0)
