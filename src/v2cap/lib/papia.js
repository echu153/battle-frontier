// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— パピア
// ------------------------------------------------------------
// 【確定】2026-10-30 ユーザー指示「V1にいたパピアを実装したい、エリアによって出るパピアが異なる、ちびパピア パピア キングパピア で、イラストも一新する」
//   ユーザーが選んだこと（測った数字を見て・tools/v2cap-progress.mjs --papia）：
//   ・エリア1〜5＝ちびパピア／6〜10＝パピア／11〜15＝キングパピア
//   ・HP 2／3／5・倒したときのEXP＝場所の表の値×10／×15／×40（6ターンで倒せる割合はおよそ 86%／66%／21%）
//   ・ボスの抽選のあと、1戦ごとに1%で出会う（V1と同じ）
//   ・V1の「パピア専用スキルセット」「出現率アップの時間帯」は入れない
//   V1（src/pages/Game.jsx の PAPIA）と同じ動き：
//   ・どんな攻撃も1発につき1ダメージ（連撃は当たった数だけ）・回避50%・状態異常と能力低下は効かない
//   ・こちらを攻撃しない。6ターン目に逃げる
//   ・Goldと装備（と宝箱）は無し
// こちらで決めた細部：
//   ・逃げられたら負けと同じ扱い＝その場所の最低EXP（V1は0。v2cap は「負けても最低値は入る」の決まりにそろえた）
//   ・ボスの出やすさは、ふつうの敵と同じく+0.3%。デイリーミッションの「出撃に勝つ」にも数える
//   ★エリアの一覧（図鑑の15×20体）には入れない（安息の祠のハピネスフェアリーと同じ特別なモンスター）。絵は public/エネミー/特別/<名前>.png
// ★決めるのはサーバー（supabase_v2cap_core.sql の v2cap_sortie_settle）。ここは画面とシミュレーションのための写し
//   ⚠数を変えたら SQL の v_ptenths の所も直す（v2capsql.test.js が突き合わせる）
// ============================================================
import { CAP_RULES } from './rules.js'
import { raceOf } from './monsterRace.js'

export const PAPIA_TIERS = [
  { name:'ちびパピア',   areas:[1, 5],   hp:2, tenths:100 },
  { name:'パピア',       areas:[6, 10],  hp:3, tenths:150 },
  { name:'キングパピア', areas:[11, 15], hp:5, tenths:400 },
]
export const PAPIA_ROLE = 'papia'
export const PAPIA_EVA = 50      // 回避率（%・V1と同じ）
export const PAPIA_TURNS = 6     // このターンにこちらが動いたあと逃げる（V1と同じ）
// ボスでなかった1戦ごとに出会う確率（%）。let なのは tools/v2cap-progress.mjs が測るときに差し替えるため（ゲームの中では変えない）
export let PAPIA_PCT = 1
export const setPapiaPctForTuning = (v) => { PAPIA_PCT = v }

// 開発用「次の出撃でパピア」（V2capHome の開発用ボタン・画面だけの印。サーバーはパピアの申告をそのまま通すので印は要らない）
let forceNext = false
export const forcePapiaNext = () => { forceNext = true }
export const isPapiaForced = () => forceNext
export const takePapiaForce = () => { const f = forceNext; forceNext = false; return f }

export const papiaTierOf = (area) => PAPIA_TIERS.find(t => area >= t.areas[0] && area <= t.areas[1]) || null
// その場所で出会うパピア（pickEncounter が使う・顔ぶれの敵と同じく spot を持つ）
export const papiaEnemyOf = (spot) => {
  const t = papiaTierOf(spot?.area)
  return t ? { name: t.name, kind: 'phys', spot: spot.id, papia: { hp: t.hp, eva: PAPIA_EVA, tenths: t.tenths } } : null
}

// 1戦ごとのターンの行（V1の PAPIA_TURNS と同じ言葉）。主語の名前だけ入れ替える
export const papiaLinesOf = (name) => [
  `${name}は驚いている`,
  `${name}はあたふたしている`,
  '逃走準備',
  '次のターン逃げられそうだ',
  'ああ、逃げられる！',
  `逃走！ ${name}は逃げた！`,
]

// 戦闘用（areas.js の toFighter が呼ぶ）。HPだけが意味を持つ。AGIは桁外れ（V1と同じ・こちらの追加行動は出ない）。
//   行動はいつもこちらが先（battle.js の runBattle）
export const papiaFighterOf = (enemy) => ({
  ...CAP_RULES,
  defRule: 'papia',   // 回避率は下の eva そのまま（combat.js の evasionRate）
  name: enemy.name,
  kind: 'phys',
  race: raceOf(enemy.name),
  stats: { hp: enemy.papia.hp, mp: 0, str: 1, dex: 1, agi: 10000, int_stat: 1, vit: 1, luk: 1 },
  slots: [],
  taken: null,
  papia: { eva: enemy.papia.eva, turns: PAPIA_TURNS, lines: papiaLinesOf(enemy.name) },
})
