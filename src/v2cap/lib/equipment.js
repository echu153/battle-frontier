// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 装備の一覧
// ------------------------------------------------------------
// 設計は docs/v2cap-design.md §11。2026-10-09 ユーザー決定：
//   ・武器は12種。**職業ごとに装備できる種類が決まっている**（jobs.js の weapons）
//   ・**盾はなし・武器は1本だけ**（片手・両手の区別もなし）
//   ・防具は**重鎧と軽装**の2種。職業に関係なく装備できる。
//     メリットは 重鎧＝受けるダメージ−3%／軽装＝AGI+5%（1部位ごと・デメリットなし）
//   ・**配分は基本装備（ロングソード・レイピア・曲刀…）ごとに決まる**
//   ・名前は基本装備の名前のまま、ランク（F〜S）は印で出す（例：[B] レイピア LV45）
//
// ★今のⅡの装備の一覧（src/v2/lib/equipment.js）とは別物。ランクの基礎（F10〜S70）だけ同じ。
// ★サーバーの v2cap_equipment はこの一覧から tools/v2cap-sql.mjs が作る（手で書き写さない）
// ============================================================

export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S']
export const RANK_BASE = { F:10, E:20, D:30, C:40, B:50, A:60, S:70 }

// 枠は7つ（武器1・頭・鎧・腕・足・アクセ2）
export const SLOTS = ['weapon', 'head', 'body', 'arm', 'foot', 'acc1', 'acc2']
export const SLOT_LABEL = { weapon:'武器', head:'頭', body:'鎧', arm:'腕', foot:'足', acc1:'アクセ①', acc2:'アクセ②' }
// 落ちる「部位」（1時間ごとに落ちやすい部位が入れ替わる仕組みは今のⅡと同じ並び）
export const PARTS = ['武器', '頭', '鎧', '腕', '足', 'アクセ']
// 部位の倍率。★武器は1本だけになったので2.0（今のⅡの片手2本ぶん）。
//   7枠の合計は 2.0＋1.0＋1.3＋1.0＋1.0＋0.8×2 ＝ 7.9 で今のⅡと同じ
//   ＝「同じLVのCランクを全部そろえると本体と同じくらい」（gear.js）はそのまま
export const PART_MULT = { 武器:2.0, 頭:1.0, 鎧:1.3, 腕:1.0, 足:1.0, アクセ:0.8 }

export const WEAPON_TYPES = ['片手剣', '両手剣', '斧', '槍', '鈍器', '短剣', '拳', '弓', '銃', '杖', '書', '投擲']
export const ARMOR_LINES = ['重鎧', '軽装']
export const ARMOR_PARTS = ['頭', '鎧', '腕', '足']

// 防具のメリット（1部位ごと）。必要LVに足りないときは、ステと同じ割合で弱まる（gear.js）
export const ARMOR_EFFECT = {
  重鎧: { takenPct: -3, label:'受けるダメージ−3%' },
  軽装: { agiPct: 5, label:'AGI+5%' },
}

const W = (name, type, dist, note) => ({ id:`w:${name}`, name, part:'武器', type, dist, note })
const A = (name, part, line, dist) => ({ id:`a:${name}`, name, part, type: line, line, dist })
const C = (name, dist, note) => ({ id:`c:${name}`, name, part:'アクセ', type: name, dist, note })

// ===== 基本装備 =====
// dist は「その装備の戦闘力をどのステへ散らすか」（合計100）。HP・MP・LUKは載せない（今のⅡと同じ）
export const BASE_ITEMS = [
  // ---- 武器（36）----
  W('ロングソード', '片手剣', { str:60, dex:25, agi:15 }),
  W('レイピア',     '片手剣', { dex:50, str:35, agi:15 }),
  W('曲刀',         '片手剣', { str:50, agi:35, dex:15 }),
  W('大剣',         '両手剣', { str:90, vit:10 }),
  W('太刀',         '両手剣', { str:70, dex:20, agi:10 }),
  W('片手斧',       '斧',     { str:65, vit:20, dex:15 }),
  W('大斧',         '斧',     { str:80, vit:20 }),
  W('長槍',         '槍',     { str:55, dex:30, agi:15 }),
  W('斧槍',         '槍',     { str:70, vit:20, dex:10 }),
  W('三叉槍',       '槍',     { str:50, dex:25, agi:25 }),
  W('メイス',       '鈍器',   { str:45, int_stat:30, vit:25 }),
  W('ハンマー',     '鈍器',   { str:65, vit:35 }),
  W('トンファー',   '鈍器',   { str:45, agi:35, vit:20 }),
  W('ダガー',       '短剣',   { agi:45, dex:35, str:20 }),
  W('ナイフ',       '短剣',   { agi:55, dex:25, str:20 }),
  W('メス',         '短剣',   { dex:50, int_stat:30, agi:20 }),
  W('ナックル',     '拳',     { str:50, agi:40, vit:10 }),
  W('鉤爪',         '拳',     { agi:50, str:35, dex:15 }),
  W('ガントレット', '拳',     { str:55, vit:35, agi:10 }),
  W('長弓',         '弓',     { dex:55, str:30, agi:15 }),
  W('短弓',         '弓',     { agi:45, dex:40, str:15 }),
  W('弩',           '弓',     { dex:60, str:30, vit:10 }),
  W('拳銃',         '銃',     { dex:55, agi:30, str:15 }),
  W('長銃',         '銃',     { dex:70, str:20, agi:10 }),
  W('携行砲',       '銃',     { str:50, dex:40, vit:10 }),
  W('長杖',         '杖',     { int_stat:80, vit:20 }),
  W('短杖',         '杖',     { int_stat:65, dex:20, agi:15 }),
  W('棍',           '杖',     { str:50, int_stat:30, agi:20 }),
  W('魔導書',       '書',     { int_stat:65, dex:35 }),
  W('聖典',         '書',     { int_stat:55, vit:30, dex:15 }),
  W('薬学書',       '書',     { int_stat:50, dex:35, vit:15 }),
  W('投げナイフ',   '投擲',   { dex:45, agi:35, str:20 }),
  W('手裏剣',       '投擲',   { agi:50, dex:40, str:10 }),
  W('薬瓶',         '投擲',   { int_stat:50, dex:35, agi:15 }),
  W('呪符',         '投擲',   { int_stat:60, dex:25, agi:15 }),
  W('投槍',         '投擲',   { str:55, dex:30, agi:15 }),
  // ---- 防具（16）。部位ごとに重鎧2つ・軽装2つ（物理寄りと魔法寄り）----
  A('鉄兜',           '頭', '重鎧', { vit:55, str:30, dex:15 }),
  A('鉄冠',           '頭', '重鎧', { vit:55, int_stat:30, dex:15 }),
  A('プレートメイル', '鎧', '重鎧', { vit:60, str:25, agi:15 }),
  A('聖鉄の鎧',       '鎧', '重鎧', { vit:60, int_stat:25, dex:15 }),
  A('鉄の籠手',       '腕', '重鎧', { vit:50, str:35, dex:15 }),
  A('聖鉄の腕甲',     '腕', '重鎧', { vit:50, int_stat:35, dex:15 }),
  A('鉄靴',           '足', '重鎧', { vit:55, str:25, agi:20 }),
  A('聖鉄の具足',     '足', '重鎧', { vit:55, int_stat:25, agi:20 }),
  A('バンダナ',       '頭', '軽装', { agi:45, dex:35, str:20 }),
  A('フード',         '頭', '軽装', { agi:40, int_stat:35, dex:25 }),
  A('レザーアーマー', '鎧', '軽装', { agi:45, dex:30, vit:25 }),
  A('ローブ',         '鎧', '軽装', { int_stat:45, agi:30, vit:25 }),
  A('リストバンド',   '腕', '軽装', { agi:40, str:35, dex:25 }),
  A('魔導腕輪',       '腕', '軽装', { int_stat:45, agi:30, dex:25 }),
  A('ブーツ',         '足', '軽装', { agi:55, dex:25, vit:20 }),
  A('サンダル',       '足', '軽装', { agi:45, int_stat:30, dex:25 }),
  // ---- アクセサリ（4）。配分は今のⅡと同じ ----
  C('イヤリング', { str:60, dex:20, agi:20 }, 'STR寄り'),
  C('ネックレス', { str:20, dex:20, agi:20, int_stat:20, vit:20 }, 'バランス'),
  C('リング',     { int_stat:60, dex:20, vit:20 }, 'INT寄り'),
  C('ベルト',     { vit:60, str:20, agi:20 }, '耐久寄り'),
]
export const ITEM_BY_ID = Object.fromEntries(BASE_ITEMS.map(i => [i.id, i]))
export const weaponsOfType = (type) => BASE_ITEMS.filter(i => i.part === '武器' && i.type === type)
export const armorsOf = (part, line) => BASE_ITEMS.filter(i => i.part === part && i.line === line)
export const accessories = () => BASE_ITEMS.filter(i => i.part === 'アクセ')

// この装備をどの枠に着けられるか
export const slotsFor = (item) => {
  if (!item) return []
  if (item.part === '武器') return ['weapon']
  if (item.part === 'アクセ') return ['acc1', 'acc2']
  return [{ 頭:'head', 鎧:'body', 腕:'arm', 足:'foot' }[item.part]]
}
// 表示用の名前。[B] レイピア のようにランクを頭に付ける
export const itemLabel = (item, rank) => `[${rank}] ${item?.name || '?'}`
// 種類の表示（武器は種類・防具は系統と部位・アクセはアクセ）
export const kindLabel = (item) =>
  !item ? '' : item.part === '武器' ? item.type : item.part === 'アクセ' ? 'アクセ' : `${item.line}・${item.part}`
