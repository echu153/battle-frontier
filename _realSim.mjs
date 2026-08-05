// ============================================================
// 実データ（_sim_data.json）でエンドレスタワーを測る
// ------------------------------------------------------------
// ・スキルとクラスの対応、装備、紋章、ペット、チャーム、称号、エンドポイントを実物で使う
// ・ステ配分はクラスの型に合わせて振り直す（物理職=攻撃寄り／魔法職=特攻寄り）。
//   おれおれおの素の配分は攻撃に偏っていて、魔法職が不当に弱く出るため。
// 使い方: node _realSim_b.mjs [開始層] [終了層] [試行回数]
// ============================================================
import fs from 'node:fs'
import { calcEffectiveStats, calcEffectiveTotal } from './src/lib/stats.js'
import { petPlayerBonus, charmPlayerBonus } from './src/constants/pets.js'
import { runBossRun, ADVANCED_CLASSES } from './src/lib/towerSim.js'
import { PHYSICAL_CLASSES, MAGICAL_CLASSES } from './src/lib/aiAssistant.js'

const data = JSON.parse(fs.readFileSync('_sim_data.json', 'utf8'))
const D = data.sim_data || data          // SQLエディタの列名ごとコピーされていても拾う

const baseProfile = D.profile
const equipment = D.equipment || []
const proficiency = D.proficiency || []
const title = D.title || null
// エンドポイント。実データは未振りだが、第5引数に 'alloc' を渡すと
// エンドLV28ぶん（28点・1ノード10段まで）を振った想定でも測れる。
const ALLOC_ON = process.argv[5] === 'alloc'
const treeOf = (kind) => ALLOC_ON
  ? { max_hp: 10, dmg_taken: 10, [kind === 'mag' ? 'mag_dmg' : 'phys_dmg']: 8 }
  : (D.tower_player?.tree_alloc || {})
const tree = D.tower_player?.tree_alloc || {}

// ペット・チャーム・紋章を profile に載せる（街と同じ組み立て）
const byId = {}
for (const c of (D.charms || [])) byId[c.id] = c
const profileBase = {
  ...baseProfile,
  emblemAlloc: D.emblem || null,
  petStat: D.pet ? petPlayerBonus(D.pet) : null,
  petCharm: D.pet ? charmPlayerBonus(byId[D.pet.charm_id] || null, byId[D.pet.ribbon_id] || null) : null,
  activePet: D.pet || null,
}

// ============================================================
// クラスの型に合わせて「同じ総合力のまま」組み替える。
//  おれおれおの実物は 振りステ・紋章・武器・熟練度 のすべてが物理に寄っていて、
//  そのまま魔法職を回すと攻撃力が3割しか出ず、測定として意味を成さない。
//  ・振りステ  … 攻＋特攻の合計は動かさず、比率だけ 9:1 / 1:9 / 5:5 に振り直す
//  ・紋章      … 力/物理/物理吸収 ⇔ 知恵/特殊/特殊吸収 を入れ替える（振り数は同じ）
//  ・武器      … 同じ数値のまま種別だけ 短剣→杖 にし、宝石とスロット値も特攻へ移す
//                （手持ちに同格の魔法武器が無いため、性能を鏡写しにして総合力を揃える）
// ============================================================
const kindOf = (cls) => PHYSICAL_CLASSES.includes(cls) ? 'phys' : MAGICAL_CLASSES.includes(cls) ? 'mag' : 'hybrid'
const KIND_LABEL = { phys: '物理', mag: '魔法', hybrid: '混合' }
const RATIO = { phys: 0.9, mag: 0.1, hybrid: 0.5 }   // 攻撃に回す割合

const mirrorEmblem = (alloc, kind) => {
  if (kind === 'phys' || !alloc) return alloc
  const a = { ...alloc }
  const move = (from, to, pct) => {
    const v = a[from] || 0; if (!v) return
    delete a[from]
    a[to] = (a[to] || 0) + Math.round(v * pct)
    if (pct < 1) a[from] = v - Math.round(v * pct)
  }
  const p = kind === 'mag' ? 1 : 0.5           // 混合は半々
  move('chikara', 'chie', p)
  move('butsuri', 'tokushu', p)
  move('bkyuushuu', 'tkyuushuu', p)
  return a
}

// 魔法職だけ、装備中の武器を同性能の杖に置き換える（数値は一切増減させない）
const mirrorEquipment = (equip, kind) => {
  if (kind !== 'mag') return equip
  return equip.map(it => {
    if (it.slot !== 'weapon' || !it.equipped || !it.weapons) return it
    const w = it.weapons
    return {
      ...it,
      gem_type: it.gem_type === 'ruby' ? 'amethyst' : it.gem_type,
      bonus_atk: 0, bonus_matk: (it.bonus_matk || 0) + (it.bonus_atk || 0),
      weapons: { ...w, weapon_type: 'staff', atk_bonus: 0, matk_bonus: (w.matk_bonus || 0) + (w.atk_bonus || 0) },
    }
  })
}

// 第6引数に倍率を渡すと「今より何倍強いプレイヤーなら抜けられるか」を測れる。
// 上の層はおれおれおでは全滅して見分けがつかないので、階段になっているかの確認に使う。
const GROW = Number(process.argv[6] || 1)

function reallocate(prof, kind) {
  const g = (v) => Math.round((v || 0) * GROW)
  prof = { ...prof, hp_max: g(prof.hp_max), mp_max: g(prof.mp_max), def: g(prof.def), mdef: g(prof.mdef), spd: g(prof.spd), atk: g(prof.atk), matk: g(prof.matk) }
  const keep = { hp_max: prof.hp_max, mp_max: prof.mp_max, def: prof.def, mdef: prof.mdef, spd: prof.spd }
  const offense = (prof.atk || 0) + (prof.matk || 0)
  const r = RATIO[kind]
  return {
    ...prof, ...keep,
    atk: Math.round(offense * r), matk: Math.round(offense * (1 - r)),
    emblemAlloc: mirrorEmblem(prof.emblemAlloc, kind),
  }
}

const from = Number(process.argv[2] || 1)
const to = Number(process.argv[3] || 7)
const tries = Number(process.argv[4] || 20)
const floors = []; for (let i = from; i <= to; i++) floors.push(i)

// ------------------------------------------------------------
// クラスごとの「一番強い構成」を総当たりで選ぶ。
//  buildClassSets の「終盤に覚えるもの5つ」は機械的な選び方で、
//  賢者のディスペルのように攻撃しないスキルを掴んでしまい、
//  そのクラスが弱いのか構成が悪いのかが分からなくなる。
//  実プレイヤーは強い並びを選ぶので、こちらも選ばせる。
// ------------------------------------------------------------
const combos = (arr, k) => {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [h, ...t] = arr
  return [...combos(t, k - 1).map(c => [h, ...c]), ...combos(t, k)]
}
function candidateSets(allSkills, cls) {
  const mine = allSkills.filter(s => s.class_name === cls || s.class_name === '共通')
  const passive = mine.filter(s => s.type === 'パッシブ')
    .sort((a, b) => (b.required_lv || 0) - (a.required_lv || 0))[0]
  const actives = mine.filter(s => s.type !== 'パッシブ')
  const pick = Math.min(5, actives.length)
  return combos(actives, pick).map(sub => {
    const ordered = [...sub].sort((a, b) => (a.required_lv || 0) - (b.required_lv || 0))
    const set = passive ? [{ skills: passive, use_count: 1 }] : []
    for (const s of ordered) set.push({ skills: s, use_count: 1 })
    return set
  })
}
// 構成の選抜は「測る層すべての合計」で行う。
//  1つの層だけで選ぶと、その層が全滅する強さのときに全候補が0点で並び、
//  先頭の（多くは弱い）構成をそのまま掴んでしまう。下の層の成績で差がつくようにする。
const PROBE_FLOORS = floors
const PROBE_TRIES = 8

console.log(`■ おれおれおの実データで測定（各${tries}回・ステ配分はクラスの型に合わせて振り直し）`)
const base = calcEffectiveStats(profileBase, equipment, proficiency, title)
console.log(`  素のステ: HP${base.hp_max.toLocaleString()} 攻${base.atk.toLocaleString()} 特攻${base.matk.toLocaleString()} 防${base.def.toLocaleString()} 特防${base.mdef.toLocaleString()} 速${base.spd.toLocaleString()}`)
console.log(`  総合力: ${calcEffectiveTotal(profileBase, equipment, proficiency, title).toLocaleString()}`)
console.log(`  エンドポイント: ${JSON.stringify(tree)}`)
console.log()
console.log('クラス'.padEnd(16) + '型'.padEnd(4) + '攻/特攻'.padStart(13) + floors.map(f => (f + '層').padStart(6)).join(''))
console.log('-'.repeat(33 + floors.length * 6))

const summary = {}
const chosen = {}
for (const cls of ADVANCED_CLASSES) {
  const kind = kindOf(cls)
  const prof = reallocate({ ...profileBase, class: cls, retraining: { ...(profileBase.retraining || {}), [cls]: 5 } }, kind)
  const eq = mirrorEquipment(equipment, kind)
  const eff = calcEffectiveStats(prof, eq, proficiency, title)

  // 構成の総当たり選抜
  const cands = candidateSets(D.skills || [], cls)
  if (cands.length === 0) { console.log(cls.padEnd(16) + '  (スキル無し)'); continue }
  let skillSets = cands[0], bestScore = -1
  if (cands.length > 1) {
    for (const c of cands) {
      let ok = 0
      for (const f of PROBE_FLOORS) {
        for (let i = 0; i < PROBE_TRIES; i++) {
          if (runBossRun({ eff, equipment: eq, skillSets: c, profile: prof, floor: f, tree: treeOf(kind), targetMode: 'top', playerItem: null }).cleared) ok++
        }
      }
      if (ok > bestScore) { bestScore = ok; skillSets = c }
    }
  }
  chosen[cls] = skillSets.map(s => s.skills.name)
  const cells = []
  for (const floor of floors) {
    let ok = 0
    for (let i = 0; i < tries; i++) {
      if (runBossRun({ eff, equipment: eq, skillSets, profile: prof, floor, tree: treeOf(kind), targetMode: 'top', playerItem: null }).cleared) ok++
    }
    const rate = ok / tries
    summary[floor] = (summary[floor] || 0) + rate
    cells.push((Math.round(rate * 100) + '%').padStart(6))
  }
  const off = `${(eff.atk / 1000).toFixed(1)}k/${(eff.matk / 1000).toFixed(1)}k`
  console.log(cls.padEnd(16) + KIND_LABEL[kind].padEnd(4) + off.padStart(13) + cells.join(''))
}
console.log('-'.repeat(33 + floors.length * 6))
console.log('平均'.padEnd(16) + ''.padEnd(17) + floors.map(f => (Math.round(summary[f] / ADVANCED_CLASSES.length * 100) + '%').padStart(6)).join(''))
console.log()
console.log(`※スキル構成は組み合わせを総当たりし、全層の合計で一番抜けやすかったものを採用。`)
for (const cls of ADVANCED_CLASSES) {
  if (chosen[cls]) console.log(`  ${cls.padEnd(16)}${chosen[cls].join(' / ')}`)
}
