// バトルフロンティアⅡ 戦闘ループの回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tickAil, runBattle, createSide, takeAction, liveStats, lowHpMultOf, highHpMultOf, vsBuffMultOf, buffCountOf, repeatMultOf, switchKindMultOf, varianceMultOf, comboMultOf, airMultOf, stackMultOf, chargeGuardOf, AIR_EVA, STACK_MAX, beastMultOf, BEAST_FORMS, BEAST_BONUS, peekSkill, attackKindOf, mpCostOf, priorityOf, foresightEva, tickForesight, NORMAL_ATTACK_MULT, MAX_TURNS, BUFF_MIN_PCT } from './battle.js'
import { inflict, POISON_CAP_RATE, BLEED_CAP_RATE } from './ailments.js'
import { INITIAL_STATS, applyExp } from './stats.js'
import { skillsOf, SKILL_BY_NAME, OFF_CLASS_MULT, OFF_CLASS_MP_MULT, setMpCost, offClassMult, mpOf } from './skills.js'
import { damageFloor } from './combat.js'

const makeRng = (seed) => {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const evenStats = (power) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u }
}
// 検証しやすいように、当たる・当たらないが確定するダミースキルを作る
// ★clsを持たせない＝他職ペナルティ(OFF_CLASS_MULT)の対象外。素の挙動だけを見たいので
const sk = (name, over = {}) => ({ name, kind:'phys', mult:1, proc:100, mp:0, desc:'', ...over })
const fighter = (name, slots, stats = evenStats(534)) => ({ name, cls:'戦士', kind:'phys', stats, slots })

test('職業の通常攻撃はSTR参照かINT参照かが決まる', () => {
  for (const c of ['戦士', '弓使い', '格闘家', 'ノーブル']) assert.equal(attackKindOf(c), 'phys', c)
  for (const c of ['魔法使い', '僧侶', 'サモナー'])         assert.equal(attackKindOf(c), 'mag', c)
  assert.equal(NORMAL_ATTACK_MULT, 1.0)
})

test('スキルはセットした順に1巡する（ABC→ABC）', () => {
  const slots = ['A', 'B', 'C'].map(n => ({ skill: sk(n, { proc:100 }), uses: 2 }))
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(1), maxTurns: 6 })
  const used = r.log.filter(l => l.side === 'me' && l.type === 'skill').map(l => l.skill)
  assert.deepEqual(used.slice(0, 6), ['A', 'B', 'C', 'A', 'B', 'C'])
})

test('使用回数を使い切った枠は飛ばす', () => {
  const slots = [
    { skill: sk('A', { proc:100 }), uses: 1 },
    { skill: sk('B', { proc:100 }), uses: 3 },
  ]
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(2), maxTurns: 4 })
  const used = r.log.filter(l => l.side === 'me' && l.type === 'skill').map(l => l.skill)
  assert.deepEqual(used.slice(0, 4), ['A', 'B', 'B', 'B'])  // Aは1回だけ、あとはBが回る
})

test('不発ならMPも使用回数も減らず、ポインタも進まない', () => {
  // 先頭を必ず不発（proc:0）にする。後ろのBには永久に進まない
  const slots = [
    { skill: sk('詰まる技', { proc:0, mp:5 }), uses: 3 },
    { skill: sk('B', { proc:100, mp:5 }), uses: 3 },
  ]
  const me = fighter('me', slots)
  const r = runBattle(me, fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(3), maxTurns: 8 })
  const mine = r.log.filter(l => l.side === 'me')
  assert.ok(mine.every(l => l.type !== 'skill'), 'Bには一度も進まない')
  assert.equal(mine.filter(l => l.type === 'misfire').length, 8)
  assert.equal(r.a.slots[0].uses, 3, '使用回数が減っていない')
  assert.equal(r.a.mp, me.stats.mp, 'MPが減っていない')
})

test('不発のターンは通常攻撃をする', () => {
  const slots = [{ skill: sk('不発', { proc:0 }), uses: 5 }]
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(4), maxTurns: 5 })
  const mine = r.log.filter(l => l.side === 'me')
  assert.equal(mine.filter(l => l.type === 'misfire').length, 5)
  assert.equal(mine.filter(l => l.type === 'normal').length, 5)
})

test('MPが足りない枠は飛ばす（使用回数は減らない）', () => {
  const slots = [
    { skill: sk('高い技', { proc:100, mp: 10 ** 6 }), uses: 3 },
    { skill: sk('安い技', { proc:100, mp: 0 }), uses: 3 },
  ]
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(5), maxTurns: 3 })
  const used = r.log.filter(l => l.side === 'me' && l.type === 'skill').map(l => l.skill)
  assert.deepEqual(used, ['安い技', '安い技', '安い技'])
  assert.equal(r.a.slots[0].uses, 3)
})

test('撃てる枠が無くなったら通常攻撃だけになる', () => {
  const slots = [{ skill: sk('A', { proc:100 }), uses: 1 }]
  const r = runBattle(fighter('me', slots), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), { rng: makeRng(6), maxTurns: 4 })
  const mine = r.log.filter(l => l.side === 'me')
  assert.equal(mine.filter(l => l.type === 'skill').length, 1)
  assert.equal(mine.filter(l => l.type === 'normal').length, 3)
})

test('先制スキルは行動順を取る（AGIで負けていても先に動く）', () => {
  const slow = { ...evenStats(534), agi: 1 }
  const fast = { ...evenStats(534), agi: 10 ** 5 }
  const pri = [{ skill: sk('先制', { proc:100, priority:1 }), uses: 99 }]
  const norm = [{ skill: sk('通常', { proc:100 }), uses: 99 }]
  const r = runBattle(
    { name:'おそい', cls:'戦士', kind:'phys', stats: slow, slots: pri },
    { name:'はやい', cls:'戦士', kind:'phys', stats: fast, slots: norm },
    { rng: makeRng(7), maxTurns: 1 })
  assert.equal(r.log[0].side, 'おそい')
  // 優先度が同じならAGIの速いほうが先
  const r2 = runBattle(
    { name:'おそい', cls:'戦士', kind:'phys', stats: slow, slots: norm },
    { name:'はやい', cls:'戦士', kind:'phys', stats: fast, slots: norm },
    { rng: makeRng(7), maxTurns: 1 })
  assert.equal(r2.log[0].side, 'はやい')
})

test('AGIが上なら追加行動が出る', () => {
  const slow = { ...evenStats(534), agi: 10 }
  const fast = { ...evenStats(534), agi: 200 }   // 20倍＝上限50%
  const slots = [{ skill: sk('A', { proc:100 }), uses: 99 }]
  const r = runBattle(
    { name:'はやい', cls:'戦士', kind:'phys', stats: { ...fast, hp: 10 ** 7 }, slots },
    { name:'おそい', cls:'戦士', kind:'phys', stats: { ...slow, hp: 10 ** 7 }, slots },
    { rng: makeRng(8), maxTurns: 60 })
  const extras = r.log.filter(l => l.type === 'extra')
  assert.ok(extras.length > 0, '追加行動が一度も出ていない')
  assert.ok(extras.every(l => l.side === 'はやい'), '遅いほうに追加行動が出ている')
})

test('回復は最大HPを超えない', () => {
  const heal = [{ skill: sk('回復', { kind:'heal', proc:100, heal:{ rate:10 ** 4 } }), uses: 99 }]
  const r = runBattle(
    { name:'me', cls:'僧侶', kind:'mag', stats: evenStats(534), slots: heal },
    { name:'foe', cls:'戦士', kind:'phys', stats: evenStats(534), slots: [] },
    { rng: makeRng(9), maxTurns: 5 })
  assert.ok(r.a.hp <= r.a.base.hp, `HP${r.a.hp} / 最大${r.a.base.hp}`)
})

test('バフは戦闘中ずっと続き、重ねがけで加算される', () => {
  // ★あるけみすと準拠。ターンで切れない＝バフを積む戦い方が成立する
  const buff = [
    { skill: sk('強化', { kind:'buff', proc:100, buff:{ self:{ str:50 } } }), uses: 3 },
    // クリと回避のブレを消して、バフの効きだけを比べる
    { skill: sk('殴る', { proc:100, sureHit:true, noCrit:true }), uses: 99 },
  ]
  const r = runBattle(
    fighter('me', buff), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }),
    { rng: makeRng(10), maxTurns: 12 })
  // 3回重ねて +150%
  assert.equal(r.a.buffs.str, 150)
  // 枠は順に回るので 強化→殴る→強化→殴る… となり、バフが積まれるほど一撃が伸びる
  const hits = r.log.filter(l => l.side === 'me' && l.type === 'skill' && l.skill === '殴る')
  assert.ok(hits.length >= 4)
  assert.ok(hits[hits.length - 1].damage > hits[0].damage,
    `積み上がっていない: 最初${hits[0].damage} / 最後${hits[hits.length - 1].damage}`)
  // 積み終わったあとは切れずに一定。★ダメージには振れ幅があるので、
  //   2発が「下限〜1.00倍」の帯に収まっていることで確かめる（切れたら6割落ちる）
  const last = hits.slice(-2).map(h => h.damage)
  const floor = damageFloor(evenStats(534), 'phys')
  assert.ok(Math.min(...last) >= Math.max(...last) * floor * 0.99,
    `バフが途中で切れている: ${last.join(' / ')}`)
})

test('デバフを重ねてもステータスは0未満にならない', () => {
  const debuff = [{ skill: sk('弱体', { kind:'buff', proc:100, buff:{ enemy:{ vit:-50 } } }), uses: 99 }]
  const r = runBattle(
    fighter('me', debuff), fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }),
    { rng: makeRng(11), maxTurns: 10 })
  assert.ok(r.b.buffs.vit >= BUFF_MIN_PCT, `${r.b.buffs.vit}`)
  assert.equal(r.b.buffs.vit, BUFF_MIN_PCT)
})

test('実際の職業どうしで決着する', () => {
  const rng = makeRng(2026)
  const stats = applyExp({ lv:1, exp:0, job_changes:0, ...INITIAL_STATS }, 60 * 500, rng).stats
  for (const [ca, cb] of [['戦士', '魔法使い'], ['弓使い', '僧侶'], ['格闘家', 'サモナー']]) {
    const r = runBattle(
      { name:ca, cls:ca, stats, slots: skillsOf(ca).map(s => ({ skill:s, uses:5 })) },
      { name:cb, cls:cb, stats, slots: skillsOf(cb).map(s => ({ skill:s, uses:5 })) },
      { rng })
    assert.ok(['a', 'b'].includes(r.winner), `${ca} vs ${cb} が引き分け（${r.turns}ターン）`)
    assert.ok(r.turns < MAX_TURNS, `${ca} vs ${cb} が長すぎる（${r.turns}ターン）`)
  }
})

test('peekSkill は次に撃つ枠を返す（行動順の判定に使う）', () => {
  const side = createSide(fighter('me', [
    { skill: sk('A', { proc:100 }), uses: 0 },   // 使い切り
    { skill: sk('B', { proc:100 }), uses: 1 },
  ]))
  assert.equal(peekSkill(side).name, 'B')
  side.slots[1].uses = 0
  assert.equal(peekSkill(side), null)  // 撃てる枠が無い＝通常攻撃
})

test('割合消費のスキルは残りMPの割合を払い、撃ち切れない', () => {
  const mana = sk('マナ撃ち', { kind:'mag', mult:1, proc:100, mp:0, mpPct:0.2 })
  const stats = { ...evenStats(534), mp: 1000, hp: 10 ** 7 }
  const r = runBattle(
    { name:'me', cls:'魔法使い', kind:'mag', stats, slots:[{ skill:mana, uses:99 }] },
    { name:'foe', cls:'戦士', kind:'phys', stats:{ ...evenStats(534), hp: 10 ** 7 }, slots: [] },
    { rng: makeRng(21), maxTurns: 10 })
  // 1000 → 800 → 640 … と減り、0にはならない
  assert.ok(r.a.mp > 0, `MPが尽きている: ${r.a.mp}`)
  assert.ok(r.a.mp < 1000 * 0.5, `ちゃんと減っていない: ${r.a.mp}`)
  assert.equal(r.log.filter(l => l.side === 'me' && l.type === 'skill').length, 10, '毎ターン撃てている')
  assert.equal(mpCostOf({ mp: 500 }, mana), 100)
  assert.equal(mpCostOf({ mp: 500 }, sk('固定', { mp: 30 })), 30)
})

// ★2026-08-18：侍の居合斬・月影で**プレイヤー側のスキルにも状態異常を解禁**した。
//   それまで ail を持っていたのは敵の技とエンチャントのルーンだけで、
//   プレイヤーのスキルは一度も tryInflict を通っていなかった＝経路が生きているかの確認。
test('プレイヤーのスキルの状態異常が相手に入る（侍の出血）', () => {
  const iai = sk('出血テスト', { proc:100, ail:{ key:'bleed', chance:100 } })
  const r = runBattle(
    fighter('me', [{ skill: iai, uses: 99 }]),
    fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }),
    { rng: makeRng(7), maxTurns: 6 })
  assert.ok(r.log.some(l => l.type === 'ailment' && l.ail === '出血'), '出血が付いていない')
  assert.ok(r.log.some(l => l.type === 'ailTick' && l.ail === '出血' && l.damage > 0), '出血が刻んでいない')
})

test('侍は出血役（居合斬20%・月影40%）', () => {
  // 無印の侍が出血を撒く職業だったのを踏襲している。数字を消したら気付けるように固定する
  const by = Object.fromEntries(skillsOf('侍').map(s => [s.name, s]))
  assert.deepEqual(by['居合斬'].ail, { key:'bleed', chance:20 })
  assert.deepEqual(by['月影'].ail, { key:'bleed', chance:40 })
  // 出血は割合ダメージ＝倍率の帯とは別枠の価値なので、素の倍率は帯の上限を超えていない
  assert.ok(by['居合斬'].mult + by['居合斬'].add[0].rate <= 1.9)
  assert.ok(by['月影'].mult >= 2.0, '切り札の帯にいる')   // 実際の値は帯の表から決まる（skills.js の VALUE_TABLE）
})

// ============================================================
// ★2026-08-18：**他職のスキルは効果が落ちる**（skills.js の OFF_CLASS_MULT）。
//   v2は習得済みで転職後もスキルが残る＝職業をまたいで組めるので、そのままだと
//   全員が同じ最適5枠に寄って職業を選ぶ意味が消える。
//   ⚠掛かるのは「ダメージ・回復・バフ幅・状態異常の付与確率」だけ。
//     発動率・消費MP・防御無視・必中・多段数・パッシブには掛からない。
//     ここが崩れると「他職からはバフとパッシブを借りるのが最適」に戻ってしまう
// ============================================================
// ★比較は「同じ職業で、ラベルだけ他職にしたスキル」で行う。
//   別の職業で走らせると職業補正（侍STR+5% / 狂戦士STR+10%）まで変わって比べ物にならない
const soloRun = (cls, skill, seed = 5, maxTurns = 1) => runBattle(
  { name:'me', cls, kind:'phys', stats: evenStats(534), slots:[{ skill, uses: 9 }] },
  { name:'foe', cls:'戦士', kind:'phys', stats:{ ...evenStats(534), hp: 10 ** 7 }, slots: [] },
  { rng: makeRng(seed), maxTurns })
const asOtherClass = (skill) => ({ ...skill, cls: '別職' })

test('他職のスキルはダメージが0.8倍になる', () => {
  const blade = SKILL_BY_NAME['月影']
  const mine = soloRun('侍', blade).log.find(l => l.side === 'me' && l.type === 'skill')
  const off  = soloRun('侍', asOtherClass(blade)).log.find(l => l.side === 'me' && l.type === 'skill')
  assert.ok(mine.damage > 0 && off.damage > 0)
  assert.ok(Math.abs(off.damage - mine.damage * OFF_CLASS_MULT) <= 1,
    `自職${mine.damage} → 他職${off.damage}（期待 ${(mine.damage * OFF_CLASS_MULT).toFixed(1)}）`)
})

test('他職のスキルはバフの増減幅も0.8倍になる', () => {
  const buff = SKILL_BY_NAME['明鏡止水']   // 侍：STR・DEXが上がる（幅は帯の表から決まる）
  const mine = soloRun('侍', buff).a
  const off  = soloRun('侍', asOtherClass(buff)).a
  // どちらも侍なので職業補正(STR+5%)は同じ。差はバフの幅だけ
  const S = buff.buff.self.str, D = buff.buff.self.dex
  assert.equal(mine.buffs.str - 5, S)
  assert.equal(mine.buffs.dex, D)
  assert.equal(off.buffs.str - 5, S * OFF_CLASS_MULT)
  assert.equal(off.buffs.dex, D * OFF_CLASS_MULT)
})

test('他職のスキルはデバフの幅も0.8倍になる（弱いデバフになる）', () => {
  const debuff = SKILL_BY_NAME['防御崩し']   // 戦士：相手のVIT-15%
  const mine = soloRun('戦士', debuff).b
  const off  = soloRun('戦士', asOtherClass(debuff)).b
  assert.equal(mine.buffs.vit, -15)
  assert.equal(off.buffs.vit, -15 * OFF_CLASS_MULT)   // 0へ寄る＝弱い
})

test('他職のスキルは状態異常の付与確率も0.8倍になる', () => {
  const bleed = { ...SKILL_BY_NAME['月影'], ail:{ key:'bleed', chance:100 } }
  const count = (skill) => {
    let n = 0
    for (let i = 0; i < 300; i++) if (soloRun('侍', skill, i + 1).log.some(l => l.type === 'ailment')) n++
    return n
  }
  const mine = count(bleed)
  const off = count(asOtherClass(bleed))
  // 発動78%×命中ぶんがあるので300回全部ではない。ここで見たいのは自職と他職の差
  assert.ok(mine > 150, `自職で入った回数が少なすぎる: `)
  assert.ok(off < mine, `他職でも減っていない: 自職${mine} / 他職${off}`)
})

test('他職のスキルは消費MPが2倍になる', () => {
  // ★効果が落ちるだけだと「弱いが安い枠」として積めてしまうので、MPのほうからも縛る
  const blade = SKILL_BY_NAME['月影']   // 侍・MP22
  assert.equal(mpCostOf({ cls:'侍', mp: 500 }, blade), blade.mp)
  assert.equal(mpCostOf({ cls:'狂戦士', mp: 500 }, blade), blade.mp * OFF_CLASS_MP_MULT)
  // 割合消費（マナボルト＝残りMPの20%）も同じだけ重くなる
  const mana = SKILL_BY_NAME['マナボルト']
  assert.equal(mpCostOf({ cls:'賢者', mp: 500 }, mana), 100)
  assert.equal(mpCostOf({ cls:'侍', mp: 500 }, mana), 200)
  // 編成の想定利用MPも同じ関数を通る（画面とサーバーと戦闘でズレない）
  const set = [{ name:'月影', uses: 3 }]
  assert.equal(setMpCost(set, '侍'), blade.mp * 3)
  assert.equal(setMpCost(set, '狂戦士'), blade.mp * 3 * OFF_CLASS_MP_MULT)
})

test('発動率と通常攻撃には他職ペナルティが掛からない', () => {
  // ★ここが崩れると「他職からはバフとパッシブを借りるのが得」に戻る
  const blade = asOtherClass(SKILL_BY_NAME['月影'])
  assert.equal(blade.proc, 78, '発動率は据え置き')
  // 通常攻撃はスキルではないので対象外（不発しかしない技を積んで通常攻撃を出させる）
  const dud = { name:'不発だけ', cls:'別職', kind:'phys', mult:1, proc:0, mp:0, desc:'' }
  const na = soloRun('侍', dud).log.find(l => l.side === 'me' && l.type === 'normal')
  assert.ok(na && na.damage > 0, '通常攻撃が出ている')
})

// ★2026-08-19：暗殺者の「出血を撒いて急所突きで刈る」ために足した2つの仕組み
test('スキル自身の命中補正（hitBonus）が効く', () => {
  // 回避が高い相手に、命中補正つきの技だけが当たる状況を作る
  const dodgy = fighter('よけ', [], { ...evenStats(534), agi: 4000, dex: 4000 })
  const mine = fighter('自分', [{ skill: sk('ふつう', { mult:1 }), uses:9 }, { skill: sk('当てる', { mult:1, hitBonus:100 }), uses:9 }])
  const a = createSide(mine)
  const b = createSide(dodgy)
  const log = []
  takeAction(a, b, () => 0.99, log, { idx: 1, noProc: true })   // 命中+100%＝必ず当たる
  assert.equal(log.find(l => l.type === 'skill').hits, 1)
  const log2 = []
  takeAction(a, b, () => 0.99, log2, { idx: 0, noProc: true })  // 補正なしは外れる
  assert.equal(log2.find(l => l.type === 'skill').hits, 0)
})

test('出血の起爆（consumeAil）はスタックを全部消費して威力を上げる', () => {
  const base = sk('起爆', { mult:1, consumeAil:{ key:'bleed', perStack:0.2 } })
  const run = (stacks) => {
    const a = createSide(fighter('自分', [{ skill: base, uses:9 }]))
    const b = createSide(fighter('相手'))
    for (let i = 0; i < stacks; i++) inflict(b.ail, 'bleed')
    const log = []
    takeAction(a, b, () => 0.5, log, { idx: 0, noProc: true })
    return { damage: log.find(l => l.type === 'skill').damage, ail: b.ail.bleed, log }
  }
  const r0 = run(0)
  const r5 = run(5)
  assert.equal(r0.ail, undefined)
  assert.equal(r5.ail, undefined, '出血は全部消費されて消える')
  // 5スタック＝威力2倍
  assert.ok(Math.abs(r5.damage / r0.damage - 2) < 0.05, `${r0.damage} → ${r5.damage}`)
  assert.equal(r5.log.find(l => l.type === 'consumeAil').stacks, 5)
  assert.equal(r0.log.some(l => l.type === 'consumeAil'), false, '出血が無いときは何も起きない')
})

// ===== エリアの相性（enemies.js の bias）=====
// ★2026-08-22 ユーザー決定：帯にエリアが複数あるとき、片方は物理・片方は特殊が少し通る。
//   ここが効いていないと、エリアを選び分ける意味が消える
test('taken を持つ相手は、その型のダメージだけ通りやすくなる', () => {
  const slots = [{ skill: sk('A', { proc:100, mult:2 }), uses: 9 }]
  const hpOf = (taken, kind) => {
    const foe = { ...fighter('foe', [], { ...evenStats(534), hp: 10 ** 7 }), taken }
    const r = runBattle({ ...fighter('me', slots), kind }, foe, { rng: makeRng(7), maxTurns: 4 })
    return r.log.filter(l => l.side === 'me' && l.type === 'skill').reduce((t, l) => t + (l.damage || 0), 0)
  }
  const base = hpOf(null, 'phys')
  const up   = hpOf({ phys: 1.1 }, 'phys')
  assert.ok(up > base, `物理が通りやすくなっていない（${base} → ${up}）`)
  assert.ok(Math.abs(up / base - 1.1) < 0.02, `+10%になっていない（×${(up / base).toFixed(3)}）`)
  // 型が違えば効かない
  assert.equal(hpOf({ mag: 1.1 }, 'phys'), base, '物理なのに特殊の相性が乗っている')
})

// ============================================================
// ★2026-08-19：侍「納刀して斬る」
// ============================================================
test('納刀：次のスキルだけ発動率+20%・威力1.5倍・先制になり、撃つと消える', () => {
  const nou = SKILL_BY_NAME['納刀']
  assert.deepEqual(nou.stance, { proc:20, mult:1.5, priority:1 })
  const atk = sk('斬る', { mult:1, proc:100 })
  const me = createSide(fighter('侍', [{ skill: nou, uses:9 }, { skill: atk, uses:9 }]))
  const foe = createSide(fighter('的'))
  const log = []
  // 納刀 → 構えに入る
  takeAction(me, foe, () => 0.5, log, { idx: 0, noProc: true })
  assert.deepEqual(me.stance, { proc:20, mult:1.5, priority:1 })
  assert.equal(priorityOf(me, atk), 1, '納刀中はどの技も先制')
  // 斬る → 威力1.5倍で、構えは消える
  const plain = createSide(fighter('侍', [{ skill: nou, uses:9 }, { skill: atk, uses:9 }]))
  const log2 = [], log3 = []
  takeAction(plain, createSide(fighter('的')), () => 0.5, log2, { idx: 1, noProc: true })
  takeAction(me, foe, () => 0.5, log3, { idx: 1, noProc: true })
  const d0 = log2.find(l => l.type === 'skill').damage
  const d1 = log3.find(l => l.type === 'skill').damage
  assert.ok(Math.abs(d1 / d0 - 1.5) < 0.05, `${d0} → ${d1}`)
  assert.equal(me.stance, null, '撃ったら消える')
  assert.equal(priorityOf(me, atk), 0)
})

test('納刀中だけの追加効果（断空＝防御無視+20%・月影＝出血が確定）', () => {
  // データの確認
  assert.deepEqual(SKILL_BY_NAME['断空'].whileStance, { defPen:0.2 })
  assert.deepEqual(SKILL_BY_NAME['月影'].whileStance, { ailChance:100 })
  // 仕組みの確認（必中の試し技で、納刀の有無だけを見る）
  const nou = SKILL_BY_NAME['納刀']
  const test斬 = sk('試し斬り', { mult:1, proc:100, ail:{ key:'bleed', chance:0 }, whileStance:{ ailChance:100 } })
  const run = (stance) => {
    const me = createSide(fighter('侍', [{ skill: nou, uses:9 }, { skill: test斬, uses:9 }]))
    const foe = createSide(fighter('的'))
    if (stance) takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
    takeAction(me, foe, () => 0.5, [], { idx: 1, noProc: true })
    return foe.ail.bleed?.stacks || 0
  }
  assert.equal(run(false), 0, '納刀なしでは付与率0%')
  assert.equal(run(true), 1, '納刀中は確定で付く')
})

test('見切り：受けた技ほど避けやすくなり、20%で頭打ち・切れると消える', () => {
  const mikiri = SKILL_BY_NAME['見切り']
  assert.deepEqual(mikiri.foresight, { turns:5, pct:3, perHit:3, max:20 })
  const me = createSide(fighter('侍', [{ skill: mikiri, uses:9 }]))
  const foe = createSide(fighter('的', [{ skill: sk('突き', { mult:1, proc:100 }), uses:99 }]))
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(foresightEva(me, null), 3)
  for (let i = 0; i < 10; i++) takeAction(foe, me, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(me.foresight.byName['突き'], 20, '同じ技につき20%で頭打ち')
  assert.equal(foresightEva(me, '突き'), 23)
  assert.equal(foresightEva(me, '別の技'), 3, '別の技には積み上がらない')
  // 5ターンで切れて、積み上げも消える
  for (let i = 0; i < 5; i++) tickForesight(me)
  assert.equal(me.foresight, null)
  assert.equal(foresightEva(me, '突き'), 0)
})

// ============================================================
// ★2026-08-19：狂戦士「HPを燃やして出血を撒く」
// ============================================================
test('ヒットごとの状態異常：3連撃なら3回とも出血を試す', () => {
  const mad = SKILL_BY_NAME['マッドラッシュ']
  assert.equal(mad.ailPerHit, true)
  assert.equal(mad.hits, 3)
  const always = sk('連撃', { mult:0.5, hits:3, proc:100, noCrit:true, ail:{ key:'bleed', chance:100 }, ailPerHit:true })
  const me = createSide(fighter('狂戦士', [{ skill: always, uses:9 }]))
  const foe = createSide(fighter('的'))
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(foe.ail.bleed.stacks, 3, '1回の行動で3スタック積む')
  // ヒットごとでない技は1回だけ
  const once = sk('単発', { mult:1, proc:100, ail:{ key:'bleed', chance:100 } })
  const me2 = createSide(fighter('狂戦士', [{ skill: once, uses:9 }]))
  const foe2 = createSide(fighter('的'))
  takeAction(me2, foe2, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(foe2.ail.bleed.stacks, 1)
})

test('すてみ：現在HPの10%を払って撃つ（払っても死なない）', () => {
  assert.equal(SKILL_BY_NAME['すてみ'].hpCostPct, 10)
  const heavy = sk('捨て身', { mult:1, proc:100, hpCostPct:10 })
  const me = createSide(fighter('狂戦士', [{ skill: heavy, uses:9 }]))
  const foe = createSide(fighter('的'))
  const hp0 = me.hp
  const log = []
  takeAction(me, foe, () => 0.5, log, { idx: 0, noProc: true })
  assert.equal(me.hp, hp0 - Math.floor(hp0 * 0.1))
  assert.equal(log.find(l => l.type === 'hpCost').damage, Math.floor(hp0 * 0.1))
  // HPが1のときは払わない（自滅しない）
  me.hp = 1
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(me.hp, 1)
})

test('狂心：4ターンSTR+70%、そのあいだ出る技がランダムになる', () => {
  const kyo = SKILL_BY_NAME['狂心']
  assert.deepEqual(kyo.frenzy, { turns:4 })
  assert.deepEqual(kyo.buff, { self:{ str:70 } })
  assert.equal(kyo.buffTurns, 4)
  const atkA = sk('技A', { mult:1, proc:100 })
  const atkB = sk('技B', { mult:1, proc:100 })
  const me = createSide({ name:'狂', cls:'狂戦士', kind:'phys', stats: evenStats(534), slots: [{ skill: kyo, uses:9 }, { skill: atkA, uses:99 }, { skill: atkB, uses:99 }] })
  const foe = createSide(fighter('的'))
  const before = liveStats(me).str
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(me.frenzy.turns, 4)
  assert.equal(liveStats(me).str - before, Math.round(me.base.str * 0.7), 'STR+70%（素のSTRに対して足す）')
  // 狙った枠（技A）を指定しても、狂乱中はランダムに選ばれる
  const names = new Set()
  for (let i = 0; i < 12; i++) {
    const log = []
    const rng = ((n) => () => (n = (n * 1103515245 + 12345) % 2147483648) / 2147483648)(i + 1)
    takeAction(me, foe, rng, log, { idx: 1, noProc: true })
    const l = log.find(x => x.type === 'skill')
    if (l) names.add(l.skill)
  }
  assert.ok(names.size >= 2, `狂乱中なのに固定されている（${[...names].join(',')}）`)
  // 4ターンで切れる
  for (let i = 0; i < 4; i++) tickForesight(me)
  assert.equal(me.frenzy, null, '4ターンで狂乱が切れる')
  assert.equal(me.timedBuffs.length, 0, 'STR+70%も4ターンで切れる')
  assert.equal(liveStats(me).str, before)
})

test('血啜り：相手が出血しているときだけ吸収する（自分で撒いた出血では吸えない）', () => {
  const chi = SKILL_BY_NAME['血啜り']
  assert.deepEqual(chi.drainIfAil, { key:'bleed', pct:60 })
  const suck = sk('血啜り', { mult:1, proc:100, drainIfAil:{ key:'bleed', pct:60 } })
  const run = (bleeding) => {
    const me = createSide({ name:'狂', cls:'狂戦士', kind:'phys', stats: evenStats(534), slots:[{ skill: suck, uses:9 }] })
    const foe = createSide(fighter('的'))
    me.hp = Math.floor(me.base.hp / 2)
    if (bleeding) inflict(foe.ail, 'bleed')
    const before = me.hp
    const log = []
    takeAction(me, foe, () => 0.5, log, { idx: 0, noProc: true })
    return { healed: me.hp - before, drain: log.find(l => l.type === 'skill').drain }
  }
  const off = run(false)
  const on = run(true)
  assert.equal(off.healed, 0, '出血していなければ吸えない')
  assert.ok(on.healed > 0, '出血していれば吸える')
  assert.equal(on.drain, on.healed)
})

test('追い討ち：相手のHPが低いほど威力が上がる（20%以下で最大+50%）', () => {
  const oi = SKILL_BY_NAME['追い討ち']
  assert.deepEqual(oi.lowHpBonus, { max:50, at:20 })
  const foe = createSide(fighter('的'))
  const at = (hpPct) => { foe.hp = foe.base.hp * hpPct / 100; return lowHpMultOf(oi, foe) }
  assert.equal(at(100), 1)
  assert.equal(Number(at(60).toFixed(3)), 1.25, 'HP60%で+25%')
  assert.equal(at(20), 1.5, 'HP20%で最大')
  assert.equal(at(5), 1.5, 'それ以下は伸びない')
  // 効果の無い技には掛からない
  assert.equal(lowHpMultOf(sk('ふつう'), foe), 1)
})

// ★2026-08-23：17職のコンセプト（バッチ1）。仕組みごとに1本ずつ回帰テストを置く
test('聖職者：自分のHPが高いほど威力が上がる（満タンで最大+40%）', () => {
  const j = SKILL_BY_NAME['ジャッジライト']
  assert.deepEqual(j.highHpBonus, { max:40, at:50 })
  const me = createSide(fighter('聖'))
  const at = (hpPct) => { me.hp = me.base.hp * hpPct / 100; return highHpMultOf(j, me) }
  assert.equal(at(100), 1.4, '満タンで最大')
  assert.equal(Number(at(75).toFixed(3)), 1.2, '中間は半分')
  assert.equal(at(50), 1, '半分より下は伸びない')
  assert.equal(at(10), 1)
  assert.equal(highHpMultOf(sk('ふつう'), me), 1)
})

test('異端審問官：相手のバフの数だけ威力が上がる／確率でバフを1つ消す', () => {
  const h = SKILL_BY_NAME['ヘレティックハント']
  const foe = createSide(fighter('的'))
  assert.equal(vsBuffMultOf(h, foe), 1, 'バフが無ければ素')
  foe.buffs.str = 30; foe.buffs.agi = 20
  assert.equal(buffCountOf(foe), 2)
  assert.equal(Number(vsBuffMultOf(h, foe).toFixed(3)), 1.3, '2つで+30%')
  foe.buffs.dex = 20; foe.buffs.vit = 20
  assert.equal(Number(vsBuffMultOf(h, foe).toFixed(3)), 1.45, '上限は3つぶん')
  foe.buffs.int_stat = -30
  assert.equal(buffCountOf(foe), 4, 'デバフ（マイナス）は数えない')
  // バフ消去：必ず当たる乱数で1つ消える
  const me = createSide({ name:'審', cls:'異端審問官', kind:'mag', stats: evenStats(534),
    slots:[{ skill: SKILL_BY_NAME['サイレンスチェイン'], uses:9 }] })
  const before = buffCountOf(foe)
  const log = []
  takeAction(me, foe, () => 0, log, { idx: 0, noProc: true })
  assert.equal(buffCountOf(foe), before - 1)
  assert.ok(log.some(l => l.type === 'dispel'))
})

test('魔銃士・精霊召喚士：同じ技を続けて撃つほど威力が上がる（別の技を挟むと戻る）', () => {
  const rapid = SKILL_BY_NAME['ラピッドショット']
  const me = createSide({ name:'銃', cls:'魔銃士', kind:'phys', stats: evenStats(534),
    slots:[{ skill: rapid, uses:9 }, { skill: sk('よそ見'), uses:9 }] })
  const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
  const mult = []
  for (let i = 0; i < 4; i++) {
    takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
    mult.push(Number(repeatMultOf(rapid, me).toFixed(3)))
  }
  assert.deepEqual(mult, [1, 1.1, 1.2, 1.3], '1回目は素・3回目以降は頭打ち')
  takeAction(me, foe, () => 0.5, [], { idx: 1, noProc: true })   // 別の技を挟む
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(repeatMultOf(rapid, me), 1, '挟んだら戻る')
})

test('魔法剣士：物理と魔法を交互に振ると威力が上がる', () => {
  const ten = SKILL_BY_NAME['天魔閃']      // phys
  const mana = SKILL_BY_NAME['マナバースト']  // mag
  assert.equal(ten.switchKind, 30)
  assert.equal(switchKindMultOf(ten, null), 1, '1手目は素')
  assert.equal(switchKindMultOf(ten, 'mag'), 1.3, '直前が魔法なら乗る')
  assert.equal(switchKindMultOf(ten, 'phys'), 1, '同じ種別なら乗らない')
  assert.equal(switchKindMultOf(mana, 'phys'), 1.3)
  assert.equal(switchKindMultOf(sk('ふつう'), 'mag'), 1)
  // 実戦：交互に振ると2手目から伸びる
  const me = createSide({ name:'魔剣', cls:'魔法剣士', kind:'phys', stats: evenStats(534),
    slots:[{ skill: mana, uses:9 }, { skill: ten, uses:9 }] })
  const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
  const dmg = []
  for (const idx of [1, 0, 1]) {
    const log = []
    takeAction(me, foe, () => 0.5, log, { idx, noProc: true })
    dmg.push(log.find(l => l.type === 'skill').damage)
  }
  assert.ok(dmg[2] > dmg[0], '魔法を挟んだあとの天魔閃のほうが強い')
})

test('ギャンブラー：威力が振れる（1行動につき1回だけ振る）', () => {
  const jack = SKILL_BY_NAME['ジャックポット']
  assert.deepEqual(jack.variance, { lo:30, hi:200 })
  assert.equal(Number(varianceMultOf(jack, () => 0).toFixed(3)), 0.3, '最低')
  assert.equal(Number(varianceMultOf(jack, () => 0.999999).toFixed(2)), 2, '最高')
  assert.equal(varianceMultOf(sk('ふつう'), () => 0), 1)
  // 実戦：振れ幅がちゃんとダメージまで届いている（振れない技と比べる）
  const spread = (skill) => {
    const me = createSide({ name:'博', cls:'ギャンブラー', kind:'phys', stats: evenStats(534),
      slots:[{ skill, uses:999 }] })
    const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 9 }))
    const rng = makeRng(7)
    const d = []
    for (let i = 0; i < 60; i++) {
      const log = []
      takeAction(me, foe, rng, log, { idx: 0, noProc: true, noParalyze: true })
      const hit = log.find(l => l.type === 'skill')
      if (hit?.damage) d.push(hit.damage)
    }
    return Math.max(...d) / Math.min(...d)
  }
  // クリティカルでも多少は開くので、**振れ幅ぶんだけ余計に開くこと**を見る
  const flat = spread({ ...jack, variance: undefined })
  assert.ok(spread(jack) > flat * 1.8, `振れ幅のぶん開いていない: ${spread(jack).toFixed(2)} vs ${flat.toFixed(2)}`)
})

test('武僧：受ける状態異常が効きづらい', () => {
  const shin = SKILL_BY_NAME['心身一如']
  assert.equal(shin.passive.ailResist, 20)
  const monk = createSide({ name:'僧', cls:'武僧', kind:'phys', stats: evenStats(534),
    slots:[{ skill: shin, uses:9 }] })
  assert.equal(monk.pa.ailResist, 20)
  const plain = createSide(fighter('的'))
  assert.equal(plain.pa.ailResist, 0)
  // 付与率のすぐ内側（20%ぶん）でだけ差が出る乱数を選ぶ
  const poison = sk('毒針', { ail:{ key:'poison', chance:30 } })
  const hit = (target) => {
    const me = createSide(fighter('攻', [{ skill: poison, uses:9 }]))
    takeAction(me, target, () => 0.2, [], { idx: 0, noProc: true })
    return !!target.ail.poison
  }
  assert.equal(hit(plain), true, 'ふつうは入る')
  assert.equal(hit(monk), false, '武僧は弾く')
})

// ★2026-08-23：職業ごとのコンセプト（バッチ2）
test('元素使い：直前に使った技との組み合わせで威力が上がる', () => {
  const bolt = SKILL_BY_NAME['ライトニングボルト']
  assert.deepEqual(bolt.combo.after, ['アクアショット', 'アイスプリズン'])
  assert.equal(comboMultOf(bolt, null), 1, '1手目は素')
  assert.equal(comboMultOf(bolt, 'アクアショット'), 1.35, '水のあとなら乗る')
  assert.equal(comboMultOf(bolt, 'アースクエイク'), 1, '噛み合わなければ乗らない')
  assert.equal(comboMultOf(sk('ふつう'), 'アクアショット'), 1)
  // 実戦：アクアショット→ライトニングボルト の順で撃つと伸びる
  const dmg = (slots, idxs) => {
    const me = createSide({ name:'元', cls:'元素使い', kind:'mag', stats: evenStats(534), slots })
    const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
    let last = 0
    for (const idx of idxs) {
      const log = []
      takeAction(me, foe, () => 0.5, log, { idx, noProc: true })
      last = log.find(l => l.type === 'skill').damage
    }
    return last
  }
  const slots = [{ skill: SKILL_BY_NAME['アクアショット'], uses:9 }, { skill: bolt, uses:9 }]
  assert.ok(dmg(slots, [0, 1]) > dmg(slots, [1, 1]), '水のあとの雷のほうが強い')
})

test('体術師：跳び上がると空中・空中から叩きつけると伸びて着地する', () => {
  const jump = SKILL_BY_NAME['飛天三角蹴り']
  const drop = SKILL_BY_NAME['崩落蹴']
  assert.equal(jump.airUp, true)
  assert.equal(drop.whileAir.mult, 45)
  assert.equal(airMultOf(drop, false), 1, '地上では乗らない')
  assert.equal(airMultOf(drop, true), 1.45, '空中なら乗る')
  assert.equal(airMultOf(sk('ふつう'), true), 1)
  const me = createSide({ name:'体', cls:'体術師', kind:'phys', stats: evenStats(534),
    slots:[{ skill: jump, uses:9 }, { skill: drop, uses:9 }, { skill: SKILL_BY_NAME['半月蹴り'], uses:9 }] })
  const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
  assert.equal(me.air, false)
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(me.air, true, '跳び上がった')
  takeAction(me, foe, () => 0.5, [], { idx: 1, noProc: true })
  assert.equal(me.air, false, '叩きつけて着地した')
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  takeAction(me, foe, () => 0.5, [], { idx: 2, noProc: true })
  assert.equal(me.air, false, 'ふつうに殴っても着地する')
  assert.equal(AIR_EVA, 10)
})

test('式神使い：儀式で呪力を練り、切り札で全部使う', () => {
  const kekkai = SKILL_BY_NAME['陰陽結界']
  const kami = SKILL_BY_NAME['禁術・神降ろし']
  assert.equal(kekkai.ritual, 1)
  assert.equal(kami.useRitual.per, 40)
  assert.equal(stackMultOf(kami.useRitual, 0), 1, '呪力が無ければ素')
  assert.equal(Number(stackMultOf(kami.useRitual, 2).toFixed(3)), 1.8, '2つで+80%')
  const me = createSide({ name:'式', cls:'式神使い', kind:'mag', stats: evenStats(534),
    slots:[{ skill: kekkai, uses:9 }, { skill: kami, uses:9 }, { skill: SKILL_BY_NAME['式神召喚'], uses:1 }] })
  const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
  assert.equal(me.ritual, 1, '式神召喚：始めから1つ持っている')
  for (let i = 0; i < 5; i++) takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(me.ritual, STACK_MAX, '上限で止まる')
  const log = []
  takeAction(me, foe, () => 0.5, log, { idx: 1, noProc: true })
  assert.equal(me.ritual, 0, '切り札で全部使う')
  assert.ok(log.find(l => l.type === 'skill').damage > 0)
})

test('竜騎士：竜気を溜めると硬くなり、切り札で全部使う', () => {
  const roar = SKILL_BY_NAME['ドラゴンロア']
  const finish = SKILL_BY_NAME['天墜竜閃']
  assert.equal(roar.chargeUp, true)
  assert.equal(finish.useCharge.per, 35)
  const me = createSide({ name:'竜', cls:'竜騎士', kind:'phys', stats: evenStats(534),
    slots:[{ skill: roar, uses:9 }, { skill: finish, uses:9 }] })
  const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
  assert.equal(chargeGuardOf(me), 1)
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(me.charge, 1)
  assert.equal(Number(chargeGuardOf(me).toFixed(3)), 1.12, '溜めているあいだは軽減率が上がる')
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  const log = []
  takeAction(me, foe, () => 0.5, log, { idx: 1, noProc: true })
  assert.equal(me.charge, 0, '切り札で全部使う')
  assert.ok(log.find(l => l.type === 'skill').damage > 0)
})

test('サイキッカー：相手の特防で受けるが、威力はSTR参照', () => {
  const shot = SKILL_BY_NAME['サイコショット']
  assert.equal(shot.kind, 'mag')
  assert.equal(shot.srcKind, 'phys')
  const hit = (myStats, foeStats) => {
    const me = createSide({ name:'念', cls:'サイキッカー', kind:'mag', stats: myStats, slots:[{ skill: shot, uses:9 }] })
    const foe = createSide({ name:'的', cls:'戦士', kind:'phys', stats: { ...foeStats, hp: 10 ** 7 }, slots: [] })
    const log = []
    takeAction(me, foe, () => 0.5, log, { idx: 0, noProc: true })
    return log.find(l => l.type === 'skill').damage
  }
  const base = evenStats(534)
  assert.ok(hit({ ...base, str: base.str * 2 }, base) > hit(base, base), 'STRを積むと伸びる')
  // 受ける側：特殊として受けるので、VITよりINT（特防）のほうがよく効く
  assert.ok(hit(base, { ...base, int_stat: base.int_stat * 3 }) < hit(base, base), '特防で減る')
  assert.ok(hit(base, { ...base, vit: base.vit * 3 }) > hit(base, { ...base, int_stat: base.int_stat * 3 }),
    'VITを積むより特防を積んだほうが減らせる')
})

test('賢者：他職スキルのペナルティが半分（オールラウンダー）', () => {
  const kata = SKILL_BY_NAME['居合斬']            // 侍のスキル
  assert.equal(offClassMult('侍', kata), 1, '本職はそのまま')
  assert.equal(offClassMult('狩人', kata), OFF_CLASS_MULT)
  assert.equal(Number(offClassMult('賢者', kata, 50).toFixed(3)), 0.9, '0.8のペナルティが半分')
  assert.equal(mpOf('狩人', kata), kata.mp * OFF_CLASS_MP_MULT)
  assert.equal(mpOf('賢者', kata, 50), kata.mp * 1.5, '追加MPも半分')
  // 実戦：同じステ・同じ技でも、賢者のほうが他職スキルをうまく振れる
  const dmg = (cls) => {
    const me = createSide({ name: cls, cls, kind:'phys', stats: evenStats(534), slots:[{ skill: kata, uses:9 }] })
    const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
    const log = []
    takeAction(me, foe, () => 0.5, log, { idx: 0, noProc: true })
    return log.find(l => l.type === 'skill').damage
  }
  assert.ok(dmg('賢者') > dmg('狩人'), '賢者のほうが他職スキルで強い')
  assert.ok(dmg('賢者') < dmg('侍'), 'それでも本職には及ばない')
})

test('賢者：ディスペルウェーブは名前どおりバフを剥がす', () => {
  const wave = SKILL_BY_NAME['ディスペルウェーブ']
  assert.equal(wave.dispel.chance, 25)
  const me = createSide({ name:'賢', cls:'賢者', kind:'mag', stats: evenStats(534), slots:[{ skill: wave, uses:9 }] })
  const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
  foe.buffs.agi = 30   // この技自身のデバフ（STR/INT-20%）と混ざらないステで見る
  const log = []
  takeAction(me, foe, () => 0, log, { idx: 0, noProc: true })
  assert.ok(log.some(l => l.type === 'dispel'), 'バフ消去が出ていない')
  assert.equal(foe.buffs.agi, undefined)
})

// ★2026-08-23：ビーストレンジャー＝呼んでいる獣で「型」が変わる
test('ビーストレンジャー：獣を呼ぶと型が変わり、型のあいだステータスが上がる', () => {
  const hawk = SKILL_BY_NAME['ホークダイブ']
  const bear = SKILL_BY_NAME['ベアクロー']
  assert.equal(hawk.form, 'hawk')
  assert.equal(bear.form, 'bear')
  assert.deepEqual(BEAST_FORMS.hawk.stats, { agi:20, dex:15 })
  const me = createSide({ name:'獣', cls:'ビーストレンジャー', kind:'phys', stats: evenStats(534),
    slots:[{ skill: hawk, uses:9 }, { skill: bear, uses:9 }] })
  const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
  const agi0 = liveStats(me).agi
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.equal(me.form, 'hawk', '鷹を呼んだ')
  const agi1 = liveStats(me).agi
  assert.ok(agi1 > agi0, '鷹の型でAGIが上がる')
  // 張り替えると前の型の補正は消える
  takeAction(me, foe, () => 0.5, [], { idx: 1, noProc: true })
  assert.equal(me.form, 'bear', '熊へ張り替えた')
  assert.equal(liveStats(me).agi, agi0, '鷹のぶんは消えている')
  assert.ok(liveStats(me).str > liveStats(createSide({ name:'素', cls:'ビーストレンジャー', kind:'phys', stats: evenStats(534), slots:[] })).str)
})

test('ビーストレンジャー：同じ獣を続けて呼ぶと威力+25%', () => {
  const hawk = SKILL_BY_NAME['ホークダイブ']
  assert.equal(BEAST_BONUS, 25)
  assert.equal(beastMultOf(hawk, null), 1, '呼んでいなければ素')
  assert.equal(beastMultOf(hawk, 'bear'), 1, '別の獣からの張り替えは素')
  assert.equal(beastMultOf(hawk, 'hawk'), 1.25, '型が合っていれば乗る')
  assert.equal(beastMultOf(sk('ふつう'), 'hawk'), 1)
})

test('ビーストレンジャー：野性の勘は型の補正を1.5倍にする', () => {
  const kan = SKILL_BY_NAME['野性の勘']
  assert.equal(kan.passive.formBoost, 50)
  const make = (withPassive) => createSide({ name:'獣', cls:'ビーストレンジャー', kind:'phys', stats: evenStats(534),
    slots: withPassive ? [{ skill: kan, uses:1 }, { skill: SKILL_BY_NAME['ホークダイブ'], uses:9 }]
      : [{ skill: SKILL_BY_NAME['ホークダイブ'], uses:9 }] })
  const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
  const agiAfterCall = (withPassive) => {
    const me = make(withPassive)
    const before = liveStats(me).agi
    takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
    return liveStats(me).agi - before
  }
  const plain = agiAfterCall(false)
  const boosted = agiAfterCall(true)
  assert.ok(boosted > plain, '野性の勘のぶん伸びる')
  assert.equal(Math.round((boosted / plain) * 10) / 10, 1.5)
})

test('ビーストレンジャー：ビーストコールは呼んでいる獣で中身が変わる', () => {
  const call = SKILL_BY_NAME['ビーストコール']
  const hawk = SKILL_BY_NAME['ホークダイブ']
  assert.deepEqual(call.formBuff.bear, { str:35, vit:20 })
  const foe = createSide(fighter('的', [], { ...evenStats(534), hp: 10 ** 7 }))
  // 獣を呼んでいなければ素のSTRバフ
  const me = createSide({ name:'獣', cls:'ビーストレンジャー', kind:'phys', stats: evenStats(534),
    slots:[{ skill: call, uses:9 }, { skill: hawk, uses:9 }] })
  const str0 = me.buffs.str || 0, agi0 = me.buffs.agi || 0   // 職業補正のぶんが最初から乗っている
  takeAction(me, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.ok(me.buffs.str > str0, '呼んでいなければSTR')
  assert.equal(me.buffs.agi || 0, agi0, 'AGIには乗らない')
  // 鷹を呼んでから使うとAGI側になる
  const me2 = createSide({ name:'獣', cls:'ビーストレンジャー', kind:'phys', stats: evenStats(534),
    slots:[{ skill: call, uses:9 }, { skill: hawk, uses:9 }] })
  takeAction(me2, foe, () => 0.5, [], { idx: 1, noProc: true })
  const agiBefore = me2.buffs.agi || 0
  takeAction(me2, foe, () => 0.5, [], { idx: 0, noProc: true })
  assert.ok((me2.buffs.agi || 0) > agiBefore, '鷹ならAGIが乗る')
})

// ★2026-08-23：出血・毒は割合ダメージなので、HPが桁違いの相手（ユニークボス・レイド）では
//   直接攻撃の10倍以上になっていた。1刻みに「付けた側の攻撃力から決まる上限」を入れた
test('出血・毒の1刻みは、付けた側の攻撃力を超えて伸びない', () => {
  const stats = evenStats(534)
  const poisonSkill = sk('毒針', { ail:{ key:'poison', chance:100 }, mult:0.01 })
  const bleedSkill  = sk('切り裂き', { ail:{ key:'bleed', chance:100 }, mult:0.01 })
  const tickOn = (skill, foeHp, times = 1) => {
    const me = createSide(fighter('攻', [{ skill, uses:99 }]))
    const foe = createSide(fighter('的', [], { ...stats, hp: foeHp }))
    for (let i = 0; i < times; i++) takeAction(me, foe, () => 0.01, [], { idx: 0, noProc: true })
    const log = []
    tickAil(foe, log, me)
    return log.filter(l => l.type === 'ailTick').reduce((t, l) => t + l.damage, 0)
  }
  const atk = liveStats(createSide(fighter('攻', []))).str
  // ふつうの相手（同格）なら割合のまま＝出目は変わらない
  const normal = tickOn(poisonSkill, stats.hp)
  assert.ok(normal < atk * POISON_CAP_RATE, `同格相手では上限に当たらないはず: ${normal}`)
  assert.ok(Math.abs(normal - stats.hp * 0.03) <= 2, '同格相手は最大HPの3%のまま')
  // HPが桁違いの相手でも、上限で止まる
  const boss = tickOn(poisonSkill, 10 ** 7)
  assert.ok(boss <= Math.floor(atk * POISON_CAP_RATE), `毒の上限が効いていない: ${boss}`)
  // 出血もスタックぶんだけ伸びるが、1スタックあたりの上限がある
  const b1 = tickOn(bleedSkill, 10 ** 7, 1)
  const b3 = tickOn(bleedSkill, 10 ** 7, 3)
  assert.ok(b1 <= Math.floor(atk * BLEED_CAP_RATE) + 1, `出血1スタックの上限が効いていない: ${b1}`)
  assert.ok(b3 > b1 * 2, 'スタックを積んだぶんは伸びる')
  assert.ok(b3 <= Math.floor(atk * BLEED_CAP_RATE * 3) + 1, `出血3スタックの上限が効いていない: ${b3}`)
})
