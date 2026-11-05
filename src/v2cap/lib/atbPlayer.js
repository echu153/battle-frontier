// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の自分（試し撃ち・IDダンジョンで同じ）
// ------------------------------------------------------------
// いまの装備・ステのまま、持っていく技（下位職のぶんも）を持たせる＝ATBの決まり（枠なし・core/atb.js）
//   【確定】2026-11-06 持っていく技はスキルセットの「挑戦（ATB）」で選べる（数の上限なし・外した技は持たない＝lib/atbSkills.js）。
//   何も外していなければ、覚えた技を全部持つ（前と同じ）
// ============================================================
import { toFighter as playerFighter, slotsOf } from './loadout.js'
import { lineageOf } from './jobs.js'
import { ascEffectsOf } from './ascension.js'
import { atbSkillNamesOf } from './atbSkills.js'

// opts … loadout.js の toFighter と同じ（挑戦は時刻と食事を決めて渡す＝画面とサーバーで同じ形になる・dungeonVerify.js）
export const atbPlayerOf = (prof, inventory, opts = {}) => {
  const cls = prof?.class
  const names = atbSkillNamesOf(prof, cls)
  return { ...playerFighter(prof, inventory, opts), slots: slotsOf(names.map(name => ({ name, uses: 1 })), cls, lineageOf(cls), ascEffectsOf(prof).ups) }
}
