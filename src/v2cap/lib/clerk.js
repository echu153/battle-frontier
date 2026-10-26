// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— ニャーガーキングの看板娘
// ------------------------------------------------------------
// 【確定】2026-10-25 ユーザー指示「看板娘みたいなキャラ作りたい」「タップしたらセリフ言ってほしい」：
//   ・絵はユーザーが ChatGPT で描いたもの（プロンプトのページ https://claude.ai/artifact/F7zRR4YQifWwhc5KtnRrCm）。
//     元の絵は public/V2バーガー/<名前>.png（gitに入れない）→ `node tools/v2cap-burger-art.mjs` で public/v2cap-art/clerk/<キー>.webp にする
//   ・店の画面の右に、腰から上の絵を大きく立たせる（スマホは上）。タップでセリフと表情が変わる（ユーザー選択）
//   ・その日はじめて店を開いたときだけ、全身の「いらっしゃいませー！」を画面いっぱいに出す。タップで閉じる（ユーザー選択）
//     日付は日本時間の5時で切り替える（サーバーの v2cap_burger_welcome が覚える。SQLを流す前は端末に覚える）
//   ★裏設定：中身はふつうの人間で、猫耳は付け耳（ユーザー「イラスト上じゃわからない、小ネタ」）。絵ではばらさない。
//     セリフでは仲良くなってからだけ（2026-10-25 ユーザー指示「小ネタや伏線をもう少し詰めたい（仲良くなってから）」：23日目から前ふり・30日目から打ち明け）
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

// ===== 好感度（【確定】2026-10-25 ユーザー指示「毎日会話重ねていくことで仲良くなってほしい」「プレイヤー視点では見えないように」）=====
//   ・どうぶつの森のきぬよのように、毎日話しかけるうちに打ち解けていく。好感度は画面に出さない（ゲージも数字もなし）
//   ・その日はじめて話しかけたら（タップ）+1。1日1回・朝5時区切り・下がらない（ユーザー選択「話しかけたら」）。数えるのはサーバー（v2cap_clerk_talk）
//   ・段階（ユーザー選択「20日で名前・40日で自己紹介」）：2日目〜顔なじみ（今日も来てくれたんだね）・10日目〜常連（くだけた話）・
//     20日目〜仲良し（プレイヤーの名前で呼ぶ）・40日目〜親友（自己紹介）。段階が上がるとセリフが増える
//   ・段階が上がって最初に話しかけたときは、その段階の場面のセリフ（1回だけ。どこまで見せたかはサーバーの clerk_stage_seen）
//   ・呼び方（ユーザー選択）：男性のキャラは「〇〇くん」・女性は「〇〇ちゃん」（性別を決めていなければ「〇〇さん」）
//   ★40日目の自己紹介（【確定】2026-10-25 ユーザー指示「40日目の自己紹介をＡ案（ほんとの名前はもうちょっと長い）で入れて」
//     →「わたしはハルって呼んでほしいな！ ↑これにして」＝名乗りの文だけ差し替え）：
//     名乗るのはあだ名の「ハル」だけ（ユーザー「最終的にはエンドコンテンツの強めのNPC・体術の上位クラス。ここで出す名前はあだ名みたいな感じ」）。
//     本名は「春・○○」の中国風（ユーザー案・まだ決まっていない）＝ここでは「もうちょっと長い」とだけ言う。
//     場面が無い段階は見せた印を付けない＝あとで足せば次の会話で出る
export const CLERK_STAGES = [
  { stage: 0, min: 0,  label: 'はじめて' },
  { stage: 1, min: 2,  label: '顔なじみ' },
  { stage: 2, min: 10, label: '常連' },
  { stage: 3, min: 20, label: '仲良し' },
  { stage: 4, min: 40, label: '親友' },
]
export const stageOf = (affinity) => [...CLERK_STAGES].reverse().find(s => (Number(affinity) || 0) >= s.min).stage
export const stageLabelOf = (stage) => CLERK_STAGES.find(s => s.stage === stage)?.label || ''
// 名前で呼ぶとき（{name}）。username＝キャラクター名
export const callNameOf = (profile) =>
  `${profile?.username || ''}${profile?.gender === 'm' ? 'くん' : profile?.gender === 'f' ? 'ちゃん' : 'さん'}`

// ===== セリフ（【確定】2026-10-25 ユーザーが案を見て「語尾の『ニャ』を全部外す」を選んだ＝ふつうの話し方）=====
// ★店の名前（ニャーガーキング）とバーガーの名前（〜ニャッパー）のほかに「ニャ」を使わない（clerk.test.js が見張る）
// ★【確定】2026-10-26 数字やゲームの仕組みの言葉（60分・ステータス・状態異常・Gold など）を言わせない＝世界観を守る（clerk.test.js が見張る）。
//   ユーザーが案を見て「この案で直して（⑤は残り時間で言い方を変える）」。仕組みの説明は店の ❓ HELP に置く
// face＝出す表情。{burger}＝バーガーの名前・{toppings}＝乗ったトッピング（「ピクルスとガーリック」）・
// {name}＝呼び方（「〇〇くん」）・{username}＝キャラクター名。min／max＝出す好感度の段階（書いていなければ0から・上限なし）・
// dayMin／dayMax＝出す好感度（話しかけた日の数）・rare＝出にくい（ほかの CLERK_RARE_WEIGHT 倍＝伏線のセリフ）
export const CLERK_LINES = {
  // 全身の「いらっしゃいませー」（その日はじめて）
  welcome: [{ face: 'smile', text: 'いらっしゃいませー！' }],
  // 店を開いたときのひとこと（はじめて）
  enter: [
    { face: 'normal', text: 'いらっしゃいませ！ ご注文はお決まりですか？' },
    { face: 'smile', text: 'ニャーガーキングへようこそ！ 今日はどれにする？' },
  ],
  // 顔なじみから：前の日にも来ていた（今日も）／しばらく来ていなかった（久しぶり）／今日もう来ていた（また）
  enterDaily: [
    { min: 1, max: 2, face: 'smile', text: '今日も来てくれたんだね！' },
    { min: 1, max: 2, face: 'smile', text: 'あっ、いらっしゃい！ 今日も来てくれてうれしいな' },
    { min: 3, face: 'smile', text: '{name}、今日も来てくれたんだね！' },
    { min: 3, face: 'wink', text: '{name}！ 待ってたよ！' },
  ],
  enterLong: [
    { min: 1, max: 2, face: 'surprised', text: '久しぶり！ 元気にしてた？' },
    { min: 3, face: 'shy', text: '{name}、久しぶり！ ちょっと心配してたんだよ？' },
  ],
  enterAgain: [
    { min: 1, max: 2, face: 'smile', text: 'また来てくれたの？ うれしいな' },
    { min: 3, face: 'smile', text: '{name}、また来てくれたんだ！' },
  ],
  // 食事が効いているときに店を開いた。残りの分は言わない（2026-10-26）＝たっぷりあるときと、残り FED_LOW_MS 以下（そろそろ切れる）で言い方を変える
  enterFed: [
    { max: 2, face: 'smile', text: 'さっきの{burger}、まだまだ効いてるよ！' },
    { min: 3, face: 'smile', text: '{name}、さっきの{burger}まだまだ効いてるよ！' },
  ],
  enterFedLow: [
    { max: 2, face: 'wink', text: 'さっきの{burger}、そろそろ切れそうだね。おかわりする？' },
    { min: 3, face: 'wink', text: '{name}、さっきの{burger}そろそろ切れそうだね。おかわりする？' },
  ],
  // 夜おそく（日本時間の0〜5時）
  enterNight: [
    { max: 2, face: 'sleepy', text: 'ふぁ…いらっしゃいませぇ…。こんな時間までおつかれさま…' },
    { min: 3, face: 'sleepy', text: 'ふぁ…{name}、こんな時間までがんばってるんだね…' },
  ],
  // ふつうにタップしたとき（同じセリフが2回続かないように選ぶ）。段階が上がると増える
  tap: [
    { face: 'normal', text: 'うちのバーガーを食べると、しばらく力がわいてくるんだ。出かける前にどうぞ！' },
    { face: 'smile', text: '焼きたてだよ！ 直火で焼いてるから香ばしいんだ！' },
    { face: 'wink', text: 'トッピングは何がのるかお楽しみ！' },
    { face: 'wink', text: '迷ったら、トッピングは両方のせちゃおう！' },
    { face: 'smug', text: 'うちのバーガーは世界一だよ！' },
    { face: 'smug', text: 'スパイシーニャッパーは自信作なんだから！' },
    { face: 'normal', text: '力をつけたいならスパイシー、身軽になりたいならチキン！ 今日の気分で選んでね' },
    { face: 'smile', text: 'ピクルスのすっぱさは毒消しに、トマトは血のめぐりにいいんだって！' },
    { min: 1, face: 'smile', text: '最近よく来てくれるね。うちのバーガー、気に入ってくれた？' },
    { min: 1, face: 'normal', text: '出撃、気をつけてね。ちゃんと食べてから行くんだよ？' },
    { min: 2, face: 'wink', text: '実は新しいバーガーを考えてるんだ。…まだ秘密！' },
    { min: 2, face: 'smug', text: 'パティを焼くのはね、火加減が命なの。強すぎても弱すぎてもダメ！' },
    { min: 2, rare: true, face: 'smug', text: 'お店が終わったら、こっそり体を動かしてるんだ。けっこう鍛えてるんだよ？' },
    { min: 3, face: 'shy', text: '{name}が来てくれると、なんだか元気が出るんだ' },
    { min: 3, face: 'wink', text: '{name}のぶん、いつもちょっとだけ多めに焼いてるの。…内緒だよ？' },
    { min: 3, face: 'normal', text: '{name}、無理しちゃだめだよ。ちゃんと休んでね' },
    // 【確定】2026-10-25 ユーザー指示「小ネタや伏線をもう少し詰めたい（仲良くなってから）」＋選んだこと：タップに混ぜるだけ・伏線は出にくく（rare）
    // 付け耳の小ネタ：23〜29日目は前ふり（耳がずれて慌てる）・30日目から打ち明け（ユーザー選択）・35日目からその後の話
    { dayMin: 23, dayMax: 29, face: 'surprised', text: 'あっ…！ い、今の見てないよね？ 耳がちょっと…な、なんでもない！' },
    { dayMin: 30, face: 'shy', text: '{name}にだけ教えるね。…この猫耳、実は付け耳なんだ。みんなには内緒だよ？' },
    { dayMin: 35, face: 'normal', text: '耳のこと、ほかの人には言ってないよね？ …信じてるからね' },
    { dayMin: 35, face: 'wink', text: '今日は耳、新しいのにしてみたんだ。…気づいた？' },
    { dayMin: 35, face: 'smug', text: '本物の猫耳だと思ってた？ ふふ、よく言われるんだ' },
    // 体術の伏線（出にくい）：強さは20日目から・昔の話を少しは26日目から（ユーザー選択「強さ＋昔の話を少し」）
    { dayMin: 20, rare: true, face: 'smug', text: 'この前、お店に変な人が来たんだけど…ちょっと「お話し」したら帰ってくれたよ' },
    { dayMin: 20, rare: true, face: 'normal', text: '重いお肉の箱？ 片手でひょいっと運べるよ。…え、普通じゃないの？' },
    { dayMin: 20, rare: true, face: 'shy', text: 'パティをこねてたら、まな板が割れちゃった…力加減ってむずかしいね' },
    { dayMin: 26, rare: true, face: 'wink', text: 'わたしね、ここで働く前は…ううん、やっぱりまだ内緒！' },
    { dayMin: 26, rare: true, face: 'smug', text: '{name}の構え、ちょっと見せて。…うん、悪くないね。なんで分かるのかって？ ふふ、ひみつ' },
    { dayMin: 33, rare: true, face: 'normal', text: '昔ね、すっごく厳しい師匠がいたんだ。…今ごろ何してるかな' },
  ],
  tapNight: [
    { face: 'sleepy', text: 'むにゃ…あっ、起きてます！ ちゃんと起きてます！' },
    { face: 'sleepy', text: 'ふぁぁ…夜ふかしはほどほどにね…' },
    { min: 3, face: 'sleepy', text: '{name}も夜ふかし？ …実はわたしもなんだ' },
  ],
  // 続けてタップしたとき（3回目・5回目・8回目から）
  streak3: [
    { max: 2, face: 'surprised', text: 'わっ！ どうしたの？' },
    { min: 3, face: 'surprised', text: 'わっ！ {name}、どうしたの？' },
  ],
  streak5: [
    { max: 2, face: 'shy', text: 'そ、そんなに見つめられると…照れるよ…' },
    { min: 3, face: 'shy', text: '{name}、そんなに見つめられると照れるよ…' },
  ],
  streak8: [
    { max: 2, face: 'pout', text: 'もー！ 注文しないならつつかないで！' },
    { min: 3, face: 'pout', text: 'もー！ {name}ってば、つつきすぎ！' },
  ],
  // 選んだものの合計が持っているGoldより多くなった
  short: [
    { max: 2, face: 'sad', text: 'あぅ…お財布がちょっとさみしいみたい。ひと稼ぎしてからまた来てね' },
    { min: 3, face: 'sad', text: '{name}、お財布がちょっとさみしいみたい…。ひと稼ぎしてからまた来てね' },
  ],
  // 食事が効いている間に注文しようとした（食べ直しの確かめ）
  confirm: [{ face: 'surprised', text: 'まだ効いてるよ？ 食べ直すと前のは消えちゃうけど…' }],
  // 出したとき（トッピングなし／あり）
  served: [
    { max: 2, face: 'smile', text: 'お待たせしましたー！ {burger}です！ 熱いうちにどうぞ！' },
    { min: 3, face: 'smile', text: 'お待たせ、{name}！ {burger}だよ！ 熱いうちにどうぞ！' },
  ],
  servedTopping: [
    { max: 2, face: 'wink', text: 'お待たせしました！ 今回のトッピングは{toppings}だよ！' },
    { min: 3, face: 'wink', text: 'お待たせ、{name}！ 今回のトッピングは{toppings}だよ！' },
  ],
  // 注文がうまく通らなかった
  error: [{ face: 'sad', text: 'ごめんね、うまく注文できなかったみたい…' }],
}

// 段階が上がって最初に話しかけたときの場面（1回だけ）。4＝40日目の自己紹介（あだ名の「ハル」だけ・本名はまだ言わない）
export const CLERK_STAGE_EVENTS = {
  1: { face: 'smile', text: 'あっ、この前も来てくれた人だよね？ ちゃんと覚えてるよ！' },
  2: { face: 'smile', text: '最近ほんとによく来てくれるね。もうすっかり常連さんだね！' },
  3: { face: 'shy', text: 'ねえ、いつも来てくれるのに名前を聞いてなかったね。……{username}っていうんだ！ じゃあ、これからは{name}って呼ぶね！' },
  4: { face: 'wink', text: 'ねえ{name}、今日はわたしの番！ わたしはハルって呼んでほしいな！ ……ほんとの名前はもうちょっと長いんだけど、それはまた今度ね！' },
}
// まだ見せていない場面（いまの段階から下へ探して、いちばん上のもの）。seen＝見せた段階（サーバーの clerk_stage_seen）。無ければ null
export const stageEventOf = (stage, seen = 0) => {
  for (let s = stage; s > (Number(seen) || 0); s--) if (CLERK_STAGE_EVENTS[s]) return { stage: s, ...CLERK_STAGE_EVENTS[s] }
  return null
}

// {名前} を埋める
export const fillLine = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m))

// 場面 kind のセリフを1つ選ぶ。stage＝好感度の段階・aff＝好感度（話しかけた日の数・省くとその段階のいちばん下）＝その好感度で出せるものだけ。
// last＝直前のセリフの文（同じものが続かないように・2つ以上あるときだけ）。rare のセリフは CLERK_RARE_WEIGHT 倍しか出ない
export const CLERK_RARE_WEIGHT = 0.25
const minAffOf = (stage) => CLERK_STAGES.find(s => s.stage === stage)?.min ?? 0
export const linesOf = (kind, stage = 0, aff = minAffOf(stage)) =>
  (CLERK_LINES[kind] || CLERK_LINES.tap).filter(l =>
    (l.min ?? 0) <= stage && stage <= (l.max ?? Infinity) && (l.dayMin ?? 0) <= aff && aff <= (l.dayMax ?? Infinity))
const weightOf = (l) => (l.rare ? CLERK_RARE_WEIGHT : 1)
export const pickLine = (kind, { rng = Math.random, last = null, vars = {}, stage = 0, aff = minAffOf(stage) } = {}) => {
  const list = linesOf(kind, stage, aff)
  const pool = list.length > 1 && last ? list.filter(l => fillLine(l.text, vars) !== last) : list
  const from = pool.length ? pool : list
  let r = rng() * from.reduce((t, l) => t + weightOf(l), 0)
  const l = from.find(x => (r -= weightOf(x)) < 0) || from[from.length - 1]
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

// 食事の残りがこれ以下なら「そろそろ切れそうだね。おかわりする？」（【確定】2026-10-26 ユーザー選択「⑤は残り時間で言い方を変える」）
export const FED_LOW_MS = 10 * 60000
// 店を開いたときのひとこと。meal＝burger.js の activeMealOf（効いていなければ null）。
// 顔なじみから（stage≥1）は、前に店を開いた日（lastVisit＝プロフィールの burger_welcome_day・開く前の値）で
// 「今日も（前の日）」「久しぶり（2日以上あいた）」「また（今日もう来ていた・食事中なら効いている話）」を選ぶ
export const enterKindOf = (meal, at = new Date(), { stage = 0, lastVisit = null } = {}) => {
  if (isNight(at)) return 'enterNight'
  const fed = () => (Number(meal.leftMs) <= FED_LOW_MS ? 'enterFedLow' : 'enterFed')
  if (stage >= 1) {
    const d = at instanceof Date ? at : new Date(at)
    const last = lastVisit ? String(lastVisit).slice(0, 10) : ''
    if (last !== dayOf(d)) return last === dayOf(new Date(d.getTime() - 864e5)) ? 'enterDaily' : 'enterLong'
    return meal ? fed() : 'enterAgain'
  }
  return meal ? fed() : 'enter'
}

// その日はじめてか（サーバーの関数が無いとき＝SQLを流す前の端末の控え）。lastDay＝前に出した日（'2026-10-25'）
export const welcomeDueLocal = (lastDay, at = new Date()) => String(lastDay || '') !== dayOf(at)

// 1日1回だけサーバーに聞く窓口（いらっしゃいませー＝v2cap_burger_welcome・話しかけた＝v2cap_clerk_talk）。ask＝聞く関数（{ data, error } を返す）
// ★同じ日は1回だけ聞いて、答えを使い回す。【2026-10-25 直した】聞くとサーバーは今日の印を付けるので、2回目に聞くと答えが変わる。
//   React の開発モード（StrictMode）は画面を2回作り直す＝1回目の答えが捨てられ、2回目は「もう済んだ」になっていた
//   （店を開いてすぐ閉じたときも同じことが起きうる）。使ったあとの答えは set で入れ替える（いらっしゃいませーを出したら first=false など）
export const makeDailyAsker = (ask, dayFn = () => dayOf()) => {
  let cur = null
  return {
    get: () => {
      const day = dayFn()
      if (!cur || cur.day !== day) cur = { day, p: Promise.resolve().then(ask) }
      return cur.p
    },
    set: (value) => { cur = { day: dayFn(), p: Promise.resolve(value) } },
  }
}
export { dayOf }
