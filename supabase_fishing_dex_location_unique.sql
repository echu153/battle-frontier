-- 釣り図鑑: 場所違いの同名魚が登録できない不具合の根治
--
-- 原因: fishing_records の一意制約が (player_id, fish_name) で location を含まない。
--       そのため「カリブ海のカンパチ(D)」を先に釣ったプレイヤーは、
--       以後「日本海のカンパチ(B)」を釣っても insert が制約に弾かれ、図鑑が???のまま残る。
--       2026-07-04の改名(カリブカンパチ)は逆順(日本海が先)のケースしか塞げていなかった。
--
-- 単独実行可。他のSQLとの順序依存なし（profilesを触らないので protect_stats 等と無関係）。
-- ※SQLエディタは1文ずつ自動コミットするため一時テーブルは使わない。
--   代わりに「制約を直す → 旧行が残っているうちに補填 → 旧行を掃除」の順で流す。
--   各ステップは冪等なので、途中で止まっても頭から流し直して構わない。

-- ============================================================
-- ① 一意制約を (player_id, fish_name) → (player_id, location, fish_name) へ
-- ============================================================

-- 新しい一意制約を張る前に、万一の重複(場所+魚名)を1件へ寄せる
DELETE FROM public.fishing_records a
 USING public.fishing_records b
 WHERE a.player_id = b.player_id
   AND a.location IS NOT DISTINCT FROM b.location
   AND a.fish_name = b.fish_name
   AND a.ctid > b.ctid;

-- 制約名が環境依存なので、列構成で特定して落とす
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.fishing_records'::regclass
       AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(c.conkey) AS k
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
           = ARRAY['fish_name','player_id']
  LOOP
    EXECUTE format('ALTER TABLE public.fishing_records DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE '旧一意制約を削除: %', r.conname;
  END LOOP;

  -- 制約ではなく一意インデックスとして張られている場合
  FOR r IN
    SELECT i.relname
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
     WHERE x.indrelid = 'public.fishing_records'::regclass
       AND x.indisunique AND NOT x.indisprimary
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(x.indkey::int[]) AS k
              JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k)
           = ARRAY['fish_name','player_id']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.relname);
    RAISE NOTICE '旧一意インデックスを削除: %', r.relname;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS fishing_records_player_location_fish_uniq
  ON public.fishing_records (player_id, location, fish_name);

-- ============================================================
-- ② 補填: 衝突で「日本海のカンパチ」を登録できなかったプレイヤーへ付与
--    旧「カンパチ@カリブ海」行がまだ残っている今のうちに、それを目印にして特定する
--    （2026-07-04のカリブカンパチ補填と同じ考え方＝日本海で釣り実績がある人が対象）
-- ============================================================
INSERT INTO public.fishing_records (player_id, fish_name, fish_rank, location, first_caught_at, bonus_claimed)
SELECT DISTINCT k.player_id, 'カンパチ', 'b', '日本海', now(), false
  FROM public.fishing_records k
 WHERE k.fish_name = 'カンパチ' AND k.location = 'カリブ海'
   AND EXISTS (
         SELECT 1 FROM public.fishing_records r
          WHERE r.player_id = k.player_id AND r.location = '日本海'
       )
   AND NOT EXISTS (
         SELECT 1 FROM public.fishing_records r
          WHERE r.player_id = k.player_id AND r.location = '日本海' AND r.fish_name = 'カンパチ'
       );

-- ============================================================
-- ③ 旧「カンパチ@カリブ海」行を現行の名前へ整理
-- ============================================================

-- 旧行が「受取済み」なら、救済で入った カリブカンパチ 側へ引き継ぐ（ボーナス二重取り防止）
UPDATE public.fishing_records nw
   SET bonus_claimed = true
  FROM public.fishing_records old
 WHERE nw.player_id = old.player_id
   AND nw.location = 'カリブ海' AND nw.fish_name = 'カリブカンパチ' AND nw.bonus_claimed = false
   AND old.location = 'カリブ海' AND old.fish_name = 'カンパチ'    AND old.bonus_claimed = true;

-- 救済で カリブカンパチ が既に入っている人は、旧行を破棄
DELETE FROM public.fishing_records a
 WHERE a.fish_name = 'カンパチ' AND a.location = 'カリブ海'
   AND EXISTS (
     SELECT 1 FROM public.fishing_records b
      WHERE b.player_id = a.player_id AND b.location = 'カリブ海' AND b.fish_name = 'カリブカンパチ'
   );

-- 残りは現行の名前へ改名（ランクも現行データに合わせる）
UPDATE public.fishing_records
   SET fish_name = 'カリブカンパチ', fish_rank = 'd'
 WHERE fish_name = 'カンパチ' AND location = 'カリブ海';

-- 確認用
-- SELECT location, fish_name, count(*) FROM public.fishing_records
--  WHERE fish_name IN ('カンパチ','カリブカンパチ') GROUP BY 1,2 ORDER BY 1,2;
