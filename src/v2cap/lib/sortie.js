// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 出撃
// ------------------------------------------------------------
// 進み方は今のⅡと同じ（src/v2/lib/sortie.js）：
//   ・10秒に1回。ボスは1戦ごとに+0.3%ずつ出やすくなり、出会うと0へ戻る
//   ・その難易度帯のボスを全部倒すと、次の帯が開く（一度開いた帯は閉じない）
//   ・装備は勝ったとき3%で落ちる。部位は1時間ごとに「落ちやすい部位」が入れ替わる
// この版で違うのは：
//   ・敵が**LV**を持つ（areas.js）。EXPもアイテムLVも敵のLVで決まる
//   ・レアモンスター・ルーン素材・守りの護符・レイドは土台では無し
// ============================================================
import { areaOf, enemyLvOf } from './areas.js'
import {
  rollBoss, nextBossRate, enemyPoolAt, bandAt, rollHasEquipDrop, rollDrop,
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

// 勝ったときの装備。落ちたら { item, ilv }。**アイテムLV＝倒した敵のLV**
export const rollEquipDrop = (enc, at = new Date(), rng = Math.random) => {
  if (!enc || !rollHasEquipDrop(rng)) return null
  const item = rollDrop(enc.area.id, at, rng)
  return item ? { item, ilv: enc.lv } : null
}
