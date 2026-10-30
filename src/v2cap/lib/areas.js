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
import { statsOf } from '../core/enemies.js'
import { bodyPowerAt } from './level.js'
import { ROSTERS, ENEMY_LV } from './monsters.js'
import { CAP_RULES } from './rules.js'
import { raceOf } from './monsterRace.js'
import { papiaFighterOf } from './papia.js'

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
// 【確定】2026-10-27 ユーザー指示「①②③ってやってるけど、もっといい言い換えあったらそれにしたい」→案から「入口・奥地・最奥」、
//   「ほかの画面にもそろえる」：画面に出すときは ①②③ ではなくこの名前（場所の選択肢・祠・解放のログ・図鑑の出る場所）。
//   コードとコメントの「〇-①」はそのまま
export const SUB_NAMES = ['入口', '奥地', '最奥']
export const SPOT_COUNT = AREA_LIST.length * 3
export const LAST_SPOT = SPOT_COUNT

// ===== 経験値とGold（1体あたり・範囲の中でランダム）=====
// 【確定】始まりの森・荒廃した草原はユーザーの表の値。古代の洞窟から先は「同じ伸び方で埋める」（ユーザー承認）：
//   エリアが1つ進むごとに 経験値+2・Gold+5。①②③の幅は表と同じ
//   （経験値 ① a〜a+1 ／ ② a〜a+2 ／ ③ a+1〜a+3、Gold ① g〜g+5 ／ ② g〜g+7 ／ ③ g〜g+10）
// 【確定】2026-10-21 ユーザー指示「最小値と最大値1ずつ上げて」：経験値は全部の場所で最小・最大とも+1（a＝エリア×2＋1。始まりの森① 3〜4）
export const expRangeOf = (areaNo, sub) => {
  const a = 2 * areaNo + 1
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
  return s ? `${s.areaName} ${SUB_NAMES[s.sub - 1]} ${s.name}` : ''
}

// ===== 敵のLV =====
// 【確定】敵ごとに一定（monsters.js の ENEMY_LV。場所が変わっても同じ）
// 【確定】2026-10-13 ユーザー指示「時間限定の敵はエリアごとに強くなるように」→案から「いちばん強いふつうの敵と同じLV」：
//   **朝昼晩の敵だけ**は場所ごとにLVが変わる＝その場所に出るふつうの敵のうち、いちばん高いLV
//   （①はいまのまま＝表の2体目・②は4体目・③は6体目のLV。始まりの森は 2→11→13）。強さもその敵と同じ（下の enemyPowerOf）
// 「場所|名前」→ { name, role, spot, band, lv }（役割・時間帯・その場所でのLV）
const PLACES = new Map()
const placeKey = (spot, name) => `${spot}|${name}`
for (const s of SPOTS) {
  const r = s.roster
  const topLv = Math.max(...r.enemies.map(e => ENEMY_LV[e.name] || 1))
  const put = (e, role, lv = ENEMY_LV[e.name] || 1) => PLACES.set(placeKey(s.id, e.name), { name: e.name, role, spot: s.id, band: e.band || null, lv })
  for (const e of r.enemies) put(e, 'normal')
  for (const e of r.timed) put(e, 'timed', topLv)
  for (const e of r.rares) put(e, 'rare')
  put(r.boss, 'boss')
}
// spot は顔ぶれの確かめ用（その場所にいない敵はLV1を返す＝前と同じ）
export const enemyLvOf = (name, spot) => PLACES.get(placeKey(spot, name))?.lv || 1
export const enemyRoleOf = (name, spot) => PLACES.get(placeKey(spot, name))?.role || 'normal'
// その場所の敵のLVの範囲（いちばん低い敵〜いちばん高い敵＝ボス）。画面とサーバーの v2cap_spots に出す
export const spotLvOf = (id) => {
  const lvs = [...PLACES.values()].filter(p => p.spot === id).map(p => p.lv)
  return lvs.length ? [Math.min(...lvs), Math.max(...lvs)] : [1, 1]
}
export const spotLvText = (id) => { const [a, b] = spotLvOf(id); return a === b ? `LV${a}` : `LV${a}〜${b}` }

// ===== 推奨LV（場所の選択肢に出す）=====
// 【確定】2026-10-12 ユーザー指示「推奨レベル　って表記の仕方にして上限のレベルはボスを倒せる目安のレベルで　最後のボスは80になるようにして」：
//   SPOT_REC_LV ＝ 場所ごとの「ボスを倒せる目安のLV」。測り方（2026-10-12・初期職11職×2人・450時間・実際に落ちた装備）：
//   ・各エリアの③ … ボスを初めて倒したときのLVの中央値（tools/v2cap-progress.mjs の lvAtClear）。
//     A1〜15＝14/18/22/23/29/36/39/44/47/50/51/53/66/70/77（最後は77→ユーザー指示どおり80。目安なのでボスの強さは変えていない）
//   ・各エリアの①② … 前の③との間を3等分（①②のボスは③より弱く、前の③で止まっていた人が着いてすぐ倒す＝測ると③と同じLVになるため）
//   ・①-① … 5（ユーザー「レベル5ぐらいで倒せる」＝下の BOSS_SPOT_POWER でボスを合わせた）・①-②は①-①と①-③のまんなか
//   画面は「推奨LV（前の場所の目安）〜（この場所の目安）」＝①-①は「推奨LV1〜5」。前と同じ数なら「推奨LV22」（表記ルールで「レベル」は数の前では LV）
// 【確定】2026-10-13 敵を全部測り直したので測り直した。ユーザー「80、レベルがどうこうッテよりかは、実際には戦闘力が大事だから、
//   レベル80以下でも戦闘力しっかり高かったら勝てるぐらいでいい」＝最後は80のまま：
//   ・各場所 … **その場所の目安の時間に、真ん中の人が何LVか**（初期職11職×2人・450時間・落ちた装備＋鍛冶屋。tools/v2cap-progress.mjs の lvAtSpotHour）。
//     ボスを初めて倒したLVはエリア8から倒せる人が少なく（速い職業だけ）ばらつくので、こちらにした（エリア7まではどちらでもほぼ同じ）
//   ・エリア8から先は、測った値（〜90）を「7-③の59〜最後80」に縮めた ／ ①-①は5のまま
//   ・③＝18/25/31/37/41/52/59/64/68/71/73/75/77/79/80
//   ★測り直したら貼り直す（scratchpad の lv-at-target.mjs と同じ測り方）
export const SPOT_REC_LV = [
  5, 15, 18, 20, 22, 25, 27, 29, 31, 33, 34, 37, 38, 39, 41,
  44, 47, 52, 54, 56, 59, 60, 62, 64, 65, 66, 68, 69, 70, 71,
  71, 72, 73, 73, 74, 75, 75, 75, 77, 77, 77, 79, 79, 79, 80,
]
export const recLvOf = (spotId) => SPOT_REC_LV[Math.min(SPOT_REC_LV.length, Math.max(1, spotId)) - 1]
export const recRangeOf = (spotId) => [spotId > 1 ? recLvOf(spotId - 1) : 1, recLvOf(spotId)]
export const recLvText = (spotId) => { const [a, b] = recRangeOf(spotId); return a === b ? `推奨LV${b}` : `推奨LV${a}〜${b}` }
// そのLVの推奨の場所＝推奨LVの上限がそのLV以上の、いちばん手前の場所（最後の場所の上限より上のLVは最後の場所）
export const recSpotOfLv = (lv) => SPOTS.find(s => recLvOf(s.id) >= Math.max(1, lv || 1)) || SPOTS[SPOTS.length - 1]
// その場所で10回出撃したくらいのEXP＝ふつうの敵の1体あたりのEXPのまんなか × 10 ＝ 5 ×（最小＋最大）。
// デイリーミッションと宝樹（吉）のEXP（2026-10-12 ユーザー指示「そのレベルの推奨エリアを10回出撃したときくらいの経験値にして」）。
// ★サーバーの v2cap_ten_sortie_exp と同じ（v2cap_spots.rec_lv・exp_min・exp_max）
export const tenSortieExpOf = (lv) => { const s = recSpotOfLv(lv); return 5 * (s.exp[0] + s.exp[1]) }
// サーバーの種（v2cap_enemies）を作るための一覧（名前＋場所ごとに1行）
export const enemyLevels = () => [...PLACES.values()].map(p => ({ name: p.name, spot: p.spot, lv: p.lv, role: p.role, band: p.band }))

// ===== 敵の強さ =====
// そのLVのプレイヤーの「標準の戦闘力」（本体＋その時点の装備＋クラスのステ）。本体の戦闘力に対する倍率を
// LVの折れ線で持つ（間は直線で補う）。倍率はLVが上がって少し下がることもあるが、標準の戦闘力そのものは下がらない。
// ★値は `node tools/v2cap-progress.mjs --tune` の出力をそのまま貼る（勘で書き換えないこと）。
// 【確定】2026-10-12 ユーザー指示「敵の強さちょっと強すぎるかも、とくに最初は装備全然そろっていないと思うから
//   それも想定して敵の強さ考えて。少なくとも、エリア①の①の通常の敵は装備とかなくても倒せるくらいの強さでいい」：
//   ・LV1の行 1.02 → 0.75（始まりの森①の敵を2割ほど弱く。LV1・装備なし・ポイントなしで、ふつう・朝昼晩の敵に全職業99%以上。
//     前は朝昼晩の魔法型「ひなたアゲハ」に魔法職が63%）。LV1・LV5の行は測り直しでも動かさない（v2cap.test.js が見張る）
//   ・LV34以下の行とエリア1〜5のボスの倍率は「**実際に落ちた装備だけ**」で進む人で測り直した（--gear drops）。
//     前は「行ったエリアの装備をレジェンダリーまで全部持っている人」で測っていて、序盤が目安の2〜3倍かかっていた
//   ・LV44から先の行とエリア6から先のボスは前の測り方（いちばん良い装備）のまま。職業の差を直すときにまとめて測り直す
//     （全部を測り直すと遅い職業が中盤で詰まる＝ユーザー承認の範囲はエリア1〜5）
// 【確定】2026-10-12 ユーザー指示「序盤の敵が弱すぎる、技全部交わせちゃうからもう少し強くてもいい」→案から「1.6倍」、
//   さらに「エリア１－2、１－３になったら敵の強さ上がるよね？それだったら１－１は弱くていい」：
//   ・**①-①の敵（LV1〜2）は前のまま**＝LV2の行（0.83＝前の線の上の値）を足して止めた（初期装備なしのLV1でも勝てるまま）
//   ・LV5・LV10の行を1.6倍、LV15を1.3倍、LV20を1.15倍（1.07→1.71・1.69→2.70・2.26→2.94・2.65→3.05）。
//     エリア1にLV3〜9の敵はいないので、強くなるのは①-②・①-③の敵（LV10〜15）とエリア2、エリア3の初め
//   ・前は始まりの森の敵が弱く、AGIの高い職業は敵の技をほとんどよけていた
// 【確定】2026-10-13 全部の行を測り直した（ユーザー承認「見込みの表を上限に実際に強化」）：落ちた装備＋鍛冶屋の人（11職×2人・450時間）の
//   **強化なしの**戦闘力で測る（強化ぶんは ENH_MULT）。前の値のままだと、上位職（約5時間目）や CLASS LV の上がりやすさで
//   自分の戦闘力がこの線の1.3〜1.6倍あり、エリア10までが目安の2〜3倍速かった。LV1・LV2の行は固定・LV5〜20の行は上の値より下げない
// 【確定】2026-10-30 ユーザー指示「いろいろ調整してきたからモンスターの調整もしてほしい、モンスターはプレイヤーのレベルもそうだけど装備、
//   アセンション、スキルなども考慮したうえで設計してほしい」：シミュレーターの人がアセンションを開くようにして（tools/v2cap-progress.mjs の ascSpend）
//   全部を測り直した。前の値のままだと、自分の戦闘力（アセンションこみ）がこの線の1.18〜1.34倍あり、どのエリアも目安の3〜5倍速かった
//   （最後のエリアを抜けるのが121時間・目安365）。LV10 3.36→3.97・LV34 4.30→5.36・LV54 4.61→5.92・LV79 3.77→4.85・LV100 3.52→4.24
export const STD_RATIO = [
  [1, 0.75], [2, 0.83], [5, 2.94], [10, 3.97], [15, 4.74], [20, 5.1], [27, 4.48], [34, 5.36], [44, 5.75], [54, 5.92], [63, 5.48], [71, 5.14], [79, 4.85], [90, 4.48], [100, 4.24],
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
// ★AREA_BOSS は「そのエリアの③を倒すのが目安の時間になる」ように `--tune` で逆算した値（勘で書き換えないこと）。
//   目安は今のⅡと同じ日数をエリアへ割り振ったもの（tools/v2cap-progress.mjs の AREA_HOUR）
//   ★エリア1〜5（2026-10-12）は「**7割の人が目安の時間までに倒せる**」ように合わせた（--pct 0.7・初期職11職×2人）。
//     真ん中の人に合わせると、古代の番人（エリア3）で半分の職業が目安の2〜3倍詰まった
export const NORMAL_RATIO = 0.6
export const RARE_RATIO = 0.8
export const SUB_BOSS = [1.0, 1.0, 1.25]
//   ★2026-10-30 全部を測り直した（STD_RATIO の上の【確定】）。合わせ方は前と同じ（エリア1〜5は7割の人・6からは真ん中の人・
//     エリア1〜5は序盤の手直しを外して目安に合わせ、手直しは上から掛けたまま＝ユーザー選択「合わせ直す・手直しは残す」）。
//     ボスの並びの下限で強さが決まるエリアは、下限のもとのエリアと組で動かした（tools/v2cap-progress.mjs の --tune）
export const AREA_BOSS = [
  1.44, 1.11, 1.4, 1.63, 1.42, 1.69, 1.42, 1.37, 1.34, 1.47, 1.53, 1.18, 1.47, 1.38, 1.45,
]
// 場所ごとのボスの戦闘力（決めた値で止める）
// 【確定】2026-10-12 ユーザー指示「ボスをそんなすぐに倒されても困る、レベル5ぐらいで倒せるようになればいい※目安」：
//   ①-①のボス（オヤブンネズミLV10）は戦闘力135。初期装備・その LV の CLASS LV・最初の編成で、
//   11職の勝率の中央値は LV4 2%・LV5 67%（いちばん低い職業46%）・LV6 99%。序盤の敵を1.6倍にしたときに一緒に強くなりすぎていた
//   （LV10の行を使うので。①-①を抜けるのが7分→24分になっていた＝実機テストで見つけた）
//   ★2026-10-13 標準の戦闘力を測り直すと LV10 の行が動くので、倍率（前は BOSS_SPOT_ADJ 0.6倍）ではなく戦闘力で止めた（「①-①はいまのまま」）
export const BOSS_SPOT_POWER = { 1: 135 }
export const bossRatioOf = (spotId) => {
  const s = spotOf(spotId)
  return s ? AREA_BOSS[s.area - 1] * SUB_BOSS[s.sub - 1] : 1
}
export const roleRatioOf = (role, spotId) =>
  role === 'boss' ? bossRatioOf(spotId) : role === 'rare' ? RARE_RATIO : NORMAL_RATIO

// ===== 装備の強化の見込み =====
// 【確定】2026-10-13 ユーザー指示「装備の強化で戦闘力上がる予定だから、敵の戦闘力もっと上げていい」
//   「エリアごとに変えてほしくて、1は未強化、2～3は＋３、4～10は＋６、１１～＋10にして」：
//   エリアの敵を「着けている装備をこの強化値まで上げた人」に合う強さにする＝ENH_MULT を掛ける（強化しない人は目安より遅れる）。
//   ★〇-①に入った時点の見込みは前のエリアのまま（下の「エリアの境目」で〇-①を前の③にそろえる）
//   ★シミュレーターの人は、この値を上限に Gold と残骸で実際に強化する（tools/v2cap-progress.mjs の鍛冶屋）
export const ASSUMED_PLUS = [0, 3, 3, 6, 6, 6, 6, 6, 6, 6, 10, 10, 10, 10, 10]
export const assumedPlusAt = (spotId) => {
  const s = spotOf(spotId)
  return s ? ASSUMED_PLUS[(s.sub === 1 && s.area > 1 ? s.area - 1 : s.area) - 1] : 0
}
// エリアの敵に掛ける倍率＝そのエリアにいる人の戦闘力が、強化で何倍になっているか（測った値。勘で書き換えないこと）。
// 測る人：落ちた装備＋鍛冶屋でGoldと残骸を使って実際に強化する人（**見込みの強化値が上限**・2026-10-13 ユーザー「見込みの表を上限に実際に強化」）。
// `node tools/v2cap-progress.mjs --tune` が標準の戦闘力（強化なしで測る）・ボスの倍率と一緒に作り直す（確かめは --enh）
export const ENH_MULT = [1, 1.06, 1.07, 1.12, 1.13, 1.12, 1.12, 1.13, 1.14, 1.15, 1.21, 1.24, 1.25, 1.25, 1.27]

// ===== エリアの境目とボスの並び =====
// 【確定】2026-10-13 ユーザー指示「〇ー１はひとつ前の〇ー3と同じくらいの強さに、ボスだけちょっと強く」
//   「10－①の強さを9－3よりも強くしてって言ってんの」：
//   ・〇-①のふつうの敵（表の上の2体＝②にも出る）は、前のエリアの③のふつうの敵（4体）の平均と同じ強さにそろえる
//     （2体の比はLVのまま）。前は1〜32%強かった（1-③→2-① 124→164）。朝昼晩の敵はその場所のいちばん強いふつうの敵と同じ
//   ・ボスは45か所で必ず前の場所より強い：〇-①＝前の③×BOSS_STEP_IN、③は①の BOSS_TOP_MIN 倍以上、②は①と③の間（掛け算のまんなか）。
//     ③の強さは今までどおり AREA_BOSS（目安の時間で測り直す）。前は〇-①のボスが前の③の0.70〜0.99倍だった
//   ・始まりの森は今のまま（①-①のボスは BOSS_SPOT_POWER＝戦闘力135・②③は AREA_BOSS×SUB_BOSS）
// 【確定】2026-10-13 ユーザー指示「〇－１中ボス　〇－２中ボス　〇－３大ボス」「〇＋１ー１の中ボスは戦闘力的にはそりゃ強くしたい
//   ※職業のかみ合わせ次第ではそのままの戦闘力でも行ける」→案から「自分の伸びに合わせる」：
//   〇-③（大ボス）は同じエリアの〇-①（中ボス）の BOSS_TOP_MIN 倍以上で、あとは AREA_BOSS（目安の時間）で決める。
//   ⚠下限を大きくすると、ボスは1エリアで「BOSS_STEP_IN×下限」倍ずつ必ず強くなる。自分の伸びは目安どおりに進んで
//     エリア2〜7が1エリア1.13〜1.28倍・エリア8から1.04〜1.09倍（LVが100に近づく・二次職がまだ無い）なので、
//     下限1.05倍（1エリア1.1025倍）でエリア7から先のボスが全部下限で決まり、エリア8から多くの人が止まった（測り直し tune14）。
//     下限1.1倍なら最後のボスが前の2倍になった
// 【確定】2026-10-30 ユーザー選択「〇-①＝前の③×1.01・③＝①×1.005以上」（前は 1.05・1.01＝1エリアで最低6%）：
//   アセンションを入れて敵を測り直したら、目安どおりに進んだ人の伸びは1エリアで エリア7〜10 3〜6%・エリア11〜15 1〜2%
//   （新しい装備は強化し直すまで前の強化済みに勝てない・LV・クラス・アセンションの伸びが止まる＝tools/v2cap-progress.mjs --pace）。
//   最低6%のままだとエリア7から先のボスが全部その下限で決まり、エリア8で204時間（目安135）・エリア12から先は22人中1〜3人だった。
//   最低1.5%にして、それより上は目安の時間（AREA_BOSS）で決める＝中ボスが前の大ボスより少し強いのは残る
//   ⚠〇-②のボスは「①と③のあいだ」で決まる＝測り直しでは動かせない。12-②の奈落蜘蛛アラクネ（速い型 BOSS_FAST・AGIが高い）は
//     同じ戦闘力でもよけやすく（よけやすさは AGI の比の5乗）、測り直したあとは22人中11人が450時間まで止まる。
//     【確定】2026-10-30 ユーザー選択「このまま」（AGI・DEXに上限を入れる案／アラクネの型を変える案は選ばなかった）
export const BOSS_STEP_IN = 1.01
export const BOSS_TOP_MIN = 1.005

// ===== 序盤の手直し（エリア1〜5）=====
// 【確定】2026-10-14 ユーザー指示「序盤の敵の強さとボスの強さやっぱり強すぎる」「中ボスの強さ1割下げて、大ボスも2割下げて」
//   →案から「〇-②より少し強い所で止める」「序盤だけ（エリア1〜5）」「（ふつうの敵も）1割下げる」：
//   ・エリア1〜5の中ボス（〇-①・〇-②）×0.9（①-①のボスも 135→122）
//   ・エリア1〜5の大ボス（〇-③）×0.8。ただし同じエリアの〇-②（下げたあと）の BOSS_TOP_MIN 倍より弱くはしない
//     （そのまま2割下げると、エリア2・3・5で大ボスが中ボスより弱くなった）
//   ・エリア1〜5のふつうの敵 ×0.9。朝昼晩の敵は「その場所のいちばん強いふつうの敵」なので一緒に下がる。
//     ①-①の敵（スライム・コウモリ＝①-②にも出る）とレアの敵はいまのまま
//   ・エリア6から先はいまのまま（6-①のボスとふつうの敵は、下げる前の 5-③ から決める＝5-③→6-① で約1〜2割強くなる）
//   ★目安の時間で測った強さ（STD_RATIO・AREA_BOSS）の上から掛ける。⚠測り直すと、この手直しを打ち消す向きに合わせてしまうので、
//     測り直すときはエリア1〜5のボスの倍率とLV34以下の行を動かさない（tools/v2cap-progress.mjs の --bossmin 6 --stdmax 2）
export const EARLY_AREAS = 5
export const EARLY_NORMAL_CUT = 0.9
export const EARLY_MID_BOSS_CUT = 0.9
export const EARLY_BIG_BOSS_CUT = 0.8
// 測り直しのときだけ手直しを外す（tools/v2cap-progress.mjs の --nocut・2026-10-30）。手直しは「目安の時間に合わせた強さ」の
//   上から掛けるものなので、掛けたまま測ると打ち消す向きに合わせてしまう（前は --bossmin 6 --stdmax 2 で序盤を動かさずに逃げていた）
let EARLY_CUT_ON = true
export const setEarlyCutForTuning = (on) => { EARLY_CUT_ON = on }

// 全部の敵の戦闘力の表（「場所|名前」→ 戦闘力）。一度作ったら使い回す。
// now＝いまの強さ／base＝序盤の手直しの前（テストと測り直しの確かめ用）
// ⚠STD_RATIO・AREA_BOSS・ENH_MULT を書き換えたら resetEnemyCache() を呼ぶ（tools/v2cap-progress.mjs の --tune が呼ぶ）
let POWER = null
export const resetEnemyCache = () => { POWER = null }
const roundPowers = (m) => new Map([...m].map(([key, p]) => [key, Math.max(1, Math.round(p))]))
// 序盤の手直しを掛ける（out は丸める前の表。書き換える）
const applyEarlyCut = (out) => {
  const firstSpot = new Set(spotOf(1).roster.enemies.map(e => e.name))   // ①-①の敵はいまのまま
  for (let k = 0; k < EARLY_AREAS; k++) {
    const spots = [1, 2, 3].map(sub => spotOf(k * 3 + sub))
    for (const s of spots) {
      let top = 0
      for (const e of s.roster.enemies) {
        const key = placeKey(s.id, e.name)
        if (!firstSpot.has(e.name)) out.set(key, out.get(key) * EARLY_NORMAL_CUT)
        top = Math.max(top, out.get(key))
      }
      for (const e of s.roster.timed) out.set(placeKey(s.id, e.name), top)
    }
    const [k1, k2, k3] = spots.map(s => placeKey(s.id, s.roster.boss.name))
    const b2 = out.get(k2) * EARLY_MID_BOSS_CUT
    out.set(k1, out.get(k1) * EARLY_MID_BOSS_CUT)
    out.set(k2, b2)
    out.set(k3, Math.max(out.get(k3) * EARLY_BIG_BOSS_CUT, b2 * BOSS_TOP_MIN))
  }
}
const buildPowers = () => {
  const out = new Map()
  const boss = []   // 場所の番号 → ボスの戦闘力（丸める前）
  for (let k = 0; k < AREA_LIST.length; k++) {
    const enh = ENH_MULT[k] ?? 1
    const [s1, s2, s3] = [1, 2, 3].map(sub => spotOf(k * 3 + sub))
    const natural = (spot, name, ratio) => stdPowerAt(enemyLvOf(name, spot.id)) * ratio * enh
    // ふつうの敵（名前ごとに1つ＝①②どちらに出ても同じ強さ）
    const normal = new Map()
    for (const s of [s1, s2, s3]) for (const e of s.roster.enemies) if (!normal.has(e.name)) normal.set(e.name, natural(s, e.name, NORMAL_RATIO))
    if (k > 0) {
      const prev3 = spotOf(k * 3).roster.enemies.map(e => out.get(placeKey(k * 3, e.name)))
      const target = prev3.reduce((t, p) => t + p, 0) / prev3.length
      const pair = s1.roster.enemies.map(e => e.name)
      const f = target / (pair.reduce((t, n) => t + normal.get(n), 0) / pair.length)
      for (const n of pair) normal.set(n, normal.get(n) * f)
    }
    for (const s of [s1, s2, s3]) {
      let top = 0
      for (const e of s.roster.enemies) { const p = normal.get(e.name); out.set(placeKey(s.id, e.name), p); top = Math.max(top, p) }
      for (const e of s.roster.timed) out.set(placeKey(s.id, e.name), top)
      for (const e of s.roster.rares) out.set(placeKey(s.id, e.name), natural(s, e.name, RARE_RATIO))
    }
    // ボス
    const nat = (s) => BOSS_SPOT_POWER[s.id] ?? stdPowerAt(enemyLvOf(s.roster.boss.name, s.id)) * bossRatioOf(s.id) * enh
    let b1 = nat(s1), b2 = nat(s2), b3 = nat(s3)
    if (k > 0) {
      b1 = boss[k * 3] * BOSS_STEP_IN
      b3 = Math.max(b3, b1 * BOSS_TOP_MIN)
      b2 = Math.sqrt(b1 * b3)
    }
    ;[b1, b2, b3].forEach((b, i) => { boss[k * 3 + i + 1] = b; out.set(placeKey(k * 3 + i + 1, [s1, s2, s3][i].roster.boss.name), b) })
  }
  const base = roundPowers(out)
  if (EARLY_CUT_ON) applyEarlyCut(out)
  return { now: roundPowers(out), base }
}
// enemy は場所の顔ぶれ（SPOTS の roster）の敵＝いる場所（spot）を持っている
export const enemyPowerOf = (enemy) => {
  POWER ||= buildPowers()
  return POWER.now.get(placeKey(enemy.spot, enemy.name)) ?? 1
}
// 序盤の手直しの前の強さ（エリア6から先は enemyPowerOf と同じ）
export const enemyBasePowerOf = (enemy) => {
  POWER ||= buildPowers()
  return POWER.base.get(placeKey(enemy.spot, enemy.name)) ?? 1
}

// ===== 敵のHPとVIT（配分の手直し）=====
// 【確定】2026-10-30 ユーザー指示「モンスターはプレイヤーのレベルもそうだけど装備、アセンション、スキルなども考慮したうえで設計してほしい」
//   「HPを上げすぎないで、上げるならVITとかそこら辺を上げて」：
//   配分（monsters.js の dist）のHPの割合を ENEMY_HP_SHARE 倍にし、減らしたぶんをそのままVITへ足す（戦闘力の合計は同じ）。
//   倍率はボスと、ほかの敵（ふつう・朝昼晩・レア）で別（ボスは戦闘力の上がり方が大きいので）。
//   強さ（戦闘力）はこの配分のまま測り直した（tools/v2cap-progress.mjs --tune）
//   ★VITで減らせるダメージには上限がある（物理34%・魔法50%＝combat.js の reductionRate）。VITだけでは届かないぶんは、
//     測り直しで戦闘力そのもの（＝攻撃のステも）が上がる
//   ★①-①（木漏れ日の小径）の敵・朝昼晩の敵・ボスと、①-①のふつうの敵（スライム・コウモリ＝①-②にも出る）は配分を変えない
//     （前に決めた強さ＝装備なしのLV1で勝てる・ボスはLV5くらいで倒せる を守る。序盤の手直しで動かさないのと同じ）
//   ★倍率は測り直しのあとのHPがほぼ今のままになるように選んだ：前とくらべて ふつうの敵0.9〜1.0倍・ボス0.9〜1.1倍（VITは3〜5倍）。
//     勝ったボス戦のターン数は前と同じくらい（前 7〜10・いま 6〜9）
export const ENEMY_HP_SHARE = { normal: 0.77, boss: 0.6 }
export const setEnemyHpShareForTuning = (normal, boss) => { ENEMY_HP_SHARE.normal = normal; ENEMY_HP_SHARE.boss = boss }
const FIRST_SPOT_NORMALS = new Set(spotOf(1).roster.enemies.map(e => e.name))
export const enemyDistOf = (enemy) => {
  const dist = enemy?.dist
  if (!dist || enemy.spot === 1 || FIRST_SPOT_NORMALS.has(enemy.name)) return dist
  const f = enemyRoleOf(enemy.name, enemy.spot) === 'boss' ? ENEMY_HP_SHARE.boss : ENEMY_HP_SHARE.normal
  if (f === 1) return dist
  const hp = (dist.hp || 0) * f
  return { ...dist, hp, vit: (dist.vit || 0) + (dist.hp || 0) - hp }
}

// 戦闘用。uses＝1回の戦闘でそれぞれの技を何回使えるか
// ★今のⅡの「エリアの相性（物理／魔法が通りやすい）」は付けない（1本道なので）
// ★敵にもこの版の決まり（CAP_RULES）を混ぜる＝プレイヤーの麻痺・封印も受けるたび下がる
// ★race＝モンスターの種族（monsterRace.js・2026-10-25）。上位職の技（異端審問官のアンデッドと悪魔への＋20%・1.3倍など）が見る
export const toFighter = (enemy, uses = 8, power = enemyPowerOf(enemy)) => (enemy.papia ? papiaFighterOf(enemy) : {
  ...CAP_RULES,
  name: enemy.name,
  kind: enemy.kind,
  race: raceOf(enemy.name),
  stats: statsOf({ ...enemy, power, dist: enemyDistOf(enemy) }),
  slots: (enemy.skills || []).map(s => ({ skill: s, uses })),
  taken: null,
})   // ★パピアは強さの決まりの外（papia.js）
