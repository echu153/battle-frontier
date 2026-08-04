import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { evoBlocksAilment, evoResistNewAilments } from '../src/lib/evoCombat.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => readFileSync(join(repoRoot, f), 'utf8')

// ============================================================
// 装備の特殊能力が「全ての戦闘エンジン」で消費されているかを検査する。
//  ・出撃だけに実装して他が素通り、という事故を防ぐ（アクアクラウンの真化で実際に踏んだ）。
//  ・新しい戦闘コンテンツを足したら ENGINES に追加すること。
//  ※簡易出撃(SortiePanel)は戦闘計算をせず固定報酬なので対象外。
// ============================================================
const ENGINES = {
  '出撃':                 'src/pages/Game.jsx',
  'レイド':               'src/pages/RaidBoss.jsx',
  '奈落闘技場':           'src/pages/Abyss.jsx',
  '八獄':                 'src/pages/Hachigoku.jsx',
  'エンドレスタワー':     'src/lib/towerBattle.js',
  '天穹十二宮':           'src/pages/Tenkyuu.jsx',
  '対人戦系(組み手/ランクマッチ/アリーナ/戦争)': 'src/lib/pvp.js',
}

// re = そのエンジンのソースに必ず現れるパターン（共通ヘルパー名 or 直接実装の変数名）
// skip = 仕様上その戦闘では効かないエンジン（理由を必ず書く）
const CHECKS = [
  { name: 'アーティファクト（スキル/通常攻撃ダメージ1.3倍）', re: /isArtifact\s*\?\s*1\.3/ },
  { name: 'アーティファクト（MP消費2倍）',                    re: /isArtifact\s*\?\s*\(/ },
  { name: '開幕バフ・毎ターン回復・哭雨の羽衣（applyEquipmentEffects）', re: /applyEquipmentEffects\(/ },
  { name: '哭雨の羽衣（5ターンごとの再付与）',                re: /battle_start_ailment_shield/ },
  { name: '真化・攻撃ヒット時（evoOnHit＝天砲/指輪/出血/スタン/冥獄宝珠の毒）', re: /evoOnHit\(/ },
  { name: '真化・被ダメージ%軽減＋冥府王の獄衣（evoTakenMult）', re: /evoTakenMult\(/ },
  { name: '真化・回避時（影踏みのブーツ）',                    re: /evoOnEvade\(|evoEvadeSpdUp/ },
  { name: '真化・全スキルセット時（深紅の牙輪/魔眼石）',       re: /evoAtkMult\(|evoAllskillAtk/ },
  { name: '真化・反射（嵐の重装甲）',                          re: /evoOnDamaged\(|evoReflectPct/ },
  { name: 'アクアクラウン真化（状態異常確率ダウン）',          re: /evoBlocksAilment\(|evoResistNewAilments\(/ },
  { name: '雷鋼の機神鎧（被ダメ時 素早さアップ）',             re: /ondmgSpdUp/ },
  { name: '武器種固有能力（与ダメージ/消費MP）',               re: /weaponDmgMult/ },
  // 敵にデバフを掛ける系: レイドボスは仕様でデバフ無効（RaidBoss.jsx「ボスはデバフ無効なので常に空」）
  { name: '蒼雷の短刃（追加行動ヒット時 麻痺）',   re: /extraParaChance/,        skip: { 'レイド': 'ボスはデバフ無効' } },
  { name: '濡羽杖アマザネ（ヒット時 素早さダウン）', re: /hit_spd_down_5/,       skip: { 'レイド': 'ボスはデバフ無効' } },
  { name: 'ヒット時 回復力ダウン',                 re: /hit_heal_down_10_2t/,    skip: { 'レイド': 'ボスはデバフ無効' } },
  { name: '真化・被ダメ時 スタン/やけど（聖鎧/インフェルノ）', re: /evoOnDamaged\(|evoOndmgStun/, skip: { 'レイド': 'ボスはデバフ無効' } },
]

for (const [engine, file] of Object.entries(ENGINES)) {
  test(`${engine} は装備の特殊能力を全て消費している`, () => {
    const src = read(file)
    const missing = CHECKS.filter(c => !c.skip?.[engine] && !c.re.test(src)).map(c => c.name)
    assert.deepEqual(missing, [],
      `${file} で消費されていない特殊能力があります:\n  - ${missing.join('\n  - ')}\n` +
      '共通ヘルパー（src/lib/evoCombat.js）を呼ぶか、仕様で効かないなら CHECKS の skip に理由を書いてください')
  })
}

test('アクアクラウンの真化は共通ヘルパーに一本化されている（出撃へのべた書きを戻さない）', () => {
  const game = read('src/pages/Game.jsx')
  assert.ok(!/ailKeys2/.test(game),
    'Game.jsx が独自の状態異常キー表を持っています。evoCombat.evoResistNewAilments に一本化してください')
})

test('evoBlocksAilment: 耐性0%なら素通り・100%なら必ず止める', () => {
  assert.equal(evoBlocksAilment({ evoAilmentResist: 0 }, 'stun', null), false)
  assert.equal(evoBlocksAilment({}, 'stun', null), false)
  assert.equal(evoBlocksAilment(null, 'stun', null), false)
  const logs = []
  assert.equal(evoBlocksAilment({ evoAilmentResist: 100 }, 'stun', logs), true)
  assert.equal(logs.length, 1)
})

test('evoResistNewAilments: 新規付与のみ無効化し、既存の状態異常には触らない', () => {
  const cur = { burn: { turns: 5 } }
  evoResistNewAilments({ evoAilmentResist: 100 }, {}, cur, [])
  assert.equal(cur.burn, undefined, '新規付与のやけどが無効化されていない')

  const cur2 = { burn: { turns: 5 } }
  evoResistNewAilments({ evoAilmentResist: 100 }, { burn: { turns: 5 } }, cur2, [])
  assert.ok(cur2.burn, '既存の状態異常まで消している')

  const cur3 = { stun: { turns: 1 } }
  evoResistNewAilments({ evoAilmentResist: 0 }, {}, cur3, [])
  assert.ok(cur3.stun, '耐性0%なのに無効化されている')
})
