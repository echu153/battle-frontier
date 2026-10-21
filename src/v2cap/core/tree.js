// ============================================================
// バトルフロンティアⅡ（リメイク版）— 施設「ユグレシアの宝樹」
// ------------------------------------------------------------
// 1日1回だけ祈れる。祈ると 大凶〜大吉 が引かれ、その結果に応じた報酬をもらう。
//
// ★抽選の権威はサーバー（supabase_v2_core.sql の v2_pray）。
//   このファイルは「表示」と「テスト」のためのもので、ここで引いた結果は使わない。
//   重みを変えるときは v2_pray の c_weight も必ず同時に直すこと（下のテストで並びを固定してある）。
//
// ★報酬（2026-08-23 ユーザー決定）：**Gold と EXP**。ベースは「吉」の 300G・EXP30 で、
//   結果ごとの倍率 mult を掛ける。重み付きの期待値は×1.045＝ならすとベースとほぼ同じ。
//   ⚠**配るのはサーバー（v2_pray）**。ここの数字は表示とテスト用の写しなので、
//     倍率を変えるときは v2_pray の c_mult も必ず同時に直すこと（v2sql.test.js が突き合わせる）。
// ============================================================

// 報酬のベース（＝「吉」でもらえる量）
export const PRAY_GOLD = 300
export const PRAY_EXP  = 30

// 出にくい順に上から。weight の合計は100（＝そのまま%として読める）
export const FORTUNES = [
  { id:'daikichi', name:'大吉', weight:5,  mult:3,   color:'#ffcc00', text:'宝樹が大きく揺れ、金色の葉が降りそそいだ。' },
  { id:'chukichi', name:'中吉', weight:10, mult:2,   color:'#ffaa44', text:'枝先がほのかに輝いている。' },
  { id:'shokichi', name:'小吉', weight:15, mult:1.5, color:'#88ddaa', text:'若葉が一枚、手のひらに落ちてきた。' },
  { id:'kichi',    name:'吉',   weight:25, mult:1,   color:'#88ccff', text:'穏やかな風が幹をなでていった。' },
  { id:'suekichi', name:'末吉', weight:20, mult:0.7, color:'#7f95c4', text:'葉ずれの音がかすかに返ってきた。' },
  { id:'kyo',      name:'凶',   weight:15, mult:0.4, color:'#aa77cc', text:'宝樹は静かなままだった。' },
  { id:'daikyo',   name:'大凶', weight:10, mult:0.2, color:'#ff6666', text:'幹がきしみ、あたりが暗くなった。' },
]

// その結果でもらえる Gold と EXP。★サーバーの v2_pray と同じ丸め方（四捨五入）
export const rewardOf = (f) => ({
  gold: Math.round(PRAY_GOLD * (f?.mult ?? 1)),
  exp:  Math.round(PRAY_EXP  * (f?.mult ?? 1)),
})
// 画面に出す文（サーバーが返す reward と同じ形）
export const rewardText = (f) => {
  const r = rewardOf(f)
  return `${r.gold.toLocaleString()}G・EXP+${r.exp}`
}

export const FORTUNE_BY_NAME = Object.fromEntries(FORTUNES.map(f => [f.name, f]))
export const TOTAL_WEIGHT = FORTUNES.reduce((t, f) => t + f.weight, 0)

// 出る確率(%)。重みの合計が100なので weight と同じ値になるが、
// 重みを足し引きしても表示が狂わないように割り算で出しておく
export const chanceOf = (f) => Math.round((f.weight / TOTAL_WEIGHT) * 1000) / 10

// 抽選（表示・テスト用。実際に配る結果はサーバーが決める）
export const rollFortune = (rng = Math.random) => {
  let n = rng() * TOTAL_WEIGHT
  for (const f of FORTUNES) {
    n -= f.weight
    if (n < 0) return f
  }
  return FORTUNES[FORTUNES.length - 1]
}

// ===== 1日1回の区切り =====
// 日付が変わるのは日本時間の5時（旧版の日課と同じ）。
// ★サーバー側も同じ式で判定している：
//     ((now() at time zone 'Asia/Tokyo') - interval '5 hours')::date
export const DAY_RESET_HOUR = 5
const JST_OFFSET_MIN = 9 * 60

// その時刻が「どの日ぶんの祈りか」を YYYY-MM-DD で返す
export const prayDayOf = (at) => {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const shifted = new Date(d.getTime() + (JST_OFFSET_MIN - DAY_RESET_HOUR * 60) * 60_000)
  return shifted.toISOString().slice(0, 10)
}

// まだ今日ぶんを祈っていないか
export const canPray = (lastPrayAt, at = new Date()) => {
  if (!lastPrayAt) return true
  const last = prayDayOf(lastPrayAt)
  return !last || last !== prayDayOf(at)
}

// 次に祈れるようになる時刻（日本時間の5時）
export const nextPrayAt = (at = new Date()) => {
  const d = at instanceof Date ? at : new Date(at)
  const day = prayDayOf(d)                       // いま何日ぶんか
  const [y, m, dd] = day.split('-').map(Number)
  // その日ぶんの区切りは「翌日のJST 5:00」＝UTCでは翌日の 20:00（前日）
  return new Date(Date.UTC(y, m - 1, dd + 1, DAY_RESET_HOUR - 9, 0, 0))
}

// 次に祈れるまでの残り。{ h, m, s } を返す（0なら祈れる）
export const remainUntilPray = (lastPrayAt, at = new Date()) => {
  if (canPray(lastPrayAt, at)) return { h:0, m:0, s:0, total:0 }
  const ms = Math.max(0, nextPrayAt(at).getTime() - (at instanceof Date ? at : new Date(at)).getTime())
  const s = Math.floor(ms / 1000)
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60, total: s }
}
