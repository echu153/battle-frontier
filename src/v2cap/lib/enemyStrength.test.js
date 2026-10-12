// 「レベルキャップあり」版（v2cap）の敵の強さ — 強化の見込み・エリアの境目・ボスの並び・朝昼晩の敵（node --test）
// ★2026-10-13 ユーザー指示（areas.js の「装備の強化の見込み」「エリアの境目とボスの並び」・敵のLV）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SPOTS, AREA_LIST, spotOf, spotLabel, enemyLvOf, enemyPowerOf, stdPowerAt, bossRatioOf,
  ASSUMED_PLUS, assumedPlusAt, ENH_MULT, BOSS_STEP_IN, BOSS_TOP_MIN, NORMAL_RATIO, RARE_RATIO,
} from './areas.js'
import { ENEMY_LV } from './monsters.js'

const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length

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
    const now = mean(s1.roster.enemies.map(enemyPowerOf))
    const was = mean(prev.roster.enemies.map(enemyPowerOf))
    assert.ok(Math.abs(now - was) <= 1, `${spotLabel(s1)} ${now} ／ ${spotLabel(prev)} ${was}`)
    const [a, b] = s1.roster.enemies
    const lvRatio = stdPowerAt(ENEMY_LV[b.name]) / stdPowerAt(ENEMY_LV[a.name])
    assert.ok(Math.abs(enemyPowerOf(b) / enemyPowerOf(a) - lvRatio) < 0.02, `${spotLabel(s1)}：2体の比はLVのまま`)
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
  const p = (id) => enemyPowerOf(spotOf(id).roster.boss)
  // 始まりの森：①-①は戦闘力135で固定・②③は AREA_BOSS×SUB_BOSS（見込みは+0＝倍率1）
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

test('ふつう・レアの敵には、そのエリアの見込みの倍率が乗る（〇-①の2体は前の③にそろえるので除く）', () => {
  for (let k = 0; k < AREA_LIST.length; k++) {
    const s3 = spotOf(k * 3 + 3)
    for (const e of s3.roster.enemies) {
      assert.equal(enemyPowerOf(e), Math.max(1, Math.round(stdPowerAt(ENEMY_LV[e.name]) * NORMAL_RATIO * ENH_MULT[k])), `${spotLabel(s3)}の${e.name}`)
    }
    for (const e of s3.roster.rares) {
      assert.equal(enemyPowerOf(e), Math.max(1, Math.round(stdPowerAt(ENEMY_LV[e.name]) * RARE_RATIO * ENH_MULT[k])), `${spotLabel(s3)}の${e.name}`)
    }
  }
})
