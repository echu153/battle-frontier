// v2cap：ニャーガーキングの看板娘の決まりを固定するテスト（node --test）
// 【確定】2026-10-25 ユーザー指示（絵・置き場所・いらっしゃいませー・セリフは clerk.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import {
  CLERK_ART_DIR, CLERK_FACES, CLERK_FACE_KEYS, CLERK_WELCOME, CLERK_MARK, CLERK_FACE_SIZE, CLERK_WELCOME_H, CLERK_MARK_SIZE,
  CLERK_LINES, fillLine, pickLine, isNight, nextStreak, tapKindOf, enterKindOf, welcomeDueLocal, STREAK_MS,
} from './clerk.js'

const PUB = new URL('../../../public/', import.meta.url)
const fileOf = (key) => new URL(`.${CLERK_ART_DIR}/${key}.webp`, PUB)
// WebP の大きさ（VP8X・VP8L・VP8 のどれか）
const webpSize = (buf) => {
  const kind = buf.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) } }
  return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
}

test('表情は9つ（普通・笑顔・ウインク・びっくり・照れ・ぷんすか・しょんぼり・ドヤ顔・眠そう）', () => {
  assert.deepEqual(CLERK_FACES.map(f => f.label), ['普通', '笑顔', 'ウインク', 'びっくり', '照れ', 'ぷんすか', 'しょんぼり', 'ドヤ顔', '眠そう'])
  assert.equal(new Set(CLERK_FACE_KEYS).size, 9)
})

test('絵がそろっている。表情9枚は同じ大きさ（切り替えても体が動かない）・全身と マークの大きさ', () => {
  for (const k of CLERK_FACE_KEYS) {
    const f = fileOf(k)
    assert.ok(existsSync(f), `${k} の絵が無い＝ node tools/v2cap-burger-art.mjs`)
    assert.deepEqual(webpSize(readFileSync(f)), CLERK_FACE_SIZE, `${k} の大きさ`)
  }
  assert.ok(existsSync(fileOf(CLERK_WELCOME.key)))
  assert.equal(webpSize(readFileSync(fileOf(CLERK_WELCOME.key))).h, CLERK_WELCOME_H)
  assert.deepEqual(webpSize(readFileSync(fileOf(CLERK_MARK.key))), { w: CLERK_MARK_SIZE, h: CLERK_MARK_SIZE })
})

test('public/v2cap-art/clerk の絵はどれも一覧に載っている（名前を変えて残った絵がない）', () => {
  const known = new Set([...CLERK_FACE_KEYS, CLERK_WELCOME.key, CLERK_MARK.key].map(k => `${k}.webp`))
  for (const f of readdirSync(new URL(`.${CLERK_ART_DIR}/`, PUB))) assert.ok(known.has(f), `${f} は一覧に無い`)
})

test('セリフの表情はどれも9つのどれか・9つとも使っている・埋める名前がそろっている', () => {
  const used = new Set()
  for (const [kind, list] of Object.entries(CLERK_LINES)) {
    assert.ok(list.length > 0, kind)
    for (const l of list) { assert.ok(CLERK_FACE_KEYS.includes(l.face), `${kind}：${l.face}`); used.add(l.face) }
  }
  assert.deepEqual([...used].sort(), [...CLERK_FACE_KEYS].sort())
  assert.ok(CLERK_LINES.enterFed.every(l => l.text.includes('{burger}') && l.text.includes('{left}')))
  assert.ok(CLERK_LINES.served.every(l => l.text.includes('{burger}')))
  assert.ok(CLERK_LINES.servedTopping.every(l => l.text.includes('{toppings}')))
  assert.equal(fillLine('あと{left}！{x}', { left: '42分' }), 'あと42分！{x}')
})

test('★裏設定（中身は人間・猫耳は付け耳）をセリフでばらさない', () => {
  const all = Object.values(CLERK_LINES).flat().map(l => l.text).join('\n')
  for (const w of ['付け耳', 'つけ耳', 'カチューシャ', '人間', '本物の耳']) assert.ok(!all.includes(w), w)
})

test('【確定】語尾の「ニャ」は使わない（ユーザー選択・店の名前とバーガーの名前だけ）', () => {
  for (const l of Object.values(CLERK_LINES).flat()) {
    assert.ok(!l.text.replace(/ニャーガーキング|ニャッパー/g, '').includes('ニャ'), l.text)
  }
})

test('同じセリフが2回続かない（2つ以上あるとき）', () => {
  let rngN = 0
  const rng = () => [0, 0.99, 0.5][rngN++ % 3]
  let last = null
  for (let i = 0; i < 30; i++) {
    const l = pickLine('tap', { rng, last })
    assert.notEqual(l.text, last)
    last = l.text
  }
  // 1つしか無い場面はそのまま
  assert.equal(pickLine('streak3', { last: 'わっ！ どうしたの？' }).text, 'わっ！ どうしたの？')
  assert.equal(pickLine('enterFed', { vars: { burger: 'チキンニャッパー', left: '42分' } }).text, 'さっきのチキンニャッパー、まだ効いてるよ！ あと42分！')
})

test('夜おそくは日本時間の0〜5時', () => {
  const jst = (h, m = 0) => new Date(Date.UTC(2026, 9, 25, h - 9, m))
  assert.equal(isNight(jst(0)), true)
  assert.equal(isNight(jst(4, 59)), true)
  assert.equal(isNight(jst(5)), false)
  assert.equal(isNight(jst(12)), false)
  assert.equal(isNight(jst(23, 59)), false)
})

test('続けてタップ：3回目にびっくり・5回目に照れ・8回目からぷんすか。間が空いたら1から', () => {
  let s = null
  const kinds = []
  for (let i = 0; i < 9; i++) { s = nextStreak(s, 1000 + i * 1000); kinds.push(tapKindOf(s.n)) }
  assert.deepEqual(kinds, ['tap', 'tap', 'streak3', 'tap', 'streak5', 'tap', 'tap', 'streak8', 'streak8'])
  s = nextStreak(s, s.at + STREAK_MS + 1)
  assert.equal(s.n, 1)
  assert.equal(tapKindOf(1, true), 'tapNight')
  assert.equal(tapKindOf(3, true), 'streak3')
})

test('店を開いたときのひとこと：夜おそく→眠そう・食事中→残り時間・ほかはふつう', () => {
  const day = new Date(Date.UTC(2026, 9, 25, 3))     // 日本時間12時
  const night = new Date(Date.UTC(2026, 9, 24, 17))  // 日本時間2時
  assert.equal(enterKindOf(null, day), 'enter')
  assert.equal(enterKindOf({ burger: {} }, day), 'enterFed')
  assert.equal(enterKindOf({ burger: {} }, night), 'enterNight')
})

test('「いらっしゃいませー」はその日はじめてだけ（日本時間の5時で切り替え・SQLを流す前の端末の控え）', () => {
  const at = (h) => new Date(Date.UTC(2026, 9, 25, h - 9))
  assert.equal(welcomeDueLocal('', at(12)), true)
  assert.equal(welcomeDueLocal('2026-10-25', at(12)), false)
  assert.equal(welcomeDueLocal('2026-10-25', at(4)), true)    // 朝4時はまだ前の日（10-24）
  assert.equal(welcomeDueLocal('2026-10-24', at(4)), false)
})
