// v2cap 武器の真化（node --test）。決まりは shinka.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SHINKA_MAX, SHINKA_COST_PCT, SHINKA_MIN_DEN, MONSTER_KILLER_MULT, SREC_FIELDS, SREC_KEYS, FLAGS, FLAG_BY_KEY, ABILITIES, BANDS,
  KILLER_WEIGHT, flagWeightOf, pickFlag,
  emptySrec, srecOfBattle, addSrec, killerRaceOf, flagsOf, flagValueOf, flagLabelOf, rollShinka,
  shinkaEffectOf, shinkaNameOf, shinkaLines, shinkaEvolutionOf, masteryOf, canShinka,
} from './shinka.js'
import { RACES, RACE_BY_KEY, RACE_NAMES, raceOf } from './monsterRace.js'
import { ATOMS } from '../core/evolveAtoms.js'
import { runBattle } from '../core/battle.js'
import { ITEMS, UNIQUE_ITEMS } from './equipment.js'
import { SKILLS } from './skills.js'
import { toFighter } from './loadout.js'
import { snapshotOf, fromSnapshot } from './tower.js'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// ============================================================
// ユーザーが決めたこと
// ============================================================
test('【確定】2026-10-26 熟練度MAXは1,800戦（10秒に1戦で約5時間）・代償つきは一部のフラグだけ・魔物キラーは倍率半分', () => {
  assert.equal(SHINKA_MAX, 1800)
  assert.equal(SHINKA_MAX * 10 / 3600, 5)
  assert.equal(MONSTER_KILLER_MULT, 0.5)
  const withCost = Object.values(ABILITIES).filter(a => a.alt).length
  assert.ok(withCost > 0 && withCost < Object.keys(ABILITIES).length, '代償つきは一部に入れる（ユーザー選択）')
  assert.ok(SHINKA_COST_PCT > 0 && SHINKA_COST_PCT < 100)
})

test('【確定】キラーは倒した敵の種族の割合1位（魔物も入れる）。同じ数なら種族の並び順', () => {
  assert.equal(killerRaceOf({ race: { aquatic: 30, beast: 10 } }), 'aquatic')
  assert.equal(killerRaceOf({ race: { monster: 50, aquatic: 49 } }), 'monster')
  assert.equal(killerRaceOf({ race: { aquatic: 5, beast: 5 } }), RACES.findIndex(r => r.key === 'beast') < RACES.findIndex(r => r.key === 'aquatic') ? 'beast' : 'aquatic')
  assert.equal(killerRaceOf({ race: {} }), null)
})

test('【確定】付く能力は立っているフラグから抽選。キラーはフラグの1つ（勝っていればいつも立つ）', () => {
  const rec = { ...emptySrec(), n: 100, w: 80, hit: 400, crit: 200, race: { beast: 60, aquatic: 20 } }
  const pool = flagsOf(rec)
  assert.deepEqual(pool.find(p => p.key === 'killer'), { key: 'killer', param: 'beast' })
  assert.ok(pool.some(p => p.key === 'crit'), 'クリティカル率50%ならクリティカルのフラグ')
  // くじはどれも1・キラーだけ半分（6000回で見込みの ±3割の中）
  const rng = rngOf(3)
  const n = {}
  for (let i = 0; i < 6000; i++) { const r = rollShinka(rec, rng); n[r.key] = (n[r.key] || 0) + 1 }
  const total = pool.reduce((t, p) => t + flagWeightOf(p.key), 0)
  for (const p of pool) {
    const want = 6000 * flagWeightOf(p.key) / total
    assert.ok(Math.abs(n[p.key] - want) < want * 0.3, `${p.key} ${n[p.key]}（見込み ${Math.round(want)}）`)
  }
  assert.deepEqual(Object.keys(n).sort(), pool.map(p => p.key).sort(), '立っていないフラグは出ない')
})

test('【確定】2026-10-26 ユーザー選択「キラーを出にくくする」：キラーのくじだけ半分・種族は真化したときのまま（「キラー対象は変えちゃダメ」）', () => {
  assert.equal(KILLER_WEIGHT, 0.5)
  assert.equal(flagWeightOf('killer'), KILLER_WEIGHT)
  for (const f of FLAGS) if (f.key !== 'killer') assert.equal(flagWeightOf(f.key), 1, f.key)
  // 重みどおりに引く：キラーと1つのフラグだけなら、キラーは3回に1回
  const rng = rngOf(11)
  let k = 0
  for (let i = 0; i < 6000; i++) if (pickFlag([{ key: 'killer' }, { key: 'crit' }], rng).key === 'killer') k++
  assert.ok(Math.abs(k / 6000 - 1 / 3) < 0.03, `${k / 60}%`)
  // サーバーも同じ重みで引く（くじは種の weight・抽選は v2cap_shinka_pick）
  assert.ok(SQL.includes("  ('killer', null, null, null, null, 'race', true, 0.5, 1)"))
  assert.ok(SQL.includes('v_pick := public.v2cap_shinka_pick(v_pool);'))
  assert.ok(SQL.includes('revoke all on function public.v2cap_shinka_pick(jsonb) from public, anon, authenticated;'))
  // 真化した能力の種族は戦闘の形でもそのまま（真化したあとに数え直さない）
  assert.equal(shinkaEvolutionOf({ key: 'killer', cost: false, param: 'aquatic' }).race, 'aquatic')
})

test('代償つきは、代償つきのあるフラグでだけ・だいたい SHINKA_COST_PCT% で出る', () => {
  const rng = rngOf(9)
  const crit = { ...emptySrec(), n: 100, w: 0, hit: 400, crit: 300, fin: 500 }   // 勝っていない＝キラーが立たない・クリティカルだけ
  let cost = 0
  for (let i = 0; i < 4000; i++) { const r = rollShinka(crit, rng); assert.equal(r.key, 'crit'); if (r.cost) cost++ }
  assert.ok(Math.abs(cost / 4000 * 100 - SHINKA_COST_PCT) < 3, `${cost / 40}%`)
  const multi = { ...emptySrec(), n: 100, w: 0, hit: 400, multi: 300, fin: 500 }
  for (let i = 0; i < 300; i++) assert.equal(rollShinka(multi, rng).cost, false, '多段には代償つきが無い')
})

test('勝った戦いが無く、ほかのフラグも立たなければ真化できない（抽選が空）', () => {
  assert.equal(rollShinka({ ...emptySrec(), n: 5 }, rngOf(1)), null)
})

// ============================================================
// 記録
// ============================================================
test('1戦ぶんを足す：上限（cap）・同じ戦闘のその項目を超えない（le）・勝ったときだけ（winOnly）・種族は勝ったときだけ・時間帯は毎回', () => {
  const name = '盗賊'
  let r = addSrec(emptySrec(), { hit: 5, crit: 9, low: 1, hurt: 500, dodge: 3, taken: 2, x: 9 }, { win: false, enemy: name, band: '晩' })
  assert.equal(r.n, 1); assert.equal(r.w, 0); assert.equal(r.l, 1)
  assert.equal(r.crit, 5, 'クリティカルは当てた数まで')
  assert.equal(r.low, 0, '負けは「HPが少ないまま勝った」に入らない')
  assert.equal(r.hurt, 100, '失ったHPは100まで')
  assert.equal(r.dodge, 2, 'かわしたのは受けた数まで')
  assert.deepEqual(r.race, {}, '負けは種族に入らない')
  assert.deepEqual(r.band, { 晩: 1 })
  assert.equal(r.x, undefined, '知らない項目は足さない')
  r = addSrec(r, { low: 1, hit: 'あ' }, { win: true, enemy: name, band: '朝' })
  assert.equal(r.low, 1); assert.equal(r.w, 1); assert.equal(r.hit, 5)
  assert.deepEqual(r.race, { [raceOf(name)]: 1 })
  assert.deepEqual(r.band, { 晩: 1, 朝: 1 })
})

test('記録の項目はぜんぶ画面が戦闘ログから作れる（srecOfBattle）', () => {
  const st = (p) => ({ hp: p, mp: p / 2, str: p / 8, dex: p / 8, agi: p / 8, int_stat: p / 8, vit: p / 8, luk: p / 8 })
  const me = { name: '私', cls: '戦士', kind: 'phys', stats: st(600) }
  const foe = { name: '盗賊', cls: '戦士', kind: 'phys', stats: st(500) }
  const rec = srecOfBattle(runBattle(me, foe, { rng: rngOf(4), maxTurns: 40 }), '私')
  assert.deepEqual(Object.keys(rec).sort(), [...SREC_KEYS].sort())
  for (const k of SREC_KEYS) assert.ok(Number.isInteger(rec[k]) && rec[k] >= 0, k)
})

test('フラグ：分母が少ないうちは立たない・少ないほど立つもの（le）・時間帯は60%など境目以上', () => {
  for (const f of FLAGS) {
    if (f.special) continue
    assert.ok(SREC_KEYS.includes(f.num) || ['n', 'w', 'l'].includes(f.num), `${f.key} の num`)
    assert.ok(SREC_KEYS.includes(f.den) || ['n', 'w', 'l'].includes(f.den), `${f.key} の den`)
  }
  assert.equal(flagValueOf({ hit: SHINKA_MIN_DEN - 1, crit: 20 }, FLAG_BY_KEY.crit), null)
  const fin = FLAG_BY_KEY.fin
  assert.equal(fin.dir, 'le')
  assert.ok(flagsOf({ ...emptySrec(), n: 100, fin: 0 }).some(p => p.key === 'fin'))
  assert.ok(!flagsOf({ ...emptySrec(), n: 100, fin: 500 }).some(p => p.key === 'fin'))
  const band = FLAG_BY_KEY.band
  assert.deepEqual(flagsOf({ ...emptySrec(), n: 100, band: { 晩: Math.ceil(band.th * 100) } }).find(p => p.key === 'band'), { key: 'band', param: '晩' })
  assert.ok(!flagsOf({ ...emptySrec(), n: 100, band: { 晩: 34, 朝: 33, 昼: 33 } }).some(p => p.key === 'band'))
  for (const f of FLAGS) assert.ok(flagLabelOf({ key: f.key, param: f.special === 'race' ? 'aquatic' : '晩' }), f.key)
})

// ============================================================
// 能力
// ============================================================
test('どのフラグにも能力がある・能力の部品は実在する・得のある部品だけ得に・代償は代償の文がある部品だけ', () => {
  assert.deepEqual(Object.keys(ABILITIES).sort(), FLAGS.map(f => f.key).sort())
  for (const [k, a] of Object.entries(ABILITIES)) {
    for (const def of [a, a.alt].filter(Boolean)) {
      for (const atom of Object.keys(def.gain)) assert.ok(ATOMS[atom]?.up, `${k} の得 ${atom}`)
      for (const atom of Object.keys(def.cost || {})) assert.ok(ATOMS[atom]?.down, `${k} の代償 ${atom}`)
    }
  }
})

test('★代償つきは、そのぶん得が大きい（同じ部品で得だけのものより大きい）', () => {
  for (const [k, a] of Object.entries(ABILITIES)) {
    if (!a.alt) continue
    for (const [atom, v] of Object.entries(a.gain)) assert.ok((a.alt.gain[atom] || 0) > v, `${k} の ${atom}`)
    assert.ok(Object.keys(a.alt.cost || {}).length > 0, `${k} の代償つきに代償が無い`)
  }
})

test('★致命傷を耐える（guts）は1種だけ（重ねると跳ねる・前のV2と同じ決まり）', () => {
  const guts = Object.entries(ABILITIES).filter(([, a]) => [a, a.alt].filter(Boolean).some(d => d.gain.guts))
  assert.equal(guts.length, 1)
})

test('魔物キラーは倍率半分（代償も半分）。名前と文に種族が入る', () => {
  const a = shinkaEffectOf({ key: 'killer', cost: false, param: 'aquatic' })
  const m = shinkaEffectOf({ key: 'killer', cost: false, param: 'monster' })
  assert.equal(m.gain.dmgRace, a.gain.dmgRace * MONSTER_KILLER_MULT)
  const mc = shinkaEffectOf({ key: 'killer', cost: true, param: 'monster' })
  const ac = shinkaEffectOf({ key: 'killer', cost: true, param: 'aquatic' })
  assert.equal(mc.cost.dmgOtherRace, ac.cost.dmgOtherRace * MONSTER_KILLER_MULT)
  assert.equal(shinkaNameOf({ key: 'killer', param: 'aquatic' }), '海洋キラー')
  assert.ok(shinkaLines({ key: 'killer', cost: true, param: 'aquatic' }).some(l => l.cost && l.text.includes('海洋以外')))
  assert.ok(shinkaLines({ key: 'band', param: '晩' })[0].text.includes('晩の時間帯'))
})

test('能力の名前はほかの名前とかぶらない（装備・ユニーク・技・種族）', () => {
  const names = []
  for (const [k, a] of Object.entries(ABILITIES)) {
    for (const def of [a, a.alt].filter(Boolean)) {
      const params = k === 'killer' ? RACES.map(r => r.key) : k === 'band' ? BANDS : [null]
      for (const p of params) names.push(typeof def.name === 'function' ? def.name(p) : def.name)
    }
  }
  assert.equal(new Set(names).size, names.length, '能力どうしで同じ名前')
  const taken = new Set([...ITEMS, ...UNIQUE_ITEMS].map(i => i.name).concat(SKILLS.map(s => s.name), RACES.map(r => r.label)))
  for (const n of names) assert.ok(!taken.has(n), `${n} はほかの名前とかぶる`)
})

test('キラーは種族の無い相手（塔のプレイヤー・NPC）には得も代償も乗らない', async () => {
  const { collectEvolutions, evoDmgPct } = await import('../core/evolve.js')
  const evo = collectEvolutions([shinkaEvolutionOf({ key: 'killer', cost: true, param: 'aquatic' })])
  assert.equal(evoDmgPct(evo, { foeRace: null }), 0)
  assert.equal(evoDmgPct(evo, { foeRace: 'aquatic' }), ABILITIES.killer.alt.gain.dmgRace)
  assert.equal(evoDmgPct(evo, { foeRace: 'beast' }), -ABILITIES.killer.alt.cost.dmgOtherRace)
})

test('戦闘の形：キラーは種族を渡す・時間帯は合っているときだけ・真化していなければ null', () => {
  assert.equal(shinkaEvolutionOf(null), null)
  assert.equal(shinkaEvolutionOf({ key: 'nope' }), null)
  assert.equal(shinkaEvolutionOf({ key: 'killer', param: 'undead' }).race, 'undead')
  assert.equal(shinkaEvolutionOf({ key: 'band', param: '晩' }, '朝'), null)
  assert.ok(shinkaEvolutionOf({ key: 'band', param: '晩' }, '晩'))
})

// ★全部の能力（得だけ・代償つき）が戦闘に効いている（配線の忘れを総当たりで検出）
const st = (p, over = {}) => ({ hp: p, mp: p / 2, str: p / 8, dex: p / 8, agi: p / 8, int_stat: p / 8, vit: p / 8, luk: p / 8, ...over })
const sk = (name, over = {}) => ({ name, kind: 'phys', mult: 1, proc: 100, mp: 0, desc: '', ...over })
const kit = () => [
  { skill: sk('鼓舞', { kind: 'buff', mp: 0, buff: { self: { str: 30 } } }), uses: 1 },
  { skill: sk('連撃', { mult: 0.35, hits: 3, mp: 4, proc: 60 }), uses: 99 },
  { skill: sk('毒牙', { mult: 0.6, mp: 4, ail: { key: 'poison', chance: 60, turns: 3 } }), uses: 99 },
  { skill: sk('手当て', { kind: 'heal', mp: 6, heal: { rate: 0.4 } }), uses: 99 },
]
const SCENES = [
  { me: {}, foe: {} },
  { me: { stats: st(1800) }, foe: {} },
  { me: {}, foe: { stats: st(1800) } },
  { me: {}, foe: { stats: st(800) } },
  { me: { stats: st(600, { agi: 900 }) }, foe: { slots: [{ skill: sk('大振り', { mult: 0.5, acc: 1 }), uses: 99 }] } },
]
const fp = (r) => [r.winner, r.turns, r.a.hp, r.a.mp, r.b.hp, r.log.length].join('|')
const scenes = (evolutions) => SCENES.map(sc => [1, 2, 3, 4, 5, 6].map(seed => fp(runBattle(
  { name: '私', cls: '戦士', kind: 'phys', stats: st(600), slots: kit(), evolutions, ...sc.me },
  { name: '敵', cls: '戦士', kind: 'phys', stats: st(600), slots: kit(), race: 'beast', boss: true, ...sc.foe },
  { rng: rngOf(seed), maxTurns: 40 }))).join('#')).join('@')

test('★全部の能力（得だけ・代償つき）が戦闘に効いている', () => {
  const base = scenes([])
  const dead = []
  for (const [k, a] of Object.entries(ABILITIES)) {
    for (const cost of [false, ...(a.alt ? [true] : [])]) {
      const param = k === 'killer' ? (cost ? 'aquatic' : 'beast') : k === 'band' ? '晩' : null
      const ev = shinkaEvolutionOf({ key: k, cost, param }, '晩')
      if (scenes([ev]) === base) dead.push(`${k}${cost ? '(代償)' : ''}`)
    }
  }
  assert.deepEqual(dead, [], `戦闘に効いていない能力: ${dead.join(', ')}`)
})

// ============================================================
// つなぎ（画面・サーバー・塔）
// ============================================================
test('熟練度：MAX で真化できる・真化したらできない', () => {
  assert.equal(masteryOf({ mastery: 99999 }), SHINKA_MAX)
  assert.equal(canShinka({ mastery: SHINKA_MAX }), true)
  assert.equal(canShinka({ mastery: SHINKA_MAX - 1 }), false)
  assert.equal(canShinka({ mastery: SHINKA_MAX, shinka: { key: 'crit' } }), false)
})

test('toFighter：着けている武器の真化だけ戦闘に渡す。塔の守護者の姿も真化を持つ', () => {
  const prof = { username: 'me', class: '戦士', lv: 10, str: 10, agi: 10, vit: 10, dex: 10, int_stat: 10, luk: 10, hp: 100, mp: 30,
    jobs: { 戦士: { lv: 1, exp: 0 } }, learned: [], skill_sets: {}, equipped: { weapon: 1 } }
  const sword = ITEMS.find(i => i.part === '武器' && i.type === '両手剣' && i.area === 1)
  const inv = [{ id: 1, base_id: sword.id, ilv: sword.lv, plus: 0, shinka: { key: 'crit', cost: false, param: null } },
    { id: 2, base_id: sword.id, ilv: sword.lv, plus: 0, shinka: { key: 'multi', cost: false, param: null } }]
  const f = toFighter(prof, inv)
  assert.equal(f.evolutions.length, 1)
  assert.deepEqual(f.evolutions[0].gain, ABILITIES.crit.gain)
  assert.deepEqual(toFighter({ ...prof, equipped: {} }, inv).evolutions, [])
  const back = fromSnapshot(snapshotOf(f))
  assert.deepEqual(back.shinka, inv[0].shinka)
  assert.deepEqual(back.evolutions[0].gain, ABILITIES.crit.gain)
})

test('サーバー：精算は戦い方の記録（p_rec）を受け取り、着けている武器を数える。真化の抽選はサーバー', () => {
  assert.ok(SQL.includes('p_rec jsonb default null'))
  assert.ok(SQL.includes("perform public.v2cap_shinka_count(v_uid, nullif(v_row.equipped ->> 'weapon', '')::bigint, p_rec, v_win,"))
  assert.ok(SQL.includes('grant execute on function public.v2cap_sortie_settle(int, text, boolean, text, boolean, text, jsonb) to authenticated;'))
  assert.ok(SQL.includes('revoke all on function public.v2cap_shinka_count(uuid, bigint, jsonb, boolean, text) from public, anon, authenticated;'), '数えるのは精算からだけ')
  assert.ok(/create or replace function public\.v2cap_shinka\(p_inv bigint\)[\s\S]*?random\(\)[\s\S]*?\$\$;/.test(SQL), '抽選はサーバー')
  // 画面は記録を送る（サーバーが前の版なら外して送り直す）
  const sortie = read('components/V2capSortie.jsx')
  assert.ok(sortie.includes('p_rec: srecOfBattle(r, you),'))
  assert.ok(sortie.includes('delete args.p_rec'))
})

test('記録の項目の上限は SQL の種（shinka_fields）と同じ（tools/v2cap-sql.mjs が作る）', () => {
  for (const [i, f] of SREC_FIELDS.entries()) {
    assert.ok(SQL.includes(`  ('${f.key}', ${f.cap}, ${f.le ? `'${f.le}'` : 'null'}, ${f.winOnly ? 'true' : 'false'}, ${i + 1})`), f.key)
  }
})

test('種族の名簿：SQL（サーバーが倒した敵の種族を数える表）にも、画面の名簿と同じ数だけある', () => {
  const n = (SQL.match(/-- @@seed:monster_race\n[\s\S]*?-- @@end:monster_race/)[0].match(/^ {2}\('/gm) || []).length
  assert.equal(Object.keys(RACE_BY_KEY).length, 11)
  assert.equal(n, Object.values(RACE_NAMES).flat().length)
})

test('鍛冶屋：真化のタブ・HELP に代償が付くこともあると書く・分解の確認に能力も消えると出す・まとめての分解と寄贈には入れない', () => {
  const smith = read('components/V2capSmith.jsx')
  assert.ok(smith.includes("{ key:'shinka',    label:'真化',"))
  assert.ok(/key:'shinka'[^\n]*代償（デメリット）が付く能力もあります/.test(smith))
  assert.ok(smith.includes('分解すると能力も消えます'))
  assert.ok(read('lib/smith.js').includes('&& !inv?.shinka'))
  assert.ok(read('lib/museum.js').includes('|| inv.shinka) continue'))
  const tab = read('components/V2capShinka.jsx')
  assert.ok(tab.includes("call('v2cap_shinka', { p_inv: askRow.inv.id })"))
  assert.ok(tab.includes('代償（デメリット）が付くこともあります。'))
})
