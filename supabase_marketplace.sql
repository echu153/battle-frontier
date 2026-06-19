-- ============================================================
-- 取引所（プレイヤー間マーケット） supabase_marketplace.sql
-- ------------------------------------------------------------
-- ・対象は「装備個体(player_equipment)」のみ。お宝・素材・アーティファクトは対象外。
-- ・基準価格 = weapons.base_price（個別設定。ボス装備/レイド装備はここで設定）
--   未設定なら rarity から算出（一般装備 A〜F）。S/SS/SSS は base_price 未設定だと出品不可。
-- ・出品価格は基準価格の ±50%。
-- ・出品時にエスクロー（listed=true でインベントリから隠す）。
--   出品者は自分でキャンセル可。14日売れなければ自動で手元に戻る（marketplace_expire）。
-- ・売却時に手数料20%（出品者の手取り=price*0.8）。
-- ・購入したアイテムは帰属（is_bound=true）。取引不可・加工不可（強化はOK）。
--
-- ※ 本ファイルは player_equipment の player_id/listed/is_bound を保護する独自トリガーを持つ
--    （GUC: app.allow_market_change）。protect_stats とは別系統のため適用順序の制約はない。
-- ※ 適用順序の制約なし（protect_stats等の後でも前でもよい）。再適用は全文を流すこと。
-- ============================================================

-- 1) 装備テーブルに列追加 --------------------------------------
ALTER TABLE weapons          ADD COLUMN IF NOT EXISTS base_price integer;        -- 取引所の基準価格（NULL=rarity算出 or 出品不可）
ALTER TABLE player_equipment ADD COLUMN IF NOT EXISTS listed   boolean NOT NULL DEFAULT false;  -- 出品中（エスクロー）
ALTER TABLE player_equipment ADD COLUMN IF NOT EXISTS is_bound boolean NOT NULL DEFAULT false;  -- 帰属（取引/加工不可）

-- 1.5) 帰属/出品/所有者の直接改変を禁止する保護トリガー -------------------
-- player_id/listed/is_bound はクライアントが直接書く正当な経路が無い（出品・購入・
-- キャンセル・期限戻しの専用RPCのみが変更する）。直接UPDATEを拒否し、専用RPCは
-- SET LOCAL "app.allow_market_change"='on' を立ててから更新する。
-- ※ weapon_id はアーティファクト覚醒がクライアントから直接書くため保護対象外。
--   出品後の「品替え」は購入RPCが listing.weapon_id と行ロック下で再照合して弾く。
CREATE OR REPLACE FUNCTION public.guard_player_equipment_market()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_market_change', true) = 'on' THEN
    RETURN NEW;  -- 専用RPC経由は許可
  END IF;
  IF NEW.player_id IS DISTINCT FROM OLD.player_id
     OR NEW.listed   IS DISTINCT FROM OLD.listed
     OR NEW.is_bound IS DISTINCT FROM OLD.is_bound THEN
    RAISE EXCEPTION '取引所の保護列(player_id/listed/is_bound)は専用RPC経由でのみ変更できます';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_pe_market ON player_equipment;
CREATE TRIGGER trg_guard_pe_market
  BEFORE UPDATE ON player_equipment
  FOR EACH ROW EXECUTE FUNCTION public.guard_player_equipment_market();

-- 2) 基準価格の算出関数 --------------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_base_price(p_weapon_id integer)
RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE w weapons%ROWTYPE;
BEGIN
  SELECT * INTO w FROM weapons WHERE id = p_weapon_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- 個別設定があれば最優先（ボス装備・レイド装備はここで設定する）
  IF w.base_price IS NOT NULL AND w.base_price > 0 THEN
    RETURN w.base_price;
  END IF;
  -- 一般装備は rarity から算出
  RETURN CASE lower(w.rarity)
    WHEN 'a' THEN 300000
    WHEN 'b' THEN 250000
    WHEN 'c' THEN 150000
    WHEN 'd' THEN 100000
    WHEN 'e' THEN  50000
    WHEN 'f' THEN  20000
    ELSE NULL  -- S/SS/SSS は base_price 未設定だと出品不可
  END;
END; $$;

-- 3) 出品テーブル --------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  equipment_id integer NOT NULL REFERENCES player_equipment(id) ON DELETE CASCADE,
  weapon_id    integer NOT NULL REFERENCES weapons(id),
  price        integer NOT NULL,
  base_price   integer NOT NULL,
  status       text    NOT NULL DEFAULT 'active',  -- active / sold / cancelled / expired
  buyer_id     uuid REFERENCES profiles(id),
  listed_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '14 days',
  sold_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_mp_status   ON marketplace_listings(status);
CREATE INDEX IF NOT EXISTS idx_mp_weapon   ON marketplace_listings(weapon_id);
CREATE INDEX IF NOT EXISTS idx_mp_seller   ON marketplace_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_mp_expires  ON marketplace_listings(expires_at);
CREATE INDEX IF NOT EXISTS idx_mp_sold_at  ON marketplace_listings(sold_at);
-- 同一装備の二重出品防止（activeは1件まで）
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_active_equipment
  ON marketplace_listings(equipment_id) WHERE status = 'active';

-- RLS：閲覧は全認証ユーザー可。書き込みはRPC(SECURITY DEFINER)のみ。
ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mp_select ON marketplace_listings;
CREATE POLICY mp_select ON marketplace_listings FOR SELECT TO authenticated USING (true);
-- INSERT/UPDATE/DELETE ポリシーは作らない＝直接書き込み不可（RPC経由のみ）

-- 4) 期限切れ出品を手元に戻す --------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_expire()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.allow_market_change', 'on', true);  -- 保護トリガー解錠（トランザクション内のみ）
  UPDATE player_equipment pe SET listed = false
  FROM marketplace_listings ml
  WHERE ml.equipment_id = pe.id
    AND ml.status = 'active' AND ml.expires_at < now();
  UPDATE marketplace_listings
  SET status = 'expired'
  WHERE status = 'active' AND expires_at < now();
END; $$;

-- 5) 出品 ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_marketplace_listing(p_equipment_id integer, p_price integer)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_eq   player_equipment%ROWTYPE;
  v_base integer;
  v_min  integer;
  v_max  integer;
  v_effect text;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'reason', '未ログイン'); END IF;
  PERFORM set_config('app.allow_market_change', 'on', true);  -- 保護トリガー解錠
  PERFORM marketplace_expire();

  SELECT * INTO v_eq FROM player_equipment WHERE id = p_equipment_id FOR UPDATE;
  IF NOT FOUND OR v_eq.player_id <> v_uid THEN
    RETURN json_build_object('ok', false, 'reason', '対象の装備が見つかりません'); END IF;
  IF v_eq.equipped THEN
    RETURN json_build_object('ok', false, 'reason', '装備中のアイテムは出品できません'); END IF;
  IF v_eq.listed THEN
    RETURN json_build_object('ok', false, 'reason', 'すでに出品中です'); END IF;
  IF v_eq.is_bound THEN
    RETURN json_build_object('ok', false, 'reason', '帰属アイテムは出品できません'); END IF;
  IF COALESCE(v_eq.enhance_plus, 0) > 0 THEN
    RETURN json_build_object('ok', false, 'reason', '強化済み(+1以上)の装備は出品できません'); END IF;

  SELECT bonus_effect INTO v_effect FROM player_equipment WHERE id = p_equipment_id;
  IF v_effect = 'artifact' THEN
    RETURN json_build_object('ok', false, 'reason', 'アーティファクトは出品できません'); END IF;

  v_base := marketplace_base_price(v_eq.weapon_id);
  IF v_base IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'このアイテムは取引所で扱えません'); END IF;

  v_min := floor(v_base * 0.5);
  v_max := ceil (v_base * 1.5);
  IF p_price < v_min OR p_price > v_max THEN
    RETURN json_build_object('ok', false, 'reason',
      format('価格は %s 〜 %s G の範囲で設定してください', v_min, v_max)); END IF;

  INSERT INTO marketplace_listings (seller_id, equipment_id, weapon_id, price, base_price)
  VALUES (v_uid, p_equipment_id, v_eq.weapon_id, p_price, v_base);

  UPDATE player_equipment SET listed = true WHERE id = p_equipment_id;

  RETURN json_build_object('ok', true);
END; $$;

-- 6) 出品キャンセル ------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_marketplace_listing(p_listing_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ml  marketplace_listings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'reason', '未ログイン'); END IF;
  PERFORM set_config('app.allow_market_change', 'on', true);  -- 保護トリガー解錠
  SELECT * INTO v_ml FROM marketplace_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND OR v_ml.seller_id <> v_uid THEN
    RETURN json_build_object('ok', false, 'reason', '対象の出品が見つかりません'); END IF;
  IF v_ml.status <> 'active' THEN
    RETURN json_build_object('ok', false, 'reason', 'この出品は取消できません'); END IF;

  UPDATE marketplace_listings SET status = 'cancelled' WHERE id = p_listing_id;
  UPDATE player_equipment SET listed = false WHERE id = v_ml.equipment_id;
  RETURN json_build_object('ok', true);
END; $$;

-- 7) 購入 ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.buy_marketplace_listing(p_listing_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_ml       marketplace_listings%ROWTYPE;
  v_eq       player_equipment%ROWTYPE;
  v_proceeds integer;
  v_updated  integer;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'reason', '未ログイン'); END IF;
  PERFORM set_config('app.allow_market_change', 'on', true);  -- 保護トリガー解錠
  PERFORM marketplace_expire();

  SELECT * INTO v_ml FROM marketplace_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', '出品が見つかりません'); END IF;
  IF v_ml.status <> 'active' THEN
    RETURN json_build_object('ok', false, 'reason', 'この出品はすでに終了しています'); END IF;
  IF v_ml.seller_id = v_uid THEN
    RETURN json_build_object('ok', false, 'reason', '自分の出品は購入できません'); END IF;

  -- 対象装備を行ロックして再検証（同時削除/改変・出品後の品替え対策）。
  -- listing と equipment_id/weapon_id/seller・listed・未装備・未強化・非artifact を再照合。
  SELECT * INTO v_eq FROM player_equipment
   WHERE id = v_ml.equipment_id FOR UPDATE;
  IF NOT FOUND
     OR v_eq.player_id <> v_ml.seller_id
     OR v_eq.weapon_id <> v_ml.weapon_id
     OR v_eq.listed = false
     OR v_eq.equipped
     OR COALESCE(v_eq.enhance_plus, 0) > 0
     OR v_eq.bonus_effect = 'artifact' THEN
    UPDATE marketplace_listings SET status = 'cancelled' WHERE id = p_listing_id;
    RETURN json_build_object('ok', false, 'reason', 'この出品は無効になりました'); END IF;

  -- 購入者から代金を引く（残高不足ならNOT FOUND）
  UPDATE profiles SET gold = gold - v_ml.price
   WHERE id = v_uid AND gold >= v_ml.price;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN json_build_object('ok', false, 'reason', '所持金が足りません'); END IF;

  -- 装備を購入者へ条件付き移管（帰属化・装備解除・出品解除）。
  -- 行ロック下なので必ず1件。万一0件ならRAISEで全ロールバック（代金喪失を防ぐ）。
  UPDATE player_equipment
     SET player_id = v_uid, listed = false, is_bound = true, equipped = false
   WHERE id = v_ml.equipment_id
     AND player_id = v_ml.seller_id
     AND weapon_id = v_ml.weapon_id
     AND listed = true;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION '装備の移管に失敗しました（同時変更を検知）';
  END IF;

  -- 出品者へ手取り（手数料20%）
  v_proceeds := floor(v_ml.price * 0.8);
  UPDATE profiles SET gold = gold + v_proceeds WHERE id = v_ml.seller_id;

  UPDATE marketplace_listings
     SET status = 'sold', buyer_id = v_uid, sold_at = now()
   WHERE id = p_listing_id;

  RETURN json_build_object('ok', true, 'price', v_ml.price);
END; $$;

GRANT EXECUTE ON FUNCTION public.marketplace_base_price(integer)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_expire()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_marketplace_listing(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_marketplace_listing(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_marketplace_listing(uuid)        TO authenticated;

-- ============================================================
-- ボス装備（出撃ドロップ）の基準価格を個別設定する例：
--   UPDATE weapons SET base_price = 1000000 WHERE name = '＜ボス装備A＞';
--   UPDATE weapons SET base_price =  300000 WHERE name = '＜ボス装備B＞';
-- レイドボス交換装備も同様に後日設定。
-- ============================================================
