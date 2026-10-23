// 「レベルキャップあり」版：博物館（装備の寄贈・2026-10-22 ユーザー指示「とりあえず土台だけ」・10-23 実機を見ての直し）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MUSEUM_TIERS, tierOfPlus, MUSEUM_GROUPS, MUSEUM_ITEMS, isMuseumItem, raritiesOfGroup, museumKey, registeredSetOf, tiersOf,
  museumCountOf, wornInvIdsOf, donatablesOf, donatedText, donatedTail,
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

test('並びは エリア1〜15 の15のまとまり。初期装備・ユニークは入らない（10-23 ユーザー指示「初期装備は対象外」「ユニーク装備は…あることすら悟られないように」）', () => {
  assert.equal(MUSEUM_GROUPS.length, AREA_LIST.length)
  AREA_LIST.forEach((a, i) => assert.equal(MUSEUM_GROUPS[i].label, a.name))
  assert.ok(!MUSEUM_GROUPS.some(g => g.label === 'ユニーク'))
  const ids = MUSEUM_ITEMS.map(i => i.id)
  assert.equal(new Set(ids).size, ids.length, '重なりなし')
  assert.equal(ids.length, ITEMS.length)
  for (const u of UNIQUE_ITEMS) assert.equal(isMuseumItem(u), false, u.name)
  for (const s of STARTER_ITEMS) assert.equal(isMuseumItem(s), false, s.name)
  assert.deepEqual(raritiesOfGroup(MUSEUM_GROUPS[0]), ['N', 'R', 'E', 'L'])
  for (const g of MUSEUM_GROUPS) assert.deepEqual(raritiesOfGroup(g), ['N', 'R', 'E', 'L'], g.label)
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
  assert.deepEqual(d.map(x => [x.inv.id, x.tier, x.copies]), [[2, 0, 2], [5, 2, 1]], 'ユニークは出さない')
  assert.deepEqual([...wornInvIdsOf(prof)], ['1'], '着けている枠の値そのもの（空の枠は数えない）')
  // 登録の印・数
  const reg = registeredSetOf(rows)
  assert.ok(reg.has(museumKey(a, 1)))
  assert.deepEqual(tiersOf(reg, a), [1])
  const c = museumCountOf(rows)
  assert.deepEqual(c.byTier, [0, 1, 0])
  assert.equal(c.items, MUSEUM_ITEMS.length)
})

test('★ユニークは寄贈できない・博物館の画面のどこにも出さない（10-23 ユーザー指示「あることすら悟られないようにしたい」）', () => {
  // 画面の文字（コードの中の説明 // と {/* */} を除く）に「ユニーク」が無い
  const m = src('../components/V2capMuseum.jsx')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  assert.ok(!m.includes('ユニーク'), '画面にユニークの文字が無い')
  assert.ok(!/UNIQUE|isUnique|uniqueHidden|bulkDonatable/.test(m), 'ユニークを扱うコードも無い')
  // 持っていても寄贈できる装備に出ない
  const inv = UNIQUE_ITEMS.slice(0, 3).map((u, i) => ({ id: 100 + i, base_id: u.id, plus: 0 }))
  assert.deepEqual(donatablesOf({ equipped: {} }, inv, []), [])
  // サーバーも弾く（断りの文にユニークと書かない）
  const take = fnBody('v2cap_museum_take')
  assert.match(take, /if v_item\.rarity = 'U' then\s+return jsonb_build_object\('ok', false, 'error', 'この装備は寄贈できません'\);/)
  assert.ok(!/'error', '[^']*ユニーク/.test(take), '断りの文にユニークと書かない')
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
  assert.ok(m.includes('エリアコンプリート：スタミナ回復−{MUSEUM_AREA_STAM_SEC}秒'), 'コンプリートの説明に（…）を付けない（10-23）')
  assert.ok(m.includes('<span style={NOWRAP}>3段階すべて寄贈で</span> <span style={NOWRAP}>スタミナ回復−{MUSEUM_RARITY_STAM_SEC}秒'), '3段階の報酬の書き方（10-23）・句の途中で改行しない')
  // 報酬は2行に分ける・レア度ごとに枠（10-23「これを改行」「ノーマルとかレアの区分で枠分けてほしい」）
  assert.ok(m.includes('<span style={NOWRAP}>1段階そろうごとに</span> <span style={NOWRAP}>ステータスポイント+{MUSEUM_SET_SP[r]}</span></div>'))
  // 報酬の2行はレア度の札の右（10-23「レアリティの右に持ってこれない？」）＝札と同じ横並びの中
  const head = m.slice(m.indexOf("fontWeight:'bold' }}>{rarityLabel(r)}</span>"), m.indexOf('{/* 段階ごとの登録数（札と別の行'))
  assert.ok(head.includes('1段階そろうごとに') && head.includes('3段階すべて寄贈で'), '札のすぐ右に2行')
  assert.ok(m.includes('<div key={r} style={{ border:`1px solid ${RARITY_COLOR[r]}55`'))
  assert.ok(m.includes('const tierTag = (t) => `【${t.label}】`'), '段階を【】で囲む（10-23）')
  assert.ok(m.includes('{result.rewards.map(w => <div key={w.key} style={{ color:\x27#ffcc00\x27 }}>🎉 {rewardText(w)}</div>)}'), '寄贈のあとに新しい報酬')
  // 段階の印に「以上」を出さない
  assert.ok(!MUSEUM_TIERS.some(t => t.label.includes('以上')))
  assert.ok(Object.keys(ITEM_BY_ID).length > MUSEUM_ITEMS.length, '初期装備のぶん少ない')
})

// ===== 報酬（2026-10-23 ユーザー指示）=====
import { MUSEUM_SET_SP, MUSEUM_RARITY_STAM_SEC, MUSEUM_AREA_STAM_SEC, setItemsOf, areaProgressOf, museumRewardTotalsOf, rewardText } from './museum.js'
import { STAMINA_RECOVER_MS, STAMINA_CUT_MAX_SEC, staminaSpanMsOf, rollStamina, msToNextStamina } from './level.js'

const rowsOf = (items, tiers = [0, 1, 2]) => items.flatMap(i => tiers.map(t => ({ base_id: i.id, tier: t })))

test('【確定】報酬の数：ステータスポイント ノーマル1・レア2・エピック3・レジェンダリー4（段階ごと）・3段階で−1秒・エリアコンプで−1秒', () => {
  assert.deepEqual(MUSEUM_SET_SP, { N: 1, R: 2, E: 3, L: 4 })
  assert.equal(MUSEUM_RARITY_STAM_SEC, 1)
  assert.equal(MUSEUM_AREA_STAM_SEC, 1)
  for (let a = 1; a <= AREA_LIST.length; a++) for (const r of ['N', 'R', 'E', 'L']) assert.equal(setItemsOf(a, r).length, 26, `エリア${a} ${r}`)
  // 全部そろえると +450・−75秒（3分→1分45秒）
  const all = museumRewardTotalsOf(rowsOf(ITEMS))
  assert.deepEqual(all, { sp: 450, stamSec: 75 })
  assert.equal(staminaSpanMsOf({ museum_stam_cut: all.stamSec }), 105 * 1000)
  // ユニーク・初期装備は数えない
  assert.deepEqual(museumRewardTotalsOf(rowsOf([...UNIQUE_ITEMS, ...STARTER_ITEMS])), { sp: 0, stamSec: 0 })
})

test('報酬の進み：1つの段階だけそろえる→ステータスポイントだけ・3段階→スタミナ・全部のレア度→エリアコンプリート', () => {
  const N1 = setItemsOf(1, 'N')
  // 未強化だけ 26/26 → +1
  assert.deepEqual(museumRewardTotalsOf(rowsOf(N1, [0])), { sp: 1, stamSec: 0 })
  // 1つ足りない → なし
  assert.deepEqual(museumRewardTotalsOf(rowsOf(N1.slice(1), [0])), { sp: 0, stamSec: 0 })
  // 3段階 → +3・−1秒
  assert.deepEqual(museumRewardTotalsOf(rowsOf(N1)), { sp: 3, stamSec: 1 })
  // エリア1のレア度ぜんぶ×3段階 → +30・−5秒（4つのレア度＋コンプリート）
  const area1 = ITEMS.filter(i => i.area === 1)
  assert.deepEqual(museumRewardTotalsOf(rowsOf(area1)), { sp: 30, stamSec: 5 })
  const p = areaProgressOf(registeredSetOf(rowsOf(N1, [0, 2])), 1)
  assert.deepEqual(p.rarities[0].tiers.map(t => [t.have, t.done]), [[26, true], [0, false], [26, true]])
  assert.equal(p.rarities[0].allTiers, false)
  assert.equal(p.complete, false)
})

test('寄贈のあとの報酬の文（サーバーの key から）', () => {
  assert.equal(rewardText({ key: 'set:1:N:0', kind: 'sp', amount: 1 }), '始まりの森 ノーマル（未強化）をそろえた！ステータスポイント+1')
  assert.equal(rewardText({ key: 'set:3:L:2', kind: 'sp', amount: 4 }), `${AREA_LIST[2].name} レジェンダリー（+9）をそろえた！ステータスポイント+4`)
  assert.equal(rewardText({ key: 'rarity:1:R', kind: 'stam', amount: 1 }), '始まりの森 レアを3段階そろえた！スタミナの回復−1秒')
  assert.equal(rewardText({ key: 'area:1', kind: 'stam', amount: 1 }), '始まりの森をコンプリート！スタミナの回復−1秒')
})

test('スタミナの回復の間隔：3分 − 博物館の短縮（上限120秒）。数え方は間隔だけ変わる', () => {
  assert.equal(staminaSpanMsOf({}), STAMINA_RECOVER_MS)
  assert.equal(staminaSpanMsOf({ museum_stam_cut: 5 }), STAMINA_RECOVER_MS - 5000)
  assert.equal(staminaSpanMsOf({ museum_stam_cut: 999 }), STAMINA_RECOVER_MS - STAMINA_CUT_MAX_SEC * 1000, '上限')
  assert.equal(staminaSpanMsOf({ museum_stam_cut: -3 }), STAMINA_RECOVER_MS)
  const at = new Date('2026-10-23T00:00:00Z').getTime()
  const span = staminaSpanMsOf({ museum_stam_cut: 30 })   // 150秒
  assert.deepEqual(rollStamina(0, at, 10, at + 300 * 1000, span), { n: 2, at: at + 300 * 1000 })
  assert.equal(rollStamina(0, at, 10, at + 300 * 1000).n, 1, '間隔を渡さなければ今までどおり3分')
  assert.equal(msToNextStamina(0, at, 10, at + 100 * 1000, span), 50 * 1000)
})

test('SQL：報酬の表・数え直し（数は JS と同じ）・寄贈で数え直す・前からの寄贈も数える・スタミナの列', () => {
  assert.ok(SQL.includes('create table if not exists public.v2cap_museum_rewards ('))
  assert.ok(SQL.includes('primary key (player_id, key)'), '1つの報酬は1回だけ')
  assert.ok(SQL.includes('create policy v2cap_museum_rewards_own on public.v2cap_museum_rewards for select to authenticated using (player_id = auth.uid());'))
  assert.ok(SQL.includes('alter table public.v2cap_profiles add column if not exists museum_stam_cut int not null default 0;'))
  const settle = fnBody('v2cap_museum_settle')
  assert.ok(settle.includes(`case s.rarity when 'N' then ${MUSEUM_SET_SP.N} when 'R' then ${MUSEUM_SET_SP.R} when 'E' then ${MUSEUM_SET_SP.E} when 'L' then ${MUSEUM_SET_SP.L} end as amount`), 'ステータスポイントが JS と同じ')
  assert.ok(settle.includes(`'rarity:' || x.area || ':' || x.rarity, 'stam', ${MUSEUM_RARITY_STAM_SEC} from rar x`))
  assert.ok(settle.includes(`'area:' || a.area, 'stam', ${MUSEUM_AREA_STAM_SEC} from ar a`))
  assert.ok(settle.includes("e.area >= 1 and e.rarity in ('N', 'R', 'E', 'L')"), 'ユニーク・初期装備は数えない')
  assert.ok(settle.includes('having count(distinct s.tier) = 3'), '3段階そろえて1回（ユーザー選択）')
  assert.ok(settle.includes('on conflict (player_id, key) do nothing;'))
  assert.ok(settle.includes('set stat_points = stat_points + v_sp, museum_stam_cut = v_cut'))
  assert.ok(SQL.includes('revoke all on function public.v2cap_museum_settle(uuid) from public, anon, authenticated;'), '中の関数は閉じる')
  for (const name of ['v2cap_museum_donate', 'v2cap_museum_donate_many']) assert.ok(fnBody(name).includes("'rewards', public.v2cap_museum_settle(v_uid)"), name)
  assert.ok(SQL.includes('for r in select distinct m.player_id from public.v2cap_museum m loop\n    perform public.v2cap_museum_settle(r.player_id);'), '前からの寄贈も数える')
  assert.ok(fnBody('v2cap_dev_reset').includes('delete from public.v2cap_museum_rewards where player_id = auth.uid();'))
})

test('寄贈のあとの報酬の並び：エリア→段階ごとのステータスポイント（ノーマル→レア→エピック→レジェンダリー・未強化→+5→+9）→3段階のスタミナ→コンプリート（10-23 ユーザー指示）', async () => {
  const { sortRewards } = await import('./museum.js')
  // サーバーが返す順（key の文字の順）＝実機で出た順
  const server = ['set:1:E:0', 'set:1:E:1', 'set:1:E:2', 'set:1:L:0', 'set:1:L:1', 'set:1:L:2', 'set:1:N:0', 'set:1:N:1', 'set:1:N:2',
    'set:1:R:0', 'set:1:R:1', 'set:1:R:2', 'rarity:1:E', 'rarity:1:L', 'rarity:1:N', 'rarity:1:R', 'area:1']
  const got = sortRewards(server.map(key => ({ key }))).map(w => w.key)
  assert.deepEqual(got, ['set:1:N:0', 'set:1:N:1', 'set:1:N:2', 'set:1:R:0', 'set:1:R:1', 'set:1:R:2', 'set:1:E:0', 'set:1:E:1', 'set:1:E:2',
    'set:1:L:0', 'set:1:L:1', 'set:1:L:2', 'rarity:1:N', 'rarity:1:R', 'rarity:1:E', 'rarity:1:L', 'area:1'])
  // 2つのエリアにまたがるときはエリアの順（10 は 2 のあと）
  assert.deepEqual(sortRewards([{ key: 'set:10:N:0' }, { key: 'area:2' }, { key: 'set:2:L:2' }]).map(w => w.key), ['set:2:L:2', 'area:2', 'set:10:N:0'])
  assert.deepEqual(sortRewards(undefined), [])
  assert.ok(src('../components/V2capMuseum.jsx').includes('rewards: sortRewards(data.rewards)'), '画面は並べ直した順で出す')
})

test('エリアはプルダウン・行ったことのあるエリアだけ・報酬の文は灰色にしない（10-23 ユーザー指示）', () => {
  const m = src('../components/V2capMuseum.jsx')
  assert.ok(m.includes('const maxArea = Math.max(1, spotOf(openUntilOf(prof?.cleared_spots))?.area || 1)'), '図鑑と同じ「行ったことのある一番先のエリア」')
  assert.ok(m.includes('const groups = MUSEUM_GROUPS.filter(g => g.area <= maxArea)'))
  assert.ok(m.includes('<select value={group.key} onChange={e => setGroupKey(e.target.value)}'), 'プルダウン')
  assert.ok(m.includes('{groups.map(g => ('), '選べるのは行ったエリアだけ')
  assert.ok(!m.includes('MUSEUM_GROUPS.map(g => ('), '全エリアのタブは出さない')
  assert.ok(m.includes("const REWARD_OFF = '#88ccff'"), 'まだの報酬は明るい水色')
  const head = m.slice(m.indexOf("fontWeight:'bold' }}>{rarityLabel(r)}</span>"), m.indexOf('{/* 段階ごとの登録数（札と別の行'))
  assert.ok(!head.includes('TEXT.sub'), '報酬の2行に灰色を使わない')
  assert.equal(head.split('rp.allTiers ? REWARD_ON : REWARD_OFF').length - 1, 2, '2行ともそろえば金色・まだは水色')
})

test('上の欄：説明は HELP の小窓・収蔵数・獲得済み報酬（かっこ書きなし）・報酬の決まりの段落なし／コンプリートは ★COMPLETE★（10-23 ユーザー指示）', () => {
  const m = src('../components/V2capMuseum.jsx')
  assert.ok(m.includes("<button onClick={() => setHelp(true)} style={miniBtn('#88aaff')}>❓ HELP</button>"), 'HELP のボタン')
  assert.ok(m.includes('<V2Modal title="❓ 博物館のHELP"'), '説明は小窓')
  const help = m.slice(m.indexOf('<V2Modal title="❓ 博物館のHELP"'), m.indexOf('</V2Modal>', m.indexOf('<V2Modal title="❓ 博物館のHELP"')))
  assert.ok(help.includes('装備を寄贈すると、博物館に登録されます') && help.includes('着けている装備は寄贈できません'), '前の説明の文は HELP の中')
  assert.equal(m.split('装備を寄贈すると、博物館に登録されます').length - 1, 1, '説明の文は HELP にだけ')
  // HELP に報酬のまとめ（10-23「HELPに報酬内容を分かりやすくまとめておいて」）
  assert.ok(help.includes('報酬（どれもずっと続きます）') && help.includes('<table'), '報酬の表')
  assert.ok(help.includes('ステータスポイント+{MUSEUM_SET_SP[r]}') && help.includes('スタミナ回復−{MUSEUM_RARITY_STAM_SEC}秒') && help.includes('さらにスタミナ回復−{MUSEUM_AREA_STAM_SEC}秒'), '数は museum.js から')
  assert.ok(m.includes("<span style={{ color:'#d8b070', fontSize:'12px' }}>収蔵数</span>"))
  assert.ok(m.includes('獲得済み報酬：ステータスポイント +{totals.sp}　スタミナの回復 −{stamCut}秒'), '獲得済み報酬')
  assert.ok(!m.includes('mmss('), '（3:00 → 2:55）のかっこ書きは出さない')
  assert.ok(!m.includes('もらった報酬：') && !m.includes('報酬（どれもずっと続く）'), '前の文と報酬の決まりの段落は出さない')
  assert.ok(m.includes("{areaProgressOf(registered, g.area).complete ? '　★COMPLETE★' : ''}"), 'プルダウンのコンプリートは英語')
})
