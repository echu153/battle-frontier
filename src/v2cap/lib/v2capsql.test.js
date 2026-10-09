// v2cap：JS（src/v2cap/lib）と SQL（supabase_v2cap_core.sql）の突き合わせ（node --test）
// ★計算の権威はサーバー、表示とシミュレーションはJS。片方だけ直すと画面と実際がズレるので、
//   ここで式・定数・種を機械的に比べる（今のⅡの v2sql.test.js と同じ考え方）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STAT_KEYS, STAT_DEFS, ROLLS_PER_LV } from '../../v2/lib/stats.js'
import { OFF_CLASS_MP_MULT } from '../../v2/lib/skills.js'
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

test('スキルを覚える順はこの版の名簿（v2cap_skills の sort）。他職の技は消費MP2倍', () => {
  const learn = fnBody('v2cap_learn')
  assert.match(learn, /from public\.v2cap_skills k/)
  assert.match(learn, /row_number\(\) over \(order by k\.sort\)/)
  assert.equal(OFF_CLASS_MP_MULT, 2)
  assert.match(fnBody('v2cap_set_cost'), /case when s\.cls = p_cls then 1 else 2 end/)
  assert.match(fnBody('v2cap_set_cost'), /join public\.v2cap_skills s/)
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
