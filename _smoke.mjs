// 5〜10層の連戦を実際に回して、壊れていないかを見る煙テスト
import fs from 'node:fs'
import { getFloor, buildStageEnemies, buildSortieEnemies, BOSS_RUN_STAGES, MID_BOSS_RATE,
         floorDmgTakenOf, OPEN_MAX_FLOOR, MAX_IMPLEMENTED_FLOOR } from './src/lib/tower.js'
import { simulateTowerBattle } from './src/lib/towerBattle.js'
import { calcEffectiveStats } from './src/lib/stats.js'

const D = JSON.parse(fs.readFileSync('_sim_data.json', 'utf8'))
const S = D.sim_data || D
const p = S.profile
const eff = calcEffectiveStats(p, S.equipment || [], S.proficiency || [], S.title || null)
const SK = [[{ name: '斬撃', type: 'physical', mult: 2.0, mp_cost: 10 },
             { name: '癒し', type: 'heal', heal: 3000, mp_cost: 20 }]]

let bad = 0
const ng = (msg) => { console.log('  ❌ ' + msg); bad++ }
const numOk = (v) => Number.isFinite(v)

console.log(`公開層 OPEN_MAX_FLOOR=${OPEN_MAX_FLOOR} / 実装 ${MAX_IMPLEMENTED_FLOOR}`)

for (let f = 1; f <= MAX_IMPLEMENTED_FLOOR; f++) {
  const fd = getFloor(f)
  let turns = 0, reflectMax = 0, selfReflect = 0, logs = 0
  for (let s = 0; s < BOSS_RUN_STAGES.length; s++) {
    for (let i = 0; i < 25; i++) {
      const enemies = buildStageEnemies(fd, s)
      // 層番号と被ダメージ倍率が全員に乗っているか
      for (const en of enemies) {
        if (en.floor !== f) ng(`${f}層 ${BOSS_RUN_STAGES[s].label} ${en.name} の floor が ${en.floor}`)
        const want = floorDmgTakenOf(f, en.isBoss)
        if (en.dmgTaken !== want) ng(`${f}層 ${en.name} の dmgTaken=${en.dmgTaken}（期待 ${want}）`)
        for (const k of ['hp', 'atk', 'def', 'matk', 'mdef', 'spd']) {
          if (!numOk(en[k]) || en[k] < 0) ng(`${f}層 ${en.name} の ${k}=${en[k]}`)
        }
      }
      let res
      try {
        res = simulateTowerBattle({ eff, equipment: S.equipment || [], skillSets: SK, profile: p,
          enemies, floorData: fd, tree: {}, targetMode: 'top' })
      } catch (e) { ng(`${f}層 ${BOSS_RUN_STAGES[s].label} で例外: ${e.message}`); continue }
      if (!numOk(res.hp) || !numOk(res.mp) || !numOk(res.turns)) ng(`${f}層 戻り値が数値でない`)
      turns += res.turns
      logs += res.logs.length
      for (const l of res.logs) {
        const t = String(l.text || '')
        if (/NaN|undefined|\[object Object\]/.test(t)) ng(`${f}層 ログが壊れている: ${t.slice(0, 70)}`)
        // ボスのギミック「屈折」。プレイヤーの装備の「🛡 反射！」とは別物なので混ぜない
        const m = t.match(/の屈折！ ([\d,]+)ダメージ跳ね返された/)
        if (m) reflectMax = Math.max(reflectMax, Number(m[1].replace(/,/g, '')))
        const pm = t.match(/^🛡 反射！ .*?に([\d,]+)ダメージ/)
        if (pm) selfReflect = Math.max(selfReflect, Number(pm[1].replace(/,/g, '')))
      }
    }
  }
  // 出撃も回す
  for (let i = 0; i < 40; i++) {
    const { enemies } = buildSortieEnemies(fd, MID_BOSS_RATE)
    for (const en of enemies) if (en.floor !== f) ng(`${f}層 出撃の ${en.name} の floor が ${en.floor}`)
  }
  const cap = Math.floor(eff.hp_max * (fd.floorBoss.mods?.reflectCap ?? 0.02))
  const capNg = reflectMax > cap + 1
  console.log(`${String(f).padStart(2)}層  被ダメ倍率 ボス${floorDmgTakenOf(f, true)}/雑魚${floorDmgTakenOf(f, false)}` +
    `  のべ${turns}ターン ${logs}行` +
    (reflectMax ? `  ボスの屈折 最大${reflectMax}(上限${cap})${capNg ? ' ❌超過' : ''}` : '') +
    (selfReflect ? `  自分の装備の反射 最大${selfReflect.toLocaleString()}` : ''))
  if (capNg) bad++
}

// 境界
for (const [v, want] of [[0, floorDmgTakenOf(1, true)], [-5, floorDmgTakenOf(1, true)], [99, floorDmgTakenOf(10, true)]]) {
  if (floorDmgTakenOf(v, true) !== want) ng(`floorDmgTakenOf(${v}) が ${floorDmgTakenOf(v, true)}`)
}
if (floorDmgTakenOf(undefined, true) !== floorDmgTakenOf(1, true)) ng('floorDmgTakenOf(undefined) が1層扱いでない')

console.log(bad === 0 ? '\n✅ 異常なし' : `\n❌ ${bad} 件`)
