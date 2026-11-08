import { bandAt } from '../core/sortie.js'
import { BATTLE_ITEM_BY_KEY, ITEM_MAX, itemCountsOf } from '../core/atbItems.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 商店（2026-10-31）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「挑戦とかで使用できるアイテムもここで販売してほしい・HPポーション 500・MPポーション 500・状態異常回復する薬 1000」：
//   挑戦で使う薬（bag）＝持ち物（サーバーの v2cap_profiles.items）に入り、挑戦の戦闘で飲む（効き方は core/atbItems.js）。何個か選んで買う。持ち込む数は挑戦のポップアップで選ぶ（合計4つまで）
// 【確定】2026-10-31 ユーザー指示「施設で商店を追加したい。現状以下のアイテムを購入できるように」：
//   名前・効き方・値段はユーザーが候補から選んだ。値段は LV によらず同じ。
//   下の2つは買ったらその場で飲む（持ち物に入れない）
//   ・性別変更薬 … 男女が入れ替わる
//   ・日月反転の秘薬（ユーザーの案は「昼夜逆転薬」）… 60分、時間帯が12時間ずれる。時間帯は朝・昼・晩の3つ（各8時間）で単純に入れ替えられないので、
//     ユーザーが「12時間ずらす」を選んだ＝必ず今と違う時間帯になる。効いているあいだに飲むと60分延びる（こちらで決めた）
//   ★変わるのは出会う敵だけ（時間限定の敵とレア＝pickEncounter に渡す時刻）。
//     本当の時刻で決まるもの（落ちやすい部位・デイリーの区切り・NPC の夜のセリフ）は変えない
//   ★買う・Gold はサーバー（v2cap_shop_buy）。値段と時間の写しは SQL §24（shop.test.js が突き合わせる）
// 【確定】2026-11-09 ユーザー指示「商店にステータス振りなおしのアイテム追加する」＋選んだこと「10,000G」「忘却の秘薬」：
//   その場で飲む。割り振ったステータスポイントが全部戻る（本体のステは初期値へ・数え方は level.js の spentPointsOf）。
//   まだ振っていなければ買えない（Gold を無駄にしない）。戻ったポイントはホームのステータスから振り直す
// ============================================================
export const SHOP_COLOR = '#5fe0d0'
export const FLIP_COLOR = '#ffcc66'
export const FLIP_NAME = '日月反転の秘薬'
export const FLIP_MINUTES = 60
export const FLIP_HOURS = 12
export const FORGET_NAME = '忘却の秘薬'
export const SHOP_ITEMS = [
  { ...BATTLE_ITEM_BY_KEY.hp, gold:500, bag:true },
  { ...BATTLE_ITEM_BY_KEY.mp, gold:500, bag:true },
  { ...BATTLE_ITEM_BY_KEY.cure, gold:1000, bag:true },
  { key:'gender', name:'性別変更薬', icon:'🧪', color:'#ff88cc', gold:30000 },
  { key:'flip', name:FLIP_NAME, icon:'🌗', color:FLIP_COLOR, gold:3000 },
  { key:'forget', name:FORGET_NAME, icon:'🌀', color:'#b79bff', gold:10000 },
]
export const SHOP_ITEM_BY_KEY = Object.fromEntries(SHOP_ITEMS.map(i => [i.key, i]))

// 挑戦で使う薬：持っている数・いま買える数（Gold と持てる数の少ないほう）
export const itemCountOf = (profile, key) => itemCountsOf(profile?.items)[key] || 0
export const buyableQtyOf = (profile, item) =>
  Math.max(0, Math.min(Math.floor((Number(profile?.gold) || 0) / item.gold), ITEM_MAX - itemCountOf(profile, item.key)))

const MINUTE_MS = 60 * 1000
const FLIP_SHIFT_MS = FLIP_HOURS * 60 * MINUTE_MS
const shifted = (at) => new Date(at.getTime() + FLIP_SHIFT_MS)

// 男女を入れ替えた性別（性別がまだ無ければ null）
export const otherGenderOf = (g) => (g === 'm' ? 'f' : g === 'f' ? 'm' : null)

// 日月反転の秘薬の残り（ms）。効いていなければ 0
export const flipLeftMsOf = (profile, at = Date.now()) => {
  const until = profile?.flip_until ? new Date(profile.flip_until).getTime() : NaN
  const now = at instanceof Date ? at.getTime() : Number(at)
  return Number.isFinite(until) && until > now ? until - now : 0
}
// 出会う敵を決める時刻（pickEncounter に渡す）。効いているあいだは12時間ずれる
export const encounterClockOf = (profile, at = new Date()) => (flipLeftMsOf(profile, at) > 0 ? shifted(at) : at)
// いま出会う敵の時間帯（秘薬のぶんを含む）
export const encounterBandOf = (profile, at = new Date()) => bandAt(encounterClockOf(profile, at))

// 飲む前に見せるもの：to＝飲んだあとの時間帯・leftMs＝飲んだあとの残り・change＝効いているあいだに時間帯が変わるなら { minutes, band }
//   本当の時刻が進むので、ずれた先の時間帯も進む（朝8時55分に飲むと夜8時55分＝昼だが、5分後に晩になる）
export const flipPreviewOf = (profile, at = new Date()) => {
  const leftMs = flipLeftMsOf(profile, at) + FLIP_MINUTES * MINUTE_MS
  const to = bandAt(shifted(at))
  for (let m = 1; m * MINUTE_MS < leftMs; m++) {
    const band = bandAt(shifted(new Date(at.getTime() + m * MINUTE_MS)))
    if (band !== to) return { to, leftMs, change: { minutes: m, band } }
  }
  return { to, leftMs, change: null }
}
