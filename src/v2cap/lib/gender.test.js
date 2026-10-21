// 「レベルキャップあり」版：キャラクターの性別（2026-10-21 ユーザー指示）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GENDERS, GENDER_BY_KEY, isGender, genderOf, genderFxOf, artGenderOf } from './gender.js'
import { ART_GENDERS } from './classArt.js'
import { toFighter } from './loadout.js'
import { snapshotOf, fromSnapshot } from './tower.js'
import { sexAdjust } from '../../v2/lib/battleSet.js'
import { runBattle } from '../../v2/lib/battle.js'
import { spotOf, toFighter as enemyFighter } from './areas.js'

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('【確定】男性＝与えるダメージ+2%／女性＝受けるダメージ−2%（ユーザーが候補から選んだ）', () => {
  assert.deepEqual(GENDERS.map(g => g.key), ['m', 'f'])
  assert.deepEqual(GENDER_BY_KEY.m.fx, { sexDeal: 2 })
  assert.deepEqual(GENDER_BY_KEY.f.fx, { sexCut: 2 })
  assert.equal(GENDER_BY_KEY.m.text, '与えるダメージ+2%')
  assert.equal(GENDER_BY_KEY.f.text, '受けるダメージ−2%')
  // 名前・記号・色は神殿のイラストの切り替えと同じ
  for (const g of GENDERS) {
    const a = ART_GENDERS.find(x => x.key === g.key)
    assert.deepEqual([g.label, g.mark, g.color], [a.label, a.mark, a.color])
  }
})

test('性別が無い（前からのキャラ）・知らない値は null。絵の男女は性別 → 無ければ神殿の切り替え', () => {
  assert.equal(genderOf({ gender: 'f' }), 'f')
  for (const g of [null, undefined, '', 'x', 'toString', '__proto__']) {
    assert.equal(isGender(g), false, String(g))
    assert.equal(genderOf({ gender: g }), null, String(g))
  }
  assert.equal(genderFxOf(null), null)
  assert.equal(artGenderOf({ gender: 'f' }, 'm'), 'f', 'キャラの性別が先')
  assert.equal(artGenderOf({ gender: null }, 'f'), 'f', '性別が無ければ神殿の切り替え')
  assert.equal(artGenderOf({}, 'x'), 'm', '切り替えも読めなければ男性')
})

test('戦闘のキャラ（toFighter）に性別の能力が乗る。性別が無ければ今までどおり（setFx なし）', () => {
  const prof = { username: 'ためし', class: '剣士', lv: 10, str: 20, hp: 120, mp: 20, equipped: {} }
  assert.equal(toFighter(prof, []).setFx, null, '性別なし・装備なし＝今までと同じ')
  const m = toFighter({ ...prof, gender: 'm' }, []).setFx
  assert.equal(m.sexDeal, 2)
  assert.equal(m.sexCut, undefined)
  assert.equal(m.names.sexDeal, '男性')
  const f = toFighter({ ...prof, gender: 'f' }, []).setFx
  assert.equal(f.sexCut, 2)
  assert.equal(f.sexDeal, undefined)
  // ステと戦闘力は変えない
  assert.deepEqual(toFighter({ ...prof, gender: 'm' }, []).stats, toFighter(prof, []).stats)
})

test('覇天塔：守護者の姿にも性別の能力とアイコンの男女が入る', () => {
  const prof = { username: 'まもり', class: '魔法使い', lv: 30, int_stat: 60, hp: 300, mp: 60, equipped: {}, gender: 'f' }
  const snap = JSON.parse(JSON.stringify(snapshotOf(toFighter(prof, []), { lv: 30, gender: 'f' })))
  assert.equal(snap.setFx.sexCut, 2)
  assert.equal(snap.icon.g, 'f')
  assert.equal(fromSnapshot(snap).setFx.sexCut, 2, '戦うときも効く')
})

test('ダメージの端数は確率で丸める：どの大きさでも平均でちょうど±2%（切り捨てだと序盤の女性が−27%になった）', () => {
  // 一様な乱数（0, 1/N, 2/N …）を順に渡すと、平均は out × 倍率 になる（ずれは小数の誤差で 1/N まで）
  const N = 1000
  for (let out = 1; out <= 120; out++) {
    let m = 0, f = 0
    for (let i = 0; i < N; i++) {
      m += sexAdjust({ setFx: { sexDeal: 2 } }, {}, out, () => i / N)
      f += sexAdjust({}, { setFx: { sexCut: 2 } }, out, () => i / N)
    }
    assert.ok(Math.abs(m / N - out * 1.02) <= 1.5 / N, `男性 ${out}：${m / N}`)
    // 1発の最低は今までどおり1（1ダメージは減らない）。2ダメージからは平均でちょうど−2%
    const want = out === 1 ? 1 : out * 0.98
    assert.ok(Math.abs(f / N - want) <= 1.5 / N, `女性 ${out}：${f / N}`)
  }
  // 男性が女性を撃つ：+2% と −2% の両方（1.02×0.98）
  let both = 0
  for (let i = 0; i < N; i++) both += sexAdjust({ setFx: { sexDeal: 2 } }, { setFx: { sexCut: 2 } }, 50, () => i / N)
  assert.ok(Math.abs(both / N - 50 * 1.02 * 0.98) <= 1.5 / N)
})

test('★性別を持たない戦闘は1つも変わらない（乱数も引かない＝今のⅡ・敵・前からのキャラ）', () => {
  const boom = () => { throw new Error('乱数を引いた') }
  assert.equal(sexAdjust({}, {}, 37, boom), 37)
  assert.equal(sexAdjust(null, { setFx: { takenCut: 5 } }, 37, boom), 37, 'セット能力の受けるダメージ−%は別の項目')
  assert.equal(sexAdjust({ setFx: { dealPct: 5 } }, {}, 37, boom), 37)
})

test('性別のあるキャラで出撃の戦闘が最後まで動く（男女とも）', () => {
  const spot = spotOf(4)
  for (const gender of ['m', 'f']) {
    const me = toFighter({ username: 'ためし', class: '戦士', lv: 15, str: 40, vit: 20, hp: 400, mp: 30, equipped: {}, gender }, [])
    const r = runBattle(me, enemyFighter(spot.roster.enemies[0], 8), { rng: rngOf(11) })
    assert.ok(r.log.length > 0 && r.a.hp !== undefined && r.b.hp !== undefined, gender)
  }
})

test('画面：キャラ作成で性別を送る・前からのキャラはホームで1回だけ選ぶ・アイコンはキャラの性別', () => {
  const home = src('../pages/V2capHome.jsx')
  assert.ok(home.includes("supabase.rpc('v2cap_create_character', { p_username: name.trim(), p_class: pick, p_gender: sex })"))
  assert.ok(home.includes("supabase.rpc('v2cap_set_gender', { p_gender: sex })"))
  assert.ok(home.includes('isHome && !genderOf(prof)'), '性別が無いときだけ出す')
  for (const f of ['../components/V2capSortie.jsx', '../components/V2capTower.jsx']) {
    assert.ok(src(f).includes("artGenderOf(prof, loadPref('capArtGender', 'm'))"), f)
  }
  assert.ok(src('../components/V2capTemple.jsx').includes("useStored('capArtGender', artGenderOf(prof))"))
})
