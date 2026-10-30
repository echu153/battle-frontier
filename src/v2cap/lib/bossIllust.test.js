// v2cap のダンジョンのボスのイラスト版（パーツを重ねて動かす・塗りのエフェクト）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { BOSS_ILLUST } from './bossIllustList.js'
import { BOSS_ART_DIR, BOSS_DEFS, bossFileOf } from './bossArt.js'
import {
  BOSS_ILLUST_DEFS, BOSS_ILLUST_SIZE, illustPartsOf, illustKindOf, illustFxKindOf,
  bossIllustOf, illustPoseAt, idlePoseAt, motionPoseAt, illustPointAt, illustTrailsAt, mouthPointOf, rotPoint, partMove,
  illustCastPoseAt, CAST_IN_MS, CAST_OUT_MS, swapOpacityOf, illustFreePoseAt, dustEllipsesOf,
  illustCastShowAt, EASES, joltAt, illustBendKindOf, bendFramesOf, illustPoseKindOf, illustShowAt, illustGhostsAt, ART_FADE_MS, artAnchorAt, leanPoint,
  illustBuffShowAt, illustBuffKindOf, buffSceneAt, buffAfterAt, buffHoldOf, buffArtMsOf, BUFF_IN_MS, BUFF_HOLD_MS, BUFF_OUT_MS, BUFF_AURA_IN_MS, BUFF_AURA_OUT_MS, BUFF_ART_MS, BUFF_FLASH_MS,
} from './bossIllust.js'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'
import { DUNGEON_BOSSES } from './dungeon.js'
import { dilate, erode, leftTipOf, fitPart, inPoly } from '../../../tools/v2cap-boss-illust.mjs'

const OUT = new URL(`../../../public${BOSS_ART_DIR}/`, import.meta.url)
const kindsOf = (key, e) => [...illustPartsOf(key).filter(p => e.parts[p]).map(illustKindOf), ...illustPartsOf(key).filter(p => e.parts[p]?.bend).map(illustBendKindOf),
  ...Object.entries(e.poses || {}).flatMap(([mk, ps]) => Object.keys(ps).map(n => illustPoseKindOf(mk, n))),
  ...Object.entries(e.buffs || {}).flatMap(([id, b]) => Object.keys(b).map(w => illustBuffKindOf(id, w))),
  ...Object.entries(e.fx || {}).flatMap(([mk, f]) => Object.keys(f).map(kind => illustFxKindOf(mk, kind)))]

test('【確定】2026-10-28 イラスト版の絵はぜんぶあって軽い（パーツ 120KB・エフェクト 120KB まで）・中身の印は絵と同じ', () => {
  for (const [key, e] of Object.entries(BOSS_ILLUST)) {
    assert.ok(BOSS_ILLUST_DEFS[key] && BOSS_DEFS[key], `${key} の決まりがある`)
    for (const kd of kindsOf(key, e)) {
      const file = new URL(bossFileOf(key, kd), OUT)
      assert.ok(existsSync(file), `${key} ${kd} の絵がある`)
      // 曲げた絵を並べた1枚（-bend）は枚数が多いので 200KB まで
      assert.ok(statSync(file).size < (kd.endsWith('-bend') ? 200 : 120) * 1024, `${key} ${kd} は軽い`)
      assert.equal(e.v?.[kd], versionOf(file), `${key} ${kd} の印（node tools/v2cap-boss-illust.mjs をやり直す）`)
    }
  }
})

test('黒龍ヴァルゼノクのイラスト版：パーツ9つ（奥の翼・手前の翼・しっぽ・しっぽの先・体・首・頭・前脚・下あごの順）・回す中心は絵の中・技4つにエフェクト7枚＋待機の火の玉', () => {
  const a = bossIllustOf('varuzenoku')
  assert.ok(a)
  assert.equal(a.kind, 'illust')
  assert.equal(a.base, BOSS_ILLUST_SIZE)
  // 【確定】2026-10-29 描き直し：しっぽは翼より手前で体より後ろ（立ち絵で足がしっぽに乗っている）
  assert.deepEqual(a.parts.map(p => p.key), ['wingF', 'wingN', 'tail', 'tailT', 'body', 'neck', 'head', 'arm', 'jaw'])
  for (const p of a.parts) {
    assert.ok(p.px >= p.x - 40 && p.px <= p.x + p.w + 40 && p.py >= p.y - 40 && p.py <= p.y + p.h + 40, `${p.key} の回す中心はパーツのそば`)
    assert.match(p.src, /\.webp\?v=[0-9a-f]{8}$/)
  }
  assert.deepEqual(Object.values(a.motions).map(m => m.label), BOSS_DEFS.varuzenoku.motions.map(m => m.file))
  assert.equal(Object.values(a.motions).reduce((n, m) => n + Object.keys(m.fx || {}).length, 0), 7)
  assert.ok(a.mouth[0] < BOSS_ILLUST_SIZE * 0.42, '口は頭の左のはし（相手の方）')
  assert.ok(a.orb && a.srcs.includes(a.orb.src), '待機の火の玉の絵も先に読む')
  assert.ok(a.srcs.length === 9 + 1 + 7 + 8 + 1 + 4, 'パーツ9つ・曲げた絵・エフェクト7枚・技のポーズの絵8枚・火の玉・節目のバフのポーズとオーラ4枚')
  assert.ok(a.srcs.includes(a.parts.find(p => p.key === 'tailT').bend.src))
})

test('エフェクトの時刻：飛ぶ絵は撃ち出す時刻に口（黒翼烈風は翼）から出て flyMs で届く（届いたときがダメージ）・黒爪は当たる絵だけ', () => {
  const a = bossIllustOf('varuzenoku')
  assert.equal(a.motions.claw.fx.fly, undefined)
  assert.equal(a.motions.claw.impactMs, a.motions.claw.hitMs)
  for (const k of ['breath', 'gale', 'doom']) {
    const m = a.motions[k], d = BOSS_ILLUST_DEFS.varuzenoku.effects.find(e => e.motion === k && e.kind === 'fly')
    assert.equal(m.impactMs, m.hitMs + d.flyMs)
    assert.ok(m.hitMs < m.totalMs)
    if (k !== 'gale') assert.ok(m.front[0] < BOSS_ILLUST_SIZE * 0.4, `${k}：撃ち出すときの口は左（${m.front}）`)
    assert.ok(m.front[0] < BOSS_ILLUST_SIZE * 0.6, `${k}：出どころは竜の前のほう（${m.front}）`)
  }
})

test('【確定】2026-10-30 黒龍の待機（ユーザー「体は上下に動かさなくていい」「前後ちょっと違和感あるなー、待機のモーションはたまに羽広げるとかでいいかも」）：ずっと羽ばたかない・体は上下に動かない・ときどき翼を広げてたたむ', () => {
  const idle = BOSS_ILLUST_DEFS.varuzenoku.idle, sp = idle.spread
  assert.equal(idle.periodMs, undefined, 'ずっと羽ばたく形はやめた（10-28 の上下・10-30 の前後）')
  for (let t = 0; t < 20000; t += 37) assert.equal(idlePoseAt(idle, t).y, 0, '体は上下に動かない')
  // ふだんは翼を止める
  const rest = idlePoseAt(idle, sp.atMs - 10)
  assert.ok(rest.wingN === 0 && rest.wingF === 0 && rest.wingNSq === 0 && rest.wingFSq === 0)
  // 広げる：両方の翼を少し上げて（手前は−・奥は＋）長さの向きにのばす（Sq が−）→しばらく広げたまま→たたむ
  const open = idlePoseAt(idle, sp.atMs + 900)
  assert.ok(open.wingN < -5 && open.wingF > 4 && open.wingNSq < -0.15 && open.wingFSq < -0.1, '広げる')
  assert.ok(sp.keys.at(-1)[0] - sp.keys.at(-2)[0] >= 800, 'ゆっくりたたむ')
  const done = idlePoseAt(idle, sp.atMs + sp.keys.at(-1)[0] + 10)
  assert.ok(done.wingN === 0 && done.wingNSq === 0, 'たたんだら止まる')
  assert.ok(Math.abs(idlePoseAt(idle, sp.atMs + sp.everyMs + 900).wingN - open.wingN) < 1e-9, 'くり返す')
  assert.ok(sp.everyMs >= 6000, 'ときどき')
})

test('【確定】2026-10-30 技の姿勢（ポーズの絵で動かす）：ため の絵で後ろへのけぞり、振り抜き の絵で上の体を相手のほうへ押し出す・竜を横へずらさない（ユーザー「しっぽが不自然、一緒に動いちゃってる」＝しっぽと足は地面に残る）', () => {
  const M = BOSS_ILLUST_DEFS.varuzenoku.motions, g = BOSS_ILLUST_DEFS.varuzenoku.ground
  const at = (k, ms) => motionPoseAt(M[k].keys, ms)
  for (const [k, d] of Object.entries(M)) {
    const tS = d.art.find(([, n]) => n === 'strike')[0]
    for (const [, p] of d.keys) assert.ok(!p.x && !p.y && !p.r, `${k}：竜を横へずらさない・浮かせない・回さない（地面を支点に傾けるだけ）`)
    assert.ok(!d.jolt.x && !d.jolt.y && d.jolt.lean > 0, `${k}：当たった瞬間の揺れも地面を支点に`)
    assert.ok(at(k, tS).lean < -0.05, `${k}：ため の絵で後ろへのけぞる`)
    assert.ok(at(k, d.hitMs).lean > 0.15, `${k}：振り抜き の絵で前へ押し出す`)
    assert.deepEqual(Object.values(at(k, 0)).every(v => v === 0), true, `${k} は待機から始まる`)
    assert.equal(at(k, d.totalMs), null, `${k} は流し終わったら待機へ`)
    // 地面の点（しっぽと足）は技のあいだずっと動かない・上の点ほど前へ出る
    const m = bossIllustOf('varuzenoku').motions[k]
    for (let t = 0; t < d.totalMs; t += 20) {
      const pose = illustPoseAt('varuzenoku', m, t, 0)
      const q = illustPointAt('varuzenoku', { ...pose, tailT: 0 }, [150, g], 'body')
      assert.ok(Math.abs(q[0] - 150) < 1e-9 && Math.abs(q[1] - g) < 1e-9, `${k}：${t}ms の地面の点`)
    }
    const hit = illustPoseAt('varuzenoku', m, d.hitMs, 0)
    assert.ok(illustPointAt('varuzenoku', hit, [300, 150], 'body')[0] < 300 - 50, `${k}：上の体は前（左）へ出る`)
  }
  assert.ok(at('claw', M.claw.hitMs).lean >= 0.25, '黒爪がいちばん深く押し出す')
  // 傾ける：画面の skewX と同じ（地面の高さは動かない・上ほど左）
  assert.deepEqual(leanPoint([100, 590], 590, 0.3), [100, 590])
  assert.deepEqual(leanPoint([100, 90], 590, 0.2), [0, 90])
  assert.deepEqual(leanPoint([100, 90], null, 0.2), [100, 90])
  // 技のあいだは広げた翼を弱める
  const mm = { keys: M.claw.keys }, sp = BOSS_ILLUST_DEFS.varuzenoku.idle.spread
  const p = illustPoseAt('varuzenoku', mm, 1, sp.atMs + 900), idle = idlePoseAt(BOSS_ILLUST_DEFS.varuzenoku.idle, sp.atMs + 900)
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
  assert.ok(by.arm.w > 100 && by.arm.x < 140, '前脚は左へ伸びる爪まで')
  const jt = BOSS_ILLUST_DEFS.varuzenoku.cuts.jaw.take
  assert.ok(by.jaw.x <= Math.min(...jt.map(q => q[0])) + 6 && by.jaw.w < 80, '下あごは口の先から付け根まで')
  assert.deepEqual(a.jaw.pivot, BOSS_ILLUST_DEFS.varuzenoku.cuts.jaw.pivot)
  // 下あごの点は下あご→頭→全体の順に回る
  const zero = { x: 0, y: 0, r: 0, head: 0, wingN: 0, wingF: 0, arm: 0, jaw: 0, glow: 0 }
  const pt = [260, 208]   // あごの先
  const [x0, y0] = illustPointAt('varuzenoku', { ...zero, jaw: -30 }, pt, 'jaw')
  assert.ok(y0 > pt[1] + 5, '下あごを開くと先が下がる')
  const both = illustPointAt('varuzenoku', { ...zero, jaw: -30, head: 20 }, pt, 'jaw')
  const want = rotPoint([x0, y0], [by.head.px, by.head.py], 20)
  assert.ok(Math.abs(both[0] - want[0]) < 1e-9 && Math.abs(both[1] - want[1]) < 1e-9)
})

test('【確定】2026-10-30 黒爪：ため の絵で右の前脚を振りかぶり、振り抜き の絵で飛び込んで左下へ振り抜く・爪あとは振りかぶった爪から振り抜いた爪までの3本の弧・当たる絵は引いて出す', () => {
  const d = BOSS_ILLUST_DEFS.varuzenoku.motions.claw
  const m = bossIllustOf('varuzenoku').motions.claw
  assert.equal(m.fx.hit.wipe, true)
  assert.deepEqual(d.trails || [], [], '部品の前脚の筋は使わない（前脚は隠れている）')
  assert.equal(d.arcs.length, 3, '爪3本')
  const tS = d.art.find(([, n]) => n === 'strike')[0]
  for (const a of d.arcs) {
    assert.equal(a.kind, 'claw')
    assert.ok(a.fromMs === tS && a.toMs === d.hitMs, '振り抜きの絵に変わってから当たるまでに引く')
    assert.ok(a.pts[0][0] > a.pts.at(-1)[0] + 300 && a.pts[0][1] < a.pts.at(-1)[1] - 300, '右上（振りかぶった爪）から左下（振り抜いた爪）へ')
  }
  assert.deepEqual(illustTrailsAt('varuzenoku', m, tS - 10, 0), [], '振り抜く前は筋なし')
  const tr = illustTrailsAt('varuzenoku', m, (tS + d.hitMs) / 2, 0)
  assert.equal(tr.length, 3)
  const fading = illustTrailsAt('varuzenoku', m, d.hitMs + 60, 0)
  assert.ok(fading.length === 3 && fading[0].alpha < 1 && fading[0].alpha > 0, '振り終わったら薄れる')
  assert.deepEqual(illustTrailsAt('varuzenoku', m, d.hitMs + 250, 0), [])
})

test('【確定】2026-10-30 焦熱の吐息・終焉の黒焔：炎は 振り抜き の絵の開いた口から出る・黒焔の火の玉は ため の絵の上を向いた口でためる', () => {
  const M = BOSS_ILLUST_DEFS.varuzenoku.motions
  const a = bossIllustOf('varuzenoku')
  for (const k of ['breath', 'doom']) {
    const m = a.motions[k], mouth = M[k].anchors.strike.mouth
    assert.ok(mouth[0] < 120, `${k}：振り抜き の絵の口は左（相手の方）`)
    const p = { ...motionPoseAt(M[k].keys, M[k].hitMs) }
    const want = illustPointAt('varuzenoku', { x: 0, y: 0, r: 0, ...p }, mouth, 'body').map(Math.round)
    assert.deepEqual(m.front, want, `${k}：撃つ時刻の口（全体の姿勢だけで動かす）`)
    assert.deepEqual(m.anchors, M[k].anchors)
  }
  // 黒焔のためる火の玉：ため の絵が出ているあいだは上を向いた口・出ていないときは null（部品の口）
  const d = a.motions.doom, tW = M.doom.art.find(([, n]) => n === 'windup')[0]
  const pose = illustPoseAt('varuzenoku', d, tW + 300, 0)
  const up = artAnchorAt('varuzenoku', d, tW + 300, pose, 'mouth')
  assert.deepEqual(up, illustPointAt('varuzenoku', pose, M.doom.anchors.windup.mouth, 'body'))
  assert.ok(up[1] < 150, '口は上のほう')
  assert.equal(artAnchorAt('varuzenoku', d, tW - 100, illustPoseAt('varuzenoku', d, tW - 100, 0), 'mouth'), null)
  assert.ok(d.charge.fromMs >= tW && d.charge.toMs === d.hitMs && d.fx[d.charge.kind])
})

test('【確定】2026-10-30 黒翼烈風：風は 打ち下ろし の絵の胸の前（いちばん大きい＝ダメージ）と翼の先から相手へ・打ち下ろすあいだ翼のふちに風の筋', () => {
  const m = bossIllustOf('varuzenoku').motions.gale, d = BOSS_ILLUST_DEFS.varuzenoku.motions.gale
  assert.equal(m.shots.length, 3)
  assert.equal(d.shots[0].at, 'chest')
  assert.ok(d.shots[0].size > Math.max(...d.shots.slice(1).map(sh => sh.size)), '胸の前の風がいちばん大きい')
  assert.ok(d.shots.every(sh => d.anchors.strike[sh.at]), '出どころは打ち下ろしの絵の上の点')
  assert.ok(d.shots.every(sh => Math.abs(sh.delayMs) <= 60), '打ち下ろした時刻にまとめて出る')
  d.shots.forEach((sh, i) => {
    const p = motionPoseAt(d.keys, d.hitMs + sh.delayMs)
    assert.deepEqual(m.shots[i].front, illustPointAt('varuzenoku', { x: 0, y: 0, r: 0, ...p }, d.anchors.strike[sh.at], 'body').map(Math.round))
  })
  assert.deepEqual(m.front, m.shots[0].front)
  const tS = d.art.find(([, n]) => n === 'strike')[0]
  assert.deepEqual(illustTrailsAt('varuzenoku', m, tS - 10, 0), [], '広げているあいだは筋なし')
  const tr = illustTrailsAt('varuzenoku', m, (tS + d.hitMs) / 2, 0)
  assert.ok(tr.length === 2 && tr.every(t => t.kind === 'wind'), '打ち下ろすあいだ翼のふちに筋')
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

test('【確定】2026-10-28 首を2か所で曲げる（付け根＝首・あごの後ろ＝頭）・終焉の黒焔は口に火の玉をためる', () => {
  const a = bossIllustOf('varuzenoku')
  const by = Object.fromEntries(a.parts.map(p => [p.key, p]))
  // 2026-10-29 描き直し：首は立ち絵の体から、頭は首から切り分ける（体は回らないので首はほかのパーツと同じ並び）
  assert.equal(by.neck.parent, 'body')
  assert.equal(by.neck.nest, false, '首は体の上に重ねる（体は回らない）')
  assert.equal(by.head.parent, 'neck')
  assert.equal(by.head.nest, true, '頭は首の中（首を上げると頭もついてくる）')
  assert.deepEqual([by.head.px, by.head.py], BOSS_ILLUST_DEFS.varuzenoku.cuts.head.pivot)
  assert.deepEqual([by.neck.px, by.neck.py], BOSS_ILLUST_DEFS.varuzenoku.cuts.neck.pivot)
  assert.ok(by.neck.py > by.head.py + 40, '首の付け根は頭の回す中心より下')
  // 首を上げると口が上がる（部品で動かすとき・2026-10-29 描き直した絵は首が短い）
  const zero = { x: 0, y: 0, r: 0, neck: 0, head: 0, wingN: 0, wingF: 0, wingNSq: 0, wingFSq: 0, arm: 0, jaw: 0, glow: 0 }
  const rest = illustPointAt('varuzenoku', zero, mouthPointOf('varuzenoku', zero), 'head')
  const p = { ...zero, neck: 14, head: 10, r: 8 }
  const up = illustPointAt('varuzenoku', p, mouthPointOf('varuzenoku', p), 'head')
  assert.ok(up[1] < rest[1] - 30, `口が上がる（${rest.map(Math.round)} → ${up.map(Math.round)}）`)
  // 火の玉は撃つまで口でためる（当たる絵を使う）
  const M = BOSS_ILLUST_DEFS.varuzenoku.motions.doom, m = a.motions.doom
  assert.deepEqual(m.charge, M.charge)
  assert.ok(m.charge.fromMs < m.charge.toMs && m.charge.toMs === m.hitMs)
  assert.ok(m.fx[m.charge.kind])
})

test('翼を縮める（partMove）：長さの向き（ax）に縮めてから回す・illustPointAt は親へたどる', () => {
  const p = { key: 'wingN', px: 100, py: 100, ax: 0 }
  const q = partMove([150, 100], p, { wingN: 0, wingNSq: 0.2 })
  assert.ok(Math.abs(q[0] - 140) < 1e-9 && Math.abs(q[1] - 100) < 1e-9, '長さの向きに 20% 縮む')
  const q2 = partMove([100, 150], p, { wingN: 0, wingNSq: 0.2 })
  assert.ok(Math.abs(q2[0] - 100) < 1e-9 && Math.abs(q2[1] - 150) < 1e-9, '横の向きは縮まない')
  const q3 = partMove([150, 100], { ...p, ax: 90 }, { wingN: 90, wingNSq: 0 })
  assert.ok(Math.abs(q3[0] - 100) < 1e-9 && Math.abs(q3[1] - 150) < 1e-9, '縮めなければ回すだけ')
  const zero = { x: 0, y: 0, r: 0, neck: 0, head: 0, wingN: 0, wingF: 0, wingNSq: 0, wingFSq: 0, arm: 0, jaw: 0, glow: 0 }
  const a = BOSS_ILLUST.varuzenoku
  const pt = [80, 260]
  const want = partMove(partMove(pt, { ...a.parts.head, key: 'head' }, { ...zero, head: 10, neck: 20 }), { ...a.parts.neck, key: 'neck' }, { ...zero, head: 10, neck: 20 })
  const got = illustPointAt('varuzenoku', { ...zero, head: 10, neck: 20 }, pt, 'head')
  assert.ok(Math.abs(got[0] - want[0]) < 1e-9 && Math.abs(got[1] - want[1]) < 1e-9, '頭→首→体（回らない）の順にたどる')
})

test('【確定】2026-10-29 黒龍の描き直し：立ち絵が体・体の形の外を翼2枚としっぽに分ける・翼としっぽは付け根で回す（決まりの pivots）', () => {
  const a = BOSS_ILLUST.varuzenoku, d = BOSS_ILLUST_DEFS.varuzenoku
  assert.equal(d.base, 'stand')
  assert.equal(d.split.by, '体', 'ChatGPT の体（翼としっぽの無い体）は体の形を知るためだけ')
  assert.equal(d.fill, undefined, 'ChatGPT の体ですき間を埋めない（頭や腕が二重に見える）')
  assert.deepEqual(Object.keys(d.split.parts), ['wingF', 'wingN', 'tail'])
  for (const k of ['wingF', 'wingN', 'tail']) {
    assert.deepEqual([a.parts[k].px, a.parts[k].py], d.pivots[k], `${k} は付け根で回す`)
    assert.ok(inPoly(d.split.parts[k].take, ...d.pivots[k]), `${k} の回す中心は分ける所の中`)
  }
  // しっぽを持ち上げるのは左の足より左だけ（足の下まで持ち上げると、足に隠れていた所が足の横にはみ出した）・付け根は体にも残す（take が drop より広い）
  const t = d.split.parts.tail
  assert.ok(Math.max(...t.take.map(q => q[0])) > Math.max(...t.drop.map(q => q[0])), 'しっぽの付け根は体にも残る')
  assert.ok(d.pivots.tail[0] < 240)
  // 手前の翼は頭の後ろの角の先より右（角の先が翼といっしょに動いた）
  assert.equal(inPoly(d.split.parts.wingN.take, 400, 95), false)
  assert.equal(a.parts.tailT.parent, 'tail')
})

test('【確定】2026-10-29 黒龍の待機：羽ばたき・首と頭の揺れ・ときどきしっぽの巻いた先で地面を打つ（砂ぼこりと小さな揺れ）・ときどき口に火の玉', () => {
  const idle = BOSS_ILLUST_DEFS.varuzenoku.idle, s = idle.slam, o = idle.orb
  // 【確定】2026-10-29 ユーザー「しっぽ動かすの不自然って思わない？」→選んだ「左の巻いた先だけしならせる」：地面のしっぽ（tail）は動かさない。
  //   巻いた先（tailT＝曲げる°）を後ろへ引いて（−）ため、一気に振り下ろして（＋）先で地面を打ち、小さく跳ね返って戻る
  const slamAt = (ms) => motionPoseAt(s.keys, ms)
  const back = Math.min(...s.keys.map(([, k]) => k.tailT ?? 0)), down = slamAt(s.hitMs).tailT
  assert.ok(back < -8, `ためで後ろへ引く（${back}°）`)
  assert.ok(down > 35, `先で地面を打つ（${down}°）`)
  const before = s.keys.filter(([t]) => t < s.hitMs).at(-1)
  assert.ok(s.hitMs - before[0] <= 120 && s.keys.find(([t]) => t === s.hitMs)[2] === 'out', '振り下ろしは速い')
  assert.ok(slamAt(s.hitMs + 100).tailT < down && slamAt(s.hitMs + 240).tailT > slamAt(s.hitMs + 100).tailT, '小さく跳ね返る')
  for (const [, k] of s.keys) assert.equal(k.tail ?? 0, 0, '地面のしっぽは動かさない（足の下との境目で折れて見えた）')
  for (let t = 0; t < 12000; t += 37) assert.equal(idlePoseAt(idle, t).tail, 0)
  // 曲げる範囲に収まる（範囲の外は端の絵で止まって見える）：ため・打つ・ふだんの揺れを足しても
  const b = BOSS_ILLUST_DEFS.varuzenoku.bend.tailT
  const swing = idle.sway.tailT[0]
  assert.ok(back - swing >= b.from && down + swing <= b.to, `曲げる範囲 ${b.from}〜${b.to}°`)
  const lift = idlePoseAt(idle, s.atMs + 700), after = idlePoseAt(idle, s.atMs + s.keys.at(-1)[0] + 10)
  assert.ok(Math.abs(after.tailT) <= swing + 1e-9, '打ったあとは揺れだけに戻る')
  const [amp, per, ph] = idle.sway.tailT, swayAt = (ms) => amp * Math.sin(2 * Math.PI * (ms / per + ph))
  assert.ok(Math.abs((idlePoseAt(idle, s.atMs + s.everyMs + 700).tailT - swayAt(s.atMs + s.everyMs + 700)) - (lift.tailT - swayAt(s.atMs + 700))) < 1e-9, 'くり返す')
  // ふだんはゆっくり揺れる
  const sw = Array.from({ length: 30 }, (_, i) => idlePoseAt(idle, i * 80).tailT)
  assert.ok(Math.max(...sw) - Math.min(...sw) > 2)
  // 打った時刻から砂ぼこりと揺れ
  assert.equal(idlePoseAt(idle, s.atMs + s.hitMs - 10).dust, 0)
  const d1 = idlePoseAt(idle, s.atMs + s.hitMs + 100)
  assert.ok(d1.dust > 0 && d1.dust < 1)
  assert.ok(Math.abs(d1.x) > 0, '小さく揺れる')
  assert.equal(idlePoseAt(idle, s.atMs + s.hitMs + s.dustMs + 10).dust, 0)
  // 砂ぼこり：はじめは薄く（すぐ濃くなる）、広がりながら薄れる
  const [e0] = dustEllipsesOf([[100, 580]], 0.01), [e1] = dustEllipsesOf([[100, 580]], 0.3), [e2] = dustEllipsesOf([[100, 580]], 0.95)
  assert.ok(e0.op < e1.op && e2.op < e1.op && e1.rx > e0.rx && e1.cx < e0.cx)
  // 火の玉：ふくらむ→ゆらめく→縮みながら消える。出ているあいだは口を少し開けて光る
  const g = idlePoseAt(idle, o.atMs + o.growMs / 2), full = idlePoseAt(idle, o.atMs + o.growMs + o.holdMs / 2)
  const fade = idlePoseAt(idle, o.atMs + o.growMs + o.holdMs + o.fadeMs * 0.7), gone = idlePoseAt(idle, o.atMs + o.growMs + o.holdMs + o.fadeMs + 10)
  assert.ok(g.orb > 0 && g.orb < full.orb && Math.abs(full.orb - 1) < 1e-9)
  assert.ok(fade.orb < full.orb && fade.orbOp < 1, '消えるときは縮む（ふくらみながら薄れると茶色くにごった）')
  assert.equal(gone.orb, 0)
  assert.ok(full.jaw < 0 && full.glow > 0)
  // 技のあいだもしっぽはそのまま（技の頭で跳ねない）・火の玉は出さない
  const m = { keys: BOSS_ILLUST_DEFS.varuzenoku.motions.claw.keys }
  assert.equal(illustPoseAt('varuzenoku', m, 100, s.atMs + 700).tailT, lift.tailT)
  assert.equal(illustPoseAt('varuzenoku', m, 100, o.atMs + o.growMs + 100).orb, 0)
  // 首と頭はゆっくり小さく揺れる
  const necks = Array.from({ length: 80 }, (_, i) => idlePoseAt(idle, i * 100).neck)
  assert.ok(Math.max(...necks) > 0.5 && Math.max(...necks.map(Math.abs)) <= 2)
})

test('【確定】2026-10-29 雨摩座のイラスト版：立ち絵が体・頭と両手は立ち絵から切り分ける（水の帯がいちばん奥）・右腕は3つの絵を切り替える（手前の手はふだんの腕の中）・回す中心は首と袖口', () => {
  const a = bossIllustOf('amaza'), d = BOSS_ILLUST_DEFS.amaza
  assert.ok(a)
  assert.deepEqual(a.parts.map(p => p.key), ['water', 'body', 'armF', 'armD', 'armN', 'head', 'armC', 'armU'])
  const by = Object.fromEntries(a.parts.map(p => [p.key, p]))
  assert.equal(by.armN.parent, 'armD')
  assert.equal(by.armN.nest, true, '手前の手はふだんの腕の中（いっしょに消える）')
  assert.deepEqual(by.armD.swap, { others: ['armCOn', 'armUOn'] })
  assert.deepEqual(by.armC.swap, { on: 'armCOn' })
  assert.deepEqual(by.armU.swap, { on: 'armUOn' })
  assert.ok(by.armU.y < 0, `掲げた指先は枠の上へ出る（${by.armU.y}）`)
  assert.ok(by.armC.x + by.armC.w > 280, '胸元の手は胸の前まで')
  for (const k of ['head', 'armN', 'armF']) {
    const p = by[k]
    assert.deepEqual([p.px, p.py], d.cuts[k].pivot)
    if (k !== 'armN') assert.equal(p.nest, false, `${k} は体の中に重ねない（体は回さない）`)
    assert.ok(p.px >= p.x - 10 && p.px <= p.x + p.w + 10 && p.py >= p.y - 10 && p.py <= p.y + p.h + 10, `${k} の回す中心はパーツのそば`)
  }
  assert.equal(a.jaw, null, '口は開けない（人の形）')
})

test('【確定】2026-10-29 雨摩座の待機：揺れの足し算（浮き沈み・頭・両手・水の帯）・ゆっくりで小さい', () => {
  const idle = BOSS_ILLUST_DEFS.amaza.idle
  const poses = Array.from({ length: 200 }, (_, i) => idlePoseAt(idle, i * 97))
  for (const [k, [amp, per]] of Object.entries(idle.sway)) {
    const vs = poses.map(p => p[k])
    assert.ok(Math.max(...vs) > amp * 0.8 && Math.min(...vs) < -amp * 0.8, `${k} は ±${amp} で揺れる`)
    assert.ok(per >= 3000, `${k} はゆっくり（${per}ms）`)
  }
  assert.ok(idle.sway.y[0] <= 0.02 && idle.sway.head[0] <= 3, '小さく揺れる')
  assert.equal(poses[0].wingN, 0, '翼は無い')
})

test('【確定】2026-10-29 雨摩座の技4つ：右手を胸元に引き寄せて（大技は真上に掲げて）ため、撃つ時刻に相手の方へさっと払う（ふだんの腕に戻る・前へ出る）・待機から始まって待機へ戻る・エフェクト7枚（＋水天葬と氷雨の流れる水の絵）', () => {
  const a = bossIllustOf('amaza'), D = BOSS_ILLUST_DEFS.amaza.motions
  assert.deepEqual(Object.values(a.motions).map(m => m.label), BOSS_DEFS.amaza.motions.map(m => m.file))
  assert.equal(Object.values(a.motions).reduce((n, m) => n + Object.keys(m.fx || {}).length, 0), 9)
  assert.equal(a.srcs.length, 8 + 9 + 8 + 4, 'パーツ8・エフェクト9・ポーズの絵8・節目のバフのポーズとオーラ4枚')
  assert.ok(a.motions.deluge.fx.flow && a.motions.sleet.fx.flow, '水天葬と氷雨の流れる水の絵（描いた滝の柱・雨の所から作る）')
  const armD = a.parts.find(p => p.key === 'armD').swap
  for (const [k, M] of Object.entries(D)) {
    const at = (ms) => motionPoseAt(M.keys, ms)
    const [tUp, up] = M.keys.at(-4), on = k === 'deluge' || k === 'sleet' ? 'armUOn' : 'armCOn'   // 払う前のため（氷雨と大技は真上に掲げる）
    assert.equal(up[on], 1, `${k}：払う前は構えの腕（${on}）`)
    assert.ok(up.y < 0 && up.armN > 8, `${k}：ためるときは浮いて、隠れた手前の手を上げておく`)
    assert.equal(swapOpacityOf(armD, at(tUp)), 0, `${k}：ためているあいだ、ふだんの腕は見えない`)
    assert.ok(!at(M.hitMs).armCOn && !at(M.hitMs).armUOn, `${k}：撃つ時刻はふだんの差しのべた腕`)
    assert.ok(M.hitMs - tUp <= 80, `${k}：払うのは速い（さっと）`)
    assert.ok(at(M.hitMs).armN < -8 && at(M.hitMs).x < -0.02, `${k}：撃つときは手を相手の方へ振り下ろして前へ出る`)
    assert.ok(Object.values(at(0)).every(v => v === 0), `${k}：待機から始まる`)
    assert.equal(at(M.totalMs), null)
    assert.ok(M.hitMs < M.totalMs)
  }
  assert.ok(D.sleet.keys[2][1].armF < -8 && D.sleet.keys[2][1].head > 4, '氷雨：天を仰いで奥の手を差し上げる')
})

test('【確定】2026-10-29 氷雨は右腕を真上に掲げて、ためずにすぐ振り下ろす（ユーザー「氷雨も手上げるモーションで出すようにして、ためは不要」）', () => {
  const S = BOSS_ILLUST_DEFS.amaza.motions.sleet, m = bossIllustOf('amaza').motions.sleet
  const up = S.keys.filter(([, k]) => k.armUOn === 1).map(([t]) => t)
  assert.ok(up.length > 0, '真上に掲げる（水天葬と同じ構えの絵）')
  assert.ok(S.keys.every(([, k]) => !k.armCOn), '胸元に引き寄せない')
  assert.ok(S.hitMs - up[0] <= 250, `掲げてから振り下ろすまで ${S.hitMs - up[0]}ms（ためない）`)
  // 掲げているあいだも止まらない（同じ姿勢のまま待つ所が無い＝のけぞり続ける）
  for (let i = 1; i < up.length; i++) {
    const a = S.keys.find(([t]) => t === up[i - 1])[1], b = S.keys.find(([t]) => t === up[i])[1]
    assert.ok(b.y < a.y && b.head > a.head, '掲げながら浮いてのけぞり続ける')
  }
  assert.equal(m.charge, null, '雲をためない（水天葬だけ）')
  // 水の筋は掲げた手から差しのべた指先まで（水天葬と同じ通り道）
  // 水の筋は構えの絵の掲げた手から振り抜きの絵の手まで（2026-10-30 ポーズの絵）
  assert.deepEqual(S.arcs[0].pts[0], S.anchors.windup.hand)
  assert.deepEqual(S.arcs[0].pts.at(-1), S.anchors.strike.hand)
  assert.equal(S.arcs[0].toMs, S.hitMs)
  // 水天葬は今までどおり1.5秒溜める
  const Dl = BOSS_ILLUST_DEFS.amaza.motions.deluge
  assert.ok(Dl.hitMs - Dl.keys.find(([, k]) => k.armUOn === 1)[0] >= 1400)
})

test('【確定】2026-10-29 雨摩座のエフェクト：雨礫・水縛の帯は手前の手の指先から飛ぶ／氷雨・水天葬は飛ばずに相手の頭上から降りる（降りきったときがダメージ）／水縛の帯は相手の体で締まる', () => {
  const a = bossIllustOf('amaza'), E = BOSS_ILLUST_DEFS.amaza.effects
  for (const k of ['shot', 'bind']) {
    const m = a.motions[k], fly = E.find(e => e.motion === k && e.kind === 'fly')
    assert.equal(m.impactMs, m.hitMs + fly.flyMs)
    // 2026-10-30 ポーズの絵：出どころは振り抜きの絵の手（anchors.strike.hand を撃つ時刻の全体の姿勢で動かした所）
    const D = BOSS_ILLUST_DEFS.amaza.motions[k]
    const want = illustPointAt('amaza', { ...illustPoseAt('amaza', null, 0, 0), ...motionPoseAt(D.keys, D.hitMs) }, D.anchors.strike.hand, 'body').map(Math.round)
    assert.ok(Math.hypot(m.front[0] - want[0], m.front[1] - want[1]) <= 1, `${k}：出どころは振り抜きの絵の手（${m.front}）`)
    assert.ok(m.front[0] < 60, '相手のほう（左）へ伸ばした手')
  }
  for (const k of ['sleet', 'deluge']) {
    const m = a.motions[k]
    assert.equal(m.fx.fly, undefined, `${k} は飛ばない`)
    assert.equal(m.fx.hit.on, 'feet')
    assert.equal(m.fx.hit.anim, 'drop')
    assert.ok(m.fx.hit.lead > 0)
    assert.equal(m.impactMs, m.hitMs + m.fx.hit.lead, `${k}：降りきったときがダメージ`)
  }
  assert.equal(a.motions.bind.fx.hit.on, 'body')
  assert.equal(a.motions.bind.fx.hit.anim, 'bind')
  assert.equal(a.motions.shot.fx.hit.on, null, '雨礫の当たる絵は体の真ん中（黒龍と同じ）')
  // 水天葬の渦の雲：相手の頭上・撃つ時刻まで出て、滝が落ちたら薄れる。重ねる順は滝が先（雲が手前）
  const d = a.motions.deluge
  assert.equal(d.charge.kind, 'charge')
  assert.equal(d.fx.charge.on, 'sky', '雲は空の上のほう（ユーザー「もっと上から降らせて」）')
  assert.equal(d.charge.toMs, d.hitMs)
  assert.ok(d.charge.holdMs > 0)
  assert.deepEqual(Object.keys(d.fx), ['hit', 'flow', 'charge'])
  assert.ok(Object.values(a.motions).every(m => m === d || !m.charge), '雲を出すのは水天葬だけ')
})

test('【確定】2026-10-29 構え（水天葬の5秒）：右腕を真上に掲げる（震えない）・構えのすぐあとの技は構えの姿勢からつなぐ（ふだんの腕が一瞬も出ない）・黒龍は構えても待機のまま', () => {
  const C = BOSS_ILLUST_DEFS.amaza.cast, idle = BOSS_ILLUST_DEFS.amaza.idle
  const p0 = illustCastPoseAt('amaza', 0, 1000)
  assert.deepEqual(p0, idlePoseAt(idle, 1000), '構えはじめは待機と同じ（急に跳ねない）')
  const held = illustCastPoseAt('amaza', CAST_IN_MS + 2000, 1000), base = idlePoseAt(idle, 1000)
  for (const f of ['armUOn', 'armF', 'y', 'head']) {
    assert.ok(Math.abs(held[f] - base[f] - C.pose[f]) < 1e-9, `${f}：構えの姿勢のまま（震えない）`)
  }
  assert.ok(C.pose.armUOn === 1 && C.pose.armF < -8 && C.pose.y < 0, '右腕を真上に掲げ（構えの絵）、奥の手も上げて浮く')
  // 構えのすぐあとの技：はじめは構えの姿勢・CAST_OUT_MS たてば技の動きだけ
  const m = bossIllustOf('amaza').motions.deluge
  const t = 1000
  const s0 = illustPoseAt('amaza', m, 0, t, true), s1 = illustPoseAt('amaza', m, CAST_OUT_MS, t, true), n1 = illustPoseAt('amaza', m, CAST_OUT_MS, t)
  assert.ok(Math.abs(s0.armF - base.armF - C.pose.armF) < 1e-9 && s0.armUOn === 1, '構えの姿勢から始まる')
  assert.deepEqual(s1, n1)
  // 構えの姿勢と、ためる動き（掲げきった所）は同じ形（つないでも跳ねない）
  const top = BOSS_ILLUST_DEFS.amaza.motions.deluge.keys.find(([ms]) => ms === 860)[1]
  for (const f of ['armUOn', 'armF', 'head', 'r', 'y']) assert.ok(Math.abs(top[f] - C.pose[f]) < 1e-9, `${f}：構えと技のためが同じ形`)
  // 構えのすぐあとも、構えずに流しても、掲げた腕から振り下ろすまで ふだんの腕は出ない（技のはじめ120ms で掲げきる・溜めは1520ms まで）
  const armD = bossIllustOf('amaza').parts.find(p => p.key === 'armD').swap
  for (let ms = 0; ms <= 1520; ms += 20) assert.equal(swapOpacityOf(armD, illustPoseAt('amaza', m, ms, t, true)), 0, `構えのあと ${ms}ms`)
  for (let ms = 120; ms <= 1520; ms += 20) assert.equal(swapOpacityOf(armD, illustPoseAt('amaza', m, ms, t)), 0, `構えなし ${ms}ms`)
  // 技のあいだも待機の揺れはそのまま（技の頭と終わりで跳ねない）
  assert.deepEqual(illustPoseAt('amaza', m, 0, t), idlePoseAt(idle, t))
  // 【確定】2026-10-30 黒龍の構え（終焉の黒焔）：のけぞりは技の途中から流す時刻（castSkipMs）と同じ＝つなぎ目で跳ねない
  const doom = bossIllustOf('varuzenoku').motions.doom
  const cp = illustCastPoseAt('varuzenoku', 3000, 500), jp = illustPoseAt('varuzenoku', doom, doom.castSkipMs, 500)
  assert.equal(cp.lean, BOSS_ILLUST_DEFS.varuzenoku.cast.pose.lean)
  assert.ok(Math.abs(cp.lean - jp.lean) < 1e-9, '構えのおわりと技の途中の のけぞりが同じ')
})

test('【確定】2026-10-29 雨摩座の手振り：構えの絵の切り替え（前半で新しい絵が出きり、後半でふだんの腕が消える＝途中で透けない）・払う手の水の筋は胸元から差しのべた指先まで', () => {
  const D = { others: ['armCOn', 'armUOn'] }, C = { on: 'armCOn' }
  for (const w of [0, 0.25, 0.5, 0.75, 1]) {
    const pose = { armCOn: w }
    assert.equal(Math.max(swapOpacityOf(D, pose), swapOpacityOf(C, pose)), 1, `${w}：どちらかは必ず出ている`)
  }
  assert.equal(swapOpacityOf(D, { armCOn: 0 }), 1)
  assert.equal(swapOpacityOf(C, { armCOn: 0 }), 0)
  assert.equal(swapOpacityOf(D, { armCOn: 1 }), 0)
  assert.equal(swapOpacityOf(C, { armCOn: 1 }), 1)
  assert.equal(swapOpacityOf(D, { armUOn: 1.6 }), 0, '1を超えても1')
  // 水の筋：fromMs〜toMs で先へ描き足し、toMs のあと薄れながら根もとから消える
  const m = bossIllustOf('amaza').motions.shot, arc = BOSS_ILLUST_DEFS.amaza.motions.shot.arcs[0]
  assert.deepEqual(illustTrailsAt('amaza', m, arc.fromMs - 1, 0), [])
  const mid = illustTrailsAt('amaza', m, (arc.fromMs + arc.toMs) / 2, 0)[0]
  const end = illustTrailsAt('amaza', m, arc.toMs, 0)[0]
  assert.equal(end.kind, 'water')
  assert.equal(end.alpha, 1)
  assert.ok(end.line.length > mid.line.length, '先へ描き足す')
  const tip = illustPointAt('amaza', illustPoseAt('amaza', m, arc.toMs, 0), BOSS_ILLUST_DEFS.amaza.motions.shot.anchors.strike.hand, 'body')
  assert.ok(Math.hypot(end.line.at(-1)[0] - tip[0], end.line.at(-1)[1] - tip[1]) < 1, '水の筋は振り抜きの絵の手まで')
  const fading = illustTrailsAt('amaza', m, arc.toMs + arc.fadeMs / 2, 0)[0]
  assert.ok(fading.alpha < 1 && fading.line.length < end.line.length, '薄れながら根もとから消える')
  assert.deepEqual(illustTrailsAt('amaza', m, arc.toMs + arc.fadeMs, 0), [])
})

test('【確定】2026-10-29 雨摩座の水の帯は体の動きから切り離す（ユーザー「攻撃するとき、水の帯は干渉せずに動いてほしい」）・大技は1.5秒溜めて、だんだん高く浮く（ユーザー「大技はもうちょっと溜めていい」「溜めるとき、別に震えなくていい」）', () => {
  const a = bossIllustOf('amaza'), d = BOSS_ILLUST_DEFS.amaza
  assert.deepEqual(a.parts.filter(p => p.free).map(p => p.key), ['water'])
  assert.equal(bossIllustOf('varuzenoku').parts.some(p => p.free), false, '黒龍は今までどおり')
  // 水の帯の姿勢は待機のまま（技や構えの姿勢は使わない）。技と構えの決まりにも水の帯の角度を書かない
  for (const t of [0, 1234, 5000]) assert.deepEqual(illustFreePoseAt('amaza', t), idlePoseAt(d.idle, t))
  for (const M of Object.values(d.motions)) for (const [, k] of M.keys) assert.equal(k.water, undefined)
  assert.equal(d.cast.pose.water, undefined)
  // 溜め：掲げきってから振り下ろすまで1秒以上・いちばん上へだんだん浮く・震えない
  const D = d.motions.deluge, m = a.motions.deluge
  const raised = D.keys.find(([, k]) => k.armUOn === 1)[0]
  assert.ok(D.hitMs - raised >= 1400, `溜め ${D.hitMs - raised}ms`)
  const ys = D.keys.filter(([t, k]) => t >= 300 && k.armUOn === 1).map(([, k]) => k.y)
  assert.ok(ys.every((y, i) => i === 0 || y < ys[i - 1]), 'だんだん高く浮く')
  assert.equal(m.charge.toMs, m.hitMs)
  const amp = (from, to) => { let mx = 0; for (let t = from; t < to; t += 3) mx = Math.max(mx, Math.abs(illustPoseAt('amaza', m, t, 0).armF - motionPoseAt(D.keys, t).armF - idlePoseAt(d.idle, 0).armF)); return mx }
  assert.ok(amp(0, 2500) < 1e-9, '溜めのあいだも震えない（決まった動きのまま）')
  for (let t = CAST_IN_MS; t < 5000; t += 37) assert.deepEqual(illustCastPoseAt('amaza', t, 0), illustCastPoseAt('amaza', CAST_IN_MS, 0), `構え ${t}ms も震えない`)
})

test('【確定】2026-10-29 黒龍の技のめりはり（ユーザー「攻撃するときちゃんとその部位が攻撃するように見えるようにして、グラブルみたいにしっかりとした動きを付けたい」）：ため→一気に振り抜く→当たった形で止める→ゆっくり戻る・当たった瞬間に揺れる', () => {
  const M = BOSS_ILLUST_DEFS.varuzenoku.motions
  const m = bossIllustOf('varuzenoku').motions
  for (const [k, d] of Object.entries(M)) {
    const i = d.keys.findIndex(([t]) => t === d.hitMs)
    assert.ok(i > 1, `${k}：当たる時刻にキーがある`)
    assert.equal(d.keys[i][2], 'out', `${k}：振り抜く区間は出だしがいちばん速い`)
    assert.ok(d.hitMs - d.keys[i - 1][0] <= 120, `${k}：振り抜きは 120ms まで`)
    assert.ok(d.keys[i + 1][0] - d.hitMs >= 100, `${k}：当たった形でいったん止める`)
    assert.equal(d.jolt?.atMs, d.hitMs, `${k}：当たった瞬間に揺れる`)
    assert.deepEqual(m[k].jolt, d.jolt)
    // 揺れは当たったあとだけ（溜めのあいだは揺れない）で、収まる。黒龍は地面を支点に揺らす（lean・しっぽと足は地面に残る）
    assert.deepEqual(joltAt(d.jolt, d.hitMs - 1), { x: 0, y: 0, lean: 0 })
    assert.ok(Math.abs(joltAt(d.jolt, d.hitMs + 20).lean) > 0)
    assert.deepEqual(joltAt(d.jolt, d.hitMs + d.jolt.ms), { x: 0, y: 0, lean: 0 })
    const a = illustPoseAt('varuzenoku', m[k], d.hitMs + 20, 0), b = illustPoseAt('varuzenoku', { ...m[k], jolt: null }, d.hitMs + 20, 0)
    assert.ok(Math.abs(a.lean - b.lean - joltAt(d.jolt, d.hitMs + 20).lean) < 1e-12, '揺れは傾きに足す')
  }
  // 区間の速さ：out は出だしが速い・in はだんだん速い・back は少し行き過ぎて戻る
  assert.ok(EASES.out(0.3) > 0.6 && EASES.in(0.3) < 0.05 && EASES.out(1) === 1 && EASES.in(1) === 1)
  assert.ok(Math.max(...[0.6, 0.7, 0.8].map(EASES.back)) > 1 && Math.abs(EASES.back(1) - 1) < 1e-12)
  const keys = [[0, { x: 0 }], [100, { x: 1 }, 'out']]
  assert.ok(motionPoseAt(keys, 30).x > 0.6, '振り抜く区間は 3 割の時刻で 6 割より先')
  // 攻める所は ポーズの絵（2026-10-30）：振り抜き の絵に変わってから当たるまでに、のけぞった形から相手のほうへ大きく押し出す
  for (const [k, d] of Object.entries(M)) {
    const tS = d.art.find(([, n]) => n === 'strike')[0]
    assert.ok(motionPoseAt(d.keys, d.hitMs).lean - motionPoseAt(d.keys, tS).lean > 0.2, `${k}：押し出す`)
  }
})

test('【確定】2026-10-29 黒龍の後ろの絵（後ろ.png）：頭・首・前脚が止まっているとき覆っている所の後ろに、翼や胸が描いてある（技で大きく動かしても切れ端や四角い模様にならない）', async (t) => {
  // ユーザー選択「後ろの絵を1枚描く」。前（模様を折り返して埋めた）は前脚の後ろの 36%・頭と首の後ろの 28% だけで、技で動かすと切れ端や四角いかたまりが見えた
  let decode
  try { ({ decode } = await import('../../../tools/v2cap-art-lib.mjs')); decode(new URL('varuzenoku-il-arm.webp', OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 64, 'rgba') } catch { t.skip('ffmpeg が無い'); return }
  const P = BOSS_ILLUST.varuzenoku.parts, S = BOSS_ILLUST_SIZE
  const alpha = (k) => {
    const im = decode(decodeURIComponent(new URL(`varuzenoku-il-${k}.webp`, OUT).pathname).replace(/^\/([A-Za-z]:)/, '$1'), 4096, 'rgba'), a = new Uint8Array(S * S), p = P[k]
    for (let y = 0; y < im.H; y++) for (let x = 0; x < im.W; x++) { const X = p.x + x, Y = p.y + y; if (X >= 0 && Y >= 0 && X < S && Y < S) a[Y * S + X] = im.data[(y * im.W + x) * 4 + 3] }
    return a
  }
  const A = Object.fromEntries(['wingF', 'wingN', 'body', 'neck', 'head', 'arm'].map(k => [k, alpha(k)]))
  const behind = (front) => {
    let n = 0, hit = 0
    for (let p = 0; p < S * S; p++) {
      if (!front.some(k => A[k][p] >= 230)) continue
      n++
      if (A.wingF[p] >= 128 || A.wingN[p] >= 128 || A.body[p] >= 128) hit++
    }
    return hit / n
  }
  // 頭のまわりは空（後ろに何も無い）が多いので、頭と首は 3 割ほどで十分
  assert.ok(behind(['arm']) > 0.6, `前脚の後ろ ${behind(['arm']).toFixed(2)}`)
  assert.ok(behind(['neck', 'head']) > 0.3, `頭と首の後ろ ${behind(['neck', 'head']).toFixed(2)}`)
  const sp = BOSS_ILLUST_DEFS.varuzenoku.split
  assert.deepEqual(sp.back.zones, ['neck', 'arm'])
  assert.ok(sp.parts.wingF.back && sp.parts.wingN.back, '後ろの絵の翼の所は翼といっしょに動く')
})

test('【確定】2026-10-29 黒龍のしっぽの巻いた先は曲げた絵を切り替える（回すだけだと付け根で折れ、硬い部品をつなぐと大きく振ったときつなぎ目が割れた）', async (t) => {
  const a = bossIllustOf('varuzenoku'), p = a.parts.find(q => q.key === 'tailT'), b = BOSS_ILLUST_DEFS.varuzenoku.bend.tailT
  assert.ok(p.bend, 'しっぽの巻いた先は曲げるパーツ')
  assert.equal(p.bend.n, Math.round((b.to - b.from) / b.step) + 1)
  assert.equal(p.bend.from, b.from)
  assert.match(p.bend.src, /varuzenoku-il-tailT-bend\.webp\?v=[0-9a-f]{8}$/)
  // 角度に近い2枚・上の絵の濃さ（範囲の外は端の絵）
  assert.deepEqual(bendFramesOf(p.bend, b.from), { i: 0, j: 1, k: 0 })
  const mid = bendFramesOf(p.bend, b.from + b.step * 2.25)
  assert.ok(mid.i === 2 && mid.j === 3 && Math.abs(mid.k - 0.25) < 1e-9)
  assert.deepEqual(bendFramesOf(p.bend, b.from - 30), { i: 0, j: 1, k: 0 })
  const end = bendFramesOf(p.bend, b.to + 30)
  assert.ok(end.i === p.bend.n - 1 && end.j === p.bend.n - 1)
  // 曲げるパーツは回さない（点を動かす計算でも）
  const pt = [150, 400], zero = { x: 0, y: 0, r: 0 }
  assert.deepEqual(illustPointAt('varuzenoku', { ...zero, tailT: 30 }, pt, 'tailT'), illustPointAt('varuzenoku', { ...zero, tailT: 0 }, pt, 'tailT'))
  // 曲げ方：付け根のそばは動かず、遠いほど大きく回る（回しても付け根からの距離は変わらない＝つなぎ目ができない）
  const { bendWarp } = await import('../../../tools/v2cap-boss-illust.mjs')
  const S = 64, img = { W: S, H: S, data: Buffer.alloc(S * S * 4) }
  const put = (x, y) => { const i = (y * S + x) * 4; img.data[i] = 200; img.data[i + 3] = 255 }
  put(12, 10); put(50, 10)   // 付け根 (10,10) のすぐそばと遠く
  const w = bendWarp(img, S, { base: [10.5, 10.5], r0: 4, r1: 40 }, 90)
  const alphaAt = (x, y) => w.data[(y * S + x) * 4 + 3]
  assert.ok(alphaAt(12, 10) > 200, '付け根のそばはそのまま')
  assert.ok(alphaAt(50, 10) < 50 && alphaAt(10, 50) > 100, '遠くは 90° 回って下へ（時計回り）')
  void t
})

test('【確定】2026-10-30 技のポーズの絵（ユーザー「グラブルのベルゼバブぐらいしっかりと攻撃モーション動いてほしい」→選んだ「技ごとに2枚」）：ため→振り抜き→部品の立ち絵と切り替える・振り抜きは残像・絵が無いうちは部品の動きのまま', () => {
  const d = BOSS_ILLUST_DEFS.varuzenoku
  // どの技にも ため・振り抜き の絵の名前と切り替える時刻がある
  for (const [k, m] of Object.entries(d.motions)) {
    assert.deepEqual(Object.keys(d.poses[k]).sort(), ['strike', 'windup'], `${k}：ためと振り抜き`)
    const names = m.art.map(([, n]) => n)
    assert.deepEqual(names, [null, 'windup', 'strike', null], `${k}：部品→ため→振り抜き→部品`)
    for (let i = 1; i < m.art.length; i++) assert.ok(m.art[i][0] > m.art[i - 1][0], `${k}：時刻の順`)
    const tStrike = m.art.find(([, n]) => n === 'strike')[0], tBack = m.art.at(-1)[0]
    assert.ok(tStrike < m.hitMs && m.hitMs - tStrike <= 80, `${k}：当たる直前に振り抜きの絵`)
    assert.ok(tBack - m.hitMs >= 250 && tBack < m.totalMs, `${k}：当たった形で止めてから立ち絵へ戻る`)
    assert.ok(m.ghosts.fromMs === tStrike && m.ghosts.toMs > m.hitMs, `${k}：振り抜きから残像`)
  }
  // 出し方（作った絵がある技のつもりの見本）：切り替えは新しい絵が前半で出きり、前の絵が後半で消える
  const mo = { totalMs: 1000, poses: { windup: {}, strike: {} }, art: [[0, null], [100, 'windup'], [400, 'strike'], [700, null]], ghosts: { fromMs: 400, toMs: 600, lagMs: 30, n: 3 } }
  assert.deepEqual(illustShowAt(mo, 50), { rig: 1, poses: [] })
  const mid = illustShowAt(mo, 100 + ART_FADE_MS / 2)
  assert.ok(Math.abs(mid.rig - 1) < 1e-9 && mid.poses.at(-1).name === 'windup' && Math.abs(mid.poses.at(-1).op - 1) < 1e-9, '半分の時刻で新しい絵が出きって、前の絵はまだ残る')
  assert.deepEqual(illustShowAt(mo, 100 + ART_FADE_MS + 1), { rig: 0, poses: [{ name: 'windup', op: 1 }] })
  const sw = illustShowAt(mo, 400 + ART_FADE_MS * 0.75)
  assert.deepEqual(sw.poses.map(p => p.name), ['windup', 'strike'], '新しい絵が上')
  assert.ok(sw.poses[0].op > 0 && sw.poses[0].op < 1 && sw.poses[1].op === 1)
  assert.deepEqual(illustShowAt(mo, 800), { rig: 1, poses: [] }, '立ち絵へ戻る')
  assert.deepEqual(illustShowAt(mo, 1000), { rig: 1, poses: [] }, '流し終わったら立ち絵')
  // 残像：振り抜きのあいだだけ・前の時刻ほど薄く・そのとき出ていた絵
  assert.deepEqual(illustGhostsAt(mo, 390), [])
  const gs = illustGhostsAt(mo, 500)
  assert.equal(gs.length, 3)
  assert.ok(gs.every(g => g.name === 'strike') && gs[0].op > gs[1].op && gs[1].op > gs[2].op && gs[0].ms === 470)
  const early = illustGhostsAt(mo, 420)
  assert.ok(early.length >= 1 && early.some(g => g.name === 'windup'), '振り抜きのはじめの残像はためのポーズ')
  assert.deepEqual(illustGhostsAt(mo, 600), [])
  // 絵がまだ無い技（poses が null）は、部品の立ち絵のまま・残像なし
  const none = { ...mo, poses: null }
  assert.deepEqual(illustShowAt(none, 500), { rig: 1, poses: [] })
  assert.deepEqual(illustGhostsAt(none, 500), [])
  const half = { ...mo, poses: { strike: {} } }
  assert.deepEqual(illustShowAt(half, 200), { rig: 1, poses: [] }, 'できていない絵（ため）の所は部品の立ち絵')
  // 画面に渡す形：できている絵だけ（一覧の poses）・先に読む絵に入る
  const a = bossIllustOf('varuzenoku')
  for (const [k, m] of Object.entries(a.motions)) {
    const made = BOSS_ILLUST.varuzenoku.poses?.[k] || {}
    assert.deepEqual(Object.keys(m.poses || {}).sort(), Object.keys(made).sort())
    for (const p of Object.values(m.poses || {})) assert.ok(a.srcs.includes(p.src))
    assert.deepEqual(m.art, d.motions[k].art)
  }
})

test('【確定】2026-10-30 雨摩座の技のポーズの絵（黒龍と同じ仕組み・ユーザー「グラブルのベルゼバブぐらいしっかりと攻撃モーション動いてほしい」）：技ごとに構えと振り抜きの2枚・構え→振り抜き→部品の立ち絵の順に切り替える', () => {
  const a = bossIllustOf('amaza'), D = BOSS_ILLUST_DEFS.amaza
  for (const k of ['shot', 'sleet', 'bind', 'deluge']) {
    const m = a.motions[k], d = D.motions[k]
    assert.ok(m.poses.windup.src.includes(`il-pose-${k}-windup`) && m.poses.strike.src.includes(`il-pose-${k}-strike`), `${k}：構えと振り抜きの絵`)
    const tw = d.art.find(([, n]) => n === 'windup')[0], ts = d.art.find(([, n]) => n === 'strike')[0], tr = d.art.findLast(([, n]) => n === null)[0]
    assert.ok(tw < ts && ts <= m.hitMs && m.hitMs < tr && tr < m.totalMs, `${k}：構え→振り抜き（撃つ時刻までに）→部品`)
    assert.equal(illustShowAt(m, (tw + ts) / 2 + 40).poses.at(-1).name, 'windup')
    assert.equal(illustShowAt(m, m.hitMs).poses.at(-1).name, 'strike')
    assert.equal(illustShowAt(m, tr + 100).rig, 1, '最後は部品の立ち絵')
    assert.equal(d.ghosts.fromMs, ts, '振り抜きの残像')
    // 水の筋は構えの手から振り抜きの手まで・撃つ時刻に振り抜きの手へ届く
    assert.deepEqual(d.arcs[0].pts[0], d.anchors.windup.hand)
    assert.deepEqual(d.arcs[0].pts.at(-1), d.anchors.strike.hand)
    assert.equal(d.arcs[0].toMs, m.hitMs)
    // 絵の置き場所：腰をそろえるために動かしたぶん、枠の外へ出てよい（余白の中）
    for (const n of ['windup', 'strike']) {
      const p = BOSS_ILLUST.amaza.poses[k][n]
      assert.ok(p.x >= -D.poseMargin && p.y >= -D.poseMargin && p.x + p.w <= 640 + D.poseMargin && p.y + p.h <= 640 + D.poseMargin)
    }
  }
  assert.equal(D.motions.deluge.art[0][1], 'windup', '水天葬は構え（5秒）のすぐあとなので、はじめから構えの絵')
  assert.ok(Object.values(D.poses).flatMap(p => Object.values(p)).every(n => D.poseFit[n]), '8枚とも腰を立ち絵にそろえた')
})

test('【確定】2026-10-30 雨摩座のポーズの絵は腰（帯飾りのまん中のいちばん大きな青い玉）を立ち絵の同じ玉にそろえる（はじめ立ち絵の左隣の玉にそろえていて、技の絵へ切り替えると体が左へ約19pxずれた・ユーザー「直して」）', () => {
  const D = BOSS_ILLUST_DEFS.amaza
  // 立ち絵のまん中の玉（元の絵の px）。左隣の玉（543, 435）に戻さない
  assert.deepEqual(D.waist, [581, 437])
  // ポーズの絵（技の8枚・バフの2枚）はどれも玉の場所を測ってあり、poseFit はその差（手で書かない＝基準がずれない）
  const names = [...Object.values(D.poses).flatMap(p => Object.values(p)), ...Object.values(D.buffs).map(b => b.pose)]
  assert.equal(names.length, 10)
  for (const n of names) {
    const [x, y] = D.poseWaist[n] || []
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `${n}：腰の玉を測ってある`)
    assert.deepEqual(D.poseFit[n], { dx: D.waist[0] - x, dy: D.waist[1] - y }, `${n}：腰を立ち絵の玉にそろえる`)
  }
  // 技の手（anchors）と水の筋（arcs）は、ずらした絵の上の手のまま（水の筋は構えの手から振り抜きの手まで）
  for (const m of Object.values(D.motions)) for (const a of m.arcs || []) {
    const which = a.pts[0][0] === m.anchors.windup.hand[0] ? 'hand' : 'hand2'
    assert.deepEqual(a.pts[0], m.anchors.windup[which])
    assert.deepEqual(a.pts.at(-1), m.anchors.strike[which])
  }
})

test('【確定】2026-10-30 雨摩座は構えの5秒も水天葬の構えの絵（cast.art）・黒龍の構えも ため の絵', () => {
  const a = bossIllustOf('amaza')
  assert.equal(a.castArt, 'windup')
  const s0 = illustCastShowAt(a, '水天葬', 0), s1 = illustCastShowAt(a, '水天葬', CAST_IN_MS), s2 = illustCastShowAt(a, '水天葬', 3000)
  assert.equal(s0.motion, a.motions.deluge)
  assert.ok(s0.show.rig === 1 && s0.show.poses[0].op === 0, '構えはじめは部品の立ち絵')
  assert.ok(s1.show.rig === 0 && s1.show.poses[0].op === 1 && s1.show.poses[0].name === 'windup', `CAST_IN_MS で構えの絵へ`)
  assert.deepEqual(s2.show, s1.show)
  // 新しい絵は前半で出きり、部品は後半で消える（途中で透けない）
  for (const t of [100, 250, 400]) { const s = illustCastShowAt(a, '水天葬', t).show; assert.ok(Math.max(s.rig, s.poses[0].op) === 1, `${t}ms`) }
  // 【確定】2026-10-30 黒龍の構えも ため の絵（ユーザー「貯める動作も長く」）
  const dc = illustCastShowAt(bossIllustOf('varuzenoku'), '終焉の黒焔', 3000)
  assert.deepEqual(dc.show, { rig: 0, poses: [{ name: 'windup', op: 1 }] })
})

test('【確定】2026-10-30 HPの節目のバフの絵（ユーザー「バフかけたときのエフェクトやイラストも用意しておきたい グラブル意識」）：黒龍の2つのバフにポーズとオーラ・名前はダンジョンのバフと同じ・付いた瞬間に切り替えて1.5秒見せて戻る', () => {
  const a = bossIllustOf('varuzenoku')
  // 名前は lib/dungeon.js の pattern.buffs と同じ（ずれると絵が出ない）
  const names = DUNGEON_BOSSES.varuzenoku.pattern.buffs.map(b => b.name)
  assert.deepEqual(Object.keys(a.buffs).sort(), [...names].sort())
  for (const [n, b] of Object.entries(a.buffs)) {
    assert.ok(b.pose && b.aura, `${n}：ポーズとオーラの絵がある`)
    for (const p of [b.pose, b.aura]) {
      assert.match(p.src, /il-buff-[a-z]+-(pose|aura)\.webp\?v=[0-9a-f]{8}$/)
      assert.ok(p.w > BOSS_ILLUST_SIZE * 0.8 && p.h > BOSS_ILLUST_SIZE * 0.8, `${n}：立ち絵の大きさに重ねる`)
      assert.ok(a.srcs.includes(p.src), `${n}：先に読む`)
    }
  }
  assert.equal(a.buffs['黒鱗の鎧'].front, true, '鎧の殻は竜の手前')
  assert.ok(a.buffs['黒鱗の鎧'].auraOp < 1, '手前の殻は竜が透けて見える')
  assert.equal(a.buffs['逆鱗'].front, false, '逆鱗の闘気は竜の後ろ')
  // 見せ方
  assert.equal(illustBuffShowAt(a, '黒鱗の鎧', -1), null)
  assert.equal(illustBuffShowAt(a, '黒鱗の鎧', BUFF_ART_MS), null, '終わったら出さない')
  assert.equal(illustBuffShowAt(a, '知らないバフ', 100), null, '絵の無いバフは名前の帯と赤い光だけ')
  // 切り替えの形は黒鱗の鎧で見る（逆鱗は見せる時間が長く、闘気が揺らめく＝下のテスト）
  const s0 = illustBuffShowAt(a, '黒鱗の鎧', 0)
  assert.ok(s0.rig === 1 && s0.pose === 0 && s0.flash === 1, '付いた瞬間は立ち絵のまま・いちばん明るい')
  const s1 = illustBuffShowAt(a, '黒鱗の鎧', BUFF_IN_MS / 2)
  assert.ok(Math.abs(s1.pose - 1) < 1e-9 && Math.abs(s1.rig - 1) < 1e-9, '前半でポーズの絵が出きって、立ち絵は後半で消える')
  const s2 = illustBuffShowAt(a, '黒鱗の鎧', BUFF_HOLD_MS - 1)
  assert.ok(s2.rig === 0 && s2.pose === 1 && Math.abs(s2.aura.op - 1) < 1e-9 && s2.flash === 0, '見せているあいだはポーズとオーラだけ')
  assert.ok(Math.abs(illustBuffShowAt(a, '黒鱗の鎧', BUFF_AURA_IN_MS).aura.scale - 1) < 1e-9, 'オーラは出きると立ち絵の大きさ')
  assert.ok(illustBuffShowAt(a, '逆鱗', 0).aura.scale < 0.8, '後ろの闘気は小さく出て広がる')
  assert.ok(illustBuffShowAt(a, '黒鱗の鎧', 0).aura.scale > 1.2 && illustBuffShowAt(a, '黒鱗の鎧', BUFF_AURA_IN_MS * 0.7).aura.scale < 1, '手前の殻は大きく出て竜へ閉じる（少し行きすぎる）')
  const s3 = illustBuffShowAt(a, '黒鱗の鎧', BUFF_HOLD_MS + BUFF_OUT_MS)
  assert.ok(s3.rig === 1 && s3.pose === 0 && s3.aura.op > 0 && s3.aura.op < 1 && s3.aura.scale > 1, '立ち絵へ戻り、オーラは広がりながら消えていく')
  assert.ok(BUFF_FLASH_MS < BUFF_HOLD_MS && BUFF_ART_MS === BUFF_HOLD_MS + BUFF_AURA_OUT_MS)
})

test('【確定】2026-10-30 雨摩座のバフの絵（ユーザー「あまざも作った」）：霧雨の帳・篠突く雨にポーズとオーラ・名前はダンジョンのバフと同じ・霧の帳は手前に半透明・水の闘気は後ろ・ポーズは腰を立ち絵にそろえる', () => {
  const a = bossIllustOf('amaza'), d = BOSS_ILLUST_DEFS.amaza
  const names = DUNGEON_BOSSES.amaza.pattern.buffs.map(b => b.name)
  assert.deepEqual(Object.keys(a.buffs).sort(), [...names].sort())
  for (const [n, b] of Object.entries(a.buffs)) {
    assert.ok(b.pose && b.aura, `${n}：ポーズとオーラの絵がある`)
    for (const p of [b.pose, b.aura]) {
      assert.match(p.src, /amaza-il-buff-[a-z]+-(pose|aura)\.webp\?v=[0-9a-f]{8}$/)
      assert.ok(p.w > BOSS_ILLUST_SIZE * 0.8 && p.h > BOSS_ILLUST_SIZE * 0.8, `${n}：立ち絵の大きさに重ねる`)
      assert.ok(a.srcs.includes(p.src), `${n}：先に読む`)
    }
  }
  assert.ok(a.buffs['霧雨の帳'].front && a.buffs['霧雨の帳'].auraOp < 1, '霧の帳は雨摩座の手前に半透明')
  // 篠突く雨のポーズは髪が枠いっぱいに広がり、後ろに置くと闘気がほとんど隠れた＝光として手前に明るく重ねる（足元から広がる）
  assert.ok(!a.buffs['篠突く雨'].front && a.buffs['篠突く雨'].glow && a.buffs['篠突く雨'].auraOp < 1, '水の闘気は光として手前に重ねる')
  assert.ok(illustBuffShowAt(a, '篠突く雨', 0).aura.scale < 0.8, '水の闘気は足元から小さく出て広がる')
  assert.ok(Object.values(bossIllustOf('varuzenoku').buffs).every(b => !b.glow), '黒龍は今までどおり')
  // 描いた絵は腰の位置がまちまち＝切り替えで体が跳ねないよう、ポーズはどちらも poseFit で腰を立ち絵にそろえる
  for (const b of Object.values(d.buffs)) assert.ok(d.poseFit[b.pose], `${b.pose}：腰をそろえる`)
  const s = illustBuffShowAt(a, '篠突く雨', BUFF_HOLD_MS - 1)
  assert.ok(s.rig === 0 && s.pose === 1 && Math.abs(s.aura.op - 1) < 1e-9, '見せているあいだはポーズとオーラだけ')
  assert.ok(illustBuffShowAt(a, '霧雨の帳', 0).aura.scale > 1.2, '手前の帳は大きく出て雨摩座へ閉じる')
})

test('【確定】2026-10-30 逆鱗の強い見せ方とそのあとの待機（ユーザー「逆鱗のモーションがパッとしない、もうちょっと強化感を出してほしい、逆鱗後はモーションも変更していい」）', () => {
  const a = bossIllustOf('varuzenoku'), w = a.buffs['逆鱗'], m = a.buffs['黒鱗の鎧']
  // 逆鱗は2秒見せる（黒鱗の鎧は今までどおり1.5秒・強い見せ方も、そのあとの見た目も無し）
  assert.equal(buffHoldOf(w), 2000)
  assert.equal(buffHoldOf(m), BUFF_HOLD_MS)
  assert.equal(buffSceneAt(m, 100), null)
  assert.equal(buffAfterAt([{ b: m, since: Infinity }], 0), null)
  const mid = illustBuffShowAt(a, '逆鱗', 1900)
  assert.ok(mid.rig === 0 && mid.pose === 1, '1.9秒でもまだポーズの絵')
  assert.equal(illustBuffShowAt(a, '逆鱗', buffArtMsOf(w)), null)
  // 付いた瞬間：舞台が赤黒く暗くなり、揺れ、ポーズの絵がふくらみ、口から輪が広がり、足元から火の粉が噴き上がる
  const e = buffSceneAt(w, 120), h = buffSceneAt(w, 1000), z = buffSceneAt(w, 2000 + BUFF_AURA_OUT_MS - 1)
  assert.ok(e.dim > 0.3 && e.dimColor && Math.hypot(...e.shake) >= 0 && e.punch > 1.03, '暗く・ふくらむ')
  assert.ok(Math.max(...Array.from({ length: 20 }, (_, i) => Math.hypot(...buffSceneAt(w, 100 + i * 7).shake))) > 3, '吠えた瞬間は大きく揺れる')
  assert.ok(Math.max(...Array.from({ length: 20 }, (_, i) => Math.hypot(...buffSceneAt(w, 1700 + i * 7).shake))) < 1, '揺れは弱まっていく')
  assert.ok(e.rings.length >= 1 && e.rings[0].x === w.show.rings.at[0], '口から輪')
  assert.ok(buffSceneAt(w, 700).rings.length >= 2, '輪は重なって広がる')
  assert.ok(h.sparks.length > 5 && h.sparks.every(p => p.y < 590 && p.op >= 0 && p.op <= 1), '火の粉は足元から上へ')
  assert.ok(z.dim < 0.05 && Math.abs(z.punch - 1) < 0.01, '見せ終わると戻る')
  assert.equal(buffSceneAt(w, 2000 + BUFF_AURA_OUT_MS), null)
  // そのあと：脈と火の粉は見せ終わってから出てくる・待機はポーズの絵に切り替わったあと速くなる
  assert.equal(buffAfterAt([{ b: w, since: 0 }], 0).tempo, 1, '付いた瞬間はまだ速くしない（立ち絵が見えている）')
  const early = buffAfterAt([{ b: w, since: 1000 }], 0)
  assert.ok(early.tempo > 1.2 && early.glow === 0 && early.sparks.every(p => p.op === 0), 'ポーズの絵のあいだに速くなり、脈と火の粉はまだ')
  const beats = Array.from({ length: 60 }, (_, i) => buffAfterAt([{ b: w, since: Infinity }], i * 25).glow)
  assert.ok(Math.max(...beats) > 0.8 && Math.min(...beats) < 0.05, '体が赤く脈打つ（強く光ったり消えたり）')
  const late = buffAfterAt([{ b: w, since: Infinity }, { b: m, since: Infinity }], 5000)
  assert.ok(late.sparks.length === w.after.embers.n && late.sparks.some(p => p.op > 0.1), '火の粉が絶えず立ちのぼる')
})
