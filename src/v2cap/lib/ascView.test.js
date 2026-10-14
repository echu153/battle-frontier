// v2cap：アセンションの盤面の拡大・移動（ascView.js・2026-10-14 ユーザー指示「マウスのホイールとかでズームインできるようにして」）の回帰テスト
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASC_ZOOM_CELLS, zoomMaxOf, fitView, viewBoxOf, clampView, zoomAt, panBy, toBoard, unitsPerPx, wheelFactorOf, isInView,
} from './ascView.js'

const B = { min: -5.75, max: 5.75 }   // 初期職の盤（R=5・余白0.75）
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e

test('全体（倍率1）は盤の全部が見える・いちばん大きいと横に3マスくらい', () => {
  assert.deepEqual(fitView(B), { k: 1, cx: 0, cy: 0 })
  assert.deepEqual(viewBoxOf(fitView(B), B), { x: -5.75, y: -5.75, w: 11.5 })
  assert.ok(near(viewBoxOf({ k: zoomMaxOf(B), cx: 0, cy: 0 }, B).w, ASC_ZOOM_CELLS))
})

test('倍率は1〜いちばん大きい・盤の外は見せない（全体のときは真ん中に戻す）', () => {
  assert.deepEqual(clampView({ k: 0.3, cx: 3, cy: -2 }, B), { k: 1, cx: 0, cy: 0 })
  assert.equal(clampView({ k: 99, cx: 0, cy: 0 }, B).k, zoomMaxOf(B))
  const v = clampView({ k: 2, cx: 100, cy: -100 }, B)
  const vb = viewBoxOf(v, B)
  assert.ok(near(vb.x + vb.w, B.max) && near(vb.y, B.min), '端に寄せて止まる')
  assert.deepEqual(clampView({ k: NaN, cx: NaN, cy: undefined }, B), { k: 1, cx: 0, cy: 0 })
})

test('ホイールで拡大：マウスの下の盤の点は画面の同じ所に残る', () => {
  const rect = { left: 100, top: 50, width: 460, height: 460 }
  let v = fitView(B)
  for (const [mx, my] of [[300, 200], [520, 480], [130, 90]]) {
    const before = toBoard(v, B, rect, mx, my)
    const next = zoomAt(v, 1.5, before[0], before[1], B)
    const after = toBoard(next, B, rect, mx, my)
    // 端に寄って止まらない限り同じ点（止まったときも盤の外は見せない）
    const vb = viewBoxOf(next, B)
    const clamped = near(vb.x, B.min) || near(vb.y, B.min) || near(vb.x + vb.w, B.max) || near(vb.y + vb.w, B.max)
    if (!clamped) assert.ok(near(after[0], before[0], 1e-6) && near(after[1], before[1], 1e-6), `${mx},${my}`)
    assert.ok(next.k > v.k)
    v = next
  }
  // 縮めていくと全体に戻る
  for (let i = 0; i < 20; i++) v = zoomAt(v, 0.7, 1, 1, B)
  assert.deepEqual(v, fitView(B))
})

test('ドラッグで動かす・1pxあたりの盤の座標・見えているか', () => {
  const rect = { left: 0, top: 0, width: 460, height: 460 }
  const v = { k: 2, cx: 0, cy: 0 }
  assert.ok(near(unitsPerPx(v, B, rect), 11.5 / 2 / 460))
  const moved = panBy(v, 1, -1, B)
  assert.deepEqual(moved, { k: 2, cx: 1, cy: -1 })
  assert.equal(panBy(fitView(B), 3, 3, B).cx, 0, '全体のときは動かない')
  assert.ok(isInView(v, B, 0, 0))
  assert.ok(!isInView(v, B, 5, 5))
})

test('ホイールの向き：上へ回す（deltaY<0）と大きく・行単位でも同じくらい', () => {
  assert.ok(wheelFactorOf(-100) > 1)
  assert.ok(wheelFactorOf(100) < 1)
  assert.ok(near(wheelFactorOf(-3, 1), wheelFactorOf(-48), 1e-12))
  assert.ok(near(wheelFactorOf(100) * wheelFactorOf(-100), 1, 1e-12), '戻すと元の倍率')
})
