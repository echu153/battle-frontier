// 歩数の判定の回帰テスト。
// ★別プロジェクト「歩くRPG」(Desktop/walk-rpg) から steps.js ごと持ってきたもの。
//   向こうは vitest、こちらは node:test なので、**テスト本文は原文のまま**動かせるよう
//   使っているマッチャだけ薄く用意してある。steps.js を直したら両方を直すこと。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const expect = (v) => ({
  toBe: (x) => assert.strictEqual(v, x),
  toBeGreaterThan: (x) => assert.ok(v > x, `${v} は ${x} より大きくない`),
  toBeGreaterThanOrEqual: (x) => assert.ok(v >= x, `${v} は ${x} 以上でない`),
  toBeLessThanOrEqual: (x) => assert.ok(v <= x, `${v} は ${x} 以下でない`),
})
import { createStepDetector, MAX_STEP_MS } from './steps.js'

const SAMPLE_HZ = 60
const G = 9.8

/**
 * 波形を detector に流す。
 * @param axis 'z' = 上下方向に揺れる(歩行) / 'x' = 横方向に揺れる(手を振る)
 * @param shape 'sine' = 単純な正弦波 / 'gait' = 二山になる歩行っぽい波
 */
function feed(detector, { hz, seconds, amplitude, axis = 'z', shape = 'sine', startAt = 0 }) {
  const dt = 1000 / SAMPLE_HZ
  const samples = Math.round(seconds * SAMPLE_HZ)
  let steps = 0
  for (let i = 0; i < samples; i++) {
    const t = startAt + i * dt
    const phase = (2 * Math.PI * hz * t) / 1000
    const wave =
      shape === 'gait'
        ? Math.sin(phase) + 0.35 * Math.sin(2 * phase + 0.8) // 踵接地＋蹴り出しの二山
        : Math.sin(phase)
    const a = amplitude * wave
    const acc = axis === 'z' ? { x: 0, y: 0, z: G + a } : { x: a, y: 0, z: G }
    steps += detector.push(acc, t)
  }
  return steps
}

describe('createStepDetector', () => {
  it('毎秒2歩で10秒歩くと、ほぼ20歩を数える', () => {
    const d = createStepDetector()
    const steps = feed(d, { hz: 2, seconds: 10, amplitude: 2.5 })
    expect(steps).toBeGreaterThanOrEqual(18)
    expect(steps).toBeLessThanOrEqual(21)
  })

  it('歩行らしい二山の波形でも二重カウントしない', () => {
    const d = createStepDetector()
    const steps = feed(d, { hz: 2, seconds: 10, amplitude: 2.5, shape: 'gait' })
    expect(steps).toBeGreaterThanOrEqual(18)
    expect(steps).toBeLessThanOrEqual(21)
  })

  it('静止していれば数えない', () => {
    const d = createStepDetector()
    let steps = 0
    for (let i = 0; i < 600; i++) {
      steps += d.push({ x: 0, y: 0, z: G + Math.sin(i) * 0.15 }, i * 16.7)
    }
    expect(steps).toBe(0)
  })

  it('手を小刻みに振るだけ(5Hz)では数えない', () => {
    const d = createStepDetector()
    expect(feed(d, { hz: 5, seconds: 10, amplitude: 4 })).toBe(0)
  })

  it('横方向に振るだけでは数えない（上下動だけを見る）', () => {
    const d = createStepDetector()
    expect(feed(d, { hz: 2, seconds: 10, amplitude: 4, axis: 'x' })).toBe(0)
  })

  it('数回揺らしただけ(1.5秒)では歩行と認めない', () => {
    const d = createStepDetector()
    expect(feed(d, { hz: 2, seconds: 1.5, amplitude: 3 })).toBe(0)
  })

  it('歩き出しの数歩は歩行と確定した時点でまとめて計上される', () => {
    const d = createStepDetector()
    feed(d, { hz: 2, seconds: 6, amplitude: 2.5 })
    // 12歩ぶん歩いた時点で、取りこぼしは1歩以内
    expect(d.count).toBeGreaterThanOrEqual(11)
    expect(d.count).toBeLessThanOrEqual(12)
  })

  it('止まると歩行判定が解ける', () => {
    const d = createStepDetector()
    feed(d, { hz: 2, seconds: 6, amplitude: 2.5 })
    expect(d.isWalking(6000)).toBe(true)
    expect(d.isWalking(6000 + MAX_STEP_MS + 1)).toBe(false)
  })

  it('厳しい設定ほど歩き出しの確定に歩数が要る', () => {
    const short = { hz: 2, seconds: 2.4, amplitude: 3 }
    expect(feed(createStepDetector({ strictness: 'loose' }), short)).toBeGreaterThan(0)
    expect(feed(createStepDetector({ strictness: 'strict' }), short)).toBe(0)
  })

  it('弱すぎる揺れは厳しい設定では拾わない', () => {
    const weak = { hz: 2, seconds: 10, amplitude: 1.2 }
    expect(feed(createStepDetector({ strictness: 'loose' }), weak)).toBeGreaterThan(0)
    expect(feed(createStepDetector({ strictness: 'strict' }), weak)).toBe(0)
  })

  it('壊れた値で落ちない', () => {
    const d = createStepDetector()
    expect(d.push(null, 0)).toBe(0)
    expect(d.push({ x: NaN, y: 0, z: G }, 0)).toBe(0)
    expect(d.push(undefined, 0)).toBe(0)
    expect(d.count).toBe(0)
  })

  it('重力が含まれないデータ(無重力状態)では数えない', () => {
    const d = createStepDetector()
    let steps = 0
    for (let i = 0; i < 600; i++) {
      const t = i * 16.7
      steps += d.push({ x: 0, y: 0, z: 2.5 * Math.sin((2 * Math.PI * 2 * t) / 1000) }, t)
    }
    expect(steps).toBe(0)
  })
})
