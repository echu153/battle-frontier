// ============================================================
// v2cap アセンション：盤面のマスの組を「全部開くのに要るいちばん少ないAP」を数える（どのマスも1AP・起点は0AP）
// ------------------------------------------------------------
// 【確定】2026-10-23 ユーザー（上位クラスの盤面）「スキルの強化にすぐ達することができるからもっと遠くに」
//   「AION2みたいに道の途中にあってもいい（わざわざその道に行かないと取れない）」→ 選んだこと「多くて5つぐらい、
//   ただ技のマスの先にステータス上昇大き目のマスがあって、それも取るなら3つになる感じ」
//   ＝ AP49（CLASS LV50）で、技のマスだけなら最大5つ・技の先の大マスまで取る道なら最大3本。
//   それを「どう回っても届かない」ことで決める（決まりで止めるのでなく、盤面の遠さで）。
//   ここはその数え方（盤面を作る tools/v2cap-asc-layout.mjs と、ascension.test.js が使う）
// ★つながりはどれも長さ1なので、マスの組と起点を結ぶいちばん小さい木の「つながりの数」＝開くマスの数＝要るAP
//   （シュタイナー木。組の数 k が小さいので、部分集合ごとに全部数える＝k=10 で 3^10 くらい）
// ============================================================

// adj … マスごとのつながり（番号の配列。番号は 0〜adj.length-1）／root … 起点／terms … 数えるマスの番号
// 返す cost[S] … terms の部分集合 S（ビット）を全部開くのに要るAP
export const minApAll = (adj, root, terms) => {
  const n = adj.length, k = terms.length, FULL = 1 << k
  const INF = 1 << 29
  // 値の小さい順に広げる（つながりの長さ1の最短路）
  const relax = (cur) => {
    const buckets = []
    for (let v = 0; v < n; v++) if (cur[v] < INF) (buckets[cur[v]] ||= []).push(v)
    for (let c = 0; c < buckets.length; c++) {
      const b = buckets[c]
      if (!b) continue
      for (let i = 0; i < b.length; i++) {
        const u = b[i]
        if (cur[u] !== c) continue
        for (const w of adj[u]) if (c + 1 < cur[w]) { cur[w] = c + 1; (buckets[c + 1] ||= []).push(w) }
      }
    }
    return cur
  }
  const dp = new Array(FULL)
  for (let i = 0; i < k; i++) { const d = new Int32Array(n).fill(INF); d[terms[i]] = 0; dp[1 << i] = relax(d) }
  for (let S = 1; S < FULL; S++) {
    if ((S & (S - 1)) === 0) continue
    const cur = new Int32Array(n).fill(INF)
    for (let A = (S - 1) & S; A > 0; A = (A - 1) & S) {
      const B = S ^ A
      if (A < B) continue
      const a = dp[A], b = dp[B]
      for (let v = 0; v < n; v++) { const c = a[v] + b[v]; if (c < cur[v]) cur[v] = c }
    }
    dp[S] = relax(cur)
  }
  const cost = new Int32Array(FULL)
  for (let S = 1; S < FULL; S++) cost[S] = dp[S][root]
  return cost
}

const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++ } return c }
// minFor[c] … ちょうど c 個を開くのに要るいちばん少ないAP／kmax … ap で開けるいちばん多い数／within[c] … ap 以内で開ける c 個の組の数
export const reachOf = (cost, k, ap) => {
  const minFor = Array(k + 1).fill(Infinity)
  const within = Array(k + 1).fill(0)
  const total = Array(k + 1).fill(0)
  minFor[0] = 0
  for (let S = 1; S < cost.length; S++) {
    const c = popcount(S)
    total[c]++
    if (cost[S] < minFor[c]) minFor[c] = cost[S]
    if (cost[S] <= ap) within[c]++
  }
  let kmax = 0
  for (let c = 1; c <= k; c++) if (minFor[c] <= ap) kmax = c
  return { minFor, kmax, within, total }
}
