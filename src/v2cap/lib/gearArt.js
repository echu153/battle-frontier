// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 装備の絵（ドット絵のアイコン）
// ------------------------------------------------------------
// 【確定】2026-11-23 ユーザー指示「装備に全部専用のイラスト（ドット絵）を付けたい／装備画面でイラストも表示されて、
//   視覚的にわかりやすいようにしたい／珍しい装備はレアリティ感が出るように」＋選択：
//   ・順番＝**珍しい順に少しずつ出す**（ユニーク＋四凶 → レジェンダリー → エピック → レア → ノーマル＋初期装備）。
//     絵がまだ無い装備は、種類ごとの仮のアイコン（GEAR_FALLBACK）で出す。最後は全部（1,655個）専用の絵になる
//   ・作り方＝**16個を1枚（4×4）に並べて** ChatGPT に描いてもらい、tools/v2cap-gear-art.mjs が切り分ける
//   ・珍しさ＝「枠の色を変えるのは当たり前、レジェンダリー以上はレアな装備ってわかるように豪華に、セット装備は全体を合わせて」
//     ＝枠の色は5等級とも変える・レジェンダリーとユニークは絵も枠も豪華に（枠は components/V2capGearIcon.jsx）・
//       防具のセット（同じエリア×同じ系統の4部位）は同じシートに並べて、素材・色・紋章をそろえて描いてもらう
// 元の絵（ユーザーが置く・git に入れない）：public/V2装備/<シートの名前>.png
// 画面で使う版：public/v2cap-art/gear/<絵の名前>.webp・一覧 src/v2cap/lib/gearArtList.js（道具が書く）
// ⚠シートの並び（GEAR_SHEETS）を変えると、もう描いてもらったシートのマスと装備がずれる＝並びは足すだけにする（gearArt.test.js が見張る）
// ============================================================
import {
  KINDS, RARITIES, ITEMS, STARTER_ITEMS, UNIQUE_ITEMS, CHALLENGE_ITEMS, CHALLENGE_UNIQUE_ITEMS,
  RARITY_LABEL, isUnique, kindLabel,
} from './equipment.js'
import { AREA_LIST } from './areas.js'
import { GEAR_ART } from './gearArtList.js'

export const GEAR_ART_DIR = '/v2cap-art/gear'
export const GEAR_ART_SIZE = 128        // 書き出す絵の大きさ（画面では40〜64px＝2倍の画面でも足りる）
export const GEAR_SHEET_SOURCE = 'V2装備' // 元の絵の置き場所（public の下）
export const SHEET_COLS = 4
export const SHEET_CELLS = SHEET_COLS * SHEET_COLS
export const SHEET_BG = '#FF00FF'       // シートの背景（真マゼンタ）。森の装備は緑を使うので、真緑にしない

// ===== 絵の名前（ファイル名に使う＝英数字だけ）=====
// 装備のID（1L:片手剣・U3:リング・C11:enma:宝珠）の種類を番号に変える：1L-k01・U3-k23・C11-enma-k13
const KIND_NO = Object.fromEntries(KINDS.map((k, i) => [k.key, String(i + 1).padStart(2, '0')]))
export const gearArtKeyOf = (item) => {
  if (!item?.id || !KIND_NO[item.kind]) return null
  return `${item.id.slice(0, item.id.lastIndexOf(':')).replace(/:/g, '-')}-k${KIND_NO[item.kind]}`
}
export const gearArtFileOf = (item) => `${gearArtKeyOf(item)}.webp`
// 画面のアドレス（絵がまだ無ければ null＝仮のアイコン）。list は確かめ用に差し替えられる
export const gearArtSrcOf = (item, list = GEAR_ART) => {
  const key = gearArtKeyOf(item)
  return key && list[key] ? `${GEAR_ART_DIR}/${key}.webp?v=${list[key].v}` : null
}
export const hasGearArt = (item, list = GEAR_ART) => !!gearArtSrcOf(item, list)

// ===== 仮のアイコン（絵がまだ無い装備・種類ごと）=====
export const GEAR_FALLBACK = {
  片手剣: '🗡', 両手剣: '⚔', 斧: '🪓', 槍: '🔱', 鈍器: '🔨', 短剣: '🔪', 拳: '🥊', 弓: '🏹', 銃: '🔫', 杖: '🪄', 書: '📖',
  投擲: '🪃', 刀: '⚔', 宝珠: '🔮',
  重鎧頭: '🪖', 重鎧鎧: '🛡', 重鎧腕: '🧤', 重鎧足: '🥾',
  軽装頭: '🎩', 軽装鎧: '🧥', 軽装腕: '🧤', 軽装足: '👢',
  リング: '💍', イヤリング: '💠', ベルト: '🎗', ネックレス: '📿',
}
export const gearFallbackOf = (item) => GEAR_FALLBACK[item?.kind] || '❔'

// ===== 等級（枠と光の段）=====
// N・R・E・L・U。四凶の専用装備はレジェンダリーの枠（レア度が L）
export const gearTierOf = (item) => (isUnique(item) ? 'U' : RARITIES.includes(item?.rarity) ? item.rarity : 'N')
// 豪華に見せる等級（ユーザー「レジェンダリー以上はレアな装備ってわかるように豪華に」）
export const isLavish = (item) => ['L', 'U'].includes(gearTierOf(item))

// ===== シート（16個を1枚）=====
// 並び（描いてもらう順＝珍しい順）：
//   U01〜U04 … ユニーク64（出撃のボス60＝場所の順・四凶4）
//   C01      … 四凶の専用装備12
//   L・E・R・N それぞれ：
//     <レア度>-armor01〜08 … 防具。1枚にエリア2つぶん（1エリア＝重鎧4部位＋軽装4部位）＝セットが同じ段に並ぶ
//     <レア度>-other01〜17 … 武器14＋装飾品4（エリアの順に16個ずつ）
//   S-armor01・S-other01 … 初期装備19
const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))
const no2 = (i) => String(i + 1).padStart(2, '0')
const isArmor = (item) => !!item.line
const byArea = (items) => [...items].sort((a, b) => a.area - b.area)   // 並べ替えは安定＝エリアの中は KINDS の順のまま
const sheetsOf = (prefix, label, items) => [
  ...chunk(byArea(items.filter(isArmor)), SHEET_CELLS).map((it, i) => ({ id: `${prefix}-armor${no2(i)}`, label: `${label}・防具 ${i + 1}`, items: it })),
  ...chunk(byArea(items.filter(i => !isArmor(i))), SHEET_CELLS).map((it, i) => ({ id: `${prefix}-other${no2(i)}`, label: `${label}・武器と装飾品 ${i + 1}`, items: it })),
]
export const GEAR_SHEETS = [
  ...chunk([...UNIQUE_ITEMS, ...CHALLENGE_UNIQUE_ITEMS], SHEET_CELLS).map((it, i) => ({ id: `U${no2(i)}`, label: `ユニーク ${i + 1}`, items: it })),
  ...chunk(CHALLENGE_ITEMS, SHEET_CELLS).map((it, i) => ({ id: `C${no2(i)}`, label: `四凶の専用装備 ${i + 1}`, items: it })),
  ...[...RARITIES].reverse().flatMap(r => sheetsOf(r, RARITY_LABEL[r], ITEMS.filter(i => i.rarity === r))),
  ...sheetsOf('S', '初期装備', STARTER_ITEMS),
]
export const GEAR_SHEET_BY_ID = Object.fromEntries(GEAR_SHEETS.map(s => [s.id, s]))
export const gearSheetFileOf = (sheet) => `${sheet.id}.png`
// 絵が入った数（進み具合）
export const gearArtProgress = (list = GEAR_ART) => {
  const all = GEAR_SHEETS.flatMap(s => s.items)
  return { done: all.filter(i => hasGearArt(i, list)).length, total: all.length }
}

// ===== ChatGPT への頼み方（シート1枚ぶん）=====
// 等級ごとの豪華さ（絵そのもの）。枠と光は画面が重ねるので、絵には枠を描かない
const TIER_STYLE = {
  N: '量産品。素材そのままの素朴な形。飾りは付けない。色は素材の1〜2色',
  R: 'その土地の職人の品。形に少し特徴があり、小さな飾りか差し色が1つ',
  E: '名のある一品。ひと目で分かる独特の形。紋章・彫り・宝石のどれかが目を引く。色は3〜4色でまとめる',
  L: '伝説の品。**ひと目で特別と分かるように豪華に**：金や白金の縁取り・大きな宝石・細かい彫り・刃や宝石が自分で光っている。影の色まで鮮やかに',
  U: 'この世に1つの品。**いちばん豪華で、形そのものが特別**：落とすボスの体の一部や力をかたどった大胆な形・光やオーラをまとう・ほかのどの装備とも似ていない',
}
const KIND_HINT = {
  武器: '武器は斜め（柄が左下・先が右上）に置く',
  頭: '頭の防具は正面やや斜めから', 鎧: '鎧は胴だけを正面から（人は描かない）', 腕: '腕の防具は片方だけ', 足: '足の防具は一足（左右そろい）',
  アクセ: '装飾品は大きく、形がはっきり分かるように',
}
const areaNameOf = (item) => (item.area > 0 ? AREA_LIST[item.area - 1]?.name || '' : '')
const cellNote = (item) => {
  if (item.boss) return `${item.boss}が落とす${item.text ? `・能力「${item.text.replace(/\n/g, '／')}」` : ''}`
  if (item.area === 0) return '冒険を始めたばかりの見習いの持ち物'
  return `「${areaNameOf(item)}」の装備`
}
// 同じセットの防具（同じエリア×同じ系統）のマスの番号。レア以上だけ（ノーマルにセット能力は無いが、見た目は同じ素材でそろえる）
const setGroupsOf = (sheet) => {
  const groups = new Map()
  sheet.items.forEach((item, i) => {
    if (!item.line || item.boss) return
    const k = `${item.area}:${item.line}`
    groups.set(k, [...(groups.get(k) || []), i + 1])
  })
  return [...groups.entries()].filter(([, cells]) => cells.length > 1)
    .map(([k, cells]) => ({ area: Number(k.split(':')[0]), line: k.split(':')[1], cells }))
}
export const gearSheetPromptOf = (sheet) => {
  const tiers = [...new Set(sheet.items.map(gearTierOf))]
  const parts = Object.keys(KIND_HINT).filter(p => sheet.items.some(i => i.part === p))
  const rows = chunk(sheet.items.map((item, i) => `${i + 1}. ${item.name}（${promptKindOf(item)}）— ${cellNote(item)}`), SHEET_COLS)
  const sets = setGroupsOf(sheet)
  const empty = SHEET_CELLS - sheet.items.length
  return [
    `RPGの装備のアイコンを、ドット絵で${sheet.items.length}個、1枚の正方形の画像に描いてください。`,
    '',
    '【並べ方】',
    `・画像を 4列×4段 の同じ大きさのマス（16マス）に分け、1マスに1個。左上から右へ、段ごとに下へ、下の番号の順`,
    '・装備はマスの真ん中に、マスの7〜8割の大きさで。となりのマスにはみ出さない。どの装備も同じくらいの大きさ',
    `・背景は全部 真マゼンタ（${SHEET_BG}）の一色。マスの線・枠・番号・文字・影・床は描かない`,
    ...(empty ? [`・最後の${empty}マスは何も描かない（背景の色だけ）`] : []),
    '',
    '【絵柄】',
    '・16ビットのゲームふうのドット絵。1ドットがはっきり見える粗さ・くっきりした濃い色の輪郭線・ぼかしやグラデーションは使わない',
    '・光は左上から。装備だけを描く（手・人・台・背景の飾りは描かない）',
    '・マゼンタとそれに近い色（明るいピンク紫）は装備に使わない',
    ...parts.map(p => `・${KIND_HINT[p]}`),
    ...Object.keys(KIND_SHAPE).filter(k => sheet.items.some(i => i.kind === k)).map(k => `・${ACC_WORD[k]}＝${KIND_SHAPE[k].slice(1, -1)}`),
    '',
    '【豪華さ】',
    ...tiers.map(t => `・${RARITY_LABEL[t]}：${TIER_STYLE[t]}`),
    ...(sets.length ? [
      '',
      '【セット】同じセットの防具は、素材・色・紋章・縁取りをそろえて、並べたら一揃いに見えるように',
      ...sets.map(s => `・${s.cells.join('・')}番＝「${areaNameOf({ area: s.area })}」の${s.line}の一揃い`),
    ] : []),
    '',
    '【描く装備】名前と添え書きから形と色を考えてください',
    ...rows.map((r, i) => `${i + 1}段目\n${r.join('\n')}`),
  ].join('\n')
}

// ===== 1個だけ描き直す =====
// 【確定】2026-11-24 ユーザー「描き直す」（四凶のシートで、指輪が宝珠の飾り・耳飾りが指輪に描かれた）：
//   シートの1個だけを描き直した絵は public/V2装備/one/<絵の名前>.png に置く（道具がシートの絵より優先して使う）。
//   頼む文は、種類の形をはっきり書く（装飾品は名前から別の物に描かれやすい）
export const GEAR_ONE_DIR = 'one'
export const gearOneFileOf = (item) => `${gearArtKeyOf(item)}.png`
// 頼む文に書く種類：装飾品は「装飾品・指輪」のように何の装飾品かまで書く
//   （2026-11-24 四凶のシートで、「装飾品」としか書いていなかったリングが珠の飾りに、イヤリングが指輪に描かれた＝ユーザー「描き直す」）
const ACC_WORD = { リング: '指輪', イヤリング: '耳飾り', ベルト: 'ベルト', ネックレス: '首飾り' }
const promptKindOf = (item) => (ACC_WORD[item.kind] ? `装飾品・${ACC_WORD[item.kind]}` : kindLabel(item))
const KIND_SHAPE = {
  リング: '（指にはめる輪。輪の全体が見えること。玉や飾りは輪の上に付ける）',
  イヤリング: '（左右一組を並べる。耳にかける金具が上に見えること。指輪・腕輪にはしない）',
  ベルト: '（腰に巻く帯。帯の輪の全体と、正面の留め具が見えること。留め具だけにはしない）',
  ネックレス: '（首にかける鎖かひもと、下がる飾り。鎖かひもが見えること）',
}
export const gearOnePromptOf = (item) => {
  const tier = gearTierOf(item)
  return [
    'RPGの装備のアイコンを、ドット絵で1個だけ、正方形の画像に描いてください。',
    '',
    `【描く装備】${item.name}（${promptKindOf(item)}）— ${cellNote(item)}`,
    ...(KIND_SHAPE[item.kind] ? [`・これは${ACC_WORD[item.kind]}＝${KIND_SHAPE[item.kind].slice(1, -1)}`] : []),
    `・${KIND_HINT[item.part]}`,
    '',
    '【置き方】',
    '・装備は画像の真ん中に、画像の7〜8割の大きさで。縁にふれない',
    `・背景は全部 真マゼンタ（${SHEET_BG}）の一色。枠・文字・影・床は描かない`,
    '',
    '【絵柄】',
    '・16ビットのゲームふうのドット絵。1ドットがはっきり見える粗さ・くっきりした濃い色の輪郭線・ぼかしやグラデーションは使わない',
    '・光は左上から。装備だけを描く（手・人・台・背景の飾りは描かない）',
    '・マゼンタとそれに近い色（明るいピンク紫）は装備に使わない',
    '',
    '【豪華さ】',
    `・${RARITY_LABEL[tier]}：${TIER_STYLE[tier]}`,
  ].join('\n')
}

