// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— LVとEXP
// ------------------------------------------------------------
// 設計は docs/v2cap-design.md。ステータスの種類（8種）と初期値・戦闘力の数え方は今のⅡと同じ（src/v2/lib/stats.js）。違うのは：
//   ・**LVアップでステは上がらない**。かわりに**ステータスポイント**が入り、自分で振る（下の pointsForLv）
//   ・**転職しても下がらない**。LV100で止まり、周回（LV1に戻る）は無い
//   ・必要EXPはMMORPGのように、上がるほど重くなる（下の needExp）
//   ・1勝で入るEXPは**場所ごとの表の値**（areas.js。先の場所ほど多い・朝昼晩1.5倍・レア3倍・ボス5倍）
//
// ★このファイルは表示とシミュレーション用の写し。**権威はサーバー**
//   （supabase_v2cap_core.sql の v2cap_need / v2cap_sortie_settle / v2cap_apply_exp）。
//   式を変えるときは必ず両方を直すこと（v2capsql.test.js が突き合わせる）。
// ============================================================
import { STAT_KEYS, STAT_DEFS, INITIAL_STATS, calcPower } from '../../v2/lib/stats.js'

export { STAT_KEYS, INITIAL_STATS, calcPower }

export const MAX_LV = 100

// ===== 必要EXP =====
// 次のLVまでの必要EXP ＝ 係数 × LV³（千分率の整数 NEED_PERMIL で持つ）。
//   1勝のEXPは場所が進むほど増え、だいたいLVに比例する（始まりの森で2〜3・深淵の海溝で30強）。
//   なのでLV³にすると、そのLVで要る勝ち数がLV²に比例する＝上がるほど重い（MMORPG式）。
//   係数は「1日1時間でLV100まで約1年」になるように tools/v2cap-progress.mjs --tune で回して決める。
//   （2026-10-09 エリアの作り替えで、1体のEXPが「敵のLV＋9」から場所ごとの表の値へ変わり、
//     約1/4になったので式ごと作り直した。前は 0.335×LV²×(LV＋9)）
//   ⚠小数のまま掛けると、端数が .5 ちょうどになる所でSQLの round と食い違うことがある。
//   なので**千分率の整数で掛けてから1000で割る**（SQLの v2cap_need も同じ形）
// ★let なのは tools/v2cap-progress.mjs --tune が回しながら差し替えるため（ゲームの中では変えない）
export let NEED_PERMIL = 135
export const setNeedPermilForTuning = (v) => { NEED_PERMIL = v }
export const needExp = (lv) => (lv >= MAX_LV ? 0 : Math.max(1, Math.round(NEED_PERMIL * lv * lv * lv / 1000)))

// LV1からそのLVに着くまでの合計
export const totalExpTo = (lv) => {
  let t = 0
  for (let l = 1; l < Math.min(lv, MAX_LV); l++) t += needExp(l)
  return t
}

// ★1勝で入るEXP・Goldは sortie.js の rollRewards（場所の表 × 役割の倍率）。決めるのはサーバー

// ===== ステータスポイント =====
// 【確定】2026-10-09 ユーザー指示「通常のレベル上がるときはステータス一切上げないで、ステータスポイント3振れるようにしよう、
//   5の倍数は3じゃなくて5ポイントで」：LVアップではステは上がらず、そのLVに上がったときにポイントが入る
//   （LV2・3・4は3、LV5は5、LV6〜9は3、LV10は5…）。LV100までの合計は337。
// 【確定】振れるのは8種すべて（ユーザー決定）。1ポイントで HP+8・MP+3・ほか+1（どれに振っても戦闘力+1）。
//   振り直しはいまはできない（ユーザー決定）。
// ★サーバーの v2cap_apply_exp（入るポイント）と v2cap_allocate_points（振る）が同じ決まり（v2capsql.test.js が見張る）
export const POINTS_PER_LV = 3
export const POINTS_STEP = 5        // このLVの倍数では
export const POINTS_ON_STEP = 5     // ポイントがこれだけ入る
export const pointsForLv = (lv) => (lv % POINTS_STEP === 0 ? POINTS_ON_STEP : POINTS_PER_LV)
const POINTS_TO = [0, 0]            // LV1からそのLVに着くまでに入るポイントの合計
for (let l = 2; l <= MAX_LV; l++) POINTS_TO[l] = POINTS_TO[l - 1] + pointsForLv(l)
export const totalPointsTo = (lv) => POINTS_TO[Math.max(1, Math.min(MAX_LV, Math.floor(lv || 1)))]
// 1ポイントで上がる量（HP+8・MP+3・ほか+1＝今のⅡの「戦闘力1」と同じ換算）
export const POINT_UNIT = Object.fromEntries(STAT_KEYS.map(k => [k, STAT_DEFS[k].unit]))
// 振り方を確かめる。add＝{ str: 3, hp: 1, … }（8種のどれか・0以上の整数）。だめなら理由（サーバーと同じ文言）
export const validateAllocation = (add, have) => {
  if (!add || typeof add !== 'object' || Array.isArray(add)) return '振り方の形式が不正です'
  let sum = 0
  for (const [k, v] of Object.entries(add)) {
    if (!STAT_KEYS.includes(k)) return `${k}には振れません`
    if (!Number.isInteger(v) || v < 0) return '振る数は0以上の整数で指定してください'
    sum += v
  }
  if (sum <= 0) return 'ポイントを1以上振ってください'
  if (sum > (have || 0)) return 'ポイントが足りません'
  return null
}
// 振ったあとのステ（state のステに足す）
export const applyAllocation = (state, add) => Object.fromEntries(STAT_KEYS.map(k => [k, (state[k] || 0) + (add[k] || 0) * POINT_UNIT[k]]))

// ===== 本体の戦闘力の目安 =====
// LV1の初期ステは戦闘力39。ポイントは1つで戦闘力+1なので、全部振ったときの本体＝39＋そのLVまでのポイント。
// ★装備の強さ（gear.js：ノーマルを全部そろえると本体と同じくらい）と、敵の標準の戦闘力（areas.js）の物差し
export const BODY_POWER_LV1 = calcPower(INITIAL_STATS)
export const bodyPowerAt = (lv) => BODY_POWER_LV1 + totalPointsTo(lv)

// ===== EXPを入れてLVアップまで処理する（純関数・表示とシミュレーション用）=====
// 実際の保存は必ずRPC経由。state は書き換えず新しいオブジェクトを返す。
// LVアップではステは上がらず、ポイント（points）が入る。返すのは 新しいLV・EXP・入ったポイントの合計・LVごとの内訳
export const applyExp = (state, amount) => {
  let lv = state.lv || 1
  let exp = state.exp || 0
  let points = 0
  const levelUps = []
  if (lv < MAX_LV && amount > 0) {
    exp += amount
    while (lv < MAX_LV && exp >= needExp(lv)) {
      exp -= needExp(lv)
      lv += 1
      const p = pointsForLv(lv)
      points += p
      levelUps.push({ lv, points: p })
    }
    if (lv >= MAX_LV) exp = 0   // 上限に着いたら、あふれたぶんは捨てる
  }
  return { lv, exp, points, levelUps }
}

// ===== スタミナ（オート出撃の燃料）=====
// 【確定】**回復は3分に1**・**最大値はLVが1上がるごとに+1**（2026-10-09 ユーザー指示）。
//   LV1で10＝「10＋(LV−1)」＝LV100で109。今のⅡ（5分に1・転職回数で伸びる）とは別に、この版で持つ。
// ★数える権威はサーバー（v2cap_stamina_max / v2cap_stamina_roll）。ここはその写し（v2capsql.test.js が突き合わせる）
export const STAMINA_BASE = 10
export const staminaMaxOf = (lv) => STAMINA_BASE + Math.max(1, Math.floor(lv || 1)) - 1
export const STAMINA_RECOVER_MS = 3 * 60 * 1000

// 経過時間ぶんを足して数え直す（今のⅡの rollStamina と同じ数え方で、間隔だけこの版の3分）。at＝最後に数え直した時刻
//   ・端数は捨てない＝消化したぶんだけ at を進める ／ 満タンになったら at は「いま」へ
export const rollStamina = (stamina, at, max, now = Date.now()) => {
  const cap = Math.max(0, Math.floor(Number(max) || 0))
  const cur = Math.max(0, Math.min(cap, Math.floor(Number(stamina) || 0)))
  const base = at ? new Date(at).getTime() : now
  if (cur >= cap) return { n: cap, at: now }
  const gained = Math.max(0, Math.floor((now - base) / STAMINA_RECOVER_MS))
  const n = Math.min(cap, cur + gained)
  return { n, at: n >= cap ? now : base + gained * STAMINA_RECOVER_MS }
}
// 次の1が溜まるまでの残りms。満タンなら0
export const msToNextStamina = (stamina, at, max, now = Date.now()) => {
  const r = rollStamina(stamina, at, max, now)
  if (r.n >= Math.max(0, Math.floor(Number(max) || 0))) return 0
  return Math.max(0, STAMINA_RECOVER_MS - (now - r.at))
}
