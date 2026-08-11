-- ============================================================
-- 紋章の結晶「改心の結晶」→「会心の結晶」誤字修正
--   ・items の名前を改名（player_items は item_id 参照なので所持数はそのまま引き継がれる）
--   ・アイテム名を文字列で持っている関数（emblem_allocate / hachigoku_result）を一括で置換
--   ・公開済みお知らせ本文の「改心」も修正
--   何度流しても安全（冪等）。適用順の鉄則には影響しない（apply_battle_result 等は触らない）
-- ============================================================
BEGIN;

-- 1) アイテム名の改名 -----------------------------------------
--    新旧が両方存在する場合（旧SQLを流し直した等）は在庫を新側へ統合してから旧を削除する
DO $$
DECLARE
  v_old items.id%TYPE;
  v_new items.id%TYPE;
BEGIN
  SELECT id INTO v_old FROM items WHERE name = '改心の結晶' LIMIT 1;
  IF v_old IS NULL THEN
    RAISE NOTICE '改名対象なし（すでに適用済み）';
    RETURN;
  END IF;

  SELECT id INTO v_new FROM items WHERE name = '会心の結晶' LIMIT 1;
  IF v_new IS NULL THEN
    UPDATE items SET name = '会心の結晶' WHERE id = v_old;
    RAISE NOTICE '改心の結晶 → 会心の結晶 に改名（item_id=%）', v_old;
  ELSE
    INSERT INTO player_items (player_id, item_id, quantity, equipped)
    SELECT player_id, v_new, quantity, false FROM player_items WHERE item_id = v_old
    ON CONFLICT (player_id, item_id) DO UPDATE SET quantity = player_items.quantity + EXCLUDED.quantity;
    DELETE FROM player_items WHERE item_id = v_old;
    DELETE FROM items WHERE id = v_old;
    RAISE NOTICE '旧アイテム(item_id=%)の在庫を会心の結晶(item_id=%)へ統合して削除', v_old, v_new;
  END IF;
END $$;

-- 説明文も統一（表記ルール: 半角%）
UPDATE items
   SET description = '紋章に力を注ぐ結晶。クリティカル率+0.2%。'
 WHERE name = '会心の結晶';

-- 2) 関数内のアイテム名を置換 ---------------------------------
--    emblem_allocate の v_map / hachigoku_result の v_crystals など、
--    '改心の結晶' を文字列で持つ public の関数をすべて CREATE OR REPLACE で入れ替える
--    （pg_get_functiondef を置換して流し直すので、権限・所有者・シグネチャはそのまま）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosrc LIKE '%改心の結晶%'
  LOOP
    EXECUTE replace(r.def, '改心の結晶', '会心の結晶');
    RAISE NOTICE '関数を更新: %', r.sig;
  END LOOP;
END $$;

-- 3) 公開済みお知らせの本文を修正 -----------------------------
UPDATE announcements
   SET content = replace(content, '改心', '会心')
 WHERE content LIKE '%改心%'
   AND content LIKE '%紋章%';

COMMIT;

-- 4) 確認 -----------------------------------------------------
-- アイテム: 1行（会心の結晶）だけ返り、改心の結晶は0行になること
SELECT id, name, description FROM items WHERE name IN ('会心の結晶', '改心の結晶');
-- 関数: 0行になること
SELECT p.oid::regprocedure AS sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosrc LIKE '%改心の結晶%';
-- お知らせ: 0行になること
SELECT id, title FROM announcements WHERE content LIKE '%改心%';
