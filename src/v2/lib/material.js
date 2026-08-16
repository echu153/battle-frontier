// ============================================================
// バトルフロンティアⅡ（リメイク版）— エンチャントの素材とエッセンス抽出
// ------------------------------------------------------------
// 設計は docs/v2-enchant-design.md。
//
//   敵を倒す → 素材が落ちる（通常 / レア / 激レア）
//           → 素材5個を消費して「抽出」→ エッセンス
//           → エッセンスを武器のソケットにはめる
//
// ★素材は**敵ごと固有で168種**（56体 × 3レア度）。
// ★**値もステータスの型も「抽出するとき」に抽選する。ドロップ時ではない。**
//   だから素材はスタックでき、倉庫は「素材ID → 個数」だけで済む。
//
// ⚠**抽選の権威はサーバー**（supabase_v2_core.sql の v2_extract_essence）。
//   このファイルは画面の表示とテスト用。**数式を変えるときは必ず両方を直すこと**。
//   SQLの v2_materials へのINSERTは、このファイルの MATERIALS から生成している。
// ============================================================
import { STAT_KEYS } from './stats.js'

export const RARITIES = ['normal', 'rare', 'ultra']
export const RARITY_LABEL = { normal:'通常', rare:'レア', ultra:'激レア' }
export const RARITY_SHORT = { normal:'n', rare:'r', ultra:'u' }
export const RARITY_COLOR = { normal:'#88aabb', rare:'#66ccff', ultra:'#ffcc44' }

// ===== レンジ =====
// 上限はエリアで決まり、下限だけレア度で上がる。刻みは0.1%。**全体の最大は2.0%**
export const STEP = 0.1
export const AREA_MAX = { 1:1.0, 2:1.0, 3:1.3, 4:1.3, 5:1.6, 6:1.6, 7:2.0, 8:2.0 }
export const RARITY_FLOOR_RATE = { normal:0, rare:0.3, ultra:0.5 }  // 0 は「最低の0.1から」
const round1 = (v) => Math.round(v * 10) / 10

// ★ボス素材もレンジは雑魚と同じ（2026-08-16 ユーザー決定「ボスだけ下げないで」）。
//   2ステータス持ちなので、合計では雑魚素材のちょうど2倍になる。
//   ⚠isBoss は呼び出し側の都合で残してあるだけで、レンジには効かない
export const capOf = (area) => AREA_MAX[area]
export const rangeOf = (area, rarity) => {
  const hi = capOf(area)
  const rate = RARITY_FLOOR_RATE[rarity] || 0
  return { lo: rate ? Math.max(STEP, round1(hi * rate)) : STEP, hi }
}

// ===== 値の抽選 =====
// 高い値ほど出にくい。⚠**倍率を全レンジで共通にしてはいけない**（段数の多いレンジで
// 最大値が引けなくなり、エリアを進む意味が消える）。
// **「最大値の出やすさ」がどのレンジでも先頭の TOP_WEIGHT になるよう、レンジごとに倍率を決める**
export const TOP_WEIGHT = 0.075
export const stepsOf = (lo, hi) => Math.round((hi - lo) / STEP) + 1
export const ratioOf = (lo, hi) => {
  const n = stepsOf(lo, hi)
  return n <= 1 ? 1 : Math.pow(TOP_WEIGHT, 1 / (n - 1))
}
// レンジの中の各値と、その確率
export const valueTable = (lo, hi) => {
  const n = stepsOf(lo, hi)
  const r = ratioOf(lo, hi)
  const w = Array.from({ length: n }, (_, k) => Math.pow(r, k))
  const sum = w.reduce((a, b) => a + b, 0)
  return w.map((x, k) => ({ value: round1(lo + k * STEP), p: x / sum }))
}
export const meanOf = (lo, hi) => valueTable(lo, hi).reduce((t, e) => t + e.value * e.p, 0)
export const rollValue = (lo, hi, rng = Math.random) => {
  let r = rng()
  for (const e of valueTable(lo, hi)) { r -= e.p; if (r <= 0) return e.value }
  return round1(lo)
}

// ===== ステータスの型の抽選 =====
// 雑魚の通常・レアは 70% で割り当てステ、30% でそれ以外の7種から均等。
// **激レアとボス素材は固定**＝この2つが「色を狙うための札」になる
export const MAIN_STAT_PCT = 70
export const rollStats = (mat, rng = Math.random) => {
  if (mat.isBoss || mat.rarity === 'ultra') return mat.stats
  if (rng() * 100 < MAIN_STAT_PCT) return mat.stats
  const others = STAT_KEYS.filter(k => !mat.stats.includes(k))
  return [others[Math.min(others.length - 1, Math.floor(rng() * others.length))]]
}

// ===== 色 =====
// 表記は**緋・蒼・翠**（2026-08-16 ユーザー決定）。DBに入る値は red/blue/green のまま
export const COLORS = ['red', 'blue', 'green']
export const COLOR_LABEL = { red:'緋', blue:'蒼', green:'翠' }
export const COLOR_HEX = { red:'#ff4d5e', blue:'#4d94ff', green:'#3fd98a' }
export const COLOR_OF_STAT = {
  str:'red', int_stat:'red',
  hp:'blue', mp:'blue', vit:'blue',
  dex:'green', agi:'green', luk:'green',
}
// 合計値を3グループで合算して、一番大きいグループがエッセンスの色
export const colorOf = (stats) => {
  const sum = { red:0, blue:0, green:0 }
  for (const [k, v] of Object.entries(stats || {})) sum[COLOR_OF_STAT[k]] += v
  return COLORS.reduce((best, c) => (sum[c] > sum[best] ? c : best), 'red')
}

// ===== 特殊能力が付く確率 =====
// 素材5個それぞれで個別に抽選し、**当たった中から1つを選ぶ**
export const ABILITY_CHANCE = { normal:0, rare:1, ultra:3 }

// ===== 素材168種 =====
// [敵の名前, ステータス, [通常, レア, 激レア], 時間帯（無ければ null）]
// 並びは enemies.js と同じ（雑魚3 → 時間帯限定3 → ボス）。ボスは配列の最後
const DEF = {
  1: [
    ['スライム', ['vit'], ['スライムのゼリー', '透きとおったゼリー', '粘性の芯核'], null],
    ['コウモリ', ['agi'], ['コウモリの翼膜', '鋭い犬歯', '音無しの耳'], null],
    ['毒キノコ', ['int_stat'], ['毒キノコの傘', '痺れ胞子', '猛毒の菌糸'], null],
    ['朝露のフェアリー', ['mp'], ['朝露のしずく', '妖精の鱗粉', 'フェアリーの羽根'], '朝'],
    ['ひなたトカゲ', ['str'], ['トカゲの尻尾', '陽だまりの鱗', '日輪の心鱗'], '昼'],
    ['月夜のフクロウ', ['dex'], ['フクロウの羽根', '静寂の風切羽', '月光の瞳'], '晩'],
    ['ビッグスライム', ['hp', 'vit'], ['大粘塊のゼリー', '王核の粘膜', 'ビッグスライムの芯核'], null],
  ],
  2: [
    ['ゴブリン', ['str'], ['ゴブリンの牙', 'ゴブリンの棍棒片', '族長の証'], null],
    ['野良犬', ['agi'], ['野良犬の毛皮', '研ぎ澄まされた爪', '野犬の心臓'], null],
    ['盗賊', ['luk'], ['盗賊の革帯', '隠しナイフ', '盗賊の秘符'], null],
    ['朝霧のワーム', ['hp'], ['ワームの粘液', '朝霧の環節', '大地喰らいの顎'], '朝'],
    ['陽炎リザード', ['str'], ['リザードの鱗', '陽炎の鱗', '灼熱の尾芯'], '昼'],
    ['夜盗の斥候', ['dex'], ['斥候の外套片', '暗視の眼帯', '影渡りの短刀'], '晩'],
    ['盗賊団のリーダー', ['str', 'luk'], ['奪われた小袋', 'リーダーの手甲', '略奪王の徽章'], null],
  ],
  3: [
    ['コボルト', ['str'], ['コボルトの毛皮', 'コボルトの牙', '洞窟王の角'], null],
    ['スケルトン', ['hp'], ['もろい骨片', '硬化した肋骨', '不朽の頭蓋'], null],
    ['ゴーレム', ['vit'], ['ゴーレムの土塊', '魔力を帯びた岩片', 'ゴーレムの動力核'], null],
    ['曙のガーゴイル', ['vit'], ['ガーゴイルの石片', '曙光の翼石', '石像の魔眼'], '朝'],
    ['石化トカゲ', ['vit'], ['石化した鱗', '岩肌の甲殻', '不動の石心'], '昼'],
    ['夜這うレイス', ['int_stat'], ['霊気の残滓', '怨嗟の衣片', 'レイスの魂核'], '晩'],
    ['古代の番人', ['int_stat', 'mp'], ['古代の石片', '番人の魔導回路', '古代文明の心臓'], null],
  ],
  4: [
    ['深海魚人', ['dex'], ['魚人の鱗', '深海の鰭', '深海の心鱗'], null],
    ['海賊', ['luk'], ['海賊の頭巾', '錆びた鉤爪', '海賊旗の切れ端'], null],
    ['毒クラゲ', ['int_stat'], ['クラゲの触手', '痺れ毒袋', '深海毒の結晶'], null],
    ['朝凪のセイレーン', ['mp'], ['セイレーンの鱗', '歌声の貝殻', '魅了の喉笛'], '朝'],
    ['潮騒のカニ', ['vit'], ['カニの殻片', '頑丈な鋏', '潮騒の甲核'], '昼'],
    ['夜光アンコウ', ['agi'], ['アンコウの提灯', '夜光の粘液', '深淵の発光器'], '晩'],
    ['シーサーペント', ['hp', 'str'], ['海竜の鱗', '海竜の逆鱗', 'シーサーペントの海心'], null],
  ],
  5: [
    ['山岳ゴブリン', ['str'], ['山ゴブリンの毛皮', '岩砕きの棍棒片', '山賊頭の兜'], null],
    ['岩石ゴーレム', ['vit'], ['巨岩の破片', '鉱脈の結晶', '岩石ゴーレムの心核'], null],
    ['グリフォン', ['agi'], ['グリフォンの羽根', '猛禽の鉤爪', 'グリフォンの風心'], null],
    ['払暁のワイバーン', ['dex'], ['ワイバーンの鱗', '飛膜の切れ端', '払暁の翼骨'], '朝'],
    ['陽射しの大猿', ['hp'], ['大猿の毛皮', '岩砕きの拳骨', '猛猿の闘魂'], '昼'],
    ['宵闇の山猫', ['luk'], ['山猫の毛皮', '宵闇の爪', '疾影の後肢'], '晩'],
    ['雷鷲サンダーロック', ['agi', 'str'], ['帯電した羽根', '雷鷲の風切羽', '雷鷲の雷嚢'], null],
  ],
  6: [
    ['雪男', ['hp'], ['雪男の白毛', '凍てつく拳', '雪山王の心臓'], null],
    ['氷河ドラゴン', ['str'], ['氷結の鱗', '氷河竜の牙', '氷河竜の逆鱗'], null],
    ['霜の精霊', ['int_stat'], ['霜のかけら', '凍気の結晶', '霜精の魔核'], null],
    ['朝焼けの氷狼', ['agi'], ['氷狼の毛皮', '凍牙', '朝焼けの氷心'], '朝'],
    ['白光の樹氷精', ['mp'], ['樹氷の枝', '白光の氷片', '樹氷の魔晶'], '昼'],
    ['極夜のワイト', ['vit'], ['凍りついた骨', '極夜の屍衣', 'ワイトの呪核'], '晩'],
    ['氷霊フロストバーン', ['int_stat', 'mp'], ['凍える霊気', 'フロストバーンの氷刃', '永久凍土の氷芯'], null],
  ],
  7: [
    ['炎の精霊', ['int_stat'], ['くすぶる残り火', '揺らめく炎心', '炎精の魔核'], null],
    ['溶岩ゴーレム', ['vit'], ['冷えた溶岩塊', '灼熱の鉱石', '溶岩ゴーレムの熔核'], null],
    ['ファイアドレイク', ['agi'], ['ドレイクの鱗', '燃える飛膜', '火竜の焔袋'], null],
    ['暁のフレイムバット', ['dex'], ['焦げた翼膜', '暁の火翼', '業火の牙'], '朝'],
    ['陽炎のイフリート', ['mp'], ['陽炎の残滓', 'イフリートの炎環', '魔炎の心核'], '昼'],
    ['熾火のデーモン', ['str'], ['デーモンの角', '熾火の皮膜', '悪魔の焔心'], '晩'],
    ['深紅のサラマンダー', ['str', 'hp'], ['深紅の鱗', 'サラマンダーの焔牙', '焔龍の心臓'], null],
  ],
  8: [
    ['天翼のハーピー', ['agi'], ['ハーピーの羽根', '天翼の風切羽', '蒼天の羽衣'], null],
    ['雷雲の精霊', ['int_stat'], ['帯電した霧片', '雷雲の結晶', '雷精の魔核'], null],
    ['天空騎士グリフィオン', ['str'], ['騎士の甲片', '蒼天の紋章盾', '天空騎士の魂鎧'], null],
    ['曙光のセラフ', ['mp'], ['聖なる羽根', '曙光の光輪', 'セラフの神核'], '朝'],
    ['白昼のペガサス', ['hp'], ['ペガサスのたてがみ', '白昼の蹄鉄', '天馬の翼心'], '昼'],
    ['星降りのヴァルキリー', ['luk'], ['戦乙女の羽根', '星屑の槍先', 'ヴァルキリーの誓約印'], '晩'],
    ['天空覇龍ウラノス', ['hp', 'vit'], ['覇龍の鱗', 'ウラノスの天鱗', '天空覇龍の龍核'], null],
  ],
}

const build = () => {
  const out = []
  for (const [areaStr, list] of Object.entries(DEF)) {
    const area = Number(areaStr)
    list.forEach(([enemy, stats, names, band], idx) => {
      const isBoss = idx === list.length - 1
      RARITIES.forEach((rarity, ri) => {
        const { lo, hi } = rangeOf(area, rarity)
        out.push({
          id: `m:${area}:${idx}:${RARITY_SHORT[rarity]}`,
          name: names[ri], enemy, area, idx, band, isBoss, rarity, stats, lo, hi,
        })
      })
    })
  }
  return out
}
export const MATERIALS = build()
export const MATERIAL_BY_ID = Object.fromEntries(MATERIALS.map(m => [m.id, m]))
export const materialsOfEnemy = (enemy) => MATERIALS.filter(m => m.enemy === enemy)
export const materialOf = (enemy, rarity) => MATERIALS.find(m => m.enemy === enemy && m.rarity === rarity) || null
export const materialsOfArea = (area) => MATERIALS.filter(m => m.area === area)

// ===== 抽出 =====
export const EXTRACT_COST = 5     // 消費する素材の数
export const BOSS_LIMIT = 1       // ボス素材は5枠に1個まで（ユニーク素材）

// 選んだ素材の並びが抽出に出せるかどうか
export const canExtract = (ids) => {
  const list = (ids || []).map(id => MATERIAL_BY_ID[id])
  if (list.length !== EXTRACT_COST || list.some(m => !m)) return '素材を5個選んでください'
  if (list.filter(m => m.isBoss).length > BOSS_LIMIT) return 'ボス素材は1個までしか入れられません'
  return null
}

// 抽出の本体。★同じ計算がSQL側（v2_extract_essence）にもある
// 戻り値 { stats, color, abilityChoices }。abilityChoices は当たった敵の名前（重複は除く）
export const extract = (ids, rng = Math.random) => {
  const err = canExtract(ids)
  if (err) return { error: err }
  const stats = {}
  const abilityChoices = []
  for (const id of ids) {
    const m = MATERIAL_BY_ID[id]
    for (const k of rollStats(m, rng)) {
      stats[k] = round1((stats[k] || 0) + rollValue(m.lo, m.hi, rng))
    }
    // 特殊能力は素材ごとに個別抽選（通常0% / レア1% / 激レア3%）
    if (rng() * 100 < ABILITY_CHANCE[m.rarity] && !abilityChoices.includes(m.enemy)) {
      abilityChoices.push(m.enemy)
    }
  }
  return { stats, color: colorOf(stats), abilityChoices }
}

// エッセンスの「強さ」を1つの数字で言うときの目安（合計%）
export const essencePower = (stats) => round1(Object.values(stats || {}).reduce((a, b) => a + Number(b || 0), 0))

// ===== エッセンスの名前 =====
// **色 × 合計値の6段**で決まる漢字2文字（2026-08-16 ユーザー決定）。
// 合計値が高いほど強そうな字にしてある。画面には「〇〇エッセンス」の形で出す
export const GRADE_MIN = [0, 2, 4, 6, 8, 10]   // この値以上で1段上がる（最後は10%以上）
// ⚠**緋を炎の語で埋めない**（2026-08-16 ユーザー指摘）。色の名前が緋なだけで、
//   中身は「攻撃寄り」なので、刃・打撃・殺気の語で組む。
// ⚠**一番下の段も弱そうな名前にしない**（微風・薄氷・火種は却下された）。
//   下の段は「小さいが鋭い」語にして、上の段で規模を大きくする。
export const ESSENCE_NAMES = {
  red:   ['鋭牙', '剛撃', '破砕', '凶刃', '撃滅', '修羅'],   // 緋＝攻撃寄り
  blue:  ['鋼殻', '堅牢', '鉄壁', '磐石', '金剛', '不動'],   // 蒼＝守り寄り
  green: ['隼影', '疾風', '旋風', '迅雷', '神速', '天翔'],   // 翠＝器用・素早さ寄り
}
// 合計値が何段目か（0〜5）
export const gradeOf = (total) => {
  let g = 0
  for (let i = 0; i < GRADE_MIN.length; i++) if (total >= GRADE_MIN[i]) g = i
  return g
}
// 「烈火」のような2文字。色と合計値から決まる
export const essenceName = (color, stats) =>
  ESSENCE_NAMES[color]?.[gradeOf(essencePower(stats))] || ''
// 「烈火エッセンス」まで含めた表示名
export const essenceFullName = (color, stats) => `${essenceName(color, stats)}エッセンス`
