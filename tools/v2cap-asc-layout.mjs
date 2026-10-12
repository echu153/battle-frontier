// ============================================================
// v2cap アセンションの盤面の形を作る（段階ごとに1つ）→ src/v2cap/lib/ascLayout.js に書く
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「もっとツリーっぽく」「アイオン2みたいにまばらに配置（○○の道みたいに決まった道がなく、
//   欲しい能力までどのルートで届かせるか）」：
//   ・真ん中の起点から4方向へ枝分かれする木（1方向ぶんの木を作って、90度ずつ回して4つ置く＝どの方向も同じ形）
//   ・新しいマスは「となりに今あるマスが1つだけ」の所にしか置かない＝かたまりにならず、枝が伸びる（まばら）
//   ・となりの方向の木と隣り合った所はつなぐ（方向をまたいで渡れる＝決まった道にならない）
//   ・いちばん遠い枝の先が大マス、ほかの枝の先がスキルマス（全部は取れないので、どの枝を伸ばすかを選ぶ）
//   ・起点からの近さで小マスの強さ（3段）を決める
// ★形を変えると、保存してある「開いたマス」（番号）が別のマスを指す＝変えるときは振ったAPの扱いをユーザーと決める
//
//   node tools/v2cap-asc-layout.mjs           … いちばん良い形を探して絵で見せる（書かない）
//   node tools/v2cap-asc-layout.mjs --write   … src/v2cap/lib/ascLayout.js に書く（今の形と違うときは --force が要る）
//   node tools/v2cap-asc-layout.mjs --seed shoki=12 … その種で作る
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs'

// 段階ごとの大きさ。perQuad … 1方向のマスの数（4方向で初期職56・一次職96）／R … 盤の半径（盤は (2R+1)×(2R+1)）
export const STAGE_SHAPE = {
  shoki:  { perQuad: 14, R: 5, skills: 2 },
  ichiji: { perQuad: 24, R: 7, skills: 2 },
}

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const key = (x, y) => `${x},${y}`
// 1方向目（右向き）の場所：1≦x≦R・0≦y≦R−1。90度ずつ回すと盤を4つに分けられる（真ん中は起点）
const inQ0 = (x, y, R) => x >= 1 && x <= R && y >= 0 && y <= R - 1
// 90度回す（数学の向き）。q 回
const rot = ([x, y], q) => { let p = [x, y]; for (let i = 0; i < q; i++) p = [-p[1], p[0]]; return p }

// 1方向ぶんの木を育てる
const growQ0 = (perQuad, R, rng) => {
  const nodes = [{ x: 1, y: 0, parent: -1 }]
  const occ = new Map([[key(1, 0), 0]])
  // 盤全体（4方向ぶん）で埋まっているか＝1方向目の (x,y) を回したもの
  const occAll = (x, y) => {
    if (x === 0 && y === 0) return true
    for (let q = 0; q < 4; q++) {
      const [a, b] = rot([x, y], (4 - q) % 4)   // 逆に回して1方向目の座標へ
      if (inQ0(a, b, R) && occ.has(key(a, b))) return true
    }
    return false
  }
  let guard = 0
  while (nodes.length < perQuad && guard++ < 10000) {
    const cands = []
    nodes.forEach((n, i) => {
      for (const [dx, dy] of DIRS) {
        const x = n.x + dx, y = n.y + dy
        if (!inQ0(x, y, R) || occ.has(key(x, y))) continue
        // 同じ方向の木では、となりにあるマスが親だけ＝かたまりにしない（枝が伸びる）
        const own = DIRS.filter(([ex, ey]) => occ.has(key(x + ex, y + ey))).length
        if (own !== 1) continue
        // ほかの方向の木と隣り合う所は、方向をまたぐつながりになる（少しだけ・起点の近くは作らない）
        const other = DIRS.filter(([ex, ey]) => occAll(x + ex, y + ey) && !occ.has(key(x + ex, y + ey))).length
        if (other > 0 && Math.hypot(x, y) < 2.5) continue
        const kids = nodes.filter(m => m.parent === i).length
        // 外へ向かうほど・子の少ないマスから伸ばしやすい
        const w = ((1 + Math.hypot(x, y) * 0.35) / (1 + kids * 1.2)) * (other > 0 ? 0.5 : 1)
        cands.push({ i, x, y, w })
      }
    })
    if (!cands.length) return null
    let r = rng() * cands.reduce((t, c) => t + c.w, 0)
    let pick = cands[0]
    for (const c of cands) { r -= c.w; if (r <= 0) { pick = c; break } }
    occ.set(key(pick.x, pick.y), nodes.length)
    nodes.push({ x: pick.x, y: pick.y, parent: pick.i })
  }
  return nodes.length === perQuad ? nodes : null
}

// 盤全体を作る（起点＝0、方向 q の i 番目＝1 + q×perQuad + i）
export const buildLayout = (stage, seed) => {
  const { perQuad, R, skills } = STAGE_SHAPE[stage]
  const q0 = growQ0(perQuad, R, mulberry32(seed))
  if (!q0) return null
  const nodes = [{ id: 0, q: -1, x: 0, y: 0, links: new Set() }]
  for (let q = 0; q < 4; q++) {
    q0.forEach((n, i) => {
      const [x, y] = rot([n.x, n.y], q)
      nodes.push({ id: 1 + q * perQuad + i, q, i, x, y, links: new Set() })
    })
  }
  const at = new Map(nodes.map(n => [key(n.x, n.y), n]))
  const link = (a, b) => { a.links.add(b.id); b.links.add(a.id) }
  // 木のつながり（親と子）・起点と各方向の根
  for (let q = 0; q < 4; q++) {
    q0.forEach((n, i) => {
      const me = nodes[1 + q * perQuad + i]
      link(me, n.parent < 0 ? nodes[0] : nodes[1 + q * perQuad + n.parent])
    })
  }
  // となりの方向の木と隣り合った所はつなぐ（方向をまたいで渡れる）
  let cross = 0
  for (const n of nodes) {
    if (n.q < 0) continue
    for (const [dx, dy] of DIRS) {
      const m = at.get(key(n.x + dx, n.y + dy))
      if (m && m.q >= 0 && m.q !== n.q && !n.links.has(m.id)) { link(n, m); cross++ }
    }
  }
  // 起点からの近さ（つながりをたどった数）
  const dist = new Map([[0, 0]])
  const queue = [0]
  while (queue.length) {
    const id = queue.shift()
    for (const nb of nodes[id].links) if (!dist.has(nb)) { dist.set(nb, dist.get(id) + 1); queue.push(nb) }
  }
  for (const n of nodes) n.d = dist.get(n.id)
  // 1方向目で、大マス（いちばん遠い枝の先）とスキルマス（ほかの枝の先・まんなかくらいの遠さ）を選ぶ。
  //   どれも「行き着く先」にしたいので、方向をまたぐつながりの端・ほかの特別なマスのとなりには置かない
  const kids = (i) => q0.filter(m => m.parent === i).length
  const q0n = nodes.slice(1, 1 + perQuad)
  const crossEnd = (n) => [...n.links].some(id => nodes[id].q >= 0 && nodes[id].q !== n.q)
  const near = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1
  const leaves = q0n.filter(n => kids(n.i) === 0 && !crossEnd(n))
  const maxD = Math.max(...q0n.map(n => n.d))
  const big = [...leaves].sort((a, b) => b.d - a.d || a.i - b.i)[0]
  if (!big) return null
  const target = maxD * 0.55
  const skillAt = []
  for (const n of [...leaves].sort((a, b) => Math.abs(a.d - target) - Math.abs(b.d - target) || a.i - b.i)) {
    if (n === big || near(n, big) || skillAt.some(s => near(s, n))) continue
    if (skillAt.length < skills) skillAt.push(n)
  }
  if (skillAt.length < skills) return null
  // 小マスの3段：起点からの近さで分ける（数がだいたい同じになる境目）
  const ds = q0n.filter(n => n !== big && !skillAt.includes(n)).map(n => n.d).sort((a, b) => a - b)
  const t1 = ds[Math.floor(ds.length / 3) - 1]
  const t2 = ds[Math.floor((ds.length * 2) / 3) - 1]
  const roleOf = (i) => (i === big.i ? 'big' : skillAt[0].i === i ? 'skill1' : skillAt[1]?.i === i ? 'skill2' : 'stat')
  const out = nodes.map(n => ({
    id: n.id, q: n.q, x: n.x, y: n.y, d: n.d,
    role: n.q < 0 ? 'start' : roleOf(n.i),
    tier: n.q < 0 ? 0 : n.d <= t1 ? 0 : n.d <= t2 ? 1 : 2,
    links: [...n.links].sort((a, b) => a - b),
  }))
  return { stage, seed, R, perQuad, cross: cross / 2 / 4, maxD, leaves: leaves.length, nodes: out }
}

// 形の良さ（大きいほど良い）：枝が長い・枝の先が多すぎず少なすぎず・方向をまたぐつながりが1〜2本・盤を広く使う
const scoreOf = (L) => {
  if (!L) return -Infinity
  const q0 = L.nodes.filter(n => n.q === 0)
  const xs = q0.map(n => n.x), ys = q0.map(n => n.y)
  const spread = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1)
  const leafGood = -Math.abs(L.leaves - (L.perQuad >= 20 ? 6 : 4))
  const crossGood = L.cross >= 1 && L.cross <= 2 ? 3 : L.cross === 0 ? -4 : -2
  const big = q0.find(n => n.role === 'big')
  const skillD = q0.filter(n => n.role.startsWith('skill')).map(n => n.d)
  const apart = Math.min(...skillD.map(d => big.d - d))   // 大マスとスキルマスの遠さの差（同じ枝でまとめて取れないように）
  return L.maxD * 1.5 + leafGood * 2 + crossGood * 2 + spread * 0.08 + Math.min(apart, 4)
}

// 絵（1マス＝2文字。つながりは ─ │ で）
export const drawLayout = (L) => {
  const R = L.R
  const W = (2 * R + 1) * 2 - 1
  const grid = Array.from({ length: W }, () => Array(W).fill(' '))
  // 画面の向き：1方向目（右向きに育てた木）を上へ。画面の (sx, sy) ＝ (y, −x)
  const sc = (n) => [n.y + R, -n.x + R]
  const mark = { start: '★', big: '◆', skill1: '●', skill2: '●', stat: '○' }
  const byId = new Map(L.nodes.map(n => [n.id, n]))
  for (const n of L.nodes) {
    const [sx, sy] = sc(n)
    grid[sy * 2][sx * 2] = mark[n.role]
    for (const id of n.links) {
      const m = byId.get(id)
      const [mx, my] = sc(m)
      if (mx === sx) grid[Math.min(sy, my) * 2 + 1][sx * 2] = '│'
      else grid[sy * 2][Math.min(sx, mx) * 2 + 1] = '─'
    }
  }
  return grid.map(r => r.join('').replace(/\s+$/, '')).join('\n')
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/v2cap-asc-layout.mjs')) {
  const fixed = Object.fromEntries((process.argv.find(a => a.startsWith('--seed'))
    ? process.argv[process.argv.indexOf('--seed') + 1] : '').split(',').filter(Boolean).map(s => s.split('=')).map(([k, v]) => [k, Number(v)]))
  const out = {}
  for (const stage of Object.keys(STAGE_SHAPE)) {
    let best = null
    const seeds = fixed[stage] !== undefined ? [fixed[stage]] : Array.from({ length: 20000 }, (_, i) => i + 1)
    for (const s of seeds) {
      const L = buildLayout(stage, s)
      const sc = scoreOf(L)
      if (L && (!best || sc > best.sc)) best = { L, sc }
    }
    const L = best.L
    out[stage] = L
    console.log(`== ${stage}：種${L.seed}・マス${L.nodes.length - 1}・いちばん遠い${L.maxD}・枝の先${L.leaves}・方向をまたぐつながり${L.cross}`)
    console.log(drawLayout(L))
  }
  if (process.argv.includes('--write')) {
    const lines = [
      '// ★tools/v2cap-asc-layout.mjs が作ったファイル（手で書き換えない）。アセンションの盤面の形（段階ごと）',
      '// 【確定】2026-10-13 ユーザー指示「もっとツリーっぽく」「アイオン2みたいにまばらに配置（決まった道がなく、欲しい能力までどのルートで届かせるか）」',
      '// id … 0＝起点・1〜＝マス／q … 方向（0上・1右・2下・3左。−1は起点）／x,y … 盤の座標（数学の向き）／d … 起点からのつながりの数／',
      '// role … start・stat・skill1・skill2・big／tier … 小マスの段（0〜2）／links … つながっているマス',
      '// ⚠形を変えると保存した「開いたマス」（番号）が別のマスを指す＝変えるときは振ったAPの扱いをユーザーと決める',
      'export const ASC_LAYOUT = {',
      ...Object.values(out).map(L => [
        `  ${L.stage}: { seed: ${L.seed}, R: ${L.R}, perQuad: ${L.perQuad}, nodes: [`,
        ...L.nodes.map(n => `    { id: ${n.id}, q: ${n.q}, x: ${n.x}, y: ${n.y}, d: ${n.d}, role: '${n.role}', tier: ${n.tier}, links: [${n.links.join(', ')}] },`),
        '  ] },',
      ].join('\n')),
      '}',
      '',
    ]
    // ★今の形と違うときは --force が無いと書かない（形が変わると、保存した「開いたマス」が別のマスを指すため）
    const file = new URL('../src/v2cap/lib/ascLayout.js', import.meta.url)
    const next = lines.join('\n')
    let now = ''
    try { now = readFileSync(file, 'utf8').replace(/\r\n/g, '\n') } catch { now = '' }
    if (now && now !== next && !process.argv.includes('--force')) {
      console.log('⚠ 今の形（ascLayout.js）と違います。保存した「開いたマス」がずれるので書きませんでした。変えてよいとユーザーと決めたら --force')
      process.exitCode = 1
    } else {
      writeFileSync(file, next)
      console.log(now === next ? '今の形と同じでした' : 'src/v2cap/lib/ascLayout.js に書きました')
    }
  }
}
