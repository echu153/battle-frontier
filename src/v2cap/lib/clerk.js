// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— ニャーガーキングの看板娘
// ------------------------------------------------------------
// 【確定】2026-10-25 ユーザー指示「看板娘みたいなキャラ作りたい」「タップしたらセリフ言ってほしい」：
//   ・絵はユーザーが ChatGPT で描いたもの（プロンプトのページ https://claude.ai/artifact/F7zRR4YQifWwhc5KtnRrCm）。
//     元の絵は public/V2バーガー/<名前>.png（gitに入れない）→ `node tools/v2cap-burger-art.mjs` で public/v2cap-art/clerk/<キー>.webp にする
//   ・店の画面の右に、腰から上の絵を大きく立たせる（スマホは上）。タップでセリフと表情が変わる（ユーザー選択）
//   ・その日はじめて店を開いたときだけ、全身の「いらっしゃいませー！」を画面いっぱいに出す。タップで閉じる（ユーザー選択）
//     日付は日本時間の5時で切り替える（サーバーの v2cap_burger_welcome が覚える。SQLを流す前は端末に覚える）
//   ★裏設定：中身はふつうの人間で、猫耳は付け耳（ユーザー「イラスト上じゃわからない、小ネタ」）。セリフでもばらさない
// ============================================================
import { dayOf } from '../core/daily.js'

export const CLERK_ART_DIR = '/v2cap-art/clerk'
export const clerkSrc = (key) => `${CLERK_ART_DIR}/${key}.webp`

// 表情（腰から上の絵・9枚とも同じ構図）。src＝元の絵の名前（ユーザーの保存名。プロンプトのページの名前とどちらでもよい）
export const CLERK_FACES = [
  { key: 'normal',    label: '普通',       src: ['普通'] },
  { key: 'smile',     label: '笑顔',       src: ['笑顔'] },
  { key: 'wink',      label: 'ウインク',   src: ['ウインク'] },
  { key: 'surprised', label: 'びっくり',   src: ['びっくり'] },
  { key: 'shy',       label: '照れ',       src: ['照れ'] },
  { key: 'pout',      label: 'ぷんすか',   src: ['ぷんすか'] },
  { key: 'sad',       label: 'しょんぼり', src: ['しょんぼり'] },
  { key: 'smug',      label: 'ドヤ顔',     src: ['どや顔', 'ドヤ顔'] },
  { key: 'sleepy',    label: '眠そう',     src: ['眠そう', 'ねむそう'] },
]
export const CLERK_FACE_KEYS = CLERK_FACES.map(f => f.key)
// 全身の「いらっしゃいませー」・店のマーク（ワッペン＝メニューのアイコン）
export const CLERK_WELCOME = { key: 'welcome', src: ['いらっしゃいませ'] }
export const CLERK_MARK = { key: 'mark', src: ['ワッペン', 'マーク'] }
export const MARK_SRC = clerkSrc('mark')
// 画面で使う版の大きさ（tools/v2cap-burger-art.mjs が作る。表情9枚は同じ大きさ・clerk.test.js が突き合わせる）
export const CLERK_FACE_SIZE = { w: 342, h: 640 }
export const CLERK_WELCOME_H = 1024
export const CLERK_MARK_SIZE = 96

// ===== セリフ（【確定】2026-10-25 ユーザーが案を見て「語尾の『ニャ』を全部外す」を選んだ＝ふつうの話し方）=====
// ★店の名前（ニャーガーキング）とバーガーの名前（〜ニャッパー）のほかに「ニャ」を使わない（clerk.test.js が見張る）
// face＝出す表情。{burger}＝バーガーの名前・{left}＝残り時間（「42分」）・{toppings}＝乗ったトッピング（「ピクルスとガーリック」）
export const CLERK_LINES = {
  // 全身の「いらっしゃいませー」（その日はじめて）
  welcome: [{ face: 'smile', text: 'いらっしゃいませー！' }],
  // 店を開いたときのひとこと
  enter: [
    { face: 'normal', text: 'いらっしゃいませ！ ご注文はお決まりですか？' },
    { face: 'smile', text: 'ニャーガーキングへようこそ！ 今日はどれにする？' },
  ],
  // 食事が効いているときに店を開いた
  enterFed: [{ face: 'smile', text: 'さっきの{burger}、まだ効いてるよ！ あと{left}！' }],
  // 夜おそく（日本時間の0〜5時）
  enterNight: [{ face: 'sleepy', text: 'ふぁ…いらっしゃいませぇ…。こんな時間までおつかれさま…' }],
  // ふつうにタップしたとき（同じセリフが2回続かないように選ぶ）
  tap: [
    { face: 'normal', text: 'バーガーは60分効くよ。出撃の前にどうぞ！' },
    { face: 'smile', text: '焼きたてだよ！ 直火で焼いてるから香ばしいんだ！' },
    { face: 'wink', text: 'トッピングは何がのるかお楽しみ！' },
    { face: 'wink', text: '迷ったら、トッピングは両方のせちゃおう！' },
    { face: 'smug', text: 'うちのバーガーは世界一だよ！' },
    { face: 'smug', text: 'スパイシーニャッパーは自信作なんだから！' },
    { face: 'normal', text: '上げたいステータスのバーガーを選んでね' },
    { face: 'smile', text: 'メジャーのトッピングは、敵がよく使う状態異常に効くよ！' },
  ],
  tapNight: [
    { face: 'sleepy', text: 'むにゃ…あっ、起きてます！ ちゃんと起きてます！' },
    { face: 'sleepy', text: 'ふぁぁ…夜ふかしはほどほどにね…' },
  ],
  // 続けてタップしたとき（3回目・5回目・8回目から）
  streak3: [{ face: 'surprised', text: 'わっ！ どうしたの？' }],
  streak5: [{ face: 'shy', text: 'そ、そんなに見つめられると…照れるよ…' }],
  streak8: [{ face: 'pout', text: 'もー！ 注文しないならつつかないで！' }],
  // 選んだものの合計が持っているGoldより多くなった
  short: [{ face: 'sad', text: 'あぅ…Goldが足りないみたい。出撃してまた来てね' }],
  // 食事が効いている間に注文しようとした（食べ直しの確かめ）
  confirm: [{ face: 'surprised', text: 'まだ効いてるよ？ 食べ直すと前のは消えちゃうけど…' }],
  // 出したとき（トッピングなし／あり）
  served: [{ face: 'smile', text: 'お待たせしましたー！ {burger}です！ 熱いうちにどうぞ！' }],
  servedTopping: [{ face: 'wink', text: 'お待たせしました！ 今回のトッピングは{toppings}だよ！' }],
  // 注文がうまく通らなかった
  error: [{ face: 'sad', text: 'ごめんね、うまく注文できなかったみたい…' }],
}

// {名前} を埋める
export const fillLine = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m))

// 場面 kind のセリフを1つ選ぶ。last＝直前のセリフの文（同じものが続かないように・2つ以上あるときだけ）
export const pickLine = (kind, { rng = Math.random, last = null, vars = {} } = {}) => {
  const list = CLERK_LINES[kind] || CLERK_LINES.tap
  const pool = list.length > 1 && last ? list.filter(l => fillLine(l.text, vars) !== last) : list
  const from = pool.length ? pool : list
  const l = from[Math.min(from.length - 1, Math.floor(rng() * from.length))]
  return { face: l.face, text: fillLine(l.text, vars) }
}

// 夜おそく（日本時間の0〜5時）か
export const isNight = (at = new Date()) => {
  const d = at instanceof Date ? at : new Date(at)
  const h = (d.getUTCHours() + 9) % 24
  return h < 5
}

// 続けてタップしたかの数え方：前のタップから STREAK_MS 以内なら+1、空いたら1から
export const STREAK_MS = 2500
export const nextStreak = (prev, at) => (prev && at - prev.at <= STREAK_MS ? { n: prev.n + 1, at } : { n: 1, at })
// タップの回数から場面を決める（3回目・5回目・8回目から。夜はねむそうなセリフ）
export const tapKindOf = (n, night = false) => {
  if (n >= 8) return 'streak8'
  if (n === 5) return 'streak5'
  if (n === 3) return 'streak3'
  return night ? 'tapNight' : 'tap'
}

// 店を開いたときのひとこと。meal＝burger.js の activeMealOf（効いていなければ null）
export const enterKindOf = (meal, at = new Date()) => (isNight(at) ? 'enterNight' : meal ? 'enterFed' : 'enter')

// その日はじめてか（サーバーの関数が無いとき＝SQLを流す前の端末の控え）。lastDay＝前に出した日（'2026-10-25'）
export const welcomeDueLocal = (lastDay, at = new Date()) => String(lastDay || '') !== dayOf(at)

// その日の「いらっしゃいませー」を出すかをサーバー（v2cap_burger_welcome）に聞く窓口。ask＝聞く関数（{ data, error } を返す）
// ★同じ日は1回だけ聞いて、答えを使い回す。【2026-10-25 直した】聞くとサーバーは今日の印を付けるので、2回目に聞くと first=false になる。
//   React の開発モード（StrictMode）は画面を2回作り直す＝1回目の答え（first=true）が捨てられ、2回目は false で全画面が出なかった
//   （店を開いてすぐ閉じたときも同じことが起きうる）。出したら done で「もう出した」にする（同じ日に店を開き直しても出さない）
export const makeWelcomeAsker = (ask, dayFn = () => dayOf()) => {
  let cur = null
  return {
    get: () => {
      const day = dayFn()
      if (!cur || cur.day !== day) cur = { day, p: Promise.resolve().then(ask) }
      return cur.p
    },
    done: () => { cur = { day: dayFn(), p: Promise.resolve({ data: { ok: true, first: false } }) } },
  }
}
export { dayOf }
