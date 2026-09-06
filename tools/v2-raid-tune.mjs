// ============================================================
// v2 レイドボスのHPを「その帯の標準的な編成が1時間で削り切れる」ところへ合わせる
// ------------------------------------------------------------
//   ① 帯ごとに「その頃のプレイヤーの戦闘力と編成」を作る
//      （v2-boss-tune.mjs と同じ組み方。挑戦力 ＝ エリアボスの戦闘力 ÷ RATIO）
//   ② ボスは **エリアボスの戦闘力 × RAID_POWER_MULT**（raid.js）
//   ③ **30ターン・たかぶり付き**で runBattle を回し、1回の挑戦で入るダメージを測る
//   ④ 「1時間ぶんの挑戦回数（360回）」で削り切れるHPを帯ごとに出す
//
// ★たかぶり（ターンが進むほど火力と耐久が上がる）があるので、
//   30ターン回しても後半はほとんど通らない。**この表が「実際に入る量」**。
// ★HPを「戦闘力 × 一定」で置けないのは、帯によって編成の枠数（2〜5）が違うため。
//   ①〜④と⑤〜⑧で必要な倍率が3倍ちがう＝**帯ごとの表にするしかない**。
//
//   node tools/v2-raid-tune.mjs
// ============================================================
const B = new URL('../src/v2/lib/', import.meta.url).href
const { statsOf, areasOfTier, TIER_MAX, markOf } = await import(B + 'enemies.js')
const { runBattle } = await import(B + 'battle.js')
const { skillsOf } = await import(B + 'skills.js')
const { CLASS_BONUS } = await import(B + 'classBonus.js')
const { SORTIE_CD } = await import(B + 'sortie.js')
const {
  RAID_BOSSES, RAID_TURNS, RAID_HP, RAID_MINUTES, RAMP_ATK, RAMP_DEF,
  raidPowerOfTier, raidHpOfTier, toRaidFighter,
} = await import(B + 'raid.js')

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
// その帯で普通に組める「攻撃寄りの編成」（v2-boss-tune.mjs と同じ）
const CLASSES_BY_TIER = {
  1: ['ノーブル'], 2: ['ノーブル', '戦士'], 3: ['戦士', '魔法使い'], 4: ['戦士', '魔法使い', '僧侶'],
  5: ['侍', '暗殺者', '元素使い'], 6: ['侍', '暗殺者', '元素使い'],
  7: ['侍', '暗殺者', '元素使い'], 8: ['侍', '暗殺者', '元素使い'],
}
const SLOTS_BY_TIER = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 }
// v2-boss-tune.mjs の RATIO（エリアボスは「その日の挑戦力」の何倍か）
const RATIO = { 1: 1.50, 2: 1.50, 3: 1.50, 4: 1.50, 5: 1.70, 6: 1.70, 7: 1.70, 8: 1.70 }

const fighterOf = (cls, power, nSlots) => {
  const all = skillsOf(cls)
  const atk = all.filter(s => s.kind === 'phys' || s.kind === 'mag')
    .sort((a, b) => (b.mult || 0) - (a.mult || 0)).slice(0, nSlots - 1)
  const buff = all.find(s => s.kind === 'buff')
  const slots = [...(buff ? [buff] : []), ...atk].slice(0, nSlots).map(s => ({ skill: s, uses: 99 }))
  return { name: cls, cls, kind: kindOf(cls), stats: statsOf({ power, dist: distFor(cls) }), slots }
}
// HPだけ「削り切れない大きさ」にして、1回の挑戦で何点入るかだけを測る
const dummyBoss = (boss, tier) => toRaidFighter(boss, tier, 9_000_000_000)

const TRIES = 120
const attacks = Math.floor((RAID_MINUTES * 60) / SORTIE_CD)

console.log(`1挑戦=${RAID_TURNS}ターン（たかぶり 火力+${RAMP_ATK}%／耐久+${RAMP_DEF}% ・1ターンごと）`)
console.log(`1時間で殴れる回数=${attacks}回（${SORTIE_CD}秒CD）\n`)
console.log(['帯', 'エリアボス', 'レイド戦闘力', '挑戦力', '1回の与ダメ', 'いまのHP', '必要回数', '狙いのHP'].join('\t'))

const want = {}
for (let tier = 1; tier <= TIER_MAX; tier++) {
  const areaBoss = areasOfTier(tier)[0].boss.power
  const power = Math.round(areaBoss / RATIO[tier])
  const classes = CLASSES_BY_TIER[tier]
  const nSlots = SLOTS_BY_TIER[tier]
  let dmg = 0
  let n = 0
  for (const cls of classes) {
    for (let i = 0; i < TRIES; i++) {
      const r = runBattle(
        fighterOf(cls, power, nSlots),
        dummyBoss(RAID_BOSSES[i % RAID_BOSSES.length], tier),
        { rng: rngOf(i * 7919 + tier * 131), maxTurns: RAID_TURNS },
      )
      dmg += (r.b.base.hp - r.b.hp)
      n++
    }
  }
  const per = Math.round(dmg / n)
  const hp = raidHpOfTier(tier)
  // 「1時間フルに殴ってちょうど削り切れる」HP。読みやすい桁に丸める
  const raw = per * attacks
  const unit = Math.pow(10, Math.max(3, String(Math.round(raw)).length - 2))
  want[tier] = Math.round(raw / unit) * unit
  console.log([
    markOf(tier), areaBoss.toLocaleString(), raidPowerOfTier(tier).toLocaleString(), power.toLocaleString(),
    per.toLocaleString(), hp.toLocaleString(), per > 0 ? Math.ceil(hp / per) : '∞', want[tier].toLocaleString(),
  ].join('\t'))
}
console.log('\nいまの RAID_HP =', JSON.stringify(RAID_HP))
console.log('狙いの RAID_HP =', JSON.stringify(want))
console.log('★「必要回数」が上の「1時間で殴れる回数」の前後なら狙いどおり（＝ソロならぎりぎり）')
console.log('★ズレていたら「狙いの RAID_HP」を src/v2/lib/raid.js の RAID_HP へそのまま貼る')
