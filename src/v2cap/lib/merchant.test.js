// v2cap：商店の商人ソルドの決まりを固定するテスト（node --test）
// 【確定】2026-10-31 ユーザー指示（人物・絵・置き場所・動きは merchant.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import {
  MERCHANT_ON, MERCHANT_NAME, MERCHANT_ART_DIR, MERCHANT_FACES, MERCHANT_FACE_KEYS, MERCHANT_FACE_SIZE, MERCHANT_LINES, MERCHANT_STAGES, MERCHANT_STAGE_EVENTS,
  CASUAL_STAGE, NAME_STAGE, merchantSrc, stageOf, stageLabelOf, callOf, varsOf, stageEventOf, linesOf, pickLine, poorOf, enterKindOf, askKindOf, boughtKindOf, MERCHANT_RARE_WEIGHT,
} from './merchant.js'
import { SHOP_ITEMS } from './shop.js'

const PUB = new URL('../../../public/', import.meta.url)
const fileOf = (key) => new URL(`.${merchantSrc(key)}`, PUB)
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// WebP の大きさ（VP8X・VP8L・VP8 のどれか）
const webpSize = (buf) => {
  const kind = buf.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) } }
  return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
}
const allLines = () => [
  ...Object.entries(MERCHANT_LINES).flatMap(([kind, list]) => list.map(l => ({ kind, ...l }))),
  ...Object.entries(MERCHANT_STAGE_EVENTS).map(([s, l]) => ({ kind: `段階${s}の場面`, ...l })),
]
const NO_ART = !MERCHANT_ON && '絵が届くまで MERCHANT_ON=false'

test('表情は3つ（普通・にんまり・薄目＝ユーザー選択）・元の絵は public/V2商店/ の保存名で読む', () => {
  assert.deepEqual(MERCHANT_FACES.map(f => f.label), ['普通', 'にんまり', '薄目'])
  assert.deepEqual(MERCHANT_FACE_KEYS, ['normal', 'grin', 'open'])
  for (const f of MERCHANT_FACES) assert.ok(f.src.includes(f.label), `プロンプトのページの保存名「${f.label}」で読む`)
  assert.equal(MERCHANT_ART_DIR, '/v2cap-art/shop')
  assert.equal(merchantSrc('grin'), '/v2cap-art/shop/grin.webp')
  assert.ok(readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8').includes('/public/V2商店/'), '元の絵は git に入れない')
})

test('絵がそろっている。3枚は同じ大きさ（切り替えても体が動かない）', { skip: NO_ART }, () => {
  for (const k of MERCHANT_FACE_KEYS) {
    const f = fileOf(k)
    assert.ok(existsSync(f), `${k} の絵が無い＝ node tools/v2cap-shop-art.mjs`)
    assert.deepEqual(webpSize(readFileSync(f)), MERCHANT_FACE_SIZE, `${k} の大きさ`)
  }
})

test('絵の透明なところは本当に透明（透明度0）＝商人が箱の中や膜の中に見えない', { skip: NO_ART }, async (t) => {
  let decode
  try { ({ decode } = await import('../../../tools/v2cap-art-lib.mjs')); decode(fileOf(MERCHANT_FACE_KEYS[0]).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 64, 'rgba') } catch { t.skip('ffmpeg が無い'); return }
  for (const k of MERCHANT_FACE_KEYS) {
    const img = decode(fileOf(k).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 4096, 'rgba')
    const at = (x, y) => img.data[(y * img.W + x) * 4 + 3]
    assert.deepEqual([at(0, 0), at(img.W - 1, 0)], [0, 0], `${k}：上のすみは透明`)
    let low = 0
    for (let p = 0; p < img.W * img.H; p++) { const a = img.data[p * 4 + 3]; if (a > 0 && a < 16) low++ }
    assert.ok(low / (img.W * img.H) < 0.05, `${k}：うっすら残った透明度（1〜15）が多すぎない（${(low / (img.W * img.H) * 100).toFixed(1)}%）`)
  }
})

test('public/v2cap-art/shop の絵はどれも一覧に載っている（名前を変えて残った絵がない）', { skip: NO_ART }, () => {
  const known = new Set(MERCHANT_FACE_KEYS.map(k => `${k}.webp`))
  for (const f of readdirSync(new URL(`.${MERCHANT_ART_DIR}/`, PUB))) assert.ok(known.has(f), `${f} は一覧に無い`)
})

test('【確定】セリフはユーザーが案を見て「この案で入れて」（2026-10-31）：場面ごとの数と文', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(MERCHANT_LINES).map(([k, list]) => [k, list.length])), {
    intro: 2, enter: 2, enterDaily: 3, enterLong: 3, enterAgain: 3, enterNight: 3, enterPoor: 3, enterFlip: 3,
    tap: 29, tapNight: 5, streak3: 3, streak5: 3, streak8: 3,
    askGender: 3, askFlip: 3, askFlipMore: 3, boughtF: 3, boughtM: 3, boughtFlip: 3, error: 1,
  })
  assert.deepEqual([0, 1, 2, 3, 4].map(s => linesOf('tap', s).length), [8, 10, 12, 17, 19], '段階ごとのタップのセリフの数')
  const vars = (s) => varsOf({ username: 'おれおれお', gender: 'm' }, s)
  assert.equal(pickLine('error').text, 'ありゃ、うまいこといかへんかったわ。お代はもろてへんから、安心しとき')
  assert.equal(pickLine('streak8', { stage: 0 }).text, '……お客さん。わいの目、開けさせんといてくれます？')
  assert.equal(pickLine('streak8', { stage: 2, vars: vars(2) }).text, '……兄さん。わいの目、開けさせんといてや')
  assert.equal(pickLine('streak8', { stage: 3, vars: vars(3) }).text, '……おれおれおはん。ええ加減にせんと、ほんまに開けるで')
  assert.equal(pickLine('enterPoor', { stage: 4, vars: vars(4) }).text, 'おれおれおはん、銭ないんか。…貸さへんで。それだけは、仲良うても貸さへん')
  assert.ok(allLines().some(l => l.text === 'この金貨か？ わいが最初に稼いだやつや。これだけは、なんぼ積まれても売らへん'), '絵の金貨の話')
  // 3つの表情を全部使う。場面の表情は決まったものだけ
  const used = new Set()
  for (const l of allLines()) { assert.ok(MERCHANT_FACE_KEYS.includes(l.face), `${l.kind}：${l.face}`); used.add(l.face) }
  assert.deepEqual([...used].sort(), [...MERCHANT_FACE_KEYS].sort())
  // 8回目からは糸目が開く・どの薬も買えないときも薄目
  for (const k of ['streak8', 'enterPoor']) assert.ok(MERCHANT_LINES[k].every(l => l.face === 'open'), k)
  // 埋める名前は決まったものだけ（書きまちがいで {nmae} のまま出ない）
  for (const l of allLines()) {
    for (const m of l.text.matchAll(/\{(\w+)\}/g)) assert.ok(['call', 'username'].includes(m[1]), l.text)
  }
})

test('【確定】数字やゲームの仕組みの言葉（値段・効果時間・確率・レア度の名前・Gold・ステータスなど）はセリフに入れない＝世界観を守る', () => {
  // ユーザー指示（親方のとき）「＋9 とかメタい発言しないでほしい、世界観守って」（feedback-npc-no-meta）。守銭奴らしさは「銭」「お代」で出す
  for (const l of allLines()) {
    const t = l.text.replace(/\{\w+\}/g, '')
    assert.ok(!/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]|[+＋]|[%％]|ゴールド|ステータス|レア|ノーマル|エピック|レジェンダリー|ユニーク|確率|効果|時間帯|レベル|経験値|スタミナ|スキル|装備|ポイント|無料|秒/.test(t),
      `${l.kind}：${l.text}`)
  }
  // 値段の代わりの言葉をちゃんと使っている
  assert.ok(allLines().filter(l => /銭|お代/.test(l.text)).length >= 20, '守銭奴らしさ')
})

test('【確定】有名なキャラに似せすぎない：一人称は「わい」・「ボク」「怖いなあ」（糸目で関西弁の有名なキャラ）「ジブン」（ユーザーの例えのキャラ）は使わない', () => {
  for (const l of allLines()) assert.ok(!/ボク|ぼく|僕|怖いなあ|こわいなあ|射殺|ジブン|ワタクシ|自分|俺|オレ/.test(l.text), `${l.kind}：${l.text}`)
  assert.ok(allLines().some(l => l.text.includes('わい')))
  // プロンプトと同じく、作品やキャラの名前はセリフに書かない
  for (const l of allLines()) assert.ok(!/ウォロ|ギン|ヒスイ|イチョウ/.test(l.text), `${l.kind}：${l.text}`)
})

test('【確定】話し方：はじめて・顔なじみは商売口調で呼び方なし（お客さん）・常連から兄さん／姉さん・仲良しから〇〇はん', () => {
  assert.equal(callOf({ gender: 'm' }), '兄さん')
  assert.equal(callOf({ gender: 'f' }), '姉さん')
  assert.equal(callOf({ gender: null }), 'あんた')
  const p = { username: 'おれおれお', gender: 'f' }
  assert.equal(varsOf(p, CASUAL_STAGE).call, '姉さん')
  assert.equal(varsOf(p, NAME_STAGE - 1).call, '姉さん')
  assert.equal(varsOf(p, NAME_STAGE).call, 'おれおれおはん')
  assert.equal(varsOf(p, 4).username, 'おれおれお')
  assert.equal(varsOf({ gender: 'm' }, NAME_STAGE).call, '兄さん', '名前が読めなければ兄さん')
  // 呼び方を埋めるセリフは常連から（商売口調のセリフは呼び方を埋めない）
  for (const [kind, list] of Object.entries(MERCHANT_LINES)) {
    for (const l of list) if (l.text.includes('{call}')) assert.ok((l.min ?? 0) >= CASUAL_STAGE, `${kind}：${l.text}`)
  }
  // 商売口調のセリフと、くだけた話し方のセリフが同じ段階に混ざらない（ちらっと本音は常連から）
  for (const [kind, list] of Object.entries(MERCHANT_LINES)) {
    for (const l of list) {
      // （intro と enter は段階0でしか選ばない＝enterKindOf）
      if (/でっせ|でっか|まっせ|なはれ|まへん|でんな|まんな/.test(l.text) && !['intro', 'enter'].includes(kind)) assert.ok((l.max ?? 99) < CASUAL_STAGE, `${kind}：${l.text}`)
      if (l.rare) assert.ok((l.min ?? 0) >= CASUAL_STAGE, `${kind}：${l.text}`)
    }
  }
  // 名乗るのははじめてだけ（親友のタップは名前を呼ばれる話）
  assert.ok(MERCHANT_LINES.intro.every(l => l.text.includes(MERCHANT_NAME)))
  assert.equal(MERCHANT_NAME, 'ソルド')
  assert.deepEqual(allLines().filter(l => l.text.includes(MERCHANT_NAME) && l.kind !== 'intro').map(l => l.min), [4])
})

test('【確定】好感度：看板娘・アレアと同じペース（2・10・20・40日目）・段階が上がった最初の会話は1回だけ', () => {
  assert.deepEqual(MERCHANT_STAGES.map(s => s.min), [0, 2, 10, 20, 40])
  assert.deepEqual([0, 1, 2, 9, 10, 19, 20, 39, 40, 500, null].map(stageOf), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 0])
  assert.equal(stageLabelOf(2), '常連')
  assert.deepEqual(Object.keys(MERCHANT_STAGE_EVENTS), ['1', '2', '3', '4'])
  assert.equal(stageEventOf(0, 0), null)
  assert.equal(stageEventOf(2, 0).stage, 2, '飛び越えたら、いちばん上の場面だけ')
  assert.equal(stageEventOf(2, 2), null, '見せた段階はもう出さない')
  assert.equal(stageEventOf(3, 2).stage, 3)
  assert.ok(MERCHANT_STAGE_EVENTS[3].text.includes('{username}') && MERCHANT_STAGE_EVENTS[3].text.includes('{call}'), '20日目に名前を聞いて呼び始める')
  assert.ok(MERCHANT_STAGE_EVENTS[2].text.includes('「お客さん」はやめや'), '10日目に呼び方が変わる')
  assert.equal(MERCHANT_STAGE_EVENTS[4].face, 'open', '40日目は糸目を開いてはぐらかす')
})

test('店を開いたときの場面：はじめて→どの薬も買えない→秘薬→夜おそく→顔なじみになるまで→また→今日も→久しぶり', () => {
  const jst = (d, h) => new Date(Date.UTC(2026, 9, d, h - 9))
  const noon = jst(31, 12)
  const of = (o) => enterKindOf({ at: noon, ...o })
  assert.equal(of({ affinity: 0 }), 'intro')
  assert.equal(of({ affinity: 0, poor: true, flipping: true, at: jst(31, 2) }), 'intro', 'はじめては、どの場面より先に名乗る')
  assert.equal(of({ affinity: 1, poor: true, flipping: true }), 'enterPoor')
  assert.equal(of({ affinity: 1, flipping: true, at: jst(31, 2) }), 'enterFlip')
  assert.equal(of({ affinity: 30, at: jst(31, 2) }), 'enterNight')
  assert.equal(of({ affinity: 1, lastTalk: '2026-10-31' }), 'enter', '好感度1は段階0＝まだ顔なじみではない')
  assert.equal(of({ affinity: 2, lastTalk: '2026-10-31' }), 'enterAgain')
  assert.equal(of({ affinity: 2, lastTalk: '2026-10-30' }), 'enterDaily')
  assert.equal(of({ affinity: 2, lastTalk: '2026-10-20' }), 'enterLong')
  assert.equal(of({ affinity: 2, lastTalk: null }), 'enterLong')
  // 朝5時の前は前の日あつかい（デイリーと同じ区切り）
  assert.equal(enterKindOf({ affinity: 2, lastTalk: '2026-10-31', at: jst(31, 6) }), 'enterAgain')
  // どの場面も、その段階で言うセリフがある
  for (const kind of Object.keys(MERCHANT_LINES)) {
    for (const s of [0, 1, 2, 3, 4]) {
      if (['enterDaily', 'enterLong', 'enterAgain'].includes(kind) && s < 1) continue
      assert.ok(linesOf(kind, s).length > 0, `${kind}（段階${s}）`)
    }
  }
})

test('どの薬も買えないか：いちばん安い薬の値段で決める', () => {
  const cheap = Math.min(...SHOP_ITEMS.map(i => i.gold))
  assert.equal(poorOf(cheap), false)
  assert.equal(poorOf(cheap - 1), true)
  assert.equal(poorOf(null), true)
})

test('買う確かめと買った結果の場面：性別変更薬は飲んだあとの性別で分ける・秘薬が効いているのにもう1本', () => {
  assert.equal(askKindOf('gender'), 'askGender')
  assert.equal(askKindOf('gender', true), 'askGender')
  assert.equal(askKindOf('flip'), 'askFlip')
  assert.equal(askKindOf('flip', true), 'askFlipMore')
  assert.equal(boughtKindOf({ item: 'gender', gender: 'f' }), 'boughtF')
  assert.equal(boughtKindOf({ item: 'gender', gender: 'm' }), 'boughtM')
  assert.equal(boughtKindOf({ item: 'flip', flip_until: 'x' }), 'boughtFlip')
  // 飲んだあとの呼び方に合っている
  assert.ok(MERCHANT_LINES.boughtF[1].text.includes('今日からは姉さん'))
  assert.ok(MERCHANT_LINES.boughtM[1].text.includes('今日からは兄さん'))
})

test('同じセリフが2回続かない（2つ以上あるとき）・段階に合わないセリフは出ない・ちらっと本音は出にくい', () => {
  let n = 0
  const rng = () => [0, 0.99, 0.5][n++ % 3]
  let last = null
  for (let i = 0; i < 40; i++) {
    const l = pickLine('tap', { rng, last, stage: 3, vars: { call: 'おれおれおはん' } })
    assert.notEqual(l.text, last)
    last = l.text
  }
  const one = MERCHANT_LINES.error[0].text
  assert.equal(pickLine('error', { last: one }).text, one, '1つしか無い場面はそのまま')
  assert.equal(pickLine('なにか', { rng: () => 0 }).text, MERCHANT_LINES.tap[0].text, '知らない場面はタップのセリフ')
  // 段階
  for (const l of linesOf('tap', 1)) assert.ok(!l.text.includes('{call}'), l.text)
  assert.ok(linesOf('tap', 2).every(l => (l.min ?? 0) >= 2), '常連からは商売口調のセリフが出ない')
  assert.ok(!linesOf('tap', 2).some(l => l.text.includes('ソルドって呼んでくれる')), '親友のセリフは常連に出ない')
  // 4分の1の出やすさ（看板娘と同じ）
  assert.equal(MERCHANT_RARE_WEIGHT, 0.25)
  const rareTexts = new Set(linesOf('tap', 4).filter(l => l.rare).map(l => l.text.replace('{call}', 'X')))
  const list = linesOf('tap', 4)
  const weight = list.reduce((t, l) => t + (l.rare ? 0.25 : 1), 0)
  let hit = 0
  const N = 2000
  for (let i = 0; i < N; i++) if (rareTexts.has(pickLine('tap', { stage: 4, rng: () => (i + 0.5) / N, vars: { call: 'X' } }).text)) hit++
  assert.ok(Math.abs(hit / N - (5 * 0.25) / weight) < 0.01, `ちらっと本音の出る割合（${hit / N}）`)
})

test('画面：品物の右に商人（狭い画面は上）・買う確かめと買った結果にも商人・開発用のボタンは管理者だけ・絵が届くまでは前のまま', () => {
  assert.ok(read('pages/V2capHome.jsx').includes("{screen === 'shop' && <V2capShop prof={prof} onProfile={refresh} dev={isAdmin} />}"))
  const s = read('components/V2capShop.jsx')
  assert.ok(s.includes('<V2capMerchant face={merchant.face} line={merchant.text} tick={merchant.tick} onTap={tapMerchant} />'))
  assert.ok(s.includes('{MERCHANT_ON && askSay && <MerchantSays face={askSay.face} line={askSay.text} />}'), '買う確かめ')
  assert.ok(s.includes('{MERCHANT_ON && boughtSay && <MerchantSays face={boughtSay.face} line={boughtSay.text} />}'), '買った結果')
  assert.ok(s.includes('setBoughtSay(say(boughtKindOf(data)))') && s.includes("say('error'); return"), '買えた・買えなかったで話す')
  assert.ok(s.includes('onConfirm={buy} onClose={cancelAsk}'), '「やめる」で確かめのセリフを残さない（看板娘と同じ）')
  assert.ok(s.includes("const talkAsker = makeDailyAsker(() => supabase.rpc('v2cap_merchant_talk'))"), '同じ日は1回だけサーバーに聞く（開発モードで2回走っても大丈夫）')
  assert.ok(s.includes("supabase.rpc('v2cap_merchant_seen', { p_stage: ev.stage }).then(() => {})"), 'then を付けないと送られない')
  assert.ok(s.includes('{dev && ('), '開発用のボタンは dev のときだけ')
  assert.ok(s.includes('color={DEV} keepScroll'), '開発用のポップアップは見るだけ＝閉じても今の場所のまま')
  assert.ok(s.includes("className={MERCHANT_ON ? 'mer-cols' : undefined}") && s.includes("maxWidth: MERCHANT_ON ? '1068px' : '760px'"), '絵が届くまでは前の並びのまま')
  const css = read('components/V2capMerchant.jsx')
  assert.ok(css.includes('.mer-btn:not(:disabled):hover { filter: brightness(1.05); }'), '押すときの光り方は看板娘と同じく控えめ')
  assert.ok(css.includes('.mer-btn::after { content: none; }'), 'ボタンの光沢（dev-ui.css の button::after）を絵に重ねない＝箱の中に見えない')
  assert.ok(css.includes('@media (max-width: 720px)'), '狭い画面は商人が上')
  assert.ok(css.includes('aria-label="商人に話しかける"'))
})
