-- ============================================================
-- 【お詫び補填・リワード方式】未受取レイド報酬として全プレイヤーへ配布
--   ・終了済み(expired)のボスを2体作成（is_dev=true＝本番枠の制約に当たらない）
--   ・全プレイヤーに raid_participants を作成（reward_claimed=false）
--       雨摩座    : attack_count=50 → claim時に Aティア判定
--       ヴァルゼノク: attack_count=5  → claim時に Cティア判定
--   ・プレイヤーはレイド画面「未受取のレイド報酬」から受け取る（claim_raid_rewards）
--   ・報酬内容・ボス別素材・レア抽選・二重受取防止は本物のRPCが処理。
--   ⚠ 1回だけ実行（2回流すと参加記録が重複してユニーク制約エラー、または二重配布になります）
-- ============================================================
DO $$
DECLARE
  v_amaza uuid;
  v_valz  uuid;
  v_date  date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  -- 終了済みボスを2体（is_dev=true）
  INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at, defeated_at, is_dev)
  VALUES (v_date, '雨摩座', 1000000, 0, 'expired', now(), now(), true)
  RETURNING id INTO v_amaza;

  INSERT INTO raid_boss (spawn_date, boss_name, hp_max, hp_current, status, spawned_at, defeated_at, is_dev)
  VALUES (v_date, '黒龍ヴァルゼノク', 1000000, 0, 'expired', now(), now(), true)
  RETURNING id INTO v_valz;

  -- 雨摩座 = Aティア（attack_count=50）
  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, attack_count, last_attack_at, reward_claimed)
  SELECT v_amaza, id, 0, 50, now(), false FROM profiles;

  -- ヴァルゼノク = Cティア（attack_count=5）
  INSERT INTO raid_participants (raid_id, player_id, damage_dealt, attack_count, last_attack_at, reward_claimed)
  SELECT v_valz, id, 0, 5, now(), false FROM profiles;

  RAISE NOTICE '配布用ボス作成完了: 雨摩座=% / ヴァルゼノク=%', v_amaza, v_valz;
END $$;

-- 確認: 作成した未受取参加記録の件数
SELECT rb.boss_name, count(*) AS 未受取人数
FROM raid_participants rp
JOIN raid_boss rb ON rb.id = rp.raid_id
WHERE rb.is_dev = true AND rb.status = 'expired' AND rp.reward_claimed = false
GROUP BY rb.boss_name;
