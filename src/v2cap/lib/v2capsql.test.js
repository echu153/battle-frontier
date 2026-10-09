// v2cap：JS（src/v2cap/lib）と SQL（supabase_v2cap_core.sql）の突き合わせ（node --test）
// ★計算の権威はサーバー、表示とシミュレーションはJS。片方だけ直すと画面と実際がズレるので、
//   ここで式・定数・種を機械的に比べる（今のⅡの v2sql.test.js と同じ考え方）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STAT_KEYS } from '../../v2/lib/stats.js'
import { SKILL_SET_SLOTS, SKILL_USE_MAX } from '../../v2/lib/skills.js'
import { DEFAULT_USES_MAX } from './skills.js'
import { NEED_PERMIL, MAX_LV, STAMINA_BASE, STAMINA_RECOVER_MS, POINTS_PER_LV, POINTS_STEP, POINTS_ON_STEP, POINT_UNIT } from './level.js'
import { JOB_NEED_TENTHS, JOB_MAX } from './jobs.js'
import { ROLE_TENTHS } from './areas.js'
import { SLOTS } from './equipment.js'
import { SORTIE_CD, DROP_RARITY } from './sortie.js'
import { rewrite } from '../../../tools/v2cap-sql.mjs'

const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
const fnBody = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(m, `${name} が見つかる`)
  return m[0]
}

test('SQLの種（段階・職業・スキル・装備・場所・敵）はJSから作ったものと一致する', () => {
  assert.equal(rewrite(SQL), SQL, '`node tools/v2cap-sql.mjs --write` で作り直すこと')
  // ★改行が CRLF のファイル（Windowsで取り出し直したとき）でも、同じ中身なら食い違わない
  const crlf = SQL.replace(/\r?\n/g, '\r\n')
  assert.equal(rewrite(crlf), crlf, 'CRLF のファイルに LF の種を混ぜていない')
})

test('必要EXP・必要ClassEXP・スタミナの式と係数がJSと同じ', () => {
  const need = fnBody('v2cap_need')
  assert.match(need, new RegExp(`when p_lv >= ${MAX_LV} then 0`))
  assert.match(need, new RegExp(`round\\(${NEED_PERMIL}::numeric \\* p_lv \\* p_lv \\* p_lv / 1000\\)`))
  const job = fnBody('v2cap_job_need')
  assert.match(job, new RegExp(`when p_jlv >= ${JOB_MAX} then 0`))
  assert.match(job, new RegExp(`round\\(${JOB_NEED_TENTHS}::numeric \\*`))
  assert.match(job, /\* p_jlv \* p_jlv \/ 10\)/)
  // スタミナ：最大値は 10＋(LV−1)・回復は3分に1（2026-10-09 ユーザー指示）
  assert.match(fnBody('v2cap_stamina_max'), new RegExp(`select ${STAMINA_BASE} \\+ greatest\\(1, coalesce\\(p_lv, 1\\)\\) - 1`))
  assert.ok(fnBody('v2cap_stamina_roll').includes(`c_span constant interval := interval '${STAMINA_RECOVER_MS / 60000} minutes';`), '回復の間隔がJSと同じ')
})

test('【確定】1勝のEXPとGoldは場所の表 × 役割の倍率（朝昼晩1.5倍・レア3倍・ボス5倍）。サーバーが決める', () => {
  const settle = fnBody('v2cap_sortie_settle')
  assert.ok(settle.includes(`v_tenths := case v_en.role when 'timed' then ${ROLE_TENTHS.timed} when 'rare' then ${ROLE_TENTHS.rare} when 'boss' then ${ROLE_TENTHS.boss} else ${ROLE_TENTHS.normal} end;`),
    '倍率がJS（areas.js の ROLE_TENTHS）と同じ')
  // 範囲の中の整数を均等に1つ → 倍率を掛けて四捨五入（JSの rollRewards・scaleByRole と同じ）
  assert.ok(settle.includes('v_exp  := ((v_spot.exp_min  + floor(random() * (v_spot.exp_max  - v_spot.exp_min  + 1))::int) * v_tenths + 5) / 10;'))
  assert.ok(settle.includes('v_gold := ((v_spot.gold_min + floor(random() * (v_spot.gold_max - v_spot.gold_min + 1))::int) * v_tenths + 5) / 10;'))
  assert.match(settle, /gold = gold \+ v_gold/)
  // 負けても経験値はその場所の最低値（倍率なし・Goldなし＝ sortie.js の lossExpOf）
  assert.match(settle, /else\s+--[^\n]*\n(\s*--[^\n]*\n)*\s*v_exp := v_spot\.exp_min;\s+end if;/)
  // アイテムLV＝その装備の必要LV（v2cap_equipment.lv・エリア×レア度）。レア度も装備が持つ（持ち物にランクの列は無い）
  assert.match(settle, /values \(v_uid, v_eq\.id, v_eq\.lv\)/)
  assert.ok(!/item_lv/.test(settle), '場所のアイテムLVはもう使わない')
})

test('【確定】落ちた装備は「その場所のエリアの装備」で「その役割の敵から落ちるレア度」のときだけ持ち物に入る', () => {
  const settle = fnBody('v2cap_sortie_settle')
  assert.match(settle, /v_eq\.area = v_spot\.area/)
  // JS（sortie.js の DROP_RARITY）から「そのレア度を落とす役割」を作って、SQLの条件と突き合わせる
  const all = Object.keys(DROP_RARITY)
  const roles = (r) => all.filter(role => (DROP_RARITY[role][r] || 0) > 0)
  assert.deepEqual(roles('N'), all)
  assert.deepEqual(roles('R'), all)
  assert.deepEqual(roles('E'), ['rare', 'boss'], 'エピックはレアとボスから（ユーザー決定）')
  assert.deepEqual(roles('L'), ['boss'], 'レジェンダリーはボスからだけ（ユーザー決定）')
  assert.ok(settle.includes("v_eq.rarity in ('N', 'R')"), 'ノーマル・レアはどの敵からも')
  assert.ok(settle.includes("(v_eq.rarity = 'E' and v_en.role in ('rare', 'boss'))"), 'エピックはレアとボス')
  assert.ok(settle.includes("(v_eq.rarity = 'L' and v_en.role = 'boss')"), 'レジェンダリーはボスだけ')
  assert.ok(!/p_rank|drop_ranks/.test(settle), 'ランクの引数・列はもう使わない')
  assert.ok(SQL.includes('drop function if exists public.v2cap_sortie_settle(int, text, boolean, text, text, boolean);'), 'ランクのある前の形を落とす')
})

test('装備の一覧はエリアとレア度を持つ。ランクの列（持ち物の rank・場所の drop_ranks）は消し、前の基本装備は作り直しのあとで消す', () => {
  assert.ok(SQL.includes('alter table public.v2cap_equipment add column if not exists area int;'))
  assert.ok(SQL.includes('alter table public.v2cap_equipment add column if not exists rarity text;'))
  assert.ok(SQL.includes('alter table public.v2cap_inventory drop column if exists rank;'))
  // 必要LVは装備ごと（エリア×レア度）。場所の item_lv は種より前に消し、持っている装備のアイテムLVは必要LVへそろえる
  assert.ok(SQL.includes('alter table public.v2cap_equipment add column if not exists lv int;'))
  assert.ok(SQL.indexOf('alter table public.v2cap_spots drop column if exists item_lv;') < SQL.indexOf('-- @@seed:spots'), '場所の種を入れる前に消す')
  const align = SQL.search(/update public\.v2cap_inventory i set ilv = e\.lv/)
  assert.ok(align > SQL.indexOf('create table if not exists public.v2cap_inventory'), '持ち物のアイテムLVをそろえる文がある')
  assert.ok(SQL.indexOf('alter table public.v2cap_spots drop column if exists drop_ranks;') < SQL.indexOf('-- @@seed:spots'), '場所の種を入れる前に消す')
  // 前の基本装備（レア度を持たない行）は、持ち物を空にする作り直しのあとで消す（持ち物から指されているものは残す）
  const cleanup = SQL.search(/delete from public\.v2cap_equipment e\r?\n\s*where e\.rarity is null\r?\n\s*and not exists \(select 1 from public\.v2cap_inventory i where i\.base_id = e\.id\);/)
  assert.ok(cleanup > 0, '前の基本装備を消す文がある')
  assert.ok(cleanup > SQL.indexOf("key = 'reset_areas_20261009'"), '作り直しのあと')
  assert.ok(cleanup > SQL.indexOf('create table if not exists public.v2cap_inventory'), '持ち物の表ができたあと')
})

test('【確定】場所は1本道。ボスを倒した一番先の場所の次まで開く（難易度帯の表はもう読まない）', () => {
  assert.match(fnBody('v2cap_open_until'), /coalesce\(\(select max\(x\) from unnest\(coalesce\(p_cleared, '\{\}'\)\) as t\(x\)\), 0\) \+ 1/)
  const settle = fnBody('v2cap_sortie_settle')
  assert.match(settle, /if p_spot > public\.v2cap_open_until\(v_row\.cleared_spots\) then/)
  assert.match(settle, /if v_boss and v_win and not \(v_cleared @> array\[p_spot\]\) then/)
  assert.match(settle, /select \* into v_row from public\.v2cap_profiles where id = v_uid for update;/, '行をつかんでから間隔を見る')
  // 前の形は落としてある・難易度帯とエリアの表は使っていない
  assert.ok(SQL.includes('drop function if exists public.v2cap_unlocked_from_cleared(int[], int[]);'))
  assert.ok(SQL.includes('drop table if exists public.v2cap_tiers;'))
  assert.ok(SQL.includes('drop table if exists public.v2cap_areas;'))
  const live = SQL.replace(/drop (table|function|column) if exists[^;]*;/g, '')
  assert.ok(!/v2cap_tiers|v2cap_areas|unlocked_areas/.test(live.replace(/--[^\n]*/g, '')), '前の表・列を読み書きしていない')
})

test('【確定】LVアップで入るステータスポイントがJSと同じ（ステは上がらない）', () => {
  const apply = fnBody('v2cap_apply_exp')
  assert.match(apply, new RegExp(`c_max_lv\\s+constant int := ${MAX_LV};`))
  assert.match(apply, new RegExp(`c_job_max constant int := ${JOB_MAX};`))
  assert.ok(apply.includes(`v_pts := v_pts + case when v_lv % ${POINTS_STEP} = 0 then ${POINTS_ON_STEP} else ${POINTS_PER_LV} end;`), '入るポイントが level.js と同じ')
  assert.ok(apply.includes('stat_points = stat_points + v_pts,'))
  assert.ok(!/random\(\)/.test(apply), 'LVアップの抽選はもう無い')
  for (const k of STAT_KEYS) assert.ok(!new RegExp(`\\b${k} = ${k} \\+`).test(apply), `LVアップで ${k} は上がらない`)
})

test('【確定】ステータスポイントを振る：8種・1ポイントで HP+8・MP+3・ほか+1・足りないと振れない（JSと同じ）', () => {
  const alloc = fnBody('v2cap_allocate_points')
  assert.ok(alloc.includes("v_keys constant text[] := array['" + STAT_KEYS.join("', '") + "'];"), '振れるのは8種（STAT_KEYS と同じ並び）')
  for (const k of STAT_KEYS) {
    const u = POINT_UNIT[k]
    const want = u === 1 ? `${k} = ${k} + coalesce((p_add ->> '${k}')::int, 0)` : `${k} = ${k} + ${u} * coalesce((p_add ->> '${k}')::int, 0)`
    assert.ok(alloc.replace(/\s+/g, ' ').includes(want), `${k} は1ポイントで+${u}`)
  }
  assert.match(alloc, /select \* into v_row from public\.v2cap_profiles where id = v_uid for update;/, '行をつかんでから見る')
  assert.ok(alloc.includes("if v_sum > v_row.stat_points then return jsonb_build_object('ok', false, 'error', 'ポイントが足りません'); end if;"))
  assert.ok(alloc.includes('stat_points = stat_points - v_sum::int,'))
  assert.ok(SQL.includes('grant execute on function public.v2cap_allocate_points(jsonb) to authenticated;'))
  assert.ok(SQL.includes('revoke all on function public.v2cap_allocate_points(jsonb) from public, anon;'))
  assert.ok(SQL.includes('alter table public.v2cap_profiles add column if not exists stat_points int not null default 0;'))
})

test('スキルを覚える順はこの版の名簿（v2cap_skills の sort）', () => {
  const learn = fnBody('v2cap_learn')
  assert.match(learn, /from public\.v2cap_skills k/)
  assert.match(learn, /row_number\(\) over \(order by k\.sort\)/)
})

test('【確定】スキルはその職業（と下位職）でだけ使える。消費MPは名簿のまま（他職を2倍にする形はやめた）', () => {
  const cost = fnBody('v2cap_set_cost')
  assert.match(cost, /create or replace function public\.v2cap_set_cost\(p_set jsonb\)/)
  assert.match(cost, /join public\.v2cap_skills s/)
  assert.ok(!/else 2 end|p_cls/.test(cost), '職業で消費MPを変えていない')
  // 前の形（他職を2倍にしていた set_cost・職業だけ見ていた fit_set）は落としてから作る
  assert.ok(SQL.includes('drop function if exists public.v2cap_set_cost(jsonb, text);'))
  assert.ok(SQL.includes('drop function if exists public.v2cap_fit_set(jsonb, text, int);'))
  // 保存のときに職業を見る（文言は skills.js の validateSkillSet と同じ）
  const set = fnBody('v2cap_set_skills')
  assert.match(set, /v_lin := public\.v2cap_lineage\(v_row\.class\);/)
  assert.match(set, /if not \(v_sk\.cls = any\(v_lin\)\) then/)
  assert.ok(set.includes(`format('%sは%sでは使えません（%sのスキル）', v_name, v_row.class, v_sk.cls)`))
  assert.match(set, new RegExp(`c_slots\\s+constant int := ${SKILL_SET_SLOTS};`))
  assert.match(set, new RegExp(`c_use_max constant int := ${SKILL_USE_MAX};`))
  // 転職・移し替えで縮めるときも、その職業で使えない技を外す
  assert.match(fnBody('v2cap_fit_set'), /s\.cls = any\(public\.v2cap_lineage\(p_cls\)\)/)
  assert.match(fnBody('v2cap_fit_set'), /coalesce\(p_learned, '\[\]'::jsonb\) \? s\.name/)
  // 使える職業は v2cap_classes.lineage（種は jobs.js の lineageOf から作る＝種の突き合わせで見ている）
  assert.match(fnBody('v2cap_lineage'), /from public\.v2cap_classes c where c\.id = p_cls/)
})

test('【確定】スキルセットは職業ごと（skill_sets[職業]）。転職で前の編成は残り、初めての職業は覚えた技で始まる', () => {
  assert.match(fnBody('v2cap_set_skills'), /set skill_sets = jsonb_set\([\s\S]*?array\[class\], v_set\)/)
  const change = fnBody('v2cap_change_class')
  assert.match(change, /if v_sets \? v_cls\.id then\s+v_set := public\.v2cap_fit_set\(v_sets -> v_cls\.id, v_cls\.id, v_new, v_max\);\s+else\s+v_set := public\.v2cap_default_set\(v_cls\.id, v_new, v_max\);/)
  assert.match(change, /v_sets := jsonb_set\(v_sets, array\[v_cls\.id\], v_set\);/)
  assert.match(fnBody('v2cap_create_character'), /public\.v2cap_default_set\(v_cls, v_learn,/)
  // 初めての職業の編成の決まり（枠の数・1枠の回数の上限）が skills.js の defaultSetOf と同じ
  const def = fnBody('v2cap_default_set')
  assert.match(def, new RegExp(`c_slots\\s+constant int := ${SKILL_SET_SLOTS};`))
  assert.match(def, new RegExp(`c_uses_max constant int := ${DEFAULT_USES_MAX};`))
  // 前の「1つだけの編成」（skill_set）は、古い列があるときだけ動く移し替えの中でしか触らない
  const m = SQL.match(/do \$\$\s*begin\s*if exists \(select 1 from information_schema\.columns[\s\S]*?column_name = 'skill_set'\) then([\s\S]*?)end if;\s*end \$\$;/)
  assert.ok(m, '移し替えは古い列があるときだけ動く（全文を流し直しても2回目以降は何もしない）')
  assert.match(m[1], /public\.v2cap_fit_set\(p\.skill_set, p\.class, p\.learned,/, '移すときに他の職業の技を外す')
  assert.match(m[1], /alter table public\.v2cap_profiles drop column skill_set;/)
  const outside = SQL.replace(m[0], '').replace(/--[^\n]*/g, '')
  assert.ok(!/\bskill_set\b/.test(outside), '移し替えの外に skill_set が残っていない')
  // 移し替えは、使う関数（v2cap_fit_set）を作ったあとに置く
  assert.ok(SQL.indexOf(m[0]) > SQL.indexOf('create or replace function public.v2cap_fit_set('))
})

test('★今のⅡ（v2_）のテーブルは読みも書きもしない（この版の名簿と装備の一覧を使う）', () => {
  assert.ok(!/public\.v2_/.test(SQL), 'supabase_v2cap_core.sql に public.v2_ が出てこない')
})

test('【確定】武器は職業ごとに装備できる種類だけ（着ける・落ちる・転職で外す の3か所で見る）', () => {
  assert.match(fnBody('v2cap_equip'), /if not \(v_eq\.type = any\(coalesce\(v_cls\.weapons, '\{\}'\)\)\) then/)
  assert.match(fnBody('v2cap_sortie_settle'), /v_eq\.part <> '武器' or v_eq\.type = any\(coalesce\(v_cls\.weapons, '\{\}'\)\)/)
  const change = fnBody('v2cap_change_class')
  assert.match(change, /select not \(e\.type = any\(coalesce\(v_cls\.weapons, '\{\}'\)\)\) into v_off/)
  assert.match(change, /v_equip := v_equip - 'weapon'/)
})

test('【確定】枠は7つ（武器1・頭・鎧・腕・足・アクセ2）。盾・左手は無い', () => {
  const list = SLOTS.map(s => `'${s}'`).join(',')
  assert.ok(fnBody('v2cap_equip').includes(`if p_slot not in (${list}) then`), '着けられる枠がJSと同じ')
  assert.ok(!/'left'|'right'/.test(fnBody('v2cap_equip')), '右手・左手の枠は無い')
})

test('出撃の間隔はサーバーでも見る（10秒・通信の揺れぶん2秒の余裕）', () => {
  assert.equal(SORTIE_CD, 10)
  assert.match(fnBody('v2cap_sortie_settle'), /c_cd constant interval := interval '8 seconds';/)
})

test('★公開RPCは全部 v2cap_is_dev()（is_admin だけ）を通している', () => {
  const granted = [...SQL.matchAll(/grant execute on function public\.(v2cap_\w+)\(/g)].map(m => m[1])
  assert.ok(granted.length >= 10, `公開RPCを拾えている（${granted.length}本）`)
  for (const name of granted) assert.match(fnBody(name), /if not public\.v2cap_is_dev\(\) then/, `${name} が開発限定を見ている`)
  const gate = fnBody('v2cap_is_dev')
  assert.match(gate, /p\.is_admin/)
  assert.ok(!gate.includes('v2_testers'))
})

test('★書き込みをする内部ヘルパは authenticated から閉じてある', () => {
  for (const name of ['v2cap_apply_exp(uuid, int)', 'v2cap_stamina_roll(uuid)']) {
    assert.ok(SQL.includes(`revoke all on function public.${name} from public, anon, authenticated;`), `${name} を閉じている`)
    assert.ok(!SQL.includes(`grant execute on function public.${name}`), `${name} を開けていない`)
  }
})

test('★公開していない関数は、足したものも含めて全部 REVOKE してある（閉じ忘れを防ぐ）', () => {
  const granted = new Set([...SQL.matchAll(/grant execute on function public\.(v2cap_\w+)\(/g)].map(m => m[1]))
  const defined = [...new Set([...SQL.matchAll(/create or replace function public\.(v2cap_\w+)\(/g)].map(m => m[1]))]
  // v2cap_is_dev は「開発者か」を返すだけ（画面からも呼べてよい）
  const helpers = defined.filter(n => !granted.has(n) && n !== 'v2cap_is_dev')
  assert.ok(helpers.length >= 10, `内部ヘルパを拾えている（${helpers.length}本）`)
  for (const name of helpers) {
    assert.match(SQL, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`), `${name} を閉じている`)
  }
})

test('★今のⅡ・旧版のテーブルには書き込まない（v2cap_ 以外への insert/update/delete が無い）', () => {
  const writes = [...SQL.matchAll(/\b(insert into|update|delete from)\s+public\.(\w+)/g)].map(m => m[2])
  const bad = writes.filter(t => !t.startsWith('v2cap_'))
  assert.deepEqual(bad, [])
})

test('★作り直し（キャラと装備を消す）は印を付けて1回ずつだけ。2回目以降に全文を流し直しても消えない', () => {
  // 初期職の見直し・エリアの作り替え・ステータスポイント（どれも 2026-10-09 ユーザー承認）
  let outside = SQL
  for (const key of ['reset_classes_20261009', 'reset_areas_20261009', 'reset_points_20261009']) {
    const m = SQL.match(new RegExp(`do \\$\\$\\s*begin\\s*if not exists \\(select 1 from public\\.v2cap_migrations where key = '${key}'\\) then([\\s\\S]*?)end if;\\s*end \\$\\$;`))
    assert.ok(m, `${key} の印つきの do ブロックがある`)
    assert.ok(m[1].includes(`insert into public.v2cap_migrations (key) values ('${key}')`), `${key} の印を付けている`)
    assert.match(m[1], /delete from public\.v2cap_profiles;/)
    outside = outside.replace(m[0], '')
  }
  // 印の外で消していない（全文流し直しのたびに消える事故を防ぐ）
  assert.ok(!/delete from public\.v2cap_(profiles|inventory)\s*;/.test(outside), '印の外で profiles / inventory を丸ごと消していない')
})
