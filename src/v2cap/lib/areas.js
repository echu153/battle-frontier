// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— エリアと場所
// ------------------------------------------------------------
// 2026-10-09 エリアの作り替え（ユーザー指示・docs/v2cap-design.md §3）：
//   ・15エリアを1本道で進む。エリアごとに ①②③ の3か所（＝場所。全部で45か所）
//   ・①のボスを倒すと②、②のボスで③、③のボスで次のエリアの①が開く。③のボスは特に強い
//   ・後に開く場所ほど敵が強く、経験値とGoldが多い。装備は**エリアごとの一覧**（equipment.js）から落ち、
//     ①→②→③でレア以上が少しずつ出やすくなる（sortie.js の dropRarityOf）
//   ・経験値とGoldは場所ごとの表の値（1体ごとに範囲の中でランダム）。
//     朝昼晩の限定の敵は1.5倍・レアは3倍・ボスは5倍
//   ・装備のアイテムLV（＝必要LV）は**エリアごとに1つ**（①のボスのLV。①②③どこで拾っても同じ）
//   ・今のⅡの「難易度帯①〜⑧」と、帯の中で物理／魔法が通りやすいエリアの区別は無くした（1本道なので）
//
// 敵の名前・配分・技・LVは monsters.js（名前はユーザーの一覧のとおり）。
// 【確定】敵のLVは**敵ごとに一定**（プレイヤーの育ち方に合わせない・最後のボスがLV80）。
// 強さは「そのLVのプレイヤーの標準の戦闘力 × 役割の倍率」。
// ★敵のLV・経験値とGoldの範囲・アイテムLVはサーバー（v2cap_spots / v2cap_enemies）にも持たせる。
//   ⚠ここを変えたら tools/v2cap-sql.mjs でSQLの種を作り直すこと（v2capsql.test.js が突き合わせる）
// ============================================================
import { statsOf } from '../../v2/lib/enemies.js'
import { bodyPowerAt } from './level.js'
import { ROSTERS, ENEMY_LV } from './monsters.js'

// ===== エリアと場所の名前（【確定】2026-10-09 ユーザーの表）=====
export const AREA_LIST = [
  { name:'始まりの森',   spots:['木漏れ日の小径', '苔むした獣道', '森主の古樹'] },
  { name:'荒廃した草原', spots:['風吹く丘陵', '焼け落ちた廃村', '骸の古戦場'] },
  { name:'古代の洞窟',   spots:['鍾乳の回廊', '刻印の大広間', '封じられし石室'] },
  { name:'蒼海の入り江', spots:['白砂の浜辺', '難破船の墓場', '大渦の海蝕洞'] },
  { name:'灼砂の遺丘',   spots:['陽炎の砂原', '埋もれし神殿', '砂王の玄室'] },
  { name:'巨峰山脈',     spots:['岩肌の山道', '風哭きの峠', '天衝く頂'] },
  { name:'常闇の樹海',   spots:['黄昏の境界', '惑い霧の迷路', '光喰らいの大樹'] },
  { name:'白銀の霊峰',   spots:['凍てつく雪原', '氷晶の大洞', '白霊の祭壇'] },
  { name:'雷鳴の断崖',   spots:['稲光の岩棚', '轟雷の架け橋', '雷帝の玉座'] },
  { name:'煉獄火山',     spots:['噴煙の山麓', '溶岩の大河', '業火の炉心'] },
  { name:'腐海の沼獄',   spots:['瘴気漂う湿原', '沈みし廃村', '腐王の苗床'] },
  { name:'奈落の坑道',   spots:['廃れた採掘場', '底なしの大縦穴', '掘り当てられし禁域'] },
  { name:'蒼天の浮遊城', spots:['雲海の桟橋', '浮かぶ空中庭園', '天主の謁見の間'] },
  { name:'星霜の遺跡',   spots:['風化した列柱廊', '時止まりの大書庫', '星墜ちる観測台'] },
  { name:'深淵の海溝',   spots:['燐光の海棚', '沈みし古都', '原初の深淵'] },
]
export const SUB_MARK = '①②③'
export const SPOT_COUNT = AREA_LIST.length * 3
export const LAST_SPOT = SPOT_COUNT

// ===== 経験値とGold（1体あたり・範囲の中でランダム）=====
// 【確定】始まりの森・荒廃した草原はユーザーの表の値。古代の洞窟から先は「同じ伸び方で埋める」（ユーザー承認）：
//   エリアが1つ進むごとに 経験値+2・Gold+5。①②③の幅は表と同じ
//   （経験値 ① a〜a+1 ／ ② a〜a+2 ／ ③ a+1〜a+3、Gold ① g〜g+5 ／ ② g〜g+7 ／ ③ g〜g+10）
export const expRangeOf = (areaNo, sub) => {
  const a = 2 * areaNo
  return sub === 1 ? [a, a + 1] : sub === 2 ? [a, a + 2] : [a + 1, a + 3]
}
export const goldRangeOf = (areaNo, sub) => {
  const g = 5 * areaNo + 5
  return sub === 1 ? [g, g + 5] : sub === 2 ? [g, g + 7] : [g, g + 10]
}
// 役割の倍率。【確定】朝昼晩の限定の敵1.5倍・レア3倍・ボス5倍（2026-10-09 ユーザー指示）
// ⚠10分率の整数で持ち、掛けたあと四捨五入する（SQLの v2cap_sortie_settle と同じ計算）
export const ROLE_TENTHS = { normal: 10, timed: 15, rare: 30, boss: 50 }
export const scaleByRole = (v, role) => Math.floor((v * (ROLE_TENTHS[role] || 10) + 5) / 10)

// ★装備の必要LV（アイテムLV）は equipment.js の reqLvOf（エリア×レア度・ユーザーの表）。場所は持たない

// ===== 場所 =====
// ★顔ぶれ（roster）の敵には、いる場所（spot）を付けて持つ。同じ敵が②と③の両方に出る（LVはどこでも同じ。
//   役割＝ふつう・朝昼晩・レア・ボスは「名前＋場所」で引く）
const withSpot = (list, id) => list.map(e => ({ ...e, spot: id }))
export const SPOTS = AREA_LIST.flatMap((a, k) => a.spots.map((name, j) => {
  const id = k * 3 + j + 1
  const r = ROSTERS[id]
  return {
    id, area: k + 1, areaName: a.name, sub: j + 1, name,
    exp: expRangeOf(k + 1, j + 1), gold: goldRangeOf(k + 1, j + 1),
    roster: { enemies: withSpot(r.enemies, id), timed: withSpot(r.timed, id), rares: withSpot(r.rares, id), boss: { ...r.boss, spot: id } },
  }
}))
export const spotOf = (id) => SPOTS[id - 1] || null
export const spotLabel = (spotOrId) => {
  const s = typeof spotOrId === 'object' ? spotOrId : spotOf(spotOrId)
  return s ? `${s.areaName}${SUB_MARK[s.sub - 1]} ${s.name}` : ''
}

// ===== 敵のLV =====
// 【確定】敵ごとに一定（monsters.js の ENEMY_LV。場所が変わっても同じ）
// 「場所|名前」→ { name, role, spot, band }（役割と時間帯）
const PLACES = new Map()
const placeKey = (spot, name) => `${spot}|${name}`
for (const s of SPOTS) {
  const r = s.roster
  const put = (e, role) => PLACES.set(placeKey(s.id, e.name), { name: e.name, role, spot: s.id, band: e.band || null })
  for (const e of r.enemies) put(e, 'normal')
  for (const e of r.timed) put(e, 'timed')
  for (const e of r.rares) put(e, 'rare')
  put(r.boss, 'boss')
}
// spot は顔ぶれの確かめ用（その場所にいない敵はLV1を返す＝前と同じ）
export const enemyLvOf = (name, spot) => (PLACES.has(placeKey(spot, name)) ? ENEMY_LV[name] || 1 : 1)
export const enemyRoleOf = (name, spot) => PLACES.get(placeKey(spot, name))?.role || 'normal'
// その場所の敵のLVの範囲（いちばん低い敵〜いちばん高い敵＝ボス）。画面とサーバーの v2cap_spots に出す
export const spotLvOf = (id) => {
  const lvs = [...PLACES.values()].filter(p => p.spot === id).map(p => ENEMY_LV[p.name] || 1)
  return lvs.length ? [Math.min(...lvs), Math.max(...lvs)] : [1, 1]
}
export const spotLvText = (id) => { const [a, b] = spotLvOf(id); return a === b ? `LV${a}` : `LV${a}〜${b}` }
// サーバーの種（v2cap_enemies）を作るための一覧（名前＋場所ごとに1行）
export const enemyLevels = () => [...PLACES.values()].map(p => ({ name: p.name, spot: p.spot, lv: ENEMY_LV[p.name] || 1, role: p.role, band: p.band }))

// ===== 敵の強さ =====
// そのLVのプレイヤーの「標準の戦闘力」（本体＋その時点の装備＋クラスのステ）。本体の戦闘力に対する倍率を
// LVの折れ線で持つ（間は直線で補う）。倍率はLVが上がって少し下がることもあるが、標準の戦闘力そのものは下がらない。
// ★値は `node tools/v2cap-progress.mjs --tune` の出力をそのまま貼る（勘で書き換えないこと）。
//   LV1・LV5の行は測り直しでも動かさない（始まりの森①の敵を、装備なしのLV1で勝てる強さに保つ・ユーザー指示）
export const STD_RATIO = [
  [1, 1.02], [5, 1.07], [10, 2.83], [15, 3.21], [20, 3.52], [27, 3.7], [34, 3.76], [44, 3.57], [54, 3.41], [63, 3.26], [71, 3.15], [79, 3.09], [90, 2.98], [100, 2.92],
]
export const stdRatioAt = (lv) => {
  const l = Math.max(1, Math.min(100, lv || 1))
  for (let i = 1; i < STD_RATIO.length; i++) {
    const [l1, r1] = STD_RATIO[i]
    if (l <= l1) {
      const [l0, r0] = STD_RATIO[i - 1]
      return r0 + (r1 - r0) * (l - l0) / (l1 - l0)
    }
  }
  return STD_RATIO[STD_RATIO.length - 1][1]
}
export const stdPowerAt = (lv) => Math.round(bodyPowerAt(lv) * stdRatioAt(lv))
// 役割の倍率。ふつうの敵と朝昼晩の敵は「同じLVのプレイヤーの0.6倍」＝同じLVならまず勝てる。
// レアは0.8倍。ボスは同じLVのプレイヤーの何倍か（1回で勝てなくてよい）。
// ボスの倍率＝エリアの値（AREA_BOSS）×①②③の倍率（SUB_BOSS）。
//   【確定】③のボスは特に強い（ユーザー指示）＝③は①②の1.25倍。③はLVもエリアで一番高いので、③のボスが一番強い
//   ★敵のLVは一定なので、目安の日に倒せる強さへ合わせるのはボスの倍率（AREA_BOSS）だけ
//   ⚠前は45か所を1体ずつ日数で合わせていたが、②のボスが③より強いエリアが出た＋測りのぶれが大きかった
//     （2026-10-09 実際に踏んだ）。なので合わせるのはエリアの値（15個）だけにした
// ★AREA_BOSS は「そのエリアの③を倒すのが目安の日になる」ように `--tune` で逆算した値（勘で書き換えないこと）。
//   目安は今のⅡと同じ日数をエリアへ割り振ったもの（tools/v2cap-progress.mjs の AREA_DAY）
export const NORMAL_RATIO = 0.6
export const RARE_RATIO = 0.8
export const SUB_BOSS = [1.0, 1.0, 1.25]
export const AREA_BOSS = [
  1.1, 1, 1.05, 1.15, 1.13, 1.15, 1.09, 0.98, 1.03, 1.18, 1.26, 1.19, 1.51, 1.34, 1.53,
]
export const bossRatioOf = (spotId) => {
  const s = spotOf(spotId)
  return s ? AREA_BOSS[s.area - 1] * SUB_BOSS[s.sub - 1] : 1
}
export const roleRatioOf = (role, spotId) =>
  role === 'boss' ? bossRatioOf(spotId) : role === 'rare' ? RARE_RATIO : NORMAL_RATIO
// enemy は場所の顔ぶれ（SPOTS の roster）の敵＝いる場所（spot）を持っている
export const enemyPowerOf = (enemy) => {
  const p = PLACES.get(placeKey(enemy.spot, enemy.name))
  return Math.max(1, Math.round(stdPowerAt(enemyLvOf(enemy.name, enemy.spot)) * roleRatioOf(p?.role, p?.spot)))
}

// 戦闘用。uses＝1回の戦闘でそれぞれの技を何回使えるか
// ★今のⅡの「エリアの相性（物理／魔法が通りやすい）」は付けない（1本道なので）
export const toFighter = (enemy, uses = 8) => ({
  name: enemy.name,
  kind: enemy.kind,
  stats: statsOf({ ...enemy, power: enemyPowerOf(enemy) }),
  slots: (enemy.skills || []).map(s => ({ skill: s, uses })),
  taken: null,
})
