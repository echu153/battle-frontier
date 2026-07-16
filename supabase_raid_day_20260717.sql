-- ============================================================
-- レイド 昼枠の追加＆夜のセットローテ化（2026-07-17）
--
--  【夜】21:00-21:30 / 22:00-22:30（固定・HP700万・従来どおり）
--        3日周期の「セット」で回す。各セットに最新ボスが必ず1体入る＝夜の出現の1/2が最新。
--          d%3=0 → 21時=閻魔(最新) / 22時=黒龍ヴァルゼノク
--          d%3=1 → 21時=雨摩座     / 22時=閻魔(最新)
--          d%3=2 → 21時=閻魔(最新) / 22時=雷鋼機神ゼルギアス
--
--  【昼】12〜17時のうち毎日ランダムな1枠に1体だけ出現（30分・HP200万）。
--        出るボスは「最新」と「その日の夜に出る2体」を除いた候補から1体。
--          例) 夜が 閻魔＋ヴァルゼノク の日 → 昼は 雨摩座 か ゼルギアス
--        昼は与ダメージ上位3名の追加報酬なし（ティア報酬・素材・秘伝書は夜と同じ）。
--
--  ・時刻もボスも「日付から決まる疑似乱数」＝サーバーもクライアントも同じ結果になり、
--    事前に予定表へ出せる。新しい状態やcronに依存しない（従来の raid_boss_for_slot と同じ思想）。
--  ・★クライアントは予定を自前で計算せず spawn_raid_boss_if_needed の 'schedule' を表示する。
--    式の二重実装をやめたので「予告と実出現が食い違う」事故が起きない。
--
--  適用順: supabase_raid_enma_20260717.sql の後、supabase_mutant_gold_20260703.sql より前。
--  Supabase の SQL Editor でファイル全体を実行してください。
--  ※ 通知cron（supabase_raid_push_cron_20260717.sql）は特権ロールで別途実行。
-- ============================================================

-- 1) 最新ボス（新ボスを追加したらこの1関数だけ直す。昼の除外＝ここが唯一の定義）
CREATE OR REPLACE FUNCTION raid_latest_boss()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT '閻魔'::text $$;

-- 2) 日付から決まる疑似乱数（0〜2^31-1）
--    単純な線形合同だと「毎日+3時間ずれる」ような規則性が見えてしまうため、
--    乗算とXORシフトで撹拌する（各段で 2^31 未満に保つ＝bigintの範囲内で完結）。
CREATE OR REPLACE FUNCTION raid_rand(p_d int, p_salt int)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE h bigint;
BEGIN
  h := ((p_d::bigint * 2654435761 + p_salt::bigint * 40503 + 2166136261) % 2147483648 + 2147483648) % 2147483648;
  h := h # (h >> 15);
  h := (h * 2246822519) % 2147483648;
  h := h # (h >> 13);
  h := (h * 668265263) % 2147483648;
  h := h # (h >> 16);
  RETURN h::int;
END $$;

-- 3) その日の昼枠の時刻（12〜17時）
CREATE OR REPLACE FUNCTION raid_day_slot(p_date date)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT 12 + (raid_rand(p_date - DATE '2000-01-01', 0) % 6)
$$;

-- 4) 枠ごとのHP（昼は人が少ない時間帯なので低め）
CREATE OR REPLACE FUNCTION raid_slot_hp(p_slot int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_slot IN (21, 22) THEN 7000000 ELSE 2000000 END
$$;

-- 5) 枠ごとの出現ボス（夜=セットローテ / 昼=最新とその日の夜の2体を除いた候補から1体）
CREATE OR REPLACE FUNCTION raid_boss_for_slot(p_date date, p_slot int)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  d        int    := p_date - DATE '2000-01-01';
  s        int    := ((d % 3) + 3) % 3;                                   -- 夜のセット番号
  night21  text[] := ARRAY['閻魔', '雨摩座', '閻魔'];
  night22  text[] := ARRAY['黒龍ヴァルゼノク', '閻魔', '雷鋼機神ゼルギアス'];
  all_boss text[] := ARRAY['黒龍ヴァルゼノク', '雨摩座', '雷鋼機神ゼルギアス', '閻魔'];
  cand     text[];
BEGIN
  IF p_slot = 21 THEN RETURN night21[s + 1]; END IF;
  IF p_slot = 22 THEN RETURN night22[s + 1]; END IF;
  -- 昼枠: 最新＋その日の夜の2体を除く（候補はデータから導出するので、
  --       新ボス追加時は night21/night22/all_boss/raid_latest_boss を直せば昼も自動で追従する）
  SELECT ARRAY(
    SELECT b FROM unnest(all_boss) WITH ORDINALITY AS t(b, ord)
    WHERE b <> raid_latest_boss() AND b <> night21[s + 1] AND b <> night22[s + 1]
    ORDER BY ord
  ) INTO cand;
  IF cand IS NULL OR array_length(cand, 1) IS NULL THEN RETURN night21[s + 1]; END IF;  -- 候補が消えた時の保険
  RETURN cand[(raid_rand(d, 1) % array_length(cand, 1)) + 1];
END $$;

-- 6) 通知の購読設定（夜/昼を別々にON/OFFできるようにする。既存購読は両方ON扱い）
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS notify_night boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_day   boolean NOT NULL DEFAULT true;

-- 7) スポーンRPC（昼枠に対応＋枠別HP＋本日の予定を返す）
CREATE OR REPLACE FUNCTION spawn_raid_boss_if_needed()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jst_now   timestamptz;
  v_jst_date  date;
  v_hour      int;
  v_min       int;
  v_boss      raid_boss%ROWTYPE;
  v_expire_at timestamptz;
  v_is_admin  boolean;
  v_slot      int;
  v_win_start timestamptz;
  v_next_start text;
  v_next_boss  text;
  v_day_slot  int;
  v_next_slot int;
  v_schedule  json;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM profiles WHERE id = auth.uid();

  v_jst_now  := now() AT TIME ZONE 'Asia/Tokyo';
  v_jst_date := v_jst_now::date;
  v_hour     := EXTRACT(hour   FROM v_jst_now)::int;
  v_min      := EXTRACT(minute FROM v_jst_now)::int;
  v_day_slot := raid_day_slot(v_jst_date);

  -- 本日の予定（昼→21時→22時）。クライアントはこれをそのまま表示する
  v_schedule := json_build_array(
    json_build_object('slot', v_day_slot, 'kind', 'day',
                      'boss_name', raid_boss_for_slot(v_jst_date, v_day_slot), 'hp_max', raid_slot_hp(v_day_slot)),
    json_build_object('slot', 21, 'kind', 'night',
                      'boss_name', raid_boss_for_slot(v_jst_date, 21), 'hp_max', raid_slot_hp(21)),
    json_build_object('slot', 22, 'kind', 'night',
                      'boss_name', raid_boss_for_slot(v_jst_date, 22), 'hp_max', raid_slot_hp(22))
  );

  -- ★開発テストボス（管理者のみ）: アクティブな is_dev ボスを最優先で返す
  IF COALESCE(v_is_admin, false) THEN
    SELECT * INTO v_boss FROM raid_boss WHERE is_dev = true AND status = 'active' ORDER BY spawned_at DESC LIMIT 1;
    IF FOUND THEN
      v_expire_at := v_boss.spawned_at + interval '30 minutes';
      IF now() > v_expire_at THEN UPDATE raid_boss SET status='expired' WHERE id=v_boss.id; v_boss.status:='expired'; END IF;
      IF v_boss.status = 'active' THEN
        RETURN json_build_object('status',v_boss.status,'id',v_boss.id,'boss_name',v_boss.boss_name,
          'hp_max',v_boss.hp_max,'hp_current',v_boss.hp_current,'spawn_date',v_boss.spawn_date,
          'defeated_at',v_boss.defeated_at,'spawned_at',v_boss.spawned_at,'is_dev',true,
          'day_slot',v_day_slot,'schedule',v_schedule);
      END IF;
    END IF;
  END IF;

  -- 現在のウィンドウ（昼枠 / 21:00-21:30 / 22:00-22:30。各30分）
  IF    v_hour = v_day_slot AND v_min < 30 THEN v_slot := v_day_slot;
  ELSIF v_hour = 21         AND v_min < 30 THEN v_slot := 21;
  ELSIF v_hour = 22         AND v_min < 30 THEN v_slot := 22;
  ELSE  v_slot := NULL; END IF;

  -- 次の枠（今日の残りで最も早い枠。無ければ翌日の昼枠）
  SELECT min(s) INTO v_next_slot FROM unnest(ARRAY[v_day_slot, 21, 22]) s WHERE s > v_hour;
  IF v_next_slot IS NULL THEN
    v_next_start := ((v_jst_date + 1)::text || 'T' || lpad(raid_day_slot(v_jst_date + 1)::text, 2, '0') || ':00:00+09:00');
    v_next_boss  := raid_boss_for_slot(v_jst_date + 1, raid_day_slot(v_jst_date + 1));
  ELSE
    v_next_start := (v_jst_date::text || 'T' || lpad(v_next_slot::text, 2, '0') || ':00:00+09:00');
    v_next_boss  := raid_boss_for_slot(v_jst_date, v_next_slot);
  END IF;

  -- ウィンドウ内: その枠のボスを取得/生成して返す
  IF v_slot IS NOT NULL THEN
    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date=v_jst_date AND slot=v_slot AND is_dev=false;
    IF NOT FOUND THEN
      v_win_start := (v_jst_date::text || 'T' || lpad(v_slot::text,2,'0') || ':00:00+09:00')::timestamptz;
      INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at, slot)
      VALUES (v_jst_date, raid_boss_for_slot(v_jst_date, v_slot), raid_slot_hp(v_slot), raid_slot_hp(v_slot), 'active', v_win_start, v_slot)
      ON CONFLICT (spawn_date, slot) WHERE is_dev = false DO NOTHING;
      SELECT * INTO v_boss FROM raid_boss WHERE spawn_date=v_jst_date AND slot=v_slot AND is_dev=false;
    END IF;
    IF v_boss.status = 'active' THEN
      v_expire_at := v_boss.spawned_at + interval '30 minutes';
      IF now() > v_expire_at THEN UPDATE raid_boss SET status='expired' WHERE id=v_boss.id; v_boss.status:='expired'; END IF;
    END IF;
    RETURN json_build_object('status',v_boss.status,'id',v_boss.id,'boss_name',v_boss.boss_name,
      'hp_max',v_boss.hp_max,'hp_current',v_boss.hp_current,'spawn_date',v_boss.spawn_date,
      'defeated_at',v_boss.defeated_at,'spawned_at',v_boss.spawned_at,'is_dev',false,
      'next_spawn',v_next_start,'next_boss_name',v_next_boss,'day_slot',v_day_slot,'schedule',v_schedule);
  END IF;

  -- ウィンドウ外・受け取り用: 本日すでに始まった枠があれば、その最後のボス（終了済み）を返す
  IF v_hour >= v_day_slot THEN
    SELECT * INTO v_boss FROM raid_boss WHERE spawn_date=v_jst_date AND is_dev=false ORDER BY slot DESC NULLS LAST LIMIT 1;
    IF FOUND THEN
      IF v_boss.status = 'active' THEN
        v_expire_at := v_boss.spawned_at + interval '30 minutes';
        IF now() > v_expire_at THEN UPDATE raid_boss SET status='expired' WHERE id=v_boss.id; v_boss.status:='expired'; END IF;
      END IF;
      RETURN json_build_object('status',v_boss.status,'id',v_boss.id,'boss_name',v_boss.boss_name,
        'hp_max',v_boss.hp_max,'hp_current',v_boss.hp_current,'spawn_date',v_boss.spawn_date,
        'defeated_at',v_boss.defeated_at,'spawned_at',v_boss.spawned_at,'is_dev',false,
        'next_spawn',v_next_start,'next_boss_name',v_next_boss,'day_slot',v_day_slot,'schedule',v_schedule);
    END IF;
  END IF;

  RETURN json_build_object('status','waiting','next_spawn',v_next_start,'next_boss_name',v_next_boss,
                           'day_slot',v_day_slot,'schedule',v_schedule);
END;
$$;

-- 8) 管理者テスト用: 昼枠の条件（HP200万・順位報酬なし）でも試せるよう slot を指定できるようにする
CREATE OR REPLACE FUNCTION spawn_raid_boss_dev(p_boss_name text, p_slot int DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_admin boolean; v_boss raid_boss%ROWTYPE; v_date date; v_hp int;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, false) THEN RETURN json_build_object('error', '権限がありません'); END IF;
  UPDATE raid_boss SET status = 'expired' WHERE is_dev = true AND status = 'active';
  v_date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_hp   := raid_slot_hp(COALESCE(p_slot, 21));
  INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at, is_dev, slot)
  VALUES (v_date, p_boss_name, v_hp, v_hp, 'active', now(), true, p_slot)
  RETURNING * INTO v_boss;
  RETURN json_build_object('status','active','id',v_boss.id,'boss_name',v_boss.boss_name,
    'hp_max',v_boss.hp_max,'hp_current',v_boss.hp_current,'spawn_date',v_boss.spawn_date,
    'spawned_at',v_boss.spawned_at,'is_dev',true);
END;
$$;
GRANT EXECUTE ON FUNCTION spawn_raid_boss_dev(text, int) TO authenticated;

-- 9) claim_raid_rewards 再定義
--    ベース: supabase_raid_enma_20260717.sql（raid_boss_mats 一元化版）
--    変更点: 昼枠（slot が21/22以外）は与ダメージ上位3名の追加報酬を付けない
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
  v_atk_a            int := 40;
  v_atk_b            int := 20;
  v_atk_c            int := 10;
  v_mat_name         text;
  v_rare_name        text;
  v_mats             text[];
  v_book_name        text;
  v_book_item_id     int;
  v_dmg_rank         int;
  v_top_book         text;
  v_top_gold         int := 0;
  v_top_book_item_id int;
  -- ★勇気の証イベント
  v_courage          int := 0;
  v_courage_item_id  int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_boss FROM raid_boss WHERE id = p_raid_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'レイドが見つかりません'); END IF;
  IF v_boss.status NOT IN ('defeated', 'expired') THEN
    RETURN json_build_object('error', 'レイドはまだ終了していません');
  END IF;

  -- 原子的クレーム
  UPDATE raid_participants SET reward_claimed = true
  WHERE raid_id = p_raid_id AND player_id = v_player_id AND NOT reward_claimed
  RETURNING * INTO v_participant;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM raid_participants WHERE raid_id = p_raid_id AND player_id = v_player_id) THEN
      RETURN json_build_object('error', '既にリワードを受け取り済みです');
    END IF;
    RETURN json_build_object('error', '参加記録がありません');
  END IF;

  SELECT COALESCE(SUM(damage_dealt + attack_count * 500), 1) INTO v_total_eff FROM raid_participants WHERE raid_id = p_raid_id;
  v_my_eff       := v_participant.damage_dealt + v_participant.attack_count * 500;
  v_contribution := v_my_eff::float / v_total_eff::float;

  IF v_contribution >= 0.07 OR v_participant.attack_count >= v_atk_a THEN
    v_tier := 'A'; v_gold := 150000; v_stone_ranks := ARRAY['B','C','D'];
    v_gem_count := 2; v_gem_rank := 'D'; v_scale_min := 8; v_scale_max := 10; v_gyaku_chance := 0.15;
  ELSIF v_contribution >= 0.04 OR v_participant.attack_count >= v_atk_b THEN
    v_tier := 'B'; v_gold := 90000; v_stone_ranks := ARRAY['C','D','E'];
    v_gem_count := 2; v_gem_rank := 'E'; v_scale_min := 6; v_scale_max := 8; v_gyaku_chance := 0.08;
  ELSIF v_contribution >= 0.02 OR v_participant.attack_count >= v_atk_c THEN
    v_tier := 'C'; v_gold := 30000; v_stone_ranks := ARRAY['D','E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 4; v_scale_max := 6; v_gyaku_chance := 0.03;
  ELSE
    v_tier := 'D'; v_gold := 15000; v_stone_ranks := ARRAY['E','F'];
    v_gem_count := 2; v_gem_rank := 'F'; v_scale_min := 1; v_scale_max := 3; v_gyaku_chance := 0.0;
  END IF;
  v_scale_count := v_scale_min + (random() * (v_scale_max - v_scale_min))::int;

  -- ★ボス別の素材名（raid_boss_mats に一元化。新ボス追加時はその関数だけ直せば足りる＝
  --   ここに分岐を足し忘れて黙って黒龍素材が配られる、を再発させない）
  v_mats      := raid_boss_mats(v_boss.boss_name);
  v_mat_name  := v_mats[1];
  v_rare_name := v_mats[2];

  -- ★匠の秘伝書（C=Ⅰ / B=Ⅱ / A=Ⅲ・Dは無し）
  v_book_name := CASE v_tier
    WHEN 'A' THEN '匠の秘伝書Ⅲ'
    WHEN 'B' THEN '匠の秘伝書Ⅱ'
    WHEN 'C' THEN '匠の秘伝書Ⅰ'
    ELSE NULL END;

  -- ★上位与ダメ3名への追加報酬（夜枠のみ。昼枠=12〜17時は人が少なく上位が固定化するため付けない）
  v_dmg_rank := NULL;
  IF COALESCE(v_boss.slot, 21) IN (21, 22) AND v_participant.damage_dealt > 0 THEN
    SELECT COUNT(*) + 1 INTO v_dmg_rank
    FROM raid_participants
    WHERE raid_id = p_raid_id AND damage_dealt > v_participant.damage_dealt;
  END IF;
  v_top_book := CASE v_dmg_rank
    WHEN 1 THEN '匠の秘伝書Ⅴ'
    WHEN 2 THEN '匠の秘伝書Ⅳ'
    WHEN 3 THEN '匠の秘伝書Ⅲ'
    ELSE NULL END;
  v_top_gold := CASE WHEN v_dmg_rank IS NOT NULL AND v_dmg_rank BETWEEN 1 AND 3 THEN 100000 ELSE 0 END;

  PERFORM set_config('app.allow_stat_change', 'on', true);
  -- Gold（tier報酬＋上位3名ボーナス）
  UPDATE profiles SET gold = gold + v_gold + v_top_gold WHERE id = v_player_id;

  FOREACH v_rank IN ARRAY v_stone_ranks LOOP
    v_stone_name := '強化石(' || v_rank || ')';
    SELECT id INTO v_stone_item_id FROM items WHERE name = v_stone_name LIMIT 1;
    IF v_stone_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_stone_item_id, 2, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 2;
    END IF;
  END LOOP;

  FOR v_i IN 1..v_gem_count LOOP
    v_gem_type := v_gem_types[1 + (random() * (array_length(v_gem_types, 1) - 1))::int];
    SELECT id INTO v_existing_gem_id FROM player_gems WHERE player_id = v_player_id AND gem_type = v_gem_type AND rank = v_gem_rank;
    IF FOUND THEN
      UPDATE player_gems SET quantity = quantity + 1 WHERE id = v_existing_gem_id;
    ELSE
      INSERT INTO player_gems (player_id, gem_type, rank, quantity) VALUES (v_player_id, v_gem_type, v_gem_rank, 1);
    END IF;
  END LOOP;

  -- 通常素材（ボス別）
  SELECT id INTO v_scale_item_id FROM items WHERE name = v_mat_name LIMIT 1;
  IF v_scale_item_id IS NOT NULL THEN
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    VALUES (v_player_id, v_scale_item_id, v_scale_count, false)
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_scale_count;
  END IF;

  -- レア素材（ボス別・確率）
  IF v_gyaku_chance > 0 AND random() < v_gyaku_chance THEN
    v_got_gyaku := true;
    SELECT id INTO v_gyaku_item_id FROM items WHERE name = v_rare_name LIMIT 1;
    IF v_gyaku_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_gyaku_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- ★匠の秘伝書付与（ティア別・1冊）
  IF v_book_name IS NOT NULL THEN
    SELECT id INTO v_book_item_id FROM items WHERE name = v_book_name LIMIT 1;
    IF v_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_book_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- ★上位与ダメ3名の追加秘伝書付与（1冊）
  IF v_top_book IS NOT NULL THEN
    SELECT id INTO v_top_book_item_id FROM items WHERE name = v_top_book LIMIT 1;
    IF v_top_book_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_top_book_item_id, 1, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + 1;
    END IF;
  END IF;

  -- ★勇気の証イベント（期間内のみ）: 参加報酬×2 ＋ Cティア以上で+1
  --   JST 2026/07/13 05:00 〜 2026/07/27 04:59（UTC 07-12 20:00 〜 07-26 20:00 未満）
  IF now() >= '2026-07-12 20:00:00+00'::timestamptz
     AND now() < '2026-07-26 20:00:00+00'::timestamptz THEN
    v_courage := 2 + CASE WHEN v_tier IN ('A','B','C') THEN 1 ELSE 0 END;
    SELECT id INTO v_courage_item_id FROM items WHERE name = '勇気の証' LIMIT 1;
    IF v_courage_item_id IS NOT NULL THEN
      INSERT INTO player_items (player_id, item_id, quantity, equipped)
      VALUES (v_player_id, v_courage_item_id, v_courage, false)
      ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_courage;
    END IF;
  END IF;

  RETURN json_build_object(
    'success',          true,
    'tier',             v_tier,
    'contribution_pct', round((v_contribution * 100)::numeric, 1),
    'gold',             v_gold + v_top_gold,
    'stones',           to_json(v_stone_ranks),
    'gem_count',        v_gem_count,
    'gem_rank',         v_gem_rank,
    'scale_count',      v_scale_count,
    'got_gyaku',        v_got_gyaku,
    'mat_name',         v_mat_name,
    'rare_name',        v_rare_name,
    'book',             v_book_name,
    'top_rank',         v_dmg_rank,
    'top_book',         v_top_book,
    'top_gold',         v_top_gold,
    'courage',          v_courage      -- ★勇気の証 付与数（期間外は0）
  );
END;
$$;

GRANT EXECUTE ON FUNCTION claim_raid_rewards(uuid) TO authenticated;
