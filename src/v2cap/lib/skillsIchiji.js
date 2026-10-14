// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 上位職のスキル（22職×8技＋パッシブ1つずつ）
// ------------------------------------------------------------
// 【確定】2026-10-10 ユーザーの表「一次職スキル一覧」（Claude Docs https://claude.ai/artifact/ToS4Bvfh5nNaykdt5ToEEn）。
//   名前・消費MP・発動率・倍率・効果はその表のまま（desc は表の「内容」）。並び＝覚える順（ClassLV1／5／10／15／20／25／30／40）。
//   パッシブは各職に1つで、転職した時点で効く（スキル枠は使わない）。
// 【確定】2026-10-14 ユーザー承認：上位職の並び替え。V1の職業を続投し、横文字の名前も入れた（jobs.js の ICHIJI_INFO）。
//   ・名前だけ変えた10職（中身は表のまま）：槍術士→ストームランサー・狙撃手→アークアーチャー・砲撃士→デストロイヤー・魔導士→元素使い・
//     時魔導士→クロノマンサー・死霊術師→死霊使い・陰陽師→式神使い・司祭→聖職者・祓魔師→異端審問官・錬金術師→アルケミスト
//   ・入れ替え：重戦士→聖騎士・気功師→サイキッカー。剣士系に侍・魔法剣士を足した。この4職の技は今のⅡの同じ職業（10技）から8つを選び、
//     強さは上位職の帯（初期職の帯の1.3倍）に、消費MPはこの表の決まり（発動率95%→6・90%→10・88%→11・85%→14・82%→17・80%→20・78%→22）に合わせた
//   ★今のⅡと同じ名前の技がある（マッドラッシュ・天墜竜閃 など・表の「過去作の名前も引き継ぐ」）。中身はこの版のもの
//     （この版は名前を自分の名簿＝skills.js の SKILL_BY_NAME で引くので、今のⅡの技とは混ざらない）
//
// 戦闘で使う項目（今のⅡの戦闘エンジン src/v2/lib/battle.js が読む）
//   今からあるもの … kind・mult・add・hits・noCrit・sureHit・defPen・buff（self/enemy）・buffTurns・ail・ailPerHit・
//     drain・heal・dispel・consumeAil・vsAil・priority
//   上位職で足したもの（battle.js の「一次職の仕組み」）…
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
  // ===== 剣士系（2026-10-14 ユーザー承認：V1の侍・魔法剣士を続投。技は今のⅡの同じ職業から8つ・強さは初期職の1.3倍の帯）=====
  // 侍：納刀で構えてから、抜き打ちの大技
  { name:'居合の構え', cls:'侍', kind:'passive', mp:0, passive:{ misfireAtkMult:2 }, desc:'スキルが不発したとき、代わりに出る通常攻撃の威力が2倍になる' },
  { name:'居合斬', cls:'侍', kind:P, mult:1.29, add:[{ stat:'dex', rate:0.35 }], proc:90, mp:10, ail:{ key:'bleed', chance:20 }, desc:'抜き打ち。DEXも威力になる。20%で出血' },
  { name:'納刀', cls:'侍', kind:B, proc:100, mp:6, priority:1, stance:{ proc:20, mult:1.5, priority:1 }, desc:'納刀状態になる。次に撃つスキルが発動率+20%・威力1.5倍・先制になる（撃つと消える）' },
  { name:'抜刀術', cls:'侍', kind:P, mult:1.52, add:[{ stat:'dex', rate:0.26 }], proc:88, mp:11, stance:{ proc:20, mult:1.5, priority:true }, desc:'軽く斬りつけてから鞘に納める（斬りながら納刀に入る）。DEXも威力になる' },
  { name:'断空', cls:'侍', kind:P, mult:1.74, defPen:0.3, proc:85, mp:14, whileStance:{ defPen:0.2 }, desc:'相手の防御を30%無視。納刀中はさらに20%無視（計50%）' },
  { name:'明鏡止水', cls:'侍', kind:B, proc:100, mp:12, buff:{ self:{ str:30, dex:20 } }, priority:1, desc:'STR+30%・DEX+20%（重ねがけ可）' },
  { name:'二段斬り', cls:'侍', kind:P, mult:0.82, add:[{ stat:'dex', rate:0.13 }], hits:2, proc:85, mp:14, noCrit:true, whileStance:{ defPen:0.35 }, desc:'2連撃。DEXも威力になる。クリティカルしない。納刀中は相手の防御を35%無視' },
  { name:'桜花一閃', cls:'侍', kind:P, mult:1.7, add:[{ stat:'dex', rate:0.17 }], proc:82, mp:17, ail:{ key:'bleed', chance:30 }, whileStance:{ ailChance:100 }, desc:'DEXも威力になる。30%で出血。納刀中は必ず出血' },
  { name:'月影', cls:'侍', kind:P, mult:1.94, proc:78, mp:22, ail:{ key:'bleed', chance:40 }, whileStance:{ ailChance:100 }, desc:'侍の切り札。40%で出血。納刀中は出血が確定' },
  // 魔法剣士：剣と魔法を交互に振るい、切り替えるほど強くなる
  { name:'魔導剣術', cls:'魔法剣士', kind:'passive', mp:0, passive:{ convert:{ from:'int_stat', to:'str', pct:30 } }, desc:'INTの30%をSTRへ変換する（そのぶんINTは下がる）' },
  { name:'マナエッジ', cls:'魔法剣士', kind:P, mult:2.72, add:[{ stat:'int_stat', rate:0.72 }], proc:90, mp:10, desc:'魔力をまとわせて斬る。INTも威力になる' },
  { name:'雷光斬', cls:'魔法剣士', kind:P, mult:2.16, add:[{ stat:'int_stat', rate:1.06 }], proc:90, mp:10, ail:{ key:'paralyze', chance:6 }, desc:'INTが大きく威力になる。6%で麻痺' },
  { name:'魔剣開放', cls:'魔法剣士', kind:B, proc:100, mp:18, buff:{ self:{ str:30, int_stat:30 } }, priority:1, desc:'STR+30%・INT+30%（重ねがけ可）' },
  { name:'フロストエッジ', cls:'魔法剣士', kind:P, mult:2.25, add:[{ stat:'int_stat', rate:0.69 }], proc:88, mp:11, ail:{ key:'slow', chance:35 }, switchKind:20, desc:'INTも威力になる。35%で鈍足。直前に魔法を使っていれば威力+20%' },
  { name:'マナバースト', cls:'魔法剣士', kind:M, mult:3.02, add:[{ stat:'str', rate:0.72 }], proc:85, mp:14, switchKind:30, desc:'STRも威力になる。直前に物理を使っていれば威力+30%' },
  { name:'双極斬', cls:'魔法剣士', kind:P, mult:2.28, add:[{ stat:'int_stat', rate:0.87 }], proc:85, mp:14, switchKind:35, desc:'INTが大きく威力になる。直前に魔法を使っていれば威力+35%' },
  { name:'ソードオーラ', cls:'魔法剣士', kind:B, proc:100, mp:15, buff:{ self:{ agi:30, str:30 } }, priority:1, desc:'AGI+30%・STR+30%（重ねがけ可）' },
  { name:'エレメンタルエッジ', cls:'魔法剣士', kind:P, mult:1.97, add:[{ stat:'int_stat', rate:1.56 }], proc:80, mp:20, switchKind:25, desc:'魔法剣士の切り札。INTが大きく威力になる。直前に魔法を使っていれば威力+25%' },

  // ===== 戦士系 =====
  // 狂戦士：HPを削るほど強くなる短期決戦型
  { name:'バーサク', cls:'狂戦士', kind:'passive', mp:0, passive:{ lowHpDmg:[{ at:50, pct:15 }, { at:25, pct:30 }] }, desc:'HP50%以下で与ダメージ+15%、25%以下で+30%' },
  { name:'マッドラッシュ', cls:'狂戦士', kind:P, mult:1.05, proc:95, mp:6, hpCostMax:{ pct:2, ifAbove:50 }, desc:'物理 ×1.05・自分のHPが50%以上なら、最大HPの2%を消費' },
  { name:'血風斬', cls:'狂戦士', kind:P, mult:1.06, proc:85, mp:12, drain:0.15, desc:'物理 ×1.06・与えたダメージの15%をHP回復' },
  { name:'狂乱の咆哮', cls:'狂戦士', kind:B, proc:100, mp:10, buff:{ self:{ str:20 } }, ail:{ key:'fear', chance:40 }, priority:1, desc:'自分のSTR+20%・40%で相手に恐怖' },
  { name:'ブラッドスプラッシュ', cls:'狂戦士', kind:P, mult:0.94, proc:88, mp:11, ail:{ key:'bleed', chance:50 }, desc:'物理 ×0.94・50%で出血' },
  { name:'狂撃', cls:'狂戦士', kind:P, mult:1.39, proc:85, mp:14, recoil:0.15, desc:'物理 ×1.39・与えたダメージの15%を自分も受ける' },
  { name:'ブラッディロア', cls:'狂戦士', kind:B, proc:100, mp:14, lifeSteal:{ pct:10, turns:4 }, priority:1, desc:'4ターンの間、攻撃のたびに与えたダメージの10%をHP回復' },
  { name:'血の誓い', cls:'狂戦士', kind:B, proc:100, mp:10, hpCostMax:{ pct:10 }, buff:{ self:{ str:30 } }, priority:1, desc:'自分の最大HPの10%を消費し、STR+30%' },
  { name:'フルブレイカー', cls:'狂戦士', kind:P, mult:1.46, proc:80, mp:22, defPen:0.3, selfLowHp:{ at:25, mult:1.2 }, desc:'物理 ×1.46・相手の防御を30%無視。自分のHPが25%以下なら×2.4' },
  // 聖騎士（2026-10-14 ユーザー承認：重戦士と入れ替え・V1の聖騎士を続投。技は今のⅡから8つ。
  //   ユーザー指示「VITも火力に直結するように」＝攻撃の技は STRとVITが半分ずつ威力になる）
  { name:'聖騎士の心得', cls:'聖騎士', kind:'passive', mp:0, passive:{ statPct:{ vit:5 }, defRed:10 }, desc:'VIT+5%・受けるときの軽減率+10%' },
  { name:'ホーリーエッジ', cls:'聖騎士', kind:P, mult:0.9, add:[{ stat:'vit', rate:0.9 }], proc:90, mp:10, buff:{ self:{ vit:15 } }, desc:'STRとVITが半分ずつ威力になる。自分のVIT+15%（重ねがけ可）' },
  { name:'オースシールド', cls:'聖騎士', kind:B, proc:100, mp:13, buff:{ self:{ vit:50 } }, priority:1, desc:'VIT+50%（重ねがけ可）' },
  { name:'シールドバッシュ', cls:'聖騎士', kind:P, mult:0.86, add:[{ stat:'vit', rate:0.86 }], proc:90, mp:10, ail:{ key:'paralyze', chance:8 }, desc:'STRとVITが半分ずつ威力になる。8%で麻痺' },
  { name:'ディバインスマイト', cls:'聖騎士', kind:P, mult:0.98, add:[{ stat:'vit', rate:0.98 }], proc:85, mp:14, buff:{ enemy:{ str:-20 } }, desc:'STRとVITが半分ずつ威力になる。相手のSTR-20%（重ねがけ可）' },
  { name:'ホーリーケア', cls:'聖騎士', kind:H, proc:85, mp:16, heal:{ rate:1.35 }, desc:'祈りでHPを戻す' },
  { name:'大防御', cls:'聖騎士', kind:B, proc:100, mp:14, bigGuard:{ cut:60 }, priority:1, desc:'盾を構えて耐える。1ターンのあいだ受けるダメージ-60%。そのターンは追加行動が出ない' },
  { name:'ジャッジメントブロウ', cls:'聖騎士', kind:P, mult:1.05, add:[{ stat:'vit', rate:1.05 }], proc:85, mp:14, desc:'裁きの一撃。STRとVITが半分ずつ威力になる' },
  { name:'神聖覚醒', cls:'聖騎士', kind:P, mult:1.12, add:[{ stat:'vit', rate:1.12 }], proc:80, mp:20, desc:'聖騎士の切り札。STRとVITが半分ずつ威力になる' },

  // ===== 槍使い系 =====
  // 竜騎士：跳んで被弾を避け、着地で大ダメージ
  { name:'竜の血', cls:'竜騎士', kind:'passive', mp:0, passive:{ landPct:15, statPct:{ vit:10 } }, desc:'跳躍スキルの着地ダメージ+15%・自分のVIT+10%' },
  { name:'ドラゴンスラスト', cls:'竜騎士', kind:P, mult:2.16, proc:95, mp:7, defPen:0.1, desc:'物理 ×2.16・相手の防御を10%無視' },
  { name:'ジャンプ', cls:'竜騎士', kind:P, mult:3.05, proc:85, mp:14, jump:{ turns:1, mult:3.05 }, desc:'跳躍して1ターン敵の攻撃を回避し、次のターンに物理 ×3.05' },
  { name:'ドラゴンファング', cls:'竜騎士', kind:P, mult:1.22, hits:2, noCrit:true, proc:88, mp:12, defPen:0.2, desc:'物理 ×1.22の2連撃・相手の防御を20%無視・クリティカルなし' },
  { name:'スカイスピア', cls:'竜騎士', kind:P, mult:1.95, add:[{ stat:'dex', rate:0.45 }], proc:88, mp:11, sureHit:true, desc:'物理 ×1.95＋DEX×0.45・必ず当たる' },
  { name:'ドラゴンロア', cls:'竜騎士', kind:B, proc:100, mp:12, buff:{ enemy:{ str:-20, int_stat:-20 } }, ail:{ key:'fear', chance:40 }, priority:1, desc:'相手のSTR-20%・INT-20%・40%で恐怖' },
  { name:'竜鱗', cls:'竜騎士', kind:B, proc:100, mp:10, buff:{ self:{ vit:25, agi:10 } }, priority:1, desc:'自分のVIT+25%・AGI+10%' },
  { name:'ハイジャンプ', cls:'竜騎士', kind:P, mult:3.96, proc:80, mp:18, jump:{ turns:2, mult:3.96 }, desc:'跳躍して2ターン敵の攻撃を回避し、着地で物理 ×3.96' },
  { name:'天墜竜閃', cls:'竜騎士', kind:P, mult:3.35, proc:75, mp:24, defPen:0.3, afterLand:1.2, desc:'物理 ×3.35・相手の防御を30%無視。直前のターンに着地していれば×1.2' },
  // ストームランサー（2026-10-14 槍術士から改名）：連撃でコンボを重ね、突くほど鋭くなる
  { name:'槍の型', cls:'ストームランサー', kind:'passive', mp:0, passive:{ combo:{ max:20, pct:1 } }, desc:'攻撃が1ヒットするごとにコンボ+1（最大20）。コンボ1につき与ダメージ+1%' },
  { name:'連突き', cls:'ストームランサー', kind:P, mult:0.88, hits:3, proc:95, mp:6, noCrit:true, desc:'物理 ×0.88の3連撃・クリティカルなし' },
  { name:'薙ぎ崩し', cls:'ストームランサー', kind:P, mult:2.77, proc:90, mp:9, buff:{ enemy:{ agi:-20 } }, desc:'物理 ×2.77・相手のAGI-20%' },
  { name:'スパイラルスラスト', cls:'ストームランサー', kind:P, mult:3.03, proc:85, mp:12, defPen:0.25, desc:'物理 ×3.03・相手の防御を25%無視' },
  { name:'足払い', cls:'ストームランサー', kind:P, mult:2.81, proc:88, mp:9, ail:{ key:'slow', chance:40 }, desc:'物理 ×2.81・40%で鈍足' },
  { name:'流星突き', cls:'ストームランサー', kind:P, mult:0.55, hits:6, proc:85, mp:15, noCrit:true, desc:'物理 ×0.55の6連撃・クリティカルなし' },
  { name:'間合い取り', cls:'ストームランサー', kind:B, proc:100, mp:10, buff:{ self:{ agi:20, dex:15 } }, priority:1, desc:'自分のAGI+20%・DEX+15%' },
  { name:'槍崩し', cls:'ストームランサー', kind:P, mult:3.08, proc:85, mp:12, buff:{ enemy:{ vit:-20 } }, desc:'物理 ×3.08・相手のVIT-20%' },
  { name:'千本突き', cls:'ストームランサー', kind:P, mult:0.52, hits:8, noCrit:true, proc:80, mp:22, comboHits:{ at:10, hits:10 }, desc:'物理 ×0.52の8連撃。コンボが10以上なら10連撃・クリティカルなし' },

  // ===== 格闘家系 =====
  // 体術師：当たらなければ反撃できる、回避と反撃の技巧型
  { name:'心眼', cls:'体術師', kind:'passive', mp:0, passive:{ counterOnDodge:0.6 }, desc:'攻撃を回避するたびに物理 ×0.6で反撃' },
  { name:'半月蹴り', cls:'体術師', kind:P, mult:1.21, proc:95, mp:6, desc:'物理 ×1.21' },
  { name:'受け流し', cls:'体術師', kind:B, proc:100, mp:8, buff:{ self:{ agi:25 } }, buffTurns:3, priority:1, desc:'3ターンの間、自分のAGI+25%' },
  { name:'五連殺', cls:'体術師', kind:P, mult:0.3, hits:5, proc:85, mp:14, noCrit:true, desc:'物理 ×0.3の5連撃・クリティカルなし' },
  { name:'旋風脚', cls:'体術師', kind:P, hitMults:[0.36, 0.54, 0.71], noCrit:true, proc:85, mp:13, desc:'物理 ×0.36／0.6／0.8の3連撃・クリティカルなし' },
  { name:'巴投げ', cls:'体術師', kind:P, mult:1.16, add:[{ stat:'agi', rate:0.27 }], proc:85, mp:12, buff:{ enemy:{ agi:-15 } }, desc:'物理 ×1.16＋AGI×0.27・相手のAGI-15%' },
  { name:'流水の構え', cls:'体術師', kind:B, proc:100, mp:12, dodgeBoost:{ turns:3, pct:20, max:3 }, priority:1, desc:'3ターンの間、回避するたびに次の攻撃の威力+20%（最大3回分）' },
  { name:'破衝掌', cls:'体術師', kind:P, mult:1.37, proc:85, mp:14, defPen:0.3, desc:'物理 ×1.37・相手の防御を30%無視' },
  { name:'飛天三角蹴り', cls:'体術師', kind:P, hitMults:[0.45, 0.63, 0.89], proc:80, mp:22, critIfDodged:true, desc:'物理 ×0.45／0.7／1.0の3連撃。直前のターンに回避していれば全段クリティカル' },
  // サイキッカー（2026-10-14 ユーザー承認：気功師と入れ替え・V1のサイキッカーを続投。技は今のⅡから8つ。
  //   ユーザー指示「STRやINTを半分ずつ参照」＝攻撃の技は STRとINTが半分ずつ威力になる。念の技は相手の魔法防御で受ける）
  { name:'第六感', cls:'サイキッカー', kind:'passive', mp:0, passive:{ perAct:{ stats:['agi', 'dex'], per:1, max:10 } }, desc:'自分が行動するたびAGI・DEX+1%（最大10%）' },
  { name:'サイコショット', cls:'サイキッカー', kind:M, src:'str', mult:1.39, add:[{ stat:'int_stat', rate:1.39 }], proc:90, mp:10, desc:'念で撃つ。STRとINTが半分ずつ威力になる（相手の魔法防御で受ける）' },
  { name:'精神集中', cls:'サイキッカー', kind:B, proc:100, mp:16, buff:{ self:{ str:35, int_stat:20 } }, priority:1, desc:'STR+35%・INT+20%（重ねがけ可）' },
  { name:'テレキネシス', cls:'サイキッカー', kind:M, src:'str', mult:1.39, add:[{ stat:'int_stat', rate:1.39 }], proc:90, mp:10, desc:'念力で叩きつける。STRとINTが半分ずつ威力になる（相手の魔法防御で受ける）' },
  { name:'マインドブレイク', cls:'サイキッカー', kind:M, src:'str', mult:1.32, add:[{ stat:'int_stat', rate:1.32 }], proc:85, mp:14, buff:{ enemy:{ str:-15, int_stat:-20 } }, ail:{ key:'frenzy', chance:20 }, desc:'精神を砕く。STRとINTが半分ずつ威力になる。相手のSTR-15%・INT-20%（重ねがけ可）。20%で狂乱' },
  { name:'マインドスパイク', cls:'サイキッカー', kind:M, src:'str', mult:1.57, add:[{ stat:'int_stat', rate:1.57 }], proc:85, mp:14, desc:'精神を直接刺す。STRとINTが半分ずつ威力になる（相手の魔法防御で受ける）' },
  { name:'マインドアクセル', cls:'サイキッカー', kind:B, proc:100, mp:15, buff:{ self:{ agi:35, int_stat:20 } }, priority:1, desc:'AGI+35%・INT+20%（重ねがけ可）' },
  { name:'サイキックチェイン', cls:'サイキッカー', kind:P, src:'str', mult:0.48, add:[{ stat:'int_stat', rate:0.48 }], hits:3, proc:80, mp:20, noCrit:true, desc:'3連撃。STRとINTが半分ずつ威力になる（相手の物理防御で受ける）。クリティカルしない' },
  { name:'サイコブラスト', cls:'サイキッカー', kind:M, src:'str', mult:1.67, add:[{ stat:'int_stat', rate:1.67 }], proc:80, mp:20, desc:'サイキッカーの切り札。STRとINTが半分ずつ威力になる（相手の魔法防御で受ける）' },

  // ===== 盗賊系 =====
  // 暗殺者：傷を重ね、急所を断つ
  { name:'血の匂い', cls:'暗殺者', kind:'passive', mp:0, passive:{ perFoeBleed:4 }, desc:'出血している相手への与ダメージ+（出血の重なり数×4%）' },
  { name:'刻み斬り', cls:'暗殺者', kind:P, mult:0.29, add:[{ stat:'agi', rate:0.15 }], proc:95, mp:6, ail:{ key:'bleed', chance:50 }, desc:'物理 ×0.29＋AGI×0.15・50%で出血' },
  { name:'鬼影閃', cls:'暗殺者', kind:P, mult:0.19, add:[{ stat:'agi', rate:0.12 }], hits:2, noCrit:true, proc:88, mp:12, ail:{ key:'bleed', chance:40 }, ailPerHit:true, desc:'物理 ×0.19＋AGI×0.12の2連撃・それぞれ40%で出血・クリティカルなし' },
  { name:'ヴァイパーストライク', cls:'暗殺者', kind:P, mult:0.35, add:[{ stat:'agi', rate:0.16 }], proc:88, mp:11, ail:{ key:'poison', chance:50 }, desc:'物理 ×0.35＋AGI×0.16・50%で毒' },
  { name:'隠形', cls:'暗殺者', kind:B, proc:100, mp:10, buff:{ self:{ agi:30 } }, priority:1, desc:'自分のAGI+30%' },
  { name:'裂傷', cls:'暗殺者', kind:P, mult:0.29, add:[{ stat:'agi', rate:0.15 }], proc:90, mp:10, ail:{ key:'bleed', chance:100, stacks:2 }, desc:'物理 ×0.29＋AGI×0.15・相手の出血を+2' },
  { name:'影討ち', cls:'暗殺者', kind:P, mult:0.47, add:[{ stat:'agi', rate:0.19 }], proc:85, mp:14, firstTurn:{ mult:1.5, crit:20 }, desc:'物理 ×0.47＋AGI×0.19。戦闘1ターン目なら威力+50%・クリティカル率+20%' },
  { name:'首狩り', cls:'暗殺者', kind:P, mult:0.47, add:[{ stat:'agi', rate:0.19 }], proc:85, mp:16, critBonus:40, desc:'物理 ×0.47＋AGI×0.19・クリティカル率+40%' },
  { name:'急所突き', cls:'暗殺者', kind:P, mult:0.39, add:[{ stat:'agi', rate:0.19 }], proc:80, mp:20, burstAil:{ key:'bleed', perStack:0.25 }, desc:'物理 ×0.39＋AGI×0.19。相手の出血をすべて消費し、1つにつき威力+25%' },
  // 忍者：影を増やし、手数で削る
  { name:'影の連携', cls:'忍者', kind:'passive', mp:0, passive:{ cloneFollow:0.15, noCloneAgi:10 }, desc:'自分が攻撃するたび、分身1体につき物理 ×0.15で追撃。分身がいない間はAGI+10%' },
  { name:'手裏剣', cls:'忍者', kind:P, mult:0.14, add:[{ stat:'agi', rate:0.09 }], hits:3, noCrit:true, proc:95, mp:6, sureHit:true, desc:'物理 ×0.14＋AGI×0.09の3連撃・必ず当たる・クリティカルなし' },
  { name:'分身の術', cls:'忍者', kind:B, proc:100, mp:12, gain:{ key:'clone', n:1, max:3 }, priority:1, desc:'分身を1体出す。分身は攻撃を1回肩代わりして消える' },
  { name:'雷遁', cls:'忍者', kind:P, mult:0.52, add:[{ stat:'dex', rate:0.23 }], proc:85, mp:12, ail:{ key:'paralyze', chance:20 }, desc:'物理 ×0.52＋DEX×0.23・20%で麻痺' },
  { name:'火遁', cls:'忍者', kind:P, mult:0.58, add:[{ stat:'dex', rate:0.26 }], proc:85, mp:12, ail:{ key:'burn', chance:50 }, desc:'物理 ×0.58＋DEX×0.26・50%で火傷' },
  { name:'影斬り', cls:'忍者', kind:P, mult:0.88, proc:88, mp:12, desc:'物理 ×0.88' },
  { name:'毒霧の術', cls:'忍者', kind:P, mult:0.36, proc:88, mp:10, ails:[{ key:'poison', chance:60 }, { key:'blind', chance:40 }], desc:'物理 ×0.36・60%で毒・40%で暗闇' },
  { name:'変わり身', cls:'忍者', kind:B, proc:100, mp:14, gain:{ key:'clone', n:2, max:3 }, buff:{ self:{ agi:15 } }, priority:1, desc:'分身を2体出す・自分のAGI+15%' },
  { name:'千本手裏剣', cls:'忍者', kind:P, mult:0.12, add:[{ stat:'agi', rate:0.07 }], hits:6, noCrit:true, proc:80, mp:20, sureHit:true, hitsPerStack:{ key:'clone', n:1 }, desc:'物理 ×0.12＋AGI×0.07の6連撃・必ず当たる。分身1体につき+1連撃・クリティカルなし' },

  // ===== 弓使い系 =====
  // 狩人：罠と毒で獲物を追い詰める
  { name:'獲物の弱り目', cls:'狩人', kind:'passive', mp:0, passive:{ perFoeAil:{ pct:8, max:32 } }, desc:'相手の状態異常1つにつき与ダメージ+8%（最大+32%）' },
  { name:'毒矢', cls:'狩人', kind:P, mult:1.21, proc:95, mp:7, ail:{ key:'poison', chance:70 }, desc:'物理 ×1.21・70%で毒' },
  { name:'くくり罠', cls:'狩人', kind:P, mult:1.5, proc:90, mp:10, ail:{ key:'slow', chance:60 }, desc:'物理 ×1.5・60%で鈍足' },
  { name:'ハンターズマーク', cls:'狩人', kind:B, proc:100, mp:8, buff:{ enemy:{ vit:-15, agi:-10 } }, priority:1, desc:'相手のVIT-15%・AGI-10%' },
  { name:'裂き矢', cls:'狩人', kind:P, mult:1.6, proc:88, mp:10, ail:{ key:'bleed', chance:50 }, desc:'物理 ×1.6・50%で出血' },
  { name:'目くらまし', cls:'狩人', kind:P, mult:1.55, proc:88, mp:10, ail:{ key:'blind', chance:50 }, desc:'物理 ×1.55・50%で暗闇' },
  { name:'三連射', cls:'狩人', kind:P, mult:0.64, hits:3, noCrit:true, proc:85, mp:14, desc:'物理 ×0.64の3連撃・クリティカルなし' },
  { name:'狩猟の構え', cls:'狩人', kind:B, proc:100, mp:10, buff:{ self:{ str:15, dex:15 } }, priority:1, desc:'自分のSTR+15%・DEX+15%' },
  { name:'仕留めの一矢', cls:'狩人', kind:P, mult:1.83, proc:80, mp:20, vsAil:{ per:10, max:100 }, desc:'物理 ×1.83・相手の状態異常1つにつき威力+10%' },
  // アークアーチャー（2026-10-14 狙撃手から改名）：一発必中の重い一撃
  { name:'狙撃手の勘', cls:'アークアーチャー', kind:'passive', mp:0, passive:{ critFollow:0.5 }, desc:'クリティカル時に物理 ×0.5で追撃' },
  { name:'急所射ち', cls:'アークアーチャー', kind:P, mult:0.89, add:[{ stat:'dex', rate:0.76 }], proc:95, mp:7, sureHit:true, desc:'物理 ×0.89＋DEX×0.76・必ず当たる' },
  { name:'照準', cls:'アークアーチャー', kind:B, proc:100, mp:8, gain:{ key:'aim', n:1, max:3 }, nextBoost:{ key:'aim', kind:P, per:15 }, priority:1, desc:'照準+1（最大3）。次の射撃スキルは照準1つにつき威力+15%（使うとリセット）' },
  { name:'ラピッドショット', cls:'アークアーチャー', kind:P, mult:0.56, add:[{ stat:'dex', rate:0.44 }], hits:2, noCrit:true, proc:90, mp:10, desc:'物理 ×0.56＋DEX×0.44の2連撃・クリティカルなし' },
  { name:'貫き矢', cls:'アークアーチャー', kind:P, mult:2, proc:85, mp:12, defPen:0.35, desc:'物理 ×2・相手の防御を35%無視' },
  { name:'息を止める', cls:'アークアーチャー', kind:B, proc:100, mp:10, buff:{ self:{ dex:25 } }, critUp:15, priority:1, desc:'自分のDEX+25%・クリティカル率+15%' },
  { name:'強弓', cls:'アークアーチャー', kind:P, mult:2.39, proc:80, mp:16, desc:'物理 ×2.39' },
  { name:'弱点看破', cls:'アークアーチャー', kind:P, mult:1.52, proc:85, mp:12, buff:{ enemy:{ vit:-20 } }, critBonus:20, desc:'物理 ×1.52・相手のVIT-20%・クリティカル率+20%' },
  { name:'絶影狙撃', cls:'アークアーチャー', kind:P, mult:2.78, proc:75, mp:22, sureHit:true, critMult:1.3, desc:'物理 ×2.78・必ず当たる・クリティカル時はダメージ×1.3' },

  // ===== 銃士系 =====
  // 魔銃士：弾に属性を込めて撃ち分ける（物理と魔法の両方）
  { name:'魔力循環', cls:'魔銃士', kind:'passive', mp:0, passive:{ vsAnyAil:15 }, desc:'状態異常にかかっている相手への与ダメージ+15%' },
  { name:'マナショット', cls:'魔銃士', kind:P, hybrid:{ phys:1.02, mag:1.02 }, proc:95, mp:6, desc:'物理 ×1.02＋魔法 ×1.02' },
  { name:'焼夷弾', cls:'魔銃士', kind:P, hybrid:{ phys:0.94, mag:0.94 }, proc:88, mp:11, ail:{ key:'burn', chance:50 }, desc:'物理 ×0.94＋魔法 ×0.94・50%で火傷' },
  { name:'雷撃弾', cls:'魔銃士', kind:P, hybrid:{ phys:0.94, mag:0.94 }, proc:88, mp:11, ail:{ key:'paralyze', chance:20 }, desc:'物理 ×0.94＋魔法 ×0.94・20%で麻痺' },
  { name:'氷結弾', cls:'魔銃士', kind:P, hybrid:{ phys:0.94, mag:0.94 }, proc:88, mp:11, ail:{ key:'slow', chance:50 }, desc:'物理 ×0.94＋魔法 ×0.94・50%で鈍足' },
  { name:'ブレイクショット', cls:'魔銃士', kind:P, hybrid:{ phys:0.94, mag:0.94 }, proc:85, mp:13, defPen:0.3, desc:'物理 ×0.94＋魔法 ×0.94・相手の防御を30%無視' },
  { name:'魔力装填', cls:'魔銃士', kind:B, proc:100, mp:12, buff:{ self:{ str:20, int_stat:20 } }, priority:1, desc:'自分のSTR+20%・INT+20%' },
  { name:'連装魔撃', cls:'魔銃士', kind:P, hybrid:{ phys:0.29, mag:0.29 }, hits:4, proc:85, mp:16, noCrit:true, desc:'物理 ×0.29＋魔法 ×0.29の4連撃・クリティカルなし' },
  { name:'アルカナバレット', cls:'魔銃士', kind:P, hybrid:{ phys:1.45, mag:1.45 }, proc:80, mp:22, vsAil:{ per:10, max:100 }, desc:'物理 ×1.45＋魔法 ×1.45・相手の状態異常1つにつき威力+10%' },
  // デストロイヤー（2026-10-14 砲撃士から改名）：装填して、ぶっ放す
  { name:'砲台の構え', cls:'デストロイヤー', kind:'passive', mp:0, passive:{ whileStackGuard:{ key:'load', cut:15 } }, desc:'装填が1以上ある間、受けるダメージ-15%' },
  { name:'散弾', cls:'デストロイヤー', kind:P, mult:0.3, add:[{ stat:'dex', rate:0.25 }], hits:3, proc:95, mp:6, noCrit:true, desc:'物理 ×0.3＋DEX×0.25の3連撃・クリティカルなし' },
  { name:'装填', cls:'デストロイヤー', kind:B, proc:100, mp:6, gain:{ key:'load', n:1, max:3 }, priority:1, desc:'装填+1（最大3）' },
  { name:'キャノン', cls:'デストロイヤー', kind:P, mult:1.24, add:[{ stat:'dex', rate:1.24 }], proc:85, mp:14, useAll:{ key:'load', per:0.25 }, desc:'物理 ×1.24＋DEX×1.24。装填をすべて消費し、1つにつき威力+25%' },
  { name:'スモークシェル', cls:'デストロイヤー', kind:P, mult:0.92, add:[{ stat:'dex', rate:0.69 }], proc:88, mp:10, ail:{ key:'blind', chance:60 }, desc:'物理 ×0.92＋DEX×0.69・60%で暗闇' },
  { name:'速射', cls:'デストロイヤー', kind:P, mult:0.77, add:[{ stat:'dex', rate:0.62 }], proc:90, mp:10, gain:{ key:'load', n:1, max:3 }, desc:'物理 ×0.77＋DEX×0.62・装填+1' },
  { name:'グレネード', cls:'デストロイヤー', kind:P, mult:0.93, add:[{ stat:'dex', rate:0.77 }], proc:88, mp:12, ail:{ key:'burn', chance:50 }, desc:'物理 ×0.93＋DEX×0.77・50%で火傷' },
  { name:'弾薬補給', cls:'デストロイヤー', kind:B, proc:100, mp:10, buff:{ self:{ str:15, dex:20 } }, priority:1, desc:'自分のSTR+15%・DEX+20%' },
  { name:'フルバースト', cls:'デストロイヤー', kind:P, mult:1.55, add:[{ stat:'dex', rate:1.55 }], proc:75, mp:24, useAll:{ key:'load', per:0.3 }, selfStun:1, desc:'物理 ×1.55＋DEX×1.55。装填をすべて消費し、1つにつき威力+30%。使用後1ターン行動不可' },

  // ===== 魔法使い系 =====
  // 元素使い（2026-10-14 魔導士から改名）：詠唱が長いほど強い大魔法の使い手
  { name:'元素共鳴', cls:'元素使い', kind:'passive', mp:0, passive:{ elemSwitch:15, chantBonus:10 }, desc:'直前と違う属性の魔法を使うと与ダメージ+15%。詠唱を消費した魔法は+10%' },
  { name:'ファイアボール', cls:'元素使い', kind:M, mult:3.01, proc:95, mp:7, elem:'fire', ail:{ key:'burn', chance:20 }, desc:'魔法 ×3.01・20%で火傷' },
  { name:'詠唱', cls:'元素使い', kind:B, proc:100, mp:6, gain:{ key:'chant', n:1, max:3 }, nextBoost:{ key:'chant', kind:M, per:15 }, priority:1, desc:'詠唱+1（最大3）。次の魔法は詠唱1つにつき威力+15%（使うとリセット）' },
  { name:'フロストノヴァ', cls:'元素使い', kind:M, mult:3.41, proc:88, mp:13, elem:'ice', ail:{ key:'slow', chance:40 }, desc:'魔法 ×3.41・40%で鈍足' },
  { name:'ウィンドカッター', cls:'元素使い', kind:M, mult:1.23, hits:3, noCrit:true, proc:88, mp:13, elem:'wind', desc:'魔法 ×1.23の3連撃・クリティカルなし' },
  { name:'ライトニングボルト', cls:'元素使い', kind:M, mult:2.85, proc:88, mp:13, elem:'thunder', ail:{ key:'paralyze', chance:25 }, desc:'魔法 ×2.85・25%で麻痺' },
  { name:'魔力集中', cls:'元素使い', kind:B, proc:100, mp:10, buff:{ self:{ int_stat:30 } }, priority:1, desc:'自分のINT+30%' },
  { name:'メテオ', cls:'元素使い', kind:M, mult:4.02, proc:75, mp:22, elem:'fire', ail:{ key:'burn', chance:40 }, desc:'魔法 ×4.02・40%で火傷' },
  { name:'カタストロフ', cls:'元素使い', kind:M, mult:4.29, proc:70, mp:28, desc:'魔法 ×4.29' },
  // クロノマンサー（2026-10-14 時魔導士から改名）：時間を操り、手数で圧倒する
  { name:'刻の加護', cls:'クロノマンサー', kind:'passive', mp:0, passive:{ extraIfFaster:20 }, desc:'自分のAGIが相手より高いとき、20%で追加行動' },
  { name:'クロノバレット', cls:'クロノマンサー', kind:M, mult:1.85, proc:95, mp:6, buff:{ enemy:{ agi:-10 } }, desc:'魔法 ×1.85・相手のAGI-10%' },
  { name:'アクセル', cls:'クロノマンサー', kind:B, proc:100, mp:10, buff:{ self:{ agi:30 } }, priority:1, desc:'自分のAGI+30%' },
  { name:'スロウ', cls:'クロノマンサー', kind:M, mult:1.87, proc:90, mp:10, ail:{ key:'slow', chance:60 }, desc:'魔法 ×1.87・60%で鈍足' },
  { name:'ディレイ', cls:'クロノマンサー', kind:M, mult:2.12, proc:88, mp:12, buff:{ enemy:{ agi:-20 } }, desc:'魔法 ×2.12・相手のAGI-20%' },
  { name:'ストップ', cls:'クロノマンサー', kind:B, proc:80, mp:16, buff:{ enemy:{ agi:-15 } }, ail:{ key:'paralyze', chance:30 }, desc:'30%で麻痺・相手のAGI-15%' },
  { name:'クイック', cls:'クロノマンサー', kind:B, proc:100, mp:14, extraTurn:{ max:2 }, desc:'このターン、もう一度行動する（戦闘中2回まで）' },
  { name:'リワインド', cls:'クロノマンサー', kind:H, proc:100, mp:14, rewind:{ turns:2, pct:50 }, desc:'直前2ターンで受けたダメージの50%を回復' },
  { name:'クロノブレイク', cls:'クロノマンサー', kind:M, mult:2.6, proc:75, mp:24, agiDiff:{ per:1, max:60 }, desc:'魔法 ×2.6・自分と相手のAGIの差1%につき威力+1%（最大+60%）' },

  // ===== 呪術師系 =====
  // 死霊使い（2026-10-14 死霊術師から改名）：死者を従え、数で押す
  { name:'死者の盾', cls:'死霊使い', kind:'passive', mp:0, passive:{ guardPerStack:{ key:'undead', cut:5 } }, desc:'死霊1体につき受けるダメージ-5%' },
  { name:'骸骨召喚', cls:'死霊使い', kind:B, proc:95, mp:10, summon:{ key:'undead', n:1, max:3, mult:0.472 }, priority:1, desc:'死霊を1体召喚（最大3体）。死霊は毎ターン魔法 ×0.472で攻撃' },
  { name:'ソウルドレイン', cls:'死霊使い', kind:M, mult:2.46, proc:88, mp:10, drain:0.15, drainPerStack:{ key:'undead', pct:0.05 }, desc:'魔法 ×2.46・与えたダメージの15%をHP回復（死霊1体につき+5%）' },
  { name:'ボーンスピア', cls:'死霊使い', kind:M, mult:2.46, proc:88, mp:11, perStack:{ key:'undead', pct:10 }, desc:'魔法 ×2.46・死霊1体につき威力+10%' },
  { name:'恐怖の囁き', cls:'死霊使い', kind:M, mult:1.88, proc:90, mp:10, ail:{ key:'fear', chance:50 }, desc:'魔法 ×1.88・50%で恐怖' },
  { name:'腐敗霧', cls:'死霊使い', kind:B, proc:88, mp:14, buff:{ enemy:{ vit:-15, int_stat:-15 } }, ail:{ key:'poison', chance:50 }, desc:'相手のVIT-15%・INT-15%・50%で毒' },
  { name:'死の行軍', cls:'死霊使い', kind:B, proc:100, mp:12, summonBoost:{ key:'undead', pct:50, turns:4 }, priority:1, desc:'4ターンの間、死霊の攻撃力+50%' },
  { name:'魂喰らい', cls:'死霊使い', kind:H, proc:100, mp:12, needStack:{ key:'undead', n:1 }, healMax:15, mpGain:10, desc:'死霊を1体消費し、最大HPの15%を回復・MPを10回復' },
  { name:'幽世ノ門', cls:'死霊使い', kind:M, mult:2.64, proc:75, mp:24, useAll:{ key:'undead', per:0.25 }, ail:{ key:'fear', chance:40 }, desc:'魔法 ×2.64。死霊をすべて消費し、1体につき威力+25%・40%で恐怖' },
  // 式神使い（2026-10-14 陰陽師から改名）：札を敷き、式神を操る
  { name:'陰陽の理', cls:'式神使い', kind:'passive', mp:0, passive:{ whileSummonOrGuard:15 }, desc:'式神か結界がある間、与ダメージ+15%' },
  { name:'式打ち', cls:'式神使い', kind:M, mult:0.94, hits:2, noCrit:true, proc:95, mp:6, desc:'魔法 ×0.94の2連撃・クリティカルなし' },
  { name:'式神召喚', cls:'式神使い', kind:B, proc:100, mp:14, summon:{ key:'shiki', n:1, max:1, mult:0.766 }, priority:1, desc:'式神を召喚（1体まで）。式神は毎ターン魔法 ×0.766で攻撃' },
  { name:'封の符', cls:'式神使い', kind:M, mult:1.92, proc:85, mp:12, ail:{ key:'seal', chance:40 }, desc:'魔法 ×1.92・40%で封印' },
  { name:'火炎符', cls:'式神使い', kind:M, mult:1.99, proc:88, mp:12, ail:{ key:'burn', chance:50 }, desc:'魔法 ×1.99・50%で火傷' },
  { name:'陰陽結界', cls:'式神使い', kind:B, proc:100, mp:12, guard:{ cut:20, turns:3, healPct:50 }, priority:1, desc:'3ターンの間、受けるダメージ-20%・軽減した分の50%を回復' },
  { name:'魂削りの符', cls:'式神使い', kind:M, mult:2.07, proc:88, mp:12, buff:{ enemy:{ int_stat:-20 } }, desc:'魔法 ×2.07・相手のINT-20%' },
  { name:'鬼神降ろし', cls:'式神使い', kind:B, proc:100, mp:14, summonHits:{ key:'shiki', hits:2, turns:4 }, priority:1, desc:'4ターンの間、式神の攻撃が2連撃になる' },
  { name:'禁術・神降ろし', cls:'式神使い', kind:M, mult:3.68, proc:75, mp:24, noRepeat:true, desc:'魔法 ×3.68・連続では使えない' },

  // ===== 僧侶系 =====
  // 聖職者（2026-10-14 司祭から改名）：倒れない祈りの持久型
  { name:'神聖加護', cls:'聖職者', kind:'passive', mp:0, passive:{ healBonus:30 }, desc:'回復量+30%' },
  { name:'聖光', cls:'聖職者', kind:M, mult:1.64, proc:95, mp:7, desc:'魔法 ×1.64' },
  { name:'ハイヒール', cls:'聖職者', kind:H, proc:90, mp:12, heal:{ rate:1.6 }, desc:'HP回復（回復量の倍率1.6）' },
  { name:'ブレス', cls:'聖職者', kind:B, proc:100, mp:10, buff:{ self:{ int_stat:20, vit:10 } }, priority:1, desc:'自分のINT+20%・VIT+10%' },
  { name:'奇跡', cls:'聖職者', kind:H, proc:85, mp:16, regenMax:{ pct:6, turns:4 }, desc:'4ターンの間、毎ターン最大HPの6%を回復' },
  { name:'祈りの結界', cls:'聖職者', kind:B, proc:100, mp:12, guard:{ cut:20, turns:3 }, priority:1, desc:'3ターンの間、受けるダメージ-20%' },
  { name:'癒しの光撃', cls:'聖職者', kind:M, mult:1.83, proc:85, mp:14, drain:0.3, desc:'魔法 ×1.83・与えたダメージの30%をHP回復' },
  { name:'リザレクション', cls:'聖職者', kind:B, proc:100, mp:20, revive:{ pct:50 }, priority:1, desc:'戦闘中1回だけ、HPが0になった時にHP50%で復活' },
  { name:'セイクリッドノヴァ', cls:'聖職者', kind:M, mult:2.11, proc:80, mp:24, healDmg:{ pct:10, capMult:1.0 }, desc:'魔法 ×2.11＋この戦闘で回復したHPの10%を追加ダメージ（上限は魔法 ×1.0分）' },
  // 異端審問官（2026-10-14 祓魔師から改名）：魔を祓い、封じる
  { name:'退魔の心得', cls:'異端審問官', kind:'passive', mp:0, passive:{ vsRaceOrAil:{ races:['undead', 'demon'], ailKey:'seal', pct:20 } }, desc:'アンデッドと悪魔、または封印中の相手への与ダメージ+20%' },
  { name:'破魔の光', cls:'異端審問官', kind:M, mult:2.86, proc:95, mp:7, vsRace:{ races:['undead', 'demon'], mult:1.3 }, desc:'魔法 ×2.86・アンデッドと悪魔には1.3倍' },
  { name:'封魔の印', cls:'異端審問官', kind:M, mult:2.27, proc:85, mp:12, ail:{ key:'seal', chance:50 }, desc:'魔法 ×2.27・50%で封印' },
  { name:'ホーリーチェイン', cls:'異端審問官', kind:M, mult:2.28, proc:88, mp:12, ail:{ key:'seal', chance:30 }, buff:{ enemy:{ agi:-10 } }, desc:'魔法 ×2.28・30%で封印・相手のAGI-10%' },
  { name:'聖水', cls:'異端審問官', kind:M, mult:2.08, proc:90, mp:10, dispel:{ chance:100 }, desc:'魔法 ×2.08・相手の強化を1つ解除' },
  { name:'狂信', cls:'異端審問官', kind:B, proc:100, mp:12, debuffImmune:{ turns:4 }, priority:1, desc:'4ターンの間、自分の能力低下を無効' },
  { name:'浄化の炎', cls:'異端審問官', kind:M, mult:2.64, proc:85, mp:14, ail:{ key:'burn', chance:50 }, desc:'魔法 ×2.64・50%で火傷' },
  { name:'聖なる裁き', cls:'異端審問官', kind:M, mult:3.23, proc:85, mp:16, vsAilMult:{ key:'seal', mult:1.3 }, desc:'魔法 ×3.23・相手が封印中なら×1.3' },
  { name:'断罪', cls:'異端審問官', kind:M, mult:4.37, proc:75, mp:24, vsRace:{ races:['undead', 'demon'], mult:1.3 }, desc:'魔法 ×4.37・アンデッドと悪魔には1.3倍' },

  // ===== 薬師系 =====
  // アルケミスト（2026-10-14 錬金術師から改名）：混ぜて、燃やして、爆発させる
  { name:'化学反応', cls:'アルケミスト', kind:'passive', mp:0, passive:{ bothAil:{ keys:['poison', 'burn'], pct:20 }, vsDebuff:{ stats:['vit', 'int_stat'], pct:10 } }, desc:'相手が毒と火傷の両方にかかっていると与ダメージ+20%。相手のVITかINTが下がっている間は+10%' },
  { name:'火炎瓶', cls:'アルケミスト', kind:M, mult:2.14, proc:95, mp:7, ail:{ key:'burn', chance:40 }, desc:'魔法 ×2.14・40%で火傷' },
  { name:'劇毒瓶', cls:'アルケミスト', kind:M, mult:2.3, proc:88, mp:10, ail:{ key:'poison', chance:70 }, desc:'魔法 ×2.3・70%で毒' },
  { name:'スパークボトル', cls:'アルケミスト', kind:M, mult:2.24, proc:88, mp:10, ail:{ key:'paralyze', chance:20 }, desc:'魔法 ×2.24・20%で麻痺' },
  { name:'腐食液', cls:'アルケミスト', kind:M, mult:2.48, proc:88, mp:12, buff:{ enemy:{ vit:-20, int_stat:-15 } }, desc:'魔法 ×2.48・相手のVIT-20%・INT-15%' },
  { name:'閃光弾', cls:'アルケミスト', kind:M, mult:2.43, proc:88, mp:10, ail:{ key:'blind', chance:50 }, desc:'魔法 ×2.43・50%で暗闇' },
  { name:'触媒', cls:'アルケミスト', kind:B, proc:100, mp:10, buff:{ self:{ int_stat:25 } }, priority:1, desc:'自分のINT+25%' },
  { name:'溶解液', cls:'アルケミスト', kind:M, mult:2.67, proc:85, mp:14, defPen:0.3, desc:'魔法 ×2.67・相手の防御を30%無視' },
  { name:'メガボム', cls:'アルケミスト', kind:M, mult:2.69, proc:75, mp:24, consumeAllAil:{ per:30, max:120 }, desc:'魔法 ×2.69。相手の状態異常をすべて解除し、1つにつき威力+30%（最大+120%）' },
  // 霊薬師：薬を重ねて、後半ほど強くなる
  { name:'調合の極意', cls:'霊薬師', kind:'passive', mp:0, passive:{ perStackDmg:{ key:'potion', pct:5 } }, desc:'薬効1つにつき与ダメージ+5%' },
  { name:'霊薬瓶', cls:'霊薬師', kind:M, mult:2.91, proc:95, mp:7, desc:'魔法 ×2.91' },
  { name:'剛力薬', cls:'霊薬師', kind:B, proc:100, mp:9, buff:{ self:{ str:15 } }, gain:{ key:'potion', n:1, max:5 }, priority:1, desc:'自分のSTR+15%・薬効+1' },
  { name:'叡智の薬', cls:'霊薬師', kind:B, proc:100, mp:9, buff:{ self:{ int_stat:20 } }, gain:{ key:'potion', n:1, max:5 }, priority:1, desc:'自分のINT+20%・薬効+1' },
  { name:'鉄身薬', cls:'霊薬師', kind:B, proc:100, mp:9, buff:{ self:{ vit:20 } }, gain:{ key:'potion', n:1, max:5 }, priority:1, desc:'自分のVIT+20%・薬効+1' },
  { name:'再生薬', cls:'霊薬師', kind:H, proc:90, mp:14, regenMax:{ pct:5, turns:4 }, desc:'4ターンの間、毎ターン最大HPの5%を回復' },
  { name:'霊薬', cls:'霊薬師', kind:H, proc:90, mp:14, heal:{ rate:1.5 }, mpHeal:{ rate:0.3 }, desc:'HP回復（倍率1.5）・MP回復（倍率0.3）' },
  { name:'薬効解放', cls:'霊薬師', kind:M, mult:2.49, proc:85, mp:16, useAll:{ key:'potion', per:0.25 }, desc:'魔法 ×2.49。薬効をすべて消費し、1つにつき威力+25%' },
  { name:'仙丹', cls:'霊薬師', kind:B, proc:100, mp:22, buff:{ self:{ str:15, dex:15, agi:15, int_stat:15, vit:15, luk:15 } }, gain:{ key:'potion', n:2, max:5 }, priority:1, desc:'自分の全能力+15%・薬効+2' },
]

// ===== 職業ごとの強さの倍率（2026-10-14 ユーザー指示「詳細な値はこっちで判断するから、どのクラスも平均的な強さになるように揃えて」）=====
// やったこと（どれも技の倍率だけを動かした。消費MP・発動率・効果の中身は表のまま）：
//   ① 連撃なのにクリティカルする10技を「クリティカルなし」にした（初期職と同じ決まり。クリティカルは「倍率×1.5＋1.5」なので、
//      1発の倍率が小さい連撃ほど何倍にも跳ね、LUKの高い忍者・暗殺者が強すぎた）。飛天三角蹴りは「回避したら全段クリティカル」が持ち味なので除いた
//   ② 値段で数えられる攻撃の技を、目標の強さ（初期職の帯×1.3＝ユーザーが選んだ）にそろえた。数えられない技は、その職業の真ん中の倍率で動かした
//   ③ 職業ごとに1つの倍率を掛け、ボス戦の強さ（LV55・80、前後3エリアの③のボス・組み方の例の強い方）が22職の平均±3%に入るまで合わせた
// 下の値＝その職業の攻撃の技の威力（効果の値段を除いたぶん）が、目標の強さの何倍か（値段で数えられる技の真ん中）。1より大きい職業は技の倍率で底上げし、
//   小さい職業は技の外の強さ（AGIを重ねる・分身・高いLUKなど）があるぶん倍率を下げた。★魔銃士は物理＋魔法で値段の付け方が無い（表の値の約0.84倍）
// ★ichijiRoster.test.js が「どの攻撃の技も、職業の倍率×目標の強さに近い」ことを見張る。数字を直したらここも直す
export const ICHIJI_CLASS_POWER = {
  侍: 0.94, 魔法剣士: 1.89, 狂戦士: 0.56, 聖騎士: 1.04, 竜騎士: 1.38, ストームランサー: 1.63, 体術師: 0.74, サイキッカー: 1.34,
  暗殺者: 0.31, 忍者: 0.47, 狩人: 0.95, アークアーチャー: 1.11, 魔銃士: null, デストロイヤー: 1.02, 元素使い: 1.67, クロノマンサー: 1.01,
  死霊使い: 1.0, 式神使い: 0.99, 聖職者: 0.87, 異端審問官: 1.23, アルケミスト: 1.24, 霊薬師: 1.54,
}

// 職ごとの組み方の例（ユーザーの表・各職2つ）。シミュレーターがこの組み方で戦う
export const ICHIJI_BUILDS = {
  侍:       [['納刀', '居合斬', '断空', '明鏡止水', '月影'], ['抜刀術', '二段斬り', '桜花一閃', '明鏡止水', '月影']],
  魔法剣士: [['魔剣開放', 'マナエッジ', 'マナバースト', '双極斬', 'エレメンタルエッジ'], ['ソードオーラ', '雷光斬', 'フロストエッジ', 'マナバースト', 'エレメンタルエッジ']],
  狂戦士:   [['マッドラッシュ', '狂撃', '血の誓い', '狂乱の咆哮', 'フルブレイカー'], ['血風斬', 'ブラッドスプラッシュ', 'ブラッディロア', '狂乱の咆哮', 'フルブレイカー']],
  聖騎士:   [['オースシールド', 'ホーリーエッジ', 'ディバインスマイト', 'ジャッジメントブロウ', '神聖覚醒'], ['大防御', 'シールドバッシュ', 'ホーリーケア', 'ジャッジメントブロウ', '神聖覚醒']],
  竜騎士:   [['ジャンプ', 'ハイジャンプ', 'ドラゴンスラスト', '竜鱗', '天墜竜閃'], ['ドラゴンファング', 'スカイスピア', 'ドラゴンロア', '竜鱗', '天墜竜閃']],
  ストームランサー: [['連突き', '流星突き', 'スパイラルスラスト', '間合い取り', '千本突き'], ['薙ぎ崩し', '足払い', '槍崩し', '間合い取り', '千本突き']],
  体術師:   [['受け流し', '流水の構え', '巴投げ', '半月蹴り', '飛天三角蹴り'], ['五連殺', '旋風脚', '破衝掌', '半月蹴り', '飛天三角蹴り']],
  サイキッカー: [['精神集中', 'サイコショット', 'マインドスパイク', 'サイキックチェイン', 'サイコブラスト'], ['マインドアクセル', 'テレキネシス', 'マインドブレイク', 'マインドスパイク', 'サイコブラスト']],
  暗殺者:   [['刻み斬り', '鬼影閃', '裂傷', '隠形', '急所突き'], ['影討ち', '首狩り', '隠形', 'ヴァイパーストライク', '急所突き']],
  忍者:     [['分身の術', '変わり身', '影斬り', '手裏剣', '千本手裏剣'], ['雷遁', '火遁', '毒霧の術', '影斬り', '千本手裏剣']],
  狩人:     [['毒矢', 'くくり罠', '裂き矢', '目くらまし', '仕留めの一矢'], ['毒矢', 'ハンターズマーク', '三連射', '狩猟の構え', '仕留めの一矢']],
  アークアーチャー: [['照準', '強弓', '貫き矢', '急所射ち', '絶影狙撃'], ['ラピッドショット', '息を止める', '弱点看破', '急所射ち', '絶影狙撃']],
  魔銃士:   [['焼夷弾', '雷撃弾', '氷結弾', 'ブレイクショット', 'アルカナバレット'], ['マナショット', '魔力装填', '連装魔撃', 'ブレイクショット', 'アルカナバレット']],
  デストロイヤー: [['装填', '速射', 'キャノン', '弾薬補給', 'フルバースト'], ['散弾', '速射', 'グレネード', 'スモークシェル', 'キャノン']],
  元素使い: [['詠唱', '魔力集中', 'メテオ', 'カタストロフ', 'ファイアボール'], ['ファイアボール', 'フロストノヴァ', 'ウィンドカッター', 'ライトニングボルト', 'カタストロフ']],
  クロノマンサー: [['アクセル', 'クイック', 'クロノバレット', 'リワインド', 'クロノブレイク'], ['スロウ', 'ディレイ', 'ストップ', 'クロノバレット', 'クロノブレイク']],
  死霊使い: [['骸骨召喚', '死の行軍', 'ボーンスピア', '魂喰らい', '幽世ノ門'], ['骸骨召喚', 'ソウルドレイン', '恐怖の囁き', '腐敗霧', '幽世ノ門']],
  式神使い: [['式神召喚', '鬼神降ろし', '式打ち', '火炎符', '禁術・神降ろし'], ['封の符', '陰陽結界', '魂削りの符', '火炎符', '禁術・神降ろし']],
  聖職者: [['ハイヒール', '奇跡', '祈りの結界', 'リザレクション', 'セイクリッドノヴァ'], ['聖光', 'ブレス', '癒しの光撃', '奇跡', 'セイクリッドノヴァ']],
  異端審問官: [['破魔の光', '狂信', '浄化の炎', '聖水', '断罪'], ['封魔の印', 'ホーリーチェイン', '聖なる裁き', '浄化の炎', '断罪']],
  アルケミスト: [['火炎瓶', '劇毒瓶', 'スパークボトル', '閃光弾', 'メガボム'], ['腐食液', '溶解液', '触媒', '劇毒瓶', 'メガボム']],
  霊薬師:   [['剛力薬', '叡智の薬', '鉄身薬', '仙丹', '霊薬瓶'], ['霊薬瓶', '剛力薬', '再生薬', '霊薬', '薬効解放']],
}
