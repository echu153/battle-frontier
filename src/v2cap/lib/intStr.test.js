// 【確定】2026-10-25 ユーザー指示「INT使わないキャラ、STR使わないキャラも多少上がるようにしてほしい、バランス的に　その分他の数値下げるようにして」（node --test）
//   ＋「初期職8・上位職17」・「STRにも役目をつける」＋「物理防御にSTR×0.25」を選んだ
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CLASSES, JOB_BONUS, mainStatsOf } from './jobs.js'
import { CAP_STR_PHYS_DEF } from './rules.js'
import { toFighter } from './loadout.js'
import { npcFighterAt, fromSnapshot } from './tower.js'
import * as areas from './areas.js'
import { physDefOf, damageOf } from '../core/combat.js'
import { createSide, liveStats } from '../core/battle.js'
import { INITIAL_STATS } from '../core/stats.js'

// INT を足した物理の職業・STR を足した魔法の職業（ほかの4職＝魔法剣士・聖騎士・サイキッカー・魔銃士はもとから両方ある）
const GOT_INT = ['剣士', '戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士',
  '侍', '狂戦士', '竜騎士', 'ストームランサー', '体術師', '暗殺者', '忍者', '狩人', 'アークアーチャー', 'デストロイヤー']
const GOT_STR = ['魔法使い', '呪術師', '僧侶', '薬師', '元素使い', 'クロノマンサー', '死霊使い', '式神使い', '聖職者', '異端審問官', 'アルケミスト', '霊薬師']

test('【確定】2026-10-25 どの職業も STR と INT が上がる（無かった職業は初期職8点・上位職17点。合計と高い2〜3種はそのまま）', () => {
  for (const c of CLASSES) {
    const w = JOB_BONUS[c.id]
    assert.ok(w.str > 0 && w.int_stat > 0, `${c.id}：STR・INT とも上がる`)
  }
  const add = (c) => (CLASSES.find(x => x.id === c).stage === 'ichiji' ? 17 : 8)
  for (const c of GOT_INT) assert.equal(JOB_BONUS[c].int_stat, add(c), `${c}の INT`)
  for (const c of GOT_STR) assert.equal(JOB_BONUS[c].str, add(c), `${c}の STR`)
  assert.equal(GOT_INT.length + GOT_STR.length, 29)
  // 高い2〜3種（神殿の「上がりやすいステータス」）は前のまま
  assert.deepEqual(mainStatsOf('戦士'), ['str', 'vit'])
  assert.deepEqual(mainStatsOf('元素使い'), ['int_stat', 'mp'])
  assert.deepEqual(mainStatsOf('聖職者'), ['int_stat', 'hp', 'vit'])
})

test('【確定】2026-10-25 味方の物理防御は VIT＋STR×0.25（敵は VIT だけ＝敵の強さは変わらない）', () => {
  assert.equal(CAP_STR_PHYS_DEF, 0.25)
  assert.equal(physDefOf({ vit: 100, str: 200 }), 100, '割合を持たなければ VIT だけ')
  assert.equal(physDefOf({ vit: 100, str: 200, strDef: 0.25 }), 150)
  // プレイヤー・塔の守護者の姿・空き層のNPCは持つ／敵は持たない
  const prof = { username: 't', class: '戦士', lv: 1, ...INITIAL_STATS, jobs: { 戦士: { lv: 1, exp: 0 } }, learned: [], skill_sets: {}, equipped: {} }
  assert.equal(toFighter(prof, []).strDef, 0.25)
  assert.equal(npcFighterAt(10, 500).strDef, 0.25)
  assert.equal(fromSnapshot({ v: 2, name: '守', cls: '戦士', lv: 10, stats: { hp: 100, mp: 10, str: 50, vit: 10 }, set: [] }).strDef, 0.25)
  const boss = areas.spotOf(3).roster.boss
  assert.equal(areas.toFighter(boss).strDef, undefined, '敵には付けない')
  // 戦闘：STR が高いほど物理のダメージを多く減らす（受ける側が strDef を持つときだけ）
  const me = createSide({ ...toFighter(prof, []), stats: { ...INITIAL_STATS, hp: 1000, str: 400, vit: 50 } })
  assert.equal(liveStats(me).strDef, 0.25)
  const atk = { str: 300, dex: 100, luk: 0 }
  const hit = (def) => damageOf({ attacker: atk, defender: def, mult: 1, kind: 'phys', defRule: 'cap' })
  const d0 = hit({ vit: 50, str: 400, agi: 0, int_stat: 0 })
  const d1 = hit({ vit: 50, str: 400, agi: 0, int_stat: 0, strDef: 0.25 })
  assert.ok(d1 < d0, `STR も物理防御になる（${d1} < ${d0}）`)
})

test('SQL：種（bonus_seq・アセンションのMP）は JS から作り直し、29職の盤面を一度だけ戻して編成を収め直す', () => {
  const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
  const i = SQL.indexOf("if not exists (select 1 from public.v2cap_migrations where key = 'jobbonus_intstr_20261025') then")
  assert.ok(i > 0, '一度だけの印')
  const head = SQL.lastIndexOf('do $$', i)
  const block = SQL.slice(head, SQL.indexOf('end $$;', i))
  for (const c of [...GOT_INT, ...GOT_STR]) assert.ok(block.includes(`'${c}'`), `${c}の盤面を戻す`)
  for (const c of ['魔法剣士', '聖騎士', 'サイキッカー', '魔銃士']) assert.ok(!block.includes(`'${c}'`), `${c}は配分が同じ＝戻さない`)
  assert.ok(block.includes('public.v2cap_fit_set(j.v, j.cls'), '最大MPに収め直す')
  assert.ok(block.includes("values ('jobbonus_intstr_20261025')"))
})
