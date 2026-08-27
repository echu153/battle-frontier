-- ============================================================
-- 自動成長NPC 100体の投入（②）— 2026-08-27
-- ------------------------------------------------------------
-- ★このファイルは tools/v2-npc-seed.mjs が作る。手で直さないこと。
--   中身の正は src/v2/lib/npc.js（名前・職業・成長速度・初期の強さ・開発中に動かす顔ぶれ）。
--
-- 流す順番： ① supabase_v2_core.sql（全文）→ ② このファイル → ③ supabase_v2_npc_cron.sql
--            そして**v2の一般公開と同時に** ④ supabase_v2_npc_deploy_all.sql
--
-- ★100体すべてを入れるが、**実際に動くのは開発中の6体だけ**（active = true）。
--   残り94体は active = false で眠っていて、成長もしないし挑戦もしてこない。
--   ④を流した瞬間に全員が起き出す。
--
-- 開発中に動く6体（1階・2階・6階に「ゆっくり守る側」と「速い挑む側」を1体ずつ）：
--     1 レイン（侍）速度15EXP/時　1階　戦闘力168　LV20／転職0回　守る側
--     2 クロト（狂戦士）速度16EXP/時　2階　戦闘力161　LV19／転職0回　守る側
--     6 ガーランド（死霊使い）速度18EXP/時　6階　戦闘力261　LV35／転職0回　守る側
--    51 シャル（精霊召喚士）速度97EXP/時　1階　戦闘力136　LV15／転職0回　挑む側
--    52 カナタ（式神使い）速度100EXP/時　2階　戦闘力155　LV18／転職0回　挑む側
--    56 アカネ（魔銃士）速度116EXP/時　6階　戦闘力268　LV36／転職0回　挑む側
--
-- 何度流しても壊れない（on conflict do nothing）。
-- **作り直したいときは先に delete from public.v2_npcs; を流してから**（進行度が消えます）
-- ============================================================
insert into public.v2_npcs (id, name, cls, seed, speed, total_exp, arena_floor, active, born_at, last_tick_at, next_arena_at)
values
  (1, 'レイン', '侍', 1000003, 15, 1140, 1, true, now() - interval '76 hours', now(), now() + interval '216 minutes'),
  (2, 'クロト', '狂戦士', 1007922, 16, 1080, 2, true, now() - interval '68 hours', now(), now() + interval '177 minutes'),
  (3, 'ミリア', '狩人', 1015841, 16, 1500, 3, false, now() - interval '94 hours', now(), now() + interval '176 minutes'),
  (4, 'ザッシュ', '暗殺者', 1023760, 17, 1440, 4, false, now() - interval '85 hours', now(), now() + interval '193 minutes'),
  (5, 'ノエル', '元素使い', 1031679, 17, 1620, 5, false, now() - interval '95 hours', now(), now() + interval '182 minutes'),
  (6, 'ガーランド', '死霊使い', 1039598, 18, 2040, 6, true, now() - interval '113 hours', now(), now() + interval '247 minutes'),
  (7, 'ティナ', '聖職者', 1047517, 19, 7260, 7, false, now() - interval '382 hours', now(), now() + interval '159 minutes'),
  (8, 'ヴォルフ', '異端審問官', 1055436, 19, 7500, 8, false, now() - interval '395 hours', now(), now() + interval '189 minutes'),
  (9, 'セシル', 'サイキッカー', 1063355, 20, 7440, 9, false, now() - interval '372 hours', now(), now() + interval '149 minutes'),
  (10, 'ハルカ', '体術師', 1071274, 21, 7860, 10, false, now() - interval '374 hours', now(), now() + interval '247 minutes'),
  (11, 'ドレイク', '精霊召喚士', 1079193, 22, 8640, 11, false, now() - interval '393 hours', now(), now() + interval '145 minutes'),
  (12, 'ユウナ', '式神使い', 1087112, 23, 8640, 12, false, now() - interval '376 hours', now(), now() + interval '148 minutes'),
  (13, 'バルド', '賢者', 1095031, 23, 9120, 13, false, now() - interval '397 hours', now(), now() + interval '163 minutes'),
  (14, 'シオン', '聖騎士', 1102950, 24, 19260, 14, false, now() - interval '803 hours', now(), now() + interval '174 minutes'),
  (15, 'ルクレツィア', '魔法剣士', 1110869, 25, 19920, 15, false, now() - interval '797 hours', now(), now() + interval '171 minutes'),
  (16, 'ゲンゴロウ', '魔銃士', 1118788, 26, 20700, 16, false, now() - interval '796 hours', now(), now() + interval '175 minutes'),
  (17, 'アイリ', '武僧', 1126707, 27, 27180, 17, false, now() - interval '1007 hours', now(), now() + interval '202 minutes'),
  (18, 'ザイオン', 'ビーストレンジャー', 1134626, 28, 26520, 18, false, now() - interval '947 hours', now(), now() + interval '120 minutes'),
  (19, 'マキナ', 'ギャンブラー', 1142545, 29, 28440, 19, false, now() - interval '981 hours', now(), now() + interval '184 minutes'),
  (20, 'トール', '竜騎士', 1150464, 30, 38220, 20, false, now() - interval '1274 hours', now(), now() + interval '190 minutes'),
  (21, 'フィリア', '侍', 1158383, 32, 45120, 21, false, now() - interval '1410 hours', now(), now() + interval '106 minutes'),
  (22, 'クレイグ', '狂戦士', 1166302, 33, 56460, 22, false, now() - interval '1711 hours', now(), now() + interval '105 minutes'),
  (23, 'ヨミ', '狩人', 1174221, 34, 56760, 23, false, now() - interval '1669 hours', now(), now() + interval '166 minutes'),
  (24, 'アストラ', '暗殺者', 1182140, 35, 73440, 24, false, now() - interval '2098 hours', now(), now() + interval '173 minutes'),
  (25, 'ベネット', '元素使い', 1190059, 37, 74160, 25, false, now() - interval '2004 hours', now(), now() + interval '96 minutes'),
  (26, 'リリカ', '死霊使い', 1197978, 38, 91980, 26, false, now() - interval '2421 hours', now(), now() + interval '90 minutes'),
  (27, 'ダグラス', '聖職者', 1205897, 40, 91860, 27, false, now() - interval '2297 hours', now(), now() + interval '138 minutes'),
  (28, 'ソラ', '異端審問官', 1213816, 41, 93420, 28, false, now() - interval '2279 hours', now(), now() + interval '156 minutes'),
  (29, 'ヴィヴィ', 'サイキッカー', 1221735, 43, 120120, 29, false, now() - interval '2793 hours', now(), now() + interval '132 minutes'),
  (30, 'ケンシン', '体術師', 1229654, 44, 122460, 30, false, now() - interval '2783 hours', now(), now() + interval '132 minutes'),
  (31, 'ミハエル', '精霊召喚士', 1237573, 46, 156420, 31, false, now() - interval '3400 hours', now(), now() + interval '91 minutes'),
  (32, 'ナギ', '式神使い', 1245492, 48, 173460, 32, false, now() - interval '3614 hours', now(), now() + interval '86 minutes'),
  (33, 'オルガ', '賢者', 1253411, 49, 193620, 33, false, now() - interval '3951 hours', now(), now() + interval '108 minutes'),
  (34, 'セイラ', '聖騎士', 1261330, 51, 192180, 34, false, now() - interval '3768 hours', now(), now() + interval '116 minutes'),
  (35, 'ブラッド', '魔法剣士', 1269249, 53, 221640, 35, false, now() - interval '4182 hours', now(), now() + interval '123 minutes'),
  (36, 'ツキヨ', '魔銃士', 1277168, 55, 257520, 36, false, now() - interval '4682 hours', now(), now() + interval '76 minutes'),
  (37, 'ランドルフ', '武僧', 1285087, 57, 275940, 37, false, now() - interval '4841 hours', now(), now() + interval '112 minutes'),
  (38, 'エリカ', 'ビーストレンジャー', 1293006, 60, 324060, 38, false, now() - interval '5401 hours', now(), now() + interval '100 minutes'),
  (39, 'ジン', 'ギャンブラー', 1300925, 62, 358260, 39, false, now() - interval '5778 hours', now(), now() + interval '66 minutes'),
  (40, 'カレン', '竜騎士', 1308844, 64, 358440, 40, false, now() - interval '5601 hours', now(), now() + interval '87 minutes'),
  (41, 'ゼファー', '侍', 1316763, 67, 376140, 41, false, now() - interval '5614 hours', now(), now() + interval '87 minutes'),
  (42, 'ムツキ', '狂戦士', 1324682, 69, 413880, 42, false, now() - interval '5998 hours', now(), now() + interval '70 minutes'),
  (43, 'アルヴィン', '狩人', 1332601, 72, 466500, 43, false, now() - interval '6479 hours', now(), now() + interval '81 minutes'),
  (44, 'ノノ', '暗殺者', 1340520, 74, 532320, 44, false, now() - interval '7194 hours', now(), now() + interval '59 minutes'),
  (45, 'グレイ', '元素使い', 1348439, 77, 585000, 45, false, now() - interval '7597 hours', now(), now() + interval '73 minutes'),
  (46, 'ヒビキ', '死霊使い', 1356358, 80, 634320, 46, false, now() - interval '7929 hours', now(), now() + interval '67 minutes'),
  (47, 'マルコ', '聖職者', 1364277, 83, 678560, 47, false, now() - interval '8175 hours', now(), now() + interval '80 minutes'),
  (48, 'スズナ', '異端審問官', 1372196, 86, 770190, 48, false, now() - interval '8956 hours', now(), now() + interval '82 minutes'),
  (49, 'テオドール', 'サイキッカー', 1380115, 90, 778240, 49, false, now() - interval '8647 hours', now(), now() + interval '53 minutes'),
  (50, 'リョウ', '体術師', 1388034, 93, 909630, 50, false, now() - interval '9781 hours', now(), now() + interval '74 minutes'),
  (51, 'シャル', '精霊召喚士', 1395953, 97, 840, 1, true, now() - interval '9 hours', now(), now() + interval '74 minutes'),
  (52, 'カナタ', '式神使い', 1403872, 100, 1020, 2, true, now() - interval '10 hours', now(), now() + interval '59 minutes'),
  (53, 'ウルリカ', '賢者', 1411791, 104, 1500, 3, false, now() - interval '14 hours', now(), now() + interval '56 minutes'),
  (54, 'ハヤテ', '聖騎士', 1419710, 108, 1500, 4, false, now() - interval '14 hours', now(), now() + interval '49 minutes'),
  (55, 'モルガン', '魔法剣士', 1427629, 112, 1620, 5, false, now() - interval '14 hours', now(), now() + interval '73 minutes'),
  (56, 'アカネ', '魔銃士', 1435548, 116, 2100, 6, true, now() - interval '18 hours', now(), now() + interval '47 minutes'),
  (57, 'ジークベルト', '武僧', 1443467, 121, 2100, 7, false, now() - interval '17 hours', now(), now() + interval '46 minutes'),
  (58, 'コハク', 'ビーストレンジャー', 1451386, 125, 7620, 8, false, now() - interval '61 hours', now(), now() + interval '63 minutes'),
  (59, 'ヴァレリア', 'ギャンブラー', 1459305, 130, 7620, 9, false, now() - interval '59 hours', now(), now() + interval '52 minutes'),
  (60, 'ソウマ', '竜騎士', 1467224, 135, 8220, 10, false, now() - interval '61 hours', now(), now() + interval '59 minutes'),
  (61, 'ネロ', '侍', 1475143, 140, 8820, 11, false, now() - interval '63 hours', now(), now() + interval '61 minutes'),
  (62, 'ミツキ', '狂戦士', 1483062, 146, 8820, 12, false, now() - interval '60 hours', now(), now() + interval '55 minutes'),
  (63, 'ロラン', '狩人', 1490981, 151, 19500, 13, false, now() - interval '129 hours', now(), now() + interval '53 minutes'),
  (64, 'イズミ', '暗殺者', 1498900, 157, 9660, 14, false, now() - interval '62 hours', now(), now() + interval '43 minutes'),
  (65, 'ファウスト', '元素使い', 1506819, 163, 20760, 15, false, now() - interval '127 hours', now(), now() + interval '57 minutes'),
  (66, 'ナオ', '死霊使い', 1514738, 169, 21480, 16, false, now() - interval '127 hours', now(), now() + interval '36 minutes'),
  (67, 'クラウディア', '聖職者', 1522657, 175, 21000, 17, false, now() - interval '120 hours', now(), now() + interval '55 minutes'),
  (68, 'タクマ', '異端審問官', 1530576, 182, 27060, 18, false, now() - interval '149 hours', now(), now() + interval '38 minutes'),
  (69, 'ベルナデット', 'サイキッカー', 1538495, 189, 27900, 19, false, now() - interval '148 hours', now(), now() + interval '45 minutes'),
  (70, 'レン', '体術師', 1546414, 196, 44160, 20, false, now() - interval '225 hours', now(), now() + interval '49 minutes'),
  (71, 'ギルバート', '精霊召喚士', 1554333, 204, 45060, 21, false, now() - interval '221 hours', now(), now() + interval '30 minutes'),
  (72, 'サヤ', '式神使い', 1562252, 211, 45120, 22, false, now() - interval '214 hours', now(), now() + interval '29 minutes'),
  (73, 'オズワルド', '賢者', 1570171, 219, 62460, 23, false, now() - interval '285 hours', now(), now() + interval '45 minutes'),
  (74, 'ユキ', '聖騎士', 1578090, 228, 73500, 24, false, now() - interval '322 hours', now(), now() + interval '36 minutes'),
  (75, 'マチルダ', '魔法剣士', 1586009, 236, 73140, 25, false, now() - interval '310 hours', now(), now() + interval '46 minutes'),
  (76, 'ハジメ', '魔銃士', 1593928, 245, 92100, 26, false, now() - interval '376 hours', now(), now() + interval '32 minutes'),
  (77, 'セラフィナ', '武僧', 1601847, 255, 99660, 27, false, now() - interval '391 hours', now(), now() + interval '32 minutes'),
  (78, 'リク', 'ビーストレンジャー', 1609766, 264, 110640, 28, false, now() - interval '419 hours', now(), now() + interval '34 minutes'),
  (79, 'コンラート', 'ギャンブラー', 1617685, 274, 120660, 29, false, now() - interval '440 hours', now(), now() + interval '41 minutes'),
  (80, 'アヤメ', '竜騎士', 1625604, 285, 129300, 30, false, now() - interval '454 hours', now(), now() + interval '36 minutes'),
  (81, 'ヴェルナー', '侍', 1633523, 296, 156720, 31, false, now() - interval '529 hours', now(), now() + interval '35 minutes'),
  (82, 'シズク', '狂戦士', 1641442, 307, 157980, 32, false, now() - interval '515 hours', now(), now() + interval '29 minutes'),
  (83, 'エミリオ', '狩人', 1649361, 318, 182580, 33, false, now() - interval '574 hours', now(), now() + interval '24 minutes'),
  (84, 'カグヤ', '暗殺者', 1657280, 331, 193080, 34, false, now() - interval '583 hours', now(), now() + interval '34 minutes'),
  (85, 'ロベルト', '元素使い', 1665199, 343, 222060, 35, false, now() - interval '647 hours', now(), now() + interval '33 minutes'),
  (86, 'ツバサ', '死霊使い', 1673118, 356, 247740, 36, false, now() - interval '696 hours', now(), now() + interval '31 minutes'),
  (87, 'イザベラ', '聖職者', 1681037, 370, 257820, 37, false, now() - interval '697 hours', now(), now() + interval '32 minutes'),
  (88, 'ミナト', '異端審問官', 1688956, 384, 294180, 38, false, now() - interval '766 hours', now(), now() + interval '26 minutes'),
  (89, 'アンセルム', 'サイキッカー', 1696875, 398, 347700, 39, false, now() - interval '874 hours', now(), now() + interval '33 minutes'),
  (90, 'ホタル', '体術師', 1704794, 413, 376440, 40, false, now() - interval '911 hours', now(), now() + interval '34 minutes'),
  (91, 'デュラン', '精霊召喚士', 1712713, 429, 423300, 41, false, now() - interval '987 hours', now(), now() + interval '25 minutes'),
  (92, 'サクヤ', '式神使い', 1720632, 445, 423900, 42, false, now() - interval '953 hours', now(), now() + interval '27 minutes'),
  (93, 'グスタフ', '賢者', 1728551, 462, 496860, 43, false, now() - interval '1075 hours', now(), now() + interval '28 minutes'),
  (94, 'トワ', '聖騎士', 1736470, 480, 486000, 44, false, now() - interval '1013 hours', now(), now() + interval '21 minutes'),
  (95, 'ルシアン', '魔法剣士', 1744389, 498, 611290, 45, false, now() - interval '1227 hours', now(), now() + interval '24 minutes'),
  (96, 'ナズナ', '魔銃士', 1752308, 517, 586320, 46, false, now() - interval '1134 hours', now(), now() + interval '23 minutes'),
  (97, 'ヴィクトル', '武僧', 1760227, 537, 706910, 47, false, now() - interval '1316 hours', now(), now() + interval '17 minutes'),
  (98, 'アオイ', 'ビーストレンジャー', 1768146, 557, 714750, 48, false, now() - interval '1283 hours', now(), now() + interval '21 minutes'),
  (99, 'エルネスト', 'ギャンブラー', 1776065, 578, 778100, 49, false, now() - interval '1346 hours', now(), now() + interval '23 minutes'),
  (100, 'シグレ', '竜騎士', 1783984, 600, 888980, 50, false, now() - interval '1482 hours', now(), now() + interval '18 minutes')
on conflict (id) do nothing;

-- 開発中に動くぶんのうち「守る側」を席に着かせる。
-- ★空いている階にだけ入れる＝すでにプレイヤーやNPCが座っている席は動かさない
insert into public.v2_arena_floors (floor, npc_id, snapshot, hp, mp)
values
  (1, 1, '{"npc":true,"npc_id":1,"name":"レイン","cls":"侍","jobCount":0,"stats":{"hp":175,"mp":56,"str":25,"dex":17,"agi":21,"int_stat":19,"vit":22,"luk":25},"enchants":[],"slots":[{"name":"居合斬","uses":1},{"name":"明鏡止水","uses":1},{"name":"抜刀術","uses":1},{"name":"桜花一閃","uses":1}]}'::jsonb, 175, 56),
  (2, 2, '{"npc":true,"npc_id":2,"name":"クロト","cls":"狂戦士","jobCount":0,"stats":{"hp":227,"mp":50,"str":23,"dex":18,"agi":22,"int_stat":19,"vit":21,"luk":14},"enchants":[],"slots":[{"name":"血の渇き","uses":1},{"name":"血啜り","uses":1},{"name":"威嚇咆哮","uses":1}]}'::jsonb, 227, 50),
  (6, 6, '{"npc":true,"npc_id":6,"name":"ガーランド","cls":"死霊使い","jobCount":0,"stats":{"hp":324,"mp":78,"str":27,"dex":30,"agi":32,"int_stat":34,"vit":31,"luk":39},"enchants":[],"slots":[{"name":"ソウルドレイン","uses":1},{"name":"腐敗霧","uses":1},{"name":"カースハンド","uses":2},{"name":"ライフコンバート","uses":1}]}'::jsonb, 324, 78)
on conflict (floor) do nothing;

-- 確認（任意）
-- select id, name, cls, speed, arena_floor, active from public.v2_npcs order by id;
-- select count(*) filter (where active) as 動いている, count(*) as 全部 from public.v2_npcs;
-- select floor, npc_id, snapshot->>'name' as name from public.v2_arena_floors order by floor;
