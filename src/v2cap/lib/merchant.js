// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 商店の商人ソルド
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー指示「糸目の胡散臭いお兄さん、関西弁の守銭奴にする予定」
//   （商店の画面に、看板娘・親方・アレア・テオドールと同じ形でイラストを入れる）＋選んだこと：
//   ・人物：旅の行商人の男性・20代後半。名前はソルド（昔の銅貨の名前で、イタリア語で「お金」・ユーザー選択）。はじめて店に来た人に名乗る
//   ・見た目：濃い紫のゆるいくせ毛（首の後ろで小さく結ぶ）。服は白い立ち襟のシャツ＋えんじ色の袖なしの長いベスト（前を開ける・金の細いふちどり）＋黒い布の帯（ユーザー選択「袖なしの長いベスト」「えんじ＋黒＋金」）。
//     帽子なし・黒い革の小さめの斜めがけカバン・帯に薬の小びん2本・胸のポケットから帯へ金の細い鎖・片目を隠す前髪なし（こちらで決めた）。ポーズは自然な立ち姿で手に何も持たない（ユーザー「小銭持つ動作いらない、自然体で」）。
//     ★前の案（ユーザーの例えのキャラの型＝丈の長いコート・毛皮の襟と袖口・長い前かけ・大きな背負い荷物と毛布・青緑とクリーム色）は、描いてみたらユーザー「イラストの色合いとか服装参考に寄せすぎ」でやめた
//   ・絵はユーザーが ChatGPT で描く（プロンプトのページ https://claude.ai/artifact/Q1EHJyMima3Df4cdq8JBDj ）。腰から上の3枚（普通・にんまり・薄目）。全身の絵は無し。
//     元の絵は public/V2商店/<名前>.png（git に入れない）→ `node tools/v2cap-shop-art.mjs` で public/v2cap-art/shop/<キー>.webp
//   ・入れる動き（ユーザー選択）：店を開いたとき・タップ・買う確かめ・買った結果で話す。1日1回の大きなあいさつは無し
//   ・好感度（ユーザー選択「あり」）：看板娘・アレアと同じ形・同じペース。画面には出さない。数えるのはサーバー（v2cap_merchant_talk）
//   ・セリフはユーザーが案を見て「この案で入れて」（2026-10-31）。一人称は「わい」。
//     はじめて・顔なじみは商売口調（お客さん・〜でっせ）／常連からくだけた関西弁（兄さん・姉さん）／仲良しから名前（〇〇はん）
//   ・セリフの選び方・続けてタップ・夜・1日1回の決まりは、看板娘（clerk.js）と同じものを使う
// ★数字やゲームの仕組みの言葉（値段・効果時間・確率・レア度の名前・Gold・ステータスなど）はセリフに入れない＝世界観を守る（merchant.test.js が見張る）。
//   守銭奴らしさは「銭」「お代」で出す。仕組みの説明は商店の画面の文に置く
// ★似せすぎない：銀髪・狐顔・一人称「ボク」「怖いなあ」（糸目で関西弁の有名なキャラ）と「ジブン」（ユーザーの例えのキャラ）は使わない（merchant.test.js が見張る）
// ★商店の品ぞろえは指示なしに足さない（セリフの「世界中の品」は飾り）
// ============================================================
import { fillLine, isNight, nextStreak, tapKindOf, makeDailyAsker, dayOf, CLERK_RARE_WEIGHT } from './clerk.js'
import { SHOP_ITEMS } from './shop.js'

// ★絵が届くまで false＝商店の画面は前のまま（2026-10-31 セリフと画面の作りを先に入れた）。絵を入れるときに外す
export const MERCHANT_ON = false

export const MERCHANT_NAME = 'ソルド'
export const MERCHANT_ART_DIR = '/v2cap-art/shop'
export const merchantSrc = (key) => `${MERCHANT_ART_DIR}/${key}.webp`

// 表情（腰から上・3枚とも同じ構図）。src＝元の絵の名前（プロンプトのページの保存名か、ユーザーの呼び方）
export const MERCHANT_FACES = [
  { key: 'normal', label: '普通',     src: ['普通', '通常'] },
  { key: 'grin',   label: 'にんまり', src: ['にんまり', '笑顔'] },
  { key: 'open',   label: '薄目',     src: ['薄目', '開眼'] },
]
export const MERCHANT_FACE_KEYS = MERCHANT_FACES.map(f => f.key)
// 画面で使う版の大きさ（tools/v2cap-shop-art.mjs が作る。3枚は同じ大きさ・merchant.test.js が突き合わせる）
export const MERCHANT_FACE_SIZE = { w: 464, h: 640 }
// 小さく出すとき（ポップアップの中・スマホの上）に見せるところ：x＝頭のまん中の横の位置（幅に対する割合）・top＝上から見せる高さ（高さに対する割合）
export const MERCHANT_FOCUS = { x: 0.5, top: 0.47 }

// ===== 好感度（看板娘・アレアと同じペース・画面には出さない）=====
//   その日はじめて話しかけたら（タップ）+1。1日1回・朝5時区切り・下がらない。数えるのはサーバー（v2cap_merchant_talk）
//   段階：2日目〜顔なじみ・10日目〜常連（くだけた話し方・兄さん／姉さん）・20日目〜仲良し（〇〇はん）・40日目〜親友
//   段階が上がって最初に話しかけたときは、その段階の場面のセリフ（1回だけ。どこまで見せたかはサーバーの merchant_stage_seen）
export const MERCHANT_STAGES = [
  { stage: 0, min: 0,  label: 'はじめて' },
  { stage: 1, min: 2,  label: '顔なじみ' },
  { stage: 2, min: 10, label: '常連' },
  { stage: 3, min: 20, label: '仲良し' },
  { stage: 4, min: 40, label: '親友' },
]
export const CASUAL_STAGE = 2   // 常連からくだけた話し方
export const NAME_STAGE = 3     // 仲良しから名前で呼ぶ
export const stageOf = (affinity) => [...MERCHANT_STAGES].reverse().find(s => (Number(affinity) || 0) >= s.min).stage
export const stageLabelOf = (stage) => MERCHANT_STAGES.find(s => s.stage === stage)?.label || ''
// 呼び方：男性「兄さん」・女性「姉さん」・性別を決めていなければ「あんた」
export const callOf = (profile) => (profile?.gender === 'm' ? '兄さん' : profile?.gender === 'f' ? '姉さん' : 'あんた')
// セリフに埋める名前：{call}＝いまの段階の呼び方（仲良しから「〇〇はん」）・{username}＝キャラクター名
export const varsOf = (profile, stage = 0) => {
  const username = profile?.username || ''
  return { call: stage >= NAME_STAGE && username ? `${username}はん` : callOf(profile), username }
}

// ===== セリフ（【確定】2026-10-31 ユーザーが案を見て「この案で入れて」）=====
// face＝出す表情。min／max＝出す好感度の段階（書いていなければ0から・上限なし）。rare＝出にくい（ほかの MERCHANT_RARE_WEIGHT 倍＝ちらっと本音）。
// 商売口調は max: 1 まで・くだけた話し方は min: 2 から（merchant.test.js が見張る）
export const MERCHANT_LINES = {
  // はじめて（まだ1回も話しかけていない人が店を開いたとき）＝名乗る
  intro: [
    { face: 'grin', text: 'まいど、いらっしゃい！ 旅の薬売りのソルドいいます。ええ薬そろえてまっせ。お代さえいただければ、ですけどな' },
    { face: 'grin', text: 'おっ、新しいお客さんやな？ わいはソルド。銭さえあれば、たいていのことは何とかなりまっせ' },
  ],
  // 店を開いたとき（名乗ったあと・顔なじみになるまで）
  enter: [
    { face: 'normal', text: 'まいど、いらっしゃい。今日は何を買うてくれはるんでっか？' },
    { face: 'grin', text: 'ええとこに来はった。ええ薬、入ってまっせ' },
  ],
  // 顔なじみから：前の日にも話した（今日も）／しばらく話していない（久しぶり）／今日もう話した（また）
  enterDaily: [
    { min: 1, max: 1, face: 'grin', text: 'まいど！ 今日も来てくれはったんでんな。ええお客さんや' },
    { min: 2, max: 2, face: 'grin', text: 'おう、{call}。今日もふところ、あったかそうやな' },
    { min: 3, face: 'grin', text: '{call}、待っとったで。…銭やのうて、{call}をな。ほんまやで' },
  ],
  enterLong: [
    { min: 1, max: 1, face: 'normal', text: 'おっ、えらい久しぶりでんな。よそで銭つこてまへんやろな？' },
    { min: 2, max: 2, face: 'normal', text: '{call}、久しぶりやな。ちょうど銭が恋しかったとこや' },
    { min: 3, face: 'grin', text: '{call}！ 久しぶりやん。心配しとったで、主に売り上げのほうを' },
  ],
  enterAgain: [
    { min: 1, max: 1, face: 'normal', text: 'なんや、また来てくれはったんでっか。忘れもんは銭だけにしときなはれ' },
    { min: 2, max: 2, face: 'grin', text: '{call}、また来たんか。ええで、何べんでも来てや。銭持って' },
    { min: 3, face: 'grin', text: '{call}、また来てくれたん？ 商売抜きでもええで。…いや、やっぱり抜きはあかんわ' },
  ],
  // 夜おそく（日本時間の0〜5時）
  enterNight: [
    { max: 1, face: 'normal', text: 'まいど、こんな夜ふけに。夜中のお客さんは、ええ銭の匂いがしますわ' },
    { min: 2, max: 2, face: 'normal', text: '{call}も宵っぱりやな。わいは銭かぞえとったら朝になるんや' },
    { min: 3, face: 'normal', text: '{call}も起きとったんか。銭かぞえるの手伝うてくれてもええで。…駄賃は出さんけどな' },
  ],
  // どの薬も買えないときに開いた
  enterPoor: [
    { max: 1, face: 'open', text: 'おっと、今日はふところが寂しそうでんな。また稼いできとくなはれ' },
    { min: 2, max: 2, face: 'open', text: '{call}、今日はふところ軽そうやな。…わい、そういうのは音でわかるんや' },
    { min: 3, face: 'open', text: '{call}、銭ないんか。…貸さへんで。それだけは、仲良うても貸さへん' },
  ],
  // 秘薬が効いているときに開いた
  enterFlip: [
    { max: 1, face: 'normal', text: 'あの秘薬、よう効いてまんな。今が昼か夜か、分からんようになりますやろ？' },
    { min: 2, max: 2, face: 'normal', text: '秘薬、よう効いとるな、{call}。今が昼か夜か、分からんやろ？' },
    { min: 3, face: 'normal', text: '{call}、秘薬、効いとるな。寝る時間だけは、間違えたらあかんで' },
  ],
  // ふつうにタップしたとき（同じセリフが2回続かないように選ぶ）。常連からは同じ中身をくだけた話し方で
  tap: [
    { max: 1, face: 'normal', text: 'お代は先にいただきますで。これ、商売の基本でっせ' },
    { max: 1, face: 'grin', text: '薬の中身でっか？ それは聞かんほうが、よう効きますわ' },
    { max: 1, face: 'grin', text: '値切りはお断りでっせ。よその店へどうぞ。…よその店、ないけどな' },
    { max: 1, face: 'grin', text: '安心しとくなはれ。わいの薬で死んだ人は、まだおりません。…たぶんな' },
    { max: 1, face: 'normal', text: 'この目でっか？ 開いてますで、ちゃんと。お客さんの財布も、よう見えてますわ' },
    { max: 1, face: 'normal', text: 'この荷物には、世界中の品が詰まっとります。売るかどうかは、別の話ですけどな' },
    { max: 1, face: 'normal', text: '飲んだあとのことは、お客さんの責任でっせ。返品はききまへん' },
    { max: 1, face: 'grin', text: 'まいど！ …あ、まだ買うてへんのでっか。ほな、今のなしで' },
    { min: 1, max: 1, face: 'grin', text: 'お客さんの足音、銭の音に聞こえてきましたわ' },
    { min: 1, max: 1, face: 'normal', text: 'ほかの客には内緒でっせ。…ほかの客にも言うてますけどな' },
    { min: 2, face: 'normal', text: 'お代は先やで。これだけは{call}でも変わらへん' },
    { min: 2, face: 'grin', text: '薬の中身？ 聞かんほうが、よう効くで' },
    { min: 2, face: 'grin', text: '値切りはあかんで。{call}の頼みでも、あかんもんはあかん' },
    { min: 2, face: 'grin', text: '安心しとき。わいの薬で死んだ人は、まだおらへん。…たぶんな' },
    { min: 2, face: 'normal', text: 'この目か？ ちゃんと開いとるで。{call}の財布も、よう見えとる' },
    { min: 2, face: 'normal', text: 'この荷物なあ、世界中の品が詰まっとるねん。売るかどうかは別やけど' },
    { min: 2, face: 'normal', text: '飲んだあとのことは知らんで。返品もきかへんで' },
    { min: 2, face: 'open', text: '銭はな、裏切らへんのや。人と違うてな' },
    { min: 2, face: 'normal', text: 'この鎖の先か？ わいが最初に稼いだ金貨や。これだけは、なんぼ積まれても売らへん' },
    { min: 2, face: 'grin', text: '{call}、ええ顔になってきたな。…銭持ってそうな顔や' },
    { min: 3, face: 'grin', text: '{call}だけやで、こんなに話すの。ほかの客とは銭の話しかせえへんからな' },
    { min: 3, face: 'normal', text: '{call}、無茶したらあかんで。おらんようになったら、ええ客がひとり減るやろ' },
    { min: 3, face: 'grin', text: '{call}には特別に教えたるわ。うまい話はな、たいてい嘘や。わいが言うんやから間違いない' },
    { min: 4, face: 'grin', text: 'ソルドって呼んでくれるん、もう{call}くらいやで。ほかの客は「あの怪しいの」やからな' },
    // ちらっと本音（出にくい）：常連から2つ・仲良しから2つ・親友から1つ
    { min: 2, rare: true, face: 'open', text: '昔な、銭がなくて、どうにもならんかったことがあってな。…まあ、つまらん話や' },
    { min: 2, rare: true, face: 'open', text: 'わいの目が開いたとこ、見たい？ …見えへんほうがええもんも、あるんやで' },
    { min: 3, rare: true, face: 'open', text: '行商はええで。どこへでも行ける。…どこにも帰らんでええ' },
    { min: 3, rare: true, face: 'open', text: 'この荷物のいちばん底にな、絶対に売らへん薬がひと瓶あるねん' },
    { min: 4, rare: true, face: 'open', text: '{call}、もし誰かに騙されたら言うてや。騙すんは、わいだけでええねん' },
  ],
  tapNight: [
    { max: 1, face: 'normal', text: '夜は銭の音がよう響きますなあ。ええ時間でっせ' },
    { max: 1, face: 'normal', text: 'お客さん、そろそろ寝なはれ。…寝る前に何か買うてからな' },
    { min: 2, face: 'normal', text: '夜は銭の音がよう響くんや。ええ時間やで' },
    { min: 2, face: 'normal', text: '{call}、寝えや。…寝る前に何か買うてからな' },
    { min: 3, face: 'normal', text: '{call}、はよ寝えや。明日も来てもらわな、困るからな' },
  ],
  // 続けてタップしたとき（3回目・5回目・8回目から）。8回目からは糸目が開く
  streak3: [
    { max: 1, face: 'normal', text: 'なんでっか？ 触るんやったら、お代いただきますで' },
    { min: 2, max: 2, face: 'normal', text: 'なんや、{call}。触るんなら銭取るで' },
    { min: 3, face: 'normal', text: 'なんや、{call}。わいを触っても銭は出えへんで' },
  ],
  streak5: [
    { max: 1, face: 'grin', text: 'そろそろ見物料いただきますで' },
    { min: 2, max: 2, face: 'grin', text: '{call}、そろそろ見物料もらうで' },
    { min: 3, face: 'grin', text: '{call}、そんなに見てもまけへんで' },
  ],
  streak8: [
    { max: 1, face: 'open', text: '……お客さん。わいの目、開けさせんといてくれます？' },
    { min: 2, max: 2, face: 'open', text: '……{call}。わいの目、開けさせんといてや' },
    { min: 3, face: 'open', text: '……{call}。ええ加減にせんと、ほんまに開けるで' },
  ],
  // ===== 買う確かめ（askKindOf）=====
  askGender: [
    { max: 1, face: 'grin', text: '飲みはるんでっか？ 戻りたなったら、もう一本買うてもろたらええだけですわ' },
    { min: 2, max: 2, face: 'grin', text: '飲むんか、{call}。戻りたなったら、もう一本買うたらええ。…銭、残しときや' },
    { min: 3, face: 'normal', text: '{call}、ほんまにええんやな？ どっちの{call}でも、わいのお客さんに変わりはないで' },
  ],
  askFlip: [
    { max: 1, face: 'normal', text: '昼と夜がひっくり返る薬でっせ。目え回さんよう、気いつけなはれ' },
    { min: 2, max: 2, face: 'normal', text: '昼と夜がひっくり返るで。目え回さんようにな、{call}' },
    { min: 3, face: 'normal', text: '{call}、昼と夜がひっくり返るで。寝る時間だけは、ちゃんと取りや' },
  ],
  // 秘薬が効いているのにもう1本
  askFlipMore: [
    { max: 1, face: 'grin', text: 'まだ効いてまっせ？ まあ、買うてくれはるんなら止めまへんけど' },
    { min: 2, max: 2, face: 'grin', text: 'まだ効いとるで、{call}。…まあ、買うてくれるんなら止めへんけど' },
    { min: 3, face: 'grin', text: 'まだ効いとるで、{call}。…止めへんけどな。商売やから' },
  ],
  // ===== 買った結果（boughtKindOf）=====
  // 性別変更薬で女性になった
  boughtF: [
    { max: 1, face: 'grin', text: '毎度おおきに！ ようお似合いですわ、姉さん' },
    { min: 2, max: 2, face: 'grin', text: 'おおきに！ 兄さん、いや、今日からは姉さんやな' },
    { min: 3, face: 'grin', text: 'おおきに、{call}！ 見違えたで。…お代は見違えへんけどな' },
  ],
  // 性別変更薬で男性になった
  boughtM: [
    { max: 1, face: 'grin', text: '毎度おおきに！ ええ男っぷりですわ、兄さん' },
    { min: 2, max: 2, face: 'grin', text: 'おおきに！ 姉さん、いや、今日からは兄さんやな' },
    { min: 3, face: 'grin', text: 'おおきに、{call}！ 見違えたで。…お代は見違えへんけどな' },
  ],
  boughtFlip: [
    { max: 1, face: 'grin', text: '毎度おおきに！ 昼と夜がひっくり返っとるあいだに、しっかり稼いできとくなはれ' },
    { min: 2, max: 2, face: 'grin', text: 'おおきに、{call}！ 稼いだ銭は、またここで使うてや' },
    { min: 3, face: 'grin', text: 'おおきに、{call}！ 無事に帰ってきいや。…銭もな' },
  ],
  // うまくいかなかった（通信・サーバーの断り＝お代は引かれていない）
  error: [{ face: 'normal', text: 'ありゃ、うまいこといかへんかったわ。お代はもろてへんから、安心しとき' }],
}

// 段階が上がって最初に話しかけたときの場面（1回だけ）。2＝くだけた話し方に変わる・3＝名前を聞いて呼び始める・4＝銭を集めるわけをはぐらかす
export const MERCHANT_STAGE_EVENTS = {
  1: { face: 'grin', text: 'おっ、この前のお客さんでんな。顔と財布は忘れへんのですわ' },
  2: { face: 'grin', text: 'もうすっかり常連さんやな。「お客さん」はやめや。これからは{call}って呼ばせてもらうで' },
  3: { face: 'grin', text: 'なあ、名前、教えてくれへん？ ……{username}か。ええ名前や。ツケの帳面に書きやすいわ。…冗談や、これからは{call}って呼ぶで' },
  4: { face: 'open', text: '{call}、わいが何で銭を集めとるか、知りたい？ ……銭が好きやからや！ なんや、期待したんか。…ほんまの話は、また今度な' },
}
// まだ見せていない場面（いまの段階から下へ探して、いちばん上のもの）。seen＝見せた段階（サーバーの merchant_stage_seen）。無ければ null
export const stageEventOf = (stage, seen = 0) => {
  for (let s = stage; s > (Number(seen) || 0); s--) if (MERCHANT_STAGE_EVENTS[s]) return { stage: s, ...MERCHANT_STAGE_EVENTS[s] }
  return null
}

// 場面 kind のセリフを1つ選ぶ。stage＝好感度の段階。last＝直前のセリフの文（同じものが続かないように・2つ以上あるときだけ）。
// rare のセリフは MERCHANT_RARE_WEIGHT 倍しか出ない（看板娘の伏線と同じ4分の1）
export const MERCHANT_RARE_WEIGHT = CLERK_RARE_WEIGHT
export const linesOf = (kind, stage = 0) =>
  (MERCHANT_LINES[kind] || MERCHANT_LINES.tap).filter(l => (l.min ?? 0) <= stage && stage <= (l.max ?? Infinity))
const weightOf = (l) => (l.rare ? MERCHANT_RARE_WEIGHT : 1)
export const pickLine = (kind, { rng = Math.random, last = null, vars = {}, stage = 0 } = {}) => {
  const list = linesOf(kind, stage)
  const pool = list.length > 1 && last ? list.filter(l => fillLine(l.text, vars) !== last) : list
  const from = pool.length ? pool : list
  let r = rng() * from.reduce((t, l) => t + weightOf(l), 0)
  const l = from.find(x => (r -= weightOf(x)) < 0) || from[from.length - 1]
  return { face: l.face, text: fillLine(l.text, vars) }
}

// どの薬も買えないか（店を開いたときのひとこと）
export const poorOf = (gold) => (Number(gold) || 0) < Math.min(...SHOP_ITEMS.map(i => i.gold))

// 店を開いたときのひとこと。affinity＝好感度・lastTalk＝前に話しかけた日（プロフィールの merchant_talk_day）・poor＝どの薬も買えない・flipping＝秘薬が効いている。
// まだ話しかけたことがない → 名乗る／どの薬も買えない／秘薬が効いている／夜おそく／顔なじみになるまで → ふつう／
// 顔なじみから → 「また（今日もう話した）」「今日も（前の日）」「久しぶり（2日以上あいた）」の順に見る
export const enterKindOf = ({ affinity = 0, lastTalk = null, poor = false, flipping = false, at = new Date() } = {}) => {
  if (!(Number(affinity) > 0)) return 'intro'
  if (poor) return 'enterPoor'
  if (flipping) return 'enterFlip'
  if (isNight(at)) return 'enterNight'
  if (stageOf(affinity) < 1) return 'enter'
  const d = at instanceof Date ? at : new Date(at)
  const last = lastTalk ? String(lastTalk).slice(0, 10) : ''
  if (last === dayOf(d)) return 'enterAgain'
  return last === dayOf(new Date(d.getTime() - 864e5)) ? 'enterDaily' : 'enterLong'
}
// 買う確かめの場面。flipping＝秘薬が効いている
export const askKindOf = (item, flipping = false) => (item === 'gender' ? 'askGender' : flipping ? 'askFlipMore' : 'askFlip')
// 買った結果の場面。data＝サーバーの返事（item と、性別変更薬なら飲んだあとの gender）
export const boughtKindOf = (data) => (data?.item === 'gender' ? (data.gender === 'f' ? 'boughtF' : 'boughtM') : 'boughtFlip')

export { fillLine, isNight, nextStreak, tapKindOf, makeDailyAsker }
