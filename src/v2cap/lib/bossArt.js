// ============================================================
// 「レベルキャップあり」版（v2cap）— ダンジョンのボスのドット絵（ATB戦闘の待機・技ごとの攻撃）と遭遇のイラスト
// ------------------------------------------------------------
// 【確定】2026-10-28 ユーザー指示「先にヴァルゼノクのイラストとドット絵モーション作りたい」
//   「ドット絵戦闘時のモーションでは常に羽ばたいてるモーションで、攻撃モーションはスキルによって色々変えたい」
//   ＋技の案「この技の案で絵を作り始める」（黒爪・焦熱の吐息・黒翼烈風・終焉の黒焔）→ ユーザーが ChatGPT で作って置いた。
//   元の絵（ユーザーが置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/
//     イラスト.png … 遭遇のイラスト（透明な背景）
//     待機.png     … 3列×2段の6コマ・ずっと羽ばたく（⑥のあと①へつながる）・真緑の背景・左向き
//     <技の名前>.png … 3列×2段の6コマ（①待機 → ②〜⑤技 → ⑥待機）・攻撃は左へ
//   画面で使う版（tools/v2cap-boss-art.mjs が作る）：public/v2cap-art/boss/<key>-<動き>.webp
//     idle  … 待機の6コマをくり返す動くWebP（<img> だけで羽ばたく）。大きさ base×base
//     <技>  … ②〜⑤のコマを横に並べた1枚（クラスの攻撃の絵と同じ形・lib/motionArt.js）。
//              ox・oy は待機の枠の左上が1コマの中のどこにあるか（はみ出す炎や爆発のぶん）
//     illust … 遭遇のイラスト（正方形）
//   一覧（コマの数・大きさ・速さ）は bossArtList.js（道具が書く・手で直さない）
// ★コマの位置は元の絵のマス（512×512）の中の位置のまま使う＝ChatGPT がどのマスにも同じ位置に描いていて、
//   羽ばたきに合わせた上下の揺れもそのまま残る（2026-10-28 6枚で測った：どのマスも体は x20〜515・y5〜495）
// ============================================================
import { BOSS_ART } from './bossArtList.js'

export const BOSS_ART_SRC_DIR = 'IDダンジョン'   // public/エネミー の下（ENEMY_ART_SRC_DIR）・元の絵。敵の絵の道具はここを読まない
export const BOSS_ART_DIR = '/v2cap-art/boss'
export const BOSS_SHEET_COLS = 3
export const BOSS_SHEET_ROWS = 2
export const BOSS_ILLUST_SIZE = 768

// ボスごとの決まり。dir＝元の絵のフォルダ（ユーザーが付けた名前）
//   motions … 技の元の絵の名前 → キー・1コマの長さ（②〜⑤・ミリ秒）。当たるのはどれも④（3つ目のコマ）
export const BOSS_DEFS = {
  varuzenoku: {
    name: '黒龍ヴァルゼノク', dir: 'ヴォルザノク',
    idleMs: 130,
    noGreen: true,   // 緑の無い竜。背景の緑が映り込んだ煙・風を緑の無い色にする（2026-10-28 黒翼烈風・終焉の黒焔の煙が緑がかっていた）
    motions: [
      { file: '黒爪', key: 'claw', ms: [110, 110, 200, 140] },
      { file: '焦熱の吐息', key: 'breath', ms: [160, 200, 320, 220] },
      { file: '黒翼烈風', key: 'gale', ms: [150, 180, 300, 220] },
      { file: '終焉の黒焔', key: 'doom', ms: [220, 320, 420, 320] },
    ],
  },
}
export const BOSS_HIT_FRAME = 2
export const bossKeyOfName = (name) => Object.keys(BOSS_DEFS).find(k => BOSS_DEFS[k].name === name) || null

export const bossFileOf = (key, kind) => `${key}-${kind}.webp`
export const bossSrcOf = (key, kind) => `${BOSS_ART_DIR}/${bossFileOf(key, kind)}`

// 画面で使う形（無ければ null）
//   { name, base, idle:{ src, frames, ms }, illust, motions:{ <key>: lib/motionArt.js の motionOf と同じ形＋label } }
export const bossArtOf = (key) => {
  const def = BOSS_DEFS[key], art = BOSS_ART[key]
  if (!def || !art?.idle) return null
  const motions = {}
  for (const m of def.motions) {
    const e = art.motions?.[m.key]
    if (!e) continue
    const totalMs = e.ms.reduce((s, v) => s + v, 0)
    const hitMs = e.ms.slice(0, e.hit).reduce((s, v) => s + v, 0)
    motions[m.key] = { ...e, base: art.base, src: bossSrcOf(key, m.key), totalMs, hitMs, label: m.file }
  }
  return {
    key, name: def.name, base: art.base,
    idle: { ...art.idle, src: bossSrcOf(key, 'idle') },
    illust: art.illust ? bossSrcOf(key, 'illust') : null,
    motions,
  }
}

// 戦闘の「動いた」（lib/atbFx.js の act）に、どの技の絵を流すか。
//   ★仮（2026-10-28）：ボスの技はまだ作っていない（ノーマルの中身は絵のあと）ので、試し撃ちでは
//     通常攻撃＝黒爪／構えてから撃った大技＝終焉の黒焔／ほかの技＝焦熱の吐息と黒翼烈風を交互、で見せる。
//     技を作ったら、技の名前 → 絵 にする（名前が絵の元の名前と同じなら、それを流す）
//   memo … 戦闘ごとの覚え書き { casts:Set（構えた技の名前）, n（交互の番） }
export const newBossMotionMemo = () => ({ casts: new Set(), n: 0 })
export const bossMotionKeyOf = (key, ev, memo) => {
  const def = BOSS_DEFS[key]
  if (!def) return null
  const byName = def.motions.find(m => m.file === ev.skill)
  if (byName) return byName.key
  if (!ev.skill) return def.motions[0].key
  if (memo.casts.has(ev.skill)) return def.motions.at(-1).key
  const mid = def.motions.slice(1, -1)
  if (!mid.length) return def.motions[0].key
  return mid[memo.n++ % mid.length].key
}
