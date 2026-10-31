// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の自分（試し撃ち・IDダンジョンで同じ）
// ------------------------------------------------------------
// いまの装備・ステのまま、持っている技（下位職のぶんも）を全部持たせる＝ATBの決まり（枠なし・core/atb.js）
// ============================================================
import { toFighter as playerFighter, slotsOf } from './loadout.js'
import { usableSkillNames, lineageOf } from './jobs.js'
import { ascEffectsOf } from './ascension.js'

// opts … loadout.js の toFighter と同じ（挑戦は時刻と食事を決めて渡す＝画面とサーバーで同じ形になる・dungeonVerify.js）
export const atbPlayerOf = (prof, inventory, opts = {}) => {
  const cls = prof?.class
  const lineage = lineageOf(cls)
  const names = usableSkillNames(cls, prof?.learned || [], lineage)
  return { ...playerFighter(prof, inventory, opts), slots: slotsOf(names.map(name => ({ name, uses: 1 })), cls, lineage, ascEffectsOf(prof).ups) }
}
