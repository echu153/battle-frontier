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
//
// ★ターンが無いせいで、そのままでは効かない効果がある。**読み替えてここで効かせる**
//   （2026-08-21 に総当たりで洗い出した。オートだけ効いて ATB で死ぬのを防ぐ）
//     発動率+%   → 必要ゲージが軽くなる（不発が無いので「撃ちやすさ」に読み替える）
//     追加行動+% → ゲージの溜まりが速くなる（「回数が増える」の言い換え）
//     先手+%     → 開始ゲージを持って始める（「先に動く」の言い換え）
//   ⚠**不発したときの通常攻撃の威力**（居合の構え／居合の心得）だけは読み替え先が無い。
//     ATBには不発そのものが存在しないので、対象外のまま（テストで明示している）。
//   ・バフ／デバフ／状態異常は**残り秒**で消える（オートは戦闘中ずっと or ターン数）
//   ・麻痺＝ゲージが止まる／鈍足＝AGIが下がる＝溜まりが遅くなる
//
// ⚠**オート戦闘の定数は一切触らない**。ATB用の値はこのファイルだけに置く。
//   ＝出撃・アリーナ・ダンジョンのバランスには影響しない。
// ============================================================
import {
  createSide, liveStats, peekSkill, mpCostOf, priorityOf, takeAction, tickRegen, BUFF_MIN_PCT,
  tickBleedAfterAct, BEAST_FORMS,
} from './battle.js'
import { STAT_KEYS } from './stats.js'
import { AIL_KEYS, AIL_LABEL, poisonTickOf, hasAilment, SILENCE_PROC } from './ailments.js'

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
// procBonus … パッシブ・エンチャント・武器の進化の「発動率+%」。撃ちやすさ＝軽さに読み替える
export const needOf = (skill, procBonus = 0) =>
  skill ? GAUGE_BASE + Math.max(0, 100 - (skill.proc ?? 100) - procBonus) * NEED_PROC_K : GAUGE_BASE
// そのサイドが持っている発動率+%の合計（オート戦闘の takeAction と同じ足し方）
export const procBonusOf = (side) =>
  (side?.pa?.procBonus || 0) + (side?.en?.procBonus || 0) + (side?.evo?.proc || 0)

// ★「先制」はATBだと行動順が無いので意味を持たない（2026-08-19 ユーザー決定）。
//   代わりに**必要ゲージが軽くなる**＝早く撃てる、へ読み替える。
//   priority 1 につき PRIORITY_CUT%（納刀ぶんの先制もここに乗る）
export const PRIORITY_CUT = 20
// ★サイレンス：オート戦闘では発動率-20%。ATBは不発が無いので**必要ゲージ**へ読み替える
//   （needOf は「発動率が低いほど重い」形なので、発動率を下げるのと同じ式に通せばよい）
export const needFor = (side, skill) => {
  const cut = Math.min(60, PRIORITY_CUT * Math.max(0, priorityOf(side, skill)))
  return Math.max(20, Math.round(needOf(skill, procBonusOf(side) - (hasAilment(side.ail, 'silence') ? SILENCE_PROC : 0)) * (1 - cut / 100)))
}

// ===== 防御（全職共通・スキルではない）=====
// ★ATBだけの基本コマンド（2026-08-19 ユーザー決定）。スキル枠を1つも使わずに誰でも使える。
//   ゲージが軽い（通常攻撃より安い）ので「大技が来る前に挟む」動きができる＝
//   相手のゲージを見る意味がここで生まれる
// ★大防御（聖騎士）はオート戦闘だと「1ターンで切れる」。ATBにはターンが無いので
//   1ターンぶん＝TICK_SEC で切る。**ここを入れ忘れると戦闘の終わりまでかかりっぱなしになる**
export const BIG_GUARD_SEC = 5

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
export const AIL_SEC  = { paralyze:5, healCut:15, bleed:20, poison:30, slow:30, silence:20 }
export const TICK_SEC = 5      // 出血・毒・継続回復が刻む間隔
export const MAX_DT   = 0.25   // タブを裏に回したときに一気に進まないための上限（秒）
export const MAX_SEC  = 180    // これを超えたら引き分け

// ★ターン数で管理する状態（見切り・狂乱・期限つきバフ）をATBでは秒へ読み替える。
//   §2の決めごとどおり **1ターン＝TICK_SEC（5秒）**。
//   これが無いとATBでは一生切れない（オート戦闘の turn ループが無いため）
export const turnsToSec = (turns) => turns * TICK_SEC

// ===== 1サイド =====
export const createAtbSide = (fighter, band = null) => {
  const side = createSide(fighter, band)
  // 武器の進化「◯%で先手を取る」は、ATBでは**開始ゲージの貯金**に読み替える
  //   （ターンが無いので「先に動く」を確率ではなく出だしの速さで表す）
  side.gauge = Math.min(GAUGE_MAX, GAUGE_BASE * (side.evo?.first || 0) / 100)
  side.baseBuffs = { ...side.buffs }  // 職業補正・パッシブ・エンチャントぶん（**消えない**）
  side.timed = []                     // [{ table, sec, until }] 時間で消えるバフ・デバフ
  side.ailUntil = {}                  // 状態異常の期限（秒）
  side.tickAt = TICK_SEC              // 次に出血・毒・継続回復を刻む時刻
  side.pending = undefined            // 予約（{ idx } ／ idx=null は通常攻撃）
  side.def = { idx: null }            // デフォルト行動（予約が無いときに出る）
  side.guardCut = 0                   // 防御中の軽減率（battle.js の applyIncoming が見る）
  side.guardUntil = 0                 // 防御が切れる時刻
  side.stateUntil = {}                // 見切り・狂乱・期限つきバフが切れる時刻（秒）
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
  // ★2026-08-23：ATBでは**同じステのバフは重ならない**（ユーザー指定）。
  //   時間で切れる仕組みがある以上、重ねられると「最初の1分はひたすらバフ」が最適解になり、
  //   実測で180秒のうちにステが×6〜×8まで伸びていた。
  //   掛け直したときは「値は大きいほう・残り時間はリセット」＝切れたら入れ直す運用にする。
  //   ★プラスとマイナスは別枠（自分のバフが相手のデバフを打ち消す形にはしない）
  for (const [k, v] of Object.entries(table)) {
    for (const e of side.timed) {
      const cur = e.table[k]
      if (cur === undefined || Math.sign(cur) !== Math.sign(v)) continue
      if (Math.abs(cur) > Math.abs(v)) table[k] = cur   // 強いほうが残る
      delete e.table[k]
    }
  }
  side.timed = side.timed.filter(e => Object.keys(e.table).length > 0)
  const merged = Object.values(table).reduce((t, v) => t + Math.abs(v), 0)
  const sec = buffSecOf(merged, isDebuff)
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

// ターンで数える状態に、秒の期限を持たせる（始まった／掛け直した瞬間に決める）
const commitStates = (side, now) => {
  if (side.foresight && !side.stateUntil.foresight) side.stateUntil.foresight = now + turnsToSec(side.foresight.turns)
  if (side.frenzy && !side.stateUntil.frenzy) side.stateUntil.frenzy = now + turnsToSec(side.frenzy.turns)
  if (side.bigGuard && !side.stateUntil.bigGuard) side.stateUntil.bigGuard = now + BIG_GUARD_SEC
  for (const t of side.timedBuffs || []) {
    if (!t.until) t.until = now + turnsToSec(t.turns)
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
  // 見切り・狂乱・期限つきバフ（オート戦闘のターン数を秒に読み替えたもの）
  for (const k of ['foresight', 'frenzy']) {
    if (side[k] && (side.stateUntil[k] ?? 0) + EPS < now) { side[k] = null; delete side.stateUntil[k] }
  }
  // 大防御は数字なので null ではなく 0 へ戻す
  if (side.bigGuard && (side.stateUntil.bigGuard ?? 0) + EPS < now) { side.bigGuard = 0; delete side.stateUntil.bigGuard }
  if (side.timedBuffs?.length) {
    side.timedBuffs = side.timedBuffs.filter(t => !t.until || t.until + EPS >= now)
  }
}

// 出血・毒・継続回復（TICK_SEC ごと）。★割合ダメージなのでVITでは軽減されない（オートと同じ）
const tickDot = (side, log, foe = null) => {
  const a = side.ail
  // ★倍率は**入れた側**の武器の進化を見る（オート戦闘の tickAil と同じ）
  const boost = 1 + (foe?.evo?.ail?.dmg || 0) / 100
  if (a.poison) {
    const d = Math.max(1, Math.floor(poisonTickOf(a.poison, side.base.hp) * boost))
    side.hp -= d
    log.push({ side: side.name, type: 'ailTick', ail: AIL_LABEL.poison, damage: d })
  }
  if (side.hp > 0) tickRegen(side, log, foe)
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
  return ch.guard ? GUARD_NEED : needFor(side, ch.skill)
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
    tickBleedAfterAct(me, st.log, foe)   // ★防御も行動なので、そのあと出血が刻む
    return
  }
  // ★納刀は撃った瞬間に消えるので、消費するゲージは「撃つ前」の値で決める
  const need = needFor(me, ch.skill)
  const beforeMe = { ...me.buffs }
  const beforeFoe = { ...foe.buffs }
  const ailMe = { ...me.ail }
  const ailFoe = { ...foe.ail }
  const opt = { noProc: true, noParalyze: true, bigGuardSec: BIG_GUARD_SEC }
  if (!ch.auto) opt.idx = ch.idx
  takeAction(me, foe, st.rng, st.log, opt)
  tickBleedAfterAct(me, st.log, foe)     // ★出血は行動した直後に刻む
  commitBuff(me, beforeMe, false, st.t)
  commitBuff(foe, beforeFoe, true, st.t)
  commitAil(me, ailMe, st.t)
  commitAil(foe, ailFoe, st.t)
  commitStates(me, st.t)
  commitStates(foe, st.t)
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
      // 武器の進化「追加行動率+%」は、ATBでは**溜まりの速さ**に読み替える
      const fill = FILL_PER_SEC * fillRatio(eMe.agi, eFoe.agi) * (1 + (me.evo?.extra || 0) / 100)
      me.gauge = Math.min(GAUGE_MAX, me.gauge + fill * dt)
    }
    const other = me === st.a ? st.b : st.a
    while (me.tickAt <= st.t) { tickDot(me, st.log, other); me.tickAt += TICK_SEC }
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
// ★職の軸の状態（空中・呪力・竜気・獣の型・納刀…）。
//   ATBは自分でコマンドを選ぶので、**いま何が乗っているかが見えないと切り札を撃つ判断ができない**。
//   バフと違って時間では切れず、技を撃つと変わる（＝残り秒は出さない）
export const stateChips = (side) => {
  const out = []
  if (side.air) out.push({ key:'air', label:'🕊 空中' })
  if (side.form) out.push({ key:'form', label:`🐾 ${BEAST_FORMS[side.form]?.label || side.form}の型` })
  if (side.ritual > 0) out.push({ key:'ritual', label:`🔯 呪力×${side.ritual}` })
  if (side.charge > 0) out.push({ key:'charge', label:`🐉 竜気×${side.charge}` })
  if (side.stance) out.push({ key:'stance', label:'🗡 納刀' })
  if (side.frenzy) out.push({ key:'frenzy', label:'💢 我を忘れている' })
  if (side.foresight) out.push({ key:'foresight', label:'👁 見切り' })
  if (side.bigGuard > 0) out.push({ key:'bigGuard', label:`🛡 大防御 被ダメージ-${side.bigGuard}%` })
  if (side.rage > 0) out.push({ key:'rage', label:`🔥 高ぶり×${side.rage}` })
  if (side.hitStacks > 0) out.push({ key:'hit', label:`🎯 照準×${side.hitStacks}` })
  // ★連打の回数は誰でも増える。活かせるスキルを枠に持っている側だけに出す
  if (side.repeatCount > 1 && side.slots?.some(s => s.skill?.repeat)) {
    out.push({ key:'repeat', label:`🔁 連打×${side.repeatCount}` })
  }
  return out
}

// 状態異常の表示（残り秒つき）
export const ailChips = (side, now) => AIL_KEYS
  .filter(k => side.ail[k])
  .map(k => ({
    key: k, label: AIL_LABEL[k],
    sec: Math.max(0, Math.ceil((side.ailUntil[k] ?? now) - now)),
    stacks: k === 'bleed' ? side.ail.bleed.stacks : 0,
  }))
