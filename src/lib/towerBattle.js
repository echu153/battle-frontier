// ============================================================
// エンドレスタワー 戦闘エンジン
// ------------------------------------------------------------
// 奈落闘技場（Abyss.jsx の simulateAbyssBattle）を土台に、タワー専用の要件を足したもの。
// 街の通常出撃には手を入れず、タワー専用に複製している（RaidBoss / Abyss / Hachigoku と同じ方針）。
//
// タワーだけの相違点：
//  ・敵が複数体（スキルの対象はプレイヤーの「対象設定」で決まる）
//  ・HP/MPは呼び出し側から受け取り、戦闘後の残量を返す（エリアボス連戦の持ち越し）
//  ・エンドポイントのボーナスが乗る（タワーの中だけ）
//  ・エリアボスのギミック（装甲・吸血・毒沼・硬化・暴風・適応・屈折・噴火・三頭・暴走）を実装
//
// 敵スキルは src/lib/tower.js の自前スキーマ（type: physical / magical /
// physical_multi / buff / debuff）で完結しており、executeSkill は通さない。
// executeSkill を使うのはプレイヤー側だけ（＝街と同じ挙動）。
// ============================================================

import { getWeaponGroup, calcDefReduction, PEN_CAP } from './stats'
import {
  evoOnHit, evoOnDamaged, evoOnEvade, evoTakenMult, evoAllSkillsSet, evoAtkMult, evoMatkMult,
  evoBlocksAilment,
} from './evoCombat'
import {
  emblemDmgMult, emblemDrainAmount, emblemDotMult, emblemBlocksAilment,
} from './emblemCombat'
import {
  buildSummon, summonAnnounce, summonAttackDamage, summonAbsorbBasic, summonAbsorbSkill,
  summonEndOfTurn, tryPetCommand, BREEDER_COMMANDS,
} from './summon'
import {
  calcEvasionRate, calcExtraActionRate, calcCritRate,
  applyEquipmentEffects, ailmentShieldBlocks,
  executeSkill, extractStatuses, MULTI_HIT_SKILLS, isSelfTargetSkill,
} from '../pages/Game'
import { makeEnemy, towerTreeEffects, applyTreeToStats, buildStageEnemies, buildSortieEnemies, DEFAULT_TARGET_MODE, ENEMY_SKILL_POWER, longFightHealMult, LONG_FIGHT_FROM } from './tower'
// 敵の組み立てとツリー換算は tower.js（純粋データ側）が正。ここから使う側のために再エクスポートする
export { towerTreeEffects, applyTreeToStats, buildStageEnemies, buildSortieEnemies }

// タワーで追加した状態異常キー（executeSkill 側の AILMENT_KEYS には無いもの）
const TOWER_AILMENTS = ['poison', 'burn', 'bleed', 'stun', 'paralysis', 'curse']

// ============================================================
// 本体
// ============================================================
export function simulateTowerBattle({
  eff: rawEff, equipment: equipmentIn, skillSets: skillSetsIn, profile,
  enemies: enemyList, floorData,
  tree = {}, targetMode = DEFAULT_TARGET_MODE,
  startHp = null, startMp = null,
  playerItem = null,      // 装備中のアイテム（タワーでも街と同じように使える）
  potionUsed = 0,         // 無限ポーションをこの連戦で何回使ったか（持ち越す）
  potionLimit = Infinity, // 無限ポーションの回復回数の上限（エリアボス挑戦は道中含めて5回）
  turnCap: turnCapIn = null,
}) {
  // 読み込みに失敗した等で null が来ても戦闘そのものは成立させる（落とさない）
  const equipment = Array.isArray(equipmentIn) ? equipmentIn : []
  const skillSets = Array.isArray(skillSetsIn) ? skillSetsIn : []
  const logs = []
  const tr = towerTreeEffects(tree)
  const eff = applyTreeToStats(rawEff, tr)

  // 技の威力つまみ。通常攻撃には掛けない（tower.js の ENEMY_SKILL_POWER のコメントどおり）。
  //  ⚠層ごとの係数は makeEnemy が攻撃力・特殊攻撃力に掛けている。
  //    ここで再度掛けると技だけ係数の2乗になるため、ダメージ計算では掛けないこと。
  const skillPowerOf = (sk) => (sk?.isBasic ? 1 : ENEMY_SKILL_POWER)

  // 戦闘中に湧く援軍へ引き継ぐ層番号。被ダメージ倍率が層で変わるので、渡さないと援軍だけ緩くなる
  const summonFloor = enemyList[0]?.floor ?? floorData?.floor ?? 1

  const enemies = enemyList.slice()
  // 持ち越しHPが0以下＝前の戦闘で相打ちになっている。1に切り上げて生き返らせない
  if (startHp != null && startHp <= 0) {
    logs.push({ text: `力尽きている…（HPが残っていない）`, color: '#ff4444' })
    return {
      logs, win: false, turns: 0, hp: 0, mp: Math.max(0, startMp || 0),
      hpMax: eff.hp_max, mpMax: eff.mp_max, itemUsed: false, gold: 0, potionUsed: Math.max(0, potionUsed || 0),
    }
  }
  let playerHp = startHp == null ? eff.hp_max : Math.min(eff.hp_max, Math.max(1, startHp))
  let playerMp = startMp == null ? eff.mp_max : Math.min(eff.mp_max, Math.max(0, startMp))
  let turn = 1
  let skillIndex = 0
  let turnCap = turnCapIn || (enemies.some(e => e.isBoss) ? 100 : 60)
  let playerBuffs = {}
  let prevSkillName = null
  let playerAttacking = false
  let rokkanStacks = 0
  let seimitsuStacks = 0
  // アイテム（街の出撃と同じ挙動。使い切り＝1戦闘1個／無限＝5ターンのクールダウン）
  //  DBの数量減らしは戦闘後に呼び出し側が行う（この関数は同期・副作用なしに保つ）
  let currentItem = playerItem ? { ...playerItem } : null
  let itemUsed = false        // 使い切りアイテムを消費したか
  let potionCount = Math.max(0, potionUsed || 0)   // 無限ポーションの累計使用回数
  // 地響き（戦闘エリア10）：敵の攻撃が当たるたび、こちらの素早さが下がっていく（最大-50%）
  let quakeStacks = 0
  let quakeStep = 0
  let quakeMax = 0

  // ===== プレイヤー側のパッシブ（Abyss と同一・街と同じ挙動） =====
  const equippedWeaponItem = equipment.find(e => e.slot === 'weapon' && e.equipped)
  const ondmgSpdUp = eff.ondmgSpdUp || 0
  const hasAmagoiShield = equipment.some(e => e.equipped && e.bonus_effect === 'battle_start_ailment_shield')
  const isArtifact = equippedWeaponItem?.bonus_effect === 'artifact'

  const passiveNames = skillSets.filter(ss => ss.skills?.type === 'パッシブ').map(ss => ss.skills.name)
  const hasIai       = passiveNames.includes('居合の構え') || passiveNames.includes('心眼')
  const hasBerserk   = passiveNames.includes('バーサク')
  const hasTakaNoMe  = passiveNames.includes('鷹ノ目')
  const hasKakushin  = passiveNames.includes('執行本能')
  const hasShinkoka  = passiveNames.includes('神聖加護')
  const hasTenki     = passiveNames.includes('天啓')
  const hasRokkan    = passiveNames.includes('第六感')
  const hasSeimitsu  = passiveNames.includes('精密照準')
  const hasTosoHonno = passiveNames.includes('闘争本能')
  const hasOnmi      = passiveNames.includes('隠身')

  const rtCur = (profile.retraining || {})[profile.class] || 0
  const pe = (cls) => profile.class === cls && rtCur >= 3

  const passiveCritDmgBonus = (hasOnmi && pe('暗殺者')) ? 0.25 : 0
  const passiveDmgMult   = (hasBerserk ? (pe('狂戦士') ? 1.40 : 1.15) : 1.0) * (hasKakushin ? (pe('異端審問官') ? 1.40 : 1.20) : 1.0) * (eff.weaponDmgMult || 1)
  const passiveHealMult  = (hasShinkoka ? 1.5 : 1.0) * (hasKakushin ? 0.5 : 1.0)
  const passiveMatkMult  = hasShinkoka ? 1.1 : 1.0
  const passiveMpCostMult = (hasTenki ? (pe('賢者') ? 0.5 : 0.7) : 1.0) * (eff.weaponMpCostMult || 1) * tr.mpCostMult
  const passiveMatkMultTenki = hasTenki ? (pe('賢者') ? 1.4 : 1.2) : 1.0
  const passiveHitBonus  = (hasRokkan ? 10 : 0) + (hasSeimitsu ? 10 : 0) + (hasTakaNoMe ? (pe('狩人') ? 20 : 10) : 0)
  const passiveHealReflect = (hasShinkoka && pe('聖職者'))
  const hasGambleBody   = passiveNames.includes('ギャンブルボディ')
  const hasMadokenJutsu = passiveNames.includes('魔導剣術')
  const hasHolyKnightPassive = passiveNames.includes('聖騎士の心得')

  if (profile.class === '精霊召喚士' && rtCur >= 1 && passiveNames.includes('精霊共鳴') && startMp == null) {
    playerMp = Math.floor(eff.mp_max * 1.2)
  }
  const hasRyurin  = passiveNames.includes('竜鱗の加護')
  const ryurinMult = hasRyurin ? (pe('竜騎士') ? 1.4 : 1.2) : 1.0
  const ryurinReduce = () => (hasRyurin && Math.random() < 0.3) ? (pe('竜騎士') ? 0.80 : 0.95) : 1.0

  const summon = buildSummon(profile, passiveNames, profile.activePet)
  summonAnnounce(summon, logs)

  const iaiSetSkills = skillSets.filter(ss => ss.skills && ss.skills.type !== 'パッシブ')
  const iaiLoadoutOK = iaiSetSkills.length > 0 && iaiSetSkills.every(ss => (ss.use_count ?? 1) === 1)
  const iaiPhysMult = (hasIai && iaiLoadoutOK) ? (pe('侍') ? 1.70 : 1.40) : 1.0
  const takaAtkBonus = (hasTakaNoMe && pe('狩人')) ? Math.floor((eff.spd || 0) * 0.1) : 0
  const madokenAtkMult = (hasMadokenJutsu && pe('魔法剣士')) ? 1.1 : 1.0

  logs.push({ text: `⚔ ${enemies.map(e => e.name).join('・')} が立ちはだかった！`, color: '#ff6644' })
  playerBuffs = applyEquipmentEffects(equipment, profile, playerBuffs, logs)

  const weaponType = equippedWeaponItem?.weapons?.weapon_type || 'sword'
  const isMagical = getWeaponGroup(weaponType) === 'magical'
  const expandedSkillSet = []
  for (const ss of skillSets) {
    if (ss.skills?.type === 'パッシブ') continue
    const count = ss.use_count || 1
    for (let i = 0; i < count; i++) expandedSkillSet.push(ss)
  }
  const allSkillsSet = evoAllSkillsSet(skillSets)
  const playerHitBonus = (eff.hitBonus || 0) + passiveHitBonus

  // ============================================================
  // 敵まわりの共通処理
  // ============================================================
  const alive = () => enemies.filter(e => e.hp > 0)

  // 条件を満たす「最も深い」段階を返す（above は「HP割合がこれ以下」）
  const currentPhase = (en) => {
    if (!en.phases) return null
    const rate = en.hp / en.maxHp
    let found = null
    for (const p of en.phases) if (rate <= p.above) found = p
    return found
  }
  const currentPhaseIdx = (en) => {
    if (!en.phases) return -1
    const rate = en.hp / en.maxHp
    let idx = -1
    for (let i = 0; i < en.phases.length; i++) if (rate <= en.phases[i].above) idx = i
    return idx
  }

  // 敵が受けるダメージの倍率（装甲・三頭・暴走の軽減）
  const enemyTakenMult = (en, isPhys) => {
    // ★敵ごとの被ダメージ倍率（雑魚は半分・強敵/エリアボスは7割）。makeEnemy が持たせる
    let m = en.dmgTaken ?? 1
    const mods = en.mods || {}
    if (isPhys && mods.physTakenMult) m *= mods.physTakenMult
    if (!isPhys && mods.magTakenMult) m *= mods.magTakenMult
    const ph = currentPhase(en)
    if (ph) {
      if (isPhys && ph.physTaken) m *= ph.physTaken
      if (!isPhys && ph.magTaken) m *= ph.magTaken
      if (ph.damageTaken) m *= ph.damageTaken
    }
    return m
  }

  // 屈折（戦闘エリア7）：受けたダメージの一定割合を跳ね返す。1発あたり プレイヤー最大HPの reflectCap まで
  const applyReflect = (en, dmg) => {
    const rate = en.mods?.reflect || 0
    if (rate <= 0 || dmg <= 0 || playerHp <= 0) return
    const cap = Math.floor(eff.hp_max * (en.mods.reflectCap ?? 0.02))
    const back = Math.max(1, Math.min(Math.floor(dmg * rate), cap))
    playerHp -= back
    logs.push({ text: `🔷 ${en.name}の屈折！ ${back}ダメージ跳ね返された！`, color: '#88ccff' })
  }

  // 吸血（戦闘エリア2）
  const applyLifesteal = (en, dmg) => {
    const rate = en.mods?.lifesteal || 0
    if (rate <= 0 || dmg <= 0) return
    const heal = Math.floor(dmg * rate)
    if (heal <= 0) return
    en.hp = Math.min(en.maxHp, en.hp + heal)
    logs.push({ text: `🩸 ${en.name}が${heal}吸収した！`, color: '#ff6688' })
  }

  const onEnemyDown = (en) => {
    if (en.hp > 0) return
    logs.push({ text: `☠ ${en.name}を倒した！`, color: '#88ffaa' })
  }

  // 対象選択（プレイヤーの対象設定）
  const pickTarget = () => {
    const list = alive()
    if (!list.length) return null
    if (targetMode === 'random') return list[Math.floor(Math.random() * list.length)]
    if (targetMode === 'hp_high') return list.reduce((a, b) => (b.hp > a.hp ? b : a))
    if (targetMode === 'hp_low') return list.reduce((a, b) => (b.hp < a.hp ? b : a))
    return list[0]  // top: 上から順番
  }

  // 敵の現在ステータス（永続強化＋バフ＋硬化を反映）
  const enemyStats = (en) => {
    const burnDown = en.buffs.burn?.turns > 0 ? 0.9 : 1
    const ph = currentPhase(en)
    return {
      atk:  en.atk * en.perm.atk * (en.buffs.atkUp?.rate || 1) * (en.buffs.atkDown?.rate || 1) * burnDown,
      matk: en.matk * en.perm.matk * (en.buffs.matkUp?.rate || 1) * (en.buffs.matkDown?.rate || 1) * burnDown,
      def:  en.def * en.perm.def * en.defRamp * (en.buffs.defUp?.rate || 1) * (en.buffs.defDown?.rate || 1),
      mdef: en.mdef * en.perm.mdef * en.defRamp * (en.buffs.mdefUp?.rate || 1) * (en.buffs.mdefDown?.rate || 1),
      spd:  en.spd * en.perm.spd * (en.buffs.spdUp?.rate || 1) * (en.buffs.spdDown?.turns > 0 ? en.buffs.spdDown.rate : 1),
      phase: ph,
    }
  }

  // ============================================================
  // プレイヤーの行動
  // ============================================================
  // forDefense=true のときだけ竜鱗の加護（竜騎士）の防御倍率を乗せる。
  // 街の出撃・奈落と同じで、攻撃側の計算（神聖覚醒の追撃）には乗せない。
  const playerDefStats = (forDefense = false) => {
    const ryu = forDefense ? ryurinMult : 1.0
    const holyFieldDef = playerBuffs.holyField?.turns > 0 ? playerBuffs.holyField.rate : 1.0
    const holyKnightMult = hasHolyKnightPassive ? (pe('聖騎士') ? 2.0 : 1.5) : 1.0
    const kabeDef = (playerBuffs.dmgReduce?.isGainoKabe && pe('死霊使い')) ? 2.0 : 1.0
    const defDown = playerBuffs.defDown?.turns > 0 ? playerBuffs.defDown.rate : 1.0
    const mdefDown = playerBuffs.mdefDown?.turns > 0 ? playerBuffs.mdefDown.rate : 1.0
    const pDef = eff.def * (playerBuffs.defUp?.turns > 0 ? playerBuffs.defUp.rate : 1) * defDown * holyFieldDef * holyKnightMult * kabeDef * ryu
    const pMdef = eff.mdef * (playerBuffs.mdefUp?.turns > 0 ? playerBuffs.mdefUp.rate : 1) * (playerBuffs.defUp?.turns > 0 ? playerBuffs.defUp.rate : 1) * mdefDown * holyFieldDef * holyKnightMult * kabeDef * ryu
    return { pDef, pMdef }
  }

  // 現在のこちらの素早さ（バフ/デバフ・麻痺・地響きを反映）
  const playerSpdNow = () => {
    const paralysisSpdP = playerBuffs.paralysis?.turns > 0 ? (playerBuffs.paralysis.spdRate || 0.8) : 1.0
    const spdDownP = playerBuffs.spdDown?.turns > 0 ? playerBuffs.spdDown.rate : 1.0
    const quakeSpd = 1 - Math.min(0.5, quakeStacks * quakeStep)
    return eff.spd * (playerBuffs.spdUp?.turns > 0 ? playerBuffs.spdUp.rate : 1) * spdDownP * paralysisSpdP * quakeSpd
  }

  const doPlayerAttack = (isExtra = false) => {
    const target = pickTarget()
    if (!target) return
    playerAttacking = true
    const eStats = enemyStats(target)
    const enemyBuffs = target.buffs

    const { pDef, pMdef } = playerDefStats()
    const burnDebuffP = playerBuffs.burn?.turns > 0 ? 0.9 : 1.0
    const curseP = playerBuffs.curse?.turns > 0 ? (playerBuffs.curse.rate ?? 0.9) : 1.0  // 戦闘エリア6の呪い：与ダメ-10%
    const madokenBonus = hasMadokenJutsu ? Math.floor(eff.matk * (pe('魔法剣士') ? 0.6 : 0.3)) : 0
    const pMatk = (eff.matk - madokenBonus) * (playerBuffs.matkUp?.turns > 0 ? playerBuffs.matkUp.rate : 1) * (playerBuffs.matkDown?.turns > 0 ? playerBuffs.matkDown.rate : 1) * passiveMatkMult * passiveMatkMultTenki * burnDebuffP * evoMatkMult(eff, allSkillsSet)
    const pAtk = (eff.atk + madokenBonus + takaAtkBonus) * madokenAtkMult * (playerBuffs.atkUp?.turns > 0 ? playerBuffs.atkUp.rate : 1) * (playerBuffs.atkDown ? playerBuffs.atkDown.rate : 1) * burnDebuffP * evoAtkMult(eff, allSkillsSet)
    const pSpd = playerSpdNow(target)
    const effBuff = { ...eff, atk: pAtk, def: pDef, mdef: pMdef, matk: pMatk, spd: pSpd }

    const playerCritRate = calcCritRate(pSpd, eStats.spd) + (eff.critBonus || 0)
    const enemyEvasionRate = calcEvasionRate(eStats.spd, pSpd)
    const eDefRate = (enemyBuffs.defDown ? enemyBuffs.defDown.rate : 1) * (enemyBuffs.defUp ? enemyBuffs.defUp.rate : 1) * (1 - (eff.defPen || 0))
    const eMdefRate = (enemyBuffs.mdefDown ? enemyBuffs.mdefDown.rate : 1) * (enemyBuffs.mdefUp ? enemyBuffs.mdefUp.rate : 1) * (1 - (eff.mdefPen || 0))
    const enBaseDef = eStats.def
    const enBaseMdef = eStats.mdef
    const prefix = isExtra ? `↳ ${profile.username} の` : `${profile.username} の`
    const isCrit = Math.random() * 100 < playerCritRate
    const critMult = isCrit ? (1.5 + (eff.critDmg || 0) + passiveCritDmgBonus) : 1.0

    // executeSkill が参照する敵オブジェクト（タワーの敵を街の敵の形に合わせる）
    const enemyForSkill = { name: target.name, hp: target.hp, hp_max: target.maxHp, atk: eStats.atk, def: enBaseDef, matk: eStats.matk, mdef: enBaseMdef, spd: eStats.spd, type: target.type }

    const buffHitBonus = playerBuffs.hitBonus?.turns > 0 ? playerBuffs.hitBonus.value : 0
    const peekIdx = playerBuffs.berserk?.turns > 0 && playerBuffs.berserk.lockedSkill
      ? expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
      : (skillIndex % (expandedSkillSet.length || 1))
    const nextSkill = expandedSkillSet.length > 0 ? expandedSkillSet[Math.max(0, peekIdx)]?.skills : null
    const nextSkillName = nextSkill?.name || null
    let mpLack = false
    if (nextSkill) {
      let peekMpCost = Math.floor((isArtifact ? (nextSkill.mp_cost || 0) * 2 : (nextSkill.mp_cost || 0)) * passiveMpCostMult)
      if (nextSkill.name === 'マナボルト') peekMpCost = Math.max(1, Math.floor(playerMp * 0.1))
      mpLack = playerMp < peekMpCost
      if (mpLack) logs.push({ text: `💧 MPが足りなくてスキルが使えない！`, color: '#6699ff' })
    }
    const isSureHit = !mpLack && nextSkillName === '絶影狙撃'
    const isSelfSkill = !mpLack && isSelfTargetSkill(nextSkill, playerBuffs)
    const isMultiHitSkill = !mpLack && nextSkill && MULTI_HIT_SKILLS.has(nextSkill.name)
    const skillExtraHit = (nextSkillName === '連装銃撃' && profile.class === '魔銃士' && rtCur >= 2) ? 10 : 0
    const baseEnemyEvasion = Math.max(0, enemyEvasionRate - playerHitBonus - buffHitBonus - skillExtraHit)
    const effectiveEnemyEvasion = (isSureHit || isSelfSkill || isMultiHitSkill) ? 0 : baseEnemyEvasion

    // 適応（戦闘エリア6）：直前に当てたのと同じスキルは2発目が無効化される
    const adaptActive = !!target.mods?.adapt && !mpLack && !!nextSkillName && target.lastPlayerSkill === nextSkillName

    if (effectiveEnemyEvasion > 0 && Math.random() * 100 < effectiveEnemyEvasion) {
      logs.push({ text: `${prefix}${nextSkillName && !mpLack ? `${nextSkillName}！` : '攻撃！'} しかし${target.name}に回避された！`, color: '#446688' })
      if (expandedSkillSet.length > 0) skillIndex++
      playerAttacking = false
      return
    }

    if (playerBuffs.berserk?.turns > 0 && playerBuffs.berserk.lockedSkill) {
      const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
      if (lockedIdx >= 0) skillIndex = lockedIdx
    }
    if (playerBuffs.tenkaiCharge?.turns > 0) {
      const tIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === '天墜竜閃')
      if (tIdx >= 0) skillIndex = tIdx
    }

    // 与ダメージにかかるタワー側の倍率
    const towerOutMult = (isPhys) => (isPhys ? tr.physDmgMult : tr.magDmgMult) * curseP * enemyTakenMult(target, isPhys)

    let skillUsed = false
    if (expandedSkillSet.length > 0) {
      const cs = expandedSkillSet[skillIndex % expandedSkillSet.length]
      let mpCost = Math.floor((isArtifact ? (cs?.skills?.mp_cost || 0) * 2 : (cs?.skills?.mp_cost || 0)) * passiveMpCostMult)
      if (cs?.skills?.name === 'マナボルト') mpCost = Math.max(1, Math.floor(playerMp * 0.1))
      if (cs?.skills?.name === '天墜竜閃' && playerBuffs.tenkaiCharge?.turns > 0) mpCost = 0
      const isBreederCmd = cs?.skills?.name && BREEDER_COMMANDS.has(cs.skills.name)
      if (isBreederCmd) {
        const cmd = tryPetCommand(cs.skills.name, summon, { def: enBaseDef, mdef: enBaseMdef, atk: eStats.atk, matk: eStats.matk, type: target.type, name: target.name, evasionRate: 0 }, enemyBuffs, playerBuffs, rtCur, playerMp, mpCost, eff.hp_max, logs, ``)
        if (cmd.handled) {
          playerMp -= cmd.mpUsed
          if (cmd.enemyDamage > 0) { const d = Math.max(1, Math.floor(cmd.enemyDamage * towerOutMult(true))); target.hp -= d; applyReflect(target, d) }
          if (cmd.playerHeal > 0) playerHp = Math.min(eff.hp_max, playerHp + Math.floor(cmd.playerHeal * healOutMult()))
          prevSkillName = cs.skills.name
          skillUsed = true; skillIndex++
        }
      } else if (cs && cs.skills && playerMp >= mpCost) {
        playerMp -= mpCost
        if (adaptActive) {
          // 適応で無効化。MPは消費するがダメージも効果も乗らない（無効化したら適応は解ける）
          logs.push({ text: `${prefix}${cs.skills.name}！ しかし${target.name}は既に適応していた！ 攻撃が通らない！`, color: '#aa88cc' })
          target.lastPlayerSkill = null
          prevSkillName = cs.skills.name
          skillIndex++
          playerAttacking = false
          return
        }
        const hasGensoKyomei = passiveNames.includes('元素共鳴')
        const gensoMult = (hasGensoKyomei && prevSkillName && prevSkillName !== cs.skills.name && cs.skills.type === '魔法攻撃') ? (pe('元素使い') ? 1.50 : 1.30) : 1.0
        if (hasSeimitsu && pe('魔銃士')) seimitsuStacks = (prevSkillName && prevSkillName === cs.skills.name) ? Math.min(3, seimitsuStacks + 1) : 0
        const seimitsuMult = 1 + 0.10 * seimitsuStacks
        const seimitsuCritBonus = 2 * seimitsuStacks
        prevSkillName = cs.skills.name

        const prevEnemyBuffSnapshot = { ...enemyBuffs }
        const res = executeSkill(cs.skills, { ...effBuff, lastMpCost: mpCost }, profile, enemyForSkill, enemyBuffs, playerBuffs, isArtifact, prevSkillName)
        const rokkanMult = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05 * Math.min(6, rokkanStacks)) : 1.0
        const iaiMult = (cs.skills?.type === '物理攻撃') ? iaiPhysMult : 1.0
        const finalCrit = res.dmg > 0 && (isCrit || ((res.bonusCritRate > 0 || seimitsuCritBonus > 0) && Math.random() * 100 < playerCritRate + res.bonusCritRate + seimitsuCritBonus))
        const finalCritMult = finalCrit ? (1.5 + (eff.critDmg || 0) + passiveCritDmgBonus) : 1.0
        const tosoMult = hasTosoHonno ? (playerHp <= eff.hp_max * 0.3 ? (pe('体術師') ? 2.0 : 1.6) : playerHp <= eff.hp_max * 0.5 ? (pe('体術師') ? 1.4 : 1.2) : 1.0) : 1.0
        const isPhysSkill = cs.skills?.type === '物理攻撃'
        let defScale = 1.0
        if (res.dmg > 0) {
          const sType = cs.skills?.type
          const skillCls = cs.skills?.class_name
          const buffPen = playerBuffs.mukyoPen?.turns > 0 ? playerBuffs.mukyoPen.rate : 0
          const spMdefPen = playerBuffs.spiritMdefPen?.turns > 0 ? playerBuffs.spiritMdefPen.rate : 0
          const adjED = Math.max(1, Math.floor(enBaseDef * eDefRate * (1 - Math.min(PEN_CAP, (res.defPen || 0) + buffPen))))
          const adjEMD = Math.max(1, Math.floor(enBaseMdef * eMdefRate * (1 - Math.min(PEN_CAP, (res.mdefPen || 0) + spMdefPen))))
          const useLowDef = cs.skills?.name === 'サイコブラスト' || res.useMinDef || skillCls === 'サイキッカー' || skillCls === '魔銃士'
          if (res.physScaleMatk) defScale = effBuff.matk / (effBuff.matk + adjED)
          else if (useLowDef) defScale = effBuff.matk / (effBuff.matk + Math.min(adjED, adjEMD))
          else if (sType === '物理攻撃') defScale = effBuff.atk / (effBuff.atk + adjED)
          else if (sType === '魔法攻撃') defScale = effBuff.matk / (effBuff.matk + adjEMD)
        }
        const allinDebuffOutMult = playerBuffs.allinDebuff?.turns > 0 ? 0.7 : 1.0
        const nextBoostMult = (res.dmg > 0 && playerBuffs.nextSkillBoost) ? playerBuffs.nextSkillBoost.rate : 1.0
        if (nextBoostMult > 1.0 && cs.skills?.name !== '半月蹴り') res.newPlayerBuffs.nextSkillBoost = undefined
        const enemyDmgReduceMult = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
        const emMult = emblemDmgMult(eff, isPhysSkill)
        const towerMult = towerOutMult(isPhysSkill)

        const isMulti = Array.isArray(res.hitDmgs) && res.hitDmgs.length > 0 && res.dmg > 0
        let finalDmg, resLog, multiCritAny = false
        if (isMulti) {
          const hitMult = defScale * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * nextBoostMult * enemyDmgReduceMult * emMult * towerMult
          const parts = []
          finalDmg = 0
          for (const hd of res.hitDmgs) {
            if (baseEnemyEvasion > 0 && Math.random() * 100 < baseEnemyEvasion) { parts.push('回避された！'); continue }
            const hCrit = Math.random() * 100 < (playerCritRate + (res.bonusCritRate || 0) + seimitsuCritBonus)
            const hMult = hCrit ? (1.5 + (eff.critDmg || 0) + passiveCritDmgBonus) : 1.0
            const hDmg = Math.max(1, Math.floor(hd * hitMult * hMult * (0.9 + Math.random() * 0.2)))
            if (hCrit) multiCritAny = true
            finalDmg += hDmg
            parts.push(`${hDmg}ダメージ！${hCrit ? '💥' : ''}`)
          }
          resLog = `${res.log.split('！')[0]}！ ${target.name}に ${parts.join(' ')}`
        } else {
          finalDmg = Math.floor(res.dmg * defScale * finalCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * nextBoostMult * enemyDmgReduceMult * emMult * towerMult * (0.9 + Math.random() * 0.2))
          resLog = res.dmg > 0 ? res.log.replace(String(res.dmg), String(finalDmg)) : res.log
        }
        if (res.selfDmg > 0) playerHp = Math.max(0, playerHp - res.selfDmg)
        target.hp -= finalDmg
        if (target.mods?.adapt && finalDmg > 0) target.lastPlayerSkill = cs.skills.name

        // 吸収の出所（紋章）は書かない。ただしHPは実際に動くので回復した事象だけ残す
        { const emDrain = emblemDrainAmount(eff, finalDmg, isPhysSkill); if (emDrain > 0 && !(playerBuffs.healSeal?.turns > 0)) { const emHeal = Math.floor(emDrain * healOutMult()); playerHp = Math.min(eff.hp_max, playerHp + emHeal); logs.push({ text: `💚 HPが${emHeal}回復した！`, color: '#44ff88' }) } }
        if (hasRokkan && pe('サイキッカー') && finalDmg > 0 && cs.skills?.type === '魔法攻撃') rokkanStacks = Math.min(6, rokkanStacks + 1)
        if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_heal_down_10_2t' && !(enemyBuffs.healDown?.turns > 0)) {
          enemyBuffs.healDown = { turns: 2, rate: 0.7 }
        }
        if (finalDmg > 0 && equippedWeaponItem?.bonus_effect === 'hit_spd_down_5') {
          const curSd = enemyBuffs.spdDown
          const amzSt = Math.min(4, ((curSd?.turns > 0 && curSd.amazaneStacks) || 0) + 1)
          const amzRate = Math.round((1 - 0.05 * amzSt) * 100) / 100
          if (!(curSd?.turns > 0) || curSd.amazaneStacks > 0 || amzRate < curSd.rate) enemyBuffs.spdDown = { turns: 2, rate: amzRate, amazaneStacks: amzSt }
        }
        evoOnHit(eff, finalDmg, enemyBuffs, target.name, logs, isMulti ? multiCritAny : finalCrit)
        // 蒼雷の短刃: 追加行動の攻撃ヒット時、eff.extraParaChance%で相手を麻痺
        // 麻痺の付与は残すが、どの装備のおかげかは書かないので発動ログは出さない
        if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(enemyBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
          enemyBuffs.paralysis = { turns: 3, skipRate: 0.25, spdRate: 0.8 }
        }
        const healAmt = playerBuffs.healSeal?.turns > 0 ? 0 : Math.floor(res.heal * passiveHealMult * (playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1) * healOutMult())
        playerHp = Math.min(eff.hp_max, playerHp + healAmt)
        // ログの回復量も実際に足した数へ合わせる。executeSkill は回復力低下(3層)も
        // 長期戦の回復阻害も知らないので、素の数字のままだと表示だけ嘘になる。
        // ダメージ側（425行）と同じやり方。浄化の輝きのようにダメージと回復が同じ文にある技があるので、
        // 数字の単純置換ではなく「回復」の直前の数字だけを差し替える。
        if (res.heal > 0 && healAmt !== res.heal) {
          resLog = resLog.replace(new RegExp(String(res.heal) + '(?=\\D*回復)'), String(healAmt))
        }
        if (passiveHealReflect && healAmt > 0) { target.hp -= healAmt; logs.push({ text: `✨ 神聖加護の反射！ ${target.name}に${healAmt}ダメージ！`, color: '#ffdd44' }) }

        if (playerBuffs.spellBladeSealed?.turns > 0) {
          const blocked = ['atkUp', 'matkUp', 'spdUp', 'dmgReduce', 'regenHeal', 'hitBonus', 'evasion', 'bloodRage', 'statusImmune', 'holyField', 'holyAwakening', 'flashCombo', 'spellBladeExhaust', 'nextSkillBoost']
          const had = blocked.some(k => res.newPlayerBuffs[k] !== playerBuffs[k] && res.newPlayerBuffs[k] !== undefined)
          for (const k of blocked) { if (res.newPlayerBuffs[k] !== playerBuffs[k]) res.newPlayerBuffs[k] = playerBuffs[k] }
          if (had) logs.push({ text: `⚔ 魔剣開放の反動中！ バフが効かない！`, color: '#ff4444' })
        }
        if (playerBuffs.allinDebuff?.turns > 0) {
          const blocked = ['atkUp', 'matkUp', 'spdUp', 'dmgReduce', 'regenHeal', 'hitBonus', 'evasion', 'bloodRage', 'statusImmune', 'nextSkillBoost']
          const had = blocked.some(k => res.newPlayerBuffs[k] !== playerBuffs[k] && res.newPlayerBuffs[k] !== undefined)
          for (const k of blocked) { if (res.newPlayerBuffs[k] !== playerBuffs[k]) res.newPlayerBuffs[k] = playerBuffs[k] }
          if (had) logs.push({ text: `💸 オールインの反動中！ バフが効かない！`, color: '#ff4444' })
        }
        playerBuffs = { ...playerBuffs, ...res.newPlayerBuffs }
        Object.assign(target.buffs, res.newEnemyBuffs)
        // 状態異常の付与率+（ツリー）：今回の判定で新しい異常が付かなかったときだけ、確率で再判定する
        if (tr.ailRate > 0 && res.dmg >= 0) {
          const gotNew = TOWER_AILMENTS.concat(['severePoisoin', 'healSeal']).some(k => !prevEnemyBuffSnapshot[k] && target.buffs[k])
          if (!gotNew && Math.random() < tr.ailRate) {
            const re = executeSkill(cs.skills, { ...effBuff, lastMpCost: mpCost }, profile, enemyForSkill, { ...prevEnemyBuffSnapshot }, playerBuffs, isArtifact, prevSkillName)
            for (const k of TOWER_AILMENTS.concat(['severePoisoin'])) {
              if (!prevEnemyBuffSnapshot[k] && re.newEnemyBuffs?.[k]) {
                target.buffs[k] = re.newEnemyBuffs[k]
                logs.push({ text: `🌫 タワーの加護！ ${target.name}に状態異常が通った！`, color: '#bb88ff' })
              }
            }
          }
        }
        if (passiveNames.includes('精霊共鳴') && playerBuffs.spiritCombo?.tripled) {
          playerBuffs.guaranteedExtra = true
          playerBuffs.spiritCombo = { ...playerBuffs.spiritCombo, tripled: false }
          logs.push({ text: `🌟 精霊共鳴！ 精霊の力が高まり、追加行動を得る！`, color: '#ffdd66' })
        }
        const critInsert = (finalCrit && !isMulti) ? '💥クリティカル！ ' : ''
        const dmgIdx = resLog.indexOf(target.name + 'に')
        const logWithCrit = critInsert
          ? (dmgIdx >= 0 ? resLog.slice(0, dmgIdx) + critInsert + resLog.slice(dmgIdx) : resLog + ' ' + critInsert)
          : resLog
        logs.push({ text: `${prefix}${logWithCrit}`, color: (finalCrit && !isMulti) || multiCritAny ? '#ffff00' : '#88ccff' })

        if (res.followup && res.followup.dmg > 0) {
          const fCrit = Math.random() * 100 < (playerCritRate + (res.bonusCritRate || 0) + seimitsuCritBonus)
          const fCritMult = fCrit ? (1.5 + (eff.critDmg || 0) + passiveCritDmgBonus) : 1.0
          const fDmg = Math.max(1, Math.floor(res.followup.dmg * defScale * fCritMult * passiveDmgMult * gensoMult * tosoMult * seimitsuMult * iaiMult * rokkanMult * allinDebuffOutMult * enemyDmgReduceMult * emMult * towerMult * (0.9 + Math.random() * 0.2)))
          target.hp -= fDmg
          logs.push({ text: `↳ 追撃！${res.followup.label ? `（${res.followup.label}）` : ''} ${target.name}に${fDmg}ダメージ！${fCrit ? ' 💥クリティカル！' : ''}`, color: fCrit ? '#ffaa00' : '#ffaa66' })
          applyReflect(target, fDmg)
        }
        const healCapPct = (finalCrit || multiCritAny) ? 0.35 : 0.20
        if (playerAttacking && playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const rageCure = Math.floor(Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(eff.hp_max * healCapPct)) * healOutMult())
          playerHp = Math.min(eff.hp_max, playerHp + rageCure)
          logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
        }
        if (res.drainRate > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
          const drainHeal = Math.floor(Math.min(Math.floor(finalDmg * res.drainRate), Math.floor(eff.hp_max * healCapPct)) * healOutMult())
          playerHp = Math.min(eff.hp_max, playerHp + drainHeal)
          logs.push({ text: `💚 HPを${drainHeal}回復！`, color: '#66ffaa' })
        }
        if (playerBuffs.holyAwakening?.turns > 0 && finalDmg > 0) {
          const holyBonusDmg = Math.floor((pDef * playerBuffs.holyAwakening.defMult + pMdef * playerBuffs.holyAwakening.defMult) * towerMult)
          target.hp -= holyBonusDmg
          logs.push({ text: `✨ 神聖覚醒の追撃！ ${target.name}に${holyBonusDmg}ダメージ！`, color: '#ffeeaa' })
        }
        applyReflect(target, finalDmg)
        skillUsed = true; skillIndex++
      }
    }
    if (!skillUsed) {
      const towerMult = towerOutMult(!isMagical)
      const baseAtk = isMagical ? effBuff.matk : effBuff.atk
      const eDefVal = isMagical
        ? Math.max(1, Math.floor(enBaseMdef * eMdefRate))
        : Math.max(1, Math.floor(enBaseDef * eDefRate))
      const baseDmg = Math.max(1, Math.floor(baseAtk * baseAtk / Math.max(1, baseAtk + eDefVal)) + Math.floor(Math.random() * 4))
      const enemyDmgReduceMult2 = enemyBuffs.dmgReduce?.turns > 0 ? enemyBuffs.dmgReduce.rate : 1.0
      const iaiNormalMult = isMagical ? 1.0 : iaiPhysMult
      const rokkanMultN = (hasRokkan && pe('サイキッカー')) ? (1 + 0.05 * Math.min(6, rokkanStacks)) : 1.0
      seimitsuStacks = 0; prevSkillName = null
      const finalDmg = Math.floor(baseDmg * 0.7 * critMult * (isArtifact ? 1.3 : 1.0) * passiveDmgMult * iaiNormalMult * rokkanMultN * enemyDmgReduceMult2 * emblemDmgMult(eff, !isMagical) * towerMult * (0.9 + Math.random() * 0.2))
      target.hp -= finalDmg
      // 吸収の出所（紋章）は書かない。ただしHPは実際に動くので回復した事象だけ残す
      { const emDrain = emblemDrainAmount(eff, finalDmg, !isMagical); if (emDrain > 0 && !(playerBuffs.healSeal?.turns > 0)) { const emHeal = Math.floor(emDrain * healOutMult()); playerHp = Math.min(eff.hp_max, playerHp + emHeal); logs.push({ text: `💚 HPが${emHeal}回復した！`, color: '#44ff88' }) } }
      evoOnHit(eff, finalDmg, enemyBuffs, target.name, logs, isCrit)
      // 蒼雷の短刃: 追加行動の攻撃ヒット時、eff.extraParaChance%で相手を麻痺
      // 麻痺の付与は残すが、どの装備のおかげかは書かないので発動ログは出さない
      if (isExtra && finalDmg > 0 && (eff?.extraParaChance || 0) > 0 && !(enemyBuffs.paralysis?.turns > 0) && Math.random() * 100 < eff.extraParaChance) {
        enemyBuffs.paralysis = { turns: 3, skipRate: 0.25, spdRate: 0.8 }
      }
      logs.push({ text: `${prefix}${isCrit ? '💥クリティカル！ ' : ''}攻撃！ ${target.name}に${finalDmg}ダメージ！`, color: '#ffcc00' })
      if (playerBuffs.bloodRage?.turns > 0 && finalDmg > 0 && !(playerBuffs.healSeal?.turns > 0)) {
        const rageCure = Math.floor(Math.min(Math.floor(finalDmg * playerBuffs.bloodRage.healRate), Math.floor(eff.hp_max * (isCrit ? 0.35 : 0.20))) * healOutMult())
        playerHp = Math.min(eff.hp_max, playerHp + rageCure)
        logs.push({ text: `🩸 血の狂気で${rageCure}回復！`, color: '#ff4444' })
      }
      applyReflect(target, finalDmg)
      if (expandedSkillSet.length > 0) skillIndex++
    }
    if (target.hp <= 0) onEnemyDown(target)
    playerAttacking = false
  }

  // 戦闘エリア3の「回復力低下」：生きている敵のうち最も厳しい倍率を採用
  // ＋ 長期戦の回復阻害（20ターン超から1ターンごとに5%ずつ・40ターンで0）
  function healOutMult() {
    let m = 1
    for (const en of alive()) {
      const v = en.mods?.playerHealMult
      if (v && v < m) m = v
    }
    if (playerBuffs.healBlockRate?.turns > 0) m *= playerBuffs.healBlockRate.rate
    return m * longFightHealMult(turn)
  }

  // ============================================================
  // 敵の行動
  // ============================================================
  // 状態異常の付与（ツリーの耐性・哭雨の羽衣・紋章の耐性を通す）
  const inflict = (key, chance, payload, label) => {
    if (!(chance > 0)) return false
    if (Math.random() >= chance * (1 - tr.ailResist)) return false
    if (ailmentShieldBlocks(playerBuffs, logs)) return false
    if (emblemBlocksAilment(eff, key, logs)) return false
    if (evoBlocksAilment(eff, key, logs)) return false  // アクアクラウン(真化)
    if (key === 'bleed') {
      const b = playerBuffs.bleed
      playerBuffs.bleed = { stacks: Math.min(5, (b?.stacks || 0) + (payload?.stacks || 1)), lastTurn: 0 }
    } else {
      playerBuffs[key] = { ...payload }
    }
    logs.push({ text: `${label}`, color: '#aa66ff' })
    return true
  }

  // 敵スキルによるプレイヤーへのダメージ
  const damagePlayer = (en, raw, offStat, useStat, opts = {}) => {
    if (summonAbsorbSkill(summon, raw, logs)) return { dmg: 0, isCrit: false }
    const { pDef, pMdef } = playerDefStats(true)   // 被弾側＝竜鱗の加護を乗せる
    let defStat = useStat === 'matk' ? pMdef : pDef
    if (opts.defPen) defStat *= (1 - opts.defPen)
    const rankStat = useStat === 'matk' ? eff.mdef : eff.def
    const defScale = offStat / (offStat + Math.max(1, defStat))
    const eStats = enemyStats(en)
    let critRate = Math.max(0, calcCritRate(eStats.spd, eff.spd) - (eff.critResist || 0) - (playerBuffs.critResist?.turns > 0 ? (playerBuffs.critResist.value || 0) : 0))
    if (en.mods?.critVsBurn && playerBuffs.burn?.turns > 0) critRate += en.mods.critVsBurn   // 戦闘エリア8：やけど中はクリ率+
    const isCrit = Math.random() * 100 < critRate
    const rankRed = calcDefReduction(rankStat)
    const dmgReduceRate = playerBuffs.dmgReduce?.turns > 0 ? playerBuffs.dmgReduce.rate : 1.0
    const gambleBodyMult = hasGambleBody ? (pe('ギャンブラー') ? (0.5 + Math.random() * 0.7) : (0.7 + Math.random() * 0.6)) : 1.0
    const allinDebuffInMult = playerBuffs.allinDebuff?.turns > 0 ? 1.3 : 1.0
    const berserkDmgRate = hasBerserk ? (pe('狂戦士') ? 1.20 : 1.15) : 1.0
    const dmg = Math.max(0, Math.floor(
      raw * defScale * (isCrit ? 1.5 : 1.0) * (1 - rankRed) * dmgReduceRate * berserkDmgRate
      * gambleBodyMult * allinDebuffInMult * tr.takenMult
      * evoTakenMult(eff, useStat !== 'matk', playerHp / eff.hp_max) * ryurinReduce() * (0.9 + Math.random() * 0.2)
    ))
    playerHp -= dmg
    if (playerBuffs.dmgReduce?.isGainoKabe) playerBuffs.dmgReduce = null
    const refl = evoOnDamaged(eff, dmg, en.buffs, en.name, logs); if (refl > 0) en.hp -= refl
    applyLifesteal(en, dmg)
    // 地響き（戦闘エリア10）：命中するたびにこちらの素早さが下がる
    if (dmg > 0 && en.mods?.quake) {
      const q = en.mods.quake
      quakeStep = q.spdDown || 0.05
      quakeMax = q.maxStacks || 10
      if (quakeStacks < quakeMax) {
        quakeStacks++
        logs.push({ text: `🌋 ${en.name}の地響き！ あなたの素早さが下がった（-${Math.round(Math.min(0.5, quakeStacks * quakeStep) * 100)}%）`, color: '#cc9944' })
      }
    }
    return { dmg, isCrit }
  }

// 通常攻撃。isBasic を立てて「技の威力つまみ」の対象外にする。
//  ⚠倍率1.5は、つまみが掛かっていた頃（攻撃力×1.0×ENEMY_SKILL_POWER 1.5）と
//    同じ威力にするための値。ここを1.0に戻すと公開中の1〜4層が弱くなる。
const basicAttack = (en) => ({ name: '攻撃', type: en.type === 'magical' ? 'magical' : 'physical', mult: 1.5, isBasic: true })

  // その強化スキルの効果が既に乗っているか（乗っているなら選び直す＝棒立ちを避ける）
  const buffAlreadyOn = (en, sk) => {
    if (sk.effect === 'defMdefUp') return en.buffs.defUp?.turns > 0
    if (sk.effect === 'atkSpdUp') return en.buffs.atkUp?.turns > 0 && en.buffs.spdUp?.turns > 0
    if (sk.effect === 'atkUp') return en.buffs.atkUp?.turns > 0
    return false
  }

  // 行動に使うスキルを選ぶ（強化スキルも含む＝設計どおり手数を1つ使って自己強化する）
  const pickEnemySkill = (en) => {
    const pool = en.skills || []
    if (!pool.length || Math.random() >= 0.9) return basicAttack(en)
    let sk = pool[Math.floor(Math.random() * pool.length)]
    // 既に効果が乗っている強化スキルを引いたときだけ、1度だけ引き直す
    if (sk.type === 'buff' && buffAlreadyOn(en, sk)) sk = pool[Math.floor(Math.random() * pool.length)]
    return sk
  }

  // 敵1体ぶんの通常行動（回避判定つき）
  const enemyAct = (en, forced = null, isExtra = false) => {
    const eStats = enemyStats(en)
    const sk = forced || pickEnemySkill(en)
    const prefix = isExtra ? '↳ ' : ''

    // 自己強化
    if (sk.type === 'buff') {
      const t = sk.turns || 3
      if (sk.effect === 'defMdefUp') { en.buffs.defUp = { turns: t, rate: sk.defRate || 1.3 }; en.buffs.mdefUp = { turns: t, rate: sk.mdefRate || 1.3 } }
      if (sk.effect === 'atkSpdUp') { en.buffs.atkUp = { turns: t, rate: sk.atkRate || 1.3 }; en.buffs.spdUp = { turns: t, rate: sk.spdRate || 1.3 } }
      if (sk.effect === 'atkUp') en.buffs.atkUp = { turns: t, rate: sk.atkRate || 1.3 }
      logs.push({ text: `${prefix}${en.name}の${sk.name}！ 態勢を整えた！`, color: '#ffaa66' })
      return
    }
    // こちらへのデバフ
    if (sk.type === 'debuff') {
      const t = sk.turns || 3
      const r = sk.rate || 0.85
      if (sk.effect === 'atkDown') playerBuffs.atkDown = { turns: t, rate: r }
      if (sk.effect === 'atkMatkDown') { playerBuffs.atkDown = { turns: t, rate: r }; playerBuffs.matkDown = { turns: t, rate: r } }
      if (sk.effect === 'spdDown') playerBuffs.spdDown = { turns: t, rate: r }
      if (sk.effect === 'defDown') playerBuffs.defDown = { turns: t, rate: r }
      if (sk.effect === 'mdefDown') playerBuffs.mdefDown = { turns: t, rate: r }
      logs.push({ text: `${prefix}${en.name}の${sk.name}！ あなたの力が削がれた…`, color: '#cc88ff' })
      return
    }

    const isMag = sk.type === 'magical'
    const useStat = isMag ? 'matk' : 'atk'
    const offStat = isMag ? eStats.matk : eStats.atk
    // 回避（必中スキルを除く）
    if (!sk.sureHit) {
      const pSpd = playerSpdNow()
      const evasionRate = calcEvasionRate(pSpd, eStats.spd) + (eff.evasionBonus || 0) + (playerBuffs.evasion?.turns > 0 ? playerBuffs.evasion.rate * 100 : 0) + (hasOnmi ? 5 : 0)
      if (evasionRate > 0 && Math.random() * 100 < evasionRate) {
        logs.push({ text: `${prefix}${en.name}の${sk.name}！ しかし回避した！`, color: '#44ff88' })
        evoOnEvade(eff, playerBuffs, logs)
        return
      }
    }
    if (summonAbsorbBasic(summon, { atk: eStats.atk, matk: eStats.matk, type: en.type, name: en.name }, en.buffs, turn, logs)) return

    const hits = sk.type === 'physical_multi' ? (sk.hits || 2) : 1
    let total = 0, anyCrit = false
    for (let h = 0; h < hits; h++) {
      // 層ごとの係数は makeEnemy で攻撃力・特殊攻撃力に既に掛かっている（offStat に含まれる）。
      // ここで再度掛けると技だけ係数の2乗になるので掛けない。
      const r = damagePlayer(en, offStat * (sk.mult || 1) * skillPowerOf(sk), offStat, useStat, { defPen: sk.defPen })
      if (!r) continue
      total += r.dmg; if (r.isCrit) anyCrit = true
      if (playerHp <= 0) break
    }
    logs.push({ text: `${prefix}${en.name}の${sk.name}！ あなたに${total}ダメージ…${anyCrit ? ' 💥クリティカル！' : ''}${hits > 1 ? `（${hits}回）` : ''}`, color: anyCrit ? '#ff2200' : '#ff6644' })
    if (playerHp <= 0) return

    // 命中時の付帯効果
    if (total > 0) {
      inflict('stun', sk.stunRate, { turns: 1 }, `⚡ スタンした！ 次のターン行動できない！`)
      inflict('paralysis', sk.paralysisRate, { turns: 4, skipRate: 0.25, spdRate: 0.8 }, `⚡ 麻痺した！`)
      inflict('burn', sk.burnRate, { turns: 5, dmgRate: 0.02 }, `🔥 やけどを負った！`)
      inflict('poison', sk.poisonRate, { turns: 5, dmgRate: 0.02 }, `☠ 毒を受けた！`)
      inflict('bleed', sk.bleedRate, { stacks: 1 }, `🩸 出血した！`)
      inflict('curse', sk.curseRate ?? en.mods?.curseRate, { turns: en.mods?.curseTurns || 3, rate: 0.9 }, `💀 呪われた！ 与えるダメージが下がる…`)
      for (const oa of (en.mods?.onHitAilment || [])) {
        if (oa.key === 'bleed') inflict('bleed', oa.chance, { stacks: 1 }, `🩸 ${en.name}の一撃で出血した！`)
        else if (oa.key === 'burn') inflict('burn', oa.chance, { turns: 5, dmgRate: 0.02 }, `🔥 ${en.name}の一撃でやけどを負った！`)
        else if (oa.key === 'poison') inflict('poison', oa.chance, { turns: 5, dmgRate: 0.02 }, `☠ ${en.name}の一撃で毒を受けた！`)
      }
      // スキルに付いたデバフ（chance 未指定は100%）
      if (sk.effect && (sk.chance === undefined || Math.random() < sk.chance)) {
        const t = sk.turns || 3
        const key = { defDown: 'defDown', mdefDown: 'mdefDown', spdDown: 'spdDown', atkDown: 'atkDown' }[sk.effect]
        if (key) {
          const cur = playerBuffs[key]
          const stackMax = sk.stack || 1
          const st = Math.min(stackMax, ((cur?.turns > 0 && cur.stacks) || 0) + 1)
          const rate = Math.max(0.1, 1 - (1 - (sk.rate || 0.85)) * st)
          playerBuffs[key] = { turns: t, rate, stacks: st }
          logs.push({ text: `🔻 ${sk.name}の効果！ あなたの能力が低下した…`, color: '#88aaff' })
        }
      }
    }
  }

  // 噴火（戦闘エリア8）：必中・防御一部無視・やけど
  const doErupt = (en) => {
    const eStats = enemyStats(en)
    const e = en.mods.erupt
    // ⚠ここだけ技の威力つまみを貰い損ねていて、8層の目玉ギミックが想定の1/1.5しか
    //   出ていなかった（2026-08-06修正）。他の技と同じ扱いにする。
    const r = damagePlayer(en, eStats.atk * (e.mult || 1.8) * ENEMY_SKILL_POWER, eStats.atk, 'atk', { defPen: e.defPen || 0.3 })
    logs.push({ text: `🌋 ${en.name}の噴火！ あなたに${r?.dmg || 0}ダメージ…（必中）`, color: '#ff3300' })
    if (e.burn && playerHp > 0) inflict('burn', 1.0, { turns: 5, dmgRate: 0.02 }, `🔥 やけどを負った！`)
  }

  // HP15%以下の大技（1度きり）
  const doSpecial = (en) => {
    const sm = en.specialMove
    const eStats = enemyStats(en)
    const isMag = sm.type === 'magical'
    const off = isMag ? eStats.matk : eStats.atk
    const r = damagePlayer(en, off * (sm.mult || 2.5) * ENEMY_SKILL_POWER, off, isMag ? 'matk' : 'atk')
    logs.push({ text: `💥 ${en.name}の「${sm.name}」！ あなたに${r?.dmg || 0}ダメージ！`, color: '#ff2200' })
    if (playerHp <= 0) return
    if (sm.defDownRate) { playerBuffs.defDown = { turns: sm.turns || 3, rate: sm.defDownRate }; logs.push({ text: `🔻 防御力が大きく下がった…`, color: '#88aaff' }) }
    if (sm.effect === 'allStatDown') {
      const t = sm.turns || 3, rr = sm.rate || 0.85
      playerBuffs.atkDown = { turns: t, rate: rr }; playerBuffs.matkDown = { turns: t, rate: rr }
      playerBuffs.defDown = { turns: t, rate: rr }; playerBuffs.mdefDown = { turns: t, rate: rr }
      playerBuffs.spdDown = { turns: t, rate: rr }
      logs.push({ text: `🔻 全ての能力が低下した…`, color: '#88aaff' })
    }
    if (sm.effect === 'spdDown') { playerBuffs.spdDown = { turns: sm.turns || 3, rate: sm.rate || 0.7 }; logs.push({ text: `🔻 素早さが大きく下がった…`, color: '#88aaff' }) }
    if (sm.bleedStacks) inflict('bleed', 1.0, { stacks: sm.bleedStacks }, `🩸 深く切り裂かれた！`)
    if (sm.poisonStacks) inflict('poison', 1.0, { turns: 6, dmgRate: 0.03 }, `☠ 猛毒に侵された！`)
    if (sm.burn) inflict('burn', 1.0, { turns: 6, dmgRate: 0.02 }, `🔥 全身が燃えている！`)
    if (sm.healSealTurns) { playerBuffs.healSeal = { turns: sm.healSealTurns }; logs.push({ text: `🚫 ${sm.healSealTurns}ターンの間、回復できない！`, color: '#ff4488' }) }
    if (sm.playerHealMult) { playerBuffs.healBlockRate = { turns: sm.turns || 4, rate: sm.playerHealMult }; logs.push({ text: `🚫 回復量が下がった…`, color: '#ff4488' }) }
  }

  // 召喚。設定された体数をまとめて呼び、ログは1行だけ出す
  // （同じ行が体数ぶん並ぶと何が起きたのか読み取りづらいため）
  const spawn = (def, opts, why, count = 1) => {
    const n = Math.max(1, Math.floor(count) || 1)
    let name = ''
    for (let k = 0; k < n; k++) {
      // 層番号は召喚された敵にも引き継ぐ（引き継がないと上の層で援軍だけ緩くなる）
      const en = makeEnemy(def, { floor: summonFloor, ...opts, isSummoned: true })
      enemies.push(en)
      name = en.name
    }
    logs.push({ text: `✦ ${why} ${name}が${n > 1 ? `${n}体` : ''}現れた！`, color: '#ff88cc' })
  }

  // 敵のターン開始時トリガー（段階変化・強化・浄化・回復・召喚）
  const enemyTriggers = (en) => {
    const rate = en.hp / en.maxHp
    // 段階変化（三頭・暴走）
    if (en.phases) {
      const idx = currentPhaseIdx(en)
      if (idx > en.phaseIdx) {
        for (let i = Math.max(0, en.phaseIdx + 1); i <= idx; i++) {
          const p = en.phases[i]
          if (!p) continue
          if (p.head) logs.push({ text: `✦ ${en.name}の${p.head}の頭が前に出た！`, color: '#cc66ff' })
          else if (i > 0) logs.push({ text: `✦ ${en.name}が猛り狂っている！`, color: '#cc66ff' })
          if (p.atkMult) { en.perm.atk *= p.atkMult; en.perm.matk *= p.atkMult }
          if (p.spdMult) en.perm.spd *= p.spdMult
          if (p.summonOnEnter && floorData) {
            spawn(floorData.enemies[p.summonOnEnter.enemyIndex], {}, `${en.name}の呼び声！`, p.summonOnEnter.count || 1)
          }
        }
        en.phaseIdx = idx
      }
    }
    // 強化（戦闘エリア3）
    if (en.empower && !en.used.empower && rate <= en.empower.hpBelow) {
      en.used.empower = true
      const m = en.empower.allStatMult || 1.3
      en.perm.atk *= m; en.perm.matk *= m; en.perm.def *= m; en.perm.mdef *= m; en.perm.spd *= m
      logs.push({ text: `✦ ${en.name}の全能力が上昇した！`, color: '#ff66cc' })
    }
    // 自身のデバフ解除（HP50%以下・1度きり）
    if (en.cleanse && !en.used.cleanse && rate <= en.cleanse.hpBelow) {
      en.used.cleanse = true
      for (const k of ['defDown', 'mdefDown', 'atkDown', 'matkDown', 'spdDown', 'poison', 'burn', 'bleed', 'severePoisoin', 'paralysis', 'stun', 'dmgReduce', 'healDown']) delete en.buffs[k]
      logs.push({ text: `🌀 ${en.name}が身にまとった弱体を振り払った！`, color: '#cc66ff' })
    }
    // 自己回復（戦闘エリア10）
    if (en.selfHeal && !en.used.selfHeal && rate <= en.selfHeal.hpBelow) {
      en.used.selfHeal = true
      const h = Math.floor(en.maxHp * (en.selfHeal.healPct || 0.2))
      en.hp = Math.min(en.maxHp, en.hp + h)
      logs.push({ text: `💚 ${en.name}が${h}回復した！`, color: '#44ff88' })
    }
    // 取り巻き召喚（戦闘エリア1）
    if (en.summonDef && floorData && !en.used.summon && rate <= en.summonDef.hpBelow) {
      en.used.summon = true
      spawn(floorData.enemies[en.summonDef.enemyIndex], {}, `${en.name}の号令！`, en.summonDef.count || 1)
    }
    // 強敵級の召喚（戦闘エリア7）
    if (en.summonMid && floorData && !en.used.summonMid && rate <= en.summonMid.hpBelow) {
      en.used.summonMid = true
      const sr = en.summonMid.statRate || 0.5
      // 呼ばれるのは強敵の定義なので isBoss を渡す。渡さないと雑魚の被ダメージ倍率
      // （5層以降はボスより緩い）を引いてしまい、援軍だけ柔らかくなる
      spawn(floorData.midBoss, { statRate: sr, hpRate: sr, isBoss: true }, `${en.name}が呼び寄せた！`, en.summonMid.count || 1)
    }
    // 定期召喚（戦闘エリア4）
    if (en.summonLoop && floorData) {
      const sl = en.summonLoop
      if (en.turnCount > 0 && en.turnCount % (sl.everyTurns || 2) === 0) {
        const aliveSummons = enemies.filter(e => e.isSummoned && e.hp > 0).length
        if (aliveSummons < (sl.maxAlive || 3)) spawn(floorData.enemies[sl.enemyIndex], { hpRate: sl.hpRate || 0.25 }, `${en.name}が呼び寄せた！`)
      }
    }
    // 硬化（戦闘エリア4）：ターンごとに防御が上がっていく
    if (en.mods?.defRamp) en.defRamp *= en.mods.defRamp
  }

  const doEnemyTurn = (en) => {
    en.turnCount++
    enemyTriggers(en)
    if (playerHp <= 0 || en.hp <= 0) return
    // 噴火（戦闘エリア8）：通常行動とは別枠（手数を食わない）
    if (en.mods?.erupt && en.turnCount % (en.mods.erupt.everyTurns || 3) === 0) {
      doErupt(en)
      if (playerHp <= 0) return
    }
    // 暴風（戦闘エリア5）：確率でこのターンの行動が2回になる
    const acts = (en.mods?.doubleActRate && Math.random() < en.mods.doubleActRate) ? 2 : 1
    if (acts > 1) logs.push({ text: `🌪 ${en.name}は暴風をまとい、続けて動く！`, color: '#88ddff' })
    for (let a = 0; a < acts; a++) {
      // 大技（HP15%以下・1度きり）
      if (en.specialMove && !en.used.special && en.hp / en.maxHp <= 0.15) { en.used.special = true; doSpecial(en) }
      else enemyAct(en, null, a > 0)
      if (playerHp <= 0) return
    }
    // 素早さによる追加行動（通常攻撃）
    const ex = calcExtraActionRate(enemyStats(en).spd, playerSpdNow())
    if (ex > 0 && Math.random() * 100 < ex) {
      logs.push({ text: '⚡ 追加行動！', color: '#ffdd44' })
      enemyAct(en, basicAttack(en), true)
    }
  }

  // 戦闘状況（HP/MPバー）は各ターンの先頭に1回だけ出す。
  // 敵は倒した相手も含めて全員ぶんバーを出す（誰を倒したか・残りが誰かを見えるようにする）
  const pushHp = () => {
    const front = alive()[0]
    logs.push({
      type: 'hp', turn,
      vertical: true,   // 敵が最大4体出るので縦積みで表示する
      playerHp: Math.max(0, playerHp), playerMax: eff.hp_max, playerName: profile.username,
      playerMp: Math.max(0, playerMp), playerMpMax: eff.mp_max,
      playerStatus: extractStatuses(playerBuffs),
      // twin: BattleLogLine が1体ずつバーを描く。撃破済みは名前に印を付ける
      twin: enemies.map(e => ({
        name: e.hp > 0 ? e.name : `${e.name}（撃破）`,
        hp: Math.max(0, e.hp), max: e.maxHp,
      })),
      // 単体表示にフォールバックしたとき用（twin が優先される）
      enemyHp: Math.max(0, front?.hp || 0), enemyMax: front?.maxHp || 1, enemyName: front?.name || '—',
      enemyStatus: extractStatuses(front?.buffs || {}),
    })
  }

  // ============================================================
  // メインループ
  // ============================================================
  while (playerHp > 0 && alive().length > 0 && turn <= turnCap) {
    pushHp()
    // 長期戦の回復阻害が始まったことは1回だけ知らせる。
    // 黙って回復量が落ちると「回復が効かない不具合」に見えるため。
    if (turn === LONG_FIGHT_FROM + 1) {
      logs.push({ text: `⏳ 戦いが長引いている… ここから回復量がターンごとに落ちていく！`, color: '#ff8844' })
    }
    const hpBeforeTurn = playerHp
    if (passiveNames.includes('骸の壁') && (turn === 1 || turn % 4 === 0)) {
      playerBuffs.dmgReduce = { turns: 999, rate: 0.7, isGainoKabe: true }
      logs.push({ text: `💀 骸の壁発動！ 次に攻撃を受けるまで被ダメ-30%！`, color: '#cc44ff' })
    }

    // ── 敵への持続ダメージ ──
    for (const en of alive()) {
      if (en.buffs.severePoisoin?.turns > 0) {
        const d = Math.floor(en.maxHp * 0.05 * emblemDotMult(eff, 'poison')); en.hp -= d
        logs.push({ text: `🤢 猛毒ダメージ！ ${en.name}に${d}ダメージ！`, color: '#aa44ff' })
      }
      if (en.hp > 0 && en.buffs.burn?.turns > 0) {
        const d = Math.floor(en.maxHp * 0.02 * emblemDotMult(eff, 'burn')); en.hp -= d
        logs.push({ text: `🔥 やけどダメージ！ ${en.name}に${d}ダメージ！`, color: '#ff6622' })
      }
      if (en.hp > 0 && en.buffs.poison?.turns > 0) {
        const d = Math.floor(en.maxHp * (en.buffs.poison.dmgRate || 0.02) * emblemDotMult(eff, 'poison')); en.hp -= d
        logs.push({ text: `☠ 毒ダメージ！ ${en.name}に${d}ダメージ！`, color: '#44ff44' })
      }
      if (en.hp > 0 && en.buffs.curseDmg?.turns > 0) {
        en.hp -= en.buffs.curseDmg.dmg
        logs.push({ text: `💀 呪縛ダメージ！ ${en.name}に${en.buffs.curseDmg.dmg}ダメージ！`, color: '#cc44ff' })
      }
      if (en.hp <= 0) onEnemyDown(en)
    }
    if (alive().length === 0) break

    // ── 召喚（式神／ペット）の攻撃：先頭の対象へ ──
    {
      const t = pickTarget()
      if (t) {
        const eStats = enemyStats(t)
        const sEnemy = { def: eStats.def, mdef: eStats.mdef, atk: eStats.atk, matk: eStats.matk, type: t.type, name: t.name, evasionRate: 0 }
        const d = summonAttackDamage(summon, sEnemy, t.buffs, playerBuffs, eff, rtCur, logs)
        if (d > 0) { t.hp -= Math.floor(d * enemyTakenMult(t, true)); if (t.hp <= 0) onEnemyDown(t) }
      }
    }
    if (alive().length === 0) break

    // ── プレイヤーへの持続ダメージ ──
    if (playerBuffs.severePoisoin?.turns > 0) {
      const d = Math.floor(eff.hp_max * 0.05 * (1 - tr.pctResist)); playerHp = Math.max(0, playerHp - d)
      logs.push({ text: `🤢 猛毒ダメージ！ あなたに${d}ダメージ！`, color: '#aa44ff' })
      if (playerHp <= 0) break
    }
    if (playerBuffs.burn?.turns > 0) {
      const d = Math.floor(eff.hp_max * 0.02 * (1 - tr.pctResist)); playerHp = Math.max(0, playerHp - d)
      logs.push({ text: `🔥 やけどダメージ！ あなたに${d}ダメージ！`, color: '#ff6622' })
      if (playerHp <= 0) break
    }
    if (playerBuffs.poison?.turns > 0) {
      const d = Math.floor(eff.hp_max * (playerBuffs.poison.dmgRate || 0.02) * (1 - tr.pctResist)); playerHp = Math.max(0, playerHp - d)
      logs.push({ text: `☠ 毒ダメージ！ あなたに${d}ダメージ！`, color: '#44ff44' })
      if (playerHp <= 0) break
    }
    // 毎ターンの割合ダメージ（最大HPの一定割合・防御では止まらない）
    //  生きている敵のうち最も強い割合を採用する。呼び名は敵ごとに変えられる
    //  （3層=毒沼／9層の蛇=毒沼／5層以降のエリアボス=層ごとの名前）。
    {
      let field = 0, fName = '毒沼', fIcon = '🟢', fColor = '#66cc44'
      for (const en of alive()) {
        const ph = currentPhase(en)
        const v = Math.max(en.mods?.poisonField || 0, ph?.poisonField || 0)
        if (v > field) {
          field = v
          fName = ph?.fieldName || en.mods?.fieldName || '毒沼'
          fIcon = ph?.fieldIcon || en.mods?.fieldIcon || '🟢'
          fColor = ph?.fieldColor || en.mods?.fieldColor || '#66cc44'
        }
      }
      if (field > 0) {
        const d = Math.floor(eff.hp_max * field * (1 - tr.pctResist))
        if (d > 0) {
          playerHp = Math.max(0, playerHp - d)
          logs.push({ text: `${fIcon} ${fName}のダメージ！ あなたに${d}ダメージ！`, color: fColor })
          if (playerHp <= 0) break
        }
      }
    }
    if (playerBuffs.bleed) {
      const d = Math.floor(playerHp * 0.01 * playerBuffs.bleed.stacks); playerHp = Math.max(0, playerHp - d)
      logs.push({ text: `🩸 出血ダメージ！ あなたに${d}ダメージ（${playerBuffs.bleed.stacks}スタック）！`, color: '#ff4466' })
      if (playerHp <= 0) break
      playerBuffs.bleed.lastTurn = (playerBuffs.bleed.lastTurn || 0) + 1
      if (playerBuffs.bleed.lastTurn >= 3) delete playerBuffs.bleed
    }
    const isHealSealed = playerBuffs.healSeal?.turns > 0
    if (isHealSealed) logs.push({ text: `🚫 回復封じ中！ 回復効果が無効化された！`, color: '#ff4488' })
    if (!isHealSealed && playerBuffs.regenHeal?.turns > 0) {
      const h = Math.floor(playerBuffs.regenHeal.amount * passiveHealMult * (playerBuffs.healUp?.turns > 0 ? playerBuffs.healUp.rate : 1) * healOutMult())
      playerHp = Math.min(eff.hp_max, playerHp + h)
      logs.push({ text: `💚 回復効果でHPが${h}回復した！`, color: '#44ff88' })
    }
    if (!isHealSealed && playerBuffs.delayHeal && turn === playerBuffs.delayHeal.triggerTurn) {
      const dHeal = Math.floor(playerBuffs.delayHeal.amount * healOutMult())
      playerHp = Math.min(eff.hp_max, playerHp + dHeal)
      // 出所（装備）は書かない。HPは動くので回復した事象だけ残す
      logs.push({ text: `💚 HPが${dHeal}回復した！`, color: '#44ff88' })
    }
    // アイテムの自動使用（Game.jsx の出撃と同じ条件）
    if (!isHealSealed && currentItem?.items) {
      const threshold = currentItem.use_threshold || 50
      const effect = currentItem.items.effect
      const isInfinite = effect === 'hp_pct_infinite' || effect === 'mp_pct_infinite'
      const onCooldown = (playerBuffs.potionCooldown?.turns || 0) > 0
      // 無限ポーションはエリアボス挑戦の間だけ回数上限がある（道中を含めて数える）
      const potionLeft = potionLimit - potionCount
      const canUse = isInfinite ? (!onCooldown && potionLeft > 0) : !itemUsed
      // 上限に達したことを1度だけ知らせる
      if (isInfinite && !onCooldown && potionLeft <= 0 && !playerBuffs.potionLimitNoticed) {
        const low = (effect === 'hp_pct_infinite' && playerHp / eff.hp_max * 100 <= threshold)
          || (effect === 'mp_pct_infinite' && playerMp / eff.mp_max * 100 <= threshold)
        if (low) {
          playerBuffs.potionLimitNoticed = true
          logs.push({ text: `🚫 ${currentItem.items.name}はこの挑戦ではもう使えない（${potionLimit}回まで）`, color: '#ff8844' })
        }
      }
      const usedInfinite = () => {
        potionCount++
        playerBuffs.potionCooldown = { turns: 5 }
        const left = potionLimit - potionCount
        logs.push({
          text: `⏳ 5ターンのクールダウンが入った！${Number.isFinite(potionLimit) ? `（残り${Math.max(0, left)}回）` : ''}`,
          color: '#aaaaaa',
        })
      }
      if (canUse) {
        if ((effect === 'hp_pct' || effect === 'hp_pct_infinite') && playerHp / eff.hp_max * 100 <= threshold) {
          // ポーションも長期戦の回復阻害を通す。ここを素通りさせると持久型がここだけで粘れる。
          // ⚠回復量が0になったら使わせない。使わせると無限ポーションの残り回数と
          //   アイテムの在庫だけが減って、HPは1も戻らない
          const healAmt = Math.floor(eff.hp_max * currentItem.items.value / 100 * healOutMult())
          if (healAmt > 0) {
            playerHp = Math.min(eff.hp_max, playerHp + healAmt)
            logs.push({ text: `🧪 ${currentItem.items.name}を使用！ HPが${healAmt}回復した！`, color: '#44ff88' })
            if (isInfinite) usedInfinite()
            else { itemUsed = true; currentItem = null }
          }
        } else if ((effect === 'mp_pct' || effect === 'mp_pct_infinite') && playerMp / eff.mp_max * 100 <= threshold) {
          const healAmt = Math.floor(eff.mp_max * currentItem.items.value / 100)
          playerMp = Math.min(eff.mp_max, playerMp + healAmt)
          logs.push({ text: `🧪 ${currentItem.items.name}を使用！ MPが${healAmt}回復した！`, color: '#4488ff' })
          if (isInfinite) usedInfinite()
          else { itemUsed = true; currentItem = null }
        }
      }
    }

    // ── プレイヤーの行動 ──
    let playerSkipped = false
    if (playerBuffs.stun?.turns > 0) {
      logs.push({ text: `スタン！ あなたは行動できない！`, color: '#ffaa00' })
      playerSkipped = true; delete playerBuffs.stun
    } else if (playerBuffs.paralysis?.turns > 0 && Math.random() < playerBuffs.paralysis.skipRate) {
      logs.push({ text: `麻痺で行動不能！`, color: '#ffaa00' })
      playerSkipped = true; playerBuffs.paralysis.skipRate *= 0.5
    }
    if (!playerSkipped) {
      doPlayerAttack(false)
      if (alive().length === 0) break
      const front = pickTarget()
      const playerExtraRate = front ? calcExtraActionRate(playerSpdNow(), enemyStats(front).spd) : 0
      const spiritExtra = !!playerBuffs.guaranteedExtra
      if (playerBuffs.guaranteedExtra) playerBuffs.guaranteedExtra = false
      if (spiritExtra || (playerExtraRate > 0 && Math.random() * 100 < playerExtraRate)) {
        logs.push({ text: '⚡ 追加行動！', color: '#ffdd44' })
        doPlayerAttack(true)
        if (alive().length === 0) break
      }
    }

    // ── 敵のターン（生きている全員が行動する） ──
    for (const en of enemies.slice()) {
      if (en.hp <= 0 || playerHp <= 0) continue
      if (en.buffs.stun?.turns > 0) {
        logs.push({ text: `${en.name}はスタンして行動できない！`, color: '#ffaa00' })
        delete en.buffs.stun
        continue
      }
      if (en.buffs.paralysis?.turns > 0 && Math.random() < en.buffs.paralysis.skipRate) {
        logs.push({ text: `${en.name}は麻痺で行動不能！`, color: '#ffaa00' })
        en.buffs.paralysis.skipRate *= 0.5
        continue
      }
      doEnemyTurn(en)
    }
    if (playerHp <= 0) break

    // ── 敵の出血 ──
    for (const en of alive()) {
      if (!en.buffs.bleed) continue
      const d = Math.floor(en.hp * 0.01 * en.buffs.bleed.stacks * emblemDotMult(eff, 'bleed')); en.hp -= d
      logs.push({ text: `🩸 出血ダメージ！ ${en.name}に${d}ダメージ（${en.buffs.bleed.stacks}スタック）！`, color: '#ff4466' })
      en.buffs.bleed.lastTurn = (en.buffs.bleed.lastTurn || 0) + 1
      if (en.buffs.bleed.lastTurn >= 3) delete en.buffs.bleed
      if (en.hp <= 0) onEnemyDown(en)
    }
    if (alive().length === 0) break

    // ── バフ/デバフのターン経過 ──
    const berserkWasActive = playerBuffs.berserk?.turns > 0
    Object.keys(playerBuffs).forEach(k => { if (playerBuffs[k]?.turns > 0) playerBuffs[k].turns-- })
    for (const en of enemies) Object.keys(en.buffs).forEach(k => { if (en.buffs[k]?.turns > 0) en.buffs[k].turns-- })
    summonEndOfTurn(summon)
    if (berserkWasActive && playerBuffs.berserk?.turns === 0 && expandedSkillSet.length > 0) {
      const lockedIdx = expandedSkillSet.findIndex(ss => ss.skills?.name === playerBuffs.berserk.lockedSkill)
      if (lockedIdx >= 0) skillIndex = lockedIdx + 1
    }
    if (playerBuffs.spellBladeExhaust?.turns === 0) {
      const sealT = playerBuffs.spellBladeExhaust.sealTurns || 4
      delete playerBuffs.spellBladeExhaust
      playerBuffs.spellBladeSealed = { turns: sealT }
      logs.push({ text: `⚔ 魔剣開放の反動！ ${sealT}ターンの間バフ不可状態になった！`, color: '#ff4444' })
    }
    if (playerBuffs.allinActive?.turns === 0) {
      const reactT = playerBuffs.allinActive.reactTurns || 2
      delete playerBuffs.allinActive
      delete playerBuffs.atkUp; delete playerBuffs.matkUp; delete playerBuffs.spdUp; delete playerBuffs.dmgReduce
      playerBuffs.allinDebuff = { turns: reactT, rate: 0.7 }
      logs.push({ text: `💸 オールインの効果が切れた！ ${reactT}ターンの間全ステータスが低下し、バフが使えない！`, color: '#ff4444' })
    }
    Object.keys(playerBuffs).forEach(k => { if (playerBuffs[k]?.turns === 0) delete playerBuffs[k] })
    for (const en of enemies) Object.keys(en.buffs).forEach(k => { if (en.buffs[k]?.turns === 0) delete en.buffs[k] })

    if (ondmgSpdUp > 1 && playerHp < hpBeforeTurn && !(playerBuffs.spdUp?.turns > 0 && playerBuffs.spdUp.rate >= ondmgSpdUp)) {
      playerBuffs.spdUp = { turns: 2, rate: ondmgSpdUp }
    }
    // シールドの付与は残すが、どの装備のおかげかは書かないので獲得ログは出さない
    if (hasAmagoiShield && turn % 5 === 0 && playerHp > 0 && !(playerBuffs.ailmentShield?.charges > 0)) {
      playerBuffs.ailmentShield = { charges: 1 }
    }

    turn++
  }

  // 相打ち（最後の一撃と同時に屈折の反射などで倒れる）は勝ちにしない。
  // 勝ち扱いにすると残HP0で連戦を続けられてしまう。
  const win = alive().length === 0 && playerHp > 0
  const turns = Math.min(turn, turnCap)

  // エンドポイント「戦闘ごとにHP回復」：1戦終えるごとに最大HPの一定割合を回復する。
  // 連戦のHP持ち越しを戻すためのものなので、勝った戦闘の終わりに1回だけ乗せる。
  if (win && tr.killHeal > 0 && playerHp > 0) {
    const heal = Math.floor(eff.hp_max * tr.killHeal)
    if (heal > 0) {
      playerHp = Math.min(eff.hp_max, playerHp + heal)
      logs.push({ text: `💚 タワーの加護！ 戦闘を終えてHPが${heal}回復した！`, color: '#66ffaa' })
    }
  }
  logs.push(win
    ? { text: `${turns}ターンで勝利した！`, color: '#44ff88' }
    : {
      text: playerHp <= 0
        ? (alive().length === 0 ? `相打ち… こちらも力尽きた。` : `敗北… また挑もう。`)
        : `決着がつかなかった…（${turnCap}ターン）`,
      color: '#ff4444',
    })

  return {
    logs, win, turns,
    hp: Math.max(0, playerHp), mp: Math.max(0, playerMp),
    hpMax: eff.hp_max, mpMax: eff.mp_max,
    itemUsed,     // 使い切りアイテムを消費した＝呼び出し側でDBの数量を減らす
    potionUsed: potionCount,   // 無限ポーションの累計使用回数（連戦の次の戦へ持ち越す）
    gold: win ? enemies.reduce((s, e) => s + (e.isSummoned ? 0 : (e.gold || 0)), 0) : 0,
  }
}
