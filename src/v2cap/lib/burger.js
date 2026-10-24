// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— ハンバーガー屋「ニャーガーキング」
// ------------------------------------------------------------
// 【確定】2026-10-25 ユーザー指示「食べ物を食べたら一定時間ステータスや特殊効果つく機能」「バーガーキングモチーフのハンバーガーショップ」：
//   ・店の名前はユーザーの案「ニャーガーキング」（猫＋バーガーキング）
//   ・Goldで買って食べる。効くのは **60分**（本当の時間・ログインしていない間も減る）。食べ直したら上書き（前のは消える）
//   ・バーガー（1,000G）… STR・DEX・AGI・INT・VIT・LUK のどれか1つが **+10%**（HP・MPは上がらない）。名前はユーザーの6つ
//   ・トッピング（バーガーに足す・メジャー500G／マイナー500G・両方で1,000G）… 頼んだ組の中から**1つがランダム**で乗り、
//     その状態異常に**かかる確率−20%**（ユーザー「メジャーな状態異常とマイナーな状態異常の語群があって、そこから1つずつ抽選」）
//       メジャー＝敵がよく使う5種（敵300体のうち 出血67・毒48・鈍足37・麻痺32・火傷21体）
//       マイナー＝封印・恐怖（敵は少し）と、プレイヤーの技にしかない暗闇・呪い・狂乱・衰弱（塔で効く）
//       回復阻害・サイレンスは v2cap で敵も技も使わないので入れない（ユーザー承認）
//   ・トッピングの名前はバーガーの名前とかぶらないもの（チーズ→エッグ・アボカド→パイナップルに変えた・ユーザー承認）
//   ・サイドメニューは今回なし（中身が決まってから）
//   ・出撃・ボス・塔への挑戦で効く。塔の守護者として残す姿（snapshotOf）には入れない（loadout.js の toFighter に meal:null）
// ★買う・抽選・Goldを減らす・期限はサーバー（SQL §16 の v2cap_burger_buy）。プロフィールの meal_burger／meal_major／meal_minor／meal_until。
//   値段・時間・組の中身はここが写し（v2capsql.test.js が突き合わせる）。戦闘は画面で回すので、効き目はここから loadout.js が足す
// ============================================================
import { AIL_LABEL } from '../core/ailments.js'
import { STAT_DEFS } from '../core/stats.js'

export const SHOP_NAME = 'ニャーガーキング'
export const MEAL_COLOR = '#ffa64d'   // 画面で食事の文字に使う色（焼き色のオレンジ）
export const MEAL_MINUTES = 60
export const MEAL_MS = MEAL_MINUTES * 60 * 1000
export const BURGER_GOLD = 1000
export const TOPPING_GOLD = 500
export const MEAL_STAT_PCT = 10        // バーガーで上がるステの%
export const TOPPING_RESIST_PCT = 20   // トッピングでかかりにくくなる%（確率に 0.8 を掛ける）

// バーガー（並びはステの並び）。名前はユーザーの6つ（2026-10-25）
export const BURGERS = [
  { stat: 'str',      name: 'スパイシーニャッパー' },
  { stat: 'dex',      name: 'テリヤキニャッパー' },
  { stat: 'agi',      name: 'チキンニャッパー' },
  { stat: 'int_stat', name: 'マッシュルームニャッパー' },
  { stat: 'vit',      name: 'アボカドニャッパー' },
  { stat: 'luk',      name: 'チーズニャッパー' },
]
export const BURGER_BY_STAT = Object.fromEntries(BURGERS.map(b => [b.stat, b]))
export const MEAL_STATS = BURGERS.map(b => b.stat)

// トッピング。group＝メジャー／マイナー（どちらを頼むかで抽選する組が決まる）。note＝由来（画面に出す）
export const TOPPING_GROUPS = [
  { key: 'major', label: 'メジャー', note: '敵がよく使う状態異常' },
  { key: 'minor', label: 'マイナー', note: 'めったに出ない状態異常（塔で効くものも）' },
]
export const TOPPINGS = [
  { ail: 'bleed',    group: 'major', name: 'トマト',           note: '赤い実で血がめぐる' },
  { ail: 'poison',   group: 'major', name: 'ピクルス',         note: 'すっぱさで毒を消す' },
  { ail: 'slow',     group: 'major', name: 'ブラックペッパー', note: 'ピリッと目がさめる' },
  { ail: 'paralyze', group: 'major', name: 'マスタード',       note: 'しびれる辛さに慣れる' },
  { ail: 'burn',     group: 'major', name: 'ハラペーニョ',     note: '辛さで熱に強くなる' },
  { ail: 'seal',     group: 'minor', name: 'エッグ',           note: '殻を破る＝封を破る' },
  { ail: 'fear',     group: 'minor', name: 'ベーコン',         note: '肉で気が大きくなる' },
  { ail: 'blind',    group: 'minor', name: 'オニオン',         note: 'しみる涙で目が洗われる' },
  { ail: 'curse',    group: 'minor', name: 'ガーリック',       note: '魔よけ' },
  { ail: 'frenzy',   group: 'minor', name: 'レタス',           note: '気持ちが落ち着く' },
  { ail: 'weaken',   group: 'minor', name: 'パイナップル',     note: '甘ずっぱさで元気が出る' },
]
export const TOPPING_BY_AIL = Object.fromEntries(TOPPINGS.map(t => [t.ail, t]))
export const toppingsOf = (group) => TOPPINGS.filter(t => t.group === group)

// 値段。major・minor＝そのトッピングを頼むか
export const mealCostOf = ({ major = false, minor = false } = {}) =>
  BURGER_GOLD + (major ? TOPPING_GOLD : 0) + (minor ? TOPPING_GOLD : 0)

// いま効いている食事（無い・切れた・中身が正しくない → null）。at＝いまの時刻（ms・Date）
//   { stat, burger, major, minor（ailのキー or null）, until（ms）, leftMs }
export const activeMealOf = (profile, at = Date.now()) => {
  const burger = BURGER_BY_STAT[profile?.meal_burger]
  const until = profile?.meal_until ? new Date(profile.meal_until).getTime() : NaN
  const now = at instanceof Date ? at.getTime() : Number(at)
  if (!burger || !Number.isFinite(until) || until <= now) return null
  const pick = (k, group) => (TOPPING_BY_AIL[k]?.group === group ? k : null)
  return {
    stat: burger.stat, burger,
    major: pick(profile.meal_major, 'major'), minor: pick(profile.meal_minor, 'minor'),
    until, leftMs: until - now,
  }
}

// ステの%（statBreakdown が合計に掛ける）
export const mealStatPctOf = (meal) => (meal ? { [meal.stat]: MEAL_STAT_PCT } : {})
// 戦闘の入れ物（fighter.setFx に mergeFx で重ねる）。トッピングが無ければ null
export const mealFxOf = (meal) => {
  const ails = [meal?.major, meal?.minor].filter(Boolean)
  if (!ails.length) return null
  return { resist: Object.fromEntries(ails.map(k => [k, (100 - TOPPING_RESIST_PCT) / 100])) }
}

// 画面の文
export const toppingText = (ail) => `${TOPPING_BY_AIL[ail]?.name || '？'}（${AIL_LABEL[ail] || ail}にかかる確率−${TOPPING_RESIST_PCT}%）`
export const burgerEffectText = (stat) => `${STAT_DEFS[stat]?.label || stat}+${MEAL_STAT_PCT}%`
export const leftText = (ms) => {
  const m = Math.max(0, Math.ceil(ms / 60000))
  return m >= 60 ? `残り${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `残り${m}分`
}
// 効いている食事の1行（ホームのステータス・出撃のログに出す）
export const mealLineOf = (meal) => {
  if (!meal) return ''
  const tops = [meal.major, meal.minor].filter(Boolean).map(k => TOPPING_BY_AIL[k].name)
  return `${meal.burger.name}${tops.length ? `＋${tops.join('・')}` : ''}`
}
