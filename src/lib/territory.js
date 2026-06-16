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

// 地図 ryouti.png 上の9大陸＝9領域。region 1〜9。中央(5)は非加盟国の固定領域。
// x/y は画像に対する中心位置(%)。マップ上のマーカー配置に使う。
export const UNAFFILIATED_REGION = 7   // 下段・左から2番目の大陸を非加盟国に
export const REGIONS = [
  { id: 1, x: 13, y: 30, name: '北西の大陸' },
  { id: 2, x: 29, y: 33, name: '北中西の大陸' },
  { id: 3, x: 55, y: 28, name: '北の大陸' },
  { id: 4, x: 84, y: 35, name: '北東の大陸' },
  { id: 5, x: 44, y: 50, name: '中央の大陸' },
  { id: 6, x: 21, y: 68, name: '南西の大陸' },
  { id: 7, x: 39, y: 78, name: '南中西の大陸' },   // 非加盟国
  { id: 8, x: 58, y: 73, name: '南中東の大陸' },
  { id: 9, x: 83, y: 75, name: '南東の大陸' },
]

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

// 出撃エリア(1〜7)。Game.jsx の AREAS と id/名前を一致させること。
// 領地拡大時にエリアを選び、そのエリアの領地が増える。
export const AREA_META = [
  { id: 1, name: '始まりの森' },
  { id: 2, name: '荒廃した草原' },
  { id: 3, name: '古代の洞窟' },
  { id: 4, name: '蒼海の入り江' },
  { id: 5, name: '巨峰山脈' },
  { id: 6, name: '白銀の霊峰' },
  { id: 7, name: '煉獄火山' },
]

// エリア支配国の装備ドロップ率ボーナス上限（将来実装。シェアに応じて 0〜この値）。
export const AREA_DROP_BONUS_MAX = 0.03  // 最大 +3%

// エリアごとの支配国(シェア最大)とシェアを算出。rows = country_area_territory 全行。
// 返り値: { [areaId]: { topCountryId, share, total } }
export const computeAreaControl = (rows) => {
  const byArea = {}
  for (const r of (rows || [])) {
    const a = r.area_id
    if (!byArea[a]) byArea[a] = { total: 0, top: null, topAmt: 0 }
    const amt = Number(r.amount) || 0
    byArea[a].total += amt
    if (amt > byArea[a].topAmt) { byArea[a].topAmt = amt; byArea[a].top = r.country_id }
  }
  const out = {}
  for (const a of Object.keys(byArea)) {
    const v = byArea[a]
    out[a] = { topCountryId: v.top, share: v.total > 0 ? v.topAmt / v.total : 0, total: v.total }
  }
  return out
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
