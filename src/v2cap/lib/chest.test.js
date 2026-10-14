// v2cap：出撃の宝箱の決まりを固定するテスト（node --test）
// 【確定】2026-10-14 ユーザー指示「出撃して敵を倒した時、装備が落ちなかったとき5%の確率で宝箱を見つけて開けられる」
//   「宝箱を開けるとそのエリアの残骸を「1～10」個」・メッセージは「宝箱を見つけた！○○の残骸×〇を獲得した！」
// 決めるのはサーバー（v2cap_sortie_settle）。サーバーとの突き合わせは v2capsql.test.js
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { CHEST_PCT, CHEST_SCRAP, rollChest, chestText } from './sortie.js'
import { SCRAP_NAMES } from './smith.js'
import { richSegments } from '../../lib/battleLogRich.js'

// 決まった並びの乱数（1回目＝見つけるか・2回目＝中の数）
const seq = (...xs) => { let i = 0; return () => xs[i++] }

test('【確定】ユーザーが決めた数：5%・残骸1〜10個', () => {
  assert.equal(CHEST_PCT, 5)
  assert.deepEqual(CHEST_SCRAP, [1, 10])
})

test('宝箱は5%で見つかり、中の残骸は1〜10を均等に1つ（サーバーと同じ引き方）', () => {
  assert.equal(rollChest(seq(0.0499999, 0)), 1, '5%未満なら見つける')
  assert.equal(rollChest(seq(0.05, 0)), 0, '5%ちょうどから上は見つからない')
  assert.equal(rollChest(seq(0, 0.99999)), 10)
  const got = new Set()
  for (let i = 0; i < 1000; i++) got.add(rollChest(seq(0, i / 1000)))
  assert.deepEqual([...got].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  // たくさん引いて、見つかる割合と中の数のばらつきを見る（決まった乱数）
  let s = 7
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const N = 200000
  const count = Array(11).fill(0)
  for (let i = 0; i < N; i++) count[rollChest(rng)]++
  const found = N - count[0]
  assert.ok(Math.abs(found / N - CHEST_PCT / 100) < 0.003, `見つかった割合 ${(found / N * 100).toFixed(2)}%`)
  for (let k = 1; k <= 10; k++) assert.ok(Math.abs(count[k] / found - 0.1) < 0.012, `${k}個 ${(count[k] / found * 100).toFixed(1)}%`)
})

test('ログはユーザーの文のまま「宝箱を見つけた！○○の残骸×〇を獲得した！」（15エリアの残骸）', () => {
  assert.equal(chestText(1, 3), '宝箱を見つけた！新緑の残骸×3を獲得した！')
  assert.equal(chestText(15, 10), '宝箱を見つけた！深海の残骸×10を獲得した！')
  assert.equal(SCRAP_NAMES.length, 15)
  SCRAP_NAMES.forEach((name, i) => assert.equal(chestText(i + 1, 1), `宝箱を見つけた！${name}×1を獲得した！`))
  // 戦闘ログの色分け（技名・ダメージ・回復）に引っかからない＝1行まるごと同じ色で出る
  for (let a = 1; a <= SCRAP_NAMES.length; a++) {
    for (let n = CHEST_SCRAP[0]; n <= CHEST_SCRAP[1]; n++) {
      assert.ok(richSegments(chestText(a, n)).every(x => !x.kind), chestText(a, n))
    }
  }
})

test('出撃の画面は精算の返事の chest（サーバーが決めた中身）だけで出す。画面では宝箱を引かない', () => {
  const src = readFileSync(new URL('../components/V2capSortie.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes('chestText(data.chest.area, data.chest.n)'), '返事のエリアと数で出す')
  assert.ok(src.includes('if (data.chest?.n > 0)'), 'サーバーが前の版（chest が無い）のあいだは出さない')
  assert.ok(!src.includes('rollChest'), '画面で引くと、サーバーが入れた残骸と食い違う')
})
