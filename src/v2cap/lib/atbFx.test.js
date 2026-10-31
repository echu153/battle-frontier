// v2cap の ATB戦闘の見た目の動き（記録 → 踏み込み・被弾・数字）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fxEventsOf, scheduleFx, lungeOf, shakeOf, LUNGE_SEC, HIT_SEC, skillBannerAt, BANNER_SEC, RAGE_BANNER_SEC, BANNER_IN, BANNER_OUT, popTextOf, popScaleOf, MISS_TEXT, CRIT_TEXT } from './atbFx.js'

const stage = readFileSync(new URL('../components/V2capAtbStage.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('【確定】2026-10-31 浮かぶ文字（ユーザー「当たらなかったらMissとかにして」「クリティカルになったら英語でクリティカルって表示されるようにして」）：外れは Miss・クリティカルは数字の上に Critical!', () => {
  assert.equal(MISS_TEXT, 'Miss')
  assert.equal(CRIT_TEXT, 'Critical!')
  assert.equal(popTextOf({ kind: 'miss' }), 'Miss')
  assert.equal(popTextOf({ kind: 'hit', amount: 12345, crit: true }), '12,345', '数字は数字のまま（Critical! は上の行）')
  assert.equal(popTextOf({ kind: 'heal', amount: 200 }), '+200')
  assert.equal(popTextOf({ kind: 'tick', amount: 55 }), '55')
  // クリティカルだけ大きく出て、すぐ元の大きさへ
  assert.equal(popScaleOf({ kind: 'hit', crit: true }, 0), 1.5)
  assert.ok(popScaleOf({ kind: 'hit', crit: true }, 0.06) > 1 && popScaleOf({ kind: 'hit', crit: true }, 0.06) < 1.5)
  assert.equal(popScaleOf({ kind: 'hit', crit: true }, 0.2), 1)
  assert.equal(popScaleOf({ kind: 'hit', crit: false }, 0), 1)
  assert.equal(popScaleOf({ kind: 'miss' }, 0), 1)
  // 舞台：クリティカルの行を出す・前の「数字のうしろの !」はやめた・大技の光（zIndex 4）より手前
  assert.match(stage, /\{f\.crit && <span style=\{\{ display:'block', fontSize:'14px' \}\}>\{CRIT_TEXT\}<\/span>\}/)
  assert.doesNotMatch(stage, /f\.crit \? '!' : ''/)
  assert.match(stage, /key=\{`\$\{f\.t0\}-\$\{i\}`\} style=\{\{ position:'absolute', zIndex: 5,/)
})

test('【確定】2026-10-31 ユーザー「回避されてもモーションは継続するようにして」：外れても当たる絵を出す（舞台）・外れた攻撃は受ける側を揺らさない（hit の印が無い）', () => {
  assert.match(stage, /if \(kind === 'hit' && now >= tHit - lead \/ 1000\) \{/)
  assert.doesNotMatch(stage, /kind === 'hit' && f\.landed/)
  const ev = scheduleFx(fxEventsOf([{ side: 'ボス', type: 'skill', skill: '黒爪', hits: 0, of: 1, damage: 0 }], '自分', 'ボス'), 10, { b: () => 0.5 })
  assert.deepEqual(ev.map(e => [e.kind, e.side, e.t0]), [['act', 'b', 10], ['miss', 'a', 10.5]], 'Miss は当たるはずの時刻に出る')
})

test('殴った側が踏み込み、受けた側に数字（外れは Miss・クリティカルの印）', () => {
  const ev = fxEventsOf([
    { side: '自分', type: 'normal', hit: true, damage: 120 },
    { side: 'ボス', type: 'skill', skill: '大技', hits: 1, damage: 900, crit: true },
    { side: '自分', type: 'normal', hit: false, damage: 0 },
    { side: '自分', type: 'skill', skill: '吸収', hits: 2, damage: 300, drain: 40 },
  ], '自分', 'ボス')
  assert.deepEqual(ev, [
    { kind: 'act', side: 'a', skill: null },
    { kind: 'hit', side: 'b', amount: 120, crit: false },
    { kind: 'act', side: 'b', skill: '大技' },
    { kind: 'hit', side: 'a', amount: 900, crit: true },
    { kind: 'act', side: 'a', skill: null },
    { kind: 'miss', side: 'b' },
    { kind: 'act', side: 'a', skill: '吸収' },
    { kind: 'hit', side: 'b', amount: 300, crit: false },
    { kind: 'heal', side: 'a', amount: 40 },
  ])
})

test('回復は光って緑の数字・補助技と防御は光るだけ・毒などは揺れない数字・知らない名前は動かない', () => {
  const ev = fxEventsOf([
    { side: '自分', type: 'heal', skill: 'ヒール', heal: 200 },
    { side: 'ボス', type: 'ailTick', ail: '毒', damage: 55 },
    { side: '自分', type: 'buff', skill: '雄叫び' },
    { side: 'だれか', type: 'normal', hit: true, damage: 10 },
    { side: 'ボス', type: 'skill', skill: '補助', hits: 0, damage: 0 },
  ], '自分', 'ボス')
  assert.deepEqual(ev, [
    { kind: 'use', side: 'a', skill: 'ヒール' },
    { kind: 'heal', side: 'a', amount: 200 },
    { kind: 'tick', side: 'b', amount: 55 },
    { kind: 'use', side: 'a', skill: '雄叫び' },
    { kind: 'act', side: 'b', skill: '補助' },
    { kind: 'miss', side: 'a' },
  ])
})

test('踏み込みと揺れは時間がたつと0に戻る', () => {
  assert.equal(lungeOf(0), 0)
  assert.ok(lungeOf(LUNGE_SEC / 2) > 20)
  assert.equal(lungeOf(LUNGE_SEC), 0)
  assert.equal(shakeOf(HIT_SEC), 0)
  assert.equal(shakeOf(-1), 0)
})

test('攻撃の絵がある側は、数字と揺れを当たるコマまで遅らせる（補助技・相手の攻撃は遅らせない）', () => {
  const ev = scheduleFx([
    { kind: 'act', side: 'a' }, { kind: 'hit', side: 'b', amount: 10 }, { kind: 'heal', side: 'a', amount: 2 },
    { kind: 'act', side: 'b' }, { kind: 'miss', side: 'a' },
    { kind: 'use', side: 'a' }, { kind: 'heal', side: 'a', amount: 5 },
  ], 10, { a: 0.2 })
  assert.deepEqual(ev.map(e => e.t0), [10, 10.2, 10.2, 10, 10, 10, 10])
})

test('技ごとに絵が違う側（ボス）は、動きごとに当たるコマまで遅らせる（act の motion を見る）', () => {
  const ev = scheduleFx([
    { kind: 'act', side: 'b', motion: { hitMs: 220 } }, { kind: 'hit', side: 'a', amount: 10 },
    { kind: 'act', side: 'b', motion: { hitMs: 540 } }, { kind: 'hit', side: 'a', amount: 30 },
    { kind: 'act', side: 'b' }, { kind: 'miss', side: 'a' },
  ], 10, { b: (e) => (e.motion ? e.motion.hitMs / 1000 : 0) })
  assert.deepEqual(ev.map(e => +e.t0.toFixed(3)), [10, 10.22, 10, 10.54, 10, 10])
})

test('【確定】2026-10-30 敵が技を使ったら舞台の上に技の名前（ユーザー「敵のスキル発動時はスキル名を上に表示させてほしい、FFみたいに」）：通常攻撃と自分の技は出さない・すぐ出てきて少し残って消える・続けて使ったら新しいほう', () => {
  const ev = scheduleFx(fxEventsOf([
    { side: 'ボス', type: 'skill', skill: '焦熱の吐息', hits: 1, damage: 80 },
  ], '自分', 'ボス'), 10)
  assert.equal(skillBannerAt(ev, 9.99), null, '使う前は出ない')
  const a = skillBannerAt(ev, 10 + BANNER_IN / 2)
  assert.ok(a.name === '焦熱の吐息' && a.op > 0 && a.op < 1 && a.k < 1, 'すぐ出てくる')
  assert.deepEqual(skillBannerAt(ev, 11), { name: '焦熱の吐息', op: 1, k: 1, t0: 10, rage: false })
  const b = skillBannerAt(ev, 10 + BANNER_SEC - BANNER_OUT / 2)
  assert.ok(b.op > 0 && b.op < 1, '終わりに薄れる')
  assert.equal(skillBannerAt(ev, 10 + BANNER_SEC), null, '消える')
  // 通常攻撃（技の名前が無い）・自分の技は出さない
  const plain = scheduleFx(fxEventsOf([{ side: 'ボス', type: 'normal', hit: true, damage: 30 }, { side: '自分', type: 'skill', skill: '影討ち', hits: 1, damage: 50 }], '自分', 'ボス'), 10)
  assert.equal(skillBannerAt(plain, 10.5), null)
  assert.equal(skillBannerAt(plain, 10.5, 'a').name, '影討ち', '向きを変えれば自分の技も取れる（いまは出さない）')
  // 続けて技を使ったら新しいほう
  const two = [...ev, ...scheduleFx(fxEventsOf([{ side: 'ボス', type: 'skill', skill: '黒翼烈風', hits: 1, damage: 90 }], '自分', 'ボス'), 11)]
  assert.equal(skillBannerAt(two, 11.2).name, '黒翼烈風')
  assert.equal(skillBannerAt(two, 10.5).name, '焦熱の吐息')
})

test('【確定】2026-10-30 HPの節目のバフも名前の帯に出す（rage・技より長く・色は画面で変える）・数字は出さない', () => {
  const ev = scheduleFx(fxEventsOf([
    { side: '自分', type: 'skill', skill: '影討ち', hits: 1, damage: 50 },
    { side: 'ボス', type: 'hpBuff', skill: '逆鱗', effect: 'STR+25%・INT+25%' },
  ], '自分', 'ボス'), 10, { a: 0.3 })
  assert.deepEqual(ev.map(e => [e.kind, e.side, +e.t0.toFixed(2)]), [['act', 'a', 10], ['hit', 'b', 10.3], ['rage', 'b', 10.3]], '殴られた数字と同じときに出る')
  assert.equal(skillBannerAt(ev, 10.2), null)
  assert.deepEqual(skillBannerAt(ev, 11), { name: '逆鱗', op: 1, k: 1, t0: 10.3, rage: true })
  assert.ok(skillBannerAt(ev, 10.3 + BANNER_SEC + 0.1).op > 0, '技（1.8秒）より長く残る')
  assert.equal(skillBannerAt(ev, 10.3 + RAGE_BANNER_SEC), null)
})

test('【確定】2026-10-30 構えのあとに技の途中から流す（castSkip・終焉の黒焔）：t0 をそのぶん前へ・数字と揺れの遅れも縮める・名前の帯は動いた時刻から数える・大技の帯は赤と金', () => {
  const m = { impactMs: 3100, big: true }
  const ev = scheduleFx([{ kind: 'act', side: 'b', skill: '終焉の黒焔', motion: m, castSkip: 2100 }, { kind: 'hit', side: 'a', amount: 5 }], 100, { b: (e) => e.motion.impactMs / 1000 })
  assert.ok(Math.abs(ev[0].t0 - 97.9) < 1e-9, '技の頭は2.1秒前')
  assert.ok(Math.abs(ev[1].t0 - 101) < 1e-9, '当たるのは動いてから1秒後')
  const b = skillBannerAt(ev, 100.5, 'b')
  assert.ok(b && b.rage && b.op > 0.9, '動いてすぐ帯が出る（t0 が前にずれても消えない）・大技の色')
  assert.equal(skillBannerAt(ev, 100 + BANNER_SEC + 0.01, 'b'), null, '長さは技のまま')
  // castSkip が無ければ今までどおり
  const ev2 = scheduleFx([{ kind: 'act', side: 'b', skill: '黒爪' }, { kind: 'hit', side: 'a', amount: 5 }], 100, { b: () => 0.5 })
  assert.equal(ev2[0].t0, 100)
  assert.equal(ev2[1].t0, 100.5)
  assert.equal(skillBannerAt(ev2, 100.5, 'b').rage, false)
})
