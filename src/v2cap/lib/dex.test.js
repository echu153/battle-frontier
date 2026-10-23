// v2cap：モンスター図鑑の決まりを固定するテスト（node --test）
// 【確定】2026-10-11 ユーザー指示「モンスター図鑑…を加えて」（まずは見るだけ）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AREA_LIST } from './areas.js'
import { DEX_ROLES, DEX_ALL, DEX_TOTAL, DEX_AREA_COUNT, dexAreaOf, dropInfoOf, killsOf, isFound, dexProgressOf } from './dex.js'

test('図鑑は15エリア×20体＝300体。どの敵も1回ずつ（名前がかぶらない）', () => {
  assert.equal(DEX_AREA_COUNT, AREA_LIST.length)
  assert.equal(DEX_TOTAL, 300)
  assert.equal(new Set(DEX_ALL.map(e => e.name)).size, 300)
  for (let a = 1; a <= DEX_AREA_COUNT; a++) assert.equal(dexAreaOf(a).length, 20, `エリア${a}`)
  assert.deepEqual(dexAreaOf(0), [])
  assert.deepEqual(dexAreaOf(16), [])
})

test('1エリアの並びは 通常6 → 時間帯6 → レア5 → ボス3（ボスは①②③の順）。どの敵も出る場所がある', () => {
  assert.deepEqual(DEX_ROLES.map(r => r.key), ['normal', 'timed', 'rare', 'boss'])
  for (let a = 1; a <= DEX_AREA_COUNT; a++) {
    const rows = dexAreaOf(a)
    assert.deepEqual(rows.map(e => e.role), [...Array(6).fill('normal'), ...Array(6).fill('timed'), ...Array(5).fill('rare'), ...Array(3).fill('boss')], `エリア${a}`)
    assert.deepEqual(rows.slice(-3).map(e => e.subs), [[1], [2], [3]], `エリア${a}のボス`)
    for (const e of rows) {
      assert.ok(e.spots.length > 0, `${e.name}の出る場所`)
      assert.ok(e.spots.every(s => Math.ceil(s / 3) === a), `${e.name}はエリア${a}の場所にだけ出る`)
      assert.ok(e.lv >= 1)
      assert.ok(['phys', 'mag'].includes(e.kind))
    }
    for (const e of rows.filter(x => x.role === 'timed')) assert.ok(['朝', '昼', '晩'].includes(e.band), `${e.name}の時間帯`)
  }
  // エリア1の例（始まりの森）
  const a1 = dexAreaOf(1)
  assert.equal(a1[0].name, 'スライム')
  assert.deepEqual(a1[0].subs, [1, 2])
  assert.equal(a1[19].name, 'ビッグスライム')
  assert.equal(dexAreaOf(15)[19].lv, 80, '最後のボスはLV80')
})

test('落とす装備は役割で決まる：ふつう・時間帯は8%でノーマル・レア／レアは30%でエピックまで／ボスは60%でレジェンダリーまで', () => {
  // ふつう・時間帯は 2026-10-12 ユーザー指示「装備のドロップ率渋すぎるから8％にして」で 3→8
  // レア・ボスは 2026-10-22 ユーザー指示「レアのモンスターから装備ドロップする確率3倍にして、ボスは６倍」で 10→30・10→60（落ちるレア度は同じ）
  assert.deepEqual(dropInfoOf('normal'), { chance: 8, rarities: ['N', 'R'] })
  assert.deepEqual(dropInfoOf('timed'), { chance: 8, rarities: ['N', 'R'] })
  assert.deepEqual(dropInfoOf('rare'), { chance: 30, rarities: ['N', 'R', 'E'] })
  assert.deepEqual(dropInfoOf('boss'), { chance: 60, rarities: ['N', 'R', 'E', 'L'] })
})

test('【確定】2026-10-24 図鑑にユニークの情報は載せない（ボスの行にも）。説明は HELP・「残り◯エリアは、行くと載ります」は出さない', () => {
  // ユーザー指示「モンスター図鑑、ユニーク装備の情報はすべて削除」（2026-10-21 からボスの行に名前と能力を出していた）
  for (const e of DEX_ALL) {
    const d = dropInfoOf(e.role, e)
    assert.ok(!('uniques' in d), `${e.name}：ユニークを持たない`)
    assert.ok(!d.rarities.includes('U'), `${e.name}：出るレア度にユニークは無い`)
  }
  const ui = readFileSync(new URL('../components/V2capDex.jsx', import.meta.url), 'utf8')
  const code = ui.split(/\r?\n/).filter(l => !/^\s*(\/\/|\{\/\*)/.test(l)).join('\n')   // 注の行は見ない
  for (const w of ['ユニーク', 'UniqueText', 'uniques', "RARITY_COLOR.U"]) assert.ok(!code.includes(w), `図鑑の画面に「${w}」が無い`)
  // 説明の3文は HELP の小窓へ（ユーザー「←これはHELPに」）。「残り◯エリアは、行くと載ります」はやめた（ユーザー「←これいらない」）
  const help = code.slice(code.indexOf('<V2Modal title="❓ HELP"'), code.indexOf('</V2Modal>'))
  for (const t of ['出撃で倒した敵が載ります（倒すまでは名前もLVも ???）。', '討伐数は出撃で勝ったときに数えます。', '落とす装備はそのエリアの装備です。']) {
    assert.ok(help.includes(t), `HELP に「${t}」`)
    assert.equal(code.split(t).length, 2, `「${t}」は HELP の中だけ`)
  }
  assert.ok(!code.includes('行くと載ります'))
  // 倒した敵の絵をタップすると大きく出す（大きい版・読めなければ小さい版）
  assert.ok(code.includes('const canZoom = found && !!art'), '倒していない敵（影）は大きくしない')
  assert.ok(code.includes('enemyArtBigSrc(e.name) || enemyArtSrc(e.name)'))
})

test('倒すまでは見つけていない（???）。見つけた数と割合', () => {
  const kills = { スライム: 12, コウモリ: 0, ビッグスライム: 1 }
  assert.equal(isFound(kills, 'スライム'), true)
  assert.equal(isFound(kills, 'コウモリ'), false)
  assert.equal(isFound({}, 'スライム'), false)
  assert.equal(killsOf(kills, 'スライム'), 12)
  assert.equal(killsOf(null, 'スライム'), 0)
  assert.deepEqual(dexProgressOf(dexAreaOf(1), kills), { done: 2, total: 20, pct: 10 })
  assert.deepEqual(dexProgressOf([], kills), { done: 0, total: 0, pct: 0 })
})
