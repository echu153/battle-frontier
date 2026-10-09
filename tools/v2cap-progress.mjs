// ============================================================
// v2cap（レベルキャップあり版）進行シミュレーション
// ------------------------------------------------------------
// 1日1時間（10秒に1戦＝360戦）を、この版のルールと**本物の戦闘（runBattle）**で回す。
//   ・EXP／LVアップの抽選／JBEXP／スキル習得／装備ドロップ（基本装備・ランク・アイテムLV）／必要LV不足
//   ・エリアは「開いている一番上の帯」。帯の中では、まだボスを倒していないエリアを先に選ぶ
//   ・職業は最初の職業のまま（一次職は一旦なし・2026-10-09）。--cls で選ぶ（既定は戦士）
//   ・装備は落ちたものから「その職業に効くステの合計」が一番大きいものを各枠に着ける。
//     武器はいまの職業が装備できる種類だけ
//   ・戦闘用のキャラは**画面と同じ toFighter**（loadout.js）で作る＝防具のメリットや武器の制限も同じ
//
// 出すもの：日ごとのLV・戦闘力・勝率・いる帯、帯を抜けた日、LVごとの平均戦闘力（stdPowerAt の当て先）
//
//   node tools/v2cap-progress.mjs [--days 365] [--seed 1] [--cls 戦士] [--quiet]
// ============================================================
const B = new URL('../src/', import.meta.url).href
const { runBattle } = await import(B + 'v2/lib/battle.js')
const { STAT_KEYS, INITIAL_STATS, calcPower } = await import(B + 'v2/lib/stats.js')
const { SKILL_BY_NAME, mpOf } = await import(B + 'v2cap/lib/skills.js')
const { ITEM_BY_ID } = await import(B + 'v2cap/lib/equipment.js')
const { AREAS_SORTED, toFighter: enemyFighter, stdPowerAt } = await import(B + 'v2cap/lib/areas.js')
const { applyExp, rollExp, bodyPowerAt } = await import(B + 'v2cap/lib/level.js')
const { applyJobExp, jobOf, learnOrderOf, attackKindOf, canEquipType } = await import(B + 'v2cap/lib/jobs.js')
const { statsAt, effectPct } = await import(B + 'v2cap/lib/gear.js')
const { toFighter, totalStats } = await import(B + 'v2cap/lib/loadout.js')
const { pickEncounter, rollEquipDrop, nextBossRate, unlockNext, clearNext, isAreaUnlocked, restToOpenNext } = await import(B + 'v2cap/lib/sortie.js')

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const DAYS = Number(arg('days', 365))
const SEED = Number(arg('seed', 1))
const START = arg('cls', '戦士')
const QUIET = process.argv.includes('--quiet')
const PER_DAY = 360

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const useful = (cls) => attackKindOf(cls) === 'mag' ? ['int_stat', 'dex', 'agi', 'vit'] : ['str', 'dex', 'agi', 'vit']
const ARMOR_SLOT = { 頭:'head', 鎧:'body', 腕:'arm', 足:'foot' }

export const simulate = ({ days = DAYS, seed = SEED, start = START } = {}) => {
  const rng = rngOf(seed)
  const st = { lv: 1, exp: 0, ...INITIAL_STATS }
  const cls = start
  let jobs = { [cls]: { lv: 1, exp: 0 } }
  let learned = applyJobExp(jobs, cls, 0).learned
  let unlocked = [1], cleared = [], bossRate = 0
  let inventory = []                   // { id, base_id, rank, ilv }（画面の v2cap_inventory と同じ形）
  let equipped = {}
  let nextId = 1
  let skillSet = []
  const daily = []
  const tierClearDay = {}
  const powerByLv = {}                 // LV -> [戦闘力]

  const prof = () => ({
    username:'me', class: cls, lv: st.lv,
    ...Object.fromEntries(STAT_KEYS.map(k => [k, st[k]])),
    jobs, skill_set: skillSet, equipped,
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
    const cost = () => names.reduce((t, n, i) => t + mpOf(cls, SKILL_BY_NAME[n]) * uses[i], 0)
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
  for (let d = 1; d <= days; d++) {
    let wins = 0, fights = 0
    for (let s = 0; s < PER_DAY; s++) {
      t += 10_000
      const at = new Date(t)
      // 開いている一番上の帯。その帯でまだボスを倒していないエリアを先に
      const open = AREAS_SORTED.filter(a => isAreaUnlocked(unlocked, a.id))
      const top = Math.max(...open.map(a => a.tier))
      const inTop = open.filter(a => a.tier === top)
      const area = inTop.find(a => !cleared.includes(a.id)) || inTop[s % inTop.length]
      const enc = pickEncounter(area.id, bossRate, at, rng)
      const r = runBattle(toFighter(prof(), inventory), { ...enemyFighter(enc.enemy), boss: enc.isBoss }, { rng })
      const win = r.winner === 'a'
      fights++
      bossRate = nextBossRate(bossRate, enc.isBoss)
      if (!win) continue
      wins++
      const gain = rollExp(enc.lv, enc.isBoss, rng)
      const lvBefore = st.lv
      const res = applyExp(st, gain, rng)
      st.lv = res.lv; st.exp = res.exp
      for (const k of STAT_KEYS) st[k] = res.stats[k]
      const j = applyJobExp(jobs, cls, gain, learned)
      jobs = j.jobs
      let dirty = res.lv !== lvBefore || j.ups.length > 0
      if (j.learned.length) { learned = [...learned, ...j.learned]; dirty = true }
      const drop = rollEquipDrop(enc, cls, at, rng)
      if (drop) { inventory.push({ id: nextId++, base_id: drop.item.id, rank: drop.rank, ilv: drop.ilv }); dirty = true }
      if (enc.isBoss) {
        cleared = clearNext(cleared, area.id, true, true)
        unlocked = unlockNext(unlocked, cleared)
        // ★帯を抜けた日＝その帯のボスを必要な数だけ倒した日。
        //   ⚠「次の帯が開いた日」で数えると、次の無い⑧がいつまでも抜けたことにならない（2026-10-09 実際に踏んだ）
        if (!tierClearDay[area.tier] && restToOpenNext(cleared, area.tier) === 0) tierClearDay[area.tier] = d
      }
      if (dirty) { regear(); reset() }
      if (res.lv !== lvBefore) (powerByLv[st.lv] ||= []).push(calcPower(totalStats(prof(), inventory)))
    }
    const open = AREAS_SORTED.filter(a => isAreaUnlocked(unlocked, a.id))
    daily.push({ d, lv: st.lv, power: calcPower(totalStats(prof(), inventory)), body: bodyPowerAt(st.lv), win: wins / fights,
      tier: Math.max(...open.map(a => a.tier)), cls, jlv: jobOf(jobs, cls).lv })
  }
  return { daily, tierClearDay, powerByLv, learned, cls, jobs }
}

// ===== --tune：stdPowerAt（areas.js の STD_RATIO）を実測に合わせる =====
// 敵の強さは stdPowerAt から決まり、プレイヤーの育ち方は敵の強さで変わる＝
// 「回す → そのLVに着いたときの平均の戦闘力で表を作り直す」を何度か繰り返して落ち着かせる。
// 出てきた表を areas.js の STD_RATIO へそのまま貼る
const tune = async () => {
  const areas = await import(B + 'v2cap/lib/areas.js')
  const classes = ['戦士', '盗賊', '魔法使い', '薬師']
  const seeds = [1, 2]
  const rounds = Number(arg('rounds', 4))
  const round2 = (v) => Math.round(v * 100) / 100
  for (let it = 1; it <= rounds; it++) {
    const acc = {}
    const clears = {}
    for (const c of classes) for (const s of seeds) {
      const r = simulate({ days: DAYS, seed: s, start: c })
      for (const [lv, arr] of Object.entries(r.powerByLv)) {
        for (const p of arr) (acc[lv] ||= []).push(p / bodyPowerAt(Number(lv)))
      }
      for (const [t, d] of Object.entries(r.tierClearDay)) (clears[t] ||= []).push(d)
    }
    for (const row of areas.STD_RATIO) {
      const vals = []
      for (let l = row[0] - 2; l <= row[0] + 2; l++) if (acc[l]) vals.push(...acc[l])
      if (vals.length) row[1] = round2(vals.reduce((a, b) => a + b, 0) / vals.length)
    }
    // LV100は着かないことが多いので、手前の値を引き継ぐ。表は右肩上がりにそろえる
    for (let i = 1; i < areas.STD_RATIO.length; i++) {
      areas.STD_RATIO[i][1] = Math.max(areas.STD_RATIO[i][1], areas.STD_RATIO[i - 1][1])
    }
    const runs = classes.length * seeds.length
    const avgDay = (t) => {
      const a = clears[t] || []
      // 抜けられなかった人は「期間の終わり＋60日」として数える（前の帯を抜けた人だけ）
      const prevOk = t === 1 ? runs : (clears[t - 1] || []).length
      const missing = Math.max(0, prevOk - a.length)
      const all = [...a, ...Array(missing).fill(DAYS + 60)]
      return all.length ? all.reduce((x, y) => x + y, 0) / all.length : null
    }
    const days = Object.keys(TARGET_DAY).map(Number).filter(t => avgDay(t) !== null)
      .map(t => `${t}:${Math.round(avgDay(t))}日(${(clears[t] || []).length}/${runs})`)
    console.log(`--- ${it}回目 帯を抜けた日（平均・目安 ${Object.values(TARGET_DAY).join('/')}）: ${days.join(' ')}`)
    // ★--boss：帯ごとのボスの倍率を「その帯にいる日数」が目安に近づく向きへ少しずつ動かす
    if (process.argv.includes('--boss')) {
      let prev = 0, prevTarget = 0
      for (const t of Object.keys(TARGET_DAY).map(Number)) {
        const d = avgDay(t)
        if (d === null) break
        const actual = Math.max(0.5, d - prev)
        const want = TARGET_DAY[t] - prevTarget
        const f = Math.min(1.15, Math.max(0.85, Math.pow(want / actual, Number(arg('step', 0.35)))))
        areas.BOSS_RATIO[t] = round2(Math.max(0.6, areas.BOSS_RATIO[t] * f))
        prev = d; prevTarget = TARGET_DAY[t]
      }
      console.log('export const BOSS_RATIO = ' + JSON.stringify(areas.BOSS_RATIO).replace(/"/g, '').replace(/,/g, ', ').replace(/:/g, ': '))
    }
    console.log('export const STD_RATIO = [\n  ' + areas.STD_RATIO.map(([l, r]) => `[${l}, ${r}]`).join(', ') + ',\n]')
  }
}
// 帯を抜ける日の目安（今のⅡと同じ・1日1時間）
const TARGET_DAY = { 1: 3, 2: 7, 3: 14, 4: 30, 5: 90, 6: 180, 7: 270, 8: 365 }

// ===== --report：職業別に回して、帯を抜けた日と節目のLVを並べる =====
// 初期職10 × seed 2通り
const report = () => {
  const classes = ['戦士', '槍使い', '格闘家', '盗賊', '弓使い', '銃士', '魔法使い', '呪術師', '僧侶', '薬師']
  const seeds = [11, 12]
  const marks = [3, 7, 14, 30, 90, 180, 270, 365].filter(x => x <= DAYS)
  console.log(`帯を抜けた日（目安 ${Object.values(TARGET_DAY).join('/')}）／節目の日のLV`)
  console.log(['職業', ...Object.keys(TARGET_DAY).map(t => `帯${t}`), '|', ...marks.map(m => `${m}日`)].join('\t'))
  const all = {}
  for (const c of classes) {
    for (const s of seeds) {
      const r = simulate({ days: DAYS, seed: s, start: c })
      const row = Object.keys(TARGET_DAY).map(t => r.tierClearDay[t] ?? '-')
      Object.keys(TARGET_DAY).forEach(t => { if (r.tierClearDay[t]) (all[t] ||= []).push(r.tierClearDay[t]) })
      console.log([`${c}→${r.cls}`, ...row, '|', ...marks.map(m => r.daily[m - 1]?.lv ?? '-')].join('\t'))
    }
  }
  const runs = classes.length * seeds.length
  console.log('中央値\t' + Object.keys(TARGET_DAY).map(t => {
    const a = (all[t] || []).sort((x, y) => x - y)
    return a.length ? `${a[Math.floor(a.length / 2)]}(${a.length}/${runs})` : '-'
  }).join('\t'))
}

if (process.argv.includes('--tune')) {
  await tune()
} else if (process.argv.includes('--report')) {
  report()
} else if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('v2cap-progress.mjs')) {
  const r = simulate()
  const pick = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 240, 270, 300, 365].filter(x => x <= DAYS)
  if (!QUIET) {
    console.log(`開始=${START} seed=${SEED}`)
    console.log('日\tLV\t戦闘力\t(本体)\t勝率\t帯\t職業(JBLV)')
    for (const x of pick) {
      const v = r.daily[x - 1]
      console.log(`${x}\t${v.lv}\t${v.power}\t(${v.body})\t${(v.win * 100).toFixed(0)}%\t${v.tier}\t${v.cls}(${v.jlv})`)
    }
    console.log('帯を抜けた日:', JSON.stringify(r.tierClearDay))
    const lvs = [1, 5, 10, 15, 20, 27, 34, 44, 63, 79, 90, 100]
    console.log('LVごとの平均戦闘力（実測 / stdPowerAt）:', lvs.map(l => {
      const a = r.powerByLv[l]; const m = a ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '-'
      return `${l}:${m}/${stdPowerAt(l)}`
    }).join(' '))
  }
}
