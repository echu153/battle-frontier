// ============================================================
// v2 実戦バランス確認 — 全235スキルを**実際の戦闘エンジンで**回す
// ------------------------------------------------------------
//   ① 素撃ち（軸を回していない状態）の1手あたり実ダメージ
//   ② 軸が回っている状態（出血を撒いた・呪力を溜めた・型を合わせた…）の1手
//   ③ 宣言した効果がちゃんと発火しているか
//   ④ 職ごとの実戦力（ベスト5編成で同格と20戦／ATBで仮想ボスを90秒）
// ============================================================
import fs from 'node:fs'
const B = new URL('../src/v2/lib/', import.meta.url).href
const { SKILL_CLASSES, skillsOf, isPassive, mpOf, SKILL_BY_NAME } = await import(B + 'skills.js')
const { createSide, takeAction, runBattle } = await import(B + 'battle.js')
const { CLASS_BONUS } = await import(B + 'classBonus.js')
const { statsOf, ENEMY_SKILLS } = await import(B + 'enemies.js')
const { inflict } = await import(B + 'ailments.js')
const { createAtb, step } = await import(B + 'atb.js')
const { dummyFoes } = await import(B + 'atbDummy.js')

const POWER = 20000
const TRIALS = 400
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
const IDLE = { name:'ぼんやり', kind:'buff', proc:100, mp:0, buff:{ self:{} }, priority:1, desc:'' }
const wallStats = () => {
  const s = statsOf({ power: POWER, dist: { hp:22, mp:6, str:12, dex:12, agi:12, int_stat:12, vit:12, luk:12 } })
  s.hp = 10 ** 9
  return s
}

// ===== 1スキルの実測 =====
//   setup=false … 素撃ち（何も仕込まない）
//   setup=true  … その技の軸が回っている状態を毎回作ってから撃つ
const measure = (cls, sk, passive, setup) => {
  const rng = rngOf(12345)
  const slots = [{ skill: sk, uses: 10 ** 6 }]
  if (passive) slots.push({ skill: passive, uses: 1 })
  const me = createSide({ name:'me', cls, kind: kindOf(cls), stats: statsFor(cls), slots })
  const foe = createSide({ name:'wall', cls:'戦士', kind:'phys', stats: wallStats(), slots:[{ skill: IDLE, uses: 10 ** 6 }] })
  const baseBuffs = { ...foe.buffs }
  const myBase = { ...me.buffs }
  let dmg = 0, hit = 0, misfire = 0, heal = 0
  const fired = {}
  const bump = (k) => { fired[k] = (fired[k] || 0) + 1 }
  for (let i = 0; i < TRIALS; i++) {
    foe.hp = 10 ** 9
    me.hp = me.base.hp
    me.mp = 10 ** 9
    foe.ail = {}
    foe.buffs = { ...baseBuffs }
    me.buffs = { ...myBase }
    me.timedBuffs = []
    if (setup) {
      // 相手側の仕込み：出血3・毒・プラスのバフ2つ（起爆／状態異常特効／バフ剥がし・バフ特効）
      for (let k = 0; k < 3; k++) inflict(foe.ail, 'bleed')
      if (sk.ail?.key !== 'poison') inflict(foe.ail, 'poison')
      foe.buffs.str = 30; foe.buffs.agi = 20
      if (sk.lowHpBonus) foe.hp = foe.base.hp * 0.2          // 追い討ち：相手が瀕死
      // 自分側の仕込み
      if (sk.useRitual) me.ritual = 2
      if (sk.useCharge) me.charge = 2
      if (sk.whileAir) me.air = true
      if (sk.form) me.form = sk.form                          // 同じ獣を続けて呼ぶ
      if (sk.combo) me.lastSkill = sk.combo.after[0]          // 噛み合う技のあと
      if (sk.switchKind) me.lastKind = sk.kind === 'phys' ? 'mag' : 'phys'
      if (sk.repeat) me.repeatCount = sk.repeat.max
      if (sk.highHpBonus) me.hp = me.base.hp                  // 満タン
    }
    const log = []
    takeAction(me, foe, rng, log, { idx: 0 })
    for (const l of log) {
      if (l.type === 'skill') { dmg += l.damage || 0; if (l.damage > 0) hit++; if (l.drain) bump('drain') }
      else if (l.type === 'misfire') misfire++
      else if (l.type === 'heal' || l.type === 'regen') { heal += l.heal || 1; bump(l.type) }
      else bump(l.type)
    }
  }
  return {
    cls, name: sk.name, kind: sk.kind, proc: sk.proc ?? 100, mp: mpOf(cls, sk), setup,
    avg: dmg / TRIALS, hitRate: hit / TRIALS, misfire: misfire / TRIALS,
    perMp: dmg / TRIALS / Math.max(1, mpOf(cls, sk)), heal: heal / TRIALS, fired,
  }
}

const BASIC = ['ノーブル', '戦士', '弓使い', '魔法使い', '僧侶', '格闘家', 'サモナー']
const raw = [], set = []
for (const cls of SKILL_CLASSES) {
  const pas = skillsOf(cls).find(isPassive)
  for (const sk of skillsOf(cls)) {
    if (isPassive(sk)) continue
    raw.push(measure(cls, sk, pas, false))
    set.push(measure(cls, sk, pas, true))
  }
}
const setOf = (cls, name) => set.find(r => r.cls === cls && r.name === name)

// ===== 職ごとの編成 =====
const bestFive = (cls) => {
  const rs = raw.filter(r => r.cls === cls)
  const score = new Map(rs.map(r => [r.name, Math.max(r.avg, setOf(cls, r.name).avg * 0.7)]))
  return skillsOf(cls).filter(s => !isPassive(s))
    .sort((a, b) => (score.get(b.name) || 0) - (score.get(a.name) || 0)).slice(0, 5)
}
const classFighter = (cls) => {
  const pas = skillsOf(cls).find(isPassive)
  const slots = bestFive(cls).map(s => ({ skill: s, uses: 99 }))
  if (pas) slots.push({ skill: pas, uses: 1 })
  return { name: cls, cls, kind: kindOf(cls), stats: statsFor(cls), slots }
}
const rival = {
  name:'同格', kind:'phys',
  stats: statsOf({ power: POWER, dist: { hp:24, mp:8, str:16, dex:10, agi:10, int_stat:10, vit:16, luk:6 } }),
  slots: ['こんぼう', 'ちからため', 'ほねきり', 'いわなげ', '天穿雷撃'].map(k => ({ skill: ENEMY_SKILLS[k], uses: 99 })),
}
const atbRun = (fighter, foe, sec, seed) => {
  const st = createAtb(fighter, foe, { rng: rngOf(seed), maxSec: sec })
  st.a.auto = true
  const hp0 = st.b.hp
  let seen = 0, direct = 0, dot = 0
  while (!st.over && st.t < sec) {
    step(st, 0.05)
    for (; seen < st.log.length; seen++) {
      const l = st.log[seen]
      // 「skill/normal」は撃った側の名前、「ailTick」は受けた側の名前で出る
      if ((l.type === "skill" || l.type === "normal") && l.side === st.a.name) direct += l.damage || 0
      else if (l.type === "ailTick" && l.side === st.b.name) dot += l.damage || 0
    }
  }
  return { dealt: hp0 - Math.max(0, st.b.hp), hp0, direct, dot,
    myHp: Math.max(0, st.a.hp) / st.a.base.hp, t: st.t, alive: st.a.hp > 0 }
}

// ================= 出力 =================
const out = []
const W = (s) => out.push(s)
W('# v2 実戦バランス確認（実エンジンでの自動計測）')
W('')
W(`戦闘力 **${POWER.toLocaleString()}** ／ 1スキルあたり **${TRIALS}回** ／ ステは各職の職業補正（main/sub）に沿って配分。`)
W('数値は**不発・命中・クリティカル・特殊効果ぜんぶ込みの1手あたり実ダメージ**。')
W('')
W('- **素撃ち** … 何も仕込まずに撃ったとき')
W('- **軸あり** … その技の軸が回っている状態（出血3スタック／相手にバフ2つ／呪力・竜気2つ／型が合っている／コンボが噛み合っている／相手が瀕死）')
W('')

// ===== クリティカルの崖を実測する =====
// クリ率 = 5% + LUK差/100 × 10%（上限50%）。**LUK「差」の絶対値**で決まるので、
// 戦闘力が上がって差が数千になると 1% か 50% かの二択になる
const critProbe = () => {
  const wall = wallStats()
  const sk = { name:'検', kind:'phys', mult:2.0, proc:100, mp:0, desc:'' }
  const out = []
  for (const luk of [800, 1600, 2400, 2800, 3200, 4800]) {
    const st = statsOf({ power: POWER, dist: { hp:22, mp:6, str:24, dex:8, agi:8, int_stat:8, vit:8, luk:8 } })
    st.luk = luk
    const me = createSide({ name:'m', cls:'戦士', kind:'phys', stats: st, slots:[{ skill: sk, uses: 10 ** 6 }] })
    const foe = createSide({ name:'w', cls:'戦士', kind:'phys', stats: wall, slots: [] })
    const rng = rngOf(5)
    let d = 0, crit = 0
    for (let i = 0; i < 3000; i++) {
      foe.hp = 10 ** 9
      me.mp = 10 ** 9
      const log = []
      takeAction(me, foe, rng, log, { idx: 0 })
      const l = log.find(x => x.type === 'skill')
      d += l?.damage || 0
      if (l?.crit) crit++
    }
    out.push({ luk, avg: d / 3000, crit: crit / 3000 })
  }
  return out
}
const crits = critProbe()

// ===== まとめ（直すべき順）=====
W('## まとめ — 直すべき順')
W('')
W('| # | 見つかったこと | どれくらい | 効く場所 |')
W('|---|---|---|---|')
{
  const bossHp = Math.round(96 * POWER * Math.pow(POWER / 2000, 0.22))
  const poisonTick = Math.floor(bossHp * 0.03)
  const bleedTick = Math.floor(bossHp * 0.01 * 5)
  const ups = SKILL_CLASSES.filter(c => !BASIC.includes(c))
  const a5 = ups.map(c => {
    const rs = set.filter(r => r.cls === c && (r.kind === 'phys' || r.kind === 'mag'))
    return rs.sort((x, y) => y.avg - x.avg).slice(0, 5).reduce((t, r) => t + r.avg, 0) / 5
  }).sort((x, y) => x - y)
  const lo = crits.find(c => c.luk === 1600), hi = crits.find(c => c.luk === 3200)
  W(`| 1 | ✅**修正済** クリティカル率を LUK の「比」で決めるようにした（旧：LUK差の絶対値／5%＋差÷100×10%）。戦闘力が上がるとクリ率が1%か50%かの二択になっていた | 壁(LUK${Math.round(wallStats().luk).toLocaleString()})に対して LUK${lo.luk}→クリ${(lo.crit * 100).toFixed(1)}% ／ LUK${hi.luk}→クリ${(hi.crit * 100).toFixed(1)}%（旧は1.1%と48.1%） | 全戦闘 |`)
  W(`| 2 | ✅**修正済** 出血・毒の1刻みに「付けた側の攻撃力から決まる上限」を入れた | 上限なしなら戦闘力${POWER.toLocaleString()}のボス(HP${bossHp.toLocaleString()})で 毒1刻み${poisonTick.toLocaleString()}／出血5スタック${bleedTick.toLocaleString()}（直接攻撃は7,000〜13,000）。同格の敵には上限が届かないので、ふつうの出撃の出目は変わらない | ATB・ユニークボス・レイド |`)
  W('| 3 | 仮想ボス【等速】に対して**上位職20職すべてが30秒前後で全滅** | 1挑戦1時間の想定に対し、こちらが1分ももたない | ATB・ユニークボス |')
  W(`| 4 | **攻撃技が参照するステと、職業補正のmainが噛み合っていない職がある** | 5枠平均で最大${(a5[a5.length - 1] / a5[0]).toFixed(2)}倍の差 | 全戦闘 |`)
  W('| 5 | 同じ発動率の帯の中に±25%を超える外れ値が多数 | 原因はほぼ1と4（値段表は倍率しか見ていない） | 全戦闘 |')
  W('| 6 | バフの重ねがけに上限が無い（applyBuff は下限だけ） | 短い戦闘では出ないが、長期戦で青天井 | 長期戦・タワー系 |')
}
W('')
W('### 1の中身（クリティカル率とLUK）')
W('')
W('| 自分のLUK | クリ率 | 平均ダメージ |')
W('|---:|---:|---:|')
for (const c of crits) W(`| ${c.luk.toLocaleString()} | ${(c.crit * 100).toFixed(1)}% | ${Math.round(c.avg).toLocaleString()} |`)
W('')
W('**いまの式（比）での実測**。旧式（差）では LUK1,600→1.1% / 3,200→48.1% と崖になっていて、賢者・異端審問官（サブがLUK）だけが+85〜100%突出していた。')
W('')
W('### 4の中身（参照ステと職業補正のズレ）')
W('')
W('威力は kind で参照ステが決まる（phys→STR／mag→INT）のに、職業補正の main はそれとは別に決まっている。')
W('**main が STR/INT 以外の職は、倍率が乗るステを伸ばせない**。')
W('')
W('| 職業 | main / sub | 攻撃技が乗るステ | 中央値比 |')
W('|---|---|---|---:|')
{
  const L = { str:'STR', dex:'DEX', agi:'AGI', int_stat:'INT', vit:'VIT', luk:'LUK' }
  const ups = SKILL_CLASSES.filter(c => !BASIC.includes(c))
  const avg5 = (c) => set.filter(r => r.cls === c && (r.kind === 'phys' || r.kind === 'mag'))
    .sort((x, y) => y.avg - x.avg).slice(0, 5).reduce((t, r) => t + r.avg, 0) / 5
  const vals = ups.map(avg5).sort((x, y) => x - y)
  const m = vals[Math.floor(vals.length / 2)]
  for (const c of ups.slice().sort((x, y) => avg5(y) - avg5(x))) {
    const b = CLASS_BONUS[c] || {}
    const kinds = [...new Set(skillsOf(c).filter(s => s.kind === 'phys' || s.kind === 'mag').map(s => (s.srcKind || s.kind) === 'mag' ? 'INT' : 'STR'))]
    const ride = kinds.join('・')
    const ok = kinds.every(k => k === L[b.main])
    const d = (avg5(c) / m - 1) * 100
    if (Math.abs(d) < 15) continue
    W(`| ${c} | ${L[b.main]} / ${L[b.sub]} | ${ok ? ride : '**' + ride + '**'} | ${d > 0 ? '+' : ''}${d.toFixed(0)}% |`)
  }
}
W('')
W('---')
W('')

// ① 効果の発火
W('## ① 宣言した効果が実戦で発火しているか')
W('')
const NEED = { ail:'ailment', drain:'drain', consumeAil:'consumeAil', dispel:'dispel', form:'form',
  ritual:'ritual', chargeUp:'charge', airUp:'air', buff:'buff', heal:'heal', regen:'regen', mpRegen:'mpRegen',
  stance:'stance', frenzy:'frenzy', foresight:'foresight' }
const dead = []
// 効果ごとに「発火しうる側」の計測を見る（起爆とバフ剥がしだけ仕込みが要る）
const SETUP_ONLY = new Set(['consumeAil', 'dispel'])
for (const r of raw) {
  const sk = SKILL_BY_NAME[r.name]
  for (const [key, type] of Object.entries(NEED)) {
    const v = sk[key]
    if (v === undefined || v === null || v === false) continue
    const src = SETUP_ONLY.has(key) ? setOf(r.cls, r.name) : r
    if (!src.fired[type]) dead.push(`${r.cls} **${r.name}**：\`${key}\` が${TRIALS}回中0回`)
  }
}
W(dead.length ? dead.map(d => '- ⚠ ' + d).join('\n') : '- ✅ **全部発火している**（宣言だけで動いていない効果はゼロ）')
W('')
// 軸で伸びる技（素撃ちとの差）
W('### 軸を回したときの伸び（大きい順）')
W('')
W('| 職業 | スキル | 素撃ち | 軸あり | 伸び |')
W('|---|---|---:|---:|---:|')
const gain = raw.filter(r => r.kind === 'phys' || r.kind === 'mag')
  .map(r => ({ r, s: setOf(r.cls, r.name) }))
  .filter(x => x.s.avg > x.r.avg * 1.05)
  .sort((a, b) => (b.s.avg / b.r.avg) - (a.s.avg / a.r.avg))
for (const { r, s } of gain.slice(0, 22)) {
  W(`| ${r.cls} | ${r.name} | ${Math.round(r.avg).toLocaleString()} | ${Math.round(s.avg).toLocaleString()} | +${Math.round((s.avg / r.avg - 1) * 100)}% |`)
}
W('')

// ② 職ごと
W('## ② 職ごとの実測（ベスト5枠の平均・1手あたり）')
W('')
W('| 職業 | 主力 | 素撃ち | 軸あり | 5枠平均（軸あり） | MP効率が一番いい技 |')
W('|---|---|---:|---:|---:|---|')
const clsRows = []
for (const cls of SKILL_CLASSES) {
  const rs = set.filter(r => r.cls === cls && (r.kind === 'phys' || r.kind === 'mag'))
  if (!rs.length) continue
  const top = rs.reduce((a, b) => (b.avg > a.avg ? b : a))
  const five = [...rs].sort((a, b) => b.avg - a.avg).slice(0, 5)
  const avg5 = five.reduce((t, r) => t + r.avg, 0) / five.length
  const mpTop = rs.reduce((a, b) => (b.perMp > a.perMp ? b : a))
  const rawTop = raw.find(r => r.cls === cls && r.name === top.name)
  clsRows.push({ cls, top, avg5, mpTop })
  W(`| ${cls} | ${top.name} | ${Math.round(rawTop.avg).toLocaleString()} | ${Math.round(top.avg).toLocaleString()} | ${Math.round(avg5).toLocaleString()} | ${mpTop.name}（${Math.round(mpTop.perMp).toLocaleString()}/MP） |`)
}
W('')
const upper = clsRows.filter(c => !['ノーブル', '戦士', '弓使い', '魔法使い', '僧侶', '格闘家', 'サモナー'].includes(c.cls))
const a5 = upper.map(c => c.avg5).sort((x, y) => x - y)
const med = a5[Math.floor(a5.length / 2)]
W(`**上位職20職の5枠平均：中央値 ${Math.round(med).toLocaleString()}／最大 ${Math.round(a5[a5.length - 1]).toLocaleString()}／最小 ${Math.round(a5[0]).toLocaleString()}（幅 ${(a5[a5.length - 1] / a5[0]).toFixed(2)}倍）**`)
W('')
W('### 中央値から±15%以上ずれている職')
W('')
const offCls = upper.filter(c => Math.abs(c.avg5 / med - 1) >= 0.15).sort((x, y) => y.avg5 - x.avg5)
W(offCls.length ? offCls.map(c => `- ${c.avg5 > med ? '⬆' : '⬇'} **${c.cls}**：${Math.round(c.avg5).toLocaleString()}（${((c.avg5 / med - 1) * 100).toFixed(0)}%）`).join('\n') : '- なし')
W('')

// ③ 帯の中の外れ値
W('## ③ 同じ発動率の帯の中での外れ値（±25%以上）')
W('')
const bands = {}
for (const r of set) {
  if (r.kind !== 'phys' && r.kind !== 'mag') continue
  if (['ノーブル', '戦士', '弓使い', '魔法使い', '僧侶', '格闘家', 'サモナー'].includes(r.cls)) continue
  ;(bands[`${r.kind} / 発動${r.proc}%`] ||= []).push(r)
}
let anyOff = false
for (const [key, list] of Object.entries(bands).sort()) {
  if (list.length < 4) continue
  const v = list.map(r => r.avg).sort((a, b) => a - b)
  const m = v[Math.floor(v.length / 2)]
  const off = list.filter(r => Math.abs(r.avg / m - 1) >= 0.25).sort((a, b) => b.avg - a.avg)
  if (!off.length) continue
  anyOff = true
  W(`**${key}**（中央値 ${Math.round(m).toLocaleString()}・${list.length}本）`)
  for (const r of off) W(`- ${r.avg > m ? '⬆' : '⬇'} ${r.cls} ${r.name}：${Math.round(r.avg).toLocaleString()}（${((r.avg / m - 1) * 100).toFixed(0)}%）`)
  W('')
}
if (!anyOff) W('- ✅ どの帯にも±25%を超える外れ値なし')
W('')

// ④ 実戦
W('## ④ 同格の相手と実際に戦う（ベスト5編成・各20戦）')
W('')
W('| 職業 | 勝率 | 平均ターン |')
W('|---|---:|---:|')
const fights = []
for (const cls of SKILL_CLASSES) {
  const me = classFighter(cls)
  let win = 0, turns = 0
  for (let i = 0; i < 20; i++) {
    const r = runBattle(me, rival, { rng: rngOf(1000 + i), maxTurns: 60 })
    if (r.winner === 'a') win++
    turns += r.turns
  }
  fights.push({ cls, win: win / 20, turns: turns / 20 })
  W(`| ${cls} | ${Math.round((win / 20) * 100)}% | ${(turns / 20).toFixed(1)} |`)
}
W('')

// ⑤ ATB
W("## ⑤ ATB：仮想ボス【等速】と最大180秒やり合う（オート）")
W("")
W("| 職業 | 生存 | 経過秒 | 削り% | うち直接 | うちドット | ドット比 |")
W("|---|---|---:|---:|---:|---:|---:|")
const atbRows = []
for (const cls of SKILL_CLASSES) {
  const me = classFighter(cls)
  const even = dummyFoes(me).find(f => f.key === "even").make()
  const r = atbRun(me, even, 180, 7)
  const pct = (r.dealt / r.hp0) * 100
  const dotPct = r.dealt > 0 ? (r.dot / (r.direct + r.dot)) * 100 : 0
  atbRows.push({ cls, pct, dotPct, t: r.t, alive: r.alive })
  W(`| ${cls} | ${r.alive ? "○" : "×"} | ${r.t.toFixed(0)} | ${pct.toFixed(1)}% | ${Math.round(r.direct).toLocaleString()} | ${Math.round(r.dot).toLocaleString()} | ${dotPct.toFixed(0)}% |`)
}
W("")
const ups = atbRows.filter(r => !["ノーブル", "戦士", "弓使い", "魔法使い", "僧侶", "格闘家", "サモナー"].includes(r.cls))
const pv = ups.map(r => r.pct).sort((x, y) => x - y)
W(`**上位職の削り%：中央値 ${pv[Math.floor(pv.length / 2)].toFixed(1)}%／最大 ${pv[pv.length - 1].toFixed(1)}%／最小 ${pv[0].toFixed(1)}%**`)
W(`生き残った職：${ups.filter(r => r.alive).length} / ${ups.length}`)
W("")
W("### ドットが火力の半分以上を占めている職")
W("")
const dotHeavy = ups.filter(r => r.dotPct >= 50).sort((a, b) => b.dotPct - a.dotPct)
W(dotHeavy.length ? dotHeavy.map(r => `- **${r.cls}**：ドット ${r.dotPct.toFixed(0)}%（削り ${r.pct.toFixed(1)}%）`).join(String.fromCharCode(10)) : "- なし")
W("")

fs.writeFileSync("_balance_report.md", out.join(String.fromCharCode(10)))
console.log(out.join(String.fromCharCode(10)))