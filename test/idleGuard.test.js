// 放置系（釣り／かかし修練）の排他が両方向とも塞がっているかの再発防止テスト。
//
// 経緯: 排他が片方向（釣りページ側）にしか無く、かかし側から入ると両方同時に
//       走ってしまった（2026-07-16報告）。片方向だけの実装に戻ったら落ちるようにする。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('釣りページが かかし修練中 をブロックする', () => {
  const src = read('../src/pages/Fishing.jsx')
  assert.match(src, /useScarecrowBlock\(\)/, 'Fishing.jsx が useScarecrowBlock を使っていない')
  assert.match(src, /<ScarecrowBlockScreen/, 'Fishing.jsx が ScarecrowBlockScreen を表示していない')
})

test('かかし修練場が 釣り中 をブロックする（この逆方向が無くて不具合になった）', () => {
  const src = read('../src/pages/Scarecrow.jsx')
  assert.match(src, /useFishingBlock\(\)/, 'Scarecrow.jsx が useFishingBlock を使っていない')
  assert.match(src, /<FishingBlockScreen/, 'Scarecrow.jsx が FishingBlockScreen を表示していない')
})

test('ガードは両方向とも IdleGuard に定義されている', () => {
  const src = read('../src/components/IdleGuard.jsx')
  for (const name of ['useScarecrowBlock', 'ScarecrowBlockScreen', 'useFishingBlock', 'FishingBlockScreen']) {
    assert.match(src, new RegExp(`export function ${name}\\b`), `IdleGuard.jsx に ${name} が無い`)
  }
})

test('サーバー側でも両方向を弾いている（クライアントのガードは迂回できるため）', () => {
  const sql = read('../supabase_idle_exclusive.sql')
  // 釣り中 → かかし開始を弾くトリガー
  assert.match(sql, /CREATE TRIGGER trg_scarecrow_not_fishing/, 'scarecrow_sessions への排他トリガーが無い')
  // かかし修練中 → 釣り開始を弾くトリガー
  assert.match(sql, /CREATE TRIGGER trg_fishing_not_scarecrow/, 'profiles への排他トリガーが無い')
  // scarecrow_start 自体にも釣り中チェック
  assert.match(sql, /is_fishing[\s\S]{0,200}かかし修練を開始できません/, 'scarecrow_start に is_fishing チェックが無い')
})
