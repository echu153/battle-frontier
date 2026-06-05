-- ============================================================
-- ペット機能（ダンジョン用）Phase 2
--  - 複数所持／派遣で1匹をactive
--  - レベル(exp)＋なつき度(affection)で育成
--  - 画像は美容室と同じ avatars バケットを流用（image_url）
-- ※ exp/affection の付与は Phase3 で RPC 経由のサーバー検証にする
-- ============================================================

create table if not exists pets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  species     text not null,                 -- 種族ID（コード側 SPECIES と対応）
  name        text not null,                 -- ニックネーム
  image_url   text,                          -- カスタム画像URL（null なら種族デフォルト）
  level       int  not null default 1,
  exp         int  not null default 0,
  affection   int  not null default 0,        -- なつき度 0-100
  is_active   boolean not null default false, -- 派遣中（1ユーザー1匹のみ true 運用）
  created_at  timestamptz not null default now()
);

create index if not exists pets_owner_idx on pets(owner_id);

-- 1ユーザーにつき active は1匹だけにする部分ユニーク制約
create unique index if not exists pets_one_active_per_owner
  on pets(owner_id) where (is_active);

alter table pets enable row level security;

-- 自分のペットのみ閲覧・作成・更新・削除できる
drop policy if exists pets_select_own on pets;
create policy pets_select_own on pets for select using (auth.uid() = owner_id);

drop policy if exists pets_insert_own on pets;
create policy pets_insert_own on pets for insert with check (auth.uid() = owner_id);

drop policy if exists pets_update_own on pets;
create policy pets_update_own on pets for update using (auth.uid() = owner_id);

drop policy if exists pets_delete_own on pets;
create policy pets_delete_own on pets for delete using (auth.uid() = owner_id);
