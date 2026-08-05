// エンドレスタワーのデータと数式の回帰テスト（node --test で動く純粋な部分だけ）
//  ・戦闘エンジン(towerBattle.js)は pages/Game.jsx を読むため node --test では動かない。
//    エンジンの総合テストは scratchpad の _towerTest.mjs（esbuildでバンドルして実行）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TOWER_FLOORS, getFloor, MAX_IMPLEMENTED_FLOOR, BOSS_RUN_STAGES,
  towerTarget, sortiesToMidBoss, towerExpToNext, towerLevelFromExp, TOWER_EXP_MIN, TOWER_EXP_MAX, BOSS_FIRST_TOWER_EXP,
  TREE_NODES, TREE_MAX_STEPS, TREE_STEP_PCT, stepPctOf, maxStepsAt, nextUnlock, treeBonus, treeSpent, treeResetCost,
  isMonumentFloor, MID_BOSS_RATE, towerSortieGold, towerBossGold, RUN_POTION_LIMIT, MAX_END_LEVEL,
  isTowerUnlocked, TOWER_UNLOCK_CHAR_LV, OPEN_MAX_FLOOR,
  FLOOR_POWER, FLOOR_POWER_STEP, floorPowerOf,
  buildStageEnemies, buildSortieEnemies, towerTreeEffects, applyTreeToStats,
} from './tower.js'
import { TARGET_MODES, DEFAULT_TARGET_MODE, pickTargetMode, isTargetMode } from './loadout.js'

test('層データが揃っている', () => {
  assert.equal(TOWER_FLOORS.length, 10)
  assert.equal(MAX_IMPLEMENTED_FLOOR, 10)
  for (const f of TOWER_FLOORS) {
    assert.equal(f.enemies.length, 3, `${f.floor}層の雑魚は3種`)
    assert.equal(f.floorBoss.name, f.boss, `${f.floor}層のエリアボス名が一致`)
    assert.ok(f.midBoss && f.floorBoss.specialMove?.name, `${f.floor}層に強敵と大技がある`)
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

test('エリアボスのギミックの参照先が実在する', () => {
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

test('層が進むほどエリアボスが強い', () => {
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
  assert.equal(TOWER_EXP_MIN, 20)
  assert.equal(TOWER_EXP_MAX, 30)
  assert.equal(BOSS_FIRST_TOWER_EXP, 1000)
})

test('エンドレベルと累計EXPが往復する', () => {
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

test('ツリーの段数解放（2026-08-03: 上限を500へ広げた）', () => {
  assert.equal(maxStepsAt(1), 10)
  assert.equal(maxStepsAt(49), 10)
  assert.equal(maxStepsAt(50), 20)
  assert.equal(maxStepsAt(100), 30)
  assert.equal(maxStepsAt(199), 30)
  assert.equal(maxStepsAt(200), 40)
  assert.equal(maxStepsAt(349), 40)
  assert.equal(maxStepsAt(350), 50)
  assert.equal(maxStepsAt(500), TREE_MAX_STEPS)
  assert.equal(nextUnlock(350), null)
  assert.equal(nextUnlock(1).lv, 50)
})

test('エンドレベルの上限は850（全ノードを埋め切れる値）', async () => {
  // 17ノード × 50段 = 850。上限まで行けば全部埋まる
  assert.equal(MAX_END_LEVEL, 850)
  assert.equal(MAX_END_LEVEL, TREE_NODES.length * TREE_MAX_STEPS, 'ノード数×最大段数と一致')
  const full = Object.fromEntries(TREE_NODES.map(n => [n.key, TREE_MAX_STEPS]))
  assert.equal(treeSpent(full), MAX_END_LEVEL, '全ノードフル振りに必要なポイント＝上限')
  // 上限に達したらEXPをいくら積んでも上がらない
  assert.equal(towerLevelFromExp(999999999).lv, MAX_END_LEVEL, '上限で頭打ち')
  // SQL側の打ち止めと一致していること
  const fs = await import('node:fs')
  const sql = fs.readFileSync('supabase_tower.sql', 'utf8')
  assert.ok(sql.includes('WHILE v_lv < 850'), 'SQLの打ち止めも850')
  assert.ok(sql.includes('WHEN p_lv >= 350 THEN 50'), 'SQLの段数解放も350で50段')
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

test('1段あたりの効果（既定0.5%・一部1%）', () => {
  // 2026-08-03: 会心威力+/最大HP+/会心耐性+ だけ1段=1%
  const oneP = ['crit_dmg', 'max_hp', 'crit_resist']
  for (const n of TREE_NODES) {
    const want = oneP.includes(n.key) ? 1.0 : TREE_STEP_PCT
    assert.equal(stepPctOf(n.key), want, `${n.key} の1段あたり`)
    assert.equal(treeBonus({ [n.key]: 10 })[n.key], want * 10, `${n.key} を10段振ったとき`)
  }
})

test('ツリーのフル振りが仕様どおりの倍率になる', () => {
  const full = towerTreeEffects(Object.fromEntries(TREE_NODES.map(n => [n.key, TREE_MAX_STEPS])))
  assert.ok(Math.abs(full.hpMult - 1.50) < 1e-9, '最大HPは1段1%なのでフル振りで+50%')
  assert.ok(Math.abs(full.takenMult - 0.75) < 1e-9, '被ダメ-25%')
  assert.ok(full.physPen <= 0.8 && full.magPen <= 0.8, '貫通が上限0.8以内')
  const eff = applyTreeToStats({ hp_max: 10000, spd: 1000, critBonus: 0, critDmg: 0, critResist: 0, evasionBonus: 0, defPen: 0, mdefPen: 0 }, full)
  assert.equal(eff.hp_max, 15000)
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

test('出撃の強敵抽選', () => {
  assert.equal(buildSortieEnemies(getFloor(1), 0).isMid, false, '確率0なら出ない')
  let mid = 0
  for (let i = 0; i < 5000; i++) if (buildSortieEnemies(getFloor(1), 0.05).isMid) mid++
  assert.ok(Math.abs(mid / 5000 - 0.05) < 0.02, `出現率がほぼ5% (実測 ${(mid / 50).toFixed(1)}%)`)
})

test('石碑は10層から。それ以降は1層ごと（9層までは刻まれない）', () => {
  assert.ok(!isMonumentFloor(1) && !isMonumentFloor(9))
  assert.ok(isMonumentFloor(10) && isMonumentFloor(11) && isMonumentFloor(100))
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

test('EXP曲線がクライアントとSQLで一致している', async () => {
  // 一度ここがズレて「クライアントは50×LV / SQLは5×LV²」の状態になった。
  // 表示と実際の繰り上がりが食い違うので必ず突き合わせる。
  const fs = await import('node:fs')
  const sql = fs.readFileSync('supabase_tower.sql', 'utf8')
  // 「SELECT (…)」の中身だけ取り出して、クライアント側の式と値を突き合わせる
  const head = sql.indexOf('CREATE OR REPLACE FUNCTION tower_exp_to_next')
  assert.ok(head >= 0, 'SQLに tower_exp_to_next がある')
  const line = sql.slice(head, sql.indexOf(';', head))
  // 「SELECT 〜 $$」の間をまるごと取る（LEAST(...) のように括弧が入れ子でも切れないように）
  const m = line.match(/SELECT\s+([\s\S]*?)\s*\$\$/)
  assert.ok(m, 'SQLの tower_exp_to_next の式が読めた')
  // SQLの式をそのままJSで評価できる形に直す（LEAST/GREATEST は Math.min/max に）
  const sqlExpr = m[1].replace(/::bigint/g, '').replace(/LEAST/g, 'Math.min').replace(/GREATEST/g, 'Math.max')
  for (const lv of [1, 5, 50, 200, 350, 399, 400, 401, 500, 849]) {
    // eslint-disable-next-line no-new-func
    const sqlVal = Function('p_lv', `return ${sqlExpr}`)(lv)
    assert.equal(sqlVal, towerExpToNext(lv), `LV${lv} の必要EXPが一致`)
  }
})

test('Goldはサーバーが決める（クライアント申告を受け取らない）', async () => {
  const fs = await import('node:fs')
  const sql = fs.readFileSync('supabase_tower.sql', 'utf8')
  // 額は層と初回かどうかだけで決まるので、サーバー側で計算する
  assert.ok(sql.includes('GREATEST(0, p_floor) * 300'), '出撃Goldがエリア数×300でSQLにある')
  assert.ok(sql.includes('GREATEST(0, p_floor) * 1000000'), 'エリアボスの初回Goldがエリア数×100万でSQLにある')
  assert.ok(sql.includes('v_gold := tower_sortie_gold(p_floor)'), '出撃はサーバー計算')
  assert.ok(sql.includes('v_gold := tower_boss_gold(p_floor, v_new)'), 'エリアボスはサーバー計算（初回判定込み）')
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
  // エリアボスは初回だけエリア数×100万、2回目以降は出撃と同額
  assert.equal(towerBossGold(1, true), 1000000)
  assert.equal(towerBossGold(10, true), 10000000)
  assert.equal(towerBossGold(1, false), 300)
  assert.equal(towerBossGold(10, false), 3000)
  // int4(約21億)を超えないこと。戦闘エリア100でも1億なので余裕がある
  assert.ok(towerBossGold(100, true) < 2147483647, '戦闘エリア100でもint4に収まる')
  assert.equal(RUN_POTION_LIMIT, 2)
})

test('深いエリアのHPを見越して保存はbigintでなければならない', () => {
  // 戦闘エリア10時点では int4 に収まるが、1.2倍複利で伸ばすと戦闘エリア100で確実に溢れる。
  // SQL側の run_hp / tower_exp が bigint であることの根拠。
  const at10 = Math.max(...TOWER_FLOORS.map(f => f.floorBoss.hp))
  assert.ok(at10 < 2147483647, '戦闘エリア10時点は int4 に収まる')
  assert.ok(520000 * Math.pow(1.2, 90) > 2147483647, '戦闘エリア100想定は int4 を超える')
})

// ============================================================
// 公開前の穴埋め（2026-08-04）が SQL に入っているかの回帰テスト
// クライアントとSQLで規則がズレたらここで落ちる
// ============================================================
import { readFileSync } from 'node:fs'
const towerSql = readFileSync(new URL('../../supabase_tower.sql', import.meta.url), 'utf8')

test('SQL: 内部ヘルパを PUBLIC から剥がしている（EXP/LVを任意に取れる穴を塞ぐ）', () => {
  // ※ DOブロックの中の anon/authenticated 向け REVOKE と取り違えないよう、
  //   「FROM PUBLIC;」で終わる行そのものを見る
  const revoked = new Set(
    [...towerSql.matchAll(/^REVOKE ALL ON FUNCTION public\.([a-z_]+)\(.*\)\s+FROM PUBLIC;$/gm)].map(m => m[1])
  )
  for (const fn of ['tower_grant_rewards', 'tower_idle_block', 'tower_battle_exp', 'tower_hp_cap', 'tower_mp_cap']) {
    assert.ok(revoked.has(fn), `${fn} を PUBLIC から REVOKE していない`)
  }
  // REVOKE を流し忘れても穴が開かないよう、関数の中でも本人確認する
  assert.match(towerSql, /p_uid IS DISTINCT FROM auth\.uid\(\)/)
})

test('SQL: 連戦のステージは1つずつしか進められない（6連戦の飛ばしを塞ぐ）', () => {
  assert.match(towerSql, /p_stage IS DISTINCT FROM v_tp\.run_stage \+ 1/)
})

test('SQL: エリアボス撃破は連戦を条件付きUPDATEで取り切ってから報酬を配る（二重取得を塞ぐ）', () => {
  const i = towerSql.indexOf('FUNCTION tower_boss_clear')
  const body = towerSql.slice(i, towerSql.indexOf('END; $$;', i))
  assert.ok(body.indexOf('AND run_stage >= 5') > 0, '連戦の取り切り条件が無い')
  assert.ok(body.indexOf('run_floor = NULL') < body.indexOf('tower_grant_rewards'), '報酬より先に連戦を消していない')
})

test('SQL: 出撃のクールダウンをサーバーが確保する', () => {
  const i = towerSql.indexOf('FUNCTION tower_sortie_result')
  const body = towerSql.slice(i, towerSql.indexOf('END; $$;', i))
  assert.ok(body.includes('last_action_at <= now() - make_interval'), 'サーバー側CDが無い')
  assert.ok(body.includes('連戦中は出撃できません'), '連戦中の出撃を塞いでいない')
})

test('SQL: 連戦のHP/MPはサーバーで上限クランプする', () => {
  assert.ok((towerSql.match(/tower_hp_cap\(v_pid\)/g) || []).length >= 2, 'run_start/run_save の両方でクランプしていない')
})

test('SQL: 戦争中はタワーに入れない', () => {
  assert.ok(towerSql.includes('⚔ 戦争中はタワーに入れません。'))
})

test('SQL: 石碑は退会しても消えない（外部キーCASCADEを外している）', () => {
  assert.ok(towerSql.includes('DROP CONSTRAINT IF EXISTS tower_first_clear_player_id_fkey'))
  assert.ok(!/player_id   uuid NOT NULL REFERENCES profiles\(id\) ON DELETE CASCADE,\n  username/.test(towerSql))
})

test('SQL: 中断した連戦は失敗として畳む（敗北の取り消しを塞ぐ）', () => {
  assert.match(towerSql, /run_pending boolean NOT NULL DEFAULT false/)
  assert.ok(towerSql.includes('FUNCTION tower_run_begin'))
  const i = towerSql.indexOf('FUNCTION get_tower_status')
  const body = towerSql.slice(i, towerSql.indexOf('END; $$;', i))
  assert.ok(body.includes('COALESCE(v_tp.run_pending, false)'), '状況取得で中断を畳んでいない')
})

test('SQL: エリアボス撃破が監査ログに残る', () => {
  assert.ok(towerSql.includes('CREATE TABLE IF NOT EXISTS tower_logs'))
  assert.ok(towerSql.includes("tower_log(v_pid, 'boss_clear'"))
})

test('解放条件がクライアントとSQLで一致している（一般公開 2026-08-04）', () => {
  const m = towerSql.match(/char_lv, 1\) >= (\d+)/)
  assert.ok(m, 'SQLの tower_can_enter に char_lv の条件がある')
  assert.equal(Number(m[1]), TOWER_UNLOCK_CHAR_LV, 'クライアントとSQLで解放LVが一致')
  assert.equal(isTowerUnlocked({ char_lv: TOWER_UNLOCK_CHAR_LV - 1 }), false)
  assert.equal(isTowerUnlocked({ char_lv: TOWER_UNLOCK_CHAR_LV }), true)
  assert.equal(isTowerUnlocked({ is_admin: true, char_lv: 1 }), true, '開発アカウントは常に入れる')
  assert.equal(isTowerUnlocked(null), false)
  // 開発限定のまま公開したつもりになる事故を防ぐ
  assert.ok(!/SELECT COALESCE\(p_profile\.is_admin, false\)\s*\$\$/.test(towerSql), 'is_admin 限定のままになっていない')
})

test('クールダウンの残り秒数はサーバーが返す（端末の時計ズレで早く0にならない）', async () => {
  const fs = await import('node:fs')
  const client = fs.readFileSync('src/pages/Tower.jsx', 'utf8')
  // サーバーが秒数で返し、クライアントはそれをそのまま使う
  assert.ok(towerSql.includes("'cd_left'"), 'SQLが残り秒数を返していない')
  assert.ok(client.includes('data.cd_left'), 'クライアントが cd_left を使っていない')
  // ⚠ここが再発ポイント: 端末の Date.now() と last_action_at を引き算してはいけない。
  //   端末の時計が数秒進んでいると「出撃可能」と誤表示され、押した先で弾かれる。
  assert.ok(!/Date\.now\(\)\s*-\s*new Date\(\s*data\.last_action_at/.test(client),
    '端末の時計とサーバーの時刻を突き合わせている')
  // 境目ちょうどの押下に猶予がある
  assert.ok(towerSql.includes("+ interval '0.5 second'"), 'クールダウン判定に猶予が無い')
})

test('狙い方の設定先とタワーが読むセットが一致している', async () => {
  const fs = await import('node:fs')
  const tower = fs.readFileSync('src/pages/Tower.jsx', 'utf8')
  const reads = (tower.match(/pickTargetMode\(targetOptions, '([a-z]+)'\)/) || [])[1]
  const links = (tower.match(/nav\('\/skills\?set=([a-z]+)'\)/) || [])[1]
  assert.ok(reads, 'タワーが読むセット種別が見つからない')
  // ⚠set を付けずに /skills へ飛ばすと「出撃」セットが開き、そこで変えても反映されない
  assert.equal(links, reads, 'スキル設定へのリンクが、タワーが読むセットを開いていない')
  assert.ok(isTargetMode('hp_low') && isTargetMode('top'), '対象設定の値')
})

test('敵の強さのつまみが有効な範囲にある', async () => {
  const { ENEMY_SKILL_POWER, ENEMY_ATK_POWER } = await import('./tower.js')
  // 事故で極端な値が入ったまま出さないための歯止め
  assert.ok(ENEMY_SKILL_POWER >= 1 && ENEMY_SKILL_POWER <= 3, `技威力のつまみ(${ENEMY_SKILL_POWER})が範囲外`)
  assert.ok(ENEMY_ATK_POWER >= 1 && ENEMY_ATK_POWER <= 2, `攻撃力のつまみ(${ENEMY_ATK_POWER})が範囲外`)
  // 実際に敵へ効いていること（つまみを上げたのに反映されない事故を防ぐ）
  const { makeEnemy, TOWER_FLOORS } = await import('./tower.js')
  const def = TOWER_FLOORS[0].floorBoss
  // 雑魚とボスでつまみが分かれているので、ボス側（isBoss）で確認する
  assert.equal(makeEnemy(def, { isBoss: true }).atk, Math.floor(def.atk * ENEMY_ATK_POWER), '攻撃力のつまみがボスに乗っていない')
  const battle = (await import('node:fs')).readFileSync('src/lib/towerBattle.js', 'utf8')
  assert.ok(battle.includes('(sk.mult || 1) * ENEMY_SKILL_POWER'), '技威力のつまみが敵スキルに乗っていない')
  assert.ok(battle.includes("(sm.mult || 2.5) * ENEMY_SKILL_POWER"), '技威力のつまみが大技に乗っていない')
})

test('雑魚と強敵/エリアボスで強さのつまみが分かれている', async () => {
  const t = await import('./tower.js')
  const { MOB_ATK_POWER, ENEMY_ATK_POWER, MOB_DMG_TAKEN, ENEMY_DMG_TAKEN, makeEnemy, TOWER_FLOORS } = t
  assert.ok(MOB_ATK_POWER >= 1 && MOB_ATK_POWER <= 4, `雑魚の火力(${MOB_ATK_POWER})が範囲外`)
  assert.ok(MOB_DMG_TAKEN > 0 && MOB_DMG_TAKEN <= 1, `雑魚の被ダメ(${MOB_DMG_TAKEN})が範囲外`)
  assert.ok(ENEMY_DMG_TAKEN > 0 && ENEMY_DMG_TAKEN <= 1, `ボスの被ダメ(${ENEMY_DMG_TAKEN})が範囲外`)
  const fd = TOWER_FLOORS[0]
  const mob = makeEnemy(fd.enemies[0])
  const boss = makeEnemy(fd.floorBoss, { isBoss: true })
  assert.equal(mob.atk, Math.floor(fd.enemies[0].atk * MOB_ATK_POWER), '雑魚に雑魚用の火力が乗っていない')
  assert.equal(boss.atk, Math.floor(fd.floorBoss.atk * ENEMY_ATK_POWER), 'ボスにボス用の火力が乗っていない')
  assert.equal(mob.dmgTaken, MOB_DMG_TAKEN)
  assert.equal(boss.dmgTaken, ENEMY_DMG_TAKEN)
  // 被ダメ倍率が戦闘エンジンで実際に使われていること
  const battle = (await import('node:fs')).readFileSync('src/lib/towerBattle.js', 'utf8')
  assert.ok(battle.includes('let m = en.dmgTaken ?? 1'), '被ダメ倍率が戦闘に反映されていない')
})

test('開発用のテスト対戦はサーバーに何も送らない', async () => {
  const fs = await import('node:fs')
  const s = fs.readFileSync('src/pages/Tower.jsx', 'utf8')
  const i = s.indexOf('const devFight = () =>')
  assert.ok(i > 0, 'テスト対戦が見つからない')
  const body = s.slice(i, s.indexOf('const abortRun', i))
  // 報酬・進行・クールダウンに一切触らないこと
  assert.ok(!/supabase\./.test(body), 'テスト対戦がサーバーを呼んでいる')
  assert.ok(s.includes('{profile?.is_admin && ('), 'テスト対戦が is_admin で閉じられていない')
})

test('公開している層がクライアントとSQLで一致している', () => {
  // データは10層ぶんあるが、調整中は途中までしか開けない。
  // 片方だけ変えると「選べるのに出撃が弾かれる」状態になるので必ず突き合わせる。
  const head = towerSql.indexOf('FUNCTION tower_max_floor()')
  const m = towerSql.slice(head, head + 200).match(/SELECT\s+(\d+)/)
  assert.ok(m, 'SQLの tower_max_floor が読めない')
  assert.equal(Number(m[1]), OPEN_MAX_FLOOR, '公開層がクライアントとSQLでズレている')
  assert.ok(OPEN_MAX_FLOOR >= 1 && OPEN_MAX_FLOOR <= MAX_IMPLEMENTED_FLOOR, '公開層が実装済みの範囲外')
})

test('層ごとの倍率は1〜4層に一切掛からない', () => {
  // 1〜4層は一般公開中。上の層を重くするときに巻き添えで難しくすると
  // 今遊んでいる人が進めなくなるので、ここは絶対に1.0のまま。
  for (const f of [1, 2, 3, 4]) assert.equal(floorPowerOf(f), 1, `${f}層に倍率が掛かっている`)
  // 5層以降は必ず1より大きく、層が上がるほど重くなる（同値も許さない）
  for (let f = 5; f <= 12; f++) {
    assert.ok(floorPowerOf(f) > 1, `${f}層の倍率が1以下`)
    assert.ok(floorPowerOf(f) > floorPowerOf(f - 1), `${f}層が前の層より重くなっていない`)
  }
  // 表の外は最後の値から一定ずつ伸びる
  const last = FLOOR_POWER[FLOOR_POWER.length - 1]
  assert.equal(floorPowerOf(FLOOR_POWER.length + 1), last + FLOOR_POWER_STEP)
})

test('層ごとの倍率は敵の攻撃力にだけ乗り、HP・防御には乗らない', async () => {
  const { makeEnemy, ENEMY_ATK_POWER } = await import('./tower.js')
  // HPや防御まで伸ばすと「削り切るターン数」が変わり、
  // 与ダメージ割合回復（血の狂気・紋章の吸収）とかみ合って体感が読めなくなる。
  const fd = getFloor(6)
  const plain = makeEnemy(fd.floorBoss, { isBoss: true })
  const scaled = makeEnemy(fd.floorBoss, { isBoss: true, floorPower: 2 })
  assert.equal(scaled.hp, plain.hp, 'HPに倍率が乗っている')
  assert.equal(scaled.def, plain.def, '防御に倍率が乗っている')
  assert.equal(scaled.mdef, plain.mdef, '特殊防御に倍率が乗っている')
  assert.equal(scaled.spd, plain.spd, '素早さに倍率が乗っている')
  assert.equal(scaled.atk, Math.floor(fd.floorBoss.atk * ENEMY_ATK_POWER * 2), '攻撃力に倍率が乗っていない')
  // 1〜4層の敵が今までと同じであること（倍率を入れる前と同じ式）
  const f1 = getFloor(1)
  assert.equal(buildStageEnemies(f1, BOSS_RUN_STAGES.length - 1)[0].atk,
    Math.floor(f1.floorBoss.atk * ENEMY_ATK_POWER), '1層のボスの攻撃力が変わっている')
})

test('層ごとの倍率が技の威力と召喚にも届いている', async () => {
  const fs = await import('node:fs')
  const battle = fs.readFileSync('src/lib/towerBattle.js', 'utf8')
  // 技の威力（通常技・大技の両方）
  assert.equal((battle.match(/ENEMY_SKILL_POWER \* floorPow/g) || []).length, 2,
    '敵の技の威力に層ごとの倍率が掛かっていない')
  // 戦闘中に湧く援軍。引き継がないと上の層で援軍だけ弱くなる
  assert.ok(battle.includes('makeEnemy(def, { floorPower: floorPow'),
    '召喚された敵に層ごとの倍率が引き継がれていない')
  // 敵が倍率を持ち歩いていること（floorData が無い開発テスト対戦でも効かせるため）
  assert.equal(buildStageEnemies(getFloor(6), 0)[0].floorPower, floorPowerOf(6))
})
