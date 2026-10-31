// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦の結果を確かめる（サーバーで同じ戦闘を回し直す）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー選択「サーバーの計算で入れる」「pushだけで揃う」（経緯は docs/v2cap-design.md §6-14 の「IDダンジョン」）：
//   ・挑戦の始めに、サーバーが乱数の種を決め、自分のキャラと着けている装備を写し取る（v2cap_dungeon_try_start の seed・snap）。
//     画面もサーバーも、この写しから同じ関数（startTryAtb）で戦闘を作る＝画面が持っている値を信じない
//   ・画面は押した記録（st.inputs）と終わりの刻みを預けるだけ（v2cap_dungeon_try_end）。Vercel の関数（api/v2cap-dungeon-verify.js）が
//     同じ戦闘を回し直し（verifyTry）、その結果だけでダメージと報酬が決まる（v2cap_dungeon_verify_settle）。
//     画面の申告（p_claim）は比べて、ずれたら記録に残すだけ（v2cap_dungeon_mismatch）
//   ・実時間より速くは進めない：挑戦を始めてから記録が届くまでの時間のぶんしか回さない（allowedSteps）
//   ★同じ種と記録なら途中の状態まで同じ（dungeonVerify.test.js）。重さは180秒の戦闘で10ミリ秒以下
// ⚠INPUTS_MAX は SQL の c_inputs_max と同じ（dungeon.test.js が突き合わせる）
// ============================================================
import { STEP_SEC, createAtb, replayInputs, seedRng } from '../core/atb.js'
import { MACRO_STEPS } from './atbMacro.js'
import { atbPlayerOf } from './atbPlayer.js'
import { activeMealOf } from './burger.js'
import { DUNGEON_TRY_SEC, dungeonFighter } from './dungeon.js'

export const TRY_STEPS = Math.round(DUNGEON_TRY_SEC / STEP_SEC)   // 挑戦1回の刻みの数
export const INPUTS_MAX = 5000      // 押した記録の数の上限（ふつうは数百。1秒に27回押し続けないと届かない）
export const TIME_SLACK_SEC = 2     // 実時間と比べるときの余裕（秒）

// 挑戦の戦闘を作る。boss・diff・hp・seed・snap は v2cap_dungeon_try_start の返事（画面）か、サーバーが預かった同じ値（回し直し）
//   snap＝{ prof, inv, at }。at＝挑戦を始めた時刻（ms）。食事の残りや時間帯は、いまの時計でなくこの時刻で決める
export const startTryAtb = ({ boss, diff, hp, seed, snap }) => {
  const foe = dungeonFighter(boss, diff, hp)
  if (!foe) return null
  const at = new Date(Number(snap.at))
  const me = atbPlayerOf(snap.prof, snap.inv, { meal: activeMealOf(snap.prof, at), at })
  return createAtb(me, foe, { maxSec: DUNGEON_TRY_SEC, rng: seedRng(seed) })
}

// この挑戦で削った量（画面の申告もサーバーの計算も、この形で数える）
export const damageOf = (st) => Math.floor(Math.max(0, st.b.startHp - Math.max(0, st.b.hp)))

// 押した記録の形を見る（ブラウザを書き換えれば何でも送れる）
const isIdx = (v) => Number.isInteger(v) && v >= 0 && v < 1000
const validEntry = (e) => !!e && typeof e === 'object' && (e.guard === true || e.idx === null || isIdx(e.idx))
const validInput = (e) => {
  if (!e || typeof e !== 'object' || !Number.isInteger(e.step) || e.step < 0 || e.step > TRY_STEPS) return false
  if (e.k === 'q') return e.idx === null || isIdx(e.idx)
  if (e.k === 'unq') return isIdx(e.pos)
  if (e.k === 'clr' || e.k === 'stop' || e.k === 'guard') return true
  if (e.k === 'macro') return Number.isInteger(e.no) && Array.isArray(e.steps) && e.steps.length <= MACRO_STEPS && e.steps.every(validEntry)
  return false
}
export const validInputs = (inputs) => Array.isArray(inputs) && inputs.length <= INPUTS_MAX
  && inputs.every((e, i) => validInput(e) && (i === 0 || e.step >= inputs[i - 1].step))

// 実時間で進めたはずの刻みの上限。★画面は実時間より速く進まない（core/atb.js の advance）＝ふつうに遊ぶ人はここにかからない
export const allowedSteps = (elapsedSec) =>
  Math.min(TRY_STEPS, Math.floor((Math.max(0, Number(elapsedSec) || 0) + TIME_SLACK_SEC) / STEP_SEC))

// 回し直す。返すのは { damage（サーバーの計算）, steps, winner, reason（おかしかったわけ・無ければ null）}
//   inputs・endStep は画面から届いたもの。elapsedSec はサーバーの時計（挑戦を始めてから記録が届くまで）
export const verifyTry = ({ boss, diff, hp, seed, snap, inputs, endStep, elapsedSec }) => {
  if (!validInputs(inputs)) return { damage: 0, steps: 0, winner: null, reason: 'inputs' }
  const st = startTryAtb({ boss, diff, hp, seed, snap })
  if (!st) return { damage: 0, steps: 0, winner: null, reason: 'boss' }
  const want = Number.isInteger(endStep) && endStep >= 0 ? endStep : 0
  const limit = allowedSteps(elapsedSec)
  replayInputs(st, inputs, Math.min(want, limit))
  return { damage: damageOf(st), steps: st.steps, winner: st.winner, reason: want > limit ? 'too_fast' : null }
}
