// ============================================================
// v2 ボスの強さを「1日1時間で目標どおりに越えられる」ところへ合わせる
// ------------------------------------------------------------
//   ① v2-progress.mjs で、その日にプレイヤーがどれだけ育っているかを出す
//   ② その戦闘力・その頃の職の編成で **実際に runBattle を回して** 勝率を測る
//   ③ 帯ごとに決めた勝率になるボスの戦闘力を二分探索する
//   ④ 「その帯を実際に何日で抜けるか」を最後に検算する
//
// ★勝率は高くなくていい（2026-08-26 ユーザー指示「もうちょっと敵強くていい」）。
//   v2は**どの戦闘もHP満タンから始まる**ので、ボスに負けても失うのは時間だけ。
//   1時間あそべばボスに約15回会えるから、勝率10%でも「その日のうちに1回は勝てる」。
//   なので勝率6割は緩すぎた。帯ごとにこう置く：
//     ①40% ②20% ③（旧値2,046のまま＝ユーザー指示） ④⑤⑥12% ⑦⑧15%
//   ④以降が低いのは、その帯にエリアが2〜3個あって**その数だけ勝たないと次が開かない**ため。
//
//   node tools/v2-boss-tune.mjs
// ============================================================
const B = new URL('../src/v2/lib/', import.meta.url).href
const { simulate, GOAL_DAYS } = await import('./v2-progress.mjs')
const { AREAS_SORTED, statsOf, toFighter } = await import(B + 'enemies.js')
const { runBattle } = await import(B + 'battle.js')
const { skillsOf } = await import(B + 'skills.js')
const { CLASS_BONUS } = await import(B + 'classBonus.js')

// 帯ごとの目標の勝率
const TARGET_WIN = { 1: 0.40, 2: 0.20, 3: null, 4: 0.12, 5: 0.12, 6: 0.12, 7: 0.15, 8: 0.15 }
const FIXED = { 3: 2046, 4: 4137 }   // ③④は前のまま（2026-08-26 ユーザー指示）
const BOSS_TRIES_PER_DAY = 15             // 1時間でボスに会える回数（遭遇率が0.3%ずつ上がる）
const FIGHTS = 160
const rngOf = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// 帯ごとに「その頃に就いていそうな職」と、埋まっている技の枠の数
const CLASSES_BY_TIER = {
  1: ['ノーブル'], 2: ['ノーブル', '戦士'], 3: ['戦士', '魔法使い'], 4: ['戦士', '魔法使い', '僧侶'],
  5: ['侍', '暗殺者', '元素使い'], 6: ['侍', '暗殺者', '元素使い'],
  7: ['侍', '暗殺者', '元素使い'], 8: ['侍', '暗殺者', '元素使い'],
}
const SLOTS_BY_TIER = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 }

const kindOf = (cls) => (CLASS_BONUS[cls]?.main === 'int_stat' ? 'mag' : 'phys')
const distFor = (cls) => {
  const b = CLASS_BONUS[cls] || {}
  const d = { hp: 22, mp: 6 }
  for (const k of ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']) d[k] = 8
  d[b.main || 'str'] += 16
  d[b.sub || 'agi'] += 8
  return d
}
const fighterOf = (cls, power, nSlots) => {
  const all = skillsOf(cls)                       // skillsOf はパッシブを含まない
  const atk = all.filter(s => s.kind === 'phys' || s.kind === 'mag')
    .sort((a, b) => (b.mult || 0) - (a.mult || 0)).slice(0, nSlots - 1)
  const buff = all.find(s => s.kind === 'buff')
  const slots = [...(buff ? [buff] : []), ...atk].slice(0, nSlots).map(s => ({ skill: s, uses: 99 }))
  return { name: cls, cls, kind: kindOf(cls), stats: statsOf({ power, dist: distFor(cls) }), slots }
}
const bossAt = (boss, power) => toFighter({ ...boss, power })

const winRate = (tier, playerPower, boss, bossPower) => {
  const players = CLASSES_BY_TIER[tier].map(c => fighterOf(c, playerPower, SLOTS_BY_TIER[tier]))
  let win = 0, n = 0
  for (const me of players) {
    for (let i = 0; i < FIGHTS; i++) {
      const r = runBattle(me, bossAt(boss, bossPower), { rng: rngOf(7000 + i * 31), maxTurns: 200 })
      if (r.winner === 'a') win++
      n++
    }
  }
  return win / n
}

const solve = (tier, playerPower, boss, want) => {
  let lo = Math.round(playerPower * 0.2), hi = Math.round(playerPower * 4)
  for (let i = 0; i < 12; i++) {
    const mid = Math.round((lo + hi) / 2)
    if (winRate(tier, playerPower, boss, mid) > want) lo = mid; else hi = mid
  }
  return Math.round((lo + hi) / 2)
}

const DAYS = 700
const tierForDay = (d) => { for (const [t, day] of Object.entries(GOAL_DAYS)) if (d <= day) return Number(t); return 8 }
const areaForDay = (d) => AREAS_SORTED.find(a => a.tier === tierForDay(d)).id
const runs = [1, 2, 3, 4, 5].map(seed => simulate(DAYS, { seed, areaOf: areaForDay, tierOfDay: tierForDay }))
const peakAt = (d) => runs.reduce((t, r) => t + r[Math.min(d, DAYS) - 1].peak, 0) / runs.length

// ===== 勝率は「戦闘力の比」だけで決まる（実測で確認済み）=====
// なので帯ごとに **比→勝率のカーブ** を1回だけ作れば、あとは掛け算で引ける。
const RATIOS = Array.from({ length: 57 }, (_, i) => 0.2 + i * 0.05)
const curveOf = (tier) => {
  const boss = AREAS_SORTED.find(a => a.tier === tier).boss
  return RATIOS.map(r => ({ r, w: winRate(tier, Math.round(10000 * r), boss, 10000) }))
}
const rateFromCurve = (curve, ratio) => {
  if (ratio <= curve[0].r) return curve[0].w
  if (ratio >= curve[curve.length - 1].r) return curve[curve.length - 1].w
  for (let i = 1; i < curve.length; i++) {
    if (ratio <= curve[i].r) {
      const a = curve[i - 1], b = curve[i]
      return a.w + (b.w - a.w) * (ratio - a.r) / (b.r - a.r)
    }
  }
  return curve[curve.length - 1].w
}

// その帯を start 日目から始めて、何日目に抜けるか
const clearDay = (curve, bossPower, areas, start) => {
  let wins = 0, d = start
  while (wins < areas && d <= DAYS) {
    wins += rateFromCurve(curve, peakAt(d) / bossPower) * BOSS_TRIES_PER_DAY
    d += 1
  }
  return d - 1
}

console.log('■ ボスの強さを「目標の日にちょうど抜ける」ところへ合わせる')
console.log('帯 エリア  目標    挑戦力      いま   →    新しく    その日の勝率   抜ける日')
const plan = {}
let start = 1
for (const [tStr, goalDay] of Object.entries(GOAL_DAYS)) {
  const tier = Number(tStr)
  const areas = AREAS_SORTED.filter(a => a.tier === tier)
  const boss = areas[0].boss
  const curve = curveOf(tier)
  let want
  if (FIXED[tier]) {
    want = FIXED[tier]
  } else {
    // ボスが強いほど遅く抜ける＝単調。二分探索で目標の日に合わせる
    let lo = Math.round(peakAt(goalDay) * 0.2), hi = Math.round(peakAt(goalDay) * 6)
    for (let i = 0; i < 24; i++) {
      const mid = Math.round((lo + hi) / 2)
      if (clearDay(curve, mid, areas.length, start) < goalDay) lo = mid; else hi = mid
    }
    want = Math.round((lo + hi) / 2)
  }
  plan[tier] = Math.max(want, (plan[tier - 1] || 0) + 1)
  const done = clearDay(curve, plan[tier], areas.length, start)
  const rate = rateFromCurve(curve, peakAt(goalDay) / plan[tier])
  console.log('難' + tier + '   ' + areas.length + '個 ' + String(goalDay).padStart(4) + '日 ' +
    Math.round(peakAt(goalDay)).toLocaleString('ja-JP').padStart(8) + ' ' +
    boss.power.toLocaleString('ja-JP').padStart(9) + '  →  ' + plan[tier].toLocaleString('ja-JP').padStart(8) +
    '    ' + (rate * 100).toFixed(0).padStart(4) + '%' + (FIXED[tier] ? '（据置）' : '        ') +
    '  ' + String(done).padStart(4) + '日（' + (done - goalDay >= 0 ? '+' : '') + (done - goalDay) + '）')
  start = done + 1
}
console.log('')
console.log('■ そのまま enemies.js へ入れる値')
console.log(JSON.stringify(plan))
