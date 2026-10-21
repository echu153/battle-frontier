// バトルフロンティアⅡ 拠点の釣り場（node --test）
// ------------------------------------------------------------
// ★仕様の固定（V2 初期構成のサーバー側 supabase_v2_core.sql との突き合わせは、2026-10-22 に SQL ごと消した）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { totalStats } from './loadout.js'
import {
  DEX_STATS,
  TIERS, TIER_LABEL, TIER_RATE, TIER_PCT, TIER_MEDAL, medalOf,
  SPOT_MAX, FISH_PER_SPOT, SPOTS, spotName, FISH, fishOfSpot,
  ENTRIES, ENTRY_BY_ID, DEX_SLOTS, entryId,
  fishDexPct, fishDexText, dexIdsOf, DEX_FULL_TOTAL,
  fishPerHour, MATERIAL_PCT, EQUIP_PCT, dropTierMax,
  SHOP_MATERIAL_COST, materialShopCost, PROTECT_COST,
} from './fishing.js'

// ===== 構成 =====
test('釣り場エリアは9つ・各6種で全54種。図鑑は216枠', () => {
  assert.equal(SPOTS.length, SPOT_MAX)
  assert.equal(FISH.length, SPOT_MAX * FISH_PER_SPOT)
  assert.equal(FISH.length, 54)
  for (let s = 1; s <= SPOT_MAX; s++) assert.equal(fishOfSpot(s).length, FISH_PER_SPOT, `第${s}エリア`)
  assert.equal(DEX_SLOTS, 216)
  assert.equal(new Set(ENTRIES.map(e => e.id)).size, 216, 'IDが重複している')
  assert.equal(new Set(FISH.map(f => f.name)).size, 54, '魚の名前が重複している')
  assert.equal(spotName(1), 'せせらぎの川')
  assert.equal(spotName(9), '天空の泉')
})

test('グレードは4段。出やすさの合計は100%', () => {
  assert.deepEqual(TIERS, ['common', 'rare', 'epic', 'legend'])
  assert.equal(Object.values(TIER_RATE).reduce((a, b) => a + b, 0), 100)
  assert.deepEqual(TIER_RATE, { common: 70, rare: 22, epic: 7, legend: 1 })
  // 上のグレードほど出にくく、もらえるものは大きい
  for (let i = 1; i < TIERS.length; i++) {
    const a = TIERS[i - 1], b = TIERS[i]
    assert.ok(TIER_RATE[b] < TIER_RATE[a], `${TIER_LABEL[b]} が ${TIER_LABEL[a]} より出やすい`)
    assert.ok(TIER_PCT[b] > TIER_PCT[a], `${TIER_LABEL[b]} の図鑑ボーナスが増えていない`)
    assert.ok(TIER_MEDAL[b] > TIER_MEDAL[a], `${TIER_LABEL[b]} のメダルが増えていない`)
  }
})

// ===== 図鑑 =====
test('図鑑ボーナスは 0.1/0.2/0.3/0.4%（ユーザー決定）。全部埋めて合計 +54.0%', () => {
  assert.deepEqual(TIER_PCT, { common: 0.1, rare: 0.2, epic: 0.3, legend: 0.4 })
  assert.equal(DEX_FULL_TOTAL, 54)
  // 1種を4グレードそろえると +1.0%
  const one = ENTRIES.filter(e => e.spot === 1 && e.idx === 0)
  assert.equal(Math.round(one.reduce((t, e) => t + e.pct, 0) * 10) / 10, 1)
})

test('図鑑ボーナスはHPとMP以外の6種に均等（54÷6＝9種ずつ・1ステ +9.0%）', () => {
  // ★ユーザー決定：HPとMPには乗せない
  assert.deepEqual(DEX_STATS, ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk'])
  assert.ok(!DEX_STATS.includes('hp') && !DEX_STATS.includes('mp'))
  const count = {}
  for (const f of FISH) count[f.stat] = (count[f.stat] || 0) + 1
  assert.deepEqual(count, { str: 9, dex: 9, agi: 9, int_stat: 9, vit: 9, luk: 9 })
  // 全部そろえたときの1ステータスあたり
  const full = fishDexPct(ENTRIES.map(e => e.id))
  assert.equal(Object.keys(full).length, 6, 'HPかMPに乗ってしまっている')
  for (const k of DEX_STATS) assert.equal(full[k], 9, `${k} が+9.0%になっていない`)
  assert.equal(Object.values(full).reduce((a, b) => a + b, 0), DEX_FULL_TOTAL)
})

test('図鑑ボーナスは「初めて釣った枠」だけ数える（所持数では増えない）', () => {
  const id = entryId(1, 0, 'common')
  // first_at が入っていない行は対象外
  assert.deepEqual(fishDexPct([{ fish_id: id, qty: 99, first_at: null }]), {})
  assert.deepEqual(dexIdsOf([{ fish_id: id, qty: 99, first_at: null }]), [])
  const pct = fishDexPct([{ fish_id: id, qty: 99, first_at: '2026-08-17T00:00:00Z' }])
  assert.equal(pct[ENTRY_BY_ID[id].stat], 0.1, '何匹釣っても1枠ぶん')
  // 同じ枠を2行で送っても増えない形になっていること（実データでは主キーで1行）
  assert.deepEqual(fishDexPct(['nope']), {}, '知らないIDは無視する')
  assert.deepEqual(fishDexPct(null), {})
  assert.match(fishDexText([id]), /\+0\.1%/)
})

test('図鑑の行は2つの形のどちらでも読める（v2_player_fish の fish_id / base_get の id）', () => {
  // ★ v2_player_fish を直接読むと fish_id、v2_base_get() の返り値だと id。
  //   片方しか見ていないと、その画面だけ図鑑が空に見える（実際に拠点の画面で起きた）
  const id = entryId(1, 0, 'legend')
  const stat = ENTRY_BY_ID[id].stat
  assert.equal(fishDexPct([{ fish_id: id, qty: 1, first_at: '2026-08-17T00:00:00Z' }])[stat], 0.4)
  assert.equal(fishDexPct([{ id, qty: 1, first_at: '2026-08-17T00:00:00Z' }])[stat], 0.4)
  assert.deepEqual(dexIdsOf([{ id, qty: 1, first_at: null }]), [], 'first_at が無い行は対象外')
})

test('図鑑ボーナスは totalStats に乗る（ルーンと同じ%の枠）', () => {
  const prof = { str: 100, hp: 100, mp: 100, dex: 100, agi: 100, int_stat: 100, vit: 100, luk: 100 }
  const base = totalStats(prof, [], [], [])
  // STR の魚を4グレードそろえる＝ +1.0%
  const strFish = FISH.find(f => f.stat === 'str')
  const ids = TIERS.map(t => entryId(strFish.spot, strFish.idx, t))
  const withDex = totalStats(prof, [], [], ids)
  assert.equal(base.str, 100)
  assert.equal(withDex.str, 101, '図鑑ぶんが乗っていない')
  assert.equal(withDex.hp, 100, '関係ないステータスまで上がっている')
})

// ===== レートと副産物 =====
test('釣り場のレートと副産物はグレードで上がる', () => {
  assert.equal(fishPerHour(1), 2)
  assert.equal(fishPerHour(9), 6)
  assert.equal(fishPerHour(1) * 8, 16, 'グレード1は8時間で16匹')
  assert.equal(fishPerHour(9) * 8, 48, 'グレード9は8時間で48匹')
  assert.equal(MATERIAL_PCT(1), 2)
  assert.equal(MATERIAL_PCT(9), 10)
  assert.equal(EQUIP_PCT(1), 0.5)
  assert.equal(EQUIP_PCT(9), 4.5)
  // 副産物のエリアは**釣り場グレードと同じ番号まで**（エリアは⑧までなので頭打ち）
  assert.equal(dropTierMax(1), 1)
  assert.equal(dropTierMax(8), 8)
  assert.equal(dropTierMax(9), 8)
})

test('メダルの枚数 ＝ 釣り場エリア番号 × グレード倍率', () => {
  assert.equal(medalOf(1, 'common'), 1)
  assert.equal(medalOf(9, 'legend'), 360)
  assert.equal(ENTRY_BY_ID[entryId(9, 0, 'legend')].medal, 360)
})

test('交換所の値段', () => {
  assert.deepEqual(SHOP_MATERIAL_COST, { normal: 10, rare: 40, ultra: 200 })
  assert.equal(materialShopCost(1, 'normal'), 10)
  assert.equal(materialShopCost(8, 'ultra'), 1600)
  assert.equal(PROTECT_COST, 150)
})

test('出撃の装備ランクは「そのエリアの重み」で引く（rollDropRank）', () => {
  // ★drop_ranks は {"F":40,"E":40,"D":20} の重み表。キーの有無だけを見て装備から一様に選ぶと、
  //   上位ランクが本来よりずっと出やすくなる（釣りの副産物の SQL の確かめは 2026-10-22 に SQL ごと消した）
  const enemies = readFileSync(new URL('./enemies.js', import.meta.url), 'utf8')
  assert.match(enemies, /export const rollDropRank[\s\S]{0,240}r -= w/, 'rollDropRank が重みを使っていない')
})

// ===== 渡し忘れの検出 =====
// ★図鑑ボーナスは**戦闘のステータスに効く**。（2026-10-22 V2 初期構成の画面を消したので、
//   画面ごとの渡し忘れを数えるテストも外した。v2cap は釣り・ペットを使わない）
// ★2026-08-26：モンスター図鑑（討伐数・素材の初回登録）も戦闘のステに効くので、
//   dex も最後まで渡す必要がある。渡し忘れると黙って弱くなる
test('loadout.js の totalStats / toFighter は fishDex と dex を受け取る', () => {
  const src = readFileSync(new URL('./loadout.js', import.meta.url), 'utf8')
  assert.match(src, /export const totalStats = \(profile, inventory, runes, fishDex, dex, pet\)/)
  assert.match(src, /export const toFighter = \(profile, inventory, runes, fishDex, dex, pet\)/)
  assert.match(src, /fishDexPct/, '釣り図鑑ぶんを合流させていない')
  assert.match(src, /dexStats\(dex\?\.kills, dex\?\.found\)/, 'モンスター図鑑ぶんを合流させていない')
  assert.match(src, /petStatsOf\(pet \|\| \{\}\)/, 'ペットぶんを合流させていない')
})
