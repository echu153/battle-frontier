// ============================================================
// v2 進行速度シミュレーション — 「1日1時間」でどこまで育つかを実際のルールで回す
// ------------------------------------------------------------
// 目標（2026-08-25 ユーザー決定）：1日1時間で
//   難易度① 3日 ／ ② 1週間 ／ ③ 2週間 ／ ④ 1か月
//   ⑤ 3か月 ／ ⑥ 6か月 ／ ⑦ 9か月 ／ ⑧ 1年
//
// 回すもの（全部 src/v2/lib の本物を使う）
//   ・出撃：クールタイム10秒＝1時間で360回。EXPは expOf、ドロップは rollDrop（3%）
//   ・レベル：expPerLv（転職100回ごとに+10）／LV100で転職＝転職回数×100戦闘力
//   ・装備：落ちたものを溜めて、同じ品・同じ強化値が3個そろったら鍛冶で強化（rollFuse）
//   ・戦闘力：本体 ＋ 装備8枠（powerOf）
//
// ⚠ここに入れていない伸びしろ（＝実際はもう少し速い）：ルーン・武器の進化・拠点・取引所。
//   なので出てくる戦闘力は**下限の見積もり**として使う。
//
//   node tools/v2-progress.mjs
// ============================================================
const B = new URL('../src/v2/lib/', import.meta.url).href
const { expPerLv, MAX_LV, ROLLS_PER_LV, JOB_CHANGE_POWER, INITIAL_STATS, calcPower } = await import(B + 'stats.js')
const { EXP_ZAKO_MIN, EXP_ZAKO_MAX, EXP_BOSS, BOSS_RATE_STEP, rollDrop, DROP_RATE } = await import(B + 'sortie.js')
const { powerOf, SLOTS, PARTS } = await import(B + 'equipment.js')
const { rollFuse, RESULT_UP, MAT_COUNT } = await import(B + 'smith.js')
const { AREAS_SORTED } = await import(B + 'enemies.js')
const { SCARECROW_8H } = await import(B + 'basecamp.js')

export const SORTIES_PER_DAY = 360        // 10秒クールタイム × 1時間
const BODY_AT_LV100 = 534                 // 初期39 ＋ LVアップ99回×5

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// 装備の「枠ごとに一番強いものを着ける」。両手武器は右手＋左手を1つで埋める
const bestLoadout = (bag) => {
  // bag: Map<itemId, Map<plus, 個数>> ／ 実物は ITEM_BY_ID から引ける
  const best = {}
  for (const [item, byPlus] of bag) {
    for (const [plus, n] of byPlus) {
      if (n <= 0) continue
      const p = powerOf(item, plus)
      const key = item.part === '武器' ? (item.hands === 2 ? 'weapon2' : 'weapon1') : item.part
      if (!best[key] || best[key].p < p) best[key] = { item, plus, p }
    }
  }
  let total = 0
  // 武器枠：両手1本 か 片手2本 の強いほう
  const two = best.weapon2?.p || 0
  const one = (best.weapon1?.p || 0) * 2      // 同じ品を2本持てる前提ではなく上振れ抑制のため後で補正
  total += Math.max(two, one)
  for (const part of ['頭', '鎧', '腕', '足']) total += best[part]?.p || 0
  total += (best['アクセ']?.p || 0) * 2
  return total
}

// 1人ぶんを days 日ぶん回す
export const simulate = (days, { seed = 1, areaOf = () => 1, tierOfDay = () => 1 } = {}) => {
  const rng = rngOf(seed)
  let lv = 1, exp = 0, jc = 0
  let bossRate = 0
  const bag = new Map()            // item -> Map(plus -> count)
  const add = (item, plus, n = 1) => {
    if (!bag.has(item)) bag.set(item, new Map())
    const m = bag.get(item)
    m.set(plus, (m.get(plus) || 0) + n)
  }
  const take = (item, plus, n) => {
    const m = bag.get(item)
    m.set(plus, m.get(plus) - n)
  }
  const out = []

  for (let d = 1; d <= days; d++) {
    // その日のエリア（＝いま挑んでいる難易度帯）。呼び出し側が決める
    const area = areaOf(d)
    // 拠点のかかし。1日1回だけ回収する前提（8時間ぶんで満杯）。
    // グレードは「エリアをどこまで開けたか」で伸びる（basecamp.js reqAreaOf）
    const grade = Math.max(1, Math.min(9, tierOfDay(d) + 1))
    let scarecrow = SCARECROW_8H[grade - 1]
    // 時間帯つきの「本日の部位」は1時間に1つ。日ごとに1つ選ぶ
    const at = new Date(Date.UTC(2026, 0, 1, Math.floor(rng() * 24)))

    for (let s = 0; s < SORTIES_PER_DAY; s++) {
      const wasBoss = rng() * 100 < bossRate
      bossRate = wasBoss ? 0 : bossRate + BOSS_RATE_STEP
      const gain = wasBoss ? EXP_BOSS : EXP_ZAKO_MIN + Math.floor(rng() * (EXP_ZAKO_MAX - EXP_ZAKO_MIN + 1))

      // かかしのEXPは1日の頭でまとめて入る
      const bonus = s === 0 ? scarecrow : 0
      if (s === 0) scarecrow = 0
      if (lv < MAX_LV) {
        exp += gain + bonus
        const need = expPerLv(jc)
        while (lv < MAX_LV && exp >= need) { exp -= need; lv += 1 }
        if (lv >= MAX_LV) exp = 0
      }
      if (lv >= MAX_LV) { jc += 1; lv = 1; exp = 0 }   // LV上限＝すぐ転職する

      if (rng() * 100 < DROP_RATE) {
        const item = rollDrop(area, at, rng)
        if (item) add(item, 0)
      }
    }

    // その日ぶんの鍛冶。同じ品・同じ強化値が3個そろうたびに強化する（下の段から）
    for (const [item, byPlus] of bag) {
      let moved = true
      while (moved) {
        moved = false
        for (const plus of [...byPlus.keys()].sort((a, b) => a - b)) {
          while ((byPlus.get(plus) || 0) >= MAT_COUNT + 1) {
            take(item, plus, MAT_COUNT + 1)
            const r = rollFuse(item.rank, false, rng)
            add(item, plus + RESULT_UP[r])
            moved = true
          }
        }
      }
    }

    const equip = bestLoadout(bag)
    const body = jc * JOB_CHANGE_POWER + calcPower(INITIAL_STATS) + (lv - 1) * ROLLS_PER_LV
    // ★ボスに挑むときの戦闘力＝**その時点で行けるLV100**。
    //   壁に当たった人は転職を止めてLV100で挑むので、そこが「挑戦できる力」になる
    const peak = jc * JOB_CHANGE_POWER + BODY_AT_LV100 + equip
    out.push({ day: d, jc, lv, body, equip, power: body + equip, peak })
  }
  return out
}

// ===== 目標 =====
export const GOAL_DAYS = { 1: 3, 2: 7, 3: 14, 4: 30, 5: 90, 6: 180, 7: 270, 8: 365 }

// 「その日はどの帯のエリアを回しているか」。目標どおりに進んだ場合の割り当て
const areaForDay = (d) => {
  let tier = 8
  for (const [t, day] of Object.entries(GOAL_DAYS)) { if (d <= day) { tier = Number(t); break } }
  return AREAS_SORTED.find(a => a.tier === tier).id
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const DAYS = 365
  const tierForDay = (d) => { for (const [t, day] of Object.entries(GOAL_DAYS)) if (d <= day) return Number(t); return 8 }
  const runs = [1, 2, 3, 4, 5].map(seed => simulate(DAYS, { seed, areaOf: areaForDay, tierOfDay: tierForDay }))
  const at = (d) => {
    const rows = runs.map(r => r[d - 1])
    const avg = (k) => rows.reduce((t, x) => t + x[k], 0) / rows.length
    return { jc: avg('jc'), body: avg('body'), equip: avg('equip'), power: avg('power'), peak: avg('peak') }
  }
  console.log('■ 1日1時間（出撃360回）で育つ速さ ― 5回まわした平均')
  console.log('日数     転職    本体      装備      挑戦力    ｜ 目標の帯')
  for (const [t, day] of Object.entries(GOAL_DAYS)) {
    const a = at(day)
    const boss = AREAS_SORTED.find(x => x.tier === Number(t)).boss.power
    console.log(
      String(day).padStart(4) + '日  ' + a.jc.toFixed(1).padStart(6) + '  ' +
      Math.round(a.body).toLocaleString('ja-JP').padStart(8) + '  ' +
      Math.round(a.equip).toLocaleString('ja-JP').padStart(8) + '  ' +
      Math.round(a.peak).toLocaleString('ja-JP').padStart(8) + '   ｜ ' +
      '難易度' + t + ' 今のボス ' + boss.toLocaleString('ja-JP') +
      '（挑戦力比 ' + (boss / a.peak * 100).toFixed(0) + '%）')
  }
  console.log('\n■ ふだんの伸び（30日ごと）')
  for (let d = 30; d <= DAYS; d += 30) {
    const a = at(d)
    console.log(String(d).padStart(4) + '日  転職' + a.jc.toFixed(0).padStart(4) +
      '  挑戦力 ' + Math.round(a.peak).toLocaleString('ja-JP').padStart(8) +
      '（うち装備 ' + Math.round(a.equip).toLocaleString('ja-JP') + '）')
  }
  console.log('\n※ ルーン・武器の進化・拠点・取引所は入れていないので、実際はこれより少し速い')
}
