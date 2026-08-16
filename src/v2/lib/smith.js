// ============================================================
// バトルフロンティアⅡ（リメイク版）— 鍛冶屋「強化」の正
// ------------------------------------------------------------
// あるけみすと式で、**同じ装備・同じ強化値を3個**使って強化値を上げる。
// v2では3個の役割をはっきり分ける：
//   ・強化元（base）… 1個。**成功しても失敗しても残る**。エッセンスもソケットもそのまま
//   ・強化素材（mat）… 2個。成功でも失敗でも消える（護符を使ったときだけ失敗で残る）
// ★2026-08-16 に「3個まとめて溶けて新しい1個ができる」方式から変えた。
//   前の方式だと、ソケットを厳選した装備やエッセンス入りの装備が
//   どれか分からないまま消えてしまうため（強化元を選べなかった）。
//
// ★あるけみすとは強化（合成）の仕様を公表していない
//   （wikiwiki alchemist-p の基本情報にも記載が無いのを 2026-08-16 に確認済み）。
//   なので確率はBF独自。「ランクが高いほど上がりにくい」だけを守っている。
//
// ★この表は supabase_v2_core.sql の v2_fuse にも同じ数字が入っている。
//   片方だけ直すと画面の表示と実際の結果がズレる（下のテストで並びを固定してある）。
// ============================================================

// 結果は4つ。fail 以外は強化値が上がる
export const RESULTS = ['fail', 'ok', 'great', 'super']
export const RESULT_UP = { fail: 0, ok: 1, great: 2, super: 3 }
export const RESULT_LABEL = { fail: '失敗', ok: '成功', great: '大成功', super: '超大成功' }
export const RESULT_COLOR = { fail: '#ff6666', ok: '#88ccff', great: '#44ff88', super: '#ffcc00' }

// ランク別の確率(%)。合計100。
// ★ランクが上がるほど：失敗が増え、成功・大成功・超大成功はすべて減る
export const RATES = {
  F: { fail: 0,  ok: 82, great: 14, super: 4 },
  E: { fail: 3,  ok: 82, great: 12, super: 3 },
  D: { fail: 7,  ok: 80, great: 10, super: 3 },
  C: { fail: 12, ok: 77, great: 9,  super: 2 },
  B: { fail: 18, ok: 73, great: 7,  super: 2 },
  A: { fail: 25, ok: 68, great: 6,  super: 1 },
  S: { fail: 33, ok: 61, great: 5,  super: 1 },
}
export const ratesOf = (rank) => RATES[rank] || RATES.F

// 強化素材の数（強化元をのぞく）
export const MAT_COUNT = 2

// ===== 守りの護符 =====
// 失敗しても強化素材が消えない。そのかわり**成功しても+1どまり**（大成功・超大成功が出ない）。
// ★入手方法は未定（2026-08-16）。いまは開発限定の付与（v2_debug_grant_protect）だけ。
export const PROTECT_NAME = '守りの護符'
export const PROTECT_DESC = '失敗しても強化素材が消えません。そのかわり大成功・超大成功は出ません。'

// 護符を使ったときの確率。fail の重みはそのままで、上がるときは必ず+1になる
export const ratesWithProtect = (rank) => {
  const r = ratesOf(rank)
  return { fail: r.fail, ok: r.ok + r.great + r.super, great: 0, super: 0 }
}
export const ratesFor = (rank, protect = false) => (protect ? ratesWithProtect(rank) : ratesOf(rank))

// 表示・テスト用の抽選（実際に配る結果はサーバーが決める）
export const rollFuse = (rank, protect = false, rng = Math.random) => {
  const r = ratesFor(rank, protect)
  const n = rng() * 100
  if (n < r.fail) return 'fail'
  if (n < r.fail + r.super) return 'super'
  if (n < r.fail + r.super + r.great) return 'great'
  return 'ok'
}

// ===== 選んだ組み合わせが正しいか =====
// 強化元と強化素材は「同じ装備」「同じ強化値」でなければならない。
// 強化素材に装備中のものは使えない（強化元は残るので装備中でも使える）。
export const checkPick = ({ base, mats, plusMax = 12, wornIds = new Set() }) => {
  if (!base) return '強化元を選んでください'
  if (base.plus >= plusMax) return `強化値は+${plusMax}が上限です`
  if ((mats || []).length !== MAT_COUNT) return `強化素材を${MAT_COUNT}個選んでください`
  const ids = new Set([base.id, ...mats.map(m => m.id)])
  if (ids.size !== MAT_COUNT + 1) return '同じものを重ねて選んでいます'
  for (const m of mats) {
    if (m.equip_id !== base.equip_id) return '同じ装備を選んでください'
    if ((m.plus || 0) !== (base.plus || 0)) return '強化値が同じものを選んでください'
    if (wornIds.has(String(m.id))) return '装備中のものは強化素材に使えません'
  }
  return ''
}
