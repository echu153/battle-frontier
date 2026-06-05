-- ============================================================
-- ペットスキル（バッチ3）
--  - 選択中スキルを保持する列を追加（既定は たいあたり = 'tackle'）
--  - スキル定義・習得Lvはコード側 constants/pets.js の SKILLS に対応
--  - 選択変更は報酬に影響しないため通常のRLS更新（自分のペットのみ）でOK
-- ============================================================

alter table pets add column if not exists active_skill text not null default 'tackle';
-- 持っていくスキル（最大4・コード MAX_SKILL_SLOTS と対応）。既定は たいあたり のみ
alter table pets add column if not exists skill_slots jsonb not null default '["tackle"]'::jsonb;
