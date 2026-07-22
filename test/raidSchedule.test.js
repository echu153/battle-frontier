import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const daySql = readFileSync(join(repoRoot, 'supabase_raid_day_20260717.sql'), 'utf8')

// ============================================================
// 出現スケジュールは SQL（supabase_raid_day_20260717.sql）が唯一の実装で、クライアントは
// spawn_raid_boss_if_needed の 'schedule' を表示するだけ。ここでは SQL のアルゴリズムを
// BigInt で忠実に写して「仕様どおりか・偏っていないか」を確かめる。
//   ※ Postgres の bigint と同じ整数演算にするため BigInt を使う（Number では 2^53 を超えて壊れる）。
// ============================================================
const LATEST = '閻魔'
const NIGHT21 = ['閻魔', '雨摩座', '閻魔']
const NIGHT22 = ['黒龍ヴァルゼノク', '閻魔', '雷鋼機神ゼルギアス']
const ALL_BOSS = ['黒龍ヴァルゼノク', '雨摩座', '雷鋼機神ゼルギアス', '閻魔']

// raid_rand(p_d, p_salt) の写し
const raidRand = (d, salt) => {
  const M = 2147483648n
  let h = ((BigInt(d) * 2654435761n + BigInt(salt) * 40503n + 2166136261n) % M + M) % M
  h = h ^ (h >> 15n)
  h = (h * 2246822519n) % M
  h = h ^ (h >> 13n)
  h = (h * 668265263n) % M
  h = h ^ (h >> 16n)
  return h
}
const setIdx = (d) => ((d % 3) + 3) % 3
const raidDaySlot = (d) => 12 + Number(raidRand(d, 0) % 6n)
const nightPair = (d) => [NIGHT21[setIdx(d)], NIGHT22[setIdx(d)]]
const dayCandidates = (d) => {
  const [n21, n22] = nightPair(d)
  return ALL_BOSS.filter(b => b !== LATEST && b !== n21 && b !== n22)
}
const dayBoss = (d) => {
  const cand = dayCandidates(d)
  return cand[Number(raidRand(d, 1) % BigInt(cand.length))]
}

test('SQL の定数がテストの写しと一致している（片方だけ直した場合に気付く）', () => {
  const fn = daySql.match(/CREATE OR REPLACE FUNCTION raid_rand[\s\S]*?END \$\$;/)[0]
  for (const c of ['2654435761', '40503', '2166136261', '2147483648', '2246822519', '668265263', '15', '13', '16']) {
    assert.ok(fn.includes(c), `raid_rand に定数 ${c} が無い（テストの写しと食い違っている）`)
  }
  const bf = daySql.match(/CREATE OR REPLACE FUNCTION raid_boss_for_slot[\s\S]*?END \$\$;/)[0]
  assert.ok(bf.includes("night21  text[] := ARRAY['閻魔', '雨摩座', '閻魔']"), '夜21時のセットがテストの写しと違う')
  assert.ok(bf.includes("night22  text[] := ARRAY['黒龍ヴァルゼノク', '閻魔', '雷鋼機神ゼルギアス']"), '夜22時のセットがテストの写しと違う')
  assert.ok(daySql.includes("SELECT '閻魔'::text"), 'raid_latest_boss が閻魔でない')
  assert.ok(daySql.match(/CREATE OR REPLACE FUNCTION raid_day_slot[\s\S]*?12 \+ \(raid_rand\(p_date - DATE '2000-01-01', 0\) % 6\)/), '昼枠の時刻の式がテストの写しと違う')
})

test('夜: 指定どおりのセットローテ（3日周期）', () => {
  assert.deepEqual(nightPair(0), ['閻魔', '黒龍ヴァルゼノク'])
  assert.deepEqual(nightPair(1), ['雨摩座', '閻魔'])
  assert.deepEqual(nightPair(2), ['閻魔', '雷鋼機神ゼルギアス'])
  assert.deepEqual(nightPair(3), ['閻魔', '黒龍ヴァルゼノク'])  // 3日で1周
})

test('夜: どのセットにも最新ボスが必ず1体だけ入る（＝夜の出現の1/2が最新）', () => {
  let enma = 0, total = 0
  for (let d = 0; d < 90; d++) {
    const pair = nightPair(d)
    assert.equal(pair.filter(n => n === LATEST).length, 1, `d=${d} の夜: ${pair.join(' / ')}`)
    enma += 1; total += 2
  }
  assert.equal(enma / total, 0.5)
})

test('昼: 最新ボスとその日の夜に出る2体は出ない（ユーザー指定の例と一致）', () => {
  // 例: 夜が 閻魔＋ヴァルゼノク の日 → 昼は 雨摩座 か ゼルギアス
  assert.deepEqual(dayCandidates(0), ['雨摩座', '雷鋼機神ゼルギアス'])
  assert.deepEqual(dayCandidates(1), ['黒龍ヴァルゼノク', '雷鋼機神ゼルギアス'])
  assert.deepEqual(dayCandidates(2), ['黒龍ヴァルゼノク', '雨摩座'])
  for (let d = 0; d < 120; d++) {
    const boss = dayBoss(d)
    const [n21, n22] = nightPair(d)
    assert.notEqual(boss, LATEST, `d=${d}: 昼に最新ボスが出ている`)
    assert.ok(boss !== n21 && boss !== n22, `d=${d}: 昼(${boss})がその日の夜(${n21}/${n22})と重複`)
  }
})

test('昼: 時刻は12〜17時の範囲で、特定の時刻に偏らない', () => {
  const counts = {}
  const DAYS = 600
  for (let d = 0; d < DAYS; d++) {
    const h = raidDaySlot(d)
    assert.ok(h >= 12 && h <= 17, `d=${d}: 昼枠が ${h} 時`)
    counts[h] = (counts[h] || 0) + 1
  }
  assert.equal(Object.keys(counts).length, 6, `12〜17時が全て使われていない: ${JSON.stringify(counts)}`)
  // 均等なら各100回。偏りが酷い（半分未満/2倍超）なら撹拌が壊れている
  for (const h of [12, 13, 14, 15, 16, 17]) {
    assert.ok(counts[h] > DAYS / 6 / 2 && counts[h] < (DAYS / 6) * 2, `${h}時に偏っている: ${JSON.stringify(counts)}`)
  }
})

test('昼: 連続する日で時刻が規則的に動かない（線形合同のままだと等間隔になる）', () => {
  const diffs = new Set()
  for (let d = 0; d < 60; d++) diffs.add(raidDaySlot(d + 1) - raidDaySlot(d))
  assert.ok(diffs.size > 3, `翌日との時刻差が単調: ${[...diffs].join(',')}`)
})

test('昼: 2つの候補の両方が選ばれる（片方に固定されない）', () => {
  for (const s of [0, 1, 2]) {
    const picked = new Set()
    for (let d = s; d < 600; d += 3) picked.add(dayBoss(d))
    assert.equal(picked.size, 2, `セット${s}の昼が ${[...picked].join(',')} に固定されている`)
  }
})

test('昼枠のHPは400万・夜は700万', () => {
  // ※昼のHPは 200万→300万→400万 と再調整済み（80f7d11）。数値を変えたらここも更新すること。
  const fn = daySql.match(/CREATE OR REPLACE FUNCTION raid_slot_hp[\s\S]*?\$\$;/)[0]
  assert.ok(fn.includes('7000000') && fn.includes('4000000'), 'raid_slot_hp のHPが想定と違う')
  assert.ok(fn.includes('p_slot IN (21, 22)'), '夜/昼の判定が slot ではない')
})

test('昼枠は与ダメージ上位3名の追加報酬が付かない', () => {
  const fn = daySql.match(/CREATE OR REPLACE FUNCTION claim_raid_rewards[\s\S]*?\$\$;/)[0]
  assert.ok(/IF COALESCE\(v_boss\.slot, 21\) IN \(21, 22\) AND v_participant\.damage_dealt > 0 THEN/.test(fn),
    '上位3名報酬が夜枠に限定されていない（昼にも順位報酬が出てしまう）')
})

test('クライアントは出現予定を自前計算せず、サーバーの schedule を表示する', () => {
  const jsx = readFileSync(join(repoRoot, 'src/pages/RaidBoss.jsx'), 'utf8')
  assert.ok(jsx.includes("setSchedule(Array.isArray(data.schedule) ? data.schedule : null)"),
    'RaidBoss.jsx がサーバーの schedule を受け取っていない')
  assert.ok(!/raidBossForSlot|RAID_BOSS_CYCLE/.test(jsx),
    'RaidBoss.jsx が出現ボスを自前計算している（サーバーとズレて予告と実出現が食い違う）')
  const sched = readFileSync(join(repoRoot, 'src/lib/raidSchedule.js'), 'utf8')
  assert.ok(!/raidBossForSlot|raidDaySlot/.test(sched), 'raidSchedule.js に出現算出が復活している')
})

test('通知: 夜/昼で購読を分けられる', () => {
  assert.ok(daySql.includes('notify_night') && daySql.includes('notify_day'), 'push_subscriptions に夜/昼の列が無い')
  const edge = readFileSync(join(repoRoot, 'supabase/functions/send-raid-push/index.ts'), 'utf8')
  assert.ok(edge.includes("kind === 'day' ? 'notify_day' : 'notify_night'"), 'Edge が kind で購読を絞っていない')
  const cron = readFileSync(join(repoRoot, 'supabase_raid_push_cron_20260717.sql'), 'utf8')
  assert.ok(cron.includes('"kind":"night"') && cron.includes('"kind":"day"'), 'cron が kind を送っていない')
  assert.ok(cron.includes('raid_day_slot((now() at time zone \'Asia/Tokyo\')::date) = %s'), '昼cronが当日の昼枠に限定していない')
})
