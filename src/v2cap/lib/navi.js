// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 案内役ナハト（序盤のナビゲーター）
// ------------------------------------------------------------
// 【確定】2026-11-02 ユーザー指示「ゲームの序盤をサポートするナビゲーターみたいなのを実装したい、序盤の道に迷わないように軽いチュートリアル機能を」
//   「ナビゲーターは黒い砂漠で言う闇の精霊みたいな感じで、昔めちゃくちゃ強かったけど弱体化して弱まってる感じにしたい」＋選んだこと：
//   ・姿：小さな影の精霊（しずく形の影に金色の目・ひびの入った王冠）。借りるのは「そばに浮かぶ小さな相棒」の雰囲気だけで、煙の体とにやけ顔は写さない
//   ・話し方：尊大だけど憎めない（一人称は「我」・プレイヤーは「貴様」）
//   ・出し方：ホームの上の細い枠（戦闘中は隠す・画面に重ねない）。画面の決まりは components/V2capNavi.jsx
//   ・報酬なし＝案内だけ（進む速さの測り直しが要らない）
//   ・道のりとセリフはユーザーが案を見て「この案で作る」（NAVI_STEPS の line。勝手に変えない）
// ★進み具合はキャラのデータから判断する（doneIf）。データで分からないものだけボタンを押した印で進む。
//   終えた印はキャラのデータ（ui_prefs.navi・SQL v2cap_navi_mark）に残す＝あとで条件が外れても戻らない（ミッションは翌朝に戻るので印がいる）
// ★上から順に案内するが、いまできないもの（readyIf が false）は飛ばす＝装備が落ちたときなどは、いまできることを先に案内する
// ★吹き出し（line・NAVI_TAP）に数字やゲームの仕組みの言葉を入れない＝世界観を守る（feedback-npc-no-meta・navi.test.js が見張る）。
//   仕組みの言葉は下の「やること」（task）にだけ書く
// ============================================================
import { totalPointsTo } from './level.js'
import { START_CLASSES, ICHIJI_REQ_JLV, jobOf, stageOf } from './jobs.js'
import { ITEM_BY_ID, STARTER_AREA } from './equipment.js'
import { equippedItems } from './loadout.js'
import { plusOf } from './smith.js'
import { dailyOf } from './daily.js'
import { apLeftOf } from './ascension.js'
import { TOWER_SHORT_NAME } from './tower.js'
import { nextStreak, tapKindOf } from './clerk.js'

export const NAVI_NAME = 'ナハト'

// ===== 絵 =====
// 元の絵は public/V2ナビ/<名前>.png（git に入れない）→ `node tools/v2cap-navi-art.mjs` で public/v2cap-art/navi/<キー>.webp。
// プロンプトのページ https://claude.ai/artifact/1c59bcvqcqNT9Q3ZPavYRm
// ★絵が届くまで NAVI_ART_ON=false＝画面の仮の絵（V2capNavi.jsx の SpiritArt）を出す
export const NAVI_ART_ON = false
export const NAVI_ART_DIR = '/v2cap-art/navi'
export const naviSrc = (key) => `${NAVI_ART_DIR}/${key}.webp`
export const NAVI_FACES = [
  { key: 'normal', label: '普通', src: ['普通'] },
  { key: 'smug', label: '得意', src: ['得意'] },
  { key: 'angry', label: '怒り', src: ['怒り'] },
  { key: 'sad', label: 'しょんぼり', src: ['しょんぼり'] },
]
export const NAVI_FACE_KEYS = NAVI_FACES.map(f => f.key)
export const NAVI_FACE_SIZE = { w: 256, h: 256 }

// ===== 飛ぶ先 =====
export const NAVI_SCROLL_ID = { sortie: 'v2cap-sortie', daily: 'v2cap-daily' }
const SORTIE_BTN = { kind: 'sortie', label: '出撃へ' }
const screenBtn = (screen, label, mark = false) => ({ kind: 'screen', screen, label, mark })

// ===== 進んだかの判断 =====
const BOSS_SPOT = 1     // 始まりの森の入口
const FOREST_SPOT = 3   // 始まりの森の最奥
const clearedHas = (c, spot) => c.cleared.includes(spot)
const pointsUsed = (c) => totalPointsTo(c.prof?.lv) - (c.prof?.stat_points || 0) > 0
const isOwnGear = (id) => { const it = ITEM_BY_ID[id]; return !!it && it.area !== STARTER_AREA }
const wearsOwnGear = (c) => Object.values(equippedItems(c.prof, c.inv)).some(w => w.item.area !== STARTER_AREA)
const opensAscension = (c) => Object.values(c.prof?.ascension || {}).some(v => Array.isArray(v) && v.length > 0)
const reachedUpperClass = (c) => Object.keys(c.prof?.jobs || {}).some(k => stageOf(k) === 'ichiji') || stageOf(c.prof?.class) === 'ichiji'
const bestStartJobLv = (c) => Math.max(...START_CLASSES.map(k => jobOf(c.prof?.jobs, k).lv))
// 案内が始まる前から森を抜けていたキャラ（c.past）には、序盤の案内を出さない
const early = (cond) => (c) => !!c.past || cond(c)
const always = () => true

// ===== 道のり（【確定】2026-11-02 ユーザーが案を見て「この案で作る」）=====
// key … 終えた印の名前／doneIf … 終わったか（無ければボタンを押した印だけ）／readyIf … いま案内できるか／
// line … 吹き出し／task … 下の「やること」／action … ボタン（mark:true は押したら終わり）／wait … まだ条件が足りないあいだの出し方
export const NAVI_STEPS = [
  { key: 'intro', face: 'normal', doneIf: early(() => false), readyIf: always,
    pages: [
      '…ようやく目を覚ましたか。我はナハト。かつて常夜の王と呼ばれ、王を三人喰らった者だ',
      '今は見てのとおりだ。笑うな。貴様が強くなれば、我の力も戻る。だから手を貸してやる',
    ] },
  { key: 'first', face: 'normal', doneIf: early(c => !!c.prof?.last_sortie_at), readyIf: always,
    line: 'まずは戦え。森の小物でよい。…我か？ 我は見ている。見ているのも大事な役目だ',
    task: '出撃して戦い、「街に戻る」', action: SORTIE_BTN },
  { key: 'points', face: 'normal', doneIf: early(pointsUsed), readyIf: c => (c.prof?.stat_points || 0) > 0,
    line: '貴様の内に力が溜まっておる。好きな所へ注げ。一度注げば戻らぬぞ',
    task: 'ステータスポイントを振る', action: { kind: 'points', label: '振る' } },
  { key: 'equip', face: 'normal', doneIf: early(wearsOwnGear), readyIf: c => c.inv.some(r => isOwnGear(r.base_id)),
    line: '拾ったものは身に着けろ。持ち歩くだけでは、ただの荷物だ',
    task: '落ちた装備を着ける', action: screenBtn('equip', '装備を開く') },
  { key: 'auto', face: 'smug', doneIf: early(() => false), readyIf: always,
    line: 'いちいち得物を振るのが面倒か。身体に任せる術がある。…息が切れるまでだがな',
    task: '「オート出撃」を押すと、スタミナを使って自動で戦い続ける', action: { kind: 'ack', label: 'わかった' } },
  { key: 'skills', face: 'smug', doneIf: early(() => false), readyIf: c => jobOf(c.prof?.jobs, c.prof?.class).lv >= 4,
    line: '新しい技を覚えたな。どれを使うかは貴様が決めろ',
    task: 'スキルセットを見る', action: screenBtn('skills', 'スキルセットを開く', true) },
  { key: 'boss1', face: 'normal', doneIf: early(c => clearedHas(c, BOSS_SPOT)), readyIf: always,
    line: 'この森の奥に主がいる。戦い続ければ、向こうから出てくる。倒せば道が開くぞ',
    task: '始まりの森 入口のボスを倒す', action: SORTIE_BTN },
  { key: 'smith', face: 'smug', doneIf: early(c => c.inv.some(r => plusOf(r) > 0)), readyIf: always,
    line: 'その得物、なまくらだな。鍛冶屋の親方に打たせろ。口は悪いが腕は確かだ',
    task: '鍛冶屋で装備を強化する', action: screenBtn('smith', '鍛冶屋を開く') },
  { key: 'pray', face: 'sad', doneIf: early(c => (c.prof?.pray_count || 0) > 0), readyIf: always,
    line: '宝樹には毎日祈っておけ。…我か？ あの木には昔、少し悪いことをした。近寄らぬ',
    task: 'ユグレシアの宝樹に祈る', action: screenBtn('tree', '宝樹を開く') },
  { key: 'tower', face: 'smug',
    doneIf: early(c => (c.prof?.tower_wins || 0) + (c.prof?.tower_losses || 0) > 0 || c.prof?.tower_guard != null), readyIf: always,
    line: '塔を登れ。上には貴様より強い者がいくらでもいる。…昔の我ほどではないがな',
    task: `${TOWER_SHORT_NAME}に挑戦する`, action: screenBtn('tower', `${TOWER_SHORT_NAME}を開く`) },
  { key: 'daily', face: 'normal', doneIf: early(c => dailyOf(c.prof).claimed), readyIf: always,
    line: '今日の務めは果たしたか。果たしたなら、褒美を受け取っておけ',
    task: '今日のミッションの報酬を受け取る', action: { kind: 'daily', label: 'ミッションを開く' } },
  { key: 'asc', face: 'normal', doneIf: early(opensAscension), readyIf: c => apLeftOf(c.prof) > 0,
    line: '戦うほどに、貴様の道は枝分かれしていく。どの枝を伸ばすか選べ',
    task: 'アセンションでAPを振る', action: screenBtn('asc', 'アセンションを開く') },
  { key: 'forest', face: 'normal', doneIf: c => clearedHas(c, FOREST_SPOT), readyIf: always,
    line: '森の果てに最後の主がいる。あれを倒せば、外の世界だ',
    task: '始まりの森 最奥のボスを倒す', action: SORTIE_BTN },
  { key: 'up', face: 'normal', doneIf: reachedUpperClass, readyIf: always,
    line: '神殿へ行け。顔の見えぬ神官がいる。…あやつ、我に気づいておるな',
    task: '神殿へ行き、上位クラスになる', action: screenBtn('temple', '神殿を開く'),
    wait: { if: c => bestStartJobLv(c) < ICHIJI_REQ_JLV, line: '力はまだ足りぬ。戦え。道が開けば、我が教えてやる',
      task: c => `CLASS LV${ICHIJI_REQ_JLV}まで戦う（いま LV${bestStartJobLv(c)}）`, action: SORTIE_BTN } },
]
export const NAVI_KEYS = NAVI_STEPS.map(s => s.key)
export const NAVI_END_KEY = 'end'
export const NAVI_FAREWELL = {
  face: 'smug', line: '…ふむ。王冠のひびが、少しだけ塞がった気がする。もう我の小言はいらぬな。…死ぬなよ',
  action: { kind: 'end', label: 'ありがとう' },
}

// ===== いま何を案内するか =====
export const naviMarkedOf = (prof) => new Set(Array.isArray(prof?.ui_prefs?.navi) ? prof.ui_prefs.navi : [])
export const naviCtxOf = (prof, inventory, marked = naviMarkedOf(prof)) => ({
  prof, inv: inventory || [], cleared: prof?.cleared_spots || [],
  past: (prof?.cleared_spots || []).includes(FOREST_SPOT) && !marked.has('intro'),
})
// kind … step（案内する）／farewell（最後のセリフ）／none（何も出さない）。toMark … キャラのデータに残す印
export const naviStateOf = (prof, inventory, marked = naviMarkedOf(prof)) => {
  if (marked.has(NAVI_END_KEY)) return { kind: 'none', toMark: [] }
  const ctx = naviCtxOf(prof, inventory, marked)
  const met = (s) => !!s.doneIf?.(ctx)
  const toMark = NAVI_STEPS.filter(s => !marked.has(s.key) && met(s)).map(s => s.key)
  const undone = NAVI_STEPS.filter(s => !marked.has(s.key) && !met(s))
  if (!undone.length) {
    // 一度も案内していないキャラ（案内ができる前に全部終えていた）に、最後のセリフだけ出さない
    return marked.size ? { kind: 'farewell', ctx, toMark } : { kind: 'none', toMark: [...toMark, NAVI_END_KEY] }
  }
  return { kind: 'step', step: undone.find(s => s.readyIf(ctx)) || undone[0], ctx, toMark }
}

// 枠に出す中身。page＝名乗りの何枚目か
export const naviViewOf = (step, ctx, page = 0) => {
  if (step.pages) {
    const last = page >= step.pages.length - 1
    return { key: `${step.key}-${page}`, face: step.face, line: step.pages[Math.min(page, step.pages.length - 1)], task: null,
      action: last ? { kind: 'ack', label: 'わかった' } : { kind: 'page', label: '次へ' } }
  }
  if (step.wait?.if(ctx)) {
    return { key: `${step.key}-wait`, face: step.face, line: step.wait.line, task: step.wait.task(ctx), action: step.wait.action }
  }
  return { key: step.key, face: step.face, line: step.line, task: step.task, action: step.action }
}
export const naviFarewellView = () => ({ key: NAVI_END_KEY, face: NAVI_FAREWELL.face, line: NAVI_FAREWELL.line, task: null, action: NAVI_FAREWELL.action })

// 開発用「案内を最初から見る」の順（条件を見ず、全部のセリフを並べる）
export const naviPreviewViews = () => {
  const ctx = { prof: { jobs: {}, class: START_CLASSES[0] }, inv: [], cleared: [], past: false }
  const noWait = (s) => ({ ...s, wait: undefined })
  return [
    ...NAVI_STEPS.flatMap(s => {
      if (s.pages) return s.pages.map((_, i) => naviViewOf(s, ctx, i))
      return s.wait ? [naviViewOf(s, ctx), naviViewOf(noWait(s), ctx)] : [naviViewOf(s, ctx)]
    }),
    naviFarewellView(),
  ]
}

// ===== 精霊を押したときのセリフ =====
export const NAVI_TAP = {
  tap: [
    { face: 'sad', text: '昔の我なら、この森ごと一息で消せた。今は葉っぱ一枚が限界だ' },
    { face: 'angry', text: 'つつくな。王冠が落ちる' },
    { face: 'angry', text: '笑ったな？ 今、笑ったな？' },
    { face: 'sad', text: '我が縮んだせいで、王冠だけが大きいままだ。…重い' },
    { face: 'sad', text: 'かつて我の名を聞いただけで、三つの国が門を閉じた。…今は門番の犬にも吠えられる' },
    { face: 'normal', text: '貴様の影は、なかなか居心地がよい。礼は言わぬぞ' },
    { face: 'smug', text: '我が力を取り戻した暁には、貴様を最初の臣下にしてやろう。光栄に思え' },
    { face: 'angry', text: 'あのフクロウ、我を鑑定しようとした。失礼な奴だ' },
    { face: 'normal', text: '強くなれ。貴様が強くなるほど、我も少しだけ戻る。…少しだけだ' },
    { face: 'sad', text: '昔の話をしてやろうか。…いや、やめておこう。泣ける' },
  ],
  streak3: [{ face: 'angry', text: '何度つついても、強くはならぬぞ' }],
  streak5: [{ face: 'angry', text: 'やめろ。王冠が、ずれる' }],
  streak8: [{ face: 'sad', text: '…我は王だぞ。王なのだぞ' }],
}
// 同じセリフが続かないように選ぶ
export const pickNaviTap = (kind, { rng = Math.random, last = null } = {}) => {
  const list = NAVI_TAP[kind] || NAVI_TAP.tap
  const pool = list.length > 1 && last ? list.filter(l => l.text !== last) : list
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
}
export { nextStreak, tapKindOf }
