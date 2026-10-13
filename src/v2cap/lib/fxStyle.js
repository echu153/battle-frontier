// ============================================================
// v2cap — 演出の段階と色（強化・作成・宝樹の天啓）。画面だけで使う（サーバーは関係ない）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「強化…黒い砂漠の強化みたいな演出が欲しい、強化の成否もポップアップ」
//   「作成にも演出付けてほしい（具体的な装備のアイコンはないからそれを考慮して）」
//   「ユグレシアの祈り…木に『祈る』って感じだから神から天啓をもらう感じの演出にしてほしい」（音はなし）
//   ※宝樹の祈りは最初おみくじ（箱を振る→棒→紙）にしていたが、同じ日に天啓へ作り直した
// ============================================================
import { FORTUNES } from './tree.js'
import { RARITY_COLOR } from './equipment.js'

// ===== 強化 =====
// 強化値（上がったあと）で色と派手さを変える。+10 は虹
export const ENHANCE_TIERS = [
  { min: 10, key: 'max',    color: '#ff66ff', colors: ['#ff3355', '#ffcc00', '#44ff88', '#33e0ff', '#a77bff', '#ffffff'], label: 'MAX' },
  { min: 8,  key: 'gold',   color: '#ffcc00', colors: ['#ffe680', '#ffcc00', '#ffffff'] },
  { min: 5,  key: 'purple', color: '#b388ff', colors: ['#d1b3ff', '#b388ff', '#ffffff'] },
  { min: 1,  key: 'blue',   color: '#33c5ff', colors: ['#9fe3ff', '#33c5ff', '#ffffff'] },
]
export const enhanceTierOf = (plusTo) => ENHANCE_TIERS.find(t => plusTo >= t.min) || ENHANCE_TIERS.at(-1)
// ためる時間（ms）。成功率が低いほど長く（90%で1.6秒・10%で2.4秒）
export const enhanceChargeMsOf = (rate) => 1500 + Math.max(0, Math.min(100, 100 - (Number(rate) || 0))) * 10
// 結果のポップアップの1行目（ユーザーの書き方「○○の強化に成功！ 失敗…」）
export const enhanceTitleOf = (name, success) => (success ? `${name}の強化に成功！` : `${name}の強化に失敗…`)

// ===== 作成（鍛冶）=====
// 作れるのはレア・エピック・レジェンダリー。色は装備の一覧と同じレア度の色。level が大きいほど派手
//   ★装備ごとの絵は無いので、形は 武器・防具・装飾品 の3種（v2capFxParts.jsx の GearGlyph）。主役はレア度の色と名前
export const CRAFT_TIERS = {
  R: { level: 1, color: RARITY_COLOR.R, colors: ['#9fd0ff', RARITY_COLOR.R, '#ffffff'] },
  E: { level: 2, color: RARITY_COLOR.E, colors: ['#e2b8ff', RARITY_COLOR.E, '#ffffff'] },
  L: { level: 3, color: RARITY_COLOR.L, colors: ['#fff3a0', RARITY_COLOR.L, '#ffffff', '#ffb300'] },
}
export const craftTierOf = (rarity) => CRAFT_TIERS[rarity] || CRAFT_TIERS.R
export const CRAFT_STRIKES = 3                 // 金槌で打つ回数
export const craftTitleOf = (name) => `${name}を作成しました！`

// ===== 宝樹の祈り＝天啓 =====
// 祈る（光の粒が宝樹へ昇る）→ 天から光が降りる → 運勢が「天啓」として現れる。運勢ごとの光
//   level：大吉5 … 末吉1・凶-1・大凶-2。beam＝降りる光の色・glow＝宝樹と文字の光・fall＝降るもの・feathers＝羽根の数
//   凶と大凶は光が弱くまたたいて消える（flicker）・もや。大凶は暗雲と稲光（storm）
export const REVELATION_STYLE = {
  大吉: { level: 5, beam: '#fff1b8', glow: '#ffcc00', fall: { shape: 'leaf', colors: ['#ffd75e', '#ffe9a0', '#f5b800'] }, feathers: 40, burst: ['#ffe680', '#ffffff', '#ffcc00'] },
  中吉: { level: 4, beam: '#ffe2bd', glow: '#ffaa44', fall: { shape: 'leaf', colors: ['#ffc06b', '#ffe0a8'] }, feathers: 24, burst: ['#ffd08a', '#ffffff'] },
  小吉: { level: 3, beam: '#dcffe8', glow: '#88ddaa', fall: { shape: 'leaf', colors: ['#7ad99a', '#a8e6b8'] }, feathers: 14, burst: ['#a8f0c0', '#ffffff'] },
  吉:   { level: 2, beam: '#e2f2ff', glow: '#88ccff', fall: { shape: 'leaf', colors: ['#6fcf8f'] }, feathers: 8, burst: ['#b8e2ff', '#ffffff'] },
  末吉: { level: 1, beam: '#cdd7ee', glow: '#7f95c4', fall: null, feathers: 4, burst: null },
  凶:   { level: -1, beam: '#b48ad8', glow: '#aa77cc', mist: ['rgba(140,95,185,0.32)', 'rgba(90,55,140,0.36)'], flicker: true },
  大凶: { level: -2, beam: '#a0304a', glow: '#ff6666', mist: ['rgba(160,45,95,0.34)', 'rgba(95,35,130,0.38)'], flicker: true, storm: true },
}
export const revelationStyleOf = (name) => REVELATION_STYLE[name] || REVELATION_STYLE.吉
// 宝樹の絵。【確定】2026-10-13 ユーザーが用意した絵（空・山・湖まで入った1枚の景色 1672×941）＝天啓の場面の背景にする。
//   null にすると影絵（V2capRevelationFx.jsx の SacredTree）に戻る
export const TREE_ART = '/v2cap-art/yugresia-tree.webp'
// 背景の絵の明るさ。祈っている間は夜の暗さ → 光が降りると少し明るく → 天啓は運勢しだい（大吉がいちばん明るい・凶は青白く・大凶は赤黒く）
export const ART_PRAY = { b: 0.36, s: 0.7, h: 0 }
export const ART_DESCEND = { b: 0.58, s: 0.85, h: 0 }
export const ART_BY_FORTUNE = {
  大吉: { b: 1.12, s: 1.15, h: 0 }, 中吉: { b: 1.0, s: 1.05, h: 0 }, 小吉: { b: 0.9, s: 1.0, h: 0 }, 吉: { b: 0.82, s: 0.95, h: 0 },
  末吉: { b: 0.66, s: 0.8, h: 0 }, 凶: { b: 0.42, s: 0.4, h: 200 }, 大凶: { b: 0.26, s: 0.35, h: 300 },
}
export const artFilterOf = (a) => `brightness(${a.b}) saturate(${a.s})${a.h ? ` hue-rotate(${a.h}deg)` : ''}`
export const FORTUNE_NAMES = FORTUNES.map(f => f.name)

// ===== 安息の祠（2026-10-13）=====
// 【確定】ユーザー指示「最深部に到達した！　スタミナが全回復した！　って表示される演出が欲しい ※暗転後に泉が見えるような演出がいいかなー」
//   絵はユーザーが用意した2枚（public/V2ホーム の 安息の祠.png・安息の祠泉.png → 画面で使う WebP・まわりは透明）。
//   泉＝最深部の演出（V2capShrineFx.jsx の deepest）。入口＝見つけたときの演出（found）と、祠にいる間の出撃の欄
export const SHRINE_ART = '/v2cap-art/shrine.webp'
export const SPRING_ART = '/v2cap-art/shrine-spring.webp'
export const SHRINE_TEXT = { found: '安息の祠を見つけた！', deepest: '最深部に到達した！', healed: 'スタミナが全回復した！' }
// 絵の中の場所（絵の幅・高さに対する割合）：入口の奥・泉の水面・天井の光
export const SHRINE_DOOR = { x: 0.5, y: 0.6 }
export const SPRING_POOL = { x: 0.5, y: 0.7 }
export const SPRING_LIGHT = { x: 0.52, y: 0.02 }

// ===== 宝樹の画面（祈る前・祈ったあと）=====
// 【確定】2026-10-13 ユーザー指示「ユグレシアの宝樹、今こんな感じでパッとしないから、良い感じにしてほしい」：
//   画面の上に宝樹の絵（TREE_ART）を大きく敷く。今日の運勢で絵の明るさを変える＝天啓の ART_BY_FORTUNE を半分だけ効かせる
//   （画面は読み物なので暗くしすぎない・色相は回さない＝凶と大凶は上に紫／赤黒の色を重ねる）。まだ祈っていない日は STAGE_IDLE
export const MINCHO = "'Yu Mincho','YuMincho','Hiragino Mincho ProN','Noto Serif JP','MS PMincho',serif"
export const STAGE_IDLE = { b: 0.95, s: 1.05, h: 0 }
const half = (v) => Math.round((0.5 + v * 0.5) * 100) / 100
export const stageArtOf = (fortune) => {
  const a = ART_BY_FORTUNE[fortune]
  return a ? { b: half(a.b), s: half(a.s), h: 0 } : STAGE_IDLE
}
