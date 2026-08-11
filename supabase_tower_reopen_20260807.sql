-- ============================================================
-- エンドレスタワー：5〜10層を再公開し、5層以降の踏破記録をリセットする（2026-08-07）
-- ------------------------------------------------------------
-- 2026-08-04 に「エリアボスが想定より弱い」として5層以降を閉じた
-- （supabase_tower_close5_20260804.sql）。バランス調整が終わったので再公開する。
--
-- 5〜10層の敵は当時とは別物になっているため、閉じる前の踏破記録は無効にする。
--   ・5層以降の踏破記録を消す → その層のエリアボスを倒し直すと
--     初回踏破Gold（層数×100万）が改めてもらえる
--   ・出撃回数と強敵撃破はそのまま残す → すぐエリアボスに再挑戦できる
--     （各層80〜130回の出撃をやり直させない）
--   ・到達エリア（ランキング）は踏破し直した層で付け直す
--   ・10層の石碑は白紙に戻す（5〜9層には石碑は無い。石碑は10層のみ）
--
-- ⚠クライアントの src/lib/tower.js の OPEN_MAX_FLOOR も 10 になっていること。
--   片方だけだと「選べるのに出撃が弾かれる」状態になる（npm test がズレを検出する）。
--
-- ⚠SQL適用順の鉄則には影響しない（apply_battle_result を定義しないため、
--   supabase_mutant_gold_20260703.sql の前後どちらでもよい）。
--
-- ⚠この操作は取り消せない。流す前に §0 で影響人数を確認すること。
-- ============================================================


-- ============================================================
-- §0 事前確認（流す前にここだけ実行して、影響する人数を見る）
-- ============================================================
-- 5層以降を踏破済みの人数と、層ごとの内訳
--   SELECT floor, count(*) AS 踏破済みの人数
--     FROM tower_progress WHERE floor >= 5 AND boss_cleared
--    GROUP BY floor ORDER BY floor;
--
-- 到達エリアが5以上の人数
--   SELECT count(*) FROM tower_player WHERE max_floor >= 5;
--
-- 石碑に載っている人
--   SELECT * FROM tower_first_clear ORDER BY floor;
--
-- 5層以降の連戦が途中で残っている人（閉鎖中に一度も画面を開かなかった人）
--   SELECT count(*) FROM tower_player WHERE run_floor >= 5;


-- ============================================================
-- §1 挑戦できる層を 10 に戻す
-- ============================================================
CREATE OR REPLACE FUNCTION tower_max_floor() RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 10 $$;


-- ============================================================
-- §2 5層以降の踏破記録を消す（＝初回踏破Goldを再度もらえるようにする）
-- ------------------------------------------------------------
-- 初回かどうかは tower_boss_clear が boss_cleared で判定している。
-- ここを false に戻すと、次に倒したときに層数×100万Goldが入る。
-- 出撃回数(sortie_count)と強敵撃破(mid_defeated)には触らないので、
-- 再挑戦のためにエリアを稼ぎ直す必要はない。
-- ============================================================
UPDATE tower_progress
   SET boss_cleared   = false,
       first_clear_at = NULL,        -- 踏破し直した日時で改めて記録する
       updated_at     = now()
 WHERE floor >= 5
   AND boss_cleared;


-- ============================================================
-- §3 到達エリア（ランキング）を踏破済みの最高層で付け直す
-- ------------------------------------------------------------
-- §2 で5層以降が未踏破になったので、実態は最大でも4層。
-- 一度も踏破していない人は0に戻す。
-- ============================================================
-- 到達エリアの日時も、その層を実際に踏破した日時に付け直す。
-- 元の max_floor_at は「10層に到達した日時」など、消した記録の日時のままなので、
-- そのままだとランキングの同率タイブレークが狂う。
UPDATE tower_player t
   SET max_floor    = p.floor,
       max_floor_at = p.first_clear_at,
       updated_at   = now()
  FROM (
    SELECT DISTINCT ON (player_id) player_id, floor, first_clear_at
      FROM tower_progress
     WHERE boss_cleared
     ORDER BY player_id, floor DESC
  ) p
 WHERE p.player_id = t.player_id
   AND (t.max_floor IS DISTINCT FROM p.floor OR t.max_floor_at IS DISTINCT FROM p.first_clear_at);

-- tower_progress の行が1つも無い人（出撃だけして踏破していない人）も0に揃える
UPDATE tower_player t
   SET max_floor = 0, max_floor_at = NULL, updated_at = now()
 WHERE t.max_floor > 0
   AND NOT EXISTS (
     SELECT 1 FROM tower_progress tp
      WHERE tp.player_id = t.player_id AND tp.boss_cleared
   );


-- ============================================================
-- §4 石碑を白紙に戻す（10層のみ。5〜9層には石碑は無い）
-- ------------------------------------------------------------
-- tower_boss_clear は floor >= 10 のときだけ tower_first_clear へ INSERT する。
-- 行を消せば、新しいバランスで最初に10層を踏破した人が改めて刻まれる。
-- ============================================================
DELETE FROM tower_first_clear WHERE floor >= 5;


-- ============================================================
-- §5 5層以降で宙に浮いている連戦を畳む
-- ------------------------------------------------------------
-- 閉鎖中は get_tower_status() が「run_floor > tower_max_floor()」で畳んでいたが、
-- §1 で上限が10に戻ると、この条件では畳まれなくなる。
-- 閉鎖中に一度もタワーを開かなかった人には、8/4以前の連戦が
-- そのHP・進行度のまま残っている。当時の敵で始めた連戦なので破棄する。
-- ============================================================
UPDATE tower_player
   SET run_floor = NULL, run_stage = 0, run_hp = NULL, run_mp = NULL,
       run_potion = 0, run_pending = false, run_started_at = NULL,
       updated_at = now()
 WHERE run_floor >= 5;


-- ============================================================
-- §6 適用後の確認
-- ============================================================
-- 挑戦できる層が10になっているか
--   SELECT tower_max_floor();                        -- → 10
--
-- 5層以降の踏破記録が残っていないか
--   SELECT count(*) FROM tower_progress WHERE floor >= 5 AND boss_cleared;   -- → 0
--
-- 到達エリアが5以上の人が残っていないか
--   SELECT count(*) FROM tower_player WHERE max_floor >= 5;                  -- → 0
--
-- 石碑が空になっているか
--   SELECT count(*) FROM tower_first_clear;                                  -- → 0
--
-- 宙に浮いた連戦が残っていないか
--   SELECT count(*) FROM tower_player WHERE run_floor >= 5;                  -- → 0
--
-- 出撃回数と強敵撃破が残っていること（消えていたら §2 を流しすぎている）
--   SELECT floor, count(*) FILTER (WHERE mid_defeated) AS 強敵撃破済み,
--          count(*) FILTER (WHERE sortie_count > 0)   AS 出撃したことがある
--     FROM tower_progress WHERE floor >= 5 GROUP BY floor ORDER BY floor;
