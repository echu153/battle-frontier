// ============================================================
// バトルフロンティアⅡ（リメイク版）— ペットのバトル
// ------------------------------------------------------------
// ★本編の runBattle とは別物。ペット同士の1対1で、技は4つから選ぶ。
//   ここは純関数だけ（画面もサーバーも触らない）＝テストで固定できる。
//
// ステの決まり方（ユーザー承認済み）
//   実ステ ＝ **種族値 × 育てたpt**
//   ミニゲームで貯めたptが statValueOf でステ値になり、それが倍率になる。
//   毎日の積み上げがそのままバトルの強さになる、という今の軸を残すため。
// ============================================================
import { statValueOf, PET_STAT_KEYS } from './pet.js'
import { moveOf } from './petMoves.js'
import { typeMult, typeText } from './petTypes.js'
import { speciesOf, knownMoves, SPECIES } from './petSpecies.js'
import { AIL_LABEL } from './ailments.js'

// ============================================================
// 状態異常
// ------------------------------------------------------------
// ★2種類ある。混ぜないこと。
//   ① status … やけど／まひ／どく。**1体に1つだけ・戦闘が終わるまで残る**
//   ② ail    … 本編（ailments.js）と同じ顔ぶれ。**ターンで消える・重ねて持てる**
//              名前は AIL_LABEL から借りて、本編と呼び方をそろえてある。
//              数字はペットの1対1（HPが小さい・4つしか技がない）に合わせて別に持つ
// ============================================================
export const PET_AIL_TURNS = {
  bleed: 4,      // 出血：ターンの終わりに削られる（重なる）
  blind: 4,      // 暗闇：当たらなくなる
  curse: 4,      // 呪い：受けるダメージが増える
  frenzy: 3,     // 狂乱：出す技を選べない
  weaken: 4,     // 衰弱：与えるダメージが減る
  slow: 4,       // 鈍足：AGIが落ちる＝後攻になりやすい
  silence: 3,    // サイレンス：変化技が出せない
}
export const PET_AIL_KEYS = Object.keys(PET_AIL_TURNS)
export const petAilLabel = (key) => AIL_LABEL[key] || key

// かかったとき／治ったときの文。ラベルをそのまま埋めると「呪いになった」になる
const AIL_ON = {
  bleed: 'は出血した', blind: 'は目がくらんだ', curse: 'は呪われた', frenzy: 'は狂乱した',
  weaken: 'は弱ってきた', slow: 'は動きが鈍った', silence: 'は声を封じられた',
}
const AIL_OFF = {
  bleed: 'の出血が止まった', blind: 'の目が慣れた', curse: 'の呪いが解けた',
  frenzy: 'は落ち着いた', weaken: 'は力を取り戻した', slow: 'の動きが戻った',
  silence: 'の声が戻った',
}

export const BLIND_ACC_PT = -25        // 命中率に足す%ポイント
export const CURSE_TAKEN = 1.15        // 受けるダメージ倍率
export const WEAKEN_DEAL = 0.85        // 与えるダメージ倍率
export const SLOW_AGI = 0.8            // AGIにかかる倍率
export const BLEED_PER_STACK = 0.02    // 1スタックあたり最大HPの%（4%だと通常攻撃より強かった）
export const BLEED_MAX_STACKS = 5

export const hasAil = (f, key) =>
  key === 'bleed' ? ((f?.ail?.bleed?.stacks || 0) > 0 && f.ail.bleed.turns > 0)
    : ((f?.ail?.[key]?.turns || 0) > 0)

export const MOVE_SLOTS = 4          // 技は4つまで（pet.js と同じ値）
export const HP_PER_VIT = 2.5        // HPはVITから作る
export const STAB = 1.5              // 自分のタイプと同じ技は威力が上がる
export const CRIT_MULT = 1.5
export const CRIT_BASE = 6           // 急所の基本%（LUKで上がる）

// 育てたpt → 倍率。0ptで等倍、1か月(2400pt)で約8倍、1年で約25倍
export const growthMult = (cumPt) => (10 + statValueOf(cumPt)) / 10

// 種族値と育てたptから、そのペットの実ステを出す
export const battleStatsOf = (species, cum) => {
  const out = {}
  for (const k of PET_STAT_KEYS) {
    out[k] = Math.max(1, Math.floor((species.base[k] || 10) * growthMult(cum?.[k] || 0)))
  }
  return out
}

export const maxHpOf = (stats) => Math.max(10, Math.floor(stats.vit * HP_PER_VIT))

// ===== 上げ下げ（-6〜+6）=====
export const STAGE_MIN = -6
export const STAGE_MAX = 6
export const stageMult = (n) => (n >= 0 ? (2 + n) / 2 : 2 / (2 - n))

// 戦う1体を組み立てる
export const makeFighter = (speciesId, cum, moves, name = null) => {
  const sp = speciesOf(speciesId)
  if (!sp) return null
  const stats = battleStatsOf(sp, cum)
  const hp = maxHpOf(stats)
  return {
    sp,
    name: name || sp.name,
    stats,
    hp,
    maxHp: hp,
    moves: (moves || []).slice(0, MOVE_SLOTS).map(n => ({ name: n, pp: moveOf(n)?.pp || 0 })),
    stage: Object.fromEntries(PET_STAT_KEYS.map(k => [k, 0])),
    status: '',      // '' / 'やけど' / 'まひ' / 'どく'（戦闘が終わるまで残る）
    ail: {},         // 出血・暗闇・呪い・狂乱・衰弱・鈍足・サイレンス（ターンで消える）
  }
}

// 上げ下げこみのステ。鈍足はここで効かせる（先攻・後攻にも回避にも効く）
const statOf = (f, k) => {
  const slow = (k === 'agi' && hasAil(f, 'slow')) ? SLOW_AGI : 1
  return Math.max(1, Math.floor(f.stats[k] * stageMult(f.stage[k] || 0) * slow))
}

// ===== 野生の相手 =====
// ★強さはこちらと同じ育ちぶんから作る。少しだけ振れる（0.85〜1.05倍）ので、
//   格下にも格上にも当たる
export const makeWild = (speciesId, cum, lv, rng = Math.random) => {
  const sp = speciesOf(speciesId)
  if (!sp) return null
  const scale = 0.85 + rng() * 0.2
  const wildCum = Object.fromEntries(
    PET_STAT_KEYS.map(k => [k, Math.floor((cum?.[k] || 0) * scale)]))
  const pool = knownMoves(sp, lv)
  // 後ろ（＝強い技）から4つ
  const moves = pool.slice(-MOVE_SLOTS)
  return makeFighter(speciesId, wildCum, moves.length ? moves : pool.slice(0, MOVE_SLOTS))
}

// ===== ダメージ =====
export const damageOf = (atk, def, move, rng = Math.random) => {
  const m = moveOf(move)
  if (!m || m.kind === '変化') return { dmg: 0, mult: 1, crit: false }
  const useStr = m.kind === '物理'
  const a = statOf(atk, useStr ? 'str' : 'int_stat')
  const d = statOf(def, 'vit')
  const mult = typeMult(m.type, def.sp.types)
  if (mult === 0) return { dmg: 0, mult: 0, crit: false }

  const critRate = CRIT_BASE + (m.eff?.crit ? 12 : 0) + Math.floor((atk.stage.luk || 0) * 6)
  const crit = rng() * 100 < critRate
  const stab = atk.sp.types.includes(m.type) ? STAB : 1
  const burn = (atk.status === 'やけど' && useStr) ? 0.5 : 1
  const weaken = hasAil(atk, 'weaken') ? WEAKEN_DEAL : 1    // 衰弱：与えるダメージが減る
  const curse = hasAil(def, 'curse') ? CURSE_TAKEN : 1      // 呪い：受けるダメージが増える
  const spread = 0.85 + rng() * 0.15

  let dmg = (m.pow * a / d) * 0.5 + 2
  dmg *= mult * stab * burn * weaken * curse * spread
  if (crit) dmg *= CRIT_MULT
  return { dmg: Math.max(1, Math.floor(dmg)), mult, crit }
}

// 当たるか
export const hits = (atk, def, move, rng = Math.random) => {
  const m = moveOf(move)
  if (!m) return false
  const ratio = statOf(atk, 'dex') / statOf(def, 'agi')
  const blind = hasAil(atk, 'blind') ? BLIND_ACC_PT : 0    // 暗闇：当てにくくなる
  const acc = Math.max(5, Math.min(100, m.acc * (0.85 + Math.min(0.45, ratio * 0.15)) + blind))
  return rng() * 100 < acc
}

// ===== 1体ぶんの行動 =====
const STAT_LABEL = { str:'STR', int_stat:'INT', vit:'VIT', dex:'DEX', agi:'AGI', luk:'LUK' }

const applyStage = (f, stat, n, log, who) => {
  const before = f.stage[stat] || 0
  const after = Math.max(STAGE_MIN, Math.min(STAGE_MAX, before + n))
  f.stage[stat] = after
  const label = STAT_LABEL[stat] || stat
  if (after === before) log.push(`${who}の${label}はもう変わらない`)
  else log.push(`${who}の${label}が${n > 0 ? '上がった' : '下がった'}`)
}

// 状態異常を入れる。ail は { key, pct, turns?, stacks? }
const applyAil = (target, ail, log, rng) => {
  if (!ail?.key || !PET_AIL_TURNS[ail.key]) return
  if (rng() * 100 >= (ail.pct ?? 100)) return
  const turns = ail.turns || PET_AIL_TURNS[ail.key]
  if (ail.key === 'bleed') {
    const cur = target.ail.bleed?.stacks || 0
    target.ail.bleed = { turns, stacks: Math.min(BLEED_MAX_STACKS, cur + (ail.stacks || 1)) }
    log.push(`${target.name}${AIL_ON.bleed}（${target.ail.bleed.stacks}）`)
    return
  }
  // 出血いがいは重ならない＝ターンの数え直し（本編と同じ扱い）
  target.ail[ail.key] = { turns }
  log.push(`${target.name}${AIL_ON[ail.key] || `は${petAilLabel(ail.key)}になった`}`)
}

const act = (atk, def, moveName, log, rng) => {
  // 狂乱：出す技を選べない。撃てる技からランダムに出る
  if (hasAil(atk, 'frenzy')) {
    const usable = atk.moves.filter(s => s.pp > 0)
    if (usable.length) {
      const pick = usable[Math.floor(rng() * usable.length)].name
      if (pick !== moveName) log.push(`${atk.name}は狂乱していて技を選べない！`)
      moveName = pick
    }
  }
  const m = moveOf(moveName)
  const slot = atk.moves.find(s => s.name === moveName)
  if (!m || !slot || slot.pp <= 0) { log.push(`${atk.name}は動けなかった`); return }

  // サイレンス：変化技だけ出せない（攻撃技は出る）
  if (m.kind === '変化' && hasAil(atk, 'silence')) {
    slot.pp -= 1
    log.push(`${atk.name}はサイレンスで${m.name}を出せない！`)
    return
  }
  slot.pp -= 1

  if (atk.status === 'まひ' && rng() < 0.25) {
    log.push(`${atk.name}はしびれて動けない！`)
    return
  }
  log.push(`${atk.name}の ${m.name}！`)

  if (m.kind === '変化') {
    if (m.eff?.up) applyStage(atk, m.eff.up.stat, m.eff.up.n, log, atk.name)
    if (m.eff?.up2) applyStage(atk, m.eff.up2.stat, m.eff.up2.n, log, atk.name)
    if (m.eff?.down) {
      if (hits(atk, def, moveName, rng)) applyStage(def, m.eff.down.stat, -m.eff.down.n, log, def.name)
      else log.push('しかし外れた')
    }
    if (m.eff?.heal) {
      const heal = Math.floor(atk.maxHp * m.eff.heal)
      atk.hp = Math.min(atk.maxHp, atk.hp + heal)
      log.push(`${atk.name}は${heal}回復した`)
    }
    if (m.eff?.poison && !def.status) { def.status = 'どく'; log.push(`${def.name}は毒を受けた`) }
    if (m.eff?.para && !def.status) { def.status = 'まひ'; log.push(`${def.name}はしびれた`) }
    // ターンで消える状態異常（暗闇・呪い・狂乱・衰弱・鈍足・サイレンス・出血）
    if (m.eff?.ail) {
      if (hits(atk, def, moveName, rng)) applyAil(def, m.eff.ail, log, rng)
      else log.push('しかし外れた')
    }
    return
  }

  if (!hits(atk, def, moveName, rng)) { log.push('しかし外れた'); return }

  const times = m.eff?.multi ? 2 + Math.floor(rng() * 4) : 1
  let total = 0
  let last = null
  for (let i = 0; i < times && def.hp > 0; i++) {
    const r = damageOf(atk, def, moveName, rng)
    last = r
    if (r.mult === 0) break
    def.hp = Math.max(0, def.hp - r.dmg)
    total += r.dmg
  }
  if (last?.mult === 0) { log.push(`${def.name}には効果がない`); return }
  if (times > 1) log.push(`${times}回当たった！`)
  if (last?.crit) log.push('急所に当たった！')
  const t = typeText(last?.mult ?? 1)
  if (t) log.push(t)
  log.push(`${def.name}に${total}のダメージ`)

  if (m.eff?.drain) {
    const heal = Math.floor(total / 2)
    atk.hp = Math.min(atk.maxHp, atk.hp + heal)
    log.push(`${atk.name}は${heal}吸い取った`)
  }
  if (m.eff?.recoil) {
    const back = Math.floor(total / 3)
    atk.hp = Math.max(0, atk.hp - back)
    log.push(`${atk.name}も${back}のダメージを受けた`)
  }
  // 追加効果は相手が生きているときだけ
  if (def.hp > 0 && !def.status) {
    if (m.eff?.burn && rng() * 100 < m.eff.burn) { def.status = 'やけど'; log.push(`${def.name}はやけどした`) }
    else if (m.eff?.para && rng() * 100 < m.eff.para) { def.status = 'まひ'; log.push(`${def.name}はしびれた`) }
    else if (m.eff?.poison && rng() * 100 < m.eff.poison) { def.status = 'どく'; log.push(`${def.name}は毒を受けた`) }
  }
  if (def.hp > 0 && m.eff?.ail) applyAil(def, m.eff.ail, log, rng)
  if (def.hp > 0 && m.eff?.down) applyStage(def, m.eff.down.stat, -m.eff.down.n, log, def.name)
  if (def.hp > 0 && m.eff?.up && m.eff?.chance && rng() * 100 < m.eff.chance) {
    applyStage(atk, m.eff.up.stat, m.eff.up.n, log, atk.name)
  }
  // 強い技の代償。撃った自分のステが下がる
  if (m.eff?.downSelf) applyStage(atk, m.eff.downSelf.stat, -m.eff.downSelf.n, log, atk.name)
}

// ターンの終わりに状態異常で削る／ターン数を減らす
const tickStatus = (f, log) => {
  if (f.hp <= 0) return
  if (f.status === 'やけど' || f.status === 'どく') {
    const d = Math.max(1, Math.floor(f.maxHp / (f.status === 'どく' ? 8 : 16)))
    f.hp = Math.max(0, f.hp - d)
    log.push(`${f.name}は${f.status}で${d}受けた`)
  }
  if (hasAil(f, 'bleed')) {
    const d = Math.max(1, Math.floor(f.maxHp * BLEED_PER_STACK * f.ail.bleed.stacks))
    f.hp = Math.max(0, f.hp - d)
    log.push(`${f.name}は出血で${d}受けた`)
  }
  for (const key of PET_AIL_KEYS) {
    const a = f.ail?.[key]
    if (!a) continue
    a.turns -= 1
    if (a.turns <= 0) {
      delete f.ail[key]
      log.push(`${f.name}${AIL_OFF[key] || `の${petAilLabel(key)}が治った`}`)
    }
  }
}

// 相手が選ぶ技。★倍率がいちばん高い技を選ぶ（弱点を突いてくる）
export const chooseMove = (me, foe, rng = Math.random) => {
  const usable = me.moves.filter(s => s.pp > 0)
  if (!usable.length) return null
  const scored = usable.map(s => {
    const m = moveOf(s.name)
    if (!m) return { name: s.name, score: 0 }
    // サイレンス中は変化技が出せない＝選ばない
    if (m.kind === '変化') return { name: s.name, score: hasAil(me, 'silence') ? 0 : 25 + rng() * 10 }
    const mult = typeMult(m.type, foe.sp.types)
    const stab = me.sp.types.includes(m.type) ? STAB : 1
    return { name: s.name, score: m.pow * mult * stab * (m.acc / 100) + rng() * 10 }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].name
}

// ===== 1ターン進める =====
// me が moveName を使う。返り値は新しい状態（元は書き換えない）
export const battleTurn = (state, moveName, rng = Math.random) => {
  const s = JSON.parse(JSON.stringify(state))
  s.me.sp = state.me.sp     // 種族データは共有でよい（コピーすると重い）
  s.foe.sp = state.foe.sp
  const log = []
  if (s.over) return { ...s, log }

  const foeMove = chooseMove(s.foe, s.me, rng)
  const meFirst = (() => {
    const pri = (n) => (moveOf(n)?.eff?.priority || 0)
    const a = pri(moveName)
    const b = pri(foeMove)
    if (a !== b) return a > b
    const sa = statOf(s.me, 'agi') * (s.me.status === 'まひ' ? 0.5 : 1)
    const sb = statOf(s.foe, 'agi') * (s.foe.status === 'まひ' ? 0.5 : 1)
    return sa === sb ? rng() < 0.5 : sa > sb
  })()

  const order = meFirst ? [[s.me, s.foe, moveName], [s.foe, s.me, foeMove]]
    : [[s.foe, s.me, foeMove], [s.me, s.foe, moveName]]
  for (const [a, d, mv] of order) {
    if (a.hp <= 0 || d.hp <= 0) continue
    if (!mv) { log.push(`${a.name}は出せる技がない`); continue }
    act(a, d, mv, log, rng)
  }
  if (s.me.hp > 0 && s.foe.hp > 0) { tickStatus(s.me, log); tickStatus(s.foe, log) }

  s.turn += 1
  s.log = log
  if (s.me.hp <= 0 || s.foe.hp <= 0) {
    s.over = true
    s.win = s.foe.hp <= 0 && s.me.hp > 0
    log.push(s.win ? `${s.foe.name}をたおした！` : `${s.me.name}はたおれた…`)
  }
  return s
}

export const startBattle = (me, foe) => ({ me, foe, turn: 1, log: [], over: false, win: false })

// ============================================================
// 野生で出会う相手／仲間になる確率
// ------------------------------------------------------------
// ★LVが低いうちは1段目としか出会わない。最終進化や、進化しない強い種は
//   育ってから出てくる＝いきなり強い子が手に入らないようにするため
// ============================================================
export const wildPoolFor = (lv) => SPECIES.filter((s) => {
  if (s.legendary) return false        // ★伝説は野生には出ない（入手方法は未定）
  if (s.stages === 1) return lv >= 20          // 進化しない強い種
  if (s.stage === 0) return true
  if (s.stage === 1) return lv >= 16
  return lv >= 28                              // 最終進化
})

export const randomWild = (lv, rng = Math.random) => {
  const pool = wildPoolFor(lv)
  return pool[Math.floor(rng() * pool.length)] || SPECIES[0]
}

// 勝ったあとに仲間になる確率(%)。強い子ほど渋い
export const catchRate = (sp) =>
  (sp.stages === 1 ? 12 : sp.stage === 0 ? 35 : sp.stage === 1 ? 20 : 10)

export const rollCatch = (sp, rng = Math.random) => rng() * 100 < catchRate(sp)
