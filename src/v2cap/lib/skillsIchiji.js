// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 一次職のスキル（20職×8技＋パッシブ1つずつ）
// ------------------------------------------------------------
// 【確定】2026-10-10 ユーザーの表「一次職スキル一覧」（Claude Docs https://claude.ai/artifact/ToS4Bvfh5nNaykdt5ToEEn）。
//   名前・消費MP・発動率・倍率・効果はその表のまま（desc は表の「内容」）。並び＝覚える順（ClassLV1／5／10／15／20／25／30／40）。
//   パッシブは各職に1つで、転職した時点で効く（スキル枠は使わない）。
//   ★今のⅡと同じ名前の技がある（マッドラッシュ・天墜竜閃 など・表の「過去作の名前も引き継ぐ」）。中身はこの版のもの
//     （この版は名前を自分の名簿＝skills.js の SKILL_BY_NAME で引くので、今のⅡの技とは混ざらない）
//
// 戦闘で使う項目（今のⅡの戦闘エンジン src/v2/lib/battle.js が読む）
//   今からあるもの … kind・mult・add・hits・noCrit・sureHit・defPen・buff（self/enemy）・buffTurns・ail・ailPerHit・
//     drain・heal・dispel・consumeAil・vsAil・priority
//   一次職で足したもの（battle.js の「一次職の仕組み」）…
//     hpCostMax {pct, ifAbove}  最大HPの割合を払う（ifAbove％以上のときだけ）
//     recoil                    与えたダメージのこの割合を自分も受ける
//     lifeSteal {pct, turns}    その間、攻撃のたびに与えたダメージのpct％を回復
//     selfLowHp {at, mult}      自分のHPがat％以下なら威力×mult
//     guard {cut, turns, healPct?}  その間、受けるダメージ−cut％（healPct＝減らしたぶんの何％を回復）
//     revenge                   直前に受けたダメージのこの割合を威力に足す
//     endure {turns, pct}       その間に受けたダメージの合計のpct％を、終わったときに相手へ与える
//     jump {turns, mult}        跳んで turns ターン敵の攻撃を受けず、着地で物理×mult
//     afterLand                 直前のターンに着地していれば威力×これ
//     comboHits {at, hits}      コンボがat以上なら連撃数をhitsに
//     hitMults [..]             1発ごとの倍率（連撃数＝長さ）
//     dodgeBoost {turns, pct, max}  その間、回避するたびに次の攻撃+pct％（max回ぶんまで）
//     critIfDodged              直前のターンに回避していれば全段クリティカル
//     gain {key, n, max}        溜め（気 ki・照準 aim・装填 load・詠唱 chant・薬効 potion・死霊 undead・式神 shiki・分身 clone）を増やす
//     nextBoost {key, kind, per}  溜めを次の物理／魔法の攻撃で全部使い、1つにつき威力+per％
//     needStack {key, n}        溜めがn以上ないと出ない（出ないときは不発＝通常攻撃）
//     useOne {key, n, mult}     溜めをn使えれば威力×mult（無くても撃てる）
//     useAll {key, per?, addMult?}  溜めを全部使い、1つにつき 威力×(1+per) ／ 倍率+addMult
//     burstAil {key, perStack}  相手の状態異常（出血はスタック数）を全部使い、1つにつき威力+（今のⅡの consumeAil と違い全体に掛かる）
//     ★「威力+％」「与ダメージ+％」は、AGI・DEXなど副参照のぶんも含めたダメージ全体に掛ける（battle.js の ichijiK）
//     perStack {key, pct}       溜め1つにつき威力+pct％（使わない）
//     drainPerStack {key, pct}  溜め1つにつき吸収+pct（割合）
//     hitsPerStack {key, n}     溜め1つにつき連撃+n
//     firstTurn {mult, crit}    戦闘の1ターン目なら威力×mult・クリティカル率+crit
//     critBonus                 クリティカル率+（その技だけ）
//     critUp                    クリティカル率+（バフ・戦闘中ずっと）
//     critMult                  クリティカルしたときのダメージ×これ
//     hybrid {phys, mag}        物理（STR・VITで受ける）と魔法（INT・INTで受ける）の両方で殴る
//     ails [{key, chance}]      状態異常を2つ以上（それぞれ判定）
//     selfStun                  使ったあと、このターン数だけ行動できない
//     elem                      魔法の属性（魔導士の元素共鳴が見る）
//     extraTurn {max}           このターン、もう一度行動する（戦闘中max回まで）
//     rewind {turns, pct}       直前turnsターンで受けたダメージのpct％を回復
//     agiDiff {per, max}        自分のAGIが相手より高い割合1％につき威力+per％（最大max％）
//     summon {key, n, max, mult}  召喚（死霊・式神）。毎ターン魔法×multで攻撃する
//     summonBoost {key, pct, turns} ／ summonHits {key, hits, turns}  召喚の攻撃を強くする／連撃にする
//     noRepeat                  続けては使えない（直前に使っていれば次の技へ回す）
//     regenMax {pct, turns}     その間、毎ターン最大HPのpct％を回復
//     healMax                   最大HPのこの％を回復 ／ mpGain＝MPをこれだけ回復 ／ mpHeal {rate}＝INT×rateのMPを回復
//     revive {pct}              戦闘中1回、HPが0になったらHPpct％で立ち上がる
//     healDmg {pct, capMult}    この戦闘で回復したHPのpct％を足す（上限は魔法×capMultぶん）
//     vsRace {races, mult}      相手がその種族なら威力×mult（★敵の種族はあとでまとめて足す＝いまは効かない）
//     vsAilMult {key, mult}     相手がその状態異常なら威力×mult
//     debuffImmune {turns}      その間、自分の能力低下を受けない
//     consumeAllAil {per, max}  相手の状態異常をすべて解除し、1つにつき威力+per％（最大max％）
//   パッシブ（passive）… lowHpDmg・immune・statPct・landPct・combo・counterOnDodge・perStackDmg・perFoeBleed・
//     cloneFollow・noCloneAgi・perFoeAil・critFollow・vsAnyAil・whileStackGuard・elemSwitch・chantBonus・extraIfFaster・
//     guardPerStack・whileSummonOrGuard・healBonus・vsRaceOrAil・bothAil・vsDebuff
// ============================================================
const P = 'phys'
const M = 'mag'
const B = 'buff'
const H = 'heal'

export const ICHIJI_SKILLS = [
  // ===== 戦士系 =====
  // 狂戦士：HPを削るほど強くなる短期決戦型
  { name:'バーサク', cls:'狂戦士', kind:'passive', mp:0, passive:{ lowHpDmg:[{ at:50, pct:15 }, { at:25, pct:30 }] }, desc:'HP50%以下で与ダメージ+15%、25%以下で+30%' },
  { name:'マッドラッシュ', cls:'狂戦士', kind:P, mult:1.45, proc:95, mp:6, hpCostMax:{ pct:2, ifAbove:50 }, desc:'物理 ×1.45・自分のHPが50%以上なら、最大HPの2%を消費' },
  { name:'血風斬', cls:'狂戦士', kind:P, mult:1.5, proc:85, mp:12, drain:0.15, desc:'物理 ×1.5・与えたダメージの15%をHP回復' },
  { name:'狂乱の咆哮', cls:'狂戦士', kind:B, proc:100, mp:10, buff:{ self:{ str:20 } }, ail:{ key:'fear', chance:40 }, priority:1, desc:'自分のSTR+20%・40%で相手に恐怖' },
  { name:'ブラッドスプラッシュ', cls:'狂戦士', kind:P, mult:1.3, proc:88, mp:11, ail:{ key:'bleed', chance:50 }, desc:'物理 ×1.3・50%で出血' },
  { name:'狂撃', cls:'狂戦士', kind:P, mult:1.9, proc:85, mp:14, recoil:0.15, desc:'物理 ×1.9・与えたダメージの15%を自分も受ける' },
  { name:'ブラッディロア', cls:'狂戦士', kind:B, proc:100, mp:14, lifeSteal:{ pct:10, turns:4 }, priority:1, desc:'4ターンの間、攻撃のたびに与えたダメージの10%をHP回復' },
  { name:'血の誓い', cls:'狂戦士', kind:B, proc:100, mp:10, hpCostMax:{ pct:10 }, buff:{ self:{ str:30 } }, priority:1, desc:'自分の最大HPの10%を消費し、STR+30%' },
  { name:'フルブレイカー', cls:'狂戦士', kind:P, mult:2.0, proc:80, mp:22, defPen:0.3, selfLowHp:{ at:25, mult:1.2 }, desc:'物理 ×2.0・相手の防御を30%無視。自分のHPが25%以下なら×2.4' },
  // 重戦士：受けたダメージを力に変える長期戦型
  { name:'不動', cls:'重戦士', kind:'passive', mp:0, passive:{ immune:['paralyze', 'slow'], statPct:{ vit:10 } }, desc:'麻痺・鈍足にかからない・VIT+10%' },
  { name:'重撃', cls:'重戦士', kind:P, mult:0.9, add:[{ stat:'vit', rate:0.6 }], proc:95, mp:6, desc:'物理 ×0.9＋VIT×0.6' },
  { name:'鉄壁', cls:'重戦士', kind:B, proc:100, mp:10, buff:{ self:{ vit:30 } }, priority:1, desc:'自分のVIT+30%' },
  { name:'受け止め', cls:'重戦士', kind:B, proc:100, mp:8, guard:{ cut:20, turns:3 }, priority:1, desc:'3ターンの間、受けるダメージ-20%' },
  { name:'グランドスラム', cls:'重戦士', kind:P, mult:1.0, add:[{ stat:'vit', rate:0.8 }], proc:85, mp:13, buff:{ enemy:{ vit:-15 } }, desc:'物理 ×1.0＋VIT×0.8・相手のVIT-15%' },
  { name:'報復の一撃', cls:'重戦士', kind:P, mult:1.0, proc:85, mp:12, revenge:0.5, desc:'物理 ×1.0＋直前に受けたダメージの50%' },
  { name:'忍耐', cls:'重戦士', kind:B, proc:100, mp:14, endure:{ turns:4, pct:40 }, priority:1, desc:'4ターンの間に受けたダメージの合計の40%を、終了時に相手へ与える' },
  { name:'地鳴らし', cls:'重戦士', kind:P, mult:0.8, add:[{ stat:'vit', rate:1.0 }], proc:85, mp:14, ail:{ key:'paralyze', chance:30 }, desc:'物理 ×0.8＋VIT×1.0・30%で麻痺' },
  { name:'城塞崩し', cls:'重戦士', kind:P, mult:1.0, add:[{ stat:'vit', rate:1.2 }], proc:80, mp:22, revenge:0.3, desc:'物理 ×1.0＋VIT×1.2＋直前に受けたダメージの30%' },

  // ===== 槍使い系 =====
  // 竜騎士：跳んで被弾を避け、着地で大ダメージ
  { name:'竜の血', cls:'竜騎士', kind:'passive', mp:0, passive:{ landPct:15, statPct:{ vit:10 } }, desc:'跳躍スキルの着地ダメージ+15%・自分のVIT+10%' },
  { name:'ドラゴンスラスト', cls:'竜騎士', kind:P, mult:1.4, proc:95, mp:7, defPen:0.1, desc:'物理 ×1.4・相手の防御を10%無視' },
  { name:'ジャンプ', cls:'竜騎士', kind:P, mult:2.0, proc:85, mp:14, jump:{ turns:1, mult:2.0 }, desc:'跳躍して1ターン敵の攻撃を回避し、次のターンに物理 ×2.0' },
  { name:'ドラゴンファング', cls:'竜騎士', kind:P, mult:0.8, hits:2, proc:88, mp:12, defPen:0.2, desc:'物理 ×0.8の2連撃・相手の防御を20%無視' },
  { name:'スカイスピア', cls:'竜騎士', kind:P, mult:1.3, add:[{ stat:'dex', rate:0.3 }], proc:88, mp:11, sureHit:true, desc:'物理 ×1.3＋DEX×0.3・必ず当たる' },
  { name:'ドラゴンロア', cls:'竜騎士', kind:B, proc:100, mp:12, buff:{ enemy:{ str:-20, int_stat:-20 } }, ail:{ key:'fear', chance:40 }, priority:1, desc:'相手のSTR-20%・INT-20%・40%で恐怖' },
  { name:'竜鱗', cls:'竜騎士', kind:B, proc:100, mp:10, buff:{ self:{ vit:25, agi:10 } }, priority:1, desc:'自分のVIT+25%・AGI+10%' },
  { name:'ハイジャンプ', cls:'竜騎士', kind:P, mult:2.6, proc:80, mp:18, jump:{ turns:2, mult:2.6 }, desc:'跳躍して2ターン敵の攻撃を回避し、着地で物理 ×2.6' },
  { name:'天墜竜閃', cls:'竜騎士', kind:P, mult:2.2, proc:75, mp:24, defPen:0.3, afterLand:1.2, desc:'物理 ×2.2・相手の防御を30%無視。直前のターンに着地していれば×1.2' },
  // 槍術士：連撃でコンボを重ね、突くほど鋭くなる
  { name:'槍の型', cls:'槍術士', kind:'passive', mp:0, passive:{ combo:{ max:20, pct:1 } }, desc:'攻撃が1ヒットするごとにコンボ+1（最大20）。コンボ1につき与ダメージ+1%' },
  { name:'連突き', cls:'槍術士', kind:P, mult:0.5, hits:3, proc:95, mp:6, noCrit:true, desc:'物理 ×0.5の3連撃・クリティカルなし' },
  { name:'薙ぎ崩し', cls:'槍術士', kind:P, mult:1.35, proc:90, mp:9, buff:{ enemy:{ agi:-20 } }, desc:'物理 ×1.35・相手のAGI-20%' },
  { name:'スパイラルスラスト', cls:'槍術士', kind:P, mult:1.5, proc:85, mp:12, defPen:0.25, desc:'物理 ×1.5・相手の防御を25%無視' },
  { name:'足払い', cls:'槍術士', kind:P, mult:1.1, proc:88, mp:9, ail:{ key:'slow', chance:40 }, desc:'物理 ×1.1・40%で鈍足' },
  { name:'流星突き', cls:'槍術士', kind:P, mult:0.35, hits:6, proc:85, mp:15, noCrit:true, desc:'物理 ×0.35の6連撃・クリティカルなし' },
  { name:'間合い取り', cls:'槍術士', kind:B, proc:100, mp:10, buff:{ self:{ agi:20, dex:15 } }, priority:1, desc:'自分のAGI+20%・DEX+15%' },
  { name:'槍崩し', cls:'槍術士', kind:P, mult:1.3, proc:85, mp:12, buff:{ enemy:{ vit:-20 } }, desc:'物理 ×1.3・相手のVIT-20%' },
  { name:'千本突き', cls:'槍術士', kind:P, mult:0.25, hits:8, proc:80, mp:22, comboHits:{ at:10, hits:10 }, desc:'物理 ×0.25の8連撃。コンボが10以上なら10連撃' },

  // ===== 格闘家系 =====
  // 体術師：当たらなければ反撃できる、回避と反撃の技巧型
  { name:'心眼', cls:'体術師', kind:'passive', mp:0, passive:{ counterOnDodge:0.6 }, desc:'攻撃を回避するたびに物理 ×0.6で反撃' },
  { name:'半月蹴り', cls:'体術師', kind:P, mult:1.4, proc:95, mp:6, desc:'物理 ×1.4' },
  { name:'受け流し', cls:'体術師', kind:B, proc:100, mp:8, buff:{ self:{ agi:25 } }, buffTurns:3, priority:1, desc:'3ターンの間、自分のAGI+25%' },
  { name:'五連殺', cls:'体術師', kind:P, mult:0.33, hits:5, proc:85, mp:14, noCrit:true, desc:'物理 ×0.33の5連撃・クリティカルなし' },
  { name:'旋風脚', cls:'体術師', kind:P, hitMults:[0.4, 0.6, 0.8], proc:85, mp:13, desc:'物理 ×0.4／0.6／0.8の3連撃' },
  { name:'巴投げ', cls:'体術師', kind:P, mult:1.3, add:[{ stat:'agi', rate:0.3 }], proc:85, mp:12, buff:{ enemy:{ agi:-15 } }, desc:'物理 ×1.3＋AGI×0.3・相手のAGI-15%' },
  { name:'流水の構え', cls:'体術師', kind:B, proc:100, mp:12, dodgeBoost:{ turns:3, pct:20, max:3 }, priority:1, desc:'3ターンの間、回避するたびに次の攻撃の威力+20%（最大3回分）' },
  { name:'破衝掌', cls:'体術師', kind:P, mult:1.6, proc:85, mp:14, defPen:0.3, desc:'物理 ×1.6・相手の防御を30%無視' },
  { name:'飛天三角蹴り', cls:'体術師', kind:P, hitMults:[0.5, 0.7, 1.0], proc:80, mp:22, critIfDodged:true, desc:'物理 ×0.5／0.7／1.0の3連撃。直前のターンに回避していれば全段クリティカル' },
  // 気功師：気を溜めて解放する
  { name:'丹田', cls:'気功師', kind:'passive', mp:0, passive:{ perStackDmg:{ key:'ki', pct:4 } }, desc:'気1つにつき与ダメージ+4%' },
  { name:'気弾', cls:'気功師', kind:P, mult:0.9, add:[{ stat:'dex', rate:0.4 }], proc:95, mp:6, gain:{ key:'ki', n:1, max:5 }, desc:'物理 ×0.9＋DEX×0.4・気+1' },
  { name:'練気', cls:'気功師', kind:B, proc:100, mp:8, buff:{ self:{ str:10 } }, gain:{ key:'ki', n:2, max:5 }, priority:1, desc:'気+2・自分のSTR+10%' },
  { name:'掌底波', cls:'気功師', kind:P, mult:1.0, add:[{ stat:'dex', rate:0.4 }], proc:88, mp:11, useOne:{ key:'ki', n:1, mult:1.4 }, desc:'物理 ×1.0＋DEX×0.4。気を1消費できれば威力×1.4' },
  { name:'浸透勁', cls:'気功師', kind:P, mult:1.4, proc:85, mp:12, defPen:0.4, gain:{ key:'ki', n:1, max:5 }, desc:'物理 ×1.4・相手の防御を40%無視・気+1' },
  { name:'内功', cls:'気功師', kind:H, proc:100, mp:10, needStack:{ key:'ki', n:1 }, healMax:8, desc:'気を1消費し、最大HPの8%を回復' },
  { name:'気の鎧', cls:'気功師', kind:B, proc:100, mp:10, needStack:{ key:'ki', n:2 }, guard:{ cut:25, turns:3 }, priority:1, desc:'気を2消費し、3ターンの間、受けるダメージ-25%' },
  { name:'闘気', cls:'気功師', kind:B, proc:100, mp:12, buff:{ self:{ str:20, dex:15 } }, gain:{ key:'ki', n:1, max:5 }, priority:1, desc:'自分のSTR+20%・DEX+15%・気+1' },
  { name:'天衝', cls:'気功師', kind:P, mult:1.2, proc:80, mp:20, useAll:{ key:'ki', addMult:0.25 }, desc:'気をすべて消費し、物理 ×1.2＋消費した気1つにつき×0.25' },

  // ===== 盗賊系 =====
  // 暗殺者：傷を重ね、急所を断つ
  { name:'血の匂い', cls:'暗殺者', kind:'passive', mp:0, passive:{ perFoeBleed:4 }, desc:'出血している相手への与ダメージ+（出血の重なり数×4%）' },
  { name:'刻み斬り', cls:'暗殺者', kind:P, mult:0.8, add:[{ stat:'agi', rate:0.4 }], proc:95, mp:6, ail:{ key:'bleed', chance:50 }, desc:'物理 ×0.8＋AGI×0.4・50%で出血' },
  { name:'鬼影閃', cls:'暗殺者', kind:P, mult:0.5, add:[{ stat:'agi', rate:0.3 }], hits:2, proc:88, mp:12, ail:{ key:'bleed', chance:40 }, ailPerHit:true, desc:'物理 ×0.5＋AGI×0.3の2連撃・それぞれ40%で出血' },
  { name:'ヴァイパーストライク', cls:'暗殺者', kind:P, mult:0.9, add:[{ stat:'agi', rate:0.4 }], proc:88, mp:11, ail:{ key:'poison', chance:50 }, desc:'物理 ×0.9＋AGI×0.4・50%で毒' },
  { name:'隠形', cls:'暗殺者', kind:B, proc:100, mp:10, buff:{ self:{ agi:30 } }, priority:1, desc:'自分のAGI+30%' },
  { name:'裂傷', cls:'暗殺者', kind:P, mult:0.6, add:[{ stat:'agi', rate:0.3 }], proc:90, mp:10, ail:{ key:'bleed', chance:100, stacks:2 }, desc:'物理 ×0.6＋AGI×0.3・相手の出血を+2' },
  { name:'影討ち', cls:'暗殺者', kind:P, mult:1.2, add:[{ stat:'agi', rate:0.5 }], proc:85, mp:14, firstTurn:{ mult:1.5, crit:20 }, desc:'物理 ×1.2＋AGI×0.5。戦闘1ターン目なら威力+50%・クリティカル率+20%' },
  { name:'首狩り', cls:'暗殺者', kind:P, mult:1.2, add:[{ stat:'agi', rate:0.5 }], proc:85, mp:16, critBonus:40, desc:'物理 ×1.2＋AGI×0.5・クリティカル率+40%' },
  { name:'急所突き', cls:'暗殺者', kind:P, mult:1.0, add:[{ stat:'agi', rate:0.5 }], proc:80, mp:20, burstAil:{ key:'bleed', perStack:0.25 }, desc:'物理 ×1.0＋AGI×0.5。相手の出血をすべて消費し、1つにつき威力+25%' },
  // 忍者：影を増やし、手数で削る
  { name:'影の連携', cls:'忍者', kind:'passive', mp:0, passive:{ cloneFollow:0.15, noCloneAgi:10 }, desc:'自分が攻撃するたび、分身1体につき物理 ×0.15で追撃。分身がいない間はAGI+10%' },
  { name:'手裏剣', cls:'忍者', kind:P, mult:0.3, add:[{ stat:'agi', rate:0.2 }], hits:3, proc:95, mp:6, sureHit:true, desc:'物理 ×0.3＋AGI×0.2の3連撃・必ず当たる' },
  { name:'分身の術', cls:'忍者', kind:B, proc:100, mp:12, gain:{ key:'clone', n:1, max:3 }, priority:1, desc:'分身を1体出す。分身は攻撃を1回肩代わりして消える' },
  { name:'雷遁', cls:'忍者', kind:P, mult:0.9, add:[{ stat:'dex', rate:0.4 }], proc:85, mp:12, ail:{ key:'paralyze', chance:20 }, desc:'物理 ×0.9＋DEX×0.4・20%で麻痺' },
  { name:'火遁', cls:'忍者', kind:P, mult:0.9, add:[{ stat:'dex', rate:0.4 }], proc:85, mp:12, ail:{ key:'burn', chance:50 }, desc:'物理 ×0.9＋DEX×0.4・50%で火傷' },
  { name:'影斬り', cls:'忍者', kind:P, mult:1.45, proc:88, mp:12, desc:'物理 ×1.45' },
  { name:'毒霧の術', cls:'忍者', kind:P, mult:0.6, proc:88, mp:10, ails:[{ key:'poison', chance:60 }, { key:'blind', chance:40 }], desc:'物理 ×0.6・60%で毒・40%で暗闇' },
  { name:'変わり身', cls:'忍者', kind:B, proc:100, mp:14, gain:{ key:'clone', n:2, max:3 }, buff:{ self:{ agi:15 } }, priority:1, desc:'分身を2体出す・自分のAGI+15%' },
  { name:'千本手裏剣', cls:'忍者', kind:P, mult:0.2, add:[{ stat:'agi', rate:0.12 }], hits:6, proc:80, mp:20, sureHit:true, hitsPerStack:{ key:'clone', n:1 }, desc:'物理 ×0.2＋AGI×0.12の6連撃・必ず当たる。分身1体につき+1連撃' },

  // ===== 弓使い系 =====
  // 狩人：罠と毒で獲物を追い詰める
  { name:'獲物の弱り目', cls:'狩人', kind:'passive', mp:0, passive:{ perFoeAil:{ pct:8, max:32 } }, desc:'相手の状態異常1つにつき与ダメージ+8%（最大+32%）' },
  { name:'毒矢', cls:'狩人', kind:P, mult:1.1, proc:95, mp:7, ail:{ key:'poison', chance:70 }, desc:'物理 ×1.1・70%で毒' },
  { name:'くくり罠', cls:'狩人', kind:P, mult:0.8, proc:90, mp:10, ail:{ key:'slow', chance:60 }, desc:'物理 ×0.8・60%で鈍足' },
  { name:'ハンターズマーク', cls:'狩人', kind:B, proc:100, mp:8, buff:{ enemy:{ vit:-15, agi:-10 } }, priority:1, desc:'相手のVIT-15%・AGI-10%' },
  { name:'裂き矢', cls:'狩人', kind:P, mult:1.0, proc:88, mp:10, ail:{ key:'bleed', chance:50 }, desc:'物理 ×1.0・50%で出血' },
  { name:'目くらまし', cls:'狩人', kind:P, mult:0.8, proc:88, mp:10, ail:{ key:'blind', chance:50 }, desc:'物理 ×0.8・50%で暗闇' },
  { name:'三連射', cls:'狩人', kind:P, mult:0.5, hits:3, proc:85, mp:14, desc:'物理 ×0.5の3連撃' },
  { name:'狩猟の構え', cls:'狩人', kind:B, proc:100, mp:10, buff:{ self:{ str:15, dex:15 } }, priority:1, desc:'自分のSTR+15%・DEX+15%' },
  { name:'仕留めの一矢', cls:'狩人', kind:P, mult:1.4, proc:80, mp:20, vsAil:{ per:10, max:100 }, desc:'物理 ×1.4・相手の状態異常1つにつき威力+10%' },
  // 狙撃手：一発必中の重い一撃
  { name:'狙撃手の勘', cls:'狙撃手', kind:'passive', mp:0, passive:{ critFollow:0.5 }, desc:'クリティカル時に物理 ×0.5で追撃' },
  { name:'急所射ち', cls:'狙撃手', kind:P, mult:0.7, add:[{ stat:'dex', rate:0.6 }], proc:95, mp:7, sureHit:true, desc:'物理 ×0.7＋DEX×0.6・必ず当たる' },
  { name:'照準', cls:'狙撃手', kind:B, proc:100, mp:8, gain:{ key:'aim', n:1, max:3 }, nextBoost:{ key:'aim', kind:P, per:15 }, priority:1, desc:'照準+1（最大3）。次の射撃スキルは照準1つにつき威力+15%（使うとリセット）' },
  { name:'ラピッドショット', cls:'狙撃手', kind:P, mult:0.45, add:[{ stat:'dex', rate:0.35 }], hits:2, proc:90, mp:10, desc:'物理 ×0.45＋DEX×0.35の2連撃' },
  { name:'貫き矢', cls:'狙撃手', kind:P, mult:1.5, proc:85, mp:12, defPen:0.35, desc:'物理 ×1.5・相手の防御を35%無視' },
  { name:'息を止める', cls:'狙撃手', kind:B, proc:100, mp:10, buff:{ self:{ dex:25 } }, critUp:15, priority:1, desc:'自分のDEX+25%・クリティカル率+15%' },
  { name:'強弓', cls:'狙撃手', kind:P, mult:1.9, proc:80, mp:16, desc:'物理 ×1.9' },
  { name:'弱点看破', cls:'狙撃手', kind:P, mult:1.2, proc:85, mp:12, buff:{ enemy:{ vit:-20 } }, critBonus:20, desc:'物理 ×1.2・相手のVIT-20%・クリティカル率+20%' },
  { name:'絶影狙撃', cls:'狙撃手', kind:P, mult:2.2, proc:75, mp:22, sureHit:true, critMult:1.3, desc:'物理 ×2.2・必ず当たる・クリティカル時はダメージ×1.3' },

  // ===== 銃士系 =====
  // 魔銃士：弾に属性を込めて撃ち分ける（物理と魔法の両方）
  { name:'魔力循環', cls:'魔銃士', kind:'passive', mp:0, passive:{ vsAnyAil:15 }, desc:'状態異常にかかっている相手への与ダメージ+15%' },
  { name:'マナショット', cls:'魔銃士', kind:P, hybrid:{ phys:1.2, mag:1.2 }, proc:95, mp:6, desc:'物理 ×1.2＋魔法 ×1.2' },
  { name:'焼夷弾', cls:'魔銃士', kind:P, hybrid:{ phys:1.1, mag:1.1 }, proc:88, mp:11, ail:{ key:'burn', chance:50 }, desc:'物理 ×1.1＋魔法 ×1.1・50%で火傷' },
  { name:'雷撃弾', cls:'魔銃士', kind:P, hybrid:{ phys:1.1, mag:1.1 }, proc:88, mp:11, ail:{ key:'paralyze', chance:20 }, desc:'物理 ×1.1＋魔法 ×1.1・20%で麻痺' },
  { name:'氷結弾', cls:'魔銃士', kind:P, hybrid:{ phys:1.1, mag:1.1 }, proc:88, mp:11, ail:{ key:'slow', chance:50 }, desc:'物理 ×1.1＋魔法 ×1.1・50%で鈍足' },
  { name:'ブレイクショット', cls:'魔銃士', kind:P, hybrid:{ phys:1.1, mag:1.1 }, proc:85, mp:13, defPen:0.3, desc:'物理 ×1.1＋魔法 ×1.1・相手の防御を30%無視' },
  { name:'魔力装填', cls:'魔銃士', kind:B, proc:100, mp:12, buff:{ self:{ str:20, int_stat:20 } }, priority:1, desc:'自分のSTR+20%・INT+20%' },
  { name:'連装魔撃', cls:'魔銃士', kind:P, hybrid:{ phys:0.35, mag:0.35 }, hits:4, proc:85, mp:16, noCrit:true, desc:'物理 ×0.35＋魔法 ×0.35の4連撃・クリティカルなし' },
  { name:'アルカナバレット', cls:'魔銃士', kind:P, hybrid:{ phys:1.7, mag:1.7 }, proc:80, mp:22, vsAil:{ per:10, max:100 }, desc:'物理 ×1.7＋魔法 ×1.7・相手の状態異常1つにつき威力+10%' },
  // 砲撃士：装填して、ぶっ放す
  { name:'砲台の構え', cls:'砲撃士', kind:'passive', mp:0, passive:{ whileStackGuard:{ key:'load', cut:15 } }, desc:'装填が1以上ある間、受けるダメージ-15%' },
  { name:'散弾', cls:'砲撃士', kind:P, mult:0.3, add:[{ stat:'dex', rate:0.25 }], hits:3, proc:95, mp:6, noCrit:true, desc:'物理 ×0.3＋DEX×0.25の3連撃・クリティカルなし' },
  { name:'装填', cls:'砲撃士', kind:B, proc:100, mp:6, gain:{ key:'load', n:1, max:3 }, priority:1, desc:'装填+1（最大3）' },
  { name:'キャノン', cls:'砲撃士', kind:P, mult:0.8, add:[{ stat:'dex', rate:0.8 }], proc:85, mp:14, useAll:{ key:'load', per:0.25 }, desc:'物理 ×0.8＋DEX×0.8。装填をすべて消費し、1つにつき威力+25%' },
  { name:'スモークシェル', cls:'砲撃士', kind:P, mult:0.4, add:[{ stat:'dex', rate:0.3 }], proc:88, mp:10, ail:{ key:'blind', chance:60 }, desc:'物理 ×0.4＋DEX×0.3・60%で暗闇' },
  { name:'速射', cls:'砲撃士', kind:P, mult:0.5, add:[{ stat:'dex', rate:0.4 }], proc:90, mp:10, gain:{ key:'load', n:1, max:3 }, desc:'物理 ×0.5＋DEX×0.4・装填+1' },
  { name:'グレネード', cls:'砲撃士', kind:P, mult:0.6, add:[{ stat:'dex', rate:0.5 }], proc:88, mp:12, ail:{ key:'burn', chance:50 }, desc:'物理 ×0.6＋DEX×0.5・50%で火傷' },
  { name:'弾薬補給', cls:'砲撃士', kind:B, proc:100, mp:10, buff:{ self:{ str:15, dex:20 } }, priority:1, desc:'自分のSTR+15%・DEX+20%' },
  { name:'フルバースト', cls:'砲撃士', kind:P, mult:1.0, add:[{ stat:'dex', rate:1.0 }], proc:75, mp:24, useAll:{ key:'load', per:0.3 }, selfStun:1, desc:'物理 ×1.0＋DEX×1.0。装填をすべて消費し、1つにつき威力+30%。使用後1ターン行動不可' },

  // ===== 魔法使い系 =====
  // 魔導士：詠唱が長いほど強い大魔法の使い手
  { name:'元素共鳴', cls:'魔導士', kind:'passive', mp:0, passive:{ elemSwitch:15, chantBonus:10 }, desc:'直前と違う属性の魔法を使うと与ダメージ+15%。詠唱を消費した魔法は+10%' },
  { name:'ファイアボール', cls:'魔導士', kind:M, mult:1.6, proc:95, mp:7, elem:'fire', ail:{ key:'burn', chance:20 }, desc:'魔法 ×1.6・20%で火傷' },
  { name:'詠唱', cls:'魔導士', kind:B, proc:100, mp:6, gain:{ key:'chant', n:1, max:3 }, nextBoost:{ key:'chant', kind:M, per:15 }, priority:1, desc:'詠唱+1（最大3）。次の魔法は詠唱1つにつき威力+15%（使うとリセット）' },
  { name:'フロストノヴァ', cls:'魔導士', kind:M, mult:1.6, proc:88, mp:13, elem:'ice', ail:{ key:'slow', chance:40 }, desc:'魔法 ×1.6・40%で鈍足' },
  { name:'ウィンドカッター', cls:'魔導士', kind:M, mult:0.6, hits:3, proc:88, mp:13, elem:'wind', desc:'魔法 ×0.6の3連撃' },
  { name:'ライトニングボルト', cls:'魔導士', kind:M, mult:1.6, proc:88, mp:13, elem:'thunder', ail:{ key:'paralyze', chance:25 }, desc:'魔法 ×1.6・25%で麻痺' },
  { name:'魔力集中', cls:'魔導士', kind:B, proc:100, mp:10, buff:{ self:{ int_stat:30 } }, priority:1, desc:'自分のINT+30%' },
  { name:'メテオ', cls:'魔導士', kind:M, mult:2.2, proc:75, mp:22, elem:'fire', ail:{ key:'burn', chance:40 }, desc:'魔法 ×2.2・40%で火傷' },
  { name:'カタストロフ', cls:'魔導士', kind:M, mult:2.6, proc:70, mp:28, desc:'魔法 ×2.6' },
  // 時魔導士：時間を操り、手数で圧倒する
  { name:'刻の加護', cls:'時魔導士', kind:'passive', mp:0, passive:{ extraIfFaster:20 }, desc:'自分のAGIが相手より高いとき、20%で追加行動' },
  { name:'クロノバレット', cls:'時魔導士', kind:M, mult:1.5, proc:95, mp:6, buff:{ enemy:{ agi:-10 } }, desc:'魔法 ×1.5・相手のAGI-10%' },
  { name:'アクセル', cls:'時魔導士', kind:B, proc:100, mp:10, buff:{ self:{ agi:30 } }, priority:1, desc:'自分のAGI+30%' },
  { name:'スロウ', cls:'時魔導士', kind:M, mult:1.1, proc:90, mp:10, ail:{ key:'slow', chance:60 }, desc:'魔法 ×1.1・60%で鈍足' },
  { name:'ディレイ', cls:'時魔導士', kind:M, mult:1.3, proc:88, mp:12, buff:{ enemy:{ agi:-20 } }, desc:'魔法 ×1.3・相手のAGI-20%' },
  { name:'ストップ', cls:'時魔導士', kind:B, proc:80, mp:16, buff:{ enemy:{ agi:-15 } }, ail:{ key:'paralyze', chance:30 }, desc:'30%で麻痺・相手のAGI-15%' },
  { name:'クイック', cls:'時魔導士', kind:B, proc:100, mp:14, extraTurn:{ max:2 }, desc:'このターン、もう一度行動する（戦闘中2回まで）' },
  { name:'リワインド', cls:'時魔導士', kind:H, proc:100, mp:14, rewind:{ turns:2, pct:50 }, desc:'直前2ターンで受けたダメージの50%を回復' },
  { name:'クロノブレイク', cls:'時魔導士', kind:M, mult:1.6, proc:75, mp:24, agiDiff:{ per:1, max:60 }, desc:'魔法 ×1.6・自分と相手のAGIの差1%につき威力+1%（最大+60%）' },

  // ===== 呪術師系 =====
  // 死霊術師：死者を従え、数で押す
  { name:'死者の盾', cls:'死霊術師', kind:'passive', mp:0, passive:{ guardPerStack:{ key:'undead', cut:5 } }, desc:'死霊1体につき受けるダメージ-5%' },
  { name:'骸骨召喚', cls:'死霊術師', kind:B, proc:95, mp:10, summon:{ key:'undead', n:1, max:3, mult:0.25 }, priority:1, desc:'死霊を1体召喚（最大3体）。死霊は毎ターン魔法 ×0.25で攻撃' },
  { name:'ソウルドレイン', cls:'死霊術師', kind:M, mult:1.3, proc:88, mp:10, drain:0.15, drainPerStack:{ key:'undead', pct:0.05 }, desc:'魔法 ×1.3・与えたダメージの15%をHP回復（死霊1体につき+5%）' },
  { name:'ボーンスピア', cls:'死霊術師', kind:M, mult:1.3, proc:88, mp:11, perStack:{ key:'undead', pct:10 }, desc:'魔法 ×1.3・死霊1体につき威力+10%' },
  { name:'恐怖の囁き', cls:'死霊術師', kind:M, mult:1.0, proc:90, mp:10, ail:{ key:'fear', chance:50 }, desc:'魔法 ×1.0・50%で恐怖' },
  { name:'腐敗霧', cls:'死霊術師', kind:B, proc:88, mp:14, buff:{ enemy:{ vit:-15, int_stat:-15 } }, ail:{ key:'poison', chance:50 }, desc:'相手のVIT-15%・INT-15%・50%で毒' },
  { name:'死の行軍', cls:'死霊術師', kind:B, proc:100, mp:12, summonBoost:{ key:'undead', pct:50, turns:4 }, priority:1, desc:'4ターンの間、死霊の攻撃力+50%' },
  { name:'魂喰らい', cls:'死霊術師', kind:H, proc:100, mp:12, needStack:{ key:'undead', n:1 }, healMax:15, mpGain:10, desc:'死霊を1体消費し、最大HPの15%を回復・MPを10回復' },
  { name:'幽世ノ門', cls:'死霊術師', kind:M, mult:1.4, proc:75, mp:24, useAll:{ key:'undead', per:0.25 }, ail:{ key:'fear', chance:40 }, desc:'魔法 ×1.4。死霊をすべて消費し、1体につき威力+25%・40%で恐怖' },
  // 陰陽師：札を敷き、式神を操る
  { name:'陰陽の理', cls:'陰陽師', kind:'passive', mp:0, passive:{ whileSummonOrGuard:15 }, desc:'式神か結界がある間、与ダメージ+15%' },
  { name:'式打ち', cls:'陰陽師', kind:M, mult:0.75, hits:2, proc:95, mp:6, desc:'魔法 ×0.75の2連撃' },
  { name:'式神召喚', cls:'陰陽師', kind:B, proc:100, mp:14, summon:{ key:'shiki', n:1, max:1, mult:0.5 }, priority:1, desc:'式神を召喚（1体まで）。式神は毎ターン魔法 ×0.5で攻撃' },
  { name:'封の符', cls:'陰陽師', kind:M, mult:1.1, proc:85, mp:12, ail:{ key:'seal', chance:40 }, desc:'魔法 ×1.1・40%で封印' },
  { name:'火炎符', cls:'陰陽師', kind:M, mult:1.3, proc:88, mp:12, ail:{ key:'burn', chance:50 }, desc:'魔法 ×1.3・50%で火傷' },
  { name:'陰陽結界', cls:'陰陽師', kind:B, proc:100, mp:12, guard:{ cut:20, turns:3, healPct:50 }, priority:1, desc:'3ターンの間、受けるダメージ-20%・軽減した分の50%を回復' },
  { name:'魂削りの符', cls:'陰陽師', kind:M, mult:1.4, proc:88, mp:12, buff:{ enemy:{ int_stat:-20 } }, desc:'魔法 ×1.4・相手のINT-20%' },
  { name:'鬼神降ろし', cls:'陰陽師', kind:B, proc:100, mp:14, summonHits:{ key:'shiki', hits:2, turns:4 }, priority:1, desc:'4ターンの間、式神の攻撃が2連撃になる' },
  { name:'禁術・神降ろし', cls:'陰陽師', kind:M, mult:2.4, proc:75, mp:24, noRepeat:true, desc:'魔法 ×2.4・連続では使えない' },

  // ===== 僧侶系 =====
  // 司祭：倒れない祈りの持久型
  { name:'神聖加護', cls:'司祭', kind:'passive', mp:0, passive:{ healBonus:30 }, desc:'回復量+30%' },
  { name:'聖光', cls:'司祭', kind:M, mult:1.5, proc:95, mp:7, desc:'魔法 ×1.5' },
  { name:'ハイヒール', cls:'司祭', kind:H, proc:90, mp:12, heal:{ rate:1.6 }, desc:'HP回復（回復量の倍率1.6）' },
  { name:'ブレス', cls:'司祭', kind:B, proc:100, mp:10, buff:{ self:{ int_stat:20, vit:10 } }, priority:1, desc:'自分のINT+20%・VIT+10%' },
  { name:'奇跡', cls:'司祭', kind:H, proc:85, mp:16, regenMax:{ pct:6, turns:4 }, desc:'4ターンの間、毎ターン最大HPの6%を回復' },
  { name:'祈りの結界', cls:'司祭', kind:B, proc:100, mp:12, guard:{ cut:20, turns:3 }, priority:1, desc:'3ターンの間、受けるダメージ-20%' },
  { name:'癒しの光撃', cls:'司祭', kind:M, mult:1.3, proc:85, mp:14, drain:0.3, desc:'魔法 ×1.3・与えたダメージの30%をHP回復' },
  { name:'リザレクション', cls:'司祭', kind:B, proc:100, mp:20, revive:{ pct:50 }, priority:1, desc:'戦闘中1回だけ、HPが0になった時にHP50%で復活' },
  { name:'セイクリッドノヴァ', cls:'司祭', kind:M, mult:1.5, proc:80, mp:24, healDmg:{ pct:10, capMult:1.0 }, desc:'魔法 ×1.5＋この戦闘で回復したHPの10%を追加ダメージ（上限は魔法 ×1.0分）' },
  // 祓魔師：魔を祓い、封じる
  { name:'退魔の心得', cls:'祓魔師', kind:'passive', mp:0, passive:{ vsRaceOrAil:{ races:['undead', 'demon'], ailKey:'seal', pct:20 } }, desc:'アンデッドと悪魔、または封印中の相手への与ダメージ+20%' },
  { name:'破魔の光', cls:'祓魔師', kind:M, mult:1.5, proc:95, mp:7, vsRace:{ races:['undead', 'demon'], mult:1.3 }, desc:'魔法 ×1.5・アンデッドと悪魔には1.3倍' },
  { name:'封魔の印', cls:'祓魔師', kind:M, mult:1.0, proc:85, mp:12, ail:{ key:'seal', chance:50 }, desc:'魔法 ×1.0・50%で封印' },
  { name:'ホーリーチェイン', cls:'祓魔師', kind:M, mult:1.2, proc:88, mp:12, ail:{ key:'seal', chance:30 }, buff:{ enemy:{ agi:-10 } }, desc:'魔法 ×1.2・30%で封印・相手のAGI-10%' },
  { name:'聖水', cls:'祓魔師', kind:M, mult:1.2, proc:90, mp:10, dispel:{ chance:100 }, desc:'魔法 ×1.2・相手の強化を1つ解除' },
  { name:'狂信', cls:'祓魔師', kind:B, proc:100, mp:12, debuffImmune:{ turns:4 }, priority:1, desc:'4ターンの間、自分の能力低下を無効' },
  { name:'浄化の炎', cls:'祓魔師', kind:M, mult:1.5, proc:85, mp:14, ail:{ key:'burn', chance:50 }, desc:'魔法 ×1.5・50%で火傷' },
  { name:'聖なる裁き', cls:'祓魔師', kind:M, mult:1.7, proc:85, mp:16, vsAilMult:{ key:'seal', mult:1.3 }, desc:'魔法 ×1.7・相手が封印中なら×1.3' },
  { name:'断罪', cls:'祓魔師', kind:M, mult:2.3, proc:75, mp:24, vsRace:{ races:['undead', 'demon'], mult:1.3 }, desc:'魔法 ×2.3・アンデッドと悪魔には1.3倍' },

  // ===== 薬師系 =====
  // 錬金術師：混ぜて、燃やして、爆発させる
  { name:'化学反応', cls:'錬金術師', kind:'passive', mp:0, passive:{ bothAil:{ keys:['poison', 'burn'], pct:20 }, vsDebuff:{ stats:['vit', 'int_stat'], pct:10 } }, desc:'相手が毒と火傷の両方にかかっていると与ダメージ+20%。相手のVITかINTが下がっている間は+10%' },
  { name:'火炎瓶', cls:'錬金術師', kind:M, mult:1.3, proc:95, mp:7, ail:{ key:'burn', chance:40 }, desc:'魔法 ×1.3・40%で火傷' },
  { name:'劇毒瓶', cls:'錬金術師', kind:M, mult:1.2, proc:88, mp:10, ail:{ key:'poison', chance:70 }, desc:'魔法 ×1.2・70%で毒' },
  { name:'スパークボトル', cls:'錬金術師', kind:M, mult:1.2, proc:88, mp:10, ail:{ key:'paralyze', chance:20 }, desc:'魔法 ×1.2・20%で麻痺' },
  { name:'腐食液', cls:'錬金術師', kind:M, mult:1.2, proc:88, mp:12, buff:{ enemy:{ vit:-20, int_stat:-15 } }, desc:'魔法 ×1.2・相手のVIT-20%・INT-15%' },
  { name:'閃光弾', cls:'錬金術師', kind:M, mult:0.8, proc:88, mp:10, ail:{ key:'blind', chance:50 }, desc:'魔法 ×0.8・50%で暗闇' },
  { name:'触媒', cls:'錬金術師', kind:B, proc:100, mp:10, buff:{ self:{ int_stat:25 } }, priority:1, desc:'自分のINT+25%' },
  { name:'溶解液', cls:'錬金術師', kind:M, mult:1.4, proc:85, mp:14, defPen:0.3, desc:'魔法 ×1.4・相手の防御を30%無視' },
  { name:'メガボム', cls:'錬金術師', kind:M, mult:1.4, proc:75, mp:24, consumeAllAil:{ per:30, max:120 }, desc:'魔法 ×1.4。相手の状態異常をすべて解除し、1つにつき威力+30%（最大+120%）' },
  // 霊薬師：薬を重ねて、後半ほど強くなる
  { name:'調合の極意', cls:'霊薬師', kind:'passive', mp:0, passive:{ perStackDmg:{ key:'potion', pct:5 } }, desc:'薬効1つにつき与ダメージ+5%' },
  { name:'霊薬瓶', cls:'霊薬師', kind:M, mult:1.4, proc:95, mp:7, desc:'魔法 ×1.4' },
  { name:'剛力薬', cls:'霊薬師', kind:B, proc:100, mp:9, buff:{ self:{ str:15 } }, gain:{ key:'potion', n:1, max:5 }, priority:1, desc:'自分のSTR+15%・薬効+1' },
  { name:'叡智の薬', cls:'霊薬師', kind:B, proc:100, mp:9, buff:{ self:{ int_stat:20 } }, gain:{ key:'potion', n:1, max:5 }, priority:1, desc:'自分のINT+20%・薬効+1' },
  { name:'鉄身薬', cls:'霊薬師', kind:B, proc:100, mp:9, buff:{ self:{ vit:20 } }, gain:{ key:'potion', n:1, max:5 }, priority:1, desc:'自分のVIT+20%・薬効+1' },
  { name:'再生薬', cls:'霊薬師', kind:H, proc:90, mp:14, regenMax:{ pct:5, turns:4 }, desc:'4ターンの間、毎ターン最大HPの5%を回復' },
  { name:'霊薬', cls:'霊薬師', kind:H, proc:90, mp:14, heal:{ rate:1.5 }, mpHeal:{ rate:0.3 }, desc:'HP回復（倍率1.5）・MP回復（倍率0.3）' },
  { name:'薬効解放', cls:'霊薬師', kind:M, mult:1.2, proc:85, mp:16, useAll:{ key:'potion', per:0.25 }, desc:'魔法 ×1.2。薬効をすべて消費し、1つにつき威力+25%' },
  { name:'仙丹', cls:'霊薬師', kind:B, proc:100, mp:22, buff:{ self:{ str:15, dex:15, agi:15, int_stat:15, vit:15, luk:15 } }, gain:{ key:'potion', n:2, max:5 }, priority:1, desc:'自分の全能力+15%・薬効+2' },
]

// 職ごとの組み方の例（ユーザーの表・各職2つ）。シミュレーターがこの組み方で戦う
export const ICHIJI_BUILDS = {
  狂戦士:   [['マッドラッシュ', '狂撃', '血の誓い', '狂乱の咆哮', 'フルブレイカー'], ['血風斬', 'ブラッドスプラッシュ', 'ブラッディロア', '狂乱の咆哮', 'フルブレイカー']],
  重戦士:   [['重撃', '鉄壁', '受け止め', '地鳴らし', '城塞崩し'], ['報復の一撃', '忍耐', 'グランドスラム', '鉄壁', '城塞崩し']],
  竜騎士:   [['ジャンプ', 'ハイジャンプ', 'ドラゴンスラスト', '竜鱗', '天墜竜閃'], ['ドラゴンファング', 'スカイスピア', 'ドラゴンロア', '竜鱗', '天墜竜閃']],
  槍術士:   [['連突き', '流星突き', 'スパイラルスラスト', '間合い取り', '千本突き'], ['薙ぎ崩し', '足払い', '槍崩し', '間合い取り', '千本突き']],
  体術師:   [['受け流し', '流水の構え', '巴投げ', '半月蹴り', '飛天三角蹴り'], ['五連殺', '旋風脚', '破衝掌', '半月蹴り', '飛天三角蹴り']],
  気功師:   [['気弾', '練気', '掌底波', '浸透勁', '天衝'], ['気弾', '練気', '内功', '気の鎧', '闘気']],
  暗殺者:   [['刻み斬り', '鬼影閃', '裂傷', '隠形', '急所突き'], ['影討ち', '首狩り', '隠形', 'ヴァイパーストライク', '急所突き']],
  忍者:     [['分身の術', '変わり身', '影斬り', '手裏剣', '千本手裏剣'], ['雷遁', '火遁', '毒霧の術', '影斬り', '千本手裏剣']],
  狩人:     [['毒矢', 'くくり罠', '裂き矢', '目くらまし', '仕留めの一矢'], ['毒矢', 'ハンターズマーク', '三連射', '狩猟の構え', '仕留めの一矢']],
  狙撃手:   [['照準', '強弓', '貫き矢', '急所射ち', '絶影狙撃'], ['ラピッドショット', '息を止める', '弱点看破', '急所射ち', '絶影狙撃']],
  魔銃士:   [['焼夷弾', '雷撃弾', '氷結弾', 'ブレイクショット', 'アルカナバレット'], ['マナショット', '魔力装填', '連装魔撃', 'ブレイクショット', 'アルカナバレット']],
  砲撃士:   [['装填', '速射', 'キャノン', '弾薬補給', 'フルバースト'], ['散弾', '速射', 'グレネード', 'スモークシェル', 'キャノン']],
  魔導士:   [['詠唱', '魔力集中', 'メテオ', 'カタストロフ', 'ファイアボール'], ['ファイアボール', 'フロストノヴァ', 'ウィンドカッター', 'ライトニングボルト', 'カタストロフ']],
  時魔導士: [['アクセル', 'クイック', 'クロノバレット', 'リワインド', 'クロノブレイク'], ['スロウ', 'ディレイ', 'ストップ', 'クロノバレット', 'クロノブレイク']],
  死霊術師: [['骸骨召喚', '死の行軍', 'ボーンスピア', '魂喰らい', '幽世ノ門'], ['骸骨召喚', 'ソウルドレイン', '恐怖の囁き', '腐敗霧', '幽世ノ門']],
  陰陽師:   [['式神召喚', '鬼神降ろし', '式打ち', '火炎符', '禁術・神降ろし'], ['封の符', '陰陽結界', '魂削りの符', '火炎符', '禁術・神降ろし']],
  司祭:     [['ハイヒール', '奇跡', '祈りの結界', 'リザレクション', 'セイクリッドノヴァ'], ['聖光', 'ブレス', '癒しの光撃', '奇跡', 'セイクリッドノヴァ']],
  祓魔師:   [['破魔の光', '狂信', '浄化の炎', '聖水', '断罪'], ['封魔の印', 'ホーリーチェイン', '聖なる裁き', '浄化の炎', '断罪']],
  錬金術師: [['火炎瓶', '劇毒瓶', 'スパークボトル', '閃光弾', 'メガボム'], ['腐食液', '溶解液', '触媒', '劇毒瓶', 'メガボム']],
  霊薬師:   [['剛力薬', '叡智の薬', '鉄身薬', '仙丹', '霊薬瓶'], ['霊薬瓶', '剛力薬', '再生薬', '霊薬', '薬効解放']],
}
