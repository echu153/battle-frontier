-- ============================================================
-- 取引所 補填: 「購入した装備が消えた」対応 (2026-07-20)
-- ------------------------------------------------------------
-- 原因: 2026-07-20 の「帰属装備の加工解禁」で、鍛冶屋のランダム一括加工の
--   抽選対象に帰属装備(取引所で購入)が含まれ、気づかないうちに強化石へ
--   加工され消えるケースが発生。クライアントは修正済み(811a27d=ランダム対象外へ)。
--
-- 検知: 加工で装備行(player_equipment)が削除されると、取引履歴
--   (marketplace_listings)の equipment_id が ON DELETE SET NULL で NULL になる。
--   → status='sold' AND equipment_id IS NULL の購入が「消えた装備」。
--   ただし買い手が同名装備を博物館へ寄贈している場合は意図的な削除の
--   可能性が高いので除外(同名別個体の寄贈も除外される近似だが安全側)。
--
-- 補填: 出品時の個体ボーナススナップショット(listing.bonus)から
--   同じ個体値の装備を再付与(帰属付き・未強化)。
--   補填ログ(marketplace_compensations)で二重実行を防止＝何度流しても安全。
--
-- 実行手順: ①を実行 → ②で対象を目視確認 → ③で補填実行 → ④で結果確認
-- ============================================================

-- ① 補填ログテーブル（二重補填防止）
CREATE TABLE IF NOT EXISTS public.marketplace_compensations (
  listing_id  uuid PRIMARY KEY REFERENCES marketplace_listings(id),
  buyer_id    uuid NOT NULL,
  weapon_id   integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE marketplace_compensations ENABLE ROW LEVEL SECURITY;  -- ポリシー無し=クライアントから不可視

-- ② 対象の確認（補填前に件数・内容を目視すること）
SELECT ml.id AS listing_id, ml.sold_at, b.username AS buyer, w.name AS weapon, ml.price
FROM marketplace_listings ml
JOIN weapons  w ON w.id = ml.weapon_id
JOIN profiles b ON b.id = ml.buyer_id
WHERE ml.status = 'sold'
  AND ml.equipment_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM museum_donations md
                   WHERE md.player_id = ml.buyer_id AND md.weapon_name = w.name)
  AND NOT EXISTS (SELECT 1 FROM marketplace_compensations mc WHERE mc.listing_id = ml.id)
ORDER BY ml.sold_at;

-- ③ 補填の実行（②と同一条件。個体値を復元して帰属付きで再付与）
WITH target AS (
  SELECT ml.id AS listing_id, ml.buyer_id, ml.weapon_id, ml.bonus
  FROM marketplace_listings ml
  JOIN weapons w ON w.id = ml.weapon_id
  WHERE ml.status = 'sold'
    AND ml.equipment_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM museum_donations md
                     WHERE md.player_id = ml.buyer_id AND md.weapon_name = w.name)
    AND NOT EXISTS (SELECT 1 FROM marketplace_compensations mc WHERE mc.listing_id = ml.id)
),
granted AS (
  INSERT INTO player_equipment (
    player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect, is_bound, listed,
    bonus_atk, bonus_def, bonus_matk, bonus_mdef, bonus_spd, bonus_hp, bonus_mp,
    bonus_crit, bonus_evasion, bonus_hit)
  SELECT t.buyer_id, t.weapon_id, w.slot, false, 0, NULL, true, false,
    (t.bonus->>'atk')::integer,  (t.bonus->>'def')::integer,
    (t.bonus->>'matk')::integer, (t.bonus->>'mdef')::integer,
    (t.bonus->>'spd')::integer,  (t.bonus->>'hp')::integer, (t.bonus->>'mp')::integer,
    (t.bonus->>'crit')::integer, (t.bonus->>'evasion')::integer, (t.bonus->>'hit')::integer
  FROM target t
  JOIN weapons w ON w.id = t.weapon_id
  RETURNING player_id
)
INSERT INTO marketplace_compensations (listing_id, buyer_id, weapon_id)
SELECT listing_id, buyer_id, weapon_id FROM target;

-- ④ 結果確認（補填された一覧）
SELECT mc.created_at, b.username AS buyer, w.name AS weapon
FROM marketplace_compensations mc
JOIN profiles b ON b.id = mc.buyer_id
JOIN weapons  w ON w.id = mc.weapon_id
ORDER BY mc.created_at DESC;
