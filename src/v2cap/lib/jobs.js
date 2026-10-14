// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 職業とクラスLV（ClassLV）
// ------------------------------------------------------------
// 設計は docs/v2cap-design.md §4・§11。ユーザー決定（2026-10-09）：
//   ・クラスLV（表記は **ClassLV**）は**職業ごと**に持ち、戻れば続きから。上限は初期職30・上位職50（段階ごと＝STAGES の max）
//   ・入るのは**いまの職業**のClassLVだけ（その戦闘で入ったEXPと同じ量）
//   ・ClassLVが上がると、スキルを覚える／ステが上がる（ステは職業ごとに決まっていて、その職業の間だけ）
//   ・職業補正（今のⅡの STR+5% など）は**一旦なし**
//   ・**初期職は11職**（2026-10-09 に剣士を足した）。職業ごとに**装備できる武器は3種**決まっている
//     （2026-10-11 ユーザー指示「クラスごとに装備できる武器種は3つまでに」で、4種だった5職から1種ずつ外した）
//   ・ノーブル・サモナーはなくす
//   ・**上位職は20職**（2026-10-10 ユーザーの表「一次職スキル一覧」・初期職10系統に2職ずつ。剣士系はあとで足す）。
//     系統の初期職がClassLV30で就ける／ClassLV上限50／必要ClassEXPは初期職の3倍／ステはClassLV1ごとに6点
//     （ClassLV30で初期職の1.2倍）／武器は系統の初期職と同じ（どれもユーザー決定）。二次・三次はこれから
//   ・スキルは**その職業でだけ使える**。**上位職は下位職のスキルをそのまま使える**（lineageOf）
//
// ★権威はサーバー（supabase_v2cap_core.sql の v2cap_classes / v2cap_job_need / v2cap_apply_exp）。
//   ここは表示とシミュレーション用の写し。v2capsql.test.js が突き合わせる。
// ============================================================
import { STAT_KEYS, STAT_DEFS } from '../../v2/lib/stats.js'
import { SKILLS, skillsOf, isPassive } from './skills.js'

// 初期職のClassLVの上限。上位職は50（STAGES.ichiji.max）。職業ごとの上限は jobMaxOf を使う
export const JOB_MAX = 30

// ===== 段階 =====
// mult … 必要ClassEXPの倍率（上の段階ほど重い）／perLv … ClassLVが1上がるごとのステの量（戦闘力換算）
// learnAt … スキルを覚えるClassLV（並び＝スキルの名簿の順）
// max … ClassLVの上限
// 【確定】2026-10-10 ユーザー決定：上位職は ClassLV上限50・必要ClassEXPは初期職の3倍・ClassLVごとの点数は初期職の1.2倍
//   （効くのは上位職の分だけ）。技は ClassLV1／5／10／15／20／25／30／40 で8つ（ユーザーの表「一次職スキル一覧」）
// 【確定】2026-10-12 ユーザー指示「敵のキャラ弱くするってよりかはこっちが弱すぎる気がする、くらすれべるあがるとき、もっと上昇量伸ばしていい」
//   ＋案「初期クラスは8」・上位職は「10点（初期職の1.2倍のまま）」を選んだ：ClassLVごとの点数を **初期職 5→8・上位職 6→10**
//   （ClassLV30で 145→232・上位職のClassLV50で 294→490。毎回のHP・MP（JOB_LV_HPMP）も1.6倍）
// needBase … 必要ClassEXPに毎回足す量（【確定】2026-10-12 ユーザー指示「クラスレベルも最初の必要量少なすぎ、初期クラスは必要経験値15にして、上位職は30で」
//   ＝ClassLV1→2が初期職15・上位職30。LVの「+20」と同じく、どのClassLVにも足す。下の jobNeed）
// 【確定】2026-10-14 ユーザー承認：初期職も CLASS LV25・30 で1つずつ覚える（技7つ・skills.js の LATE_SKILLS）
// 【確定】2026-10-15 ユーザー指示「一次クラス→上位クラスに文言全修正して」：画面の名前は「上位クラス」（label '上位'）。
//   前の名前は「一次」。コードの中の名前（ichiji・ICHIJI_INFO・skillsIchiji.js など）はそのまま
export const STAGES = {
  shoki:  { label:'初期', color:'#44aaff', mult:1, perLv:8, max:JOB_MAX, learnAt:[1, 5, 10, 15, 20, 25, 30], needBase:15 },
  ichiji: { label:'上位', color:'#cc66ff', mult:3, perLv:10, max:50, learnAt:[1, 5, 10, 15, 20, 25, 30, 40], needBase:30 },
}
export const STAGE_ORDER = ['shoki', 'ichiji']
export const jobMaxOfStage = (stage) => STAGES[stage]?.max || JOB_MAX

// ===== 職業 =====
// weapons … 装備できる武器の種類（3つまで）／kind … 通常攻撃が物理（STR）か魔法（INT）か
//   【確定】2026-10-11 ユーザー指示「やっぱクラスごとに装備できる武器種は3つまでに」：
//   戦士から刀・盗賊から片手剣・魔法使いから短剣・呪術師から投擲・僧侶から宝珠を外した
// desc … キャラ作成と神殿で出す特徴の説明。【確定】2026-10-11 ユーザー指示「説明文は具体的なスキル名やステータス名を記載しないで、
//        どういった特徴があるのかだけを簡単にまとめて」（2026-10-09 承認の文面から書き直した。v2cap.test.js が見張る）
// ★並び＝キャラ作成と神殿の並び。【確定】2026-10-11 ユーザー指示「剣士の位置は一番上にして」で剣士を先頭にした
export const CLASS_INFO = {
  // 【確定】2026-10-09 ユーザー決定（剣士を足す・武器は刀・片手剣・両手剣・ステはSTR・DEX・AGI・説明文と技は承認済み）
  剣士:     { weapons:['刀', '片手剣', '両手剣'], kind:'phys', desc:'鋭い剣さばきで、攻めと身のこなしを両立する' },
  戦士:     { weapons:['両手剣', '斧', '鈍器'], kind:'phys', desc:'打たれ強さを活かし、正面から重い一撃を叩き込む前衛' },
  槍使い:   { weapons:['槍', '片手剣', '投擲'],   kind:'phys', desc:'攻めと守りのバランスがよく、着実に相手を削っていく' },
  格闘家:   { weapons:['拳', '鈍器', '杖'],       kind:'phys', desc:'すばやい連続攻撃で一気に畳みかける近接型' },
  盗賊:     { weapons:['短剣', '投擲', '刀'], kind:'phys', desc:'身軽に動き回り、相手を乱しながら戦うアタッカー' },
  弓使い:   { weapons:['弓', '短剣', '片手剣'],   kind:'phys', desc:'離れた位置から、狙いを外さない射撃で戦う' },
  銃士:     { weapons:['銃', '片手剣', '投擲'],   kind:'phys', desc:'正確な射撃で、守りの固い相手も撃ち抜く' },
  魔法使い: { weapons:['杖', '書', '宝珠'],     kind:'mag',  desc:'さまざまな攻撃魔法を使い分け、大きな一撃を狙う' },
  呪術師:   { weapons:['杖', '短剣', '宝珠'],   kind:'mag',  desc:'相手を弱らせ、じわじわと追い詰める' },
  僧侶:     { weapons:['鈍器', '杖', '書'],     kind:'mag',  desc:'回復と守りで粘り強く戦い、攻撃もこなす' },
  薬師:     { weapons:['短剣', '投擲', '書'],     kind:'mag',  desc:'回復や強化で自分を支えつつ、相手を削る' },
}
export const START_CLASSES = Object.keys(CLASS_INFO)

// ===== 上位職（2026-10-10 ユーザーの表「一次職スキル一覧」）=====
// base … 系統の初期職（そのClassLV30で就ける・武器と通常攻撃もその初期職と同じ＝ユーザー決定）
// desc … 神殿で出す特徴（スキル名・ステータス名を書かず特徴だけ＝2026-10-11 ユーザー指示。前はユーザーの表の各職の最初の一文）
// ★剣士系の上位職はユーザーがあとで足す（2026-10-10「わすれた、あと追加するから先に他のやつ進めて」）
export const ICHIJI_REQ_JLV = 30
// 【確定】2026-10-14 ユーザー承認：上位職の並び替え（22職）。V1の職業を続投し（「V1にある職業は続投させたい」）、
//   横文字の名前も入れた（「漢字ばっかりだから、横文字もいくつか」）。技は skillsIchiji.js
//   ・剣士系を足した：侍・魔法剣士（どちらもV1）
//   ・入れ替え：重戦士→聖騎士・気功師→サイキッカー（どちらもV1）
//   ・名前だけ変えた：槍術士→ストームランサー・狙撃手→アークアーチャー・砲撃士→デストロイヤー・魔導士→元素使い・
//     時魔導士→クロノマンサー・死霊術師→死霊使い・陰陽師→式神使い・司祭→聖職者・祓魔師→異端審問官・錬金術師→アルケミスト
//   ・V1の賢者・ギャンブラー・精霊召喚士・ブリーダーは入れない（ユーザー決定）
export const ICHIJI_INFO = {
  侍:             { base:'剣士',     desc:'鞘に納めて力を溜め、抜き打ちの一太刀で斬り崩す' },
  魔法剣士:       { base:'剣士',     desc:'剣と魔法を交互に振るい、切り替えるほど強くなる' },
  狂戦士:         { base:'戦士',     desc:'傷を負うほど強くなる、短期決戦の攻撃型' },
  聖騎士:         { base:'戦士',     desc:'聖なる守りで身を固め、打たれ強さをそのまま攻めに変える' },
  竜騎士:         { base:'槍使い',   desc:'空へ跳んで攻撃をかわし、急降下で大きく攻める' },
  ストームランサー: { base:'槍使い',   desc:'攻撃を重ねるほど鋭さが増す連撃型' },
  体術師:         { base:'格闘家',   desc:'かわして反撃する、回避と反撃の技巧派' },
  サイキッカー:   { base:'格闘家',   desc:'念の力で心を乱し、物理と魔法の両方で押し切る' },
  暗殺者:         { base:'盗賊',     desc:'急所を狙い、傷を重ねて一気に仕留める' },
  忍者:           { base:'盗賊',     desc:'手数と身のこなしで相手を翻弄する' },
  狩人:           { base:'弓使い',   desc:'罠を仕掛け、獲物をじわじわと追い詰める' },
  アークアーチャー: { base:'弓使い',   desc:'狙いすました重い一撃で仕留める射手' },
  魔銃士:         { base:'銃士',     desc:'弾に属性の力を込め、撃ち分けて戦う' },
  デストロイヤー: { base:'銃士',     desc:'力を溜めて、重い砲撃を放つ' },
  元素使い:       { base:'魔法使い', desc:'属性を使い分け、力を高めた大きな魔法を放つ' },
  クロノマンサー: { base:'魔法使い', desc:'時の流れを操り、手数で圧倒する' },
  死霊使い:       { base:'呪術師',   desc:'死者を呼び出し、数の力で押し切る' },
  式神使い:       { base:'呪術師',   desc:'札と式神で、場を支配して戦う' },
  聖職者:         { base:'僧侶',     desc:'倒れずに祈り続ける、持久戦の要' },
  異端審問官:     { base:'僧侶',     desc:'魔を祓い、相手の力を封じる' },
  アルケミスト:   { base:'薬師',     desc:'調合した薬品を燃やし、爆発させて戦う' },
  霊薬師:         { base:'薬師',     desc:'薬を重ねるほど、後半に強くなる' },
}
// 前の名前 → 今の名前（2026-10-14 の並び替え。SQLの一度だけの移し替えと、古い保存を読むときに使う）
export const ICHIJI_RENAMED = {
  槍術士:'ストームランサー', 狙撃手:'アークアーチャー', 砲撃士:'デストロイヤー', 魔導士:'元素使い', 時魔導士:'クロノマンサー',
  死霊術師:'死霊使い', 陰陽師:'式神使い', 司祭:'聖職者', 祓魔師:'異端審問官', 錬金術師:'アルケミスト',
  重戦士:'聖騎士', 気功師:'サイキッカー',
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
// その職業のClassLVの上限（初期職30・上位職50）
export const jobMaxOf = (cls) => jobMaxOfStage(stageOf(cls))
// その初期職から就ける上位職（神殿の並び用）
export const nextClassesOf = (cls) => CLASSES.filter(c => c.req?.cls === cls).map(c => c.id)
export const stageLabelOf = (cls) => STAGES[stageOf(cls)]?.label || ''
export const stageColorOf = (cls) => STAGES[stageOf(cls)]?.color || '#88ccff'
export const weaponsOf = (cls) => CLASS_BY_ID[cls]?.weapons || []
export const attackKindOf = (cls) => CLASS_BY_ID[cls]?.kind || 'phys'
export const classDescOf = (cls) => CLASS_BY_ID[cls]?.desc || ''
// その職業がその武器の種類を装備できるか
export const canEquipType = (cls, type) => weaponsOf(cls).includes(type)

// ===== 必要ClassEXP =====
// 【確定】2026-10-12 ユーザー指示「通常のレベルよりもクラスレベルのほうが上がりやすくして」→案から「LVの5割」を選んだ：
//   ClassLV◯→◯+1 の必要ClassEXP ＝ そのときのLVの式（係数0.135 × LV³）の **5割** × 段階の倍率（上位職3倍）。
//   前は「係数4.4 × ClassLV²」（ClassLV30がLV33＝LVより遅れていた。tools/v2cap-progress.mjs --tune で決めていた）
//   ⚠今いるキャラは SQL の一度だけの数え直し（印 job_need_half_lv_20261012）で、ためたClassEXPの合計からClassLVを数え直した
// 【確定】同じ日にユーザー指示「通常のレベルはもう少しレベル上げにくくていい」でLVだけ重くした（level.js の needExp＝20＋0.162×LV³）。
//   ClassLVの係数は135（そのときのLVの係数）で固定し、LVの係数（NEED_PERMIL）とは切り離した。
// 【確定】さらに同じ日にユーザー指示「クラスレベルも最初の必要量少なすぎ、初期クラスは必要経験値15にして、上位職は30で」：
//   **段階ごとの量（STAGES の needBase＝初期職15・上位職30）を毎回足す**（LVの「+20」と同じ形）。
//   ＝ 必要ClassEXP ＝ needBase ＋ 0.135×ClassLV³ の5割 × 段階の倍率。ClassLV1→2が初期職15・上位職30（前はどちらも1）。
//   最初の職業でも、ClassLVはLVと同じか先に上がる（LV10でClassLV12・LV20で24・ClassLV30はLV24ごろ）
// ⚠「needBase×100000 ＋ 係数135 × 割合（%）× 倍率 × ClassLV³」を整数で出してから100000で割る（SQLの v2cap_job_need と同じ形・端数の丸めをそろえる）
// ★let なのは tools/v2cap-progress.mjs が試しに差し替えるため（ゲームの中では変えない）
export const JOB_NEED_BASE_PERMIL = 135
export let JOB_NEED_PCT = 50
export const setJobNeedPctForTuning = (v) => { JOB_NEED_PCT = v }
export const jobNeed = (stage, jlv) =>
  (jlv >= jobMaxOfStage(stage) ? 0 : Math.max(1, Math.round(
    ((STAGES[stage]?.needBase || 0) * 100000 + JOB_NEED_BASE_PERMIL * JOB_NEED_PCT * (STAGES[stage]?.mult || 1) * jlv * jlv * jlv) / 100000)))
export const jobTotalTo = (stage, jlv) => {
  let t = 0
  for (let j = 1; j < Math.min(jlv, jobMaxOfStage(stage)); j++) t += jobNeed(stage, j)
  return t
}

// 職業ごとのClassLV。jobs = { "戦士": { lv: 12, exp: 345 } }。まだ就いたことが無ければ1
export const jobOf = (jobs, cls) => ({ lv: jobs?.[cls]?.lv || 1, exp: jobs?.[cls]?.exp || 0 })

// ===== ステ（クラスのステ）=====
// 【確定】2026-10-09 ユーザー指示：LVアップでステが上がらなくなったぶん、**ClassLVが上がるごとにクラスのステが入る**。
//   2026-10-10 さらに、ClassLVが上がるたびに必ずHPとMPが上がるようにした（下の JOB_LV_HPMP・点数とは別）。
//   配分は「その職業に要らないステは極力上げないが、尖りすぎないように2〜3種が高く、ほかは少し低め」。
//   1点＝戦闘力1（HPなら+8・MPなら+3・ほかは+1）。効くのはその職業でいるあいだだけ。
//   【確定】2026-10-12 ClassLVごとの点数を 初期職 5→8・上位職 6→10 にした（ユーザー指示・上の STAGES）。
//   配分の割合は承認ずみのまま、合計を 初期職 145→232・上位職 294→490 に伸ばした（端数は最大剰余で合わせた）
// 職業ごとの配分（合計232＝ClassLV30までの点数）。説明文（CLASS_INFO.desc）の「◯◯が伸びる」と合わせてある
export const JOB_BONUS = {
  戦士:     { str:64, vit:51, hp:45, dex:24, agi:24, mp:16, luk:8 },         // STR・VIT・HP
  // 【確定】2026-10-14 ユーザー承認：槍使い・剣士はHPが低く、ボス戦で平均の約9割・対人で2〜3割だった＝DEX・AGIからVIT・HPへ（合計232のまま）
  槍使い:   { str:64, dex:50, vit:38, agi:30, hp:26, mp:16, luk:8 },         // STR・DEX（＋VIT）
  格闘家:   { str:64, agi:61, hp:35, vit:29, dex:19, mp:16, luk:8 },         // STR・AGI（＋HP）
  盗賊:     { agi:67, str:51, dex:40, luk:29, hp:19, vit:13, mp:13 },        // AGI・STR（＋DEX）
  弓使い:   { agi:64, dex:56, str:48, hp:19, luk:19, vit:13, mp:13 },        // AGI・DEX・STR
  銃士:     { dex:72, agi:48, str:40, luk:24, hp:19, mp:16, vit:13 },        // DEX・AGI（＋STR）
  //   剣士は案の DEX45・AGI42 だと「高い2〜3種」（48点以上）が STR だけになるので DEX48・AGI39 にした
  剣士:     { str:64, dex:48, agi:39, vit:30, hp:27, mp:16, luk:8 },         // STR・DEX（＋AGI）
  魔法使い: { int_stat:72, mp:48, agi:40, dex:24, hp:24, vit:16, luk:8 },    // INT・MP（＋AGI）
  呪術師:   { int_stat:67, mp:48, dex:32, luk:29, agi:24, hp:19, vit:13 },   // INT・MP（＋DEX・LUK）
  僧侶:     { int_stat:61, vit:48, hp:45, mp:40, agi:19, dex:11, luk:8 },    // INT・VIT・HP
  薬師:     { int_stat:61, dex:48, mp:40, hp:35, agi:24, vit:16, luk:8 },    // INT・DEX（＋MP）
  // 上位職（合計490＝ClassLV50までの点数・ClassLVごとに10点）。2026-10-10 ユーザー承認の配分（の割合）。
  //   高い2〜3種（102点以上）はその職の技で使うステ
  //   2026-10-14 ユーザー承認の並び替え：新しく入った4職の配分はこちらの案（高い2〜3種が102点以上・LUKも少し入れる＝LUKが0だと相手のクリティカルが上限になる）
  侍:             { str:142, dex:125, agi:75, hp:50, vit:40, mp:33, luk:25 },
  魔法剣士:       { str:133, int_stat:125, agi:67, mp:58, hp:50, vit:40, luk:17 },
  狂戦士:         { str:141, hp:117, agi:83, vit:57, dex:50, mp:25, luk:17 },
  聖騎士:         { vit:140, str:120, hp:100, int_stat:50, mp:33, luk:25, dex:22 },
  竜騎士:         { str:134, vit:103, dex:83, agi:70, hp:58, mp:25, luk:17 },
  ストームランサー: { str:125, agi:110, dex:103, vit:57, hp:50, mp:28, luk:17 },
  体術師:         { agi:141, str:117, dex:75, hp:57, vit:50, mp:25, luk:25 },
  サイキッカー:   { str:120, int_stat:120, agi:75, dex:45, hp:50, mp:33, vit:25, luk:22 },
  暗殺者:         { agi:142, str:108, luk:75, dex:67, hp:50, vit:25, mp:23 },
  忍者:           { agi:141, dex:107, str:92, hp:50, luk:50, vit:25, mp:25 },
  狩人:           { dex:125, agi:110, str:92, luk:56, hp:50, vit:30, mp:27 },
  アークアーチャー: { dex:142, luk:103, agi:92, str:67, hp:40, vit:23, mp:23 },
  //   魔銃士は 2026-10-14 にHPとLUKを足した（前はHP40・LUK0＝上位職でHPが一番低く、LUK5で相手のクリティカルが上限＝対人の勝率1%だった）。
  //   技は物理と魔法の両方（STRとINTが半分ずつ・ユーザー指示「魔銃士はSTRやINTを半分ずつ参照」）なので、STRとINTは同じ
  魔銃士:         { str:108, int_stat:108, dex:75, hp:66, agi:58, luk:33, mp:25, vit:17 },
  デストロイヤー: { dex:142, str:108, vit:75, hp:57, agi:50, mp:33, luk:25 },
  元素使い:       { int_stat:158, mp:117, agi:67, dex:50, hp:50, vit:32, luk:16 },
  クロノマンサー: { int_stat:141, agi:125, mp:83, hp:50, dex:42, vit:32, luk:17 },
  死霊使い:       { int_stat:146, mp:108, vit:67, hp:67, dex:42, agi:35, luk:25 },
  式神使い:       { int_stat:142, mp:103, dex:83, agi:59, hp:50, vit:28, luk:25 },
  聖職者:         { int_stat:125, hp:117, vit:108, mp:75, agi:33, dex:17, luk:15 },
  異端審問官:     { int_stat:142, mp:103, agi:75, vit:67, hp:58, dex:28, luk:17 },
  アルケミスト:   { int_stat:142, dex:108, mp:83, hp:57, agi:50, vit:33, luk:17 },
  霊薬師:         { int_stat:133, mp:103, vit:83, hp:75, dex:42, agi:37, luk:17 },
}

// 【確定】2026-10-10 ユーザー指示「レベルアップするとき、HPとMPは絶対あげるようにしてほしい、クラスによって差があってもいいから」＋案を承認：
//   ClassLVが1上がるたびに、上の点数（初期職8点・上位職10点）とは**別に**、必ずHPとMPが上がる（その職業でいるあいだだけ）。
//   量は、今の配分（JOB_BONUS）でHP・MPを多くもらっている職業ほど多い
//   【確定】2026-10-12 点数と一緒に1.6倍にした（ユーザー指示「くらすれべるあがるとき、もっと上昇量伸ばしていい」）：
//   初期職 HP 13／10／6・MP 5／2、上位職 HP 16／13／10・MP 6／5／3（前は 初期 HP 8／6／4・MP 3／1、上位 HP 10／8／6・MP 4／3／2）
// ★SQLの v2cap_classes.lv_hp・lv_mp はこの表を写したもの（tools/v2cap-sql.mjs が作る）。
//   サーバーが数えるのはMPだけ（スキル編成の最大MP＝ v2cap_job_bonus_mp）
//   【確定】2026-10-14 ユーザー承認：剣士・槍使いのHP 10→13（戦士・格闘家なみ。HPが低くボス戦・対人とも下だった）
export const JOB_LV_HPMP = {
  戦士:     { hp:13, mp:2 },
  槍使い:   { hp:13, mp:2 },
  格闘家:   { hp:13, mp:2 },
  盗賊:     { hp:6, mp:2 },
  弓使い:   { hp:6, mp:2 },
  銃士:     { hp:6, mp:2 },
  剣士:     { hp:13, mp:2 },
  魔法使い: { hp:10, mp:5 },
  呪術師:   { hp:6, mp:5 },
  僧侶:     { hp:13, mp:5 },
  薬師:     { hp:13, mp:5 },
  侍:             { hp:13, mp:3 },
  魔法剣士:       { hp:13, mp:5 },
  狂戦士:         { hp:16, mp:3 },
  聖騎士:         { hp:16, mp:5 },
  竜騎士:         { hp:13, mp:3 },
  ストームランサー: { hp:10, mp:3 },
  体術師:         { hp:13, mp:3 },
  サイキッカー:   { hp:13, mp:5 },
  暗殺者:         { hp:10, mp:3 },
  忍者:           { hp:10, mp:3 },
  狩人:           { hp:10, mp:3 },
  アークアーチャー: { hp:10, mp:3 },
  魔銃士:         { hp:13, mp:5 },   // 2026-10-14 10→13（HPが一番低かった）
  デストロイヤー: { hp:13, mp:5 },
  元素使い:       { hp:10, mp:6 },
  クロノマンサー: { hp:10, mp:6 },
  死霊使い:       { hp:13, mp:6 },
  式神使い:       { hp:10, mp:6 },
  聖職者:         { hp:16, mp:6 },
  異端審問官:     { hp:13, mp:6 },
  アルケミスト:   { hp:13, mp:6 },
  霊薬師:         { hp:16, mp:6 },
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
// ClassLVが from → to に上がったときに増えたクラスのステ（{ ステ: 量 }）と、その文（「HP+13・MP+2・STR+4」・多い・少ないでなくステの並び順）。
// 【確定】2026-10-12 ユーザー指示「クラスレベルアップしたときはステータスの上昇値も記載すること」＝「CLASS LEVEL UP！」の行に添える
//   （1回で2つ以上上がったときは合計）
export const jobBonusGain = (cls, fromJlv, toJlv) => {
  const a = jobBonusStats(cls, fromJlv), b = jobBonusStats(cls, toJlv)
  return Object.fromEntries(STAT_KEYS.map(k => [k, b[k] - a[k]]))
}
export const jobGainText = (cls, fromJlv, toJlv) => {
  const g = jobBonusGain(cls, fromJlv, toJlv)
  return STAT_KEYS.filter(k => g[k] > 0).map(k => `${STAT_DEFS[k].label}+${g[k]}`).join('・')
}
// サーバーの返事の level（{ jlv: 上がったあとのClassLV, job_ups: 上がった回数 }）から、出撃のログ・宝樹・デイリーミッションに出す2行。
// 【確定】2026-10-12 ユーザー指示「クラスレベル上がるときはこの表記で」：
//   ⭐ CLASS LEVEL UP！盗賊　LV3 → 4
//   （HP+14・MP+5・STR+2・DEX+1・AGI+2・LUK+1）
//   （ユーザーの文は「Lv3 → 4」。表記ルール（docs/notation-rules.md）どおり LV にした）
// 1行目。上がっていなければ ''
export const jobUpHead = (cls, level) => {
  const ups = Math.floor(Number(level?.job_ups) || 0)
  return ups > 0 ? `⭐ CLASS LEVEL UP！${cls}　LV${level.jlv - ups} → ${level.jlv}` : ''
}
// 【確定】2026-10-13 アセンション（ascension.js）：CLASS LVが1上がるごとにAPを1。
//   ユーザーが選んだ「2行目の最後に足す」＝（HP+14・MP+5・STR+2・DEX+1・AP+1）
export const ASC_AP_PER_JLV = 1
// 2行目「（HP+13・MP+2・…・AP+1）」。上がっていなければ ''
export const jobUpNote = (cls, level) => {
  const ups = Math.floor(Number(level?.job_ups) || 0)
  if (ups <= 0) return ''
  return `（${[jobGainText(cls, level.jlv - ups, level.jlv), `AP+${ups * ASC_AP_PER_JLV}`].filter(Boolean).join('・')}）`
}
// 上がりやすいステータス（神殿に出す）。配分の高い2〜3種＝初期職48点以上・上位職102点以上（多い順のキー）
//   （2026-10-12 に点数を1.6倍にしたので、前の30点・61点も同じ割合で上げた＝選ばれるステは前と同じ）
// ★「高い2〜3種」の決まりは v2cap.test.js が見張っている（2026-10-09 ユーザー指示「2種～3種が高く」）
export const MAIN_STAT_MIN = { shoki: 48, ichiji: 102 }
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
// ★上位職は [自分, 系統の初期職]（2026-10-10 上位職を入れた）。
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
// 初期職は条件なし。上位職は req（{ cls: 系統の初期職, jlv: 30 }）
//   （req の職業が「下位職」になり、そのスキルも使えるようになる＝ lineageOf）
export const reqOf = (cls) => CLASS_BY_ID[cls]?.req || null
export const missingReqOf = (cls, jobs) => {
  const r = reqOf(cls)
  if (!r) return null
  const have = jobOf(jobs, r.cls).lv
  return have >= r.jlv ? null : `${r.cls}のCLASS LV${r.jlv}（いま${have}）`
}
export const canBecome = (cls, jobs) => !!CLASS_BY_ID[cls] && !missingReqOf(cls, jobs)
export const reqText = (cls) => {
  const r = reqOf(cls)
  return r ? `${r.cls}のCLASS LV${r.jlv}` : '条件なし'
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
