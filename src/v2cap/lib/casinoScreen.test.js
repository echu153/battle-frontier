// v2cap：賭博場の画面の並び（スクロールしないで遊べる）を固定するテスト（node --test）
// 【2026-10-27】ユーザー指示「スマホのルーレットも、スクロールなしで回せるように詰めて」
//   （同じ日の「イラスト作ったせいでスクロールしないとルーレットとかできなくなった」の続き。アレアの帯の決まりは alea.test.js）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const ROULETTE = read('components/V2capRoulette.jsx')

test('スマホのルーレット：ホイールは回している間だけ画面の真ん中に大きく出す（前は盤の上に 260px で置いていた）', () => {
  assert.ok(ROULETTE.includes("const q = '(max-width: 620px)'"), 'スマホの並びに切り替える幅')
  assert.ok(ROULETTE.includes('if (narrow) setWheelOpen(true)\n    await spinWheel(data.result, 5200)'), '雷のあと、回し始めるときに出す')
  assert.ok(ROULETTE.includes('if (narrow) setTimeout(() => setWheelOpen(false), 1400)'), '出た数字を少し見せてから閉じる')
  assert.ok(ROULETTE.includes("onClick={() => { if (!busy) setWheelOpen(false) }}"), '止まったあとは押しても閉じる')
  // 当たりの演出（CasinoFxLayer の banner＝zIndex 420）より下に出す＝大当たりのときは演出が上に来る
  assert.ok(ROULETTE.includes("position:'fixed', inset:0, zIndex:380"))
  assert.ok(read('components/CasinoFxLayer.jsx').includes("position:'fixed', inset:0, zIndex:420"))
})

test('スマホのルーレット：盤の行は枠ごと26px・出た数字と合計は盤の上の1行・チップと SPIN は1行・ほかのボタンはその下の1行', () => {
  assert.ok(ROULETTE.includes('minHeight: narrow ? 26 : 38,') && ROULETTE.includes("boxSizing: narrow ? 'border-box' : undefined,"), '盤のマスの高さ（前は 30px＋枠）')
  const phone = ROULETTE.slice(ROULETTE.indexOf('if (narrow) {\n    const big'), ROULETTE.indexOf('const wheelSize = 300'))
  assert.ok(phone.includes('{histDots(10, 17)}') && phone.includes('{totalText}'), '上の1行')
  assert.ok(/\{chipBtns\(32\)\}\s*\{spinBtn\(\{ flex:'1 1 auto'/.test(phone), 'チップと SPIN は同じ行')
  assert.ok(phone.includes('{actionBtns}</div>'), '1つ戻す・クリア・前回と同じ・×2 はその下の1行')
  assert.ok(!phone.includes('<Wheel wheelDeg={wheel.w} ballDeg={wheel.b} ballR={wheel.r} result={busy ? null : result} lucky={lucky} size={wheelSize} />'), 'ふだんの並びにホイールを置かない')
})

test('広い画面のルーレットは前のまま（ホイール300pxと盤を横に並べる・チップ38px・SPIN は横いっぱい）', () => {
  const wide = ROULETTE.slice(ROULETTE.indexOf('const wheelSize = 300'))
  assert.ok(wide.includes('size={wheelSize} />') && wide.includes('{histDots(15, 20)}'))
  assert.ok(wide.includes('{chipBtns(38)}') && wide.includes("{spinBtn({ width:'100%', marginTop:'10px' })}"))
  assert.ok(wide.includes("<div style={{ flex:'1 1 360px', minWidth:0 }}>"), '盤のほうは 360px から（ホイールと横に並ぶのは約680px から）')
})
