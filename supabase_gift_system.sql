-- ============================================================
-- プレゼント（ギフト）受け取りシステム
--   ・運営が player_gifts に行を入れると、対象プレイヤーの街に
--     「🎁 プレゼントが届いています」バナーが出る。
--   ・受け取りボタン → claim_gift RPC がアイテムを付与し claimed=true に。
--   Supabase の SQL Editor で実行してください（単独実行OK）。
-- ============================================================

-- 1) プレゼントテーブル
CREATE TABLE IF NOT EXISTS player_gifts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_name   text NOT NULL,               -- items.name と一致させること
  quantity    int  NOT NULL DEFAULT 1,
  message     text,                          -- 添えるメッセージ（任意）
  claimed     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS player_gifts_unclaimed_idx
  ON player_gifts (player_id) WHERE claimed = false;

ALTER TABLE player_gifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_gifts_select_own ON player_gifts;
CREATE POLICY player_gifts_select_own ON player_gifts
  FOR SELECT USING (auth.uid() = player_id);

-- 2) 受け取りRPC：指定ギフトのアイテムを付与し claimed に更新（本人・未受取のみ）
CREATE OR REPLACE FUNCTION claim_gift(p_gift_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_player_id uuid;
  v_gift      player_gifts%ROWTYPE;
  v_item_id   int;
BEGIN
  v_player_id := auth.uid();
  IF v_player_id IS NULL THEN RETURN json_build_object('error', '未認証'); END IF;

  SELECT * INTO v_gift FROM player_gifts
  WHERE id = p_gift_id AND player_id = v_player_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error', 'プレゼントが見つかりません'); END IF;
  IF v_gift.claimed THEN RETURN json_build_object('error', '受け取り済みです'); END IF;

  SELECT id INTO v_item_id FROM items WHERE name = v_gift.item_name LIMIT 1;
  IF v_item_id IS NULL THEN RETURN json_build_object('error', 'アイテムが未登録です'); END IF;

  INSERT INTO player_items (player_id, item_id, quantity, equipped)
  VALUES (v_player_id, v_item_id, v_gift.quantity, false)
  ON CONFLICT (player_id, item_id) DO UPDATE
  SET quantity = player_items.quantity + v_gift.quantity;

  UPDATE player_gifts SET claimed = true, claimed_at = now() WHERE id = p_gift_id;

  RETURN json_build_object('success', true, 'item', v_gift.item_name, 'quantity', v_gift.quantity);
END;
$$;
GRANT EXECUTE ON FUNCTION claim_gift(uuid) TO authenticated;

-- 3) 「おれおれお」に強者の結晶1個をプレゼント（テスト配布）
INSERT INTO player_gifts (player_id, item_name, quantity, message)
SELECT p.id, '強者の結晶', 1, '運営からのプレゼントです。ご活用ください！'
FROM profiles p
WHERE p.username = 'おれおれお';

-- 確認
SELECT g.id, p.username AS 宛先, g.item_name, g.quantity, g.claimed, g.created_at
FROM player_gifts g JOIN profiles p ON p.id = g.player_id
ORDER BY g.created_at DESC;
