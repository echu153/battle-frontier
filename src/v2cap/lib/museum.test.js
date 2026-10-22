// 「レベルキャップあり」版：博物館（装備の寄贈・2026-10-22 ユーザー指示「とりあえず土台だけ」・10-23 実機を見ての直し）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MUSEUM_TIERS, tierOfPlus, MUSEUM_GROUPS, MUSEUM_ITEMS, isMuseumItem, raritiesOfGroup, museumKey, registeredSetOf, tiersOf,
  uniqueHidden, museumCountOf, wornInvIdsOf, donatablesOf, bulkDonatable, donatedText, donatedTail,
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

test('【確定】段階は +0／+5／+9 ちょうど（10-23 ユーザー指示「これ以外の強化値は登録できないように」）', () => {
  assert.deepEqual(MUSEUM_TIERS.map(t => [t.key, t.label, t.plus]), [[0, '未強化', 0], [1, '+5', 5], [2, '+9', 9]])
  for (let p = 0; p <= PLUS_MAX; p++) assert.equal(tierOfPlus(p), p === 0 ? 0 : p === 5 ? 1 : p === 9 ? 2 : null, `+${p}`)
})

test('並びは エリア1〜15・ユニーク の16のまとまり。初期装備は入らない（10-23 ユーザー指示「初期装備は対象外」）', () => {
  assert.equal(MUSEUM_GROUPS.length, AREA_LIST.length + 1)
  AREA_LIST.forEach((a, i) => assert.equal(MUSEUM_GROUPS[i].label, a.name))
  assert.equal(MUSEUM_GROUPS.at(-1).label, 'ユニーク')
  const ids = MUSEUM_ITEMS.map(i => i.id)
  assert.equal(new Set(ids).size, ids.length, '重なりなし')
  assert.equal(ids.length, ITEMS.length + UNIQUE_ITEMS.length)
  for (const s of STARTER_ITEMS) assert.equal(isMuseumItem(s), false, s.name)
  assert.deepEqual(raritiesOfGroup(MUSEUM_GROUPS[0]), ['N', 'R', 'E', 'L'])
  assert.deepEqual(raritiesOfGroup(MUSEUM_GROUPS.at(-1)), ['U'])
})

test('寄贈できる持ち物：初期装備でない・着けていない・+0／+5／+9・その段階がまだ。同じ装備と段階は1つ（個数も出す）', () => {
  const a = ITEMS[0].id, b = ITEMS[1].id, u = UNIQUE_ITEMS[0].id
  const inventory = [
    { id: 1, base_id: a, plus: 0 },   // 着けている
    { id: 2, base_id: a, plus: 0 },   // 未強化
    { id: 3, base_id: a, plus: 0 },   // 同じ段階の2つ目
    { id: 4, base_id: a, plus: 5 },   // +5（登録済み）
    { id: 5, base_id: a, plus: 9 },   // +9
    { id: 6, base_id: a, plus: 3 },   // +3 は登録できない
    { id: 7, base_id: a, plus: 10 },  // +10 も登録できない
    { id: 8, base_id: b, plus: 6 },   // +6 も
    { id: 9, base_id: STARTER_ITEMS[0].id, plus: 0 },   // 初期装備
    { id: 10, base_id: u, plus: 0 },  // ユニーク
    { id: 11, base_id: 'もう無い装備', plus: 0 },
  ]
  const prof = { equipped: { weapon: 1, head: null } }
  const rows = [{ base_id: a, tier: 1, plus: 5 }]
  const d = donatablesOf(prof, inventory, rows)
  assert.deepEqual(d.map(x => [x.inv.id, x.tier, x.copies]), [[2, 0, 2], [5, 2, 1], [10, 0, 1]])
  assert.deepEqual([...wornInvIdsOf(prof)], ['1'], '着けている枠の値そのもの（空の枠は数えない）')
  // まとめて選ぶときはユニークを入れない
  assert.deepEqual(d.filter(bulkDonatable).map(x => x.inv.id), [2, 5])
  // 登録の印・数
  const reg = registeredSetOf(rows)
  assert.ok(reg.has(museumKey(a, 1)))
  assert.deepEqual(tiersOf(reg, a), [1])
  const c = museumCountOf(rows)
  assert.deepEqual(c.byTier, [0, 1, 0])
  assert.equal(c.items, MUSEUM_ITEMS.length)
})

test('ユニークは、どの段階も寄贈していないものは名前を出さない（10-23 ユーザー指示「？？？で」）', () => {
  const u = UNIQUE_ITEMS[0]
  assert.equal(uniqueHidden(registeredSetOf([]), u), true)
  assert.equal(uniqueHidden(registeredSetOf([{ base_id: u.id, tier: 2 }]), u), false, 'どれか1つの段階でも寄贈すれば出す')
  assert.equal(uniqueHidden(registeredSetOf([]), ITEMS[0]), false, 'ユニーク以外は隠さない')
  assert.ok(src('../components/V2capMuseum.jsx').includes("{hidden ? '？？？' : it.name}"))
})

test('寄贈の結果の文（10-23 ユーザー指示「「ブロンズダガー」を寄贈しました（未強化で登録）って出るように」）', () => {
  assert.equal(donatedText('ブロンズダガー', 0), '「ブロンズダガー」を寄贈しました（未強化で登録）')
  assert.equal(donatedText('ブロンズダガー', 1), '「ブロンズダガー」を寄贈しました（+5で登録）')
  assert.equal(donatedText('ブロンズダガー', 2), '「ブロンズダガー」を寄贈しました（+9で登録）')
  // 画面は装備名だけレア度の色（10-23 ユーザー指示「既存の装備と同じように色付けてほしい、装備名だけね」）
  assert.equal(donatedTail(0), 'を寄贈しました（未強化で登録）')
  const m = src('../components/V2capMuseum.jsx')
  assert.ok(m.includes('「<span style={{ color: RARITY_COLOR[x.rarity], fontSize:\x2716px\x27 }}>{x.name}</span>」{donatedTail(x.tier)}'))
  // 結果の文字も少し大きく（10-23「寄贈した後のフォントも少し大きくして見やすくして」）＝文13px・装備名16px
  assert.ok(m.includes("<div style={{ maxHeight:'280px', overflowY:'auto', fontSize:'13px', lineHeight:1.7 }}>"))
  assert.ok(m.includes("<div key={i} style={{ color:'#cfe2ff' }}>"), '名前の外（「」と後ろの文）はふつうの色')
})

test('SQL §14：登録の表・決まりは中の関数1つ（1つずつも一括も同じ）・段階は JS と同じ・初期装備は弾く', () => {
  assert.ok(SQL.includes('create table if not exists public.v2cap_museum ('))
  assert.ok(SQL.includes('primary key (player_id, base_id, tier)'))
  assert.ok(SQL.includes('create policy v2cap_museum_own on public.v2cap_museum for select to authenticated using (player_id = auth.uid());'))
  assert.ok(SQL.includes('revoke all on table public.v2cap_museum from anon;'))
  const take = fnBody('v2cap_museum_take')
  assert.ok(take.includes('v_tier := case v_plus when 0 then 0 when 5 then 1 when 9 then 2 else null end;'))
  for (const t of MUSEUM_TIERS) assert.ok(take.includes(`when ${t.plus} then ${t.key}`), `段階 ${t.label} が JS と同じ`)
  assert.ok(take.includes("if coalesce(v_item.area, 0) < 1 then"), '初期装備（エリア0）は弾く')
  assert.ok(take.includes('v_item.rarity is null'), '前の形の装備（一覧から消える行）は弾く')
  assert.ok(take.includes("'着けている装備は寄贈できません'"))
  assert.match(take, /delete from public\.v2cap_inventory where id = v_inv\.id;\s+insert into public\.v2cap_museum/)
  assert.ok(SQL.includes('revoke all on function public.v2cap_museum_take(uuid, jsonb, bigint) from public, anon, authenticated;'), '中の関数は閉じる')
  for (const name of ['v2cap_museum_donate', 'v2cap_museum_donate_many']) {
    const f = fnBody(name)
    assert.ok(f.includes('if not public.v2cap_is_dev() then'), `${name}：開発限定`)
    assert.ok(f.includes('select * into v_row from public.v2cap_profiles where id = v_uid for update;'), `${name}：行をつかむ`)
    assert.ok(f.includes('public.v2cap_museum_take(v_uid, v_row.equipped,'), `${name}：中の関数を通す`)
  }
  assert.ok(SQL.includes('grant execute on function public.v2cap_museum_donate(bigint) to authenticated;'))
  assert.ok(SQL.includes('grant execute on function public.v2cap_museum_donate_many(bigint[]) to authenticated;'))
  // 一括は選んだ順（同じ装備と段階が2つ選ばれたら先のほう）。順の決まらない distinct にしない
  assert.ok(fnBody('v2cap_museum_donate_many').includes('from unnest(p_ids) with ordinality as t(x, i) group by t.x order by min(t.i) loop'))
  assert.ok(fnBody('v2cap_dev_reset').includes('delete from public.v2cap_museum where player_id = auth.uid();'))
})

test('画面：メニューに博物館・寄贈は確認→結果のポップアップ・一括寄贈は選んだぶん', () => {
  const home = src('../pages/V2capHome.jsx')
  assert.ok(home.includes("{ key:'museum', label:'博物館', icon:'🏺'"))
  assert.ok(home.includes("{screen === 'museum' && <V2capMuseum prof={prof} inventory={inventory} onProfile={refresh} />}"))
  const m = src('../components/V2capMuseum.jsx')
  assert.ok(m.includes("supabase.from('v2cap_museum').select('base_id, tier, plus')"))
  assert.ok(m.includes("supabase.rpc('v2cap_museum_donate', { p_inventory_id: list[0].inv.id })"))
  assert.ok(m.includes("supabase.rpc('v2cap_museum_donate_many', { p_ids: list.map(d => d.inv.id) })"))
  assert.ok(m.includes('<V2Modal title="🏺 装備を寄贈する"'), '確認のポップアップ')
  // 1つずつの確認は装備名だけ大きく（10-23 ユーザー指示「装備の名前見やすくするようにフォントの大きさ大きく」「装備名だけね」）
  assert.ok(m.includes('<NameLine d={confirm[0]} size="16px" />'))
  assert.ok(m.includes('<span><NameLine d={d} size="16px" /></span>'), '一括の確認も（10-23「複数選択したときの装備名が大きくなってない」）')
  // 行のどこを押してもチェックが切り替わる。チェックと「寄贈」は行に伝えない（10-23「装備の欄を押せばチェックのオンオフ」）
  assert.ok(m.includes('<div key={rowKey(d)} onClick={() => { if (!busy) toggle(rowKey(d)) }}'))
  assert.ok(m.includes('onChange={() => toggle(rowKey(d))} onClick={e => e.stopPropagation()}'))
  assert.ok(m.includes('<button onClick={e => { e.stopPropagation(); setConfirm([d]) }}'))
  assert.ok(m.includes('<span style={{ color: RARITY_COLOR[d.item.rarity], ...(size ? { fontSize: size } : null) }}>{d.item.name}</span>'), '大きくするのは名前の span だけ')
  assert.ok(m.includes("title={result.ok ? '🏺 寄贈しました'"), '結果のポップアップ')
  assert.ok(m.includes('登録でもらえる能力：準備中'), '能力はあとで（ユーザー）')
  // 段階の印に「以上」を出さない
  assert.ok(!MUSEUM_TIERS.some(t => t.label.includes('以上')))
  assert.ok(Object.keys(ITEM_BY_ID).length > MUSEUM_ITEMS.length, '初期装備のぶん少ない')
})
