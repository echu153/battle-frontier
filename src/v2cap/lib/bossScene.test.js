// v2cap のボスの技の派手な演出（lib/bossScene.js）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bossIllustOf } from './bossIllust.js'
import { POUR, SCENE_TOP, pourTimesOf, sceneEndMsOf, sceneAt, castSceneAt, fallAt, stageSceneOf } from './bossScene.js'

const m = bossIllustOf('amaza').motions.deluge
const T = pourTimesOf(m)

test('【確定】2026-10-29 水天葬の演出（ユーザー「水天葬だったらほんとに滝が叩きつけてるようなエフェクトにしてほしい、派手に」）：決まった時刻の区切り・同じ時刻なら同じ絵', () => {
  assert.equal(m.scene.kind, 'pour')
  assert.equal(T.H, m.hitMs)
  assert.equal(T.I, m.impactMs, '叩きつける時刻＝ダメージの時刻')
  assert.equal(T.E, T.I + POUR.pourMs)
  assert.equal(sceneEndMsOf(m), T.end)
  assert.ok(T.end >= T.E + T.T, '演出が終わる時刻は滝が切れたあと')
  for (const ms of [300, T.I + 50, T.E + 100]) assert.deepEqual(sceneAt(m, ms), sceneAt(m, ms))
  // 演出の無い技・始まる前・終わったあとは何も出さない
  for (const k of ['shot', 'sleet', 'bind']) {
    const o = bossIllustOf('amaza').motions[k]
    assert.equal(o.scene, null, `${k} はまだ演出なし`)
    assert.equal(sceneEndMsOf(o), 0)
    assert.equal(sceneAt(o, 500).items.length, 0)
  }
  for (const ms of [-1, T.end]) {
    const s = sceneAt(m, ms)
    assert.equal(s.dim + s.flash + s.items.length, 0)
  }
  assert.equal(bossIllustOf('varuzenoku').motions.doom.scene, null, '黒龍は変えていない')
})

test('【確定】2026-10-29 水天葬：振り下ろすまでに画面が暗くなり、叩きつけた瞬間にいちばん光って大きく揺れ、落ち続けるあいだも小さく揺れる', () => {
  assert.ok(sceneAt(m, 0).dim < 0.05 && Math.abs(sceneAt(m, T.H).dim - POUR.dim) < 1e-9, '暗くなる')
  assert.ok(Math.abs(sceneAt(m, 0, { after: true }).dim - POUR.castDim) < 1e-9, '構えのすぐあとは構えの暗さから（跳ねない）')
  assert.ok(Math.abs(castSceneAt(m, 5000).dim - POUR.castDim) < 1e-9, '構えの終わりの暗さ＝技のはじめの暗さ')
  assert.equal(sceneAt(m, T.E + 600).dim, 0, '落ち終わったら戻る')
  // 光：叩きつけた瞬間のまわりがいちばん強い
  let best = [0, 0]
  for (let ms = 0; ms < T.end; ms += 5) { const f = sceneAt(m, ms).flash; if (f > best[0]) best = [f, ms] }
  assert.ok(best[1] >= T.I && best[1] <= T.I + 60, `いちばん光るのは叩きつけたとき（${best[1]}ms）`)
  // 揺れ：叩きつける前は揺れない・叩きつけたあと大きく・落ちているあいだも少し・落ち終わったら止まる
  const amp = (from, to) => { let a = 0; for (let ms = from; ms < to; ms += 3) { const [x, y] = sceneAt(m, ms).shake; a = Math.max(a, Math.hypot(x, y)) } return a }
  assert.equal(amp(0, T.I), 0)
  assert.ok(amp(T.I, T.I + 150) > 8, '叩きつけて大きく揺れる')
  assert.ok(amp(T.E - 200, T.E) > 1 && amp(T.E - 200, T.E) < 4, '落ちているあいだは小さく揺れ続ける')
  assert.equal(amp(T.E + 200, T.end), 0)
})

test('【確定】2026-10-29 水天葬：水の筋は雲から足元のあいだを流れ落ち（滝の先より下には出ない）・しぶきは地面より上・波紋は足元で広がる・外れたら滝は落ちない', () => {
  for (let ms = T.H; ms < T.E + T.T; ms += 17) {
    const front = ms < T.I ? SCENE_TOP * (1 - (1 - (1 - (ms - T.H) / (T.I - T.H)) ** 2)) : 0
    for (const it of sceneAt(m, ms).items.filter(it => it.t === 'streak' && it.y1 < -0.3)) {
      assert.ok(it.y1 >= SCENE_TOP - 1e-9 && it.y2 <= front + 1e-9, `${ms}ms：筋は雲と滝の先のあいだ`)
      assert.ok(Math.abs(it.x) <= POUR.width / 2 + 1e-9)
    }
  }
  // 流れる：同じ筋が少しあとでは下にある
  const a = sceneAt(m, T.I + 300).items.filter(it => it.t === 'streak'), b = sceneAt(m, T.I + 330).items.filter(it => it.t === 'streak')
  assert.ok(a.length >= 10 && b.length >= 10)
  for (let ms = T.I; ms < T.end; ms += 23) {
    for (const it of sceneAt(m, ms).items.filter(it => it.t === 'drop')) assert.ok(it.y <= 0.02, `${ms}ms：しぶきは地面より上`)
  }
  const at = (ms, t) => sceneAt(m, ms).items.filter(it => it.t === t)
  assert.equal(at(T.I - 1, 'drop').length, 0, '叩きつける前はしぶきなし')
  assert.ok(at(T.I + 200, 'drop').length > 30, '叩きつけてしぶき')
  assert.ok(at(T.I + 30, 'jet').length >= POUR.jets && at(T.I + 200, 'jet').some(it => it.y1 < -0.3), '足元から水しぶきの柱が吹き上がる')
  assert.equal(at(T.I - 1, 'jet').length, 0)
  const r1 = at(T.I + 100, 'ring')[0], r2 = at(T.I + 400, 'ring')[0]
  assert.ok(r2.rx > r1.rx && Math.abs(r1.y) < 0.05, '波紋は足元で広がる')
  assert.ok(at(T.I + 500, 'foam').length === 1, '落ちているあいだ足元が泡立つ')
  // 外れたとき：暗さ・雲・手の光は出るが、滝・光・揺れ・しぶきは無い
  for (let ms = 0; ms < T.end; ms += 11) {
    const s = sceneAt(m, ms, { landed: false })
    assert.ok(s.shake[0] === 0 && s.shake[1] === 0)
    assert.ok(s.flash <= 0.3)
    assert.ok(s.items.every(it => it.t === 'rain' || it.t === 'mote'), `${ms}ms`)
  }
})

test('【確定】2026-10-29 水天葬：構えのあいだから雲の渦が回り（技へつながる）、掲げた手に光が集まり、振り下ろした瞬間にはじける・滝の絵は叩きつけた所でふくらみ、落ち終わると上から切れる', () => {
  const c = castSceneAt(m, 2000)
  assert.ok(c.cloud && c.hand && c.items.some(it => it.t === 'rain') && c.items.some(it => it.t === 'mote' && it.space === 'hand'))
  assert.equal(castSceneAt(bossIllustOf('amaza').motions.shot, 2000).cloud, null)
  // 構えの終わり（5秒）の渦の角度＝構えのすぐあとの技のはじめの角度
  assert.ok(Math.abs(castSceneAt(m, 5000).cloud.spin - sceneAt(m, 0, { after: true }).cloud.spin) < 1e-9)
  // 渦は振り下ろすまでだんだん速く回る
  const sp = (ms) => sceneAt(m, ms + 10).cloud.spin - sceneAt(m, ms).cloud.spin
  assert.ok(sp(1400) > sp(200) * 1.5)
  assert.ok(sceneAt(m, T.H - 10).hand.op > 0.9, '振り下ろすまで手が光る')
  assert.ok(sceneAt(m, T.H + 80).hand.r > sceneAt(m, T.H - 10).hand.r, '振り下ろした瞬間にはじける')
  assert.equal(sceneAt(m, T.H + 200).hand, null)
  // 滝の絵
  assert.equal(fallAt(m, T.H - 1), null)
  assert.ok(fallAt(m, T.I + 130).sx > 1.06, '叩きつけた所で横へふくらむ')
  assert.equal(fallAt(m, T.E - 1).cut, 0)
  assert.ok(fallAt(m, T.E + T.T / 2).cut > 0.3, '落ち終わると上から切れる')
  assert.equal(fallAt(m, T.E + T.T), null)
  assert.equal(fallAt(bossIllustOf('amaza').motions.sleet, 500), null, '氷雨の雨はいままでどおり')
  // 画面ぜんたい：構えと技を合わせる（暗さはいちばん強いもの・揺れは足す）
  const both = stageSceneOf([{ m, ms: T.I + 50 }, { m, ms: T.I + 50 }], { m, ms: 1000 })
  const one = sceneAt(m, T.I + 50)
  assert.equal(both.dim, Math.max(one.dim, castSceneAt(m, 1000).dim))
  assert.ok(Math.abs(both.shake[0] - 2 * one.shake[0]) < 1e-9)
})
