import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sql = readFileSync(join(repoRoot, 'supabase_raid_update_20260802.sql'), 'utf8')
const jsx = readFileSync(join(repoRoot, 'src/pages/RaidBoss.jsx'), 'utf8')

const attackFn = sql.match(/CREATE OR REPLACE FUNCTION attack_raid_boss[\s\S]*?\n\$\$;/)[0]
const claimFn  = sql.match(/CREATE OR REPLACE FUNCTION claim_raid_rewards[\s\S]*?\n\$\$;/)[0]

// ============================================================
// ① 出撃回数EXPボーナス（10回+1 / 20回+2 / 30回+3 / 40回+5 / 50回+6）
// ============================================================
const BONUS = [[50, 6], [40, 5], [30, 3], [20, 2], [10, 1]]

test('SQL: 出撃回数ボーナスが仕様どおりの段階になっている', () => {
  for (const [atk, bonus] of BONUS) {
    assert.ok(
      new RegExp(`WHEN v_atk_count >= ${atk} THEN ${bonus}`).test(attackFn),
      `出撃${atk}回で+${bonus}の分岐が無い`
    )
  }
  // 大きい順に評価されないと 50回でも +1 になる
  const order = [...attackFn.matchAll(/WHEN v_atk_count >= (\d+) THEN/g)].map(m => Number(m[1]))
  assert.deepEqual(order, [50, 40, 30, 20, 10], 'CASE の閾値が降順でない（小さい方に先にマッチして誤判定する）')
})

test('SQL: ボーナスは「今回の攻撃を含めた出撃回数」で判定する', () => {
  // Upsert の RETURNING で更新後の attack_count を取らないと、常に1回ぶん古い回数で判定される
  assert.ok(/RETURNING attack_count INTO v_atk_count/.test(attackFn),
    'Upsert の RETURNING で更新後の attack_count を取得していない')
  assert.ok(attackFn.indexOf('RETURNING attack_count INTO v_atk_count') < attackFn.indexOf('WHEN v_atk_count >= 50'),
    'attack_count 取得より前にボーナス判定している')
})

test('SQL: ボーナスは基本EXP(7〜10)に加算される', () => {
  assert.ok(/floor\(random\(\) \* 4\)::int \+ 7 \+ v_exp_bonus/.test(attackFn),
    '基本EXPにボーナスが加算されていない')
})

test('SQL: かかし修練中はボーナス込みでEXP0（リグレッション防止）', () => {
  assert.ok(/v_sc_active := scarecrow_is_active\(v_player_id\)/.test(attackFn),
    'かかし修練チェックが消えている（2026-07-20と同じリグレッション）')
  assert.ok(/IF v_sc_active THEN\s+v_exp_bonus := 0;\s+v_exp_gain\s+:= 0;/.test(attackFn),
    'かかし修練中にボーナスが0になっていない')
})

test('クライアント: EXPボーナス表がSQLと一致している', () => {
  const table = jsx.match(/const RAID_EXP_BONUS = \[[\s\S]*?\]/)[0]
  const pairs = [...table.matchAll(/attacks: (\d+), bonus: (\d+)/g)].map(m => [Number(m[1]), Number(m[2])])
  assert.deepEqual(pairs, BONUS, 'RaidBoss.jsx の RAID_EXP_BONUS が SQL とズレている')
})

// ============================================================
// ② ティア報酬の強者の結晶（A 8% / B 5% / C 3%・Dは無し）
// ============================================================
const CRYSTAL = { A: 0.08, B: 0.05, C: 0.03 }

test('SQL: 強者の結晶の確率がティアごとに設定されている', () => {
  for (const [tier, chance] of Object.entries(CRYSTAL)) {
    const block = claimFn.match(new RegExp(`v_tier := '${tier}';[\\s\\S]*?v_crystal_chance := ([0-9.]+);`))
    assert.ok(block, `${tier}ティアに v_crystal_chance が無い`)
    assert.equal(Number(block[1]), chance, `${tier}ティアの確率が違う`)
  }
  const dBlock = claimFn.match(/v_tier := 'D';[\s\S]*?v_crystal_chance := ([0-9.]+);/)
  assert.equal(Number(dBlock[1]), 0, 'Dティアに強者の結晶が出てしまう')
})

test('SQL: 強者の結晶は実在アイテムとして付与され、結果にも返る', () => {
  assert.ok(/random\(\) < v_crystal_chance/.test(claimFn), '確率抽選をしていない')
  // アイテムが見つからないのに got_crystal=true になると「もらった表示だけ出て無い」事故になる
  assert.ok(/SELECT id INTO v_crystal_item_id FROM items WHERE name = '強者の結晶'[\s\S]*?v_got_crystal := true;/.test(claimFn),
    'アイテムIDの取得より前に got_crystal を立てている')
  assert.ok(/'got_crystal',\s+v_got_crystal/.test(claimFn), '戻り値に got_crystal が無い')
  assert.ok(/INSERT INTO items[\s\S]*?'強者の結晶'/.test(sql), 'アイテム定義の冪等INSERTが無い')
})

test('クライアント: 強者の結晶の表示と確率表記がSQLと一致している', () => {
  assert.ok(/reward\.got_crystal/.test(jsx), 'リワード画面に強者の結晶が出ない')
  assert.ok(/data\.got_crystal/.test(jsx), '未受取レイドの受取結果に強者の結晶が出ない')
  const info = jsx.match(/const TIER_INFO = \[[\s\S]*?\n\]/)[0]
  const rows = [...info.matchAll(/tier: '([ABCD])'[\s\S]*?crystalChance: (?:'(\d+)%'|null)/g)]
  const got = Object.fromEntries(rows.map(m => [m[1], m[2] ? Number(m[2]) / 100 : 0]))
  assert.deepEqual(got, { ...CRYSTAL, D: 0 }, 'TIER_INFO の crystalChance が SQL とズレている')
})

test('claim_raid_rewards: 昼枠の上位3名報酬なしを引き継いでいる', () => {
  // 再定義のたびに落ちる（＝昼枠にも順位報酬が出る）リグレッションの再発防止
  assert.ok(/IF COALESCE\(v_boss\.slot, 21\) IN \(21, 22\) AND v_participant\.damage_dealt > 0 THEN/.test(claimFn),
    '昼枠限定の分岐が消えている')
})
