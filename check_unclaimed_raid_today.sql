-- ============================================================
-- 今日のレイドボスで報酬を受け取れていないプレイヤー一覧（読み取り専用）
--   raid_boss は spawn_date(JST日付) で1日分。今日(JST)のレイドのうち
--   討伐/時間切れ済みで reward_claimed=false の参加者を出す。
-- ============================================================
SELECT
  rb.spawn_date            AS 出現日,
  rb.boss_name             AS ボス,
  rb.status                AS 状態,
  p.username               AS プレイヤー,
  rp.attack_count          AS 出撃回数,
  rp.damage_dealt          AS 与ダメ,
  rp.reward_claimed        AS 受取済み
FROM raid_participants rp
JOIN raid_boss rb ON rb.id = rp.raid_id
JOIN profiles  p  ON p.id  = rp.player_id
WHERE rb.spawn_date = (now() AT TIME ZONE 'Asia/Tokyo')::date
  AND rb.status IN ('defeated','expired')
  AND rp.reward_claimed = false
ORDER BY rb.boss_name, rp.attack_count DESC;

-- 参考: 直近のレイドボスの状態一覧（今日分が無い/別日付の場合の確認用）
-- SELECT id, spawn_date, boss_name, status, hp_current, hp_max, spawned_at, defeated_at
-- FROM raid_boss ORDER BY spawned_at DESC LIMIT 10;
