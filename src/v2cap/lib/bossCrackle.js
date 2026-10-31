// ============================================================
// 「レベルキャップあり」版（v2cap）— ボスの体を走る稲妻（びりびり）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「黒龍のバフ後のモーション、いまほわほわしてるけど、黒龍はもっとびりびりしてほしい、かっこいい感じに」：
//   逆鱗のあとの赤いふわっとした光（体のまわりの脈）をやめて、体のふちを短い稲妻が走り続ける形にした。
//   ・いま出ている絵（立ち絵・技のポーズの絵）のふちの点（edgePointsOf）から出す＝どの絵でも体についていく
//   ・1本はすぐ消える（lifeMs）。出ているあいだも stepMs ごとに形が変わる（ちらつく）
//   ・ふちからふちへ走るものと、体の外へ飛び出すもの（outRate）がある・ときどき枝が分かれる（forkRate）
//   ・ときどき強い一発（surge）：短いあいだに続けて長く走り、体が瞬く（surgeFlickAt）
//   ・同じ時刻なら同じ形（乱数は決まった種）。画面は components/BossCrackle.jsx
// ============================================================

const hash01 = (i, salt) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x) }
const lerp = (r, t) => r[0] + (r[1] - r[0]) * t

// 絵の濃さ（alpha・w×h の1次元・0〜255）から、体のふちの点 [x, y, nx, ny] を取る。x, y＝立ち絵の px（pxPer 倍）・nx, ny＝外向きの向き（長さ1）。
//   まわりに透けた所があれば「ふち」。多いと毎コマの計算が増えるので max 個まで間引く
export const edgePointsOf = (alpha, w, h, pxPer = 1, max = 200) => {
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x] >= 128
  const out = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue
      if (on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1)) continue
      let nx = 0, ny = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!on(x + dx, y + dy)) { nx += dx; ny += dy }
      const d = Math.hypot(nx, ny) || 1
      out.push([x * pxPer, y * pxPer, nx / d, ny / d])
    }
  }
  const stride = Math.max(1, Math.ceil(out.length / max))
  return out.filter((_, i) => i % stride === 0)
}

// 1本の折れ線：a から b へ。両はしは動かさず、真ん中ほど横へ大きくふれる。seed が変わると形が変わる
const zigzag = (a, b, jitter, seed, every = 22) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1
  const n = Math.max(3, Math.min(14, Math.round(d / every))), px = -dy / d, py = dx / d
  const pts = [[a[0], a[1]]]
  for (let j = 1; j < n; j++) {
    const u = j / n, off = (hash01(j, seed) - 0.5) * 2 * jitter * Math.sqrt(Math.sin(Math.PI * u)), along = u + (hash01(j, seed + 1) - 0.5) * 0.4 / n
    pts.push([a[0] + dx * along + px * off, a[1] + dy * along + py * off])
  }
  pts.push([b[0], b[1]])
  return pts
}

// 1回ぶんの稲妻。seed＝どこに出るか（1回のあいだ同じ）・shape＝折れ方（stepMs ごとに変わる）・far＝走る長さの倍率
const fire = (edges, c, seed, shape, far = 1) => {
  const a = edges[Math.floor(hash01(seed, 4) * edges.length)]
  let b = null
  if (hash01(seed, 5) >= c.outRate) {
    // ふちからふちへ（近すぎ・遠すぎの点は選ばない）
    for (let t = 0; t < 8 && !b; t++) {
      const q = edges[Math.floor(hash01(seed, 6 + t) * edges.length)], d = Math.hypot(q[0] - a[0], q[1] - a[1])
      if (d >= c.reach[0] && d <= c.reach[1] * far) b = q
    }
  }
  if (!b) {
    // 体の外へ飛び出す
    const ang = Math.atan2(a[3], a[2]) + (hash01(seed, 15) - 0.5) * 1.1, len = lerp(c.out, hash01(seed, 16)) * far
    b = [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len]
  }
  const pts = zigzag(a, b, c.jitter, shape), forks = []
  if (hash01(seed, 17) < c.forkRate) {
    const m = pts[Math.floor(pts.length * (0.35 + 0.3 * hash01(seed, 18)))]
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + (hash01(seed, 19) < 0.5 ? -1 : 1) * (0.5 + 0.5 * hash01(seed, 20))
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * (0.3 + 0.25 * hash01(seed, 21))
    forks.push(zigzag(m, [m[0] + Math.cos(ang) * len, m[1] + Math.sin(ang) * len], c.jitter * 0.6, shape + 3))
  }
  return { pts, forks }
}

// いま強い一発のあいだか → { turn, e（始まってからのミリ秒） } か null。始まる時刻は1回ごとに少しずれる（次の回とは重ならない）
const surgeOf = (c, tMs) => {
  const s = c.surge
  if (!s) return null
  const turn = Math.floor(tMs / s.everyMs), e = tMs - turn * s.everyMs - hash01(turn, 31) * s.everyMs * 0.3
  return e >= 0 && e < s.lenMs ? { turn, e } : null
}
// 強い一発のあいだの体の瞬き（0〜1）：だんだん弱くなりながら、45ミリ秒ごとに明るい・暗いをくり返す
export const surgeFlickAt = (c, tMs) => {
  const on = surgeOf(c, tMs)
  return on ? (1 - on.e / c.surge.lenMs) * (Math.floor(on.e / 45) % 2 ? 0.3 : 1) : 0
}

// いま出ている稲妻 → [{ pts: [[x, y], …], forks: [pts, …], op（濃さ 0〜1）, w（太さの倍率） }]。edges＝いま出ている絵のふちの点・thin＝本数の倍率（軽い表示）
export const crackleAt = (edges, c, tMs, thin = 1) => {
  const arcs = []
  if (!edges?.length) return arcs
  const n = Math.round(c.n * thin)
  for (let i = 0; i < n; i++) {
    const per = lerp(c.everyMs, hash01(i, 1)), u = tMs / per + hash01(i, 2), turn = Math.floor(u), e = (u - turn) * per
    const seed = i * 97 + turn * 131, life = lerp(c.lifeMs, hash01(seed, 3))
    if (e >= life) continue
    const step = Math.floor(e / c.stepMs)
    arcs.push({ ...fire(edges, c, seed, seed + step * 7), op: (1 - (e / life) ** 2) * (0.7 + 0.3 * hash01(step, seed)), w: 0.75 + 0.5 * hash01(seed, 22) })
  }
  const on = surgeOf(c, tMs)
  if (on) {
    const s = c.surge, m = Math.round(s.n * thin)
    for (let j = 0; j < m; j++) {
      const e = on.e - j * ((s.lenMs * 0.6) / Math.max(1, m))
      if (e < 0 || e >= s.lifeMs) continue
      const seed = 5000 + on.turn * 37 + j * 11
      arcs.push({ ...fire(edges, c, seed, seed + Math.floor(e / c.stepMs) * 7, s.far), op: 1 - (e / s.lifeMs) ** 2, w: 1.4 })
    }
  }
  return arcs
}
