-- ============================================================
-- 初心者ビンゴ② 状態系マスの判定修正（2026-07-18）
-- ------------------------------------------------------------
-- 不具合:
--   1) 基本職リストに「サモナー」が抜けており、サモナーが上位職として
--      カウントされていた（基本職は6種: 戦士/弓使い/魔法使い/僧侶/格闘家/サモナー）。
--   2) 「上位職に転職」「国に所属」「奈落地下5階」は開始後の増分でしか達成
--      できず、ビンゴを開く前に既に転職/加入/到達済みのプレイヤーは
--      永遠に達成不可能だった（サモナーLV100勢の報告事例）。
-- 対策: この3マスは「現在その状態を満たしていれば達成」に変更。
--   （回数系マス=ランクマ/釣り/かかし/洞窟/レイド/寄贈は従来どおり開始後の増分）
-- supabase_beginner_bingo.sql 適用済み環境で単独実行可（関数置換のみ・状態リセットなし）。
-- ============================================================

-- ---------- 現在値スナップショット（サモナーを基本職に追加）----------
CREATE OR REPLACE FUNCTION _bingo_snapshot(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE p profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM profiles WHERE id = p_uid;
  RETURN jsonb_build_object(
    'sortie',    COALESCE(p.bingo_sortie_count,0),
    'enhance',   COALESCE(p.enhance_success_count,0) + COALESCE(p.enhance_fail_count,0),
    'boss_kill', COALESCE(p.boss_kill_count,0),
    'd10',       COALESCE(p.bingo_d10_count,0),
    'fish3h',    COALESCE(p.bingo_fish3h_count,0),
    'scare3h',   COALESCE(p.bingo_scare3h_count,0),
    'rank',      (SELECT count(*) FROM rank_matches      WHERE challenger_id = p_uid),
    'raid',      (SELECT count(*) FROM raid_participants WHERE player_id    = p_uid),
    'donation',  (SELECT count(*) FROM museum_donations  WHERE player_id    = p_uid),
    -- 上位職の所持数（現在のクラスが上位職で class_levels 未登録の場合も1と数える保険付き）
    'advanced',  (SELECT count(*) FROM class_levels WHERE player_id = p_uid
                    AND class_name NOT IN ('戦士','弓使い','魔法使い','僧侶','格闘家','サモナー'))
                 + CASE WHEN p.class IS NOT NULL
                         AND p.class NOT IN ('戦士','弓使い','魔法使い','僧侶','格闘家','サモナー')
                         AND NOT EXISTS (SELECT 1 FROM class_levels
                                          WHERE player_id = p_uid AND class_name = p.class)
                        THEN 1 ELSE 0 END,
    'abyss',     COALESCE((SELECT cleared_floor FROM abyss_progress WHERE player_id = p_uid), 0),
    'country',   CASE WHEN p.country_id IS NOT NULL
                       AND EXISTS (SELECT 1 FROM countries WHERE id = p.country_id AND COALESCE(is_unaffiliated,false) = false)
                      THEN 1 ELSE 0 END
  );
END;
$$;

-- ---------- マス評価（上位職/国/奈落は現在状態で判定）----------
CREATE OR REPLACE FUNCTION _bingo_eval(p_uid uuid, p_card integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cur jsonb; v_base jsonb;
  cells boolean[]; prog jsonb;
  ds int; de int; db int;                 -- ①: 出撃/強化/ボス撃破の増分
  dr int; dra int; dd int; dad int; dfi int; dsc int;  -- ②各増分
  cn int; ab_now int;
BEGIN
  cur := _bingo_snapshot(p_uid);
  INSERT INTO beginner_bingo_state(player_id, card, base) VALUES (p_uid, p_card, cur)
    ON CONFLICT (player_id, card) DO NOTHING;
  SELECT s.base INTO v_base FROM beginner_bingo_state s WHERE s.player_id = p_uid AND s.card = p_card;

  IF p_card = 1 THEN
    ds := (cur->>'sortie')::int  - (v_base->>'sortie')::int;
    de := (cur->>'enhance')::int - (v_base->>'enhance')::int;
    db := (cur->>'boss_kill')::int - (v_base->>'boss_kill')::int;
    cells := ARRAY[ ds>=10, ds>=30, ds>=50, ds>=100, true, de>=1, de>=5, de>=10, db>=1 ];
    prog := jsonb_build_array(
      jsonb_build_array(LEAST(GREATEST(ds,0),10),10),
      jsonb_build_array(LEAST(GREATEST(ds,0),30),30),
      jsonb_build_array(LEAST(GREATEST(ds,0),50),50),
      jsonb_build_array(LEAST(GREATEST(ds,0),100),100),
      jsonb_build_array(0,0),
      jsonb_build_array(LEAST(GREATEST(de,0),1),1),
      jsonb_build_array(LEAST(GREATEST(de,0),5),5),
      jsonb_build_array(LEAST(GREATEST(de,0),10),10),
      jsonb_build_array(LEAST(GREATEST(db,0),1),1)
    );
  ELSE
    dr  := (cur->>'rank')::int     - (v_base->>'rank')::int;
    dfi := (cur->>'fish3h')::int   - (v_base->>'fish3h')::int;
    dsc := (cur->>'scare3h')::int  - (v_base->>'scare3h')::int;
    dd  := (cur->>'d10')::int      - (v_base->>'d10')::int;
    dra := (cur->>'raid')::int     - (v_base->>'raid')::int;
    dad := (cur->>'advanced')::int;                        -- 現在の上位職所持数（状態判定）
    de  := (cur->>'donation')::int - (v_base->>'donation')::int;   -- 博物館寄贈の増分
    cn  := (cur->>'country')::int;                          -- 現在の所属状態
    ab_now := (cur->>'abyss')::int;                         -- 現在の到達階（状態判定）
    cells := ARRAY[
      dr>=1, dfi>=1, dsc>=1, dd>=1, dra>=1,
      dad>=1,          -- 上位職を1つ以上所持していれば達成
      de>=5,
      cn=1,            -- 非加盟国以外に所属していれば達成
      ab_now>=5        -- 奈落地下5階に到達していれば達成
    ];
    prog := jsonb_build_array(
      jsonb_build_array(LEAST(GREATEST(dr,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dfi,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dsc,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dd,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dra,0),1),1),
      jsonb_build_array(LEAST(GREATEST(dad,0),1),1),
      jsonb_build_array(LEAST(GREATEST(de,0),5),5),
      jsonb_build_array(CASE WHEN cn=1 THEN 1 ELSE 0 END,1),
      jsonb_build_array(CASE WHEN ab_now>=5 THEN 1 ELSE 0 END,1)
    );
  END IF;

  RETURN jsonb_build_object('cells', to_jsonb(cells), 'prog', prog);
END;
$$;
