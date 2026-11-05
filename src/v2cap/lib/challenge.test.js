// 挑戦（四凶）の報酬：特別な素材と専用装備（2026-11-06 ユーザー「4強の報酬を決めたい」→案に全部「推奨」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  CHALLENGE_TIER_AREA, CHALLENGE_DIFFS, CHALLENGE_BONUS, CHALLENGE_MATS, CHALLENGE_GEAR_DEFS,
  CH_GEAR_RARITY, CH_MAT_PCT, CH_MAT_RANGE, CH_MAT_SOLO_MULT, CH_OWN_PCT, CH_CRAFT_MATS, CH_CRAFT_GOLD_PER_LV,
} from './challengeDefs.js'
import {
  matKeyOf, matNameOf, matNameOfKey, chMatsOf, chMatGainOf, chMatMeanOf, challengeItemsOf, chCraftCostOf, chCraftErrorOf,
  chCraftTimesOf, chDropsOf, rollChallengeDrops, CH_PARTS,
} from './challenge.js'
import {
  ITEMS, ITEM_BY_ID, CHALLENGE_ITEMS, UNIQUE_ITEMS, KIND_BY_KEY, PARTS, ACCESSORY_TYPES, ARMOR_LINES,
  itemOf, reqLvOf, isChallenge, isUnique, hasGearFx, sameGearKeyOf, challengeItemIdOf,
} from './equipment.js'
import { GEAR_NAMES } from './gearNames.js'
import { powerAt, statsAt } from './gear.js'
import { canCraft, craftErrorOf, bulkPickable, SCRAP_YIELD } from './smith.js'
import { equippedItems, toFighter } from './loadout.js'
import { DUNGEON_BOSSES, CHALLENGE_CATS, DIFF_KEYS, HELPER_REWARD_MIN_PCT, SOLO_REWARD_MULT, isDiffReady } from './dungeon.js'
import { INITIAL_STATS } from './level.js'
import { RAID_EQUIP_NAMES } from '../../constants/raidEquipment.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SQL = read('../../../supabase_v2cap_core.sql')
const fnBody = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(m, `${name} が見つかる`)
  return m[0]
}
const BOSSES = CHALLENGE_CATS.flatMap(c => c.bosses)

test('段階：難易度ごとのエリアは dungeon.js の diffs と同じ・呼べる難易度は全部ある（ノーマル②・ハード⑤）', () => {
  assert.deepEqual(CHALLENGE_TIER_AREA, { normal: 2, hard: 5 })
  for (const b of BOSSES) {
    for (const d of DIFF_KEYS) {
      if (!isDiffReady(b, d)) { assert.equal(CHALLENGE_TIER_AREA[d], undefined, `${d}はまだ呼べない＝段階も無い`); continue }
      assert.equal(CHALLENGE_TIER_AREA[d], DUNGEON_BOSSES[b].diffs[d].area, `${b} ${d}`)
    }
  }
  assert.deepEqual(CHALLENGE_DIFFS, ['normal', 'hard'])
})

test('特別な素材：四凶 × 段階ごとに1つ・名前は V1 の素材（ノーマル＝ふつうの素材・ハード＝希少な素材）', () => {
  assert.deepEqual(Object.keys(CHALLENGE_MATS).sort(), [...BOSSES].sort())
  const names = BOSSES.flatMap(b => CHALLENGE_DIFFS.map(d => matNameOf(b, d)))
  assert.equal(new Set(names).size, names.length, '名前は重ならない')
  assert.deepEqual(names, ['黒龍の鱗', '黒龍の逆鱗', '水禍の雫', '雨禍の心核', '雷鋼片', '神雷炉心', '獄王の断罪片', '閻魔の審判核'])
  assert.equal(matKeyOf('varuzenoku', 'hard'), 'varuzenoku:hard')
  assert.equal(matNameOfKey('amaza:normal'), '水禍の雫')
  assert.equal(matNameOfKey('nope:normal'), '素材')
  assert.equal(chMatsOf({ 'enma:hard': 7 }, 'enma', 'hard'), 7)
  assert.equal(chMatsOf(undefined, 'enma', 'hard'), 0, 'SQLを流す前の行（challenge_mats が無い）は0')
})

test('専用装備：V1 のレイドの交換所の12個をそのまま使う（名前）・ボスごとに3つ・種類は V2 にある', () => {
  assert.equal(CHALLENGE_GEAR_DEFS.length, 12)
  assert.deepEqual(new Set(CHALLENGE_GEAR_DEFS.map(d => d.name)), RAID_EQUIP_NAMES, 'V1 の12個（src/constants/raidEquipment.js）と同じ名前')
  for (const b of BOSSES) assert.equal(CHALLENGE_GEAR_DEFS.filter(d => d.boss === b).length, 3, b)
  for (const d of CHALLENGE_GEAR_DEFS) {
    assert.ok(KIND_BY_KEY[d.kind], `${d.name}：${d.kind} は V2 の種類`)
    assert.ok(d.text && d.v1, `${d.name}：能力の文と V1 の能力の控え`)
  }
  // ボスの中で種類は重ならない（id が「段階：ボス：種類」なので）
  for (const b of BOSSES) {
    const kinds = CHALLENGE_GEAR_DEFS.filter(d => d.boss === b).map(d => d.kind)
    assert.equal(new Set(kinds).size, kinds.length, b)
  }
  // ほかの装備の名前とかぶらない（エリアの装備・ユニーク・初期装備）
  const others = new Set([...Object.values(GEAR_NAMES).flatMap(t => Object.values(t).flat()), ...UNIQUE_ITEMS.map(u => u.name)])
  for (const d of CHALLENGE_GEAR_DEFS) assert.ok(!others.has(d.name), `${d.name} はほかの装備とかぶらない`)
})

test('専用装備の能力は戦闘がもう読む項目だけ（戦闘の計算は足していない）', () => {
  const core = ['../core/battle.js', '../core/battleSet.js', '../core/atb.js'].map(read).join('\n')
  const known = new Set([...core.matchAll(/[fF]x\??\.(\w+)/g)].map(m => m[1]))   // fx.〇〇・setFx?.〇〇
  for (const d of CHALLENGE_GEAR_DEFS) {
    for (const k of Object.keys(d.fx)) assert.ok(known.has(k), `${d.name}：${k} を戦闘が読む`)
  }
  // 状態異常のキーは ailments.js にある
  const ail = read('../core/ailments.js')
  for (const d of CHALLENGE_GEAR_DEFS) {
    for (const a of [...(d.fx.onHitAils || []), ...(d.fx.counterAil || []), ...(d.fx.vsAilDmg || [])]) assert.ok(ail.includes(`'${a.key}'`), `${d.name}：${a.key}`)
  }
  // ユニークより弱く：哭雨の羽衣は亡将の鉄兜（6ターンごと）より間を空ける
  const ward = UNIQUE_ITEMS.find(u => u.name === '亡将の鉄兜').fx.ward.every
  assert.ok(CHALLENGE_GEAR_DEFS.find(d => d.name === '哭雨の羽衣').fx.ward.every > ward)
})

test('専用装備の強さ：同じアイテムLVのレジェンダリー＋10・強化も同じ倍率（ノーマル LV25・ハード LV40）', () => {
  assert.equal(CHALLENGE_BONUS, 10)
  assert.equal(CHALLENGE_ITEMS.length, 12 * CHALLENGE_DIFFS.length)
  for (const it of CHALLENGE_ITEMS) {
    const area = CHALLENGE_TIER_AREA[it.diff]
    assert.equal(it.id, challengeItemIdOf(area, it.bossKey, it.kind))
    assert.equal(it.rarity, 'L')
    assert.equal(it.area, area)
    assert.equal(it.lv, reqLvOf(area, 'L'))
    assert.equal(it.boss, DUNGEON_BOSSES[it.bossKey].name)
    const L = itemOf(area, 'L', it.kind)
    assert.deepEqual(it.dist, L.dist, '配分は V2 の同じ種類と同じ')
    assert.equal(powerAt(it, it.lv), powerAt(L, L.lv) + 10, `${it.id}`)
    for (const p of [1, 5, 10]) assert.ok(powerAt(it, it.lv, p) > powerAt(L, L.lv, p), `${it.id} +${p}`)
    const sum = Object.values(statsAt(it, it.lv)).reduce((a, b) => a + b, 0)
    assert.equal(sum, powerAt(it, it.lv), 'ステの合計＝戦闘力')
  }
  // 例：両手剣 ノーマル 54→64・ハード 76→86（ユーザーに見せた数）
  assert.equal(powerAt(ITEM_BY_ID['C2:varuzenoku:両手剣'], 25), 64)
  assert.equal(powerAt(ITEM_BY_ID['C5:varuzenoku:両手剣'], 40), 86)
})

test('専用装備は ID からは引けるが、落ちる・作る一覧（ITEMS）には入らない／見分け', () => {
  for (const it of CHALLENGE_ITEMS) {
    assert.equal(ITEM_BY_ID[it.id], it)
    assert.ok(!ITEMS.includes(it))
    assert.ok(isChallenge(it) && hasGearFx(it) && !isUnique(it))
  }
  assert.ok(!isChallenge(ITEMS[0]) && !hasGearFx(ITEMS[0]))
  assert.equal(sameGearKeyOf(ITEM_BY_ID['C2:zerugiasu:イヤリング']), sameGearKeyOf(ITEM_BY_ID['C5:zerugiasu:イヤリング']), 'ノーマルとハードの同じ装備は同じもの')
  assert.notEqual(sameGearKeyOf(ITEM_BY_ID['C2:zerugiasu:イヤリング']), sameGearKeyOf(ITEM_BY_ID['C2:amaza:リング']))
  assert.deepEqual(challengeItemsOf('enma', 'hard').map(i => i.name), ['冥獄宝珠・断罪', '冥府王の獄衣', '六道輪廻の数珠'])
  assert.deepEqual(challengeItemsOf('enma', 'expert'), [], 'まだ呼べない難易度の段階は無い')
})

test('着けると能力が戦闘へ渡る・同じ専用装備（同じ名前）は1つまで', () => {
  const prof = { username: 't', class: '盗賊', lv: 40, ...INITIAL_STATS, jobs: { 盗賊: { lv: 1, exp: 0 } }, learned: [], skill_sets: {},
    equipped: { acc1: 1, acc2: 2, body: 3 } }
  const inv = [
    { id: 1, base_id: 'C2:zerugiasu:イヤリング', ilv: 25, plus: 0 },
    { id: 2, base_id: 'C5:zerugiasu:イヤリング', ilv: 40, plus: 0 },
    { id: 3, base_id: 'C5:enma:軽装鎧', ilv: 40, plus: 0 },
  ]
  const worn = equippedItems(prof, inv)
  assert.ok(worn.acc1 && !worn.acc2, '2つめの神雷の環は数えない（ユニークと同じ）')
  const fx = toFighter(prof, inv).setFx
  assert.equal(fx.statPct.agi, 10, '神雷の環 AGI+10%（1つぶん）')
  assert.equal(fx.takenCut, 5, '冥府王の獄衣 受けるダメージ−5%')
  assert.deepEqual(fx.lowHpCut, { at: 50, cut: 5 })
  assert.match(fx.names.statPct, /神雷の環/)
  // サーバーも同じ名前を弾く
  const eq = fnBody('v2cap_equip')
  assert.ok(eq.includes("if v_eq.boss is not null and exists (") && eq.includes('e.boss is not null and e.name = v_eq.name'))
  assert.ok(eq.includes("format('%sはもう着けています（同じ専用装備は1つまで）', v_eq.name)"))
})

test('作成：素材50個＋Gold 必要LV×200・残骸の作成では作れない・まとめての分解に入らない', () => {
  assert.equal(CH_CRAFT_MATS, 50)
  assert.equal(CH_CRAFT_GOLD_PER_LV, 200)
  const it = ITEM_BY_ID['C2:amaza:杖']
  assert.deepEqual(chCraftCostOf(it), { key: 'amaza:normal', name: '水禍の雫', mats: 50, gold: 5000 })
  assert.equal(chCraftCostOf(ITEM_BY_ID['C5:amaza:杖']).gold, 8000)
  assert.equal(chCraftCostOf(itemOf(2, 'L', '杖')), null, 'エリアの装備は挑戦装備では作れない')
  assert.equal(chCraftErrorOf(it, { gold: 99999, challenge_mats: { 'amaza:normal': 49 } }), '水禍の雫が足りません')
  assert.equal(chCraftErrorOf(it, { gold: 4999, challenge_mats: { 'amaza:normal': 50 } }), 'Goldが足りません')
  assert.equal(chCraftErrorOf(it, { gold: 5000, challenge_mats: { 'amaza:normal': 50 } }), null)
  assert.equal(chCraftErrorOf(it, { gold: 5000, challenge_mats: { 'amaza:hard': 50 } }), '水禍の雫が足りません', 'ハードの素材ではノーマルの段階は作れない')
  assert.equal(chCraftTimesOf(it, { gold: 12000, challenge_mats: { 'amaza:normal': 160 } }), 2)
  assert.ok(!canCraft(it))
  assert.equal(craftErrorOf(it, { gold: 1e9, materials: { 2: 1e6 } }), 'この装備は「挑戦装備」で作ります')
  assert.ok(!bulkPickable({ inv: { id: 1, plus: 0 }, item: it }, new Set()), 'まとめての分解に入れない')
  assert.equal(SCRAP_YIELD[it.rarity], 25, '分解はレジェンダリーと同じ（その段階のエリアの残骸）')
  // サーバー：v2cap_craft_challenge の数・v2cap_craft は弾く（同じ文）
  const c = fnBody('v2cap_craft_challenge')
  assert.ok(c.includes(`c_mats        constant int := ${CH_CRAFT_MATS};`) && c.includes(`c_gold_per_lv constant int := ${CH_CRAFT_GOLD_PER_LV};`))
  assert.ok(c.includes("v_key  := v_eq.boss || ':' || v_diff;"), '素材の鍵は matKeyOf と同じ形')
  assert.ok(c.includes('join lateral public.v2cap_dungeon_conf(v_eq.boss, x.diff) c on true'), '段階のエリア→難易度は v2cap_dungeon_conf から引く')
  assert.ok(c.includes("if v_have < c_mats then return jsonb_build_object('ok', false, 'error', '素材が足りません'); end if;"))
  assert.ok(c.indexOf('v_have < c_mats') < c.indexOf('v_row.gold < v_gold'), '見る順は 素材→Gold（chCraftErrorOf と同じ）')
  assert.ok(SQL.includes('grant execute on function public.v2cap_craft_challenge(text) to authenticated;'))
  assert.ok(fnBody('v2cap_craft').includes("if v_eq.boss is not null then\n    return jsonb_build_object('ok', false, 'error', 'この装備は「挑戦装備」で作ります');"))
})

test('落とし方：サーバーの v2cap_dungeon_pay_reward の数は challengeDefs.js と同じ', () => {
  const p = fnBody('v2cap_dungeon_pay_reward')
  assert.ok(p.includes(`c_gear_r     constant int := ${CH_GEAR_RARITY.R};`) && p.includes(`c_gear_e     constant int := ${CH_GEAR_RARITY.E};`))
  assert.equal(CH_GEAR_RARITY.R + CH_GEAR_RARITY.E + CH_GEAR_RARITY.L, 100)
  assert.deepEqual(CH_GEAR_RARITY, { R: 75, E: 20, L: 5 }, 'ユーザーが選んだ「標準」')
  assert.ok(p.includes(`c_mat_pct    constant int := ${CH_MAT_PCT};`) && p.includes(`c_mat_min    constant int := ${CH_MAT_RANGE[0]};`) && p.includes(`c_mat_max    constant int := ${CH_MAT_RANGE[1]};`))
  assert.deepEqual([CH_MAT_PCT, ...CH_MAT_RANGE, CH_OWN_PCT], [50, 1, 5, 2], 'ユーザーが選んだ「標準」')
  assert.ok(p.includes(`c_own_pct    constant numeric := ${CH_OWN_PCT};`))
  assert.equal(CH_MAT_SOLO_MULT, SOLO_REWARD_MULT, 'ソロ討伐の素材の倍率は EXP・Gold と同じ')
  // 部位・装飾品・防具の系統は equipment.js と同じ並び
  assert.deepEqual(CH_PARTS, PARTS)
  assert.ok(p.includes(`(array['${PARTS.join("', '")}'])[1 + floor(random() * ${PARTS.length})::int]`))
  assert.ok(p.includes(`(array['${ACCESSORY_TYPES.join("', '")}'])[1 + floor(random() * ${ACCESSORY_TYPES.length})::int]`))
  assert.ok(p.includes(`(array['${ARMOR_LINES.join("', '")}'])[1 + floor(random() * ${ARMOR_LINES.length})::int] || v_part`))
  assert.ok(p.includes("v_key := v_run.boss || ':' || v_run.diff;"), '素材の鍵は matKeyOf と同じ形')
  assert.ok(p.includes('v_n := greatest(1, round(v_n * v_pct / 100.0)::int) * (case when v_solo then c_solo_mult else 1 end);'), 'chMatGainOf と同じ式')
  assert.ok(p.includes('if random() * 100 < c_own_pct * v_pct / 100.0 then'), '救援の人は専用装備の確率にも割合を掛ける')
  assert.ok(p.includes("where e.boss = v_run.boss and e.area = v_area order by random() limit 1"), '専用装備はそのボスのその段階から')
  assert.ok(p.includes("'gear', v_gear, 'mat', v_mat, 'own', v_own"), '画面（chDropsOf）が読む形で返す')
  assert.ok(SQL.includes("alter table public.v2cap_profiles add column if not exists challenge_mats jsonb not null default '{}'::jsonb;"))
  assert.ok(!/unique|'U'/.test(p.slice(p.indexOf('===== 落とすもの'))), 'ユニークは四凶の分が決まるまで落とさない')
})

test('落とし方：素材の数（救援は割合・最低1／ソロは3倍）と、抽選の割合', () => {
  assert.equal(chMatGainOf(3), 3)
  assert.equal(chMatGainOf(1, HELPER_REWARD_MIN_PCT), 1, '最低1')
  assert.equal(chMatGainOf(5, 30), 2, '5×0.3＝1.5 → 2（SQL の round と同じ）')
  assert.equal(chMatGainOf(4, 100, true), 12)
  assert.equal(chMatMeanOf(), 1.5, '50%で1〜5個＝平均1.5個（約33回で50個）')
  // 乱数を回して割合を見る（シードつき）
  let s = 1234567   // mulberry32（続けて引いても偏らない）
  const rng = () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const N = 40000
  const n = { R: 0, E: 0, L: 0, mat: 0, own: 0, weapon: 0 }
  for (let i = 0; i < N; i++) {
    const r = rollChallengeDrops({ diff: 'hard', weapons: ['短剣', '投擲', '刀'] }, rng)
    n[r.gear.rarity]++
    if (r.gear.area !== 5) throw new Error('ハード＝⑤の装備')
    if (ITEM_BY_ID[`${r.gear.area}${r.gear.rarity}:${r.gear.kind}`] == null) throw new Error(`${r.gear.kind} の装備がある`)
    if (PARTS.indexOf(KIND_BY_KEY[r.gear.kind].part) === 0) { n.weapon++; assert.ok(['短剣', '投擲', '刀'].includes(r.gear.kind), 'いまの職業の武器') }
    if (r.mat) n.mat++
    if (r.own) n.own++
  }
  const near = (got, want, tol) => assert.ok(Math.abs(got / N * 100 - want) < tol, `${got / N * 100} ≈ ${want}`)
  near(n.R, 75, 1.5); near(n.E, 20, 1.5); near(n.L, 5, 0.8)
  near(n.mat, 50, 1.5); near(n.own, 2, 0.5); near(n.weapon, 100 / 6, 1.2)
  // 救援の人（割合30%）は装備も専用装備も3割の確率
  let g = 0
  for (let i = 0; i < N; i++) if (rollChallengeDrops({ diff: 'normal', pct: 30, weapons: ['杖'] }, rng).gear) g++
  near(g, 30, 1.5)
  assert.deepEqual(rollChallengeDrops({ diff: 'expert' }, rng), { gear: null, mat: 0, own: false }, 'まだ無い段階は何も落とさない')
})

test('報酬の画面に出す行（chDropsOf）：装備・素材・専用装備の順・無いものは出さない', () => {
  const r = { exp: 1, gold: 1, gear: { id: 9, base_id: '5E:片手剣', ilv: 35 }, mat: { key: 'zerugiasu:hard', n: 4 }, own: { id: 10, base_id: 'C5:zerugiasu:短剣', ilv: 40 } }
  assert.deepEqual(chDropsOf(r).map(x => x.kind), ['gear', 'mat', 'own'])
  assert.equal(chDropsOf(r)[1].name, '神雷炉心')
  assert.equal(chDropsOf(r)[2].item.name, '蒼雷の短刃')
  assert.deepEqual(chDropsOf({ exp: 1, gold: 1 }), [], 'SQL を流す前の返事（gear が無い）でも壊れない')
  assert.deepEqual(chDropsOf({ gear: null, mat: null, own: null }), [])
  assert.deepEqual(chDropsOf(null), [])
  // 画面の文字とコード（説明のコメントは除く）
  const screen = read('../components/V2capBossReward.jsx')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n')
  assert.ok(screen.includes('{chDropsOf(reward).map((x, i) => ('), '報酬の欄に出す')
  assert.ok(!/3倍|×3|CH_MAT_SOLO_MULT/.test(screen), 'ソロ討伐の倍率は書かない（ユーザー「具体的な内容は言わないで」）')
})

test('流す追加分（作業フォルダ直下の v2cap_challenge_reward_20261106.sql・あれば）は全文と同じ', () => {
  const url = new URL('../../../v2cap_challenge_reward_20261106.sql', import.meta.url)
  if (!existsSync(url)) return
  const delta = readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
  const fns = [...delta.matchAll(/create or replace function public\.\w+\([\s\S]*?\n\$\$;/g)].map(m => m[0])
  assert.deepEqual(fns.map(f => f.match(/function public\.(\w+)/)[1]),
    ['v2cap_equip', 'v2cap_craft', 'v2cap_museum_settle', 'v2cap_museum_take', 'v2cap_dungeon_pay_reward', 'v2cap_craft_challenge'])
  for (const f of fns) assert.ok(SQL.includes(f), `${f.match(/function public\.(\w+)/)[1]} は全文と同じ`)
  for (const it of CHALLENGE_ITEMS) assert.ok(delta.includes(`('${it.id}', '${it.name}', `), it.id)
  for (const line of delta.split(/\r?\n/).filter(l => /^(alter table|revoke|grant) /.test(l))) assert.ok(SQL.includes(line), line)
})

test('博物館：専用装備は数えない・寄贈できない（エリア②⑤のレジェンダリーがそろわなくならない）', () => {
  const settle = fnBody('v2cap_museum_settle')
  assert.equal((settle.match(/and e\.rarity in \('N', 'R', 'E', 'L'\) and e\.boss is null/g) || []).length, 2, '要る数（need）と登録した数（have）の両方で外す')
  // 種：専用装備の行に boss が入っている・ほかの行は null
  const seed = SQL.slice(SQL.indexOf('insert into public.v2cap_equipment (id, name, part, type, line, area, rarity, lv, spot, boss) values'))
  for (const it of CHALLENGE_ITEMS) assert.ok(seed.includes(`('${it.id}', '${it.name}', `) && seed.includes(`, ${it.area}, 'L', ${it.lv}, null, '${it.bossKey}')`), it.id)
  assert.ok(SQL.includes('alter table public.v2cap_equipment add column if not exists boss text;'))
  assert.ok(SQL.indexOf('add column if not exists boss text;') < SQL.indexOf('insert into public.v2cap_equipment (id, name, part, type, line, area, rarity, lv, spot, boss) values'), '列を足してから入れる')
})
