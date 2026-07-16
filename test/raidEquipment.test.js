import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { RAID_EQUIP_NAMES, isRaidEquip } from '../src/constants/raidEquipment.js'
import { isEvolvableEquip } from '../src/constants/bossEvolution.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// exchange_shop へ INSERT される装備（type='weapon'）を SQL 群から抽出する。
// レイド装備を SQL に足したのに RAID_EQUIP_NAMES への追加を忘れる＝ランダム加工で溶かせてしまう、を検出する。
const sqlWeaponNames = () => {
  const names = new Set()
  for (const f of readdirSync(repoRoot).filter(n => n.endsWith('.sql'))) {
    const sql = readFileSync(join(repoRoot, f), 'utf8')
    for (const m of sql.matchAll(/'weapon',\s*'([^']+)'/g)) {
      // weapons テーブルの slot 列など、装備名でないものを弾く（'weapon','s' 等）
      if (m[1].length > 1) names.add(m[1])
    }
  }
  return names
}

test('RAID_EQUIP_NAMES は exchange_shop の装備(type=weapon)を全て網羅している', () => {
  const missing = [...sqlWeaponNames()].filter(n => !RAID_EQUIP_NAMES.has(n))
  assert.deepEqual(missing, [],
    `SQLにあるがRAID_EQUIP_NAMES未登録のレイド装備: ${missing.join(', ')}\n` +
    'src/constants/raidEquipment.js に追加してください（未登録だとランダム加工で消費されます）')
})

test('RAID_EQUIP_NAMES に実在しない装備が混ざっていない', () => {
  const inSql = sqlWeaponNames()
  const stale = [...RAID_EQUIP_NAMES].filter(n => !inSql.has(n))
  assert.deepEqual(stale, [], `SQLに存在しないレイド装備名: ${stale.join(', ')}`)
})

test('isRaidEquip / isEvolvableEquip はランダム加工の除外判定に使える', () => {
  assert.equal(isRaidEquip('濡羽杖アマザネ'), true)
  assert.equal(isRaidEquip('蒼雷の短刃'), true)
  assert.equal(isRaidEquip('ロングソード'), false)   // 通常装備は加工対象
  // エリアボス装備側の判定（両方で除外する必要がある）
  assert.equal(isEvolvableEquip('スライムの指輪'), true)
  assert.equal(isEvolvableEquip('ロングソード'), false)
})
