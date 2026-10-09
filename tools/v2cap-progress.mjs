// ============================================================
// v2cap（レベルキャップあり版）進行シミュレーション
// ------------------------------------------------------------
// **プレイ時間**で数える：1時間＝10秒に1戦×360戦。この版のルールと**本物の戦闘（runBattle）**で回す。
// ★2026-10-09 ユーザー指示「日数ていうか何時間かで計算してほしい」：前は「1日1時間」として日で数えていた（数字は同じ）
//   ・場所は1本道（15エリア×①②③）。いつも「開いている一番先の場所」で戦う
//   ・EXPとGold（場所の表×役割の倍率）／LVアップのステータスポイント／ClassEXP／スキル習得／必要LV不足
//   ・**ステータスポイントは、その職業のクラスのステと同じ割合で振る**（jobs.js の JOB_BONUS の並び bonusSeqOf を順に）
//   ・最初の職業は --cls で選ぶ（既定は戦士）。**ClassLV30になったら、その系統の一次職へすぐ転職する**（2026-10-10）。
//     どちらの一次職か・組み方の例のどちらか（skillsIchiji.js の ICHIJI_BUILDS）は乱数の番号で決める
//     （1＝1つ目の職・1つ目の組み方／2＝2つ目の職・1つ目／3＝1つ目の職・2つ目／4＝2つ目の職・2つ目）。
//     まだ覚えていない枠は、系統の初期職の技（ふつうの並べ方）で埋める。剣士は一次職がまだ無いので剣士のまま
//   ・**装備は「その時点で着けられるいちばん良いもの」**（2026-10-09 ユーザー指示「シミュレーターは最適の装備で進めて」）：
//     行ったことのあるエリアの装備（レア度は全部）から、必要LVの不足ぶんも数えて、職業ごとのステの重み（STAT_WEIGHT）で
//     いちばん強いものを各枠に着ける。拾った装備の運は数えない（ドロップの細かい決まりはまだ決めていないため）
//   ・スキル編成はふつうの人の並べ方（typicalSet）
//   ・戦闘用のキャラは**画面と同じ toFighter**（loadout.js）で作る
//
//   node tools/v2cap-progress.mjs [--hours 365] [--seed 1] [--cls 戦士] [--quiet]
//   node tools/v2cap-progress.mjs --report [--hours 450]   … 初期職（いまは11職）×2で、エリアを抜けた時間と節目のLV
//   node tools/v2cap-progress.mjs --tune [--hours 450] [--rounds 8] [--step 0.35] [--clip 0.2] [--anneal 0.8] [--stddamp 0.5]
//     … 必要EXP・必要ClassEXPの係数、標準の戦闘力（STD_RATIO・LV1とLV5の行は動かさない）、
//       ボスの倍率（エリアの値 AREA_BOSS）を、目安に合うまで回して作り直す（出力をそのまま貼る）
//   node tools/v2cap-progress.mjs --statvalue [--areas 3,6,9,12] [--n 500] [--only 剣士]
//     … 職業ごとに「どのステを足すと③のボスに効くか」を測る（装備を選ぶ重み STAT_WEIGHT・同じステでの職業の強さ）
// ============================================================
const B = new URL('../src/', import.meta.url).href
const { runBattle } = await import(B + 'v2/lib/battle.js')
const { STAT_KEYS, INITIAL_STATS, calcPower } = await import(B + 'v2/lib/stats.js')
const { setMpCost } = await import(B + 'v2cap/lib/skills.js')
const { ITEMS } = await import(B + 'v2cap/lib/equipment.js')
const areas = await import(B + 'v2cap/lib/areas.js')
const level = await import(B + 'v2cap/lib/level.js')
const jobsLib = await import(B + 'v2cap/lib/jobs.js')
const { statsAt, effectPct } = await import(B + 'v2cap/lib/gear.js')
const { toFighter, totalStats } = await import(B + 'v2cap/lib/loadout.js')
const { CAP_RULES } = await import(B + 'v2cap/lib/rules.js')
const { pickEncounter, rollRewards, nextBossRate, openUntilOf, clearSpot } = await import(B + 'v2cap/lib/sortie.js')
const { LAST_SPOT, AREA_LIST, toFighter: enemyFighter, stdPowerAt } = areas
const { applyExp, bodyPowerAt, totalExpTo, POINT_UNIT, totalPointsTo } = level
const { applyJobExp, jobOf, learnOrderOf, attackKindOf, canEquipType, JOB_MAX, jobTotalTo, nextClassesOf, CLASS_BY_ID } = jobsLib
const { ICHIJI_BUILDS } = await import(B + 'v2cap/lib/skillsIchiji.js')

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const HOURS = Number(arg('hours', arg('days', 365)))   // 何時間ぶん回すか（--days は前の名前）
const SEED = Number(arg('seed', 1))
const START = arg('cls', '戦士')
const QUIET = process.argv.includes('--quiet')
const PER_HOUR = 360   // 1時間の戦闘数（10秒に1戦）

// ===== 目安 =====
// エリアの③のボスを倒せるようになるプレイ時間。今のⅡの「難易度帯ごとの日数（1日1時間）」をそのまま時間にした
// （① 3日／② 1週／③ 2週／④ 1か月／⑤ 3か月／⑥ 半年／⑦ 9か月／⑧ 1年・2026-08-25 ユーザー決定）を、
// 帯に入っていたエリアへ等分して割り振った（帯に2つあれば半分ずつ、3つなら3分の1ずつ）
export const AREA_HOUR = [3, 7, 14, 22, 30, 60, 90, 135, 180, 210, 240, 270, 302, 333, 365]
// エリアの中の①②③の割り振り。③のボスは特に強い（ユーザー指示）ので③に半分をあてる
export const SUB_SHARE = [0.25, 0.5, 1]
export const SPOT_HOUR = AREA_HOUR.flatMap((end, k) => {
  const start = k ? AREA_HOUR[k - 1] : 0
  return SUB_SHARE.map(f => start + (end - start) * f)
})
const LV100_HOUR = 365   // LV100に着くプレイ時間（1日1時間なら1年・ユーザー決定）
const JOB30_HOUR = 14    // 最初の職業がClassLV30に着くプレイ時間（1日1時間なら2週間くらい・ユーザー決定）

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const ARMOR_SLOT = { 頭:'head', 鎧:'body', 腕:'arm', 足:'foot' }

// ===== ふつうの人の選び方 =====
// 装備を選ぶときのステの重み（職業ごと）。「そのステを足すと③のボスにどれだけ効くか」を測ったもの
//   （node tools/v2cap-progress.mjs --statvalue・エリア3/6/9/12の③のボスの平均・一番効くステを1にした）
//   ★AGIはどの職業にもよく効く（回避・行動順・追加行動）。DEX・VITはあまり効かない
//   ⚠前は職業を見ずに「物理なら STR/DEX/AGI/VIT の合計」で選んでいた。STRだけで殴る職業ほど
//     要らないステの装備を着けて遅れていた（2026-10-09 実際に踏んだ）。スキルや戦闘を変えたら測り直す
//   ★2026-10-09 ステータスポイントにしたあと・剣士を足したあとに全職業を測り直した（--statvalue）
export const STAT_WEIGHT = {
  戦士:     { str:1.00, agi:0.63, vit:0.20, dex:0.16, int_stat:0.02 },
  槍使い:   { str:1.00, agi:0.85, int_stat:0.25, vit:0.12, dex:0.09 },
  格闘家:   { str:1.00, agi:0.70, dex:0.27, vit:0.17, int_stat:0.09 },
  盗賊:     { agi:1.00, str:0.54, vit:0.15, int_stat:0.10, dex:0.05 },
  弓使い:   { agi:1.00, str:0.67, vit:0.13, dex:0.08, int_stat:0.05 },
  銃士:     { agi:1.00, dex:0.90, str:0.62, int_stat:0.27, vit:0.19 },
  剣士:     { agi:1.00, str:0.90, dex:0.28, vit:0.25, int_stat:0.15 },
  魔法使い: { int_stat:1.00, agi:0.74, dex:0.25, vit:0.19, str:0 },
  呪術師:   { agi:1.00, int_stat:0.95, vit:0.19, dex:0.14, str:0 },
  僧侶:     { int_stat:1.00, agi:0.31, dex:0.23, vit:0.03, str:0 },
  薬師:     { int_stat:1.00, agi:0.62, vit:0.17, dex:0.09, str:0 },
}
// ★一次職はまだ測っていないので、系統の初期職の重みを使う
const weightOf = (cls) => STAT_WEIGHT[cls] || STAT_WEIGHT[CLASS_BY_ID[cls]?.req?.cls]
  || (attackKindOf(cls) === 'mag' ? { int_stat:1, agi:0.6 } : { str:1, agi:0.8 })
// スキル編成：強化の技を先頭に1回ずつ・攻撃の技は後に覚えたもの（強い技）から・回復の技は最後に1回ずつ。
//   MPだけを戻す技（気付け薬）は入れない。回数はMPに収まるだけ、攻撃の技へ前から1回ずつ足す（1枠5回まで）
//   ⚠前は「覚えた技を後ろから5つ・全部均等」で、薬師は気付け薬と強壮剤が先頭に来て損をしていた
//     （山登りで探した一番よい並べ方とくらべて、この並べ方は差が数%・2026-10-09）
const isMpOnly = (sk) => sk.kind === 'heal' && sk.mpRegen && !sk.heal && !sk.regen
const isAtk = (sk) => sk.kind === 'phys' || sk.kind === 'mag'
const orderForSet = (sks) => [...sks.filter(sk => sk.kind === 'buff'), ...sks.filter(isAtk).reverse(), ...sks.filter(sk => sk.kind === 'heal')]
export const typicalSet = (cls, learned, maxMp) => {
  const have = new Set(learned)
  const sks = learnOrderOf(cls).filter(sk => have.has(sk.name) && !isMpOnly(sk))
  return fitSet(orderForSet(sks).slice(0, 5), maxMp)
}
// 一次職：ユーザーの表の組み方の例（覚えた技だけ）＋足りない枠は系統の初期職の技（ふつうの並べ方）
export const ichijiSet = (cls, buildIdx, learned, maxMp) => {
  const have = new Set(learned)
  const build = ICHIJI_BUILDS[cls]?.[buildIdx] || []
  const own = learnOrderOf(cls).filter(sk => build.includes(sk.name) && have.has(sk.name))
  const base = CLASS_BY_ID[cls]?.req?.cls
  const fill = base
    ? orderForSet(learnOrderOf(base).filter(sk => have.has(sk.name) && !isMpOnly(sk))).slice(0, Math.max(0, 5 - own.length))
    : []
  // 種類ごと（強化→攻撃→回復）に並べ、同じ種類では一次職の技を先に置く
  const rank = (sk) => (sk.kind === 'buff' ? 0 : isAtk(sk) ? 1 : 2)
  const merged = [...orderForSet(own), ...fill].map((sk, i) => ({ sk, i })).sort((a, b) => rank(a.sk) - rank(b.sk) || a.i - b.i).map(x => x.sk)
  return fitSet(merged, maxMp)
}
const fitSet = (sks, maxMp) => {
  const set = sks.map(sk => ({ name: sk.name, uses: 1, atk: isAtk(sk) }))
  const cost = () => setMpCost(set)
  while (set.length && cost() > maxMp) set.pop()
  for (let grew = true; grew;) {
    grew = false
    for (const e of set) {
      if (!e.atk || e.uses >= 5) continue
      e.uses++
      if (cost() > maxMp) e.uses--
      else grew = true
    }
  }
  return set.map(({ name, uses }) => ({ name, uses }))
}

export const simulate = ({ hours = HOURS, seed = SEED, start = START } = {}) => {
  const rng = rngOf(seed)
  const st = { lv: 1, exp: 0, ...INITIAL_STATS }
  let cls = start
  // 一次職の選び方（乱数の番号で決める）
  const jobPick = (seed - 1) % 2
  const buildPick = Math.floor((seed - 1) / 2) % 2
  let advancedHour = null
  let jobs = { [cls]: { lv: 1, exp: 0 } }
  let learned = applyJobExp(jobs, cls, 0).learned
  let cleared = [], bossRate = 0, gold = 0, cumExp = 0
  let inventory = []                   // { id, base_id, ilv }（画面の v2cap_inventory と同じ形。着けている装備だけ）
  let equipped = {}
  let skillSet = []
  const hourly = []
  const spotClearHour = {}             // 場所 → ボスを倒した時間（小数）
  const lvAtSpotHour = {}              // 場所 → 目安の時間のLV
  const expAtSpotHour = {}             // 場所 → 目安の時間までに稼いだEXPの合計
  const expInSpot = {}                 // 場所 → そこで稼いだEXP
  const hoursInSpot = {}               // 場所 → そこにいた時間
  const fightsInSpot = {}              // 場所 → { n, win, boss, bossWin }（どこで詰まっているかを見る）
  const powerByLv = {}                 // LV -> [戦闘力]
  let job30Hour = null
  let expAtJobHour = null
  let expAtLvHour = null

  const prof = () => ({
    username:'me', class: cls, lv: st.lv,
    ...Object.fromEntries(STAT_KEYS.map(k => [k, st[k]])),
    jobs, learned, skill_sets: { [cls]: skillSet }, equipped,   // スキルセットは職業ごと（画面の v2cap_profiles と同じ形）
  })
  // 装備は「その時点で着けられるいちばん良いもの」。行ったことのあるエリア（開いている一番先の場所のエリアまで）の装備を、
  // レア度は全部（エピック・レジェンダリーも）候補にし、必要LVの不足ぶん（1LVごとに-5%）も数えて職業の重みで比べる
  let weight = weightOf(cls)
  const valueAt = (item) => {
    const s = statsAt(item, item.lv, effectPct(item.lv, st.lv))
    return Object.entries(weight).reduce((t, [k, w]) => t + (s[k] || 0) * w, 0)
  }
  const bestOf = (list) => {
    let b = null
    let bv = -1
    for (const x of list) { const v = valueAt(x); if (v > bv) { b = x; bv = v } }
    return b
  }
  let gearArea = 0
  const regear = () => {
    gearArea = areas.spotOf(openUntilOf(cleared)).area
    const pool = ITEMS.filter(i => i.area <= gearArea)
    const picks = { weapon: bestOf(pool.filter(i => i.part === '武器' && canEquipType(cls, i.type))) }
    for (const [part, slot] of Object.entries(ARMOR_SLOT)) picks[slot] = bestOf(pool.filter(i => i.part === part))
    picks.acc1 = picks.acc2 = bestOf(pool.filter(i => i.part === 'アクセ'))
    inventory = []
    equipped = {}
    for (const [slot, item] of Object.entries(picks)) {
      if (!item) continue
      inventory.push({ id: inventory.length + 1, base_id: item.id, ilv: item.lv })
      equipped[slot] = inventory.length
    }
  }
  // ステータスポイントは、その職業のクラスのステと同じ割合で振る（並び bonusSeqOf を前から順に・一周したら頭から）
  let pointSeq = jobsLib.bonusSeqOf(cls)
  let pointsUsed = 0
  const spendPoints = (n) => {
    for (let i = 0; i < n; i++) {
      const k = pointSeq[pointsUsed % pointSeq.length]
      st[k] += POINT_UNIT[k]
      pointsUsed++
    }
  }
  // スキル編成はふつうの人の並べ方（typicalSet）。覚えた技・最大MPが変わるたびに組み直す
  const reset = () => {
    const mp = totalStats(prof(), inventory).mp
    skillSet = CLASS_BY_ID[cls]?.stage === 'ichiji' ? ichijiSet(cls, buildPick, learned, mp) : typicalSet(cls, learned, mp)
  }
  // 転職：系統の一次職へ（ClassLVは1から・クラスのステはその職のぶんだけ・武器は同じ）
  const advance = (hour) => {
    const opts = nextClassesOf(cls)
    if (!opts.length) return false
    cls = opts[jobPick % opts.length]
    jobs = { ...jobs, [cls]: jobOf(jobs, cls) }
    const got = applyJobExp(jobs, cls, 0, learned).learned
    learned = [...learned, ...got]
    weight = weightOf(cls)
    pointSeq = jobsLib.bonusSeqOf(cls)
    pointsUsed = 0
    advancedHour = hour
    return true
  }
  regear()
  reset()

  let t = Date.UTC(2026, 0, 1)
  let nextMark = 0   // 次に「目安の時間のLV」を記録する場所（0始まり）
  for (let d = 1; d <= hours; d++) {   // d … 何時間目
    let wins = 0, fights = 0
    for (let s = 0; s < PER_HOUR; s++) {
      t += 10_000
      const hour = d - 1 + s / PER_HOUR   // 小数の時間（序盤の場所は数十分で抜けるため）
      while (nextMark < LAST_SPOT && hour >= SPOT_HOUR[nextMark]) {
        lvAtSpotHour[nextMark + 1] = st.lv
        expAtSpotHour[nextMark + 1] = cumExp
        nextMark++
      }
      if (expAtJobHour === null && hour >= JOB30_HOUR) expAtJobHour = cumExp
      if (expAtLvHour === null && hour >= LV100_HOUR) expAtLvHour = cumExp
      const at = new Date(t)
      const spot = openUntilOf(cleared)
      const enc = pickEncounter(spot, bossRate, at, rng)
      const r = runBattle(toFighter(prof(), inventory), { ...enemyFighter(enc.enemy), boss: enc.isBoss }, { rng })
      const win = r.winner === 'a'
      fights++
      hoursInSpot[spot] = (hoursInSpot[spot] || 0) + 1 / PER_HOUR
      bossRate = nextBossRate(bossRate, enc.isBoss)
      if (win) wins++
      const fs = (fightsInSpot[spot] ||= { n: 0, win: 0, boss: 0, bossWin: 0 })
      fs.n++; if (win) fs.win++
      if (enc.isBoss) { fs.boss++; if (win) fs.bossWin++ }
      // ★負けても経験値はその場所の最低値が入る（倍率なし・Goldなし）＝画面・サーバーと同じ
      const { exp, gold: g } = rollRewards(enc, rng, win)
      gold += g
      cumExp += exp
      expInSpot[spot] = (expInSpot[spot] || 0) + exp
      const lvBefore = st.lv
      const res = applyExp(st, exp)
      st.lv = res.lv; st.exp = res.exp
      if (res.points) spendPoints(res.points)
      const j = applyJobExp(jobs, cls, exp, learned)
      jobs = j.jobs
      let dirty = res.lv !== lvBefore || j.ups.length > 0
      if (j.learned.length) { learned = [...learned, ...j.learned]; dirty = true }
      // 初期職がClassLV30（上限）になったら、すぐ系統の一次職へ（★最初の職業のClassLV30の時間は転職の前に数える）
      if (CLASS_BY_ID[cls]?.stage === 'shoki' && j.lv >= JOB_MAX) {
        if (job30Hour === null) job30Hour = hour
        if (advance(hour)) dirty = true
      }
      if (win && enc.isBoss && !cleared.includes(spot)) {
        cleared = clearSpot(cleared, spot)
        spotClearHour[spot] = hour
        if (areas.spotOf(openUntilOf(cleared)).area !== gearArea) dirty = true   // 新しいエリアの装備が着けられる
      }
      if (dirty) { regear(); reset() }
      if (res.lv !== lvBefore) (powerByLv[st.lv] ||= []).push(calcPower(totalStats(prof(), inventory)))
    }
    hourly.push({ d, lv: st.lv, power: calcPower(totalStats(prof(), inventory)), body: bodyPowerAt(st.lv), win: wins / fights,
      spot: openUntilOf(cleared), cls, jlv: jobOf(jobs, cls).lv, gold })
  }
  if (expAtJobHour === null) expAtJobHour = cumExp
  if (expAtLvHour === null) expAtLvHour = cumExp
  return {
    hourly, spotClearHour, lvAtSpotHour, expAtSpotHour, expInSpot, hoursInSpot, powerByLv,
    learned, cls, start, jobs, job30Hour, advancedHour, expAtJobHour, expAtLvHour, gold,
    fightsInSpot,
    final: { profile: prof(), inventory },   // 最後のキャラ（職業ごとの強さを比べるのに使う）
  }
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
const round2 = (v) => Math.round(v * 100) / 100
const areaClearHour = (r, k) => r.spotClearHour[k * 3 + 3]   // エリアk（0始まり）の③を倒した時間

// ===== --tune =====
// 1回ごとに「回す → 測る → 表を作り直す」を繰り返して落ち着かせる。最後に、後半の回の平均を出す
// （それを areas.js / level.js / jobs.js と SQL の係数へそのまま貼る）。
//   ・必要EXP・必要ClassEXP … 場所ごとの「1時間あたりのEXP」を測り、**目安どおりに進んだとき**の
//     合計EXPから決める（だれかが遅れた・進んだに引きずられない）
//   ★敵のLVは敵ごとに一定（monsters.js の AREA_LEVELS・2026-10-09 ユーザー指示）なので、ここでは作らない。
//     前は「場所のLV帯（SPOT_LV）」をここで作り、敵のLVをそこから決めていた
//   ・ボスの倍率 … その場所に**入ってから倒すまでの時間**（1人ずつの中央値）が目安に近づくように
//   ⚠「目安の時間に実際に稼いだEXP」や「最初からの通算の時間」で合わせると、1か所の遅れが後ろ全部に響いて、
//     回ごとに大きく振れた（2026-10-09 実際に踏んだ）
// 測り直しで動かさない標準の戦闘力の行（このLV以下）。始まりの森①の敵（LV1・2）を装備なしのLV1で勝てる強さに保つ
const STD_FIXED_LV = 5
const tune = async () => {
  const classes = ['戦士', '盗賊', '魔法使い', '薬師']
  const seeds = String(arg('seeds', '1,2')).split(',').map(Number)
  const rounds = Number(arg('rounds', 10))
  const step = Number(arg('step', 0.3))
  const clip = Number(arg('clip', 0.1))   // 1回に動かすボスの倍率の幅（±10%）
  const keep = Number(arg('keep', 4))     // 平均を採る後半の回の数
  // 回を追うごとに動かす幅を小さくする（0.7なら 10%→7%→4.9%…）。終盤の場所は戦闘力の伸びがゆっくりで、
  // ボスの倍率を少し動かすだけで倒せる時間が大きく動く＝同じ幅のままだと行ったり来たりして収まらない
  const anneal = Number(arg('anneal', 1))
  // 標準の戦闘力（STD_RATIO）を、測った値へ1回でどれだけ近づけるか（0.5なら差の半分ずつ・掛け算で）。
  // ⚠1（測った値へそのまま置き換え）だと、出発点が遠いときに 速すぎ→遅すぎ→… と振れて収まらない（2026-10-09 実際に踏んだ）。
  //   敵の強さは全部これに掛かるので、ここが一気に動くと全部の場所が一度に振れる
  const stdDamp = Number(arg('stddamp', 0.5))
  const hist = []
  const meanExp = (id) => { const s = areas.spotOf(id); return (s.exp[0] + s.exp[1]) / 2 }
  const spotHours = (id) => SPOT_HOUR[id - 1] - (id > 1 ? SPOT_HOUR[id - 2] : 0)
  for (let it = 1; it <= rounds; it++) {
    const results = []
    for (const c of classes) for (const s of seeds) results.push(simulate({ hours: HOURS, seed: s, start: c }))

    // 1) 場所ごとの1時間あたりのEXP（中央値）。3人未満しか来ていない場所は、表のEXPの比で前の場所から伸ばす
    const rate = []
    for (let id = 1; id <= LAST_SPOT; id++) {
      const vals = results.filter(r => (r.hoursInSpot[id] || 0) >= 0.02).map(r => (r.expInSpot[id] || 0) / r.hoursInSpot[id])
      rate[id] = vals.length >= 3 || id === 1 ? median(vals) : rate[id - 1] * meanExp(id) / meanExp(id - 1)
    }
    // 目安どおりに進んだときの、その場所の目安の時間までの合計EXP
    const cumAt = [0]
    for (let id = 1; id <= LAST_SPOT; id++) cumAt[id] = cumAt[id - 1] + rate[id] * spotHours(id)
    const cumAtHour = (d) => {
      for (let id = 1; id <= LAST_SPOT; id++) if (d <= SPOT_HOUR[id - 1]) return cumAt[id - 1] + rate[id] * (d - (id > 1 ? SPOT_HOUR[id - 2] : 0))
      return cumAt[LAST_SPOT]
    }
    // 2) 必要EXP：最後のボスの目安（365時間目）に、ちょうどLV100までの合計になるように
    const needNow = level.NEED_PERMIL
    const needNext = Math.max(1, Math.round(needNow * cumAt[LAST_SPOT] / totalExpTo(level.MAX_LV)))
    level.setNeedPermilForTuning(needNext)
    // 3) 必要ClassEXP：14時間目に、ちょうどClassLV30までの合計になるように（最初の職業のまま進んだとき）
    const jobNow = jobsLib.JOB_NEED_TENTHS
    const jobNext = Math.max(1, Math.round(jobNow * cumAtHour(JOB30_HOUR) / jobTotalTo('shoki', JOB_MAX)))
    jobsLib.setJobNeedForTuning(jobNext)
    // 4) 標準の戦闘力：そのLVに着いたときの戦闘力（本体に対する倍率）の平均へ、stdDamp の割合で近づける
    //    ★LVが STD_FIXED_LV 以下の行は動かさない：いちばん良い装備で回すとLV1から始まりの森の装備を全部着けている
    //      （LV1で2.4倍と測れる）。始まりの森①の敵（LV1・2）は装備なしのLV1で勝てる強さのまま（ユーザー指示「未装備でも倒せるように」）
    const acc = {}
    for (const r of results) for (const [lv, arr] of Object.entries(r.powerByLv)) for (const p of arr) (acc[lv] ||= []).push(p / bodyPowerAt(Number(lv)))
    for (const row of areas.STD_RATIO) {
      if (row[0] <= STD_FIXED_LV) continue
      const vals = []
      for (let l = row[0] - 2; l <= row[0] + 2; l++) if (acc[l]) vals.push(...acc[l])
      if (vals.length) row[1] = round2(row[1] * Math.pow(vals.reduce((a, b) => a + b, 0) / vals.length / row[1], stdDamp))
    }
    //    倍率はLVが上がって下がってもよい（ステータスポイントにしてから、実際の倍率はLV34あたりが山で少しずつ下がる）。
    //    ただし標準の戦闘力（本体×倍率）は1LVごとに下がらないように：本体は1LVで3以上増えるので、
    //    倍率の下がり方を「次の行の倍率 ≥ 前の行 × 本体(次) ÷ (本体(次)＋3×LVの差)」までにする（v2cap.test.js が全LVで見る）
    //    ⚠前は「倍率がLVで下がらない」にしていて、一度高く測った行の値が後ろの行へ全部うつって戻らなかった
    for (let i = 1; i < areas.STD_RATIO.length; i++) {
      const [l0, r0] = areas.STD_RATIO[i - 1]
      const l1 = areas.STD_RATIO[i][0]
      const b1 = bodyPowerAt(l1)
      const floor = Math.ceil(r0 * b1 / (b1 + 3 * (l1 - l0)) * 100) / 100
      areas.STD_RATIO[i][1] = Math.max(areas.STD_RATIO[i][1], floor)
    }
    // 5) ボスの倍率（エリアの値 AREA_BOSS）：そのエリアに入ってから③のボスを倒すまでの時間
    //    （1人ずつの中央値）が目安に近づくように。①②③の倍率（SUB_BOSS）は決まっていて動かさない。
    //    期間内に倒せなかった人は「期間の終わりまで＋30時間」として数える
    for (let k = 0; k < AREA_LIST.length; k++) {
      const durs = []
      for (const r of results) {
        const start = k === 0 ? 0 : r.spotClearHour[k * 3]
        if (start === undefined) continue
        const end = r.spotClearHour[k * 3 + 3]
        durs.push(end === undefined ? HOURS - start + 30 : end - start)
      }
      if (durs.length < 3) continue
      const want = AREA_HOUR[k] - (k ? AREA_HOUR[k - 1] : 0)
      const c = clip * Math.pow(anneal, it - 1)
      const f = Math.min(1 + c, Math.max(1 - c, Math.pow(want / Math.max(0.01, median(durs)), step)))
      areas.AREA_BOSS[k] = round2(Math.max(0.3, areas.AREA_BOSS[k] * f))
    }
    hist.push({ need: needNext, job: jobNext, std: areas.STD_RATIO.map(r => r[1]), boss: [...areas.AREA_BOSS] })

    // ---- 毎回の様子 ----
    const areaDays = AREA_LIST.map((a, k) => {
      const got = results.map(r => areaClearHour(r, k)).filter(v => v !== undefined)
      return got.length ? `${Math.round(median(got))}(${got.length})` : '-'
    })
    const lv365 = median(results.map(r => r.hourly[Math.min(LV100_HOUR, r.hourly.length) - 1].lv))
    const job30 = median(results.map(r => r.job30Hour ?? HOURS + 60))
    console.log(`--- ${it}回目  365時間目のLV ${lv365}・ClassLV30 ${job30?.toFixed(1)}時間目・必要EXP ${needNow}→${needNext}・必要ClassEXP ${jobNow}→${jobNext}`)
    console.log(`エリアの③を倒した時間（中央値・目安 ${AREA_HOUR.join('/')}）: ${areaDays.join(' ')}`)
  }

  // ---- 後半の回の平均（これを貼る）----
  const last = hist.slice(-keep)
  const avg = (f) => last.reduce((t, h) => t + f(h), 0) / last.length
  console.log(`\n===== 後半${last.length}回の平均（そのまま貼る）=====`)
  console.log(`export let NEED_PERMIL = ${Math.round(avg(h => h.need))}       // level.js と SQL の v2cap_need`)
  console.log(`export let JOB_NEED_TENTHS = ${Math.round(avg(h => h.job))}    // jobs.js と SQL の v2cap_job_need`)
  console.log('export const STD_RATIO = [\n  ' + areas.STD_RATIO.map(([l], i) => `[${l}, ${round2(avg(h => h.std[i]))}]`).join(', ') + ',\n]')
  console.log('export const AREA_BOSS = [\n  ' + areas.AREA_BOSS.map((_, i) => round2(avg(h => h.boss[i]))).join(', ') + ',\n]')
}

// ===== --report：職業別に回して、エリアを抜けた時間と節目のLVを並べる =====
// 初期職10 × seed 2通り
const report = () => {
  // ★職業の一覧は jobs.js から読む（直書きしていて、職業を足したときに漏れた）
  const classes = jobsLib.START_CLASSES
  const seeds = [11, 12]
  const marks = [3, 7, 14, 30, 90, 180, 270, 365].filter(x => x <= HOURS)
  console.log(`エリアの③を倒した時間（目安 ${AREA_HOUR.join('/')}）／節目の時間のLV／ClassLV30の時間／365時間目のGold`)
  console.log(['職業', ...AREA_LIST.map((_, k) => `E${k + 1}`), '|', ...marks.map(m => `${m}時間`), '|', 'JB30', 'Gold'].join('\t'))
  const all = {}
  for (const c of classes) {
    for (const s of seeds) {
      const r = simulate({ hours: HOURS, seed: s, start: c })
      const row = AREA_LIST.map((_, k) => { const v = areaClearHour(r, k); return v === undefined ? '-' : Math.round(v) })
      AREA_LIST.forEach((_, k) => { const v = areaClearHour(r, k); if (v !== undefined) (all[k] ||= []).push(v) })
      const gold365 = r.hourly[Math.min(365, r.hourly.length) - 1].gold
      console.log([c, ...row, '|', ...marks.map(m => r.hourly[m - 1]?.lv ?? '-'), '|', r.job30Hour === null ? '-' : r.job30Hour.toFixed(1), gold365].join('\t'))
    }
  }
  const runs = classes.length * seeds.length
  console.log('中央値\t' + AREA_LIST.map((_, k) => { const a = all[k] || []; return a.length ? `${Math.round(median(a))}(${a.length}/${runs})` : '-' }).join('\t'))
}

// ===== --statvalue：職業ごとに「どのステを足すと③のボスに効くか」を測る（STAT_WEIGHT を作る）=====
//   土台＝そのLVの本体の期待値＋クラスのステ（ClassLV30）＋装備ぶん（本体の1.2倍を STR/DEX/AGI/INT/VIT に等分）。
//   スキルはふつうの並べ方（全部覚えた状態）。1つのステに「装備ぶんの10%」を足したとき、
//   ③のボスに勝率50%になるボスの強さ（本物の何倍か）が何%上がるか。エリア3/6/9/12の平均
//   ★いちばん左の「強さ」は、同じステの職業どうしの強さの比べ（平均を100%）
const statValue = async () => {
  const { slotsOf } = await import(B + 'v2cap/lib/loadout.js')
  const { skillsOf } = await import(B + 'v2cap/lib/skills.js')
  // ★職業の一覧は jobs.js から読む。--only 剣士 のように一部だけも測れる（重みは職業ごとに決まるので、ほかの職業と一緒でなくてよい）
  const classes = arg('only', null) ? String(arg('only')).split(',') : jobsLib.START_CLASSES
  const checks = String(arg('areas', '3,6,9,12')).split(',').map(Number)
  const n = Number(arg('n', 500))
  const GEAR = ['str', 'dex', 'agi', 'int_stat', 'vit']
  const baseStats = (cls, lv) => {
    const job = jobsLib.jobBonusStats(cls, JOB_MAX)
    const gear = bodyPowerAt(lv) * 1.2
    // 本体＝初期値＋そのLVまでのポイントをクラスと同じ割合で振ったもの
    const seq = jobsLib.bonusSeqOf(cls)
    const body = { ...INITIAL_STATS }
    for (let i = 0; i < totalPointsTo(lv); i++) body[seq[i % seq.length]] += POINT_UNIT[seq[i % seq.length]]
    return Object.fromEntries(STAT_KEYS.map(k => [k, body[k] + job[k]
      + (GEAR.includes(k) ? Math.round(gear / GEAR.length) : 0)]))
  }
  // ★この版の決まり（CAP_RULES）は出撃と同じく味方・敵の両方に混ぜる（敵は出撃と同じ enemyFighter で作る）
  const fighter = (cls, stats) => ({
    ...CAP_RULES,
    name: 'me', cls, kind: attackKindOf(cls), stats, taken: null, enchants: [], evolutions: [],
    slots: slotsOf(typicalSet(cls, skillsOf(cls).map(s => s.name), stats.mp), cls),
  })
  const foeOf = (boss, m) => ({
    ...enemyFighter(boss, 8, Math.max(1, Math.round(areas.enemyPowerOf(boss) * m))), boss: true,
  })
  const winRate = (me, foe) => {
    let w = 0
    for (let i = 0; i < n; i++) if (runBattle(me, foe, { rng: rngOf(5 + i * 7919) }).winner === 'a') w++
    return w / n
  }
  // 勝率がちょうど半分になるボスの強さ（本物の何倍か）
  const m50 = (me, boss) => {
    let lo = 0.05, hi = 8
    for (let i = 0; i < 12; i++) {
      const mid = Math.sqrt(lo * hi)
      if (winRate(me, foeOf(boss, mid)) > 0.5) lo = mid
      else hi = mid
    }
    return Math.sqrt(lo * hi)
  }
  const gain = Object.fromEntries(classes.map(c => [c, Object.fromEntries(GEAR.map(k => [k, 0]))]))
  const power = Object.fromEntries(classes.map(c => [c, 0]))
  for (const area of checks) {
    const lv = areas.spotLvOf(area * 3)[1]
    const boss = areas.spotOf(area * 3).roster.boss
    const delta = Math.round(bodyPowerAt(lv) * 1.2 * 0.1)
    const ms = {}
    for (const cls of classes) {
      const st = baseStats(cls, lv)
      ms[cls] = m50(fighter(cls, st), boss)
      for (const k of GEAR) gain[cls][k] += (m50(fighter(cls, { ...st, [k]: st[k] + delta }), boss) / ms[cls] - 1) * 100 / checks.length
    }
    const avg = classes.reduce((t, c) => t + ms[c], 0) / classes.length
    for (const c of classes) power[c] += ms[c] / avg * 100 / checks.length
    console.log(`エリア${area}（LV${lv}・${boss.name}）: ` + classes.map(c => `${c} ${Math.round(ms[c] / avg * 100)}%`).join('・'))
  }
  console.log('\n同じステでの強さ（平均100%）: ' + classes.map(c => `${c} ${Math.round(power[c])}%`).join('・'))
  console.log('\n===== STAT_WEIGHT（そのまま貼る）=====\nexport const STAT_WEIGHT = {')
  for (const c of classes) {
    const mx = Math.max(...Object.values(gain[c]))
    const w = GEAR.map(k => [k, Math.max(0, Math.round(gain[c][k] / mx * 100) / 100)]).sort((a, b) => b[1] - a[1])
    console.log(`  ${(c + ':').padEnd(6, '　')} { ${w.map(([k, v]) => `${k}:${v.toFixed(2)}`).join(', ')} },`)
  }
  console.log('}')
}

if (process.argv.includes('--tune')) {
  await tune()
} else if (process.argv.includes('--report')) {
  report()
} else if (process.argv.includes('--statvalue')) {
  await statValue()
} else if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('v2cap-progress.mjs')) {
  const r = simulate()
  const pick = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 240, 270, 300, 365].filter(x => x <= HOURS)
  if (!QUIET) {
    console.log(`職業=${START} seed=${SEED}`)
    console.log('時間\tLV\t戦闘力\t(本体)\t勝率\t場所\tClassLV\tGold')
    for (const x of pick) {
      const v = r.hourly[x - 1]
      console.log(`${x}\t${v.lv}\t${v.power}\t(${v.body})\t${(v.win * 100).toFixed(0)}%\t${areas.spotLabel(v.spot)}\t${v.jlv}\t${v.gold}`)
    }
    console.log('エリアの③を倒した時間:', AREA_LIST.map((a, k) => { const v = areaClearHour(r, k); return `${a.name}${v === undefined ? '-' : Math.round(v * 10) / 10}` }).join(' '))
    console.log('ClassLV30:', r.job30Hour === null ? '-' : `${r.job30Hour.toFixed(1)}時間目`)
    const lvs = [1, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    console.log('LVごとの平均戦闘力（実測 / stdPowerAt）:', lvs.map(l => {
      const a = r.powerByLv[l]; const m = a ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '-'
      return `${l}:${m}/${stdPowerAt(l)}`
    }).join(' '))
  }
}
