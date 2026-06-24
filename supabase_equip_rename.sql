-- ============================================================
-- 装備命名券（+7以上の装備に好きな名前を付ける）
--   ・player_equipment に custom_name 列を追加（装備ごとの表示名）
--   ・商店アイテム「装備命名券」を追加（100万G・effect='equip_rename'）
--   ※ custom_name の更新はクライアント直書き（宝石埋め込みと同じ仕組み・
--     player_equipment は所有者のみ更新可のRLS前提）。保護トリガー対象外。
-- ============================================================

-- 1) 装備に表示名カラムを追加
ALTER TABLE public.player_equipment
  ADD COLUMN IF NOT EXISTS custom_name text;

-- 2) 商店アイテム「装備命名券」を追加（重複追加を防ぐ）
INSERT INTO public.items (name, description, effect, value, buy_price, is_shop_item, unlock_area)
SELECT '装備命名券',
       '+7以上の装備に好きな名前（12文字以内）を付けられる。アイテム覧から使用。',
       'equip_rename', 0, 1000000, true, 1
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE name = '装備命名券');

-- 2b) 既にアイテム追加済みの場合は説明文を最新（+7）に更新
UPDATE public.items
   SET description = '+7以上の装備に好きな名前（12文字以内）を付けられる。アイテム覧から使用。'
 WHERE name = '装備命名券';
