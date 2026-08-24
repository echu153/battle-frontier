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
// ★ATBの仮想敵（atbDummy.js）も同じ表から技を借りる。外へ出しているだけで中身は変えていない
export const ENEMY_SKILLS = {
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
  どくばり:     { name:'毒針',         kind:'phys', mult:1.6, proc:85, mp:7,  ail:{ key:'poison', chance:45 } },
  すなあらし:   { name:'砂嵐',         kind:'mag',  mult:1.8, proc:82, mp:8,  ail:{ key:'slow', chance:25 } },
  ほうたい:     { name:'呪縛の包帯',   kind:'phys', mult:1.6, proc:85, mp:7,  ail:{ key:'paralyze', chance:10 } },
  どくのきり:   { name:'毒の霧',       kind:'mag',  mult:1.7, proc:85, mp:8,  ail:{ key:'poison', chance:50 } },
  つるのむち:   { name:'蔓の鞭',       kind:'phys', mult:1.6, proc:85, mp:6,  ail:{ key:'slow', chance:20 } },
  きょうきのぜっきょう:{ name:'狂気の絶叫', kind:'mag', mult:2.1, proc:78, mp:12, buff:{ enemy:{ int_stat:-20 } } },
  らくらい:     { name:'落雷',         kind:'mag',  mult:2.2, proc:78, mp:12, ail:{ key:'paralyze', chance:15 } },
  かぜのやいば: { name:'風の刃',       kind:'phys', mult:1.5, hits:2, proc:82, mp:10, noCrit:true },
  じわれ:       { name:'地割れ',       kind:'phys', mult:2.1, proc:75, mp:11 },
  しょくしゅ:   { name:'触手',         kind:'phys', mult:1.8, proc:82, mp:9,  drain:0.2 },
  ほしくず:     { name:'星屑の雨',     kind:'mag',  mult:2.0, proc:80, mp:11 },
  しんえんのめ: { name:'深淵の眼',     kind:'mag',  mult:2.3, proc:75, mp:13, ail:{ key:'slow', chance:30 } },
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
  砂塵葬送: { name:'砂塵葬送', kind:'phys', mult:3.0, proc:62, mp:22, buff:{ enemy:{ agi:-25 } }, ail:{ key:'slow', chance:40 } },
  樹海縛鎖: { name:'樹海縛鎖', kind:'phys', mult:3.1, proc:60, mp:24, buff:{ enemy:{ agi:-30 } }, ail:{ key:'paralyze', chance:15 } },
  天雷万鈞: { name:'天雷万鈞', kind:'mag',  mult:3.3, proc:60, mp:26, buff:{ enemy:{ agi:-20 } }, ail:{ key:'paralyze', chance:25 } },
  腐蝕溶解: { name:'腐蝕溶解', kind:'mag',  mult:3.4, proc:58, mp:28, buff:{ enemy:{ vit:-25 } }, ail:{ key:'poison', chance:70 } },
  崩落震撼: { name:'崩落震撼', kind:'phys', mult:3.5, proc:58, mp:28, buff:{ enemy:{ agi:-25, vit:-15 } } },
  星辰崩落: { name:'星辰崩落', kind:'mag',  mult:3.7, proc:55, mp:30, buff:{ enemy:{ int_stat:-25 } }, ail:{ key:'slow', chance:45 } },
  深淵咆哮: { name:'深淵咆哮', kind:'phys', mult:3.6, proc:56, mp:29, buff:{ enemy:{ vit:-25 } }, drain:0.25 },
  略奪:     { name:'略奪',     kind:'phys', mult:2.4, proc:70, mp:16, drain:0.3 },
  まるのみ: { name:'まるのみ', kind:'phys', mult:2.2, proc:70, mp:14, drain:0.25 },
}

const S = ENEMY_SKILLS

// timed は**朝・昼・晩の時間帯限定の敵**（各エリア1体ずつ・計24体・v2の新規キャラ）。
// その時間帯だけ通常敵の抽選に加わる。強さは通常敵の最上位の約1.2倍。
// ⚠**配分は「そのキャラに合った性能」で決める。時間帯で決めない**
//   （フクロウは素早い／カニは硬い／セイレーンは魔法、というだけ）
//
// ★**敵はGoldを落とさない**（2026-08-17 ユーザー決定・docs/v2-gold-design.md）。
//   旧版から流用していた gold は**全部消した**。Goldはルーン素材をNPCへ売って稼ぐ
//   （material.js の SELL_BASE）。ボスも同じで、倒しても入るのはEXPと装備とエリア解放だけ
// dist は「戦闘力に対する割合(%)」。合計100
// 通常敵は攻撃寄り・ボスはHPとVITへ寄せる
const A = (o) => o   // 見た目をそろえるためだけのヘルパ
export const AREAS = [
  {
    id: 1, tier: 1, bias: null, name: '始まりの森', dropRanks: { F:40, E:40, D:20 },
    enemies: [
      A({ name:'スライム', power:300, kind:'phys', dist:{ hp:38, mp:4, str:16, dex:8, agi:6, int_stat:3, vit:20, luk:5 },
        skills:[S.たいあたり, S.かたくなる] }),
      A({ name:'コウモリ', power:330, kind:'phys', dist:{ hp:24, mp:4, str:16, dex:14, agi:28, int_stat:3, vit:6, luk:5 },
        skills:[S.かみつく, S.すばやくなる] }),
      A({ name:'毒キノコ', power:360, kind:'mag', dist:{ hp:34, mp:8, str:3, dex:10, agi:3, int_stat:28, vit:9, luk:5 },
        skills:[S.どくのほうし] }),
    ],
    timed: [
      A({ band:'朝', name:'朝露のフェアリー', power:430, kind:'mag', dist:{ hp:26, mp:10, str:4, dex:14, agi:22, int_stat:18, vit:3, luk:3 },
        skills:[S.どくのほうし, S.すばやくなる] }),
      A({ band:'昼', name:'ひなたトカゲ', power:430, kind:'phys', dist:{ hp:34, mp:4, str:20, dex:10, agi:14, int_stat:3, vit:12, luk:3 },
        skills:[S.かみつく, S.かたくなる] }),
      A({ band:'晩', name:'月夜のフクロウ', power:430, kind:'phys', dist:{ hp:24, mp:6, str:18, dex:18, agi:26, int_stat:4, vit:2, luk:2 },
        skills:[S.ひっかく, S.すばやくなる] }),
    ],
    boss: A({ name:'ビッグスライム', power:857, kind:'phys', dist:{ hp:45, mp:6, str:14, dex:8, agi:5, int_stat:3, vit:16, luk:3 },
      skills:[S.たいあたり, S.かたくなる, S.まるのみ, S.じこさいせい] }),
  },
  {
    id: 2, tier: 2, bias: null, name: '荒廃した草原', dropRanks: { F:35, E:30, D:22, C:13 },
    enemies: [
      A({ name:'ゴブリン', power:500, kind:'phys', dist:{ hp:30, mp:5, str:22, dex:12, agi:14, int_stat:3, vit:9, luk:5 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ name:'野良犬', power:540, kind:'phys', dist:{ hp:26, mp:4, str:20, dex:12, agi:26, int_stat:2, vit:6, luk:4 },
        skills:[S.かみつく, S.すばやくなる] }),
      A({ name:'盗賊', power:600, kind:'phys', dist:{ hp:26, mp:6, str:20, dex:20, agi:18, int_stat:3, vit:5, luk:2 },
        skills:[S.だましうち, S.すばやくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'朝霧のワーム', power:720, kind:'phys', dist:{ hp:36, mp:5, str:22, dex:8, agi:8, int_stat:3, vit:15, luk:3 },
        skills:[S.かみつく, S.かたくなる] }),
      A({ band:'昼', name:'陽炎リザード', power:720, kind:'phys', dist:{ hp:28, mp:6, str:22, dex:14, agi:20, int_stat:4, vit:4, luk:2 },
        skills:[S.ひっかく, S.すばやくなる] }),
      A({ band:'晩', name:'夜盗の斥候', power:720, kind:'phys', dist:{ hp:26, mp:7, str:20, dex:22, agi:18, int_stat:3, vit:2, luk:2 },
        skills:[S.だましうち, S.すばやくなる] }),
    ],
    boss: A({ name:'盗賊団のリーダー', power:1175, kind:'phys', dist:{ hp:42, mp:7, str:18, dex:12, agi:9, int_stat:3, vit:6, luk:3 },
      skills:[S.だましうち, S.ちからため, S.略奪, S.さけび, S.じこさいせい] }),
  },
  {
    id: 3, tier: 3, bias: null, name: '古代の洞窟', dropRanks: { F:30, E:28, D:24, C:13, B:5 },
    enemies: [
      A({ name:'コボルト', power:820, kind:'phys', dist:{ hp:28, mp:5, str:24, dex:14, agi:14, int_stat:3, vit:8, luk:4 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ name:'スケルトン', power:880, kind:'phys', dist:{ hp:30, mp:5, str:20, dex:12, agi:10, int_stat:5, vit:14, luk:4 },
        skills:[S.ほねきり, S.かたくなる] }),
      A({ name:'ゴーレム', power:960, kind:'phys', dist:{ hp:34, mp:4, str:22, dex:6, agi:4, int_stat:2, vit:24, luk:4 },
        skills:[S.いわなげ, S.かたくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'曙のガーゴイル', power:1150, kind:'phys', dist:{ hp:32, mp:5, str:24, dex:10, agi:8, int_stat:3, vit:15, luk:3 },
        skills:[S.いわなげ, S.かたくなる] }),
      A({ band:'昼', name:'石化トカゲ', power:1150, kind:'phys', dist:{ hp:34, mp:4, str:20, dex:8, agi:6, int_stat:2, vit:23, luk:3 },
        skills:[S.ほねきり, S.かたくなる] }),
      A({ band:'晩', name:'夜這うレイス', power:1150, kind:'mag', dist:{ hp:28, mp:10, str:3, dex:12, agi:16, int_stat:26, vit:3, luk:2 },
        skills:[S.でんげき, S.まりょくため] }),
    ],
    boss: A({ name:'古代の番人', power:2046, kind:'mag', dist:{ hp:42, mp:7, str:4, dex:9, agi:7, int_stat:18, vit:10, luk:3 },
      skills:[S.古代の裁き, S.まりょくため, S.でんげき, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 4, tier: 4, bias: 'phys', name: '蒼海の入り江', dropRanks: { F:26, E:26, D:23, C:15, B:10 },
    enemies: [
      A({ name:'深海魚人', power:1350, kind:'phys', dist:{ hp:32, mp:5, str:21, dex:11, agi:11, int_stat:4, vit:12, luk:4 },
        skills:[S.しおのやり, S.かたくなる] }),
      A({ name:'海賊', power:1450, kind:'phys', dist:{ hp:28, mp:6, str:24, dex:16, agi:16, int_stat:3, vit:5, luk:2 },
        skills:[S.だましうち, S.ちからため] }),
      A({ name:'毒クラゲ', power:1300, kind:'mag', dist:{ hp:34, mp:9, str:3, dex:9, agi:8, int_stat:24, vit:10, luk:3 },
        skills:[S.どくのほうし, S.まりょくため] }),
    ],
    timed: [
      A({ band:'朝', name:'朝凪のセイレーン', power:1740, kind:'mag', dist:{ hp:28, mp:10, str:3, dex:12, agi:16, int_stat:26, vit:3, luk:2 },
        skills:[S.どくのほうし, S.まりょくため] }),
      A({ band:'昼', name:'潮騒のカニ', power:1740, kind:'phys', dist:{ hp:34, mp:4, str:22, dex:8, agi:6, int_stat:2, vit:21, luk:3 },
        skills:[S.しおのやり, S.かたくなる] }),
      A({ band:'晩', name:'夜光アンコウ', power:1740, kind:'phys', dist:{ hp:30, mp:8, str:18, dex:12, agi:12, int_stat:14, vit:4, luk:2 },
        skills:[S.かみつく, S.でんげき] }),
    ],
    boss: A({ name:'シーサーペント', power:4137, kind:'phys', dist:{ hp:45, mp:6, str:15, dex:9, agi:7, int_stat:4, vit:11, luk:3 },
      skills:[S.海嵐の一撃, S.深海波動, S.ちからため, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 5, tier: 5, bias: 'phys', name: '巨峰山脈', dropRanks: { E:38, D:30, C:20, B:9, A:3 },
    enemies: [
      A({ name:'山岳ゴブリン', power:2200, kind:'phys', dist:{ hp:30, mp:5, str:26, dex:12, agi:13, int_stat:3, vit:8, luk:3 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ name:'岩石ゴーレム', power:2500, kind:'phys', dist:{ hp:34, mp:4, str:23, dex:6, agi:4, int_stat:2, vit:24, luk:3 },
        skills:[S.いわなげ, S.かたくなる] }),
      A({ name:'グリフォン', power:2350, kind:'phys', dist:{ hp:26, mp:5, str:22, dex:14, agi:25, int_stat:3, vit:3, luk:2 },
        skills:[S.ひっかく, S.すばやくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'払暁のワイバーン', power:3000, kind:'phys', dist:{ hp:28, mp:7, str:25, dex:12, agi:20, int_stat:5, vit:1, luk:2 },
        skills:[S.れっぷうそう, S.ちからため] }),
      A({ band:'昼', name:'陽射しの大猿', power:3000, kind:'phys', dist:{ hp:33, mp:5, str:27, dex:10, agi:11, int_stat:2, vit:9, luk:3 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ band:'晩', name:'宵闇の山猫', power:3000, kind:'phys', dist:{ hp:25, mp:6, str:23, dex:16, agi:26, int_stat:2, vit:1, luk:1 },
        skills:[S.ひっかく, S.すばやくなる] }),
    ],
    boss: A({ name:'雷鷲サンダーロック', power:6744, kind:'phys', dist:{ hp:40, mp:7, str:16, dex:10, agi:12, int_stat:3, vit:9, luk:3 },
      skills:[S.天穿雷撃, S.でんげき, S.すばやくなる, S.ちからため, S.じこさいせい] }),
  },
  {
    id: 6, tier: 6, bias: 'phys', name: '白銀の霊峰', dropRanks: { E:33, D:29, C:21, B:11, A:6 },
    enemies: [
      A({ name:'雪男', power:4000, kind:'phys', dist:{ hp:32, mp:5, str:26, dex:10, agi:10, int_stat:3, vit:11, luk:3 },
        skills:[S.こんぼう, S.ちからため] }),
      A({ name:'氷河ドラゴン', power:4400, kind:'phys', dist:{ hp:30, mp:7, str:22, dex:11, agi:12, int_stat:9, vit:6, luk:3 },
        skills:[S.つらら, S.かみつく, S.かたくなる] }),
      A({ name:'霜の精霊', power:3900, kind:'mag', dist:{ hp:30, mp:10, str:3, dex:10, agi:10, int_stat:28, vit:6, luk:3 },
        skills:[S.つらら, S.まりょくため] }),
    ],
    timed: [
      A({ band:'朝', name:'朝焼けの氷狼', power:5280, kind:'phys', dist:{ hp:28, mp:6, str:26, dex:13, agi:21, int_stat:3, vit:1, luk:2 },
        skills:[S.かみつく, S.すばやくなる] }),
      A({ band:'昼', name:'白光の樹氷精', power:5280, kind:'mag', dist:{ hp:29, mp:10, str:2, dex:10, agi:10, int_stat:28, vit:9, luk:2 },
        skills:[S.つらら, S.まりょくため] }),
      A({ band:'晩', name:'極夜のワイト', power:5280, kind:'phys', dist:{ hp:33, mp:8, str:20, dex:10, agi:9, int_stat:12, vit:6, luk:2 },
        skills:[S.ほねきり, S.つらら, S.かたくなる] }),
    ],
    boss: A({ name:'氷霊フロストバーン', power:9893, kind:'mag', dist:{ hp:42, mp:8, str:3, dex:9, agi:7, int_stat:19, vit:9, luk:3 },
      skills:[S.氷棺葬送, S.つらら, S.まりょくため, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 7, tier: 7, bias: 'phys', name: '煉獄火山', dropRanks: { D:40, C:30, B:20, A:10 },
    enemies: [
      A({ name:'炎の精霊', power:7000, kind:'mag', dist:{ hp:30, mp:10, str:3, dex:11, agi:11, int_stat:27, vit:5, luk:3 },
        skills:[S.かえんだん, S.まりょくため] }),
      A({ name:'溶岩ゴーレム', power:7800, kind:'phys', dist:{ hp:34, mp:5, str:25, dex:7, agi:5, int_stat:3, vit:20, luk:1 },
        skills:[S.ようがんけん, S.かたくなる] }),
      A({ name:'ファイアドレイク', power:7400, kind:'phys', dist:{ hp:28, mp:8, str:24, dex:13, agi:15, int_stat:7, vit:3, luk:2 },
        skills:[S.れっぷうそう, S.かえんだん, S.ちからため] }),
    ],
    timed: [
      A({ band:'朝', name:'暁のフレイムバット', power:9360, kind:'phys', dist:{ hp:26, mp:8, str:22, dex:14, agi:24, int_stat:3, vit:1, luk:2 },
        skills:[S.れっぷうそう, S.すばやくなる] }),
      A({ band:'昼', name:'陽炎のイフリート', power:9360, kind:'mag', dist:{ hp:30, mp:11, str:3, dex:11, agi:12, int_stat:28, vit:3, luk:2 },
        skills:[S.かえんだん, S.まりょくため] }),
      A({ band:'晩', name:'熾火のデーモン', power:9360, kind:'phys', dist:{ hp:32, mp:7, str:26, dex:11, agi:10, int_stat:5, vit:7, luk:2 },
        skills:[S.ようがんけん, S.ちからため] }),
    ],
    boss: A({ name:'深紅のサラマンダー', power:19450, kind:'phys', dist:{ hp:43, mp:7, str:16, dex:9, agi:8, int_stat:4, vit:10, luk:3 },
      skills:[S.炎獄の審判, S.ようがんけん, S.かえんだん, S.ちからため, S.じこさいせい] }),
  },
  {
    id: 8, tier: 8, bias: 'phys', name: '蒼天の浮遊城', dropRanks: { D:35, C:29, B:22, A:14 },
    enemies: [
      A({ name:'天翼のハーピー', power:11000, kind:'phys', dist:{ hp:25, mp:6, str:22, dex:15, agi:27, int_stat:2, vit:1, luk:2 },
        skills:[S.れっぷうそう, S.すばやくなる] }),
      A({ name:'雷雲の精霊', power:11500, kind:'mag', dist:{ hp:30, mp:10, str:2, dex:11, agi:12, int_stat:27, vit:5, luk:3 },
        skills:[S.でんげき, S.まりょくため] }),
      A({ name:'天空騎士グリフィオン', power:12500, kind:'phys', dist:{ hp:31, mp:6, str:25, dex:13, agi:11, int_stat:3, vit:9, luk:2 },
        skills:[S.そうてんとつげき, S.ちからため, S.かたくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'曙光のセラフ', power:15000, kind:'mag', dist:{ hp:30, mp:11, str:3, dex:12, agi:13, int_stat:28, vit:1, luk:2 },
        skills:[S.でんげき, S.まりょくため] }),
      A({ band:'昼', name:'白昼のペガサス', power:15000, kind:'phys', dist:{ hp:28, mp:7, str:24, dex:14, agi:24, int_stat:2, vit:0, luk:1 },
        skills:[S.れっぷうそう, S.すばやくなる] }),
      A({ band:'晩', name:'星降りのヴァルキリー', power:15000, kind:'phys', dist:{ hp:29, mp:8, str:26, dex:14, agi:13, int_stat:4, vit:4, luk:2 },
        skills:[S.そうてんとつげき, S.ちからため] }),
    ],
    boss: A({ name:'天空覇龍ウラノス', power:28202, kind:'phys', dist:{ hp:44, mp:7, str:16, dex:9, agi:8, int_stat:4, vit:9, luk:3 },
      skills:[S.天墜滅撃, S.そうてんとつげき, S.でんげき, S.ちからため, S.じこさいせい] }),
  },
  // ============================================================
  // ★ここから下は**同じ難易度帯のもう1つのエリア**（2026-08-22 ユーザー決定）。
  //   ④⑤⑥は2エリア・⑦⑧は3エリアあり、**その帯を全部踏破すると次の帯が開く**。
  //   強さ・ドロップ範囲は同じ帯の既存エリアと**同格**にしてある（テーマと敵だけ違う）。
  //   ⚠ id は続き番号（9〜15）。難易度は id ではなく **tier** で決まる
  // ============================================================
  {
    id: 9, tier: 4, bias: 'mag', name: '灼砂の遺丘', dropRanks: { F:26, E:26, D:23, C:15, B:10 },
    enemies: [
      A({ name:'砂喰いワーム', power:1400, kind:'phys', dist:{ hp:34, mp:4, str:22, dex:8, agi:8, int_stat:3, vit:17, luk:4 },
        skills:[S.かみつく, S.かたくなる] }),
      A({ name:'墓守のミイラ', power:1320, kind:'phys', dist:{ hp:33, mp:5, str:21, dex:12, agi:6, int_stat:4, vit:15, luk:4 },
        skills:[S.ほうたい, S.かたくなる] }),
      A({ name:'砂蠍サンドスコーピオン', power:1380, kind:'phys', dist:{ hp:28, mp:5, str:23, dex:16, agi:18, int_stat:3, vit:5, luk:2 },
        skills:[S.どくばり, S.すばやくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'陽炎のミラージュ', power:1740, kind:'mag', dist:{ hp:26, mp:10, str:3, dex:12, agi:20, int_stat:26, vit:1, luk:2 },
        skills:[S.すなあらし, S.まりょくため] }),
      A({ band:'昼', name:'灼熱のアヌビス', power:1740, kind:'phys', dist:{ hp:30, mp:6, str:24, dex:12, agi:12, int_stat:4, vit:10, luk:2 },
        skills:[S.ほうたい, S.ちからため] }),
      A({ band:'晩', name:'月砂のジャッカル', power:1740, kind:'phys', dist:{ hp:26, mp:6, str:22, dex:14, agi:26, int_stat:2, vit:2, luk:2 },
        skills:[S.かみつく, S.すばやくなる] }),
    ],
    boss: A({ name:'砂皇スカラベウス', power:4137, kind:'phys', dist:{ hp:45, mp:6, str:15, dex:9, agi:6, int_stat:4, vit:12, luk:3 },
      skills:[S.砂塵葬送, S.すなあらし, S.ちからため, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 10, tier: 5, bias: 'mag', name: '常闇の樹海', dropRanks: { E:38, D:30, C:20, B:9, A:3 },
    enemies: [
      A({ name:'食人樹', power:2400, kind:'phys', dist:{ hp:36, mp:5, str:24, dex:8, agi:4, int_stat:3, vit:16, luk:4 },
        skills:[S.つるのむち, S.かたくなる] }),
      A({ name:'毒霧のマンドラゴラ', power:2250, kind:'mag', dist:{ hp:32, mp:9, str:3, dex:10, agi:6, int_stat:27, vit:9, luk:4 },
        skills:[S.どくのきり, S.まりょくため] }),
      A({ name:'影狼シャドウウルフ', power:2350, kind:'phys', dist:{ hp:26, mp:5, str:24, dex:14, agi:25, int_stat:2, vit:2, luk:2 },
        skills:[S.かみつく, S.すばやくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'朝靄のトレント', power:3000, kind:'phys', dist:{ hp:35, mp:5, str:23, dex:9, agi:5, int_stat:4, vit:16, luk:3 },
        skills:[S.つるのむち, S.かたくなる] }),
      A({ band:'昼', name:'木漏れ日のピクシー', power:3000, kind:'mag', dist:{ hp:27, mp:11, str:3, dex:13, agi:20, int_stat:23, vit:1, luk:2 },
        skills:[S.どくのきり, S.すばやくなる] }),
      A({ band:'晩', name:'常闇のバンシー', power:3000, kind:'mag', dist:{ hp:29, mp:10, str:2, dex:11, agi:14, int_stat:28, vit:4, luk:2 },
        skills:[S.きょうきのぜっきょう, S.まりょくため] }),
    ],
    boss: A({ name:'森王エルダートレント', power:6744, kind:'phys', dist:{ hp:44, mp:6, str:15, dex:8, agi:5, int_stat:5, vit:14, luk:3 },
      skills:[S.樹海縛鎖, S.つるのむち, S.どくのきり, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 11, tier: 6, bias: 'mag', name: '雷鳴の断崖', dropRanks: { E:33, D:29, C:21, B:11, A:6 },
    enemies: [
      A({ name:'嵐鳥ストームバード', power:4100, kind:'phys', dist:{ hp:26, mp:6, str:24, dex:14, agi:26, int_stat:2, vit:1, luk:1 },
        skills:[S.かぜのやいば, S.すばやくなる] }),
      A({ name:'雷刃のガーゴイル', power:4300, kind:'phys', dist:{ hp:32, mp:6, str:23, dex:11, agi:9, int_stat:6, vit:10, luk:3 },
        skills:[S.らくらい, S.かたくなる] }),
      A({ name:'断崖のトロール', power:4000, kind:'phys', dist:{ hp:35, mp:4, str:25, dex:7, agi:5, int_stat:2, vit:19, luk:3 },
        skills:[S.じわれ, S.かたくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'暁雲のサンダーホーク', power:5280, kind:'phys', dist:{ hp:27, mp:7, str:25, dex:13, agi:24, int_stat:2, vit:1, luk:1 },
        skills:[S.かぜのやいば, S.ちからため] }),
      A({ band:'昼', name:'雷光のエレメンタル', power:5280, kind:'mag', dist:{ hp:29, mp:11, str:2, dex:10, agi:12, int_stat:29, vit:5, luk:2 },
        skills:[S.らくらい, S.まりょくため] }),
      A({ band:'晩', name:'雷鳴のワイバーン', power:5280, kind:'phys', dist:{ hp:30, mp:8, str:26, dex:12, agi:14, int_stat:5, vit:3, luk:2 },
        skills:[S.れっぷうそう, S.らくらい] }),
    ],
    boss: A({ name:'雷帝ケラウノス', power:9893, kind:'mag', dist:{ hp:42, mp:8, str:4, dex:9, agi:9, int_stat:18, vit:7, luk:3 },
      skills:[S.天雷万鈞, S.らくらい, S.まりょくため, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 12, tier: 7, bias: 'mag', name: '腐海の沼獄', dropRanks: { D:40, C:30, B:20, A:10 },
    enemies: [
      A({ name:'沼のヒュドラ', power:7600, kind:'phys', dist:{ hp:33, mp:6, str:24, dex:10, agi:9, int_stat:5, vit:10, luk:3 },
        skills:[S.かみつく, S.どくのきり, S.かたくなる] }),
      A({ name:'腐食スライム', power:7000, kind:'mag', dist:{ hp:36, mp:8, str:3, dex:8, agi:5, int_stat:26, vit:10, luk:4 },
        skills:[S.どくのきり, S.かたくなる] }),
      A({ name:'沼底のリザードマン', power:7400, kind:'phys', dist:{ hp:29, mp:6, str:26, dex:14, agi:14, int_stat:3, vit:6, luk:2 },
        skills:[S.どくばり, S.ちからため] }),
    ],
    timed: [
      A({ band:'朝', name:'朝霞のウィルオウィスプ', power:9360, kind:'mag', dist:{ hp:27, mp:11, str:2, dex:12, agi:18, int_stat:27, vit:1, luk:2 },
        skills:[S.どくのきり, S.まりょくため] }),
      A({ band:'昼', name:'陽だまりの大蛙', power:9360, kind:'phys', dist:{ hp:35, mp:5, str:25, dex:9, agi:8, int_stat:3, vit:12, luk:3 },
        skills:[S.まるのみ, S.かたくなる] }),
      A({ band:'晩', name:'夜霧のゾンビ', power:9360, kind:'phys', dist:{ hp:34, mp:6, str:24, dex:10, agi:8, int_stat:5, vit:11, luk:2 },
        skills:[S.ほうたい, S.どくばり] }),
    ],
    boss: A({ name:'毒龍ヴェノムヒュドラ', power:19450, kind:'phys', dist:{ hp:43, mp:7, str:16, dex:9, agi:7, int_stat:4, vit:11, luk:3 },
      skills:[S.腐蝕溶解, S.どくのきり, S.どくばり, S.ちからため, S.じこさいせい] }),
  },
  {
    id: 13, tier: 7, bias: null, name: '奈落の坑道', dropRanks: { D:40, C:30, B:20, A:10 },
    enemies: [
      A({ name:'坑道のグール', power:7200, kind:'phys', dist:{ hp:32, mp:5, str:25, dex:12, agi:11, int_stat:3, vit:9, luk:3 },
        skills:[S.ひっかく, S.ちからため] }),
      A({ name:'鉱石ゴーレム', power:7800, kind:'phys', dist:{ hp:34, mp:4, str:24, dex:6, agi:4, int_stat:2, vit:23, luk:3 },
        skills:[S.じわれ, S.かたくなる] }),
      A({ name:'闇喰いコウモリ', power:7000, kind:'phys', dist:{ hp:26, mp:7, str:23, dex:15, agi:26, int_stat:2, vit:1, luk:0 },
        skills:[S.かみつく, S.すばやくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'曙光のクリスタルワーム', power:9360, kind:'mag', dist:{ hp:31, mp:10, str:3, dex:10, agi:8, int_stat:27, vit:9, luk:2 },
        skills:[S.でんげき, S.まりょくため] }),
      A({ band:'昼', name:'灯火のドワーフ亡霊', power:9360, kind:'phys', dist:{ hp:31, mp:7, str:26, dex:13, agi:10, int_stat:5, vit:6, luk:2 },
        skills:[S.ほねきり, S.ちからため] }),
      A({ band:'晩', name:'深穴のシャドウ', power:9360, kind:'mag', dist:{ hp:28, mp:10, str:3, dex:12, agi:17, int_stat:27, vit:1, luk:2 },
        skills:[S.きょうきのぜっきょう, S.まりょくため] }),
    ],
    boss: A({ name:'巌喰いガイアモール', power:19450, kind:'phys', dist:{ hp:44, mp:6, str:16, dex:8, agi:6, int_stat:3, vit:14, luk:3 },
      skills:[S.崩落震撼, S.じわれ, S.いわなげ, S.かたくなる, S.じこさいせい] }),
  },
  {
    id: 14, tier: 8, bias: 'mag', name: '星霜の遺跡', dropRanks: { D:35, C:29, B:22, A:14 },
    enemies: [
      A({ name:'星読みの石像', power:12000, kind:'mag', dist:{ hp:33, mp:9, str:3, dex:9, agi:5, int_stat:26, vit:12, luk:3 },
        skills:[S.ほしくず, S.かたくなる] }),
      A({ name:'遺跡守護機構', power:12500, kind:'phys', dist:{ hp:32, mp:5, str:25, dex:12, agi:8, int_stat:3, vit:12, luk:3 },
        skills:[S.そうてんとつげき, S.かたくなる] }),
      A({ name:'時喰いのクロノワーム', power:11000, kind:'phys', dist:{ hp:30, mp:7, str:22, dex:13, agi:20, int_stat:4, vit:2, luk:2 },
        skills:[S.かぜのやいば, S.すばやくなる] }),
    ],
    timed: [
      A({ band:'朝', name:'暁星のアストラルナイト', power:15000, kind:'phys', dist:{ hp:30, mp:7, str:26, dex:13, agi:12, int_stat:4, vit:6, luk:2 },
        skills:[S.そうてんとつげき, S.ちからため] }),
      A({ band:'昼', name:'白日のスフィンクス', power:15000, kind:'mag', dist:{ hp:31, mp:10, str:3, dex:11, agi:9, int_stat:28, vit:6, luk:2 },
        skills:[S.ほしくず, S.まりょくため] }),
      A({ band:'晩', name:'星宿のルナリス', power:15000, kind:'mag', dist:{ hp:28, mp:11, str:2, dex:12, agi:16, int_stat:28, vit:1, luk:2 },
        skills:[S.ほしくず, S.きょうきのぜっきょう] }),
    ],
    boss: A({ name:'時星龍アイオーン', power:28202, kind:'mag', dist:{ hp:44, mp:7, str:3, dex:9, agi:8, int_stat:17, vit:9, luk:3 },
      skills:[S.星辰崩落, S.ほしくず, S.らくらい, S.まりょくため, S.じこさいせい] }),
  },
  {
    id: 15, tier: 8, bias: null, name: '深淵の海溝', dropRanks: { D:35, C:29, B:22, A:14 },
    enemies: [
      A({ name:'深淵のクラーケン', power:12500, kind:'phys', dist:{ hp:34, mp:6, str:25, dex:10, agi:9, int_stat:4, vit:9, luk:3 },
        skills:[S.しょくしゅ, S.かたくなる] }),
      A({ name:'海淵のリヴァイアサン幼体', power:11800, kind:'phys', dist:{ hp:31, mp:7, str:24, dex:11, agi:13, int_stat:6, vit:6, luk:2 },
        skills:[S.しおのやり, S.かみつく] }),
      A({ name:'冥暗のシーウィッチ', power:11000, kind:'mag', dist:{ hp:29, mp:11, str:2, dex:10, agi:10, int_stat:29, vit:7, luk:2 },
        skills:[S.しんえんのめ, S.まりょくため] }),
    ],
    timed: [
      A({ band:'朝', name:'朝凪の海竜', power:15000, kind:'phys', dist:{ hp:32, mp:7, str:25, dex:12, agi:14, int_stat:4, vit:4, luk:2 },
        skills:[S.しおのやり, S.ちからため] }),
      A({ band:'昼', name:'陽射しの巨鯨', power:15000, kind:'phys', dist:{ hp:38, mp:6, str:24, dex:8, agi:6, int_stat:3, vit:12, luk:3 },
        skills:[S.まるのみ, S.かたくなる] }),
      A({ band:'晩', name:'深海のセイレーン女王', power:15000, kind:'mag', dist:{ hp:29, mp:11, str:2, dex:11, agi:13, int_stat:29, vit:3, luk:2 },
        skills:[S.しんえんのめ, S.きょうきのぜっきょう] }),
    ],
    boss: A({ name:'深海覇王リヴァイアサン', power:28202, kind:'phys', dist:{ hp:45, mp:6, str:16, dex:9, agi:7, int_stat:4, vit:10, luk:3 },
      skills:[S.深淵咆哮, S.しょくしゅ, S.深海波動, S.ちからため, S.じこさいせい] }),
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
// ★taken は**そのエリアの相性**（物理/特殊のどちらが通りやすいか）。敵は自分のエリアを
//   持っていないので、名前から引く（敵の名前は全エリアで一意＝enemies.test.js で固定）
export const toFighter = (enemy, uses = 4) => ({
  name: enemy.name,
  kind: enemy.kind,
  stats: statsOf(enemy),
  slots: enemy.skills.map(s => ({ skill: s, uses })),
  taken: takenMultOf(areaOfEnemy(enemy.name)),
})


// ============================================================
// ===== レアモンスター =====
// ★エリアごとに5体（常時2体＋朝・昼・晩に1体ずつ）。2026-08-25 ユーザー決定。
//   ・出現率は**合計0.5%で固定**（通常敵・ボスの抽選より先に引く。sortie.js の RARE_RATE）
//   ・強さは**そのエリアのボス相当**。power はボスから自動で取るので、ここには書かない
//   ・素材は**確定で落ちる**。内訳は 通常55% / レア35% / 激レア10%（sortie.js）
//   ・素材の値は通常の素材の**1.5倍**（material.js の RARE_MULT）
//
// ⚠dist はボスと同じ「HPとVITへ寄せる」形にしてある。通常敵の配分のままボスの戦闘力を
//   持たせると、ボスよりはるかに硬くて痛い相手になってしまう（enemies.js 冒頭の注記）。
// ⚠**名前は全モンスターで重複させない**（素材の引き当てが名前なので。テストで縛ってある）
// ============================================================
const R = (o) => ({ ...o, isRare: true })

const RARES = {
  1: [
    R({ name:'翠玉のスライムロード', kind:'phys', dist:{ hp:40, mp:5, str:16, dex:8, agi:6, int_stat:3, vit:19, luk:3 }, skills:[S.たいあたり, S.かたくなる, S.じこさいせい] }),
    R({ name:'古木の番人フォレスト', kind:'phys', dist:{ hp:38, mp:5, str:18, dex:9, agi:6, int_stat:3, vit:18, luk:3 }, skills:[S.つるのむち, S.ちからため, S.かたくなる] }),
    R({ band:'朝', name:'暁光の妖精女王', kind:'mag', dist:{ hp:36, mp:9, str:4, dex:12, agi:14, int_stat:20, vit:3, luk:2 }, skills:[S.どくのほうし, S.まりょくため, S.すばやくなる] }),
    R({ band:'昼', name:'陽輪の大トカゲ', kind:'phys', dist:{ hp:38, mp:5, str:20, dex:10, agi:10, int_stat:3, vit:11, luk:3 }, skills:[S.かみつく, S.ちからため, S.かたくなる] }),
    R({ band:'晩', name:'月冠のフクロウ王', kind:'phys', dist:{ hp:33, mp:6, str:18, dex:15, agi:16, int_stat:3, vit:6, luk:3 }, skills:[S.ひっかく, S.すばやくなる, S.かぜのやいば] }),
  ],
  2: [
    R({ name:'鬼火のゴブリンキング', kind:'phys', dist:{ hp:39, mp:5, str:21, dex:10, agi:10, int_stat:3, vit:9, luk:3 }, skills:[S.こんぼう, S.ちからため, S.さけび] }),
    R({ name:'銀牙のフェンリル', kind:'phys', dist:{ hp:37, mp:5, str:20, dex:11, agi:19, int_stat:3, vit:2, luk:3 }, skills:[S.かみつく, S.すばやくなる, S.ちからため] }),
    R({ band:'朝', name:'朝靄の大地喰らい', kind:'phys', dist:{ hp:44, mp:5, str:18, dex:8, agi:5, int_stat:3, vit:14, luk:3 }, skills:[S.じわれ, S.かたくなる, S.じこさいせい] }),
    R({ band:'昼', name:'灼陽のバジリスク', kind:'phys', dist:{ hp:38, mp:6, str:20, dex:12, agi:10, int_stat:3, vit:8, luk:3 }, skills:[S.どくばり, S.ちからため, S.かたくなる] }),
    R({ band:'晩', name:'影渡りの首領', kind:'phys', dist:{ hp:33, mp:6, str:17, dex:18, agi:14, int_stat:3, vit:6, luk:3 }, skills:[S.だましうち, S.すばやくなる, S.略奪] }),
  ],
  3: [
    R({ name:'黒曜のコボルト長', kind:'phys', dist:{ hp:38, mp:5, str:21, dex:11, agi:9, int_stat:3, vit:10, luk:3 }, skills:[S.ほねきり, S.ちからため, S.さけび] }),
    R({ name:'骸將スケルトンナイト', kind:'phys', dist:{ hp:40, mp:5, str:19, dex:10, agi:6, int_stat:3, vit:14, luk:3 }, skills:[S.ほねきり, S.かたくなる, S.じこさいせい] }),
    R({ band:'朝', name:'曙の石翼ガーゴイル', kind:'phys', dist:{ hp:40, mp:5, str:17, dex:9, agi:8, int_stat:3, vit:15, luk:3 }, skills:[S.いわなげ, S.かたくなる, S.ちからため] }),
    R({ band:'昼', name:'岩喰いバジリスク', kind:'phys', dist:{ hp:42, mp:5, str:18, dex:9, agi:5, int_stat:3, vit:15, luk:3 }, skills:[S.いわなげ, S.かたくなる, S.じわれ] }),
    R({ band:'晩', name:'冥闇のレイスロード', kind:'mag', dist:{ hp:36, mp:10, str:3, dex:11, agi:12, int_stat:21, vit:5, luk:2 }, skills:[S.でんげき, S.まりょくため, S.どくのきり] }),
  ],
  4: [
    R({ name:'珊瑚甲のシーナイト', kind:'phys', dist:{ hp:40, mp:6, str:19, dex:11, agi:8, int_stat:3, vit:10, luk:3 }, skills:[S.しおのやり, S.かたくなる, S.ちからため] }),
    R({ name:'渦潮のクラーケン仔', kind:'phys', dist:{ hp:41, mp:6, str:20, dex:9, agi:8, int_stat:3, vit:10, luk:3 }, skills:[S.しょくしゅ, S.ちからため, S.じこさいせい] }),
    R({ band:'朝', name:'朝凪の海妖姫', kind:'mag', dist:{ hp:36, mp:10, str:3, dex:12, agi:12, int_stat:21, vit:4, luk:2 }, skills:[S.しんえんのめ, S.まりょくため, S.どくのきり] }),
    R({ band:'昼', name:'潮鳴りの巨蟹', kind:'phys', dist:{ hp:43, mp:5, str:18, dex:9, agi:5, int_stat:3, vit:14, luk:3 }, skills:[S.いわなげ, S.かたくなる, S.じこさいせい] }),
    R({ band:'晩', name:'深光のアンコウ王', kind:'phys', dist:{ hp:38, mp:7, str:20, dex:13, agi:10, int_stat:3, vit:6, luk:3 }, skills:[S.かみつく, S.しんえんのめ, S.ちからため] }),
  ],
  5: [
    R({ name:'峰嵐のグリフォンロード', kind:'phys', dist:{ hp:35, mp:6, str:20, dex:13, agi:15, int_stat:3, vit:5, luk:3 }, skills:[S.れっぷうそう, S.すばやくなる, S.ちからため] }),
    R({ name:'巌骨のマウンテンゴーレム', kind:'phys', dist:{ hp:44, mp:5, str:18, dex:8, agi:4, int_stat:3, vit:15, luk:3 }, skills:[S.いわなげ, S.かたくなる, S.じこさいせい] }),
    R({ band:'朝', name:'払暁の飛竜将', kind:'phys', dist:{ hp:39, mp:6, str:21, dex:12, agi:12, int_stat:3, vit:4, luk:3 }, skills:[S.かえんだん, S.ちからため, S.すばやくなる] }),
    R({ band:'昼', name:'陽炎の大猿王', kind:'phys', dist:{ hp:41, mp:5, str:22, dex:9, agi:8, int_stat:3, vit:9, luk:3 }, skills:[S.ちからため, S.いわなげ, S.さけび] }),
    R({ band:'晩', name:'宵闇の山猫王', kind:'phys', dist:{ hp:33, mp:6, str:18, dex:16, agi:17, int_stat:3, vit:3, luk:4 }, skills:[S.ひっかく, S.すばやくなる, S.かぜのやいば] }),
  ],
  6: [
    R({ name:'白牙のイエティロード', kind:'phys', dist:{ hp:41, mp:5, str:21, dex:9, agi:8, int_stat:3, vit:10, luk:3 }, skills:[S.つらら, S.ちからため, S.かたくなる] }),
    R({ name:'氷鎧のグレイシアドラゴン', kind:'phys', dist:{ hp:40, mp:6, str:20, dex:10, agi:8, int_stat:3, vit:10, luk:3 }, skills:[S.つらら, S.かたくなる, S.じこさいせい] }),
    R({ band:'朝', name:'朝焼けの氷狼王', kind:'phys', dist:{ hp:38, mp:6, str:20, dex:12, agi:15, int_stat:3, vit:3, luk:3 }, skills:[S.つらら, S.すばやくなる, S.ちからため] }),
    R({ band:'昼', name:'白光の樹氷女王', kind:'mag', dist:{ hp:36, mp:10, str:3, dex:12, agi:11, int_stat:22, vit:4, luk:2 }, skills:[S.つらら, S.まりょくため, S.どくのきり] }),
    R({ band:'晩', name:'極夜のワイト王', kind:'phys', dist:{ hp:39, mp:7, str:21, dex:11, agi:9, int_stat:3, vit:7, luk:3 }, skills:[S.ほねきり, S.どくのきり, S.ちからため] }),
  ],
  7: [
    R({ name:'業火のイフリート将', kind:'mag', dist:{ hp:37, mp:10, str:3, dex:12, agi:11, int_stat:22, vit:3, luk:2 }, skills:[S.かえんだん, S.まりょくため, S.きょうきのぜっきょう] }),
    R({ name:'溶鉄のマグマゴーレム', kind:'phys', dist:{ hp:43, mp:5, str:19, dex:8, agi:5, int_stat:3, vit:14, luk:3 }, skills:[S.ようがんけん, S.かたくなる, S.じこさいせい] }),
    R({ band:'朝', name:'暁炎のフレイムロード', kind:'phys', dist:{ hp:38, mp:7, str:21, dex:12, agi:12, int_stat:3, vit:4, luk:3 }, skills:[S.かえんだん, S.ちからため, S.すばやくなる] }),
    R({ band:'昼', name:'陽獄のサラマンダー将', kind:'mag', dist:{ hp:37, mp:10, str:3, dex:11, agi:10, int_stat:22, vit:5, luk:2 }, skills:[S.かえんだん, S.まりょくため, S.らくらい] }),
    R({ band:'晩', name:'熾火の大悪魔', kind:'phys', dist:{ hp:39, mp:7, str:22, dex:11, agi:10, int_stat:3, vit:5, luk:3 }, skills:[S.ようがんけん, S.きょうきのぜっきょう, S.ちからため] }),
  ],
  8: [
    R({ name:'蒼天のハーピークイーン', kind:'phys', dist:{ hp:37, mp:7, str:21, dex:14, agi:16, int_stat:3, vit:1, luk:1 }, skills:[S.かぜのやいば, S.すばやくなる, S.れっぷうそう] }),
    R({ name:'雷雲の大精霊', kind:'mag', dist:{ hp:37, mp:11, str:3, dex:12, agi:11, int_stat:22, vit:2, luk:2 }, skills:[S.らくらい, S.まりょくため, S.でんげき] }),
    R({ band:'朝', name:'曙光の熾天使', kind:'mag', dist:{ hp:38, mp:11, str:3, dex:12, agi:10, int_stat:21, vit:3, luk:2 }, skills:[S.ほしくず, S.まりょくため, S.じこさいせい] }),
    R({ band:'昼', name:'白昼の天馬将', kind:'phys', dist:{ hp:38, mp:7, str:21, dex:13, agi:15, int_stat:3, vit:2, luk:1 }, skills:[S.そうてんとつげき, S.すばやくなる, S.ちからため] }),
    R({ band:'晩', name:'星降りの戦乙女長', kind:'phys', dist:{ hp:39, mp:7, str:22, dex:13, agi:11, int_stat:3, vit:4, luk:1 }, skills:[S.そうてんとつげき, S.ちからため, S.かたくなる] }),
  ],
  9: [
    R({ name:'砂王のグレートワーム', kind:'phys', dist:{ hp:43, mp:5, str:19, dex:9, agi:6, int_stat:3, vit:12, luk:3 }, skills:[S.すなあらし, S.じわれ, S.じこさいせい] }),
    R({ name:'黄金のミイラ神官', kind:'mag', dist:{ hp:38, mp:10, str:3, dex:12, agi:9, int_stat:21, vit:5, luk:2 }, skills:[S.どくのきり, S.まりょくため, S.ほうたい] }),
    R({ band:'朝', name:'陽炎の砂幻王', kind:'mag', dist:{ hp:37, mp:10, str:3, dex:13, agi:13, int_stat:21, vit:1, luk:2 }, skills:[S.すなあらし, S.まりょくため, S.すばやくなる] }),
    R({ band:'昼', name:'灼熱の冥王アヌビス', kind:'phys', dist:{ hp:40, mp:6, str:21, dex:11, agi:9, int_stat:3, vit:7, luk:3 }, skills:[S.すなあらし, S.ちからため, S.かたくなる] }),
    R({ band:'晩', name:'月砂の狼王', kind:'phys', dist:{ hp:37, mp:6, str:20, dex:14, agi:17, int_stat:3, vit:1, luk:2 }, skills:[S.かみつく, S.すばやくなる, S.すなあらし] }),
  ],
  10: [
    R({ name:'樹海の食人王', kind:'phys', dist:{ hp:43, mp:5, str:20, dex:8, agi:5, int_stat:3, vit:13, luk:3 }, skills:[S.つるのむち, S.かたくなる, S.じこさいせい] }),
    R({ name:'毒霧のマンドラ女王', kind:'mag', dist:{ hp:37, mp:10, str:3, dex:12, agi:10, int_stat:21, vit:5, luk:2 }, skills:[S.どくのきり, S.まりょくため, S.どくばり] }),
    R({ band:'朝', name:'朝靄の古樹王', kind:'phys', dist:{ hp:44, mp:5, str:19, dex:8, agi:4, int_stat:3, vit:14, luk:3 }, skills:[S.つるのむち, S.かたくなる, S.じこさいせい] }),
    R({ band:'昼', name:'木漏れ日の妖精姫', kind:'mag', dist:{ hp:36, mp:11, str:3, dex:13, agi:13, int_stat:21, vit:1, luk:2 }, skills:[S.ほしくず, S.まりょくため, S.すばやくなる] }),
    R({ band:'晩', name:'常闇の哭女王', kind:'mag', dist:{ hp:37, mp:10, str:3, dex:12, agi:12, int_stat:22, vit:2, luk:2 }, skills:[S.きょうきのぜっきょう, S.まりょくため, S.どくのきり] }),
  ],
  11: [
    R({ name:'雷翼のストームロード', kind:'phys', dist:{ hp:38, mp:7, str:21, dex:13, agi:15, int_stat:3, vit:2, luk:1 }, skills:[S.らくらい, S.すばやくなる, S.かぜのやいば] }),
    R({ name:'雷刃のガーゴイル将', kind:'phys', dist:{ hp:41, mp:6, str:20, dex:11, agi:8, int_stat:3, vit:8, luk:3 }, skills:[S.でんげき, S.かたくなる, S.ちからため] }),
    R({ band:'朝', name:'暁雲の雷鷹王', kind:'phys', dist:{ hp:38, mp:7, str:21, dex:14, agi:14, int_stat:3, vit:2, luk:1 }, skills:[S.らくらい, S.すばやくなる, S.ちからため] }),
    R({ band:'昼', name:'雷光の大精霊', kind:'mag', dist:{ hp:37, mp:11, str:3, dex:12, agi:11, int_stat:22, vit:2, luk:2 }, skills:[S.らくらい, S.まりょくため, S.でんげき] }),
    R({ band:'晩', name:'雷鳴の飛竜王', kind:'phys', dist:{ hp:40, mp:6, str:21, dex:12, agi:11, int_stat:3, vit:4, luk:3 }, skills:[S.でんげき, S.ちからため, S.かたくなる] }),
  ],
  12: [
    R({ name:'沼獄のヒュドラ将', kind:'phys', dist:{ hp:42, mp:6, str:20, dex:9, agi:7, int_stat:3, vit:10, luk:3 }, skills:[S.どくばり, S.じこさいせい, S.かたくなる] }),
    R({ name:'腐溶のスライムロード', kind:'mag', dist:{ hp:39, mp:10, str:3, dex:11, agi:8, int_stat:21, vit:6, luk:2 }, skills:[S.どくのきり, S.まりょくため, S.じこさいせい] }),
    R({ band:'朝', name:'朝霞の魂火王', kind:'mag', dist:{ hp:37, mp:11, str:3, dex:12, agi:12, int_stat:22, vit:1, luk:2 }, skills:[S.きょうきのぜっきょう, S.まりょくため, S.どくのきり] }),
    R({ band:'昼', name:'陽だまりの毒蛙王', kind:'phys', dist:{ hp:43, mp:5, str:19, dex:9, agi:6, int_stat:3, vit:12, luk:3 }, skills:[S.どくばり, S.かたくなる, S.じこさいせい] }),
    R({ band:'晩', name:'夜霧の腐王', kind:'phys', dist:{ hp:41, mp:6, str:21, dex:10, agi:7, int_stat:3, vit:9, luk:3 }, skills:[S.どくのきり, S.ちからため, S.ほうたい] }),
  ],
  13: [
    R({ name:'坑道の屍鬼王', kind:'phys', dist:{ hp:41, mp:6, str:21, dex:10, agi:9, int_stat:3, vit:7, luk:3 }, skills:[S.ほねきり, S.ちからため, S.じこさいせい] }),
    R({ name:'鉱晶のゴーレム将', kind:'phys', dist:{ hp:44, mp:5, str:18, dex:8, agi:4, int_stat:3, vit:15, luk:3 }, skills:[S.いわなげ, S.かたくなる, S.じわれ] }),
    R({ band:'朝', name:'曙光の晶蟲王', kind:'mag', dist:{ hp:38, mp:10, str:3, dex:12, agi:10, int_stat:21, vit:4, luk:2 }, skills:[S.ほしくず, S.まりょくため, S.どくのきり] }),
    R({ band:'昼', name:'灯火のドワーフ王', kind:'phys', dist:{ hp:40, mp:6, str:21, dex:12, agi:8, int_stat:3, vit:7, luk:3 }, skills:[S.ようがんけん, S.ちからため, S.かたくなる] }),
    R({ band:'晩', name:'深穴の影王', kind:'mag', dist:{ hp:37, mp:10, str:3, dex:13, agi:13, int_stat:22, vit:1, luk:1 }, skills:[S.しんえんのめ, S.まりょくため, S.すばやくなる] }),
  ],
  14: [
    R({ name:'星読みの大石像', kind:'mag', dist:{ hp:40, mp:10, str:3, dex:11, agi:7, int_stat:21, vit:6, luk:2 }, skills:[S.ほしくず, S.まりょくため, S.かたくなる] }),
    R({ name:'遺跡の守護機神', kind:'phys', dist:{ hp:42, mp:6, str:20, dex:11, agi:7, int_stat:3, vit:10, luk:1 }, skills:[S.いわなげ, S.かたくなる, S.じこさいせい] }),
    R({ band:'朝', name:'暁星の星辰騎士', kind:'phys', dist:{ hp:39, mp:7, str:22, dex:13, agi:11, int_stat:3, vit:4, luk:1 }, skills:[S.そうてんとつげき, S.ちからため, S.かたくなる] }),
    R({ band:'昼', name:'白日の獅子王', kind:'mag', dist:{ hp:38, mp:11, str:3, dex:12, agi:9, int_stat:22, vit:3, luk:2 }, skills:[S.ほしくず, S.まりょくため, S.きょうきのぜっきょう] }),
    R({ band:'晩', name:'星宿の月女神', kind:'mag', dist:{ hp:37, mp:11, str:3, dex:13, agi:12, int_stat:22, vit:1, luk:1 }, skills:[S.ほしくず, S.まりょくため, S.すばやくなる] }),
  ],
  15: [
    R({ name:'深淵のクラーケン王', kind:'phys', dist:{ hp:42, mp:6, str:21, dex:10, agi:8, int_stat:3, vit:9, luk:1 }, skills:[S.しょくしゅ, S.ちからため, S.じこさいせい] }),
    R({ name:'海淵の古龍', kind:'phys', dist:{ hp:41, mp:6, str:21, dex:11, agi:9, int_stat:3, vit:8, luk:1 }, skills:[S.しんえんのめ, S.かたくなる, S.ちからため] }),
    R({ band:'朝', name:'朝凪の海竜王', kind:'phys', dist:{ hp:40, mp:7, str:21, dex:12, agi:11, int_stat:3, vit:5, luk:1 }, skills:[S.しおのやり, S.ちからため, S.すばやくなる] }),
    R({ band:'昼', name:'陽射しの海皇鯨', kind:'phys', dist:{ hp:45, mp:5, str:19, dex:8, agi:4, int_stat:3, vit:15, luk:1 }, skills:[S.しおのやり, S.かたくなる, S.じこさいせい] }),
    R({ band:'晩', name:'深海の海妖女王', kind:'mag', dist:{ hp:37, mp:11, str:3, dex:12, agi:11, int_stat:22, vit:3, luk:1 }, skills:[S.しんえんのめ, S.まりょくため, S.どくのきり] }),
  ],
}
// ★戦闘力はそのエリアのボスと同じにする（ここで配るので、上の表には書かない）
for (const a of AREAS) a.rares = (RARES[a.id] || []).map(r => ({ ...r, power: a.boss.power }))

// その時間帯に出うるレアモンスター（常時2体＋その時間帯の1体）
export const rarePoolAt = (area, band) =>
  (area?.rares || []).filter(r => !r.band || r.band === band)
export const allRares = () => AREAS.flatMap(a => a.rares || [])

export const areaOf = (id) => AREAS.find(a => a.id === id) || null
// ===== 属性の通りやすさ（同じ帯の中の役割分担）=====
// ★2026-08-22 ユーザー決定：帯にエリアが複数あるとき、**片方は物理・片方は特殊が少し通る**。
//   3つある帯の残り1つは**バランス型**（どちらも等倍）。帯が1エリアだけの①②③もバランス型。
//   ＝同じ難易度でも「自分の型が通るほう」を選べる。倍率はそのエリアの敵**全員**に掛かる
//   （敵が受けるダメージだけ。敵の攻撃は変わらない）。解釈は battle.js の applyIncoming
export const BIAS_MULT = 1.1
export const biasLabelOf = (bias) =>
  bias === 'phys' ? '物理が通りやすい' : bias === 'mag' ? '特殊が通りやすい' : 'バランス型'
export const takenMultOf = (area) =>
  area?.bias === 'phys' ? { phys: BIAS_MULT } : area?.bias === 'mag' ? { mag: BIAS_MULT } : null

// ===== 難易度帯（tier）=====
// ★エリアは「帯」に属する（2026-08-22 ユーザー決定）。同じ帯のエリアは**同じ強さ・
//   同じドロップ範囲**で、④⑤⑥の帯は2エリア・⑦⑧の帯は3エリアある。
//   **画面に出す番号は id ではなく tier**（④の帯にいるエリアはどれも「④」）。
//   進み方は sortie.js（その帯を全部踏破すると次の帯が開く）
export const TIER_MAX = 8
export const TIER_MARK = '①②③④⑤⑥⑦⑧'
export const markOf = (tier) => TIER_MARK[tier - 1] || String(tier)
export const tierOf = (areaId) => areaOf(areaId)?.tier || 0
export const areasOfTier = (tier) => AREAS.filter(a => a.tier === tier)
// 並べるときは**帯の順**（id は9〜15が後ろに付いているだけで難易度順ではない）
export const AREAS_SORTED = [...AREAS].sort((a, b) => a.tier - b.tier || a.id - b.id)
// 帯に2つ以上あるときだけ「④-2」と枝番を付ける
export const areaLabel = (areaOrId) => {
  const a = typeof areaOrId === 'object' ? areaOrId : areaOf(areaOrId)
  if (!a) return ''
  const list = areasOfTier(a.tier)
  return list.length > 1 ? `${markOf(a.tier)}-${list.findIndex(x => x.id === a.id) + 1}` : markOf(a.tier)
}
export const areaFullName = (areaOrId) => {
  const a = typeof areaOrId === 'object' ? areaOrId : areaOf(areaOrId)
  return a ? `${areaLabel(a)} ${a.name}` : ''
}

export const allEnemies = () => AREAS.flatMap(a => [...a.enemies, ...(a.timed || []), ...(a.rares || []), a.boss])
// 敵の名前 → いるエリア（相性を引くのに使う）
const AREA_OF_ENEMY = new Map(
  AREAS.flatMap(a => [...a.enemies, ...(a.timed || []), a.boss].map(e => [e.name, a])))
export const areaOfEnemy = (name) => AREA_OF_ENEMY.get(name) || null

export const timedEnemyOf = (area, band) => (area?.timed || []).find(e => e.band === band) || null

// ドロップするランクを1つ抽選する
export const rollDropRank = (area, rng = Math.random) => {
  const entries = Object.entries(area.dropRanks)
  let r = rng() * entries.reduce((t, [, v]) => t + v, 0)
  for (const [rank, w] of entries) { r -= w; if (r <= 0) return rank }
  return entries[entries.length - 1][0]
}
