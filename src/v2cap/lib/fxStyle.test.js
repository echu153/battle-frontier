// v2cap 演出の段階と色（強化・作成・宝樹の天啓）：node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { WIN_TIERS } from './casino.js'
import { enhanceTierOf, enhanceChargeMsOf, enhanceHoldMsOf, enhanceGlowOf, enhanceTitleOf, CRAFT_TIERS, craftTierOf, craftTitleOf, CRAFT_STRIKES, REVELATION_STYLE, FORTUNE_NAMES, revelationStyleOf, TREE_ART } from './fxStyle.js'
import { CRAFT_RARITIES } from './smith.js'
import { RARITY_COLOR } from './equipment.js'
import { PLUS_MAX } from './smith.js'
import { ITEM_BY_ID } from './equipment.js'
import { powerAt, statsAt, statChangeOf } from './gear.js'

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

test('【確定】強化のためる時間：+5 にする回までは前のまま（1.5〜1.9秒）・+6 にする回から強化値ごとに長く（+10 で5秒）', () => {
  // 2026-10-24 ユーザー指示「強化値が＋6の強化以降、強化値によって成否の演出（光が貯まるまでの時間）が遅くなるようにして ※緊張感を持たせるため」
  assert.deepEqual([1, 2, 3, 4, 5].map(enhanceChargeMsOf), [1500, 1600, 1700, 1800, 1900], '+5 までは前（成功率で決めていた値）と同じ')
  assert.deepEqual([6, 7, 8, 9, 10].map(enhanceChargeMsOf), [2500, 3000, 3500, 4000, 5000])
  for (let n = 2; n <= PLUS_MAX; n++) assert.ok(enhanceChargeMsOf(n) > enhanceChargeMsOf(n - 1), `+${n} は +${n - 1} より長い`)
  assert.ok(enhanceChargeMsOf(6) - enhanceChargeMsOf(5) >= 500, '+6 から目に見えて長くなる')
  // 演出は強化値（plusTo）で決める（前は成功率 job.rate を渡していた）
  const fx = readFileSync(new URL('../components/V2capEnhanceFx.jsx', import.meta.url), 'utf8')
  assert.ok(fx.includes('enhanceChargeMsOf(job.plusTo)'), '演出は強化したあとの強化値でためる時間を決める')
})

test('【確定】+6 にする回からは、ゲージがたまったあと満タンのまま1〜6秒待ってから結果（長さは成否と関係ない）', () => {
  // 2026-10-24 ユーザー指示「ランダムで1秒～6秒ぐらい貯まった状態で維持するようにして ランダムなだけで6秒で失敗することもあれば1秒で成功することもある」
  for (let n = 1; n < 6; n++) assert.equal(enhanceHoldMsOf(n, () => 0.5), 0, `+${n} にする回は待たない`)
  for (let n = 6; n <= PLUS_MAX; n++) {
    assert.equal(enhanceHoldMsOf(n, () => 0), 1000, `+${n} いちばん短くて1秒`)
    assert.equal(enhanceHoldMsOf(n, () => 0.9999999), 6000, `+${n} いちばん長くて6秒`)
    assert.equal(enhanceHoldMsOf(n, () => 0.5), 3500)
  }
  for (let i = 0; i < 2000; i++) { const h = enhanceHoldMsOf(8); assert.ok(h >= 1000 && h <= 6000, String(h)) }
  // 演出：押した時点（結果が届く前）に強化値だけで決めて、ためる時間＋待つ時間が過ぎたら結果
  const fx = readFileSync(new URL('../components/V2capEnhanceFx.jsx', import.meta.url), 'utf8')
  assert.ok(fx.includes('const holdMs = enhanceHoldMsOf(job.plusTo)'), '待つ時間は強化値だけで決める（結果は見ない）')
  assert.ok(fx.includes('now - t0.current >= chargeMs + holdMs'), 'たまったあと待ってから結果')
  assert.equal(enhanceHoldMsOf.length, 1, '引数は強化値と乱数だけ（成否を受け取らない）')
})

test('【確定】ためている間は発光：ゲージが進むほど少しずつ光り、満タンで点灯（いちばん明るい）→ 結果まで明滅', () => {
  // 2026-10-24 ユーザー指示「溜めてる間は点灯するようにして、発光ていうのかな」
  const charge = enhanceChargeMsOf(8)
  assert.equal(enhanceGlowOf(0, charge), 0, 'ため始めは光っていない')
  for (let ms = 0; ms < charge; ms += 50) assert.ok(enhanceGlowOf(ms, charge) <= 0.4, `たまっている途中は控えめ（${ms}ms）`)
  assert.ok(enhanceGlowOf(charge * 0.9, charge) > enhanceGlowOf(charge * 0.2, charge), 'ゲージが進むほど明るい')
  assert.equal(enhanceGlowOf(charge, charge), 1, '満タンになった瞬間に点灯（いちばん明るい）')
  const hold = Array.from({ length: 120 }, (_, i) => enhanceGlowOf(charge + i * 50, charge))
  assert.ok(Math.min(...hold) < 0.25 && Math.max(...hold) === 1, '満タンで待つ間は強く明滅（0.2〜1）')
  for (const v of hold) assert.ok(v >= 0.2 - 1e-9 && v <= 1, String(v))
  const fx = readFileSync(new URL('../components/V2capEnhanceFx.jsx', import.meta.url), 'utf8')
  assert.ok(fx.includes('setLit(enhanceGlowOf(now - t0.current, chargeMs))'), '演出は毎こま発光を出し直す')
  assert.ok(fx.includes("const g = phase === 'charge' ? lit : 0"), '発光はためている間だけ')
})

test('【確定】強化で上がるステを出す（戦闘力だけでなく「STR 12 → 13（+1）」）：強化の画面・結果のポップアップ・強化券', () => {
  // 2026-10-24 ユーザー指示「強化値で戦闘値しかないけど、ちゃんと武器のステータスどのくらい上昇してるのかも記載するようにして」
  const sword = ITEM_BY_ID['3N:両手剣']
  for (let plus = 0; plus < PLUS_MAX; plus++) {
    const from = statsAt(sword, sword.lv, null, plus), to = statsAt(sword, sword.lv, null, plus + 1)
    const rows = statChangeOf(from, to)
    assert.ok(rows.length > 0, `+${plus}→+${plus + 1} に行がある`)
    assert.equal(rows.reduce((t, r) => t + r.diff, 0), powerAt(sword, sword.lv, plus + 1) - powerAt(sword, sword.lv, plus), '上がったステの合計＝戦闘力の上がり幅')
    for (const r of rows) assert.equal(r.diff, r.to - r.from)
  }
  assert.deepEqual(statChangeOf({ str: 5, dex: 0 }, { str: 6, dex: 1 }).map(r => [r.key, r.from, r.to, r.diff]), [['str', 5, 6, 1], ['dex', 0, 1, 1]], '0から上がったステも出す')
  assert.deepEqual(statChangeOf({}, {}), [], '上がるステが無ければ行なし')
  const fx = readFileSync(new URL('../components/V2capEnhanceFx.jsx', import.meta.url), 'utf8')
  assert.ok(fx.includes('<StatChange from={job.statsFrom} to={job.statsTo} />'), '結果のポップアップ（成功）に上がったステ')
  const smith = readFileSync(new URL('../components/V2capSmith.jsx', import.meta.url), 'utf8')
  assert.ok(smith.includes('statsFrom: statsAt(item, inv.ilv, null, plus), statsTo: statsAt(item, inv.ilv, null, cost.next),'), '押したときの前後のステを演出へ渡す')
  assert.ok(smith.includes('<StatChange from={statsAt(item, inv.ilv, null, plus)} to={statsAt(item, inv.ilv, null, cost.next)} />'), '強化の画面に上がるステ')
  assert.ok(smith.includes('<StatChange from={statsAt(ticketRow.item, ticketRow.inv.ilv, null, plusOf(ticketRow.inv))} to={statsAt(ticketRow.item, ticketRow.inv.ilv, null, ticket)} />'), '強化券の確認にも上がるステ')
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
  assert.equal(craftTitleOf('封剣セルディア'), '封剣セルディアを作成しました！')
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

// 【確定】2026-10-13 ユーザー指示「ユグレシアの宝樹、今こんな感じでパッとしないから、良い感じにしてほしい」：
//   画面の上に宝樹の絵を敷き、今日の運勢で明るさを変える（天啓の半分だけ・色相は回さない）。説明文はユーザーの文
test('【確定】宝樹の画面：絵の明るさは運勢しだい（大吉がいちばん明るい）・暗くしすぎない・色相は回さない', async () => {
  const { stageArtOf, STAGE_IDLE } = await import('./fxStyle.js')
  assert.deepEqual(stageArtOf(null), STAGE_IDLE)
  const b = (n) => stageArtOf(n).b
  assert.ok(b('大吉') > b('中吉') && b('中吉') > b('小吉') && b('小吉') > b('吉') && b('吉') > b('末吉') && b('末吉') > b('凶') && b('凶') > b('大凶'))
  for (const n of FORTUNE_NAMES) {
    assert.equal(stageArtOf(n).h, 0, `${n}：色相は回さない`)
    assert.ok(stageArtOf(n).b >= 0.6, `${n}：画面は暗くしすぎない`)
  }
})

test('【確定】宝樹の画面の説明文はユーザーの文（2026-10-14 の4行・前の「LV10なら 吉で EXP +30…10回出撃したくらい」は出さない）', () => {
  const src = readFileSync(new URL('../components/V2capTree.jsx', import.meta.url), 'utf8')
  const lines = ['1日1回だけ祈れます。', '宝樹の返す天啓（大凶〜大吉）で、もらえる経験値が変わります。', '毎日祈ることで信仰心が上がっていきます。', '（AM 5：00更新）']
  for (const l of lines) assert.ok(src.includes(l), l)
  assert.ok(!src.includes('宝樹の返す言葉（大凶〜大吉）'), '前の文')
  // 【確定】2026-10-14「説明以外に信仰心の文言いらない、連続ボーナスの詳細な記載もいらない」
  const fx = readFileSync(new URL('../components/V2capRevelationFx.jsx', import.meta.url), 'utf8')
  for (const [name, code] of [['V2capTree.jsx', src], ['V2capRevelationFx.jsx', fx]]) {
    const shown = code.split(/\r?\n/).filter(l => !l.trim().startsWith('//') && !l.includes('{/*'))
    assert.equal(shown.filter(l => l.includes('信仰心')).length, name === 'V2capTree.jsx' ? 1 : 0, `${name}：信仰心は説明文の1か所だけ`)
    assert.ok(!shown.some(l => /streak|連続/.test(l)), `${name}：連続の日数や倍率は出さない`)
  }
  assert.ok(!src.includes('日付が変わるのは日本時間の5時です'))
  assert.ok(!/吉で <span/.test(src) && !src.includes('で10回出撃したくらい）'), '吉と大吉のEXPの例は出さない')
})

// 【確定】2026-10-13 ユーザーが用意した絵：祈るアイコン（祈るボタン）と「今日の天啓」の石板（ユグレシアUI）
test('【確定】宝樹の画面の絵（祈るアイコン・天啓の石板）がある・祈るボタンは 🙏 ではなくアイコン', () => {
  const src = readFileSync(new URL('../components/V2capTree.jsx', import.meta.url), 'utf8')
  const arts = [...src.matchAll(/'(\/v2cap-art\/[^']+\.webp)'/g)].map(m => m[1])
  assert.ok(arts.includes('/v2cap-art/pray-icon.webp') && arts.includes('/v2cap-art/oracle-frame.webp'), arts.join(','))
  for (const a of arts) assert.ok(existsSync(new URL(`../../../public${a}`, import.meta.url)), `public${a} がある`)
  assert.ok(!src.includes("'🙏 祈る'") && src.includes('src={PRAY_ICON}'), '祈るボタンは🙏ではなくユーザーのアイコン')
})

// 【確定】2026-10-13 ユーザー指示「最深部に到達した！　スタミナが全回復した！　って表示される演出が欲しい ※暗転後に泉が見えるような演出」
test('【確定】安息の祠の演出：ユーザーの絵（入口・泉）がある・文言はユーザーの書いたまま・最深部は暗転から始まる', async () => {
  const { SHRINE_ART, SPRING_ART, SHRINE_TEXT } = await import('./fxStyle.js')
  for (const art of [SHRINE_ART, SPRING_ART]) assert.ok(existsSync(new URL(`../../../public${art}`, import.meta.url)), `public${art} がある`)
  assert.equal(SHRINE_TEXT.deepest, '最深部に到達した！')
  assert.equal(SHRINE_TEXT.healed, 'スタミナが全回復した！')
  const src = readFileSync(new URL('../components/V2capShrineFx.jsx', import.meta.url), 'utf8')
  assert.ok(src.includes("useState('dark')"), '最初は暗転')
  assert.ok(src.includes("'brightness(0) saturate(0.5)'"), '暗転のあいだ絵は真っ暗＝そこから見えてくる')
})

// 【確定】2026-10-14 ユーザー指示「大凶の時の演出、雷とか魔法陣の演出安っぽいから修正したい」→ ユーザーの絵（雷・魔法陣・暗雲）で作り直した
test('【確定】大凶の嵐：ユーザーの絵（雷3本・暗雲）がある・雷は降りる間に2回・天啓のあとも遠くで時々・線の稲妻と光の柱は使わない・光輪は前のまま', async () => {
  const { STORM_ART, STORM_STRIKES, STORM_AMBIENT_MS, STORM_DESCEND_MS } = await import('./fxStyle.js')
  assert.equal(STORM_ART.bolts.length, 3, '雷の絵は3本（ユーザーの1枚を1本ずつに切った）')
  for (const a of [...STORM_ART.bolts, STORM_ART.cloud]) assert.ok(existsSync(new URL(`../../../public${a}`, import.meta.url)), `public${a} がある`)
  assert.equal(STORM_STRIKES.length, 2)
  for (const k of STORM_STRIKES) {
    assert.ok(k.x > 0 && k.x < 1 && k.bolt >= 0 && k.bolt < STORM_ART.bolts.length && k.h > 0 && k.h <= 100)
    assert.ok(k.at < STORM_DESCEND_MS, '天啓が出る前に落ちる')
  }
  assert.ok(STORM_AMBIENT_MS[0] > 0 && STORM_AMBIENT_MS[0] < STORM_AMBIENT_MS[1])
  const src = readFileSync(new URL('../components/V2capRevelationFx.jsx', import.meta.url), 'utf8')
  assert.ok(!src.includes('<polyline'), '線で描いた稲妻は使わない')
  assert.equal((src.match(/\{lit && !storm && \(/g) || []).length, 1, '大凶は光の柱を出さない')
  // 【確定】2026-10-14 ユーザー「魔法陣は初期のままでよさそうかも、違和感ある」＝魔法陣の絵はやめて、天の光輪（Halo）は大凶でも前のまま
  assert.ok(!('sigil' in STORM_ART) && !/sigil/i.test(src), '魔法陣の絵は使わない')
  assert.match(src, /\{lit && \(\s*<div[^\n]*opacity: bad \? 0\.45 : 1/, '天の光輪は大凶でも出す（前のまま 0.45）')
  assert.ok(src.includes('STORM_ART.cloud'), '暗雲はユーザーの絵')
  // 【確定】2026-10-14 ユーザー「雲も急に上から出てきてるから、初期みたいに左右からゆっくり雲が覆うようにしてほしい」
  const { STORM_CLOUD_MS } = await import('./fxStyle.js')
  assert.ok(src.includes('rvCloudInL') && src.includes('rvCloudInR') && !src.includes('rvStormIn'), '雲は左右から（上から落とさない）')
  assert.ok(STORM_CLOUD_MS >= 1500, '雲はゆっくり（1.5秒以上）')
  assert.ok(STORM_STRIKES[0].at >= STORM_CLOUD_MS * 0.6, '雷は雲がだいたい覆ってから')
})
