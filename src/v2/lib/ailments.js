// ============================================================
// バトルフロンティアⅡ（リメイク版）— 状態異常
// ------------------------------------------------------------
// エンチャントの特殊能力（enchant.js）が付与する。スキルからも同じ形で入れられる。
//
// ★出血と毒は**旧版（無印バトルフロンティア）と同じ仕様**（2026-08-16 ユーザー決定）
//   ・出血：攻撃が当たるたび1スタック（上限5）。毎ターン **現在HPの1%×スタック数**。
//           **最後に付与されてから3回ぶん**刻んで消える（付け直すと数え直し）
//           出どころ＝旧版 src/lib/pvp.js の applyTurnStart と evoCombat.js
//   ・毒  ：毎ターン **最大HPの3%**・4ターン。**すでに毒なら重ねて入らない**
//   ★どちらも**割合ダメージなのでVITで軽減されない**（硬い相手にも通る）
//
// 鈍足・麻痺・回復阻害はv2の新規（旧版に同じものが無い、または形が違う）。
//   ・鈍足    ：AGI-20%・4ターン
//   ・麻痺    ：1ターン行動できない
//   ・回復阻害：回復量を指定%だけ下げる・3ターン（下げ幅は付与する側が持つ）
//   ⚠旧版の麻痺は「25%で行動スキップ＋素早さ0.8・3〜5ターン」でこれとは別物。
//     旧版へ寄せる場合は PARALYZE をそちらの形に書き換える。
//
// ★同じ状態異常は**重ならず上書き**（ターン数がリセットされる）。
//   v2のステータスバフは重ねがけ加算だが、状態異常はそれとは別扱い。
//   例外は出血だけで、こちらはスタックが積み上がる（旧版と同じ）。
// ============================================================

export const AIL_KEYS = ['bleed', 'poison', 'slow', 'paralyze', 'healCut']

// 出血（旧版準拠）
export const BLEED_MAX_STACKS = 5
export const BLEED_HP_RATE    = 0.01  // 現在HPに対する割合 × スタック数
export const BLEED_TURNS      = 3     // 最後に付与されてからの持続
// 毒（旧版準拠）
export const POISON_TURNS = 4
export const POISON_RATE  = 0.03      // 最大HPに対する割合
// 鈍足
export const SLOW_TURNS   = 4
export const SLOW_AGI_PCT = -20
// 麻痺
export const PARALYZE_TURNS = 1
// 回復阻害
export const HEAL_CUT_TURNS = 3

export const AIL_LABEL = {
  bleed: '出血', poison: '毒', slow: '鈍足', paralyze: '麻痺', healCut: '回復阻害',
}

// 状態異常の入れ物。side.ail に持たせる
export const createAilments = () => ({})

// ===== 付与 =====
// resistPct は受ける側の抵抗（付与確率から引く）。確率判定は呼び出し側で済ませてから来る想定で、
// ここは「入れる」だけを行う。戻り値は入ったかどうか
export const inflict = (ail, key, opt = {}) => {
  switch (key) {
    case 'bleed': {
      // 旧版と同じ：スタックを1つ足して、消えるまでの数え直し
      // ★opt.max … 付与する側が上限を伸ばせる（暗殺者の隠身＝10スタックまで）
      const cur = ail.bleed
      const max = opt.max || BLEED_MAX_STACKS
      ail.bleed = { stacks: Math.min(max, (cur?.stacks || 0) + (opt.stacks || 1)), age: 0 }
      return true
    }
    case 'poison': {
      // 旧版と同じ：すでに毒なら入らない
      if (ail.poison?.turns > 0) return false
      ail.poison = { turns: POISON_TURNS, rate: POISON_RATE }
      return true
    }
    case 'slow':
      ail.slow = { turns: SLOW_TURNS }
      return true
    case 'paralyze':
      ail.paralyze = { turns: PARALYZE_TURNS }
      return true
    case 'healCut':
      // 下げ幅は付与する側が持つ。重ねがけは強いほうを採る
      ail.healCut = { turns: HEAL_CUT_TURNS, pct: Math.max(ail.healCut?.pct || 0, opt.pct || 0) }
      return true
    default:
      return false
  }
}

export const hasAilment = (ail, key) =>
  key === 'bleed' ? (ail?.bleed?.stacks > 0) : (ail?.[key]?.turns > 0)

// ===== 効果を読む =====
// 鈍足ぶんのステータス補正（liveStats が足す）
export const ailStatPct = (ail) => (hasAilment(ail, 'slow') ? { agi: SLOW_AGI_PCT } : null)
// 回復阻害の倍率（1.0＝阻害なし）
export const healMultOf = (ail) =>
  hasAilment(ail, 'healCut') ? Math.max(0, 1 - (ail.healCut.pct || 0) / 100) : 1
// このターン行動できないか。麻痺は「見たら1ターン消費する」ので判定と同時に減らす
export const consumeParalyze = (ail) => {
  if (!hasAilment(ail, 'paralyze')) return false
  ail.paralyze.turns -= 1
  if (ail.paralyze.turns <= 0) delete ail.paralyze
  return true
}

// ===== ターン終わりの持続ダメージ =====
// 戻り値は [{ key, damage }]。HPの増減は呼び出し側で行う（ログを作る都合）
export const tickAilments = (ail, { hp, maxHp }) => {
  const out = []
  if (ail.poison?.turns > 0) {
    out.push({ key: 'poison', damage: Math.max(1, Math.floor(maxHp * ail.poison.rate)) })
    ail.poison.turns -= 1
    if (ail.poison.turns <= 0) delete ail.poison
  }
  if (ail.bleed?.stacks > 0) {
    // 旧版と同じく**現在HP**基準。刻むほど減衰する
    out.push({ key: 'bleed', damage: Math.max(1, Math.floor(hp * BLEED_HP_RATE * ail.bleed.stacks)), stacks: ail.bleed.stacks })
    ail.bleed.age += 1
    if (ail.bleed.age >= BLEED_TURNS) delete ail.bleed
  }
  // ターン数だけ持つもの
  for (const k of ['slow', 'healCut']) {
    if (ail[k]?.turns > 0) {
      ail[k].turns -= 1
      if (ail[k].turns <= 0) delete ail[k]
    }
  }
  return out
}
