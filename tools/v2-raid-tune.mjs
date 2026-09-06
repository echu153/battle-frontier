// ============================================================
// v2 レイドボスのHPを「1時間ちょうどでソロ討伐」へ合わせる
// ------------------------------------------------------------
//   ① ボスの戦闘力を主催者と同じにする（＝防御も一緒に伸びる）
//   ② 攻撃寄りの編成で **実際に runBattle を10ターン回して** 1回の与ダメを測る
//   ③ 「1時間ぶんの挑戦回数 × 1回の与ダメ」がHPになるよう K を出す
//
// ★レイドはユニークボスと違って**ボスの戦闘力も主催者基準**なので、
//   与ダメはPに対してほぼ線形になる（ユニークボスの P^1.2 はここでは要らない）。
//
//   node tools/v2-raid-tune.mjs
// ============================================================
const B = new URL('../src/v2/lib/', import.meta.url).href
const { statsOf, toFighter } = await import(B + 'enemies.js')
const { runBattle } = await import(B + 'battle.js')
const { skillsOf } = await import(B + 'skills.js')
const { CLASS_BONUS } = await import(B + 'classBonus.js')
const { RAID_TURNS, RAID_MIN_POWER, RAID_HP_K, RAID_MINUTES, bossStatsOf, raidHpOf } = await import(B + 'raid.js')
const { SORTIE_CD } = await import(B + 'sortie.js')

const rngOf = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const kindOf = (cls) => (CLASS_BONUS[cls]?.main === 'int_stat' ? 'mag' : 'phys')
const distFor = (cls) => {
  const b = CLASS_BONUS[cls] || {}
  const d = { hp: 22, mp: 6 }
  for (const k of ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']) d[k] = 8
  d[b.main || 'str'] += 16
  d[b.sub || 'agi'] += 8
  return d
}
// その戦闘力で普通に組める「攻撃寄りの5枠」（v2-boss-tune.mjs と同じ組み方）
const fighterOf = (cls, power, nSlots = 5) => {
  const all = skillsOf(cls)
  const atk = all.filter(s => s.kind === 'phys' || s.kind === 'mag')
    .sort((a, b) => (b.mult || 0) - (a.mult || 0)).slice(0, nSlots - 1)
  const buff = all.find(s => s.kind === 'buff')
  const slots = [...(buff ? [buff] : []), ...atk].slice(0, nSlots).map(s => ({ skill: s, uses: 99 }))
  return { name: cls, cls, kind: kindOf(cls), stats: statsOf({ power, dist: distFor(cls) }), slots }
}
// HPだけ「削り切れない大きさ」にして、10ターンで何点入るかだけを測る
const dummyBoss = (boss, power) => {
  const f = toFighter({ ...bossStatsOf(boss, power), power }, 8)
  f.stats = { ...f.stats, hp: 9_000_000_000 }
  return f
}

const TRIES = 200
const CLASSES = ['侍', '元素使い', '僧侶']
const POWERS = [RAID_MIN_POWER, 12000, 22000, 40000]
const attacks = Math.floor((RAID_MINUTES * 60) / SORTIE_CD)

const { RAID_BOSSES } = await import(B + 'raid.js')
const boss = RAID_BOSSES[0]

console.log(`1挑戦=${RAID_TURNS}ターン／1時間で殴れる回数=${attacks}回（${SORTIE_CD}秒CD）`)
console.log('戦闘力\t' + CLASSES.map(c => `${c}(1回)`).join('\t') + '\t' + CLASSES.map(c => `${c}(必要回数)`).join('\t'))
for (const P of POWERS) {
  const hp = raidHpOf(P)
  const per = []
  for (const cls of CLASSES) {
    let dmg = 0
    for (let i = 0; i < TRIES; i++) {
      const r = runBattle(fighterOf(cls, P), dummyBoss(boss, P), { rng: rngOf(i * 7919 + P), maxTurns: RAID_TURNS })
      dmg += (r.b.base.hp - r.b.hp)
    }
    per.push(Math.round(dmg / TRIES))
  }
  console.log(`${P}\t` + per.map(d => d.toLocaleString()).join('\t') + '\t' +
    per.map(d => (d > 0 ? Math.ceil(hp / d) : '∞')).join('\t'))
}
console.log(`\nHP = ${RAID_HP_K} × max(${RAID_MIN_POWER}, P)　／　下限のHP=${raidHpOf(0).toLocaleString()}`)
console.log('★「必要回数」が上の「1時間で殴れる回数」の前後なら狙いどおり（攻撃寄りの編成で）')
