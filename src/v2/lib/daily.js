// ============================================================
// バトルフロンティアⅡ（リメイク版）— デイリーミッション
// ------------------------------------------------------------
// 1日1組。**難易度を2つから選ぶ**（毎日の最初のログインで選ぶ）。
// 4つの項目を全部こなすと、まとめてEXPとGoldをもらえる。
//
//   easy   … 出撃20回／挑戦1回／ルーン作成1回／祈る　→ EXP+60・100G
//   normal … 出撃50回／挑戦5回／ルーン作成3回／祈る　→ EXP+180・300G
//
// ★日付が変わるのは**日本時間の5時**（宝樹と同じ。旧版の日課とも同じ）。
//   区切りが機能ごとに違うと「どれがいつ戻るのか」が分からなくなるため揃える。
//
// ★数える権威はサーバー。出撃・アリーナ・抽出・祈るの各RPCが
//   v2_daily_bump を呼んで数え、受け取りは v2_daily_claim が行う。
//   ここ（JS）は表示と判定の写しで、数字はサーバーと一致させること。
//
// ★難易度を選ぶ前でも数える（進捗を捨てない）。難易度は「目標の大きさ」だけを決める。
// ============================================================

// 数える項目。key は v2_profiles.daily_counts のキー
export const TASKS = [
  { key:'sortie', label:'出撃',       unit:'回', note:'20秒は2カウント' },
  { key:'arena',  label:'アリーナに挑戦', unit:'回' },
  { key:'rune',   label:'ルーンを作成', unit:'回' },
  { key:'pray',   label:'宝樹に祈る',   unit:'回' },
]
export const TASK_KEYS = TASKS.map(t => t.key)

// ★出撃は**クールタイムぶんで数え方を変える**（2026-08-17 ユーザー決定）。
//   20秒設定は1回で2カウント。かかる時間あたりの進み具合が10秒設定とそろう
//   （20秒×50回＝1000秒で100カウント／10秒×100回＝1000秒で100カウント）。
//   ★数える権威はサーバー（v2_sortie_settle）。ここはその写しで、必ず同じ値にすること。
export const SORTIE_COUNT = { 10: 1, 20: 2 }
export const sortieCountOf = (cd) => SORTIE_COUNT[Number(cd)] ?? 1

// 難易度。goals は TASKS と同じキー
export const LEVELS = [
  {
    key:'easy', label:'かんたん', color:'#88ccff',
    goals: { sortie: 20, arena: 1, rune: 1, pray: 1 },
    reward: { exp: 60, gold: 100 },
  },
  {
    key:'normal', label:'ふつう', color:'#ffcc00',
    goals: { sortie: 50, arena: 5, rune: 3, pray: 1 },
    reward: { exp: 180, gold: 300 },
  },
]
export const LEVEL_KEYS = LEVELS.map(l => l.key)
export const levelOf = (key) => LEVELS.find(l => l.key === key) || null

// ===== 1日の区切り =====
// 宝樹と同じ式（日本時間の5時）。tree.js と揃えてあるので、変えるなら両方
export const DAY_RESET_HOUR = 5
const JST_OFFSET_MIN = 9 * 60
export const dayOf = (at = new Date()) => {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() + (JST_OFFSET_MIN - DAY_RESET_HOUR * 60) * 60_000)
    .toISOString().slice(0, 10)
}
// プロフィールに入っている daily_day が今日ぶんか（違えば数字は0として扱う）
export const isToday = (dailyDay, at = new Date()) =>
  !!dailyDay && String(dailyDay).slice(0, 10) === dayOf(at)

// ===== 進み具合 =====
// prof … v2_profiles の行。日付が変わっていれば0として読む
export const countsOf = (prof, at = new Date()) => {
  const raw = (isToday(prof?.daily_day, at) && prof?.daily_counts) || {}
  return Object.fromEntries(TASK_KEYS.map(k => [k, Math.max(0, Number(raw[k] || 0))]))
}

// 1項目ぶんの進み具合。{ now, goal, done }
export const progressOf = (prof, levelKey, taskKey, at = new Date()) => {
  const lv = levelOf(levelKey)
  const goal = lv?.goals?.[taskKey] ?? 0
  const now = countsOf(prof, at)[taskKey] || 0
  return { now: Math.min(now, goal || now), goal, done: goal > 0 && now >= goal }
}

// 終わった項目の数。畳んでいるときの「2/4」に使う
export const doneCountOf = (prof, levelKey, at = new Date()) => {
  const lv = levelOf(levelKey)
  if (!lv) return 0
  const c = countsOf(prof, at)
  return TASK_KEYS.filter(k => (c[k] || 0) >= (lv.goals[k] || 0)).length
}

// 全部そろったか
export const isComplete = (prof, levelKey, at = new Date()) => {
  const lv = levelOf(levelKey)
  if (!lv) return false
  const c = countsOf(prof, at)
  return TASK_KEYS.every(k => (c[k] || 0) >= (lv.goals[k] || 0))
}

// 受け取り済みか（日付が変わっていれば未受け取り）
export const isClaimed = (prof, at = new Date()) =>
  isToday(prof?.daily_day, at) && !!prof?.daily_claimed

// 今日の難易度（日付が変わっていれば未選択）
export const pickedLevelOf = (prof, at = new Date()) =>
  (isToday(prof?.daily_day, at) && prof?.daily_level) || null

// 受け取れるか。''なら受け取れる
export const canClaim = (prof, at = new Date()) => {
  const key = pickedLevelOf(prof, at)
  if (!key) return '難易度を選んでください'
  if (isClaimed(prof, at)) return '今日はもう受け取りました'
  if (!isComplete(prof, key, at)) return 'まだ達成していない項目があります'
  return ''
}

// 次に切り替わる時刻（日本時間の5時）
export const nextResetAt = (at = new Date()) => {
  const [y, m, d] = dayOf(at).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1, DAY_RESET_HOUR - 9, 0, 0))
}
