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
//  physTakenMult:0..1          敵が受ける物理ダメージの倍率（将来用）
// passive: パッシブの表示ラベル（ロビー/戦闘開始時に表示）
//
// 【敵スキル】（Hachigoku.jsx の doEnemyTurn が解釈する）
//  skill:    { name, mult, every }  every ターンごとに使う通常スキル（倍率mult・地獄固有の状態異常判定つき）
//  ultimate: { name, mult, hpBelow, ... }  HPがhpBelow以下で1度だけ使う大技。追加効果:
//    inflict:['burn'|'poison'|'paralysis'|'bleed'|'stun']  確定付与（羽衣/紋章耐性/狂信で防げる）
//    critGuaranteed:true   確定クリティカル（黒縄）
//    lifesteal:0..1        この一撃の与ダメ×nを回復（餓鬼）
//    randomAilments:n      ランダムな状態異常をn種付与（鏡獄）
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
    key: 'hyoketsu', name: '氷結地獄', boss: 'マカハドマ', img: null,
    theme: '特殊ダメージ', arch: 'caster', type: 'magical',
    crystals: ['chie', 'tokushu'],
    soul: 'マカハドマの魂', memory: 'マカハドマの記憶',
    desc: '絶対零度の吹雪を操る獄卒。強力な特殊攻撃で凍てつかせる。',
    mods: { onHitAilment: [{ key: 'paralysis', chance: 20 }] },  // 凍結=麻痺として表現
    skill: { name: '氷結波', mult: 1.6, every: 3 },
    ultimate: { name: '摩訶鉢特摩', mult: 3.0, hpBelow: 0.5, inflict: ['paralysis'] },
  },
  {
    key: 'hariyama', name: '針山地獄', boss: 'アシパトラ', img: null,
    theme: '貫通効果', arch: 'pierce', type: 'physical',
    crystals: ['hakou', 'hama'],
    soul: 'アシパトラの魂', memory: 'アシパトラの記憶',
    desc: '刃の翼を持つ獄卒。攻撃は防御を貫通する。',
    mods: { defPen: 0.5 },
    skill: { name: '針山串刺し', mult: 1.6, every: 3 },
    ultimate: { name: '阿尸波多羅', mult: 3.0, hpBelow: 0.5, inflict: ['bleed'] },
  },
  {
    key: 'chiike', name: '血池地獄', boss: 'チボンダラ', img: null,
    theme: '状態異常ダメージ', arch: 'hexer', type: 'physical',
    crystals: ['resshou', 'kashou', 'moudoku'],
    soul: 'チボンダラの魂', memory: 'チボンダラの記憶',
    desc: '血の池から這い出た獄卒。出血・やけど・猛毒を撒き散らす。',
    mods: { onHitAilment: [{ key: 'bleed', chance: 30 }, { key: 'poison', chance: 25 }, { key: 'burn', chance: 20 }] },
    skill: { name: '血池飛沫', mult: 1.6, every: 3 },
    ultimate: { name: '血盆陀羅', mult: 3.0, hpBelow: 0.5, inflict: ['bleed', 'poison'] },
  },
  {
    key: 'gaki', name: '餓鬼地獄', boss: 'プレータ', img: null,
    theme: '吸血効果', arch: 'drainer', type: 'physical',
    crystals: ['bkyuushuu', 'tkyuushuu'],
    soul: 'プレータの魂', memory: 'プレータの記憶',
    desc: '飢えに苦しむ亡者の王。与えた傷からこちらの生気を貪り喰う。',
    mods: { lifesteal: 0.3 },
    skill: { name: '餓鬼の暴食', mult: 1.6, every: 3 },
    ultimate: { name: '薜茘多', mult: 3.0, hpBelow: 0.5, lifesteal: 0.5 },
  },
  {
    key: 'kyokan', name: '叫喚地獄', boss: 'ラウラヴァ', img: null,
    theme: '耐久', arch: 'tank', type: 'physical',
    crystals: ['shugo', 'kouma', 'kaihi'],
    soul: 'ラウラヴァの魂', memory: 'ラウラヴァの記憶',
    desc: '悲鳴を糧に肥え太る巨躯の獄卒。生半可な攻撃は通らない。',
    mods: { flatDR: 0.2 },
    skill: { name: '叫喚の咆哮', mult: 1.6, every: 3 },
    ultimate: { name: '羅宇羅婆', mult: 3.0, hpBelow: 0.5, inflict: ['stun'] },
  },
  {
    key: 'kokujou', name: '黒縄地獄', boss: 'カーラスートラ', img: null,
    theme: 'クリティカル', arch: 'slayer', type: 'physical',
    crystals: ['chimei', 'kaishin', 'kaitai'],
    soul: 'カーラスートラの魂', memory: 'カーラスートラの記憶',
    desc: '黒鉄の縄で罪人を裁く獄卒。急所を的確に打ち抜いてくる。',
    mods: { critBoost: 25, critDmgPlus: 0.5 },
    skill: { name: '黒縄断ち', mult: 1.6, every: 3 },
    ultimate: { name: '迦羅修多羅', mult: 3.0, hpBelow: 0.5, critGuaranteed: true },
  },
  {
    key: 'kyogoku', name: '鏡獄地獄', boss: 'ジョウハリ', img: null,
    theme: '状態異常耐性', arch: 'hexer', type: 'magical',
    crystals: ['boudoku', 'bouma', 'bouka', 'bouketsu', 'bouzetsu'],
    soul: 'ジョウハリの魂', memory: 'ジョウハリの記憶',
    desc: '浄玻璃の鏡に映した罪をあらゆる呪いに変える獄卒。',
    mods: { onHitAilment: [
      { key: 'poison', chance: 20 }, { key: 'paralysis', chance: 15 },
      { key: 'burn', chance: 15 }, { key: 'bleed', chance: 15 }, { key: 'stun', chance: 8 },
    ] },
    skill: { name: '浄玻璃の裁き', mult: 1.6, every: 3 },
    ultimate: { name: '浄玻璃', mult: 3.0, hpBelow: 0.5, randomAilments: 2 },
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
  if (hell.type === 'magical') { matk += atk; atk = 0 }
  else { atk += matk; matk = 0 }
  return {
    name: `${hell.boss}【${diff.label}】`,
    hp, atk, matk, def: s('def'), mdef: s('mdef'), spd: s('spd'),
    type: hell.type,
    mods: hell.mods || {},
    passive: hell.passive || null,
    skill: hell.skill || null,
    ultimate: hell.ultimate || null,
  }
}
