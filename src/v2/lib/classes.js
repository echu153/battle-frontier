// ============================================================
// バトルフロンティアⅡ（リメイク版）— 職業
// ------------------------------------------------------------
// ★職業マスタの正は DB の v2_classes テーブル（supabase_v2_core.sql でシード）。
//   転職条件の判定はサーバー（v2_change_job）が行う。ここにあるのは
//   「どれが選べるか」を画面に出すための同じ判定と、表示用のラベルだけ。
//   マスタをJS側に持たない＝二重定義にしないための構成。
//
// 職業は転職のときに選ぶ。開始時は START_CLASS。
// 条件は「特定の初期職で転職した回数」と「〈職業名〉の証」の2種類。
// ★2026-08-15：**証が要るのは特殊職（ギャンブラー・竜騎士）だけ**になった。
//   （ブリーダーは2026-08-19に職ごと廃止＝v2にペットが無く、効果を作り直す当てが無かったため）
//   上位職・複合上位職は転職回数だけで就ける。証はどの職業も `職業名 + の証` で統一（proofOf で導出）。
// ============================================================

export const START_CLASS = 'ノーブル'

export const TIER_LABEL = {
  start:    '開始時',
  basic:    '初期職',
  advanced: '上位職',
  hybrid:   '複合上位職',
  special:  '特殊職',
}
export const TIER_ORDER = ['basic', 'advanced', 'hybrid', 'special']

export const TIER_COLOR = {
  start:'#88aaff', basic:'#44aaff', advanced:'#ffcc00', hybrid:'#ff88cc', special:'#44ffaa',
}

// 必要な証の名前。職業名から導出する（マスタの req_proof と一致する）
export const proofOf = (classId) => `${classId}の証`

// 証は転職で1個消費する。所持は「証の名前 → 個数」の形（v2_profiles.proofs）
export const proofCount = (proofs, name) => (proofs?.[name] || 0)
export const hasProof = (proofs, name) => proofCount(proofs, name) > 0

// 条件のうち、まだ満たしていないものを日本語で返す（空配列＝転職できる）
export const missingReqs = (cls, { jobCounts = {}, proofs = {} } = {}) => {
  const out = []
  for (const [job, need] of Object.entries(cls?.req_jobs || {})) {
    const have = jobCounts[job] || 0
    if (have < need) out.push(`${job}で転職${need}回（あと${need - have}回）`)
  }
  if (cls?.req_proof && !hasProof(proofs, cls.req_proof)) out.push(cls.req_proof)
  return out
}

// 転職先に選べるか。開始時の職業（ノーブル）は選べない
export const canBecome = (cls, state) =>
  !!cls && cls.tier !== 'start' && missingReqs(cls, state).length === 0

// 条件の表示文（達成状況に関係ない、その職業の条件そのもの）
export const reqText = (cls) => {
  if (!cls) return ''
  const parts = Object.entries(cls.req_jobs || {}).map(([job, n]) => `${job}で転職${n}回`)
  if (cls.req_proof) parts.push(`${cls.req_proof}（転職時に1個消費）`)
  return parts.length ? parts.join(' ／ ') : '条件なし'
}

// 転職回数の合計（v2_profiles.job_changes と一致するはずの検算用）
export const totalJobChanges = (jobCounts = {}) =>
  Object.values(jobCounts).reduce((t, n) => t + (n || 0), 0)
