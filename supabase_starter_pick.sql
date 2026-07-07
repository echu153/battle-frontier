-- ============================================================
-- クリア報酬「選ばなかったスターター」付与（2026-07-07）
--   初級の洞窟(d10) / 追憶の遺跡(d30) を踏破すると、チュートリアルで選ばなかった
--   スターター(ヴォル/アルル/ドラム)を1匹もらえる。各ダンジョン1回ずつ＝計2匹。
--   ※既に踏破済みのプレイヤーも、本機能導入後に「もう一度クリア」する必要がある
--     （踏破イベント時にクライアントが grant_starter_pick を呼ぶ。列がnull/pendingの間のみ有効）
--
-- 適用順の制約なし（既存の apply_*/dungeon_finish には触れない独立機能）
-- ============================================================

-- 1) 受け取り状態（null=未 / 'pending'=クリア済で選択可 / 'claimed'=受領済）
alter table profiles add column if not exists starter_pick_d10 text;
alter table profiles add column if not exists starter_pick_d30 text;

-- 2) 踏破時に呼ぶ：受け取り可能なら pending にして候補(未所持スターター)を返す
create or replace function grant_starter_pick(p_dungeon text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_col text; v_state text; v_opts text[];
  v_starters text[] := array['flame','aqua','leaf'];
begin
  if p_dungeon not in ('d10','d30') then raise exception 'bad dungeon'; end if;
  v_col := 'starter_pick_' || p_dungeon;

  -- 実際にそのダンジョンを踏破しているか（踏破イベント経由の呼び出しのみ想定・簡易ガード）
  if not exists (select 1 from dungeon_runs where owner_id = v_uid and dungeon_id = p_dungeon and cleared = true) then
    return json_build_object('eligible', false, 'reason', 'not cleared');
  end if;

  execute format('select %I from profiles where id = $1', v_col) into v_state using v_uid;
  if v_state = 'claimed' then
    return json_build_object('eligible', false, 'reason', 'claimed');
  end if;

  -- 未所持のスターター種を候補に
  select array_agg(s) into v_opts
    from unnest(v_starters) s
   where not exists (select 1 from pets where owner_id = v_uid and species = s);

  if v_opts is null or array_length(v_opts, 1) is null then
    -- もう全スターター所持済み→受け取り枠を消化（以後トリガーしない）
    execute format('update profiles set %I = ''claimed'' where id = $1', v_col) using v_uid;
    return json_build_object('eligible', false, 'reason', 'all owned');
  end if;

  execute format('update profiles set %I = ''pending'' where id = $1', v_col) using v_uid;
  return json_build_object('eligible', true, 'options', to_jsonb(v_opts));
end; $$;
grant execute on function grant_starter_pick(text) to authenticated;

-- 3) 選択して受け取る：未所持スターターを1匹作成し、その枠を claimed にする
create or replace function claim_starter_pick(p_dungeon text, p_species text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_col text; v_state text; v_name text;
begin
  if p_dungeon not in ('d10','d30') then raise exception 'bad dungeon'; end if;
  if p_species not in ('flame','aqua','leaf') then raise exception 'bad species'; end if;
  v_col := 'starter_pick_' || p_dungeon;

  execute format('select %I from profiles where id = $1', v_col) into v_state using v_uid;
  if v_state = 'claimed' then raise exception 'already claimed'; end if;
  if v_state is distinct from 'pending' then raise exception 'not eligible'; end if;

  -- 既に所持している種は選べない
  if exists (select 1 from pets where owner_id = v_uid and species = p_species) then
    raise exception 'species already owned';
  end if;

  v_name := case p_species when 'flame' then 'ヴォル' when 'aqua' then 'アルル' else 'ドラム' end;
  insert into pets(owner_id, species, name, level, exp, is_active)
    values (v_uid, p_species, v_name, 1, 0, false);

  execute format('update profiles set %I = ''claimed'' where id = $1', v_col) using v_uid;
  return json_build_object('ok', true, 'species', p_species, 'name', v_name);
end; $$;
grant execute on function claim_starter_pick(text, text) to authenticated;
