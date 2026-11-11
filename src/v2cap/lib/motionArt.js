// ============================================================
// 「レベルキャップあり」版（v2cap）— クラスのモーションのドット絵（ATB戦闘の攻撃など）
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「攻撃モーションもドット絵で作ろうと思ってる」→ ChatGPT で作る（ユーザー）。
//   元の絵（ユーザーが置く）：public/V2newjob/攻撃モーション/<クラス名><男|女><動き>.png（.webp も可）（2026-10-26 ユーザー指示「ここに保管する」）
//     ＝横一列に6コマ（①待機 → ②構え → ③振りかぶり → ④攻撃 → ⑤振り抜き → ⑥待機）・背景は真緑（#00FF00）
//   画面で使う版（tools/v2cap-motion.mjs が作る）：public/V2newjob/motion/<ローマ字>-<m|f>-<動きのキー>.webp
//     ＝②〜⑤のコマを横に並べた1枚（透明つき）。どのコマも待機GIFと同じ大きさ・同じ足の位置にそろえてある
//     （①⑥は待機GIFと少し違う絵なので使わない＝切り替わるとき絵が変わって見えるため。大きさをそろえる目安にだけ使う）
//   一覧（コマの数・大きさ・速さ）は motionArtList.js（道具が書く・手で直さない）
// ★待機GIF（classArt.js の gifSrcOf）と組で使う。上位クラスで待機GIFが系統の初期クラスのものなら、モーションもそのクラスのもの
// ============================================================
import { MOTION_ART } from './motionArtList.js'
import { ART_BASE, ART_DIR, gifSrcOf } from './classArt.js'

export const MOTION_SRC_DIR = '攻撃モーション'   // public/V2newjob の下・元の絵（git に入れない・ユーザーが決めた場所）
export const MOTION_OUT = 'motion'           // public/V2newjob の下・画面で使う版
// ファイル名の動き → キー。攻撃＝通常攻撃（技の種類の絵が無いときの代わりも）。技・被弾・倒れるは置ければ作れるが、画面ではまだ流さない
//   【確定】2026-11-11 ユーザー「ATB戦用のクラスが使うスキルのモーションを作って欲しい」→ 選択「技の種類ごと」：
//   物理・魔法・補助・回復（lib/skills.js の kind）の4つをクラス×男女ごとに描いてもらい、技の種類で流し分ける（KIND_MOTION）
//   描き方＝攻撃と同じく、待機の1コマ目1枚＋言葉で ChatGPT に頼む（頼む文は tools/v2cap-skill-motion/plan.mjs・プロンプト帳 tools/v2cap-skill-motion-book.mjs）
//   ⚠マネキン（木の人形の動きの手本）を添えるやり方は、ユーザー「クオリティ低すぎ　マネキンいらないだろ」でやめた
export const MOTION_KEYS = { 攻撃: 'attack', 物理: 'phys', 魔法: 'mag', 補助: 'buff', 回復: 'heal', 技: 'skill', 被弾: 'hurt', 倒れる: 'down' }
// 技の種類 → 流す絵のキー（前から順に、あるものを使う）。どれも無ければ今までどおり＝物理と魔法は攻撃の絵、補助は光るだけ
//   回復の絵が無いクラスは補助の絵（どちらも自分に使う技）
export const KIND_MOTION = { phys: ['phys', 'attack'], mag: ['mag', 'attack'], buff: ['buff'], heal: ['heal', 'buff'] }
export const SHEET_FRAMES = 6                // ChatGPT の1枚に並ぶコマの数
export const IDLE_SIZE = 224                 // 待機GIFの大きさ（正方形）

// 1コマの長さ（ミリ秒）と、ダメージが入るコマ（0から数える）。②〜⑤の4コマ＝構え・振りかぶり・攻撃（長め）・振り抜き
export const motionMsOf = (n) => (n === 4 ? [100, 100, 180, 120] : Array.from({ length: n }, () => 100))
export const motionHitOf = (n) => (n === 4 ? 2 : Math.floor(n * 0.6))

export const motionFileOf = (cls, g, key) => `${ART_BASE[cls]}-${g}-${key}.webp`

// 画面で使う形（無ければ null）。baseCls＝系統の初期クラス（そのクラスの待機GIFが無いとき、待機と同じくそちらを使う）
export const motionOf = (cls, gender = 'm', key = 'attack', baseCls = null) => {
  const owner = gifSrcOf(cls, gender) ? cls : (baseCls && gifSrcOf(baseCls, gender) ? baseCls : null)
  const m = owner ? MOTION_ART[owner]?.[gender]?.[key] : null
  if (!m) return null
  const totalMs = m.ms.reduce((s, v) => s + v, 0)
  const hitMs = m.ms.slice(0, m.hit).reduce((s, v) => s + v, 0)
  // 後ろに絵の中身の印（?v=）を付ける＝描き直したらアドレスが変わる（2026-10-28 サービスワーカーが古い絵を出してコマがずれた・lib/bossArt.js の bossSrcOf）
  return { ...m, src: `${ART_DIR}/${MOTION_OUT}/${motionFileOf(owner, gender, key)}${m.v ? `?v=${m.v}` : ''}`, totalMs, hitMs }
}

// 自分の絵ぜんぶ：{ attack, phys, mag, buff, heal（KIND_MOTION で代わりを入れたもの・無ければ null）, list（違う絵を1つずつ・舞台に置いておく） }
export const playerMotionsOf = (cls, gender = 'm', baseCls = null) => {
  const memo = {}
  const get = (key) => (key in memo ? memo[key] : (memo[key] = motionOf(cls, gender, key, baseCls)))
  const by = { attack: get('attack') }
  for (const [kind, keys] of Object.entries(KIND_MOTION)) by[kind] = keys.map(get).find(Boolean) || null
  const list = [...new Map(Object.values(by).filter(Boolean).map(m => [m.src, m])).values()]
  return { ...by, list }
}

// 自分（side 'a'）の動きの印（lib/atbFx.js の fxEventsOf の並び）に流す絵を付ける。kindOf＝技の名前 → 種類（lib/skills.js の kind）
//   act（通常攻撃・物理と魔法の技）… 通常攻撃は攻撃の絵・技は種類の絵
//   use（補助・回復の技）… 種類の絵があれば、その絵を流す act（still＝光る技の絵）を前に足し、光る（use）と回復の数字を
//     絵の当たるコマまで遅らせる（afterAct・scheduleFx）。防御・薬・絵の無いクラスは今までどおり光るだけ
export const withPlayerMotions = (evs, motions, kindOf) => {
  if (!motions) return evs
  return evs.flatMap(e => {
    if (e.side !== 'a') return [e]
    if (e.kind === 'act') {
      const m = (e.skill && motions[kindOf(e.skill)]) || motions.attack
      return [m ? { ...e, motion: m } : e]
    }
    const kind = e.kind === 'use' && e.skill ? kindOf(e.skill) : null
    const m = (kind === 'buff' || kind === 'heal') && motions[kind]
    return m ? [{ kind: 'act', side: 'a', skill: e.skill, motion: m, still: true }, { ...e, afterAct: true }] : [e]
  })
}

// 流しはじめてから elapsedMs のときのコマ（0から）。流し終わったら -1
export const motionFrameAt = (m, elapsedMs) => {
  if (!m || elapsedMs < 0) return -1
  let t = 0
  for (let i = 0; i < m.ms.length; i++) {
    t += m.ms[i]
    if (elapsedMs < t) return i
  }
  return -1
}
