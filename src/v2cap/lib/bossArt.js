// ============================================================
// 「レベルキャップあり」版（v2cap）— ダンジョンのボスのドット絵（ATB戦闘の待機・技ごとの攻撃）と遭遇のイラスト
// ------------------------------------------------------------
// 【確定】2026-10-28 ユーザー指示「先にヴァルゼノクのイラストとドット絵モーション作りたい」
//   「ドット絵戦闘時のモーションでは常に羽ばたいてるモーションで、攻撃モーションはスキルによって色々変えたい」
//   ＋技の案「この技の案で絵を作り始める」（黒爪・焦熱の吐息・黒翼烈風・終焉の黒焔）→ ユーザーが ChatGPT で作って置いた。
//   ★2026-10-28 竜の見せ方を2通り作って比べる（ユーザー「グラブルの戦闘みたいにどんと大きく、イラストで」→「イラスト＋パーツで行きたい」
//     →「今のドット絵VERも試したいから、それぞれ分けて作れるようにして」）：
//     ドット絵版＝このファイルの決まり（下のフォルダの直下）／イラスト版＝フォルダの中の「イラスト版」（立ち絵・パーツ4枚・塗りのエフェクト。
//     画面に入れるのはパーツが届いてから）。遭遇のイラストは2つで共通。プロンプトは制作帳 https://claude.ai/artifact/TGEALMhbHoSS7XRiv7R7Y6
//   元の絵（ユーザーが置く・git に入れない）：public/エネミー/IDダンジョン/<フォルダ>/
//     イラスト.png … 遭遇のイラスト（透明な背景）
//     待機.png     … 2段に並べたコマ・ずっと羽ばたく（最後のあと①へつながる）・真緑の背景・左向き
//     <技の名前>.png … 2段に並べたコマ（①待機 → 技 → 最後は待機に戻る）・攻撃は左へ
//     ★コマの数：はじめは3列×2段の6コマ。2026-10-28 ユーザー「もっと滑らかに動いてほしい」→選んだ「待機も技も8コマ」＝4列×2段。
//       道具は列の数を絵から数える（6コマでも8コマでも読める）
//   画面で使う版（tools/v2cap-boss-art.mjs が作る）：public/v2cap-art/boss/<key>-<動き>.webp
//     idle  … 待機のコマをくり返す動くWebP（<img> だけで羽ばたく）。大きさ base×base。1コマの長さはコマごと（idleMs）
//     <技>  … 最初と最後を除いたコマ（6コマなら②〜⑤・8コマなら②〜⑦）を横に並べた1枚（クラスの攻撃の絵と同じ形・lib/motionArt.js）。
//              ox・oy は待機の枠の左上が1コマの中のどこにあるか（はみ出す炎や爆発のぶん）
//     illust … 遭遇のイラスト（正方形）
//   一覧（コマの数・大きさ・速さ）は bossArtList.js（道具が書く・手で直さない）
// ★コマの位置は元の絵のマスの中の位置で使う。待機は体の動かない場所（idleAnchor）で①にそろえる
//   （2026-10-28 ユーザー「羽動かすときに体も揺れすぎ、ゴムみたいになってる」）。技の絵は①の竜の大きさと位置を待機の①に合わせる
//   （1枚ずつ別に作るので、竜の大きさや位置が少しずつ違う）
// ============================================================
import { BOSS_ART } from './bossArtList.js'

export const BOSS_ART_SRC_DIR = 'IDダンジョン'   // public/エネミー の下（ENEMY_ART_SRC_DIR）・元の絵。敵の絵の道具はここを読まない
export const BOSS_ART_DIR = '/v2cap-art/boss'
export const BOSS_SHEET_COLS = [3, 4]   // 3列（6コマ）か4列（8コマ）
export const BOSS_SHEET_ROWS = 2
export const BOSS_ILLUST_SIZE = 768

// ボスごとの決まり。dir＝元の絵のフォルダ（ユーザーが付けた名前）
//   idleMs  … 待機のコマの数 → 1コマずつの長さ（ミリ秒）
//   motions … 技の元の絵の名前 → キー・流すコマの数 → 1コマずつの長さ（ミリ秒）。当たるコマは BOSS_HIT_OF
export const BOSS_DEFS = {
  varuzenoku: {
    name: '黒龍ヴァルゼノク', dir: 'ヴォルザノク',
    // 【確定】2026-10-28 ユーザー「体も揺れすぎ、ゴムみたい」「今よりもう少し力強く羽ばたいてほしい」：
    //   振り下ろすコマは短く（ぐっと叩きつける）、上げきり・下ろしきりは少し長く見せる（1回約0.8〜0.9秒・前は130ミリ秒ずつ）
    //   6コマ＝①上げきり ②③振り下ろし ④下ろしきり ⑤⑥振り上げ／8コマ＝①上げきり ②③④振り下ろし ⑤下ろしきり ⑥⑦⑧振り上げ
    idleMs: { 6: [200, 90, 90, 170, 130, 130], 8: [200, 70, 70, 80, 170, 110, 110, 110] },
    // 待機のコマをそろえる、体の動かない場所（マスの中の割合）＝脚と尾（翼は上と右・頭は羽ばたきで上下する）
    idleAnchor: { x0: 0, x1: 0.7, y0: 0.55, y1: 1 },
    noGreen: true,   // 緑の無い竜。背景の緑が映り込んだ煙・風を緑の無い色にする（2026-10-28 黒翼烈風・終焉の黒焔の煙が緑がかっていた）
    motions: [
      // 8コマの流れ（制作帳のプロンプト）：②③振りかぶる・ためる → ④振り下ろし途中 → ⑤いちばん前（当たる・撃ち出す）→ ⑥余韻 → ⑦戻る
      { file: '黒爪', key: 'claw', ms: { 4: [110, 110, 200, 140], 6: [100, 100, 60, 160, 120, 100] } },
      { file: '焦熱の吐息', key: 'breath', ms: { 4: [160, 200, 320, 220], 6: [150, 200, 90, 200, 200, 120] } },
      { file: '黒翼烈風', key: 'gale', ms: { 4: [150, 180, 300, 220], 6: [140, 200, 70, 180, 160, 120] } },
      { file: '終焉の黒焔', key: 'doom', ms: { 4: [220, 320, 420, 320], 6: [200, 240, 320, 120, 240, 160] } },
    ],
    // エフェクト（2026-10-28 ユーザー「エフェクトは別に作って、しっかり敵（プレイヤー）に当たってるように見せたい」→選んだ
    //   「ChatGPT のドット絵」「飛ぶ絵＋当たる絵」）。3列×2段の6コマ。飛ぶ＝同じ場所でゆらめくくり返し（画面で相手まで動かす）・
    //   当たる＝相手の上で1回。★画面に入れるのは絵が届いてから（いまは名前だけ＝道具が「使わない絵」と言わないため）
    effects: [
      { file: '黒爪_当たる', motion: 'claw', kind: 'hit' },
      { file: '焦熱の吐息_飛ぶ', motion: 'breath', kind: 'fly' },
      { file: '焦熱の吐息_当たる', motion: 'breath', kind: 'hit' },
      { file: '黒翼烈風_飛ぶ', motion: 'gale', kind: 'fly' },
      { file: '黒翼烈風_当たる', motion: 'gale', kind: 'hit' },
      { file: '終焉の黒焔_飛ぶ', motion: 'doom', kind: 'fly' },
      { file: '終焉の黒焔_当たる', motion: 'doom', kind: 'hit' },
    ],
  },
}
// 当たる（撃ち出す）コマ（流すコマの中で0から）。6コマの絵は④＝2・8コマの絵は⑤＝3
export const BOSS_HIT_OF = { 4: 2, 6: 3 }
export const bossKeyOfName = (name) => Object.keys(BOSS_DEFS).find(k => BOSS_DEFS[k].name === name) || null

export const bossFileOf = (key, kind) => `${key}-${kind}.webp`
export const bossSrcOf = (key, kind) => `${BOSS_ART_DIR}/${bossFileOf(key, kind)}`

// 画面で使う形（無ければ null）
//   { name, base, idle:{ src, frames, ms:[…] }, illust, motions:{ <key>: lib/motionArt.js の motionOf と同じ形＋label } }
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
