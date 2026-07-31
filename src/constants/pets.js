// ペット種族の定義とステータス計算（ペット画面・ダンジョンで共有）
// 画像(image_url)が未設定のときは emoji を代替表示する。

// ペットのステータス: hp / atk(攻撃 or 特殊攻撃) / def(防御) / mdef(特防)
//  atkType 'phys'=物理(敵のdefで軽減) / 'spec'=特殊(敵のmdefで軽減)
//  被ダメは敵の攻撃タイプに応じて pet.def(物理) / pet.mdef(特殊) で軽減
export const SPECIES = {
  // 総合力を3体で統一（HP10=1点 / 攻・防・特防=各1点 → 合計が一致）。基礎=20点(全員HP20)・成長=4.8点/Lvで全レベル同値
  flame:  { label: 'ヴォル', emoji: '🐺', image: '/voru.png',  starter: true, atkType: 'phys', base: { hp: 20, atk: 10, def: 5, mdef: 3 }, grow: { hp: 6, atk: 2.4, def: 1.1, mdef: 0.7 }, evolve: { label: 'ヴォルガノフ', emoji: '🐺', image: '/voruganohu.png' } },
  aqua:   { label: 'アルル', emoji: '🦊', image: '/aruru.png', starter: true, atkType: 'spec', base: { hp: 20, atk: 10, def: 2, mdef: 6 }, grow: { hp: 4, atk: 2.4, def: 0.8, mdef: 1.2 }, evolve: { label: 'アルミラ',   emoji: '🦊', image: '/arumira.png' } },
  leaf:   { label: 'ドラム', emoji: '🐢', image: '/doramu.png', starter: true, atkType: 'phys', base: { hp: 20, atk: 6,  def: 6, mdef: 6 }, grow: { hp: 8, atk: 1.0, def: 1.5, mdef: 1.5 }, evolve: { label: 'ガルガノス', emoji: '🐢', image: '/garuganos.png' } },
}

export const STARTERS = Object.entries(SPECIES).map(([id, s]) => ({ id, ...s }))

// 現在レベルから次レベルへ上がるのに必要な経験値（レベル×10）。レベルごとに0から貯める
export const expForLevel = (lv) => (lv || 1) * 10
export const MAX_LEVEL = 50            // 進化前のレベル上限（Lv50で進化が必要）
export const MAX_LEVEL_EVOLVED = 400   // 進化後のレベル上限（2026-07-07: 実質無限→400に制定）
export const EVOLVE_LEVEL = 50         // この Lv で進化できる
export const EVOLVE_MULT = 1.5         // 進化時に現在ステを ×1.5
export const EVOLVE_GROW_MULT = 2      // 進化後はレベル成長量 ×2
// レベル上限：進化前は50、進化後は400
export const petMaxLevel = (pet) => (pet?.evolved ? MAX_LEVEL_EVOLVED : MAX_LEVEL)
// 進化可能か（Lv50到達・未進化・進化形が定義されている）
export const canEvolve = (pet) => !!pet && !pet.evolved && (pet.level || 1) >= EVOLVE_LEVEL && !!(SPECIES[pet.species]?.evolve)
// 進化後の名前（未定義なら null）
export const evolvedName = (pet) => SPECIES[pet?.species]?.evolve?.label || null

// 1ステの値を算出。進化後は「Lv50時点ステ×1.5」を基点に、以降は成長量×2でLv100まで伸びる
//  ・未進化: base + grow*(lv-1)
//  ・進化済: (base + grow*49)*1.5 + grow*2*(lv-50)   ← 進化はLv50固定なので「現在ステ×1.5」と一致
function statValue(base, grow, lv, evolved) {
  if (!evolved) return base + grow * (lv - 1)
  const base50 = base + grow * (EVOLVE_LEVEL - 1)
  return base50 * EVOLVE_MULT + grow * EVOLVE_GROW_MULT * Math.max(0, lv - EVOLVE_LEVEL)
}

// ペットの現在ステータス（種族＋レベル＋進化状態）
export function petStats(pet) {
  const sp = SPECIES[pet.species] || SPECIES.flame
  const lv = pet.level || 1
  const evo = !!pet.evolved
  return {
    maxHp:  Math.round(statValue(sp.base.hp,   sp.grow.hp,   lv, evo)),
    atk:    Math.round(statValue(sp.base.atk,  sp.grow.atk,  lv, evo)),
    def:    Math.round(statValue(sp.base.def,  sp.grow.def,  lv, evo)),
    mdef:   Math.round(statValue(sp.base.mdef, sp.grow.mdef, lv, evo)),
    atkType: sp.atkType,
  }
}
export const atkLabel = (pet) => ((SPECIES[pet.species] || SPECIES.flame).atkType === 'spec' ? '特攻' : '攻撃')

// 選択中ペットの本体ステータスをプレイヤー本体ステへ反映する分（常に100%）。
//  ・HP → プレイヤーHP / 防 → 防 / 特防 → 特防
//  ・攻は atkType に応じて 物理=atk / 特殊=matk へ振り分け
//  ・spd はペットに無いため反映なし
// チャーム(charmPlayerBonus)と同じ加算枠で stats.js が合算する。
export function petPlayerBonus(pet) {
  if (!pet || !pet.species) return null
  const st = petStats(pet)
  const isSpec = st.atkType === 'spec'
  return {
    hp:   st.maxHp,
    atk:  isSpec ? 0 : st.atk,
    matk: isSpec ? st.atk : 0,
    def:  st.def,
    mdef: st.mdef,
  }
}

// ペット専用スキル（体当たり時に「選択中スキル」が発動する）
// 種族別の習得テーブル。各種族 Lv3/8/20/50/80/120 で1つずつ習得（たいあたりは全種族Lv1固定）。
// Lvで自動習得。mult=攻撃倍率, hits=攻撃回数, lifesteal=与ダメ回復率, cost=消費満腹度, species=対象種族('all'=全種族)
export const MAX_SKILL_SLOTS = 4  // 持っていけるスキル数（たいあたり固定込み＝実質3つ選べる）
export const SKILL_LEARN_LEVELS = [3, 8, 20, 50, 80, 120, 150, 200, 300]
export const SKILLS = {
  // --- 全種族共通（固定）---
  tackle:        { name: 'たいあたり', species: 'all',   learnLv: 1,   mult: 1.0, hits: 1, cost: 0,  fixed: true, desc: '通常の体当たり（満腹消費なし・固定装備）' },

  // --- 🐺 ヴォル / ヴォルガノフ（物理・牙と爪の狼）---
  voru_bite:     { name: 'かみつき',       species: 'flame', learnLv: 3,   mult: 1.4,  hits: 1, cost: 2,  desc: '鋭い牙で噛みつく一撃（1.4倍／満腹2）' },
  voru_claw:     { name: 'つめ裂き',       species: 'flame', learnLv: 8,   mult: 0.75, hits: 2, cost: 3,  desc: '両の爪で2回引き裂く（各0.75倍／満腹3）' },
  voru_fangrush: { name: '牙突進',         species: 'flame', learnLv: 20,  mult: 1.9,  hits: 1, cost: 5, desc: '牙を剥いて突進する大技（1.9倍／満腹5）' },
  voru_howl:     { name: '遠吠え',         species: 'flame', learnLv: 15,  mult: 0.8,  hits: 1, cost: 3, enemyDebuff: { stat: 'def', turns: 4 }, desc: '敵の防御を30%下げる（4ターン／0.8倍／満腹3）' },
  voru_warcry:   { name: '闘志',           species: 'flame', learnLv: 30,  mult: 0.8,  hits: 1, cost: 4, selfBuff: { kind: 'atkup', turns: 4 }, desc: '自分の攻撃を4ターン上げる（0.8倍／満腹4）' },
  voru_bloodfang:{ name: '月下の吸血牙',   species: 'flame', learnLv: 50,  mult: 1.2,  hits: 1, lifesteal: 0.3, cost: 5, desc: '与ダメの3割を回復する牙（1.2倍／満腹5）' },
  voru_pack:     { name: '群狼乱舞',       species: 'flame', learnLv: 80,  mult: 0.8,  hits: 3, cost: 8, desc: '群れの如く3回連撃（各0.8倍／満腹8）' },
  voru_alpha:    { name: '狼神・絶牙閃',   species: 'flame', learnLv: 120, mult: 3.0,  hits: 1, cost: 12, desc: '狼神の牙を宿す必殺の一撃（3.0倍／満腹12）' },
  voru_bladestorm:{ name: '牙嵐',          species: 'flame', learnLv: 150, mult: 1.8,  hits: 1, aoe: true, cost: 10, desc: '周囲の敵すべてを牙の嵐で切り裂く（1.8倍・周囲全体／満腹10）' },
  voru_bloodmoon:{ name: '真月・吸血牙',   species: 'flame', learnLv: 200, mult: 1.6,  hits: 1, lifesteal: 0.5, cost: 10, desc: '月下の吸血牙の真髄。与ダメの5割を回復（1.6倍／満腹10）' },
  voru_ragnarok: { name: '狼神・絶牙滅閃', species: 'flame', learnLv: 300, mult: 5.0,  hits: 1, cost: 20, desc: '狼神の牙を極めた滅びの一撃（5.0倍／満腹20）' },

  // --- 🦊 アルル / アルミラ（特殊・妖術の狐）---
  aruru_foxfire: { name: 'きつね火',       species: 'aqua',  learnLv: 3,   mult: 1.4,  hits: 1, cost: 2,  desc: '青白い狐火を放つ（1.4倍／満腹2）' },
  aruru_illusion:{ name: '幻惑連弾',       species: 'aqua',  learnLv: 8,   mult: 0.75, hits: 2, cost: 3,  desc: '幻の弾を2連射（各0.75倍／満腹3）' },
  aruru_blaze:   { name: '妖狐の業火',     species: 'aqua',  learnLv: 20,  mult: 1.9,  hits: 1, cost: 5, desc: '妖力の業火で焼く大技（1.9倍／満腹5）' },
  aruru_hex:     { name: '呪詛',           species: 'aqua',  learnLv: 15,  mult: 0.8,  hits: 1, cost: 3, enemyDebuff: { stat: 'atk', turns: 4 }, desc: '敵の攻撃を30%下げる（4ターン／0.8倍／満腹3）' },
  aruru_veil:    { name: '霊力の衣',       species: 'aqua',  learnLv: 30,  mult: 0.8,  hits: 1, cost: 4, selfBuff: { kind: 'shield', turns: 4, rate: 0.7 }, desc: '4ターン被ダメを30%軽減（0.8倍／満腹4）' },
  aruru_drain:   { name: '生命吸収術',     species: 'aqua',  learnLv: 50,  mult: 1.2,  hits: 1, lifesteal: 0.3, cost: 5, desc: '与ダメの3割を吸収する術（1.2倍／満腹5）' },
  aruru_ninetail:{ name: '九尾乱舞',       species: 'aqua',  learnLv: 80,  mult: 0.8,  hits: 3, cost: 8, desc: '九つの尾で3連撃（各0.8倍／満腹8）' },
  aruru_celestial:{ name: '天狐・霊滅閃',  species: 'aqua',  learnLv: 120, mult: 3.0,  hits: 1, cost: 12, desc: '天狐の霊力を放つ必殺技（3.0倍／満腹12）' },
  aruru_foxstorm:{ name: '妖狐乱火',       species: 'aqua',  learnLv: 150, mult: 1.8,  hits: 1, aoe: true, cost: 10, desc: '周囲の敵すべてを妖狐の炎で焼く（1.8倍・周囲全体／満腹10）' },
  aruru_soulfeast:{ name: '真・生命吸収術', species: 'aqua', learnLv: 200, mult: 1.6,  hits: 1, lifesteal: 0.5, cost: 10, desc: '生命吸収術の極み。与ダメの5割を吸収（1.6倍／満腹10）' },
  aruru_novae:   { name: '天狐・霊滅滅閃', species: 'aqua',  learnLv: 300, mult: 5.0,  hits: 1, cost: 20, desc: '天狐の霊力を極めた滅びの一撃（5.0倍／満腹20）' },

  // --- 🐢 ドラム / ガルガノス（物理・大地と甲羅の守護者）---
  doramu_shell:  { name: 'こうら打ち',     species: 'leaf',  learnLv: 3,   mult: 1.4,  hits: 1, cost: 2,  desc: '硬い甲羅を叩きつける（1.4倍／満腹2）' },
  doramu_rock:   { name: '岩石連打',       species: 'leaf',  learnLv: 8,   mult: 0.75, hits: 2, cost: 3,  desc: '岩の拳で2回殴る（各0.75倍／満腹3）' },
  doramu_quake:  { name: '大地割り',       species: 'leaf',  learnLv: 20,  mult: 1.9,  hits: 1, cost: 5, desc: '大地を割る重い一撃（1.9倍／満腹5）' },
  doramu_guard:  { name: '甲羅固め',       species: 'leaf',  learnLv: 15,  mult: 0.6,  hits: 1, cost: 3, selfBuff: { kind: 'shield', turns: 4, rate: 0.6 }, desc: '4ターン被ダメを40%軽減（0.6倍／満腹3）' },
  doramu_crack:  { name: '地崩し',         species: 'leaf',  learnLv: 30,  mult: 0.8,  hits: 1, cost: 4, enemyDebuff: { stat: 'def', turns: 4 }, desc: '敵の防御を30%下げる（4ターン／0.8倍／満腹4）' },
  doramu_counter:{ name: 'グランドドレイン', species: 'leaf',  learnLv: 50,  mult: 1.2,  hits: 1, lifesteal: 0.3, cost: 5, desc: '大地に染みた血を吸い上げ、与ダメの3割を回復（1.2倍／満腹5）' },
  doramu_tremor: { name: '連震撃',         species: 'leaf',  learnLv: 80,  mult: 0.8,  hits: 3, cost: 8, desc: '地響きで3連撃（各0.8倍／満腹8）' },
  doramu_guardian:{ name: '守護神・大地崩撃',species: 'leaf', learnLv: 120, mult: 3.0,  hits: 1, cost: 12, desc: '守護神の力で大地ごと砕く（3.0倍／満腹12）' },
  doramu_quaketremor:{ name: '大震撼',      species: 'leaf',  learnLv: 150, mult: 1.8,  hits: 1, aoe: true, cost: 10, desc: '周囲の敵すべてを大地の揺れで砕く（1.8倍・周囲全体／満腹10）' },
  doramu_worlddrain:{ name: '真・グランドドレイン', species: 'leaf', learnLv: 200, mult: 1.6, hits: 1, lifesteal: 0.5, cost: 10, desc: 'グランドドレインの極み。与ダメの5割を回復（1.6倍／満腹10）' },
  doramu_titan:  { name: '守護神・大地崩滅撃', species: 'leaf', learnLv: 300, mult: 5.0,  hits: 1, cost: 20, desc: '守護神の力を極めた滅びの一撃（5.0倍／満腹20）' },
}
// その種族が持つスキル一覧（たいあたり＋種族スキル。習得Lv順）
export const skillsForSpecies = (species) =>
  Object.entries(SKILLS).filter(([, s]) => s.species === 'all' || s.species === species)
    .map(([id, s]) => ({ id, ...s })).sort((a, b) => a.learnLv - b.learnLv)
// 習得済みスキル（種族＋レベル）
export const learnedSkills = (pet) => skillsForSpecies(pet?.species).filter((s) => s.learnLv <= (pet?.level || 1))
export const getSkill = (id) => SKILLS[id] || SKILLS.tackle

// 追憶の遺跡(d30)の敵定義（出現Fをいじりやすいよう定数化。floorTableで参照する）
const D30E = {
  slime:   { name: 'スライム', type: 'phys', images: ['/suraimu.png', '/suraimu2.png', '/suraimu3.png'], stats: { maxHp: 70, atk: 30, def: 15, mdef: 15 }, skills: [{ name: '溶解液', chance: 0.30, type: 'spec_heavy', mult: 1.4 }] },
  koumori: { name: 'コウモリ', type: 'phys', image: '/koumori.png', stats: { maxHp: 80, atk: 45, def: 22, mdef: 22 } },
  kinoko:  { name: '毒キノコ', type: 'spec', image: '/dokukinoko.png', stats: { maxHp: 104, atk: 60, def: 30, mdef: 30 } },
  goblin:  { name: 'ゴブリン', type: 'phys', image: '/goburin.png', stats: { maxHp: 130, atk: 100, def: 55, mdef: 55 } },
  dog:     { name: '野良犬', type: 'phys', images: ['/norainu1.png', '/norainu2.png'], stats: { maxHp: 130, atk: 100, def: 55, mdef: 55 } },
  touzoku: { name: '盗賊', type: 'phys', image: '/touzoku.png', stats: { maxHp: 150, atk: 110, def: 60, mdef: 60 } },
  kobold:  { name: 'コボルト', type: 'phys', images: ['/koboruto.png', '/koboruto2.png'], stats: { maxHp: 200, atk: 135, def: 81, mdef: 81 }, skills: [
    { name: '乱舞', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '雄叫び', chance: 0.25, type: 'selfbuff' },
    { name: 'すね狙い', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 } ] },
  skelSword: { name: 'スケルトン（剣）', type: 'phys', image: '/sukerutonken.png', stats: { maxHp: 220, atk: 150, def: 90, mdef: 90 }, skills: [
    { name: '重斬り', chance: 0.30, type: 'heavy', mult: 1.5 },
    { name: '骨砕き', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 },
    { name: '呪詛', chance: 0.25, type: 'weaken', stat: 'mdef', turns: 4 } ] },
  skelBow: { name: 'スケルトン（弓）', type: 'phys', image: '/sukerutonyumi.png', stats: { maxHp: 185, atk: 170, def: 70, mdef: 70 }, reach: 2, skills: [
    { name: '連射', chance: 0.30, type: 'heavy', mult: 1.3 },
    { name: '狙い撃ち', chance: 0.25, type: 'heavy', mult: 1.6 },
    { name: '毒矢', chance: 0.25, type: 'poison' } ] },
  golemA: { name: 'ゴーレム（攻）', type: 'spec', image: '/go-remukougeki.png', stats: { maxHp: 235, atk: 210, def: 90, mdef: 90 }, skills: [
    { name: '岩石砲', chance: 0.30, type: 'spec_heavy', mult: 1.5 },
    { name: '地響き', chance: 0.30, type: 'heavy', mult: 1.3 },
    { name: '咆哮', chance: 0.20, type: 'selfbuff' } ] },
  golemD: { name: 'ゴーレム（守）', type: 'phys', image: '/go-remubougyo.png', stats: { maxHp: 360, atk: 120, def: 160, mdef: 160 }, skills: [
    { name: '堅守の構え', chance: 0.30, type: 'selfbuff' },
    { name: '鈍重打', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '防御崩し', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 } ] },
  gyojin: { name: '深海魚人', type: 'spec', image: '/sinkaigyozin.png', stats: { maxHp: 320, atk: 210, def: 140, mdef: 140 }, skills: [
    { name: '水流弾', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: '墨吐き', chance: 0.30, type: 'weaken', stat: 'atk', turns: 4 },
    { name: '再生', chance: 0.25, type: 'vamp', frac: 0.3 } ] },
  pirateM: { name: '海賊（男）', type: 'phys', image: '/kaizokuotoko.png', stats: { maxHp: 350, atk: 231, def: 154, mdef: 140 }, reach: 2, skills: [
    { name: '銃撃', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '鼓舞', chance: 0.25, type: 'selfbuff' },
    { name: '足払い', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 } ] },
  pirateF: { name: '海賊（女）', type: 'spec', image: '/kaizokuonnna.png', stats: { maxHp: 320, atk: 225, def: 135, mdef: 150 }, reach: 2, skills: [
    { name: '魔弾', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: '幻惑', chance: 0.30, type: 'weaken', stat: 'mdef', turns: 4 },
    { name: '治癒', chance: 0.25, type: 'vamp', frac: 0.3 } ] },
  harisen: { name: 'ハリセンボン', type: 'phys', image: '/harisennbonn.png', stats: { maxHp: 300, atk: 220, def: 130, mdef: 130 }, skills: [
    { name: 'どくのハリ', chance: 0.35, type: 'poison' },
    { name: '膨張', chance: 0.25, type: 'selfbuff' },
    { name: '針千本', chance: 0.25, type: 'heavy', mult: 1.5 } ] },
  dokukurage: { name: '毒クラゲ', type: 'spec', image: '/dokukurage.png', stats: { maxHp: 320, atk: 210, def: 140, mdef: 140 }, skills: [
    { name: 'どく', chance: 0.45, type: 'poison' },
    { name: '痺れ毒', chance: 0.25, type: 'paralyze' },
    { name: '溶解', chance: 0.30, type: 'weaken', stat: 'mdef', turns: 4 } ] },
  denkikurage: { name: '電気クラゲ', type: 'spec', image: '/denkikurage.png', stats: { maxHp: 320, atk: 210, def: 140, mdef: 140 }, skills: [
    { name: 'しびれ', chance: 0.30, type: 'paralyze' },
    { name: '放電', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: '帯電', chance: 0.25, type: 'selfbuff' } ] },
}

// 五霊の大峡谷(d60)の敵定義。F1でd30の20F相当の強さ（推奨LV100）→F59でLV330相当。
//  ステはd30同様に固定値（初登場フロア基準）。atkは実戦でENEMY_ATK_MULT(0.8)が掛かる。
//  canSwim: ④の水はAQUATIC名で判定、⑦のマグマは canSwim:true 指定の炎系のみ渡れる
const D60E = {
  // --- ③古代の洞窟系 F1-12（d30と同種族・強化版）---
  kobold:  { name: 'コボルト', type: 'phys', images: ['/koboruto.png', '/koboruto2.png'], stats: { maxHp: 320, atk: 210, def: 140, mdef: 140 }, skills: [
    { name: '乱舞', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '雄叫び', chance: 0.25, type: 'selfbuff' },
    { name: 'すね狙い', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 } ] },
  skelSword: { name: 'スケルトン（剣）', type: 'phys', image: '/sukerutonken.png', stats: { maxHp: 360, atk: 230, def: 155, mdef: 150 }, skills: [
    { name: '重斬り', chance: 0.30, type: 'heavy', mult: 1.5 },
    { name: '骨砕き', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 },
    { name: '呪詛', chance: 0.25, type: 'weaken', stat: 'mdef', turns: 4 } ] },
  skelBow: { name: 'スケルトン（弓）', type: 'phys', image: '/sukerutonyumi.png', stats: { maxHp: 300, atk: 250, def: 120, mdef: 120 }, reach: 2, skills: [
    { name: '連射', chance: 0.30, type: 'heavy', mult: 1.3 },
    { name: '狙い撃ち', chance: 0.25, type: 'heavy', mult: 1.6 },
    { name: '毒矢', chance: 0.25, type: 'poison' } ] },
  golemA: { name: 'ゴーレム（攻）', type: 'spec', image: '/go-remukougeki.png', stats: { maxHp: 400, atk: 280, def: 160, mdef: 160 }, skills: [
    { name: '岩石砲', chance: 0.30, type: 'spec_heavy', mult: 1.5 },
    { name: '地響き', chance: 0.30, type: 'heavy', mult: 1.3 },
    { name: '咆哮', chance: 0.20, type: 'selfbuff' } ] },
  golemD: { name: 'ゴーレム（守）', type: 'phys', image: '/go-remubougyo.png', stats: { maxHp: 560, atk: 190, def: 260, mdef: 260 }, skills: [
    { name: '堅守の構え', chance: 0.30, type: 'selfbuff' },
    { name: '鈍重打', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '防御崩し', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 } ] },
  // --- ④蒼海の入り江系 F13-24 ---
  gyojin: { name: '深海魚人', type: 'spec', image: '/sinkaigyozin.png', stats: { maxHp: 520, atk: 330, def: 220, mdef: 220 }, skills: [
    { name: '水流弾', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: '墨吐き', chance: 0.30, type: 'weaken', stat: 'atk', turns: 4 },
    { name: '再生', chance: 0.25, type: 'vamp', frac: 0.3 } ] },
  pirateM: { name: '海賊（男）', type: 'phys', image: '/kaizokuotoko.png', stats: { maxHp: 580, atk: 360, def: 245, mdef: 220 }, reach: 2, skills: [
    { name: '銃撃', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '鼓舞', chance: 0.25, type: 'selfbuff' },
    { name: '足払い', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 } ] },
  pirateF: { name: '海賊（女）', type: 'spec', image: '/kaizokuonnna.png', stats: { maxHp: 540, atk: 350, def: 215, mdef: 240 }, reach: 2, skills: [
    { name: '魔弾', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: '幻惑', chance: 0.30, type: 'weaken', stat: 'mdef', turns: 4 },
    { name: '治癒', chance: 0.25, type: 'vamp', frac: 0.3 } ] },
  harisen: { name: 'ハリセンボン', type: 'phys', image: '/harisennbonn.png', stats: { maxHp: 620, atk: 380, def: 240, mdef: 240 }, skills: [
    { name: 'どくのハリ', chance: 0.35, type: 'poison' },
    { name: '膨張', chance: 0.25, type: 'selfbuff' },
    { name: '針千本', chance: 0.25, type: 'heavy', mult: 1.5 } ] },
  dokukurage: { name: '毒クラゲ', type: 'spec', image: '/dokukurage.png', stats: { maxHp: 590, atk: 370, def: 250, mdef: 250 }, skills: [
    { name: 'どく', chance: 0.45, type: 'poison' },
    { name: '痺れ毒', chance: 0.25, type: 'paralyze' },
    { name: '溶解', chance: 0.30, type: 'weaken', stat: 'mdef', turns: 4 } ] },
  denkikurage: { name: '電気クラゲ', type: 'spec', image: '/denkikurage.png', stats: { maxHp: 590, atk: 370, def: 250, mdef: 250 }, skills: [
    { name: 'しびれ', chance: 0.30, type: 'paralyze' },
    { name: '放電', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: '帯電', chance: 0.25, type: 'selfbuff' } ] },
  // --- ⑤巨峰山脈系 F25-36 ---
  gobuAxe: { name: '山岳ゴブリン（斧）', type: 'phys', image: '/sangakugobuono.png', stats: { maxHp: 820, atk: 520, def: 340, mdef: 310 }, skills: [
    { name: '斧叩き', chance: 0.30, type: 'heavy', mult: 1.5 },
    { name: '雄叫び', chance: 0.25, type: 'selfbuff' },
    { name: '防具砕き', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 } ] },
  gobuBow: { name: '山岳ゴブリン（弓）', type: 'phys', image: '/sangakugobuyumi.png', stats: { maxHp: 740, atk: 560, def: 290, mdef: 290 }, reach: 2, skills: [
    { name: '狙撃', chance: 0.25, type: 'heavy', mult: 1.6 },
    { name: '連射', chance: 0.30, type: 'heavy', mult: 1.3 },
    { name: '毒矢', chance: 0.25, type: 'poison' } ] },
  gorilla: { name: 'マウンテンゴリラ', type: 'phys', image: '/mauntengorira.png', stats: { maxHp: 1050, atk: 600, def: 380, mdef: 320 }, skills: [
    { name: '剛腕', chance: 0.30, type: 'heavy', mult: 1.6 },
    { name: 'ドラミング', chance: 0.25, type: 'selfbuff' },
    { name: '岩投げ', chance: 0.30, type: 'heavy', mult: 1.3 } ] },
  griffon: { name: 'グリフォン', type: 'phys', image: '/gurihulon.png', stats: { maxHp: 880, atk: 620, def: 330, mdef: 360 }, skills: [
    { name: '急降下', chance: 0.30, type: 'heavy', mult: 1.6 },
    { name: '風の刃', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: 'かく乱', chance: 0.25, type: 'weaken', stat: 'atk', turns: 4 } ] },
  unicorn: { name: '一角獣', type: 'spec', image: '/ikkakuzyuu.png', stats: { maxHp: 920, atk: 570, def: 350, mdef: 430 }, skills: [
    { name: '光の角', chance: 0.30, type: 'spec_heavy', mult: 1.5 },
    { name: '浄化', chance: 0.25, type: 'vamp', frac: 0.3 },
    { name: '魔法障壁', chance: 0.25, type: 'selfbuff' } ] },
  ganseki1: { name: '岩石ゴーレム（古）', type: 'phys', image: '/gannsekigo-remu.png', stats: { maxHp: 1400, atk: 480, def: 520, mdef: 450 }, skills: [
    { name: '堅守の構え', chance: 0.30, type: 'selfbuff' },
    { name: '岩石落とし', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '防御崩し', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 } ] },
  ganseki2: { name: '岩石ゴーレム（新）', type: 'spec', image: '/gansekigo-remumidori.png', stats: { maxHp: 1150, atk: 590, def: 430, mdef: 430 }, skills: [
    { name: '胞子砲', chance: 0.30, type: 'spec_heavy', mult: 1.5 },
    { name: '溶解胞子', chance: 0.30, type: 'weaken', stat: 'mdef', turns: 4 },
    { name: '地響き', chance: 0.25, type: 'heavy', mult: 1.3 } ] },
  // --- ⑥白銀の霊峰系 F37-48 ---
  yeti: { name: '雪男', type: 'phys', image: '/yukiotoko.png', stats: { maxHp: 1500, atk: 850, def: 540, mdef: 480 }, skills: [
    { name: '雪崩拳', chance: 0.30, type: 'heavy', mult: 1.5 },
    { name: '咆哮', chance: 0.25, type: 'selfbuff' },
    { name: '凍てつく打撃', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 } ] },
  icewolf: { name: '氷狼フェンリル', type: 'phys', image: '/koorirou.png', stats: { maxHp: 1350, atk: 920, def: 500, mdef: 470 }, skills: [
    { name: '疾走噛み', chance: 0.30, type: 'heavy', mult: 1.6 },
    { name: '連牙', chance: 0.30, type: 'heavy', mult: 1.3 },
    { name: '遠吠え', chance: 0.25, type: 'selfbuff' } ] },
  yukionna: { name: '雪女', type: 'spec', image: '/yukionna.png', stats: { maxHp: 1280, atk: 880, def: 460, mdef: 620 }, skills: [
    { name: '氷の吐息', chance: 0.30, type: 'paralyze' },
    { name: '冷気弾', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: '呪いの雪', chance: 0.30, type: 'weaken', stat: 'atk', turns: 4 } ] },
  frostSpirit: { name: '霜の精霊', type: 'spec', image: '/simonoseirei.png', stats: { maxHp: 1220, atk: 900, def: 440, mdef: 660 }, skills: [
    { name: '吹雪', chance: 0.30, type: 'spec_heavy', mult: 1.5 },
    { name: '霜の矢', chance: 0.30, type: 'spec_heavy', mult: 1.3 },
    { name: '凍える霧', chance: 0.30, type: 'weaken', stat: 'mdef', turns: 4 } ] },
  iceDragon: { name: '氷河ドラゴン', type: 'phys', image: '/hyougadoragon.png', stats: { maxHp: 1750, atk: 950, def: 620, mdef: 640 }, skills: [
    { name: '氷河ブレス', chance: 0.30, type: 'spec_heavy', mult: 1.5 },
    { name: '尾撃', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '凍結', chance: 0.25, type: 'paralyze' } ] },
  iceGolem: { name: '氷結ゴーレム', type: 'phys', image: '/koorigo-remu.png', stats: { maxHp: 2200, atk: 760, def: 800, mdef: 720 }, skills: [
    { name: '氷壁', chance: 0.30, type: 'selfbuff' },
    { name: '氷塊落とし', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '凍結の腕', chance: 0.25, type: 'paralyze' } ] },
  // --- ⑦煉獄火山系 F49-59（canSwim=マグマを渡れる）---
  hellhound: { name: 'ヘルハウンド', type: 'phys', image: '/heruhaundo.png', stats: { maxHp: 2300, atk: 1250, def: 700, mdef: 640 }, skills: [
    { name: '灼熱牙', chance: 0.30, type: 'heavy', mult: 1.5 },
    { name: '火炎ブレス', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: '咆哮', chance: 0.25, type: 'selfbuff' } ] },
  magmaslime: { name: 'マグマスライム', type: 'spec', image: '/magumasuraimu.png', canSwim: true, stats: { maxHp: 2100, atk: 1200, def: 720, mdef: 720 }, skills: [
    { name: '溶解', chance: 0.30, type: 'spec_heavy', mult: 1.5 },
    { name: '灼熱の飛沫', chance: 0.30, type: 'burn' },
    { name: '膨張', chance: 0.25, type: 'selfbuff' } ] },
  fireSpirit: { name: '炎の精霊', type: 'spec', image: '/honoonoseirei.png', canSwim: true, stats: { maxHp: 2000, atk: 1350, def: 620, mdef: 800 }, skills: [
    { name: '業火', chance: 0.30, type: 'spec_heavy', mult: 1.6 },
    { name: '火炎弾', chance: 0.30, type: 'spec_heavy', mult: 1.3 },
    { name: '灼熱', chance: 0.30, type: 'weaken', stat: 'mdef', turns: 4 } ] },
  firedrake: { name: 'ファイアドレイク', type: 'phys', image: '/faiadoreiku.png', stats: { maxHp: 2700, atk: 1400, def: 780, mdef: 760 }, skills: [
    { name: '業火ブレス', chance: 0.30, type: 'spec_heavy', mult: 1.6 },
    { name: '炎爪', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '火だるま', chance: 0.25, type: 'burn' } ] },
  ifrit: { name: 'イフリート', type: 'spec', image: '/ifuri-to.png', canSwim: true, stats: { maxHp: 2500, atk: 1450, def: 740, mdef: 820 }, skills: [
    { name: '獄炎', chance: 0.30, type: 'spec_heavy', mult: 1.6 },
    { name: '火柱', chance: 0.30, type: 'heavy', mult: 1.4 },
    { name: '業火の吸精', chance: 0.25, type: 'vamp', frac: 0.3 } ] },
  lavaGolem: { name: '溶岩ゴーレム', type: 'phys', image: '/yougango-remu.png', stats: { maxHp: 3400, atk: 1150, def: 950, mdef: 800 }, skills: [
    { name: '溶岩拳', chance: 0.30, type: 'heavy', mult: 1.6 },
    { name: '噴火', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
    { name: '硬化', chance: 0.25, type: 'selfbuff' } ] },
}

// ダンジョン定義（まず2種。requires をクリアすると開放。以降は今後追加）
//  areas: 出現するエリア（深いフロアほど後ろのエリアの敵が出る）
export const DUNGEONS = [
  {
    id: 'd10', name: '初級の洞窟', floors: 10, requires: null, emoji: '🕳', areas: [1, 2], charms: ['antidote', 'guard'],
    floorTable: [
      { from: 1,  to: 2,  enemies: [{ name: 'スライム', type: 'phys', images: ['/suraimu.png', '/suraimu2.png', '/suraimu3.png'], statMult: 0.5 }] },
      { from: 3,  to: 5,  enemies: [{ name: 'スライム', type: 'phys', images: ['/suraimu.png', '/suraimu2.png', '/suraimu3.png'], statMult: 0.5 }, { name: 'コウモリ', type: 'phys', image: '/koumori.png',     statMult: 0.75 }, { name: '毒キノコ', type: 'spec', image: '/dokukinoko.png', statMult: 1.0 }] },
      { from: 6,  to: 7,  enemies: [{ name: 'コウモリ', type: 'phys', image: '/koumori.png',    statMult: 0.75 }, { name: '毒キノコ', type: 'spec', image: '/dokukinoko.png', statMult: 1.0 }, { name: 'ゴブリン', type: 'phys', image: '/goburin.png', statMult: 1.0 }] },
      { from: 8,  to: 10, enemies: [{ name: 'ゴブリン', type: 'phys', image: '/goburin.png', statMult: 1.0 }, { name: '野良犬', type: 'phys', images: ['/norainu1.png', '/norainu2.png'], statMult: 1.0 }, { name: '盗賊', type: 'phys', image: '/touzoku.png', statMult: 1.1 }] },
    ],
  },
  // 追憶の遺跡（30F）。敵は stats を明示指定（フロア式ではなく固定値）。名前の変種ごとにステを変える。
  {
    id: 'd30', name: '追憶の遺跡', floors: 30, requires: 'd10', emoji: '🏛', areas: [1, 2, 3, 4], charms: ['antidote', 'guard'], bgm: '/dungeon_bgm.mp3',
    floorTable: [
      // 敵ごとの出現Fに合わせてバンドを分割（2026-06-14調整）
      // スライム1-5/コウモリ3-5/毒キノコ4-5/ゴブリン6-8/野良犬7-9/盗賊8-9
      { from: 1,  to: 2,  enemies: [D30E.slime] },
      { from: 3,  to: 3,  enemies: [D30E.slime, D30E.koumori] },
      { from: 4,  to: 5,  enemies: [D30E.slime, D30E.koumori, D30E.kinoko] },
      { from: 6,  to: 6,  enemies: [D30E.goblin] },
      { from: 7,  to: 7,  enemies: [D30E.goblin, D30E.dog] },
      { from: 8,  to: 8,  enemies: [D30E.goblin, D30E.dog, D30E.touzoku] },
      { from: 9,  to: 9,  enemies: [D30E.dog, D30E.touzoku] },
      // コボルト10-14/スケルトン剣・弓11-17/ゴーレム攻・守15-19
      { from: 10, to: 10, enemies: [D30E.kobold] },
      { from: 11, to: 14, enemies: [D30E.kobold, D30E.skelSword, D30E.skelBow] },
      { from: 15, to: 17, enemies: [D30E.skelSword, D30E.skelBow, D30E.golemA, D30E.golemD] },
      { from: 18, to: 19, enemies: [D30E.golemA, D30E.golemD] },
      // 深海魚人20-24/海賊男・女21-28/ハリセンボン25-29/毒・電気クラゲ26-29
      { from: 20, to: 20, enemies: [D30E.gyojin] },
      { from: 21, to: 24, enemies: [D30E.gyojin, D30E.pirateM, D30E.pirateF] },
      { from: 25, to: 25, enemies: [D30E.pirateM, D30E.pirateF, D30E.harisen] },
      { from: 26, to: 28, enemies: [D30E.pirateM, D30E.pirateF, D30E.harisen, D30E.dokukurage, D30E.denkikurage] },
      { from: 29, to: 30, enemies: [D30E.harisen, D30E.dokukurage, D30E.denkikurage] }, // 30はボス階で上書き（保険）
    ],
  },
  // 五霊の大峡谷（60F）。エリア③〜⑦の5帯構成＋60Fボス。2026-07-07 一般公開（d30クリアで開放）
  //  推奨LV100（F1）〜LV350目安（60Fボス・チャーム込み）。敵はD60E固定ステ
  {
    id: 'd60', name: '五霊の大峡谷', floors: 60, requires: 'd30', emoji: '⛰',
    areas: [3, 4, 5, 6, 7], charms: ['antidote', 'guard'],
    hint: '推奨LV100〜',
    floorTable: [
      // ③古代の洞窟帯 F1-12
      { from: 1,  to: 2,  enemies: [D60E.kobold] },
      { from: 3,  to: 4,  enemies: [D60E.kobold, D60E.skelSword] },
      { from: 5,  to: 6,  enemies: [D60E.kobold, D60E.skelSword, D60E.skelBow] },
      { from: 7,  to: 9,  enemies: [D60E.skelSword, D60E.skelBow, D60E.golemA] },
      { from: 10, to: 12, enemies: [D60E.skelBow, D60E.golemA, D60E.golemD] },
      // ④蒼海の入り江帯 F13-24（水たまり＝AQUATICの敵のみ泳げる）
      { from: 13, to: 14, enemies: [D60E.gyojin] },
      { from: 15, to: 17, enemies: [D60E.gyojin, D60E.pirateM, D60E.pirateF] },
      { from: 18, to: 19, enemies: [D60E.pirateM, D60E.pirateF, D60E.harisen] },
      { from: 20, to: 22, enemies: [D60E.harisen, D60E.dokukurage, D60E.denkikurage] },
      { from: 23, to: 24, enemies: [D60E.pirateM, D60E.harisen, D60E.dokukurage, D60E.denkikurage] },
      // ⑤巨峰山脈帯 F25-36
      { from: 25, to: 26, enemies: [D60E.gobuAxe] },
      { from: 27, to: 28, enemies: [D60E.gobuAxe, D60E.gobuBow] },
      { from: 29, to: 30, enemies: [D60E.gobuAxe, D60E.gobuBow, D60E.gorilla] },
      { from: 31, to: 32, enemies: [D60E.gobuBow, D60E.gorilla, D60E.griffon] },
      { from: 33, to: 34, enemies: [D60E.gorilla, D60E.griffon, D60E.unicorn] },
      { from: 35, to: 36, enemies: [D60E.griffon, D60E.unicorn, D60E.ganseki1, D60E.ganseki2] },
      // ⑥白銀の霊峰帯 F37-48
      { from: 37, to: 38, enemies: [D60E.yeti] },
      { from: 39, to: 40, enemies: [D60E.yeti, D60E.icewolf] },
      { from: 41, to: 42, enemies: [D60E.yeti, D60E.icewolf, D60E.yukionna] },
      { from: 43, to: 44, enemies: [D60E.icewolf, D60E.yukionna, D60E.frostSpirit] },
      { from: 45, to: 46, enemies: [D60E.yukionna, D60E.frostSpirit, D60E.iceDragon] },
      { from: 47, to: 48, enemies: [D60E.frostSpirit, D60E.iceDragon, D60E.iceGolem] },
      // ⑦煉獄火山帯 F49-59（マグマ＝canSwim指定の炎系のみ渡れる）
      { from: 49, to: 50, enemies: [D60E.hellhound] },
      { from: 51, to: 52, enemies: [D60E.hellhound, D60E.magmaslime] },
      { from: 53, to: 54, enemies: [D60E.hellhound, D60E.magmaslime, D60E.fireSpirit] },
      { from: 55, to: 56, enemies: [D60E.magmaslime, D60E.fireSpirit, D60E.firedrake] },
      { from: 57, to: 58, enemies: [D60E.fireSpirit, D60E.firedrake, D60E.ifrit] },
      { from: 59, to: 60, enemies: [D60E.firedrake, D60E.ifrit, D60E.lavaGolem] }, // 60はボス階で上書き（保険）
    ],
  },
]
export const getDungeon = (id) => DUNGEONS.find((d) => d.id === id) || DUNGEONS[0]

// ボス階判定（d30=30F デビルパピア / d60=60F カモルス）
export const isBossFloor = (dungeonId, floor) =>
  (dungeonId === 'd30' && floor === 30) || (dungeonId === 'd60' && floor === 60)
// 30Fボス：デビルパピア（2×2・移動する・2段階）。第2形態はHP全回復・防御down/攻撃up・物理特殊ミックス
export const DEVIL_PAPIA = {
  name: 'デビルパピア', size: 2,
  phases: [
    { // 第1形態：防御寄り。物理攻撃＋自己防御バフ
      label: '第1形態', barColor: '#ff8844',
      hp: 1200, atk: 160, def: 220, mdef: 180, type: 'phys', image: '/debirupapia1.png',
      skills: [
        { name: '守りの構え', chance: 0.35, type: 'selfbuff' },
        { name: '魔爪', chance: 0.30, type: 'heavy', mult: 1.4 },
        { name: '威圧', chance: 0.25, type: 'weaken', stat: 'atk', turns: 4 },
      ],
    },
    { // 第2形態：防御down・攻撃大幅up。物理＋特殊ミックス
      label: '第2形態', barColor: '#ff4488', visualScale: 1.45, // 全身像なので拡大表示（判定は2×2のまま）
      hp: 3000, atk: 260, def: 160, mdef: 150, type: 'phys', mix: true, image: '/debirupapia2.png',
      transition: { during: '💀 デビルパピアが力を取り戻していく…！', after: '💀 デビルパピア 第2形態！' },
      // HP50%以下で与ダメ1.2倍の怒りバフを1度だけ自身に付与。
      // HP30%以下で「復讐」解禁＋1度だけ最大HP30%回復（2026-07-07仕様変更）
      rageAt: 0.5, rageMult: 1.2,
      lowHpAt: 0.3,
      lowHpSkill: { name: '復讐', chance: 0.45, type: 'spec_heavy', mult: 2.2 },
      reviveHealPct: 0.30,
      skills: [
        { name: '冥撃', chance: 0.30, type: 'heavy', mult: 1.5 },
        { name: '魔煉弾', chance: 0.30, type: 'spec_heavy', mult: 1.4 },
        { name: '呪詛', chance: 0.25, type: 'weaken', stat: 'def', turns: 4 },
        { name: '狂乱', chance: 0.20, type: 'selfbuff' },
      ],
    },
  ],
}
// 60Fボス：カモルス・V・ナスB=パピア（2×2・3段階）。
//  画像はレイヤー分解アニメ（Boss60Sprite）。形態はCSSフィルターで色味変化（layeredプロパティで判別）
//  難易度目安: LV350＋チャームで討伐。総HP32000・後半ほど防御が下がり攻撃が上がる
export const KAMORUSU = {
  name: 'カモルス・V・ナスB=パピア', size: 2, layered: true, visualScale: 1.7, // 判定2×2のまま見た目だけ拡大（足元基準）
  phases: [
    { // 第1形態：装甲形態。超防御・物理砲撃
      label: '装甲形態', barColor: '#ffd257',
      hp: 10000, atk: 900, def: 2400, mdef: 2000, type: 'phys',
      skills: [
        { name: '重装砲撃', chance: 0.30, type: 'heavy', mult: 1.5 },
        { name: '守護結界', chance: 0.30, type: 'selfbuff' },
        { name: 'クリスタル閃光', chance: 0.25, type: 'weaken', stat: 'atk', turns: 4 },
        { name: 'ビット射出', chance: 0.30, type: 'spec_heavy', mult: 1.3 },
      ],
    },
    { // 第2形態：限界解放。物理特殊ミックス・自己修復
      label: '限界解放', barColor: '#66ccff',
      hp: 13000, atk: 1150, def: 1800, mdef: 1800, type: 'phys', mix: true,
      transition: { during: '⚙ カモルスの装甲が展開し、クリスタルが輝き出す…！', after: '💠 カモルス・V・ナスB=パピア 限界解放！' },
      skills: [
        { name: '星片乱舞', chance: 0.30, type: 'heavy', mult: 1.4 },
        { name: '蒼晶レーザー', chance: 0.30, type: 'spec_heavy', mult: 1.6 },
        { name: '威圧', chance: 0.25, type: 'weaken', stat: 'def', turns: 4 },
        { name: '自己修復', chance: 0.25, type: 'vamp', frac: 0.3 },
      ],
    },
    { // 第3形態：コア暴走。防御ダウン・攻撃特化＋低HPで大技
      label: 'コア暴走', barColor: '#ff4455',
      hp: 9000, atk: 1400, def: 1100, mdef: 1300, type: 'phys', mix: true,
      transition: { during: '💥 装甲が砕け散り、コアが露出した…！', after: '🔥 コア暴走——最終形態！' },
      lowHpSkill: { name: 'ジャッジメント', chance: 0.45, type: 'spec_heavy', mult: 2.2 },
      reviveHealPct: 0.25,
      skills: [
        { name: '終焉光', chance: 0.30, type: 'heavy', mult: 1.6 },
        { name: '崩壊レーザー', chance: 0.30, type: 'spec_heavy', mult: 1.5 },
        { name: '電磁拘束', chance: 0.25, type: 'paralyze' },
        { name: '崩壊の呪縛', chance: 0.25, type: 'weaken', stat: 'def', turns: 4 },
      ],
    },
  ],
}
// ダンジョンIDからボス定義を返す
export const bossFor = (dungeonId) => (dungeonId === 'd60' ? KAMORUSU : DEVIL_PAPIA)

// 敵スキル（攻撃時に確率で発動）。type: poison=毒付与 / heavy=ダメージ倍率 / vamp=与ダメの一部を自己回復
//  ※毒キノコは毒、盗賊は2つ持ち。名前で引くので敵定義側は変更不要
export const ENEMY_SKILLS = {
  'コウモリ': [{ name: 'きゅうけつ', chance: 0.30, type: 'vamp', frac: 0.3 }, { name: 'かく乱', chance: 0.30, type: 'weaken', stat: 'atk', turns: 4 }],
  '毒キノコ': [{ name: 'どくのこな', chance: 0.45, type: 'poison' }, { name: '溶解胞子', chance: 0.30, type: 'weaken', stat: 'mdef', turns: 4 }],
  'ゴブリン': [{ name: 'つよ打ち',   chance: 0.30, type: 'heavy', mult: 1.5 }],
  '野良犬':   [{ name: 'かみつき',   chance: 0.30, type: 'heavy', mult: 1.4 }, { name: 'いかく', chance: 0.30, type: 'weaken', stat: 'def', turns: 4 }],
  '盗賊':     [{ name: 'ふいうち',   chance: 0.25, type: 'heavy', mult: 1.6 }, { name: 'どくナイフ', chance: 0.20, type: 'poison' }],
}
export const enemySkillsFor = (name) => ENEMY_SKILLS[name] || []
// 毒：POISON_INTERVAL ターンごとに最大HPの POISON_PCT を失う（次フロアで回復）
export const POISON_INTERVAL = 10
export const POISON_PCT = 0.02

// 敵の表示画像を決める（images配列があればランダムで1枚、無ければimage、どちらも無ければnull）
export function pickEnemyImage(kind) {
  const img = kind?.images?.length ? kind.images[Math.floor(Math.random() * kind.images.length)] : (kind?.image || null)
  return assetSrc(img)
}

export function enemiesForFloor(dungeon, floor) {
  if (dungeon?.floorTable) {
    const row = dungeon.floorTable.find((r) => floor >= r.from && floor <= r.to)
    if (row) return row.enemies
  }
  return AREA_ENEMIES[areaForFloor(dungeon, floor)] || AREA_ENEMIES[1]
}

// エリア①〜④の敵（既存ゲームのキャラ名を流用。type: phys=物理 / spec=特殊）
// ステータスはダンジョン用に dungeonEnemyStats でフロア深度に応じてスケールする
export const AREA_ENEMIES = {
  1: [{ name: 'スライム', type: 'phys', images: ['/suraimu.png', '/suraimu2.png', '/suraimu3.png'] }, { name: 'コウモリ', type: 'phys', image: '/koumori.png' }, { name: '毒キノコ', type: 'spec', image: '/dokukinoko.png' }],
  2: [{ name: 'ゴブリン', type: 'phys', image: '/goburin.png' }, { name: '野良犬', type: 'phys', images: ['/norainu1.png', '/norainu2.png'] }, { name: '盗賊', type: 'phys', image: '/touzoku.png' }],
  3: [{ name: 'コボルト', type: 'phys' }, { name: 'スケルトン', type: 'phys' }, { name: 'ゴーレム', type: 'phys' }],
  4: [{ name: '深海魚人', type: 'phys' }, { name: '海賊', type: 'phys' }, { name: '毒クラゲ', type: 'spec' }],
}

// そのフロアで出現するエリアID（浅い→areas先頭、深い→後ろ）
export function areaForFloor(dungeon, floor) {
  const areas = dungeon?.areas || [1]
  const idx = Math.min(areas.length - 1, Math.floor(((floor - 1) / Math.max(1, (dungeon?.floors || 10))) * areas.length))
  return areas[idx]
}

// その敵が最初に出現するフロア（floorTableの先頭から探す）。
// 敵の強さは「初登場フロアの値」で固定する（深い階でも同種は同じ強さ）
export function enemyFirstFloor(dungeon, name) {
  if (dungeon?.floorTable) {
    for (const row of dungeon.floorTable) {
      if ((row.enemies || []).some((e) => e.name === name)) return row.from
    }
  }
  return 1
}
// 種族ごとの実ステータス（初登場フロア基準＋種族倍率を適用）
// ※敵の攻撃力は全体調整で ENEMY_ATK_MULT を掛ける
const ENEMY_ATK_MULT = 0.8 // 2026-06: 敵の攻撃力を一律20%ダウン
export function dungeonEnemyStatsFor(dungeon, kind) {
  // stats を明示指定している敵（追憶の遺跡など）はその固定値を使う
  if (kind?.stats) {
    return { maxHp: kind.stats.maxHp, atk: Math.round(kind.stats.atk * ENEMY_ATK_MULT), def: kind.stats.def, mdef: kind.stats.mdef }
  }
  const ff = enemyFirstFloor(dungeon, kind?.name)
  const es = dungeonEnemyStats(ff, areaForFloor(dungeon, ff))
  const m = kind?.statMult ?? 1.0
  return {
    maxHp: Math.round(es.maxHp * m),
    atk:   Math.round(es.atk * m * ENEMY_ATK_MULT),
    def:   Math.round(es.def * m),
    mdef:  Math.round(es.mdef * m),
  }
}

// 敵ステータス（フロア深度＋エリア段階でスケール）。何度か挑戦してクリアする難度想定。
//  ※数値はバランス調整ポイント。きつ/緩は係数を変えるだけ。
export function dungeonEnemyStats(floor, areaId) {
  const t = areaId || 1
  return {
    maxHp: Math.round((22 + floor * 8 + t * t * 9) * 0.8), // 2026-06-11調整: HP20%ダウン
    atk:   Math.round(7 + floor * 2.4 + t * t * 2),
    def:   Math.round(2 + floor * 1.1 + t * 2),
    mdef:  Math.round(2 + floor * 1.1 + t * 2),
  }
}

// アイテム袋の上限（潜る前の所持：だっしゅつの翼以外の合計）。ダンジョン中は別途20まで
// 基本20＋「初めて踏破したダンジョン1種につき+10」（サーバー pet_bag_capacity と一致させること）
export const INV_MAX = 20
export const BAG_PER_DUNGEON = 10
// クリア済みダンジョン種類数から袋容量を算出
export function bagCapacity(clearedDungeonCount) {
  return INV_MAX + BAG_PER_DUNGEON * (clearedDungeonCount || 0)
}
// ペットアイテム定義（価格はサーバーRPC pet_item_price と一致させること）
//  dungeon=true: ダンジョンで使用可能 / capped=true: アイテム袋の上限(INV_MAX)の対象（だっしゅつの翼以外すべて）
export const PET_ITEMS = {
  escape:  { key: 'escape',  name: 'だっしゅつの翼',   emoji: '🪽', price: 500,   dungeon: true,  capped: false, desc: 'ダンジョンからいつでも脱出（使い切り・袋の対象外）' },
  onigiri: { key: 'onigiri', name: 'おにぎり',         emoji: '🍙', price: 200,   dungeon: true,  capped: true, fullness: 50, desc: '満腹度を50回復' },
  konomi:  { key: 'konomi',  name: '木の実',           emoji: '🍒', price: 300,   dungeon: true,  capped: true, healPct: 0.2, desc: '最大HPの20%を回復' },
  // おいしい系（d60のF25以降で食料抽選時5%。ドロップ専用・非売品）
  oishii_onigiri: { key: 'oishii_onigiri', name: 'おいしいおにぎり', emoji: '🍱', price: 0, dungeon: true, capped: true, noShop: true, fullness: 100, desc: '満腹度を100回復' },
  oishii_konomi:  { key: 'oishii_konomi',  name: 'おいしい木の実',   emoji: '🍎', price: 0, dungeon: true, capped: true, noShop: true, healPct: 0.35, desc: '最大HPの35%を回復' },
  rename:  { key: 'rename',  name: 'ニックネーム変更券', emoji: '🎫', price: 100000, dungeon: false, capped: true,  desc: 'ペットの名前を変更できる' },
  shard:   { key: 'shard',   name: '神秘の欠片',       emoji: '🔮', price: 0, dungeon: false, capped: true, noShop: true, desc: 'チャーム合成に使う（30Fボス討伐でドロップ）' },
  fatecore:{ key: 'fatecore', name: 'フェイトコア',     emoji: '🧬', price: 0, dungeon: false, capped: true, noShop: true, desc: 'チャーム/リボンの特殊能力を再抽選する（60Fボス討伐でドロップ）' },
  // チャーム強化用の素（ダンジョンで拾う。チャームページで使用）
  atk_seed:   { key: 'atk_seed',   name: '攻撃の素',  emoji: '🔴', img: '/kougekimoto.png',     price: 0, dungeon: false, capped: true, seed: 'atk',   up: 1,  desc: 'チャームの攻撃を+1' },
  spatk_seed: { key: 'spatk_seed', name: '特攻の素',  emoji: '🟣', img: '/tokukoumoto.png',     price: 0, dungeon: false, capped: true, seed: 'spatk', up: 1,  desc: 'チャームの特攻を+1' },
  def_seed:   { key: 'def_seed',   name: '防御の素',  emoji: '🔵', img: '/bougyomoto.png',      price: 0, dungeon: false, capped: true, seed: 'def',   up: 1,  desc: 'チャームの防御を+1' },
  spdef_seed: { key: 'spdef_seed', name: '特防の素',  emoji: '🟢', img: '/mahoubougyomoto.png', price: 0, dungeon: false, capped: true, seed: 'spdef', up: 1,  desc: 'チャームの特防を+1' },
  hp_seed:    { key: 'hp_seed',    name: 'HPの素',    emoji: '🟡', img: '/HPmoto.png',         price: 0, dungeon: false, capped: true, seed: 'hp',    up: 5,  desc: 'チャームのHPを+5（消費1）' },
  // ゼニ（ペットダンジョン限定通貨。倉庫表示用。持ち込み/購入不可＝pet_item_priceに登録しない）
  zeni: { key: 'zeni', name: 'ゼニ', emoji: '🪙', img: '/zeni.png', price: 0, dungeon: false, capped: false, noShop: true, desc: 'ペットダンジョン限定の貨幣。ダンジョン内で拾い、秘密の商店で使う' },
  // 凝縮された素（リボン強化用。○○の素10個をチャームページで合成して作る）
  atk_seed_c:   { key: 'atk_seed_c',   name: '凝縮された攻撃の素', emoji: '🟥', img: '/kougekimoto_c.png', price: 0, dungeon: false, capped: true, noShop: true, cseed: 'atk',   up: 1, desc: 'リボンの攻撃を+1（攻撃の素10個から合成）' },
  spatk_seed_c: { key: 'spatk_seed_c', name: '凝縮された特攻の素', emoji: '🟪', img: '/tokukoumoto_c.png', price: 0, dungeon: false, capped: true, noShop: true, cseed: 'spatk', up: 1, desc: 'リボンの特攻を+1（特攻の素10個から合成）' },
  def_seed_c:   { key: 'def_seed_c',   name: '凝縮された防御の素', emoji: '🟦', img: '/bougyomoto_c.png', price: 0, dungeon: false, capped: true, noShop: true, cseed: 'def',   up: 1, desc: 'リボンの防御を+1（防御の素10個から合成）' },
  spdef_seed_c: { key: 'spdef_seed_c', name: '凝縮された特防の素', emoji: '🟩', img: '/mahoubougyomoto_c.png', price: 0, dungeon: false, capped: true, noShop: true, cseed: 'spdef', up: 1, desc: 'リボンの特防を+1（特防の素10個から合成）' },
  hp_seed_c:    { key: 'hp_seed_c',    name: '凝縮されたHPの素',   emoji: '🟨', img: '/HPmoto_c.png', price: 0, dungeon: false, capped: true, noShop: true, cseed: 'hp',    up: 5, desc: 'リボンのHPを+5（HPの素10個から合成）' },
}

// ============================================================
// スキルの書（消費アイテム）。使うとそのスキルを発動して消費。
//  威力 = ペットLv × 2 × mult（ヒットごと）。本編skillsテーブルの倍率/効果に準拠。
//  target: 'enemy'=対象1体 / 'aoe'=周囲(8マス)全体 / 'self'=自分(バフ)
//  range=届くマス数 / diag=斜め判定あり / hits=ヒット数
//  効果: drain=与ダメ割合を回復 / recoil=与ダメ割合の反動 / stun=敵を確率で1ターン行動不能
//        dice=[min,max]の乱数倍率 / shieldRate+shieldTurns=被ダメ軽減バフ / regenPct+regenTurns=毎ターン回復
// ============================================================
export const SCROLLS = {
  scr_iai:    { name: '居合斬',       emoji: '🗡️', mult: 1.5, hits: 1, range: 1, diag: true, target: 'enemy' },
  scr_sutemi: { name: 'すてみ',       emoji: '💢', mult: 1.8, hits: 1, range: 1, diag: true, target: 'enemy', recoil: 0.2 },
  scr_sanren: { name: '三連射',       emoji: '🏹', mult: 0.6, hits: 3, range: 2, diag: true, target: 'enemy' },
  scr_shunpo: { name: '瞬歩瞬殺',     emoji: '🥷', mult: 1.5, hits: 1, range: 1, diag: true, target: 'enemy' },
  scr_quake:  { name: 'アースクエイク', emoji: '🌎', mult: 1.6, hits: 1, range: 1, diag: true, target: 'aoe' },
  scr_soul:   { name: 'ソウルドレイン', emoji: '👻', mult: 1.4, hits: 1, range: 1, diag: true, target: 'enemy', drain: 0.3 },
  scr_inori:  { name: '祈りの結界',   emoji: '🙏', target: 'self', shieldRate: 0.7, shieldTurns: 4 },
  scr_sabaki: { name: '聖なる裁き',   emoji: '⚖️', mult: 1.9, hits: 1, range: 1, diag: true, target: 'enemy' },
  scr_kori:   { name: '氷の障壁',     emoji: '🧊', target: 'self', shieldRate: 0.6, shieldTurns: 4 },
  scr_mind:   { name: 'マインドブレイク', emoji: '🧠', mult: 1.9, hits: 1, range: 1, diag: true, target: 'enemy', stun: 0.4 },
  scr_goren:  { name: '五連殺',       emoji: '⚔️', mult: 0.3, hits: 5, range: 1, diag: true, target: 'enemy' },
  scr_gun:    { name: '連装銃撃',     emoji: '🔫', mult: 0.5, hits: 4, range: 2, diag: true, target: 'enemy' },
  scr_dice:   { name: 'ラッキーダイス', emoji: '🎲', hits: 1, range: 1, diag: true, target: 'enemy', dice: [0.9, 2.4] },
  scr_raikou: { name: '雷光斬',       emoji: '⚡', mult: 1.7, hits: 1, range: 1, diag: true, target: 'enemy', stun: 0.3 },
  scr_seiiki: { name: '聖域展開',     emoji: '🕊️', target: 'self', regenPct: 0.1, regenTurns: 4, shieldRate: 0.8, shieldTurns: 4 },
  scr_dragon: { name: 'ドラゴンスラスト', emoji: '🐉', mult: 1.5, hits: 1, range: 1, diag: true, target: 'enemy' },
  // 書が無かった9クラス分を追加（2026-07-07。これで全25クラスの書が揃った）
  scr_kyogeki:   { name: '強撃',           emoji: '💥', mult: 1.7, hits: 1, range: 1, diag: true, target: 'enemy' },              // 戦士
  scr_kantsu:    { name: '貫通射撃',       emoji: '🎯', mult: 1.4, hits: 1, range: 2, diag: true, target: 'enemy' },              // 弓使い
  scr_thunder:   { name: 'サンダー',       emoji: '🌩️', mult: 1.4, hits: 1, range: 2, diag: true, target: 'enemy', stun: 0.25 }, // 魔法使い
  scr_heal:      { name: 'ヒール',         emoji: '💚', target: 'self', healPct: 0.35 },                                          // 僧侶
  scr_bakuretsu: { name: '爆裂拳',         emoji: '👊', mult: 0.9, hits: 2, range: 1, diag: true, target: 'enemy' },              // 格闘家
  scr_mure:      { name: '群れの号令',     emoji: '🐺', mult: 0.55, hits: 3, range: 1, diag: true, target: 'enemy' },             // サモナー
  scr_salamand:  { name: 'サラマンド',     emoji: '🔥', mult: 1.5, hits: 1, range: 2, diag: true, target: 'enemy' },              // 精霊召喚士
  scr_kamioroshi:{ name: '禁術・神降ろし', emoji: '⛩️', mult: 1.8, hits: 1, range: 1, diag: true, target: 'enemy' },             // 式神使い
  scr_yatchae:   { name: 'やっちゃえ！',   emoji: '🐾', mult: 2.0, hits: 1, range: 1, diag: true, target: 'enemy' },              // ブリーダー
}
export const SCROLL_KEYS = Object.keys(SCROLLS)
export const getScroll = (key) => SCROLLS[key]
// アイテムのアイコン画像src（img指定がある素などは画像、無ければnull→絵文字表示）
export const petItemImg = (key) => assetSrc(PET_ITEMS[key]?.img || null)
function scrollDesc(s) {
  if (s.target === 'self') {
    const parts = []
    if (s.shieldRate) parts.push(`${s.shieldTurns}ターン被ダメ${Math.round((1 - s.shieldRate) * 100)}%減`)
    if (s.regenPct) parts.push(`${s.regenTurns}ターン毎ターン最大HP${Math.round(s.regenPct * 100)}%回復`)
    if (s.healPct) parts.push(`最大HPの${Math.round(s.healPct * 100)}%を即時回復`)
    return parts.join('・')
  }
  const tgt = s.target === 'aoe' ? '周囲の敵全体' : `${s.range}マス先まで(斜め可)の敵1体`
  const pow = s.dice ? 'ランダム威力' : `威力LV×5${s.hits > 1 ? `×${s.hits}回` : ''}`
  const ex = [s.drain ? `与ダメの${Math.round(s.drain * 100)}%回復` : '', s.recoil ? `反動${Math.round(s.recoil * 100)}%` : '', s.stun ? `${Math.round(s.stun * 100)}%でしびれ` : ''].filter(Boolean).join('・')
  return `${tgt}に${pow}${ex ? '／' + ex : ''}`
}
// スキルの書をアイテム化して PET_ITEMS に統合（ダンジョンで拾って使う消費アイテム）
//  アイコンは全書共通の魔導書画像（sukirunosyo.png）。絵文字はログ・発動演出用に残す
for (const [k, s] of Object.entries(SCROLLS)) {
  PET_ITEMS[k] = { key: k, name: `${s.name}の書`, emoji: s.emoji, img: '/sukirunosyo.png', price: 0, dungeon: true, capped: true, scroll: true, desc: scrollDesc(s) }
}

export const SHOP_ITEMS = Object.values(PET_ITEMS).filter((i) => !i.seed && !i.scroll && !i.noShop)   // 商店は素・スキルの書・神秘の欠片を除く
export const SEED_ITEMS = Object.values(PET_ITEMS).filter((i) => i.seed)
export const DUNGEON_ITEMS = Object.values(PET_ITEMS).filter((i) => i.dungeon)
export const CAPPED_ITEMS = Object.values(PET_ITEMS).filter((i) => i.capped)

// チャーム定義。effect: null=なし / 'antidote'=毒確率50%減 / 'guard'=防御+10%
// 強化は「素の合計使用数」が CHARM_TOTAL_MAX(150) まで。各素は消費1。HPの素のみ1個=HP+5、他は1個=+1
export const CHARM_TOTAL_MAX = 150
export const CHARM_HP_PER = 5
export const CHARM_STATS = ['hp', 'atk', 'spatk', 'def', 'spdef']
export const CHARMS = {
  hajimari: { type: 'hajimari', name: 'はじまりのチャーム', emoji: '🔰', effect: null,       short: 'はじまり', desc: '追加能力なし' },
  antidote: { type: 'antidote', name: '解毒のチャーム',     emoji: '🧪', effect: 'antidote', short: '解毒', minFloor: 1,  desc: '毒になる確率が50%減る' },
  guard:    { type: 'guard',    name: '防御のチャーム',     emoji: '🛡️', effect: 'guard',    short: '防御', minFloor: 1,  desc: '防御+10%' },
  mdefup:   { type: 'mdefup',   name: 'とくぼうのチャーム', emoji: '🟩', effect: 'mdefup',   short: '特防', minFloor: 1,  desc: '特防+10%' },
  atkup:    { type: 'atkup',    name: '攻撃のチャーム',     emoji: '🟥', effect: 'atkup',    short: '攻撃', minFloor: 10, desc: '攻撃+10%' },
  spatkup:  { type: 'spatkup',  name: 'とくこうのチャーム', emoji: '🟪', effect: 'spatkup',  short: '特攻', minFloor: 10, desc: '特攻+10%' },
  evade:    { type: 'evade',    name: '回避のチャーム',     emoji: '💨', effect: 'evade',    short: '回避', minFloor: 20, desc: '回避+5%' },
  hit:      { type: 'hit',      name: '命中のチャーム',     emoji: '🎯', effect: 'hit',      short: '命中', minFloor: 20, desc: '命中+5%' },
  lucky:    { type: 'lucky',    name: '幸せのチャーム',     emoji: '🍀', effect: 'lucky',    short: '幸せ', minFloor: 20, rare: true, desc: '撃破時50%で経験値+50%（主人公は10%で経験値+1）' },
  // --- d60(五霊の大峡谷)37F以降のドロップ（minFloor無し＝d30では落ちない）---
  stunres:  { type: 'stunres',  name: 'スタンのチャーム',   emoji: '⚡', effect: 'stunres',  short: 'スタン', desc: 'しびれ(麻痺)になる確率が20%減る' },
  burnres:  { type: 'burnres',  name: 'やけどのチャーム',   emoji: '🔥', effect: 'burnres',  short: 'やけど', desc: 'やけどになる確率が30%減る' },
  // リボン（チャームとは別の装備枠。強化は「凝縮された素」を使う）
  rib_phys: { type: 'rib_phys', name: '物理のリボン',       emoji: '🎀', effect: 'physup',   short: '物理', ribbon: true, desc: '物理ダメージ+5%' },
  rib_spec: { type: 'rib_spec', name: '特殊のリボン',       emoji: '🎗️', effect: 'specup',   short: '特殊', ribbon: true, desc: '特殊ダメージ+5%' },
  rib_wall: { type: 'rib_wall', name: '両壁のリボン',       emoji: '🧱', effect: 'wall',     short: '両壁', ribbon: true, desc: '防御・特防+6%' },
}
export const getCharm = (t) => CHARMS[t] || CHARMS.hajimari
// リボン判定（チャームとは別枠の装備）
export const isRibbonType = (t) => !!CHARMS[t]?.ribbon
// リボンを合成したチャームの名前タグ（装備名の先頭に付く）
export const RIBBON_TAG = { rib_phys: '【物理】', rib_spec: '【特殊】', rib_wall: '【守備】' }

// ============================================================
// 特殊能力（フェイトコアで抽選。チャーム/リボンの specials 列に保存）
//  枠数＝構成数（単体=1 / 合成=2 / 合成+リボン=3）。フェイトコア1個で全枠再抽選
//  プレイヤー本体にも適用（stats.js が charmPlayerBonus 経由で消費）
// ============================================================
export const SPECIAL_LABELS = {
  atk: '攻撃', spatk: '特攻', def: '防御', spdef: '特防',
  physdmg: '物理ダメージ', specdmg: '特殊ダメージ',
  res_poison: '毒耐性', res_paralyze: '麻痺耐性', res_burn: 'やけど耐性',
  hit: '命中', evade: '回避', crit: 'クリティカル率', critres: 'クリティカル抵抗',
}
export const specialLabel = (s) => s ? `${SPECIAL_LABELS[s.k] || s.k}+${s.v}%` : ''
export const charmSpecials = (c) => (Array.isArray(c?.specials) ? c.specials : [])
// 特殊能力の抽選枠数（単体=1 / 合成=2 / リボン合成済み=3。リボン単体=1）
export const specialSlots = (c) => 1 + (c?.ctype2 ? 1 : 0) + (c?.ctype3 ? 1 : 0)
// 複数装備品の特殊能力を種類別に合算（ペット/プレイヤー適用用）
export function sumSpecials(...items) {
  const acc = {}
  for (const c of items) for (const s of charmSpecials(c)) acc[s.k] = (acc[s.k] || 0) + (s.v || 0)
  return acc
}
// チャーム/リボンの共通アイコン画像（種類別の絵文字はログ用に残す）
export const charmIcon = (ctype) => assetSrc(CHARMS[ctype]?.ribbon ? '/ribon.png' : '/ribonntya-mu.png')
// そのフロアでドロップする通常チャーム（rare=幸せは別枠抽選）
export const charmsForFloor = (floor) => Object.values(CHARMS).filter((c) => !c.rare && c.minFloor && floor >= c.minFloor).map((c) => c.type)
// ダンジョン別のチャーム/リボンのドロップ表（d60は専用の解禁帯）
export function charmDropsFor(dungeonId, floor) {
  if (dungeonId === 'd60') {
    const pool = ['guard', 'mdefup', 'atkup', 'spatkup']            // F1-24
    if (floor >= 25) pool.push('evade', 'hit', 'antidote')          // F25-36で追加
    if (floor >= 37) pool.push('stunres', 'burnres', 'rib_phys', 'rib_spec', 'rib_wall') // F37-59で追加
    return pool
  }
  return charmsForFloor(floor)
}
// チャームが持つ効果一覧（合成でctype2、リボン合成でctype3を持つと最大3つ）
export const charmEffects = (charm) => [charm?.ctype, charm?.ctype2, charm?.ctype3].filter(Boolean).map((t) => getCharm(t).effect).filter(Boolean)
export const charmHasEffect = (charm, eff) => charmEffects(charm).includes(eff)
// チャーム本体の強化合計（atk等・上限300）。=通常の素による強化ゲージ
export const charmTotal = (c) => (c?.atk || 0) + (c?.spatk || 0) + (c?.def || 0) + (c?.spdef || 0) + (c?.hp || 0)
// リボン合成枠(rib_*)の強化合計（上限300）。=凝縮された素による強化ゲージ（チャーム本体とは別枠）
export const charmRibTotal = (c) => (c?.rib_atk || 0) + (c?.rib_spatk || 0) + (c?.rib_def || 0) + (c?.rib_spdef || 0) + (c?.rib_hp || 0)
// 表示用の総合計（チャーム本体＋リボン枠＝最大600）
export const charmGrandTotal = (c) => charmTotal(c) + charmRibTotal(c)
// 各ステの実効成長（チャーム本体＋リボン枠を合算）
export const cStat = (c, s) => (c?.[s] || 0) + (c?.['rib_' + s] || 0)
// HPボーナス（HPの素は1個=+CHARM_HP_PER）。hp列は「使った個数」を保持。リボン枠(rib_hp)も合算
export const charmHpBonus = (c) => cStat(c, 'hp') * CHARM_HP_PER
// 表示名（素を使った分だけ ＋N がつく）
export function charmDisplayName(charm) {
  // 合成済みは「○と○のチャーム」。リボン合成済みは先頭に【物理】/【特殊】/【守備】タグ
  const tag = charm?.ctype3 ? (RIBBON_TAG[charm.ctype3] || '') : ''
  const base = charm?.ctype2
    ? `${tag}${getCharm(charm.ctype).short}と${getCharm(charm.ctype2).short}のチャーム`
    : `${tag}${getCharm(charm?.ctype).name}`
  const t = charmGrandTotal(charm)
  return t > 0 ? `${base}+${t}` : base
}
// 装備チャームをプレイヤー本体ステへ反映する分（攻→atk / 特攻→matk / 特防→mdef / HPは×CHARM_HP_PER）
//  ribbon（チャーム別枠の装備）も同じくプレイヤーへ反映する（特殊能力＋ステ成長）。
//  基礎効果（物理+5%/特殊+5%/防御特防+6%）はペット専用＝チャームの atkup/wall 等と同じ扱い
//  （プレイヤーへ効くチャーム効果は guard/antidote のみ）。
export function charmPlayerBonus(charm, ribbon = null) {
  if (!charm && !ribbon) return null
  // 特殊能力をプレイヤー用に集約（%はstats.jsが最終値へ乗算/加算）
  const sp = sumSpecials(charm, ribbon)
  const spAgg = {
    atkPct: (sp.atk || 0) + (sp.physdmg || 0),   // 物理ダメージ%は攻撃%へ折り込み
    matkPct: (sp.spatk || 0) + (sp.specdmg || 0), // 特殊ダメージ%は特攻%へ折り込み
    defPct: sp.def || 0, mdefPct: sp.spdef || 0,
    hit: sp.hit || 0, evade: sp.evade || 0, crit: sp.crit || 0, critres: sp.critres || 0,
    ailRes: (sp.res_poison || 0) + (sp.res_paralyze || 0) + (sp.res_burn || 0), // 本編は総合耐性へ合算
  }
  const hasSp = Object.values(spAgg).some((v) => v > 0)
  return {
    // ステ成長はチャーム＋リボンを合算（リボンは凝縮された素の分）
    hp:   charmHpBonus(charm)     + charmHpBonus(ribbon),
    atk:  cStat(charm, 'atk')     + cStat(ribbon, 'atk'),
    matk: cStat(charm, 'spatk')   + cStat(ribbon, 'spatk'),
    def:  cStat(charm, 'def')     + cStat(ribbon, 'def'),
    mdef: cStat(charm, 'spdef')   + cStat(ribbon, 'spdef'),
    guard: charmEffects(charm).includes('guard'),       // 防御+10%
    antidote: charmEffects(charm).includes('antidote'), // 毒確率50%減
    sp: hasSp ? spAgg : null,
  }
}
// チャーム＋リボンのステ成長を加算したペットステを返す（ダンジョン/反映で使用）
//  ribbon はチャームとは別枠の装備（無ければ従来どおりチャームのみ）
export function applyCharmStats(stats, charm, ribbon = null) {
  if (!charm && !ribbon) return { ...stats, atkPhys: stats.atk, atkSpec: stats.atk }
  let { maxHp, atk, def, mdef } = stats
  // チャーム/リボン込みの物理値/特殊値を両方持つ（たいあたりは高いほうを参照して攻撃する）
  let atkPhys = atk, atkSpec = atk
  for (const c of [charm, ribbon]) {
    if (!c) continue
    maxHp += charmHpBonus(c)
    atkPhys += cStat(c, 'atk')
    atkSpec += cStat(c, 'spatk')
    def += cStat(c, 'def')
    mdef += cStat(c, 'spdef')
  }
  // 効果（チャームは合成で2つ持つことがある）：guard=防御+10% / mdefup=特防+10% / atkup=攻撃+10% / spatkup=特攻+10% / wall=防御特防+6%
  const effs = [...charmEffects(charm), ...charmEffects(ribbon)]
  if (effs.includes('guard')) def = Math.round(def * 1.1)
  if (effs.includes('mdefup')) mdef = Math.round(mdef * 1.1)
  if (effs.includes('atkup')) atkPhys = Math.round(atkPhys * 1.1)
  if (effs.includes('spatkup')) atkSpec = Math.round(atkSpec * 1.1)
  if (effs.includes('wall')) { def = Math.round(def * 1.06); mdef = Math.round(mdef * 1.06) }
  // 特殊能力（フェイトコア抽選）のステータス%をペットにも適用
  const sp = sumSpecials(charm, ribbon)
  if (sp.atk) atkPhys = Math.round(atkPhys * (1 + sp.atk / 100))
  if (sp.spatk) atkSpec = Math.round(atkSpec * (1 + sp.spatk / 100))
  if (sp.def) def = Math.round(def * (1 + sp.def / 100))
  if (sp.spdef) mdef = Math.round(mdef * (1 + sp.spdef / 100))
  atk = stats.atkType === 'spec' ? atkSpec : atkPhys // 表示用のメイン攻撃値は攻撃タイプ側
  return { ...stats, maxHp, atk, atkPhys, atkSpec, def, mdef }
}

export function speciesLabel(pet) {
  const sp = SPECIES[pet?.species] || {}
  if (pet?.evolved && sp.evolve) return sp.evolve.label
  return sp.label || '???'
}
export function speciesEmoji(pet) {
  const sp = SPECIES[pet?.species] || {}
  if (pet?.evolved && sp.evolve) return sp.evolve.emoji || sp.emoji
  return sp.emoji || '🐾'
}
// 画像キャッシュ対策：public/ の画像を「同じ名前で」差し替えたら、この数字を上げると最新が表示される
export const ASSET_VER = '4'
// 静的画像(先頭/)にだけ ?v= を付けてキャッシュを無効化。外部URL(http...)はそのまま
// 日本語ファイル名でも安全になるよう encodeURI でパスをエンコードしてからクエリを付ける
export const assetSrc = (src) => (src && src.startsWith('/') ? `${encodeURI(src)}?v=${ASSET_VER}` : src)

// ダンジョンのタイル画像（public/ に置いたファイルを /xxx.png で指定）。ダンジョンIDごとに設定。
//  画像を用意したらパスを設定（例 '/dg_floor.png'）。未設定のダンジョンは従来の色／絵文字表示。
//  床・壁＝背景画像（無ければ色）、階段・アイテム＝絵文字に画像を重ねる（無ければ絵文字のまま）。
export const DUNGEON_TILES = {
  // 深淵の遺跡(30F)専用タイル
  d30: {
    floor:  '/dg_floor2.png',  // 床（シームレス地面テクスチャ）
    wall:   '/dg_wall.png',    // 壁（walls未指定時のフォールバック）
    walls:  ['/dg_wall2.png', '/dg_wall3.png', '/dg_wall5.png'],  // 壁3種（マスごとにランダム表示）
    stairs: '/dg_stairs.png',  // 階段
    item:   '/dg_item.png',    // 落ちているアイテム（共通マーカー）
  },
  // 初級の洞窟(d10)は従来の色・絵文字のまま（タイル未設定）
}
// 水エリア用タイル（追憶の遺跡 20〜29F・深海の廃都で共用）
const WATER_TILES = { floor: '/水辺床.png', wall: '/mizutamari.png', walls: ['/mizutamari.png'], stairs: '/dg_stairs.png', waterWall: true }
// 追憶の遺跡(d30)の20〜29F・五霊の大峡谷(d60)の13〜24Fは水エリア
export const isWaterFloor = (dungeonId, floor) =>
  (dungeonId === 'd30' && floor >= 20 && floor <= 29) || (dungeonId === 'd60' && floor >= 13 && floor <= 24)
// 五霊の大峡谷(d60)のフロア帯別タイル＆BGM。⑦のマグマは水たまり方式(waterWall)で炎系のみ渡れる
const D60_MAGMA_TILES = { floor: '/eria7yuka.png', wall: '/eria7kabe.png', walls: ['/eria7kabe.png'], stairs: '/dg_stairs.png', item: '/dg_item.png', waterWall: true }
const D60_BANDS = [
  { from: 1,  to: 12, tiles: DUNGEON_TILES.d30, bgm: '/dungeon_bgm.mp3' },   // ③洞窟（d30タイル流用）
  { from: 13, to: 24, tiles: WATER_TILES, bgm: '/深海の廃都.mp3' },          // ④水辺
  { from: 25, to: 36, tiles: { floor: '/eria5yuka.png', wall: '/eria5kabe.png', walls: ['/eria5kabe.png'], stairs: '/dg_stairs.png', item: '/dg_item.png' }, bgm: '/yama.mp3' },  // ⑤山岳
  { from: 37, to: 48, tiles: { floor: '/eria6yuka.png', wall: '/eria6kabe.png', walls: ['/eria6kabe.png'], stairs: '/dg_stairs.png', item: '/dg_item.png' }, bgm: '/yuki.mp3' },  // ⑥氷雪
  { from: 49, to: 59, tiles: D60_MAGMA_TILES, bgm: '/maguma.mp3' },          // ⑦火山（マグマ）
  { from: 60, to: 60, tiles: D60_MAGMA_TILES, bgm: '/60Fbosu.mp3' },         // 60Fボス
]
const d60BandFor = (floor) => D60_BANDS.find((b) => floor >= b.from && floor <= b.to) || D60_BANDS[0]
// ダンジョン＋フロアから有効なタイル設定を返す（d60はフロア帯／d30水エリアは上書き）
export const dgTilesFor = (dungeonId, floor) => {
  if (dungeonId === 'd60') return d60BandFor(floor).tiles
  return isWaterFloor(dungeonId, floor) ? WATER_TILES : (DUNGEON_TILES[dungeonId] || null)
}
// そのフロアのBGM（d60はフロア帯で切替／d30は水エリア20-29Fで水曲・30FだけボスBGM／他はダンジョン既定）
export function dgBgm(dungeon, floor) {
  if (!dungeon) return null
  if (dungeon.id === 'd60') return d60BandFor(floor).bgm
  if (isBossFloor(dungeon.id, floor)) return '/30FBoos.mp3'
  if (isWaterFloor(dungeon.id, floor)) return '/深海の廃都.mp3' // d30の水エリアはd60水帯と同じ曲
  return dungeon.bgm || null
}
// 泳げる（水＝壁を通れる）敵
const AQUATIC = new Set(['深海魚人', 'ハリセンボン', '毒クラゲ', '電気クラゲ'])
export const isAquatic = (name) => AQUATIC.has(name)

export const dgTileSrc = (dungeonId, key, floor) => assetSrc(dgTilesFor(dungeonId, floor)?.[key] || null)
// 壁を「水たまり」として半透明描画するか
export const dgWaterWall = (dungeonId, floor) => !!dgTilesFor(dungeonId, floor)?.waterWall
// 壁バリエーション配列（walls指定があればそれ、無ければwall単体を配列化）
export const dgWallTiles = (dungeonId, floor) => {
  const t = dgTilesFor(dungeonId, floor)
  const arr = (Array.isArray(t?.walls) && t.walls.length) ? t.walls : (t?.wall ? [t.wall] : [])
  return arr.map((s) => assetSrc(s)).filter(Boolean)
}
// マス座標から決まる壁バリエーション添字（再描画でちらつかない決定論的選択）
export const dgWallVariant = (dungeonId, x, y, floor) => {
  const arr = dgWallTiles(dungeonId, floor)
  if (arr.length === 0) return null
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0
  return arr[h % arr.length]
}

// 種族デフォルト画像（進化済みなら進化形イラスト）。未設定なら null
export function speciesImage(pet) {
  const sp = SPECIES[pet?.species] || {}
  const img = (pet?.evolved && sp.evolve?.image) ? sp.evolve.image : (sp.image || null)
  return assetSrc(img)
}
// 進化形イラストの素のパス（進化時に image_url へ保存する用。表示時は petImage が ?v を付ける）
export const evolvedImage = (pet) => SPECIES[pet?.species]?.evolve?.image || null
// 実際に表示する画像：カスタム(image_url) 優先、無ければ種族デフォルト
export const petImage = (pet) => assetSrc(pet?.image_url) || speciesImage(pet)
