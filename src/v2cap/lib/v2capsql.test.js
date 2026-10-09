// v2cap：JS（src/v2cap/lib）と SQL（supabase_v2cap_core.sql）の突き合わせ（node --test）
// ★計算の権威はサーバー、表示とシミュレーションはJS。片方だけ直すと画面と実際がズレるので、
//   ここで式・定数・種を機械的に比べる（今のⅡの v2sql.test.js と同じ考え方）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STAT_KEYS, STAT_DEFS, ROLLS_PER_LV } from '../../v2/lib/stats.js'
import { SKILL_SET_SLOTS, SKILL_USE_MAX } from '../../v2/lib/skills.js'
import { DEFAULT_USES_MAX } from './skills.js'
import { NEED_PERMIL, EXP_OFFSET, EXP_SPREAD_PCT, EXP_BOSS_TENTHS, MAX_LV, STAMINA_BASE, STAMINA_PER_LV } from './level.js'
import { JOB_NEED_TENTHS, JOB_MAX } from './jobs.js'
import { SLOTS } from './equipment.js'
import { SORTIE_CD } from './sortie.js'
import { rewrite } from '../../../tools/v2cap-sql.mjs'

const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
const fnBody = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(m, `${name} が見つかる`)
  return m[0]
}

test('SQLの種（段階・職業・スキル・装備・帯・エリア・敵のLV）はJSから作ったものと一致する', () => {
  assert.equal(rewrite(SQL), SQL, '`node tools/v2cap-sql.mjs --write` で作り直すこと')
})

test('必要EXP・必要JBEXP・1勝のEXP・スタミナの式がJSと同じ', () => {
  const need = fnBody('v2cap_need')
  assert.match(need, new RegExp(`when p_lv >= ${MAX_LV} then 0`))
  assert.match(need, new RegExp(`round\\(${NEED_PERMIL}::numeric \\* p_lv \\* p_lv \\* \\(p_lv \\+ 9\\) / 1000\\)`))
  const job = fnBody('v2cap_job_need')
  assert.match(job, new RegExp(`when p_jlv >= ${JOB_MAX} then 0`))
  assert.match(job, new RegExp(`round\\(${JOB_NEED_TENTHS}::numeric \\*`))
  assert.match(job, /\* p_jlv \* p_jlv \/ 10\)/)
  const settle = fnBody('v2cap_sortie_settle')
  assert.match(settle, new RegExp(`v_base := v_en\\.lv \\+ ${EXP_OFFSET};`))
  assert.match(settle, new RegExp(`round\\(v_base \\* ${EXP_BOSS_TENTHS} / 10\\.0\\)`))
  assert.match(settle, new RegExp(`\\(${100 - EXP_SPREAD_PCT} \\+ random\\(\\) \\* ${EXP_SPREAD_PCT * 2}\\) / 100\\.0`))
  assert.match(fnBody('v2cap_stamina_max'), new RegExp(`select ${STAMINA_BASE} \\+ greatest\\(1, coalesce\\(p_lv, 1\\)\\) / ${STAMINA_PER_LV}`))
})

test('LVアップの抽選（回数・並び・上がる量）がJSと同じ', () => {
  const apply = fnBody('v2cap_apply_exp')
  assert.match(apply, new RegExp(`c_rolls\\s+constant int := ${ROLLS_PER_LV};`))
  assert.match(apply, new RegExp(`c_max_lv\\s+constant int := ${MAX_LV};`))
  assert.match(apply, new RegExp(`c_job_max constant int := ${JOB_MAX};`))
  const units = STAT_KEYS.map(k => STAT_DEFS[k].unit).join(', ')
  assert.ok(apply.includes(`c_unit constant int[] := array[${units}];`), '上がる量の並びが STAT_KEYS と同じ')
  STAT_KEYS.forEach((k, i) => assert.ok(apply.includes(`${k} = ${k} + v_gain[${i + 1}]`), `${k} は ${i + 1}番目`))
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
  assert.match(fnBody('v2cap_sortie_settle'), /v_area\.drop_ranks \? coalesce\(p_rank, ''\)/)
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

test('★作り直し（キャラと装備を消す）は印を付けて1回だけ。2回目以降に全文を流し直しても消えない', () => {
  const m = SQL.match(/do \$\$\s*begin\s*if not exists \(select 1 from public\.v2cap_migrations where key = 'reset_classes_20261009'\) then([\s\S]*?)end if;\s*end \$\$;/)
  assert.ok(m, '印つきの do ブロックがある')
  assert.match(m[1], /insert into public\.v2cap_migrations \(key\) values \('reset_classes_20261009'\)/)
  // 印の外で消していない（全文流し直しのたびに消える事故を防ぐ）
  const outside = SQL.replace(m[0], '')
  assert.ok(!/delete from public\.v2cap_(profiles|inventory)\s*;/.test(outside), '印の外で profiles / inventory を丸ごと消していない')
})
