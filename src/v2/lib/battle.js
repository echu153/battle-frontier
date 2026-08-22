// ============================================================
// バトルフロンティアⅡ（リメイク版）— 戦闘ループ
// ------------------------------------------------------------
// スキルの回り方はあるけみすと準拠：
//   ・セットした枠を順に1巡し、それぞれの枠に設定した「使用回数」だけ使う（ABCDE→ABCDE…）
//   ・使用回数を使い切った枠・空の枠・MPが足りない枠は飛ばす
//   ・不発のときは MP も使用回数も減らず、**ポインタも進まない**（同じ枠を撃ち直す）
//     → 発動率の低い技を上に置くとそこで詰まる。並び順が戦術になる
//   ・不発のターンと、撃てる枠が無いときは通常攻撃（消費MP0）
//
// 行動順・追加行動・命中・クリティカル・ダメージは combat.js の関数をそのまま使う。
// ステータスの増減バフは**戦闘中ずっと続き、重ねがけで加算**される（あるけみすと準拠）。
// 状態異常は ailments.js、装備エンチャントの特殊能力は enchant.js が定義を持つ。
//
// ★純関数。rng を渡せば結果が再現する（テストとバランス検証のため）。
// ============================================================
import {
  resolveAttack, healOf, roll, goesFirst, rollExtraAction,
} from './combat.js'
import { STAT_KEYS, calcPower } from './stats.js'
import { skillsOf, isPassive, offClassMult, scaleTable, mpOf, mpPctOf } from './skills.js'
import { classBonusOf } from './classBonus.js'
import {
  createAilments, inflict, tickAilments, ailStatPct, healMultOf, consumeParalyze, hasAilment, AIL_LABEL,
} from './ailments.js'
import { collectEnchants, inflictChance } from './enchant.js'
import {
  collectEvolutions, evoDmgPct, evoCutPct, EVO_STACK_MAX,
  LOW_HP_PCT as EVO_LOW_HP, FOE_LOW_PCT,
} from './evolve.js'

export const NORMAL_ATTACK_MULT = 1.0 // 通常攻撃の倍率（消費MP0）
export const MAX_TURNS = 100          // これを超えたら引き分け

// 職業の攻撃型。攻撃スキルの種別から決める（通常攻撃がSTR参照かINT参照か）
export const attackKindOf = (cls) => {
  const atk = skillsOf(cls).filter(s => s.kind === 'phys' || s.kind === 'mag')
  return atk.some(s => s.kind === 'mag') && !atk.some(s => s.kind === 'phys') ? 'mag' : 'phys'
}

// ステータスの増減バフは**戦闘中ずっと続き、重ねがけで加算**される（あるけみすと準拠）。
//   あるけみすとのバフにはターン数の記載が無く、「重ね掛け可能」「回避成功毎に+3%」と
//   累積前提で書かれている（ターン数が明記されているのは麻痺1T・沈黙2Tなどのデバフ側）。
// 下限は -90%（デバフを重ねてもステータスが0以下にならないように）
export const BUFF_MIN_PCT = -90
const effectiveStats = (base, buffs) => {
  const out = {}
  for (const k of STAT_KEYS) {
    const pct = buffs[k] || 0
    out[k] = pct ? Math.max(0, Math.round((base[k] || 0) * (1 + pct / 100))) : (base[k] || 0)
  }
  return out
}

const applyBuff = (buffs, table) => {
  for (const [k, pct] of Object.entries(table || {})) {
    buffs[k] = Math.max(BUFF_MIN_PCT, (buffs[k] || 0) + pct)
  }
}

// ===== パッシブ =====
// セットしたパッシブを1つのまとめ（pa）に畳む。**パッシブは複数セットできる**ので、
// 数で書けるものは足し算、形のあるものは配列で持つ。
const collectPassives = (passives) => {
  const pa = {
    hitBonus: 0, evaBonus: 0, critBonus: 0, procBonus: 0, defPenBonus: 0, healBonus: 0,
    misfireAtkMult: 1, debuffGuard: 0,
    // ★2026-08-19 追加ぶん
    critDmg: 0,        // クリティカルのダメージ+%（隠身）
    mpCut: 0,          // 消費MP-%（天啓）
    defRed: 0,         // 受けるときの軽減率+%（聖騎士の心得）
    bleedMax: 0,       // 自分が付ける出血の上限スタック（隠身）
    hpSteps: [],       // [{ at, statPct }] HPが at% 以下で効く段（新しいバーサク）
    hitMult: null,     // { mult, lowMult, at } 命中率に掛ける（鷹ノ目）
    hitStack: null,    // { critRate, critDmg, max } 当てるたびに積む（精密照準）
    perAct: [],        // [{ stats, per, max }] 行動するたびに積む（第六感）
    statPct: {}, converts: [], rages: [], switches: [], lowHps: [],
    wall: null, gamble: null, dodgeCut: null,
  }
  for (const s of passives) {
    const p = s?.passive
    if (!p) continue
    for (const k of ['hitBonus', 'evaBonus', 'critBonus', 'procBonus', 'defPenBonus', 'healBonus', 'debuffGuard',
      'critDmg', 'mpCut', 'defRed']) {
      if (p[k]) pa[k] += p[k]
    }
    if (p.bleedMax) pa.bleedMax = Math.max(pa.bleedMax, p.bleedMax)
    if (p.hitMult)  pa.hitMult = p.hitMult
    if (p.hitStack) pa.hitStack = p.hitStack
    if (p.perAct)   pa.perAct.push(p.perAct)
    if (p.hpSteps)  pa.hpSteps.push(...p.hpSteps)
    if (p.misfireAtkMult) pa.misfireAtkMult = Math.max(pa.misfireAtkMult, p.misfireAtkMult)
    if (p.statPct) for (const [k, v] of Object.entries(p.statPct)) pa.statPct[k] = (pa.statPct[k] || 0) + v
    if (p.convert)    pa.converts.push(p.convert)
    if (p.rage)       pa.rages.push(p.rage)
    if (p.switchStat) pa.switches.push(p.switchStat)
    if (p.lowHp)      pa.lowHps.push(p.lowHp)
    if (p.wall)     pa.wall = p.wall
    if (p.gamble)   pa.gamble = p.gamble
    if (p.dodgeCut) pa.dodgeCut = p.dodgeCut
  }
  return pa
}

// いまのステータス。土台のバフに、状況で変わるパッシブぶんを足してから計算する。
//   acting=true … 自分の行動を解決している最中（元素共鳴のような「その行動だけ」の補正を含める）
export const liveStats = (side, acting = false) => {
  const b = { ...side.buffs }
  const add = (k, pct) => { b[k] = Math.max(BUFF_MIN_PCT, (b[k] || 0) + pct) }
  // 状態異常「鈍足」＝AGI-20%
  const ap = ailStatPct(side.ail)
  if (ap) for (const [k, pct] of Object.entries(ap)) add(k, pct)
  // エンチャント：当てるたびに積むスタック（極夜のワイト・熾火のデーモン）
  for (const [k, pct] of Object.entries(side.enStacks || {})) add(k, pct)
  // バーサク・執行本能：ダメージを与えるたびに乗るスタック
  if (side.rage > 0) for (const r of side.pa.rages) add(r.stat, Math.min(r.max, r.per * side.rage))
  // 期限つきバフ（狂心のSTR+70%＝4ターンで切れる）
  for (const t of side.timedBuffs || []) {
    if (t.turns > 0) for (const [k, v] of Object.entries(t.table || {})) add(k, v)
  }
  // 第六感：行動するたびにステータスが上がる（上限つき）
  for (const t of side.pa.perAct || []) {
    const up = Math.min(t.max, t.per * (side.acts || 0))
    if (up > 0) for (const st of t.stats) add(st, up)
  }
  // 新しいバーサク：HPの段階でステータスが上がる（重ならず、いちばん深い段だけが効く）
  if (side.pa.hpSteps?.length) {
    const hpPct = (side.hp / Math.max(1, side.base.hp)) * 100
    const hit = side.pa.hpSteps.filter(t => hpPct <= t.at).sort((x, y) => x.at - y.at)[0]
    if (hit) for (const [k, v] of Object.entries(hit.statPct || {})) add(k, v)
  }
  // 闘争本能：HPが減るほど上がる（at% まで下がると max% で頭打ち）
  for (const l of side.pa.lowHps) {
    const hpPct = (side.hp / Math.max(1, side.base.hp)) * 100
    const t = Math.min(1, Math.max(0, (100 - hpPct) / Math.max(1, 100 - l.at)))
    if (t > 0) add(l.stat, l.max * t)
  }
  // 元素共鳴：直前と違うスキルを使うときだけ（重複しない＝毎回同じ+10%）
  if (acting && side.switchOn) for (const s of side.pa.switches) add(s.stat, s.pct)
  // 武器の進化：かわすたびAGI＋／被弾するたびSTR＋（どちらも EVO_STACK_MAX 回まで）
  if (side.evo?.onDodge.agi && side.evoStacks?.dodge)
    add('agi', side.evo.onDodge.agi * Math.min(EVO_STACK_MAX, side.evoStacks.dodge))
  if (side.evo?.onHurt.str && side.evoStacks?.hurt)
    add('str', side.evo.onHurt.str * Math.min(EVO_STACK_MAX, side.evoStacks.hurt))
  const eff = effectiveStats(side.base, b)
  // 魔導剣術：INTの20%をSTRへ「変換」する。移した元は減る
  for (const c of side.pa.converts) {
    const moved = Math.round((eff[c.from] || 0) * (c.pct / 100))
    eff[c.from] = Math.max(0, (eff[c.from] || 0) - moved)
    eff[c.to] = (eff[c.to] || 0) + moved
  }
  // 雷鷲サンダーロック：AGIの5%をSTRへ「加算」する。★変換と違って元は減らない
  for (const c of side.en.convertAdds) {
    eff[c.to] = (eff[c.to] || 0) + Math.round((eff[c.from] || 0) * (c.pct / 100))
  }
  return eff
}

// 戦闘用の1サイドを作る。slots = [{ skill, uses }]（順番が発動順）
// ★パッシブは発動順のローテーションから外す。職業補正はスキルとは別枠で常時かかる
// fighter.enchants = 装備しているエンチャント（敵の名前の配列）。band は時間帯条件の判定に使う
export const createSide = (fighter, band = null) => {
  const stats = {}
  for (const k of STAT_KEYS) stats[k] = fighter.stats?.[k] ?? fighter[k] ?? 0
  const all = (fighter.slots || skillsOf(fighter.cls).map(s => ({ skill: s, uses: 3 })))
    .filter(s => s?.skill)
    .map(s => ({ skill: s.skill, uses: s.uses ?? 3 }))
  const passives = all.filter(s => isPassive(s.skill)).map(s => s.skill)
  const pa = collectPassives(passives)
  const bonus = classBonusOf(fighter.cls, fighter.jobCount)
  const en = collectEnchants(fighter.enchants, band)
  // 武器の進化（戦闘記憶）。刻印とは別枠で、装備している武器に付いているぶんが乗る
  const evo = collectEvolutions(fighter.evolutions)
  // ★ステータス%は**素の値**へ掛ける（バフ枠に入れると最大HP/MPが増えないため）
  for (const [k, p] of Object.entries(evo.stat)) {
    if (stats[k] !== undefined && p) stats[k] = Math.max(0, Math.round(stats[k] * (1 + p / 100)))
  }
  const buffs = {}
  if (bonus?.stats) applyBuff(buffs, bonus.stats)   // 職業補正（就いている職業だけ）
  applyBuff(buffs, pa.statPct)                      // パッシブの常時ステータス補正
  applyBuff(buffs, en.statPct)                      // エンチャントの常時ステータス補正（時間帯ぶんを含む）
  return {
    name: fighter.name || fighter.cls || '?',
    cls: fighter.cls,
    kind: fighter.kind || attackKindOf(fighter.cls),
    base: stats,
    // 戦闘力。「巨人殺し」が相手と比べるのに使う（ステータスから出すので敵にも要る）
    power: calcPower(stats),
    // ★startHp/startMp を渡すと、そこから始める（アリーナのチャンプは回復しないので使う）。
    //   最大値は base のままなので、回復もHPバーも正しく動く
    hp: Math.max(0, Math.min(stats.hp, fighter.startHp ?? stats.hp)),
    mp: Math.max(0, Math.min(stats.mp, fighter.startMp ?? stats.mp)),
    slots: all.filter(s => !isPassive(s.skill)),  // 発動順に回るのはパッシブ以外だけ
    passives,
    pa,
    healMult: bonus?.healMult ?? 1,   // 異端審問官は自身の回復量0.8倍
    ptr: 0,
    buffs,          // 自分にかかっているバフ（職業補正とパッシブぶんを最初から乗せておく）
    regen: null,    // { rate, turns }
    mpRegen: null,  // { rate, turns }
    rage: 0,        // バーサク・執行本能のスタック数
    acts: 0,        // 自分が行動した回数（骸の壁が5回ごとに見る・第六感が積み上げに使う）
    hitStacks: 0,   // 精密照準：当てるたびに積む（上限は passive.hitStack.max）
    // ★侍（2026-08-19）
    stance: null,   // 納刀：{ proc, mult } 次に撃つスキルへ乗り、撃ったら消える
    foresight: null, // 見切り：{ turns, pct, perHit, byName } 受けた技ほど避けやすくなる
    frenzy: null,    // 狂乱：{ turns } 効果中は**出る技がランダムになる**（ステ補正は別枠のバフ）
    timedBuffs: [],  // 期限つきバフ：[{ table, turns }] ターンで切れる（狂心のSTR+70%など）
    wallPct: pa.wall ? pa.wall.pct : 0,  // 骸の壁は戦闘開始時から乗る（重複しない）
    guards: pa.debuffGuard,              // 心身一如：デバフを打ち消せる残り回数
    lastSkill: null,                     // 元素共鳴が見る「直前に使ったスキル」
    switchOn: false,
    // ===== エンチャント・状態異常 =====
    en,
    ail: createAilments(),
    enStacks: {},                        // 当てるたびに積むスタック（ステ名→合計%）
    enCut: en.startCut,                  // スケルトン：次に受けるダメージを軽減（受けるまで消えない）
    reflected: false,                    // ウラノス：跳ね返しは最初の1回だけ
    // ===== 武器の進化（戦闘記憶）=====
    evo,
    moves: 0,                            // 自分が行動した回数（疾き刃・遅咲き・積み重ねが見る）
    evoStacks: { dodge: 0, hurt: 0 },    // かわした回数・被弾した回数（liveStats が使う）
    justDodged: false,                   // 直前の相手の攻撃をかわした
    justHurt: false,                     // 直前の相手の攻撃を受けた
    ctx: { dodged: false, hurt: false }, // ★自分の行動を解決するあいだ固定する（1回だけ乗る）
    gutsUsed: false,                     // 不屈は1戦に1回だけ
    // ★エリアの相性（enemies.js の bias）。{ phys:1.1 } のように**受けるダメージへ掛ける**
    taken: fighter.taken || null,
    boss: !!fighter.boss,                // ボスか（「大敵斬り」が見る）
  }
}

// このスキルを撃つのに要るMP。mpPct を持つスキルは「そのときの残りMPの割合」を払う
// （マナボルト＝現在MPの20%。撃つほど1回の消費が減るので、実質的に撃ち切れない）
// ★他職のスキルは消費MPが2倍（skills.js の OFF_CLASS_MP_MULT）。
//   編成の想定利用MP（setMpCost）と同じ関数を通しているので、画面と戦闘でズレない
export const mpCostOf = (side, skill) => {
  const pct = mpPctOf(side?.cls, skill)
  const raw = pct ? Math.floor((side?.mp || 0) * pct) : mpOf(side?.cls, skill)
  // 武器の進化：消費MP−%（代償で付いた「消費MP+%」はマイナスの値で入っている）
  // ★天啓（賢者）の「消費MP-10%」も同じ枠で引く
  const cut = (side?.evo?.mpCost || 0) + (side?.pa?.mpCut || 0)
  return cut ? Math.max(0, Math.round(raw * Math.max(0.1, 1 - cut / 100))) : raw
}

// いま撃てる枠を ptr から探す。見つからなければ null（＝通常攻撃）
const findSlot = (side) => {
  const n = side.slots.length
  for (let i = 0; i < n; i++) {
    const idx = (side.ptr + i) % n
    const s = side.slots[idx]
    if (!s || !s.skill) continue
    if (s.uses <= 0) continue
    // MP不足の枠は飛ばす（使用回数は減らない）。割合消費はMPが1でも残っていれば撃てる
    if (s.skill.mpPct) { if (side.mp <= 0) continue }
    else if (s.skill.mp > side.mp) continue
    return idx
  }
  return null
}

// このターンの行動順の優先度。★納刀中だけ先制になる技がある（侍の居合斬）
export const priorityOf = (side, skill) =>
  (skill?.priority || 0) + (skill ? (side?.stance?.priority || 0) : 0)

// このターン使うスキル（発動判定の前）。行動順の優先度を知るために先に覗く
export const peekSkill = (side) => {
  const idx = findSlot(side)
  return idx === null ? null : side.slots[idx].skill
}

// 見切り：効果中の回避率＋、その技を受けたぶんだけ上乗せ（同じ技ほど見切れる）
export const foresightEva = (side, skillName) => {
  const f = side?.foresight
  if (!f || f.turns <= 0) return 0
  return f.pct + (skillName ? (f.byName[skillName] || 0) : 0)
}
// 見切り：受けた技を覚える
const rememberSkill = (side, skillName) => {
  const f = side?.foresight
  if (!f || f.turns <= 0 || !skillName) return
  // ★同じ技につき max% まで（2026-08-19 ユーザー指定）。効果が切れると byName ごと消える
  f.byName[skillName] = Math.min(f.max ?? 20, (f.byName[skillName] || 0) + f.perHit)
}

// 受けるとき側の軽減。骸の壁（1回きり）と竜鱗の加護（確率）はここでまとめて掛ける
// me は攻撃した側（跳ね返しの戻り先）。kind は 'phys' | 'mag'
const applyIncoming = (me, foe, dmg, kind, rng, log) => {
  if (dmg <= 0) return 0
  let d = dmg
  // エリアの相性：そのエリアの敵は片方の型が少し通りやすい（enemies.js の bias）
  if (foe.taken?.[kind]) d *= foe.taken[kind]
  // 武器の進化：被ダメージ−%（代償で付いた「被ダメージ+%」はここでマイナスに効く）
  const evoCut = evoCutPct(foe.evo, { hpPct: (foe.hp / Math.max(1, foe.base.hp)) * 100, kind })
  if (evoCut) d *= Math.max(0.1, 1 - evoCut / 100)
  // エンチャントの軽減（物理／魔法で別枠）
  const cut = kind === 'mag' ? foe.en.magCutPct : foe.en.physCutPct
  if (cut) d *= Math.max(0, 1 - cut / 100)
  // ATBの「防御」（atb.js が guardCut を立てる。オート戦闘では常に未設定＝素通り）
  if (foe.guardCut) d *= Math.max(0, 1 - foe.guardCut / 100)
  // スケルトン：**1回ダメージを受けると消える**軽減バフ
  if (foe.enCut) { d *= (1 - foe.enCut / 100); foe.enCut = 0; log.push({ side: foe.name, type: 'enCut' }) }
  // 骸の壁：**1回ダメージを受けると消える**。取り直すまで効かない
  if (foe.wallPct) { d *= (1 - foe.wallPct / 100); foe.wallPct = 0; log.push({ side: foe.name, type: 'wall' }) }
  const dc = foe.pa.dodgeCut
  if (dc && roll(dc.pct, rng)) {
    d *= (1 - dc.cut / 100)
    log.push({ side: foe.name, type: 'dodgeCut' })
  }
  const out = Math.max(1, Math.floor(d))
  foe.hp -= out
  // 不屈：致命傷をHP1で耐える（1戦に1回・確率）
  if (foe.hp <= 0 && foe.evo.guts && !foe.gutsUsed && roll(foe.evo.guts, rng)) {
    foe.gutsUsed = true
    foe.hp = 1
    log.push({ side: foe.name, type: 'guts' })
  }
  // 被弾したとき：STRが積み上がる／MPが回復する
  foe.evoStacks.hurt += 1
  if (foe.evo.onHurt.mpHeal) foe.mp = Math.min(foe.base.mp, foe.mp + pctHp(foe.base.mp, foe.evo.onHurt.mpHeal))
  // ウラノス：最初に受けたそのダメージを跳ね返す（跳ね返し自体は再度跳ね返らない）
  const rf = foe.en.reflectFirst
  if (me && rf && !foe.reflected && rf.kind === kind) {
    foe.reflected = true
    const back = Math.max(1, Math.floor(out * rf.pct / 100))
    me.hp -= back
    log.push({ side: foe.name, type: 'reflect', damage: back })
  }
  return out
}

// 回復量。聖職者の「回復量+20%」と、異端審問官の「自身の回復量0.8倍」がここで効く
// エンチャントの回復量+%と、状態異常「回復阻害」もここで掛かる
const healAmount = (side, eff, rate) =>
  Math.max(1, Math.floor(
    healOf(eff, rate) * (1 + side.pa.healBonus / 100) * side.healMult
    * (1 + side.en.healPct / 100) * healMultOf(side.ail)
    * Math.max(0, 1 + side.evo.heal / 100)   // 武器の進化：受ける回復量±%
  ))

// 「最大HPの◯%」のような割合の回復・消耗。最低1（0にすると付いていないのと同じになる）
const pctHp = (max, pct) => (pct > 0 ? Math.max(1, Math.floor(max * pct / 100)) : 0)

// 攻撃を当てたとき・かわしたときに走る、武器の進化のフック
const evoOnHit = (me) => {
  if (me.evo.onHit.hpHeal) me.hp = Math.min(me.base.hp, me.hp + pctHp(me.base.hp, me.evo.onHit.hpHeal))
  if (me.evo.onHit.mpHeal) me.mp = Math.min(me.base.mp, me.mp + pctHp(me.base.mp, me.evo.onHit.mpHeal))
}
const evoOnDodge = (foe, times = 1) => {
  if (times <= 0) return
  foe.evoStacks.dodge += 1
  if (foe.evo.onDodge.hpHeal) {
    foe.hp = Math.min(foe.base.hp, foe.hp + pctHp(foe.base.hp, foe.evo.onDodge.hpHeal) * Math.min(times, EVO_STACK_MAX))
  }
}
// クリティカルしたとき。★多段でも**1回の行動につき1回**だけ走る（得も代償も同じ扱い）
const evoOnCrit = (me, foe, rng, log) => {
  const e = me.evo.onCrit
  if (e.hpHeal) me.hp = Math.min(me.base.hp, me.hp + pctHp(me.base.hp, e.hpHeal))
  if (e.mpHeal) me.mp = Math.min(me.base.mp, me.mp + pctHp(me.base.mp, e.mpHeal))
  if (e.hpCost) me.hp = Math.max(1, me.hp - pctHp(me.base.hp, e.hpCost))
  if (e.mpCost) me.mp = Math.max(0, me.mp - pctHp(me.base.mp, e.mpCost))
  if (e.ail) tryInflict(me, foe, { key:'bleed', chance: e.ail }, rng, log)
}

// デバフを相手へ入れる。心身一如を持っていると1回だけ打ち消される
const applyDebuff = (foe, table, log) => {
  const isDebuff = Object.values(table || {}).some(v => v < 0)
  if (isDebuff && foe.guards > 0) {
    foe.guards -= 1
    log.push({ side: foe.name, type: 'debuffGuard' })
    return
  }
  applyBuff(foe.buffs, table)
}

// 状態異常を1つ試す。**相手のエンチャント抵抗（ailResist）を引いてから**判定する。
// エンチャント由来（onHitAils）とスキル由来（skill.ail）で同じ道を通す＝抵抗の効き方がズレない
// me は入れる側。武器の進化は**入れる側の付与率＋**と**受ける側の抵抗**の両方が効く
const tryInflict = (me, foe, a, rng, log) => {
  const base = a.chance + (me?.evo?.ail?.rate || 0)
  const pct = inflictChance(base, foe.en, a.key)
    - (foe?.evo?.ail?.resist || 0) + (foe?.evo?.ail?.weak || 0)
  if (!roll(pct, rng)) return
  // ★隠身（暗殺者）：自分が付ける出血はスタック上限が伸びる
  const opt = me?.pa?.bleedMax ? { ...a, max: me.pa.bleedMax } : a
  if (inflict(foe.ail, a.key, opt)) log.push({ side: foe.name, type: 'ailment', ail: AIL_LABEL[a.key] })
}

// 攻撃が当たったときのエンチャント。状態異常の付与と、積み上がるステータス補正
const onHit = (me, foe, kind, rng, log) => {
  for (const a of me.en.onHitAils) {
    if (a.kind !== 'any' && a.kind !== kind) continue
    tryInflict(me, foe, a, rng, log)
  }
  // 雪男・氷河ドラゴン・フロストバーン：当てるたびに相手のステータスを下げる（重複上限つき）
  for (const f of me.en.onHitFoeStats) {
    for (const st of f.stats) {
      const cap = f.pct * f.max
      const next = (foe.enStacks[st] || 0) + f.pct
      foe.enStacks[st] = f.pct < 0 ? Math.max(cap, next) : Math.min(cap, next)
    }
  }
  // 極夜のワイト・熾火のデーモン：当てるたびに自分のステータスを上げる（重複上限つき）
  for (const s of me.en.onHitSelfStats) {
    if (s.kind !== 'any' && s.kind !== kind) continue
    me.enStacks[s.stat] = Math.min(s.pct * s.max, (me.enStacks[s.stat] || 0) + s.pct)
  }
}

// 武器の進化ぶんの与ダメージ倍率。乗る条件を満たしていないものは1のまま
// ★条件はここで**全部**そろえて渡す。片方の呼び出しだけ条件が抜けると、
//   通常攻撃とスキルで挙動が変わってしまう
const evoMult = (me, foe, { kind = 'phys', skill = false, multi = false } = {}) => {
  const pct = evoDmgPct(me.evo, {
    kind, skill, multi,
    hpPct: (me.hp / Math.max(1, me.base.hp)) * 100,
    // ★仕留め際は**相手の**HPを見る。倒しきる一撃にも乗るよう、攻撃を解決する前の値で判定する
    foeHpPct: (foe.hp / Math.max(1, foe.base.hp)) * 100,
    foeBigger:  (foe.power || 0) > (me.power || 0),
    foeSmaller: (foe.power || 0) < (me.power || 0),
    foeBoss: !!foe.boss,
    foeAiled: Object.keys(foe.ail || {}).length > 0,
    moves: me.moves,
    combo: Math.max(0, me.moves - 1),
    justDodged: me.ctx.dodged,
    justHurt: me.ctx.hurt,
  })
  return pct ? Math.max(0.1, 1 + pct / 100) : 1
}

// 鷹ノ目：最終命中率に掛ける倍率。相手が瀕死（HPが at% 以下）ならさらに伸びる
export const hitMultOf = (me, foe) => {
  const h = me.pa.hitMult
  if (!h) return 1
  const pct = (Math.max(0, foe.hp) / Math.max(1, foe.base.hp)) * 100
  return pct <= (h.at ?? 30) ? (h.lowMult ?? h.mult) : h.mult
}
// 隠身のクリダメ+% ＋ 精密照準の積み上げぶん
export const critDmgOf = (me) => {
  const st = me.pa.hitStack
  return me.pa.critDmg + (st ? Math.min(st.max, me.hitStacks) * (st.critDmg || 0) : 0)
}
// 精密照準の積み上げぶん（クリティカル率）
export const critRateStackOf = (me) => {
  const st = me.pa.hitStack
  return st ? Math.min(st.max, me.hitStacks) * (st.critRate || 0) : 0
}
// 当てたら積む（精密照準）
const bumpHitStack = (me, hits) => {
  if (me.pa.hitStack && hits > 0) me.hitStacks = Math.min(me.pa.hitStack.max, me.hitStacks + 1)
}

// 1回の行動を解決する。戻り値はログ用の1件
// ★opt はATB戦闘（atb.js）のためのもの。オート戦闘（runBattle）は opt を渡さないので挙動は変わらない
//     idx        … 撃つ枠を指定する（null＝通常攻撃・省略＝いままで通り findSlot が自動で選ぶ）
//     noProc     … 発動率の抽選をしない（ATBは不発の代わりに「必要ゲージ」で重さを表す）
//     noParalyze … 麻痺の判定をしない（ATBは麻痺＝ゲージが止まる、で表現する）
export const takeAction = (me, foe, rng, log, opt = {}) => {
  me.moves += 1   // 疾き刃・遅咲き・積み重ねが見る。麻痺で動けなくても1回と数える
  // ★「かわした次の攻撃」「被弾した次の攻撃」は**1回の行動にだけ**乗る。
  //   ここで読み取って消しておかないと、一度かわしただけで最後まで乗り続ける
  me.ctx = { dodged: me.justDodged, hurt: me.justHurt }
  me.justDodged = false
  me.justHurt = false
  // 麻痺：このターンは動けない（見た時点で1ターンぶん消える）
  if (!opt.noParalyze && consumeParalyze(me.ail)) {
    log.push({ side: me.name, type: 'paralyzed' })
    return
  }
  let idx = opt.idx !== undefined ? opt.idx : findSlot(me)
  // ★狂乱（狂戦士の狂心）：自分では技を選べない。撃てる攻撃スキルからランダムに出る
  if (me.frenzy?.turns > 0) {
    const wild = me.slots
      .map((sl, i) => ({ sl, i }))
      .filter(({ sl }) => sl?.skill && sl.uses > 0 && (sl.skill.kind === 'phys' || sl.skill.kind === 'mag')
        && (sl.skill.mpPct ? me.mp > 0 : mpCostOf(me, sl.skill) <= me.mp))
    if (wild.length) idx = wild[Math.floor(rng() * wild.length)].i
  }
  const slot = idx === null ? null : me.slots[idx]
  const skill = slot?.skill || null

  // 発動判定。不発ならMPも使用回数も減らず、ポインタも進めない
  //   ★不発はバーサク・執行本能のスタックをリセットする
  // ★納刀（侍）：次に撃つスキルの発動率+・威力×。不発では消えない（撃てるまで構えたまま）
  const stance = skill ? me.stance : null
  if (skill && !opt.noProc && !roll(skill.proc + me.pa.procBonus + me.en.procBonus + me.evo.proc + (stance?.proc || 0), rng)) {
    log.push({ side: me.name, type: 'misfire', skill: skill.name })
    me.rage = 0
    // 居合の構えはここで威力2倍。武器の進化「居合の心得」も同じ枠で乗る
    normalAttack(me, foe, rng, log, me.pa.misfireAtkMult * (1 + me.evo.misfireDmg / 100))
    return
  }
  if (!skill) { me.rage = 0; normalAttack(me, foe, rng, log); return }

  // 納刀を使う：この行動だけ威力×mult。条件つきの効果（whileStance）もここで開く
  const ws = stance ? (skill.whileStance || null) : null
  if (stance) me.stance = null
  me.mp -= mpCostOf(me, skill)
  // ★すてみ（狂戦士）：現在HPの n% を払って撃つ。払っても死なない（1は残る）
  if (skill.hpCostPct) {
    const pay = Math.min(Math.max(0, me.hp - 1), Math.floor(me.hp * skill.hpCostPct / 100))
    if (pay > 0) {
      me.hp -= pay
      log.push({ side: me.name, type: 'hpCost', skill: skill.name, damage: pay })
    }
  }
  slot.uses -= 1
  me.ptr = (idx + 1) % me.slots.length

  // 元素共鳴：直前に使ったスキルと違えば、この行動だけ補正が乗る
  me.switchOn = me.lastSkill !== null && me.lastSkill !== skill.name
  me.lastSkill = skill.name
  me.acts += 1

  const eMe = liveStats(me, true)
  const eFoe = liveStats(foe)
  // ★他職のスキルは効果が落ちる（skills.js の OFF_CLASS_MULT）。ダメージ・回復・バフ幅・
  //   状態異常の付与確率に掛かる。発動率・消費MP・防御無視・必中などには掛からない
  const off = offClassMult(me.cls, skill)

  if (skill.kind === 'phys' || skill.kind === 'mag') {
    let raw = 0
    let crit = false
    let hits = 0
    let missed = 0
    // 第六感の「貫通+10%」はスキルの防御貫通に足す。武器の進化ぶんも同じ枠
    const defPen = Math.min(1, (skill.defPen || 0) + (ws?.defPen || 0) + me.pa.defPenBonus / 100 + me.evo.defPen / 100)
    // ★出血スタックの起爆（暗殺者の急所突き）。**相手に積んだ出血を全部消費して威力を上げる**
    //   ＝「出血を撒く技」と「刈り取る技」で1つの流れになる（消費するので撒き直しが要る）
    let burst = 1
    if (skill.consumeAil) {
      const c = skill.consumeAil
      const st = c.key === 'bleed' ? (foe.ail.bleed?.stacks || 0) : (hasAilment(foe.ail, c.key) ? 1 : 0)
      if (st > 0) {
        burst = 1 + c.perStack * st
        delete foe.ail[c.key]
        log.push({ side: foe.name, type: 'consumeAil', ail: AIL_LABEL[c.key], stacks: st, mult: burst })
      }
    }
    for (let h = 0; h < (skill.hits || 1); h++) {
      const r = resolveAttack({
        attacker: eMe, defender: eFoe, mult: skill.mult * burst * (stance?.mult || 1), kind: skill.kind,
        defPen, add: skill.add || null,
        sureHit: !!skill.sureHit, sureCrit: !!skill.sureCrit, noCrit: !!skill.noCrit,
        acc: skill.acc ?? 100,
        // ★スキル自身の命中補正（skill.hitBonus）もここで足す＝「必中ではないが当てやすい技」を作れる
        hitBonus: me.pa.hitBonus + me.en.hitBonus + evoHit(me, foe) + (skill.hitBonus || 0),
        evaBonus: foe.pa.evaBonus + foe.en.evaBonus + evoEva(foe) + foresightEva(foe, skill.name),
        critBonus: me.pa.critBonus + evoCrit(me, foe) + critRateStackOf(me),
        hitMult: hitMultOf(me, foe),
        critDmg: critDmgOf(me),
        redMult: 1 + (foe.pa.defRed || 0) / 100,
      }, rng)
      // ★クリティカルの与ダメージ+%は**1発ずつ**掛ける（多段でクリした発だけ伸びる）
      // ★ヒットごとに状態異常を試す技（連撃で少しずつ積む）
      if (r.hit && skill.ailPerHit && skill.ail) {
        tryInflict(me, foe, { ...skill.ail, chance: skill.ail.chance * off }, rng, log)
      }
      raw += r.hit && r.crit && me.evo.critDmg
        ? Math.floor(r.damage * (1 + me.evo.critDmg / 100))
        : r.damage
      if (r.hit) hits++; else missed++
      if (r.crit && r.hit) crit = true
    }
    // かわされたぶん／当てたぶんは、相手側の「かわすたび」フックと次の行動の条件になる
    evoOnDodge(foe, missed)
    foe.justDodged = hits === 0
    foe.justHurt = hits > 0
    if (crit) evoOnCrit(me, foe, rng, log)
    // ギャンブルボディ：当たったとき、確率で威力が振れる
    const g = me.pa.gamble
    if (g && hits > 0) {
      const v = rng() * 100
      if (v < g.up) raw = Math.floor(raw * g.upMult)
      else if (v < g.up + g.down) raw = Math.floor(raw * g.downMult)
    }
    // エンチャントの与ダメージ+%（物理／魔法で別枠。時間帯ぶんも畳み込み済み）
    raw = Math.floor(raw * (1 + (skill.kind === 'mag' ? me.en.magDmgPct : me.en.physDmgPct) / 100))
    if (off !== 1) raw = Math.floor(raw * off)
    // 武器の進化（条件つきの与ダメージ+%をまとめて）
    raw = Math.floor(raw * evoMult(me, foe, { kind: skill.kind, skill: true, multi: (skill.hits || 1) > 1 }))
    rememberSkill(foe, skill.name)
    const dmg = applyIncoming(me, foe, raw, skill.kind, rng, log)
    if (hits > 0) {
      bumpHitStack(me, hits)
      onHit(me, foe, skill.kind, rng, log)
      evoOnHit(me)   // 武器の進化：当てるたびHP/MPが戻る
      // ★スキル自身が持つ状態異常（どくのほうし＝毒、電撃＝麻痺 など）。**当たったときだけ**。
      //   敵もプレイヤーと同じ takeAction を通るので、これで**敵→こちら**にも状態異常が飛ぶ
      //   ＝エンチャントの抵抗（毒キノコ・払暁のワイバーン）が意味を持つ
      if (skill.ail && !skill.ailPerHit) {
        // 納刀ぶんで確率が上がる技がある（月影＝納刀中は出血100%）
        const chance = ws?.ailChance ?? (skill.ail.chance * off)
        tryInflict(me, foe, { ...skill.ail, chance }, rng, log)
      }
    }
    // バーサク・執行本能：ダメージを与えたら+1スタック、全部外れたらリセット
    if (me.pa.rages.length) me.rage = hits > 0 ? me.rage + 1 : 0
    // 吸収：与えたダメージの一定割合を自分のHPへ（ソウルドレイン・ブラッティロアなど）
    let drained = 0
    // 武器の進化の吸収(%)はスキル自身の吸収と同じ枠で足す
    const drainRate = (skill.drain || 0) + me.evo.drain / 100
    if (drainRate > 0 && dmg > 0) {
      drained = Math.max(1, Math.floor(dmg * drainRate))
      me.hp = Math.min(me.base.hp, me.hp + drained)
    }
    // コウモリ・暁のフレイムバット：物理で与えたダメージの一部を回復
    if (skill.kind === 'phys' && me.en.drainPhysPct > 0 && dmg > 0) {
      const back = Math.max(1, Math.floor(dmg * me.en.drainPhysPct / 100))
      me.hp = Math.min(me.base.hp, me.hp + back)
      drained += back
    }
    log.push({ side: me.name, type: 'skill', skill: skill.name, kind: skill.kind, damage: dmg, crit, hits, of: skill.hits || 1, drain: drained })
  } else if (skill.kind === 'heal') {
    if (skill.heal) {
      const amt = healAmount(me, eMe, skill.heal.rate * off)
      me.hp = Math.min(me.base.hp, me.hp + amt)
      log.push({ side: me.name, type: 'heal', skill: skill.name, heal: amt })
    }
    if (skill.regen)   { me.regen   = { ...skill.regen,   rate: skill.regen.rate * off };   log.push({ side: me.name, type: 'regen', skill: skill.name }) }
    if (skill.mpRegen) { me.mpRegen = { ...skill.mpRegen, rate: skill.mpRegen.rate * off }; log.push({ side: me.name, type: 'mpRegen', skill: skill.name }) }
  }

  // 骸の壁：戦闘開始時と自分の行動5回ごとに得る（重複しないので、掛け直すだけ）
  if (me.pa.wall && me.acts % me.pa.wall.every === 0) me.wallPct = me.pa.wall.pct

  // ★納刀：構えるだけの技（次のスキルへ乗る）
  if (skill.stance) {
    me.stance = { ...skill.stance }
    log.push({ side: me.name, type: 'stance', skill: skill.name })
  }
  // ★狂乱（狂心）：出る技がランダムになる状態
  if (skill.frenzy) {
    me.frenzy = { ...skill.frenzy }
    log.push({ side: me.name, type: 'frenzy', skill: skill.name, turns: skill.frenzy.turns })
  }
  // ★見切り：一定ターンのあいだ回避が上がり、受けた技ほど見切れる
  if (skill.foresight) {
    me.foresight = { ...skill.foresight, byName: me.foresight?.byName || {} }
    log.push({ side: me.name, type: 'foresight', skill: skill.name, turns: skill.foresight.turns })
  }
  // バフ・デバフ（攻撃スキルに付いていることもある）
  // ★buffTurns を持つ技は「期限つき」＝そのターン数で切れる（狂心）
  if (skill.buff && skill.buffTurns) {
    if (skill.buff.self) me.timedBuffs.push({ table: scaleTable(skill.buff.self, off), turns: skill.buffTurns })
    if (skill.buff.enemy) foe.timedBuffs.push({ table: scaleTable(skill.buff.enemy, off), turns: skill.buffTurns })
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  } else if (skill.buff) {
    if (skill.buff.self)  applyBuff(me.buffs, scaleTable(skill.buff.self, off))
    if (skill.buff.enemy) applyDebuff(foe, scaleTable(skill.buff.enemy, off), log)
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
}

// 通常攻撃。mult は居合の構え（不発時2倍）のための倍率
const normalAttack = (me, foe, rng, log, multScale = 1) => {
  const eMe = liveStats(me, true)
  const eFoe = liveStats(foe)
  const r = resolveAttack({
    attacker: eMe, defender: eFoe, mult: NORMAL_ATTACK_MULT * multScale, kind: me.kind,
    defPen: me.pa.defPenBonus / 100 + me.evo.defPen / 100,
    hitBonus: me.pa.hitBonus + me.en.hitBonus + evoHit(me, foe),
    evaBonus: foe.pa.evaBonus + foe.en.evaBonus + evoEva(foe) + foresightEva(foe, null),
    critBonus: me.pa.critBonus + evoCrit(me, foe) + critRateStackOf(me),
    hitMult: hitMultOf(me, foe),
    critDmg: critDmgOf(me),
    redMult: 1 + (foe.pa.defRed || 0) / 100,
  }, rng)
  evoOnDodge(foe, r.hit ? 0 : 1)
  foe.justDodged = !r.hit
  foe.justHurt = !!r.hit
  if (r.hit && r.crit) evoOnCrit(me, foe, rng, log)
  // 通常攻撃も「物理攻撃」なのでエンチャントの与ダメージ+%とヒット時効果が乗る
  const critMult = r.hit && r.crit && me.evo.critDmg ? 1 + me.evo.critDmg / 100 : 1
  const raw = Math.floor(r.damage * (1 + (me.kind === 'mag' ? me.en.magDmgPct : me.en.physDmgPct) / 100)
    * critMult * evoMult(me, foe, { kind: me.kind, skill: false }))
  const dmg = applyIncoming(me, foe, raw, me.kind, rng, log)
  if (r.hit) { bumpHitStack(me, 1); onHit(me, foe, me.kind, rng, log); evoOnHit(me) }
  const drainRate = me.evo.drain / 100
  if (drainRate > 0 && dmg > 0) me.hp = Math.min(me.base.hp, me.hp + Math.max(1, Math.floor(dmg * drainRate)))
  if (me.kind === 'phys' && me.en.drainPhysPct > 0 && dmg > 0) {
    me.hp = Math.min(me.base.hp, me.hp + Math.max(1, Math.floor(dmg * me.en.drainPhysPct / 100)))
  }
  log.push({ side: me.name, type: 'normal', kind: me.kind, damage: dmg, crit: r.crit, hit: r.hit, mult: multScale })
}

// 回避率。HPが減っているときだけ乗る「際の見切り」をここで足す
const evoEva = (side) => side.evo.eva
  + ((side.hp / Math.max(1, side.base.hp)) * 100 <= EVO_LOW_HP ? side.evo.evaLow : 0)
// 相手が瀕死のとき、命中率とクリティカル率に乗る「仕留め際」ぶん
const foeIsLow = (foe) => (foe.hp / Math.max(1, foe.base.hp)) * 100 <= FOE_LOW_PCT
const evoHit  = (me, foe) => me.evo.hit      + (foeIsLow(foe) ? me.evo.hitFinish : 0)
const evoCrit = (me, foe) => me.evo.critRate + (foeIsLow(foe) ? me.evo.critFinish : 0)

// ターン終了時の持続ダメージ（出血・毒）と、ターン数の減り
// ★出血・毒は割合ダメージなのでVITでは軽減されない（旧版と同じ）
export const tickAil = (side, log, foe = null) => {
  // ★倍率は**入れた側**の武器の進化を見る（受けた側ではない）
  const boost = 1 + (foe?.evo?.ail?.dmg || 0) / 100
  for (const t of tickAilments(side.ail, { hp: side.hp, maxHp: side.base.hp })) {
    t.damage = Math.max(1, Math.floor(t.damage * boost))
    side.hp -= t.damage
    log.push({ side: side.name, type: 'ailTick', ail: AIL_LABEL[t.key], damage: t.damage, stacks: t.stacks })
    if (side.hp <= 0) return
  }
}

// 見切りの残りターン（ターン終わりに1つ減る）
export const tickForesight = (side) => {
  if (side.foresight?.turns > 0) {
    side.foresight.turns -= 1
    if (side.foresight.turns <= 0) side.foresight = null
  }
  if (side.frenzy?.turns > 0) {
    side.frenzy.turns -= 1
    if (side.frenzy.turns <= 0) side.frenzy = null
  }
  if (side.timedBuffs?.length) {
    for (const t of side.timedBuffs) t.turns -= 1
    side.timedBuffs = side.timedBuffs.filter(t => t.turns > 0)
  }
}

// ターン終了時の持続効果（回復）
export const tickRegen = (side, log, foe = null) => {
  const eff = liveStats(side)
  // 武器の進化：毎ターンの自動回復（スキルの継続回復とは別枠）
  if (side.evo?.regen) {
    const amt = Math.max(1, Math.floor(side.base.hp * side.evo.regen / 100))
    side.hp = Math.min(side.base.hp, side.hp + amt)
    log.push({ side: side.name, type: 'regenTick', heal: amt })
  }
  if (side.evo?.mpRegen) {
    side.mp = Math.min(side.base.mp, side.mp + Math.max(1, Math.floor(side.base.mp * side.evo.mpRegen / 100)))
  }
  // 相手が状態異常のときだけ効く回復
  if (side.evo?.ail.drain && foe && Object.keys(foe.ail || {}).length > 0) {
    const amt = Math.max(1, Math.floor(side.base.hp * side.evo.ail.drain / 100))
    side.hp = Math.min(side.base.hp, side.hp + amt)
    log.push({ side: side.name, type: 'regenTick', heal: amt })
  }
  if (side.regen?.turns > 0) {
    const amt = healAmount(side, eff, side.regen.rate)
    side.hp = Math.min(side.base.hp, side.hp + amt)
    side.regen.turns -= 1
    log.push({ side: side.name, type: 'regenTick', heal: amt })
  }
  if (side.mpRegen?.turns > 0) {
    const amt = healAmount(side, eff, side.mpRegen.rate)
    side.mp = Math.min(side.base.mp, side.mp + amt)
    side.mpRegen.turns -= 1
    log.push({ side: side.name, type: 'mpRegenTick', mp: amt })
  }
}

// 戦闘を最後まで回す。fighters は createSide に渡せる形
// band は '朝' | '昼' | '晩'。時間帯条件つきのエンチャントがここで有効／無効になる
export const runBattle = (fighterA, fighterB, { rng = Math.random, maxTurns = MAX_TURNS, band = null } = {}) => {
  const a = createSide(fighterA, band)
  const b = createSide(fighterB, band)
  const log = []
  let turn = 1

  for (; turn <= maxTurns; turn++) {
    // 行動順：このターン撃つ予定のスキルの優先度 → AGI → ランダム
    const eA = liveStats(a)
    const eB = liveStats(b)
    const pA = priorityOf(a, peekSkill(a))
    const pB = priorityOf(b, peekSkill(b))
    // 武器の進化「先手必勝」：確率でそのターンの先攻を取る（両方が引いたら通常どおり）
    const fA = a.evo.first > 0 && roll(a.evo.first, rng)
    const fB = b.evo.first > 0 && roll(b.evo.first, rng)
    const aFirst = fA !== fB ? fA : goesFirst(eA, eB, pA, pB, rng)
    const order = aFirst ? [[a, b], [b, a]] : [[b, a], [a, b]]

    for (const [me, foe] of order) {
      if (a.hp <= 0 || b.hp <= 0) break
      takeAction(me, foe, rng, log)
      if (foe.hp <= 0) break
      // 追加行動（相手よりAGIが高いときだけ・上限50%）
      const em = liveStats(me)
      const ef = liveStats(foe)
      // 武器の進化「疾風の足」ぶんは追加行動率へ素直に足す
      if (rollExtraAction(em, ef, rng) || (me.evo.extra > 0 && roll(me.evo.extra, rng))) {
        log.push({ side: me.name, type: 'extra' })
        takeAction(me, foe, rng, log)
      }
    }

    if (a.hp <= 0 || b.hp <= 0) break
    tickAil(a, log, b)
    tickAil(b, log, a)
    if (a.hp <= 0 || b.hp <= 0) break
    tickRegen(a, log, b)
    tickRegen(b, log, a)
    tickForesight(a)
    tickForesight(b)
    if (a.hp <= 0 || b.hp <= 0) break
    // 画面でHPバーを出すための、ターン終わりのスナップショット（戦闘の結果には影響しない）
    log.push({ type:'hp', turn, a: Math.max(0, a.hp), aMax: a.base.hp, b: Math.max(0, b.hp), bMax: b.base.hp })
  }

  // 決着した時点のHPも1件出す（倒したときに 0 のバーが出るように。旧版と同じ）
  log.push({ type:'hp', turn: Math.min(turn, maxTurns), a: Math.max(0, a.hp), aMax: a.base.hp, b: Math.max(0, b.hp), bMax: b.base.hp })
  const winner = a.hp <= 0 && b.hp <= 0 ? 'draw' : a.hp <= 0 ? 'b' : b.hp <= 0 ? 'a' : 'draw'
  return { winner, turns: Math.min(turn, maxTurns), log, a, b }
}
