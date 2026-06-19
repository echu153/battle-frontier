-- ============================================================
-- 本番DBで現在有効な関数定義を確認（読み取り専用）
--   同じ関数が複数ファイルで再定義されており、後から流したものが本番になる。
--   各関数をダンプし、過去の修正が巻き戻っていないかを判定する。
-- ============================================================

-- ① 出撃クールダウン：apply_battle_result に last_action_at=now() が残っていないか
--    （残っている＝CD起点が戦闘終了に戻り、cooldown-anchor修正が無効化されている）
SELECT 'apply_battle_result' AS func,
       (pg_get_functiondef('public.apply_battle_result(integer,boolean,boolean,boolean,boolean,integer,integer,integer,integer)'::regprocedure)
         LIKE '%last_action_at=now()%' OR
        pg_get_functiondef('public.apply_battle_result(integer,boolean,boolean,boolean,boolean,integer,integer,integer,integer)'::regprocedure)
         LIKE '%last_action_at = now()%') AS has_last_action_now,
       (pg_get_functiondef('public.apply_battle_result(integer,boolean,boolean,boolean,boolean,integer,integer,integer,integer)'::regprocedure)
         LIKE '%has_active_dungeon%') AS is_dungeon_block_version;

-- ② 交換所：do_exchange の回数制限が「=1限定」の旧版か、「>=」の修正版か
SELECT 'do_exchange' AS func,
       (pg_get_functiondef('public.do_exchange(integer)'::regprocedure) LIKE '%max_per_player = 1%') AS limit_only_when_eq1,
       (pg_get_functiondef('public.do_exchange(integer)'::regprocedure) LIKE '%quantity >= v_qty%') AS has_consume_guard;

-- ③ レイド報酬：claim_raid_rewards が原子的クレームか（NOT reward_claimed RETURNING）
SELECT 'claim_raid_rewards' AS func,
       (pg_get_functiondef('public.claim_raid_rewards(uuid)'::regprocedure) LIKE '%AND NOT reward_claimed%') AS is_atomic_claim,
       (pg_get_functiondef('public.claim_raid_rewards(uuid)'::regprocedure) LIKE '%水禍の雫%') AS is_amaza_version;

-- ④ レイド攻撃：attack_raid_boss が profiles を FOR UPDATE しているか（0秒CD対策）
SELECT 'attack_raid_boss' AS func,
       (pg_get_functiondef('public.attack_raid_boss(uuid,bigint)'::regprocedure) LIKE '%FROM profiles WHERE id = v_player_id FOR UPDATE%') AS has_for_update,
       (pg_get_functiondef('public.attack_raid_boss(uuid,bigint)'::regprocedure) LIKE '%scarecrow_sessions%') AS has_scarecrow_block;

-- 必要なら全文も確認（コメント解除）:
-- SELECT pg_get_functiondef('public.apply_battle_result(integer,boolean,boolean,boolean,boolean,integer,integer,integer,integer)'::regprocedure);
-- SELECT pg_get_functiondef('public.do_exchange(integer)'::regprocedure);
