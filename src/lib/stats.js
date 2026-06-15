// ============================================================
// ステータス計算 共通モジュール
// Game.jsx / Profile.jsx / Ranking.jsx で共通利用
// （表示と実効果のロジックズレを防ぐため一元管理）
// ============================================================

export const WEAPON_TYPE_GROUP = {
  sword:'physical', axe:'physical', spear:'physical', bow:'physical', dagger:'physical',
  knuckle:'physical', gun:'physical', katana:'physical',
  staff:'magical', wand:'magical', tome:'magical', orb:'magical',
}
export const getWeaponGroup = (weaponType) => WEAPON_TYPE_GROUP[weaponType] || 'physical'

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
export const calcProfBonus = (prof, weapon) => {
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
  const result = {}
  const atk  = Math.floor((weapon.atk_bonus ||0) * rate); if (atk  > 0) result.atk  = atk
  const def  = Math.floor((weapon.def_bonus ||0) * rate); if (def  > 0) result.def  = def
  const matk = Math.floor((weapon.matk_bonus||0) * rate); if (matk > 0) result.matk = matk
  const mdef = Math.floor((weapon.mdef_bonus||0) * rate); if (mdef > 0) result.mdef = mdef
  const spd  = Math.floor((weapon.spd_bonus ||0) * rate); if (spd  > 0) result.spd  = spd
  const hp   = Math.floor((weapon.hp_bonus  ||0) * rate); if (hp   > 0) result.hp   = hp
  const mp   = Math.floor((weapon.mp_bonus  ||0) * rate); if (mp   > 0) result.mp   = mp
  return result
}

// 装備＋熟練度込みの実効ステータス（titleBonus は ability_title のボーナスオブジェクト or null）
export const calcEffectiveStats = (profile, equipment, proficiency, titleBonus = null) => {
  const bonus = { atk:0, def:0, matk:0, mdef:0, spd:0, hp:0, mp:0 }
  let matkPct = 0
  let hitBonus = 0
  let critBonus = 0
  let evasionBonus = 0
  let critResist = 0
  const gemAcc = { bonus, defPen:0, mdefPen:0, critDmg:0, critBonus:0, critResist:0, hitBonus:0, evasionBonus:0 }
  for (const item of equipment) {
    if (!item.equipped || !item.weapons) continue
    applyGemBonus(item, gemAcc)
    const w = item.weapons
    const plus = item.enhance_plus || 0
    const isArtifactBase = ARTIFACT_BASE_NAMES_SET.has(w.name)
    const mult = (plus > 0 && !isArtifactBase) ? Math.pow(1.5, plus) : 1
    bonus.atk  += Math.ceil((w.atk_bonus||0)  * mult) + (item.bonus_atk||0)
    bonus.def  += Math.ceil((w.def_bonus||0)  * mult) + (item.bonus_def||0)
    bonus.matk += Math.ceil((w.matk_bonus||0) * mult) + (item.bonus_matk||0)
    bonus.mdef += Math.ceil((w.mdef_bonus||0) * mult) + (item.bonus_mdef||0)
    bonus.spd  += Math.ceil((w.spd_bonus||0)  * mult) + (item.bonus_spd||0)
    bonus.hp   += Math.ceil((w.hp_bonus||0)   * mult) + (item.bonus_hp||0)
    bonus.mp   += Math.ceil((w.mp_bonus||0)   * mult) + (item.bonus_mp||0)
    if (w.hp_bonus_pct > 0)  bonus.hp  += Math.floor(profile.hp_max * w.hp_bonus_pct/100)
    if (w.mp_bonus_pct > 0)  bonus.mp  += Math.floor(profile.mp_max * w.mp_bonus_pct/100)
    if (w.spd_bonus_pct > 0) bonus.spd += Math.floor(profile.spd   * w.spd_bonus_pct/100)
    if (w.matk_bonus_pct > 0) matkPct  += w.matk_bonus_pct
    if (w.hit_bonus > 0) hitBonus += w.hit_bonus
    critBonus   += w.crit_bonus  || 0   // 武器固有クリティカル率
    critResist  += w.crit_resist || 0   // 武器固有クリティカル抵抗
    hitBonus    += item.bonus_hit     || 0
    critBonus   += item.bonus_crit    || 0
    evasionBonus += item.bonus_evasion || 0
    if (item.bonus_effect === 'mdef_pen_5') gemAcc.mdefPen += 5  // 水禍の蒼珠: 魔法防御貫通+5%
    if (item.slot === 'weapon') {
      const prof = proficiency.find(p => p.equipment_id === item.id)
      if (prof) {
        const pb = calcProfBonus(prof, w)
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
  // museum_* / fishing_* は永続ボーナス専用列（基礎列の再計算で消えないよう分離）
  const baseMatk = profile.matk + bonus.matk + (profile.museum_matk || 0) + (profile.fishing_matk || 0)
  const finalMatk = matkPct > 0 ? Math.floor(baseMatk * (1 + matkPct/100)) : baseMatk
  const tb = titleBonus || {}
  // 選択ペットの装備チャーム反映（profile.petCharm が無ければ無影響）。守りは防御+10%
  const pc = profile.petCharm || {}
  let defVal = profile.def + bonus.def + (profile.museum_def || 0) + (profile.fishing_def || 0) + (tb.def_bonus || 0) + (pc.def || 0)
  if (pc.guard) defVal = Math.round(defVal * 1.1)
  return {
    atk:    profile.atk  + bonus.atk  + (profile.museum_atk || 0) + (profile.fishing_atk || 0) + (tb.atk_bonus || 0) + (pc.atk || 0),
    def:    defVal,
    matk:   finalMatk + (tb.matk_bonus || 0) + (pc.matk || 0),
    mdef:   profile.mdef + bonus.mdef + (profile.museum_mdef || 0) + (profile.fishing_mdef || 0) + (tb.mdef_bonus || 0) + (pc.mdef || 0),
    spd:    profile.spd  + bonus.spd  + (profile.museum_spd || 0) + (profile.fishing_spd || 0) + (tb.spd_bonus || 0),
    hp_max: profile.hp_max + bonus.hp + (profile.museum_hp || 0) + (profile.fishing_hp || 0) + (tb.hp_bonus || 0) + (pc.hp || 0),
    mp_max: profile.mp_max + bonus.mp + (profile.museum_mp || 0) + (profile.fishing_mp || 0) + (tb.mp_bonus || 0),
    bonus,
    hitBonus:     hitBonus     + gemAcc.hitBonus,
    critBonus:    critBonus    + gemAcc.critBonus,
    evasionBonus: evasionBonus + gemAcc.evasionBonus,
    critResist:   critResist   + gemAcc.critResist,
    defPen:  Math.min(PEN_CAP, gemAcc.defPen/100),
    mdefPen: Math.min(PEN_CAP, gemAcc.mdefPen/100),
    critDmg: gemAcc.critDmg/100,
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
  // 選択ペットの装備チャーム反映（profile.petCharm が無ければ無影響）。calcEffectiveStats と同一処理。
  const pc = profile.petCharm || {}
  const pet = { atk:pc.atk||0, def:pc.def||0, matk:pc.matk||0, mdef:pc.mdef||0, spd:0, hp:pc.hp||0, mp:0 }

  let matkPct = 0
  const cm = { hitBonus:0, critBonus:0, evasionBonus:0, critResist:0, defPen:0, mdefPen:0, critDmg:0 }

  for (const item of equipment) {
    if (!item.equipped || !item.weapons) continue
    addGemTo(item, gem, cm)
    const w = item.weapons
    const plus = item.enhance_plus || 0
    const isArtifactBase = ARTIFACT_BASE_NAMES_SET.has(w.name)
    const mult = (plus > 0 && !isArtifactBase) ? Math.pow(1.5, plus) : 1
    equip.atk  += Math.ceil((w.atk_bonus||0)  * mult) + (item.bonus_atk||0)
    equip.def  += Math.ceil((w.def_bonus||0)  * mult) + (item.bonus_def||0)
    equip.matk += Math.ceil((w.matk_bonus||0) * mult) + (item.bonus_matk||0)
    equip.mdef += Math.ceil((w.mdef_bonus||0) * mult) + (item.bonus_mdef||0)
    equip.spd  += Math.ceil((w.spd_bonus||0)  * mult) + (item.bonus_spd||0)
    equip.hp   += Math.ceil((w.hp_bonus||0)   * mult) + (item.bonus_hp||0)
    equip.mp   += Math.ceil((w.mp_bonus||0)   * mult) + (item.bonus_mp||0)
    if (w.hp_bonus_pct > 0)  equip.hp  += Math.floor(profile.hp_max * w.hp_bonus_pct/100)
    if (w.mp_bonus_pct > 0)  equip.mp  += Math.floor(profile.mp_max * w.mp_bonus_pct/100)
    if (w.spd_bonus_pct > 0) equip.spd += Math.floor(profile.spd   * w.spd_bonus_pct/100)
    if (w.matk_bonus_pct > 0) matkPct  += w.matk_bonus_pct
    if (w.hit_bonus > 0) cm.hitBonus += w.hit_bonus
    cm.critBonus    += w.crit_bonus  || 0
    cm.critResist   += w.crit_resist || 0
    cm.hitBonus     += item.bonus_hit     || 0
    cm.critBonus    += item.bonus_crit    || 0
    cm.evasionBonus += item.bonus_evasion || 0
    if (item.slot === 'weapon') {
      const pr = proficiency.find(p => p.equipment_id === item.id)
      if (pr) {
        const pb = calcProfBonus(pr, w)
        prof.atk += pb.atk||0; prof.def += pb.def||0; prof.matk += pb.matk||0
        prof.mdef += pb.mdef||0; prof.spd += pb.spd||0; prof.hp += pb.hp||0; prof.mp += pb.mp||0
      }
    }
  }

  // 実効値（matk のみ % 補正 → 称号加算の順）
  // ペットチャームは matk のみ %補正の後に加算（calcEffectiveStats と一致）。def は守りで×1.1。
  const sumExceptTitle = (k) => base[k] + museum[k] + fishing[k] + equip[k] + gem[k] + prof[k] + pet[k]
  const preMatk = base.matk + museum.matk + fishing.matk + equip.matk + gem.matk + prof.matk // ペット除く（%補正の対象外）
  const effMatk = (matkPct > 0 ? Math.floor(preMatk * (1 + matkPct/100)) : preMatk) + title.matk + pet.matk
  let effDef = sumExceptTitle('def') + title.def
  if (pc.guard) effDef = Math.round(effDef * 1.1)
  const effective = {
    atk:  sumExceptTitle('atk') + title.atk,
    def:  effDef,
    matk: effMatk,
    mdef: sumExceptTitle('mdef') + title.mdef,
    spd:  sumExceptTitle('spd') + title.spd,
    hp:   sumExceptTitle('hp') + title.hp,
    mp:   sumExceptTitle('mp') + title.mp,
  }

  return {
    base, museum, fishing, equip, gem, prof, title, pet, petGuard: !!pc.guard, matkPct, effective,
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

