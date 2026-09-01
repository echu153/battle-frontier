// ============================================================
// バトルフロンティアⅡ（リメイク版）— お知らせ
// ------------------------------------------------------------
// 旧版と同じ使い勝手にする（2026-09-01 ユーザー指示）。
//   ・メニューから開ける
//   ・新着があると読み込み時にポップアップが出る
//   ・アップデート／不具合／イベントの3種のタブ
//
// ★中身は **v2_announcements**（旧版の announcements には触らない）。
//   書くのは運営だけ＝プレイヤーには select しか許可していない（SQL側）。
//
// ★既読は localStorage（サーバーに列を増やさない＝端末ごと）。
//   旧版と同じで、**記録が無い端末では過去ぶんを全部既読にしてから**始める。
//   これをしないと、新しい端末で開くたびに過去のお知らせを全部浴びることになる。
// ============================================================

// 3種。DBの v2_announcements.category と対応する
export const CATEGORIES = [
  { key:'update', label:'アップデート', icon:'🆕', color:'#44ff88' },
  { key:'bug',    label:'不具合',       icon:'🛠',  color:'#ffcc00' },
  { key:'event',  label:'イベント',     icon:'🎉', color:'#ff88cc' },
]
export const CATEGORY_KEYS = CATEGORIES.map(c => c.key)

// 未設定・知らない種類は先頭（アップデート）に寄せる。
// ★どこにも出ない、が一番まずい（書いたのに誰にも見えない）
export const categoryOf = (a) => (CATEGORY_KEYS.includes(a?.category) ? a.category : CATEGORY_KEYS[0])
export const categoryDef = (key) => CATEGORIES.find(c => c.key === key) || CATEGORIES[0]

// 既読IDの置き場（prefs.js の名前。実体は localStorage の v2:seenAnnounce）
export const SEEN_KEY = 'seenAnnounce'

// 新しい順。created_at が同じなら id で並べて、並びがブレないようにする
export const sortNewest = (list) => [...(list || [])].sort((a, b) => {
  const d = new Date(b.created_at || 0) - new Date(a.created_at || 0)
  return d !== 0 ? d : String(b.id).localeCompare(String(a.id))
})

// まだ読んでいないもの
export const unreadOf = (list, seen) => {
  const s = new Set(seen || [])
  return (list || []).filter(a => !s.has(a.id))
}

// 端末に既読の記録が無いとき（saved が null）は、**いま在るぶんを全部既読**にして始める。
// 記録があるならそのまま使う。
export const initialSeen = (list, saved) =>
  (saved === null || saved === undefined ? (list || []).map(a => a.id) : saved)

// 種類ごとに分ける（タブ用）
export const byCategory = (list, key) => (list || []).filter(a => categoryOf(a) === key)

// そのタブに新着があるか（タブのNEWバッジ用）
export const hasNewIn = (list, key, unreadIds) => {
  const s = unreadIds instanceof Set ? unreadIds : new Set(unreadIds || [])
  return byCategory(list, key).some(a => s.has(a.id))
}

// 最初に開くタブ … 新着がある種類。無ければアップデート
export const firstTabOf = (list, unreadIds) =>
  CATEGORY_KEYS.find(k => hasNewIn(list, k, unreadIds)) || CATEGORY_KEYS[0]
