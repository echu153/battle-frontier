// ============================================================
// v2 ボスの強さを「1日1時間で目標どおりに越えられる」ところへ合わせる
// ------------------------------------------------------------
//   ① v2-progress.mjs で、目標の日にプレイヤーがどれだけ育っているかを出す
//   ② その戦闘力・その職のベスト5編成で、**実際に runBattle を回して**勝率を測る
//   ③ 勝率が WIN_TARGET になるボスの戦闘力を二分探索で求める
//
// ★勝率を 60〜70% に置くのは今までと同じ方針（壁だが越えられる）。
//   ボスは配分をHPへ寄せてあるので、同じ戦闘力でもプレイヤーより強い＝
//   出てくる数字はプレイヤーの戦闘力より小さくなる。
//
//   node tools/v2-boss-tune.mjs
// ============================================================
const B = new URL('../src/v2/lib/', import.meta.url).href
const { simulate, GOAL_DAYS } = await import('./v2-progress.mjs')
const { AREAS_SORTED, statsOf, toFighter } = await import(B + 'enemies.js')
const { runBattle } = await import(B + 'battle.js')
const { skillsOf, isPassive } = await import(B + 'skills.js')
const { CLASS_BONUS } = await import(B + 'classBonus.js')

const WIN_TARGET = 0.65          // 目標の勝率（60〜70%の真ん中）
const FIGHTS = 120               // 1回の測定でやる戦闘数
const rngOf = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// 帯ごとに「その頃に就いていそうな職」。
// ★転職を重ねるほど使える技が増えるので、序盤は初期職・中盤から上位職にする。
//   （①は転職1回＝まだノーブルの技しか無い）
const CLASSES_BY_TIER = {
  1: ['ノーブル'],
  2: ['ノーブル', '戦士'],
  3: ['戦士', '魔法使い'],
  4: ['戦士', '魔法使い', '僧侶'],
  5: ['侍', '暗殺者', '元素使い'],
  6: ['侍', '暗殺者', '元素使い'],
  7: ['侍', '暗殺者', '元素使い'],
  8: ['侍', '暗殺者', '元素使い'],
}
// 使える枠の数も帯で増やす（技をそろえるのにも転職が要る）
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
// 攻撃倍率の高い順に5つ＋パッシブ。細かい軸は見ないが、実戦の目安には足りる
const fighterOf = (cls, power, nSlots) => {
  const all = skillsOf(cls)                       // skillsOf はパッシブを含まない
  const atk = all.filter(s => s.kind === 'phys' || s.kind === 'mag')
    .sort((a, b) => (b.mult || 0) - (a.mult || 0)).slice(0, nSlots - 1)
  const buff = all.find(s => s.kind === 'buff')
  const slots = [...(buff ? [buff] : []), ...atk].slice(0, nSlots).map(s => ({ skill: s, uses: 99 }))
  return { name: cls, cls, kind: kindOf(cls), stats: statsOf({ power, dist: distFor(cls) }), slots }
}

// そのボスの配分のまま戦闘力だけ差し替える
const bossAt = (boss, power) => toFighter({ ...boss, power })

const winRate = (players, boss, power) => {
  let win = 0, n = 0
  for (const me of players) {
    for (let i = 0; i < FIGHTS; i++) {
      const r = runBattle(me, bossAt(boss, power), { rng: rngOf(7000 + i * 31), maxTurns: 200 })
      if (r.winner === 'a') win++
      n++
    }
  }
  return win / n
}

// 勝率が WIN_TARGET になるボスの戦闘力を探す
const solve = (players, boss, playerPower) => {
  let lo = Math.round(playerPower * 0.2), hi = Math.round(playerPower * 2.0)
  for (let i = 0; i < 12; i++) {
    const mid = Math.round((lo + hi) / 2)
    if (winRate(players, boss, mid) > WIN_TARGET) lo = mid; else hi = mid
  }
  return Math.round((lo + hi) / 2)
}

const DAYS = 365
const tierForDay = (d) => { for (const [t, day] of Object.entries(GOAL_DAYS)) if (d <= day) return Number(t); return 8 }
const areaForDay = (d) => AREAS_SORTED.find(a => a.tier === tierForDay(d)).id
const runs = [1, 2, 3, 4, 5].map(seed => simulate(DAYS, { seed, areaOf: areaForDay, tierOfDay: tierForDay }))
const peakAt = (d) => runs.reduce((t, r) => t + r[d - 1].peak, 0) / runs.length

console.log('■ 目標どおりに越えられるボスの強さ（勝率' + Math.round(WIN_TARGET * 100) + '%で合わせる）')
console.log('帯   目標    挑戦力    今のボス   →  直したい   倍率    今の勝率  直した後')
const plan = {}
for (const [tStr, day] of Object.entries(GOAL_DAYS)) {
  const tier = Number(tStr)
  const areas = AREAS_SORTED.filter(a => a.tier === tier)
  const boss = areas[0].boss
  const power = Math.round(peakAt(day))
  const players = CLASSES_BY_TIER[tier].map(c => fighterOf(c, power, SLOTS_BY_TIER[tier]))
  const before = winRate(players, boss, boss.power)
  const want = solve(players, boss, power)
  const after = winRate(players, boss, want)
  // 帯が進むほど強くなること（前の帯より弱いボスを置かない）
  const prev = plan[tier - 1] || 0
  plan[tier] = Math.max(want, prev + 1)
  console.log(
    '難' + tier + '  ' + String(day).padStart(4) + '日  ' +
    power.toLocaleString('ja-JP').padStart(8) + '  ' +
    boss.power.toLocaleString('ja-JP').padStart(8) + '  →  ' +
    want.toLocaleString('ja-JP').padStart(8) + '  ' +
    '×' + (want / boss.power).toFixed(2) + '  ' +
    (before * 100).toFixed(0).padStart(6) + '%  ' + (after * 100).toFixed(0).padStart(6) + '%')
}
console.log('\n■ そのまま enemies.js へ入れる値')
console.log(JSON.stringify(plan))

// ===== 仕上げの確認：本当にその日に越えられるか =====
// 帯ごとに「勝率60%になるプレイヤーの戦闘力」を出して、
// シミュレーションの何日目にそこへ届くかを見る。
console.log('\n■ 実際に何日目で越えられるか（勝率60%に届いた日）')
console.log('帯   目標    実際    ズレ    その日の挑戦力 ／ ボス')
for (const [tStr, day] of Object.entries(GOAL_DAYS)) {
  const tier = Number(tStr)
  const boss = AREAS_SORTED.find(a => a.tier === tier).boss
  // 勝率60%になるプレイヤーの戦闘力を二分探索
  let lo = 1, hi = boss.power * 4
  for (let i = 0; i < 12; i++) {
    const mid = Math.round((lo + hi) / 2)
    const ps = CLASSES_BY_TIER[tier].map(c => fighterOf(c, mid, SLOTS_BY_TIER[tier]))
    if (winRate(ps, boss, boss.power) < 0.60) lo = mid; else hi = mid
  }
  const need = Math.round((lo + hi) / 2)
  let hitDay = null
  for (let d = 1; d <= DAYS; d++) { if (peakAt(d) >= need) { hitDay = d; break } }
  const diff = hitDay == null ? '—' : (hitDay - day >= 0 ? '+' : '') + (hitDay - day) + '日'
  console.log('難' + tier + '  ' + String(day).padStart(4) + '日  ' +
    (hitDay == null ? ' 1年超' : String(hitDay).padStart(4) + '日') + '  ' + diff.padStart(7) + '   ' +
    need.toLocaleString('ja-JP').padStart(8) + ' ／ ' + boss.power.toLocaleString('ja-JP'))
}
