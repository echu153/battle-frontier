// ============================================================
// v2cap — 演出の光の粒（キャンバスに描く）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「賭博場の演出めっちゃいい、他のコンテンツにも演出追加してみたい（音はなくていい）」
//   強化（V2capEnhanceFx.jsx）と宝樹のおみくじ（V2capOmikujiFx.jsx）が使う。音は鳴らさない
//   createParticles(canvas) → { converge, burst, rise, fall, shards, mist, rain, clear, destroy }（fall は葉・花びら・羽根）
//   ・座標はキャンバスの中の px（CSS の大きさ）。粒が無くなると描くのを止める
// ============================================================
const TAU = Math.PI * 2
const rand = (a, b) => a + Math.random() * (b - a)
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)]

export function createParticles(canvas) {
  const ctx = canvas.getContext('2d')
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  let W = 0, H = 0
  const fit = () => {
    const r = canvas.getBoundingClientRect()
    W = r.width; H = r.height
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr))
  }
  fit()
  const onResize = () => fit()
  window.addEventListener('resize', onResize)
  let parts = []
  let raf = 0
  let last = 0

  const draw = (p, a) => {
    ctx.save()
    ctx.globalAlpha = a
    ctx.translate(p.x * dpr, p.y * dpr)
    const s = p.size * dpr
    switch (p.shape) {
      case 'dot': {
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s)
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, p.color); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill()
        break
      }
      case 'spark': {
        ctx.globalCompositeOperation = 'lighter'
        const len = Math.min(40, Math.hypot(p.vx, p.vy) * 0.06) * dpr + s
        ctx.rotate(Math.atan2(p.vy, p.vx))
        const g = ctx.createLinearGradient(-len, 0, 0, 0)
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, p.color)
        ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, s * 0.5); ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(0, 0); ctx.stroke()
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, Math.max(1, s * 0.35), 0, TAU); ctx.fill()
        break
      }
      case 'star': {
        ctx.globalCompositeOperation = 'lighter'
        ctx.rotate(p.rot); ctx.fillStyle = p.color
        ctx.beginPath()
        for (let k = 0; k < 8; k++) { const r = (k % 2 ? 0.28 : 1) * s; ctx.lineTo(Math.cos(k * Math.PI / 4) * r, Math.sin(k * Math.PI / 4) * r) }
        ctx.closePath(); ctx.fill()
        break
      }
      case 'leaf': {
        ctx.rotate(p.rot); ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(p.flip))))
        ctx.fillStyle = p.color
        ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.45, 0, 0, TAU); ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(0.6, dpr * 0.6)
        ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke()
        break
      }
      case 'petal': {
        ctx.rotate(p.rot); ctx.scale(1, Math.max(0.2, Math.abs(Math.cos(p.flip))))
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.moveTo(0, -s)
        ctx.bezierCurveTo(s * 0.9, -s * 0.6, s * 0.7, s * 0.6, 0, s)
        ctx.bezierCurveTo(-s * 0.7, s * 0.6, -s * 0.9, -s * 0.6, 0, -s)
        ctx.fill()
        break
      }
      case 'feather': {
        ctx.rotate(p.rot); ctx.scale(1, Math.max(0.25, Math.abs(Math.cos(p.flip))))
        ctx.fillStyle = p.color
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.42, s, 0, 0, TAU); ctx.fill()
        ctx.strokeStyle = 'rgba(200,215,240,0.9)'; ctx.lineWidth = Math.max(0.8, dpr * 0.8)
        ctx.beginPath(); ctx.moveTo(0, -s * 0.95); ctx.lineTo(0, s * 1.25); ctx.stroke()
        break
      }
      case 'shard': {
        ctx.rotate(p.rot); ctx.fillStyle = p.color
        ctx.beginPath(); ctx.moveTo(-s, -s * 0.4); ctx.lineTo(s * 0.8, -s * 0.7); ctx.lineTo(s * 0.3, s); ctx.closePath(); ctx.fill()
        break
      }
      case 'rain': {
        // 雨（2026-10-14 大凶の嵐）：進む向きと逆へ伸びる細い筋
        const v = Math.hypot(p.vx, p.vy) || 1
        const len = p.len * dpr
        const tx = -p.vx / v * len, ty = -p.vy / v * len
        const g = ctx.createLinearGradient(tx, ty, 0, 0)
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, p.color)
        ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, dpr * 0.9); ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(0, 0); ctx.stroke()
        break
      }
      case 'mist': {
        const r = s * (1 + (1 - p.life / p.max) * 0.8)
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
        g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill()
        break
      }
      default: break
    }
    ctx.restore()
  }

  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      p.life -= dt
      if (p.home) {
        // 中心へ吸い込まれる（近づくほど速く）
        const dx = p.tx - p.x, dy = p.ty - p.y
        const d = Math.hypot(dx, dy) || 1
        const acc = p.pull * (1 + 220 / d)
        p.vx += (dx / d) * acc * dt; p.vy += (dy / d) * acc * dt
        p.vx *= 0.96; p.vy *= 0.96
        if (d < 10) p.life = 0
      }
      p.vy += (p.g || 0) * dt
      if (p.drag) { p.vx *= (1 - p.drag * dt); p.vy *= (1 - p.drag * dt) }
      if (p.sway) p.vx += Math.sin(now / 1000 * p.sway + p.phase) * 18 * dt
      p.x += p.vx * dt; p.y += p.vy * dt
      p.rot += (p.vr || 0) * dt
      if (p.flip != null) p.flip += (p.vf || 3) * dt
      if (p.life <= 0 || p.y > H + 60 || p.y < -200 || p.x < -200 || p.x > W + 200) { parts.splice(i, 1); continue }
      const fadeIn = p.fadeIn ? Math.min(1, (p.max - p.life) / p.fadeIn) : 1
      draw(p, Math.min(1, p.life / Math.min(0.6, p.max * 0.5)) * fadeIn * (p.alpha ?? 1))
    }
    raf = parts.length ? requestAnimationFrame(step) : 0
  }
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(step) } }
  const add = (p) => { parts.push({ rot: 0, vr: 0, max: p.life, ...p }); if (parts.length > 900) parts.splice(0, parts.length - 900) }

  return {
    size: () => ({ W, H }),
    // 周りから中心（cx, cy）へ集まる光（強化のため）
    converge(cx, cy, n, { colors = ['#7fd3ff'], r0 = 150, r1 = 230 } = {}) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), r = rand(r0, r1)
        add({ shape: Math.random() < 0.7 ? 'dot' : 'spark', x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
          vx: -Math.sin(a) * rand(40, 120), vy: Math.cos(a) * rand(40, 120), tx: cx, ty: cy, home: true, pull: rand(220, 420),
          size: rand(2, 5), color: pick(colors), life: 2.2, fadeIn: 0.25 })
      }
      kick()
    },
    // 中心から弾ける（成功・大吉）
    burst(cx, cy, n, { colors = ['#ffe680', '#ffffff'], speed = [220, 620], g = 260, shapes = ['spark', 'star', 'dot'], life = 1.6 } = {}) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), v = rand(speed[0], speed[1])
        add({ shape: pick(shapes), x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g, drag: 1.6,
          size: rand(3, 8), color: pick(colors), life: rand(life * 0.6, life), rot: rand(0, TAU), vr: rand(-6, 6) })
      }
      kick()
    },
    // 下から立ちのぼる（光の柱のまわり）
    rise(cx, cy, n, { colors = ['#ffe680'], spread = 60 } = {}) {
      for (let i = 0; i < n; i++) {
        add({ shape: Math.random() < 0.5 ? 'dot' : 'star', x: cx + rand(-spread, spread), y: cy + rand(-10, 40), vx: rand(-20, 20), vy: -rand(80, 240),
          size: rand(2, 5), color: pick(colors), life: rand(0.8, 1.8), rot: rand(0, TAU), vr: rand(-3, 3) })
      }
      kick()
    },
    // 上から降る（葉・花びら・金の葉）
    fall(n, { shape = 'leaf', colors = ['#4fbf7a'], speed = [40, 110], size = [5, 10], x = null } = {}) {
      for (let i = 0; i < n; i++) {
        add({ shape, x: x ? rand(x[0], x[1]) : rand(-20, W + 20), y: rand(-H * 0.5, -10), vx: rand(-25, 25), vy: rand(speed[0], speed[1]), sway: rand(1.2, 2.6), phase: rand(0, TAU),
          size: rand(size[0], size[1]), color: pick(colors), life: rand(5, 8), rot: rand(0, TAU), vr: rand(-2, 2), flip: rand(0, TAU), vf: rand(2, 5) })
      }
      kick()
    },
    // 割れて落ちる（失敗）
    shards(cx, cy, n, { colors = ['#8a93a6', '#c0404a', '#4a5466'] } = {}) {
      for (let i = 0; i < n; i++) {
        const a = rand(-Math.PI, 0), v = rand(120, 380)
        add({ shape: 'shard', x: cx + rand(-30, 30), y: cy + rand(-30, 30), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, g: 900,
          size: rand(3, 8), color: pick(colors), life: rand(1.2, 2), rot: rand(0, TAU), vr: rand(-10, 10) })
      }
      kick()
    },
    // もや（凶・大凶）
    mist(cx, cy, n, { colors = ['rgba(90,40,120,0.35)'], spread = 160 } = {}) {
      for (let i = 0; i < n; i++) {
        add({ shape: 'mist', x: cx + rand(-spread, spread), y: cy + rand(-spread * 0.6, spread * 0.6), vx: rand(-15, 15), vy: rand(-20, 5),
          size: rand(40, 90), color: pick(colors), life: rand(2.5, 4), fadeIn: 0.8, alpha: 0.9 })
      }
      kick()
    },
    // 雨（大凶の嵐）。上から斜めに速く落ちる筋。続けて降らせるときは呼ぶ側が間隔をあけて何度も呼ぶ
    rain(n, { colors = ['rgba(200,180,230,0.55)'], speed = [900, 1300], slant = -0.2, len = [14, 28] } = {}) {
      for (let i = 0; i < n; i++) {
        const vy = rand(speed[0], speed[1])
        add({ shape: 'rain', x: rand(-W * 0.1, W * 1.25), y: rand(-80, -10), vx: vy * slant, vy, len: rand(len[0], len[1]),
          size: 1, color: pick(colors), life: 3 })
      }
      kick()
    },
    clear() { parts = [] },
    destroy() { cancelAnimationFrame(raf); raf = 0; parts = []; window.removeEventListener('resize', onResize) },
  }
}
