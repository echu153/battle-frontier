// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— エリアと場所
// ------------------------------------------------------------
// 2026-10-09 エリアの作り替え（ユーザー指示・docs/v2cap-design.md §3）：
//   ・15エリアを1本道で進む。エリアごとに ①②③ の3か所（＝場所。全部で45か所）
//   ・①のボスを倒すと②、②のボスで③、③のボスで次のエリアの①が開く。③のボスは特に強い
//   ・後に開く場所ほど敵が強く、経験値とGoldが多く、高いランクの装備が出やすい
//     （拾える装備の種類はエリアの中で同じ＝ランクの出やすさだけ変わる）
//   ・経験値とGoldは場所ごとの表の値（1体ごとに範囲の中でランダム）。
//     朝昼晩の限定の敵は1.5倍・レアは3倍・ボスは5倍
//   ・装備のアイテムLV（＝必要LV）は**エリアごとに1つ**（①のボスのLV。①②③どこで拾っても同じ）
//   ・今のⅡの「難易度帯①〜⑧」と、帯の中で物理／魔法が通りやすいエリアの区別は無くした（1本道なので）
//
// 敵の名前・配分・技は monsters.js（名前はユーザーの一覧のとおり）。
// 敵のLVは場所のLV帯の中で敵ごとに決まり、強さは「そのLVのプレイヤーの標準の戦闘力 × 役割の倍率」。
// ★敵のLV・経験値とGoldの範囲・アイテムLV・ランクはサーバー（v2cap_spots / v2cap_enemies）にも持たせる。
//   ⚠ここを変えたら tools/v2cap-sql.mjs でSQLの種を作り直すこと（v2capsql.test.js が突き合わせる）
// ============================================================
import { statsOf } from '../../v2/lib/enemies.js'
import { bodyPowerAt } from './level.js'
import { ROSTERS } from './monsters.js'

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

// ===== 場所のLV帯 =====
// その場所に来たときのLV〜ボスを倒すときのLV（1日1時間あそぶ人の中央値）。
// ★値は `node tools/v2cap-progress.mjs --tune` の出力をそのまま貼る（勘で書き換えないこと）
export const SPOT_LV = [
  [1, 13], [13, 15], [15, 19], [19, 21], [21, 23], [23, 25], [25, 28], [28, 29], [29, 32], [32, 34], [34, 36], [36, 38], [38, 39], [39, 40], [40, 43], [43, 46], [46, 49], [49, 54], [54, 56], [56, 58], [58, 61], [61, 64], [64, 66], [66, 70], [70, 72], [72, 74], [74, 77], [77, 78], [78, 79], [79, 81], [81, 82], [82, 83], [83, 85], [85, 86], [86, 87], [87, 89], [89, 90], [90, 91], [91, 93], [93, 94], [94, 94], [94, 96], [96, 97], [97, 98], [98, 100],
]
export const spotLvOf = (id) => SPOT_LV[id - 1] || [1, 1]
export const spotLvText = (id) => { const [a, b] = spotLvOf(id); return a === b ? `LV${a}` : `LV${a}〜${b}` }
// アイテムLV（＝必要LV）。【確定】エリアごとに1つ＝そのエリアの①のボスのLV（2026-10-09 ユーザー決定）
export const itemLvOfArea = (areaNo) => spotLvOf((areaNo - 1) * 3 + 1)[1]

// ===== 落ちる装備のランク =====
// 【確定】後の場所ほど高いランクが出やすい。拾えるランクの種類はエリアの中で同じ（2026-10-09 ユーザー指示）。
// エリアごとの元の分布（今のⅡの難易度帯の分布）を、場所ごとに決めた「平均のランク」へ傾けて作る。
//   平均のランク … ②は帯の値を線でつなぎ、①は前の②から6割・③は次の②へ4割進んだところ
//                  ＝45か所で必ず上がっていく（③と次の①が同じだと、丸めで逆転することがあった）
//   傾け方 … 重み × m^(ランクの段) の m を、平均がちょうど目標になるように探す（種類は変わらない）
export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S']
const DROP_BASE = [
  { F:40, E:40, D:20 },                       // 始まりの森
  { F:35, E:30, D:22, C:13 },                 // 荒廃した草原
  { F:30, E:28, D:24, C:13, B:5 },            // 古代の洞窟
  { F:26, E:26, D:23, C:15, B:10 },           // 蒼海の入り江
  { F:26, E:26, D:23, C:15, B:10 },           // 灼砂の遺丘
  { E:38, D:30, C:20, B:9, A:3 },             // 巨峰山脈
  { E:38, D:30, C:20, B:9, A:3 },             // 常闇の樹海
  { E:33, D:29, C:21, B:11, A:6 },            // 白銀の霊峰
  { E:33, D:29, C:21, B:11, A:6 },            // 雷鳴の断崖
  { D:40, C:30, B:20, A:10 },                 // 煉獄火山
  { D:40, C:30, B:20, A:10 },                 // 腐海の沼獄
  { D:40, C:30, B:20, A:10 },                 // 奈落の坑道
  { D:35, C:29, B:22, A:14 },                 // 蒼天の浮遊城
  { D:35, C:29, B:22, A:14 },                 // 星霜の遺跡
  { D:35, C:29, B:22, A:14 },                 // 深淵の海溝
]
export const meanRankOf = (dist) => {
  const tot = Object.values(dist).reduce((a, b) => a + b, 0)
  return Object.entries(dist).reduce((t, [r, w]) => t + RANKS.indexOf(r) * w / tot, 0)
}
// ②の平均のランク：帯の最初のエリアは帯の分布のまま、同じ帯の2つ目以降は次の帯へ向けて線でつなぐ
const TIER_FIRST = [0, 1, 2, 3, 5, 7, 9, 12]   // 帯の最初のエリア（0始まり）
const MID_MEAN = (() => {
  const anchors = TIER_FIRST.map(i => [i, meanRankOf(DROP_BASE[i])])
  const last = anchors[anchors.length - 1]
  anchors.push([AREA_LIST.length, last[1] + 0.3])   // 最後の帯の先（深淵の海溝の③のため）
  return AREA_LIST.map((_, k) => {
    for (let i = 1; i < anchors.length; i++) {
      const [k1, m1] = anchors[i]
      if (k < k1) { const [k0, m0] = anchors[i - 1]; return m0 + (m1 - m0) * (k - k0) / (k1 - k0) }
    }
    return last[1]
  })
})()
const targetMeanOf = (k, sub) => {
  const m = MID_MEAN[k]
  if (sub === 2) return m
  if (sub === 1) return k === 0 ? m - (MID_MEAN[1] - m) * 0.4 : MID_MEAN[k - 1] + (m - MID_MEAN[k - 1]) * 0.6
  return k === AREA_LIST.length - 1 ? m + (m - MID_MEAN[k - 1]) * 0.4 : m + (MID_MEAN[k + 1] - m) * 0.4
}
const tilt = (base, mean) => {
  const keys = Object.keys(base)
  const at = (m) => Object.fromEntries(keys.map(r => [r, base[r] * Math.pow(m, RANKS.indexOf(r))]))
  let lo = 0.01, hi = 100
  for (let i = 0; i < 80; i++) { const mid = Math.sqrt(lo * hi); if (meanRankOf(at(mid)) < mean) lo = mid; else hi = mid }
  const w = at(Math.sqrt(lo * hi))
  const tot = Object.values(w).reduce((a, b) => a + b, 0)
  return Object.fromEntries(keys.map(r => [r, Math.round(w[r] / tot * 1000) / 10]))
}
export const DROP_RANKS = AREA_LIST.flatMap((_, k) => [1, 2, 3].map(sub => tilt(DROP_BASE[k], targetMeanOf(k, sub))))

// ===== 場所 =====
// ★itemLv は SPOT_LV から毎回引く（--tune が SPOT_LV を差し替えても追従するように）
// ★顔ぶれ（roster）の敵には、いる場所（spot）を付けて持つ。同じ敵が②と③の両方に出るので、
//   LVと強さは「名前＋場所」で決まる（monsters.js）
const withSpot = (list, id) => list.map(e => ({ ...e, spot: id }))
export const SPOTS = AREA_LIST.flatMap((a, k) => a.spots.map((name, j) => {
  const id = k * 3 + j + 1
  const r = ROSTERS[id]
  return {
    id, area: k + 1, areaName: a.name, sub: j + 1, name,
    exp: expRangeOf(k + 1, j + 1), gold: goldRangeOf(k + 1, j + 1),
    get itemLv() { return itemLvOfArea(k + 1) },
    dropRanks: DROP_RANKS[id - 1],
    roster: { enemies: withSpot(r.enemies, id), timed: withSpot(r.timed, id), rares: withSpot(r.rares, id), boss: { ...r.boss, spot: id } },
  }
}))
export const spotOf = (id) => SPOTS[id - 1] || null
export const spotLabel = (spotOrId) => {
  const s = typeof spotOrId === 'object' ? spotOrId : spotOf(spotOrId)
  return s ? `${s.areaName}${SUB_MARK[s.sub - 1]} ${s.name}` : ''
}

// ===== 敵のLV =====
// ふつうの敵はその場所での並び（表の順＝弱い順）に、場所のLV帯の 0〜NORMAL_SPAN の位置へ等間隔に並べる
// （0＝下限・1＝上限。②③では前の場所から来た2体が下のほう）。
// 朝昼晩の限定の敵は TIMED_POS、レアとボスは帯の上限。同じ敵でも場所が違えばLVも違う
export const NORMAL_SPAN = 0.65
export const TIMED_POS = 0.8
const lvAt = (id, pos) => { const [a, b] = spotLvOf(id); return Math.round(a + (b - a) * pos) }
// 「場所|名前」→ { name, role, spot, pos, band }。LVは SPOT_LV から毎回引く（--tune が差し替えても追従するように）
const PLACES = new Map()
const placeKey = (spot, name) => `${spot}|${name}`
for (const s of SPOTS) {
  const r = s.roster
  const n = r.enemies.length
  const put = (e, role, pos) => PLACES.set(placeKey(s.id, e.name), { name: e.name, role, spot: s.id, pos, band: e.band || null })
  r.enemies.forEach((e, i) => put(e, 'normal', n > 1 ? NORMAL_SPAN * i / (n - 1) : 0))
  for (const e of r.timed) put(e, 'timed', TIMED_POS)
  for (const e of r.rares) put(e, 'rare', 1)
  put(r.boss, 'boss', 1)
}
export const enemyLvOf = (name, spot) => { const p = PLACES.get(placeKey(spot, name)); return p ? lvAt(p.spot, p.pos) : 1 }
export const enemyRoleOf = (name, spot) => PLACES.get(placeKey(spot, name))?.role || 'normal'
// サーバーの種（v2cap_enemies）を作るための一覧（名前＋場所ごとに1行）
export const enemyLevels = () => [...PLACES.values()].map(p => ({ name: p.name, spot: p.spot, lv: lvAt(p.spot, p.pos), role: p.role, band: p.band }))

// ===== 敵の強さ =====
// そのLVのプレイヤーの「標準の戦闘力」（本体＋その時点の装備＋クラスのステ）。本体の戦闘力に対する倍率を
// LVの折れ線で持つ（間は直線で補う）。
// ★値は `node tools/v2cap-progress.mjs --tune` の出力をそのまま貼る（勘で書き換えないこと）
export const STD_RATIO = [
  [1, 1], [5, 1.02], [10, 1.16], [15, 1.45], [20, 1.63], [27, 1.92], [34, 2.13], [44, 2.24], [54, 2.34], [63, 2.41], [71, 2.48], [79, 2.49], [90, 2.49], [100, 2.49],
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
// レアは帯の上限LVの0.8倍。ボスは帯の上限LVのプレイヤーの何倍か（1回で勝てなくてよい）。
// ボスの倍率＝エリアの値（AREA_BOSS）×①②③の倍率（SUB_BOSS）。
//   【確定】③のボスは特に強い（ユーザー指示）＝③は①②の1.25倍。③はLVもエリアで一番高いので、③のボスが一番強い
//   ⚠前は45か所を1体ずつ日数で合わせていたが、②のボスが③より強いエリアが出た＋測りのぶれが大きかった
//     （2026-10-09 実際に踏んだ）。なので合わせるのはエリアの値（15個）だけにした
// ★AREA_BOSS は「そのエリアの③を倒すのが目安の日になる」ように `--tune` で逆算した値（勘で書き換えないこと）。
//   目安は今のⅡと同じ日数をエリアへ割り振ったもの（tools/v2cap-progress.mjs の AREA_DAY）
export const NORMAL_RATIO = 0.6
export const RARE_RATIO = 0.8
export const SUB_BOSS = [1.0, 1.0, 1.25]
export const AREA_BOSS = [
  0.93, 0.78, 0.88, 0.96, 0.96, 0.94, 0.93, 0.86, 0.89, 0.96, 1.04, 0.94, 1, 0.96, 1.09,
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
