// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 上位職のスキル（22職×10技＋パッシブ1つずつ）
// ------------------------------------------------------------
// 【確定】2026-10-10 ユーザーの表「一次職スキル一覧」（Claude Docs https://claude.ai/artifact/ToS4Bvfh5nNaykdt5ToEEn）。
//   パッシブは各職に1つで、転職した時点で効く（スキル枠は使わない）。
// 【確定】2026-10-14 ユーザー承認：上位職の並び替え（22職・V1の職業を続投・横文字の名前）。jobs.js の ICHIJI_INFO
// 【確定】2026-10-15 ユーザー「チャット版の方でいろいろ考えた。ダメージとか多分調整しきれてないから、ここで再度調整して。
//   コンセプトとかはこのままでいく」＝チャットで作った「調整後スキル一覧」（https://claude.ai/artifact/DvAQoMxY6sChec3wQhsFBE）。
//   ・技は CLASS LV 1／5／10／15／20／25／30／35／40／45 で10個（35・45 を足した）。並び＝覚える順
//   ・職業ごとの「仕組み」（納刀・属性の宿り・HPを払う・聖光・跳躍・コンボ・回避と反撃・動揺・出血ととどめ・分身・罠・
//     クリティカル・MPを弾にこめる・装填と砲撃・属性の連鎖・追加行動・死霊の数・結界・バリア・罪・化学反応・薬効）は設計のまま
//   ・威力はチャットの決まり（初期職の帯×1.3。STRとINTの両方を使う職は×1.25・HPを払う技は×1.15・溜める技は使う行動の回数ぶん・
//     条件つきの上乗せは乗る見込みで割り引く）で付けた値から始め、測って合わせた（下の ICHIJI_TUNE と ②・設計書 §4）
//   ・前の版の「職業ごとの倍率」（0.31〜1.89倍）はやめた（チャットの決まり）
//   ★今のⅡと同じ名前の技がある（マッドラッシュ・天墜竜閃 など）。中身はこの版のもの
//     （この版は名前を自分の名簿＝skills.js の SKILL_BY_NAME で引くので、今のⅡの技とは混ざらない）
//
// 戦闘で使う項目（今のⅡの戦闘エンジン src/v2/lib/battle.js・battleIchiji.js が読む）
//   今からあるもの … kind・mult・add・hits・noCrit・sureHit・sureCrit・defPen・buff（self/enemy）・buffTurns・ail・ailPerHit・
//     drain・heal・dispel・vsAil・priority・stance・whileStance
//   上位職で足したもの …
//     hpCostMax {pct, ifAbove}  最大HPの割合を払う（ifAbove％以上のときだけ）
//     recoil                    与えたダメージのこの割合を自分も受ける
//     lifeSteal {pct, turns}    その間、攻撃のたびに与えたダメージのpct％を回復
//     selfLowHp {at, mult}      自分のHPがat％以下なら威力×mult
//     guard {cut, turns, healPct?}  その間、受けるダメージ−cut％（healPct＝減らしたぶんの何％を回復）
//     jump {turns, mult, evade, defPen?, ail?}  跳んで turns ターン後に着地で物理×mult。跳んでいる間は evade％で回避
//     afterLand                 直前のターンに着地していれば威力×これ
//     comboHits {at, hits}      コンボがat以上なら連撃数をhitsに
//     hitMults [..]             1発ごとの倍率（連撃数＝長さ）
//     dodgeBoost {turns, pct, max}  その間、回避するたびに次の攻撃+pct％（max回ぶんまで）
//     critIfDodged              直前のターンに回避していれば全段クリティカル
//     gain {key, n, max}        溜め（照準 aim・装填 load・薬効 potion・分身 clone）を増やす
//     useAll {key, per?, addMult?}  溜めを全部使い、1つにつき 威力×(1+per) ／ 倍率+addMult
//     burstAil {key, perStack}  相手の状態異常（出血はスタック数）を全部使い、1つにつき威力+
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
//     elem                      魔法の属性（元素使いの共鳴が見る）
//     extraTurn {max}           このターン、もう一度行動する（戦闘中max回まで）
//     rewind {turns, pct}       直前turnsターンで受けたダメージのpct％を回復
//     agiDiff {per, max}        自分のAGIが相手より高い割合1％につき威力+per％（最大max％）
//     summon {key, n, max, mult, setMax?}  召喚（死霊・式神）。毎ターン魔法×multで攻撃する（setMax＝この戦闘の間の最大数）
//     summonBoost {key, pct, turns} ／ summonHits {key, hits, turns}  召喚の攻撃を強くする／連撃にする
//     noRepeat                  続けては使えない（直前に使っていれば次の技へ回す）
//     regenMax {pct, turns}     その間、毎ターン最大HPのpct％を回復
//     healMax                   最大HPのこの％を回復 ／ mpGain＝MPをこれだけ回復 ／ mpHeal {rate}＝INT×rateのMPを回復
//     revive {pct}              戦闘中1回、HPが0になったらHPpct％で立ち上がる
//     healDmg {pct, capMult}    この戦闘で回復したHP（バリアになったぶんも）のpct％を足す（上限は魔法×capMultぶん）
//     vsRace {races, mult}      相手がその種族なら威力×mult（★敵の種族はあとでまとめて足す＝いまは効かない）
//     vsAilMult {key, mult}     相手がその状態異常なら威力×mult
//     debuffImmune {turns}      その間、自分の能力低下を受けない
//     consumeAllAil {per, max}  相手の状態異常をすべて解除し、1つにつき威力+per％（最大max％）
//   2026-10-15 の作り直しで足したもの …
//     usesMax                   編成に置ける回数の上限（狂鬼化・ゴスペル・エリクサー＝1・不動の誓い＝2）
//     stanceMult・noStanceMult  納刀の倍率の上書き（秘剣・叢雲＝納刀中1.8倍・納刀していないと0.8倍）
//     whileStance {crit}        納刀中ならクリティカル率+（居合斬）／dmg＝納刀中は威力+%（桜花一閃のアセンション・2026-10-16）
//     stance {eva}              納刀状態のあいだ回避率+（納刀のアセンション・2026-10-16）
//     afterStance {mult, reStance}  直前の技を納刀中に撃っていれば威力×・当てたらもう一度納刀（二の太刀）
//     imbue                     当てたらその属性が剣に宿る（fire・ice・thunder）／imbueExtend＝宿りの残りターン+
//     consumeImbue {mult, ailChance}  宿りを消して威力×・その属性の状態異常（マナバースト）
//     whileImbue {mult}         宿りがあれば威力×（双極斬）／imbueMult＝宿りの追加効果×（エレメンタルエッジ）
//     hitElems [..]             1発ごとにその属性の追加効果（トリニティブレイド）
//     paidDmg                   払ったHPのこの割合を追加ダメージ（防御無視・ブラッドサクリファイス）
//     berserk {turns, str}      HPを1にする・その間HPが1より下がらず回復を受けない・STR+str％（狂鬼化・2026-10-16 作り直し。前は lastStand）
//     useBelowHp                HPがこの％以下のときだけ使う（狂鬼化＝30・2026-10-17）
//     holyTurn                  そのターンに溜まる聖光×（大防御）／useHoly {frac}＝聖光のこの割合を使って追加ダメージ（防御無視）
//     vow {turns, cut, holyPct} その間、受けるダメージ−cut％・状態異常にかからない・溜まる聖光+holyPct％（不動の誓い）
//     soar {turns, land, proc}  その間、着地ダメージ+land％・跳躍の技の発動率+proc（竜翔）
//     comboBoost {turns, n}     その間、1ヒットでコンボ+n（嵐の構え）／comboDefPen {at, defPen}／comboPower {per, max}
//     counterBoost {turns, pct} その間、回避したときの反撃の威力+pct％（後の先）／dodgeCountPower {per, max}（流転掌）
//     agitate {n, chance?}      当てたら相手に動揺+n（chance％で）／agitPower {per, max}＝相手の動揺1つにつき威力+（メンタルクラッシュ）
//     foeLowHp {at, mult}       相手のHPがat％以下なら威力×mult（首狩り・絶命）
//     ailUp {key, pct, turns}   その間、その状態異常を付ける確率+pct（死の刻印）
//     gainOnHit {key, n, max}   当てたら溜めが増える（影斬り＝分身+1）
//     trap {mult, ail?, debuff?}  罠を置く（2つまで）。相手が攻撃してきたとき発動して物理×mult（必ず当たる）・状態異常・能力ダウン
//     hitsByAil [{at, n}]       相手の状態異常がat個以上なら連撃+n（ワイルドハント）
//     aimCrit                   照準1つにつきクリティカル率+（照準）／lockOn {turns, critDmg}＝その間、必中・クリティカルのダメージ+
//     mpGainPct                 最大MPのこの％を回復（魔力装填）／mpRatioPower {max}／mpAbove {at, mult}／mpUsedPower {perMp, per, max}
//     mpPct                     消費MPを「そのときの残りMPの割合」にする（オーバーロードショット）
//     hitsPerStackUse {key, n, max, use}  撃つ前の溜め1つにつき連撃+n（最大max）・そのあと use 使う（カーペットボム）
//     resoGain                  共鳴+（詠唱）／useReso {per, max, fullAils}＝共鳴を全部使って威力+（プリズムバースト）
//     repeatLast {mpMult}       直前に撃った技をもう一度（MPはその技の×mpMult）／noRepeatTarget＝リピートで繰り返せない技
//     extraCountPower {per, max}  この戦闘で追加で動いた回数1回につき威力+（パラドックス）
//     perStackAdd {key, addMult}  溜め1つにつき倍率+（使わない・ソウルハーヴェスト）
//     barrier                   結界（張れるのは1つ）／bind {turns, foeAgi, ailExtend}＝封縛結界／whileBarrier {mult}／summonStrike {key}
//     shieldGain {pct, stat}    最大HPのpct％のバリア・バリアがある間のステ+%（光の帳）
//     gospel {turns, healMult, shieldCap}  その間、回復量×・状態異常にかからない・バリアの上限（ゴスペル）
//     sinGain・useSin {per}     罪+（異端の烙印）／罪を全部使って1つにつき威力+per％（断罪）
//     preAil                    状態異常（ails）を撃つ前に付ける＝この一撃から化学反応が乗る（爆炎毒）
//     philo {turns, ailUp, react}  その間、状態異常を付ける確率+・化学反応の上乗せ+（賢者の石）
//     defPenPerStack {key, per, max}  溜め1つにつき防御無視+（浸透薬）
//     hitBonus                  命中しやすい（EASY_HIT＝相手の回避−10%）
//   パッシブ（passive）… lowHpDmg・immune・statPct・landPct・combo・counterOnDodge・perStackDmg・perFoeBleed・
//     cloneFollow・noCloneAgi・cloneGuard・perFoeAil・critFollow・whileStackGuard・extraIfFaster・guardPerStack・
//     whileSummonOrGuard・healBonus・bothAil・vsDebuff・misfireStance・imbue・holy・misfireChase・mpPower・reso・
//     overShield・vsRace・sin
// ============================================================
const P = 'phys'
const M = 'mag'
const B = 'buff'
const H = 'heal'
// 納刀（次に撃つスキルが発動率+20%・威力1.5倍・先制）
const STANCE = { proc: 20, mult: 1.5, priority: 1 }
// ★命中しやすい（2026-10-15 ユーザー決定）：その技だけ相手の回避を10%下げる（combat.js の hitBonus＝回避率から引くポイント）。
//   対人で外しやすい職（DEXが低い 魔法剣士・聖騎士・サイキッカー・聖職者・異端審問官・元素使い）の技に1〜2個。
//   対人で強い職（侍・死霊使い・式神使い・霊薬師・魔銃士）と、必ず当たる技を持つ職には付けない
export const EASY_HIT = 10

export const ICHIJI_SKILLS = [
  // ===== 剣士系 =====
  // 侍【納刀】：納刀で構え、抜き打ちの一太刀で斬り崩す。並べ順で「納刀→大技」を組む
  { name:'居合の構え', cls:'侍', kind:'passive', mp:0, passive:{ misfireAtkMult:1.5, misfireStance:STANCE }, desc:'スキルが不発したとき、通常攻撃（威力1.5倍）のあと納刀状態になる。次のターンに同じ技を納刀つきで撃ち直す形になる' },
  { name:'居合斬', cls:'侍', kind:P, mult:1.2, add:[{ stat:'dex', rate:0.33 }], proc:90, mp:10, ail:{ key:'bleed', chance:20 }, whileStance:{ ailChance:100, crit:20 }, desc:'抜き打ち。20%で出血。納刀中は出血が確定・クリティカル率+20%' },
  { name:'納刀', cls:'侍', kind:B, proc:100, mp:6, priority:1, stance:STANCE, desc:'納刀状態になる。次に撃つスキルが発動率+20%・威力1.5倍・先制になる（撃つと消える）' },
  { name:'抜刀術', cls:'侍', kind:P, mult:1.35, add:[{ stat:'dex', rate:0.23 }], proc:88, mp:11, stance:STANCE, desc:'軽く斬りつけてから鞘に納める（斬りながら納刀に入る）' },
  { name:'断空', cls:'侍', kind:P, mult:1.78, defPen:0.3, proc:85, mp:14, whileStance:{ defPen:0.2 }, desc:'相手の防御を30%無視。納刀中はさらに20%無視（計50%）' },
  { name:'明鏡止水', cls:'侍', kind:B, proc:100, mp:12, buff:{ self:{ str:20, dex:20 } }, stance:STANCE, priority:1, desc:'STR+20%・DEX+20%（重ねがけ可）。納刀状態になる' },
  { name:'二段斬り', cls:'侍', kind:P, mult:0.82, add:[{ stat:'dex', rate:0.13 }], hits:2, proc:85, mp:14, noCrit:true, whileStance:{ defPen:0.35 }, desc:'2連撃。クリティカルしない。納刀中は相手の防御を35%無視' },
  { name:'桜花一閃', cls:'侍', kind:P, mult:1.68, add:[{ stat:'dex', rate:0.17 }], proc:82, mp:17, ail:{ key:'bleed', chance:30 }, whileStance:{ ailChance:100 }, desc:'30%で出血。納刀中は必ず出血' },
  { name:'二の太刀', cls:'侍', kind:P, mult:1.47, add:[{ stat:'dex', rate:0.19 }], proc:85, mp:14, afterStance:{ mult:1.25, reStance:STANCE }, desc:'直前の技を納刀中に撃っていれば威力+25%、当てるともう一度納刀状態になる（納刀→技→二の太刀→技、と並べてつなげる）' },
  { name:'月影', cls:'侍', kind:P, mult:1.92, proc:78, mp:22, ail:{ key:'bleed', chance:40 }, whileStance:{ ailChance:100 }, desc:'40%で出血。納刀中は出血が確定' },
  { name:'秘剣・叢雲', cls:'侍', kind:P, mult:1.94, add:[{ stat:'dex', rate:0.17 }], proc:75, mp:28, stanceMult:1.7, noStanceMult:0.8, desc:'納刀中に撃つと威力が1.5倍ではなく1.7倍。納刀中でないと威力−20%' },
  // 魔法剣士【属性の宿り】：剣に属性を宿し、斬るたびに魔法の追撃を乗せる
  { name:'エンチャント', cls:'魔法剣士', kind:'passive', mp:0, passive:{ imbue:{ turns:3, intToStr:20 } }, desc:'属性の剣技を当てると、その属性が剣に3ターン宿る（1つだけ・別の属性で上書き）。宿っている間は、ほかの剣技と通常攻撃にも属性の追加効果が乗り、INTの20%をSTRに上乗せする（INTは減らない）。炎：INT×0.2の追撃・15%で火傷／氷：相手のAGI−5%（最大−20%）・15%で鈍足／雷：相手の防御を15%無視・5%で麻痺' },
  { name:'マナエッジ', cls:'魔法剣士', kind:P, mult:1.81, add:[{ stat:'int_stat', rate:0.48 }], proc:90, mp:10, desc:'魔力をまとわせて斬る' },
  { name:'雷光斬', cls:'魔法剣士', kind:P, mult:1.38, add:[{ stat:'int_stat', rate:0.68 }], proc:90, mp:10, ail:{ key:'paralyze', chance:6 }, imbue:'thunder', hitBonus:EASY_HIT, desc:'命中しやすい。6%で麻痺。雷を宿す' },
  { name:'魔剣開放', cls:'魔法剣士', kind:B, proc:100, mp:18, buff:{ self:{ str:20, int_stat:20 } }, imbueExtend:2, priority:1, desc:'STR+20%・INT+20%（重ねがけ可）。宿りの残りターン+2' },
  { name:'フロストエッジ', cls:'魔法剣士', kind:P, mult:1.45, add:[{ stat:'int_stat', rate:0.44 }], proc:88, mp:11, ail:{ key:'slow', chance:35 }, imbue:'ice', desc:'35%で鈍足。氷を宿す' },
  { name:'マナバースト', cls:'魔法剣士', kind:M, mult:1.86, add:[{ stat:'str', rate:0.44 }], proc:85, mp:14, consumeImbue:{ mult:1.3, ailChance:40 }, hitBonus:EASY_HIT, desc:'命中しやすい。宿りを消して威力+30%、その属性の状態異常を40%で付ける（宿りが無いときは上乗せなし）' },
  { name:'双極斬', cls:'魔法剣士', kind:P, mult:1.55, add:[{ stat:'int_stat', rate:0.59 }], proc:85, mp:14, whileImbue:{ mult:1.25 }, desc:'宿りがあれば威力+25%' },
  { name:'ソードオーラ', cls:'魔法剣士', kind:B, proc:100, mp:15, buff:{ self:{ agi:20, str:20 } }, priority:1, desc:'AGI+20%・STR+20%（重ねがけ可）' },
  { name:'フレイムエッジ', cls:'魔法剣士', kind:P, mult:1.64, add:[{ stat:'int_stat', rate:0.64 }], proc:85, mp:14, ail:{ key:'burn', chance:35 }, imbue:'fire', desc:'35%で火傷。炎を宿す（これで炎・氷・雷の3つがそろう）' },
  { name:'エレメンタルエッジ', cls:'魔法剣士', kind:P, mult:1.26, add:[{ stat:'int_stat', rate:1 }], proc:80, mp:20, imbueMult:2, desc:'宿っている属性の追加効果が2倍' },
  { name:'トリニティブレイド', cls:'魔法剣士', kind:P, mult:0.5, add:[{ stat:'int_stat', rate:0.32 }], hits:3, noCrit:true, proc:75, mp:28, hitElems:['fire', 'ice', 'thunder'], imbue:'thunder', desc:'炎→氷→雷の順に斬り、各段にその属性の追加効果が出る。最後に雷が宿る。クリティカルしない' },

  // ===== 戦士系 =====
  // 狂戦士【HPを払う】：攻撃の技は最大HPの一部を払って撃つ（HPは1未満にならない）。払う→バーサクで伸びる→吸収で戻す
  { name:'バーサク', cls:'狂戦士', kind:'passive', mp:0, passive:{ lowHpDmg:[{ at:50, pct:10 }, { at:25, pct:20 }] }, desc:'HP50%以下で与ダメージ+10%、25%以下で+20%' },
  { name:'マッドラッシュ', cls:'狂戦士', kind:P, mult:1.63, proc:95, mp:3, hpCostMax:{ pct:3 }, desc:'最大HPの3%を払う' },
  { name:'血風斬', cls:'狂戦士', kind:P, mult:1.9, proc:85, mp:12, drain:0.15, desc:'与えたダメージの15%をHP回復' },
  { name:'狂乱の咆哮', cls:'狂戦士', kind:B, proc:100, mp:10, buff:{ self:{ str:30 } }, ail:{ key:'fear', chance:40 }, priority:1, desc:'自分のSTR+30%・40%で相手に恐怖' },
  { name:'ブラッドスプラッシュ', cls:'狂戦士', kind:P, mult:1.71, proc:88, mp:6, hpCostMax:{ pct:5 }, ail:{ key:'bleed', chance:50 }, desc:'最大HPの5%を払う。50%で出血' },
  { name:'狂撃', cls:'狂戦士', kind:P, mult:2.02, proc:85, mp:14, recoil:0.15, desc:'与えたダメージの15%を自分も受ける' },
  { name:'ブラッディロア', cls:'狂戦士', kind:B, proc:100, mp:14, lifeSteal:{ pct:10, turns:4 }, priority:1, desc:'4ターンの間、攻撃のたびに与えたダメージの10%をHP回復' },
  { name:'血の誓い', cls:'狂戦士', kind:B, proc:100, mp:10, hpCostMax:{ pct:10 }, buff:{ self:{ str:30 } }, priority:1, desc:'自分の最大HPの10%を消費し、STR+30%' },
  { name:'ブラッドサクリファイス', cls:'狂戦士', kind:P, mult:1.76, proc:85, mp:6, hpCostMax:{ pct:12 }, paidDmg:0.4, desc:'最大HPの12%を払う。払ったHPの40%を追加ダメージにする（防御無視）' },
  { name:'フルブレイカー', cls:'狂戦士', kind:P, mult:1.74, proc:80, mp:11, hpCostMax:{ pct:8 }, defPen:0.3, selfLowHp:{ at:25, mult:1.5 }, desc:'最大HPの8%を払う。相手の防御を30%無視。自分のHPが25%以下なら威力×1.5' },
  // 【確定】2026-10-16 ユーザーがスキル一覧のシートで書き直した「HPが1になる、3ターンHPが1以下にならない、回復効果を受けつかない、
  //   STRが50%UP（バトル中1回のみ）」。3つとも同じ3ターン（アセンションで4ターン）。前は「次に倒れるダメージを1度だけHP1で耐える・耐えるまで払うHPが半分」
  //   【確定】2026-10-17 ユーザー選択「HP30%以下で使う」（useBelowHp）：すぐ使うと対人4%／11%（3ターン後に倒れる）・ボス戦115／128だった。
  //   30%以下ならボス戦117／109・対人60%／65%（LV55／80・前の形は111／112・57%／62%）
  { name:'狂鬼化', cls:'狂戦士', kind:B, proc:100, mp:10, berserk:{ turns:3, str:50 }, useBelowHp:30, usesMax:1, priority:1, desc:'HPが30%以下のときだけ使える。HPが1になる。3ターンの間HPが1より下がらず、回復効果を受けつけない。その間STR+50%（バトル中1回のみ）' },
  // 聖騎士【聖光】：防御や軽減で減らしたダメージを聖光として溜め、攻撃の技で追加ダメージにする。STRとVITが半分ずつ威力になる
  { name:'聖騎士の心得', cls:'聖騎士', kind:'passive', mp:0, passive:{ statPct:{ vit:5 }, defRed:10, holy:{ pct:20, cap:15 } }, desc:'VIT+5%・受けるときの軽減率+10%・防御や軽減で減らしたダメージの20%を聖光として溜める（上限は最大HPの15%）' },
  { name:'ホーリーエッジ', cls:'聖騎士', kind:P, mult:0.86, add:[{ stat:'vit', rate:0.86 }], proc:90, mp:10, desc:'聖なる刃で斬りつける' },
  { name:'オースシールド', cls:'聖騎士', kind:B, proc:100, mp:13, buff:{ self:{ vit:30 } }, priority:1, desc:'VIT+30%（重ねがけ可）' },
  { name:'シールドバッシュ', cls:'聖騎士', kind:P, mult:0.83, add:[{ stat:'vit', rate:0.83 }], proc:90, mp:10, ail:{ key:'paralyze', chance:8 }, hitBonus:EASY_HIT, desc:'命中しやすい。8%で麻痺' },
  { name:'ディバインスマイト', cls:'聖騎士', kind:P, mult:0.95, add:[{ stat:'vit', rate:0.95 }], proc:85, mp:14, buff:{ enemy:{ str:-10 } }, desc:'相手のSTR-10%（重ねがけ可）' },
  { name:'ホーリーケア', cls:'聖騎士', kind:H, proc:85, mp:16, heal:{ rate:1.35 }, desc:'祈りでHPを戻す' },
  { name:'大防御', cls:'聖騎士', kind:B, proc:100, mp:14, bigGuard:{ cut:60 }, holyTurn:2, priority:1, desc:'盾を構えて耐える。1ターンのあいだ受けるダメージ-60%。そのターンは追加行動が出ない。そのターンに溜まる聖光が2倍' },
  { name:'ジャッジメントブロウ', cls:'聖騎士', kind:P, mult:0.88, add:[{ stat:'vit', rate:0.88 }], proc:85, mp:14, useHoly:{ frac:0.5 }, desc:'裁きの一撃。聖光の半分を使い、使った量を追加ダメージにする' },
  { name:'不動の誓い', cls:'聖騎士', kind:B, proc:100, mp:14, vow:{ turns:3, cut:15, holyPct:50 }, usesMax:2, priority:1, desc:'3ターンの間、受けるダメージ−15%・状態異常にかからない・溜まる聖光+50%（編成に置けるのは2回まで）' },
  { name:'神聖覚醒', cls:'聖騎士', kind:P, mult:1.08, add:[{ stat:'vit', rate:1.08 }], proc:80, mp:20, desc:'聖なる力を解き放って斬る' },
  { name:'グランドクロス', cls:'聖騎士', kind:P, mult:0.82, add:[{ stat:'vit', rate:0.82 }], proc:75, mp:28, sureHit:true, useHoly:{ frac:1 }, desc:'必ず当たる。聖光をすべて使い、使った量を追加ダメージにする' },

  // ===== 槍使い系 =====
  // 竜騎士【跳躍】：跳んでいる間（1〜2ターン）は相手の攻撃を15%で回避し、着地で大きく攻める。
  //   ★2026-10-21 ユーザー「溜め技の威力が高くなるのはいいけど、ほかの職に比べて無条件で高くないか」「出血5への攻撃をMAX火力5だとして、無条件なんだから3.5とか」：
  //   跳躍は条件の無い技なので 3.5（3ターンのハイジャンプは4.3＝パッシブ込みで5まで）。そのぶん条件つきの「着地の次の天墜竜閃」を×1.2→×2.5（下の⑤）
  { name:'竜の血', cls:'竜騎士', kind:'passive', mp:0, passive:{ landPct:15, statPct:{ vit:10 } }, desc:'跳躍スキルの着地ダメージ+15%・自分のVIT+10%' },
  { name:'ドラゴンスラスト', cls:'竜騎士', kind:P, mult:1.57, proc:95, mp:7, defPen:0.1, desc:'相手の防御を10%無視' },
  { name:'ジャンプ', cls:'竜騎士', kind:P, mult:3.5, proc:85, mp:14, jump:{ turns:1, mult:3.5, evade:15 }, desc:'跳躍して、次のターンに着地して攻撃。跳躍中は相手の攻撃を15%で回避' },
  { name:'ドラゴンファング', cls:'竜騎士', kind:P, mult:0.87, hits:2, noCrit:true, proc:88, mp:12, defPen:0.2, desc:'2連撃。相手の防御を20%無視・クリティカルなし' },
  { name:'スカイスピア', cls:'竜騎士', kind:P, mult:1.41, add:[{ stat:'dex', rate:0.33 }], proc:88, mp:11, sureHit:true, desc:'必ず当たる' },
  { name:'ドラゴンロア', cls:'竜騎士', kind:B, proc:100, mp:12, buff:{ enemy:{ str:-15, int_stat:-15 } }, ail:{ key:'fear', chance:40 }, priority:1, desc:'相手のSTR-15%・INT-15%・40%で恐怖' },
  { name:'竜鱗', cls:'竜騎士', kind:B, proc:100, mp:10, buff:{ self:{ vit:20, agi:20 } }, priority:1, desc:'自分のVIT+20%・AGI+20%' },
  { name:'ハイジャンプ', cls:'竜騎士', kind:P, mult:4.3, proc:80, mp:18, jump:{ turns:2, mult:4.3, evade:15 }, desc:'跳躍して、2ターン後に着地して攻撃。跳躍中は相手の攻撃を15%で回避' },
  { name:'竜翔', cls:'竜騎士', kind:B, proc:100, mp:12, soar:{ turns:3, land:20, proc:10 }, priority:1, desc:'3ターンの間、着地ダメージ+20%・跳躍の技の発動率+10%' },
  { name:'天墜竜閃', cls:'竜騎士', kind:P, mult:1.83, proc:75, mp:24, defPen:0.3, afterLand:2.5, desc:'溜めなしで撃つ。相手の防御を30%無視。直前のターンに着地していれば×2.5' },
  { name:'天竜落とし', cls:'竜騎士', kind:P, mult:3.5, proc:75, mp:28, jump:{ turns:1, mult:3.5, evade:15, defPen:0.3, ail:{ key:'fear', chance:30 } }, desc:'跳躍して1ターン後に着地して攻撃（跳躍中は15%で回避）。相手の防御を30%無視・30%で恐怖' },
  // ストームランサー【コンボ】：1ヒットごとにコンボ+1（最大20）。多段で稼ぎ、決め技に乗せる
  { name:'槍の型', cls:'ストームランサー', kind:'passive', mp:0, passive:{ combo:{ max:20, pct:2 } }, desc:'攻撃が1ヒットするごとにコンボ+1（最大20）。コンボ1につき与ダメージ+2%' },
  { name:'連突き', cls:'ストームランサー', kind:P, mult:0.54, hits:3, proc:95, mp:6, noCrit:true, desc:'3連撃。クリティカルなし' },
  { name:'薙ぎ崩し', cls:'ストームランサー', kind:P, mult:1.7, proc:90, mp:9, buff:{ enemy:{ agi:-20 } }, desc:'相手のAGI-20%' },
  { name:'スパイラルスラスト', cls:'ストームランサー', kind:P, mult:1.87, proc:85, mp:12, defPen:0.25, desc:'相手の防御を25%無視' },
  { name:'足払い', cls:'ストームランサー', kind:P, mult:1.73, proc:88, mp:9, ail:{ key:'slow', chance:40 }, desc:'40%で鈍足' },
  { name:'流星突き', cls:'ストームランサー', kind:P, mult:0.34, hits:6, proc:85, mp:15, noCrit:true, desc:'6連撃。クリティカルなし' },
  { name:'嵐の構え', cls:'ストームランサー', kind:B, proc:100, mp:10, buff:{ self:{ agi:20, dex:20 } }, comboBoost:{ turns:3, n:2 }, priority:1, desc:'自分のAGI+20%・DEX+20%。3ターンの間、1ヒットでコンボ+2' },
  { name:'槍崩し', cls:'ストームランサー', kind:P, mult:1.9, proc:85, mp:12, buff:{ enemy:{ vit:-20 } }, desc:'相手のVIT-20%' },
  { name:'疾風連突', cls:'ストームランサー', kind:P, mult:0.46, hits:4, noCrit:true, proc:88, mp:12, comboDefPen:{ at:10, defPen:0.1 }, desc:'4連撃。コンボが10以上なら各段が相手の防御を10%無視。クリティカルなし' },
  { name:'千本突き', cls:'ストームランサー', kind:P, mult:0.23, hits:8, noCrit:true, proc:80, mp:22, comboHits:{ at:10, hits:10 }, desc:'8連撃。コンボが10以上なら10連撃・クリティカルなし' },
  { name:'テンペストランス', cls:'ストームランサー', kind:P, mult:1.66, proc:75, mp:28, defPen:0.2, comboPower:{ per:3, max:60 }, desc:'コンボ1につき威力+3%（最大+60%）・相手の防御を20%無視。コンボは減らない' },

  // ===== 格闘家系 =====
  // 体術師【回避と反撃】：回避するたびに反撃する。この戦闘で回避した回数を決め技の威力にする
  // 【地上と空中】2026-10-17 ユーザー「体術師のパッシブとスキル、スキルによって地上状態と空中状態が切り替わるようにして、
  //   同じスキルでも状態によって効果や威力代わるようにして、補助skillは統一でいい、スキルによっては状態関わらず同じ内容のスキルがあってもいい」
  //   戦闘は地上から。跳び上がる技で空中へ（空中のあいだ回避+10%＝battle.js の AIR_EVA・直接の回避は重ねても15%まで）。
  //   空中で留まる技以外の攻撃を撃つと着地する。onGround／inAir＝撃ち始めの状態で足す効き目（battleIchiji.js の ichijiSkillPrep・battle.js の空中の所）。
  //   補助の技（受け流し・流水の構え・後の先）と流転掌は、地上でも空中でも同じ
  //   心眼は地上と空中で役目が分かれる：地上＝回避したら反撃／空中＝反撃しないが回避+10%（測った：地上で受けるダメージ−10%も付けた形はボス戦106／110で強すぎた）
  { name:'心眼', cls:'体術師', kind:'passive', mp:0, passive:{ counterOnDodge:0.6, counterAirMult:0 }, desc:'地上：攻撃を回避するたびに物理 ×0.6で反撃／空中：反撃はしないが、回避+10%' },
  { name:'半月蹴り', cls:'体術師', kind:P, mult:1.63, proc:95, mp:6, onGround:{ airUp:true }, inAir:{ mult:30 }, desc:'地上：蹴り上げて跳び上がる（空中へ）／空中：蹴り下ろして着地（威力+30%）' },
  { name:'受け流し', cls:'体術師', kind:B, proc:100, mp:8, buff:{ self:{ agi:30 } }, priority:1, desc:'自分のAGI+30%' },
  { name:'五連殺', cls:'体術師', kind:P, mult:0.4, hits:5, proc:85, mp:14, noCrit:true, inAir:{ hits:1, keepAir:true }, desc:'5連撃。' },
  { name:'旋風脚', cls:'体術師', kind:P, hitMults:[0.45, 0.68, 0.89], noCrit:true, proc:85, mp:13, onGround:{ airUp:true }, inAir:{ mult:20, keepAir:true }, desc:'3連撃（1発ごとに強くなる）。クリティカルなし／地上：回りながら跳び上がる（空中へ）／空中：威力+20%・空中に留まる' },
  { name:'巴投げ', cls:'体術師', kind:P, mult:1.56, add:[{ stat:'agi', rate:0.36 }], proc:85, mp:12, buff:{ enemy:{ agi:-10 } }, inAir:{ mult:40 }, desc:'相手のAGI-10%／空中：投げ落として着地（威力+40%）' },
  { name:'流水の構え', cls:'体術師', kind:B, proc:100, mp:12, dodgeBoost:{ turns:3, pct:20, max:3 }, priority:1, desc:'3ターンの間、回避するたびに次の攻撃の威力+20%（最大3回分）' },
  { name:'破衝掌', cls:'体術師', kind:P, mult:1.84, proc:85, mp:14, defPen:0.3, inAir:{ mult:40 }, desc:'相手の防御を30%無視／空中：叩きつけて着地（威力+40%）' },
  { name:'後の先', cls:'体術師', kind:B, proc:100, mp:12, counterBoost:{ turns:3, pct:60 }, priority:1, desc:'3ターンの間、回避したときの反撃の威力+60%' },
  { name:'飛天三角蹴り', cls:'体術師', kind:P, hitMults:[0.47, 0.66, 0.93], proc:80, mp:22, critIfDodged:true, onGround:{ airUp:true }, inAir:{ crit:30, keepAir:true }, desc:'3連撃（1発ごとに強くなる）。直前のターンに回避していれば全段クリティカル／地上：跳び上がる（空中へ）／空中：クリティカル率+30%・空中に留まる' },
  { name:'流転掌', cls:'体術師', kind:P, mult:1.83, proc:78, mp:28, dodgeCountPower:{ per:5, max:50 }, desc:'この戦闘で回避した回数1回につき威力+5%（最大+50%）。地上でも空中でも同じ（空中で撃つと着地）' },
  // サイキッカー【動揺】：念で心を乱し（動揺＝相手のスキル発動率−3%・最大−15%）、相手の技を空振りさせる。
  //   STRとINTが半分ずつ威力になる（念の技は相手の魔法防御で受ける）
  { name:'精神感応', cls:'サイキッカー', kind:'passive', mp:0, passive:{ misfireChase:{ mult:0.3 } }, desc:'相手のスキルが不発するたび、STR×0.3＋INT×0.3で念動の追撃（相手の魔法防御で受ける）。動揺は相手のスキル発動率を−3%する（重ねがけ可・最大−15%）' },
  { name:'サイコショット', cls:'サイキッカー', kind:M, src:'str', mult:1.31, add:[{ stat:'int_stat', rate:1.31 }], proc:90, mp:10, hitBonus:EASY_HIT, desc:'念で撃つ。命中しやすい' },
  { name:'精神集中', cls:'サイキッカー', kind:B, proc:100, mp:16, buff:{ self:{ str:20, int_stat:20 } }, priority:1, desc:'STR+20%・INT+20%（重ねがけ可）' },
  { name:'テレキネシス', cls:'サイキッカー', kind:M, src:'str', mult:1.3, add:[{ stat:'int_stat', rate:1.3 }], proc:90, mp:10, agitate:{ n:1, chance:50 }, desc:'念力で叩きつける。50%で動揺+1' },
  { name:'マインドブレイク', cls:'サイキッカー', kind:M, src:'str', mult:1.25, add:[{ stat:'int_stat', rate:1.25 }], proc:85, mp:14, buff:{ enemy:{ str:-15, int_stat:-20 } }, ail:{ key:'frenzy', chance:20 }, agitate:{ n:1 }, desc:'精神を砕く。相手のSTR-15%・INT-20%（重ねがけ可）。20%で狂乱。動揺+1' },
  { name:'マインドスパイク', cls:'サイキッカー', kind:M, src:'str', mult:1.46, add:[{ stat:'int_stat', rate:1.46 }], proc:85, mp:14, hitBonus:EASY_HIT, desc:'精神を直接刺す。命中しやすい' },
  { name:'マインドアクセル', cls:'サイキッカー', kind:B, proc:100, mp:15, buff:{ self:{ agi:20, int_stat:20 } }, priority:1, desc:'AGI+20%・INT+20%（重ねがけ可）' },
  { name:'サイキックチェイン', cls:'サイキッカー', kind:P, src:'str', mult:0.45, add:[{ stat:'int_stat', rate:0.45 }], hits:3, proc:80, mp:20, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'マインドジャック', cls:'サイキッカー', kind:M, src:'str', mult:1.33, add:[{ stat:'int_stat', rate:1.33 }], proc:85, mp:14, ail:{ key:'frenzy', chance:20 }, agitate:{ n:2 }, desc:'動揺+2・20%で狂乱' },
  { name:'サイコブラスト', cls:'サイキッカー', kind:M, src:'str', mult:1.56, add:[{ stat:'int_stat', rate:1.56 }], proc:80, mp:20, desc:'念を一気に放つ' },
  { name:'メンタルクラッシュ', cls:'サイキッカー', kind:M, src:'str', mult:1.46, add:[{ stat:'int_stat', rate:1.46 }], proc:75, mp:28, agitPower:{ per:6, max:30 }, desc:'相手の動揺1つにつき威力+6%（最大+30%）。動揺は残る' },

  // ===== 盗賊系 =====
  // 暗殺者【出血ととどめ】：出血を重ねるほど与ダメージが上がる。とどめの技は相手のHPが低ければ威力が上がる
  { name:'血の匂い', cls:'暗殺者', kind:'passive', mp:0, passive:{ perFoeBleed:5 }, desc:'出血している相手への与ダメージ+（出血の重なり数×5%）' },
  { name:'刻み斬り', cls:'暗殺者', kind:P, mult:0.94, add:[{ stat:'agi', rate:0.35 }], proc:95, mp:6, ail:{ key:'bleed', chance:50 }, desc:'50%で出血' },
  { name:'鬼影閃', cls:'暗殺者', kind:P, mult:0.48, add:[{ stat:'agi', rate:0.21 }], hits:2, noCrit:true, proc:88, mp:12, ail:{ key:'bleed', chance:40 }, ailPerHit:true, desc:'2連撃。それぞれ40%で出血・クリティカルなし' },
  { name:'ヴァイパーストライク', cls:'暗殺者', kind:P, mult:1.12, add:[{ stat:'agi', rate:0.35 }], proc:88, mp:11, ail:{ key:'poison', chance:50 }, desc:'50%で毒' },
  { name:'隠形', cls:'暗殺者', kind:B, proc:100, mp:10, buff:{ self:{ agi:30 } }, priority:1, desc:'自分のAGI+30%' },
  { name:'裂傷', cls:'暗殺者', kind:P, mult:0.94, add:[{ stat:'agi', rate:0.34 }], proc:90, mp:10, ail:{ key:'bleed', chance:100, stacks:2 }, desc:'相手の出血を+2' },
  { name:'影討ち', cls:'暗殺者', kind:P, mult:1.25, add:[{ stat:'agi', rate:0.35 }], proc:85, mp:14, firstTurn:{ mult:1.5, crit:20 }, desc:'戦闘1ターン目なら威力+50%・クリティカル率+20%' },
  { name:'首狩り', cls:'暗殺者', kind:P, mult:1.2, add:[{ stat:'agi', rate:0.34 }], proc:85, mp:16, foeLowHp:{ at:50, mult:1.4 }, desc:'相手のHPが50%以下なら威力+40%' },
  { name:'死の刻印', cls:'暗殺者', kind:B, proc:100, mp:12, ailUp:{ key:'bleed', pct:25, turns:3 }, priority:1, desc:'3ターンの間、出血を付ける確率+25%' },
  { name:'急所突き', cls:'暗殺者', kind:P, mult:0.97, add:[{ stat:'agi', rate:0.33 }], proc:80, mp:20, burstAil:{ key:'bleed', perStack:0.25 }, desc:'相手の出血をすべて消費し、1つにつき威力+25%' },
  { name:'絶命', cls:'暗殺者', kind:P, mult:0.98, add:[{ stat:'agi', rate:0.27 }], proc:75, mp:28, foeLowHp:{ at:20, mult:3 }, desc:'相手のHPが20%以下なら威力3倍。出血は使わない（急所突きと違い、出血を残したまま撃てる）' },
  // 忍者【分身】：分身は最大3体。攻撃を受けたとき30%で身代わりになって1体消える。分身がいる間は攻撃のたびに追撃する
  { name:'影の連携', cls:'忍者', kind:'passive', mp:0, passive:{ cloneFollow:0.1, noCloneAgi:10, cloneGuard:10 }, desc:'自分が攻撃するたび、分身1体につき物理 ×0.1で追撃。分身がいない間はAGI+10%。分身は攻撃を受けたとき10%で身代わりになって消える' },
  { name:'手裏剣', cls:'忍者', kind:P, mult:0.3, add:[{ stat:'agi', rate:0.19 }], hits:3, noCrit:true, proc:95, mp:6, sureHit:true, desc:'3連撃。必ず当たる・クリティカルなし' },
  { name:'分身の術', cls:'忍者', kind:B, proc:100, mp:12, gain:{ key:'clone', n:1, max:3 }, priority:1, desc:'分身を1体出す（最大3体）。分身は攻撃を受けたとき15%で身代わりになって消える' },
  { name:'雷遁', cls:'忍者', kind:P, mult:0.93, add:[{ stat:'dex', rate:0.41 }], proc:85, mp:12, ail:{ key:'paralyze', chance:20 }, perStack:{ key:'clone', pct:10 }, desc:'20%で麻痺。分身1体につき威力+10%' },
  { name:'火遁', cls:'忍者', kind:P, mult:1.04, add:[{ stat:'dex', rate:0.47 }], proc:85, mp:12, ail:{ key:'burn', chance:50 }, perStack:{ key:'clone', pct:10 }, desc:'50%で火傷。分身1体につき威力+10%' },
  { name:'影斬り', cls:'忍者', kind:P, mult:1.35, proc:88, mp:12, gainOnHit:{ key:'clone', n:1, max:3 }, desc:'当てると分身+1' },
  { name:'毒霧の術', cls:'忍者', kind:P, mult:1.39, proc:88, mp:10, ails:[{ key:'poison', chance:40 }, { key:'blind', chance:20 }], desc:'40%で毒・20%で暗闇' },
  { name:'変わり身', cls:'忍者', kind:B, proc:100, mp:14, gain:{ key:'clone', n:2, max:3 }, buff:{ self:{ agi:30 } }, priority:1, desc:'分身を2体出す（最大3体）・自分のAGI+30%' },
  { name:'水遁・渦潮の術', cls:'忍者', kind:P, mult:1.06, add:[{ stat:'dex', rate:0.45 }], proc:85, mp:14, ail:{ key:'slow', chance:50 }, perStack:{ key:'clone', pct:10 }, desc:'50%で鈍足。分身1体につき威力+10%' },
  { name:'千本手裏剣', cls:'忍者', kind:P, mult:0.16, add:[{ stat:'agi', rate:0.09 }], hits:6, noCrit:true, proc:80, mp:20, sureHit:true, hitsPerStack:{ key:'clone', n:1 }, desc:'6連撃。必ず当たる。分身1体につき+1連撃・クリティカルなし' },
  { name:'微塵隠れの術', cls:'忍者', kind:P, mult:1.14, proc:75, mp:28, sureHit:true, useAll:{ key:'clone', addMult:0.46 }, desc:'必ず当たる。分身をすべて爆発させ、1体につきSTR×0.46の追加ダメージ（分身がいなければ追加は無し）' },

  // ===== 弓使い系 =====
  // 狩人【罠】：罠は2つまで。相手が攻撃してきたときに発動し、ダメージと状態異常を与えて消える。状態異常の数だけ与ダメージが伸びる
  { name:'獲物の弱り目', cls:'狩人', kind:'passive', mp:0, passive:{ perFoeAil:{ pct:8, max:32 } }, desc:'相手の状態異常1つにつき与ダメージ+8%（最大+32%）' },
  { name:'毒矢', cls:'狩人', kind:P, mult:1.27, proc:95, mp:7, ail:{ key:'poison', chance:50 }, desc:'50%で毒' },
  { name:'くくり罠', cls:'狩人', kind:B, proc:90, mp:10, trap:{ mult:1.54, ail:{ key:'slow', chance:70 } }, desc:'罠を置く（2つまで。3つ目を置くと古い罠から消える）。相手が攻撃してきたとき発動し、物理 ×1.54（必ず当たる）・70%で鈍足' },
  { name:'ハンターズマーク', cls:'狩人', kind:B, proc:100, mp:8, buff:{ enemy:{ vit:-15, agi:-15 } }, priority:1, desc:'相手のVIT-15%・AGI-15%' },
  { name:'裂き矢', cls:'狩人', kind:P, mult:1.68, proc:88, mp:10, ail:{ key:'bleed', chance:50 }, desc:'50%で出血' },
  { name:'目くらまし', cls:'狩人', kind:P, mult:1.64, proc:88, mp:10, ail:{ key:'blind', chance:50 }, desc:'50%で暗闇' },
  { name:'三連射', cls:'狩人', kind:P, mult:0.67, hits:3, noCrit:true, proc:85, mp:14, desc:'3連撃。クリティカルなし' },
  { name:'狩猟の構え', cls:'狩人', kind:B, proc:100, mp:10, buff:{ self:{ str:20, dex:20 } }, priority:1, desc:'自分のSTR+20%・DEX+20%' },
  { name:'トラバサミ', cls:'狩人', kind:B, proc:90, mp:10, trap:{ mult:1.49, ail:{ key:'bleed', chance:60 }, debuff:{ agi:-15 } }, priority:1, desc:'罠を置く（2つまで）。相手が攻撃してきたとき発動し、物理 ×1.49（必ず当たる）・60%で出血・相手のAGI−15%' },
  { name:'仕留めの一矢', cls:'狩人', kind:P, mult:1.92, proc:80, mp:20, vsAil:{ per:10, max:100 }, desc:'相手の状態異常1つにつき威力+10%' },
  { name:'ワイルドハント', cls:'狩人', kind:P, mult:0.63, hits:3, noCrit:true, proc:75, mp:28, hitsByAil:[{ at:2, n:1 }, { at:4, n:2 }], desc:'3連射。相手の状態異常が2つ以上なら+1連射、4つ以上なら+2連射。クリティカルなし' },
  // アークアーチャー【クリティカル】：照準1つにつきクリティカル率+5%（最大3つ・射撃しても減らない）。クリティカルのたびに追撃する
  { name:'狙撃手の勘', cls:'アークアーチャー', kind:'passive', mp:0, passive:{ critFollow:0.5 }, desc:'クリティカル時に物理 ×0.5で追撃' },
  { name:'急所射ち', cls:'アークアーチャー', kind:P, mult:0.8, add:[{ stat:'dex', rate:0.68 }], proc:95, mp:7, sureHit:true, desc:'必ず当たる' },
  { name:'照準', cls:'アークアーチャー', kind:B, proc:100, mp:8, gain:{ key:'aim', n:1, max:3 }, aimCrit:5, priority:1, desc:'照準+1（最大3、射撃しても減らない）。照準1つにつきクリティカル率+5%' },
  { name:'ラピッドショット', cls:'アークアーチャー', kind:P, mult:0.51, add:[{ stat:'dex', rate:0.4 }], hits:2, noCrit:true, proc:90, mp:10, desc:'2連撃。クリティカルなし' },
  { name:'貫き矢', cls:'アークアーチャー', kind:P, mult:1.81, proc:85, mp:12, defPen:0.35, desc:'相手の防御を35%無視' },
  { name:'息を止める', cls:'アークアーチャー', kind:B, proc:100, mp:10, buff:{ self:{ dex:30 } }, critUp:15, priority:1, desc:'自分のDEX+30%・クリティカル率+15%' },
  { name:'強弓', cls:'アークアーチャー', kind:P, mult:2.15, proc:80, mp:16, desc:'強く引き絞って射る' },
  { name:'弱点看破', cls:'アークアーチャー', kind:P, mult:1.8, proc:85, mp:12, buff:{ enemy:{ vit:-20 } }, critBonus:20, desc:'相手のVIT-20%・クリティカル率+20%' },
  { name:'ロックオン', cls:'アークアーチャー', kind:B, proc:100, mp:12, lockOn:{ turns:3, critDmg:15 }, priority:1, desc:'3ターンの間、射撃が必中・クリティカルのダメージ+15%' },
  { name:'絶影狙撃', cls:'アークアーチャー', kind:P, mult:1.9, proc:75, mp:22, sureHit:true, critMult:1.3, desc:'必ず当たる・クリティカル時はダメージ×1.3' },
  { name:'天穿の矢', cls:'アークアーチャー', kind:P, mult:0.8, add:[{ stat:'dex', rate:0.1 }], proc:75, mp:28, sureCrit:true, desc:'必ずクリティカル（倍率が低いのはクリティカルの上乗せが大きいため）' },

  // ===== 銃士系 =====
  // 魔銃士【MPを弾にこめる】：攻撃の技は使ったMP1につき威力+1%（最大+20%）。MPが多く残っているほど強い技もあり、魔力装填でMPを戻す。
  //   物理（STR・VITで受ける）と魔法（INT・INTで受ける）の両方で殴る（STR×a ＋ INT×a）
  { name:'魔弾', cls:'魔銃士', kind:'passive', mp:0, passive:{ mpPower:{ per:1, max:20 } }, desc:'攻撃の技は、使ったMP1につき威力+1%（最大+20%）' },
  { name:'マナショット', cls:'魔銃士', kind:P, hybrid:{ phys:1.02, mag:1.02 }, proc:95, mp:6, desc:'魔力を込めた弾を撃つ' },
  { name:'焼夷弾', cls:'魔銃士', kind:P, hybrid:{ phys:1.08, mag:1.08 }, proc:88, mp:11, ail:{ key:'burn', chance:50 }, desc:'50%で火傷' },
  { name:'雷撃弾', cls:'魔銃士', kind:P, hybrid:{ phys:0.98, mag:0.98 }, proc:88, mp:11, ail:{ key:'paralyze', chance:20 }, desc:'20%で麻痺' },
  { name:'氷結弾', cls:'魔銃士', kind:P, hybrid:{ phys:1.08, mag:1.08 }, proc:88, mp:11, ail:{ key:'slow', chance:50 }, desc:'50%で鈍足' },
  { name:'ブレイクショット', cls:'魔銃士', kind:P, hybrid:{ phys:1.17, mag:1.17 }, proc:85, mp:13, defPen:0.3, desc:'相手の防御を30%無視' },
  { name:'魔力装填', cls:'魔銃士', kind:B, proc:100, mp:12, buff:{ self:{ str:20, int_stat:20 } }, mpGainPct:20, priority:1, desc:'MPを最大MPの20%回復・自分のSTR+20%・INT+20%' },
  { name:'連装魔撃', cls:'魔銃士', kind:P, hybrid:{ phys:0.31, mag:0.31 }, hits:4, proc:85, mp:16, noCrit:true, desc:'4連撃。クリティカルなし' },
  { name:'エーテルバレット', cls:'魔銃士', kind:P, hybrid:{ phys:1.1, mag:1.1 }, proc:85, mp:14, mpRatioPower:{ max:30 }, desc:'今のMPの割合が高いほど威力が上がる（満タンで+30%）' },
  { name:'アルカナバレット', cls:'魔銃士', kind:P, hybrid:{ phys:1.25, mag:1.25 }, proc:80, mp:22, mpAbove:{ at:70, mult:1.2 }, desc:'MPが70%以上残っていれば威力+20%' },
  { name:'オーバーロードショット', cls:'魔銃士', kind:P, hybrid:{ phys:1.06, mag:1.06 }, proc:75, mp:0, mpPct:0.3, mpUsedPower:{ perMp:10, per:3, max:30 }, desc:'今のMPの30%を使う。使ったMP10につき威力+3%（最大+30%）' },
  // デストロイヤー【装填と砲撃】：装填を溜め（最大3）、砲撃の技でまとめて使う。装填がある間は受けるダメージ−15%
  { name:'砲台の構え', cls:'デストロイヤー', kind:'passive', mp:0, passive:{ whileStackGuard:{ key:'load', cut:15 } }, desc:'装填が1以上ある間、受けるダメージ-15%' },
  { name:'散弾', cls:'デストロイヤー', kind:P, mult:0.3, add:[{ stat:'dex', rate:0.25 }], hits:3, proc:95, mp:6, noCrit:true, desc:'3連撃。クリティカルなし' },
  { name:'装填', cls:'デストロイヤー', kind:B, proc:100, mp:6, gain:{ key:'load', n:1, max:5 }, priority:1, desc:'装填+1（最大5）' },
  { name:'キャノン', cls:'デストロイヤー', kind:P, mult:0.75, add:[{ stat:'dex', rate:0.75 }], proc:85, mp:14, useAll:{ key:'load', per:0.25 }, desc:'装填をすべて消費し、1つにつき威力+25%' },
  { name:'スモークシェル', cls:'デストロイヤー', kind:P, mult:0.91, add:[{ stat:'dex', rate:0.68 }], proc:88, mp:10, ail:{ key:'blind', chance:60 }, desc:'60%で暗闇' },
  { name:'速射', cls:'デストロイヤー', kind:P, mult:0.93, add:[{ stat:'dex', rate:0.74 }], proc:90, mp:10, gain:{ key:'load', n:1, max:5 }, desc:'装填+1' },
  { name:'グレネード', cls:'デストロイヤー', kind:P, mult:0.92, add:[{ stat:'dex', rate:0.76 }], proc:88, mp:12, ail:{ key:'burn', chance:50 }, desc:'50%で火傷' },
  { name:'弾薬補給', cls:'デストロイヤー', kind:B, proc:100, mp:10, buff:{ self:{ str:20, dex:20 } }, gain:{ key:'load', n:1, max:5 }, priority:1, desc:'自分のSTR+20%・DEX+20%・装填+1' },
  { name:'弾帯換装', cls:'デストロイヤー', kind:B, proc:100, mp:12, gain:{ key:'load', n:2, max:5 }, priority:1, desc:'装填+2（上限の5を超えた分は増えない）' },
  { name:'フルバースト', cls:'デストロイヤー', kind:P, mult:1.32, add:[{ stat:'dex', rate:1.32 }], proc:75, mp:24, useAll:{ key:'load', per:0.18 }, selfStun:1, desc:'装填をすべて消費し、1つにつき威力+18%。使用後1ターン行動不可' },
  { name:'カーペットボム', cls:'デストロイヤー', kind:P, mult:0.28, add:[{ stat:'dex', rate:0.23 }], hits:3, noCrit:true, proc:75, mp:28, hitsPerStackUse:{ key:'load', n:1, max:5, use:1 }, desc:'3連撃。装填を1つ使い、使う前の装填1つにつき+1連撃（最大+5）。クリティカルなし' },

  // ===== 魔法使い系 =====
  // 元素使い【属性の連鎖】：直前と違う属性の魔法を撃つたび共鳴+1（最大4）。同じ属性を続けると0。属性のない技は共鳴を変えない
  { name:'元素共鳴', cls:'元素使い', kind:'passive', mp:0, passive:{ reso:{ max:4, pct:5 } }, desc:'直前と違う属性の魔法を撃つたび共鳴+1（最大4）、共鳴1につき与ダメージ+5%。同じ属性を続けると0に戻る。属性のない技は共鳴を変えない' },
  { name:'ファイアボール', cls:'元素使い', kind:M, mult:1.81, proc:95, mp:7, elem:'fire', ail:{ key:'burn', chance:20 }, desc:'火の魔法。20%で火傷' },
  { name:'詠唱', cls:'元素使い', kind:B, proc:100, mp:6, resoGain:1, mpGain:5, priority:1, desc:'共鳴+1（属性を1つ切り替えた扱い）・MPを5回復' },
  { name:'フロストノヴァ', cls:'元素使い', kind:M, mult:2.05, proc:88, mp:13, elem:'ice', ail:{ key:'slow', chance:40 }, desc:'氷の魔法。40%で鈍足' },
  { name:'ウィンドカッター', cls:'元素使い', kind:M, mult:0.74, hits:3, noCrit:true, proc:88, mp:13, elem:'wind', desc:'風の魔法。3連撃。クリティカルなし' },
  { name:'ライトニングボルト', cls:'元素使い', kind:M, mult:1.71, proc:88, mp:13, elem:'thunder', ail:{ key:'paralyze', chance:25 }, hitBonus:EASY_HIT, desc:'雷の魔法。命中しやすい。25%で麻痺' },
  { name:'魔力集中', cls:'元素使い', kind:B, proc:100, mp:10, buff:{ self:{ int_stat:30 } }, priority:1, desc:'自分のINT+30%' },
  { name:'メテオストライク', cls:'元素使い', kind:M, mult:0.6, hits:4, hitsRange:[3, 5], noCrit:true, proc:75, mp:22, elem:'fire', ail:{ key:'burn', chance:10 }, ailPerHit:true, desc:'3〜5連撃（毎回ランダム）。1ヒットごとに10%で火傷' },
  { name:'アースクエイク', cls:'元素使い', kind:M, mult:2.25, proc:85, mp:14, elem:'earth', buff:{ enemy:{ vit:-15 } }, desc:'土の魔法（5つ目の属性）。相手のVIT−15%' },
  { name:'カタストロフ', cls:'元素使い', kind:M, mult:2.58, proc:70, mp:28, desc:'属性なし' },
  { name:'プリズムバースト', cls:'元素使い', kind:M, mult:1.97, proc:75, mp:30, useReso:{ per:10, max:40, fullAils:{ at:4, keys:['burn', 'slow', 'paralyze'], chance:25 } }, desc:'属性なし。共鳴をすべて使い、1つにつき威力+10%（最大+40%）。共鳴4なら火傷・鈍足・麻痺を25%ずつ' },
  // クロノマンサー【追加行動】：AGIが相手より高いと20%で追加行動。この戦闘で追加で動いた回数を決め技の威力にする
  { name:'刻の加護', cls:'クロノマンサー', kind:'passive', mp:0, passive:{ extraIfFaster:35 }, desc:'自分のAGIが相手より高いとき、35%で追加行動' },
  { name:'クロノバレット', cls:'クロノマンサー', kind:M, mult:1.83, proc:95, mp:6, buff:{ enemy:{ agi:-10 } }, desc:'相手のAGI-10%' },
  { name:'アクセル', cls:'クロノマンサー', kind:B, proc:100, mp:10, buff:{ self:{ agi:30 } }, priority:1, desc:'自分のAGI+30%' },
  { name:'スロウ', cls:'クロノマンサー', kind:M, mult:1.84, proc:90, mp:10, ail:{ key:'slow', chance:60 }, desc:'60%で鈍足' },
  { name:'ディレイ', cls:'クロノマンサー', kind:M, mult:2.09, proc:88, mp:12, buff:{ enemy:{ agi:-20 } }, desc:'相手のAGI-20%' },
  { name:'ストップ', cls:'クロノマンサー', kind:B, proc:80, mp:16, buff:{ enemy:{ agi:-20 } }, ail:{ key:'paralyze', chance:30 }, desc:'30%で麻痺・相手のAGI-20%' },
  { name:'クイック', cls:'クロノマンサー', kind:B, proc:100, mp:14, extraTurn:{ max:2 }, desc:'このターン、もう一度行動する（戦闘中2回まで）' },
  { name:'リワインド', cls:'クロノマンサー', kind:H, proc:100, mp:14, rewind:{ turns:2, pct:50 }, desc:'直前2ターンで受けたダメージの50%を回復' },
  { name:'リピート', cls:'クロノマンサー', kind:B, proc:90, mp:14, repeatLast:{ mpMult:0.5 }, desc:'直前に撃った技をもう一度撃つ（その技のMPは半分）。並べ順で、繰り返したい技のすぐ後ろに置く。直前がクロノブレイク・パラドックス・クイック・リピートのときは繰り返さず、通常攻撃になる' },
  { name:'クロノブレイク', cls:'クロノマンサー', kind:M, mult:2.16, proc:75, mp:24, agiDiff:{ per:1, max:60 }, noRepeatTarget:true, desc:'自分と相手のAGIの差1%につき威力+1%（最大+60%）' },
  { name:'パラドックス', cls:'クロノマンサー', kind:M, mult:2.24, proc:75, mp:28, extraCountPower:{ per:6, max:60 }, noRepeatTarget:true, desc:'この戦闘で追加行動した回数1回につき威力+6%（最大+60%）' },

  // ===== 呪術師系 =====
  // 死霊使い【死霊の数】：死霊は毎ターン攻撃し、数が多いほど受けるダメージも減る（式神使いの「場」に対して「数」で戦う）
  { name:'死者の盾', cls:'死霊使い', kind:'passive', mp:0, passive:{ guardPerStack:{ key:'undead', cut:2 } }, desc:'死霊1体につき受けるダメージ-2%' },
  { name:'骸骨召喚', cls:'死霊使い', kind:B, proc:95, mp:10, summon:{ key:'undead', n:1, max:3, mult:0.3 }, priority:1, desc:'死霊を1体召喚（最大3体）。死霊は毎ターン魔法 ×0.3で攻撃' },
  { name:'ソウルドレイン', cls:'死霊使い', kind:M, mult:2.01, proc:88, mp:10, drain:0.15, drainPerStack:{ key:'undead', pct:0.05 }, desc:'与えたダメージの15%をHP回復（死霊1体につき+5%）' },
  { name:'ボーンスピア', cls:'死霊使い', kind:M, mult:1.84, proc:88, mp:11, perStack:{ key:'undead', pct:10 }, desc:'死霊1体につき威力+10%' },
  { name:'恐怖の囁き', cls:'死霊使い', kind:M, mult:1.88, proc:90, mp:10, ail:{ key:'fear', chance:50 }, desc:'50%で恐怖' },
  { name:'腐敗霧', cls:'死霊使い', kind:B, proc:88, mp:14, buff:{ enemy:{ vit:-15, int_stat:-15 } }, ail:{ key:'poison', chance:50 }, desc:'相手のVIT-15%・INT-15%・50%で毒' },
  { name:'死の行軍', cls:'死霊使い', kind:B, proc:100, mp:12, summonBoost:{ key:'undead', pct:50, turns:4 }, priority:1, desc:'4ターンの間、死霊の攻撃力+50%' },
  { name:'魂喰らい', cls:'死霊使い', kind:H, proc:100, mp:12, needStack:{ key:'undead', n:1 }, healMax:15, mpGain:10, desc:'死霊を1体消費し、最大HPの15%を回復・MPを10回復' },
  { name:'レイズデッド', cls:'死霊使い', kind:B, proc:100, mp:16, summon:{ key:'undead', n:2, max:4, mult:0.3, setMax:4 }, priority:1, desc:'死霊を2体召喚。この戦闘の間、死霊の最大が4体になる' },
  { name:'幽世ノ門', cls:'死霊使い', kind:M, mult:1.61, proc:75, mp:24, useAll:{ key:'undead', per:0.25 }, ail:{ key:'fear', chance:40 }, desc:'死霊をすべて消費し、1体につき威力+25%・40%で恐怖' },
  { name:'ソウルハーヴェスト', cls:'死霊使い', kind:M, mult:1.72, proc:75, mp:28, perStackAdd:{ key:'undead', addMult:0.2 }, drain:0.1, desc:'死霊1体につき魔法 ×0.2ぶん威力が上がる（死霊は消えない）。与えたダメージの10%をHP回復' },
  // 式神使い【結界】：結界は3ターン続き、張れるのは1つ（張り直すと上書き）。式神か結界がある間は与ダメージ+15%
  { name:'陰陽の理', cls:'式神使い', kind:'passive', mp:0, passive:{ whileSummonOrGuard:10 }, desc:'式神か結界がある間、与ダメージ+10%' },
  { name:'式打ち', cls:'式神使い', kind:M, mult:0.94, hits:2, noCrit:true, proc:95, mp:6, desc:'2連撃。クリティカルなし' },
  { name:'式神召喚', cls:'式神使い', kind:B, proc:100, mp:14, summon:{ key:'shiki', n:1, max:1, mult:0.766 }, priority:1, desc:'式神を召喚（1体まで）。式神は毎ターン魔法 ×0.766で攻撃' },
  { name:'封の符', cls:'式神使い', kind:M, mult:1.94, proc:85, mp:12, ail:{ key:'seal', chance:40 }, desc:'40%で封印' },
  { name:'火炎符', cls:'式神使い', kind:M, mult:2.01, proc:88, mp:12, ail:{ key:'burn', chance:50 }, desc:'50%で火傷' },
  { name:'陰陽結界', cls:'式神使い', kind:B, proc:100, mp:12, guard:{ cut:20, turns:3, healPct:50 }, barrier:true, priority:1, desc:'結界を張る。3ターンの間、受けるダメージ-20%・軽減した分の50%を回復' },
  { name:'魂削りの符', cls:'式神使い', kind:M, mult:2.09, proc:88, mp:12, buff:{ enemy:{ int_stat:-20 } }, desc:'相手のINT-20%' },
  { name:'鬼神降ろし', cls:'式神使い', kind:B, proc:100, mp:14, summonHits:{ key:'shiki', hits:2, turns:4 }, priority:1, desc:'4ターンの間、式神の攻撃が2連撃になる' },
  { name:'封縛結界', cls:'式神使い', kind:B, proc:100, mp:14, bind:{ turns:3, foeAgi:-20, ailExtend:1 }, barrier:true, priority:1, desc:'結界を張る。3ターンの間、相手のAGI−20%・相手にかかった状態異常が1ターン長く続く' },
  { name:'禁術・神降ろし', cls:'式神使い', kind:M, mult:2.71, proc:75, mp:24, noRepeat:true, desc:'連続では使えない' },
  { name:'急急如律令', cls:'式神使い', kind:M, mult:1.79, proc:75, mp:28, summonStrike:{ key:'shiki' }, whileBarrier:{ mult:1.2 }, desc:'式神がいれば式神も1回攻撃。結界があれば威力+20%' },

  // ===== 僧侶系 =====
  // 聖職者【バリア】：HPが満タンからあふれた回復分は「バリア」になる（上限は最大HPの25%）。バリアはHPより先に削れる
  { name:'神聖加護', cls:'聖職者', kind:'passive', mp:0, passive:{ overShield:{ cap:25 } }, desc:'HPが満タンからあふれた回復分はバリアになる（上限は最大HPの25%）。バリアは攻撃のダメージをHPより先に受ける' },
  { name:'聖光', cls:'聖職者', kind:M, mult:1.89, proc:95, mp:7, hitBonus:EASY_HIT, desc:'光の魔法。命中しやすい' },
  { name:'ハイヒール', cls:'聖職者', kind:H, proc:90, mp:12, heal:{ rate:1.3 }, desc:'HP回復（回復量の倍率1.3）' },
  { name:'ブレス', cls:'聖職者', kind:B, proc:100, mp:10, buff:{ self:{ int_stat:20, vit:20 } }, priority:1, desc:'自分のINT+20%・VIT+20%' },
  { name:'奇跡', cls:'聖職者', kind:H, proc:85, mp:16, regenMax:{ pct:6, turns:4 }, desc:'4ターンの間、毎ターン最大HPの6%を回復' },
  { name:'祈りの結界', cls:'聖職者', kind:B, proc:100, mp:12, guard:{ cut:20, turns:3 }, priority:1, desc:'3ターンの間、受けるダメージ-20%' },
  { name:'癒しの光撃', cls:'聖職者', kind:M, mult:2.1, proc:85, mp:14, drain:0.3, desc:'与えたダメージの30%をHP回復' },
  { name:'リザレクション', cls:'聖職者', kind:B, proc:100, mp:20, revive:{ pct:35 }, priority:1, desc:'戦闘中1回だけ、HPが0になった時にHP35%で復活' },
  { name:'光の帳', cls:'聖職者', kind:B, proc:100, mp:14, shieldGain:{ pct:12, stat:{ int_stat:15 } }, priority:1, desc:'最大HPの12%のバリアを張る（上限まで）。バリアがある間INT+15%' },
  { name:'セイクリッドノヴァ', cls:'聖職者', kind:M, mult:2.15, proc:80, mp:24, healDmg:{ pct:10, capMult:1 }, desc:'この戦闘で回復したHP（バリアになった分も含む）の10%を追加ダメージ（上限は魔法 ×1.0分）' },
  { name:'ゴスペル', cls:'聖職者', kind:B, proc:100, mp:24, gospel:{ turns:4, healMult:1.5, shieldCap:35 }, usesMax:1, priority:1, desc:'4ターンの間、回復量1.5倍・状態異常にかからない・バリアの上限が最大HPの35%になる（編成に置けるのは1回まで）' },
  // 異端審問官【罪】：相手が強化か回復を使うたび、または相手に封印をかけるたびに罪+1（最大5）。罪1につき与ダメージ+4%。断罪で使い切る
  { name:'退魔の心得', cls:'異端審問官', kind:'passive', mp:0, passive:{ vsRace:{ races:['undead', 'demon'], pct:20 }, sin:{ max:5, pct:4 } }, desc:'アンデッドと悪魔への与ダメージ+20%。相手が強化か回復を使うたび、または相手に封印をかけるたびに罪+1（最大5）。罪1につき与ダメージ+4%' },
  { name:'破魔の光', cls:'異端審問官', kind:M, mult:1.75, proc:95, mp:7, vsRace:{ races:['undead', 'demon'], mult:1.3 }, desc:'アンデッドと悪魔には1.3倍' },
  { name:'封魔の印', cls:'異端審問官', kind:M, mult:1.84, proc:85, mp:12, ail:{ key:'seal', chance:50 }, desc:'50%で封印' },
  { name:'ホーリーチェイン', cls:'異端審問官', kind:M, mult:1.85, proc:88, mp:12, ail:{ key:'seal', chance:30 }, buff:{ enemy:{ agi:-10 } }, hitBonus:EASY_HIT, desc:'命中しやすい。30%で封印・相手のAGI-10%' },
  { name:'聖水', cls:'異端審問官', kind:M, mult:1.68, proc:90, mp:10, dispel:{ chance:100 }, desc:'相手の強化を1つ解除' },
  { name:'狂信', cls:'異端審問官', kind:B, proc:100, mp:12, debuffImmune:{ turns:4 }, priority:1, desc:'4ターンの間、自分の能力低下を無効' },
  { name:'浄化の炎', cls:'異端審問官', kind:M, mult:2.14, proc:85, mp:14, ail:{ key:'burn', chance:50 }, desc:'50%で火傷' },
  { name:'聖なる裁き', cls:'異端審問官', kind:M, mult:2.09, proc:85, mp:16, vsAilMult:{ key:'seal', mult:1.3 }, desc:'相手が封印中なら×1.3' },
  { name:'異端の烙印', cls:'異端審問官', kind:M, mult:1.84, proc:85, mp:14, sinGain:2, dispel:{ chance:100 }, desc:'罪+2。相手の強化を1つ消す' },
  { name:'断罪', cls:'異端審問官', kind:M, mult:2.11, proc:75, mp:24, useSin:{ per:6 }, vsRace:{ races:['undead', 'demon'], mult:1.3 }, desc:'罪をすべて使い、1つにつき威力+6%。アンデッドと悪魔には1.3倍' },
  { name:'火刑', cls:'異端審問官', kind:M, mult:2.18, proc:75, mp:28, ail:{ key:'burn', chance:100 }, desc:'必ず火傷（罪は使わない）' },

  // ===== 薬師系 =====
  // アルケミスト【化学反応】：相手が毒と火傷の両方にかかると反応が起き、与ダメージ+20%。状態異常の「組み合わせ」で強くなる
  { name:'化学反応', cls:'アルケミスト', kind:'passive', mp:0, passive:{ bothAil:{ keys:['poison', 'burn'], pct:20 }, vsDebuff:{ stats:['vit', 'int_stat'], pct:10 } }, desc:'相手が毒と火傷の両方にかかっていると与ダメージ+20%。相手のVITかINTが下がっている間は+10%' },
  { name:'火炎瓶', cls:'アルケミスト', kind:M, mult:1.73, proc:95, mp:7, ail:{ key:'burn', chance:40 }, desc:'40%で火傷' },
  { name:'劇毒瓶', cls:'アルケミスト', kind:M, mult:1.86, proc:88, mp:10, ail:{ key:'poison', chance:70 }, desc:'70%で毒' },
  { name:'スパークボトル', cls:'アルケミスト', kind:M, mult:1.81, proc:88, mp:10, ail:{ key:'paralyze', chance:20 }, desc:'20%で麻痺' },
  { name:'腐食液', cls:'アルケミスト', kind:M, mult:2, proc:88, mp:12, buff:{ enemy:{ vit:-20, int_stat:-15 } }, desc:'相手のVIT-20%・INT-15%' },
  { name:'閃光弾', cls:'アルケミスト', kind:M, mult:1.96, proc:88, mp:10, ail:{ key:'blind', chance:50 }, desc:'50%で暗闇' },
  { name:'触媒', cls:'アルケミスト', kind:B, proc:100, mp:10, buff:{ self:{ int_stat:30 } }, priority:1, desc:'自分のINT+30%' },
  { name:'溶解液', cls:'アルケミスト', kind:M, mult:2.16, proc:85, mp:14, defPen:0.3, desc:'相手の防御を30%無視' },
  { name:'爆炎毒', cls:'アルケミスト', kind:M, mult:1.94, proc:85, mp:14, ails:[{ key:'poison', chance:45 }, { key:'burn', chance:45 }], preAil:true, desc:'45%で毒・45%で火傷（撃つ前に付く＝両方付けばこの一撃から化学反応）' },
  { name:'メガボム', cls:'アルケミスト', kind:M, mult:1.91, proc:75, mp:24, consumeAllAil:{ per:25, max:90 }, desc:'相手の状態異常をすべて解除し、1つにつき威力+25%（最大+90%）' },
  { name:'賢者の石', cls:'アルケミスト', kind:B, proc:100, mp:22, philo:{ turns:4, ailUp:20, react:10 }, priority:1, desc:'4ターンの間、状態異常を付ける確率+20%・化学反応の上乗せが+20%→+30%' },
  // 霊薬師【薬効】：強化の薬で薬効が溜まり（最大20・2026-10-18 ユーザー選択で5→20）、薬効1つにつき与ダメージ+5%。薬効解放でまとめて使うか、溜めたまま戦う
  { name:'調合の極意', cls:'霊薬師', kind:'passive', mp:0, passive:{ perStackDmg:{ key:'potion', pct:5, max:25 } }, desc:'薬効1つにつき与ダメージ+5%（最大+25%）' },
  { name:'霊薬瓶', cls:'霊薬師', kind:M, mult:1.88, proc:95, mp:7, desc:'霊薬の瓶を投げつける' },
  { name:'剛力薬', cls:'霊薬師', kind:B, proc:100, mp:9, buff:{ self:{ str:30 } }, gain:{ key:'potion', n:1, max:20 }, priority:1, desc:'自分のSTR+30%・薬効+1' },
  { name:'叡智の薬', cls:'霊薬師', kind:B, proc:100, mp:9, buff:{ self:{ int_stat:30 } }, gain:{ key:'potion', n:1, max:20 }, priority:1, desc:'自分のINT+30%・薬効+1' },
  { name:'鉄身薬', cls:'霊薬師', kind:B, proc:100, mp:9, buff:{ self:{ vit:30 } }, gain:{ key:'potion', n:1, max:20 }, priority:1, desc:'自分のVIT+30%・薬効+1' },
  { name:'再生薬', cls:'霊薬師', kind:H, proc:90, mp:14, regenMax:{ pct:5, turns:4 }, desc:'4ターンの間、毎ターン最大HPの5%を回復' },
  { name:'霊薬', cls:'霊薬師', kind:H, proc:90, mp:14, heal:{ rate:1 }, mpHeal:{ rate:0.3 }, desc:'HP回復（倍率1.0）・MP回復（倍率0.3）' },
  { name:'薬効解放', cls:'霊薬師', kind:M, mult:1.1, proc:85, mp:16, perStack:{ key:'potion', pct:5, max:100 }, desc:'薬効1つにつき与ダメージ+5%（最大200%）。薬効は減らない' },
  { name:'浸透薬', cls:'霊薬師', kind:M, mult:2.27, proc:85, mp:14, defPenPerStack:{ key:'potion', per:0.03, max:0.6 }, desc:'薬効1つにつき相手の防御を3%無視（最大60%）' },
  { name:'仙丹', cls:'霊薬師', kind:B, proc:100, mp:22, buff:{ self:{ str:5, dex:5, agi:5, int_stat:5, vit:5, luk:5 } }, gain:{ key:'potion', n:2, max:20 }, priority:1, desc:'自分の全能力+5%・薬効+2' },
  { name:'エリクサー', cls:'霊薬師', kind:H, proc:100, mp:26, healMax:100, cure:99, gain:{ key:'potion', n:3, max:20 }, usesMax:1, desc:'最大HPの100%を回復・状態異常をすべて治す・薬効+3（編成に置けるのは1回まで）' },
]

// ===== 2026-10-15 測って合わせたもの（チャットの設計の値から）=====
// ユーザーの決まり（2026-10-15）：技の倍率は極端に上げ下げしない（能力が強力で大きく動かすなら理由を書く）・
//   ボス戦±5%・対人30〜70%（きつく合わせない。対人が苦手でボス戦が得意な職業があってもよい）
// 測り方：LV55・80、エピック+6／+10、上位 CLASS LV50。ボス戦＝前後3エリアの③のボスで勝率5割になるボスの倍率
//   （組み方の例2つの強い方・組み方を自動で探した組も）。対人＝22職の総当たり（HP×5.17／×6）
// ① 職業ごとの攻撃の技の倍率（ICHIJI_TUNE）は**やめた**（2026-10-16 ユーザー「倍率かけないで×1で作って」→能力表で決めた17職の案を入れた）。
//   攻撃の技の威力は設計の値（×1）に戻し、強さの差は能力（HP・守り・仕組み）で付けた（下の④）。
//   前にかけていた倍率（記録）：元素使い・異端審問官・ストームランサー1.2・魔法剣士1.18・アルケミスト・クロノマンサー1.15・竜騎士1.11・
//   アークアーチャー1.06・サイキッカー1.05・デストロイヤー1.04・霊薬師0.95・聖職者0.93・暗殺者0.85
export const ICHIJI_TUNE = {}
// ② 仕組みの数字を直したもの（強さの元を先に直した）
//   狂戦士 … HPを払う技と狂撃の「+15%」をやめた（×1/1.15：マッドラッシュ1.87→1.63・ブラッドスプラッシュ1.97→1.71・
//            ブラッドサクリファイス2.02→1.76・フルブレイカー2.0→1.74・狂撃2.32→2.02）。バーサク +15/+30%→+10/+20%
//            ★狂鬼化（倒れるダメージを1度HP1で耐える）がボス戦の強さの元（外すと約−10）。設計の要なので変えずにユーザーと相談
//   暗殺者 … 隠形 AGI+30%→+10%（かわせる確率が上がりすぎた）
//            ★2026-10-17 補助技の上げ幅を全職業でそろえた（skills.js の BUFF_RULE）＝隠形はまた+30%・明鏡止水 STR+20%・DEX+20% など
//   忍者   … 影斬り 1.74→1.35（当てるたびに分身が増えるぶん）・影の連携 追撃×0.15→×0.1・身代わり30%→15%→10%
//            毒霧の術 毒60%→40%・暗闇40%→20%（2026-10-15 回避をゆるめても、組み方を探すとLV80で118・LV55で113だった。
//            元は回避ではなく「暗闇・毒・分身」の重なり。暗闇は4ターン命中−25%で、3〜6ターンで終わるボス戦では1回でほぼ最後まで効く）
//   死霊使い … 骸骨召喚・レイズデッド 魔法×0.472→×0.35→×0.3・ソウルハーヴェスト 死霊1体につき×0.31→×0.2・死者の盾 5%→4%（対人で強すぎた。
//            ×0.3 は 2026-10-15 の「クラス間の格差」で、対人73〜74%・ボス戦105〜108だった＝死霊は毎ターン攻撃するので対人の長い戦いで積み上がる）
//   ストームランサー … 槍の型 コンボ1つにつき与ダメージ+1%→+2%（2026-10-15 対人27〜32%・ボス戦93〜97。コンボが溜まる前に戦いが終わる）
//   霊薬師 … 仙丹 全能力+15%→+10%
//   聖職者 … リザレクション HP50%→35%
//   竜騎士 … 跳躍中の回避 30%→40%（対人で跳んでいる間に殴られ続けた）
//            ★2026-10-17 40%→15%（ユーザー「回避力が直接上がるやつ、最高でも15％にして」・combat.js の CAP_EVA_BONUS_MAX）
//   侍     … 秘剣・叢雲 納刀中1.8倍→1.7倍（対人で強かった）・明鏡止水 STR+30%・DEX+20%→STR+20%・DEX+15%
//            （2026-10-15 対人75%。1回使うと戦いの最後まで残るので、対人の長い戦いほど効く。ボス戦はほぼ変わらない）
// ③ 2026-10-15 ユーザー決定：AGIを上げる強化（影走り・駆け足・変わり身）を重ねた組み方が強かった（回避は AGIの比の5乗で伸びる）
//   → 回避の決まりを緩めた（combat.js の CAP_EVA＝ステから出した回避が20%を超えたぶんは半分しか伸びない・この版だけ）
//   ＋外しやすい職の技に「命中しやすい」（上の EASY_HIT）。狂戦士の狂鬼化はそのまま（ユーザー決定）
// ④ 2026-10-16 能力表（×1で測った火力・倒れにくさ・ボス戦・対人）で外れた17職を、能力で直した（ユーザー「17の案とりあえず入れてほしい」）。
//   クラスのステの配分（jobs.js）：狂戦士・魔銃士・アークアーチャー・元素使い・ストームランサー・異端審問官・魔法剣士・弓使い・槍使い（HPの多い少ない）
//   技とパッシブ：霊薬師 エリクサー 最大HPの30%→15%・霊薬 回復1.5→1.0／暗殺者 AGIの上乗せ×0.7（倍率0.85の代わり）／
//   式神使い 陰陽の理 与ダメージ+15%→+8%／聖職者 神聖加護の回復量+20%をなくす・ハイヒール 回復1.6→1.3／死霊使い 死者の盾 −4%→−2%／
//   竜騎士 跳躍の技の威力×1.15／クロノマンサー 刻の加護 追加行動20%→35%／薬師 傷薬 回復1.2→0.8（skills.js）
//   ボス戦の強さは倒れにくさに強く引っぱられる（倍率ではほとんど動かない）ので、HPや回復で合わせた
// ⑤ 2026-10-21 ユーザー「条件つきの最大（暗殺者の出血5への攻撃）を5とすると、無条件の技は3.5くらい。ほかもそんな感じで」：
//   技の威力（書いてある倍率の合計・連撃は回数ぶん・パッシブ込み）を「条件の無い技は3.5まで・条件を満たしたときの最大は5まで」にそろえた（powerRule.test.js が見張る）。
//   外れていたのは竜騎士の跳躍（パッシブ込みで4.8〜7.4）とフルバースト（装填5つで6.6）だけ：跳躍 4.18／6.44／4.21→3.5／4.3／3.5・フルバースト 1つにつき+30%→+18%。
//   竜騎士は下げるだけだと対人7〜8%まで落ちたので、条件つきの天墜竜閃（直前のターンに着地）を×1.2→×2.5（＝4.58）で埋め合わせた
// ★残っていること：LV80のボスは攻撃が強く、ボスの攻撃3回ほどで決着する（敵の強さはクラスの能力が決まってから詳しく決める＝ユーザー）

// 職ごとの組み方の例（各職2つ）。シミュレーターがこの組み方で戦う。
// 2026-10-15 チャット版の設計に合わせて作り直した（仕組みが回る並び＝1つ目が「仕組みの組み」・2つ目が「別の組み」）
export const ICHIJI_BUILDS = {
  侍:       [['明鏡止水', '秘剣・叢雲', '二の太刀', '月影', '居合斬'], ['納刀', '断空', '抜刀術', '桜花一閃', '二段斬り']],
  魔法剣士: [['魔剣開放', 'フレイムエッジ', '双極斬', 'エレメンタルエッジ', 'マナバースト'], ['ソードオーラ', 'トリニティブレイド', '双極斬', 'エレメンタルエッジ', 'マナエッジ']],
  狂戦士:   [['血の誓い', 'マッドラッシュ', 'ブラッドサクリファイス', 'フルブレイカー', '血風斬'], ['狂乱の咆哮', '狂鬼化', 'ブラッドスプラッシュ', '狂撃', 'フルブレイカー']],
  聖騎士:   [['オースシールド', '大防御', 'ホーリーエッジ', 'ジャッジメントブロウ', 'グランドクロス'], ['不動の誓い', 'ディバインスマイト', 'シールドバッシュ', 'ジャッジメントブロウ', '神聖覚醒']],
  竜騎士:   [['竜翔', 'ジャンプ', '天墜竜閃', 'ハイジャンプ', 'ドラゴンスラスト'], ['竜鱗', '天竜落とし', '天墜竜閃', 'スカイスピア', 'ドラゴンファング']],
  ストームランサー: [['嵐の構え', '流星突き', '疾風連突', '千本突き', 'テンペストランス'], ['連突き', '薙ぎ崩し', '槍崩し', 'スパイラルスラスト', 'テンペストランス']],
  体術師:   [['受け流し', '後の先', '流水の構え', '五連殺', '流転掌'], ['受け流し', '旋風脚', '破衝掌', '飛天三角蹴り', '半月蹴り']],
  サイキッカー: [['精神集中', 'テレキネシス', 'マインドジャック', 'マインドブレイク', 'メンタルクラッシュ'], ['マインドアクセル', 'サイコショット', 'マインドスパイク', 'サイキックチェイン', 'サイコブラスト']],
  暗殺者:   [['死の刻印', '裂傷', '鬼影閃', '刻み斬り', '急所突き'], ['隠形', '影討ち', '首狩り', 'ヴァイパーストライク', '絶命']],
  忍者:     [['分身の術', '変わり身', '雷遁', '火遁', '微塵隠れの術'], ['影斬り', '水遁・渦潮の術', '毒霧の術', '千本手裏剣', '手裏剣']],
  狩人:     [['トラバサミ', 'くくり罠', '毒矢', '裂き矢', 'ワイルドハント'], ['ハンターズマーク', '狩猟の構え', '目くらまし', '三連射', '仕留めの一矢']],
  アークアーチャー: [['照準', 'ロックオン', '天穿の矢', '強弓', '絶影狙撃'], ['息を止める', '照準', '弱点看破', '貫き矢', '急所射ち']],
  魔銃士:   [['魔力装填', 'エーテルバレット', 'アルカナバレット', 'ブレイクショット', 'オーバーロードショット'], ['焼夷弾', '氷結弾', '雷撃弾', '連装魔撃', 'マナショット']],
  デストロイヤー: [['弾帯換装', '装填', 'フルバースト', '速射', 'キャノン'], ['弾薬補給', 'カーペットボム', '速射', 'グレネード', 'スモークシェル']],
  元素使い: [['詠唱', 'ファイアボール', 'フロストノヴァ', 'ライトニングボルト', 'プリズムバースト'], ['魔力集中', 'アースクエイク', 'メテオストライク', 'ウィンドカッター', 'カタストロフ']],
  クロノマンサー: [['アクセル', 'クロノバレット', 'リピート', 'ディレイ', 'パラドックス'], ['アクセル', 'クイック', 'スロウ', 'クロノブレイク', 'リワインド']],
  死霊使い: [['骸骨召喚', 'レイズデッド', '死の行軍', 'ボーンスピア', 'ソウルハーヴェスト'], ['骸骨召喚', 'ソウルドレイン', '恐怖の囁き', '腐敗霧', '幽世ノ門']],
  式神使い: [['式神召喚', '封縛結界', '鬼神降ろし', '火炎符', '急急如律令'], ['式神召喚', '陰陽結界', '魂削りの符', '封の符', '禁術・神降ろし']],
  聖職者:   [['光の帳', 'ハイヒール', '聖光', '癒しの光撃', 'セイクリッドノヴァ'], ['ゴスペル', '祈りの結界', '奇跡', '聖光', 'セイクリッドノヴァ']],
  異端審問官: [['異端の烙印', '封魔の印', '聖なる裁き', '浄化の炎', '断罪'], ['狂信', '破魔の光', 'ホーリーチェイン', '聖水', '火刑']],
  アルケミスト: [['賢者の石', '爆炎毒', '劇毒瓶', '火炎瓶', 'メガボム'], ['触媒', '腐食液', '溶解液', '閃光弾', 'メガボム']],
  霊薬師:   [['剛力薬', '叡智の薬', '鉄身薬', '浸透薬', '薬効解放'], ['仙丹', '霊薬瓶', '浸透薬', '霊薬', 'エリクサー']],
}
