// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 出撃
// ------------------------------------------------------------
// 進み方（2026-10-09 エリアの作り替え・docs/v2cap-design.md §3）：
//   ・場所（15エリア×①②③＝45か所）を1本道で進む。**その場所のボスを倒すと次の場所が開く**
//   ・10秒に1回。ボスは1戦ごとに+0.3%ずつ出やすくなり、出会うと0へ戻る（今のⅡと同じ）
//   ・ボスでなければ 通常70%・時間限定（その時間帯の敵）25%・レア5%（2026-10-25・下の ENCOUNTER_PCT）
//   ・ボスの抽選のあと、1%でパピア（2026-10-30・papia.js。残りを 70/25/5 で分ける）
//   ・経験値とGoldは場所の表の値 × 役割の倍率（朝昼晩1.5倍・レア3倍・ボス5倍）。決めるのはサーバー
//   ・装備はそのエリアのものが落ちる。レア度（ノーマル・レア・エピック・レジェンダリー）は敵の役割と①②③で決まる
//     （下の「落ちる装備」）。部位は1時間ごとに「落ちやすい部位」が入れ替わる（今のⅡと同じ）。アイテムLV＝装備の必要LV
//   ・**武器はいまの職業が装備できる種類（3種）から**落ちる。防具は重鎧／軽装を半々。装飾品は4種から均等
//   ・勝って装備が落ちなかったら、5%で宝箱（その場所のエリアの残骸が1〜10個・下の「宝箱」・2026-10-14）
// ============================================================
import { spotOf, enemyLvOf, scaleByRole, LAST_SPOT } from './areas.js'
import { itemOf, RARITIES, ARMOR_LINES, ACCESSORY_TYPES } from './equipment.js'
import { weaponsOf } from './jobs.js'
import { scrapNameOf } from './smith.js'
import { PAPIA_PCT, PAPIA_ROLE, papiaEnemyOf, takePapiaForce } from './papia.js'
import {
  rollBoss, nextBossRate, bandAt, rollDropPart,
  SORTIE_CD, BOSS_RATE_STEP,
} from '../core/sortie.js'

export { nextBossRate, bandAt, SORTIE_CD, BOSS_RATE_STEP }

const pick = (list, rng) => list[Math.floor(rng() * list.length)]

// ===== 次に出会う敵 =====
// 【確定】2026-10-25 ユーザー指示「遭遇率見直す　通常　70　時間限定　25　レア　５％　遭遇率はこれにして」：
//   ・ボスの抽選が先（1戦ごとに+0.3%ずつ出やすくなり、出会うと0へ戻る＝前のまま）
//   ・ボスでなければ、通常70%・時間限定25%・レア5%（ENCOUNTER_PCT）。それぞれの中は均等に1体
//     通常＝その場所のふつうの敵（①は2体・②③は4体）／時間限定＝いまの時間帯（朝・昼・晩）の2体／
//     レア＝いまの時間帯に出る3体（一日中の2体＋その時間帯の1体）
//   ⚠前（2026-10-09〜10-25）は「レア0.5%を先に引く（今のⅡと同じ）→ ボス → ふつうの敵と時間帯の敵を合わせて均等」
//     ＝時間帯の敵は①で半分・②③で3分の1、レアは200戦に1回だった
//   ★出会う敵は画面が決める（サーバーは敵がその場所にいるかと役割だけ見る）＝SQLは変わらない
// role … normal／timed／rare／boss（経験値とGoldの倍率に使う）
export const ENCOUNTER_PCT = { normal: 70, timed: 25, rare: 5 }
export const pickEncounter = (spotId, bossRate, at = new Date(), rng = Math.random) => {
  const spot = spotOf(spotId)
  if (!spot) return null
  const band = bandAt(at)
  const r = spot.roster
  const make = (enemy, role) => ({ spot, enemy, role, isBoss: role === 'boss', lv: enemyLvOf(enemy.name, spot.id), band })
  if (takePapiaForce()) return make(papiaEnemyOf(spot), PAPIA_ROLE)   // 開発用（papia.js）
  if (rollBoss(bossRate, rng)) return make(r.boss, 'boss')
  // ★パピア（2026-10-30・papia.js）：ボスでなければ1%。出ない残りを 70/25/5 で分ける
  if (rng() * 100 < PAPIA_PCT) return make(papiaEnemyOf(spot), PAPIA_ROLE)
  const pools = {
    normal: r.enemies,
    timed: r.timed.filter(e => e.band === band),
    rare: r.rares.filter(e => !e.band || e.band === band),
  }
  // 敵のいない組は飛ばして、残りの割合で分ける（いまはどの場所にも3つとも必ずいる）
  const roles = Object.keys(ENCOUNTER_PCT).filter(k => pools[k].length > 0)
  const total = roles.reduce((t, k) => t + ENCOUNTER_PCT[k], 0)
  let x = rng() * total
  const role = roles.find(k => (x -= ENCOUNTER_PCT[k]) < 0) || roles[roles.length - 1]
  return make(pick(pools[role], rng), role)
}

// ===== 経験値とGold =====
// 勝ったとき … 範囲の中の整数を均等に1つ → 役割の倍率を掛けて四捨五入
// 負けたとき … 【確定】経験値は**その場所の最低値**（朝昼晩・レア・ボスの倍率は掛けない）。Goldは入らない
//              （2026-10-09 ユーザー指示「敗北しても経験値は最低値を獲得できるように」）
// ★サーバーの v2cap_sortie_settle と同じ規則。これはシミュレーションと表示のための写しで、実際に入る値はサーバーが返す
export const randIn = ([lo, hi], rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1))
export const lossExpOf = (spot) => spot.exp[0]
// ★パピアはEXPだけ（倍率は papia.js）。逃げられたら負けと同じ
export const rollRewards = (enc, rng = Math.random, win = true) => {
  if (!win) return { exp: lossExpOf(enc.spot), gold: 0 }
  if (enc.role === PAPIA_ROLE) return { exp: Math.floor((randIn(enc.spot.exp, rng) * enc.enemy.papia.tenths + 5) / 10), gold: 0 }
  return { exp: scaleByRole(randIn(enc.spot.exp, rng), enc.role), gold: scaleByRole(randIn(enc.spot.gold, rng), enc.role) }
}
// 画面に出す「この役割ならいくつ〜いくつ」
export const rewardRangeOf = (spot, role = 'normal') => ({
  exp: spot.exp.map(v => scaleByRole(v, role)),
  gold: spot.gold.map(v => scaleByRole(v, role)),
})

// ===== 場所の解放（1本道）=====
// 倒したボスの場所（cleared）の一番先の次までが開いている。最初は①（id 1）だけ
export const lastClearedOf = (cleared) => Math.max(0, ...(cleared || []).filter(Number.isInteger))
export const openUntilOf = (cleared) => Math.min(LAST_SPOT, lastClearedOf(cleared) + 1)
// 行ったことのあるエリアの一番先（開いている一番先の場所のエリア・最低1）。図鑑・博物館・作成・装備の絞り込みのエリアの範囲
export const openAreaOf = (cleared) => Math.max(1, spotOf(openUntilOf(cleared))?.area || 1)
export const isSpotUnlocked = (cleared, id) => Number.isInteger(id) && id >= 1 && id <= openUntilOf(cleared)
export const unlockedSpotsOf = (cleared) => Array.from({ length: openUntilOf(cleared) }, (_, i) => i + 1)
export const isSpotCleared = (cleared, id) => (cleared || []).includes(id)
// ボスに勝ったあとの cleared（すでに入っていればそのまま）
export const clearSpot = (cleared, id) =>
  (cleared || []).includes(id) ? [...(cleared || [])] : [...(cleared || []), id].sort((a, b) => a - b)

// ===== 落ちる装備 =====
// 【確定】2026-10-09 ユーザー決定：
//   ・レア度は ノーマル・レア・エピック・レジェンダリー。**エピックはレアモンスターとボスから、レジェンダリーはボスからだけ**
//   ・勝ったときに装備が落ちる確率（%）… ふつう・朝昼晩の敵8／レアモンスター30／ボス60（決めた日の値は 3／10／10）
//     【確定】2026-10-12 ユーザー指示「装備のドロップ率渋すぎるから8％にして」で ふつう・朝昼晩を3→8（レアとボスはそのまま）
//     【確定】2026-10-22 ユーザー指示「レアのモンスターから装備ドロップする確率3倍にして、ボスは６倍　ドロップするレアリティの内訳は
//       変わらないようにして　あくまで装備がドロップしやすいようにする」で レア10→30・ボス10→60（今の値の3倍・6倍。DROP_RARITY は変えない）
//   ・落ちたときのレア度（%）… DROP_RARITY。①②③で「レア以上」の割合を ①×1.0 ②×1.2 ③×1.4 にする
//     （増えたぶんはノーマルから減らす）
//   【確定】2026-10-25 ユーザー指示「通常でもエピックまでは落ちるようにして、確率は少し低めで／レアモンスターからはレア、エピック、レジェンドのみ
//     落ちるように／ボスもレア以上だけ落ちるように※ユニークの落ちる確率は上げないで」：
//     ・ふつう・朝昼晩の敵 … ノーマル82・レア15・エピック3（前は ノーマル85・レア15）
//     ・レアモンスター … レア82・エピック15・レジェンダリー3（前は ノーマル50・レア35・エピック15＝ノーマルのぶんをレアへ・レジェンダリーを少し）
//     ・ボス … レア75・エピック20・レジェンダリー5（前は ノーマル40・レア35・エピック20・レジェンダリー5＝ノーマルのぶんをレアへ。エピックとレジェンダリーは同じ）
//     ・①②③の倍率と「海賊の嗅覚」などの倍率は、**その役割のいちばん下のレア度より上**に掛ける
//       （ふつうの敵＝レア以上・レアモンスターとボス＝エピック以上）。ボスのエピック・レジェンダリーはどの場所でも前と同じになる
//     ・ユニーク（ボスに勝ったとき0.5%）はサーバーが別に引く＝ここでは変わらない
//   ・落ちるのは**そのエリアの装備**（種類ごと・レア度ごとに1つずつ）。アイテムLV＝その装備の必要LV（エリア×レア度）
// ★サーバー（v2cap_sortie_settle）は「そのエリアの装備か」「その役割の敵から落ちるレア度か」「いまの職業の武器か」を見る
//   （落ちたかどうか・何が落ちたかは画面の申告。戦闘をサーバーで回すまでは今のⅡと同じ限界）
export const DROP_CHANCE = { normal: 8, timed: 8, rare: 30, boss: 60 }
export const DROP_RARITY = {
  normal: { N:82, R:15, E:3 },
  timed:  { N:82, R:15, E:3 },
  rare:   { R:82, E:15, L:3 },
  boss:   { R:75, E:20, L:5 },
}
export const SUB_RARE_MULT = [1.0, 1.2, 1.4]
const r1 = (v) => Math.round(v * 10) / 10
// その役割の敵から落ちるいちばん下のレア度（ふつう・朝昼晩の敵＝ノーマル・レアモンスターとボス＝レア）
export const lowestDropRarityOf = (role) => RARITIES.find(r => ((DROP_RARITY[role] || DROP_RARITY.normal)[r] || 0) > 0)
// その場所（①②③）でその役割の敵を倒したときのレア度の内訳（%・合計100）
// rareMult … いちばん下より上のレア度の割合にさらに掛ける倍率（防具のセット能力「海賊の嗅覚」＝1.2・ユニークの黒潮のカトラス＝1.4）。
//   ①②③の倍率も同じ所に掛け、増えたぶんはいちばん下のレア度から減らす。掛けて100%を超えたら、いちばん下を0にして合計100へ割り戻す
export const dropRarityOf = (role, sub = 1, rareMult = 1) => {
  const base = DROP_RARITY[role] || DROP_RARITY.normal
  const m = (SUB_RARE_MULT[(sub || 1) - 1] ?? 1) * (rareMult || 1)
  const low = lowestDropRarityOf(role)
  let up = Object.fromEntries(RARITIES.filter(r => r !== low && base[r]).map(r => [r, r1(base[r] * m)]))
  const sum = Object.values(up).reduce((a, b) => a + b, 0)
  if (sum > 100) up = Object.fromEntries(Object.entries(up).map(([r, v]) => [r, r1(v * 100 / sum)]))
  return { [low]: Math.max(0, r1(100 - Object.values(up).reduce((a, b) => a + b, 0))), ...up }
}
// その役割の敵から落ちるレア度か（サーバーの判定と同じ）
export const canDropRarity = (role, rarity) => ((DROP_RARITY[role] || DROP_RARITY.normal)[rarity] || 0) > 0
export const rollDropRarity = (role, sub, rng = Math.random, rareMult = 1) => {
  const d = dropRarityOf(role, sub, rareMult)
  let x = rng() * 100
  for (const r of RARITIES) {
    if (!d[r]) continue
    x -= d[r]
    if (x < 0) return r
  }
  return 'N'
}
// 落ちる種類を1つ選ぶ（部位は呼び出し側）。武器はいまの職業が装備できる種類から
export const rollDropKind = (part, cls, rng = Math.random) => {
  if (part === '武器') {
    const types = weaponsOf(cls)
    return types.length ? pick(types, rng) : null
  }
  if (part === 'アクセ') return pick(ACCESSORY_TYPES, rng)
  return `${pick(ARMOR_LINES, rng)}${part}`
}
// 勝ったときの装備。落ちたら { item, ilv }（レア度は item.rarity・アイテムLV＝item.lv）
// rareMult … 防具のセット能力「海賊の嗅覚」（落ちる確率そのものは変えない＝レア以上の割合だけ）
// bonusPct … 落ちる確率に足す%。塔の階層守護者でいるあいだ +1（tower.js の GUARD_DROP_BONUS・2026-10-14 ユーザー指示「ドロップ率1%増加」）
//   ⚠画面の確率（サーバーは何が落ちたかの条件だけを見る＝セット能力と同じ扱い）
export const rollEquipDrop = (enc, cls, at = new Date(), rng = Math.random, rareMult = 1, bonusPct = 0) => {
  if (!enc || enc.role === PAPIA_ROLE) return null   // パピアは装備を落とさない（塔の守護者のボーナスも乗らない）
  if (rng() * 100 >= (DROP_CHANCE[enc.role] ?? DROP_CHANCE.normal) + (bonusPct || 0)) return null
  const kind = rollDropKind(rollDropPart(at, rng), cls, rng)
  const item = kind ? itemOf(enc.spot.area, rollDropRarity(enc.role, enc.spot.sub, rng, rareMult), kind) : null
  return item ? { item, ilv: item.lv } : null
}

// ===== 宝箱 =====
// 【確定】2026-10-14 ユーザー指示「出撃して敵を倒した時、装備が落ちなかったとき5%の確率で宝箱を見つけて開けられる」
//   「宝箱を開けるとそのエリアの残骸を「1～10」個」・メッセージは「宝箱を見つけた！○○の残骸×〇を獲得した！」
// こちらで決めた細部：
//   ・見つけたらその場で開ける（ログの1行だけ・演出なし・オートも止まらない）
//   ・勝った敵なら役割（ふつう・朝昼晩・レア・ボス）を問わない。装備が落ちた戦闘では見つからない
//   ・安息の祠の中では見つからない（祠は装備も落ちない場所＝前に決めた報酬のまま）
//   ・残骸の数は1〜10を均等に1つ（平均5.5個）。入るのはその場所のエリアの残骸（鍛冶屋の強化・作成に使うものと同じ）
// ★決めるのはサーバー（v2cap_sortie_settle の c_chest_…）。ここはシミュレーションと表示のための写し
//   ⚠数を変えたら SQL の c_chest_… も直す（v2capsql.test.js が突き合わせる）
export const CHEST_PCT = 5            // 装備が落ちなかった勝ちで、宝箱を見つける確率（%）
export const CHEST_SCRAP = [1, 10]    // 中の残骸の数（この範囲の整数を均等に1つ）
// 宝箱を引く。見つけたら中の残骸の数、見つけなければ0（装備が落ちたかどうかは呼び出し側で見る）
export const rollChest = (rng = Math.random) => (rng() * 100 < CHEST_PCT
  ? CHEST_SCRAP[0] + Math.floor(rng() * (CHEST_SCRAP[1] - CHEST_SCRAP[0] + 1))
  : 0)
// ログの1行（ユーザーの文のまま）
export const chestText = (area, n) => `宝箱を見つけた！${scrapNameOf(area)}×${n}を獲得した！`
