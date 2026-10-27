// ============================================================
// v2cap 賭博場 — 演出（効果音・画面の光・コイン・当たりの表示）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「中毒性高くなるように、当たったらドーパミンが大量に出るような演出も欲しい」
//   ・効果音は音のファイルを使わず Web Audio で鳴らす（ON/OFF は賭博場の上の 🔊）
//   ・fx(種類, 中身) を呼ぶと CasinoFxLayer.jsx が画面に出す（コイン・紙吹雪・光・揺れ・大きな文字・当たりの段階）
//   ・スマホは振動も（navigator.vibrate がある端末だけ）
// ============================================================

// ===== 画面の演出（CasinoFxLayer が受け取る）=====
const listeners = new Set()
export const fxSubscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
// 種類：'coins' {n, from:'bottom'|'top'|{x,y}} ／ 'confetti' {n} ／ 'flash' {color, ms} ／ 'shake' {ms, power}
//       'popup' {text, color, size, ms, sub} ／ 'banner' {tier, amount, title, sub} ／ 'rays' {color, ms}
export const fx = (type, data = {}) => { for (const fn of listeners) fn(type, data) }
export const vibrate = (pattern) => { try { navigator.vibrate?.(pattern) } catch { /* 振動できない端末 */ } }
export const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// ===== 効果音 =====
let ctx = null
let master = null
let soundOn = true
export const setSoundOn = (on) => { soundOn = !!on }
const ac = () => {
  if (!soundOn) return null
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0.32
      // 大きい音が割れないように
      const comp = ctx.createDynamicsCompressor()
      master.connect(comp); comp.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch { return null }
}
// 1つの音（f→f2 へ動く）。t＝今からの秒
const tone = (c, { f, f2, t = 0, d = 0.12, type = 'sine', v = 0.25, a = 0.004, lp }) => {
  const t0 = c.currentTime + t
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, t0)
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + d)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(v, t0 + a)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
  let out = g
  if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; g.connect(fl); out = fl }
  o.connect(g); out.connect(master)
  o.start(t0); o.stop(t0 + d + 0.05)
}
let noiseBuf = null
const noise = (c, { t = 0, d = 0.1, v = 0.2, type = 'bandpass', f = 2000, q = 1, f2 }) => {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const ch = noiseBuf.getChannelData(0)
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1
  }
  const t0 = c.currentTime + t
  const s = c.createBufferSource(); s.buffer = noiseBuf
  const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + d)
  const g = c.createGain()
  g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
  s.connect(fl); fl.connect(g); g.connect(master)
  s.start(t0); s.stop(t0 + d + 0.05)
}
const play = (fn) => { const c = ac(); if (c) { try { fn(c) } catch { /* 鳴らせないときは黙る */ } } }
const NOTE = (n) => 440 * 2 ** ((n - 69) / 12)   // MIDIの番号 → 周波数

export const sfx = {
  lever: () => play(c => { noise(c, { d: 0.08, v: 0.25, f: 900 }); tone(c, { f: 180, f2: 90, d: 0.12, type: 'triangle', v: 0.3 }) }),
  reelStop: (i = 0) => play(c => { tone(c, { f: 150 - i * 15, f2: 60, d: 0.09, type: 'triangle', v: 0.45 }); noise(c, { d: 0.03, v: 0.18, f: 3000 }) }),
  tick: () => play(c => tone(c, { f: 2200, d: 0.025, type: 'square', v: 0.04 })),
  chip: () => play(c => { noise(c, { d: 0.04, v: 0.25, f: 3500, q: 4 }); tone(c, { f: 1100, d: 0.05, v: 0.08 }) }),
  coin: (i = 0) => play(c => {
    const up = Math.min(12, i)
    tone(c, { f: NOTE(84 + up), d: 0.08, type: 'square', v: 0.07 })
    tone(c, { f: NOTE(91 + up), t: 0.055, d: 0.22, type: 'square', v: 0.07 })
  }),
  // 小さい当たり（ベル・リプレイなど）
  small: () => play(c => { [76, 79, 84].forEach((n, k) => tone(c, { f: NOTE(n), t: k * 0.05, d: 0.14, type: 'triangle', v: 0.18 })) }),
  // 当たりの段階 1〜4（WIN → JACKPOT）。段階が上がるほど長く・厚く
  win: (level = 1) => play(c => {
    const runs = [[72, 76, 79, 84], [72, 76, 79, 84, 88, 91], [67, 72, 76, 79, 84, 88, 91, 96], [60, 64, 67, 72, 76, 79, 84, 88, 91, 96, 100, 103]][Math.max(0, Math.min(3, level - 1))]
    runs.forEach((n, k) => tone(c, { f: NOTE(n), t: k * 0.07, d: 0.25, type: 'square', v: 0.09, lp: 4000 }))
    const end = runs.length * 0.07
    if (level >= 2) [0, 4, 7, 12].forEach(n => tone(c, { f: NOTE(runs.at(-1) - 12 + n), t: end, d: 0.9 + level * 0.3, type: 'sawtooth', v: 0.05, lp: 2500 }))
    if (level >= 3) for (let k = 0; k < 6; k++) noise(c, { t: end + k * 0.12, d: 0.2, v: 0.12, type: 'highpass', f: 6000 })
  }),
  // 大きな告知（CZ・AT・特化）：ドン＋和音
  fanfare: (kind = 'at') => play(c => {
    tone(c, { f: 70, f2: 35, d: 0.6, type: 'sine', v: 0.6 })
    noise(c, { d: 0.35, v: 0.35, type: 'lowpass', f: 1200 })
    const chords = kind === 'cz' ? [[64, 67, 71], [66, 69, 73], [68, 71, 76]]
      : kind === 'toku' ? [[67, 71, 74], [69, 73, 76], [71, 74, 78], [74, 78, 81]]
      : [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79, 84]]
    chords.forEach((ch, k) => ch.forEach(n => tone(c, { f: NOTE(n), t: 0.12 + k * 0.16, d: k === chords.length - 1 ? 1.4 : 0.2, type: 'sawtooth', v: 0.07, lp: 3200 })))
  }),
  // 期待させる音（下から上へ）
  reach: () => play(c => { tone(c, { f: 220, f2: 880, d: 0.7, type: 'sawtooth', v: 0.08, lp: 1800 }); tone(c, { f: 330, f2: 1320, d: 0.7, type: 'triangle', v: 0.06 }) }),
  notice: (level = 1) => play(c => {
    const base = [72, 74, 76, 79, 84][Math.max(0, Math.min(4, level - 1))]
    tone(c, { f: NOTE(base), d: 0.12, type: 'square', v: 0.08 })
    tone(c, { f: NOTE(base + 7), t: 0.09, d: 0.2 + level * 0.05, type: 'square', v: 0.08 })
    if (level >= 3) noise(c, { t: 0.05, d: 0.3, v: 0.15, type: 'highpass', f: 5000 })
  }),
  push: () => play(c => { tone(c, { f: 90, f2: 40, d: 0.5, type: 'sine', v: 0.7 }); noise(c, { d: 0.25, v: 0.4, type: 'lowpass', f: 800 }) }),
  freeze: () => play(c => { tone(c, { f: 55, f2: 28, d: 2.2, type: 'sine', v: 0.8 }); tone(c, { f: 110, f2: 55, d: 1.6, type: 'triangle', v: 0.25 }); noise(c, { d: 1.2, v: 0.25, type: 'lowpass', f: 400 }) }),
  uwanose: (big = false) => play(c => {
    ;[79, 84, 88, 91].forEach((n, k) => tone(c, { f: NOTE(n + (big ? 5 : 0)), t: k * 0.045, d: 0.18, type: 'square', v: 0.09 }))
    tone(c, { f: 60, f2: 40, d: 0.3, v: 0.4 })
  }),
  lose: () => play(c => { tone(c, { f: 330, f2: 160, d: 0.35, type: 'triangle', v: 0.16 }); tone(c, { f: 247, f2: 120, t: 0.12, d: 0.4, type: 'triangle', v: 0.12 }) }),
  flip: () => play(c => noise(c, { d: 0.12, v: 0.25, f: 1200, f2: 4000, q: 2 })),
  deal: () => play(c => noise(c, { d: 0.09, v: 0.2, f: 2500, f2: 900, q: 1.5 })),
  heartbeat: () => play(c => { tone(c, { f: 60, f2: 40, d: 0.18, v: 0.6 }); tone(c, { f: 55, f2: 38, t: 0.2, d: 0.2, v: 0.45 }) }),
  lightning: () => play(c => {
    for (let k = 0; k < 5; k++) noise(c, { t: k * 0.035, d: 0.08, v: 0.35, type: 'highpass', f: 3000 + k * 900 })
    tone(c, { f: 80, f2: 30, t: 0.05, d: 0.5, v: 0.4 })
  }),
  ballTick: () => play(c => tone(c, { f: 3200, d: 0.015, type: 'square', v: 0.025 })),
  ballDrop: () => play(c => { tone(c, { f: 1800, f2: 900, d: 0.08, type: 'triangle', v: 0.12 }); tone(c, { f: 1400, f2: 700, t: 0.1, d: 0.08, type: 'triangle', v: 0.08 }) }),
}

// 当たりの段階の演出をまとめて（banner＋コイン＋紙吹雪＋光＋揺れ＋音＋振動）
//   tier … casino.js の winTierOf の結果。amount … 払い出し。
//   say … banner の上に出すアレア（V2capAlea.jsx の AleaSays・2026-10-27）。無ければ出さない
export const celebrate = (tier, amount, { title, sub, say } = {}) => {
  if (!tier) return
  const level = { win: 1, big: 2, mega: 3, jackpot: 4 }[tier.key] || 1
  sfx.win(level)
  if (level === 1) { fx('coins', { n: 14, from: 'bottom' }); return }
  fx('banner', { tier, amount, title, sub, say })
  fx('coins', { n: [0, 0, 60, 120, 220][level], from: level >= 4 ? 'top' : 'bottom' })
  if (level >= 3) fx('confetti', { n: level === 4 ? 220 : 120 })
  fx('flash', { color: tier.color, ms: level >= 3 ? 700 : 400 })
  fx('rays', { color: tier.color, ms: 1500 + level * 800 })
  if (level >= 3) fx('shake', { ms: 500 + level * 150, power: level * 3 })
  vibrate(level >= 4 ? [80, 60, 80, 60, 200] : level >= 3 ? [60, 40, 120] : [50])
}
