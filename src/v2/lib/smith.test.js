// バトルフロンティアⅡ 鍛冶屋「強化」の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RATES, ratesOf, ratesWithProtect, ratesFor, rollFuse, checkPick, MAT_COUNT, RESULT_UP,
} from './smith.js'
import { RANKS, PLUS_MAX } from './equipment.js'

test('確率はランクごとに合計100%（サーバーの v2_fuse と同じ数字）', () => {
  // ★ここを変えたら supabase_v2_core.sql の v2_fuse の表も直すこと。
  for (const rank of RANKS) {
    const r = RATES[rank]
    assert.ok(r, `${rank} の確率がある`)
    assert.equal(r.fail + r.ok + r.great + r.super, 100, `${rank} の合計`)
  }
})

test('★ランクが高いほど上がりにくい（失敗は増え、成功も大成功も超大成功も減る）', () => {
  for (let i = 1; i < RANKS.length; i++) {
    const lo = RATES[RANKS[i - 1]]
    const hi = RATES[RANKS[i]]
    assert.ok(hi.fail  >= lo.fail,  `${RANKS[i]} の失敗は下のランク以上`)
    assert.ok(hi.ok    <= lo.ok,    `${RANKS[i]} の成功は下のランク以下`)
    assert.ok(hi.great <= lo.great, `${RANKS[i]} の大成功は下のランク以下`)
    assert.ok(hi.super <= lo.super, `${RANKS[i]} の超大成功は下のランク以下`)
  }
  // 端はいちばん易しい／いちばん渋い
  assert.equal(RATES.F.fail, 0)
  assert.ok(RATES.S.fail > RATES.A.fail)
})

test('守りの護符：大成功と超大成功が成功に寄る（失敗率は変わらない）', () => {
  for (const rank of RANKS) {
    const raw = ratesOf(rank)
    const p = ratesWithProtect(rank)
    assert.equal(p.fail, raw.fail, `${rank} の失敗率は護符で変わらない`)
    assert.equal(p.great, 0)
    assert.equal(p.super, 0)
    assert.equal(p.ok, raw.ok + raw.great + raw.super)
    assert.equal(p.fail + p.ok, 100)
  }
  assert.deepEqual(ratesFor('S', false), RATES.S)
  assert.deepEqual(ratesFor('S', true), ratesWithProtect('S'))
})

test('抽選は確率どおりに出る', () => {
  // 端を直接指定して、どの帯に入るかを確かめる（S＝失敗33/超1/大5/成功61）
  assert.equal(rollFuse('S', false, () => 0), 'fail')
  assert.equal(rollFuse('S', false, () => 0.32), 'fail')
  assert.equal(rollFuse('S', false, () => 0.335), 'super')   // 33〜34
  assert.equal(rollFuse('S', false, () => 0.36), 'great')    // 34〜39
  assert.equal(rollFuse('S', false, () => 0.99), 'ok')
  // 護符を使うと大成功・超大成功の帯が消える
  assert.equal(rollFuse('S', true, () => 0.335), 'ok')
  assert.equal(rollFuse('S', true, () => 0.36), 'ok')
  assert.equal(rollFuse('S', true, () => 0.32), 'fail')
  // Fは失敗しない
  assert.equal(rollFuse('F', false, () => 0), 'super')
})

test('上がる強化値は 成功+1・大成功+2・超大成功+3、失敗は0', () => {
  assert.deepEqual(RESULT_UP, { fail: 0, ok: 1, great: 2, super: 3 })
})

test('選んだ組み合わせの確認', () => {
  const base = { id: 1, equip_id: 'a', plus: 0 }
  const ok2 = [{ id: 2, equip_id: 'a', plus: 0 }, { id: 3, equip_id: 'a', plus: 0 }]
  assert.equal(checkPick({ base, mats: ok2 }), '')
  assert.equal(MAT_COUNT, 2)

  assert.match(checkPick({ base: null, mats: ok2 }), /強化元/)
  assert.match(checkPick({ base, mats: [ok2[0]] }), /2個/)
  // ★強化値が違うものを混ぜられると、良い装備が素材として溶ける
  assert.match(checkPick({ base, mats: [ok2[0], { id: 4, equip_id: 'a', plus: 1 }] }), /強化値/)
  assert.match(checkPick({ base, mats: [ok2[0], { id: 4, equip_id: 'b', plus: 0 }] }), /同じ装備/)
  // 同じ個体を2回選べない
  assert.match(checkPick({ base, mats: [ok2[0], ok2[0]] }), /重ねて/)
  assert.match(checkPick({ base, mats: [base, ok2[0]] }), /重ねて/)
  // 装備中は素材にできない（強化元は残るので装備中でもよい）
  assert.match(checkPick({ base, mats: ok2, wornIds: new Set(['2']) }), /装備中/)
  assert.equal(checkPick({ base, mats: ok2, wornIds: new Set(['1']) }), '')
  // 上限
  assert.match(checkPick({ base: { ...base, plus: PLUS_MAX }, mats: ok2, plusMax: PLUS_MAX }), /上限/)
})
