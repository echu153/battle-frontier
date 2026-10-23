// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 戦闘ログのバフ・デバフ・状態異常のアイコン
// ------------------------------------------------------------
// 【確定】2026-10-24 ユーザー指示（戦闘ログの HP の表のスクショを見せて）
//   「戦闘時、バフデバフ、状態異常のアイコンをこのログに見えるようにしたい」
//   「ステータスのバフデバフはどのくらい上昇してるのかもわかるように。例 STR↑〇％ みたいなのをアイコン内に表示させてほしい」
//   ・HP の表（◯ターン・決着）の HP バーの下に、そのときかかっている効果を並べる
//   ・ステ … 上がる・下がるで同じ絵。色（上がる＝だいだい・下がる＝青）と「STR」「↑25%」の文字は画面で重ねる
//   ・状態異常 … 右下に残りターン（出血はスタック数）
//   ・そのほかの効果 … HP継続回復・MP継続回復・バリア（残りの量）・被ダメージ軽減（%）・状態異常無効・能力低下無効・吸収（%）
//   ・絵はユーザーが ChatGPT で作る（透明な背景の紋章だけ・文字なし）。枠と下地の色は画面で描く＝絵ごとのばらつきが目立たない
//     元の絵：public/状態アイコン/<file>.png（file は下の一覧）→ `node tools/v2cap-fx-art.mjs` で public/fx-art/<id>.webp
//     作れた絵の一覧は fxArtList.js（ツールが書く・手で直さない）。**絵が無いものは文字の枠で代わりに出す**
//   中身（どの効果がかかっているか）は戦闘エンジンの fxOf（src/v2cap/core/battle.js）
// ============================================================
import { STAT_DEFS } from '../core/stats.js'
import { AIL_LABEL } from '../core/ailments.js'
import { FX_STAT_KEYS } from '../core/battle.js'
import { FX_ART_IDS } from './fxArtList.js'

export const FX_ART_SRC_DIR = '状態アイコン'   // public の下・元の絵（ユーザーが置く）
export const FX_ART_DIR = '/fx-art'           // public の下・画面で使う版
export const FX_ART_SIZE = 96                 // 画面では34px。スマホの高精細でもぼやけないように大きめに持つ

// 上がる・下がるの色（枠・文字・下地）
export const FX_UP = { ring: '#ffaa44', text: '#ffd28a', bg: '#7a3010' }
export const FX_DOWN = { ring: '#5aa8ff', text: '#a8d2ff', bg: '#17407a' }

// 状態異常（並び＝ailments.js の AIL_KEYS）。short は絵が無いときの文字
const AIL_DEFS = {
  bleed:    { color: '#d83a3a', short: '出血' },
  poison:   { color: '#a35ad8', short: '毒' },
  slow:     { color: '#3fb8a8', short: '鈍足' },
  paralyze: { color: '#e8c832', short: '麻痺' },
  healCut:  { color: '#7da04a', short: '回復阻害' },
  silence:  { color: '#8a9ab8', short: 'サイレンス' },
  blind:    { color: '#6a6a7a', short: '暗闇' },
  curse:    { color: '#8a3ab8', short: '呪い' },
  frenzy:   { color: '#e0485e', short: '狂乱' },
  weaken:   { color: '#a87a4a', short: '衰弱' },
  burn:     { color: '#ff7a2a', short: '火傷' },
  seal:     { color: '#c8a040', short: '封印' },
  fear:     { color: '#5a5ac8', short: '恐怖' },
}

// そのほかの効果（fxOf の buff の名前）
const BUFF_DEFS = {
  regen:        { label: 'HP継続回復', short: 'HP回復', color: '#44d07a' },
  mpRegen:      { label: 'MP継続回復', short: 'MP回復', color: '#4a8cff' },
  shield:       { label: 'バリア', short: 'バリア', color: '#f0d060' },
  cut:          { label: '被ダメージ軽減', short: '被ダメ', color: '#9ab4d0' },
  ailImmune:    { label: '状態異常無効', short: '異常無効', color: '#f0f0ff' },
  debuffImmune: { label: '能力低下無効', short: '低下無効', color: '#c0d8f0' },
  drain:        { label: '吸収', short: '吸収', color: '#e0406a' },
}

// アイコンの一覧（id・元の絵のファイル名・名前）。ツールと ChatGPT に頼む絵の一覧はこれ
//   ステの id は 'str' など（上がる・下がるで同じ絵）
export const FX_DEFS = [
  ...FX_STAT_KEYS.map(k => ({ id: k, group: 'st', file: STAT_DEFS[k].label, label: STAT_DEFS[k].label })),
  ...Object.entries(AIL_DEFS).map(([k, d]) => ({ id: k, group: 'ail', file: AIL_LABEL[k], label: AIL_LABEL[k], ...d })),
  ...Object.entries(BUFF_DEFS).map(([k, d]) => ({ id: k, group: 'buff', file: d.label, ...d })),
]
const DEF_BY_ID = new Map(FX_DEFS.map(d => [d.id, d]))

// 元の絵のファイル名（拡張子なし）→ id。全角半角・大文字小文字・記号の違いは見ない（「ｓｔｒ.png」「毒 .png」も読む）
const normFile = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const ID_BY_FILE = new Map(FX_DEFS.map(d => [normFile(d.file), d.id]))
export const fxIdOfFile = (name) => ID_BY_FILE.get(normFile(name)) || null

export const fxArtSrc = (id) => (FX_ART_IDS.includes(id) ? `${FX_ART_DIR}/${id}.webp` : null)

// バリアの量を短く（アイコンの中に入るように）
export const shortNum = (n) => (n >= 100000 ? `${Math.floor(n / 10000)}万` : n >= 10000 ? `${(Math.floor(n / 1000) / 10).toFixed(1)}万` : n.toLocaleString())

// fxOf の中身 → 画面に並べるアイコン（上から：上がったステ・そのほかの効果・下がったステ・状態異常）
//   { id, kind:'up'|'down'|'ail'|'buff', art, top（上の文字）, bottom（下の文字）, corner（右下の数）, short（絵が無いときの文字）, color, title }
export const fxIconsOf = (fx) => {
  if (!fx) return []
  const ups = [], downs = [], buffs = [], ails = []
  for (const k of FX_STAT_KEYS) {
    const v = fx.st?.[k]
    if (!v) continue
    const label = STAT_DEFS[k].label
    const arrow = v > 0 ? '↑' : '↓'
    const icon = { id: k, kind: v > 0 ? 'up' : 'down', art: fxArtSrc(k), top: label, bottom: `${arrow}${Math.abs(v)}%`, title: `${label}${arrow}${Math.abs(v)}%` }
    ;(v > 0 ? ups : downs).push(icon)
  }
  for (const [k, b] of Object.entries(fx.buff || {})) {
    const d = BUFF_DEFS[k]
    if (!d) continue
    const bottom = k === 'shield' ? shortNum(b.v || 0) : k === 'cut' ? `↓${b.v}%` : k === 'drain' ? `${b.v}%` : null
    const rest = b.t > 0 ? `（あと${b.t}ターン）` : ''
    const amount = k === 'shield' ? ` ${(b.v || 0).toLocaleString()}` : k === 'cut' ? ` −${b.v}%` : k === 'drain' ? ` ${b.v}%` : ''
    buffs.push({ id: k, kind: 'buff', art: fxArtSrc(k), short: d.short, color: d.color, bottom,
      corner: bottom ? null : (b.t > 0 ? String(b.t) : null), title: `${d.label}${amount}${rest}` })
  }
  for (const [k, n] of Object.entries(fx.ail || {})) {
    const d = DEF_BY_ID.get(k)
    if (!d) continue
    const bleed = k === 'bleed'
    ails.push({ id: k, kind: 'ail', art: fxArtSrc(k), short: d.short, color: d.color,
      corner: bleed ? `×${n}` : String(n), title: bleed ? `${d.label}（${n}スタック）` : `${d.label}（あと${n}ターン）` })
  }
  return [...ups, ...buffs, ...downs, ...ails]
}
