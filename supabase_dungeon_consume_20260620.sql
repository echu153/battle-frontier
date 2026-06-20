-- ============================================================
-- デイリーダンジョン: 回数/CDをサーバーで原子的に消費するRPC（本番公開 2026-06-20）
--   クライアントの read→check→write 方式は二端末並行で3回上限/CDを越えられるため、
--   profiles と当日 dungeon_attempts 行を FOR UPDATE で直列化して回数・CDを確保する。
--   クライアントは報酬を出す前に必ずこれを呼び、ok のときだけ報酬処理へ進む。
--   ・1日3回（種類ごと）／CD=ブースト中10秒・通常20秒／釣り中・ダンジョン探索中は不可。
--   ・日付キー = JST朝5時基準（UTC+4の日付。クライアント getDungeonDateStr と一致）。
-- ============================================================

-- ★ON CONFLICT(player_id,date) が機能するための一意制約を保証（無い環境対策）。
--   先に重複行を1行へ統合（各cntは最大値＝消費済み多めの安全側）してからUNIQUE INDEXを張る。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dungeon_attempts GROUP BY player_id, date HAVING COUNT(*) > 1) THEN
    CREATE TEMP TABLE _da_merged ON COMMIT DROP AS
      SELECT player_id, date,
             MAX(COALESCE(count,0))     AS count,
             MAX(COALESCE(cnt_exp,0))   AS cnt_exp,
             MAX(COALESCE(cnt_gold,0))  AS cnt_gold,
             MAX(COALESCE(cnt_stone,0)) AS cnt_stone,
             MAX(COALESCE(cnt_prof,0))  AS cnt_prof,
             MAX(COALESCE(cnt_gem,0))   AS cnt_gem
      FROM dungeon_attempts GROUP BY player_id, date HAVING COUNT(*) > 1;
    DELETE FROM dungeon_attempts da USING _da_merged m WHERE da.player_id = m.player_id AND da.date = m.date;
    INSERT INTO dungeon_attempts (player_id, date, count, cnt_exp, cnt_gold, cnt_stone, cnt_prof, cnt_gem)
      SELECT player_id, date, count, cnt_exp, cnt_gold, cnt_stone, cnt_prof, cnt_gem FROM _da_merged;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS dungeon_attempts_player_date_uidx ON public.dungeon_attempts (player_id, date);

CREATE OR REPLACE FUNCTION public.dungeon_consume(p_type text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   profiles%ROWTYPE;
  v_today date;
  v_cur   int;
  v_wait  int;
  v_left  numeric;
  v_limit int := 3;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF p_type NOT IN ('exp','gold','stone','prof','gem') THEN
    RETURN json_build_object('ok',false,'reason','invalid_type');
  END IF;

  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_row.is_fishing THEN RETURN json_build_object('ok',false,'reason','fishing'); END IF;
  IF has_active_dungeon(v_uid) THEN RETURN json_build_object('ok',false,'reason','dungeon_active'); END IF;

  -- クールダウン（ブースト中10秒/通常20秒）
  v_wait := CASE WHEN v_row.boost_active_until IS NOT NULL AND v_row.boost_active_until > now()
                 THEN 10 ELSE 20 END;
  IF v_row.last_action_at IS NOT NULL THEN
    v_left := v_wait - EXTRACT(EPOCH FROM (now() - v_row.last_action_at));
    IF v_left > 0 THEN
      RETURN json_build_object('ok',false,'reason','cooldown','seconds_left',round(v_left,1));
    END IF;
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Tokyo' - interval '5 hours')::date;

  -- 当日行を確保（無ければ作成）してロック
  INSERT INTO dungeon_attempts (player_id, date, count)
  VALUES (v_uid, v_today, 0)
  ON CONFLICT (player_id, date) DO NOTHING;

  SELECT (CASE p_type
            WHEN 'exp'   THEN cnt_exp
            WHEN 'gold'  THEN cnt_gold
            WHEN 'stone' THEN cnt_stone
            WHEN 'prof'  THEN cnt_prof
            WHEN 'gem'   THEN cnt_gem END)
    INTO v_cur
    FROM dungeon_attempts WHERE player_id = v_uid AND date = v_today FOR UPDATE;
  v_cur := COALESCE(v_cur, 0);

  IF v_cur >= v_limit THEN
    RETURN json_build_object('ok',false,'reason','daily_limit','count',v_cur);
  END IF;

  -- 回数を原子的に消費
  UPDATE dungeon_attempts SET
    cnt_exp   = COALESCE(cnt_exp,0)   + (CASE WHEN p_type='exp'   THEN 1 ELSE 0 END),
    cnt_gold  = COALESCE(cnt_gold,0)  + (CASE WHEN p_type='gold'  THEN 1 ELSE 0 END),
    cnt_stone = COALESCE(cnt_stone,0) + (CASE WHEN p_type='stone' THEN 1 ELSE 0 END),
    cnt_prof  = COALESCE(cnt_prof,0)  + (CASE WHEN p_type='prof'  THEN 1 ELSE 0 END),
    cnt_gem   = COALESCE(cnt_gem,0)   + (CASE WHEN p_type='gem'   THEN 1 ELSE 0 END)
  WHERE player_id = v_uid AND date = v_today;

  -- CDの起点を記録（街の出撃と共通の last_action_at）
  UPDATE profiles SET last_action_at = now() WHERE id = v_uid;

  RETURN json_build_object('ok',true,'count',v_cur + 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.dungeon_consume(text) TO authenticated;
