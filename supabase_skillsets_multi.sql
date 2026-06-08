-- ============================================================
-- スキルセットを「状況別」に分離（出撃 / パピア限定 / 挑戦コンテンツ / レイド）
-- ------------------------------------------------------------
-- skill_sets に set_type を追加し、(player_id, set_type, slot_order) で一意にする。
-- 既存の行は 'sortie'(出撃) として扱う。
-- set_type の値: 'sortie' | 'papia' | 'challenge' | 'raid'
--
-- ※未設定(0件)のセットは、アプリ側で 'sortie' セットにフォールバックする。
--   → カスタムするまでは全状況で従来どおり出撃セットが使われる。
--
-- 実行はユーザー側（Supabase SQL Editor）で行う。
-- ============================================================

-- 1) 列を追加（既存行は 'sortie'）
ALTER TABLE skill_sets ADD COLUMN IF NOT EXISTS set_type text NOT NULL DEFAULT 'sortie';

-- 2) 旧 UNIQUE(player_id, slot_order) があれば落とす（set_type 別にスロットを持てるようにする）
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'skill_sets'::regclass
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname ORDER BY att.attname)
        FROM unnest(con.conkey) AS k
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k
      ) = ARRAY['player_id','slot_order']::name[]
  LOOP
    EXECUTE 'ALTER TABLE skill_sets DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- 旧 UNIQUE INDEX(player_id, slot_order) があれば落とす（制約ではなくインデックスの場合）
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT ic.relname AS idxname
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE i.indrelid = 'skill_sets'::regclass
      AND i.indisunique
      AND NOT i.indisprimary
      AND (
        SELECT array_agg(att.attname ORDER BY att.attname)
        FROM unnest(i.indkey) AS k
        JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = k
      ) = ARRAY['player_id','slot_order']::name[]
  LOOP
    EXECUTE 'DROP INDEX ' || quote_ident(r.idxname);
  END LOOP;
END $$;

-- 3) 新しい一意制約（set_type 別にスロットを持てる）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'skill_sets'::regclass AND conname = 'skill_sets_player_settype_slot_uniq'
  ) THEN
    ALTER TABLE skill_sets
      ADD CONSTRAINT skill_sets_player_settype_slot_uniq UNIQUE (player_id, set_type, slot_order);
  END IF;
END $$;
