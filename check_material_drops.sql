-- ============================================================
-- 素材ドロップ（霜の精気など）診断SQL（読み取り専用）
--   エリア素材はクライアントが items テーブルを名前で引いて付与する。
--   未登録/重複登録だとドロップ抽選に当たっても付与されない。
-- ============================================================

-- 1) 素材6種が items に正しく1件ずつ登録されているか
SELECT d.name AS 素材名,
       COUNT(i.id) AS 登録数,  -- 0=未登録(付与失敗) / 2以上=重複(クエリがエラーになり付与失敗)
       MIN(i.id) AS item_id
FROM (VALUES ('森の生命液'),('荒野の薬草'),('古代の精髄'),('蒼海の精気'),('雷鳴の精気'),('霜の精気')) AS d(name)
LEFT JOIN items i ON i.name = d.name
GROUP BY d.name
ORDER BY d.name;

-- 2) 無限ポーションの effect が1件ずつか
--    （2件以上あるとドロップ判定側の .single() がエラーになる）
SELECT effect, COUNT(*) AS cnt, string_agg(name, ' / ') AS items
FROM items
WHERE effect IN ('hp_pct_infinite','mp_pct_infinite')
GROUP BY effect;

-- 3) 参考: 自分が霜の精気/無限MPポーションを所持しているか
--    （所持中はドロップしない仕様。<USER_ID> を自分のIDに置換して実行）
-- SELECT i.name, pi.quantity
-- FROM player_items pi JOIN items i ON i.id = pi.item_id
-- WHERE pi.player_id = '<USER_ID>'
--   AND (i.name = '霜の精気' OR i.effect = 'mp_pct_infinite');
