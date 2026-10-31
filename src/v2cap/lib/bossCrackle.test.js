// v2cap のボスの体を走る稲妻（lib/bossCrackle.js）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { edgePointsOf, crackleAt, surgeFlickAt } from './bossCrackle.js'
import { bossIllustOf, buffAfterAt } from './bossIllust.js'

const stage = readFileSync(new URL('../components/V2capAtbStage.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const comp = readFileSync(new URL('../components/BossCrackle.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fight = readFileSync(new URL('../components/V2capAtbFight.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const wrath = () => bossIllustOf('varuzenoku').buffs['逆鱗']
// 丸い体のふち（真ん中 320, 320・半径 250）
const ring = Array.from({ length: 200 }, (_, i) => { const a = (i / 200) * Math.PI * 2; return [320 + 250 * Math.cos(a), 320 + 250 * Math.sin(a), Math.cos(a), Math.sin(a)] })

test('ふちの点：濃い所と透けた所の境だけ・外向きの向きつき・立ち絵の px に直す・多いと間引く', () => {
  const w = 40, h = 40, alpha = new Uint8Array(w * h)
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) alpha[y * w + x] = 255
  const pts = edgePointsOf(alpha, w, h, 16)
  assert.ok(pts.length >= 70, `四角のまわりぜんぶ（${pts.length}）`)
  for (const [x, y, nx, ny] of pts) {
    const gx = x / 16, gy = y / 16
    assert.ok(gx === 10 || gx === 29 || gy === 10 || gy === 29, `${gx},${gy} はふち`)
    assert.ok(Math.abs(Math.hypot(nx, ny) - 1) < 1e-9, '向きの長さは1')
    if (gx === 10 && gy > 10 && gy < 29) assert.ok(nx < 0 && ny === 0, '左のふちは左向き')
    if (gy === 29 && gx > 10 && gx < 29) assert.ok(ny > 0 && nx === 0, '下のふちは下向き')
  }
  assert.ok(edgePointsOf(alpha, w, h, 16, 20).length <= 20, '間引く')
  assert.deepEqual(edgePointsOf(new Uint8Array(w * h), w, h), [], '何も無い絵')
})

test('【確定】2026-11-01 稲妻（ユーザー「黒龍のバフ後のモーション、いまほわほわしてるけど、黒龍はもっとびりびりしてほしい、かっこいい感じに」）：絶えず何本か走る・同じ時刻なら同じ形・体のふちから出る', () => {
  const c = wrath().after.crackle
  assert.deepEqual(crackleAt(ring, c, 12345), crackleAt(ring, c, 12345))
  assert.deepEqual(crackleAt([], c, 12345), [])
  assert.deepEqual(crackleAt(null, c, 12345), [])
  let total = 0, none = 0, n = 0
  for (let t = 10000; t < 30000; t += 16) {
    const arcs = crackleAt(ring, c, t)
    total += arcs.length; n++
    if (!arcs.length) none++
    for (const a of arcs) {
      assert.ok(a.op > 0 && a.op <= 1 && a.w > 0, '濃さと太さ')
      assert.ok(a.pts.length >= 4, '折れ線')
      const onEdge = ring.some(p => p[0] === a.pts[0][0] && p[1] === a.pts[0][1])
      assert.ok(onEdge, '出どころは体のふち')
    }
  }
  assert.ok(total / n >= 3, `いつも何本か走る（平均${(total / n).toFixed(1)}本）`)
  assert.ok(none / n < 0.02, `止まって見える時間がほとんど無い（${((none / n) * 100).toFixed(1)}%）`)
})

test('稲妻はちらつく：1本はすぐ消える・出ているあいだも形が変わる（両はしは同じ）・ふちからふちへ走るものと体の外へ飛び出すものがある・枝が分かれる', () => {
  const c = wrath().after.crackle
  assert.ok(c.lifeMs[1] <= 200, 'すぐ消える')
  assert.ok(c.stepMs < c.lifeMs[0], '消えるまでに形が変わる')
  // 同じ1本を時刻をずらして探す（出どころが同じ）
  let changed = 0
  for (let t = 10000; t < 12000; t += 20) {
    const a = crackleAt(ring, c, t), b = crackleAt(ring, c, t + c.stepMs)
    for (const x of a) {
      const y = b.find(q => q.pts[0][0] === x.pts[0][0] && q.pts[0][1] === x.pts[0][1] && q.pts.at(-1)[0] === x.pts.at(-1)[0])
      if (y && JSON.stringify(y.pts) !== JSON.stringify(x.pts)) changed++
    }
  }
  assert.ok(changed > 20, `同じ両はしで形が変わる（${changed}回）`)
  let onBody = 0, out = 0, forks = 0, n = 0
  for (let t = 10000; t < 30000; t += 16) for (const a of crackleAt(ring, c, t)) {
    n++
    const e = a.pts.at(-1), d = Math.hypot(e[0] - 320, e[1] - 320)
    if (Math.abs(d - 250) < 1e-6) onBody++
    else if (d > 250) out++
    if (a.forks.length) forks++
  }
  assert.ok(onBody / n > 0.4, 'ふちからふちへ')
  assert.ok(out / n > 0.1, '体の外へ飛び出す')
  assert.ok(forks / n > 0.3, '枝が分かれる')
})

test('ときどき強い一発：続けて長く走り、体が瞬く（明るい・暗いをくり返して弱まる）・次の回とは重ならない・軽い表示は本数が減る', () => {
  const c = wrath().after.crackle
  const fl = Array.from({ length: 4000 }, (_, i) => surgeFlickAt(c, 10000 + i * 5))
  assert.ok(fl.every(v => v >= 0 && v <= 1))
  assert.ok(Math.max(...fl) > 0.9, '強く瞬く')
  const on = fl.filter(v => v > 0).length / fl.length
  assert.ok(on > 0.1 && on < 0.3, `瞬くのは短いあいだだけ（${(on * 100).toFixed(0)}%）`)
  // 明るい・暗いをくり返す
  let flips = 0
  for (let i = 1; i < fl.length; i++) if (fl[i] > 0 && fl[i - 1] > 0 && Math.abs(fl[i] - fl[i - 1]) > 0.2) flips++
  assert.ok(flips >= 10, `ちらつく（${flips}回）`)
  assert.ok(c.surge.everyMs * 0.3 + c.surge.lenMs < c.surge.everyMs, '次の回とは重ならない')
  // 強い一発のあいだは本数が増える・ふだんより長い
  const count = (thin) => { let s = 0; for (let t = 10000; t < 40000; t += 16) s += crackleAt(ring, c, t, thin).length; return s }
  assert.ok(count(0.8) < count(1) * 0.95, '軽い表示は本数が減る')
  assert.equal(surgeFlickAt({}, 1000), 0, '強い一発の決まりが無ければ瞬かない')
})

test('【確定】2026-11-01 黒龍の逆鱗のあと：赤い脈をやめて稲妻（雨摩座の篠突く雨は青い脈のまま・稲妻なし）・付いた瞬間の吠えの途中から出る', () => {
  const w = wrath(), c = w.after.crackle
  assert.equal(w.after.glow, undefined, 'ほわほわした脈はやめた')
  assert.equal(buffAfterAt([{ b: w, since: c.fromMs }], 0).crackle, null, 'fromMs まではまだ')
  const mid = buffAfterAt([{ b: w, since: c.fromMs + 150 }], 0).crackle
  assert.ok(mid.k > 0 && mid.k < 1, 'すぐ出てくる')
  const on = buffAfterAt([{ b: w, since: Infinity }], 12345)
  assert.deepEqual(on.crackle, { c, k: 1, t: 12345 })
  assert.equal(on.glow, 0)
  assert.ok(on.flick >= 0 && on.flick <= 1)
  const b = bossIllustOf('amaza').buffs['篠突く雨'], am = buffAfterAt([{ b, since: Infinity }], 12345)
  assert.equal(am.crackle, null)
  assert.ok(b.after.glow, '雨摩座は今までどおり')
  // 黒鱗の鎧には付かない
  assert.equal(bossIllustOf('varuzenoku').buffs['黒鱗の鎧'].after, null)
})

test('舞台のつなぎ：いま出ている絵のふちから・姿勢の箱の中（傾きもいっしょ）・倒れたら出さない・線の太さは絵の大きさによらない・軽い表示はぼかさない・試し撃ちに［⚡ HP30%へ］', () => {
  assert.match(stage, /crackle=\{after\?\.crackle \|\| null\}/)
  assert.match(stage, /const after = death \? null : afterNow/)
  const rigAt = stage.indexOf('const IllustRig = '), boxAt = stage.indexOf('{bands.length === 0 ? rig', rigAt), arcAt = stage.indexOf('{crackle && <BossCrackle', rigAt), poseAt = stage.indexOf('{poseReady && show?.poses.map', rigAt)
  assert.ok(boxAt > 0 && poseAt > boxAt && arcAt > poseAt, 'ポーズの絵の上・姿勢の箱の中')
  assert.ok(arcAt < stage.indexOf('{auraEl && (aura.front || aura.glow) && auraEl}', rigAt), '箱の中')
  assert.match(stage, /artKey=\{crackleArt \? crackleArt\.src : `rig:\$\{art\.key\}`\}/)
  assert.match(stage, /after\?\.flick > 0\.01/)
  assert.match(comp, /vectorEffect="non-scaling-stroke"/)
  assert.match(comp, /filter=\{lite \? undefined : `url\(#\$\{id\}\)`\}/)
  assert.match(comp, /crackleAt\(edgesOf\(artKey, items, base\), c, t, lite \? 0\.8 : 1\)/)
  // 読めなくても戦闘は止めない
  assert.match(comp, /catch \{/)
  // 開発のときだけ（dev の中）
  assert.ok(fight.indexOf('{dev && bossArt && (') < fight.indexOf('s.b.pattern.buffs.at(-1).at'))
  assert.ok(fight.indexOf('s.b.pattern.buffs.at(-1).at') < fight.indexOf('{/* マクロ①〜③ */}'))
})
