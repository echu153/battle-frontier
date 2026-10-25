// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 鍛冶屋の親方トルステン
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「鍛冶屋の画面に、ニャーガーキングの看板娘と同じ形で、鍛冶屋のキャラのイラストを入れたい」＋選んだこと：
//   ・人物：スキンヘッドにちょび髭の屈強な男。男気があって、頑固というより気さくなおっちゃん（ユーザーの言葉）。名前はトルステン（ユーザー選択）。
//     ★ゲームの中では名乗らない（2026-10-26 ユーザー指示「親方は名乗らなくていい。常連の場面から名前を外して」）＝名前は設計書とコードの中の呼び名だけ
//   ・絵はユーザーが ChatGPT で描く（プロンプトのページ https://claude.ai/artifact/He7mdSS7zaop6B9LHY2DxW ）。
//     腰から上の2枚＝普通・笑顔（ユーザー「そんなにいらない」で3枚にしたあと、描いたユーザーが「笑顔と通常だけにした」）。全身の絵は無し。
//     元の絵は public/V2鍛冶屋/<名前>.png（git に入れない）→ `node tools/v2cap-smith-art.mjs` で public/v2cap-art/smith/<キー>.webp
//   ・入れる動き（ユーザー選択）：タップでセリフ・強化と作成の結果で反応・好感度（毎日話しかけると仲良くなる・名前で呼ぶほどではない）。1日1回の全身のあいさつは無し
//   ・セリフの選び方・続けてタップ・夜・1日1回だけサーバーに聞く決まりは、看板娘（clerk.js）と同じものを使う
// ============================================================
import { fillLine, isNight, nextStreak, tapKindOf, makeDailyAsker, dayOf } from './clerk.js'
import { PLUS_MAX, ENHANCE_RATE } from './smith.js'

export const MASTER_ART_DIR = '/v2cap-art/smith'
export const masterSrc = (key) => `${MASTER_ART_DIR}/${key}.webp`

// 表情（腰から上の絵・2枚とも同じ構図）。src＝元の絵の名前（プロンプトのページの保存名か、ユーザーの呼び方）
export const MASTER_FACES = [
  { key: 'normal', label: '普通', src: ['普通', '通常'] },
  { key: 'smile',  label: '笑顔', src: ['笑顔'] },
]
export const MASTER_FACE_KEYS = MASTER_FACES.map(f => f.key)
// 画面で使う版の大きさ（tools/v2cap-smith-art.mjs が作る。2枚は同じ大きさ・smithMaster.test.js が突き合わせる）
export const MASTER_FACE_SIZE = { w: 464, h: 640 }
// 小さく出すとき（ポップアップの中・スマホの上）に見せるところ：x＝頭のまん中の横の位置（幅に対する割合）・top＝上から見せる高さ（高さに対する割合）。
// 親方の絵は肩と金槌で横に広く、幅いっぱいに縮めると顔が小さくなるので、頭から胸までを切り出す（2026-10-26）
export const MASTER_FOCUS = { x: 0.515, top: 0.47 }

// ===== 好感度（【確定】2026-10-26 ユーザー選択「好感度（毎日話すと仲良く）」＝看板娘と同じ数え方）=====
//   ・その日はじめて話しかけたら（タップ）+1。1日1回・朝5時区切り・下がらない。数えるのはサーバー（v2cap_smith_talk）。画面には出さない
//   ・段階は2日目〜顔なじみ・10日目〜常連（日数は看板娘と同じ）。
//     ★名前で呼ぶほどは仲良くならない（2026-10-26 ユーザー指示「名前呼ぶくらいまで仲良くはならなくていい」＝前の案の20日目〜名前・40日目〜相棒は外した）
//   ・段階が上がって最初に話しかけたときは、その段階の場面のセリフ（1回だけ。どこまで見せたかはサーバーの smith_stage_seen）。親方は名乗らない
//   ・呼び方：男性「兄ちゃん」・女性「嬢ちゃん」・性別を決めていなければ「お前さん」（プレイヤーの名前は呼ばない）
export const MASTER_STAGES = [
  { stage: 0, min: 0,  label: 'はじめて' },
  { stage: 1, min: 2,  label: '顔なじみ' },
  { stage: 2, min: 10, label: '常連' },
]
export const stageOf = (affinity) => [...MASTER_STAGES].reverse().find(s => (Number(affinity) || 0) >= s.min).stage
export const stageLabelOf = (stage) => MASTER_STAGES.find(s => s.stage === stage)?.label || ''
export const callOf = (profile) => (profile?.gender === 'm' ? '兄ちゃん' : profile?.gender === 'f' ? '嬢ちゃん' : 'お前さん')
// セリフに埋める呼び方：{call}＝兄ちゃん／嬢ちゃん／お前さん
export const varsOf = (profile) => ({ call: callOf(profile) })

// ===== セリフ =====
// face＝出す表情。min／max＝出す好感度の段階（書いていなければ0から・上限なし）。
// {plus}＝強化値・{item}＝作った装備の名前・{n}＝分解した数・{what}＝足りないもの（「新緑の残骸」「Gold」）
// ★レア度の名前（ノーマル・レジェンダリーなど）は言わない（2026-10-26 ユーザー指示「レアリティを直接言わないで」・smithMaster.test.js が見張る）
export const MASTER_LINES = {
  // 鍛冶屋を開いたとき
  enter: [
    { max: 0, face: 'smile', text: 'おう、いらっしゃい！ 武器でも防具でも、ビシッと鍛えてやるぜ' },
    { max: 0, face: 'normal', text: 'よく来たな、{call}。今日は何を持ってきた？' },
    { min: 1, face: 'smile', text: 'おっ、また来たな！ 今日は何を鍛える？' },
    { min: 1, face: 'smile', text: 'おう、{call}！ 炉はもう温まってるぜ' },
  ],
  // 夜おそく（日本時間の0〜5時）に開いたとき
  enterNight: [{ face: 'normal', text: 'こんな夜ふけまで精が出るな。炉の火はまだ落としてねえぞ' }],
  // ふつうにタップしたとき（同じセリフが2回続かないように選ぶ）。段階が上がると増える
  tap: [
    { face: 'normal', text: '強化は失敗しても強化値は下がらねえ。安心して叩きな' },
    { face: 'smile', text: 'いらねえ装備は分解しな。残骸がありゃ、強化も作成もできるぜ' },
    { face: 'normal', text: '+6で成功は半々、そこから先はもっと厳しいぜ。残骸とGoldは多めに用意しときな' },
    { face: 'normal', text: '強化は+10まで上げられる。てっぺんを目指してみな' },
    { face: 'smile', text: 'いい装備を作るには、残骸がたんまりいる。コツコツ集めな' },
    { face: 'smile', text: 'ガハハ！ 今日もいい音で鉄が鳴ってらあ' },
    { min: 1, face: 'smile', text: '最近よく来るな。いい冒険者ってのは道具を大事にするもんだ' },
    { min: 1, face: 'normal', text: '刃こぼれした剣じゃ、勝てる戦も勝てねえ。手入れを忘れんなよ' },
    { min: 2, face: 'normal', text: '鉄はな、叩けば叩くほど強くなる。人間も同じだぜ' },
    { min: 2, face: 'smile', text: 'この金槌か？ 親父から譲り受けたもんだ。もう30年は使ってるな' },
    { min: 2, face: 'normal', text: 'おっと、炉の火が弱くなってきた。…ふう、間に合ったぜ' },
    { min: 2, face: 'smile', text: '{call}の装備は、いつも気合い入れて叩いてるんだぜ' },
  ],
  tapNight: [
    { face: 'normal', text: '夜は鉄の焼き色がよく見える。仕事がはかどるんだ' },
    { face: 'smile', text: 'ふあ…おっと、あくびが出ちまった。ガハハ' },
  ],
  // 続けてタップしたとき（3回目・5回目・8回目から）
  streak3: [{ face: 'normal', text: 'おっ？ どうした、俺の顔になんかついてるか？' }],
  streak5: [{ face: 'smile', text: 'ガハハ！ くすぐってえな！' }],
  streak8: [{ face: 'normal', text: 'おいおい、それじゃ仕事にならねえだろ！' }],
  // 強化の結果（enhanceKindOf）：+1〜6に成功・+7〜9に成功（成功率40%以下）・+10（上限）に成功・失敗
  enhanceOk: [
    { face: 'smile', text: 'よっしゃあ！ +{plus}だ！ いい仕上がりだぜ' },
    { face: 'smile', text: 'ガハハ！ どうだ、見事なもんだろう！' },
  ],
  enhanceGreat: [{ face: 'smile', text: 'おおっ…！ +{plus}だと！？ こいつはすげえぞ！' }],
  enhanceMax: [{ face: 'smile', text: '+10…！ 長いこと鍛冶屋をやってるが、こいつは最高傑作だ！' }],
  enhanceFail: [
    { face: 'normal', text: 'すまねえ、今回はダメだった。だが強化値は下がってねえ、次いこうぜ！' },
    { face: 'smile', text: 'ガハハ、鉄の機嫌が悪かったな！ 気にすんな、次は決めるぜ' },
  ],
  // 作成した
  craft: [
    { face: 'smile', text: 'できたぞ！ {item}だ。大事に使えよ！' },
    { face: 'smile', text: 'ほらよ、{item}の出来上がりだ。いい出来だろ？' },
  ],
  // 分解した
  dismantle: [{ face: 'normal', text: 'おう、{n}個ばらしといたぜ。残骸は大事に使えよ' }],
  // 強化の画面を開いたけれど、残骸かGoldが足りない
  short: [{ face: 'normal', text: 'おっと、{what}が足りねえな。出撃して集めてきな' }],
  // うまくいかなかった（通信など）
  error: [{ face: 'normal', text: 'おっと、うまくいかなかったみてえだ。もう一回頼む' }],
}

// 段階が上がって最初に話しかけたときの場面（1回だけ）。親方は名乗らない（ユーザー指示）
export const MASTER_STAGE_EVENTS = {
  1: { face: 'smile', text: 'おっ、こないだも来てくれたな！ ちゃんと覚えてるぜ' },
  2: { face: 'smile', text: 'すっかり常連だな！ {call}の装備は、これからも俺に任せときな！' },
}
// まだ見せていない場面（いまの段階から下へ探して、いちばん上のもの）。seen＝見せた段階（サーバーの smith_stage_seen）。無ければ null
export const stageEventOf = (stage, seen = 0) => {
  for (let s = stage; s > (Number(seen) || 0); s--) if (MASTER_STAGE_EVENTS[s]) return { stage: s, ...MASTER_STAGE_EVENTS[s] }
  return null
}

// 場面 kind のセリフを1つ選ぶ。stage＝好感度の段階。last＝直前のセリフの文（同じものが続かないように・2つ以上あるときだけ）
export const linesOf = (kind, stage = 0) =>
  (MASTER_LINES[kind] || MASTER_LINES.tap).filter(l => (l.min ?? 0) <= stage && stage <= (l.max ?? Infinity))
export const pickLine = (kind, { rng = Math.random, last = null, vars = {}, stage = 0 } = {}) => {
  const list = linesOf(kind, stage)
  const pool = list.length > 1 && last ? list.filter(l => fillLine(l.text, vars) !== last) : list
  const from = pool.length ? pool : list
  const l = from[Math.min(from.length - 1, Math.floor(rng() * from.length))]
  return { face: l.face, text: fillLine(l.text, vars) }
}

// 鍛冶屋を開いたときの場面（夜おそくは夜のひとこと）
export const enterKindOf = (at = new Date()) => (isNight(at) ? 'enterNight' : 'enter')
// 強化の結果の場面。大成功は成功率40%以下の回（+7から）
export const GREAT_PLUS = ENHANCE_RATE.findIndex(r => r <= 40) + 1
export const enhanceKindOf = (success, plus) =>
  (!success ? 'enhanceFail' : plus >= PLUS_MAX ? 'enhanceMax' : plus >= GREAT_PLUS ? 'enhanceGreat' : 'enhanceOk')
// 強化できないわけ（smith.js の enhanceErrorOf）から、足りないもの（「新緑の残骸」「Gold」）。足りないせいでなければ null
export const shortWhatOf = (err) => (err && /が足りません$/.test(err) ? err.replace(/が足りません$/, '') : null)

export { isNight, nextStreak, tapKindOf, makeDailyAsker, dayOf, fillLine }
