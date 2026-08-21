// ============================================================
// バトルフロンティアⅡ（リメイク版）— スタミナ
// ------------------------------------------------------------
// **オート出撃のための燃料**（2026-08-22 ユーザー決定）。
//   ・スタミナが1以上あるあいだは、10秒ごとに自動で出撃する
//   ・オート出撃1回につき1消費する
//   ・切れたら**これまで通り自分でクリックして出撃**する（手動は消費しない）
//
// ★回復は**5分に1**。上限は最大値まで。端数は繰り越す（下の rollStamina）。
//   画面を閉じているあいだも溜まる＝**時刻から計算する**（数えるのはサーバー）。
//
// ★最大値は転職回数で伸びる。**伸びる条件はマスク**（2026-08-22 ユーザー指示）＝
//   画面には「7 / 12」のように今の値と最大値だけ出し、**増え方は書かない**。
//   （職業補正の伸び＝classBonus.js と同じ扱い）
//
// ⚠数える権威はサーバー（supabase_v2_core.sql の v2_stamina_max / v2_stamina_roll）。
//   ここはその写しで、必ず同じ計算にすること（v2sql.test.js が突き合わせる）。
// ============================================================

// 初期値＝最大値の下限。転職0回のときの最大値
export const STAMINA_BASE = 10

// 転職回数で最大値が伸びる段。upto＝その段の終わりの回数／per＝何回ごとに1増えるか
//   1〜29回   … 1回ごとに1
//   30〜49回  … 3回ごとに1
//   50〜99回  … 5回ごとに1
//   100〜299回… 10回ごとに1
//   300回〜   … 30回ごとに1
export const STAMINA_STEPS = [
  { upto: 29, per: 1 },
  { upto: 49, per: 3 },
  { upto: 99, per: 5 },
  { upto: 299, per: 10 },
  { upto: Infinity, per: 30 },
]

// 最大スタミナ。段ごとに「その段に入った回数 ÷ per」を切り捨てて足す
export const staminaMax = (jobChanges) => {
  const n = Math.max(0, Math.floor(Number(jobChanges) || 0))
  let max = STAMINA_BASE
  let from = 0
  for (const s of STAMINA_STEPS) {
    const span = Math.min(n, s.upto) - from
    if (span > 0) max += Math.floor(span / s.per)
    from = s.upto
    if (n <= s.upto) break
  }
  return max
}

// 回復の間隔。5分に1（2026-08-22 ユーザー決定）
export const STAMINA_RECOVER_MS = 5 * 60 * 1000

// 経過時間ぶんを足して数え直す。at＝最後に数え直した時刻
//   ・端数は捨てない＝消化したぶんだけ at を進める（4分59秒ぶんが毎回消えないように）
//   ・満タンになったら at は「いま」へ（止まっているあいだに溜め込まない）
export const rollStamina = (stamina, at, max, now = Date.now()) => {
  const cap = Math.max(0, Math.floor(Number(max) || 0))
  const cur = Math.max(0, Math.min(cap, Math.floor(Number(stamina) || 0)))
  const base = at ? new Date(at).getTime() : now
  if (cur >= cap) return { n: cap, at: now }
  const gained = Math.max(0, Math.floor((now - base) / STAMINA_RECOVER_MS))
  const n = Math.min(cap, cur + gained)
  return { n, at: n >= cap ? now : base + gained * STAMINA_RECOVER_MS }
}

// 次の1が溜まるまでの残りms。満タンなら0
export const msToNextStamina = (stamina, at, max, now = Date.now()) => {
  const r = rollStamina(stamina, at, max, now)
  if (r.n >= Math.max(0, Math.floor(Number(max) || 0))) return 0
  return Math.max(0, STAMINA_RECOVER_MS - (now - r.at))
}

// 「3:21」の形。オート出撃のパネルに出す
export const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
