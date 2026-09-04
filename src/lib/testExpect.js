// ============================================================
// テスト用の expect（vitest の薄い代わり）
// ------------------------------------------------------------
// このリポジトリのテストは `npm test` ＝ `node --test` で動かす。
// vitest は入れていないので、`import { expect } from 'vitest'` と書いたテストは
// **その1ファイルが丸ごと落ちる**（ERR_MODULE_NOT_FOUND）。
// 落ちたぶんは中身が1つも走らないので、赤いまま放置すると
// 「テストがあるのに守られていない」状態になる。
//
// 直し方は2つあって、
//   ① vitest を入れる … 実行系が2つになるので採らない
//   ② 使っているマッチャだけ用意して node:test で動かす ← こっち
// と決めた（src/v2/lib/steps.test.js も同じやり方）。
//
// expect(値, 説明) の第2引数は vitest と同じく**失敗したときの説明**。
// 足りないマッチャが出てきたらここに足す。
// ============================================================
import assert from 'node:assert/strict'

export const expect = (v, msg) => ({
  toBe: (x) => assert.strictEqual(v, x, msg),
  toEqual: (x) => assert.deepEqual(v, x, msg),
  toBeTruthy: () => assert.ok(v, msg || `${v} は真ではない`),
  toBeFalsy: () => assert.ok(!v, msg || `${v} は偽ではない`),
  toBeLessThan: (x) => assert.ok(v < x, msg || `${v} は ${x} より小さくない`),
  toBeLessThanOrEqual: (x) => assert.ok(v <= x, msg || `${v} は ${x} 以下でない`),
  toBeGreaterThan: (x) => assert.ok(v > x, msg || `${v} は ${x} より大きくない`),
  toBeGreaterThanOrEqual: (x) => assert.ok(v >= x, msg || `${v} は ${x} 以上でない`),
  toMatch: (re) => assert.match(String(v), re instanceof RegExp ? re : new RegExp(re), msg),
  toContain: (x) => assert.ok(v.includes(x), msg || `${x} を含んでいない`),
})
