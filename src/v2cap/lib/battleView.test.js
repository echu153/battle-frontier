// v2cap：戦闘ログの並び（あるけみすと風）の決まりを固定するテスト（node --test）
// 【確定】2026-10-12 ユーザー指示「自分が動くときは自分のアイコンが、敵が動くときは敵のアイコンが表示されるようにして、
//   HPの横にもあるけみすと参考に載せるようにしてほしい」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCapBattleView } from './battleView.js'
import { buildBattleLog } from '../core/battleLog.js'
import { runBattle } from '../core/battle.js'
import { SPOTS, toFighter } from './areas.js'

const YOU = 'おれおれお'
const FOE = 'スライム'
const hp = (turn, a, b) => ({ type:'hp', turn, a, aMax: 100, b, bMax: 80 })
const view = (log) => buildCapBattleView({ log }, YOU, FOE)

test('ターンの頭に表（1ターン目は満タン・次からは前のターンの終わりのHP）。決着したら最後に決着の表', () => {
  const v = view([
    { side: YOU, type:'normal', hit:true, damage:30 },
    { side: FOE, type:'normal', hit:true, damage:10 },
    hp(1, 90, 50),
    { side: YOU, type:'normal', hit:true, damage:60 },
    hp(2, 90, 0),
  ])
  assert.deepEqual(v.map(x => x.kind === 'turn' ? `T${x.turn}${x.final ? '決着' : ''}:${x.me.hp}/${x.foe.hp}` : x.who), [
    'T1:100/80', 'me', 'foe', 'T2:90/50', 'me', 'T2決着:90/0',
  ])
  assert.equal(v[0].me.max, 100)
  assert.equal(v[0].foe.max, 80)
})

test('相手の行動を受けた側の行（状態異常にかかった・跳ね返した等）は、動いた側のまとまりに入る', () => {
  const v = view([
    { side: FOE, type:'skill', skill:'どくばり', hits:1, damage:12 },
    { side: YOU, type:'ailment', ail:'毒' },
    { side: YOU, type:'reflect', damage:3 },
    { side: YOU, type:'normal', hit:true, damage:20 },
    hp(1, 88, 57),
    { side: FOE, type:'normal', hit:true, damage:5 },
    hp(2, 83, 57),
  ])
  const acts = v.filter(x => x.kind === 'act')
  assert.deepEqual(acts.map(a => [a.who, a.lines.length]), [['foe', 3], ['me', 1], ['foe', 1]])
  assert.match(acts[0].lines[1].text, /毒になった/)
})

test('同じ側が続けて動いたら1つにまとめる。ターンをまたいだら分ける', () => {
  const v = view([
    { side: YOU, type:'normal', hit:true, damage:10 },
    { side: YOU, type:'extra' },
    { side: YOU, type:'normal', hit:true, damage:10 },
    hp(1, 100, 60),
    { side: YOU, type:'normal', hit:true, damage:10 },
    hp(2, 100, 50),
  ])
  assert.deepEqual(v.filter(x => x.kind === 'act').map(a => a.lines.length), [3, 1])
})

test('毒・出血のダメージやじわじわ回復（時間で起きる行）は、直前の行動とは別のまとまり。同じ側の時間の行は1つに', () => {
  const v = view([
    { side: FOE, type:'normal', hit:true, damage:10 },
    { side: FOE, type:'ailTick', ail:'毒', damage:5, stacks:1 },
    { side: FOE, type:'regenTick', heal:3 },
    { side: YOU, type:'ailTick', ail:'出血', damage:4, stacks:1 },
    hp(1, 96, 78),
  ])
  assert.deepEqual(v.filter(x => x.kind === 'act').map(a => [a.who, a.lines.length, !!a.tick]),
    [['foe', 1, false], ['foe', 2, true], ['me', 1, true]])
})

test('ターン数の上限で終わったとき（HPの記録が2件続く）は決着の表を1つだけ出す', () => {
  const v = view([
    { side: YOU, type:'normal', hit:true, damage:10 },
    hp(1, 100, 70),
    { side: YOU, type:'normal', hit:true, damage:10 },
    hp(2, 100, 60),
    hp(2, 100, 60),
  ])
  assert.deepEqual(v.filter(x => x.kind === 'turn').map(x => `${x.turn}${x.final ? '決着' : ''}`), ['1', '2', '2決着'])
})

test('本物の戦闘：行は1つも落とさず、どの行もどちらかのまとまりに入る。表は必ずターン順', () => {
  const spot = SPOTS[2]
  const [a, b] = [spot.roster.enemies[0], spot.roster.boss]
  for (let k = 0; k < 20; k++) {
    const r = runBattle({ ...toFighter(a), name: YOU }, toFighter(b))
    const v = buildCapBattleView(r, YOU, b.name)
    const want = buildBattleLog(r, YOU, b.name).filter(l => l.type !== 'hp')
    const got = v.filter(x => x.kind === 'act').flatMap(x => x.lines)
    assert.deepEqual(got, want)
    const turns = v.filter(x => x.kind === 'turn')
    assert.equal(turns[0].turn, 1)
    assert.ok(turns.at(-1).final, '最後は決着の表')
    for (let i = 1; i < turns.length - 1; i++) assert.equal(turns[i].turn, turns[i - 1].turn + 1)
    for (const x of v.filter(y => y.kind === 'act')) assert.ok(x.who === 'me' || x.who === 'foe')
  }
})

test('始まりのHP（start）を渡すと、1ターン目の表はその値から（塔の守護者は前の防衛で減ったHPから始まる・2026-10-14）', () => {
  const log = [{ side: YOU, type:'normal', hit:true, damage:30 }, hp(1, 100, 15)]
  const v = buildCapBattleView({ log }, YOU, FOE, { b: 45 })
  assert.equal(v[0].foe.hp, 45, '相手は45から')
  assert.equal(v[0].foe.max, 80, '最大HPはそのまま')
  assert.equal(v[0].me.hp, 100, '渡さなかった側は満タン')
  assert.equal(buildCapBattleView({ log }, YOU, FOE)[0].foe.hp, 80, '渡さなければ今までどおり満タン')
})
