-- ============================================================
-- おれおれお の 紋章・八獄 進捗リセット（一般公開前のクリーンスレート化）
--   ・player_emblem: LV1／上限開放0段階／結晶割り振り空 に戻す
--   ・hachigoku_progress: 本日勝利数・クリア記録を全消去
--   ・テスト配布した関連アイテム（成長石／魂8種／記憶8種／結晶22種）を撤去
--   ※アイテムを残したい場合は末尾の DELETE FROM player_items ブロックをコメントアウト。
-- ============================================================
DO $$
DECLARE v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM profiles WHERE username = 'おれおれお';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'おれおれお が見つかりません'; END IF;

  -- 紋章を初期状態へ（行が無ければ次回 emblem_get でLV1作成されるので何もしない）
  UPDATE player_emblem
     SET level = 1, cap_stage = 0, alloc = '{}'::jsonb, updated_at = now()
   WHERE player_id = v_uid;

  -- 八獄の進捗（勝利数・クリア記録）を全消去
  DELETE FROM hachigoku_progress WHERE player_id = v_uid;

  -- テスト配布した紋章・八獄関連アイテムを撤去（残したい場合はこのDELETEを丸ごとコメントアウト）
  DELETE FROM player_items
   WHERE player_id = v_uid
     AND item_id IN (
       SELECT id FROM items WHERE name IN (
         '紋章の成長石',
         'ターパナの魂','マカハドマの魂','アシパトラの魂','チボンダラの魂',
         'プレータの魂','ラウラヴァの魂','カーラスートラの魂','ジョウハリの魂',
         'ターパナの記憶','マカハドマの記憶','アシパトラの記憶','チボンダラの記憶',
         'プレータの記憶','ラウラヴァの記憶','カーラスートラの記憶','ジョウハリの記憶',
         '力の結晶','物理の結晶','知恵の結晶','特殊の結晶','破甲の結晶','破魔の結晶',
         '裂傷の結晶','火傷の結晶','猛毒の結晶','物理吸収の結晶','特殊吸収の結晶',
         '守護の結晶','抗魔の結晶','回避の結晶','改心の結晶','致命の結晶','会耐の結晶',
         '防毒の結晶','防麻の結晶','防火の結晶','防血の結晶','防絶の結晶'
       )
     );
END $$;

-- 確認（LV1／cap_stage0／alloc空 になっていればOK。行が無ければ未作成＝実質初期状態）
SELECT p.username, e.level, e.cap_stage, e.alloc
  FROM profiles p
  LEFT JOIN player_emblem e ON e.player_id = p.id
 WHERE p.username = 'おれおれお';
