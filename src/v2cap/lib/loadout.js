// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 編成から戦闘用のキャラを作る
// ------------------------------------------------------------
// 戦闘力の内訳は4つ：
//   本体（LVアップの抽選で上がったステ）＋ クラスのステ（いまの職業・そのClassLVぶん）
//   ＋ 装備（アイテムLVで強さが決まり、強化値ぶん強くなり、必要LVに足りないぶん効果が下がる）
//   ＋ アセンション（いまの職業の木で開いたマス。2026-10-13・ascension.js）
// さらに防具のメリット（重鎧＝受けるダメージ−1%／軽装＝AGI+1%・1部位ごと）と、アセンションの大マス（道のステ+5%）が乗る。
// アセンションのスキルマスは、その技を戦闘に渡すときに強くする（slotsOf）。
// ★職業補正は**一旦なし**（2026-10-09 ユーザー決定）＝ runBattle に noClassBonus を渡す（rules.js の CAP_RULES）。
// ★武器は職業ごとに装備できる種類が決まっている。いまの職業で装備できない武器は
//   （サーバーが外すはずだが）念のためここでも数えない
// ★スキルセットは**職業ごと**（skill_sets[職業]）。使えるのはその職業と下位職の技だけ
// ============================================================
import { STAT_KEYS, calcPower } from '../../v2/lib/stats.js'
import { ITEM_BY_ID, SLOTS, isUnique } from './equipment.js'
import { SKILL_BY_NAME, isPassive, passiveOf } from './skills.js'
import { statsAt, effectivePowerAt, armorEffects } from './gear.js'
import { plusOf } from './smith.js'
import { jobBonusStats, jobOf, canEquipType, attackKindOf, lineageOf } from './jobs.js'
import { CAP_RULES } from './rules.js'
import { ascEffectsOf, ascPctGain, ascendSkill } from './ascension.js'
import { armorSetsOf, setStatPctOf, setFxOf } from './armorSets.js'
import { combinedFxOf, mergeFx } from './fxMerge.js'
import { GENDER_BY_KEY, genderOf, genderFxOf } from './gender.js'

const zero = () => Object.fromEntries(STAT_KEYS.map(k => [k, 0]))

// 装着中の装備を { slot: { inv, item } } の形で引く（inv は { id, base_id, ilv, plus }。レア度は装備 item が持つ）
// ★【確定】2026-10-21 ユーザー選択「1つまで」：同じユニークは1つしか着けられない（装飾品の2枠に同じものは着けられない）。
//   サーバー（v2cap_equip）も弾くが、前に着けていたものが残っていても、ここで後ろの枠のほうを数えない
export const equippedItems = (profile, inventory) => {
  const byId = Object.fromEntries((inventory || []).map(i => [String(i.id), i]))
  const out = {}
  const uniques = new Set()
  for (const slot of SLOTS) {
    const invId = profile?.equipped?.[slot]
    if (invId === undefined || invId === null) continue
    const inv = byId[String(invId)]
    const item = inv && ITEM_BY_ID[inv.base_id]
    if (!inv || !item) continue
    if (item.part === '武器' && !canEquipType(profile?.class, item.type)) continue
    if (isUnique(item)) {
      if (uniques.has(item.id)) continue
      uniques.add(item.id)
    }
    out[slot] = { inv, item }
  }
  return out
}
// 着けているユニーク（固有の能力を戦闘へ渡す・画面に出す）
export const wornUniquesOf = (profile, inventory) =>
  Object.values(equippedItems(profile, inventory)).map(w => w.item).filter(isUnique)
export const wornIdsOf = (profile, inventory) =>
  new Set(Object.values(equippedItems(profile, inventory)).map(w => String(w.inv.id)))

// いまのLV（必要LVと比べる。LVが無ければ1＝前と同じ見方）
const lvOf = (profile) => profile?.lv || 1
// 装備ぶんのステ（強化値ぶんを足し、必要LVに足りない装備はいまのLV相当にしたもの）
export const gearStats = (profile, inventory) => {
  const total = zero()
  for (const { inv, item } of Object.values(equippedItems(profile, inventory))) {
    const s = statsAt(item, inv.ilv, lvOf(profile), plusOf(inv))
    for (const k of STAT_KEYS) total[k] += s[k] || 0
  }
  return total
}
// 装備ぶんの戦闘力（強化値・必要LV不足のLV相当込み）
export const gearPower = (profile, inventory) =>
  Object.values(equippedItems(profile, inventory)).reduce((t, { inv, item }) =>
    t + effectivePowerAt(item, inv.ilv, lvOf(profile), plusOf(inv)), 0)

// 防具のメリット（受けるダメージの倍率・AGIの上がり幅）。必要LVに足りなくても弱めない（2026-10-18〜）
export const armorOf = (profile, inventory) => armorEffects(
  Object.values(equippedItems(profile, inventory))
    .filter(w => w.item.line)
    .map(w => ({ item: w.item })))

// 防具のセット能力（armorSets.js）。発動している組だけ：[{ area, line, count, tiers, def }]
// ★レア以上・同じエリア・同じ系統の防具で数える。必要LVに足りない防具も数える（2026-10-14 ユーザー選択）
export const setsOf = (profile, inventory) =>
  armorSetsOf(Object.values(equippedItems(profile, inventory)).map(w => w.item))

// 本体のステ
export const bodyStats = (profile) => Object.fromEntries(STAT_KEYS.map(k => [k, profile?.[k] || 0]))
// いまの職業のクラスのステ
export const jobStats = (profile) => jobBonusStats(profile?.class, jobOf(profile?.jobs, profile?.class).lv)

// 合計。内訳も返す（ステータス画面で「本体＋クラス＋装備＋アセンション」を出すため）。
// ★軽装のAGI+%とアセンションの大マス（道のステ+%）は、どちらも「本体＋クラス＋装備＋アセンションの小マス」に掛ける
//   （上がったぶんは armorAgi・asc に出す）。MPの大マスはサーバーのスキル編成の最大MP（v2cap_asc_mp）と同じ数え方
export const statBreakdown = (profile, inventory) => {
  const body = bodyStats(profile)
  const job = jobStats(profile)
  const gear = gearStats(profile, inventory)
  const armor = armorOf(profile, inventory)
  const eff = ascEffectsOf(profile)
  const base = Object.fromEntries(STAT_KEYS.map(k => [k, body[k] + job[k] + gear[k] + eff.flat[k]]))
  const big = ascPctGain(base, eff.pct)
  const asc = Object.fromEntries(STAT_KEYS.map(k => [k, eff.flat[k] + big[k]]))
  const armorAgi = Math.round(base.agi * armor.agiPct / 100)
  const total = Object.fromEntries(STAT_KEYS.map(k => [k, base[k] + big[k]]))
  total.agi += armorAgi
  // ★防具のセット能力の3部位（能力値+%）は、ここまでの合計に掛ける（上がったぶんは set に出す）
  const sets = setsOf(profile, inventory)
  const sp = setStatPctOf(sets)
  const set = Object.fromEntries(STAT_KEYS.map(k => [k, Math.round(total[k] * (sp[k] || 0) / 100)]))
  for (const k of STAT_KEYS) total[k] += set[k]
  return { body, job, gear, asc, armor, armorAgi, set, sets, total, power: calcPower(total) }
}
export const totalStats = (profile, inventory) => statBreakdown(profile, inventory).total

// ===== スキルセット =====
// いまの職業の編成。【確定】スキルセットは職業ごとに持つ（転職して戻ると前の編成に戻る）
export const currentSetOf = (profile) => {
  const set = profile?.skill_sets?.[profile?.class]
  return Array.isArray(set) ? set : []
}
// 戦闘の枠にする。その職業（と下位職）の技でないものは置かない（サーバーが保存のときに弾いているが念のため）。
// ★下位職の技は「自分の職業の技」として渡す＝今のⅡの戦闘エンジンが他職扱い（効果0.8倍・消費MP2倍）にしない。
//   【確定】上位職は下位職のスキルを**そのまま**使える（2026-10-09）
// ups … アセンションのスキルマス（{ 技の名前: 上がり幅 }・ascension.js の ascEffectsOf）。その技を強くした形で渡す
export const slotsOf = (set, cls, lineage = lineageOf(cls), ups = {}) => (set || [])
  .map(e => ({ skill: SKILL_BY_NAME[e?.name], uses: e?.uses || 1 }))
  .filter(e => e.skill && !isPassive(e.skill) && lineage.includes(e.skill.cls))
  .map(e => (e.skill.cls === cls ? e : { ...e, skill: { ...e.skill, cls } }))
  .map(e => (ups[e.skill.name] ? { ...e, skill: ascendSkill(e.skill, ups[e.skill.name]) } : e))

// runBattle に渡す形。重鎧の「受けるダメージ−%」は taken（物理・魔法とも）で渡す
export const toFighter = (profile, inventory) => {
  const bd = statBreakdown(profile, inventory)
  return {
    name: profile?.username || 'あなた',
    cls: profile?.class,
    kind: attackKindOf(profile?.class),   // 通常攻撃が物理か魔法か（今のⅡの名簿に無い職業があるので明示する）
    ...CAP_RULES,                         // ★この版だけの決まり（職業補正なし・麻痺/封印の0.8倍）。battle.js の createSide が見る
    stats: bd.total,
    taken: bd.armor.takenMult !== 1 ? { phys: bd.armor.takenMult, mag: bd.armor.takenMult } : null,
    enchants: [],
    evolutions: [],
    slots: slotsOf(currentSetOf(profile), profile?.class, lineageOf(profile?.class), ascEffectsOf(profile).ups),
    // ★パッシブはこの版の名簿から渡す（上位職だけ1つ・初期職は無し）。渡さないと戦闘エンジンが今のⅡの名簿を
    //   職業名で引き、狂戦士・竜騎士など同じ名前の職業に今のⅡのパッシブが付いてしまう
    passives: passiveOf(profile?.class) ? [passiveOf(profile?.class)] : [],
    // ★防具のセット能力（2部位・4部位の戦闘の効果。3部位の能力値は stats に入っている）と、
    //   着けているユニークの固有の能力（2026-10-21）を1つにまとめたもの（fxMerge.js）。どれも無ければ null
    // ★性別（2026-10-21・gender.js）：男性＝与えるダメージ+2%（sexDeal）・女性＝受けるダメージ−2%（sexCut）も同じ入れ物に重ねる
    setFx: mergeFx(combinedFxOf(setFxOf(bd.sets), wornUniquesOf(profile, inventory)),
      genderFxOf(genderOf(profile)), GENDER_BY_KEY[genderOf(profile)]?.label),
  }
}
