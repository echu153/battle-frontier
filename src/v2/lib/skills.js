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
]

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
  { name:'はたく',     cls:'ノーブル', kind:'phys', mult:1.3, proc:95, mp:0,  desc:'素手で殴る。消費MPなし' },
  { name:'狙い撃ち',   cls:'ノーブル', kind:'phys', mult:1.35, proc:90, mp:5,  sureHit:true, desc:'必ず当たる一撃' },
  { name:'応急手当',   cls:'ノーブル', kind:'heal', proc:85, mp:8,  heal:{ rate:1.0 }, priority:1, desc:'INT×1.0を回復' },
  { name:'身構える',   cls:'ノーブル', kind:'buff', proc:100, mp:6, buff:{ self:{ vit:35 } }, priority:1, desc:'VIT+35%（重ねがけ可）' },
  { name:'気合い',     cls:'ノーブル', kind:'buff', proc:90, mp:8,  buff:{ self:{ str:15 } }, priority:1, desc:'STR+15%（重ねがけ可）' },

  // ===== 戦士（物理・耐久） =====
  { name:'体当たり',       cls:'戦士', kind:'phys', mult:1.4, proc:95, mp:5,  desc:'素直な体当たり' },
  { name:'強撃',           cls:'戦士', kind:'phys', mult:1.65, proc:85, mp:12, desc:'力を込めた一撃' },
  { name:'防御崩し',       cls:'戦士', kind:'phys', mult:1.2, proc:90, mp:10, buff:{ enemy:{ vit:-15 } }, desc:'相手のVIT-15%（重ねがけ可）' },
  { name:'防御態勢',       cls:'戦士', kind:'buff', proc:100, mp:8, buff:{ self:{ vit:50 } }, priority:1, desc:'VIT+50%（重ねがけ可）' },
  { name:'シールドアタック', cls:'戦士', kind:'phys', mult:0.95, add:[{ stat:'vit', rate:0.5 }], proc:90, mp:10, desc:'盾で殴る。VITも威力になる' },

  // ===== 弓使い（命中・素早さ） =====
  { name:'狙撃',     cls:'弓使い', kind:'phys', mult:0.8, add:[{ stat:'agi', rate:0.6 }], proc:90, mp:8, sureHit:true, desc:'必中。AGIも威力になる' },
  { name:'剛射',     cls:'弓使い', kind:'phys', mult:1.65, proc:85, mp:11, desc:'強く引き絞って射る' },
  { name:'貫通射撃', cls:'弓使い', kind:'phys', mult:1.4, defPen:0.3, proc:85, mp:12, desc:'相手の防御を30%無視' },
  { name:'疾風矢',   cls:'弓使い', kind:'phys', mult:1, add:[{ stat:'agi', rate:0.5 }], proc:90, mp:8, desc:'速射。AGIも威力になる' },
  { name:'駆け足',   cls:'弓使い', kind:'buff', proc:100, mp:6, buff:{ self:{ agi:30 } }, priority:1, desc:'AGI+30%（重ねがけ可）' },

  // ===== 魔法使い（火力特化） =====
  { name:'マジックアロー', cls:'魔法使い', kind:'mag', mult:1.5, proc:95, mp:5,  desc:'消費が軽い基本の魔法' },
  { name:'ファイア',       cls:'魔法使い', kind:'mag', mult:1.8, proc:85, mp:11, desc:'火の魔法' },
  { name:'サンダー',       cls:'魔法使い', kind:'mag', mult:1.85, proc:85, mp:15, desc:'初期職では最大級の威力。出にくい' },
  { name:'アイスランス',   cls:'魔法使い', kind:'mag', mult:1.3, proc:85, mp:12, buff:{ enemy:{ agi:-20 } }, desc:'相手のAGI-20%（重ねがけ可）' },
  { name:'精神統一',       cls:'魔法使い', kind:'buff', proc:100, mp:8, buff:{ self:{ int_stat:30 } }, priority:1, desc:'INT+30%（重ねがけ可）' },

  // ===== 僧侶（回復・支援） =====
  { name:'ライト',       cls:'僧侶', kind:'mag', mult:1.5, proc:95, mp:6,  desc:'光の魔法' },
  { name:'ライトニング', cls:'僧侶', kind:'mag', mult:1.8, proc:85, mp:13, desc:'僧侶の攻撃手段の要' },
  { name:'ヒール',       cls:'僧侶', kind:'heal', proc:85, mp:12, heal:{ rate:1.4 }, priority:1, desc:'INT×1.4を回復' },
  { name:'祈祷',         cls:'僧侶', kind:'heal', proc:85, mp:15, regen:{ rate:0.5, turns:4 }, priority:1, desc:'4ターン毎ターンINT×0.5を回復' },
  { name:'プロテク',     cls:'僧侶', kind:'buff', proc:100, mp:10, buff:{ self:{ vit:25, int_stat:25 } }, priority:1, desc:'VIT・INT+25%（重ねがけ可）' },

  // ===== 格闘家（手数） =====
  { name:'打撃',   cls:'格闘家', kind:'phys', mult:1.4, proc:95, mp:4,  desc:'軽い打撃' },
  { name:'鉄拳',   cls:'格闘家', kind:'phys', mult:1.65, proc:85, mp:12, desc:'渾身の一撃' },
  { name:'連打',   cls:'格闘家', kind:'phys', mult:0.54, hits:3, proc:85, mp:10, noCrit:true, desc:'3連撃。1発ずつ命中判定。クリティカルしない' },
  { name:'爆裂拳', cls:'格闘家', kind:'phys', mult:0.42, hits:4, proc:85, mp:16, noCrit:true, desc:'4連撃。出にくいが手数で押す。クリティカルしない' },
  { name:'残心',   cls:'格闘家', kind:'buff', proc:100, mp:8, buff:{ self:{ dex:20, agi:20 } }, priority:1, desc:'DEX・AGI+20%（重ねがけ可）' },

  // ===== サモナー（魔法・補助） =====
  { name:'オオカミ召喚',   cls:'サモナー', kind:'mag', mult:1.5, proc:90, mp:8,  desc:'狼を呼んで噛みつかせる' },
  { name:'小悪魔召喚',     cls:'サモナー', kind:'mag', mult:1.8, proc:85, mp:11, desc:'小悪魔を呼ぶ' },
  { name:'グリフォン召喚', cls:'サモナー', kind:'mag', mult:1.4, proc:85, mp:13, buff:{ self:{ agi:20 } }, desc:'AGI+20%（重ねがけ可）' },
  { name:'群れの号令',     cls:'サモナー', kind:'mag', mult:0.63, hits:3, proc:85, mp:14, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'魔力供給',       cls:'サモナー', kind:'heal', proc:85, mp:0, mpRegen:{ rate:0.3, turns:4 }, priority:1, desc:'4ターン毎ターンINT×0.3のMPを回復。消費MPなし' },

  // ============================================================
  // 上位職・複合上位職・特殊職
  //  ・名前は旧版から流用（武僧／ビーストレンジャーは旧版に無いので新規）
  //  ・倍率はあるけみすと級。**合計（副参照こみ×多段）で物理2.4・魔法2.7が上限**
  //    （通常 物1.7〜1.9/魔1.9〜2.15・主力 物2.0〜2.2/魔2.25〜2.45・切り札 物2.4/魔2.7）
  //  ・パッシブは各職1つ。あるけみすとの職業補正（STR+5%など）に合わせてかなり控えめ
  //  ・職業ごとに参照するステータスを変えて、役割が被らないようにしてある
  // ============================================================

  // ===== 侍（STR＋DEX・出血・防御無視） =====
  // ★参照するステは職業補正の main/sub に合わせる（侍は main=STR / sub=DEX）。
  //   バフでDEXを上げるのに威力がDEXを見ていない、のような噛み合わない状態を作らない
  { name:'居合斬',   cls:'侍', kind:'phys', mult:1.5, add:[{ stat:'dex', rate:0.4 }], proc:90, mp:12, ail:{ key:'bleed', chance:20 }, desc:'抜き打ち。DEXも威力になる。20%で出血' },
  { name:'断空',     cls:'侍', kind:'phys', mult:2, defPen:0.5, proc:85, mp:16, desc:'相手の防御を50%無視' },
  { name:'居合の構え', cls:'侍', kind:'passive', mp:0, passive:{ misfireAtkMult:2 }, desc:'スキルが不発したとき、代わりに出る通常攻撃の威力が2倍になる' },
  { name:'明鏡止水', cls:'侍', kind:'buff', proc:100, mp:12, buff:{ self:{ str:30, dex:20 } }, priority:1, desc:'STR+30%・DEX+20%（重ねがけ可）' },
  { name:'月影',     cls:'侍', kind:'phys', mult:2.4, proc:78, mp:22, ail:{ key:'bleed', chance:40 }, desc:'侍の切り札。40%で出血' },

  // ===== 狂戦士（STR一点・自分を削る） =====
  { name:'マッドラッシュ', cls:'狂戦士', kind:'phys', mult:0.75, hits:3, proc:85, mp:16, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'すてみ',       cls:'狂戦士', kind:'phys', mult:2.4, proc:78, mp:18, buff:{ self:{ vit:-20 } }, desc:'大威力だが自分のVIT-20%（重ねがけ可）' },
  { name:'バーサク',     cls:'狂戦士', kind:'passive', mp:0, passive:{ rage:{ stat:'str', per:3, max:15 } }, desc:'ダメージを与えるたびSTR+3%（最大15%）。不発・通常攻撃・攻撃が外れたときにリセット' },
  { name:'ブラッティロア', cls:'狂戦士', kind:'buff', proc:100, mp:14, buff:{ self:{ str:40 } }, priority:1, desc:'STR+40%（重ねがけ可）' },
  { name:'フルブレイカー', cls:'狂戦士', kind:'phys', mult:2.1, defPen:0.5, proc:85, mp:18, desc:'相手の防御を50%無視' },

  // ===== 狩人（STR＋DEX・搦め手） =====
  { name:'毒矢',     cls:'狩人', kind:'phys', mult:1.4, add:[{ stat:'dex', rate:0.5 }], proc:90, mp:12, buff:{ enemy:{ agi:-15 } }, desc:'相手のAGI-15%（重ねがけ可）' },
  { name:'三連射',   cls:'狩人', kind:'phys', mult:0.65, hits:3, proc:85, mp:14, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'鷹ノ目',   cls:'狩人', kind:'passive', mp:0, passive:{ hitBonus:5 }, desc:'最終命中率+5%' },
  { name:'狩猟本能', cls:'狩人', kind:'buff', proc:100, mp:14, buff:{ self:{ str:30, agi:30 } }, priority:1, desc:'STR・AGI+30%（重ねがけ可）' },
  { name:'絶影狙撃', cls:'狩人', kind:'phys', mult:2.3, sureHit:true, proc:80, mp:20, desc:'必中の大威力' },

  // ===== 暗殺者（STR＋LUK・クリティカル） =====
  { name:'瞬歩瞬殺', cls:'暗殺者', kind:'phys', mult:1.6, add:[{ stat:'agi', rate:0.4 }], proc:90, mp:12, desc:'AGIも威力になる' },
  { name:'鬼影閃',   cls:'暗殺者', kind:'phys', mult:0.7, hits:3, proc:85, mp:15, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'隠身',     cls:'暗殺者', kind:'passive', mp:0, passive:{ evaBonus:5 }, desc:'回避率+5%' },
  { name:'影歩き',   cls:'暗殺者', kind:'buff', proc:100, mp:12, buff:{ self:{ agi:40, dex:20 } }, priority:1, desc:'AGI+40%・DEX+20%（重ねがけ可）' },
  { name:'急所突き', cls:'暗殺者', kind:'phys', mult:1.5, sureCrit:true, proc:80, mp:20, desc:'必ずクリティカルになる' },

  // ===== 元素使い（INT純火力） =====
  { name:'アクアショット',   cls:'元素使い', kind:'mag', mult:2.0, proc:90, mp:12, buff:{ enemy:{ agi:-20 } }, desc:'相手のAGI-20%（重ねがけ可）' },
  { name:'アースクエイク',   cls:'元素使い', kind:'mag', mult:2.3, proc:85, mp:15, buff:{ enemy:{ vit:-20 } }, desc:'相手のVIT-20%（重ねがけ可）' },
  { name:'元素共鳴',         cls:'元素使い', kind:'passive', mp:0, passive:{ switchStat:{ stat:'int_stat', pct:10 } }, desc:'直前と異なるスキルを使うとき、その行動だけINT+10%（重複しない）' },
  { name:'ライトニングボルト', cls:'元素使い', kind:'mag', mult:2.5, proc:85, mp:17, desc:'雷の魔法' },
  { name:'フレイムバースト', cls:'元素使い', kind:'mag', mult:2.7, proc:80, mp:20, desc:'元素使いの切り札' },

  // ===== 死霊使い（INT＋VIT・吸収） =====
  { name:'骸骨召喚',   cls:'死霊使い', kind:'mag', mult:2.1, proc:90, mp:11, desc:'骸骨を呼ぶ' },
  { name:'ソウルドレイン', cls:'死霊使い', kind:'mag', mult:2.2, drain:0.4, proc:85, mp:15, desc:'与えたダメージの40%を吸収' },
  { name:'骸の壁',     cls:'死霊使い', kind:'passive', mp:0, passive:{ wall:{ pct:10, every:5 } }, desc:'戦闘開始時と自分の行動5回ごとに「次に受けるダメージ10%減」を得る（重複しない・1回受けると消える）' },
  { name:'腐敗霧',     cls:'死霊使い', kind:'mag', mult:2, proc:85, mp:16, buff:{ enemy:{ vit:-25, int_stat:-25 } }, desc:'相手のVIT・INT-25%（重ねがけ可）' },
  { name:'幽世ノ門',   cls:'死霊使い', kind:'mag', mult:2.7, drain:0.3, proc:80, mp:20, desc:'与えたダメージの30%を吸収' },

  // ===== 聖職者（INT・回復特化） =====
  { name:'ホーリーライト', cls:'聖職者', kind:'mag', mult:2.2, proc:90, mp:12, desc:'聖なる光' },
  { name:'奇跡',           cls:'聖職者', kind:'heal', proc:85, mp:18, regen:{ rate:1.0, turns:4 }, priority:1, desc:'4ターン毎ターンINT×1.0を回復' },
  { name:'神聖加護',       cls:'聖職者', kind:'passive', mp:0, passive:{ healBonus:20 }, desc:'自分が回復する量+20%' },
  { name:'祈りの結界',     cls:'聖職者', kind:'buff', proc:100, mp:14, buff:{ self:{ vit:50, int_stat:20 } }, priority:1, desc:'VIT+50%・INT+20%（重ねがけ可）' },
  { name:'神罰執行',       cls:'聖職者', kind:'mag', mult:2.7, proc:80, mp:20, desc:'聖職者の切り札' },

  // ===== 異端審問官（INT＋VIT・弱体） =====
  { name:'粛清',       cls:'異端審問官', kind:'mag', mult:1.9, add:[{ stat:'vit', rate:0.5 }], proc:90, mp:13, desc:'VITも威力になる' },
  { name:'狂信',       cls:'異端審問官', kind:'buff', proc:100, mp:12, buff:{ self:{ int_stat:35 } }, priority:1, desc:'INT+35%（重ねがけ可）' },
  { name:'執行本能',   cls:'異端審問官', kind:'passive', mp:0, passive:{ rage:{ stat:'int_stat', per:3, max:15 } }, desc:'ダメージを与えるたびINT+3%（最大15%）。不発・通常攻撃・攻撃が外れたときにリセット' },
  { name:'聖なる裁き', cls:'異端審問官', kind:'mag', mult:2.5, proc:85, mp:17, desc:'裁きの光' },
  { name:'断罪',       cls:'異端審問官', kind:'mag', mult:2.7, proc:80, mp:21, buff:{ enemy:{ int_stat:-20 } }, desc:'相手のINT-20%（重ねがけ可）' },

  // ===== 賢者（INT・高コスト） =====
  { name:'サンダーストライク', cls:'賢者', kind:'mag', mult:2.2, proc:90, mp:14, desc:'雷撃' },
  { name:'マナボルト',       cls:'賢者', kind:'mag', mult:2.7, proc:78, mp:0, mpPct:0.2, desc:'そのときの残りMPの20%を消費する大魔法' },
  { name:'天啓',             cls:'賢者', kind:'passive', mp:0, passive:{ procBonus:5 }, desc:'スキルの発動率+5%' },
  { name:'氷の障壁',         cls:'賢者', kind:'buff', proc:100, mp:15, buff:{ self:{ vit:40, int_stat:20 } }, priority:1, desc:'VIT+40%・INT+20%（重ねがけ可）' },
  { name:'メテオストライク', cls:'賢者', kind:'mag', mult:0.65, hits:4, proc:75, mp:22, noCrit:true, desc:'4連撃。クリティカルしない' },

  // ===== 聖騎士（STR＋VIT・守って殴る） =====
  { name:'ホーリーエッジ',     cls:'聖騎士', kind:'phys', mult:1.4, add:[{ stat:'vit', rate:0.5 }], proc:90, mp:13, desc:'VITも威力になる' },
  { name:'ディバインスマイト', cls:'聖騎士', kind:'phys', mult:2.0, proc:85, mp:16, buff:{ enemy:{ str:-20 } }, desc:'相手のSTR-20%（重ねがけ可）' },
  { name:'聖騎士の心得',       cls:'聖騎士', kind:'passive', mp:0, passive:{ statPct:{ vit:5 } }, desc:'VIT+5%' },
  { name:'聖域展開',           cls:'聖騎士', kind:'heal', proc:85, mp:18, regen:{ rate:0.7, turns:4 }, priority:1, desc:'4ターン毎ターンINT×0.7を回復' },
  { name:'神聖覚醒',           cls:'聖騎士', kind:'phys', mult:1.8, add:[{ stat:'vit', rate:0.6 }], proc:80, mp:20, desc:'VITも大きく威力になる' },

  // ===== 魔法剣士（STR＋INT両刀） =====
  { name:'雷光斬',           cls:'魔法剣士', kind:'phys', mult:1.3, add:[{ stat:'int_stat', rate:0.6 }], proc:90, mp:13, desc:'INTも威力になる' },
  { name:'閃光',             cls:'魔法剣士', kind:'phys', mult:1.9, proc:90, mp:15, buff:{ self:{ str:15 } }, desc:'撃つたびSTR+15%（重ねがけ可）' },
  { name:'魔導剣術',         cls:'魔法剣士', kind:'passive', mp:0, passive:{ convert:{ from:'int_stat', to:'str', pct:20 } }, desc:'INTの20%をSTRへ変換する（そのぶんINTは下がる）' },
  { name:'魔剣開放',         cls:'魔法剣士', kind:'buff', proc:100, mp:18, buff:{ self:{ str:35, int_stat:35 } }, priority:1, desc:'STR・INT+35%（重ねがけ可）' },
  { name:'エレメンタルエッジ', cls:'魔法剣士', kind:'phys', mult:1.5, add:[{ stat:'int_stat', rate:0.9 }], proc:80, mp:22, desc:'両刀の切り札' },

  // ===== 魔銃士（STR＋INT＋DEX） =====
  { name:'魔弾',                   cls:'魔銃士', kind:'phys', mult:1.3, add:[{ stat:'int_stat', rate:0.6 }], proc:85, mp:13, desc:'INTも威力になる' },
  { name:'連装銃撃',               cls:'魔銃士', kind:'phys', mult:0.65, hits:3, proc:85, mp:15, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'精密照準',               cls:'魔銃士', kind:'passive', mp:0, passive:{ critBonus:5 }, desc:'最終クリティカル率+5%' },
  { name:'強化装填',               cls:'魔銃士', kind:'buff', proc:100, mp:16, buff:{ self:{ str:30, int_stat:30 } }, priority:1, desc:'STR・INT+30%（重ねがけ可）' },
  { name:'キャノネスチュームビンド', cls:'魔銃士', kind:'phys', mult:1.7, add:[{ stat:'int_stat', rate:0.7 }], proc:80, mp:22, desc:'魔銃士の切り札' },

  // ===== サイキッカー（STR＋INT・弱体） =====
  { name:'サイコショット',   cls:'サイキッカー', kind:'phys', mult:1.3, add:[{ stat:'int_stat', rate:0.6 }], proc:90, mp:12, desc:'INTも威力になる' },
  { name:'マインドブレイク', cls:'サイキッカー', kind:'mag', mult:2.0, proc:85, mp:15, buff:{ enemy:{ dex:-25 } }, desc:'相手のDEX-25%（重ねがけ可）' },
  { name:'第六感',           cls:'サイキッカー', kind:'passive', mp:0, passive:{ defPenBonus:10 }, desc:'防御貫通+10%' },
  { name:'精神集中',         cls:'サイキッカー', kind:'buff', proc:100, mp:16, buff:{ self:{ str:30, int_stat:30 } }, priority:1, desc:'STR・INT+30%（重ねがけ可）' },
  { name:'サイコブラスト',   cls:'サイキッカー', kind:'phys', mult:1.6, add:[{ stat:'int_stat', rate:0.8 }], proc:80, mp:21, desc:'サイキッカーの切り札' },

  // ===== 体術師（STR＋AGI・手数） =====
  { name:'半月蹴り',     cls:'体術師', kind:'phys', mult:1.8, proc:90, mp:12, desc:'回し蹴り' },
  { name:'五連殺',       cls:'体術師', kind:'phys', mult:0.46, hits:5, proc:80, mp:20, noCrit:true, desc:'5連撃。クリティカルしない' },
  { name:'闘争本能',     cls:'体術師', kind:'passive', mp:0, passive:{ lowHp:{ stat:'str', max:15, at:25 } }, desc:'HPが減るほどSTRが上がる（最大15%・HP25%で最大）' },
  { name:'破衝掌',       cls:'体術師', kind:'phys', mult:1.9, defPen:0.5, proc:85, mp:16, desc:'相手の防御を50%無視' },
  { name:'飛天三角蹴り', cls:'体術師', kind:'phys', mult:0.55, add:[{ stat:'agi', rate:0.25 }], hits:3, proc:78, mp:17, noCrit:true, desc:'3連撃。AGIも威力になる' },

  // ===== ギャンブラー（LUK一点） =====
  { name:'ジャグリング',     cls:'ギャンブラー', kind:'phys', mult:0.55, hits:4, proc:85, mp:15, noCrit:true, desc:'4連撃。クリティカルしない' },
  { name:'ラッキーダイス',   cls:'ギャンブラー', kind:'phys', mult:2, proc:85, mp:13, desc:'出たとこ勝負の一撃' },
  { name:'ギャンブルボディ', cls:'ギャンブラー', kind:'passive', mp:0, passive:{ gamble:{ up:30, upMult:1.2, down:20, downMult:0.9 } }, desc:'スキルが当たったとき、30%で威力1.2倍・20%で威力0.9倍' },
  { name:'オールイン',       cls:'ギャンブラー', kind:'buff', proc:100, mp:18, buff:{ self:{ str:50, vit:-30 } }, priority:1, desc:'STR+50%・VIT-30%（重ねがけ可）' },
  { name:'ジャックポット',   cls:'ギャンブラー', kind:'phys', mult:2.4, proc:75, mp:22, desc:'ギャンブラーの切り札' },

  // ===== 竜騎士（STR＋VIT・貫通） =====
  { name:'ドラゴンスラスト', cls:'竜騎士', kind:'phys', mult:1.7, defPen:0.3, proc:90, mp:13, desc:'相手の防御を30%無視' },
  { name:'ドラゴンファング', cls:'竜騎士', kind:'phys', mult:0.7, hits:3, proc:85, mp:17, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'竜鱗の加護',       cls:'竜騎士', kind:'passive', mp:0, passive:{ dodgeCut:{ pct:10, cut:25 } }, desc:'ダメージを受けるとき、10%の確率で25%カット' },
  { name:'ドラゴンロア',     cls:'竜騎士', kind:'buff', proc:100, mp:14, buff:{ self:{ str:35 } }, priority:1, desc:'STR+35%（重ねがけ可）' },
  { name:'天墜竜閃',         cls:'竜騎士', kind:'phys', mult:2.4, proc:78, mp:22, desc:'竜騎士の切り札' },

  // ===== 精霊召喚士（INT・六属から4体） =====
  { name:'サラマンド',   cls:'精霊召喚士', kind:'mag', mult:2.4, proc:90, mp:13, desc:'火の精霊' },
  { name:'ウンディーネ', cls:'精霊召喚士', kind:'heal', proc:85, mp:16, regen:{ rate:0.6, turns:4 }, priority:1, desc:'水の精霊。4ターン毎ターンINT×0.6を回復' },
  { name:'精霊共鳴',     cls:'精霊召喚士', kind:'passive', mp:0, passive:{ statPct:{ int_stat:5 }, todo:true }, desc:'【暫定】INT+5%' },
  { name:'シルフ',       cls:'精霊召喚士', kind:'mag', mult:1.9, proc:90, mp:14, buff:{ self:{ agi:25 } }, desc:'風の精霊。AGI+25%（重ねがけ可）' },
  { name:'ノーム',       cls:'精霊召喚士', kind:'mag', mult:2.6, proc:80, mp:20, buff:{ enemy:{ vit:-20 } }, desc:'地の精霊。相手のVIT-20%（重ねがけ可）' },

  // ===== 式神使い（INT・弱体と結界） =====
  { name:'符術・式打ち',   cls:'式神使い', kind:'mag', mult:2.2, proc:90, mp:12, desc:'式神を飛ばす' },
  { name:'呪符・魂削り',   cls:'式神使い', kind:'mag', mult:2.1, proc:85, mp:16, buff:{ enemy:{ int_stat:-30 } }, desc:'相手のINT-30%（重ねがけ可）' },
  { name:'式神召喚',       cls:'式神使い', kind:'passive', mp:0, passive:{ statPct:{ int_stat:5 }, todo:true }, desc:'【暫定】INT+5%' },
  { name:'陰陽結界',       cls:'式神使い', kind:'buff', proc:100, mp:15, buff:{ self:{ vit:40, int_stat:15 } }, priority:1, desc:'VIT+40%・INT+15%（重ねがけ可）' },
  { name:'禁術・神降ろし', cls:'式神使い', kind:'mag', mult:2.7, proc:78, mp:22, desc:'式神使いの切り札' },

  // ===== ブリーダー（STR＋INT。旧版はペット共闘だが、v2にペットが無いので効果は作り直し） =====
  { name:'ペット召喚',       cls:'ブリーダー', kind:'passive', mp:0, passive:{ statPct:{ str:3, int_stat:3 }, todo:true }, desc:'【暫定】STR・INT+3%' },
  { name:'攻撃して！',       cls:'ブリーダー', kind:'phys', mult:2, proc:90, mp:14, desc:'相棒に攻撃させる' },
  { name:'一緒に頑張ろう！', cls:'ブリーダー', kind:'buff', proc:100, mp:14, buff:{ self:{ str:25, int_stat:25 } }, priority:1, desc:'STR・INT+25%（重ねがけ可）' },
  { name:'休憩しよう！',     cls:'ブリーダー', kind:'heal', proc:85, mp:16, heal:{ rate:1.5 }, buff:{ self:{ vit:20 } }, priority:1, desc:'INT×1.5を回復・VIT+20%（重ねがけ可）' },
  { name:'やっちゃえ！',     cls:'ブリーダー', kind:'phys', mult:2.4, proc:78, mp:22, desc:'ブリーダーの切り札' },

  // ===== 武僧（格闘家×僧侶。旧版に無い職なのでスキル名は新規） =====
  { name:'練気掌',   cls:'武僧', kind:'phys', mult:1.5, add:[{ stat:'int_stat', rate:0.5 }], proc:85, mp:12, desc:'INTも威力になる' },
  { name:'活殺自在', cls:'武僧', kind:'phys', mult:1.9, drain:0.5, proc:85, mp:14, desc:'与えたダメージの50%を吸収' },
  { name:'心身一如', cls:'武僧', kind:'passive', mp:0, passive:{ debuffGuard:1 }, desc:'戦闘中1回だけ、相手から受けるデバフを打ち消す' },
  { name:'金剛身',   cls:'武僧', kind:'buff', proc:100, mp:15, buff:{ self:{ vit:45, int_stat:15 } }, priority:1, desc:'VIT+45%・INT+15%（重ねがけ可）' },
  { name:'崩拳',     cls:'武僧', kind:'phys', mult:2.3, defPen:0.3, proc:82, mp:20, desc:'相手の防御を30%無視' },

  // ===== ビーストレンジャー（サモナー×弓使い。旧版に無い職なのでスキル名は新規） =====
  { name:'獣呼びの矢', cls:'ビーストレンジャー', kind:'phys', mult:1.4, add:[{ stat:'agi', rate:0.5 }], proc:90, mp:12, desc:'AGIも威力になる' },
  { name:'群狼の牙',   cls:'ビーストレンジャー', kind:'mag', mult:0.75, hits:3, proc:85, mp:16, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'野性の勘',   cls:'ビーストレンジャー', kind:'passive', mp:0, passive:{ statPct:{ agi:5 }, todo:true }, desc:'【暫定】AGI+5%' },
  { name:'共鳴の咆哮', cls:'ビーストレンジャー', kind:'buff', proc:100, mp:14, buff:{ self:{ str:25, agi:25 } }, priority:1, desc:'STR・AGI+25%（重ねがけ可）' },
  { name:'貫狼撃',     cls:'ビーストレンジャー', kind:'phys', mult:2.2, defPen:0.3, proc:82, mp:20, desc:'相手の防御を30%無視' },
]

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
// 敵の技やテスト用のダミーは cls を持たない＝素の性能のまま（罰則の対象は職業スキルだけ）
export const isOwnClassSkill = (cls, skill) => !skill?.cls || skill.cls === cls
export const offClassMult = (cls, skill) => (isOwnClassSkill(cls, skill) ? 1 : OFF_CLASS_MULT)
// 増減幅を丸ごと弱める（バフ・デバフ用。デバフは負の値なので0へ寄る＝弱くなる）
export const scaleTable = (table, mult) =>
  (mult === 1 || !table) ? table : Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v * mult]))

export const SKILL_BY_NAME = Object.fromEntries(SKILLS.map(s => [s.name, s]))
export const skillsOf = (cls) => SKILLS.filter(s => s.cls === cls)
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
export const setMpCost = (set) => (set || [])
  .reduce((t, e) => {
    const s = SKILL_BY_NAME[e?.name]
    return t + (!s || isPassive(s) || s.mpPct ? 0 : (s.mp || 0) * (e?.uses || 0))
  }, 0)

// 編成の検証。問題があれば日本語のエラー文、無ければ null（サーバーの v2_set_skills と同じ規則）
export const validateSkillSet = (set, usableNames, maxMp = Infinity) => {
  if (!Array.isArray(set)) return '編成の形式が不正です'
  if (set.length > SKILL_SET_SLOTS) return `枠は${SKILL_SET_SLOTS}個までです`
  const usable = new Set(usableNames)
  const seen = new Set()
  for (const e of set) {
    if (!e?.name) return '枠にスキルが入っていません'
    if (!usable.has(e.name)) return `${e.name}はまだ使えません`
    if (seen.has(e.name)) return `${e.name}が重複しています`
    seen.add(e.name)
    const uses = Number(e.uses)
    if (!Number.isInteger(uses) || uses < 1 || uses > SKILL_USE_MAX) return `${e.name}の使用回数は1〜${SKILL_USE_MAX}です`
  }
  const cost = setMpCost(set)
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
export const powerText = (s) => {
  if (isPassive(s)) return s.desc
  if (s.kind === 'heal') {
    if (s.mpRegen) return `毎ターン MP INT×${s.mpRegen.rate}×${s.mpRegen.turns}T`
    if (s.regen)   return `毎ターン INT×${s.regen.rate}×${s.regen.turns}T`
    return `INT×${s.heal?.rate || 0}`
  }
  if (s.kind === 'buff') return s.desc
  const main = `${s.kind === 'mag' ? 'INT' : 'STR'}×${s.mult}`
  const sub = (s.add || []).map(a => ` ＋ ${a.stat === 'int_stat' ? 'INT' : a.stat.toUpperCase()}×${a.rate}`).join('')
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
