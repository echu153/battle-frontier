// v2cap のクラスのモーション（攻撃の絵）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { MOTION_ART } from './motionArtList.js'
import { motionOf, motionFrameAt, motionFileOf, motionMsOf, motionHitOf, MOTION_OUT, IDLE_SIZE } from './motionArt.js'
import { ART_BASE, ART_GIF } from './classArt.js'
import { motionTargetOf, keyGreen, splitFrames, bodyOf, framesByComponents } from '../../../tools/v2cap-motion.mjs'

const PUB = new URL('../../../public/V2newjob/', import.meta.url)

test('一覧の絵はぜんぶ public/V2newjob/motion にあり、待機GIFのあるクラス・男女だけ', () => {
  for (const [cls, gs] of Object.entries(MOTION_ART)) {
    assert.ok(ART_BASE[cls], `${cls} は職業の名簿にある`)
    for (const [g, ks] of Object.entries(gs)) {
      assert.ok(ART_GIF[cls]?.includes(g), `${cls}${g} の待機GIFがある`)
      for (const [key, m] of Object.entries(ks)) {
        const file = new URL(`${MOTION_OUT}/${motionFileOf(cls, g, key)}`, PUB)
        assert.ok(existsSync(file), `${cls}${g} ${key} の絵がある`)
        assert.ok(statSync(file).size < 400 * 1024, `${cls}${g} ${key} は 400KB まで`)
        assert.equal(m.ms.length, m.frames, 'コマの数と長さの数が同じ')
        assert.ok(m.hit >= 0 && m.hit < m.frames)
        assert.ok(m.w >= IDLE_SIZE && m.h >= IDLE_SIZE, '1コマは待機GIF（224）以上')
      }
    }
  }
})

test('【確定】2026-10-27 初期クラス11職×男女の攻撃（剣士女はまだ）＋暗殺者女', () => {
  const inits = ['剣士', '戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士', '魔法使い', '呪術師', '僧侶', '薬師']
  for (const cls of inits) for (const g of ['m', 'f']) {
    if (cls === '剣士' && g === 'f') continue
    assert.ok(motionOf(cls, g, 'attack'), `${cls}${g} の攻撃がある`)
  }
})

test('【確定】2026-10-26 暗殺者の女性の攻撃（ユーザーが ChatGPT で作った1枚目）', () => {
  const m = motionOf('暗殺者', 'f', 'attack')
  assert.ok(m)
  assert.equal(m.frames, 4, '②〜⑤の4コマ')
  assert.equal(m.src, '/V2newjob/motion/ansatusya-f-attack.webp')
  assert.equal(m.totalMs, 500)
  assert.equal(m.hitMs, 200, '④（斬る）で当たる')
  assert.equal(motionOf('暗殺者', 'm', 'attack'), null, '男性はまだ無い＝踏み込み')
})

test('コマの速さ・当たるコマ・いまのコマ', () => {
  assert.deepEqual(motionMsOf(4), [100, 100, 180, 120])
  assert.equal(motionHitOf(4), 2)
  assert.deepEqual(motionMsOf(3), [100, 100, 100])
  const m = { ms: [100, 100, 180, 120] }
  assert.equal(motionFrameAt(m, 0), 0)
  assert.equal(motionFrameAt(m, 150), 1)
  assert.equal(motionFrameAt(m, 250), 2)
  assert.equal(motionFrameAt(m, 450), 3)
  assert.equal(motionFrameAt(m, 500), -1, '流し終わったら待機へ')
  assert.equal(motionFrameAt(m, -1), -1)
  assert.equal(motionFrameAt(null, 10), -1)
})

test('元の絵の名前：<クラス名><男|女><動き>（GIFと同じ読み替えも効く）', () => {
  assert.deepEqual(motionTargetOf('暗殺者女攻撃.png'), { cls: '暗殺者', g: 'f', key: 'attack' })
  assert.deepEqual(motionTargetOf('剣士男技.webp'), { cls: '剣士', g: 'm', key: 'skill' })
  assert.deepEqual(motionTargetOf('銃使い男攻撃.png'), { cls: '銃士', g: 'm', key: 'attack' })
  assert.equal(motionTargetOf('剣士攻撃.png'), null, '男女が無い')
  assert.equal(motionTargetOf('勇者男攻撃.png'), null, '無い職業')
})

test('真緑を抜いて、空いた列でコマに分け、つながっていたら6等分の境目で切る', () => {
  // 120×20 の真緑に、幅6の「体」を6つ（20px ごと）置く
  const W = 120, H = 20
  const make = (join) => {
    const data = Buffer.alloc(W * H * 4)
    for (let p = 0; p < W * H; p++) { data[p * 4 + 1] = 255; data[p * 4 + 3] = 255 }
    for (let i = 0; i < 6; i++) for (let y = 5; y < 18; y++) for (let x = i * 20 + 7; x < i * 20 + 13; x++) {
      const p = (y * W + x) * 4; data[p] = 200; data[p + 1] = 40; data[p + 2] = 40
    }
    // 太い剣（縦4px）で隣とつながる。1〜2px の細いつながりは、もともと切れ目として扱う
    if (join) for (let y = 9; y < 13; y++) for (let x = 13; x < 27; x++) { const p = (y * W + x) * 4; data[p] = 200; data[p + 1] = 40; data[p + 2] = 40 }
    return keyGreen({ W, H, data })
  }
  const a = make(false)
  assert.equal(a.data[3], 0, '緑は透明に')
  const s = splitFrames(a)
  assert.equal(s.joined, false)
  assert.deepEqual(s.cuts.map(c => c[0]), [7, 27, 47, 67, 87, 107])
  const j = splitFrames(make(true))
  assert.equal(j.joined, true, '剣でつながったコマ')
  assert.equal(j.cuts.length, 6)
  const b = bodyOf({ W: 20, H, data: a.data.subarray(0, 20 * H * 4) })
  assert.ok(b === null || b.bot >= 0)
})

test('まとまりで分ける：隣のコマの上まで伸びた武器は切らずに持ち主へ・体とつながらず浮いている矢や玉は撃った側（足もとが左の体）へ', () => {
  // 300×40 の真緑に、幅10の体を6つ（50px ごと・足もとは下）。②の槍（体とつながる）が左へ③の上まで、
  // ④が放った玉（浮いている）が⑤の体のすぐ左に。どちらも列で切ると隣へ入ってしまう形
  const W = 300, H = 40
  const data = Buffer.alloc(W * H * 4)
  for (let p = 0; p < W * H; p++) { data[p * 4 + 1] = 255; data[p * 4 + 3] = 255 }
  const paint = (x0, x1, y0, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * W + x) * 4; data[p] = 200; data[p + 1] = 40; data[p + 2] = 40 } }
  for (let i = 0; i < 6; i++) paint(i * 50 + 20, i * 50 + 30, 10, 38)
  paint(55, 70, 12, 14)       // ②（x70〜80）の体から左へ伸びる槍＝①と②のあいだを越えて x55 まで
  paint(186, 218, 20, 23)     // ④（x170〜180）が放った玉＝⑤（x220〜230）の体のすぐ左まで
  const frames = framesByComponents(keyGreen({ W, H, data }))
  assert.equal(frames.length, 6)
  assert.equal(frames[1].x0, 55, '②は槍の先（x55）から')
  assert.equal(frames[0].x0 + frames[0].W - 1, 29, '①に②の槍は入らない')
  assert.equal(frames[3].x0 + frames[3].W - 1, 217, '④に放った玉が入る')
  assert.equal(frames[4].x0, 220, '⑤には入らない')
})
