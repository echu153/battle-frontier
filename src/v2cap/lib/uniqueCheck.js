// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— ユニークの固有の能力が戦闘で発動するかを確かめる
// ------------------------------------------------------------
// 2026-10-21 ユーザー「一旦今のままで実装して、効果がすべて発動するかも実機確認して」
//   ・60個それぞれについて、持っている能力の項目（fx）ごとに、本物の戦闘エンジン（runBattle・createSide・takeAction）で確かめる
//     （項目ごとの確かめ方は下の CHECK。数字はそのユニークが持っている値をそのまま使う）
//   ・乱数は「いつも当たる（0.01）」「いつも外れる（0.99）」に固定する＝毎回同じ結果になる。
//     数で効くもの（与ダメ+%・受けるダメ−% など）は、その項目だけを抜いた装備と比べる
//   ・テスト（unique.test.js）と、ゲームの開発用の欄（V2capUniqueCheck.jsx）の両方がこれを使う＝画面でも同じ確かめが走る
// ============================================================
import { runBattle, createSide, takeAction, liveStats, mpCostOf } from '../core/battle.js'
import { setDealMult, setTakenMult, setResistMult, regenPctOf } from '../core/battleSet.js'
import { AIL_LABEL, POISON_TURNS, inflict } from '../core/ailments.js'
import { STAT_DEFS } from '../core/stats.js'
import { SKILL_BY_NAME } from './skills.js'
import { UNIQUE_ITEMS } from './equipment.js'
import { combinedFxOf } from './fxMerge.js'
import { CAP_RULES } from './rules.js'
import { dropRarityOf } from './sortie.js'

export const ME = 'ためし'
export const FOE = '木人'
const LOW = () => 0.01    // 確率のものは全部当たる（命中・発動・状態異常・クリティカル）
const HIGH = () => 0.99   // 全部外れる（攻撃はかわされ、技は不発）
const BASE = { hp: 6000, mp: 800, str: 320, dex: 260, agi: 220, int_stat: 320, vit: 180, luk: 120 }
const FOE_BASE = { hp: 300000, mp: 800, str: 120, dex: 200, agi: 100, int_stat: 120, vit: 150, luk: 60 }
// 自分の技（5つの枠をうめる）。剣士＝物理・魔法使い＝魔法
const PHYS = ['袈裟斬り', '燕返し', '兜割り', '一閃', '霞斬り']
const MAG = ['マジックアロー', 'ファイア', 'サンダー', 'アイスランス', 'ウインド']
// 相手に状態異常を付けさせる技
const AIL_SKILL = { poison: ['盗賊', '毒塗りの刃'], burn: ['銃士', '炸裂弾'], slow: ['弓使い', '足止めの矢'], paralyze: ['銃士', 'しびれ弾'] }
const slotsOf = (names, uses = 5) => names.map(n => ({ skill: SKILL_BY_NAME[n], uses }))
const isMag = (item) => ['杖', '書', '宝珠'].includes(item?.type)
const label = (k) => STAT_DEFS[k]?.label || k

// そのユニークの能力（drop＝抜く項目）を戦闘の入れ物にする
const fxOf = (item, drop = []) => {
  const fx = { ...item.fx }
  for (const k of drop) delete fx[k]
  return combinedFxOf(null, [{ ...item, fx }])
}
const me = (item, o = {}) => {
  const mag = o.mag ?? isMag(item)
  const stats = { ...BASE, ...(o.stats || {}) }
  return {
    name: ME, cls: mag ? '魔法使い' : '剣士', kind: mag ? 'mag' : 'phys', ...CAP_RULES,
    stats, slots: o.slots ?? slotsOf(mag ? MAG : PHYS), passives: [],
    setFx: o.fx !== undefined ? o.fx : (item ? fxOf(item, o.drop) : null),
    ...(o.hpPct != null ? { startHp: Math.floor(stats.hp * o.hpPct / 100) } : {}),
  }
}
const foe = (o = {}) => ({
  name: FOE, cls: o.cls || '剣士', kind: o.kind || 'phys', ...CAP_RULES,
  stats: { ...FOE_BASE, ...(o.stats || {}) }, slots: o.slots ?? [], passives: [],
})
const ailFoe = (key, o = {}) => foe({ cls: AIL_SKILL[key][0], slots: slotsOf([AIL_SKILL[key][1]]), ...o })
const fight = (a, b, rng = LOW, maxTurns = 8) => runBattle(a, b, { rng, maxTurns })

// ===== ログを読む =====
const uniq = (r, name, side = ME) => r.log.filter(l => (l.type === 'uniqueAct' || l.type === 'uniqueFx') && l.side === side && (l.name || '').includes(name))
const ailOn = (r, side, key) => r.log.filter(l => l.type === 'ailment' && l.side === side && l.ail === AIL_LABEL[key]).length
const ATK = new Set(['skill', 'normal', 'strike'])
const dealt = (r, side = ME) => r.log.filter(l => ATK.has(l.type) && l.side === side).reduce((t, l) => t + (l.damage || 0), 0)
const actDmg = (r, side = ME) => r.log.filter(l => (l.type === 'skill' || l.type === 'normal') && l.side === side).map(l => l.damage || 0)
const ratio = (a, b) => (b > 0 ? a / b : 0)
const near = (x, want, tol = 0.03) => Math.abs(x - want) <= tol
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2)
const res = (ok, detail) => ({ ok: !!ok, detail })
const allOf = (list) => ({ ok: list.every(x => x.ok), detail: list.map(x => x.detail).join('／') })

// 2つの側をすぐ作る（戦闘の前の状態で倍率を見る）
const sides = (item, o = {}, fo = {}) => {
  const a = createSide(me(item, o))
  const b = createSide(foe(fo))
  return { a, b }
}
// 与ダメージの倍率（この項目あり／なし）。prep(a, b) で状態を作ってから見る
const dealRatio = (item, key, kind, prep = () => {}) => {
  const w = sides(item); prep(w.a, w.b)
  const wo = sides(item, { drop: [key] }); prep(wo.a, wo.b)
  return setDealMult(w.a, w.b, liveStats(w.a), liveStats(w.b), kind) / setDealMult(wo.a, wo.b, liveStats(wo.a), liveStats(wo.b), kind)
}
const takenRatio = (item, key, prep = () => {}) => {
  const w = sides(item); prep(w.a, w.b)
  const wo = sides(item, { drop: [key] }); prep(wo.a, wo.b)
  return setTakenMult(w.b, w.a) / setTakenMult(wo.b, wo.a)
}
const hpTo = (side, pct) => { side.hp = Math.floor(side.base.hp * pct / 100) }

// ===== 項目ごとの確かめ方 =====
// (item, その項目の値) → { ok, detail }
export const CHECK = {
  onHitAils: (item, list) => allOf(list.map(a => {
    const n = ailOn(fight(me(item), foe()), FOE, a.key)
    const n0 = ailOn(fight(me(item, { drop: ['onHitAils'] }), foe()), FOE, a.key)
    return res(n > n0, `当てたら${AIL_LABEL[a.key]}：${n}回（能力なし${n0}回）`)
  })),
  onHitAilIf: (item, list) => allOf(list.map(c => {
    const n = ailOn(fight(me(item), foe()), FOE, c.key)
    const n0 = ailOn(fight(me(item, { drop: ['onHitAilIf'] }), foe()), FOE, c.key)
    return res(n > n0, `${AIL_LABEL[c.if]}の相手を${AIL_LABEL[c.key]}：${n}回（能力なし${n0}回）`)
  })),
  onHitStack: (item, list) => allOf(list.map(s => {
    const r = fight(me(item), foe())
    const v = r.b.enStacks?.[s.stat] || 0
    return res(v < 0 && v >= s.cap && uniq(r, item.name).length > 0, `相手の${label(s.stat)}${v}%（上限${s.cap}%）`)
  })),
  onHitTimed: (item, list) => allOf(list.map(t => {
    const r = fight(me(item), foe())
    const n = uniq(r, item.name).length
    // 重ならない：相手に残っているこの能力のダウンは1つだけ・ステはそのぶんだけ下がる
    const mine = r.b.timedBuffs.filter(b => (b.uq || '').includes(item.name))
    const k = Object.keys(t.table)[0]
    const x = ratio(liveStats(r.b)[k], r.b.base[k])
    return res(n > 0 && mine.length <= 1 && (mine.length === 0 || near(x, 1 + t.table[k] / 100, 0.02)),
      `相手の能力ダウン：${n}回（重ならない・いま${label(k)}×${f2(x)}）`)
  })),
  drainIfAil: (item, list) => {
    const sum = (r) => r.log.filter(l => l.type === 'skill' && l.side === ME).reduce((t, l) => t + (l.drain || 0), 0)
    const n = sum(fight(me(item, { hpPct: 50 }), foe()))
    const n0 = sum(fight(me(item, { hpPct: 50, drop: ['drainIfAil'] }), foe()))
    return res(n > n0, `${list.map(d => AIL_LABEL[d.key]).join('・')}の相手から吸収：${n}（能力なし${n0}）`)
  },
  lowHpDeal: (item, list) => allOf(list.map(l => {
    const lo = dealRatio(item, 'lowHpDeal', 'phys', (a) => hpTo(a, l.at - 5))
    const hi = dealRatio(item, 'lowHpDeal', 'phys', (a) => hpTo(a, l.at + 20))
    return res(near(lo, 1 + l.pct / 100) && near(hi, 1), `HP${l.at - 5}%で×${f2(lo)}・HP${l.at + 20}%で×${f2(hi)}`)
  })),
  hpDeal: (item, list) => allOf(list.map(h => {
    const hi = dealRatio(item, 'hpDeal', 'phys', (a) => hpTo(a, 100))
    const lo = dealRatio(item, 'hpDeal', 'phys', (a) => hpTo(a, h.at - 10))
    return res(near(hi, 1 + h.hi / 100) && near(lo, 1 + h.lo / 100), `HP100%で×${f2(hi)}・HP${h.at - 10}%で×${f2(lo)}`)
  })),
  kindDeal: (item, v) => allOf(Object.entries(v).map(([kind, pct]) => {
    const x = dealRatio(item, 'kindDeal', kind)
    const other = dealRatio(item, 'kindDeal', kind === 'phys' ? 'mag' : 'phys')
    return res(near(x, 1 + pct / 100) && near(other, 1), `${kind === 'phys' ? '物理' : '魔法'}×${f2(x)}・ほかは×${f2(other)}`)
  })),
  dealPct: (item, v) => { const x = dealRatio(item, 'dealPct', 'phys'); return res(near(x, 1 + v / 100), `与ダメ×${f2(x)}`) },
  vsAilDmg: (item, list) => allOf(list.map(a => {
    const on = dealRatio(item, 'vsAilDmg', isMag(item) ? 'mag' : 'phys', (x, y) => inflict(y.ail, a.key, {}))
    const off = dealRatio(item, 'vsAilDmg', isMag(item) ? 'mag' : 'phys')
    return res(near(on, 1 + a.pct / 100) && near(off, 1), `${AIL_LABEL[a.key]}の相手に×${f2(on)}・そうでなければ×${f2(off)}`)
  })),
  skillDeal: (item, v) => {
    const x = ratio(actDmg(fight(me(item), foe(), LOW, 1))[0], actDmg(fight(me(item, { drop: ['skillDeal'] }), foe(), LOW, 1))[0])
    return res(near(x, 1 + v / 100, 0.04), `スキルのダメージ×${f2(x)}`)
  },
  firstSkill: (item, v) => {
    const w = actDmg(fight(me(item), foe(), LOW, 2))
    const wo = actDmg(fight(me(item, { drop: ['firstSkill'] }), foe(), LOW, 2))
    const x1 = ratio(w[0], wo[0])
    const x2 = ratio(w[1], wo[1])
    return res(near(x1, 1 + v / 100, 0.05) && near(x2, 1), `1回目×${f2(x1)}・2回目×${f2(x2)}`)
  },
  hitStreak: (item, v) => {
    const w = actDmg(fight(me(item), foe(), LOW, 6))
    const wo = actDmg(fight(me(item, { drop: ['hitStreak'] }), foe(), LOW, 6))
    const x2 = ratio(w[1], wo[1])
    const top = Math.floor(v.max / v.per)
    const xt = ratio(w[top], wo[top])
    // 外れる場面：相手をとても速くして命中を下げる（命中100%の相手だと「いつも外れる」乱数でも当たる）
    const miss = fight(me(item), foe({ stats: { agi: 6000 } }), HIGH, 3)
    return res(near(x2, 1 + v.per / 100, 0.02) && near(xt, 1 + v.max / 100, 0.02) && miss.a.uq.streak === 0,
      `2回目×${f2(x2)}・${top + 1}回目×${f2(xt)}・外し続けると積まない`)
  },
  burstEvery: (item, v) => {
    const r = fight(me(item), foe(), LOW, v.every + 1)
    const ready = uniq(r, item.name).filter(l => l.text.includes('かみ合った')).length
    const used = uniq(r, item.name).filter(l => l.text.includes('溜まった一撃')).length
    const more = dealt(r) > dealt(fight(me(item, { drop: ['burstEvery'] }), foe(), LOW, v.every + 1))
    return res(ready > 0 && used > 0 && more, `${v.every}ターンめに溜まり・次の攻撃で使った（与ダメが増えた）`)
  },
  tide: (item, v) => {
    const odd = dealRatio(item, 'tide', 'phys', (a) => { a.turn = 0 })
    const even = dealRatio(item, 'tide', 'phys', (a) => { a.turn = 1 })
    const tEven = takenRatio(item, 'tide', (a) => { a.turn = 1 })
    const tOdd = takenRatio(item, 'tide', (a) => { a.turn = 0 })
    return res(near(odd, 1 + v.odd / 100) && near(even, 1) && near(tEven, 1 - v.even / 100) && near(tOdd, 1),
      `奇数ターン与ダメ×${f2(odd)}・偶数ターン受けるダメ×${f2(tEven)}`)
  },
  defIgnore: (item, v) => allOf(Object.keys(v).map(kind => {
    const mag = kind === 'mag'
    const tough = { stats: { vit: 900, int_stat: 900 } }
    const x = ratio(dealt(fight(me(item, { mag }), foe(tough), LOW, 2)), dealt(fight(me(item, { mag, drop: ['defIgnore'] }), foe(tough), LOW, 2)))
    return res(x > 1.02, `硬い相手への与ダメ×${f2(x)}（${mag ? '魔法' : '物理'}防御${v[kind]}%無視）`)
  })),
  turnGrow: (item, list) => allOf(list.map(g => {
    const { a } = sides(item)
    const before = liveStats(a)[g.stat]
    a.turn = 5
    const after = liveStats(a)[g.stat]
    const want = Math.min(g.max, g.per * 5)
    return res(near(after / before, 1 + want / 100, 0.02), `6ターンめの${label(g.stat)}×${f2(after / before)}（+${want}%）`)
  })),
  hitGrow: (item, list) => allOf(list.map(g => {
    const r = fight(me(item), foe(), LOW, 4)
    const v = r.a.uq.grow[g.stat] || 0
    return res(v > 0 && v <= g.max && uniq(r, item.name).length > 0, `当てるたび${label(g.stat)}+：いま+${v}%（上限${g.max}%）`)
  })),
  critGrow: (item, v) => {
    const r = fight(me(item), foe(), LOW, 4)
    return res(r.a.uq.critStacks > 0 && uniq(r, item.name).length > 0, `クリティカルで${v.stats.map(label).join('・')}+：${r.a.uq.critStacks * v.per}%`)
  },
  critDmgStack: (item, v) => {
    const r = fight(me(item), foe(), LOW, 6)
    return res(r.a.uq.critDmg === v.max && uniq(r, item.name).length > 0, `クリティカルのダメージ+${r.a.uq.critDmg}%（上限${v.max}%）`)
  },
  allSkillsBuff: (item, v) => {
    const r = fight(me(item), foe(), LOW, 7)
    const four = fight(me(item, { slots: slotsOf((isMag(item) ? MAG : PHYS).slice(0, 4)) }), foe(), LOW, 7)
    const on = r.a.uq.allOn && uniq(r, item.name).length > 0
    const k = Object.keys(v)[0]
    const up = on ? ratio(liveStats(r.a)[k], liveStats(createSide(me(item, { drop: ['allSkillsBuff'] })))[k]) : 0
    return res(on && !four.a.uq.allOn && up > 1.2, `5つの技を全部使って${label(k)}×${f2(up)}・4つの枠では起きない`)
  },
  chaseIfAil: (item, list) => {
    const r = fight(me(item), foe(), LOW, 4)
    const n = r.log.filter(l => l.type === 'strike' && l.side === ME && (l.label || '').includes(item.name)).length
    return res(n > 0, `${list.map(c => AIL_LABEL[c.key]).join('・')}の相手にもう1回：${n}回`)
  },
  addDmg: (item) => {
    const r = fight(me(item), foe(), LOW, 3)
    const hits = r.log.filter(l => l.type === 'strike' && l.side === ME && (l.label || '').includes(item.name))
    return res(hits.length > 0 && hits.every(l => l.damage > 0), `追加ダメージ：${hits.length}回（${hits[0]?.damage || 0}など）`)
  },
  dispelTurns: (item, turns) => {
    const r = fight(me(item), foe({ cls: '戦士', slots: slotsOf(['防御態勢']) }), LOW, turns[0] + 1)
    const done = uniq(r, item.name).filter(l => l.text.includes('消した'))
    return res(done.length > 0, `${turns[0]}ターンめ：${done[0]?.text || '消せなかった'}`)
  },
  echo: (item, v) => {
    const r = fight(me(item), foe(), LOW, v.every + 1)
    const e = uniq(r, item.name).find(l => l.text.includes('時の反響'))
    return res(!!e, e ? e.text : `${v.every}ターンめに出なかった`)
  },
  agiSteal: (item, v) => {
    const r = fight(me(item), foe(), LOW, 1)
    const got = r.a.uq.flat.agi || 0
    return res(got > 0 && (r.b.buffs.agi || 0) === -v && uniq(r, item.name).length > 0, `相手のAGI−${v}%・自分のAGI+${got}`)
  },
  ward: (item, v) => {
    const r = fight(me(item), ailFoe('poison'), LOW, v.every + 2)
    const blocked = uniq(r, item.name).filter(l => l.text.includes('防いだ')).length
    const gained = uniq(r, item.name).filter(l => l.text.includes('守りを得た')).length
    return res(blocked > 0 && gained >= 2, `状態異常を${blocked}回防いだ・守りを${gained}回得た（はじめと${v.every}ターンごと）`)
  },
  immune: (item, keys) => allOf(keys.map(k => {
    const r = fight(me(item), ailFoe(k), LOW, 4)
    const im = r.log.filter(l => l.type === 'immune' && l.side === ME && l.ail === AIL_LABEL[k]).length
    return res(im > 0 && ailOn(r, ME, k) === 0, `${AIL_LABEL[k]}にならない：${im}回はじいた`)
  })),
  resist: (item, v) => allOf(Object.entries(v).map(([k, m]) => {
    const { a } = sides(item)
    return res(near(setResistMult(a, k), m, 0.001), `${AIL_LABEL[k]}にかかる確率×${setResistMult(a, k)}`)
  })),
  resistAll: (item, m) => {
    const { a } = sides(item)
    return res(near(setResistMult(a, 'poison'), m, 0.001) && near(setResistMult(a, 'paralyze'), m, 0.001), `状態異常にかかる確率×${setResistMult(a, 'poison')}`)
  },
  ailTurnsCut: (item, v) => {
    const a = createSide(me(item))
    const b = createSide(ailFoe('poison'))
    takeAction(b, a, LOW, [])
    const t = a.ail.poison?.turns
    return res(t === POISON_TURNS - v, `毒の長さ${t}ターン（ふつう${POISON_TURNS}）`)
  },
  cureHeal: (item) => {
    const r = fight(me(item, { hpPct: 70 }), ailFoe('poison'), LOW, 8)
    const h = uniq(r, item.name).find(l => l.text.includes('治った'))
    return res(!!h, h ? h.text : '治ったときに回復しなかった')
  },
  lowHpHealOnce: (item, v) => {
    const r = fight(me(item, { hpPct: v.at + 3 }), foe(), LOW, 4)
    const h = r.log.filter(l => l.type === 'setFx' && l.side === ME && l.name === item.name)
    return res(h.length === 1, h.length ? `HP${v.at}%を下回って${h[0].text}` : '回復しなかった')
  },
  rootHealPct: (item) => {
    const r = fight(me(item, { hpPct: 90 }), foe(), LOW, 3)
    const h = r.log.filter(l => l.type === 'regenTick' && l.side === ME && (l.name || '').includes(item.name))
    return res(h.length > 0 && h[0].heal > 0, `受けたダメージから回復：${h[0]?.heal || 0}`)
  },
  reflect: (item) => {
    const r = fight(me(item), foe(), LOW, 2)
    const back = uniq(r, item.name).filter(l => l.text.includes('返した'))
    return res(back.length > 0, back[0]?.text || '返さなかった')
  },
  statPct: (item, v) => allOf(Object.entries(v).map(([k, p]) => {
    const x = ratio(liveStats(createSide(me(item)))[k], liveStats(createSide(me(item, { drop: ['statPct'] })))[k])
    return res(near(x, 1 + p / 100, 0.01), `${label(k)}×${f2(x)}`)
  })),
  maxHpPct: (item, v) => {
    const s = createSide(me(item))
    const want = Math.round(BASE.hp * (1 + v / 100))
    return res(s.base.hp === want && s.hp === want, `最大HP ${BASE.hp}→${s.base.hp}`)
  },
  regenPct: (item, v) => {
    const r = fight(me(item, { hpPct: 80 }), foe(), LOW, 1)
    const h = r.log.find(l => l.type === 'regenTick' && l.side === ME && (l.name || '').includes(item.name))
    const want = Math.floor(r.a.base.hp * v / 100)
    return res(!!h && Math.abs(h.heal - want) <= 1, `毎ターン${h?.heal || 0}回復（最大HPの${v}%＝${want}）`)
  },
  regenLow: (item, v) => {
    const { a } = sides(item)
    const hi = regenPctOf(a)
    hpTo(a, v.at - 10)
    const lo = regenPctOf(a)
    return res(lo - hi === v.add, `HP${v.at}%以下で毎ターン${hi}%→${lo}%`)
  },
  procBonus: (item, v) => res(createSide(me(item)).pa.procBonus === v, `スキルの発動率${v > 0 ? '+' : ''}${v}`),
  hitBonus: (item, v) => res(createSide(me(item)).pa.hitBonus === v, `命中${v > 0 ? '+' : ''}${v}`),
  critBonus: (item, v) => res(createSide(me(item)).pa.critBonus === v, `クリティカル率+${v}`),
  evaBonus: (item, v) => res(createSide(me(item)).pa.evaBonus === v, `回避+${v}`),
  physCut: (item, v) => {
    const x = ratio(dealt(fight(me(item), foe(), LOW, 2), FOE), dealt(fight(me(item, { drop: ['physCut'] }), foe(), LOW, 2), FOE))
    return res(near(x, 1 - v / 100, 0.03), `受ける物理ダメ×${f2(x)}`)
  },
  magCut: (item, v) => {
    const x = ratio(dealt(fight(me(item), foe({ kind: 'mag' }), LOW, 2), FOE), dealt(fight(me(item, { drop: ['magCut'] }), foe({ kind: 'mag' }), LOW, 2), FOE))
    return res(near(x, 1 - v / 100, 0.03), `受ける魔法ダメ×${f2(x)}`)
  },
  takenCut: (item, v) => {
    const x = ratio(dealt(fight(me(item), foe(), LOW, 2), FOE), dealt(fight(me(item, { drop: ['takenCut'] }), foe(), LOW, 2), FOE))
    return res(near(x, 1 - v / 100, 0.03), `受けるダメ×${f2(x)}`)
  },
  nextSameCut: (item, v) => {
    const x = ratio(dealt(fight(me(item), foe(), LOW, 4), FOE), dealt(fight(me(item, { drop: ['nextSameCut'] }), foe(), LOW, 4), FOE))
    return res(x < 0.97 && x > 1 - v / 100 - 0.03, `受けるダメ×${f2(x)}（2回目から−${v}%）`)
  },
  calmCut: (item, v) => {
    const calm = takenRatio(item, 'calmCut')
    const ail = takenRatio(item, 'calmCut', (a) => inflict(a.ail, 'poison', {}))
    return res(near(calm, 1 - v / 100) && near(ail, 1), `状態異常なしで×${f2(calm)}・毒のときは×${f2(ail)}`)
  },
  earlyCut: (item, v) => {
    const early = takenRatio(item, 'earlyCut', (a) => { a.turn = 0 })
    const later = takenRatio(item, 'earlyCut', (a) => { a.turn = v.turns })
    return res(near(early, 1 - v.pct / 100) && near(later, 1), `はじめの${v.turns}ターン×${f2(early)}・そのあと×${f2(later)}`)
  },
  vsSlowCut: (item, v) => {
    const slow = takenRatio(item, 'vsSlowCut', (a, b) => inflict(b.ail, 'slow', {}))
    const plain = takenRatio(item, 'vsSlowCut')
    return res(near(slow, 1 - v / 100) && near(plain, 1), `鈍足の相手から×${f2(slow)}`)
  },
  counterAil: (item, list) => allOf(list.map(c => {
    const r = fight(me(item), foe(), LOW, 3)
    const n = ailOn(r, FOE, c.key)
    const n0 = ailOn(fight(me(item, { drop: ['counterAil'] }), foe(), LOW, 3), FOE, c.key)
    return res(n > n0, `攻撃を受けて相手を${AIL_LABEL[c.key]}：${n}回（能力なし${n0}回）`)
  })),
  counterAilIf: (item, list) => allOf(list.map(c => {
    const r = fight(me(item), foe(), LOW, 4)
    const n = uniq(r, item.name).filter(l => l.text.includes(AIL_LABEL[c.key])).length
    return res(n > 0 && ailOn(r, FOE, c.key) > 0, `${AIL_LABEL[c.if]}の相手から受けて${AIL_LABEL[c.key]}を返した：${n}回`)
  })),
  counterSeal: (item) => {
    const r = fight(me(item), foe({ slots: slotsOf(PHYS) }), LOW, 3)
    const sealed = uniq(r, item.name).filter(l => l.text.includes('封印した')).length
    const blocked = r.log.filter(l => l.type === 'sealed' && l.side === FOE).length
    return res(sealed > 0 && blocked > 0, `スキルを受けて封印：${sealed}回・相手が技を出せなかった：${blocked}回`)
  },
  dodgeHeal: (item) => {
    const r = fight(me(item, { hpPct: 50 }), foe(), HIGH, 2)
    const h = uniq(r, item.name).filter(l => l.text.includes('かわして'))
    return res(h.length > 0, h[0]?.text || 'かわしても回復しなかった')
  },
  revive: (item) => {
    // HPを少しだけ（30）残して始め、相手の1発目で倒れるダメージを受けさせる
    const r = fight(me(item, { hpPct: 0.5 }), foe(), LOW, 2)
    const h = uniq(r, item.name).filter(l => l.text.includes('立ち上がった'))
    return res(h.length === 1, h[0]?.text || '復活しなかった')
  },
  earlyBuff: (item, v) => {
    const s = createSide(me(item))
    const k = Object.keys(v.table)[0]
    const x = ratio(liveStats(s)[k], liveStats(createSide(me(item, { drop: ['earlyBuff'] })))[k])
    return res(near(x, 1 + v.table[k] / 100, 0.01) && s.timedBuffs.some(t => t.turns === v.turns), `はじめの${v.turns}ターン ${label(k)}×${f2(x)}`)
  },
  convertAdds: (item, list) => allOf(list.map(c => {
    const s = liveStats(createSide(me(item)))
    const s0 = liveStats(createSide(me(item, { drop: ['convertAdds'] })))
    const want = Math.round((s0[c.from] || 0) * c.pct / 100)
    const got = (s[c.to] || 0) - (s0[c.to] || 0)
    return res(got === want && got > 0, `${label(c.from)}の${c.pct}%（${want}）を${label(c.to)}に足す：+${got}`)
  })),
  mpCut: (item, v) => {
    const sk = SKILL_BY_NAME[isMag(item) ? 'ファイア' : '一閃']
    const x = mpCostOf(createSide(me(item)), sk)
    const x0 = mpCostOf(createSide(me(item, { drop: ['mpCut'] })), sk)
    return res(x === Math.max(0, Math.round(x0 * (1 - v / 100))), `消費MP ${x0}→${x}`)
  },
  rareDropMult: (item, v) => {
    const fx = fxOf(item)
    const base = dropRarityOf('boss', 1, 1)
    const up = dropRarityOf('boss', 1, fx.rareDropMult)
    return res(fx.rareDropMult === v && up.L > base.L && up.N < base.N, `ボスのレジェンダリー ${base.L}%→${up.L}%（レア以上×${v}）`)
  },
}
// 画面に出す項目の名前
export const CHECK_LABEL = {
  onHitAils: '当てたら状態異常', onHitAilIf: '状態異常の相手に当てたら', onHitStack: '当てたら相手のステ−', onHitTimed: '当てたら相手のステ−（ターン）',
  drainIfAil: '状態異常の相手から吸収', lowHpDeal: 'HPが低いとき与ダメ+', hpDeal: 'HPで与ダメ+', kindDeal: '物理／魔法の与ダメ+', dealPct: '与ダメ+',
  vsAilDmg: '状態異常の相手に与ダメ+', skillDeal: 'スキルの与ダメ+', firstSkill: '最初のスキル', hitStreak: '当て続けると与ダメ+', burstEvery: '数ターンごとの一撃',
  tide: '奇数／偶数ターン', defIgnore: '防御無視', turnGrow: 'ターンごとにステ+', hitGrow: '当てるたびステ+', critGrow: 'クリティカルでステ+',
  critDmgStack: '当てるたびクリダメ+', allSkillsBuff: '技を全部使うとステ+', chaseIfAil: 'もう1回当たる', addDmg: '追加ダメージ', dispelTurns: '強化を消す',
  echo: '時の反響', agiSteal: 'AGIを奪う', ward: '状態異常を防ぐ', immune: '状態異常にならない', resist: 'かかりにくい', resistAll: 'かかりにくい',
  ailTurnsCut: '状態異常が短い', cureHeal: '治ると回復', lowHpHealOnce: 'HPが低いと回復', rootHealPct: '受けたダメから回復', reflect: 'ダメージを返す',
  statPct: 'ステ+%', maxHpPct: '最大HP+', regenPct: '毎ターン回復', regenLow: 'HPが低いと回復が増える', procBonus: '発動率', hitBonus: '命中',
  critBonus: 'クリティカル率+', evaBonus: '回避+', physCut: '受ける物理ダメ−', magCut: '受ける魔法ダメ−', takenCut: '受けるダメ−',
  nextSameCut: '同じ種類の次のダメ−', calmCut: '状態異常でないとき受けるダメ−', earlyCut: 'はじめの数ターン受けるダメ−', vsSlowCut: '鈍足の相手から受けるダメ−',
  counterAil: '受けたら相手を状態異常', counterAilIf: '状態異常の相手から受けたら', counterSeal: 'スキルを受けたら封印', dodgeHeal: 'かわすと回復',
  revive: '1回だけ復活', earlyBuff: 'はじめの数ターンステ+', convertAdds: 'ステを足す', mpCut: '消費MP', rareDropMult: 'レア以上が落ちやすい',
}

// 1つのユニークを確かめる。返すのは { item, ok, checks:[{ key, label, ok, detail }] }
export const checkUnique = (item) => {
  const checks = Object.entries(item.fx || {}).map(([key, v]) => {
    const f = CHECK[key]
    if (!f) return { key, label: key, ok: false, detail: '確かめ方が無い' }
    try {
      return { key, label: CHECK_LABEL[key] || key, ...f(item, v) }
    } catch (e) {
      return { key, label: CHECK_LABEL[key] || key, ok: false, detail: `エラー：${e.message}` }
    }
  })
  return { item, ok: checks.length > 0 && checks.every(c => c.ok), checks }
}
// 60個ぜんぶ（onEach＝1つ終わるたびに呼ぶ。画面で進み具合を出すため）
export const checkAllUniques = (onEach = null) => UNIQUE_ITEMS.map((item, i) => {
  const r = checkUnique(item)
  if (onEach) onEach(r, i)
  return r
})
