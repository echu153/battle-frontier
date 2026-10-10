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
import { SLOTS, RARITIES } from './equipment.js'
import { SORTIE_CD, DROP_RARITY } from './sortie.js'
import { PLUS_MAX, ENHANCE_SCRAP, ENHANCE_RATE, ENHANCE_GOLD_PER_LV, SCRAP_YIELD, CRAFT_RARITIES, CRAFT_SCRAP, CRAFT_GOLD_PER_LV } from './smith.js'
import { DAILY_EXP_PCT, DAILY_GOLD_PER_LV, DAY_RESET_HOUR } from './daily.js'
import { AVATAR_PRESETS, AVATAR_FILE_RE } from './avatar.js'
import { FORTUNES, PRAY_PERMIL, multTenthsOf } from './tree.js'
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
  // 上限は段階ごと（初期30・一次50＝v2cap_stages.max_jlv）。種が無いときは初期職の上限
  assert.ok(job.includes(`when p_jlv >= coalesce((select s.max_jlv from public.v2cap_stages s where s.stage = p_stage), ${JOB_MAX}) then 0`))
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
  assert.ok(apply.includes(`v_job_max int := ${JOB_MAX};`), 'ClassLVの上限は段階から引く（引けなければ初期職の上限）')
  assert.ok(apply.includes('select c.stage, coalesce(s.max_jlv, 30) into v_stage, v_job_max'))
  assert.ok(!/c_job_max/.test(apply), '上限30の決め打ちはもう無い')
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

test('【確定】クラスのMP（スキル編成の最大MP）は、点数のMP ＋ ClassLVが上がるたびに必ず上がるMP（lv_mp × 上がった回数）＝JSの jobBonusStats と同じ', () => {
  assert.ok(SQL.includes('alter table public.v2cap_classes add column if not exists lv_hp int not null default 0;'))
  assert.ok(SQL.includes('alter table public.v2cap_classes add column if not exists lv_mp int not null default 0;'))
  const f = fnBody('v2cap_job_bonus_mp')
  assert.match(f, /unnest\(c\.bonus_seq\[1:greatest\(0, least\(coalesce\(p_jlv, 1\), s\.max_jlv\) - 1\) \* s\.per_lv\]\)/, '点数のぶん')
  assert.ok(f.includes('select greatest(0, least(coalesce(p_jlv, 1), s.max_jlv) - 1) * c.lv_mp'), '毎回のMP × 上がった回数（上限より上は増えない）')
  // 種の lv_hp・lv_mp は jobs.js の JOB_LV_HPMP から作る（種の突き合わせのテストで見ている）。書き方だけここで見る
  assert.ok(SQL.includes("insert into public.v2cap_classes (id, stage, sort, req_cls, req_jlv, bonus_seq, weapons, kind, lineage, lv_hp, lv_mp) values"))
  assert.ok(SQL.includes('lv_hp = excluded.lv_hp, lv_mp = excluded.lv_mp;'), '流し直したら値も入れ直す')
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

test('【確定】分解：その装備のエリアの残骸が、レア度で ノーマル1・レア5・エピック10・レジェンダリー25 入る（JSと同じ）。着けているものは分解できない', () => {
  const d = fnBody('v2cap_dismantle')
  const yieldCase = `case e.rarity ${RARITIES.map(r => `when '${r}' then ${SCRAP_YIELD[r]}`).join(' ')} else 0 end`
  assert.ok(d.includes(yieldCase), `残骸の数が smith.js の SCRAP_YIELD と同じ（${yieldCase}）`)
  assert.deepEqual(SCRAP_YIELD, { N:1, R:5, E:10, L:25 }, 'ユーザーの表')
  assert.match(d, /select \* into v_row from public\.v2cap_profiles where id = v_uid for update;/, '行をつかんでから（強化と同時でも残骸がずれない）')
  assert.match(d, /i\.player_id = v_uid and i\.id = any\(p_ids\)/, '自分の装備だけ')
  assert.match(d, /not exists \(select 1 from jsonb_each_text\(coalesce\(v_row\.equipped, '\{\}'::jsonb\)\) q/, '着けているものは飛ばす')
  assert.match(d, /group by e\.area/, '残骸はその装備のエリアごと')
  assert.ok(d.includes('update public.v2cap_profiles set materials = v_mats'))
  // 「捨てる」は分解に置き換えた（前の形を落とし、もう作らない）
  assert.ok(SQL.includes('drop function if exists public.v2cap_discard(bigint[]);'))
  assert.ok(!SQL.includes('create or replace function public.v2cap_discard('), '捨てるRPCはもう無い')
})

test('【確定】強化：+10まで・残骸は 1,2,3,4,5,7,8,9,10,11・Goldは必要LV×20×n・成功率は100%から10%ずつ下がる（JSと同じ）。失敗しても強化値はそのまま', () => {
  const e = fnBody('v2cap_enhance')
  assert.ok(e.includes(`c_max         constant int := ${PLUS_MAX};`), '上限がJSと同じ')
  assert.ok(e.includes(`c_scrap       constant int[] := array[${ENHANCE_SCRAP.join(', ')}];`), '残骸の数がJSと同じ')
  assert.ok(e.includes(`c_rate        constant int[] := array[${ENHANCE_RATE.join(', ')}];`), '成功率がJSと同じ')
  assert.ok(e.includes(`c_gold_per_lv constant int := ${ENHANCE_GOLD_PER_LV};`), 'Goldの係数がJSと同じ')
  assert.ok(e.includes('v_gold := greatest(1, v_inv.ilv)::bigint * c_gold_per_lv * v_next;'), 'Gold＝必要LV×20×n（smith.js の enhanceGoldOf）')
  assert.ok(e.includes('v_ok := random() * 100 < c_rate[v_next];'), '抽選は smith.js の rollEnhance と同じ')
  assert.match(e, /select \* into v_row from public\.v2cap_profiles where id = v_uid for update;/, '行をつかんでから見る（連打で二重に使えない）')
  assert.match(e, /where id = p_inventory_id and player_id = v_uid for update;/, '自分の装備だけ')
  // 残骸はその装備のエリアのもの。足りないと通さない
  assert.ok(e.includes('v_key  := v_eq.area::text;'))
  assert.ok(e.includes("if v_have < v_need then return jsonb_build_object('ok', false, 'error', '残骸が足りません'); end if;"))
  assert.ok(e.includes("if v_row.gold < v_gold then return jsonb_build_object('ok', false, 'error', 'Goldが足りません'); end if;"))
  // 成功でも失敗でも残骸とGoldは使う（分岐の前）・強化値を上げるのは成功のときだけ
  const spend = e.indexOf('set materials = v_mats, gold = gold - v_gold')
  const branch = e.search(/if v_ok then\s+update public\.v2cap_inventory set plus = v_next where id = v_inv\.id;\s+end if;/)
  assert.ok(spend > 0 && branch > spend, '使うのは分岐の前・強化値は成功のときだけ上がる')
  assert.ok(!/plus = v_plus - 1|plus = plus - 1|delete from public\.v2cap_inventory/.test(e), '失敗しても下がらない・壊れない')
})

test('【確定】作成（鍛冶屋）：レア・エピック・レジェンダリーを Gold とその装備のエリアの残骸で作る（JSと同じ表）。ノーマルは作れない・武器は職業を見ない', () => {
  const c = fnBody('v2cap_craft')
  const scrapCase = `case v_eq.rarity ${CRAFT_RARITIES.map(r => `when '${r}' then ${CRAFT_SCRAP[r]}`).join(' ')} end`
  const goldCase = `case v_eq.rarity ${CRAFT_RARITIES.map(r => `when '${r}' then ${CRAFT_GOLD_PER_LV[r]}`).join(' ')} end`
  assert.ok(c.includes(`v_need := ${scrapCase};`), `残骸の数が smith.js の CRAFT_SCRAP と同じ（${scrapCase}）`)
  assert.ok(c.includes(`v_gold := greatest(1, v_eq.lv)::bigint * (${goldCase});`), `Gold＝必要LV×係数（smith.js の CRAFT_GOLD_PER_LV）`)
  assert.deepEqual(CRAFT_SCRAP, { R:30, E:100, L:300 }, 'ユーザーの表')
  assert.deepEqual(CRAFT_GOLD_PER_LV, { R:50, E:100, L:200 }, 'ユーザーの表')
  assert.ok(c.includes(`if coalesce(v_eq.rarity, 'N') not in ('${CRAFT_RARITIES.join("', '")}') then`), 'ノーマル（とレア度の無い前の行）は作れない')
  assert.match(c, /select \* into v_row from public\.v2cap_profiles where id = v_uid for update;/, '行をつかんでから見る')
  assert.ok(c.includes('v_key  := v_eq.area::text;'), 'その装備のエリアの残骸を使う')
  assert.ok(c.includes("if v_have < v_need then return jsonb_build_object('ok', false, 'error', '残骸が足りません'); end if;"))
  assert.ok(c.includes("if v_row.gold < v_gold then return jsonb_build_object('ok', false, 'error', 'Goldが足りません'); end if;"))
  assert.match(c, /values \(v_uid, v_eq\.id, v_eq\.lv\) returning id into v_inv;/, '+0・アイテムLV＝必要LVで持ち物に入る（落ちたものと同じ）')
  assert.ok(!/weapons|v_cls/.test(c), '武器は14種どれでも作れる（いまの職業を見ない・ユーザー決定）')
  assert.ok(!/random\(\)/.test(c), '必ずできる（抽選しない）')
})

test('強化値（持ち物の plus）と残骸（プロフィールの materials）の列がある。キャラは消さない', () => {
  assert.ok(SQL.includes('alter table public.v2cap_inventory add column if not exists plus int not null default 0;'))
  assert.ok(SQL.includes("alter table public.v2cap_profiles add column if not exists materials jsonb not null default '{}'::jsonb;"))
  assert.ok(SQL.indexOf('add column if not exists plus int') > SQL.indexOf('create table if not exists public.v2cap_inventory'), '持ち物の表ができたあと')
})

test('【確定】デイリーミッション：受注した時点のLVで報酬が決まる（%とGoldはJSと同じ）。受注してから数え、1日1回だけ受け取れる', () => {
  for (const col of ["daily_day date", "daily_lv int", "daily_counts jsonb not null default '{}'::jsonb", 'daily_claimed boolean not null default false']) {
    assert.ok(SQL.includes(`alter table public.v2cap_profiles add column if not exists ${col};`), col)
  }
  // 日付の区切りは日本時間の5時（JS・今のⅡと同じ）
  assert.ok(fnBody('v2cap_daily_roll').includes(`v_today date := ((now() at time zone 'Asia/Tokyo') - interval '${DAY_RESET_HOUR} hours')::date;`))
  // 報酬の式：%の段（JSの DAILY_EXP_PCT と同じ）・切り上げ・Gold＝LV×100
  const rw = fnBody('v2cap_daily_reward').replace(/\s+/g, ' ')
  const tiers = DAILY_EXP_PCT.filter(([max]) => Number.isFinite(max))
    .map(([max, pct]) => `when greatest(1, coalesce(p_lv, 1)) <= ${max} then ${pct}`).join(' ')
  const last = DAILY_EXP_PCT[DAILY_EXP_PCT.length - 1][1]
  assert.ok(rw.includes(`(case ${tiers} else ${last} end) + 99) / 100`), `%の段がJSと同じ（${tiers} else ${last}）・切り上げ`)
  assert.ok(rw.includes('public.v2cap_need(greatest(1, coalesce(p_lv, 1)))'), '必要EXPはLVの表（v2cap_need）')
  assert.ok(rw.includes(`'gold', greatest(1, coalesce(p_lv, 1)) * ${DAILY_GOLD_PER_LV})`))
  // 受注：その時点のLVを入れる・1日1回・行をつかんでから
  const acc = fnBody('v2cap_daily_accept')
  assert.match(acc, /perform 1 from public\.v2cap_profiles where id = v_uid for update;/)
  assert.ok(acc.includes("if v_row.daily_lv is not null then"))
  assert.match(acc, /set daily_lv = lv, daily_counts = '\{\}'::jsonb, daily_claimed = false/, '受注した時点のLV・受注してから数える')
  // 数える：一覧にあるキーだけ・受注した日だけ・受け取ったあとは数えない
  const bump = fnBody('v2cap_daily_bump')
  assert.match(bump, /not exists \(select 1 from public\.v2cap_daily_tasks t where t\.key = p_key\)/)
  assert.ok(bump.includes('where id = p_player and daily_lv is not null and not daily_claimed;'), '受注してから数える（ユーザー決定）')
  // 出撃の精算：勝ったときだけ「出撃に勝つ」を数える
  assert.match(fnBody('v2cap_sortie_settle'), /if v_win then\s+perform public\.v2cap_daily_bump\(v_uid, 'win', 1\);\s+end if;/)
  // 受け取り：受注している・受け取っていない・一覧を全部満たす。二重に受け取れない。EXPは戦闘と同じ扱い
  const cl = fnBody('v2cap_daily_claim')
  assert.match(cl, /perform 1 from public\.v2cap_profiles where id = v_uid for update;/)
  assert.ok(cl.indexOf("'まだ受注していません'") < cl.indexOf("'今日はもう受け取りました'"), '見る順はJSの claimErrorOf と同じ')
  assert.ok(cl.indexOf("'今日はもう受け取りました'") < cl.indexOf("'まだ達成していない項目があります'"))
  assert.match(cl, /where coalesce\(\(v_row\.daily_counts ->> t\.key\)::int, 0\) < t\.goal\)/)
  assert.ok(cl.includes('v_rw   := public.v2cap_daily_reward(v_row.daily_lv);'), '報酬は受注した時点のLV')
  assert.ok(cl.includes('where id = v_uid and not daily_claimed;'))
  assert.ok(cl.includes('v_res := public.v2cap_apply_exp(v_uid, v_exp);'))
  // 内部ヘルパは閉じてある・受注と受け取りだけ開ける
  for (const name of ['v2cap_daily_roll(uuid)', 'v2cap_daily_bump(uuid, text, int)']) {
    assert.ok(SQL.includes(`revoke all on function public.${name} from public, anon, authenticated;`), name)
    assert.ok(!SQL.includes(`grant execute on function public.${name}`), name)
  }
  assert.ok(SQL.includes('grant execute on function public.v2cap_daily_accept() to authenticated;'))
  assert.ok(SQL.includes('grant execute on function public.v2cap_daily_claim() to authenticated;'))
})

test('【確定】アイコン：入れられるのは用意された8枚（JSと同じ名前）か自分のフォルダの画像だけ（判定の形もJSと同じ）', () => {
  assert.ok(SQL.includes('alter table public.v2cap_profiles add column if not exists avatar text;'))
  const f = fnBody('v2cap_set_avatar')
  assert.ok(f.includes(`p_path = any(array[${AVATAR_PRESETS.map(p => `'${p.file}'`).join(', ')}])`), '8枚の名前がJS（avatar.js）と同じ')
  // 自分のフォルダ：「<ユーザーID>/」（36字＋1）のあとに、JSと同じ名前の形
  assert.ok(f.includes(`(left(p_path, 37) = v_uid::text || '/' and substr(p_path, 38) ~ '${AVATAR_FILE_RE.source}')`), '名前の形がJSと同じ')
  assert.ok(f.includes("return jsonb_build_object('ok', false, 'error', 'その画像は選べません');"))
  assert.ok(SQL.includes('grant execute on function public.v2cap_set_avatar(text) to authenticated;'))
  assert.ok(!/gold/.test(f), 'アップロードは無料（Goldを引かない）')
})

test('【確定】ユグレシアの宝樹：運勢の並び・出やすさ・倍率と経験値の割合がJSと同じ。1日1回（管理者も）・ごほうびは経験値だけ', () => {
  for (const col of ['last_pray_at timestamptz', 'last_fortune text', 'pray_count int not null default 0', "pray_log jsonb not null default '[]'::jsonb"]) {
    assert.ok(SQL.includes(`alter table public.v2cap_profiles add column if not exists ${col};`), col)
  }
  const f = fnBody('v2cap_pray')
  assert.ok(f.includes(`c_names  constant text[] := array[${FORTUNES.map(x => `'${x.name}'`).join(', ')}];`), '並びがJSと同じ')
  assert.ok(f.includes(`c_weight constant int[]  := array[${FORTUNES.map(x => x.weight).join(', ')}];`), '出やすさがJSと同じ')
  assert.ok(f.includes(`c_mult   constant int[]  := array[${FORTUNES.map(multTenthsOf).join(', ')}];`), '倍率がJSと同じ')
  const tiers = PRAY_PERMIL.filter(([max]) => Number.isFinite(max)).map(([max, p]) => `when v_lv <= ${max} then ${p}`).join(' ')
  assert.ok(f.includes(`v_permil := case ${tiers} else ${PRAY_PERMIL[PRAY_PERMIL.length - 1][1]} end;`), '割合の段がJSと同じ')
  assert.ok(f.includes('v_exp    := (public.v2cap_need(v_lv) * v_permil * c_mult[v_idx] + 9999) / 10000;'), '切り上げ（tree.js の prayExpOf）')
  assert.match(f, /returning p\.lv, p\.pray_count, p\.pray_log into v_lv, v_count, v_log;/, '祈った時点のLV')
  assert.ok(f.includes('v_res := public.v2cap_apply_exp(v_uid, v_exp);'), 'EXPは戦闘と同じ扱い')
  // 1日1回：確認と記録を1文で（日本時間の5時で切り替わる）。管理者だけ何回でも、は入れない
  assert.ok(f.includes("< ((now()           at time zone 'Asia/Tokyo') - interval '5 hours')::date)"))
  assert.ok(!/is_admin|v_admin/.test(f), '管理者だけ何回でも、は入れない（この版は管理者しか入れない）')
  assert.ok(!/gold/.test(f), 'ごほうびは経験値だけ（ユーザー決定）')
  assert.ok(SQL.includes('grant execute on function public.v2cap_pray() to authenticated;'))
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
