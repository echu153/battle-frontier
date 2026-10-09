// 「レベルキャップあり」版（v2cap）の状態異常 — 火傷・封印・恐怖の敵への割り当てと、この版だけの決まり（node --test）
// ★2026-10-10 ユーザー決定。仕組みそのものの確かめは src/v2/lib/burnSealFear.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_STATS } from '../../v2/lib/stats.js'
import { createSide } from '../../v2/lib/battle.js'
import { AIL_KEYS } from '../../v2/lib/ailments.js'
import { ENEMY_SKILLS as V2_SKILLS, AREAS_SORTED } from '../../v2/lib/enemies.js'
import { ENEMY_SKILLS, AREA_ROSTERS } from './monsters.js'
import { SPOTS, toFighter as enemyFighter } from './areas.js'
import { toFighter } from './loadout.js'
import { CAP_RULES } from './rules.js'

const allEnemies = () => AREA_ROSTERS.flatMap(a => [...a.normals, ...(a.timed || []), ...(a.rares || []), ...a.bosses])
// その状態異常を持つ技 → 使う敵（並びは名簿の順）
const usersOf = (key) => {
  const out = {}
  for (const e of allEnemies()) for (const s of e.skills) {
    if (s.ail?.key !== key) continue
    ;(out[`${s.name} ${s.ail.chance}%`] ||= []).push(e.name)
  }
  return out
}

test('この版の決まり（職業補正なし・麻痺/封印の0.8倍）は味方にも敵にも乗る', () => {
  assert.deepEqual({ ...CAP_RULES }, { noClassBonus: true, ailDiminish: true })
  const me = toFighter({ username:'t', class:'戦士', lv: 1, ...INITIAL_STATS, jobs: { 戦士: { lv: 1, exp: 0 } }, learned: [], skill_sets: {}, equipped: {} }, [])
  const foe = enemyFighter(SPOTS[0].roster.enemies[0])
  for (const [who, f] of [['味方', me], ['敵', foe]]) {
    for (const [k, v] of Object.entries(CAP_RULES)) assert.equal(f[k], v, `${who} の ${k}`)
    assert.equal(createSide(f).ailDiminish, true, `${who} は受けるたび下がる`)
  }
})

test('今のⅡの敵の技は書き換えていない（この版は写しに足している）', () => {
  assert.equal(V2_SKILLS.かえんだん.ail, undefined)
  assert.equal(V2_SKILLS.ようがんけん.ail, undefined)
  assert.equal(V2_SKILLS.炎獄の審判.ail, undefined)
  assert.equal(V2_SKILLS.深淵咆哮.ail, undefined)
  assert.equal(V2_SKILLS.ほのおのきば, undefined)
  // 今のⅡの敵が持つ技も、今のⅡの名簿の物のまま
  const v2Skills = new Set(Object.values(V2_SKILLS))
  for (const a of AREAS_SORTED) for (const e of [...a.enemies, ...(a.timed || []), ...(a.rares || []), a.boss]) {
    for (const s of e.skills) assert.ok(v2Skills.has(s), `${e.name} の ${s.name}`)
  }
  // この版の敵は、この版の名簿の技しか持たない（今のⅡの物がそのまま紛れていない）
  const capSkills = new Set(Object.values(ENEMY_SKILLS))
  for (const e of allEnemies()) for (const s of e.skills) assert.ok(capSkills.has(s), `${e.name} の ${s.name}`)
})

test('敵の技の状態異常はどれも名簿にあるキー', () => {
  for (const e of allEnemies()) for (const s of e.skills) {
    if (s.ail) assert.ok(AIL_KEYS.includes(s.ail.key), `${e.name} の ${s.name}: ${s.ail.key}`)
  }
})

// ★割り当ては 2026-10-10 にユーザーが承認した表のまま。変えるときはユーザーに聞いてからここも直す
test('火傷：火の技（火炎弾・溶岩拳・炎獄の審判）と炎の牙', () => {
  assert.deepEqual(usersOf('burn'), {
    '火炎弾 30%': ['ドーンワイバーン', '炎精', 'ファイアドレイク', 'マグマスライム', 'ファイアインプ', '雛フェニックス', 'イフリート', '火吹きトカゲ', '鬼火', 'ブレイズバット', 'イフリートロード', '深紅のサラマンダー'],
    '溶岩拳 30%': ['溶岩ゴーレム', '熾火デーモン', 'マグマゴーレム', 'アークデーモン', '岩甲亀ヴォルカン', '溶岩竜ラヴァウルム', '深紅のサラマンダー', 'エルダードワーフ'],
    '炎の牙 25%': ['ヘルハウンド', 'ケルベロス'],
    '炎獄の審判 50%': ['深紅のサラマンダー'],
  })
  // 炎の牙は「かみつく」と同じ強さで、出血の代わりに火傷
  const { ail: _a, ...fang } = ENEMY_SKILLS.ほのおのきば
  const { ail: _b, name: _n, ...bite } = V2_SKILLS.かみつく
  assert.deepEqual({ ...fang, name: undefined }, { ...bite, name: undefined })
  for (const n of ['ヘルハウンド', 'ケルベロス']) {
    assert.ok(!allEnemies().find(e => e.name === n).skills.some(s => s.name === 'かみつく'), `${n} はかみつくを持たない`)
  }
})

test('封印：封印の呪文（攻撃しない・30%）', () => {
  const s = ENEMY_SKILLS.ふういん
  assert.deepEqual({ kind: s.kind, proc: s.proc, mp: s.mp, ail: s.ail }, { kind:'buff', proc:85, mp:8, ail:{ key:'seal', chance:30 } })
  assert.deepEqual(usersOf('seal'), {
    '封印の呪文 30%': ['ミイラ大神官', '霧魔女ミルヴァ', '極夜ワイト', 'ワイトキング', '沼呪師ザルグ', '大司書ノクトゥア', 'シーウィッチ', '深海魔女キルケ'],
  })
})

test('恐怖：咆哮（攻撃しない・先に動く・50%）と深淵咆哮。威嚇の叫びには付けない', () => {
  const s = ENEMY_SKILLS.ほうこう
  assert.deepEqual({ kind: s.kind, proc: s.proc, mp: s.mp, priority: s.priority, ail: s.ail },
    { kind:'buff', proc:90, mp:7, priority:1, ail:{ key:'fear', chance:50 } })
  assert.deepEqual(usersOf('fear'), {
    '咆哮 50%': ['岩砕きグリズリー', '氷牙マンモス', 'アークデーモン', '溶岩竜ラヴァウルム'],
    '深淵咆哮 50%': ['深海覇王リヴァイアサン'],
  })
  assert.equal(ENEMY_SKILLS.さけび.ail, undefined)
})

test('技は1体5つまで（足したボスも枠に収まる）', () => {
  for (const e of allEnemies()) assert.ok(e.skills.length <= 5, `${e.name}: ${e.skills.length}`)
})
