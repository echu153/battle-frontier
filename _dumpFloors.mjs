// 層のデータをそのまま書き出す（提示用・データ側を正として転記ミスを防ぐ）
import { TOWER_FLOORS, getFloor, floorPowerOf, ENEMY_ATK_POWER, MOB_ATK_POWER, ENEMY_DMG_TAKEN, MOB_DMG_TAKEN, ENEMY_SKILL_POWER, BOSS_RUN_STAGES, towerTarget, sortiesToMidBoss, MID_BOSS_RATE, enemyTotal } from './src/lib/tower.js'

const from = Number(process.argv[2] || 6), to = Number(process.argv[3] || 10)
const n = (v) => Number(v || 0).toLocaleString()

// 実戦で使われる値（つまみと層ごとの係数を掛けたあと）
const realAtk = (v, isBoss, fp) => Math.floor((v || 0) * (isBoss ? ENEMY_ATK_POWER : MOB_ATK_POWER) * fp)

const skillLine = (s, fp) => {
  const bits = []
  const t = { physical: '物理', magical: '特殊', physical_multi: '物理連撃', buff: '強化', debuff: '弱体' }[s.type] || s.type
  if (s.mult != null && s.type !== 'buff' && s.type !== 'debuff') {
    bits.push(`${t} ×${s.mult}${s.hits ? ` を${s.hits}回` : ''}（実効 ×${(s.mult * ENEMY_SKILL_POWER * fp).toFixed(2)}）`)
  } else bits.push(t)
  if (s.effect === 'defDown') bits.push(`防御×${s.rate}(${s.turns}T)`)
  if (s.effect === 'mdefDown') bits.push(`特防×${s.rate}(${s.turns}T)${s.stack ? `・最大${s.stack}重` : ''}`)
  if (s.effect === 'atkDown') bits.push(`攻撃×${s.rate}(${s.turns}T)`)
  if (s.effect === 'defMdefUp') bits.push(`自分の防御×${s.defRate}・特防×${s.mdefRate}(${s.turns}T)`)
  if (s.effect === 'spdUp') bits.push(`自分の素早さ×${s.rate}(${s.turns}T)`)
  if (s.stunRate) bits.push(`${s.stunRate * 100}%でスタン`)
  if (s.burnRate) bits.push(`${s.burnRate * 100}%でやけど`)
  if (s.curseRate) bits.push(`${s.curseRate * 100}%で呪い`)
  if (s.poisonRate) bits.push(`${s.poisonRate * 100}%で毒`)
  if (s.paralysisRate) bits.push(`${s.paralysisRate * 100}%で麻痺`)
  if (s.bleedRate) bits.push(`${s.bleedRate * 100}%で出血`)
  if (s.extraActionRate) bits.push(`${s.extraActionRate * 100}%で追加行動`)
  if (s.healSealTurns) bits.push(`回復封じ${s.healSealTurns}T`)
  if (s.spdDownRate) bits.push(`素早さ×${s.spdDownRate}(${s.turns || '?'}T)`)
  if (s.defPen) bits.push(`防御貫通${s.defPen * 100}%`)
  if (s.chance != null && s.chance < 1) bits.push(`発動${s.chance * 100}%`)
  if (s.mustHit) bits.push('必中')
  const rest = Object.keys(s).filter(k => !['name', 'type', 'mult', 'hits', 'effect', 'rate', 'turns', 'stack', 'stunRate', 'burnRate', 'curseRate', 'poisonRate', 'paralysisRate', 'bleedRate', 'extraActionRate', 'healSealTurns', 'spdDownRate', 'defPen', 'chance', 'mustHit', 'defRate', 'mdefRate'].includes(k))
  if (rest.length) bits.push('他:' + rest.map(k => `${k}=${JSON.stringify(s[k])}`).join(' '))
  return `${s.name}｜${bits.join('・')}`
}

const modLine = (m = {}) => {
  const out = []
  if (m.physTakenMult != null) out.push(`物理被ダメ×${m.physTakenMult}`)
  if (m.magTakenMult != null) out.push(`特殊被ダメ×${m.magTakenMult}`)
  if (m.adapt) out.push('適応（直前と同じスキルの2発目を無効化）')
  if (m.reflect) out.push(`屈折（与ダメの${m.reflect * 100}%を反射${m.reflectCap ? `・1発上限=こちらの最大HP${m.reflectCap * 100}%` : ''}）`)
  if (m.curseRate) out.push(`被弾時${m.curseRate * 100}%で呪い${m.curseTurns ? `(${m.curseTurns}T)` : ''}`)
  if (m.burnRate) out.push(`被弾時${m.burnRate * 100}%でやけど`)
  if (m.poisonPct) out.push(`毎ターン最大HP${m.poisonPct * 100}%`)
  if (m.lifesteal) out.push(`吸血${m.lifesteal * 100}%`)
  if (m.critVsBurn) out.push(`やけど中の相手へクリ率+${m.critVsBurn}%`)
  if (m.evasion === 0) out.push('回避0')
  if (m.erupt) out.push(`噴火（${m.erupt.everyTurns}ターンごと・必中・防御${m.erupt.defPen * 100}%無視・×${m.erupt.mult}${m.erupt.burn ? '・やけど確定' : ''}）`)
  const rest = Object.keys(m).filter(k => !['physTakenMult', 'magTakenMult', 'adapt', 'reflect', 'reflectCap', 'curseRate', 'curseTurns', 'burnRate', 'poisonPct', 'lifesteal', 'critVsBurn', 'evasion', 'erupt'].includes(k))
  if (rest.length) out.push(rest.map(k => `${k}=${JSON.stringify(m[k])}`).join(' '))
  return out.length ? out.join(' / ') : 'なし'
}

for (let f = from; f <= to; f++) {
  const fd = getFloor(f); if (!fd) continue
  const fp = floorPowerOf(f)
  console.log('\n' + '='.repeat(100))
  console.log(`【${f}層】 ${fd.boss}　　層ごとの係数 ×${fp}（攻撃力・特殊攻撃力・技の威力に掛かる）`)
  console.log(`内部推奨戦闘力 ${n(towerTarget(f))}　／　エリアボス解放まで出撃 ${sortiesToMidBoss(f)}回（以降 ${MID_BOSS_RATE * 100}%で強敵）`)
  console.log('='.repeat(100))

  const rows = []
  fd.enemies.forEach((e, i) => rows.push({ 役: `雑魚${i + 1}`, e, boss: false }))
  rows.push({ 役: '強敵', e: fd.midBoss, boss: true })
  rows.push({ 役: 'エリアボス', e: fd.floorBoss, boss: true })

  console.log('\n■ 敵ステータス（カッコ内＝実戦で使われる値）')
  console.log('役         名前                    HP        攻撃              防御     特攻              特防     素早さ  被ダメ 総合力')
  for (const r of rows) {
    const e = r.e
    const atk = realAtk(e.atk, r.boss, fp), matk = realAtk(e.matk, r.boss, fp)
    console.log(
      `${r.役.padEnd(10)} ${e.name.padEnd(22)} ${n(e.hp).padStart(9)} ` +
      `${(n(e.atk) + `(${n(atk)})`).padStart(17)} ${n(e.def).padStart(8)} ` +
      `${(n(e.matk) + `(${n(matk)})`).padStart(17)} ${n(e.mdef).padStart(8)} ${n(e.spd).padStart(7)} ` +
      `${(r.boss ? ENEMY_DMG_TAKEN : MOB_DMG_TAKEN).toFixed(1).padStart(5)} ${n(enemyTotal(e)).padStart(7)}`
    )
  }

  console.log('\n■ スキル（実効＝技の威力つまみ1.5 × 層の係数を掛けたあとの倍率）')
  for (const r of rows) {
    const e = r.e
    console.log(`  ▸ ${r.役}／${e.name}`)
    for (const s of (e.skills || [])) console.log(`      ${skillLine(s, fp)}`)
    if (e.mods && Object.keys(e.mods).length) console.log(`      〔常時〕${modLine(e.mods)}`)
  }

  const b = fd.floorBoss
  console.log('\n■ エリアボスのギミック')
  console.log(`  常時       : ${modLine(b.mods)}`)
  if (b.specialMove) console.log(`  大技       : ${skillLine(b.specialMove, fp)}${b.specialMove.everyTurns ? `（${b.specialMove.everyTurns}ターンごと）` : ''}`)
  if (b.phases) console.log(`  段階変化   : ${JSON.stringify(b.phases)}`)
  if (b.summon) console.log(`  召喚       : ${JSON.stringify(b.summon)}`)
  if (b.summonLoop) console.log(`  召喚(反復) : ${JSON.stringify(b.summonLoop)}`)
  if (b.summonMid) console.log(`  召喚(中盤) : ${JSON.stringify(b.summonMid)}`)
  if (b.empower) console.log(`  自己強化   : ${JSON.stringify(b.empower)}`)
  if (b.cleanse) console.log(`  デバフ解除 : ${JSON.stringify(b.cleanse)}`)
  if (b.selfHeal) console.log(`  自己回復   : ${JSON.stringify(b.selfHeal)}`)
  if (b.escorts) console.log(`  開幕の護衛 : ${JSON.stringify(b.escorts)}`)
  const m = fd.midBoss
  const extras = ['specialMove', 'phases', 'summon', 'summonLoop', 'summonMid', 'empower', 'cleanse', 'selfHeal'].filter(k => m[k])
  if (extras.length) console.log(`  ※強敵側   : ${extras.map(k => `${k}=${JSON.stringify(m[k])}`).join(' / ')}`)
}
console.log(`\n連戦の構成: ${BOSS_RUN_STAGES.map((s, i) => `${i + 1}戦目=${s.kind === 'mid' ? '強敵' : s.kind === 'boss' ? 'エリアボス' : `雑魚${s.count}体`}`).join(' → ')}`)
