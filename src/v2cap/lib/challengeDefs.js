// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 挑戦（四凶）の報酬の表（特別な素材と専用装備）
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー「4強の報酬を決めたい」
//   「難易度ごとにエリアでドロップする装備をランダムで獲得」「確率で特別な素材を獲得」
//   「50個集めると鍛冶屋の作成で専用装備を作成できるように」「鍛冶屋に作成にエリア装備と挑戦装備分けて作成できるように」
//   「低確率で専用装備現物をドロップ」「専用装備はレジェンダリーだけど、エリアのレジェンダリーよりもステータス10ポイント多めに」
//   「V1の装備を流用したい、内容はV2にあわせて」「超超低確率でユニーク装備もドロップするようにする」
//   → 案を見て全部「推奨」を選んだ：
//   ・倒したら、その難易度のエリアの装備を必ず1つ（ノーマル＝②・ハード＝⑤。武器はいまの職業が使える種類）。レア75・エピック20・レジェンダリー5
//   ・特別な素材は50%で1〜5個。**ボス×難易度ごとに別**（名前はV1の2つ＝ノーマルが V1 のふつうの素材・ハードが V1 の希少な素材）
//   ・専用装備そのものは2%。難易度ごとに強さが違う（ノーマル＝②のレジェンダリー・ハード＝⑤のレジェンダリーに合計+10）＝同じ日に下の【確定】で「必要LV70の1つ」へ変えた
//   ・作成は素材50個＋Gold（必要LV×200＝レジェンダリーの作成と同じ）
//   ・救援の人は、確率と素材の数に貢献度の割合（最低3割＝dungeon.js の HELPER_REWARD_MIN_PCT）を掛ける／ひとりで倒されずに倒したら素材の数も3倍
//   ・ユニークは0.1%で、**四凶ごとに新しく1つ作る**（名前・能力・ステはユーザーが案のシートで決める）。決まるまでは落とさない
//   ・V1の12個（V1 のレイドの交換所の装備）を、V2の種類と配分・V2の今ある能力の仕組みに合わせた（下の CHALLENGE_GEAR_DEFS）
// 【確定】同じ日（案のシート https://claude.ai/artifact/XQpra128M75ttkd3aPchvK を見て）ユーザー「能力は問題ない」
//   「装備ステータスはレジェンドが70　ユニークが85にして」→聞き直して「レジェンダリーは必要レベル70、ユニークはレベル85って意味」
//   「難易度によって専用アイテムとレジェンダリーユニークのドロップ率も上げて」→選んだ「ハードは1.5倍」：
//   ・専用装備は**必要LV70の1つ**（ノーマルとハードで同じ装備・前の「ノーマルLV25／ハードLV40」はやめた）。強さは同じLVのレジェンダリー＋10のまま
//   ・ユニーク4つ（下の CHALLENGE_UNIQUE_DEFS）は**必要LV85**。4つとも装飾品（ユーザー「全部アクセにしてほしい、誰でも装備できるように」）
//   ・落ちる確率はハードが1.5倍（下の CH_RATES）。素材の確率と数は難易度で変えない
//   ・こちらで決めたこと（ユーザーに伝える）：鍛冶屋ではノーマルとハードのどちらの素材でも50個で作れる／ユニークのステは前の60個の装飾品65（LV80）をLV85にのばした69
// ★このファイルは表だけ（ほかを読まない）。装備の一覧へは equipment.js が入れる（CHALLENGE_ITEMS）。
//   素材の数・作成・落とし方の関数は challenge.js。抽選はサーバー（v2cap_dungeon_pay_reward）・作成もサーバー（v2cap_craft_challenge）
//   ⚠数を変えたら SQL も直す（v2capsql.test.js が突き合わせる）
// ============================================================

// 難易度ごとの段階＝その難易度を呼べるエリア（dungeon.js の diffs の area と同じ・challenge.test.js が見る）。
//   倒すと必ずもらうエリアの装備は、このエリアのもの（②＝ノーマル・⑤＝ハード）。エキスパート（⑧）・マスター（⑫）は呼べるようになったら足す
export const CHALLENGE_TIER_AREA = { normal: 2, hard: 5 }
export const CHALLENGE_DIFFS = Object.keys(CHALLENGE_TIER_AREA)

// 専用装備のエリア＝必要LV70のレジェンダリーのエリア（⑪・equipment.js の reqLvOf(11, 'L') が70）。
//   アイテムLV・強化と分解の残骸（⑪の残骸）・防具のセット（⑪の重鎧／軽装）はこのエリアのもの。ノーマルでもハードでも同じ装備
export const CHALLENGE_GEAR_AREA = 11
// 専用装備の強さ：同じアイテムLVのレジェンダリーの戦闘力（強化の前）に足す点（ユーザー「ステータス10ポイント多めに」）
export const CHALLENGE_BONUS = 10
// ユニーク（四凶）：必要LV85・振れるポイント（LV85・強化+0のステの合計）。
//   69＝前の60個の装飾品65（LV80）を、装備の強さと同じ割合（本体の戦闘力 LV85÷LV80＝325÷308）でのばした数（68.6→69）。
//   LV80で着けると前の60個と同じ65（必要LVに足りない＝いまのLV相当）。強化と分解の残骸は専用装備と同じ⑪
export const CHALLENGE_UNIQUE_LV = 85
export const CHALLENGE_UNIQUE_POINTS = 69

// 特別な素材の名前（ボス × 難易度）。V1 の素材：ノーマル＝V1 のふつうの素材・ハード＝V1 の希少な素材
export const CHALLENGE_MATS = {
  varuzenoku: { normal: '黒龍の鱗', hard: '黒龍の逆鱗' },
  amaza: { normal: '水禍の雫', hard: '雨禍の心核' },
  zerugiasu: { normal: '雷鋼片', hard: '神雷炉心' },
  enma: { normal: '獄王の断罪片', hard: '閻魔の審判核' },
}

// 落とし方（サーバーの v2cap_dungeon_pay_reward と同じ数）
// 難易度ごと：gear＝必ず1つ落ちるエリアの装備のレア度（%）・own＝専用装備そのもの（%）・unique＝ユニーク（%）。
//   【確定】ユーザーが選んだ「ハードは1.5倍」（ノーマルは前のまま。レジェンダリー5→8はレアから引く＝エピックは20のまま）
export const CH_RATES = {
  normal: { gear: { R: 75, E: 20, L: 5 }, own: 2, unique: 0.1 },
  hard: { gear: { R: 72, E: 20, L: 8 }, own: 3, unique: 0.15 },
}
export const CH_MAT_PCT = 50                           // 特別な素材が入る確率（%・難易度で変えない）
export const CH_MAT_RANGE = [1, 5]                     // 入ったときの数（この範囲の整数を均等に1つ）
export const CH_MAT_SOLO_MULT = 3                      // ひとりで倒されずに倒したら素材の数を何倍にするか（EXP・Goldと同じ）
// 作成（鍛冶屋の「挑戦装備」）
export const CH_CRAFT_MATS = 50                        // 使う素材の数
export const CH_CRAFT_GOLD_PER_LV = 200                // Gold＝必要LV×これ（レジェンダリーの作成と同じ）

// 専用装備（V1 のレイドの交換所の12個）。kind＝V2の種類（equipment.js の KINDS の key）。
//   ステの配分はV2の同じ種類の装備と同じ（ユーザーが選んだ案「上がるステはV2の同じ種類の配分」）。
//   text＝能力の文・fx＝戦闘の効果（src/v2cap/core/battleSet.js の冒頭の項目だけを使う＝戦闘の計算は足していない）。v1＝V1 の能力（画面には出さない・控え）
//   ★V2 に同じ仕組みが無い4つは近い形にした（ユーザーが選んだ「この案で」）：
//     哭雨の羽衣＝8ターンごと（ユニークの亡将の鉄兜の6ターンより下）・雷鋼の機神鎧＝受けると麻痺（V2 に「受けて速くなる」仕組みが無い）・
//     蒼雷の短刃＝当てると麻痺（挑戦の戦闘に追加行動が無い）・六道輪廻の数珠＝6ターンごとに次の攻撃+30%（STRの2%はV2の魔法職にほぼ効かない）
export const CHALLENGE_GEAR_DEFS = [
  { boss: 'varuzenoku', kind: '両手剣', name: 'ヴァルブレイカー',
    text: '攻撃ヒット時、2ターンの間、相手を回復阻害（回復量−30%）\n回復阻害の相手への与ダメージ+10%',
    fx: { onHitAils: [{ key: 'healCut', chance: 100, pct: 30, turns: 2 }], vsAilDmg: [{ key: 'healCut', pct: 10 }] },
    v1: '攻撃ヒット時、2ターンの間対象の回復力−30%' },
  { boss: 'varuzenoku', kind: '銃', name: 'マレディクシオン',
    text: '攻撃ヒット時、2ターンの間、相手を回復阻害（回復量−30%）\n回復阻害の相手への与ダメージ+10%',
    fx: { onHitAils: [{ key: 'healCut', chance: 100, pct: 30, turns: 2 }], vsAilDmg: [{ key: 'healCut', pct: 10 }] },
    v1: '攻撃ヒット時、2ターンの間対象の回復力−30%' },
  { boss: 'varuzenoku', kind: '重鎧鎧', name: '黒龍の鎧',
    text: 'STR+5%・INT+5%',
    fx: { statPct: { str: 5, int_stat: 5 } },
    v1: '攻撃力+5%・特殊攻撃力+5%' },
  { boss: 'amaza', kind: '杖', name: '濡羽杖アマザネ',
    text: '攻撃ヒット時、50%で相手のAGI−5%（重なって最大−20%）',
    fx: { onHitStack: [{ stat: 'agi', pct: -5, chance: 50, cap: -20 }] },
    v1: '攻撃ヒット時、2ターンの間対象の素早さ−5%（最大4回重複）' },
  { boss: 'amaza', kind: '軽装鎧', name: '哭雨の羽衣',
    text: '戦闘開始時と8ターンごとに、状態異常を1回防ぐ守りを得る（重ならない）',
    fx: { ward: { every: 8 } },
    v1: '戦闘開始時と5ターンごとに、状態異常を1回無効化するバフ' },
  { boss: 'amaza', kind: 'リング', name: '水禍の蒼珠',
    text: '相手の魔法防御を10%無視',
    fx: { defIgnore: { mag: 10 } },
    v1: '魔法防御貫通+5%' },
  { boss: 'zerugiasu', kind: '重鎧鎧', name: '雷鋼の機神鎧',
    text: 'ダメージを受けたとき、15%で相手を麻痺',
    fx: { counterAil: [{ key: 'paralyze', chance: 15 }] },
    v1: '被ダメージ時、2ターンの間素早さ+15%' },
  { boss: 'zerugiasu', kind: '短剣', name: '蒼雷の短刃',
    text: '攻撃ヒット時、10%で相手を麻痺',
    fx: { onHitAils: [{ key: 'paralyze', chance: 10 }] },
    v1: '追加行動の攻撃ヒット時、30%で相手を麻痺' },
  { boss: 'zerugiasu', kind: 'イヤリング', name: '神雷の環',
    text: 'AGI+10%',
    fx: { statPct: { agi: 10 } },
    v1: '素早さ+10%' },
  { boss: 'enma', kind: '宝珠', name: '冥獄宝珠・断罪',
    text: '攻撃ヒット時、20%で相手を毒',
    fx: { onHitAils: [{ key: 'poison', chance: 20 }] },
    v1: '攻撃ヒット時、20%の確率で相手を毒' },
  { boss: 'enma', kind: '軽装鎧', name: '冥府王の獄衣',
    text: '受けるダメージ−5%\nHPが50%以下のときは、さらに−5%',
    fx: { takenCut: 5, lowHpCut: { at: 50, cut: 5 } },
    v1: '受けるダメージ−5%（HPが半分以下なら−10%）' },
  { boss: 'enma', kind: 'ネックレス', name: '六道輪廻の数珠',
    text: '6ターンごとに、次の攻撃の与ダメージ+30%',
    fx: { burstEvery: { every: 6, pct: 30 } },
    v1: '攻撃力の2%を特殊攻撃力に加算' },
]

// ユニーク（四凶ごとに1つ・2026-11-06）。案のシートでユーザーが決めた（「能力は問題ない」＝シートの案のまま）。
//   kind＝装飾品の種類（4つとも別）・stats＝LV85・強化+0のステ（合計 CHALLENGE_UNIQUE_POINTS）。ステの割り振りはシートの案（65）を69にのばしたもの
//   fx＝戦闘の効果。4つとも新しい項目を足した（src/v2cap/core/battleSet.js の冒頭：lostHpDeal・dodgeAil・breakAil・perAilDeal）
//   名前：雨摩座と閻魔は漢字・黒龍は漢字二字＋カタカナ・ゼルギアスはカタカナ（ユーザー「あまざ・閻魔は漢字、黒龍は今の感じ、ゼルギアスも今の感じで」）
export const CHALLENGE_UNIQUE_DEFS = [
  { boss: 'varuzenoku', kind: 'リング', name: '焔環ツォルン',
    text: '失ったHP10%ごとに、与ダメージ+4%（最大+36%）',
    fx: { lostHpDeal: { per: 10, pct: 4, max: 36 } },
    stats: { str: 21, int_stat: 21, vit: 16, agi: 11 } },
  { boss: 'amaza', kind: 'イヤリング', name: '小糠雨の耳飾り',
    text: '回避+10%\n攻撃をかわしたとき、30%で相手を鈍足',
    fx: { evaBonus: 10, dodgeAil: [{ key: 'slow', chance: 30 }] },
    stats: { agi: 26, dex: 16, vit: 16, int_stat: 11 } },
  { boss: 'zerugiasu', kind: 'ベルト', name: 'ドンナーカイル',
    text: '攻撃ヒット時、20%で麻痺\n麻痺している相手に当てると、麻痺を消して与ダメージ+50%',
    fx: { onHitAils: [{ key: 'paralyze', chance: 20 }], breakAil: { key: 'paralyze', pct: 50 } },
    stats: { dex: 21, agi: 16, str: 16, int_stat: 16 } },
  { boss: 'enma', kind: 'ネックレス', name: '業秤の首飾り',
    text: '相手の状態異常1つにつき、与ダメージ+8%（最大+32%）',
    fx: { perAilDeal: { pct: 8, max: 32 } },
    stats: { int_stat: 21, str: 21, dex: 16, luk: 11 } },
]
