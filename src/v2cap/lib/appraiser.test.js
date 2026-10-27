// v2cap：博物館の鑑定士テオドールの決まりを固定するテスト（node --test）
// 【確定】2026-10-27 ユーザー指示（姿・人物・絵・置き場所・動きは appraiser.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as A from './appraiser.js'
import {
  OWL_NAME, OWL_ART_DIR, OWL_FACES, OWL_FACE_KEYS, OWL_FACE_SIZE, OWL_LINES, owlSrc,
  linesOf, pickLine, enterKindOf, donateKindOf,
} from './appraiser.js'
import { tierOfPlus } from './museum.js'

const PUB = new URL('../../../public/', import.meta.url)
const fileOf = (key) => new URL(`.${owlSrc(key)}`, PUB)
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// WebP の大きさ（VP8X・VP8L・VP8 のどれか）
const webpSize = (buf) => {
  const kind = buf.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) } }
  return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
}
const allLines = () => Object.entries(OWL_LINES).flatMap(([kind, list]) => list.map(l => ({ kind, ...l })))

test('表情は普通の1枚だけ（ユーザー「普通だけでいいかな」）', () => {
  assert.deepEqual(OWL_FACES.map(f => f.label), ['普通'])
  assert.deepEqual(OWL_FACE_KEYS, ['normal'])
  assert.ok(OWL_FACES[0].src.includes('普通') && OWL_FACES[0].src.includes('通常'), 'プロンプトのページの保存名「普通」・呼び方「通常」のどちらでも読む')
  assert.equal(OWL_ART_DIR, '/v2cap-art/museum')
})

test('絵がそろっていて、大きさは OWL_FACE_SIZE と同じ', () => {
  for (const k of OWL_FACE_KEYS) {
    const f = fileOf(k)
    assert.ok(existsSync(f), `${k} の絵が無い＝ node tools/v2cap-museum-art.mjs`)
    assert.deepEqual(webpSize(readFileSync(f)), OWL_FACE_SIZE, `${k} の大きさ`)
  }
})

test('絵の透明なところは本当に透明（透明度0）＝フクロウが箱の中や膜の中に見えない', async (t) => {
  let decode
  try { ({ decode } = await import('../../../tools/v2cap-art-lib.mjs')); decode(fileOf(OWL_FACE_KEYS[0]).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 64, 'rgba') } catch { t.skip('ffmpeg が無い'); return }
  for (const k of OWL_FACE_KEYS) {
    const img = decode(fileOf(k).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 4096, 'rgba')
    const at = (x, y) => img.data[(y * img.W + x) * 4 + 3]
    assert.deepEqual([at(0, 0), at(img.W - 1, 0), at(5, 5), at(img.W - 6, 5)], [0, 0, 0, 0], `${k}：上のすみは透明`)
    let low = 0
    for (let p = 0; p < img.W * img.H; p++) { const a = img.data[p * 4 + 3]; if (a > 0 && a < 16) low++ }
    assert.ok(low / (img.W * img.H) < 0.05, `${k}：うっすら残った透明度（1〜15）が多すぎない（${(low / (img.W * img.H) * 100).toFixed(1)}%）`)
  }
})

test('public/v2cap-art/museum の絵はどれも一覧に載っている（名前を変えて残った絵がない）', () => {
  const known = new Set(OWL_FACE_KEYS.map(k => `${k}.webp`))
  for (const f of readdirSync(new URL(`.${OWL_ART_DIR}/`, PUB))) assert.ok(known.has(f), `${f} は一覧に無い`)
})

test('【確定】セリフはユーザーが案を見て「この案で入れて」（2026-10-27）：場面ごとの数と、名乗りの文', () => {
  for (const [kind, list] of Object.entries(OWL_LINES)) {
    assert.ok(list.length > 0, kind)
    for (const l of list) assert.ok(!l.face || OWL_FACE_KEYS.includes(l.face), `${kind}：${l.face}`)
  }
  assert.deepEqual(
    ['intro', 'enter', 'enterNight', 'enterEmpty', 'tap', 'tapNight', 'streak3', 'streak5', 'streak8',
      'donate', 'donateGood', 'donateGreat', 'donateMany', 'donateSet', 'donateComplete', 'error'].map(k => linesOf(k).length),
    [1, 3, 1, 2, 13, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1])
  assert.equal(pickLine('intro').text, 'はじめまして。わたくし、この博物館で鑑定をあずかっております、テオドールと申します。旅で手に入れた品があれば、ぜひ拝見させてください')
  assert.equal(pickLine('streak8').text, 'これこれ、羽をつつくのはご勘弁を。わたくしは展示品ではございませんよ')
  assert.equal(pickLine('donateGreat').text, 'これは…なんと見事な。ここまで鍛え上げられた品には、そうそうお目にかかれません')
  // 表情は1枚＝どの場面も普通の顔
  for (const k of Object.keys(OWL_LINES)) assert.equal(pickLine(k).face, 'normal', k)
})

test('名前はテオドール：はじめての人に名乗る。前から寄贈している人にも分かるよう、ふだんのあいさつとタップにも名前がある', () => {
  assert.equal(OWL_NAME, 'テオドール')
  assert.ok(OWL_LINES.intro.every(l => l.text.includes(`${OWL_NAME}と申します`)))
  assert.ok(OWL_LINES.enter.some(l => l.text.includes(OWL_NAME)), 'あいさつ')
  assert.ok(OWL_LINES.tap.some(l => l.text.includes(OWL_NAME)), 'タップ')
  // 一人称は「わたくし」（穏やかな老紳士・ていねい語）。プレイヤーの名前は呼ばない（埋める名前 {…} を使わない）
  for (const l of allLines()) {
    assert.ok(!/俺|僕|わし|ワシ|あたし/.test(l.text), `${l.kind}：${l.text}`)
    assert.ok(!/\{\w+\}/.test(l.text), `${l.kind}：${l.text}`)
  }
})

test('【確定】数字やゲームの仕組みの言葉（強化値の数・段階・レア度の名前・報酬・ステータス・スタミナ）はセリフに入れない＝世界観を守る', () => {
  // ユーザー指示（親方のとき）「＋9 とかメタい発言しないでほしい、世界観守って」「レアリティを直接言わないで」・看板娘も同じ（feedback-npc-no-meta）
  for (const l of allLines()) {
    assert.ok(!/[0-9０-９]|[+＋]|[%％]|強化値|段階|未強化|ノーマル|レア|エピック|レジェンダリー|ユニーク|ステータス|ポイント|スタミナ|報酬|コンプリート|Gold|ゴールド|秒/.test(l.text),
      `${l.kind}：${l.text}`)
  }
})

test('【2026-10-27】片眼鏡は「モノクル」と呼ぶ（ユーザー指示「この眼鏡ってちゃんとした名前なかったっけ？調べて修正して」）', () => {
  for (const l of allLines()) assert.ok(!/片眼鏡/.test(l.text), `${l.kind}：${l.text}`)
  const texts = allLines().map(l => l.text)
  assert.ok(texts.includes('このモノクルですかな。若いころから使っておりましてな、もう手放せません'))
  assert.ok(texts.includes('そんなに見つめられては、モノクルがくもってしまいますな'))
})

test('【確定】有名なゲームの博物館のフクロウに似せない：「ホー」「ほっほっ」と笑わない・眠がらない・長い解説をしない', () => {
  for (const l of allLines()) {
    assert.ok(!/ホー|ほー|ほっほ|ホッホ|ホウホウ|眠|ねむ|昼/.test(l.text), `${l.kind}：${l.text}`)
    assert.ok(l.text.length <= 70, `${l.kind}：短く（${l.text.length}文字）`)
  }
})

test('【確定】好感度は無い（ユーザー選択「なし」）：段階で出し分けない・サーバーに聞かない', () => {
  for (const l of allLines()) assert.ok(!('min' in l || 'max' in l || 'dayMin' in l || 'dayMax' in l || 'rare' in l), `${l.kind}：${l.text}`)
  for (const name of ['OWL_STAGES', 'OWL_STAGE_EVENTS', 'stageOf', 'stageEventOf', 'makeDailyAsker']) assert.equal(A[name], undefined, name)
  const m = read('components/V2capMuseum.jsx')
  assert.ok(!/affinity|stage_seen|v2cap_\w+_talk/.test(m), '博物館の画面は好感度を読まない・サーバーに話しかけたことを送らない')
})

test('開いたときの場面：はじめて（まだ1つも寄贈していない）→ 名乗る・寄贈できる装備がない → そのひとこと・夜おそく → 夜のひとこと', () => {
  const jst = (h) => new Date(Date.UTC(2026, 9, 27, h - 9))
  assert.equal(enterKindOf({ donated: 0, donatable: 3, at: jst(12) }), 'intro')
  assert.equal(enterKindOf({ donated: 0, donatable: 0, at: jst(2) }), 'intro', 'はじめてなら、品がなくても夜でも名乗る')
  assert.equal(enterKindOf({ donated: 12, donatable: 0, at: jst(2) }), 'enterEmpty')
  assert.equal(enterKindOf({ donated: 12, donatable: 4, at: jst(2) }), 'enterNight')
  assert.equal(enterKindOf({ donated: 12, donatable: 4, at: jst(12) }), 'enter')
  // 登録の記録を読む前・読めなかったとき（donated＝null）は、はじめてかどうか分からない＝ふつうのあいさつ
  assert.equal(enterKindOf({ donated: null, donatable: 0, at: jst(12) }), 'enter')
  assert.equal(enterKindOf({ at: jst(2) }), 'enterNight')
})

test('寄贈の結果の場面：エリアがそろった → 報酬 → +9 → まとめて → +5 → ふつう。1つも寄贈できなかったら、うまくいかなかったとき', () => {
  const T0 = { tier: tierOfPlus(0) }, T5 = { tier: tierOfPlus(5) }, T9 = { tier: tierOfPlus(9) }
  assert.equal(donateKindOf([T0, T0], [{ key: 'set:1:N:0' }, { key: 'area:1' }]), 'donateComplete')
  assert.equal(donateKindOf([T0], [{ key: 'set:1:N:0', kind: 'sp', amount: 1 }]), 'donateSet')
  assert.equal(donateKindOf([T0, T9]), 'donateGreat', '+9 があれば、まとめてでも +9 のほめ言葉')
  assert.equal(donateKindOf([T9]), 'donateGreat')
  assert.equal(donateKindOf([T0, T5]), 'donateMany')
  assert.equal(donateKindOf([T5]), 'donateGood')
  assert.equal(donateKindOf([T0]), 'donate')
  assert.equal(donateKindOf([], []), 'error')
  assert.equal(donateKindOf(undefined, undefined), 'error')
})

test('同じセリフが2回続かない（2つ以上あるとき）・1つしか無い場面はそのまま', () => {
  let n = 0
  const rng = () => [0, 0.99, 0.5][n++ % 3]
  let last = null
  for (let i = 0; i < 40; i++) {
    const l = pickLine('tap', { rng, last })
    assert.notEqual(l.text, last)
    last = l.text
  }
  const one = OWL_LINES.streak5[0].text
  assert.equal(pickLine('streak5', { last: one }).text, one)
  assert.equal(pickLine('なにか', { rng: () => 0 }).text, OWL_LINES.tap[0].text, '知らない場面はタップのセリフ')
})

test('画面：博物館の右に鑑定士（狭い画面は上）・寄贈の結果のポップアップにも鑑定士・開発用のボタンは管理者だけ', () => {
  assert.ok(read('pages/V2capHome.jsx').includes("{screen === 'museum' && <V2capMuseum prof={prof} inventory={inventory} onProfile={refresh} dev={isAdmin} />}"))
  const m = read('components/V2capMuseum.jsx')
  assert.ok(m.includes('<style>{OWL_CSS}</style>'))
  assert.ok(m.includes('<V2capAppraiser face={owl.face} line={owl.text} tick={owl.tick} onTap={tapOwl} />'))
  assert.ok(m.includes('{result.say && <AppraiserSays face={result.say.face} line={result.say.text} />}'), '結果のポップアップのいちばん上')
  assert.ok(m.includes('setResult({ ...next, say: say(donateKindOf(next.items, next.rewards)) })'), '寄贈できた')
  assert.ok(m.includes("say: say('error') }); return }"), 'うまくいかなかった')
  assert.ok(m.includes("const kind = enterKindOf({ donated: error ? null : rows.length, donatable: donatables.length })"), '登録の記録が読めてから、はじめて・品がないを言い直す')
  assert.ok(/\{dev && \(\n\s+<div style=\{\{ display:'flex'[^\n]+\n\s+<button type="button" onClick=\{\(\) => say\('intro'\)\}/.test(m), '開発用のボタンは dev のときだけ')
  const css = read('components/V2capAppraiser.jsx')
  assert.ok(css.includes('.owl-btn:not(:disabled):hover { filter: brightness(1.05); }'), '押すときの光り方は看板娘と同じく控えめ')
  assert.ok(css.includes('.owl-btn::after { content: none; }'), 'ボタンの光沢（dev-ui.css の button::after）を絵に重ねない＝箱の中に見えない')
  assert.ok(css.includes('const SAY = cropOf(108, 108)') && css.includes('const THUMB = cropOf(132, 132)'), '小さく出すときは頭から胸まで（OWL_FOCUS）・耳の飾り羽が切れないよう正方形の枠')
  assert.ok(css.includes('@media (max-width: 720px)'), '狭い画面は鑑定士が上')
  assert.ok(css.includes('aria-label="鑑定士に話しかける"'))
})
