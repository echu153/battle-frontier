-- ============================================================
-- 期間限定イベント「夏の出撃ポイントラリー」 (2026-07-27 05:00 〜 2026-08-17 05:00 JST)
--   ・出撃/レイド/ダンジョンでポイント加算（既存の汎用 sortie_lock / grant_event_point が
--     event_config の開催期間を見て自動加算するため、加算ロジックの変更は不要）
--   ・累計ポイントのマイルストーンで報酬を受け取れる（claim_event_reward・25刻み→100/1000刻み）
--   ・event_key = 'sortie_2026_07'
--   Supabase の SQL Editor でファイル全体を実行してください
--   ※protect_stats / mutant_gold より後でOK（apply_battle_result を触らない・gold付与は set_config許可済）
-- ============================================================

-- ===== 0) 新規アイテム / 称号 =====
-- アーティファクト装備選択箱: 使うとアーティファクト10種から1つ選んで受け取る（redeem_artifact_box）
INSERT INTO items (name, description, effect, value)
SELECT 'アーティファクト装備選択箱', 'アイテム画面で使うと、アーティファクト武器10種から1つを選んで受け取れる箱。イベント報酬。', 'artifact_box', 0
WHERE NOT EXISTS (SELECT 1 FROM items WHERE name = 'アーティファクト装備選択箱');

-- 称号「夏バテ気味」(1000pt)・「夏を制した者」(2000pt)：見た目専用（効果なし）。
-- condition_type='event' は称号判定スイッチに無いため、称号ページからは取得不可（RPCからのみ付与）。
INSERT INTO titles (name, description, category, condition_type, condition_value)
SELECT '夏バテ気味', '夏の出撃イベントで1000ptを達成した証。', 'event', 'event', 1000
WHERE NOT EXISTS (SELECT 1 FROM titles WHERE name = '夏バテ気味');

INSERT INTO titles (name, description, category, condition_type, condition_value)
SELECT '夏を制した者', '夏の出撃イベントで2000ptを達成した証。', 'event', 'event', 2000
WHERE NOT EXISTS (SELECT 1 FROM titles WHERE name = '夏を制した者');

-- ===== 1) イベント設定（期間: JST 7/27 05:00 〜 8/17 05:00 =「8/17 4:59まで」）=====
INSERT INTO event_config (event_key, name, starts_at, ends_at) VALUES
  ('sortie_2026_07', '夏の出撃ポイントラリー', '2026-07-27 05:00:00+09', '2026-08-17 05:00:00+09')
ON CONFLICT (event_key) DO UPDATE
  SET name = EXCLUDED.name, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at;

-- ===== 2) 報酬データ =====
-- 2-1) 秘匿: 付与内容＋正体（client SELECT不可・SECURITY DEFINER の claim_event_reward のみ参照）
DELETE FROM event_reward_payloads WHERE event_key = 'sortie_2026_07';
INSERT INTO event_reward_payloads (event_key, threshold, rewards, reveal_label) VALUES
  ('sortie_2026_07',   25, '[{"type":"gold","qty":50000}]', NULL),
  ('sortie_2026_07',   50, '[{"type":"gold","qty":50000}]', NULL),
  ('sortie_2026_07',   75, '[{"type":"gold","qty":100000}]', NULL),
  ('sortie_2026_07',  100, '[{"type":"item","name":"初級エリアボス装備選択箱","qty":1}]', NULL),
  ('sortie_2026_07',  125, '[{"type":"item","name":"スライムの血","qty":2}]', NULL),
  ('sortie_2026_07',  150, '[{"type":"item","name":"盗賊の血","qty":2}]', NULL),
  ('sortie_2026_07',  175, '[{"type":"item","name":"番人の血","qty":2}]', NULL),
  ('sortie_2026_07',  200, '[{"type":"gold","qty":200000}]', NULL),
  ('sortie_2026_07',  225, '[{"type":"item","name":"強化石(A)","qty":2}]', NULL),
  ('sortie_2026_07',  250, '[{"type":"gold","qty":200000}]', NULL),
  ('sortie_2026_07',  275, '[{"type":"item","name":"強化石(A)","qty":2}]', NULL),
  ('sortie_2026_07',  300, '[{"type":"item","name":"初級エリアボス装備選択箱","qty":1}]', NULL),
  ('sortie_2026_07',  325, '[{"type":"item","name":"スライムの血","qty":5}]', NULL),
  ('sortie_2026_07',  350, '[{"type":"item","name":"盗賊の血","qty":5}]', NULL),
  ('sortie_2026_07',  375, '[{"type":"item","name":"番人の血","qty":5}]', NULL),
  ('sortie_2026_07',  400, '[{"type":"gold","qty":300000}]', NULL),
  ('sortie_2026_07',  425, '[{"type":"item","name":"強化石(A)","qty":2}]', NULL),
  ('sortie_2026_07',  450, '[{"type":"gold","qty":300000}]', NULL),
  ('sortie_2026_07',  475, '[{"type":"item","name":"中級エリアボス装備選択箱","qty":1}]', NULL),
  ('sortie_2026_07',  500, '[{"type":"item","name":"海竜の血","qty":2}]', NULL),
  ('sortie_2026_07',  525, '[{"type":"item","name":"雷鷲の血","qty":2}]', NULL),
  ('sortie_2026_07',  550, '[{"type":"gold","qty":300000}]', NULL),
  ('sortie_2026_07',  575, '[{"type":"item","name":"強化石(A)","qty":3}]', NULL),
  ('sortie_2026_07',  600, '[{"type":"item","name":"中級エリアボス装備選択箱","qty":1}]', NULL),
  ('sortie_2026_07',  625, '[{"type":"item","name":"海竜の血","qty":5}]', NULL),
  ('sortie_2026_07',  650, '[{"type":"item","name":"雷鷲の血","qty":5}]', NULL),
  ('sortie_2026_07',  675, '[{"type":"gold","qty":300000}]', NULL),
  ('sortie_2026_07',  700, '[{"type":"item","name":"上級エリアボス装備選択箱","qty":1}]', NULL),
  ('sortie_2026_07',  725, '[{"type":"item","name":"氷霊の血","qty":2}]', NULL),
  ('sortie_2026_07',  750, '[{"type":"item","name":"サラマンダーの血","qty":2}]', NULL),
  ('sortie_2026_07',  775, '[{"type":"item","name":"強化石(A)","qty":4}]', NULL),
  ('sortie_2026_07',  800, '[{"type":"gold","qty":400000}]', NULL),
  ('sortie_2026_07',  825, '[{"type":"item","name":"強化石(A)","qty":4}]', NULL),
  ('sortie_2026_07',  850, '[{"type":"gold","qty":400000}]', NULL),
  ('sortie_2026_07',  875, '[{"type":"item","name":"強化石(A)","qty":4}]', NULL),
  ('sortie_2026_07',  900, '[{"type":"item","name":"上級エリアボス装備選択箱","qty":1}]', NULL),
  ('sortie_2026_07',  925, '[{"type":"item","name":"氷霊の血","qty":5}]', NULL),
  ('sortie_2026_07',  950, '[{"type":"item","name":"サラマンダーの血","qty":5}]', NULL),
  ('sortie_2026_07',  975, '[{"type":"gold","qty":400000}]', NULL),
  ('sortie_2026_07', 1000, '[{"type":"title","name":"夏バテ気味"}]', '称号「夏バテ気味」'),
  ('sortie_2026_07', 1025, '[{"type":"item","name":"強化石(S)","qty":2}]', NULL),
  ('sortie_2026_07', 1050, '[{"type":"item","name":"ボス装備進化支援箱","qty":1}]', NULL),
  ('sortie_2026_07', 1075, '[{"type":"item","name":"強化石(S)","qty":2}]', NULL),
  ('sortie_2026_07', 1100, '[{"type":"item","name":"Sレアレイドボス装備選択券","qty":1}]', NULL),
  ('sortie_2026_07', 1125, '[{"type":"item","name":"強化石(S)","qty":2}]', NULL),
  ('sortie_2026_07', 1150, '[{"type":"gold","qty":500000}]', NULL),
  ('sortie_2026_07', 1175, '[{"type":"item","name":"強者の結晶","qty":1}]', NULL),
  ('sortie_2026_07', 1200, '[{"type":"item","name":"アーティファクト装備選択箱","qty":1}]', NULL),
  ('sortie_2026_07', 1300, '[{"type":"item","name":"強者の結晶","qty":1}]', NULL),
  ('sortie_2026_07', 1400, '[{"type":"item","name":"強者の結晶","qty":1}]', NULL),
  ('sortie_2026_07', 1500, '[{"type":"item","name":"強者の結晶","qty":1}]', NULL),
  ('sortie_2026_07', 1600, '[{"type":"item","name":"強者の結晶","qty":1}]', NULL),
  ('sortie_2026_07', 1700, '[{"type":"item","name":"強者の結晶","qty":1}]', NULL),
  ('sortie_2026_07', 1800, '[{"type":"item","name":"強者の結晶","qty":1}]', NULL),
  ('sortie_2026_07', 1900, '[{"type":"gold","qty":1000000}]', NULL),
  ('sortie_2026_07', 2000, '[{"type":"title","name":"夏を制した者"}]', '称号「夏を制した者」'),
  ('sortie_2026_07', 3000, '[{"type":"item","name":"強者の結晶","qty":3}]', NULL),
  ('sortie_2026_07', 4000, '[{"type":"item","name":"装備命名券","qty":4}]', '装備命名券×4'),
  ('sortie_2026_07', 5000, '[{"type":"item","name":"＋11確定強化石","qty":1}]', '＋11確定強化石');

-- 2-2) 公開: 表示ラベルのみ（隠し報酬は伏字＝？？？？）
DELETE FROM event_rewards WHERE event_key = 'sortie_2026_07';
INSERT INTO event_rewards (event_key, threshold, label) VALUES
  ('sortie_2026_07',   25, '5万G'),
  ('sortie_2026_07',   50, '5万G'),
  ('sortie_2026_07',   75, '10万G'),
  ('sortie_2026_07',  100, '初級エリアボス装備選択箱'),
  ('sortie_2026_07',  125, 'スライムの血×2'),
  ('sortie_2026_07',  150, '盗賊の血×2'),
  ('sortie_2026_07',  175, '番人の血×2'),
  ('sortie_2026_07',  200, '20万G'),
  ('sortie_2026_07',  225, '強化石(A)×2'),
  ('sortie_2026_07',  250, '20万G'),
  ('sortie_2026_07',  275, '強化石(A)×2'),
  ('sortie_2026_07',  300, '初級エリアボス装備選択箱'),
  ('sortie_2026_07',  325, 'スライムの血×5'),
  ('sortie_2026_07',  350, '盗賊の血×5'),
  ('sortie_2026_07',  375, '番人の血×5'),
  ('sortie_2026_07',  400, '30万G'),
  ('sortie_2026_07',  425, '強化石(A)×2'),
  ('sortie_2026_07',  450, '30万G'),
  ('sortie_2026_07',  475, '中級エリアボス装備選択箱'),
  ('sortie_2026_07',  500, '海竜の血×2'),
  ('sortie_2026_07',  525, '雷鷲の血×2'),
  ('sortie_2026_07',  550, '30万G'),
  ('sortie_2026_07',  575, '強化石(A)×3'),
  ('sortie_2026_07',  600, '中級エリアボス装備選択箱'),
  ('sortie_2026_07',  625, '海竜の血×5'),
  ('sortie_2026_07',  650, '雷鷲の血×5'),
  ('sortie_2026_07',  675, '30万G'),
  ('sortie_2026_07',  700, '上級エリアボス装備選択箱'),
  ('sortie_2026_07',  725, '氷霊の血×2'),
  ('sortie_2026_07',  750, 'サラマンダーの血×2'),
  ('sortie_2026_07',  775, '強化石(A)×4'),
  ('sortie_2026_07',  800, '40万G'),
  ('sortie_2026_07',  825, '強化石(A)×4'),
  ('sortie_2026_07',  850, '40万G'),
  ('sortie_2026_07',  875, '強化石(A)×4'),
  ('sortie_2026_07',  900, '上級エリアボス装備選択箱'),
  ('sortie_2026_07',  925, '氷霊の血×5'),
  ('sortie_2026_07',  950, 'サラマンダーの血×5'),
  ('sortie_2026_07',  975, '40万G'),
  ('sortie_2026_07', 1000, '？？？？'),
  ('sortie_2026_07', 1025, '強化石(S)×2'),
  ('sortie_2026_07', 1050, 'ボス装備進化支援箱（ボスの血×10）'),
  ('sortie_2026_07', 1075, '強化石(S)×2'),
  ('sortie_2026_07', 1100, 'Sレアレイドボス装備選択券'),
  ('sortie_2026_07', 1125, '強化石(S)×2'),
  ('sortie_2026_07', 1150, '50万G'),
  ('sortie_2026_07', 1175, '強者の結晶×1'),
  ('sortie_2026_07', 1200, 'アーティファクト装備選択箱'),
  ('sortie_2026_07', 1300, '強者の結晶×1'),
  ('sortie_2026_07', 1400, '強者の結晶×1'),
  ('sortie_2026_07', 1500, '強者の結晶×1'),
  ('sortie_2026_07', 1600, '強者の結晶×1'),
  ('sortie_2026_07', 1700, '強者の結晶×1'),
  ('sortie_2026_07', 1800, '強者の結晶×1'),
  ('sortie_2026_07', 1900, '100万G'),
  ('sortie_2026_07', 2000, '？？？？'),
  ('sortie_2026_07', 3000, '強者の結晶×3'),
  ('sortie_2026_07', 4000, '？？？？'),
  ('sortie_2026_07', 5000, '？？？？');

-- ボス装備報酬は無し（今回は選択箱で付与）。weapon_names 列は使わない＝NULLのまま。
UPDATE event_rewards SET weapon_names = NULL WHERE event_key = 'sortie_2026_07';

-- ===== 3) アーティファクト装備選択箱の交換RPC =====
--   箱1個を消費し、アーティファクト武器10種から1つを付与
--   ※bonus_effect='artifact' 必須（＝MP消費2倍・スキルダメージ1.3倍の特殊能力。覚醒と同じ値）。
--     NULLにすると特殊能力なしの只の武器になる（2026-08-04 修正・supabase_artifact_box_effect_fix_20260804.sql）
CREATE OR REPLACE FUNCTION public.redeem_artifact_box(p_weapon_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_box_id bigint;
  v_held int;
  v_weapon weapons%ROWTYPE;
  v_allowed text[] := ARRAY[
    '黒星ノ断剣','血哭ノ短刃','月影ノ断弓','奈落ノ処刑斧','斬月ノ終刀',
    '虚無ノ閃砲','星喰ノ導杖','終焉ノ魔書','冥哭ノ長槍','深淵ノ霊珠'];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','未認証'); END IF;
  IF NOT (p_weapon_name = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('ok',false,'error','選択できない装備です');
  END IF;
  SELECT id INTO v_box_id FROM items WHERE name = 'アーティファクト装備選択箱' LIMIT 1;
  IF v_box_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','選択箱アイテムが存在しません'); END IF;
  -- 同時交換による複製防止: 所持行をロックしてから消費
  SELECT COALESCE(quantity,0) INTO v_held FROM player_items
    WHERE player_id = v_uid AND item_id = v_box_id FOR UPDATE;
  IF v_held < 1 THEN RETURN jsonb_build_object('ok',false,'error','選択箱を所持していません'); END IF;
  SELECT * INTO v_weapon FROM weapons WHERE name = p_weapon_name LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','装備が見つかりません'); END IF;
  -- 更新0件＝別リクエストが先に消費済み→中断（複製防止の二重ガード）
  UPDATE player_items SET quantity = quantity - 1
    WHERE player_id = v_uid AND item_id = v_box_id AND quantity >= 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','選択箱の消費に失敗しました'); END IF;
  DELETE FROM player_items WHERE player_id = v_uid AND item_id = v_box_id AND quantity <= 0;
  INSERT INTO player_equipment (player_id, weapon_id, slot, equipped, enhance_plus, bonus_effect)
  VALUES (v_uid, v_weapon.id, v_weapon.slot, false, 0, 'artifact');
  RETURN jsonb_build_object('ok',true,'weapon',p_weapon_name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.redeem_artifact_box(text) TO authenticated;

-- ============================================================
-- 補足: ポイント加算は既存の公開版 sortie_lock（sortie_mode_public_20260626）と
--   grant_event_point が event_config の開催期間を見て自動加算するため、本ファイルでの
--   加算ロジック再定義は不要（新イベントの event_config 行を入れるだけで加算が始まる）。
-- ============================================================
