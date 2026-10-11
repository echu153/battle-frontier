// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— モンスターのイラスト
// ------------------------------------------------------------
// 【確定】2026-10-12 ユーザー指示「V2capではモンスター全てにイラストを設定する。public/エネミー に画像を入れていくから、反映していって」
//   ・元の絵：public/エネミー/エリア<番号>/<モンスターの名前>.png（ユーザーが置く。灰色の背景つき・1254×1254）
//     ⚠元の絵は git に入れない（.gitignore）。300枚そろうと約500MBになり、毎回の公開に全部載ってしまうため。
//       画面で使う軽い版（下）だけを入れる。元の絵はユーザーのPCにだけある
//   ・画面で使う版：public/enemy-art/<id>.webp（灰色の背景を抜いて、体がちょうど収まる正方形・192×192）
//     作るのは `node tools/v2cap-enemy-art.mjs`。作れたモンスターの一覧は enemyArtList.js（ツールが書く・手で直さない）
//   ・<id> はモンスターの名前から決まる英数字（enemyArtId）。名前を変えたら絵も作り直しになる
// ファイル名の読み方：
//   ・ひらがな／カタカナ・全角／半角・記号の違いは見ない（「つるへび.png」→ つるヘビ、「ヒナタトカゲ.png」→ ひなたトカゲ）
//   ・それでも名前にならないもの（ローマ字・当て字・打ち間違い）は下の ENEMY_ART_ALIAS で結びつける。
//     ツールが「どのモンスターにも当てはまらない絵」を知らせるので、そのときにここへ足す
// ★絵の無いモンスターは、画面では名前の1文字目を入れた枠で代わりに出す（V2capLogLine）
// ============================================================
import { AREA_ROSTERS } from './monsters.js'
import { ENEMY_ART_IDS } from './enemyArtList.js'

export const ENEMY_ART_SRC_DIR = 'エネミー'     // public の下・元の絵
export const ENEMY_ART_DIR = '/enemy-art'      // public の下・画面で使う版
export const ENEMY_ART_SIZE = 192

// ファイル名（拡張子なし・ユーザーが付けたまま）→ モンスターの名前
// 【確定】2026-10-12 エリア①の20枚（絵を見て確かめた）
export const ENEMY_ART_ALIAS = {
  'hinataageha':    'ひなたアゲハ',
  'sannriza-do':    'サンリザード',
  'yonakikoorogi[': 'ヨナキコオロギ',
  '梅雨フェアリー': 'ツユフェアリー',
  'ツキミミミズク': 'ツキミミズク',   // ミが1つ多い
}

// エリアごとのモンスターの名前（並び＝monsters.js の一覧の順）
export const ENEMY_NAMES_BY_AREA = AREA_ROSTERS.map(a => [...a.normals, ...a.timed, ...a.rares, ...a.bosses].map(e => e.name))
export const ENEMY_NAMES = ENEMY_NAMES_BY_AREA.flat()

// 名前の比べ方：全角半角をそろえ、カタカナをひらがなに、英字を小文字にし、文字と数字だけ残す（長音の「ー」は残す）
export const normalizeArtName = (s) => String(s ?? '')
  .normalize('NFKC')
  .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]/gu, '')

const BY_NORM = new Map(ENEMY_NAMES.map(n => [normalizeArtName(n), n]))
const ALIAS_BY_NORM = new Map(Object.entries(ENEMY_ART_ALIAS).map(([k, v]) => [normalizeArtName(k), v]))
// ファイル名（拡張子なし）→ モンスターの名前（当てはまらなければ null）
export const enemyNameOfFile = (stem) => {
  const k = normalizeArtName(stem)
  return ALIAS_BY_NORM.get(k) || BY_NORM.get(k) || null
}

// 名前 → 画面で使うファイルの名前（名前の UTF-8 の FNV-1a 32bit を16進8桁）。同じ名前なら必ず同じ
export const enemyArtId = (name) => {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(String(name))) { h ^= b; h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export const hasEnemyArt = (name) => !!ENEMY_ART_IDS[name]
// 画面で使う絵の場所（無ければ null）
export const enemyArtSrc = (name) => {
  const id = ENEMY_ART_IDS[name]
  return id ? `${ENEMY_ART_DIR}/${id}.webp` : null
}
