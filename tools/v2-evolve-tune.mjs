// ============================================================
// 武器の進化（戦闘記憶）のバランスを実測する
//   node tools/v2-evolve-tune.mjs            … ①②だけ（速い）
//   node tools/v2-evolve-tune.mjs --traits   … ③の159種の効き目まで（重い）
// ------------------------------------------------------------
// 勘で決めないために、実物の runBattle を回して3つ測る。
//   ① 節目（LV300/1000/2000）までに何戦・何時間かかるか
//   ② 進化1つ2つ3つで、どれだけ強くなるか（勝率を戦闘力の%へ言い換える）
//   ③ 159種の能力のうち、効き目が飛び抜けているもの／効いていないものはどれか
//
// ★②③の「戦闘力の%へ言い換える」は、同じ相手に対する勝率を先に測っておき、
//   その勝率カーブを逆に引く（アリーナ・ボスの調整と同じやり方）。
// ============================================================
const B = new URL('../src/v2/lib/', import.meta.url).href
const { runBattle } = await import(B + 'battle.js')
const { statsOf, toFighter } = await import(B + 'enemies.js')
const { skillsOf, mpOf } = await import(B + 'skills.js')
const { CLASS_BONUS } = await import(B + 'classBonus.js')
const { calcPower } = await import(B + 'stats.js')
const {
  EXP_PER_LEVEL, LEVELS, STAGE_CAP, TRAITS, TRAIT_BY_KEY, buildEffect, recordOfBattle,
  emptyRecord, mergeRecord, makeEvolution,
} = await import(B + 'evolve.js')
const { AREAS_SORTED } = await import(B + 'enemies.js')

const SORTIE_CD = 10          // 出撃のクールタイム（秒）
const rngOf = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

const distFor = (cls) => {
  const b = CLASS_BONUS[cls] || {}
  const d = { hp: 22, mp: 6 }
  for (const k of ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']) d[k] = 8
  d[b.main || 'str'] += 16
  d[b.sub || 'agi'] += 8
  return d
}
// ★編成は**実戦に寄せる**（2026-09-28）。
//   前は「倍率の高い攻撃技4つ＋バフ1つ・使用回数99」で組んでいたが、それだと
//   多段技も回復技も入らず、MPも尽きない。その状態で測ると
//   「多段の与ダメ+N%」「回復量+N%」「消費MP-N%」系の能力が**全部0ptに見える**。
//   実際に効いていないのではなく、**測るキャラが使っていなかった**だけだった。
const playerOf = (cls, power, evolutions = []) => {
  const all = skillsOf(cls).filter(s => s.kind !== 'passive')
  const atk = all.filter(s => s.kind === 'phys' || s.kind === 'mag')
    .sort((a, b) => (b.mult || 0) - (a.mult || 0))
  const multi = all.find(s => (s.hits || 1) > 1)        // 多段技（持っている職だけ）
  const heal  = all.find(s => s.kind === 'heal')        // 回復技（持っている職だけ）
  const buff  = all.find(s => s.kind === 'buff')
  const picks = []
  for (const s of [buff, heal, multi, ...atk]) {
    if (s && !picks.includes(s)) picks.push(s)
    if (picks.length >= 5) break
  }
  const stats = statsOf({ power, dist: distFor(cls) })
  // 使用回数はMPで縛る（編成はMPの中に収まる決まり）。1枠あたりMPを等分する
  const budget = Math.max(1, stats.mp) / Math.max(1, picks.length)
  return {
    name: cls, cls,
    kind: CLASS_BONUS[cls]?.main === 'int_stat' ? 'mag' : 'phys',
    stats,
    slots: picks.map(s => {
      const cost = Math.max(1, mpOf(cls, s))
      return { skill: s, uses: Math.max(1, Math.min(99, Math.floor(budget / cost))) }
    }),
    evolutions,
  }
}
// 代表の5職（偏らせない）
const CLASSES = ['侍', '暗殺者', '元素使い', '戦士', '僧侶']

// ===== 勝率を測る =====
const winRate = (power, foe, n, evolutions = [], seed = 7000) => {
  let win = 0, total = 0
  for (const cls of CLASSES) {
    const me = playerOf(cls, power, evolutions)
    for (let i = 0; i < n; i++) {
      const r = runBattle(me, foe, { rng: rngOf(seed + i * 31), maxTurns: 200 })
      if (r.winner === 'a') win++
      total++
    }
  }
  return win / total
}

// ===== ① 節目までの道のり =====
console.log('■ ① 節目までにどれだけ戦うか（熟練度は「行動した回数」で貯まる）')
console.log('帯   相手            1戦の行動数   ' + LEVELS.map(lv => ('LV' + lv + 'まで').padStart(14)).join(' '))
const MOVE_N = 120
for (const tier of [1, 4, 8]) {
  const area = AREAS_SORTED.find(a => a.tier === tier)
  const foe = toFighter({ ...area.enemies[0] })
  const power = Math.round(area.boss.power * 0.7)   // その帯をうろついている頃の強さ
  let moves = 0, n = 0
  for (const cls of CLASSES) {
    const me = playerOf(cls, power)
    for (let i = 0; i < MOVE_N; i++) {
      const r = runBattle(me, foe, { rng: rngOf(4200 + i * 17), maxTurns: 200 })
      moves += recordOfBattle(r, me, foe).exp
      n++
    }
  }
  const per = moves / n
  const row = LEVELS.map(lv => {
    const fights = (lv * EXP_PER_LEVEL) / per
    return `${Math.round(fights).toLocaleString()}戦 ${(fights * SORTIE_CD / 3600).toFixed(0)}時間`
  })
  console.log(`難${tier}   ${area.enemies[0].name.padEnd(12)} ${per.toFixed(1).padStart(8)}   ` +
    row.map(s => s.padStart(14)).join(' '))
}

// ===== ② 進化があると何%ぶん強くなるか =====
console.log('')
console.log('■ ② 進化の効き目（勝率を「戦闘力の何%ぶんか」に言い換える）')
const TIER = 5
const area5 = AREAS_SORTED.find(a => a.tier === TIER)
// ★boss の印は runBattle の呼び出し側が立てる（V2Sortie と同じ）。
//   立てないと「ボスへ+N%」系は得が出ないまま代償だけ乗り、不当に弱く見える
const foe5 = { ...toFighter({ ...area5.boss }), boss: true }
const BASE_POWER = Math.round(area5.boss.power * 0.8)
const N = 90

// 比→勝率のカーブ（進化なしで戦闘力だけ動かす）
const curve = []
for (let m = 0.7; m <= 1.6001; m += 0.05) {
  curve.push({ m, w: winRate(Math.round(BASE_POWER * m), foe5, N) })
}
const powerPctOf = (w) => {
  if (w <= curve[0].w) return (curve[0].m - 1) * 100
  for (let i = 1; i < curve.length; i++) {
    if (w <= curve[i].w) {
      const a = curve[i - 1], b = curve[i]
      const t = (w - a.w) / Math.max(1e-9, b.w - a.w)
      return ((a.m + (b.m - a.m) * t) - 1) * 100
    }
  }
  return (curve[curve.length - 1].m - 1) * 100
}

// ★実際の仕組みどおりに測る：**戦って戦績を貯め → そこから自動で能力が決まる**。
//   どの能力が付くかは戦い方で変わるので、職ごとに結果が変わる＝その散らばりこそが知りたいもの。
const recordAfter = (cls, fights = 400) => {
  const me = playerOf(cls, BASE_POWER)
  let rec = emptyRecord()
  for (let i = 0; i < fights; i++) {
    const r = runBattle(me, foe5, { rng: rngOf(1300 + i * 29), maxTurns: 200 })
    rec = mergeRecord(rec, recordOfBattle(r, me, foe5, { isBoss: true }))
  }
  return rec
}
// ★1職ぶんの勝率。**同じ種**で回すので、進化あり／なしが同じ戦いの並びで比べられる
const winRateOf = (cls, evolutions = []) => {
  const me = playerOf(cls, BASE_POWER, evolutions)
  let win = 0
  const n = N * CLASSES.length
  for (let i = 0; i < n; i++) {
    const r = runBattle(me, foe5, { rng: rngOf(7000 + i * 31), maxTurns: 200 })
    if (r.winner === 'a') win++
  }
  return win / n
}
const base = winRate(BASE_POWER, foe5, N)
console.log("（難" + TIER + "のボス " + area5.boss.power.toLocaleString() + " に、戦闘力 " + BASE_POWER.toLocaleString() + " で挑む）")
console.log("進化なし        勝率 " + (base * 100).toFixed(0) + "%")
console.log("")
console.log("職        付いた能力（段階1→2→3）                          進化なし→あり   戦闘力ぶん")
const gains = []
for (const cls of CLASSES) {
  const rec = recordAfter(cls)
  const evs = []
  for (let st = 1; st <= 3; st++) {
    const ev = makeEvolution(rec, st, evs.map(e => e.key))   // ★キーの配列。オブジェクトを渡すと同じ能力が何度も付く
    if (ev) evs.push(ev)
  }
  // ★同じ職の「進化なし」と比べる（職どうしの強さの差を混ぜない）
  const w0 = winRateOf(cls)
  const w1 = winRateOf(cls, evs)
  const pct = powerPctOf(w1) - powerPctOf(w0)
  gains.push(pct)
  const names = evs.map(e => TRAIT_BY_KEY[e.key]?.name || e.key).join(" → ")
  console.log(cls.padEnd(9) + names.padEnd(48) +
    (w0 * 100).toFixed(0).padStart(4) + "% →" + (w1 * 100).toFixed(0).padStart(4) + "%   " +
    (pct >= 0 ? "+" : "") + pct.toFixed(0) + "%")
}
const avg = gains.reduce((a, b) => a + b, 0) / gains.length
console.log("")
console.log("  平均 " + (avg >= 0 ? "+" : "") + avg.toFixed(0) + "% ／ 最良 +" + Math.max(...gains).toFixed(0) +
  "% ／ 最悪 " + Math.min(...gains).toFixed(0) + "%")
// ===== ③ 能力ごとの効き目 =====
// ★**2つの当たり方**で測る（片方でしか出ない条件つきの能力があるため）。
//   ・格上のボス戦 … 生き残り系・ボス系が出る
//   ・格下の雑魚戦 … 速攻系・無傷系が出る
//   どちらでも勝率が上がらないものだけを「効いていない」とみなす。
if (process.argv.includes('--traits')) {
  const area5b = AREAS_SORTED.find(a => a.tier === TIER)
  const SCENES = [
    { key: 'ボス', foe: { ...toFighter({ ...area5b.boss }), boss: true }, power: Math.round(area5b.boss.power * 0.8) },
    { key: '雑魚', foe: toFighter({ ...area5b.enemies[0] }), power: Math.round(area5b.boss.power * 0.45) },
  ]
  const TN = 50
  const rateIn = (sc, evolutions) => {
    let win = 0, n = 0
    for (const cls of CLASSES) {
      const me = playerOf(cls, sc.power, evolutions)
      for (let i = 0; i < TN; i++) {
        const r = runBattle(me, sc.foe, { rng: rngOf(7000 + i * 31), maxTurns: 200 })
        if (r.winner === 'a') win++
        n++
      }
    }
    return win / n
  }
  const baseIn = Object.fromEntries(SCENES.map(sc => [sc.key, rateIn(sc, [])]))
  const rows = []
  for (const tr of TRAITS) {
    const ev = [{ stage: 3, key: tr.key, s: 1, eff: buildEffect(tr, STAGE_CAP[2], 1) }]
    const g = SCENES.map(sc => (rateIn(sc, ev) - baseIn[sc.key]) * 100)
    rows.push({ tr, boss: g[0], zako: g[1], best: Math.max(...g) })
  }
  rows.sort((a, b) => b.best - a.best)
  console.log('')
  console.log('■ ③ 能力ごとの効き目（段階3・偏り1.0で単体で付けたとき／ボス戦・雑魚戦の良いほう）')
  const line = (r) => '    ' + (r.best >= 0 ? '+' : '') + r.best.toFixed(1).padStart(5) + 'pt  ' +
    r.tr.name + '（' + r.tr.key + '）' +
    (r.tr.cost && r.tr.cost.length ? '　代償 ' + r.tr.cost.map(([a, w]) => a + '×' + w).join(' ') : '')
  console.log('  効きすぎ（上位10）')
  for (const r of rows.slice(0, 10)) console.log(line(r))
  const bad = rows.filter(r => r.best <= 0)
  console.log('  どちらの当たり方でも上がらない: ' + bad.length + '種')
  for (const r of bad) {
    console.log(line(r))
    console.log('             得 ' + (r.tr.gain || []).map(([a, w]) => a + '×' + w).join(' ') +
      '　（ボス ' + r.boss.toFixed(1) + 'pt ／ 雑魚 ' + r.zako.toFixed(1) + 'pt）')
  }
  const avg = rows.reduce((a, r) => a + r.best, 0) / rows.length
  console.log('  全' + rows.length + '種の平均 ' + avg.toFixed(1) + 'pt')
}
