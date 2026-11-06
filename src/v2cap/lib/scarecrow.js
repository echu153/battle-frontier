// ============================================================
// 「レベルキャップあり」版（v2cap）— 修練場の案山子（1日1回・60秒なぐる・与えたダメージでEXP）
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー「V２の冒険のコンテンツにデイリーで挑めるものを追加する、挑戦とは別」
//   「まずはエリア①クリアで開放する経験値のもらえる案山子を追加したい」「案山子のイラストも用意したい」→ 選んだ（どれも推奨）：
//   ・メニューは冒険の「修練場」（デイリーで挑めるものをここへ足していく。案山子が1つ目）
//   ・戦いは挑戦と同じ ATB（60秒・自分で技を選ぶ）。**案山子は反撃しない**（core/atb.js の idle＝ゲージが溜まらない）
//   ・**案山子は状態異常にかからない**（11-06 ユーザー「案山子は状態異常かからないように」・core/battle.js の noAil）。能力低下（デバフ）はかかる
//   ・**1日1回**（日本時間の朝5時に戻る＝挑戦と同じ v2cap_dungeon_today）。**エリア①をクリア**（①-③のボスを倒した）すると開く
//   ・EXPは**与えたダメージで増える**：同じ職・同じLVの目安の強さの人が60秒で出すダメージ（scarecrowStd.js）で「基準の量」、
//     多く削ると最大1.5倍・少ないと最低0.5倍。基準の量は**出撃30回ぶん**（そのLVの推奨の場所で30回出撃したくらい＝areas.js の tenSortieExpOf×3）
//     ＝デイリーミッション1つ（10回ぶん）の3倍・四凶1体（25回ぶん）より少し多い
//   ・見た目は訓練場の藁人形（ユーザーが描く立ち絵と背景の2枚・lib/scarecrowArt.js）
// ★ダメージはサーバーが同じ戦闘を回し直して決める（挑戦と同じ・lib/dungeonVerify.js の形をそのまま使う）。EXPを入れるのは SQL の v2cap_scarecrow_verify_settle
//   ⚠数（60秒・30回ぶん・50〜150%・解禁の場所）は SQL と同じ（scarecrow.test.js が突き合わせる）
// ============================================================
import { STEP_SEC, createAtb, replayInputs, seedRng } from '../core/atb.js'
import { statsOf } from '../core/enemies.js'
import { CAP_RULES } from './rules.js'
import { atbPlayerOf } from './atbPlayer.js'
import { activeMealOf } from './burger.js'
import { NORMAL_RATIO, stdPowerAt, tenSortieExpOf } from './areas.js'
import { allowedSteps, validInputs } from './dungeonVerify.js'
import { SCARECROW_STD } from './scarecrowStd.js'

import {
  SCARECROW_NAME, SCARECROW_SEC, SCARECROW_UNLOCK_SPOT, SCARECROW_EXP_SORTIES, SCARECROW_PCT_MIN, SCARECROW_PCT_MAX, isScarecrowOpen,
} from './scarecrowRules.js'

// 数と開く条件は scarecrowRules.js（ホームのメニューも読む）
export { SCARECROW_NAME, SCARECROW_SEC, SCARECROW_UNLOCK_SPOT, SCARECROW_EXP_SORTIES, SCARECROW_PCT_MIN, SCARECROW_PCT_MAX, isScarecrowOpen }
export const SCARECROW_STEPS = Math.round(SCARECROW_SEC / STEP_SEC)
// 案山子のHP：60秒では削りきれない量（バーはほとんど減らない＝倒れない）
export const SCARECROW_HP = 999999999

// 案山子の守り：そのLVのふつうの敵と同じ強さ（同じLVのプレイヤーの目安の0.6倍・areas.js の NORMAL_RATIO）。
//   配分は守りと速さだけ使う（攻めない）。避けにくいように AGI は小さく
const DIST = { hp: 34, mp: 6, str: 12, dex: 12, agi: 4, int_stat: 14, vit: 14, luk: 4 }
export const scarecrowPowerOf = (lv) => Math.max(1, Math.round(stdPowerAt(Math.max(1, lv || 1)) * NORMAL_RATIO))
export const scarecrowFighter = (lv) => {
  const stats = statsOf({ power: scarecrowPowerOf(lv), dist: DIST })
  stats.hp = SCARECROW_HP
  return { ...CAP_RULES, name: SCARECROW_NAME, kind: 'phys', race: null, stats, slots: [], taken: null, idle: true, noAil: true }
}

// 戦闘を作る。seed・snap は v2cap_scarecrow_start の返事（画面）か、サーバーが預かった同じ値（回し直し）。
//   snap＝{ prof, inv, at }（挑戦と同じ v2cap_battle_snap）。案山子の強さは写したときのLV。薬は持ちこまない
export const startScarecrowAtb = ({ seed, snap }) => {
  const at = new Date(Number(snap.at))
  const me = atbPlayerOf(snap.prof, snap.inv, { meal: activeMealOf(snap.prof, at), at })
  return createAtb(me, scarecrowFighter(snap.prof?.lv), { maxSec: SCARECROW_SEC, rng: seedRng(seed) })
}
// 与えたダメージ（画面の申告もサーバーの計算も、この形で数える）
export const scarecrowDamageOf = (st) => Math.floor(Math.max(0, st.b.startHp - Math.max(0, st.b.hp)))

// ===== EXP =====
// 同じ職・同じLVの目安の人が60秒で出すダメージ（scarecrowStd.js：全職のまんなか（a×案山子の守りの戦闘力^b を LV ごとに整数にした表）×職の係数）
//   ★累乗はここで計算しない（回し直しのコードは機種で結果が変わりうる計算を使わない・dungeonVerify.test.js）
export const SCARECROW_MAX_LV = 100
export const stdDamageOf = (cls, lv) => {
  const l = Math.min(SCARECROW_MAX_LV, Math.max(1, Math.floor(Number(lv) || 1)))
  return Math.max(1, Math.round((SCARECROW_STD.std?.[l - 1] || 1) * (SCARECROW_STD.cls[cls] ?? 1)))
}
// EXPの割合（%・整数）：目安と同じで100・多く削ると150まで・少ないと50まで
export const scarecrowPctOf = (damage, cls, lv) =>
  Math.max(SCARECROW_PCT_MIN, Math.min(SCARECROW_PCT_MAX, Math.round((Math.max(0, Number(damage) || 0) * 100) / stdDamageOf(cls, lv))))
// 入るEXP（V1からの引き継ぎの倍率は掛ける前＝サーバーの v2cap_apply_exp が掛ける）。SQL の v2cap_scarecrow_exp と同じ
export const scarecrowExpOf = (lv, pct) => Math.ceil(tenSortieExpOf(Math.max(1, lv || 1)) * (SCARECROW_EXP_SORTIES / 10) * pct / 100)

// ===== 回し直し（Vercel の関数・lib/dungeonVerifyApi.js）=====
// 返すのは { damage, pct, steps, reason（おかしかったわけ・無ければ null）}。elapsedSec はサーバーの時計（始めてから記録が届くまで）
export const verifyScarecrow = ({ seed, snap, inputs, endStep, elapsedSec }) => {
  if (!validInputs(inputs)) return { damage: 0, pct: SCARECROW_PCT_MIN, steps: 0, reason: 'inputs' }
  const st = startScarecrowAtb({ seed, snap })
  const want = Number.isInteger(endStep) && endStep >= 0 ? Math.min(endStep, SCARECROW_STEPS) : 0
  const limit = allowedSteps(elapsedSec)
  replayInputs(st, inputs, Math.min(want, limit))
  const damage = scarecrowDamageOf(st)
  return { damage, pct: scarecrowPctOf(damage, snap.prof?.class, snap.prof?.lv), steps: st.steps, reason: want > limit ? 'too_fast' : null }
}
