// ============================================================
// 奈落闘技場（挑戦コンテンツ）データ定義
// ------------------------------------------------------------
// ・20階層のNPCと対戦。1階を倒すと2階に挑めるようになる（順番制）。
// ・週内は何度でも挑戦でき、登れるところまで登れる。毎週月曜朝5時(JST)に進捗が0へリセット。
// ・同じ週内で撃破済みの階は報酬を再取得できない（サーバ側 claim_abyss_floor で検証）。
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
// dmgType: 'phys'(特攻→攻撃に寄せ) / 'mag'(攻撃→特攻に寄せ) / 'hybrid'(両方使うので寄せない)
// 省略時は arch.type から判定（スキルで使わない側を使う側に全部加算する＝奈落の特別調整）
// 火力→耐久へ振り替える割合：atk/matk をこの割合だけ削り、HP/def/mdef へ移す（総合力は概ね不変）
const ABYSS_TANK_SHIFT = 0.18
function makeEnemy(name, target, archKey, dmgType) {
  const a = ARCH[archKey]
  let hp = Math.round(target * a.hpFrac) * 10
  const budget = target * (1 - a.hpFrac)
  const s = (k) => Math.max(1, Math.round(budget * a.w[k]))
  let atk = s('atk'), matk = s('matk')
  const dt = dmgType || (a.type === 'magical' ? 'mag' : 'phys')
  if (dt === 'phys') { atk += matk; matk = 0 }        // 特殊攻撃を攻撃に全加算
  else if (dt === 'mag') { matk += atk; atk = 0 }     // 攻撃を特殊攻撃に全加算
  // hybrid はそのまま（両方使うスキル持ち）
  let def = s('def'), mdef = s('mdef')
  const spd = s('spd')

  // 奈落の体感調整：火力(atk/matk)を少し下げ、削った分を HP と 耐久(def/mdef) へ移す。
  // 総合力(=hp/10+atk+def+matk+mdef+spd)はほぼ不変のまま、拮抗時に試合が長引くようにする。
  const atkCut  = Math.round(atk  * ABYSS_TANK_SHIFT)
  const matkCut = Math.round(matk * ABYSS_TANK_SHIFT)
  const freed   = atkCut + matkCut          // 削った総合力ぶん
  atk  = Math.max(1, atk  - atkCut)
  matk = matk > 0 ? Math.max(1, matk - matkCut) : matk
  hp  += Math.round(freed * 0.5) * 10        // 半分はHPへ（hp/10で総合力換算のため×10）
  def  += Math.round(freed * 0.25)           // 残りを def/mdef へ
  mdef += Math.round(freed * 0.25)

  hp = hp * 2   // 体感調整：敵HPを2倍にして試合を長引かせる

  return {
    name,
    hp,
    atk, def, matk, mdef, spd,
    // 被ダメ計算の軽減対象(DEF/MDEF)が寄せ方向と一致するよう type を補正（hybridはarch準拠）
    type: dt === 'mag' ? 'magical' : dt === 'phys' ? 'physical' : a.type,
  }
}

// HP15%以下の新スキル定義ヘルパー（custom:true で「新規スキル＝下記の値で解決」を表す）
const sp = (name, opts = {}) => ({ name, custom: true, ...opts })

// 階層メタ：名前・推奨総合力・アーキタイプ・スキルキット
const FLOOR_META = [
  { floor:1,  name:'戦士ガレス',         target:500,   arch:'warrior',
    kit:{ normal:'体当たり', normalLow:null, trigger75:'防御態勢', trigger40:'防御崩し',
          special:'強撃' } },
  { floor:2,  name:'弓使いローガン',     target:800,   arch:'archer',
    kit:{ normal:'狙撃', normalLow:null, trigger75:'駆け足', trigger40:'貫通射撃',
          special:'疾風矢' } },
  { floor:3,  name:'僧侶セレナ',         target:1100,  arch:'priest',
    kit:{ normal:'ライト', normalLow:null, trigger75:'祈祷', trigger40:'プロテク',
          special:'ライトニング' } },
  { floor:4,  name:'魔法使いヴァルド',   target:1400,  arch:'mage',
    kit:{ normal:'ファイア', normalLow:null, trigger75:'精神統一', trigger40:'サンダー',
          special:'アイスランス' } },
  { floor:5,  name:'格闘家ドラガ',       target:1700,  arch:'monk',
    kit:{ normal:'打撃', normalLow:null, trigger75:'残心', trigger40:'鉄拳',
          special:'爆裂拳' } },
  { floor:6,  name:'疾風のエレン',       target:2500,  arch:'swift',
    kit:{ normal:'毒矢', normalLow:'三連射', trigger75:'狩猟本能', trigger40:'絶影狙撃',
          special: sp('天穿狼牙', { atk:2.5 }) } },
  { floor:7,  name:'聖域のアークライト', target:3000,  arch:'priest', dmg:'hybrid',
    kit:{ normal:'ホーリーエッジ', normalLow:'ディバインスマイト', trigger75:'聖域展開', trigger40:'神聖覚醒',
          special: sp('ジャッジメント', { matk:2.5 }) } },
  { floor:8,  name:'賭博士バカピエロ', target:3500, arch:'balanced', dmg:'hybrid',
    kit:{ normal:'ジャグリング', normalLow:'ラッキーダイス',
          trigger75:{ name:'オールイン', noBacklash:true }, trigger40:'ジャックポット',
          special: sp('ロイヤル・フラッシュ', { atk:2.5, critGuaranteed:true }) } },
  { floor:9,  name:'武神のレオニス',     target:4000,  arch:'monk',
    kit:{ normal:'半月蹴り', normalLow:'五連殺', trigger75:'破衝掌', trigger40:'飛天三角蹴り',
          special: sp('絶拳', { atk:2.5, stunGuaranteed:true }) } },
  { floor:10, name:'冥府のモルテス',     target:5000,  arch:'arcane',
    kit:{ normal:'骸骨召喚', normalLow:'ソウルドレイン', trigger75:'腐敗霧', trigger40:'幽世ノ門',
          special: sp('ソウルハーベスト', { matk:2.5, lifesteal:0.3 }) } },
  { floor:11, name:'血塗れのバルガス',   target:6000,  arch:'warrior',
    kit:{ normal:'すてみ', normalLow:'マッドラッシュ', trigger75:'ブラッティロア', trigger40:'フルブレイカー',
          special: sp('ハリケーンスラッシュ', { atk:2.5, persist:true }) } }, // persist=試合終了まで毎ターンこれ
  { floor:12, name:'月影のカゲツ',       target:7000,  arch:'swift',
    kit:{ normal:'居合斬', normalLow:'断空', trigger75:'明鏡止水', trigger40:'月影',
          special: sp('桜花乱舞', { atk:0.5, hits:5 }) } }, // 与ダメ後HP10以下なら即死
  { floor:13, name:'四象のエレシア',     target:8000,  arch:'arcane',
    kit:{ normal:'アクアショット', normalLow:'アースクエイク', trigger75:'ライトニングボルト', trigger40:'フレイムバースト',
          special: sp('五元崩界', { matk:2.5, inflict:['paralysis','burn','stun'], debuff:{ mdef:-20 } }) } },
  { floor:14, name:'念動のサイラス',     target:9000,  arch:'arcane', dmg:'hybrid',
    kit:{ normal:'サイコショット', normalLow:'マインドブレイク', trigger75:'精神集中', trigger40:'サイコブラスト',
          special: sp('アカシックレコード', { atk:1.5, matk:1.5, dispelPlayerBuffs:true }) } },
  { floor:15, name:'万識のアルヴィス',   target:10000, arch:'arcane',
    kit:{ normal:'アースクエイク', normalLow:null,
          trigger75:{ name:'氷の障壁', duration:10 },
          trigger40:{ name:'メテオストライク', hits:'3-4' },
          special: sp('ジェネシス・ノヴァ', { matk:3.0 }) } },
  { floor:16, name:'断罪のイグナート',   target:12000, arch:'balanced', dmg:'mag',
    kit:{ normal:'粛清', normalLow:'聖なる裁き',
          trigger75:{ name:'狂信', buff:{ atkMult:2, matkMult:2 }, duration:10 }, // A＋C2倍を追加(10T)
          trigger40:'断罪',
          special: sp('ギルティクラウン', { matk:2.5, healBlock:true }) } }, // 以降回復不可
  { floor:17, name:'神託のラフィエル',   target:14000, arch:'priest',
    kit:{ normal:'ホーリーライト', normalLow:'奇跡', trigger75:'祈りの結界', trigger40:'神罰執行',
          special: sp('天の祝福', { fullHeal:true, allStatsMult:2, thenOnlySkill:'神罰執行' }) } }, // HP全回復・全ステ2倍・以降神罰執行のみ
  { floor:18, name:'魔弾のリオン',       target:16000, arch:'archer', dmg:'hybrid',
    kit:{ normal:'連装銃撃',
          normalLow:{ name:'キャノネスチュームビンド', comboMult:1.8 }, // 連続使用時×1.8倍
          trigger75:{ name:'強化装填', permanent:true, effectMult:1.5 }, // 永続・効果1.5倍
          trigger40:{ name:'影強化', custom:true, convertCtoA:true, addFollowup:{ atk:2.0 } }, // C→A変換・以降全スキルにA2.0追撃
          special: sp('ゲシュペンストハーケン', { atk:5.0, lifesteal:0.5 }) } }, // 与ダメの半分回復
  { floor:19, name:'暗殺者えちゅ',       target:18000, arch:'swift',
    kit:{ normal:{ name:'瞬歩瞬殺', guaranteedBleed:true },
          normalLow:{ name:'鬼影閃', guaranteedBleed:true,
                      note:'相手の出血スタック最大時は急所突きを自動発動(出血スタック×20%追撃・最大100%→出血消費)' },
          trigger75:{ name:'影歩き', permanent:true, critDmgPlus:0.5 }, // 永続・クリ威力+50%
          trigger40:{ name:'絶影', custom:true, permanent:true, buff:{ atkMult:2, spdMult:2 } }, // AS永続2倍
          special: sp('断首', { atk:3.0, executeHpBelow:10 }) } }, // 与ダメ後HP10以下なら即死
  // ── 20階=複数職ボス / 21〜25階=新クラス5職 / 26〜30階=複数職ボス（2026-07-26追加）──
  // ※通常/trigger枠は executeSkill で処理される実在スキル名のみ使用。
  //   ペットコマンド・式神召喚・各パッシブは executeSkill 対象外のため custom(sp) で表現。
  { floor:20, name:'双牙の門番ガルヴァス',   target:20000, arch:'balanced', dmg:'hybrid', // 侍＋元素使い
    kit:{ normal:'居合斬', normalLow:'アクアショット', trigger75:'明鏡止水', trigger40:'フレイムバースト',
          special: sp('双牙・崩天', { atk:1.6, matk:1.6, hits:2 }) } },
  { floor:21, name:'紫電剣のロレンツォ',     target:23000, arch:'balanced', dmg:'hybrid', // 魔法剣士
    kit:{ normal:'雷光斬', normalLow:'エレメンタルエッジ', trigger75:'魔剣開放', trigger40:'閃光',
          special: sp('魔剣・星霜', { atk:2.0, matk:2.0 }) } },
  { floor:22, name:'陰陽師ヨミジ',           target:26000, arch:'arcane', dmg:'mag', // 式神使い
    kit:{ normal:'符術・式打ち', normalLow:'呪符・魂削り', trigger75:'陰陽結界', trigger40:'禁術・神降ろし',
          special: sp('百鬼夜行', { matk:2.6, inflict:['paralysis','burn'], debuff:{ mdef:-25 } }) } },
  { floor:23, name:'精霊王フィオレ',         target:29000, arch:'arcane', dmg:'mag', // 精霊召喚士
    kit:{ normal:'サラマンド', normalLow:'ノクス', trigger75:'ノーム', trigger40:'シルフ',
          special: sp('六精・崩界', { matk:1.6, hits:2, inflict:['burn','paralysis'] }) } },
  { floor:24, name:'竜騎将ヴォルガ',         target:32000, arch:'warrior', dmg:'phys', // 竜騎士
    kit:{ normal:'ドラゴンスラスト', normalLow:'ドラゴンファング', trigger75:'ドラゴンロア', // ロア=対象の攻/特攻-30%
          trigger40: sp('竜牙連咬', { atk:1.4, hits:2 }),
          special: sp('天墜竜閃', { atk:4.5, critGuaranteed:true }) } }, // 溜め技を確定クリ大技で表現
  { floor:25, name:'獣王ベルナ',             target:33000, arch:'monk', dmg:'phys', // ブリーダー(ペット共闘)
    // ※atkが高い階のため、ブリーダー本来の高倍率(やっちゃえ×5〜6等)はそのまま使わず、24階(竜騎士)と釣り合う水準へ抑制。
    kit:{ normal: sp('連携の爪', { atk:1.1, hits:2 }),        // 計2.2
          normalLow: sp('猛獣の咆哮', { atk:1.3, hits:2 }),    // 計2.6
          trigger75:{ name:'一緒に頑張ろう！', buff:{ atkMult:1.3 }, duration:3 }, // 与ダメ強化(3T)・雪だるま抑制
          trigger40: sp('やっちゃえ！', { atk:1.5, hits:2 }),  // 計3.0
          special: sp('獣王覚醒・共闘', { atk:2.3, hits:2, lifesteal:0.25 }) } }, // 計4.6
  { floor:26, name:'業火の闘鬼ゴウエン',     target:36000, arch:'monk', dmg:'phys', // 狂戦士＋体術師
    kit:{ normal:'マッドラッシュ', normalLow:'五連殺',
          // 連携: 闘気練成(攻撃+50%)→剛炎連拳(2連)→爆砕撃。バフを乗せてから高倍率を叩き込む。
          combo:[ { name:'闘気練成', buff:{ atkMult:1.5 }, duration:3 },
                  sp('剛炎連拳', { atk:1.4, hits:2 }),
                  sp('爆砕撃', { atk:2.0 }) ],
          trigger75:'ブラッティロア', trigger40:'破衝掌',
          special: sp('業火爆砕拳', { atk:3.0, hits:2 }) } },
  { floor:27, name:'呪詛の大司教モルドレッド', target:39000, arch:'arcane', dmg:'mag', // 死霊使い＋異端審問官
    kit:{ normal:'ソウルドレイン', normalLow:'聖なる裁き',
          // 連携: 呪詛増幅(特攻+50%)→冥呪弾(2連)→魂喰らい(吸収)。増幅後に叩き込みつつHP回収。
          combo:[ { name:'呪詛増幅', buff:{ matkMult:1.5 }, duration:3 },
                  sp('冥呪弾', { matk:1.6, hits:2 }),
                  sp('魂喰らい', { matk:2.0, lifesteal:0.3 }) ],
          trigger75:'腐敗霧', trigger40:'断罪',
          special: sp('冥府の呪詛', { matk:3.0, healBlock:true, inflict:['paralysis'] }) } },
  { floor:28, name:'竜牙の剣鬼ザンゲツ',     target:42000, arch:'warrior', dmg:'phys', // 竜騎士＋侍
    kit:{ normal:'居合斬', normalLow:'ドラゴンスラスト',
          // 連携: 気を研ぐ(攻撃+40%)→居合斬→竜牙返し(2連)。剣技と竜牙をつなぐ。
          combo:[ { name:'気を研ぐ', buff:{ atkMult:1.4 }, duration:3 },
                  '居合斬',
                  sp('竜牙返し', { atk:1.8, hits:2 }) ],
          trigger75:'明鏡止水', trigger40:'月影',
          special: sp('竜牙一閃・斬鉄', { atk:3.2, hits:2, critGuaranteed:true }) } },
  { floor:29, name:'万象の魔導王アルカ',     target:45000, arch:'arcane', dmg:'hybrid', // 賢者＋元素使い＋魔銃士
    kit:{ normal:'メテオストライク', normalLow:'連装銃撃',
          // 連携: 魔力過充填(特攻+50%/攻撃+30%)→魔閃連弾(2連)→極大魔弾。充填してから撃ち切る。
          combo:[ { name:'魔力過充填', buff:{ matkMult:1.5, atkMult:1.3 }, duration:3 },
                  sp('魔閃連弾', { atk:1.0, matk:1.4, hits:2 }),
                  sp('極大魔弾', { matk:2.2 }) ],
          trigger75:{ name:'氷の障壁', duration:10 },
          trigger40:'フレイムバースト',
          special: sp('万象崩滅', { atk:2.0, matk:2.0, hits:2, inflict:['burn','paralysis','stun'] }) } },
  { floor:30, name:'奈落の支配者アビスロード', target:50000, arch:'balanced', dmg:'hybrid', // 全職集大成(最終)
    revive:{ hpFrac:0.5, allStatsMult:2 }, // HP0で1度だけ最大HP50%で復活し、全ステータス2倍
    kit:{ normal: sp('虚無の刃', { atk:1.6, matk:1.6 }),
          normalLow: sp('冥滅の波動', { atk:1.8, matk:1.8, hits:2 }),
          // 連携（自己バフ無し＝絶対君臨と競合させない）: 虚無の刃→冥滅の波動(2連)→次元の牙(2連)を巡回。
          // 絶対君臨(+50%)が乗った状態でこの複合連撃を回すのが本ボスのコンボ。
          combo:[ sp('虚無の刃', { atk:1.7, matk:1.7 }),
                  sp('冥滅の波動', { atk:1.7, matk:1.7, hits:2 }),
                  sp('次元の牙', { atk:1.5, matk:1.5, hits:2 }) ],
          trigger75:{ name:'絶対君臨', buff:{ atkMult:1.5, matkMult:1.5 }, duration:10 },
          trigger40: sp('次元断裂', { atk:2.0, matk:2.0, dispelPlayerBuffs:true, inflict:['paralysis','stun'] }),
          special: sp('終焉ノ宣告', { atk:2.2, matk:2.2, hits:2, healBlock:true, executeHpBelow:15, lifesteal:0.3 }) } },
]

export const ABYSS_FLOOR_COUNT = 30  // 全体の予定階層数（実装済みは FLOOR_META の数）
export const ABYSS_DEFINED_FLOORS = FLOOR_META.length

// 階層ごとの報酬（表示用）。サーバ側 claim_abyss_floor の付与内容と一致させること。
// stone: 強化石ランク, gem: 宝石ランク。
// 宝石ランク: 1〜10=F / 11〜20=E / 21〜26=D / 27〜30=C。強化石: 〜20=A天井 / 21〜30=S。
const FLOOR_REWARD = {
  1:  { gold:3000,   stone:'F', stoneCount:1, gem:'F', gemCount:1 },
  2:  { gold:5000,   stone:'F', stoneCount:2, gem:'F', gemCount:1 },
  3:  { gold:8000,   stone:'E', stoneCount:1, gem:'F', gemCount:1 },
  4:  { gold:12000,  stone:'E', stoneCount:2, gem:'F', gemCount:2 },
  5:  { gold:18000,  stone:'D', stoneCount:1, gem:'F', gemCount:2 },
  6:  { gold:26000,  stone:'D', stoneCount:2, gem:'F', gemCount:2 },
  7:  { gold:36000,  stone:'D', stoneCount:3, gem:'F', gemCount:3 },
  8:  { gold:50000,  stone:'C', stoneCount:1, gem:'F', gemCount:3 },
  9:  { gold:66000,  stone:'C', stoneCount:2, gem:'F', gemCount:3 },
  10: { gold:90000,  stone:'C', stoneCount:3, gem:'F', gemCount:3 },
  11: { gold:120000, stone:'B', stoneCount:1, gem:'E', gemCount:1 },
  12: { gold:156000, stone:'B', stoneCount:2, gem:'E', gemCount:1 },
  13: { gold:200000, stone:'B', stoneCount:3, gem:'E', gemCount:1 },
  14: { gold:250000, stone:'A', stoneCount:1, gem:'E', gemCount:2 },
  15: { gold:310000, stone:'A', stoneCount:2, gem:'E', gemCount:2 },
  16: { gold:380000, stone:'A', stoneCount:2, gem:'E', gemCount:2 },
  17: { gold:460000, stone:'A', stoneCount:3, gem:'E', gemCount:2 },
  18: { gold:560000, stone:'A', stoneCount:3, gem:'E', gemCount:3 },
  19: { gold:680000,  stone:'A', stoneCount:4, gem:'E', gemCount:3 },
  20: { gold:840000,  stone:'A', stoneCount:4, gem:'E', gemCount:3, crystal:1 }, // 節目報酬: 強者の結晶
  21: { gold:1000000, stone:'S', stoneCount:1, gem:'D', gemCount:2 },
  22: { gold:1000000, stone:'S', stoneCount:1, gem:'D', gemCount:2 },
  23: { gold:1000000, stone:'S', stoneCount:2, gem:'D', gemCount:2 },
  24: { gold:1000000, stone:'S', stoneCount:2, gem:'D', gemCount:3 },
  25: { gold:1000000, stone:'S', stoneCount:3, gem:'D', gemCount:3, crystal:2 }, // 節目報酬: 強者の結晶
  26: { gold:1200000, stone:'S', stoneCount:3, gem:'D', gemCount:3 },
  27: { gold:1200000, stone:'S', stoneCount:3, gem:'C', gemCount:1 },
  28: { gold:1200000, stone:'S', stoneCount:4, gem:'C', gemCount:1 },
  29: { gold:1200000, stone:'S', stoneCount:4, gem:'C', gemCount:1 },
  30: { gold:1500000, stone:'S', stoneCount:4, gem:'C', gemCount:2, crystal:3 }, // 節目報酬: 強者の結晶
}

// 匠の秘伝書（階層別）: 3〜7=Ⅰ / 8〜13=Ⅱ / 14〜19=Ⅲ / 20=Ⅳ / 21〜25=Ⅲ / 26〜30=Ⅳ（1〜2階は無し）
// ※supabase_abyss_floor30_20260726.sql の CASE と一致させること
export const abyssBookForFloor = (floor) => {
  if (floor >= 26) return 'Ⅳ'
  if (floor >= 21) return 'Ⅲ'
  if (floor === 20) return 'Ⅳ'
  if (floor >= 14) return 'Ⅲ'
  if (floor >= 8)  return 'Ⅱ'
  if (floor >= 3)  return 'Ⅰ'
  return null
}

export const ABYSS_FLOORS = FLOOR_META.map(m => ({
  floor: m.floor,
  name: m.name,
  target: m.target,
  enemy: { ...makeEnemy(m.name, m.target, m.arch, m.dmg), kit: m.kit, revive: m.revive || null },
  kit: m.kit,
  reward: { ...FLOOR_REWARD[m.floor], book: abyssBookForFloor(m.floor) },
}))

export const getAbyssFloor = (floor) => ABYSS_FLOORS.find(f => f.floor === floor) || null
