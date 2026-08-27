// ============================================================
// バトルフロンティアⅡ（リメイク版）— 自動成長NPC（アリーナの住人）
// ------------------------------------------------------------
// 人が少なくてもアリーナが成り立つように、**勝手に強くなって勝手に挑戦してくる**
// 疑似プレイヤーを100体置く（2026-08-27 ユーザー指示）。
//
// ===== 4つの決めごと（2026-08-27 ユーザー決定）=====
//   ① 動かす場所 … Edge Function（v2-npc-tick）＋ pg_cron。
//      **誰も遊んでいない時間帯でも育ち、アリーナにも挑戦してくる**。
//      アリーナの勝敗は本物の runBattle が決める（スキルも状態異常もそのまま効く）。
//   ② 成長のやり方 … **数字で育てる**。1体ずつ出撃の戦闘を回すことはしない。
//      「1時間あたり何EXP稼ぐか（speed）」だけを持ち、LV・転職・装備の強さは
//      そこから**計算で**出す。100体でも軽く、成長速度を狙った通りに置ける。
//   ③ 強さの上限 … アリーナ最上階の目安（powerOfFloor(50) ≒ 29,700）で頭打ち。
//      ⚠「一旦これで、後で調整する」との回答。**直すのは POWER_CAP の1行だけ**。
//   ④ 見え方 … NPCだと分かるようにする（スナップショットに npc:true を入れ、画面で印を出す）。
//
// ===== 成長がなぜ計算で出せるのか =====
// v2の成長は「LVアップ1回＝5回抽選」「転職1回＝転職回数×100戦闘力を配り直し」で、
// **どのステに当たっても戦闘力の増えぶんは同じ**（stats.js の unit がその換算）。
//   ＝ 戦闘力は乱数によらず  39 ＋ 転職回数×100 ＋ (LV-1)×5  で確定する。
// 乱数で変わるのは**8種への散らばり方だけ**なので、seed を決めておけば
// 通算EXPから今の姿を毎回同じように作り直せる（＝ステをDBに持たなくてよい）。
//
// ★このファイルが正。Edge Function は supabase/functions/v2-npc-tick/_lib/ へ
//   コピーしたものを読む（tools/v2-npc-fn-sync.mjs が同期し、npc.fn.test.js が見張る）。
// ============================================================
import {
  STAT_KEYS, STAT_DEFS, INITIAL_STATS, MAX_LV, ROLLS_PER_LV,
  JOB_CHANGE_POWER, expPerLv, calcPower,
} from './stats.js'
import { CLASS_BONUS } from './classBonus.js'
import { skillsOf, SKILL_SET_SLOTS, SKILL_USE_MAX, mpOf } from './skills.js'
import { FLOORS, powerOfFloor } from './arena.js'

export const NPC_COUNT = 100

// ===== 成長速度（1時間あたりに稼ぐEXP）=====
// 目安：**手で出撃を回し続けているプレイヤーは 3,420 EXP/時**
//   （出撃のクールタイム10秒＝1時間360回 × 1回およそ9.5EXP）。
//   SPEED_MAX 600 ＝ その 1/5.7 ＝「毎日4〜5時間くらい遊ぶ人」のつもり。
//   SPEED_MIN 15  ＝ 「たまに思い出したように少し遊ぶ人」。差は40倍。
// ★速度は log で等分するので、遅い側に厚く・速い側は少数になる
export const SPEED_MIN = 15
export const SPEED_MAX = 600
export const speedOf = (i) => {
  const t = NPC_COUNT <= 1 ? 0 : i / (NPC_COUNT - 1)
  return Math.round(SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, t))
}

// ===== 強さの上限（③）=====
// アリーナ最上階の目安まで。ここに届いたらEXPが入らなくなる（＝それ以上強くならない）
export const POWER_CAP = powerOfFloor(FLOORS)

// ===== 装備の強さ =====
// 「装備を拾って強化していく」ぶんを、**素の戦闘力に対する割合**で表す。
// 転職を重ねるほど良い装備がそろい、強化値も伸びる、という置き方。
//   ・GEAR_RATIO_BASE … 始めたてが持っている装備（素の25%ぶん）
//   ・GEAR_RATIO_STEP … 転職1回ごとに増える割合
//   ・GEAR_RATIO_MAX  … 強化の頭打ち
// ★実物の装備は持たせない（持ち物・取引所・図鑑には出てこない）。数字だけ。
export const GEAR_RATIO_BASE = 0.25
export const GEAR_RATIO_STEP = 0.005
export const GEAR_RATIO_MAX = 1.2
export const gearRatioOf = (jobs) =>
  Math.min(GEAR_RATIO_MAX, GEAR_RATIO_BASE + Math.max(0, jobs) * GEAR_RATIO_STEP)

// ===== 乱数（seedを決めれば毎回同じ姿になる）=====
export const mulberry32 = (seed) => {
  let a = (seed >>> 0) || 1
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ===== 通算EXP → いまのLV・転職回数 =====
// LV1→LV100 で 99回ぶんのEXPが要る。そこまで行ったら転職してLV1へ戻る（NPCは必ず即転職する）
export const cycleExpOf = (jobs) => (MAX_LV - 1) * expPerLv(jobs)
export const progressOf = (totalExp) => {
  let rest = Math.max(0, Math.floor(totalExp || 0))
  let jobs = 0
  // 転職を重ねるほど1LVが重くなる（expPerLv）ので、1周ずつ引いていく
  for (;;) {
    const cycle = cycleExpOf(jobs)
    if (rest < cycle) break
    rest -= cycle
    jobs += 1
    if (jobs > 100000) break   // 念のための止め（現実には届かない）
  }
  const per = expPerLv(jobs)
  return { jobs, lv: 1 + Math.floor(rest / per), exp: rest % per }
}
// 逆引き：その姿になるまでに要る通算EXP
export const expForProgress = (jobs, lv = 1) => {
  let sum = 0
  for (let j = 0; j < jobs; j++) sum += cycleExpOf(j)
  return sum + Math.max(0, lv - 1) * expPerLv(jobs)
}

// ===== 戦闘力 =====
// 素の戦闘力（乱数によらず確定する）
export const basePowerOf = (jobs, lv) =>
  calcPower(INITIAL_STATS) + Math.max(0, jobs) * JOB_CHANGE_POWER + Math.max(0, lv - 1) * ROLLS_PER_LV
// 装備こみの戦闘力
export const powerOfExp = (totalExp) => {
  const { jobs, lv } = progressOf(totalExp)
  const base = basePowerOf(jobs, lv)
  return Math.min(POWER_CAP, base + Math.round(base * gearRatioOf(jobs)))
}
// 上限に届く通算EXP（ここでEXPの加算を止める）
export const EXP_CAP = (() => {
  let lo = 0, hi = 1
  while (powerOfExp(hi) < POWER_CAP) hi *= 2
  while (lo + 1 < hi) { const mid = Math.floor((lo + hi) / 2); if (powerOfExp(mid) < POWER_CAP) lo = mid; else hi = mid }
  return hi
})()
// その戦闘力に届くのに要る通算EXP（seedを作るときに使う）
export const expForPower = (power) => {
  const target = Math.min(POWER_CAP, Math.max(1, Math.round(power)))
  let lo = 0, hi = EXP_CAP
  while (lo + 1 < hi) { const mid = Math.floor((lo + hi) / 2); if (powerOfExp(mid) < target) lo = mid; else hi = mid }
  return hi
}

// ===== 職業 =====
// 上位職20職を順に配る（100体＝1職につき5体）。NPCは**ずっと同じ職業**に転職し続けるので、
// 職業補正（転職回数で伸びるぶん）もそのまま効く＝職業ごとの色が出る
export const NPC_CLASSES = Object.keys(CLASS_BONUS)
export const classOfIndex = (i) => NPC_CLASSES[i % NPC_CLASSES.length]

// ===== ステータス =====
// 抽選1回で当たったステを unit だけ上げる（stats.js の rollAllocate と同じ）
const allocate = (points, rng, into) => {
  for (let i = 0; i < points; i++) {
    const k = STAT_KEYS[Math.floor(rng() * STAT_KEYS.length)]
    into[k] += STAT_DEFS[k].unit
  }
  return into
}
// 装備ぶんの配り方。職業のメイン／サブへ厚くする（プレイヤーが自分で選ぶ形に近づける）
export const gearDistOf = (cls) => {
  const b = CLASS_BONUS[cls] || {}
  const dist = { hp: 26, mp: 8, str: 8, dex: 8, agi: 8, int_stat: 8, vit: 8, luk: 8 }
  if (b.main) dist[b.main] += 12
  if (b.sub) dist[b.sub] += 6
  return dist
}
// seed と通算EXP から、いまの8ステを作る
export const statsOfNpc = ({ seed = 1, cls = 'ノーブル', total_exp = 0 } = {}) => {
  const { jobs, lv } = progressOf(total_exp)
  // 転職のたびにステは初期値へ戻して配り直すので、抽選も転職回数ごとに引き直す
  const rng = mulberry32((seed >>> 0) + jobs * 7919)
  const stats = {}
  for (const k of STAT_KEYS) stats[k] = INITIAL_STATS[k]
  allocate(jobs * JOB_CHANGE_POWER, rng, stats)   // 転職ぶん
  allocate((lv - 1) * ROLLS_PER_LV, rng, stats)   // いまのLVぶん
  // 装備ぶん
  const base = basePowerOf(jobs, lv)
  const gearPower = Math.min(Math.max(0, POWER_CAP - base), Math.round(base * gearRatioOf(jobs)))
  const dist = gearDistOf(cls)
  const total = Object.values(dist).reduce((a, c) => a + c, 0)
  for (const k of STAT_KEYS) stats[k] += Math.round(gearPower * (dist[k] / total) * STAT_DEFS[k].unit)
  return stats
}

// ===== スキル編成 =====
// 自分の職業のスキルから5枠。使用回数は**想定利用MPが最大MPを超えない**ように詰める
//   （プレイヤーと同じ規則。skills.js の validateSkillSet / SQLの v2_set_skills と同じ考え方）
export const slotsOfNpc = (npc = {}, stats = null) => {
  const { seed = 1, cls = 'ノーブル' } = npc
  const list = skillsOf(cls)
  if (!list.length) return []
  const rng = mulberry32((seed >>> 0) + 104729)
  // 並び順は職業のスキル表のまま（条件を作る技→使う技 の並びを崩さない）。
  // どの技を採るかだけ seed で変える＝同じ職業でも中身が少し違う
  const picked = [...list]
  while (picked.length > SKILL_SET_SLOTS) picked.splice(Math.floor(rng() * picked.length), 1)
  const s = stats || statsOfNpc(npc)
  const maxMp = Math.max(0, s.mp || 0)
  // ★割合消費（マナボルト等）は想定利用MPに数えない（skills.js の setMpCost と同じ規則）
  const costOf = (sk) => (sk?.mpPct ? 0 : Math.max(0, mpOf(cls, sk)))
  const slots = picked.map(skill => ({ skill, uses: 1 }))
  // MPが足りないうちは、いちばん重い技から降ろす。
  // ★プレイヤーも同じ縛りを受ける（想定利用MPが最大MPを超える編成は保存できない）。
  //   始めたてのNPCは技を1〜2個しか積めない＝ここを緩めると序盤のNPCだけ不当に強くなる
  const costAll = () => slots.reduce((t, e) => t + costOf(e.skill) * e.uses, 0)
  while (slots.length > 0 && costAll() > maxMp) {
    let worst = 0
    for (let i = 1; i < slots.length; i++) if (costOf(slots[i].skill) > costOf(slots[worst].skill)) worst = i
    slots.splice(worst, 1)
  }
  // 1つも積めなかったときは、その職業でいちばん軽い技を1つだけ試す（それも無理なら通常攻撃だけ）
  if (!slots.length) {
    const cheapest = list.reduce((a, b) => (costOf(b) < costOf(a) ? b : a))
    if (costOf(cheapest) <= maxMp) slots.push({ skill: cheapest, uses: 1 })
    else return []
  }
  // 残ったMPの許すかぎり使用回数を増やす
  let used = costAll()
  for (let guard = 0; guard < 5000; guard++) {
    let moved = false
    for (const e of slots) {
      const c = costOf(e.skill)
      if (e.uses >= SKILL_USE_MAX) continue
      if (used + c > maxMp) continue
      e.uses += 1; used += c; moved = true
    }
    if (!moved) break
  }
  return slots
}

// ===== runBattle に渡せる形 =====
export const fighterOf = (npc) => {
  const stats = statsOfNpc(npc)
  const { jobs } = progressOf(npc.total_exp)
  return {
    npc: true,
    name: npc.name,
    cls: npc.cls,
    // 職業補正は「その職業に何回転職したか」で伸びる。NPCはずっと同じ職業なので転職回数がそのまま入る
    jobCount: jobs,
    stats,
    enchants: [],          // ルーン（エッセンス）は持たせない
    slots: slotsOfNpc(npc, stats),
  }
}
// 階層守護者としてDBに置く姿（arena.js の snapshotOf と同じ形＋NPCの印）
export const snapshotOfNpc = (npc) => {
  const f = fighterOf(npc)
  return {
    npc: true,             // ★これが画面の「（NPC）」表示の元（④）
    npc_id: npc.id,
    name: f.name,
    cls: f.cls,
    jobCount: f.jobCount,
    stats: { ...f.stats },
    enchants: [],
    slots: f.slots.map(s => ({ name: s.skill?.name, uses: s.uses })),
  }
}

// ===== 成長（1ティックぶん）=====
// 経過時間 × speed だけEXPを足す。上限に届いたら止まる（③）
export const grownExp = (npc, hours) => {
  const gain = Math.max(0, Math.floor((npc.speed || 0) * Math.max(0, hours)))
  return Math.min(EXP_CAP, Math.max(0, Math.floor(npc.total_exp || 0)) + gain)
}

// ===== アリーナでの動き =====
// 挑戦の間隔。よく遊ぶ（speedが速い）ほど短い。20分〜240分
export const ARENA_MIN_MINUTES = 20
export const ARENA_MAX_MINUTES = 240
export const arenaIntervalOf = (speed) => {
  const t = Math.min(1, Math.max(0, Math.log(Math.max(SPEED_MIN, speed) / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN)))
  return Math.round(ARENA_MAX_MINUTES * Math.pow(ARENA_MIN_MINUTES / ARENA_MAX_MINUTES, t))
}
// 実際に待つ分数（±30%ばらつかせて、全員が同じ時刻に動かないようにする）
export const arenaDelayOf = (speed, rng = Math.random) =>
  Math.max(1, Math.round(arenaIntervalOf(speed) * (0.7 + rng() * 0.6)))

// 席を降りるか（プレイヤーの「席を降りる」と同じ扱い＝次は1つ上の階へ）
//   ・その階には強すぎる（RETIRE_MARGIN 階ぶん上の目安に届いている）
//   ・守りすぎている（RETIRE_STREAK 連勝）＝席が回らなくなるので自分から空ける
// ★最上階は降りない（上が無い）
export const RETIRE_MARGIN = 2
export const RETIRE_STREAK = 5
export const shouldRetire = (power, floor, streak = 0) => {
  if (floor >= FLOORS) return false
  if (streak >= RETIRE_STREAK) return true
  return power >= powerOfFloor(Math.min(FLOORS, floor + RETIRE_MARGIN))
}

// ===== 名前 =====
// 100体ぶん。プレイヤーと並んでも浮かないように、いかにもNPCな肩書きは付けない
//   （NPCだと分かるようにするのは名前ではなく画面の印でやる＝④）
export const NPC_NAMES = [
  'レイン', 'クロト', 'ミリア', 'ザッシュ', 'ノエル', 'ガーランド', 'ティナ', 'ヴォルフ', 'セシル', 'ハルカ',
  'ドレイク', 'ユウナ', 'バルド', 'シオン', 'ルクレツィア', 'ゲンゴロウ', 'アイリ', 'ザイオン', 'マキナ', 'トール',
  'フィリア', 'クレイグ', 'ヨミ', 'アストラ', 'ベネット', 'リリカ', 'ダグラス', 'ソラ', 'ヴィヴィ', 'ケンシン',
  'ミハエル', 'ナギ', 'オルガ', 'セイラ', 'ブラッド', 'ツキヨ', 'ランドルフ', 'エリカ', 'ジン', 'カレン',
  'ゼファー', 'ムツキ', 'アルヴィン', 'ノノ', 'グレイ', 'ヒビキ', 'マルコ', 'スズナ', 'テオドール', 'リョウ',
  'シャル', 'カナタ', 'ウルリカ', 'ハヤテ', 'モルガン', 'アカネ', 'ジークベルト', 'コハク', 'ヴァレリア', 'ソウマ',
  'ネロ', 'ミツキ', 'ロラン', 'イズミ', 'ファウスト', 'ナオ', 'クラウディア', 'タクマ', 'ベルナデット', 'レン',
  'ギルバート', 'サヤ', 'オズワルド', 'ユキ', 'マチルダ', 'ハジメ', 'セラフィナ', 'リク', 'コンラート', 'アヤメ',
  'ヴェルナー', 'シズク', 'エミリオ', 'カグヤ', 'ロベルト', 'ツバサ', 'イザベラ', 'ミナト', 'アンセルム', 'ホタル',
  'デュラン', 'サクヤ', 'グスタフ', 'トワ', 'ルシアン', 'ナズナ', 'ヴィクトル', 'アオイ', 'エルネスト', 'シグレ',
]
export const nameOf = (i) => NPC_NAMES[i] || `NPC${i + 1}`

// ===== 開発中に動かすぶん（2026-08-27 ユーザー指示）=====
// **一般公開までは、この6体だけを動かす**。残り94体もDBには入れておくが active=false で
// 眠らせ、公開と同時に supabase_v2_npc_deploy_all.sql で一斉に起こす。
//   ・最初から100体で動かすと、開発中のアリーナが完成品と同じ密度になってしまい
//     「人が少ないときにどう見えるか」を確かめられない
//   ・**1階・2階・6階**に絞る＝開発キャラが実際に当たれる場所に置く
//   ・各階に「ゆっくり守る側」と「速い挑む側」を1体ずつ入れてある。
//     ＝席の奪い合いと、強くなりすぎて席を降りて上へ行く動きが、開発中に必ず見られる
// ★眠っている94体は成長しない（ティックが素通りする）。
//   起こすときに last_tick_at を now() に直すので、**眠っていた期間ぶんの
//   成長がまとめて入ることもない**（deploy のSQLがやっている）。
export const DEV_ACTIVE_IDS = [1, 51, 2, 52, 6, 56]
export const isDevActive = (id) => DEV_ACTIVE_IDS.includes(id)

// ===== 100体ぶんの初期データ =====
// **作った瞬間からアリーナが埋まっている**ようにする。i 番目のNPCは
//   ・職業      … 上位職20職を順に（1職5体）
//   ・成長速度  … log で等分（遅い人が多く、速い人は少数）
//   ・いまの強さ … 1〜50階の目安に散らす（＝1階から最上階まで住人がいる）
//   ・始めた日  … その強さになるまでに速度ぶんの時間がかかった、として逆算する
// ★添字が同じなら毎回まったく同じ100体になる（seed も添字から作る）
export const seedListOf = (count = NPC_COUNT) =>
  Array.from({ length: count }, (_, i) => {
    const seed = 1000003 + i * 7919
    const rng = mulberry32(seed)
    const cls = classOfIndex(i)
    const speed = speedOf(i)
    const floor = (i % FLOORS) + 1
    // 目安の戦闘力を±10%ばらつかせる（同じ階に2体いても同じ強さにならない）
    const power = Math.round(powerOfFloor(floor) * (0.9 + rng() * 0.2))
    const totalExp = expForPower(power)
    const hours = totalExp / Math.max(1, speed)
    return {
      idx: i,
      name: nameOf(i),
      cls,
      seed,
      speed,
      total_exp: totalExp,
      arena_floor: floor,
      born_hours_ago: Math.round(hours),
      // ★前半50体を最初から階層守護者として座らせる（1階〜50階へちょうど1体ずつ）。
      //   後半50体は挑戦する側で始める。
      //   ⚠「偶数番を座らせる」にすると i と i+50 が同じ階・同じ偶奇になり、
      //     50体が2体ずつ同じ階に重なって**半分が黙って席に着けない**（席は1階に1つ）。
      defending: i < FLOORS,
      power: powerOfExp(totalExp),
    }
  })
