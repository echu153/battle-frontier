// v2cap のボスの技の派手な演出（lib/bossScene.js）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bossIllustOf } from './bossIllust.js'
import { POUR, COIL, SCENE_TOP, FX_TARGET_Y, FX_FEET_Y, FX_HEAD_Y, FX_SKY_Y, pourTimesOf, sceneEndMsOf, sceneAt, castSceneAt, fallAt, coilAt, stageSceneOf } from './bossScene.js'
import { BOSS_ILLUST_DEFS, flutterBandsAt } from './bossIllust.js'
import { BOSS_ILLUST } from './bossIllustList.js'

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
  for (const k of ['shot', 'sleet']) {
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

test('【確定】2026-10-30 滝は水の絵そのものを流す（ユーザー「滝流すモーションが止まってるから躍動感がない、しっかり水が流れるようにしてほしい」）：流れる水の絵は描いた滝の柱の所・上と下がつながる', () => {
  const flow = m.fx.flow, hit = m.fx.hit
  assert.ok(flow.src.includes('il-fx-deluge-flow'))
  const [x, y, w, h] = flow.at
  assert.ok(x > 0 && x + w < hit.w && y >= 0 && h <= hit.h * 0.62, `柱の所は当たる絵の中・上のほう（${flow.at}）`)
  assert.ok(Math.abs(x + w / 2 - hit.w / 2) < hit.w * 0.08, '柱は真ん中')
  assert.ok(flow.h < flow.w * (h / w), '上と下をつなげたぶん短い')
  assert.deepEqual(BOSS_ILLUST.amaza.fx.deluge.flow.at, flow.at)
})

const b = bossIllustOf('amaza').motions.bind
test('【確定】2026-10-30 水縛の帯（ユーザー「水縛りの帯もしょぼい、もっと豪華にして」「紐いらない」）：帯が飛んで届いたら3重の水の輪が巻きついて3回締め上げ、はじけて解ける（手からの水の綱は無い）', () => {
  assert.equal(b.scene.kind, 'coil')
  assert.deepEqual(b.scene.hand, { pt: [54, 251], part: 'armN' }, '綱は手前の手の指先から（飛ぶ絵と同じ）')
  const I = b.impactMs, H = b.hitMs, B = I + COIL.burstMs
  assert.equal(sceneEndMsOf(b), B + 900)
  // 手からの水の綱（紐）は無い（ユーザー「紐いらない」）・帯は飛ぶ絵で相手へ
  for (let ms = 0; ms < sceneEndMsOf(b); ms += 23) {
    const s = sceneAt(b, ms)
    assert.equal(s.tether, undefined, `${ms}ms`)
    assert.ok(s.items.every(it => it.t !== 'tglow'))
  }
  assert.ok(b.fx.fly, '帯の飛ぶ絵')
  assert.ok(sceneAt(b, H + 60).hand, '払った手の光ははじける')
  // 水の輪：体の真ん中のまわりに3つ・巻きついてすぐ細る・締め上げるたび細る・はじけたら広がる
  const rings = (ms) => sceneAt(b, ms).items.filter(it => it.t === 'coil')
  assert.equal(rings(I - 1).length, 0)
  assert.equal(rings(I + 250).length, 3)
  assert.ok(rings(I + 250).every(r => Math.abs(r.y - (FX_TARGET_Y - FX_FEET_Y)) <= 0.21))
  assert.ok(rings(I + 10)[1].rx > rings(I + 250)[1].rx, '巻きついて細る')
  for (const t of COIL.squeezes) assert.ok(rings(I + t + 100)[1].rx < rings(I + t - 60)[1].rx, `${t}ms に締め上げる`)
  assert.ok(rings(B + 150)[1].rx > rings(B - 10)[1].rx, 'はじけて広がる')
  // 締め上げるたび相手が縮み・光って揺れる・しぶき
  for (const t of COIL.squeezes) {
    const s = sceneAt(b, I + t + 100)
    assert.ok(s.squeeze[0] < 0.94 && s.squeeze[1] > 1.02, `${t}ms：横に縮んで縦に伸びる`)
    let amp = 0
    for (let ms = I + t; ms < I + t + 120; ms += 3) amp = Math.max(amp, Math.hypot(...sceneAt(b, ms).shake))
    assert.ok(amp > 2.5 && sceneAt(b, I + t + 20).flash > 0.1, `${t}ms：光って揺れる（${amp.toFixed(1)}px）`)
    assert.ok(sceneAt(b, I + t + 150).items.some(it => it.t === 'drop'))
  }
  assert.equal(sceneAt(b, B + 10).squeeze, null)
  assert.ok(sceneAt(b, I + 400).items.some(it => it.t === 'bubble'), '泡が立ちのぼる')
  assert.ok(sceneAt(b, B + 200).items.filter(it => it.t === 'drop').length > 20, 'はじけて大きなしぶき')
  // 巻きつく絵：大きく出て一気に締まる・はじけたら広がって消える
  assert.equal(coilAt(b, I - 1), null)
  assert.ok(coilAt(b, I + 5).s > 1.4 && Math.abs(coilAt(b, I + 400).s - 1) < 0.1)
  assert.ok(coilAt(b, B + 200).s > 1.2 && coilAt(b, B + 200).op < 0.4)
  assert.equal(coilAt(b, B + 280), null)
  assert.equal(coilAt(m, I + 100), null, '水天葬は巻きつかない')
  // 外れたとき：巻きつかない
  for (let ms = I; ms < B + 300; ms += 37) {
    const s = sceneAt(b, ms, { landed: false })
    assert.ok(s.items.length === 0 && !s.squeeze && s.flash === 0, `${ms}ms`)
  }
})

test('【確定】2026-10-30 氷雨・水天葬はもっと上から降る（ユーザー「氷雨、水天葬、これもっと上から降らせて」）：雲は空の上のほう・滝は雲から足元まで・氷雨の絵は大きく縦にも伸ばす', () => {
  assert.ok(FX_SKY_Y < FX_HEAD_Y - 0.5, '雲は前（頭のすぐ上）より枠の半分以上高い')
  assert.equal(SCENE_TOP, FX_SKY_Y - FX_FEET_Y)
  // 水の筋・小雨は雲から（前の高さより上）
  const top = Math.min(...sceneAt(m, T.I + 300).items.filter(it => it.t === 'streak').map(it => it.y1))
  assert.ok(top < FX_HEAD_Y - FX_FEET_Y - 0.3, `水の筋は高い所から（${top.toFixed(2)}）`)
  const sleet = bossIllustOf('amaza').motions.sleet, hit = sleet.fx.hit
  assert.ok(hit.sy > 1.2 && hit.size >= 1.6, '氷雨の絵は大きく縦にも伸ばす')
  // 雲の上のはし（足元から）：前（1.4倍・縦そのまま）より高い
  const H0 = (1.4 * hit.h) / hit.w, H1 = (hit.size * hit.sy * hit.h) / hit.w
  assert.ok(H1 > H0 * 1.4, `雲の高さ ${H0.toFixed(2)} → ${H1.toFixed(2)}`)
})

test('【確定】2026-10-30 氷雨は雨そのものを流す（ユーザー「氷雨も絵1枚になってる、もっと雨が降ってる感じにして」）：流れる雨の絵は描いた絵の雲の下の所', () => {
  const sleet = bossIllustOf('amaza').motions.sleet, { flow, hit } = sleet.fx
  assert.ok(flow.src.includes('il-fx-sleet-flow'))
  const [x, y, w, h] = flow.at
  assert.ok(y > hit.h * 0.25 && y + h < hit.h * 0.95, `雨の所は雲の下・足元のしぶきの上（${flow.at}）`)
  assert.ok(x >= 0 && x + w <= hit.w && w > hit.w * 0.7, '横はほぼいっぱい')
  assert.equal(sleet.scene, null, '氷雨は演出（暗く・揺れる）はまだ')
})

test('【確定】2026-10-30 着物のひらひら（ユーザー「待機モーションで軽く着物ひらひらしててほしい」）：帯から下を横の帯に分けて、上から下へ伝わる波で左右にずらす・境目でつながる', () => {
  const f = BOSS_ILLUST_DEFS.amaza.idle.flutter
  assert.deepEqual(flutterBandsAt('varuzenoku', 1000), [], '黒龍は変えていない')
  for (const t of [0, 700, 1900, 4321]) {
    const bands = flutterBandsAt('amaza', t)
    assert.equal(bands.length, f.bands + 1)
    assert.ok(bands[0].dx === 0 && bands[0].tan === 0 && bands[0].y1 === f.from, '帯から上（体の上半分）は動かない')
    assert.ok(Math.abs(bands[1].dx) < 1e-9, '帯の下の境目はずれない（上とつながる）')
    for (let i = 1; i < bands.length - 1; i++) {
      const b = bands[i], n = bands[i + 1]
      assert.ok(Math.abs(b.dx + b.tan * (b.y1 - b.y0) - n.dx) < 1e-9, `${t}ms：帯${i}と帯${i + 1}は境目でつながる`)
    }
    const last = bands.at(-1), bottom = last.dx + last.tan * (last.y1 - last.y0)
    assert.ok(Math.abs(bottom) <= f.amp + 1e-9, '裾でも amp px まで（軽く）')
  }
  // 時刻で動く・裾ほど大きく揺れる
  const at = (t, i) => flutterBandsAt('amaza', t)[i].dx
  let mid = 0, low = 0
  for (let t = 0; t < f.periodMs * 2; t += 50) { mid = Math.max(mid, Math.abs(at(t, 2))); low = Math.max(low, Math.abs(at(t, f.bands))) }
  assert.ok(low > mid && low > f.amp * 0.5, `裾ほど大きい（${mid.toFixed(1)} → ${low.toFixed(1)}px）`)
})
