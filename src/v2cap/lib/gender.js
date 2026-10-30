// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— キャラクターの性別
// ------------------------------------------------------------
// 【確定】2026-10-21 ユーザー指示「キャラクター作成時に性別選択できるようにして、性別によってほんの少し性能差出るようにしたい」
//   →候補からユーザーが選んだ「男性＝与えるダメージ+2%／女性＝受けるダメージ−2%」
//   （物理も魔法も同じ＝どの職業でも同じくらいの価値なので、見た目で選んでも損をしない）。
//   選べるのは**キャラ作成のときだけ**（ユーザー「一旦作成でだけ、後でアイテムで性別変えれるようにする」）。あとから変えるのは商店の性別変更薬（2026-10-31・lib/shop.js）。
//   性別を持たない前からのキャラは、ホームで1回だけ選ぶ（サーバーの v2cap_set_gender は性別が空のときだけ通す）
// ・戦闘には防具のセット能力・ユニークと同じ入れ物（fighter.setFx の sexDeal・sexCut）で渡す（loadout.js の toFighter）
//   ＝出撃・ボス・覇天塔（守護者の姿も setFx を持ち運ぶ）・ユニークの確かめのどれでも同じに効く
// ・セット能力の dealPct・takenCut とは別の項目にした：あちらは切り捨ての前に掛けるので、1発が数ダメージの序盤は
//   −2%が−27%（2→1）・+2%が±0%になった（LV5で測った）。性別は切り捨てたあとに掛けて端数を確率で丸める
//   （src/v2cap/core/battleSet.js の sexAdjust）＝どのLVでも平均でちょうど±2%
// ・ステと戦闘力は変えない（戦闘の中のダメージだけ）
// ★イラストの男女（classArt.js の ART_GENDERS・神殿の切り替え）は見るだけの切り替えとして残す。
//   戦闘ログと覇天塔の自分のアイコンはキャラの性別（性別が無いキャラだけ、今までどおり神殿の切り替え）
// ============================================================
import { ART_GENDERS } from './classArt.js'

const EFFECT = {
  m: { fx: { sexDeal: 2 }, text: '与えるダメージ+2%' },
  f: { fx: { sexCut: 2 }, text: '受けるダメージ−2%' },
}
// { key, label, mark, color, fx, text }（名前・記号・色は神殿の切り替えと同じ）
export const GENDERS = ART_GENDERS.map(g => ({ key: g.key, label: g.label, mark: g.mark, color: g.color, ...EFFECT[g.key] }))
export const GENDER_BY_KEY = Object.fromEntries(GENDERS.map(g => [g.key, g]))
export const isGender = (g) => Object.hasOwn(GENDER_BY_KEY, g ?? '')

// キャラの性別（'m'／'f'。まだ決めていなければ null）
export const genderOf = (profile) => (isGender(profile?.gender) ? profile.gender : null)
// 戦闘の入れ物（setFx）に重ねる能力。性別が無ければ null（今までと同じ）
export const genderFxOf = (g) => GENDER_BY_KEY[g]?.fx || null
// 絵の男女：キャラの性別。まだ決めていなければ fallback（神殿の切り替え＝端末の capArtGender）
export const artGenderOf = (profile, fallback = 'm') => genderOf(profile) || (isGender(fallback) ? fallback : 'm')
