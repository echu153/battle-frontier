import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ITEM_BY_ID, KINDS, RARITY_COLOR, ALL_RARITIES } from './equipment.js'
import { isSetPiece } from './armorSets.js'
import { GEAR_ART } from './gearArtList.js'
import {
  GEAR_SHEETS, SHEET_CELLS, SHEET_BG, GEAR_FALLBACK, gearArtKeyOf, gearArtSrcOf, gearFallbackOf, gearTierOf, isLavish,
  gearSheetPromptOf, gearArtProgress, GEAR_SHEET_BY_ID,
} from './gearArt.js'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'

const ALL = Object.values(ITEM_BY_ID)
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('【確定】2026-11-23 装備の絵：全部の装備（1,655個）がちょうど1つのマスを持ち、絵の名前は英数字だけでかぶらない', () => {
  const cells = GEAR_SHEETS.flatMap(s => s.items)
  assert.equal(cells.length, ALL.length, 'シートのマスの数＝装備の数')
  assert.equal(new Set(cells.map(i => i.id)).size, ALL.length, '同じ装備が2つのマスに無い')
  for (const item of ALL) assert.ok(cells.includes(item), `${item.name} がどのシートにも無い`)
  const keys = ALL.map(gearArtKeyOf)
  assert.equal(new Set(keys).size, ALL.length, '絵の名前がかぶらない')
  for (const k of keys) assert.match(k, /^[A-Za-z0-9-]+$/, `${k} は英数字だけ（ファイル名）`)
  assert.equal(new Set(GEAR_SHEETS.map(s => s.id)).size, GEAR_SHEETS.length, 'シートの名前がかぶらない')
  for (const s of GEAR_SHEETS) assert.ok(s.items.length > 0 && s.items.length <= SHEET_CELLS, `${s.id} は1〜16個`)
})

test('【確定】2026-11-23 描いてもらう順は珍しい順（ユニーク→四凶→レジェンダリー→エピック→レア→ノーマル→初期装備）', () => {
  const order = [...new Set(GEAR_SHEETS.map(s => s.id.replace(/[-0-9].*$/, '')))]
  assert.deepEqual(order, ['U', 'C', 'L', 'E', 'R', 'N', 'S'])
  assert.equal(GEAR_SHEETS.filter(s => s.id.startsWith('U')).flatMap(s => s.items).length, 64, 'ユニークは64個（出撃60＋四凶4）')
})

test('【確定】2026-11-23 ユーザー「セット装備は全体を合わせて」：防具のセット（同じエリア×同じ系統の4部位）は同じシートに並び、頼み方にそろえる指示が入る', () => {
  const sheetOf = new Map(GEAR_SHEETS.flatMap(s => s.items.map(i => [i.id, s])))
  const sets = new Map()
  for (const item of ALL.filter(i => i.line && !i.boss)) {
    const k = `${item.area}${item.rarity}:${item.line}`
    sets.set(k, [...(sets.get(k) || []), item])
  }
  for (const [k, items] of sets) {
    assert.equal(items.length, 4, `${k} は4部位`)
    assert.equal(new Set(items.map(i => sheetOf.get(i.id).id)).size, 1, `${k} の4部位が同じシート`)
  }
  const p = gearSheetPromptOf(GEAR_SHEET_BY_ID['L-armor01'])
  assert.match(p, /【セット】/)
  assert.match(p, /1・2・3・4番＝「.+」の重鎧の一揃い/)
  assert.ok(GEAR_SHEET_BY_ID['L-armor01'].items.every(isSetPiece), 'レジェンダリーの防具はセットの部位')
})

test('⚠シートの並びは変えない（描いてもらったシートのマスと装備がずれる）。装備を足すときは、新しいシートを後ろに足してこの印を直す', () => {
  let h = 5381
  for (const ch of GEAR_SHEETS.map(s => `${s.id}:${s.items.map(gearArtKeyOf).join(',')}`).join('|')) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0
  assert.equal(h, 3968320830)
})

test('頼み方：全部の装備の名前・背景の色・並べ方・等級の豪華さが入る（ユーザー「レジェンダリー以上はレアな装備ってわかるように豪華に」）', () => {
  for (const s of GEAR_SHEETS) {
    const p = gearSheetPromptOf(s)
    for (const item of s.items) assert.ok(p.includes(item.name), `${s.id} に ${item.name}`)
    assert.ok(p.includes(SHEET_BG) && p.includes('4列×4段'), `${s.id} の並べ方と背景`)
    if (s.items.length < SHEET_CELLS) assert.ok(p.includes(`最後の${SHEET_CELLS - s.items.length}マスは何も描かない`), `${s.id} の空のマス`)
  }
  for (const id of ['U01', 'C01', 'L-other01']) assert.match(gearSheetPromptOf(GEAR_SHEET_BY_ID[id]), /豪華に|いちばん豪華/, `${id} は豪華に`)
  assert.doesNotMatch(gearSheetPromptOf(GEAR_SHEET_BY_ID['N-other01']), /豪華に/, 'ノーマルは素朴に')
})

test('【確定】2026-11-24 ユーザー「描き直す」：頼む文は装飾品が何の装飾品か（指輪・耳飾り・ベルト・首飾り）と形を書く・1個だけ描き直す文もある', async () => {
  const { gearOnePromptOf, gearOneFileOf } = await import('./gearArt.js')
  // 四凶のシートで、「装飾品」としか書いていなかったリングが珠の飾りに、イヤリングが指輪に描かれた
  const c = gearSheetPromptOf(GEAR_SHEET_BY_ID['C01'])
  assert.ok(c.includes('水禍の蒼珠（装飾品・指輪）') && c.includes('神雷の環（装飾品・耳飾り）') && c.includes('六道輪廻の数珠（装飾品・首飾り）'))
  assert.match(c, /・指輪＝指にはめる輪/)
  assert.match(c, /・耳飾り＝左右一組を並べる/)
  for (const s of GEAR_SHEETS) {
    const p = gearSheetPromptOf(s)
    assert.doesNotMatch(p, /（装飾品）/, `${s.id} に種類の無い「装飾品」`)
  }
  assert.doesNotMatch(gearSheetPromptOf(GEAR_SHEET_BY_ID['L-armor01']), /指輪＝|ベルト＝/, '防具だけのシートに装飾品の説明は入れない')
  const ring = ITEM_BY_ID['C11:zerugiasu:イヤリング']
  assert.equal(gearOneFileOf(ring), 'C11-zerugiasu-k24.png')
  const one = gearOnePromptOf(ring)
  assert.ok(one.includes('1個だけ') && one.includes('神雷の環（装飾品・耳飾り）') && one.includes('指輪・腕輪にはしない') && one.includes(SHEET_BG) && one.includes('豪華に'))
  assert.match(read('../../../tools/v2cap-gear-art.mjs'), /GEAR_ONE_DIR/, '道具が1個だけの絵をシートより優先して使う')
})

test('等級：枠の色は5等級とも違う・豪華に見せるのはレジェンダリーとユニーク（四凶の専用装備はレジェンダリー）', () => {
  assert.equal(new Set(ALL_RARITIES.map(r => RARITY_COLOR[r])).size, 5)
  assert.deepEqual([...new Set(ALL.map(gearTierOf))].sort(), ['E', 'L', 'N', 'R', 'U'])
  for (const item of ALL) assert.equal(isLavish(item), ['L', 'U'].includes(item.rarity), item.name)
  assert.equal(gearTierOf(ITEM_BY_ID['C11:varuzenoku:両手剣']), 'L')
  assert.equal(gearTierOf(ITEM_BY_ID['UC:enma:ネックレス']), 'U')
  // 画面の枠：等級ごとの作りがあり、動きはレジェンダリーとユニークだけ・視差効果を減らす端末では止める
  const src = read('../components/V2capGearIcon.jsx')
  for (const t of ['N', 'R', 'E', 'L', 'U']) assert.match(src, new RegExp(`\\n  ${t}: \\{ border`), `${t} の枠`)
  assert.match(src, /L: \{[^}]*sweep: true/)
  assert.doesNotMatch(src, /corners|CORNERS|#fff6c9/, '【確定】2026-11-23 ユーザー「四隅の白い枠いらない、」＝四隅の飾りは付けない')
  assert.match(src, /U: \{[^}]*aura: true[^}]*sparks: true/)
  assert.doesNotMatch(src, /\n  [NRE]: \{[^}]*(sweep|aura|sparks)/, 'ノーマル・レア・エピックは動かさない')
  assert.match(src, /prefers-reduced-motion: reduce/)
})

test('絵がまだ無い装備は種類ごとの仮のアイコン・一覧の絵は public にあって印が中身と合う', () => {
  for (const k of KINDS) assert.ok(GEAR_FALLBACK[k.key], `${k.key} の仮のアイコン`)
  const keys = new Set(ALL.map(gearArtKeyOf))
  for (const key of Object.keys(GEAR_ART)) assert.ok(keys.has(key), `${key} は装備に無い`)
  let done = 0
  for (const item of ALL) {
    const src = gearArtSrcOf(item)
    if (!GEAR_ART[gearArtKeyOf(item)]) { assert.equal(src, null); assert.ok(gearFallbackOf(item)); continue }
    done++
    const file = new URL(`../../../public${src.split('?')[0]}`, import.meta.url)
    assert.ok(existsSync(file) && statSync(file).size < 40 * 1024, `${item.name} の絵は軽い`)
    assert.equal(src.split('?v=')[1], versionOf(fileURLToPath(file)), `${item.name} の印（node tools/v2cap-gear-art.mjs をやり直す）`)
  }
  assert.deepEqual(gearArtProgress(), { done, total: ALL.length })
  assert.equal(gearArtSrcOf(ALL[0], { [gearArtKeyOf(ALL[0])]: { v: 'abc' } }), `/v2cap-art/gear/${gearArtKeyOf(ALL[0])}.webp?v=abc`)
})

test('装備の絵の枠を出す画面：装備・鍛冶屋・ステータス・挑戦の報酬', () => {
  for (const f of ['V2capEquip', 'V2capSmith', 'V2capStatus', 'V2capBossReward']) {
    assert.match(read(`../components/${f}.jsx`), /<GearIcon /, `${f} に絵の枠`)
  }
})
