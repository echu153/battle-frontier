// 焼き込みの前後で「実戦での値」が1つも変わっていないことを突き合わせるための控え
// ------------------------------------------------------------
//  敵1体ごとの makeEnemy の結果と、技の実効ダメージ倍率を全部書き出す。
//  焼き込み後に同じものを出して差分ゼロを確認する。
import fs from 'node:fs'
import { TOWER_FLOORS, makeEnemy, floorPowerOf, ENEMY_SKILL_POWER, enemyTotal } from './src/lib/tower.js'

const out = []
for (const fd of TOWER_FLOORS) {
  const fp = floorPowerOf(fd.floor)
  const rows = [
    ...fd.enemies.map((e, i) => ({ role: `mob${i}`, e, boss: false })),
    { role: 'mid', e: fd.midBoss, boss: true },
    { role: 'boss', e: fd.floorBoss, boss: true },
  ]
  for (const r of rows) {
    const en = makeEnemy(r.e, { isBoss: r.boss, floorPower: fp })
    // 技の実効倍率（ダメージ = 攻撃力 × ここ）
    const skills = (r.e.skills || []).map(s => ({
      name: s.name,
      // buff/debuff は倍率を持たないので null
      eff: (s.mult == null || s.type === 'buff' || s.type === 'debuff') ? null
        : +(s.mult * ENEMY_SKILL_POWER).toFixed(6),
      hits: s.hits || 1,
    }))
    out.push({
      floor: fd.floor, role: r.role, name: r.e.name,
      hp: en.hp, atk: en.atk, def: en.def, matk: en.matk, mdef: en.mdef, spd: en.spd,
      dmgTaken: en.dmgTaken, total: enemyTotal(en),
      // 通常攻撃の実効倍率（basicAttack は mult1.5・つまみ対象外）
      basic: 1.5,
      special: r.e.specialMove ? +((r.e.specialMove.mult || 2.5) * ENEMY_SKILL_POWER).toFixed(6) : null,
      erupt: r.e.mods?.erupt ? +((r.e.mods.erupt.mult || 1.8) * ENEMY_SKILL_POWER).toFixed(6) : null,
      skills,
    })
  }
}
const path = process.argv[2] || '_snapshot_before.json'
fs.writeFileSync(path, JSON.stringify(out, null, 1))
console.log(`${out.length} 体ぶんを ${path} に書き出した`)
