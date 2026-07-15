// ============================================================
// 八獄（はちごく）データ定義
// ------------------------------------------------------------
// ・紋章を育てるための挑戦コンテンツ。8つの地獄×5難易度。
// ・1日3回まで挑戦できる（勝利のみカウント消費・敗北はノーカウント）。
// ・報酬は全て確率制のサーバーRPC（hachigoku_result）で付与:
//     結晶（その地獄に対応する種類からランダム）／紋章の欠片／ボスの魂
//     ＋ Hell初回クリアで「○○の記憶」（紋章LV175→200の上限開放に必要）
// ・現状【is_admin開発限定】で公開
//
// 敵は推奨戦闘力(総合力)ターゲットから決定論的に生成（tenkyuu方式）。
// 総合力 = floor(hp/10 + atk + def + matk + mdef + spd)（敵はMP=0）
//
// 【固有ギミック mods】（Hachigoku.jsx の戦闘エンジンが解釈する）
//  onHitAilment:[{key,chance}] 敵の攻撃命中時に状態異常付与（哭雨の羽衣/紋章耐性で防げる）
//  lifesteal:0..1              敵が与ダメの一定割合を回復（餓鬼）
//  flatDR:0..1                 敵の被ダメ一律軽減（叫喚）※DoTは貫通
//  defPen:0..1                 敵の攻撃がプレイヤー防御を割合無視（針山）
//  critBoost:n                 敵のクリティカル率+n%（黒縄）
//  critDmgPlus:n               敵のクリティカル威力+n（黒縄）
//  specialTakenMult:0..1       敵が受ける特殊（魔法）ダメージの倍率（焦熱=0.5）※DoTは対象外
//  physTakenMult:0..1          敵が受ける物理ダメージの倍率（氷結=0.5）※DoTは対象外
//  dotTakenMult:n              敵が受ける状態異常DoTダメージの倍率（血池=3）
//  selfDefMult:n               敵の防御・特防を常時n倍（針山=3・貫通が有効）
//  defRamp:n                   ターン経過ごとに敵の防御・特防を累積n倍（叫喚=1.2）
//  selfHealMult:n              敵自身の回復量n倍（餓鬼=2）
//  playerHealMult:0..1         プレイヤーの全回復量の倍率（餓鬼=0.5）
//  nonCritMult:0..1            敵のクリティカル以外の与ダメ倍率（黒縄=0.5）
//  mirrorPlayerStats:0..1      プレイヤーの実効ステ(A/B/C/D/S)を×nで自身に反映（HPは難易度準拠・現在未使用の汎用mod）
//  reflectAilments:true        プレイヤーが敵に付与した状態異常を、同じものプレイヤーへ跳ね返す（鏡獄）
//  hybridAttack:true           通常攻撃/スキルがA(攻撃)とC(特攻)の平均を火力に、対プレイヤーは低い方の防御を参照（鏡獄・両刀）
// passive: パッシブの表示ラベル（ロビー/戦闘開始時に表示）
//
// 【敵スキル】（Hachigoku.jsx の doEnemyTurn が解釈する）
//  skill:    { name, mult, every }  every ターンごとに使う通常スキル（倍率mult・地獄固有の状態異常判定つき）
//  ultimate: { name, mult, hpBelow, ... }  HPがhpBelow以下で1度だけ使う大技（必中）。追加効果:
//    inflict:['burn'|'poison'|'paralysis'|'bleed'|'stun']  確定付与（羽衣/紋章耐性/狂信で防げる）
//    critGuaranteed:true   確定クリティカル（黒縄）
//    extraAction:true      大技の直後に確定で追加行動（氷結）
//    pen:0..1              この一撃はプレイヤーの防御・特防をn割合無視
//    selfDefBoost:n        発動後、自身の防御・特防をn倍（針山=3・パッシブ3倍にさらに乗算）
//    bleedStacks:n         出血をnスタック付与（血池）
//    selfHealPct:0..1      発動後、自身の最大HP×nを回復（血池=0.3）
//    permLifesteal:0..1    戦闘終了まで与ダメ×nを回復し続ける（餓鬼=1.0）
//    permBleed:true        戦闘終了まで攻撃命中ごとに出血を確定付与（血池）
//    defGapScale:true      自身と相手の(防御+特防)の差が大きいほど与ダメ増加・最大3倍（叫喚）
//    randomAilments:n      ランダムな状態異常をn種付与（現在未使用の汎用効果）
//    mirrorAllSkills:true  プレイヤーのセット中アクティブスキルを全て撃ち返す（鏡獄）
//    mirrorFrac:n          mirrorAllSkills時の効果倍率（鏡獄=1/4）
// ============================================================

export const HACHIGOKU_DIFFICULTIES = [
  { key: 'easy',    label: 'Easy',    target: 5000,  color: '#66bb66' },
  { key: 'normal',  label: 'Normal',  target: 12000, color: '#4488ff' },
  { key: 'hard',    label: 'Hard',    target: 25000, color: '#ff8844' },
  { key: 'extreme', label: 'EXTREME', target: 40000, color: '#ff4444' },
  { key: 'hell',    label: 'Hell',    target: 60000, color: '#cc44ff' },
]

export const HACHIGOKU_DAILY_WINS = 3  // 1日の勝利回数上限（JST朝5時リセット）

// 与ダメ・敵HPの同率圧縮（全地獄共通・戦闘エンジンが適用）
// プレイヤーの与ダメを×0.7し、敵HPも×0.7 → 撃破ターン数は変わらないが、
// ブラッディロア/紋章吸収などの「与ダメ比例回復」の回復量が3割減る。調整はここ。
export const HACHIGOKU_DMG_COMPRESS = 0.7

// 敵HP倍率（2026-07-14: ×2に増量。推奨戦闘力の表示は据え置き）
export const HACHIGOKU_HP_MULT = 2

// アーキタイプ（hpFrac=HPへ割く総合力の割合、w=残り配分・合計1）
const ARCH = {
  brute:  { hpFrac: 0.38, w: { atk: 0.40, def: 0.18, matk: 0.02, mdef: 0.14, spd: 0.26 } }, // 物理アタッカー
  caster: { hpFrac: 0.32, w: { atk: 0.02, def: 0.14, matk: 0.44, mdef: 0.20, spd: 0.20 } }, // 特殊アタッカー
  pierce: { hpFrac: 0.32, w: { atk: 0.36, def: 0.14, matk: 0.10, mdef: 0.14, spd: 0.26 } }, // 貫通型
  hexer:  { hpFrac: 0.34, w: { atk: 0.24, def: 0.16, matk: 0.20, mdef: 0.18, spd: 0.22 } }, // 状態異常型
  drainer:{ hpFrac: 0.40, w: { atk: 0.30, def: 0.16, matk: 0.14, mdef: 0.16, spd: 0.24 } }, // 吸血型
  tank:   { hpFrac: 0.46, w: { atk: 0.22, def: 0.30, matk: 0.02, mdef: 0.26, spd: 0.20 } }, // 耐久型
  slayer: { hpFrac: 0.30, w: { atk: 0.38, def: 0.12, matk: 0.02, mdef: 0.14, spd: 0.34 } }, // クリティカル型
}

// 8地獄の定義。crystals は emblem.js の EMBLEM_CRYSTALS のキー。
// soul/memory はアイテム名（items テーブルと一致させること）。
export const HACHIGOKU_HELLS = [
  {
    key: 'shonetsu', name: '焦熱地獄', boss: 'ターパナ', img: '/hatigokuta-pana.png',
    theme: '物理ダメージ', arch: 'brute', type: 'physical',
    crystals: ['chikara', 'butsuri'],
    soul: 'ターパナの魂', memory: 'ターパナの記憶',
    desc: '灼熱の業火を纏う獄卒。強烈な物理攻撃とやけどで焼き尽くす。',
    passive: '灼熱の巨躯（受ける特殊ダメージ半減）',
    mods: { onHitAilment: [{ key: 'burn', chance: 30 }], specialTakenMult: 0.5 },
    skill: { name: '焦熱撃', mult: 1.6, every: 3 },
    ultimate: { name: '咤破那', mult: 3.0, hpBelow: 0.5, inflict: ['burn'] },
  },
  {
    key: 'hyoketsu', name: '氷結地獄', boss: 'マカハドマ', img: '/makahadoma.png',
    theme: '特殊ダメージ', arch: 'caster', type: 'magical',
    crystals: ['chie', 'tokushu'],
    soul: 'マカハドマの魂', memory: 'マカハドマの記憶',
    desc: '絶対零度の吹雪を操る獄卒。強力な特殊攻撃で凍てつかせる。',
    passive: '凍魄の鎧（受ける物理ダメージ半減）',
    mods: { onHitAilment: [{ key: 'paralysis', chance: 20 }], physTakenMult: 0.5 },  // 凍結=麻痺として表現
    skill: { name: '氷結波', mult: 1.6, every: 3 },
    ultimate: { name: '摩訶鉢特摩', mult: 3.0, hpBelow: 0.5, inflict: ['paralysis', 'stun'], extraAction: true },
  },
  {
    key: 'hariyama', name: '針山地獄', boss: 'アシパトラ', img: '/asipatora.png',
    theme: '貫通効果', arch: 'pierce', type: 'physical',
    crystals: ['hakou', 'hama'],
    soul: 'アシパトラの魂', memory: 'アシパトラの記憶',
    desc: '刃の翼を持つ獄卒。攻撃は防御を貫通する。',
    passive: '針鉄の甲殻（防御・特防3倍 ※貫通が有効）',
    // ※大技 阿尸波多羅は自身の防御・特防をさらに3倍（合計9倍）にする
    mods: { defPen: 0.5, selfDefMult: 3 },
    skill: { name: '針山串刺し', mult: 1.6, every: 3 },
    ultimate: { name: '阿尸波多羅', mult: 3.0, hpBelow: 0.5, selfDefBoost: 3 },
  },
  {
    key: 'chiike', name: '血池地獄', boss: 'チボンダラ', img: '/tibondara.png',
    theme: '状態異常ダメージ', arch: 'hexer', type: 'physical',
    crystals: ['resshou', 'kashou', 'moudoku'],
    soul: 'チボンダラの魂', memory: 'チボンダラの記憶',
    desc: '血の池から這い出た獄卒。出血・やけど・猛毒を撒き散らす。',
    passive: '血肉の泥躯（受ける通常攻撃・スキルダメージ半減／受ける状態異常ダメージ3倍）',
    mods: {
      onHitAilment: [{ key: 'bleed', chance: 30 }, { key: 'poison', chance: 25 }, { key: 'burn', chance: 20 }],
      physTakenMult: 0.5, specialTakenMult: 0.5, dotTakenMult: 3,
    },
    skill: { name: '血池飛沫', mult: 1.6, every: 3 },
    ultimate: { name: '血盆陀羅', mult: 1.4, hpBelow: 0.5, inflict: ['poison'], bleedStacks: 5, selfHealPct: 0.3, permBleed: true },
  },
  {
    key: 'gaki', name: '餓鬼地獄', boss: 'プレータ', img: '/pure-ta.png',
    theme: '吸血効果', arch: 'drainer', type: 'physical',
    crystals: ['bkyuushuu', 'tkyuushuu'],
    soul: 'プレータの魂', memory: 'プレータの記憶',
    desc: '飢えに苦しむ亡者の王。与えた傷からこちらの生気を貪り喰う。',
    passive: '無底の飢餓（自身の回復2倍／プレイヤーの回復量半減）',
    mods: { lifesteal: 0.3, selfHealMult: 2, playerHealMult: 0.5 },
    skill: { name: '餓鬼の暴食', mult: 1.6, every: 3 },
    ultimate: { name: '薜茘多', mult: 3.0, hpBelow: 0.5, permLifesteal: 1.0 },
  },
  {
    key: 'kyokan', name: '叫喚地獄', boss: 'ラウラヴァ', img: '/raurava.png',
    theme: '耐久', arch: 'tank', type: 'physical',
    crystals: ['shugo', 'kouma', 'kaihi'],
    soul: 'ラウラヴァの魂', memory: 'ラウラヴァの記憶',
    desc: '悲鳴を糧に肥え太る巨躯の獄卒。生半可な攻撃は通らない。',
    passive: '肥大する慟哭（ターン経過ごとに防御・特防1.2倍）',
    mods: { defRamp: 1.2 },
    skill: { name: '叫喚の咆哮', mult: 1.6, every: 3 },
    ultimate: { name: '羅宇羅婆', mult: 3.0, hpBelow: 0.5, defGapScale: true },
  },
  {
    key: 'kokujou', name: '黒縄地獄', boss: 'カーラスートラ', img: '/ka-rasu-tora.png',
    theme: 'クリティカル', arch: 'slayer', type: 'physical',
    crystals: ['chimei', 'kaishin', 'kaitai'],
    soul: 'カーラスートラの魂', memory: 'カーラスートラの記憶',
    desc: '黒鉄の縄で罪人を裁く獄卒。急所を的確に打ち抜いてくる。',
    passive: '断罪の目測り（クリティカル率+50%／クリティカル以外のダメージ半減）',
    mods: { critBoost: 50, nonCritMult: 0.5 },
    skill: { name: '黒縄断ち', mult: 1.6, every: 3 },
    ultimate: { name: '迦羅修多羅', mult: 3.0, hpBelow: 0.5, critGuaranteed: true },
  },
  {
    key: 'kyogoku', name: '鏡獄地獄', boss: 'ジョウハリ', img: '/zyouhari.png',
    theme: '状態異常耐性', arch: 'hexer', type: 'magical',
    crystals: ['boudoku', 'bouma', 'bouka', 'bouketsu', 'bouzetsu'],
    soul: 'ジョウハリの魂', memory: 'ジョウハリの記憶',
    desc: '浄玻璃の鏡に映した罪をあらゆる呪いに変える獄卒。',
    passive: '浄玻璃の鏡映（与えた状態異常をすべて反射する／両刀）',
    dualWield: true,  // A=Cの両刀。通常攻撃はA/C両参照・大技で物理/特殊どちらのスキル反射も機能する
    mods: { onHitAilment: [
      { key: 'poison', chance: 20 }, { key: 'paralysis', chance: 15 },
      { key: 'burn', chance: 15 }, { key: 'bleed', chance: 15 }, { key: 'stun', chance: 8 },
    ], reflectAilments: true, hybridAttack: true },
    skill: { name: '浄玻璃の裁き', mult: 1.6, every: 3 },
    ultimate: { name: '浄玻璃', hpBelow: 0.5, mirrorAllSkills: true, mirrorFrac: 1 / 4 },
  },
]

export const HACHIGOKU_HELL_BY_KEY = Object.fromEntries(HACHIGOKU_HELLS.map(h => [h.key, h]))

// 推奨戦闘力 target を満たす敵ステを生成（決定論的・tenkyuu方式）
export function makeHachigokuEnemy(hellKey, diffKey) {
  const hell = HACHIGOKU_HELL_BY_KEY[hellKey]
  const diff = HACHIGOKU_DIFFICULTIES.find(d => d.key === diffKey)
  if (!hell || !diff) return null
  const a = ARCH[hell.arch]
  const target = diff.target
  const hp = Math.round(target * a.hpFrac) * 10 * HACHIGOKU_HP_MULT
  const budget = target * (1 - a.hpFrac)
  const s = (k) => Math.max(1, Math.round(budget * a.w[k]))
  let atk = s('atk'), matk = s('matk')
  if (hell.dualWield) {
    // 両刀: 攻撃予算を合算し A=C に。総合力は片方ぶんの攻撃として扱う（ハイブリッド攻撃の実効値）
    const both = atk + matk; atk = both; matk = both
  } else if (hell.type === 'magical') { matk += atk; atk = 0 }
  else { atk += matk; matk = 0 }
  return {
    name: `${hell.boss}【${diff.label}】`,
    hp, atk, matk, def: s('def'), mdef: s('mdef'), spd: s('spd'),
    type: hell.type,
    dualWield: !!hell.dualWield,
    mods: hell.mods || {},
    passive: hell.passive || null,
    skill: hell.skill || null,
    ultimate: hell.ultimate || null,
  }
}
