// v2cap 演出の段階と色（強化・作成・宝樹の天啓）：node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { WIN_TIERS } from './casino.js'
import { enhanceTierOf, enhanceChargeMsOf, enhanceTitleOf, CRAFT_TIERS, craftTierOf, craftTitleOf, CRAFT_STRIKES, REVELATION_STYLE, FORTUNE_NAMES, revelationStyleOf, TREE_ART } from './fxStyle.js'
import { CRAFT_RARITIES } from './smith.js'
import { RARITY_COLOR } from './equipment.js'
import { PLUS_MAX } from './smith.js'

test('【確定】強化の演出：+1〜+10 のどれにも段階がある・高いほど派手（+10は虹）', () => {
  const order = ['blue', 'purple', 'gold', 'max']
  let prev = 0
  for (let p = 1; p <= PLUS_MAX; p++) {
    const t = enhanceTierOf(p)
    assert.ok(t && t.colors.length > 0, `+${p}`)
    const i = order.indexOf(t.key)
    assert.ok(i >= prev, `+${p} は前より控えめにならない`)
    prev = i
  }
  assert.equal(enhanceTierOf(PLUS_MAX).key, 'max')
  assert.equal(enhanceTierOf(1).key, 'blue')
})

test('【確定】強化のためる時間は成功率が低いほど長い（90%で1.6秒・10%で2.4秒）', () => {
  assert.equal(enhanceChargeMsOf(90), 1600)
  assert.equal(enhanceChargeMsOf(10), 2400)
  assert.ok(enhanceChargeMsOf(100) <= enhanceChargeMsOf(50))
})

test('【確定】強化の結果のポップアップは「○○の強化に成功！／失敗…」（ユーザーの書き方）', () => {
  assert.equal(enhanceTitleOf('見習いの短剣', true), '見習いの短剣の強化に成功！')
  assert.equal(enhanceTitleOf('見習いの短剣', false), '見習いの短剣の強化に失敗…')
})

test('【確定】作成の演出：作れるレア度（レア・エピック・レジェンダリー）のどれにも色があり、装備の一覧と同じ色・上ほど派手', () => {
  for (const r of CRAFT_RARITIES) {
    assert.ok(CRAFT_TIERS[r], r)
    assert.equal(craftTierOf(r).color, RARITY_COLOR[r], `${r} の色は装備の一覧と同じ`)
  }
  assert.ok(craftTierOf('L').level > craftTierOf('E').level && craftTierOf('E').level > craftTierOf('R').level)
  assert.equal(CRAFT_STRIKES, 3)
  assert.equal(craftTitleOf('黒騎士の魔剣'), '黒騎士の魔剣を作成しました！')
})

test('【確定】宝樹の祈り＝天啓：どの運勢にも見た目があり、大吉がいちばん明るい・凶と大凶は光がまたたいて消える・暗雲と稲光は大凶だけ', () => {
  for (const name of FORTUNE_NAMES) assert.ok(REVELATION_STYLE[name], `${name} の見た目`)
  const lv = (n) => revelationStyleOf(n).level
  assert.ok(lv('大吉') > lv('中吉') && lv('中吉') > lv('小吉') && lv('小吉') > lv('吉') && lv('吉') > lv('末吉') && lv('末吉') > lv('凶') && lv('凶') > lv('大凶'))
  for (const name of FORTUNE_NAMES) {
    const st = revelationStyleOf(name)
    assert.equal(!!st.flicker, st.level < 0, `${name}：光がまたたくのは凶と大凶だけ`)
    assert.equal(!!st.storm, name === '大凶', `${name}：暗雲と稲光は大凶だけ`)
    if (st.level < 0) assert.ok(st.mist, `${name} はもや`)
  }
  // 大吉は「金色の葉が降りそそいだ」＝金色の葉が降る
  assert.equal(revelationStyleOf('大吉').fall.shape, 'leaf')
  assert.ok(revelationStyleOf('大吉').feathers > revelationStyleOf('吉').feathers)
  assert.ok(TREE_ART === null || typeof TREE_ART === 'string')
})

// 【確定】2026-10-13 ユーザー指摘「強化成功がつぶれてる」：日本語の大きな文字を、太字の無い字体（monospace・sans-serif 任せ）で
//   900 にしたり、グラデーションで切り抜いたり（background-clip:text）すると線がつぶれる。同じ書き方が戻らないように見張る
test('★演出の大きな文字：日本語をグラデーションで切り抜かない・Arial Black の後ろを monospace にしない', () => {
  const dir = new URL('../components/', import.meta.url)
  const files = readdirSync(dir).filter(f => /\.(jsx|js)$/.test(f))
  let clips = 0
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8')
    assert.ok(!/'Arial Black'[^"`\n]*monospace/.test(src), `${f}：Arial Black の後ろが monospace（日本語が太字の無い字体になる）`)
    const n = (src.match(/backgroundClip:'text'/g) || []).length
    if (n) assert.equal(f, 'CasinoFxLayer.jsx', `${f}：background-clip:text は英字だけの当たりの段階の表示に限る`)
    clips += n
  }
  assert.ok(clips <= 1)
  // 切り抜きを使っている当たりの段階（WIN・BIG WIN…）は英字だけ
  for (const t of WIN_TIERS) assert.match(t.label, /^[A-Z ]+$/, t.label)
})

test('【確定】天啓の背景はユーザーの宝樹の絵：ファイルがある・明るさは 祈り＜降りる・天啓は大吉がいちばん明るく大凶がいちばん暗い', async () => {
  const { TREE_ART, ART_PRAY, ART_DESCEND, ART_BY_FORTUNE, artFilterOf } = await import('./fxStyle.js')
  assert.ok(TREE_ART, '絵を使う')
  assert.ok(existsSync(new URL(`../../../public${TREE_ART}`, import.meta.url)), `public${TREE_ART} がある`)
  assert.ok(ART_PRAY.b < ART_DESCEND.b)
  const b = (n) => ART_BY_FORTUNE[n].b
  for (const n of FORTUNE_NAMES) assert.ok(ART_BY_FORTUNE[n], n)
  assert.ok(b('大吉') > b('中吉') && b('中吉') > b('小吉') && b('小吉') > b('吉') && b('吉') > b('末吉') && b('末吉') > b('凶') && b('凶') > b('大凶'))
  assert.equal(artFilterOf({ b: 1, s: 1, h: 0 }), 'brightness(1) saturate(1)')
  assert.equal(artFilterOf({ b: 0.3, s: 0.4, h: 300 }), 'brightness(0.3) saturate(0.4) hue-rotate(300deg)')
})
