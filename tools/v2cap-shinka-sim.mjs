// ============================================================
// v2cap 武器の真化のシミュレーション（2026-10-26・src/v2cap/lib/shinka.js）
// ------------------------------------------------------------
// 進行シミュレーション（tools/v2cap-progress.mjs の simulate＝本物の戦闘・実際に落ちた装備・鍛冶屋つき）を回し、
// **着けている武器ごとに**熟練度と戦い方の記録を数える。熟練度が SHINKA_MAX になった瞬間に真化する（鍛冶屋へすぐ行く人）。
//
//   node tools/v2cap-shinka-sim.mjs [--hours 200] [--seeds 1,2] [--classes all|戦士,僧侶] [--apply] [--save 出力.json]
//     … 真化した時点の記録から：フラグの値の分かれ方（境目の候補＝上位2割の値）・立ったフラグの数・職業ごとの立ち方・
//       キラーの種族・武器の持ち替え（MAX まで使えた武器の数・真化した武器をそのあと何時間使ったか）・抽選で付いた能力
//       --apply … 真化した能力を戦闘に効かせる（効かせないときと進み方を比べる＝エリアの③を倒した時間）
//       --save … 真化した瞬間のキャラ（プロフィールと持ち物）を書き出す（--value が読む）
//   node tools/v2cap-shinka-sim.mjs --value 読む.json [--n 80] [--per 6]
//     … 真化した瞬間のキャラで、能力ごとに「戦闘力+何%相当か」を測る（その場所のボスに勝率5割になる強さ＝m50 の伸びを、
//       ステ全部+5%の伸びと比べる。同じ乱数で比べる）。そのフラグが立っていたキャラだけで測る（＝その戦い方の人が着けたとき）。
//       キラーは相手をその種族にして測る（当たったとき）。--per … フラグごとに測るキャラの数
// ============================================================
import { writeFileSync, readFileSync } from 'node:fs'

const B = new URL('../src/', import.meta.url).href
const { simulate } = await import(new URL('./v2cap-progress.mjs', import.meta.url).href)
const { runBattle } = await import(B + 'v2cap/core/battle.js')
const { STAT_KEYS } = await import(B + 'v2cap/core/stats.js')
const { bandAt } = await import(B + 'v2cap/core/sortie.js')
const areas = await import(B + 'v2cap/lib/areas.js')
const { CLASSES, CLASS_BY_ID } = await import(B + 'v2cap/lib/jobs.js')
const { toFighter } = await import(B + 'v2cap/lib/loadout.js')
const { RACE_BY_KEY, raceOf } = await import(B + 'v2cap/lib/monsterRace.js')
const S = await import(B + 'v2cap/lib/shinka.js')

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const HOURS = Number(arg('hours', 200))
const SEEDS = String(arg('seeds', '1,2')).split(',').map(Number)
const CLS_ARG = arg('classes', 'all')
const START = CLS_ARG === 'all' ? CLASSES.filter(c => c.stage === 'shoki').map(c => c.id) : CLS_ARG.split(',')
const APPLY = process.argv.includes('--apply')
const SAVE = arg('save', null)
const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN }
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : '-')
const pad = (s, n) => String(s).padEnd(n)

// ===== キラーの対策の案（2026-10-26 ユーザー「キラーが真化のあと活きにくい件、対策の案を出して」）=====
// recentN … 直近ほど重く数えた（1戦ごとに 1−1/N 倍）種族の1位に、真化したあとも毎戦ついていく
// top2 … 真化したときの上位2種族／spot … いまいる場所でいちばん多い種族（出会う割合で重みづけ）
const DECAYS = [600, 1800]
const topOf = (d) => { let best = null; for (const [k, v] of Object.entries(d || {})) if (v > 0 && (!best || v > best[1])) best = [k, v]; return best?.[0] || null }
const SPOT_TOP = Object.fromEntries(areas.SPOTS.map(s => {
  const w = {}
  const add = (list, p) => { for (const e of list) { const r = raceOf(e.name); if (r) w[r] = (w[r] || 0) + p / list.length } }
  add(s.roster.enemies, 70); add(s.roster.timed, 25); add(s.roster.rares, 5)
  return [s.id, topOf(w)]
}))

// ===== 1本の進行を回して、武器ごとに数える =====
const runOne = (start, seed) => {
  const weapons = new Map()   // base_id → { srec, mastery, shinka, from, to, afterBattles, shinkaHour }
  const events = []           // 真化した瞬間
  // ★抽選の乱数は Math.random（本番はサーバーの random()）。種から作る乱数は、1本の進行で2〜3回しか引かないので
  //   最初の数回の値が種に引きずられて偏った（線形合同法＝キラーのあと代償つきが多すぎ／mulberry32＝少なすぎ・2026-10-26）
  const rng = Math.random
  let lastHour = 0
  const res = simulate({
    hours: HOURS, seed, start,
    rowExtra: (id) => (APPLY && weapons.get(id)?.shinka ? { shinka: weapons.get(id).shinka } : null),
    onBattle: ({ r, enc, win, at, hour, weaponId, cls, prof, inv }) => {
      lastHour = hour
      if (!weaponId) return false
      let w = weapons.get(weaponId)
      if (!w) {
        w = { srec: S.emptySrec(), mastery: 0, shinka: null, from: hour, to: hour, afterBattles: 0, shinkaHour: null, killer: null, band: null, killerHit: 0, bandHit: 0,
          decay: Object.fromEntries(DECAYS.map(n => [n, {}])), alt: {}, top2: [], prevRecent: null, switches: 0 }
        weapons.set(weaponId, w)
      }
      w.to = hour
      const race = raceOf(enc.enemy.name)
      if (w.shinka) {
        // 真化したあと：キラーの種族の敵に当たった数・いちばん多かった時間帯に戦った数（能力がどれだけ活きるか）
        w.afterBattles++
        if (race === w.killer) w.killerHit++
        if (bandAt(at) === w.band) w.bandHit++
        // キラーの対策の案ごとに「その戦闘でキラーが効いたか」（--killer-alt の報告）
        const hit = (k, ok) => { if (ok) w.alt[k] = (w.alt[k] || 0) + 1 }
        for (const n of DECAYS) hit(`recent${n}`, race === topOf(w.decay[n]))   // 直近ほど重く数えた1位に、毎戦ついていく
        hit('top2', w.top2.includes(race))                                      // 真化したときの上位2種族
        hit('spot', race === SPOT_TOP[enc.spot.id])                              // いまいる場所でいちばん多い種族
        const now1800 = topOf(w.decay[1800])
        if (w.prevRecent && now1800 !== w.prevRecent) w.switches++
        w.prevRecent = now1800
      }
      // 直近ほど重く数えた種族の数（1戦ごとに (1−1/n) 倍して、勝った敵の種族に1足す）
      for (const n of DECAYS) {
        const d = w.decay[n]
        for (const k of Object.keys(d)) d[k] *= 1 - 1 / n
        if (win && race) d[race] = (d[race] || 0) + 1
      }
      if (w.shinka) return false
      w.mastery++
      w.srec = S.addSrec(w.srec, S.srecOfBattle(r, prof.username), { win, enemy: enc.enemy.name, band: bandAt(at) })
      if (w.mastery < S.SHINKA_MAX) return false
      const roll = S.rollShinka(w.srec, rng)
      w.shinka = roll
      w.shinkaHour = hour
      w.killer = S.killerRaceOf(w.srec)
      w.band = S.topBandOf(w.srec)?.band || null
      w.top2 = Object.entries(w.srec.race).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => k)
      w.prevRecent = topOf(w.decay[1800])
      const kills = Object.values(w.srec.race).reduce((a, b) => a + b, 0)
      events.push({
        start, seed, cls, hour, spot: enc.spot.id, area: enc.spot.area, weaponId,
        values: Object.fromEntries(S.FLAGS.map(f => [f.key, S.flagValueOf(w.srec, f)])),
        pool: S.flagsOf(w.srec), roll, killer: w.killer, band: S.topBandOf(w.srec),
        killerShare: kills ? (w.srec.race[w.killer] || 0) / kills : 0,
        snap: SAVE ? { prof: structuredClone(prof), inv: structuredClone(inv), at: at.toISOString() } : null,
      })
      return APPLY
    },
  })
  return { start, seed, weapons, events, res, lastHour }
}

const flagsReport = (runs) => {
  const ev = runs.flatMap(r => r.events)
  console.log(`\n=== 真化した回数 ${ev.length}（${runs.length}本 × ${HOURS}時間） ===`)
  // フラグの値の分かれ方
  console.log('\n--- フラグの値（真化した時点）：10% / 50% / 80% / 90%・いまの境目・立った割合 ---')
  for (const f of S.FLAGS) {
    if (f.special === 'race') continue
    const vs = ev.map(e => e.values[f.key]).filter(v => v !== null && v !== undefined)
    const stood = ev.filter(e => e.pool.some(p => p.key === f.key)).length
    console.log(`${pad(f.key, 7)} ${pad(f.label('朝'), 26)} ${[0.1, 0.5, 0.8, 0.9].map(p => pad(r2(pctl(vs, p)), 6)).join(' ')}  境目${f.dir === 'le' ? '≦' : '≧'}${f.th}  立った ${Math.round(stood / ev.length * 100)}%`)
  }
  // 立ったフラグの数
  const sizes = ev.map(e => e.pool.length)
  const hist = {}
  for (const s of sizes) hist[s] = (hist[s] || 0) + 1
  console.log(`\n立ったフラグの数（キラー込み）：平均 ${r2(sizes.reduce((a, b) => a + b, 0) / sizes.length)}　`, Object.entries(hist).map(([k, v]) => `${k}個:${v}`).join(' '))
  // 職業ごとの立ち方（上位職の名前）
  console.log('\n--- 職業ごと：立ったフラグ（立った回数／真化の回数） ---')
  const byCls = {}
  for (const e of ev) (byCls[e.cls] ||= []).push(e)
  for (const [cls, list] of Object.entries(byCls).sort()) {
    const cnt = {}
    for (const e of list) for (const p of e.pool) if (p.key !== 'killer') cnt[p.key] = (cnt[p.key] || 0) + 1
    console.log(`${pad(cls, 10)} ${list.length}回  ${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' ')}`)
  }
  // キラーと時間帯がどれだけ活きるか
  console.log(`\nキラーの種族の割合（真化した時点・倒した敵のうち）：中央値 ${r2(pctl(ev.map(e => e.killerShare), 0.5))}　いちばん多い時間帯の割合：中央値 ${r2(pctl(ev.map(e => e.band?.share || 0), 0.5))}`)
  const done = runs.flatMap(r => [...r.weapons.values()]).filter(w => w.shinka && w.afterBattles >= 360)
  const kh = done.map(w => w.killerHit / w.afterBattles)
  console.log(`真化したあと（1時間以上使った武器 ${done.length}本）：キラーの種族の敵に当たった割合 10% ${r2(pctl(kh, 0.1))}・中央値 ${r2(pctl(kh, 0.5))}・90% ${r2(pctl(kh, 0.9))}　同じ時間帯に戦った割合 中央値 ${r2(pctl(done.map(w => w.bandHit / w.afterBattles), 0.5))}`)
  // キラーの対策の案ごとの当たる割合（どれも同じ武器・同じ戦闘で数える）
  const altOf = (k) => done.map(w => (w.alt[k] || 0) / w.afterBattles)
  const line = (label, xs) => `${label}：10% ${r2(pctl(xs, 0.1))}・中央値 ${r2(pctl(xs, 0.5))}・90% ${r2(pctl(xs, 0.9))}・平均 ${r2(xs.reduce((a, b) => a + b, 0) / xs.length)}`
  console.log('--- キラーの対策の案：真化したあとにキラーが効いた戦闘の割合 ---')
  console.log(line('いまの形（真化したときの1位に固定）', kh))
  for (const n of DECAYS) console.log(line(`直近ほど重く数えた1位についていく（${n}戦）`, altOf(`recent${n}`)))
  console.log(line('真化したときの上位2種族（固定）', altOf('top2')))
  console.log(line('いまいる場所でいちばん多い種族', altOf('spot')))
  const sw = done.map(w => w.switches / (w.afterBattles / 360))
  console.log(`直近（1800戦）についていくとき、種族が入れ替わった回数：1時間あたり 中央値 ${r2(pctl(sw, 0.5))}・90% ${r2(pctl(sw, 0.9))}`)
  // キラーの種族
  const kr = {}
  for (const e of ev) kr[e.killer] = (kr[e.killer] || 0) + 1
  console.log('\nキラーの種族：', Object.entries(kr).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${RACE_BY_KEY[k]?.label || k}${v}`).join(' '))
  // 付いた能力
  const ab = {}
  for (const e of ev) { const k = `${e.roll.key}${e.roll.cost ? '(代償)' : ''}`; ab[k] = (ab[k] || 0) + 1 }
  console.log('付いた能力：', Object.entries(ab).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' '))
  // 武器の持ち替え
  console.log('\n--- 武器の持ち替え（1本の進行ごと） ---')
  console.log('職業(最初)  seed  着けた武器  MAXまで使えた  真化した時間（時間目）  真化した武器を使った時間（そのあと）')
  for (const r of runs) {
    const ws = [...r.weapons.values()]
    const done = ws.filter(w => w.shinka)
    console.log(`${pad(r.start, 10)} ${pad(r.seed, 5)} ${pad(ws.length, 11)} ${pad(done.length, 14)} ${pad(done.map(w => Math.round(w.shinkaHour)).join(','), 30)} ${done.map(w => r2(w.afterBattles / 360)).join(',')}`)
  }
  const all = runs.flatMap(r => [...r.weapons.values()])
  const used = all.map(w => w.mastery + w.afterBattles)
  console.log(`\n武器1本を着けていた戦闘数：中央値 ${pctl(used, 0.5)}・80% ${pctl(used, 0.8)}・MAX（${S.SHINKA_MAX}）に届いた割合 ${Math.round(all.filter(w => w.shinka).length / all.length * 100)}%`)
  const firstHours = runs.map(r => Math.min(...[...r.weapons.values()].filter(w => w.shinka).map(w => w.shinkaHour))).filter(Number.isFinite)
  console.log(`はじめて真化した時間：中央値 ${r2(pctl(firstHours, 0.5))}時間目（${firstHours.length}/${runs.length}本が${HOURS}時間までに真化）`)
  // 進み方
  const clear = (r, k) => r.res.spotClearHour[k * 3 + 3]
  console.log('\nエリアの③を倒した時間（中央値）：', Array.from({ length: 15 }, (_, k) => {
    const v = runs.map(r => clear(r, k)).filter(x => x !== undefined)
    return `${k + 1}:${v.length ? r2(pctl(v, 0.5)) : '-'}(${v.length})`
  }).join(' '))
}

// ===== 戦闘力+何%相当か =====
const bossFoe = (boss, m, race) => ({ ...areas.toFighter(boss, 8, Math.max(1, Math.round(areas.enemyPowerOf(boss) * m))), boss: true, ...(race ? { race } : {}) })
const winRate = (f, boss, m, n, race) => {
  let w = 0
  for (let i = 0; i < n; i++) if (runBattle(f, bossFoe(boss, m, race), { rng: rngOf(5 + i * 7919) }).winner === 'a') w++
  return w / n
}
const m50 = (f, boss, n, race) => {
  let lo = 0.05, hi = 8
  for (let i = 0; i < 11; i++) { const mid = Math.sqrt(lo * hi); if (winRate(f, boss, mid, n, race) > 0.5) lo = mid; else hi = mid }
  return Math.sqrt(lo * hi)
}
const valueReport = (file) => {
  const N = Number(arg('n', 80))
  const PER = Number(arg('per', 6))
  const ev = JSON.parse(readFileSync(file, 'utf8')).filter(e => e.snap)
  const out = {}   // 能力（＋代償）→ [相当%]
  const outOther = {}
  // そのフラグが**いまの境目で**立つか（書き出したあとに境目を直しても測り直せるよう、保存したフラグの値で見る）
  const stands = (e, f) => {
    if (f.special === 'race') return !!e.killer
    const v = e.values[f.key]
    if (v === null || v === undefined) return false
    return f.dir === 'le' ? v <= f.th : v >= f.th
  }
  const paramOf = (e, f) => (f.special === 'race' ? e.killer : f.special === 'band' ? e.band?.band : null)
  const ONLY = arg('only', null)?.split(',')   // --only killer,crit … その能力だけ測る
  for (const f of S.FLAGS) {
    if (ONLY && !ONLY.includes(f.key)) continue
    // 書き出したときと記録の取り方が変わって、立っている人がいないフラグは、全員から拾って測る（行の頭に＊）
    const standing = ev.filter(e => stands(e, f))
    const list = standing.length ? standing : ev
    if (!standing.length) out[`＊${f.key}`] = []
    // 職業が偏らないように、職業ごとに順番に拾う
    const byCls = {}
    for (const e of list) (byCls[e.cls] ||= []).push(e)
    const picks = []
    for (let i = 0; picks.length < PER && i < 50; i++) for (const l of Object.values(byCls)) if (l[i] && picks.length < PER) picks.push(l[i])
    for (const e of picks) {
      const p = { key: f.key, param: paramOf(e, f) }
      const at = new Date(e.snap.at)
      const boss = areas.spotOf(e.spot).roster.boss
      const race = f.key === 'killer' ? p.param : null
      const base = toFighter(e.snap.prof, e.snap.inv.map(r => ({ ...r, shinka: null })), { at })
      const plus5 = { ...base, stats: Object.fromEntries(STAT_KEYS.map(k => [k, Math.round((base.stats[k] || 0) * 1.05)])) }
      const m0 = m50(base, boss, N, race)
      const m5 = m50(plus5, boss, N, race)
      const unit = Math.log(m5 / m0)
      for (const cost of [false, true]) {
        if (cost && !S.ABILITIES[f.key].alt) continue
        const sh = { key: f.key, cost, param: p.param }
        const wid = e.snap.prof.equipped.weapon
        const inv = e.snap.inv.map(r => (r.id === wid ? { ...r, shinka: sh } : { ...r, shinka: null }))
        // 時間帯の能力は、その時間帯に戦ったとき（当たったとき）
        const at2 = f.key === 'band' ? new Date(Date.UTC(2026, 0, 1, { 朝: 0, 昼: 5, 晩: 13 }[p.param])) : at
        const fa = toFighter(e.snap.prof, inv, { at: at2 })
        const ma = m50(fa, boss, N, race)
        const k = `${standing.length ? '' : '＊'}${f.key}${cost ? '(代償)' : ''}`
        ;(out[k] ||= []).push(unit > 0 ? 5 * Math.log(ma / m0) / unit : NaN)
        if (f.key === 'killer' && cost) {
          // 代償つきキラー：ほかの種族の相手（その場所のボスの種族がキラーの種族と同じなら獣にする）
          const other = areas.toFighter(boss).race !== race ? null : race === 'beast' ? 'dragon' : 'beast'
          const mo0 = m50(base, boss, N, other)
          const mo = m50(fa, boss, N, other)
          ;(outOther[k] ||= []).push(unit > 0 ? 5 * Math.log(mo / mo0) / unit : NaN)
        }
      }
      process.stdout.write('.')
    }
  }
  console.log(`\n\n=== 戦闘力+何%相当か（そのフラグが立っていたキャラ・その場所のボス・同じ乱数・n=${N}） ===`)
  console.log('能力                    中央値  （最小〜最大）  測った数   いまの値')
  for (const [k, vs] of Object.entries(out)) {
    if (!vs.length) continue
    const key = k.replace('(代償)', '').replace('＊', '')
    const sh = { key, cost: k.includes('代償'), param: key === 'killer' ? 'beast' : key === 'band' ? '晩' : null }
    const ok = vs.filter(Number.isFinite)
    console.log(`${pad(k, 22)} ${pad(r2(pctl(ok, 0.5)), 6)}  （${r2(Math.min(...ok))}〜${r2(Math.max(...ok))}）  ${pad(ok.length, 6)}  ${S.shinkaLines(sh).map(l => l.text).join('／')}`)
  }
  for (const [k, vs] of Object.entries(outOther)) console.log(`${pad(k + 'ほかの種族', 22)} ${r2(pctl(vs.filter(Number.isFinite), 0.5))}`)
}

if (arg('value', null)) {
  valueReport(arg('value'))
} else {
  const runs = []
  for (const start of START) for (const seed of SEEDS) {
    const t0 = Date.now()
    runs.push(runOne(start, seed))
    process.stderr.write(`${start} seed${seed} ${Math.round((Date.now() - t0) / 1000)}秒\n`)
  }
  flagsReport(runs)
  if (SAVE) writeFileSync(SAVE, JSON.stringify(runs.flatMap(r => r.events)))
}
