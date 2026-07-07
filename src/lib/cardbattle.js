// ============================================================
// 幻札(げんさつ)バトル — カードバトルエンジン
// ゴッドフィールド風の基盤(配られたカードで殴り合い・最後の生存者が勝ち)に
// シャドウバース風の能力(ファンファーレ/ラストワード/アミュレット/進化)を追加。
// ステータス・報酬に一切影響しない娯楽コンテンツ。
//
// 設計:
//  - 完全に純関数のエンジン。ホスト(部屋主)のクライアントだけが実行し、
//    結果stateをSupabase Realtimeでブロードキャストする(ホスト権威型)。
//  - 乱数はseed付き(mulberry32)で決定的 → テスト可能。
//  - デッキは共有山札ではなく「重み付き抽選で無限に湧く」ゴッドフィールド方式。
// ============================================================

// ---- 乱数(seed付き・決定的) ----
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- 定数 ----
export const MAX_PLAYERS = 8
export const START_HP = 40
export const MAX_HP = 50
export const START_MP = 8
export const MAX_MP = 20
export const MP_REGEN = 2
export const HAND_START = 7
export const HAND_MAX = 8
export const MAX_AMULETS = 2
export const EVOLVE_STOCK = 2
export const EVOLVE_BONUS = 3
export const TURN_LIMIT = 60 // 手番数の上限。超えたらHP最大の者が勝ち
export const DEFENSE_TIMEOUT_SEC = 20

// ---- カード定義 ----
// kind: weapon(攻撃・防御可否は属性次第) / defense(応戦時のみ) / magic(MP消費) / amulet(場に設置)
// weight: 抽選の重み(大きいほど出やすい)
export const CARDS = {
  // ===== 武器(攻撃) =====
  wood_sword:   { kind: 'weapon', name: '木の剣',       dmg: 2, weight: 10, desc: '2ダメージ。' },
  iron_sword:   { kind: 'weapon', name: '鉄の剣',       dmg: 4, weight: 8,  desc: '4ダメージ。' },
  great_sword:  { kind: 'weapon', name: '大剣',         dmg: 6, weight: 5,  desc: '6ダメージ。' },
  flame_axe:    { kind: 'weapon', name: '炎の斧',       dmg: 6, weight: 5,  fanfare: 'self1', desc: '6ダメージ。ファンファーレ: 自分に1ダメージ。' },
  vamp_dagger:  { kind: 'weapon', name: '吸血の短剣',   dmg: 3, weight: 6,  drain: true, desc: '3ダメージ。与えたダメージ分HP回復(最大3)。' },
  thunder_lance:{ kind: 'weapon', name: '雷槍',         dmg: 4, weight: 4,  pierce: true, desc: '4ダメージ。貫通: ガードで軽減できない(回避は可能)。' },
  meteor_bow:   { kind: 'weapon', name: '流星弓',       dmg: 2, weight: 4,  multi: 2, desc: 'ランダムな敵に2ダメージ×2回(対象は選べない・防御不可)。' },
  twin_blade:   { kind: 'weapon', name: '双撃の刃',     dmg: 3, weight: 5,  fanfare: 'draw1', desc: '3ダメージ。ファンファーレ: カードを1枚引く。' },
  doom_scythe:  { kind: 'weapon', name: '断罪の大鎌',   dmg: 8, weight: 2,  fanfare: 'discard1', desc: '8ダメージ。ファンファーレ: 自分の手札をランダムに1枚失う。' },
  dragon_roar:  { kind: 'weapon', name: '竜の咆哮',     dmg: 2, weight: 3,  aoe: true, desc: '自分以外の全員に2ダメージ(防御不可)。' },
  shadow_blade: { kind: 'weapon', name: '影の刃',       dmg: 4, weight: 3,  sure: true, desc: '4ダメージ。必中: 回避できない(ガード・反射は可能)。' },

  // ===== 防御(応戦時のみ使用可) =====
  wood_shield:  { kind: 'defense', name: '木の盾',      guard: 3, weight: 9, desc: '3軽減。' },
  iron_shield:  { kind: 'defense', name: '鉄の盾',      guard: 5, weight: 7, desc: '5軽減。' },
  holy_armor:   { kind: 'defense', name: '聖なる鎧',    guard: 6, weight: 4, lastword: 'draw1', desc: '6軽減。ラストワード: 使用後、カードを1枚引く。' },
  mirror_shield:{ kind: 'defense', name: 'ミラーシールド', reflect: true, weight: 2, desc: '反射: ダメージを全て攻撃者に返す。' },
  gale_cloak:   { kind: 'defense', name: '疾風のマント', evade: true, weight: 3, desc: '回避: 攻撃を完全に無効化する。' },
  thorn_shield: { kind: 'defense', name: '茨の盾',      guard: 2, counter: 2, weight: 4, desc: '2軽減し、攻撃者に2ダメージ返す。' },

  // ===== 魔法(MP消費・自分のターンに使用。使ってもターンは終わらない) =====
  heal:         { kind: 'magic', name: 'ヒール',        mp: 3, heal: 5,  weight: 7, desc: 'MP3: HPを5回復。' },
  mega_heal:    { kind: 'magic', name: 'メガヒール',    mp: 6, heal: 10, weight: 3, desc: 'MP6: HPを10回復。' },
  fireball:     { kind: 'magic', name: 'ファイアボール', mp: 4, dmg: 5, targeted: true, weight: 5, desc: 'MP4: 5ダメージ(防御可能)。使うとターン終了。' },
  lightning:    { kind: 'magic', name: '落雷',          mp: 5, dmg: 3, aoe: true, weight: 3, desc: 'MP5: 自分以外の全員に3ダメージ(防御不可)。使うとターン終了。' },
  judgement:    { kind: 'magic', name: '神罰',          mp: 8, dmg: 8, targeted: true, nodef: true, weight: 1, desc: 'MP8: 8ダメージ(防御不可)。使うとターン終了。' },
  clairvoyance: { kind: 'magic', name: '千里眼',        mp: 2, peek: true, targeted: true, weight: 4, desc: 'MP2: 相手の手札を見る。' },
  plunder:      { kind: 'magic', name: '強奪',          mp: 5, steal: true, targeted: true, weight: 2, desc: 'MP5: 相手の手札からランダムに1枚奪う。' },
  alchemy:      { kind: 'magic', name: '錬成',          mp: 2, alchemy: true, weight: 4, desc: 'MP2: 手札を1枚選んで捨て、2枚引く。' },
  poison_mist:  { kind: 'magic', name: '毒霧',          mp: 4, poison: 3, targeted: true, weight: 3, desc: 'MP4: 相手を毒にする(3ターンの間、ターン開始時に2ダメージ)。' },

  // ===== アミュレット(自分の場に設置・最大2個・カウントダウン) =====
  spring:       { kind: 'amulet', name: '癒しの泉',     count: 3, weight: 4, desc: 'カウント3: 自分のターン開始時HP+2。カウント0で消滅。' },
  hourglass:    { kind: 'amulet', name: '刻の砂時計',   count: 2, weight: 3, desc: 'カウント2: ラストワード: カウント0でカードを2枚引く。' },
  guardian:     { kind: 'amulet', name: '守護の像',     count: 4, weight: 3, desc: 'カウント4: 設置中、受ける攻撃ダメージ-2。' },
  doom_feast:   { kind: 'amulet', name: '破滅の宴',     count: 3, weight: 1, desc: 'カウント3: カウント0で自分を含む全員に5ダメージ。' },
  mana_crystal: { kind: 'amulet', name: 'マナの水晶',   count: 3, weight: 3, desc: 'カウント3: 自分のターン開始時MP+2追加。' },
}

const CARD_IDS = Object.keys(CARDS)
const TOTAL_WEIGHT = CARD_IDS.reduce((s, id) => s + CARDS[id].weight, 0)

// ---- カード生成 ----
function drawCardId(rng) {
  let r = rng() * TOTAL_WEIGHT
  for (const id of CARD_IDS) {
    r -= CARDS[id].weight
    if (r < 0) return id
  }
  return CARD_IDS[CARD_IDS.length - 1]
}

function makeCard(state, rng) {
  state.cardSeq += 1
  return { uid: 'c' + state.cardSeq, id: drawCardId(rng) }
}

// ---- ゲーム生成 ----
export function createGame({ players, seed }) {
  if (!players || players.length < 2) throw new Error('プレイヤーは2人以上必要です')
  if (players.length > MAX_PLAYERS) throw new Error(`プレイヤーは最大${MAX_PLAYERS}人です`)
  const state = {
    seed: seed >>> 0,
    rngCalls: 0, // rng再現用: 消費回数を記録
    cardSeq: 0,
    turnCount: 0,
    phase: 'main', // main | defense | ended
    turnIndex: 0,
    pendingAttack: null, // { attackerId, targetId, dmg, pierce, sure, cardName }
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      hp: START_HP,
      mp: START_MP,
      alive: true,
      hand: [],
      amulets: [], // { uid, id, count }
      poison: 0,   // 残ターン数
      evolveStock: EVOLVE_STOCK,
    })),
    winnerIds: null,
  }
  const rng = restoreRng(state)
  // 手札配布
  for (const p of state.players) {
    for (let i = 0; i < HAND_START; i++) p.hand.push(makeCard(state, rng))
  }
  // 先攻はランダム
  state.turnIndex = Math.floor(rng() * state.players.length)
  saveRng(state, rng)
  const events = [{ t: 'start', msg: `ゲーム開始！ 先攻は ${state.players[state.turnIndex].name}` }]
  beginTurn(state, rng2(state), events)
  return { state, events }
}

// rngの消費回数をstateに保存し、同じ位置から再開できるようにする
// (stateはJSONでブロードキャストされるため関数を持てない)
function restoreRng(state) {
  const rng = mulberry32(state.seed)
  for (let i = 0; i < state.rngCalls; i++) rng()
  const wrapped = () => { state.rngCalls += 1; return rng() }
  return wrapped
}
function saveRng() { /* rngCallsはwrapped内で更新済み */ }
function rng2(state) { return restoreRng(state) }

// ---- ユーティリティ ----
function alivePlayers(state) { return state.players.filter((p) => p.alive) }
function getPlayer(state, id) { return state.players.find((p) => p.id === id) }
function currentPlayer(state) { return state.players[state.turnIndex] }

function heal(p, n) { p.hp = Math.min(MAX_HP, p.hp + n) }

function dealDamage(state, target, n, events, sourceName) {
  if (!target.alive || n <= 0) return 0
  target.hp -= n
  events.push({ t: 'damage', target: target.id, amount: n, msg: `${target.name} に ${n} ダメージ (${sourceName})` })
  if (target.hp <= 0) {
    target.hp = 0
    target.alive = false
    target.hand = []
    target.amulets = []
    events.push({ t: 'death', target: target.id, msg: `💀 ${target.name} は敗退した！` })
  }
  return n
}

function drawTo(state, p, n, rng, events, silent) {
  let drawn = 0
  for (let i = 0; i < n; i++) {
    if (p.hand.length >= HAND_MAX) break
    p.hand.push(makeCard(state, rng))
    drawn++
  }
  if (drawn > 0 && !silent) events.push({ t: 'draw', target: p.id, amount: drawn, msg: `${p.name} はカードを${drawn}枚引いた` })
  return drawn
}

function checkGameEnd(state, events) {
  const alive = alivePlayers(state)
  if (alive.length <= 1) {
    state.phase = 'ended'
    state.winnerIds = alive.map((p) => p.id)
    events.push({ t: 'end', winners: state.winnerIds, msg: alive.length === 1 ? `🏆 ${alive[0].name} の勝利！` : '相打ち…勝者なし' })
    return true
  }
  if (state.turnCount >= TURN_LIMIT) {
    const maxHp = Math.max(...alive.map((p) => p.hp))
    state.phase = 'ended'
    state.winnerIds = alive.filter((p) => p.hp === maxHp).map((p) => p.id)
    const names = state.winnerIds.map((id) => getPlayer(state, id).name).join('・')
    events.push({ t: 'end', winners: state.winnerIds, msg: `⏱ ターン上限！ HP最大の ${names} の勝利！` })
    return true
  }
  return false
}

// ---- ターン開始処理(アミュレット・毒・MP回復・ドロー) ----
function beginTurn(state, rng, events) {
  if (state.phase === 'ended') return
  state.turnCount += 1
  const p = currentPlayer(state)
  events.push({ t: 'turn', target: p.id, msg: `── ${p.name} のターン ──` })

  // 毒
  if (p.poison > 0) {
    p.poison -= 1
    dealDamage(state, p, 2, events, '毒')
    if (checkGameEnd(state, events)) return
    if (!p.alive) { advanceTurn(state, rng, events); return }
  }

  // アミュレットのカウントダウンと効果
  let extraMp = 0
  const expired = []
  for (const am of p.amulets) {
    const def = CARDS[am.id]
    if (am.id === 'spring') { heal(p, 2); events.push({ t: 'amulet', target: p.id, msg: `癒しの泉: ${p.name} のHP+2` }) }
    if (am.id === 'mana_crystal') extraMp += 2
    am.count -= 1
    if (am.count <= 0) {
      expired.push(am)
      if (am.id === 'hourglass') { drawTo(state, p, 2, rng, events); events.push({ t: 'amulet', target: p.id, msg: '刻の砂時計が砕けた(ラストワード発動)' }) }
      else if (am.id === 'doom_feast') {
        events.push({ t: 'amulet', target: p.id, msg: '💥 破滅の宴が開演！ 全員に5ダメージ！' })
        for (const q of [...state.players]) dealDamage(state, q, 5, events, '破滅の宴')
      } else {
        events.push({ t: 'amulet', target: p.id, msg: `${def.name} は消滅した` })
      }
    }
  }
  p.amulets = p.amulets.filter((am) => !expired.includes(am))
  if (checkGameEnd(state, events)) return
  if (!p.alive) { advanceTurn(state, rng, events); return }

  // MP回復・ドロー
  p.mp = Math.min(MAX_MP, p.mp + MP_REGEN + extraMp)
  drawTo(state, p, 1, rng, events)
  state.phase = 'main'
}

function advanceTurn(state, rng, events) {
  if (checkGameEnd(state, events)) return
  const n = state.players.length
  for (let i = 1; i <= n; i++) {
    const idx = (state.turnIndex + i) % n
    if (state.players[idx].alive) { state.turnIndex = idx; break }
  }
  beginTurn(state, rng, events)
}

// 守護の像による軽減
function guardianReduce(target) {
  return target.amulets.some((am) => am.id === 'guardian') ? 2 : 0
}

// ---- アクション適用(ホストのみ実行) ----
// action: { type, playerId, ... }
// 戻り値: { state, events, error? } — errorがあればstateは変更されない
export function applyAction(prevState, action) {
  const state = JSON.parse(JSON.stringify(prevState))
  const events = []
  const rng = restoreRng(state)
  const fail = (msg) => ({ state: prevState, events: [], error: msg })

  if (state.phase === 'ended') return fail('ゲームは終了しています')
  const actor = getPlayer(state, action.playerId)
  if (!actor || !actor.alive) return fail('無効なプレイヤーです')

  // ===== 応戦フェーズ =====
  if (state.phase === 'defense') {
    if (action.type !== 'defend') return fail('応戦待ちです')
    const pa = state.pendingAttack
    if (action.playerId !== pa.targetId) return fail('あなたは応戦対象ではありません')
    const target = getPlayer(state, pa.targetId)
    const attacker = getPlayer(state, pa.attackerId)
    let dmg = pa.dmg

    if (action.cardUid) {
      const idx = target.hand.findIndex((c) => c.uid === action.cardUid)
      if (idx < 0) return fail('そのカードは手札にありません')
      const card = target.hand[idx]
      const def = CARDS[card.id]
      if (def.kind !== 'defense') return fail('防御カードではありません')
      target.hand.splice(idx, 1)
      events.push({ t: 'defend', target: target.id, card: card.id, msg: `${target.name} は ${def.name} で応戦！` })

      if (def.evade && !pa.sure) {
        dmg = 0
        events.push({ t: 'evade', target: target.id, msg: `${target.name} は攻撃を回避した！` })
      } else if (def.evade && pa.sure) {
        events.push({ t: 'info', msg: '必中攻撃は回避できない！' })
      } else if (def.reflect) {
        events.push({ t: 'reflect', target: target.id, msg: `${target.name} はダメージを反射した！` })
        if (attacker && attacker.alive) dealDamage(state, attacker, dmg, events, `${pa.cardName}(反射)`)
        dmg = 0
      } else {
        if (!pa.pierce && def.guard) {
          dmg = Math.max(0, dmg - def.guard)
        } else if (pa.pierce && def.guard) {
          events.push({ t: 'info', msg: '貫通！ ガードで軽減できない！' })
        }
        if (def.counter && attacker && attacker.alive) dealDamage(state, attacker, def.counter, events, `${def.name}(反撃)`)
      }
      // ラストワード(防御カードは使用=破壊)
      if (def.lastword === 'draw1') drawTo(state, target, 1, rng, events)
    }

    if (dmg > 0) {
      const red = guardianReduce(target)
      if (red > 0) events.push({ t: 'info', msg: `守護の像がダメージを${red}軽減` })
      dealDamage(state, target, Math.max(0, dmg - red), events, pa.cardName)
    }
    // ドレイン(吸血)
    if (pa.drain && attacker && attacker.alive && dmg > 0) {
      const healed = Math.min(dmg, pa.dmg)
      heal(attacker, healed)
      events.push({ t: 'heal', target: attacker.id, amount: healed, msg: `${attacker.name} はHPを${healed}吸収した` })
    }
    state.pendingAttack = null
    state.phase = 'main'
    advanceTurn(state, rng, events)
    return { state, events }
  }

  // ===== メインフェーズ(手番プレイヤーのみ) =====
  if (action.playerId !== currentPlayer(state).id) return fail('あなたのターンではありません')

  if (action.type === 'attack') {
    const idx = actor.hand.findIndex((c) => c.uid === action.cardUid)
    if (idx < 0) return fail('そのカードは手札にありません')
    const card = actor.hand[idx]
    const def = CARDS[card.id]
    if (def.kind !== 'weapon') return fail('攻撃カードではありません')

    let dmg = def.dmg
    let evolved = false
    if (action.evolve) {
      if (actor.evolveStock <= 0) return fail('進化ポイントがありません')
      actor.evolveStock -= 1
      dmg += EVOLVE_BONUS
      evolved = true
    }
    actor.hand.splice(idx, 1)
    events.push({ t: 'attack', actor: actor.id, card: card.id, msg: `${actor.name} は ${def.name}${evolved ? '【進化】' : ''} で攻撃！` })

    // ファンファーレ
    if (def.fanfare === 'self1') dealDamage(state, actor, 1, events, 'ファンファーレ')
    if (def.fanfare === 'draw1') drawTo(state, actor, 1, rng, events)
    if (def.fanfare === 'discard1' && actor.hand.length > 0) {
      const di = Math.floor(rng() * actor.hand.length)
      const lost = actor.hand.splice(di, 1)[0]
      events.push({ t: 'discard', actor: actor.id, msg: `${actor.name} は ${CARDS[lost.id].name} を失った` })
    }
    if (!actor.alive) { advanceTurn(state, rng, events); return { state, events } }

    // 全体攻撃(防御不可)
    if (def.aoe) {
      for (const q of alivePlayers(state).filter((q) => q.id !== actor.id)) {
        dealDamage(state, q, Math.max(0, dmg - guardianReduce(q)), events, def.name)
      }
      advanceTurn(state, rng, events)
      return { state, events }
    }
    // 連撃(ランダム対象・防御不可)
    if (def.multi) {
      for (let i = 0; i < def.multi; i++) {
        const foes = alivePlayers(state).filter((q) => q.id !== actor.id)
        if (foes.length === 0) break
        const q = foes[Math.floor(rng() * foes.length)]
        dealDamage(state, q, Math.max(0, dmg - guardianReduce(q)), events, def.name)
      }
      advanceTurn(state, rng, events)
      return { state, events }
    }

    // 単体攻撃 → 応戦フェーズへ
    const target = getPlayer(state, action.targetId)
    if (!target || !target.alive || target.id === actor.id) return fail('対象が不正です')
    const hasDefense = target.hand.some((c) => CARDS[c.id].kind === 'defense')
    if (hasDefense) {
      state.phase = 'defense'
      state.pendingAttack = {
        attackerId: actor.id, targetId: target.id, dmg,
        pierce: !!def.pierce, sure: !!def.sure, drain: !!def.drain, cardName: def.name,
        deadline: null, // UI側でセット
      }
      events.push({ t: 'defense_wait', target: target.id, msg: `${target.name} の応戦を待っています…` })
      return { state, events }
    }
    // 防御カードなし → 即着弾
    const red = guardianReduce(target)
    const dealt = dealDamage(state, target, Math.max(0, dmg - red), events, def.name)
    if (def.drain && dealt > 0 && actor.alive) {
      heal(actor, dealt)
      events.push({ t: 'heal', target: actor.id, amount: dealt, msg: `${actor.name} はHPを${dealt}吸収した` })
    }
    advanceTurn(state, rng, events)
    return { state, events }
  }

  if (action.type === 'magic') {
    const idx = actor.hand.findIndex((c) => c.uid === action.cardUid)
    if (idx < 0) return fail('そのカードは手札にありません')
    const card = actor.hand[idx]
    const def = CARDS[card.id]
    if (def.kind !== 'magic') return fail('魔法カードではありません')
    if (actor.mp < def.mp) return fail('MPが足りません')

    let target = null
    if (def.targeted) {
      target = getPlayer(state, action.targetId)
      if (!target || !target.alive || target.id === actor.id) return fail('対象が不正です')
    }
    actor.mp -= def.mp
    actor.hand.splice(idx, 1)
    events.push({ t: 'magic', actor: actor.id, card: card.id, msg: `${actor.name} は ${def.name} を使った！` })

    if (def.heal) heal(actor, def.heal), events.push({ t: 'heal', target: actor.id, amount: def.heal, msg: `${actor.name} のHPが${def.heal}回復` })
    if (def.poison) { target.poison = def.poison; events.push({ t: 'poison', target: target.id, msg: `${target.name} は毒に侵された(${def.poison}ターン)` }) }
    if (def.peek) events.push({ t: 'peek', actor: actor.id, target: target.id, hand: target.hand.map((c) => c.id), msg: `${actor.name} は ${target.name} の手札を覗いた` })
    if (def.steal) {
      if (target.hand.length > 0 && actor.hand.length < HAND_MAX) {
        const si = Math.floor(rng() * target.hand.length)
        const stolen = target.hand.splice(si, 1)[0]
        actor.hand.push(stolen)
        events.push({ t: 'steal', actor: actor.id, target: target.id, msg: `${actor.name} は ${target.name} からカードを1枚奪った！` })
      } else {
        events.push({ t: 'info', msg: '奪えるカードがなかった…' })
      }
    }
    if (def.alchemy) {
      const di = actor.hand.findIndex((c) => c.uid === action.discardUid)
      if (di < 0) return fail('捨てるカードを選んでください')
      const dumped = actor.hand.splice(di, 1)[0]
      events.push({ t: 'discard', actor: actor.id, msg: `${actor.name} は ${CARDS[dumped.id].name} を錬成に捧げた` })
      drawTo(state, actor, 2, rng, events)
    }

    // ダメージ魔法はターン終了
    if (def.dmg) {
      if (def.aoe) {
        for (const q of alivePlayers(state).filter((q) => q.id !== actor.id)) {
          dealDamage(state, q, Math.max(0, def.dmg - guardianReduce(q)), events, def.name)
        }
        advanceTurn(state, rng, events)
        return { state, events }
      }
      if (def.nodef) {
        dealDamage(state, target, def.dmg, events, def.name)
        advanceTurn(state, rng, events)
        return { state, events }
      }
      // 防御可能な単体魔法
      const hasDefense = target.hand.some((c) => CARDS[c.id].kind === 'defense')
      if (hasDefense) {
        state.phase = 'defense'
        state.pendingAttack = { attackerId: actor.id, targetId: target.id, dmg: def.dmg, pierce: false, sure: false, drain: false, cardName: def.name, deadline: null }
        events.push({ t: 'defense_wait', target: target.id, msg: `${target.name} の応戦を待っています…` })
        return { state, events }
      }
      dealDamage(state, target, Math.max(0, def.dmg - guardianReduce(target)), events, def.name)
      advanceTurn(state, rng, events)
      return { state, events }
    }
    if (checkGameEnd(state, events)) return { state, events }
    return { state, events } // 補助魔法はターン継続
  }

  if (action.type === 'amulet') {
    const idx = actor.hand.findIndex((c) => c.uid === action.cardUid)
    if (idx < 0) return fail('そのカードは手札にありません')
    const card = actor.hand[idx]
    const def = CARDS[card.id]
    if (def.kind !== 'amulet') return fail('アミュレットではありません')
    if (actor.amulets.length >= MAX_AMULETS) return fail(`アミュレットは${MAX_AMULETS}個までです`)
    actor.hand.splice(idx, 1)
    actor.amulets.push({ uid: card.uid, id: card.id, count: def.count })
    events.push({ t: 'amulet_set', actor: actor.id, card: card.id, msg: `${actor.name} は ${def.name} を設置した(カウント${def.count})` })
    return { state, events } // 設置はターン継続
  }

  if (action.type === 'exchange') {
    // 手札を最大3枚捨てて同数引く。ターン終了
    const uids = action.cardUids || []
    if (uids.length < 1 || uids.length > 3) return fail('交換は1〜3枚です')
    for (const uid of uids) {
      const idx = actor.hand.findIndex((c) => c.uid === uid)
      if (idx < 0) return fail('そのカードは手札にありません')
      actor.hand.splice(idx, 1)
    }
    drawTo(state, actor, uids.length, rng, events)
    events.push({ t: 'exchange', actor: actor.id, msg: `${actor.name} はカードを${uids.length}枚交換した` })
    advanceTurn(state, rng, events)
    return { state, events }
  }

  if (action.type === 'pass') {
    events.push({ t: 'pass', actor: actor.id, msg: `${actor.name} はターンを終了した` })
    advanceTurn(state, rng, events)
    return { state, events }
  }

  return fail('不明なアクションです')
}

// 応戦タイムアウト(ホストが呼ぶ): 防御なしで着弾させる
export function applyDefenseTimeout(prevState) {
  if (prevState.phase !== 'defense' || !prevState.pendingAttack) return { state: prevState, events: [] }
  return applyAction(prevState, { type: 'defend', playerId: prevState.pendingAttack.targetId, cardUid: null })
}

// ============================================================
// NPC思考ルーチン(ホストのクライアントが実行)
// 決定的なヒューリスティック: 同じstateなら必ず同じ手を返す
// ============================================================
export function isNpcId(id) { return typeof id === 'string' && id.startsWith('npc-') }

export function npcChooseAction(state, npcId) {
  const p = getPlayer(state, npcId)
  if (!p || !p.alive || state.phase === 'ended') return null

  // ---- 応戦: 受けるダメージが最小になる防御カードを選ぶ ----
  if (state.phase === 'defense') {
    const pa = state.pendingAttack
    if (!pa || pa.targetId !== npcId) return null
    let best = null
    let bestTaken = pa.dmg
    for (const c of p.hand) {
      const d = CARDS[c.id]
      if (d.kind !== 'defense') continue
      let taken
      if (d.evade) taken = pa.sure ? pa.dmg : 0
      else if (d.reflect) taken = 0
      else if (d.guard) taken = pa.pierce ? pa.dmg : Math.max(0, pa.dmg - d.guard)
      else taken = pa.dmg
      if (taken < bestTaken) { bestTaken = taken; best = c }
    }
    // 2以下の小ダメージは防御カードを温存して素受け
    if (pa.dmg <= 2 && p.hp > 6) best = null
    return { type: 'defend', playerId: npcId, cardUid: best ? best.uid : null }
  }

  if (currentPlayer(state).id !== npcId) return null
  const enemies = alivePlayers(state).filter((q) => q.id !== npcId)
  if (enemies.length === 0) return { type: 'pass', playerId: npcId }
  const weakest = enemies.reduce((a, b) => (a.hp <= b.hp ? a : b))

  // 回復(瀕死優先)
  const megaHeal = p.hand.find((c) => c.id === 'mega_heal')
  if (p.hp <= 20 && megaHeal && p.mp >= CARDS.mega_heal.mp) return { type: 'magic', playerId: npcId, cardUid: megaHeal.uid }
  const healC = p.hand.find((c) => c.id === 'heal')
  if (p.hp <= 25 && healC && p.mp >= CARDS.heal.mp) return { type: 'magic', playerId: npcId, cardUid: healC.uid }

  // アミュレット設置(破滅の宴は自分も食らうのでHPに余裕がある時だけ)
  if (p.amulets.length < MAX_AMULETS) {
    const am = p.hand.find((c) => CARDS[c.id].kind === 'amulet' && (c.id !== 'doom_feast' || p.hp > 25))
    if (am) return { type: 'amulet', playerId: npcId, cardUid: am.uid }
  }

  // 神罰でトドメ
  const jud = p.hand.find((c) => c.id === 'judgement')
  if (jud && p.mp >= CARDS.judgement.mp && weakest.hp <= CARDS.judgement.dmg) {
    return { type: 'magic', playerId: npcId, cardUid: jud.uid, targetId: weakest.id }
  }
  // 毒(MPに余裕がある時・未毒の体力ある敵へ)
  const pois = p.hand.find((c) => c.id === 'poison_mist')
  const poisTarget = enemies.find((e) => e.poison === 0 && e.hp > 10)
  if (pois && p.mp >= CARDS.poison_mist.mp + 4 && poisTarget) {
    return { type: 'magic', playerId: npcId, cardUid: pois.uid, targetId: poisTarget.id }
  }

  // 武器: 最大ダメージのものでHP最少の敵を狙う。トドメが刺せるなら進化
  const weapons = p.hand.filter((c) => CARDS[c.id].kind === 'weapon')
  if (weapons.length > 0) {
    let best = weapons[0]
    for (const c of weapons) if ((CARDS[c.id].dmg || 0) > (CARDS[best.id].dmg || 0)) best = c
    const def = CARDS[best.id]
    if (def.aoe || def.multi) return { type: 'attack', playerId: npcId, cardUid: best.uid }
    const evolve = p.evolveStock > 0 && weakest.hp > def.dmg && weakest.hp <= def.dmg + EVOLVE_BONUS
    return { type: 'attack', playerId: npcId, cardUid: best.uid, targetId: weakest.id, evolve }
  }

  // 攻撃魔法で代用
  const fb = p.hand.find((c) => c.id === 'fireball')
  if (fb && p.mp >= CARDS.fireball.mp) return { type: 'magic', playerId: npcId, cardUid: fb.uid, targetId: weakest.id }
  const lt = p.hand.find((c) => c.id === 'lightning')
  if (lt && p.mp >= CARDS.lightning.mp) return { type: 'magic', playerId: npcId, cardUid: lt.uid }

  // 武器がない: 防御以外のカードを最大3枚交換して引き直す
  const junk = p.hand.filter((c) => CARDS[c.id].kind !== 'defense').slice(0, 3)
  if (junk.length > 0) return { type: 'exchange', playerId: npcId, cardUids: junk.map((c) => c.uid) }
  return { type: 'pass', playerId: npcId }
}

// 切断プレイヤーの強制敗退(ホストが呼ぶ)
export function forfeitPlayer(prevState, playerId) {
  const state = JSON.parse(JSON.stringify(prevState))
  const events = []
  const rng = restoreRng(state)
  const p = getPlayer(state, playerId)
  if (!p || !p.alive || state.phase === 'ended') return { state: prevState, events: [] }
  p.hp = 0; p.alive = false; p.hand = []; p.amulets = []
  events.push({ t: 'death', target: p.id, msg: `🚪 ${p.name} は退室により敗退` })
  if (checkGameEnd(state, events)) return { state, events }
  // 手番/応戦対象だった場合は進行を回す
  if (state.phase === 'defense' && state.pendingAttack &&
      (state.pendingAttack.targetId === playerId || state.pendingAttack.attackerId === playerId)) {
    state.pendingAttack = null
    state.phase = 'main'
    advanceTurn(state, rng, events)
  } else if (currentPlayer(state).id === playerId) {
    advanceTurn(state, rng, events)
  }
  return { state, events }
}
