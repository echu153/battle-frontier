-- ============================================================
-- use_exp_dungeon_ticket 修正（「回数が0回です」誤表示・回数券が使えない不具合）
--   原因の可能性: サーバーが参照する日付 or 列がクライアントとズレており、
--   本日の経験値ダンジョン消費回数(cnt_exp)を正しく読めず常に0扱いになっていた。
--   ・日付はクライアント getDungeonDateStr と一致させる
--       = UTC+4時間の暦日（JST午前5時リセット）。
--   ・消費回数は dungeon_attempts.cnt_exp を参照（汎用 count 列ではない）。
--   ・cnt_exp を1減らして挑戦回数を1回回復し、回数券を1枚消費。
--   戻り値: { ok, remaining_tickets, cnt_exp } / 失敗時 { ok:false, error }
-- ============================================================
CREATE OR REPLACE FUNCTION public.use_exp_dungeon_ticket(p_player_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_uid    uuid := COALESCE(auth.uid(), p_player_id);
  v_date   date := ((now() AT TIME ZONE 'UTC') + interval '4 hours')::date;  -- = client getDungeonDateStr
  v_ticket record;
  v_cnt    int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', '未認証です');
  END IF;

  -- 回数券の所持を確認（player_items × items.effect='exp_dungeon_ticket'）
  SELECT pi.id, pi.quantity INTO v_ticket
  FROM player_items pi
  JOIN items i ON i.id = pi.item_id
  WHERE pi.player_id = v_uid AND i.effect = 'exp_dungeon_ticket'
  ORDER BY pi.quantity DESC
  LIMIT 1;

  IF v_ticket.id IS NULL OR COALESCE(v_ticket.quantity, 0) < 1 THEN
    RETURN json_build_object('ok', false, 'error', '回数券を所持していません');
  END IF;

  -- 本日の経験値ダンジョン消費回数を取得（行ロックで二重実行を直列化）
  SELECT cnt_exp INTO v_cnt
  FROM dungeon_attempts
  WHERE player_id = v_uid AND date = v_date
  FOR UPDATE;

  v_cnt := COALESCE(v_cnt, 0);

  IF v_cnt <= 0 THEN
    -- まだ1回も消費していない＝回復の必要がない
    RETURN json_build_object('ok', false, 'error', '本日の経験値ダンジョンはまだ消費していません（回数が0回です）');
  END IF;

  -- 挑戦回数を1回回復（cnt_exp を1減らす）
  UPDATE dungeon_attempts
  SET cnt_exp = cnt_exp - 1
  WHERE player_id = v_uid AND date = v_date;

  -- 回数券を1枚消費（0枚になったら行削除）
  IF v_ticket.quantity > 1 THEN
    UPDATE player_items SET quantity = quantity - 1 WHERE id = v_ticket.id;
  ELSE
    DELETE FROM player_items WHERE id = v_ticket.id;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'remaining_tickets', GREATEST(0, v_ticket.quantity - 1),
    'cnt_exp', v_cnt - 1
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.use_exp_dungeon_ticket(uuid) TO authenticated;
