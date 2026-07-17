import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => readFileSync(join(repoRoot, f), 'utf8')

// レイド通知UIは街のモーダル(RaidNotify)とレイド画面の2箇所から開ける。
// 以前は両方が別々に同じUIを実装しており、夜/昼の切替をレイド画面にしか足せず
// 「街の通知パネルに昼のことが何も書かれていない」状態になった。実装は1つに保つ。
test('レイド通知UIの実装は RaidPushSettings だけ（画面ごとに再実装しない）', () => {
  const hosts = ['src/components/RaidNotify.jsx', 'src/pages/RaidBoss.jsx']
  for (const f of hosts) {
    const src = read(f)
    assert.ok(/import RaidPushSettings from/.test(src), `${f} が共通の RaidPushSettings を使っていない`)
    assert.ok(!/enableRaidPush|disableRaidPush|getPushKinds/.test(src),
      `${f} が通知のON/OFFを自前で実装している。src/components/RaidPushSettings.jsx に寄せること`)
  }
})

test('通知パネルは夜/昼の両方を案内し、個別に切り替えられる', () => {
  const src = read('src/components/RaidPushSettings.jsx')
  assert.ok(src.includes('夜（21時・22時）') && src.includes('昼（12〜17時のどこか1回）'), '説明文に昼の案内が無い')
  assert.ok(/key: 'night'/.test(src) && /key: 'day'/.test(src), '夜/昼の切替ボタンが無い')
  assert.ok(/setPushKinds/.test(src), '切替がサーバーに保存されていない')
})

// 街は「レイドの時間帯だけ」サーバーに問い合わせる（Egress削減）。この判定に昼枠を入れ忘れると
// 昼のレイドが街から一切見えない（出現バナーも予告も出ない）。
test('街のレイド監視はサーバーの schedule を使い、昼枠も対象にする', () => {
  const src = read('src/pages/Game.jsx')
  assert.ok(!/const inRaidWindow = h > 20/.test(src),
    '街の監視が夜(20:30〜)固定になっている。昼枠のレイドが街から見えない')
  assert.ok(/Array\.isArray\(data\?\.schedule\)/.test(src), '街がサーバーの schedule を読んでいない')
  assert.ok(/nearSlot/.test(src), '枠の時間帯判定が schedule ベースになっていない')
})

test('街は出現時刻を自前計算せず、本日の予定を表示する', () => {
  const src = read('src/pages/Game.jsx')
  assert.ok(!/毎日21:00 JST 出現/.test(src), '街に「毎日21:00 JST 出現」が残っている（昼枠が無視されている）')
  assert.ok(/raidSlotsLabel/.test(src), '本日の予定から時刻を組み立てていない')
  assert.ok(!/spawn\.setHours\(21, 0, 0, 0\)/.test(src),
    '出現前カウントダウンが21時決め打ちになっている。昼枠は日替わりで時刻が変わる')
})

test('AI相談の知識ベースが昼枠と4体目を知っている', () => {
  const src = read('src/lib/aiAssistant.js')
  assert.ok(src.includes('閻魔'), 'KBに閻魔が無い')
  assert.ok(/昼12〜17時|昼は12〜17時/.test(src), 'KBに昼枠の記述が無い')
  assert.ok(!/共闘ボス3体日替わり/.test(src), 'KBが3体のままになっている')
})
