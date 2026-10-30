import { bandAt } from '../core/sortie.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 商店（2026-10-31）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー指示「施設で商店を追加したい。現状以下のアイテムを購入できるように」：
//   名前・効き方・値段はユーザーが候補から選んだ。値段は LV によらず同じ。
//   買ったらその場で飲む（持ち物に入れない＝消耗品を入れる場所がまだ無い）
//   ・性別変更薬 … 男女が入れ替わる
//   ・日月反転の秘薬（ユーザーの案は「昼夜逆転薬」）… 60分、時間帯が12時間ずれる。時間帯は朝・昼・晩の3つ（各8時間）で単純に入れ替えられないので、
//     ユーザーが「12時間ずらす」を選んだ＝必ず今と違う時間帯になる。効いているあいだに飲むと60分延びる（こちらで決めた）
//   ★変わるのは出会う敵だけ（時間限定の敵とレア＝pickEncounter に渡す時刻）。
//     本当の時刻で決まるもの（落ちやすい部位・デイリーの区切り・NPC の夜のセリフ）は変えない
//   ★買う・Gold はサーバー（v2cap_shop_buy）。値段と時間の写しは SQL §24（shop.test.js が突き合わせる）
// ============================================================
export const SHOP_COLOR = '#5fe0d0'
export const FLIP_COLOR = '#ffcc66'
export const FLIP_NAME = '日月反転の秘薬'
export const FLIP_MINUTES = 60
export const FLIP_HOURS = 12
export const SHOP_ITEMS = [
  { key:'gender', name:'性別変更薬', icon:'🧪', color:'#ff88cc', gold:30000 },
  { key:'flip', name:FLIP_NAME, icon:'🌗', color:FLIP_COLOR, gold:3000 },
]
export const SHOP_ITEM_BY_KEY = Object.fromEntries(SHOP_ITEMS.map(i => [i.key, i]))

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
