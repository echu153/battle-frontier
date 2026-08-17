// バトルフロンティアⅡ 拠点の釣り場（node --test）
// ------------------------------------------------------------
// ★抽選と付与の権威はサーバー（supabase_v2_core.sql §11）。ここは仕様の固定と、
//   SQLとの突き合わせ、そして**図鑑ボーナスの渡し忘れ検出**をやる。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { totalStats } from './loadout.js'
import {
  DEX_STATS,
  TIERS, TIER_SHORT, TIER_LABEL, TIER_RATE, TIER_PCT, TIER_MEDAL, medalOf,
  SPOT_MAX, FISH_PER_SPOT, SPOTS, spotName, FISH, fishOfSpot,
  ENTRIES, ENTRY_BY_ID, DEX_SLOTS, entryId,
  fishDexPct, fishDexText, dexIdsOf, DEX_FULL_TOTAL,
  fishPerHour, MATERIAL_PCT, EQUIP_PCT, dropAreaMax,
  SHOP_MATERIAL_COST, materialShopCost, PROTECT_COST,
} from './fishing.js'

const SQL = readFileSync(new URL('../../../supabase_v2_core.sql', import.meta.url), 'utf8')
const bodyOf = (name) => {
  const i = SQL.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(i, -1, `${name} がSQLに無い`)
  const end = SQL.indexOf('\n$$;', i)
  assert.notEqual(end, -1, `${name} の終わりが見つからない`)
  return SQL.slice(i, end)
}

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
  assert.equal(dropAreaMax(1), 1)
  assert.equal(dropAreaMax(8), 8)
  assert.equal(dropAreaMax(9), 8)
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

// ===== SQLとの突き合わせ =====
test('魚54種の名前と並びがSQLと fishing.js で一致している', () => {
  const i = SQL.indexOf('insert into public.v2_fish (id, name, spot, idx, tier, stat, pct, medal)')
  assert.notEqual(i, -1, '魚のINSERTがSQLにある')
  const block = SQL.slice(i, SQL.indexOf('on conflict (id) do update', i))
  for (const f of FISH) {
    assert.ok(block.includes(`(${f.spot},${f.idx},'${f.name}')`.replace(/,/g, ', ')) ||
              block.includes(`(${f.spot},${f.idx},'${f.name}')`),
      `${f.name}（第${f.spot}エリア・${f.idx}番）がSQLに無い／位置が違う`)
  }
  // グレードの表
  for (const t of TIERS) {
    assert.ok(block.includes(`('${t}','${TIER_SHORT[t]}',${TIER_PCT[t]},${TIER_MEDAL[t]})`),
      `${TIER_LABEL[t]} の行がSQLと違う`)
  }
  // ステータスの割り当ては「通し番号 % 6」。HPとMPはSQL側の配列にも入っていないこと
  assert.ok(block.includes(`array['${DEX_STATS.join("','")}']`), 'ステータスの並びがSQLと違う')
  assert.doesNotMatch(block, /'hp'|'mp'/, 'HPかMPがSQL側の割り当てに残っている')
  assert.match(block, new RegExp(`\\(\\(f\\.spot - 1\\) \\* 6 \\+ f\\.idx\\) % ${DEX_STATS.length} \\+ 1`),
    '割り当ての式がSQLと違う')
})

test('釣りの数字がSQLと fishing.js で一致している', () => {
  const rate = bodyOf('v2_base_rate')
  assert.match(rate, /2::numeric \+ 0\.5 \* \(greatest\(1, least\(9,/, '匹/h の式')

  const haul = bodyOf('v2_base_fish_haul')
  // グレードの累積（70 / 92 / 99）。TIER_RATE から組み立てて突き合わせる
  let acc = 0
  const cum = TIERS.slice(0, 3).map(t => (acc += TIER_RATE[t]))
  assert.match(haul, new RegExp(`v_r < ${cum[0]} then 'c' when v_r < ${cum[1]} then 'r' when v_r < ${cum[2]} then 'e'`),
    `グレードの抽選が [${cum.join(', ')}] になっていない`)
  assert.match(haul, /v_mat_pct numeric := 1 \+ v_g/, 'ルーン素材の確率')
  assert.match(haul, /v_eq_pct  numeric := 0\.5 \* v_g/, '装備の確率')
  assert.match(haul, /least\(8, v_g\)/, '副産物のエリアの頭打ち')
  assert.match(haul, /floor\(random\(\) \* 6\)/, '6種から選んでいない')
  // 本人以外を弾いている
  assert.match(haul, /p_uid is distinct from auth\.uid\(\)/, '本人以外を弾いていない')

  // 交換所
  const shop = SQL.slice(SQL.indexOf("insert into public.v2_fish_shop (id, label, cost, kind, payload, sort)"))
  for (const [rarity, cost] of Object.entries(SHOP_MATERIAL_COST)) {
    assert.ok(shop.includes(`'${rarity}',`) && shop.includes(`,${cost},`),
      `${rarity} の値段 ${cost} がSQLに無い`)
  }
  assert.ok(shop.includes(`'protect', '{}'::jsonb`) || shop.includes(`${PROTECT_COST}, 'protect'`),
    `保護札 ${PROTECT_COST}枚 がSQLに無い`)
})

test('副産物の装備ランクは「そのエリアの重み」で引く（出撃と同じ分布）', () => {
  // ★drop_ranks は {"F":40,"E":40,"D":20} の重み表。`?` でキーの有無だけを見て
  //   装備から一様に選ぶと、上位ランクが本来よりずっと出やすくなる
  const haul = bodyOf('v2_base_fish_haul')
  assert.match(haul, /jsonb_each_text\(a\.drop_ranks\)/, '重みを読んでいない')
  assert.match(haul, /if v_pick < v_acc then v_rank := v_rec\.rank/, '重みで引いていない')
  assert.match(haul, /where e\.rank = v_rank order by random\(\) limit 1/, '引いたランクで絞っていない')
  assert.doesNotMatch(haul, /drop_ranks \? e\.rank/, 'キーの有無だけで選ぶ書き方が残っている')
  // JS側（出撃）も重みで引いていること
  const enemies = readFileSync(new URL('./enemies.js', import.meta.url), 'utf8')
  assert.match(enemies, /export const rollDropRank[\s\S]{0,240}r -= w/, 'rollDropRank が重みを使っていない')
})

test('釣り場エリアの切り替えは、切り替える前に必ず釣り上げる', () => {
  // ★ここが抜けると、第1エリアで貯めてから第9エリアへ替えるだけで
  //   メダルが最大40倍に化ける（pending は匹数しか持っていないため）
  const body = bodyOf('v2_base_set_spot')
  const collectAt = body.search(/v2_base_collect\('fishing'\)/)
  const updateAt = body.search(/update public\.v2_base_facilities set spot/)
  assert.notEqual(collectAt, -1, '切り替え前に回収していない')
  assert.ok(collectAt < updateAt, '回収より先にエリアを書き換えている')
  assert.match(body, /p_spot > v_grade/, '解放していないエリアを選べてしまう')
})

test('魚→メダルは検証を全部済ませてから引く（部分的に消えない）', () => {
  const body = bodyOf('v2_fish_to_medal')
  const checkAt = body.search(/if v_ok <> v_req then/)
  const updateAt = body.search(/update public\.v2_player_fish/)
  assert.ok(checkAt !== -1 && updateAt !== -1)
  assert.ok(checkAt < updateAt, '検証より前に魚を引いている')
  assert.match(body, /sum\(q\.qty \* f\.medal\)/, '枚数は v2_fish.medal から計算する')
})

test('メダルの交換もメダルを引く前に検証している', () => {
  const body = bodyOf('v2_fish_shop_buy')
  const checkAt = body.search(/if v_have < v_cost then/)
  const payAt = body.search(/update public\.v2_base set fish_medals = fish_medals - v_cost/)
  assert.ok(checkAt !== -1 && payAt !== -1)
  assert.ok(checkAt < payAt, '足りるか見る前にメダルを引いている')
  // 値段はサーバーの表から取る（クライアントの申告を使わない）
  assert.match(body, /v_cost := v_row\.cost::bigint \* v_n/, '値段を v2_fish_shop.cost から取っていない')
})

// ===== 渡し忘れの検出 =====
// ★図鑑ボーナスは**戦闘のステータスに効く**。どこか1か所で fishDex を渡し忘れると、
//   その画面だけ黙って弱くなる（無印の「釣りボーナス消失」と同じ形）。
//   引数の数を数えて、渡し忘れをここで落とす。
const srcFiles = () => {
  const out = []
  for (const dir of ['components', 'pages', 'lib']) {
    const base = new URL(`../${dir}/`, import.meta.url)
    for (const name of readdirSync(base)) {
      if (name.endsWith('.test.js')) continue
      if (!/\.(js|jsx)$/.test(name)) continue
      out.push({ path: `${dir}/${name}`, text: readFileSync(new URL(name, base), 'utf8') })
    }
  }
  return out
}

test('totalStats / toFighter の呼び出しは必ず fishDex まで渡している', () => {
  // 呼び出しの形は「識別子だけを並べた4引数」なので、カンマの数で足りる
  const calls = []
  for (const f of srcFiles()) {
    for (const m of f.text.matchAll(/(?:totalStats|playerFighter)\(([^()]*)\)/g)) {
      // loadout.js の定義（アロー関数の引数）は = の右にあるので除く
      if (/=>\s*$/.test(f.text.slice(m.index - 40, m.index))) continue
      calls.push({ where: `${f.path}: ${m[0]}`, args: m[1].split(',').length, def: false })
    }
    for (const m of f.text.matchAll(/toFighter\((prof[^()]*)\)/g)) {
      calls.push({ where: `${f.path}: ${m[0]}`, args: m[1].split(',').length })
    }
  }
  assert.ok(calls.length >= 5, `呼び出しを拾えている（${calls.length}件）`)
  const bad = calls.filter(c => c.args !== 4)
  assert.deepEqual(bad.map(c => c.where), [],
    `fishDex を渡していない呼び出しがある:\n${bad.map(c => '  ' + c.where).join('\n')}`)
})

test('図鑑は解放していない釣り場を見せない', () => {
  // ★ユーザー指示：未解放のエリア名も、そこの魚の名前も出さない
  const src = readFileSync(new URL('../components/V2Base.jsx', import.meta.url), 'utf8')
  assert.match(src, /SPOTS\.slice\(0, Math\.max\(1, fishing\?\.grade \|\| 1\)\)/,
    '図鑑の釣り場を解放ぶんで切っていない')
  assert.doesNotMatch(src, /spotName\(f\.grade \+ 1\)/, '次の釣り場の名前を先に出している')
  assert.match(src, /SPOTS\.slice\(0, f\.grade\)/, '釣り場の選択ボタンを解放ぶんで切っていない')
})

test('loadout.js の totalStats / toFighter は fishDex を受け取る', () => {
  const src = readFileSync(new URL('./loadout.js', import.meta.url), 'utf8')
  assert.match(src, /export const totalStats = \(profile, inventory, runes, fishDex\)/)
  assert.match(src, /export const toFighter = \(profile, inventory, runes, fishDex\)/)
  assert.match(src, /fishDexPct/, '図鑑ぶんを合流させていない')
})

test('V2Home は戦闘に関わる画面すべてに fishDex を渡している', () => {
  const src = readFileSync(new URL('../pages/V2Home.jsx', import.meta.url), 'utf8')
  for (const c of ['V2Sortie', 'V2Arena', 'V2Status', 'V2Profile', 'V2Base']) {
    // ★JSXの中に `=>` が入るので「> まで」では切れない。タグの頭から一定の長さで見る
    const i = src.indexOf(`<${c} `)
    assert.notEqual(i, -1, `${c} を置いている`)
    assert.match(src.slice(i, i + 400), /fishDex=\{fishDex\}/, `${c} に fishDex を渡していない`)
  }
  assert.match(src, /from\('v2_player_fish'\)/, '図鑑を読み込んでいない')
})
