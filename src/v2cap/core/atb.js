// ============================================================
// バトルフロンティアⅡ（v2cap）— ATB戦闘（レイドボス・IDダンジョン用）
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示：レイドボスとIDダンジョンだけATB（出撃のエリア・覇天塔はオートのまま）。
//   ・ゲージはふだん1倍。AGIが相手を大きく上回ると速くなる（相手の4倍で2倍速・そこで上限）＝fillRatio
//   ・技は**クールダウン制・秒で数える**（AGIでは縮まない）。長さはオートの発動率から
//   ・ATBでは**持っている技を全部使える**（枠なし）
//   ・**MPはオートと同じ**＝満タンで始まり回復なし（尽きたら通常攻撃）
//   ・**バフは強さで長さが変わる・重ねない**（かけ直すと強いほうが残り、長さが戻る）
//   ・**時間は止まらない＋予約できる**（ゲージが満タンになった瞬間に予約の先頭が出る）
//   ・全職共通の「防御」：次の自分の行動まで受けるダメージ−50%。**長めのクールダウンつき**
//     （ユーザー「連発したらヌルゲーになる」）
//   ・ボスの大技は**詠唱のバー**で前ぶれを出す（そのあいだに防御・回復で備えられる）
//   ・予約（マクロ）の先頭の技がクールダウン中・MP不足なら**使えるまで待つ**（そのあいだは通常攻撃でつなぐ）
//
// ★ダメージ・命中・状態異常などの中身は battle.js の takeAction をそのまま呼ぶ＝**計算を二重に書かない**。
// ★ターンで数える効果（◯ターン続く・毎ターン回復・ターンの頭のユニーク・状態異常の残り）は、
//   **1ターン＝TURN_SEC 秒**の時計で battle.js の startOfTurn／endOfTurn を呼んで、そのまま秒へ読み替える。
// ★オート前提の効果の読み替え（ATBで死なせない）：
//     発動率+%（パッシブ・エンチャント・武器の進化・納刀）→ クールダウンが短くなる
//     サイレンス・恐怖・動揺（発動率−）                  → クールダウンが長くなる
//     追加行動率+%・刻の加護                            → ゲージの溜まりが速くなる（AGIの追加行動はゲージの速さに含める）
//     先手+%                                           → 開始のゲージ
//     先制（スキルの優先度・納刀）                       → その行動に要るゲージが軽くなる
//     クイック（もう一度行動）                           → ゲージが満タンになる
//     5つの枠を全部使ったら（ユニーク）                   → 違う技を5つ使ったら（battle.js）
//   ⚠不発のときの効果（居合の構え・精神感応・居合の心得）はATBに不発が無いので対象外
//
// ★時間は**決まった刻み（STEP_SEC）**で進める＝同じ乱数と同じ入力なら同じ結果になる
//   （あとで「乱数の種＋押した記録」をサーバーで回し直して確かめるため。押した記録は st.inputs）。
// ⚠オート戦闘の定数は触らない。ATB用の値はこのファイルだけに置く。
// ============================================================
import {
  createSide, liveStats, mpCostOf, priorityOf, takeAction, tickBleedAfterAct, BUFF_MIN_PCT, BEAST_FORMS,
  battleStart, startOfTurn, endOfTurn,
} from './battle.js'
import { STAT_KEYS } from './stats.js'
import { AIL_KEYS, AIL_LABEL, hasAilment, procCutOf, isSealed, usesMp } from './ailments.js'
import { ichijiSkip, agitCutOf, STK_LABEL } from './battleIchiji.js'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
// 秒の比べに使うごく小さい余裕（刻みの足し算の誤差で、ちょうど期限の瞬間を落とさない）
const EPS = 1e-6

// ============================================================
// ★調整するつまみはこの節に全部ある（試し撃ちの画面で触りながら決める）
// ============================================================
export const STEP_SEC     = 0.05  // 1刻みの秒（20刻みで1秒）。結果を再現できるよう、刻みは固定
// 1ターン＝何秒か（同じ速さどうしの1行動の長さ）。【確定】2026-10-26 試し撃ちのあとユーザー「ゲージ上がるの気持ち速いかも」→選んだ「5秒に1回」（前は4秒）
export const TURN_SEC     = 5
export const GAUGE_FULL   = 100   // 1行動ぶんのゲージ
export const FILL_PER_SEC = GAUGE_FULL / TURN_SEC   // 同じ速さなら TURN_SEC 秒で満タン
export const MAX_DT       = 0.25  // 裏のタブから戻ったときに一気に進めない（1回に進める上限の秒）
export const MAX_SEC      = 180   // これを超えたら時間切れ

// ゲージの溜まる速さ（同じ速さ＝1倍）
//   【確定】2026-10-26 試し撃ちのあとユーザー指示「基本を1倍として、そこから敵のAGIを大幅に超えてる場合より早くなるようにして。
//     4倍でゲージの速さ2倍になるくらい」＋「プレイヤー側の最高速度は基本上限ある」（前は平方根・0.5〜2倍）：
//     AGIが相手以下なら1倍（遅くはならない）→ 上回ったぶん比に比例して速くなり、AGI_FULL_RATIO 倍で RATIO_MAX 倍速で止まる
//     ＝相手の2倍で1.33倍速・3倍で1.67倍速・4倍で2倍速。敵も同じ式（AGIでこちらを大きく上回るボスは速くなる）
//   ★追加行動率+%などの上乗せは、この上限のあとに掛ける＝上限を超えてよい（ユーザー選択「上乗せは超えてよい」）
//   ★比で見るので、AGIがインフレしても効き方は変わらない（変わるのは相手との差だけ）
export const AGI_FULL_RATIO = 4
export const RATIO_MAX      = 2
export const fillRatio = (myAgi, foeAgi) => {
  const r = Math.max(0, myAgi) / Math.max(1, foeAgi)
  return r <= 1 ? 1 : Math.min(RATIO_MAX, 1 + (r - 1) * (RATIO_MAX - 1) / (AGI_FULL_RATIO - 1))
}

// クールダウン（秒）＝CD_BASE＋（100−発動率）×CD_PER_PROC
//   【確定】2026-10-26 ユーザー選択「秒で数える」。
//   【確定】2026-10-26 試し撃ちのあとユーザー選択「差を大きく」：100%→3秒・90%→9秒・80%→15秒・70%→21秒（前は4・8・12・16秒）
export const CD_BASE     = 3
export const CD_PER_PROC = 0.6
export const cdOfProc = (proc, bonus = 0) =>
  Math.round((CD_BASE + Math.max(0, 100 - (proc ?? 100) - bonus) * CD_PER_PROC) * 10) / 10

// 先制（優先度1ごと）でその行動に要るゲージを何%軽くするか（最大60%）
export const PRIORITY_CUT = 20

// 防御（全職共通）。次の自分の行動まで受けるダメージ−GUARD_CUT%・使ったら GUARD_CD 秒は使えない
//   ★クールダウンは技のいちばん長いもの（発動率70%で21秒）より長く（ユーザー「長め」）
//   【確定】2026-10-26 試し撃ちのあとユーザー選択「CDを長く」：−50%のまま・45秒（前は30秒）
export const GUARD_CUT = 50
export const GUARD_CD  = 45

// ボスの大技の詠唱（秒）。倍率が CAST_MULT 以上の敵の技は、撃つ前に詠唱のバーが出る
//   【確定】2026-10-26 ユーザー指示「ボスの大技の構え（詠唱）も5秒にして。同じ速さなら1回は備えられるように」
//   ＝1ターン（同じ速さの1行動）と同じ長さ。TURN_SEC を変えてもこの関係が崩れないよう、TURN_SEC から決める（前は4秒）
export const CAST_SEC  = TURN_SEC
export const CAST_MULT = 2.5

// バフ・デバフの長さ（秒）＝BUFF_SEC_CONST ÷ 効果の合計%。強いほど短い
//   【確定】2026-10-26 ユーザー選択「強さで長さが変わる・重ねない」：+30%→100秒・+20%→150秒
//   デバフは攻撃技のおまけでも入るので上限を短くする
export const BUFF_SEC_CONST = 3000
export const BUFF_SEC_MIN   = 30
export const BUFF_SEC_MAX   = 150
export const DEBUFF_SEC_MAX = 60
export const buffSecOf = (totalPct, isDebuff = false) =>
  Math.round(clamp(BUFF_SEC_CONST / Math.max(1, Math.abs(totalPct)), BUFF_SEC_MIN, isDebuff ? DEBUFF_SEC_MAX : BUFF_SEC_MAX))

// ===== 読み替えの計算 =====
// 発動率+%の合計（オート戦闘の takeAction と同じ足し方）
export const procBonusOf = (side) =>
  (side?.pa?.procBonus || 0) + (side?.en?.procBonus || 0) + (side?.evo?.proc || 0)
// その技のクールダウン（撃つ時点のサイドの状態で決める）
export const cdFor = (side, skill) => {
  if (!skill) return 0
  const soar = skill.jump && side.soar?.turns > 0 ? (side.soar.proc || 0) : 0
  const bonus = procBonusOf(side) + (side.stance?.proc || 0) + soar - procCutOf(side.ail) - agitCutOf(side)
  return cdOfProc(skill.proc, bonus)
}
// その行動に要るゲージ（先制で軽くなる）
export const needFor = (side, skill) => {
  const cut = Math.min(60, PRIORITY_CUT * Math.max(0, priorityOf(side, skill)))
  return Math.round(GAUGE_FULL * (1 - cut / 100))
}
// 鈍足はATBでは**ゲージが20%遅くなる**（AGIは下げない＝battle.js の livePct が side.atb を見る）
//   【確定】2026-10-29 ユーザー選択「ゲージが20%遅くなる」：AGI−20%のままだと、ボスより速い人にしか効かなかった
//   （ゲージはふだん1倍で、AGIが相手を上回ったぶんだけ速くなるため）。出撃の戦闘の鈍足（AGI−20%）はそのまま
export const ATB_SLOW_CUT = 20
// ゲージの溜まる速さ（1秒あたり）。追加行動率は「速さ」へ読み替える
export const fillPerSecOf = (me, eMe, eFoe) => {
  const extra = (me.evo?.extra || 0) + (me.pa?.ex?.extraIfFaster && eMe.agi > eFoe.agi ? me.pa.ex.extraIfFaster : 0)
  const slow = hasAilment(me.ail || {}, 'slow') ? 1 - ATB_SLOW_CUT / 100 : 1
  return FILL_PER_SEC * fillRatio(eMe.agi, eFoe.agi) * (1 + extra / 100) * slow
}

// ===== 1サイド =====
// opt.ai … 自分で技を選ぶ（敵）。枠の順に、撃てる技を出す
// opt.cast … 大技に詠唱のバーを出す（ボス）
const createAtbSide = (fighter, band, { ai = false, cast = false } = {}) => {
  // ★ATBは回数でなくクールダウンで回す。回数の上限がある技（狂鬼化＝1回まで）だけ上限を残す
  const slots = (fighter.slots || []).filter(s => s?.skill).map(s => ({ ...s, uses: s.skill.usesMax ?? 9999 }))
  const side = createSide({ ...fighter, slots }, band)
  side.atb = true
  side.ai = ai
  side.castBig = cast
  // 武器の進化「◯%で先手を取る」は開始のゲージに読み替える
  side.gauge = Math.min(GAUGE_FULL, GAUGE_FULL * (side.evo?.first || 0) / 100)
  side.cd = {}                 // 技の枠 → 使えるようになる時刻（秒）
  side.cdLen = {}              // 技の枠 → そのクールダウンの長さ（秒）＝画面の「下から色が戻る」の割合に使う
  side.timed = []              // [{ table, sec, until, debuff }] 時間で切れるバフ・デバフ
  side.queue = []              // 割り込み：[{ idx }]（idx＝null は通常攻撃）。手で押した技・先頭から1回ずつ。マクロより先に出る
  side.macro = null            // 動いているマクロ：{ no, steps, pos, loop }（startMacro）
  side.guardNext = false       // 次の行動は防御（ボタン。割り込み・マクロより先に出る）
  side.guardCut = 0            // 防御中の軽減率（battle.js の applyIncoming が見る）
  side.guardReadyAt = 0        // 防御が使えるようになる時刻
  side.cast = null             // 詠唱中：{ idx, name, start, until }
  side.rot = 0                 // 敵が次に見る枠
  side.parObj = null           // 麻痺の期限を付けた状態異常（入れ直しを見分ける）
  side.parUntil = 0
  side.bigGuardUntil = 0       // 大防御（聖騎士）が切れる時刻
  side.acted = 0               // ATBで行動した回数（テスト・画面用）
  // ボスの技の出し方（パターン）と、持ち越しのHP（IDダンジョン：最大HPは全体・いまのHPは前の挑戦の残り）
  side.pattern = fighter.pattern || null
  if (fighter.hpNow != null) side.hp = Math.max(1, Math.min(side.base.hp, Math.floor(fighter.hpNow)))
  side.startHp = side.hp       // この戦闘を始めたときのHP（削った量＝startHp − いまのHP）
  return side
}

// fighterA が自分（予約で動く）・fighterB が相手（自分で選ぶ・大技は詠唱）
export const createAtb = (fighterA, fighterB, { rng = Math.random, band = null, maxSec = MAX_SEC, castB = true } = {}) => {
  const st = {
    rng, band, maxSec, steps: 0, t: 0, acc: 0, turn: 1, over: false, winner: null, log: [], inputs: [],
    a: createAtbSide(fighterA, band),
    b: createAtbSide(fighterB, band, { ai: true, cast: castB }),
  }
  battleStart(st.a, st.b, st.log)
  initPattern(st.a, rng)
  initPattern(st.b, rng)
  // ★職業補正・パッシブ・エンチャント・戦闘の始めの能力のぶんは**消えない**（時間で切れるのは技で入ったものだけ）
  st.a.baseBuffs = { ...st.a.buffs }
  st.b.baseBuffs = { ...st.b.buffs }
  startOfTurn(st.a, st.b, st.turn, st.log)
  afterEngine(st, st.a, { ...st.a.buffs }, true)
  afterEngine(st, st.b, { ...st.b.buffs }, true)
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

// 技で入ったぶん（table）を、時間で切れる枠に入れる。★同じステ・同じ向き（プラス／マイナス）は重ねない＝
//   強いほうの値を残して長さを戻す（ユーザー選択「重ねない」）。プラスとマイナスは別の枠（打ち消し合わない）
const addTimed = (side, table, isDebuff, now) => {
  for (const [k, v] of Object.entries(table)) {
    for (const e of side.timed) {
      const cur = e.table[k]
      if (cur === undefined || Math.sign(cur) !== Math.sign(v)) continue
      if (Math.abs(cur) > Math.abs(v)) table[k] = cur
      delete e.table[k]
    }
  }
  side.timed = side.timed.filter(e => Object.keys(e.table).length > 0)
  const total = Object.values(table).reduce((s, v) => s + Math.abs(v), 0)
  if (!total) return
  const sec = buffSecOf(total, isDebuff)
  side.timed.push({ table, sec, until: now + sec, debuff: isDebuff })
}

// 戦闘エンジン（takeAction・ターンの時計）を通したあとの後始末。before は通す前の side.buffs
//   permanent … ターンの時計・戦闘の始めで入ったぶん（オートでも戦闘中ずっと＝消えない枠へ）
const afterEngine = (st, side, before, permanent = false) => {
  // バフ消し（スキル・禁書アポクリファ）で落ちたぶん：消えない枠からも落とし、差分に数えない
  //   ★オート戦闘でも「そのステのプラスを丸ごと消す」ので、職業補正などのぶんも一緒に消える
  const gone = Object.keys(before).filter(k => before[k] > 0 && !(side.buffs[k] > 0))
  const dispelled = Object.keys(side.dispelled || {})
  for (const k of new Set([...gone.filter(k => side.buffs[k] === undefined), ...dispelled])) {
    if (side.baseBuffs[k] > 0) delete side.baseBuffs[k]
    for (const e of side.timed) if (e.table[k] > 0) delete e.table[k]
    delete before[k]
  }
  side.timed = side.timed.filter(e => Object.keys(e.table).length > 0)
  side.dispelled = null
  const up = {}
  const down = {}
  for (const k of STAT_KEYS) {
    const d = (side.buffs[k] || 0) - (before[k] || 0)
    if (d > 0) up[k] = d
    else if (d < 0) down[k] = d
  }
  if (permanent) {
    for (const [k, v] of Object.entries({ ...up, ...down })) side.baseBuffs[k] = Math.max(BUFF_MIN_PCT, (side.baseBuffs[k] || 0) + v)
  } else {
    if (Object.keys(up).length) addTimed(side, up, false, st.t)
    if (Object.keys(down).length) addTimed(side, down, true, st.t)
  }
  recomputeBuffs(side)
  // 麻痺：オートは「自分の番で1ターンぶん動けない」。ATBは**入った時点から ターン数×TURN_SEC 秒、ゲージが止まる**
  const par = side.ail.paralyze
  if (par && par !== side.parObj) {
    side.parObj = par
    side.parUntil = st.t + Math.max(1, par.turns || 1) * TURN_SEC
  }
  // 大防御（聖騎士）：オートは1ターンで切れる＝使ってから TURN_SEC 秒
  if (side.bigGuard && !side.bigGuardUntil) side.bigGuardUntil = st.t + TURN_SEC
}

// 期限切れを落とす
const expire = (st, side) => {
  const now = st.t
  if (side.timed.length) {
    const n = side.timed.length
    side.timed = side.timed.filter(e => e.until + EPS > now)
    if (side.timed.length !== n) recomputeBuffs(side)
  }
  if (side.ail.paralyze && side.parUntil <= now + EPS) { delete side.ail.paralyze; side.parObj = null }
  if (side.bigGuard && side.bigGuardUntil && side.bigGuardUntil <= now + EPS) { side.bigGuard = 0; side.bigGuardUntil = 0 }
  if (!side.bigGuard) side.bigGuardUntil = 0
}

// ===== 行動の選び方 =====
// その枠の技が、いま撃てるか（クールダウン・MP・封印・溜めの条件）
export const canUse = (side, idx, now) => {
  const s = side.slots[idx]
  if (!s?.skill || s.uses <= 0) return false
  if ((side.cd[idx] || 0) > now + EPS) return false
  if (isSealed(side.ail) && usesMp(s.skill)) return false
  if (ichijiSkip(side, s.skill)) return false
  if (s.skill.mpPct) return side.mp > 0
  return mpCostOf(side, s.skill) <= side.mp
}
export const cdLeft = (side, idx, now) => Math.max(0, (side.cd[idx] || 0) - now)
// クールダウンの残りの割合（1＝使った直後・0＝使える）。画面のグレーの高さ（2026-10-26 ユーザー指示「グレーアウトして時間の経過ごとに下から色が戻っていく」）
export const cdRatio = (side, idx, now) => {
  const len = side.cdLen?.[idx] || 0
  return len > 0 ? Math.min(1, cdLeft(side, idx, now) / len) : 0
}
export const guardReady = (side, now) => side.guardReadyAt <= now + EPS
export const guardCdLeft = (side, now) => Math.max(0, side.guardReadyAt - now)
export const guardCdRatio = (side, now) => Math.min(1, guardCdLeft(side, now) / GUARD_CD)

// ===== ボスの技の出し方（パターン・IDダンジョンのボス＝lib/dungeon.js が fighter.pattern を付ける）=====
// 【確定】2026-10-29 ユーザー選択「節目ごとに1回使う、以降も確率で使う。HP５０％以下はスキル使用確定」：
//   pattern ＝ { steps: [{ at, skill }]（at の大きい順）, bands: [{ min, weights: { 技の名前: % } }]（min の大きい順） }
//   ・HPの割合（いまのHP÷最大HP＝持ち越しの全体）が at 以下になったら、次の行動でその技を1回必ず撃つ
//     （行動を決めたあとに切っても、その手より先に出す）。挑戦の始めにもう切っている節目は撃たない（前の挑戦で撃った）
//   ・それ以外は、HPの割合が min より上の帯の weights で1行動ごとに引く。残りは通常攻撃（足して100なら毎回技）
//   ・クールダウンは見ない（パターンが決める）。引くのは行動を決めるときに1回だけ（st.rng＝同じ種なら同じ結果）
const hpFracOf = (side) => side.hp / Math.max(1, side.base.hp)
const slotByName = (side, name) => {
  const idx = side.slots.findIndex(s => s.skill?.name === name)
  return idx < 0 ? { idx: null, skill: null } : { idx, skill: side.slots[idx].skill }
}
const patternPick = (side) => {
  const p = side.pattern, frac = hpFracOf(side)
  const step = p.steps.find(s => frac <= s.at && !side.patFired.includes(s.at))
  if (step) {
    side.patFired.push(step.at)
    side.patNext = slotByName(side, step.skill)
  }
  if (!side.patNext) {
    const band = p.bands.find(b => frac > b.min) || p.bands[p.bands.length - 1]
    let r = side.patRng() * 100
    let name = null
    for (const [k, w] of Object.entries(band?.weights || {})) { if (r < w) { name = k; break } r -= w }
    side.patNext = name ? slotByName(side, name) : { idx: null, skill: null }
  }
  return side.patNext
}
// 挑戦の始め：もう切っている節目は撃ったことにする
const initPattern = (side, rng) => {
  side.patRng = rng
  side.patFired = side.pattern ? side.pattern.steps.filter(s => hpFracOf(side) <= s.at).map(s => s.at) : []
  side.patNext = null
}

// 敵：rot から枠を回って、撃てる技を出す（無ければ通常攻撃）
const aiPick = (side, now) => {
  if (side.pattern) return patternPick(side)
  const n = side.slots.length
  for (let i = 0; i < n; i++) {
    const idx = (side.rot + i) % n
    if (canUse(side, idx, now)) return { idx, skill: side.slots[idx].skill }
  }
  return { idx: null, skill: null }
}

// 予約・マクロの1手（{ idx }＝技・idx:null＝通常攻撃・{ guard:true }＝防御）を、いま出せる行動にする。
//   使えないとき（クールダウン中・MP不足・防御のクールダウン中）は**使えるまで待つ**＝通常攻撃でつなぎ、その手は残す（ユーザー選択）
const resolveEntry = (side, e, now, from) => {
  if (e.guard) return guardReady(side, now) ? { guard: true, skill: null, from } : { idx: null, skill: null, waiting: 'guard' }
  if (e.idx === null) return { idx: null, skill: null, from }
  if (canUse(side, e.idx, now)) return { idx: e.idx, skill: side.slots[e.idx].skill, from }
  return { idx: null, skill: null, waiting: e.idx }
}
// いまのマクロの手（無ければ null）
export const macroEntryOf = (side) => (side.macro ? side.macro.steps[side.macro.pos] || null : null)

// いま出る行動。防御のボタン → 割り込み（手で押した技・先頭から1回ずつ）→ マクロ → 通常攻撃
//   【確定】2026-10-26 ユーザー選択「マクロが動いているときに技を押したら、次の1回だけ割り込む」
export const chosenOf = (side, now) => {
  if (side.ai) return aiPick(side, now)
  if (side.guardNext && guardReady(side, now)) return { guard: true, skill: null, from: 'button' }
  if (side.queue[0]) return resolveEntry(side, side.queue[0], now, 'queue')
  const m = macroEntryOf(side)
  if (m) return resolveEntry(side, m, now, 'macro')
  return { idx: null, skill: null }
}
// いまの行動に要るゲージ
export const needNow = (side, now) => {
  const ch = chosenOf(side, now)
  return ch.guard ? GAUGE_FULL : needFor(side, ch.skill)
}

// ===== 入力（画面のボタン）。押した記録を st.inputs に残す（あとでサーバーで回し直すため）=====
const input = (st, rec) => st.inputs.push({ step: st.steps, ...rec })
// 割り込み（手で押した技）。idx＝null は通常攻撃
export const QUEUE_MAX = 8
export const reserve = (st, idx) => {
  if (st.over || st.a.queue.length >= QUEUE_MAX) return
  st.a.queue.push({ idx })
  input(st, { k: 'q', idx })
}
export const unreserveAt = (st, pos) => {
  if (st.over || !st.a.queue[pos]) return
  st.a.queue.splice(pos, 1)
  input(st, { k: 'unq', pos })
}
export const clearQueue = (st) => { st.a.queue = []; input(st, { k: 'clr' }) }
// マクロを動かす（no＝①〜③の番号・steps＝[{ idx }｜{ idx:null }｜{ guard:true }]・loop＝最後まで出たら頭に戻る）。
//   【確定】2026-10-26 ユーザー指示「マクロは選択したらループするようにして」＝画面からはいつも loop（前は「マクロごとに選べる」）。
//   別のマクロを押すと、そのマクロの頭から出し直す。手順が空なら止める
export const startMacro = (st, no, steps, loop = true) => {
  if (st.over) return
  const list = (steps || []).map(e => (e.guard ? { guard: true } : { idx: e.idx ?? null }))
  st.a.macro = list.length ? { no, steps: list, pos: 0, loop: !!loop } : null
  input(st, { k: 'macro', no, steps: list, loop: !!loop })
}
export const stopMacro = (st) => { st.a.macro = null; input(st, { k: 'stop' }) }
export const toggleGuard = (st) => {
  if (st.over) return
  st.a.guardNext = !st.a.guardNext
  input(st, { k: 'guard', on: st.a.guardNext })
}

const finish = (st) => {
  if (st.a.hp > 0 && st.b.hp > 0) return false
  st.over = true
  st.winner = st.a.hp <= 0 && st.b.hp <= 0 ? 'draw' : st.a.hp <= 0 ? 'b' : 'a'
  return true
}

// 出した手のぶん、割り込みの列・マクロを進める。fired＝その手が本当に出たか
//   （反動・跳躍中で動けなかった・狂乱でほかの技が出たときは進めない＝次にもう一度その手）
const advanceSource = (me, ch, fired) => {
  if (!fired) return
  if (ch.from === 'queue') me.queue.shift()
  else if (ch.from === 'macro' && me.macro) {
    me.macro.pos += 1
    if (me.macro.pos >= me.macro.steps.length) {
      // 【確定】2026-10-26 ユーザー選択「くり返すかはマクロごとに選べる」。くり返さないマクロは最後まで出たら止まる（あとは通常攻撃）
      if (me.macro.loop) me.macro.pos = 0
      else me.macro = null
    }
  } else if (ch.from === 'button') me.guardNext = false
}

// 1回の行動を解決する（ch は chosenOf の結果）
const act = (st, me, foe, ch) => {
  const now = st.t
  me.acted += 1
  me.guardCut = 0   // 防御は「次の自分の行動まで」
  if (ch.guard) {
    me.guardCut = GUARD_CUT
    me.guardReadyAt = now + GUARD_CD
    me.gauge = Math.max(0, me.gauge - GAUGE_FULL)
    st.log.push({ side: me.name, type: 'guard', cut: GUARD_CUT })
    tickBleedAfterAct(me, st.log, foe)   // ★防御も行動なので、そのあと出血が刻む
    advanceSource(me, ch, true)
    return
  }
  const need = needFor(me, ch.skill)
  const beforeMe = { ...me.buffs }
  const beforeFoe = { ...foe.buffs }
  let quick = false
  // どの枠が出たかを ptr で受け取る（takeAction は撃った枠の次を ptr に入れる。狂乱でほかの枠が出ることもある）
  me.ptr = null
  takeAction(me, foe, st.rng, st.log, {
    idx: ch.idx, noProc: true, noParalyze: true, bigGuardSec: TURN_SEC, onQuick: () => { quick = true },
  })
  const n = me.slots.length
  const used = me.ptr === null ? null : (me.ptr - 1 + n) % n
  me.ptr = 0
  if (used !== null) {
    // ★撃つ前の状態（納刀など）で決める。狂乱でほかの技が出たときはその技の長さ
    me.cdLen[used] = used === ch.idx ? ch.cd : cdFor(me, me.slots[used].skill)
    me.cd[used] = now + me.cdLen[used]
    if (me.ai) me.rot = (used + 1) % n
  }
  tickBleedAfterAct(me, st.log, foe)     // ★出血は行動した直後に刻む
  afterEngine(st, me, beforeMe)
  afterEngine(st, foe, beforeFoe)
  me.gauge = quick ? GAUGE_FULL : Math.max(0, me.gauge - need)
  advanceSource(me, ch, ch.idx === null || used === ch.idx)
}

// ゲージが満タンになった側の行動。ボスの大技はここで詠唱に入る
const startAct = (st, me, foe) => {
  const ch = chosenOf(me, st.t)
  me.patNext = null   // パターンのボス：次の行動はまた引く
  if (ch.skill) ch.cd = cdFor(me, ch.skill)
  if (me.castBig && ch.skill && (ch.skill.mult || 0) >= CAST_MULT) {
    me.cast = { idx: ch.idx, name: ch.skill.name, start: st.t, until: st.t + CAST_SEC, cd: ch.cd }
    st.log.push({ side: me.name, type: 'cast', skill: ch.skill.name, sec: CAST_SEC })
    return
  }
  act(st, me, foe, ch)
}

// 余り（0以上なら動ける）。詠唱中・麻痺中は動かない
const excessOf = (side, now) => (side.cast || side.ail.paralyze ? -Infinity : side.gauge - needNow(side, now))

// ===== 1刻み進める =====
const stepOnce = (st) => {
  st.steps += 1
  st.t = st.steps * STEP_SEC
  const { a, b } = st

  // ターンの時計：ターンで数える効果を進める（オート戦闘のターンの終わり→次のターンの頭と同じ）
  if (st.t + EPS >= st.turn * TURN_SEC) {
    const ba = { ...a.buffs }
    const bb = { ...b.buffs }
    if (endOfTurn(a, b, st.turn, st.rng, st.log, { resetBigGuard: false })) { finish(st); return }
    st.turn += 1
    startOfTurn(a, b, st.turn, st.log)
    afterEngine(st, a, ba, true)
    afterEngine(st, b, bb, true)
    if (finish(st)) return
  }
  expire(st, a)
  expire(st, b)

  // ゲージを溜める（麻痺・詠唱のあいだは止まる）
  const eA = liveStats(a)
  const eB = liveStats(b)
  for (const [me, eMe, eFoe] of [[a, eA, eB], [b, eB, eA]]) {
    if (me.cast || me.ail.paralyze) continue
    // ★満タンを少し超えたぶんは次へ持ち越す（100で切ると、刻みの端数のぶん速い側ほど遅くなる）
    me.gauge = Math.min(GAUGE_FULL * 2, me.gauge + fillPerSecOf(me, eMe, eFoe) * STEP_SEC)
  }

  // 満タンの側から動く（余りが大きいほうが先・同じなら乱数）
  for (let guard = 0; guard < 6; guard++) {
    const ea = excessOf(a, st.t)
    const eb = excessOf(b, st.t)
    if (ea < 0 && eb < 0) break
    const aFirst = ea !== eb ? ea > eb : st.rng() < 0.5
    if (aFirst) startAct(st, a, b)
    else startAct(st, b, a)
    if (finish(st)) return
  }

  // 詠唱が終わった大技を撃つ。★同じ刻みで動ける側は先に動く（上の段）＝構えの終わりと次の行動が同じ瞬間でも防御が間に合う
  //   （2026-10-26 ユーザー指示「同じ速さなら1回は備えられるように」）
  for (const [me, foe] of [[b, a], [a, b]]) {
    if (!me.cast || me.cast.until > st.t + EPS) continue
    const c = me.cast
    me.cast = null
    const skill = me.slots[c.idx]?.skill
    // ★詠唱のあいだに封印・MP不足になったら通常攻撃に落ちる（takeAction が封印を見る・MPはここで見る）
    const ok = skill && (skill.mpPct ? me.mp > 0 : mpCostOf(me, skill) <= me.mp)
    act(st, me, foe, ok ? { idx: c.idx, skill, cd: c.cd } : { idx: null, skill: null })
    if (finish(st)) return
  }

  if (st.t + EPS >= st.maxSec) { st.over = true; st.winner = 'draw' }
}

// 実時間で進める（画面の setInterval から呼ぶ）。端数は次へ持ち越す＝刻みは常に STEP_SEC
export const advance = (st, realSec) => {
  if (st.over) return st
  st.acc += clamp(realSec || 0, 0, MAX_DT)
  while (st.acc + EPS >= STEP_SEC && !st.over) {
    st.acc -= STEP_SEC
    stepOnce(st)
  }
  return st
}
// 秒で進める（テスト・シミュレーション用。実時間の上限なし）
export const runFor = (st, sec) => {
  const end = st.steps + Math.round(sec / STEP_SEC)
  while (st.steps < end && !st.over) stepOnce(st)
  return st
}

// ===== 画面用のまとめ =====
// 時間で切れるバフ・デバフ（残り秒つき）
export const buffChips = (side, now) => side.timed
  .map(e => ({ table: e.table, debuff: e.debuff, sec: Math.max(0, Math.ceil(e.until - now)), pct: (e.until - now) / e.sec }))
  .filter(c => c.sec > 0)
// 状態異常（残り秒の目安つき）。ターンで数えるものは「次の時計まで＋残りターン」
export const ailChips = (st, side) => AIL_KEYS
  .filter(k => hasAilment(side.ail, k))
  .map(k => {
    const a = side.ail[k]
    const toTick = st.turn * TURN_SEC - st.t
    const sec = k === 'paralyze' ? side.parUntil - st.t
      : k === 'bleed' ? 0
      : toTick + Math.max(0, (a.turns || 1) - 1) * TURN_SEC
    return { key: k, label: AIL_LABEL[k], sec: Math.max(0, Math.ceil(sec)), stacks: k === 'bleed' ? a.stacks : 0 }
  })
// 職の軸の状態（空中・呪力・竜気・獣の型・納刀…）。時間では切れず、技を撃つと変わる
export const stateChips = (side) => {
  const out = []
  if (side.air) out.push({ key:'air', label:'🕊 空中' })
  if (side.jumping) out.push({ key:'jump', label:'🐉 跳躍中' })
  if (side.form) out.push({ key:'form', label:`🐾 ${BEAST_FORMS[side.form]?.label || side.form}の型` })
  if (side.ritual > 0) out.push({ key:'ritual', label:`🔯 呪力×${side.ritual}` })
  if (side.charge > 0) out.push({ key:'charge', label:`🐉 竜気×${side.charge}` })
  if (side.stance) out.push({ key:'stance', label:'🗡 納刀' })
  if (side.frenzy) out.push({ key:'frenzy', label:'💢 我を忘れている' })
  if (side.foresight) out.push({ key:'foresight', label:'👁 見切り' })
  if (side.bigGuard > 0) out.push({ key:'bigGuard', label:`🛡 大防御 被ダメージ-${side.bigGuard}%` })
  if (side.guardCut > 0) out.push({ key:'guard', label:`🛡 防御 被ダメージ-${side.guardCut}%` })
  if (side.shield > 0) out.push({ key:'shield', label:`🔰 バリア ${side.shield.toLocaleString()}` })
  if (side.rage > 0) out.push({ key:'rage', label:`🔥 高ぶり×${side.rage}` })
  if (side.hitStacks > 0) out.push({ key:'hit', label:`🎯 照準×${side.hitStacks}` })
  for (const [k, v] of Object.entries(side.stk || {})) if (v > 0) out.push({ key:`stk:${k}`, label:`◆ ${STK_LABEL[k] || k}×${v}` })
  return out
}
