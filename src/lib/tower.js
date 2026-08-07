import { PEN_CAP } from './stats.js'
// ============================================================
// エンドレスタワーデータ定義
// ------------------------------------------------------------
// ・解放条件: キャラLV1000（現状は is_admin 限定の開発先行）
// ・1層の流れ:
//     ① 出撃を (30 + エリア数×10) 回こなす → 強敵が5%で出現するようになる
//     ② 強敵を撃破 → そのエリアのエリアボスに挑戦できる（以降いつでも何度でも）
//     ③ エリアボス挑戦 = 雑魚1体 → 雑魚1体 → 雑魚2体 → 雑魚3体 → 強敵 → エリアボス の6連戦
//        この連戦中はHP/MPが一切回復しない（持ち越し）
// ・入場時のHP/MPは満タン固定の「タワー専用プール」。街の hp_current/mp_current とは切り離す
// ・アイテムは街と同じように普通に使える（無限ポーション含む）
// ・内部推奨力 = 2万 × 1.2^(層-1)。開発上の目安であり、プレイヤーには表示しない
//
// 詳細な設計根拠は docs/tower-design.md を参照。
// ============================================================

// 内部推奨力（開発用の目安。UIには出さない）
export const towerTarget = (floor) => Math.round(20000 * Math.pow(1.2, floor - 1))

// エリアボスに挑戦できるようになるまでに必要な出撃の回数
export const sortiesToMidBoss = (floor) => 30 + floor * 10

// 強敵の出現率（しきい値到達後の出撃ごと・天井なし）
export const MID_BOSS_RATE = 0.05

// ============================================================
// ⚠外側のつまみは 2026-08-06 に全部データへ焼き込んで 1.0 にした。
// ------------------------------------------------------------
// 以前は「データの攻撃9,300 × 技1.5 × ボス1.3 × 層1.5 → 実戦18,135」のように
// 数字が何重にも化けていて、敵データを読んでも強さが分からなかった。
// さらに、その隠れた倍率で埋めていたのは「プレイヤーが総合力に乗せていない強さ」
// （会心・貫通・回避・命中・装備の特殊能力・スキル・パッシブ。敵にはどれも無い）で、
// 実測では敵は総合力で約1.9倍ないと1体戦で五分にならない。
// 埋め合わせは敵データの数値そのもので表すこと。ここを1.0以外に戻さない。
// ============================================================
export const ENEMY_SKILL_POWER = 1.0   // 技の威力（通常攻撃には掛からない）
export const ENEMY_ATK_POWER = 1.0     // 強敵・エリアボスの攻撃力/特殊攻撃力
export const MOB_ATK_POWER = 1.0       // 道中の雑魚の攻撃力/特殊攻撃力

// 敵が受けるダメージの倍率（＝プレイヤーの与ダメージ）。
//  プレイヤーの火力が敵のHPに対して高すぎたため絞る。1.0で等倍・0.7で3割減。
//  ⚠敵のHPは増やさない。HPを増やすと与ダメージ割合回復（血の狂気・紋章の吸収など）が
//    そのぶん伸びてしまい、体感が変わらないため。
export const ENEMY_DMG_TAKEN = 0.7   // 強敵・エリアボス（1〜4層の値。5層以降は下の表）
export const MOB_DMG_TAKEN   = 0.5   // 道中の雑魚（同上）

// ============================================================
// 層ごとの被ダメージ倍率（2026-08-07追加）
// ------------------------------------------------------------
// エンドポイントは「与ダメージ+」「被ダメージ-」を1段0.5%ずつ、1ノード最大50段まで
// 積める。振り切ると与ダメ+25%・被ダメ-25%・最大HP+50%になり、敵の数値をいくら
// 上げても上の層が素通りになる（実測: エンド350点で6層36%・エンド0点なら0%）。
// そこで層が上がるほど「敵が受けるダメージ」を緩やかに絞る。
// 敵の与ダメージ側の傾斜は敵データの攻撃力に直接焼き込んである（ここには無い）。
//
// ⚠1〜4層は一般公開中なので 0.70 / 0.50 のまま動かさない。傾斜は5層から。
// ⚠これは敵のステータスではなくプレイヤーの与ダメージに掛かる係数なので、
//   敵データの数値では表現できない。ここに層ごとの実数で置く（式にしない）。
export const FLOOR_DMG_TAKEN = [
  { boss: 0.70, mob: 0.50 },   //  1層
  { boss: 0.70, mob: 0.50 },   //  2層
  { boss: 0.70, mob: 0.50 },   //  3層
  { boss: 0.70, mob: 0.50 },   //  4層
  { boss: 0.68, mob: 0.49 },   //  5層
  { boss: 0.66, mob: 0.47 },   //  6層
  { boss: 0.64, mob: 0.46 },   //  7層
  { boss: 0.62, mob: 0.45 },   //  8層
  { boss: 0.60, mob: 0.43 },   //  9層
  { boss: 0.58, mob: 0.42 },   // 10層
]
// 表の外（11層以降）は最後の層の値をそのまま使う。層を足すときは表も伸ばすこと。
export const floorDmgTakenOf = (floor, isBoss) => {
  const i = Math.max(0, (floor | 0) - 1)
  const row = FLOOR_DMG_TAKEN[Math.min(i, FLOOR_DMG_TAKEN.length - 1)]
  return isBoss ? row.boss : row.mob
}

// ※かつてここに FLOOR_POWER（層ごとに敵の攻撃力を持ち上げる係数）があったが、
//   2026-08-06に敵データへ焼き込んで全部1.0になり、2026-08-07に削除した。
//   層ごとの強さは TOWER_FLOORS の数値そのもので表す。同じものを作り直さないこと。

// ============================================================
// 長期戦の回復阻害（2026-08-07追加）
// ------------------------------------------------------------
// 聖騎士・聖職者のような持久型が、削り切れないまま回復で粘り続けて
// 層が上がっても勝率が落ちない状態になっていた（5層で100%/97%）。
// 20ターンを過ぎたら1ターンごとに回復量を5%ずつ削り、40ターンで完全に効かなくする。
// 敵の数値を上げて潰そうとすると他の職が先に全滅するので、時間のほうを止める。
//
// ⚠プレイヤー側の回復すべてに掛ける（スキル・吸収・血の狂気・リジェネ・ポーション）。
//   どれか1つでも素通りさせると、そこだけで粘れてしまい意味がなくなる。
export const LONG_FIGHT_FROM = 20      // このターンまでは影響なし
export const LONG_FIGHT_HEAL_CUT = 0.05  // 超えた1ターンごとに減る割合
export const longFightHealMult = (turn) =>
  Math.max(0, 1 - Math.max(0, (turn | 0) - LONG_FIGHT_FROM) * LONG_FIGHT_HEAL_CUT)

// 出撃1回で得られるGold（2026-08-03確定）。
// 敵データの gold は調整用シミュレータの仮値で、街の出撃の何十倍もあり
// 経済を壊すため、出撃では使わずこの式で固定する。強敵に当たっても同額。
export const towerSortieGold = (floor) => floor * 300

// エリアボスを撃破したときのGold（2026-08-03確定）。
// 初回だけエリア数×100万、2回目以降は出撃と同じエリア数×300（周回で稼げないようにする）。
// ※実際に付与する額はサーバーが決める。ここは表示・テスト用の同じ式。
export const towerBossGold = (floor, isFirstClear) => isFirstClear ? floor * 1000000 : towerSortieGold(floor)

// エリアボス挑戦（6連戦）の間に無限ポーションで回復できる回数の上限（道中を含む・2026-08-03確定）
// ※5回では無限ポーションの5ターンCDに阻まれてほぼ届かず素通りだったため2回にした
export const RUN_POTION_LIMIT = 2

// 出撃1回で得られるエンドEXP（戦闘エリアによらず20〜30のランダム・2026-08-03確定）
// エリアボス撃破は初回だけ1000、2回目以降は出撃と同じ
// ※実際に付与する値はサーバーが決める。ここは表示・テスト用の同じ定義。
export const TOWER_EXP_MIN = 20
export const TOWER_EXP_MAX = 30
export const BOSS_FIRST_TOWER_EXP = 1000

// エンドレベル lv → lv+1 に必要なエンドEXP（2026-08-03変更: 5×LV² は伸びが急すぎたので直線に）
//  2026-08-04: エンドポイントの段数解放はLV350で打ち止め（50段）なので、
//  それ以降まで必要EXPが伸び続ける意味がない。LV400からは一定（50×400=20,000）にする。
export const TOWER_EXP_FLAT_FROM = 400
export const towerExpToNext = (lv) => 50 * Math.min(lv, TOWER_EXP_FLAT_FROM)

// 累計のエンドEXPからエンドレベルと余剰EXPを求める
export const towerLevelFromExp = (totalExp) => {
  let lv = 1, rest = totalExp || 0
  while (rest >= towerExpToNext(lv) && lv < MAX_END_LEVEL) { rest -= towerExpToNext(lv); lv++ }
  return { lv, rest, next: towerExpToNext(lv) }
}

// ============================================================
// エンドポイント（全17ノード・効果はタワーの中だけで有効）
//  ・1段 = 0.5%（会心威力+/最大HP+/会心耐性+ だけ1段=1%）／1ノードの上限 = 50段
//  ・10段ごとに解放に必要なエンドレベルがある
// ============================================================
// 1段あたりの効果（%）。既定は0.5%だが、ノードごとに step で上書きできる
export const TREE_STEP_PCT = 0.5
export const TREE_MAX_STEPS = 50
// そのノードの1段あたりの%（TREE_NODES の step 指定が優先）
export const stepPctOf = (key) => TREE_NODES.find(n => n.key === key)?.step ?? TREE_STEP_PCT

// 段数の解放しきい値（この段数を超えて振るには、対応するエンドレベルが必要）
export const TREE_UNLOCK = [
  { upTo: 10, lv: 1 },
  { upTo: 20, lv: 50 },
  { upTo: 30, lv: 100 },
  { upTo: 40, lv: 200 },
  { upTo: 50, lv: 350 },
]

// エンドレベル lv のときに1ノードへ振れる最大段数
export const maxStepsAt = (lv) => {
  let max = 0
  for (const t of TREE_UNLOCK) if (lv >= t.lv) max = t.upTo
  return max
}
// 次の解放段数と必要なエンドレベル（すべて解放済みなら null）
export const nextUnlock = (lv) => TREE_UNLOCK.find(t => lv < t.lv) || null

export const TREE_NODES = [
  // ── 攻 ──
  { key: 'phys_dmg',   line: 'atk', name: '物理ダメージ+',       desc: '物理攻撃の与ダメージが上がる' },
  { key: 'mag_dmg',    line: 'atk', name: '特殊ダメージ+',       desc: '特殊攻撃の与ダメージが上がる' },
  { key: 'crit_rate',  line: 'atk', name: '会心率+',             desc: 'クリティカルの発生率が上がる' },
  { key: 'crit_dmg',   line: 'atk', name: '会心威力+',           desc: 'クリティカルの威力が上がる', step: 1.0 },
  { key: 'phys_pen',   line: 'atk', name: '物理貫通+',           desc: '相手の防御を無視する' },
  { key: 'mag_pen',    line: 'atk', name: '特殊貫通+',           desc: '相手の特殊防御を無視する' },
  // ── 守 ──
  { key: 'max_hp',     line: 'def', name: '最大HP+',             desc: '最大HPが上がる。6連戦を持ち越すので効果が大きい', step: 1.0 },
  { key: 'dmg_taken',  line: 'def', name: '被ダメージ-',         desc: '受けるダメージが減る' },
  { key: 'ail_resist', line: 'def', name: '状態異常耐性+',       desc: '毒・やけど・麻痺などの状態異常にかかりにくくなる' },
  { key: 'pct_resist', line: 'def', name: '割合ダメージ耐性+',   desc: '最大HPの割合で削ってくる効果を軽減する' },
  { key: 'crit_resist',line: 'def', name: '会心耐性+',           desc: '相手のクリティカル率を下げる', step: 1.0 },
  { key: 'evasion',    line: 'def', name: '回避率+',             desc: '相手の攻撃を回避しやすくなる' },
  // ── その他 ──
  { key: 'spd',        line: 'etc', name: '素早さ+',             desc: '行動順・会心率・回避に乗る' },
  { key: 'mp_cost',    line: 'etc', name: 'MP消費-',             desc: 'スキルの消費MPが減る。連戦のMP枯渇対策' },
  { key: 'kill_heal',  line: 'etc', name: '戦闘ごとにHP回復',     desc: '1戦を勝ち抜くたびに最大HPの一定割合を回復する。連戦の消耗を戻せる' },
  { key: 'ail_rate',   line: 'etc', name: '状態異常の付与率+',   desc: 'こちらが与える状態異常の成功率が上がる' },
  { key: 'exp_plus',   line: 'etc', name: '取得経験値+1の確率',  desc: 'タワーの中で得た通常EXPが+1される確率。エンドEXPには乗らない' },
]

// エンドレベルの上限（2026-08-03確定）。全17ノードを50段まで埋め切れる値にしてある。
// ノードを増やしたら自動で上限も伸びる（SQL側の打ち止めも合わせること）。
export const MAX_END_LEVEL = TREE_NODES.length * TREE_MAX_STEPS   // = 850

export const TREE_LINES = [
  { key: 'atk', label: '攻' },
  { key: 'def', label: '守' },
  { key: 'etc', label: 'その他' },
]

// 振り分けの段数を安全に読む。tree_alloc は jsonb なので数値以外が入りうる。
// NaN を通すとダメージ計算まで NaN が伝播して戦闘が壊れるため、ここで潰す。
const stepOf = (alloc, key) => {
  const raw = Number((alloc || {})[key])
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(TREE_MAX_STEPS, Math.floor(raw)))
}

// 振り分け alloc（{key: 段数}）から実効ボーナス（%）を返す
export const treeBonus = (alloc) => {
  const out = {}
  for (const n of TREE_NODES) out[n.key] = stepOf(alloc, n.key) * (n.step ?? TREE_STEP_PCT)
  return out
}
// 使用済みポイント
export const treeSpent = (alloc) =>
  TREE_NODES.reduce((s, n) => s + stepOf(alloc, n.key), 0)

// 振り直しにかかるGold（エンドレベルに比例）
export const treeResetCost = (lv) => 10000 * Math.max(1, lv)

// ============================================================
// 敵データ（1〜戦闘エリア10）
//  ・総合力 = floor(hp/10 + atk + def + matk + mdef + spd)（敵はMP=0）
//  ・skills: type は physical / magical / physical_multi / buff / debuff
//  ・mods / phases がエリアボスのギミック本体
// ============================================================
const E = (name, hp, atk, def, matk, mdef, spd, type, gold, skills, extra = {}) =>
  ({ name, hp, atk, def, matk, mdef, spd, type, gold, skills, ...extra })

export const TOWER_FLOORS = [
  // ── 戦闘エリア1 装甲 ──
  {
    floor: 1, boss: 'アーマードミノタウロス',
    enemies: [
      E('鉄角の仔牛', 30800, 2400, 2420, 0, 1430, 1500, 'physical', 450, [
        { name: '突進',     type: 'physical', mult: 2.1 },
        { name: '角ぶつけ', type: 'physical', mult: 1.8, stunRate: 0.1 },
      ]),
      E('牛頭の斧兵', 33000, 3400, 2750, 0, 1430, 500, 'physical', 500, [
        { name: '兜割り',       type: 'physical',       mult: 2.4 },
        { name: '斧の乱れ打ち', type: 'physical_multi', mult: 1.05, hits: 2 },
      ]),
      E('迷宮の鉄像', 30800, 0, 3300, 2200, 2090, 400, 'magical', 550, [
        { name: '石光の呪波', type: 'magical', mult: 2.1 },
        { name: '硬化',       type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
      ]),
    ],
    midBoss: E('エリートミノタウロス', 55000, 2990, 3300, 0, 2640, 1300, 'physical', 8000, [
      { name: '大斧の一撃', type: 'physical',       mult: 2.55 },
      { name: '威嚇の咆哮', type: 'debuff', effect: 'atkDown', rate: 0.8, turns: 3 },
      { name: '突進踏み',   type: 'physical_multi', mult: 1.2, hits: 2 },
    ], { mods: { physTakenMult: 0.9 } }),
    floorBoss: E('アーマードミノタウロス', 77000, 4534, 4620, 0, 3740, 2200, 'physical', 25000, [
      { name: '装甲突進',   type: 'physical',       mult: 2.7 },
      { name: '鉄角の乱打', type: 'physical_multi', mult: 1.2, hits: 3 },
      { name: '戦鬼の構え', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
      { name: '大地割り',   type: 'physical', mult: 2.4, defDownRate: 0.85, turns: 2 },
    ], {
      mods: { physTakenMult: 0.8 },
      summon: { hpBelow: 0.5, enemyIndex: 1, count: 2, once: true },
      specialMove: { name: '圧砕の鉄槌', type: 'physical', mult: 3.75, defDownRate: 0.8, turns: 3 },
    }),
  },
  // ── 戦闘エリア2 吸血 ──
  {
    floor: 2, boss: 'ブラッドダイアウルフ',
    enemies: [
      E('血狼', 49500, 2000, 1430, 0, 1980, 2200, 'physical', 900, [
        { name: '噛みつき', type: 'physical', mult: 2.1 },
        { name: '喉笛狙い', type: 'physical', mult: 1.8, bleedRate: 0.3 },
      ]),
      E('荒野のガルム', 50600, 3800, 1760, 0, 2090, 800, 'physical', 1000, [
        { name: '裂爪', type: 'physical',       mult: 2.4 },
        { name: '双牙', type: 'physical_multi', mult: 1.05, hits: 2 },
      ]),
      E('吸血コウモリ', 44000, 0, 1540, 2500, 3300, 1400, 'magical', 1100, [
        { name: '吸血の羽音', type: 'magical', mult: 2.1 },
        { name: '超音波',     type: 'debuff', effect: 'spdDown', rate: 0.8, turns: 3 },
      ], { mods: { lifesteal: 0.2 } }),
    ],
    midBoss: E('ハウリングダイアウルフ', 82500, 3250, 3410, 0, 2750, 1500, 'physical', 16000, [
      { name: '牙の連撃', type: 'physical_multi', mult: 1.2, hits: 2 },
      { name: '血の匂い', type: 'physical', mult: 2.25 },
      { name: '遠吠え',   type: 'buff', effect: 'atkSpdUp', atkRate: 1.3, spdRate: 1.3, turns: 3 },
    ], { mods: { lifesteal: 0.15 } }),
    floorBoss: E('ブラッドダイアウルフ', 121000, 5850, 4840, 0, 3960, 2900, 'physical', 50000, [
      { name: '血牙の連撃', type: 'physical_multi', mult: 1.275, hits: 3 },
      { name: '咬み裂き',   type: 'physical', mult: 2.7, bleedRate: 1.0 },
      { name: '威圧の唸り', type: 'debuff', effect: 'atkMatkDown', rate: 0.85, turns: 3 },
      { name: '血の遠吠え', type: 'buff', effect: 'atkSpdUp', atkRate: 1.5, spdRate: 1.4, turns: 3 },
    ], {
      mods: { lifesteal: 0.3, onHitAilment: [{ key: 'bleed', chance: 0.5 }] },
      escorts: [{ enemyIndex: 0, count: 1 }],
      specialMove: { name: '紅蓮の顎', type: 'physical', mult: 3.75, bleedStacks: 3 },
    }),
  },
  // ── 戦闘エリア3 毒沼 ──
  {
    floor: 3, boss: 'ポイズントードキング',
    enemies: [
      E('毒沼のトード', 44000, 0, 1980, 3400, 2750, 3000, 'magical', 1600, [
        { name: '毒液',       type: 'magical', mult: 2.1 },
        { name: '瘴気の吐息', type: 'magical', mult: 1.8, poisonRate: 0.3 },
      ]),
      E('沼地のヒル', 57200, 3000, 3300, 0, 2530, 1000, 'physical', 1800, [
        { name: '吸着',     type: 'physical', mult: 2.25, effect: 'spdDown', rate: 0.8, turns: 3 },
        { name: '腐食の牙', type: 'physical', mult: 1.8, poisonRate: 0.3 },
      ]),
      E('猛毒スライム', 50600, 4800, 2200, 0, 2420, 1800, 'physical', 2000, [
        { name: '毒撃', type: 'physical',       mult: 2.4, poisonRate: 0.5 },
        { name: '溶解', type: 'physical_multi', mult: 1.05, hits: 2 },
      ]),
    ],
    midBoss: E('ポイズントードガード', 90200, 3640, 3850, 2080, 3190, 1600, 'physical', 28000, [
      { name: '毒棘',     type: 'physical', mult: 2.55 },
      { name: '毒霧',     type: 'magical',  mult: 2.25, poisonRate: 0.5 },
      { name: '沼の構え', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { poisonField: 0.015, playerHealMult: 0.75 } }),
    floorBoss: E('ポイズントードキング', 157300, 3900, 5500, 2340, 5060, 2950, 'physical', 90000, [
      { name: '毒液噴射', type: 'magical',        mult: 2.55, poisonRate: 1.0 },
      { name: '粘着の舌', type: 'physical',       mult: 2.25, effect: 'spdDown', rate: 0.7, turns: 3 },
      { name: '沼の顎',   type: 'physical_multi', mult: 1.05, hits: 2 },
      { name: '沼の鼓動', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      mods: { poisonField: 0.04, playerHealMult: 0.5 },
      empower: { hpBelow: 0.7, allStatMult: 1.3, once: true, undispellable: true },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '毒沼葬', type: 'magical', mult: 3.75, poisonStacks: 3 },
      // エリアボスのHP143,000のうち18,000は両刀ぶんの上乗せ（判定総合力には数えない）
    }),
  },
  // ── 戦闘エリア4 硬化 ──
  {
    floor: 4, boss: 'エンペラースカラベ',
    enemies: [
      E('甲殻スカラベ', 63800, 3600, 4400, 0, 3080, 1200, 'physical', 2800, [
        { name: '角突き',   type: 'physical', mult: 2.25 },
        { name: '甲殻打ち', type: 'physical', mult: 1.8, effect: 'defDown', rate: 0.85, turns: 3 },
      ]),
      E('砂喰い蟲', 57200, 6400, 2860, 0, 2860, 2000, 'physical', 3200, [
        { name: '砂噛み', type: 'physical',       mult: 2.4 },
        { name: '連牙',   type: 'physical_multi', mult: 1.05, hits: 2 },
      ]),
      E('腐食蟲', 52800, 0, 2640, 4400, 4180, 2400, 'magical', 3600, [
        { name: '腐食液', type: 'magical', mult: 2.25 },
        { name: '酸の霧', type: 'magical', mult: 1.8, effect: 'mdefDown', rate: 0.85, turns: 3 },
      ]),
    ],
    midBoss: E('ロイヤルスカラベ', 126500, 4550, 4840, 2600, 4070, 1900, 'physical', 48000, [
      { name: '王甲の一撃', type: 'physical', mult: 2.55 },
      { name: '砂塵',       type: 'magical',  mult: 2.25 },
      { name: '甲殻硬化',   type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { defRamp: 1.12 } }),
    floorBoss: E('エンペラースカラベ', 192500, 5720, 6820, 2990, 6160, 3100, 'physical', 160000, [
      { name: '皇甲の顎', type: 'physical',       mult: 2.55 },
      { name: '砂嵐',     type: 'magical',        mult: 2.25 },
      { name: '黄金の顎', type: 'physical_multi', mult: 1.05, hits: 2 },
      { name: '皇の構え', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      mods: { defRamp: 1.20 },
      summonLoop: { everyTurns: 2, enemyIndex: 0, hpRate: 0.25, maxAlive: 3 },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '黄金崩し', type: 'physical', mult: 3.75, defDownRate: 0.8, turns: 3 },
    }),
  },
  // ── 戦闘エリア5 暴風 ──
  {
    floor: 5, boss: 'ストームグリフォン',
    enemies: [
      E('疾風のハーピー', 67700, 6767, 3385, 0, 3868, 4945, 'physical', 5000, [
        { name: '烈風爪', type: 'physical',       mult: 2.25 },
        { name: '旋風撃', type: 'physical_multi', mult: 1.05, hits: 2 },
      ]),
      E('雷雲イーグル', 64800, 7010, 4967, 0, 4742, 2741, 'physical', 5600, [
        { name: '急降下', type: 'physical', mult: 2.55 },
        { name: '雷嘴',   type: 'physical', mult: 1.95, paralysisRate: 0.3 },
      ]),
      E('暴風の精霊', 63400, 0, 3964, 7010, 5609, 2989, 'magical', 6200, [
        { name: '暴風弾', type: 'magical', mult: 2.25 },
        { name: '乱気流', type: 'magical', mult: 1.8, effect: 'spdDown', rate: 0.8, turns: 3 },
      ]),
    ],
    midBoss: E('ゲイルグリフォン', 143600, 7008, 5563, 3737, 4784, 4855, 'physical', 80000, [
      { name: '疾風の爪', type: 'physical', mult: 2.55 },
      { name: '風刃',     type: 'magical',  mult: 2.25 },
      { name: '風の加護', type: 'buff', effect: 'atkSpdUp', atkRate: 1.2, spdRate: 1.4, turns: 3 },
    ]),
    floorBoss: E('ストームグリフォン', 220700, 9346, 7130, 5387, 6450, 7202, 'physical', 280000, [
      { name: '暴風の爪', type: 'physical',       mult: 2.4 },
      { name: '雷嵐',     type: 'magical',        mult: 2.1, paralysisRate: 0.3 },
      { name: '烈風連撃', type: 'physical_multi', mult: 0.9, hits: 2 },
      { name: '嵐の加護', type: 'buff', effect: 'atkSpdUp', atkRate: 1.4, spdRate: 1.4, turns: 3 },
    ], {
      mods: { doubleActRate: 0.30 },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '天嵐爆砕', type: 'physical', mult: 3.75, effect: 'spdDown', rate: 0.7, turns: 3 },
    }),
  },
  // ── 戦闘エリア6 適応 ──
  {
    floor: 6, boss: 'ファントムデュラハン',
    enemies: [
      E('亡霊騎士', 83500, 17808, 5721, 0, 5452, 4654, 'physical', 8000, [
        { name: '亡霊剣',   type: 'physical',       mult: 2.4 },
        { name: '怨嗟の斬', type: 'physical_multi', mult: 1.05, hits: 2, curseRate: 0.2 },
      ]),
      E('首なし従者', 106300, 14524, 7677, 0, 5610, 3758, 'physical', 9000, [
        { name: '鎧砕き',     type: 'physical', mult: 2.25, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
        { name: '虚ろな一撃', type: 'physical', mult: 1.8, stunRate: 0.2 },
      ]),
      E('呪詛の霊灯', 83400, 0, 4886, 15800, 8048, 4964, 'magical', 10000, [
        { name: '呪詛の火', type: 'magical', mult: 2.25, curseRate: 0.4 },
        { name: '鬼火',     type: 'magical', mult: 1.8, burnRate: 0.3 },
      ], { mods: { curseRate: 0.15 } }),
    ],
    midBoss: E('シェイドデュラハン', 217300, 14164, 8401, 7627, 7242, 6452, 'physical', 130000, [
      { name: '首狩りの一閃', type: 'physical', mult: 2.55, extraActionRate: 0.15 },
      { name: '冥火',         type: 'magical',  mult: 2.25, burnRate: 0.5 },
      { name: '亡者の構え',   type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { adapt: true, curseRate: 0.2 } }),
    floorBoss: E('ファントムデュラハン', 325800, 23744, 10317, 13532, 9367, 4443, 'physical', 460000, [
      { name: '断頭の一閃', type: 'physical',       mult: 2.55, stunRate: 0.2 },
      { name: '冥界の炎',   type: 'magical',        mult: 2.25, burnRate: 1.0 },
      { name: '怨霊乱舞',   type: 'physical_multi', mult: 1.05, hits: 2, effect: 'mdefDown', rate: 0.9, turns: 3, stack: 3 },
      { name: '亡者の加護', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      // 適応: 直前に使ったのと同じスキルを続けて撃つと2発目が無効化される（無効化したら解ける）
      mods: { adapt: true, curseRate: 0.60, curseTurns: 3 },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '首無しの断罪', type: 'physical', mult: 3.75, healSealTurns: 4 },
    }),
  },
  // ── 戦闘エリア7 屈折 ──
  {
    floor: 7, boss: 'プリズムドラゴン',
    enemies: [
      E('光晶ドレイク', 89500, 0, 5774, 22426, 8950, 4986, 'magical', 13000, [
        { name: '光晶ブレス', type: 'magical', mult: 2.4 },
        { name: '乱反射',     type: 'magical', mult: 1.95, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
      E('稜光のワイバーン', 91900, 22981, 6717, 0, 6299, 5819, 'physical', 14500, [
        { name: '稜光爪',   type: 'physical',       mult: 2.4 },
        { name: '閃光旋回', type: 'physical_multi', mult: 1.05, hits: 2, effect: 'spdDown', rate: 0.85, turns: 3, chance: 0.2 },
      ]),
      E('虹鱗のリザードマン', 114600, 20376, 8748, 0, 6636, 3976, 'physical', 16000, [
        { name: '虹鱗の一撃', type: 'physical', mult: 2.25 },
        { name: '鱗返し',     type: 'physical', mult: 1.8, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
    ],
    midBoss: E('クリスタルドラゴン', 253600, 18771, 9582, 10356, 8403, 7103, 'physical', 220000, [
      { name: '晶牙',     type: 'physical', mult: 2.55 },
      { name: '屈折光線', type: 'magical',  mult: 2.25, paralysisRate: 0.3 },
      { name: '結晶硬化', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { reflect: 0.30, reflectCap: 0.06 } }),
    floorBoss: E('プリズムドラゴン', 378300, 30641, 11349, 18900, 10305, 5099, 'physical', 760000, [
      { name: '虹閃牙',     type: 'physical',       mult: 2.55, paralysisRate: 0.2 },
      { name: '七彩の吐息', type: 'magical',        mult: 2.4, effect: 'mdefDown', rate: 0.9, turns: 3, stack: 3 },
      { name: '稜光乱舞',   type: 'physical_multi', mult: 1.05, hits: 2, effect: 'spdDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '光輪の加護', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      // 屈折: 与ダメージの20%を反射。1発あたりの上限はプレイヤー最大HPの2%
      mods: { reflect: 0.60, reflectCap: 0.06 },
      summonMid: { hpBelow: 0.5, statRate: 0.5, count: 1, once: true },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: 'プリズムノヴァ', type: 'magical', mult: 3.75, effect: 'allStatDown', rate: 0.85, turns: 3 },
    }),
  },
  // ── 戦闘エリア8 噴火＋やけど連動 ──
  {
    floor: 8, boss: 'ヴォルケーノサイクロプス',
    enemies: [
      E('溶岩の単眼鬼', 94900, 25215, 11594, 0, 11107, 4760, 'physical', 22000, [
        { name: '溶岩拳',   type: 'physical',       mult: 2.55, burnRate: 0.3 },
        { name: '熔解乱打', type: 'physical_multi', mult: 1.05, hits: 2, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.2 },
      ]),
      E('噴火の岩塊', 127400, 25215, 12140, 0, 9092, 3148, 'physical', 25000, [
        { name: '岩塊落とし', type: 'physical', mult: 2.25, stunRate: 0.2 },
        { name: '灼熱の飛礫', type: 'physical', mult: 1.8, burnRate: 0.3 },
      ]),
      E('火山の火霊', 98500, 0, 8527, 25215, 12356, 6094, 'magical', 28000, [
        { name: '火柱', type: 'magical', mult: 2.4, burnRate: 0.4 },
        { name: '熱波', type: 'magical', mult: 1.95, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
    ],
    midBoss: E('マグマサイクロプス', 293200, 25215, 11055, 14095, 9767, 7281, 'physical', 380000, [
      { name: '剛腕振り下ろし', type: 'physical', mult: 2.55 },
      { name: '溶岩弾',         type: 'magical',  mult: 2.25, burnRate: 0.5 },
      { name: '岩の守り',       type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { erupt: { everyTurns: 4, mult: 2.7, defPen: 0.3, burn: true }, critVsBurn: 15 } }),
    floorBoss: E('ヴォルケーノサイクロプス', 506100, 33620, 14315, 20830, 13014, 6179, 'physical', 1300000, [
      { name: '灼熱の豪腕', type: 'physical',       mult: 2.7, burnRate: 0.3 },
      { name: '火砕流',     type: 'magical',        mult: 2.4, effect: 'defDown', rate: 0.9, turns: 3, stack: 3 },
      { name: '巨腕乱打',   type: 'physical_multi', mult: 1.05, hits: 2, stunRate: 0.25 },
      { name: '火山の加護', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      // 噴火: 3ターンごとに必中・防御50%無視・やけど100%／やけど中の相手へのクリ率+30%
      mods: { erupt: { everyTurns: 3, mult: 3, defPen: 0.5, burn: true }, critVsBurn: 30 },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '大噴火', type: 'physical', mult: 3.75, burn: true, playerHealMult: 0.5, turns: 4 },
    }),
  },
  // ── 戦闘エリア9 三頭 ──
  {
    floor: 9, boss: 'アビスキマイラ',
    enemies: [
      E('深淵の獅子頭', 105400, 30738, 14761, 0, 14188, 5310, 'physical', 38000, [
        { name: '獅咬',     type: 'physical',       mult: 2.7, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
        { name: '裂爪乱舞', type: 'physical_multi', mult: 1.05, hits: 2, stunRate: 0.2 },
      ]),
      E('淵底の蛇尾', 111700, 0, 11235, 30738, 15391, 6848, 'magical', 43000, [
        { name: '蛇毒牙', type: 'magical', mult: 2.4, poisonRate: 0.4 },
        { name: '毒霧',   type: 'magical', mult: 1.95, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
      E('虚無の山羊', 148300, 0, 13253, 30738, 12967, 3889, 'magical', 48000, [
        { name: '魔眼の光', type: 'magical', mult: 2.25, paralysisRate: 0.2 },
        { name: '呪縛の瞳', type: 'magical', mult: 1.8, effect: 'spdDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
    ],
    midBoss: E('ダスクキマイラ', 338900, 30738, 14006, 18707, 12485, 7797, 'physical', 650000, [
      { name: '三獣爪',   type: 'physical', mult: 2.55 },
      { name: '混沌吐息', type: 'magical',  mult: 2.25, poisonRate: 0.4 },
      { name: '獣毛の守り', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      phases: [
        { above: 1.00, magTaken: 0.85 },
        { above: 0.67, physTaken: 0.85 },
        { above: 0.34, magTaken: 0.92, physTaken: 0.92 },
      ],
    }),
    floorBoss: E('アビスキマイラ', 616800, 40984, 16154, 27463, 14979, 7076, 'physical', 2300000, [
      { name: '獅咬爪',     type: 'physical',       mult: 2.7, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '蛇尾猛毒',   type: 'magical',        mult: 2.4, poisonRate: 0.6 },
      { name: '三獣乱撃',   type: 'physical_multi', mult: 1.05, hits: 2, stunRate: 0.25 },
      { name: '獣魂の鎧',   type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      // 三頭: 獅子(特殊-20%) → 蛇(物理-20%+毒+攻撃上昇+雑魚召喚) → 山羊(両方-8%+素早さ上昇)
      phases: [
        { above: 1.00, head: '獅子', magTaken: 0.80 },
        { above: 0.67, head: '蛇',   physTaken: 0.80, poisonField: 0.04, atkMult: 1.15,
          summonOnEnter: { enemyIndex: 1, count: 2 } },
        { above: 0.34, head: '山羊', magTaken: 0.92, physTaken: 0.92, poisonField: 0.04, spdMult: 1.3 },
      ],
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '三獣咆哮', type: 'magical', mult: 3.75, effect: 'allStatDown', rate: 0.85, turns: 3 },
    }),
  },
  // ── 戦闘エリア10 暴走＋地響き ──
  {
    floor: 10, boss: 'カオスベヒモス',
    enemies: [
      E('混沌の巨腕', 119500, 33223, 20433, 0, 19671, 6122, 'physical', 65000, [
        { name: '巨腕叩きつけ', type: 'physical',       mult: 2.7, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
        { name: '大地砕き',     type: 'physical_multi', mult: 1.05, hits: 2, stunRate: 0.25 },
      ]),
      E('混沌の牙獣', 114500, 33223, 18123, 0, 17656, 10511, 'physical', 73000, [
        { name: '疾牙',     type: 'physical', mult: 2.55 },
        { name: '追い立て', type: 'physical', mult: 1.95, effect: 'spdDown', rate: 0.85, turns: 3, chance: 0.4 },
      ]),
      E('混沌の瞳', 123800, 0, 16459, 33223, 21285, 7877, 'magical', 82000, [
        { name: '混沌視線',   type: 'magical', mult: 2.4, paralysisRate: 0.3 },
        { name: '虚空の脈動', type: 'magical', mult: 1.95, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
    ],
    midBoss: E('レイジベヒモス', 392400, 33223, 19413, 24176, 17684, 8948, 'physical', 1100000, [
      { name: '憤怒の一撃', type: 'physical', mult: 2.55 },
      { name: '咆哮衝波',   type: 'magical',  mult: 2.25, effect: 'atkMatkDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '猛り立ち',   type: 'buff', effect: 'atkUp', atkRate: 1.3, turns: 3 },
    ], {
      mods: { quake: { spdDown: 0.05, maxStacks: 6 } },
      phases: [{ above: 1.00 }, { above: 0.60, atkMult: 1.25 }, { above: 0.30, atkMult: 1.25 }],
    }),
    floorBoss: E('カオスベヒモス', 779900, 44297, 19798, 29695, 18299, 13090, 'physical', 4000000, [
      { name: '崩落の一撃', type: 'physical',       mult: 2.7, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '混沌の波動', type: 'magical',        mult: 2.4, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '地裂踏破',   type: 'physical_multi', mult: 1.05, hits: 2, stunRate: 0.3 },
      { name: '憤怒の唸り', type: 'buff', effect: 'atkUp', atkRate: 1.3, turns: 3 },
    ], {
      // 暴走: HPが減るほど攻撃上昇（累積1.3→1.6→2.0倍）／地響き: 命中ごとに素早さ-5%（最大-50%）
      mods: { quake: { spdDown: 0.05, maxStacks: 10 } },
      phases: [
        { above: 1.00 },
        { above: 0.75, atkMult: 1.30 },
        { above: 0.50, atkMult: 1.23, damageTaken: 0.80 },  // HP50%以下で被ダメ-20%（永続）
        { above: 0.25, atkMult: 1.25, damageTaken: 0.80 },
      ],
      selfHeal: { hpBelow: 0.3, healPct: 0.2, once: true },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '天地崩壊', type: 'physical', mult: 3.75, effect: 'spdDown', rate: 0.7, turns: 4 },
    }),
  },
]

export const MAX_IMPLEMENTED_FLOOR = TOWER_FLOORS.length

// いま挑戦できる最大の層（2026-08-04）。データは10層ぶんあるが、
// 5層以降はボスが想定より弱く調整中なので一時的に閉じている。
// ⚠SQL の tower_max_floor() と必ず同じ値にすること（権威はサーバー側）。
//   調整が終わったら両方を 10 に戻す。
export const OPEN_MAX_FLOOR = 4

// エンドレスタワーの解放条件（2026-08-04 一般公開）。
// ⚠ここを変えたら SQL の tower_can_enter() も必ず合わせること（権威はサーバー側）。
export const TOWER_UNLOCK_CHAR_LV = 1000
export const isTowerUnlocked = (profile) =>
  !!profile?.is_admin || (profile?.char_lv || 1) >= TOWER_UNLOCK_CHAR_LV
export const getFloor = (n) => TOWER_FLOORS.find(f => f.floor === n) || null

// エリアボス挑戦の連戦構成（1〜戦闘エリア10）。数字は enemies から引く体数
export const BOSS_RUN_STAGES = [
  { kind: 'mobs', count: 1, label: '1戦目' },
  { kind: 'mobs', count: 1, label: '2戦目' },
  { kind: 'mobs', count: 2, label: '3戦目' },
  { kind: 'mobs', count: 3, label: '4戦目' },
  { kind: 'mid',  count: 1, label: '強敵' },
  { kind: 'boss', count: 1, label: 'エリアボス' },
]

// 石碑に名前が載る層。最初の1つは10層（最初にここまで来た者だけ）で、
// それ以降は1層ごとに、その層を最初に踏破した者の名を刻む。
export const MONUMENT_FIRST_FLOOR = 10
export const isMonumentFloor = (floor) => floor >= MONUMENT_FIRST_FLOOR

// スキルの対象設定（複数敵がいるときの狙い方）はタワー専用ではなくなったので
// src/lib/loadout.js が正。ここは既存の import を壊さないための再エクスポート。
export { TARGET_MODES, DEFAULT_TARGET_MODE } from './loadout.js'

// 敵の総合力（開発用の確認）
export const enemyTotal = (e) =>
  Math.floor(e.hp / 10 + e.atk + e.def + e.matk + e.mdef + e.spd)

// ============================================================
// エンドポイント → 実効ボーナス
//  treeBonus() は各ノードの「%」を返す（1段=0.5%・上限50段=25%）
// ============================================================
export function towerTreeEffects(alloc) {
  const b = treeBonus(alloc)
  return {
    physDmgMult:  1 + b.phys_dmg / 100,
    magDmgMult:   1 + b.mag_dmg / 100,
    critRate:     b.crit_rate,             // %加算
    critDmg:      b.crit_dmg / 100,        // 倍率加算
    physPen:      b.phys_pen / 100,
    magPen:       b.mag_pen / 100,
    hpMult:       1 + b.max_hp / 100,
    takenMult:    1 - b.dmg_taken / 100,
    ailResist:    b.ail_resist / 100,      // 状態異常の発生率に (1-x) を掛ける
    pctResist:    b.pct_resist / 100,      // 割合ダメージに (1-x) を掛ける
    critResist:   b.crit_resist,           // %減算
    evasion:      b.evasion,               // %加算
    spdMult:      1 + b.spd / 100,
    mpCostMult:   1 - b.mp_cost / 100,
    killHeal:     b.kill_heal / 100,
    ailRate:      b.ail_rate / 100,        // 付与に失敗したときの再判定確率
    expPlus:      b.exp_plus / 100,        // 通常EXP+1の確率
  }
}

// ツリーを反映した実効ステータス（タワーの中だけの値）
export function applyTreeToStats(eff, tr) {
  return {
    ...eff,
    hp_max:       Math.floor(eff.hp_max * tr.hpMult),
    spd:          Math.floor(eff.spd * tr.spdMult),
    critBonus:    (eff.critBonus || 0) + tr.critRate,
    critDmg:      (eff.critDmg || 0) + tr.critDmg,
    critResist:   (eff.critResist || 0) + tr.critResist,
    evasionBonus: (eff.evasionBonus || 0) + tr.evasion,
    defPen:       Math.min(PEN_CAP, (eff.defPen || 0) + tr.physPen),
    mdefPen:      Math.min(PEN_CAP, (eff.mdefPen || 0) + tr.magPen),
  }
}

// ============================================================
// 敵インスタンスの生成
// ============================================================
let uidSeq = 0
export function makeEnemy(def, opts = {}) {
  const statRate = opts.statRate || 1
  const hpRate = opts.hpRate || 1
  // つまみは全部1.0（強さは敵データの数値で表す）。掛け算だけ残してあるのは
  // 「ここに戻せば全体を動かせる」と勘違いさせないため、テストで1.0を強制している。
  const atkPower = (opts.isBoss ? ENEMY_ATK_POWER : MOB_ATK_POWER)
  const floor = opts.floor ?? 1
  return {
    uid: ++uidSeq,
    name: opts.name || def.name,
    hp: Math.max(1, Math.floor(def.hp * hpRate * (opts.scaleHpByStat ? statRate : 1))),
    maxHp: Math.max(1, Math.floor(def.hp * hpRate * (opts.scaleHpByStat ? statRate : 1))),
    atk: Math.floor((def.atk || 0) * statRate * atkPower),
    def: Math.floor((def.def || 0) * statRate),
    matk: Math.floor((def.matk || 0) * statRate * atkPower),
    mdef: Math.floor((def.mdef || 0) * statRate),
    spd: Math.max(1, Math.floor((def.spd || 1) * statRate)),
    type: def.type || 'physical',
    // この敵が受けるダメージの倍率。強敵・エリアボスと雑魚で別で、層が上がるほど絞る。
    // opts.floor が無いとき（開発用のテスト対戦など）は1層扱い＝一番緩い値になる。
    dmgTaken: floorDmgTakenOf(opts.floor ?? 1, !!opts.isBoss),
    gold: Math.floor((def.gold || 0) * (opts.goldRate ?? 1)),
    skills: def.skills || [],
    mods: def.mods || {},
    phases: def.phases || null,
    summonDef: def.summon || null,
    summonLoop: def.summonLoop || null,
    summonMid: def.summonMid || null,
    empower: def.empower || null,
    cleanse: def.cleanse || null,
    selfHeal: def.selfHeal || null,
    specialMove: def.specialMove || null,
    isBoss: !!opts.isBoss,
    isSummoned: !!opts.isSummoned,
    // 何層の敵か。被ダメージ倍率がこれで決まるので、戦闘中に呼ばれる召喚へも引き継ぐ
    floor,
    // ── 実行時の状態 ──
    buffs: {},
    perm: { atk: 1, matk: 1, def: 1, mdef: 1, spd: 1 },
    skillIdx: 0,
    turnCount: 0,
    phaseIdx: -1,
    defRamp: 1,
    lastPlayerSkill: null,   // 適応（戦闘エリア6）用
    used: {},                // once系トリガーの発火済みフラグ
  }
}

// 連戦の各ステージに出てくる敵を組み立てる
export function buildStageEnemies(floorData, stageIdx) {
  const stage = BOSS_RUN_STAGES[stageIdx]
  if (!stage || !floorData) return []
  const fl = floorData.floor
  if (stage.kind === 'mid') return [makeEnemy(floorData.midBoss, { isBoss: true, floor: fl })]
  if (stage.kind === 'boss') {
    const list = [makeEnemy(floorData.floorBoss, { isBoss: true, floor: fl })]
    for (const es of (floorData.floorBoss.escorts || [])) {
      for (let i = 0; i < (es.count || 1); i++) list.push(makeEnemy(floorData.enemies[es.enemyIndex], { floor: fl }))
    }
    return list
  }
  // 雑魚戦：同じ種類が重なることもある
  const list = []
  for (let i = 0; i < (stage.count || 1); i++) {
    const def = floorData.enemies[Math.floor(Math.random() * floorData.enemies.length)]
    list.push(makeEnemy(def, { floor: fl }))
  }
  return list
}

// 出撃（雑魚1体・しきい値到達後は5%で強敵）
export function buildSortieEnemies(floorData, midChance) {
  const fl = floorData.floor
  if (midChance > 0 && Math.random() < midChance) {
    return { enemies: [makeEnemy(floorData.midBoss, { isBoss: true, floor: fl })], isMid: true }
  }
  const def = floorData.enemies[Math.floor(Math.random() * floorData.enemies.length)]
  return { enemies: [makeEnemy(def, { floor: fl })], isMid: false }
}
