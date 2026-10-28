// v2cap のダンジョンのボスのイラスト版（パーツを重ねて動かす・塗りのエフェクト）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { BOSS_ILLUST } from './bossIllustList.js'
import { BOSS_ART_DIR, BOSS_DEFS, bossFileOf } from './bossArt.js'
import {
  BOSS_ILLUST_DEFS, BOSS_ILLUST_SIZE, ILLUST_PARTS, illustKindOf, illustFxKindOf,
  bossIllustOf, illustPoseAt, idlePoseAt, motionPoseAt, illustPointAt,
} from './bossIllust.js'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'
import { dilate, erode, leftTipOf, fitPart } from '../../../tools/v2cap-boss-illust.mjs'

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

test('黒龍ヴァルゼノクのイラスト版：パーツ4つ（奥の翼・手前の翼・体・頭の順）・回す中心は絵の中・技4つにエフェクト7枚', () => {
  const a = bossIllustOf('varuzenoku')
  assert.ok(a)
  assert.equal(a.kind, 'illust')
  assert.equal(a.base, BOSS_ILLUST_SIZE)
  assert.deepEqual(a.parts.map(p => p.key), ['wingF', 'wingN', 'body', 'head'])
  for (const p of a.parts) {
    assert.ok(p.px >= p.x - 40 && p.px <= p.x + p.w + 40 && p.py >= p.y - 40 && p.py <= p.y + p.h + 40, `${p.key} の回す中心はパーツのそば`)
    assert.match(p.src, /\.webp\?v=[0-9a-f]{8}$/)
  }
  assert.deepEqual(Object.values(a.motions).map(m => m.label), BOSS_DEFS.varuzenoku.motions.map(m => m.file))
  assert.equal(Object.values(a.motions).reduce((n, m) => n + Object.keys(m.fx || {}).length, 0), 7)
  assert.ok(a.mouth[0] < BOSS_ILLUST_SIZE * 0.2, '口は左のはし（相手の方）')
  assert.ok(a.srcs.length === 4 + 7)
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
