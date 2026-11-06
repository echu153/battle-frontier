// v2cap タカラモチの待機の動きのテスト（node --test）
//   ★止まっているときは立ち絵そのもの／ふたは閉じる向きだけ（開いた所は背景）／コイントスで金貨が飛んで手に戻る・飛んでいるあいだきらめきは消える・
//     受け止めるとぱっと光る／まばたきはときどき・短い・コイントスのあいだはしない／動きはなめらか（コマごとに跳ばない）／
//     部品の絵が全部そろっていて、戦闘の舞台に渡る／切る位置が絵の中／殴られたら金貨がこぼれて床に落ちて消える、を見張る
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { cofferIdleAt, blinkOf, tossClockOf, coinDropsAt, TOSS, COFFER_DROP, COFFER_LID_SQ, COFFER_TOSS_AT, COFFER_TOSS_EVERY, COFFER_TOSS_MS, COFFER_TOSS_UP } from './cofferMotion.js'
import { cofferArtOf, cofferPartsOf, COFFER_CUTS, COFFER_PART_NAMES } from './cofferArt.js'
import { COFFER_ART } from './cofferArtList.js'

const SPAN = 60000   // 1回の戦闘（60秒）

test('【確定】2026-11-07 止まっている形は立ち絵そのもの（ふた・腕・金貨が絵のまま）', () => {
  const m = cofferIdleAt(0)
  assert.equal(m.lid, 1)
  assert.equal(m.arm, 0)
  assert.deepEqual([m.coin.dy, m.coin.sx], [0, 1])
  assert.equal(m.blink, 0)
})

test('【確定】ふたは閉じる向きだけ（開いた所に穴が出ない）・腕と光とまばたきは決まった幅の中', () => {
  for (let t = 0; t < SPAN; t += 7) {
    const m = cofferIdleAt(t)
    assert.ok(m.lid <= 1 && m.lid >= 1 - COFFER_LID_SQ - 1e-9, `t=${t} ふた ${m.lid}`)
    assert.ok(m.arm >= -3.2 && m.arm <= 4.6, `t=${t} 腕 ${m.arm}`)
    assert.ok(m.coin.dy <= 0 && m.coin.dy >= -COFFER_TOSS_UP - 1e-9, `t=${t} 金貨 ${m.coin.dy}`)
    assert.ok(Math.abs(m.coin.sx) <= 1, `t=${t} 金貨の向き`)
    assert.ok(m.glow >= 0 && m.glow <= 1, `t=${t} 光 ${m.glow}`)
    assert.ok(m.blink >= 0 && m.blink <= 1, `t=${t} まばたき ${m.blink}`)
  }
})

test('【確定】コイントス：はじくと金貨が上がって回り、手に戻る。飛んでいるあいだきらめきは消え、受け止めるとぱっと光る', () => {
  const starts = []
  for (let t0 = COFFER_TOSS_AT; t0 < SPAN; t0 += COFFER_TOSS_EVERY) starts.push(t0)
  assert.ok(starts.length >= 8, `60秒で ${starts.length} 回`)
  for (const t0 of starts) {
    assert.equal(tossClockOf(t0 + 500), 500)
    const before = cofferIdleAt(t0 + TOSS.launch - 1), mid = cofferIdleAt(t0 + (TOSS.launch + TOSS.land) / 2), land = cofferIdleAt(t0 + TOSS.land)
    assert.equal(before.coin.dy, 0, 'はじく前は手の中')
    assert.ok(Math.abs(mid.coin.dy + COFFER_TOSS_UP) < 1e-9, `まん中でいちばん上：${mid.coin.dy}`)
    assert.deepEqual([land.coin.dy, land.coin.sx], [0, 1], '受け止めたら元の場所・元の向き')
    let turned = 0
    for (let d = TOSS.launch + 1; d < TOSS.land; d += 5) if (cofferIdleAt(t0 + d).coin.sx < -0.9) turned++
    assert.ok(turned > 0, '飛んでいるあいだに裏返る（回って見える）')
    for (let d = TOSS.launch + 25; d < TOSS.land; d += 10) assert.ok(cofferIdleAt(t0 + d).glint.op < 0.01, `d=${d} 飛んでいるあいだきらめきは消える`)
    assert.ok(land.glint.op > 0.99 && land.glint.s > 1.5, '受け止めた瞬間にぱっと光る')
    for (let d = 0; d < COFFER_TOSS_MS; d += 10) assert.equal(cofferIdleAt(t0 + d).blink, 0, `d=${d} コイントスのあいだはまばたきしない`)
    assert.ok(cofferIdleAt(t0 + TOSS.flick).arm > 4, 'はじくとき腕が上がる')
    assert.ok(cofferIdleAt(t0 + TOSS.dip).arm < -2.5, 'はじく前に沈めてためる')
  }
})

test('【確定】まばたき：ときどき（60秒で10〜25回）・1回は短い（閉じているのは 0.25秒より短い）', () => {
  let n = 0, run = 0, longest = 0, prev = 0
  for (let t = 0; t < SPAN; t += 5) {
    const k = blinkOf(t)
    if (k > 0.5) { run += 5; longest = Math.max(longest, run) } else run = 0
    if (prev <= 0.5 && k > 0.5) n++
    prev = k
  }
  assert.ok(n >= 10 && n <= 25, `60秒で ${n} 回`)
  assert.ok(longest < 250, `いちばん長く閉じていたのは ${longest}ms`)
})

test('【確定】動きはなめらか（16ms ごとに跳ばない）', () => {
  let p = cofferIdleAt(0)
  for (let t = 16; t < SPAN; t += 16) {
    const m = cofferIdleAt(t)
    assert.ok(Math.abs(m.lid - p.lid) < 0.005, `t=${t} ふた`)
    assert.ok(Math.abs(m.arm - p.arm) < 3, `t=${t} 腕 ${p.arm}→${m.arm}`)
    assert.ok(Math.abs(m.coin.dy - p.coin.dy) < 0.02, `t=${t} 金貨`)
    assert.ok(Math.abs(m.glow - p.glow) < 0.06, `t=${t} 光`)
    p = m
  }
})

test('【確定】部品の絵が全部そろっていて、戦闘の舞台に渡る（立ち絵の代わりに部品を読む）', () => {
  const parts = cofferPartsOf()
  assert.ok(parts, '一覧に部品と切り取りがある（tools/v2cap-scarecrow-art.mjs が書く）')
  assert.deepEqual(Object.keys(parts.src).sort(), [...COFFER_PART_NAMES].sort())
  for (const n of COFFER_PART_NAMES) {
    assert.ok(existsSync(new URL(`../../../public/v2cap-art/training/coffer-${n}.webp`, import.meta.url)), `coffer-${n}.webp がある`)
    assert.ok(parts.src[n].endsWith(`?v=${COFFER_ART.parts[n]}`), `${n} の版`)
  }
  const art = cofferArtOf()
  assert.deepEqual(art.parts, parts)
  for (const s of Object.values(parts.src)) assert.ok(art.srcs.includes(s), `${s} を先に読む`)
  assert.equal(art.wobble, true, '殴られたときに傾く動きは残す')
  // 舞台：部品があれば立ち絵の img の代わりに部品を描く
  const stage = readFileSync(new URL('../components/V2capAtbStage.jsx', import.meta.url), 'utf8')
  assert.ok(stage.includes('parts ? <V2capCofferParts parts={parts} tMs={now * 1000} lite={lite} upright={wob}'))
  // こぼれる金貨は攻撃が当たった印だけ（毒などの継続ダメージ tick は入れない）
  assert.ok(stage.includes("hits={mine.filter(f => f.kind === 'hit' && f.t0 <= now).map(f => ({ t0: f.t0 * 1000, crit: !!f.crit }))}"))
  assert.match(stage, /parts=\{foeArt\?\.parts \|\| null\}/)
})

test('【確定】切る位置は元の絵（1254px）の中・目は光の範囲の中・回す点は腕の中', () => {
  const inside = ([x, y]) => x >= 0 && x <= 1254 && y >= 0 && y <= 1254
  for (const k of ['lid', 'rarm', 'larm']) for (const p of COFFER_CUTS[k].poly) assert.ok(inside(p), `${k} ${p}`)
  const [x0, y0, x1, y1] = COFFER_CUTS.face.box
  for (const e of COFFER_CUTS.eyes) assert.ok(e.at[0] > x0 && e.at[0] < x1 && e.at[1] > y0 && e.at[1] < y1, `目 ${e.at}`)
  const xs = COFFER_CUTS.larm.poly.map(p => p[0]), ys = COFFER_CUTS.larm.poly.map(p => p[1])
  const [px, py] = COFFER_CUTS.larm.pivot
  assert.ok(px > Math.min(...xs) && px < Math.max(...xs) && py > Math.min(...ys) && py < Math.max(...ys), '腕を回す点は腕の付け根')
  assert.ok(COFFER_CUTS.lid.pivotY > 560 && COFFER_CUTS.lid.pivotY < 640, 'ふたはちょうつがいの高さへ閉じる')
})

test('【確定】2026-11-07 殴られたら金貨がこぼれる：口から上へ飛び出し、床に落ちてはね、寝て止まってから消える（クリティカルは多め・軽い表示は半分）', () => {
  const h = [{ t0: 10000, crit: false }]
  assert.equal(coinDropsAt(h, 9999).length, 0, '当たる前は出ない')
  assert.equal(coinDropsAt(h, 10000).length, COFFER_DROP.n)
  assert.equal(coinDropsAt([{ t0: 10000, crit: true }], 10000).length, COFFER_DROP.critN)
  assert.equal(coinDropsAt([{ t0: 10000, crit: true }], 10000, { lite: true }).length, Math.ceil(COFFER_DROP.critN / 2))
  // 1枚ずつ：はじめは口の金貨の山の上・まず上がる・床より下へ行かない・寝て止まるのは床の高さ・消える
  for (let k = 0; k < 300; k++) {
    const hk = [{ t0: 5000 + k * 37, crit: true }]
    const at = (dt) => coinDropsAt(hk, hk[0].t0 + dt)
    const up = at(120)
    for (const c of at(0)) {
      assert.ok(c.x >= COFFER_DROP.from[0][0] && c.x <= COFFER_DROP.from[0][1] && c.y >= COFFER_DROP.from[1][0] && c.y <= COFFER_DROP.from[1][1], '口から出る')
      assert.ok(up.find(u => u.key === c.key).y < c.y, '出てすぐは上へ')
    }
    let gone = false
    for (let dt = 0; dt <= 2600; dt += 20) {
      const cs = at(dt)
      for (const c of cs) {
        assert.ok(c.y <= COFFER_DROP.floor[1] + 1e-6, `床より下へ行かない（${c.y}）`)
        if (c.sy < 1) assert.ok(c.y >= COFFER_DROP.floor[0] && c.y <= COFFER_DROP.floor[1], '床に寝る')
      }
      if (!cs.length) { gone = true; assert.ok(dt <= COFFER_DROP.keepMs, `${dt}ms で消える`); break }
    }
    assert.ok(gone, '消える')
  }
  // 印は2.5秒で片付く（components/V2capAtbFight.jsx の POP_SEC + 1.5）＝それより早く消す
  assert.ok(COFFER_DROP.keepMs < 2500)
  assert.deepEqual(coinDropsAt(h, 10400), coinDropsAt(h, 10400), '同じ印なら同じ飛び方')
  const many = Array.from({ length: 20 }, (_, i) => ({ t0: 10000 + i * 50, crit: false }))
  assert.ok(coinDropsAt(many, 11000).length <= COFFER_DROP.maxHits * COFFER_DROP.n, 'こぼすのは新しい8回ぶんまで')
})
