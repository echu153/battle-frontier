// v2cap：商店（node --test）
// 【確定】2026-10-31 ユーザー指示「施設で商店を追加したい。現状以下のアイテムを購入できるように」
//   性別変更薬 30,000G・日月反転の秘薬 3,000G（60分・時間帯が12時間ずれる）。買ったらその場で飲む
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bandAt, pickEncounter } from './sortie.js'
import { spotOf } from './areas.js'
import {
  SHOP_ITEMS, SHOP_ITEM_BY_KEY, FLIP_NAME, FLIP_MINUTES, FLIP_HOURS,
  otherGenderOf, flipLeftMsOf, encounterClockOf, encounterBandOf, flipPreviewOf, itemCountOf, buyableQtyOf,
} from './shop.js'
import { BATTLE_ITEMS, ITEM_CD, ITEM_MAX, POTION_PCT, itemCountsOf } from '../core/atbItems.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const SQL = read('../../../supabase_v2cap_core.sql')
const fnBody = (name) => {
  const i = SQL.indexOf(`create or replace function public.${name}(`)
  assert.ok(i >= 0, `${name} がある`)
  return SQL.slice(i, SQL.indexOf('\n$$;', i))
}
// 日本時間の h 時 m 分
const jst = (h, m = 0) => new Date(Date.UTC(2026, 9, 31, h - 9, m))
const MIN = 60 * 1000
const on = (at, minutes = 30) => ({ flip_until: new Date(at.getTime() + minutes * MIN).toISOString() })

test('【確定】品物：HPポーション 500G・MPポーション 500G・清めの雫 1,000G（2026-11-01）・性別変更薬 30,000G・日月反転の秘薬 3,000G（ユーザーが候補から選んだ）', () => {
  assert.deepEqual(SHOP_ITEMS.map(i => [i.key, i.name, i.gold, !!i.bag]), [
    ['hp', 'HPポーション', 500, true], ['mp', 'MPポーション', 500, true], ['cure', '清めの雫', 1000, true],
    ['gender', '性別変更薬', 30000, false], ['flip', '日月反転の秘薬', 3000, false],
  ])
  assert.deepEqual(BATTLE_ITEMS.map(i => i.key), SHOP_ITEMS.filter(i => i.bag).map(i => i.key), '戦闘で飲む薬は全部売っている')
  assert.deepEqual([POTION_PCT, ITEM_CD, ITEM_MAX], [30, 30, 99], 'ユーザー選択「最大の30%」「3種類で共通 30秒」・持てる数はこちらで決めた')
  assert.equal(FLIP_NAME, SHOP_ITEM_BY_KEY.flip.name)
  assert.equal(FLIP_MINUTES, 60)
  assert.equal(FLIP_HOURS, 12)
})

test('性別変更薬：男女が入れ替わる（性別がまだ無ければ変えられない）', () => {
  assert.equal(otherGenderOf('m'), 'f')
  assert.equal(otherGenderOf('f'), 'm')
  assert.equal(otherGenderOf(null), null)
})

test('【確定】日月反転の秘薬：12時間ずらす＝どの時刻でも必ず今と違う時間帯になる', () => {
  const want = { 5:'昼', 8:'昼', 9:'晩', 12:'晩', 13:'晩', 16:'晩', 17:'朝', 20:'朝', 21:'朝', 0:'朝', 1:'昼', 4:'昼' }
  for (const [h, band] of Object.entries(want)) {
    const at = jst(Number(h))
    assert.equal(encounterBandOf(on(at), at), band, `${h}時`)
  }
  for (let h = 0; h < 24; h++) {
    const at = jst(h, 30)
    assert.notEqual(encounterBandOf(on(at), at), bandAt(at), `${h}時30分`)
  }
})

test('効いていないときは本当の時刻のまま（切れたらすぐ戻る）', () => {
  const at = jst(22)
  for (const prof of [null, {}, { flip_until: null }, on(at, -1), on(at, 0)]) {
    assert.equal(flipLeftMsOf(prof, at), 0)
    assert.equal(encounterClockOf(prof, at), at, '同じ時刻を返す')
    assert.equal(encounterBandOf(prof, at), '晩')
  }
  assert.equal(flipLeftMsOf(on(at, 30), at), 30 * MIN)
  assert.equal(flipLeftMsOf(on(at, 30), at.getTime()), 30 * MIN, '数でも渡せる')
})

test('飲む前に見せる：飲んだあとの時間帯・残り・効いているあいだに時間帯が変わるとき', () => {
  // 夜10時に飲む＝朝10時ぶん。60分のあいだ朝のまま
  assert.deepEqual(flipPreviewOf({}, jst(22)), { to:'朝', leftMs: 60 * MIN, change: null })
  // 朝8時55分に飲む＝夜8時55分（昼）。5分後に夜9時ぶん（晩）へ
  assert.deepEqual(flipPreviewOf({}, jst(8, 55)), { to:'昼', leftMs: 60 * MIN, change: { minutes: 5, band:'晩' } })
  // 効いているあいだに飲むと60分延びる（残り30分＋60分）
  const at = jst(22)
  assert.deepEqual(flipPreviewOf(on(at, 30), at), { to:'朝', leftMs: 90 * MIN, change: null })
})

test('【確定】秘薬で変わるのは出会う敵だけ：時間限定の敵とレアがずれた時間帯になる', () => {
  const spot = spotOf(1)
  const at = jst(22)   // 本当は晩。飲むと朝
  const clock = encounterClockOf(on(at), at)
  const seen = new Set()
  let s = 7
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = 0; i < 3000; i++) {
    const enc = pickEncounter(spot.id, 0, clock, rng)
    assert.equal(enc.band, '朝')
    if (enc.role === 'timed') seen.add(enc.enemy.band)
  }
  assert.deepEqual([...seen], ['朝'])
  const SORTIE = read('./sortieVerify.js')
  assert.ok(SORTIE.includes('pickEncounter(spot, rate, encounterClockOf(snap.prof, at), rng, forcePapia)'), '出撃は秘薬ぶんの時刻を渡す')
  assert.ok(SORTIE.includes('rollEquipDrop(enc, snap.prof.class, at, rng,'), '落ちやすい部位は本当の時刻のまま')
  assert.equal(SORTIE.match(/pickEncounter\(/g).length, 1, '敵を決めるのはここだけ')
  assert.ok(!read('../components/V2capSortie.jsx').includes('pickEncounter('), '画面では敵を決めない')
})

test('持ち歩く薬：持っている数・いま買える数（Gold と持てる数の少ないほう）', () => {
  const hp = SHOP_ITEM_BY_KEY.hp
  assert.equal(itemCountOf({ items: { hp: 3 } }, 'hp'), 3)
  for (const p of [null, {}, { items: null }, { items: {} }]) assert.equal(itemCountOf(p, 'hp'), 0)
  assert.deepEqual(itemCountsOf({ hp: 'x', mp: -5, cure: 1000 }), { hp: 0, mp: 0, cure: ITEM_MAX }, 'おかしい値は直す')
  assert.equal(buyableQtyOf({ gold: 1499 }, hp), 2)
  assert.equal(buyableQtyOf({ gold: 499 }, hp), 0)
  assert.equal(buyableQtyOf({ gold: 10000000 }, hp), ITEM_MAX)
  assert.equal(buyableQtyOf({ gold: 10000000, items: { hp: 95 } }, hp), 4, '持てる数まで')
  assert.equal(buyableQtyOf({ gold: 10000000, items: { hp: ITEM_MAX } }, hp), 0)
  assert.equal(buyableQtyOf(null, hp), 0)
})

test('サーバー：持ち歩く薬の値段と持てる数が同じ・個数を見る・持ち物に入れる（画面から書けるのはこの関数だけ）', () => {
  const s = fnBody('v2cap_shop_buy')
  assert.ok(s.includes(`c_hp_gold      constant int := ${SHOP_ITEM_BY_KEY.hp.gold};`))
  assert.ok(s.includes(`c_mp_gold      constant int := ${SHOP_ITEM_BY_KEY.mp.gold};`))
  assert.ok(s.includes(`c_cure_gold    constant int := ${SHOP_ITEM_BY_KEY.cure.gold};`))
  assert.ok(s.includes(`c_item_max     constant int := ${ITEM_MAX};`))
  assert.ok(s.includes("p_item not in ('gender', 'flip', 'hp', 'mp', 'cure')"))
  assert.ok(s.includes("if p_qty is null or p_qty < 1 or p_qty > c_item_max then"), '0個や負の数で Gold が増えない')
  assert.ok(s.includes("if v_have + p_qty > c_item_max then"))
  assert.ok(s.includes("set gold = gold - v_cost, items = items || jsonb_build_object(p_item, v_have + p_qty)"))
  assert.ok(SQL.includes("alter table public.v2cap_profiles add column if not exists items jsonb not null default '{}'::jsonb;"))
  assert.ok(SQL.includes('drop function if exists public.v2cap_shop_buy(text);'), '前の形を残すと呼び分けられない')
  // 持ち物は画面から書けない
  assert.ok(SQL.includes('grant select on table public.v2cap_profiles to authenticated;'))
  assert.doesNotMatch(SQL, /grant (update|insert|all)[^;]*on table public\.v2cap_profiles/)
})

test('画面：薬は個数を選んで買う・戦闘で飲むボタンは回し直しと同じ入口', () => {
  const shop = read('../components/V2capShop.jsx')
  assert.ok(shop.includes("SHOP_ITEM_BY_KEY[confirm].bag ? { p_item: confirm, p_qty: qty } : { p_item: confirm }"))
  assert.ok(shop.includes('<QtyPicker have={itemCountOf(prof, asking.key)} qty={qty} max={buyableQtyOf(prof, asking)} onQty={setQty} />'))
  const fight = read('../components/V2capAtbFight.jsx')
  assert.ok(fight.includes('onClick={() => drinkItem(s, it.key)}'))
  assert.ok(fight.includes('{me.items && ('), '持っている数を知らない戦闘（SQL を流す前の写し）にはボタンを出さない')
  assert.ok(read('./dungeonVerify.js').includes('items: snap.prof.items'), '持っている数はサーバーの写しから')
  const dun = read('../components/V2capDungeon.jsx')
  assert.ok(dun.includes('if (itemsUsedOf(p.st)) onProfileRef.current?.()'), '飲んだら商店の持っている数を読み直す')
})

test('サーバー：値段と時間が shop.js と同じ・Goldが足りるかを見る・開発限定・権限', () => {
  const s = fnBody('v2cap_shop_buy')
  assert.ok(s.includes(`c_gender_gold  constant int := ${SHOP_ITEM_BY_KEY.gender.gold};`))
  assert.ok(s.includes(`c_flip_gold    constant int := ${SHOP_ITEM_BY_KEY.flip.gold};`))
  assert.ok(s.includes(`c_flip_minutes constant int := ${FLIP_MINUTES};`))
  assert.ok(s.includes("if not public.v2cap_is_dev() then"))
  assert.ok(s.includes('for update;'), '同時に買っても Gold が合う')
  assert.ok(s.includes("if v_row.gold < v_cost then return jsonb_build_object('ok', false, 'error', 'Goldが足りません'); end if;"))
  assert.ok(s.includes("if p_item = 'gender' and v_row.gender is null then"), '性別が無いキャラはホームで1回だけ選ぶ（空のまま入れ替えない）')
  assert.ok(s.includes("gender = case when gender = 'm' then 'f' else 'm' end"))
  assert.ok(s.includes('flip_until = greatest(flip_until, now()) + make_interval(mins => c_flip_minutes)'), '効いているあいだに飲むと延びる（greatest は null を無視する）')
  assert.ok(SQL.includes('alter table public.v2cap_profiles add column if not exists flip_until timestamptz;'))
  assert.ok(SQL.includes('revoke all on function public.v2cap_shop_buy(text, int) from public, anon;'))
  assert.ok(SQL.includes('grant execute on function public.v2cap_shop_buy(text, int) to authenticated;'))
})

test('画面：ホームの施設に商店・買うのはサーバー・効いているあいだはステータスに出す', () => {
  const home = read('../pages/V2capHome.jsx')
  assert.ok(home.includes("{ key:'shop', label:'商店', icon:'🏪', color: SHOP_COLOR, action:'薬を買う' }"))
  assert.ok(home.includes("{screen === 'shop' && <V2capShop prof={prof} onProfile={refresh} dev={isAdmin} />}"))
  assert.ok(home.includes("if (m.key === 'shop' && flip > 0) return { ...m, action:`日月反転中（${leftText(flip)}）` }"))
  assert.ok(home.includes('あとから変えるには商店の性別変更薬が必要'), 'キャラ作成の注意書き')
  const shop = read('../components/V2capShop.jsx')
  assert.ok(shop.includes("supabase.rpc('v2cap_shop_buy', "))
  assert.ok(read('../components/V2capStatus.jsx').includes('flipLeftMsOf(prof, now) > 0 && ('))
})
