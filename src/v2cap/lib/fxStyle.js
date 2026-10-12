// ============================================================
// v2cap — 演出の段階と色（強化・宝樹のおみくじ）。画面だけで使う（サーバーは関係ない）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「強化…黒い砂漠の強化みたいな演出が欲しい、強化の成否もポップアップ」
//   「ユグレシアの祈りにも演出加えてほしい、結果が出る過程の、おみくじみたいな感じで」（音はなし）
// ============================================================
import { FORTUNES } from './tree.js'

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

// ===== 宝樹のおみくじ =====
// 運勢ごとの見た目。level が大きいほど派手（大吉5 … 大凶-2）
export const OMIKUJI_STYLE = {
  大吉: { level: 5, glow: '#ffcc00', fall: { shape: 'petal', colors: ['#ffd1dc', '#ffb7c5', '#ffe680'] }, burst: ['#ffe680', '#ffffff', '#ffcc00'] },
  中吉: { level: 4, glow: '#ffaa44', fall: { shape: 'petal', colors: ['#ffd1dc', '#ffb7c5'] }, burst: ['#ffd08a', '#ffffff'] },
  小吉: { level: 3, glow: '#88ddaa', fall: { shape: 'leaf', colors: ['#7ad99a', '#a8e6b8'] }, burst: ['#a8f0c0', '#ffffff'] },
  吉:   { level: 2, glow: '#88ccff', fall: { shape: 'leaf', colors: ['#6fcf8f'] }, burst: ['#b8e2ff', '#ffffff'] },
  末吉: { level: 1, glow: '#7f95c4', fall: { shape: 'leaf', colors: ['#5f9f73'] }, burst: null },
  凶:   { level: -1, glow: '#aa77cc', mist: ['rgba(140,95,185,0.32)', 'rgba(90,55,140,0.36)'] },
  大凶: { level: -2, glow: '#ff6666', mist: ['rgba(160,45,95,0.34)', 'rgba(95,35,130,0.38)'] },
}
export const omikujiStyleOf = (name) => OMIKUJI_STYLE[name] || OMIKUJI_STYLE.吉
export const OMIKUJI_FORTUNE_NAMES = FORTUNES.map(f => f.name)

// みくじ棒の番号（漢数字・1〜100）。番号は飾り（運勢はサーバーが決める）
const KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']
export const kanjiNumberOf = (n) => {
  const v = Math.max(1, Math.min(100, Math.floor(n)))
  if (v === 100) return '百'
  const t = Math.floor(v / 10), o = v % 10
  return `${t === 0 ? '' : t === 1 ? '十' : `${KANJI[t]}十`}${o === 0 ? '' : KANJI[o]}`
}
