// ============================================================
// 奈落闘技場（挑戦コンテンツ）データ定義
// ------------------------------------------------------------
// ・20階層のNPCと対戦。1階を倒すと2階に挑めるようになる（順番制）。
// ・1週間に1階だけ前進できる。勝利すると次の月曜朝5時(JST)まで戦闘不可。
// ・撃破済みの階は報酬を再取得できない（サーバ側 claim_abyss_floor で検証）。
// ・報酬（Gold/強化石/宝石）の付与はサーバRPC側で行う。ここは表示用の定義。
//
// 敵ステータスは「推奨総合力(target)」に総合力がほぼ一致するよう生成する。
// 総合力 = floor(hp/10 + atk + def + matk + mdef + spd)（敵はMP=0）
//
// 【敵スキルAI（kit）】 ※戦闘への組み込みは別途実装予定
//  - normal     : 毎ターン使う通常スキル（既存クラススキルを名前参照）
//  - normalLow  : HP60%以下のとき通常スキルがこれに変化（null=変化なし）
//  - trigger75  : HPが初めて75%以下になったターンに1度だけ発動（既存スキル参照）
//  - trigger40  : HPが初めて40%以下になったターンに1度だけ発動（既存スキル参照）
//  - special    : HP15%以下で発動する新スキル（試合中1度きり）。
//                 A=物理(ATK基準倍率)、C=特殊攻撃(MATK基準倍率)。custom:true。
//  通常/75/40 のダメージ・効果は既存スキル定義（DBの skills テーブル）を参照する。
//  各スロットは「文字列(スキル名)」または「{name, ...詳細}」で表す。
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
  }
}

// HP15%以下の新スキル定義ヘルパー（custom:true で「新規スキル＝下記の値で解決」を表す）
const sp = (name, opts = {}) => ({ name, custom: true, ...opts })

// 階層メタ：名前・推奨総合力・アーキタイプ・スキルキット
const FLOOR_META = [
  { floor:1,  name:'戦士ガレス',         target:500,   arch:'warrior',
    kit:{ normal:'体当たり', normalLow:null, trigger75:'防御態勢', trigger40:'防御崩し',
          special: sp('強撃') } },
  { floor:2,  name:'弓使いローガン',     target:800,   arch:'archer',
    kit:{ normal:'狙撃', normalLow:null, trigger75:'駆け足', trigger40:'貫通射撃',
          special: sp('疾風矢') } },
  { floor:3,  name:'僧侶セレナ',         target:1100,  arch:'priest',
    kit:{ normal:'ライト', normalLow:null, trigger75:'祈祷', trigger40:'プロテク',
          special: sp('ライトニング') } },
  { floor:4,  name:'魔法使いヴァルド',   target:1400,  arch:'mage',
    kit:{ normal:'ファイア', normalLow:null, trigger75:'精神統一', trigger40:'サンダー',
          special: sp('アイスランス') } },
  { floor:5,  name:'格闘家ドラガ',       target:1700,  arch:'monk',
    kit:{ normal:'打撃', normalLow:null, trigger75:'残心', trigger40:'鉄拳',
          special: sp('爆裂拳') } },
  { floor:6,  name:'疾風のエレン',       target:2500,  arch:'swift',
    kit:{ normal:'毒矢', normalLow:'三連射', trigger75:'狩猟本能', trigger40:'絶影狙撃',
          special: sp('天穿狼牙', { atk:2.5 }) } },
  { floor:7,  name:'聖域のアークライト', target:3000,  arch:'priest',
    kit:{ normal:'ホーリーエッジ', normalLow:'ディバインスマイト', trigger75:'聖域展開', trigger40:'神聖覚醒',
          special: sp('ジャッジメント', { matk:2.5 }) } },
  { floor:8,  name:'月影のカゲツ',       target:3500,  arch:'swift',
    kit:{ normal:'居合斬', normalLow:'断空', trigger75:'明鏡止水', trigger40:'月影',
          special: sp('桜花乱舞', { atk:0.5, hits:5 }) } },
  { floor:9,  name:'武神のレオニス',     target:4000,  arch:'monk',
    kit:{ normal:'半月蹴り', normalLow:'五連殺', trigger75:'破衝掌', trigger40:'飛天三角蹴り',
          special: sp('絶拳', { atk:2.5, stunGuaranteed:true }) } },
  { floor:10, name:'冥府のモルテス',     target:5000,  arch:'arcane',
    kit:{ normal:'骸骨召喚', normalLow:'ソウルドレイン', trigger75:'腐敗霧', trigger40:'幽世ノ門',
          special: sp('ソウルハーベスト', { matk:2.5, lifesteal:0.3 }) } },
  { floor:11, name:'血塗れのバルガス',   target:6000,  arch:'warrior',
    kit:{ normal:'すてみ', normalLow:'マッドラッシュ', trigger75:'ブラッティロア', trigger40:'フルブレイカー',
          special: sp('ハリケーンスラッシュ', { atk:2.5, persist:true }) } }, // persist=試合終了まで毎ターンこれ
  { floor:12, name:'宵闇のノクス',       target:7000,  arch:'swift',
    kit:{ normal:'瞬歩瞬殺', normalLow:'鬼影閃', trigger75:'影歩き', trigger40:'急所突き',
          special: sp('断首', { atk:3.0, executeHpBelow:10 }) } }, // 与ダメ後HP10以下なら即死
  { floor:13, name:'四象のエレシア',     target:8000,  arch:'arcane',
    kit:{ normal:'アクアショット', normalLow:'アースクエイク', trigger75:'ライトニングボルト', trigger40:'フレイムバースト',
          special: sp('五元崩界', { matk:2.5, inflict:['paralysis','burn','stun'], debuff:{ mdef:-20 } }) } },
  { floor:14, name:'念動のサイラス',     target:9000,  arch:'arcane',
    kit:{ normal:'サイコショット', normalLow:'マインドブレイク', trigger75:'精神集中', trigger40:'サイコブラスト',
          special: sp('アカシックレコード', { atk:1.5, matk:1.5, dispelPlayerBuffs:true }) } },
  { floor:15, name:'万識のアルヴィス',   target:10000, arch:'arcane',
    kit:{ normal:'アースクエイク', normalLow:null,
          trigger75:{ name:'氷の障壁', duration:10 },
          trigger40:{ name:'メテオストライク', hits:'3-4' },
          special: sp('ジェネシス・ノヴァ', { matk:3.0 }) } },
  // 16〜20階は後日追加
]

export const ABYSS_FLOOR_COUNT = 20  // 全体の予定階層数（実装済みは FLOOR_META の数）
export const ABYSS_DEFINED_FLOORS = FLOOR_META.length

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

export const ABYSS_FLOORS = FLOOR_META.map(m => ({
  floor: m.floor,
  name: m.name,
  target: m.target,
  enemy: { ...makeEnemy(m.name, m.target, m.arch), kit: m.kit },
  kit: m.kit,
  reward: FLOOR_REWARD[m.floor],
}))

export const getAbyssFloor = (floor) => ABYSS_FLOORS.find(f => f.floor === floor) || null
