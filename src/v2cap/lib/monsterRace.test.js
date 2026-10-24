// v2cap：モンスターの種族を固定するテスト（node --test）
// 【確定】2026-10-25 ユーザー指示「モンスターに種族を追加したい、モンスター図鑑ではそれを分かるように」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RACES, RACE_BY_KEY, RACE_NAMES, RACE_OF, raceOf, raceDefOf } from './monsterRace.js'
import { DEX_ALL } from './dex.js'
import { SPECIAL_ENEMIES } from './monsters.js'
import { SPOTS, toFighter } from './areas.js'
import { shrineEncounterOf } from './shrine.js'
import { ICHIJI_SKILLS } from './skillsIchiji.js'
import { SKILL_BY_NAME, passiveOf } from './skills.js'
import { attackKindOf } from './jobs.js'
import { createSide, takeAction } from '../core/battle.js'

const ALL_NAMES = [...DEX_ALL.map(e => e.name), ...SPECIAL_ENEMIES.map(e => e.name)]

test('【確定】種族は11（ユーザーが選んだ「7種族＋天使」に、獣・海洋・昆虫を分けた）', () => {
  // 「獣、海洋、昆虫　を分けて、後は魔物でいい／獣にとりは含まれる」
  assert.deepEqual(RACES.map(r => r.label), ['人間', '亜人', 'ドラゴン', '妖精', 'アンデッド', '悪魔', '天使', '獣', '海洋', '昆虫', '魔物'])
  assert.deepEqual(Object.keys(RACE_NAMES), RACES.map(r => r.key), '名簿は種族の並びのとおり')
  for (const r of RACES) assert.ok(/^#[0-9a-f]{6}$/.test(r.color), `${r.label} の札の色`)
  assert.equal(new Set(RACES.map(r => r.color)).size, RACES.length, '札の色はどれも違う')
})

test('全部のモンスター（15エリア×20体＋祠のハピネスフェアリー）に種族が1つずつ。名簿にいない名前は無い', () => {
  const listed = Object.values(RACE_NAMES).flat()
  assert.equal(listed.length, new Set(listed).size, '同じモンスターを2つの種族に書いていない')
  for (const n of ALL_NAMES) assert.ok(RACE_BY_KEY[raceOf(n)], `${n} に種族がある`)
  for (const n of listed) assert.ok(ALL_NAMES.includes(n), `${n} はモンスターの一覧にいる（名前を変えたら名簿も直す）`)
  assert.equal(listed.length, 301)
  assert.equal(raceOf('いないモンスター'), null)
  assert.equal(raceDefOf('いないモンスター'), null)
})

test('【確定】案のシートでユーザーが確かめた数と直し', () => {
  const count = Object.fromEntries(RACES.map(r => [r.label, RACE_NAMES[r.key].length]))
  assert.deepEqual(count, { 人間: 14, 亜人: 29, ドラゴン: 30, 妖精: 21, アンデッド: 23, 悪魔: 14, 天使: 7, 獣: 53, 海洋: 23, 昆虫: 21, 魔物: 66 })
  // ユーザーの直し「雪男：獣→亜人／大司書ノクトゥア：獣→魔物」「カエルとか蛇、カメとか（は魔物）　トカゲはドラゴンでもよさそう」
  assert.equal(raceOf('雪男'), 'demihuman')
  assert.equal(raceOf('イエティロード'), 'demihuman', '雪男の上位も合わせる')
  assert.equal(raceOf('大司書ノクトゥア'), 'monster')
  for (const n of ['モヤガエル', 'オオヒキガエル', 'ポイズンフロッグ', 'つるヘビ', '熱砂コブラ', '双頭ヌマヘビ', 'カミツキガメ', '岩甲亀ヴォルカン']) assert.equal(raceOf(n), 'monster', n)
  for (const n of ['ひなたトカゲ', 'サンリザード', '陽炎リザード', '石化トカゲ', 'カゲロウトカゲ', 'ミラージュリザード', 'スパークリザード', '火吹きトカゲ']) assert.equal(raceOf(n), 'dragon', n)
  // 獣に鳥は入る（ユーザー「獣にとりは含まれる」）。海の生き物は海洋（海の上を飛ぶトビウオも）・クモとサソリは昆虫
  for (const n of ['ツキミミズク', '炎天ハゲタカ', 'ロック鳥', '雛フェニックス']) assert.equal(raceOf(n), 'beast', n)
  for (const n of ['イリエザメ', 'ギンバネトビウオ', 'ダイオウイカ', 'グレートホエール']) assert.equal(raceOf(n), 'aquatic', n)
  for (const n of ['ホラアナグモ', 'サンドスコーピオン', 'オオアリ']) assert.equal(raceOf(n), 'insect', n)
  // 異端審問官の技が効くもの（アンデッドと悪魔）
  assert.equal(raceOf('スケルトン'), 'undead')
  assert.equal(raceOf('アークデーモン'), 'demon')
  assert.equal(raceOf('ハピネスフェアリー'), 'fairy')
})

test('技が狙う種族（vsRace・vsRaceOrAil）は、どれも名簿にある種族', () => {
  const used = new Set()
  for (const s of ICHIJI_SKILLS) {
    for (const v of [s.vsRace, s.passive?.vsRace, s.passive?.vsRaceOrAil, s.vsRaceOrAil]) for (const k of v?.races || []) used.add(k)
  }
  assert.ok(used.has('undead') && used.has('demon'), '異端審問官はアンデッドと悪魔')
  for (const k of used) assert.ok(RACE_BY_KEY[k], `技が使う種族 ${k} が名簿にある`)
  for (const k of used) assert.ok(RACE_NAMES[k].length > 0, `${k} の敵が1体以上いる（技が空振りしない）`)
})

test('戦闘：敵の fighter に種族が入る（どの場所の敵も・祠のハピネスフェアリーも）', () => {
  for (const spot of SPOTS) {
    const r = spot.roster
    for (const e of [...r.enemies, ...r.timed, ...r.rares, r.boss]) assert.equal(toFighter(e).race, RACE_OF[e.name], `${spot.id} ${e.name}`)
  }
  const sh = shrineEncounterOf(1)
  assert.equal(toFighter(sh.enemy, 8, sh.power).race, 'fairy')
})

test('戦闘：異端審問官の破魔の光は、アンデッドと悪魔に 1.3倍×退魔の心得+20%（魔物などはそのまま）', () => {
  const stats = { hp: 10000, mp: 2000, str: 300, dex: 150, agi: 150, int_stat: 300, vit: 150, luk: 30 }
  const hit = (race) => {
    const cls = '異端審問官'
    const me = createSide({ name: '審', cls, kind: attackKindOf(cls), stats, noClassBonus: true,
      slots: [{ skill: SKILL_BY_NAME['破魔の光'], uses: 9 }], passives: [passiveOf(cls)] })
    const foe = createSide({ name: '的', cls: null, kind: 'phys', race, stats: { ...stats, hp: 10000000 }, slots: [], passives: [], noClassBonus: true })
    const log = []
    takeAction(me, foe, () => 0.5, log)
    return log.find(l => l.type === 'skill' && l.skill === '破魔の光').damage
  }
  const base = hit('monster')
  assert.ok(Math.abs(hit('undead') / base - 1.3 * 1.2) < 0.02, `アンデッド ${hit('undead')} ／ 魔物 ${base}`)
  assert.ok(Math.abs(hit('demon') / base - 1.3 * 1.2) < 0.02, '悪魔')
  assert.equal(hit('angel'), base, '天使には効かない')
  assert.equal(hit(null), base, '種族の無い相手（対人）にも効かない')
})

test('図鑑：倒した敵の行と大きく出す小窓に種族の札。倒すまでは出さない。HELP に種族の一覧', () => {
  const ui = readFileSync(new URL('../components/V2capDex.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('{found && <RaceTag name={e.name} />}'), '行は倒してから')
  assert.ok(ui.includes('<RaceTag name={e.name} size={11} />'), '大きく出す小窓の上の帯')
  // 札はモンスター名のすぐ後ろ（2026-10-25 ユーザー指示「モンスター名の後に種族が来るようにして」）。行も大きく出す小窓も
  const row = ui.indexOf("{found ? e.name : '???'}</span>")
  assert.ok(row > 0 && ui.indexOf('{found && <RaceTag name={e.name} />}') > row, '行：名前 → 種族')
  assert.ok(ui.indexOf('{found && <RaceTag name={e.name} />}') - row < 80, '行：名前のすぐ後ろ（間にほかの札を挟まない）')
  const zoom = ui.slice(ui.indexOf('function ZoomModal'))
  const zName = zoom.indexOf('}}>{e.name}</span>'), zRace = zoom.indexOf('<RaceTag name={e.name} size={11} />'), zRole = zoom.indexOf('{role.label}')
  assert.ok(zName > 0 && zName < zRace && zRace < zRole, '大きく出す小窓：名前 → 種族 → 役割の札')
  assert.ok(ui.includes("モンスターには種族があります（{RACES.map(r => r.label).join('・')}）。"))
})
