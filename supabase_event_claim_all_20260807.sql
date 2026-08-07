-- ============================================================
-- イベント報酬の「一括受け取り」RPC  claim_event_rewards_all(p_event_key)
--   ・達成済み(points >= threshold)で未受取のマイルストーンを、しきい値の小さい順にまとめて付与
--   ・付与ロジックは claim_event_reward と完全に同じ（gold/item/weapon/title）
--   ・1件ずつサブトランザクション(BEGIN...EXCEPTION)で囲む＝どれか1件が失敗しても
--     その1件だけロールバック（＝未受取のまま残る）。他の報酬は正常に受け取れる
--   ・二重受取防止は event_claims の主キー＋ON CONFLICT DO NOTHING（単発受取と同じ権威）
--   ・受け取った内訳を items:[{threshold,label}] で返す（伏字報酬は正体 reveal_label を返す）
--   Supabase の SQL Editor でファイル全体を実行してください
--   ※適用順は不問（apply_battle_result / apply_dungeon_reward を触らない）
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_event_rewards_all(p_event_key text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_points   int;
  v_row      record;
  v_entry    jsonb;
  v_type     text;
  v_name     text;
  v_qty      int;
  v_item_id  int;
  v_weapon   weapons%ROWTYPE;
  v_title_id int;
  v_inserted int;
  v_i        int;
  v_got      jsonb := '[]'::jsonb;   -- 受け取れた内訳
  v_failed   int   := 0;             -- 付与に失敗して未受取のまま残した件数
  v_err      text;                   -- 最初の失敗理由（診断用）
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error','未認証'); END IF;

  SELECT points INTO v_points FROM event_points WHERE player_id = v_uid AND event_key = p_event_key;
  v_points := COALESCE(v_points, 0);

  PERFORM set_config('app.allow_stat_change','on',true);  -- gold付与の保護トリガー許可

  -- 付与内容は秘匿テーブル(event_reward_payloads)から。伏字報酬は正体(reveal_label)、無ければ公開label。
  FOR v_row IN
    SELECT p.threshold, p.rewards, COALESCE(p.reveal_label, r.label) AS label
    FROM event_reward_payloads p
    JOIN event_rewards r ON r.event_key = p.event_key AND r.threshold = p.threshold
    WHERE p.event_key = p_event_key
      AND p.threshold <= v_points
      AND NOT EXISTS (
        SELECT 1 FROM event_claims c
        WHERE c.player_id = v_uid AND c.event_key = p_event_key AND c.threshold = p.threshold
      )
    ORDER BY p.threshold
  LOOP
    BEGIN
      -- 原子的に受取記録（同時実行・連打でも片方しか挿入されない）
      INSERT INTO event_claims (player_id, event_key, threshold, reveal_label)
      VALUES (v_uid, p_event_key, v_row.threshold, v_row.label) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted = 0 THEN CONTINUE; END IF;  -- 並行リクエストが先に受け取り済み

      FOR v_entry IN SELECT * FROM jsonb_array_elements(v_row.rewards) LOOP
        v_type := v_entry->>'type';
        v_name := v_entry->>'name';
        v_qty  := COALESCE((v_entry->>'qty')::int, 1);

        IF v_type = 'gold' THEN
          IF v_qty <= 0 THEN RAISE EXCEPTION 'gold報酬額が不正です: %', v_qty; END IF;
          UPDATE profiles SET gold = gold + v_qty WHERE id = v_uid;

        ELSIF v_type = 'item' THEN
          IF v_qty <= 0 THEN RAISE EXCEPTION '報酬数量が不正です: % %', v_name, v_qty; END IF;
          SELECT id INTO v_item_id FROM items WHERE name = v_name LIMIT 1;
          IF v_item_id IS NULL THEN RAISE EXCEPTION '報酬アイテムが見つかりません: %', v_name; END IF;
          INSERT INTO player_items (player_id, item_id, quantity, equipped)
          VALUES (v_uid, v_item_id, v_qty, false)
          ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_qty;

        ELSIF v_type = 'weapon' THEN
          IF v_qty <= 0 THEN RAISE EXCEPTION '報酬装備数が不正です: % %', v_name, v_qty; END IF;
          SELECT * INTO v_weapon FROM weapons WHERE name = v_name LIMIT 1;
          IF NOT FOUND THEN RAISE EXCEPTION '報酬装備が見つかりません: %', v_name; END IF;
          FOR v_i IN 1..v_qty LOOP
            INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
            VALUES (v_uid, v_weapon.id, v_weapon.slot, false, 0, NULL);
          END LOOP;

        ELSIF v_type = 'title' THEN
          IF v_qty <> 1 THEN RAISE EXCEPTION '称号報酬の数量は1のみです: % %', v_name, v_qty; END IF;
          SELECT id INTO v_title_id FROM titles WHERE name = v_name LIMIT 1;
          IF v_title_id IS NULL THEN RAISE EXCEPTION '報酬称号が見つかりません: %', v_name; END IF;
          INSERT INTO player_titles (player_id, title_id) VALUES (v_uid, v_title_id) ON CONFLICT DO NOTHING;

        ELSE
          RAISE EXCEPTION '不明な報酬タイプです: %', v_type;
        END IF;
      END LOOP;

      v_got := v_got || jsonb_build_object('threshold', v_row.threshold, 'label', v_row.label);

    EXCEPTION WHEN OTHERS THEN
      -- この1件だけロールバック（event_claims の記録も戻る＝未受取のまま残り、後で再受取できる）
      v_failed := v_failed + 1;
      IF v_err IS NULL THEN v_err := SQLERRM; END IF;
    END;
  END LOOP;

  IF jsonb_array_length(v_got) = 0 THEN
    IF v_failed > 0 THEN
      RETURN json_build_object('error','報酬の受け取りに失敗しました: ' || COALESCE(v_err,''));
    END IF;
    RETURN json_build_object('error','受け取れる報酬がありません');
  END IF;

  RETURN json_build_object(
    'success', true,
    'count',   jsonb_array_length(v_got),
    'items',   v_got,
    'failed',  v_failed,
    'points',  v_points
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_event_rewards_all(text) TO authenticated;
