// ============================================================
// バトルフロンティアⅡ（リメイク版）— 合成素材と「合成」
// ------------------------------------------------------------
// 設計は docs/v2-raid-design.md §6。
//
//   合成素材を手に入れる → 鍛冶屋の「合成」で武器と合わせる
//     → その武器に**特殊能力**が付き、**名前が「◯◯の××」に変わる**
//
//   例）鋼剣 ＋ スライムの因子 → スライムの鋼剣（物理ダメージ軽減+2%）
//       鋼剣 ＋ 黒龍の逆鱗   → 黒龍の鋼剣（物理ダメージ+15% ほか）
//
// ★2026-09-06 ユーザー指示で**特殊能力の入手経路をここへ一本化した**。
//   それまでは「ルーンを抽出するとき稀に付く」形だったが、
//   **ルーンはステータス%だけ**になり、特殊能力は全部この合成素材から入る。
//
// ★合成素材は2種類の出どころがある
//   ・source:'enemy' … 出撃の敵270体ぶん。**倒した敵から一律1%**で落ちる
//   ・source:'raid'  … レイドボス5体ぶん。討伐の報酬でしか出ない
//   ユニークボスぶんは後から source:'unique' で足す。
//
// ★**合成に使う素材は1個**（2026-09-06 ユーザー決定）。
// ★**付けられるのは武器だけ**（2026-09-06 ユーザー再確認）。
// ★強化はこれまで通り。強化は equip_id で見ているので、**合成していても
//   「同じ武器名」であれば**強化元にも強化素材にもできる。
//
// ⚠特殊能力の中身は enchant.js（敵ぶんは ENCHANTS・レイドぶんは FUSION_ABILITIES）。
//   刻印と同じ枠で戦闘に乗せるため、あちらに置いてある。
// ============================================================
import { RAID_BOSSES } from './raid.js'
import { ABILITY_OF, abilityText } from './enchant.js'
import { ITEM_BY_ID } from './equipment.js'
import { MATERIALS } from './material.js'

// ===== 合成に使う数（2026-09-06 ユーザー決定）=====
export const FUSE_COST = 1
// 敵の合成素材が落ちる確率(%)。★レア度による差は無く**一律**
export const ENEMY_FUSION_RATE = 1

// ===== 名前の作り方 =====
// ★敵ぶんは「◯◯の因子」で機械的に作る（2026-09-06 ユーザー決定）。
//   ルーン素材（スライムのゼリー等）と見分けがつき、敵を足しても自動で名前が付く。
export const ENEMY_SUFFIX = 'の因子'
export const enemyFusionName = (enemy) => `${enemy}${ENEMY_SUFFIX}`

// ===== 敵270体ぶん =====
// ★idは**ルーン素材のidから機械的に作る**（fu:m:1:0 / fu:mr:1:0）。
//   material.js の並びに乗るので、敵を足しても既存のidが1つも動かない。
const enemyFusions = () => MATERIALS
  .filter(m => m.rarity === 'normal')   // 敵ごとに1行だけ拾う
  .map(m => ({
    id: `fu:${m.id.replace(/:[nru]$/, '')}`,
    name: enemyFusionName(m.enemy),
    source: 'enemy',
    boss: m.enemy,        // 特殊能力のキー（＝敵の名前）。DBの列名に合わせて boss のまま
    crown: m.enemy,       // 合成した武器の頭に付く名前
    ability: m.enemy,
    area: m.area,
    tier: m.tier,
    isBoss: !!m.isBoss,
    isRare: !!m.isRare,
    color: m.isBoss ? '#ffcc44' : m.isRare ? '#66ccff' : '#a8c4d6',
  }))

// ===== レイドボス5体ぶん =====
// [ボスのkey, 素材の名前]
const RAID_MATS = {
  varuzenoku: '黒龍の逆鱗',
  amaza:      '雨摩座の涙石',
  zerugiasu:  '雷鋼の動力核',
  enma:       '閻魔の冥銭',
  guraudiosu: '炎獄の熾火片',
}
const raidFusions = () => RAID_BOSSES.map(b => ({
  id: `fu:${b.key}`,
  name: RAID_MATS[b.key],
  source: 'raid',
  boss: b.name,
  crown: b.crown,        // 合成した武器の頭に付く名前（黒龍・雨摩座…）
  ability: b.name,
  area: null,
  tier: null,
  color: b.color,
}))

export const FUSIONS = [...enemyFusions(), ...raidFusions()]
export const FUSION_BY_ID = Object.fromEntries(FUSIONS.map(f => [f.id, f]))
export const FUSION_BY_BOSS = Object.fromEntries(FUSIONS.map(f => [f.boss, f]))
export const fusionOf = (id) => FUSION_BY_ID[id] || null
export const fusionOfBoss = (bossName) => FUSION_BY_BOSS[bossName] || null
export const fusionsOfSource = (source) => FUSIONS.filter(f => f.source === source)
// その素材が付ける特殊能力の文（画面に出す）
export const fusionText = (id) => abilityText(fusionOf(id)?.ability)
// その敵の合成素材（出撃のドロップで引く）
export const fusionOfEnemy = (enemy) => fusionOfBoss(enemy)

// ===== 合成できるもの =====
// ★**武器だけ**（2026-09-06 ユーザー再確認）。防具へ広げるならここを外す
export const FUSABLE_PART = '武器'
export const canFuseItem = (item) => !!item && item.part === FUSABLE_PART

// ===== 名前 =====
// 合成すると「スライムの鋼剣」「黒龍の鋼剣」になる。
// **素の名前は equip_id から引けるので保存しない**
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
  if (have < FUSE_COST) return 'その合成素材を持っていません'
  return ''
}

// 装備している武器に付いている合成ぶんの特殊能力（戦闘へ渡す）
export const fusedAbilitiesOf = (items) => (items || [])
  .map(inv => inv?.fused)
  .filter(name => name && ABILITY_OF[name])
