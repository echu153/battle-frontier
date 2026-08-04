import { PEN_CAP } from './stats.js'
// ============================================================
// 星霜百層塔（せいそうひゃくそうとう）データ定義
// ------------------------------------------------------------
// ・解放条件: キャラLV1000（現状は is_admin 限定の開発先行）
// ・1層の流れ:
//     ① 塔出撃を (30 + 層数×10) 回こなす → 中ボスが5%で出現するようになる
//     ② 中ボスを撃破 → その層の層主に挑戦できる（以降いつでも何度でも）
//     ③ 層主挑戦 = 雑魚1体 → 雑魚1体 → 雑魚2体 → 雑魚3体 → 中ボス → 層主 の6連戦
//        この連戦中はHP/MPが一切回復しない（持ち越し）
// ・入場時のHP/MPは満タン固定の「塔専用プール」。街の hp_current/mp_current とは切り離す
// ・アイテムは街と同じように普通に使える（無限ポーション含む）
// ・内部推奨力 = 2万 × 1.2^(層-1)。開発上の目安であり、プレイヤーには表示しない
//
// 詳細な設計根拠は docs/tower-design.md を参照。
// ============================================================

// 内部推奨力（開発用の目安。UIには出さない）
export const towerTarget = (floor) => Math.round(20000 * Math.pow(1.2, floor - 1))

// 層主に挑戦できるようになるまでに必要な塔出撃の回数
export const sortiesToMidBoss = (floor) => 30 + floor * 10

// 中ボスの出現率（しきい値到達後の塔出撃ごと・天井なし）
export const MID_BOSS_RATE = 0.05

// 塔出撃1回で得られるGold（2026-08-03確定）。
// 敵データの gold は調整用シミュレータの仮値で、街の出撃の何十倍もあり
// 経済を壊すため、出撃では使わずこの式で固定する。中ボスに当たっても同額。
export const towerSortieGold = (floor) => floor * 300

// 層主を撃破したときのGold（2026-08-03確定）。
// 初回だけ層数×100万、2回目以降は出撃と同じ層数×300（周回で稼げないようにする）。
// ※実際に付与する額はサーバーが決める。ここは表示・テスト用の同じ式。
export const towerBossGold = (floor, isFirstClear) => isFirstClear ? floor * 1000000 : towerSortieGold(floor)

// 層主挑戦（6連戦）の間に無限ポーションで回復できる回数の上限（道中を含む・2026-08-03確定）
// ※5回では無限ポーションの5ターンCDに阻まれてほぼ届かず素通りだったため2回にした
export const RUN_POTION_LIMIT = 2

// 塔出撃1回で得られる塔EXP（層によらず20〜30のランダム・2026-08-03確定）
// 層主撃破は初回だけ1000、2回目以降は出撃と同じ
// ※実際に付与する値はサーバーが決める。ここは表示・テスト用の同じ定義。
export const TOWER_EXP_MIN = 20
export const TOWER_EXP_MAX = 30
export const BOSS_FIRST_TOWER_EXP = 1000

// 塔LV lv → lv+1 に必要な塔EXP
export const towerExpToNext = (lv) => 5 * lv * lv

// 累計の塔EXPから塔LVと余剰EXPを求める
export const towerLevelFromExp = (totalExp) => {
  let lv = 1, rest = totalExp || 0
  while (rest >= towerExpToNext(lv) && lv < 9999) { rest -= towerExpToNext(lv); lv++ }
  return { lv, rest, next: towerExpToNext(lv) }
}

// ============================================================
// 塔スキルツリー（全17ノード・効果は塔の中だけで有効）
//  ・1段 = 0.5%（会心威力+/最大HP+/会心耐性+ だけ1段=1%）／1ノードの上限 = 50段
//  ・10段ごとに解放に必要な塔LVがある
// ============================================================
// 1段あたりの効果（%）。既定は0.5%だが、ノードごとに step で上書きできる
export const TREE_STEP_PCT = 0.5
export const TREE_MAX_STEPS = 50
// そのノードの1段あたりの%（TREE_NODES の step 指定が優先）
export const stepPctOf = (key) => TREE_NODES.find(n => n.key === key)?.step ?? TREE_STEP_PCT

// 段数の解放しきい値（この段数を超えて振るには、対応する塔LVが必要）
export const TREE_UNLOCK = [
  { upTo: 10, lv: 1 },
  { upTo: 20, lv: 50 },
  { upTo: 30, lv: 100 },
  { upTo: 40, lv: 150 },
  { upTo: 50, lv: 200 },
]

// 塔LV lv のときに1ノードへ振れる最大段数
export const maxStepsAt = (lv) => {
  let max = 0
  for (const t of TREE_UNLOCK) if (lv >= t.lv) max = t.upTo
  return max
}
// 次の解放段数と必要な塔LV（すべて解放済みなら null）
export const nextUnlock = (lv) => TREE_UNLOCK.find(t => lv < t.lv) || null

export const TREE_NODES = [
  // ── 攻 ──
  { key: 'phys_dmg',   line: 'atk', name: '物理ダメージ+',       desc: '物理攻撃の与ダメージが上がる' },
  { key: 'mag_dmg',    line: 'atk', name: '特殊ダメージ+',       desc: '特殊攻撃の与ダメージが上がる' },
  { key: 'crit_rate',  line: 'atk', name: '会心率+',             desc: 'クリティカルの発生率が上がる' },
  { key: 'crit_dmg',   line: 'atk', name: '会心威力+',           desc: 'クリティカルの威力が上がる', step: 1.0 },
  { key: 'phys_pen',   line: 'atk', name: '物理貫通+',           desc: '相手の防御を無視する。4層の硬化に効く' },
  { key: 'mag_pen',    line: 'atk', name: '特殊貫通+',           desc: '相手の特殊防御を無視する。4層の硬化に効く' },
  // ── 守 ──
  { key: 'max_hp',     line: 'def', name: '最大HP+',             desc: '最大HPが上がる。6連戦を持ち越すので効果が大きい', step: 1.0 },
  { key: 'dmg_taken',  line: 'def', name: '被ダメージ-',         desc: '受けるダメージが減る' },
  { key: 'ail_resist', line: 'def', name: '状態異常耐性+',       desc: '3層の毒・6層の呪い・8層のやけど・10層のスタンに効く' },
  { key: 'pct_resist', line: 'def', name: '割合ダメージ耐性+',   desc: '最大HPの割合で削る効果を軽減。3層の毒沼・9層の毒に効く' },
  { key: 'crit_resist',line: 'def', name: '会心耐性+',           desc: '相手のクリティカル率を下げる。8層のやけど連動に効く', step: 1.0 },
  { key: 'evasion',    line: 'def', name: '回避率+',             desc: '相手の攻撃を回避しやすくなる' },
  // ── その他 ──
  { key: 'spd',        line: 'etc', name: '素早さ+',             desc: '行動順・会心率・回避に乗る。5層の暴風・10層の地響きに効く' },
  { key: 'mp_cost',    line: 'etc', name: 'MP消費-',             desc: 'スキルの消費MPが減る。連戦のMP枯渇対策' },
  { key: 'kill_heal',  line: 'etc', name: '雑魚撃破ごとにHP回復', desc: '雑魚を倒すたびに最大HPの一定割合を回復する' },
  { key: 'ail_rate',   line: 'etc', name: '状態異常の付与率+',   desc: 'こちらが与える状態異常の成功率が上がる' },
  { key: 'exp_plus',   line: 'etc', name: '取得経験値+1の確率',  desc: '塔の中で得た通常EXPが+1される確率。塔EXPには乗らない' },
]

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

// 振り直しにかかるGold（塔LVに比例）
export const treeResetCost = (lv) => 10000 * Math.max(1, lv)

// ============================================================
// 敵データ（1〜10層）
//  ・総合力 = floor(hp/10 + atk + def + matk + mdef + spd)（敵はMP=0）
//  ・skills: type は physical / magical / physical_multi / buff / debuff
//  ・mods / phases が層主のギミック本体
// ============================================================
const E = (name, hp, atk, def, matk, mdef, spd, type, gold, skills, extra = {}) =>
  ({ name, hp, atk, def, matk, mdef, spd, type, gold, skills, ...extra })

export const TOWER_FLOORS = [
  // ── 1層 装甲 ──
  {
    floor: 1, boss: 'アーマードミノタウロス',
    enemies: [
      E('鉄角の仔牛', 28000, 1200, 2200, 0, 1300, 1500, 'physical', 450, [
        { name: '突進',     type: 'physical', mult: 1.4 },
        { name: '角ぶつけ', type: 'physical', mult: 1.2, stunRate: 0.1 },
      ]),
      E('牛頭の斧兵', 30000, 1700, 2500, 0, 1300, 500, 'physical', 500, [
        { name: '兜割り',       type: 'physical',       mult: 1.6 },
        { name: '斧の乱れ打ち', type: 'physical_multi', mult: 0.7, hits: 2 },
      ]),
      E('迷宮の鉄像', 28000, 0, 3000, 1100, 1900, 400, 'magical', 550, [
        { name: '石光の呪波', type: 'magical', mult: 1.4 },
        { name: '硬化',       type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
      ]),
    ],
    midBoss: E('エリートミノタウロス', 50000, 2300, 3000, 0, 2400, 1300, 'physical', 8000, [
      { name: '大斧の一撃', type: 'physical',       mult: 1.7 },
      { name: '威嚇の咆哮', type: 'debuff', effect: 'atkDown', rate: 0.8, turns: 3 },
      { name: '突進踏み',   type: 'physical_multi', mult: 0.8, hits: 2 },
    ], { mods: { physTakenMult: 0.9 } }),
    floorBoss: E('アーマードミノタウロス', 70000, 3300, 4200, 0, 3400, 2200, 'physical', 25000, [
      { name: '装甲突進',   type: 'physical',       mult: 1.8 },
      { name: '鉄角の乱打', type: 'physical_multi', mult: 0.8, hits: 3 },
      { name: '戦鬼の構え', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
      { name: '大地割り',   type: 'physical', mult: 1.6, defDownRate: 0.85, turns: 2 },
    ], {
      mods: { physTakenMult: 0.8 },
      summon: { hpBelow: 0.5, enemyIndex: 1, count: 2, once: true },
      specialMove: { name: '圧砕の鉄槌', type: 'physical', mult: 2.5, defDownRate: 0.8, turns: 3 },
    }),
  },
  // ── 2層 吸血 ──
  {
    floor: 2, boss: 'ブラッドダイアウルフ',
    enemies: [
      E('血狼', 45000, 1000, 1300, 0, 1800, 2200, 'physical', 900, [
        { name: '噛みつき', type: 'physical', mult: 1.4 },
        { name: '喉笛狙い', type: 'physical', mult: 1.2, bleedRate: 0.3 },
      ]),
      E('荒野のガルム', 46000, 1900, 1600, 0, 1900, 800, 'physical', 1000, [
        { name: '裂爪', type: 'physical',       mult: 1.6 },
        { name: '双牙', type: 'physical_multi', mult: 0.7, hits: 2 },
      ]),
      E('吸血コウモリ', 40000, 0, 1400, 1250, 3000, 1400, 'magical', 1100, [
        { name: '吸血の羽音', type: 'magical', mult: 1.4 },
        { name: '超音波',     type: 'debuff', effect: 'spdDown', rate: 0.8, turns: 3 },
      ], { mods: { lifesteal: 0.2 } }),
    ],
    midBoss: E('ハウリングダイアウルフ', 75000, 2500, 3100, 0, 2500, 1500, 'physical', 16000, [
      { name: '牙の連撃', type: 'physical_multi', mult: 0.8, hits: 2 },
      { name: '血の匂い', type: 'physical', mult: 1.5 },
      { name: '遠吠え',   type: 'buff', effect: 'atkSpdUp', atkRate: 1.3, spdRate: 1.3, turns: 3 },
    ], { mods: { lifesteal: 0.15 } }),
    floorBoss: E('ブラッドダイアウルフ', 110000, 4500, 4400, 0, 3600, 2900, 'physical', 50000, [
      { name: '血牙の連撃', type: 'physical_multi', mult: 0.85, hits: 3 },
      { name: '咬み裂き',   type: 'physical', mult: 1.8, bleedRate: 1.0 },
      { name: '威圧の唸り', type: 'debuff', effect: 'atkMatkDown', rate: 0.85, turns: 3 },
      { name: '血の遠吠え', type: 'buff', effect: 'atkSpdUp', atkRate: 1.5, spdRate: 1.4, turns: 3 },
    ], {
      mods: { lifesteal: 0.3, onHitAilment: [{ key: 'bleed', chance: 0.5 }] },
      escorts: [{ enemyIndex: 0, count: 1 }],
      specialMove: { name: '紅蓮の顎', type: 'physical', mult: 2.5, bleedStacks: 3 },
    }),
  },
  // ── 3層 毒沼 ──
  {
    floor: 3, boss: 'ポイズントードキング',
    enemies: [
      E('毒沼のトード', 40000, 0, 1800, 1700, 2500, 3000, 'magical', 1600, [
        { name: '毒液',       type: 'magical', mult: 1.4 },
        { name: '瘴気の吐息', type: 'magical', mult: 1.2, poisonRate: 0.3 },
      ]),
      E('沼地のヒル', 52000, 1500, 3000, 0, 2300, 1000, 'physical', 1800, [
        { name: '吸着',     type: 'physical', mult: 1.5, effect: 'spdDown', rate: 0.8, turns: 3 },
        { name: '腐食の牙', type: 'physical', mult: 1.2, poisonRate: 0.3 },
      ]),
      E('猛毒スライム', 46000, 2400, 2000, 0, 2200, 1800, 'physical', 2000, [
        { name: '毒撃', type: 'physical',       mult: 1.6, poisonRate: 0.5 },
        { name: '溶解', type: 'physical_multi', mult: 0.7, hits: 2 },
      ]),
    ],
    midBoss: E('ポイズントードガード', 82000, 2800, 3500, 1600, 2900, 1600, 'physical', 28000, [
      { name: '毒棘',     type: 'physical', mult: 1.7 },
      { name: '毒霧',     type: 'magical',  mult: 1.5, poisonRate: 0.5 },
      { name: '沼の構え', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { poisonField: 0.015, playerHealMult: 0.75 } }),
    floorBoss: E('ポイズントードキング', 143000, 3000, 5000, 1800, 4600, 2950, 'physical', 90000, [
      { name: '毒液噴射', type: 'magical',        mult: 1.7, poisonRate: 1.0 },
      { name: '粘着の舌', type: 'physical',       mult: 1.5, effect: 'spdDown', rate: 0.7, turns: 3 },
      { name: '沼の顎',   type: 'physical_multi', mult: 0.7, hits: 2 },
      { name: '沼の鼓動', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      mods: { poisonField: 0.04, playerHealMult: 0.5 },
      empower: { hpBelow: 0.7, allStatMult: 1.3, once: true, undispellable: true },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '毒沼葬', type: 'magical', mult: 2.5, poisonStacks: 3 },
      // 層主のHP143,000のうち18,000は両刀ぶんの上乗せ（判定総合力には数えない）
    }),
  },
  // ── 4層 硬化 ──
  {
    floor: 4, boss: 'エンペラースカラベ',
    enemies: [
      E('甲殻スカラベ', 58000, 1800, 4000, 0, 2800, 1200, 'physical', 2800, [
        { name: '角突き',   type: 'physical', mult: 1.5 },
        { name: '甲殻打ち', type: 'physical', mult: 1.2, effect: 'defDown', rate: 0.85, turns: 3 },
      ]),
      E('砂喰い蟲', 52000, 3200, 2600, 0, 2600, 2000, 'physical', 3200, [
        { name: '砂噛み', type: 'physical',       mult: 1.6 },
        { name: '連牙',   type: 'physical_multi', mult: 0.7, hits: 2 },
      ]),
      E('腐食蟲', 48000, 0, 2400, 2200, 3800, 2400, 'magical', 3600, [
        { name: '腐食液', type: 'magical', mult: 1.5 },
        { name: '酸の霧', type: 'magical', mult: 1.2, effect: 'mdefDown', rate: 0.85, turns: 3 },
      ]),
    ],
    midBoss: E('ロイヤルスカラベ', 115000, 3500, 4400, 2000, 3700, 1900, 'physical', 48000, [
      { name: '王甲の一撃', type: 'physical', mult: 1.7 },
      { name: '砂塵',       type: 'magical',  mult: 1.5 },
      { name: '甲殻硬化',   type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { defRamp: 1.12 } }),
    floorBoss: E('エンペラースカラベ', 175000, 4400, 6200, 2300, 5600, 3100, 'physical', 160000, [
      { name: '皇甲の顎', type: 'physical',       mult: 1.7 },
      { name: '砂嵐',     type: 'magical',        mult: 1.5 },
      { name: '黄金の顎', type: 'physical_multi', mult: 0.7, hits: 2 },
      { name: '皇の構え', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      mods: { defRamp: 1.20 },
      summonLoop: { everyTurns: 2, enemyIndex: 0, hpRate: 0.25, maxAlive: 3 },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '黄金崩し', type: 'physical', mult: 2.5, defDownRate: 0.8, turns: 3 },
    }),
  },
  // ── 5層 暴風 ──
  {
    floor: 5, boss: 'ストームグリフォン',
    enemies: [
      E('疾風のハーピー', 56000, 2600, 2800, 0, 3200, 4500, 'physical', 5000, [
        { name: '烈風爪', type: 'physical',       mult: 1.5 },
        { name: '旋風撃', type: 'physical_multi', mult: 0.7, hits: 2 },
      ]),
      E('雷雲イーグル', 58000, 4000, 3200, 0, 3000, 2700, 'physical', 5600, [
        { name: '急降下', type: 'physical', mult: 1.7 },
        { name: '雷嘴',   type: 'physical', mult: 1.3, paralysisRate: 0.3 },
      ]),
      E('暴風の精霊', 54000, 0, 3000, 3100, 4400, 2800, 'magical', 6200, [
        { name: '暴風弾', type: 'magical', mult: 1.5 },
        { name: '乱気流', type: 'magical', mult: 1.2, effect: 'spdDown', rate: 0.8, turns: 3 },
      ]),
    ],
    midBoss: E('ゲイルグリフォン', 129000, 4500, 5000, 2400, 4300, 4800, 'physical', 80000, [
      { name: '疾風の爪', type: 'physical', mult: 1.7 },
      { name: '風刃',     type: 'magical',  mult: 1.5 },
      { name: '風の加護', type: 'buff', effect: 'atkSpdUp', atkRate: 1.2, spdRate: 1.4, turns: 3 },
    ]),
    floorBoss: E('ストームグリフォン', 195000, 5900, 6300, 3400, 5700, 7000, 'physical', 280000, [
      { name: '暴風の爪', type: 'physical',       mult: 1.6 },
      { name: '雷嵐',     type: 'magical',        mult: 1.4, paralysisRate: 0.3 },
      { name: '烈風連撃', type: 'physical_multi', mult: 0.6, hits: 2 },
      { name: '嵐の加護', type: 'buff', effect: 'atkSpdUp', atkRate: 1.4, spdRate: 1.4, turns: 3 },
    ], {
      mods: { doubleActRate: 0.30 },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '天嵐爆砕', type: 'physical', mult: 2.5, effect: 'spdDown', rate: 0.7, turns: 3 },
    }),
  },
  // ── 6層 適応 ──
  {
    floor: 6, boss: 'ファントムデュラハン',
    enemies: [
      E('亡霊騎士', 62000, 4800, 3900, 0, 3700, 3800, 'physical', 8000, [
        { name: '亡霊剣',   type: 'physical',       mult: 1.6 },
        { name: '怨嗟の斬', type: 'physical_multi', mult: 0.7, hits: 2, curseRate: 0.2 },
      ]),
      E('首なし従者', 72000, 3400, 5200, 0, 3800, 2800, 'physical', 9000, [
        { name: '鎧砕き',     type: 'physical', mult: 1.5, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
        { name: '虚ろな一撃', type: 'physical', mult: 1.2, stunRate: 0.2 },
      ]),
      E('呪詛の霊灯', 58000, 0, 3400, 3800, 5600, 3800, 'magical', 10000, [
        { name: '呪詛の火', type: 'magical', mult: 1.5, curseRate: 0.4 },
        { name: '鬼火',     type: 'magical', mult: 1.2, burnRate: 0.3 },
      ], { mods: { curseRate: 0.15 } }),
    ],
    midBoss: E('シェイドデュラハン', 150000, 5200, 5800, 2800, 5000, 4900, 'physical', 130000, [
      { name: '首狩りの一閃', type: 'physical', mult: 1.7, extraActionRate: 0.15 },
      { name: '冥火',         type: 'magical',  mult: 1.5, burnRate: 0.5 },
      { name: '亡者の構え',   type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { adapt: true, curseRate: 0.2 } }),
    floorBoss: E('ファントムデュラハン', 240000, 9300, 7600, 5300, 6900, 3600, 'physical', 460000, [
      { name: '断頭の一閃', type: 'physical',       mult: 1.7, stunRate: 0.2 },
      { name: '冥界の炎',   type: 'magical',        mult: 1.5, burnRate: 1.0 },
      { name: '怨霊乱舞',   type: 'physical_multi', mult: 0.7, hits: 2, effect: 'mdefDown', rate: 0.9, turns: 3, stack: 3 },
      { name: '亡者の加護', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      // 適応: 直前に使ったのと同じスキルを続けて撃つと2発目が無効化される（無効化したら解ける）
      mods: { adapt: true, curseRate: 0.60, curseTurns: 3 },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '首無しの断罪', type: 'physical', mult: 2.5, healSealTurns: 4 },
    }),
  },
  // ── 7層 屈折 ──
  {
    floor: 7, boss: 'プリズムドラゴン',
    enemies: [
      E('光晶ドレイク', 62000, 0, 4000, 4600, 6200, 3800, 'magical', 13000, [
        { name: '光晶ブレス', type: 'magical', mult: 1.6 },
        { name: '乱反射',     type: 'magical', mult: 1.3, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
      E('稜光のワイバーン', 66000, 5200, 4300, 0, 4000, 4600, 'physical', 14500, [
        { name: '稜光爪',   type: 'physical',       mult: 1.6 },
        { name: '閃光旋回', type: 'physical_multi', mult: 0.7, hits: 2, effect: 'spdDown', rate: 0.85, turns: 3, chance: 0.2 },
      ]),
      E('虹鱗のリザードマン', 76000, 4000, 5800, 0, 4400, 2900, 'physical', 16000, [
        { name: '虹鱗の一撃', type: 'physical', mult: 1.5 },
        { name: '鱗返し',     type: 'physical', mult: 1.2, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
    ],
    midBoss: E('クリスタルドラゴン', 172000, 5800, 6500, 3200, 5700, 5300, 'physical', 220000, [
      { name: '晶牙',     type: 'physical', mult: 1.7 },
      { name: '屈折光線', type: 'magical',  mult: 1.5, paralysisRate: 0.3 },
      { name: '結晶硬化', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { reflect: 0.10, reflectCap: 0.02 } }),
    floorBoss: E('プリズムドラゴン', 290000, 10700, 8700, 6600, 7900, 4300, 'physical', 760000, [
      { name: '虹閃牙',     type: 'physical',       mult: 1.7, paralysisRate: 0.2 },
      { name: '七彩の吐息', type: 'magical',        mult: 1.6, effect: 'mdefDown', rate: 0.9, turns: 3, stack: 3 },
      { name: '稜光乱舞',   type: 'physical_multi', mult: 0.7, hits: 2, effect: 'spdDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '光輪の加護', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      // 屈折: 与ダメージの20%を反射。1発あたりの上限はプレイヤー最大HPの2%
      mods: { reflect: 0.20, reflectCap: 0.02 },
      summonMid: { hpBelow: 0.5, statRate: 0.5, count: 1, once: true },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: 'プリズムノヴァ', type: 'magical', mult: 2.5, effect: 'allStatDown', rate: 0.85, turns: 3 },
    }),
  },
  // ── 8層 噴火＋やけど連動 ──
  {
    floor: 8, boss: 'ヴォルケーノサイクロプス',
    enemies: [
      E('溶岩の単眼鬼', 78000, 7600, 5200, 0, 4800, 4300, 'physical', 22000, [
        { name: '溶岩拳',   type: 'physical',       mult: 1.7, burnRate: 0.3 },
        { name: '熔解乱打', type: 'physical_multi', mult: 0.7, hits: 2, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.2 },
      ]),
      E('噴火の岩塊', 92000, 5400, 7400, 0, 5200, 2500, 'physical', 25000, [
        { name: '岩塊落とし', type: 'physical', mult: 1.5, stunRate: 0.2 },
        { name: '灼熱の飛礫', type: 'physical', mult: 1.2, burnRate: 0.3 },
      ]),
      E('火山の火霊', 72000, 0, 4600, 5600, 7400, 4900, 'magical', 28000, [
        { name: '火柱', type: 'magical', mult: 1.6, burnRate: 0.4 },
        { name: '熱波', type: 'magical', mult: 1.3, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
    ],
    midBoss: E('マグマサイクロプス', 205000, 7000, 7700, 3900, 6800, 5600, 'physical', 380000, [
      { name: '剛腕振り下ろし', type: 'physical', mult: 1.7 },
      { name: '溶岩弾',         type: 'magical',  mult: 1.5, burnRate: 0.5 },
      { name: '岩の守り',       type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], { mods: { erupt: { everyTurns: 4, mult: 1.8, defPen: 0.3, burn: true }, critVsBurn: 15 } }),
    floorBoss: E('ヴォルケーノサイクロプス', 350000, 9200, 9900, 5700, 9000, 4700, 'physical', 1300000, [
      { name: '灼熱の豪腕', type: 'physical',       mult: 1.8, burnRate: 0.3 },
      { name: '火砕流',     type: 'magical',        mult: 1.6, effect: 'defDown', rate: 0.9, turns: 3, stack: 3 },
      { name: '巨腕乱打',   type: 'physical_multi', mult: 0.7, hits: 2, stunRate: 0.25 },
      { name: '火山の加護', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      // 噴火: 3ターンごとに必中・防御50%無視・やけど100%／やけど中の相手へのクリ率+30%
      mods: { erupt: { everyTurns: 3, mult: 2.0, defPen: 0.5, burn: true }, critVsBurn: 30 },
      cleanse: { hpBelow: 0.5, once: true },
      specialMove: { name: '大噴火', type: 'physical', mult: 2.5, burn: true, playerHealMult: 0.5, turns: 4 },
    }),
  },
  // ── 9層 三頭 ──
  {
    floor: 9, boss: 'アビスキマイラ',
    enemies: [
      E('深淵の獅子頭', 92000, 9200, 6300, 0, 5800, 5100, 'physical', 38000, [
        { name: '獅咬',     type: 'physical',       mult: 1.8, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
        { name: '裂爪乱舞', type: 'physical_multi', mult: 0.7, hits: 2, stunRate: 0.2 },
      ]),
      E('淵底の蛇尾', 86000, 0, 5600, 6800, 8800, 5800, 'magical', 43000, [
        { name: '蛇毒牙', type: 'magical', mult: 1.6, poisonRate: 0.4 },
        { name: '毒霧',   type: 'magical', mult: 1.3, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
      E('虚無の山羊', 104000, 0, 8600, 5200, 8400, 3000, 'magical', 48000, [
        { name: '魔眼の光', type: 'magical', mult: 1.5, paralysisRate: 0.2 },
        { name: '呪縛の瞳', type: 'magical', mult: 1.2, effect: 'spdDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
    ],
    midBoss: E('ダスクキマイラ', 245000, 8400, 9200, 4700, 8100, 6200, 'physical', 650000, [
      { name: '三獣爪',   type: 'physical', mult: 1.7 },
      { name: '混沌吐息', type: 'magical',  mult: 1.5, poisonRate: 0.4 },
      { name: '獣毛の守り', type: 'buff', effect: 'defMdefUp', defRate: 1.3, mdefRate: 1.3, turns: 3 },
    ], {
      phases: [
        { above: 1.00, magTaken: 0.85 },
        { above: 0.67, physTaken: 0.85 },
        { above: 0.34, magTaken: 0.92, physTaken: 0.92 },
      ],
    }),
    floorBoss: E('アビスキマイラ', 420000, 9700, 11000, 6500, 10200, 5300, 'physical', 2300000, [
      { name: '獅咬爪',     type: 'physical',       mult: 1.8, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '蛇尾猛毒',   type: 'magical',        mult: 1.6, poisonRate: 0.6 },
      { name: '三獣乱撃',   type: 'physical_multi', mult: 0.7, hits: 2, stunRate: 0.25 },
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
      specialMove: { name: '三獣咆哮', type: 'magical', mult: 2.5, effect: 'allStatDown', rate: 0.85, turns: 3 },
    }),
  },
  // ── 10層 暴走＋地響き ──
  {
    floor: 10, boss: 'カオスベヒモス',
    enemies: [
      E('混沌の巨腕', 110000, 11000, 7600, 0, 6900, 6200, 'physical', 65000, [
        { name: '巨腕叩きつけ', type: 'physical',       mult: 1.8, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
        { name: '大地砕き',     type: 'physical_multi', mult: 0.7, hits: 2, stunRate: 0.25 },
      ]),
      E('混沌の牙獣', 98000, 9400, 7000, 0, 6600, 9900, 'physical', 73000, [
        { name: '疾牙',     type: 'physical', mult: 1.7 },
        { name: '追い立て', type: 'physical', mult: 1.3, effect: 'spdDown', rate: 0.85, turns: 3, chance: 0.4 },
      ]),
      E('混沌の瞳', 100000, 0, 6800, 8200, 10700, 7000, 'magical', 82000, [
        { name: '混沌視線',   type: 'magical', mult: 1.6, paralysisRate: 0.3 },
        { name: '虚空の脈動', type: 'magical', mult: 1.3, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      ]),
    ],
    midBoss: E('レイジベヒモス', 295000, 10100, 11000, 5600, 9700, 7400, 'physical', 1100000, [
      { name: '憤怒の一撃', type: 'physical', mult: 1.7 },
      { name: '咆哮衝波',   type: 'magical',  mult: 1.5, effect: 'atkMatkDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '猛り立ち',   type: 'buff', effect: 'atkUp', atkRate: 1.3, turns: 3 },
    ], {
      mods: { quake: { spdDown: 0.05, maxStacks: 6 } },
      phases: [{ above: 1.00 }, { above: 0.60, atkMult: 1.25 }, { above: 0.30, atkMult: 1.25 }],
    }),
    floorBoss: E('カオスベヒモス', 520000, 9100, 13200, 6100, 12200, 9600, 'physical', 4000000, [
      { name: '崩落の一撃', type: 'physical',       mult: 1.8, effect: 'defDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '混沌の波動', type: 'magical',        mult: 1.6, effect: 'mdefDown', rate: 0.85, turns: 3, chance: 0.3 },
      { name: '地裂踏破',   type: 'physical_multi', mult: 0.7, hits: 2, stunRate: 0.3 },
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
      specialMove: { name: '天地崩壊', type: 'physical', mult: 2.5, effect: 'spdDown', rate: 0.7, turns: 4 },
    }),
  },
]

export const MAX_IMPLEMENTED_FLOOR = TOWER_FLOORS.length
export const getFloor = (n) => TOWER_FLOORS.find(f => f.floor === n) || null

// 層主挑戦の連戦構成（1〜10層）。数字は enemies から引く体数
export const BOSS_RUN_STAGES = [
  { kind: 'mobs', count: 1, label: '1戦目' },
  { kind: 'mobs', count: 1, label: '2戦目' },
  { kind: 'mobs', count: 2, label: '3戦目' },
  { kind: 'mobs', count: 3, label: '4戦目' },
  { kind: 'mid',  count: 1, label: '中ボス' },
  { kind: 'boss', count: 1, label: '層主' },
]

// 石碑に載せる層（10層ごとの節目だけ）
export const isMonumentFloor = (floor) => floor % 10 === 0

// スキルの対象設定（複数敵がいるときの狙い方）は塔専用ではなくなったので
// src/lib/loadout.js が正。ここは既存の import を壊さないための再エクスポート。
export { TARGET_MODES, DEFAULT_TARGET_MODE } from './loadout.js'

// 敵の総合力（開発用の確認）
export const enemyTotal = (e) =>
  Math.floor(e.hp / 10 + e.atk + e.def + e.matk + e.mdef + e.spd)

// ============================================================
// 塔スキルツリー → 実効ボーナス
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

// ツリーを反映した実効ステータス（塔の中だけの値）
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
  return {
    uid: ++uidSeq,
    name: opts.name || def.name,
    hp: Math.max(1, Math.floor(def.hp * hpRate * (opts.scaleHpByStat ? statRate : 1))),
    maxHp: Math.max(1, Math.floor(def.hp * hpRate * (opts.scaleHpByStat ? statRate : 1))),
    atk: Math.floor((def.atk || 0) * statRate),
    def: Math.floor((def.def || 0) * statRate),
    matk: Math.floor((def.matk || 0) * statRate),
    mdef: Math.floor((def.mdef || 0) * statRate),
    spd: Math.max(1, Math.floor((def.spd || 1) * statRate)),
    type: def.type || 'physical',
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
    // ── 実行時の状態 ──
    buffs: {},
    perm: { atk: 1, matk: 1, def: 1, mdef: 1, spd: 1 },
    skillIdx: 0,
    turnCount: 0,
    phaseIdx: -1,
    defRamp: 1,
    lastPlayerSkill: null,   // 適応（6層）用
    used: {},                // once系トリガーの発火済みフラグ
  }
}

// 連戦の各ステージに出てくる敵を組み立てる
export function buildStageEnemies(floorData, stageIdx) {
  const stage = BOSS_RUN_STAGES[stageIdx]
  if (!stage || !floorData) return []
  if (stage.kind === 'mid') return [makeEnemy(floorData.midBoss, { isBoss: true })]
  if (stage.kind === 'boss') {
    const list = [makeEnemy(floorData.floorBoss, { isBoss: true })]
    for (const es of (floorData.floorBoss.escorts || [])) {
      for (let i = 0; i < (es.count || 1); i++) list.push(makeEnemy(floorData.enemies[es.enemyIndex]))
    }
    return list
  }
  // 雑魚戦：同じ種類が重なることもある
  const list = []
  for (let i = 0; i < (stage.count || 1); i++) {
    const def = floorData.enemies[Math.floor(Math.random() * floorData.enemies.length)]
    list.push(makeEnemy(def))
  }
  return list
}

// 塔出撃（雑魚1体・しきい値到達後は5%で中ボス）
export function buildSortieEnemies(floorData, midChance) {
  if (midChance > 0 && Math.random() < midChance) {
    return { enemies: [makeEnemy(floorData.midBoss, { isBoss: true })], isMid: true }
  }
  const def = floorData.enemies[Math.floor(Math.random() * floorData.enemies.length)]
  return { enemies: [makeEnemy(def)], isMid: false }
}
