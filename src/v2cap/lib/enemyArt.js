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
//   ・頭の番号「05-01_」（エリア-一覧の何体目）は外して読む（artFileNoOf）。【確定】2026-10-26 エリア⑤⑥から付いた。
//     番号と名前が合わないときはツールが知らせる。別名（ENEMY_ART_ALIAS）は番号を外した名前で書く
// 【確定】2026-10-30 ユーザー指示「V2からモンスターはすべて右側、プレイヤーのほうを向くからこっちから見て左向きになるようにして」：
//   モンスターの絵は全部、見ている人から見て左向き（絵を頼むプロンプトに必ず書く・右向きで届いたら左右反転してから置く）
// ★絵の無いモンスターは、画面では名前の1文字目を入れた枠で代わりに出す（V2capLogLine）
// ============================================================
import { AREA_ROSTERS, SPECIAL_ENEMIES } from './monsters.js'
import { ENEMY_ART_IDS } from './enemyArtList.js'

export const ENEMY_ART_SRC_DIR = 'エネミー'     // public の下・元の絵
export const ENEMY_ART_DIR = '/enemy-art'      // public の下・画面で使う版
export const ENEMY_ART_SIZE = 192
// 図鑑で絵をタップしたときの大きい版：public/enemy-art-big/<id>.webp（512×512・作り方は小さい版と同じ・同じツールが一緒に作る）
// 【確定】2026-10-24 ユーザー指示「モンスターのイラストタップしたらアップされるようにして」。192 を広げるとスマホでぼやけるので別に持つ。
//   タップしたときだけ読む（ふだんの画面の重さは変わらない）
export const ENEMY_ART_BIG_DIR = '/enemy-art-big'
export const ENEMY_ART_BIG_SIZE = 512

// ファイル名（拡張子なし・ユーザーが付けたまま）→ モンスターの名前
// 【確定】2026-10-12 エリア①の20枚（絵を見て確かめた）
export const ENEMY_ART_ALIAS = {
  'hinataageha':    'ひなたアゲハ',
  'sannriza-do':    'サンリザード',
  'yonakikoorogi[': 'ヨナキコオロギ',
  '梅雨フェアリー': 'ツユフェアリー',
  'ツキミミミズク': 'ツキミミズク',   // ミが1つ多い
  // 【確定】2026-10-12 エリア②（絵を見て確かめた）
  'ごぶりｎ':       'ゴブリン',         // ナイフのゴブリン（最後が全角の ｎ）
  'ゴブリン車種':   'ゴブリン射手',     // 弓のゴブリン（「しゃしゅ」の変換違い）
}

// エリアごとのモンスターの名前（並び＝monsters.js の一覧の順）
export const ENEMY_NAMES_BY_AREA = AREA_ROSTERS.map(a => [...a.normals, ...a.timed, ...a.rares, ...a.bosses].map(e => e.name))
export const ENEMY_NAMES = ENEMY_NAMES_BY_AREA.flat()
// 場所の顔ぶれにいない特別なモンスター（安息の祠のハピネスフェアリー・2026-10-13）。元の絵は public/エネミー/特別/<名前>.png
//   ★エリアの一覧（ENEMY_NAMES）には入れない（図鑑とエリアごとの数は15エリア×20体のまま）。絵を探す・一覧を書くときだけ一緒に見る
export const SPECIAL_ART_DIR = '特別'
export const SPECIAL_ENEMY_NAMES = SPECIAL_ENEMIES.map(e => e.name)
export const ART_NAMES = [...ENEMY_NAMES, ...SPECIAL_ENEMY_NAMES]

// 名前の比べ方：全角半角をそろえ、カタカナをひらがなに、英字を小文字にし、文字と数字だけ残す（長音の「ー」は残す）
export const normalizeArtName = (s) => String(s ?? '')
  .normalize('NFKC')
  .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]/gu, '')

const BY_NORM = new Map(ART_NAMES.map(n => [normalizeArtName(n), n]))
const ALIAS_BY_NORM = new Map(Object.entries(ENEMY_ART_ALIAS).map(([k, v]) => [normalizeArtName(k), v]))
// ファイル名の頭の番号「05-01_砂喰いワーム」→ { area: 5, index: 1, rest: '砂喰いワーム' }（番号が無ければ null）。全角の数字・記号も読む
export const artFileNoOf = (stem) => {
  const s = String(stem ?? '').normalize('NFKC')
  const m = s.match(/^([0-9]{1,2})[-_ ]+([0-9]{1,2})[-_ ]+/)
  return m ? { area: Number(m[1]), index: Number(m[2]), rest: s.slice(m[0].length) } : null
}
// ファイル名（拡張子なし）→ モンスターの名前（当てはまらなければ null）
export const enemyNameOfFile = (stem) => {
  const no = artFileNoOf(stem)
  const k = normalizeArtName(no ? no.rest : stem)
  return ALIAS_BY_NORM.get(k) || BY_NORM.get(k) || null
}
// 番号が指すモンスター（エリアの一覧の並び）。番号が無い・一覧の外なら null
export const enemyNameOfFileNo = (stem) => {
  const no = artFileNoOf(stem)
  return no ? ENEMY_NAMES_BY_AREA[no.area - 1]?.[no.index - 1] || null : null
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
// 大きい版の場所（無ければ null）。大きい版が読めなかったときは、画面は小さい版で代わりに出す
export const enemyArtBigSrc = (name) => {
  const id = ENEMY_ART_IDS[name]
  return id ? `${ENEMY_ART_BIG_DIR}/${id}.webp` : null
}
