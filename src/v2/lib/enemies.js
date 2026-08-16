// ============================================================
// バトルフロンティアⅡ（リメイク版）— 出撃の敵
// ------------------------------------------------------------
// エリア名・敵の名前・ボスの名前は**旧版から流用**（スキル名と同じ方針）。
// ⚠**旧版の数値は一切使っていない**。向こうはHP・攻撃力が桁で膨らんでいて
//   （エリア⑧のボスがHP280000）、v2のスケール不変なダメージ式と噛み合わない。
//
// ★敵は「戦闘力」を1つ持ち、そこから8ステータスへ配分する（装備と同じ考え方）。
//   戦闘力 = Σ(ステ / unit)。unit は HP=8・MP=3・他=1（stats.js）。
//   なので dist で HP に45%振ると、実際のHPは 戦闘力×0.45×8 になる。
//
// ★ボスの作り方（v2で一番大事なところ）
//   v2は**戦闘力の差がそのまま勝率に出る**（+18%差で勝率95%）。旧版のように
//   ボスのステを盛ると一方的な事故になるだけで「強いボス」にはならない。
//   そこで **戦闘力は目安どおりに置き、配分をHPとVITへ寄せる**。
//   同じ戦闘力でもHPに45%振ればプレイヤーの3〜4倍のHPになり、
//   **スキルセットを一巡させる長さの戦い**になる＝バフを積む・回復を挟む意味が出る。
//
// ★ボスを倒すのに要る目安（2026-08-14 ユーザー決定）
//   ①3転職・D級+0 / ②8転職・C級+1 / ③15転職・B級+2 / ④30転職・B級+3
//   ⑤50転職・A級+4 / ⑥100転職・A級+5 / ⑦200転職・A級+6 / ⑧300転職・A級+7
//   （プレイヤーの戦闘力＝本体534＋転職×100 ＋ 装備 基礎×1.5^強化×7.9）
 //   通常敵はボスの3割程度で、**エリア周回は楽・ボスが壁**という作りにしている。
//
// ⚠**ボスの戦闘力は「目安の合計」そのままではない。** HPへ寄せたボスは同じ戦闘力でも
//   一方的に強くなるため（目安どおりに置いたら勝率0〜29%だった）、実測して係数を掛けている：
//     ①×0.80 ②×0.65 ③×0.70 ④×0.85 ⑤×0.85 ⑥×0.70 ⑦×0.75 ⑧×0.73
//   これで目安の装備・転職回数のときに**勝率6〜7割**（①だけ7割強＝割と簡単）になる。
//   係数がエリアごとに違うのは、ボスの配分（攻撃寄りか耐久寄りか）で難度が変わるため。
// ============================================================
import { STAT_KEYS } from './stats.js'

// 敵のスキル。プレイヤーのスキル（skills.js）と同じ形なので runBattle がそのまま解釈する
// ★状態異常（ail）は**名前どおりの技にだけ**付ける（2026-08-17 ユーザー決定）。
//   ここが空だと敵は状態異常を一切撒かないので、エンチャントの抵抗系
//   （毒キノコ「毒10%軽減」・払暁のワイバーン「全状態異常抵抗+5%」）が
//   何も打ち消すものが無く**完全に無意味**になる。
//   ail = { key, chance }。chance は相手の抵抗を引いてから判定される（battle.js の tryInflict）。
//   ⚠麻痺は「1ターン行動できない」＝一番重いので確率を低く置く。
const S = {
  // --- 攻撃 ---
  たいあたり:   { name:'たいあたり',   kind:'phys', mult:1.3, proc:90, mp:0 },
  かみつく:     { name:'かみつく',     kind:'phys', mult:1.5, proc:85, mp:4,  ail:{ key:'bleed', chance:25 } },
  ひっかく:     { name:'ひっかく',     kind:'phys', mult:1.4, proc:90, mp:3,  ail:{ key:'bleed', chance:20 } },
  どくのほうし: { name:'どくのほうし', kind:'mag',  mult:1.6, proc:85, mp:6,  ail:{ key:'poison', chance:60 } },
  こんぼう:     { name:'こんぼう',     kind:'phys', mult:1.6, proc:85, mp:5 },
  だましうち:   { name:'だましうち',   kind:'phys', mult:1.8, proc:80, mp:8, buff:{ enemy:{ dex:-10 } } },
  ほねきり:     { name:'ほねきり',     kind:'phys', mult:1.7, proc:85, mp:7,  ail:{ key:'bleed', chance:35 } },
  いわなげ:     { name:'いわなげ',     kind:'phys', mult:2.0, proc:75, mp:10 },
  しおのやり:   { name:'潮の槍',       kind:'phys', mult:1.9, proc:80, mp:9 },
  でんげき:     { name:'電撃',         kind:'mag',  mult:2.0, proc:80, mp:10, ail:{ key:'paralyze', chance:12 } },
  つらら:       { name:'つらら',       kind:'mag',  mult:1.9, proc:85, mp:9,  ail:{ key:'slow', chance:30 } },
  かえんだん:   { name:'火炎弾',       kind:'mag',  mult:2.1, proc:80, mp:11 },
  ようがんけん: { name:'溶岩拳',       kind:'phys', mult:2.2, proc:78, mp:12 },
  れっぷうそう: { name:'烈風爪',       kind:'phys', mult:1.5, hits:2, proc:80, mp:11, noCrit:true },
  そうてんとつげき:{ name:'蒼天突撃',  kind:'phys', mult:2.4, proc:75, mp:14 },
  // --- 補助・回復 ---
  かたくなる:   { name:'かたくなる',   kind:'buff', proc:100, mp:5,  buff:{ self:{ vit:30 } }, priority:1 },
  すばやくなる: { name:'すばやくなる', kind:'buff', proc:100, mp:5,  buff:{ self:{ agi:30 } }, priority:1 },
  ちからため:   { name:'ちからため',   kind:'buff', proc:100, mp:6,  buff:{ self:{ str:35 } }, priority:1 },
  まりょくため: { name:'魔力ため',     kind:'buff', proc:100, mp:6,  buff:{ self:{ int_stat:35 } }, priority:1 },
  さけび:       { name:'威嚇の叫び',   kind:'buff', proc:90,  mp:7,  buff:{ enemy:{ str:-15, int_stat:-15 } }, priority:1 },
  じこさいせい: { name:'自己再生',     kind:'heal', proc:80,  mp:14, heal:{ rate:1.6 }, priority:1 },
  // --- ボスの大技（旧版の specialMove から名前を流用）---
  天穿雷撃: { name:'天穿雷撃', kind:'phys', mult:3.2, proc:60, mp:24, buff:{ enemy:{ vit:-25 } }, ail:{ key:'paralyze', chance:20 } },
  氷棺葬送: { name:'氷棺葬送', kind:'mag',  mult:3.4, proc:60, mp:26, buff:{ enemy:{ agi:-30 } }, ail:{ key:'slow', chance:50 } },
  炎獄の審判:{ name:'炎獄の審判', kind:'phys', mult:3.6, proc:58, mp:28, buff:{ enemy:{ vit:-25 } } },
  天墜滅撃: { name:'天墜滅撃', kind:'phys', mult:3.8, proc:55, mp:30, buff:{ enemy:{ vit:-30 } } },
  海嵐の一撃:{ name:'海嵐の一撃', kind:'phys', mult:2.8, proc:65, mp:20 },
  深海波動: { name:'深海波動', kind:'mag',  mult:2.6, proc:70, mp:18 },
  古代の裁き:{ name:'古代の裁き', kind:'mag', mult:2.8, proc:65, mp:20 },
  略奪:     { name:'略奪',     kind:'phys', mult:2.4, proc:70, mp:16, drain:0.3 },
  まるのみ: { name:'まるのみ', kind:'phys', mult:2.2, proc:70, mp:14, drain:0.25 },
}

// timed は**朝・昼・晩の時間帯限定の敵**（各エリア1体ずつ・計24体・v2の新規キャラ）。
// その時間帯だけ通常敵の抽選に加わる。強さは通常敵の最上位の約1.2倍・Goldは約2倍。
// ⚠**配分は「そのキャラに合った性能」で決める。時間帯で決めない**
//   （フクロウは素早い／カニは硬い／セイレーンは魔法、というだけ）
// gold は**旧版の値をそのまま流用**（2026-08-14 ユーザー決定「ゴールドも一旦同じ」）
// gold は**旧版の値をそのまま流用**（2026-08-14 ユーザー決定「ゴールドも一旦同じ」）
// dist は「戦闘力に対する割合(%)」。合計100
// 通常敵は攻撃寄り・ボスはHPとVITへ寄せる
const A = (o) => o   // 見た目をそろえるためだけのヘルパ
export const AREAS = [
  {
    id: 1, name: '始まりの森', dropRanks: { F:40, E:40, D:20 },
    enemies: [
      A({ name:'スライム', power:300, gold:20, kind:'phys', dist:{ hp:38, mp:4, str:16, dex:8, agi:6, int_stat:3, vit:20, luk:5 },
        skills:[S.たいあたり, S.かたくなる] }),
      A({ name:'コウモリ', power:330, gold:25, kind:'phys', dist:{ hp:24, mp:4, str:16, dex:14, agi:28, int_stat:3, vit:6, luk:5 },
        skills:[S.かみつく, S.すばやくなる] }),
      A({ name:'毒キノコ', power:360, gold:30, kind:'mag', dist:{ hp:34, mp:8, str:3, dex:10, agi:3, int_stat:28, vit:9, luk:5 },
        skills:[S.どくのほうし] }),
    ],
    timed: [
      A({ band:'朝', name:'朝露のフェアリー', power:430, gold:60, kind:'mag', dist:{ hp:26, mp:10, str:4, dex:14, agi:22, int_stat:18, vit:3, luk:3 },
        skills:[S.どくのほうし, S.すばやくなる] }),
      A({ band:'昼', name:'ひなたトカゲ', power:430, gold:60, kind:'phys', dist:{ hp:34, mp:4, str:20, dex:10, agi:14, int_stat:3, vit:12, luk:3 },
        skills:[S.かみつく, S.かたくなる] }),
      A({ band:'晩', name:'月夜のフクロウ', power:430, gold:60, kind:'phys', dist:{ hp:24, mp:6, str:18, dex:18, agi:26, int_stat:4, vit:2, luk:2 },
        skills:[S.ひっかく, S.すばやくなる] }),
    ],
    boss: A({ name:'ビッグスライム', power:857, gold:100, kind:'phys', dist:{ hp:45, mp:6, str:14, dex:8, agi:5, int_stat:3, vit:16, luk:3 },
      skills:[S.たいあたり, S.かたくなる, S.まるのみ, S.じこさいせい] }),
  },
  {
    id: 2, name: '荒廃した草原', dropRanks: { F:35, E:30, D:22, C:13 },
    enemies: [
      A({ name:'ゴブリン', power:500, gold:40, kind:'phys', dist:{ hp:30, mp:5, str:22, dex:12, agi:14, int_stat:3, vit:9, luk:5 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ name:'野良犬', power:540, gold:50, kind:'phys', dist:{ hp:26, mp:4, str:20, dex:12, agi:26, int_stat:2, vit:6, luk:4 },
        skills:[S.かみつく, S.すばやくなる] }),
      A({ name:'盗賊', power:600, gold:60, kind:'phys', dist:{ hp:26, mp:6, str:20, dex:20, agi:18, int_stat:3, vit:5, luk:2 },
        skills:[S.だましうち, S.すばやくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'朝霧のワーム', power:720, gold:120, kind:'phys', dist:{ hp:36, mp:5, str:22, dex:8, agi:8, int_stat:3, vit:15, luk:3 },
        skills:[S.かみつく, S.かたくなる] }),
      A({ band:'昼', name:'陽炎リザード', power:720, gold:120, kind:'phys', dist:{ hp:28, mp:6, str:22, dex:14, agi:20, int_stat:4, vit:4, luk:2 },
        skills:[S.ひっかく, S.すばやくなる] }),
      A({ band:'晩', name:'夜盗の斥候', power:720, gold:120, kind:'phys', dist:{ hp:26, mp:7, str:20, dex:22, agi:18, int_stat:3, vit:2, luk:2 },
        skills:[S.だましうち, S.すばやくなる] }),
    ],
    boss: A({ name:'盗賊団のリーダー', power:1175, gold:500, kind:'phys', dist:{ hp:42, mp:7, str:18, dex:12, agi:9, int_stat:3, vit:6, luk:3 },
      skills:[S.だましうち, S.ちからため, S.略奪, S.さけび, S.じこさいせい] }),
  },
  {
    id: 3, name: '古代の洞窟', dropRanks: { F:30, E:28, D:24, C:13, B:5 },
    enemies: [
      A({ name:'コボルト', power:820, gold:80, kind:'phys', dist:{ hp:28, mp:5, str:24, dex:14, agi:14, int_stat:3, vit:8, luk:4 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ name:'スケルトン', power:880, gold:100, kind:'phys', dist:{ hp:30, mp:5, str:20, dex:12, agi:10, int_stat:5, vit:14, luk:4 },
        skills:[S.ほねきり, S.かたくなる] }),
      A({ name:'ゴーレム', power:960, gold:120, kind:'phys', dist:{ hp:34, mp:4, str:22, dex:6, agi:4, int_stat:2, vit:24, luk:4 },
        skills:[S.いわなげ, S.かたくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'曙のガーゴイル', power:1150, gold:240, kind:'phys', dist:{ hp:32, mp:5, str:24, dex:10, agi:8, int_stat:3, vit:15, luk:3 },
        skills:[S.いわなげ, S.かたくなる] }),
      A({ band:'昼', name:'石化トカゲ', power:1150, gold:240, kind:'phys', dist:{ hp:34, mp:4, str:20, dex:8, agi:6, int_stat:2, vit:23, luk:3 },
        skills:[S.ほねきり, S.かたくなる] }),
      A({ band:'晩', name:'夜這うレイス', power:1150, gold:240, kind:'mag', dist:{ hp:28, mp:10, str:3, dex:12, agi:16, int_stat:26, vit:3, luk:2 },
        skills:[S.でんげき, S.まりょくため] }),
    ],
    boss: A({ name:'古代の番人', power:2046, gold:2000, kind:'mag', dist:{ hp:42, mp:7, str:4, dex:9, agi:7, int_stat:18, vit:10, luk:3 },
      skills:[S.古代の裁き, S.まりょくため, S.でんげき, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 4, name: '蒼海の入り江', dropRanks: { F:26, E:26, D:23, C:15, B:10 },
    enemies: [
      A({ name:'深海魚人', power:1350, gold:150, kind:'phys', dist:{ hp:32, mp:5, str:21, dex:11, agi:11, int_stat:4, vit:12, luk:4 },
        skills:[S.しおのやり, S.かたくなる] }),
      A({ name:'海賊', power:1450, gold:200, kind:'phys', dist:{ hp:28, mp:6, str:24, dex:16, agi:16, int_stat:3, vit:5, luk:2 },
        skills:[S.だましうち, S.ちからため] }),
      A({ name:'毒クラゲ', power:1300, gold:175, kind:'mag', dist:{ hp:34, mp:9, str:3, dex:9, agi:8, int_stat:24, vit:10, luk:3 },
        skills:[S.どくのほうし, S.まりょくため] }),
    ],
    timed: [
      A({ band:'朝', name:'朝凪のセイレーン', power:1740, gold:400, kind:'mag', dist:{ hp:28, mp:10, str:3, dex:12, agi:16, int_stat:26, vit:3, luk:2 },
        skills:[S.どくのほうし, S.まりょくため] }),
      A({ band:'昼', name:'潮騒のカニ', power:1740, gold:400, kind:'phys', dist:{ hp:34, mp:4, str:22, dex:8, agi:6, int_stat:2, vit:21, luk:3 },
        skills:[S.しおのやり, S.かたくなる] }),
      A({ band:'晩', name:'夜光アンコウ', power:1740, gold:400, kind:'phys', dist:{ hp:30, mp:8, str:18, dex:12, agi:12, int_stat:14, vit:4, luk:2 },
        skills:[S.かみつく, S.でんげき] }),
    ],
    boss: A({ name:'シーサーペント', power:4137, gold:5000, kind:'phys', dist:{ hp:45, mp:6, str:15, dex:9, agi:7, int_stat:4, vit:11, luk:3 },
      skills:[S.海嵐の一撃, S.深海波動, S.ちからため, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 5, name: '巨峰山脈', dropRanks: { E:38, D:30, C:20, B:9, A:3 },
    enemies: [
      A({ name:'山岳ゴブリン', power:2200, gold:240, kind:'phys', dist:{ hp:30, mp:5, str:26, dex:12, agi:13, int_stat:3, vit:8, luk:3 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ name:'岩石ゴーレム', power:2500, gold:300, kind:'phys', dist:{ hp:34, mp:4, str:23, dex:6, agi:4, int_stat:2, vit:24, luk:3 },
        skills:[S.いわなげ, S.かたくなる] }),
      A({ name:'グリフォン', power:2350, gold:270, kind:'phys', dist:{ hp:26, mp:5, str:22, dex:14, agi:25, int_stat:3, vit:3, luk:2 },
        skills:[S.ひっかく, S.すばやくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'払暁のワイバーン', power:3000, gold:600, kind:'phys', dist:{ hp:28, mp:7, str:25, dex:12, agi:20, int_stat:5, vit:1, luk:2 },
        skills:[S.れっぷうそう, S.ちからため] }),
      A({ band:'昼', name:'陽射しの大猿', power:3000, gold:600, kind:'phys', dist:{ hp:33, mp:5, str:27, dex:10, agi:11, int_stat:2, vit:9, luk:3 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ band:'晩', name:'宵闇の山猫', power:3000, gold:600, kind:'phys', dist:{ hp:25, mp:6, str:23, dex:16, agi:26, int_stat:2, vit:1, luk:1 },
        skills:[S.ひっかく, S.すばやくなる] }),
    ],
    boss: A({ name:'雷鷲サンダーロック', power:6744, gold:9000, kind:'phys', dist:{ hp:40, mp:7, str:16, dex:10, agi:12, int_stat:3, vit:9, luk:3 },
      skills:[S.天穿雷撃, S.でんげき, S.すばやくなる, S.ちからため, S.じこさいせい] }),
  },
  {
    id: 6, name: '白銀の霊峰', dropRanks: { E:33, D:29, C:21, B:11, A:6 },
    enemies: [
      A({ name:'雪男', power:4000, gold:350, kind:'phys', dist:{ hp:32, mp:5, str:26, dex:10, agi:10, int_stat:3, vit:11, luk:3 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ name:'氷河ドラゴン', power:4400, gold:450, kind:'phys', dist:{ hp:30, mp:7, str:22, dex:11, agi:12, int_stat:9, vit:6, luk:3 },
        skills:[S.つらら, S.かみつく, S.かたくなる] }),
      A({ name:'霜の精霊', power:3900, gold:400, kind:'mag', dist:{ hp:30, mp:10, str:3, dex:10, agi:10, int_stat:28, vit:6, luk:3 },
        skills:[S.つらら, S.まりょくため] }),
    ],
    timed: [
      A({ band:'朝', name:'朝焼けの氷狼', power:5280, gold:900, kind:'phys', dist:{ hp:28, mp:6, str:26, dex:13, agi:21, int_stat:3, vit:1, luk:2 },
        skills:[S.かみつく, S.すばやくなる] }),
      A({ band:'昼', name:'白光の樹氷精', power:5280, gold:900, kind:'mag', dist:{ hp:29, mp:10, str:2, dex:10, agi:10, int_stat:28, vit:9, luk:2 },
        skills:[S.つらら, S.まりょくため] }),
      A({ band:'晩', name:'極夜のワイト', power:5280, gold:900, kind:'phys', dist:{ hp:33, mp:8, str:20, dex:10, agi:9, int_stat:12, vit:6, luk:2 },
        skills:[S.ほねきり, S.つらら, S.かたくなる] }),
    ],
    boss: A({ name:'氷霊フロストバーン', power:9893, gold:18750, kind:'mag', dist:{ hp:42, mp:8, str:3, dex:9, agi:7, int_stat:19, vit:9, luk:3 },
      skills:[S.氷棺葬送, S.つらら, S.まりょくため, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 7, name: '煉獄火山', dropRanks: { D:40, C:30, B:20, A:10 },
    enemies: [
      A({ name:'炎の精霊', power:7000, gold:500, kind:'mag', dist:{ hp:30, mp:10, str:3, dex:11, agi:11, int_stat:27, vit:5, luk:3 },
        skills:[S.かえんだん, S.まりょくため] }),
      A({ name:'溶岩ゴーレム', power:7800, gold:600, kind:'phys', dist:{ hp:34, mp:5, str:25, dex:7, agi:5, int_stat:3, vit:20, luk:1 },
        skills:[S.ようがんけん, S.かたくなる] }),
      A({ name:'ファイアドレイク', power:7400, gold:550, kind:'phys', dist:{ hp:28, mp:8, str:24, dex:13, agi:15, int_stat:7, vit:3, luk:2 },
        skills:[S.れっぷうそう, S.かえんだん, S.ちからため] }),
    ],
    timed: [
      A({ band:'朝', name:'暁のフレイムバット', power:9360, gold:1200, kind:'phys', dist:{ hp:26, mp:8, str:22, dex:14, agi:24, int_stat:3, vit:1, luk:2 },
        skills:[S.れっぷうそう, S.すばやくなる] }),
      A({ band:'昼', name:'陽炎のイフリート', power:9360, gold:1200, kind:'mag', dist:{ hp:30, mp:11, str:3, dex:11, agi:12, int_stat:28, vit:3, luk:2 },
        skills:[S.かえんだん, S.まりょくため] }),
      A({ band:'晩', name:'熾火のデーモン', power:9360, gold:1200, kind:'phys', dist:{ hp:32, mp:7, str:26, dex:11, agi:10, int_stat:5, vit:7, luk:2 },
        skills:[S.ようがんけん, S.ちからため] }),
    ],
    boss: A({ name:'深紅のサラマンダー', power:19450, gold:37500, kind:'phys', dist:{ hp:43, mp:7, str:16, dex:9, agi:8, int_stat:4, vit:10, luk:3 },
      skills:[S.炎獄の審判, S.ようがんけん, S.かえんだん, S.ちからため, S.じこさいせい] }),
  },
  {
    id: 8, name: '蒼天の浮遊城', dropRanks: { D:35, C:29, B:22, A:14 },
    enemies: [
      A({ name:'天翼のハーピー', power:11000, gold:700, kind:'phys', dist:{ hp:25, mp:6, str:22, dex:15, agi:27, int_stat:2, vit:1, luk:2 },
        skills:[S.れっぷうそう, S.すばやくなる] }),
      A({ name:'雷雲の精霊', power:11500, gold:750, kind:'mag', dist:{ hp:30, mp:10, str:2, dex:11, agi:12, int_stat:27, vit:5, luk:3 },
        skills:[S.でんげき, S.まりょくため] }),
      A({ name:'天空騎士グリフィオン', power:12500, gold:800, kind:'phys', dist:{ hp:31, mp:6, str:25, dex:13, agi:11, int_stat:3, vit:9, luk:2 },
        skills:[S.そうてんとつげき, S.ちからため, S.かたくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'曙光のセラフ', power:15000, gold:1600, kind:'mag', dist:{ hp:30, mp:11, str:3, dex:12, agi:13, int_stat:28, vit:1, luk:2 },
        skills:[S.でんげき, S.まりょくため] }),
      A({ band:'昼', name:'白昼のペガサス', power:15000, gold:1600, kind:'phys', dist:{ hp:28, mp:7, str:24, dex:14, agi:24, int_stat:2, vit:0, luk:1 },
        skills:[S.れっぷうそう, S.すばやくなる] }),
      A({ band:'晩', name:'星降りのヴァルキリー', power:15000, gold:1600, kind:'phys', dist:{ hp:29, mp:8, str:26, dex:14, agi:13, int_stat:4, vit:4, luk:2 },
        skills:[S.そうてんとつげき, S.ちからため] }),
    ],
    boss: A({ name:'天空覇龍ウラノス', power:28202, gold:60000, kind:'phys', dist:{ hp:44, mp:7, str:16, dex:9, agi:8, int_stat:4, vit:9, luk:3 },
      skills:[S.天墜滅撃, S.そうてんとつげき, S.でんげき, S.ちからため, S.じこさいせい] }),
  },
]

// 戦闘力と配分から実際のステータスを作る
// stats.js の unit（HP=8・MP=3・他=1）を掛け戻す
const UNIT = { hp:8, mp:3 }
export const statsOf = (enemy) => {
  const out = {}
  for (const k of STAT_KEYS) {
    const pct = enemy.dist[k] || 0
    out[k] = Math.max(1, Math.round(enemy.power * (pct / 100) * (UNIT[k] || 1)))
  }
  return out
}

// runBattle にそのまま渡せる形にする。uses は「1回の戦闘で何回使えるか」
export const toFighter = (enemy, uses = 4) => ({
  name: enemy.name,
  kind: enemy.kind,
  stats: statsOf(enemy),
  slots: enemy.skills.map(s => ({ skill: s, uses })),
})

export const areaOf = (id) => AREAS.find(a => a.id === id) || null
export const allEnemies = () => AREAS.flatMap(a => [...a.enemies, ...(a.timed || []), a.boss])
export const timedEnemyOf = (area, band) => (area?.timed || []).find(e => e.band === band) || null

// ドロップするランクを1つ抽選する
export const rollDropRank = (area, rng = Math.random) => {
  const entries = Object.entries(area.dropRanks)
  let r = rng() * entries.reduce((t, [, v]) => t + v, 0)
  for (const [rank, w] of entries) { r -= w; if (r <= 0) return rank }
  return entries[entries.length - 1][0]
}
