// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB 戦闘の画面を更新する回数
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「60がいい」（本番で測ると、画面は1秒165コマ出せるのに、戦闘の動きは1秒30回だった）：
//   1秒60回で更新する（画面がもっと速くても60回まで）。戦闘の計算は atb.js の決まった刻みのまま＝速さもダメージも変わらない。
//   間に合わない端末は段階を下げる：SLOW_CHECK_MS のあいだに1秒 SLOW_FPS 回も更新できなければ、ふつう→軽い表示→軽い表示で30回。
//   そのページのあいだは戻さない（電池のムダを減らす）。裏のタブなどで止まっていた（SLOW_GAP_MS より空いた）ぶんは数えない
// 【確定】2026-10-31 ユーザー「30回に落としたって出る、大技の時はそれよりも下がる感じ」：スマホははじめから軽い表示（V2capAtbStage.jsx の LiteCtx）
// ============================================================
export const DRAW_MS = 1000 / 60
export const SLOW_DRAW_MS = 1000 / 30
export const SLOW_FPS = 40
export const SLOW_CHECK_MS = 2000
export const SLOW_GAP_MS = 200

// スマホか（指で操作する小さい画面）
const isPhone = () => {
  try { return window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) <= 900 } catch { return false }
}
// 段階（0＝ふつう／1＝軽い表示／2＝軽い表示で30回）。一度下がった端末は次の戦闘も同じ段階から
const shared = { level: null }
export const atbLevelOf = (store = shared) => {
  if (store.level === null) store.level = isPhone() ? 1 : 0
  return store.level
}

// due(t)＝いま更新するか（t は requestAnimationFrame の時刻）。level＝いまの段階・ms＝いまの更新の間隔
export const newAtbPacer = (store = shared) => {
  let next = 0, from = null, count = 0, lastAt = null
  atbLevelOf(store)
  const p = {
    get level() { return store.level },
    get ms() { return store.level >= 2 ? SLOW_DRAW_MS : DRAW_MS },
    due(t) {
      if (t < next - 1) return false
      next = t - next > p.ms ? t + p.ms : next + p.ms   // 遅れたぶんは取り戻さない
      if (store.level < 2) {
        if (lastAt === null || t - lastAt > SLOW_GAP_MS) { from = t; count = 0 } else count += 1
        lastAt = t
        if (t - from >= SLOW_CHECK_MS) {
          if ((count * 1000) / (t - from) < SLOW_FPS) store.level += 1
          from = t; count = 0
        }
      }
      return true
    },
  }
  return p
}
