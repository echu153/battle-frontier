// v2cap：ニャーガーキングの看板娘の決まりを固定するテスト（node --test）
// 【確定】2026-10-25 ユーザー指示（絵・置き場所・いらっしゃいませー・セリフは clerk.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import {
  CLERK_ART_DIR, CLERK_FACES, CLERK_FACE_KEYS, CLERK_WELCOME, CLERK_MARK, CLERK_FACE_SIZE, CLERK_WELCOME_H, CLERK_MARK_SIZE,
  CLERK_LINES, fillLine, pickLine, isNight, nextStreak, tapKindOf, enterKindOf, welcomeDueLocal, STREAK_MS, makeDailyAsker,
  CLERK_STAGES, CLERK_STAGE_EVENTS, stageOf, callNameOf, stageEventOf, linesOf, dayOf,
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
  assert.ok(CLERK_LINES.servedTopping.every(l => l.text.includes('今回のトッピング')), '「今日の」ではなく「今回の」（ユーザー指示）')
  assert.equal(fillLine('あと{left}！{x}', { left: '42分' }), 'あと42分！{x}')
})

// そのセリフが出はじめる好感度（段階の下限と dayMin の大きいほう）
const startAffOf = (l) => Math.max(CLERK_STAGES.find(s => s.stage === (l.min ?? 0)).min, l.dayMin ?? 0)

test('★付け耳の裏設定は仲良くなってからだけ（23日目から前ふり・30日目から打ち明け）。それより前のセリフは耳に触れない', () => {
  // ユーザー指示（2026-10-25）「小ネタや伏線をもう少し詰めたい（仲良くなってから）」＋「30日目」を選んだ。前は「セリフでもばらさない」だった
  for (const [kind, list] of Object.entries(CLERK_LINES)) for (const l of list) {
    if (/付け耳|つけ耳|カチューシャ/.test(l.text)) assert.ok(startAffOf(l) >= 30, `${kind}：${l.text}`)
    if (/耳/.test(l.text)) assert.ok(startAffOf(l) >= 23, `${kind}：${l.text}`)
  }
  const slip = CLERK_LINES.tap.find(l => l.text.includes('耳がちょっと'))
  assert.deepEqual([slip.dayMin, slip.dayMax], [23, 29], '前ふり（耳がずれて慌てる）は打ち明ける前だけ')
  assert.ok(!Object.values(CLERK_STAGE_EVENTS).some(e => /耳/.test(e.text)), '段階の場面では触れない')
})

test('体術の伏線は出にくい（ほかのセリフの4分の1）・仲良くなってから（強さ20日目・昔の話26日目〜）', () => {
  const rare = CLERK_LINES.tap.filter(l => l.rare)
  assert.equal(rare.length, 7)
  assert.ok(rare.every(l => !/耳/.test(l.text)), '付け耳の小ネタはふつうの出やすさ')
  assert.ok(rare.filter(l => l.dayMin).every(l => l.dayMin >= 20))
  // 20日目の候補（ふつう15・出にくい4）で1000回まんべんなく引くと、出にくいほうは 4×0.25÷(15＋1)＝6.25%
  let hit = 0
  for (let i = 0; i < 1000; i++) if (rare.some(l => l.text === pickLine('tap', { stage: 3, aff: 20, rng: () => i / 1000 }).text)) hit++
  assert.ok(hit >= 55 && hit <= 70, `出にくいセリフ ${hit}/1000`)
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

test('【2026-10-25 直した】サーバーには同じ日は1回だけ聞いて答えを使い回す（画面を2回作り直しても first=true が届く）', async () => {
  let asked = 0
  let day = '2026-10-24'
  const w = makeDailyAsker(async () => ({ data: { ok: true, first: ++asked === 1 } }), () => day)
  const a = await w.get()
  const b = await w.get()   // 開発モードの2回目の作り直し＝同じ答え
  assert.equal(asked, 1)
  assert.equal(a.data.first, true)
  assert.equal(b.data.first, true)
  w.set({ data: { ok: true, first: false } })   // 出したら、同じ日に開き直しても出さない（サーバーにも聞かない）
  assert.equal((await w.get()).data.first, false)
  assert.equal(asked, 1)
  day = '2026-10-25'        // 日付が変わったら聞き直す
  await w.get()
  assert.equal(asked, 2)
})

test('「いらっしゃいませー」はその日はじめてだけ（日本時間の5時で切り替え・SQLを流す前の端末の控え）', () => {
  const at = (h) => new Date(Date.UTC(2026, 9, 25, h - 9))
  assert.equal(welcomeDueLocal('', at(12)), true)
  assert.equal(welcomeDueLocal('2026-10-25', at(12)), false)
  assert.equal(welcomeDueLocal('2026-10-25', at(4)), true)    // 朝4時はまだ前の日（10-24）
  assert.equal(welcomeDueLocal('2026-10-24', at(4)), false)
})

// ===== 好感度（2026-10-25 ユーザー指示「毎日会話重ねていくことで仲良くなってほしい」）=====
test('好感度の段階：2日目〜顔なじみ・10日目〜常連・20日目〜名前で呼ぶ・40日目〜自己紹介（ユーザー選択のペース）', () => {
  assert.deepEqual(CLERK_STAGES.map(s => s.min), [0, 2, 10, 20, 40])
  const at = (n) => stageOf(n)
  assert.deepEqual([0, 1, 2, 9, 10, 19, 20, 39, 40, 999].map(at), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  assert.equal(stageOf(undefined), 0)
})

test('呼び方：男性は〇〇くん・女性は〇〇ちゃん・決めていなければ〇〇さん（ユーザー選択）', () => {
  assert.equal(callNameOf({ username: 'おれおれお', gender: 'm' }), 'おれおれおくん')
  assert.equal(callNameOf({ username: 'ミナ', gender: 'f' }), 'ミナちゃん')
  assert.equal(callNameOf({ username: 'ノア', gender: null }), 'ノアさん')
})

test('名前で呼ぶのは仲良し（20日目）から。それより前のセリフに {name} は出てこない', () => {
  for (const [kind, list] of Object.entries(CLERK_LINES)) {
    for (const l of list) if (l.text.includes('{name}')) assert.ok(startAffOf(l) >= 20, `${kind}：${l.text}`)
  }
  // 名前つきとそうでないものは同じ段階で混ざらない（20日目からは名前つきだけ）
  for (const kind of ['enterDaily', 'enterLong', 'enterAgain', 'enterFed', 'enterNight', 'streak3', 'streak5', 'streak8', 'short', 'served', 'servedTopping']) {
    assert.ok(linesOf(kind, 3).every(l => l.text.includes('{name}')), `${kind} の20日目から`)
    assert.ok(linesOf(kind, 2).every(l => !l.text.includes('{name}')), `${kind} の20日目より前`)
  }
  assert.equal(pickLine('enterDaily', { stage: 3, rng: () => 0, vars: { name: 'おれおれおくん' } }).text, 'おれおれおくん、今日も来てくれたんだね！')
})

test('仲良くなるとタップのセリフが増える（はじめて8 → 顔なじみ10 → 常連13 → 仲良し19 → 小ネタと伏線で最大26）', () => {
  const at = [[0, 0], [2, 1], [10, 2], [20, 3], [23, 3], [26, 3], [30, 3], [33, 3], [35, 3], [40, 4]]
  assert.deepEqual(at.map(([aff, s]) => linesOf('tap', s, aff).length), [8, 10, 13, 19, 20, 22, 22, 23, 26, 26])
  assert.equal(linesOf('tap', 3).length, 19, '好感度を省くとその段階のいちばん下（20日目）')
  // 顔なじみからのあいさつ（今日も・久しぶり・また）は、はじめての日には出ない
  for (const kind of ['enterDaily', 'enterLong', 'enterAgain']) assert.equal(linesOf(kind, 0).length, 0, kind)
})

test('段階の場面は1回だけ・いちばん上のまだ見せていないもの。40日目（自己紹介）は名前が決まるまで無い', () => {
  assert.equal(stageEventOf(0, 0), null)
  assert.equal(stageEventOf(1, 0).stage, 1)
  assert.equal(stageEventOf(1, 1), null)
  assert.equal(stageEventOf(3, 1).stage, 3)          // 段階を飛ばしたら上のほうだけ
  assert.equal(stageEventOf(4, 3), null)             // 40日目の場面はまだ無い＝見せた印も付かない（あとで足せば出る）
  assert.equal(stageEventOf(4, 0).stage, 3)
  assert.equal(CLERK_STAGE_EVENTS[4], undefined, '看板娘の名前（あだ名）は決まってから入れる')
  assert.ok(CLERK_STAGE_EVENTS[3].text.includes('{username}') && CLERK_STAGE_EVENTS[3].text.includes('{name}'), '20日目に名前を聞いて呼び始める')
})

test('顔なじみからのあいさつ：前の日に来ていた→今日も・2日以上あいた→久しぶり・今日もう来ていた→また（食事中は残り時間）', () => {
  const noon = new Date(Date.UTC(2026, 9, 25, 3))   // 日本時間12時（日付は10-25）
  const today = dayOf(noon), yesterday = dayOf(new Date(noon.getTime() - 864e5))
  assert.equal(enterKindOf(null, noon, { stage: 1, lastVisit: yesterday }), 'enterDaily')
  assert.equal(enterKindOf(null, noon, { stage: 1, lastVisit: '2026-10-20' }), 'enterLong')
  assert.equal(enterKindOf(null, noon, { stage: 1, lastVisit: null }), 'enterLong')
  assert.equal(enterKindOf(null, noon, { stage: 1, lastVisit: today }), 'enterAgain')
  assert.equal(enterKindOf({ burger: {} }, noon, { stage: 1, lastVisit: today }), 'enterFed')
  assert.equal(enterKindOf({ burger: {} }, noon, { stage: 1, lastVisit: yesterday }), 'enterDaily')   // その日はじめては「今日も」が先
  assert.equal(enterKindOf(null, noon, { stage: 0, lastVisit: yesterday }), 'enter')                // はじめてのうちは前と同じ
})
