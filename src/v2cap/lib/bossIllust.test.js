// v2cap のダンジョンのボスのイラスト版（パーツを重ねて動かす・塗りのエフェクト）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { BOSS_ILLUST } from './bossIllustList.js'
import { BOSS_ART_DIR, BOSS_DEFS, bossFileOf } from './bossArt.js'
import {
  BOSS_ILLUST_DEFS, BOSS_ILLUST_SIZE, ILLUST_PARTS, illustKindOf, illustFxKindOf,
  bossIllustOf, illustPoseAt, idlePoseAt, motionPoseAt, illustPointAt, illustTrailsAt, mouthPointOf, rotPoint,
} from './bossIllust.js'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'
import { dilate, erode, leftTipOf, fitPart, inPoly } from '../../../tools/v2cap-boss-illust.mjs'

const OUT = new URL(`../../../public${BOSS_ART_DIR}/`, import.meta.url)
const kindsOf = (e) => [...ILLUST_PARTS.filter(p => e.parts[p]).map(illustKindOf),
  ...Object.entries(e.fx || {}).flatMap(([mk, f]) => Object.keys(f).map(kind => illustFxKindOf(mk, kind)))]

test('【確定】2026-10-28 イラスト版の絵はぜんぶあって軽い（パーツ 120KB・エフェクト 120KB まで）・中身の印は絵と同じ', () => {
  for (const [key, e] of Object.entries(BOSS_ILLUST)) {
    assert.ok(BOSS_ILLUST_DEFS[key] && BOSS_DEFS[key], `${key} の決まりがある`)
    for (const kd of kindsOf(e)) {
      const file = new URL(bossFileOf(key, kd), OUT)
      assert.ok(existsSync(file), `${key} ${kd} の絵がある`)
      assert.ok(statSync(file).size < 120 * 1024, `${key} ${kd} は軽い`)
      assert.equal(e.v?.[kd], versionOf(file), `${key} ${kd} の印（node tools/v2cap-boss-illust.mjs をやり直す）`)
    }
  }
})

test('黒龍ヴァルゼノクのイラスト版：パーツ6つ（奥の翼・手前の翼・体・頭・前脚・下あごの順）・回す中心は絵の中・技4つにエフェクト7枚', () => {
  const a = bossIllustOf('varuzenoku')
  assert.ok(a)
  assert.equal(a.kind, 'illust')
  assert.equal(a.base, BOSS_ILLUST_SIZE)
  assert.deepEqual(a.parts.map(p => p.key), ['wingF', 'wingN', 'body', 'head', 'arm', 'jaw'])
  for (const p of a.parts) {
    assert.ok(p.px >= p.x - 40 && p.px <= p.x + p.w + 40 && p.py >= p.y - 40 && p.py <= p.y + p.h + 40, `${p.key} の回す中心はパーツのそば`)
    assert.match(p.src, /\.webp\?v=[0-9a-f]{8}$/)
  }
  assert.deepEqual(Object.values(a.motions).map(m => m.label), BOSS_DEFS.varuzenoku.motions.map(m => m.file))
  assert.equal(Object.values(a.motions).reduce((n, m) => n + Object.keys(m.fx || {}).length, 0), 7)
  assert.ok(a.mouth[0] < BOSS_ILLUST_SIZE * 0.2, '口は左のはし（相手の方）')
  assert.ok(a.srcs.length === 6 + 7)
})

test('エフェクトの時刻：飛ぶ絵は撃ち出す時刻に口から出て flyMs で届く（届いたときがダメージ）・黒爪は当たる絵だけ', () => {
  const a = bossIllustOf('varuzenoku')
  assert.equal(a.motions.claw.fx.fly, undefined)
  assert.equal(a.motions.claw.impactMs, a.motions.claw.hitMs)
  for (const k of ['breath', 'gale', 'doom']) {
    const m = a.motions[k], d = BOSS_ILLUST_DEFS.varuzenoku.effects.find(e => e.motion === k && e.kind === 'fly')
    assert.equal(m.impactMs, m.hitMs + d.flyMs)
    assert.ok(m.hitMs < m.totalMs)
    assert.ok(m.front[0] < BOSS_ILLUST_SIZE * 0.25, `${k}：撃ち出すときの口は左（${m.front}）`)
  }
})

test('待機：振り下ろし（はじめの35%）は速く、振り上げはゆっくり・下ろしきりで体が浮く', () => {
  const idle = BOSS_ILLUST_DEFS.varuzenoku.idle
  const P = idle.periodMs
  const up = idlePoseAt(idle, 0), down = idlePoseAt(idle, P * 0.35), back = idlePoseAt(idle, P * 0.999)
  assert.equal(up.wingN, idle.wingUp)
  assert.ok(Math.abs(down.wingN - idle.wingDown) < 1e-9)
  assert.ok(Math.abs(back.wingN - idle.wingUp) < 0.1, 'くり返しの切れ目でつながる')
  assert.ok(down.y < up.y, '下ろしきりで体が上がる（y は上がマイナス）')
  assert.ok(Math.sign(down.wingF) === -Math.sign(down.wingN), '奥の翼は逆向きに回す（左を向いた翼）')
})

test('技の姿勢：黒爪は前（左）へ踏み込む・焦熱の吐息は首を引いてから突き出す・黒翼烈風は翼を上げてから叩きつける・終焉の黒焔はのけぞってため、口の火が最大', () => {
  const M = BOSS_ILLUST_DEFS.varuzenoku.motions
  const at = (k, ms) => motionPoseAt(M[k].keys, ms)
  assert.ok(at('claw', M.claw.hitMs).x < -0.05)
  assert.ok(at('breath', 420).head > 0 && at('breath', M.breath.hitMs).head < 0)
  assert.ok(at('gale', 380).wingN < -20 && at('gale', M.gale.hitMs).wingN > 20)
  assert.ok(at('doom', 600).r > 0 && at('doom', M.doom.hitMs).glow === 1)
  for (const k of Object.keys(M)) {
    assert.deepEqual(Object.values(at(k, 0)).every(v => v === 0), true, `${k} は待機から始まる`)
    assert.equal(at(k, M[k].totalMs), null, `${k} は流し終わったら待機へ`)
  }
  // 技のあいだは羽ばたきを弱める
  const m = { keys: M.claw.keys }
  const p = illustPoseAt('varuzenoku', m, 1, 0), idle = idlePoseAt(BOSS_ILLUST_DEFS.varuzenoku.idle, 0)
  assert.ok(Math.abs(p.wingN) < Math.abs(idle.wingN))
})

test('点を姿勢で動かす：画面の rotate と同じ時計回り（右の点を+90°回すと下へ）・全体のずれは枠の割合', () => {
  const a = BOSS_ILLUST.varuzenoku
  const zero = { x: 0, y: 0, r: 0, head: 0, wingN: 0, wingF: 0, glow: 0 }
  const [px, py] = a.pivot
  const [x, y] = illustPointAt('varuzenoku', { ...zero, r: 90 }, [px + 10, py], 'body')
  assert.ok(Math.abs(x - px) < 1e-9 && Math.abs(y - (py + 10)) < 1e-9)
  const [x2, y2] = illustPointAt('varuzenoku', { ...zero, x: 0.1, y: -0.05 }, [100, 100])
  assert.ok(Math.abs(x2 - (100 + BOSS_ILLUST_SIZE * 0.1)) < 1e-9 && Math.abs(y2 - (100 - BOSS_ILLUST_SIZE * 0.05)) < 1e-9)
})

test('道具：太らせる・細らせる（閉じると小さな穴が埋まる）・いちばん左の先（小さな火の粉は数えない）', () => {
  const W = 9, H = 9, m = new Uint8Array(W * H)
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) m[y * W + x] = 1
  m[4 * W + 4] = 0   // 穴
  const closed = erode(dilate(m, W, H, 1), W, H, 1)
  assert.equal(closed[4 * W + 4], 1)
  assert.equal(closed[0], 0)
  const data = Buffer.alloc(20 * 10 * 4)
  const dot = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[(y * 20 + x) * 4 + 3] = 255 }
  dot(1, 1, 1, 1); dot(5, 3, 15, 7)
  assert.deepEqual(leftTipOf({ W: 20, H: 10, data }), { x: 5, y: 5 })
})

test('【確定】2026-10-28 パーツを立ち絵に重ねる：ChatGPT が別の大きさ・場所に描いたパーツの倍率と位置を見つける', () => {
  // 立ち絵（256px）の中の形を、パーツでは2倍の大きさ・ずらした場所に描いた
  const shape = (W, k, ox, oy) => {
    const data = Buffer.alloc(W * W * 4)
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const u = (x - ox) / k, v = (y - oy) / k
      const body = u >= 60 && u < 160 && v >= 80 && v < 140, vein = body && Math.abs(u - 100) < 6, horn = u >= 140 && u < 150 && v >= 40 && v < 80
      if (!body && !horn) continue
      const i = (y * W + x) * 4
      data[i] = vein ? 255 : 90; data[i + 1] = vein ? 200 : 30; data[i + 2] = 20; data[i + 3] = 255
    }
    return { W, H: W, data }
  }
  const T = shape(256, 1, 0, 0)
  const P = shape(512, 2, -60, 10)   // パーツの点 (x, y) は立ち絵の ((x + 60) / 2, (y − 10) / 2)
  const fit = fitPart(T, P)
  assert.ok(Math.abs(fit.s - 0.5) <= 0.03, `倍率 ${fit.s}`)
  assert.ok(Math.abs(fit.deg) <= 2, `角度 ${fit.deg}`)
  assert.ok(Math.abs(fit.tx - 30) <= 6 && Math.abs(fit.ty + 5) <= 6, `位置 ${fit.tx},${fit.ty}`)
})

test('【確定】2026-10-28 前脚と下あごは切り分けたパーツ：前脚は体の子で頭より手前（振り上げた爪が隠れない）・下あごは頭の中（頭といっしょに回る）', () => {
  const a = bossIllustOf('varuzenoku')
  const by = Object.fromEntries(a.parts.map(p => [p.key, p]))
  assert.equal(by.arm.parent, 'body')
  assert.equal(by.arm.nest, false, '体は回らないので、前脚はほかのパーツと同じ並び（頭より手前）')
  assert.ok(a.parts.indexOf(by.arm) > a.parts.indexOf(by.head))
  assert.equal(by.jaw.parent, 'head')
  assert.equal(by.jaw.nest, true)
  assert.ok(by.arm.w > 100 && by.arm.x < 80, '前脚は左へ伸びる爪まで')
  assert.ok(by.jaw.x < 60 && by.jaw.w < 120, '下あごは口の先から付け根まで')
  assert.deepEqual(a.jaw.pivot, BOSS_ILLUST_DEFS.varuzenoku.cuts.jaw.pivot)
  // 下あごの点は下あご→頭→全体の順に回る
  const zero = { x: 0, y: 0, r: 0, head: 0, wingN: 0, wingF: 0, arm: 0, jaw: 0, glow: 0 }
  const pt = [60, 300]
  const [x0, y0] = illustPointAt('varuzenoku', { ...zero, jaw: -30 }, pt, 'jaw')
  assert.ok(y0 > pt[1] + 5, '下あごを開くと先が下がる')
  const both = illustPointAt('varuzenoku', { ...zero, jaw: -30, head: 20 }, pt, 'jaw')
  const want = rotPoint([x0, y0], [by.head.px, by.head.py], 20)
  assert.ok(Math.abs(both[0] - want[0]) < 1e-9 && Math.abs(both[1] - want[1]) < 1e-9)
})

test('【確定】2026-10-28 黒爪：前脚を振り上げてから振り下ろす（当たる時刻は下ろしきり）・爪の先に残像の筋・当たる絵は引いて出す', () => {
  const d = BOSS_ILLUST_DEFS.varuzenoku.motions.claw
  const at = (ms) => motionPoseAt(d.keys, ms)
  assert.ok(at(330).arm > 40, '振り上げ')
  assert.ok(at(d.hitMs).arm < -25, '振り下ろし')
  assert.ok(d.hitMs - 330 <= 100, '振り下ろしは速い')
  const m = bossIllustOf('varuzenoku').motions.claw
  assert.equal(m.fx.hit.wipe, true)
  assert.deepEqual(illustTrailsAt('varuzenoku', m, 300, 0), [], '振り下ろす前は筋なし')
  const tr = illustTrailsAt('varuzenoku', m, 380, 0)
  assert.equal(tr.length, 3, '爪3本')
  for (const t of tr) {
    assert.equal(t.kind, 'claw')
    assert.ok(t.line.at(-1)[1] > t.line[0][1], '筋は上から下へ（新しいほうが下）')
    assert.equal(t.alpha, 1)
  }
  // 振り終わったら、尾が縮みながら薄れて消える
  const fading = illustTrailsAt('varuzenoku', m, d.hitMs + 40, 0)
  assert.ok(fading.length && fading[0].alpha < 1 && fading[0].alpha > 0, '振り終わったら薄れる')
  assert.ok(fading[0].line.length <= tr[0].line.length)
  assert.deepEqual(illustTrailsAt('varuzenoku', m, d.hitMs + 200, 0), [])
})

test('【確定】2026-10-28 焦熱の吐息・終焉の黒焔：下あごを大きく開けて吐く（前脚は下げて口を隠さない）・火は開いた口から出る', () => {
  const M = BOSS_ILLUST_DEFS.varuzenoku.motions
  for (const k of ['breath', 'doom']) {
    const p = { ...motionPoseAt(M[k].keys, M[k].hitMs) }
    assert.ok(p.jaw <= -30, `${k}：吐くときは口を大きく開ける（${p.jaw}°）`)
    assert.ok(p.arm <= -20, `${k}：前脚は下げる（${p.arm}°）`)
    assert.ok(p.glow === 1)
    const mo = mouthPointOf('varuzenoku', p), j = BOSS_ILLUST_DEFS.varuzenoku.cuts.jaw
    assert.ok(mo[1] > j.mouth[1], '火の出る所は上あごと下あごのあいだ')
    const m = bossIllustOf('varuzenoku').motions[k]
    const want = illustPointAt('varuzenoku', { x: 0, y: 0, r: 0, head: 0, wingN: 0, wingF: 0, arm: 0, jaw: 0, glow: 0, ...p }, mo, 'head').map(Math.round)
    assert.deepEqual(m.front, want)
  }
})

test('【確定】2026-10-28 黒翼烈風：両方の翼のふちに風の筋・飛ぶ絵は翼から（2つ・1つめの届く時刻がダメージ）', () => {
  const m = bossIllustOf('varuzenoku').motions.gale
  assert.equal(m.shots.length, 2)
  assert.equal(m.shots[0].delayMs, 0)
  assert.deepEqual(m.front, m.shots[0].front)
  for (const sh of BOSS_ILLUST_DEFS.varuzenoku.motions.gale.shots) assert.match(sh.part, /^wing/)
  const tr = illustTrailsAt('varuzenoku', m, 540, 0)
  assert.ok(tr.length >= 6 && tr.every(t => t.kind === 'wind'))
  assert.deepEqual(new Set(BOSS_ILLUST_DEFS.varuzenoku.motions.gale.trails.map(t => t.part)), new Set(['wingF', 'wingN']))
  // 口から出る技は出どころが1つ
  assert.equal(bossIllustOf('varuzenoku').motions.breath.shots.length, 1)
})

test('道具：多角形の中か（切り分け）', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]]
  assert.equal(inPoly(sq, 5, 5), true)
  assert.equal(inPoly(sq, 11, 5), false)
  const tri = [[0, 0], [10, 0], [0, 10]]
  assert.equal(inPoly(tri, 2, 2), true)
  assert.equal(inPoly(tri, 8, 8), false)
})
