// ============================================================
// 積み上げ耐久（ペットのVIT）の当たり具合を測る
//   node tools/v2-pet-stack.mjs
//
// 見たいのは3つ。
//   ・放置    … 何もしないと何個で崩れるか（＝**すぐ崩れてほしい**。0〜1個）
//   ・人      … 反応が遅れる操作でどこまで行くか（＝ここが実戦値）
//   ・上手い人 … 遅れなしの理想操作でどこまで行くか（＝天井）
// 「放置で満点」だと待つだけのゲームになる。逆に「上手い人でも上限に届かない」と
// 上限は無い（青天井）。放置がすぐ崩れ、上手いほど伸び続けるのが正しい形。
// ============================================================
import {
  stackStart, stackStep, stackPlaceSec,
} from '../src/v2/lib/pet.js'

const DT = 1 / 60

// n個積むまでにかかる秒数。1個ごとの間隔は積むほど短くなる
const secOf = (blocks) => {
  let t = 0
  for (let i = 0; i < blocks; i++) t += stackPlaceSec(i)
  return t
}

// 傾きと勢いを見て、倒れる側と逆を押す。delay 秒ぶん遅れて反応する
const play = (rng, delaySec) => {
  let s = stackStart()
  const hist = []
  let input = 0
  for (let i = 0; i < 60 * 300 && !s.over; i++) {
    hist.push({ tilt: s.tilt, vel: s.vel })
    if (delaySec !== null) {
      const seen = hist[Math.max(0, hist.length - 1 - Math.round(delaySec / DT))]
      const aim = seen.tilt + seen.vel * 0.35     // 先読み込みで押す向きを決める
      input = aim > 0.02 ? -1 : aim < -0.02 ? 1 : 0
    }
    s = stackStep(s, DT, input, rng)
  }
  return s.blocks
}

const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

const stat = (label, delay) => {
  const runs = Array.from({ length: 200 }, (_, i) => play(seeded(i + 1), delay))
  runs.sort((a, b) => a - b)
  const avg = runs.reduce((t, v) => t + v, 0) / runs.length
  const med = runs[Math.floor(runs.length / 2)]
  const top = runs[Math.floor(runs.length * 0.9)]
  console.log(
    `${label.padEnd(10)} 平均${avg.toFixed(1).padStart(6)}個  中央${String(med).padStart(3)}個  ` +
    `上位1割${String(top).padStart(3)}個  （${secOf(avg).toFixed(0)}秒）`
  )
  return avg
}

console.log(`上限なし（青天井）。積んだ個数がそのままpt
`)
stat('放置', null)
stat('人(0.30秒)', 0.30)
stat('人(0.20秒)', 0.20)
stat('上手い人', 0)
