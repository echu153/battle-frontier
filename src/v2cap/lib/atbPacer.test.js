// v2cap の ATB 戦闘の画面を更新する回数（lib/atbPacer.js）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DRAW_MS, SLOW_DRAW_MS, SLOW_CHECK_MS, SLOW_GAP_MS, atbLevelOf, newAtbPacer } from './atbPacer.js'

// fps コマの画面で sec 秒まわして、更新した回数を返す
const run = (p, fps, sec, t0 = 0) => {
  let n = 0
  for (let i = 0; i < fps * sec; i++) if (p.due(t0 + (i * 1000) / fps)) n += 1
  return n / sec
}

test('【確定】2026-10-31 戦闘の更新は1秒60回まで（ユーザー「60がいい」）：画面が速くても60回・60コマの画面は毎コマ', () => {
  for (const fps of [60, 120, 144, 165, 240]) {
    const rate = run(newAtbPacer({ level: 0 }), fps, 10)
    assert.ok(rate >= 57 && rate <= 62, `${fps}コマの画面で1秒${rate}回`)
  }
})

test('【確定】2026-10-31 間に合わない端末は段階を下げる（ユーザー「30回に落としたって出る、大技の時はそれよりも下がる感じ」）：ふつう→軽い表示→軽い表示で30回・次の戦闘も同じ段階から・止まっていたぶんは数えない', () => {
  // 1秒30コマしか出ない端末
  const store = { level: 0 }
  const p = newAtbPacer(store)
  assert.equal(p.ms, DRAW_MS)
  run(p, 30, (SLOW_CHECK_MS / 1000) * 1.2)
  assert.equal(p.level, 1, 'まず軽い表示')
  assert.equal(p.ms, DRAW_MS, '回数はまだ60回まで')
  run(p, 30, (SLOW_CHECK_MS / 1000) * 1.2, 5000)
  assert.equal(p.level, 2, 'それでも足りなければ30回')
  assert.equal(p.ms, SLOW_DRAW_MS)
  assert.equal(newAtbPacer(store).ms, SLOW_DRAW_MS, '次の戦闘も30回から')
  assert.ok(Math.abs(run(newAtbPacer(store), 60, 10) - 30) <= 2, '60コマの画面でも30回')
  // 速い端末は下がらない
  const fast = { level: 0 }
  const f = newAtbPacer(fast)
  run(f, 60, 20)
  assert.equal(f.level, 0)
  // スマホは軽い表示から始めて、間に合えばそのまま60回
  const phone = { level: 1 }
  const ph = newAtbPacer(phone)
  run(ph, 60, 20)
  assert.equal(ph.level, 1)
  assert.equal(ph.ms, DRAW_MS)
  // 裏のタブから戻った（長く空いた）だけでは下がらない
  const back = { level: 0 }
  const b = newAtbPacer(back)
  run(b, 60, 1)
  b.due(1000 + SLOW_GAP_MS * 5)
  run(b, 60, 3, 1000 + SLOW_GAP_MS * 5 + 17)
  assert.equal(b.level, 0)
  // 1秒に数コマしか来ない（画面が隠れている）あいだも下げない
  const hidden = { level: 0 }
  const h = newAtbPacer(hidden)
  run(h, 3, 10)
  assert.equal(h.level, 0)
  // 段階が決まっていなければ端末から決める（テストの環境は画面が無い＝ふつう）
  assert.equal(atbLevelOf({ level: null }), 0)
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
  assert.match(stage, /transition:'transform 50ms linear'/, 'ゲージは計算の刻み（0.05秒）のあいだをなめらかに')
  // 実際の更新の回数は試し撃ち（開発用）にだけ出す＝本物のスマホで読める
  assert.match(fight, /\{dev && <span>更新 \{drawRate\.current\.rate\}回\/秒（最低/)
})
