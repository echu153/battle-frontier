// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘（挑戦・試し撃ち）に持っていく技
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー指示「スキルセットでATBのマクロを作成できる場所とATB戦に持っていくスキルを設定できるように」
//   ＋選んだこと「数の上限なし」：
//   ・全部持っていってもよい。使わない技を外せるだけ（戦闘の技のボタンを減らして見やすくする）
//   ・覚えるのは「外した技」＝ v2cap_profiles.atb_off ＝ { 職業: [技の名前] }（職業ごと・スキルセットと同じ）。
//     あとで覚えた技は外していないので、そのまま持っていく側に入る。まだ何も外していなければ今までどおり全部
//   ・保存は v2cap_set_atb_off（SQL §27）。挑戦の写し（v2cap_battle_snap）にそのまま入る＝画面もサーバーの回し直しも同じ技で戦う
//   ・マクロに足せるのは持っていく技だけ。外した技がマクロに残っていたら、戦闘では飛ばす（lib/atbMacro.js の macroEntriesOf）
// 画面はスキルセットの「挑戦（ATB）」（components/V2capSkillsAtb.jsx）
// ============================================================
import { usableSkillNames, lineageOf } from './jobs.js'

// 1つの職業で外せる数の上限（技は多くて17個。形のおかしい送り物を弾くだけ）。⚠SQL の c_max と同じ（v2capsql.test.js が突き合わせる）
export const ATB_OFF_MAX = 64

// その職業で外した技の名前（文字だけ・重なりなし）
export const atbOffOf = (prof, cls = prof?.class) => {
  const raw = prof?.atb_off?.[cls]
  return Array.isArray(raw) ? [...new Set(raw.filter(s => typeof s === 'string'))] : []
}
// その職業で使える覚えた技（パッシブ以外・下位職のぶんも・並び＝名簿の順）
export const atbUsableOf = (prof, cls = prof?.class) => usableSkillNames(cls, prof?.learned || [], lineageOf(cls))
// ATB戦闘に持っていく技（使える覚えた技から、外した技を除く）
export const atbSkillNamesOf = (prof, cls = prof?.class) => {
  const off = new Set(atbOffOf(prof, cls))
  return atbUsableOf(prof, cls).filter(n => !off.has(n))
}

// 保存できなかったときの文言。保存の関数がまだサーバーに無い（SQL を流す前）ときは、英語のまま出さずに案内する
export const saveErrText = (error, data) => (/could not find the function/i.test(error?.message || '')
  ? 'サーバーにまだ保存の仕組みがありません（SQLを流すと保存できます）'
  : (error?.message || data?.error || '保存できませんでした'))

// 保存の前の確かめ（サーバーの v2cap_set_atb_off と同じ決まり・同じ文言）。usable＝その職業で使える覚えた技の名前
export const validateAtbOff = (names, usable = []) => {
  if (!Array.isArray(names)) return '外す技の形式が不正です'
  if (names.length > ATB_OFF_MAX) return `外す技は${ATB_OFF_MAX}個までです`
  const have = new Set(usable)
  for (const s of names) {
    if (typeof s !== 'string') return '外す技の形式が不正です'
    if (!have.has(s)) return `${s}はいまのクラスで使える覚えた技ではありません`
  }
  return null
}
