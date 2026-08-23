// ============================================================
// バトルフロンティアⅡ（リメイク版）— スキル
// ------------------------------------------------------------
// ・名前は旧版（無印）から流用。倍率・発動率・消費MPはv2で新規に決めた
// ・参照するステータスはv2の8種（物理=STR / 魔法=INT、副参照でAGI・VIT等）
// ・スキルは毎ターン「発動率」で抽選する（あるけみすと式。強い技ほど出にくい）
// ・倍率はあるけみすとに合わせる。**基準はあるけみすとの物理レンジ STR×2.2〜2.4**
//   （2026-08-18 改定。それまで上位職の切り札を3.0〜4.0まで伸ばしていて、あるけみすとの
//     倍近くになっていた。上位職の伸びしろは倍率ではなく職業補正とパッシブで出す）
//   ★倍率は「主参照＋副参照の合計 ×多段数」＝**実質の合計倍率**で見ること。
//     v2の上位職  ：物理は合計 **2.4** まで ／ 魔法は合計 **2.7** まで
//       通常 物1.7〜1.9・魔1.9〜2.15 ／ 主力 物2.0〜2.2・魔2.25〜2.45 ／ 切り札 物2.4・魔2.7
//     v2の初期職  ：物理は0.8〜1.65倍 ／ 魔法は1.3〜1.85倍 ／ 発動率85〜100%
//   ★魔法の上限が物理の1.13倍なのは、v2の式では**同じ倍率だと魔法のほうが通らない**から
//     （軽減上限50% vs 34%・魔防は INT＋VIT×0.15 で厚い）。1.13倍で同格の期待ダメージが揃う。
//     あるけみすとの魔法レンジ（INT×2.6〜3.55）をそのまま使うと魔法職だけ2割強くなる
// ・発動率はあるけみすとに合わせる（向こうも75〜100%が大半で、60%以下は
//   メテオストライク60%・フルハウス20%くらい。旅人＝初期職も95/85/80%）。
//     初期職 … 85%以上。強さの調整は発動率ではなく倍率で行う
//     上位職 … 通常90%・主力85%・切り札75〜82%。これ以上は下げない
// ・魔法の倍率が物理より高いのは、魔法のほうが軽減上限が高く(50% vs 34%)防御力も厚いから
//   （あるけみすとも魔法はINT×2.6〜3.55と物理STR×2.2〜2.4より高い）
//
// ★いまはこのファイルがスキルの正。戦闘をサーバー権威にするときに
//   v2_classes と同じくDBの表へ移す（それまでは調整の速さを優先してJSに置く）。
// ★状態異常は ail:{ key, chance } で書く（定義は ailments.js・消費は battle.js）。
//   2026-08-18に侍の居合斬・月影で**プレイヤー側スキルにも解禁**した（それまで敵とルーンだけ）。
//   ⚠出血と毒は割合ダメージでVITに無視されるので、**倍率の帯とは別枠の価値**として扱う。
// ============================================================

// kind: phys=STR基準の物理 / mag=INT基準の魔法 / heal=回復 / buff=補助 / passive=パッシブ
// ★passive（常時発動）の決まりごと：
//   ・発動率も使用回数も持たない（枠に入れておくだけで常時効く）
//   ・消費MPも持たない＝想定利用MPに数えない
//   ・発動順のローテーションには入らない（battle.js が枠から分けて常時効果として扱う）
//   ・**複数セットできる**。そのぶん1つ1つの効果は控えめにして、
//     枠を通常スキルに使うメリットが消えないようにする
//   ・単なるステータス+%は「職業補正」（classBonus.js）の担当。パッシブは
//     ステータスでは書けない挙動（命中補正・スタック・条件付き強化など）を担当する
//   ・効果は passive:{...} に書く。対応表は下の PASSIVE_EFFECTS を参照
export const KIND_LABEL = { phys:'物理', mag:'魔法', heal:'回復', buff:'補助', passive:'パッシブ' }
export const KIND_COLOR = { phys:'#ffcc00', mag:'#cc44ff', heal:'#44ff88', buff:'#44aaff', passive:'#88aacc' }
export const isPassive = (s) => s?.kind === 'passive'
// ★2026-08-23：**パッシブは枠を使わない**（ユーザー指定）。
//   その職業なら最初から効いていて、LVアップの抽選にも出ず、他職へ持ち出せない。
//   ＝ skillsOf() は**枠に置ける技だけ**を返し、パッシブは passiveOf() で引く。
export const passiveOf = (cls) => SKILLS.find(s => s.cls === cls && isPassive(s)) || null

// パッシブの効果の書き方（battle.js が解釈する）。すべて任意で、複数書いてもよい。
//   hitBonus    : 最終命中率に足す(ポイント)          … 相手の回避率から引く
//   evaBonus    : 自分の回避率に足す(ポイント)
//   critBonus   : 最終クリティカル率に足す(ポイント)
//   procBonus   : スキルの発動率に足す(ポイント)
//   defPenBonus : 防御貫通に足す(%)                   … 軽減率に掛かる
//   healBonus   : 自分が回復する量に足す(%)
//   misfireAtkMult : 不発した次に出る通常攻撃の威力倍率
//   statPct     : { ステ:% } 常時のステータス補正（職業補正と同じ土俵で加算）
//   convert     : { from, to, pct } from の pct% を to へ移す（元の値は減る）
//   rage        : { stat, per, max } ダメージを与えるたび stat が per% ずつ上がる（max%まで）。
//                 **不発・通常攻撃・自分の攻撃が全部外れたときにリセット**（補助スキルではリセットしない）
//   switchStat  : { stat, pct } 直前に使ったスキルと違うスキルを使うとき、その行動だけ stat +pct%（重複しない）
//   lowHp       : { stat, max, at } HPが減るほど stat が上がる。HP割合が at% まで下がると max% で頭打ち
//   wall        : { pct, every } 戦闘開始時と自分の行動 every 回ごとに「次に受けるダメージを pct% 減らす」を得る。
//                 **重複せず、1回ダメージを受けると消える**（取り直すまで効かない）
//   gamble      : { up, upMult, down, downMult } スキルが当たったとき、up% で upMult 倍・down% で downMult 倍
//   dodgeCut    : { pct, cut } ダメージを受けるとき pct% の確率で cut% カット
//   debuffGuard : 戦闘中この回数だけ、相手から受けるデバフを打ち消す
export const PASSIVE_EFFECT_KEYS = [
  'hitBonus', 'evaBonus', 'critBonus', 'procBonus', 'defPenBonus', 'healBonus',
  'misfireAtkMult', 'statPct', 'convert', 'rage', 'switchStat', 'lowHp',
  'wall', 'gamble', 'dodgeCut', 'debuffGuard',
  // ★2026-08-19 追加（ユーザー指定のパッシブ）
  'hitMult',   // { mult, lowMult, at } 最終命中率に掛ける。相手のHPが at% 以下なら lowMult（鷹ノ目）
  'bleedMax',  // 自分が付ける出血のスタック上限（隠身）
  'critDmg',   // クリティカルのダメージ+%（隠身）
  'mpCut',     // 消費MP-%（天啓）
  'defRed',    // 受けるときの軽減率+%（聖騎士の心得）
  'hitStack',  // { critRate, critDmg, max } 当てるたびに積む（精密照準）
  'hpSteps',   // [{ at, statPct }] HPが at% 以下で効く段（バーサク）。いちばん深い段だけが効く
  'ailResist', // 受ける状態異常の付与率-%（武僧）
  'ritualStart', // 戦闘開始時に持っている呪力（式神使い）
  'formBoost',   // 獣の型のステータス補正+%（ビーストレンジャー）
  'repeat',    // { per, max } 同じスキルを続けて使うほど威力+%（精霊召喚士）
  'perAct',    // { stats, per, max } 自分が行動するたびに積む（第六感）
]

// ★2026-08-19に足したキー（侍）
// stance      : { proc, mult, priority } この技を撃つと「構え」に入る。次に撃つスキルへ乗って消える（納刀）
// whileStance : 構え中だけ効く追加効果 { priority, defPen, ailChance }
// foresight   : { turns, pct, perHit, max } 一定ターン回避率+。受けた技ごとにさらに積む（見切り・技ごとに max% まで）
// reqJobs     : この技を覚えるのに要る転職回数（侍・狂戦士の後半5個＝5回以上）
// ailPerHit   : 多段のとき「1発ごとに」状態異常を試す（マッドラッシュ・狂乱連斬）
// lowHpBonus  : { max, at } 相手のHPが低いほど威力+%。at% 以下で最大（追い討ち）
// highHpBonus : { max, at } **自分の**HPが高いほど威力+%。満タンで最大（聖職者）
// vsBuff      : { per, max } 相手に乗っているバフ1つにつき威力+%（異端審問官）
// dispel      : { chance } 相手のバフを確率で1つ消す（異端審問官）
// repeat      : { per, max } 同じ技を続けて撃つほど威力+%（魔銃士。パッシブ版が精霊召喚士）
// switchKind  : 直前に使った技と種別（物理／魔法）が違えば威力+%（魔法剣士）
// variance    : { lo, hi } 威力が lo%〜hi% のあいだで振れる（ギャンブラー）
// combo       : { after:[名前], mult } 直前に使った技がその中なら威力+%（元素使い）
// airUp       : true その技を使うと空中へ。空中は回避+10%（体術師）
// whileAir    : { mult } 空中のときだけ威力+%。使うと着地する（体術師）
// src         : 'agi' など **威力が乗るステ**を直に指定する。受ける側の防御は kind のまま
//               （既定は phys=STR／mag=INT。職業補正の main と噛み合わないと火力が出ないので、
//                main が STR/INT 以外の職はここで合わせる）
// ritual      : n 呪力を n 積む（式神使い。最大3）
// useRitual   : { per } 呪力を全部使って威力+per%×個数（式神使い）
// chargeUp    : true 竜気を1つ積む。溜めているあいだ硬い（竜騎士。最大3）
// useCharge   : { per } 竜気を全部使って威力+per%×個数（竜騎士）
// form        : 'hawk'|'bear'|'snake' その獣を呼ぶ＝型が変わる。同じ型なら威力+BEAST_BONUS%
// formBuff    : { none, hawk, bear, snake } いま呼んでいる獣で中身が変わるバフ
// ---- 軸に**つながる**ための仕組み（2026-08-23）----
// whileStack  : { key:'ritual'|'charge', mult?, defPen?, ailChance? } 溜めが残っているあいだ効く（消費しない）
// whileForm   : { mult?, ailChance? } 獣を呼んでいるあいだ効く（型は問わない）
// vsAil       : { per, max } 相手にかかっている状態異常1つにつき威力+%（賢者）
// cure        : n 自分にかかっている状態異常を n 個払う（武僧）
// whileGround : { mult } 地上にいるあいだ威力+%（体術師）
// keepAir     : true 空中で撃っても着地しない（体術師）
// rampHit     : n 多段の2発目以降、1発ごとに威力+n%（体術師）
// bigGuard    : { cut } 1ターンのあいだ受けるダメージ-%。そのターンは追加行動が出ない（聖騎士）
// drainIfAil  : { key, pct } **相手がその状態異常のときだけ**吸収する（血啜り）。
//               撃つ前から掛かっている必要がある＝自分で撒いてから吸う流れになる
// hpCostPct   : 現在HPの n% を払って撃つ（すてみ）。払っても死なない
// frenzy      : { turns } 狂乱＝**出る技がランダムな攻撃スキルになる**だけの状態（狂心）
// buffTurns   : そのバフが何ターンで切れるか（既定は切れない）。狂心のSTR+70%＝4ターン
// mult   : 主ステータス（STR/INT）に掛ける倍率
// add    : 副ステータス参照 [{ stat, rate }]
// hits   : 多段の回数（命中・クリは1発ずつ判定する）
// proc   : 発動率(%)。毎ターン抽選する
// mp     : 消費MP（固定）
// mpPct  : 消費MPを「そのときの残りMPの割合」にする（マナボルト＝0.2）。
//          撃つほど1回の消費が減るので撃ち切れない。想定利用MPには数えない
// defPen : 防御無視(0〜1)
// acc    : そのスキルの命中率(%)。**既定100＝いまは全スキル100**（＝命中率を持たない技と同じ挙動）
//          最終命中率 = acc +(100 − acc)× 安定度 − 相手の回避率  ※安定度 = DEX/(DEX+主ステ)
//          足りないぶんをDEXが100%へ向けて埋めるので、**accの低い技ほどDEXが効く**。
//          ⚠発動率(proc)とは別の確率なので掛け算になる（発動75%×命中80%＝実際に当たるのは63.8%）。
//            accを下げるのは当てにくい大技など一部に限る。多段は1発ずつ判定するのでさらに荒れる
// ail    : { key, chance } 当たったときだけ状態異常を試す。keyは ailments.js の AIL_KEYS。
//          ⚠**相手のエンチャント抵抗を引いてから判定する**（敵の技と同じ道＝battle.js の tryInflict）。
//          出血と毒は旧版（無印）と同じ仕様で、**割合ダメージなのでVITで軽減されない**＝硬い相手にも通る。
//          そのぶん倍率の帯には数えていないので、**付けるなら素の倍率を上げない**こと
// sureHit: 必中
// noCrit : クリティカルしないスキル。あるけみすとにも「クリティカルするスキルとしないスキル」があり、
//          ゲーム内には表記されない。クリの固定加算(＋1.5)は元の係数によらないため
//          多段スキルほど恩恵が大きい＝v2では多段を noCrit にして素の倍率で調整する
// sureCrit: 確定クリティカル（あるけみすとの「破魔の一撃」「刺閃」に相当）。初期職では未使用
// priority: 行動順の優先度。数字が大きいほど先に動く（同値ならAGI→ランダム）。
//           ★あくまで順番だけ。行動回数は増えない（増えるのはAGIの追加行動だけ）
//             0 = 攻撃スキルと通常攻撃
//             1 = 補助・回復（既定。攻撃より先に動けるが、2以上には後攻になる）
//             2以上 = さらに先に動く枠。上位職の切り札などに使う（いまは未使用）
// buff   : { self:{ステ:%}, enemy:{ステ:%} }
//          ステータスの増減は**戦闘中ずっと続き、重ねがけで加算される**（あるけみすと準拠。
//          向こうも「重ね掛け可能」「回避成功毎に+3%」と累積前提で、ターン数の記載が無い）
// heal   : { rate }                  …即時HP回復（INT×rate）
// regen  : { rate, turns }           …毎ターンHP回復（INT×rate）
// mpRegen: { rate, turns }           …毎ターンMP回復（INT×rate）
// ※回復は最大HP/MPの％ではなく INT を参照する（あるけみすと準拠。神聖なる手＝INT×1.5）。
//   最大HPを積むほど回復量まで伸びる歪みを作らないため。初期職はあるけみすとより低め
export const SKILLS = [
  // ===== ノーブル（開始時の職業。一段低い） =====
  { name:'はたく',     cls:'ノーブル', kind:'phys', mult:1.06, proc:95, mp:0,  desc:'素手で殴る。消費MPなし' },
  { name:'狙い撃ち',   cls:'ノーブル', kind:'phys', mult:1.04, proc:90, mp:7,  sureHit:true, desc:'必ず当たる一撃' },
  { name:'応急手当',   cls:'ノーブル', kind:'heal', proc:85, mp:8,  heal:{ rate:0.7 }, desc:'INT×1.0を回復' },
  { name:'身構える',   cls:'ノーブル', kind:'buff', proc:100, mp:6, buff:{ self:{ vit:15 } }, priority:1, desc:'VIT+15%（重ねがけ可）' },
  { name:'気合い',     cls:'ノーブル', kind:'buff', proc:90, mp:8,  buff:{ self:{ str:25 } }, priority:1, desc:'STR+25%（重ねがけ可）' },
  { name:'体当たり',       cls:'戦士', kind:'phys', mult:1.25, proc:95, mp:4,  desc:'素直な体当たり' },
  { name:'強撃',           cls:'戦士', kind:'phys', mult:1.55, proc:85, mp:11, desc:'力を込めた一撃' },
  { name:'防御崩し',       cls:'戦士', kind:'phys', mult:1.3, proc:90, mp:8, buff:{ enemy:{ vit:-15 } }, desc:'相手のVIT-15%（重ねがけ可）' },
  { name:'防御態勢',       cls:'戦士', kind:'buff', proc:100, mp:8, buff:{ self:{ vit:25 } }, priority:1, desc:'VIT+25%（重ねがけ可）' },
  { name:'シールドアタック', cls:'戦士', kind:'phys', mult:0.89, add:[{ stat:'vit', rate:0.5 }], proc:90, mp:8, desc:'盾で殴る。VITも威力になる' },
  { name:'狙撃',     cls:'弓使い', kind:'phys', mult:0.65, add:[{ stat:'agi', rate:0.6 }], proc:90, mp:8, sureHit:true, desc:'必中。AGIも威力になる' },
  { name:'剛射',     cls:'弓使い', kind:'phys', mult:1.55, proc:85, mp:11, desc:'強く引き絞って射る' },
  { name:'貫通射撃', cls:'弓使い', kind:'phys', mult:1.37, defPen:0.3, proc:85, mp:11, desc:'相手の防御を30%無視' },
  { name:'疾風矢',   cls:'弓使い', kind:'phys', mult:0.89, add:[{ stat:'agi', rate:0.5 }], proc:90, mp:8, desc:'速射。AGIも威力になる' },
  { name:'駆け足',   cls:'弓使い', kind:'buff', proc:100, mp:6, buff:{ self:{ agi:20 } }, priority:1, desc:'AGI+20%（重ねがけ可）' },
  { name:'マジックアロー', cls:'魔法使い', kind:'mag', mult:1.45, proc:95, mp:5,  desc:'消費が軽い基本の魔法' },
  { name:'ファイア',       cls:'魔法使い', kind:'mag', mult:1.8, proc:85, mp:13, desc:'火の魔法' },
  { name:'サンダー',       cls:'魔法使い', kind:'mag', mult:1.65, defPen:0.25, proc:85, mp:13, desc:'相手の防御を25%無視する雷' },
  { name:'アイスランス',   cls:'魔法使い', kind:'mag', mult:1.68, proc:85, mp:13, buff:{ enemy:{ agi:-20 } }, desc:'相手のAGI-20%（重ねがけ可）' },
  { name:'精神統一',       cls:'魔法使い', kind:'buff', proc:100, mp:8, buff:{ self:{ int_stat:25 } }, priority:1, desc:'INT+25%（重ねがけ可）' },
  { name:'ライト',       cls:'僧侶', kind:'mag', mult:1.45, proc:95, mp:5,  desc:'光の魔法' },
  { name:'ライトニング', cls:'僧侶', kind:'mag', mult:1.7, proc:85, mp:13, ail:{ key:'paralyze', chance:5 }, desc:'聖なる雷。5%で麻痺' },
  { name:'ヒール',       cls:'僧侶', kind:'heal', proc:85, mp:12, heal:{ rate:1.2 }, desc:'INT×1.4を回復' },
  { name:'祈祷',         cls:'僧侶', kind:'heal', proc:85, mp:15, regen:{ rate:0.6, turns:4 }, desc:'4ターン毎ターンINT×0.5を回復' },
  { name:'プロテク',     cls:'僧侶', kind:'buff', proc:100, mp:10, buff:{ self:{ vit:15, int_stat:15 } }, priority:1, desc:'VIT+15%・INT+15%（重ねがけ可）' },
  { name:'打撃',   cls:'格闘家', kind:'phys', mult:1.25, proc:95, mp:4,  desc:'軽い打撃' },
  { name:'鉄拳',   cls:'格闘家', kind:'phys', mult:1.55, proc:85, mp:11, desc:'渾身の一撃' },
  { name:'連打',   cls:'格闘家', kind:'phys', mult:0.51, hits:3, proc:85, mp:11, noCrit:true, desc:'3連撃。1発ずつ命中判定。クリティカルしない' },
  { name:'爆裂拳', cls:'格闘家', kind:'phys', mult:0.38, hits:4, proc:85, mp:11, noCrit:true, desc:'4連撃。出にくいが手数で押す。クリティカルしない' },
  { name:'残心',   cls:'格闘家', kind:'buff', proc:100, mp:8, buff:{ self:{ dex:15, agi:15 } }, priority:1, desc:'DEX+15%・AGI+15%（重ねがけ可）' },
  { name:'オオカミ召喚',   cls:'サモナー', kind:'mag', mult:1.6, proc:90, mp:9,  desc:'狼を呼んで噛みつかせる' },
  { name:'小悪魔召喚',     cls:'サモナー', kind:'mag', mult:1.8, proc:85, mp:13, desc:'小悪魔を呼ぶ' },
  { name:'グリフォン召喚', cls:'サモナー', kind:'mag', mult:1.68, proc:85, mp:13, buff:{ self:{ agi:20 } }, desc:'AGI+20%（重ねがけ可）' },
  { name:'群れの号令',     cls:'サモナー', kind:'mag', mult:0.6, hits:3, proc:85, mp:13, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'魔力供給',       cls:'サモナー', kind:'heal', proc:85, mp:0, mpRegen:{ rate:0.2, turns:4 }, desc:'4ターン毎ターンINT×0.3のMPを回復。消費MPなし' },
  { name:'居合斬',   cls:'侍', kind:'phys', mult:1.46, add:[{ stat:'dex', rate:0.4 }], proc:90, mp:12, ail:{ key:'bleed', chance:20 }, desc:'抜き打ち。DEXも威力になる。20%で出血' },
  { name:'断空',     cls:'侍', kind:'phys', mult:1.9, defPen:0.3, proc:85, mp:16, whileStance:{ defPen:0.2 }, desc:'相手の防御を30%無視。納刀中はさらに20%無視（計50%）' },
  { name:'明鏡止水', cls:'侍', kind:'buff', proc:100, mp:12, buff:{ self:{ str:30, dex:20 } }, priority:1, desc:'STR+30%・DEX+20%（重ねがけ可）' },
  { name:'月影',     cls:'侍', kind:'phys', mult:2.2, proc:78, mp:22, ail:{ key:'bleed', chance:40 }, whileStance:{ ailChance:100 }, desc:'侍の切り札。40%で出血。納刀中は出血が確定' },
  { name:'抜刀術',   cls:'侍', kind:'phys', mult:1.74, add:[{ stat:'dex', rate:0.3 }], proc:88, mp:14, stance:{ proc:20, mult:1.5, priority:true }, desc:'軽く斬りつけてから鞘に納める。斬りながら納刀に入る' },
  { name:'居合の構え', cls:'侍', kind:'passive', mp:0, passive:{ misfireAtkMult:2 }, desc:'スキルが不発したとき、代わりに出る通常攻撃の威力が2倍になる' },
  { name:'納刀',     cls:'侍', kind:'buff', proc:100, mp:6, priority:1, stance:{ proc:20, mult:1.5, priority:1 }, reqJobs:5, desc:'納刀状態になる。次に撃つスキルが発動率+20%・威力1.5倍・先制になる（撃つと消える）' },
  { name:'峰打ち',   cls:'侍', kind:'phys', mult:1.65, add:[{ stat:'dex', rate:0.3 }], proc:88, mp:14, buff:{ enemy:{ str:-15 } }, reqJobs:5, desc:'DEXも威力になる。相手のSTR-15%（重ねがけ可）' },
  { name:'二段斬り', cls:'侍', kind:'phys', mult:0.95, add:[{ stat:'dex', rate:0.15 }], hits:2, proc:85, mp:16, noCrit:true, whileStance:{ defPen:0.35 }, reqJobs:5, desc:'2連撃。DEXも威力になる。クリティカルしない。納刀中は相手の防御を35%無視' },
  { name:'桜花一閃', cls:'侍', kind:'phys', mult:1.97, add:[{ stat:'dex', rate:0.2 }], proc:82, mp:18, ail:{ key:'bleed', chance:30 }, whileStance:{ ailChance:100 }, reqJobs:5, desc:'DEXも威力になる。30%で出血。納刀中は必ず出血' },
  { name:'見切り',   cls:'侍', kind:'buff', proc:100, mp:10, priority:1, foresight:{ turns:5, pct:3, perHit:3, max:20 }, reqJobs:5, desc:'5ターンのあいだ回避率+3%。スキルを受けるたび、その技への回避率がさらに+3%（同じ技につき20%まで）。効果が切れると積み上げも消える' },
  { name:'マッドラッシュ', cls:'狂戦士', kind:'phys', mult:0.7, hits:3, proc:85, mp:16, noCrit:true, ail:{ key:'bleed', chance:10 }, ailPerHit:true, desc:'3連撃。1発ごとに10%で出血。クリティカルしない' },
  { name:'すてみ',       cls:'狂戦士', kind:'phys', mult:2.61, proc:78, mp:22, hpCostPct:10, buff:{ self:{ vit:-10 } }, desc:'大威力。現在HPの10%を払い、自分のVIT-10%（重ねがけ可）' },
  { name:'ブラッティロア', cls:'狂戦士', kind:'buff', proc:100, mp:14, buff:{ self:{ str:40 } }, priority:1, hpCostPct:10, desc:'STR+40%（重ねがけ可）。現在HPの10%を払う' },
  { name:'フルブレイカー', cls:'狂戦士', kind:'phys', mult:2.02, defPen:0.5, proc:85, mp:16, hpCostPct:8, desc:'相手の防御を50%無視。現在HPの8%を払う' },
  { name:'血の渇き', cls:'狂戦士', kind:'phys', mult:1.88, add:[{ stat:'agi', rate:0.3 }], proc:85, mp:16, hpCostPct:10, drainIfAil:{ key:'bleed', pct:35 }, desc:'現在HPの10%を払う。相手が出血していれば与えたダメージの35%を吸収' },
  { name:'バーサク',     cls:'狂戦士', kind:'passive', mp:0, passive:{ statPct:{ vit:5 }, hpSteps:[{ at:90, statPct:{ str:5 } }, { at:50, statPct:{ str:10 } }, { at:30, statPct:{ str:15 } }] }, desc:'VIT+5%。HPが90%以下でSTR+5%、50%以下で+10%、30%以下で+15%' },
  { name:'猛り斬り', cls:'狂戦士', kind:'phys', mult:1.45, add:[{ stat:'agi', rate:0.3 }], proc:90, mp:12, ail:{ key:'bleed', chance:50 }, reqJobs:5, desc:'AGIも威力になる。50%で出血' },
  { name:'狂心',     cls:'狂戦士', kind:'buff', proc:95, mp:16, priority:1, buff:{ self:{ str:50 } }, buffTurns:4, frenzy:{ turns:4 }, reqJobs:5, desc:'4ターンのあいだSTR+50%。そのあいだは狂乱状態になり、出る技がランダムな攻撃スキルになる' },
  { name:'血啜り',   cls:'狂戦士', kind:'phys', mult:1.46, add:[{ stat:'agi', rate:0.3 }], proc:88, mp:14, drainIfAil:{ key:'bleed', pct:60 }, reqJobs:5, desc:'AGIも威力になる。相手が出血していれば、与えたダメージの60%を吸収する（火力は控えめ）' },
  { name:'狂乱連斬', cls:'狂戦士', kind:'phys', mult:0.57, add:[{ stat:'agi', rate:0.15 }], hits:3, proc:80, mp:20, noCrit:true, ail:{ key:'bleed', chance:20 }, ailPerHit:true, reqJobs:5, desc:'3連撃。1発ごとに20%で出血。AGIも威力になる。クリティカルしない' },
  { name:'威嚇咆哮', cls:'狂戦士', kind:'buff', proc:95, mp:12, priority:1, buff:{ enemy:{ str:-30 } }, reqJobs:5, desc:'相手のSTR-30%（重ねがけ可）' },
  { name:'毒矢',     cls:'狩人', kind:'phys', mult:1.27, add:[{ stat:'dex', rate:0.5 }], proc:90, mp:12, ail:{ key:'poison', chance:35 }, desc:'AGIも威力になる。35%で毒' },
  { name:'三連射',   cls:'狩人', kind:'phys', mult:0.63, hits:3, proc:85, mp:16, noCrit:true, lowHpBonus:{ max:25, at:20 }, desc:'3連撃。クリティカルしない。相手のHPが低いほど威力が上がる' },
  { name:'狩猟本能', cls:'狩人', kind:'buff', proc:100, mp:14, buff:{ self:{ dex:25, agi:25 } }, priority:1, desc:'DEX+25%・AGI+25%（重ねがけ可）' },
  { name:'絶影狙撃', cls:'狩人', kind:'phys', mult:1.77, sureHit:true, proc:80, mp:20, lowHpBonus:{ max:40, at:20 }, desc:'必中。相手のHPが低いほど威力が上がる（HP20%以下で最大+40%）' },
  { name:'仕留めの矢', cls:'狩人', kind:'phys', mult:1.41, add:[{ stat:'dex', rate:0.4 }], proc:82, mp:18, lowHpBonus:{ max:45, at:20 }, desc:'とどめの一矢。相手のHPが低いほど威力が上がる（HP20%以下で最大+45%）' },
  { name:'鷹ノ目',   cls:'狩人', kind:'passive', mp:0, passive:{ hitMult:{ mult:1.1, lowMult:1.3, at:30 } }, desc:'命中率が1.1倍。相手のHPが30%以下なら1.3倍' },
  { name:'貫き矢',   cls:'狩人', kind:'phys', mult:1.53, add:[{ stat:'dex', rate:0.3 }], defPen:0.35, proc:88, mp:14, reqJobs:5, desc:'相手の防御を35%無視。AGIも威力になる' },
  { name:'追い討ち', cls:'狩人', kind:'phys', mult:1.27, add:[{ stat:'dex', rate:0.3 }], proc:88, mp:14, lowHpBonus:{ max:50, at:20 }, reqJobs:5, desc:'AGIも威力になる。相手のHPが低いほど威力が上がる（HP20%以下で最大＋50%）' },
  { name:'スモークボム',     cls:'狩人', kind:'phys', mult:1.75, add:[{ stat:'dex', rate:0.3 }], proc:85, mp:16, buff:{ enemy:{ dex:-25 } }, reqJobs:5, desc:'目つぶし。相手のDEX-25%（重ねがけ可）' },
  { name:'鷹爪連射', cls:'狩人', kind:'phys', mult:0.34, add:[{ stat:'dex', rate:0.15 }], hits:4, proc:80, mp:20, noCrit:true, lowHpBonus:{ max:30, at:20 }, reqJobs:5, desc:'4連射。AGIも威力になる。クリティカルしない。相手のHPが低いほど威力が上がる' },
  { name:'トラップセット',   cls:'狩人', kind:'buff', proc:95, mp:13, buff:{ enemy:{ agi:-35 } }, priority:1, reqJobs:5, desc:'相手のAGI-25%（重ねがけ可）' },
  { name:'瞬歩瞬殺', cls:'暗殺者', kind:'phys', mult:1.35, add:[{ stat:'agi', rate:0.4 }], proc:90, mp:12, ail:{ key:'bleed', chance:50 }, desc:'DEXも威力になる。50%で出血' },
  { name:'鬼影閃',   cls:'暗殺者', kind:'phys', mult:0.69, hits:3, proc:85, mp:16, noCrit:true, ail:{ key:'bleed', chance:30 }, desc:'3連撃。30%で出血。クリティカルしない' },
  { name:'影歩き',   cls:'暗殺者', kind:'buff', proc:100, mp:12, buff:{ self:{ agi:30, dex:15 } }, priority:1, desc:'AGI+30%・DEX+15%（重ねがけ可）' },
  { name:'急所突き', cls:'暗殺者', kind:'phys', mult:1.56, proc:80, mp:20, consumeAil:{ key:'bleed', perStack:0.2 }, desc:'相手の出血を全部消費し、消費したスタック1つにつき威力+20%（最大5スタックで2倍）' },
  { name:'影裂き',   cls:'暗殺者', kind:'phys', mult:0.46, add:[{ stat:'agi', rate:0.2 }], hits:3, proc:85, mp:16, noCrit:true, ail:{ key:'bleed', chance:25 }, ailPerHit:true, desc:'3連撃。クリティカルしない。1発ごとに25%で出血' },
  { name:'隠身',     cls:'暗殺者', kind:'passive', mp:0, passive:{ bleedMax:10, critDmg:10 }, desc:'自分が付ける出血が10スタックまで貯まる。クリティカルダメージ+10%' },
  { name:'背後刺し', cls:'暗殺者', kind:'phys', mult:1.16, add:[{ stat:'agi', rate:0.35 }], hitBonus:10, proc:88, mp:14, consumeAil:{ key:'bleed', perStack:0.12 }, reqJobs:5, desc:'死角から刺す。命中+10%。DEXも威力になる。相手の出血を全部消費して威力が上がる' },
  { name:'毒刃',     cls:'暗殺者', kind:'phys', mult:1.54, add:[{ stat:'agi', rate:0.3 }], proc:88, mp:14, ail:{ key:'poison', chance:40 }, reqJobs:5, desc:'DEXも威力になる。40%で毒' },
  { name:'足首断ち', cls:'暗殺者', kind:'phys', mult:1.77, add:[{ stat:'agi', rate:0.4 }], proc:82, mp:18, ail:{ key:'slow', chance:30 }, reqJobs:5, desc:'DEXも威力になる。30%で鈍足' },
  { name:'千刃乱舞', cls:'暗殺者', kind:'phys', mult:0.4, add:[{ stat:'agi', rate:0.15 }], hits:4, proc:80, mp:20, noCrit:true, ail:{ key:'bleed', chance:30 }, reqJobs:5, desc:'4連撃。30%で出血。DEXも威力になる。クリティカルしない' },
  { name:'影分身',   cls:'暗殺者', kind:'buff', proc:100, mp:13, buff:{ self:{ agi:30, luk:20 } }, priority:1, reqJobs:5, desc:'AGI+30%・LUK+20%（重ねがけ可）' },
  { name:'アクアショット',   cls:'元素使い', kind:'mag', mult:2.08, proc:90, mp:13, buff:{ enemy:{ agi:-20 } }, desc:'相手のAGI-20%（重ねがけ可）' },
  { name:'アースクエイク',   cls:'元素使い', kind:'mag', mult:2.33, proc:85, mp:17, buff:{ enemy:{ vit:-20 } }, desc:'相手のVIT-20%（重ねがけ可）' },
  { name:'ライトニングボルト', cls:'元素使い', kind:'mag', mult:1.94, proc:85, mp:17, ail:{ key:'paralyze', chance:8 }, combo:{ after:['アクアショット', 'アイスプリズン'], mult:35 }, desc:'雷の魔法。8%で麻痺。直前が水・氷なら威力+35%（濡れた相手に走る）' },
  { name:'フレイムバースト', cls:'元素使い', kind:'mag', mult:2.27, proc:80, mp:21, combo:{ after:['スパークショット', 'ライトニングボルト'], mult:30 }, desc:'元素使いの切り札。直前が雷なら威力+30%（火花から一気に燃え上がる）' },
  { name:'元素連鎖', cls:'元素使い', kind:'mag', mult:1.78, add:[{ stat:'dex', rate:0.3 }], proc:85, mp:17, combo:{ after:['アクアショット', 'アースクエイク', 'スパークショット', 'アイスプリズン'], mult:35 }, desc:'前の元素を引き継いで撃つ。直前が水・地・雷・氷なら威力+35%' },
  { name:'元素共鳴',         cls:'元素使い', kind:'passive', mp:0, passive:{ switchStat:{ stat:'int_stat', pct:10 } }, desc:'直前と異なるスキルを使うとき、その行動だけINT+10%（重複しない）' },
  { name:'スパークショット',   cls:'元素使い', kind:'mag', mult:1.9, add:[{ stat:'dex', rate:0.3 }], proc:90, mp:13, reqJobs:5, desc:'弾ける雷。DEXも威力になる' },
  { name:'アイスプリズン',     cls:'元素使い', kind:'mag', mult:1.73, add:[{ stat:'dex', rate:0.3 }], proc:85, mp:17, ail:{ key:'slow', chance:40 }, combo:{ after:['アクアショット'], mult:25 }, reqJobs:5, desc:'DEXも威力になる。40%で鈍足。直前がアクアショットなら威力+25%' },
  { name:'マグマフィスト',     cls:'元素使い', kind:'mag', mult:1.78, add:[{ stat:'dex', rate:0.35 }], proc:85, mp:17, combo:{ after:['アースクエイク'], mult:30 }, reqJobs:5, desc:'溶岩の拳。DEXも威力になる。直前がアースクエイクなら威力+30%（割れた地面から噴き出す）' },
  { name:'エレメンタルレイン', cls:'元素使い', kind:'mag', mult:0.45, add:[{ stat:'dex', rate:0.15 }], hits:4, proc:78, mp:23, noCrit:true, combo:{ after:['ライトニングボルト', 'スパークショット'], mult:25 }, reqJobs:5, desc:'4連撃。DEXも威力になる。クリティカルしない。直前が雷なら威力+25%' },
  { name:'エレメントチャージ',           cls:'元素使い', kind:'buff', proc:100, mp:14, buff:{ self:{ int_stat:55 } }, priority:1, reqJobs:5, desc:'INT+55%（重ねがけ可）' },
  { name:'骸骨召喚',   cls:'死霊使い', kind:'mag', mult:2.2, proc:90, mp:13, desc:'骸骨を呼ぶ' },
  { name:'ソウルドレイン', cls:'死霊使い', kind:'mag', mult:2.25, drain:0.25, proc:85, mp:17, desc:'与えたダメージの25%を吸収' },
  { name:'腐敗霧',     cls:'死霊使い', kind:'mag', mult:1.97, proc:85, mp:17, buff:{ enemy:{ vit:-25, int_stat:-25 } }, ail:{ key:'poison', chance:35 }, desc:'相手のVIT・INT-25%（重ねがけ可）。35%で毒' },
  { name:'幽世ノ門',   cls:'死霊使い', kind:'mag', mult:1.86, add:[{ stat:'int_stat', rate:0.4 }], proc:80, mp:21, buff:{ enemy:{ vit:-20, agi:-20 } }, drain:0.15, desc:'冥府へ引きずり込む。相手のVIT・AGI-20%（重ねがけ可）。与えたダメージの15%を吸収' },
  { name:'疫病の手', cls:'死霊使い', kind:'mag', mult:1.83, add:[{ stat:'vit', rate:0.3 }], proc:85, mp:17, ail:{ key:'poison', chance:45 }, buff:{ enemy:{ vit:-15 } }, desc:'45%で毒。相手のVIT-15%（重ねがけ可）' },
  { name:'骸の壁',     cls:'死霊使い', kind:'passive', mp:0, passive:{ wall:{ pct:10, every:5 } }, desc:'戦闘開始時と自分の行動5回ごとに「次に受けるダメージ10%減」を得る（重複しない・1回受けると消える）' },
  { name:'カースハンド',   cls:'死霊使い', kind:'mag', mult:1.78, add:[{ stat:'int_stat', rate:0.3 }], proc:90, mp:13, ail:{ key:'healCut', chance:40, pct:30 }, reqJobs:5, desc:'亡者の手が伸びる。40%で回復阻害（回復量-30%）' },
  { name:'コープスポイズン',       cls:'死霊使い', kind:'mag', mult:1.9, add:[{ stat:'int_stat', rate:0.3 }], proc:85, mp:17, ail:{ key:'poison', chance:50 }, reqJobs:5, desc:'INTも威力になる。50%で毒' },
  { name:'デスウェイル', cls:'死霊使い', kind:'mag', mult:1.8, add:[{ stat:'int_stat', rate:0.3 }], proc:85, mp:17, buff:{ enemy:{ str:-20, agi:-20 } }, ail:{ key:'healCut', chance:35 }, reqJobs:5, desc:'怯ませる。相手のSTR・AGI-20%（重ねがけ可）。35%で回復阻害' },
  { name:'ヘルチェイン',   cls:'死霊使い', kind:'mag', mult:2.06, add:[{ stat:'int_stat', rate:0.4 }], proc:80, mp:21, ail:{ key:'slow', chance:40 }, reqJobs:5, desc:'鎖で縛りつける。40%で鈍足' },
  { name:'ライフコンバート',   cls:'死霊使い', kind:'heal', proc:85, mp:16, heal:{ rate:1.35 }, reqJobs:5, desc:'INT×1.3を回復' },
  { name:'ホーリーライト', cls:'聖職者', kind:'mag', mult:2.2, proc:90, mp:13, desc:'聖なる光' },
  { name:'奇跡',           cls:'聖職者', kind:'heal', proc:85, mp:18, regen:{ rate:0.9, turns:4 }, desc:'4ターン毎ターンINT×1.0を回復' },
  { name:'祈りの結界',     cls:'聖職者', kind:'buff', proc:100, mp:14, buff:{ self:{ vit:25, int_stat:25 } }, priority:1, desc:'VIT+25%・INT+25%（重ねがけ可）' },
  { name:'神罰執行',       cls:'聖職者', kind:'mag', mult:2.22, proc:80, mp:21, highHpBonus:{ max:35, at:50 }, desc:'聖職者の切り札。自分のHPが高いほど威力が上がる' },
  { name:'ライトブレス', cls:'聖職者', kind:'mag', mult:1.7, add:[{ stat:'vit', rate:0.3 }], proc:88, mp:15, highHpBonus:{ max:30, at:50 }, desc:'自分のHPが高いほど威力が上がる（満タンで最大+30%）' },
  { name:'神聖加護',       cls:'聖職者', kind:'passive', mp:0, passive:{ healBonus:20 }, desc:'自分が回復する量+20%' },
  { name:'セイントレイ', cls:'聖職者', kind:'mag', mult:1.65, add:[{ stat:'vit', rate:0.3 }], proc:90, mp:13, highHpBonus:{ max:25, at:50 }, reqJobs:5, desc:'聖なる一条。VITも威力になる。自分のHPが高いほど威力が上がる' },
  { name:'ピュリファイ',         cls:'聖職者', kind:'mag', mult:2.03, add:[{ stat:'vit', rate:0.3 }], proc:85, mp:17, buff:{ enemy:{ int_stat:-20 } }, reqJobs:5, desc:'VITも威力になる。相手のINT-20%（重ねがけ可）' },
  { name:'ジャッジライト',     cls:'聖職者', kind:'mag', mult:1.64, add:[{ stat:'vit', rate:0.4 }], proc:85, mp:17, highHpBonus:{ max:40, at:50 }, reqJobs:5, desc:'裁きの一撃。自分のHPが高いほど威力が上がる（満タンで最大+40%）' },
  { name:'メガヒール',       cls:'聖職者', kind:'heal', proc:82, mp:20, heal:{ rate:1.5 }, reqJobs:5, desc:'INT×1.5を回復' },
  { name:'グレイスウィンド',     cls:'聖職者', kind:'heal', proc:85, mp:12, mpRegen:{ rate:0.4, turns:4 }, reqJobs:5, desc:'4ターン毎ターンINT×0.5のMPを回復' },
  { name:'粛清',       cls:'異端審問官', kind:'mag', mult:1.41, add:[{ stat:'vit', rate:0.5 }], proc:90, mp:13, vsBuff:{ per:10, max:3 }, desc:'VITも威力になる。相手のバフ1つにつき威力+10%' },
  { name:'狂信',       cls:'異端審問官', kind:'buff', proc:100, mp:12, buff:{ self:{ int_stat:45 } }, priority:1, desc:'INT+45%（重ねがけ可）' },
  { name:'聖なる裁き', cls:'異端審問官', kind:'mag', mult:2.45, proc:85, mp:17, desc:'裁きの光' },
  { name:'断罪',       cls:'異端審問官', kind:'mag', mult:2.11, proc:80, mp:21, buff:{ enemy:{ int_stat:-20 } }, vsBuff:{ per:12, max:3 }, desc:'相手のINT-20%（重ねがけ可）。相手のバフ1つにつき威力+12%' },
  { name:'異端審問', cls:'異端審問官', kind:'mag', mult:1.97, proc:85, mp:17, vsBuff:{ per:14, max:3 }, dispel:{ chance:15 }, desc:'相手のバフ1つにつき威力+14%（3つまで）。15%でバフを1つ消す' },
  { name:'執行本能',   cls:'異端審問官', kind:'passive', mp:0, passive:{ rage:{ stat:'int_stat', per:3, max:15 } }, desc:'ダメージを与えるたびINT+3%（最大15%）。不発・通常攻撃・攻撃が外れたときにリセット' },
  { name:'インクイジション',     cls:'異端審問官', kind:'mag', mult:1.78, add:[{ stat:'vit', rate:0.3 }], proc:90, mp:13, buff:{ enemy:{ str:-20 } }, reqJobs:5, desc:'痛めつけて力を奪う。相手のSTR-20%（重ねがけ可）' },
  { name:'アイアンメイデン',   cls:'異端審問官', kind:'mag', mult:2.01, add:[{ stat:'vit', rate:0.3 }], proc:85, mp:17, ail:{ key:'bleed', chance:35 }, reqJobs:5, desc:'VITも威力になる。35%で出血' },
  { name:'ヘレティックハント', cls:'異端審問官', kind:'mag', mult:1.85, add:[{ stat:'vit', rate:0.15 }], proc:85, mp:17, vsBuff:{ per:15, max:3 }, reqJobs:5, desc:'VITも威力になる。相手に乗っているバフ1つにつき威力+15%（3つまで）' },
  { name:'サイレンスチェイン', cls:'異端審問官', kind:'mag', mult:1.9, proc:88, mp:15, buff:{ enemy:{ int_stat:-25 } }, ail:{ key:'silence', chance:30 }, dispel:{ chance:30 }, reqJobs:5, desc:'相手のINT-25%（重ねがけ可）。30%でサイレンス（発動率-20%）。30%で相手のバフを1つ消す' },
  { name:'火刑',     cls:'異端審問官', kind:'mag', mult:2.14, add:[{ stat:'vit', rate:0.4 }], proc:80, mp:21, dispel:{ chance:20 }, reqJobs:5, desc:'業火で焼く。VITも威力になる。20%で相手のバフを1つ消す' },
  { name:'サンダーストライク', cls:'賢者', kind:'mag', mult:2.05, defPen:0.25, proc:90, mp:13, desc:'雷撃。相手の防御を25%無視' },
  { name:'マナボルト',       cls:'賢者', kind:'mag', mult:2.5, proc:78, mp:0, mpPct:0.2, desc:'そのときの残りMPの20%を消費する大魔法' },
  { name:'氷の障壁',         cls:'賢者', kind:'buff', proc:100, mp:15, buff:{ self:{ vit:35, int_stat:20 } }, priority:1, desc:'VIT+35%・INT+20%（重ねがけ可）' },
  { name:'メテオストライク', cls:'賢者', kind:'mag', mult:0.67, hits:4, proc:78, mp:23, noCrit:true, desc:'4連撃。クリティカルしない' },
  { name:'万象の理', cls:'賢者', kind:'mag', mult:1.97, proc:85, mp:17, vsAil:{ per:20, max:3 }, desc:'相手にかかっている状態異常1つにつき威力+20%（3つまで）' },
  { name:'天啓',             cls:'賢者', kind:'passive', mp:0, passive:{ procBonus:5, mpCut:10 }, desc:'スキルの発動率+5%・消費MP-10%' },
  { name:'アルカナボルト',     cls:'賢者', kind:'mag', mult:1.9, add:[{ stat:'dex', rate:0.3 }], proc:90, mp:13, reqJobs:5, desc:'魔力の弾。DEXも威力になる' },
  { name:'ディスペルウェーブ', cls:'賢者', kind:'mag', mult:1.81, add:[{ stat:'dex', rate:0.3 }], proc:85, mp:17, buff:{ enemy:{ str:-20, int_stat:-20 } }, dispel:{ chance:25 }, reqJobs:5, desc:'DEXも威力になる。相手のSTR-20%・INT-20%（重ねがけ可）。25%で相手のバフを1つ消す' },
  { name:'インフェルノ',       cls:'賢者', kind:'mag', mult:1.72, add:[{ stat:'dex', rate:0.35 }], proc:85, mp:17, vsAil:{ per:15, max:3 }, reqJobs:5, desc:'業火の渦。DEXも威力になる。相手の状態異常1つにつき威力+15%' },
  { name:'アストラルレイ',     cls:'賢者', kind:'mag', mult:1.82, add:[{ stat:'dex', rate:0.4 }], proc:78, mp:23, vsAil:{ per:18, max:3 }, reqJobs:5, desc:'星の光を撃ち出す。DEXも威力になる。相手の状態異常1つにつき威力+18%' },
  { name:'マナリカバリ',       cls:'賢者', kind:'heal', proc:85, mp:14, mpRegen:{ rate:0.45, turns:4 }, reqJobs:5, desc:'4ターン毎ターンINT×0.6のMPを回復' },
  { name:'ホーリーエッジ',     cls:'聖騎士', kind:'phys', mult:1.36, add:[{ stat:'str', rate:0.5 }], proc:90, mp:12, buff:{ self:{ vit:15 } }, desc:'STRも威力になる。自分のVIT+15%（重ねがけ可）' },
  { name:'ディバインスマイト', cls:'聖騎士', kind:'phys', mult:2.08, proc:85, mp:16, buff:{ enemy:{ str:-20 } }, desc:'相手のSTR-20%（重ねがけ可）' },
  { name:'聖域展開',           cls:'聖騎士', kind:'heal', proc:85, mp:18, regen:{ rate:0.9, turns:4 }, desc:'4ターン毎ターンINT×0.7を回復' },
  { name:'神聖覚醒',           cls:'聖騎士', kind:'phys', mult:1.75, add:[{ stat:'str', rate:0.6 }], proc:80, mp:20, desc:'VITも大きく威力になる' },
  { name:'大防御',   cls:'聖騎士', kind:'buff', proc:100, mp:14, bigGuard:{ cut:60 }, priority:1, desc:'盾を構えて耐える。1ターンのあいだ受けるダメージ-60%。そのターンは追加行動が出ない' },
  { name:'聖騎士の心得',       cls:'聖騎士', kind:'passive', mp:0, passive:{ statPct:{ vit:5 }, defRed:10 }, desc:'VIT+5%・受けるときの軽減率+10%' },
  { name:'シールドバッシュ',     cls:'聖騎士', kind:'phys', mult:1.39, add:[{ stat:'str', rate:0.4 }], proc:90, mp:12, ail:{ key:'paralyze', chance:8 }, reqJobs:5, desc:'STRも威力になる。8%で麻痺' },
  { name:'ジャッジメントブロウ', cls:'聖騎士', kind:'phys', mult:1.6, add:[{ stat:'str', rate:0.6 }], proc:85, mp:16, reqJobs:5, desc:'裁きの一撃。STRが大きく威力になる' },
  { name:'ラストガード',         cls:'聖騎士', kind:'phys', mult:1.67, add:[{ stat:'str', rate:0.5 }], proc:82, mp:18, buff:{ self:{ vit:20 } }, reqJobs:5, desc:'守りを固めながら殴る。STRも威力になる・自分のVIT+20%（重ねがけ可）' },
  { name:'オースシールド',             cls:'聖騎士', kind:'buff', proc:100, mp:13, buff:{ self:{ vit:50 } }, priority:1, reqJobs:5, desc:'VIT+50%（重ねがけ可）' },
  { name:'ホーリーケア',           cls:'聖騎士', kind:'heal', proc:85, mp:16, heal:{ rate:1.35 }, reqJobs:5, desc:'INT×1.2を回復' },
  { name:'雷光斬',           cls:'魔法剣士', kind:'phys', mult:1.23, add:[{ stat:'int_stat', rate:0.6 }], proc:90, mp:12, ail:{ key:'paralyze', chance:6 }, desc:'INTも威力になる。6%で麻痺' },
  { name:'閃光',             cls:'魔法剣士', kind:'phys', mult:1.83, proc:90, mp:12, buff:{ enemy:{ dex:-20 } }, desc:'目つぶしの一閃。相手のDEX-20%（重ねがけ可）' },
  { name:'魔剣開放',         cls:'魔法剣士', kind:'buff', proc:100, mp:18, buff:{ self:{ str:30, int_stat:30 } }, priority:1, desc:'STR+30%・INT+30%（重ねがけ可）' },
  { name:'エレメンタルエッジ', cls:'魔法剣士', kind:'phys', mult:1.14, add:[{ stat:'int_stat', rate:0.9 }], proc:80, mp:20, switchKind:25, desc:'両刀の切り札。直前に魔法を使っていれば威力+25%' },
  { name:'双極斬',   cls:'魔法剣士', kind:'phys', mult:1.31, add:[{ stat:'int_stat', rate:0.5 }], proc:85, mp:16, switchKind:35, desc:'INTも威力になる。直前に魔法を使っていれば威力+35%' },
  { name:'魔導剣術',         cls:'魔法剣士', kind:'passive', mp:0, passive:{ convert:{ from:'int_stat', to:'str', pct:30 } }, desc:'INTの30%をSTRへ変換する（そのぶんINTは下がる）' },
  { name:'マナエッジ',       cls:'魔法剣士', kind:'phys', mult:1.54, add:[{ stat:'int_stat', rate:0.4 }], proc:90, mp:12, reqJobs:5, desc:'魔力をまとわせて斬る。INTも威力になる' },
  { name:'フロストエッジ',       cls:'魔法剣士', kind:'phys', mult:1.3, add:[{ stat:'int_stat', rate:0.4 }], proc:88, mp:14, ail:{ key:'slow', chance:35 }, switchKind:20, reqJobs:5, desc:'INTも威力になる。35%で鈍足。直前に魔法を使っていれば威力+20%' },
  { name:'マナバースト', cls:'魔法剣士', kind:'mag', mult:1.67, add:[{ stat:'int_stat', rate:0.4 }], proc:85, mp:17, switchKind:30, reqJobs:5, desc:'STRも威力になる。直前に物理を使っていれば威力+30%' },
  { name:'天魔閃',       cls:'魔法剣士', kind:'phys', mult:1.19, add:[{ stat:'int_stat', rate:0.8 }], proc:80, mp:20, switchKind:30, reqJobs:5, desc:'INTも大きく威力になる。直前に魔法を使っていれば威力+30%' },
  { name:'ソードオーラ',     cls:'魔法剣士', kind:'buff', proc:100, mp:15, buff:{ self:{ agi:30, str:30 } }, priority:1, reqJobs:5, desc:'AGI+30%・STR+30%（重ねがけ可）' },
  { name:'魔弾',                   cls:'魔銃士', kind:'phys', mult:1.41, add:[{ stat:'dex', rate:0.6 }], proc:85, mp:16, repeat:{ per:6, max:3 }, desc:'INTも威力になる。同じ技を続けて撃つほど威力+6%（3回まで）' },
  { name:'連装銃撃',               cls:'魔銃士', kind:'phys', mult:0.65, hits:3, proc:85, mp:16, noCrit:true, repeat:{ per:8, max:3 }, desc:'3連撃。クリティカルしない。同じ技を続けて撃つほど威力+8%（3回まで）' },
  { name:'強化装填',               cls:'魔銃士', kind:'buff', proc:100, mp:16, buff:{ self:{ dex:35, int_stat:20 } }, priority:1, desc:'DEX+35%・INT+20%（重ねがけ可）' },
  { name:'キャノネスチュームビンド', cls:'魔銃士', kind:'phys', mult:1.65, add:[{ stat:'dex', rate:0.7 }], proc:80, mp:20, desc:'魔銃士の切り札' },
  { name:'弾幕',     cls:'魔銃士', kind:'phys', mult:0.44, add:[{ stat:'dex', rate:0.2 }], hits:3, proc:85, mp:16, noCrit:true, repeat:{ per:9, max:3 }, desc:'3連射。クリティカルしない。同じ技を続けて撃つほど威力+9%（3回まで）' },
  { name:'精密照準',               cls:'魔銃士', kind:'passive', mp:0, passive:{ hitStack:{ critRate:1, critDmg:2, max:5 } }, desc:'スキルを当てるたびにクリティカル率+1%・クリティカルダメージ+2%（5回まで）' },
  { name:'ラピッドショット',       cls:'魔銃士', kind:'phys', mult:1.6, proc:92, mp:11, repeat:{ per:10, max:3 }, reqJobs:5, desc:'素早く撃つ。同じ技を続けて撃つほど威力+10%（3回まで）' },
    { name:'ピアースバレット',   cls:'魔銃士', kind:'phys', mult:1.39, add:[{ stat:'dex', rate:0.3 }], defPen:0.3, proc:88, mp:14, repeat:{ per:7, max:3 }, reqJobs:5, desc:'相手の防御を30%無視。同じ技を続けて撃つほど威力+7%（3回まで）' },
  { name:'バーストショット',       cls:'魔銃士', kind:'phys', mult:1.58, add:[{ stat:'dex', rate:0.5 }], proc:85, mp:16, buff:{ enemy:{ vit:-20 } }, reqJobs:5, desc:'INTも威力になる。相手のVIT-20%（重ねがけ可）' },
  { name:'フルバースト', cls:'魔銃士', kind:'phys', mult:0.44, add:[{ stat:'dex', rate:0.15 }], hits:4, proc:78, mp:22, noCrit:true, reqJobs:5, desc:'4連射。INTも威力になる。クリティカルしない' },
  { name:'トレーサーロード',     cls:'魔銃士', kind:'buff', proc:100, mp:14, buff:{ self:{ dex:55 } }, priority:1, reqJobs:5, desc:'DEX+55%（重ねがけ可）' },
  { name:'サイコショット',   cls:'サイキッカー', kind:'mag', src:'str', mult:1.6, add:[{ stat:'int_stat', rate:0.6 }], proc:90, mp:13, desc:'念で叩く。相手の特防で受けるが、威力はSTR参照。INTも威力になる' },
  { name:'マインドブレイク', cls:'サイキッカー', kind:'mag', src:'str', mult:2.24, proc:85, mp:17, buff:{ enemy:{ str:-15, int_stat:-20 } }, desc:'精神を砕く。相手のSTR-15%・INT-20%（重ねがけ可）' },
  { name:'精神集中',         cls:'サイキッカー', kind:'buff', proc:100, mp:16, buff:{ self:{ str:35, int_stat:20 } }, priority:1, desc:'STR+35%・INT+20%（重ねがけ可）' },
  { name:'サイコブラスト',   cls:'サイキッカー', kind:'mag', src:'str', mult:1.82, add:[{ stat:'int_stat', rate:0.8 }], proc:80, mp:21, desc:'サイキッカーの切り札。相手の特防で受けるが、威力はSTR参照。INTも威力になる' },
  { name:'精神増幅', cls:'サイキッカー', kind:'buff', proc:100, mp:15, buff:{ self:{ str:30, int_stat:25 } }, priority:1, desc:'STR+30%・INT+25%（重ねがけ可）' },
  { name:'第六感',           cls:'サイキッカー', kind:'passive', mp:0, passive:{ perAct:{ stats:['agi', 'dex'], per:1, max:10 } }, desc:'自分が行動するたびAGI・DEX+1%（最大10%）' },
  { name:'テレキネシス',       cls:'サイキッカー', kind:'mag', src:'str', mult:1.9, add:[{ stat:'int_stat', rate:0.3 }], proc:90, mp:13, reqJobs:5, desc:'念力で叩きつける。相手の特防で受けるが、威力はSTR参照。DEXも威力になる' },
  { name:'サイコノイズ',       cls:'サイキッカー', kind:'mag', src:'str', mult:1.81, add:[{ stat:'int_stat', rate:0.3 }], proc:88, mp:15, buff:{ enemy:{ str:-15, int_stat:-15 } }, reqJobs:5, desc:'雑音で思考を乱す。相手のSTR-15%・INT-15%（重ねがけ可）' },
  { name:'マインドスパイク',   cls:'サイキッカー', kind:'mag', src:'str', mult:2.1, add:[{ stat:'int_stat', rate:0.35 }], proc:85, mp:17, reqJobs:5, desc:'精神を直接刺す。DEXも威力になる' },
  { name:'サイキックチェイン', cls:'サイキッカー', kind:'phys', src:'str', mult:0.48, add:[{ stat:'int_stat', rate:0.15 }, { stat:'int_stat', rate:0.15 }], hits:3, proc:80, mp:20, noCrit:true, reqJobs:5, desc:'3連撃。INT・DEXも威力になる。クリティカルしない' },
  { name:'マインドアクセル',           cls:'サイキッカー', kind:'buff', proc:100, mp:15, buff:{ self:{ agi:35, int_stat:20 } }, priority:1, reqJobs:5, desc:'AGI+35%・INT+20%（重ねがけ可）' },
  { name:'半月蹴り',     cls:'体術師', kind:'phys', mult:1.54, add:[{ stat:'agi', rate:0.3 }], proc:90, mp:12, airUp:true, desc:'足を払って跳び上がる。空中へ（空中のあいだ回避+10%）' },
  { name:'五連殺',       cls:'体術師', kind:'phys', mult:0.25, add:[{ stat:'agi', rate:0.12 }], hits:5, proc:80, mp:20, noCrit:true, keepAir:true, whileAir:{ mult:25 }, whileGround:{ mult:10 }, desc:'5連撃。クリティカルしない。空中なら威力+25%・地上なら+10%。蹴り続けるので位置は変わらない' },
  { name:'破衝掌',       cls:'体術師', kind:'phys', mult:1.53, defPen:0.5, proc:85, mp:16, whileAir:{ mult:40 }, desc:'相手の防御を50%無視。空中なら威力+40%（叩きつけて着地）' },
  { name:'飛天三角蹴り', cls:'体術師', kind:'phys', mult:0.37, add:[{ stat:'agi', rate:0.15 }], hits:3, proc:78, mp:22, noCrit:true, airUp:true, keepAir:true, rampHit:35, whileAir:{ hitBonus:20 }, desc:'3連撃。クリティカルしない。踏み込むほど鋭くなる（2発目から1発ごとに威力+35%）。空中なら命中+20%。跳び上がってそのまま空中に留まる' },
  { name:'地摺り足', cls:'体術師', kind:'phys', mult:1.25, add:[{ stat:'agi', rate:0.35 }], proc:88, mp:14, whileGround:{ mult:35 }, desc:'足を着いたまま踏み込む。地上なら威力+35%（空中では出せても伸びない）' },
  { name:'闘争本能',     cls:'体術師', kind:'passive', mp:0, passive:{ lowHp:{ stat:'str', max:15, at:25 } }, desc:'HPが減るほどSTRが上がる（最大15%・HP25%で最大）' },
  { name:'旋風脚', cls:'体術師', kind:'phys', mult:1.55, add:[{ stat:'agi', rate:0.3 }], proc:92, mp:11, reqJobs:5, desc:'回転しながら蹴り抜く。AGIも威力になる' },
  { name:'当身',   cls:'体術師', kind:'phys', mult:1.65, add:[{ stat:'agi', rate:0.3 }], proc:88, mp:14, buff:{ enemy:{ str:-15 } }, reqJobs:5, desc:'AGIも威力になる。相手のSTR-15%（重ねがけ可）' },
  { name:'疾風連撃', cls:'体術師', kind:'phys', mult:0.42, add:[{ stat:'agi', rate:0.2 }], hits:3, proc:85, mp:16, noCrit:true, whileAir:{ mult:30 }, reqJobs:5, desc:'3連撃。AGIも威力になる。クリティカルしない。空中なら威力+30%' },
  { name:'崩落蹴', cls:'体術師', kind:'phys', mult:1.41, add:[{ stat:'agi', rate:0.4 }], proc:82, mp:18, whileAir:{ mult:45 }, reqJobs:5, desc:'かかとを落とす。AGIも威力になる。空中なら威力+45%（叩きつけて着地する）' },
  { name:'気孔術',   cls:'体術師', kind:'heal', proc:85, mp:14, heal:{ rate:1.2 }, reqJobs:5, desc:'INT×1.0を回復' },
  { name:'ジャグリング',     cls:'ギャンブラー', kind:'phys', mult:0.55, hits:4, proc:85, mp:16, noCrit:true, desc:'4連撃。クリティカルしない' },
  { name:'ラッキーダイス',   cls:'ギャンブラー', kind:'phys', mult:2.2, proc:85, mp:16, variance:{ lo:50, hi:150 }, desc:'出たとこ勝負。威力が0.5〜1.5倍に振れる' },
  { name:'オールイン',       cls:'ギャンブラー', kind:'buff', proc:100, mp:18, buff:{ self:{ str:70, vit:-20 } }, priority:1, desc:'STR+70%・VIT-20%（重ねがけ可）' },
  { name:'ジャックポット',   cls:'ギャンブラー', kind:'phys', mult:2.08, proc:78, mp:22, variance:{ lo:30, hi:200 }, desc:'ギャンブラーの切り札。威力が0.3〜2.0倍に振れる' },
  { name:'一発勝負', cls:'ギャンブラー', kind:'phys', mult:1.79, add:[{ stat:'agi', rate:0.3 }], proc:82, mp:18, variance:{ lo:40, hi:180 }, desc:'威力が0.4〜1.8倍に振れる' },
  { name:'ギャンブルボディ', cls:'ギャンブラー', kind:'passive', mp:0, passive:{ gamble:{ up:30, upMult:1.2, down:20, downMult:0.9 } }, desc:'スキルが当たったとき、30%で威力1.2倍・20%で威力0.9倍' },
  { name:'コイントス',   cls:'ギャンブラー', kind:'phys', mult:1.65, add:[{ stat:'dex', rate:0.3 }], proc:90, mp:12, variance:{ lo:70, hi:130 }, reqJobs:5, desc:'投げつけたコインが当たる。DEXも威力になる。威力が0.7〜1.3倍に振れる' },
  { name:'カードスロー', cls:'ギャンブラー', kind:'phys', mult:0.9, add:[{ stat:'dex', rate:0.2 }], hits:2, proc:85, mp:16, noCrit:true, variance:{ lo:60, hi:140 }, reqJobs:5, desc:'2連撃。DEXも威力になる。クリティカルしない。威力が0.6〜1.4倍に振れる' },
  { name:'ラストベット', cls:'ギャンブラー', kind:'phys', mult:2.04, add:[{ stat:'dex', rate:0.4 }], proc:80, mp:20, buff:{ self:{ vit:-15 } }, reqJobs:5, desc:'DEXも威力になる。自分のVIT-15%（重ねがけ可）' },
  { name:'イカサマ',     cls:'ギャンブラー', kind:'buff', proc:95, mp:13, buff:{ enemy:{ luk:-20, dex:-15 } }, priority:1, reqJobs:5, desc:'相手のLUK-25%・DEX-15%（重ねがけ可）' },
  { name:'レディラック',   cls:'ギャンブラー', kind:'buff', proc:100, mp:14, buff:{ self:{ luk:55 } }, priority:1, reqJobs:5, desc:'LUK+55%（重ねがけ可）' },
  { name:'ドラゴンスラスト', cls:'竜騎士', kind:'phys', mult:1.68, defPen:0.3, proc:90, mp:12, whileStack:{ key:'charge', defPen:0.2 }, desc:'相手の防御を30%無視。竜気があるあいだ、さらに20%無視' },
  { name:'ドラゴンファング', cls:'竜騎士', kind:'phys', mult:0.73, hits:3, proc:85, mp:16, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'ドラゴンロア',     cls:'竜騎士', kind:'buff', proc:100, mp:14, chargeUp:true, buff:{ self:{ vit:20 } }, priority:1, desc:'吼えて竜気を溜める。竜気+1（最大3）。VIT+20%（重ねがけ可）。溜めているあいだ受けるダメージの軽減率+12%×個数' },
  { name:'天墜竜閃',         cls:'竜騎士', kind:'phys', mult:1.61, proc:78, mp:22, useCharge:{ per:35 }, desc:'竜騎士の切り札。竜気を全部使い、1つにつき威力+35%' },
  { name:'竜気錬成', cls:'竜騎士', kind:'buff', proc:100, mp:16, chargeUp:2, priority:1, desc:'1ターンかけて竜気を練る。竜気+2（最大3）。この行動では攻撃しない' },
  { name:'竜鱗の加護',       cls:'竜騎士', kind:'passive', mp:0, passive:{ dodgeCut:{ pct:20, cut:20 } }, desc:'ダメージを受けるとき、20%の確率で20%カット' },
  { name:'ランスチャージ', cls:'竜騎士', kind:'phys', mult:1.35, add:[{ stat:'str', rate:0.35 }], proc:90, mp:12, chargeUp:true, reqJobs:5, desc:'槍ごと突っ込む。STRも威力になる。突っ込みながら竜気+1' },
  { name:'スケイルピアス',       cls:'竜騎士', kind:'phys', mult:1.65, add:[{ stat:'str', rate:0.4 }], proc:88, mp:14, reqJobs:5, desc:'STRも威力になる' },
  { name:'ドラゴンダイブ',       cls:'竜騎士', kind:'phys', mult:1.35, add:[{ stat:'str', rate:0.4 }], proc:82, mp:18, useCharge:{ per:22 }, reqJobs:5, desc:'跳び上がって落下の勢いで叩きつける。STRも威力になる。竜気を全部使い、1つにつき威力+22%' },
  { name:'インティミデイト',     cls:'竜騎士', kind:'buff', proc:95, mp:14, buff:{ enemy:{ str:-20, agi:-15 } }, priority:1, reqJobs:5, desc:'相手のSTR-20%・AGI-15%（重ねがけ可）' },
  { name:'ドラゴンブラッド',       cls:'竜騎士', kind:'buff', proc:100, mp:15, buff:{ self:{ str:35, vit:20 } }, priority:1, reqJobs:5, desc:'STR+35%・VIT+20%（重ねがけ可）' },
  { name:'サラマンド',   cls:'精霊召喚士', kind:'mag', mult:1.77, proc:90, mp:13, repeat:{ per:16, max:3 }, desc:'火の精霊。同じ精霊を呼び続けるほど威力+16%（3回まで）' },
  { name:'ウンディーネ', cls:'精霊召喚士', kind:'heal', proc:85, mp:16, regen:{ rate:0.8, turns:4 }, desc:'水の精霊。4ターン毎ターンINT×0.6を回復' },
  { name:'シルフ',       cls:'精霊召喚士', kind:'mag', mult:1.69, proc:90, mp:13, buff:{ self:{ agi:25 } }, repeat:{ per:14, max:3 }, desc:'風の精霊。AGI+25%（重ねがけ可）。呼び続けるほど威力+14%（3回まで）' },
  { name:'ノーム',       cls:'精霊召喚士', kind:'mag', mult:2.01, proc:80, mp:21, buff:{ self:{ vit:20 } }, repeat:{ per:16, max:3 }, desc:'地の精霊。VIT+20%（重ねがけ可）。呼び続けるほど威力+16%（3回まで）' },
  { name:'ウィスプ', cls:'精霊召喚士', kind:'mag', mult:1.51, add:[{ stat:'agi', rate:0.3 }], proc:90, mp:13, repeat:{ per:14, max:3 }, desc:'小さな光の精霊。同じ技を続けて呼ぶほど威力+14%（3回まで）' },
  { name:'精霊共鳴',     cls:'精霊召喚士', kind:'passive', mp:0, passive:{ repeat:{ per:8, max:3 } }, desc:'同じスキルを続けて使うほど威力+8%（3回まで）。別のスキルを挟むと戻る' },
  { name:'イフリート',   cls:'精霊召喚士', kind:'mag', mult:1.55, add:[{ stat:'agi', rate:0.3 }], proc:88, mp:15, repeat:{ per:16, max:3 }, reqJobs:5, desc:'炎の巨人。呼び続けるほど威力+16%（3回まで）' },
  { name:'マーメイド',   cls:'精霊召喚士', kind:'mag', mult:1.41, add:[{ stat:'agi', rate:0.3 }], proc:90, mp:13, buff:{ enemy:{ agi:-20 } }, repeat:{ per:14, max:3 }, reqJobs:5, desc:'水の精霊。相手のAGI-20%（重ねがけ可）。呼び続けるほど威力+14%（3回まで）' },
  { name:'精霊解放',     cls:'精霊召喚士', kind:'mag', mult:1.88, add:[{ stat:'agi', rate:0.4 }], proc:78, mp:23, repeat:{ per:12, max:3 }, reqJobs:5, desc:'呼んだ精霊を解き放つ。呼び続けるほど威力+12%（3回まで）' },
  { name:'ドリアード',   cls:'精霊召喚士', kind:'heal', proc:85, mp:16, mpRegen:{ rate:0.5, turns:4 }, reqJobs:5, desc:'木の精霊。4ターン毎ターンINT×0.5のMPを回復' },
  { name:'フェニックス', cls:'精霊召喚士', kind:'heal', proc:82, mp:20, heal:{ rate:1.5 }, reqJobs:5, desc:'不死鳥。INT×1.5を回復' },
  { name:'符術・式打ち',   cls:'式神使い', kind:'mag', mult:2.05, proc:90, mp:13, ritual:1, desc:'式神を飛ばす。撃ちながら呪力+1' },
  { name:'呪符・魂削り',   cls:'式神使い', kind:'mag', mult:2.27, proc:85, mp:17, buff:{ enemy:{ int_stat:-30 } }, desc:'相手のINT-30%（重ねがけ可）' },
  { name:'陰陽結界',       cls:'式神使い', kind:'buff', proc:100, mp:15, ritual:1, priority:1, desc:'結界を張って呪力を練る。呪力+1（最大3）。この行動では攻撃しない' },
  { name:'禁術・神降ろし', cls:'式神使い', kind:'mag', mult:1.73, proc:78, mp:23, useRitual:{ per:40 }, desc:'式神使いの切り札。呪力を全部使い、1つにつき威力+40%' },
  { name:'式神・鬼', cls:'式神使い', kind:'mag', mult:1.71, add:[{ stat:'dex', rate:0.3 }], proc:85, mp:17, ritual:1, whileStack:{ key:'ritual', mult:20 }, desc:'撃ちながら呪力+1。呪力があるあいだ威力+20%' },
  { name:'式神召喚',       cls:'式神使い', kind:'passive', mp:0, passive:{ ritualStart:1 }, desc:'式を1体従えて戦う。戦闘を始めるとき呪力を1つ持っている' },
  { name:'呪符・鬼火', cls:'式神使い', kind:'mag', mult:1.9, add:[{ stat:'dex', rate:0.3 }], proc:90, mp:13, reqJobs:5, desc:'鬼火を飛ばす。DEXも威力になる' },
  { name:'式符・鎌鼬', cls:'式神使い', kind:'mag', mult:0.61, add:[{ stat:'dex', rate:0.15 }], hits:3, proc:85, mp:17, noCrit:true, ritual:1, reqJobs:5, desc:'3連撃。DEXも威力になる。クリティカルしない。撃ちながら呪力+1' },
  { name:'呪詛返し',   cls:'式神使い', kind:'mag', mult:1.42, add:[{ stat:'dex', rate:0.3 }], drain:0.3, proc:85, mp:17, useRitual:{ per:20 }, reqJobs:5, desc:'DEXも威力になる。与えたダメージの30%を吸収。呪力を全部使い、1つにつき威力+20%' },
  { name:'封印符',     cls:'式神使い', kind:'mag', mult:1.78, add:[{ stat:'dex', rate:0.3 }], proc:88, mp:15, ail:{ key:'silence', chance:35 }, whileStack:{ key:'ritual', ailChance:25 }, reqJobs:5, desc:'口を封じる。35%でサイレンス（発動率-20%）。呪力があるあいだ、さらに+25%' },
  { name:'大祓',       cls:'式神使い', kind:'heal', proc:85, mp:16, heal:{ rate:1.35 }, reqJobs:5, desc:'INT×1.4を回復' },
  { name:'練気掌',       cls:'武僧', kind:'phys', mult:1.78, add:[{ stat:'vit', rate:0.3 }], proc:85, mp:16, cure:1, desc:'気を練りながら打つ。自分の状態異常を1つ払う' },
  { name:'活殺自在',     cls:'武僧', kind:'phys', mult:1.46, add:[{ stat:'vit', rate:0.3 }], proc:85, mp:16, drain:0.4, cure:1, desc:'与えたダメージの40%を吸収。自分の状態異常を1つ払う' },
  { name:'金剛身',       cls:'武僧', kind:'buff', proc:100, mp:15, buff:{ self:{ vit:55 } }, cure:2, priority:1, desc:'VIT+55%（重ねがけ可）。自分の状態異常を2つ払う' },
  { name:'崩拳',     cls:'武僧', kind:'phys', mult:2.11, defPen:0.3, proc:82, mp:18, desc:'相手の防御を30%無視' },
  { name:'練丹功',   cls:'武僧', kind:'buff', proc:100, mp:14, buff:{ self:{ vit:30, str:20 } }, cure:1, priority:1, desc:'VIT+30%・STR+20%（重ねがけ可）。自分の状態異常を1つ払う' },
  { name:'心身一如', cls:'武僧', kind:'passive', mp:0, passive:{ debuffGuard:1, ailResist:20 }, desc:'戦闘中1回だけ相手のデバフを打ち消す。受ける状態異常の付与率-20%' },
  { name:'気功掌',     cls:'武僧', kind:'phys', mult:1.53, add:[{ stat:'str', rate:0.3 }], proc:90, mp:12, cure:1, reqJobs:5, desc:'気を乗せた掌底。STRも威力になる。自分の状態異常を1つ払う' },
  { name:'三連震脚',   cls:'武僧', kind:'phys', mult:0.58, add:[{ stat:'str', rate:0.15 }], hits:3, proc:85, mp:16, noCrit:true, reqJobs:5, desc:'3連撃。STRも威力になる。クリティカルしない' },
  { name:'破戒撃',       cls:'武僧', kind:'phys', mult:1.66, add:[{ stat:'vit', rate:0.3 }], proc:85, mp:16, buff:{ enemy:{ vit:-20 } }, ail:{ key:'silence', chance:30 }, reqJobs:5, desc:'相手のVIT-20%（重ねがけ可）。30%でサイレンス（発動率-20%）' },
  { name:'自癒功',     cls:'武僧', kind:'heal', proc:85, mp:15, heal:{ rate:1.3 }, cure:2, reqJobs:5, desc:'INT×1.3を回復。自分の状態異常を2つ払う' },
  { name:'阿吽の呼吸', cls:'武僧', kind:'buff', proc:100, mp:15, buff:{ self:{ vit:30, str:30 } }, priority:1, reqJobs:5, desc:'VIT+30%・STR+30%（重ねがけ可）' },
  { name:'ホークダイブ',   cls:'ビーストレンジャー', kind:'phys', mult:1.34, add:[{ stat:'agi', rate:0.3 }], proc:90, mp:12, form:'hawk', desc:'鷹が急降下する。DEXも威力になる。鷹を呼ぶ（AGI+20%・DEX+15%）。すでに鷹なら威力+25%' },
  { name:'ベアクロー',   cls:'ビーストレンジャー', kind:'phys', mult:1.43, add:[{ stat:'agi', rate:0.3 }], proc:88, mp:14, form:'bear', desc:'VITも威力になる。熊を呼ぶ（STR+20%・VIT+20%）。すでに熊なら威力+25%' },
  { name:'バイパーアロー',   cls:'ビーストレンジャー', kind:'phys', mult:1.36, add:[{ stat:'agi', rate:0.3 }], proc:85, mp:16, ail:{ key:'poison', chance:45 }, form:'snake', desc:'DEXも威力になる。45%で毒。蛇を呼ぶ（DEX+15%・LUK+15%）。すでに蛇なら威力+25%' },
  { name:'ビーストコール', cls:'ビーストレンジャー', kind:'buff', proc:100, mp:14, priority:1, formBuff:{ none:{ str:55 }, hawk:{ agi:35, dex:20 }, bear:{ str:35, vit:20 }, snake:{ dex:35, luk:20 } }, desc:'いま呼んでいる獣を昂らせる。鷹＝AGI+35%・DEX+20%／熊＝STR+35%・VIT+20%／蛇＝DEX+35%・LUK+20%（呼んでいなければSTR+55%）' },
  { name:'獣王の咆哮', cls:'ビーストレンジャー', kind:'phys', mult:1.55, add:[{ stat:'agi', rate:0.35 }], proc:82, mp:18, whileForm:{ mult:30 }, desc:'連れている獣と一緒に吼えかかる。獣を連れていれば威力+30%' },
  { name:'野性の勘',   cls:'ビーストレンジャー', kind:'passive', mp:0, passive:{ formBoost:50 }, desc:'獣の扱いに長けている。獣の型によるステータス補正が1.5倍になる' },
  { name:'ワイルドラッシュ',   cls:'ビーストレンジャー', kind:'phys', mult:0.53, add:[{ stat:'agi', rate:0.15 }], hits:3, proc:80, mp:20, noCrit:true, whileForm:{ mult:20 }, reqJobs:5, desc:'3連撃。DEXも威力になる。クリティカルしない。獣を連れていれば威力+20%' },
  { name:'獣呼びの矢', cls:'ビーストレンジャー', kind:'phys', mult:1.23, add:[{ stat:'agi', rate:0.5 }], proc:90, mp:12, whileForm:{ mult:18 }, reqJobs:5, desc:'DEXも威力になる。獣を連れていれば威力+18%' },
  { name:'狼牙連撃',   cls:'ビーストレンジャー', kind:'phys', mult:0.45, add:[{ stat:'agi', rate:0.2 }], hits:3, proc:85, mp:16, noCrit:true, whileForm:{ mult:18 }, reqJobs:5, desc:'3連撃。クリティカルしない。獣を連れていれば威力+18%' },
  { name:'共鳴の咆哮', cls:'ビーストレンジャー', kind:'buff', proc:100, mp:14, buff:{ self:{ str:30, agi:20 } }, priority:1, reqJobs:5, desc:'STR+30%・AGI+20%（重ねがけ可）' },
  { name:'貫狼撃',     cls:'ビーストレンジャー', kind:'phys', mult:1.83, defPen:0.3, proc:82, mp:18, whileForm:{ mult:22 }, reqJobs:5, desc:'相手の防御を30%無視。獣を連れていれば威力+22%' },
]


// ============================================================
// ★特殊効果の値段（2026-08-19 ユーザー指摘）
// ------------------------------------------------------------
// 「フレイムバースト（INT×2.7）と幽世ノ門（INT×2.7＋吸収30%）が同じ発動率」のように、
// **効果がタダで付いている**状態があった。＝効果つきの技が、素の技の完全上位互換になる。
//
// そこで**効果を倍率に換算した値段**を決めて、
//   実質価値 ＝ （倍率＋副参照）×多段数 ＋ 効果の値段
// が、同じ「発動率の帯」ならどの職でも同じになるように揃える。
//   ＝**効果を付けたぶんだけ倍率を下げる**（強さは同じ・回し方だけが違う）
//
// ⚠数字を足すときは skillValue() を通して帯に収める。skills.test.js が突き合わせている
// ============================================================
export const AIL_PRICE = { bleed:0.004, poison:0.005, slow:0.004, paralyze:0.02, healCut:0.003 }
export const PRICE = {
  drain: 0.8,        // 吸収1.0（=100%）につき。★2026-08-19に0.5→0.8（吸収系は火力を控えめにする）
  drainIfAil: 0.6,   // 条件つき吸収（相手が状態異常のときだけ）は素の吸収の0.6掛け
  defPen: 0.6,       // 防御無視1.0（=100%）につき
  sureHit: 0.15,     // 必中
  sureCrit: 0.50,    // 確定クリティカル
  hitBonus: 0.008,   // 命中+1%につき
  consumeAil: 0.30,  // 状態異常の起爆
  mpPct: 0.20,       // 割合消費（撃ち切れない）
  buffPct: 0.006,    // バフ・デバフ1%につき（自分にプラス／相手にマイナスが有料。逆は割引）
  hpCost: 0.015,     // 現在HPを1%払うごとに割引（すてみ）
  airUp: 0.10,       // 空中へ跳ぶ（体術師）。回避+10%と、叩きつけの前提になる
  form: 0.10,        // 獣を呼ぶ（ビーストレンジャー）。型のステータス補正が付く
  cure: 0.12,        // 自分の状態異常を1つ払う（武僧）
  stackUp: 0.15,     // 溜めを1つ積む（式神使いの呪力・竜騎士の竜気）
  chargeGuard: 0.10, // 竜気は溜めているあいだ硬くなる（そのぶんの値段）
}
// スキルが持つ「倍率以外の価値」
export const effectPrice = (s) => {
  let v = 0
  if (s.drain)    v += s.drain * PRICE.drain
  if (s.drainIfAil) v += (s.drainIfAil.pct / 100) * PRICE.drain * PRICE.drainIfAil
  if (s.defPen)   v += s.defPen * PRICE.defPen
  if (s.sureHit)  v += PRICE.sureHit
  if (s.sureCrit) v += PRICE.sureCrit
  if (s.hitBonus) v += s.hitBonus * PRICE.hitBonus
  // ★倍率に掛かる効果（起爆など）は relBonus 側で数える＝定額で付けると安すぎる
  if (s.mpPct)    v += PRICE.mpPct
  if (s.dispel)   v += s.dispel.chance * 0.004   // バフ剥がし（異端審問官）
  if (s.airUp)    v += PRICE.airUp                 // 跳び上がる（体術師）
  if (s.form)     v += PRICE.form                  // 獣を呼ぶ＝型を張り替える（ビーストレンジャー）
  if (s.cure)     v += PRICE.cure * s.cure         // 自分の状態異常を払う（武僧）
  if (s.bigGuard) v += s.bigGuard.cut * 0.006       // 大防御（聖騎士）。1ターンぶんの軽減
  if (s.keepAir)  v += 0.06                         // 空中に留まる（体術師）
  if (s.whileAir?.hitBonus) v += s.whileAir.hitBonus * PRICE.hitBonus * 0.6
  // 溜め・型が乗っているあいだの追加効果。軸を回していれば大体乗るので7掛けで見る
  if (s.whileStack?.defPen) v += s.whileStack.defPen * PRICE.defPen * 0.7
  if (s.whileStack?.ailChance) v += (AIL_PRICE[s.ail?.key] || 0.004) * s.whileStack.ailChance * 0.7
  if (s.whileForm?.ailChance)  v += (AIL_PRICE[s.ail?.key] || 0.004) * s.whileForm.ailChance * 0.7
  if (s.ritual)   v += PRICE.stackUp * s.ritual    // 呪力を練る（式神使い）
  if (s.chargeUp) v += PRICE.stackUp + PRICE.chargeGuard   // 竜気を溜める（竜騎士。硬くなるぶん高い）
  // 状態異常。ヒットごとに試す技（マッドラッシュ）は2発ぶんまで数える
  //   （同じ出血を重ねても1スタックずつしか増えないので、単純な掛け算にはしない）
  if (s.ail) {
    const times = s.ailPerHit ? Math.min(2, s.hits || 1) : 1
    v += (AIL_PRICE[s.ail.key] || 0.004) * s.ail.chance * times
  }
  // 自分のHPを払って撃つ技（すてみ）は、そのぶん割引
  if (s.hpCostPct) v -= s.hpCostPct * PRICE.hpCost
  for (const [side, tbl] of Object.entries(s.buff || {})) {
    for (const pct of Object.values(tbl)) {
      const good = side === 'self' ? pct > 0 : pct < 0
      v += (good ? PRICE.buffPct : -PRICE.buffPct) * Math.abs(pct)
    }
  }
  return Math.round(v * 1000) / 1000
}
// 倍率の合計（副参照こみ×多段）
export const multTotal = (s) => Math.round(((s.mult || 0) + (s.add || []).reduce((t, a) => t + a.rate, 0)) * (s.hits || 1) * 1000) / 1000
// 倍率そのものを何倍にする効果（起爆など）。**期待値**で見る
//   起爆：出血は撒いてから刈るので、実戦では2〜3スタックで撃つ想定＝2.5スタック
export const EXPECTED_STACKS = 2.5
// 溜め（呪力・竜気）：最大3つだが、溜める手番も要るので平均2つ・そのぶん7掛けで見る
export const EXPECTED_CHARGE = 2 * 0.7
// 型が合っているときの威力+%（battle.js の BEAST_BONUS と同じ値。値段づけで参照する）
export const BEAST_BONUS = 25
export const relBonus = (s) => {
  let v = s.consumeAil ? s.consumeAil.perStack * EXPECTED_STACKS : 0
  // 追い討ち：相手のHPが減るほど伸びる。**削り切るまでの平均**でならすと最大値の約6割
  if (s.lowHpBonus) v += (s.lowHpBonus.max / 100) * 0.6
  // 聖職者：自分のHPが高いほど。削られていくので平均は最大値の約5割
  if (s.highHpBonus) v += (s.highHpBonus.max / 100) * 0.5
  // 異端審問官：相手のバフの数。実戦では1〜2個乗っている想定
  if (s.vsBuff) v += (s.vsBuff.per / 100) * 1.5
  // 魔銃士・精霊召喚士：同じ技を続けて撃つ。平均1.5スタック想定
  if (s.repeat) v += (s.repeat.per / 100) * 1.5
  // 魔法剣士：交互に振れば毎回乗るが、そう組めない場面もあるので6割で見る
  if (s.switchKind) v += (s.switchKind / 100) * 0.6
  // ギャンブラー：期待値そのもの（振れ幅が広いこと自体の得は見ない）
  if (s.variance) v += (s.variance.lo + s.variance.hi) / 200 - 1
  // 元素使い：組み合わせが噛み合うのは半分くらい（順番を固定すれば毎回だが枠を食う）
  if (s.combo) v += (s.combo.mult / 100) * 0.5
  // 体術師：空中から叩きつける。跳ぶ手番が要るので6割で見る
  if (s.whileAir?.mult) v += (s.whileAir.mult / 100) * 0.6
  // 式神使い・竜騎士：溜めてから撃つ。**溜める手番のぶん**を差し引いて平均2つで見る
  if (s.useRitual) v += (s.useRitual.per / 100) * EXPECTED_CHARGE
  if (s.useCharge) v += (s.useCharge.per / 100) * EXPECTED_CHARGE
  // ビーストレンジャー：型を合わせて撃てば乗る。張り替えながら戦うので半分で見る
  if (s.form) v += (BEAST_BONUS / 100) * 0.5
  // ★軸につながる技：溜め・型が乗っているあいだ効く（回していれば大体乗るので7掛け）
  if (s.whileStack?.mult) v += (s.whileStack.mult / 100) * 0.7
  if (s.whileForm?.mult)  v += (s.whileForm.mult / 100) * 0.7
  // 体術師：地上にいるあいだ効く（跳ばなければ常に乗るので8掛け）
  if (s.whileGround?.mult) v += (s.whileGround.mult / 100) * 0.8
  // 多段で1発ごとに伸びる。平均すると (hits-1)/2 発ぶん
  if (s.rampHit) v += (s.rampHit / 100) * (((s.hits || 1) - 1) / 2)
  // 賢者：相手にかかっている状態異常の数。実戦では1〜2個ついている想定
  if (s.vsAil) v += (s.vsAil.per / 100) * 1.2
  return v
}

// 実質価値＝倍率×（1＋倍率に掛かる効果）＋定額の効果
export const skillValue = (s) => Math.round((multTotal(s) * (1 + relBonus(s)) + effectPrice(s)) * 1000) / 1000

// 発動率の帯ごとの「あるべき価値」。**発動率が低いほど価値が高い**（強い技ほど出にくい）
//   ノーブルは開始時の職業なので一段低い（×0.85）
export const VALUE_TABLE = {
  basic:    { phys: { 95:1.25, 90:1.40, 88:1.45, 85:1.55 }, mag: { 95:1.45, 90:1.60, 88:1.70, 85:1.80 } },
  advanced: { phys: { 95:1.75, 92:1.85, 90:1.95, 88:2.05, 85:2.20, 82:2.30, 80:2.35, 78:2.40 },
              mag:  { 95:2.00, 92:2.10, 90:2.20, 88:2.30, 85:2.45, 82:2.55, 80:2.62, 78:2.70 } },
}
export const NOBLE_MULT = 0.85
export const targetValue = (cls, kind, proc) => {
  const t = VALUE_TABLE[isBasicClass(cls) ? 'basic' : 'advanced'][kind]
  if (!t) return null
  const keys = Object.keys(t).map(Number).sort((a, b) => b - a)
  const key = keys.find(k => proc >= k) ?? keys[keys.length - 1]
  return Math.round(t[key] * (cls === 'ノーブル' ? NOBLE_MULT : 1) * 1000) / 1000
}


// 消費MPも帯で揃える（2026-08-19）。
//   同じ発動率・同じ価値なのにMPだけ安い技があると、それが一方的に得＝他職の技が下位互換になる。
//   ＝**同じ帯なら価値もMPも同じ。違うのは中身（効果の組み合わせ）だけ**にする。
//   ★パッシブ（MP0）と、割合消費（マナボルト）は対象外
export const MP_TABLE = {
  basic:    { phys: { 95:4,  90:8,  88:9,  85:11 }, mag: { 95:5,  90:9,  88:10, 85:13 } },
  advanced: { phys: { 95:10, 92:11, 90:12, 88:14, 85:16, 82:18, 80:20, 78:22 },
              mag:  { 95:11, 92:12, 90:13, 88:15, 85:17, 82:19, 80:21, 78:23 } },
}
export const targetMp = (cls, kind, proc) => {
  const t = MP_TABLE[isBasicClass(cls) ? 'basic' : 'advanced'][kind]
  if (!t) return null
  const keys = Object.keys(t).map(Number).sort((a, b) => b - a)
  const key = keys.find(k => proc >= k) ?? keys[keys.length - 1]
  return Math.round(t[key] * (cls === 'ノーブル' ? NOBLE_MULT : 1))
}


// バフ・回復も「MPに見合った効き」に揃える（2026-08-19）。
//   例）戦士の防御態勢（VIT+50%・MP8）が、上位職のバフ（VIT+45%・MP13）より効率が良く、
//       上位職のバフが完全下位互換になっていた。
//   ・バフ  ：効果の合計%   ＝ MP × BUFF_PER_MP
//   ・即時回復：INF×rate     ＝ MP × HEAL_PER_MP
//   ・継続回復：rate×ターン数 ＝ MP × REGEN_PER_MP（MP回復は MPREGEN_PER_MP）
export const BUFF_PER_MP     = { basic: 3.4, advanced: 3.8 }
// 効きすぎを止めるフタ（バフは重ねがけ可・ATBでは約1分続くため）
export const BUFF_MAX = 55   // 自分に掛けるものの合計%
export const DEBUFF_MAX = 35 // 相手に掛けるものの合計%
export const BUFF_MIN = 15
export const HEAL_PER_MP     = { basic: 0.10, advanced: 0.085 }
export const REGEN_PER_MP    = { basic: 0.16, advanced: 0.20 }
export const MPREGEN_PER_MP  = { basic: 0.10, advanced: 0.13 }
export const supportTarget = (cls, key) => {
  const tier = isBasicClass(cls) ? 'basic' : 'advanced'
  const t = { buff: BUFF_PER_MP, heal: HEAL_PER_MP, regen: REGEN_PER_MP, mpRegen: MPREGEN_PER_MP }[key]
  return t ? t[tier] * (cls === 'ノーブル' ? NOBLE_MULT : 1) : null
}

// ===== 他職のスキルは効果が落ちる（2026-08-18 ユーザー決定）=====
// v2は「習得済み」で転職後もスキルが残る＝**職業をまたいで自由に組み合わせられる**。
// そのままだと、周回するほど全員が同じ最適5枠に寄って**職業を選ぶ意味が消える**。
// そこで「いまの職業のスキルでないものは効果を OFF_CLASS_MULT 倍にする」。
//   ・掛かるもの … ダメージ／回復量（即時・継続・MP）／バフとデバフの増減幅／状態異常の付与確率
//   ・掛からないもの … 通常攻撃（スキルではない）・パッシブ（扱いは別途決める）・
//                     防御無視・必中・確定クリ・多段数・発動率・消費MP
// ★枠の強制（「3枠は自職」など）は**採らない**。0.8倍だけで自職のスキルが上位に来ることを
//   実測で確認したうえで、枠まで縛ると二重の税金になり周回して集める動機が消えるため。
export const OFF_CLASS_MULT = 0.8
// 消費MPは逆に増える（2026-08-18 追加）。効果が落ちるだけだと「弱いが安い枠」として
// 積めてしまうので、**想定利用MPの枠も食う**ようにして使用回数のほうからも縛る
export const OFF_CLASS_MP_MULT = 2
// 敵の技やテスト用のダミーは cls を持たない＝素の性能のまま（罰則の対象は職業スキルだけ）。
// 職業の分からない側（テストのダミーなど）も罰しない
export const isOwnClassSkill = (cls, skill) => !skill?.cls || !cls || skill.cls === cls
// cut … 他職ペナルティの軽減率%（賢者は50＝ペナルティが半分）。classBonus の offClassCut から来る
export const offClassMult = (cls, skill, cut = 0) =>
  (isOwnClassSkill(cls, skill) ? 1 : 1 - (1 - OFF_CLASS_MULT) * (1 - Math.min(100, cut) / 100))
// 実際に払う消費MP。★編成の検証（想定利用MP）と戦闘の消費で必ず同じ関数を通すこと
export const mpOf = (cls, skill, cut = 0) =>
  (skill?.mp || 0) * (isOwnClassSkill(cls, skill) ? 1 : 1 + (OFF_CLASS_MP_MULT - 1) * (1 - Math.min(100, cut) / 100))
// 割合消費（マナボルト）も同じだけ重くする。100%は超えない
export const mpPctOf = (cls, skill, cut = 0) =>
  Math.min(1, (skill?.mpPct || 0) * (isOwnClassSkill(cls, skill) ? 1 : 1 + (OFF_CLASS_MP_MULT - 1) * (1 - Math.min(100, cut) / 100)))
// 増減幅を丸ごと弱める（バフ・デバフ用。デバフは負の値なので0へ寄る＝弱くなる）
export const scaleTable = (table, mult) =>
  (mult === 1 || !table) ? table : Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v * mult]))

export const SKILL_BY_NAME = Object.fromEntries(SKILLS.map(s => [s.name, s]))
// 枠に置ける技（パッシブは枠を使わないので入らない）
export const skillsOf = (cls) => SKILLS.filter(s => s.cls === cls && !isPassive(s))
export const SKILL_CLASSES = [...new Set(SKILLS.map(s => s.cls))]

// 倍率のレンジは初期職と上位職で違う（上位職はあるけみすと級）。
// 職業マスタ自体はDBの v2_classes が正だが、この区別はバランスの規則なのでJS側にも持つ。
export const BASIC_CLASSES = ['ノーブル', '戦士', '弓使い', '魔法使い', '僧侶', '格闘家', 'サモナー']
export const isBasicClass = (cls) => BASIC_CLASSES.includes(cls)

// ===== 習得中と習得済み =====
// あるけみすとのスキルは2段構え：
//   ・習得中   … LVアップ時に、いまの職業のスキルを確率で覚える。**転職すると失われる**
//   ・習得済み … 転職のとき、いまの職業の「習得中のスキル」から1つを永久に残せる。
//               全部習得済み／習得中が無いときは何も残らない
// 使えるスキル ＝ 習得中（その周回だけ）∪ 習得済み（ずっと）
//   → 周回するほど習得済みが増え、どの職業でもいろんなスキルを使えるようになる
export const SKILL_SET_SLOTS = 5   // 編成できる枠数
export const SKILL_USE_MAX   = 99  // 1枠あたりの使用回数の上限

// LVアップでの習得。基礎確率で抽選しつつ、LEARN_BY_LV までに全部そろうよう保証する
export const LEARN_BY_LV  = 50  // このLVまでに、その職業のスキルを全部習得できる
export const LEARN_PCT    = 15  // 1LVアップあたりの基礎習得率(%)

// そのLVで「確定で覚えなければならない数」。残りLV数が足りなくなったぶんだけ増える
export const forcedLearnCount = (lv, unlearned) =>
  Math.max(0, unlearned - Math.max(0, LEARN_BY_LV - lv))

// LVアップ1回で覚える数（確定ぶん＋基礎確率の抽選1回）。lv は上がったあとのLV
export const rollLearnCount = (lv, unlearned, rng = Math.random) => {
  if (unlearned <= 0) return 0
  const must = Math.min(unlearned, forcedLearnCount(lv, unlearned))
  const extra = (unlearned - must > 0 && rng() * 100 < LEARN_PCT) ? 1 : 0
  return Math.min(unlearned, must + extra)
}

export const usableSkillNames = (learning = [], learned = []) => [...new Set([...learning, ...learned])]
export const usableSkills = (learning = [], learned = []) => {
  const set = new Set(usableSkillNames(learning, learned))
  return SKILLS.filter(s => set.has(s.name))
}
// まだ覚えていない、いまの職業のスキル（一覧にグレーで出す用）
export const unlearnedSkills = (cls, learning = [], learned = []) => {
  const set = new Set(usableSkillNames(learning, learned))
  return skillsOf(cls).filter(s => !set.has(s.name))
}
// 転職で「習得済み」にできる候補＝いまの職業の「習得中だがまだ習得済みでない」スキル
export const keepableSkillNames = (cls, learning = [], learned = []) => {
  const has = new Set(learning)
  const done = new Set(learned)
  return skillsOf(cls).filter(s => has.has(s.name) && !done.has(s.name)).map(s => s.name)
}

// 想定利用MP＝編成を全部撃ち切ったときの消費MP合計（あるけみすとの表示と同じ考え方）。
// ★使用回数の上限はこれで決まる。最大MPを超える編成は保存できない
//   ＝MPを伸ばすほど強い技を多く積める＝MPがちゃんとステータスとして効く
// ※パッシブは常時発動＝消費しないので数えない
// ★cls を渡すと、他職のスキルは消費MPが OFF_CLASS_MP_MULT 倍で数えられる。
//   サーバーの v2_set_skills も同じ規則で数えるので、片方だけ直さないこと
export const setMpCost = (set, cls) => (set || [])
  .reduce((t, e) => {
    const s = SKILL_BY_NAME[e?.name]
    return t + (!s || isPassive(s) || s.mpPct ? 0 : mpOf(cls, s) * (e?.uses || 0))
  }, 0)

// 編成の検証。問題があれば日本語のエラー文、無ければ null（サーバーの v2_set_skills と同じ規則）
export const validateSkillSet = (set, usableNames, maxMp = Infinity, cls = undefined) => {
  if (!Array.isArray(set)) return '編成の形式が不正です'
  if (set.length > SKILL_SET_SLOTS) return `枠は${SKILL_SET_SLOTS}個までです`
  const usable = new Set(usableNames)
  const seen = new Set()
  for (const e of set) {
    if (!e?.name) return '枠にスキルが入っていません'
    if (!usable.has(e.name)) return `${e.name}はまだ使えません`
    // ★同じスキルを何枠に置いてもよい（納刀→居合斬→納刀→月影 のように組める）
    seen.add(e.name)
    const uses = Number(e.uses)
    if (!Number.isInteger(uses) || uses < 1 || uses > SKILL_USE_MAX) return `${e.name}の使用回数は1〜${SKILL_USE_MAX}です`
  }
  const cost = setMpCost(set, cls)
  if (cost > maxMp) return `想定利用MPが最大MPを超えています（${cost} / ${maxMp}）`
  return null
}

// ===== 一覧の絞り込み・並べ替え（スキルが増えても探せるように） =====
export const KIND_TABS = [
  { key:'all',  label:'すべて' },
  { key:'phys', label:'物理' },
  { key:'mag',  label:'魔法' },
  { key:'buff', label:'補助' },
  { key:'heal', label:'回復' },
  { key:'passive', label:'パッシブ' },
  { key:'fav',  label:'お気に入り' },
]
export const SORT_KEYS = ['name', 'mp', 'proc', 'cls']
export const filterSkills = (list, { tab = 'all', query = '', favorites = [] } = {}) => {
  const q = (query || '').trim()
  const fav = new Set(favorites)
  return list.filter(s => {
    if (tab === 'fav') { if (!fav.has(s.name)) return false }
    else if (tab !== 'all' && s.kind !== tab) return false
    if (q && !s.name.includes(q) && !s.cls.includes(q) && !(s.desc || '').includes(q)) return false
    return true
  })
}
export const sortSkills = (list, key = 'name', asc = true) => {
  const dir = asc ? 1 : -1
  return [...list].sort((a, b) => {
    if (key === 'mp' || key === 'proc') return (a[key] - b[key]) * dir || a.name.localeCompare(b.name, 'ja')
    if (key === 'cls') return a.cls.localeCompare(b.cls, 'ja') * dir || a.name.localeCompare(b.name, 'ja')
    return a.name.localeCompare(b.name, 'ja') * dir
  })
}

// 保存された編成（[{name, uses}]）を戦闘用の slots に変換する。知らない名前は捨てる
export const buildSlots = (set) => (set || [])
  .map(e => ({ skill: SKILL_BY_NAME[e.name], uses: e.uses }))
  .filter(s => s.skill)

// 表示用の効果テキスト（威力の出どころが一目で分かるように）
export const statLabel = (k) => (k === 'int_stat' ? 'INT' : String(k).toUpperCase())
export const powerText = (s) => {
  if (isPassive(s)) return s.desc
  if (s.kind === 'heal') {
    if (s.mpRegen) return `毎ターン MP INT×${s.mpRegen.rate}×${s.mpRegen.turns}T`
    if (s.regen)   return `毎ターン INT×${s.regen.rate}×${s.regen.turns}T`
    return `INT×${s.heal?.rate || 0}`
  }
  if (s.kind === 'buff') return s.desc
  const main = `${statLabel(s.src || (s.kind === 'mag' ? 'int_stat' : 'str'))}×${s.mult}`
  const sub = (s.add || []).map(a => ` ＋ ${statLabel(a.stat)}×${a.rate}`).join('')
  const hits = s.hits > 1 ? ` ×${s.hits}回` : ''
  return `${main}${sub}${hits}`
}

// 1ターンぶんの期待ダメージ（発動率と多段を込みにした概算。バランス確認用）
// 命中・クリティカルは含めない＝素の期待値
export const expectedDamage = (skill, attacker, defender, damageOf) => {
  if (!skill || (skill.kind !== 'phys' && skill.kind !== 'mag')) return 0
  const per = damageOf({
    attacker, defender, mult: skill.mult, kind: skill.kind,
    defPen: skill.defPen || 0, add: skill.add || null,
  })
  return Math.round(per * (skill.hits || 1) * (skill.proc / 100))
}

// 1回使ったときの期待回復量（持続系は全ターンの合計）。healOf は combat.js のもの
export const expectedHeal = (skill, actor, healOf) => {
  if (!skill || skill.kind !== 'heal') return 0
  const p = skill.proc / 100
  if (skill.mpRegen) return Math.round(healOf(actor, skill.mpRegen.rate) * skill.mpRegen.turns * p)
  if (skill.regen)   return Math.round(healOf(actor, skill.regen.rate) * skill.regen.turns * p)
  return Math.round(healOf(actor, skill.heal?.rate || 0) * p)
}
