// 【確定】2026-10-23 ユーザー指示「スキルはレベル3ごとに覚えるようにして」＋「1・4・7・10…」を選んだ（node --test）
//   技を覚える CLASS LV は 1 から 3 ずつ（初期職 1〜19 で7つ・上位職 1〜28 で10個）。前は 5 ずつ（初期職 1・5…30・上位職 1・5…45）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STAGES, LEARN_STEP, CLASSES, learnOrderOf, learnAtOf, skillsLearnedBy } from './jobs.js'

test('【確定】2026-10-23 技を覚える CLASS LV は 1 から 3 ずつ（初期職 1〜19・上位職 1〜28）', () => {
  assert.equal(LEARN_STEP, 3)
  assert.deepEqual(STAGES.shoki.learnAt, [1, 4, 7, 10, 13, 16, 19])
  assert.deepEqual(STAGES.ichiji.learnAt, [1, 4, 7, 10, 13, 16, 19, 22, 25, 28])
  for (const c of CLASSES) {
    const at = learnAtOf(c.id)
    assert.equal(at.length, learnOrderOf(c.id).length, `${c.id}：技の数と覚える CLASS LV の数が同じ`)
    at.forEach((lv, i) => assert.equal(lv, 1 + i * 3, `${c.id}の${i + 1}つ目は CLASS LV${1 + i * 3}`))
    assert.ok(at[at.length - 1] <= STAGES[c.stage].max, `${c.id}：上限の CLASS LV までに全部覚える`)
  }
  // 覚える数：CLASS LV3 までは1つ・4 で2つ・19 で初期職は全部・上位職は 28 で全部
  assert.deepEqual([1, 3, 4, 6, 7, 18, 19, 30].map(lv => skillsLearnedBy('戦士', lv).length), [1, 1, 2, 2, 3, 6, 7, 7])
  assert.deepEqual([1, 4, 19, 25, 27, 28, 50].map(lv => skillsLearnedBy('侍', lv).length), [1, 2, 7, 9, 9, 10, 10])
})

test('SQL：段階の種が JS と同じ・今いるキャラは一度だけ CLASS LV までの技を覚え直して、新しい技を空き枠へ', () => {
  const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
  assert.ok(SQL.includes("('shoki', 1, 8, '{1,4,7,10,13,16,19}'::int[], 30, 15)"))
  assert.ok(SQL.includes("('ichiji', 3, 10, '{1,4,7,10,13,16,19,22,25,28}'::int[], 50, 30)"))
  const i = SQL.indexOf("if not exists (select 1 from public.v2cap_migrations where key = 'learn_every3_20261023') then")
  assert.ok(i > 0, '一度だけの印')
  const block = SQL.slice(i, SQL.indexOf('end $$;', i))
  assert.ok(block.includes("v_learned := public.v2cap_learn(v_learned, j.cls, coalesce((j.v ->> 'lv')::int, 1));"), '就いた職業ぜんぶ CLASS LV まで覚え直す')
  assert.ok(block.includes('public.v2cap_fill_set(j.v, v_added, j.cls, v_max)'), '新しく覚えた技だけ空き枠へ（前からの技にはさわらない）')
  assert.ok(block.includes("insert into public.v2cap_migrations (key) values ('learn_every3_20261023');"))
  assert.ok(!block.includes('ascension = '), 'アセンションの盤面はさわらない（技の数は同じ）')
})
