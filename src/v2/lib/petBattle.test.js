// バトルフロンティアⅡ ペットの種族・技・バトルの回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SPECIES, SPECIES_BY_NAME, CREATURE_WORDS, hasCreatureWord,
  learnsetOf, knownMoves, evolveTo, familyOf, STAT_ORDER, speciesOf,
} from './petSpecies.js'
import { MOVES, MOVE_BY_NAME, moveOf } from './petMoves.js'
import { TYPE_KEYS, typeMult, typeText, strongAgainst, weakAgainst } from './petTypes.js'
import {
  MOVE_SLOTS, makeFighter, makeWild, startBattle, battleTurn, chooseMove,
  battleStatsOf, growthMult, maxHpOf, stageMult, damageOf,
} from './petBattle.js'
import { PET_STAT_KEYS, addPet, setPetMoves, setActivePet, evolveAll, emptyPetState, defaultMovesOf, PARTY_MAX } from './pet.js'

const seeded = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

// ===== 種族 =====

test('ペットはちょうど200種いる', () => {
  assert.equal(SPECIES.length, 200)
})

test('名前が重複していない', () => {
  const names = SPECIES.map(s => s.name)
  assert.equal(new Set(names).size, names.length)
})

// ★[[v2-enemy-naming]] と同じ決まり。文字だけでは何か分からない名前を作らない
test('どの種の名前にも生き物の語が入っている', () => {
  const bad = SPECIES.filter(s => !hasCreatureWord(s.name)).map(s => s.name)
  assert.deepEqual(bad, [], `生き物の語がない：${bad.join('・')}`)
  assert.ok(CREATURE_WORDS.length > 50)
})

test('進化しない種もいて、その子は1段目よりずっと強い', () => {
  const solo = SPECIES.filter(s => s.stages === 1)
  assert.ok(solo.length >= 20, `進化しない種が少なすぎる（${solo.length}体）`)
  const total = (s) => STAT_ORDER.reduce((t, k) => t + s.base[k], 0)
  const soloAvg = solo.reduce((t, s) => t + total(s), 0) / solo.length
  const firsts = SPECIES.filter(s => s.stages > 1 && s.stage === 0)
  const firstAvg = firsts.reduce((t, s) => t + total(s), 0) / firsts.length
  const lasts = SPECIES.filter(s => s.stages > 1 && s.stage === s.stages - 1)
  const lastAvg = lasts.reduce((t, s) => t + total(s), 0) / lasts.length
  assert.ok(soloAvg > firstAvg * 1.4, '進化しない種が1段目と大差ない')
  assert.ok(soloAvg < lastAvg, '進化しない種が最終進化より強くなっている')
})

test('進化するたびに種族値の合計が上がる', () => {
  const total = (s) => STAT_ORDER.reduce((t, k) => t + s.base[k], 0)
  for (const sp of SPECIES) {
    if (!sp.evoTo) continue
    const next = speciesOf(sp.evoTo)
    assert.ok(total(next) > total(sp), `${sp.name}→${next.name} で強くなっていない`)
  }
})

test('進化LVは種ごとに違う', () => {
  const lvs = SPECIES.filter(s => s.evoLv).map(s => s.evoLv)
  assert.ok(new Set(lvs).size >= 8, `進化LVの種類が少なすぎる（${new Set(lvs).size}通り）`)
  assert.ok(Math.min(...lvs) >= 10, '進化が早すぎる種がいる')
})

test('進化はそのLVに届いてから', () => {
  const sp = SPECIES.find(s => s.evoTo)
  assert.equal(evolveTo(sp, sp.evoLv - 1), 0)
  assert.equal(evolveTo(sp, sp.evoLv), sp.evoTo)
  assert.equal(evolveTo(SPECIES.find(s => s.stages === 1), 99), 0, '進化しない種が進化している')
})

test('進化のつながりを最初からたどれる', () => {
  const last = SPECIES.find(s => s.stages === 3 && s.stage === 2)
  const line = familyOf(last)
  assert.equal(line.length, 3)
  assert.equal(line[2].name, last.name)
})

test('タイプは決まったものだけ', () => {
  for (const s of SPECIES) {
    assert.ok(s.types.length >= 1 && s.types.length <= 2, `${s.name}のタイプ数がおかしい`)
    for (const t of s.types) assert.ok(TYPE_KEYS.includes(t), `${s.name}に知らないタイプ ${t}`)
  }
})

test('どのタイプにも種がいる', () => {
  const used = new Set(SPECIES.flatMap(s => s.types))
  for (const t of TYPE_KEYS) assert.ok(used.has(t), `${t}タイプの種がいない`)
})

// ===== 覚える技 =====

test('どの種も4つ以上の技を覚える（編成が埋まる）', () => {
  for (const s of SPECIES) {
    const n = learnsetOf(s).length
    assert.ok(n >= MOVE_SLOTS, `${s.name}が${n}個しか覚えない`)
  }
})

test('覚える技は種ごとに違う', () => {
  const sets = SPECIES.map(s => learnsetOf(s).map(e => e.move).join(','))
  // まったく同じ組み合わせばかりにならないこと
  assert.ok(new Set(sets).size > SPECIES.length * 0.5,
    `覚える技の組み合わせが${new Set(sets).size}通りしかない`)
})

test('知らない技は覚えない', () => {
  for (const s of SPECIES) {
    for (const e of learnsetOf(s)) assert.ok(MOVE_BY_NAME[e.move], `${s.name}が知らない技 ${e.move}`)
  }
})

// ★実際に踏んだ穴。順番に並べるだけだと、自タイプの弱い技が少ない種で
//   威力120の技をLV5で覚えてしまっていた
test('強い技ほど後のLVで覚える', () => {
  for (const s of SPECIES) {
    for (const e of learnsetOf(s)) {
      const m = moveOf(e.move)
      if (m.pow >= 110) assert.ok(e.lv >= 30, `${s.name}が${m.name}(威力${m.pow})をLV${e.lv}で覚える`)
      if (m.pow >= 90) assert.ok(e.lv >= 20, `${s.name}が${m.name}(威力${m.pow})をLV${e.lv}で覚える`)
    }
  }
})

test('1段目のうちは大技を覚えない', () => {
  for (const s of SPECIES) {
    if (s.stages === 1 || s.stage > 0) continue
    for (const e of learnsetOf(s)) {
      assert.ok(moveOf(e.move).pow <= 90, `1段目の${s.name}が${e.move}を覚える`)
    }
  }
})

test('LVを上げると覚えている技が増える', () => {
  const sp = SPECIES_BY_NAME['ゴウカリス']
  assert.ok(knownMoves(sp, 60).length > knownMoves(sp, 5).length)
  assert.ok(knownMoves(sp, 1).length >= 1)
})

// ===== 技そのもの =====

test('技の名前が重複していない', () => {
  const names = MOVES.map(m => m.name)
  assert.equal(new Set(names).size, names.length)
})

test('変化技は威力0、攻撃技は威力あり', () => {
  for (const m of MOVES) {
    if (m.kind === '変化') assert.equal(m.pow, 0, `${m.name}は変化技なのに威力がある`)
    else assert.ok(m.pow > 0, `${m.name}に威力がない`)
    assert.ok(m.acc > 0 && m.acc <= 100, `${m.name}の命中がおかしい`)
    assert.ok(m.pp > 0, `${m.name}のPPが0`)
    assert.ok(TYPE_KEYS.includes(m.type), `${m.name}に知らないタイプ`)
  }
})

test('威力が高い技ほどPPが少ない', () => {
  const big = MOVES.filter(m => m.pow >= 110)
  assert.ok(big.length > 0)
  for (const m of big) assert.ok(m.pp <= 10, `${m.name}のPPが多すぎる`)
})

// ===== タイプ相性 =====

test('炎は草に強く、水に弱い', () => {
  assert.equal(typeMult('炎', ['草']), 2)
  assert.equal(typeMult('炎', ['水']), 0.5)
  assert.equal(typeMult('水', ['炎']), 2)
})

test('2タイプ持ちは掛け算になる', () => {
  assert.equal(typeMult('炎', ['草', '鋼']), 4)
  assert.equal(typeMult('炎', ['水', '岩']), 0.25)
  assert.equal(typeMult('炎', ['草', '水']), 1)
})

test('無タイプはどこにも刺さらず、どこからも刺さらない', () => {
  for (const t of TYPE_KEYS) {
    assert.equal(typeMult('無', [t]), 1, `無→${t} が等倍でない`)
    assert.equal(typeMult(t, ['無']), 1, `${t}→無 が等倍でない`)
  }
})

test('どのタイプにも得意な相手と苦手な相手がいる', () => {
  for (const t of TYPE_KEYS) {
    if (t === '無') continue
    assert.ok(strongAgainst(t).length > 0, `${t}が誰にも強くない`)
    assert.ok(weakAgainst(t).length > 0, `${t}が誰にも弱くない＝弱点なし`)
  }
})

test('効果の言い方が倍率に合っている', () => {
  assert.equal(typeText(2), '効果は抜群だ')
  assert.equal(typeText(0.5), '効果はいまひとつだ')
  assert.equal(typeText(1), '')
  assert.equal(typeText(0), '効果がない')
})

// ===== ステの決まり方 =====

test('実ステは種族値×育てたptで決まる', () => {
  const sp = SPECIES_BY_NAME['ゴウカリス']
  const none = battleStatsOf(sp, {})
  const grown = battleStatsOf(sp, Object.fromEntries(PET_STAT_KEYS.map(k => [k, 2400])))
  assert.equal(none.str, sp.base.str, '育てる前は種族値そのまま')
  assert.ok(grown.str > none.str * 7, '1か月ぶん育てても強くなっていない')
  assert.equal(growthMult(0), 1)
})

test('種族値の差はどれだけ育てても残る', () => {
  const strong = SPECIES_BY_NAME['ゴウカリス']
  const weak = SPECIES_BY_NAME['ヒノコリス']
  const cum = Object.fromEntries(PET_STAT_KEYS.map(k => [k, 5000]))
  assert.ok(battleStatsOf(strong, cum).str > battleStatsOf(weak, cum).str)
})

test('HPはVITから作る', () => {
  assert.ok(maxHpOf({ vit: 100 }) > 100)
  assert.equal(stageMult(0), 1)
  assert.equal(stageMult(2), 2)
  assert.equal(stageMult(-2), 0.5)
})

// ===== バトル =====

const fight = (aName, bName, seed = 7, cum = null) => {
  const c = cum || Object.fromEntries(PET_STAT_KEYS.map(k => [k, 800]))
  const a = SPECIES_BY_NAME[aName]
  const b = SPECIES_BY_NAME[bName]
  const me = makeFighter(a.id, c, knownMoves(a, 40).slice(-MOVE_SLOTS))
  const foe = makeFighter(b.id, c, knownMoves(b, 40).slice(-MOVE_SLOTS))
  const rng = seeded(seed)
  let s = startBattle(me, foe)
  let guard = 0
  while (!s.over && guard++ < 200) {
    const mv = chooseMove(s.me, s.foe, rng)
    if (!mv) break
    s = battleTurn(s, mv, rng)
  }
  return s
}

test('バトルは必ず決着する', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = fight('ゴウカリス', 'リュウグウガメ', seed)
    assert.equal(s.over, true, `決着しない（seed ${seed}）`)
    assert.ok(s.me.hp <= 0 || s.foe.hp <= 0)
  }
})

test('技を出すとPPが減る', () => {
  const sp = SPECIES_BY_NAME['ゴウカリス']
  const cum = Object.fromEntries(PET_STAT_KEYS.map(k => [k, 500]))
  const me = makeFighter(sp.id, cum, knownMoves(sp, 40).slice(-MOVE_SLOTS))
  const foe = makeFighter(SPECIES_BY_NAME['リュウグウガメ'].id, cum, ['たいあたり'])
  const before = me.moves[0].pp
  const s = battleTurn(startBattle(me, foe), me.moves[0].name, seeded(3))
  assert.equal(s.me.moves[0].pp, before - 1)
})

test('技は4つまで', () => {
  const sp = SPECIES_BY_NAME['ゴウカリス']
  const f = makeFighter(sp.id, {}, ['たいあたり', 'ひのこ', 'かえんほうしゃ', 'だいもんじ', 'のしかかり'])
  assert.equal(f.moves.length, MOVE_SLOTS)
})

test('弱点を突くとダメージが伸びる', () => {
  const fire = SPECIES_BY_NAME['ゴウカリス']       // 炎
  const cum = Object.fromEntries(PET_STAT_KEYS.map(k => [k, 500]))
  const atk = makeFighter(fire.id, cum, ['かえんほうしゃ'])
  const grass = makeFighter(SPECIES_BY_NAME['ジュカイガエル'].id, cum, ['たいあたり'])  // 草＝弱点
  const water = makeFighter(SPECIES_BY_NAME['リュウグウガメ'].id, cum, ['たいあたり'])  // 水＝半減
  const fixed = () => 0.5
  const a = damageOf(atk, grass, 'かえんほうしゃ', fixed)
  const b = damageOf(atk, water, 'かえんほうしゃ', fixed)
  assert.ok(a.dmg > b.dmg * 3, `弱点のほうが伸びていない（${a.dmg} vs ${b.dmg}）`)
  assert.equal(a.mult, 2)
})

test('相手は弱点を突く技を選んでくる', () => {
  const cum = Object.fromEntries(PET_STAT_KEYS.map(k => [k, 500]))
  const me = makeFighter(SPECIES_BY_NAME['ゴウカリス'].id, cum, ['たいあたり', 'かえんほうしゃ'])
  const grass = makeFighter(SPECIES_BY_NAME['ジュカイガエル'].id, cum, ['たいあたり'])
  let fire = 0
  for (let i = 0; i < 20; i++) if (chooseMove(me, grass, seeded(i + 1)) === 'かえんほうしゃ') fire++
  assert.ok(fire >= 18, `弱点を突いてこない（${fire}/20）`)
})

test('野生の相手はこちらと同じくらいの強さになる', () => {
  const cum = Object.fromEntries(PET_STAT_KEYS.map(k => [k, 1000]))
  const sp = SPECIES_BY_NAME['ヤミネコ']
  const wild = makeWild(sp.id, cum, 30, seeded(5))
  assert.ok(wild.moves.length > 0 && wild.moves.length <= MOVE_SLOTS)
  assert.ok(wild.hp > 0)
  const mine = makeFighter(sp.id, cum, knownMoves(sp, 30))
  assert.ok(wild.stats.str <= mine.stats.str, '野生のほうが必ず強くなっている')
  assert.ok(wild.stats.str > mine.stats.str * 0.5, '野生が弱すぎる')
})

test('倒れたら終わり。そのあとターンは進まない', () => {
  const s = fight('ゴウカリス', 'ヒノコリス', 11)
  const after = battleTurn(s, s.me.moves[0].name, seeded(1))
  assert.equal(after.turn, s.turn, '決着後にターンが進んでいる')
})

test('元の状態は書き換えない', () => {
  const cum = Object.fromEntries(PET_STAT_KEYS.map(k => [k, 500]))
  const me = makeFighter(SPECIES_BY_NAME['ゴウカリス'].id, cum, ['かえんほうしゃ'])
  const foe = makeFighter(SPECIES_BY_NAME['ジュカイガエル'].id, cum, ['たいあたり'])
  const s = startBattle(me, foe)
  const hpBefore = s.foe.hp
  battleTurn(s, 'かえんほうしゃ', seeded(9))
  assert.equal(s.foe.hp, hpBefore, '元の状態が書き換わっている')
})

// ===== 手持ち =====

test('仲間にすると手持ちに増え、技は既定で4つ入る', () => {
  const r = addPet(emptyPetState(), SPECIES_BY_NAME['ゴウカリス'].id, 40)
  assert.equal(r.ok, true)
  assert.equal(r.state.pets.length, 1)
  assert.equal(r.state.pets[0].moves.length, MOVE_SLOTS)
})

test('手持ちには上限がある', () => {
  let s = emptyPetState()
  for (let i = 0; i < PARTY_MAX; i++) s = addPet(s, 1, 20).state
  assert.equal(addPet(s, 1, 20).ok, false)
})

test('覚えていない技は編成に入れられない', () => {
  const sp = SPECIES_BY_NAME['ヒノコリス']
  let s = addPet(emptyPetState(), sp.id, 5).state
  s = setPetMoves(s, 0, ['たいあたり', 'だいもんじ'], 5)   // だいもんじはまだ覚えていない
  assert.deepEqual(s.pets[0].moves, ['たいあたり'])
})

test('連れている子を変えられる', () => {
  let s = addPet(emptyPetState(), 1, 20).state
  s = addPet(s, 2, 20).state
  s = setActivePet(s, 1)
  assert.equal(s.active, 1)
  assert.equal(setActivePet(s, 99).active, 1, '居ない番号では変わらない')
})

test('進化LVに届いた子だけ進化する', () => {
  const sp = SPECIES.find(s => s.evoTo && s.stages === 3 && s.stage === 0)
  let s = addPet(emptyPetState(), sp.id, 1).state
  assert.deepEqual(evolveAll(s, sp.evoLv - 1).evolved, [], '早すぎる進化')
  const r = evolveAll(s, sp.evoLv)
  assert.equal(r.evolved.length, 1)
  assert.equal(r.state.pets[0].sp, sp.evoTo)
})

test('LVが高ければ2段まとめて進化する', () => {
  const sp = SPECIES.find(s => s.stages === 3 && s.stage === 0)
  const s = addPet(emptyPetState(), sp.id, 1).state
  const r = evolveAll(s, 99)
  assert.equal(r.evolved.length, 2, '最終進化まで届いていない')
  assert.equal(speciesOf(r.state.pets[0].sp).stage, 2)
})

test('進化しない種は何度呼んでも進化しない', () => {
  const solo = SPECIES.find(s => s.stages === 1)
  const s = addPet(emptyPetState(), solo.id, 1).state
  assert.deepEqual(evolveAll(s, 99).evolved, [])
})

test('既定の技はそのLVで覚えているものだけ', () => {
  const sp = SPECIES_BY_NAME['ヒノコリス']
  const moves = defaultMovesOf(sp.id, 3)
  const learned = knownMoves(sp, 3)
  for (const m of moves) assert.ok(learned.includes(m), `${m}はLV3で覚えていない`)
})
