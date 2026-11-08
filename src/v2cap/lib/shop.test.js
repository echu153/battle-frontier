// v2cap：商店（node --test）
// 【確定】2026-10-31 ユーザー指示「施設で商店を追加したい。現状以下のアイテムを購入できるように」
//   性別変更薬 30,000G・日月反転の秘薬 3,000G（60分・時間帯が12時間ずれる）。買ったらその場で飲む
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bandAt, pickEncounter } from './sortie.js'
import { spotOf } from './areas.js'
import {
  SHOP_ITEMS, SHOP_ITEM_BY_KEY, FLIP_NAME, FLIP_MINUTES, FLIP_HOURS, FORGET_NAME,
  otherGenderOf, flipLeftMsOf, encounterClockOf, encounterBandOf, flipPreviewOf, itemCountOf, buyableQtyOf,
} from './shop.js'
import { INITIAL_STATS, POINT_UNIT, STAT_KEYS, applyAllocation, spentPointsOf, forgetStatsOf } from './level.js'
import { BATTLE_ITEMS, CARRY_MAX, ITEM_CD, ITEM_MAX, POTION_PCT, carriedItemsOf, itemCountsOf, itemTotalOf } from '../core/atbItems.js'

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
    ['gender', '性別変更薬', 30000, false], ['flip', '日月反転の秘薬', 3000, false], ['forget', '忘却の秘薬', 10000, false],
  ])
  assert.deepEqual(BATTLE_ITEMS.map(i => i.key), SHOP_ITEMS.filter(i => i.bag).map(i => i.key), '戦闘で飲む薬は全部売っている')
  assert.deepEqual([POTION_PCT, ITEM_CD, ITEM_MAX], [30, 30, 99], 'ユーザー選択「最大の30%」「3種類で共通 30秒」・持てる数はこちらで決めた')
  assert.equal(FLIP_NAME, SHOP_ITEM_BY_KEY.flip.name)
  assert.equal(FLIP_MINUTES, 60)
  assert.equal(FLIP_HOURS, 12)
})

test('【確定】2026-11-09 忘却の秘薬（ユーザー「商店にステータス振りなおしのアイテム追加する」＋選択「10,000G」「忘却の秘薬」）：割り振ったポイントが全部戻る', () => {
  assert.equal(FORGET_NAME, SHOP_ITEM_BY_KEY.forget.name)
  assert.deepEqual(INITIAL_STATS, { hp:40, mp:12, str:5, dex:5, agi:5, int_stat:5, vit:5, luk:5 }, 'サーバーの数え方に書いた初期値')
  assert.deepEqual(POINT_UNIT, { hp:8, mp:3, str:1, dex:1, agi:1, int_stat:1, vit:1, luk:1 }, 'サーバーの数え方に書いた1ポイントの量')
  assert.equal(spentPointsOf(INITIAL_STATS), 0, '振っていない')
  assert.equal(spentPointsOf(null), 0)
  const add = { hp: 7, mp: 4, str: 20, dex: 3, agi: 0, int_stat: 1, vit: 9, luk: 2 }
  const after = applyAllocation(INITIAL_STATS, add)
  assert.equal(spentPointsOf(after), 46, '振った数がそのまま戻る')
  assert.deepEqual(forgetStatsOf(after), INITIAL_STATS, '本体のステは初期値へ')
  // 割り切れないぶん（無いはず）はステに残す＝ポイントを多く返さない
  const odd = { ...INITIAL_STATS, hp: 40 + 8 * 2 + 5, mp: 12 + 3 + 2 }
  assert.equal(spentPointsOf(odd), 3)
  assert.deepEqual(forgetStatsOf(odd), { ...INITIAL_STATS, hp: 45, mp: 14 })
  // 初期値より低いステ（無いはず）はポイントにしない
  assert.equal(spentPointsOf({ ...INITIAL_STATS, str: 2 }), 0)
  for (const k of STAT_KEYS) assert.ok(forgetStatsOf(after)[k] >= INITIAL_STATS[k])
})

test('サーバー：忘却の秘薬の値段・数え方が level.js と同じ・まだ振っていなければ断る', () => {
  const s = fnBody('v2cap_shop_buy')
  assert.ok(s.includes(`c_forget_gold  constant int := ${SHOP_ITEM_BY_KEY.forget.gold};`))
  assert.ok(s.includes("p_item not in ('gender', 'flip', 'hp', 'mp', 'cure', 'forget')"))
  const back = STAT_KEYS.map(k => POINT_UNIT[k] > 1
    ? `greatest(0, v_row.${k} - ${INITIAL_STATS[k]}) / ${POINT_UNIT[k]}` : `greatest(0, v_row.${k} - ${INITIAL_STATS[k]})`)
  for (const b of back) assert.ok(s.includes(b), b)
  assert.ok(s.includes("if v_back <= 0 then return jsonb_build_object('ok', false, 'error', 'まだステータスポイントを割り振っていません'); end if;"))
  assert.ok(s.includes('hp = 40 + greatest(0, hp - 40) % 8, mp = 12 + greatest(0, mp - 12) % 3,'))
  assert.ok(s.includes('str = 5, dex = 5, agi = 5, int_stat = 5, vit = 5, luk = 5,'))
  assert.ok(s.includes('stat_points = stat_points + v_back'))
  // 本体のステを書くのは振る関数と忘却の秘薬だけ（ほかで書くと数え直しがずれる）
  const writers = SQL.split('create or replace function public.').filter(f => /\n\s+(str|vit|luk)\s*=/.test(f)).map(f => f.slice(0, f.indexOf('(')))
  assert.deepEqual(writers.sort(), ['v2cap_allocate_points', 'v2cap_shop_buy'])
  // 画面：まだ振っていなければ買えない・飲んだあとに戻ったポイント
  const shop = read('../components/V2capShop.jsx')
  assert.ok(shop.includes("const noSpent = it.key === 'forget' && spentPointsOf(prof) <= 0"))
  assert.ok(shop.includes('割り振れるステータスポイント：'))
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

test('【確定】2026-11-01 戦闘に持ち込むのは3種類を合わせて4つまで（ユーザー「アイテムは4つまでしか持てないようにして、全部で合計4つ」＋選択「戦闘に持ち込むのが4つ」）', () => {
  assert.equal(CARRY_MAX, 4)
  const of = (items, item_loadout) => carriedItemsOf({ items, item_loadout })
  assert.deepEqual(of({ hp: 12, mp: 3, cure: 5 }, { hp: 2, mp: 1, cure: 1 }), { hp: 2, mp: 1, cure: 1 }, '選んだ数を持ち込む（商店では買いだめできる）')
  assert.deepEqual(of({ hp: 1, mp: 3, cure: 0 }, { hp: 2, mp: 1, cure: 1 }), { hp: 1, mp: 1, cure: 0 }, '足りなければあるぶんだけ')
  assert.deepEqual(of({ hp: 12 }, {}), { hp: 0, mp: 0, cure: 0 }, '選んでいなければ持ち込まない')
  assert.deepEqual(of({ hp: 12 }, undefined), { hp: 0, mp: 0, cure: 0 }, '選ぶ SQL を流す前の写し')
  assert.deepEqual(of({ hp: 12, mp: 12, cure: 12 }, { hp: 3, mp: 3, cure: 3 }), { hp: 3, mp: 1, cure: 0 }, '合計4つで切る（サーバーが断るが念のため）')
  assert.equal(carriedItemsOf({}), null, '薬の SQL を流す前の写し＝薬のボタンを出さない')
  assert.equal(carriedItemsOf(null), null)
  for (const set of [{ hp: 4 }, { hp: 2, mp: 1, cure: 1 }, { mp: 2, cure: 2 }]) assert.equal(itemTotalOf(set), CARRY_MAX)
})

test('サーバー：持ち込む数を残す関数・合計を見る・開発限定・権限', () => {
  const s = fnBody('v2cap_set_item_loadout')
  assert.ok(s.includes(`c_carry_max constant int := ${CARRY_MAX};`))
  assert.ok(s.includes("if not public.v2cap_is_dev() then"))
  assert.ok(s.includes("if v_key not in ('hp', 'mp', 'cure') or v_val is null or v_val !~ '^[0-9]$' then"), '知らない薬・負の数・文字は断る')
  assert.ok(s.includes('if v_total > c_carry_max then'))
  assert.ok(SQL.includes("alter table public.v2cap_profiles add column if not exists item_loadout jsonb not null default '{}'::jsonb;"))
  assert.ok(SQL.includes('revoke all on function public.v2cap_set_item_loadout(jsonb) from public, anon;'))
  assert.ok(SQL.includes('grant execute on function public.v2cap_set_item_loadout(jsonb) to authenticated;'))
  // 写しは列を全部持つ＝持ち込む数も入る（外す列に入れない）
  const snap = fnBody('v2cap_battle_snap')
  assert.ok(snap.includes('to_jsonb(p_row) - array['))
  assert.ok(!/array\[[^\]]*'item_loadout'/.test(snap) && !/array\[[^\]]*'items'/.test(snap))
})

test('画面：挑戦のポップアップで持ち込む薬を選ぶ・押してすぐ挑戦しても選んだ数で始まる', () => {
  const dun = read('../components/V2capDungeon.jsx')
  assert.ok(read('../components/V2capBossPick.jsx').includes('<V2capItemLoadout prof={prof} onProfile={onProfile} onGo={onGo} saveRef={saveRef} />'))
  assert.ok(dun.includes('prof={prof} onProfile={onProfile} onGo={onGo} saveRef={loadoutSave} onStart={startPick}'))
  assert.ok(dun.indexOf('await loadoutSave.current') < dun.indexOf("call('v2cap_dungeon_try_start'"), '保存を待ってから挑戦を始める')
  const lo = read('../components/V2capItemLoadout.jsx')
  assert.ok(lo.includes("supabase.rpc('v2cap_set_item_loadout', { p_loadout: next })"))
  assert.ok(lo.includes('disabled={total >= CARRY_MAX || chosen[it.key] >= have[it.key]}'), '合計4つ・持っている数を超えて選べない')
  assert.ok(lo.includes('if (prof?.item_loadout === undefined) return null'), 'SQL を流すまで出さない')
  // ユーザー「ここもっとコンパクトにして」：1種類1行・商店へのボタンは見出しの行・足りないときの一言はそのときだけ1行
  assert.ok(!lo.includes('<br />'), '名前と持っている数は同じ行')
  assert.ok(lo.indexOf('🏪 商店で買う') < lo.indexOf('BATTLE_ITEMS.map'), '商店へのボタンのために下に1行とらない')
  assert.ok(lo.includes('{short && <div'), '足りないときの一言は足りないときだけ')
  assert.ok(read('./dungeonVerify.js').includes('items: carriedItemsOf(snap.prof)'), '持ち込む数はサーバーの写しから')
  assert.ok(read('../pages/V2capHome.jsx').includes('<V2capDungeon prof={prof} inventory={inventory} onProfile={refresh} onGo={setScreen} dev={isAdmin} />'), '「商店で買う」')
  assert.ok(read('../components/V2capShop.jsx').includes('戦闘に持ち込むのは合計${CARRY_MAX}つまで'))
})

test('挑戦で使う薬：持っている数・いま買える数（Gold と持てる数の少ないほう）', () => {
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

test('サーバー：挑戦で使う薬の値段と持てる数が同じ・個数を見る・持ち物に入れる（画面から書けるのはこの関数だけ）', () => {
  const s = fnBody('v2cap_shop_buy')
  assert.ok(s.includes(`c_hp_gold      constant int := ${SHOP_ITEM_BY_KEY.hp.gold};`))
  assert.ok(s.includes(`c_mp_gold      constant int := ${SHOP_ITEM_BY_KEY.mp.gold};`))
  assert.ok(s.includes(`c_cure_gold    constant int := ${SHOP_ITEM_BY_KEY.cure.gold};`))
  assert.ok(s.includes(`c_item_max     constant int := ${ITEM_MAX};`))
  assert.ok(s.includes("p_item not in ('gender', 'flip', 'hp', 'mp', 'cure', 'forget')"))
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
  assert.ok(home.includes("{ key:'shop', label:'商店', icon:'🏪', color: SHOP_COLOR }"))
  assert.ok(home.includes("{screen === 'shop' && <V2capShop prof={prof} onProfile={refresh} dev={isAdmin} />}"))
  assert.ok(home.includes('あとから変えるには商店の性別変更薬が必要'), 'キャラ作成の注意書き')
  const shop = read('../components/V2capShop.jsx')
  assert.ok(shop.includes("supabase.rpc('v2cap_shop_buy', "))
  assert.ok(read('../components/V2capStatus.jsx').includes('flipLeftMsOf(prof, now) > 0 && ('))
})
