// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の自分（試し撃ち・IDダンジョンで同じ）
// ------------------------------------------------------------
// いまの装備・ステのまま、持っている技（下位職のぶんも）を全部持たせる＝ATBの決まり（枠なし・core/atb.js）
// ============================================================
import { toFighter as playerFighter, slotsOf } from './loadout.js'
import { usableSkillNames, lineageOf } from './jobs.js'
import { ascEffectsOf } from './ascension.js'

export const atbPlayerOf = (prof, inventory) => {
  const cls = prof?.class
  const lineage = lineageOf(cls)
  const names = usableSkillNames(cls, prof?.learned || [], lineage)
  return { ...playerFighter(prof, inventory), slots: slotsOf(names.map(name => ({ name, uses: 1 })), cls, lineage, ascEffectsOf(prof).ups) }
}
