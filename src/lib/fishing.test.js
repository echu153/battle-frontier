// 釣り図鑑の「登録されない」系バグの再発防止テスト。
//
// 経緯: 図鑑は (player_id, location, fish_name) で1件。魚名が場所をまたいで重複すると
//       DBの一意制約に弾かれて図鑑が???のまま残る（2026-07-04 カリブカンパチ／
//       2026-07-16 日本海カンパチ）。人力レビューでは見落とすのでテストで機械的に止める。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FISH_DATA, FISHING_LOCATIONS, COMPLETE_BONUS, calcFishBonus, FISH_RANK_BONUS_STATS } from './fishing'

describe('魚図鑑データの健全性', () => {
  it('魚名が場所をまたいで重複しない（同名だとDBの一意制約に弾かれて図鑑に載らない）', () => {
    const byName = {}
    for (const [loc, list] of Object.entries(FISH_DATA)) {
      for (const f of list) (byName[f.name] ||= []).push(loc)
    }
    const dups = Object.entries(byName).filter(([, locs]) => locs.length > 1)
    expect(dups, `場所をまたいで同名の魚がいる: ${JSON.stringify(dups)}`).toEqual([])
  })

  it('同じ釣り場の中で魚名が重複しない', () => {
    for (const [loc, list] of Object.entries(FISH_DATA)) {
      const names = list.map(f => f.name)
      expect(new Set(names).size, `${loc} に同名の魚がいる`).toBe(names.length)
    }
  })

  it('全ての魚がボーナスを算出できる（statIdxがランクの割り当て範囲内）', () => {
    for (const [loc, list] of Object.entries(FISH_DATA)) {
      for (const f of list) {
        const slots = FISH_RANK_BONUS_STATS[f.rank]
        expect(slots, `${loc}/${f.name} の未知のランク: ${f.rank}`).toBeTruthy()
        expect(f.statIdx, `${loc}/${f.name} の statIdx がランク${f.rank}の枠(${slots.length})を超えている`)
          .toBeLessThan(slots.length)
        expect(calcFishBonus(f, f.rank), `${loc}/${f.name} のボーナスがnull`).toBeTruthy()
      }
    }
  })

  it('コンプリートボーナスが全釣り場に定義されている', () => {
    for (const loc of FISHING_LOCATIONS) {
      expect(COMPLETE_BONUS[loc], `${loc} のコンプリートボーナスが無い`).toBeTruthy()
    }
  })

  it('Fishing.jsx が魚データを再定義していない（二重定義はズレて不具合になる）', () => {
    const src = readFileSync(new URL('../pages/Fishing.jsx', import.meta.url), 'utf8')
    for (const name of ['FISH_DATA', 'COMPLETE_BONUS', 'FISH_RANK_BONUS_STATS', 'calcFishBonus']) {
      expect(src.includes(`const ${name} =`), `Fishing.jsx が ${name} を再定義している。lib/fishing.js から import すること`)
        .toBe(false)
    }
  })
})
