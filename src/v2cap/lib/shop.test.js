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
  otherGenderOf, flipLeftMsOf, encounterClockOf, encounterBandOf, flipPreviewOf,
} from './shop.js'

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

test('【確定】品物は2つ：性別変更薬 30,000G・日月反転の秘薬 3,000G（ユーザーが候補から選んだ）', () => {
  assert.deepEqual(SHOP_ITEMS.map(i => [i.key, i.name, i.gold]), [['gender', '性別変更薬', 30000], ['flip', '日月反転の秘薬', 3000]])
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
  const SORTIE = read('../components/V2capSortie.jsx')
  assert.ok(SORTIE.includes('pickEncounter(spot.id, bossRate, encounterClockOf(prof))'), '出撃は秘薬ぶんの時刻を渡す')
  assert.ok(SORTIE.includes('rollEquipDrop(enc, prof.class, new Date(),'), '落ちやすい部位は本当の時刻のまま')
  assert.equal(SORTIE.match(/pickEncounter\(/g).length, 1, '敵を決めるのはここだけ')
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
  assert.ok(SQL.includes('revoke all on function public.v2cap_shop_buy(text) from public, anon;'))
  assert.ok(SQL.includes('grant execute on function public.v2cap_shop_buy(text) to authenticated;'))
})

test('画面：ホームの施設に商店・買うのはサーバー・効いているあいだはステータスに出す', () => {
  const home = read('../pages/V2capHome.jsx')
  assert.ok(home.includes("{ key:'shop', label:'商店', icon:'🏪', color: SHOP_COLOR, action:'薬を買う' }"))
  assert.ok(home.includes("{screen === 'shop' && <V2capShop prof={prof} onProfile={refresh} dev={isAdmin} />}"))
  assert.ok(home.includes("if (m.key === 'shop' && flip > 0) return { ...m, action:`日月反転中（${leftText(flip)}）` }"))
  assert.ok(home.includes('あとから変えるには商店の性別変更薬が必要'), 'キャラ作成の注意書き')
  const shop = read('../components/V2capShop.jsx')
  assert.ok(shop.includes("supabase.rpc('v2cap_shop_buy', { p_item: confirm })"))
  assert.ok(read('../components/V2capStatus.jsx').includes('flipLeftMsOf(prof, now) > 0 && ('))
})
