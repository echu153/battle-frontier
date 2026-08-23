-- ============================================================
-- バトルフロンティアⅡ（v2）— 上位職のスキルを5個→10個／ブリーダー廃止
-- 2026-08-19（第4版・2026-08-23 更新）
-- ------------------------------------------------------------
-- ① **ブリーダーを職ごと廃止**（v2にペットが無く、効果を作り直す当てが無かったため）
-- ② 上位職20職のスキルを5個→10個（ATBで「5枠しか組めないのに候補も5個」だったため）
-- ③ **特殊効果に値段を付けて、同じ発動率の帯なら価値もMPも揃えた**
--    （フレイムバーストと幽世ノ門が同威力なのに吸収の有無で格差、という状態を解消）
--    ＝**既存スキルの倍率・消費MP・バフ量もほぼ全部変わっている**
--    ★初期職7職（ノーブル・戦士・弓使い・魔法使い・僧侶・格闘家・サモナー）は**5個のまま**
--    ★追加ぶんは**職業補正の main/sub に合ったステータスも威力に乗る**（例：抜刀＝STR×1.5＋DEX×0.3）
--
-- ★このファイルは supabase_v2_core.sql と同じ結果になる（core を全文流し直してもよい。
--   ただし**ブリーダーのキャラの受け皿（§1-2）はこのファイルにしかない**）。
-- ★2026-08-23の追加ぶん
--   ④ **パッシブを枠の外へ**（その職業なら最初から効く／抽選にも出ない／枠にも置けない）
--      → v2_skills に passive 列を足し、v2_apply_exp と v2_set_skills も差し替える（§6）
--   ⑤ 上位職に1本ずつ足して **初期5／転職5回以上5** に揃えた（枠に置ける技は各職10本）
--   ⑥ 消費MP・並び順・必要転職回数が広く変わっている（倍率と説明文はJS側なのでSQL不要）
--
-- ⚠二重に流しても安全。上から順に全部流すこと。
-- ============================================================

-- ===== 1. ブリーダーを廃止する =====
-- 1-1. まだブリーダーでいるキャラをノーブルへ戻す（習得中のスキルはそこで失われる＝転職と同じ扱い）
update public.v2_profiles
set class = 'ノーブル', skills = '[]'::jsonb, skill_set = '[]'::jsonb, updated_at = now()
where class = 'ブリーダー';

-- 1-2. ブリーダーのスキルと、作り直しで消えたスキルを先に消す
-- ⚠**職業マスタより先に消すこと**。v2_skills.cls が v2_classes.id を参照しているので、
--   職業を先に消すと外部キー制約（v2_skills_cls_fkey）で弾かれる
delete from public.v2_skills where name in (
  'ペット召喚', '攻撃して！', '一緒に頑張ろう！', '休憩しよう！', 'やっちゃえ！', 'かみつけ！', 'とびかかれ！', 'なでなで', 'まもって！', 'いっしょに走ろう！', '喉笛狩り', '毒煙玉', '抜刀', '残身の構え', '血の代償', '裂傷撃', '煙玉', '罠設置', '元素装填', '呪詛の手', '屍毒', '亡者の呻き', '冥府の鎖', '生命転換', '浄化', '断罪の光', '大治癒', '加護の風', '尋問', '拷問具', '異端狩り', '沈黙の枷', '誓いの盾', '聖光の癒し', '魔力刃', '氷結斬', '剣気開放', '速射弾', '貫通弾', '炸裂弾', '曳光装填', '精神加速', '幸運の女神', '竜鱗突き', '空中殺法', '威圧の咆哮', '竜血覚醒', '鷹の急襲', '熊の一撃', '蛇毒の矢', '疾風獣走', '獣王の号令'
);

-- 1-3. 職業マスタから消す（参照が無くなったので通る）
delete from public.v2_classes where id = 'ブリーダー';

-- ===== 2. 初期職に足しかけたぶんを取り消す =====
-- ⚠**第1版のSQL（初期職ぶんも入っていた）をすでに流していた場合だけ意味がある**。
--   流していなければ0行で素通りする。
delete from public.v2_skills where name in (
  '石つぶて', '見切り', '渾身の一撃', '応援', '手当ての心得', '兜割り', '大振り', '二連撃', '挑発', '踏ん張り', '速射', '火矢', '足払いの矢', '雨あられ', '集中', 'ストーンバレット', 'ウィンドカッター', 'マナドレイン', 'フリーズ', '詠唱加速', 'セイクリッドアロー', '裁きの光', '沈黙の祈り', 'キュア', 'ブレス', '蹴り上げ', '肘打ち', '双掌打', '崩し打ち', '体幹強化', 'コウモリ召喚', 'ゴーレム召喚', '影狼の牙', '使い魔の献身', '契約強化'
);

-- ===== 3. 消えたスキルをキャラの持ち物からも外す =====
-- 「習得中」「習得済み」
update public.v2_profiles p
set skills  = coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(p.skills,  '[]'::jsonb)) e
                        where exists (select 1 from public.v2_skills s where s.name = e #>> '{}')), '[]'::jsonb),
    learned = coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(p.learned, '[]'::jsonb)) e
                        where exists (select 1 from public.v2_skills s where s.name = e #>> '{}')), '[]'::jsonb),
    updated_at = now()
where exists (
  select 1 from jsonb_array_elements(coalesce(p.skills, '[]'::jsonb) || coalesce(p.learned, '[]'::jsonb)) e
  where not exists (select 1 from public.v2_skills s where s.name = e #>> '{}')
);

-- 編成（skill_set）
update public.v2_profiles p
set skill_set = coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(p.skill_set, '[]'::jsonb)) e
                          where exists (select 1 from public.v2_skills s where s.name = e ->> 'name')), '[]'::jsonb),
    updated_at = now()
where exists (
  select 1 from jsonb_array_elements(coalesce(p.skill_set, '[]'::jsonb)) e
  where not exists (select 1 from public.v2_skills s where s.name = e ->> 'name')
);

-- 「ブリーダーの証」を持っていたら消す（就ける職が無くなったので死に持ち物になる）
update public.v2_profiles
set proofs = proofs - 'ブリーダーの証', updated_at = now()
where proofs ? 'ブリーダーの証';

-- ===== 4. スキルのマスタを全部入れ直す（消費MPと必要転職回数も入る）=====
-- ★req_jobs 列が無い場合はここで足す（core を流していないときの保険）
alter table public.v2_skills add column if not exists req_jobs int not null default 0;
-- ★2026-08-23：パッシブは枠を使わない＝抽選にも出ない／枠にも置けない
alter table public.v2_skills add column if not exists passive boolean not null default false;

insert into public.v2_skills (name, cls, mp, sort, req_jobs, passive) values
  ('はたく','ノーブル',0,1,0,false), ('狙い撃ち','ノーブル',7,2,0,false), ('応急手当','ノーブル',8,3,0,false), ('身構える','ノーブル',6,4,0,false), ('気合い','ノーブル',8,5,0,false),
  ('体当たり','戦士',4,1,0,false), ('強撃','戦士',11,2,0,false), ('防御崩し','戦士',8,3,0,false), ('防御態勢','戦士',8,4,0,false), ('シールドアタック','戦士',8,5,0,false),
  ('狙撃','弓使い',8,1,0,false), ('剛射','弓使い',11,2,0,false), ('貫通射撃','弓使い',11,3,0,false), ('疾風矢','弓使い',8,4,0,false), ('駆け足','弓使い',6,5,0,false),
  ('マジックアロー','魔法使い',5,1,0,false), ('ファイア','魔法使い',13,2,0,false), ('サンダー','魔法使い',13,3,0,false), ('アイスランス','魔法使い',13,4,0,false), ('精神統一','魔法使い',8,5,0,false),
  ('ライト','僧侶',5,1,0,false), ('ライトニング','僧侶',13,2,0,false), ('ヒール','僧侶',12,3,0,false), ('祈祷','僧侶',15,4,0,false), ('プロテク','僧侶',10,5,0,false),
  ('打撃','格闘家',4,1,0,false), ('鉄拳','格闘家',11,2,0,false), ('連打','格闘家',11,3,0,false), ('爆裂拳','格闘家',11,4,0,false), ('残心','格闘家',8,5,0,false),
  ('オオカミ召喚','サモナー',9,1,0,false), ('小悪魔召喚','サモナー',13,2,0,false), ('グリフォン召喚','サモナー',13,3,0,false), ('群れの号令','サモナー',13,4,0,false), ('魔力供給','サモナー',0,5,0,false),
  ('居合斬','侍',12,1,0,false), ('断空','侍',16,2,0,false), ('明鏡止水','侍',12,3,0,false), ('月影','侍',22,4,0,false), ('抜刀術','侍',14,5,0,false), ('納刀','侍',6,6,5,false), ('峰打ち','侍',14,7,5,false), ('二段斬り','侍',16,8,5,false), ('桜花一閃','侍',18,9,5,false), ('見切り','侍',10,10,5,false), ('居合の構え','侍',0,11,0,true),
  ('マッドラッシュ','狂戦士',16,1,0,false), ('すてみ','狂戦士',22,2,0,false), ('ブラッティロア','狂戦士',14,3,0,false), ('フルブレイカー','狂戦士',16,4,0,false), ('血の渇き','狂戦士',16,5,0,false), ('猛り斬り','狂戦士',12,6,5,false), ('狂心','狂戦士',16,7,5,false), ('血啜り','狂戦士',14,8,5,false), ('狂乱連斬','狂戦士',20,9,5,false), ('威嚇咆哮','狂戦士',12,10,5,false), ('バーサク','狂戦士',0,11,0,true),
  ('毒矢','狩人',12,1,0,false), ('三連射','狩人',16,2,0,false), ('狩猟本能','狩人',14,3,0,false), ('絶影狙撃','狩人',20,4,0,false), ('仕留めの矢','狩人',18,5,0,false), ('貫き矢','狩人',14,6,5,false), ('追い討ち','狩人',14,7,5,false), ('スモークボム','狩人',16,8,5,false), ('鷹爪連射','狩人',20,9,5,false), ('トラップセット','狩人',13,10,5,false), ('鷹ノ目','狩人',0,11,0,true),
  ('瞬歩瞬殺','暗殺者',12,1,0,false), ('鬼影閃','暗殺者',16,2,0,false), ('影歩き','暗殺者',12,3,0,false), ('急所突き','暗殺者',20,4,0,false), ('影裂き','暗殺者',16,5,0,false), ('背後刺し','暗殺者',14,6,5,false), ('毒刃','暗殺者',14,7,5,false), ('足首断ち','暗殺者',18,8,5,false), ('千刃乱舞','暗殺者',20,9,5,false), ('影分身','暗殺者',13,10,5,false), ('隠身','暗殺者',0,11,0,true),
  ('アクアショット','元素使い',13,1,0,false), ('アースクエイク','元素使い',17,2,0,false), ('ライトニングボルト','元素使い',17,3,0,false), ('フレイムバースト','元素使い',21,4,0,false), ('元素連鎖','元素使い',17,5,0,false), ('スパークショット','元素使い',13,6,5,false), ('アイスプリズン','元素使い',17,7,5,false), ('マグマフィスト','元素使い',17,8,5,false), ('エレメンタルレイン','元素使い',23,9,5,false), ('エレメントチャージ','元素使い',14,10,5,false), ('元素共鳴','元素使い',0,11,0,true),
  ('骸骨召喚','死霊使い',13,1,0,false), ('ソウルドレイン','死霊使い',17,2,0,false), ('腐敗霧','死霊使い',17,3,0,false), ('幽世ノ門','死霊使い',21,4,0,false), ('疫病の手','死霊使い',17,5,0,false), ('カースハンド','死霊使い',13,6,5,false), ('コープスポイズン','死霊使い',17,7,5,false), ('デスウェイル','死霊使い',17,8,5,false), ('ヘルチェイン','死霊使い',21,9,5,false), ('ライフコンバート','死霊使い',16,10,5,false), ('骸の壁','死霊使い',0,11,0,true),
  ('ホーリーライト','聖職者',13,1,0,false), ('奇跡','聖職者',18,2,0,false), ('祈りの結界','聖職者',14,3,0,false), ('神罰執行','聖職者',21,4,0,false), ('ライトブレス','聖職者',15,5,0,false), ('セイントレイ','聖職者',13,6,5,false), ('ピュリファイ','聖職者',17,7,5,false), ('ジャッジライト','聖職者',17,8,5,false), ('メガヒール','聖職者',20,9,5,false), ('グレイスウィンド','聖職者',12,10,5,false), ('神聖加護','聖職者',0,11,0,true),
  ('粛清','異端審問官',13,1,0,false), ('狂信','異端審問官',12,2,0,false), ('聖なる裁き','異端審問官',17,3,0,false), ('断罪','異端審問官',21,4,0,false), ('異端審問','異端審問官',17,5,0,false), ('インクイジション','異端審問官',13,6,5,false), ('アイアンメイデン','異端審問官',17,7,5,false), ('ヘレティックハント','異端審問官',17,8,5,false), ('サイレンスチェイン','異端審問官',15,9,5,false), ('火刑','異端審問官',21,10,5,false), ('執行本能','異端審問官',0,11,0,true),
  ('サンダーストライク','賢者',13,1,0,false), ('マナボルト','賢者',0,2,0,false), ('氷の障壁','賢者',15,3,0,false), ('メテオストライク','賢者',23,4,0,false), ('万象の理','賢者',17,5,0,false), ('アルカナボルト','賢者',13,6,5,false), ('ディスペルウェーブ','賢者',17,7,5,false), ('インフェルノ','賢者',17,8,5,false), ('アストラルレイ','賢者',23,9,5,false), ('マナリカバリ','賢者',14,10,5,false), ('天啓','賢者',0,11,0,true),
  ('ホーリーエッジ','聖騎士',12,1,0,false), ('ディバインスマイト','聖騎士',16,2,0,false), ('聖域展開','聖騎士',18,3,0,false), ('神聖覚醒','聖騎士',20,4,0,false), ('大防御','聖騎士',14,5,0,false), ('シールドバッシュ','聖騎士',12,6,5,false), ('ジャッジメントブロウ','聖騎士',16,7,5,false), ('ラストガード','聖騎士',18,8,5,false), ('オースシールド','聖騎士',13,9,5,false), ('ホーリーケア','聖騎士',16,10,5,false), ('聖騎士の心得','聖騎士',0,11,0,true),
  ('雷光斬','魔法剣士',12,1,0,false), ('閃光','魔法剣士',12,2,0,false), ('魔剣開放','魔法剣士',18,3,0,false), ('エレメンタルエッジ','魔法剣士',20,4,0,false), ('双極斬','魔法剣士',16,5,0,false), ('マナエッジ','魔法剣士',12,6,5,false), ('フロストエッジ','魔法剣士',14,7,5,false), ('マナバースト','魔法剣士',17,8,5,false), ('天魔閃','魔法剣士',20,9,5,false), ('ソードオーラ','魔法剣士',15,10,5,false), ('魔導剣術','魔法剣士',0,11,0,true),
  ('魔弾','魔銃士',16,1,0,false), ('連装銃撃','魔銃士',16,2,0,false), ('強化装填','魔銃士',16,3,0,false), ('キャノネスチュームビンド','魔銃士',20,4,0,false), ('弾幕','魔銃士',16,5,0,false), ('ラピッドショット','魔銃士',11,6,5,false), ('ピアースバレット','魔銃士',14,7,5,false), ('バーストショット','魔銃士',16,8,5,false), ('フルバースト','魔銃士',22,9,5,false), ('トレーサーロード','魔銃士',14,10,5,false), ('精密照準','魔銃士',0,11,0,true),
  ('サイコショット','サイキッカー',13,1,0,false), ('マインドブレイク','サイキッカー',17,2,0,false), ('精神集中','サイキッカー',16,3,0,false), ('サイコブラスト','サイキッカー',21,4,0,false), ('精神増幅','サイキッカー',15,5,0,false), ('テレキネシス','サイキッカー',13,6,5,false), ('サイコノイズ','サイキッカー',15,7,5,false), ('マインドスパイク','サイキッカー',17,8,5,false), ('サイキックチェイン','サイキッカー',20,9,5,false), ('マインドアクセル','サイキッカー',15,10,5,false), ('第六感','サイキッカー',0,11,0,true),
  ('半月蹴り','体術師',12,1,0,false), ('五連殺','体術師',20,2,0,false), ('破衝掌','体術師',16,3,0,false), ('飛天三角蹴り','体術師',22,4,0,false), ('地摺り足','体術師',14,5,0,false), ('旋風脚','体術師',11,6,5,false), ('当身','体術師',14,7,5,false), ('疾風連撃','体術師',16,8,5,false), ('崩落蹴','体術師',18,9,5,false), ('気孔術','体術師',14,10,5,false), ('闘争本能','体術師',0,11,0,true),
  ('ジャグリング','ギャンブラー',16,1,0,false), ('ラッキーダイス','ギャンブラー',16,2,0,false), ('オールイン','ギャンブラー',18,3,0,false), ('ジャックポット','ギャンブラー',22,4,0,false), ('一発勝負','ギャンブラー',18,5,0,false), ('コイントス','ギャンブラー',12,6,5,false), ('カードスロー','ギャンブラー',16,7,5,false), ('ラストベット','ギャンブラー',20,8,5,false), ('イカサマ','ギャンブラー',13,9,5,false), ('レディラック','ギャンブラー',14,10,5,false), ('ギャンブルボディ','ギャンブラー',0,11,0,true),
  ('ドラゴンスラスト','竜騎士',12,1,0,false), ('ドラゴンファング','竜騎士',16,2,0,false), ('ドラゴンロア','竜騎士',14,3,0,false), ('天墜竜閃','竜騎士',22,4,0,false), ('竜気錬成','竜騎士',16,5,0,false), ('ランスチャージ','竜騎士',12,6,5,false), ('スケイルピアス','竜騎士',14,7,5,false), ('ドラゴンダイブ','竜騎士',18,8,5,false), ('インティミデイト','竜騎士',14,9,5,false), ('ドラゴンブラッド','竜騎士',15,10,5,false), ('竜鱗の加護','竜騎士',0,11,0,true),
  ('サラマンド','精霊召喚士',13,1,0,false), ('ウンディーネ','精霊召喚士',16,2,0,false), ('シルフ','精霊召喚士',13,3,0,false), ('ノーム','精霊召喚士',21,4,0,false), ('ウィスプ','精霊召喚士',13,5,0,false), ('イフリート','精霊召喚士',15,6,5,false), ('マーメイド','精霊召喚士',13,7,5,false), ('精霊解放','精霊召喚士',23,8,5,false), ('ドリアード','精霊召喚士',16,9,5,false), ('フェニックス','精霊召喚士',20,10,5,false), ('精霊共鳴','精霊召喚士',0,11,0,true),
  ('符術・式打ち','式神使い',13,1,0,false), ('呪符・魂削り','式神使い',17,2,0,false), ('陰陽結界','式神使い',15,3,0,false), ('禁術・神降ろし','式神使い',23,4,0,false), ('式神・鬼','式神使い',17,5,0,false), ('呪符・鬼火','式神使い',13,6,5,false), ('式符・鎌鼬','式神使い',17,7,5,false), ('呪詛返し','式神使い',17,8,5,false), ('封印符','式神使い',15,9,5,false), ('大祓','式神使い',16,10,5,false), ('式神召喚','式神使い',0,11,0,true),
  ('練気掌','武僧',16,1,0,false), ('活殺自在','武僧',16,2,0,false), ('金剛身','武僧',15,3,0,false), ('崩拳','武僧',18,4,0,false), ('練丹功','武僧',14,5,0,false), ('気功掌','武僧',12,6,5,false), ('三連震脚','武僧',16,7,5,false), ('破戒撃','武僧',16,8,5,false), ('自癒功','武僧',15,9,5,false), ('阿吽の呼吸','武僧',15,10,5,false), ('心身一如','武僧',0,11,0,true),
  ('ホークダイブ','ビーストレンジャー',12,1,0,false), ('ベアクロー','ビーストレンジャー',14,2,0,false), ('バイパーアロー','ビーストレンジャー',16,3,0,false), ('ビーストコール','ビーストレンジャー',14,4,0,false), ('獣王の咆哮','ビーストレンジャー',18,5,0,false), ('ワイルドラッシュ','ビーストレンジャー',20,6,5,false), ('獣呼びの矢','ビーストレンジャー',12,7,5,false), ('狼牙連撃','ビーストレンジャー',16,8,5,false), ('共鳴の咆哮','ビーストレンジャー',14,9,5,false), ('貫狼撃','ビーストレンジャー',18,10,5,false), ('野性の勘','ビーストレンジャー',0,11,0,true)
on conflict (name) do update set cls = excluded.cls, mp = excluded.mp, sort = excluded.sort, req_jobs = excluded.req_jobs, passive = excluded.passive;

-- ===== 5. すでにLV50を超えているキャラへ配る =====
-- ★スキルはLVアップで覚える仕組み（LV50までに必ず全部そろう）。
--   **すでにLV50以上のキャラは、放っておくと追加ぶんを一生覚えられない**
--   （LV100まで行っていればLVアップ自体が起きない）ので、ここで配る。
--   LV50未満のキャラは触らない＝これまで通りLVアップで覚えていく。
update public.v2_profiles p
set skills = (
      select coalesce(jsonb_agg(to_jsonb(s.name) order by s.sort), '[]'::jsonb)
      from public.v2_skills s
      where s.cls = p.class
    ),
    updated_at = now()
where p.lv >= 50
  and exists (
    select 1 from public.v2_skills s
    where s.cls = p.class and not (coalesce(p.skills, '[]'::jsonb) ? s.name)
  );

-- 確認用（流したあとに。27職・初期職は5・上位職は10になる）
-- select count(*) from public.v2_classes;                                  -- 27
-- select cls, count(*) from public.v2_skills group by cls order by count(*), cls;

-- ===== 6. パッシブを「枠の外」にする =====
-- ★2026-08-23：パッシブは枠を使わない（その職業なら最初から効いている）。
--   ・LVアップの抽選に出さない  → v2_apply_exp
--   ・スキル枠に置けない        → v2_set_skills
--   どちらも supabase_v2_core.sql と同じ中身。core を全文流したならここは飛ばしてよい。

create or replace function public.v2_apply_exp(p_player uuid, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_lv        constant int := 100;
  c_exp_base      constant int := 60;   -- 必要EXPの基準
  c_exp_max       constant int := 100;  -- 必要EXPの打ち止め
  c_exp_step      constant int := 10;   -- 1段階で増える量
  c_exp_step_jobs constant int := 100;  -- 何回の転職ごとに1段階上げるか
  c_rolls         constant int := 5;
  -- LVアップでのスキル習得。基礎確率で抽選しつつ c_learn_by_lv までに必ず全部そろう
  -- （skills.js の LEARN_BY_LV / LEARN_PCT / forcedLearnCount と同じ規則）
  c_learn_by_lv   constant int := 50;
  c_learn_pct     constant int := 15;
  -- 抽選の並び: 1=hp 2=mp 3=str 4=dex 5=agi 6=int_stat 7=vit 8=luk
  -- ★ src/v2/lib/stats.js の STAT_KEYS と同じ順序であること
  c_unit constant int[] := array[8, 3, 1, 1, 1, 1, 1, 1];
  v_row   public.v2_profiles;
  v_lv    int;
  v_exp   int;
  v_need  int;
  v_gain  int[] := array[0, 0, 0, 0, 0, 0, 0, 0];
  v_ups   int := 0;
  v_r     int;
  v_k     int;
  v_skills    jsonb;
  v_learned   text[] := '{}';
  v_unlearned int;
  v_must      int;
  v_pick      text;
  v_i         int;
begin
  select * into v_row from public.v2_profiles where id = p_player for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがありません');
  end if;

  v_lv     := v_row.lv;
  v_exp    := v_row.exp;
  v_skills := coalesce(v_row.skills, '[]'::jsonb);
  -- 必要EXP＝転職回数で段階的に重くなる（stats.js の expPerLv と同じ式）
  v_need := least(c_exp_max, c_exp_base + (greatest(v_row.job_changes, 0) / c_exp_step_jobs) * c_exp_step);

  if coalesce(p_amount, 0) > 0 and v_lv < c_max_lv then
    v_exp := v_exp + p_amount;
    while v_lv < c_max_lv and v_exp >= v_need loop
      v_exp := v_exp - v_need;
      v_lv  := v_lv + 1;
      v_ups := v_ups + 1;
      for v_r in 1..c_rolls loop
        v_k := 1 + floor(random() * array_length(c_unit, 1))::int;
        v_gain[v_k] := v_gain[v_k] + c_unit[v_k];
      end loop;

      -- スキル習得：いまの職業の未習得スキルを確率で覚える。
      -- 残りLV数が足りなくなったぶんは確定で覚えるので、c_learn_by_lv までに必ず全部そろう
      select count(*) into v_unlearned
      from public.v2_skills s
      where s.cls = v_row.class and not s.passive and not (v_skills ? s.name)
        and s.req_jobs <= coalesce(v_row.job_changes, 0);   -- ★転職回数が足りない技は覚えられない
      if v_unlearned > 0 then
        v_must := greatest(0, v_unlearned - greatest(0, c_learn_by_lv - v_lv));
        if v_unlearned - v_must > 0 and random() * 100 < c_learn_pct then
          v_must := v_must + 1;
        end if;
        for v_i in 1..v_must loop
          select s.name into v_pick
          from public.v2_skills s
          where s.cls = v_row.class and not s.passive and not (v_skills ? s.name)
            and s.req_jobs <= coalesce(v_row.job_changes, 0)
          order by random() limit 1;
          exit when v_pick is null;
          v_skills  := v_skills || to_jsonb(v_pick);
          v_learned := array_append(v_learned, v_pick);
        end loop;
      end if;
    end loop;
    -- 上限到達＝あふれたEXPは捨てる（転職待ち）
    if v_lv >= c_max_lv then v_exp := 0; end if;
  end if;

  update public.v2_profiles set
    lv        = v_lv,
    exp       = v_exp,
    total_exp = total_exp + greatest(coalesce(p_amount, 0), 0),
    hp = hp + v_gain[1], mp = mp + v_gain[2], str = str + v_gain[3], dex = dex + v_gain[4],
    agi = agi + v_gain[5], int_stat = int_stat + v_gain[6], vit = vit + v_gain[7], luk = luk + v_gain[8],
    skills = v_skills,
    updated_at = now()
  where id = p_player
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'level_ups', v_ups,
    'exp_need', v_need,
    'learned', to_jsonb(v_learned),
    'gains', jsonb_build_object(
      'hp', v_gain[1], 'mp', v_gain[2], 'str', v_gain[3], 'dex', v_gain[4],
      'agi', v_gain[5], 'int_stat', v_gain[6], 'vit', v_gain[7], 'luk', v_gain[8]),
    'profile', to_jsonb(v_row));
end;
$$;

revoke all on function public.v2_apply_exp(uuid, int) from public;
revoke all on function public.v2_apply_exp(uuid, int) from anon;
revoke all on function public.v2_apply_exp(uuid, int) from authenticated;

create or replace function public.v2_set_skills(p_set jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_slots   constant int := 5;   -- SKILL_SET_SLOTS
  c_use_max constant int := 99;  -- SKILL_USE_MAX（実際の上限は下の想定利用MPで決まる）
  -- ★いまの職業以外のスキルは消費MPが2倍（skills.js の OFF_CLASS_MP_MULT と同じ値）。
  --   画面の想定利用MP（setMpCost）とここがズレると「画面では保存できるのに弾かれる」になる。
  --   ⚠片方だけ直さないこと。v2sql.test.js が突き合わせている
  c_off_mp  constant int := 2;
  v_uid   uuid := auth.uid();
  v_row   public.v2_profiles;
  v_set   jsonb := coalesce(p_set, '[]'::jsonb);
  v_cost  int := 0;
  v_names text[] := '{}';
  e       jsonb;
  v_name  text;
  v_uses  int;
  v_mp    int;
  v_scls  text;            -- そのスキルの職業（他職なら消費MPが c_off_mp 倍）
  v_mp_pct numeric := 0;   -- 装着中の武器に刺さったルーンのMP+%の合計
  v_max_mp int;            -- ルーンぶんを乗せた最大MP（＝想定利用MPの上限）
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'ログインが必要です');
  end if;
  -- ★開発限定（v2は未公開）。画面のゲートだけだと直接RPCを叩けば通ってしまう
  if not public.v2_is_dev() then return jsonb_build_object('ok', false, 'error', '開発限定です'); end if;
  select * into v_row from public.v2_profiles where id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'キャラクターがありません');
  end if;
  if jsonb_typeof(v_set) <> 'array' then
    return jsonb_build_object('ok', false, 'error', '編成の形式が不正です');
  end if;
  if jsonb_array_length(v_set) > c_slots then
    return jsonb_build_object('ok', false, 'error', format('枠は%s個までです', c_slots));
  end if;

  for e in select value from jsonb_array_elements(v_set) loop
    v_name := e ->> 'name';
    if v_name is null then
      return jsonb_build_object('ok', false, 'error', '枠にスキルが入っていません');
    end if;
    -- 使えるスキルか（いまの職業のスキル ∪ 習得済み）。ついでに消費MPと職業を取る
    select s.mp, s.cls into v_mp, v_scls from public.v2_skills s where s.name = v_name;
    if v_mp is null then
      return jsonb_build_object('ok', false, 'error', format('%sというスキルはありません', v_name));
    end if;
    -- ★パッシブは枠を使わない（その職業なら最初から効いている）
    if exists (select 1 from public.v2_skills s where s.name = v_name and s.passive) then
      return jsonb_build_object('ok', false, 'error', format('%sはパッシブなので枠に置けません', v_name));
    end if;
    -- 使えるスキル ＝ 習得中 ∪ 習得済み
    if not (coalesce(v_row.skills, '[]'::jsonb) ? v_name)
       and not (coalesce(v_row.learned, '[]'::jsonb) ? v_name) then
      return jsonb_build_object('ok', false, 'error', format('%sはまだ使えません', v_name));
    end if;
    -- ★2026-08-19：同じスキルを複数の枠に置けるようにした
    --   （納刀→居合斬→納刀→月影 のように「構えて斬る」を並べられる）
    v_names := array_append(v_names, v_name);
    if jsonb_typeof(e -> 'uses') <> 'number' then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数が不正です', v_name));
    end if;
    v_uses := (e ->> 'uses')::int;
    if v_uses < 1 or v_uses > c_use_max then
      return jsonb_build_object('ok', false, 'error', format('%sの使用回数は1〜%sです', v_name, c_use_max));
    end if;
    -- 他職のスキルは消費MPが c_off_mp 倍で数えられる＝そのぶん使用回数を積めない
    v_cost := v_cost + (case when v_scls = v_row.class then v_mp else v_mp * c_off_mp end) * v_uses;
  end loop;

  -- ★ルーン（エッセンス）のMP+%を最大MPへ乗せる。
  --   ここを素の v2_profiles.mp のままにすると、蒼ルーンのMPが**どこにも効かない**
  --   （戦闘はHP/MP満タン開始で5〜13ターン＝MPが枯れないため）。
  --   装備そのものは HP/MP/LUK を持たない（equipment.js）ので、素のMPに%を掛けるだけで
  --   画面の totalStats(profile, inventory, runes).mp と同じ値になる。
  select coalesce(sum((e.stats ->> 'mp')::numeric), 0) into v_mp_pct
    from public.v2_essences e
   where e.player_id = v_uid
     and e.inv_id is not null
     and e.stats ? 'mp'
     and exists (
       select 1 from jsonb_each_text(coalesce(v_row.equipped, '{}'::jsonb)) q
        where q.value ~ '^[0-9]+$' and q.value::bigint = e.inv_id);
  v_max_mp := round(v_row.mp * (1 + v_mp_pct / 100));

  -- 想定利用MPが最大MPを超える編成は保存させない（これが使用回数の実質的な上限）
  if v_cost > v_max_mp then
    return jsonb_build_object('ok', false, 'error',
      format('想定利用MPが最大MPを超えています（%s / %s）', v_cost, v_max_mp));
  end if;

  update public.v2_profiles set skill_set = v_set, updated_at = now()
  where id = v_uid
  returning * into v_row;
  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_row));
end;
$$;

revoke all on function public.v2_set_skills(jsonb) from public;
revoke all on function public.v2_set_skills(jsonb) from anon;
grant execute on function public.v2_set_skills(jsonb) to authenticated;
