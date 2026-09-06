// ============================================================
// バトルフロンティアⅡ（リメイク版）— 合成素材と「合成」
// ------------------------------------------------------------
// 設計は docs/v2-raid-design.md §6。
//
//   レイドボスを倒す →（確率）合成素材 → 鍛冶屋の「合成」で武器と合わせる
//     → その武器に**ボスの特殊能力**が付き、**名前が「◯◯の××」に変わる**
//
//   例）鋼剣 ＋ 黒龍の逆鱗 → 黒龍の鋼剣（物理ダメージ+15%）
//
// ★ここは**ユニークボスと共通の新カテゴリ**（2026-09-06 ユーザー決定）。
//   ユニークボスの設計メモが予約していた「武器に合成できる特別なアイテム」がこれ。
//   ユニークボスぶんは source:'unique' で下の表へ足すだけで済む。
//
// ★強化はこれまで通り。強化は equip_id で見ているので、**合成していても
//   「同じ武器名」であれば**強化元にも強化素材にもできる（ユーザー指示）。
//
// ⚠特殊能力の中身は enchant.js の FUSION_ABILITIES。
//   刻印（ルーン）と同じ枠で戦闘に乗せるため、あちらに置いてある。
// ============================================================
import { RAID_BOSSES } from './raid.js'
import { FUSION_ABILITIES, abilityText } from './enchant.js'
import { ITEM_BY_ID } from './equipment.js'

// ===== 素材 =====
// [ボスのkey, 素材の名前]。ability は**ボスの名前**（enchant.js の FUSION_ABILITIES のキー）
const RAID_MATS = {
  varuzenoku: '黒龍の逆鱗',
  amaza:      '雨摩座の涙石',
  zerugiasu:  '雷鋼の動力核',
  enma:       '閻魔の冥銭',
  guraudiosu: '炎獄の熾火片',
}

export const FUSIONS = RAID_BOSSES.map(b => ({
  id: `fu:${b.key}`,
  name: RAID_MATS[b.key],
  source: 'raid',        // raid / unique（ユニークボスぶんは後で足す）
  boss: b.name,
  crown: b.crown,        // 合成した武器の頭に付く名前
  ability: b.name,       // enchant.js の FUSION_ABILITIES のキー
  color: b.color,
}))
export const FUSION_BY_ID = Object.fromEntries(FUSIONS.map(f => [f.id, f]))
export const fusionOf = (id) => FUSION_BY_ID[id] || null
export const fusionOfBoss = (bossName) => FUSIONS.find(f => f.boss === bossName) || null
// その素材が付ける特殊能力の文（画面に出す）
export const fusionText = (id) => abilityText(fusionOf(id)?.ability)

// ===== 合成できるもの =====
// ★**武器だけ**（ソケットが武器だけなのと同じ理由）。防具へ広げるならここを外す
export const FUSABLE_PART = '武器'
export const canFuseItem = (item) => !!item && item.part === FUSABLE_PART

// ===== 名前 =====
// 合成すると「黒龍の鋼剣」になる。**素の名前は equip_id から引けるので保存しない**
//   （＝合成を上書きしても、外しても、いつでも元の名前に戻せる）
export const fusedName = (item, fusedBoss) => {
  const base = item?.name || ''
  const f = fusedBoss ? fusionOfBoss(fusedBoss) : null
  return f ? `${f.crown}の${base}` : base
}
// 在庫の1行（v2_inventory）から表示名を出す
export const invName = (inv) => fusedName(ITEM_BY_ID[inv?.equip_id], inv?.fused)

// ===== 選んだ組み合わせが正しいか =====
export const checkFuse = ({ inv, item, matId, have = 0 }) => {
  if (!inv || !item) return '合成する武器を選んでください'
  if (!canFuseItem(item)) return `合成できるのは${FUSABLE_PART}だけです`
  if (!matId) return '合成素材を選んでください'
  if (!fusionOf(matId)) return 'その合成素材はありません'
  if (have <= 0) return 'その合成素材を持っていません'
  return ''
}

// 装備している武器に付いている合成ぶんの特殊能力（戦闘へ渡す）
export const fusedAbilitiesOf = (items) => (items || [])
  .map(inv => inv?.fused)
  .filter(name => name && FUSION_ABILITIES[name])
