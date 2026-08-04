// 戦闘ログの色分け（表示だけの処理）の回帰テスト。
// 実行: node --test src/lib/battleLogRich.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { richSegments } from './battleLogRich.js'

// 色が付いた部分だけを取り出して [種類:文字] の形にする
const mark = (text) => richSegments(text).map(s => (s.kind ? `[${s.kind}:${s.text}]` : s.text)).join('')
const kinds = (text) => richSegments(text).filter(s => s.kind).map(s => `${s.kind}:${s.text}`)

test('味方のスキル：技名とダメージが色分けされる', () => {
  assert.equal(
    mark('おれおれお の⚔ 体当たり！ ゴブリンに1234の物理ダメージ！'),
    'おれおれお の⚔ [skill:体当たり]！ ゴブリンに[damage:1234]の物理ダメージ！'
  )
})

test('敵のスキル：「〜の技名！」も同じように色分けされる', () => {
  assert.deepEqual(
    kinds('牛頭の斧兵の斧撃！ あなたに12,345ダメージ… 💥クリティカル！（2回）'),
    ['skill:斧撃', 'damage:12,345', 'crit:💥クリティカル！']
  )
})

test('回復量は回復の色になる', () => {
  assert.deepEqual(kinds('💊 応急手当！ HPを4200回復した！'), ['skill:応急手当', 'heal:4200'])
  assert.deepEqual(kinds('🩸 血の狂気で320回復！'), ['heal:320'])
})

test('クリティカルは技名として拾わない', () => {
  assert.deepEqual(
    kinds('おれおれお の💥クリティカル！ 攻撃！ 鉄角の仔牛に980ダメージ！'),
    ['crit:💥クリティカル！', 'damage:980']
  )
})

test('ただの文章は技名にしない（助詞・数字・「〜した」を含むものは除外）', () => {
  assert.deepEqual(kinds('☠ 迷宮の鉄像を倒した！'), [])
  assert.deepEqual(kinds('2ターンで勝利した！'), [])
  assert.deepEqual(kinds('⚔ 迷宮の鉄像・鉄角の仔牛 が立ちはだかった！'), [])
})

test('「の物理ダメージ」を技名として拾わない', () => {
  const k = kinds('🏹 狙撃！ 牛頭の斧兵に777の物理ダメージ！')
  assert.deepEqual(k, ['skill:狙撃', 'damage:777'])
})

test('色を付けても文字列は元のまま（欠けたり増えたりしない）', () => {
  const samples = [
    'おれおれお の🔥 ファイアボール！ しかしゴブリンに回避された！',
    '🌋 溶岩竜の噴火！ あなたに5000ダメージ…（必中）',
    '💚 タワーの加護！ HPが350回復した！',
    '',
  ]
  for (const s of samples) assert.equal(richSegments(s).map(x => x.text).join(''), s)
})

test('nullやundefinedでも落ちない', () => {
  assert.deepEqual(richSegments(null), [])
  assert.deepEqual(richSegments(undefined), [])
})
