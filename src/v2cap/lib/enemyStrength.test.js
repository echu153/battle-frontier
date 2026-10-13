// 「レベルキャップあり」版（v2cap）の敵の強さ — 強化の見込み・エリアの境目・ボスの並び・朝昼晩の敵（node --test）
// ★2026-10-13 ユーザー指示（areas.js の「装備の強化の見込み」「エリアの境目とボスの並び」・敵のLV）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SPOTS, AREA_LIST, spotOf, spotLabel, enemyLvOf, enemyPowerOf, enemyBasePowerOf, stdPowerAt, bossRatioOf,
  ASSUMED_PLUS, assumedPlusAt, ENH_MULT, BOSS_STEP_IN, BOSS_TOP_MIN, NORMAL_RATIO, RARE_RATIO,
  EARLY_AREAS, EARLY_NORMAL_CUT, EARLY_MID_BOSS_CUT, EARLY_BIG_BOSS_CUT,
} from './areas.js'
import { ENEMY_LV } from './monsters.js'

const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length
// ★エリアの境目・ボスの並び・見込みの倍率は「序盤の手直し（2026-10-14・エリア1〜5）の前」の強さで決まる＝ここでは base で見る。
//   手直しそのものは下の「序盤の手直し」のテスト
const base = enemyBasePowerOf

test('【確定】強化の見込み：エリア1は+0・2〜3は+3・4〜10は+6・11〜15は+10。〇-①は前のエリアの値', () => {
  assert.deepEqual(ASSUMED_PLUS, [0, 3, 3, 6, 6, 6, 6, 6, 6, 6, 10, 10, 10, 10, 10])
  for (const s of SPOTS) {
    const want = s.sub === 1 && s.area > 1 ? ASSUMED_PLUS[s.area - 2] : ASSUMED_PLUS[s.area - 1]
    assert.equal(assumedPlusAt(s.id), want, spotLabel(s))
  }
  assert.equal(assumedPlusAt(4), 0, '荒廃した草原①はエリア1と同じ+0')
  assert.equal(assumedPlusAt(5), 3, '荒廃した草原②から+3')
  assert.equal(assumedPlusAt(31), 6, '腐海の沼獄①は+6のまま')
  assert.equal(assumedPlusAt(32), 10)
})

test('強化の見込みの倍率：見込みが+0のエリアだけ1倍・ほかは1倍より大きい（測った値）', () => {
  assert.equal(ENH_MULT.length, AREA_LIST.length)
  ENH_MULT.forEach((m, k) => {
    if (ASSUMED_PLUS[k] === 0) assert.equal(m, 1, `エリア${k + 1}`)
    else assert.ok(m > 1 && m < 2, `エリア${k + 1}：${m}`)
  })
  // 同じ強化値なら、後のエリアほど装備の割合が大きい＝倍率は大きく外れない（測りのぶれで逆になっても1割まで）
  for (let k = 1; k < ENH_MULT.length; k++) {
    if (ASSUMED_PLUS[k] === ASSUMED_PLUS[k - 1]) assert.ok(Math.abs(ENH_MULT[k] / ENH_MULT[k - 1] - 1) <= 0.1, `エリア${k}→${k + 1}`)
  }
})

test('【確定】〇-①のふつうの敵は、前のエリアの③のふつうの敵の平均と同じ強さ（2体の比はLVのまま）', () => {
  for (let k = 1; k < AREA_LIST.length; k++) {
    const s1 = spotOf(k * 3 + 1)
    const prev = spotOf(k * 3)
    const now = mean(s1.roster.enemies.map(base))
    const was = mean(prev.roster.enemies.map(base))
    assert.ok(Math.abs(now - was) <= 1, `${spotLabel(s1)} ${now} ／ ${spotLabel(prev)} ${was}`)
    const [a, b] = s1.roster.enemies
    const lvRatio = stdPowerAt(ENEMY_LV[b.name]) / stdPowerAt(ENEMY_LV[a.name])
    assert.ok(Math.abs(base(b) / base(a) - lvRatio) < 0.02, `${spotLabel(s1)}：2体の比はLVのまま`)
    // いまの強さでも、エリア2〜5は両方1割下がるので同じ（エリア6の①は下げる前の5-③と同じ＝下の手直しのテスト）
    if (k < EARLY_AREAS) {
      const nowCut = mean(s1.roster.enemies.map(enemyPowerOf))
      const wasCut = mean(prev.roster.enemies.map(enemyPowerOf))
      assert.ok(Math.abs(nowCut - wasCut) <= 1, `${spotLabel(s1)}（手直しのあと） ${nowCut} ／ ${wasCut}`)
    }
  }
})

test('同じ敵は①②③のどこでも同じ強さ（朝昼晩の敵だけ場所ごと）', () => {
  const seen = new Map()
  for (const s of SPOTS) {
    for (const e of [...s.roster.enemies, ...s.roster.rares]) {
      const p = enemyPowerOf(e)
      if (seen.has(e.name)) assert.equal(p, seen.get(e.name), `${spotLabel(s)}の${e.name}`)
      seen.set(e.name, p)
    }
  }
})

test('【確定】朝昼晩の敵は、その場所のいちばん強いふつうの敵と同じLV・同じ強さ（始まりの森は LV2→11→13）', () => {
  for (const s of SPOTS) {
    const top = Math.max(...s.roster.enemies.map(enemyPowerOf))
    const topLv = Math.max(...s.roster.enemies.map(e => enemyLvOf(e.name, s.id)))
    for (const e of s.roster.timed) {
      assert.equal(enemyPowerOf(e), top, `${spotLabel(s)}の${e.name}`)
      assert.equal(enemyLvOf(e.name, s.id), topLv, `${spotLabel(s)}の${e.name}のLV`)
    }
  }
  assert.deepEqual([1, 2, 3].map(id => enemyLvOf(spotOf(id).roster.timed[0].name, id)), [2, 11, 13])
})

test('【確定】ボスの並び：〇-①は前の〇-③の1.05倍・〇-③は同じエリアの〇-①の1.01倍以上・〇-②はその間（始まりの森はいままでのまま）', () => {
  assert.equal(BOSS_STEP_IN, 1.05)
  assert.equal(BOSS_TOP_MIN, 1.01)
  const p = (id) => base(spotOf(id).roster.boss)
  // 始まりの森：①-①は戦闘力135で固定・②③は AREA_BOSS×SUB_BOSS（見込みは+0＝倍率1）。どれも序盤の手直しの前の強さ
  assert.equal(p(1), 135)
  for (const id of [2, 3]) {
    const b = spotOf(id).roster.boss
    assert.equal(p(id), Math.max(1, Math.round(stdPowerAt(enemyLvOf(b.name, id)) * bossRatioOf(id) * ENH_MULT[0])), spotLabel(id))
  }
  for (let k = 1; k < AREA_LIST.length; k++) {
    const [i1, i2, i3] = [k * 3 + 1, k * 3 + 2, k * 3 + 3]
    assert.ok(Math.abs(p(i1) - p(k * 3) * BOSS_STEP_IN) <= 1.5, `${spotLabel(i1)} ${p(i1)} ＝ 前の③ ${p(k * 3)} × ${BOSS_STEP_IN}`)
    assert.ok(p(i3) >= p(i1) * BOSS_TOP_MIN - 1.5, `${spotLabel(i3)} ${p(i3)} は① ${p(i1)} の${BOSS_TOP_MIN}倍以上`)
    assert.ok(Math.abs(p(i2) - Math.sqrt(p(i1) * p(i3))) <= 1.5, `${spotLabel(i2)} は①と③の間（掛け算のまんなか）`)
    // ③は AREA_BOSS×SUB_BOSS×見込みの倍率（下限に当たったときだけそれより強い）
    const b3 = spotOf(i3).roster.boss
    const nat = stdPowerAt(enemyLvOf(b3.name, i3)) * bossRatioOf(i3) * ENH_MULT[k]
    assert.ok(p(i3) >= Math.round(nat) - 1, `${spotLabel(i3)}：AREA_BOSS で決まる強さより弱くならない`)
  }
})

test('ふつう・レアの敵には、そのエリアの見込みの倍率が乗る（〇-①の2体は前の③にそろえるので除く・序盤の手直しの前）', () => {
  for (let k = 0; k < AREA_LIST.length; k++) {
    const s3 = spotOf(k * 3 + 3)
    for (const e of s3.roster.enemies) {
      assert.equal(base(e), Math.max(1, Math.round(stdPowerAt(ENEMY_LV[e.name]) * NORMAL_RATIO * ENH_MULT[k])), `${spotLabel(s3)}の${e.name}`)
    }
    for (const e of s3.roster.rares) {
      assert.equal(base(e), Math.max(1, Math.round(stdPowerAt(ENEMY_LV[e.name]) * RARE_RATIO * ENH_MULT[k])), `${spotLabel(s3)}の${e.name}`)
    }
  }
})

test('【確定】2026-10-14 序盤の手直し：エリア1〜5の中ボス-1割・大ボス-2割（〇-②より少し強い所で止める）・ふつうの敵-1割（①-①の敵とレアはそのまま）', () => {
  // ユーザー指示「序盤の敵の強さとボスの強さやっぱり強すぎる」「中ボスの強さ1割下げて、大ボスも2割下げて」
  //   →案から「〇-②より少し強い所で止める」「序盤だけ（エリア1〜5）」「（ふつうの敵も）1割下げる」
  assert.deepEqual([EARLY_AREAS, EARLY_NORMAL_CUT, EARLY_MID_BOSS_CUT, EARLY_BIG_BOSS_CUT], [5, 0.9, 0.9, 0.8])
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1, `${msg}：${a} ／ ${b}`)
  const firstSpot = new Set(spotOf(1).roster.enemies.map(e => e.name))
  for (const s of SPOTS) {
    const early = s.area <= EARLY_AREAS
    for (const e of s.roster.enemies) {
      const want = early && !firstSpot.has(e.name) ? base(e) * EARLY_NORMAL_CUT : base(e)
      near(enemyPowerOf(e), want, `${spotLabel(s)}の${e.name}`)
    }
    for (const e of s.roster.rares) assert.equal(enemyPowerOf(e), base(e), `${spotLabel(s)}の${e.name}（レアはそのまま）`)
    const top = Math.max(...s.roster.enemies.map(enemyPowerOf))
    for (const e of s.roster.timed) assert.equal(enemyPowerOf(e), top, `${spotLabel(s)}の${e.name}（朝昼晩＝いちばん強いふつうの敵）`)
    const b = s.roster.boss
    if (!early) assert.equal(enemyPowerOf(b), base(b), `${spotLabel(s)}のボスはそのまま`)
  }
  for (let k = 0; k < EARLY_AREAS; k++) {
    const [b1, b2, b3] = [1, 2, 3].map(sub => spotOf(k * 3 + sub).roster.boss)
    near(enemyPowerOf(b1), base(b1) * EARLY_MID_BOSS_CUT, `${spotLabel(k * 3 + 1)}のボス（中ボス）`)
    near(enemyPowerOf(b2), base(b2) * EARLY_MID_BOSS_CUT, `${spotLabel(k * 3 + 2)}のボス（中ボス）`)
    near(enemyPowerOf(b3), Math.max(base(b3) * EARLY_BIG_BOSS_CUT, base(b2) * EARLY_MID_BOSS_CUT * BOSS_TOP_MIN), `${spotLabel(k * 3 + 3)}のボス（大ボス）`)
    assert.ok(enemyPowerOf(b3) > enemyPowerOf(b2) && enemyPowerOf(b2) > enemyPowerOf(b1), `${AREA_LIST[k].name}：中ボス＜大ボス`)
  }
  // ①-①：敵（スライム・コウモリ）はそのまま・ボスは中ボスとして 135→122
  for (const e of spotOf(1).roster.enemies) assert.equal(enemyPowerOf(e), base(e), `①-①の${e.name}`)
  assert.equal(enemyPowerOf(spotOf(1).roster.boss), 122)
})
