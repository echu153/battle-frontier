// v2cap のダンジョンのボス戦の背景（lib/bossBg.js）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { BOSS_BG } from './bossBgList.js'
import { BOSS_BG_DEFS, BOSS_BG_DIR, GRAIN_SIZE, behindRectOf, bossBgOf, bgRectOf, bgFxAt, flowAt, flowPickOf, grainOf } from './bossBg.js'
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
    assert.equal(f.flows.length, 0, '溶岩の滝は BossFlowCanvas が流す（光の線は足さない）')
    assert.equal(f.glows.length, v.glows.length)
    assert.equal(f.ripples.length + f.drizzle.length + f.mist.length + f.motes.length, 0, '黒龍に雨や水の光はない')
    assert.equal(f.spatter.length, v.spatter.n, '滝の下で溶岩がはねる')
    assert.ok(g.drizzle.length === a.drizzle.n && g.mist.length === a.mist.length && g.glows.length === a.glows.length)
    assert.equal(g.motes.length, a.motes.n, '水の精の光')
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
  assert.deepEqual(bgFxAt(null, 0), { glows: [], mist: [], flows: [], embers: [], spatter: [], motes: [], ripples: [], drizzle: [] })
})

test('【確定】2026-10-30 黒龍の溶岩を流す（ユーザー「黒龍の溶岩ちゃんと動かしてほしい」）：滝は下へ・湖は滝の下から左右へ・ひびはゆっくり広がる・空や岩は動かさない・流れ図は軽い', () => {
  const bg = bossBgOf('varuzenoku'), f = bg.flow, at = (x, y) => flowAt(f.regions, x, y)
  assert.match(bg.flowSrc, /-bg-flow\.webp\?v=[0-9a-f]{8}$/)
  const file = new URL(bossFileOf('varuzenoku', 'bg-flow'), OUT)
  assert.ok(existsSync(file) && statSync(file).size < 120 * 1024, '流れ図は軽い')
  assert.equal(BOSS_BG.varuzenoku.flow, versionOf(file), '中身の印（node tools/v2cap-boss-bg.mjs をやり直す）')
  // 滝：いちばん太い滝がいちばん速く、下へ
  const main = at(575, 450), left = at(270, 450), right = at(1300, 400)
  assert.deepEqual([main.dx, main.dy], [0, 1])
  assert.ok(left.dy > 0.4 && left.dy < main.dy && right.dy > 0.4 && right.dy < main.dy)
  // 湖：滝の下から左右へ分かれて流れる（上下には動かない）
  assert.ok(at(200, 700).dx < -0.1 && at(1000, 700).dx > 0.1 && at(200, 700).dy === 0)
  // 床のひび：ゆっくり広がる・選び方が違う
  const crack = at(1000, 900)
  assert.equal(crack.pick, 'crack')
  assert.ok(Math.hypot(crack.dx, crack.dy) < 0.1 && crack.dx > 0)
  // 領域のふちは弱く、なかは強い（四角いふちが見えない）
  assert.ok(at(580, 450).gain === 1 && at(501, 450).gain < 0.2 && at(659, 450).gain < 0.2)
  assert.equal(at(5, 900).gain, 1, '絵のはしはふちにしない')
  // 空・岩肌は動かさない
  assert.equal(at(575, 100), null)
  assert.equal(at(1000, 300), null, 'ボスの後ろの岩壁')
  // 色の選び方：明るい溶岩は選ぶ・暗い岩は選ばない
  assert.ok(flowPickOf('hot', 255, 190, 80) > 0.9)
  assert.equal(flowPickOf('hot', 60, 50, 50), 0)
  assert.equal(flowPickOf('hot', 140, 20, 10), 0, '暗い赤のもやは選ばない')
  assert.ok(flowPickOf('crack', 200, 40, 20) > 0.9)
  assert.equal(flowPickOf('crack', 70, 60, 60), 0, '床の岩は選ばない')
  // 左上から滝へ流れこむ所は右下へ
  const inflow = at(470, 200)
  assert.ok(inflow.dx > 0 && inflow.dy > 0)
  // 溶岩を流すムラ：大きさは2のべき（くり返しに必要）・いつも同じ・R と G は別のムラ・濃さがまんべんなくある・右と左、上と下がつながる
  const g = grainOf(), N = GRAIN_SIZE, px = (x, y, c) => g[((y + N) % N) * N * 4 + ((x + N) % N) * 4 + c]
  assert.equal(Math.log2(N) % 1, 0)
  assert.equal(g.length, N * N * 4)
  assert.equal(grainOf(), g, '作るのは1回だけ')
  for (const c of [0, 1]) {
    let lo = 255, hi = 0, sum = 0, jump = 0, seam = 0
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = px(x, y, c)
      lo = Math.min(lo, p); hi = Math.max(hi, p); sum += p
      const dx = Math.abs(p - px(x + 1, y, c)), dy = Math.abs(p - px(x, y + 1, c))
      jump = Math.max(jump, dx, dy)
      if (x === N - 1) seam = Math.max(seam, dx)
      if (y === N - 1) seam = Math.max(seam, dy)
    }
    assert.ok(lo === 0 && hi === 255, 'いちばん濃い所から薄い所まで')
    assert.ok(Math.abs(sum / (N * N) - 127) < 30, `平均 ${sum / (N * N)}`)
    assert.ok(seam <= jump, 'つなぎ目だけ飛ばない')
  }
  let same = 0
  for (let i = 0; i < N * N; i++) if (Math.abs(g[i * 4] - g[i * 4 + 1]) < 4) same += 1
  assert.ok(same < N * N * 0.3, 'R と G は別のムラ')
})

test('【確定】2026-10-31 雨摩座の背景は「空に浮かぶ庭」の背景2.png（ユーザー「あまざの背景もいれた、背景２ってやつ」）：滝の水が下へ流れる・床の映りこみがゆらぐ・岩や雲は動かさない', () => {
  const bg = bossBgOf('amaza'), f = bg.flow, at = (x, y) => flowAt(f.regions, x, y)
  assert.equal(BOSS_BG_DEFS.amaza.source, '背景2.png')
  assert.match(bg.flowSrc, /amaza-bg-flow\.webp\?v=[0-9a-f]{8}$/)
  const file = new URL(bossFileOf('amaza', 'bg-flow'), OUT)
  assert.ok(existsSync(file) && statSync(file).size < 120 * 1024, '流れ図は軽い')
  assert.equal(BOSS_BG.amaza.flow, versionOf(file), '中身の印（node tools/v2cap-boss-bg.mjs をやり直す）')
  // 滝は下へ・床はゆっくり・どちらでもない所は動かさない
  assert.deepEqual([at(595, 580).dx, at(595, 580).dy], [0, 1], 'いちばん太い滝')
  assert.equal(at(595, 580).pick, 'water')
  const floor = at(400, 850)
  assert.equal(floor.pick, 'shine')
  assert.ok(floor.dy > 0 && floor.dy < 0.2)
  assert.equal(at(400, 300), null, '満月の前の雲')
  assert.equal(at(1000, 500), null, 'ボスの後ろ')
  // 色の選び方：白い水は選ぶ・暗い岩は選ばない／床の映りこみは灯りも月明かりも選ぶ・暗い石は選ばない
  assert.ok(flowPickOf('water', 225, 240, 255) > 0.9)
  assert.equal(flowPickOf('water', 60, 70, 90), 0)
  assert.ok(flowPickOf('shine', 230, 150, 80) > 0.9 && flowPickOf('shine', 110, 150, 220) > 0.9)
  assert.equal(flowPickOf('shine', 30, 40, 55), 0)
  // 溶岩と水で色の動かし方が違う（水を赤くしない＝暗い筋でも赤が青より残らない）
  assert.ok(f.gain[0] > f.gain[2], '水は赤から減る')
  const lava = bossBgOf('varuzenoku').flow
  assert.ok(lava.gain[0] < lava.gain[2], '溶岩は青から減る')
  // 動く光は絵に描かれた灯籠と水の玉の場所：満月のまん中とボスの後ろには置かない
  for (const g of BOSS_BG_DEFS.amaza.fx.glows) assert.ok(Math.hypot(g.x - 410, g.y - 256) > 60, `光 ${g.x},${g.y}`)
})

test('【確定】2026-10-31 黒龍が背景に溶けこまない（ユーザー「ヴァルゼノクが背景と同じ色だから少しわかりずらいかも」）：竜の後ろだけ色を抜いて煙をかける・体の縁に左からの光・見せ場の滝にはかからない・雨摩座には付けない', () => {
  const b = BOSS_BG_DEFS.varuzenoku.behind
  assert.ok(b.sat >= 0.5 && b.sat <= 0.9, '色を抜く')
  assert.ok(b.haze > 0 && b.haze <= 0.25, '煙は薄い（濁らせない）')
  const [hr, hg, hb] = b.hazeColor.split(',').map(Number)
  assert.ok(Math.max(hr, hg, hb) - Math.min(hr, hg, hb) < 30, '煙は灰色（赤くしない）')
  // PC・スマホとも、ボスの枠のまわりに敷く。いちばん太い溶岩の滝（元の絵の x660 まで）には、まん中の濃い所がかからない
  for (const [W, H, box] of [[955, 346, { x: 495, y: 35, w: 300, h: 300 }], [341, 218, { x: 137, y: 30, w: 173, h: 173 }]]) {
    const bg = bossBgOf('varuzenoku'), pic = bgRectOf(bg, W, H), r = behindRectOf(b, box)
    assert.ok(r.x < box.x && r.x + r.w > box.x + box.w && r.y < box.y && r.y + r.h > box.y + box.h, `${W}：枠を囲む`)
    assert.ok(r.x + (r.w / 2) * 0.45 > pic.x + 660 * pic.k, `${W}：滝に濃い所がかからない`)
  }
  // 体の縁の光：左から当たる（切り抜きに見えない）。画面の Fighter まで届いている
  const rim = BOSS_BG_DEFS.varuzenoku.rim
  assert.match(rim, /^drop-shadow\(-1px 0 /)
  assert.equal(bossBgOf('varuzenoku').rim, rim)
  assert.equal(bossIllustOf('varuzenoku').bg.rim, rim, 'イラスト版')
  assert.equal(bossArtOf('varuzenoku').bg.rim, rim, 'ドット絵版')
  const stage = readFileSync(new URL('../components/V2capAtbStage.jsx', import.meta.url), 'utf8')
  assert.match(stage, /rim=\{foeArt\?\.bg\?\.rim\}/)
  assert.match(stage, /if \(rim\) filters\.push\(rim\)/)
  assert.match(stage, /bg\.behind && <BgBehind/)
  // 色を抜く層は絵と流れの上・火の粉の下（火の粉は色を抜かない）
  assert.ok(stage.indexOf('<BossFlowCanvas bg={bg}') < stage.indexOf('<BgBehind behind={bg.behind}') && stage.indexOf('<BgBehind behind={bg.behind}') < stage.indexOf('fx.embers.map'))
  // 雨摩座には要らない
  assert.equal(BOSS_BG_DEFS.amaza.behind, undefined)
  assert.equal(BOSS_BG_DEFS.amaza.rim, undefined)
})
