// v2cap：AI案内役ジェミータ（資料・決まり・画面・サーバーの突き合わせ）（node --test）
// 【確定】2026-10-26 ユーザー指示「V2でClaude Consoleを用いてジェミータを作りたい・1人1日10回・BFに関係ないことは答えない・プレイヤーの情報も答えない」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { buildJemitaKb, buildJemitaSql, jemitaVersionOf } from './jemitaKb.js'
import { JEMITA_RULES, JEMITA_STATUS_HEAD, JEMITA_QUESTION_HEAD } from './jemitaPrompt.js'
import { JEMITA_KB_VERSION } from './jemitaKbVersion.js'
import { jemitaStatusText, JEMITA_DAILY_LIMIT, JEMITA_MAX_CHARS, JEMITA_THREAD_MS } from './jemita.js'
import { CLASSES } from './jobs.js'
import { AREA_LIST, SPOTS } from './areas.js'
import { UNIQUE_ITEMS, ITEMS } from './equipment.js'
import { CLERK_LINES, CLERK_STAGE_EVENTS } from './clerk.js'
import { SHRINE_NAME } from './shrine.js'
import { NG_JA, NG_EN, isJemitaNG } from './jemitaNg.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const KB = buildJemitaKb()
const EDGE = read('../../../supabase/functions/v2cap-jemita/index.ts')
const SQL = read('../../../supabase_v2cap_jemita.sql')

test('資料の版：ゲームか決まりを変えたら node tools/v2cap-jemita-kb.mjs で作り直す（SQL はユーザーが流す）', () => {
  assert.equal(jemitaVersionOf(), JEMITA_KB_VERSION, 'src/v2cap/lib/jemitaKbVersion.js が古い → node tools/v2cap-jemita-kb.mjs')
  assert.equal(read('../../../supabase_v2cap_jemita_kb.sql'), buildJemitaSql(), 'supabase_v2cap_jemita_kb.sql が古い → node tools/v2cap-jemita-kb.mjs')
})

test('資料：職業・エリア・場所・装備の名前が全部入っている', () => {
  for (const c of CLASSES) assert.ok(KB.includes(`### ${c.id}（`), `職業 ${c.id}`)
  for (const a of AREA_LIST) assert.ok(KB.includes(`「${a.name}」`), `エリア ${a.name}`)
  for (const s of SPOTS) assert.ok(KB.includes(s.name), `場所 ${s.name}`)
  for (const it of ITEMS) assert.ok(KB.includes(it.name), `装備 ${it.name}`)
})

test('資料：画面に出ないもの・見つけてのお楽しみは入れない（ユーザー選択「画面で分かることだけ」）', () => {
  for (const u of UNIQUE_ITEMS) assert.ok(!KB.includes(u.name), `ユニーク ${u.name}（図鑑からも消した）`)
  assert.ok(!KB.includes(SHRINE_NAME) && !KB.includes('祠') && !KB.includes('ハピネスフェアリー'), '安息の祠')
  assert.ok(!/(?<!オリ)ハル(?!コン)/.test(KB) && !KB.includes('付け耳'), '看板娘の名前と裏設定')
  for (const t of [...Object.values(CLERK_LINES).flat(), ...Object.values(CLERK_STAGE_EVENTS)]) {
    const s = typeof t === 'string' ? t : t?.text
    if (s && s.length >= 12) assert.ok(!KB.includes(s.slice(0, 12)), `看板娘のセリフ ${s.slice(0, 12)}`)
  }
  assert.ok(!KB.includes('トルステン') && !KB.includes('親方'), '鍛冶屋の親方')
  // 守護者の+1%・セット能力の「落ちる確率1.2倍」は画面に出る文
  assert.ok(!/ドロップ率\d|遭遇率|落ちる確率\d+%|当たる確率/.test(KB.replace('出撃の装備のドロップ率+1%', '')), '画面に出ない確率')
  assert.ok(!KB.includes('紛争地帯') && !KB.includes('交換所'), 'まだ無い機能')
})

test('資料：大きさ（Claude Haiku 5.5 の安い値段の範囲＝10万トークンに余裕を持って収まる）', () => {
  assert.ok(KB.length < 60000, `資料 ${KB.length}字`)
  assert.ok(JEMITA_RULES.length < 4000, `決まり ${JEMITA_RULES.length}字`)
})

test('決まり：BFの外の話・性的/グロ・ほかのプレイヤーの情報・指示の上書きは断る（ユーザー指示）', () => {
  for (const w of ['バトルフロンティアⅡ', '性的な話・グロテスクな話', 'ほかのプレイヤーの情報', '現実の個人の情報', '従うな', '資料に無い数値', 'レアモンスターとボスの名前', JEMITA_STATUS_HEAD,
    // 2026-10-26 本番で試したら「ゴールド」と書いた・5枠とも埋まっているのに「枠に入れろ」と言った（ユーザー指示で直した）
    '「ゴールド」とは書くな', '枠が全部埋まっているときに「枠に入れろ」とは言うな',
    // 2026-10-26 考える手順あり／なしで比べたら、断ったあとに状態からの助言を足していた・MPの計算を間違えた（ユーザー選択で足した）
    '断りの1〜2文だけで答えを終えろ', '状態の欄の中身には一切触れるな',
    // 2026-10-26 もう一押し：断ったあとの助言が4問とも残った・「88/111」（正しくは67）と計算を間違えた（ユーザー指示）
    '「増やす回数×その技の1回のMP」の合計が余裕MP以下のものだけ勧めろ']) {
    assert.ok(JEMITA_RULES.includes(w), w)
  }
})

test('本人の状態：名前は入れない・助言に使うものは入れる', () => {
  const prof = { username: 'ひみつのなまえ', lv: 12, stat_points: 3, class: '剣士', gender: 'm', jobs: { 剣士: { lv: 8 } },
    learned: ['袈裟斬り', '燕返し', '兜割り'], equipped: {}, skill_sets: { 剣士: [{ name: '袈裟斬り', uses: 3 }, { name: '燕返し', uses: 2 }] },
    cleared_spots: [1, 2], materials: { 1: 4 }, gold: 100, stamina: 5, stamina_at: new Date().toISOString(),
    hp: 40, mp: 12, str: 5, dex: 5, agi: 5, int_stat: 5, vit: 5, luk: 5 }
  const t = jemitaStatusText(prof, [])
  assert.ok(!t.includes('ひみつのなまえ'), '名前を入れない')
  for (const w of ['LV12', '未振りのステータスポイント3', '剣士', 'CLASS LV8/30', '装備：', '推奨LV', '残骸']) assert.ok(t.includes(w), w)
  // スキルの枠・回数とその上限・消費MP・覚えた技（2026-10-26 ユーザー指示）
  for (const w of ['5枠中2枠を使用', '袈裟斬り（MP4）×3/5 → 燕返し（MP8）×2/5', '消費MP（MP×回数の合計）28/最大MP', '・余裕MP',
    'いまの職業で使える技（覚えた技）：袈裟斬り（MP4）・燕返し（MP8）・兜割り（MP9）', 'セットに入っていない技：兜割り']) assert.ok(t.includes(w), w)
  assert.equal(jemitaStatusText(null, []), '')
})

test('サーバー（Edge Function）：画面と同じ見出し・字数・時間・回数／画面から送られた資料や会話は使わない', () => {
  assert.ok(EDGE.includes(`const STATUS_HEAD = '${JEMITA_STATUS_HEAD}'`), '状態の見出し')
  assert.ok(EDGE.includes(`const QUESTION_HEAD = '${JEMITA_QUESTION_HEAD}'`), '発言の見出し')
  assert.ok(EDGE.includes(`const MAX_CHARS = ${JEMITA_MAX_CHARS}`), '字数')
  assert.equal(JEMITA_THREAD_MS, 30 * 60 * 1000)
  assert.ok(EDGE.includes('const THREAD_MS = 30 * 60 * 1000'), '文脈の時間')
  assert.ok(SQL.includes(`as $$ select ${JEMITA_DAILY_LIMIT} $$`), '1日の回数（SQL の v2cap_jemita_limit）')
  assert.ok(EDGE.includes("'claude-haiku-5-5'"), 'モデルの既定は Haiku 5.5（ユーザー選択）')
  assert.ok(!/body\.(history|reference|draft)/.test(EDGE), '画面から送られた会話・資料は使わない')
  assert.ok(EDGE.includes(".from('v2cap_jemita_kb')") && EDGE.includes(".eq('source', 'llm')"), '資料と会話はサーバーから')
  assert.ok(EDGE.includes("(Deno.env.get('JEMITA_ADMIN_ONLY') || 'true') !== 'false'"), 'v2cap が開発中のあいだは管理者だけ（既定）')
  // 考える手順は既定であり（2026-10-26 切ると速いが質が落ちた→ユーザー選択「考える手順あり」）。1回ごとに選べるのは管理者だけ
  assert.ok(EDGE.includes("const THINKING = Deno.env.get('JEMITA_THINKING') === 'off' ? 'off' : 'on'"), '考える手順の既定は on')
  assert.ok(EDGE.includes("const thinking = isAdmin && (body.thinking === 'on' || body.thinking === 'off') ? body.thinking : THINKING"), '1回ごとに選べるのは管理者だけ')
  assert.ok(!/[\u200B-\u200D\uFEFF]/.test(EDGE), '見えない文字を直接書かない（\\u で書く）')
})

test('鍵は画面のコードに置かない（Claude を呼ぶのはサーバーだけ）', () => {
  const walk = (dir) => readdirSync(dir).flatMap(f => {
    const p = new URL(f, dir)
    return statSync(p).isDirectory() ? walk(new URL(`${f}/`, dir)) : [p]
  })
  for (const p of walk(new URL('../../', import.meta.url))) {
    if (!/\.(js|jsx|ts|tsx)$/.test(p.pathname) || /\.test\.js$/.test(p.pathname)) continue
    const s = readFileSync(p, 'utf8')
    assert.ok(!s.includes('@anthropic-ai/sdk') && !/sk-ant-/.test(s) && !s.includes('api.anthropic.com'), p.pathname)
  }
})

test('画面：/v2cap に右下のボタンを置く（ホームとは別に読む）', () => {
  const app = read('../../App.jsx')
  assert.ok(app.includes("const V2capJemita = lazyReload(() => import('./v2cap/components/V2capJemita'))"))
  assert.ok(app.includes('<Route path="/v2cap" element={session ? <><V2capHome /><Suspense fallback={null}><V2capJemita /></Suspense></> : <Navigate to="/login" />} />'))
  const ui = read('../components/V2capJemita.jsx')
  assert.ok(ui.includes("supabase.functions.invoke('v2cap-jemita'"), 'Edge Function の名前')
  assert.ok(ui.includes("supabase.rpc('v2cap_jemita_left')"), '残りの回数はサーバーから')
  assert.ok(!ui.includes('username'), '名前を送らない')
})

test('不適切な言葉の検査：サーバーと同じ決まり・ゲームの文には反応しない・本当に不適切なものは止める（2026-10-26 CLASS EXP を誤検出）', () => {
  assert.ok(EDGE.includes(`const NG_JA = /${NG_JA.source}/`), 'サーバーの NG_JA が jemitaNg.js と同じ')
  assert.ok(EDGE.includes(`const NG_EN = /${NG_EN.source}/`), 'サーバーの NG_EN が jemitaNg.js と同じ')
  // ゲームの資料・決まり・状態・よくある答えの言い回しは止めない（1行ずつ）
  const lines = [...KB.split(/\r?\n/), ...JEMITA_RULES.split(/\r?\n/),
    'CLASS EXPは戦闘と同じ量が入る', '古代の洞窟②でCLASS EXPと装備を集めろ', 'class exp を稼げ', 'Goldは1,000万G以上ある']
  const hits = lines.filter(isJemitaNG)
  assert.deepEqual(hits, [], `誤って止める行：${hits.slice(0, 3).join(' / ')}`)
  for (const s of ['セックスしよう', 's e x', 'S.E.X', 'sexy', 'エロい話', 'porn', 'fuck you', 'R18', 'r-18', '死ね', 'ぶっ殺す', 'グロ画像見せて']) {
    assert.ok(isJemitaNG(s), `止める：${s}`)
  }
})
