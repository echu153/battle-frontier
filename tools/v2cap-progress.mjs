// ============================================================
// v2cap（レベルキャップあり版）進行シミュレーション
// ------------------------------------------------------------
// **プレイ時間**で数える：1時間＝10秒に1戦×360戦。この版のルールと**本物の戦闘（runBattle）**で回す。
// ★2026-10-09 ユーザー指示「日数ていうか何時間かで計算してほしい」：前は「1日1時間」として日で数えていた（数字は同じ）
//   ・場所は1本道（15エリア×①②③）。いつも「開いている一番先の場所」で戦う
//   ・EXPとGold（場所の表×役割の倍率）／LVアップのステータスポイント／ClassEXP／スキル習得／必要LV不足
//   ・**ステータスポイントは、その職業のクラスのステと同じ割合で振る**（jobs.js の JOB_BONUS の並び bonusSeqOf を順に）
//   ・最初の職業は --cls で選ぶ（既定は戦士）。**ClassLV30になったら、その系統の上位職へすぐ転職する**（2026-10-10）。
//     どちらの上位職か・組み方の例のどちらか（skillsIchiji.js の ICHIJI_BUILDS）は乱数の番号で決める
//     （1＝1つ目の職・1つ目の組み方／2＝2つ目の職・1つ目／3＝1つ目の職・2つ目／4＝2つ目の職・2つ目）。
//     まだ覚えていない枠は、系統の初期職の技（ふつうの並べ方）で埋める。剣士は上位職がまだ無いので剣士のまま
//   ・**装備の持ち方は --gear で選ぶ**（どの持ち方でも、持っている中から必要LVの不足ぶんも数えて、職業ごとのステの重み
//     STAT_WEIGHT でいちばん強いものを各枠に着ける）：
//       drops（既定）… **実際に落ちた装備だけ**（画面と同じ rollEquipDrop・ドロップ率どおり）＋キャラ作成でもらう初期装備（2026-10-12〜）
//         【確定】2026-10-12 ユーザー指示「とくに最初は装備全然そろっていないと思うからそれも想定して敵の強さ考えて」
//       best … 行ったことのあるエリアの装備をレア度全部（レジェンダリーまで）持っている（2026-10-09〜10-11 の既定。
//         ユーザー「シミュレーターは最適の装備で進めて」。実際より強いので、これで測った敵は序盤が目安の2〜3倍かかった）
//       none … 装備なし
//     鍛冶屋の分解・作成は数えない（2026-10-12 ユーザー承認）。**強化は見込みの強化値で数える**（2026-10-13 ユーザー指示：
//     着けている装備を その場所の areas.assumedPlusAt＝エリア1は+0・2〜3は+3・4〜10は+6・11〜15は+10・〇-①は前のエリアの値 として戦う。
//     --noplus で強化なし＝強化しない人がどれだけ遅れるかを見る）
//   ・スキル編成はふつうの人の並べ方（typicalSet）
//   ・戦闘用のキャラは**画面と同じ toFighter**（loadout.js）で作る
//
//   node tools/v2cap-progress.mjs [--hours 365] [--seed 1] [--cls 戦士] [--gear drops|best|none] [--quiet]
//   node tools/v2cap-progress.mjs --report [--hours 450] [--gear …]   … 初期職（いまは11職）×2で、エリアを抜けた時間と節目のLV
//   node tools/v2cap-progress.mjs --tune [--hours 450] [--rounds 8] [--step 0.35] [--clip 0.2] [--anneal 0.8] [--stddamp 0.5]
//     … 必要EXPの係数、標準の戦闘力（STD_RATIO・LV1とLV5の行は動かさない）、
//       （必要ClassEXPは回さない：2026-10-12 ユーザー決定で「同じLVの必要EXPの5割」に決まった＝jobs.js の JOB_NEED_PCT）
//       ボスの倍率（エリアの値 AREA_BOSS）を、目安に合うまで回して作り直す（出力をそのまま貼る）
//     そのほかの指定：--classes all（初期職全部で回す・既定は4職）／--stdinit（前の値で1回回して測った標準の戦闘力を出発点に）／
//       --stdmax 34・--bossmax 5（その行・そのエリアまでだけ動かす）／--keepexp（必要EXPの係数を動かさない）／
//       --pct 0.7（ボスは「7割の人が目安までに倒せる」ように。既定0.5＝中央値）
//     ★2026-10-12 エリア1〜5を測り直したときの指定（LV1の行は0.75に固定してから）：
//       --tune --gear drops --classes all --seeds 1,2 --hours 110 --keepexp --stdmax 34 --bossmax 5 --pct 0.7
//       --rounds 10 --step 0.35 --clip 0.2 --anneal 0.8 --keep 4 --stddamp 0.5（約25分）
//     ★2026-10-13 鍛冶屋つきで全部を測り直したとき（ユーザー「見込みの表を上限に実際に強化」。標準の戦闘力・強化の倍率・ボスの倍率を一緒に回す）：
//       --tune --gear drops --classes all --seeds 1,2 --hours 450 --keepexp --stdinit --stdkeepmin 20 --pct 0.7
//       --rounds 10 --step 0.35 --clip 0.2 --anneal 0.8 --keep 4 --stddamp 0.5（約2時間）
//       →ボスの形を決めたあと（〇-③は同じエリアの〇-①の1.01倍以上・中盤からは真ん中の人）、上の値から --stdinit なしで
//         --pct 0.7 --pctmid 0.5 --midfrom 6 をつけてもう一度
//     ⚠2026-10-14〜 エリア1〜5は「序盤の手直し」（areas.js の EARLY_*・ユーザー指示で中ボス-1割・大ボス-2割・ふつうの敵-1割）を上から掛けている。
//       測り直すと手直しを打ち消す向きに合わせるので、エリア1〜5のボスの倍率とLV34以下の行は動かさない（--bossmin 6 --stdmax 2 など）
//     そのほか：--bossmin 6（エリア6から先のボスだけ動かす）／--stdkeepmin 20（LV20以下の行は出発点より下げない）
//   node tools/v2cap-progress.mjs --enh   … 強化で、エリアごとに自分の戦闘力が何倍になるか（ENH_MULT の確かめ。--tune も毎回作り直す）
//   node tools/v2cap-progress.mjs --shrine [--hours 450]   … 安息の祠のハピネスフェアリーにエリアごとどれだけ勝てるか（2026-10-13）
//   node tools/v2cap-progress.mjs --tower [--hours 450] [--seeds 1,2] [--ratios 0.5,0.6,0.7,0.8,0.9,1] [--n 8]
//     … 塔の空いている層のNPCに、強さ（自分の戦闘力×倍率）ごとにどれだけ勝てるか・何ターンかかるか（2026-10-14・tower.js の NPC_MIN_RATIO を決める）
//     ★祠そのもの（0.1%・経験値×5・スタミナ全回復）は進み方の計算には入れていない（1000戦に1回・EXPは2〜3%ほど増えるだけ）
//   鍛冶屋：--gear drops では既定で使う（--nosmith で使わない・--smithcap none で強化の上限を+10に）
//   node tools/v2cap-progress.mjs --statvalue [--areas 3,6,9,12] [--n 500] [--only 剣士]
//     … 職業ごとに「どのステを足すと③のボスに効くか」を測る（装備を選ぶ重み STAT_WEIGHT・同じステでの職業の強さ）
//   ★2026-10-30 敵の測り直し（ユーザー「モンスターはプレイヤーのレベルもそうだけど装備、アセンション、スキルなども考慮したうえで設計してほしい」）で足したもの：
//     ・アセンションを開く（既定・--noasc で開かない）／--report に戦いのターン数（ボス戦・ふつうの敵）
//     ・--report・--tune は職業×乱数の人を CPU（論理）の半分まで同時に回す・優先度を下げる（--workers 1 で順に）
//     ・--pace … 目安どおりに進んだ人の戦闘力の伸びと③のボスの強さを並べる（ボスの並びの下限に追いつけるかを見る）
//     ・--tune --pacetune … ボスを「目安どおりに進んだ人」でエリアごとに合わせる（このときの指定：
//       --tune --pacetune --gear drops --classes all --seeds 1,2 --hours 366 --keepexp --stdkeepmin 20 --pct 0.7 --pctmid 0.5 --midfrom 6
//       --rounds 10 --step 0.35 --clip 0.2 --anneal 0.85 --keep 4 --stddamp 0.5 --nocut --hpshare 0.77,0.6 --from 出発点.json --out 結果.json）
//     ・--nocut（序盤の手直しを外して測る）／--hpshare 0.77,0.6（敵のHPの割合・ふつう,ボス）／--from 値.json（前に測った値から）／--out 値.json（結果をJSONでも書く）
// ============================================================
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { cpus, setPriority, constants as osConstants } from 'node:os'
const B = new URL('../src/', import.meta.url).href
const { runBattle } = await import(B + 'v2cap/core/battle.js')
const { STAT_KEYS, STAT_DEFS, INITIAL_STATS, calcPower } = await import(B + 'v2cap/core/stats.js')
const { setMpCost, SKILL_BY_NAME } = await import(B + 'v2cap/lib/skills.js')
const { treeOf, apTotalOf } = await import(B + 'v2cap/lib/ascension.js')
const { ITEMS, ITEM_BY_ID, starterIdsOf } = await import(B + 'v2cap/lib/equipment.js')
const areas = await import(B + 'v2cap/lib/areas.js')
const level = await import(B + 'v2cap/lib/level.js')
const jobsLib = await import(B + 'v2cap/lib/jobs.js')
const { statsAt } = await import(B + 'v2cap/lib/gear.js')
const { toFighter, totalStats } = await import(B + 'v2cap/lib/loadout.js')
const { CAP_RULES } = await import(B + 'v2cap/lib/rules.js')
const { pickEncounter, rollRewards, nextBossRate, openUntilOf, clearSpot, rollEquipDrop, rollChest } = await import(B + 'v2cap/lib/sortie.js')
const { LAST_SPOT, AREA_LIST, toFighter: enemyFighter, stdPowerAt } = areas
const { applyExp, bodyPowerAt, totalExpTo, POINT_UNIT, totalPointsTo } = level
const { applyJobExp, jobOf, learnOrderOf, attackKindOf, canEquipType, JOB_MAX, nextClassesOf, CLASS_BY_ID } = jobsLib
const { ICHIJI_BUILDS } = await import(B + 'v2cap/lib/skillsIchiji.js')
const { enhanceCostOf, rollEnhance, scrapYieldOf, scrapAreaOf } = await import(B + 'v2cap/lib/smith.js')
const { shrineEncounterOf } = await import(B + 'v2cap/lib/shrine.js')
const tower = await import(B + 'v2cap/lib/tower.js')

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const HOURS = Number(arg('hours', arg('days', 365)))   // 何時間ぶん回すか（--days は前の名前）
const SEED = Number(arg('seed', 1))
const START = arg('cls', '戦士')
const QUIET = process.argv.includes('--quiet')
// 装備の持ち方（上の説明）：drops＝実際に落ちた装備だけ（既定・2026-10-12〜）／best＝行ったエリアの装備をレア度全部から／none＝装備なし
const GEAR_MODE = arg('gear', 'drops')
// 装備の強化の見込み（2026-10-13 ユーザー指示・areas.js の ASSUMED_PLUS）：着けている装備を「その場所の見込みの強化値」として戦う
//   （エリア1は+0・2〜3は+3・4〜10は+6・11〜15は+10。〇-①は前のエリアの値）。--noplus で強化なし（強化しない人がどれだけ遅れるかを見る）
const PLUS_ON = !process.argv.includes('--noplus')
// 鍛冶屋を実際に使う（2026-10-13 ユーザー「強化とかちゃんとできてるかどうかもみてもらいたい」→「見込みの表を上限に実際に強化」）：
//   **--gear drops のときは既定で使う**（--nosmith で使わない）。落ちた装備を分解して残骸を集め、稼いだGoldと残骸で成功率どおりに強化する。
//   ふつうの人の使い方：
//   ・分解 … 着けていない・強化していない装備のうち、必要LVまで育っても いま着けている物（強化値こみ）に届かないもの。2つ目より多く拾った物も
//   ・強化 … 1時間ごとに、着けている装備の中で強化値がいちばん低い物から（同じなら武器→防具→装飾品）、払えるだけ。
//            **上限はその場所の見込みの強化値**（areas.assumedPlusAt＝エリア1は+0・2〜3は+3・4〜10は+6・11〜15は+10・〇-①は前のエリアの値）。
//            --smithcap none で上限+10（見込みより強化する人を見る）
//   ・装備は強化値も数えて選ぶ（強化したノーマルが、強化していないレアより強ければそのまま着ける）
//   ・作成はしない
//   ・残骸は分解のほか、**宝箱**からも入る（2026-10-14〜・勝って装備が落ちなかったときに5%で、その場所のエリアの残骸1〜10個＝
//     画面・サーバーと同じ決まりの sortie.js の rollChest）。--report に「残骸の入り方」（分解・宝箱）を出す
const SMITH_ON = !process.argv.includes('--nosmith')
const SMITH_CAP = arg('smithcap', 'table')
// アセンション（2026-10-30〜・ユーザー指示「モンスターはプレイヤーのレベルもそうだけど装備、アセンション、スキルなども考慮したうえで
//   設計してほしい」）：CLASS LVが上がってAPが入るたびに、ふつうの人の開け方（simulate の ascSpend）で開く。--noasc で開かない
//   ⚠前（2026-10-13〜10-29）は「敵の強さの測り直しには入れない」（ユーザー決定）で、開かずに測っていた
const ASC_ON = !process.argv.includes('--noasc')
// 敵の配分のHPの割合（areas.js の ENEMY_HP_SHARE・2026-10-30）を試す：--hpshare 0.8,0.6（ふつうの敵,ボス）
const HP_SHARE_ARG = arg('hpshare', null)
if (HP_SHARE_ARG) { const [n, b] = HP_SHARE_ARG.split(',').map(Number); areas.setEnemyHpShareForTuning(n, b ?? n) }
// --nocut：序盤の手直し（areas.js の EARLY_*）を外して測る（測り直しで手直しを打ち消さないように・手直しは測った強さの上から掛ける）
if (process.argv.includes('--nocut')) areas.setEarlyCutForTuning(false)
const PER_HOUR = 360   // 1時間の戦闘数（10秒に1戦）

// ===== 目安 =====
// エリアの③のボスを倒せるようになるプレイ時間。今のⅡの「難易度帯ごとの日数（1日1時間）」をそのまま時間にした
// （① 3日／② 1週／③ 2週／④ 1か月／⑤ 3か月／⑥ 半年／⑦ 9か月／⑧ 1年・2026-08-25 ユーザー決定）を、
// 帯に入っていたエリアへ等分して割り振った（帯に2つあれば半分ずつ、3つなら3分の1ずつ）
export const AREA_HOUR = [3, 7, 14, 22, 30, 60, 90, 135, 180, 210, 240, 270, 302, 333, 365]
// エリアの中の①②③の割り振り。③のボスは特に強い（ユーザー指示）ので③に半分をあてる
export const SUB_SHARE = [0.25, 0.5, 1]
export const SPOT_HOUR = AREA_HOUR.flatMap((end, k) => {
  const start = k ? AREA_HOUR[k - 1] : 0
  return SUB_SHARE.map(f => start + (end - start) * f)
})
const LV100_HOUR = 365   // LV100に着くプレイ時間（1日1時間なら1年・ユーザー決定）
const JOB30_HOUR = 14    // 前の目安「最初の職業がClassLV30に着くプレイ時間」（2026-10-12 から必要ClassEXPは回さない＝その時間のEXPを記録するだけ）

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const ARMOR_SLOT = { 頭:'head', 鎧:'body', 腕:'arm', 足:'foot' }

// ===== ふつうの人の選び方 =====
// 装備を選ぶときのステの重み（職業ごと）。「そのステを足すと③のボスにどれだけ効くか」を測ったもの
//   （node tools/v2cap-progress.mjs --statvalue・エリア3/6/9/12の③のボスの平均・一番効くステを1にした）
//   ★AGIはどの職業にもよく効く（回避・行動順・追加行動）。DEX・VITはあまり効かない
//   ⚠前は職業を見ずに「物理なら STR/DEX/AGI/VIT の合計」で選んでいた。STRだけで殴る職業ほど
//     要らないステの装備を着けて遅れていた（2026-10-09 実際に踏んだ）。スキルや戦闘を変えたら測り直す
//   ★2026-10-09 ステータスポイントにしたあと・剣士を足したあとに全職業を測り直した（--statvalue）
export const STAT_WEIGHT = {
  戦士:     { str:1.00, agi:0.63, vit:0.20, dex:0.16, int_stat:0.02 },
  槍使い:   { str:1.00, agi:0.85, int_stat:0.25, vit:0.12, dex:0.09 },
  格闘家:   { str:1.00, agi:0.70, dex:0.27, vit:0.17, int_stat:0.09 },
  盗賊:     { agi:1.00, str:0.54, vit:0.15, int_stat:0.10, dex:0.05 },
  弓使い:   { agi:1.00, str:0.67, vit:0.13, dex:0.08, int_stat:0.05 },
  銃士:     { agi:1.00, dex:0.90, str:0.62, int_stat:0.27, vit:0.19 },
  剣士:     { agi:1.00, str:0.90, dex:0.28, vit:0.25, int_stat:0.15 },
  魔法使い: { int_stat:1.00, agi:0.74, dex:0.25, vit:0.19, str:0 },
  呪術師:   { agi:1.00, int_stat:0.95, vit:0.19, dex:0.14, str:0 },
  僧侶:     { int_stat:1.00, agi:0.31, dex:0.23, vit:0.03, str:0 },
  薬師:     { int_stat:1.00, agi:0.62, vit:0.17, dex:0.09, str:0 },
  // ★上位職のうち、系統の初期職と使うステが違う職業（2026-10-14 の並び替え）。まだ測っていない仮の重み（--statvalue で測り直す）
  魔法剣士:     { str:1.00, int_stat:0.80, agi:0.50, dex:0.20, vit:0.15 },
  聖騎士:       { vit:1.00, str:1.00, agi:0.40, int_stat:0.20, dex:0.15 },
  サイキッカー: { str:1.00, int_stat:1.00, agi:0.50, dex:0.20, vit:0.15 },
  魔銃士:       { str:1.00, int_stat:1.00, agi:0.50, dex:0.40, vit:0.15 },
}
// ★ほかの上位職はまだ測っていないので、系統の初期職の重みを使う
const weightOf = (cls) => STAT_WEIGHT[cls] || STAT_WEIGHT[CLASS_BY_ID[cls]?.req?.cls]
  || (attackKindOf(cls) === 'mag' ? { int_stat:1, agi:0.6 } : { str:1, agi:0.8 })
// スキル編成：強化の技を先頭に1回ずつ・攻撃の技は後に覚えたもの（強い技）から・回復の技は最後に1回ずつ。
//   MPだけを戻す技（気付け薬）は入れない。回数はMPに収まるだけ、攻撃の技へ前から1回ずつ足す（1枠5回まで）
//   ⚠前は「覚えた技を後ろから5つ・全部均等」で、薬師は気付け薬と強壮剤が先頭に来て損をしていた
//     （山登りで探した一番よい並べ方とくらべて、この並べ方は差が数%・2026-10-09）
const isMpOnly = (sk) => sk.kind === 'heal' && sk.mpRegen && !sk.heal && !sk.regen
const isAtk = (sk) => sk.kind === 'phys' || sk.kind === 'mag'
const orderForSet = (sks) => [...sks.filter(sk => sk.kind === 'buff'), ...sks.filter(isAtk).reverse(), ...sks.filter(sk => sk.kind === 'heal')]
export const typicalSet = (cls, learned, maxMp) => {
  const have = new Set(learned)
  const sks = learnOrderOf(cls).filter(sk => have.has(sk.name) && !isMpOnly(sk))
  return fitSet(orderForSet(sks).slice(0, 5), maxMp)
}
// 上位職：ユーザーの表の組み方の例（覚えた技だけ）＋足りない枠は系統の初期職の技（ふつうの並べ方）
export const ichijiSet = (cls, buildIdx, learned, maxMp) => {
  const have = new Set(learned)
  const build = ICHIJI_BUILDS[cls]?.[buildIdx] || []
  const own = learnOrderOf(cls).filter(sk => build.includes(sk.name) && have.has(sk.name))
  const base = CLASS_BY_ID[cls]?.req?.cls
  const fill = base
    ? orderForSet(learnOrderOf(base).filter(sk => have.has(sk.name) && !isMpOnly(sk))).slice(0, Math.max(0, 5 - own.length))
    : []
  // 種類ごと（強化→攻撃→回復）に並べ、同じ種類では上位職の技を先に置く
  const rank = (sk) => (sk.kind === 'buff' ? 0 : isAtk(sk) ? 1 : 2)
  // ★組み方の例は「仕組みが回る並び」で書いてある（skillsIchiji.js の ICHIJI_BUILDS）＝書いた並びのまま使う。
  //   前は「強化→攻撃は後に覚えた順」に並べ直していて、竜騎士の「跳躍→着地の次の天墜竜閃」が回らなかった（2026-10-21）
  const ownInOrder = build.map(n => own.find(sk => sk.name === n)).filter(Boolean)
  const merged = [...ownInOrder, ...fill].map((sk, i) => ({ sk, i })).sort((a, b) => rank(a.sk) - rank(b.sk) || a.i - b.i).map(x => x.sk)
  return fitSet(merged, maxMp)
}
const fitSet = (sks, maxMp) => {
  const set = sks.map(sk => ({ name: sk.name, uses: 1, atk: isAtk(sk) }))
  const cost = () => setMpCost(set)
  while (set.length && cost() > maxMp) set.pop()
  for (let grew = true; grew;) {
    grew = false
    for (const e of set) {
      if (!e.atk || e.uses >= 5) continue
      e.uses++
      if (cost() > maxMp) e.uses--
      else grew = true
    }
  }
  return set.map(({ name, uses }) => ({ name, uses }))
}

// probe … 1時間ごとに呼ぶ（{ hour, spot＝いまの場所, lv＝いまのLV, fighter＝いまの自分の戦闘用キャラを作る関数, prof・inv＝いまの自分と持ち物 }）。
//   本筋の進み方は変えない（--shrine・--tower・ダンジョンのボスを測る道具が使う）
// onBattle … 1戦ごとに呼ぶ（武器の真化のシミュ tools/v2cap-shinka-sim.mjs が武器ごとに数える）。
//   { r, enc, win, at, hour, weaponId, cls, prof, inv } を渡す。true を返すと着け直す（真化した武器を持ち物の行へ写す）
// rowExtra … 持ち物の行に足す中身（base_id → { shinka } など）。着け直すたびに引く
// pace … true なら、ボスに勝ったかどうかに関係なく**目安の時間（SPOT_HOUR）どおりに場所を進める**（2026-10-30・目安どおりに進んだ人の
//   戦闘力の伸びを測る＝ボスの並びの決まり「1エリアごとに約6%強く」に追いつけるかを見る）
export const simulate = ({ hours = HOURS, seed = SEED, start = START, gear = GEAR_MODE, plus = PLUS_ON, smith = SMITH_ON, probe = null,
  onBattle = null, rowExtra = null, pace = false } = {}) => {
  const rng = rngOf(seed)
  // 鍛冶屋を実際に使うとき（--smith）は、見込みの強化値は使わない（実際に強化した値で戦う）
  const smithOn = smith && gear === 'drops'
  const usePlus = plus && !smithOn
  // 見込みの強化値を付けた持ち物（戦う・戦闘力を測るときはこれを使う）。withPlus(n) は強化値 n にしたもの・withPlus(0) は強化なし
  const withPlus = (n) => inventory.map(i => ((i.plus || 0) === n ? i : { ...i, plus: n }))
  const invAt = (spot) => (usePlus ? withPlus(areas.assumedPlusAt(spot)) : inventory)
  // 鍛冶屋の持ち物：装備ごとの強化値（base_id → 強化値）・残骸（エリア → 個数）
  const plusById = new Map()
  const scrap = {}
  const scrapGot = { dismantle: 0, chest: 0 }   // 残骸の入り方（分解・宝箱）の合計
  let goldSpent = 0, enhTries = 0, enhWins = 0
  const plusByArea = {}   // エリア → そこにいた1時間ごとの「着けている装備の強化値の平均」の合計と数
  // エリアごとの「見込みの強化値つき÷強化なし」の戦闘力（--enh が敵の倍率 ENH_MULT を作るのに使う）
  const enhByArea = {}
  const st = { lv: 1, exp: 0, ...INITIAL_STATS }
  let cls = start
  // 上位職の選び方（乱数の番号で決める）
  const jobPick = (seed - 1) % 2
  const buildPick = Math.floor((seed - 1) / 2) % 2
  let advancedHour = null
  let jobs = { [cls]: { lv: 1, exp: 0 } }
  let learned = applyJobExp(jobs, cls, 0).learned
  let cleared = [], bossRate = 0, gold = 0, cumExp = 0
  let inventory = []                   // { id, base_id, ilv }（画面の v2cap_inventory と同じ形。着けている装備だけ）
  let equipped = {}
  let skillSet = []
  const hourly = []
  const spotClearHour = {}             // 場所 → ボスを倒した時間（小数）
  const lvAtClear = {}                 // 場所 → ボスを初めて倒したときのLV
  const firstBossWin = {}              // 場所 → そこのボスに初めて勝った時間（pace でも数える＝--pacetune が使う）
  const lvAtSpotHour = {}              // 場所 → 目安の時間のLV
  const expAtSpotHour = {}             // 場所 → 目安の時間までに稼いだEXPの合計
  const expInSpot = {}                 // 場所 → そこで稼いだEXP
  const hoursInSpot = {}               // 場所 → そこにいた時間
  const fightsInSpot = {}              // 場所 → { n, win, boss, bossWin }（どこで詰まっているかを見る）
  const powerByLv = {}                 // LV -> [戦闘力]
  // 戦いの長さ（2026-10-30・敵のHPを上げすぎていないかを見る）：エリア → { boss: [ボス戦のターン数（勝った戦い）], n・sum: ふつうの敵（勝った戦い） }
  const turnsByArea = {}
  let job30Hour = null
  let expAtJobHour = null
  let expAtLvHour = null

  // アセンションの開いたマス（職業 → 番号の並び・画面の v2cap_profiles.ascension と同じ形）。効くのはいまの職業の盤面だけ
  const ascByCls = {}
  const prof = () => ({
    username:'me', class: cls, lv: st.lv,
    ...Object.fromEntries(STAT_KEYS.map(k => [k, st[k]])),
    jobs, learned, skill_sets: { [cls]: skillSet }, equipped,   // スキルセットは職業ごと（画面の v2cap_profiles と同じ形）
    ascension: ascByCls,
  })
  // 装備は「その時点で着けられるいちばん良いもの」。行ったことのあるエリア（開いている一番先の場所のエリアまで）の装備を、
  // レア度は全部（エピック・レジェンダリーも）候補にし、必要LVに足りない装備はいまのLV相当（2026-10-18〜・gear.js）で数えて職業の重みで比べる
  let weight = weightOf(cls)
  // 装備の値打ち（職業の重み）。強化値も数える（鍛冶屋を使わないときは強化値0）
  // lv＝いまのLV（null なら必要LVまで育ったときの見込み）
  const valueAt = (item, lv = st.lv, p = plusById.get(item.id) || 0) => {
    const s = statsAt(item, item.lv, lv, p)
    return Object.entries(weight).reduce((t, [k, w]) => t + (s[k] || 0) * w, 0)
  }
  const bestOf = (list) => {
    let b = null
    let bv = -1
    for (const x of list) { const v = valueAt(x); if (v > bv) { b = x; bv = v } }
    return b
  }
  // gear＝drops のときの持ち物（拾った装備の base_id → 個数）。同じものは2つまで（装飾品は2枠に同じものを着けられる）
  const bag = new Map()
  // ★キャラ作成で初期装備（必要LV1の7点）をもらう（2026-10-12〜・画面と同じ starterIdsOf）。装飾品は同じものが2つ
  if (gear === 'drops') for (const id of starterIdsOf(start)) bag.set(id, Math.min(2, (bag.get(id) || 0) + 1))
  let gearArea = 0
  const regear = () => {
    gearArea = areas.spotOf(openUntilOf(cleared)).area
    inventory = []
    equipped = {}
    if (gear === 'none') return
    const pool = gear === 'drops' ? [...bag.keys()].map(id => ITEM_BY_ID[id]) : ITEMS.filter(i => i.area <= gearArea)
    const picks = { weapon: bestOf(pool.filter(i => i.part === '武器' && canEquipType(cls, i.type))) }
    for (const [part, slot] of Object.entries(ARMOR_SLOT)) picks[slot] = bestOf(pool.filter(i => i.part === part))
    const accs = pool.filter(i => i.part === 'アクセ')
    picks.acc1 = bestOf(accs)
    // 2つ目の装飾品：best は同じものを2つ／drops は同じものを2つ拾っていればそれ、なければ次に良いもの
    picks.acc2 = gear === 'drops' && picks.acc1 && (bag.get(picks.acc1.id) || 0) < 2
      ? bestOf(accs.filter(i => i !== picks.acc1))
      : picks.acc1
    for (const [slot, item] of Object.entries(picks)) {
      if (!item) continue
      inventory.push({ id: inventory.length + 1, base_id: item.id, ilv: item.lv, plus: plusById.get(item.id) || 0, ...(rowExtra?.(item.id) || {}) })
      equipped[slot] = inventory.length
    }
    if (smithOn) dismantle(picks)
  }
  // 分解（鍛冶屋を使うときだけ）：着けていない・強化していない装備のうち、必要LVまで育っても
  // いま着けている物（強化値こみ）に届かないものを分解して、その装備のエリアの残骸にする
  const dismantle = (picks) => {
    const wornIds = new Set(Object.values(picks).filter(Boolean).map(i => i.id))
    const valOf = (slot) => (picks[slot] ? valueAt(picks[slot]) : 0)
    for (const [id, n] of [...bag]) {
      if (wornIds.has(id) || (plusById.get(id) || 0) > 0) continue
      const item = ITEM_BY_ID[id]
      if (!item) continue
      const now = item.part === '武器' ? (canEquipType(cls, item.type) ? valOf('weapon') : Infinity)
        : item.part === 'アクセ' ? Math.min(valOf('acc1'), valOf('acc2'))
        : valOf(ARMOR_SLOT[item.part])
      if (valueAt(item, null, 0) > now) continue   // 育てば着ける見込みがあるので残す
      bag.delete(id)
      const a = scrapAreaOf(item)
      scrap[a] = (scrap[a] || 0) + scrapYieldOf(item) * n
      scrapGot.dismantle += scrapYieldOf(item) * n
    }
  }
  // 強化（鍛冶屋を使うときだけ・1時間ごと）：着けている装備の中で強化値がいちばん低い物から、払えるだけ
  const SLOT_RANK = { weapon: 0, head: 1, body: 2, arm: 3, foot: 4, acc1: 5, acc2: 6 }
  const enhance = () => {
    let up = false
    const cap = SMITH_CAP === 'none' ? 10 : areas.assumedPlusAt(openUntilOf(cleared))
    for (let guard = 0; guard < 1000; guard++) {
      const worn = Object.entries(equipped)
        .map(([slot, row]) => ({ slot, id: inventory[row - 1]?.base_id }))
        .filter((w, i, all) => w.id && all.findIndex(x => x.id === w.id) === i)
        .map(w => ({ ...w, item: ITEM_BY_ID[w.id], plus: plusById.get(w.id) || 0 }))
        .filter(w => w.plus < cap)
        .sort((a, b) => a.plus - b.plus || SLOT_RANK[a.slot] - SLOT_RANK[b.slot])
      let tried = false
      for (const w of worn) {
        const c = enhanceCostOf(w.item, { plus: w.plus, ilv: w.item.lv })
        if (!c || gold < c.gold || (c.scrap > 0 && (scrap[c.area] || 0) < c.scrap)) continue
        gold -= c.gold
        goldSpent += c.gold
        if (c.scrap > 0) scrap[c.area] -= c.scrap
        enhTries++
        if (rollEnhance(c.rate, rng)) { plusById.set(w.id, w.plus + 1); enhWins++; up = true }
        tried = true
        break
      }
      if (!tried) break
    }
    return up
  }
  // ステータスポイントは、その職業のクラスのステと同じ割合で振る（並び bonusSeqOf を前から順に・一周したら頭から）
  let pointSeq = jobsLib.bonusSeqOf(cls)
  let pointsUsed = 0
  const spendPoints = (n) => {
    for (let i = 0; i < n; i++) {
      const k = pointSeq[pointsUsed % pointSeq.length]
      st[k] += POINT_UNIT[k]
      pointsUsed++
    }
  }
  // スキル編成はふつうの人の並べ方（typicalSet）。覚えた技・最大MPが変わるたびに組み直す
  const reset = () => {
    const mp = totalStats(prof(), invAt(openUntilOf(cleared))).mp
    skillSet = CLASS_BY_ID[cls]?.stage === 'ichiji' ? ichijiSet(cls, buildPick, learned, mp) : typicalSet(cls, learned, mp)
  }
  // アセンションのふつうの人の開け方（2026-10-30）：開いているマスから届く「まだ開いていないマス」それぞれへのいちばん近いルートのうち、
  //   ルートのマスの値打ちの合計 ÷ ルートの長さ（AP）がいちばん高いものの、最初のマスを開く。APが残るかぎりくり返す
  //   （遠い技のマス・大マスへ向かう道も、途中の小マスこみで比べる）。
  //   値打ち … 小マス＝そのマスの戦闘力（pts）×重み／大マス＝いまのそのステ（戦闘力に直した値）×+%×重み／
  //   技のマス＝いまの編成に入れている技なら「重みをかけた戦闘力の合計」の 攻撃5%・強化4%・回復2%、入れていない技は0.5%
  //   重み … 装備を選ぶのと同じ weightOf ＋ HP 0.4・MP 0.15・LUK 0.1（この3つは測っていない仮の値）
  const ASC_EXTRA_W = { hp: 0.4, mp: 0.15, luk: 0.1 }
  const ascSpend = () => {
    const t = ASC_ON ? treeOf(cls) : null
    if (!t) return
    const open = (ascByCls[cls] ||= [])
    let left = apTotalOf(cls, jobOf(jobs, cls).lv) - open.length
    if (left <= 0) return
    const w = { ...ASC_EXTRA_W, ...weight }
    const tot = totalStats(prof(), invAt(openUntilOf(cleared)))
    const ptsOf = (k) => (tot[k] || 0) / (STAT_DEFS[k]?.unit || 1)
    const P = Object.keys(w).reduce((s, k) => s + ptsOf(k) * w[k], 0)
    const inSet = new Set(skillSet.map(e => e.name))
    const valueOf = (n) => {
      if (n.type === 'stat') return n.pts * (w[n.stat] || 0)
      if (n.type === 'big') return ptsOf(n.stat) * n.pct / 100 * (w[n.stat] || 0)
      if (n.type !== 'skill') return 0
      if (!inSet.has(n.skill)) return P * 0.005
      const sk = SKILL_BY_NAME[n.skill]
      return P * (sk && isAtk(sk) ? 0.05 : sk?.kind === 'buff' ? 0.04 : 0.02)
    }
    const have = new Set([0, ...open])
    while (left > 0) {
      // 開いているマスから広げる（番号の小さいほうから＝ascension.js の routeTo と同じ順）
      const prev = new Map(), sum = new Map(), len = new Map()
      const queue = []
      const reach = (nb, from) => {
        if (have.has(nb) || prev.has(nb)) return
        prev.set(nb, from)
        sum.set(nb, (from < 0 ? 0 : sum.get(from)) + valueOf(t.byId[nb]))
        len.set(nb, (from < 0 ? 0 : len.get(from)) + 1)
        queue.push(nb)
      }
      for (const id of [...have].sort((a, b) => a - b)) for (const nb of t.byId[id].links) reach(nb, -1)
      for (let i = 0; i < queue.length; i++) for (const nb of t.byId[queue[i]].links) reach(nb, queue[i])
      let best = null, bv = -1
      for (const id of queue) { const v = sum.get(id) / len.get(id); if (v > bv) { bv = v; best = id } }
      if (best === null) break
      let first = best
      while (prev.get(first) !== -1) first = prev.get(first)
      open.push(first)
      have.add(first)
      left--
    }
  }
  // 転職：系統の上位職へ（ClassLVは1から・クラスのステはその職のぶんだけ・武器は同じ）
  const advance = (hour) => {
    const opts = nextClassesOf(cls)
    if (!opts.length) return false
    cls = opts[jobPick % opts.length]
    jobs = { ...jobs, [cls]: jobOf(jobs, cls) }
    const got = applyJobExp(jobs, cls, 0, learned).learned
    learned = [...learned, ...got]
    weight = weightOf(cls)
    pointSeq = jobsLib.bonusSeqOf(cls)
    pointsUsed = 0
    advancedHour = hour
    return true
  }
  regear()
  reset()

  let t = Date.UTC(2026, 0, 1)
  let nextMark = 0   // 次に「目安の時間のLV」を記録する場所（0始まり）
  for (let d = 1; d <= hours; d++) {   // d … 何時間目
    let wins = 0, fights = 0
    for (let s = 0; s < PER_HOUR; s++) {
      t += 10_000
      const hour = d - 1 + s / PER_HOUR   // 小数の時間（序盤の場所は数十分で抜けるため）
      while (nextMark < LAST_SPOT && hour >= SPOT_HOUR[nextMark]) {
        lvAtSpotHour[nextMark + 1] = st.lv
        expAtSpotHour[nextMark + 1] = cumExp
        nextMark++
      }
      if (expAtJobHour === null && hour >= JOB30_HOUR) expAtJobHour = cumExp
      if (expAtLvHour === null && hour >= LV100_HOUR) expAtLvHour = cumExp
      const at = new Date(t)
      if (pace) {
        while (cleared.length < LAST_SPOT && hour >= SPOT_HOUR[cleared.length]) {
          const id = cleared.length + 1
          cleared = clearSpot(cleared, id)
          spotClearHour[id] = hour
          lvAtClear[id] = st.lv
          if (areas.spotOf(openUntilOf(cleared)).area !== gearArea) { regear(); reset() }
        }
      }
      const spot = openUntilOf(cleared)
      const enc = pickEncounter(spot, bossRate, at, rng)
      const r = runBattle(toFighter(prof(), invAt(spot), { at }), { ...enemyFighter(enc.enemy), boss: enc.isBoss }, { rng })
      const win = r.winner === 'a'
      const forceRegear = onBattle?.({ r, enc, win, at, hour, cls, prof: prof(), inv: invAt(spot),
        weaponId: inventory[(equipped.weapon || 0) - 1]?.base_id || null }) === true
      fights++
      hoursInSpot[spot] = (hoursInSpot[spot] || 0) + 1 / PER_HOUR
      bossRate = nextBossRate(bossRate, enc.isBoss)
      if (win) wins++
      const fs = (fightsInSpot[spot] ||= { n: 0, win: 0, boss: 0, bossWin: 0 })
      fs.n++; if (win) fs.win++
      if (enc.isBoss) { fs.boss++; if (win) fs.bossWin++ }
      if (win && enc.isBoss && firstBossWin[spot] === undefined) firstBossWin[spot] = hour
      if (win) {
        const ta = (turnsByArea[enc.spot.area] ||= { boss: [], n: 0, sum: 0 })
        if (enc.isBoss) ta.boss.push(r.turns)
        else if (enc.role !== 'rare') { ta.n++; ta.sum += r.turns }
      }
      // ★負けても経験値はその場所の最低値が入る（倍率なし・Goldなし）＝画面・サーバーと同じ
      const { exp, gold: g } = rollRewards(enc, rng, win)
      gold += g
      cumExp += exp
      expInSpot[spot] = (expInSpot[spot] || 0) + exp
      const lvBefore = st.lv
      const res = applyExp(st, exp)
      st.lv = res.lv; st.exp = res.exp
      if (res.points) spendPoints(res.points)
      const j = applyJobExp(jobs, cls, exp, learned)
      jobs = j.jobs
      let dirty = res.lv !== lvBefore || j.ups.length > 0 || forceRegear
      if (j.learned.length) { learned = [...learned, ...j.learned]; dirty = true }
      // gear＝drops：勝ったときに画面と同じ決まり（rollEquipDrop）で装備が落ちる。新しく拾ったら着け直す
      if (win && gear === 'drops') {
        const d = rollEquipDrop(enc, cls, at, rng)
        const n = d ? bag.get(d.item.id) || 0 : 2
        if (n < 2) { bag.set(d.item.id, n + 1); dirty = true }
        else if (d && smithOn) {   // 3つ目からは分解
          const a = scrapAreaOf(d.item)
          scrap[a] = (scrap[a] || 0) + scrapYieldOf(d.item)
          scrapGot.dismantle += scrapYieldOf(d.item)
        }
        // 宝箱（2026-10-14〜）：装備が落ちなかった勝ちで5%・その場所のエリアの残骸1〜10個（画面・サーバーと同じ rollChest）
        if (!d && smithOn) {
          const k = rollChest(rng)
          if (k) { scrap[enc.spot.area] = (scrap[enc.spot.area] || 0) + k; scrapGot.chest += k }
        }
      }
      // 初期職がClassLV30（上限）になったら、すぐ系統の上位職へ（★最初の職業のClassLV30の時間は転職の前に数える）
      if (CLASS_BY_ID[cls]?.stage === 'shoki' && j.lv >= JOB_MAX) {
        if (job30Hour === null) job30Hour = hour
        if (advance(hour)) dirty = true
      }
      if (!pace && win && enc.isBoss && !cleared.includes(spot)) {
        cleared = clearSpot(cleared, spot)
        spotClearHour[spot] = hour
        lvAtClear[spot] = st.lv   // ボスを初めて倒したときのLV（推奨LVの目安＝areas.js の SPOT_REC_LV を測る・2026-10-12）
        if (areas.spotOf(openUntilOf(cleared)).area !== gearArea) dirty = true   // 新しいエリアの装備が着けられる
      }
      // CLASS LVが上がった（AP が入った）・転職したら、アセンションを開く（いまの編成と着けている装備で値打ちを見る）
      if (j.ups.length > 0) ascSpend()
      if (dirty) { regear(); reset() }
      // 標準の戦闘力（STD_RATIO）を作るための「強化なし」の戦闘力。強化ぶんは敵の強化の倍率（ENH_MULT）のほうで数える
      if (res.lv !== lvBefore) (powerByLv[st.lv] ||= []).push(calcPower(totalStats(prof(), withPlus(0))))
    }
    const here = openUntilOf(cleared)
    // 鍛冶屋：1時間ごとに強化する（強くなったら着け直す）
    if (smithOn && enhance()) { regear(); reset() }
    probe?.({ hour: d, spot: here, lv: st.lv, fighter: () => toFighter(prof(), invAt(here)), prof: prof(), inv: invAt(here) })
    hourly.push({ d, lv: st.lv, power: calcPower(totalStats(prof(), invAt(here))), body: bodyPowerAt(st.lv), win: wins / fights,
      spot: here, cls, jlv: jobOf(jobs, cls).lv, gold, slots: Object.keys(equipped).length })
    const area = areas.spotOf(here).area
    if (inventory.length) {
      const pa = (plusByArea[area] ||= { sum: 0, n: 0 })
      pa.sum += inventory.reduce((t, r) => t + (r.plus || 0), 0) / inventory.length
      pa.n++
    }
    // 強化で戦闘力が何倍になっているか（鍛冶屋を使うときは実際の強化値・使わないときは見込みの強化値）＝敵の強化の倍率（ENH_MULT）を作る
    const base = calcPower(totalStats(prof(), withPlus(0)))
    const acc = (enhByArea[area] ||= { sum: 0, n: 0 })
    acc.sum += calcPower(totalStats(prof(), invAt(here))) / base
    acc.n++
  }
  if (expAtJobHour === null) expAtJobHour = cumExp
  if (expAtLvHour === null) expAtLvHour = cumExp
  return {
    hourly, spotClearHour, lvAtClear, firstBossWin, lvAtSpotHour, expAtSpotHour, expInSpot, hoursInSpot, powerByLv,
    learned, cls, start, jobs, job30Hour, advancedHour, expAtJobHour, expAtLvHour, gold,
    fightsInSpot, enhByArea, turnsByArea,
    plusByArea, goldSpent, enhTries, enhWins, scrap, scrapGot,
    asc: ascByCls,
    final: { profile: prof(), inventory },   // 最後のキャラ（職業ごとの強さを比べるのに使う）
  }
}

// ===== 何人かを同時に回す（2026-10-30）=====
// --report・--tune の「職業×乱数」の人を、CPU（論理）の半分まで同時に回す（1人450時間で約20秒・22人を順に回すと約8分かかっていた）。
//   1人ずつの中身は順に回すのと同じ（乱数は人ごと）。敵の表（STD_RATIO・AREA_BOSS・ENH_MULT）と必要EXPは、そのときの値を毎回わたす。
//   --workers 1 で前と同じく順に回す・--workers 26 のように数を指定もできる
//   ★【確定】2026-10-30 ユーザー選択「優先度を下げる＋同時に回すのを半分」：前は CPU−2本（このPCで26本）を全力で使い、
//     測り直しのあいだPCが重かった。いまは半分（14本）まで・プロセスの優先度を「通常以下」にする＝PCを使っているときはそちらが先に動く
const lowerPriority = () => { try { setPriority(0, osConstants.priority.PRIORITY_BELOW_NORMAL) } catch { /* 下げられなくても回す */ } }
const tablesNow = () => ({ std: areas.STD_RATIO.map(r => [...r]), boss: [...areas.AREA_BOSS], enh: [...areas.ENH_MULT], need: level.NEED_PERMIL,
  hpShare: [areas.ENEMY_HP_SHARE.normal, areas.ENEMY_HP_SHARE.boss] })
const applyTables = (t) => {
  t.std.forEach(([l, r], i) => { areas.STD_RATIO[i][0] = l; areas.STD_RATIO[i][1] = r })
  t.boss.forEach((v, i) => { areas.AREA_BOSS[i] = v })
  t.enh.forEach((v, i) => { areas.ENH_MULT[i] = v })
  level.setNeedPermilForTuning(t.need)
  if (t.hpShare) areas.setEnemyHpShareForTuning(t.hpShare[0], t.hpShare[1])
  areas.resetEnemyCache()
}
const runMany = async (jobs) => {
  const n = Math.max(1, Math.min(jobs.length, Number(arg('workers', Math.floor(cpus().length / 2)))))
  lowerPriority()
  if (n <= 1) return jobs.map(j => simulate(j))
  const tables = tablesNow()
  const out = new Array(jobs.length)
  let next = 0
  await Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2), workerData: { tables } })
    const feed = () => {
      if (next >= jobs.length) { w.terminate().then(resolve); return }
      const i = next++
      w.postMessage({ i, job: jobs[i] })
    }
    w.on('message', ({ i, r }) => { out[i] = r; feed() })
    w.on('error', reject)
    feed()
  })))
  return out
}
if (!isMainThread) {
  lowerPriority()
  applyTables(workerData.tables)
  parentPort.on('message', ({ i, job }) => parentPort.postMessage({ i, r: simulate(job) }))
}
// --from：前に測った値（--tune --out の JSON）から始める（続きから測る・その値で --report を出す）。--hpshare を付ければそちらが勝つ
if (isMainThread && arg('from', null)) {
  const { readFileSync } = await import('node:fs')
  const t = JSON.parse(readFileSync(arg('from'), 'utf8'))
  applyTables({ ...tablesNow(), ...t, ...(HP_SHARE_ARG ? { hpShare: null } : {}) })
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
// 下から p の位置の値（p＝0.5 なら median と同じ）
const quantile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null }
const round2 = (v) => Math.round(v * 100) / 100
const areaClearHour = (r, k) => r.spotClearHour[k * 3 + 3]   // エリアk（0始まり）の③を倒した時間

// ===== --tune =====
// 1回ごとに「回す → 測る → 表を作り直す」を繰り返して落ち着かせる。最後に、後半の回の平均を出す
// （それを areas.js / level.js / jobs.js と SQL の係数へそのまま貼る）。
//   ・必要EXP・必要ClassEXP … 場所ごとの「1時間あたりのEXP」を測り、**目安どおりに進んだとき**の
//     合計EXPから決める（だれかが遅れた・進んだに引きずられない）
//   ★敵のLVは敵ごとに一定（monsters.js の AREA_LEVELS・2026-10-09 ユーザー指示）なので、ここでは作らない。
//     前は「場所のLV帯（SPOT_LV）」をここで作り、敵のLVをそこから決めていた
//   ・ボスの倍率 … その場所に**入ってから倒すまでの時間**（1人ずつの中央値）が目安に近づくように
//   ⚠「目安の時間に実際に稼いだEXP」や「最初からの通算の時間」で合わせると、1か所の遅れが後ろ全部に響いて、
//     回ごとに大きく振れた（2026-10-09 実際に踏んだ）
// 測り直しで動かさない標準の戦闘力の行（このLV以下）。始まりの森①の敵（LV1・2）を装備なしのLV1で勝てる強さに保つ
// ★2026-10-12 LV2の行を足して①-①の強さをそこで止め、LV5から上を強くした（ユーザー「１－１は弱くていい」）＝止めるのはLV2まで
const STD_FIXED_LV = 2
const tune = async () => {
  // --classes all で初期職を全部（いまは11職）。既定は4職（速い・ふつう・魔法・回復の代表）
  const classes = arg('classes', null) === 'all' ? jobsLib.START_CLASSES : ['戦士', '盗賊', '魔法使い', '薬師']
  // --keepexp で必要EXP・必要ClassEXPの係数を動かさない（短い時間だけ回して一部を合わせるとき。先の場所の測りが無いので係数が当てにならない）
  const KEEP_EXP = process.argv.includes('--keepexp')
  const seeds = String(arg('seeds', '1,2')).split(',').map(Number)
  const rounds = Number(arg('rounds', 10))
  const step = Number(arg('step', 0.3))
  const clip = Number(arg('clip', 0.1))   // 1回に動かすボスの倍率の幅（±10%）
  const keep = Number(arg('keep', 4))     // 平均を採る後半の回の数
  // 回を追うごとに動かす幅を小さくする（0.7なら 10%→7%→4.9%…）。終盤の場所は戦闘力の伸びがゆっくりで、
  // ボスの倍率を少し動かすだけで倒せる時間が大きく動く＝同じ幅のままだと行ったり来たりして収まらない
  const anneal = Number(arg('anneal', 1))
  // 標準の戦闘力（STD_RATIO）を、測った値へ1回でどれだけ近づけるか（0.5なら差の半分ずつ・掛け算で）。
  // ⚠1（測った値へそのまま置き換え）だと、出発点が遠いときに 速すぎ→遅すぎ→… と振れて収まらない（2026-10-09 実際に踏んだ）。
  //   敵の強さは全部これに掛かるので、ここが一気に動くと全部の場所が一度に振れる
  const stdDamp = Number(arg('stddamp', 0.5))
  // 一部だけ測り直す：--stdmax 27 ならLV27以下の行だけ、--bossmax 4 ならエリア4までのボスの倍率だけを動かす
  //   （序盤だけを新しい前提で合わせ、先は今のまま残すとき。2026-10-12 序盤の敵を弱くしたとき）
  const STD_MAX = Number(arg('stdmax', 999))
  const BOSS_MAX = Number(arg('bossmax', AREA_LIST.length))
  // --bossmin 6 ならエリア6から先のボスの倍率だけを動かす（2026-10-13：エリア1〜5は落ちた装備・6から先はいちばん良い装備で、別々に合わせる）
  const BOSS_MIN = Number(arg('bossmin', 1))
  // ボスの倍率を合わせるときに見る人：--pct 0.7 なら「7割の人が目安の時間までに倒せる」ように（既定0.5＝中央値）。
  //   ⚠中央値で合わせると、職業で「すぐ抜ける組」と「詰まる組」に分かれるボス（古代の番人など）は、ちょうど半分が詰まる強さで止まる
  //   （2026-10-12 序盤を測り直したときに踏んだ）。序盤はだれも詰まらないほうへ寄せる
  const BOSS_PCT = Number(arg('pct', 0.5))
  // --pctmid 0.5 --midfrom 6：エリア6から先は別の割合で合わせる（2026-10-13 ユーザー「相性悪い職業だったら戦闘力も十分に上げないと
  //   クリアできないようにしたい、中盤以降は」＝中盤からは真ん中の人に合わせる。序盤は7割の人のまま）
  const MID_FROM = Number(arg('midfrom', 99))
  const PCT_MID = Number(arg('pctmid', BOSS_PCT))
  const pctOf = (k) => (k + 1 >= MID_FROM ? PCT_MID : BOSS_PCT)
  // --pacetune（2026-10-30）：ボスは「目安どおりに進んだ人」（simulate の pace）で合わせる＝③が開いてから（〇-②の目安の時間）
  //   ③のボスに初めて勝つまでの時間が、③の持ち時間（〇-②の目安〜〇-③の目安＝エリアの時間の半分）になるように。
  //   勝てないまま持ち時間が過ぎた人は「持ち時間の2倍」と数える。どの人も全部のエリアに目安どおりに着くので、エリアごとに別々に合わせられる
  //   ⚠前の合わせ方（実際に進む人の「エリアに入ってから③を倒すまで」）は、1つのエリアで遅れると後ろのエリア全部が遅れ、
  //     後ろほど来られる人が減って合わせにくかった（2026-10-30 エリア12から先は22人中0〜3人）。標準の戦闘力・強化の倍率も目安どおりの人で測る
  const PACE = process.argv.includes('--pacetune')
  const jobsOf = () => classes.flatMap(c => seeds.map(s => ({ hours: HOURS, seed: s, start: c, pace: PACE })))
  // 標準の戦闘力：そのLVに着いたときの戦闘力（本体に対する倍率）の平均へ、damp の割合で近づける
  //   ★LVが STD_FIXED_LV 以下の行は動かさない（始まりの森①の敵を、装備なしのLV1で勝てる強さに保つ・ユーザー指示「未装備でも倒せるように」）
  //   倍率はLVが上がって下がってもよい（ステータスポイントにしてから、実際の倍率はLV34あたりが山で少しずつ下がる）。
  //   ただし標準の戦闘力（本体×倍率）は1LVごとに下がらないように：本体は1LVで3以上増えるので、
  //   倍率の下がり方を「次の行の倍率 ≥ 前の行 × 本体(次) ÷ (本体(次)＋3×LVの差)」までにする（v2cap.test.js が全LVで見る）
  //   ⚠前は「倍率がLVで下がらない」にしていて、一度高く測った行の値が後ろの行へ全部うつって戻らなかった
  // --stdkeepmin 20：LV20以下の行は、出発点より下げない（2026-10-12 ユーザー「序盤の敵が弱すぎる」で1.6倍などにした行を、測り直しで弱くしない）
  const STD_KEEP_MIN = Number(arg('stdkeepmin', 0))
  const startStd = areas.STD_RATIO.map(r => r[1])
  const updateStd = (results, damp) => {
    const acc = {}
    for (const r of results) for (const [lv, arr] of Object.entries(r.powerByLv)) for (const p of arr) (acc[lv] ||= []).push(p / bodyPowerAt(Number(lv)))
    areas.STD_RATIO.forEach((row, i) => {
      if (row[0] <= STD_FIXED_LV || row[0] > STD_MAX) return
      const vals = []
      for (let l = row[0] - 2; l <= row[0] + 2; l++) if (acc[l]) vals.push(...acc[l])
      if (vals.length) row[1] = round2(row[1] * Math.pow(vals.reduce((a, b) => a + b, 0) / vals.length / row[1], damp))
      if (row[0] <= STD_KEEP_MIN) row[1] = Math.max(row[1], startStd[i])
    })
    for (let i = 1; i < areas.STD_RATIO.length; i++) {
      const [l0, r0] = areas.STD_RATIO[i - 1]
      const l1 = areas.STD_RATIO[i][0]
      const b1 = bodyPowerAt(l1)
      const floor = Math.ceil(r0 * b1 / (b1 + 3 * (l1 - l0)) * 100) / 100
      areas.STD_RATIO[i][1] = Math.max(areas.STD_RATIO[i][1], floor)
    }
    areas.resetEnemyCache()   // 敵の戦闘力の表を作り直す
  }
  // 強化の倍率（ENH_MULT）：そのエリアにいる間の「強化つき÷強化なし」の戦闘力の平均へ、damp の割合で近づける
  //   （2026-10-13〜 鍛冶屋を実際に使う人＝見込みの強化値が上限。見込みが+0のエリアは1のまま）。来た人がいないエリアは動かさない
  const updateEnh = (results, damp) => {
    areas.ENH_MULT.forEach((m, k) => {
      if (areas.ASSUMED_PLUS[k] === 0) { areas.ENH_MULT[k] = 1; return }
      let sum = 0, n = 0
      for (const r of results) { const v = r.enhByArea?.[k + 1]; if (v) { sum += v.sum; n += v.n } }
      if (n) areas.ENH_MULT[k] = round2(m * Math.pow(sum / n / m, damp))
    })
    areas.resetEnemyCache()
  }
  // --stdinit：仕組みを変えた直後など、出発点が遠いときは、前の係数のまま1回まわして測った値をそのまま出発点にする
  //   （少しずつ近づけている間に、古い標準のまま合わせたボスの倍率が行き過ぎて振れるのを防ぐ）
  if (process.argv.includes('--stdinit')) {
    const first = await runMany(jobsOf())
    updateStd(first, 1)
    updateEnh(first, 1)
    console.log(`--- 出発点（測った標準の戦闘力）: ${areas.STD_RATIO.map(([l, r]) => `LV${l} ${r}`).join(' ')}`)
    console.log(`--- 出発点（測った強化の倍率）: ${areas.ENH_MULT.join(' ')}`)
  }
  // ボスの倍率が「前のボスからの決まり」（〇-③は〇-①×BOSS_TOP_MIN 以上）に負けているエリアは、測り始めに
  //   決まりどおりの強さと同じ値へそろえる（2026-10-30）。下限の0.3などのままだと、強くする向きに動かしても
  //   しばらく決まりの強さに隠れて何も変わらない。そろえても敵の強さそのものは変わらない
  for (let k = 1; k < AREA_LIST.length; k++) {
    const s3 = areas.spotOf(k * 3 + 3)
    const nat = stdPowerAt(areas.enemyLvOf(s3.roster.boss.name, s3.id)) * areas.bossRatioOf(s3.id) * (areas.ENH_MULT[k] ?? 1)
    const now = areas.enemyBasePowerOf(s3.roster.boss)
    if (now > nat * 1.01) areas.AREA_BOSS[k] = round2(areas.AREA_BOSS[k] * now / nat)
    areas.resetEnemyCache()
  }
  const hist = []
  const meanExp = (id) => { const s = areas.spotOf(id); return (s.exp[0] + s.exp[1]) / 2 }
  const spotHours = (id) => SPOT_HOUR[id - 1] - (id > 1 ? SPOT_HOUR[id - 2] : 0)
  for (let it = 1; it <= rounds; it++) {
    const results = await runMany(jobsOf())

    // 1) 場所ごとの1時間あたりのEXP（中央値）。3人未満しか来ていない場所は、表のEXPの比で前の場所から伸ばす
    const rate = []
    for (let id = 1; id <= LAST_SPOT; id++) {
      const vals = results.filter(r => (r.hoursInSpot[id] || 0) >= 0.02).map(r => (r.expInSpot[id] || 0) / r.hoursInSpot[id])
      rate[id] = vals.length >= 3 || id === 1 ? median(vals) : rate[id - 1] * meanExp(id) / meanExp(id - 1)
    }
    // 目安どおりに進んだときの、その場所の目安の時間までの合計EXP
    const cumAt = [0]
    for (let id = 1; id <= LAST_SPOT; id++) cumAt[id] = cumAt[id - 1] + rate[id] * spotHours(id)
    // 2) 必要EXP：最後のボスの目安（365時間目）に、ちょうどLV100までの合計になるように
    const needNow = level.NEED_PERMIL
    const needNext = Math.max(1, Math.round(needNow * cumAt[LAST_SPOT] / totalExpTo(level.MAX_LV)))
    if (!KEEP_EXP) level.setNeedPermilForTuning(needNext)
    // 3) 必要ClassEXPは回さない（2026-10-12 ユーザー決定「LVの5割」＝jobs.js の JOB_NEED_PCT。必要EXPに合わせて自然に動く）
    // 4) 標準の戦闘力（上の updateStd）と強化の倍率（updateEnh）
    updateStd(results, stdDamp)
    updateEnh(results, stdDamp)
    // 5) ボスの倍率（エリアの値 AREA_BOSS）：そのエリアに入ってから③のボスを倒すまでの時間
    //    （1人ずつの中央値）が目安に近づくように。①②③の倍率（SUB_BOSS）は決まっていて動かさない。
    //    ★2026-10-13〜 エリア2から先の①②のボスは「前の③×1.05・①と③の間」で決まる（areas.js のエリアの境目）＝動かすのは③の強さ
    //    期間内に倒せなかった人は「期間の終わりまで＋30時間」として数える
    //    ★ボスの並びの下限（〇-①＝前の③×BOSS_STEP_IN・③は①×BOSS_TOP_MIN 以上）に当たっているエリアは、自分の AREA_BOSS では弱くできない
    //      （強さは前のエリアの③で決まる＝下限の「もと」）。弱くしたいエリアは、もとのエリアの③といっしょに動かす：もとのエリアと、
    //      そこから続けて下限に当たっていて弱くしたいエリアの f の幾何平均で、もとのエリアを動かす（2026-10-30・ずれを組の中で分け合う。
    //      エリア12〜15が下限のまま、強化+10で伸びるエリア11の大ボスにつられて強すぎた）。強くしたいエリアは、下限の強さにそろえてから f を掛ける
    const natOf = (k) => {
      const s3 = areas.spotOf(k * 3 + 3)
      return stdPowerAt(areas.enemyLvOf(s3.roster.boss.name, s3.id)) * areas.bossRatioOf(s3.id) * (areas.ENH_MULT[k] ?? 1)
    }
    const baseOf = (k) => areas.enemyBasePowerOf(areas.spotOf(k * 3 + 3).roster.boss)
    // 下限（前のエリアの③×BOSS_STEP_IN×BOSS_TOP_MIN）が自分の値以上なら「下限で決まっている」（ちょうど同じ＝測り始めにそろえたエリアも、自分では弱くできない）
    const bound = AREA_LIST.map((_, k) => k > 0 && baseOf(k - 1) * areas.BOSS_STEP_IN * areas.BOSS_TOP_MIN >= natOf(k) * 0.999)
    const fs = []
    for (let k = BOSS_MIN - 1; k < Math.min(AREA_LIST.length, BOSS_MAX); k++) {
      const durs = []
      let want = AREA_HOUR[k] - (k ? AREA_HOUR[k - 1] : 0)
      if (PACE) {
        const s3 = k * 3 + 3
        const open = SPOT_HOUR[s3 - 2]
        want = SPOT_HOUR[s3 - 1] - open
        for (const r of results) { const w = r.firstBossWin[s3]; durs.push(w === undefined ? want * 2 : Math.max(0, w - open)) }
      } else {
        for (const r of results) {
          const start = k === 0 ? 0 : r.spotClearHour[k * 3]
          if (start === undefined) continue
          const end = r.spotClearHour[k * 3 + 3]
          durs.push(end === undefined ? HOURS - start + 30 : end - start)
        }
      }
      if (durs.length < 3) continue
      const c = clip * Math.pow(anneal, it - 1)
      let f = Math.min(1 + c, Math.max(1 - c, Math.pow(want / Math.max(0.01, quantile(durs, pctOf(k))), step)))
      // ★そのエリアまで来られたのが半分未満なら、ボスを強くはしない（弱くする向きにだけ合わせる）。
      //   ⚠来られた人だけで合わせると、後ろのエリアは速い職業（盗賊など）だけで決まり、ほかの職業には強すぎるボスになった
      //   （2026-10-10 刀・宝珠と剣士のあとの測定で、エリア13〜15のボスが1.3〜1.5倍になった）。ユーザー承認の直し
      if (durs.length < results.length / 2) f = Math.min(1, f)
      fs[k] = f
    }
    for (let k = 0; k < AREA_LIST.length; k++) {
      const f = fs[k]
      if (f === undefined) continue
      if (bound[k]) {
        if (f < 1) continue   // もとのエリアでいっしょに動かす（下）
        areas.AREA_BOSS[k] = round2(areas.AREA_BOSS[k] * baseOf(k) / natOf(k) * f)   // 下限の強さにそろえてから強くする
        continue
      }
      const group = [f]
      for (let m = k + 1; m < AREA_LIST.length && bound[m] && fs[m] !== undefined && fs[m] < 1; m++) group.push(fs[m])
      const g = Math.exp(group.reduce((t, x) => t + Math.log(x), 0) / group.length)
      areas.AREA_BOSS[k] = round2(Math.max(0.3, areas.AREA_BOSS[k] * g))
    }
    areas.resetEnemyCache()   // ボスの倍率を変えたので、敵の戦闘力の表を作り直す（〇-①のボスは前の③から決まる）
    hist.push({ need: KEEP_EXP ? needNow : needNext, std: areas.STD_RATIO.map(r => r[1]), boss: [...areas.AREA_BOSS], enh: [...areas.ENH_MULT] })

    // ---- 毎回の様子 ----
    const areaDays = AREA_LIST.map((a, k) => {
      const got = results.map(r => (PACE ? r.firstBossWin[k * 3 + 3] : areaClearHour(r, k))).filter(v => v !== undefined)
      return got.length ? `${Math.round(median(got))}(${got.length})` : '-'
    })
    const lv365 = median(results.map(r => r.hourly[Math.min(LV100_HOUR, r.hourly.length) - 1].lv))
    const job30 = median(results.map(r => r.job30Hour ?? HOURS + 60))
    console.log(`--- ${it}回目  365時間目のLV ${lv365}・ClassLV30 ${job30?.toFixed(1)}時間目・必要EXP ${needNow}→${needNext}`)
    console.log(`${PACE ? '目安どおりに進んだ人が' : ''}エリアの③を倒した時間（中央値・目安 ${AREA_HOUR.join('/')}）: ${areaDays.join(' ')}`)
    console.log(`下限で決まっていたエリア: ${bound.map((b, k) => (b ? `E${k + 1}` : null)).filter(Boolean).join(' ') || 'なし'}`)
    // --out：途中で止まっても続きから測れるように、その回の値も書く（${out}.last.json）
    if (arg('out', null)) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(arg('out') + '.last.json', JSON.stringify({ round: it, ...tablesNow() }, null, 1))
    }
  }

  // ---- 後半の回の平均（これを貼る）----
  const last = hist.slice(-keep)
  const avg = (f) => last.reduce((t, h) => t + f(h), 0) / last.length
  console.log(`\n===== 後半${last.length}回の平均（そのまま貼る）=====`)
  console.log(`export let NEED_PERMIL = ${Math.round(avg(h => h.need))}       // level.js と SQL の v2cap_need`)
  console.log('export const STD_RATIO = [\n  ' + areas.STD_RATIO.map(([l], i) => `[${l}, ${round2(avg(h => h.std[i]))}]`).join(', ') + ',\n]')
  console.log('export const AREA_BOSS = [\n  ' + areas.AREA_BOSS.map((_, i) => round2(avg(h => h.boss[i]))).join(', ') + ',\n]')
  console.log('export const ENH_MULT = [' + areas.ENH_MULT.map((_, i) => round2(avg(h => h.enh[i]))).join(', ') + ']')
  // --out：同じ値をJSONでも書く（続きから測る・敵の強さの前後をくらべる道具が読む）
  if (arg('out', null)) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(arg('out'), JSON.stringify({
      need: Math.round(avg(h => h.need)),
      std: areas.STD_RATIO.map(([l], i) => [l, round2(avg(h => h.std[i]))]),
      boss: areas.AREA_BOSS.map((_, i) => round2(avg(h => h.boss[i]))),
      enh: areas.ENH_MULT.map((_, i) => round2(avg(h => h.enh[i]))),
      hpShare: [areas.ENEMY_HP_SHARE.normal, areas.ENEMY_HP_SHARE.boss],
    }, null, 1))
  }
}

// ===== --report：職業別に回して、エリアを抜けた時間と節目のLVを並べる =====
// 初期職10 × seed 2通り
const report = async () => {
  // ★職業の一覧は jobs.js から読む（直書きしていて、職業を足したときに漏れた）
  const classes = jobsLib.START_CLASSES
  const seeds = [11, 12]
  const marks = [3, 7, 14, 30, 90, 180, 270, 365].filter(x => x <= HOURS)
  console.log(`エリアの③を倒した時間（目安 ${AREA_HOUR.join('/')}）／節目の時間のLV／ClassLV30の時間／365時間目のGold`)
  console.log(['職業', ...AREA_LIST.map((_, k) => `E${k + 1}`), '|', ...marks.map(m => `${m}時間`), '|', 'JB30', 'Gold'].join('\t'))
  const all = {}
  const plusAcc = AREA_LIST.map(() => ({ sum: 0, n: 0 }))   // --smith：エリアごとの「着けている装備の強化値の平均」
  const spent = []
  const got = { dismantle: [], chest: [] }   // 残骸の入り方（人ごとの合計）
  const allRuns = await runMany(classes.flatMap(c => seeds.map(s => ({ hours: HOURS, seed: s, start: c }))))
  let ri = 0
  for (const c of classes) {
    for (const s of seeds) {
      const r = allRuns[ri++]
      const row = AREA_LIST.map((_, k) => { const v = areaClearHour(r, k); return v === undefined ? '-' : Math.round(v) })
      AREA_LIST.forEach((_, k) => { const v = areaClearHour(r, k); if (v !== undefined) (all[k] ||= []).push(v) })
      const gold365 = r.hourly[Math.min(365, r.hourly.length) - 1].gold
      console.log([c, ...row, '|', ...marks.map(m => r.hourly[m - 1]?.lv ?? '-'), '|', r.job30Hour === null ? '-' : r.job30Hour.toFixed(1), gold365].join('\t'))
      for (const [a, v] of Object.entries(r.plusByArea || {})) { plusAcc[a - 1].sum += v.sum; plusAcc[a - 1].n += v.n }
      spent.push(r.goldSpent || 0)
      got.dismantle.push(r.scrapGot?.dismantle || 0)
      got.chest.push(r.scrapGot?.chest || 0)
    }
  }
  const runs = classes.length * seeds.length
  console.log('中央値\t' + AREA_LIST.map((_, k) => { const a = all[k] || []; return a.length ? `${Math.round(median(a))}(${a.length}/${runs})` : '-' }).join('\t'))
  // 実際の戦闘力 ÷ 敵の強さの基準（stdPowerAt）。1より大きいほど、敵がその人にとって弱い
  const ratioAt = (lv) => {
    const xs = []
    for (const r of allRuns) for (let l = lv - 2; l <= lv + 2; l++) for (const p of r.powerByLv[l] || []) xs.push(p / stdPowerAt(l))
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '-'
  }
  console.log('実際の戦闘力÷基準（LV10/20/30/40/50/60/70/80/90）\t' + [10, 20, 30, 40, 50, 60, 70, 80, 90].map(ratioAt).join('\t'))
  // 戦いの長さ（勝った戦い・全員まとめて）：ボス戦のターン数の中央値・ふつうの敵の平均（2026-10-30）
  const bossT = AREA_LIST.map((_, k) => median(allRuns.flatMap(r => r.turnsByArea?.[k + 1]?.boss || [])))
  const normT = AREA_LIST.map((_, k) => {
    let n = 0, sum = 0
    for (const r of allRuns) { const t = r.turnsByArea?.[k + 1]; if (t) { n += t.n; sum += t.sum } }
    return n ? (sum / n).toFixed(1) : '-'
  })
  // 推奨LVの確かめ（areas.js の SPOT_REC_LV＝その場所の目安の時間に真ん中の人が何LVか・2026-10-13 の測り方）：③の場所だけ並べる
  console.log('③の目安の時間のLV（中央値）\t' + AREA_LIST.map((_, k) => median(allRuns.map(r => r.lvAtSpotHour[k * 3 + 3]).filter(v => v !== undefined)) ?? '-').join('\t'))
  console.log('いまの推奨LV（③）\t' + AREA_LIST.map((_, k) => areas.recLvOf(k * 3 + 3)).join('\t'))
  // 最後にいた場所（止まっている場所）の人数（2026-10-30・どのボスが壁になっているかを見る）
  const endAt = {}
  for (const r of allRuns) { const sp = r.hourly[r.hourly.length - 1].spot; endAt[sp] = (endAt[sp] || 0) + 1 }
  console.log(`${HOURS}時間目にいた場所（人数）\t` + Object.entries(endAt).sort((a, b) => a[0] - b[0])
    .map(([sp, n]) => { const s = areas.spotOf(Number(sp)); return `${s.area}-${'①②③'[s.sub - 1]} ${n}人` }).join('・'))
  console.log('ボス戦のターン数（勝った戦い・中央値）\t' + bossT.map(v => v ?? '-').join('\t'))
  console.log('ふつうの敵のターン数（勝った戦い・平均）\t' + normT.join('\t'))
  if (SMITH_ON) {
    console.log('強化値の平均（そこにいる間）\t' + plusAcc.map(v => (v.n ? (v.sum / v.n).toFixed(1) : '-')).join('\t'))
    console.log('見込みの強化値\t' + areas.ASSUMED_PLUS.map(p => `+${p}`).join('\t'))
    console.log(`強化に使ったGold（中央値）\t${median(spent)}`)
    // 残骸がどこから入ったか（2026-10-14 宝箱を足したとき：分解だけのころとくらべるため）
    const perHour = (v) => (v / HOURS).toFixed(1)
    console.log(`残骸の入り方（${HOURS}時間の合計の中央値・1時間あたり）\t分解 ${median(got.dismantle)}（${perHour(median(got.dismantle))}）・宝箱 ${median(got.chest)}（${perHour(median(got.chest))}）`)
  }
}

// ===== --pace：目安どおりに進んだ人の戦闘力の伸びと、ボスの強さをくらべる（2026-10-30）=====
// ボスの並びの決まり（〇-①＝前の③×BOSS_STEP_IN・③は①の BOSS_TOP_MIN 倍以上＝1エリアで約6%）に、目安どおりに進んだ人の伸びが追いつくかを見る。
//   初期職×2人を、ボスに勝ったかどうかに関係なく目安の時間どおりに進め（simulate の pace）、各エリアの③の目安の時間の戦闘力（強化・アセンションこみ）を並べる
const paceReport = async () => {
  const classes = jobsLib.START_CLASSES
  const seeds = String(arg('seeds', '11,12')).split(',').map(Number)
  const runs = await runMany(classes.flatMap(c => seeds.map(s => ({ hours: Math.max(HOURS, 366), seed: s, start: c, pace: true }))))
  console.log(`目安どおりに進んだ人（${classes.length}職×${seeds.length}人）の戦闘力（中央値）と、各エリアの③のボス`)
  console.log(['エリア', '目安', '自分', '前のエリアから', '③のボス', '前のエリアから', 'ボス÷自分', 'LV', '勝率（その1時間）'].join('	'))
  let prev = null, prevBoss = null
  AREA_LIST.forEach((a, k) => {
    const h = AREA_HOUR[k]
    const p = median(runs.map(r => r.hourly[Math.max(0, Math.ceil(h) - 1)]?.power).filter(Boolean))
    const boss = areas.enemyPowerOf(areas.spotOf(k * 3 + 3).roster.boss)
    const at = (f) => median(runs.map(r => f(r.hourly[Math.max(0, Math.ceil(h) - 1)])).filter(v => v !== undefined))
    console.log([`E${k + 1}`, `${h}h`, p, prev ? `×${(p / prev).toFixed(3)}` : '-', boss, prevBoss ? `×${(boss / prevBoss).toFixed(3)}` : '-', (boss / p).toFixed(2),
      at(v => v?.lv), `${Math.round(at(v => v?.win) * 100)}%`].join('	'))
    prev = p
    prevBoss = boss
  })
}

// ===== --statvalue：職業ごとに「どのステを足すと③のボスに効くか」を測る（STAT_WEIGHT を作る）=====
//   土台＝そのLVの本体の期待値＋クラスのステ（ClassLV30）＋装備ぶん（本体の1.2倍を STR/DEX/AGI/INT/VIT に等分）。
//   スキルはふつうの並べ方（全部覚えた状態）。1つのステに「装備ぶんの10%」を足したとき、
//   ③のボスに勝率50%になるボスの強さ（本物の何倍か）が何%上がるか。エリア3/6/9/12の平均
//   ★いちばん左の「強さ」は、同じステの職業どうしの強さの比べ（平均を100%）
const statValue = async () => {
  const { slotsOf } = await import(B + 'v2cap/lib/loadout.js')
  const { skillsOf } = await import(B + 'v2cap/lib/skills.js')
  // ★職業の一覧は jobs.js から読む。--only 剣士 のように一部だけも測れる（重みは職業ごとに決まるので、ほかの職業と一緒でなくてよい）
  const classes = arg('only', null) ? String(arg('only')).split(',') : jobsLib.START_CLASSES
  const checks = String(arg('areas', '3,6,9,12')).split(',').map(Number)
  const n = Number(arg('n', 500))
  const GEAR = ['str', 'dex', 'agi', 'int_stat', 'vit']
  const baseStats = (cls, lv) => {
    const job = jobsLib.jobBonusStats(cls, JOB_MAX)
    const gear = bodyPowerAt(lv) * 1.2
    // 本体＝初期値＋そのLVまでのポイントをクラスと同じ割合で振ったもの
    const seq = jobsLib.bonusSeqOf(cls)
    const body = { ...INITIAL_STATS }
    for (let i = 0; i < totalPointsTo(lv); i++) body[seq[i % seq.length]] += POINT_UNIT[seq[i % seq.length]]
    return Object.fromEntries(STAT_KEYS.map(k => [k, body[k] + job[k]
      + (GEAR.includes(k) ? Math.round(gear / GEAR.length) : 0)]))
  }
  // ★この版の決まり（CAP_RULES）は出撃と同じく味方・敵の両方に混ぜる（敵は出撃と同じ enemyFighter で作る）
  const fighter = (cls, stats) => ({
    ...CAP_RULES,
    name: 'me', cls, kind: attackKindOf(cls), stats, taken: null, enchants: [], evolutions: [],
    slots: slotsOf(typicalSet(cls, skillsOf(cls).map(s => s.name), stats.mp), cls),
  })
  const foeOf = (boss, m) => ({
    ...enemyFighter(boss, 8, Math.max(1, Math.round(areas.enemyPowerOf(boss) * m))), boss: true,
  })
  const winRate = (me, foe) => {
    let w = 0
    for (let i = 0; i < n; i++) if (runBattle(me, foe, { rng: rngOf(5 + i * 7919) }).winner === 'a') w++
    return w / n
  }
  // 勝率がちょうど半分になるボスの強さ（本物の何倍か）
  const m50 = (me, boss) => {
    let lo = 0.05, hi = 8
    for (let i = 0; i < 12; i++) {
      const mid = Math.sqrt(lo * hi)
      if (winRate(me, foeOf(boss, mid)) > 0.5) lo = mid
      else hi = mid
    }
    return Math.sqrt(lo * hi)
  }
  const gain = Object.fromEntries(classes.map(c => [c, Object.fromEntries(GEAR.map(k => [k, 0]))]))
  const power = Object.fromEntries(classes.map(c => [c, 0]))
  for (const area of checks) {
    const lv = areas.spotLvOf(area * 3)[1]
    const boss = areas.spotOf(area * 3).roster.boss
    const delta = Math.round(bodyPowerAt(lv) * 1.2 * 0.1)
    const ms = {}
    for (const cls of classes) {
      const st = baseStats(cls, lv)
      ms[cls] = m50(fighter(cls, st), boss)
      for (const k of GEAR) gain[cls][k] += (m50(fighter(cls, { ...st, [k]: st[k] + delta }), boss) / ms[cls] - 1) * 100 / checks.length
    }
    const avg = classes.reduce((t, c) => t + ms[c], 0) / classes.length
    for (const c of classes) power[c] += ms[c] / avg * 100 / checks.length
    console.log(`エリア${area}（LV${lv}・${boss.name}）: ` + classes.map(c => `${c} ${Math.round(ms[c] / avg * 100)}%`).join('・'))
  }
  console.log('\n同じステでの強さ（平均100%）: ' + classes.map(c => `${c} ${Math.round(power[c])}%`).join('・'))
  console.log('\n===== STAT_WEIGHT（そのまま貼る）=====\nexport const STAT_WEIGHT = {')
  for (const c of classes) {
    const mx = Math.max(...Object.values(gain[c]))
    const w = GEAR.map(k => [k, Math.max(0, Math.round(gain[c][k] / mx * 100) / 100)]).sort((a, b) => b[1] - a[1])
    console.log(`  ${(c + ':').padEnd(6, '　')} { ${w.map(([k, v]) => `${k}:${v.toFixed(2)}`).join(', ')} },`)
  }
  console.log('}')
}

// ===== --enh：装備の強化の見込みで、エリアごとに自分の戦闘力が何倍になるか（areas.js の ENH_MULT を作る）=====
// 【確定】2026-10-13 ユーザー指示（areas.js の ASSUMED_PLUS）。敵はこの倍率だけ強くする。
// 数える人は、敵の強さを測るときと同じ「落ちた装備＋鍛冶屋（見込みの強化値が上限）」（450時間）。
// 初期職全部×乱数2通り。そのエリアにいる間の1時間ごとの「強化つき÷強化なし」の戦闘力を全員で平均する（--tune も毎回これで作り直す）
const enh = () => {
  const classes = jobsLib.START_CLASSES
  const seeds = [1, 2]
  const runs = [{ gear: 'drops', hours: 450, from: 1, to: AREA_LIST.length }]
  const acc = AREA_LIST.map(() => ({ sum: 0, n: 0 }))
  for (const run of runs) for (const c of classes) for (const s of seeds) {
    const r = simulate({ hours: run.hours, seed: s, start: c, gear: run.gear })
    for (const [a, v] of Object.entries(r.enhByArea)) {
      if (Number(a) < run.from || Number(a) > run.to) continue
      acc[a - 1].sum += v.sum
      acc[a - 1].n += v.n
    }
  }
  const mult = acc.map((v, k) => (areas.ASSUMED_PLUS[k] > 0 && v.n ? round2(v.sum / v.n) : 1))
  console.log('見込みの強化値: ' + areas.ASSUMED_PLUS.map((p, k) => `E${k + 1}+${p}`).join(' '))
  console.log('数えた時間（のべ）: ' + acc.map((v, k) => `E${k + 1}:${v.n}`).join(' '))
  console.log('\n===== ENH_MULT（そのまま貼る）=====')
  console.log('export const ENH_MULT = [' + mult.join(', ') + ']')
}

// ===== --shrine：安息の祠のハピネスフェアリーに勝てるか =====
// 【確定】2026-10-13 ユーザー決定「弱い（ほぼ必ず勝てる）」の確かめ（src/v2cap/lib/shrine.js の SHRINE_FAIRY_RATIO）。
//   初期職×2人を回し、1時間ごとに「いまの場所（開いている一番先）のハピネスフェアリー」と別の乱数で10戦する
//   （本筋の進み方は変えない）。エリアごとに、フェアリーの勝率（全員・いちばん低い人）とふつうの敵（ボス以外）の勝率を並べる
const shrineReport = () => {
  const classes = jobsLib.START_CLASSES
  const seeds = [11, 12]
  const fairy = AREA_LIST.map(() => ({ n: 0, win: 0 }))
  const normal = AREA_LIST.map(() => ({ n: 0, win: 0 }))
  const worst = AREA_LIST.map(() => null)
  for (const c of classes) for (const s of seeds) {
    const prng = rngOf(s * 7919 + c.length)
    const mine = AREA_LIST.map(() => ({ n: 0, win: 0 }))
    const r = simulate({ hours: HOURS, seed: s, start: c, probe: ({ spot, fighter }) => {
      const enc = shrineEncounterOf(spot)
      const a = enc.spot.area - 1
      for (let i = 0; i < 10; i++) {
        const win = runBattle(fighter(), { ...enemyFighter(enc.enemy, 8, enc.power), boss: false }, { rng: prng }).winner === 'a'
        fairy[a].n++; mine[a].n++
        if (win) { fairy[a].win++; mine[a].win++ }
      }
    } })
    for (const [spot, fs] of Object.entries(r.fightsInSpot)) {
      const a = areas.spotOf(Number(spot)).area - 1
      normal[a].n += fs.n - fs.boss
      normal[a].win += fs.win - fs.bossWin
    }
    mine.forEach((v, a) => { if (v.n) worst[a] = Math.min(worst[a] ?? 1, v.win / v.n) })
  }
  const pct = (v) => (v.n ? `${(v.win / v.n * 100).toFixed(1)}%` : '-')
  console.log(`ハピネスフェアリーの勝率（${classes.length}職×${seeds.length}人・${HOURS}時間・1時間ごとにいまの場所で10戦）`)
  console.log(['エリア', 'フェアリー', 'いちばん低い人', 'ふつうの敵（ボス以外）', '数えた戦闘'].join('\t'))
  AREA_LIST.forEach((ar, a) => {
    console.log([`E${a + 1} ${ar.name}`, pct(fairy[a]), worst[a] === null ? '-' : `${(worst[a] * 100).toFixed(0)}%`, pct(normal[a]), fairy[a].n].join('\t'))
  })
  const all = fairy.reduce((t, v) => ({ n: t.n + v.n, win: t.win + v.win }), { n: 0, win: 0 })
  console.log(`全体：${pct(all)}`)
}

// ===== --tower：塔の空いている層のNPCにどれだけ勝てるか（2026-10-14）=====
// 【確定】2026-10-14 ユーザー決定「負けたら2つ下（あるけみと同じ）」＝上がっていくには3回に2回より多く勝つ必要がある。
//   空いている層のNPCは「n層＝LVnの標準の強さ」と「挑戦する人の戦闘力×NPC_MIN_RATIO」の高いほう（src/v2cap/lib/tower.js）。
//   その倍率を決めるため、初期職×2人を回し、決まった時間に「いまの自分」と、強さ＝自分の戦闘力×倍率 のNPCを別の乱数で戦わせる
//   （NPCの層＝職業・技は「1層〜自分のLVの層」から均等に選ぶ＝下から上っていくときに会う相手。本筋の進み方は変えない）。
//   対人のHP倍率（pvp.js）も掛けるので、ターン数（8〜10の目安）も一緒に見る
const towerReport = () => {
  const classes = jobsLib.START_CLASSES
  const seeds = String(arg('seeds', '1,2')).split(',').map(Number)
  const ratios = String(arg('ratios', '0.5,0.6,0.7,0.8,0.9,1')).split(',').map(Number)
  const n = Number(arg('n', 8))
  const hoursAt = [3, 7, 14, 30, 60, 120, 240, 365, 450].filter(h => h <= HOURS)
  const BANDS = [[1, 24, 'LV1〜24'], [25, 49, 'LV25〜49'], [50, 79, 'LV50〜79'], [80, 100, 'LV80〜']]
  const bandOf = (lv) => BANDS.findIndex(([lo, hi]) => lv >= lo && lv <= hi)
  const acc = BANDS.map(() => ratios.map(() => ({ n: 0, win: 0, turns: [] })))
  const byCls = {}   // そのときの職業 → 倍率ごとの { n, win }
  for (const c of classes) for (const s of seeds) {
    const prng = rngOf(s * 104729 + c.length * 31)
    simulate({ hours: HOURS, seed: s, start: c, probe: ({ hour, lv, fighter }) => {
      if (!hoursAt.includes(hour)) return
      const me = fighter()
      const myPower = calcPower(me.stats)
      const band = bandOf(lv)
      ratios.forEach((r, ri) => {
        for (let i = 0; i < n; i++) {
          const floor = 1 + Math.floor(prng() * Math.max(1, Math.min(tower.FLOORS, lv)))
          const npc = tower.npcFighterAt(floor, myPower * r)
          const champ = { ...npc, playerId: null, hpPm: 1000, mpNow: npc.stats.mp, streak: 0 }
          const { a, b } = tower.towerBattleOf({ me, myLv: lv, champ, floor })
          const res = runBattle(a, b, { rng: prng })
          const win = res.winner === 'a'
          const v = acc[band][ri]
          v.n++; if (win) v.win++
          v.turns.push(res.turns)
          const k = (byCls[me.cls] ||= ratios.map(() => ({ n: 0, win: 0 })))[ri]
          k.n++; if (win) k.win++
        }
      })
    } })
  }
  const pct = (v) => (v.n ? `${Math.round(v.win / v.n * 100)}%` : '-')
  const med = (a) => { if (!a.length) return '-'; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
  console.log(`塔のNPC（強さ＝自分の戦闘力×倍率）への勝率（${classes.length}職×${seeds.length}人・${hoursAt.join('/')}時間目・倍率ごとに${n}戦・NPCの層は1〜自分のLVから）`)
  console.log(['LV', ...ratios.map(r => `×${r}`)].join('\t'))
  BANDS.forEach(([, , label], b) => console.log([label, ...acc[b].map(pct)].join('\t')))
  const all = ratios.map((_, ri) => acc.reduce((t, row) => ({ n: t.n + row[ri].n, win: t.win + row[ri].win }), { n: 0, win: 0 }))
  console.log(['全体', ...all.map(pct)].join('\t'))
  console.log('\nターン数の中央値（勝ち負けとも）')
  BANDS.forEach(([, , label], b) => console.log([label, ...acc[b].map(v => med(v.turns))].join('\t')))
  console.log(`\n職業ごと（いまの NPC_MIN_RATIO＝${tower.NPC_MIN_RATIO} に近い倍率の列）`)
  const ri = ratios.reduce((best, r, i) => (Math.abs(r - tower.NPC_MIN_RATIO) < Math.abs(ratios[best] - tower.NPC_MIN_RATIO) ? i : best), 0)
  console.log(Object.entries(byCls).map(([c, v]) => `${c} ${pct(v[ri])}（${v[ri].n}戦）`).join('　'))
}

if (!isMainThread) {
  // 同時に回す人（上の runMany）。下の CLI は動かさない
} else if (process.argv.includes('--tune')) {
  await tune()
} else if (process.argv.includes('--shrine')) {
  shrineReport()
} else if (process.argv.includes('--tower')) {
  towerReport()
} else if (process.argv.includes('--enh')) {
  enh()
} else if (process.argv.includes('--report')) {
  await report()
} else if (process.argv.includes('--pace')) {
  await paceReport()
} else if (process.argv.includes('--statvalue')) {
  await statValue()
} else if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('v2cap-progress.mjs')) {
  const r = simulate()
  const pick = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 240, 270, 300, 365].filter(x => x <= HOURS)
  if (!QUIET) {
    console.log(`職業=${START} seed=${SEED}`)
    console.log('時間\tLV\t戦闘力\t(本体)\t勝率\t場所\tClassLV\tGold')
    for (const x of pick) {
      const v = r.hourly[x - 1]
      console.log(`${x}\t${v.lv}\t${v.power}\t(${v.body})\t${(v.win * 100).toFixed(0)}%\t${areas.spotLabel(v.spot)}\t${v.jlv}\t${v.gold}`)
    }
    console.log('エリアの③を倒した時間:', AREA_LIST.map((a, k) => { const v = areaClearHour(r, k); return `${a.name}${v === undefined ? '-' : Math.round(v * 10) / 10}` }).join(' '))
    console.log('ClassLV30:', r.job30Hour === null ? '-' : `${r.job30Hour.toFixed(1)}時間目`)
    const lvs = [1, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    console.log('LVごとの平均戦闘力（実測 / stdPowerAt）:', lvs.map(l => {
      const a = r.powerByLv[l]; const m = a ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '-'
      return `${l}:${m}/${stdPowerAt(l)}`
    }).join(' '))
  }
}
