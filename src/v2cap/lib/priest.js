// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 神殿の神官
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー指示「イラストは神官で顔はしっかりと確認できないような感じにする予定」
//   （神殿の画面に、看板娘・親方・アレア・テオドールと同じ形でイラストを入れる）＋選んだこと：
//   ・顔：深いフードの影で、額・目・鼻まで見えない。見えるのは口元とあごの先だけ
//   ・人物：性別も年齢も分からない（体の線が出ない法衣・セリフに一人称を使わない）。静かで、相手を見透かすような話し方（穏やかなていねい語で短く）
//   ・服：白と金の法衣。★名乗らない＝画面ではただの「神官」（親方と同じ）
//   ・絵はユーザーが ChatGPT で描く（プロンプトのページ https://claude.ai/artifact/H6Ern3zQVxz7AYPLwCTfLL ）。腰から上の1枚だけ（顔が見えないので表情の差分なし）。
//     元の絵は public/V2神殿/普通.png（git に入れない）→ `node tools/v2cap-temple-art.mjs` で public/v2cap-art/temple/normal.webp
//   ・入れる動き（ユーザー選択）：タップでセリフ・転職したときにひとこと。好感度は無し・1日1回の大きなあいさつも無し（親方・テオドールと同じ・SQL 不要）
//   ・セリフはユーザーが案を見て「この案で入れて」（2026-10-31）
//   ・セリフの選び方・続けてタップ・夜の決まりは、看板娘（clerk.js）と同じものを使う
// ★数字やゲームの仕組みの言葉（転職・クラス・LV・ステータス・スキル・装備・Gold など）はセリフに入れない＝世界観を守る（priest.test.js が見張る）。
//   「道」「歩み」と言いかえる。クラスの名前（剣士など）はこの世界の言葉なので {cls} で埋めてよい
// ============================================================
import { fillLine, isNight, nextStreak, tapKindOf } from './clerk.js'
import { stageOf } from './jobs.js'

export const PRIEST_ART_DIR = '/v2cap-art/temple'
export const priestSrc = (key) => `${PRIEST_ART_DIR}/${key}.webp`

// 絵（腰から上の1枚だけ）。src＝元の絵の名前（プロンプトのページの保存名か、ユーザーの呼び方。ユーザーが置いた絵は「神官.png」）
export const PRIEST_FACES = [{ key: 'normal', label: '普通', src: ['普通', '通常', '神官'] }]
export const PRIEST_FACE_KEYS = PRIEST_FACES.map(f => f.key)
// 画面で使う版の大きさ（tools/v2cap-temple-art.mjs が作る。priest.test.js が突き合わせる）
export const PRIEST_FACE_SIZE = { w: 436, h: 640 }
// 小さく出すとき（転職のひとこと・スマホの上）に見せるところ：x＝頭のまん中の横の位置（幅に対する割合）・top＝上から見せる高さ（高さに対する割合）。
// フードのてっぺんから胸のメダルまでを切り出す。フードが横に広いので、枠は親方（112×150）より幅を広げた（縦長の枠だと、切らないように引くと頭が小さくなる・2026-10-31 15通り見比べた）
export const PRIEST_FOCUS = { x: 0.503, top: 0.58 }
export const PRIEST_THUMB = { w: 132, h: 150 }   // 狭い画面の上
export const PRIEST_SAY = { w: 108, h: 122 }     // 転職の結果の中

// ===== セリフ（【確定】2026-10-31 ユーザーが案を見て「この案で入れて」）=====
// 絵は1枚なので face は書かない（pickLine が普通の絵を返す）。{cls}＝転職した先のクラスの名前だけを埋める（プレイヤーの名前は呼ばない）
export const PRIEST_LINES = {
  // 神殿を開いたとき
  enter: [
    { text: 'ようこそ、いらっしゃいました。今日は、どの道を見つめに？' },
    { text: 'お待ちしていました。あなたがここへ来ることは、分かっていましたよ' },
    { text: '静かでしょう。ここでは、自分の足音がよく聞こえます' },
  ],
  // 夜おそく（日本時間の0〜5時）に開いたとき
  enterNight: [{ text: '夜の神殿へ、ようこそ。迷いは、暗いほうがよく見えるものです' }],
  // ふつうにタップしたとき（同じセリフが2回続かないように選ぶ）
  tap: [
    { text: '一度歩いた道は、消えません。戻りたくなったら、続きから歩めますよ' },
    { text: '道を変えるのに、代償はいりません。いつでも、ここへいらしてください' },
    { text: 'ひとつの道を深く歩めば、その先に、別の道が見えてくるものです' },
    { text: '道が変われば、手になじむ武器も変わります。置いていく武器が、あるかもしれませんね' },
    { text: '迷うのは、悪いことではありません。選べる道がある、ということですから' },
    { text: '強さの形は、ひとつではありません。どの道にも、その道の強さがあります' },
    { text: 'あなたの歩みは、もう次の道を探しているようですね' },
    { text: '顔ですか？ 見えなくても、困ることはありませんよ' },
    { text: 'なぜ分かるのか、ですか。…足音で、だいたいのことは' },
    { text: 'おや、少し香ばしい匂いが。…いえ、何でもありません' },
    { text: 'あなたの影は、今日も少し前を歩いていますね' },
    { text: '神殿の鐘は、聞こうとする人にだけ聞こえます' },
    { text: 'ユグレシアの宝樹には、もう祈りましたか。あの木は、よく聞いてくれますよ' },
  ],
  tapNight: [
    { text: '夜ふけの祈りは、よく届きます。…眠れないのですね' },
    { text: '灯りは落としても、扉は閉めません。ここはそういう場所です' },
  ],
  // 続けてタップしたとき（3回目・5回目・8回目から）
  streak3: [{ text: '…ふふ。あなたが次に何をするか、分かっていましたよ' }],
  streak5: [{ text: 'フードの中を、のぞこうとしていますね。…何も見えませんよ' }],
  streak8: [{ text: 'そこまでです。見えないものは、見えないままのほうが、よいこともあります' }],
  // ===== 転職の結果（changeKindOf）=====
  // はじめて就くクラス
  changeNew: [
    { text: '{cls}の道が、いま開きました。どうか、よい旅を' },
    { text: '今日からあなたは{cls}。…よく似合っていますよ' },
  ],
  // 前に就いたことのあるクラスへ戻った
  changeBack: [
    { text: 'おかえりなさい、{cls}の道へ。足あとは、そのまま残っていますよ' },
    { text: '{cls}の道が、あなたを覚えていました' },
  ],
  // はじめて就く上位クラス
  changeUp: [{ text: 'よくここまで歩みましたね。{cls}の道は、誰にでも開くものではありません' }],
  // うまくいかなかった（通信・サーバーの断り）
  error: [{ text: '…道が、うまく開かなかったようです。もう一度、お願いできますか' }],
}

// 場面 kind のセリフを1つ選ぶ。last＝直前のセリフの文（同じものが続かないように・2つ以上あるときだけ）
export const linesOf = (kind) => PRIEST_LINES[kind] || PRIEST_LINES.tap
export const pickLine = (kind, { rng = Math.random, last = null, vars = {} } = {}) => {
  const list = linesOf(kind)
  const pool = list.length > 1 && last ? list.filter(l => fillLine(l.text, vars) !== last) : list
  const from = pool.length ? pool : list
  const l = from[Math.min(from.length - 1, Math.floor(rng() * from.length))]
  return { face: PRIEST_FACE_KEYS[0], text: fillLine(l.text, vars) }
}

// 神殿を開いたときの場面（夜おそくは夜のひとこと）
export const enterKindOf = (at = new Date()) => (isNight(at) ? 'enterNight' : 'enter')
// 転職の結果の場面。jobs＝転職する前の prof.jobs（就いたことのあるクラスの名前が入っている）。
// 前に就いたことがある → 戻ってきた／はじめての上位クラス → ここまで歩んだことをねぎらう／はじめての初期クラス → ふつう
export const changeKindOf = (cls, jobs) => (jobs?.[cls] ? 'changeBack' : stageOf(cls) === 'ichiji' ? 'changeUp' : 'changeNew')

export { isNight, nextStreak, tapKindOf, fillLine }
