-- ============================================================
-- 自動成長NPC 100体の投入（②）— 2026-08-27
-- ------------------------------------------------------------
-- ★このファイルは tools/v2-npc-seed.mjs が作る。手で直さないこと。
--   中身の正は src/v2/lib/npc.js（名前・職業・成長速度・初期の強さ）。
--
-- 流す順番： ① supabase_v2_core.sql（全文）→ ② このファイル → ③ supabase_v2_npc_cron.sql
--
-- 何度流しても壊れない（on conflict do nothing）。
-- **作り直したいときは先に delete from public.v2_npcs; を流してから**（進行度が消えます）
--
-- 11体ごとに抜き出した様子（作った直後）：
--     1 レイン（侍）速度15EXP/時　1階　戦闘力168　LV20／転職0回
--    12 ユウナ（式神使い）速度23EXP/時　12階　戦闘力457　LV46／転職1回
--    23 ヨミ（狩人）速度34EXP/時　23階　戦闘力1572　LV56／転職9回
--    34 セイラ（聖騎士）速度51EXP/時　34階　戦闘力4814　LV36／転職32回
--    45 グレイ（元素使い）速度77EXP/時　45階　戦闘力17537　LV49／転職98回
--    56 アカネ（魔銃士）速度116EXP/時　6階　戦闘力268　LV36／転職0回
--    67 クラウディア（聖職者）速度175EXP/時　17階　戦闘力764　LV54／転職3回
--    78 リク（ビーストレンジャー）速度264EXP/時　28階　戦闘力2880　LV63／転職18回
--    89 アンセルム（サイキッカー）速度398EXP/時　39階　戦闘力9400　LV54／転職58回
--   100 シグレ（竜騎士）速度600EXP/時　50階　戦闘力28457　LV57／転職142回
-- ============================================================
insert into public.v2_npcs (id, name, cls, seed, speed, total_exp, arena_floor, born_at, last_tick_at, next_arena_at)
values
  (1, 'レイン', '侍', 1000003, 15, 1140, 1, now() - interval '76 hours', now(), now() + interval '216 minutes'),
  (2, 'クロト', '狂戦士', 1007922, 16, 1080, 2, now() - interval '68 hours', now(), now() + interval '177 minutes'),
  (3, 'ミリア', '狩人', 1015841, 16, 1500, 3, now() - interval '94 hours', now(), now() + interval '176 minutes'),
  (4, 'ザッシュ', '暗殺者', 1023760, 17, 1440, 4, now() - interval '85 hours', now(), now() + interval '193 minutes'),
  (5, 'ノエル', '元素使い', 1031679, 17, 1620, 5, now() - interval '95 hours', now(), now() + interval '182 minutes'),
  (6, 'ガーランド', '死霊使い', 1039598, 18, 2040, 6, now() - interval '113 hours', now(), now() + interval '247 minutes'),
  (7, 'ティナ', '聖職者', 1047517, 19, 7260, 7, now() - interval '382 hours', now(), now() + interval '159 minutes'),
  (8, 'ヴォルフ', '異端審問官', 1055436, 19, 7500, 8, now() - interval '395 hours', now(), now() + interval '189 minutes'),
  (9, 'セシル', 'サイキッカー', 1063355, 20, 7440, 9, now() - interval '372 hours', now(), now() + interval '149 minutes'),
  (10, 'ハルカ', '体術師', 1071274, 21, 7860, 10, now() - interval '374 hours', now(), now() + interval '247 minutes'),
  (11, 'ドレイク', '精霊召喚士', 1079193, 22, 8640, 11, now() - interval '393 hours', now(), now() + interval '145 minutes'),
  (12, 'ユウナ', '式神使い', 1087112, 23, 8640, 12, now() - interval '376 hours', now(), now() + interval '148 minutes'),
  (13, 'バルド', '賢者', 1095031, 23, 9120, 13, now() - interval '397 hours', now(), now() + interval '163 minutes'),
  (14, 'シオン', '聖騎士', 1102950, 24, 19260, 14, now() - interval '803 hours', now(), now() + interval '174 minutes'),
  (15, 'ルクレツィア', '魔法剣士', 1110869, 25, 19920, 15, now() - interval '797 hours', now(), now() + interval '171 minutes'),
  (16, 'ゲンゴロウ', '魔銃士', 1118788, 26, 20700, 16, now() - interval '796 hours', now(), now() + interval '175 minutes'),
  (17, 'アイリ', '武僧', 1126707, 27, 27180, 17, now() - interval '1007 hours', now(), now() + interval '202 minutes'),
  (18, 'ザイオン', 'ビーストレンジャー', 1134626, 28, 26520, 18, now() - interval '947 hours', now(), now() + interval '120 minutes'),
  (19, 'マキナ', 'ギャンブラー', 1142545, 29, 28440, 19, now() - interval '981 hours', now(), now() + interval '184 minutes'),
  (20, 'トール', '竜騎士', 1150464, 30, 38220, 20, now() - interval '1274 hours', now(), now() + interval '190 minutes'),
  (21, 'フィリア', '侍', 1158383, 32, 45120, 21, now() - interval '1410 hours', now(), now() + interval '106 minutes'),
  (22, 'クレイグ', '狂戦士', 1166302, 33, 56460, 22, now() - interval '1711 hours', now(), now() + interval '105 minutes'),
  (23, 'ヨミ', '狩人', 1174221, 34, 56760, 23, now() - interval '1669 hours', now(), now() + interval '166 minutes'),
  (24, 'アストラ', '暗殺者', 1182140, 35, 73440, 24, now() - interval '2098 hours', now(), now() + interval '173 minutes'),
  (25, 'ベネット', '元素使い', 1190059, 37, 74160, 25, now() - interval '2004 hours', now(), now() + interval '96 minutes'),
  (26, 'リリカ', '死霊使い', 1197978, 38, 91980, 26, now() - interval '2421 hours', now(), now() + interval '90 minutes'),
  (27, 'ダグラス', '聖職者', 1205897, 40, 91860, 27, now() - interval '2297 hours', now(), now() + interval '138 minutes'),
  (28, 'ソラ', '異端審問官', 1213816, 41, 93420, 28, now() - interval '2279 hours', now(), now() + interval '156 minutes'),
  (29, 'ヴィヴィ', 'サイキッカー', 1221735, 43, 120120, 29, now() - interval '2793 hours', now(), now() + interval '132 minutes'),
  (30, 'ケンシン', '体術師', 1229654, 44, 122460, 30, now() - interval '2783 hours', now(), now() + interval '132 minutes'),
  (31, 'ミハエル', '精霊召喚士', 1237573, 46, 156420, 31, now() - interval '3400 hours', now(), now() + interval '91 minutes'),
  (32, 'ナギ', '式神使い', 1245492, 48, 173460, 32, now() - interval '3614 hours', now(), now() + interval '86 minutes'),
  (33, 'オルガ', '賢者', 1253411, 49, 193620, 33, now() - interval '3951 hours', now(), now() + interval '108 minutes'),
  (34, 'セイラ', '聖騎士', 1261330, 51, 192180, 34, now() - interval '3768 hours', now(), now() + interval '116 minutes'),
  (35, 'ブラッド', '魔法剣士', 1269249, 53, 221640, 35, now() - interval '4182 hours', now(), now() + interval '123 minutes'),
  (36, 'ツキヨ', '魔銃士', 1277168, 55, 257520, 36, now() - interval '4682 hours', now(), now() + interval '76 minutes'),
  (37, 'ランドルフ', '武僧', 1285087, 57, 275940, 37, now() - interval '4841 hours', now(), now() + interval '112 minutes'),
  (38, 'エリカ', 'ビーストレンジャー', 1293006, 60, 324060, 38, now() - interval '5401 hours', now(), now() + interval '100 minutes'),
  (39, 'ジン', 'ギャンブラー', 1300925, 62, 358260, 39, now() - interval '5778 hours', now(), now() + interval '66 minutes'),
  (40, 'カレン', '竜騎士', 1308844, 64, 358440, 40, now() - interval '5601 hours', now(), now() + interval '87 minutes'),
  (41, 'ゼファー', '侍', 1316763, 67, 376140, 41, now() - interval '5614 hours', now(), now() + interval '87 minutes'),
  (42, 'ムツキ', '狂戦士', 1324682, 69, 413880, 42, now() - interval '5998 hours', now(), now() + interval '70 minutes'),
  (43, 'アルヴィン', '狩人', 1332601, 72, 466500, 43, now() - interval '6479 hours', now(), now() + interval '81 minutes'),
  (44, 'ノノ', '暗殺者', 1340520, 74, 532320, 44, now() - interval '7194 hours', now(), now() + interval '59 minutes'),
  (45, 'グレイ', '元素使い', 1348439, 77, 585000, 45, now() - interval '7597 hours', now(), now() + interval '73 minutes'),
  (46, 'ヒビキ', '死霊使い', 1356358, 80, 634320, 46, now() - interval '7929 hours', now(), now() + interval '67 minutes'),
  (47, 'マルコ', '聖職者', 1364277, 83, 678560, 47, now() - interval '8175 hours', now(), now() + interval '80 minutes'),
  (48, 'スズナ', '異端審問官', 1372196, 86, 770190, 48, now() - interval '8956 hours', now(), now() + interval '82 minutes'),
  (49, 'テオドール', 'サイキッカー', 1380115, 90, 778240, 49, now() - interval '8647 hours', now(), now() + interval '53 minutes'),
  (50, 'リョウ', '体術師', 1388034, 93, 909630, 50, now() - interval '9781 hours', now(), now() + interval '74 minutes'),
  (51, 'シャル', '精霊召喚士', 1395953, 97, 840, 1, now() - interval '9 hours', now(), now() + interval '74 minutes'),
  (52, 'カナタ', '式神使い', 1403872, 100, 1020, 2, now() - interval '10 hours', now(), now() + interval '59 minutes'),
  (53, 'ウルリカ', '賢者', 1411791, 104, 1500, 3, now() - interval '14 hours', now(), now() + interval '56 minutes'),
  (54, 'ハヤテ', '聖騎士', 1419710, 108, 1500, 4, now() - interval '14 hours', now(), now() + interval '49 minutes'),
  (55, 'モルガン', '魔法剣士', 1427629, 112, 1620, 5, now() - interval '14 hours', now(), now() + interval '73 minutes'),
  (56, 'アカネ', '魔銃士', 1435548, 116, 2100, 6, now() - interval '18 hours', now(), now() + interval '47 minutes'),
  (57, 'ジークベルト', '武僧', 1443467, 121, 2100, 7, now() - interval '17 hours', now(), now() + interval '46 minutes'),
  (58, 'コハク', 'ビーストレンジャー', 1451386, 125, 7620, 8, now() - interval '61 hours', now(), now() + interval '63 minutes'),
  (59, 'ヴァレリア', 'ギャンブラー', 1459305, 130, 7620, 9, now() - interval '59 hours', now(), now() + interval '52 minutes'),
  (60, 'ソウマ', '竜騎士', 1467224, 135, 8220, 10, now() - interval '61 hours', now(), now() + interval '59 minutes'),
  (61, 'ネロ', '侍', 1475143, 140, 8820, 11, now() - interval '63 hours', now(), now() + interval '61 minutes'),
  (62, 'ミツキ', '狂戦士', 1483062, 146, 8820, 12, now() - interval '60 hours', now(), now() + interval '55 minutes'),
  (63, 'ロラン', '狩人', 1490981, 151, 19500, 13, now() - interval '129 hours', now(), now() + interval '53 minutes'),
  (64, 'イズミ', '暗殺者', 1498900, 157, 9660, 14, now() - interval '62 hours', now(), now() + interval '43 minutes'),
  (65, 'ファウスト', '元素使い', 1506819, 163, 20760, 15, now() - interval '127 hours', now(), now() + interval '57 minutes'),
  (66, 'ナオ', '死霊使い', 1514738, 169, 21480, 16, now() - interval '127 hours', now(), now() + interval '36 minutes'),
  (67, 'クラウディア', '聖職者', 1522657, 175, 21000, 17, now() - interval '120 hours', now(), now() + interval '55 minutes'),
  (68, 'タクマ', '異端審問官', 1530576, 182, 27060, 18, now() - interval '149 hours', now(), now() + interval '38 minutes'),
  (69, 'ベルナデット', 'サイキッカー', 1538495, 189, 27900, 19, now() - interval '148 hours', now(), now() + interval '45 minutes'),
  (70, 'レン', '体術師', 1546414, 196, 44160, 20, now() - interval '225 hours', now(), now() + interval '49 minutes'),
  (71, 'ギルバート', '精霊召喚士', 1554333, 204, 45060, 21, now() - interval '221 hours', now(), now() + interval '30 minutes'),
  (72, 'サヤ', '式神使い', 1562252, 211, 45120, 22, now() - interval '214 hours', now(), now() + interval '29 minutes'),
  (73, 'オズワルド', '賢者', 1570171, 219, 62460, 23, now() - interval '285 hours', now(), now() + interval '45 minutes'),
  (74, 'ユキ', '聖騎士', 1578090, 228, 73500, 24, now() - interval '322 hours', now(), now() + interval '36 minutes'),
  (75, 'マチルダ', '魔法剣士', 1586009, 236, 73140, 25, now() - interval '310 hours', now(), now() + interval '46 minutes'),
  (76, 'ハジメ', '魔銃士', 1593928, 245, 92100, 26, now() - interval '376 hours', now(), now() + interval '32 minutes'),
  (77, 'セラフィナ', '武僧', 1601847, 255, 99660, 27, now() - interval '391 hours', now(), now() + interval '32 minutes'),
  (78, 'リク', 'ビーストレンジャー', 1609766, 264, 110640, 28, now() - interval '419 hours', now(), now() + interval '34 minutes'),
  (79, 'コンラート', 'ギャンブラー', 1617685, 274, 120660, 29, now() - interval '440 hours', now(), now() + interval '41 minutes'),
  (80, 'アヤメ', '竜騎士', 1625604, 285, 129300, 30, now() - interval '454 hours', now(), now() + interval '36 minutes'),
  (81, 'ヴェルナー', '侍', 1633523, 296, 156720, 31, now() - interval '529 hours', now(), now() + interval '35 minutes'),
  (82, 'シズク', '狂戦士', 1641442, 307, 157980, 32, now() - interval '515 hours', now(), now() + interval '29 minutes'),
  (83, 'エミリオ', '狩人', 1649361, 318, 182580, 33, now() - interval '574 hours', now(), now() + interval '24 minutes'),
  (84, 'カグヤ', '暗殺者', 1657280, 331, 193080, 34, now() - interval '583 hours', now(), now() + interval '34 minutes'),
  (85, 'ロベルト', '元素使い', 1665199, 343, 222060, 35, now() - interval '647 hours', now(), now() + interval '33 minutes'),
  (86, 'ツバサ', '死霊使い', 1673118, 356, 247740, 36, now() - interval '696 hours', now(), now() + interval '31 minutes'),
  (87, 'イザベラ', '聖職者', 1681037, 370, 257820, 37, now() - interval '697 hours', now(), now() + interval '32 minutes'),
  (88, 'ミナト', '異端審問官', 1688956, 384, 294180, 38, now() - interval '766 hours', now(), now() + interval '26 minutes'),
  (89, 'アンセルム', 'サイキッカー', 1696875, 398, 347700, 39, now() - interval '874 hours', now(), now() + interval '33 minutes'),
  (90, 'ホタル', '体術師', 1704794, 413, 376440, 40, now() - interval '911 hours', now(), now() + interval '34 minutes'),
  (91, 'デュラン', '精霊召喚士', 1712713, 429, 423300, 41, now() - interval '987 hours', now(), now() + interval '25 minutes'),
  (92, 'サクヤ', '式神使い', 1720632, 445, 423900, 42, now() - interval '953 hours', now(), now() + interval '27 minutes'),
  (93, 'グスタフ', '賢者', 1728551, 462, 496860, 43, now() - interval '1075 hours', now(), now() + interval '28 minutes'),
  (94, 'トワ', '聖騎士', 1736470, 480, 486000, 44, now() - interval '1013 hours', now(), now() + interval '21 minutes'),
  (95, 'ルシアン', '魔法剣士', 1744389, 498, 611290, 45, now() - interval '1227 hours', now(), now() + interval '24 minutes'),
  (96, 'ナズナ', '魔銃士', 1752308, 517, 586320, 46, now() - interval '1134 hours', now(), now() + interval '23 minutes'),
  (97, 'ヴィクトル', '武僧', 1760227, 537, 706910, 47, now() - interval '1316 hours', now(), now() + interval '17 minutes'),
  (98, 'アオイ', 'ビーストレンジャー', 1768146, 557, 714750, 48, now() - interval '1283 hours', now(), now() + interval '21 minutes'),
  (99, 'エルネスト', 'ギャンブラー', 1776065, 578, 778100, 49, now() - interval '1346 hours', now(), now() + interval '23 minutes'),
  (100, 'シグレ', '竜騎士', 1783984, 600, 888980, 50, now() - interval '1482 hours', now(), now() + interval '18 minutes')
on conflict (id) do nothing;

-- 最初から階層守護者として座らせるぶん（半数）。
-- ★空いている階にだけ入れる＝すでにプレイヤーやNPCが座っている席は動かさない
insert into public.v2_arena_floors (floor, npc_id, snapshot, hp, mp)
values
  (1, 1, '{"npc":true,"npc_id":1,"name":"レイン","cls":"侍","jobCount":0,"stats":{"hp":175,"mp":56,"str":25,"dex":17,"agi":21,"int_stat":19,"vit":22,"luk":25},"enchants":[],"slots":[{"name":"居合斬","uses":1},{"name":"明鏡止水","uses":1},{"name":"抜刀術","uses":1},{"name":"桜花一閃","uses":1}]}'::jsonb, 175, 56),
  (3, 3, '{"npc":true,"npc_id":3,"name":"ミリア","cls":"狩人","jobCount":0,"stats":{"hp":277,"mp":64,"str":32,"dex":31,"agi":24,"int_stat":22,"vit":18,"luk":21},"enchants":[],"slots":[{"name":"三連射","uses":1},{"name":"狩猟本能","uses":1},{"name":"貫き矢","uses":1},{"name":"トラップセット","uses":1}]}'::jsonb, 277, 64),
  (5, 5, '{"npc":true,"npc_id":5,"name":"ノエル","cls":"元素使い","jobCount":0,"stats":{"hp":244,"mp":68,"str":32,"dex":31,"agi":21,"int_stat":34,"vit":27,"luk":22},"enchants":[],"slots":[{"name":"アクアショット","uses":1},{"name":"アースクエイク","uses":1},{"name":"フレイムバースト","uses":1},{"name":"マグマフィスト","uses":1}]}'::jsonb, 244, 68),
  (7, 7, '{"npc":true,"npc_id":7,"name":"ティナ","cls":"聖職者","jobCount":1,"stats":{"hp":371,"mp":111,"str":35,"dex":37,"agi":41,"int_stat":48,"vit":35,"luk":33},"enchants":[],"slots":[{"name":"ホーリーライト","uses":2},{"name":"神罰執行","uses":1},{"name":"ピュリファイ","uses":2},{"name":"ジャッジライト","uses":1},{"name":"グレイスウィンド","uses":1}]}'::jsonb, 371, 111),
  (9, 9, '{"npc":true,"npc_id":9,"name":"セシル","cls":"サイキッカー","jobCount":1,"stats":{"hp":403,"mp":136,"str":39,"dex":34,"agi":39,"int_stat":46,"vit":35,"luk":40},"enchants":[],"slots":[{"name":"サイコショット","uses":2},{"name":"マインドブレイク","uses":2},{"name":"サイコブラスト","uses":2},{"name":"マインドスパイク","uses":1},{"name":"マインドアクセル","uses":1}]}'::jsonb, 403, 136),
  (11, 11, '{"npc":true,"npc_id":11,"name":"ドレイク","cls":"精霊召喚士","jobCount":1,"stats":{"hp":601,"mp":163,"str":50,"dex":39,"agi":61,"int_stat":71,"vit":53,"luk":52},"enchants":[],"slots":[{"name":"シルフ","uses":3},{"name":"ウィスプ","uses":2},{"name":"マーメイド","uses":2},{"name":"精霊解放","uses":2},{"name":"フェニックス","uses":1}]}'::jsonb, 601, 163),
  (13, 13, '{"npc":true,"npc_id":13,"name":"バルド","cls":"賢者","jobCount":1,"stats":{"hp":590,"mp":163,"str":60,"dex":58,"agi":66,"int_stat":79,"vit":56,"luk":59},"enchants":[],"slots":[{"name":"マナボルト","uses":99},{"name":"氷の障壁","uses":3},{"name":"メテオストライク","uses":2},{"name":"アルカナボルト","uses":2},{"name":"アストラルレイ","uses":2}]}'::jsonb, 590, 163),
  (15, 15, '{"npc":true,"npc_id":15,"name":"ルクレツィア","cls":"魔法剣士","jobCount":3,"stats":{"hp":803,"mp":228,"str":93,"dex":74,"agi":83,"int_stat":84,"vit":71,"luk":69},"enchants":[],"slots":[{"name":"閃光","uses":3},{"name":"魔剣開放","uses":3},{"name":"双極斬","uses":3},{"name":"天魔閃","uses":3},{"name":"ソードオーラ","uses":2}]}'::jsonb, 803, 228),
  (17, 17, '{"npc":true,"npc_id":17,"name":"アイリ","cls":"武僧","jobCount":4,"stats":{"hp":1094,"mp":269,"str":123,"dex":104,"agi":124,"int_stat":108,"vit":110,"luk":125},"enchants":[],"slots":[{"name":"崩拳","uses":4},{"name":"気功掌","uses":4},{"name":"三連震脚","uses":3},{"name":"自癒功","uses":3},{"name":"阿吽の呼吸","uses":3}]}'::jsonb, 1094, 269),
  (19, 19, '{"npc":true,"npc_id":19,"name":"マキナ","cls":"ギャンブラー","jobCount":4,"stats":{"hp":1306,"mp":393,"str":135,"dex":113,"agi":124,"int_stat":136,"vit":111,"luk":140},"enchants":[],"slots":[{"name":"ジャグリング","uses":5},{"name":"ラッキーダイス","uses":5},{"name":"一発勝負","uses":4},{"name":"カードスロー","uses":5},{"name":"ラストベット","uses":4}]}'::jsonb, 1306, 393),
  (21, 21, '{"npc":true,"npc_id":21,"name":"フィリア","cls":"侍","jobCount":7,"stats":{"hp":1774,"mp":386,"str":174,"dex":174,"agi":146,"int_stat":159,"vit":164,"luk":163},"enchants":[],"slots":[{"name":"月影","uses":6},{"name":"納刀","uses":7},{"name":"峰打ち","uses":5},{"name":"桜花一閃","uses":5},{"name":"見切り","uses":5}]}'::jsonb, 1774, 386),
  (23, 23, '{"npc":true,"npc_id":23,"name":"ヨミ","cls":"狩人","jobCount":9,"stats":{"hp":2129,"mp":596,"str":203,"dex":193,"agi":176,"int_stat":186,"vit":182,"luk":169},"enchants":[],"slots":[{"name":"毒矢","uses":8},{"name":"狩猟本能","uses":8},{"name":"貫き矢","uses":8},{"name":"スモークボム","uses":8},{"name":"鷹爪連射","uses":7}]}'::jsonb, 2129, 596),
  (25, 25, '{"npc":true,"npc_id":25,"name":"ベネット","cls":"元素使い","jobCount":12,"stats":{"hp":2249,"mp":692,"str":221,"dex":272,"agi":230,"int_stat":296,"vit":198,"luk":210},"enchants":[],"slots":[{"name":"フレイムバースト","uses":8},{"name":"元素連鎖","uses":8},{"name":"アイスプリズン","uses":8},{"name":"マグマフィスト","uses":8},{"name":"エレメントチャージ","uses":8}]}'::jsonb, 2249, 692),
  (27, 27, '{"npc":true,"npc_id":27,"name":"ダグラス","cls":"聖職者","jobCount":15,"stats":{"hp":2852,"mp":771,"str":277,"dex":282,"agi":303,"int_stat":330,"vit":290,"luk":249},"enchants":[],"slots":[{"name":"ホーリーライト","uses":9},{"name":"奇跡","uses":9},{"name":"ピュリファイ","uses":9},{"name":"ジャッジライト","uses":9},{"name":"メガヒール","uses":9}]}'::jsonb, 2852, 771),
  (29, 29, '{"npc":true,"npc_id":29,"name":"ヴィヴィ","cls":"サイキッカー","jobCount":20,"stats":{"hp":3660,"mp":969,"str":436,"dex":325,"agi":331,"int_stat":399,"vit":334,"luk":294},"enchants":[],"slots":[{"name":"マインドブレイク","uses":13},{"name":"精神増幅","uses":13},{"name":"テレキネシス","uses":13},{"name":"マインドスパイク","uses":12},{"name":"マインドアクセル","uses":12}]}'::jsonb, 3660, 969),
  (31, 31, '{"npc":true,"npc_id":31,"name":"ミハエル","cls":"精霊召喚士","jobCount":26,"stats":{"hp":4761,"mp":1333,"str":442,"dex":425,"agi":504,"int_stat":596,"vit":422,"luk":440},"enchants":[],"slots":[{"name":"サラマンド","uses":17},{"name":"ウンディーネ","uses":16},{"name":"ノーム","uses":15},{"name":"ドリアード","uses":15},{"name":"フェニックス","uses":15}]}'::jsonb, 4761, 1333),
  (33, 33, '{"npc":true,"npc_id":33,"name":"オルガ","cls":"賢者","jobCount":32,"stats":{"hp":6454,"mp":1677,"str":586,"dex":526,"agi":563,"int_stat":752,"vit":550,"luk":641},"enchants":[],"slots":[{"name":"サンダーストライク","uses":20},{"name":"メテオストライク","uses":19},{"name":"万象の理","uses":19},{"name":"ディスペルウェーブ","uses":19},{"name":"インフェルノ","uses":19}]}'::jsonb, 6454, 1677),
  (35, 35, '{"npc":true,"npc_id":35,"name":"ブラッド","cls":"魔法剣士","jobCount":37,"stats":{"hp":7316,"mp":1868,"str":801,"dex":634,"agi":616,"int_stat":711,"vit":629,"luk":662},"enchants":[],"slots":[{"name":"雷光斬","uses":25},{"name":"魔剣開放","uses":24},{"name":"双極斬","uses":24},{"name":"マナエッジ","uses":24},{"name":"天魔閃","uses":23}]}'::jsonb, 7316, 1868),
  (37, 37, '{"npc":true,"npc_id":37,"name":"ランドルフ","cls":"武僧","jobCount":46,"stats":{"hp":9497,"mp":2279,"str":1070,"dex":820,"agi":859,"int_stat":797,"vit":935,"luk":772},"enchants":[],"slots":[{"name":"練気掌","uses":30},{"name":"金剛身","uses":30},{"name":"練丹功","uses":31},{"name":"三連震脚","uses":30},{"name":"阿吽の呼吸","uses":29}]}'::jsonb, 9497, 2279),
  (39, 39, '{"npc":true,"npc_id":39,"name":"ジン","cls":"ギャンブラー","jobCount":60,"stats":{"hp":13159,"mp":3188,"str":1423,"dex":1062,"agi":1079,"int_stat":1056,"vit":1045,"luk":1230},"enchants":[],"slots":[{"name":"ラッキーダイス","uses":37},{"name":"ジャックポット","uses":36},{"name":"一発勝負","uses":36},{"name":"コイントス","uses":36},{"name":"ラストベット","uses":36}]}'::jsonb, 13159, 3188),
  (41, 41, '{"npc":true,"npc_id":41,"name":"ゼファー","cls":"侍","jobCount":63,"stats":{"hp":14406,"mp":3323,"str":1547,"dex":1348,"agi":1083,"int_stat":1088,"vit":1039,"luk":1158},"enchants":[],"slots":[{"name":"居合斬","uses":45},{"name":"断空","uses":44},{"name":"抜刀術","uses":44},{"name":"二段斬り","uses":43},{"name":"桜花一閃","uses":43}]}'::jsonb, 14406, 3323),
  (43, 43, '{"npc":true,"npc_id":43,"name":"アルヴィン","cls":"狩人","jobCount":78,"stats":{"hp":18997,"mp":4224,"str":2040,"dex":1739,"agi":1466,"int_stat":1463,"vit":1392,"luk":1408},"enchants":[],"slots":[{"name":"毒矢","uses":54},{"name":"三連射","uses":54},{"name":"仕留めの矢","uses":53},{"name":"鷹爪連射","uses":53},{"name":"トラップセット","uses":53}]}'::jsonb, 18997, 4224),
  (45, 45, '{"npc":true,"npc_id":45,"name":"グレイ","cls":"元素使い","jobCount":98,"stats":{"hp":25681,"mp":5690,"str":1906,"dex":2292,"agi":1815,"int_stat":2730,"vit":1817,"luk":1872},"enchants":[],"slots":[{"name":"アクアショット","uses":77},{"name":"アースクエイク","uses":77},{"name":"ライトニングボルト","uses":77},{"name":"スパークショット","uses":77},{"name":"エレメントチャージ","uses":76}]}'::jsonb, 25681, 5690),
  (47, 47, '{"npc":true,"npc_id":47,"name":"マルコ","cls":"聖職者","jobCount":112,"stats":{"hp":30305,"mp":6239,"str":2219,"dex":2142,"agi":2161,"int_stat":3272,"vit":2653,"luk":2210},"enchants":[],"slots":[{"name":"奇跡","uses":75},{"name":"祈りの結界","uses":76},{"name":"神罰執行","uses":75},{"name":"セイントレイ","uses":75},{"name":"ピュリファイ","uses":75}]}'::jsonb, 30305, 6239),
  (49, 49, '{"npc":true,"npc_id":49,"name":"テオドール","cls":"サイキッカー","jobCount":126,"stats":{"hp":36578,"mp":7621,"str":3892,"dex":2503,"agi":2520,"int_stat":3150,"vit":2597,"luk":2532},"enchants":[],"slots":[{"name":"サイコショット","uses":97},{"name":"精神集中","uses":97},{"name":"サイコノイズ","uses":96},{"name":"サイキックチェイン","uses":96},{"name":"マインドアクセル","uses":96}]}'::jsonb, 36578, 7621),
  (1, 51, '{"npc":true,"npc_id":51,"name":"シャル","cls":"精霊召喚士","jobCount":0,"stats":{"hp":144,"mp":54,"str":23,"dex":15,"agi":16,"int_stat":14,"vit":16,"luk":15},"enchants":[],"slots":[{"name":"サラマンド","uses":2},{"name":"シルフ","uses":1},{"name":"マーメイド","uses":1}]}'::jsonb, 144, 54),
  (3, 53, '{"npc":true,"npc_id":53,"name":"ウルリカ","cls":"賢者","jobCount":0,"stats":{"hp":237,"mp":70,"str":25,"dex":24,"agi":24,"int_stat":25,"vit":22,"luk":31},"enchants":[],"slots":[{"name":"サンダーストライク","uses":1},{"name":"氷の障壁","uses":1},{"name":"ディスペルウェーブ","uses":1},{"name":"マナリカバリ","uses":1}]}'::jsonb, 237, 70),
  (5, 55, '{"npc":true,"npc_id":55,"name":"モルガン","cls":"魔法剣士","jobCount":0,"stats":{"hp":244,"mp":89,"str":25,"dex":30,"agi":24,"int_stat":22,"vit":30,"luk":29},"enchants":[],"slots":[{"name":"雷光斬","uses":2},{"name":"閃光","uses":1},{"name":"魔剣開放","uses":1},{"name":"双極斬","uses":1},{"name":"フロストエッジ","uses":1}]}'::jsonb, 244, 89),
  (7, 57, '{"npc":true,"npc_id":57,"name":"ジークベルト","cls":"武僧","jobCount":0,"stats":{"hp":328,"mp":82,"str":42,"dex":27,"agi":29,"int_stat":40,"vit":33,"luk":28},"enchants":[],"slots":[{"name":"金剛身","uses":1},{"name":"練丹功","uses":1},{"name":"気功掌","uses":1},{"name":"三連震脚","uses":1},{"name":"阿吽の呼吸","uses":1}]}'::jsonb, 328, 82),
  (9, 59, '{"npc":true,"npc_id":59,"name":"ヴァレリア","cls":"ギャンブラー","jobCount":1,"stats":{"hp":452,"mp":122,"str":54,"dex":36,"agi":46,"int_stat":34,"vit":41,"luk":43},"enchants":[],"slots":[{"name":"ジャグリング","uses":2},{"name":"ジャックポット","uses":1},{"name":"カードスロー","uses":2},{"name":"ラストベット","uses":1},{"name":"レディラック","uses":1}]}'::jsonb, 452, 122),
  (11, 61, '{"npc":true,"npc_id":61,"name":"ネロ","cls":"侍","jobCount":1,"stats":{"hp":514,"mp":185,"str":70,"dex":57,"agi":57,"int_stat":55,"vit":54,"luk":58},"enchants":[],"slots":[{"name":"居合斬","uses":3},{"name":"断空","uses":3},{"name":"抜刀術","uses":3},{"name":"二段斬り","uses":2},{"name":"見切り","uses":2}]}'::jsonb, 514, 185),
  (13, 63, '{"npc":true,"npc_id":63,"name":"ロラン","cls":"狩人","jobCount":3,"stats":{"hp":672,"mp":231,"str":70,"dex":74,"agi":79,"int_stat":72,"vit":87,"luk":62},"enchants":[],"slots":[{"name":"毒矢","uses":3},{"name":"三連射","uses":3},{"name":"絶影狙撃","uses":3},{"name":"仕留めの矢","uses":2},{"name":"鷹爪連射","uses":2}]}'::jsonb, 672, 231),
  (15, 65, '{"npc":true,"npc_id":65,"name":"ファウスト","cls":"元素使い","jobCount":3,"stats":{"hp":954,"mp":214,"str":84,"dex":105,"agi":98,"int_stat":95,"vit":81,"luk":84},"enchants":[],"slots":[{"name":"アクアショット","uses":3},{"name":"元素連鎖","uses":3},{"name":"スパークショット","uses":3},{"name":"アイスプリズン","uses":3},{"name":"マグマフィスト","uses":2}]}'::jsonb, 954, 214),
  (17, 67, '{"npc":true,"npc_id":67,"name":"クラウディア","cls":"聖職者","jobCount":3,"stats":{"hp":949,"mp":236,"str":92,"dex":69,"agi":99,"int_stat":102,"vit":107,"luk":98},"enchants":[],"slots":[{"name":"祈りの結界","uses":3},{"name":"神罰執行","uses":3},{"name":"ライトブレス","uses":3},{"name":"ピュリファイ","uses":2},{"name":"メガヒール","uses":2}]}'::jsonb, 949, 236),
  (19, 69, '{"npc":true,"npc_id":69,"name":"ベルナデット","cls":"サイキッカー","jobCount":4,"stats":{"hp":1281,"mp":339,"str":148,"dex":113,"agi":108,"int_stat":121,"vit":125,"luk":108},"enchants":[],"slots":[{"name":"テレキネシス","uses":5},{"name":"サイコノイズ","uses":4},{"name":"マインドスパイク","uses":4},{"name":"サイキックチェイン","uses":4},{"name":"マインドアクセル","uses":4}]}'::jsonb, 1281, 339),
  (21, 71, '{"npc":true,"npc_id":71,"name":"ギルバート","cls":"精霊召喚士","jobCount":7,"stats":{"hp":1657,"mp":469,"str":146,"dex":153,"agi":174,"int_stat":173,"vit":167,"luk":144},"enchants":[],"slots":[{"name":"ウンディーネ","uses":6},{"name":"ウィスプ","uses":6},{"name":"精霊解放","uses":5},{"name":"ドリアード","uses":5},{"name":"フェニックス","uses":5}]}'::jsonb, 1657, 469),
  (23, 73, '{"npc":true,"npc_id":73,"name":"オズワルド","cls":"賢者","jobCount":10,"stats":{"hp":2143,"mp":546,"str":178,"dex":190,"agi":215,"int_stat":231,"vit":179,"luk":239},"enchants":[],"slots":[{"name":"サンダーストライク","uses":7},{"name":"氷の障壁","uses":7},{"name":"万象の理","uses":6},{"name":"ディスペルウェーブ","uses":6},{"name":"アストラルレイ","uses":6}]}'::jsonb, 2143, 546),
  (25, 75, '{"npc":true,"npc_id":75,"name":"マチルダ","cls":"魔法剣士","jobCount":12,"stats":{"hp":2371,"mp":626,"str":265,"dex":206,"agi":205,"int_stat":218,"vit":216,"luk":212},"enchants":[],"slots":[{"name":"魔剣開放","uses":8},{"name":"エレメンタルエッジ","uses":7},{"name":"双極斬","uses":7},{"name":"マナバースト","uses":7},{"name":"ソードオーラ","uses":7}]}'::jsonb, 2371, 626),
  (27, 77, '{"npc":true,"npc_id":77,"name":"セラフィナ","cls":"武僧","jobCount":16,"stats":{"hp":3301,"mp":952,"str":371,"dex":312,"agi":297,"int_stat":313,"vit":348,"luk":320},"enchants":[],"slots":[{"name":"練気掌","uses":13},{"name":"活殺自在","uses":12},{"name":"練丹功","uses":12},{"name":"破戒撃","uses":12},{"name":"自癒功","uses":12}]}'::jsonb, 3301, 952),
  (29, 79, '{"npc":true,"npc_id":79,"name":"コンラート","cls":"ギャンブラー","jobCount":20,"stats":{"hp":3869,"mp":1003,"str":410,"dex":331,"agi":331,"int_stat":360,"vit":322,"luk":389},"enchants":[],"slots":[{"name":"ラッキーダイス","uses":12},{"name":"オールイン","uses":12},{"name":"ジャックポット","uses":12},{"name":"イカサマ","uses":12},{"name":"レディラック","uses":12}]}'::jsonb, 3869, 1003),
  (31, 81, '{"npc":true,"npc_id":81,"name":"ヴェルナー","cls":"侍","jobCount":26,"stats":{"hp":4956,"mp":1302,"str":557,"dex":525,"agi":442,"int_stat":442,"vit":452,"luk":433},"enchants":[],"slots":[{"name":"居合斬","uses":20},{"name":"断空","uses":20},{"name":"月影","uses":19},{"name":"納刀","uses":20},{"name":"見切り","uses":20}]}'::jsonb, 4956, 1302),
  (33, 83, '{"npc":true,"npc_id":83,"name":"エミリオ","cls":"狩人","jobCount":30,"stats":{"hp":6233,"mp":1602,"str":737,"dex":626,"agi":498,"int_stat":534,"vit":501,"luk":557},"enchants":[],"slots":[{"name":"狩猟本能","uses":21},{"name":"絶影狙撃","uses":20},{"name":"仕留めの矢","uses":20},{"name":"追い討ち","uses":20},{"name":"トラップセット","uses":20}]}'::jsonb, 6233, 1602),
  (35, 85, '{"npc":true,"npc_id":85,"name":"ロベルト","cls":"元素使い","jobCount":37,"stats":{"hp":7483,"mp":1796,"str":621,"dex":723,"agi":634,"int_stat":834,"vit":650,"luk":643},"enchants":[],"slots":[{"name":"アースクエイク","uses":19},{"name":"ライトニングボルト","uses":19},{"name":"フレイムバースト","uses":19},{"name":"アイスプリズン","uses":19},{"name":"エレメンタルレイン","uses":18}]}'::jsonb, 7483, 1796),
  (37, 87, '{"npc":true,"npc_id":87,"name":"イザベラ","cls":"聖職者","jobCount":43,"stats":{"hp":8879,"mp":2211,"str":735,"dex":741,"agi":704,"int_stat":997,"vit":843,"luk":784},"enchants":[],"slots":[{"name":"ホーリーライト","uses":29},{"name":"奇跡","uses":29},{"name":"祈りの結界","uses":29},{"name":"ライトブレス","uses":28},{"name":"ジャッジライト","uses":28}]}'::jsonb, 8879, 2211),
  (39, 89, '{"npc":true,"npc_id":89,"name":"アンセルム","cls":"サイキッカー","jobCount":58,"stats":{"hp":12920,"mp":3074,"str":1384,"dex":989,"agi":1047,"int_stat":1254,"vit":1049,"luk":1038},"enchants":[],"slots":[{"name":"精神集中","uses":39},{"name":"サイコブラスト","uses":38},{"name":"精神増幅","uses":39},{"name":"テレキネシス","uses":38},{"name":"マインドアクセル","uses":38}]}'::jsonb, 12920, 3074),
  (41, 91, '{"npc":true,"npc_id":91,"name":"デュラン","cls":"精霊召喚士","jobCount":71,"stats":{"hp":16404,"mp":3777,"str":1289,"dex":1235,"agi":1524,"int_stat":1802,"vit":1245,"luk":1264},"enchants":[],"slots":[{"name":"ウンディーネ","uses":46},{"name":"ノーム","uses":46},{"name":"ウィスプ","uses":45},{"name":"マーメイド","uses":45},{"name":"フェニックス","uses":45}]}'::jsonb, 16404, 3777),
  (43, 93, '{"npc":true,"npc_id":93,"name":"グスタフ","cls":"賢者","jobCount":83,"stats":{"hp":21081,"mp":4580,"str":1531,"dex":1516,"agi":1567,"int_stat":2210,"vit":1536,"luk":1897},"enchants":[],"slots":[{"name":"マナボルト","uses":99},{"name":"メテオストライク","uses":57},{"name":"万象の理","uses":58},{"name":"ディスペルウェーブ","uses":57},{"name":"アストラルレイ","uses":57}]}'::jsonb, 21081, 4580),
  (45, 95, '{"npc":true,"npc_id":95,"name":"ルシアン","cls":"魔法剣士","jobCount":102,"stats":{"hp":27229,"mp":5800,"str":2873,"dex":1972,"agi":1964,"int_stat":2421,"vit":1938,"luk":1946},"enchants":[],"slots":[{"name":"エレメンタルエッジ","uses":70},{"name":"マナエッジ","uses":70},{"name":"フロストエッジ","uses":70},{"name":"マナバースト","uses":70},{"name":"天魔閃","uses":69}]}'::jsonb, 27229, 5800),
  (47, 97, '{"npc":true,"npc_id":97,"name":"ヴィクトル","cls":"武僧","jobCount":116,"stats":{"hp":31808,"mp":6766,"str":3433,"dex":2254,"agi":2265,"int_stat":2237,"vit":2843,"luk":2299},"enchants":[],"slots":[{"name":"練気掌","uses":88},{"name":"活殺自在","uses":88},{"name":"金剛身","uses":88},{"name":"練丹功","uses":88},{"name":"破戒撃","uses":87}]}'::jsonb, 31808, 6766),
  (49, 99, '{"npc":true,"npc_id":99,"name":"エルネスト","cls":"ギャンブラー","jobCount":126,"stats":{"hp":36488,"mp":7694,"str":3876,"dex":2479,"agi":2486,"int_stat":2538,"vit":2512,"luk":3274},"enchants":[],"slots":[{"name":"ジャグリング","uses":84},{"name":"ジャックポット","uses":84},{"name":"一発勝負","uses":84},{"name":"カードスロー","uses":83},{"name":"ラストベット","uses":83}]}'::jsonb, 36488, 7694)
on conflict (floor) do nothing;

-- 確認（任意）
-- select id, name, cls, speed, total_exp, arena_floor from public.v2_npcs order by id;
-- select floor, npc_id, snapshot->>'name' as name from public.v2_arena_floors order by floor;
