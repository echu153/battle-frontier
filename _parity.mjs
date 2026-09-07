// 「同じ総合力の敵とプレイヤーが戦ったら実際どうなるか」を実エンジンで測る
// ------------------------------------------------------------
//  総合力は両者とも HP/10 + MP/5 + 攻 + 防 + 特攻 + 特防 + 速 だけ。
//  プレイヤーはそこに乗らない強さ（命中・回避・会心・貫通・武器の特殊能力・
//  スキル・紋章の%・ペット）を大量に持っているので、同じ総合力でも勝てるはず。
//  では「五分になる敵の総合力」はプレイヤーの何倍なのか？ を二分探索で出す。
//
//  使い方: node _parity_b.mjs [層] [試行回数]
import fs from 'node:fs'
import { calcEffectiveStats, calcEffectiveTotal } from './src/lib/stats.js'
import { petPlayerBonus, charmPlayerBonus } from './src/constants/pets.js'
import { simulateTowerBattle } from './src/lib/towerBattle.js'
import { getFloor, makeEnemy, enemyTotal, floorPowerOf, ENEMY_ATK_POWER, ENEMY_DMG_TAKEN } from './src/lib/tower.js'
import { PHYSICAL_CLASSES, MAGICAL_CLASSES } from './src/lib/aiAssistant.js'

const D = JSON.parse(fs.readFileSync('_sim_data.json', 'utf8'))
const byId = {}; for (const c of (D.charms || [])) byId[c.id] = c
const P0 = {
  ...D.profile,
  emblemAlloc: D.emblem, petStat: petPlayerBonus(D.pet),
  petCharm: charmPlayerBonus(byId[D.pet.charm_id] || null, null), activePet: D.pet,
}

const kindOf = c => PHYSICAL_CLASSES.includes(c) ? 'phys' : MAGICAL_CLASSES.includes(c) ? 'mag' : 'hybrid'
const RATIO = { phys: 0.9, mag: 0.1, hybrid: 0.5 }
const mirrorEmblem = (a, k) => { if (k === 'phys' || !a) return a; const o = { ...a }; const mv = (f, t, p) => { const v = o[f] || 0; if (!v) return; delete o[f]; o[t] = (o[t] || 0) + Math.round(v * p); if (p < 1) o[f] = v - Math.round(v * p) }; const p = k === 'mag' ? 1 : 0.5; mv('chikara', 'chie', p); mv('butsuri', 'tokushu', p); mv('bkyuushuu', 'tkyuushuu', p); return o }
const mirrorEq = (e, k) => k !== 'mag' ? e : e.map(it => { if (it.slot !== 'weapon' || !it.equipped || !it.weapons) return it; const w = it.weapons; return { ...it, gem_type: it.gem_type === 'ruby' ? 'amethyst' : it.gem_type, bonus_atk: 0, bonus_matk: (it.bonus_matk || 0) + (it.bonus_atk || 0), weapons: { ...w, weapon_type: 'staff', atk_bonus: 0, matk_bonus: (w.matk_bonus || 0) + (w.atk_bonus || 0) } } })
const realloc = (p, k) => { const off = (p.atk || 0) + (p.matk || 0), r = RATIO[k]; return { ...p, atk: Math.round(off * r), matk: Math.round(off * (1 - r)), emblemAlloc: mirrorEmblem(p.emblemAlloc, k) } }

// 総当たりで一番強い構成を選ぶ（前と同じやり方）
const combos = (arr, k) => { if (k === 0) return [[]]; if (arr.length < k) return []; const [h, ...t] = arr; return [...combos(t, k - 1).map(c => [h, ...c]), ...combos(t, k)] }
function candidateSets(all, cls) {
  const mine = all.filter(s => s.class_name === cls || s.class_name === '共通')
  const passive = mine.filter(s => s.type === 'パッシブ').sort((a, b) => (b.required_lv || 0) - (a.required_lv || 0))[0]
  const actives = mine.filter(s => s.type !== 'パッシブ')
  return combos(actives, Math.min(5, actives.length)).map(sub => {
    const set = passive ? [{ skills: passive, use_count: 1 }] : []
    for (const s of [...sub].sort((a, b) => (a.required_lv || 0) - (b.required_lv || 0))) set.push({ skills: s, use_count: 1 })
    return set
  })
}

// ------------------------------------------------------------
// ビルドの質を切り替える。
//  actual = おれおれおの実物のまま（宝石C/D/E・紋章は力42/物理50/致命17/物理吸収10）
//  built  = 同じ装備のまま「詰めた」状態。宝石をSSSにし、紋章200ptを攻めに寄せる。
//           装備そのもの（レア度・強化値・真化）は増やさないので、
//           これは理論上限ではなく「今の手持ちでちゃんと組んだ人」の水準。
// ------------------------------------------------------------
const BUILD = process.argv[4] === 'built' ? 'built' : 'actual'
const GEM_FOR = { phys: 'citrine', mag: 'citrine', hybrid: 'citrine' }   // 会心率を積む
const upgradeGems = (equip, kind) => {
  if (BUILD !== 'built') return equip
  let acc = 0
  return equip.map(it => {
    if (!it.equipped) return it
    // %系の宝石は装飾品にしか付かない。装飾2枠だけ差し替える
    if (it.slot === 'accessory' || it.slot === 'accessory2') {
      acc++
      return { ...it, gem_type: acc === 1 ? 'citrine' : 'petalite', gem_rank: 'SSS' }
    }
    // 武器・防具はフラット宝石を最高ランクに
    return { ...it, gem_type: kind === 'mag' ? 'amethyst' : 'ruby', gem_rank: 'SSS' }
  })
}
const BUILT_EMBLEM = { phys: { chikara: 50, butsuri: 50, chimei: 50, kaishin: 50 },
                       mag:  { chie: 50, tokushu: 50, chimei: 50, kaishin: 50 },
                       hybrid:{ chikara: 50, butsuri: 50, chimei: 50, kaishin: 50 } }

const FLOOR = Number(process.argv[2] || 6)
const TRIES = Number(process.argv[3] || 40)
const fd = getFloor(FLOOR)
const fp = floorPowerOf(FLOOR)

// 層のボスの「形」はそのままに、全ステを k 倍した敵を作る（総合力も k 倍になる）
const scaledBoss = (k) => {
  const b = fd.floorBoss
  const def = { ...b, hp: Math.round(b.hp * k), atk: Math.round(b.atk * k), def: Math.round(b.def * k), matk: Math.round(b.matk * k), mdef: Math.round(b.mdef * k), spd: Math.round(b.spd * k) }
  return { def, total: enemyTotal(def) }
}

const CLASSES = ['侍', '体術師', '竜騎士', '狩人', '暗殺者', '狂戦士', '魔法剣士', '元素使い', '賢者', '聖職者', '聖騎士']

console.log(`■ ${FLOOR}層のエリアボスを「全ステ k 倍」して、五分になる k を探す（1体戦・各${TRIES}回）`)
console.log(`  ※層の係数 ×${fp} と ボスの攻撃つまみ ×${ENEMY_ATK_POWER}、被ダメ ×${ENEMY_DMG_TAKEN} は本番どおり掛かる`)
console.log()
console.log('クラス        プレイヤー総合力  五分の敵総合力   倍率   （素の敵総合力=' + enemyTotal(fd.floorBoss).toLocaleString() + '）')
console.log('-'.repeat(84))

const rows = []
for (const cls of CLASSES) {
  const kind = kindOf(cls)
  const prof = realloc({ ...P0, class: cls, retraining: { ...(P0.retraining || {}), [cls]: 5 } }, kind)
  if (BUILD === 'built') prof.emblemAlloc = BUILT_EMBLEM[kind]
  const eq = upgradeGems(mirrorEq(D.equipment, kind), kind)
  const eff = calcEffectiveStats(prof, eq, D.proficiency, D.title)
  const pTotal = calcEffectiveTotal(prof, eq, D.proficiency, D.title)

  // 構成選抜（1体戦で強い並び）
  const cands = candidateSets(D.skills, cls)
  let best = cands[0], bestOk = -1
  const trial = (skillSets, k, n) => {
    let ok = 0
    for (let i = 0; i < n; i++) {
      const r = simulateTowerBattle({
        eff, equipment: eq, skillSets, profile: prof,
        enemies: [makeEnemy(scaledBoss(k).def, { isBoss: true, floorPower: fp })],
        floorData: fd, tree: {}, targetMode: 'top', playerItem: null,
      })
      if (r.win) ok++
    }
    return ok / n
  }
  for (const c of cands) { const ok = trial(c, 1.0, 10); if (ok > bestOk) { bestOk = ok; best = c } }

  // 二分探索: 勝率50%になる k
  let lo = 0.2, hi = 12
  for (let it = 0; it < 12; it++) {
    const mid = (lo + hi) / 2
    if (trial(best, mid, TRIES) >= 0.5) lo = mid; else hi = mid
  }
  const k = (lo + hi) / 2
  const eTotal = scaledBoss(k).total
  rows.push({ cls, pTotal, eTotal, ratio: eTotal / pTotal })
  console.log(`${cls.padEnd(13)} ${pTotal.toLocaleString().padStart(14)} ${eTotal.toLocaleString().padStart(14)}   ${(eTotal / pTotal).toFixed(2)}倍`)
}
console.log('-'.repeat(84))
const avg = rows.reduce((s, r) => s + r.ratio, 0) / rows.length
const med = [...rows].sort((a, b) => a.ratio - b.ratio)[Math.floor(rows.length / 2)].ratio
console.log(`平均 ${avg.toFixed(2)}倍 ／ 中央値 ${med.toFixed(2)}倍 ／ 最小 ${Math.min(...rows.map(r => r.ratio)).toFixed(2)}倍 ／ 最大 ${Math.max(...rows.map(r => r.ratio)).toFixed(2)}倍`)
console.log(`\n→ 同じ総合力ではまるで釣り合わず、敵は総合力で ${med.toFixed(1)} 倍ないと五分にならない。`)
console.log(`   この差が「プレイヤーが総合力に乗せていない強さ」の総和。`)
