// ============================================================
// バトルフロンティアⅡ（リメイク版）— エンチャントの素材とルーン抽出
// ------------------------------------------------------------
// 設計は docs/v2-enchant-design.md。
//
//   敵を倒す → 素材が落ちる（通常 / レア / 激レア）
//           → 素材5個を消費して「抽出」→ ルーン
//           → ルーンを武器のソケットにはめる
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
import { tierOf } from './enemies.js'

export const RARITIES = ['normal', 'rare', 'ultra']
export const RARITY_LABEL = { normal:'通常', rare:'レア', ultra:'激レア' }
export const RARITY_SHORT = { normal:'n', rare:'r', ultra:'u' }
export const RARITY_COLOR = { normal:'#a8c4d6', rare:'#66ccff', ultra:'#ffcc44' }

// ===== レンジ =====
// 上限は**難易度帯**で決まり、下限だけレア度で上がる。刻みは0.1%。**全体の最大は2.0%**
// ⚠キーはエリアIDではなく tier（同じ帯のエリアはどれも同じレンジ・enemies.js）
export const STEP = 0.1
export const TIER_RATE_MAX = { 1:1.0, 2:1.0, 3:1.3, 4:1.3, 5:1.6, 6:1.6, 7:2.0, 8:2.0 }
export const RARITY_FLOOR_RATE = { normal:0, rare:0.3, ultra:0.5 }  // 0 は「最低の0.1から」
const round1 = (v) => Math.round(v * 10) / 10

// ★ボス素材もレンジは雑魚と同じ（2026-08-16 ユーザー決定「ボスだけ下げないで」）。
//   2ステータス持ちなので、合計では雑魚素材のちょうど2倍になる。
//   ⚠isBoss は呼び出し側の都合で残してあるだけで、レンジには効かない
export const capOf = (area) => TIER_RATE_MAX[tierOf(area)]
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
// 合計値を3グループで合算して、一番大きいグループがルーンの色
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
  9: [
    ['砂喰いワーム', ['vit'], ['砂まみれの外皮', '砂喰いの顎', '灼砂の胃石'], null],
    ['墓守のミイラ', ['hp'], ['朽ちた包帯', '墓守の護符', '不朽の心臓'], null],
    ['砂蠍サンドスコーピオン', ['dex'], ['蠍の甲殻', '毒針の欠片', '砂蠍の猛毒嚢'], null],
    ['陽炎のミラージュ', ['int_stat'], ['揺らめく陽炎', '幻影の砂片', '蜃気楼の核'], '朝'],
    ['灼熱のアヌビス', ['str'], ['聖獣の耳飾り', '灼熱の錫杖', '冥導者の首飾り'], '昼'],
    ['月砂のジャッカル', ['agi'], ['ジャッカルの毛皮', '月砂の牙', '疾走の後肢'], '晩'],
    ['砂皇スカラベウス', ['vit', 'hp'], ['黄金の鞘翅', 'スカラベウスの角', '砂皇の黄金核'], null],
  ],
  10: [
    ['食人樹', ['str'], ['絡みつく蔓', '食人樹の牙葉', '樹魔の芯木'], null],
    ['毒霧のマンドラゴラ', ['int_stat'], ['マンドラゴラの根', '毒霧の胞子', '絶叫の球根'], null],
    ['影狼シャドウウルフ', ['agi'], ['影狼の毛皮', '闇夜の爪', '影渡りの後肢'], null],
    ['朝靄のトレント', ['vit'], ['苔むした樹皮', '朝靄の若枝', '古木の年輪核'], '朝'],
    ['木漏れ日のピクシー', ['mp'], ['ピクシーの羽根', '木漏れ日の粉', '妖精王の雫'], '昼'],
    ['常闇のバンシー', ['luk'], ['破れた喪服', '嘆きの涙石', '常闇の呪印'], '晩'],
    ['森王エルダートレント', ['hp', 'vit'], ['大樹の樹皮', 'エルダートレントの根', '森王の生命核'], null],
  ],
  11: [
    ['嵐鳥ストームバード', ['agi'], ['嵐鳥の風切羽', '雷雲の羽毛', '疾風の翼骨'], null],
    ['雷刃のガーゴイル', ['dex'], ['帯電した石片', '雷刃の爪', 'ガーゴイルの雷核'], null],
    ['断崖のトロール', ['vit'], ['トロールの厚皮', '断崖の岩拳', '巨人の頑健骨'], null],
    ['暁雲のサンダーホーク', ['str'], ['鷹の雷羽', '暁雲の鉤爪', '雷鷹の心羽'], '朝'],
    ['雷光のエレメンタル', ['int_stat'], ['雷光の残滓', '放電する結晶', '雷精の閃核'], '昼'],
    ['雷鳴のワイバーン', ['hp'], ['雷鳴の鱗', '裂けた飛膜', '轟雷の逆鱗'], '晩'],
    ['雷帝ケラウノス', ['int_stat', 'agi'], ['帝竜の雷鱗', 'ケラウノスの雷角', '天雷の帝核'], null],
  ],
  12: [
    ['沼のヒュドラ', ['str'], ['ヒュドラの鱗', '沼毒の牙', '再生する首'], null],
    ['腐食スライム', ['int_stat'], ['腐食した粘液', '溶解の核', '腐海の原液'], null],
    ['沼底のリザードマン', ['dex'], ['沼底の鱗', '沼底の骨槍', '毒沼の心鱗'], null],
    ['朝霞のウィルオウィスプ', ['mp'], ['ゆらめく鬼火', '朝霞の灯芯', '惑わしの魂火'], '朝'],
    ['陽だまりの大蛙', ['hp'], ['大蛙の粘皮', '伸縮する舌', '飽食の胃袋'], '昼'],
    ['夜霧のゾンビ', ['vit'], ['腐った腕', '夜霧の屍布', '不死の腐核'], '晩'],
    ['毒龍ヴェノムヒュドラ', ['str', 'int_stat'], ['毒龍の鱗', 'ヴェノムヒュドラの猛毒牙', '腐海の毒心核'], null],
  ],
  13: [
    ['坑道のグール', ['dex'], ['グールの爪', '錆びたつるはし', '屍喰いの顎'], null],
    ['鉱石ゴーレム', ['vit'], ['砕けた鉱石', '純度の高い鉱脈', '鉱石ゴーレムの動力核'], null],
    ['闇喰いコウモリ', ['agi'], ['闇喰いの翼膜', '反響する耳', '無音の飛膜'], null],
    ['曙光のクリスタルワーム', ['int_stat'], ['水晶の欠片', '曙光の結晶', '虹映の魔晶'], '朝'],
    ['灯火のドワーフ亡霊', ['str'], ['亡霊の鉄槌', '消えぬ灯火', '坑夫王の遺志'], '昼'],
    ['深穴のシャドウ', ['mp'], ['よどんだ影', '深穴の闇片', '虚無の魔核'], '晩'],
    ['巌喰いガイアモール', ['hp', 'str'], ['巨大な鉤爪', 'ガイアモールの牙', '大地喰らいの熱核'], null],
  ],
  14: [
    ['星読みの石像', ['int_stat'], ['星読みの石片', '刻まれた星図', '天測儀の核'], null],
    ['遺跡守護機構', ['vit'], ['守護機構の装甲', '古代の歯車', '不朽の駆動核'], null],
    ['時喰いのクロノワーム', ['agi'], ['時喰いの外殻', '砂時計の砂', '刻を喰う顎'], null],
    ['暁星のアストラルナイト', ['str'], ['星鋼の兜', '暁星の剣先', '星霊騎士の魂片'], '朝'],
    ['白日のスフィンクス', ['mp'], ['獅子の鬣', '謎かけの石板', '白日の叡智核'], '昼'],
    ['星宿のルナリス', ['luk'], ['月光の裾布', '星宿の耳飾り', 'ルナリスの月華石'], '晩'],
    ['時星龍アイオーン', ['int_stat', 'mp'], ['星霜の龍鱗', 'アイオーンの時角', '悠久の星核'], null],
  ],
  15: [
    ['深淵のクラーケン', ['str'], ['クラーケンの吸盤', '断ち切れた触腕', '深淵の墨袋'], null],
    ['海淵のリヴァイアサン幼体', ['hp'], ['幼体の鱗', '未熟な逆鱗', '海淵の胎動核'], null],
    ['冥暗のシーウィッチ', ['int_stat'], ['海妖の髪', '呪詛の巻貝', '冥暗の魔核'], null],
    ['朝凪の海竜', ['dex'], ['海竜の背鰭', '朝凪の鱗', '静海の心鱗'], '朝'],
    ['陽射しの巨鯨', ['vit'], ['巨鯨の皮脂', '潮吹きの噴気孔', '海獣の巨心'], '昼'],
    ['深海のセイレーン女王', ['mp'], ['女王の鱗衣', '蒼海の宝冠', '魅惑の歌声'], '晩'],
    ['深海覇王リヴァイアサン', ['hp', 'vit'], ['覇王の巨鱗', 'リヴァイアサンの逆鱗', '深淵覇王の海心'], null],
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
          name: names[ri], enemy, area, tier: tierOf(area), idx, band, isBoss, rarity, stats, lo, hi,
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
// 同じ難易度帯の素材ぜんぶ（釣りの副産物・メダル交換所は「帯」でまとめて扱う）
export const materialsOfTier = (tier) => MATERIALS.filter(m => m.tier === tier)

// ===== NPCへの売却 =====
// ★**v2で唯一Goldが湧く場所**（2026-08-17 ユーザー決定「敵からGoldは落とさない」）。
//   設計は docs/v2-gold-design.md。取引所の手数料だけがGoldを消すので、
//   **ここの値がそのままv2のインフレの蛇口**になる。
//
// 値の引き方（2026-08-22 ユーザー決定で**大幅に引き下げ**）：
//   基準は**デイリーミッション「かんたん」の100G**（daily.js の LEVELS）。
//   ・①帯の激レア1個 ＝ 120G ＝ **デイリー1回ぶん**（通常素材は3G＝数を集めてやっと）
//   ・帯が1つ上がるごとに約1.5倍（①3G → ⑧54G）。**基準額は3の倍数**にしてある
//     ＝拠点の「資材3個＝通常素材1個」がGoldでもきっちり釣り合う（basecamp.js の MATERIAL_SELL）
//   ・レア度の倍率は**出にくさの2倍**（レアは4倍出にくいので×8／激レアは20倍なので×40）
//     ＝レアを引いた価値がちゃんと出る。
//   素材は1戦闘に最大1個・通常20% / レア5% / 激レア1%＝合計26%しか落ちないので、
//   1戦闘あたりの期待Goldは 0.20B + 0.05×8B + 0.01×40B = **B そのもの**（①で3G）。
//   実際はルーン作成にも素材を使う（売るか使うかの二択）ので、収入はこれより下がる。
//   ⚠**旧値は①40G〜⑧2330G（激レア46600G）**で、デイリーの100Gが霞むほど高かった。
//
// ⚠**サーバーにも同じ表がある**（supabase_v2_core.sql の v2_materials.sell）。
//   売却の権威はサーバー側。**片方だけ直すと v2sql.test.js が落ちる**
// ⚠キーは**難易度帯**（同じ帯のエリアはどのエリアの素材でも同じ値段）
export const SELL_BASE_TIER = { 1:3, 2:6, 3:9, 4:12, 5:18, 6:24, 7:36, 8:54 }
export const SELL_RARITY_MULT = { normal:1, rare:8, ultra:40 }
export const sellPriceOf = (m) =>
  m ? (SELL_BASE_TIER[m.tier] || 0) * (SELL_RARITY_MULT[m.rarity] || 0) : 0
// [{ id, qty }] の合計。持っている数を超えていないかは呼び出し側とサーバーが見る
export const sellTotalOf = (items) =>
  (items || []).reduce((t, it) => t + sellPriceOf(MATERIAL_BY_ID[it.id]) * Math.max(0, it.qty || 0), 0)

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

// ルーンの「強さ」を1つの数字で言うときの目安（合計%）
export const runePower = (stats) => round1(Object.values(stats || {}).reduce((a, b) => a + Number(b || 0), 0))

// ===== ルーンの名前 =====
// **色 × 合計値の6段**で決まる漢字2文字（2026-08-16 ユーザー決定）。
// 合計値が高いほど強そうな字にしてある。画面には「〇〇ルーン」の形で出す
export const GRADE_MIN = [0, 2, 4, 6, 8, 10]   // この値以上で1段上がる（最後は10%以上）
// ⚠**緋を炎の語で埋めない**（2026-08-16 ユーザー指摘）。色の名前が緋なだけで、
//   中身は「攻撃寄り」なので、刃・打撃・殺気の語で組む。
// ⚠**一番下の段も弱そうな名前にしない**（微風・薄氷・火種は却下された）。
//   下の段は「小さいが鋭い」語にして、上の段で規模を大きくする。
export const RUNE_NAMES = {
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
export const runeName = (color, stats) =>
  RUNE_NAMES[color]?.[gradeOf(runePower(stats))] || ''
// 「烈火ルーン」まで含めた表示名
export const runeFullName = (color, stats) => `${runeName(color, stats)}ルーン`
