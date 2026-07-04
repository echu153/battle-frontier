-- ============================================================
-- アリーナ 初期配置（一回限り）  2026-07-04
-- ------------------------------------------------------------
-- 戦闘力ランキング上位10名を 1位→最上位(10階) … 10位→1階 に着席させる。
-- 11〜20階は空きのまま（人が上がってきて埋まる）。
--
-- ※ 戦闘力はキャッシュ列(hp_max/mp_max/atk/def/matk/mdef/spd)からの概算。
--   装備/ペット/チャーム/称号ボーナスは含まないため真の戦闘力とは僅差。
--   厳密にしたい場合はアリーナを一旦空にして、クライアント側の正確な上位10で座らせ直すこと。
-- ※ すでに誰かが着席している階は上書きしない（holder_id IS NULL のみ着席）。
-- ※ arena_slots は保護トリガー対象外なので app.allow_stat_change は不要。
-- supabase_arena.sql を先に適用してから、このファイルを1回だけ実行してください。
-- ============================================================
BEGIN;

WITH base AS (
  SELECT id, username, hp_max, mp_max,
    floor(
      (COALESCE(hp_max,0)/10.0) + (COALESCE(mp_max,0)/5.0)
      + COALESCE(atk,0) + COALESCE(def,0) + COALESCE(matk,0) + COALESCE(mdef,0) + COALESCE(spd,0)
    )::int AS power
  FROM profiles
  WHERE COALESCE(exclude_from_ranking, false) = false
    AND COALESCE(is_suspended, false) = false
),
ranked AS (
  SELECT id, username, hp_max, mp_max, power,
         row_number() OVER (ORDER BY power DESC, id) AS rn
  FROM base
)
UPDATE arena_slots s
SET holder_id     = r.id,
    hp_current    = GREATEST(1, COALESCE(r.hp_max, 1)),
    mp_current    = GREATEST(0, COALESCE(r.mp_max, 0)),
    hp_max        = GREATEST(1, COALESCE(r.hp_max, 1)),
    mp_max        = GREATEST(0, COALESCE(r.mp_max, 0)),
    streak        = 0,
    defeated_name = NULL,
    updated_at    = now()
FROM ranked r
WHERE r.rn <= 10
  AND s.floor = 11 - r.rn      -- 1位→floor10, 2位→floor9, … 10位→floor1
  AND s.holder_id IS NULL;     -- 既に着席済みの階は触らない

-- 確認用（着席状況）
SELECT s.floor, p.username, s.hp_current, s.mp_current
FROM arena_slots s LEFT JOIN profiles p ON p.id = s.holder_id
ORDER BY s.floor DESC;

COMMIT;
