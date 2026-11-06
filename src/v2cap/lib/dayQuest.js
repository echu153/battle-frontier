// ============================================================
// 「レベルキャップあり」版（v2cap）— 日替わりクエストの曜日のクエスト（戦闘と回し直し）
// ------------------------------------------------------------
// 決まりと経緯は lib/dayQuestRules.js（曜日・数）。戦い方は案山子と同じ（lib/scarecrow.js の動かない的・60秒・同じ目安の表）
// ★ダメージはサーバーが同じ戦闘を回し直して決める（案山子と同じ・Vercel の関数に kind:'dayquest' で頼む）。Gold を入れるのは SQL の v2cap_dayquest_verify_settle
// ★どのクエストかはサーバーが決めて預かる（始めた日の曜日・v2cap_dayquest_start）。回し直しは預かった quest で作る
// ============================================================
import { idleTargetOf, startIdleAtb, verifyIdleWith, SCARECROW_PCT_MIN } from './scarecrow.js'
import { DAY_QUESTS } from './dayQuestRules.js'

export * from './dayQuestRules.js'

// そのクエストの相手（いまは全部、案山子と同じ守りの動かない的＝目安の表をそのまま使う）
export const dayQuestFighter = (quest, lv) => {
  const q = DAY_QUESTS[quest]
  return q ? idleTargetOf(lv, q.name) : null
}
// 戦闘を作る。quest・seed・snap は v2cap_dayquest_start の返事（画面）か、サーバーが預かった同じ値（回し直し）
export const startDayQuestAtb = ({ quest, seed, snap }) => {
  const foe = dayQuestFighter(quest, snap.prof?.lv)
  if (!foe) throw new Error(`知らないクエスト：${quest}`)
  return startIdleAtb(foe, { seed, snap })
}
// 回し直し（Vercel の関数・lib/dungeonVerifyApi.js）。知らないクエストは「おかしい」で割合は下限
export const verifyDayQuest = ({ quest, ...args }) => {
  if (!DAY_QUESTS[quest]) return { damage: 0, pct: SCARECROW_PCT_MIN, steps: 0, reason: 'quest' }
  return verifyIdleWith((a) => startDayQuestAtb({ quest, ...a }), args)
}
