// 挑戦（四凶）の報酬：特別な素材・専用装備・ユニーク（2026-11-06 ユーザー「4強の報酬を決めたい」→案に全部「推奨」）
//   同じ日（案のシートのあと）ユーザー「能力は問題ない」「レジェンダリーは必要レベル70、ユニークはレベル85って意味」
//   「難易度によって専用アイテムとレジェンダリーユニークのドロップ率も上げて」→「ハードは1.5倍」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import {
  CHALLENGE_TIER_AREA, CHALLENGE_DIFFS, CHALLENGE_GEAR_AREA, CHALLENGE_BONUS, CHALLENGE_MATS, CHALLENGE_GEAR_DEFS,
  CHALLENGE_UNIQUE_DEFS, CHALLENGE_UNIQUE_LV, CHALLENGE_UNIQUE_POINTS,
  CH_RATES, CH_MAT_HOST, CH_MAT_SOLO, CH_MAT_CHANCE_MIN, CH_MAT_CHANCE, CH_CRAFT_MATS, CH_CRAFT_GOLD_PER_LV,
} from './challengeDefs.js'
import {
  matKeyOf, matNameOf, matNameOfKey, chMatsOf, chMatBaseOf, chMatChanceOf, chMatMeanOf, challengeItemsOf, challengeUniqueOf, chCraftCostOf,
  chCraftErrorOf, chCraftTimesOf, chDropsOf, chRatesOf, rollChallengeDrops, CH_PARTS,
} from './challenge.js'
import {
  ITEMS, ITEM_BY_ID, CHALLENGE_ITEMS, CHALLENGE_UNIQUE_ITEMS, UNIQUE_ITEMS, UNIQUE_LV, KIND_BY_KEY, PARTS, ACCESSORY_TYPES, ARMOR_LINES,
  itemOf, reqLvOf, needLvOf, isChallenge, isChallengeUnique, isUnique, hasGearFx, sameGearKeyOf, challengeItemIdOf, challengeUniqueIdOf,
} from './equipment.js'
import { GEAR_NAMES } from './gearNames.js'
import { powerAt, statsAt, effectivePowerAt } from './gear.js'
import { canCraft, craftErrorOf, bulkPickable, SCRAP_YIELD } from './smith.js'
import { equippedItems, toFighter } from './loadout.js'
import { checkUnique, CHECK, CHECK_ITEMS } from './uniqueCheck.js'
import { DUNGEON_BOSSES, CHALLENGE_CATS, DIFF_KEYS, HELPER_REWARD_MIN_PCT, SOLO_REWARD_MULT, isDiffReady } from './dungeon.js'
import { INITIAL_STATS, bodyPowerAt } from './level.js'
import { RAID_EQUIP_NAMES } from '../../constants/raidEquipment.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SQL = read('../../../supabase_v2cap_core.sql')
const fnBody = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(m, `${name} が見つかる`)
  return m[0]
}
const BOSSES = CHALLENGE_CATS.flatMap(c => c.bosses)

test('段階：難易度ごとのエリア（倒すと必ずもらうエリアの装備）は dungeon.js の diffs と同じ・呼べる難易度は全部ある（ノーマル②・ハード⑤・2026-11-09 エキスパート⑧・マスター⑫）', () => {
  assert.deepEqual(CHALLENGE_TIER_AREA, { normal: 2, hard: 5, expert: 8, master: 12 })
  for (const b of BOSSES) {
    for (const d of DIFF_KEYS) {
      if (!isDiffReady(b, d)) { assert.equal(CHALLENGE_TIER_AREA[d], undefined, `${d}はまだ呼べない＝段階も無い`); continue }
      assert.equal(CHALLENGE_TIER_AREA[d], DUNGEON_BOSSES[b].diffs[d].area, `${b} ${d}`)
    }
  }
  assert.deepEqual(CHALLENGE_DIFFS, ['normal', 'hard', 'expert', 'master'])
})

test('【確定】特別な素材はボスごとに1つ（ユーザー「なんで難易度ごとに素材わかれてるの？専用装備、アイテムは全部一緒」）・名前は V1 の希少な素材（選んだ「今のハードの名前」）', () => {
  assert.deepEqual(Object.keys(CHALLENGE_MATS).sort(), [...BOSSES].sort())
  const names = BOSSES.map(b => matNameOf(b))
  assert.deepEqual(names, ['黒龍の逆鱗', '雨禍の心核', '神雷炉心', '閻魔の審判核'])
  assert.equal(matKeyOf('varuzenoku'), 'varuzenoku', '持ち物の鍵はボスのキー（難易度を付けない）')
  assert.equal(matNameOfKey('amaza'), '雨禍の心核')
  assert.equal(matNameOfKey('amaza:normal'), '雨禍の心核', '前の形の鍵でもボスの素材の名前')
  assert.equal(matNameOfKey('nope'), '素材')
  assert.equal(chMatsOf({ enma: 7 }, 'enma'), 7)
  assert.equal(chMatsOf(undefined, 'enma'), 0, 'SQLを流す前の行（challenge_mats が無い）は0')
  // 前の形の鍵（ボス:難易度）は SQL で同じボスの鍵へ足し合わせる（§23・alter table のすぐあと＝報酬を渡す関数より前）
  const at = SQL.indexOf("alter table public.v2cap_profiles add column if not exists challenge_mats jsonb not null default '{}'::jsonb;")
  const mig = SQL.indexOf('update public.v2cap_profiles p\n   set challenge_mats = (select coalesce(jsonb_object_agg(s.k, s.n), \'{}\'::jsonb)')
  assert.ok(at > 0 && mig > at && mig < SQL.indexOf('create or replace function public.v2cap_dungeon_pay_reward('), '列を足したあと・報酬の関数の前で足し合わせる')
  const m = SQL.slice(mig, SQL.indexOf(';', mig))
  assert.ok(m.includes("select split_part(e.key, ':', 1) as k,") && m.includes('group by 1') && m.includes("position(':' in k) > 0"), '「ボス:難易度」を「ボス」へ・前の形の鍵が無い行は触らない')
})

test('専用装備：V1 のレイドの交換所の12個をそのまま使う（名前）・ボスごとに3つ・種類は V2 にある', () => {
  assert.equal(CHALLENGE_GEAR_DEFS.length, 12)
  assert.deepEqual(new Set(CHALLENGE_GEAR_DEFS.map(d => d.name)), RAID_EQUIP_NAMES, 'V1 の12個（src/constants/raidEquipment.js）と同じ名前')
  for (const b of BOSSES) assert.equal(CHALLENGE_GEAR_DEFS.filter(d => d.boss === b).length, 3, b)
  for (const d of CHALLENGE_GEAR_DEFS) {
    assert.ok(KIND_BY_KEY[d.kind], `${d.name}：${d.kind} は V2 の種類`)
    assert.ok(d.text && d.v1, `${d.name}：能力の文と V1 の能力の控え`)
  }
  // ボスの中で種類は重ならない（id が「エリア：ボス：種類」なので）
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

test('【確定】専用装備は必要LV70の1つ（ユーザー「レジェンダリーは必要レベル70」）：⑪のレジェンダリー＋10・強化も同じ倍率', () => {
  assert.equal(CHALLENGE_BONUS, 10)
  assert.equal(CHALLENGE_GEAR_AREA, 11)
  assert.equal(reqLvOf(CHALLENGE_GEAR_AREA, 'L'), 70, '⑪のレジェンダリーが必要LV70')
  assert.equal(CHALLENGE_ITEMS.length, 12, 'ノーマルとハードで同じ装備（前は段階ごとに24個）')
  for (const it of CHALLENGE_ITEMS) {
    assert.equal(it.id, challengeItemIdOf(11, it.bossKey, it.kind))
    assert.equal(it.rarity, 'L')
    assert.equal(it.area, 11)
    assert.equal(it.lv, 70)
    assert.equal(needLvOf(it), 70)
    assert.equal(it.diff, undefined, '難易度で分けない')
    assert.equal(it.boss, DUNGEON_BOSSES[it.bossKey].name)
    const L = itemOf(11, 'L', it.kind)
    assert.deepEqual(it.dist, L.dist, '配分は V2 の同じ種類と同じ')
    assert.equal(powerAt(it, it.lv), powerAt(L, L.lv) + 10, `${it.id}`)
    for (const p of [1, 5, 10]) assert.ok(powerAt(it, it.lv, p) > powerAt(L, L.lv, p), `${it.id} +${p}`)
    const sum = Object.values(statsAt(it, it.lv)).reduce((a, b) => a + b, 0)
    assert.equal(sum, powerAt(it, it.lv), 'ステの合計＝戦闘力')
  }
  // 例（ユーザーに伝えた数）：LV70 で武器131・鎧89・装飾品59。LV40で着けると LV40 のレジェンダリー＋10（前のハードと同じ 86・60・40）
  assert.equal(powerAt(ITEM_BY_ID['C11:varuzenoku:両手剣'], 70), 131)
  assert.equal(powerAt(ITEM_BY_ID['C11:amaza:軽装鎧'], 70), 89)
  assert.equal(powerAt(ITEM_BY_ID['C11:amaza:リング'], 70), 59)
  assert.equal(effectivePowerAt(ITEM_BY_ID['C11:varuzenoku:両手剣'], 70, 40), 86)
  assert.equal(effectivePowerAt(ITEM_BY_ID['C11:amaza:リング'], 70, 25), 31, 'LV25なら前のノーマルと同じ')
})

test('専用装備は ID からは引けるが、落ちる・作る一覧（ITEMS）には入らない／見分け', () => {
  for (const it of CHALLENGE_ITEMS) {
    assert.equal(ITEM_BY_ID[it.id], it)
    assert.ok(!ITEMS.includes(it))
    assert.ok(isChallenge(it) && hasGearFx(it) && !isUnique(it) && !isChallengeUnique(it))
  }
  assert.ok(!isChallenge(ITEMS[0]) && !hasGearFx(ITEMS[0]))
  assert.equal(ITEM_BY_ID['C2:varuzenoku:両手剣'], undefined, '前の段階ごとの id はもう無い（SQL で C11 へ付け替えた）')
  assert.equal(ITEM_BY_ID['C5:varuzenoku:両手剣'], undefined)
  assert.notEqual(sameGearKeyOf(ITEM_BY_ID['C11:zerugiasu:イヤリング']), sameGearKeyOf(ITEM_BY_ID['C11:amaza:リング']))
  assert.deepEqual(challengeItemsOf('enma').map(i => i.name), ['冥獄宝珠・断罪', '冥府王の獄衣', '六道輪廻の数珠'])
  assert.deepEqual(challengeItemsOf('nope'), [])
})

test('着けると能力が戦闘へ渡る・同じ専用装備（同じ名前）は1つまで', () => {
  const prof = { username: 't', class: '盗賊', lv: 70, ...INITIAL_STATS, jobs: { 盗賊: { lv: 1, exp: 0 } }, learned: [], skill_sets: {},
    equipped: { acc1: 1, acc2: 2, body: 3 } }
  const inv = [
    { id: 1, base_id: 'C11:zerugiasu:イヤリング', ilv: 70, plus: 0 },
    { id: 2, base_id: 'C11:zerugiasu:イヤリング', ilv: 70, plus: 3 },
    { id: 3, base_id: 'C11:enma:軽装鎧', ilv: 70, plus: 0 },
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

test('作成：そのボスの素材50個＋Gold 必要LV×200・残骸の作成では作れない・まとめての分解に入らない', () => {
  assert.equal(CH_CRAFT_MATS, 50)
  assert.equal(CH_CRAFT_GOLD_PER_LV, 200)
  const it = ITEM_BY_ID['C11:amaza:杖']
  assert.deepEqual(chCraftCostOf(it), { key: 'amaza', name: '雨禍の心核', mats: 50, gold: 14000 })
  assert.equal(chCraftCostOf(itemOf(11, 'L', '杖')), null, 'エリアの装備は挑戦装備では作れない')
  assert.equal(chCraftErrorOf(it, { gold: 99999, challenge_mats: { amaza: 49 } }), '雨禍の心核が足りません')
  assert.equal(chCraftErrorOf(it, { gold: 13999, challenge_mats: { amaza: 50 } }), 'Goldが足りません')
  assert.equal(chCraftErrorOf(it, { gold: 14000, challenge_mats: { amaza: 50 } }), null)
  assert.equal(chCraftErrorOf(it, { gold: 14000, challenge_mats: { enma: 50 } }), '雨禍の心核が足りません', 'ほかのボスの素材では作れない')
  assert.equal(chCraftTimesOf(it, { gold: 30000, challenge_mats: { amaza: 160 } }), 2)
  assert.ok(!canCraft(it))
  assert.equal(craftErrorOf(it, { gold: 1e9, materials: { 11: 1e6 } }), 'この装備は「挑戦装備」で作ります')
  assert.ok(!bulkPickable({ inv: { id: 1, plus: 0 }, item: it }, new Set()), 'まとめての分解に入れない')
  assert.equal(SCRAP_YIELD[it.rarity], 25, '分解はレジェンダリーと同じ（⑪の残骸）')
  // サーバー：v2cap_craft_challenge（装備だけ受け取る・素材はそのボスのもの）・v2cap_craft は弾く（同じ文）
  const c = fnBody('v2cap_craft_challenge')
  assert.ok(c.startsWith('create or replace function public.v2cap_craft_challenge(p_equip_id text)'))
  assert.ok(c.includes(`c_mats        constant int := ${CH_CRAFT_MATS};`) && c.includes(`c_gold_per_lv constant int := ${CH_CRAFT_GOLD_PER_LV};`))
  assert.ok(c.includes('v_key  := v_eq.boss;'), '素材の鍵は matKeyOf と同じ（ボスのキー）')
  assert.ok(!c.includes('p_diff'), '使う素材の難易度は選ばない')
  assert.ok(c.includes("or v_eq.rarity <> 'L' then return jsonb_build_object('ok', false, 'error', 'その装備はありません')"), 'ユニークは作れない')
  assert.ok(c.includes("if v_have < c_mats then return jsonb_build_object('ok', false, 'error', '素材が足りません'); end if;"))
  assert.ok(c.indexOf('v_have < c_mats') < c.indexOf('v_row.gold < v_gold'), '見る順は 素材→Gold（chCraftErrorOf と同じ）')
  assert.ok(SQL.includes('drop function if exists public.v2cap_craft_challenge(text, text);'), 'その前の版（素材の難易度を選ぶ・引数2つ）は消す')
  assert.ok(!SQL.includes('drop function if exists public.v2cap_craft_challenge(text);'), 'いまの版（引数1つ）を消す行は無い')
  assert.ok(SQL.includes('grant execute on function public.v2cap_craft_challenge(text) to authenticated;'))
  assert.ok(fnBody('v2cap_craft').includes("if v_eq.boss is not null then\n    return jsonb_build_object('ok', false, 'error', 'この装備は「挑戦装備」で作ります');"))
})

test('前の版の専用装備（C2:…・C5:…）を持っている人は C11:… へ付け替える（SQL・§28）', () => {
  const at = SQL.indexOf('===== 28. 挑戦')
  const s = SQL.slice(at)
  const up = s.indexOf("update public.v2cap_inventory i\n   set base_id = 'C11:' || split_part(i.base_id, ':', 2) || ':' || split_part(i.base_id, ':', 3)")
  const del = s.indexOf('delete from public.v2cap_equipment e')
  assert.ok(up > 0 && del > up, '付け替えてから古い行を消す')
  assert.ok(s.includes("where split_part(i.base_id, ':', 1) in ('C2', 'C5')"))
  assert.ok(s.includes("where split_part(e.id, ':', 1) in ('C2', 'C5') and e.boss is not null"), '消すのは前の専用装備の行だけ')
  assert.ok(s.includes('and not exists (select 1 from public.v2cap_inventory i where i.base_id = e.id)'), '持ち物が残っている行は消さない')
  // 種の C11 の行は §2（付け替えより前）にある
  assert.ok(SQL.indexOf("('C11:varuzenoku:両手剣', 'ヴァルブレイカー', ") < at)
})

test('【確定】落とし方：難易度ごとの確率（ハードは1.5倍）。サーバーの v2cap_dungeon_pay_reward の数は challengeDefs.js と同じ', () => {
  assert.deepEqual(CH_RATES, {
    normal: { gear: { R: 75, E: 20, L: 5 }, own: 2, unique: 0.1 },
    hard: { gear: { R: 72, E: 20, L: 8 }, own: 3, unique: 0.15 },
    // 【確定】2026-11-09 ユーザー選択「1.5倍ずつ（推奨）」
    expert: { gear: { R: 68, E: 20, L: 12 }, own: 4.5, unique: 0.22 },
    master: { gear: { R: 62, E: 20, L: 18 }, own: 6.75, unique: 0.34 },
  }, 'ユーザーが選んだ「ハードは1.5倍」（ノーマルは前のまま）・エキスパートとマスターも1.5倍ずつ')
  assert.deepEqual(Object.keys(CH_RATES), CHALLENGE_DIFFS, '呼べる難易度の数だけ')
  for (const d of CHALLENGE_DIFFS) {
    const g = CH_RATES[d].gear
    assert.equal(g.R + g.E + g.L, 100)
    assert.equal(chRatesOf(d), CH_RATES[d])
  }
  assert.equal(chRatesOf('nightmare'), null, '無い難易度')
  const p = fnBody('v2cap_dungeon_pay_reward')
  const rates = JSON.parse(p.match(/c_rates {6}constant jsonb := '([^']+)';/)[1])
  assert.deepEqual(Object.keys(rates), CHALLENGE_DIFFS)
  for (const d of CHALLENGE_DIFFS) {
    assert.deepEqual(rates[d], { r: CH_RATES[d].gear.R, e: CH_RATES[d].gear.E, own: CH_RATES[d].own, uq: CH_RATES[d].unique }, d)
  }
  assert.ok(p.includes("v_rate := coalesce(c_rates -> v_run.diff, c_rates -> 'normal');"))
  // 部位・装飾品・防具の系統は equipment.js と同じ並び
  assert.deepEqual(CH_PARTS, PARTS)
  assert.ok(p.includes(`(array['${PARTS.join("', '")}'])[1 + floor(random() * ${PARTS.length})::int]`))
  assert.ok(p.includes(`(array['${ACCESSORY_TYPES.join("', '")}'])[1 + floor(random() * ${ACCESSORY_TYPES.length})::int]`))
  assert.ok(p.includes(`(array['${ARMOR_LINES.join("', '")}'])[1 + floor(random() * ${ARMOR_LINES.length})::int] || v_part`))
  assert.ok(p.includes("if random() * 100 < (v_rate ->> 'own')::numeric * v_pct / 100.0 then"), '救援の人は専用装備の確率にも割合を掛ける')
  assert.ok(p.includes("where e.boss = v_run.boss and e.rarity = 'L' order by random() limit 1"), '専用装備はそのボスの3つから（どの難易度でも同じ）')
  assert.ok(p.includes("if random() * 100 < (v_rate ->> 'uq')::numeric * v_pct / 100.0 then"), 'ユニークも救援の人は割合を掛ける')
  assert.ok(p.includes("where e.rarity = 'U' and split_part(e.id, ':', 1) = 'UC' and split_part(e.id, ':', 2) = v_run.boss limit 1"), 'ユニークはそのボスの1つ')
  assert.ok(p.indexOf("(v_rate ->> 'own')") < p.indexOf("(v_rate ->> 'uq')"), '引く順は rollChallengeDrops と同じ（専用装備→ユニーク）')
  assert.ok(p.includes("'gear', v_gear, 'mat', v_mat, 'own', v_own, 'uq', v_uq"), '画面（chDropsOf）が読む形で返す')
  assert.ok(SQL.includes("alter table public.v2cap_profiles add column if not exists challenge_mats jsonb not null default '{}'::jsonb;"))
})

test('【確定】素材の数（ユーザー「まず自分がホストの場合1個確定」「完全ソロ討伐で確定1つ」「貢献度が10%以上で確率で1つ、難易度によって上がる ノーマル10% ハード20% expert40% master60」＝足し合わせ）', () => {
  assert.equal(CH_MAT_HOST, 1)
  assert.equal(CH_MAT_SOLO, 1)
  assert.equal(CH_MAT_CHANCE_MIN, 10)
  assert.deepEqual(CH_MAT_CHANCE, { normal: 10, hard: 20, expert: 40, master: 60 })
  assert.deepEqual(Object.keys(CH_MAT_CHANCE), DIFF_KEYS, '難易度は4つとも決めてある')
  assert.equal(chMatBaseOf({ owner: true, solo: false }), 1, 'ホストなら1個')
  assert.equal(chMatBaseOf({ owner: true, solo: true }), 2, '完全ソロ討伐ならさらに1個')
  assert.equal(chMatBaseOf({ owner: false }), 0, '救援の人に確定は無い')
  assert.equal(chMatChanceOf('hard', 10), 20, '貢献度10%ちょうどは入る')
  assert.equal(chMatChanceOf('hard', 9.9), 0, '10%未満は確率なし')
  assert.equal(chMatChanceOf('master', 50), 60)
  assert.equal(chMatMeanOf({ diff: 'normal', owner: true, solo: true }), 2.1, 'ひとりで倒すと平均2.1個（約24回で50個）')
  assert.equal(chMatMeanOf({ diff: 'hard', owner: true, solo: true }), 2.2)
  assert.equal(chMatMeanOf({ diff: 'normal', owner: true, solo: false, contrib: 5 }), 1, '救援の人に削ってもらって自分が10%未満なら確定の1個だけ')
  assert.equal(chMatMeanOf({ diff: 'hard', owner: false, contrib: 30 }), 0.2, '救援の人（30%削った）はハードで20%')
  // SQL も同じ（数・確率・10%の線・足し合わせ・鍵はボス）
  const p = fnBody('v2cap_dungeon_pay_reward')
  assert.ok(p.includes(`c_mat_host   constant int := ${CH_MAT_HOST};`) && p.includes(`c_mat_solo   constant int := ${CH_MAT_SOLO};`))
  assert.ok(p.includes(`c_mat_min_contrib constant numeric := ${CH_MAT_CHANCE_MIN};`))
  assert.deepEqual(JSON.parse(p.match(/c_mat_chance constant jsonb := '([^']+)';/)[1]), CH_MAT_CHANCE)
  assert.ok(p.includes('v_n := (case when v_mem.is_owner then c_mat_host else 0 end) + (case when v_solo then c_mat_solo else 0 end);'), 'chMatBaseOf と同じ（完全ソロ討伐は EXP・Gold が3倍になる v_solo と同じ）')
  assert.ok(p.includes('if v_mem.damage * 100.0 / greatest(1, v_run.hp_max) >= c_mat_min_contrib then'), '貢献度は自分のダメージ÷最大HP（救援の最低3割は使わない）')
  assert.ok(p.includes('if random() * 100 < coalesce((c_mat_chance ->> v_run.diff)::numeric, 0) then v_n := v_n + 1; end if;'))
  assert.ok(p.includes('v_key := v_run.boss;'), '素材の鍵はボスのキー（matKeyOf と同じ）')
  assert.ok(!/c_mat_pct|c_mat_min |c_mat_max/.test(p), '前の「50%で1〜5個」は無い')
})

test('落とし方：難易度ごとの抽選の割合（乱数を回して見る）', () => {
  // 乱数を回して割合を見る（シードつき）
  let s = 1234567   // mulberry32（続けて引いても偏らない）
  const rng = () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const N = 60000
  for (const diff of CHALLENGE_DIFFS) {
    const want = CH_RATES[diff]
    const n = { R: 0, E: 0, L: 0, extra: 0, badMat: 0, own: 0, uq: 0, weapon: 0 }
    for (let i = 0; i < N; i++) {
      const r = rollChallengeDrops({ diff, weapons: ['短剣', '投擲', '刀'] }, rng)
      n[r.gear.rarity]++
      if (r.gear.area !== CHALLENGE_TIER_AREA[diff]) throw new Error(`${diff}＝その段階のエリアの装備`)
      if (ITEM_BY_ID[`${r.gear.area}${r.gear.rarity}:${r.gear.kind}`] == null) throw new Error(`${r.gear.kind} の装備がある`)
      if (PARTS.indexOf(KIND_BY_KEY[r.gear.kind].part) === 0) { n.weapon++; assert.ok(['短剣', '投擲', '刀'].includes(r.gear.kind), 'いまの職業の武器') }
      if (r.mat === 2) n.extra++   // ホスト（ソロでない・貢献度100）＝確定1個＋確率で1個
      else if (r.mat !== 1) n.badMat++
      if (r.own) n.own++
      if (r.uq) n.uq++
    }
    const near = (got, w, tol) => assert.ok(Math.abs(got / N * 100 - w) < tol, `${diff}：${got / N * 100} ≈ ${w}`)
    near(n.R, want.gear.R, 1.5); near(n.E, want.gear.E, 1.5); near(n.L, want.gear.L, 0.8)
    near(n.extra, CH_MAT_CHANCE[diff], 0.8); near(n.own, want.own, 0.5); near(n.uq, want.unique, 0.08); near(n.weapon, 100 / 6, 1.2)
    assert.equal(n.badMat, 0, 'ホストは1個か2個')
  }
  // 完全ソロ討伐は2個か3個（ハードは20%で3個）・救援の人で貢献度10%未満は0個
  let solo3 = 0, helper = 0
  for (let i = 0; i < N; i++) {
    const r = rollChallengeDrops({ diff: 'hard', solo: true, weapons: ['杖'] }, rng)
    if (r.mat === 3) solo3++
    else assert.equal(r.mat, 2)
    if (rollChallengeDrops({ diff: 'hard', owner: false, pct: 30, contrib: 5, weapons: ['杖'] }, rng).mat) helper++
  }
  assert.ok(Math.abs(solo3 / N * 100 - 20) < 0.8, `${solo3 / N * 100}`)
  assert.equal(helper, 0)
  // 救援の人（割合30%）は装備も専用装備も3割の確率
  let g = 0
  for (let i = 0; i < N; i++) if (rollChallengeDrops({ diff: 'normal', pct: 30, weapons: ['杖'] }, rng).gear) g++
  assert.ok(Math.abs(g / N * 100 - 30) < 1.5)
  assert.deepEqual(rollChallengeDrops({ diff: 'nightmare' }, rng), { gear: null, mat: 0, own: false, uq: false, stone4: 0 }, 'まだ無い段階は何も落とさない')
})

test('報酬の画面に出す行（chDropsOf）：装備・素材・専用装備・ユニークの順・無いものは出さない', () => {
  const r = { exp: 1, gold: 1, gear: { id: 9, base_id: '5E:片手剣', ilv: 35 }, mat: { key: 'zerugiasu', n: 2 },
    own: { id: 10, base_id: 'C11:zerugiasu:短剣', ilv: 70 }, uq: { id: 11, base_id: 'UC:zerugiasu:ベルト', ilv: 85 } }
  assert.deepEqual(chDropsOf(r).map(x => x.kind), ['gear', 'mat', 'own', 'uq'])
  assert.equal(chDropsOf(r)[1].name, '神雷炉心')
  assert.equal(chDropsOf(r)[2].item.name, '蒼雷の短刃')
  assert.equal(chDropsOf(r)[3].item.name, 'ドンナーカイル')
  assert.deepEqual(chDropsOf({ exp: 1, gold: 1 }), [], 'SQL を流す前の返事（gear が無い）でも壊れない')
  assert.deepEqual(chDropsOf({ gear: null, mat: null, own: null, uq: null }), [])
  assert.deepEqual(chDropsOf(null), [])
  // 2026-11-09〜 至高の強化石（stone4）は素材の行でいちばん下
  assert.deepEqual(chDropsOf({ ...r, stone4: 1 }).at(-1), { kind: 'mat', name: '至高の強化石', n: 1 })
  assert.deepEqual(chDropsOf({ stone4: null }), [])
  // 画面の文字とコード（説明のコメントは除く）
  const screen = read('../components/V2capBossReward.jsx')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n')
  assert.ok(screen.includes('{chDropsOf(reward).map((x, i) => ('), '報酬の欄に出す')
  assert.ok(screen.includes("x.kind === 'gear' || x.kind === 'uq' ? '装備'"), 'ユニークの札は「装備」（名前だけユニークの赤・ユーザー「ユニークの文言いらない」）')
  assert.ok(!/ユニーク/.test(screen), '画面に「ユニーク」と書かない')
  assert.ok(!/3倍|×3|CH_MAT_SOLO_MULT/.test(screen), 'ソロ討伐の倍率は書かない（ユーザー「具体的な内容は言わないで」）')
})

test('【確定】ユニーク（四凶ごとに1つ）：4つとも装飾品・必要LV85・ステは LV85 で69（LV80 で前の60個と同じ65）', () => {
  assert.equal(CHALLENGE_UNIQUE_ITEMS.length, 4)
  assert.deepEqual(CHALLENGE_UNIQUE_ITEMS.map(u => u.bossKey).sort(), [...BOSSES].sort(), '四凶ごとに1つ')
  assert.deepEqual(CHALLENGE_UNIQUE_ITEMS.map(u => u.kind).sort(), [...ACCESSORY_TYPES].sort(), '装飾品の4種類に1つずつ（ユーザー「全部アクセにしてほしい、誰でも装備できるように」）')
  assert.deepEqual(CHALLENGE_UNIQUE_ITEMS.map(u => u.name), ['焔環ツォルン', '小糠雨の耳飾り', 'ドンナーカイル', '業秤の首飾り'])
  assert.equal(CHALLENGE_UNIQUE_LV, 85)
  // 69＝前の60個の装飾品65（LV80）を、装備の強さと同じ割合でLV85にのばした数
  assert.equal(CHALLENGE_UNIQUE_POINTS, Math.round(65 * bodyPowerAt(85) / bodyPowerAt(UNIQUE_LV)))
  for (const u of CHALLENGE_UNIQUE_ITEMS) {
    assert.equal(u.id, challengeUniqueIdOf(u.bossKey, u.kind))
    assert.equal(u.part, 'アクセ')
    assert.equal(u.rarity, 'U')
    assert.equal(u.lv, 85)
    assert.equal(needLvOf(u), 85)
    assert.equal(u.area, CHALLENGE_GEAR_AREA, '強化と分解の残骸は専用装備と同じ⑪')
    assert.equal(u.boss, DUNGEON_BOSSES[u.bossKey].name, '画面は「〇〇が落とす」')
    assert.equal(Object.values(u.dist).reduce((a, b) => a + b, 0), CHALLENGE_UNIQUE_POINTS, `${u.name} のステの合計`)
    assert.equal(powerAt(u, 85), 69)
    assert.deepEqual(statsAt(u, 85, 85), { hp: 0, mp: 0, str: 0, dex: 0, agi: 0, int_stat: 0, vit: 0, luk: 0, ...u.dist }, 'LV85 では決めたステのまま')
    assert.equal(effectivePowerAt(u, 85, 80), 65, 'LV80 で着けると前の60個の装飾品と同じ')
    assert.equal(powerAt(u, 85, 10), 138, '+10 で2倍')
    assert.ok(isUnique(u) && isChallengeUnique(u) && hasGearFx(u) && !isChallenge(u), '扱いはユニーク（専用装備ではない）')
    assert.equal(sameGearKeyOf(u), u.id)
    assert.equal(challengeUniqueOf(u.bossKey), u)
    assert.equal(ITEM_BY_ID[u.id], u)
    assert.ok(!UNIQUE_ITEMS.includes(u) && !ITEMS.includes(u), '出撃のボスが落とす60個・作る一覧には入れない')
    assert.ok(!canCraft(u))
    assert.equal(craftErrorOf(u, { gold: 1e9, materials: { 11: 1e6 } }), 'ユニークの装備は作れません')
    assert.equal(chCraftCostOf(u, 'normal'), null, '挑戦装備でも作れない')
    assert.ok(!bulkPickable({ inv: { id: 1, plus: 0 }, item: u }, new Set()))
  }
  // 名前はほかの装備とかぶらない
  const others = new Set([...Object.values(GEAR_NAMES).flatMap(t => Object.values(t).flat()), ...UNIQUE_ITEMS.map(u => u.name), ...CHALLENGE_GEAR_DEFS.map(d => d.name)])
  for (const u of CHALLENGE_UNIQUE_DEFS) assert.ok(!others.has(u.name), u.name)
  // 種：ユニークの行は boss が null（ほかのユニークと同じ＝作成・博物館はレア度 U で弾く）
  for (const u of CHALLENGE_UNIQUE_ITEMS) assert.ok(SQL.includes(`('${u.id}', '${u.name}', 'アクセ', '${u.kind}', null, 11, 'U', 85, null, null)`), u.id)
})

test('【確定】ユニーク4つの能力（ユーザー「能力は問題ない」＝シートの案のまま）は、本物の戦闘エンジンで発動する（新しい項目4つ）', () => {
  const want = {
    焔環ツォルン: { lostHpDeal: { per: 10, pct: 4, max: 36 } },
    小糠雨の耳飾り: { evaBonus: 10, dodgeAil: [{ key: 'slow', chance: 30 }] },
    ドンナーカイル: { onHitAils: [{ key: 'paralyze', chance: 20 }], breakAil: { key: 'paralyze', pct: 50 } },
    業秤の首飾り: { perAilDeal: { pct: 8, max: 32 } },
  }
  for (const u of CHALLENGE_UNIQUE_ITEMS) {
    assert.deepEqual(u.fx, want[u.name], u.name)
    const r = checkUnique(u)
    assert.ok(r.ok, `${u.name}：${r.checks.filter(c => !c.ok).map(c => `${c.key} ${c.detail}`).join('／')}`)
    for (const k of Object.keys(u.fx)) assert.ok(CHECK[k], `${u.name} の ${k} の確かめ方`)
  }
  assert.ok(CHALLENGE_UNIQUE_ITEMS.every(u => CHECK_ITEMS.includes(u)), '開発用の欄の「ユニークの能力を確かめる」にも出す')
  // 新しい項目は battleSet.js の冒頭の一覧に書いてある・挑戦（ATB）も同じ takeAction を通る
  const set = read('../core/battleSet.js')
  for (const k of ['lostHpDeal', 'dodgeAil', 'breakAil', 'perAilDeal']) assert.ok(set.includes(`//   ${k} `), `${k} の説明`)
  const battle = read('../core/battle.js')
  assert.ok(battle.includes('uniqueDodged(foe, uLog, me, rng)'), 'スキルと通常攻撃の両方で、かわした相手へ状態異常')
  assert.equal((battle.match(/if \(me\.uq\) uniqueBreak\(me, foe, /g) || []).length, 2, 'スキルと通常攻撃の両方で麻痺を消す')
  assert.ok(read('../core/atb.js').includes('takeAction'), 'ATB は battle.js の takeAction をそのまま呼ぶ')
})

test('流す追加分（作業フォルダ直下の v2cap_challenge_reward3_20261106.sql・あれば）は全文と同じ', () => {
  const url = new URL('../../../v2cap_challenge_reward3_20261106.sql', import.meta.url)
  if (!existsSync(url)) return
  const delta = readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
  const fns = [...delta.matchAll(/create or replace function public\.\w+\([\s\S]*?\n\$\$;/g)].map(m => m[0])
  assert.deepEqual(fns.map(f => f.match(/function public\.(\w+)/)[1]), ['v2cap_dungeon_pay_reward', 'v2cap_craft_challenge'])
  // ★あとで出した追加分（ファイル名の日付が後のもの）で同じ関数を作り直していれば、その関数はそちらでくらべる（2026-11-09 +20 で報酬の関数を作り直した）
  const root = new URL('../../../', import.meta.url)
  const later = readdirSync(root).filter(n => /^v2cap_\w+_(\d{8})\.sql$/.test(n) && n.match(/_(\d{8})\.sql$/)[1] > '20261106')
  const redefinedLater = (name) => later.some(n => readFileSync(new URL(n, root), 'utf8').includes(`create or replace function public.${name}(`))
  for (const f of fns) {
    const name = f.match(/function public\.(\w+)/)[1]
    if (redefinedLater(name)) continue
    assert.ok(SQL.includes(f), `${name} は全文と同じ`)
  }
  const mig = SQL.match(/update public\.v2cap_profiles p\n   set challenge_mats = \(select[\s\S]*?;\n/)[0]
  assert.ok(delta.includes(mig), '素材の鍵の足し合わせは全文と同じ')
  assert.ok(delta.indexOf(mig) < delta.indexOf('create or replace function public.v2cap_craft_challenge('), '足し合わせてから作成の関数')
  assert.ok(delta.includes('drop function if exists public.v2cap_craft_challenge(text, text);'))
  for (const line of delta.split(/\r?\n/).filter(l => /^(alter table|revoke|grant|drop function) /.test(l))) assert.ok(SQL.includes(line), line)
})

test('博物館：専用装備は数えない・寄贈できない（エリアのレジェンダリーがそろわなくならない）', () => {
  const settle = fnBody('v2cap_museum_settle')
  assert.equal((settle.match(/and e\.rarity in \('N', 'R', 'E', 'L'\) and e\.boss is null/g) || []).length, 2, '要る数（need）と登録した数（have）の両方で外す')
  // 種：専用装備の行に boss が入っている・ほかの行は null
  const seed = SQL.slice(SQL.indexOf('insert into public.v2cap_equipment (id, name, part, type, line, area, rarity, lv, spot, boss) values'))
  for (const it of CHALLENGE_ITEMS) assert.ok(seed.includes(`('${it.id}', '${it.name}', `) && seed.includes(`, ${it.area}, 'L', ${it.lv}, null, '${it.bossKey}')`), it.id)
  assert.ok(SQL.includes('alter table public.v2cap_equipment add column if not exists boss text;'))
  assert.ok(SQL.indexOf('add column if not exists boss text;') < SQL.indexOf('insert into public.v2cap_equipment (id, name, part, type, line, area, rarity, lv, spot, boss) values'), '列を足してから入れる')
})
