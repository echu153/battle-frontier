-- ============================================================
-- ＋11確定強化石（鍛冶屋・特別アイテム）
--   ・鍛冶屋の武器強化画面で「使用するか」を選択でき、使うと Gold・素材・成功判定なしで
--     武器を確定で +11 に強化する（1個消費）。★+10 の武器にのみ使用可（+10→+11専用）。
--   ・エリアボス装備は真化済みでないと +11 以上にできないため、未真化のボス装備には使用不可。
--   ・付与/消費はクライアントの grantMaterial / consumeMaterial（player_items）が担当。
--   Supabase の SQL Editor でこのファイルを実行してください（単独実行OK）。
-- ============================================================

-- 1) アイテム定義
INSERT INTO items (name, description, effect, value) VALUES
  ('＋11確定強化石', '武器強化画面で使用すると、Gold・素材・成功判定なしで武器を確定で+11に強化する（1個消費）。+10の武器にのみ使用可。', 'material', 0)
ON CONFLICT DO NOTHING;

-- 2) 「おれおれお」に1個配布（再実行しても増えない＝DO NOTHING）
INSERT INTO player_items (player_id, item_id, quantity, equipped)
SELECT p.id, i.id, 1, false
FROM profiles p CROSS JOIN items i
WHERE p.username = 'おれおれお' AND i.name = '＋11確定強化石'
ON CONFLICT (player_id, item_id) DO NOTHING;
