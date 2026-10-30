// v2cap の ATB 戦闘の画面を更新する回数（lib/atbPacer.js）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DRAW_MS, SLOW_DRAW_MS, SLOW_CHECK_MS, SLOW_GAP_MS, newAtbPacer } from './atbPacer.js'

// fps コマの画面で sec 秒まわして、更新した回数を返す
const run = (p, fps, sec, t0 = 0) => {
  let n = 0
  for (let i = 0; i < fps * sec; i++) if (p.due(t0 + (i * 1000) / fps)) n += 1
  return n / sec
}

test('【確定】2026-10-31 戦闘の更新は1秒60回まで（ユーザー「60がいい」）：画面が速くても60回・60コマの画面は毎コマ', () => {
  for (const fps of [60, 120, 144, 165, 240]) {
    const rate = run(newAtbPacer({ slow: false }), fps, 10)
    assert.ok(rate >= 57 && rate <= 62, `${fps}コマの画面で1秒${rate}回`)
  }
})

test('【確定】2026-10-31 間に合わない端末は30回に落とす：一度落ちたら次の戦闘も30回・止まっていたぶんは数えない', () => {
  // 1秒30コマしか出ない端末
  const store = { slow: false }
  const p = newAtbPacer(store)
  assert.equal(p.ms, DRAW_MS)
  run(p, 30, (SLOW_CHECK_MS / 1000) * 1.5)
  assert.equal(p.ms, SLOW_DRAW_MS, '30回に落ちた')
  assert.equal(store.slow, true)
  assert.equal(newAtbPacer(store).ms, SLOW_DRAW_MS, '次の戦闘も30回から')
  assert.ok(Math.abs(run(newAtbPacer(store), 60, 10) - 30) <= 2, '60コマの画面でも30回')
  // 速い端末は落ちない
  const fast = { slow: false }
  const f = newAtbPacer(fast)
  run(f, 60, 20)
  assert.equal(f.ms, DRAW_MS)
  assert.equal(fast.slow, false)
  // 裏のタブから戻った（長く空いた）だけでは落ちない
  const back = { slow: false }
  const b = newAtbPacer(back)
  run(b, 60, 1)
  b.due(1000 + SLOW_GAP_MS * 5)
  run(b, 60, 3, 1000 + SLOW_GAP_MS * 5 + 17)
  assert.equal(b.ms, DRAW_MS)
  // 1秒に数コマしか来ない（画面が隠れている）あいだも落とさない
  const hidden = { slow: false }
  const h = newAtbPacer(hidden)
  run(h, 3, 10)
  assert.equal(h.ms, DRAW_MS)
})

test('【確定】2026-10-31 戦闘の画面：requestAnimationFrame で更新・裏のタブではタイマーで進める・計算の刻みはそのまま・ゲージと構えは見た目だけなめらかに', () => {
  const fight = readFileSync(new URL('../components/V2capAtbFight.jsx', import.meta.url), 'utf8')
  const stage = readFileSync(new URL('../components/V2capAtbStage.jsx', import.meta.url), 'utf8')
  assert.match(fight, /const pacer = newAtbPacer\(\)/)
  assert.match(fight, /requestAnimationFrame\(loop\)/)
  assert.match(fight, /cancelAnimationFrame\(raf\)/)
  assert.match(fight, /setInterval\(/, '裏のタブでも戦闘が止まらない')
  assert.match(fight, /advance\(s, \(now - last\.current\) \/ 1000\)/, '計算は実時間の差分を渡すまま')
  assert.match(stage, /castMsOf\(me\.cast, st\.t \+ st\.acc\)/)
  assert.match(stage, /castMsOf\(st\.b\.cast, st\.t \+ st\.acc\)/)
  assert.match(stage, /transition:'width 50ms linear'/, 'ゲージは計算の刻み（0.05秒）のあいだをなめらかに')
  // 実際の更新の回数は試し撃ち（開発用）にだけ出す＝本物のスマホで読める
  assert.match(fight, /\{dev && <span>更新 \{drawRate\.current\.rate\}回\/秒/)
})
