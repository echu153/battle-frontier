// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 防具のセット能力
// ------------------------------------------------------------
// 【確定】2026-10-14 ユーザーの表（2部位・3部位・4部位）＋決めたこと：
//   ・**レア以上（レア・エピック・レジェンダリー）の防具**を、**同じエリア・同じ系統（重鎧どうし／軽装どうし）**で
//     2部位以上着けると発動（ユーザー「やっぱり2部位3部位4部位すべて重鎧軽装揃えないと発動しないようにして」）。
//     数えるのは防具の4種（頭・鎧・腕・足）だけ。レア度は混ぜてよい。**必要LVに足りない防具も数える**（ユーザー選択）
//   ・2部位・3部位の効果は重鎧と軽装で共通、4部位は系統ごとに別（ユーザー「4部位は重鎧と軽装は違くていい、2部位3部位も共通でいい」）
//     2部位 … その場所の状態異常に**かかる確率を3割減らす**（確率×0.7・ユーザー選択「確率を3割減らす」）。深淵の海溝はすべての状態異常を2割
//     3部位 … エリアごとの能力値+5%（表の「3部位（軽装）」の列を共通に＝ユーザー選択）。深淵の海溝は STR〜LUK の6種+3%（ユーザー選択）
//     4部位 … 表のとおり。「付与確率+10%」などは**確率を1割増やす**（×1.1・ユーザー選択）。「回避+8%」「クリティカル率+8%」「相手の命中-8%」は%ポイント
//     ★蒼海の入り江の軽装「海賊の嗅覚」は「ドロップ率+10%」をやめて**レア以上が落ちる確率1.2倍**（ユーザー指示・1.2倍はユーザー選択）
//   ・違うエリア（または違う系統）の2部位ずつなら、2つのセットが同時に発動する
// 戦闘で使う形（fighter.setFx）は setFxOf が作り、今のⅡの戦闘エンジンの src/v2/lib/battleSet.js が読む（項目の意味はそちらの冒頭）。
// 3部位の能力値+%は戦闘の前にステへ足す（loadout.js の statBreakdown の set）。海賊の嗅覚は出撃のドロップ（sortie.js）
// ============================================================
import { STAT_DEFS } from '../../v2/lib/stats.js'
import { AIL_LABEL } from '../../v2/lib/ailments.js'
import { AREA_LIST } from './areas.js'

// セットに数える部位とレア度
export const SET_PARTS = ['頭', '鎧', '腕', '足']
export const SET_RARITIES = ['R', 'E', 'L']
export const SET_TIERS = [2, 3, 4]
// 2部位の「かかる確率−%」（深淵の海溝は ALL で20%）
export const SET_RESIST_PCT = 30
export const SET_RESIST_ALL_PCT = 20

const ALL6 = { str: 3, dex: 3, agi: 3, int_stat: 3, vit: 3, luk: 3 }
// エリア1〜15（areas.js の AREA_LIST の順）。two＝2部位の状態異常（'all'＝すべて）・three＝3部位の能力値+%・four＝4部位（系統ごと）
export const ARMOR_SETS = [
  { two: ['poison'], three: { agi: 5 }, four: {
    重鎧: { name: '森の恵み', desc: '毎ターン最大HPの2%を回復', fx: { regenPct: 2 } },
    軽装: { name: '若葉の息吹', desc: '戦闘開始時に最大MPの10%を回復（MPは満タンで始まるので、最大MPを超えて増える）', fx: { mpStartPct: 10 } } } },
  { two: ['bleed'], three: { str: 5 }, four: {
    重鎧: { name: '古兵の意地', desc: 'HP30%以下のとき受けるダメージ-15%', fx: { lowHpCut: { at: 30, cut: 15 } } },
    軽装: { name: '群狼の牙', desc: '出血している相手への与ダメージ+10%', fx: { vsAilDmg: [{ key: 'bleed', pct: 10 }] } } } },
  { two: ['curse'], three: { int_stat: 5 }, four: {
    重鎧: { name: '番人の守り', desc: '戦闘中1回、倒れるダメージを受けてもHP1で耐える', fx: { gutsOnce: true } },
    軽装: { name: '遺物の加護', desc: '自分が受ける状態異常の持続-1ターン', fx: { ailTurnsCut: 1 } } } },
  { two: ['blind'], three: { dex: 5 }, four: {
    重鎧: { name: '珊瑚の甲殻', desc: '受ける物理ダメージ-8%', fx: { physCut: 8 } },
    軽装: { name: '海賊の嗅覚', desc: 'レア以上の装備が落ちる確率1.2倍', fx: { rareDropMult: 1.2 } } } },
  { two: ['slow'], three: { int_stat: 5 }, four: {
    重鎧: { name: '砂嵐の帳', desc: '相手の命中-8%', fx: { evaBonus: 8 } },
    軽装: { name: '蜃気楼', desc: '戦闘中1回、攻撃を完全に回避', fx: { dodgeOnce: true } } } },
  { two: ['fear'], three: { str: 5 }, four: {
    重鎧: { name: '巨人の剛力', desc: 'VITの10%をSTRに加算', fx: { convertAdds: [{ from: 'vit', to: 'str', pct: 10 }] } },
    軽装: { name: '峰風', desc: '自分のAGIが相手より高いとき与ダメージ+8%', fx: { fasterDmg: 8 } } } },
  { two: ['poison', 'blind'], three: { int_stat: 5 }, four: {
    重鎧: { name: '根を張る', desc: '受けたダメージの5%を次のターンに回復', fx: { rootHealPct: 5 } },
    軽装: { name: '夜霧', desc: '毒・暗闇の付与確率+10%', fx: { inflictUp: { poison: 10, blind: 10 } } } } },
  { two: ['slow', 'seal'], three: { int_stat: 5 }, four: {
    重鎧: { name: '氷河の守り', desc: '鈍足の相手から受けるダメージ-10%', fx: { vsSlowCut: 10 } },
    軽装: { name: '霊峰の加護', desc: 'スキルのMP消費-10%', fx: { mpCut: 10 } } } },
  { two: ['paralyze'], three: { agi: 5 }, four: {
    重鎧: { name: '帯電装甲', desc: '攻撃を受けると15%で相手を麻痺', fx: { counterAil: [{ key: 'paralyze', chance: 15 }] } },
    軽装: { name: '迅雷', desc: '戦闘開始から3ターン、AGI+20%', fx: { earlyBuff: { turns: 3, table: { agi: 20 } } } } } },
  { two: ['burn'], three: { str: 5 }, four: {
    重鎧: { name: '炎獄の鎧', desc: '攻撃を受けると20%で相手を火傷', fx: { counterAil: [{ key: 'burn', chance: 20 }] } },
    軽装: { name: '業火', desc: '火傷している相手への与ダメージ+10%', fx: { vsAilDmg: [{ key: 'burn', pct: 10 }] } } } },
  { two: ['poison', 'curse'], three: { int_stat: 5 }, four: {
    重鎧: { name: '毒龍の鱗', desc: '自分が状態異常の間、VIT+10%', fx: { whileAilStat: { vit: 10 } } },
    軽装: { name: '瘴気', desc: '毒の付与確率+15%・毒のダメージ+20%', fx: { inflictUp: { poison: 15 }, poisonDmgPct: 20 } } } },
  { two: ['blind', 'fear'], three: { dex: 5 }, four: {
    重鎧: { name: '大地の守り', desc: '受けるクリティカルダメージ-20%', fx: { critTakenCut: 20 } },
    軽装: { name: '蜘蛛の糸', desc: '鈍足の付与確率+15%・鈍足の相手への与ダメージ+8%', fx: { inflictUp: { slow: 15 }, vsAilDmg: [{ key: 'slow', pct: 8 }] } } } },
  { two: ['paralyze', 'seal'], three: { agi: 5 }, four: {
    重鎧: { name: '天騎士の誓い', desc: '戦闘中1回、HP30%以下で最大HPの20%を回復', fx: { lowHpHealOnce: { at: 30, pct: 20 } } },
    軽装: { name: '天翼', desc: '回避+8%', fx: { evaBonus: 8 } } } },
  { two: ['slow', 'curse'], three: { int_stat: 5 }, four: {
    重鎧: { name: '悠久の守り', desc: '自分の強化の持続+1ターン', fx: { buffTurnsUp: 1 } },
    軽装: { name: '星詠み', desc: 'クリティカル率+8%', fx: { critBonus: 8 } } } },
  { two: 'all', three: ALL6, four: {
    重鎧: { name: '深淵の加護', desc: '受けるダメージ-8%・状態異常の持続-1ターン', fx: { takenCut: 8, ailTurnsCut: 1 } },
    軽装: { name: '深淵の力', desc: '与ダメージ+8%・状態異常の付与確率+10%', fx: { dealPct: 8, inflictUpAll: 10 } } } },
]
export const armorSetOf = (area) => ARMOR_SETS[(area || 0) - 1] || null

// ===== 文 =====
const statText = (stats) => {
  const ks = Object.keys(stats)
  const v = stats[ks[0]]
  return ks.length >= 6 && ks.every(k => stats[k] === v)
    ? `全能力+${v}%（STR・DEX・AGI・INT・VIT・LUK）`
    : ks.map(k => `${STAT_DEFS[k]?.label || k}+${stats[k]}%`).join('・')
}
export const setTierText = (def, tier, line) => {
  if (!def) return ''
  if (tier === 2) {
    return def.two === 'all'
      ? `すべての状態異常にかかる確率-${SET_RESIST_ALL_PCT}%`
      : `${def.two.map(k => AIL_LABEL[k]).join('・')}にかかる確率-${SET_RESIST_PCT}%`
  }
  if (tier === 3) return statText(def.three)
  const f = def.four[line]
  return f ? `${f.name}：${f.desc}` : ''
}
export const setLabel = (area, line) => `${AREA_LIST[area - 1]?.name || `エリア${area}`}・${line}`

// ===== どのセットが発動しているか =====
// その防具がセットに数えられるか（レア以上の、頭・鎧・腕・足の重鎧／軽装。初期装備＝エリア0は数えない）
export const isSetPiece = (item) =>
  !!item && !!item.line && SET_PARTS.includes(item.part) && SET_RARITIES.includes(item.rarity) && !!armorSetOf(item.area)
// items … 着けている装備（equipment.js の ITEMS の1件）の配列。必要LVは見ない（足りなくても数える）
// 返すのは2部位以上の組だけ：[{ area, line, count, tiers:[2,3?,4?], def }]（エリア→重鎧→軽装の順）
export const armorSetsOf = (items) => {
  const groups = new Map()
  for (const it of items || []) {
    if (!isSetPiece(it)) continue
    const key = `${it.area}|${it.line}`
    const g = groups.get(key) || { area: it.area, line: it.line, count: 0 }
    g.count += 1
    groups.set(key, g)
  }
  return [...groups.values()]
    .filter(g => g.count >= 2)
    .sort((a, b) => a.area - b.area || (a.line === '重鎧' ? -1 : 1))
    .map(g => ({ ...g, tiers: SET_TIERS.filter(n => g.count >= n), def: armorSetOf(g.area) }))
}

// 3部位の能力値+%（発動しているセットを足し合わせる）
export const setStatPctOf = (sets) => {
  const out = {}
  for (const s of sets || []) {
    if (!s.tiers.includes(3)) continue
    for (const [k, v] of Object.entries(s.def.three)) out[k] = (out[k] || 0) + v
  }
  return out
}

// 戦闘で使う形（src/v2/lib/battleSet.js が読む）。何も発動していなければ null
// ★確率の項目は倍率にする（2部位：かかる確率×0.7・深淵の海溝×0.8／付与確率+10%：×1.1）。2つのセットが同じ状態異常を持てば掛け合わせる
export const setFxOf = (sets) => {
  const fx = {}
  const names = {}
  let any = false
  for (const s of sets || []) {
    any = true
    if (s.def.two === 'all') fx.resistAll = (fx.resistAll ?? 1) * (1 - SET_RESIST_ALL_PCT / 100)
    else for (const k of s.def.two) (fx.resist ||= {})[k] = (fx.resist?.[k] ?? 1) * (1 - SET_RESIST_PCT / 100)
    if (!s.tiers.includes(4)) continue
    const f = s.def.four[s.line]
    for (const [k, v] of Object.entries(f.fx)) {
      names[k] = f.name
      if (k === 'inflictUp') {
        for (const [ak, pct] of Object.entries(v)) (fx.inflictUp ||= {})[ak] = (fx.inflictUp?.[ak] ?? 1) * (1 + pct / 100)
      } else if (k === 'inflictUpAll') {
        fx.inflictUpAll = (fx.inflictUpAll ?? 1) * (1 + v / 100)
      } else if (k === 'rareDropMult') {
        fx.rareDropMult = (fx.rareDropMult ?? 1) * v
      } else if (Array.isArray(v)) {
        fx[k] = [...(fx[k] || []), ...v.map(x => ({ ...x }))]
      } else if (typeof v === 'number') {
        fx[k] = (fx[k] || 0) + v
      } else if (typeof v === 'object') {
        fx[k] = JSON.parse(JSON.stringify(v))
      } else {
        fx[k] = v
      }
    }
  }
  return any ? { ...fx, names } : null
}
