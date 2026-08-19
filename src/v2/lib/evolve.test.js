// バトルフロンティアⅡ 武器の進化（戦闘記憶）の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGES, MAX_STAGE, STAGE_CAP, TRAITS, TRAIT_BY_KEY, LOW_HP_PCT, FOES_KEEP,
  stageOf, nextStageAt, emptyRecord, recordOfBattle, mergeRecord,
  strengthOf, pickTrait, makeEvolution, pendingStage, evolutionText,
} from './evolve.js'

const rec = (over = {}) => ({ ...emptyRecord(), ...over })

test('段階は3つ。節目を越えるたびに1つ増える', () => {
  assert.deepEqual(STAGES, [100, 500, 2000])
  assert.equal(MAX_STAGE, 3)
  assert.equal(stageOf(0), 0)
  assert.equal(stageOf(99), 0)
  assert.equal(stageOf(100), 1)
  assert.equal(stageOf(499), 1)
  assert.equal(stageOf(500), 2)
  assert.equal(stageOf(2000), 3)
  assert.equal(stageOf(99999), 3, '最後まで行ったら増えない')
  assert.equal(nextStageAt(0), 100)
  assert.equal(nextStageAt(100), 500)
  assert.equal(nextStageAt(2000), null)
})

test('1戦ぶんの戦績を戦闘ログから作る', () => {
  const YOU = 'おれおれお', FOE = '盗賊'
  const r = {
    winner: 'a', turns: 4,
    a: { hp: 100, base: { hp: 1000 } },
    log: [
      { side: YOU, type:'skill',  hits:1, crit:true },
      { side: YOU, type:'normal', hit:true },
      { side: YOU, type:'skill',  hits:0 },            // 外した＝当てた数に入らない
      { side: FOE, type:'normal', hit:true },
      { side: FOE, type:'skill',  hits:0 },            // かわした
      { side: FOE, type:'ailment', ail:'毒' },          // 相手にかかった＝こちらが入れた
      { side: YOU, type:'ailment', ail:'出血' },        // こちらがかかった＝数えない
    ],
  }
  const out = recordOfBattle(r, YOU, FOE, { myPower: 100, foePower: 200 })
  assert.equal(out.battles, 1)
  assert.equal(out.hits, 2, '当てたのは2回')
  assert.equal(out.crit, 1)
  assert.equal(out.taken, 2, '受けた攻撃は2回')
  assert.equal(out.dodged, 1)
  assert.equal(out.ail, 1, '相手に入れたぶんだけ数える')
  assert.equal(out.wins, 1)
  assert.equal(out.turns, 4)
  assert.deepEqual(out.foes, { 盗賊: 1 })
  // 残HP10% ≦ 30% なので薄氷、相手のほうが戦闘力が上なので巨人殺し
  assert.equal(out.lowWin, 1)
  assert.equal(out.bigWin, 1)
})

test('負けた戦いは勝ち数にも敵の記録にも入らない', () => {
  const out = recordOfBattle({ winner:'b', turns:3, a:{ hp:0, base:{ hp:1000 } }, log:[] }, 'me', '敵')
  assert.equal(out.battles, 1, '戦った回数は増える')
  assert.equal(out.wins, 0)
  assert.equal(out.lowWin, 0)
  assert.equal(out.bigWin, 0)
  assert.deepEqual(out.foes, {})
})

test('HPが残っていれば薄氷にならない', () => {
  const win = (hp) => recordOfBattle({ winner:'a', turns:3, a:{ hp, base:{ hp:1000 } }, log:[] }, 'me', '敵').lowWin
  assert.equal(LOW_HP_PCT, 30)
  assert.equal(win(299), 1)
  assert.equal(win(300), 1, 'ちょうど30%は薄氷に数える')
  assert.equal(win(301), 0)
})

test('戦績は足し合わせられる。敵の記録は上位だけ残す', () => {
  const a = rec({ battles:2, hits:10, crit:3, foes:{ 'A':2, 'B':1 } })
  const b = rec({ battles:1, hits:5,  crit:1, foes:{ 'B':4 } })
  const m = mergeRecord(a, b)
  assert.equal(m.battles, 3)
  assert.equal(m.hits, 15)
  assert.equal(m.crit, 4)
  assert.deepEqual(m.foes, { 'B':5, 'A':2 })
  // ★際限なく増やさない
  const many = {}
  for (let i = 0; i < 40; i++) many['敵' + i] = i
  const big = mergeRecord(emptyRecord(), rec({ foes: many }))
  assert.equal(Object.keys(big.foes).length, FOES_KEEP)
  assert.equal(big.foes['敵39'], 39, 'いちばん多いものは残る')
  assert.equal(big.foes['敵0'], undefined, 'いちばん少ないものは落ちる')
  // 空から足しても壊れない
  assert.equal(mergeRecord(null, rec({ battles:1 })).battles, 1)
  assert.equal(mergeRecord(rec({ battles:1 }), null).battles, 1)
})

test('★戦い方の偏りがそのまま能力になる', () => {
  const base = { battles:600, hits:2000, taken:2000, wins:500, turns:5000 }
  const pick = (over) => pickTrait(rec({ ...base, ...over }))?.trait.key
  assert.equal(pick({ crit: 800 }), 'crit',    'クリで押してきた')
  assert.equal(pick({ dodged: 900 }), 'eva',   'かわし続けてきた')
  assert.equal(pick({ ail: 700 }), 'ail',      '状態異常を撒いてきた')
  assert.equal(pick({ lowWin: 300 }), 'endure','ギリギリで勝ってきた')
  assert.equal(pick({ bigWin: 350 }), 'giant', '格上に挑んできた')
  assert.equal(pick({ foes: { '盗賊': 400 } }), 'slayer', '同じ敵を狩り続けた')
  // 決着が速い＝疾き刃（他の偏りが無いとき）
  assert.equal(pick({ battles:600, turns:1800 }), 'swift')
})

test('偏りが強いほど大きい値が付く。段階ごとの上限は超えない', () => {
  assert.deepEqual(STAGE_CAP, [6, 10, 15])
  const base = { battles:600, hits:2000, taken:2000, wins:500, turns:6600 }
  const strong = rec({ ...base, crit: 2000 })   // クリ率100%＝振り切り
  const weak   = rec({ ...base, crit: 100 })    // クリ率5%＝素のまま
  const s1 = makeEvolution(strong, 1, [])
  const w1 = makeEvolution(weak, 1, [])
  assert.equal(s1.key, 'crit')
  assert.equal(s1.value, STAGE_CAP[0], '振り切っていれば上限まで乗る')
  assert.ok(w1.value < s1.value, '偏りが弱ければ小さい')
  assert.ok(w1.value >= 1, '節目まで使ったのに0%にはしない')
  // 段階が上がると上限も上がる
  assert.equal(makeEvolution(strong, 2, []).value, STAGE_CAP[1])
  assert.equal(makeEvolution(strong, 3, []).value, STAGE_CAP[2])
})

test('★同じ能力は2回付かない（次に強い偏りへ回る）', () => {
  const r = rec({ battles:600, hits:2000, crit:1500, taken:2000, dodged:1200, wins:500, turns:6600 })
  const e1 = makeEvolution(r, 1, [])
  const e2 = makeEvolution(r, 2, [e1.key])
  const e3 = makeEvolution(r, 3, [e1.key, e2.key])
  assert.equal(e1.key, 'crit')
  assert.equal(e2.key, 'eva')
  assert.notEqual(e3.key, e1.key)
  assert.notEqual(e3.key, e2.key)
})

test('宿敵狩りは相手の名前まで決まる', () => {
  const r = rec({ battles:600, turns:6600, wins:500, foes:{ '盗賊':400, 'スライム':50 } })
  const ev = makeEvolution(r, 1, [])
  assert.equal(ev.key, 'slayer')
  assert.equal(ev.foe, '盗賊', 'いちばん多く倒した相手')
  assert.match(evolutionText(ev), /盗賊への与ダメージ/)
})

test('戦った数が少ないうちは何も付かない（まぐれで決まらない）', () => {
  // どの指標も最低本数を満たしていない
  assert.equal(pickTrait(rec({ battles:10, hits:10, crit:10, wins:5 })), null)
  assert.equal(makeEvolution(rec({ battles:10, hits:10, crit:10 }), 1, []), null)
})

test('付けられる段階が分かる', () => {
  assert.equal(pendingStage(rec({ battles: 99 }), []), 0)
  assert.equal(pendingStage(rec({ battles: 100 }), []), 1, '1つ目が付けられる')
  assert.equal(pendingStage(rec({ battles: 100 }), [{ stage:1 }]), 0, 'もう付けた')
  assert.equal(pendingStage(rec({ battles: 500 }), [{ stage:1 }]), 2)
  assert.equal(pendingStage(rec({ battles: 2000 }), [{ stage:1 }, { stage:2 }]), 3)
  assert.equal(pendingStage(rec({ battles: 99999 }), [{ stage:1 }, { stage:2 }, { stage:3 }]), 0, '3つで打ち止め')
})

test('表示用の文が全キーで作れる', () => {
  for (const t of TRAITS) {
    const ev = { stage:1, key:t.key, value:3.4, foe: t.key === 'slayer' ? '盗賊' : undefined }
    const s = evolutionText(ev)
    assert.ok(s.includes(t.name), t.key + ' に名前が無い')
    assert.ok(s.includes('3.4%'), t.key + ' に値が無い')
  }
  assert.equal(evolutionText({ key:'知らないキー' }), '')
  assert.equal(evolutionText(null), '')
  // キーの引き表と本体がそろっている
  assert.equal(Object.keys(TRAIT_BY_KEY).length, TRAITS.length)
})

// ============================================================
// ★ここから下は「進化が本当に戦闘へ効いているか」。
//   ライブラリだけ足して戦闘へ繋ぎ忘れる事故を止めるためのテスト
//   （スキル・職業補正・装備の特殊能力と同じ扱い＝全部の戦闘に効くこと）
// ============================================================
import { runBattle } from './battle.js'
import { evoDmgPct, collectEvolutions, EVO_SWIFT_MOVES } from './evolve.js'

const makeRng = (seed) => {
  let s = seed >>> 0
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}
const evenStats = (power) => {
  const u = power / 8
  return { hp:u * 8, mp:u * 3, str:u, dex:u, agi:u, int_stat:u, vit:u, luk:u }
}
const sk = (name, over = {}) => ({ name, kind:'phys', mult:1, proc:100, mp:0, desc:'', ...over })
const guy = (name, over = {}) => ({
  name, cls:'戦士', kind:'phys', stats: evenStats(534),
  slots: [{ skill: sk('たたく'), uses: 99 }], ...over,
})
// 同じ種を10戦ぶん回して、こちらが出した数を数える
const tally = (mine, foeOver = {}) => {
  let crit = 0, dodged = 0, dmg = 0, ail = 0
  for (let seed = 1; seed <= 10; seed++) {
    const r = runBattle(mine, guy('相手', foeOver), { rng: makeRng(seed), maxTurns: 12 })
    for (const l of r.log) {
      if (l.side === mine.name && (l.type === 'skill' || l.type === 'normal')) {
        if (l.crit) crit++
        dmg += l.damage || 0
      }
      if (l.side === '相手') {
        if (l.type === 'skill' && l.hits === 0) dodged++
        if (l.type === 'normal' && !l.hit) dodged++
        if (l.type === 'ailment') ail++
      }
    }
  }
  return { crit, dodged, dmg, ail }
}

test('★見切りの冴えが戦闘のクリティカル率に効いている', () => {
  const off = tally(guy('私'))
  const on  = tally(guy('私', { evolutions: [{ stage:1, key:'crit', value:40 }] }))
  assert.ok(on.crit > off.crit, `クリが増えていない（${off.crit} → ${on.crit}）`)
})

test('★紙一重が戦闘の回避率に効いている', () => {
  const off = tally(guy('私'))
  const on  = tally(guy('私', { evolutions: [{ stage:1, key:'eva', value:40 }] }))
  assert.ok(on.dodged > off.dodged, `かわした数が増えていない（${off.dodged} → ${on.dodged}）`)
})

test('★蝕みの刃が状態異常の付与率に効いている', () => {
  const withAil = (evolutions) => tally(guy('私', {
    evolutions, slots: [{ skill: sk('毒牙', { ail: { key:'poison', chance: 10, turns: 3 } }), uses: 99 }],
  })).ail
  const off = withAil(undefined)
  const on  = withAil([{ stage:1, key:'ail', value:40 }])
  assert.ok(on > off, `状態異常が増えていない（${off} → ${on}）`)
})

test('★宿敵狩りが「その相手だけ」に効いている', () => {
  const ev = [{ stage:1, key:'slayer', value:50, foe:'相手' }]
  const off = tally(guy('私')).dmg
  const on  = tally(guy('私', { evolutions: ev })).dmg
  assert.ok(on > off, `与ダメージが増えていない（${off} → ${on}）`)
  // 名前が違えば乗らない
  const other = tally(guy('私', { evolutions: [{ stage:1, key:'slayer', value:50, foe:'別の敵' }] })).dmg
  assert.equal(other, off, '相手が違うのに乗っている')
})

test('★巨人殺しは相手のほうが戦闘力が上のときだけ乗る', () => {
  const ev = [{ stage:1, key:'giant', value:50 }]
  const big = { stats: evenStats(1200), slots: [{ skill: sk('たたく'), uses: 99 }] }
  const vsBigOff = tally(guy('私'), big).dmg
  const vsBigOn  = tally(guy('私', { evolutions: ev }), big).dmg
  assert.ok(vsBigOn > vsBigOff, `格上に乗っていない（${vsBigOff} → ${vsBigOn}）`)
  // 同格には乗らない
  assert.equal(tally(guy('私', { evolutions: ev })).dmg, tally(guy('私')).dmg, '同格に乗っている')
})

test('疾き刃は最初の数回だけ、薄氷の勝者はHPが減ってからだけ乗る', () => {
  const evo = collectEvolutions([
    { key:'swift', value:10 }, { key:'endure', value:20 }, { key:'giant', value:30 },
  ])
  assert.equal(EVO_SWIFT_MOVES, 3)
  assert.equal(evoDmgPct(evo, { moves: 3, hpPct: 100 }), 10, '3回目までは疾き刃')
  assert.equal(evoDmgPct(evo, { moves: 4, hpPct: 100 }), 0,  '4回目からは乗らない')
  assert.equal(evoDmgPct(evo, { moves: 9, hpPct: 30 }), 20,  'HP30%で薄氷')
  assert.equal(evoDmgPct(evo, { moves: 9, hpPct: 31 }), 0,   'HP31%では乗らない')
  // 条件がそろえば足し算になる
  assert.equal(evoDmgPct(evo, { moves: 1, hpPct: 10, foeBigger: true }), 60)
  assert.equal(evoDmgPct(null, { moves: 1 }), 0)
})

test('複数の武器に付いた進化は足し算になる（同じ相手の宿敵狩りも足す）', () => {
  const evo = collectEvolutions([
    { key:'crit', value:3 }, { key:'crit', value:4 },
    { key:'slayer', value:5, foe:'盗賊' }, { key:'slayer', value:6, foe:'盗賊' },
    { key:'slayer', value:7, foe:'スライム' },
    { key:'slayer', value:9 },          // 相手が決まっていない＝数えない
    { key:'知らないキー', value:99 },     // 知らないものは無視する
  ])
  assert.equal(evo.crit, 7)
  assert.deepEqual(evo.slayer, { 盗賊: 11, スライム: 7 })
  assert.equal(collectEvolutions(null).crit, 0)
})
