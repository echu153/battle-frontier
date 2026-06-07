// ============================================================
// 奈落闘技場（あいり：挑戦コンテンツ）データ定義
// ------------------------------------------------------------
// ・20階層のNPCと対戦。1階を倒すと2階に挑めるようになる（順番制）。
// ・1週間に1階だけ前進できる。勝利すると次の月曜朝5時(JST)まで戦闘不可。
// ・撃破済みの階は報酬を再取得できない（サーバ側 claim_abyss_floor で検証）。
// ・報酬（Gold/強化石/宝石）の付与はサーバRPC側で行う。ここは表示用の定義。
//
// 敵ステータスは「推奨総合力(target)」に総合力がほぼ一致するよう生成する。
// 総合力 = floor(hp/10 + atk + def + matk + mdef + spd)（敵はMP=0）
// → hpFrac*target が HP由来、(1-hpFrac)*target を5ステに配分するので総合力≒target。
//
// ※プレイヤー側はスキル/パッシブの倍率が乗るため、同総合力の素ステ敵は
//   やや御しやすい。難易度は ENEMY_POWER_MULT / フロア tier で開発時に調整する。
// ============================================================

// アーキタイプ：hpFrac=HPに割く総合力の割合、w=残りを各ステへ配分する重み(合計1)
const ARCH = {
  warrior:  { hpFrac:0.36, w:{ atk:0.34, def:0.24, matk:0.02, mdef:0.16, spd:0.24 }, type:'physical' }, // 戦士系
  archer:   { hpFrac:0.28, w:{ atk:0.42, def:0.12, matk:0.02, mdef:0.14, spd:0.30 }, type:'physical' }, // 弓・銃系
  priest:   { hpFrac:0.34, w:{ atk:0.05, def:0.18, matk:0.30, mdef:0.27, spd:0.20 }, type:'magical'  }, // 僧侶・聖職系
  mage:     { hpFrac:0.26, w:{ atk:0.02, def:0.10, matk:0.50, mdef:0.18, spd:0.20 }, type:'magical'  }, // 魔法使い系
  monk:     { hpFrac:0.34, w:{ atk:0.40, def:0.16, matk:0.02, mdef:0.12, spd:0.30 }, type:'physical' }, // 格闘・体術系
  swift:    { hpFrac:0.26, w:{ atk:0.34, def:0.10, matk:0.06, mdef:0.10, spd:0.40 }, type:'physical' }, // 疾風・速攻系
  balanced: { hpFrac:0.34, w:{ atk:0.22, def:0.20, matk:0.16, mdef:0.20, spd:0.22 }, type:'physical' }, // 万能型
  arcane:   { hpFrac:0.30, w:{ atk:0.10, def:0.16, matk:0.40, mdef:0.20, spd:0.14 }, type:'magical'  }, // 大魔導系
}

// 推奨総合力 target を満たす敵ステを生成（決定論的・import時に確定）
function makeEnemy(name, target, archKey) {
  const a = ARCH[archKey]
  const hp = Math.round(target * a.hpFrac) * 10
  const budget = target * (1 - a.hpFrac)
  const s = (k) => Math.max(1, Math.round(budget * a.w[k]))
  return {
    name,
    hp,
    atk: s('atk'), def: s('def'), matk: s('matk'), mdef: s('mdef'), spd: s('spd'),
    type: a.type,
    skills: [], // v1はスキルなし（開発調整後に付与予定）
  }
}

// 階層メタ：名前・推奨総合力・アーキタイプ
const FLOOR_META = [
  { floor:1,  name:'戦士ガレス',           target:500,   arch:'warrior'  },
  { floor:2,  name:'弓使いローガン',       target:800,   arch:'archer'   },
  { floor:3,  name:'僧侶セレナ',           target:1100,  arch:'priest'   },
  { floor:4,  name:'魔法使いヴァルド',     target:1400,  arch:'mage'     },
  { floor:5,  name:'格闘家ドラガ',         target:1700,  arch:'monk'     },
  { floor:6,  name:'疾風のエレン',         target:2500,  arch:'swift'    },
  { floor:7,  name:'断罪のイグナート',     target:3000,  arch:'warrior'  },
  { floor:8,  name:'月影のカゲツ',         target:3500,  arch:'swift'    },
  { floor:9,  name:'聖域のアークライト',   target:4000,  arch:'priest'   },
  { floor:10, name:'武神のレオニス',       target:5000,  arch:'monk'     },
  { floor:11, name:'血塗れのバルガス',     target:6000,  arch:'warrior'  },
  { floor:12, name:'宵闇のノクス',         target:7000,  arch:'swift'    },
  { floor:13, name:'四象のエレシア',       target:8000,  arch:'balanced' },
  { floor:14, name:'念動のサイラス',       target:9000,  arch:'arcane'   },
  { floor:15, name:'万識のアルヴィス',     target:10000, arch:'arcane'   },
  { floor:16, name:'冥府のモルテス',       target:12000, arch:'balanced' },
  { floor:17, name:'神託のラフィエル',     target:14000, arch:'priest'   },
  { floor:18, name:'運命喰らいのフォルト', target:16000, arch:'balanced' },
  { floor:19, name:'魔弾のリオン',         target:18000, arch:'archer'   },
  { floor:20, name:'星喰らいのゼルディア', target:20000, arch:'arcane'   },
]

// 階層ごとの報酬（表示用）。サーバ側 claim_abyss_floor の付与内容と一致させること。
// stone: 強化石ランク, gem: 宝石ランク。
const FLOOR_REWARD = {
  1:  { gold:1500,   stone:'F', stoneCount:1, gem:'F', gemCount:1 },
  2:  { gold:2500,   stone:'F', stoneCount:2, gem:'F', gemCount:1 },
  3:  { gold:4000,   stone:'E', stoneCount:1, gem:'F', gemCount:2 },
  4:  { gold:6000,   stone:'E', stoneCount:2, gem:'E', gemCount:1 },
  5:  { gold:9000,   stone:'D', stoneCount:1, gem:'E', gemCount:1 },
  6:  { gold:13000,  stone:'D', stoneCount:2, gem:'E', gemCount:2 },
  7:  { gold:18000,  stone:'D', stoneCount:3, gem:'D', gemCount:1 },
  8:  { gold:25000,  stone:'C', stoneCount:1, gem:'D', gemCount:1 },
  9:  { gold:33000,  stone:'C', stoneCount:2, gem:'D', gemCount:2 },
  10: { gold:45000,  stone:'C', stoneCount:3, gem:'C', gemCount:1 },
  11: { gold:60000,  stone:'B', stoneCount:1, gem:'C', gemCount:1 },
  12: { gold:78000,  stone:'B', stoneCount:2, gem:'C', gemCount:2 },
  13: { gold:100000, stone:'B', stoneCount:3, gem:'B', gemCount:1 },
  14: { gold:125000, stone:'A', stoneCount:1, gem:'B', gemCount:1 },
  15: { gold:155000, stone:'A', stoneCount:2, gem:'B', gemCount:2 },
  16: { gold:190000, stone:'A', stoneCount:2, gem:'A', gemCount:1 },
  17: { gold:230000, stone:'A', stoneCount:3, gem:'A', gemCount:1 },
  18: { gold:280000, stone:'A', stoneCount:3, gem:'A', gemCount:2 },
  19: { gold:340000, stone:'A', stoneCount:4, gem:'A', gemCount:2 },
  20: { gold:420000, stone:'A', stoneCount:5, gem:'A', gemCount:3 },
}

export const ABYSS_FLOOR_COUNT = FLOOR_META.length

export const ABYSS_FLOORS = FLOOR_META.map(m => ({
  floor: m.floor,
  target: m.target,
  enemy: makeEnemy(m.name, m.target, m.arch),
  reward: FLOOR_REWARD[m.floor],
}))

export const getAbyssFloor = (floor) => ABYSS_FLOORS.find(f => f.floor === floor) || null
