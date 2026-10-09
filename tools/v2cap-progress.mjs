// ============================================================
// v2cap（レベルキャップあり版）進行シミュレーション
// ------------------------------------------------------------
// 1日1時間（10秒に1戦＝360戦）を、この版のルールと**本物の戦闘（runBattle）**で回す。
//   ・場所は1本道（15エリア×①②③）。いつも「開いている一番先の場所」で戦う
//   ・EXPとGold（場所の表×役割の倍率）／LVアップの抽選／ClassEXP／スキル習得／
//     装備ドロップ（基本装備・ランク・アイテムLV）／必要LV不足
//   ・職業は最初の職業のまま（一次職は一旦なし）。--cls で選ぶ（既定は戦士）
//   ・装備は落ちたものから「その職業に効くステの合計」が一番大きいものを各枠に着ける
//   ・戦闘用のキャラは**画面と同じ toFighter**（loadout.js）で作る
//
//   node tools/v2cap-progress.mjs [--days 365] [--seed 1] [--cls 戦士] [--quiet]
//   node tools/v2cap-progress.mjs --report [--days 450]   … 初期10職×2で、エリアを抜けた日と節目のLV
//   node tools/v2cap-progress.mjs --tune [--days 450] [--rounds 8] [--step 0.35]
//     … 必要EXP・必要ClassEXPの係数、標準の戦闘力（STD_RATIO）、場所のLV帯（SPOT_LV）、
//       ボスの倍率（エリアの値 AREA_BOSS）を、目安に合うまで回して作り直す（出力をそのまま貼る）
// ============================================================
const B = new URL('../src/', import.meta.url).href
const { runBattle } = await import(B + 'v2/lib/battle.js')
const { STAT_KEYS, INITIAL_STATS, calcPower } = await import(B + 'v2/lib/stats.js')
const { setMpCost } = await import(B + 'v2cap/lib/skills.js')
const { ITEM_BY_ID } = await import(B + 'v2cap/lib/equipment.js')
const areas = await import(B + 'v2cap/lib/areas.js')
const level = await import(B + 'v2cap/lib/level.js')
const jobsLib = await import(B + 'v2cap/lib/jobs.js')
const { statsAt, effectPct } = await import(B + 'v2cap/lib/gear.js')
const { toFighter, totalStats } = await import(B + 'v2cap/lib/loadout.js')
const { pickEncounter, rollEquipDrop, rollRewards, nextBossRate, openUntilOf, clearSpot } = await import(B + 'v2cap/lib/sortie.js')
const { LAST_SPOT, AREA_LIST, toFighter: enemyFighter, stdPowerAt } = areas
const { applyExp, bodyPowerAt, totalExpTo } = level
const { applyJobExp, jobOf, learnOrderOf, attackKindOf, canEquipType, JOB_MAX, jobTotalTo } = jobsLib

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const DAYS = Number(arg('days', 365))
const SEED = Number(arg('seed', 1))
const START = arg('cls', '戦士')
const QUIET = process.argv.includes('--quiet')
const PER_DAY = 360

// ===== 目安 =====
// エリアの③のボスを倒せるようになる日（1日1時間）。今のⅡの「難易度帯ごとの日数」
// （① 3日／② 1週／③ 2週／④ 1か月／⑤ 3か月／⑥ 半年／⑦ 9か月／⑧ 1年・2026-08-25 ユーザー決定）を、
// 帯に入っていたエリアへ等分して割り振った（帯に2つあれば半分ずつ、3つなら3分の1ずつ）
export const AREA_DAY = [3, 7, 14, 22, 30, 60, 90, 135, 180, 210, 240, 270, 302, 333, 365]
// エリアの中の①②③の割り振り。③のボスは特に強い（ユーザー指示）ので③に半分をあてる
export const SUB_SHARE = [0.25, 0.5, 1]
export const SPOT_DAY = AREA_DAY.flatMap((end, k) => {
  const start = k ? AREA_DAY[k - 1] : 0
  return SUB_SHARE.map(f => start + (end - start) * f)
})
const LV100_DAY = 365   // LV100に着く日（1日1時間で1年・ユーザー決定）
const JOB30_DAY = 14    // 最初の職業がClassLV30に着く日（2週間くらい・ユーザー決定）

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const useful = (cls) => attackKindOf(cls) === 'mag' ? ['int_stat', 'dex', 'agi', 'vit'] : ['str', 'dex', 'agi', 'vit']
const ARMOR_SLOT = { 頭:'head', 鎧:'body', 腕:'arm', 足:'foot' }

export const simulate = ({ days = DAYS, seed = SEED, start = START } = {}) => {
  const rng = rngOf(seed)
  const st = { lv: 1, exp: 0, ...INITIAL_STATS }
  const cls = start
  let jobs = { [cls]: { lv: 1, exp: 0 } }
  let learned = applyJobExp(jobs, cls, 0).learned
  let cleared = [], bossRate = 0, gold = 0, cumExp = 0
  let inventory = []                   // { id, base_id, rank, ilv }（画面の v2cap_inventory と同じ形）
  let equipped = {}
  let nextId = 1
  let skillSet = []
  const daily = []
  const spotClearDay = {}              // 場所 → ボスを倒した日（小数）
  const lvAtSpotDay = {}               // 場所 → 目安の日のLV
  const expAtSpotDay = {}              // 場所 → 目安の日までに稼いだEXPの合計
  const expInSpot = {}                 // 場所 → そこで稼いだEXP
  const daysInSpot = {}                // 場所 → そこにいた日数（1日1時間で数える）
  const powerByLv = {}                 // LV -> [戦闘力]
  let job30Day = null
  let expAtJobDay = null
  let expAtLvDay = null

  const prof = () => ({
    username:'me', class: cls, lv: st.lv,
    ...Object.fromEntries(STAT_KEYS.map(k => [k, st[k]])),
    jobs, learned, skill_sets: { [cls]: skillSet }, equipped,   // スキルセットは職業ごと（画面の v2cap_profiles と同じ形）
  })
  const valueOf = (row) => {
    const s = statsAt(ITEM_BY_ID[row.base_id], row.rank, row.ilv, effectPct(row.ilv, st.lv))
    return useful(cls).reduce((t, k) => t + s[k], 0)
  }
  const best = (rows) => [...rows].sort((a, b) => valueOf(b) - valueOf(a))
  const regear = () => {
    const item = (r) => ITEM_BY_ID[r.base_id]
    const next = {}
    const w = best(inventory.filter(r => item(r).part === '武器' && canEquipType(cls, item(r).type)))[0]
    if (w) next.weapon = w.id
    for (const [part, slot] of Object.entries(ARMOR_SLOT)) {
      const a = best(inventory.filter(r => item(r).part === part))[0]
      if (a) next[slot] = a.id
    }
    const accs = best(inventory.filter(r => item(r).part === 'アクセ'))
    if (accs[0]) next.acc1 = accs[0].id
    if (accs[1]) next.acc2 = accs[1].id
    equipped = next
    // 持ち物は着けているもの＋新しいほうから40個まで（重くしない）
    const keep = new Set(Object.values(equipped))
    if (inventory.length > 60) inventory = inventory.filter((r, i) => keep.has(r.id) || i >= inventory.length - 40)
  }
  // スキル編成：いまの職業の覚えた技を後ろ（強い技）から5つ。回数はMPに収まるだけ均等に
  const reset = () => {
    const names = learnOrderOf(cls).map(s => s.name).filter(n => learned.includes(n)).slice(-5).reverse()
    const mp = totalStats(prof(), inventory).mp
    const uses = names.map(() => 1)
    const cost = () => setMpCost(names.map((name, i) => ({ name, uses: uses[i] })))
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < names.length; i++) {
        if (uses[i] >= 5) continue
        uses[i]++
        if (cost() > mp) uses[i]--
        else grew = true
      }
    }
    skillSet = cost() <= mp ? names.map((n, i) => ({ name: n, uses: uses[i] })) : []
  }
  reset()

  let t = Date.UTC(2026, 0, 1)
  let nextMark = 0   // 次に「目安の日のLV」を記録する場所（0始まり）
  for (let d = 1; d <= days; d++) {
    let wins = 0, fights = 0
    for (let s = 0; s < PER_DAY; s++) {
      t += 10_000
      const day = d - 1 + s / PER_DAY   // 小数の日（序盤の場所は数時間で抜けるため）
      while (nextMark < LAST_SPOT && day >= SPOT_DAY[nextMark]) {
        lvAtSpotDay[nextMark + 1] = st.lv
        expAtSpotDay[nextMark + 1] = cumExp
        nextMark++
      }
      if (expAtJobDay === null && day >= JOB30_DAY) expAtJobDay = cumExp
      if (expAtLvDay === null && day >= LV100_DAY) expAtLvDay = cumExp
      const at = new Date(t)
      const spot = openUntilOf(cleared)
      const enc = pickEncounter(spot, bossRate, at, rng)
      const r = runBattle(toFighter(prof(), inventory), { ...enemyFighter(enc.enemy), boss: enc.isBoss }, { rng })
      const win = r.winner === 'a'
      fights++
      daysInSpot[spot] = (daysInSpot[spot] || 0) + 1 / PER_DAY
      bossRate = nextBossRate(bossRate, enc.isBoss)
      if (win) wins++
      // ★負けても経験値はその場所の最低値が入る（倍率なし・Goldなし）＝画面・サーバーと同じ
      const { exp, gold: g } = rollRewards(enc, rng, win)
      gold += g
      cumExp += exp
      expInSpot[spot] = (expInSpot[spot] || 0) + exp
      const lvBefore = st.lv
      const res = applyExp(st, exp, rng)
      st.lv = res.lv; st.exp = res.exp
      for (const k of STAT_KEYS) st[k] = res.stats[k]
      const j = applyJobExp(jobs, cls, exp, learned)
      jobs = j.jobs
      if (job30Day === null && j.lv >= JOB_MAX) job30Day = day
      let dirty = res.lv !== lvBefore || j.ups.length > 0
      if (j.learned.length) { learned = [...learned, ...j.learned]; dirty = true }
      if (win) {
        const drop = rollEquipDrop(enc, cls, at, rng)
        if (drop) { inventory.push({ id: nextId++, base_id: drop.item.id, rank: drop.rank, ilv: drop.ilv }); dirty = true }
        if (enc.isBoss && !cleared.includes(spot)) {
          cleared = clearSpot(cleared, spot)
          spotClearDay[spot] = day
        }
      }
      if (dirty) { regear(); reset() }
      if (res.lv !== lvBefore) (powerByLv[st.lv] ||= []).push(calcPower(totalStats(prof(), inventory)))
    }
    daily.push({ d, lv: st.lv, power: calcPower(totalStats(prof(), inventory)), body: bodyPowerAt(st.lv), win: wins / fights,
      spot: openUntilOf(cleared), cls, jlv: jobOf(jobs, cls).lv, gold })
  }
  if (expAtJobDay === null) expAtJobDay = cumExp
  if (expAtLvDay === null) expAtLvDay = cumExp
  return {
    daily, spotClearDay, lvAtSpotDay, expAtSpotDay, expInSpot, daysInSpot, powerByLv,
    learned, cls, jobs, job30Day, expAtJobDay, expAtLvDay, gold,
  }
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
const round2 = (v) => Math.round(v * 100) / 100
const areaClearDay = (r, k) => r.spotClearDay[k * 3 + 3]   // エリアk（0始まり）の③を倒した日

// ===== --tune =====
// 1回ごとに「回す → 測る → 表を作り直す」を繰り返して落ち着かせる。最後に、後半の回の平均を出す
// （それを areas.js / level.js / jobs.js と SQL の係数へそのまま貼る）。
//   ・必要EXP・必要ClassEXP・場所のLV帯 … 場所ごとの「1日あたりのEXP」を測り、**目安どおりに進んだとき**の
//     合計EXPから決める（だれかが遅れた・進んだに引きずられない）
//   ・ボスの倍率 … その場所に**入ってから倒すまでの日数**（1人ずつの中央値）が目安に近づくように
//   ⚠「目安の日に実際に稼いだEXP」や「最初からの通算の日」で合わせると、1か所の遅れが後ろ全部に響いて、
//     回ごとに大きく振れた（2026-10-09 実際に踏んだ）
const tune = async () => {
  const classes = ['戦士', '盗賊', '魔法使い', '薬師']
  const seeds = String(arg('seeds', '1,2')).split(',').map(Number)
  const rounds = Number(arg('rounds', 10))
  const step = Number(arg('step', 0.3))
  const clip = Number(arg('clip', 0.1))   // 1回に動かすボスの倍率の幅（±10%）
  const keep = Number(arg('keep', 4))     // 平均を採る後半の回の数
  // 回を追うごとに動かす幅を小さくする（0.7なら 10%→7%→4.9%…）。終盤の場所は戦闘力の伸びがゆっくりで、
  // ボスの倍率を少し動かすだけで倒せる日が大きく動く＝同じ幅のままだと行ったり来たりして収まらない
  const anneal = Number(arg('anneal', 1))
  const hist = []
  const lvFromExp = (e) => { let lv = 1; while (lv < level.MAX_LV && totalExpTo(lv + 1) <= e) lv++; return lv }
  const meanExp = (id) => { const s = areas.spotOf(id); return (s.exp[0] + s.exp[1]) / 2 }
  const spotDays = (id) => SPOT_DAY[id - 1] - (id > 1 ? SPOT_DAY[id - 2] : 0)
  for (let it = 1; it <= rounds; it++) {
    const results = []
    for (const c of classes) for (const s of seeds) results.push(simulate({ days: DAYS, seed: s, start: c }))

    // 1) 場所ごとの1日あたりのEXP（中央値）。3人未満しか来ていない場所は、表のEXPの比で前の場所から伸ばす
    const rate = []
    for (let id = 1; id <= LAST_SPOT; id++) {
      const vals = results.filter(r => (r.daysInSpot[id] || 0) >= 0.02).map(r => (r.expInSpot[id] || 0) / r.daysInSpot[id])
      rate[id] = vals.length >= 3 || id === 1 ? median(vals) : rate[id - 1] * meanExp(id) / meanExp(id - 1)
    }
    // 目安どおりに進んだときの、その場所の目安の日までの合計EXP
    const cumAt = [0]
    for (let id = 1; id <= LAST_SPOT; id++) cumAt[id] = cumAt[id - 1] + rate[id] * spotDays(id)
    const cumAtDay = (d) => {
      for (let id = 1; id <= LAST_SPOT; id++) if (d <= SPOT_DAY[id - 1]) return cumAt[id - 1] + rate[id] * (d - (id > 1 ? SPOT_DAY[id - 2] : 0))
      return cumAt[LAST_SPOT]
    }
    // 2) 必要EXP：最後のボスの目安の日（365日目）に、ちょうどLV100までの合計になるように
    const needNow = level.NEED_PERMIL
    const needNext = Math.max(1, Math.round(needNow * cumAt[LAST_SPOT] / totalExpTo(level.MAX_LV)))
    level.setNeedPermilForTuning(needNext)
    // 3) 必要ClassEXP：14日目に、ちょうどClassLV30までの合計になるように（最初の職業のまま進んだとき）
    const jobNow = jobsLib.JOB_NEED_TENTHS
    const jobNext = Math.max(1, Math.round(jobNow * cumAtDay(JOB30_DAY) / jobTotalTo('shoki', JOB_MAX)))
    jobsLib.setJobNeedForTuning(jobNext)
    // 4) 場所のLV帯：目安の日までの合計EXPを、新しい必要EXPでLVに直す。下限は前の場所の上限・最後はLV100
    let prevHi = 1
    for (let id = 1; id <= LAST_SPOT; id++) {
      const hi = id === LAST_SPOT ? level.MAX_LV : Math.min(level.MAX_LV, Math.max(prevHi, lvFromExp(cumAt[id])))
      areas.SPOT_LV[id - 1] = [prevHi, hi]
      prevHi = hi
    }
    // 5) 標準の戦闘力：そのLVに着いたときの戦闘力（本体に対する倍率）の平均
    const acc = {}
    for (const r of results) for (const [lv, arr] of Object.entries(r.powerByLv)) for (const p of arr) (acc[lv] ||= []).push(p / bodyPowerAt(Number(lv)))
    for (const row of areas.STD_RATIO) {
      const vals = []
      for (let l = row[0] - 2; l <= row[0] + 2; l++) if (acc[l]) vals.push(...acc[l])
      if (vals.length) row[1] = round2(vals.reduce((a, b) => a + b, 0) / vals.length)
    }
    for (let i = 1; i < areas.STD_RATIO.length; i++) areas.STD_RATIO[i][1] = Math.max(areas.STD_RATIO[i][1], areas.STD_RATIO[i - 1][1])
    // 6) ボスの倍率（エリアの値 AREA_BOSS）：そのエリアに入ってから③のボスを倒すまでの日数
    //    （1人ずつの中央値）が目安に近づくように。①②③の倍率（SUB_BOSS）は決まっていて動かさない。
    //    期間内に倒せなかった人は「期間の終わりまで＋30日」として数える
    for (let k = 0; k < AREA_LIST.length; k++) {
      const durs = []
      for (const r of results) {
        const start = k === 0 ? 0 : r.spotClearDay[k * 3]
        if (start === undefined) continue
        const end = r.spotClearDay[k * 3 + 3]
        durs.push(end === undefined ? DAYS - start + 30 : end - start)
      }
      if (durs.length < 3) continue
      const want = AREA_DAY[k] - (k ? AREA_DAY[k - 1] : 0)
      const c = clip * Math.pow(anneal, it - 1)
      const f = Math.min(1 + c, Math.max(1 - c, Math.pow(want / Math.max(0.01, median(durs)), step)))
      areas.AREA_BOSS[k] = round2(Math.max(0.3, areas.AREA_BOSS[k] * f))
    }
    hist.push({ need: needNext, job: jobNext, std: areas.STD_RATIO.map(r => r[1]), hi: areas.SPOT_LV.map(r => r[1]), boss: [...areas.AREA_BOSS] })

    // ---- 毎回の様子 ----
    const areaDays = AREA_LIST.map((a, k) => {
      const got = results.map(r => areaClearDay(r, k)).filter(v => v !== undefined)
      return got.length ? `${Math.round(median(got))}(${got.length})` : '-'
    })
    const lv365 = median(results.map(r => r.daily[Math.min(LV100_DAY, r.daily.length) - 1].lv))
    const job30 = median(results.map(r => r.job30Day ?? DAYS + 60))
    console.log(`--- ${it}回目  365日目のLV ${lv365}・ClassLV30 ${job30?.toFixed(1)}日目・必要EXP ${needNow}→${needNext}・必要ClassEXP ${jobNow}→${jobNext}`)
    console.log(`エリアの③を倒した日（中央値・目安 ${AREA_DAY.join('/')}）: ${areaDays.join(' ')}`)
  }

  // ---- 後半の回の平均（これを貼る）----
  const last = hist.slice(-keep)
  const avg = (f) => last.reduce((t, h) => t + f(h), 0) / last.length
  const his = areas.SPOT_LV.map((_, i) => Math.round(avg(h => h.hi[i])))
  for (let i = 1; i < his.length; i++) his[i] = Math.max(his[i], his[i - 1])
  console.log(`\n===== 後半${last.length}回の平均（そのまま貼る）=====`)
  console.log(`export let NEED_PERMIL = ${Math.round(avg(h => h.need))}       // level.js と SQL の v2cap_need`)
  console.log(`export let JOB_NEED_TENTHS = ${Math.round(avg(h => h.job))}    // jobs.js と SQL の v2cap_job_need`)
  console.log('export const STD_RATIO = [\n  ' + areas.STD_RATIO.map(([l], i) => `[${l}, ${round2(avg(h => h.std[i]))}]`).join(', ') + ',\n]')
  console.log('export const SPOT_LV = [\n  ' + his.map((hi, i) => `[${i ? his[i - 1] : 1}, ${hi}]`).join(', ') + ',\n]')
  console.log('export const AREA_BOSS = [\n  ' + areas.AREA_BOSS.map((_, i) => round2(avg(h => h.boss[i]))).join(', ') + ',\n]')
}

// ===== --report：職業別に回して、エリアを抜けた日と節目のLVを並べる =====
// 初期職10 × seed 2通り
const report = () => {
  const classes = ['戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士', '魔法使い', '呪術師', '僧侶', '薬師']
  const seeds = [11, 12]
  const marks = [3, 7, 14, 30, 90, 180, 270, 365].filter(x => x <= DAYS)
  console.log(`エリアの③を倒した日（目安 ${AREA_DAY.join('/')}）／節目の日のLV／ClassLV30の日／365日目のGold`)
  console.log(['職業', ...AREA_LIST.map((_, k) => `E${k + 1}`), '|', ...marks.map(m => `${m}日`), '|', 'JB30', 'Gold'].join('\t'))
  const all = {}
  for (const c of classes) {
    for (const s of seeds) {
      const r = simulate({ days: DAYS, seed: s, start: c })
      const row = AREA_LIST.map((_, k) => { const v = areaClearDay(r, k); return v === undefined ? '-' : Math.round(v) })
      AREA_LIST.forEach((_, k) => { const v = areaClearDay(r, k); if (v !== undefined) (all[k] ||= []).push(v) })
      const gold365 = r.daily[Math.min(365, r.daily.length) - 1].gold
      console.log([c, ...row, '|', ...marks.map(m => r.daily[m - 1]?.lv ?? '-'), '|', r.job30Day === null ? '-' : r.job30Day.toFixed(1), gold365].join('\t'))
    }
  }
  const runs = classes.length * seeds.length
  console.log('中央値\t' + AREA_LIST.map((_, k) => { const a = all[k] || []; return a.length ? `${Math.round(median(a))}(${a.length}/${runs})` : '-' }).join('\t'))
}

if (process.argv.includes('--tune')) {
  await tune()
} else if (process.argv.includes('--report')) {
  report()
} else if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('v2cap-progress.mjs')) {
  const r = simulate()
  const pick = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 240, 270, 300, 365].filter(x => x <= DAYS)
  if (!QUIET) {
    console.log(`職業=${START} seed=${SEED}`)
    console.log('日\tLV\t戦闘力\t(本体)\t勝率\t場所\tClassLV\tGold')
    for (const x of pick) {
      const v = r.daily[x - 1]
      console.log(`${x}\t${v.lv}\t${v.power}\t(${v.body})\t${(v.win * 100).toFixed(0)}%\t${areas.spotLabel(v.spot)}\t${v.jlv}\t${v.gold}`)
    }
    console.log('エリアの③を倒した日:', AREA_LIST.map((a, k) => { const v = areaClearDay(r, k); return `${a.name}${v === undefined ? '-' : Math.round(v * 10) / 10}` }).join(' '))
    console.log('ClassLV30:', r.job30Day === null ? '-' : `${r.job30Day.toFixed(1)}日目`)
    const lvs = [1, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    console.log('LVごとの平均戦闘力（実測 / stdPowerAt）:', lvs.map(l => {
      const a = r.powerByLv[l]; const m = a ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '-'
      return `${l}:${m}/${stdPowerAt(l)}`
    }).join(' '))
  }
}
