// v2cap：神殿の神官の決まりを固定するテスト（node --test）
// 【確定】2026-10-31 ユーザー指示（姿・人物・絵・置き場所・動きは priest.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as P from './priest.js'
import {
  PRIEST_ART_DIR, PRIEST_FACES, PRIEST_FACE_KEYS, PRIEST_FACE_SIZE, PRIEST_FOCUS, PRIEST_THUMB, PRIEST_SAY, PRIEST_LINES, priestSrc,
  linesOf, pickLine, enterKindOf, changeKindOf,
} from './priest.js'

const PUB = new URL('../../../public/', import.meta.url)
const fileOf = (key) => new URL(`.${priestSrc(key)}`, PUB)
const pathOf = (url) => url.pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// WebP の大きさ（VP8X・VP8L・VP8 のどれか）
const webpSize = (buf) => {
  const kind = buf.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) } }
  return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
}
const allLines = () => Object.entries(PRIEST_LINES).flatMap(([kind, list]) => list.map(l => ({ kind, ...l })))

test('絵は普通の1枚だけ（顔が見えないので表情の差分なし＝ユーザー選択）', () => {
  assert.deepEqual(PRIEST_FACES.map(f => f.label), ['普通'])
  assert.deepEqual(PRIEST_FACE_KEYS, ['normal'])
  for (const n of ['普通', '通常', '神官']) assert.ok(PRIEST_FACES[0].src.includes(n), `元の絵の名前「${n}」でも読む（プロンプトのページの保存名・呼び方・ユーザーが置いた名前）`)
  assert.equal(PRIEST_ART_DIR, '/v2cap-art/temple')
})

test('絵がそろっていて、大きさは PRIEST_FACE_SIZE と同じ', () => {
  for (const k of PRIEST_FACE_KEYS) {
    const f = fileOf(k)
    assert.ok(existsSync(f), `${k} の絵が無い＝ node tools/v2cap-temple-art.mjs`)
    assert.deepEqual(webpSize(readFileSync(f)), PRIEST_FACE_SIZE, `${k} の大きさ`)
  }
})

test('絵の透明なところは本当に透明（透明度0）＝神官が箱の中や膜の中に見えない', async (t) => {
  let decode
  try { ({ decode } = await import('../../../tools/v2cap-art-lib.mjs')); decode(pathOf(fileOf(PRIEST_FACE_KEYS[0])), 64, 'rgba') } catch { t.skip('ffmpeg が無い'); return }
  for (const k of PRIEST_FACE_KEYS) {
    const img = decode(pathOf(fileOf(k)), 4096, 'rgba')
    const at = (x, y) => img.data[(y * img.W + x) * 4 + 3]
    assert.deepEqual([at(0, 0), at(img.W - 1, 0), at(5, 5), at(img.W - 6, 5)], [0, 0, 0, 0], `${k}：上のすみは透明`)
    let low = 0
    for (let p = 0; p < img.W * img.H; p++) { const a = img.data[p * 4 + 3]; if (a > 0 && a < 16) low++ }
    assert.ok(low / (img.W * img.H) < 0.05, `${k}：うっすら残った透明度（1〜15）が多すぎない（${(low / (img.W * img.H) * 100).toFixed(1)}%）`)
  }
})

test('public/v2cap-art/temple の絵はどれも一覧に載っている（名前を変えて残った絵がない）', () => {
  const known = new Set(PRIEST_FACE_KEYS.map(k => `${k}.webp`))
  for (const f of readdirSync(new URL(`.${PRIEST_ART_DIR}/`, PUB))) assert.ok(known.has(f), `${f} は一覧に無い`)
})

test('小さく出すとき（スマホの上・転職の結果）は、フードが左右で切れない・胸のメダルまで見える', async (t) => {
  // アレアのときのユーザー指示「ひだりの髪が少し見切れちゃってるから、もう少しバランスよく見えるように」と同じ考え＝顔ではなくフードのまん中に合わせる
  let decode
  try { ({ decode } = await import('../../../tools/v2cap-art-lib.mjs')); decode(pathOf(fileOf(PRIEST_FACE_KEYS[0])), 64, 'rgba') } catch { t.skip('ffmpeg が無い'); return }
  const img = decode(pathOf(fileOf('normal')), 4096, 'rgba')
  // フードの高さ（肩より上＝上から36%まで）で、絵のある左右の端
  let l = img.W, r = -1
  for (let y = 0; y < Math.round(0.36 * img.H); y++) {
    for (let x = 0; x < img.W; x++) if (img.data[(y * img.W + x) * 4 + 3] > 128) { if (x < l) l = x; if (x > r) r = x }
  }
  assert.ok(Math.abs((l + r) / 2 / img.W - PRIEST_FOCUS.x) < 0.01, `フードのまん中（${((l + r) / 2 / img.W).toFixed(3)}）に合わせる`)
  for (const frame of [PRIEST_THUMB, PRIEST_SAY]) {
    const k = frame.h / (img.H * PRIEST_FOCUS.top)
    const half = frame.w / k / 2, mid = PRIEST_FOCUS.x * img.W
    assert.ok(mid - half <= l && r <= mid + half, `${frame.w}×${frame.h}：フードが枠に入る（見える ${Math.round(mid - half)}〜${Math.round(mid + half)}・フード ${l}〜${r}）`)
  }
  // メダルの下のはしは、元の絵で上から860px前後（切って縮めたあとで高さの55.3%）。枠の高さはそれより少し下まで
  assert.ok(PRIEST_FOCUS.top > 0.553 && PRIEST_FOCUS.top < 0.62, `見せる高さ ${PRIEST_FOCUS.top}`)
})

test('【確定】セリフはユーザーが案を見て「この案で入れて」（2026-10-31）：場面ごとの数と文', () => {
  assert.deepEqual(
    ['enter', 'enterNight', 'tap', 'tapNight', 'streak3', 'streak5', 'streak8', 'changeNew', 'changeBack', 'changeUp', 'error'].map(k => linesOf(k).length),
    [3, 1, 13, 2, 1, 1, 1, 2, 2, 1, 1])
  assert.equal(Object.keys(PRIEST_LINES).length, 11, '場面はこの11個だけ')
  assert.equal(pickLine('enterNight').text, '夜の神殿へ、ようこそ。迷いは、暗いほうがよく見えるものです')
  assert.equal(pickLine('streak5').text, 'フードの中を、のぞこうとしていますね。…何も見えませんよ')
  assert.equal(pickLine('streak8').text, 'そこまでです。見えないものは、見えないままのほうが、よいこともあります')
  assert.equal(pickLine('changeUp', { vars: { cls: '侍' } }).text, 'よくここまで歩みましたね。侍の道は、誰にでも開くものではありません')
  assert.equal(pickLine('error').text, '…道が、うまく開かなかったようです。もう一度、お願いできますか')
  assert.ok(allLines().some(l => l.text === '顔ですか？ 見えなくても、困ることはありませんよ'))
  // 絵は1枚＝どの場面も普通の絵
  for (const k of Object.keys(PRIEST_LINES)) assert.equal(pickLine(k).face, 'normal', k)
})

test('【確定】数字やゲームの仕組みの言葉（転職・クラス・LV・ステータス・スキルなど）はセリフに入れない＝世界観を守る', () => {
  // ユーザー指示（親方のとき）「＋9 とかメタい発言しないでほしい、世界観守って」・看板娘も同じ（feedback-npc-no-meta）
  for (const l of allLines()) {
    assert.ok(!/[0-9０-９]|[+＋]|[%％]|転職|クラス|CLASS|LV|レベル|ステータス|ステ|スキル|パッシブ|装備|経験値|EXP|Gold|ゴールド|無料|確率|ポイント|スタミナ|秒/.test(l.text),
      `${l.kind}：${l.text}`)
  }
})

test('【確定】名乗らない・性別が分かる言葉を使わない：一人称なし・プレイヤーの名前を呼ばない・埋めるのは転職した先のクラスの名前だけ', () => {
  for (const name of ['PRIEST_NAME']) assert.equal(P[name], undefined, name)
  for (const l of allLines()) {
    assert.ok(!/と申します|名乗|俺|僕|わたし|わたくし|私|あたし|わし|ワシ|兄ちゃん|嬢ちゃん|くん|ちゃん/.test(l.text), `${l.kind}：${l.text}`)
    for (const m of l.text.matchAll(/\{(\w+)\}/g)) assert.equal(m[1], 'cls', `${l.kind}：${l.text}`)
  }
  for (const k of ['changeNew', 'changeBack', 'changeUp']) assert.ok(PRIEST_LINES[k].every(l => l.text.includes('{cls}')), k)
  for (const k of ['enter', 'enterNight', 'tap', 'tapNight', 'streak3', 'streak5', 'streak8', 'error']) assert.ok(PRIEST_LINES[k].every(l => !l.text.includes('{')), k)
})

test('【確定】好感度は無い（ユーザー選択「なし」）：段階で出し分けない・サーバーに聞かない', () => {
  for (const l of allLines()) assert.ok(!('min' in l || 'max' in l || 'dayMin' in l || 'dayMax' in l || 'rare' in l), `${l.kind}：${l.text}`)
  for (const name of ['PRIEST_STAGES', 'PRIEST_STAGE_EVENTS', 'stageOf', 'stageEventOf', 'makeDailyAsker']) assert.equal(P[name], undefined, name)
  assert.ok(!/affinity|stage_seen|v2cap_\w+_talk/.test(read('components/V2capTemple.jsx')), '神殿の画面は好感度を読まない・サーバーに話しかけたことを送らない')
})

test('開いたときの場面：夜おそく（日本時間の0〜5時）は夜のひとこと', () => {
  const jst = (h) => new Date(Date.UTC(2026, 9, 31, h - 9))
  assert.equal(enterKindOf(jst(2)), 'enterNight')
  assert.equal(enterKindOf(jst(12)), 'enter')
})

test('転職の結果の場面：前に就いたことがある → 戻ってきた・はじめての上位クラス → ねぎらう・はじめての初期クラス → ふつう', () => {
  const jobs = { 剣士: { lv: 30, exp: 0 }, 侍: { lv: 3, exp: 0 } }
  assert.equal(changeKindOf('侍', jobs), 'changeBack', '上位クラスでも、前に就いていれば戻ってきた')
  assert.equal(changeKindOf('剣士', jobs), 'changeBack')
  assert.equal(changeKindOf('戦士', jobs), 'changeNew')
  assert.equal(changeKindOf('魔法剣士', jobs), 'changeUp')
  assert.equal(changeKindOf('戦士', null), 'changeNew', 'プロフィールが読めなくても落ちない')
})

test('同じセリフが2回続かない（2つ以上あるとき）・1つしか無い場面はそのまま・知らない場面はタップのセリフ', () => {
  let n = 0
  const rng = () => [0, 0.99, 0.5][n++ % 3]
  let last = null
  for (let i = 0; i < 40; i++) {
    const l = pickLine('tap', { rng, last })
    assert.notEqual(l.text, last)
    last = l.text
  }
  const one = PRIEST_LINES.streak5[0].text
  assert.equal(pickLine('streak5', { last: one }).text, one)
  assert.equal(pickLine('なにか', { rng: () => 0 }).text, PRIEST_LINES.tap[0].text)
  // 埋めたあとの文で「同じ」を見る
  assert.notEqual(pickLine('changeBack', { rng: () => 0, last: 'おかえりなさい、侍の道へ。足あとは、そのまま残っていますよ', vars: { cls: '侍' } }).text, 'おかえりなさい、侍の道へ。足あとは、そのまま残っていますよ')
})

test('画面：クラス一覧の右に神官（狭い画面は上）・転職の結果にも神官・開発用のボタンは管理者だけ', () => {
  assert.ok(read('pages/V2capHome.jsx').includes("{screen === 'temple' && <V2capTemple prof={prof} inventory={inventory} onProfile={refresh} dev={isAdmin} />}"))
  const t = read('components/V2capTemple.jsx')
  assert.ok(t.includes('<V2capPriest face={priest.face} line={priest.text} tick={priest.tick} onTap={tapPriest} />'))
  assert.ok(t.includes('const kind = changeKindOf(cls, prof.jobs)'), '場面は転職する前のプロフィールで決める（読み直したあとは全部「前に就いた」になる）')
  assert.ok(t.includes('setChangeSay(say(kind, { cls }))'), '転職できた')
  assert.ok(t.includes("setChangeSay(say('error'))"), 'うまくいかなかった')
  assert.ok(t.indexOf('{msg && ') < t.indexOf('<ArtPanel') && t.indexOf('{error && ') < t.indexOf('<ArtPanel'), '結果は詳細の画面のいちばん上')
  assert.ok(t.includes('{dev && ('), '開発用のボタンは dev のときだけ')
  const css = read('components/V2capPriest.jsx')
  assert.ok(css.includes('.pst-btn:not(:disabled):hover { filter: brightness(1.05); }'), '押すときの光り方は看板娘と同じく控えめ')
  assert.ok(css.includes('.pst-btn::after { content: none; }'), 'ボタンの光沢（dev-ui.css の button::after）を絵に重ねない＝箱の中に見えない')
  assert.ok(css.includes('@media (max-width: 720px)'), '狭い画面は神官が上')
  assert.ok(css.includes('aria-label="神官に話しかける"'))
})
