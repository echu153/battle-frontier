// 星霜百層塔のデータと数式の回帰テスト（node --test で動く純粋な部分だけ）
//  ・戦闘エンジン(towerBattle.js)は pages/Game.jsx を読むため node --test では動かない。
//    エンジンの総合テストは scratchpad の _towerTest.mjs（esbuildでバンドルして実行）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TOWER_FLOORS, getFloor, MAX_IMPLEMENTED_FLOOR, BOSS_RUN_STAGES,
  towerTarget, sortiesToMidBoss, towerExpToNext, towerLevelFromExp, TOWER_EXP_PER_SORTIE,
  TREE_NODES, TREE_MAX_STEPS, maxStepsAt, nextUnlock, treeBonus, treeSpent, treeResetCost,
  isMonumentFloor, MID_BOSS_RATE, towerSortieGold, towerBossGold, RUN_POTION_LIMIT,
  buildStageEnemies, buildSortieEnemies, towerTreeEffects, applyTreeToStats,
} from './tower.js'
import { TARGET_MODES, DEFAULT_TARGET_MODE, pickTargetMode, isTargetMode } from './loadout.js'

test('層データが揃っている', () => {
  assert.equal(TOWER_FLOORS.length, 10)
  assert.equal(MAX_IMPLEMENTED_FLOOR, 10)
  for (const f of TOWER_FLOORS) {
    assert.equal(f.enemies.length, 3, `${f.floor}層の雑魚は3種`)
    assert.equal(f.floorBoss.name, f.boss, `${f.floor}層の層主名が一致`)
    assert.ok(f.midBoss && f.floorBoss.specialMove?.name, `${f.floor}層に中ボスと大技がある`)
  }
})

test('敵のステータスとスキルに矛盾がない', () => {
  for (const f of TOWER_FLOORS) {
    for (const e of [...f.enemies, f.midBoss, f.floorBoss]) {
      assert.ok(e.hp > 0 && e.spd > 0, `${e.name} のHP/素早さが正`)
      assert.ok((e.atk || 0) > 0 || (e.matk || 0) > 0, `${e.name} に攻撃手段がある`)
      for (const s of e.skills) {
        assert.ok(['physical', 'magical', 'physical_multi', 'buff', 'debuff'].includes(s.type), `${e.name}/${s.name} の種別`)
        // 攻撃力0の敵が物理技を持つと素通りになるので弾く
        if (s.type === 'physical' || s.type === 'physical_multi') assert.ok(e.atk > 0, `${e.name} は攻撃0なのに物理技「${s.name}」を持てない`)
        if (s.type === 'magical') assert.ok(e.matk > 0, `${e.name} は特攻0なのに特殊技「${s.name}」を持てない`)
        if (s.type === 'physical_multi') assert.ok(s.hits > 1, `${s.name} の多段数`)
      }
    }
  }
})

test('層主のギミックの参照先が実在する', () => {
  for (const f of TOWER_FLOORS) {
    const b = f.floorBoss
    if (b.summon) assert.ok(f.enemies[b.summon.enemyIndex], `${f.floor}層 召喚`)
    if (b.summonLoop) assert.ok(f.enemies[b.summonLoop.enemyIndex], `${f.floor}層 定期召喚`)
    for (const es of (b.escorts || [])) assert.ok(f.enemies[es.enemyIndex], `${f.floor}層 取り巻き`)
    for (const p of (b.phases || [])) {
      if (p.summonOnEnter) assert.ok(f.enemies[p.summonOnEnter.enemyIndex], `${f.floor}層 段階召喚`)
    }
    if (b.phases) {
      const a = b.phases.map(p => p.above)
      // 「条件を満たす最も深い段階」を選ぶ実装なので、above は降順でなければならない
      assert.ok(a.every((v, i) => i === 0 || v < a[i - 1]), `${f.floor}層 phases.above が降順`)
    }
  }
})

test('層が進むほど層主が強い', () => {
  for (let i = 1; i < TOWER_FLOORS.length; i++) {
    const cur = TOWER_FLOORS[i].floorBoss, prev = TOWER_FLOORS[i - 1].floorBoss
    assert.ok(cur.hp > prev.hp, `${i + 1}層のHP`)
    assert.ok(cur.def >= prev.def && cur.mdef >= prev.mdef, `${i + 1}層の防御`)
  }
})

test('内部推奨力と必要出撃数', () => {
  assert.equal(towerTarget(1), 20000)
  assert.equal(towerTarget(10), Math.round(20000 * Math.pow(1.2, 9)))
  assert.equal(sortiesToMidBoss(1), 40)
  assert.equal(sortiesToMidBoss(10), 130)
  assert.equal(MID_BOSS_RATE, 0.05)
  assert.equal(TOWER_EXP_PER_SORTIE, 100)
})

test('塔LVと累計EXPが往復する', () => {
  for (const lv of [1, 2, 10, 50, 100, 200]) {
    let total = 0
    for (let i = 1; i < lv; i++) total += towerExpToNext(i)
    assert.deepEqual(towerLevelFromExp(total).lv, lv)
    assert.equal(towerLevelFromExp(total).rest, 0)
    // 次のLVに必要な量の直前では繰り上がらない
    assert.equal(towerLevelFromExp(total + towerExpToNext(lv) - 1).lv, lv)
  }
  assert.equal(towerLevelFromExp(0).lv, 1)
  assert.equal(towerLevelFromExp(-100).lv, 1)
})

test('ツリーの段数解放', () => {
  assert.equal(maxStepsAt(1), 10)
  assert.equal(maxStepsAt(49), 10)
  assert.equal(maxStepsAt(50), 20)
  assert.equal(maxStepsAt(100), 30)
  assert.equal(maxStepsAt(150), 40)
  assert.equal(maxStepsAt(200), 50)
  assert.equal(maxStepsAt(9999), TREE_MAX_STEPS)
  assert.equal(nextUnlock(200), null)
  assert.equal(nextUnlock(1).lv, 50)
})

test('ツリーの振り分けが壊れた値でも数値のまま', () => {
  assert.equal(TREE_NODES.length, 17)
  assert.equal(new Set(TREE_NODES.map(n => n.key)).size, 17)
  assert.equal(treeSpent({ max_hp: 50, spd: 50 }), 100)
  assert.equal(treeSpent({ max_hp: 999 }), TREE_MAX_STEPS, '上限でクランプ')
  assert.equal(treeSpent({}), 0)
  assert.equal(treeSpent(null), 0)
  // tree_alloc は jsonb なので数値以外が入りうる。NaN が戦闘計算まで伝播すると壊れる
  for (const junk of [{ max_hp: 'abc' }, { max_hp: null }, { max_hp: {} }, { max_hp: -5 }, { max_hp: Infinity }]) {
    const b = treeBonus(junk)
    assert.ok(Number.isFinite(b.max_hp), `treeBonus(${JSON.stringify(junk)}) が有限`)
    assert.ok(b.max_hp >= 0, '負にならない')
    const e = towerTreeEffects(junk)
    for (const k of Object.keys(e)) assert.ok(Number.isFinite(e[k]), `towerTreeEffects の ${k} が有限`)
  }
  assert.equal(treeResetCost(1), 10000)
  assert.equal(treeResetCost(50), 500000)
})

test('ツリーのフル振りが仕様どおりの倍率になる', () => {
  const full = towerTreeEffects(Object.fromEntries(TREE_NODES.map(n => [n.key, TREE_MAX_STEPS])))
  assert.ok(Math.abs(full.hpMult - 1.25) < 1e-9, '最大HP+25%')
  assert.ok(Math.abs(full.takenMult - 0.75) < 1e-9, '被ダメ-25%')
  assert.ok(full.physPen <= 0.8 && full.magPen <= 0.8, '貫通が上限0.8以内')
  const eff = applyTreeToStats({ hp_max: 10000, spd: 1000, critBonus: 0, critDmg: 0, critResist: 0, evasionBonus: 0, defPen: 0, mdefPen: 0 }, full)
  assert.equal(eff.hp_max, 12500)
  assert.equal(eff.spd, 1250)
  assert.ok(eff.defPen <= 0.8 && eff.mdefPen <= 0.8)
})

test('連戦の構成', () => {
  assert.equal(BOSS_RUN_STAGES.length, 6)
  for (let f = 1; f <= 10; f++) {
    const fd = getFloor(f)
    for (let s = 0; s < BOSS_RUN_STAGES.length; s++) {
      const es = buildStageEnemies(fd, s)
      const kind = BOSS_RUN_STAGES[s].kind
      const want = kind === 'mobs' ? BOSS_RUN_STAGES[s].count : 1
      const escorts = kind === 'boss' ? (fd.floorBoss.escorts || []).reduce((a, e) => a + (e.count || 1), 0) : 0
      assert.equal(es.length, want + escorts, `${f}層 ${BOSS_RUN_STAGES[s].label}`)
      assert.equal(new Set(es.map(e => e.uid)).size, es.length, 'uidが重複しない')
      for (const e of es) assert.equal(e.hp, e.maxHp, '初期HPは満タン')
    }
  }
  assert.equal(buildStageEnemies(getFloor(1), 99).length, 0, '存在しないステージ')
  assert.equal(buildStageEnemies(null, 0).length, 0, 'floorDataがnull')
})

test('塔出撃の中ボス抽選', () => {
  assert.equal(buildSortieEnemies(getFloor(1), 0).isMid, false, '確率0なら出ない')
  let mid = 0
  for (let i = 0; i < 5000; i++) if (buildSortieEnemies(getFloor(1), 0.05).isMid) mid++
  assert.ok(Math.abs(mid / 5000 - 0.05) < 0.02, `出現率がほぼ5% (実測 ${(mid / 50).toFixed(1)}%)`)
})

test('石碑は10層ごと', () => {
  assert.ok(isMonumentFloor(10) && isMonumentFloor(100))
  assert.ok(!isMonumentFloor(1) && !isMonumentFloor(9) && !isMonumentFloor(11))
})

test('対象設定', () => {
  assert.equal(TARGET_MODES.length, 4)
  assert.equal(DEFAULT_TARGET_MODE, 'top')
  assert.equal(pickTargetMode([], 'challenge'), 'top', '未設定なら初期値')
  assert.equal(pickTargetMode(null, 'challenge'), 'top', 'nullでも落ちない')
  assert.equal(pickTargetMode([{ set_type: 'challenge', target_mode: 'hp_low' }], 'challenge'), 'hp_low')
  assert.equal(pickTargetMode([{ set_type: 'sortie', target_mode: 'hp_low' }], 'challenge'), 'top', '別セットは混ざらない')
  assert.equal(pickTargetMode([{ set_type: 'challenge', target_mode: '不正な値' }], 'challenge'), 'top', '不正値は初期値へ')
  assert.ok(isTargetMode('random') && !isTargetMode('xxx'))
})

test('Goldはサーバーが決める（クライアント申告を受け取らない）', async () => {
  const fs = await import('node:fs')
  const sql = fs.readFileSync('supabase_tower.sql', 'utf8')
  // 額は層と初回かどうかだけで決まるので、サーバー側で計算する
  assert.ok(sql.includes('GREATEST(0, p_floor) * 300'), '出撃Goldが層数×300でSQLにある')
  assert.ok(sql.includes('GREATEST(0, p_floor) * 1000000'), '層主の初回Goldが層数×100万でSQLにある')
  assert.ok(sql.includes('v_gold := tower_sortie_gold(p_floor)'), '出撃はサーバー計算')
  assert.ok(sql.includes('v_gold := tower_boss_gold(p_floor, v_new)'), '層主はサーバー計算（初回判定込み）')
  // v_gold を p_gold から作っていない＝クライアント申告を使っていない
  assert.ok(!sql.includes('v_gold := COALESCE(p_gold'), 'クライアント申告のGoldを使っていない')
  // 通常EXPも街の出撃と同じ量をサーバーが決める（雑魚8〜11/ボス13、10秒モードは5〜6/7）
  assert.ok(sql.includes('v_exp  := tower_battle_exp(v_pid'), 'EXPもサーバー計算')
  assert.ok(!sql.includes('LEAST(GREATEST(COALESCE(p_exp'), 'クライアント申告のEXPを使っていない')
  assert.ok(sql.includes('8 + floor(random() * 4)::int'), '雑魚EXPが街と同じ8〜11')
  assert.ok(sql.includes('WHEN v_ten THEN 7 ELSE 13 END'), 'ボスEXPが街と同じ13(10秒は7)')
  assert.ok(!/20000000/.test(sql), '緩すぎる上限(2000万)が残っていない')
})

test('出撃Goldと無限ポーションの上限（2026-08-03確定）', () => {
  assert.equal(towerSortieGold(1), 300)
  assert.equal(towerSortieGold(10), 3000)
  assert.equal(towerSortieGold(100), 30000)
  // 層主は初回だけ層数×100万、2回目以降は出撃と同額
  assert.equal(towerBossGold(1, true), 1000000)
  assert.equal(towerBossGold(10, true), 10000000)
  assert.equal(towerBossGold(1, false), 300)
  assert.equal(towerBossGold(10, false), 3000)
  // int4(約21億)を超えないこと。100層でも1億なので余裕がある
  assert.ok(towerBossGold(100, true) < 2147483647, '100層でもint4に収まる')
  assert.equal(RUN_POTION_LIMIT, 2)
})

test('深層のHPを見越して保存はbigintでなければならない', () => {
  // 10層時点では int4 に収まるが、1.2倍複利で伸ばすと100層で確実に溢れる。
  // SQL側の run_hp / tower_exp が bigint であることの根拠。
  const at10 = Math.max(...TOWER_FLOORS.map(f => f.floorBoss.hp))
  assert.ok(at10 < 2147483647, '10層時点は int4 に収まる')
  assert.ok(520000 * Math.pow(1.2, 90) > 2147483647, '100層想定は int4 を超える')
})
