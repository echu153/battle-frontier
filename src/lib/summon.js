// 召喚系パッシブの共通ロジック（全戦闘エンジンで使用）
//  ・式神召喚（式神使い）：毎ターン、特殊攻撃力×0.5(再修練1で0.8)の式神ダメージ。エンティティ無し
//  ・ペット召喚（ブリーダー）：選択ペットをステ×2・HP×5で召喚。毎ターン×1.0自動攻撃／敵は50%でペットを狙う／
//    撃破後はプレイヤーのみ対象／再修練1で種族別の攻撃時追加効果（出血/素早さ低下/スタン）
//  ※出撃(Game.jsx)の実装を忠実に共通化したもの。敵HPの適用は呼び出し側（レイド=totalDamage / 奈落・天穹=enemy.hp）。
import { petStats } from '../constants/pets'

// 召喚状態を構築。profile.class / passiveNames から判定
export function buildSummon(profile, passiveNames, activePet) {
  // 式神召喚は式神使い専用パッシブ。ペット召喚(ブリーダー)と同様にクラスで縛る。
  // （selectBattleSkillSets が全セットのパッシブをユニオンするため、旧クラスのセットに残った
  //   式神召喚が別クラス=ブリーダー等の戦闘に漏れて「式神の攻撃」が出る不具合を防ぐ）
  const hasShiki = profile?.class === '式神使い' && Array.isArray(passiveNames) && passiveNames.includes('式神召喚')
  let pet = null
  const ap = activePet || profile?.activePet
  if (profile?.class === 'ブリーダー' && Array.isArray(passiveNames) && passiveNames.includes('ペット召喚') && ap?.species) {
    const ps = petStats(ap)
    pet = {
      active: true, hp: ps.maxHp * 5, maxHp: ps.maxHp * 5,
      atk: ps.atk * 2, def: ps.def * 2, mdef: ps.mdef * 2,
      atkType: ps.atkType, species: ap.species,
      buffs: { reduce: 0, reduceTurns: 0 },
    }
  }
  return { pet, hasShiki }
}

export function summonAnnounce(s, logs) {
  if (s?.pet?.active) logs.push({ text: `🐾 ペットを召喚！（HP${s.pet.maxHp}）`, color: '#ffcc66' })
}

// ブリーダーのコマンドスキル名（アクティブ。executeSkillを通さず専用処理）
export const BREEDER_COMMANDS = new Set(['攻撃して！', '一緒に頑張ろう！', '休憩しよう！', 'やっちゃえ！'])

// ペットの1回攻撃（自動攻撃/コマンド共通）。敵へ与えたダメージを返す（0=回避/不発）
function petAttackOnce(pet, mult, label, enemy, enemyBuffs, playerBuffs, rtCur, logs) {
  const eb = enemyBuffs || {}
  const baseEv = Math.max(0, enemy.evasionRate || 0)
  if (baseEv > 0 && Math.random() * 100 < baseEv) {
    logs.push({ text: `🐾 ペットの${label}！ しかし${enemy.name}に回避された！`, color: '#446688' })
    return 0
  }
  const isSpec = pet.atkType === 'spec'
  const edr = (eb.defDown?.rate || 1) * (eb.defUp?.rate || 1)
  const emr = (eb.mdefDown?.rate || 1) * (eb.mdefUp?.rate || 1)
  const adjDef = Math.max(1, Math.floor(isSpec ? (enemy.mdef || 0) * emr : (enemy.def || 0) * edr))
  const base = pet.atk * mult
  const dmgUp = playerBuffs?.breederDmgUp?.turns > 0 ? playerBuffs.breederDmgUp.rate : 1.0
  const d = Math.max(1, Math.floor(base * (base / (base + adjDef)) * dmgUp * (0.9 + Math.random() * 0.2)))
  let extra = ''
  if (rtCur >= 1) {
    if (pet.species === 'flame' && Math.random() * 100 < 30) { const b = eb.bleed; eb.bleed = { stacks: Math.min(5, (b?.stacks || 0) + 1), lastTurn: 0 }; extra = ` ${enemy.name}は出血した！` }
    else if (pet.species === 'aqua' && Math.random() * 100 < 40) { eb.spdDown = { turns: 3, rate: 0.7 }; extra = ' 素早さ低下！' }
    else if (pet.species === 'leaf') { const sr = eb.stunResist ?? 1.0; if (Math.random() * 100 < 30 * sr) { eb.stun = { turns: 1 }; eb.stunResist = sr * 0.5; extra = ' スタン！' } }
  }
  logs.push({ text: `🐾 ペットの${label}！ ${enemy.name}に${d}ダメージ！${extra}`, color: '#ffaa44' })
  return d
}

// ブリーダーのコマンドスキルを処理（executeSkillの前に呼ぶ）。
//  戻り値 { matched:このスキルがコマンドか, handled:処理したか, mpUsed, enemyDamage, playerHeal }
//  handled=false（ペット死亡/MP不足）のとき呼び出し側は通常攻撃へフォールバックする
export function tryPetCommand(skillName, summon, enemy, enemyBuffs, playerBuffs, rtCur, playerMp, mpCost, maxHp, logs, prefix) {
  if (!BREEDER_COMMANDS.has(skillName)) return { matched: false }
  const pet = summon?.pet
  const petAlive = !!(pet?.active && pet.hp > 0)
  if (!petAlive) {
    logs.push({ text: `${prefix}${skillName}！ しかしペットがいない…通常攻撃になった！`, color: '#888888' })
    return { matched: true, handled: false }
  }
  if (playerMp < mpCost) return { matched: true, handled: false, mpLack: true }
  let enemyDamage = 0, playerHeal = 0
  if (skillName === '攻撃して！') enemyDamage = petAttackOnce(pet, rtCur >= 2 ? 3.5 : 3.0, '攻撃して！', enemy, enemyBuffs, playerBuffs, rtCur, logs)
  else if (skillName === 'やっちゃえ！') enemyDamage = petAttackOnce(pet, rtCur >= 5 ? 6.0 : 5.0, 'やっちゃえ！', enemy, enemyBuffs, playerBuffs, rtCur, logs)
  else if (skillName === '一緒に頑張ろう！') { const t = rtCur >= 3 ? 6 : 3; playerBuffs.breederDmgUp = { turns: t, rate: 1.5 }; logs.push({ text: `${prefix}一緒に頑張ろう！ ${t}ターンの間、自分とペットの与ダメージ+50%！`, color: '#ffcc66' }) }
  else if (skillName === '休憩しよう！') {
    playerHeal = Math.floor(maxHp * 0.2)
    const pph = Math.floor(pet.maxHp * 0.2); pet.hp = Math.min(pet.maxHp, pet.hp + pph)
    let cutTxt = ''
    if (rtCur >= 4) { playerBuffs.dmgReduce = { turns: 1, rate: 0.7 }; pet.buffs.reduce = 0.3; pet.buffs.reduceTurns = 1; cutTxt = ' 1ターン被ダメ30%カット！' }
    logs.push({ text: `${prefix}休憩しよう！ 自分のHP+${playerHeal}・ペットのHP+${pph}！${cutTxt}`, color: '#66ddaa' })
  }
  return { matched: true, handled: true, mpUsed: mpCost, enemyDamage, playerHeal }
}

// ターン開始時の召喚攻撃（式神＋ペット自動攻撃）。敵へ与える合計ダメージを返す（呼び出し側が敵HP/totalDamageへ反映）
//  enemy: { def, mdef, atk, matk, type('magical'で特殊), name, evasionRate(0-100) }
//  enemyBuffs: 敵の被デバフ（species効果の書き込み先。無いエンジンは {} を渡す）
//  playerBuffs: breederDmgUp を参照（無ければ 1.0）
export function summonAttackDamage(s, enemy, enemyBuffs, playerBuffs, eff, rtCur, logs) {
  let dealt = 0
  const eb = enemyBuffs || {}
  // 式神召喚
  if (s?.hasShiki) {
    const shikiMult = rtCur >= 1 ? 0.8 : 0.5
    const eMdefR = (eb.mdefDown?.rate || 1) * (eb.mdefUp?.rate || 1)
    const adjEMD = Math.max(1, Math.floor((enemy.mdef || 0) * eMdefR))
    const matk = eff?.matk || 0
    const d = Math.max(1, Math.floor(matk * shikiMult * (matk / (matk + adjEMD)) * (0.9 + Math.random() * 0.2)))
    dealt += d
    logs.push({ text: `👹 式神の攻撃！ ${enemy.name}に${d}の特殊ダメージ！`, color: '#cc88ff' })
  }
  // ペット召喚 自動攻撃（×1.0）
  const pet = s?.pet
  if (pet?.active && pet.hp > 0) {
    dealt += petAttackOnce(pet, 1.0, 'こうげき', enemy, eb, playerBuffs, rtCur, logs)
  }
  return dealt
}

// 敵の通常攻撃を50%でペットが受ける。受けたら true（呼び出し側はプレイヤーへのダメージを飛ばす）
//  enemy: { atk, matk, type }, enemyBuffs: { atkUp, matkUp }
export function summonAbsorbBasic(s, enemy, enemyBuffs, turn, logs) {
  const pet = s?.pet
  if (!(pet?.active && pet.hp > 0) || Math.random() >= 0.5) return false
  const eb = enemyBuffs || {}
  const isEM = enemy.type === 'magical'
  const eAtk = isEM ? (enemy.matk || 0) * (eb.matkUp?.rate || 1) : (enemy.atk || 0) * (eb.atkUp?.rate || 1)
  const petDefVal = Math.max(1, isEM ? pet.mdef : pet.def)
  const baseDmg = Math.max(1, Math.floor(eAtk * eAtk / Math.max(1, eAtk + petDefVal)))
  const cut = pet.buffs.reduceTurns > 0 ? (1 - pet.buffs.reduce) : 1.0
  const dmg = Math.max(1, Math.floor(baseDmg * cut * (0.9 + Math.random() * 0.2)))
  pet.hp = Math.max(0, pet.hp - dmg)
  logs.push({ text: `${enemy.name || '敵'}はペットを攻撃！ ペットに${dmg}ダメージ！（残りHP${pet.hp}）`, color: '#ff8844' })
  if (pet.hp <= 0) logs.push({ text: `💥 ペットは倒れてしまった…`, color: '#ff4444' })
  return true
}

// 敵スキル等のダメージを50%でペットが受ける（既算出dmgをそのまま・cutのみ適用）。受けたら true
export function summonAbsorbSkill(s, dmg, logs) {
  const pet = s?.pet
  if (!(pet?.active && pet.hp > 0) || dmg <= 0 || Math.random() >= 0.5) return false
  const cut = pet.buffs.reduceTurns > 0 ? (1 - pet.buffs.reduce) : 1.0
  const d = Math.max(1, Math.floor(dmg * cut))
  pet.hp = Math.max(0, pet.hp - d)
  logs.push({ text: `↳ 攻撃はペットに！ ペットに${d}ダメージ！（残りHP${pet.hp}）`, color: '#ff8844' })
  if (pet.hp <= 0) logs.push({ text: `💥 ペットは倒れてしまった…`, color: '#ff4444' })
  return true
}

export function summonEndOfTurn(s) {
  if (s?.pet?.buffs?.reduceTurns > 0) s.pet.buffs.reduceTurns--
}
