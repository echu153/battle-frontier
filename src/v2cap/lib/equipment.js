// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 装備の一覧
// ------------------------------------------------------------
// 設計は docs/v2cap-design.md §5。ユーザー決定（2026-10-09）：
//   ・武器は14種（2026-10-09 に刀・宝珠を足した）。**職業ごとに装備できる種類が決まっている**（jobs.js の weapons）
//   ・**盾はなし・武器は1本だけ**（片手・両手の区別もなし）
//   ・防具は**重鎧と軽装**の2種。職業に関係なく装備できる。
//     メリットは 重鎧＝受けるダメージ−1%／軽装＝AGI+1%（1部位ごと・デメリットなし。2026-10-12 に −3%／+5% から下げた）
//   ・**エリアごとに**、武器14種・重鎧4部位・軽装4部位・装飾品4種の26点が、
//     **レア度（ノーマル・レア・エピック・レジェンダリー）ごとに1つずつ**ある＝1エリア104点・全部で1560点。
//     名前はユーザーの表（gearNames.js）。ランク（F〜S）はやめてレア度にした
//   ・強さはレア度で決まる：ノーマル1.0／レア1.25／エピック1.5／レジェンダリー1.75
//     （前のランクの C／B／A／S と同じ幅。ノーマルを全部の枠にそろえると本体と同じくらい）
//   ・**必要LV（＝アイテムLV）はエリアとレア度で決まる**（ユーザーの表）：ノーマル＝5×エリア、レア＋5・エピック＋10・レジェンダリー＋15
//     （始まりの森 5／10／15／20 … 深淵の海溝 75／80／85／90）。強さは必要LVが高いほど上がり、レア度の倍率も掛かる
//     （同じLV20でも、ノーマルよりレジェンダリーが強い。gear.js）
//   ・**配分（どのステが上がるか）は種類ごとに1つ**で、エリアとレア度では変わらない。
//     物理職と魔法職の両方が使う種類（鈍器・短剣・投擲・杖と防具）は、間の配分にした（ユーザー決定「固定で混ぜる」）
//
// ★サーバーの v2cap_equipment はこの一覧から tools/v2cap-sql.mjs が作る（手で書き写さない）
// ============================================================
import { GEAR_NAMES } from './gearNames.js'

// ===== レア度 =====
export const RARITIES = ['N', 'R', 'E', 'L']
export const RARITY_LABEL = { N:'ノーマル', R:'レア', E:'エピック', L:'レジェンダリー' }
// 強さの基礎。ノーマル40＝前のCランク（gear.js の「ノーマルを全部そろえると本体と同じくらい」の基準）
export const RARITY_BASE = { N:40, R:50, E:60, L:70 }
// 【確定】2026-10-10 ユーザー指示「ノーマル灰色、レアは青、エピックは紫、レジェンダリーは黄色」（ドロップのログ・装備の名前・レア度の印で同じ色）
//   ★背景が濃紺なので、灰色も黄色も明るめ（暗い色は読めない＝v2ui.js の TEXT の注意）
export const RARITY_COLOR = { N:'#aab4be', R:'#4488ff', E:'#c060ff', L:'#ffe033' }
export const rarityLabel = (r) => RARITY_LABEL[r] || ''

// ===== 必要LV（＝アイテムLV）=====
// 【確定】2026-10-09 ユーザーの表。エリアが1つ進むごとに+5、レア度が1つ上がるごとに+5
export const REQ_LV_STEP = 5
export const reqLvOf = (area, rarity) => REQ_LV_STEP * area + REQ_LV_STEP * Math.max(0, RARITIES.indexOf(rarity))

// 枠は7つ（武器1・頭・鎧・腕・足・装飾品2）
export const SLOTS = ['weapon', 'head', 'body', 'arm', 'foot', 'acc1', 'acc2']
export const SLOT_LABEL = { weapon:'武器', head:'頭', body:'鎧', arm:'腕', foot:'足', acc1:'装飾品①', acc2:'装飾品②' }
// 落ちる「部位」（1時間ごとに落ちやすい部位が入れ替わる仕組みは今のⅡと同じ並び）
// ★装飾品の部位の**内部の名前は「アクセ」のまま**（サーバーの v2cap_equipment.part も同じ）。
//   画面に出すときは必ず partLabel を通す（2026-10-09 ユーザー指示「アクセじゃなくて装飾品にして」）
export const PARTS = ['武器', '頭', '鎧', '腕', '足', 'アクセ']
export const PART_LABEL = { 武器:'武器', 頭:'頭', 鎧:'鎧', 腕:'腕', 足:'足', アクセ:'装飾品' }
export const partLabel = (part) => PART_LABEL[part] || part
// 部位の倍率。★武器は1本だけなので2.0（今のⅡの片手2本ぶん）。
//   7枠の合計は 2.0＋1.0＋1.3＋1.0＋1.0＋0.8×2 ＝ 7.9 で今のⅡと同じ
//   ＝「同じLVのノーマルを全部そろえると本体と同じくらい」（gear.js）
export const PART_MULT = { 武器:2.0, 頭:1.0, 鎧:1.3, 腕:1.0, 足:1.0, アクセ:0.8 }

// ★刀・宝珠は 2026-10-09 にユーザーの表「追加武器種（刀・宝珠）」で足した（後ろに足したので、前からある装備のIDは変わらない）
export const WEAPON_TYPES = ['片手剣', '両手剣', '斧', '槍', '鈍器', '短剣', '拳', '弓', '銃', '杖', '書', '投擲', '刀', '宝珠']
export const ARMOR_LINES = ['重鎧', '軽装']
export const ARMOR_PARTS = ['頭', '鎧', '腕', '足']
export const ACCESSORY_TYPES = ['リング', 'イヤリング', 'ベルト', 'ネックレス']

// 防具のメリット（1部位ごと）。必要LVに足りないときは、ステと同じ割合で弱まる（gear.js）
// 【確定】2026-10-12 ユーザー指示「防具の軽装重鎧で％で上がるパッシブは1％でいい」：前は 重鎧−3%／軽装+5%
export const ARMOR_EFFECT = {
  重鎧: { takenPct: -1, label:'受けるダメージ−1%' },
  軽装: { agiPct: 1, label:'AGI+1%' },
}

// ===== 配分（種類ごとに1つ）=====
// 「その装備の戦闘力をどのステへ散らすか」（合計100）。HP・MP・LUKは載せない（今のⅡと同じ）。
// 使う職業（jobs.js の weapons）：物理だけの種類は物理の配分。物理と魔法の両方が使う種類は、STRとINTを半分ずつ持たせた
export const WEAPON_DIST = {
  片手剣: { str:50, dex:25, agi:25 },                 // 槍使い・盗賊・弓使い・銃士
  両手剣: { str:80, dex:10, vit:10 },                 // 戦士
  斧:     { str:70, vit:20, dex:10 },                 // 戦士
  槍:     { str:55, dex:30, agi:15 },                 // 槍使い
  鈍器:   { str:40, int_stat:30, vit:30 },            // 戦士・格闘家／僧侶
  短剣:   { agi:40, dex:20, str:20, int_stat:20 },    // 盗賊・弓使い／魔法使い・呪術師・薬師
  拳:     { str:50, agi:40, vit:10 },                 // 格闘家
  弓:     { agi:40, str:40, dex:20 },                 // 弓使い
  銃:     { dex:55, agi:25, str:20 },                 // 銃士
  杖:     { int_stat:50, str:20, vit:15, agi:15 },    // 格闘家／魔法使い・呪術師・僧侶
  書:     { int_stat:60, dex:25, vit:15 },            // 魔法使い・僧侶・薬師
  投擲:   { dex:40, agi:20, str:20, int_stat:20 },    // 槍使い・盗賊・銃士／呪術師・薬師
  // 【確定】2026-10-09 ユーザー決定。刀＝戦士にも盗賊にも選ぶ理由がある配分（居合・カウンターのような動きはいまは付けない）
  刀:     { str:60, agi:25, dex:15 },                 // 戦士・盗賊・剣士
  // 【確定】2026-10-09 ユーザー決定。宝珠＝杖・書と同じくらいの強さで、INTは杖より控えめ・行動が速い（MP回復などの効果は付けない）
  宝珠:   { int_stat:40, agi:30, vit:30 },            // 魔法使い・呪術師・僧侶
}
// 防具はどの職業も着けるので、物理のステと魔法のステを同じだけ載せる
export const ARMOR_DIST = {
  重鎧: {
    頭: { vit:50, dex:20, str:15, int_stat:15 },
    鎧: { vit:60, str:15, int_stat:15, agi:10 },
    腕: { vit:45, str:20, int_stat:20, dex:15 },
    足: { vit:50, agi:20, str:15, int_stat:15 },
  },
  軽装: {
    頭: { agi:45, dex:25, str:15, int_stat:15 },
    鎧: { agi:40, vit:30, str:15, int_stat:15 },
    腕: { agi:40, dex:20, str:20, int_stat:20 },
    足: { agi:55, dex:15, str:15, int_stat:15 },
  },
}
// 装飾品は種類で向きが違う（配分は前と同じ）
export const ACCESSORY_DIST = {
  リング:     { int_stat:60, dex:20, vit:20 },                       // INT寄り
  イヤリング: { str:60, dex:20, agi:20 },                            // STR寄り
  ベルト:     { vit:60, str:20, agi:20 },                            // 耐久寄り
  ネックレス: { str:20, dex:20, agi:20, int_stat:20, vit:20 },       // バランス
}

// ===== 種類（1エリア26点の並び）=====
// key … 名前の表（gearNames.js）と装備のIDに使う。防具は「系統＋部位」（重鎧頭 など）
// type … 武器は種類・防具は系統（重鎧／軽装）・装飾品は種類（リング など）
export const KINDS = [
  ...WEAPON_TYPES.map(t => ({ key: t, part:'武器', type: t, line: null, dist: WEAPON_DIST[t] })),
  ...ARMOR_LINES.flatMap(line => ARMOR_PARTS.map(p => ({ key: `${line}${p}`, part: p, type: line, line, dist: ARMOR_DIST[line][p] }))),
  ...ACCESSORY_TYPES.map(a => ({ key: a, part:'アクセ', type: a, line: null, dist: ACCESSORY_DIST[a] })),
]
export const KIND_BY_KEY = Object.fromEntries(KINDS.map(k => [k.key, k]))
export const AREA_COUNT = GEAR_NAMES.N[WEAPON_TYPES[0]].length

// ===== 一覧（エリア × レア度 × 種類）=====
// id は「エリアの番号＋レア度：種類」（例 1N:片手剣・15L:重鎧頭）。名前が変わってもIDは変わらない。lv＝必要LV
export const itemIdOf = (area, rarity, kindKey) => `${area}${rarity}:${kindKey}`
export const ITEMS = Array.from({ length: AREA_COUNT }, (_, i) => i + 1).flatMap(area =>
  RARITIES.flatMap(rarity => KINDS.map(k => ({
    id: itemIdOf(area, rarity, k.key), name: GEAR_NAMES[rarity][k.key][area - 1],
    part: k.part, type: k.type, line: k.line, kind: k.key, area, rarity, lv: reqLvOf(area, rarity), dist: k.dist,
  }))))

// ===== 初期装備（キャラ作成のときに1回だけ配る）=====
// 【確定】2026-10-12 ユーザー指示「キャラ作成時そのクラスに対応する装備一式（lv１）」＋案を承認（装飾品だけ「古びた◯◯」にした）：
//   ・7枠すべて（武器・頭・鎧・腕・足・装飾品2つ）。**必要LV1**（アイテムLV1）・ノーマルと同じ作り
//     （7枠そろうとLV1の本体と同じくらい＝LV1の戦闘力39→78。始まりの森のノーマル（必要LV5）が落ちればそちらが強い）
//   ・武器＝その職業の代表の種類／防具＝前に出て受ける職業（戦士・槍使い・僧侶）は重鎧、ほかは軽装／
//     装飾品＝物理職は耳飾り（イヤリング・STR寄り）、魔法職は指輪（リング・INT寄り）
//   ・名前は「見習いの◯◯」、装飾品だけ「古びた◯◯」
//   ・どこにも落ちない（エリア0）・作れない（ノーマル）。分解すると始まりの森の残骸（smith.js の scrapAreaOf）。
//     強化は残骸を使わずGoldだけ（smith.js の enhanceScrapOf・2026-10-12 ユーザー指示「初期装備は残骸不要、Goldだけで強化できるように」
//     →同じ日に「全装備のノーマル装備」も同じにした）
// ★サーバーの v2cap_equipment（エリア0の行）と v2cap_classes.starter は tools/v2cap-sql.mjs がここから作る
export const STARTER_AREA = 0
export const STARTER_LV = 1
export const STARTER_NAMES = {
  刀:'見習いの刀', 両手剣:'見習いの大剣', 槍:'見習いの槍', 拳:'見習いの拳当て', 短剣:'見習いの短剣',
  弓:'見習いの弓', 銃:'見習いの銃', 杖:'見習いの杖', 書:'見習いの書',
  重鎧頭:'見習いの兜', 重鎧鎧:'見習いの鎧', 重鎧腕:'見習いの籠手', 重鎧足:'見習いの具足',
  軽装頭:'見習いの帽子', 軽装鎧:'見習いの服', 軽装腕:'見習いの手袋', 軽装足:'見習いの靴',
  イヤリング:'古びた耳飾り', リング:'古びた指輪',
}
export const STARTER_ITEMS = Object.entries(STARTER_NAMES).map(([key, name]) => {
  const k = KIND_BY_KEY[key]
  return { id: itemIdOf(STARTER_AREA, 'N', key), name, part: k.part, type: k.type, line: k.line, kind: key,
    area: STARTER_AREA, rarity: 'N', lv: STARTER_LV, dist: k.dist }
})
// 職業 → 初期装備（武器の種類・防具の系統・装飾品の種類）。初期職だけ（一次職は作成で選べない）
export const STARTER_SET = {
  剣士:     { weapon:'刀',     line:'軽装', acc:'イヤリング' },
  戦士:     { weapon:'両手剣', line:'重鎧', acc:'イヤリング' },
  槍使い:   { weapon:'槍',     line:'重鎧', acc:'イヤリング' },
  格闘家:   { weapon:'拳',     line:'軽装', acc:'イヤリング' },
  盗賊:     { weapon:'短剣',   line:'軽装', acc:'イヤリング' },
  弓使い:   { weapon:'弓',     line:'軽装', acc:'イヤリング' },
  銃士:     { weapon:'銃',     line:'軽装', acc:'イヤリング' },
  魔法使い: { weapon:'杖',     line:'軽装', acc:'リング' },
  呪術師:   { weapon:'杖',     line:'軽装', acc:'リング' },
  僧侶:     { weapon:'杖',     line:'重鎧', acc:'リング' },
  薬師:     { weapon:'書',     line:'軽装', acc:'リング' },
}
// 枠の順（SLOTS＝武器・頭・鎧・腕・足・装飾品①・装飾品②）に並べた初期装備のID。無い職業は空
export const starterIdsOf = (cls) => {
  const s = STARTER_SET[cls]
  if (!s) return []
  const id = (key) => itemIdOf(STARTER_AREA, 'N', key)
  return [id(s.weapon), id(`${s.line}頭`), id(`${s.line}鎧`), id(`${s.line}腕`), id(`${s.line}足`), id(s.acc), id(s.acc)]
}

// ★ID から引く一覧には初期装備も入れる（持ち物・装備の画面・戦闘は ITEM_BY_ID で引く）。
//   ITEMS（エリア×レア度の1560点）には入れない＝落ちる・作る一覧やシミュの「いちばん良い装備」には出ない
export const ITEM_BY_ID = Object.fromEntries([...ITEMS, ...STARTER_ITEMS].map(i => [i.id, i]))
export const itemOf = (area, rarity, kindKey) => ITEM_BY_ID[itemIdOf(area, rarity, kindKey)] || null

// この装備をどの枠に着けられるか
export const slotsFor = (item) => {
  if (!item) return []
  if (item.part === '武器') return ['weapon']
  if (item.part === 'アクセ') return ['acc1', 'acc2']
  return [{ 頭:'head', 鎧:'body', 腕:'arm', 足:'foot' }[item.part]]
}
// 表示用の名前。ノーマルは名前だけ、ほかは【レア】若葉の剣 のようにレア度を頭に付ける
export const itemLabel = (item) => !item ? '?' : item.rarity === 'N' ? item.name : `【${rarityLabel(item.rarity)}】${item.name}`
// 種類の表示（武器は種類・防具は系統と部位・装飾品は「装飾品」）
export const kindLabel = (item) =>
  !item ? '' : item.part === '武器' ? item.type : item.part === 'アクセ' ? partLabel('アクセ') : `${item.line}・${item.part}`
