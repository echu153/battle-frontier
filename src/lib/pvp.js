// ============================================================
// 対人戦（PvP）戦闘シミュレーション
// ------------------------------------------------------------
// 既存PvE戦闘エンジン（Game.jsx の executeSkill 等）を、両プレイヤーへ
// 対称適用したもの。Tenkyuu/Abyss の doPlayerAttack を一般化し、
// 「攻撃側(att)」「防御側(def)」のどちらもフルスキルで殴り合う。
//
// PvP固有ルール（要件）:
//  ・与ダメージ軽減は「攻撃力側」で行う。防御との突き合わせ(defScale=atk/(atk+def))に
//    使う攻撃値を ratioAtkMult 倍に縮小し、防御(def/mdef)のレバレッジを大きくする。
//    さらに最終倍率 dmgMult で全体量を調整。これにより防御特化が効く。
//    ※ executeSkill に渡すステ自体は縮小しない＝**回復(ヒール/吸収)量は満額のまま**。
//  ・回復量は減少なし（×1.0）               … PVP.healMult
//  ・クリティカル率・回避率はどちらも「相手との素早さ差」で決まり、相手の2倍の素早さで上限。素早さ由来ぶんに ×1.5（PVP.spdBonusMult＝上限20%→30%）。フラット加算には掛けない。
//  ・素早さが速い方が先攻。HP0で決着。50ターンで強制終了＝与えたダメージ総量が多い方の勝ち（同量は引分）。
//
// スキルは各自の「出撃」スキルセットを反映（呼び出し側で sortie を渡す）。
// 報酬・永続化は無し（呼び出し側で勝敗のみ一時記録）。
//
// 戻り値: { logs, winner /* 'A' | 'B' | 'draw' */, turns, aHpPct, bHpPct }
// ============================================================
import { getWeaponGroup } from './stats'
import { evoOnHit, evoOnEvade, evoTakenMult, evoAllSkillsSet, evoAtkMult, evoMatkMult, evoBlocksAilment, evoResistNewAilments } from './evoCombat'
import { emblemDmgMult, emblemDrainAmount, emblemDotMult, emblemResistNewAilments, emblemBlocksAilment } from './emblemCombat'
import { petStats } from '../constants/pets'
import {
  calcEvasionRate,
  BREEDER_PET_SKILLS,
  calcExtraActionRate,
  calcDefReduction,
  applyEquipmentEffects,
  consumeAilmentShield,
  executeSkill,
  extractStatuses,
  MULTI_HIT_SKILLS,
  isSelfTargetSkill,
} from '../pages/Game'

const PVP = {
  ratioAtkMult: 0.25, // defScale で使う攻撃値の縮小率（小さいほど防御が効く＝防御レバレッジ大）
  dmgMult: 0.125,     // 最終ダメージ倍率（全体量の調整つまみ。0.25→0.125で全体ダメージ半減）
  healMult: 1.0,      // 回復量は減少なし
  turnCap: 50,        // ターン上限（対人は50ターンで強制終了。戦争は別途WAR_TURN_CAPで上書き）
  spdBonusMult: 1.5,  // 対人固有：素早さ由来の回避率/クリティカル率を1.5倍（上限UP：回避20→30% / クリ素早さ補正20→30%）
}
// PvP固有の素早さ補正：素早さ由来の「回避率」「クリティカル率」を ×PVP.spdBonusMult（=1.5）。
// どちらも相手との素早さ差(calcEvasionRate)から算出＝相手の2倍の素早さで上限（通常20%→PvP30%）。
// フラットな装備/パッシブ加算（critBonus/evasionBonus/心眼/隠身 等）には掛けない。

// 1プレイヤー分の戦闘状態を組み立てる。
//  input: { eff, equipment, skillSets, proficiency, profile, playerItem }
//  hpBonus: 最大HP加算（組み手は0＝素のステで戦う。旧対人戦テストパネルは20000を渡す）
function buildSide(input, key, hpBonus = 0) {
  const { equipment, skillSets, profile } = input
  const eff = { ...input.eff, hp_max: (input.eff?.hp_max || 0) + hpBonus }
  const equippedWeaponItem = equipment.find(e => e.slot === 'weapon' && e.equipped)
  const weaponType = equippedWeaponItem?.weapons?.weapon_type || 'sword'
  const isMagical = getWeaponGroup(weaponType) === 'magical'
  const isArtifact = equippedWeaponItem?.bonus_effect === 'artifact'

  const passiveNames = skillSets.filter(ss => ss.skills?.type === 'パッシブ').map(ss => ss.skills.name)
  const has = (n) => passiveNames.includes(n)
  const rtCur = (profile.retraining || {})[profile.class] || 0
  const pe = (cls) => profile.class === cls && rtCur >= 3

  // 精霊共鳴（再修練1+）: 最大MP+20%（mp初期値/回復上限/表示すべてに反映）
  if (profile.class === '精霊召喚士' && rtCur >= 1 && has('精霊共鳴')) {
    eff.mp_max = Math.floor(eff.mp_max * 1.2)
  }

  // ブリーダー：ペット召喚（ステ×2・HP×5の独立エンティティ）
  let petActive = false, petHp = 0, petMaxHp = 0, petAtk = 0, petDef = 0, petMdef = 0, petAtkType = 'phys', petSpecies = null
  if (profile.class === 'ブリーダー' && has('ペット召喚') && profile.activePet?.species) {
    const ps = petStats(profile.activePet)
    petAtk = ps.atk * 2; petDef = ps.def * 2; petMdef = ps.mdef * 2
    petMaxHp = ps.maxHp * 5; petHp = petMaxHp
    petAtkType = ps.atkType; petSpecies = profile.activePet.species
    petActive = true
  }

  const hasShingan   = has('心眼')
  const hasBerserk   = has('バーサク')
  const hasTakaNoMe  = has('鷹ノ目')
  const hasKakushin  = has('執行本能')
  const hasShinkoka  = has('神聖加護')
  const hasTenki     = has('天啓')
  const hasRokkan    = has('第六感')
  const hasSeimitsu  = has('精密照準')
  const hasTosoHonno = has('闘争本能')
  const hasOnmi      = has('隠身')

  const passiveCritBonus    = hasShingan ? 5 : 0
  const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.2 : 0
  const passiveDmgMult      = (hasShingan ? (pe('侍') ? 1.10 : 1.05) : 1.0) * (hasBerserk ? (pe('狂戦士') ? 1.20 : 1.15) : 1.0) * (hasKakushin ? (pe('異端審問官') ? 1.15 : 1.1) : 1.0) * (hasRokkan ? (pe('サイキッカー') ? 1.10 : 1.05) : 1.0) * (eff.weaponDmgMult || 1)
  const passiveHealMult     = (hasShinkoka ? (pe('聖職者') ? 1.4 : 1.2) : 1.0) * (hasKakushin ? 0.7 : 1.0)
  const passiveMatkMult     = hasShinkoka ? 1.1 : 1.0
  const passiveMpCostMult   = (hasTenki ? 0.9 : 1.0) * (eff.weaponMpCostMult || 1)
  const passiveMatkMultTenki = hasTenki ? (pe('賢者') ? 1.3 : 1.1) : 1.0
  const passiveHitBonus     = (hasRokkan ? 5 : 0) + (hasSeimitsu ? 5 : 0) + ((hasTakaNoMe && pe('狩人')) ? 10 : 0)
  const passiveHealReflect  = (hasShinkoka && pe('聖職者'))
  const hasMadokenJutsu     = has('魔導剣術')
  const hasHolyKnightPassive = has('聖騎士の心得')

  const expandedSkillSet = []
  for (const ss of skillSets) {
    if (ss.skills?.type === 'パッシブ') continue
    const count = ss.use_count || 1
    for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
  }

  const effectiveSpdForCalc = hasTakaNoMe ? Math.floor(eff.spd * 1.2) : eff.spd
  const ondmgSpdUp = eff.ondmgSpdUp || 0

  return {
    key,
    eff,
    profile,
    equipment,
    isMagical,
    isArtifact,
    equippedWeaponItem,
    effectiveSpdForCalc,
    ondmgSpdUp,
    expandedSkillSet,
    allSkillsSet: evoAllSkillsSet(skillSets),  // 深紅の牙輪/魔眼石の真化条件
    // 状態
    hp: eff.hp_max,
    mp: eff.mp_max,
    dmgDealt: 0,  // 与えたダメージ総量（50ターン到達＝強制終了時の勝敗判定に使用）
    buffs: {},
    skillIndex: 0,
    prevSkillName: null,
    prevDmgSkillName: null,
    // パッシブ
    rtCur, pe,
    hasSpiritResonance: has('精霊共鳴'),
    hasShikigami: has('式神召喚'),
    // ブリーダー：ペット
    petActive, petHp, petMaxHp, petAtk, petDef, petMdef, petAtkType, petSpecies,
    petBuffs: { reduce: 0, reduceTurns: 0 },
    hasBerserk, hasOnmi, hasMadokenJutsu, hasHolyKnightPassive, hasTosoHonno,
    passiveCritBonus, passiveCritDmgBonus, passiveDmgMult, passiveHealMult,
    passiveMatkMult, passiveMpCostMult, passiveMatkMultTenki, passiveHitBonus, passiveHealReflect,
    // 速さ由来の命中・クリ
    playerHitBonus: (eff.hitBonus || 0) + passiveHitBonus,
    // クリ率の素早さ由来ぶんは doAttack で相手との素早さ差から算出（回避と同式）。ここはフラット加算のみ。
    critFlatBonus: passiveCritBonus + (eff.critBonus || 0),
  }
}

// 防御側の executeSkill 用「enemy」オブジェクト（参照する項目のみ）
const defenderEnemyObj = (def) => ({
  name: def.profile.username,
  def: def.eff.def,
  mdef: def.eff.mdef,
  isPapia: false,
})

// att が def を攻撃する（PvE doPlayerAttack の対称版）
function doAttack(att, def, isExtra, ctx) {
  const logs = ctx.logs
  const eff = att.eff
  const attBuffs = att.buffs
  const defBuffs = def.buffs
  const profile = att.profile
  const enemyName = def.profile.username
  const enemyObj = defenderEnemyObj(def)
  // 防御無視の最低ダメージ（戦争用）。攻撃が当たった(res.dmg>0/通常攻撃)時、これ未満なら底上げ。
  const minDmg = ctx.minDmgPct > 0 ? Math.max(1, Math.floor((def.eff.hp_max || 0) * ctx.minDmgPct)) : 0

  // ===== 施術ステータス（自分のバフ反映） =====
  const holyFieldDef = attBuffs.holyField?.turns > 0 ? attBuffs.holyField.rate : 1.0
  const holyKnightMult = att.hasHolyKnightPassive ? (att.pe('聖騎士') ? 1.3 : 1.2) : 1.0
  const kabeDefP = (attBuffs.dmgReduce?.isGainoKabe && att.pe('死霊使い')) ? 1.2 : 1.0
  const pDef  = eff.def  * (attBuffs.defUp ? attBuffs.defUp.rate : 1) * holyFieldDef * holyKnightMult * kabeDefP
  const pMdef = eff.mdef * (attBuffs.mdefUp ? attBuffs.mdefUp.rate : 1) * (attBuffs.defUp ? attBuffs.defUp.rate : 1) * holyFieldDef * holyKnightMult * kabeDefP
  const burnDebuffP = attBuffs.burn?.turns > 0 ? 0.9 : 1.0
  const madokenBonus = att.hasMadokenJutsu ? Math.floor(eff.matk * (att.pe('魔法剣士') ? 0.6 : 0.3)) : 0
  const pMatk = (eff.matk - madokenBonus) * (attBuffs.matkUp ? attBuffs.matkUp.rate : 1) * att.passiveMatkMult * att.passiveMatkMultTenki * burnDebuffP * evoMatkMult(eff, att.allSkillsSet)
  const pAtk  = (eff.atk + madokenBonus) * (attBuffs.atkUp ? attBuffs.atkUp.rate : 1) * (attBuffs.atkDown ? attBuffs.atkDown.rate : 1) * burnDebuffP * evoAtkMult(eff, att.allSkillsSet)
  const paralysisSpdP = attBuffs.paralysis?.turns > 0 ? (attBuffs.paralysis.spdRate || 0.8) : 1.0
  const pSpd = att.effectiveSpdForCalc * (attBuffs.spdUp ? attBuffs.spdUp.rate : 1) * paralysisSpdP
  const effBuff = { ...eff, atk: pAtk, def: pDef, mdef: pMdef, matk: pMatk, spd: pSpd }
  // 防御との突き合わせ(defScale)に使う攻撃値だけを縮小（防御のレバレッジを上げる）。
  // res.dmg / res.heal は満額の effBuff から算出されるので回復量には影響しない。
  const ratioAtk  = pAtk  * PVP.ratioAtkMult
  const ratioMatk = pMatk * PVP.ratioAtkMult

  // 防御側の防御率（バフ＋攻撃側の貫通）
  const eDefRate  = (defBuffs.defDown  ? defBuffs.defDown.rate  : 1) * (defBuffs.defUp  ? defBuffs.defUp.rate  : 1) * (1 - (eff.defPen  || 0))
  const eMdefRate = (defBuffs.mdefDown ? defBuffs.mdefDown.rate : 1) * (defBuffs.mdefUp ? defBuffs.mdefUp.rate : 1) * (1 - (eff.mdefPen || 0))

  const prefix = isExtra ? `↳ ${profile.username} の` : `${profile.username} の`

  // 素早さの実効値。クリ率・回避率とも「相手との素早さ差」で決まり、相手の2倍の素早さで上限（回避と同式）。
  const atkSpdEff = pSpd
  const defSpdEff = def.effectiveSpdForCalc * (defBuffs.spdUp ? defBuffs.spdUp.rate : 1) * (defBuffs.spdDown ? defBuffs.spdDown.rate : 1)

  // クリティカル率：攻撃側が防御側より速いほど上昇・防御側の2倍で上限（素早さ由来ぶんに×1.5）。
  //   フラット加算(critFlatBonus=心眼/宝石等)は別枠。防御側のクリ抵抗で減算。
  const critSpdRate = calcEvasionRate(atkSpdEff, defSpdEff) * PVP.spdBonusMult
  const critRate = Math.max(0, critSpdRate + att.critFlatBonus - (def.eff.critResist || 0) - (defBuffs.critResist?.turns > 0 ? (defBuffs.critResist.value || 0) : 0))
  const isCrit = Math.random() * 100 < critRate
  const critMult = isCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0

  // 防御側の回避率（攻撃側より速いほど上昇・攻撃側の2倍で上限）
  const defEvasion = calcEvasionRate(defSpdEff, atkSpdEff) * PVP.spdBonusMult + (def.eff.evasionBonus || 0) + (defBuffs.evasion?.turns > 0 ? defBuffs.evasion.rate * 100 : 0) + (def.hasOnmi ? 5 : 0)
  const buffHitBonus = attBuffs.hitBonus?.turns > 0 ? attBuffs.hitBonus.value : 0

  // 真化の被ダメージ時トリガー（フロストバーンの聖鎧=スタン / インフェルノバスティオン=やけど）を
  // 攻撃側へ付ける予約。att.buffs はスキル解決後に res.newPlayerBuffs へ置換されるため、
  // dealToDef の中で直接書くと捨てられる。ここに溜めて行動の最後（applyOndmgAilments）で適用する。
  const ondmgPending = []
  const applyOndmgAilments = () => {
    for (const key of ondmgPending.splice(0)) {
      if (att.hp <= 0) return
      if (key === 'stun' && att.buffs.stun?.turns > 0) continue
      if (key === 'burn' && att.buffs.burn?.turns > 0) continue
      if (emblemBlocksAilment(att.eff, key, ctx.logs) || evoBlocksAilment(att.eff, key, ctx.logs)) continue
      // 装備の出所はログに出さない（状態異常アイコンで分かるためログ不要）。付与自体は従来どおり
      if (key === 'stun') att.buffs.stun = { turns: 1 }
      else att.buffs.burn = { turns: 5, dmgRate: 0.02 }
    }
  }

  // 与ダメージを防御側HPへ適用するヘルパ
  // ブリーダー：防御側のペット生存時は50%でペットが受ける
  const dealToDef = (amt) => {
    if (amt <= 0) return
    if (def.petActive && def.petHp > 0 && Math.random() < 0.5) {
      const cut = def.petBuffs.reduceTurns > 0 ? (1 - def.petBuffs.reduce) : 1.0
      const d = Math.max(1, Math.floor(amt * cut))
      def.petHp = Math.max(0, def.petHp - d)
      att.dmgDealt += d  // 与ダメ総量：ペットに入ったぶんも計上
      ctx.logs.push({ text: `↳ 攻撃は${def.profile.username}のペットに！ ${d}ダメージ（残りHP${def.petHp}）`, color: '#ff8844' })
      if (def.petHp <= 0) ctx.logs.push({ text: `💥 ${def.profile.username}のペットは倒れた…`, color: '#ff4444' })
    } else {
      def.hp -= amt
      att.dmgDealt += amt  // 与ダメ総量
      // 真化（防御側の装備）: 反射 → 攻撃側へ（嵐の重装甲）。
      // スタン/やけど（聖鎧/インフェルノ）は予約して行動の最後に付ける（バフ置換で消えるため）。
      if ((def.eff.evoOndmgStun || 0) > 0 && Math.random() * 100 < def.eff.evoOndmgStun) ondmgPending.push('stun')
      if ((def.eff.evoOndmgBurn || 0) > 0 && Math.random() * 100 < def.eff.evoOndmgBurn) ondmgPending.push('burn')
      if ((def.eff.evoReflectPct || 0) > 0) {
        const refl = Math.max(1, Math.floor(amt * def.eff.evoReflectPct / 100))
        att.hp -= refl
        def.dmgDealt += refl  // 反射は防御側が「与えたダメージ」（確定＝回避不可）
        // HPが動くので事象は残す。ただし出所（真化）は書かない
        ctx.logs.push({ text:`🛡 ${def.profile.username}の反射！ ${att.profile.username}に${refl}ダメージ！`, color:'#66ccff' })
      }
    }
  }
  // 防御側の被ダメ軽減（ランク軽減＋dmgReduceバフ＋真化%軽減）。物理/特殊で参照ステ切替
  const defReduceMult = (useMagical) => {
    const rankRed = calcDefReduction(useMagical ? def.eff.mdef : def.eff.def)
    const dr = defBuffs.dmgReduce?.turns > 0 ? defBuffs.dmgReduce.rate : 1.0
    return (1 - rankRed) * dr * evoTakenMult(def.eff, !useMagical, def.hp / (def.eff.hp_max || 1))
  }

  // 次に使うスキルを覗き見（MP不足判定・必中判定）
  const peekIdx = attBuffs.berserk?.turns > 0 && attBuffs.berserk.lockedSkill
    ? att.expandedSkillSet.findIndex(ss => ss.skills?.name === attBuffs.berserk.lockedSkill)
    : (att.skillIndex % (att.expandedSkillSet.length || 1))
  const nextSkill = att.expandedSkillSet.length > 0 ? att.expandedSkillSet[Math.max(0, peekIdx)]?.skills : null
  const nextSkillName = nextSkill?.name || null
  let mpLack = false
  if (nextSkill) {
    let peekMpCost = Math.floor((att.isArtifact ? (nextSkill.mp_cost || 0) * 2 : (nextSkill.mp_cost || 0)) * att.passiveMpCostMult)
    if (nextSkill.name === 'マナボルト') peekMpCost = Math.max(1, Math.floor(att.mp * 0.1))
    mpLack = att.mp < peekMpCost
    if (mpLack) logs.push({ text: `💧 ${profile.username}はMPが足りなくてスキルが使えない！`, color: '#6699ff' })
  }
  const isSureHit = !mpLack && nextSkillName === '絶影狙撃'
  const isSelfSkill = !mpLack && isSelfTargetSkill(nextSkill, attBuffs)
  const isMultiHitSkill = !mpLack && nextSkill && MULTI_HIT_SKILLS.has(nextSkill.name)
  const skillExtraHit = (nextSkillName === '連装銃撃' && profile.class === '魔銃士' && att.rtCur >= 2) ? 10 : 0
  const baseDefEvasion = Math.max(0, defEvasion - att.playerHitBonus - buffHitBonus - skillExtraHit)
  const effectiveDefEvasion = (isSureHit || isSelfSkill || isMultiHitSkill) ? 0 : baseDefEvasion

  // 回避された場合（追撃系はメイン回避でも独立発動）
  if (effectiveDefEvasion > 0 && Math.random() * 100 < effectiveDefEvasion) {
    logs.push({ text: `${prefix}${nextSkillName && !mpLack ? `${nextSkillName}！` : '攻撃！'} しかし${enemyName}に回避された！`, color: '#446688' })
    evoOnEvade(def.eff, defBuffs, logs)  // 影踏みのブーツ（回避した防御側）
    if (nextSkill && !mpLack) {
      const resPeek = executeSkill(nextSkill, effBuff, profile, enemyObj, defBuffs, attBuffs, att.isArtifact, att.prevSkillName)
      if (resPeek.followup && resPeek.followup.dmg > 0) {
        const adjED = Math.max(1, Math.floor((def.eff.def || 0) * eDefRate))
        const fScale = ratioAtk / (ratioAtk + adjED)
        const fCrit = Math.random() * 100 < critRate
        const fCritMult = fCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0
        const dr = defBuffs.dmgReduce?.turns > 0 ? defBuffs.dmgReduce.rate : 1.0
        let fDmg = Math.floor(resPeek.followup.dmg * fScale * fCritMult * att.passiveDmgMult * dr * (1 - calcDefReduction(def.eff.def)) * PVP.dmgMult * ctx.atkDmgMult * (0.9 + Math.random() * 0.2))
        fDmg = Math.max(1, fDmg)
        dealToDef(fDmg)
        logs.push({ text: `↳ 追撃！${resPeek.followup.label ? `（${resPeek.followup.label}）` : ''} ${enemyName}に${fDmg}ダメージ！${fCrit ? ' 💥クリティカル！' : ''}`, color: fCrit ? '#ffaa00' : '#ffaa66' })
      }
    }
    if (att.expandedSkillSet.length > 0) att.skillIndex++
    applyOndmgAilments()
    return
  }

  // バーサク中はロックされたスキルに固定
  if (attBuffs.berserk?.turns > 0 && attBuffs.berserk.lockedSkill) {
    const lockedIdx = att.expandedSkillSet.findIndex(ss => ss.skills?.name === attBuffs.berserk.lockedSkill)
    if (lockedIdx >= 0) att.skillIndex = lockedIdx
  }
  // 天墜竜閃の溜め中：次手番を必ず天墜竜閃(解放)に固定（他エンジンと同様）
  if (attBuffs.tenkaiCharge?.turns > 0) {
    const tIdx = att.expandedSkillSet.findIndex(ss => ss.skills?.name === '天墜竜閃')
    if (tIdx >= 0) att.skillIndex = tIdx
  }

  let skillUsed = false
  if (att.expandedSkillSet.length > 0) {
    const cs = att.expandedSkillSet[att.skillIndex % att.expandedSkillSet.length]
    let mpCost = Math.floor((att.isArtifact ? (cs?.skills?.mp_cost || 0) * 2 : (cs?.skills?.mp_cost || 0)) * att.passiveMpCostMult)
    if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(att.mp * 0.1))
    if (cs?.skills?.name === '天墜竜閃' && attBuffs.tenkaiCharge?.turns > 0) mpCost = 0
    // ブリーダー：ペット系コマンド（ペット不在/MP不足は失敗＝通常攻撃へ）
    if (cs?.skills && BREEDER_PET_SKILLS.has(cs.skills.name)) {
      const petAlive = att.petActive && att.petHp > 0
      if (petAlive && att.mp >= mpCost) {
        att.mp -= mpCost
        const nm = cs.skills.name
        if (nm === '攻撃して！') { if (petAttackPvp(att, def, att.rtCur >= 2 ? 3.5 : 3.0, '攻撃して！', logs)) return }
        else if (nm === 'やっちゃえ！') { if (petAttackPvp(att, def, att.rtCur >= 5 ? 6.0 : 5.0, 'やっちゃえ！', logs)) return }
        else if (nm === '一緒に頑張ろう！') {
          const t = att.rtCur >= 3 ? 6 : 3
          attBuffs.breederDmgUp = { turns: t, rate: 1.5 }
          logs.push({ text: `${prefix}一緒に頑張ろう！ ${t}ターンの間、自分とペットの与ダメージ+50%！`, color: '#ffcc66' })
        } else if (nm === '休憩しよう！') {
          const ph = Math.floor(att.eff.hp_max * 0.2); att.hp = Math.min(att.eff.hp_max, att.hp + ph)
          const pph = Math.floor(att.petMaxHp * 0.2); att.petHp = Math.min(att.petMaxHp, att.petHp + pph)
          let cutTxt = ''
          if (att.rtCur >= 4) { attBuffs.dmgReduce = { turns: 1, rate: 0.7 }; att.petBuffs.reduce = 0.3; att.petBuffs.reduceTurns = 1; cutTxt = ' 1ターン被ダメ30%カット！' }
          logs.push({ text: `${prefix}休憩しよう！ 自分のHP+${ph}・ペットのHP+${pph}！${cutTxt}`, color: '#66ddaa' })
        }
        att.skillIndex++
        applyOndmgAilments()
        return
      } else {
        logs.push({ text: `${prefix}${cs.skills.name}！ しかしペットがいない…通常攻撃になった！`, color: '#888888' })
      }
    }
    if (cs && cs.skills && !BREEDER_PET_SKILLS.has(cs.skills.name) && att.mp >= mpCost) {
      att.mp -= mpCost
      if (cs.skills.name === '天墜竜閃') att.tenkaiActedThisTurn = true  // 溜め/解放どちらでも当ターンは追加行動なし
      const hasGensoKyomei = att.expandedSkillSet.some(ss => ss.skills?.name === '元素共鳴') // 安全側（パッシブはexpandedに無いので実質false）
      void hasGensoKyomei
      const gensoMult = 1.0  // 元素共鳴はパッシブ枠のため expanded には入らない。PvEと厳密一致は後日。
      const seimitsuMult = 1.0
      att.prevSkillName = cs.skills.name
      const res = executeSkill(cs.skills, { ...effBuff, lastMpCost: mpCost }, profile, enemyObj, defBuffs, attBuffs, att.isArtifact, att.prevSkillName)
      const finalCrit = res.dmg > 0 && (isCrit || (res.bonusCritRate > 0 && Math.random() * 100 < critRate + res.bonusCritRate))
      const finalCritMult = finalCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0
      const tosoMult = (att.hasTosoHonno && att.hp <= eff.hp_max * 0.5) ? (att.pe('体術師') ? 1.25 : 1.1) : 1.0
      const sType = cs.skills?.type
      let defScale = 1.0
      let useMagicalRank = sType === '魔法攻撃'
      if (res.dmg > 0) {
        const buffPen = attBuffs.mukyoPen?.turns > 0 ? attBuffs.mukyoPen.rate : 0
        const spMdefPen = attBuffs.spiritMdefPen?.turns > 0 ? attBuffs.spiritMdefPen.rate : 0  // ノクス：魔法防御貫通バフ
        const adjED  = Math.max(1, Math.floor((def.eff.def  || 0) * eDefRate  * (1 - Math.min(0.8, (res.defPen || 0) + buffPen))))
        const adjEMD = Math.max(1, Math.floor((def.eff.mdef || 0) * eMdefRate * (1 - Math.min(0.8, (res.mdefPen || 0) + spMdefPen))))
        if (res.physScaleMatk) {
          // 物理ダメージ（敵DEFで軽減）だが火力参照は特殊攻撃（オオカミ召喚など）
          defScale = ratioMatk / (ratioMatk + adjED); useMagicalRank = false
        } else if (cs.skills?.name === 'サイコブラスト' || res.useMinDef) {
          defScale = ratioMatk / (ratioMatk + Math.min(adjED, adjEMD))
          useMagicalRank = adjEMD <= adjED
        } else if (sType === '物理攻撃') { defScale = ratioAtk / (ratioAtk + adjED); useMagicalRank = false }
        else if (sType === '魔法攻撃') { defScale = ratioMatk / (ratioMatk + adjEMD); useMagicalRank = true }
      }
      const allinDebuffOutMult = attBuffs.allinDebuff?.turns > 0 ? 0.7 : 1.0
      const reduceMult = defReduceMult(useMagicalRank)
      const isPhysSkill = cs.skills?.type === '物理攻撃'
      const emMult = emblemDmgMult(eff, isPhysSkill)  // 紋章: 物理/特殊ダメージUP

      const isMulti = Array.isArray(res.hitDmgs) && res.hitDmgs.length > 0 && res.dmg > 0
      let finalDmg, resLog, multiCritAny = false
      if (isMulti) {
        const hitMult = defScale * att.passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * reduceMult * PVP.dmgMult * ctx.atkDmgMult * emMult
        const parts = []
        finalDmg = 0
        for (const hd of res.hitDmgs) {
          if (baseDefEvasion > 0 && Math.random() * 100 < baseDefEvasion) { parts.push('回避された！'); continue }
          const hCrit = Math.random() * 100 < (critRate + (res.bonusCritRate || 0))
          const hMult = hCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0
          const hDmg = Math.max(1, Math.floor(hd * hitMult * hMult * (0.9 + Math.random() * 0.2)))
          if (hCrit) multiCritAny = true
          finalDmg += hDmg
          parts.push(`${hDmg}ダメージ！${hCrit ? '💥' : ''}`)
        }
        if (minDmg > 0) finalDmg = Math.max(finalDmg, minDmg)  // 戦争: 防御無視の最低ダメージ保証（合計）
        resLog = `${res.log.split('！')[0]}！ ${enemyName}に ${parts.join(' ')}`
      } else {
        finalDmg = Math.floor(res.dmg * defScale * finalCritMult * att.passiveDmgMult * gensoMult * tosoMult * seimitsuMult * allinDebuffOutMult * reduceMult * PVP.dmgMult * ctx.atkDmgMult * emMult * (0.9 + Math.random() * 0.2))
        if (res.dmg > 0 && minDmg > 0) finalDmg = Math.max(finalDmg, minDmg)  // 戦争: 防御無視の最低ダメージ保証
        resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
      }
      if (res.dmg > 0) att.prevDmgSkillName = cs.skills?.name
      if (res.selfDmg > 0) att.hp = Math.max(0, att.hp - res.selfDmg)
      dealToDef(finalDmg)
      // 紋章: 物理/特殊吸収（与ダメの一定割合を回復・回復封じ中は無効）
      // HPが増えるのでログは残すが、出所（紋章の吸収）は書かず単なる回復として出す
      { const emDrain = emblemDrainAmount(eff, finalDmg, isPhysSkill); if (emDrain > 0 && !(attBuffs.healSeal?.turns > 0)) { att.hp = Math.min(eff.hp_max, att.hp + emDrain); logs.push({ text: `💚 ${att.profile.username}のHPが${emDrain}回復した！`, color: '#44ff88' }) } }
      evoOnHit(eff, finalDmg, res.newEnemyBuffs, enemyName, logs, isMulti ? multiCritAny : finalCrit)  // 真化: 攻撃ヒット時の敵デバフ（res.newEnemyBuffsに書く＝置換で消えない）
      // ★直接付与する相手デバフは res.newEnemyBuffs に書く（下で def.buffs = res.newEnemyBuffs に置換されるため、
      //   defBuffs(旧オブジェクト)に書くと捨てられてアイコンも効果も消える）
      if (finalDmg > 0 && att.equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(res.newEnemyBuffs.healDown?.turns > 0)) {
        // 装備名を出すログは廃止（効果はデバフとして相手に付くだけ）
        res.newEnemyBuffs.healDown = { turns: 2, rate: 0.7 }
      }
      if (finalDmg > 0 && att.equippedWeaponItem?.bonus_effect === 'hit_spd_down_5') {
        // 濡羽杖アマザネ: 攻撃ヒット時 2Tの間対象SPD-5%（最大4重複=-20%・ヒット毎に持続リフレッシュ）
        const curSd = res.newEnemyBuffs.spdDown
        const amzSt = Math.min(4, ((curSd?.turns > 0 && curSd.amazaneStacks) || 0) + 1)
        const amzRate = Math.round((1 - 0.05 * amzSt) * 100) / 100
        if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) {
          res.newEnemyBuffs.spdDown = { turns: 2, rate: amzRate, amazaneStacks: amzSt }
        }
      }
      if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(res.newEnemyBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
        // 装備名を出すログは廃止（麻痺は状態異常アイコンで分かる）
        res.newEnemyBuffs.paralysis = { turns: 3, skipRate: 0.25, spdRate: 0.8 }
      }
      const healUpMult = attBuffs.healUp?.turns > 0 ? attBuffs.healUp.rate : 1
      const healAmt = attBuffs.healSeal?.turns > 0 ? 0 : Math.floor(res.heal * att.passiveHealMult * PVP.healMult * ctx.healMult * healUpMult)
      att.hp = Math.min(eff.hp_max, att.hp + healAmt)
      if (att.passiveHealReflect && healAmt > 0) {
        const reflectDmg = Math.floor(healAmt * 0.5)
        dealToDef(reflectDmg)
        logs.push({ text: `✨ 神聖加護の反射！ ${enemyName}に${reflectDmg}ダメージ！`, color: '#ffdd44' })
      }
      // バフ封じ（魔剣開放／オールイン反動）中は付与バフを無効化
      if (attBuffs.spellBladeSealed?.turns > 0) {
        const blocked = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune','holyField','holyAwakening','flashCombo','spellBladeExhaust']
        const had = blocked.some(k => res.newPlayerBuffs[k] !== attBuffs[k] && res.newPlayerBuffs[k] !== undefined)
        for (const k of blocked) { if (res.newPlayerBuffs[k] !== attBuffs[k]) res.newPlayerBuffs[k] = attBuffs[k] }
        if (had) logs.push({ text: `⚔ 魔剣開放の反動中！ バフが効かない！`, color: '#ff4444' })
      }
      if (attBuffs.allinDebuff?.turns > 0) {
        const blocked = ['atkUp','matkUp','spdUp','dmgReduce','regenHeal','hitBonus','evasion','bloodRage','statusImmune']
        const had = blocked.some(k => res.newPlayerBuffs[k] !== attBuffs[k] && res.newPlayerBuffs[k] !== undefined)
        for (const k of blocked) { if (res.newPlayerBuffs[k] !== attBuffs[k]) res.newPlayerBuffs[k] = attBuffs[k] }
        if (had) logs.push({ text: `💸 オールインの反動中！ バフが効かない！`, color: '#ff4444' })
      }
      att.buffs = res.newPlayerBuffs; def.buffs = res.newEnemyBuffs
      consumeAilmentShield(defBuffs, def.buffs, logs)  // 哭雨の羽衣: 新規状態異常を1回無効化
      emblemResistNewAilments(def.eff, defBuffs, def.buffs, logs)  // 紋章: 個別状態異常耐性（防御側）
      evoResistNewAilments(def.eff, defBuffs, def.buffs, logs)     // アクアクラウン(真化): 状態異常確率-5%
      const critInsert = (finalCrit && !isMulti) ? '💥クリティカル！ ' : ''
      const dmgIdx = resLog.indexOf(enemyName + 'に')
      const logWithCrit = critInsert ? (dmgIdx >= 0 ? resLog.slice(0, dmgIdx) + critInsert + resLog.slice(dmgIdx) : resLog + ' ' + critInsert) : resLog
      logs.push({ text: `${prefix}${logWithCrit}`, color: (finalCrit && !isMulti) || multiCritAny ? '#ffff00' : '#88ccff' })
      // 追撃
      if (res.followup && res.followup.dmg > 0) {
        const fCrit = Math.random() * 100 < (critRate + (res.bonusCritRate || 0))
        const fCritMult = fCrit ? (1.5 + (eff.critDmg || 0) + att.passiveCritDmgBonus) : 1.0
        let fDmg = Math.floor(res.followup.dmg * defScale * fCritMult * att.passiveDmgMult * tosoMult * allinDebuffOutMult * reduceMult * PVP.dmgMult * ctx.atkDmgMult * emMult * (0.9 + Math.random() * 0.2))
        fDmg = Math.max(1, fDmg)
        dealToDef(fDmg)
        logs.push({ text: `↳ 追撃！${res.followup.label ? `（${res.followup.label}）` : ''} ${enemyName}に${fDmg}ダメージ！${fCrit ? ' 💥クリティカル！' : ''}`, color: fCrit ? '#ffaa00' : '#ffaa66' })
      }
      // 与ダメ割合回復の1ヒット上限：基本 最大HP20%、クリティカル時35%（回復補正は PVP.healMult）
      const healCapPct = (finalCrit || multiCritAny) ? 0.35 : 0.20
      if (att.buffs.bloodRage?.turns > 0 && finalDmg > 0 && !(att.buffs.healSeal?.turns > 0)) {
        const rageCure = Math.min(Math.floor(finalDmg * att.buffs.bloodRage.healRate * PVP.healMult * ctx.healMult), Math.floor(eff.hp_max * healCapPct))
        att.hp = Math.min(eff.hp_max, att.hp + rageCure)
        logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
      }
      // 与ダメ割合回復(ソウルドレイン/ルミナ・レイ等)：実際の与ダメージ(クリティカル込み)から回復
      if (res.drainRate > 0 && finalDmg > 0 && !(att.buffs.healSeal?.turns > 0)) {
        const drainHeal = Math.min(Math.floor(finalDmg * res.drainRate * PVP.healMult * ctx.healMult), Math.floor(eff.hp_max * healCapPct))
        att.hp = Math.min(eff.hp_max, att.hp + drainHeal)
        logs.push({ text: `💚 HPを${drainHeal}回復！`, color: '#66ffaa' })
      }
      // 神聖覚醒の追撃
      if (att.buffs.holyAwakening?.turns > 0 && finalDmg > 0) {
        const holyBonusDmg = Math.floor((pDef * att.buffs.holyAwakening.defMult + pMdef * att.buffs.holyAwakening.defMult) * PVP.dmgMult * ctx.atkDmgMult)
        dealToDef(holyBonusDmg)
        logs.push({ text: `✨ 神聖覚醒の追撃！ ${enemyName}に${holyBonusDmg}ダメージ！`, color: '#ffeeaa' })
      }
      skillUsed = true; att.skillIndex++
    }
  }

  // 通常攻撃（スキル不使用時）
  if (!skillUsed) {
    const baseAtk = att.isMagical ? effBuff.matk : effBuff.atk
    const ratioBaseAtk = baseAtk * PVP.ratioAtkMult  // 防御レバレッジ用に縮小（スキルと同方針）
    const eDefVal = att.isMagical ? Math.max(1, Math.floor((def.eff.mdef || 0) * eMdefRate)) : Math.max(1, Math.floor(def.eff.def * eDefRate))
    const baseDmg = Math.max(1, Math.floor(baseAtk * ratioBaseAtk / Math.max(1, ratioBaseAtk + eDefVal)) + Math.floor(Math.random() * 4))
    const reduceMult = defReduceMult(att.isMagical)
    const breederDmgMult = attBuffs.breederDmgUp?.turns > 0 ? attBuffs.breederDmgUp.rate : 1.0
    let finalDmg = Math.floor(baseDmg * 0.7 * critMult * (att.isArtifact ? 1.3 : 1.0) * att.passiveDmgMult * reduceMult * breederDmgMult * PVP.dmgMult * ctx.atkDmgMult * emblemDmgMult(eff, !att.isMagical) * (0.9 + Math.random() * 0.2))
    if (minDmg > 0) finalDmg = Math.max(finalDmg, minDmg)  // 戦争: 防御無視の最低ダメージ保証
    dealToDef(finalDmg)
    // 紋章: 物理/特殊吸収（HPが増えるのでログは残すが、出所は書かない）
    { const emDrain = emblemDrainAmount(eff, finalDmg, !att.isMagical); if (emDrain > 0 && !(attBuffs.healSeal?.turns > 0)) { att.hp = Math.min(eff.hp_max, att.hp + emDrain); logs.push({ text: `💚 ${att.profile.username}のHPが${emDrain}回復した！`, color: '#44ff88' }) } }
    const prevDefBuffsN = { ...defBuffs }  // 哭雨の羽衣: 新規状態異常の差分検知用
    evoOnHit(eff, finalDmg, defBuffs, enemyName, logs, isCrit)  // 真化: 通常攻撃ヒット時の敵デバフ（通常攻撃はdef.buffs置換なし）
    // 蒼雷の短刃: 追加行動の攻撃ヒット時、eff.extraParaChance%で相手を麻痺（装備名を出すログは廃止）
    if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(defBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
      defBuffs.paralysis = { turns: 3, skipRate: 0.25, spdRate: 0.8 }
    }
    consumeAilmentShield(prevDefBuffsN, defBuffs, logs)
    emblemResistNewAilments(def.eff, prevDefBuffsN, defBuffs, logs)  // 紋章: 個別状態異常耐性（防御側）
    evoResistNewAilments(def.eff, prevDefBuffsN, defBuffs, logs)     // アクアクラウン(真化): 状態異常確率-5%
    const critText = isCrit ? '💥クリティカル！ ' : ''
    logs.push({ text: `${prefix}${critText}攻撃！ ${enemyName}に${finalDmg}ダメージ！`, color: '#ffcc00' })
    if (att.buffs.bloodRage?.turns > 0 && finalDmg > 0 && !(att.buffs.healSeal?.turns > 0)) {
      const rageCure = Math.min(Math.floor(finalDmg * att.buffs.bloodRage.healRate * PVP.healMult * ctx.healMult), Math.floor(eff.hp_max * (isCrit ? 0.35 : 0.20)))
      att.hp = Math.min(eff.hp_max, att.hp + rageCure)
      logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
    }
    // 通常攻撃は精霊召喚でも神降ろしでもない → コンボ/連続使用ロックを解除
    if (attBuffs.spiritCombo) attBuffs.spiritCombo = undefined
    if (attBuffs.kinjutsuLock) attBuffs.kinjutsuLock = undefined
    if (att.expandedSkillSet.length > 0) att.skillIndex++
  }
  // 真化の被ダメトリガー（聖鎧のスタン／インフェルノのやけど）を攻撃側へ反映。
  // att.buffs の置換が終わったこの位置で適用する（dealToDef内で直接書くと捨てられる）
  applyOndmgAilments()
}

// ブリーダー：ペットの攻撃（自動攻撃・コマンド共通）。opp へダメージ。死亡時 true。
// 素早さ非依存。PvPでは回避判定は省略（実験的）。
function petAttackPvp(side, opp, mult, label, logs) {
  if (!side.petActive || side.petHp <= 0) return false
  const name = side.profile.username
  const isSpec = side.petAtkType === 'spec'
  const edr = (opp.buffs.defDown?.rate || 1) * (opp.buffs.defUp?.rate || 1)
  const emr = (opp.buffs.mdefDown?.rate || 1) * (opp.buffs.mdefUp?.rate || 1)
  const adjDef = Math.max(1, Math.floor(isSpec ? (opp.eff.mdef || 0) * emr : (opp.eff.def || 0) * edr))
  const base = side.petAtk * mult
  const dmgUp = side.buffs.breederDmgUp?.turns > 0 ? side.buffs.breederDmgUp.rate : 1.0
  const dmg = Math.max(1, Math.floor(base * (base / (base + adjDef)) * dmgUp * PVP.dmgMult))
  opp.hp -= dmg
  side.dmgDealt += dmg  // 与ダメ総量：ペットの攻撃
  let extra = ''
  if (side.rtCur >= 1) {
    if (side.petSpecies === 'flame' && Math.random() * 100 < 30 && !emblemBlocksAilment(opp.eff, 'bleed', null) && !evoBlocksAilment(opp.eff, 'bleed', null)) { const b = opp.buffs.bleed; opp.buffs.bleed = { stacks: Math.min(5, (b?.stacks || 0) + 1), lastTurn: 0 }; extra = ' 出血！' }
    else if (side.petSpecies === 'aqua' && Math.random() * 100 < 40) { opp.buffs.spdDown = { turns: 3, rate: 0.7 }; extra = ' 素早さ低下！' }
    else if (side.petSpecies === 'leaf') { const sr = opp.buffs.stunResist ?? 1.0; if (Math.random() * 100 < 30 * sr && !emblemBlocksAilment(opp.eff, 'stun', null) && !evoBlocksAilment(opp.eff, 'stun', null)) { opp.buffs.stun = { turns: 1 }; opp.buffs.stunResist = sr * 0.5; extra = ' スタン！' } }
  }
  logs.push({ text: `🐾 ${name}のペットの${label}！ ${opp.profile.username}に${dmg}ダメージ！${extra}`, color: '#ffaa44' })
  return opp.hp <= 0
}

// ターン開始時の持続効果（毒/やけど/出血/呪/骸骨/リジェネ/リジェネ回復/遅延回復）
// side 自身のDoT/回復を処理し、skeletonDmg は opp へ。死亡時 true を返す。
function applyTurnStart(side, opp, ctx) {
  const logs = ctx.logs
  const name = side.profile.username
  const maxHp = side.eff.hp_max
  const b = side.buffs

  // 状態異常DoTは「相手が与えたダメージ」（確定＝回避不可）→ opp.dmgDealt に計上
  if (b.severePoisoin?.turns > 0) {
    const d = Math.floor(maxHp * 0.05 * ctx.dotMult * emblemDotMult(opp.eff, 'poison')); side.hp = Math.max(0, side.hp - d); opp.dmgDealt += d
    logs.push({ text: `🤢 猛毒ダメージ！ ${name}に${d}ダメージ！`, color: '#aa44ff' })
    if (side.hp <= 0) return true
  }
  if (b.burn?.turns > 0) {
    const d = Math.floor(maxHp * 0.02 * ctx.dotMult * emblemDotMult(opp.eff, 'burn')); side.hp = Math.max(0, side.hp - d); opp.dmgDealt += d
    logs.push({ text: `🔥 やけどダメージ！ ${name}に${d}ダメージ！`, color: '#ff6622' })
    if (side.hp <= 0) return true
  }
  if (b.poison?.turns > 0) {
    const d = Math.floor(maxHp * b.poison.dmgRate * ctx.dotMult * emblemDotMult(opp.eff, 'poison')); side.hp = Math.max(0, side.hp - d); opp.dmgDealt += d
    logs.push({ text: `☠ 毒ダメージ！ ${name}に${d}ダメージ！`, color: '#44ff44' })
    if (side.hp <= 0) return true
  }
  if (b.curseDmg?.turns > 0) {
    const cd = Math.floor(b.curseDmg.dmg * ctx.dotMult); side.hp = Math.max(0, side.hp - cd); opp.dmgDealt += cd
    logs.push({ text: `💀 呪縛ダメージ！ ${name}に${cd}ダメージ！`, color: '#cc44ff' })
    if (side.hp <= 0) return true
  }
  if (b.bleed) {
    const d = Math.floor(side.hp * 0.01 * b.bleed.stacks * ctx.dotMult * emblemDotMult(opp.eff, 'bleed')); side.hp = Math.max(0, side.hp - d); opp.dmgDealt += d
    logs.push({ text: `🩸 出血ダメージ！ ${name}に${d}ダメージ（${b.bleed.stacks}スタック）！`, color: '#ff4466' })
    if (side.hp <= 0) return true
    b.bleed.lastTurn = (b.bleed.lastTurn || 0) + 1
    if (b.bleed.lastTurn >= 3) delete b.bleed
  }
  // 骸骨：相手へ持続ダメージ（side が与えたダメージ）
  if (b.skeletonDmg?.turns > 0) {
    const d = Math.floor(b.skeletonDmg.dmg * PVP.dmgMult)
    opp.hp -= d; side.dmgDealt += d
    logs.push({ text: `💀 ${name}の骸骨の持続ダメージ！ ${opp.profile.username}に${d}ダメージ！`, color: '#cc44ff' })
    if (opp.hp <= 0) return true
  }
  // 式神召喚（パッシブ）：毎ターン、特殊攻撃力×0.5（再修練1で0.8）の式神攻撃
  if (side.hasShikigami) {
    const mult = side.rtCur >= 1 ? 0.8 : 0.5
    const eMdefR = (opp.buffs.mdefDown ? opp.buffs.mdefDown.rate : 1) * (opp.buffs.mdefUp ? opp.buffs.mdefUp.rate : 1)
    const matk = side.eff.matk
    const adjEMD = Math.max(1, Math.floor((opp.eff.mdef || 0) * eMdefR))
    const d = Math.max(1, Math.floor(matk * mult * (matk / (matk + adjEMD)) * PVP.dmgMult))
    opp.hp -= d; side.dmgDealt += d
    logs.push({ text: `👹 ${name}の式神の攻撃！ ${opp.profile.username}に${d}ダメージ！`, color: '#cc88ff' })
    if (opp.hp <= 0) return true
  }
  // ブリーダー：召喚ペットの毎ターン自動攻撃（×1.0）
  if (side.petActive && side.petHp > 0) {
    if (petAttackPvp(side, opp, 1.0, 'こうげき', logs)) return true
  }
  const sealed = b.healSeal?.turns > 0
  if (sealed) logs.push({ text: `🚫 ${name}は回復封じ中！ 回復効果が無効化された！`, color: '#ff4488' })
  if (b.regen?.turns > 0) {
    const amt = Math.floor(maxHp * b.regen.rate * PVP.healMult * ctx.healMult)
    side.hp = Math.min(maxHp, side.hp + amt)
    logs.push({ text: `💚 ${name}のリジェネ！ HPが${amt}回復した！`, color: '#44ff88' })
  }
  if (!sealed && b.regenHeal?.turns > 0) {
    const amt = Math.floor(b.regenHeal.amount * side.passiveHealMult * PVP.healMult * ctx.healMult * (b.healUp?.turns > 0 ? b.healUp.rate : 1))
    side.hp = Math.min(maxHp, side.hp + amt)
    logs.push({ text: `💚 ${name}の回復効果でHPが${amt}回復した！`, color: '#44ff88' })
  }
  if (b.regenMp?.turns > 0) {
    const maxMp = side.eff.mp_max
    const amt = Math.floor(maxMp * b.regenMp.rate)
    if (amt > 0 && side.mp < maxMp) {
      side.mp = Math.min(maxMp, side.mp + amt)
      logs.push({ text: `🔵 ${name}の魔力供給でMPが${amt}回復した！`, color: '#4488ff' })
    }
  }
  if (!sealed && b.delayHeal && ctx.turn === b.delayHeal.triggerTurn) {
    const amt = Math.floor(b.delayHeal.amount * PVP.healMult * ctx.healMult)
    side.hp = Math.min(maxHp, side.hp + amt)
    // HPが増えるので事象は残す。出所（装備効果）は書かない
    logs.push({ text: `💚 ${name}のHPが${amt}回復した！`, color: '#44ff88' })
  }
  return false
}

// 行動スキップ判定（スタン/麻痺）。スキップ時 true。
function checkSkip(side, ctx) {
  const b = side.buffs
  const name = side.profile.username
  if (b.stun?.turns > 0) {
    ctx.logs.push({ text: `${name}はスタンして行動できない！`, color: '#ffaa00' })
    delete b.stun; return true
  }
  if (b.paralysis?.turns > 0 && Math.random() < b.paralysis.skipRate) {
    ctx.logs.push({ text: `${name}は麻痺で行動不能！`, color: '#ffaa00' })
    b.paralysis.skipRate *= 0.5; return true
  }
  return false
}

// 1サイドの行動（メイン＋素早さ追加行動）。相手死亡で true。
function takeTurn(att, def, ctx) {
  if (checkSkip(att, ctx)) return false
  att.tenkaiActedThisTurn = false  // 天墜竜閃を撃ったターン（溜め・解放とも）は追加行動を出さないための当ターンフラグ
  doAttack(att, def, false, ctx)
  if (def.hp <= 0) return true
  // 精霊共鳴：同じ精霊召喚を3回使うたび確定追加行動
  if (att.hasSpiritResonance && att.buffs.spiritCombo?.tripled) {
    att.buffs.guaranteedExtra = true
    att.buffs.spiritCombo = { ...att.buffs.spiritCombo, tripled: false }
    ctx.logs.push({ text: `🌟 ${att.profile.username} の精霊共鳴！ 追加行動を得る！`, color: '#ffdd66' })
  }
  const spiritExtra = !!att.buffs.guaranteedExtra
  if (att.buffs.guaranteedExtra) att.buffs.guaranteedExtra = false
  const extraRate = calcExtraActionRate(
    att.effectiveSpdForCalc * (att.buffs.spdUp ? att.buffs.spdUp.rate : 1),
    def.effectiveSpdForCalc * (def.buffs.spdUp ? def.buffs.spdUp.rate : 1)
  )
  // 天墜竜閃を使ったターン（溜め・解放とも）は追加行動を出さない
  if (!att.tenkaiActedThisTurn && (spiritExtra || (extraRate > 0 && Math.random() * 100 < extraRate))) {
    ctx.logs.push({ text: '⚡ 追加行動！', color: '#ffdd44' })
    doAttack(att, def, true, ctx)
    if (def.hp <= 0) return true
  }
  return false
}

// ターン終了時のバフ更新（PvE と同様の掃除）
function endTurnBuffs(side, ctx, hpBeforeTurn) {
  const b = side.buffs
  const logs = ctx.logs
  const berserkWasActive = b.berserk?.turns > 0
  Object.keys(b).forEach(k => { if (b[k]?.turns > 0) b[k].turns-- })
  if (side.petBuffs?.reduceTurns > 0) side.petBuffs.reduceTurns--
  if (berserkWasActive && b.berserk?.turns === 0 && side.expandedSkillSet.length > 0) {
    const lockedIdx = side.expandedSkillSet.findIndex(ss => ss.skills?.name === b.berserk.lockedSkill)
    if (lockedIdx >= 0) side.skillIndex = lockedIdx + 1
  }
  if (b.spellBladeExhaust?.turns === 0) {
    const sealT = b.spellBladeExhaust.sealTurns || 4
    delete b.spellBladeExhaust
    b.spellBladeSealed = { turns: sealT }
    logs.push({ text: `⚔ ${side.profile.username}の魔剣開放の反動！ ${sealT}ターンの間バフ不可状態になった！`, color: '#ff4444' })
  }
  if (b.allinActive?.turns === 0) {
    const reactT = b.allinActive.reactTurns || 2
    delete b.allinActive
    delete b.atkUp; delete b.matkUp; delete b.spdUp; delete b.dmgReduce
    b.allinDebuff = { turns: reactT, rate: 0.7 }
    logs.push({ text: `💸 ${side.profile.username}のオールインの効果が切れた！ ${reactT}ターンの間全ステータスが低下し、バフが使えない！`, color: '#ff4444' })
  }
  Object.keys(b).forEach(k => { if (b[k]?.turns === 0) delete b[k] })
  // 雷鋼の機神鎧: 被ダメで2ターン素早さ+15%
  if (side.ondmgSpdUp > 1 && side.hp < hpBeforeTurn && !(b.spdUp?.turns > 0 && b.spdUp.rate >= side.ondmgSpdUp)) {
    b.spdUp = { turns: 2, rate: side.ondmgSpdUp }
  }
  // 哭雨の羽衣: 5ターンごとに状態異常無効バフを再獲得（既にバフがある場合は重複しない）
  // 装備名を出すログは廃止（バフ自体は従来どおり付く）
  if (ctx.turn % 5 === 0 && !(b.ailmentShield?.charges > 0) && side.equipment?.some(e => e.equipped && e.bonus_effect === 'battle_start_ailment_shield')) {
    b.ailmentShield = { charges: 1 }
  }
}

// ============================================================
// メイン：対人戦シミュレーション
//  inputA / inputB: { eff, equipment, skillSets, proficiency, profile, playerItem }
//  A = 挑戦者（先攻判定が同速のときAが先攻）
// ============================================================
export function simulatePvpBattle(inputA, inputB, opts = {}) {
  const { hpBonus = 0, turnCap = PVP.turnCap } = opts
  const logs = []
  const A = buildSide(inputA, 'A', hpBonus)
  const B = buildSide(inputB, 'B', hpBonus)
  // 戦争の消耗戦: 持続HP/MPを開始値として受け取る（未指定なら満タン＝従来のPvP/組み手）。
  if (opts.startHpA != null) A.hp = Math.min(A.eff.hp_max, Math.max(0, opts.startHpA))
  if (opts.startMpA != null) A.mp = Math.min(A.eff.mp_max, Math.max(0, opts.startMpA))
  if (opts.startHpB != null) B.hp = Math.min(B.eff.hp_max, Math.max(0, opts.startHpB))
  if (opts.startMpB != null) B.mp = Math.min(B.eff.mp_max, Math.max(0, opts.startMpB))

  logs.push({ text: `⚔ 対人戦開始！ ${A.profile.username} vs ${B.profile.username}`, color: '#ffcc66' })
  // ランクマッチはルールをパネル側に常設表示するため開始ログには出さない（hideRuleLine）
  if (!opts.hideRuleLine) logs.push({ text: `（50ターンで強制終了・与ダメージ総量で勝敗／防御で大きく軽減・回復は通常／素早さで回避・クリ最大1.5倍）`, color: '#88aacc' })

  // 開幕の装備効果バフ
  A.buffs = applyEquipmentEffects(A.equipment, { ...A.profile, hp_max: A.eff.hp_max }, A.buffs, logs)
  B.buffs = applyEquipmentEffects(B.equipment, { ...B.profile, hp_max: B.eff.hp_max }, B.buffs, logs)

  // 戦争用の調整係数（未指定＝1.0＝組み手/PvPは従来どおり）。
  //  atkDmgMult: 通常/スキル与ダメ倍率 / dotMult: 状態異常DoT(自分が喰らう)倍率
  // minDmgPct: 防御無視の最低ダメージ保証（相手最大HPの割合）。戦争で戦闘力差があっても少し通す用。0=無効。
  const ctx = { logs, turn: 1, atkDmgMult: opts.atkDmgMult ?? 1, dotMult: opts.dotMult ?? 1, healMult: opts.healMult ?? 1, minDmgPct: opts.minDmgPct ?? 0 }

  // 戦闘状況（HP/MPバー）は各ターンの先頭に1回だけ出す。
  const pushHp = () => {
    logs.push({
      type: 'hp', turn: ctx.turn,
      playerHp: Math.max(0, A.hp), playerMax: A.eff.hp_max, playerName: A.profile.username,
      enemyHp: Math.max(0, B.hp), enemyMax: B.eff.hp_max, enemyName: B.profile.username,
      playerMp: Math.max(0, A.mp), playerMpMax: A.eff.mp_max,
      enemyMp: Math.max(0, B.mp), enemyMpMax: B.eff.mp_max,
      playerStatus: extractStatuses(A.buffs), enemyStatus: extractStatuses(B.buffs),
      petHp: A.petActive ? Math.max(0, A.petHp) : null, petMax: A.petActive ? A.petMaxHp : null,
    })
  }

  while (A.hp > 0 && B.hp > 0 && ctx.turn <= turnCap) {
    pushHp()
    // 先攻＝素早さが速い方（完全同値はランダム）
    const aSpd = A.effectiveSpdForCalc * (A.buffs.spdUp ? A.buffs.spdUp.rate : 1)
    const bSpd = B.effectiveSpdForCalc * (B.buffs.spdUp ? B.buffs.spdUp.rate : 1)
    const order = aSpd > bSpd ? [A, B] : aSpd < bSpd ? [B, A] : (Math.random() < 0.5 ? [A, B] : [B, A])
    const aHpBefore = A.hp, bHpBefore = B.hp

    // ターン開始: 持続効果（先攻側→後攻側）
    let dead = false
    for (const s of order) {
      const opp = s === A ? B : A
      if (applyTurnStart(s, opp, ctx)) { dead = true; break }
    }
    if (dead || A.hp <= 0 || B.hp <= 0) break

    // 行動（先攻→後攻）
    const first = order[0], second = order[1]
    if (takeTurn(first, second, ctx) || second.hp <= 0) break
    if (takeTurn(second, first, ctx) || first.hp <= 0) break

    // ターン終了: バフ更新
    endTurnBuffs(A, ctx, aHpBefore)
    endTurnBuffs(B, ctx, bHpBefore)

    ctx.turn++
  }

  const aHpPct = Math.max(0, A.hp) / A.eff.hp_max
  const bHpPct = Math.max(0, B.hp) / B.eff.hp_max
  let winner
  if (B.hp <= 0 && A.hp > 0) winner = 'A'
  else if (A.hp <= 0 && B.hp > 0) winner = 'B'
  else if (A.hp <= 0 && B.hp <= 0) winner = 'draw'
  else winner = A.dmgDealt > B.dmgDealt ? 'A' : (B.dmgDealt > A.dmgDealt ? 'B' : 'draw')  // ターン上限：与ダメージ総量で判定

  const turns = Math.min(ctx.turn, turnCap)
  const ranOut = A.hp > 0 && B.hp > 0   // ターン上限まで両者生存＝強制終了
  if (ranOut && !opts.warMode) {
    logs.push({ text: `⏱ ${turns}ターン経過で強制終了！ 与ダメージ総量で判定 … ${A.profile.username}: ${A.dmgDealt} / ${B.profile.username}: ${B.dmgDealt}`, color: '#88aacc' })
  }
  if (opts.warMode && ranOut) {
    logs.push({ text: `⚖ 決着がつかなかった（${turns}ターン）`, color: '#cccccc' })
  } else if (winner === 'A') logs.push({ text: `✦ ${A.profile.username} の勝利！（${turns}ターン）`, color: '#ffcc44' })
  else if (winner === 'B') logs.push({ text: `✦ ${B.profile.username} の勝利！（${turns}ターン）`, color: '#ffcc44' })
  else logs.push({ text: `引き分け…（${turns}ターン）`, color: '#aaaaaa' })

  // endHp/endMp は絶対値（戦争の持続HP・コア戦のダメージ計測に使用）
  return {
    logs, winner, turns, aHpPct, bHpPct,
    dmgDealtA: A.dmgDealt, dmgDealtB: B.dmgDealt,   // 与ダメージ総量（表示/検証用）
    endHpA: Math.max(0, A.hp), endMpA: Math.max(0, A.mp),
    endHpB: Math.max(0, B.hp), endMpB: Math.max(0, B.mp),
  }
}
