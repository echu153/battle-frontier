// ============================================================
// バトルフロンティアⅡ（リメイク版）— 装備一覧の絞り込み・並べ替え・ページ送り
// ------------------------------------------------------------
// 倉庫と鍛冶屋で同じ挙動になるよう、ここ1か所に置いてある。
// ★一覧は1ページに詰め込まない（PAGE_SIZE 個ずつ）。持ち物が増えると
//   目当ての装備を探すのも、押し間違えずに選ぶのも無理になるため。
// ============================================================
import { CATALOG, RANKS, PLUS_MAX } from './equipment.js'

export const PAGE_SIZE = 15

// 画面ごとに useState の初期値として使う既定の絞り込み
export const defaultFilter = { rank:'すべて', type:'すべて', plus:'すべて', sort:'power', asc:false }

export const ALL = 'すべて'
// 種類（武器種・防具の系統・アクセの種別）。カタログから作るので取りこぼさない
export const TYPES = [...new Set(CATALOG.map(i => i.type))]
export const RANK_OPTIONS = [ALL, ...[...RANKS].reverse()]   // 強いほうを上に
export const TYPE_OPTIONS = [ALL, ...TYPES]
export const plusOptions = (list) => {
  const found = [...new Set((list || []).map(g => g.plus ?? 0))].sort((a, b) => a - b)
  return [ALL, ...found.filter(p => p >= 0 && p <= PLUS_MAX)]
}

// 並べ替え。key は下の SORTS のいずれか
export const SORTS = [
  { key:'power', label:'戦闘力' },
  { key:'rank',  label:'ランク' },
  { key:'plus',  label:'強化値' },
  { key:'count', label:'所持数' },
  { key:'name',  label:'名前' },
]
const rankIndex = (r) => RANKS.indexOf(r)

// ★行は { item, plus, count, power } の形（倉庫のまとまりでも鍛冶屋の種類でも使える）
export const filterRows = (rows, { rank = ALL, type = ALL, plus = ALL, part = ALL } = {}) =>
  (rows || []).filter(r =>
    (rank === ALL || r.item.rank === rank) &&
    (type === ALL || r.item.type === type) &&
    (part === ALL || r.item.part === part) &&
    (plus === ALL || (r.plus ?? 0) === plus))

export const sortRows = (rows, key = 'power', asc = false) => {
  const dir = asc ? 1 : -1
  const cmp = {
    power: (a, b) => (a.power ?? 0) - (b.power ?? 0),
    rank:  (a, b) => rankIndex(a.item.rank) - rankIndex(b.item.rank),
    plus:  (a, b) => (a.plus ?? 0) - (b.plus ?? 0),
    count: (a, b) => (a.count ?? 0) - (b.count ?? 0),
    name:  (a, b) => a.item.name.localeCompare(b.item.name, 'ja'),
  }[key] || (() => 0)
  // 同じ値のときは名前でそろえる（並びがちらつかないように）
  return [...(rows || [])].sort((a, b) => cmp(a, b) * dir || a.item.name.localeCompare(b.item.name, 'ja'))
}

export const pageCount = (total, size = PAGE_SIZE) => Math.max(1, Math.ceil((total || 0) / size))
// ページは0始まり。範囲の外を渡されても端に丸める（絞り込みで件数が減ったとき用）
export const pageOf = (rows, page = 0, size = PAGE_SIZE) => {
  const list = rows || []
  const p = Math.min(Math.max(0, page), pageCount(list.length, size) - 1)
  return list.slice(p * size, p * size + size)
}
export const clampPage = (page, total, size = PAGE_SIZE) =>
  Math.min(Math.max(0, page), pageCount(total, size) - 1)
