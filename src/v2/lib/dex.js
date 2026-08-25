// ============================================================
// バトルフロンティアⅡ（リメイク版）— モンスター図鑑
// ------------------------------------------------------------
// ★図鑑は**倒した敵・拾った素材だけ**が見える（2026-08-26 ユーザー指示）。
//   まだのものは名前も中身も ??? のまま。
//
// ★討伐数は**サーバーが数える**（v2_kills）。クライアントの申告は
//   v2_sortie_settle が v2_enemies と突き合わせて弾く＝盛れない。
// ============================================================

import { STAT_KEYS } from './stats.js'
import { AREAS } from './enemies.js'
import { MATERIAL_BY_ID, materialsOfEnemy } from './material.js'

export const UNKNOWN = '???'

// ===== 討伐数によるステータス上昇（2026-08-26 ユーザー決定）=====
// ★**固定値**（％ではない）。上がるのは「その敵の素材で上がるステータス」と同じもの。
//   ・通常／時間帯の敵 … 10体で+1・100体で+3・1000体で+10
//   ・レア／ボス       … 3体で+1・10体で+3・50体で+10
//   段は**置き換え**（積み上げない）。100体倒しても+1+3ではなく+3。
//   ボス素材はステータスを2つ持つので、その2つに同じだけ乗る。
export const KILL_TIERS = {
  normal: [{ n: 10, add: 1 }, { n: 100, add: 3 }, { n: 1000, add: 10 }],
  rare:   [{ n: 3, add: 1 }, { n: 10, add: 3 }, { n: 50, add: 10 }],
}
// レアとボスは同じ表（どちらもめったに会わない枠）
export const tableOf = (slot) => (slot === 'rare' || slot === 'boss' ? KILL_TIERS.rare : KILL_TIERS.normal)

// 素材は**初めて図鑑に載ったとき**に該当ステータスが1上がる
export const MATERIAL_FIRST_ADD = 1

// その枠の敵を n 体倒したときに乗る値
export const killAddOf = (slot, n = 0) => {
  let add = 0
  for (const t of tableOf(slot)) if (n >= t.n) add = t.add
  return add
}

// 次の段まであと何体か。全部越えていれば null
export const nextKillTier = (slot, n = 0) => tableOf(slot).find(t => n < t.n) || null

// ===== 図鑑ぶんの上がり幅をまとめる =====
// kills … { 敵の名前: 討伐数 } ／ found … 見つけた素材idの集合
// ⚠**戦闘にも効く**ので、渡し忘れると黙って弱くなる。loadout.js のテストで見張っている
export const dexStats = (kills, found) => {
  const out = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  for (const { slot, e } of dexRows()) {
    const add = killAddOf(slot, kills?.[e.name] || 0)
    if (!add) continue
    for (const k of statKeysOfEnemy(e.name)) out[k] += add
  }
  if (found) {
    for (const id of found) {
      const m = MATERIAL_BY_ID[id]
      if (!m) continue
      for (const k of m.stats) out[k] += MATERIAL_FIRST_ADD
    }
  }
  return out
}

// 全エリアの「枠つきの敵」を1列に並べる
const dexRows = () => AREAS.flatMap(a => [
  ...a.enemies.map(e => ({ slot: 'normal', e })),
  ...a.timed.map(e => ({ slot: 'timed', e })),
  ...(a.rares || []).map(e => ({ slot: 'rare', e })),
  { slot: 'boss', e: a.boss },
])

// その敵の素材が伸ばすステータス（3つとも同じ並びなので先頭を見ればよい）
const statKeysOfEnemy = (name) => materialsOfEnemy(name)[0]?.stats || []


// 図鑑がどれだけ埋まったか
export const dexProgress = (names, kills) => {
  const done = names.filter(name => (kills[name] || 0) > 0).length
  return { done, total: names.length, pct: names.length ? Math.round(done / names.length * 100) : 0 }
}

// 討伐数の一覧（サーバーの行）を名前→数の形にする
export const killMapOf = (rows) =>
  Object.fromEntries((rows || []).map(r => [r.enemy, r.n]))

// 見つけた素材のidの集合
export const foundSetOf = (rows) => new Set((rows || []).map(r => r.material_id))
