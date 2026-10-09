// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 出撃
// ------------------------------------------------------------
// 進み方は今のⅡと同じ（src/v2/lib/sortie.js）：
//   ・10秒に1回。ボスは1戦ごとに+0.3%ずつ出やすくなり、出会うと0へ戻る
//   ・その難易度帯のボスを全部倒すと、次の帯が開く（一度開いた帯は閉じない）
//   ・装備は勝ったとき3%で落ちる。部位は1時間ごとに「落ちやすい部位」が入れ替わる
//   ・ランクはエリアごとの分布
// この版で違うのは：
//   ・敵が**LV**を持つ（areas.js）。EXPもアイテムLVも敵のLVで決まる
//   ・**武器はいまの職業が装備できる3種から**落ちる（2026-10-09 ユーザー承認）。種類の中の基本装備は均等
//   ・防具は重鎧／軽装を半々、その部位の基本装備から均等。アクセは4つから均等
//   ・レアモンスター・ルーン素材・守りの護符・レイドは土台では無し
// ============================================================
import { areaOf, enemyLvOf } from './areas.js'
import { rollDropRank } from '../../v2/lib/enemies.js'
import { weaponsOfType, armorsOf, accessories, ARMOR_LINES } from './equipment.js'
import { weaponsOf } from './jobs.js'
import {
  rollBoss, nextBossRate, enemyPoolAt, bandAt, rollHasEquipDrop, rollDropPart,
  isAreaUnlocked, unlockNext, clearNext, restToOpenNext, clearedAreasOf, isAreaCleared,
  LAST_TIER, SORTIE_CD, EQUIP_DROP_RATE, BOSS_RATE_STEP,
} from '../../v2/lib/sortie.js'

export {
  nextBossRate, bandAt, isAreaUnlocked, unlockNext, clearNext, restToOpenNext,
  clearedAreasOf, isAreaCleared, LAST_TIER, SORTIE_CD, EQUIP_DROP_RATE, BOSS_RATE_STEP,
}

// 次に出会う敵。ボスの抽選が先で、外れたら雑魚（その時間帯の敵を含む）から均等に1体
export const pickEncounter = (areaId, bossRate, at = new Date(), rng = Math.random) => {
  const area = areaOf(areaId)
  if (!area) return null
  const isBoss = rollBoss(bossRate, rng)
  const pool = enemyPoolAt(area, at)
  const enemy = isBoss ? area.boss : pool[Math.floor(rng() * pool.length)]
  return { area, enemy, isBoss, lv: enemyLvOf(enemy.name), band: bandAt(at) }
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)]

// 落ちる基本装備を1つ選ぶ（部位は呼び出し側）
export const rollBaseItem = (part, cls, rng = Math.random) => {
  if (part === '武器') {
    const types = weaponsOf(cls)
    return types.length ? pick(weaponsOfType(pick(types, rng)), rng) : null
  }
  if (part === 'アクセ') return pick(accessories(), rng)
  return pick(armorsOf(part, pick(ARMOR_LINES, rng)), rng)
}

// 勝ったときの装備。落ちたら { item, rank, ilv }。**アイテムLV＝倒した敵のLV**
export const rollEquipDrop = (enc, cls, at = new Date(), rng = Math.random) => {
  if (!enc || !rollHasEquipDrop(rng)) return null
  const item = rollBaseItem(rollDropPart(at, rng), cls, rng)
  return item ? { item, rank: rollDropRank(enc.area, rng), ilv: enc.lv } : null
}
