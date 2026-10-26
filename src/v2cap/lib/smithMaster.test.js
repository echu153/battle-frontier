// v2cap：鍛冶屋の親方トルステンの決まりを固定するテスト（node --test）
// 【確定】2026-10-26 ユーザー指示（人物・絵・置き場所・動きは smithMaster.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as M from './smithMaster.js'
import {
  MASTER_ART_DIR, MASTER_FACES, MASTER_FACE_KEYS, MASTER_FACE_SIZE, MASTER_LINES,
  callOf, varsOf, linesOf, pickLine, enterKindOf, enhanceKindOf, GREAT_PLUS, shortWhatOf,
} from './smithMaster.js'
import { PLUS_MAX, ENHANCE_RATE, enhanceErrorOf } from './smith.js'

const PUB = new URL('../../../public/', import.meta.url)
const fileOf = (key) => new URL(`.${MASTER_ART_DIR}/${key}.webp`, PUB)
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// WebP の大きさ（VP8X・VP8L・VP8 のどれか）
const webpSize = (buf) => {
  const kind = buf.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) } }
  return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
}
const allLines = () => Object.entries(MASTER_LINES).flatMap(([kind, list]) => list.map(l => ({ kind, ...l })))

test('表情は2つ（普通・笑顔＝描いたユーザーが「笑顔と通常だけにした」）', () => {
  assert.deepEqual(MASTER_FACES.map(f => f.label), ['普通', '笑顔'])
  assert.equal(new Set(MASTER_FACE_KEYS).size, 2)
  assert.ok(MASTER_FACES[0].src.includes('通常'), 'ユーザーの呼び方「通常」の名前でも読む')
})

test('絵がそろっている。2枚は同じ大きさ（切り替えても体が動かない）', () => {
  for (const k of MASTER_FACE_KEYS) {
    const f = fileOf(k)
    assert.ok(existsSync(f), `${k} の絵が無い＝ node tools/v2cap-smith-art.mjs`)
    assert.deepEqual(webpSize(readFileSync(f)), MASTER_FACE_SIZE, `${k} の大きさ`)
  }
})

test('【2026-10-26 直した】絵の透明なところは本当に透明（透明度0）。縮めるのは rgba のままで、そのあと WebP の形に変える', async (t) => {
  // lanczos の縮小と yuva420p への変換をまとめてやると透明が1になり、まわりに暗い膜がかかっていた（tools/v2cap-art-lib.mjs）
  const lib = readFileSync(new URL('../../../tools/v2cap-art-lib.mjs', import.meta.url), 'utf8')
  assert.equal((lib.match(/flags=lanczos,\$\{SCALE_KEEP_ALPHA\}/g) || []).length, 2, 'encodeRect と encodeSquare の両方')
  assert.ok(lib.includes("const SCALE_KEEP_ALPHA = 'format=rgba'"))
  let decode
  try { ({ decode } = await import('../../../tools/v2cap-art-lib.mjs')); decode(fileOf(MASTER_FACE_KEYS[0]).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 64, 'rgba') } catch { t.skip('ffmpeg が無い'); return }
  for (const k of MASTER_FACE_KEYS) {
    const img = decode(fileOf(k).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 4096, 'rgba')
    const at = (x, y) => img.data[(y * img.W + x) * 4 + 3]
    assert.deepEqual([at(0, 0), at(img.W - 1, 0), at(5, 5), at(img.W - 6, 5)], [0, 0, 0, 0], `${k}：上のすみは透明`)
    let low = 0
    for (let p = 0; p < img.W * img.H; p++) { const a = img.data[p * 4 + 3]; if (a > 0 && a < 16) low++ }
    assert.ok(low / (img.W * img.H) < 0.05, `${k}：うっすら残った透明度（1〜15）が多すぎない（${(low / (img.W * img.H) * 100).toFixed(1)}%）`)
  }
})

test('public/v2cap-art/smith の絵はどれも一覧に載っている（名前を変えて残った絵がない）', () => {
  const known = new Set(MASTER_FACE_KEYS.map(k => `${k}.webp`))
  for (const f of readdirSync(new URL(`.${MASTER_ART_DIR}/`, PUB))) assert.ok(known.has(f), `${f} は一覧に無い`)
})

test('セリフの表情はどれも2つのどちらか・2つとも使っている・埋める名前がそろっている', () => {
  const used = new Set()
  for (const [kind, list] of Object.entries(MASTER_LINES)) {
    assert.ok(list.length > 0, kind)
    for (const l of list) { assert.ok(MASTER_FACE_KEYS.includes(l.face), `${kind}：${l.face}`); used.add(l.face) }
  }
  assert.deepEqual([...used].sort(), [...MASTER_FACE_KEYS].sort())
  assert.ok(MASTER_LINES.craft.every(l => l.text.includes('{item}')))
  assert.ok(MASTER_LINES.dismantle.every(l => l.text.includes('{n}')))
  assert.ok(MASTER_LINES.short.every(l => l.text.includes('{what}')))
  // 埋める名前は決まったものだけ（書きまちがいで {nmae} のまま出ない）
  for (const l of allLines()) {
    for (const m of l.text.matchAll(/\{(\w+)\}/g)) assert.ok(['call', 'item', 'n', 'what'].includes(m[1]), `${l.text}`)
  }
})

test('【確定】プレイヤーの名前は呼ばない（ユーザー指示「名前呼ぶくらいまで仲良くはならなくていい」）。呼び方は兄ちゃん／嬢ちゃん／お前さん', () => {
  assert.equal(callOf({ gender: 'm' }), '兄ちゃん')
  assert.equal(callOf({ gender: 'f' }), '嬢ちゃん')
  assert.equal(callOf({ gender: null }), 'お前さん')
  assert.deepEqual(varsOf({ username: 'おれおれお', gender: 'm' }), { call: '兄ちゃん' }, 'キャラクター名はセリフに渡さない')
  for (const l of allLines()) assert.ok(!/\{(name|username)\}/.test(l.text), l.text)
  assert.equal(pickLine('enter', { rng: () => 0.99, vars: varsOf({ gender: 'f' }) }).text, 'おう、嬢ちゃん！ 炉はもう温まってるぜ')
})

test('【確定】レア度の名前（ノーマル・レジェンダリーなど）はセリフで言わない（ユーザー指示「レアリティを直接言わないで」）', () => {
  for (const l of allLines()) assert.ok(!/ノーマル|レア|エピック|レジェンダリー|ユニーク/.test(l.text), l.text)
})

test('【確定】親方は名乗らない（ユーザー指示「親方は名乗らなくていい」）', () => {
  // 名前（トルステン）は設計書とコードの中の呼び名だけ。セリフに出さない
  for (const l of allLines()) assert.ok(!/トルステン|名乗/.test(l.text), l.text)
})

test('【確定】好感度は無い（ユーザー指示「鍛冶屋のおっちゃんは好感度システムいらないや」）：はじめて来た人にも言えるセリフだけ・サーバーに聞かない', () => {
  // 段階で出し分けない（どのセリフも min／max／dayMin を持たない）・段階や場面の決まりも無い
  for (const l of allLines()) assert.ok(!('min' in l || 'max' in l || 'dayMin' in l || 'dayMax' in l), `${l.kind}：${l.text}`)
  for (const name of ['MASTER_STAGES', 'MASTER_STAGE_EVENTS', 'stageOf', 'stageEventOf']) assert.equal(M[name], undefined, name)
  // 顔なじみ・常連を前提にしたセリフは入れない
  for (const l of allLines()) assert.ok(!/また来たな|よく来るな|常連|こないだ|久しぶり/.test(l.text), `${l.kind}：${l.text}`)
  assert.deepEqual([linesOf('enter').length, linesOf('tap').length], [3, 11])
  // 画面もサーバーに好感度を聞かない・好感度の列を読まない
  const smith = read('components/V2capSmith.jsx')
  for (const s of ['v2cap_smith_talk', 'v2cap_smith_seen', 'smith_affinity', 'smith_stage_seen', '好感度 {']) assert.ok(!smith.includes(s), s)
})

test('強化の結果：失敗→なぐさめる・+1〜6→喜ぶ・+7〜9（成功率40%以下）→すげえぞ・+10（上限）→最高傑作。成功はどれも笑顔', () => {
  assert.equal(GREAT_PLUS, 7)
  assert.equal(ENHANCE_RATE[GREAT_PLUS - 1], 40)
  assert.equal(PLUS_MAX, 10)
  assert.deepEqual([1, 6, 7, 9, 10].map(p => enhanceKindOf(true, p)), ['enhanceOk', 'enhanceOk', 'enhanceGreat', 'enhanceGreat', 'enhanceMax'])
  assert.equal(enhanceKindOf(false, 9), 'enhanceFail')
  assert.ok([...MASTER_LINES.enhanceOk, ...MASTER_LINES.enhanceGreat, ...MASTER_LINES.enhanceMax].every(l => l.face === 'smile'))
  assert.ok(MASTER_LINES.enhanceFail.some(l => l.text.includes('次いこうぜ')), '失敗はなぐさめる')
  assert.equal(pickLine('enhanceGreat').text, 'おおっ…！ ここまで鍛え上がるとはな！ こいつはすげえぞ！')
})

test('【確定】2026-10-26 親方は強化値の数・成功率・ゲームの仕組みの言葉を言わない（ユーザー指示「＋9 とかメタい発言しないでほしい、世界観守って」）', () => {
  for (const l of allLines()) {
    assert.ok(!/[+＋]\s*\d|\{plus\}|強化値|成功率|成功は|確率|[%％]/.test(l.text), `${l.kind}：${l.text}`)
  }
  assert.ok(!read('components/V2capSmith.jsx').includes('{ plus: data.plus }'), 'セリフに強化値を渡さない')
})

test('足りないもの：強化できないわけ（smith.js の enhanceErrorOf）から「◯◯の残骸」「Gold」を取り出す', () => {
  const sword = { rarity: 'R', area: 1, lv: 10 }
  const inv = { ilv: 10, plus: 0 }
  assert.equal(shortWhatOf(enhanceErrorOf(sword, inv, { materials: {}, gold: 99999 })), '新緑の残骸')
  assert.equal(shortWhatOf(enhanceErrorOf(sword, inv, { materials: { 1: 99 }, gold: 0 })), 'Gold')
  assert.equal(shortWhatOf(enhanceErrorOf(sword, inv, { materials: { 1: 99 }, gold: 99999 })), null)
  assert.equal(shortWhatOf(enhanceErrorOf(sword, { ilv: 10, plus: PLUS_MAX }, { materials: { 1: 99 }, gold: 99999 })), null, '上限は足りないせいではない')
  assert.equal(pickLine('short', { vars: { what: '新緑の残骸' } }).text, 'おっと、新緑の残骸が足りねえな。出撃して集めてきな')
})

test('同じセリフが2回続かない（2つ以上あるとき）・夜おそく（日本時間の0〜5時）は夜のひとこと', () => {
  let n = 0
  const rng = () => [0, 0.99, 0.5][n++ % 3]
  let last = null
  for (let i = 0; i < 30; i++) {
    const l = pickLine('tap', { rng, last, vars: { call: '兄ちゃん' } })
    assert.notEqual(l.text, last)
    last = l.text
  }
  assert.equal(pickLine('streak5', { last: 'ガハハ！ くすぐってえな！' }).text, 'ガハハ！ くすぐってえな！', '1つしか無い場面はそのまま')
  const jst = (h) => new Date(Date.UTC(2026, 9, 26, h - 9))
  assert.equal(enterKindOf(jst(2)), 'enterNight')
  assert.equal(enterKindOf(jst(12)), 'enter')
})

test('画面：鍛冶屋の右に親方（狭い画面は上）・強化と作成の結果のポップアップにも親方', () => {
  assert.ok(read('pages/V2capHome.jsx').includes("{screen === 'smith' && <V2capSmith prof={prof} inventory={inventory} onProfile={refresh} onGo={setScreen} />}"))
  const smith = read('components/V2capSmith.jsx')
  assert.ok(smith.includes('<V2capSmithMaster face={master.face} line={master.text} tick={master.tick} onTap={tapMaster} />'))
  assert.equal((smith.match(/say=\{fxJob\.say && <MasterSays face=\{fxJob\.say\.face\} line=\{fxJob\.say\.text\} \/>\}/g) || []).length, 2, '強化と作成の演出に親方を渡す')
  for (const f of ['components/V2capEnhanceFx.jsx', 'components/V2capCraftFx.jsx']) {
    const fx = read(f)
    assert.ok(/export default function \w+\(\{ job, say,/.test(fx), `${f}：say を受け取る`)
    assert.ok(/<div style=\{\{ padding:'10px 12px', fontSize:12, color:'#88ccff', lineHeight:1\.8 \}\}>\n\s+\{say\}/.test(fx), `${f}：結果のポップアップの上に出す`)
  }
  const css = read('components/V2capSmithMaster.jsx')
  assert.ok(css.includes('.smm-btn:not(:disabled):hover { filter: brightness(1.05); }'), '押すときの光り方は看板娘と同じく控えめ')
  assert.ok(css.includes('.smm-btn::after { content: none; }'), 'ボタンの光沢（dev-ui.css の button::after）を絵に重ねない＝箱の中に立って見えない')
  assert.ok(css.includes('const SAY = cropOf(92, 124)') && css.includes('const THUMB = cropOf(112, 150)'), '小さく出すときは頭から胸まで（MASTER_FOCUS）')
  assert.ok(css.includes('@media (max-width: 720px)'), '狭い画面は親方が上')
})
