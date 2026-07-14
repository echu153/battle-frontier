-- ============================================================
-- 出撃ポイントラリー(sortie_2026_06) 終了処理：
--   獲得済み(points>=threshold)で未受取の報酬を全プレイヤーに自動付与する一回限りのスイープ。
--   claim_event_reward と同じ付与ロジック(gold/item/weapon/title)を service ロールで一括実行。
--   ※ SQLエディタ(service role)で1回だけ実行。冪等（event_claims で二重付与を防止）。
-- ============================================================
DO $$
DECLARE
  r        record;
  e        jsonb;
  v_type   text;
  v_name   text;
  v_qty    int;
  v_itemid int;
  v_weapon weapons%ROWTYPE;
  v_title  int;
  v_i      int;
BEGIN
  PERFORM set_config('app.allow_stat_change','on',true);  -- gold付与の保護トリガー許可

  FOR r IN
    SELECT ep.player_id,
           p.threshold,
           p.rewards,
           COALESCE(p.reveal_label, er.label) AS lbl
    FROM event_points ep
    JOIN event_reward_payloads p ON p.event_key = ep.event_key
    LEFT JOIN event_rewards er   ON er.event_key = p.event_key AND er.threshold = p.threshold
    WHERE ep.event_key = 'sortie_2026_06'
      AND ep.points >= p.threshold
      AND NOT EXISTS (
        SELECT 1 FROM event_claims c
        WHERE c.event_key = 'sortie_2026_06'
          AND c.player_id = ep.player_id
          AND c.threshold = p.threshold
      )
  LOOP
    -- 受取記録（冪等）
    INSERT INTO event_claims(player_id, event_key, threshold, reveal_label)
      VALUES (r.player_id, 'sortie_2026_06', r.threshold, r.lbl)
      ON CONFLICT (player_id, event_key, threshold) DO NOTHING;

    -- 付与
    FOR e IN SELECT * FROM jsonb_array_elements(r.rewards) LOOP
      v_type := e->>'type';
      v_name := e->>'name';
      v_qty  := GREATEST(COALESCE((e->>'qty')::int, 1), 1);

      IF v_type = 'gold' THEN
        UPDATE profiles SET gold = COALESCE(gold,0) + v_qty WHERE id = r.player_id;

      ELSIF v_type = 'item' THEN
        SELECT id INTO v_itemid FROM items WHERE name = v_name LIMIT 1;
        IF v_itemid IS NOT NULL THEN
          INSERT INTO player_items(player_id, item_id, quantity, equipped)
            VALUES (r.player_id, v_itemid, v_qty, false)
            ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + v_qty;
        END IF;

      ELSIF v_type = 'weapon' THEN
        SELECT * INTO v_weapon FROM weapons WHERE name = v_name LIMIT 1;
        IF FOUND THEN
          FOR v_i IN 1..v_qty LOOP
            INSERT INTO player_equipment(player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
              VALUES (r.player_id, v_weapon.id, v_weapon.slot, false, 0, NULL);
          END LOOP;
        END IF;

      ELSIF v_type = 'title' THEN
        SELECT id INTO v_title FROM titles WHERE name = v_name LIMIT 1;
        IF v_title IS NOT NULL THEN
          INSERT INTO player_titles(player_id, title_id) VALUES (r.player_id, v_title)
            ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
