// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB 戦闘の画面を更新する回数
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「60がいい」（本番で測ると、画面は1秒165コマ出せるのに、戦闘の動きは1秒30回だった）：
//   1秒60回で更新する（画面がもっと速くても60回まで）。戦闘の計算は atb.js の決まった刻みのまま＝速さもダメージも変わらない。
//   間に合わない端末は30回に落とす：SLOW_CHECK_MS のあいだに1秒 SLOW_FPS 回も更新できなければ、そのページのあいだ30回のまま
//   （電池のムダを減らす）。裏のタブなどで止まっていた（SLOW_GAP_MS より空いた）ぶんは数えない
// ============================================================
export const DRAW_MS = 1000 / 60
export const SLOW_DRAW_MS = 1000 / 30
export const SLOW_FPS = 40
export const SLOW_CHECK_MS = 2000
export const SLOW_GAP_MS = 200

const shared = { slow: false }   // 一度遅いと分かった端末は、次の戦闘も30回から

// due(t)＝いま更新するか（t は requestAnimationFrame の時刻）。ms＝いまの更新の間隔
export const newAtbPacer = (store = shared) => {
  let next = 0, from = null, count = 0, lastAt = null
  const p = {
    ms: store.slow ? SLOW_DRAW_MS : DRAW_MS,
    due(t) {
      if (t < next - 1) return false
      next = t - next > p.ms ? t + p.ms : next + p.ms   // 遅れたぶんは取り戻さない
      if (p.ms === DRAW_MS) {
        if (lastAt === null || t - lastAt > SLOW_GAP_MS) { from = t; count = 0 } else count += 1
        lastAt = t
        if (t - from >= SLOW_CHECK_MS) {
          if ((count * 1000) / (t - from) < SLOW_FPS) { p.ms = SLOW_DRAW_MS; store.slow = true }
          from = t; count = 0
        }
      }
      return true
    },
  }
  return p
}
