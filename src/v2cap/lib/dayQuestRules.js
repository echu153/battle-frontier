// ============================================================
// 「レベルキャップあり」版（v2cap）— 日替わりクエスト（冒険の枠・旧「修練場」）の曜日と数だけ
//   ホームのメニューも読む軽いファイル（戦闘の部品を読まない）。戦闘と回し直しは lib/dayQuest.js
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー「修練場の枠、他にもコンテンツ入れるから名前変えたい」「案山子以外は曜日で変わるコンテンツにする予定」
//   「このコンテンツはAM5時にリセット」「土日はGold効率いいクエストにする予定」「ミミックみたいな宝箱系＋Gold系のモンスター」
//   「月～金はあとで決めるから一旦土台作って」→ 選んだ（どれも推奨）：
//   ・枠の名前は「日替わりクエスト」。中は 毎日の案山子（lib/scarecrow.js）＋ 曜日のクエスト（ここ）
//   ・切り替わりは日本時間の朝5時（挑戦・案山子と同じ v2cap_dungeon_today）。曜日もその日で決める（土曜の朝4時はまだ金曜）
//   ・土日：宝箱に住む金貨の魔物。戦い方は案山子と同じ（ATB 60秒・反撃しない・状態異常にならない・1日1回・エリア①のクリアで開く）
//     入るのは Gold＝LV×500（目安どおりで。デイリーミッション5つぶん）× 与えたダメージの割合（50〜150%・案山子と同じ物差し）
//   ・月〜金：まだ決めていない（DAY_QUEST_BY_DOW が null＝その日は曜日のクエストが無い）
// ⚠曜日の割り当て・数は SQL（§30 の v2cap_dayquest_of・v2cap_dayquest_gold）と同じ（dayQuest.test.js が突き合わせる）
// ============================================================
import { SCARECROW_UNLOCK_SPOT, SCARECROW_PCT_MIN, SCARECROW_PCT_MAX, isScarecrowOpen } from './scarecrowRules.js'

export const DAY_QUEST_TITLE = '日替わりクエスト'
export const DAY_QUEST_RESET_HOUR = 5   // 日本時間の朝5時で次の日
const JST_MS = 9 * 3600 * 1000
// 遊ぶ日の曜日（0＝日 … 6＝土）。日本時間から5時間戻した日の曜日＝SQL の extract(dow from v2cap_dungeon_today())
export const playDowOf = (ms = Date.now()) => new Date(Number(ms) + JST_MS - DAY_QUEST_RESET_HOUR * 3600 * 1000).getUTCDay()
export const DOW_LABEL = ['日', '月', '火', '水', '木', '金', '土']

// ===== 曜日のクエスト =====
// 土日の宝箱の魔物（絵はユーザーが描く・lib/cofferArt.js）
export const COFFER_KEY = 'coffer'
export const COFFER_NAME = 'タカラモチ'   // 11-06 ユーザーが選んだ名前（宝持ち）
export const COFFER_GOLD_PER_LV = 500   // 目安どおり（100%）のときの Gold＝LV×これ
// クエストの一覧（key は SQL の quest 列と同じ）。reward＝入るもの
export const DAY_QUESTS = {
  [COFFER_KEY]: { key: COFFER_KEY, name: COFFER_NAME, reward: 'gold' },
}
// 曜日（0＝日 … 6＝土）ごとのクエスト。null＝その曜日は無い（月〜金はあとで決める）
export const DAY_QUEST_BY_DOW = [COFFER_KEY, null, null, null, null, null, COFFER_KEY]
export const dayQuestOfDow = (dow) => DAY_QUESTS[DAY_QUEST_BY_DOW[dow]] || null
export const dayQuestOn = (ms = Date.now()) => dayQuestOfDow(playDowOf(ms))
// そのクエストの曜日（「土・日」）
export const dowsOfQuest = (key) => [6, 0, 1, 2, 3, 4, 5].filter(d => DAY_QUEST_BY_DOW[d] === key).map(d => DOW_LABEL[d]).join('・')

// 開く条件は案山子と同じ（エリア①のクリア）
export const DAY_QUEST_UNLOCK_SPOT = SCARECROW_UNLOCK_SPOT
export const isDayQuestOpen = (cleared) => isScarecrowOpen(cleared)

// 入る Gold（SQL の v2cap_dayquest_gold と同じ）：LV×500 × 割合（50〜150%）・切り上げ
export const cofferGoldOf = (lv, pct) => Math.ceil(Math.max(1, Math.floor(Number(lv) || 1)) * COFFER_GOLD_PER_LV * Math.max(SCARECROW_PCT_MIN, Math.min(SCARECROW_PCT_MAX, Math.round(Number(pct) || SCARECROW_PCT_MIN))) / 100)
