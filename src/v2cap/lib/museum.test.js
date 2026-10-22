// 「レベルキャップあり」版：博物館（装備の寄贈・2026-10-22 ユーザー指示「とりあえず土台だけ」）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MUSEUM_TIERS, tierOfPlus, MUSEUM_GROUPS, MUSEUM_ITEMS, raritiesOfGroup, museumKey, registeredSetOf, tiersOf,
  museumCountOf, wornInvIdsOf, donatablesOf,
} from './museum.js'
import { ITEMS, STARTER_ITEMS, UNIQUE_ITEMS, ITEM_BY_ID } from './equipment.js'
import { AREA_LIST } from './areas.js'
import { PLUS_MAX } from './smith.js'

const SQL = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fnBody = (name) => {
  const m = SQL.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(m, `${name} が見つかる`)
  return m[0]
}
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('【確定】段階は V1 と同じ：未強化（+0〜4）／+5以上／+9以上', () => {
  assert.deepEqual(MUSEUM_TIERS.map(t => [t.key, t.label, t.min]), [[0, '未強化', 0], [1, '+5以上', 5], [2, '+9以上', 9]])
  for (let p = 0; p <= PLUS_MAX; p++) assert.equal(tierOfPlus(p), p >= 9 ? 2 : p >= 5 ? 1 : 0, `+${p}`)
  // 段階の下限と tierOfPlus が食い違わない
  for (const t of MUSEUM_TIERS) assert.equal(tierOfPlus(t.min), t.key)
})

test('並びは 初期装備・エリア1〜15・ユニーク の17のまとまり。どの装備もちょうど1回ずつ載る', () => {
  assert.equal(MUSEUM_GROUPS.length, 2 + AREA_LIST.length)
  assert.equal(MUSEUM_GROUPS[0].label, '初期装備')
  assert.equal(MUSEUM_GROUPS.at(-1).label, 'ユニーク')
  AREA_LIST.forEach((a, i) => assert.equal(MUSEUM_GROUPS[i + 1].label, a.name))
  const ids = MUSEUM_ITEMS.map(i => i.id)
  assert.equal(new Set(ids).size, ids.length, '重なりなし')
  assert.equal(ids.length, ITEMS.length + STARTER_ITEMS.length + UNIQUE_ITEMS.length)
  assert.deepEqual(new Set(ids), new Set(Object.keys(ITEM_BY_ID)), '装備の一覧と同じ')
  assert.deepEqual(raritiesOfGroup(MUSEUM_GROUPS[1]), ['N', 'R', 'E', 'L'])
  assert.deepEqual(raritiesOfGroup(MUSEUM_GROUPS.at(-1)), ['U'])
  assert.deepEqual(raritiesOfGroup(MUSEUM_GROUPS[0]), ['N'])
})

test('寄贈できる持ち物：着けていない・その段階がまだ。同じ装備と段階は強化値のいちばん低い1つ（個数も出す）', () => {
  const a = ITEMS[0].id, b = ITEMS[1].id
  const inventory = [
    { id: 1, base_id: a, plus: 0 },   // 着けている
    { id: 2, base_id: a, plus: 3 },   // 未強化の段階（+0〜4）
    { id: 3, base_id: a, plus: 1 },   // 同じ段階でより低い → こちらを出す
    { id: 4, base_id: a, plus: 5 },   // +5以上の段階（登録済み）
    { id: 5, base_id: a, plus: 10 },  // +9以上の段階
    { id: 6, base_id: b, plus: 0 },
    { id: 7, base_id: 'もう無い装備', plus: 0 },
  ]
  const prof = { equipped: { weapon: 1, head: null } }
  const rows = [{ base_id: a, tier: 1, plus: 6 }]
  const d = donatablesOf(prof, inventory, rows)
  assert.deepEqual(d.map(x => [x.inv.id, x.tier, x.copies]), [[3, 0, 2], [5, 2, 1], [6, 0, 1]])
  assert.deepEqual([...wornInvIdsOf(prof)], ['1'], '着けている枠の値そのもの（空の枠は数えない）')
  // 登録の印・数
  const reg = registeredSetOf(rows)
  assert.ok(reg.has(museumKey(a, 1)))
  assert.deepEqual(tiersOf(reg, a), [1])
  const c = museumCountOf(rows)
  assert.deepEqual(c.byTier, [0, 1, 0])
  assert.equal(c.items, MUSEUM_ITEMS.length)
  assert.equal(c.max, MUSEUM_ITEMS.length * 3)
})

test('SQL §14：登録の表（自分の分だけ読める）・寄贈（着けていない・段階は JS と同じ・2回は弾く・装備は消える）', () => {
  assert.ok(SQL.includes('create table if not exists public.v2cap_museum ('))
  assert.ok(SQL.includes('primary key (player_id, base_id, tier)'))
  assert.ok(SQL.includes('tier       int  not null check (tier between 0 and 2),'))
  assert.ok(SQL.includes('create policy v2cap_museum_own on public.v2cap_museum for select to authenticated using (player_id = auth.uid());'))
  assert.ok(SQL.includes('revoke all on table public.v2cap_museum from anon;'))
  const f = fnBody('v2cap_museum_donate')
  assert.ok(f.includes('if not public.v2cap_is_dev() then'), '開発限定（この版は管理者だけ）')
  assert.ok(f.includes('select * into v_row from public.v2cap_profiles where id = v_uid for update;'), '行をつかむ')
  assert.ok(f.includes("return jsonb_build_object('ok', false, 'error', '着けている装備は寄贈できません');"))
  assert.ok(f.includes('e.rarity is not null'), '前の形の装備（一覧から消える行）は寄贈できない')
  // 段階の決まりが JS（tierOfPlus）と同じ
  assert.ok(f.includes('v_tier := case when v_plus >= 9 then 2 when v_plus >= 5 then 1 else 0 end;'))
  assert.equal(MUSEUM_TIERS[2].min, 9)
  assert.equal(MUSEUM_TIERS[1].min, 5)
  assert.match(f, /delete from public\.v2cap_inventory where id = v_inv\.id;\s+insert into public\.v2cap_museum/)
  assert.ok(SQL.includes('revoke all on function public.v2cap_museum_donate(bigint) from public, anon;'))
  assert.ok(SQL.includes('grant execute on function public.v2cap_museum_donate(bigint) to authenticated;'))
  // 作り直し（開発用）で登録も消す
  assert.ok(fnBody('v2cap_dev_reset').includes('delete from public.v2cap_museum where player_id = auth.uid();'))
})

test('画面：メニューに博物館・寄贈は確認してから・登録の一覧は自分の分を読む', () => {
  const home = src('../pages/V2capHome.jsx')
  assert.ok(home.includes("{ key:'museum', label:'博物館', icon:'🏺'"))
  assert.ok(home.includes("{screen === 'museum' && <V2capMuseum prof={prof} inventory={inventory} onProfile={refresh} />}"))
  const m = src('../components/V2capMuseum.jsx')
  assert.ok(m.includes("supabase.from('v2cap_museum').select('base_id, tier, plus')"))
  assert.ok(m.includes("supabase.rpc('v2cap_museum_donate', { p_inventory_id: c.inv.id })"))
  assert.ok(m.includes('<V2Modal title="🏺 装備を寄贈する"'), '確認のポップアップ')
  assert.ok(m.includes('登録でもらえる能力：準備中'), '能力はあとで（ユーザー）')
})
