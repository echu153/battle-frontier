// ============================================================
// 領地（国・建国）システム  共通定義  ※is_admin限定で先行公開
// ------------------------------------------------------------
// 9カ国構成（うち1つは固定の「非加盟国」）。残り最大8カ国をプレイヤーが建国できる。
// 階級・獲得式・閾値は supabase_territory.sql と必ず一致させること。
// ============================================================

// 加盟国の最大数（非加盟国を除く）
export const MAX_COUNTRIES = 8

// 建国条件
export const FOUND_MIN_CHARLV = 500

// 階級（低→高）。自動昇格で到達するのは 二等兵〜大将（16段）。
// 副元帥/参謀/元帥は任命・建国専用（将来の下剋上で昇格）。
export const RANKS_ASC = [
  '二等兵','一等兵','上等兵','伍長','軍曹','曹長','准尉','少尉','中尉','大尉',
  '少佐','中佐','大佐','少将','中将','大将',          // ↑ここまで貢献度で自動昇格
  '参謀','副元帥','元帥',                              // ↑任命・建国専用
]

// 貢献度→階級 の閾値（SQL territory_rank_for_contrib と一致）
const CONTRIB_RANKS = ['二等兵','一等兵','上等兵','伍長','軍曹','曹長','准尉','少尉','中尉','大尉','少佐','中佐','大佐','少将','中将','大将']
const CONTRIB_THRESHOLDS = [0,500,1500,3000,6000,10000,16000,25000,40000,60000,90000,130000,180000,250000,350000,500000]

// 階級の序列（高いほど偉い）。表示ソート用。
export const rankOrder = (rank) => {
  const i = RANKS_ASC.indexOf(rank)
  return i < 0 ? 0 : i
}

// 自動昇格における現在/次の階級と、次までの必要貢献度
export const rankProgress = (contrib) => {
  const c = Math.max(0, Number(contrib) || 0)
  let idx = 0
  for (let i = CONTRIB_THRESHOLDS.length - 1; i >= 0; i--) {
    if (c >= CONTRIB_THRESHOLDS[i]) { idx = i; break }
  }
  const current = CONTRIB_RANKS[idx]
  const next = idx < CONTRIB_RANKS.length - 1 ? CONTRIB_RANKS[idx + 1] : null
  const nextAt = next ? CONTRIB_THRESHOLDS[idx + 1] : null
  const remain = next ? Math.max(0, nextAt - c) : 0
  return { current, next, nextAt, remain }
}

// 領地拡大1回の獲得量（SQL expand_territory と一致）
export const expandGain = (power) => {
  const p = Math.min(Math.max(Number(power) || 0, 0), 100000)
  return Math.floor(10 + p / 20)
}

// クールダウン（ミリ秒）
export const EXPAND_COOLDOWN_MS = 60 * 60 * 1000      // 領地拡大: 1時間
export const ASYLUM_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000  // 亡命: 7日

// 残り時間を mm:ss / d/h 表記に
export const fmtRemain = (ms) => {
  if (ms <= 0) return '0:00'
  const s = Math.ceil(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}日${h}時間`
  if (h > 0) return `${h}時間${m}分`
  return `${m}:${String(sec).padStart(2, '0')}`
}
