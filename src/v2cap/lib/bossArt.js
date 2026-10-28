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
//     fx-<技>-fly / fx-<技>-hit … エフェクトの6コマを横に並べた1枚（元の絵は <技の名前>_飛ぶ.png・<技の名前>_当たる.png）
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
    //   当たる＝相手の上で1回。2026-10-28 7枚そろった（ユーザー「一旦ドット絵は作った、モーション作って」）
    //   size  … 竜の絵（ドットの細かさ）に比べた大きさ（道具がこの大きさに縮める）
    //   ms    … 飛ぶ＝くり返す1コマの長さ／当たる＝1コマずつの長さ
    //   flyMs … 飛ぶ絵が竜のいちばん前から自分に届くまで。ダメージの数字と揺れは届いたとき（当たる絵の出はじめ）
    effects: [
      { file: '黒爪_当たる', motion: 'claw', kind: 'hit', size: 0.62, ms: [50, 50, 60, 80, 90, 100] },
      { file: '焦熱の吐息_飛ぶ', motion: 'breath', kind: 'fly', size: 0.5, ms: 70, flyMs: 300 },
      { file: '焦熱の吐息_当たる', motion: 'breath', kind: 'hit', size: 0.7, ms: [60, 60, 80, 100, 110, 120] },
      { file: '黒翼烈風_飛ぶ', motion: 'gale', kind: 'fly', size: 0.5, ms: 70, flyMs: 360 },
      { file: '黒翼烈風_当たる', motion: 'gale', kind: 'hit', size: 0.72, ms: [60, 70, 80, 100, 110, 120] },
      { file: '終焉の黒焔_飛ぶ', motion: 'doom', kind: 'fly', size: 0.62, ms: 80, flyMs: 420 },
      { file: '終焉の黒焔_当たる', motion: 'doom', kind: 'hit', size: 0.85, ms: [70, 80, 100, 120, 140, 160] },
    ],
  },
}
// 当たる（撃ち出す）コマ（流すコマの中で0から）。6コマの絵は④＝2・8コマの絵は⑤＝3
export const BOSS_HIT_OF = { 4: 2, 6: 3 }
export const bossKeyOfName = (name) => Object.keys(BOSS_DEFS).find(k => BOSS_DEFS[k].name === name) || null

export const BOSS_FX_COLS = 3   // エフェクトは3列×2段
export const bossFileOf = (key, kind) => `${key}-${kind}.webp`
// 画面で使うアドレス。後ろに絵の中身の印（?v=・一覧の v）を付ける＝描き直したらアドレスが変わる
//   【確定】2026-10-28 サービスワーカーが古い絵をキャッシュから出し、新しい一覧の割り方で竜がずれて切れた（tools/v2cap-art-lib.mjs の versionOf）
export const bossSrcOf = (key, kind) => {
  const v = BOSS_ART[key]?.v?.[kind]
  return `${BOSS_ART_DIR}/${bossFileOf(key, kind)}${v ? `?v=${v}` : ''}`
}
export const bossFxKindOf = (motion, kind) => `fx-${motion}-${kind}`

// 画面で使う形（無ければ null）
//   { name, base, idle:{ src, frames, ms:[…] }, illust, motions:{ <key>: lib/motionArt.js の motionOf と同じ形＋label＋エフェクト } }
//   エフェクト：fx … { fly?, hit? }（どちらも { src, frames, w, h, ax, ay（飛ぶ＝先・当たる＝真ん中）, ms }・大きさは待機の枠と同じ px）
//     front … 当たるコマの竜のいちばん前（待機の枠の左上から・飛ぶ絵が出るところ）
//     impactMs … 流しはじめから自分に届くまで（飛ぶ絵があれば hitMs＋flyMs・無ければ hitMs）
export const bossArtOf = (key) => {
  const def = BOSS_DEFS[key], art = BOSS_ART[key]
  if (!def || !art?.idle) return null
  const motions = {}
  for (const m of def.motions) {
    const e = art.motions?.[m.key]
    if (!e) continue
    const totalMs = e.ms.reduce((s, v) => s + v, 0)
    const hitMs = e.ms.slice(0, e.hit).reduce((s, v) => s + v, 0)
    const fx = {}
    let flyMs = 0
    for (const d of (def.effects || []).filter(d => d.motion === m.key)) {
      const a = art.fx?.[m.key]?.[d.kind]
      if (!a) continue
      fx[d.kind] = { ...a, src: bossSrcOf(key, bossFxKindOf(m.key, d.kind)), ms: d.ms }
      if (d.kind === 'fly') flyMs = d.flyMs
    }
    motions[m.key] = { ...e, base: art.base, src: bossSrcOf(key, m.key), totalMs, hitMs, label: m.file,
      fx: fx.fly || fx.hit ? fx : null, flyMs, impactMs: hitMs + flyMs }
  }
  const idle = { ...art.idle, src: bossSrcOf(key, 'idle') }
  return {
    kind: 'pixel', key, name: def.name, base: art.base, idle,
    illust: art.illust ? bossSrcOf(key, 'illust') : null,
    motions,
    // 先に読んでおく絵（待機・技・エフェクト）
    srcs: [idle.src, ...Object.values(motions).flatMap(m => [m.src, ...Object.values(m.fx || {}).map(f => f.src)])],
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
