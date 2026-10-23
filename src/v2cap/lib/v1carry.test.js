// v2cap：V1からの引き継ぎ（2026-10-23・ユーザー決定）を固定するテスト（node --test）
//   決まりは docs/v2cap-design.md §6-11。サーバー（supabase_v2cap_core.sql の v2cap_v1_carry・v2cap_apply_exp・v2cap_v1_ticket_use）と
//   写し（v1carry.js）を突き合わせる
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  V1_EXP_BASE, V1_EXP_FROM, V1_EXP_STEP, V1_EXP_MAX_LV, v1ExpBoostOf, v1BoostOn, v1BoostedExp, multLabel,
  V1_BOSS_UNIQUE, V1_WEAPON_KINDS, V1_ARMOR_PARTS, V1_ACC_PART, V1_TICKET_MAX, ticketOf, canUseTicket,
  V1_BOX_SCRAP, V1_BOX_NAMES, carryLines,
} from './v1carry.js'
import { UNIQUE_ITEMS } from './equipment.js'
import { PLUS_CAP, PLUS_MAX } from './smith.js'
import { BOSS_LINES } from '../../constants/bossEvolution.js'

const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
const fnOf = (name) => {
  const a = SQL.indexOf(`create or replace function public.${name}(`)
  assert.ok(a >= 0, `${name} がある`)
  const b = SQL.indexOf('\n$$;', a)
  return SQL.slice(a, b)
}
const CARRY = fnOf('v2cap_v1_carry')
const APPLY = fnOf('v2cap_apply_exp')
const TICKET = fnOf('v2cap_v1_ticket_use')
const CREATE = fnOf('v2cap_create_character')
const arrOf = (body, name) => {
  const m = body.match(new RegExp(`${name}\\s+constant text\\[\\] := array\\[([^\\]]*)\\]`))
  assert.ok(m, `${name} の配列がある`)
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1])
}
const constOf = (body, name) => {
  const m = body.match(new RegExp(`${name}\\s+constant int := (\\d+);`))
  assert.ok(m, `${name} がある`)
  return Number(m[1])
}

test('【確定】EXP：V1のLV÷10（最大LV50）まで×1.5・V1のLV500から200ごとに+0.1（ユーザーの例 LV700で×1.6）', () => {
  assert.deepEqual(v1ExpBoostOf(100), { mult: 15, until: 10 })
  assert.deepEqual(v1ExpBoostOf(300), { mult: 15, until: 30 })
  assert.deepEqual(v1ExpBoostOf(499), { mult: 15, until: 49 })
  assert.deepEqual(v1ExpBoostOf(500), { mult: 15, until: 50 })
  assert.deepEqual(v1ExpBoostOf(699), { mult: 15, until: 50 })
  assert.deepEqual(v1ExpBoostOf(700), { mult: 16, until: 50 }, 'ユーザーの例')
  assert.deepEqual(v1ExpBoostOf(900), { mult: 17, until: 50 })
  assert.deepEqual(v1ExpBoostOf(1500), { mult: 20, until: 50 })
  assert.deepEqual(v1ExpBoostOf(19), { mult: 0, until: 0 }, 'LV1に着くまで＝掛からないので無し')
  assert.deepEqual(v1ExpBoostOf(20), { mult: 15, until: 2 })
  assert.deepEqual(v1ExpBoostOf(null), { mult: 0, until: 0 })
  assert.equal(multLabel(16), '×1.6')
})

test('EXPの倍率はLVが着くまでだけ・四捨五入（サーバーと同じ式）', () => {
  const p = { lv: 9, v1_exp_mult: 15, v1_exp_until: 10 }
  assert.equal(v1BoostOn(p), true)
  assert.equal(v1BoostedExp(10, p), 15)
  assert.equal(v1BoostedExp(3, p), 5, '4.5→5')
  assert.equal(v1BoostedExp(1, p), 2, '1.5→2')
  assert.equal(v1BoostedExp(0, p), 0)
  assert.equal(v1BoostedExp(10, { ...p, lv: 10 }), 10, 'LV10に着いたら掛からない')
  assert.equal(v1BoostedExp(10, { lv: 1 }), 10, '引き継ぎが無いキャラはそのまま')
  assert.equal(v1BoostedExp(7, { lv: 1, v1_exp_mult: 16, v1_exp_until: 50 }), 11, '11.2→11')
})

test('SQLの v2cap_v1_carry は写しと同じ数（×1.5・LV500・200ごと・LV50まで・券+16・箱の数）', () => {
  assert.equal(constOf(CARRY, 'c_exp_base'), V1_EXP_BASE)
  assert.equal(constOf(CARRY, 'c_exp_lv'), V1_EXP_FROM)
  assert.equal(constOf(CARRY, 'c_exp_step'), V1_EXP_STEP)
  assert.equal(constOf(CARRY, 'c_exp_max'), V1_EXP_MAX_LV)
  assert.equal(constOf(CARRY, 'c_plus_cap'), V1_TICKET_MAX)
  assert.equal(constOf(TICKET, 'c_plus_cap'), V1_TICKET_MAX)
  assert.equal(V1_TICKET_MAX, PLUS_CAP)
  assert.ok(PLUS_CAP > PLUS_MAX, '券はふつうの強化の上限より上まで入る（ユーザー「+10以降も反映させていい」）')
  assert.ok(CARRY.includes('v_until := least(c_exp_max, v_clv / 10);'), 'V1のLV÷10（最大LV50）')
  assert.ok(CARRY.includes('if v_until >= 2 then'), 'LV2から（v1ExpBoostOf と同じ）')
  assert.ok(CARRY.includes('(v_clv - c_exp_lv) / c_exp_step'), '200ごとに+0.1')
  assert.deepEqual(V1_BOX_SCRAP, { mystery: [1, 3], strange: [5, 10] })
  assert.ok(CARRY.includes("+ 1 + floor(random() * 3)::int;   -- 1〜3"), '不思議な箱＝1〜3')
  assert.ok(CARRY.includes("+ 5 + floor(random() * 6)::int;   -- 5〜10"), '奇妙な箱＝5〜10')
  assert.ok(CARRY.includes('v_a := 1 + floor(random() * c_areas)::int;'), 'エリアは15エリアからランダム（行ったことのあるエリアに限らない）')
  assert.equal(constOf(CARRY, 'c_areas'), 15)
  for (const n of Object.values(V1_BOX_NAMES)) assert.ok(CARRY.includes(`i.name = '${n}'`), `${n} を数える`)
  assert.ok(CARRY.includes("i.effect = 'mystery_box_v2'"), 'V1 の箱の目印（supabase_mystery_box_20260816.sql）')
  // V1 の表は読むだけ（書き換えない・消さない）
  for (const t of ['profiles', 'player_equipment', 'weapons', 'player_items', 'items']) {
    assert.ok(!new RegExp(`(update|delete from|insert into)\\s+public\\.${t}\\b`, 'i').test(CARRY), `V1 の ${t} を書き換えない`)
  }
})

test('V1のボス装備 → 同じボスのユニーク（16個）。名前は両方にあり、SQLと同じ並び', () => {
  const v1Names = new Set(BOSS_LINES.flatMap(l => l.equips.map(e => e.name)))
  const uniq = new Map(UNIQUE_ITEMS.map(u => [u.name, u]))
  assert.equal(V1_BOSS_UNIQUE.length, 16)
  for (const [v1, v2] of V1_BOSS_UNIQUE) {
    assert.ok(v1Names.has(v1), `${v1} は V1 のボス装備`)
    assert.ok(uniq.has(v2), `${v2} は v2cap のユニーク`)
    const line = BOSS_LINES.find(l => l.equips.some(e => e.name === v1))
    assert.equal(uniq.get(v2).boss, line.boss, `${v1} → ${v2} は同じボス（${line.boss}）`)
  }
  // 当たるものが無いのは2つだけ（同じ種類からランダム）
  const mapped = new Set(V1_BOSS_UNIQUE.map(([a]) => a))
  assert.deepEqual([...v1Names].filter(n => !mapped.has(n)).sort(), ['インフェルノバスティオン', '覇龍の聖鎧'].sort())
  assert.deepEqual(arrOf(CARRY, 'c_v1'), V1_BOSS_UNIQUE.map(([a]) => a))
  assert.deepEqual(arrOf(CARRY, 'c_v2'), V1_BOSS_UNIQUE.map(([, b]) => b))
})

test('同じものが無いときは同じ種類のユニークからランダム（武器種・防具・装飾品）。どの種類にもユニークがある', () => {
  const weaponTypes = new Set(UNIQUE_ITEMS.filter(u => u.part === '武器').map(u => u.type))
  for (const [t, kinds] of Object.entries(V1_WEAPON_KINDS)) {
    for (const k of kinds) assert.ok(weaponTypes.has(k), `${t} → ${k} のユニークがある`)
    for (const k of kinds) assert.ok(CARRY.includes(`when '${t}'`) && CARRY.includes(`'${k}'`), `SQL にも ${t} → ${k}`)
  }
  // SQL の case と写しが同じ（武器種ごとの並び）
  const sqlKinds = Object.fromEntries([...CARRY.matchAll(/when '([a-z]+)'\s+then array\[([^\]]*)\]/g)]
    .map(m => [m[1], [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1])]))
  assert.deepEqual(sqlKinds, V1_WEAPON_KINDS)
  // V1 の武器種（src/lib/stats.js の WEAPON_TYPE_GROUP）は全部どこかに当たる
  for (const t of ['sword', 'axe', 'spear', 'bow', 'dagger', 'knuckle', 'gun', 'katana', 'staff', 'wand', 'tome', 'orb']) {
    assert.ok(V1_WEAPON_KINDS[t], `V1 の ${t} に当たる武器種がある`)
  }
  assert.ok(UNIQUE_ITEMS.some(u => V1_ARMOR_PARTS.includes(u.part)), '防具のユニークがある')
  assert.ok(UNIQUE_ITEMS.some(u => u.part === V1_ACC_PART), '装飾品のユニークがある')
  assert.ok(CARRY.includes(`e.part in (${V1_ARMOR_PARTS.map(p => `'${p}'`).join(', ')})`), 'SQL の防具も同じ部位')
  assert.ok(CARRY.includes(`e.part = '${V1_ACC_PART}'`), 'SQL の装飾品も同じ')
  // いちばん強化値の高い装備（同じならレア度の高いほう）
  assert.ok(CARRY.includes('order by coalesce(pe.enhance_plus, 0) desc, coalesce(array_position(c_rank, lower(w.rarity)), 0) desc'), '選ぶ順')
  assert.deepEqual(arrOf(CARRY, 'c_rank'), ['f', 'e', 'd', 'c', 'b', 'a', 's', 'ss', 'sss'], 'V1 のレア度の並び（低い順）')
})

test('強化券：ユニークにだけ・いまの強化値が券より下のときだけ・1回だけ（使ったら0）', () => {
  const p = { v1_ticket: 12 }
  assert.equal(ticketOf(p), 12)
  assert.equal(ticketOf({ v1_ticket: 99 }), V1_TICKET_MAX)
  assert.equal(ticketOf({}), 0)
  assert.equal(canUseTicket({ rarity: 'U' }, 0, p), true)
  assert.equal(canUseTicket({ rarity: 'U' }, 12, p), false, '同じ強化値なら使えない')
  assert.equal(canUseTicket({ rarity: 'L' }, 0, p), false, 'ユニーク以外には使えない')
  assert.equal(canUseTicket({ rarity: 'U' }, 0, {}), false, '券が無ければ使えない')
  assert.ok(TICKET.includes("if v_eq.rarity is distinct from 'U' then"), 'サーバーもユニークだけ')
  assert.ok(TICKET.includes('if coalesce(v_inv.plus, 0) >= v_to then'), 'サーバーも券より下のときだけ')
  assert.ok(TICKET.includes('set v1_ticket = 0'), '使ったらなくなる')
  assert.ok(TICKET.includes('if not public.v2cap_is_dev() then'), '開発のゲート')
})

test('EXPの倍率は v2cap_apply_exp の1か所で掛け、入った量（gained）を返す。画面はどれも gained を出す', () => {
  assert.ok(APPLY.includes('v_gain := least(2000000000::bigint, (v_gain::bigint * v_row.v1_exp_mult + 5) / 10)::int;'), '四捨五入（v1BoostedExp と同じ）')
  assert.ok(APPLY.includes('v_row.lv < coalesce(v_row.v1_exp_until, 0)'), 'LVが着くまで')
  assert.ok(APPLY.includes("'gained', v_gain"), 'gained を返す')
  assert.ok(!/p_amount;/.test(APPLY.replace(/--.*$/gm, '')), 'LV と ClassEXP は掛けたあとの量（v_gain）で足す')
  // 出撃・塔・宝樹・デイリーの「EXP +◯」は gainedExpOf（精算の exp をそのまま出さない）
  const dir = new URL('../components/', import.meta.url)
  const files = readdirSync(dir).filter(f => f.endsWith('.jsx'))
  const uses = files.filter(f => readFileSync(new URL(f, dir), 'utf8').includes('gainedExpOf('))
  for (const f of ['V2capSortie.jsx', 'V2capTower.jsx', 'V2capTree.jsx', 'V2capRevelationFx.jsx', 'V2capDaily.jsx']) {
    assert.ok(uses.includes(f), `${f} は gainedExpOf で出す`)
    const src = readFileSync(new URL(f, dir), 'utf8')
    assert.ok(!/(data|result|got)\.exp\)/.test(src) && !/Number\((result|got)\.exp\)/.test(src), `${f} は精算の exp をそのまま出さない`)
  }
})

test('作成のときに引き継ぐ（v2cap_create_character の中で1回）。作成は管理者だけ＝公開まで一般の人には入らない', () => {
  assert.ok(CREATE.includes('v_carry := public.v2cap_v1_carry(v_uid);'), '作成で呼ぶ')
  assert.ok(CREATE.indexOf('if not public.v2cap_is_dev() then') < CREATE.indexOf('v2cap_v1_carry'), 'ゲートを通ったあと')
  assert.ok(CREATE.indexOf("if found then return jsonb_build_object('ok', true, 'already', true") < CREATE.indexOf('v2cap_v1_carry'), 'もういるキャラには入れない')
  assert.ok(SQL.includes('revoke all on function public.v2cap_v1_carry(uuid) from public, anon, authenticated;'), '中の関数は誰も直接呼べない')
  assert.ok(SQL.includes('grant execute on function public.v2cap_v1_ticket_use(bigint) to authenticated;'))
})

test('作成したあとの知らせの文', () => {
  const lines = carryLines({
    char_lv: 700, exp_mult: 16, exp_until: 50, item: { name: '深紅の牙輪', plus: 12 }, unique: { name: '深紅の牙輪' }, ticket: 12,
    boxes: { mystery: 30, strange: 2 }, scraps: { 3: 10, 1: 5 },
  }).map(l => l.text + (l.name || '') + (l.tail || ''))
  assert.deepEqual(lines, [
    '📈 V1のキャラLV700 → LV50になるまで、もらえるEXPが×1.6',
    '💎 V1の「深紅の牙輪」+12 → ユニーク「深紅の牙輪」を入手！',
    '🎫 強化券（+12）を入手！ ユニークの装備1つを、鍛冶屋の強化ですぐ+12にできます（1回だけ・失敗なし）',
    '🎁 不思議な箱×30・奇妙な箱×2 を開けた！',
    '　新緑の残骸×5 を獲得した！',
    '　洞窟の残骸×10 を獲得した！',
  ])
  assert.deepEqual(carryLines(null), [])
  assert.deepEqual(carryLines({ exp_until: 0, boxes: {}, scraps: {} }), [])
})
