import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CARDS, createGame, applyAction, applyDefenseTimeout, forfeitPlayer,
  START_HP, START_MP, HAND_START, MAX_AMULETS, EVOLVE_BONUS,
} from '../src/lib/cardbattle.js'

const P4 = [
  { id: 'a', name: 'アリス' },
  { id: 'b', name: 'ボブ' },
  { id: 'c', name: 'チャコ' },
  { id: 'd', name: 'ダイ' },
]

function newGame(players = P4, seed = 42) {
  return createGame({ players, seed })
}

// 手番プレイヤーに特定カードを持たせるテスト用ヘルパー
function giveCard(state, playerId, cardId) {
  const p = state.players.find((x) => x.id === playerId)
  const uid = 'test_' + cardId + '_' + Math.floor(Math.random() * 1e9)
  p.hand.push({ uid, id: cardId })
  return uid
}
function cur(state) { return state.players[state.turnIndex] }

test('createGame: 初期状態', () => {
  const { state } = newGame()
  assert.equal(state.players.length, 4)
  for (const p of state.players) {
    assert.equal(p.hp, START_HP)
    assert.ok(p.mp >= START_MP) // 先攻はターン開始でMP回復済み
    assert.ok(p.hand.length >= HAND_START)
    assert.equal(p.alive, true)
  }
  assert.equal(state.phase, 'main')
})

test('createGame: 同seedで同一結果(決定的)', () => {
  const g1 = newGame(P4, 123)
  const g2 = newGame(P4, 123)
  assert.deepEqual(g1.state, g2.state)
})

test('2人未満・9人以上はエラー', () => {
  assert.throws(() => createGame({ players: [{ id: 'a', name: 'A' }], seed: 1 }))
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))
  assert.throws(() => createGame({ players: nine, seed: 1 }))
})

test('攻撃: 防御カードなしの相手には即着弾', () => {
  const { state } = newGame()
  const actor = cur(state)
  const target = state.players.find((p) => p.id !== actor.id)
  target.hand = [] // 防御なし
  const uid = giveCard(state, actor.id, 'iron_sword')
  const r = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
  assert.equal(r.error, undefined)
  const t2 = r.state.players.find((p) => p.id === target.id)
  assert.equal(t2.hp, START_HP - 4)
  // ターンが進んでいる
  assert.notEqual(cur(r.state).id, actor.id)
})

test('攻撃: 防御カード持ちには応戦フェーズへ', () => {
  const { state } = newGame()
  const actor = cur(state)
  const target = state.players.find((p) => p.id !== actor.id)
  target.hand = []
  giveCard(state, target.id, 'iron_shield')
  const uid = giveCard(state, actor.id, 'great_sword')
  const r = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
  assert.equal(r.state.phase, 'defense')
  assert.equal(r.state.pendingAttack.targetId, target.id)
  assert.equal(r.state.pendingAttack.dmg, 6)
})

test('応戦: ガードで軽減・使用カード消費', () => {
  const { state } = newGame()
  const actor = cur(state)
  const target = state.players.find((p) => p.id !== actor.id)
  target.hand = []
  const shieldUid = giveCard(state, target.id, 'iron_shield') // guard5
  const uid = giveCard(state, actor.id, 'great_sword') // dmg6
  const r1 = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
  const r2 = applyAction(r1.state, { type: 'defend', playerId: target.id, cardUid: shieldUid })
  assert.equal(r2.error, undefined)
  const t2 = r2.state.players.find((p) => p.id === target.id)
  assert.equal(t2.hp, START_HP - 1) // 6-5=1
  assert.equal(t2.hand.length, 0)
  assert.equal(r2.state.phase, 'main')
})

test('応戦: 回避で無効化・反射で攻撃者にダメージ', () => {
  // 回避
  {
    const { state } = newGame()
    const actor = cur(state)
    const target = state.players.find((p) => p.id !== actor.id)
    target.hand = []
    const cloak = giveCard(state, target.id, 'gale_cloak')
    const uid = giveCard(state, actor.id, 'great_sword')
    const r1 = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
    const r2 = applyAction(r1.state, { type: 'defend', playerId: target.id, cardUid: cloak })
    assert.equal(r2.state.players.find((p) => p.id === target.id).hp, START_HP)
  }
  // 反射
  {
    const { state } = newGame()
    const actor = cur(state)
    const target = state.players.find((p) => p.id !== actor.id)
    target.hand = []
    const mirror = giveCard(state, target.id, 'mirror_shield')
    const uid = giveCard(state, actor.id, 'great_sword')
    const r1 = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
    const r2 = applyAction(r1.state, { type: 'defend', playerId: target.id, cardUid: mirror })
    assert.equal(r2.state.players.find((p) => p.id === target.id).hp, START_HP)
    assert.equal(r2.state.players.find((p) => p.id === actor.id).hp, START_HP - 6)
  }
})

test('応戦: 貫通はガード無効・必中は回避無効', () => {
  // 貫通 vs ガード
  {
    const { state } = newGame()
    const actor = cur(state)
    const target = state.players.find((p) => p.id !== actor.id)
    target.hand = []
    const shield = giveCard(state, target.id, 'iron_shield')
    const uid = giveCard(state, actor.id, 'thunder_lance') // dmg4 pierce
    const r1 = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
    const r2 = applyAction(r1.state, { type: 'defend', playerId: target.id, cardUid: shield })
    assert.equal(r2.state.players.find((p) => p.id === target.id).hp, START_HP - 4)
  }
  // 必中 vs 回避
  {
    const { state } = newGame()
    const actor = cur(state)
    const target = state.players.find((p) => p.id !== actor.id)
    target.hand = []
    const cloak = giveCard(state, target.id, 'gale_cloak')
    const uid = giveCard(state, actor.id, 'shadow_blade') // dmg4 sure
    const r1 = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
    const r2 = applyAction(r1.state, { type: 'defend', playerId: target.id, cardUid: cloak })
    assert.equal(r2.state.players.find((p) => p.id === target.id).hp, START_HP - 4)
  }
})

test('応戦タイムアウト: 防御なしで着弾', () => {
  const { state } = newGame()
  const actor = cur(state)
  const target = state.players.find((p) => p.id !== actor.id)
  target.hand = []
  giveCard(state, target.id, 'iron_shield')
  const uid = giveCard(state, actor.id, 'great_sword')
  const r1 = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
  const r2 = applyDefenseTimeout(r1.state)
  assert.equal(r2.state.players.find((p) => p.id === target.id).hp, START_HP - 6)
  assert.equal(r2.state.phase, 'main')
})

test('進化: ダメージ+3・ストック消費', () => {
  const { state } = newGame()
  const actor = cur(state)
  const target = state.players.find((p) => p.id !== actor.id)
  target.hand = []
  const uid = giveCard(state, actor.id, 'iron_sword')
  const r = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id, evolve: true })
  assert.equal(r.state.players.find((p) => p.id === target.id).hp, START_HP - 4 - EVOLVE_BONUS)
  assert.equal(r.state.players.find((p) => p.id === actor.id).evolveStock, 1)
})

test('魔法: ヒールはターン継続・MP消費', () => {
  const { state } = newGame()
  const actor = cur(state)
  actor.hp = 20
  actor.mp = 10
  const uid = giveCard(state, actor.id, 'heal')
  const r = applyAction(state, { type: 'magic', playerId: actor.id, cardUid: uid })
  const a2 = r.state.players.find((p) => p.id === actor.id)
  assert.equal(a2.hp, 25)
  assert.equal(a2.mp, 7)
  assert.equal(cur(r.state).id, actor.id) // ターン継続
})

test('魔法: MP不足はエラー', () => {
  const { state } = newGame()
  const actor = cur(state)
  actor.mp = 2
  const uid = giveCard(state, actor.id, 'judgement') // MP8
  const r = applyAction(state, { type: 'magic', playerId: actor.id, cardUid: uid, targetId: state.players.find((p) => p.id !== actor.id).id })
  assert.ok(r.error)
})

test('魔法: 神罰は防御不可で即着弾しターン終了', () => {
  const { state } = newGame()
  const actor = cur(state)
  actor.mp = 10
  const target = state.players.find((p) => p.id !== actor.id)
  target.hand = []
  giveCard(state, target.id, 'mirror_shield') // 防御持ちでも無視される
  const uid = giveCard(state, actor.id, 'judgement')
  const r = applyAction(state, { type: 'magic', playerId: actor.id, cardUid: uid, targetId: target.id })
  assert.equal(r.state.players.find((p) => p.id === target.id).hp, START_HP - 8)
  assert.notEqual(cur(r.state).id, actor.id)
})

test('毒: ターン開始時に2ダメージ×3ターン', () => {
  const { state } = newGame()
  const actor = cur(state)
  actor.mp = 10
  const target = state.players.find((p) => p.id !== actor.id)
  const uid = giveCard(state, actor.id, 'poison_mist')
  const r = applyAction(state, { type: 'magic', playerId: actor.id, cardUid: uid, targetId: target.id })
  assert.equal(r.state.players.find((p) => p.id === target.id).poison, 3)
})

test('アミュレット: 設置・最大数制限・ターン継続', () => {
  const { state } = newGame()
  const actor = cur(state)
  const u1 = giveCard(state, actor.id, 'spring')
  const u2 = giveCard(state, actor.id, 'guardian')
  const u3 = giveCard(state, actor.id, 'mana_crystal')
  let r = applyAction(state, { type: 'amulet', playerId: actor.id, cardUid: u1 })
  assert.equal(r.error, undefined)
  r = applyAction(r.state, { type: 'amulet', playerId: actor.id, cardUid: u2 })
  assert.equal(r.error, undefined)
  assert.equal(cur(r.state).id, actor.id) // ターン継続
  assert.equal(r.state.players.find((p) => p.id === actor.id).amulets.length, MAX_AMULETS)
  r = applyAction(r.state, { type: 'amulet', playerId: actor.id, cardUid: u3 })
  assert.ok(r.error) // 3個目は不可
})

test('守護の像: 受ける攻撃ダメージ-2', () => {
  const { state } = newGame()
  const actor = cur(state)
  const target = state.players.find((p) => p.id !== actor.id)
  target.hand = []
  target.amulets.push({ uid: 'am1', id: 'guardian', count: 4 })
  const uid = giveCard(state, actor.id, 'great_sword') // dmg6
  const r = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
  assert.equal(r.state.players.find((p) => p.id === target.id).hp, START_HP - 4) // 6-2
})

test('交換: 捨てた枚数だけ引いてターン終了', () => {
  const { state } = newGame()
  const actor = cur(state)
  const uids = actor.hand.slice(0, 2).map((c) => c.uid)
  const before = actor.hand.length
  const r = applyAction(state, { type: 'exchange', playerId: actor.id, cardUids: uids })
  assert.equal(r.error, undefined)
  const a2 = r.state.players.find((p) => p.id === actor.id)
  assert.equal(a2.hand.length, before) // -2 +2
  assert.notEqual(cur(r.state).id, actor.id)
})

test('手番以外のアクションは拒否', () => {
  const { state } = newGame()
  const other = state.players.find((p) => p.id !== cur(state).id)
  const uid = giveCard(state, other.id, 'iron_sword')
  const r = applyAction(state, { type: 'attack', playerId: other.id, cardUid: uid, targetId: cur(state).id })
  assert.ok(r.error)
})

test('撃破と勝利判定: 最後の1人が勝者', () => {
  const { state } = newGame([P4[0], P4[1]], 7) // 2人戦
  const actor = cur(state)
  const target = state.players.find((p) => p.id !== actor.id)
  target.hand = []
  target.hp = 3
  const uid = giveCard(state, actor.id, 'iron_sword')
  const r = applyAction(state, { type: 'attack', playerId: actor.id, cardUid: uid, targetId: target.id })
  assert.equal(r.state.phase, 'ended')
  assert.deepEqual(r.state.winnerIds, [actor.id])
  assert.equal(r.state.players.find((p) => p.id === target.id).alive, false)
})

test('退室没収: 残り1人になったら勝利', () => {
  const { state } = newGame([P4[0], P4[1]], 9)
  const leaver = state.players[0]
  const r = forfeitPlayer(state, leaver.id)
  assert.equal(r.state.phase, 'ended')
  assert.deepEqual(r.state.winnerIds, [state.players[1].id])
})

test('退室没収: 手番プレイヤーが抜けたらターンが進む', () => {
  const { state } = newGame(P4, 11)
  const leaver = cur(state)
  const r = forfeitPlayer(state, leaver.id)
  assert.equal(r.state.phase, 'main')
  assert.notEqual(cur(r.state).id, leaver.id)
  assert.equal(cur(r.state).alive, true)
})

test('全カード定義の整合性', () => {
  for (const [id, c] of Object.entries(CARDS)) {
    assert.ok(c.name, id + ': name必須')
    assert.ok(c.desc, id + ': desc必須')
    assert.ok(c.weight > 0, id + ': weight必須')
    assert.ok(['weapon', 'defense', 'magic', 'amulet'].includes(c.kind), id + ': kind不正')
    if (c.kind === 'magic') assert.ok(c.mp >= 0, id + ': magicはmp必須')
    if (c.kind === 'amulet') assert.ok(c.count > 0, id + ': amuletはcount必須')
  }
})

test('シミュレーション: ランダム行動でもエラー・無限ループなくゲームが終わる', () => {
  for (let seed = 1; seed <= 5; seed++) {
    let { state } = newGame(P4, seed)
    let guard = 0
    // 疑似ランダムに攻撃だけを繰り返す(交互に必ず進行する)
    while (state.phase !== 'ended' && guard < 500) {
      guard++
      if (state.phase === 'defense') {
        const t = state.players.find((p) => p.id === state.pendingAttack.targetId)
        const defCard = t.hand.find((c) => CARDS[c.id].kind === 'defense')
        const r = applyAction(state, { type: 'defend', playerId: t.id, cardUid: guard % 2 === 0 ? defCard?.uid ?? null : null })
        assert.equal(r.error, undefined, r.error)
        state = r.state
        continue
      }
      const p = state.players[state.turnIndex]
      const atk = p.hand.find((c) => CARDS[c.id].kind === 'weapon')
      if (atk) {
        const foes = state.players.filter((q) => q.alive && q.id !== p.id)
        const r = applyAction(state, { type: 'attack', playerId: p.id, cardUid: atk.uid, targetId: foes[guard % foes.length].id })
        assert.equal(r.error, undefined, r.error)
        state = r.state
      } else {
        const r = applyAction(state, { type: 'pass', playerId: p.id })
        assert.equal(r.error, undefined, r.error)
        state = r.state
      }
    }
    assert.ok(guard < 500, 'ゲームが終わらない (seed=' + seed + ')')
    assert.equal(state.phase, 'ended')
  }
})
