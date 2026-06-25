-- ============================================================
-- 出撃CD 10秒/20秒 選択式  ★is_admin限定先行（2026-06-26）
--   ・管理者は profiles.sortie_mode（10 or 20）を自分で選択。変更は1週間に1回。
--     - 20秒 = 現状どおり（報酬そのまま）
--     - 10秒 = 街の出撃/デイリーダンジョンCDが10秒。報酬は控えめ（EXP5-6/ボス7/Gold半分）
--       ※報酬減はクライアントが低い値を送るだけ。サーバー上限は20秒モードの高い方の
--         ままなので検証は通る（invalid_exp/gold の誤検知は起きない）。
--   ・簡易出撃は1分・レイドは管理者のみ10秒固定（attack_raid_boss）。
--   ・非管理者は現状維持（従来の20秒＋ブースト10秒）。ブースト機能はそのまま残す。
--
--   適用順は任意（protect_stats等の戦闘/報酬関数には触れない）。
--   ※公開時のTODO:
--     - sortie_lock / dungeon_consume の is_admin 分岐を外し sortie_mode を全員適用
--     - attack_raid_boss を全員10秒固定に
--     - claim_raid_rewards の出撃回数ティア保証を 40/20/10 に（現在は全員20/10/5。
--       先行中の管理者はA=20回で取れる＝やや甘いだけで無害。クライアント表示は既に40/20/10）
-- ============================================================

-- ① 列追加 -----------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sortie_mode        int DEFAULT 20;  -- 10 or 20（街/デイリーダンジョンの待機秒）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sortie_mode_set_at timestamptz;     -- 設定日時（変更は1週間に1回まで）

-- ② 出撃CDモード設定RPC（is_admin限定先行・10/20・週1変更不可） --
DROP FUNCTION IF EXISTS public.set_sortie_mode(int);
CREATE OR REPLACE FUNCTION public.set_sortie_mode(p_mode int)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF p_mode NOT IN (10,20) THEN RETURN json_build_object('ok',false,'reason','invalid_mode'); END IF;
  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★is_admin限定先行（公開時はこの分岐を外す）
  IF NOT COALESCE(v_row.is_admin,false) THEN RETURN json_build_object('ok',false,'reason','not_admin'); END IF;
  -- 一度変更したら1週間（7日）変更不可
  IF v_row.sortie_mode_set_at IS NOT NULL AND now() < v_row.sortie_mode_set_at + interval '7 days' THEN
    RETURN json_build_object('ok',false,'reason','locked',
      'sortie_mode', COALESCE(v_row.sortie_mode,20),
      'unlock_at', v_row.sortie_mode_set_at + interval '7 days');
  END IF;
  PERFORM set_config('app.allow_boost_change','on',true);  -- ★列保護トリガー許可
  UPDATE profiles SET sortie_mode = p_mode, sortie_mode_set_at = now() WHERE id = v_uid;
  RETURN json_build_object('ok',true,'sortie_mode', p_mode, 'unlock_at', now() + interval '7 days');
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_sortie_mode(int) TO authenticated;

-- ③ 通常出撃ロック（管理者: sortie_mode 10/20、非管理者: 従来＋ブースト10） --
CREATE OR REPLACE FUNCTION public.sortie_lock()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_row  profiles%ROWTYPE;
  v_wait int;
  v_left numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_row.is_fishing THEN RETURN json_build_object('ok',false,'reason','fishing'); END IF;

  -- ★2026-06-26 is_admin先行: 管理者は sortie_mode（10/20）。非管理者は従来20秒・ブースト中10秒。
  v_wait := CASE
    WHEN COALESCE(v_row.is_admin,false) THEN (CASE WHEN v_row.sortie_mode = 10 THEN 10 ELSE 20 END)
    WHEN v_row.boost_active_until IS NOT NULL AND v_row.boost_active_until > now() THEN 10
    ELSE 20 END;

  IF v_row.last_action_at IS NOT NULL THEN
    v_left := v_wait - EXTRACT(EPOCH FROM (now() - v_row.last_action_at));
    IF v_left > 0 THEN
      RETURN json_build_object('ok',false,'reason','cooldown','seconds_left',round(v_left,1));
    END IF;
  END IF;

  UPDATE profiles SET last_action_at = now() WHERE id = v_uid;
  RETURN json_build_object('ok',true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.sortie_lock() TO authenticated;

-- ④ デイリーダンジョン消費RPC（CDを管理者 sortie_mode 対応に。他は据え置き） --
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

  -- ★2026-06-26: デイリーダンジョンはCDなし（回数制限のみ）。CD判定・last_action_at更新は行わない。

  v_today := (now() AT TIME ZONE 'Asia/Tokyo' - interval '5 hours')::date;

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

  UPDATE dungeon_attempts SET
    cnt_exp   = COALESCE(cnt_exp,0)   + (CASE WHEN p_type='exp'   THEN 1 ELSE 0 END),
    cnt_gold  = COALESCE(cnt_gold,0)  + (CASE WHEN p_type='gold'  THEN 1 ELSE 0 END),
    cnt_stone = COALESCE(cnt_stone,0) + (CASE WHEN p_type='stone' THEN 1 ELSE 0 END),
    cnt_prof  = COALESCE(cnt_prof,0)  + (CASE WHEN p_type='prof'  THEN 1 ELSE 0 END),
    cnt_gem   = COALESCE(cnt_gem,0)   + (CASE WHEN p_type='gem'   THEN 1 ELSE 0 END)
  WHERE player_id = v_uid AND date = v_today;

  -- ★2026-06-26: CDなし化に伴い last_action_at は更新しない（街出撃CDに影響させない）。

  RETURN json_build_object('ok',true,'count',v_cur + 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.dungeon_consume(text) TO authenticated;

-- ⑤ レイド出撃CD（管理者のみ10秒固定。非管理者は20秒のまま） ----
CREATE OR REPLACE FUNCTION attack_raid_boss(p_raid_id uuid, p_damage bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id   uuid;
  v_profile     profiles%ROWTYPE;
  v_boss        raid_boss%ROWTYPE;
  v_damage      bigint;
  v_new_hp      bigint;
  v_cooldown    int := 20;
  v_expire_at   timestamptz;
  v_exp_gain    int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'ボスが見つかりません'); END IF;

  v_expire_at := v_boss.spawned_at + interval '30 minutes';
  IF v_boss.status = 'active' AND now() > v_expire_at THEN
    UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
    RETURN json_build_object('error', '時間切れです（討伐失敗）');
  END IF;
  IF v_boss.status != 'active' THEN RETURN json_build_object('error', 'このボスは既に討伐済みか期限切れです'); END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_player_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'キャラクターが見つかりません'); END IF;
  IF v_profile.is_suspended THEN RETURN json_build_object('error', 'アカウント停止中'); END IF;

  -- ★2026-06-26 is_admin先行: 管理者はレイド10秒固定（公開時は全員10秒に）
  v_cooldown := CASE WHEN COALESCE(v_profile.is_admin,false) THEN 10 ELSE 20 END;

  IF v_profile.last_action_at IS NOT NULL THEN
    IF now() - v_profile.last_action_at < (v_cooldown || ' seconds')::interval THEN
      RETURN json_build_object(
        'error', 'cooldown',
        'seconds_left', v_cooldown - EXTRACT(EPOCH FROM (now() - v_profile.last_action_at))::int
      );
    END IF;
  END IF;

  v_damage := LEAST(p_damage, 1000000);
  v_damage := GREATEST(v_damage, 0);
  v_new_hp := GREATEST(0, v_boss.hp_current - v_damage);

  UPDATE raid_boss
  SET hp_current  = v_new_hp,
      status      = CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
      defeated_at = CASE WHEN v_new_hp = 0 THEN now() ELSE NULL END
  WHERE id = p_raid_id;

  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, attack_count, last_attack_at)
  VALUES (p_raid_id, v_player_id, v_damage, 1, now())
  ON CONFLICT (raid_id, player_id) DO UPDATE
  SET damage_dealt   = raid_participants.damage_dealt + v_damage,
      attack_count   = raid_participants.attack_count + 1,
      last_attack_at = now();

  v_exp_gain := 10;

  PERFORM set_config('app.allow_stat_change', 'on', true);
  UPDATE profiles SET
    hp_current     = v_profile.hp_max,
    mp_current     = v_profile.mp_max,
    exp            = COALESCE(exp, 0) + v_exp_gain,
    last_action_at = now()
  WHERE id = v_player_id;

  RETURN json_build_object(
    'damage',     v_damage,
    'hp_current', v_new_hp,
    'hp_max',     v_boss.hp_max,
    'status',     CASE WHEN v_new_hp = 0 THEN 'defeated' ELSE 'active' END,
    'exp',        COALESCE(v_profile.exp, 0) + v_exp_gain,
    'exp_gained', v_exp_gain
  );
END;
$$;
GRANT EXECUTE ON FUNCTION attack_raid_boss(uuid, bigint) TO authenticated;

-- ⑥ 列保護トリガー（sortie_mode 系も RPC 経由のみ許可に拡張） -----
CREATE OR REPLACE FUNCTION public.protect_boost_papia()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_boost_change', true) IS DISTINCT FROM 'on' THEN
    IF NEW.boost_active_until  IS DISTINCT FROM OLD.boost_active_until
       OR NEW.boost_used_date  IS DISTINCT FROM OLD.boost_used_date
       OR NEW.papia_hour       IS DISTINCT FROM OLD.papia_hour
       OR NEW.papia_hour2      IS DISTINCT FROM OLD.papia_hour2
       OR NEW.papia_hour_set_at IS DISTINCT FROM OLD.papia_hour_set_at
       OR NEW.sortie_mode        IS DISTINCT FROM OLD.sortie_mode
       OR NEW.sortie_mode_set_at IS DISTINCT FROM OLD.sortie_mode_set_at THEN
      RAISE EXCEPTION '不正な操作です（出撃/ブースト/パピア設定はサーバー経由でのみ変更できます）';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_boost_papia ON public.profiles;
CREATE TRIGGER trg_protect_boost_papia
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_boost_papia();
