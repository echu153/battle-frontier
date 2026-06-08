// ============================================================
// 天穹十二宮（てんきゅうじゅうにぐう）データ定義
// ------------------------------------------------------------
// ・エンドコンテンツ。黄道十二星座モチーフの「現状最強の12体」と戦う挑戦コンテンツ。
// ・12宮は最初から自由な順で挑戦できる（奈落闘技場のような順番制ではない）。
// ・プレイヤーには共通のステータス上限があり、超過分は5%しか発揮されない（TENKYUU_STAT_CAP）。
// ・勝利で称号を獲得できる（称号と付与ステータスは後日設定。現状は制覇マークのみ）。
// ・各宮には固有ギミック（mods）があり、敵に合わせてスキル調整が必要。
//
// 現状は【開発アカウント(is_admin)限定】で公開。称号報酬・進捗の永続化は後続フェーズ。
//
// 敵ステータスは「推奨総合力(target)=20000」に総合力がほぼ一致するよう生成する。
// 総合力 = floor(hp/10 + atk + def + matk + mdef + spd)（敵はMP=0）
//
// 【固有ギミック mods】（戦闘エンジン simulateTenkyuuBattle が宣言的に解釈する）
//  openingBurst:{stat,mult}  開幕大ダメージ（第一）
//  turnScaleAtk:perTurn      ターン毎にatk/matk上昇（第一）
//  turnScaleAll:perTurn      ターン毎に全ステ上昇（第十）
//  flatDR:0..1               被ダメ一律軽減%（防御値ではない。毒/出血/やけど等の固定割合DoTは貫通）（第二）
//  hpScaleDef:maxMult        HPが減るほど def/mdef 上昇（第二）
//  ccImmune:true             スタン/麻痺/行動妨害 無効（第二）
//  defPen:true               敵の全攻撃が防御貫通（第四）
//  dispelPerTurn:n           毎ターンこちらのバフをn個解除（第四）
//  healBlock:true            プレイヤー回復阻害（第四）
//  hitStun:0..1              敵の攻撃命中時のスタン確率（第五）※プレイヤーの状態異常無効で防げる
//  hpThreshAtk:{below,mult}  HP閾値以下で敵の攻撃上昇（第五）
//  statusOnHit:[...]         敵の攻撃命中で状態異常付与（第六/八）
//  statusImmune:true         敵自身は状態異常無効（プレイヤーが付与する毒等を無効化）（第六）
//  bonusVsStatus:{st,mult}   プレイヤーが指定状態のとき敵が追撃（第八）
//  dmgTakenCap:pct           プレイヤーが1ヒットで受ける最大ダメージ=自身maxHp%（第八）
//  evasion:pct               敵の回避率（プレイヤー攻撃を回避）（第二/八）
//  alwaysHit:true            敵の攻撃は必中（プレイヤー回避を無効化）（第九）
//  extraActionCap:n          敵の追加攻撃の上限回数（第九）
//  escalatingHit:perHit      敵が連続行動するほど威力上昇（第九）
//  healOnPlayerAction:pct    プレイヤーが行動するたびに敵が回復（第十）
// ============================================================

// プレイヤーのステータス上限（過剰分は5%のみ適用）。
// これは「デフォルト上限」。各宮は PALACE_META の cap で個別に上書きする（敵ごとに上限が異なる）。
// ねらい：全宮一律(例:全2500)だと「捨てるステがない＝実質デメリットなし」になるため、
//   宮ごとに『活かすステ／捨てるステ』を作り、敵に合わせたビルド調整を強制する。
// ※実際に上限が効くかは挑む側の素のステ次第。エンドのステ分布を見て要調整。
export const TENKYUU_STAT_CAP = { hp: 25000, atk: 2500, def: 2500, matk: 2500, mdef: 2500, spd: 2500 }
export const TENKYUU_OVER_RATE = 0.05  // 上限超過分の適用率

// eff（atk/def/matk/mdef/spd）と hp_max に上限を適用して返す。
// 戻り値: { eff(新規オブジェクト), hpMax, wasCapped }
export function applyStatCap(eff, hpMax, capOverride) {
  const cap = { ...TENKYUU_STAT_CAP, ...(capOverride || {}) }
  let wasCapped = false
  const clamp = (v, c) => {
    if (v <= c) return v
    wasCapped = true
    return Math.round(c + (v - c) * TENKYUU_OVER_RATE)
  }
  const newEff = {
    ...eff,
    atk:  clamp(eff.atk,  cap.atk),
    def:  clamp(eff.def,  cap.def),
    matk: clamp(eff.matk, cap.matk),
    mdef: clamp(eff.mdef, cap.mdef),
    spd:  clamp(eff.spd,  cap.spd),
  }
  const newHpMax = clamp(hpMax, cap.hp)
  return { eff: newEff, hpMax: newHpMax, wasCapped }
}

// アーキタイプ：hpFrac=HPに割く総合力の割合、w=残りを各ステへ配分する重み(合計1)
const ARCH = {
  warrior:  { hpFrac:0.36, w:{ atk:0.34, def:0.24, matk:0.02, mdef:0.16, spd:0.24 }, type:'physical' },
  archer:   { hpFrac:0.28, w:{ atk:0.42, def:0.12, matk:0.02, mdef:0.14, spd:0.30 }, type:'physical' },
  priest:   { hpFrac:0.34, w:{ atk:0.05, def:0.18, matk:0.30, mdef:0.27, spd:0.20 }, type:'magical'  },
  mage:     { hpFrac:0.26, w:{ atk:0.02, def:0.10, matk:0.50, mdef:0.18, spd:0.20 }, type:'magical'  },
  monk:     { hpFrac:0.34, w:{ atk:0.40, def:0.16, matk:0.02, mdef:0.12, spd:0.30 }, type:'physical' },
  swift:    { hpFrac:0.26, w:{ atk:0.34, def:0.10, matk:0.06, mdef:0.10, spd:0.40 }, type:'physical' },
  balanced: { hpFrac:0.34, w:{ atk:0.22, def:0.20, matk:0.16, mdef:0.20, spd:0.22 }, type:'physical' },
  arcane:   { hpFrac:0.30, w:{ atk:0.10, def:0.16, matk:0.40, mdef:0.20, spd:0.14 }, type:'magical'  },
  tank:     { hpFrac:0.42, w:{ atk:0.26, def:0.30, matk:0.02, mdef:0.20, spd:0.12 }, type:'physical' }, // 受け特化
}

// 推奨総合力 target を満たす敵ステを生成（決定論的）。
// dmgType: 'phys'(特攻→攻撃へ寄せ) / 'mag'(攻撃→特攻へ寄せ) / 'hybrid'(寄せない)
function makeEnemy(name, target, archKey, dmgType, statTweak) {
  const a = ARCH[archKey]
  let hp = Math.round(target * a.hpFrac) * 10
  const budget = target * (1 - a.hpFrac)
  const s = (k) => Math.max(1, Math.round(budget * a.w[k]))
  let atk = s('atk'), matk = s('matk')
  const dt = dmgType || (a.type === 'magical' ? 'mag' : 'phys')
  if (dt === 'phys') { atk += matk; matk = 0 }
  else if (dt === 'mag') { matk += atk; atk = 0 }
  let def = s('def'), mdef = s('mdef')
  const spd = s('spd')
  let enemy = {
    name, hp, atk, def, matk, mdef, spd,
    type: dt === 'mag' ? 'magical' : dt === 'phys' ? 'physical' : a.type,
  }
  // 宮ごとの微調整（def/mdef の偏りなど）。総合力は概ね維持。
  if (statTweak) enemy = statTweak(enemy)
  return enemy
}

const TARGET = 20000  // 全宮共通の推奨総合力

// 12宮メタ。kit が無い宮はギミック(mods)中心で、通常攻撃＋固有処理で戦う。
// cap = この宮だけのステータス上限（デフォルト TENKYUU_STAT_CAP を部分上書き）。
//   各宮の戦い方に沿って「活かすステ／捨てるステ」を作る。数値はチューニング前提。
// title/titleBonus は後日設定（現状は表示のみ・付与なし）。
const PALACE_META = [
  { palace:1, name:'【白羊】ハマル', arch:'warrior', dmg:'phys',
    feature:'戦闘開始直後に大ダメージ／ターン経過ごとにダメージアップ',
    mods:{ openingBurst:{ stat:'atk', mult:3.0 }, turnScaleAtk:0.10 },
    cap:{ atk:4000, matk:2000, def:1500, mdef:1500, spd:3000, hp:18000 }, // 耐久を伸ばせない＝高火力で早期決着を強制
    title:'※後日設定' },

  { palace:2, name:'【金牛】アルデバラン', arch:'tank', dmg:'phys',
    feature:'受け特化（防御値ではなくダメージ軽減が高い）／HPが減るほど防御上昇／行動妨害無効',
    mods:{ flatDR:0.5, hpScaleDef:2.0, ccImmune:true, evasion:0 },
    cap:{ atk:1800, matk:1800, def:3500, mdef:3500, spd:1500, hp:45000 }, // 直接火力は通りにくい＝耐久＋固定ダメで長期戦
    title:'※後日設定' },

  { palace:3, name:'【双影】カストル＆ポルックス', arch:'balanced', dmg:'hybrid',
    feature:'物理はカストル・特殊はポルックスが受ける／片方倒すと数ターンで蘇生／片方だけだとステータス上昇',
    mods:{ twin:true },  // ※Phase3で実装（敵2体）。現状は準備中。
    cap:{ atk:3000, matk:3000, def:2500, mdef:2500, spd:2500, hp:25000 }, // 物理特殊バランス型
    title:'※後日設定', wip:true },

  { palace:4, name:'【断絶】アクベンス', arch:'tank', dmg:'phys',
    feature:'バフ解除・回復阻害が豊富／すべてのスキルが防御貫通／防御固め',
    mods:{ defPen:true, dispelPerTurn:1, healBlock:true },
    statTweak:(e)=>({ ...e, def:Math.round(e.def*1.5), mdef:Math.round(e.mdef*0.6) }), // 物理は固い・特殊は脆い
    cap:{ atk:2000, matk:4000, def:1200, mdef:1200, spd:2500, hp:25000 }, // 防御は貫通され無意味＝特殊火力に振る
    title:'※後日設定' },

  { palace:5, name:'【獅子】レグルス', arch:'monk', dmg:'phys',
    feature:'すべての攻撃がスタン100%／HP50%以下で攻撃上昇',
    mods:{ hitStun:1.0, hpThreshAtk:{ below:0.5, mult:1.5 } },
    cap:{ atk:2000, matk:2000, def:4000, mdef:4000, spd:1500, hp:35000 }, // 火力は伸ばせない＝防御を固めて受けきる
    title:'※後日設定' },

  { palace:6, name:'【乙女】スピカ', arch:'arcane', dmg:'mag',
    feature:'状態異常特化／自身は状態異常無効／防御関連がやや高め',
    mods:{ statusOnHit:['poison','burn','paralysis'], statusImmune:true },
    statTweak:(e)=>({ ...e, def:Math.round(e.def*1.2), mdef:Math.round(e.mdef*1.2) }),
    cap:{ atk:3000, matk:3000, def:1500, mdef:1500, spd:2500, hp:22000 }, // 防御は活きづらい＝貫通火力で押す
    title:'※後日設定' },

  { palace:7, name:'【天秤】エルゲルビ', arch:'balanced', dmg:'hybrid',
    feature:'攻撃と特殊攻撃・防御と特防を平均化／平均値の差が大きいと即死／重い一撃には固定ダメージで反撃',
    mods:{ statAverage:true, instakill:true, counterFlat:true }, // ※Phase2で実装
    cap:{ atk:2500, matk:2500, def:2500, mdef:2500, spd:2500, hp:25000 }, // 平均化前提＝均等
    title:'※後日設定', wip:true },

  { palace:8, name:'【天蠍】アンタレス', arch:'swift', dmg:'phys',
    feature:'スキルが毒を付与・毒状態の敵に追撃／最大被ダメ上限あり／回避率やや高め',
    mods:{ statusOnHit:['poison'], bonusVsStatus:{ st:'poison', mult:0.6 }, dmgTakenCap:0.10, evasion:15 },
    cap:{ atk:2500, matk:2500, def:2500, mdef:2500, spd:4500, hp:25000 }, // 単発は被ダメ上限で頭打ち＝命中(spd)を伸ばし多段で削る
    title:'※後日設定' },

  { palace:9, name:'【蒼穹】アウストラリス', arch:'swift', dmg:'phys',
    feature:'すべて必中・素早さもかなり高い／追加攻撃の上限が4回／連続攻撃で威力が上がる',
    mods:{ alwaysHit:true, extraActionCap:4, escalatingHit:0.15 },
    statTweak:(e)=>({ ...e, spd:Math.round(e.spd*1.4) }),
    cap:{ atk:2500, matk:2500, def:2000, mdef:2000, spd:6000, hp:25000 }, // 素早さ全振りで敵の追加攻撃を封じる構成を許可
    title:'※後日設定' },

  { palace:10, name:'【黒角】デネブ', arch:'arcane', dmg:'mag',
    feature:'経過ターンに応じて能力向上・長期化するほど強力／プレイヤーが行動するたびに回復',
    mods:{ turnScaleAll:0.08, healOnPlayerAction:0.03 },
    cap:{ atk:4500, matk:4500, def:1200, mdef:1200, spd:3500, hp:16000 }, // 長期戦は不利＝火力全開の短期決戦
    title:'※後日設定' },

  { palace:11, name:'【宝瓶】サダルメリク', arch:'priest', dmg:'mag',
    feature:'多数の永続バフ・回復を使う／同じスキルのダメージを軽減する',
    mods:{ permaBuffs:true, sameSkillDR:true },  // ※Phase2で実装
    cap:{ atk:2500, matk:3500, def:2000, mdef:2500, spd:2500, hp:28000 },
    title:'※後日設定', wip:true },

  { palace:12, name:'【星海】アルレシャ', arch:'arcane', dmg:'hybrid',
    feature:'バフが敵にも適用される／回復すると敵も回復／直前に受けた攻撃タイプで攻撃する',
    mods:{ mirrorBuffs:true, counterByType:true },  // ※Phase3で実装
    cap:{ atk:3000, matk:3000, def:2500, mdef:2500, spd:2500, hp:25000 },
    title:'※後日設定', wip:true },
]

export const TENKYUU_PALACE_COUNT = PALACE_META.length

export const TENKYUU_PALACES = PALACE_META.map(m => ({
  palace: m.palace,
  name: m.name,
  feature: m.feature,
  target: TARGET,
  wip: !!m.wip,
  mods: m.mods || {},
  cap: m.cap || null,
  title: m.title,
  enemy: { ...makeEnemy(m.name, TARGET, m.arch, m.dmg, m.statTweak), kit: m.kit || null, mods: m.mods || {}, cap: m.cap || null },
}))

export const getPalace = (palace) => TENKYUU_PALACES.find(p => p.palace === palace) || null

// レジェンダリー特別称号（12宮制覇・赤文字）。称号内容は後日設定。
export const GRAND_TITLE_NAME = '天穹を統べる者'  // 仮称
export const LEGENDARY_TITLE_NAMES = new Set([GRAND_TITLE_NAME])
