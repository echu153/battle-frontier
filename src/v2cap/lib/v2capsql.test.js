// v2cap：JS（src/v2cap/lib）と SQL（supabase_v2cap_core.sql）の突き合わせ（node --test）
// ★計算の権威はサーバー、表示とシミュレーションはJS。片方だけ直すと画面と実際がズレるので、
//   ここで式・定数・種を機械的に比べる（今のⅡの v2sql.test.js と同じ考え方）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STAT_KEYS, STAT_DEFS, ROLLS_PER_LV } from '../../v2/lib/stats.js'
import { OFF_CLASS_MP_MULT } from '../../v2/lib/skills.js'
import { NEED_PERMIL, EXP_OFFSET, EXP_SPREAD_PCT, EXP_BOSS_TENTHS, MAX_LV, STAMINA_BASE, STAMINA_PER_LV } from './level.js'
import { JOB_NEED_TENTHS, JOB_MAX, CLASSES, learnOrderOf } from './jobs.js'
import { SORTIE_CD } from './sortie.js'
import { rewrite } from '../../../tools/v2cap-sql.mjs'

const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
const V2SQL = readFileSync(new URL('../../../supabase_v2_core.sql', import.meta.url), 'utf8')
const fnBody = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(m, `${name} が見つかる`)
  return m[0]
}

test('SQLの種（段階・職業・帯・エリア・敵のLV）はJSから作ったものと一致する', () => {
  assert.equal(rewrite(SQL), SQL, '`node tools/v2cap-sql.mjs --write` で作り直すこと')
})

test('必要EXP・必要ジョブEXP・1勝のEXP・スタミナの式がJSと同じ', () => {
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

test('他職のスキルは消費MP2倍（スキルセットの想定利用MP）', () => {
  assert.equal(OFF_CLASS_MP_MULT, 2)
  assert.match(fnBody('v2cap_set_cost'), /case when s\.cls = p_cls then 1 else 2 end/)
})

test('スキルを覚える順（転職5回が要った技は後ろ・同じ組は sort 順）がSQLのスキル名簿と同じ', () => {
  assert.match(fnBody('v2cap_learn'), /row_number\(\) over \(order by k\.req_jobs, k\.sort\)/)
  // 今のⅡの v2_skills の種から (名前, 職業, sort, req_jobs, passive) を拾う
  const rows = [...V2SQL.matchAll(/\('([^']+)','([^']+)',\d+,(\d+),(\d+),(true|false)\)/g)]
    .map(m => ({ name: m[1], cls: m[2], sort: Number(m[3]), req: Number(m[4]), passive: m[5] === 'true' }))
  assert.ok(rows.length > 200, `v2_skills の種を拾えている（${rows.length}件）`)
  for (const c of CLASSES) {
    const sql = rows.filter(r => r.cls === c.id && !r.passive).sort((a, b) => a.req - b.req || a.sort - b.sort).map(r => r.name)
    assert.deepEqual(learnOrderOf(c.id).map(s => s.name), sql, `${c.id}の覚える順`)
  }
})

test('出撃の間隔はサーバーでも見る（10秒・通信の揺れぶん2秒の余裕）', () => {
  assert.equal(SORTIE_CD, 10)
  assert.match(fnBody('v2cap_sortie_settle'), /c_cd constant interval := interval '8 seconds';/)
})

test('★公開RPCは全部 v2cap_is_dev()（is_admin だけ）を通している', () => {
  const granted = [...SQL.matchAll(/grant execute on function public\.(v2cap_\w+)\(/g)].map(m => m[1])
  assert.ok(granted.length >= 10, `公開RPCを拾えている（${granted.length}本）`)
  for (const name of granted) assert.match(fnBody(name), /if not public\.v2cap_is_dev\(\) then/, `${name} が開発限定を見ている`)
  // ゲートは is_admin だけ（今のⅡのテスター名簿は通さない）
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
