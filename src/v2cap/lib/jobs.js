// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 職業とクラスLV（ClassLV）
// ------------------------------------------------------------
// 設計は docs/v2cap-design.md §4・§11。ユーザー決定（2026-10-09）：
//   ・クラスLV（表記は **ClassLV**）は**職業ごと**に持ち、戻れば続きから。上限は初期職30・一次職50（段階ごと＝STAGES の max）
//   ・入るのは**いまの職業**のClassLVだけ（その戦闘で入ったEXPと同じ量）
//   ・ClassLVが上がると、スキルを覚える／ステが上がる（ステは職業ごとに決まっていて、その職業の間だけ）
//   ・職業補正（今のⅡの STR+5% など）は**一旦なし**
//   ・**初期職は11職**（2026-10-09 に剣士を足した）。職業ごとに**装備できる武器が3〜4種**決まっている
//     （刀を戦士・盗賊に、宝珠を魔法使い・呪術師・僧侶に足したので、その5職は4種）
//   ・ノーブル・サモナーはなくす
//   ・**一次職は20職**（2026-10-10 ユーザーの表「一次職スキル一覧」・初期職10系統に2職ずつ。剣士系はあとで足す）。
//     系統の初期職がClassLV30で就ける／ClassLV上限50／必要ClassEXPは初期職の3倍／ステはClassLV1ごとに6点
//     （ClassLV30で初期職の1.2倍）／武器は系統の初期職と同じ（どれもユーザー決定）。二次・三次はこれから
//   ・スキルは**その職業でだけ使える**。**上位職は下位職のスキルをそのまま使える**（lineageOf）
//
// ★権威はサーバー（supabase_v2cap_core.sql の v2cap_classes / v2cap_job_need / v2cap_apply_exp）。
//   ここは表示とシミュレーション用の写し。v2capsql.test.js が突き合わせる。
// ============================================================
import { STAT_KEYS, STAT_DEFS } from '../../v2/lib/stats.js'
import { SKILLS, skillsOf, isPassive } from './skills.js'

// 初期職のClassLVの上限。一次職は50（STAGES.ichiji.max）。職業ごとの上限は jobMaxOf を使う
export const JOB_MAX = 30

// ===== 段階 =====
// mult … 必要ClassEXPの倍率（上の段階ほど重い）／perLv … ClassLVが1上がるごとのステの量（戦闘力換算）
// learnAt … スキルを覚えるClassLV（並び＝スキルの名簿の順）
// max … ClassLVの上限
// 【確定】2026-10-10 ユーザー決定：一次職は ClassLV上限50・必要ClassEXPは初期職の3倍・ClassLV1ごとに6点
//   （効くのは一次職の分だけ。ClassLV30で174点＝初期職の145点の1.2倍、ClassLV50で294点）。
//   技は ClassLV1／5／10／15／20／25／30／40 で8つ（ユーザーの表「一次職スキル一覧」）
export const STAGES = {
  shoki:  { label:'初期', color:'#44aaff', mult:1, perLv:5, max:JOB_MAX, learnAt:[1, 5, 10, 15, 20] },
  ichiji: { label:'一次', color:'#cc66ff', mult:3, perLv:6, max:50, learnAt:[1, 5, 10, 15, 20, 25, 30, 40] },
}
export const STAGE_ORDER = ['shoki', 'ichiji']
export const jobMaxOfStage = (stage) => STAGES[stage]?.max || JOB_MAX

// ===== 職業 =====
// weapons … 装備できる武器の種類（3〜4つ）／kind … 通常攻撃が物理（STR）か魔法（INT）か
// desc … キャラ作成と神殿で出す特徴の説明。【確定】2026-10-11 ユーザー指示「説明文は具体的なスキル名やステータス名を記載しないで、
//        どういった特徴があるのかだけを簡単にまとめて」（2026-10-09 承認の文面から書き直した。v2cap.test.js が見張る）
export const CLASS_INFO = {
  戦士:     { weapons:['両手剣', '斧', '鈍器', '刀'], kind:'phys', desc:'打たれ強さを活かし、正面から重い一撃を叩き込む前衛' },
  槍使い:   { weapons:['槍', '片手剣', '投擲'],   kind:'phys', desc:'攻めと守りのバランスがよく、着実に相手を削っていく' },
  格闘家:   { weapons:['拳', '鈍器', '杖'],       kind:'phys', desc:'すばやい連続攻撃で一気に畳みかける近接型' },
  盗賊:     { weapons:['短剣', '片手剣', '投擲', '刀'], kind:'phys', desc:'身軽に動き回り、相手を乱しながら戦うアタッカー' },
  弓使い:   { weapons:['弓', '短剣', '片手剣'],   kind:'phys', desc:'離れた位置から、狙いを外さない射撃で戦う' },
  銃士:     { weapons:['銃', '片手剣', '投擲'],   kind:'phys', desc:'正確な射撃で、守りの固い相手も撃ち抜く' },
  // 【確定】2026-10-09 ユーザー決定（剣士を足す・武器は刀・片手剣・両手剣・ステはSTR・DEX・AGI・説明文と技は承認済み）
  剣士:     { weapons:['刀', '片手剣', '両手剣'], kind:'phys', desc:'鋭い剣さばきで、攻めと身のこなしを両立する' },
  魔法使い: { weapons:['杖', '書', '短剣', '宝珠'], kind:'mag',  desc:'さまざまな攻撃魔法を使い分け、大きな一撃を狙う' },
  呪術師:   { weapons:['杖', '短剣', '投擲', '宝珠'], kind:'mag',  desc:'相手を弱らせ、じわじわと追い詰める' },
  僧侶:     { weapons:['鈍器', '杖', '書', '宝珠'], kind:'mag',  desc:'回復と守りで粘り強く戦い、攻撃もこなす' },
  薬師:     { weapons:['短剣', '投擲', '書'],     kind:'mag',  desc:'回復や強化で自分を支えつつ、相手を削る' },
}
export const START_CLASSES = Object.keys(CLASS_INFO)

// ===== 一次職（2026-10-10 ユーザーの表「一次職スキル一覧」）=====
// base … 系統の初期職（そのClassLV30で就ける・武器と通常攻撃もその初期職と同じ＝ユーザー決定）
// desc … 神殿で出す特徴（スキル名・ステータス名を書かず特徴だけ＝2026-10-11 ユーザー指示。前はユーザーの表の各職の最初の一文）
// ★剣士系の一次職はユーザーがあとで足す（2026-10-10「わすれた、あと追加するから先に他のやつ進めて」）
export const ICHIJI_REQ_JLV = 30
export const ICHIJI_INFO = {
  狂戦士:   { base:'戦士',     desc:'傷を負うほど強くなる、短期決戦の攻撃型' },
  重戦士:   { base:'戦士',     desc:'受けた痛みを力に変える、長期戦の守り手' },
  竜騎士:   { base:'槍使い',   desc:'空へ跳んで攻撃をかわし、急降下で大きく攻める' },
  槍術士:   { base:'槍使い',   desc:'攻撃を重ねるほど鋭さが増す連撃型' },
  体術師:   { base:'格闘家',   desc:'かわして反撃する、回避と反撃の技巧派' },
  気功師:   { base:'格闘家',   desc:'力を溜めて一気に解き放つ、溜めと解放の使い手' },
  暗殺者:   { base:'盗賊',     desc:'急所を狙い、傷を重ねて一気に仕留める' },
  忍者:     { base:'盗賊',     desc:'手数と身のこなしで相手を翻弄する' },
  狩人:     { base:'弓使い',   desc:'罠を仕掛け、獲物をじわじわと追い詰める' },
  狙撃手:   { base:'弓使い',   desc:'狙いすました重い一撃で仕留める射手' },
  魔銃士:   { base:'銃士',     desc:'弾に属性の力を込め、撃ち分けて戦う' },
  砲撃士:   { base:'銃士',     desc:'力を溜めて、重い砲撃を放つ' },
  魔導士:   { base:'魔法使い', desc:'時間をかけて力を高め、強大な魔法を放つ' },
  時魔導士: { base:'魔法使い', desc:'時の流れを操り、手数で圧倒する' },
  死霊術師: { base:'呪術師',   desc:'死者を呼び出し、数の力で押し切る' },
  陰陽師:   { base:'呪術師',   desc:'札と式神で、場を支配して戦う' },
  司祭:     { base:'僧侶',     desc:'倒れずに祈り続ける、持久戦の要' },
  祓魔師:   { base:'僧侶',     desc:'魔を祓い、相手の力を封じる' },
  錬金術師: { base:'薬師',     desc:'調合した薬品を燃やし、爆発させて戦う' },
  霊薬師:   { base:'薬師',     desc:'薬を重ねるほど、後半に強くなる' },
}
export const ICHIJI_CLASSES = Object.keys(ICHIJI_INFO)
export const CLASSES = [
  ...START_CLASSES.map((id, i) => ({ id, stage:'shoki', sort: i, req: null, ...CLASS_INFO[id] })),
  ...ICHIJI_CLASSES.map((id, i) => {
    const { base, desc } = ICHIJI_INFO[id]
    return { id, stage:'ichiji', sort: START_CLASSES.length + i, req: { cls: base, jlv: ICHIJI_REQ_JLV },
      weapons: CLASS_INFO[base].weapons, kind: CLASS_INFO[base].kind, desc }
  }),
]
export const CLASS_BY_ID = Object.fromEntries(CLASSES.map(c => [c.id, c]))
export const stageOf = (cls) => CLASS_BY_ID[cls]?.stage || null
// その職業のClassLVの上限（初期職30・一次職50）
export const jobMaxOf = (cls) => jobMaxOfStage(stageOf(cls))
// その初期職から就ける一次職（神殿の並び用）
export const nextClassesOf = (cls) => CLASSES.filter(c => c.req?.cls === cls).map(c => c.id)
export const stageLabelOf = (cls) => STAGES[stageOf(cls)]?.label || ''
export const stageColorOf = (cls) => STAGES[stageOf(cls)]?.color || '#88ccff'
export const weaponsOf = (cls) => CLASS_BY_ID[cls]?.weapons || []
export const attackKindOf = (cls) => CLASS_BY_ID[cls]?.kind || 'phys'
export const classDescOf = (cls) => CLASS_BY_ID[cls]?.desc || ''
// その職業がその武器の種類を装備できるか
export const canEquipType = (cls, type) => weaponsOf(cls).includes(type)

// ===== 必要ClassEXP =====
// ClassLV² に比例。初期職は ClassLV30 まで**約2週間**（1日1時間・ユーザー決定「2週間くらい」）。
//   係数は tools/v2cap-progress.mjs --tune で回して決める
//   （2026-10-09 エリアの作り替えで1体のEXPが約1/4になったので測り直した。前は12.3）
// ⚠係数は10分率の整数で掛けてから10で割る（SQLの v2cap_job_need と同じ形）
// ★let なのは tools/v2cap-progress.mjs --tune が回しながら差し替えるため（ゲームの中では変えない）
export let JOB_NEED_TENTHS = 44
export const setJobNeedForTuning = (v) => { JOB_NEED_TENTHS = v }
export const jobNeed = (stage, jlv) =>
  (jlv >= jobMaxOfStage(stage) ? 0 : Math.max(1, Math.round(JOB_NEED_TENTHS * (STAGES[stage]?.mult || 1) * jlv * jlv / 10)))
export const jobTotalTo = (stage, jlv) => {
  let t = 0
  for (let j = 1; j < Math.min(jlv, jobMaxOfStage(stage)); j++) t += jobNeed(stage, j)
  return t
}

// 職業ごとのClassLV。jobs = { "戦士": { lv: 12, exp: 345 } }。まだ就いたことが無ければ1
export const jobOf = (jobs, cls) => ({ lv: jobs?.[cls]?.lv || 1, exp: jobs?.[cls]?.exp || 0 })

// ===== ステ（クラスのステ）=====
// 【確定】2026-10-09 ユーザー指示：LVアップでステが上がらなくなったぶん、**ClassLVが1上がるごとに5点**（ClassLV30で145点）。
//   2026-10-10 さらに、ClassLVが上がるたびに必ずHPとMPが上がるようにした（下の JOB_LV_HPMP・点数とは別）。
//   配分は「その職業に要らないステは極力上げないが、尖りすぎないように2〜3種が高く、ほかは少し低め」。
//   1点＝戦闘力1（HPなら+8・MPなら+3・ほかは+1）。効くのはその職業でいるあいだだけ。
// 職業ごとの配分（合計145＝ClassLV30までの点数）。説明文（CLASS_INFO.desc）の「◯◯が伸びる」と合わせてある
export const JOB_BONUS = {
  戦士:     { str:40, vit:32, hp:28, dex:15, agi:15, mp:10, luk:5 },         // STR・VIT・HP
  槍使い:   { str:40, dex:35, agi:22, vit:18, hp:15, mp:10, luk:5 },         // STR・DEX（＋AGI）
  格闘家:   { str:40, agi:38, hp:22, vit:18, dex:12, mp:10, luk:5 },         // STR・AGI（＋HP）
  盗賊:     { agi:42, str:32, dex:25, luk:18, hp:12, vit:8, mp:8 },          // AGI・STR（＋DEX）
  弓使い:   { agi:40, dex:35, str:30, luk:12, hp:12, vit:8, mp:8 },          // AGI・DEX・STR
  銃士:     { dex:45, agi:30, str:25, luk:15, hp:12, mp:10, vit:8 },         // DEX・AGI（＋STR）
  剣士:     { str:40, dex:32, agi:30, vit:15, hp:13, mp:10, luk:5 },         // STR・DEX・AGI
  魔法使い: { int_stat:45, mp:30, agi:25, dex:15, hp:15, vit:10, luk:5 },    // INT・MP（＋AGI）
  呪術師:   { int_stat:42, mp:30, dex:20, luk:18, agi:15, hp:12, vit:8 },    // INT・MP（＋DEX・LUK）
  僧侶:     { int_stat:38, vit:30, hp:28, mp:25, agi:12, dex:7, luk:5 },     // INT・VIT・HP
  薬師:     { int_stat:38, dex:30, mp:25, hp:22, agi:15, vit:10, luk:5 },    // INT・DEX（＋MP）
  // 一次職（合計294＝ClassLV50までの点数・ClassLV1ごとに6点）。2026-10-10 ユーザー承認の配分。
  //   高い2〜3種（61点以上）はその職の技で使うステ
  狂戦士:   { str:85, hp:70, agi:50, vit:34, dex:30, mp:15, luk:10 },
  重戦士:   { vit:85, str:65, hp:65, dex:30, agi:24, mp:15, luk:10 },
  竜騎士:   { str:80, vit:62, dex:50, agi:42, hp:35, mp:15, luk:10 },
  槍術士:   { str:75, agi:66, dex:62, vit:34, hp:30, mp:17, luk:10 },
  体術師:   { agi:85, str:70, dex:45, hp:34, vit:30, mp:15, luk:15 },
  気功師:   { str:75, dex:68, vit:45, agi:40, hp:36, mp:20, luk:10 },
  暗殺者:   { agi:85, str:65, luk:45, dex:40, hp:30, vit:15, mp:14 },
  忍者:     { agi:85, dex:64, str:55, luk:30, hp:30, vit:15, mp:15 },
  狩人:     { dex:75, agi:66, str:55, luk:34, hp:30, vit:18, mp:16 },
  狙撃手:   { dex:85, luk:62, agi:55, str:40, hp:24, vit:14, mp:14 },
  魔銃士:   { str:70, int_stat:70, dex:50, agi:40, mp:30, hp:24, vit:10 },
  砲撃士:   { dex:85, str:65, vit:45, hp:34, agi:30, mp:20, luk:15 },
  魔導士:   { int_stat:95, mp:70, agi:40, dex:30, hp:30, vit:19, luk:10 },
  時魔導士: { int_stat:85, agi:75, mp:50, hp:30, dex:25, vit:19, luk:10 },
  死霊術師: { int_stat:88, mp:65, vit:40, hp:40, dex:25, agi:21, luk:15 },
  陰陽師:   { int_stat:85, mp:62, dex:50, agi:35, hp:30, vit:17, luk:15 },
  司祭:     { int_stat:75, hp:70, vit:65, mp:45, agi:20, dex:10, luk:9 },
  祓魔師:   { int_stat:85, mp:62, agi:45, vit:40, hp:35, dex:17, luk:10 },
  錬金術師: { int_stat:85, dex:65, mp:50, hp:34, agi:30, vit:20, luk:10 },
  霊薬師:   { int_stat:80, mp:62, vit:50, hp:45, dex:25, agi:22, luk:10 },
}

// 【確定】2026-10-10 ユーザー指示「レベルアップするとき、HPとMPは絶対あげるようにしてほしい、クラスによって差があってもいいから」＋案を承認：
//   ClassLVが1上がるたびに、上の点数（初期職5点・一次職6点）とは**別に**、必ずHPとMPが上がる（その職業でいるあいだだけ）。
//   量は、今の配分（JOB_BONUS）でHP・MPを多くもらっている職業ほど多い
//   （初期職 HP 8／6／4・MP 3／1、一次職 HP 10／8／6・MP 4／3／2）
// ★SQLの v2cap_classes.lv_hp・lv_mp はこの表を写したもの（tools/v2cap-sql.mjs が作る）。
//   サーバーが数えるのはMPだけ（スキル編成の最大MP＝ v2cap_job_bonus_mp）
export const JOB_LV_HPMP = {
  戦士:     { hp:8, mp:1 },
  槍使い:   { hp:6, mp:1 },
  格闘家:   { hp:8, mp:1 },
  盗賊:     { hp:4, mp:1 },
  弓使い:   { hp:4, mp:1 },
  銃士:     { hp:4, mp:1 },
  剣士:     { hp:6, mp:1 },
  魔法使い: { hp:6, mp:3 },
  呪術師:   { hp:4, mp:3 },
  僧侶:     { hp:8, mp:3 },
  薬師:     { hp:8, mp:3 },
  狂戦士:   { hp:10, mp:2 },
  重戦士:   { hp:10, mp:2 },
  竜騎士:   { hp:8, mp:2 },
  槍術士:   { hp:6, mp:2 },
  体術師:   { hp:8, mp:2 },
  気功師:   { hp:8, mp:3 },
  暗殺者:   { hp:6, mp:2 },
  忍者:     { hp:6, mp:2 },
  狩人:     { hp:6, mp:2 },
  狙撃手:   { hp:6, mp:2 },
  魔銃士:   { hp:6, mp:3 },
  砲撃士:   { hp:8, mp:3 },
  魔導士:   { hp:6, mp:4 },
  時魔導士: { hp:6, mp:4 },
  死霊術師: { hp:8, mp:4 },
  陰陽師:   { hp:6, mp:4 },
  司祭:     { hp:10, mp:4 },
  祓魔師:   { hp:8, mp:4 },
  錬金術師: { hp:8, mp:4 },
  霊薬師:   { hp:10, mp:4 },
}

// 配分を「何点目にどのステが上がるか」の並びにする（ランダムではなく固定）。
// 1点ずつ「配分に対して一番遅れているステ」を選ぶ＝どのClassLVで止めても配分どおりに近い。
// 同点はステの並び（STAT_KEYS）の先を取る。★SQLの v2cap_classes.bonus_seq はこの出力を写したもの
export const bonusSeqOf = (cls) => {
  const w = JOB_BONUS[cls] || {}
  const total = Object.values(w).reduce((a, b) => a + b, 0)
  const got = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  const seq = []
  for (let i = 1; i <= total; i++) {
    let best = null
    let bestLag = -Infinity
    for (const k of STAT_KEYS) {
      if (!w[k] || got[k] >= w[k]) continue
      const lag = (w[k] * i) / total - got[k]
      if (lag > bestLag + 1e-9) { best = k; bestLag = lag }
    }
    got[best] += 1
    seq.push(best)
  }
  return seq
}
const SEQ_CACHE = {}
const seqOf = (cls) => (SEQ_CACHE[cls] ||= bonusSeqOf(cls))

// そのClassLVまでに上がった回数（ClassLV1は0回・上限より上は増えない）
export const jobLevelsGained = (cls, jlv) => Math.max(0, Math.min(jobMaxOf(cls), jlv || 1) - 1)
// その職業のそのClassLVで入っている点数（戦闘力換算）。毎回のHP・MP（JOB_LV_HPMP）は入れない
export const bonusPointsAt = (cls, jlv) => jobLevelsGained(cls, jlv) * (STAGES[stageOf(cls)]?.perLv || 0)

// ステの値に直したもの（HPなら1点＝+8・MPなら+3・ほかは+1）＋ 毎回のHP・MP × 上がった回数
export const jobBonusStats = (cls, jlv) => {
  const out = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  for (const k of seqOf(cls).slice(0, bonusPointsAt(cls, jlv))) out[k] += STAT_DEFS[k].unit
  const n = jobLevelsGained(cls, jlv)
  out.hp += n * (JOB_LV_HPMP[cls]?.hp || 0)
  out.mp += n * (JOB_LV_HPMP[cls]?.mp || 0)
  return out
}
// 上がりやすいステータス（神殿に出す）。配分の高い2〜3種＝初期職30点以上・一次職61点以上（多い順のキー）
// ★「高い2〜3種」の決まりは v2cap.test.js が見張っている（2026-10-09 ユーザー指示「2種～3種が高く」）
export const MAIN_STAT_MIN = { shoki: 30, ichiji: 61 }
export const mainStatsOf = (cls) => Object.entries(JOB_BONUS[cls] || {})
  .filter(([, v]) => v >= (MAIN_STAT_MIN[stageOf(cls)] ?? Infinity))
  .sort((a, b) => b[1] - a[1])
  .map(([k]) => k)
// 表示用。「STR+12・VIT+7」のように多い順
export const jobBonusText = (cls, jlv) => {
  const s = jobBonusStats(cls, jlv)
  return STAT_KEYS.filter(k => s[k] > 0).sort((a, b) => s[b] / STAT_DEFS[b].unit - s[a] / STAT_DEFS[a].unit)
    .map(k => `${STAT_DEFS[k].label}+${s[k]}`).join('・')
}

// ===== スキル =====
// 覚える順＝この版のスキルの名簿の順（skills.js）
export const learnOrderOf = (cls) => skillsOf(cls)
export const learnAtOf = (cls) => STAGES[stageOf(cls)]?.learnAt || []
// そのClassLVまでに覚えるスキル（名前の配列）
export const skillsLearnedBy = (cls, jlv) => {
  const at = learnAtOf(cls)
  return learnOrderOf(cls).filter((_, i) => at[i] !== undefined && at[i] <= (jlv || 1)).map(s => s.name)
}
// 次に覚えるスキルとそのClassLV（無ければ null）
export const nextSkillOf = (cls, jlv) => {
  const at = learnAtOf(cls)
  const list = learnOrderOf(cls)
  for (let i = 0; i < list.length; i++) if (at[i] > (jlv || 1)) return { skill: list[i], jlv: at[i] }
  return null
}

// ===== その職業で使えるスキル =====
// 【確定】スキルは**その職業でだけ使える**。**上位職は下位職のスキルをそのまま使える**（効果も消費MPも同じ）
//   （2026-10-09 ユーザー決定。今のⅡの「他職は0.8倍・MP2倍で使える」はやめた）
// 下位職＝就く条件（req）の職業をさかのぼったもの。先頭が自分＝[自分, 下位職, その下位職, …]
// ★一次職は [自分, 系統の初期職]（2026-10-10 一次職を入れた）。
//   サーバーの v2cap_classes.lineage はこの出力を写したもの（tools/v2cap-sql.mjs が作る）
export const lineageOf = (cls, byId = CLASS_BY_ID) => {
  const out = []
  for (let c = cls; c && byId[c] && !out.includes(c); c = byId[c].req?.cls) out.push(c)
  return out
}
// その職業で枠に置ける技（覚えたもの・パッシブ以外）の名前。並び＝名簿の順
export const usableSkillNames = (cls, learned = [], lineage = lineageOf(cls)) => {
  const have = new Set(learned)
  return SKILLS.filter(s => lineage.includes(s.cls) && !isPassive(s) && have.has(s.name)).map(s => s.name)
}

// ===== 就けるか =====
// 初期職は条件なし。一次職は req（{ cls: 系統の初期職, jlv: 30 }）
//   （req の職業が「下位職」になり、そのスキルも使えるようになる＝ lineageOf）
export const reqOf = (cls) => CLASS_BY_ID[cls]?.req || null
export const missingReqOf = (cls, jobs) => {
  const r = reqOf(cls)
  if (!r) return null
  const have = jobOf(jobs, r.cls).lv
  return have >= r.jlv ? null : `${r.cls}のClassLV${r.jlv}（いま${have}）`
}
export const canBecome = (cls, jobs) => !!CLASS_BY_ID[cls] && !missingReqOf(cls, jobs)
export const reqText = (cls) => {
  const r = reqOf(cls)
  return r ? `${r.cls}のClassLV${r.jlv}` : '条件なし'
}

// ===== ClassEXPを入れる（純関数・表示とシミュレーション用）=====
// jobs を書き換えず新しいオブジェクトを返す。learned は今回新しく覚えたスキル名
export const applyJobExp = (jobs, cls, amount, known = []) => {
  const stage = stageOf(cls)
  const max = jobMaxOf(cls)
  const cur = jobOf(jobs, cls)
  let { lv, exp } = cur
  const ups = []
  if (stage && lv < max && amount > 0) {
    exp += amount
    while (lv < max && exp >= jobNeed(stage, lv)) {
      exp -= jobNeed(stage, lv)
      lv += 1
      ups.push(lv)
    }
    if (lv >= max) exp = 0
  }
  const have = new Set(known)
  const learned = skillsLearnedBy(cls, lv).filter(n => !have.has(n))
  return { jobs: { ...(jobs || {}), [cls]: { lv, exp } }, lv, exp, ups, learned }
}
