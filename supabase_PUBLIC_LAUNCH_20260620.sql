-- ⚠⚠【2026-07-04 注意】このファイルの apply_battle_result は旧Gold上限(v_normal_golds=[8,30,100,180,300,450,700])。
-- ⚠⚠ 再適用したら必ず「最後に」supabase_mutant_gold_20260703.sql を流し直すこと。
-- ⚠⚠ 流さないと現行クライアント(263772e以降)の出撃が全プレイヤー invalid_gold 誤検知→EXP12時間凍結になる。
-- 本番公開 一括SQL 2026-06-20（メンテ中にこの順で実行）

-- ===== [1/7] sortie_boost =====
-- ============================================================
-- 出撃改善 2026-06-20  ★is_admin限定先行（一般プレイヤーは従来どおり）
--   ① 通常出撃クールダウン: 管理者のみ 10→20秒（非管理者は10秒のまま）
--   ② ブーストタイム: 管理者のみ 1日1回30分、街の出撃CDが10秒に短縮
--   ③ レベルアップ必要EXP: 管理者のみ半減（非管理者は従来値）
--
--   ※ レイド出撃CD/回数ティアの管理者先行は supabase_raid_cooldown_fix.sql / supabase_raid_update_20260610.sql を再適用。
--   ※ 一般公開時は各関数の is_admin 分岐を外す（このファイルのコメントの「公開時」を参照）。
--   ※ pure関数置換＋列追加＋新RPCのみ。protect_stats等の戦闘/報酬関数には触れないため適用順は任意。
-- ============================================================

-- ① ブースト管理列＋パピア時間帯（プレイヤー選択） ----------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS boost_active_until timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS boost_used_date    date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS papia_hour        int;          -- パピア出現率アップ開始時刻(JST 0-23) 枠1。NULL=未設定
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS papia_hour2       int;          -- パピア枠2(JST 0-23)。NULL=未設定
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS papia_hour_set_at timestamptz;  -- 設定日時（変更は1か月に1回まで）

-- パピア時間帯の設定RPC（is_admin限定先行・2枠・一度決めたら1か月変更不可）
DROP FUNCTION IF EXISTS public.set_papia_hour(int);
CREATE OR REPLACE FUNCTION public.set_papia_hour(p_hour int, p_hour2 int DEFAULT NULL)
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
  IF p_hour IS NULL OR p_hour < 0 OR p_hour > 23 THEN RETURN json_build_object('ok',false,'reason','invalid_hour'); END IF;
  IF p_hour2 IS NOT NULL AND (p_hour2 < 0 OR p_hour2 > 23) THEN RETURN json_build_object('ok',false,'reason','invalid_hour'); END IF;
  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  -- ★2026-06-20公開: 全プレイヤー設定可
  -- 一度決めたら1か月（30日）変更不可
  IF v_row.papia_hour_set_at IS NOT NULL AND now() < v_row.papia_hour_set_at + interval '30 days' THEN
    RETURN json_build_object('ok',false,'reason','locked',
      'papia_hour', v_row.papia_hour, 'papia_hour2', v_row.papia_hour2,
      'unlock_at', v_row.papia_hour_set_at + interval '30 days');
  END IF;
  PERFORM set_config('app.allow_boost_change','on',true);  -- ★列保護トリガー許可
  UPDATE profiles SET papia_hour = p_hour, papia_hour2 = p_hour2, papia_hour_set_at = now() WHERE id = v_uid;
  RETURN json_build_object('ok',true,'papia_hour', p_hour, 'papia_hour2', p_hour2, 'unlock_at', now() + interval '30 days');
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_papia_hour(int, int) TO authenticated;

-- ② 通常出撃ロック（管理者: ブースト中10秒/通常20秒、非管理者: 10秒） ----
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

  -- 行ロックで連打・複数端末を直列化
  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;
  IF v_row.is_fishing THEN RETURN json_build_object('ok',false,'reason','fishing'); END IF;

  -- ★2026-06-20公開: 全プレイヤー20秒・ブースト中10秒
  v_wait := CASE WHEN v_row.boost_active_until IS NOT NULL AND v_row.boost_active_until > now()
                 THEN 10 ELSE 20 END;

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

-- ②-2 ブースト発動RPC（管理者限定・1日1回・30分） -----------------
CREATE OR REPLACE FUNCTION public.start_boost()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   profiles%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo' - interval '5 hours')::date;  -- 日次リセットはJST朝5時基準（5時より前は前日扱い）
  v_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;

  SELECT * INTO v_row FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  -- ★2026-06-20公開: 全プレイヤー発動可
  -- すでにブースト中
  IF v_row.boost_active_until IS NOT NULL AND v_row.boost_active_until > now() THEN
    RETURN json_build_object('ok',false,'reason','active',
      'boost_active_until', v_row.boost_active_until, 'boost_used_date', v_row.boost_used_date);
  END IF;

  -- 本日分は使用済み
  IF v_row.boost_used_date = v_today THEN
    RETURN json_build_object('ok',false,'reason','already_used',
      'boost_used_date', v_row.boost_used_date);
  END IF;

  v_until := now() + interval '30 minutes';
  PERFORM set_config('app.allow_boost_change','on',true);  -- ★列保護トリガー許可
  UPDATE profiles SET boost_active_until = v_until, boost_used_date = v_today WHERE id = v_uid;

  RETURN json_build_object('ok',true,'boost_active_until', v_until, 'boost_used_date', v_today);
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_boost() TO authenticated;

-- ③ レベルアップ必要EXP（管理者のみ半減。クライアント calcExpNext と一致） --
--   STABLE: 呼び出しユーザー(auth.uid())の is_admin を参照するため IMMUTABLE 不可。
--   apply_battle_result / casino_settle_sortie からは calc_exp_next(lv) 呼び出しのまま
--   auth.uid() 経由で当人の is_admin が効くので、それらの関数の再定義は不要。
--   公開時は「常に半減（base/2）」に変更する。
-- ★2026-06-20公開: 全プレイヤー「半減＋10」。auth.uid()依存をやめ IMMUTABLE に戻す。
CREATE OR REPLACE FUNCTION public.calc_exp_next(lv integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_in_block integer;
  v_base     integer;
BEGIN
  IF lv >= 100 THEN
    v_base := CASE WHEN lv <= 150 THEN 150 WHEN lv <= 200 THEN 160 WHEN lv <= 250 THEN 170 ELSE 180 END;
  ELSE
    v_in_block := (lv - 1) % 100;
    v_base := CASE WHEN v_in_block < 9 THEN 80 WHEN v_in_block < 29 THEN 100 WHEN v_in_block < 59 THEN 120 ELSE 140 END;
  END IF;
  RETURN floor(v_base / 2.0)::integer + 10;
END;
$$;

-- ★2026-06-20公開: boost/papia 列の直接書き換え対策（start_boost / set_papia_hour 経由のみ許可）
--   通常UPDATEでこれらの列を変えると拒否。RPCは app.allow_boost_change='on' を立ててから更新する。
CREATE OR REPLACE FUNCTION public.protect_boost_papia()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_boost_change', true) IS DISTINCT FROM 'on' THEN
    IF NEW.boost_active_until IS DISTINCT FROM OLD.boost_active_until
       OR NEW.boost_used_date  IS DISTINCT FROM OLD.boost_used_date
       OR NEW.papia_hour       IS DISTINCT FROM OLD.papia_hour
       OR NEW.papia_hour2      IS DISTINCT FROM OLD.papia_hour2
       OR NEW.papia_hour_set_at IS DISTINCT FROM OLD.papia_hour_set_at THEN
      RAISE EXCEPTION '不正な操作です（ブースト/パピア設定はサーバー経由でのみ変更できます）';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_boost_papia ON public.profiles;
CREATE TRIGGER trg_protect_boost_papia
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_boost_papia();

-- ===== [2/7] raid_cooldown_fix =====
-- ============================================================
-- レイドボス 0秒出撃（クールダウンすり抜け）対策 (2026-06-11)
--   原因: attack_raid_boss が profiles を行ロック無しで SELECT してから
--         last_action_at をチェック→更新していたため、連打・複数端末・
--         二重発火で複数リクエストが同時にCDチェックを通過できた。
--   修正: profiles を SELECT ... FOR UPDATE で行ロックし、同一プレイヤーの
--         attack_raid_boss を直列化。これでCDチェックがすり抜けない。
--   ※ supabase_scarecrow.sql の attack_raid_boss（かかし修練ガード入り・最新版）
--     を完全置換。差分は v_profile の SELECT に FOR UPDATE を足しただけ。
-- ============================================================
CREATE OR REPLACE FUNCTION attack_raid_boss(p_raid_id uuid, p_damage bigint)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id   uuid;
  v_profile     profiles%ROWTYPE;
  v_boss        raid_boss%ROWTYPE;
  v_damage      bigint;
  v_new_hp      bigint;
  v_cooldown    int := 20;   -- ★2026-06-20公開: 全プレイヤー20秒（ブースト対象外）
  v_expire_at   timestamptz;
  v_exp_gain    int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  -- かかし修練は時間経過待ちの放置型のため、その間もレイド出撃は許可する
  -- （以前は「かかし修練中は出撃できません」で弾いていたが、ユーザー要望で解除）

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'ボスが見つかりません'); END IF;

  v_expire_at := v_boss.spawned_at + interval '30 minutes';
  IF v_boss.status = 'active' AND now() > v_expire_at THEN
    UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
    RETURN json_build_object('error', '時間切れです（討伐失敗）');
  END IF;

  IF v_boss.status != 'active' THEN RETURN json_build_object('error', 'このボスは既に討伐済みか期限切れです'); END IF;

  -- ★ FOR UPDATE で行ロック：同一プレイヤーの同時/連打リクエストを直列化し
  --   クールダウンチェックのすり抜け（0秒出撃）を防ぐ
  SELECT * INTO v_profile FROM profiles WHERE id = v_player_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'キャラクターが見つかりません'); END IF;
  IF v_profile.is_suspended THEN RETURN json_build_object('error', 'アカウント停止中'); END IF;

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

  -- かかし修練中もレイド出撃EXPを付与する（2026-06-19仕様変更）
  v_exp_gain := 10;

  -- 共有CD更新 + 出撃報酬（HP/MP全回復・EXP+v_exp_gain）
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

-- ===== [3/7] raid_update =====
-- ============================================================
-- レイドボス アップデート 2026-06-10
--  ① ヴァルゼノク HP 100万（spawn RPC）
--  ② 30分で討伐できなかった場合（expired）でも、その時点の貢献度で討伐報酬を受け取れる
--  ③ 出撃回数ティア保証: 50/20/5（is_admin先行で管理者のみ25/10/3。2026-06-20）
--  ④ 交換所: マレディクシオン（銃S）追加 / 強化石(S) 交換追加（鱗×70 or 逆鱗×2）
--  ⑤ do_exchange を item 報酬対応に更新
-- ※ supabase_protect_stats.sql 適用済み環境を想定（claim 内で GUC を立ててから profiles を更新）
-- Supabase の SQL Editor でファイル全体を実行してください
-- ============================================================

-- ============================================================
-- ① スポーンRPC（HP 1,000,000）
-- ============================================================
CREATE OR REPLACE FUNCTION spawn_raid_boss_if_needed()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jst_now   timestamptz;
  v_jst_date  date;
  v_jst_hour  int;
  v_boss      raid_boss%ROWTYPE;
  v_expire_at timestamptz;
BEGIN
  v_jst_now  := now() AT TIME ZONE 'Asia/Tokyo';
  v_jst_date := v_jst_now::date;
  v_jst_hour := EXTRACT(hour FROM v_jst_now)::int;

  -- 21時前: アクティブなボスがあれば返す
  IF v_jst_hour < 21 THEN
    SELECT * INTO v_boss FROM raid_boss WHERE status = 'active' ORDER BY spawn_date DESC LIMIT 1;
    IF FOUND THEN
      v_expire_at := v_boss.spawned_at + interval '30 minutes';
      IF now() > v_expire_at THEN
        UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
        v_boss.status := 'expired';
      END IF;
      IF v_boss.status = 'active' THEN
        RETURN json_build_object(
          'status', v_boss.status, 'id', v_boss.id,
          'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
          'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
          'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at
        );
      END IF;
    END IF;
    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object(
        'status', v_boss.status, 'id', v_boss.id,
        'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
        'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
        'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at
      );
    END IF;
    RETURN json_build_object(
      'status', 'waiting',
      'next_spawn', (v_jst_date::text || 'T21:00:00+09:00')
    );
  END IF;

  -- 21時以降: 今日のボスを取得または生成（HP 100万）
  SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date;
  IF NOT FOUND THEN
    UPDATE raid_boss SET status = 'expired' WHERE status = 'active' AND spawn_date < v_jst_date;

    INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at)
    VALUES (v_jst_date, '黒龍ヴァルゼノク', 1000000, 1000000, 'active', now())
    ON CONFLICT (spawn_date) DO NOTHING;

    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date = v_jst_date;
  END IF;

  IF v_boss.status = 'active' THEN
    v_expire_at := v_boss.spawned_at + interval '30 minutes';
    IF now() > v_expire_at THEN
      UPDATE raid_boss SET status = 'expired' WHERE id = v_boss.id;
      v_boss.status := 'expired';
    END IF;
  END IF;

  RETURN json_build_object(
    'status', v_boss.status, 'id', v_boss.id,
    'boss_name', v_boss.boss_name, 'hp_max', v_boss.hp_max,
    'hp_current', v_boss.hp_current, 'spawn_date', v_boss.spawn_date,
    'defeated_at', v_boss.defeated_at, 'spawned_at', v_boss.spawned_at
  );
END;
$$;

-- ============================================================
-- ②③ リワード受け取り（expired でも受け取り可＋出撃回数ティア保証）
--  ティア: A=貢献10%+ or 出撃50回+ / B=貢献6%+ or 出撃20回+
--          C=貢献3%+ or 出撃5回+  / D=参加
-- ============================================================
CREATE OR REPLACE FUNCTION claim_raid_rewards(p_raid_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id        uuid;
  v_boss             raid_boss%ROWTYPE;
  v_participant      raid_participants%ROWTYPE;
  v_total_eff        bigint;
  v_my_eff           bigint;
  v_contribution     float;
  v_tier             text;
  v_gold             int;
  v_stone_ranks      text[];
  v_stone_name       text;
  v_stone_item_id    int;
  v_gem_count        int;
  v_gem_type         text;
  v_gem_rank         text;
  v_gem_types        text[] := ARRAY[
    'peridot','lapis','ruby','sapphire','amethyst','emerald','topaz',
    'rosequartz','turquoise','morganite','kunzite','citrine','onyx','opal','moonstone','petalite'
  ];
  v_existing_gem_id  uuid;
  v_i                int;
  v_rank             text;
  v_scale_min        int;
  v_scale_max        int;
  v_scale_count      int;
  v_scale_item_id    int;
  v_gyaku_item_id    int;
  v_gyaku_chance     float;
  v_got_gyaku        boolean := false;
  v_is_admin         boolean;
  v_atk_a            int := 20;   -- ★2026-06-20公開: 全プレイヤー 20/10/5
  v_atk_b            int := 10;
  v_atk_c            int := 5;
  v_mat_name         text;   -- ★通常素材名（ボス別）
  v_rare_name        text;   -- ★レア素材名（ボス別）
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'レイドが見つかりません'); END IF;
  -- 討伐成功(defeated)だけでなく時間切れ(expired)でも、その時点の貢献度で報酬獲得可
  IF v_boss.status NOT IN ('defeated', 'expired') THEN
    RETURN json_build_object('error', 'レイドはまだ終了していません');
  END IF;

  SELECT * INTO v_participant FROM raid_participants WHERE raid_id = p_raid_id AND player_id = v_player_id;
  IF NOT FOUND THEN RETURN json_build_object('error', '参加記録がありません'); END IF;
  IF v_participant.reward_claimed THEN RETURN json_build_object('error', '既にリワードを受け取り済みです'); END IF;

  -- ★2026-06-20公開: 全プレイヤー 20/10/5（既定値に反映済み）

  -- 有効スコアで貢献度計算（出撃1回=500ボーナス）
  SELECT COALESCE(SUM(damage_dealt + attack_count * 500), 1) INTO v_total_eff FROM raid_participants WHERE raid_id = p_raid_id;
  v_my_eff       := v_participant.damage_dealt + v_participant.attack_count * 500;
  v_contribution := v_my_eff::float / v_total_eff::float;

  -- ティア決定（貢献度 or 出撃回数のどちらか高い方）
  -- 2026-06-20: is_admin限定先行。管理者は出撃回数ラインを半減(25/10/3)、非管理者は従来(50/20/5)。
  IF v_contribution >= 0.10 OR v_participant.attack_count >= v_atk_a THEN
    v_tier := 'A'; v_gold := 150000; v_stone_ranks := ARRAY['B','C','D'];
    v_gem_count := 2; v_gem_rank := 'D'; v_scale_min := 8; v_scale_max := 10; v_gyaku_chance := 0.15;
  ELSIF v_contribution >= 0.06 OR v_participant.attack_count >= v_atk_b THEN
    v_tier := 'B'; v_gold := 90000; v_stone_ranks := ARRAY['C','D','E'];
    v_gem_count := 2; v_gem_rank := 'E'; v_scale_min := 6; v_scale_max := 8; v_gyaku_chance := 0.08;
  ELSIF v_contribution >= 0.03 OR v_participant.attack_count >= v_atk_c THEN
    v_tier := 'C'; v_gold := 30000; v_stone_ranks := ARRAY['D','E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 4; v_scale_max := 6; v_gyaku_chance := 0.03;
  ELSE
    v_tier := 'D'; v_gold := 15000; v_stone_ranks := ARRAY['E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 1; v_scale_max := 3; v_gyaku_chance := 0.0;
  END IF;
  v_scale_count := v_scale_min + (random() * (v_scale_max - v_scale_min))::int;

  -- ★ボス別の素材名（雨摩座=水禍素材／その他=黒龍素材）
  IF v_boss.boss_name = '雨摩座' THEN
    v_mat_name := '水禍の雫'; v_rare_name := '雨禍の心核';
  ELSE
    v_mat_name := '黒龍の鱗'; v_rare_name := '黒龍の逆鱗';
  END IF;

  -- Gold付与（保護トリガー対応）
  PERFORM set_config('app.allow_stat_change', 'on', true);
  UPDATE profiles SET gold = gold + v_gold WHERE id = v_player_id;

  -- 強化石付与（各ランク×3）
  FOREACH v_rank IN ARRAY v_stone_ranks LOOP
    v_stone_name := '強化石(' || v_rank || ')';
    SELECT id INTO v_stone_item_id FROM items WHERE name = v_stone_name LIMIT 1;
    IF v_stone_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_stone_item_id, 2, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 2;
    END IF;
  END LOOP;

  -- 宝石付与
  FOR v_i IN 1..v_gem_count LOOP
    v_gem_type := v_gem_types[1 + (random() * (array_length(v_gem_types, 1) - 1))::int];
    SELECT id INTO v_existing_gem_id FROM player_gems WHERE player_id = v_player_id AND gem_type = v_gem_type AND rank = v_gem_rank;
    IF FOUND THEN
      UPDATE player_gems SET quantity = quantity + 1 WHERE id = v_existing_gem_id;
    ELSE
      INSERT INTO player_gems (player_id, gem_type, rank, quantity) VALUES (v_player_id, v_gem_type, v_gem_rank, 1);
    END IF;
  END LOOP;

  -- 通常素材（ボス別: 黒龍の鱗 / 水禍の雫）
  SELECT id INTO v_scale_item_id FROM items WHERE name = v_mat_name LIMIT 1;
  IF v_scale_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_scale_item_id, v_scale_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_scale_count;
  END IF;

  -- レア素材（ボス別: 黒龍の逆鱗 / 雨禍の心核）（確率）
  IF v_gyaku_chance > 0 AND random() < v_gyaku_chance THEN
    v_got_gyaku := true;
    SELECT id INTO v_gyaku_item_id FROM items WHERE name = v_rare_name LIMIT 1;
    IF v_gyaku_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_gyaku_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  UPDATE raid_participants SET reward_claimed = true WHERE id = v_participant.id;

  RETURN json_build_object(
    'success',          true,
    'tier',             v_tier,
    'contribution_pct', round((v_contribution * 100)::numeric, 1),
    'gold',             v_gold,
    'stones',           to_json(v_stone_ranks),
    'gem_count',        v_gem_count,
    'gem_rank',         v_gem_rank,
    'scale_count',      v_scale_count,
    'got_gyaku',        v_got_gyaku,
    'mat_name',         v_mat_name,
    'rare_name',        v_rare_name
  );
END;
$$;

-- ============================================================
-- ④ 交換所: マレディクシオン＋強化石(S)
-- ============================================================

-- max_per_player の NULL（無制限）許可＆exchange_count カラム保証
ALTER TABLE exchange_shop ALTER COLUMN max_per_player DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exchange_records' AND column_name = 'exchange_count'
  ) THEN
    ALTER TABLE exchange_records ADD COLUMN exchange_count int NOT NULL DEFAULT 1;
  END IF;
END $$;

-- 武器: マレディクシオン（銃S 攻撃60 特攻60 素早さ10）
INSERT INTO weapons (name, weapon_type, slot, rarity, atk_bonus, def_bonus, matk_bonus, mdef_bonus, spd_bonus)
SELECT 'マレディクシオン', 'gun', 'weapon', 's', 60, 0, 60, 0, 10
WHERE NOT EXISTS (SELECT 1 FROM weapons WHERE name = 'マレディクシオン');

-- 交換所エントリー（再実行しても重複しないよう NOT EXISTS ガード）
INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT 'マレディクシオン',
       'S級銃。攻撃ヒット時、2ターンの間対象の回復力-10%。',
       '[{"item_name": "黒龍の鱗", "quantity": 50}, {"item_name": "黒龍の逆鱗", "quantity": 1}]'::jsonb,
       'weapon', 'マレディクシオン', 'hit_heal_down_10_2t', 5, true, 2, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = 'マレディクシオン');

-- 表示順: ヴァルブレイカー(1) → マレディクシオン(2) → 黒龍の鎧(3) → 強化石(4,5)
UPDATE exchange_shop SET sort_order = 2 WHERE name = 'マレディクシオン';
UPDATE exchange_shop SET sort_order = 3 WHERE name = '黒龍の鎧';

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【鱗】',
       'S級強化石1個と交換。',
       '[{"item_name": "黒龍の鱗", "quantity": 70}]'::jsonb,
       'item', '強化石(S)', null, null, true, 4, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【鱗】');

INSERT INTO exchange_shop (name, description, cost_items, reward_type, reward_weapon_name, reward_bonus_effect, max_per_player, active, sort_order, tab)
SELECT '強化石(S)【逆鱗】',
       'S級強化石1個と交換。',
       '[{"item_name": "黒龍の逆鱗", "quantity": 2}]'::jsonb,
       'item', '強化石(S)', null, null, true, 5, 'レイドボス'
WHERE NOT EXISTS (SELECT 1 FROM exchange_shop WHERE name = '強化石(S)【逆鱗】');

-- ============================================================
-- ⑤ do_exchange（item 報酬対応＋回数制限・カウント対応）
-- ============================================================
CREATE OR REPLACE FUNCTION do_exchange(p_shop_id int)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id  uuid;
  v_shop       exchange_shop%ROWTYPE;
  v_entry      jsonb;
  v_item_name  text;
  v_qty        int;
  v_item_id    int;
  v_held       int;
  v_weapon_id  int;
  v_reward_item_id int;
  v_done_count int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_shop FROM exchange_shop WHERE id = p_shop_id AND active = true;
  IF NOT FOUND THEN RETURN json_build_object('error', '交換項目が見つかりません'); END IF;

  -- 回数制限（max_per_player が NULL なら無制限）
  IF v_shop.max_per_player IS NOT NULL THEN
    SELECT COALESCE(SUM(exchange_count), 0) INTO v_done_count
    FROM exchange_records WHERE player_id = v_player_id AND shop_id = p_shop_id;
    IF v_done_count >= v_shop.max_per_player THEN
      RETURN json_build_object('error', '交換回数の上限に達しています');
    END IF;
  END IF;

  -- 素材所持確認
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_shop.cost_items) LOOP
    v_item_name := v_entry->>'item_name';
    v_qty       := (v_entry->>'quantity')::int;
    SELECT id INTO v_item_id FROM items WHERE name = v_item_name LIMIT 1;
    IF v_item_id IS NULL THEN RETURN json_build_object('error', v_item_name || 'が存在しません'); END IF;
    SELECT COALESCE(quantity, 0) INTO v_held FROM player_items WHERE player_id = v_player_id AND item_id = v_item_id;
    IF v_held IS NULL OR v_held < v_qty THEN
      RETURN json_build_object('error', v_item_name || 'が不足しています（必要: ' || v_qty || '個、所持: ' || COALESCE(v_held, 0) || '個）');
    END IF;
  END LOOP;

  -- 素材消費
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_shop.cost_items) LOOP
    v_item_name := v_entry->>'item_name';
    v_qty       := (v_entry->>'quantity')::int;
    SELECT id INTO v_item_id FROM items WHERE name = v_item_name LIMIT 1;
    UPDATE player_items SET quantity = quantity - v_qty WHERE player_id = v_player_id AND item_id = v_item_id;
    DELETE FROM player_items WHERE player_id = v_player_id AND item_id = v_item_id AND quantity <= 0;
  END LOOP;

  -- 報酬付与
  IF v_shop.reward_type = 'weapon' THEN
    SELECT id INTO v_weapon_id FROM weapons WHERE name = v_shop.reward_weapon_name LIMIT 1;
    IF v_weapon_id IS NULL THEN RETURN json_build_object('error', '報酬装備が見つかりません'); END IF;
    INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
    SELECT v_player_id, v_weapon_id, w.slot, false, 0, v_shop.reward_bonus_effect
    FROM weapons w WHERE w.id = v_weapon_id;
  ELSIF v_shop.reward_type = 'item' THEN
    SELECT id INTO v_reward_item_id FROM items WHERE name = v_shop.reward_weapon_name LIMIT 1;
    IF v_reward_item_id IS NULL THEN RETURN json_build_object('error', '報酬アイテムが見つかりません'); END IF;
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_reward_item_id, 1, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
  END IF;

  -- 交換記録（回数加算）
  INSERT INTO exchange_records (player_id, shop_id, exchange_count)
  VALUES (v_player_id, p_shop_id, 1)
  ON CONFLICT (player_id, shop_id) DO UPDATE
  SET exchange_count = exchange_records.exchange_count + 1,
      exchanged_at   = now();

  RETURN json_build_object('success', true, 'reward_name', v_shop.reward_weapon_name);
END;
$$;

-- ===== [4/7] apply_battle_result =====
-- ============================================================
-- かかし修練場チャージ: is_admin限定先行で 100回→50回 (2026-06-20)
--   出撃CD20秒化に合わせ、管理者のみ「出撃50回で1チャージ」。非管理者は従来100回。
--   ★本番で稼働中の apply_battle_result 定義（pg_get_functiondefでダンプして確認したもの）を
--     そのまま使い、かかしチャージのしきい値のみ v_sc_need で is_admin 分岐に変更。
--     他ロジック（ダンジョンブロック / GUC / EXP1.5倍 / レベルアップ / Gold検証 等）は一切不変。
--   公開時は v_sc_need の既定を 50 にするか、is_admin 分岐を外す。
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS eff_hp_max integer;  -- HP検証用の実効最大HP（クライアントが戦闘前にキャッシュ）
CREATE OR REPLACE FUNCTION public.apply_battle_result(p_area_id integer, p_is_boss boolean, p_is_papia boolean, p_papia_escaped boolean, p_win boolean, p_claimed_exp integer, p_claimed_gold integer, p_hp_current integer, p_mp_current integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_class_lv integer;
  v_cap integer;
  v_is_at_cap boolean;
  v_exp_frozen boolean;
  v_max_gold integer;
  v_max_exp integer;
  v_eff_exp integer;
  v_new_exp integer; v_new_lv integer; v_new_exp_next integer;
  v_new_char_lv integer; v_new_pending integer;
  v_new_boss_rate numeric;
  v_new_unlocked integer[];
  v_level_ups integer := 0;
  v_boss_golds   integer[] := ARRAY[50, 250, 1000, 2500, 6000, 12500, 25000];
  v_normal_golds integer[] := ARRAY[8,   30,  100,  180,  300,   450,   700];
  v_sc_week date;
  v_sc_charges int;
  v_sc_progress int;
  v_sc_earned int;
  v_sc_charged boolean := false;
  v_sc_need int;   -- ★追加: かかしチャージ必要出撃回数（管理者50 / それ以外100）
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  -- ★ペットダンジョン探索中は出撃不可（別端末対策）
  IF has_active_dungeon(v_uid) THEN
    RETURN json_build_object('ok',false,'reason','dungeon_active');
  END IF;

  PERFORM set_config('app.allow_stat_change','on',true);  -- ★保護トリガー許可

  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;
  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());

  IF NOT p_win OR p_papia_escaped OR p_is_papia THEN v_max_gold := 0;
  ELSIF p_is_boss AND p_area_id BETWEEN 1 AND 7 THEN v_max_gold := v_boss_golds[p_area_id];
  ELSIF p_area_id BETWEEN 1 AND 7 THEN v_max_gold := v_normal_golds[p_area_id];
  ELSE v_max_gold := 700; END IF;
  -- ★2026-06-20公開: 全プレイヤー エリア1-4×2・エリア5+×1.5
  v_max_gold := CEIL(v_max_gold * (CASE WHEN p_area_id <= 4 THEN 2.0 ELSE 1.5 END));

  IF p_claimed_gold < 0 OR p_claimed_gold > v_max_gold THEN
    UPDATE profiles SET suspicious_flag=true,
      exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
    WHERE id=v_uid;
    INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
    VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
    RETURN json_build_object('ok',false,'reason','invalid_gold');
  END IF;

  IF NOT v_exp_frozen AND NOT v_is_at_cap AND NOT p_papia_escaped THEN
    IF p_is_papia THEN v_max_exp := 200;
    ELSIF p_is_boss THEN v_max_exp := 13;
    ELSE v_max_exp := 11; END IF;
    -- ★キャラクターLV100未満は経験値1.5倍（クライアントと一致）。上限も1.5倍にしないと誤検知でEXP凍結する
    IF COALESCE(v_profile.char_lv, 1) < 100 THEN v_max_exp := CEIL(v_max_exp * 1.5); END IF;

    IF p_claimed_exp < 0 OR p_claimed_exp > v_max_exp THEN
      UPDATE profiles SET suspicious_flag=true,
        exp_frozen_until=GREATEST(COALESCE(exp_frozen_until,now()), now()+interval'12 hours')
      WHERE id=v_uid;
      INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,suspicious)
      VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,p_claimed_exp,p_claimed_gold,true);
      RETURN json_build_object('ok',false,'reason','invalid_exp');
    END IF;
  END IF;

  -- ★HP上限は装備・釣り等込みの実効最大(eff_hp_max)を許容。spoof対策に基礎の5倍でガード。
  IF p_hp_current < 0 OR p_hp_current >
       LEAST(GREATEST(COALESCE(v_profile.eff_hp_max, v_profile.hp_max), v_profile.hp_max), v_profile.hp_max * 5) THEN
    RETURN json_build_object('ok',false,'reason','invalid_hp'); END IF;

  v_eff_exp      := CASE WHEN v_exp_frozen OR v_is_at_cap OR p_papia_escaped THEN 0 ELSE p_claimed_exp END;
  v_new_exp      := COALESCE(v_profile.exp, 0) + v_eff_exp;
  v_new_lv       := v_profile.lv;
  v_new_exp_next := calc_exp_next(v_new_lv);
  v_new_pending  := COALESCE(v_profile.pending_stat_points, 0);
  v_new_char_lv  := COALESCE(v_profile.char_lv, 1);

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    WHILE v_new_exp >= v_new_exp_next AND v_new_lv < v_cap LOOP
      v_new_exp := v_new_exp - v_new_exp_next;
      v_new_lv := v_new_lv + 1;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := v_new_pending + 1;
      v_new_char_lv := v_new_char_lv + 1;
      v_level_ups := v_level_ups + 1;
    END LOOP;
    IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(v_cap); END IF;
  END IF;

  v_new_boss_rate := CASE WHEN p_is_boss THEN 0
    ELSE COALESCE(v_profile.boss_encounter_rate,0)+0.5 END;
  v_new_unlocked := COALESCE(v_profile.unlocked_areas, ARRAY[1]);
  IF p_win AND p_is_boss AND p_area_id < 7
    AND NOT (v_new_unlocked @> ARRAY[p_area_id+1]) THEN
    v_new_unlocked := array_append(v_new_unlocked, p_area_id+1);
  END IF;

  INSERT INTO battle_logs(player_id,area_id,is_boss,is_papia,win,exp_gained,gold_gained,level_ups)
  VALUES(v_uid,p_area_id,p_is_boss,p_is_papia,p_win,v_eff_exp,p_claimed_gold,v_level_ups);

  -- かかし修練場チャージ（★2026-06-20公開: 全プレイヤー50回で1チャージ）
  v_sc_need := 50;
  v_sc_week := scarecrow_week_key_now();
  IF v_profile.scarecrow_week_key IS DISTINCT FROM v_sc_week THEN
    v_sc_charges := 0; v_sc_earned := 0;
  ELSE
    v_sc_charges := COALESCE(v_profile.scarecrow_charges, 0);
    v_sc_earned  := COALESCE(v_profile.scarecrow_earned_week, 0);
  END IF;
  v_sc_progress := COALESCE(v_profile.scarecrow_progress, 0);
  IF v_sc_earned < 5 THEN
    v_sc_progress := v_sc_progress + 1;
    IF v_sc_progress >= v_sc_need THEN
      v_sc_progress := v_sc_progress - v_sc_need;
      v_sc_charges := v_sc_charges + 1;
      v_sc_earned  := v_sc_earned + 1;
      v_sc_charged := true;
    END IF;
  END IF;

  UPDATE profiles SET
    exp=v_new_exp, exp_next=v_new_exp_next, lv=v_new_lv,
    gold=gold+p_claimed_gold,
    hp_current=p_hp_current, mp_current=p_mp_current,
    is_dying=(p_hp_current=0),
    boss_encounter_rate=v_new_boss_rate,
    unlocked_areas=v_new_unlocked,
    pending_stat_points=v_new_pending,
    char_lv=v_new_char_lv,
    boss_kill_count=CASE WHEN p_win AND p_is_boss
      THEN COALESCE(boss_kill_count,0)+1 ELSE boss_kill_count END,
    scarecrow_charges=v_sc_charges,
    scarecrow_progress=v_sc_progress,
    scarecrow_earned_week=v_sc_earned,
    scarecrow_week_key=v_sc_week
  WHERE id=v_uid;

  IF NOT v_is_at_cap AND NOT v_exp_frozen THEN
    UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
    WHERE player_id=v_uid AND class_name=v_profile.class;
  END IF;

  RETURN json_build_object('ok',true,'level_ups',v_level_ups,'new_lv',v_new_lv,
    'scarecrow_charged',v_sc_charged,'scarecrow_charges',v_sc_charges);
END;
$function$;

-- ===== [5/7] apply_dungeon_reward =====
-- ============================================================
-- apply_dungeon_reward を最新版へ（経験値ダンジョンのLV100未満1.5倍に対応）
--   ・exp上限を char_lv<100 で 100→150 に（クライアントの1.5倍と一致＝誤検知防止）
--   ・他のロジックは現行のまま（gold上限/ボーナスEXP上限15/レベルアップ処理）
--   これ1ファイルで本番の apply_dungeon_reward を確実に上書きできる
--   （protect_stats / scarecrow のどちらが本番でもOK）。
--   ※protect_stats系のため app.allow_stat_change を立ててから保護列を更新している。
--   ※他のSQL(scarecrow等)を後から流すと巻き戻るため、流す場合はこのファイルを最後に。
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_dungeon_reward(p_type text, p_claimed_gold integer DEFAULT 0, p_claimed_exp integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_exp_frozen boolean;
  v_is_at_cap boolean;
  v_class_lv integer;
  v_cap integer;
  v_max_gold integer;
  v_char_lv integer;
  v_new_exp integer; v_new_lv integer; v_new_exp_next integer;
  v_new_pending integer; v_new_char_lv integer;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok',false,'reason','not_authenticated'); END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'reason','profile_not_found'); END IF;

  PERFORM set_config('app.allow_stat_change','on',true);  -- ★保護トリガー許可

  v_exp_frozen := COALESCE(v_profile.exp_frozen, false) OR
    (v_profile.exp_frozen_until IS NOT NULL AND v_profile.exp_frozen_until > now());
  SELECT lv INTO v_class_lv FROM class_levels
    WHERE player_id = v_uid AND class_name = v_profile.class;
  v_class_lv := COALESCE(v_class_lv, v_profile.lv);
  v_cap := CASE WHEN COALESCE((v_profile.retraining ->> v_profile.class)::int, 0) >= 5
                THEN 300 ELSE 100 END;
  v_is_at_cap := v_class_lv >= v_cap;

  IF p_type = 'gold' THEN
    v_char_lv := COALESCE(v_profile.char_lv, v_profile.lv);
    -- ★2026-06-20公開: 全プレイヤー Gold上限×5/3（デイリーダンジョン3回化・クライアントの×5/3と一致）
    v_max_gold := CEIL(v_char_lv * 45 * (CASE WHEN v_char_lv <= 300 THEN 1.5 ELSE 1.0 END) * 1.5 * 5.0/3.0);
    IF p_claimed_gold < 0 OR p_claimed_gold > v_max_gold THEN
      UPDATE profiles SET suspicious_flag=true WHERE id=v_uid;
      RETURN json_build_object('ok',false,'reason','invalid_gold');
    END IF;
    UPDATE profiles SET gold=gold+p_claimed_gold, last_action_at=now() WHERE id=v_uid;

  ELSIF p_type = 'exp' THEN
    IF NOT v_exp_frozen AND NOT v_is_at_cap THEN
      -- キャラLV100未満は経験値1.5倍（クライアントと一致）。上限も1.5倍(150)にして誤検知を防ぐ
      IF p_claimed_exp < 0 OR p_claimed_exp > (CASE WHEN COALESCE(v_profile.char_lv, v_profile.lv) < 100 THEN 150 ELSE 100 END) THEN
        UPDATE profiles SET suspicious_flag=true WHERE id=v_uid;
        RETURN json_build_object('ok',false,'reason','invalid_exp');
      END IF;
    END IF;
    IF v_exp_frozen OR v_is_at_cap THEN
      RETURN json_build_object('ok',true,'frozen',true);
    END IF;

    v_new_exp := COALESCE(v_profile.exp,0) + p_claimed_exp;
    v_new_lv := v_profile.lv;
    v_new_exp_next := calc_exp_next(v_new_lv);
    v_new_pending := COALESCE(v_profile.pending_stat_points,0);
    v_new_char_lv := COALESCE(v_profile.char_lv,1);
    WHILE v_new_exp >= v_new_exp_next AND v_new_lv < v_cap LOOP
      v_new_exp := v_new_exp - v_new_exp_next;
      v_new_lv := v_new_lv + 1;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := v_new_pending + 1;
      v_new_char_lv := v_new_char_lv + 1;
    END LOOP;
    IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(v_cap); END IF;

    UPDATE profiles SET
      exp=v_new_exp, exp_next=v_new_exp_next, lv=v_new_lv,
      pending_stat_points=v_new_pending, char_lv=v_new_char_lv,
      last_action_at=now()
    WHERE id=v_uid;
    UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
      WHERE player_id=v_uid AND class_name=v_profile.class;
  END IF;

  -- ゴールドダンジョン等の「ついでEXP」(8〜11想定)。上限15は据え置き（1.5倍対象外）
  IF p_type <> 'exp' AND p_claimed_exp <> 0 THEN
    IF p_claimed_exp < 0 OR p_claimed_exp > 15 THEN
      UPDATE profiles SET suspicious_flag=true WHERE id=v_uid;
      RETURN json_build_object('ok',false,'reason','invalid_bonus_exp');
    END IF;
    IF NOT v_exp_frozen AND NOT v_is_at_cap THEN
      v_new_exp := COALESCE(v_profile.exp,0) + p_claimed_exp;
      v_new_lv := v_profile.lv;
      v_new_exp_next := calc_exp_next(v_new_lv);
      v_new_pending := COALESCE(v_profile.pending_stat_points,0);
      v_new_char_lv := COALESCE(v_profile.char_lv,1);
      WHILE v_new_exp >= v_new_exp_next AND v_new_lv < v_cap LOOP
        v_new_exp := v_new_exp - v_new_exp_next;
        v_new_lv := v_new_lv + 1;
        v_new_exp_next := calc_exp_next(v_new_lv);
        v_new_pending := v_new_pending + 1;
        v_new_char_lv := v_new_char_lv + 1;
      END LOOP;
      IF v_new_lv >= v_cap THEN v_new_exp := 0; v_new_exp_next := calc_exp_next(v_cap); END IF;

      UPDATE profiles SET
        exp=v_new_exp, exp_next=v_new_exp_next, lv=v_new_lv,
        pending_stat_points=v_new_pending, char_lv=v_new_char_lv,
        last_action_at=now()
      WHERE id=v_uid;
      UPDATE class_levels SET lv=v_new_lv, exp=v_new_exp
        WHERE player_id=v_uid AND class_name=v_profile.class;
    END IF;
  END IF;

  RETURN json_build_object('ok',true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_dungeon_reward(text, integer, integer) TO authenticated;

-- ===== [6/7] dungeon_consume(+一意制約) =====
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
    -- ★[CODEX]90 #2: 別々の取得を表す重複は合計が実消費。exploit防止の安全側＝SUM（上限3でクランプ）
    CREATE TEMP TABLE _da_merged ON COMMIT DROP AS
      SELECT player_id, date,
             MAX(COALESCE(count,0))            AS count,
             LEAST(3, SUM(COALESCE(cnt_exp,0)))   AS cnt_exp,
             LEAST(3, SUM(COALESCE(cnt_gold,0)))  AS cnt_gold,
             LEAST(3, SUM(COALESCE(cnt_stone,0))) AS cnt_stone,
             LEAST(3, SUM(COALESCE(cnt_prof,0)))  AS cnt_prof,
             LEAST(3, SUM(COALESCE(cnt_gem,0)))   AS cnt_gem
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

-- ===== [7/7] 全員EXP正規化（最後） =====
-- ============================================================
-- 全プレイヤーのEXP正規化（本番公開 2026-06-20）
--   必要EXPが全プレイヤーで「floor(base/2)+10」へ変わったため、超過しているexpを
--   その場でレベルアップ消化し、class_levels同期・習得スキル補完まで行う。冪等（再実行安全）。
--   ※ 公開SQL（sortie_boost等）を適用した後、メンテナンス中に1回実行すること。
--   ※ lv/exp/char_lv は protect_stats 保護下のため GUC を立ててから更新。
--   ※ しきい値はインライン計算（クライアント calcExpNext と一致＝floor(base/2)+10）。
-- ============================================================
DO $$
DECLARE
  r       record;
  v_lv    int;
  v_exp   int;
  v_cap   int;
  v_next  int;
  v_pend  int;
  v_clv   int;
  v_ups   int;
BEGIN
  PERFORM set_config('app.allow_stat_change', 'on', true);

  FOR r IN
    SELECT id, lv, exp, char_lv, pending_stat_points, class, retraining
    FROM profiles
  LOOP
    v_lv  := r.lv;
    v_exp := COALESCE(r.exp, 0);
    v_pend := COALESCE(r.pending_stat_points, 0);
    v_clv  := COALESCE(r.char_lv, 1);
    v_ups  := 0;
    v_cap := CASE WHEN COALESCE((r.retraining ->> r.class)::int, 0) >= 5 THEN 300 ELSE 100 END;

    LOOP
      v_next := floor((CASE
        WHEN v_lv >= 100 THEN (CASE WHEN v_lv <= 150 THEN 150 WHEN v_lv <= 200 THEN 160 WHEN v_lv <= 250 THEN 170 ELSE 180 END)
        ELSE (CASE WHEN ((v_lv - 1) % 100) < 9 THEN 80 WHEN ((v_lv - 1) % 100) < 29 THEN 100 WHEN ((v_lv - 1) % 100) < 59 THEN 120 ELSE 140 END)
      END) / 2.0)::int + 10;
      EXIT WHEN v_exp < v_next OR v_lv >= v_cap;
      v_exp  := v_exp - v_next;
      v_lv   := v_lv + 1;
      v_pend := v_pend + 1;
      v_clv  := v_clv + 1;
      v_ups  := v_ups + 1;
    END LOOP;

    IF v_lv >= v_cap THEN v_exp := 0; END IF;

    v_next := floor((CASE
      WHEN v_lv >= 100 THEN (CASE WHEN v_lv <= 150 THEN 150 WHEN v_lv <= 200 THEN 160 WHEN v_lv <= 250 THEN 170 ELSE 180 END)
      ELSE (CASE WHEN ((v_lv - 1) % 100) < 9 THEN 80 WHEN ((v_lv - 1) % 100) < 29 THEN 100 WHEN ((v_lv - 1) % 100) < 59 THEN 120 ELSE 140 END)
    END) / 2.0)::int + 10;

    -- ★[CODEX]88 #1: レベルを跨がない行も exp_next が旧値（80→50等）のため全行を同期する。
    --   冪等性は値が同じなら同結果＝再実行安全。class_levels UPSERT / skill補完も全行で実行。
    UPDATE profiles
      SET lv = v_lv, exp = v_exp, exp_next = v_next,
          char_lv = v_clv, pending_stat_points = v_pend
      WHERE id = r.id;

    INSERT INTO class_levels (player_id, class_name, lv, exp)
    VALUES (r.id, r.class, v_lv, v_exp)
    ON CONFLICT (player_id, class_name) DO UPDATE SET lv = EXCLUDED.lv, exp = EXCLUDED.exp;

    INSERT INTO player_skills (player_id, skill_id)
    SELECT r.id, s.id FROM skills s
    WHERE s.class_name = r.class AND s.required_lv <= v_lv
      AND NOT EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = r.id AND ps.skill_id = s.id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
