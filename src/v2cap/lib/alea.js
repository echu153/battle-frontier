// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 賭博場のカクテルウェイトレス、アレア
// ------------------------------------------------------------
// 【確定】2026-10-27 ユーザー指示「賭博場の画面に、ニャーガーキングの看板娘や鍛冶屋の親方と同じ形で、受付嬢のイラストを入れたい」＋選んだこと：
//   ・役：**カクテルウェイトレス**（フロアを歩いて、お客に飲み物を配る店員）。【2026-10-27 変えた】ユーザー指示
//     「受付っていうか、カジノでそこらへん歩いてる店員なんだけど…それの設定にしたい」＋選んだ呼び方。前は受付嬢
//   ・人物：余裕のある大人のお姉さん（20代半ば・人間）で、気だるげなダウナー系。服はディーラー服・髪はワインレッドのロング。
//     名前は「アレア」（ラテン語で「さいころ・賭け」・ユーザー選択）。40日目に名乗る（それまでセリフに名前は出ない）
//   ・絵はユーザーが ChatGPT で描く（プロンプトのページ https://claude.ai/artifact/KJoGFAgshPJ6yqJTvPN3pS ）。
//     腰から上の5枚（普通・微笑み・びっくり・あくび・ジト目）と、全身の「いらっしゃい」。
//     元の絵は public/V2賭博場/<名前>.png（git に入れない）→ `node tools/v2cap-casino-art.mjs` で public/v2cap-art/casino/<衣装>/<キー>.webp
//   ・着せ替えはあとで（ユーザーの予定「仲良くなったら、景品で手に入れた衣装に着せ替えられるようにする」）。
//     いまはディーラー服だけ。足せるように、絵の置き場所を衣装ごとに分けておく（ALEA_OUTFITS）
//   ・入れる動き（ユーザー選択）：タップ・大当たり・負けたとき（毎回は言わない）・両替でセリフと表情が変わる。
//     その日はじめて賭博場を開いたときは、全身の「いらっしゃい」を画面いっぱいに出す（看板娘と同じ・ホームの上で先に出す）
//   ・好感度（ユーザー選択「いま入れる」）：看板娘と同じ形・同じペース。画面には出さない。数えるのはサーバー（v2cap_alea_talk）。
//     話し方は、はじめては気だるいていねい語・常連（10日目）からくだけた話し方（ユーザーが案を見て「この案で」）
//   ・セリフの選び方・続けてタップ・夜・1日1回の決まりは、看板娘（clerk.js）と同じものを使う
//   ★裏設定（2026-10-27 ユーザー「アレアも元素使いの上位職の最強格NPCとして出す予定」）：セリフでは正体をばらさない
//     （「元素使い」という言葉も言わない）。仲良くなってから、出にくい伏線のセリフだけで匂わせる（ユーザーが案を見て「この案で入れて」）
// ★数字やゲームの仕組みの言葉（枚数・倍・確率・還元率・AT・CZ・BIG WIN・ラッキーナンバー・Gold など）はセリフに入れない＝世界観を守る（alea.test.js が見張る）。
//   仕組みの説明は賭博場の各ゲームの説明に置く
// ============================================================
import { fillLine, isNight, nextStreak, tapKindOf, welcomeDueLocal, makeDailyAsker, callNameOf, dayOf, CLERK_RARE_WEIGHT } from './clerk.js'

// ===== 絵 =====
// 衣装（いまはディーラー服だけ）。dir＝元の絵のフォルダ（public/V2賭博場/ の下。''＝そのフォルダ）
export const ALEA_OUTFITS = [{ key: 'dealer', label: 'ディーラー服', dir: '' }]
export const ALEA_OUTFIT = 'dealer'
export const ALEA_ART_DIR = '/v2cap-art/casino'
export const aleaSrc = (key, outfit = ALEA_OUTFIT) => `${ALEA_ART_DIR}/${outfit}/${key}.webp`

// 表情（腰から上・5枚とも同じ構図）。src＝元の絵の名前（プロンプトのページの保存名か、ユーザーの呼び方）
export const ALEA_FACES = [
  { key: 'normal',    label: '普通',     src: ['普通', '通常'] },
  { key: 'smile',     label: '微笑み',   src: ['微笑み', '笑顔'] },
  { key: 'surprised', label: 'びっくり', src: ['びっくり'] },
  { key: 'yawn',      label: 'あくび',   src: ['あくび', '眠そう'] },
  { key: 'jito',      label: 'ジト目',   src: ['ジト目', 'じと目'] },
]
export const ALEA_FACE_KEYS = ALEA_FACES.map(f => f.key)
// 全身の「いらっしゃい」（その日はじめて賭博場を開いたとき）
export const ALEA_WELCOME = { key: 'welcome', src: ['いらっしゃい', 'いらっしゃいませ'] }
// 画面で使う版の大きさ（tools/v2cap-casino-art.mjs が作る。表情5枚は同じ大きさ・alea.test.js が突き合わせる）
export const ALEA_FACE_SIZE = { w: 430, h: 640 }
export const ALEA_WELCOME_H = 1024
// 小さく出すとき（スマホの上・当たりの演出の上）に見せるところ：x＝頭のまん中の横の位置（幅に対する割合）・top＝上から見せる高さ（高さに対する割合）。
// 【2026-10-27 直した】ユーザー指示「ひだりの髪が少し見切れちゃってるから、もう少しバランスよく見えるように」：
//   前は顔のまん中（x 0.54）に合わせていて、左へ流れる髪が切れていた。頭の高さ（上から10〜30%）の髪の左右の端（幅430のうち75〜334px）の
//   まん中（約0.48）に合わせ、少し引いた（top 0.45→0.48）＝左右の髪が同じくらい見えて、蝶ネクタイまで入る（alea.test.js が測る）
export const ALEA_FOCUS = { x: 0.48, top: 0.48 }
// 幅が足りないときの上の帯の絵の枠（頭から胸まで）。【2026-10-27 直した】ユーザー指示「イラスト作ったせいでスクロールしないとルーレットとか
//   できなくなったから画像の部分調整したい」：前は 112×150（看板娘・親方と同じ）＝ゲームが下へ押されていた
export const ALEA_THUMB = { w: 84, h: 112 }
// 右に大きく立たせるのは、ゲームの幅が足りるときだけ（V2capAlea.jsx の ALEA_CSS）。ルーレットはホイールと盤が横に並ぶのに約680px要り、
//   右の列（300px）を置くとそれより狭くなる窓（拡大表示125%のパソコンなど）では縦に積まれて SPIN が画面の下に落ちていた＝それより狭いときは上の帯
export const ALEA_SIDE_MIN_W = 1081

// ===== 好感度（看板娘と同じペース・画面には出さない）=====
//   その日はじめて話しかけたら（タップ）+1。1日1回・朝5時区切り・下がらない。数えるのはサーバー（v2cap_alea_talk）
//   段階：2日目〜顔なじみ・10日目〜常連（くだけた話し方）・20日目〜仲良し（名前で呼ぶ）・40日目〜親友（名乗る）
//   段階が上がって最初に話しかけたときは、その段階の場面のセリフ（1回だけ。どこまで見せたかはサーバーの alea_stage_seen）
export const ALEA_STAGES = [
  { stage: 0, min: 0,  label: 'はじめて' },
  { stage: 1, min: 2,  label: '顔なじみ' },
  { stage: 2, min: 10, label: '常連' },
  { stage: 3, min: 20, label: '仲良し' },
  { stage: 4, min: 40, label: '親友' },
]
export const CASUAL_STAGE = 2   // 常連からくだけた話し方
export const NAME_STAGE = 3     // 仲良しから名前で呼ぶ（男性〇〇くん・女性〇〇ちゃん・決めていなければ〇〇さん＝看板娘と同じ callNameOf）
export const stageOf = (affinity) => [...ALEA_STAGES].reverse().find(s => (Number(affinity) || 0) >= s.min).stage
export const stageLabelOf = (stage) => ALEA_STAGES.find(s => s.stage === stage)?.label || ''
// セリフに埋める名前：{name}＝呼び方（「〇〇くん」）・{username}＝キャラクター名
export const varsOf = (profile) => ({ name: callNameOf(profile), username: profile?.username || '' })

// ===== セリフ（【確定】2026-10-27 ユーザーが案を見て「セリフはこの案で入れて」）=====
// face＝出す表情。min／max＝出す好感度の段階（書いていなければ0から・上限なし）。rare＝出にくい（ほかの ALEA_RARE_WEIGHT 倍＝伏線のセリフ）。
// ていねい語は max: 1 まで・くだけた話し方は min: 2 から・名前で呼ぶのは min: 3 から（alea.test.js が見張る）
export const ALEA_LINES = {
  // 全身の「いらっしゃい」（その日はじめて）
  welcome: [
    { max: 1, face: 'smile', text: '…いらっしゃいませ。ようこそ、賭博場へ' },
    { min: 2, face: 'smile', text: '…いらっしゃい。待ってたよ' },
  ],
  // 賭博場を開いたとき（はじめて）
  enter: [
    { face: 'normal', text: '…いらっしゃいませ。スロットに、ハイ&ロー、ルーレット。お好きな台へどうぞ' },
    { face: 'smile', text: 'ようこそ。…ふふ、今日はツイてそうな顔をしてますね' },
  ],
  // 顔なじみから：前の日にも来ていた（今日も）／しばらく来ていなかった（久しぶり）／今日もう来ていた（また）
  enterDaily: [
    { min: 1, max: 1, face: 'smile', text: '…あら、今日も来てくれたんですね' },
    { min: 2, max: 2, face: 'smile', text: '…ん、今日も来たんだ。いらっしゃい' },
    { min: 3, face: 'smile', text: '…{name}、今日も来たんだ。待ってたよ' },
  ],
  enterLong: [
    { min: 1, max: 1, face: 'smile', text: '…お久しぶりですね。ほかの遊び場に浮気してました？' },
    { min: 2, max: 2, face: 'normal', text: '…久しぶり。ちょっとだけ、退屈してたよ' },
    { min: 3, face: 'normal', text: '…{name}、久しぶり。来ないから、ちょっと心配してた' },
  ],
  enterAgain: [
    { min: 1, max: 1, face: 'normal', text: '…また来たんですね。今日はずいぶん熱心' },
    { min: 2, max: 2, face: 'smile', text: '…また来たの？ ふふ、懲りないね' },
    { min: 3, face: 'smile', text: '…{name}、おかえり。今日はとことん付き合うよ' },
  ],
  // 夜おそく（日本時間の0〜5時）
  enterNight: [
    { max: 1, face: 'yawn', text: 'ふぁ…いらっしゃいませ…。夜ふかしさん、ですね…' },
    { min: 2, max: 2, face: 'yawn', text: 'ふぁ…いらっしゃい…。夜ふかしさんだね…' },
    { min: 3, face: 'yawn', text: 'ふぁ…{name}も夜ふかし？ …わたしも、だけど' },
  ],
  // ふつうにタップしたとき（同じセリフが2回続かないように選ぶ）。常連からは同じ中身をくだけた話し方で
  tap: [
    { max: 1, face: 'normal', text: '当たるも外れるも、運しだい。…だから面白いんですよ' },
    { max: 1, face: 'smile', text: 'ふふ、肩の力を抜いて。そのほうが、ツキが寄ってきますよ' },
    { max: 1, face: 'normal', text: '…眠そう？ これがふつうの顔です。よく言われますけど' },
    { max: 1, face: 'smile', text: '勝っているときほど、引き際が大事ですよ。…なんて、店員が言うことじゃないですね' },
    { max: 1, face: 'normal', text: 'スロットの音、好きなんです。…子守歌みたいで' },
    { max: 1, face: 'smile', text: 'ルーレットに雷が落ちた数字、気になります？ …ふふ、わたしもです' },
    { max: 1, face: 'normal', text: 'カードは嘘をつきません。…嘘をつくのは、いつも人のほう' },
    { max: 1, face: 'normal', text: 'メダルは両替所でどうぞ。…使いすぎには、気をつけて' },
    { min: 1, max: 1, face: 'smile', text: '…最近よく見る顔ですね。ここ、気に入りました？' },
    { min: 1, max: 1, face: 'normal', text: '負けた日は、早めに帰って寝るのがいちばんですよ。…わたしみたいに' },
    { min: 2, face: 'normal', text: '当たるも外れるも、運しだい。…だから面白いの' },
    { min: 2, face: 'smile', text: 'ふふ、肩の力を抜いて。そのほうが、ツキが寄ってくるよ' },
    { min: 2, face: 'normal', text: '…眠そう？ これがふつうの顔。よく言われるけど' },
    { min: 2, face: 'smile', text: '勝ってるときほど、引き際が大事。…なんて、わたしが言うことじゃないか' },
    { min: 2, face: 'normal', text: 'スロットの音、好きなんだ。…子守歌みたいで' },
    { min: 2, face: 'smile', text: 'ルーレットに雷が落ちた数字、気になる？ …ふふ、わたしも' },
    { min: 2, face: 'normal', text: 'カードは嘘をつかない。…嘘をつくのは、いつも人のほう' },
    { min: 2, face: 'normal', text: 'メダルは両替所でね。…使いすぎには、気をつけて' },
    { min: 2, face: 'normal', text: '負けた日は、早めに帰って寝るのがいちばん。…わたしみたいに' },
    { min: 2, face: 'smile', text: '…ねえ、こっそり教えてあげる。……やっぱり、やめた。ふふ' },
    { min: 2, face: 'normal', text: 'ここの仕事？ 飲みものを配って歩くだけ。…わりと気に入ってる' },
    { min: 2, face: 'smile', text: 'ハイ&ローはね、迷ったら最初の勘を信じるの。…当たるかは知らないけど' },
    { min: 3, face: 'smile', text: '{name}が来ると、少しだけ目が覚めるんだ。…少しだけ、ね' },
    { min: 3, face: 'smile', text: '{name}の顔、見ればわかるよ。今日は勝ちたい日でしょ' },
    { min: 3, face: 'normal', text: '{name}、無理はしないで。勝ち負けより、また来てくれるほうがうれしいから' },
    { min: 4, face: 'smile', text: 'アレアって呼ばれるの、{name}だけなんだよ。…ほかの人は、店員さんって呼ぶから' },
    // 元素使いの伏線（出にくい）：常連から3つ・仲良しから2つ・親友から1つ（ユーザーが案を見て「この案で入れて」）
    { min: 2, rare: true, face: 'smile', text: 'ルーレットの雷？ …さあ、誰が落としてるんだろうね' },
    { min: 2, rare: true, face: 'normal', text: '冬でも、指先だけはいつもあったかいの。…なんでだろうね' },
    { min: 2, rare: true, face: 'smile', text: '飲みもの、冷やしてあげようか。……はい。どうやったかは、ないしょ' },
    { min: 3, rare: true, face: 'normal', text: '昔はね、もっと遠くまで出かけてたんだ。…今は、ここで眠いほうが好き' },
    { min: 3, rare: true, face: 'smile', text: '本気を出すのは、疲れるからきらい。…でも、{name}のためなら考えておく' },
    { min: 4, rare: true, face: 'smile', text: 'いつか{name}がずっと遠くまで行けたら…そのときは、わたしも本気を見せてあげる' },
  ],
  tapNight: [
    { max: 1, face: 'yawn', text: 'ふぁ…。…起きてますよ、ちゃんと' },
    { max: 1, face: 'yawn', text: 'この時間のルーレットは、静かで好きです…ふぁ' },
    { min: 2, face: 'yawn', text: 'ふぁ…。…起きてるよ、ちゃんと' },
    { min: 2, face: 'yawn', text: 'この時間のルーレットは、静かで好き…ふぁ' },
    { min: 3, face: 'yawn', text: '{name}も眠れないの？ …じゃあ、もう少しだけ付き合ってあげる' },
  ],
  // 続けてタップしたとき（3回目・5回目・8回目から）
  streak3: [
    { max: 1, face: 'normal', text: '…ん？ なにか、ご用ですか？' },
    { min: 2, max: 2, face: 'normal', text: '…ん？ なあに？' },
    { min: 3, face: 'normal', text: '…ん？ {name}、なあに？' },
  ],
  streak5: [
    { max: 1, face: 'smile', text: '…そんなに見つめられると、手元が狂いそうです' },
    { min: 2, max: 2, face: 'smile', text: '…そんなに見ないで。手元が狂いそう' },
    { min: 3, face: 'smile', text: '…{name}、そんなに見つめられると、照れる' },
  ],
  streak8: [
    { max: 1, face: 'jito', text: '…わたしはカードじゃありません。めくらないでください' },
    { min: 2, max: 2, face: 'jito', text: '…わたしはカードじゃないよ。めくらないで' },
    { min: 3, face: 'jito', text: '…{name}、しつこい' },
  ],
  // ===== ゲームの結果（winTalkOf・下の「負けたとき」）=====
  // スロットの台が当たりの流れ（AT）に入った
  atStart: [
    { max: 1, face: 'smile', text: '…台が騒がしくなってきましたね。ここからが本番ですよ' },
    { min: 2, max: 2, face: 'smile', text: '…来たね。ここからが本番' },
    { min: 3, face: 'smile', text: '…{name}、来たよ。ここからが本番' },
  ],
  // 大きな当たり（BIG WIN）
  bigWin: [
    { max: 1, face: 'smile', text: '…へぇ、やりますね。今日はツイてるみたい' },
    { min: 2, max: 2, face: 'smile', text: '…へぇ、やるじゃん' },
    { min: 3, face: 'smile', text: '…{name}、やるじゃん。ちょっと見直した' },
  ],
  // とても大きな当たり（いちばん上の2段・ルーレットの雷の数字にぴったり・スロットの画面が止まる当たり）＝びっくり
  //   （絵の目は少しだけ開く＝2026-10-27 ユーザー指示「目をそこまで開かないでほしい」）
  hugeWin: [
    { max: 1, face: 'surprised', text: '……えっ。…いまの、本当に当たったんですか？' },
    { min: 2, max: 2, face: 'surprised', text: '……え、うそ。…目、覚めちゃった' },
    { min: 3, face: 'surprised', text: '……{name}、すごい…！ こんなの、初めて見た' },
  ],
  // 負けたとき（毎回は言わない＝LOSE_GAP_MS）
  lose: [
    { max: 1, face: 'normal', text: '…まあ、そういう日もありますよ' },
    { max: 1, face: 'normal', text: '…運は、待っていればまた回ってきます' },
    { min: 2, max: 2, face: 'normal', text: '…ま、そういう日もあるよ' },
    { min: 2, max: 2, face: 'normal', text: '…運は、待ってればまた回ってくるよ' },
    { min: 3, face: 'normal', text: '{name}、元気出して。…次は、きっと来るよ' },
  ],
  // ===== 両替所 =====
  exchange: [
    { max: 1, face: 'smile', text: '…はい、どうぞ。いい夢を' },
    { min: 2, max: 2, face: 'smile', text: 'はい、どうぞ。…ほどほどにね' },
    { min: 3, face: 'smile', text: '{name}、はい。…勝ってきてね' },
  ],
  // 選んだ枚数がお財布を超えた
  short: [
    { max: 1, face: 'jito', text: '…お財布、からっぽみたいですね。外でひと稼ぎしてからどうぞ' },
    { min: 2, max: 2, face: 'jito', text: '…お財布、さみしいみたい。出直しておいで' },
    { min: 3, face: 'jito', text: '{name}、お財布からっぽでしょ。…無理しないの' },
  ],
  // ===== ブラックジャック（アレアがディーラー・【確定】2026-10-28 ユーザーが案を見て「ブラックジャックのセリフはこの案で入れて」）=====
  // ゲームの言葉（ブラックジャック・ヒット・ダブル・ディーラーなど）も言わない（alea.test.js）
  // 卓についた（ブラックジャックを開いたとき）
  bjSit: [
    { max: 1, face: 'smile', text: '…わたしの卓へようこそ。カード、配りますね' },
    { min: 2, max: 2, face: 'smile', text: '…座って。カード、配るよ' },
    { min: 3, face: 'smile', text: '…{name}、座って。今日も相手してあげる' },
  ],
  // 遊べるようになった瞬間
  bjUnlock: [
    { max: 1, face: 'smile', text: '…ずいぶん遊び慣れてきましたね。…わたしの卓、空いてますよ' },
    { min: 2, max: 2, face: 'smile', text: '…もうすっかり遊び慣れたね。わたしの卓、空いてるよ' },
    { min: 3, face: 'smile', text: '…{name}、わたしの卓、空いてるよ。そろそろ、勝負しよっか' },
  ],
  // まだ遊べないときに開いた
  bjLocked: [
    { max: 1, face: 'normal', text: '…わたしと勝負するのは、もう少しここで遊んでからにしましょう' },
    { min: 2, max: 2, face: 'normal', text: '…わたしと勝負するのは、もう少し遊び慣れてからね' },
    { min: 3, face: 'normal', text: '…{name}とはいつか勝負したいけど、もう少し遊んでからね' },
  ],
  // ダブルを押した
  bjDouble: [
    { max: 1, face: 'smile', text: '…強気ですね。嫌いじゃないです' },
    { min: 2, max: 2, face: 'smile', text: '…強気だね。嫌いじゃないよ' },
    { min: 3, face: 'smile', text: '…{name}、強気だね。そういうところ、嫌いじゃない' },
  ],
  // こちらのブラックジャック（最初の2枚で揃った）
  bjNatural: [
    { max: 1, face: 'surprised', text: '……あら、いきなり揃えてきましたね。…お見事です' },
    { min: 2, max: 2, face: 'surprised', text: '……え、いきなり？ …お見事' },
    { min: 3, face: 'surprised', text: '……{name}、いきなり揃えてくるなんて。…お見事' },
  ],
  // アレアのブラックジャック
  bjDealerNatural: [
    { max: 1, face: 'smile', text: '…ごめんなさい。今日は、カードがわたしの味方みたいです' },
    { min: 2, max: 2, face: 'smile', text: '…ごめんね。カードが、わたしの味方したみたい' },
    { min: 3, face: 'smile', text: '…ごめんね、{name}。カードが、わたしの味方したみたい' },
  ],
  // こちらが引きすぎた（21を超えた）
  bjBust: [
    { max: 1, face: 'jito', text: '…欲張りすぎ、ですね' },
    { min: 2, max: 2, face: 'jito', text: '…欲張りすぎ。引き際も、大事だよ' },
    { min: 3, face: 'jito', text: '…{name}、欲張りすぎ。…ふふ' },
  ],
  // アレアが引きすぎた
  bjDealerBust: [
    { max: 1, face: 'surprised', text: '…あ。引きすぎちゃいました' },
    { min: 2, max: 2, face: 'surprised', text: '…あ、引きすぎちゃった' },
    { min: 3, face: 'surprised', text: '…あ、引きすぎちゃった。{name}の勝ちだね' },
  ],
  // ふつうの勝ち（こちらの合計が大きい）
  bjWin: [
    { max: 1, face: 'normal', text: '…負けちゃいました。やりますね' },
    { max: 1, face: 'smile', text: '…今のは、あなたの勝ちです。…次は、どうでしょう' },
    { min: 2, max: 2, face: 'normal', text: '…わたしの負け。やるね' },
    { min: 2, max: 2, face: 'smile', text: '…今のは、そっちの勝ち。…次は、どうかな' },
    { min: 3, face: 'jito', text: '…{name}の勝ち。ちょっと悔しい' },
    { min: 3, face: 'smile', text: '…{name}、やるね。…次は負けないよ' },
  ],
  // ふつうの負け（アレアの合計が大きい）
  bjLose: [
    { max: 1, face: 'smile', text: '…ふふ、わたしの勝ちですね' },
    { max: 1, face: 'normal', text: '…残念でした。カードは、正直ですから' },
    { min: 2, max: 2, face: 'smile', text: '…ふふ、わたしの勝ち' },
    { min: 2, max: 2, face: 'normal', text: '…残念。カードは、正直だから' },
    { min: 3, face: 'smile', text: '…ふふ、わたしの勝ち。{name}、もう一回やる？' },
    { min: 3, face: 'smile', text: '…残念。{name}、顔に出てたよ' },
  ],
  // 引き分け
  bjPush: [
    { max: 1, face: 'normal', text: '…引き分けですね。気が合うみたいです' },
    { min: 2, max: 2, face: 'normal', text: '…引き分け。気が合うね' },
    { min: 3, face: 'smile', text: '…引き分け。{name}とは、気が合うね' },
  ],
  // ===== ポーカー（カリビアンスタッド・アレアがディーラー・【確定】2026-10-28 ユーザーが案を見て「ポーカーのセリフはこの案で入れて」）=====
  // ゲームの言葉（ポーカー・役の名前・ディーラーなど）も言わない（alea.test.js）。大きな役で勝ったときは BIG WIN などの演出の上の bigWin／hugeWin
  // 卓についた（ポーカーを開いたとき）
  pokerSit: [
    { max: 1, face: 'smile', text: '…今度はこちらの卓ですか。手札、配りますね' },
    { min: 2, max: 2, face: 'smile', text: '…今度はこっちね。手札、配るよ' },
    { min: 3, face: 'smile', text: '…{name}、今度はこっちの勝負？ いいよ、配ってあげる' },
  ],
  // 遊べるようになった瞬間
  pokerUnlock: [
    { max: 1, face: 'smile', text: '…ずいぶん勝ってきましたね。…奥の卓も、空けておきました' },
    { min: 2, max: 2, face: 'smile', text: '…ずいぶん勝ってきたね。奥の卓も、空けといたよ' },
    { min: 3, face: 'smile', text: '…{name}、奥の卓も空けといたよ。今度は、手札で勝負しよ' },
  ],
  // まだ遊べないときに開いた
  pokerLocked: [
    { max: 1, face: 'normal', text: '…奥の卓は、もう少しここで勝ってからにしましょう' },
    { min: 2, max: 2, face: 'normal', text: '…奥の卓は、もう少し勝ってからね' },
    { min: 3, face: 'normal', text: '…{name}、奥の卓はもう少し勝ってから。待ってるから' },
  ],
  // 降りた
  pokerFold: [
    { max: 1, face: 'normal', text: '…降りるんですね。慎重なのも、嫌いじゃないです' },
    { min: 2, max: 2, face: 'normal', text: '…降りちゃうの？ ま、慎重なのも悪くないけど' },
    { min: 3, face: 'smile', text: '…{name}、降りるの？ …ふふ、賢いのかもね' },
  ],
  // アレアの手が勝負にならなかった（AとKがそろわない）
  pokerNoQual: [
    { max: 1, face: 'normal', text: '…あら、わたしの手、勝負にならないみたいです' },
    { min: 2, max: 2, face: 'normal', text: '…あ、わたしの手じゃ勝負にならないや' },
    { min: 3, face: 'smile', text: '…あ、わたしの手じゃ勝負にならない。{name}、運がいいね' },
  ],
  // ふつうの勝ち（大きな役は演出の上の bigWin／hugeWin）
  pokerWin: [
    { max: 1, face: 'normal', text: '…負けちゃいました。いい手でしたね' },
    { max: 1, face: 'smile', text: '…今日は、そちらに流れがあるみたいです' },
    { min: 2, max: 2, face: 'normal', text: '…わたしの負け。いい手だったね' },
    { min: 2, max: 2, face: 'smile', text: '…今日は、そっちに流れがあるみたい' },
    { min: 3, face: 'smile', text: '…{name}の勝ち。いい手だった' },
    { min: 3, face: 'smile', text: '…{name}、手札に好かれてるね' },
  ],
  // 負け（アレアの手が上）
  pokerLose: [
    { max: 1, face: 'smile', text: '…ふふ、今回はわたしの勝ちですね' },
    { max: 1, face: 'smile', text: '…強気でしたね。でも、こちらが上でした' },
    { min: 2, max: 2, face: 'smile', text: '…ふふ、今回はわたしの勝ち' },
    { min: 2, max: 2, face: 'smile', text: '…強気だったね。でも、こっちが上' },
    { min: 3, face: 'smile', text: '…ふふ、わたしの勝ち。{name}、次はどうする？' },
    { min: 3, face: 'jito', text: '…{name}、惜しかったね。…でも、手加減はしないよ' },
  ],
  // まったく同じ強さ
  pokerPush: [
    { max: 1, face: 'surprised', text: '…まったく同じ強さ。…こんなこと、あるんですね' },
    { min: 2, max: 2, face: 'surprised', text: '…まったく同じ強さ。…こんなこと、あるんだ' },
    { min: 3, face: 'smile', text: '…{name}とまったく同じ強さ。…気が合うね' },
  ],
  // ===== ハイ&ロー：当てるごと（【確定】2026-10-31 ユーザー指示「はいろーで当てるごとに何かしらセリフしてほしい、5～10ではそれぞれ別のセリフで」＋案を見て「この案で入れて」）=====
  // 1〜4連勝は同じ箱から（hiloHit・続けて同じセリフは出ない）。常連からは名前を呼ばないセリフも混ぜる（毎回名前だとくどい）
  hiloHit: [
    { max: 1, face: 'normal', text: '…当たりですね' },
    { max: 1, face: 'smile', text: '…ふふ、いい勘してますね' },
    { max: 1, face: 'normal', text: '…よく見えてますね' },
    { max: 1, face: 'smile', text: '…続けます？ それとも、ここまでにします？' },
    { max: 1, face: 'smile', text: '…まだ、いけそうですか？' },
    { min: 2, face: 'normal', text: '…当たり' },
    { min: 2, face: 'smile', text: '…ふふ、いい勘してる' },
    { min: 2, face: 'normal', text: '…よく見えてるね' },
    { min: 2, face: 'smile', text: '…続ける？ それとも、ここまで？' },
    { min: 2, face: 'smile', text: '…まだ、いけそう？' },
    { min: 3, face: 'smile', text: '…{name}、当たり' },
    { min: 3, face: 'smile', text: '…{name}、いい勘してる。…もう一回？' },
  ],
  // 5〜10連勝：だんだん眠気が飛んでいく（数字は言わない）。10連勝は自動で受け取る演出の上に出る
  hiloStreak5: [
    { max: 1, face: 'smile', text: '…へぇ、ここまで続くんですね。…少し、目が覚めてきました' },
    { min: 2, max: 2, face: 'smile', text: '…へぇ、ここまで続くんだ。…少し、目が覚めてきた' },
    { min: 3, face: 'smile', text: '…{name}、ここまで続くんだ。…少し、目が覚めてきた' },
  ],
  hiloStreak6: [
    { max: 1, face: 'jito', text: '…まだ当てるんですか。…カード、透けて見えてません？' },
    { min: 2, max: 2, face: 'jito', text: '…まだ当てるの？ …カード、透けて見えてない？' },
    { min: 3, face: 'jito', text: '…{name}、まだ当てるの？ …カード、透けて見えてない？' },
  ],
  hiloStreak7: [
    { max: 1, face: 'surprised', text: '…こんなに続くの、今日はじめて見ました' },
    { min: 2, max: 2, face: 'surprised', text: '…こんなに続くの、今日はじめて見た' },
    { min: 3, face: 'surprised', text: '…{name}、こんなに続くの、今日はじめて見た' },
  ],
  hiloStreak8: [
    { max: 1, face: 'normal', text: '…周りのお客さんも、こちらを見てますよ。…気づいてます？' },
    { min: 2, max: 2, face: 'normal', text: '…周りのお客さんも、こっち見てる。…気づいてる？' },
    { min: 3, face: 'smile', text: '…{name}、周りのお客さんも、こっち見てるよ。…気づいてる？' },
  ],
  hiloStreak9: [
    { max: 1, face: 'surprised', text: '……息が止まりそうです。…次、いきます？' },
    { min: 2, max: 2, face: 'surprised', text: '……息、止まりそう。…次、いくの？' },
    { min: 3, face: 'surprised', text: '……{name}、息、止まりそう。…次、いくの？' },
  ],
  hiloStreak10: [
    { max: 1, face: 'surprised', text: '……全部、当てちゃった。…もう、眠気なんて飛んでいきました' },
    { min: 2, max: 2, face: 'surprised', text: '……全部、当てちゃった。…もう、眠気なんて飛んでった' },
    { min: 3, face: 'surprised', text: '……{name}、全部当てちゃった。…もう、眠気なんて飛んでった' },
  ],
  // ===== ルーレット：毎回（【確定】2026-10-31 ユーザー指示「ルーレットで負けた場合勝った場合もセリフ欲しい」＋案を見て「この案で入れて」）=====
  // 賭けたぶんより増えた（大きな当たりは演出の上の bigWin／hugeWin）
  rouletteWin: [
    { max: 1, face: 'smile', text: '…当たりましたね。…玉は、あなたの味方みたいです' },
    { max: 1, face: 'smile', text: '…おめでとうございます。いいところに賭けましたね' },
    { max: 1, face: 'normal', text: '…ふふ、玉がそちらに転がりましたね' },
    { min: 2, face: 'smile', text: '…当たったね。…玉が、味方してるみたい' },
    { min: 2, face: 'smile', text: '…おめでと。いいところに賭けたね' },
    { min: 2, face: 'normal', text: '…ふふ、玉がそっちに転がったね' },
    { min: 3, face: 'smile', text: '…{name}、当たったね。…ふふ、やるじゃん' },
    { min: 3, face: 'smile', text: '…{name}、おめでと。…もう一回、回す？' },
  ],
  // 当たったけれど、賭けたぶんより増えなかった
  rouletteSmall: [
    { max: 1, face: 'normal', text: '…当たりはしましたけど、あまり増えませんでしたね' },
    { min: 2, max: 2, face: 'normal', text: '…当たったけど、あまり増えなかったね' },
    { min: 3, face: 'normal', text: '…{name}、当たったけど、あまり増えなかったね' },
  ],
  // 外れた
  rouletteLose: [
    { max: 1, face: 'normal', text: '…残念。玉は、気まぐれですから' },
    { max: 1, face: 'normal', text: '…惜しかったですね。…次は、どこに賭けます？' },
    { max: 1, face: 'smile', text: '…今回は、お店の勝ちですね' },
    { min: 2, face: 'normal', text: '…残念。玉は、気まぐれだから' },
    { min: 2, face: 'normal', text: '…惜しかったね。…次は、どこに賭ける？' },
    { min: 2, face: 'smile', text: '…今回は、お店の勝ち' },
    { min: 3, face: 'normal', text: '…{name}、残念。…次は、どこに賭ける？' },
    { min: 3, face: 'normal', text: '…{name}、元気出して。…玉は、逃げないから' },
  ],
}

// 段階が上がって最初に話しかけたときの場面（1回だけ）。2＝くだけた話し方に変わる・3＝名前を聞いて呼び始める・4＝名乗る
export const ALEA_STAGE_EVENTS = {
  1: { face: 'smile', text: '…あ、この前のお客さん。顔を覚えるのは、わりと得意なんです' },
  2: { face: 'smile', text: '…もうすっかり常連さんですね。……堅苦しいの、やめてもいい？ そのほうが楽だから' },
  3: { face: 'smile', text: 'ねえ、名前、まだ聞いてなかったね。……{username}、か。じゃあ、これからは{name}って呼ぶね' },
  4: { face: 'smile', text: '…そういえば、わたしの名前、言ってなかったね。アレア。…覚えてくれたら、うれしい' },
}
// まだ見せていない場面（いまの段階から下へ探して、いちばん上のもの）。seen＝見せた段階（サーバーの alea_stage_seen）。無ければ null
export const stageEventOf = (stage, seen = 0) => {
  for (let s = stage; s > (Number(seen) || 0); s--) if (ALEA_STAGE_EVENTS[s]) return { stage: s, ...ALEA_STAGE_EVENTS[s] }
  return null
}

// 場面 kind のセリフを1つ選ぶ。stage＝好感度の段階。last＝直前のセリフの文（同じものが続かないように・2つ以上あるときだけ）。
// rare のセリフは ALEA_RARE_WEIGHT 倍しか出ない（看板娘の伏線と同じ4分の1）
export const ALEA_RARE_WEIGHT = CLERK_RARE_WEIGHT
export const linesOf = (kind, stage = 0) =>
  (ALEA_LINES[kind] || ALEA_LINES.tap).filter(l => (l.min ?? 0) <= stage && stage <= (l.max ?? Infinity))
const weightOf = (l) => (l.rare ? ALEA_RARE_WEIGHT : 1)
export const pickLine = (kind, { rng = Math.random, last = null, vars = {}, stage = 0 } = {}) => {
  const list = linesOf(kind, stage)
  const pool = list.length > 1 && last ? list.filter(l => fillLine(l.text, vars) !== last) : list
  const from = pool.length ? pool : list
  let r = rng() * from.reduce((t, l) => t + weightOf(l), 0)
  const l = from.find(x => (r -= weightOf(x)) < 0) || from[from.length - 1]
  return { face: l.face, text: fillLine(l.text, vars) }
}

// 賭博場を開いたときのひとこと。顔なじみから（stage≥1）は、前に賭博場を開いた日（lastVisit＝プロフィールの casino_welcome_day・開く前の値）で
// 「今日も（前の日）」「久しぶり（2日以上あいた）」「また（今日もう来ていた）」を選ぶ。夜おそくは夜のひとこと
export const enterKindOf = (at = new Date(), { stage = 0, lastVisit = null } = {}) => {
  if (isNight(at)) return 'enterNight'
  if (stage < 1) return 'enter'
  const d = at instanceof Date ? at : new Date(at)
  const last = lastVisit ? String(lastVisit).slice(0, 10) : ''
  if (last === dayOf(d)) return 'enterAgain'
  return last === dayOf(new Date(d.getTime() - 864e5)) ? 'enterDaily' : 'enterLong'
}
// 全身の「いらっしゃい」のセリフ（常連からはくだけた話し方）
export const welcomeLineOf = (profile, opts = {}) => pickLine('welcome', { ...opts, stage: stageOf(profile?.alea_affinity) }).text

// ===== ゲームの結果のセリフ（ユーザー選択「大当たり」「負けたとき」）=====
// 当たりの段階（casino.js の WIN_TIERS の key）から：BIG WIN＝bigWin・MEGA WIN／JACKPOT＝hugeWin。
// lucky＝ルーレットの雷の数字にぴったり当たった（段階によらず hugeWin）。WIN（小さな当たり）は何も言わない
export const winTalkOf = (tierKey, { lucky = false } = {}) =>
  (lucky || tierKey === 'mega' || tierKey === 'jackpot' ? 'hugeWin' : tierKey === 'big' ? 'bigWin' : null)
// スロットの当たりの流れ（AT）に入った。中段チェリー（画面が止まる当たり）は hugeWin
export const atTalkOf = (from) => (from === 'premium' ? 'hugeWin' : 'atStart')
// 負けたとき（ユーザーに見せた案）：ハイ&ローで連勝（HILO_LOSE_STREAK 以上）が途切れた・スロットのチャンス（CZ）が実らなかった。
// どちらも LOSE_GAP_MS に1回まで（ルーレットは下の rouletteTalkOf で毎回言うようにした）
export const LOSE_GAP_MS = 60000
export const HILO_LOSE_STREAK = 2
export const loseDue = (lastAt, now = Date.now()) => !(lastAt > 0) || now - lastAt >= LOSE_GAP_MS
// ハイ&ローの当たり（2026-10-31・当てるごとに毎回言う）：HILO_STREAK_LINES_FROM 連勝からは連勝の数ごとに別のセリフ（hiloStreak5〜10）・それより前は hiloHit
export const HILO_STREAK_LINES_FROM = 5
export const hiloTalkOf = (streak) => (ALEA_LINES[`hiloStreak${streak}`] ? `hiloStreak${streak}` : 'hiloHit')
// ルーレットの結果（2026-10-31・毎回言う）：賭けたぶんより増えた・当たったけど増えなかった・外れた。大きな当たりは演出の上の bigWin／hugeWin（winTalkOf）
export const rouletteTalkOf = (pay, total) => (pay > total ? 'rouletteWin' : pay > 0 ? 'rouletteSmall' : 'rouletteLose')

// ===== テーブルのゲーム（ブラックジャック・ポーカー＝アレアがディーラー・2026-10-28）=====
// ふつうの勝ち負けなど（TABLE_QUIET_KINDS）は TABLE_TALK_GAP_MS に1回まで（毎回は言わない＝負けたときの LOSE_GAP_MS と同じ考え・2つのゲームで共通）。
// ブラックジャック（どちらも）・ダブル（bjDouble）・卓についた（〜Sit）・遊べるようになった（〜Unlock）は毎回言う
// ブラックジャック：終わり方（casino.js の bjOutcomeOf）→ ひとこと
const BJ_TALK = {
  natural: 'bjNatural', dealerNatural: 'bjDealerNatural', bust: 'bjBust', dealerBust: 'bjDealerBust',
  win: 'bjWin', lose: 'bjLose', push: 'bjPush',
}
export const bjTalkOf = (outcome) => BJ_TALK[outcome] || null
export const BJ_QUIET_KINDS = ['bjBust', 'bjDealerBust', 'bjWin', 'bjLose', 'bjPush']
// ポーカー：結果（サーバーの result＝fold／noqual／win／push／lose）→ ひとこと。大きな役の勝ちは演出の上の bigWin／hugeWin（winTalkOf）
const PK_TALK = { fold: 'pokerFold', noqual: 'pokerNoQual', win: 'pokerWin', lose: 'pokerLose', push: 'pokerPush' }
export const pokerTalkOf = (result) => PK_TALK[result] || null
export const PK_QUIET_KINDS = ['pokerFold', 'pokerNoQual', 'pokerWin', 'pokerLose', 'pokerPush']
export const TABLE_QUIET_KINDS = [...BJ_QUIET_KINDS, ...PK_QUIET_KINDS]
export const TABLE_TALK_GAP_MS = 30000
export const tableTalkDue = (lastAt, now = Date.now()) => !(lastAt > 0) || now - lastAt >= TABLE_TALK_GAP_MS
// 卓の名札：名乗る場面（40日目・ALEA_STAGE_EVENTS[4]）を見せるまでは「ディーラー」。名乗ったあとは「アレア」
//   （seen＝見せた段階の場面＝サーバーの alea_stage_seen。名前はセリフでも40日目まで出さない）
export const SELF_NAME_STAGE = 4
export const dealerNameOf = (seen) => ((Number(seen) || 0) >= SELF_NAME_STAGE ? 'アレア' : 'ディーラー')

export { fillLine, isNight, nextStreak, tapKindOf, welcomeDueLocal, makeDailyAsker, callNameOf, dayOf }
