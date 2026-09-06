// ============================================================
// バトルフロンティアⅡ（リメイク版）— フレンド
// ------------------------------------------------------------
// 設計は docs/v2-raid-design.md §4。**レイドの救援信号の宛先**として作った。
//   申請 → 承認で成立。どちらからでも解除できる。上限100人。
//
// ★v2には国が無いので、いまの宛先は「オンライン中」と「フレンド」の2つ。
//   国を作ったら raid.js の CALL_KINDS に 'country' を足すだけで載る。
//
// ⚠権威はサーバー（supabase_v2_raid_20260906.sql の v2_friend_*）。
//   ここは画面の表示と、行の振り分けだけ。
// ============================================================

export const FRIEND_MAX = 100
export const STATUS = ['pending', 'accepted']

// v2_friends の1行を「自分から見た形」に読み替える。
//   kind … friend（成立）/ incoming（相手からの申請）/ outgoing（自分が出した申請）
export const viewOf = (row, meId) => {
  if (!row || !meId) return null
  const mine = String(row.requester) === String(meId)
  return {
    id: row.id,
    otherId: mine ? row.addressee : row.requester,
    kind: row.status === 'accepted' ? 'friend' : (mine ? 'outgoing' : 'incoming'),
    createdAt: row.created_at,
  }
}

export const splitRows = (rows, meId) => {
  const out = { friend: [], incoming: [], outgoing: [] }
  for (const r of rows || []) {
    const v = viewOf(r, meId)
    if (v) out[v.kind].push(v)
  }
  return out
}

// 成立しているフレンドのIDだけ（救援の宛先に渡す）
export const friendIdsOf = (rows, meId) =>
  splitRows(rows, meId).friend.map(v => String(v.otherId))

// 申請していい相手か（画面側の一次チェック。最後はサーバーが弾く）
export const checkRequest = (name, myName, rows, meId) => {
  const n = String(name || '').trim()
  if (!n) return '名前を入力してください'
  if (myName && n.toLowerCase() === String(myName).toLowerCase()) return '自分には申請できません'
  const s = splitRows(rows, meId)
  if (s.friend.length >= FRIEND_MAX) return `フレンドは${FRIEND_MAX}人までです`
  return ''
}
