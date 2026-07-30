// ============================================================
// ステータス計算 共通モジュール
// Game.jsx / Profile.jsx / Ranking.jsx で共通利用
// （表示と実効果のロジックズレを防ぐため一元管理）
// ============================================================
import { calcEmblemBonus } from './emblem.js'
import { EQUIP_TO_LINE, MAX_EVO_STAGE } from '../constants/bossEvolution.js'

// 真化(5段)済みのボス装備は、保存済み player_equipment.bonus_effect がズレ/欠落していても
// 正典（bossEvolution の name→effect）から真化効果を必ず引く（真化スキルが発動しない不具合の根本対処）。
// 非ボス装備や未真化(5段未満)は従来どおり保存済み bonus_effect をそのまま使う。
const resolveBonusEffect = (item, weaponName) =>
  ((item.evolve_stage || 0) >= MAX_EVO_STAGE && EQUIP_TO_LINE[weaponName])
    ? EQUIP_TO_LINE[weaponName].effect
    : item.bonus_effect

export const WEAPON_TYPE_GROUP = {
  sword:'physical', axe:'physical', spear:'physical', bow:'physical', dagger:'physical',
  knuckle:'physical', gun:'physical', katana:'physical',
  staff:'magical', wand:'magical', tome:'magical', orb:'magical',
}
export const getWeaponGroup = (weaponType) => WEAPON_TYPE_GROUP[weaponType] || 'physical'

// ===== 武器種ごとの固有能力（装備中の武器スロットにのみ適用・全レア共通） =====
// atkPct/matkPct=攻撃/特殊攻撃%上乗せ, hit=命中±, evasion=回避%, defPen/mdefPen=防御/特防貫通%,
// dmgMult=与ダメージ倍率(0.10で+10%), mpCostMult=消費MP倍率(-0.10で-10%)
// ※ wand/rod は staff に統合済みのため個別エントリ不要
export const WEAPON_TYPE_PASSIVE = {
  sword:   { atkPct: 5 },                 // 剣: 攻撃+5%
  katana:  { atkPct: 5 },                 // 刀: 攻撃+5%
  knuckle: { atkPct: 5 },                 // 格闘: 攻撃+5%
  gun:     { atkPct: 3, matkPct: 3 },     // 銃: 攻撃/特殊攻撃+3%
  staff:   { matkPct: 5 },                // 杖: 特殊攻撃+5%
  dagger:  { evasion: 3 },                // 短剣: 回避+3%
  bow:     { hit: 5 },                    // 弓: 命中+5%
  axe:     { hit: -10, dmgMult: 0.10 },   // 斧: 与ダメ+10%・命中-10%
  spear:   { defPen: 5 },                 // 槍: 防御貫通+5%
  orb:     { mdefPen: 5 },                // オーブ: 特殊防御貫通+5%
  tome:    { mpCostMult: -0.10 },         // 魔導書: 消費MP-10%
}
export const WEAPON_TYPE_PASSIVE_LABEL = {
  sword:'攻撃+5%', katana:'攻撃+5%', knuckle:'攻撃+5%', gun:'攻撃・特殊攻撃+3%',
  staff:'特殊攻撃+5%', dagger:'回避+3%', bow:'命中+5%', axe:'与ダメ+10%・命中-10%',
  spear:'防御貫通+5%', orb:'特殊防御貫通+5%', tome:'消費MP-10%',
}

export const ARTIFACT_BASE_NAMES_SET = new Set([
  '古びた剣','古びた短剣','古びた弓','古びた斧','古びた刀',
  '古びた銃','古びた杖','古びた魔導書','古びた槍','古びたオーブ'
])

// ===== 宝石（ジェム）=====
export const GEM_RANKS = ['F','E','D','C','B','A','S','SS','SSS']
export const GEM_DATA = {
  peridot:    { name:'ペリドット',     effect:'hp',        base:80, label:'HP' },
  lapis:      { name:'ラピスラズリ',   effect:'mp',        base:40, label:'MP' },
  ruby:       { name:'ルビー',         effect:'atk',       base:10, label:'攻撃' },
  sapphire:   { name:'サファイア',     effect:'def',       base:10, label:'防御' },
  amethyst:   { name:'アメジスト',     effect:'matk',      base:10, label:'特殊攻撃' },
  emerald:    { name:'エメラルド',     effect:'mdef',      base:10, label:'特殊防御' },
  topaz:      { name:'トパーズ',       effect:'spd',       base:10, label:'素早さ' },
  rosequartz: { name:'ローズクォーツ', effect:'atk_matk',  base:5,  label:'攻撃+特殊攻撃' },
  turquoise:  { name:'ターコイズ',     effect:'def_mdef',  base:5,  label:'防御+特殊防御' },
  morganite:  { name:'モルガナイト',   effect:'def_pen',   base:0.5, label:'防御貫通',     pct:true },
  kunzite:    { name:'クンツァイト',   effect:'mdef_pen',  base:0.5, label:'魔法防御貫通', pct:true },
  citrine:    { name:'シトリン',       effect:'crit',      base:0.5, label:'クリティカル率',   pct:true },
  onyx:       { name:'オニキス',       effect:'crit_resist', base:0.5, label:'クリティカル抵抗', pct:true },
  opal:       { name:'オパール',       effect:'hit',       base:0.5, label:'命中率', pct:true },
  moonstone:  { name:'ムーンストーン', effect:'evasion',   base:0.5, label:'回避率', pct:true },
  petalite:   { name:'ペタライト',     effect:'crit_dmg',  base:0.5, label:'クリティカル威力', pct:true },
}
export const GEM_TYPES = Object.keys(GEM_DATA)
export const PEN_CAP = 0.8
// 装飾品①②はカテゴリ 'accessory' に統一
export const gemSlotCategory = (slot) => slot === 'accessory2' ? 'accessory' : slot
// 宝石を装着できる部位カテゴリ。%系=装飾品のみ／HP・MP=防具+装飾品／攻撃系=武器+装飾品／防御系=防具+装飾品
export const gemAllowedSlots = (gemType) => {
  const g = GEM_DATA[gemType]; if (!g) return []
  if (g.pct) return ['accessory']
  if (g.effect === 'hp' || g.effect === 'mp') return ['armor','accessory']
  if (['atk','matk','atk_matk','spd'].includes(g.effect)) return ['weapon','accessory']
  if (['def','mdef','def_mdef'].includes(g.effect)) return ['armor','accessory']
  return ['accessory']
}
export const GEM_SLOT_LABEL = { weapon:'武器', armor:'防具', accessory:'装飾品' }
export const gemEffectValue = (gemType, rank) => {
  const g = GEM_DATA[gemType]; if (!g) return 0
  const i = GEM_RANKS.indexOf(rank); if (i < 0) return 0
  const v = g.base * Math.pow(1.5, i)
  return g.pct ? Math.round(v * 10) / 10 : Math.round(v)
}
// 装備に埋め込まれた宝石の効果を bonus / 各種補正へ加算
const applyGemBonus = (item, acc) => {
  if (!item.gem_type || !item.gem_rank) return
  const g = GEM_DATA[item.gem_type]; if (!g) return
  const v = gemEffectValue(item.gem_type, item.gem_rank)
  switch (g.effect) {
    case 'hp':   acc.bonus.hp += v; break
    case 'mp':   acc.bonus.mp += v; break
    case 'atk':  acc.bonus.atk += v; break
    case 'def':  acc.bonus.def += v; break
    case 'matk': acc.bonus.matk += v; break
    case 'mdef': acc.bonus.mdef += v; break
    case 'spd':  acc.bonus.spd += v; break
    case 'atk_matk': acc.bonus.atk += v; acc.bonus.matk += v; break
    case 'def_mdef': acc.bonus.def += v; acc.bonus.mdef += v; break
    case 'def_pen':     acc.defPen += v; break
    case 'mdef_pen':    acc.mdefPen += v; break
    case 'crit':        acc.critBonus += v; break
    case 'crit_resist': acc.critResist += v; break
    case 'hit':         acc.hitBonus += v; break
    case 'evasion':     acc.evasionBonus += v; break
    case 'crit_dmg':    acc.critDmg += v; break
  }
}

// 熟練度ボーナス：武器の固定ボーナス各種に倍率をかける
// LV1〜300:    LV×1% + floor(LV/100)×50%（LV300で450%）
// LV301〜600:  +1%/10LV
// LV601〜1000: +1%/20LV
// LV1001〜2000:+1%/50LV
// LV2001〜:    +1%/100LV
// 対象：atk/def/matk/mdef/spd/hp/mp の固定ボーナスのみ（%ボーナスは対象外）
// evolveStage: ボス装備 真化（進化）で上がった基礎ステを参照する。表示の「元:」＝ceil(基礎×進化倍率)と一致
//   （進化倍率 = 1+0.2×stage・5段=真化で×2.0）。強化(+N)は基礎ステ扱いではないため対象外。
export const calcProfBonus = (prof, weapon, evolveStage = 0) => {
  if (!prof || !weapon) return {}
  const profLv = prof.prof_lv || 0
  let rate
  if (profLv <= 300) {
    rate = profLv * 0.01 + Math.floor(profLv / 100) * 0.5
  } else {
    const base = 4.5  // LV300時点
    const lv300 = Math.min(profLv, 600) - 300
    const lv600 = Math.max(0, Math.min(profLv, 1000) - 600)
    const lv1000 = Math.max(0, Math.min(profLv, 2000) - 1000)
    const lv2000 = Math.max(0, profLv - 2000)
    rate = base
      + Math.floor(lv300  / 10)  * 0.01
      + Math.floor(lv600  / 20)  * 0.01
      + Math.floor(lv1000 / 50)  * 0.01
      + Math.floor(lv2000 / 100) * 0.01
  }
  if (rate <= 0) return {}
  // 真化で上がった基礎ステを参照（0のステは0のまま・ceilで「元:」表示と一致）
  const evoMult = 1 + 0.2 * (evolveStage || 0)
  const evo = (v) => (v > 0 ? Math.ceil(v * evoMult) : 0)
  const result = {}
  const atk  = Math.floor(evo(weapon.atk_bonus)  * rate); if (atk  > 0) result.atk  = atk
  const def  = Math.floor(evo(weapon.def_bonus)  * rate); if (def  > 0) result.def  = def
  const matk = Math.floor(evo(weapon.matk_bonus) * rate); if (matk > 0) result.matk = matk
  const mdef = Math.floor(evo(weapon.mdef_bonus) * rate); if (mdef > 0) result.mdef = mdef
  const spd  = Math.floor(evo(weapon.spd_bonus)  * rate); if (spd  > 0) result.spd  = spd
  const hp   = Math.floor(evo(weapon.hp_bonus)   * rate); if (hp   > 0) result.hp   = hp
  const mp   = Math.floor(evo(weapon.mp_bonus)   * rate); if (mp   > 0) result.mp   = mp
  return result
}

// 装備＋熟練度込みの実効ステータス（titleBonus は ability_title のボーナスオブジェクト or null）
export const calcEffectiveStats = (profile, equipment, proficiency, titleBonus = null) => {
  const bonus = { atk:0, def:0, matk:0, mdef:0, spd:0, hp:0, mp:0 }
  let matkPct = 0
  let atkPct = 0
  let hitBonus = 0
  let critBonus = 0
  let evasionBonus = 0
  let critResist = 0
  let ondmgSpdPct = 0     // 雷鋼の機神鎧: 被ダメージ時に素早さを一定時間アップ（%）
  let extraParaChance = 0 // 蒼雷の短刃: 追加行動の攻撃ヒット時に相手を麻痺させる確率（%）
  // 閻魔装備
  let hitPoisonChance = 0 // 冥獄宝珠・断罪: 攻撃ヒット時に毒を付与する確率（%）
  let gokuiTakenPct   = 0 // 冥府王の獄衣: 被ダメージ軽減（%）。HPが半分以下なら2倍になる（判定は戦闘側）
  let atkToMatk       = 0 // 六道輪廻の数珠: 攻撃力の一定%を特殊攻撃に加算（%）
  // ボス装備 進化(真化)効果。bonus_effectで判定しスロット非依存で集約 → eff.* として戦闘ループが消費
  let evoMpToMatk = 0, evoSpdToAtk = 0               // 古代魔導コア / 雷鷲の爪牙（ステ派生）
  let evoDmgTakenMult = 1, evoPhysDmgTakenMult = 1   // 海竜の鱗 / 蒼粘剣（被ダメ%軽減）
  let evoReflectPct = 0, evoAilmentResist = 0        // 嵐の重装甲 / アクアクラウン
  let evoHitSpdDown = false, evoHitBleed = 0, evoHitStun = 0  // スライムの指輪 / 略奪者の短剣 / 絶零の魔導砲（攻撃ヒット時）
  let evoOndmgStun = 0, evoOndmgBurn = 0             // フロストバーンの聖鎧 / インフェルノバスティオン（被ダメ時）
  let evoEvadeSpdUp = false                          // 影踏みのブーツ（回避時）
  let evoAllskillAtk = 0, evoAllskillMatk = 0        // 深紅の牙輪 / 深紅の魔眼石（全スキルセット時・条件は戦闘側で判定）
  let evoHitCritDmg = false, evoCritAtkMatk = false, evoDmgReduceStack = false  // 天空⑧: 天砲/指輪/聖鎧（スタック型・戦闘側で累積）
  let weaponDmgMult = 1   // 武器種固有: 与ダメージ倍率（斧+10%など）
  let weaponMpCostMult = 1// 武器種固有: 消費MP倍率（魔導書-10%など）
  const gemAcc = { bonus, defPen:0, mdefPen:0, critDmg:0, critBonus:0, critResist:0, hitBonus:0, evasionBonus:0 }
  // 紋章（第5の装備枠）: profile.emblemAlloc（player_emblem.alloc）から集約
  //  フラットステはbonusへ（%補正の対象・宝石と同枠）、%系はgemAccへ、
  //  新メカニクス（与ダメ%/吸収/異常ダメUP/個別耐性）は eff.emblem として戦闘ループが消費
  const emblem = profile.emblemAlloc ? calcEmblemBonus(profile.emblemAlloc) : null
  if (emblem) {
    bonus.atk  += emblem.flat.atk
    bonus.def  += emblem.flat.def
    bonus.matk += emblem.flat.matk
    bonus.mdef += emblem.flat.mdef
    gemAcc.defPen       += emblem.defPen
    gemAcc.mdefPen      += emblem.mdefPen
    gemAcc.critBonus    += emblem.crit
    gemAcc.critDmg      += emblem.critDmg
    gemAcc.critResist   += emblem.critResist
    gemAcc.evasionBonus += emblem.evasion
  }
  for (const item of equipment) {
    if (!item.equipped || !item.weapons) continue
    applyGemBonus(item, gemAcc)
    const w = item.weapons
    const plus = item.enhance_plus || 0
    const isArtifactBase = ARTIFACT_BASE_NAMES_SET.has(w.name)
    const mult = (plus > 0 && !isArtifactBase) ? Math.pow(1.5, plus) : 1
    // ボス装備進化: 基礎ステに ×(1+0.2*evolve_stage)。5段(真化)で×2.0。強化倍率(1.5^plus)とは独立に乗算。
    const evoMult = 1 + 0.2 * (item.evolve_stage || 0)
    const baseMult = mult * evoMult
    bonus.atk  += Math.ceil((w.atk_bonus||0)  * baseMult) + (item.bonus_atk||0)
    bonus.def  += Math.ceil((w.def_bonus||0)  * baseMult) + (item.bonus_def||0)
    bonus.matk += Math.ceil((w.matk_bonus||0) * baseMult) + (item.bonus_matk||0)
    bonus.mdef += Math.ceil((w.mdef_bonus||0) * baseMult) + (item.bonus_mdef||0)
    bonus.spd  += Math.ceil((w.spd_bonus||0)  * baseMult) + (item.bonus_spd||0)
    bonus.hp   += Math.ceil((w.hp_bonus||0)   * baseMult) + (item.bonus_hp||0)
    bonus.mp   += Math.ceil((w.mp_bonus||0)   * baseMult) + (item.bonus_mp||0)
    if (w.hp_bonus_pct > 0)  bonus.hp  += Math.floor(profile.hp_max * w.hp_bonus_pct/100)
    if (w.mp_bonus_pct > 0)  bonus.mp  += Math.floor(profile.mp_max * w.mp_bonus_pct/100)
    if (w.spd_bonus_pct > 0) bonus.spd += Math.floor(profile.spd   * w.spd_bonus_pct/100)
    if (w.matk_bonus_pct > 0) matkPct  += w.matk_bonus_pct
    if (w.atk_bonus_pct > 0)  atkPct   += w.atk_bonus_pct
    if (w.hit_bonus > 0) hitBonus += w.hit_bonus
    critBonus   += w.crit_bonus  || 0   // 武器固有クリティカル率
    critResist  += w.crit_resist || 0   // 武器固有クリティカル抵抗
    gemAcc.critDmg += w.crit_dmg || 0   // 武器固有クリティカル威力（%。最終値で/100）
    hitBonus    += item.bonus_hit     || 0
    critBonus   += item.bonus_crit    || 0
    evasionBonus += item.bonus_evasion || 0
    if (item.bonus_effect === 'mdef_pen_5') gemAcc.mdefPen += 5  // 水禍の蒼珠: 魔法防御貫通+5%
    if (item.bonus_effect === 'ondmg_spd_up_5_2t') ondmgSpdPct += 15     // 雷鋼の機神鎧: 被ダメ時 2T素早さ+15%（2026-07-08 5%→15%に強化）
    if (item.slot === 'weapon' && item.bonus_effect === 'extra_hit_paralysis_30') extraParaChance += 20  // 蒼雷の短刃（20%にナーフ）
    if (item.slot === 'weapon' && item.bonus_effect === 'hit_poison_20') hitPoisonChance = 20  // 冥獄宝珠・断罪: 攻撃ヒット時20%で毒
    if (item.bonus_effect === 'dmg_taken_down_5_hp50_x2') gokuiTakenPct = 5  // 冥府王の獄衣: 被ダメ-5%（HP半分以下で-10%）
    if (item.bonus_effect === 'atk_to_matk_2') atkToMatk += 2  // 六道輪廻の数珠: 攻撃力の2%を特攻へ
    // ボス装備 真化効果（スロット非依存・5段で付与される bonus_effect）
    // ※真化済みなら保存値がズレていても正典から解決（reflect等が発動しない不具合の根本対処）
    switch (resolveBonusEffect(item, w.name)) {
      case 'evo_mp_to_matk_5':          evoMpToMatk += 5; break
      case 'evo_spd_to_atk_3':          evoSpdToAtk += 3; break
      case 'evo_mdef_pen_10':           gemAcc.mdefPen += 10; break
      case 'evo_dmg_taken_down_5':      evoDmgTakenMult *= 0.95; break
      case 'evo_phys_dmg_taken_down_10':evoPhysDmgTakenMult *= 0.90; break
      case 'evo_reflect_5':             evoReflectPct += 5; break
      case 'evo_ailment_resist_5':      evoAilmentResist += 5; break
      case 'evo_hit_spd_down_10_2t':    evoHitSpdDown = true; break
      case 'evo_hit_bleed_30':          evoHitBleed = 30; break
      case 'evo_hit_stun_20':           evoHitStun = 20; break
      case 'evo_ondmg_stun_20':         evoOndmgStun = 20; break
      case 'evo_ondmg_burn_50':         evoOndmgBurn = 50; break
      case 'evo_evade_spd_up_10_2t':    evoEvadeSpdUp = true; break
      case 'evo_allskill_atk_10':       evoAllskillAtk = 10; break
      case 'evo_allskill_matk_10':      evoAllskillMatk = 10; break
      case 'evo_hit_critdmg_5_x4':      evoHitCritDmg = true; break
      case 'evo_ondmg_reduce_1_x10':    evoDmgReduceStack = true; break
      case 'evo_crit_atkmatk_1_x15':    evoCritAtkMatk = true; break
    }
    if (item.slot === 'weapon') {
      // 武器種ごとの固有能力（装備中の武器のみ）
      const wp = WEAPON_TYPE_PASSIVE[w.weapon_type]
      if (wp) {
        atkPct       += wp.atkPct  || 0
        matkPct      += wp.matkPct || 0
        hitBonus     += wp.hit     || 0
        evasionBonus += wp.evasion || 0
        gemAcc.defPen  += wp.defPen  || 0
        gemAcc.mdefPen += wp.mdefPen || 0
        if (wp.dmgMult)    weaponDmgMult    *= 1 + wp.dmgMult
        if (wp.mpCostMult) weaponMpCostMult *= 1 + wp.mpCostMult
      }
      const prof = proficiency.find(p => p.equipment_id === item.id)
      if (prof) {
        const pb = calcProfBonus(prof, w, item.evolve_stage || 0)
        bonus.atk  += pb.atk  || 0
        bonus.def  += pb.def  || 0
        bonus.matk += pb.matk || 0
        bonus.mdef += pb.mdef || 0
        bonus.spd  += pb.spd  || 0
        bonus.hp   += pb.hp   || 0
        bonus.mp   += pb.mp   || 0
      }
    }
  }
  // ボス装備 真化の派生ステ（基礎値ベース）: 古代魔導コア MP→特攻 / 雷鷲の爪牙 素早さ→攻撃
  if (evoMpToMatk > 0) bonus.matk += Math.floor((profile.mp_max || 0) * evoMpToMatk / 100)
  if (evoSpdToAtk > 0) bonus.atk  += Math.floor((profile.spd    || 0) * evoSpdToAtk / 100)
  // 六道輪廻の数珠: 攻撃力の2%を特殊攻撃に加算。派生元は基礎値（profile.atk）＝真化の派生ステと同じ規則。
  // 装備込みの実効攻撃を参照すると bonus.atk と bonus.matk が相互参照になるため基礎値で確定させる。
  if (atkToMatk > 0) bonus.matk += Math.floor((profile.atk || 0) * atkToMatk / 100)
  // museum_* / fishing_* は永続ボーナス専用列（基礎列の再計算で消えないよう分離）
  const baseMatk = profile.matk + bonus.matk + (profile.museum_matk || 0) + (profile.fishing_matk || 0)
  const finalMatk = matkPct > 0 ? Math.floor(baseMatk * (1 + matkPct/100)) : baseMatk
  const baseAtk = profile.atk + bonus.atk + (profile.museum_atk || 0) + (profile.fishing_atk || 0)
  const finalAtk = atkPct > 0 ? Math.floor(baseAtk * (1 + atkPct/100)) : baseAtk
  const tb = titleBonus || {}
  // 選択ペット反映（無ければ無影響）。守りは防御+10%。
  //  ・petCharm = 装備チャーム補正 / petStat = ペット本体ステ100%反映（petPlayerBonus）
  //  両者を同じ加算枠で合算する（pet.* に集約）。
  const pc = profile.petCharm || {}
  const ps = profile.petStat || {}
  const sp = pc.sp || null // チャームの特殊能力（フェイトコア抽選。%は最終値に乗算/率は加算）
  const pet = {
    atk:  (pc.atk  || 0) + (ps.atk  || 0),
    def:  (pc.def  || 0) + (ps.def  || 0),
    matk: (pc.matk || 0) + (ps.matk || 0),
    mdef: (pc.mdef || 0) + (ps.mdef || 0),
    hp:   (pc.hp   || 0) + (ps.hp   || 0),
  }
  let defVal = profile.def + bonus.def + (profile.museum_def || 0) + (profile.fishing_def || 0) + (tb.def_bonus || 0) + pet.def
  if (pc.guard) defVal = Math.round(defVal * 1.1)
  if (sp?.defPct) defVal = Math.round(defVal * (1 + sp.defPct / 100))
  const spMul = (v, pct) => (pct ? Math.round(v * (1 + pct / 100)) : v)
  return {
    atk:    spMul(finalAtk + (tb.atk_bonus || 0) + pet.atk, sp?.atkPct),
    def:    defVal,
    matk:   spMul(finalMatk + (tb.matk_bonus || 0) + pet.matk, sp?.matkPct),
    mdef:   spMul(profile.mdef + bonus.mdef + (profile.museum_mdef || 0) + (profile.fishing_mdef || 0) + (tb.mdef_bonus || 0) + pet.mdef, sp?.mdefPct),
    spd:    profile.spd  + bonus.spd  + (profile.museum_spd || 0) + (profile.fishing_spd || 0) + (tb.spd_bonus || 0),
    hp_max: profile.hp_max + bonus.hp + (profile.museum_hp || 0) + (profile.fishing_hp || 0) + (tb.hp_bonus || 0) + pet.hp,
    mp_max: profile.mp_max + bonus.mp + (profile.museum_mp || 0) + (profile.fishing_mp || 0) + (tb.mp_bonus || 0),
    bonus,
    hitBonus:     hitBonus     + gemAcc.hitBonus     + (sp?.hit || 0),
    critBonus:    critBonus    + gemAcc.critBonus    + (sp?.crit || 0),
    evasionBonus: evasionBonus + gemAcc.evasionBonus + (sp?.evade || 0),
    critResist:   critResist   + gemAcc.critResist   + (sp?.critres || 0),
    defPen:  Math.min(PEN_CAP, gemAcc.defPen/100),
    mdefPen: Math.min(PEN_CAP, gemAcc.mdefPen/100),
    critDmg: gemAcc.critDmg/100,
    ondmgSpdUp: ondmgSpdPct > 0 ? 1 + ondmgSpdPct / 100 : 0, // 被ダメ時に付与する素早さ倍率（例:1.05）。0=効果なし
    extraParaChance: Math.min(100, extraParaChance), // 追加行動ヒット時の麻痺付与率（%）
    // 閻魔装備（戦闘ループが消費）
    hitPoisonChance: Math.min(100, hitPoisonChance), // 冥獄宝珠・断罪: 攻撃ヒット時の毒付与率（%）
    gokuiTakenPct,                                   // 冥府王の獄衣: 被ダメ軽減%（HP半分以下で2倍。evoCombat.evoTakenMult が適用）
    // ボス装備 真化効果（戦闘ループが消費）
    evoDmgTakenMult, evoPhysDmgTakenMult, evoReflectPct, evoAilmentResist: evoAilmentResist + (sp?.ailRes || 0),
    evoHitSpdDown, evoHitBleed, evoHitStun, evoOndmgStun, evoOndmgBurn, evoEvadeSpdUp,
    evoAllskillAtk, evoAllskillMatk,
    evoHitCritDmg, evoCritAtkMatk, evoDmgReduceStack,  // 天空⑧ 真化スタック（天砲/指輪/聖鎧）
    weaponDmgMult,   // 武器種固有の与ダメージ倍率（斧=1.10など）
    weaponMpCostMult,// 武器種固有の消費MP倍率（魔導書=0.90など）
    // 紋章の新メカニクス（戦闘ループが消費。emblemCombat.js のヘルパー経由で使う）
    //  physDmg/specialDmg=与ダメ%、physDrain/specialDrain=与ダメ吸収%、
    //  dotUp={bleed,burn,poison}=敵への状態異常ダメUP%、ailRes={poison,paralysis,burn,bleed,stun}=個別耐性%
    emblem: emblem ? {
      physDmg: emblem.physDmg, specialDmg: emblem.specialDmg,
      physDrain: emblem.physDrain, specialDrain: emblem.specialDrain,
      dotUp: emblem.dotUp, ailRes: emblem.ailRes,
    } : null,
  }
}

// ============================================================
// ステータス内訳（ソース別）— ステータス詳細ページ用
// calcEffectiveStats と同一の計算を、寄与元ごとに分解して返す。
// effective が calcEffectiveStats の結果と一致することを前提に設計
// （ズレが出たら計算式の取りこぼし。dev で reconcile チェック推奨）。
// ※ hp/mp キーは effective 上の hp_max/mp_max に対応する。
// ※「base（基礎値）」= profile の atk/def/... 列そのもの。
//    レベル成長・ステ振り・（焼き込まれていれば釣り）を含む。
// ============================================================
const zeroStats = () => ({ atk:0, def:0, matk:0, mdef:0, spd:0, hp:0, mp:0 })

// 1個の宝石効果を target バケットへ加算（applyGemBonus と同じ分岐）
const addGemTo = (item, target, pen) => {
  if (!item.gem_type || !item.gem_rank) return
  const g = GEM_DATA[item.gem_type]; if (!g) return
  const v = gemEffectValue(item.gem_type, item.gem_rank)
  switch (g.effect) {
    case 'hp':   target.hp += v; break
    case 'mp':   target.mp += v; break
    case 'atk':  target.atk += v; break
    case 'def':  target.def += v; break
    case 'matk': target.matk += v; break
    case 'mdef': target.mdef += v; break
    case 'spd':  target.spd += v; break
    case 'atk_matk': target.atk += v; target.matk += v; break
    case 'def_mdef': target.def += v; target.mdef += v; break
    case 'def_pen':     pen.defPen += v; break
    case 'mdef_pen':    pen.mdefPen += v; break
    case 'crit':        pen.critBonus += v; break
    case 'crit_resist': pen.critResist += v; break
    case 'hit':         pen.hitBonus += v; break
    case 'evasion':     pen.evasionBonus += v; break
    case 'crit_dmg':    pen.critDmg += v; break
  }
}

export const calcStatsBreakdown = (profile, equipment, proficiency, titleBonus = null) => {
  const base    = { atk:profile.atk, def:profile.def, matk:profile.matk, mdef:profile.mdef, spd:profile.spd, hp:profile.hp_max, mp:profile.mp_max }
  const museum  = { atk:profile.museum_atk||0, def:profile.museum_def||0, matk:profile.museum_matk||0, mdef:profile.museum_mdef||0, spd:profile.museum_spd||0, hp:profile.museum_hp||0, mp:profile.museum_mp||0 }
  const fishing = { atk:profile.fishing_atk||0, def:profile.fishing_def||0, matk:profile.fishing_matk||0, mdef:profile.fishing_mdef||0, spd:profile.fishing_spd||0, hp:profile.fishing_hp||0, mp:profile.fishing_mp||0 }
  const equip = zeroStats()
  const gem   = zeroStats()
  const prof  = zeroStats()
  const tb = titleBonus || {}
  const title = { atk:tb.atk_bonus||0, def:tb.def_bonus||0, matk:tb.matk_bonus||0, mdef:tb.mdef_bonus||0, spd:tb.spd_bonus||0, hp:tb.hp_bonus||0, mp:tb.mp_bonus||0 }
  // 選択ペット反映（無ければ無影響）。calcEffectiveStats と同一処理。
  //  petCharm(装備チャーム) ＋ petStat(本体ステ100%) を「ペット」ソースに合算。
  const pc = profile.petCharm || {}
  const ps = profile.petStat || {}
  const sp = pc.sp || null // チャームの特殊能力（フェイトコア抽選。%は最終値に乗算/率は加算）
  const pet = {
    atk:(pc.atk||0)+(ps.atk||0), def:(pc.def||0)+(ps.def||0),
    matk:(pc.matk||0)+(ps.matk||0), mdef:(pc.mdef||0)+(ps.mdef||0),
    spd:0, hp:(pc.hp||0)+(ps.hp||0), mp:0,
  }

  let matkPct = 0
  let atkPct = 0
  // 派生ステ（calcEffectiveStats と同じく「合算してから一度だけ」算出する）
  let evoMpToMatk = 0, evoSpdToAtk = 0, atkToMatk = 0
  const cm = { hitBonus:0, critBonus:0, evasionBonus:0, critResist:0, defPen:0, mdefPen:0, critDmg:0 }

  // 紋章（calcEffectiveStats と一致させる）
  const emblemBonus = profile.emblemAlloc ? calcEmblemBonus(profile.emblemAlloc) : null
  const emblem = zeroStats()
  if (emblemBonus) {
    emblem.atk  += emblemBonus.flat.atk
    emblem.def  += emblemBonus.flat.def
    emblem.matk += emblemBonus.flat.matk
    emblem.mdef += emblemBonus.flat.mdef
    cm.defPen       += emblemBonus.defPen
    cm.mdefPen      += emblemBonus.mdefPen
    cm.critBonus    += emblemBonus.crit
    cm.critDmg      += emblemBonus.critDmg
    cm.critResist   += emblemBonus.critResist
    cm.evasionBonus += emblemBonus.evasion
  }

  for (const item of equipment) {
    if (!item.equipped || !item.weapons) continue
    addGemTo(item, gem, cm)
    const w = item.weapons
    const plus = item.enhance_plus || 0
    const isArtifactBase = ARTIFACT_BASE_NAMES_SET.has(w.name)
    const mult = (plus > 0 && !isArtifactBase) ? Math.pow(1.5, plus) : 1
    // ボス装備進化: 基礎ステ ×(1+0.2*evolve_stage)。calcEffectiveStats と一致させる。
    const baseMult = mult * (1 + 0.2 * (item.evolve_stage || 0))
    equip.atk  += Math.ceil((w.atk_bonus||0)  * baseMult) + (item.bonus_atk||0)
    equip.def  += Math.ceil((w.def_bonus||0)  * baseMult) + (item.bonus_def||0)
    equip.matk += Math.ceil((w.matk_bonus||0) * baseMult) + (item.bonus_matk||0)
    equip.mdef += Math.ceil((w.mdef_bonus||0) * baseMult) + (item.bonus_mdef||0)
    equip.spd  += Math.ceil((w.spd_bonus||0)  * baseMult) + (item.bonus_spd||0)
    equip.hp   += Math.ceil((w.hp_bonus||0)   * baseMult) + (item.bonus_hp||0)
    equip.mp   += Math.ceil((w.mp_bonus||0)   * baseMult) + (item.bonus_mp||0)
    if (w.hp_bonus_pct > 0)  equip.hp  += Math.floor(profile.hp_max * w.hp_bonus_pct/100)
    if (w.mp_bonus_pct > 0)  equip.mp  += Math.floor(profile.mp_max * w.mp_bonus_pct/100)
    if (w.spd_bonus_pct > 0) equip.spd += Math.floor(profile.spd   * w.spd_bonus_pct/100)
    if (w.matk_bonus_pct > 0) matkPct  += w.matk_bonus_pct
    if (w.atk_bonus_pct > 0)  atkPct   += w.atk_bonus_pct
    if (w.hit_bonus > 0) cm.hitBonus += w.hit_bonus
    cm.critBonus    += w.crit_bonus  || 0
    cm.critResist   += w.crit_resist || 0
    cm.critDmg      += w.crit_dmg    || 0   // 武器固有クリティカル威力（%。最終値で/100）
    cm.hitBonus     += item.bonus_hit     || 0
    cm.critBonus    += item.bonus_crit    || 0
    cm.evasionBonus += item.bonus_evasion || 0
    // ボス装備 真化の派生ステ（calcEffectiveStats と一致させる。真化済みは正典から解決）
    const evoEff2 = resolveBonusEffect(item, w.name)
    if (evoEff2 === 'evo_mp_to_matk_5') evoMpToMatk += 5
    if (evoEff2 === 'evo_spd_to_atk_3') evoSpdToAtk += 3
    if (evoEff2 === 'evo_mdef_pen_10')  cm.mdefPen  += 10
    // 保存済み bonus_effect をそのまま見る効果（calcEffectiveStats と一致させる）
    if (item.bonus_effect === 'mdef_pen_5')    cm.mdefPen += 5  // 水禍の蒼珠: 特殊防御貫通+5%
    if (item.bonus_effect === 'atk_to_matk_2') atkToMatk  += 2  // 六道輪廻の数珠: 攻撃力の2%を特攻へ
    if (item.slot === 'weapon') {
      // 武器種ごとの固有能力（calcEffectiveStats と一致させる）
      const wp = WEAPON_TYPE_PASSIVE[w.weapon_type]
      if (wp) {
        atkPct  += wp.atkPct  || 0
        matkPct += wp.matkPct || 0
        cm.hitBonus     += wp.hit     || 0
        cm.evasionBonus += wp.evasion || 0
        cm.defPen  += wp.defPen  || 0
        cm.mdefPen += wp.mdefPen || 0
      }
      const pr = proficiency.find(p => p.equipment_id === item.id)
      if (pr) {
        const pb = calcProfBonus(pr, w, item.evolve_stage || 0)
        prof.atk += pb.atk||0; prof.def += pb.def||0; prof.matk += pb.matk||0
        prof.mdef += pb.mdef||0; prof.spd += pb.spd||0; prof.hp += pb.hp||0; prof.mp += pb.mp||0
      }
    }
  }

  // ボス装備 真化 / 閻魔装備の派生ステ（基礎値ベース・装備ソースへ計上。calcEffectiveStats と一致）
  if (evoMpToMatk > 0) equip.matk += Math.floor((profile.mp_max || 0) * evoMpToMatk / 100)
  if (evoSpdToAtk > 0) equip.atk  += Math.floor((profile.spd    || 0) * evoSpdToAtk / 100)
  if (atkToMatk   > 0) equip.matk += Math.floor((profile.atk    || 0) * atkToMatk   / 100)

  // チャームの特殊能力（フェイトコア抽選）の率系（calcEffectiveStats と一致）
  cm.hitBonus     += sp?.hit     || 0
  cm.critBonus    += sp?.crit    || 0
  cm.evasionBonus += sp?.evade   || 0
  cm.critResist   += sp?.critres || 0

  // 実効値（matk のみ % 補正 → 称号加算の順）
  // ペットチャームは matk のみ %補正の後に加算（calcEffectiveStats と一致）。def は守りで×1.1。
  // 最後にチャーム特殊能力の%（sp）を最終値へ乗算する（calcEffectiveStats の spMul と同じ順序）。
  const spMul = (v, pctv) => (pctv ? Math.round(v * (1 + pctv / 100)) : v)
  const sumExceptTitle = (k) => base[k] + museum[k] + fishing[k] + equip[k] + gem[k] + prof[k] + emblem[k] + pet[k]
  const preMatk = base.matk + museum.matk + fishing.matk + equip.matk + gem.matk + prof.matk + emblem.matk // ペット除く（%補正の対象外）
  const effMatk = (matkPct > 0 ? Math.floor(preMatk * (1 + matkPct/100)) : preMatk) + title.matk + pet.matk
  const preAtk = base.atk + museum.atk + fishing.atk + equip.atk + gem.atk + prof.atk + emblem.atk // ペット除く（%補正の対象外）
  const effAtk = (atkPct > 0 ? Math.floor(preAtk * (1 + atkPct/100)) : preAtk) + title.atk + pet.atk
  let effDef = sumExceptTitle('def') + title.def
  if (pc.guard) effDef = Math.round(effDef * 1.1)
  if (sp?.defPct) effDef = Math.round(effDef * (1 + sp.defPct / 100))
  const effective = {
    atk:  spMul(effAtk, sp?.atkPct),
    def:  effDef,
    matk: spMul(effMatk, sp?.matkPct),
    mdef: spMul(sumExceptTitle('mdef') + title.mdef, sp?.mdefPct),
    spd:  sumExceptTitle('spd') + title.spd,
    hp:   sumExceptTitle('hp') + title.hp,
    mp:   sumExceptTitle('mp') + title.mp,
  }

  return {
    base, museum, fishing, equip, gem, prof, emblem, title, pet, petGuard: !!pc.guard, matkPct, atkPct, effective,
    // チャーム特殊能力（フェイトコア抽選）の内訳。%系は最終値への乗算、率系は combat に合算済み。
    petSp: sp ? { ...sp } : null,
    combat: {
      hitBonus: cm.hitBonus, critBonus: cm.critBonus, evasionBonus: cm.evasionBonus,
      critResist: cm.critResist,
      defPen:  Math.min(PEN_CAP, cm.defPen/100),
      mdefPen: Math.min(PEN_CAP, cm.mdefPen/100),
      critDmg: cm.critDmg/100,
    },
  }
}

// ===== 防御ランク → 被ダメージ軽減率 =====
// ★ ステータスのF~SSSランク閾値（getStatRank の物理/防御系と一致）
export const DEF_STAT_THRESHOLDS = [55, 150, 300, 550, 950, 1500, 2200, 3300]
// ★ 防御ランクに対応するダメージ軽減率(%) F=1%〜SSS=30%・均等カーブ（見直し時はここを変更）
// 線形補間されるので、防御の成長に合わせて滑らかに上昇する
export const DEF_REDUCTION_RATES = [1, 4.6, 8.3, 11.9, 15.5, 19.1, 22.8, 26.4, 30]
// 防御値からダメージ軽減率(0〜1)を線形補間で算出
export const calcDefReduction = (defVal) => {
  if (defVal <= 0) return 0
  const thresholds = [0, ...DEF_STAT_THRESHOLDS]
  const rates = DEF_REDUCTION_RATES
  if (defVal >= thresholds[thresholds.length - 1]) return rates[rates.length - 1] / 100
  for (let i = 1; i < thresholds.length; i++) {
    if (defVal <= thresholds[i]) {
      const progress = (defVal - thresholds[i-1]) / (thresholds[i] - thresholds[i-1])
      return (rates[i-1] + (rates[i] - rates[i-1]) * progress) / 100
    }
  }
  return rates[rates.length - 1] / 100
}

export const calcTotal = (p) => Math.floor((p.hp_max/10)+(p.mp_max/5)+p.atk+p.def+p.matk+p.mdef+p.spd)
export const calcEffectiveTotal = (profile, equipment, proficiency, titleBonus = null) => {
  const s = calcEffectiveStats(profile, equipment, proficiency, titleBonus)
  return Math.floor((s.hp_max/10)+(s.mp_max/5)+s.atk+s.def+s.matk+s.mdef+s.spd)
}

export const getTotalRank = (total) => {
  const thresholds = [250,600,1200,2500,5000,8500,14000,20000]
  const ranks = ['F','E','D','C','B','A','S','SS','SSS']
  const colors = ['#888888','#6699cc','#ff8844','#44bb44','#4488ff','#ff4444','#ffcc00','#ffcc00','#ffcc00']
  for (let i = 0; i < thresholds.length; i++) {
    if (total <= thresholds[i]) return { rank: ranks[i], color: colors[i] }
  }
  return { rank:'SSS', color:'#ffcc00' }
}

