-- ============================================================
-- 取引所 補填 v2: 「購入した装備が消えた」対応 (2026-07-20)
-- ------------------------------------------------------------
-- v1の欠陥: 博物館寄贈の除外を「装備名単位」で行っていたため、同名装備を
--   複数買って1本だけ寄贈した人（例: tentenの氷河長槍×2）の被害分まで
--   除外されて0件になっていた。
-- v2: (買い手, 装備)ごとに「削除された購入数 − 博物館寄贈数」の差分だけ補填。
--   寄贈で説明がつく削除は補填しない。ドロップ入手品を寄贈した場合は
--   寄贈数が多めに数えられ補填が少なくなる方向（=配りすぎない安全側）。
--
-- 前提: ①のログテーブル(marketplace_compensations)は作成済み。
-- 実行手順: ②で対象を目視確認 → ③で補填実行 → ④で結果確認
-- ============================================================

-- ① 補填ログテーブル（v1で作成済みならスキップ可）
CREATE TABLE IF NOT EXISTS public.marketplace_compensations (
  listing_id  uuid PRIMARY KEY REFERENCES marketplace_listings(id),
  buyer_id    uuid NOT NULL,
  weapon_id   integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE marketplace_compensations ENABLE ROW LEVEL SECURITY;

-- ② 対象の確認（買い手×装備ごとに 削除購入数 > 寄贈数 の差分）
WITH del AS (
  SELECT ml.id, ml.buyer_id, ml.weapon_id, ml.sold_at, ml.price,
         row_number() OVER (PARTITION BY ml.buyer_id, ml.weapon_id ORDER BY ml.sold_at DESC) AS rn
  FROM marketplace_listings ml
  WHERE ml.status = 'sold' AND ml.equipment_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM marketplace_compensations mc WHERE mc.listing_id = ml.id)
),
cnt AS (
  SELECT d.buyer_id, d.weapon_id, count(*) AS deleted,
    (SELECT count(*) FROM museum_donations md
      JOIN weapons w2 ON w2.id = d.weapon_id
      WHERE md.player_id = d.buyer_id AND md.weapon_name = w2.name) AS donated
  FROM del d GROUP BY d.buyer_id, d.weapon_id
)
SELECT b.username AS buyer, w.name AS weapon, d.sold_at, d.price
FROM del d
JOIN cnt c ON c.buyer_id = d.buyer_id AND c.weapon_id = d.weapon_id
JOIN weapons  w ON w.id = d.weapon_id
JOIN profiles b ON b.id = d.buyer_id
WHERE d.rn <= c.deleted - c.donated
ORDER BY d.sold_at DESC;

-- ③ 補填の実行（②と同一条件。個体値を復元して帰属付きで再付与）
WITH del AS (
  SELECT ml.id, ml.buyer_id, ml.weapon_id, ml.bonus, ml.sold_at,
         row_number() OVER (PARTITION BY ml.buyer_id, ml.weapon_id ORDER BY ml.sold_at DESC) AS rn
  FROM marketplace_listings ml
  WHERE ml.status = 'sold' AND ml.equipment_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM marketplace_compensations mc WHERE mc.listing_id = ml.id)
),
cnt AS (
  SELECT d.buyer_id, d.weapon_id, count(*) AS deleted,
    (SELECT count(*) FROM museum_donations md
      JOIN weapons w2 ON w2.id = d.weapon_id
      WHERE md.player_id = d.buyer_id AND md.weapon_name = w2.name) AS donated
  FROM del d GROUP BY d.buyer_id, d.weapon_id
),
target AS (
  SELECT d.id AS listing_id, d.buyer_id, d.weapon_id, d.bonus
  FROM del d
  JOIN cnt c ON c.buyer_id = d.buyer_id AND c.weapon_id = d.weapon_id
  WHERE d.rn <= c.deleted - c.donated
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
