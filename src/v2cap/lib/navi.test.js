// v2cap：案内役ナハトの決まりを固定するテスト（node --test）
// 【確定】2026-11-02 ユーザーが案を見て「この案で作る」（姿・話し方・出し方・報酬なしは navi.js の冒頭）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import {
  NAVI_STEPS, NAVI_KEYS, NAVI_END_KEY, NAVI_FAREWELL, NAVI_NAME, NAVI_TAP, NAVI_ART_ON, NAVI_ART_DIR, NAVI_FACES, NAVI_FACE_KEYS, NAVI_SCROLL_ID,
  naviSrc, naviMarkedOf, naviCtxOf, naviStateOf, naviViewOf, naviFarewellView, naviPreviewViews, pickNaviTap,
} from './navi.js'
import { FOLD_KEYS } from './uiPrefs.js'
import { ITEMS, STARTER_AREA, starterIdsOf } from './equipment.js'
import { dayOf } from './daily.js'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const readRoot = (rel) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stepOf = (key) => NAVI_STEPS.find(s => s.key === key)

// 作ったばかりのキャラ
const fresh = (over = {}) => ({ lv: 1, stat_points: 0, class: '剣士', jobs: { 剣士: { lv: 1, exp: 0 } }, cleared_spots: [], equipped: {}, ui_prefs: {}, ...over })
const allLines = () => [
  ...NAVI_STEPS.flatMap(s => [...(s.pages || []), s.line, s.wait?.line]).filter(Boolean),
  NAVI_FAREWELL.line,
  ...Object.values(NAVI_TAP).flat().map(l => l.text),
]
// 印を付けていきながら、案内の順に進める
const walk = (prof, inv, marks) => naviStateOf(prof, inv, new Set(marks))

test('【確定】道のりはユーザーが案を見た13段＋名乗りの順', () => {
  assert.deepEqual(NAVI_KEYS, ['intro', 'first', 'points', 'equip', 'auto', 'skills', 'boss1', 'smith', 'pray', 'tower', 'daily', 'asc', 'forest', 'up'])
  assert.equal(new Set(NAVI_KEYS).size, NAVI_KEYS.length)
  assert.ok(!NAVI_KEYS.includes(NAVI_END_KEY))
  for (const k of [...NAVI_KEYS, NAVI_END_KEY]) assert.match(k, /^[a-z0-9_]{1,24}$/, 'SQL の v2cap_navi_mark が通す形')
})

test('【確定】セリフはユーザーが「この案で作る」と通した文のまま', () => {
  assert.equal(NAVI_NAME, 'ナハト')
  assert.deepEqual(stepOf('intro').pages, [
    '…ようやく目を覚ましたか。我はナハト。かつて常夜の王と呼ばれ、王を三人喰らった者だ',
    '今は見てのとおりだ。笑うな。貴様が強くなれば、我の力も戻る。だから手を貸してやる',
  ])
  const lines = {
    first: 'まずは戦え。森の小物でよい。…我か？ 我は見ている。見ているのも大事な役目だ',
    points: '貴様の内に力が溜まっておる。好きな所へ注げ。一度注げば戻らぬぞ',
    equip: '拾ったものは身に着けろ。持ち歩くだけでは、ただの荷物だ',
    auto: 'いちいち剣を振るのが面倒か。身体に任せる術がある。…息が切れるまでだがな',
    skills: '新しい技を覚えたな。どれを使うかは貴様が決めろ',
    boss1: 'この森の奥に主がいる。戦い続ければ、向こうから出てくる。倒せば道が開くぞ',
    smith: 'その剣、なまくらだな。鍛冶屋の親方に打たせろ。口は悪いが腕は確かだ',
    pray: '宝樹には毎日祈っておけ。…我か？ あの木には昔、少し悪いことをした。近寄らぬ',
    tower: '塔を登れ。上には貴様より強い者がいくらでもいる。…昔の我ほどではないがな',
    daily: '今日の務めは果たしたか。果たしたなら、褒美を受け取っておけ',
    asc: '戦うほどに、貴様の道は枝分かれしていく。どの枝を伸ばすか選べ',
    forest: '森の果てに最後の主がいる。あれを倒せば、外の世界だ',
    up: '神殿へ行け。顔の見えぬ神官がいる。…あやつ、我に気づいておるな',
  }
  for (const [k, text] of Object.entries(lines)) assert.equal(stepOf(k).line, text, k)
  assert.equal(NAVI_FAREWELL.line, '…ふむ。王冠のひびが、少しだけ塞がった気がする。もう我の小言はいらぬな。…死ぬなよ')
  for (const t of ['昔の我なら、この森ごと一息で消せた。今は葉っぱ一枚が限界だ', 'つつくな。王冠が落ちる', '笑ったな？ 今、笑ったな？']) {
    assert.ok(NAVI_TAP.tap.some(l => l.text === t), t)
  }
})

test('【確定】吹き出しに数字やゲームの仕組みの言葉を入れない（世界観を守る）・仕組みの言葉は「やること」の行だけ', () => {
  // ユーザー指示（親方のとき）「＋9 とかメタい発言しないでほしい、世界観守って」（feedback-npc-no-meta）
  for (const t of allLines()) {
    assert.ok(!/[0-9０-９]|[+＋]|[%％]|転職|クラス|CLASS|LV|レベル|ステータス|ステ|スキル|パッシブ|装備|経験値|EXP|Gold|ゴールド|無料|確率|ポイント|スタミナ|秒|オート|AP|アセンション|ミッション|出撃|ドロップ|レア/.test(t), t)
  }
})

test('話し方：一人称は「我」・プレイヤーは「貴様」（「俺」「私」などを使わない）', () => {
  for (const t of allLines()) assert.ok(!/俺|オレ|僕|わたし|私|あたし|わし|ワシ|あなた|お前|おまえ|くん|ちゃん/.test(t), t)
  assert.ok(allLines().filter(t => t.includes('我')).length >= 10)
  assert.ok(allLines().filter(t => t.includes('貴様')).length >= 5)
})

test('作ったばかりのキャラ：名乗り → 出撃の順に案内する', () => {
  const p = fresh()
  const s = naviStateOf(p, [])
  assert.equal(s.kind, 'step')
  assert.equal(s.step.key, 'intro')
  assert.deepEqual(s.toMark, [], 'まだ何も終えていない')
  const v0 = naviViewOf(s.step, s.ctx, 0)
  assert.equal(v0.action.kind, 'page')
  const v1 = naviViewOf(s.step, s.ctx, 1)
  assert.equal(v1.action.kind, 'ack', '2枚目で「わかった」')
  assert.equal(walk(p, [], ['intro']).step.key, 'first')
})

test('いまできないものは飛ばす：LV1で1回戦ったあとはオートの話、装備が落ちたら装備の話、ポイントが入ったらポイントの話が先', () => {
  const after = fresh({ last_sortie_at: '2026-11-02T00:00:00Z' })
  assert.equal(walk(after, [], ['intro']).step.key, 'auto', 'ポイントも装備もまだ無い')
  assert.deepEqual(walk(after, [], ['intro']).toMark, ['first'], '1回戦ったことを残す')
  const marks = ['intro', 'first', 'auto']
  assert.equal(walk(after, [], marks).step.key, 'boss1', 'いまできることがないときは次のボス')
  const drop = { id: 9, base_id: ITEMS.find(i => i.area === 1).id, plus: 0 }
  assert.equal(walk(after, [drop], marks).step.key, 'equip', '装備が落ちたら先に案内する')
  const lv2 = { ...after, lv: 2, stat_points: 3 }
  assert.equal(walk(lv2, [drop], marks).step.key, 'points', 'ポイントがいちばん先')
  // 振ったら終わり（LVが上がってまた貯まっても戻らない）
  assert.equal(naviStateOf({ ...lv2, stat_points: 0 }, [drop], new Set(marks)).toMark.includes('points'), true)
  assert.equal(naviStateOf({ ...lv2, lv: 3, stat_points: 3 }, [drop], new Set(marks)).toMark.includes('points'), true, 'LV3で3残り＝一度振っている')
})

test('初期装備だけ持っていても装備の案内は出ない（落ちた装備が来てから）・着けたら終わり', () => {
  const after = fresh({ last_sortie_at: 'x' })
  const start = { id: 1, base_id: starterIdsOf('剣士')[0], plus: 0 }
  assert.equal(stepOf('equip').readyIf(naviCtxOf(after, [start], new Set())), false)
  const item = ITEMS.find(i => i.area === 1 && i.part === '頭' ) || ITEMS.find(i => i.area === 1)
  const inv = [{ id: 9, base_id: item.id, plus: 0 }]
  const slot = 'head'
  assert.notEqual(item.area, STARTER_AREA)
  assert.equal(walk({ ...after, equipped: { [slot]: 9 } }, inv, ['intro']).toMark.includes('equip'), true)
})

test('スキルセットは CLASS LV4 から・開いたら終わり（データで分からないので押した印）', () => {
  const p = fresh({ last_sortie_at: 'x', jobs: { 剣士: { lv: 4, exp: 0 } } })
  assert.equal(walk(p, [], ['intro', 'first', 'auto']).step.key, 'skills')
  assert.equal(stepOf('skills').action.mark, true)
  assert.equal(walk(p, [], ['intro', 'first', 'auto', 'skills']).step.key, 'boss1')
  assert.equal(walk({ ...p, jobs: { 剣士: { lv: 3, exp: 0 } } }, [], ['intro', 'first', 'auto']).step.key, 'boss1')
})

test('1-①を倒すと街の案内へ：鍛冶屋 → 宝樹 → 塔 → ミッション → アセンション → 森の最奥 → 神殿', () => {
  const marks = ['intro', 'first', 'points', 'equip', 'auto', 'skills', 'boss1']
  let p = fresh({ last_sortie_at: 'x', cleared_spots: [1], jobs: { 剣士: { lv: 5, exp: 0 } } })
  const expectNext = (prof, inv, key) => assert.equal(walk(prof, inv, marks).step.key, key)
  expectNext(p, [], 'smith')
  const inv = [{ id: 1, base_id: starterIdsOf('剣士')[0], plus: 1 }]
  expectNext(p, inv, 'pray')
  p = { ...p, pray_count: 1 }
  expectNext(p, inv, 'tower')
  p = { ...p, tower_losses: 1 }
  expectNext(p, inv, 'daily')
  p = { ...p, daily_day: dayOf(new Date()), daily_lv: 5, daily_claimed: true }
  expectNext(p, inv, 'asc')
  p = { ...p, ascension: { 剣士: [3] } }
  expectNext(p, inv, 'forest')
  p = { ...p, cleared_spots: [1, 2, 3] }
  expectNext(p, inv, 'up')
})

test('塔は守護者でいれば挑戦済み・ミッションは翌日に条件が外れても印があれば戻らない', () => {
  const marks = ['intro', 'first', 'points', 'equip', 'auto', 'skills', 'boss1', 'smith', 'pray']
  const p = fresh({ cleared_spots: [1], tower_guard: 3 })
  assert.ok(walk(p, [], marks).toMark.includes('tower'))
  const claimed = { ...p, daily_day: dayOf(new Date()), daily_lv: 5, daily_claimed: true }
  assert.ok(walk(claimed, [], marks).toMark.includes('daily'), '受け取った日に印を残す')
  const nextDay = { ...p, daily_day: '2000-01-01', daily_lv: 5, daily_claimed: true }
  assert.equal(walk(nextDay, [], [...marks, 'tower']).step.key, 'daily', '印が無ければ今日のぶんを案内')
  assert.notEqual(walk(nextDay, [], [...marks, 'tower', 'daily']).step.key, 'daily', '印があれば戻らない')
})

test('神殿：CLASS LV30まではまだ足りない話・30で神殿へ・上位クラスに就いたら最後のセリフ → 枠を消す', () => {
  const marks = NAVI_KEYS.filter(k => k !== 'up')
  const p = fresh({ cleared_spots: [1, 2, 3], jobs: { 剣士: { lv: 12, exp: 0 } } })
  const s = walk(p, [], marks)
  assert.equal(s.step.key, 'up')
  const wait = naviViewOf(s.step, s.ctx)
  assert.equal(wait.task, 'CLASS LV30まで戦う（いま LV12）')
  assert.equal(wait.action.kind, 'sortie')
  const ready = { ...p, jobs: { 剣士: { lv: 30, exp: 0 } } }
  const s2 = walk(ready, [], marks)
  const v2 = naviViewOf(s2.step, s2.ctx)
  assert.equal(v2.task, '神殿へ行き、上位クラスになる')
  assert.equal(v2.action.screen, 'temple')
  const done = { ...p, class: '侍', jobs: { 剣士: { lv: 30, exp: 0 }, 侍: { lv: 1, exp: 0 } } }
  const s3 = walk(done, [], marks)
  assert.equal(s3.kind, 'farewell')
  assert.deepEqual(s3.toMark, ['up'])
  assert.equal(naviFarewellView().action.kind, 'end')
  assert.equal(walk(done, [], [...marks, 'up', NAVI_END_KEY]).kind, 'none', '「ありがとう」を押したら枠を消す')
})

test('案内ができる前から森を抜けていたキャラ：序盤の案内は出さない（押した印の案内も）・上位クラスがまだならそこだけ', () => {
  const old = fresh({ lv: 40, cleared_spots: [1, 2, 3, 4], jobs: { 剣士: { lv: 30, exp: 0 } } })
  const s = naviStateOf(old, [])
  assert.equal(s.kind, 'step')
  assert.equal(s.step.key, 'up')
  // 全部の序盤の印を一度に残す＝次に読んだとき（intro の印が付いて past が外れたあと）も戻らない
  for (const k of NAVI_KEYS.filter(x => x !== 'up')) assert.ok(s.toMark.includes(k), k)
  assert.equal(walk(old, [], s.toMark).step.key, 'up')
})

test('全部終えていた前からのキャラ：最後のセリフも出さずに何も出さない', () => {
  const old = fresh({ lv: 60, class: '侍', cleared_spots: [1, 2, 3, 4], jobs: { 剣士: { lv: 30, exp: 0 }, 侍: { lv: 10, exp: 0 } } })
  const s = naviStateOf(old, [])
  assert.equal(s.kind, 'none')
  assert.ok(s.toMark.includes(NAVI_END_KEY), '次からは調べない')
  assert.equal(naviStateOf({ ...old, ui_prefs: { navi: s.toMark } }, []).kind, 'none')
  assert.deepEqual(naviStateOf({ ...old, ui_prefs: { navi: s.toMark } }, []).toMark, [])
})

test('案内の途中で森を抜けても、案内を受けていたキャラには残りの案内を続ける', () => {
  const p = fresh({ last_sortie_at: 'x', cleared_spots: [1, 2, 3] })
  const s = walk(p, [], ['intro', 'first', 'auto', 'boss1'])
  assert.equal(s.kind, 'step')
  assert.equal(s.step.key, 'smith')
})

test('印の読み方：ui_prefs.navi が無くても壊れた形でも落ちない', () => {
  assert.deepEqual([...naviMarkedOf(null)], [])
  assert.deepEqual([...naviMarkedOf({ ui_prefs: { navi: 'x' } })], [])
  assert.deepEqual([...naviMarkedOf({ ui_prefs: { navi: ['intro'] } })], ['intro'])
})

test('どの案内にも行き先のボタンがある・飛ぶ先の画面はホームのメニューにある', () => {
  const home = read('pages/V2capHome.jsx')
  for (const s of NAVI_STEPS.filter(x => !x.pages)) {
    assert.ok(s.action?.label, s.key)
    assert.ok(s.task, s.key)
    if (s.action.kind === 'screen') assert.ok(home.includes(`{screen === '${s.action.screen}' && `), `${s.key}：${s.action.screen}`)
  }
  assert.ok(home.includes(`id={NAVI_SCROLL_ID.sortie}`) && home.includes(`id={NAVI_SCROLL_ID.daily}`), '「出撃へ」「ミッションを開く」の飛ぶ先')
  assert.equal(Object.keys(NAVI_SCROLL_ID).length, 2)
})

test('開発用の見本：全部のセリフが順に出る（名乗り2枚・神殿は待つあいだも）', () => {
  const views = naviPreviewViews()
  const lines = views.map(v => v.line)
  for (const s of NAVI_STEPS) for (const t of [...(s.pages || []), s.line, s.wait?.line].filter(Boolean)) assert.ok(lines.includes(t), t)
  assert.equal(views.at(-1).key, NAVI_END_KEY)
  assert.equal(new Set(views.map(v => v.key)).size, views.length, 'key が重ならない')
})

test('精霊を押したとき：同じセリフが続かない・続けて押すと場面が変わる・表情は4つのどれか', () => {
  let n = 0
  const rng = () => [0, 0.99, 0.5][n++ % 3]
  let last = null
  for (let i = 0; i < 40; i++) {
    const l = pickNaviTap('tap', { rng, last })
    assert.notEqual(l.text, last)
    last = l.text
  }
  assert.equal(pickNaviTap('streak8').text, '…我は王だぞ。王なのだぞ')
  assert.equal(pickNaviTap('なにか', { rng: () => 0 }).text, NAVI_TAP.tap[0].text)
  for (const l of Object.values(NAVI_TAP).flat()) assert.ok(NAVI_FACE_KEYS.includes(l.face), l.text)
  for (const s of NAVI_STEPS) assert.ok(NAVI_FACE_KEYS.includes(s.face), s.key)
})

test('裏設定をばらさない：看板娘の付け耳・アレアの正体・神官の素性をセリフに出さない', () => {
  for (const t of allLines()) assert.ok(!/付け耳|元素|ハル|アレア|テオドール|トルステン|ソルド/.test(t), t)
})

test('絵：4枚の表情・絵が届くまでは仮の絵', () => {
  assert.deepEqual(NAVI_FACES.map(f => f.label), ['普通', '得意', '怒り', 'しょんぼり'])
  assert.equal(naviSrc('smug'), '/v2cap-art/navi/smug.webp')
  const dir = new URL(`../../../public${NAVI_ART_DIR}/`, import.meta.url)
  if (NAVI_ART_ON) {
    for (const k of NAVI_FACE_KEYS) assert.ok(existsSync(new URL(`${k}.webp`, dir)), `${k} の絵が無い＝ node tools/v2cap-navi-art.mjs`)
    for (const f of readdirSync(dir)) assert.ok(NAVI_FACE_KEYS.includes(f.replace('.webp', '')), `${f} は一覧に無い`)
  } else {
    assert.ok(read('components/V2capNavi.jsx').includes(': <SpiritArt face={face} />'), '絵が届くまでは仮の絵')
  }
})

test('画面：ホームの上の枠・戦闘中と施設の画面では隠す・ボタンの決まりを絵にかけない', () => {
  const h = read('pages/V2capHome.jsx')
  assert.ok(h.includes('<V2capNavi prof={prof} inventory={inventory} hidden={!isHome || inBattle} onGo={pickScreen}'))
  assert.ok(h.indexOf('<V2capNavi') < h.indexOf('<div style={TWO_COLUMN}>'), 'ステータスとメニューの上')
  assert.ok(h.includes('setNaviPreview(0)'), '開発用の見本')
  const c = read('components/V2capNavi.jsx')
  assert.ok(c.includes('.nvi-art::after { content: none; }'), 'ボタンの光沢（dev-ui.css）を絵に重ねない')
  assert.ok(c.includes('.nvi-art:not(:disabled):hover { filter: brightness(1.05); }'), '光り方は控えめ')
  assert.ok(c.includes('prefers-reduced-motion'), '浮かぶ動きを止められる')
  assert.ok(c.includes('if (views) return'), '開発用の見本ではボタンを押しても何もしない')
  assert.ok(!/position:\s*fixed/.test(c), '画面に重ねない（ユーザー選択）')
  assert.ok(FOLD_KEYS.includes('openNavi'), 'たたんだかをキャラのデータに覚える')
})

test('「振る」のボタンはステータスポイントの小窓を開く（ステータス欄を畳んでいても）', () => {
  const st = read('components/V2capStatus.jsx')
  assert.equal(st.match(/<V2capPoints prof=\{prof\} onProfile=\{onProfile\} openTick=\{pointsTick\} \/>/g)?.length, 2)
  const pt = read('components/V2capPoints.jsx')
  // 2026-11-02 手元で見つけた：「押した回数が0より大きい」で開くと、施設の画面から戻ったときに作り直されて小窓が開き直した
  assert.ok(pt.includes('const seenTick = useRef(openTick)'), '作られたときの回数を控える')
  assert.ok(pt.includes('if (openTick === seenTick.current) return'), '増えたときだけ開く')
  assert.ok(!/openTick > 0/.test(pt))
})

test('SQL：v2cap_navi_mark は開発者だけ・自分の行だけ・印の形を確かめる・報酬に触らない', () => {
  const sql = readRoot('supabase_v2cap_core.sql')
  const i = sql.indexOf('create or replace function public.v2cap_navi_mark(p_keys text[])')
  assert.ok(i > 0)
  const f = sql.slice(i, sql.indexOf('$$;', i))
  assert.ok(f.includes('if not public.v2cap_is_dev() then'))
  assert.ok(f.includes('where id = v_uid;'))
  assert.ok(f.includes("k !~ '^[a-z0-9_]{1,24}$'"))
  assert.ok(f.includes("'{navi}'"))
  assert.ok(!/\b(gold|exp|materials|stat_points)\b/.test(f), '案内だけ・報酬なし（ユーザー選択）')
  assert.ok(sql.includes('revoke all on function public.v2cap_navi_mark(text[]) from public, anon;'))
  assert.ok(sql.includes('grant execute on function public.v2cap_navi_mark(text[]) to authenticated;'))
})
