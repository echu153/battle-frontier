// ============================================================
// バトルフロンティアⅡ（リメイク版）— ATB戦闘（プロトタイプ）
// ------------------------------------------------------------
// 設計の正は docs/v2-atb-design.md。ここはその実装。
//
// ★オート戦闘（battle.js の runBattle）とは**進め方だけ**が違う。
//   ダメージ・命中・クリティカル・状態異常の中身は battle.js / combat.js を
//   そのまま呼ぶ＝**計算を二重に書かない**（バランス調整の正が1か所に残る）。
//
// 進め方（オートとの違い）
//   ・ターンが無い。時間でゲージが溜まり、必要量に届いた側から行動する
//   ・スキルの発動率（proc）は使わない。代わりに**強い技ほど必要ゲージが大きい**
//   ・バフ／デバフ／状態異常は**残り秒**で消える（オートは戦闘中ずっと or ターン数）
//   ・麻痺＝ゲージが止まる／鈍足＝AGIが下がる＝溜まりが遅くなる
//
// ⚠**オート戦闘の定数は一切触らない**。ATB用の値はこのファイルだけに置く。
//   ＝出撃・アリーナ・ダンジョンのバランスには影響しない。
// ============================================================
import {
  createSide, liveStats, peekSkill, mpCostOf, takeAction, tickRegen, BUFF_MIN_PCT,
} from './battle.js'
import { STAT_KEYS } from './stats.js'
import { AIL_KEYS, AIL_LABEL, BLEED_HP_RATE, POISON_RATE, hasAilment } from './ailments.js'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
// 秒の比較に使うごく小さい余裕。実時間を足し込むと 30 が 30.000000000000004 になるため、
// 「ちょうど期限の瞬間の刻み」が消えてしまわないようにする（毒30秒＝6回、を守る）
const EPS = 1e-6

// ============================================================
// ★調整するつまみはこの節に全部ある（他は触らなくていい）
//   FILL_PER_SEC … 戦闘全体の速さ
//   AGI_EFFECT   … AGI差がどれだけ速さに響くか  ←「AGIが効きすぎる」はここを下げる
//   RATIO_MIN / RATIO_MAX … 開いてよい速さの幅（保険のフタ）
//   GUARD_*      … 防御（全職共通のコマンド）の重さ・軽減率・持続
//   NEED_PROC_K  … 強い技をどれだけ重くするか
//   BUFF_SEC_*   … バフの持続
//   AIL_SEC      … 状態異常の持続
// ============================================================

// ===== ゲージ =====
export const GAUGE_BASE   = 100  // 通常攻撃＝100（1行動ぶん）
export const GAUGE_MAX    = 260  // 溜めの上限（一番重い技より上にしておく）
export const FILL_PER_SEC = 25   // 等速なら4秒で1行動

// ★AGI差の効き（2026-08-19 追加）。**AGI比を何乗するか**で決める
//     1.0 … 比がそのまま出る（AGIが2倍なら2倍速）＝効きすぎ
//     0.5 … 平方根（2倍で1.41倍速）＝2026-08-19の昼まではこれ
//     0.35… いまの値（2倍で1.27倍速・3倍で1.47倍速）
//     0   … AGIは速さにまったく関係しなくなる
//   ★**比**で見ているので、インフレでAGIの絶対値が10倍になっても効き方は変わらない。
//     変わるのは「相手との差」だけ。将来ここだけ下げれば効きを弱められる
export const AGI_EFFECT = 0.35
// 開いてよい速さの幅。AGI_EFFECT を上げすぎた／極端な相手が出たときのフタ。
// AGI_EFFECT=0.35 なら、AGIが相手の約3.2倍で上限・約0.44倍で下限に当たる
export const RATIO_MIN = 0.75
export const RATIO_MAX = 1.5

// 溜まる速さはAGI比。AGI_EFFECT 乗してからクランプする（素の比のままだとAGI一強になる）
export const fillRatio = (myAgi, foeAgi) =>
  clamp(Math.pow(Math.max(0, myAgi) / Math.max(1, foeAgi), AGI_EFFECT), RATIO_MIN, RATIO_MAX)

// 必要ゲージ。発動率が低い技ほど重い＝**不発の代わりに待ち時間で表す**
export const NEED_PROC_K = 2
export const needOf = (skill) =>
  skill ? GAUGE_BASE + Math.max(0, 100 - (skill.proc ?? 100)) * NEED_PROC_K : GAUGE_BASE

// ===== 防御（全職共通・スキルではない）=====
// ★ATBだけの基本コマンド（2026-08-19 ユーザー決定）。スキル枠を1つも使わずに誰でも使える。
//   ゲージが軽い（通常攻撃より安い）ので「大技が来る前に挟む」動きができる＝
//   相手のゲージを見る意味がここで生まれる
export const GUARD_NEED = 60   // 必要ゲージ（通常攻撃100より軽い）
export const GUARD_CUT  = 50   // 被ダメージを何%減らすか
export const GUARD_SEC  = 6    // 効いている秒数

// ===== バフ・デバフの持続（秒） =====
// 強いバフほど短い。効果の合計%（絶対値の和）で決まる
export const BUFF_SEC_CONST = 3000
export const BUFF_SEC_MIN   = 30
export const BUFF_SEC_MAX   = 120
export const DEBUFF_SEC_MAX = 60   // デバフは攻撃技のおまけで積めるので上限を短くする
export const buffSecOf = (totalPct, isDebuff = false) =>
  Math.round(clamp(BUFF_SEC_CONST / Math.max(1, Math.abs(totalPct)),
    BUFF_SEC_MIN, isDebuff ? DEBUFF_SEC_MAX : BUFF_SEC_MAX))

// ===== 状態異常（ATB用の別表）=====
export const AIL_SEC  = { paralyze:5, healCut:15, bleed:20, poison:30, slow:30 }
export const TICK_SEC = 5      // 出血・毒・継続回復が刻む間隔
export const MAX_DT   = 0.25   // タブを裏に回したときに一気に進まないための上限（秒）
export const MAX_SEC  = 180    // これを超えたら引き分け

// ===== 1サイド =====
export const createAtbSide = (fighter, band = null) => {
  const side = createSide(fighter, band)
  side.gauge = 0
  side.baseBuffs = { ...side.buffs }  // 職業補正・パッシブ・エンチャントぶん（**消えない**）
  side.timed = []                     // [{ table, sec, until }] 時間で消えるバフ・デバフ
  side.ailUntil = {}                  // 状態異常の期限（秒）
  side.tickAt = TICK_SEC              // 次に出血・毒・継続回復を刻む時刻
  side.pending = undefined            // 予約（{ idx } ／ idx=null は通常攻撃）
  side.def = { idx: null }            // デフォルト行動（予約が無いときに出る）
  side.guardCut = 0                   // 防御中の軽減率（battle.js の applyIncoming が見る）
  side.guardUntil = 0                 // 防御が切れる時刻
  side.auto = false                   // オート（枠の順に自動で撃つ＝オート戦闘と同じ選び方）
  return side
}

export const createAtb = (fighterA, fighterB, { rng = Math.random, band = null, maxSec = MAX_SEC } = {}) => {
  const st = {
    rng, band, maxSec, t: 0, over: false, winner: null, log: [],
    a: createAtbSide(fighterA, band),
    b: createAtbSide(fighterB, band),
  }
  st.b.auto = true   // 相手（敵）は常にオート
  return st
}

// ===== バフの持ち方 =====
// baseBuffs（消えないぶん）＋ 生きている timed を足し直す
const recomputeBuffs = (side) => {
  const b = { ...side.baseBuffs }
  for (const e of side.timed) {
    for (const [k, v] of Object.entries(e.table)) b[k] = Math.max(BUFF_MIN_PCT, (b[k] || 0) + v)
  }
  side.buffs = b
}

// 行動の前後で side.buffs の差分を取り、増えたぶんに「残り秒」を付ける。
// ★battle.js のバフ処理には手を入れない（差分で拾う）ので、オート戦闘は無傷のまま
const commitBuff = (side, before, isDebuff, now) => {
  const table = {}
  let total = 0
  for (const k of STAT_KEYS) {
    const d = (side.buffs[k] || 0) - (before[k] || 0)
    if (d) { table[k] = d; total += Math.abs(d) }
  }
  if (!total) return
  const sec = buffSecOf(total, isDebuff)
  side.timed.push({ table, sec, until: now + sec })
  recomputeBuffs(side)
}

// 状態異常は「入れ直されたか」を**オブジェクトの入れ替わり**で見る。
// （ailments.js の inflict は入るときだけ新しい物を作る＝毒の重ねがけ拒否も正しく拾える）
const commitAil = (side, before, now) => {
  for (const k of AIL_KEYS) {
    const cur = side.ail[k]
    if (cur && cur !== before[k]) side.ailUntil[k] = now + (AIL_SEC[k] ?? 20)
  }
}

// 期限切れを落とす
const expire = (side, now) => {
  if (side.timed.length) {
    const n = side.timed.length
    side.timed = side.timed.filter(e => e.until + EPS >= now)
    if (side.timed.length !== n) recomputeBuffs(side)
  }
  for (const k of AIL_KEYS) {
    if (side.ail[k] && (side.ailUntil[k] ?? 0) + EPS < now) { delete side.ail[k]; delete side.ailUntil[k] }
  }
  if (side.guardCut && side.guardUntil + EPS < now) { side.guardCut = 0; side.guardUntil = 0 }
}

// 出血・毒・継続回復（TICK_SEC ごと）。★割合ダメージなのでVITでは軽減されない（オートと同じ）
const tickDot = (side, log) => {
  const a = side.ail
  if (a.poison) {
    const d = Math.max(1, Math.floor(side.base.hp * (a.poison.rate ?? POISON_RATE)))
    side.hp -= d
    log.push({ side: side.name, type: 'ailTick', ail: AIL_LABEL.poison, damage: d })
  }
  if (side.hp > 0 && a.bleed?.stacks > 0) {
    const d = Math.max(1, Math.floor(side.hp * BLEED_HP_RATE * a.bleed.stacks))
    side.hp -= d
    log.push({ side: side.name, type: 'ailTick', ail: AIL_LABEL.bleed, damage: d, stacks: a.bleed.stacks })
  }
  if (side.hp > 0) tickRegen(side, log)
}

// ===== 行動の選び方 =====
// その枠がいま撃てるか（使用回数とMP）
export const canUse = (side, idx) => {
  const s = side.slots[idx]
  if (!s?.skill || s.uses <= 0) return false
  if (s.skill.mpPct) return side.mp > 0
  return mpCostOf(side, s.skill) <= side.mp
}

// いま出る行動。予約 → デフォルト行動 → （撃てないなら）通常攻撃、の順で落ちる
export const chosenOf = (side) => {
  if (side.auto) return { auto: true, skill: peekSkill(side) }
  const pick = side.pending !== undefined ? side.pending : side.def
  if (pick?.guard) return { guard: true, skill: null }
  const idx = pick?.idx
  if (idx === null || idx === undefined) return { idx: null, skill: null }
  if (!canUse(side, idx)) return { idx: null, skill: null }
  return { idx, skill: side.slots[idx].skill }
}

// いま必要なゲージ量
export const needNow = (side) => {
  const ch = chosenOf(side)
  return ch.guard ? GUARD_NEED : needOf(ch.skill)
}
// 溜まりぶんの余り（0以上なら撃てる）
const excess = (side) => side.gauge - needNow(side)

const finish = (st) => {
  if (st.a.hp > 0 && st.b.hp > 0) return false
  st.over = true
  st.winner = st.a.hp <= 0 && st.b.hp <= 0 ? 'draw' : st.a.hp <= 0 ? 'b' : 'a'
  return true
}

// 1回の行動を解決する
const act = (st, me, foe) => {
  const ch = chosenOf(me)
  // 防御：スキルではないので takeAction を通さない。掛け直すと時間が延びる（重ならない）
  if (ch.guard) {
    me.guardCut = GUARD_CUT
    me.guardUntil = st.t + GUARD_SEC
    me.gauge = Math.max(0, me.gauge - GUARD_NEED)
    me.pending = undefined
    st.log.push({ side: me.name, type: 'guard', sec: GUARD_SEC, cut: GUARD_CUT })
    return
  }
  const need = needOf(ch.skill)
  const beforeMe = { ...me.buffs }
  const beforeFoe = { ...foe.buffs }
  const ailMe = { ...me.ail }
  const ailFoe = { ...foe.ail }
  const opt = { noProc: true, noParalyze: true }
  if (!ch.auto) opt.idx = ch.idx
  takeAction(me, foe, st.rng, st.log, opt)
  commitBuff(me, beforeMe, false, st.t)
  commitBuff(foe, beforeFoe, true, st.t)
  commitAil(me, ailMe, st.t)
  commitAil(foe, ailFoe, st.t)
  me.gauge = Math.max(0, me.gauge - need)
  me.pending = undefined   // 予約は1回で消える（次はデフォルト行動が出る）
}

// ===== 時間を進める =====
// dtSec は実時間の差分。★上限 MAX_DT でクランプする（裏タブから戻ったときに一気に進めない）
export const step = (st, dtSec) => {
  if (st.over) return st
  const dt = Math.min(Math.max(0, dtSec || 0), MAX_DT)
  st.t += dt

  expire(st.a, st.t)
  expire(st.b, st.t)

  const eA = liveStats(st.a)
  const eB = liveStats(st.b)
  for (const [me, eMe, eFoe] of [[st.a, eA, eB], [st.b, eB, eA]]) {
    // 麻痺のあいだはゲージが止まる
    if (!hasAilment(me.ail, 'paralyze')) {
      me.gauge = Math.min(GAUGE_MAX, me.gauge + FILL_PER_SEC * fillRatio(eMe.agi, eFoe.agi) * dt)
    }
    while (me.tickAt <= st.t) { tickDot(me, st.log); me.tickAt += TICK_SEC }
  }
  if (finish(st)) return st

  // 溜まっている側から順に動く（余りが大きいほうが先）
  for (let guard = 0; guard < 8; guard++) {
    const ea = excess(st.a)
    const eb = excess(st.b)
    if (ea < 0 && eb < 0) break
    if (ea >= eb) act(st, st.a, st.b)
    else act(st, st.b, st.a)
    if (finish(st)) return st
  }

  if (st.t >= st.maxSec) { st.over = true; st.winner = 'draw' }
  return st
}

// ===== 画面用のまとめ =====
// バフ・デバフの表示（残り秒つき）。table は { ステ: % }
export const buffChips = (side, now) => side.timed
  .map(e => ({ table: e.table, sec: Math.max(0, Math.ceil(e.until - now)), pct: (e.until - now) / e.sec }))
  .filter(c => c.sec > 0)
// 防御の残り秒（0＝防御していない）
export const guardLeft = (side, now) => (side.guardCut ? Math.max(0, Math.ceil(side.guardUntil - now)) : 0)
// 状態異常の表示（残り秒つき）
export const ailChips = (side, now) => AIL_KEYS
  .filter(k => side.ail[k])
  .map(k => ({
    key: k, label: AIL_LABEL[k],
    sec: Math.max(0, Math.ceil((side.ailUntil[k] ?? now) - now)),
    stacks: k === 'bleed' ? side.ail.bleed.stacks : 0,
  }))
