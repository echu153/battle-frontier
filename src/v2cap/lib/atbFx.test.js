// v2cap の ATB戦闘の見た目の動き（記録 → 踏み込み・被弾・数字）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hitReactOf, HIT_REACT_SEC, fxEventsOf, scheduleFx, splitHits, lastHitAtOf, lungeOf, shakeOf, LUNGE_SEC, HIT_SEC, skillBannerAt, BANNER_SEC, RAGE_BANNER_SEC, BANNER_IN, BANNER_OUT, popTextOf, popScaleOf, popLeftOf, popTopOf, MISS_TEXT, CRIT_TEXT } from './atbFx.js'
import { endTelopOf, LOSE_DELAY_MS } from './atbTelop.js'

const stage = readFileSync(new URL('../components/V2capAtbStage.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('【確定】2026-10-31 浮かぶ文字（ユーザー「当たらなかったらMissとかにして」「クリティカルになったら英語でクリティカルって表示されるようにして」）：外れは Miss・クリティカルは数字の上に Critical!', () => {
  assert.equal(MISS_TEXT, 'Miss')
  assert.equal(CRIT_TEXT, 'Critical!')
  assert.equal(popTextOf({ kind: 'miss' }), 'Miss')
  assert.equal(popTextOf({ kind: 'hit', amount: 12345, crit: true }), '12,345', '数字は数字のまま（Critical! は上の行）')
  assert.equal(popTextOf({ kind: 'heal', amount: 200 }), '+200')
  assert.equal(popTextOf({ kind: 'mp', amount: 300 }), '+300', 'MPポーション')
  assert.equal(popTextOf({ kind: 'tick', amount: 55 }), '55')
  // クリティカルだけ大きく出て、すぐ元の大きさへ
  assert.equal(popScaleOf({ kind: 'hit', crit: true }, 0), 1.5)
  assert.ok(popScaleOf({ kind: 'hit', crit: true }, 0.06) > 1 && popScaleOf({ kind: 'hit', crit: true }, 0.06) < 1.5)
  assert.equal(popScaleOf({ kind: 'hit', crit: true }, 0.2), 1)
  assert.equal(popScaleOf({ kind: 'hit', crit: false }, 0), 1)
  assert.equal(popScaleOf({ kind: 'miss' }, 0), 1)
  // 毒・出血などの数字は横へずらす（本番の幅375で「Critical!」の上に出血の数字が重なって読めなかった）
  assert.equal(popLeftOf({ kind: 'hit', crit: true }), 50)
  assert.equal(popLeftOf({ kind: 'miss' }), 50)
  assert.ok(popLeftOf({ kind: 'tick' }) > 70)
  // 舞台：クリティカルの行を出す・前の「数字のうしろの !」はやめた・大技の光（zIndex 4）より手前
  assert.match(stage, /\{f\.crit && <span style=\{\{ display:'block', fontSize:'14px' \}\}>\{CRIT_TEXT\}<\/span>\}/)
  assert.doesNotMatch(stage, /f\.crit \? '!' : ''/)
  assert.match(stage, /key=\{`\$\{f\.t0\}-\$\{i\}`\} style=\{\{ position:'absolute', zIndex: 5, left:`\$\{popLeftOf\(f\)\}%`,/)
})

test('【確定】2026-10-31 ユーザー「回避されてもモーションは継続するようにして」：外れても当たる絵を出す（舞台）・外れた攻撃は受ける側を揺らさない（hit の印が無い）', () => {
  assert.match(stage, /if \(\(kind === 'hit' \|\| kind === 'cut'\) && now >= tHit - lead \/ 1000\) \{/)
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

test('【確定】2026-11-01 多段の合計を1発ごとに分ける（splitHits）：足すと合計と同じ・外れは null・軽減されたぶんも割合で分ける', () => {
  assert.deepEqual(splitHits(300, [{ d: 100, crit: false }, { d: 200, crit: true }]), [{ amount: 100, crit: false }, { amount: 200, crit: true }])
  // 防御で半分になった合計（端数は最後に当たった発へ）
  const half = splitHits(151, [{ d: 150, crit: false }, { d: 151, crit: false }])
  assert.equal(half[0].amount + half[1].amount, 151)
  assert.ok(Math.abs(half[0].amount - half[1].amount) <= 1)
  // 片方だけ当たった：外れは null・当たった発が合計ぜんぶ
  assert.deepEqual(splitHits(90, [null, { d: 120, crit: false }]), [null, { amount: 90, crit: false }])
  assert.deepEqual(splitHits(90, [{ d: 120, crit: true }, null]), [{ amount: 90, crit: true }, null])
  assert.deepEqual(splitHits(0, [null, null]), [null, null])
  // どの分け方でも足すと合計
  for (const [total, ds] of [[1, [3, 3]], [7, [1, 1, 1]], [1000, [333, 1, 999]], [5, [0, 7]]]) {
    const out = splitHits(total, ds.map(d => ({ d, crit: false })))
    assert.equal(out.reduce((s, h) => s + h.amount, 0), total, `${total}：${ds}`)
  }
})

test('【確定】2026-11-01 ユーザー「黒翼烈風は鈍足じゃなくて2回の多段ヒット」：絵に1発ごとの時刻がある技は、数字と Miss を1発ごとに届く時刻へ（クリティカルも1発ごと・合計の数字は出ない）', () => {
  const motion = { impactMs: 1000, strikes: [{ atMs: 0 }, { atMs: 400 }] }
  const run = (l) => scheduleFx(fxEventsOf([{ side: 'ボス', type: 'skill', skill: '黒翼烈風', of: 2, ...l }], '自分', 'ボス').map(e => (e.kind === 'act' ? { ...e, motion } : e)), 10, { b: (e) => e.motion.impactMs / 1000 })
  const brief = (ev) => ev.filter(e => e.kind !== 'act').map(e => [e.kind, e.side, e.amount ?? null, +e.t0.toFixed(3), e.strike, !!e.crit])
  // 2発とも当たった
  assert.deepEqual(brief(run({ hits: 2, damage: 300, crit: true, perHit: [{ d: 100, crit: false }, { d: 200, crit: true }] })),
    [['hit', 'a', 100, 11, 0, false], ['hit', 'a', 200, 11.4, 1, true]])
  // 1発目だけ当たった・2発目だけ当たった（1発ごとに外れる）
  assert.deepEqual(brief(run({ hits: 1, damage: 120, perHit: [{ d: 120, crit: false }, null] })), [['hit', 'a', 120, 11, 0, false], ['miss', 'a', null, 11.4, 1, false]])
  assert.deepEqual(brief(run({ hits: 1, damage: 120, perHit: [null, { d: 120, crit: false }] })), [['miss', 'a', null, 11, 0, false], ['hit', 'a', 120, 11.4, 1, false]])
  // 2発とも外れた
  assert.deepEqual(brief(run({ hits: 0, damage: 0, perHit: [null, null] })), [['miss', 'a', null, 11, 0, false], ['miss', 'a', null, 11.4, 1, false]])
  // バリアで全部消えた＝今までどおり何も出ない・端数で片方が0になった発は出さない
  assert.deepEqual(brief(run({ hits: 2, damage: 0, perHit: [{ d: 100, crit: false }, { d: 100, crit: false }] })), [])
  assert.deepEqual(brief(run({ hits: 2, damage: 1, perHit: [{ d: 100, crit: false }, { d: 100, crit: false }] })), [['hit', 'a', 1, 11.4, 1, false]])
  // 名前の帯は act のまま1回（技の名前が2回出ない）
  assert.equal(run({ hits: 2, damage: 300, perHit: [{ d: 100, crit: false }, { d: 200, crit: false }] }).filter(e => e.kind === 'act').length, 1)
  // 技の動きの中で節目のバフや毒の数字（act のあと）は今までどおり1回目が届く時刻
  const after = scheduleFx([{ kind: 'act', side: 'b', motion }, { kind: 'hit', side: 'a', each: [{ amount: 1, crit: false }, { amount: 2, crit: false }] }, { kind: 'tick', side: 'b', amount: 5 }], 10, { b: 1 })
  assert.deepEqual(after.map(e => [e.kind, +e.t0.toFixed(3)]), [['act', 10], ['hit', 11], ['hit', 11.4], ['tick', 11]])
})

test('【確定】2026-11-01 絵に1発ごとの時刻がない多段（自分の多段・ドット絵版のボス）は今までどおり合計を1つ', () => {
  const log = [{ side: '自分', type: 'skill', skill: '三連', hits: 2, of: 3, damage: 300, crit: true, perHit: [{ d: 100, crit: false }, null, { d: 200, crit: true }] }]
  const ev = scheduleFx(fxEventsOf(log, '自分', 'ボス'), 10, { a: 0.3 })
  assert.deepEqual(ev.filter(e => e.kind === 'hit').map(e => [e.amount, e.crit, +e.t0.toFixed(3), e.strike]), [[300, true, 10.3, undefined]])
  const miss = scheduleFx(fxEventsOf([{ ...log[0], hits: 0, damage: 0, perHit: [null, null, null] }], '自分', 'ボス'), 10)
  assert.deepEqual(miss.map(e => e.kind), ['act', 'miss'], 'Miss も1つ')
  // 絵の1発ごとの数と違う（技の回数を変えて絵を直し忘れた）ときも合計を1つ
  const two = scheduleFx([{ kind: 'act', side: 'a', motion: { strikes: [{ atMs: 0 }, { atMs: 400 }] } }, ...fxEventsOf(log, '自分', 'ボス').slice(1)], 10)
  assert.deepEqual(two.filter(e => e.kind === 'hit').map(e => e.amount), [300])
})

test('【確定】2026-11-01 止めの一撃のあとのテロップは、いちばんあとの数字が出てから（多段の2発目まで待つ・2発目が外れなら1発目）', () => {
  const motion = { strikes: [{ atMs: 0 }, { atMs: 420 }] }
  const fx = (each) => scheduleFx([{ kind: 'act', side: 'b', motion }, { kind: 'hit', side: 'a', amount: 1, each }], 10, { b: 1 })
  const both = fx([{ amount: 5, crit: false }, { amount: 5, crit: false }]), lastMiss = fx([{ amount: 5, crit: false }, null])
  assert.ok(Math.abs(lastHitAtOf(both, 'a', 10) - 11.42) < 1e-9)
  assert.ok(Math.abs(lastHitAtOf(lastMiss, 'a', 10) - 11) < 1e-9)
  const lost = { a: { hp: 0 }, b: { hp: 100 }, winner: 'b' }
  const t = endTelopOf(lost, both, 10000)
  assert.equal(t.kind, 'lose')
  assert.ok(Math.abs(t.at - (11420 + LOSE_DELAY_MS)) < 1e-6, '2発目の数字が出てから')
})

test('【確定】2026-11-01 多段の数字の置き場所（popLeftOf・popTopOf）：左右に振る・あとの数字が前の数字に重ならない・並びの番号で跳ねない', () => {
  const s0 = { kind: 'hit', strike: 0 }, s1 = { kind: 'hit', strike: 1 }
  assert.ok(popLeftOf(s0) < 50 && popLeftOf(s1) > 50, '左右に分かれる')
  assert.ok(popLeftOf({ kind: 'miss', strike: 1 }) === popLeftOf(s1), 'Miss も同じ所')
  assert.ok(popLeftOf(s1) < popLeftOf({ kind: 'tick' }), '毒や出血の数字にはぶつからない')
  assert.equal(popTopOf(s1, 0.3, 0), popTopOf(s1, 0.3, 1), '前の数字が消えても跳ねない')
  // 2発目が出た瞬間（0.42秒後・POP_SEC＝1秒）、1発目はもう上にいる
  const gap = 0.42
  assert.ok(popTopOf(s1, 0, 1) - popTopOf(s0, gap, 0) >= 15, '段が離れている')
  // ふつうの文字は今までどおり並びで段をずらす
  assert.equal(popTopOf({ kind: 'hit' }, 0, 0), 30)
  assert.equal(popTopOf({ kind: 'hit' }, 0.5, 1), 30 - 13 - 14)
  assert.match(stage, /top:`\$\{popTopOf\(f, a, i\)\}%`/)
  // 舞台：飛ぶ絵1枚が1発（その発の時刻に、その発の場所へ届く）・当たる絵は1発ごとに1枚
  assert.match(stage, /kind === 'hit' \? m\.strikes \|\| ONE_STRIKE : kind === 'cut' \? ONE_STRIKE : \[\]/)
  assert.match(stage, /landMs = m\.strikes \? st\.atMs : launchMs/)
  assert.match(stage, /x: from\.x \+ \(spot\.x - from\.x\) \* q/)
})

test('薬を飲んだとき：飲んだ側が光る・HPは緑の数字・MPは青い数字（技のMP回復と治す技は今までどおり）', () => {
  const fx = (l) => fxEventsOf([{ side: '我', ...l }], '我', '敵')
  assert.deepEqual(fx({ type: 'heal', skill: 'HPポーション', heal: 300 }), [{ kind: 'use', side: 'a', skill: 'HPポーション' }, { kind: 'heal', side: 'a', amount: 300 }])
  assert.deepEqual(fx({ type: 'mpGain', skill: 'MPポーション', mp: 40, item: true }), [{ kind: 'use', side: 'a', skill: 'MPポーション' }, { kind: 'mp', side: 'a', amount: 40 }])
  assert.deepEqual(fx({ type: 'cure', skill: '清めの雫', ail: '毒', item: true }), [{ kind: 'use', side: 'a', skill: '清めの雫' }])
  assert.deepEqual(fx({ type: 'mpGain', skill: '魂喰らい', mp: 10 }), [])
  assert.deepEqual(fx({ type: 'cure', skill: '心身一如', ail: '毒' }), [])
  assert.match(stage, /mp: '#66aaff'/, '舞台の青い数字')
})

test('【確定】2026-11-01 受けた瞬間の動き（ユーザー「ひげきしたときのモーションがしょぼいからもっと本当に喰らってるようにして」）：押される・つぶれる・白く光ってから色が残る・もとへ戻る', () => {
  const f = { kind: 'hit', amount: 100, crit: false, t0: 10 }, HP = 1000
  assert.equal(hitReactOf(null, 10, HP), null)
  assert.equal(hitReactOf(f, 9.99, HP), null, '当たる前は動かない')
  assert.equal(hitReactOf(f, 10 + HIT_REACT_SEC, HP), null, '終わったら戻る')
  const hit = hitReactOf(f, 10.06, HP)
  assert.ok(hit.x < -5, '相手と逆（左）へ押される')
  assert.ok(hitReactOf(f, 10.02, HP).flash > 0.5 && hitReactOf(f, 10.2, HP).flash === 0, 'はじめだけ白く光る')
  assert.ok(hitReactOf(f, 10.08, HP).sy < 1 && hitReactOf(f, 10.08, HP).sx > 1, 'つぶれる')
  assert.ok(Math.abs(hitReactOf(f, 10 + HIT_REACT_SEC - 0.01, HP).x) < 0.5, 'おわりはもとの場所の近く')
  // 大きいダメージ・クリティカルほど強い（小さくても見える）
  const weak = hitReactOf({ ...f, amount: 1 }, 10.06, HP), big = hitReactOf({ ...f, amount: 400 }, 10.06, HP), crit = hitReactOf({ ...f, crit: true }, 10.06, HP)
  assert.ok(weak.x < -5, '小さくても見える')
  assert.ok(big.x < hit.x && crit.x < hit.x)
  // 画面：自分だけ（ボスは揺れのまま）。挑戦と試し撃ちの舞台で使う
  assert.match(stage, /react=\{foeBig\} tone=\{sc\?\.tone\} wrapped=\{sc\?\.wrapped \|\| 0\}/)
  assert.match(stage, /const hr = react \? hitReactOf\(hitMark, now, me\.base\.hp\) : null/)
  assert.ok(!/<Fighter st=\{st\} side="b"[^>]*react/.test(stage), 'ボスの側には付けない')
})

test('【確定】2026-11-01 自分は受けてもグラグラしない（ユーザー「プレイヤーの被ダメージのグラグラモーションはいらない」）：行って戻るだけ', () => {
  const f = { kind: 'hit', amount: 100, crit: false, t0: 10 }, HP = 1000
  // 押された向きから戻り続ける（往復しない）・傾けない・伸びない
  let prev = -Infinity
  for (let h = 0; h < HIT_REACT_SEC; h += 1 / 120) {
    const r = hitReactOf(f, 10 + h, HP)
    assert.ok(r.x >= prev, `${h.toFixed(3)}秒で押し返されている`)
    assert.equal(r.rot, undefined, '傾けない')
    assert.ok(r.sx >= 1 && r.sy <= 1, 'つぶれるだけで伸びない')
    prev = r.x
  }
  // 多段：次の1発の瞬間に元の場所へ戻らない（はじめのコマで押し切る）
  assert.ok(hitReactOf(f, 10, HP).x < -5)
  // 画面：自分の側は細かい揺れを通らない・回さない（ボスの側の揺れはそのまま）
  assert.match(stage, /\(side === 'b' \? shakeOf\(now - lastOf\('hit'\)\) : 0\)/)
  assert.ok(!/rotate/.test(stage.match(/const reactTf = .*/)[0]))
  assert.ok(!/writhe/.test(stage), '巻かれてもがかない')
  assert.ok(!/knock/.test(stage), '押すのは hitReactOf だけ（別に押すと、押す量が途中で切り替わって戻る途中でもう一度跳ねた）')
})
