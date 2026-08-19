// ============================================================
// バトルフロンティアⅡ（リメイク版）— 武器の進化（戦闘記憶）
// ------------------------------------------------------------
// シャングリラ・フロンティアの武器進化を下敷きにした仕組み（2026-08-18 ユーザー提案）。
// **その武器を装備して戦い続けると熟練度が貯まり、節目でその個体だけの能力が付く。**
// 何が付くかは**どう戦ってきたか**で決まるので、同じ武器でも人によって別物になる。
//
// ★ユーザー決定
//   ・ルーンの刻印とは**別枠**。ソケットは食わない（運で集める／使い込んで得る）
//   ・**段階的に複数回**進化する（STAGES の節目ごとに1つ増える）
//   ・付く能力は**戦績から自動で決まる**（候補から選ばせない）
//   ・（2026-08-20）**バトルログをもっと細かく数えて、能力を100〜200種に細分化する**。
//     「クリティカル時、HPが1%減るが与ダメージ+20%」のような**代償つき**の形にする
//
// 構成
//   evolveAtoms.js  … 効果の部品50個（文面と、battle.js のどこへ効くか）
//   evolveTraits.js … 戦い方の軸26本と、能力159個（部品の組み合わせ）
//   このファイル    … 戦績の取り方・軸の強さ・何が付くか・戦闘用への畳み込み
//
// ⚠戦績を作るのはクライアント（戦闘自体がクライアントで回るため）。
//   サーバーは1戦闘あたりの増分に上限を掛けて受け取り、**能力の値はサーバーが計算し直す**
//   （クライアントが送るのは「どの能力か」と「偏りの強さ」だけ）。
// ============================================================
import { calcPower } from './stats.js'
import { ATOMS, atomText } from './evolveAtoms.js'
import { AXES, AXIS_BY_KEY, TRAITS, TRAIT_BY_KEY, axisScore, topFoe, needsFoe } from './evolveTraits.js'

export { ATOMS, AXES, TRAITS, TRAIT_BY_KEY, axisScore, topFoe, needsFoe }

// 熟練度の節目。ここに達すると能力が1つ増える
// ★出撃のクールタイムは10〜20秒なので、100戦で17〜33分ぶん。
//   「1本を使い込む」感を出すために、上の段はかなり遠くに置いてある。
export const STAGES = [100, 500, 2000]
export const MAX_STAGE = STAGES.length
// 段階ごとの「値の予算」。実際の値は これ × 偏りの強さ × 部品ごとの倍率
export const STAGE_CAP = [6, 10, 15]

export const stageOf = (battles = 0) => STAGES.filter(n => (battles || 0) >= n).length
export const nextStageAt = (battles = 0) => STAGES.find(n => (battles || 0) < n) ?? null

// ===== 戦績 =====
// ★1戦ごとにこの形で積む。キーを増やすときは SQL の v2_weapon_record の上限表も一緒に直すこと
export const emptyRecord = () => ({
  battles: 0,      // 戦った回数（＝熟練度）
  turns: 0,        // 決着までのターンの合計
  wins: 0,
  // 攻撃
  hits: 0,         // 当てた回数
  crit: 0,         // そのうちクリティカル
  physHits: 0,     // 物理で当てた
  magHits: 0,      // 魔法で当てた
  skillHits: 0,    // スキルで当てた
  normalHits: 0,   // 通常攻撃で当てた
  multiHits: 0,    // 多段スキルで当てた
  drains: 0,       // 吸収した回数
  // 防御
  taken: 0,        // 受けた攻撃の回数（外れ含む）
  dodged: 0,       // そのうちかわした
  hurtPct: 0,      // 1戦ごとの「失ったHPの割合(0〜1)」の合計
  // 状態異常
  ail: 0,          // 入れた回数
  ailed: 0,        // かかった回数
  ailTicks: 0,     // 継続ダメージが相手に入った回数
  // 支援・行動
  heals: 0,        // 回復スキルを使った回数
  buffs: 0,        // バフスキルを使った回数
  misfires: 0,     // 不発の回数
  extras: 0,       // 追加行動の回数
  firsts: 0,       // 先に動いた戦闘数
  mpEmpty: 0,      // MPを使い切って終わった戦闘数
  // 決着のしかた
  lowWin: 0,       // 残HP30%以下で勝った
  bigWin: 0,       // 戦闘力が上の相手に勝った
  bossWin: 0,      // ボスに勝った
  fastWin: 0,      // 5ターン以内で勝った
  longWin: 0,      // 15ターン以上かけて勝った
  perfect: 0,      // 無傷で勝った
  comeback: 0,     // 一度25%以下まで削られてから勝った
  overkill: 0,     // 相手の最大HPの25%以上を超過して倒した
  foes: {},        // 倒した敵の名前ごとの回数
})

export const LOW_HP_PCT   = 30   // 「薄氷の勝ち」と数える残HPの割合
export const PINCH_PCT    = 25   // 「逆転」と数える、途中で落ちたHPの割合
export const OVERKILL_PCT = 25   // 「過剰火力」と数える超過ダメージの割合
export const FAST_TURNS   = 5    // これ以内で勝てば速攻
export const LONG_TURNS   = 15   // これ以上かかれば長期戦
export const MP_EMPTY_PCT = 5    // 残MPがこれ以下なら「使い切った」
export const FOES_KEEP    = 12   // 敵の記録は上位いくつまで持つか

const pctOf = (v, max) => (max > 0 ? (v / max) * 100 : 0)

// 1戦ぶんの戦績を戦闘ログから作る。r … runBattle の返り値
//   opt.isBoss … その戦闘の相手がボスか（出撃だけ true になりうる）
export const recordOfBattle = (r, you, foe, opt = {}) => {
  const rec = emptyRecord()
  if (!r) return rec
  // 戦闘力は返り値から出せる（呼び出し側に計算させない＝入れ忘れが起きない）
  const myPower  = opt.myPower  ?? calcPower(r.a?.base || {})
  const foePower = opt.foePower ?? calcPower(r.b?.base || {})
  const win = r.winner === 'a'
  const maxHp = Math.max(1, r.a?.base?.hp || 1)
  const maxMp = Math.max(1, r.a?.base?.mp || 1)

  rec.battles = 1
  rec.turns = r.turns || 0

  let firstSide = null
  let lowest = 100
  for (const l of r.log || []) {
    if (l.type === 'hp') { lowest = Math.min(lowest, pctOf(l.a, l.aMax || maxHp)); continue }
    const mine = l.side === you
    if (firstSide === null && l.side) firstSide = l.side

    if (l.type === 'skill' || l.type === 'normal') {
      const hit = l.type === 'skill' ? l.hits > 0 : !!l.hit
      if (mine) {
        if (!hit) continue
        rec.hits++
        if (l.crit) rec.crit++
        if (l.kind === 'mag') rec.magHits++; else rec.physHits++
        if (l.type === 'skill') {
          rec.skillHits++
          if ((l.of || 1) > 1) rec.multiHits++
          if (l.drain > 0) rec.drains++
        } else {
          rec.normalHits++
        }
      } else {
        rec.taken++
        if (!hit) rec.dodged++
      }
    } else if (l.type === 'ailment') {
      // side は「かかった側」
      if (mine) rec.ailed++; else rec.ail++
    } else if (l.type === 'ailTick') {
      if (!mine) rec.ailTicks++
    } else if (mine) {
      if (l.type === 'heal' || l.type === 'regen') rec.heals++
      else if (l.type === 'buff') rec.buffs++
      else if (l.type === 'misfire') rec.misfires++
      else if (l.type === 'extra') rec.extras++
    }
  }

  if (firstSide === you) rec.firsts = 1
  const endHp = Math.max(0, r.a?.hp ?? 0)
  rec.hurtPct = Math.max(0, Math.min(1, 1 - endHp / maxHp))
  if (pctOf(r.a?.mp ?? maxMp, maxMp) <= MP_EMPTY_PCT) rec.mpEmpty = 1

  if (win) {
    rec.wins = 1
    if (foe) rec.foes[foe] = 1
    if (pctOf(endHp, maxHp) <= LOW_HP_PCT) rec.lowWin = 1
    if (foePower > myPower) rec.bigWin = 1
    if (opt.isBoss) rec.bossWin = 1
    if (rec.turns <= FAST_TURNS) rec.fastWin = 1
    if (rec.turns >= LONG_TURNS) rec.longWin = 1
    if (endHp >= maxHp) rec.perfect = 1
    if (lowest <= PINCH_PCT) rec.comeback = 1
    const over = -(r.b?.hp ?? 0)
    if (pctOf(over, Math.max(1, r.b?.base?.hp || 1)) >= OVERKILL_PCT) rec.overkill = 1
  }
  return rec
}

// 戦績を足し合わせる。敵の記録は上位 FOES_KEEP 件だけ残す
export const mergeRecord = (base, add) => {
  const out = { ...emptyRecord(), ...(base || {}) }
  for (const k of Object.keys(emptyRecord())) {
    if (k === 'foes') continue
    out[k] = (Number(out[k]) || 0) + (Number(add?.[k]) || 0)
  }
  const foes = { ...(out.foes || {}) }
  for (const [name, n] of Object.entries(add?.foes || {})) foes[name] = (foes[name] || 0) + n
  out.foes = Object.fromEntries(
    Object.entries(foes).sort((a, b) => b[1] - a[1]).slice(0, FOES_KEEP))
  return out
}

// ===== 何が付くか =====
// 部品ごとの「持ち主」の軸。**その部品が活きる戦い方**を指す（無いものは中立）
export const ATOM_AXIS = {
  critRate:'crit', critDmg:'crit', critHpCost:'crit', critHpHeal:'crit',
  critMpHeal:'crit', critMpCost:'crit', critAil:'crit',
  eva:'eva', evaLow:'eva', onDodgeHeal:'eva', onDodgeAgi:'eva', dmgDodge:'eva',
  cut:'tank', cutLow:'tank', cutPhys:'tank', cutMag:'tank', taken:'tank',
  onHurtStr:'tank', onHurtMp:'tank', dmgHurt:'tank', guts:'tank',
  ailRate:'ail', ailDmg:'ail', dmgAil:'ail', ailDrain:'ail',
  ailResist:'ailed', ailWeak:'ailed',
  heal:'heal', proc:'buff', dmgCombo:'buff',
  mpCost:'mpBurn', mpRegen:'mpBurn', onHitMp:'mpBurn', st_mp:'mpBurn',
  dmgNormal:'thrift',
  dmgPhys:'phys', st_str:'phys',
  dmgMag:'mag', st_int_stat:'mag',
  dmgMulti:'multi', onHitHeal:'multi',
  dmgFirst:'swift', dmgFull:'swift',
  dmgLate:'long', regen:'long',
  dmgLow:'lowHp', dmgBig:'giant', dmgFoe:'slayer', dmgBoss:'boss',
  drain:'drain', misfireDmg:'misfire',
  extra:'extra', st_agi:'extra', first:'first',
  dmg:'overkill', dmgSmall:'overkill', defPen:'overkill',
  dmgHigh:'perfect',
}

export const SAME_AXIS_PENALTY = 0.75  // 2つ目以降、同じ軸から続けて付くのを少しだけ抑える

// その能力が「どれだけその人のものか」。0〜1
// ＝ 軸の強さ × 部品の噛み合い
// ★噛み合いを見るとき、**その能力自身の軸に属する部品は数えない**（中立の0.5で置く）。
//   数えてしまうと「クリティカル率+%」のような素直な能力が常に最強になり、
//   同じ軸の中で2つめの偏り（瀕死で勝ちがち・被弾が多い…）が意味を持たなくなる。
export const traitScore = (rec, trait, usedAxes = []) => {
  const base = axisScore(rec, AXIS_BY_KEY[trait.axis])
  if (base <= 0) return 0
  const parts = [...(trait.gain || []), ...(trait.cost || [])]
  let sum = 0
  for (const [atom] of parts) {
    const ax = ATOM_AXIS[atom]
    sum += (ax && ax !== trait.axis) ? axisScore(rec, AXIS_BY_KEY[ax]) : 0.5
  }
  const fit = parts.length ? sum / parts.length : 0.5
  const pen = usedAxes.includes(trait.axis) ? SAME_AXIS_PENALTY : 1
  return base * (0.5 + 0.5 * fit) * pen
}

// いま何が付くか。already は既に付いている能力のキー
// ★同点なら名簿の並び順で決める（毎回同じ結果になる＝運ではない）
export const pickTrait = (rec, already = []) => {
  const used = (already || []).map(k => TRAIT_BY_KEY[k]?.axis).filter(Boolean)
  const hasFoe = topFoe(rec) > 0
  let best = null
  for (const t of TRAITS) {
    if ((already || []).includes(t.key)) continue
    if (needsFoe(t) && !hasFoe) continue
    const s = traitScore(rec, t, used)
    if (s > 0 && (!best || s > best.s)) best = { trait: t, s }
  }
  return best
}

// 部品1つぶんの値
export const atomValue = (cap, s, w) => Math.max(0.1, Math.round(cap * s * w * 10) / 10)

// その能力の効果表 { 部品キー: 値 }。cap は段階ごとの予算
export const buildEffect = (trait, cap, s) => {
  const eff = {}
  for (const [atom, w] of [...(trait.gain || []), ...(trait.cost || [])]) {
    eff[atom] = atomValue(cap, s, w)
  }
  return eff
}

// 進化1つぶんの中身を作る。stage は1始まり
export const makeEvolution = (rec, stage, already = []) => {
  const picked = pickTrait(rec, already)
  if (!picked) return null
  const st = Math.min(STAGE_CAP.length, Math.max(1, stage))
  const cap = STAGE_CAP[st - 1]
  const s = Math.max(0, Math.min(1, picked.s))
  const out = { stage: st, key: picked.trait.key, s: Math.round(s * 1000) / 1000, eff: buildEffect(picked.trait, cap, s) }
  if (needsFoe(picked.trait)) {
    const top = Object.entries(rec.foes || {}).sort((a, b) => b[1] - a[1])[0]
    if (!top) return null
    out.foe = top[0]
  }
  return out
}

// いま付けられる進化があるか。evolutions は既に付いている配列
export const pendingStage = (rec, evolutions = []) => {
  const have = (evolutions || []).length
  const can = stageOf(rec?.battles || 0)
  return can > have ? have + 1 : 0
}

// ===== 表示 =====
// 得と代償を分けて1行ずつ返す。[{ text, cost }]
export const evolutionLines = (ev) => {
  const t = TRAIT_BY_KEY[ev?.key]
  if (!t) return []
  const out = []
  const push = (list, cost) => {
    for (const [atom] of list || []) {
      const v = ev.eff?.[atom]
      if (v === undefined) continue
      let text = atomText(atom, v, cost)
      if (atom === 'dmgFoe' && ev.foe) text = text.replace('特定の相手', ev.foe)
      if (text) out.push({ text, cost })
    }
  }
  push(t.gain, false)
  push(t.cost, true)
  return out
}

// 「紅蓮の一閃：クリティカルの与ダメージ+18%／クリティカル時に最大HPの1.1%を失う」
export const evolutionText = (ev) => {
  const t = TRAIT_BY_KEY[ev?.key]
  if (!t) return ''
  const lines = evolutionLines(ev)
  if (!lines.length) return t.name
  return `${t.name}：${lines.map(l => l.text).join('／')}`
}

export const evolutionName = (ev) => TRAIT_BY_KEY[ev?.key]?.name || ''

// ============================================================
// ここから下は「戦闘に効かせる側」。battle.js から使う
// ============================================================

// 空の効果表。★battle.js は必ずこの形を受け取る（進化が無くても undefined を見ない）
export const emptyEffects = () => ({
  stat: {},                       // ステータス%（職業補正と同じ土俵で足される）
  critRate: 0, critDmg: 0, eva: 0, hit: 0, evaLow: 0, guts: 0, defPen: 0,
  dmg: { always:0, low:0, high:0, full:0, first:0, late:0, big:0, small:0, boss:0,
         phys:0, mag:0, skill:0, normal:0, multi:0, ail:0, afterDodge:0, afterHurt:0, combo:0 },
  dmgFoe: {},
  cut: { always:0, low:0, phys:0, mag:0 }, taken: 0,
  onCrit: { hpCost:0, hpHeal:0, mpHeal:0, mpCost:0, ail:0 },
  onHit:  { hpHeal:0, mpHeal:0 },
  onDodge:{ hpHeal:0, agi:0 },
  onHurt: { str:0, mpHeal:0 },
  ail: { rate:0, dmg:0, resist:0, weak:0, drain:0 },
  heal: 0, drain: 0, regen: 0, mpCost: 0, mpRegen: 0,
  proc: 0, extra: 0, first: 0, misfireDmg: 0,
})

const addAt = (out, slot, v) => {
  const [a, b] = slot.split('.')
  if (b === undefined) out[a] += v
  else out[a][b] += v
}

// 装備している武器に付いている進化を、戦闘が読める1つのまとめに畳む。
// ★複数の武器（右手・左手）に付いていれば**足し算**になる
export const collectEvolutions = (list) => {
  const out = emptyEffects()
  for (const ev of list || []) {
    const t = TRAIT_BY_KEY[ev?.key]
    if (!t) continue
    const costs = new Set((t.cost || []).map(([a]) => a))
    for (const [atom, raw] of Object.entries(ev.eff || {})) {
      const def = ATOMS[atom]
      if (!def) continue
      const v = Number(raw) || 0
      if (!v) continue
      if (def.slot === 'stat') {
        const sign = costs.has(atom) ? -1 : 1
        out.stat[def.stat] = (out.stat[def.stat] || 0) + v * sign
      } else if (atom === 'dmgFoe') {
        if (ev.foe) out.dmgFoe[ev.foe] = (out.dmgFoe[ev.foe] || 0) + v
      } else if (costs.has(atom) && (atom === 'dmg' || atom === 'dmgPhys' || atom === 'dmgMag'
                 || atom === 'dmgSkill' || atom === 'eva' || atom === 'hit'
                 || atom === 'heal' || atom === 'mpCost' || atom === 'proc' || atom === 'critRate')) {
        // 代償として付いた「−側」の部品。同じ枠へマイナスで入れる
        addAt(out, def.slot, -v)
      } else {
        addAt(out, def.slot, v)
      }
    }
  }
  return out
}

// 疾き刃が乗る「最初の◯回の行動」／遅咲きが乗る「◯回目以降」
// ★ターン数ではなく**自分が行動した回数**で数える。オート戦闘とATBで数え方を揃えるため
export const EVO_FIRST_MOVES = 3
export const EVO_LATE_MOVES  = 6
export const EVO_COMBO_MAX   = 10   // 積み重ねの上限（回）
export const EVO_HIGH_HP_PCT = 70   // 「HPが高い」と数える割合
export const EVO_STACK_MAX   = 5    // かわすたび／被弾するたびの積み上げ上限（回）

// 状況で乗る与ダメージ+%の合計。乗らない条件のものは0
export const evoDmgPct = (evo, ctx = {}) => {
  if (!evo) return 0
  const {
    hpPct = 100, foeBigger = false, foeSmaller = false, foeBoss = false, moves = 999,
    foeName = null, kind = 'phys', skill = false, multi = false, foeAiled = false,
    justDodged = false, justHurt = false, combo = 0,
  } = ctx
  const d = evo.dmg
  let pct = d.always
  if (hpPct <= LOW_HP_PCT) pct += d.low
  if (hpPct >= EVO_HIGH_HP_PCT) pct += d.high
  if (hpPct >= 100) pct += d.full
  if (moves <= EVO_FIRST_MOVES) pct += d.first
  if (moves >= EVO_LATE_MOVES) pct += d.late
  if (foeBigger) pct += d.big
  if (foeSmaller) pct += d.small
  if (foeBoss) pct += d.boss
  pct += kind === 'mag' ? d.mag : d.phys
  pct += skill ? d.skill : d.normal
  if (multi) pct += d.multi
  if (foeAiled) pct += d.ail
  if (justDodged) pct += d.afterDodge
  if (justHurt) pct += d.afterHurt
  if (d.combo) pct += d.combo * Math.min(EVO_COMBO_MAX, Math.max(0, combo))
  if (foeName && evo.dmgFoe[foeName]) pct += evo.dmgFoe[foeName]
  return pct
}

// 受けるときの軽減%（0〜）。被ダメージ+の代償はここでマイナスに効く
export const evoCutPct = (evo, { hpPct = 100, kind = 'phys' } = {}) => {
  if (!evo) return 0
  let pct = evo.cut.always - evo.taken
  if (hpPct <= LOW_HP_PCT) pct += evo.cut.low
  pct += kind === 'mag' ? evo.cut.mag : evo.cut.phys
  return pct
}
