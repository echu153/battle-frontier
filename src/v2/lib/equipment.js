// ============================================================
// バトルフロンティアⅡ（リメイク版）— 装備カタログ
// ------------------------------------------------------------
// 設計は docs/v2-equipment-design.md。あるけみすと式で、
// **装備は「戦闘力」を1つ持ち、それを決まった配分でステータスへ散らす**。
//
//   装備の戦闘力(+n) = 基礎 × 1.5^n        （強化は1段階ごとに一律1.5倍）
//   ランクの基礎     = F10 / E20 / D30 / C40 / B50 / A60 / S70
//
// 枠は8つ（右手・左手・頭・鎧・腕・足・アクセ×2）。
//   両手武器は枠を2つ使うので戦闘力2.2倍 ／ 盾は左手専用
//   鎧は戦闘力1.3倍（防具の中心） ／ アクセは0.8倍
//
// ⚠**SS・SSSは設計だけして実装に入れていない**（最初はF〜Sの7段階）。
// ============================================================
import { STAT_KEYS } from './stats.js'

export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S']
export const RANK_BASE = { F:10, E:20, D:30, C:40, B:50, A:60, S:70 }
export const PLUS_MULT = 1.5
export const PLUS_MAX = 12

// 落ちる「部位」は6つ。武器は右手/左手のどちらにも、アクセは2枠のどちらにも入る
export const PARTS = ['武器', '頭', '鎧', '腕', '足', 'アクセ']
export const SLOTS = ['right', 'left', 'head', 'body', 'arm', 'foot', 'acc1', 'acc2']
export const SLOT_LABEL = { right:'右手', left:'左手', head:'頭', body:'鎧', arm:'腕', foot:'足', acc1:'アクセ①', acc2:'アクセ②' }
const PART_MULT = { 武器:1.0, 頭:1.0, 鎧:1.3, 腕:1.0, 足:1.0, アクセ:0.8 }

// ===== 武器 10種 =====
// hands: 1=片手 / 2=両手（枠を2つ使うので戦闘力2.2倍）/ 'L'=左手専用
const TWO_HAND_MULT = 2.2
export const WEAPONS = {
  剣:     { hands:1,   dist:{ str:70, dex:20, agi:10 },     names:['ソード', 'ショートソード', '鉄剣', 'ロングソード', 'セイバー', 'ミスリルソード', '蒼氷剣'] },
  短剣:   { hands:1,   dist:{ agi:45, dex:35, str:20 },     names:['ナイフ', 'ダガー', 'スティレット', '三日月のダガー', '月影の短剣', '霧隠れのダガー', '宵闇の短剣'] },
  槍:     { hands:1,   dist:{ str:55, dex:30, agi:15 },     names:['竹槍', 'ロングスピア', 'パルチザン', 'ランス', '翡翠のランス', '穿光のランス', '烈風槍'] },
  斧:     { hands:1,   dist:{ str:85, vit:15 },             names:['石斧', 'ウォーアクス', 'バトルアックス', 'バルディッシュ', 'グレートアックス', '業火の戦斧', '処刑斧ギロチナ'] },
  籠手:   { hands:1,   dist:{ str:50, agi:40, vit:10 },     names:['グローブ', 'レザーガントレット', 'アイアンナックル', 'スチールクロー', 'ウォーガントレット', 'ミスリルガントレット', '金剛籠手'] },
  魔道書: { hands:1,   dist:{ int_stat:65, dex:35 },        names:['手記', '初歩の魔道書', '鉄綴じの魔道書', 'コーデックス', 'トーム', '星辰書', '禁書「灰の頁」'] },
  大剣:   { hands:2,   dist:{ str:90, vit:10 },             names:['グレートソード', 'バスタードソード', 'クレイモア', 'ツヴァイハンダー', 'フランベルジュ', 'ハイランダー', '王家の大剣'] },
  弓:     { hands:2,   dist:{ dex:50, agi:35, str:15 },     names:['ショートボウ', 'ロングボウ', '猟弓', 'アルバレスト', '精霊樹の弓', 'エルフボウ', '天翔弓'] },
  杖:     { hands:2,   dist:{ int_stat:90, vit:10 },        names:['ワンド', '樫のロッド', '節くれのスタッフ', 'オーク材のスタッフ', 'セプター', '星詠みの宝杖', '叡智錫杖'] },
  盾:     { hands:'L', dist:{ vit:70, str:20, dex:10 },     names:['バックラー', 'ラウンドシールド', 'カイトシールド', 'ヒーターシールド', 'タワーシールド', 'ミスリルシールド', '城塞盾'] },
}

// ===== 防具 3系統 × 4部位 =====
// 配分は「系統が主ステ55%・部位が副ステ30%・系統の第3ステ15%」。主と副が重なると合算される
export const ARMOR_LINES = ['重装', '軽装', '魔装']
const LINE_MAIN = { 重装:{ main:'vit', third:'str' }, 軽装:{ main:'agi', third:'dex' }, 魔装:{ main:'int_stat', third:'vit' } }
const PART_SUB = {
  頭: () => 'dex',
  鎧: () => 'vit',
  腕: (line) => ({ 重装:'str', 軽装:'str', 魔装:'int_stat' }[line]),
  足: () => 'agi',
}
export const armorDist = (line, part) => {
  const { main, third } = LINE_MAIN[line]
  const d = {}
  const add = (k, v) => { d[k] = (d[k] || 0) + v }
  add(main, 55); add(PART_SUB[part](line), 30); add(third, 15)
  return d
}
export const ARMOR_NAMES = {
  '重装/頭':['ヘッドギア', 'アイアンヘルム', 'スチールヘルム', 'グレートヘルム', '鉄面の兜', 'ミスリルヘルム', '金剛兜'],
  '重装/鎧':['チェインメイル', 'スケイルメイル', 'プレートメイル', 'フルプレート', '銀装の鎧', 'ミスリルアーマー', '城塞鎧'],
  '重装/腕':['アームガード', 'アイアンブレーサー', 'スチールブレーサー', 'ヘヴィブレーサー', '鋼板のブレーサー', '白銀の腕甲', '鉄壁腕甲'],
  '重装/足':['アイアンシューズ', 'アイアングリーヴ', 'スチールグリーヴ', 'ヘヴィグリーヴ', '鋼鉄のグリーヴ', '星鉄のグリーヴ', '不動具足'],
  '軽装/頭':['バンダナ', 'レザーキャップ', 'フード', 'シャドウフード', '忍びのフード', '隠者のフード', '幻影頭巾'],
  '軽装/鎧':['クロースベスト', 'レザーアーマー', 'スタッデドレザー', 'チェインベスト', '影織の胴衣', '霧纏いの胴衣', '影纏衣'],
  '軽装/腕':['リストバンド', 'レザーブレーサー', 'スタッデドガード', 'ライトブレーサー', '疾風の腕輪', 'ミスリルバングル', '迅雷腕輪'],
  '軽装/足':['サンダル', 'レザーブーツ', 'トラベルブーツ', 'ハイブーツ', '月影のブーツ', '韋駄天のブーツ', '縮地靴'],
  '魔装/頭':['サークレット', '見習いのサークレット', 'マジックハット', 'ポインテッドハット', '星読みの帽子', '賢者のハット', '叡智の冠'],
  '魔装/鎧':['ローブ', 'ウィザードローブ', 'メイジローブ', 'セージローブ', '銀糸のローブ', 'ミスリルローブ', '秘奥の法衣'],
  '魔装/腕':['クロースバンド', '銅の腕輪', '銀の腕輪', 'ルーンバングル', '翡翠のバングル', '星辰のバングル', '魔導腕輪'],
  '魔装/足':['クロースシューズ', 'ソフトシューズ', 'メイジシューズ', 'ルーンシューズ', '精霊靴', '妖精靴', '浮遊靴'],
}

// ===== アクセサリ 4種 =====
export const ACCESSORIES = {
  イヤリング: { note:'STR寄り',  dist:{ str:60, dex:20, agi:20 },                       names:['石のピアス', '銅のピアス', '獣牙のイヤリング', 'ガーネットピアス', '闘気のイヤリング', '猛虎のピアス', '覇気の耳飾り'] },
  ネックレス: { note:'バランス', dist:{ str:20, dex:20, agi:20, int_stat:20, vit:20 },  names:['麻紐の首飾り', '貝殻のネックレス', '銀のネックレス', 'アメジストの首飾り', '五色の首飾り', '賢者のネックレス', '調和の首飾り'] },
  リング:     { note:'INT寄り',  dist:{ int_stat:60, dex:20, vit:20 },                  names:['木の指輪', '銅の指輪', 'ルーンリング', 'サファイアリング', '魔導の指輪', '大賢者の指輪', '秘奥の指輪'] },
  ベルト:     { note:'耐久寄り', dist:{ vit:60, str:20, agi:20 },                       names:['粗革のベルト', 'レザーベルト', '鋼のベルト', 'ヘヴィベルト', '巨人のベルト', 'ミスリルベルト', '不動の帯'] },
}

// ===== カタログ =====
// { id, name, part, type, rank, hands, dist }
const build = () => {
  const out = []
  for (const [type, w] of Object.entries(WEAPONS)) {
    RANKS.forEach((rank, i) => out.push({ id:`w:${type}:${rank}`, name:w.names[i], part:'武器', type, rank, hands:w.hands, dist:w.dist }))
  }
  for (const line of ARMOR_LINES) {
    for (const part of ['頭', '鎧', '腕', '足']) {
      const names = ARMOR_NAMES[`${line}/${part}`]
      RANKS.forEach((rank, i) => out.push({ id:`a:${line}:${part}:${rank}`, name:names[i], part, type:line, rank, hands:1, dist:armorDist(line, part) }))
    }
  }
  for (const [type, a] of Object.entries(ACCESSORIES)) {
    RANKS.forEach((rank, i) => out.push({ id:`c:${type}:${rank}`, name:a.names[i], part:'アクセ', type, rank, hands:1, dist:a.dist }))
  }
  return out
}
export const CATALOG = build()
export const ITEM_BY_ID = Object.fromEntries(CATALOG.map(i => [i.id, i]))
export const itemsOf = (part) => CATALOG.filter(i => i.part === part)
export const typesOf = (part) => [...new Set(itemsOf(part).map(i => i.type))]

// ===== 数値 =====
// 装備の戦闘力。両手武器は2.2倍・鎧は1.3倍・アクセは0.8倍
export const powerOf = (item, plus = 0) => {
  const mult = item.hands === 2 ? TWO_HAND_MULT : PART_MULT[item.part]
  return Math.round(RANK_BASE[item.rank] * Math.pow(PLUS_MULT, plus) * mult)
}
// 戦闘力を配分どおりにステータスへ散らす。端数は一番大きいステで吸収して合計を合わせる
export const statsOf = (item, plus = 0) => {
  const p = powerOf(item, plus)
  const out = {}
  for (const k of STAT_KEYS) out[k] = 0
  for (const [k, v] of Object.entries(item.dist)) out[k] = Math.round(p * v / 100)
  const top = Object.entries(item.dist).sort((a, b) => b[1] - a[1])[0][0]
  out[top] += p - Object.values(out).reduce((a, b) => a + b, 0)
  return out
}
// この装備をどの枠に着けられるか
export const slotsFor = (item) => {
  if (item.part === '武器') return item.hands === 'L' ? ['left'] : item.hands === 2 ? ['right'] : ['right', 'left']
  if (item.part === 'アクセ') return ['acc1', 'acc2']
  return { 頭:['head'], 鎧:['body'], 腕:['arm'], 足:['foot'] }[item.part]
}
