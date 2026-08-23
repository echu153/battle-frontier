// ============================================================
// v2 全スキルの総点検 — 「宣言どおりに発動するか」「壊れていないか」
// ------------------------------------------------------------
//   ① オート戦闘（battle.js）で1本ずつ200回撃つ：例外・NaN・0ダメージ・効果の発火
//   ② ATB（atb.js）でも同じ技を撃つ：ATB側だけ落ちる／効かない技を見つける
//   ③ 職ごとの通し確認：5枠を組めるか・パッシブが効くか・MPが足りるか
//   ④ 状態異常・バフ・回復・溜め・型など、仕組みごとの動作確認
//
//   node tools/v2-skill-check.mjs
// ============================================================
import fs from 'node:fs'
const B = new URL('../src/v2/lib/', import.meta.url).href
const { SKILLS, SKILL_CLASSES, skillsOf, passiveOf, isPassive, isBasicClass, mpOf, mpPctOf,
  SKILL_SET_SLOTS, validateSkillSet, targetMp, PASSIVE_EFFECT_KEYS } = await import(B + 'skills.js')
const { createSide, takeAction, runBattle, liveStats, tickBleedAfterAct, tickAil, tickRegen } = await import(B + 'battle.js')
const { CLASS_BONUS } = await import(B + 'classBonus.js')
const { STAT_KEYS } = await import(B + 'stats.js')
const { statsOf } = await import(B + 'enemies.js')
const { inflict, AIL_KEYS, hasAilment } = await import(B + 'ailments.js')
const { createAtb, step, needFor } = await import(B + 'atb.js')
const { dummyFoes } = await import(B + 'atbDummy.js')

const POWER = 20000
const TRIES = 200
const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const kindOf = (cls) => (CLASS_BONUS[cls]?.main === 'int_stat' ? 'mag' : 'phys')
const distFor = (cls) => {
  const b = CLASS_BONUS[cls] || {}
  const d = { hp:22, mp:6 }
  for (const k of ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']) d[k] = 8
  d[b.main || 'str'] += 16
  d[b.sub || 'agi'] += 8
  return d
}
const statsFor = (cls) => statsOf({ power: POWER, dist: distFor(cls) })
const wallStats = () => {
  const s = statsOf({ power: POWER, dist: { hp:22, mp:6, str:12, dex:12, agi:12, int_stat:12, vit:12, luk:12 } })
  s.hp = 10 ** 9
  return s
}
const IDLE = { name:'ぼんやり', kind:'buff', proc:100, mp:0, buff:{ self:{} }, priority:1, desc:'' }

const bad = []     // 不具合
const warn = []    // 気になるところ
const NG = (s, m) => bad.push(`${s.cls} **${s.name}**：${m}`)
const WARN = (s, m) => warn.push(`${s.cls} ${s.name}：${m}`)

// 宣言 → 出るはずのログ
const NEED = {
  ail:'ailment', drain:'drain', consumeAil:'consumeAil', dispel:'dispel', form:'form',
  ritual:'ritual', chargeUp:'charge', airUp:'air', buff:'buff', heal:'heal', regen:'regen',
  mpRegen:'mpRegen', stance:'stance', frenzy:'frenzy', foresight:'foresight', cure:'cure',
  bigGuard:'bigGuard',
}
// 仕込みが要るもの（相手や自分の状態を作らないと出ない）
const SETUP_ONLY = new Set(['consumeAil', 'dispel', 'cure'])

// ===== ① オート戦闘で1本ずつ =====
const measure = (cls, sk, setup) => {
  const rng = rngOf(4242)
  const me = createSide({ name:'me', cls, kind: kindOf(cls), stats: statsFor(cls), slots:[{ skill: sk, uses: 10 ** 6 }] })
  const foe = createSide({ name:'wall', cls:'戦士', kind:'phys', stats: wallStats(), slots:[{ skill: IDLE, uses: 10 ** 6 }] })
  const foeBase = { ...foe.buffs }
  const myBase = { ...me.buffs }
  const fired = {}
  const dmgs = []
  let misfire = 0, threw = null
  for (let i = 0; i < TRIES; i++) {
    foe.hp = 10 ** 9
    me.hp = me.base.hp
    me.mp = 10 ** 9
    foe.ail = {}
    me.ail = {}
    foe.buffs = { ...foeBase }
    me.buffs = { ...myBase }
    me.timedBuffs = []
    me.air = false
    me.ritual = 0
    me.charge = 0
    me.form = null
    me.lastKind = null
    me.lastSkill = null
    me.repeatCount = 0
    // ★素撃ち側は「軸が回っていない」状態をきちんと作る。
    //   同じ技を200回撃つので、放っておくと連打ボーナスや満タンが勝手に成立してしまう
    if (!setup && sk.highHpBonus) me.hp = Math.floor(me.base.hp * 0.5)
    if (setup) {
      for (let k = 0; k < 3; k++) inflict(foe.ail, 'bleed')
      if (sk.ail?.key !== 'poison') inflict(foe.ail, 'poison')
      foe.buffs.str = 30
      foe.buffs.agi = 20
      // ★自分への状態異常は cure の技のときだけ。鈍足はAGIを下げるので、
      //   AGI参照の技の威力まで変わってしまい「効果が伸びない」と誤検知する
      if (sk.cure) { inflict(me.ail, 'slow'); inflict(me.ail, 'healCut') }
      if (sk.lowHpBonus) foe.hp = foe.base.hp * 0.2
      if (sk.useRitual || sk.whileStack?.key === 'ritual') me.ritual = 2
      if (sk.useCharge || sk.whileStack?.key === 'charge') me.charge = 2
      if (sk.whileAir) me.air = true
      if (sk.form) me.form = sk.form
      if (sk.whileForm) me.form = 'hawk'
      if (sk.combo) me.lastSkill = sk.combo.after[0]
      if (sk.switchKind) me.lastKind = sk.kind === 'phys' ? 'mag' : 'phys'
      if (sk.repeat) { me.lastSkill = sk.name; me.repeatCount = sk.repeat.max - 1 }
    }
    const log = []
    try {
      takeAction(me, foe, rng, log, { idx: 0 })
      tickBleedAfterAct(me, log, foe)
      tickAil(me, log, foe)
    } catch (e) { threw = e; break }
    for (const l of log) {
      if (l.type === 'skill' || l.type === 'normal') {
        if (l.type === 'skill') dmgs.push(l.damage)
        if (l.drain) fired.drain = (fired.drain || 0) + 1
      } else if (l.type === 'misfire') misfire++
      else fired[l.type] = (fired[l.type] || 0) + 1
    }
  }
  return { fired, dmgs, misfire, threw }
}

for (const s of SKILLS) {
  const raw = measure(s.cls, s, false)
  const set = measure(s.cls, s, true)
  if (raw.threw || set.threw) { NG(s, '例外で落ちる → ' + (raw.threw || set.threw).message); continue }
  // 攻撃スキルはダメージが出ているか
  if (s.kind === 'phys' || s.kind === 'mag') {
    const d = raw.dmgs
    if (!d.length) { NG(s, `${TRIES}回撃って1度も当たらない（発動率${s.proc}%）`); continue }
    if (d.some(v => !Number.isFinite(v))) NG(s, 'ダメージが NaN／Infinity になる')
    if (d.some(v => v < 0)) NG(s, 'ダメージがマイナスになる')
    const hit = d.filter(v => v > 0)
    if (!hit.length) NG(s, '当たっても常に0ダメージ')
    else if (hit.length / d.length < 0.3) WARN(s, `当たっても0ダメージが多い（${Math.round((1 - hit.length / d.length) * 100)}%）`)
  }
  // 宣言した効果が出るか
  for (const [key, type] of Object.entries(NEED)) {
    const v = s[key]
    if (v === undefined || v === null || v === false) continue
    const src = SETUP_ONLY.has(key) ? set : raw
    if (!src.fired[type]) NG(s, `\`${key}\` を宣言しているのに${TRIES}回中1度も出ない`)
  }
  // 倍率に掛かる効果は「仕込むと伸びる」はず
  const GROW = ['lowHpBonus', 'highHpBonus', 'vsBuff', 'vsAil', 'repeat', 'switchKind',
    'combo', 'whileAir', 'whileForm', 'useRitual', 'useCharge']
  const avg = (a) => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : 0)
  for (const k of GROW) {
    if (!s[k]) continue
    if (k === 'whileAir' && !s.whileAir.mult) continue
    if (avg(set.dmgs) <= avg(raw.dmgs) * 1.01) NG(s, `\`${k}\` を仕込んでも威力が伸びない（${Math.round(avg(raw.dmgs))} → ${Math.round(avg(set.dmgs))}）`)
  }
  if (s.whileStack?.mult && avg(set.dmgs) <= avg(raw.dmgs) * 1.01) NG(s, '`whileStack.mult` を仕込んでも威力が伸びない')
  if (s.whileGround?.mult) {
    // 地上のほうが強いはず（setup は空中にしないので raw が地上）
    if (avg(raw.dmgs) <= 0) NG(s, '`whileGround` の技がダメージを出さない')
  }
  // MPを払えるか（想定利用MPの枠に収まるか）
  if (!s.mpPct && (s.mp || 0) > 0) {
    const budget = statsFor(s.cls).mp
    if (mpOf(s.cls, s) * 5 > budget) WARN(s, `MP${s.mp}×5枠が想定MP(${budget})を超える`)
  }
  // 説明文があるか
  if (!s.desc || !s.desc.trim()) NG(s, '説明文が空')
}

// ===== ② ATBでも同じ技が撃てるか =====
for (const s of SKILLS) {
  if (isPassive(s)) continue
  const cls = s.cls
  const me = { name:'me', cls, kind: kindOf(cls), stats: statsFor(cls), slots:[{ skill: s, uses: 999 }] }
  const foe = { name:'的', kind:'phys', stats: { ...wallStats(), hp: 10 ** 9 }, slots:[{ skill: IDLE, uses: 999 }] }
  try {
    const st = createAtb(me, foe, { rng: rngOf(11), maxSec: 60 })
    st.a.auto = true
    const need = needFor(st.a, s)
    if (!Number.isFinite(need) || need <= 0) NG(s, `ATBの必要ゲージが不正（${need}）`)
    let acted = 0
    while (!st.over && st.t < 60) {
      step(st, 0.05)
      acted = st.log.filter(l => l.side === 'me' && l.type !== 'hp').length
    }
    if (!acted) NG(s, 'ATBで60秒たっても1回も撃てない')
  } catch (e) {
    NG(s, 'ATBで例外 → ' + e.message)
  }
}

// ===== ③ 職ごとの通し =====
const classNotes = []
for (const cls of SKILL_CLASSES) {
  const list = skillsOf(cls)
  const want = isBasicClass(cls) ? 5 : 10
  if (list.length !== want) bad.push(`${cls}：枠に置ける技が${list.length}個（${want}個のはず）`)
  if (list.some(isPassive)) bad.push(`${cls}：パッシブが枠の候補に混ざっている`)
  const pas = passiveOf(cls)
  if (!isBasicClass(cls)) {
    if (!pas) bad.push(`${cls}：パッシブが無い`)
    else {
      const side = createSide({ cls, stats: statsFor(cls), slots: [] })
      const plain = createSide({ cls:'戦士', stats: statsFor(cls), slots: [] })
      const same = JSON.stringify(side.pa) === JSON.stringify(plain.pa) &&
        JSON.stringify(side.buffs) === JSON.stringify(plain.buffs)
      if (same) bad.push(`${cls}：パッシブ「${pas.name}」が何も変えていない`)
    }
  }
  // 5枠を組めるか（そのクラスの技だけで・想定MPに収まるか）
  const five = list.slice(0, SKILL_SET_SLOTS).map(s => ({ name: s.name, uses: 3 }))
  const names = new Set(list.map(s => s.name))
  const budget = statsFor(cls).mp
  const v = validateSkillSet(five, names, budget, cls)   // 問題なければ null、駄目なら理由の文字列
  if (v) bad.push(`${cls}：素直に5枠を組めない（${v}）`)
  // 転職回数の並び（初期5／転5:5）
  if (!isBasicClass(cls)) {
    const head = list.filter(s => !s.reqJobs).length
    const tail = list.filter(s => s.reqJobs === 5).length
    if (head !== 5 || tail !== 5) bad.push(`${cls}：初期${head}／転職5回以上${tail}（5・5のはず）`)
  }
  classNotes.push(`${cls}：枠${list.length}／パッシブ${pas ? pas.name : 'なし'}`)
}

// ===== ④ 仕組みごとの動作確認 =====
const checks = []
const CHECK = (name, ok, detail = '') => { checks.push({ name, ok, detail }); if (!ok) bad.push(`仕組み **${name}**：${detail || '動いていない'}`) }
{
  // サイレンス：発動率が下がる（不発が増える）
  const sk = { name:'検', cls:'戦士', kind:'phys', mult:1, proc:60, mp:0, desc:'' }
  const misfires = (silenced) => {
    const me = createSide({ name:'m', cls:'戦士', kind:'phys', stats: statsFor('戦士'), slots:[{ skill: sk, uses: 10 ** 6 }] })
    const foe = createSide({ name:'w', cls:'戦士', kind:'phys', stats: wallStats(), slots: [] })
    if (silenced) inflict(me.ail, 'silence')
    const rng = rngOf(31)
    let n = 0
    for (let i = 0; i < 600; i++) {
      const log = []
      me.mp = 10 ** 9
      foe.hp = 10 ** 9
      if (silenced) inflict(me.ail, 'silence')
      takeAction(me, foe, rng, log, { idx: 0 })
      if (log.some(l => l.type === 'misfire')) n++
    }
    return n
  }
  const off = misfires(false), on = misfires(true)
  CHECK('サイレンス（発動率-20%）', on > off * 1.2, `不発 ${off} → ${on}`)

  // サイレンス：ATBは必要ゲージが伸びる
  const me = createSide({ cls:'戦士', stats: statsFor('戦士'), slots:[{ skill: sk, uses:9 }] })
  const a = needFor(me, sk)
  inflict(me.ail, 'silence')
  const b = needFor(me, sk)
  CHECK('サイレンス（ATBは必要ゲージ）', b > a, `${a} → ${b}`)
}
{
  // 吸収の上限：最大HPの10%（クリなら15%）
  const drainer = { name:'吸', cls:'戦士', kind:'phys', mult:6, proc:100, mp:0, sureHit:true, noCrit:true, drain:1, desc:'' }
  const me = createSide({ name:'m', cls:'戦士', kind:'phys', stats: statsFor('戦士'), slots:[{ skill: drainer, uses:9 }] })
  const foe = createSide({ name:'w', cls:'戦士', kind:'phys', stats: wallStats(), slots: [] })
  me.hp = 1
  const log = []
  takeAction(me, foe, () => 0.5, log, { idx: 0 })
  const back = log.find(l => l.type === 'skill').drain
  CHECK('吸収の上限（最大HPの10%）', back <= Math.ceil(me.base.hp * 0.10) + 1, `1回で${back}／上限${Math.floor(me.base.hp * 0.1)}`)
}
{
  // 大防御：受けるダメージが減る／そのターンは追加行動が出ない
  const atk = { name:'殴', cls:'戦士', kind:'phys', mult:2, proc:100, mp:0, sureHit:true, noCrit:true, desc:'' }
  const guard = SKILLS.find(s => s.bigGuard)
  const taken = (withGuard) => {
    const me = createSide({ name:'me', cls:'聖騎士', stats: statsFor('聖騎士'), slots:[{ skill: guard, uses:9 }] })
    const foe = createSide({ name:'foe', cls:'戦士', stats: statsFor('戦士'), slots:[{ skill: atk, uses:9 }] })
    if (withGuard) takeAction(me, foe, () => 0.5, [], { idx: 0 })
    const log = []
    takeAction(foe, me, () => 0.5, log, { idx: 0 })
    return log.find(l => l.type === 'skill').damage
  }
  CHECK('大防御（受けるダメージが減る）', taken(true) < taken(false) * 0.5, `${taken(false)} → ${taken(true)}`)
}
{
  // 回復に先制が付いていない／補助には付いている
  const heals = SKILLS.filter(s => s.kind === 'heal')
  const buffs = SKILLS.filter(s => s.kind === 'buff')
  CHECK('回復に先制が付いていない', heals.every(s => !s.priority), heals.filter(s => s.priority).map(s => s.name).join(','))
  CHECK('補助は先制つき', buffs.every(s => s.priority === 1), buffs.filter(s => s.priority !== 1).map(s => s.name).join(','))
}
{
  // ATBでバフが重ならない
  const buff = SKILLS.find(s => s.kind === 'buff' && s.buff?.self && Object.values(s.buff.self).some(v => v > 0))
  const me = { name:'m', cls: buff.cls, kind:'phys', stats: statsFor(buff.cls), slots:[{ skill: buff, uses:99 }] }
  const foe = { name:'的', kind:'phys', stats:{ ...wallStats(), hp: 10 ** 9 }, slots: [] }
  const st = createAtb(me, foe, { rng: rngOf(3), maxSec: 120 })
  st.a.auto = true
  const key = Object.keys(buff.buff.self)[0]
  const base = st.a.buffs[key] || 0
  while (!st.over && st.t < 120) step(st, 0.05)
  const grew = (st.a.buffs[key] || 0) - base
  CHECK('ATBでバフが重ならない', grew <= Object.values(buff.buff.self)[0] + 0.01, `${buff.name} の ${key} が +${grew}`)
}
{
  // 出血は「行動した直後」に刻む
  const cut = { name:'裂', cls:'戦士', kind:'phys', mult:0.01, proc:100, mp:0, sureHit:true, noCrit:true, ail:{ key:'bleed', chance:100 }, desc:'' }
  const me = createSide({ name:'me', cls:'戦士', stats: statsFor('戦士'), slots:[{ skill: cut, uses:9 }] })
  const foe = createSide({ name:'foe', cls:'戦士', stats:{ ...statsFor('戦士'), hp: 10 ** 7 }, slots:[{ skill: IDLE, uses:9 }] })
  const l1 = []
  takeAction(me, foe, () => 0.01, l1, { idx: 0 })
  const onApply = l1.some(l => l.type === 'ailTick')
  const l2 = []
  takeAction(foe, me, () => 0.5, l2, { idx: 0 })
  tickBleedAfterAct(foe, l2, me)
  const onAct = l2.some(l => l.type === 'ailTick' && l.ail === '出血')
  CHECK('出血は行動した直後に刻む', !onApply && onAct, `付与時${onApply ? '刻んだ' : '刻まない'}／行動後${onAct ? '刻んだ' : '刻まない'}`)
}
{
  // 全職 × ATBの仮想ボスを通しで回す（落ちないか）
  let ng = 0
  for (const cls of SKILL_CLASSES) {
    const pas = passiveOf(cls)
    const slots = skillsOf(cls).slice(0, SKILL_SET_SLOTS).map(s => ({ skill: s, uses: 99 }))
    const me = { name: cls, cls, kind: kindOf(cls), stats: statsFor(cls), slots }
    try {
      const even = dummyFoes(me).find(f => f.key === 'even').make()
      const st = createAtb(me, even, { rng: rngOf(7), maxSec: 120 })
      st.a.auto = true
      while (!st.over && st.t < 120) step(st, 0.05)
      // オート戦闘でも1戦
      runBattle(me, { name:'的', kind:'phys', stats: statsFor('戦士'), slots:[{ skill: IDLE, uses:99 }] }, { rng: rngOf(9), maxTurns: 30 })
    } catch (e) {
      ng++
      bad.push(`${cls}：通し（ATB/オート）で例外 → ${e.message}`)
    }
    void pas
  }
  CHECK('全27職の通し（ATB120秒＋オート30ターン）', ng === 0, `${ng}職で例外`)
}
{
  // 状態異常が全種類ちゃんと入る／効く
  for (const k of AIL_KEYS) {
    const s = SKILLS.find(x => x.ail?.key === k)
    if (!s) { WARN({ cls:'—', name:k }, `この状態異常を撒く技が1本も無い`); continue }
    const me = createSide({ name:'m', cls: s.cls, kind: kindOf(s.cls), stats: statsFor(s.cls), slots:[{ skill: s, uses:99 }] })
    const foe = createSide({ name:'w', cls:'戦士', kind:'phys', stats: wallStats(), slots: [] })
    const rng = rngOf(17)
    let got = false
    for (let i = 0; i < 300 && !got; i++) {
      foe.ail = {}
      foe.hp = 10 ** 9
      me.mp = 10 ** 9
      takeAction(me, foe, rng, [], { idx: 0 })
      got = hasAilment(foe.ail, k)
    }
    CHECK(`状態異常「${k}」が入る`, got, got ? `${s.name} で確認` : `${s.name} で300回試しても入らない`)
  }
}

// ===== ⑤ データそのものの点検 =====
// ★打ち間違いは実戦だと「静かに何も起きない」だけで気づけない。
//   例：add に stat:'int' と書くと liveStats が 0 を返し、副参照がまるごと消える。
//   そこで「書いてよいキー・ステ名・状態異常名」を突き合わせる。
const SKILL_KEYS = new Set([
  'name', 'cls', 'kind', 'mult', 'add', 'hits', 'proc', 'mp', 'mpPct', 'desc', 'acc',
  'priority', 'reqJobs', 'src', 'noCrit', 'sureHit', 'sureCrit', 'hitBonus', 'defPen',
  'drain', 'drainIfAil', 'ail', 'ailPerHit', 'consumeAil', 'buff', 'buffTurns', 'heal',
  'regen', 'mpRegen', 'passive', 'stance', 'whileStance', 'foresight', 'frenzy', 'hpCostPct',
  'lowHpBonus', 'highHpBonus', 'vsBuff', 'vsAil', 'dispel', 'repeat', 'switchKind', 'variance',
  'combo', 'airUp', 'whileAir', 'whileGround', 'keepAir', 'rampHit', 'ritual', 'useRitual',
  'chargeUp', 'useCharge', 'whileStack', 'whileForm', 'form', 'formBuff', 'cure', 'bigGuard',
])
const STAT_SET = new Set(STAT_KEYS)
const AIL_SET = new Set(AIL_KEYS)
const FORM_SET = new Set(['hawk', 'bear', 'snake'])
const byName = new Map(SKILLS.map(x => [x.name, x]))
for (const s of SKILLS) {
  for (const k of Object.keys(s)) if (!SKILL_KEYS.has(k)) NG(s, `知らないキー \`${k}\`（打ち間違い？）`)
  for (const a of s.add || []) if (!STAT_SET.has(a.stat)) NG(s, `副参照のステ名が違う \`${a.stat}\``)
  if (s.src && !STAT_SET.has(s.src)) NG(s, `src のステ名が違う \`${s.src}\``)
  for (const side of ['self', 'enemy']) {
    for (const k of Object.keys(s.buff?.[side] || {})) if (!STAT_SET.has(k)) NG(s, `バフのステ名が違う \`${k}\``)
  }
  for (const k of ['ail', 'consumeAil', 'drainIfAil']) {
    if (s[k] && !AIL_SET.has(s[k].key)) NG(s, `状態異常の名前が違う \`${s[k].key}\``)
  }
  if (s.whileStack && !['ritual', 'charge'].includes(s.whileStack.key)) NG(s, `whileStack.key が違う \`${s.whileStack.key}\``)
  if (s.form && !FORM_SET.has(s.form)) NG(s, `form が違う \`${s.form}\``)
  for (const k of Object.keys(s.formBuff || {})) {
    if (k !== 'none' && !FORM_SET.has(k)) NG(s, `formBuff のキーが違う \`${k}\``)
    for (const st of Object.keys(s.formBuff[k])) if (!STAT_SET.has(st)) NG(s, `formBuff のステ名が違う \`${st}\``)
  }
  for (const n of s.combo?.after || []) if (!byName.has(n)) NG(s, `combo の相手が存在しない \`${n}\``)
  for (const k of Object.keys(s.passive || {})) if (!PASSIVE_EFFECT_KEYS.includes(k)) NG(s, `パッシブの知らないキー \`${k}\``)
  if (!isPassive(s)) {
    if (!(s.proc >= 1 && s.proc <= 100)) NG(s, `発動率が変（${s.proc}）`)
    if ((s.mp || 0) < 0) NG(s, '消費MPがマイナス')
    if ((s.hits || 1) < 1) NG(s, '多段数が0以下')
  }
  if (s.kind === 'phys' || s.kind === 'mag') {
    if (!(s.mult > 0)) NG(s, `倍率が0以下（${s.mult}）`)
  }
  for (const k of ['heal', 'regen', 'mpRegen']) if (s[k] && !(s[k].rate > 0)) NG(s, `${k} の量が0`)
}

// ===== ⑥ 「量」そのものの点検 =====
// ★倍率の打ち間違い（1.7 のつもりが 0.17）は、ダメージが1でも出てしまうので
//   「0ダメージか」だけでは見つからない。同じ戦闘力で出るはずの量と比べる
for (const s of SKILLS) {
  if (s.kind !== 'phys' && s.kind !== 'mag') continue
  const r = measure(s.cls, s, false)
  const hit = r.dmgs.filter(v => v > 0)
  const avg = hit.length ? hit.reduce((t, v) => t + v, 0) / hit.length : 0
  if (avg < 500) NG(s, `当たっても平均${Math.round(avg)}ダメージしか出ない（倍率の打ち間違い？）`)
}
// 回復スキルは実際にHP/MPが戻っているか（ログが出ていても量が0なら意味がない）
for (const s of SKILLS) {
  if (s.kind !== 'heal') continue
  const me = createSide({ name:'m', cls: s.cls, kind: kindOf(s.cls), stats: statsFor(s.cls), slots:[{ skill: s, uses:99 }] })
  const foe = createSide({ name:'w', cls:'戦士', kind:'phys', stats: wallStats(), slots: [] })
  me.hp = 1
  let back = 0
  for (let i = 0; i < 12; i++) {
    me.mp = Math.max(1, Math.floor(me.base.mp / 2))   // MPは払える程度に戻す（MP回復の伸びが見えるように）
    const mpBefore = me.mp
    const hpBefore = me.hp
    const log = []
    takeAction(me, foe, () => 0.2, log, { idx: 0, noProc: true })
    tickAil(me, log, foe)
    tickRegen(me, log, foe)   // 継続回復はターン終わりに戻る（runBattle / ATB と同じ）
    // ログの「戻した量」で見る（消費MPと相殺されて見えなくなるのを防ぐ）
    back += log.filter(l => l.type === 'heal' || l.type === 'regenTick').reduce((t, l) => t + (l.heal || 0), 0)
    back += log.filter(l => l.type === 'mpRegenTick').reduce((t, l) => t + (l.mp || 0), 0)
    void mpBefore; void hpBefore
  }
  if (back <= 0) NG(s, '回復スキルなのに12回使ってもHP/MPが1も戻らない')
}

// ===== 出力 =====
const out = []
const W = (t) => out.push(t)
W('# v2 全スキル総点検')
W('')
W(`対象 **${SKILLS.length}スキル**（枠に置ける技＋職業パッシブ）／1本あたり ${TRIES}回×2条件（素撃ち・軸を仕込んだ状態）。`)
W('オート戦闘（battle.js）とATB（atb.js）の**両方**に通している。')
W('')
W(bad.length ? `## ❌ 不具合 ${bad.length}件` : '## ✅ 不具合なし')
W('')
W(bad.length ? bad.map(t => '- ' + t).join('\n') : '- 全スキルが宣言どおりに発動し、例外・NaN・0ダメージ・無反応はゼロ。')
W('')
W('## 仕組みごとの確認')
W('')
W('| 確認したこと | 結果 | 実測 |')
W('|---|---|---|')
for (const c of checks) W(`| ${c.name} | ${c.ok ? '✅' : '❌'} | ${c.detail || '—'} |`)
W('')
if (warn.length) {
  W(`## ⚠ 気になるところ ${warn.length}件`)
  W('')
  W(warn.map(t => '- ' + t).join('\n'))
  W('')
}
fs.writeFileSync('_skill_check.md', out.join('\n'))
console.log(out.join('\n'))
console.log('\n--- _skill_check.md に書き出した ---')
void mpPctOf
void targetMp
void liveStats
void classNotes
