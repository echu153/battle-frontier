// バトルフロンティアⅡ 装備カタログのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import {
  CATALOG, ITEM_BY_ID, RANKS, RANK_BASE, PLUS_MULT, PARTS, SLOTS,
  WEAPONS, ARMOR_LINES, ACCESSORIES, powerOf, statsOf, slotsFor, itemsOf, typesOf,
} from './equipment.js'
import { calcPower, STAT_KEYS } from './stats.js'

test('カタログは182本（武器70＋防具84＋アクセ28）', () => {
  assert.equal(RANKS.length, 7, 'F〜Sの7段階（SS・SSSは未実装）')
  assert.equal(itemsOf('武器').length, 10 * 7)
  assert.equal(['頭', '鎧', '腕', '足'].reduce((t, p) => t + itemsOf(p).length, 0), 3 * 4 * 7)
  assert.equal(itemsOf('アクセ').length, 4 * 7)
  assert.equal(CATALOG.length, 182)
  assert.equal(Object.keys(ITEM_BY_ID).length, 182, 'idが重複している')
  const names = CATALOG.map(i => i.name)
  assert.equal(new Set(names).size, 182, '名前が重複している')
})

test('ランクの基礎戦闘力は F10 から S70 まで10ずつ', () => {
  RANKS.forEach((r, i) => assert.equal(RANK_BASE[r], 10 + i * 10, r))
})

test('強化は1段階ごとに一律1.5倍', () => {
  assert.equal(PLUS_MULT, 1.5)
  const sword = CATALOG.find(i => i.id === 'w:剣:A')
  assert.equal(powerOf(sword, 0), 60)
  assert.equal(powerOf(sword, 1), 90)
  assert.equal(powerOf(sword, 3), Math.round(60 * 1.5 ** 3))
})

test('枠の倍率（両手2.2倍・鎧1.3倍・アクセ0.8倍）', () => {
  assert.equal(powerOf(CATALOG.find(i => i.id === 'w:剣:A')), 60)        // 片手
  assert.equal(powerOf(CATALOG.find(i => i.id === 'w:大剣:A')), 132)     // 両手 60×2.2
  assert.equal(powerOf(CATALOG.find(i => i.id === 'a:重装:鎧:A')), 78)   // 鎧 60×1.3
  assert.equal(powerOf(CATALOG.find(i => i.id === 'c:リング:A')), 48)    // アクセ 60×0.8
})

test('配分は合計100%で、ステータスの合計が戦闘力と一致する', () => {
  for (const item of CATALOG) {
    const sum = Object.values(item.dist).reduce((a, b) => a + b, 0)
    assert.equal(sum, 100, `${item.name} の配分`)
    for (const k of Object.keys(item.dist)) {
      assert.ok(STAT_KEYS.includes(k), `${item.name} の ${k}`)
      assert.ok(k !== 'hp' && k !== 'mp' && k !== 'luk', `${item.name} に ${k} が載っている`)
    }
    for (const plus of [0, 3, 7]) {
      assert.equal(calcPower(statsOf(item, plus)), powerOf(item, plus), `${item.name}+${plus}`)
    }
  }
})

test('装備で伸びるのは STR/DEX/AGI/VIT/INT の5種だけ', () => {
  // ★HP・MP・LUKは載せない。HPは全ステ中もっとも強く、MPは戦闘中まず尽きないので、
  //   載せると「HP装備一択・MP装備は死に枠」になる
  const used = new Set(CATALOG.flatMap(i => Object.keys(i.dist)))
  assert.deepEqual([...used].sort(), ['agi', 'dex', 'int_stat', 'str', 'vit'])
})

test('着けられる枠が正しい（両手は右手・盾は左手・アクセは2枠）', () => {
  assert.deepEqual(slotsFor(CATALOG.find(i => i.id === 'w:剣:F')), ['right', 'left'])
  assert.deepEqual(slotsFor(CATALOG.find(i => i.id === 'w:大剣:F')), ['right'])
  assert.deepEqual(slotsFor(CATALOG.find(i => i.id === 'w:盾:F')), ['left'])
  assert.deepEqual(slotsFor(CATALOG.find(i => i.id === 'a:重装:頭:F')), ['head'])
  assert.deepEqual(slotsFor(CATALOG.find(i => i.id === 'c:ベルト:F')), ['acc1', 'acc2'])
  assert.equal(SLOTS.length, 8)
})

test('部位は6つで、種類の数が設計どおり', () => {
  assert.deepEqual(PARTS, ['武器', '頭', '鎧', '腕', '足', 'アクセ'])
  assert.equal(typesOf('武器').length, 10, '武器10種')
  assert.equal(Object.keys(WEAPONS).length, 10)
  for (const p of ['頭', '鎧', '腕', '足']) assert.deepEqual(typesOf(p), ARMOR_LINES, `${p}は3系統`)
  assert.deepEqual(typesOf('アクセ'), Object.keys(ACCESSORIES))
  assert.equal(Object.keys(ACCESSORIES).length, 4)
})

test('ランクが上がるほど強い（同じ種類の中で逆転しない）', () => {
  for (const type of typesOf('武器')) {
    let prev = 0
    for (const rank of RANKS) {
      const item = CATALOG.find(i => i.part === '武器' && i.type === type && i.rank === rank)
      const p = powerOf(item)
      assert.ok(p > prev, `${type} ${rank}`)
      prev = p
    }
  }
})

// ★装備枠の名前は SLOT_LABEL だけが正（2026-08-23 実機で画面ごとに違っていた）
//   プロフィールが「頭具/防具/腕具/足具/アクセサリー」、ステータスが「武器（右手）/頭/鎧…」、
//   倉庫が SLOT_LABEL、と3通りあった。ベタ書きが戻ってきたらここで落ちる。
test('装備枠の名前を画面にベタ書きしていない（SLOT_LABELが唯一の正）', () => {
  const dir = new URL('../components/', import.meta.url)
  const OLD = ['頭具', '防具', '腕具', '足具', 'アクセサリー', '武器（右手）', '武器（左手）']
  const bad = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsx')) continue
    const src = readFileSync(new URL(name, dir), 'utf8')
    for (const w of OLD) {
      // コメント行は見逃す（説明で昔の名前に触れることがある）
      const hit = src.split(/\r?\n/).some(l => l.includes(`"${w}"`) || l.includes(`'${w}'`))
      if (hit) bad.push(`${name}: 「${w}」をベタ書きしている`)
    }
  }
  assert.deepEqual(bad, [], bad.join(' / '))
})
