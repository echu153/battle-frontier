// v2cap のダンジョンのボス戦の背景（lib/bossBg.js）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { BOSS_BG } from './bossBgList.js'
import { BOSS_BG_DEFS, BOSS_BG_DIR, bossBgOf, bgRectOf, bgFxAt } from './bossBg.js'
import { BOSS_ART_DIR, BOSS_DEFS, bossArtOf, bossFileOf } from './bossArt.js'
import { bossIllustOf } from './bossIllust.js'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'

const OUT = new URL(`../../../public${BOSS_ART_DIR}/`, import.meta.url)

test('【確定】2026-10-30 ボス戦の背景：黒龍と雨摩座にある・軽い・中身の印が絵と同じ・ボスの絵と一緒に先に読む', () => {
  assert.equal(BOSS_BG_DIR, BOSS_ART_DIR)
  assert.deepEqual(Object.keys(BOSS_BG).sort(), ['amaza', 'varuzenoku'])
  for (const [key, e] of Object.entries(BOSS_BG)) {
    assert.ok(BOSS_DEFS[key] && BOSS_BG_DEFS[key], `${key} の決まりがある`)
    const file = new URL(bossFileOf(key, 'bg'), OUT)
    assert.ok(existsSync(file), `${key} の絵がある`)
    assert.ok(statSync(file).size < 400 * 1024, `${key} は軽い（${statSync(file).size}）`)
    assert.equal(e.v, versionOf(file), `${key} の印（node tools/v2cap-boss-bg.mjs をやり直す）`)
    assert.ok(Math.abs(e.w / e.h - 1.5) < 0.01, `${key} は横3：縦2`)
    const bg = bossBgOf(key)
    assert.match(bg.src, /-bg\.webp\?v=[0-9a-f]{8}$/)
    assert.deepEqual(bossIllustOf(key).bg, bg, 'イラスト版にも')
    assert.ok(bossIllustOf(key).srcs.includes(bg.src), '先に読む')
  }
  // ドット絵版にも同じ背景（ドット絵のあるボスだけ）
  const px = bossArtOf('varuzenoku')
  assert.deepEqual(px.bg, bossBgOf('varuzenoku'))
  assert.ok(px.srcs.includes(px.bg.src))
  assert.equal(bossBgOf('知らないボス'), null)
})

test('【確定】2026-10-30 背景の敷き方：枠を埋める・足元は絵の下から crop の高さ・PCは幅いっぱい・スマホは少し横が切れてもよい', () => {
  const bg = bossBgOf('varuzenoku')
  // PC（幅955・足元の下まで346）とスマホ（幅341・足元の下まで218）
  for (const [W, H] of [[955, 346], [341, 218], [1200, 346]]) {
    const r = bgRectOf(bg, W, H)
    assert.ok(r.w >= W - 1e-6 && r.x <= 1e-6 && r.x + r.w >= W - 1e-6, `${W}：横を埋める`)
    assert.ok(r.y <= 1e-6, `${W}：上を埋める`)
    assert.ok(Math.abs(r.y + r.h * (1 - bg.crop) - H) < 1e-6, `${W}：枠の下のはしが絵の下から crop の高さ`)
    assert.ok(r.y + r.h >= H, `${W}：下も埋める`)
    assert.ok(Math.abs(r.x + r.w / 2 - W / 2) < 1e-6, `${W}：横は真ん中`)
    assert.ok(Math.abs(r.h / r.w - bg.h / bg.w) < 1e-9, '絵の形は変えない')
  }
  const pc = bgRectOf(bg, 955, 346), phone = bgRectOf(bg, 341, 218)
  assert.equal(pc.x, 0, 'PCは幅いっぱい')
  assert.ok(phone.x < 0, 'スマホは少し大きく出して横が切れる')
})

test('【確定】2026-10-30 背景の動くもの：黒龍は火の粉と溶岩・雨摩座は波紋と雨と霧と灯籠。どれも絵の中・時刻だけで決まる・ずっと同じ形で止まらない', () => {
  const v = BOSS_BG_DEFS.varuzenoku.fx, a = BOSS_BG_DEFS.amaza.fx
  const at = (fx, t) => bgFxAt(fx, t)
  const inPic = (p) => p.x >= -120 && p.x <= 1656 && p.y >= -200 && p.y <= 1200
  for (const t of [0, 1234, 60000, 3600000]) {
    const f = at(v, t), g = at(a, t)
    assert.equal(f.embers.length, v.embers.n)
    assert.ok(f.flows.length > 10, '溶岩の滝が流れる')
    assert.equal(f.glows.length, v.glows.length)
    assert.equal(f.ripples.length + f.drizzle.length + f.mist.length, 0, '黒龍に雨はない')
    assert.ok(g.drizzle.length === a.drizzle.n && g.mist.length === a.mist.length && g.glows.length === a.glows.length)
    assert.equal(g.embers.length, 0, '雨摩座に火の粉はない')
    for (const e of [...f.embers, ...f.glows, ...g.mist, ...g.glows, ...g.ripples]) {
      assert.ok(inPic(e), '絵の中')
      assert.ok(e.op >= 0 && e.op <= 1, '濃さは0〜1')
    }
    for (const fl of [...f.flows, ...g.flows]) assert.ok(fl.y2 > fl.y1 && fl.op > 0)
  }
  assert.deepEqual(at(v, 5000), at(v, 5000), '同じ時刻なら同じ絵')
  assert.notDeepEqual(at(v, 5000).embers, at(v, 5100).embers, '動く')
  assert.notDeepEqual(at(a, 5000).drizzle, at(a, 5100).drizzle, '動く')
  // 波紋は1回ごとに場所が変わる（同じ所で出続けない）
  const places = new Set()
  for (let t = 0; t < 30000; t += 200) for (const p of at(a, t).ripples) places.add(`${Math.round(p.x)},${Math.round(p.y)}`)
  assert.ok(places.size > 40, `波紋の場所 ${places.size}か所`)
  // 動くものの置き場所は床や見せ場の上：火の粉は床から上へ・波紋は床の上だけ
  for (const p of at(a, 12345).ripples) assert.ok(p.y >= a.ripples.y[0] && p.y <= a.ripples.y[1])
  // ★舞台のじゃまをしない：ボスの後ろ（左から6〜8割）に大きな光を置かない
  for (const g of [...v.glows, ...a.glows]) assert.ok(g.x + g.r * 0.3 < 1536 * 0.6 || g.x - g.r * 0.3 > 1536 * 0.8, `光 ${g.x}`)
  assert.deepEqual(bgFxAt(null, 0), { glows: [], mist: [], flows: [], embers: [], ripples: [], drizzle: [] })
})
