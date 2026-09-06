// ============================================================
// アリーナの勝率を実測する（node tools/v2-arena-tune.mjs）
// ------------------------------------------------------------
// 空き階のNPCは「その階の値」と「自分の戦闘力×NPC_MIN_RATIO」の高いほう。
// その相手に**実際の runBattle で**何割勝てるかを測る。
// ★勘で倍率を決めないため。数字を変えたらこれを回し直すこと。
// ============================================================
const B = new URL('../src/v2/lib/', import.meta.url).href
const { npcChampOf, npcPowerFor, NPC_MIN_RATIO, powerOfFloor } = await import(B + 'arena.js')
const { runBattle } = await import(B + 'battle.js')
const { skillsOf } = await import(B + 'skills.js')
const { CLASS_BONUS } = await import(B + 'classBonus.js')
const { statsOf } = await import(B + 'enemies.js')
const { calcPower } = await import(B + 'stats.js')

const rngOf = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const distFor = (cls) => {
  const b = CLASS_BONUS[cls] || {}
  const d = { hp: 22, mp: 6 }
  for (const k of ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']) d[k] = 8
  d[b.main || 'str'] += 16
  d[b.sub || 'agi'] += 8
  return d
}
const playerOf = (cls, power) => {
  const all = skillsOf(cls).filter(s => s.kind !== 'passive')
  const atk = all.filter(s => s.kind === 'phys' || s.kind === 'mag').sort((a, b) => (b.mult || 0) - (a.mult || 0)).slice(0, 4)
  const buff = all.find(s => s.kind === 'buff')
  return { name: cls, cls, kind: CLASS_BONUS[cls]?.main === 'int_stat' ? 'mag' : 'phys',
    stats: statsOf({ power, dist: distFor(cls) }),
    slots: [...(buff ? [buff] : []), ...atk].slice(0, 5).map(s => ({ skill: s, uses: 99 })) }
}

const N = 300
const CLASSES = ['侍', '暗殺者', '元素使い', '戦士', '魔法使い']
console.log('■ 空き階のNPCに挑んだときの勝率（下限 自分×' + NPC_MIN_RATIO + '・1職' + N + '戦）')
console.log('自分の戦闘力   挑む階   相手      勝率')
for (const [power, floor] of [[300, 2], [1500, 10], [6438, 8], [6438, 30], [15000, 38], [30000, 46]]) {
  const foeP = npcPowerFor(floor, power)
  let win = 0, n = 0
  for (const cls of CLASSES) {
    const me = playerOf(cls, power)
    const foe = npcChampOf(floor, power)
    for (let i = 0; i < N; i++) {
      const r = runBattle(me, { ...foe, startHp: foe.stats.hp, startMp: foe.stats.mp }, { rng: rngOf(9000 + i * 37), maxTurns: 200 })
      if (r.winner === 'a') win++
      n++
    }
  }
  console.log(power.toLocaleString().padStart(9) + '   ' + String(floor).padStart(4) + '階   ' +
    foeP.toLocaleString().padStart(7) + '   ' + (win / n * 100).toFixed(0).padStart(4) + '%' +
    (foeP > powerOfFloor(floor) ? '  （底上げ）' : '  （階の値）'))
}
