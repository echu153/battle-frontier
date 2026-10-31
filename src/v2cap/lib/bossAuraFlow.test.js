// v2cap の黒龍の逆鱗のあとのオーラ（components/BossAuraFlow.jsx・lib/bossIllust.js の buffAfterAt）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bossIllustOf, buffAfterAt, buffHoldOf } from './bossIllust.js'
import { sceneAt, castSceneAt, stageSceneOf } from './bossScene.js'

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stage = src('../components/V2capAtbStage.jsx'), comp = src('../components/BossAuraFlow.jsx'), fight = src('../components/V2capAtbFight.jsx')

test('【確定】2026-11-01 黒龍の逆鱗のあと（ユーザー「いまほわほわしてる」「びりびりが変すぎる」「もうちょっと体のうちから出るオーラみたいにしてほしい」）：描いてもらったオーラの絵を付いているあいだ燃やす・赤い脈と稲妻はやめた', () => {
  const w = bossIllustOf('varuzenoku').buffs['逆鱗'], hold = buffHoldOf(w)
  assert.equal(w.after.glow, undefined, 'ふわっとした脈はやめた')
  assert.equal(w.after.crackle, undefined, '稲妻はやめた')
  assert.equal(buffAfterAt([{ b: w, since: hold - 300 }], 0).flame, null, '見せているあいだは付いた瞬間のオーラだけ')
  const mid = buffAfterAt([{ b: w, since: hold }], 0).flame
  assert.ok(mid.op > 0 && mid.op < w.after.flame.op, '付いた瞬間のオーラが消えはじめるころに出てくる（途切れない）')
  const on = buffAfterAt([{ b: w, since: Infinity }], 12345)
  assert.equal(on.flame.p, w.aura, 'オーラの絵そのもの')
  assert.equal(on.flame.op, w.after.flame.op)
  assert.ok(on.flame.amp > 0)
  assert.equal(on.glow, 0)
  // 体の中の光は細かくゆらぐ
  const ps = Array.from({ length: 300 }, (_, i) => buffAfterAt([{ b: w, since: Infinity }], i * 20).pulse)
  assert.ok(ps.every(v => v >= 0 && v <= 1))
  assert.ok(Math.max(...ps) - Math.min(...ps) > 0.4, 'ゆらぐ')
  assert.deepEqual(buffAfterAt([{ b: w, since: Infinity }], 777).pulse, buffAfterAt([{ b: w, since: Infinity }], 777).pulse, '同じ時刻なら同じ')
})

test('雨摩座の篠突く雨は青い脈のまま（燃えるオーラは黒龍だけ）・黒鱗の鎧には付かない', () => {
  const b = bossIllustOf('amaza').buffs['篠突く雨'], on = buffAfterAt([{ b, since: Infinity }], 12345)
  assert.equal(on.flame, null)
  assert.equal(on.pulse, 0)
  assert.ok(b.after.glow && on.glowColor === '90,175,255')
  assert.equal(bossIllustOf('varuzenoku').buffs['黒鱗の鎧'].after, null)
})

test('【確定】2026-11-01 大技をためるときの体のまわりの赤い光をやめた（ユーザー「これ大技の時のふわふわなのか、そしたら黒龍には合わないからいらない」）', () => {
  const d = bossIllustOf('varuzenoku').motions.doom
  for (const ms of [500, 2000, d.hitMs + 50]) assert.equal(sceneAt(d, ms).bossGlow, undefined, `${ms}ms`)
  assert.equal(castSceneAt(d, 2000).bossGlow, undefined)
  assert.equal(stageSceneOf([{ m: d, ms: 2000, after: false, landed: true }], null).bossGlow, undefined)
  assert.doesNotMatch(stage, /bossGlow/)
  // ためるときの口の光と吸い込まれる火の粉はそのまま
  assert.ok(sceneAt(d, 2000).hand.r > 0 && sceneAt(d, 2000).items.some(it => it.t === 'mote'))
})

test('舞台のつなぎ：オーラはいちばん奥（竜の後ろ）・倒れたら0.5秒で消える・体の中の光は明るさで・WebGL が使えないときは絵のまま・試し撃ちに［⚡ HP30%へ］', () => {
  const rigAt = stage.indexOf('const IllustRig = '), flameAt = stage.indexOf('{flame && flame.op > 0.001 && <BossAuraFlow', rigAt), bodyAt = stage.indexOf('{bands.length === 0 ? rig', rigAt)
  assert.ok(flameAt > rigAt && flameAt < stage.indexOf('{auraEl && !aura.front && !aura.glow && auraEl}', rigAt), '付いた瞬間のオーラより奥')
  assert.ok(flameAt < bodyAt, '竜より奥')
  assert.match(stage, /op: afterNow\.flame\.op \* \(death \? Math\.max\(0, 1 - \(now - death\.t0\) \/ 0\.5\) : 1\)/)
  assert.match(stage, /flame=\{flame\}/)
  assert.match(stage, /after\?\.pulse > 0\.01/)
  assert.match(stage, /bright \*= 1 \+ 0\.16 \* \(after\?\.pulse \|\| 0\)/)
  // 稲妻の部品は無い
  assert.doesNotMatch(stage, /BossCrackle|crackle|flick\b/)
  // 絵が貼れるまで・WebGL が使えないときは絵のまま
  assert.match(comp, /\{!ready && <img src=\{p\.src\}/)
  assert.match(comp, /WEBGL_lose_context/)
  // 開発のときだけ（dev の中）
  assert.ok(fight.indexOf('{dev && bossArt && (') < fight.indexOf('s.b.pattern.buffs.at(-1).at'))
  assert.ok(fight.indexOf('s.b.pattern.buffs.at(-1).at') < fight.indexOf('{/* マクロ①〜③ */}'))
})
