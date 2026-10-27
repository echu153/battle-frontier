// v2cap：賭博場のアレア（カクテルウェイトレス）の決まりを固定するテスト（node --test）
// 【確定】2026-10-27 ユーザー指示（人物・絵・置き場所・動き・好感度・セリフは alea.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import {
  ALEA_OUTFITS, ALEA_OUTFIT, ALEA_ART_DIR, aleaSrc, ALEA_FACES, ALEA_FACE_KEYS, ALEA_WELCOME, ALEA_FACE_SIZE, ALEA_WELCOME_H, ALEA_FOCUS,
  ALEA_STAGES, CASUAL_STAGE, NAME_STAGE, stageOf, varsOf, ALEA_LINES, ALEA_STAGE_EVENTS, stageEventOf, linesOf, pickLine, ALEA_RARE_WEIGHT,
  enterKindOf, welcomeLineOf, winTalkOf, atTalkOf, LOSE_GAP_MS, HILO_LOSE_STREAK, ROULETTE_MISS_RUN, loseDue, nextMissRun, dayOf,
  ALEA_THUMB, ALEA_SIDE_MIN_W, bjTalkOf, BJ_TALK_GAP_MS, BJ_QUIET_KINDS, bjTalkDue, SELF_NAME_STAGE, dealerNameOf,
} from './alea.js'
import { CLERK_RARE_WEIGHT } from './clerk.js'
import { WIN_TIERS } from './casino.js'

const PUB = new URL('../../../public/', import.meta.url)
const fileOf = (key, outfit = ALEA_OUTFIT) => new URL(`.${ALEA_ART_DIR}/${outfit}/${key}.webp`, PUB)
const pathOf = (url) => url.pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// WebP の大きさ（VP8X・VP8L・VP8 のどれか）
const webpSize = (buf) => {
  const kind = buf.toString('ascii', 12, 16)
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) } }
  return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
}
const allLines = () => Object.entries(ALEA_LINES).flatMap(([kind, list]) => list.map(l => ({ kind, ...l })))
const allTexts = () => [...allLines(), ...Object.entries(ALEA_STAGE_EVENTS).map(([s, e]) => ({ kind: `段階${s}`, ...e }))]

// ===== 絵 =====
test('表情は5つ（普通・微笑み・びっくり・あくび・ジト目）・全身の「いらっしゃい」', () => {
  assert.deepEqual(ALEA_FACES.map(f => f.label), ['普通', '微笑み', 'びっくり', 'あくび', 'ジト目'])
  assert.equal(new Set(ALEA_FACE_KEYS).size, 5)
  for (const f of ALEA_FACES) assert.ok(f.src.includes(f.label), `${f.label}：プロンプトのページの保存名で読む`)
  assert.ok(ALEA_WELCOME.src.includes('いらっしゃい'))
})

test('着せ替えはあとで（ユーザーの予定）：いまはディーラー服だけ・絵は衣装ごとのフォルダ', () => {
  assert.deepEqual(ALEA_OUTFITS.map(o => o.key), ['dealer'])
  assert.equal(ALEA_OUTFIT, 'dealer')
  assert.equal(aleaSrc('normal'), '/v2cap-art/casino/dealer/normal.webp')
})

test('絵がそろっている。表情5枚は同じ大きさ（切り替えても体が動かない）・全身の高さ', () => {
  for (const k of ALEA_FACE_KEYS) {
    const f = fileOf(k)
    assert.ok(existsSync(f), `${k} の絵が無い＝ node tools/v2cap-casino-art.mjs`)
    assert.deepEqual(webpSize(readFileSync(f)), ALEA_FACE_SIZE, `${k} の大きさ`)
  }
  assert.ok(existsSync(fileOf(ALEA_WELCOME.key)))
  assert.equal(webpSize(readFileSync(fileOf(ALEA_WELCOME.key))).h, ALEA_WELCOME_H)
  assert.ok(ALEA_FOCUS.x > 0 && ALEA_FOCUS.x < 1 && ALEA_FOCUS.top > 0 && ALEA_FOCUS.top < 1)
})

test('【2026-10-27 直した】小さく出すとき（スマホの上・演出の上）は、頭の高さの髪の左右の端のまん中に合わせる（左の髪が切れない）', async (t) => {
  // ユーザー指示「ひだりの髪が少し見切れちゃってるから、もう少しバランスよく見えるように」。前は顔のまん中（0.54）に合わせていた
  let decode
  try { ({ decode } = await import('../../../tools/v2cap-art-lib.mjs')); decode(pathOf(fileOf(ALEA_FACE_KEYS[0])), 64, 'rgba') } catch { t.skip('ffmpeg が無い'); return }
  const img = decode(pathOf(fileOf('normal')), 4096, 'rgba')
  // 頭の高さ（上から10〜30%）で、髪と体がある左右の端
  let l = img.W, r = -1
  for (let y = Math.round(0.10 * img.H); y < Math.round(0.30 * img.H); y++) {
    for (let x = 0; x < img.W; x++) if (img.data[(y * img.W + x) * 4 + 3] > 128) { if (x < l) l = x; if (x > r) r = x }
  }
  // 上の帯の枠（ALEA_THUMB）に見えるところ（元の絵の px）
  const k = ALEA_THUMB.h / (img.H * ALEA_FOCUS.top)
  const half = ALEA_THUMB.w / k / 2, mid = ALEA_FOCUS.x * img.W
  const cutL = Math.max(0, (mid - half) - l), cutR = Math.max(0, r - (mid + half))
  assert.ok(Math.abs((l + r) / 2 / img.W - ALEA_FOCUS.x) < 0.02, `頭の高さの髪のまん中（${((l + r) / 2 / img.W).toFixed(3)}）に合わせる`)
  assert.ok(cutL <= 20 && cutR <= 20, `頭の高さで切れる髪は左右とも少し（左${Math.round(cutL)}px・右${Math.round(cutR)}px）`)
  assert.ok(Math.abs(cutL - cutR) <= 10, `左右の切れ方がほぼ同じ（左${Math.round(cutL)}px・右${Math.round(cutR)}px）`)
})

test('public/v2cap-art/casino の絵はどれも一覧に載っている（名前を変えて残った絵がない）', () => {
  const outfits = new Set(ALEA_OUTFITS.map(o => o.key))
  for (const d of readdirSync(new URL(`.${ALEA_ART_DIR}/`, PUB))) assert.ok(outfits.has(d), `${d} は衣装の一覧に無い`)
  const known = new Set([...ALEA_FACE_KEYS, ALEA_WELCOME.key].map(k => `${k}.webp`))
  for (const o of outfits) for (const f of readdirSync(new URL(`.${ALEA_ART_DIR}/${o}/`, PUB))) assert.ok(known.has(f), `${o}/${f} は一覧に無い`)
})

test('絵の透明なところは本当に透明（透明度0）・うっすら残った透明度が多すぎない（親方の絵で直した膜が出ない）', async (t) => {
  let decode
  try { ({ decode } = await import('../../../tools/v2cap-art-lib.mjs')); decode(pathOf(fileOf(ALEA_FACE_KEYS[0])), 64, 'rgba') } catch { t.skip('ffmpeg が無い'); return }
  for (const k of [...ALEA_FACE_KEYS, ALEA_WELCOME.key]) {
    const img = decode(pathOf(fileOf(k)), 4096, 'rgba')
    const at = (x, y) => img.data[(y * img.W + x) * 4 + 3]
    assert.deepEqual([at(0, 0), at(img.W - 1, 0)], [0, 0], `${k}：上のすみは透明`)
    let low = 0
    for (let p = 0; p < img.W * img.H; p++) { const a = img.data[p * 4 + 3]; if (a > 0 && a < 16) low++ }
    assert.ok(low / (img.W * img.H) < 0.05, `${k}：うっすら残った透明度（1〜15）が多すぎない（${(low / (img.W * img.H) * 100).toFixed(1)}%）`)
  }
})

// ===== セリフ =====
test('セリフの表情はどれも5つのどれか・5つとも使っている・埋める名前は {name}（段階の場面だけ {username} も）', () => {
  const used = new Set()
  for (const [kind, list] of Object.entries(ALEA_LINES)) {
    assert.ok(list.length > 0, kind)
    for (const l of list) { assert.ok(ALEA_FACE_KEYS.includes(l.face), `${kind}：${l.face}`); used.add(l.face) }
  }
  assert.deepEqual([...used].sort(), [...ALEA_FACE_KEYS].sort())
  for (const l of allLines()) for (const m of l.text.matchAll(/\{(\w+)\}/g)) assert.equal(m[1], 'name', l.text)
  for (const e of Object.values(ALEA_STAGE_EVENTS)) for (const m of e.text.matchAll(/\{(\w+)\}/g)) assert.ok(['name', 'username'].includes(m[1]), e.text)
  assert.equal(ALEA_LINES.hugeWin[0].face, 'surprised', 'とても大きな当たりはびっくり')
  assert.ok([...ALEA_LINES.enterNight, ...ALEA_LINES.tapNight].every(l => l.face === 'yawn'), '夜おそくはあくび')
  assert.ok([...ALEA_LINES.streak8, ...ALEA_LINES.short].every(l => l.face === 'jito'), 'しつこいとき・お財布が足りないときはジト目')
})

test('【確定】数字やゲームの仕組みの言葉は言わない（世界観を守る・賭博場は枚数や還元率の数字が多いので特に）', () => {
  const META = /[0-9０-９]|[%％]|Gold|ゴールド|確率|還元|倍|枚|\bAT\b|\bCZ\b|BIG|MEGA|JACKPOT|WIN|ラッキー|上乗せ|押し順|ナビ|レート|ステータス|好感度|レア|ノーマル|エピック|レジェンダリー|ユニーク|EXP|経験値/
  // 名前の「アレア」の中の「レア」はレア度ではない
  for (const l of allTexts()) assert.ok(!META.test(l.text.replace(/アレア/g, '')), `${l.kind}：${l.text}`)
})

test('【確定】話し方：はじめてと顔なじみは気だるいていねい語・常連（10日目）からくだけた話し方（ユーザーが案を見て「この案で」）', () => {
  assert.deepEqual(ALEA_STAGES.map(s => s.min), [0, 2, 10, 20, 40], '看板娘と同じペース')
  assert.equal(CASUAL_STAGE, 2)
  const POLITE = /です|ます|ませ|ください/
  // enter（はじめてのあいさつ）は段階0だけに出す（enterKindOf は顔なじみから「今日も／久しぶり／また」を選ぶ・下のテスト）
  for (const kind of Object.keys(ALEA_LINES).filter(k => k !== 'enter')) {
    for (let st = CASUAL_STAGE; st <= 4; st++) for (const l of linesOf(kind, st)) assert.ok(!POLITE.test(l.text), `${kind}（段階${st}）：${l.text}`)
  }
  // くだけた話し方に変わる日の場面
  assert.ok(ALEA_STAGE_EVENTS[2].text.includes('堅苦しいの、やめてもいい？'))
  assert.equal(welcomeLineOf({ alea_affinity: 0 }), '…いらっしゃいませ。ようこそ、賭博場へ')
  assert.equal(welcomeLineOf({ alea_affinity: 10 }), '…いらっしゃい。待ってたよ')
})

test('名前で呼ぶのは仲良し（20日目）から（〇〇くん／〇〇ちゃん＝看板娘と同じ）。それより前のセリフに {name} は出てこない', () => {
  assert.equal(NAME_STAGE, 3)
  for (const l of allLines()) if (l.text.includes('{name}')) assert.ok((l.min ?? 0) >= NAME_STAGE, `${l.kind}：${l.text}`)
  for (const kind of ['enterDaily', 'enterLong', 'enterAgain', 'enterNight', 'streak3', 'streak5', 'streak8', 'atStart', 'bigWin', 'hugeWin', 'lose', 'exchange', 'short']) {
    assert.ok(linesOf(kind, 3).every(l => l.text.includes('{name}')), `${kind} の20日目から`)
    assert.ok(linesOf(kind, 2).every(l => !l.text.includes('{name}')), `${kind} の20日目より前`)
  }
  assert.deepEqual(varsOf({ username: 'おれおれお', gender: 'm' }), { name: 'おれおれおくん', username: 'おれおれお' })
  assert.equal(pickLine('enterDaily', { stage: 3, vars: varsOf({ username: 'ミナ', gender: 'f' }) }).text, '…ミナちゃん、今日も来たんだ。待ってたよ')
})

test('仲良くなるとタップのセリフが増える（はじめて8 → 顔なじみ10 → 常連15 → 仲良し20 → 親友22）・顔なじみからのあいさつは、はじめての日には出ない', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(s => linesOf('tap', s).length), [8, 10, 15, 20, 22])
  for (const kind of ['enterDaily', 'enterLong', 'enterAgain']) assert.equal(linesOf(kind, 0).length, 0, kind)
})

test('【確定】40日目に名乗る（名前はアレア）。それより前のセリフに名前は出てこない', () => {
  assert.ok(ALEA_STAGE_EVENTS[4].text.includes('アレア'), '親友になった日に名乗る')
  for (const l of allTexts()) {
    if (!/アレア/.test(l.text)) continue
    assert.ok(l.kind === '段階4' || (l.min ?? 0) >= 4, `${l.kind}：${l.text}`)
  }
  assert.ok(ALEA_STAGE_EVENTS[3].text.includes('{username}') && ALEA_STAGE_EVENTS[3].text.includes('{name}'), '20日目に名前を聞いて呼び始める')
})

test('段階の場面は1回だけ・いちばん上のまだ見せていないもの', () => {
  assert.deepEqual([0, 1, 2, 9, 10, 19, 20, 39, 40, 999].map(stageOf), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  assert.equal(stageOf(undefined), 0)
  assert.equal(stageEventOf(0, 0), null)
  assert.equal(stageEventOf(1, 0).stage, 1)
  assert.equal(stageEventOf(1, 1), null)
  assert.equal(stageEventOf(3, 1).stage, 3)   // 段階を飛ばしたら上のほうだけ
  assert.equal(stageEventOf(4, 4), null)
})

test('【確定】元素使いの伏線（ユーザー「アレアも元素使いの上位職の最強格NPCとして出す予定」）：出にくく・常連から・正体はばらさない', () => {
  const rare = ALEA_LINES.tap.filter(l => l.rare)
  assert.equal(rare.length, 6)
  assert.deepEqual(rare.map(l => l.min), [2, 2, 2, 3, 3, 4], '常連から3つ・仲良しから2つ・親友から1つ')
  assert.equal(ALEA_RARE_WEIGHT, CLERK_RARE_WEIGHT, '看板娘の伏線と同じ4分の1')
  for (const l of allTexts()) assert.ok(!/元素|魔法|魔術|精霊/.test(l.text), `${l.kind}：${l.text}`)
  // 常連の候補（ふつう12・出にくい3）で1000回まんべんなく引くと、出にくいほうは 3×0.25÷(12＋0.75)＝5.9%
  let hit = 0
  for (let i = 0; i < 1000; i++) if (rare.some(l => l.text === pickLine('tap', { stage: 2, rng: () => i / 1000 }).text)) hit++
  assert.ok(hit >= 45 && hit <= 75, `出にくいセリフ ${hit}/1000`)
})

test('同じセリフが2回続かない（2つ以上あるとき）', () => {
  let n = 0
  const rng = () => [0, 0.99, 0.5][n++ % 3]
  let last = null
  for (let i = 0; i < 30; i++) {
    const l = pickLine('tap', { rng, last, stage: 2 })
    assert.notEqual(l.text, last)
    last = l.text
  }
  assert.equal(pickLine('streak8', { last: '…わたしはカードじゃありません。めくらないでください' }).text, '…わたしはカードじゃありません。めくらないでください', '1つしか無い場面はそのまま')
})

test('賭博場を開いたときのひとこと：夜おそく→あくび・はじめて→ふつう・顔なじみから→今日も／久しぶり／また', () => {
  const noon = new Date(Date.UTC(2026, 9, 27, 3))    // 日本時間12時
  const night = new Date(Date.UTC(2026, 9, 26, 17))  // 日本時間2時
  const today = dayOf(noon), yesterday = dayOf(new Date(noon.getTime() - 864e5))
  assert.equal(enterKindOf(night, { stage: 3, lastVisit: yesterday }), 'enterNight')
  assert.equal(enterKindOf(noon, { stage: 0, lastVisit: yesterday }), 'enter')
  assert.equal(enterKindOf(noon, { stage: 1, lastVisit: yesterday }), 'enterDaily')
  assert.equal(enterKindOf(noon, { stage: 1, lastVisit: '2026-10-20' }), 'enterLong')
  assert.equal(enterKindOf(noon, { stage: 1, lastVisit: null }), 'enterLong')
  assert.equal(enterKindOf(noon, { stage: 1, lastVisit: today }), 'enterAgain')
})

// ===== ゲームの結果 =====
test('大当たり：BIG WIN→へぇ、やりますね・MEGA WIN／JACKPOT・雷の数字にぴったり・中段チェリー→びっくり・ATに入った→ここからが本番・WIN は言わない', () => {
  assert.deepEqual(WIN_TIERS.map(t => winTalkOf(t.key)), ['hugeWin', 'hugeWin', 'bigWin', null])
  assert.equal(winTalkOf('win', { lucky: true }), 'hugeWin')
  assert.equal(winTalkOf(undefined), null)
  assert.equal(atTalkOf('premium'), 'hugeWin')
  assert.equal(atTalkOf('scherry'), 'atStart')
})

test('負けたとき：ハイ&ローで連勝が途切れた・スロットのチャンスが実らなかった・ルーレットで3回続けて外れた。どれも1分に1回まで', () => {
  assert.equal(LOSE_GAP_MS, 60000)
  assert.equal(HILO_LOSE_STREAK, 2)
  assert.equal(ROULETTE_MISS_RUN, 3)
  const t0 = 1_000_000
  assert.equal(loseDue(0, t0), true)
  assert.equal(loseDue(t0, t0 + LOSE_GAP_MS - 1), false)
  assert.equal(loseDue(t0, t0 + LOSE_GAP_MS), true)
  let run = 0
  run = nextMissRun(run, 0); run = nextMissRun(run, 0)
  assert.equal(run, 2)
  assert.equal(nextMissRun(run, 5), 0, '当たったら0から')
  assert.equal(nextMissRun(run, 0), ROULETTE_MISS_RUN)
})

// ===== 画面 =====
test('画面：賭博場の右にアレア（狭い画面は上）・タップと好感度・ゲームの結果と両替でセリフ・大当たりの演出の上にもアレア', () => {
  const casino = read('components/V2capCasino.jsx')
  assert.ok(casino.includes('<V2capAlea face={alea.face} line={alea.text} tick={alea.tick} onTap={tapAlea} />'))
  assert.ok(casino.includes("const talkAsker = makeDailyAsker(() => supabase.rpc('v2cap_alea_talk'))"), '好感度は1日1回だけ聞く（看板娘と同じ）')
  assert.ok(casino.includes("supabase.rpc('v2cap_alea_seen', { p_stage: ev.stage }).then(() => {})"))
  assert.equal((casino.match(/onTalk=\{onTalk\}/g) || []).length, 4, '4つのゲームに渡す（2026-10-28 ブラックジャックを足した）')
  assert.ok(casino.includes("say('exchange')") && casino.includes("say('short')"), '両替した・お財布を超えた')
  assert.ok(casino.includes('if (!loseDue(lastLose.current)) return null'), '負けたときは1分に1回まで')
  assert.ok(casino.includes('{dev && ('), '開発用のボタンは管理者だけ')
  const slot = read('components/V2capSlot.jsx')
  assert.ok(slot.includes('onTalk?.(atTalkOf(from))'), 'ATに入った（announceAt）')
  assert.ok(slot.includes("onTalk?.('lose')"), 'CZ失敗')
  assert.ok(slot.includes('say: onTalk?.(winTalkOf(tier.key))'), 'ATが終わって大きく増えた')
  const hilo = read('components/V2capHilo.jsx')
  assert.ok(hilo.includes("if (g.streak >= HILO_LOSE_STREAK) onTalk?.('lose')"))
  assert.equal((hilo.match(/say: onTalk\?\.\(winTalkOf\(/g) || []).length, 2, '受け取り・自動で受け取り')
  const roulette = read('components/V2capRoulette.jsx')
  assert.ok(roulette.includes("if (missRun.current >= ROULETTE_MISS_RUN) { missRun.current = 0; onTalk?.('lose') }"))
  assert.ok(roulette.includes('say: onTalk?.(winTalkOf(tier?.key, { lucky: luckyHit }))'))
  assert.ok(read('components/casinoFx.js').includes("fx('banner', { tier, amount, title, sub, say })"))
  assert.ok(read('components/CasinoFxLayer.jsx').includes('{banner.say}'), 'BIG WIN などの演出の上に出す')
  const css = read('components/V2capAlea.jsx')
  assert.ok(css.includes('.al-btn:not(:disabled):hover { filter: brightness(1.05); }'), '押すときの光り方は看板娘・親方と同じく控えめ')
  assert.ok(css.includes('.al-btn::after { content: none; }'), 'ボタンの光沢（dev-ui.css の button::after）を絵に重ねない')
  assert.ok(css.includes('const SAY = cropOf(92, 124)') && css.includes('const THUMB = cropOf(ALEA_THUMB.w, ALEA_THUMB.h)'), '小さく出すときは頭から胸まで（ALEA_FOCUS）')
  assert.ok(css.includes('@media (max-width: ${ALEA_SIDE_MIN_W - 1}px)'), '幅が足りないときはアレアが上の帯')
})

test('【2026-10-27 直した】スクロールしないとゲームができなくなった（ユーザー指示「画像の部分調整したい」）：右に立たせるのは広い画面だけ・上の帯は小さく・メダルの欄は1行・好感度の開発用ボタンなし', () => {
  // 右の列（300px）を置くとゲームの幅が狭くなり、ルーレットはホイールと盤が縦に積まれて SPIN が画面の下に落ちていた（ホイール300＋盤360＋すき間12＋枠）
  assert.equal(ALEA_SIDE_MIN_W, 1081)
  assert.ok(ALEA_SIDE_MIN_W - 16 * 2 - 300 - 8 >= 300 + 12 + 360 + 22, '右に立たせても、ルーレットのホイールと盤が横に並ぶ幅が残る')
  assert.deepEqual(ALEA_THUMB, { w: 84, h: 112 }, '上の帯の絵（前は 112×150）')
  const css = read('components/V2capAlea.jsx')
  assert.ok(css.includes('.al-dev { display: none; }'), '上の帯のときは開発用のボタンも出さない')
  const casino = read('components/V2capCasino.jsx')
  // 好感度の開発用のボタンは外した（ユーザー「好感度は確認したからいらない」）。「いらっしゃいを見る」は広い画面だけに残す
  for (const s of ['setDevAff', '>段階の場面<', '>本物に戻す<', '［開発］好感度']) assert.ok(!casino.includes(s), s)
  assert.ok(casino.includes('<div className="al-dev"'))
  // メダルの欄は1行で細く（ユーザー「メダルももっとスリムにして」）
  assert.ok(casino.includes("padding:'5px 10px'") && casino.includes("fontSize:'16px'") && !casino.includes("fontSize:'22px'"))
})

test('【2026-10-27 直した】効果音の切り替えは題の行の右端（ユーザー指示「音ありなし右上に設置するようにして」）', () => {
  const casino = read('components/V2capCasino.jsx')
  assert.ok(casino.includes('export function CasinoSoundToggle() {'))
  assert.equal((casino.match(/aria-label="効果音"/g) || []).length, 1, '賭博場の画面の中には置かない')
  assert.ok(read('pages/V2capHome.jsx').includes("{screen === 'casino' && <span style={{ marginLeft:'auto' }}><CasinoSoundToggle /></span>}"))
})

test('【確定】2026-10-27 役はカクテルウェイトレス（ユーザー「受付っていうか、カジノでそこらへん歩いてる店員」＋選んだ呼び方）・セリフに「受付」は出てこない', () => {
  for (const l of allTexts()) assert.ok(!/受付/.test(l.text), `${l.kind}：${l.text}`)
  // 役に合わせて直した3か所（ユーザー選択「直す」）
  const texts = allTexts().map(l => l.text)
  assert.ok(texts.includes('勝っているときほど、引き際が大事ですよ。…なんて、店員が言うことじゃないですね'))
  assert.ok(texts.includes('ここの仕事？ 飲みものを配って歩くだけ。…わりと気に入ってる'))
  assert.ok(texts.includes('アレアって呼ばれるの、{name}だけなんだよ。…ほかの人は、店員さんって呼ぶから'))
  assert.ok(read('components/V2capAlea.jsx').includes('aria-label="店員さんに話しかける"'))
})

test('その日の「いらっしゃい」は賭博場の画面より先（ホームの上）に出し、閉じたら賭博場の画面へ（看板娘と同じ）', () => {
  const home = read('pages/V2capHome.jsx')
  assert.ok(home.includes("if (key === 'casino' && casinoWelcomeDue(prof)) { markCasinoWelcome(); setCasinoWelcome(welcomeLineOf(prof)); return }"),
    'その日はじめてなら賭博場の画面へ行かずに先に出す（返事は待たない）')
  assert.ok(home.includes("const closeCasinoWelcome = () => { setCasinoWelcome(null); setScreen('casino') }"), '閉じたら賭博場の画面へ')
  assert.ok(home.includes('{casinoWelcome && <V2capAleaWelcome line={casinoWelcome} onClose={closeCasinoWelcome} />}'), 'ホームの上に出す')
  assert.ok(home.includes("{screen === 'casino' && <V2capCasino prof={prof} onProfile={refresh} dev={isAdmin} />}"))
  const casino = read('components/V2capCasino.jsx')
  assert.equal(casino.match(/rpc\('v2cap_casino_welcome'\)/g).length, 1, '印を付けるのは markCasinoWelcome だけ（賭博場を開いてから聞き直さない）')
  assert.ok(casino.includes('welcomeShownDay !== dayOf(at) && welcomeDueLocal(prof?.casino_welcome_day, at)'))
  // ホームの上でも見た目が崩れないように、全身の絵の CSS は V2capAleaWelcome が自分で持つ
  const alea = read('components/V2capAlea.jsx')
  assert.ok(alea.includes('<style>{WELCOME_CSS}</style>'))
  assert.ok(!alea.slice(0, alea.indexOf('const WELCOME_CSS')).includes('.al-welcome {'), 'ALEA_CSS には入れない')
})

// ===== ブラックジャック（2026-10-28・アレアがディーラー）=====
const BJ_KINDS = ['bjSit', 'bjUnlock', 'bjLocked', 'bjDouble', 'bjNatural', 'bjDealerNatural', 'bjBust', 'bjDealerBust', 'bjWin', 'bjLose', 'bjPush']

test('【確定】2026-10-28 ブラックジャックのひとこと（ユーザーが案を見て「この案で入れて」）：どの場面も段階ごとにある（ていねい語→常連からくだけた話し方→仲良しから名前）・ゲームの言葉（ヒット・ダブルなど）も言わない', () => {
  for (const k of BJ_KINDS) {
    for (let st = 0; st <= 4; st++) assert.ok(linesOf(k, st).length > 0, `${k}（段階${st}）`)
    assert.ok(linesOf(k, NAME_STAGE).every(l => l.text.includes('{name}')), `${k} の20日目から名前で呼ぶ`)
    assert.ok(linesOf(k, NAME_STAGE - 1).every(l => !l.text.includes('{name}')), `${k} の20日目より前`)
    for (const l of ALEA_LINES[k]) assert.ok(!/ブラックジャック|ヒット|スタンド|ダブル|バスト|スプリット|ディーラー|ソフト/.test(l.text), `${k}：${l.text}`)
  }
  assert.ok(ALEA_LINES.bjNatural.every(l => l.face === 'surprised'), 'こちらのブラックジャックはびっくり')
  assert.ok(ALEA_LINES.bjBust.every(l => l.face === 'jito'), 'こちらの引きすぎはジト目')
  assert.ok(linesOf('bjWin', 0).length >= 2 && linesOf('bjLose', 0).length >= 2, 'よく出る勝ち負けは2つずつ（同じセリフが続かない）')
})

test('ブラックジャックのひとことの出し方：終わり方ごとの場面・ブラックジャックとダブルは毎回・ふつうの勝ち負けなどは30秒に1回まで', () => {
  assert.deepEqual(['natural', 'dealerNatural', 'bust', 'dealerBust', 'win', 'lose', 'push'].map(bjTalkOf),
    ['bjNatural', 'bjDealerNatural', 'bjBust', 'bjDealerBust', 'bjWin', 'bjLose', 'bjPush'])
  assert.equal(bjTalkOf('?'), null)
  assert.deepEqual(BJ_QUIET_KINDS, ['bjBust', 'bjDealerBust', 'bjWin', 'bjLose', 'bjPush'])
  assert.equal(BJ_TALK_GAP_MS, 30000)
  assert.equal(bjTalkDue(0), true)
  assert.equal(bjTalkDue(1000, 1000 + BJ_TALK_GAP_MS - 1), false)
  assert.equal(bjTalkDue(1000, 1000 + BJ_TALK_GAP_MS), true)
  const casino = read('components/V2capCasino.jsx')
  assert.ok(casino.includes('if (BJ_QUIET_KINDS.includes(kind)) {\n      if (!bjTalkDue(lastBj.current)) return null'))
  const bj = read('components/V2capBlackjack.jsx')
  assert.ok(bj.includes("if (action === 'double') onTalk?.('bjDouble')") && bj.includes('onTalk?.(bjTalkOf(outcome))'))
})

test('卓の名札は、アレアが名乗る（40日目の場面を見せる）まで「ディーラー」', () => {
  assert.equal(SELF_NAME_STAGE, 4)
  assert.ok(ALEA_STAGE_EVENTS[SELF_NAME_STAGE].text.includes('アレア'), '名乗る場面')
  assert.deepEqual([0, 3, 4].map(dealerNameOf), ['ディーラー', 'ディーラー', 'アレア'])
  assert.ok(read('components/V2capCasino.jsx').includes('dealerName={dealerNameOf(seen)}'), '段階ではなく、名乗る場面を見せたかで決める')
})
