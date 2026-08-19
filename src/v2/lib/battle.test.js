// バトルフロンティアⅡ 戦闘ループの回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBattle, createSide, peekSkill, attackKindOf, mpCostOf, NORMAL_ATTACK_MULT, MAX_TURNS, BUFF_MIN_PCT } from './battle.js'
import { INITIAL_STATS, applyExp } from './stats.js'
import { skillsOf, SKILL_BY_NAME, OFF_CLASS_MULT } from './skills.js'
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
  assert.equal(by['月影'].mult, 2.4)
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
  const buff = SKILL_BY_NAME['明鏡止水']   // 侍：STR+30%・DEX+20%
  const mine = soloRun('侍', buff).a
  const off  = soloRun('侍', asOtherClass(buff)).a
  // どちらも侍なので職業補正(STR+5%)は同じ。差はバフの幅だけ
  assert.equal(mine.buffs.str - 5, 30)
  assert.equal(mine.buffs.dex, 20)
  assert.equal(off.buffs.str - 5, 30 * OFF_CLASS_MULT)
  assert.equal(off.buffs.dex, 20 * OFF_CLASS_MULT)
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

test('発動率・消費MP・通常攻撃には0.8倍が掛からない', () => {
  // ★ここが崩れると「他職からはバフとパッシブを借りるのが得」に戻る
  const blade = asOtherClass(SKILL_BY_NAME['月影'])
  assert.equal(mpCostOf({ mp: 500 }, blade), SKILL_BY_NAME['月影'].mp, '消費MPは据え置き')
  assert.equal(blade.proc, 78, '発動率は据え置き')
  // 通常攻撃はスキルではないので対象外（不発しかしない技を積んで通常攻撃を出させる）
  const dud = { name:'不発だけ', cls:'別職', kind:'phys', mult:1, proc:0, mp:0, desc:'' }
  const na = soloRun('侍', dud).log.find(l => l.side === 'me' && l.type === 'normal')
  assert.ok(na && na.damage > 0, '通常攻撃が出ている')
})
