// 放置系（釣り／かかし修練）の排他が両方向とも塞がっているかの再発防止テスト。
//
// 経緯: 排他が片方向（釣りページ側）にしか無く、かかし側から入ると両方同時に
//       走ってしまった（2026-07-16報告）。片方向だけの実装に戻ったら落ちるようにする。
import { describe, it } from 'node:test'
import { expect } from '../lib/testExpect.js'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('放置系の排他ガード', () => {
  it('釣りページが かかし修練中 をブロックする', () => {
    const src = read('../pages/Fishing.jsx')
    expect(src, 'Fishing.jsx が useScarecrowBlock を使っていない').toMatch(/useScarecrowBlock\(\)/)
    expect(src, 'Fishing.jsx が ScarecrowBlockScreen を表示していない').toMatch(/<ScarecrowBlockScreen/)
  })

  it('かかし修練場が 釣り中 をブロックする（この逆方向が無くて不具合になった）', () => {
    const src = read('../pages/Scarecrow.jsx')
    expect(src, 'Scarecrow.jsx が useFishingBlock を使っていない').toMatch(/useFishingBlock\(\)/)
    expect(src, 'Scarecrow.jsx が FishingBlockScreen を表示していない').toMatch(/<FishingBlockScreen/)
  })

  it('ガードは両方向とも IdleGuard に定義されている', () => {
    const src = read('./IdleGuard.jsx')
    for (const name of ['useScarecrowBlock', 'ScarecrowBlockScreen', 'useFishingBlock', 'FishingBlockScreen']) {
      expect(src, `IdleGuard.jsx に ${name} が無い`).toMatch(new RegExp(`export function ${name}\\b`))
    }
  })

  it('サーバー側でも両方向を弾いている（クライアントのガードは迂回できるため）', () => {
    const sql = read('../../supabase_idle_exclusive.sql')
    // 釣り中 → かかし開始を弾くトリガー
    expect(sql, 'scarecrow_sessions への排他トリガーが無い').toMatch(/CREATE TRIGGER trg_scarecrow_not_fishing/)
    // かかし修練中 → 釣り開始を弾くトリガー
    expect(sql, 'profiles への排他トリガーが無い').toMatch(/CREATE TRIGGER trg_fishing_not_scarecrow/)
    // scarecrow_start 自体にも釣り中チェック
    expect(sql, 'scarecrow_start に is_fishing チェックが無い').toMatch(/is_fishing[\s\S]{0,200}かかし修練を開始できません/)
  })
})
