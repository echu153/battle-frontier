// ============================================================
// リーチ麻雀エンジン(雀魂準拠) — UI非依存・シリアライズ可能
// 4人(東風戦・25000点持ち) / 3人サンマ(東風戦・35000点持ち・2〜8萬抜き・北抜きドラ・ツモ損)
// 赤5(各色1枚)・カンドラ即めくり・裏ドラ・フリテン・ダブロン可
// ============================================================

// 牌種: 0-8=1〜9萬 / 9-17=1〜9筒 / 18-26=1〜9索 / 27-33=東南西北白發中
export const KIND_NAMES = [
  '1萬','2萬','3萬','4萬','5萬','6萬','7萬','8萬','9萬',
  '1筒','2筒','3筒','4筒','5筒','6筒','7筒','8筒','9筒',
  '1索','2索','3索','4索','5索','6索','7索','8索','9索',
  '東','南','西','北','白','發','中',
]
export const EAST = 27, SOUTH = 28, WEST = 29, NORTH = 30, HAKU = 31, HATSU = 32, CHUN = 33
const suitOf = (k) => (k < 9 ? 0 : k < 18 ? 1 : k < 27 ? 2 : 3)
const numOf = (k) => (k < 27 ? (k % 9) + 1 : 0)
const isHonor = (k) => k >= 27
const isTerminal = (k) => !isHonor(k) && (numOf(k) === 1 || numOf(k) === 9)
const isTermHonor = (k) => isHonor(k) || isTerminal(k)
const KOKUSHI_KINDS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]
const GREEN_KINDS = new Set([19, 20, 21, 23, 25, HATSU])

export const MIN_MAHJONG_PLAYERS = 3
export const MAX_MAHJONG_PLAYERS = 4
export const TURN_SEC = 25
export const CLAIM_SEC = 10

// ---- 山 ----
function buildTiles(sanma) {
  const tiles = []
  let id = 0
  for (let k = 0; k < 34; k++) {
    if (sanma && k >= 1 && k <= 7) continue // サンマは2〜8萬なし
    for (let c = 0; c < 4; c++) {
      tiles.push({ id: id++, k, r: numOf(k) === 5 && c === 0 }) // 赤5各色1枚
    }
  }
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
  }
  return tiles
}

// ドラ表示牌 → ドラ
export function doraFromIndicator(k) {
  if (k < 27) { const n = numOf(k); return n === 9 ? k - 8 : k + 1 }
  if (k <= 30) return k === 30 ? EAST : k + 1 // 東南西北→東
  return k === CHUN ? HAKU : k + 1 // 白發中→白
}

const countsOf = (tiles) => {
  const c = new Array(34).fill(0)
  for (const t of tiles) c[t.k]++
  return c
}

// ---- 和了判定 ----
function canFormSets(c, need) {
  if (need === 0) return c.every((x) => x === 0)
  let k = 0
  while (k < 34 && c[k] === 0) k++
  if (k === 34) return need === 0
  if (c[k] >= 3) {
    c[k] -= 3
    if (canFormSets(c, need - 1)) { c[k] += 3; return true }
    c[k] += 3
  }
  if (k < 27 && numOf(k) <= 7 && c[k + 1] > 0 && c[k + 2] > 0) {
    c[k]--; c[k + 1]--; c[k + 2]--
    const ok = canFormSets(c, need - 1)
    c[k]++; c[k + 1]++; c[k + 2]++
    if (ok) return true
  }
  return false
}

export function isWinningHand(counts, nMelds) {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total !== 14 - nMelds * 3) return false
  if (nMelds === 0) {
    // 七対子
    if (counts.filter((x) => x === 2).length === 7) return true
    // 国士無双
    if (KOKUSHI_KINDS.every((k) => counts[k] >= 1) && KOKUSHI_KINDS.some((k) => counts[k] === 2) && total === 14 &&
        counts.every((x, k) => x === 0 || KOKUSHI_KINDS.includes(k))) return true
  }
  const c = counts.slice()
  for (let p = 0; p < 34; p++) {
    if (c[p] >= 2) {
      c[p] -= 2
      if (canFormSets(c, 4 - nMelds)) { c[p] += 2; return true }
      c[p] += 2
    }
  }
  return false
}

// 待ち(13枚形に何を足せば和了か)
export function waitsOf(counts, nMelds, sanma = false) {
  const res = []
  for (let k = 0; k < 34; k++) {
    if (sanma && k >= 1 && k <= 7) continue
    if (counts[k] >= 4) continue
    counts[k]++
    if (isWinningHand(counts, nMelds)) res.push(k)
    counts[k]--
  }
  return res
}

// ---- シャンテン数(通常形+七対子+国士) ----
export function shanten(counts, nMelds) {
  let best = 8
  const c = counts.slice()
  const walk = (k, sets, partials, pair) => {
    while (k < 34 && c[k] === 0) k++
    if (k === 34) {
      const usable = Math.min(partials, 4 - nMelds - sets)
      const sh = 8 - 2 * (sets + nMelds) - Math.max(usable, 0) - (pair ? 1 : 0)
      if (sh < best) best = sh
      return
    }
    if (c[k] >= 3) { c[k] -= 3; walk(k, sets + 1, partials, pair); c[k] += 3 }
    if (k < 27 && numOf(k) <= 7 && c[k + 1] > 0 && c[k + 2] > 0) {
      c[k]--; c[k + 1]--; c[k + 2]--; walk(k, sets + 1, partials, pair); c[k]++; c[k + 1]++; c[k + 2]++
    }
    if (c[k] >= 2) {
      c[k] -= 2
      if (!pair) walk(k, sets, partials, true)
      walk(k, sets, partials + 1, pair)
      c[k] += 2
    }
    if (k < 27 && numOf(k) <= 8 && c[k + 1] > 0) {
      c[k]--; c[k + 1]--; walk(k, sets, partials + 1, pair); c[k]++; c[k + 1]++
    }
    if (k < 27 && numOf(k) <= 7 && c[k + 2] > 0) {
      c[k]--; c[k + 2]--; walk(k, sets, partials + 1, pair); c[k]++; c[k + 2]++
    }
    c[k]--
    walk(k + 1, sets, partials, pair) // この牌を捨て置く
    c[k]++
  }
  walk(0, 0, 0, false)
  if (nMelds === 0) {
    const pairs = counts.filter((x) => x >= 2).length
    const kinds = counts.filter((x) => x >= 1).length
    best = Math.min(best, 6 - pairs + Math.max(0, 7 - kinds))
    const termKinds = KOKUSHI_KINDS.filter((k) => counts[k] >= 1).length
    const hasPair = KOKUSHI_KINDS.some((k) => counts[k] >= 2)
    best = Math.min(best, 13 - termKinds - (hasPair ? 1 : 0))
  }
  return best
}

// ---- 面子分解の列挙(採点用) ----
function* decompose(counts, need) {
  function* walk(c, k, acc) {
    while (k < 34 && c[k] === 0) k++
    if (k === 34) { if (acc.length === need) yield acc.slice(); return }
    if (acc.length >= need) return
    if (c[k] >= 3) {
      c[k] -= 3; acc.push({ t: 'tri', k })
      yield* walk(c, k, acc)
      acc.pop(); c[k] += 3
    }
    if (k < 27 && numOf(k) <= 7 && c[k + 1] > 0 && c[k + 2] > 0) {
      c[k]--; c[k + 1]--; c[k + 2]--; acc.push({ t: 'seq', k })
      yield* walk(c, k, acc)
      acc.pop(); c[k]++; c[k + 1]++; c[k + 2]++
    }
  }
  for (let p = 0; p < 34; p++) {
    if (counts[p] >= 2) {
      const c = counts.slice()
      c[p] -= 2
      for (const sets of walk(c, 0, [])) yield { pair: p, sets }
    }
  }
}

// ---- 採点 ----
// ctx: { concealedCounts(和了牌込み), melds, winKind, tsumo, riichi, doubleRiichi, ippatsu,
//        seatWind, roundWind, doraKinds, uraKinds, akaCount, kitaCount,
//        haitei, houtei, rinshan, chankan, tenhou, chihou, sanma }
export function evaluateWin(ctx) {
  const { concealedCounts: cc, melds, winKind, tsumo } = ctx
  const openMelds = melds.filter((m) => m.type !== 'ankan')
  const closed = openMelds.length === 0
  const candidates = []

  const allKindTiles = () => {
    // 全構成牌のkind一覧(ドラ数え用)
    const list = []
    for (let k = 0; k < 34; k++) for (let i = 0; i < cc[k]; i++) list.push(k)
    for (const m of melds) for (const k of m.kinds) list.push(k)
    return list
  }

  const doraHan = () => {
    let n = 0
    const tiles = allKindTiles()
    for (const d of ctx.doraKinds) n += tiles.filter((k) => k === d).length
    if (ctx.riichi) for (const d of ctx.uraKinds) n += tiles.filter((k) => k === d).length
    n += ctx.akaCount + ctx.kitaCount
    return n
  }

  const commonYaku = (list) => {
    if (ctx.riichi && !ctx.doubleRiichi) list.push(['リーチ', 1])
    if (ctx.doubleRiichi) list.push(['ダブルリーチ', 2])
    if (ctx.ippatsu) list.push(['一発', 1])
    if (tsumo && closed) list.push(['門前清自摸和', 1])
    if (ctx.haitei) list.push(['海底摸月', 1])
    if (ctx.houtei) list.push(['河底撈魚', 1])
    if (ctx.rinshan) list.push(['嶺上開花', 1])
    if (ctx.chankan) list.push(['槍槓', 1])
  }

  // --- 国士無双 ---
  if (melds.length === 0 && KOKUSHI_KINDS.every((k) => cc[k] >= 1) &&
      cc.every((x, k) => x === 0 || KOKUSHI_KINDS.includes(k)) && cc.reduce((a, b) => a + b, 0) === 14) {
    const thirteenWait = cc[winKind] === 2
    const ym = (thirteenWait ? 2 : 1) + (ctx.tenhou || ctx.chihou ? 1 : 0)
    candidates.push({ yakuman: ym, yaku: [[thirteenWait ? '国士無双十三面' : '国士無双', 0]], han: 0, fu: 0 })
  }

  // --- 七対子系 ---
  if (melds.length === 0 && cc.filter((x) => x === 2).length === 7) {
    const kinds = []
    for (let k = 0; k < 34; k++) if (cc[k] === 2) kinds.push(k)
    if (kinds.every((k) => isHonor(k))) {
      candidates.push({ yakuman: 1 + (ctx.tenhou || ctx.chihou ? 1 : 0), yaku: [['字一色', 0]], han: 0, fu: 0 })
    } else {
      const yaku = [['七対子', 2]]
      commonYaku(yaku)
      if (kinds.every((k) => !isTermHonor(k))) yaku.push(['断么九', 1])
      if (kinds.every((k) => isTermHonor(k))) yaku.push(['混老頭', 2])
      const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf))
      if (suits.size === 1) yaku.push(kinds.some(isHonor) ? ['混一色', 3] : ['清一色', 6])
      if (ctx.tenhou) { candidates.push({ yakuman: 1, yaku: [['天和', 0]], han: 0, fu: 0 }) }
      else if (ctx.chihou) { candidates.push({ yakuman: 1, yaku: [['地和', 0]], han: 0, fu: 0 }) }
      else candidates.push({ yakuman: 0, yaku, han: yaku.reduce((a, y) => a + y[1], 0), fu: 25 })
    }
  }

  // --- 通常形 ---
  const meldSets = melds.map((m) => ({
    t: m.type === 'chi' ? 'seq' : 'tri',
    k: m.k,
    open: m.type !== 'ankan',
    kan: m.type.includes('kan'),
    fromMeld: true,
  }))
  for (const dec of decompose(cc, 4 - melds.length)) {
    // 和了牌の置き場所バリエーション(高点法)
    const spots = []
    dec.sets.forEach((s, i) => {
      if (s.t === 'tri' && s.k === winKind) spots.push({ set: i, wait: 'shanpon' })
      if (s.t === 'seq' && winKind >= s.k && winKind <= s.k + 2) {
        const pos = winKind - s.k
        let wait = 'ryanmen'
        if (pos === 1) wait = 'kanchan'
        else if (pos === 2 && numOf(s.k) === 1) wait = 'penchan'
        else if (pos === 0 && numOf(s.k) === 7) wait = 'penchan'
        spots.push({ set: i, wait })
      }
    })
    if (dec.pair === winKind) spots.push({ set: -1, wait: 'tanki' })
    for (const spot of spots.length ? spots : [{ set: -2, wait: 'shanpon' }]) {
      const sets = [
        ...meldSets,
        ...dec.sets.map((s, i) => ({
          t: s.t, k: s.k, open: false, kan: false,
          // ロン和了で完成した刻子は明刻扱い
          ronTri: !tsumo && s.t === 'tri' && spot.set === i,
        })),
      ]
      const pair = dec.pair
      const yaku = []
      let yakuman = 0

      const tris = sets.filter((s) => s.t === 'tri')
      const seqs = sets.filter((s) => s.t === 'seq')
      const ankos = tris.filter((s) => !s.open && !s.ronTri)
      const kans = sets.filter((s) => s.kan)
      const allKinds = allKindTiles()

      // 役満
      if (ctx.tenhou) { yakuman++; yaku.push(['天和', 0]) }
      if (ctx.chihou) { yakuman++; yaku.push(['地和', 0]) }
      if (ankos.length === 4) {
        yakuman += spot.wait === 'tanki' ? 2 : 1
        yaku.push([spot.wait === 'tanki' ? '四暗刻単騎' : '四暗刻', 0])
      }
      const dragonTris = tris.filter((s) => s.k >= HAKU).length
      if (dragonTris === 3) { yakuman++; yaku.push(['大三元', 0]) }
      const windTris = tris.filter((s) => s.k >= EAST && s.k <= NORTH).length
      const windPair = pair >= EAST && pair <= NORTH
      if (windTris === 4) { yakuman += 2; yaku.push(['大四喜', 0]) }
      else if (windTris === 3 && windPair) { yakuman++; yaku.push(['小四喜', 0]) }
      if (allKinds.every(isHonor)) { yakuman++; yaku.push(['字一色', 0]) }
      if (allKinds.every(isTerminal)) { yakuman++; yaku.push(['清老頭', 0]) }
      if (allKinds.every((k) => GREEN_KINDS.has(k))) { yakuman++; yaku.push(['緑一色', 0]) }
      if (kans.length === 4) { yakuman++; yaku.push(['四槓子', 0]) }
      if (closed && melds.length === 0) {
        const suits = new Set(allKinds.map(suitOf))
        if (suits.size === 1 && !allKinds.some(isHonor)) {
          const base = new Array(34).fill(0)
          const s0 = allKinds[0] - (numOf(allKinds[0]) - 1)
          base[s0] = 3; base[s0 + 8] = 3
          for (let n = 1; n <= 7; n++) base[s0 + n] = 1
          const isChuren = cc.every((x, k) => x >= (base[k] || 0)) // 1112345678999+1枚
          if (isChuren) {
            const before = cc.slice(); before[winKind]--
            const junsei = before.every((x, k) => x === (base[k] || 0))
            yakuman += junsei ? 2 : 1
            yaku.push([junsei ? '純正九蓮宝燈' : '九蓮宝燈', 0])
          }
        }
      }

      if (yakuman > 0) {
        candidates.push({ yakuman, yaku: yaku.filter((y) => y[1] === 0), han: 0, fu: 0 })
        continue
      }

      // 通常役
      commonYaku(yaku)
      const pinfu = closed && seqs.length === 4 && spot.wait === 'ryanmen' &&
        pair < HAKU && pair !== ctx.seatWind && pair !== ctx.roundWind
      if (pinfu) yaku.push(['平和', 1])
      if (allKinds.every((k) => !isTermHonor(k))) yaku.push(['断么九', 1])
      if (closed) {
        const seqKeys = seqs.map((s) => s.k)
        const dup = seqKeys.filter((k, i) => seqKeys.indexOf(k) !== i)
        const uniqDup = new Set(dup)
        if (uniqDup.size >= 2) yaku.push(['二盃口', 3])
        else if (dup.length >= 1) yaku.push(['一盃口', 1])
      }
      for (const s of tris) {
        if (s.k === HAKU) yaku.push(['役牌 白', 1])
        if (s.k === HATSU) yaku.push(['役牌 發', 1])
        if (s.k === CHUN) yaku.push(['役牌 中', 1])
        if (s.k === ctx.seatWind) yaku.push(['自風牌', 1])
        if (s.k === ctx.roundWind) yaku.push(['場風牌', 1])
      }
      // 三色同順/同刻・一気通貫
      const seqBySuitNum = seqs.map((s) => [suitOf(s.k), numOf(s.k)])
      for (let n = 1; n <= 7; n++) {
        if ([0, 1, 2].every((su) => seqBySuitNum.some(([s2, n2]) => s2 === su && n2 === n))) {
          yaku.push(['三色同順', closed ? 2 : 1]); break
        }
      }
      for (let n = 1; n <= 9; n++) {
        if ([0, 1, 2].every((su) => tris.some((s) => suitOf(s.k) === su && numOf(s.k) === n))) {
          yaku.push(['三色同刻', 2]); break
        }
      }
      for (let su = 0; su < 3; su++) {
        const base = su * 9
        if ([0, 3, 6].every((n) => seqs.some((s) => s.k === base + n))) {
          yaku.push(['一気通貫', closed ? 2 : 1]); break
        }
      }
      // チャンタ系
      const setHasTH = (s) => (s.t === 'seq' ? numOf(s.k) === 1 || numOf(s.k) === 7 : isTermHonor(s.k))
      if (sets.every(setHasTH) && isTermHonor(pair) && seqs.length > 0) {
        const anyHonor = sets.some((s) => s.t === 'tri' && isHonor(s.k)) || isHonor(pair)
        yaku.push(anyHonor ? ['混全帯么九', closed ? 2 : 1] : ['純全帯么九', closed ? 3 : 2])
      }
      if (tris.length === 4) yaku.push(['対々和', 2])
      if (ankos.length === 3) yaku.push(['三暗刻', 2])
      if (kans.length === 3) yaku.push(['三槓子', 2])
      if (dragonTris === 2 && pair >= HAKU) yaku.push(['小三元', 2])
      if (allKinds.every(isTermHonor)) yaku.push(['混老頭', 2])
      const suits = new Set(allKinds.filter((k) => !isHonor(k)).map(suitOf))
      if (suits.size === 1) {
        yaku.push(allKinds.some(isHonor) ? ['混一色', closed ? 3 : 2] : ['清一色', closed ? 6 : 5])
      }

      const han = yaku.reduce((a, y) => a + y[1], 0)
      if (han === 0) continue // 役なし

      // 符計算
      let fu
      if (pinfu) fu = tsumo ? 20 : 30
      else {
        fu = 20
        if (closed && !tsumo) fu += 10
        if (tsumo) fu += 2
        if (spot.wait === 'tanki' || spot.wait === 'kanchan' || spot.wait === 'penchan') fu += 2
        if (pair >= HAKU) fu += 2
        if (pair === ctx.seatWind) fu += 2
        if (pair === ctx.roundWind) fu += 2
        for (const s of tris) {
          let base = isTermHonor(s.k) ? 4 : 2
          if (!s.open && !s.ronTri) base *= 2
          if (s.kan) base *= 4
          fu += base
        }
        if (fu === 20 && !closed) fu = 30 // 喰い平和形
        fu = Math.ceil(fu / 10) * 10
      }
      candidates.push({ yakuman: 0, yaku, han, fu })
    }
  }

  if (candidates.length === 0) return null
  // 最高得点(役満 > 翻 > 符)
  let best = null
  for (const c of candidates) {
    if (c.yakuman === 0) {
      c.dora = doraHan()
      c.totalHan = c.han + c.dora
    } else c.totalHan = 0
    if (!best) { best = c; continue }
    if (c.yakuman !== best.yakuman) { if (c.yakuman > best.yakuman) best = c; continue }
    if (c.yakuman > 0) continue
    if (c.totalHan !== best.totalHan) { if (c.totalHan > best.totalHan) best = c; continue }
    if (c.fu > best.fu) best = c
  }
  if (best.yakuman === 0 && best.han === 0) return null
  return best
}

// 基本点 → 支払い
export function calcPayments(result, isDealer, tsumo, sanma) {
  let base
  let rank = ''
  if (result.yakuman > 0) { base = 8000 * result.yakuman; rank = result.yakuman > 1 ? `${result.yakuman}倍役満` : '役満' }
  else {
    const han = result.totalHan
    if (han >= 13) { base = 8000; rank = '数え役満' }
    else if (han >= 11) { base = 6000; rank = '三倍満' }
    else if (han >= 8) { base = 4000; rank = '倍満' }
    else if (han >= 6) { base = 3000; rank = '跳満' }
    else {
      base = result.fu * Math.pow(2, 2 + han)
      if (base > 2000) { base = 2000; rank = '満貫' }
    }
  }
  const ceil100 = (x) => Math.ceil(x / 100) * 100
  if (tsumo) {
    // サンマはツモ損(いない北家の支払い分は消える)
    if (isDealer) return { each: ceil100(base * 2), total: ceil100(base * 2) * (sanma ? 2 : 3), rank }
    return { fromDealer: ceil100(base * 2), fromOthers: ceil100(base), total: ceil100(base * 2) + ceil100(base) * (sanma ? 1 : 2), rank }
  }
  const total = ceil100(base * (isDealer ? 6 : 4))
  return { total, rank }
}

// ============================================================
// ゲーム進行
// ============================================================

export const isNpcId = (id) => typeof id === 'string' && id.startsWith('npc-')
const clone = (o) => JSON.parse(JSON.stringify(o))
const sortHand = (h) => h.sort((a, b) => a.k - b.k || (a.r ? -1 : 1) - (b.r ? -1 : 1) || a.id - b.id)

// 既定ルール(雀魂準拠)。hanchan=半荘(東南戦) / agariyame=オーラス親の和了やめ
export const DEFAULT_MJ_RULES = {
  hanchan: false,     // false=東風戦 / true=半荘戦
  kuikae: false,      // 喰い替えを許可するか(既定は禁止)
  agariyame: true,    // オーラス親のトップ目和了やめ・テンパイやめ
  nagashi: true,      // 流し満貫
  uma: true,          // ウマ・オカ(順位点)を最終結果に付ける
  tochu: true,        // 途中流局(九種九牌/四風連打/四家立直/四槓散了/三家和)
}
const UMA_4 = [20, 10, -10, -20] // 順位点(1位→4位)
const UMA_3 = [20, 0, -20]

export function createMahjongGame({ players, rules = {} }) {
  const sanma = players.length === 3
  const r = { ...DEFAULT_MJ_RULES, ...rules }
  const st = {
    mode: 'mahjong', sanma, rules: r,
    players: players.map((p) => ({ id: p.id, name: p.name, score: sanma ? 35000 : 25000, auto: false })),
    round: { wind: 0, num: 1, honba: 0, sticks: 0, dealer: 0 }, // wind: 0=東場 1=南場
    maxRounds: players.length,           // 1場あたりの局数
    maxWind: r.hanchan ? 1 : 0,          // 0=東風戦(東場まで) / 1=半荘戦(南場まで)
    phase: 'playing',
    roundResult: null,
    finalStandings: null,
  }
  return startRound(st)
}

function startRound(st) {
  const n = st.players.length
  const tiles = buildTiles(st.sanma)
  // 王牌14枚: ドラ表示5+裏5+残り4(飾り)。リンシャン/北抜きは山の末尾から
  st.doraTiles = tiles.splice(0, 5).map((t) => t.k)
  st.uraTiles = tiles.splice(0, 5).map((t) => t.k)
  tiles.splice(0, 4)
  st.doraRevealed = 1
  st.wall = tiles
  st.hands = []
  st.melds = []
  st.discards = []
  st.kitaCounts = []
  st.riichis = [] // null | { double, ippatsu, stickPaid }
  st.tempFuriten = []
  st.riichiFuriten = []
  st.turnsTaken = []
  for (let s = 0; s < n; s++) {
    st.hands.push(sortHand(st.wall.splice(0, 13)))
    st.melds.push([])
    st.discards.push([])
    st.kitaCounts.push(0)
    st.riichis.push(null)
    st.tempFuriten.push(false)
    st.riichiFuriten.push(false)
    st.turnsTaken.push(0)
  }
  st.anyCalls = false
  st.kanCount = 0
  st.pendingRiichi = null
  st.kakanPending = null
  st.rinshanFlag = false
  st.roundResult = null
  st.kanBy = []          // 各カンの実行者(四槓散了判定用)
  st.pao = []            // パオ(責任払い): [seat] -> 責任者seat
  st.kuikaeBan = []      // 鳴き直後の喰い替え禁止牌 [seat] -> kind[]
  st.nagashiAlive = st.players.map(() => true) // 流し満貫の候補(么九牌のみ切り+鳴かれていない)
  st.phase = 'playing'
  st.turn = st.round.dealer
  drawTile(st, st.turn)
  return st
}

const seatWindOf = (st, seat) => {
  const n = st.players.length
  return EAST + ((seat - st.round.dealer + n) % n)
}

function drawTile(st, seat, fromBack = false) {
  const t = fromBack ? st.wall.pop() : st.wall.shift()
  st.drawn = t
  st.drawnBy = seat
  st.tempFuriten[seat] = false
  st.turnsTaken[seat]++
  st.await = { type: 'turn', seat, deadline: 0 }
  return t
}

const liveDora = (st) => st.doraTiles.slice(0, st.doraRevealed).map(doraFromIndicator)
const liveUra = (st) => st.uraTiles.slice(0, st.doraRevealed).map(doraFromIndicator)

// seatの手牌(concealed)+n枚でカウント
function handCounts(st, seat, extraKind = null) {
  const c = countsOf(st.hands[seat])
  if (extraKind !== null) c[extraKind]++
  return c
}

// seatがkindで和了できるか(役アリ前提でevaluateWinまで見る)
function winResult(st, seat, kind, opts) {
  const cc = handCounts(st, seat, opts.tsumo ? null : kind)
  if (opts.tsumo) cc[kind]++ // ツモ牌は手牌に未追加
  if (!isWinningHand(cc, st.melds[seat].length)) return null
  const akaCount =
    st.hands[seat].filter((t) => t.r).length +
    st.melds[seat].reduce((a, m) => a + m.tiles.filter((t) => t.r).length, 0) +
    (opts.winTileRed ? 1 : 0)
  const ri = st.riichis[seat]
  return evaluateWin({
    concealedCounts: cc,
    melds: st.melds[seat].map((m) => ({ type: m.type, k: m.k, kinds: m.tiles.map((t) => t.k) })),
    winKind: kind,
    tsumo: !!opts.tsumo,
    riichi: !!ri, doubleRiichi: !!ri?.double, ippatsu: !!ri?.ippatsu,
    seatWind: seatWindOf(st, seat), roundWind: EAST + (st.round.wind || 0),
    doraKinds: liveDora(st), uraKinds: ri ? liveUra(st) : [],
    akaCount, kitaCount: st.kitaCounts[seat],
    haitei: !!opts.haitei, houtei: !!opts.houtei, rinshan: !!opts.rinshan, chankan: !!opts.chankan,
    tenhou: !!opts.tenhou, chihou: !!opts.chihou,
    sanma: st.sanma,
  })
}

function seatWaits(st, seat) {
  return waitsOf(countsOf(st.hands[seat]), st.melds[seat].length, st.sanma)
}

function isFuriten(st, seat) {
  if (st.riichiFuriten[seat] || st.tempFuriten[seat]) return true
  const waits = seatWaits(st, seat)
  if (waits.length === 0) return false
  const own = new Set(st.discards[seat].map((d) => d.k))
  return waits.some((w) => own.has(w))
}

// ---- 手番プレイヤーの選択肢 ----
export function getTurnOptions(st, seat) {
  if (st.phase !== 'playing' || st.await?.type !== 'turn' || st.await.seat !== seat) return null
  const opts = { canTsumo: false, riichiTiles: [], kans: [], canKita: false, canKyuushu: false, riichi: !!st.riichis[seat] }
  const drawn = st.drawn
  // 九種九牌: 第1ツモ(自分の1巡目・鳴きなし)で么九牌が9種類以上
  if (st.rules?.tochu !== false && drawn && st.turnsTaken[seat] === 1 && !st.anyCalls) {
    const c = countsOf([...st.hands[seat], drawn])
    const kinds = KOKUSHI_KINDS.filter((k) => c[k] > 0).length
    if (kinds >= 9) opts.canKyuushu = true
  }
  if (drawn) {
    const firstTurn = st.turnsTaken[seat] === 1 && !st.anyCalls
    const r = winResult(st, seat, drawn.k, {
      tsumo: true, winTileRed: drawn.r,
      haitei: st.wall.length === 0, rinshan: !!st.rinshanFlag,
      tenhou: firstTurn && seat === st.round.dealer, chihou: firstTurn && seat !== st.round.dealer,
    })
    if (r) opts.canTsumo = true
  }
  const c = handCounts(st, seat)
  if (drawn) c[drawn.k]++
  // カン(手番中: 暗槓・加槓)
  if (st.wall.length > 0 && st.kanCount < 4) {
    for (let k = 0; k < 34; k++) {
      if (c[k] === 4) {
        if (st.riichis[seat]) {
          // リーチ中はツモった牌の暗槓のみ・待ちが変わらない場合のみ
          if (drawn && drawn.k === k) {
            const before = seatWaits(st, seat)
            const cc = countsOf(st.hands[seat]); cc[k] = 0
            const after = waitsOf(cc, st.melds[seat].length + 1, st.sanma)
            if (before.length === after.length && before.every((w, i) => w === after[i])) {
              opts.kans.push({ kanType: 'ankan', kind: k })
            }
          }
        } else opts.kans.push({ kanType: 'ankan', kind: k })
      }
    }
    if (!st.riichis[seat]) {
      for (const m of st.melds[seat]) {
        if (m.type === 'pon' && c[m.k] >= 1) opts.kans.push({ kanType: 'kakan', kind: m.k })
      }
    }
  }
  // 北抜き(サンマ)
  if (st.sanma && st.wall.length > 0 && c[NORTH] > 0 && !st.riichis[seat]) opts.canKita = true
  // リーチ
  if (!st.riichis[seat] && st.melds[seat].every((m) => m.type === 'ankan') &&
      st.players[seat].score >= 1000 && st.wall.length >= (st.players.length === 3 ? 3 : 4) && drawn) {
    const hand14 = [...st.hands[seat], drawn]
    const seen = new Set()
    for (const t of hand14) {
      if (seen.has(t.k)) continue
      seen.add(t.k)
      const cc = countsOf(hand14); cc[t.k]--
      if (waitsOf(cc, st.melds[seat].length, st.sanma).length > 0) opts.riichiTiles.push(t.k)
    }
  }
  return opts
}

// ---- 他家の選択肢(discard/kakan後) ----
export function getClaimOptions(st, seat) {
  if (st.phase !== 'playing' || st.await?.type !== 'claims') return null
  if (!st.await.pending.includes(seat)) return null
  const { fromSeat, tileKind, tileRed, chankan } = st.await
  const res = { canRon: false, canPon: false, canMinkan: false, chis: [] }
  // ロン
  const cc = handCounts(st, seat, tileKind)
  if (isWinningHand(cc, st.melds[seat].length) && !isFuriten(st, seat)) {
    const r = winResult(st, seat, tileKind, {
      tsumo: false, winTileRed: tileRed,
      houtei: st.wall.length === 0 && !chankan, chankan,
    })
    if (r) res.canRon = true
  }
  if (chankan) return res // 槍槓はロンのみ
  const c = countsOf(st.hands[seat])
  if (st.wall.length > 0) {
    if (c[tileKind] >= 2) res.canPon = true
    if (c[tileKind] >= 3 && st.kanCount < 4) res.canMinkan = true
    // チー(下家のみ・サンマなし)
    const n = st.players.length
    if (!st.sanma && seat === (fromSeat + 1) % n && !isHonor(tileKind)) {
      const num = numOf(tileKind)
      const has = (dk) => c[tileKind + dk] > 0 && suitOf(tileKind + dk) === suitOf(tileKind)
      if (num >= 3 && has(-2) && has(-1)) res.chis.push([tileKind - 2, tileKind - 1])
      if (num >= 2 && num <= 8 && has(-1) && has(1)) res.chis.push([tileKind - 1, tileKind + 1])
      if (num <= 7 && has(1) && has(2)) res.chis.push([tileKind + 1, tileKind + 2])
    }
  }
  if (st.riichis[seat]) { res.canPon = false; res.canMinkan = false; res.chis = [] }
  return res
}

// ---- アクション適用 ----
export function applyMahjong(state, playerId, action) {
  const st = clone(state)
  const seat = st.players.findIndex((p) => p.id === playerId)
  if (seat === -1 && action.type !== 'next') return { error: '対局者ではありません' }
  const ev = []

  try {
    switch (action.type) {
      case 'discard': return doDiscard(st, seat, action, ev, false)
      case 'riichi': return doDiscard(st, seat, action, ev, true)
      case 'tsumo': return doTsumo(st, seat, ev)
      case 'kan': return doKan(st, seat, action, ev)
      case 'kita': return doKita(st, seat, ev)
      case 'kyuushu': {
        requireTurn(st, seat)
        const o = getTurnOptions(st, seat)
        if (!o?.canKyuushu) return { error: '九種九牌を宣言できません' }
        return abortiveDraw(st, 'kyuushu', ev)
      }
      case 'ron': return doClaim(st, seat, { claim: 'ron' }, ev)
      case 'pon': return doClaim(st, seat, { claim: 'pon' }, ev)
      case 'minkan': return doClaim(st, seat, { claim: 'minkan' }, ev)
      case 'chi': return doClaim(st, seat, { claim: 'chi', chi: action.chi }, ev)
      case 'pass': return doClaim(st, seat, { claim: 'pass' }, ev)
      case 'next': return doNext(st, ev)
      default: return { error: '不明な操作です' }
    }
  } catch (e) {
    return { error: `エンジンエラー: ${e.message}` }
  }
}

function requireTurn(st, seat) {
  if (st.phase !== 'playing' || st.await?.type !== 'turn' || st.await.seat !== seat) throw new Error('あなたの番ではありません')
}

function doDiscard(st, seat, action, ev, riichi) {
  requireTurn(st, seat)
  const hand14 = st.drawn ? [...st.hands[seat], st.drawn] : [...st.hands[seat]]
  const idx = hand14.findIndex((t) => t.id === action.tileId)
  if (idx === -1) return { error: 'その牌は持っていません' }
  const tile = hand14[idx]
  if (st.riichis[seat] && st.drawn && tile.id !== st.drawn.id) return { error: 'リーチ中はツモ切りのみです' }
  // 喰い替え禁止(鳴いた直後に同じ牌・筋の牌は切れない)
  if (st.rules?.kuikae === false && (st.kuikaeBan?.[seat] || []).includes(tile.k)) {
    return { error: '喰い替えはできません' }
  }
  if (riichi) {
    const opts = getTurnOptions(st, seat)
    if (!opts.riichiTiles.includes(tile.k)) return { error: 'その牌ではリーチできません' }
    // 捨てた後テンパイしているか個別確認
    const cc = countsOf(hand14.filter((t) => t.id !== tile.id))
    if (waitsOf(cc, st.melds[seat].length, st.sanma).length === 0) return { error: 'その牌ではリーチできません' }
  }
  hand14.splice(idx, 1)
  st.hands[seat] = sortHand(hand14)
  st.drawn = null
  st.rinshanFlag = false
  // 一発消滅(リーチ後の自分の打牌)
  if (st.riichis[seat]?.ippatsu && !riichi) st.riichis[seat].ippatsu = false
  st.discards[seat].push({ id: tile.id, k: tile.k, r: tile.r, riichi })
  if (st.kuikaeBan) st.kuikaeBan[seat] = [] // 打牌したら喰い替え制限は解除
  if (!isTermHonor(tile.k) || st.melds[seat].length > 0) st.nagashiAlive[seat] = false // 流し満貫の候補から外れる
  if (riichi) st.pendingRiichi = { seat, double: st.turnsTaken[seat] === 1 && !st.anyCalls }
  ev.push({ t: 'discard', seat, kind: tile.k })
  // ---- 途中流局: 九種九牌は打牌前に宣言する形だが、ここでは四風連打/四家立直を判定 ----
  const tochu = st.rules?.tochu !== false
  if (tochu) {
    // 四風連打: 開局から全員が同じ風牌を1枚ずつ切った(鳴きなし)
    const n = st.players.length
    if (!st.anyCalls && n === 4 && st.discards.every((d) => d.length === 1)
        && st.discards.every((d) => d[0].k === st.discards[0][0].k) && st.discards[0][0].k >= EAST && st.discards[0][0].k <= NORTH) {
      return abortiveDraw(st, 'suufonrenda', ev)
    }
    // 四家立直: 4人全員がリーチ(この宣言が通った時点)
    if (riichi && st.riichis.filter(Boolean).length + 1 >= n && n >= 4) {
      st.pendingRiichi = null
      st.riichis[seat] = { double: false, ippatsu: false }
      st.players[seat].score -= 1000
      st.round.sticks++
      return abortiveDraw(st, 'suuchariichi', ev)
    }
  }
  return openClaims(st, seat, tile, ev, false)
}

// 打牌/加槓後: 他家の反応待ちを設定(誰も反応できなければ即進行)
function openClaims(st, fromSeat, tile, ev, chankan) {
  const n = st.players.length
  st.await = {
    type: 'claims', fromSeat, tileId: tile.id, tileKind: tile.k, tileRed: !!tile.r,
    chankan, pending: [], responses: {}, deadline: 0,
  }
  for (let s = 0; s < n; s++) {
    if (s !== fromSeat) st.await.pending.push(s)
  }
  for (const s of [...st.await.pending]) {
    const o = getClaimOptions(st, s)
    const has = o && (o.canRon || o.canPon || o.canMinkan || o.chis.length > 0)
    if (!has) {
      st.await.responses[s] = { claim: 'pass' }
      st.await.pending = st.await.pending.filter((x) => x !== s)
    }
  }
  if (st.await.pending.length === 0) return resolveClaims(st, ev)
  return { state: st, events: ev }
}

function doClaim(st, seat, resp, ev) {
  if (st.phase !== 'playing' || st.await?.type !== 'claims') return { error: '今は反応できません' }
  if (!st.await.pending.includes(seat)) return { error: '反応済みです' }
  if (resp.claim !== 'pass') {
    const o = getClaimOptions(st, seat)
    const ok = (resp.claim === 'ron' && o.canRon) || (resp.claim === 'pon' && o.canPon) ||
      (resp.claim === 'minkan' && o.canMinkan) ||
      (resp.claim === 'chi' && o.chis.some((c) => c[0] === resp.chi?.[0] && c[1] === resp.chi?.[1]))
    if (!ok) return { error: 'その操作はできません' }
  }
  st.await.responses[seat] = resp
  st.await.pending = st.await.pending.filter((x) => x !== seat)
  if (st.await.pending.length > 0) return { state: st, events: ev }
  return resolveClaims(st, ev)
}

function resolveClaims(st, ev) {
  const { fromSeat, tileKind, tileRed, chankan, responses } = st.await
  const n = st.players.length
  const rons = [], pons = [], kans = [], chis = []
  for (const [s, r] of Object.entries(responses)) {
    const seat = Number(s)
    if (r.claim === 'ron') rons.push(seat)
    else if (r.claim === 'pon') pons.push(seat)
    else if (r.claim === 'minkan') kans.push(seat)
    else if (r.claim === 'chi') chis.push({ seat, chi: r.chi })
    else if (r.claim === 'pass') {
      // 見逃しフリテン
      const cc = handCounts(st, seat, tileKind)
      if (isWinningHand(cc, st.melds[seat].length)) {
        if (st.riichis[seat]) st.riichiFuriten[seat] = true
        else st.tempFuriten[seat] = true
      }
    }
  }
  if (rons.length > 0) {
    // 三家和(4人戦で3人同時ロン)は途中流局
    if (st.rules?.tochu !== false && n === 4 && rons.length >= 3) {
      return abortiveDraw(st, 'sanchaho', ev)
    }
    return settleWin(st, rons.sort((a, b) => ((a - fromSeat + n) % n) - ((b - fromSeat + n) % n)),
      { tsumo: false, fromSeat, winKind: tileKind, winRed: tileRed, chankan }, ev)
  }
  // リーチ成立(ロンされなかった)
  if (st.pendingRiichi) {
    const { seat, double } = st.pendingRiichi
    st.riichis[seat] = { double, ippatsu: true }
    st.players[seat].score -= 1000
    st.round.sticks++
    st.pendingRiichi = null
    ev.push({ t: 'call', seat, what: double ? 'ダブルリーチ' : 'リーチ' })
  }
  if (chankan) {
    // 槍槓ロンなし → 加槓続行(リンシャン)
    return continueKakan(st, ev)
  }
  const caller = pons[0] ?? kans[0] ?? chis[0]?.seat
  if (caller !== undefined) {
    st.anyCalls = true
    for (let s = 0; s < n; s++) if (st.riichis[s]) st.riichis[s].ippatsu = false
    const disc = st.discards[fromSeat]
    const called = disc[disc.length - 1]
    called.called = true
    st.nagashiAlive[fromSeat] = false // 鳴かれたので流し満貫の候補から外れる
    const takeTiles = (seat, kind, count) => {
      const taken = []
      // 赤でない牌から使う(赤は手元に残す)
      const sorted = [...st.hands[seat]].sort((a, b) => (a.r ? 1 : 0) - (b.r ? 1 : 0))
      for (const t of sorted) {
        if (t.k === kind && taken.length < count) taken.push(t)
      }
      st.hands[seat] = st.hands[seat].filter((t) => !taken.includes(t))
      return taken
    }
    const calledTile = { id: called.id, k: called.k, r: called.r }
    if (pons.length > 0) {
      const seat = pons[0]
      const mine = takeTiles(seat, tileKind, 2)
      st.melds[seat].push({ type: 'pon', k: tileKind, tiles: [...mine, calledTile], from: fromSeat })
      ev.push({ t: 'call', seat, what: 'ポン' })
      st.kuikaeBan[seat] = [tileKind] // 喰い替え禁止: ポンした牌と同じ牌は切れない
      checkPao(st, seat, fromSeat)    // パオ(責任払い)判定
      st.drawn = null
      st.await = { type: 'turn', seat, deadline: 0 }
      st.turn = seat
      return { state: st, events: ev }
    }
    if (kans.length > 0) {
      const seat = kans[0]
      const mine = takeTiles(seat, tileKind, 3)
      st.melds[seat].push({ type: 'minkan', k: tileKind, tiles: [...mine, calledTile], from: fromSeat })
      st.kanCount++
      st.kanBy.push(seat)
      checkPao(st, seat, fromSeat)   // パオ(責任払い)判定
      if (st.doraRevealed < 5) st.doraRevealed++
      ev.push({ t: 'call', seat, what: 'カン' })
      const ab = checkSuukaikan(st, ev)
      if (ab) return ab
      st.turn = seat
      drawTile(st, seat, true)
      st.rinshanFlag = true
      return { state: st, events: ev }
    }
    const { seat, chi } = chis[0]
    const t1 = takeTiles(seat, chi[0], 1)
    const t2 = takeTiles(seat, chi[1], 1)
    st.melds[seat].push({ type: 'chi', k: Math.min(tileKind, chi[0], chi[1]), tiles: [...t1, ...t2, calledTile], from: fromSeat })
    ev.push({ t: 'call', seat, what: 'チー' })
    // 喰い替え禁止: 鳴いた牌と同じ牌 + 順子の反対側(筋)の牌は切れない
    {
      const ban = [tileKind]
      const lo = Math.min(chi[0], chi[1]), hi = Math.max(chi[0], chi[1])
      if (tileKind === lo - 1 && numOf(hi) <= 8 && suitOf(hi + 1) === suitOf(hi)) ban.push(hi + 1)
      if (tileKind === hi + 1 && numOf(lo) >= 2 && suitOf(lo - 1) === suitOf(lo)) ban.push(lo - 1)
      st.kuikaeBan[seat] = ban
    }
    st.drawn = null
    st.await = { type: 'turn', seat, deadline: 0 }
    st.turn = seat
    return { state: st, events: ev }
  }
  // 全員スルー → 流局判定 or 次の人がツモ
  if (st.wall.length === 0) return settleDraw(st, ev)
  const next = (fromSeat + 1) % n
  st.turn = next
  drawTile(st, next)
  return { state: st, events: ev }
}

function doTsumo(st, seat, ev) {
  requireTurn(st, seat)
  if (!st.drawn) return { error: 'ツモ牌がありません' }
  const firstTurn = st.turnsTaken[seat] === 1 && !st.anyCalls
  const opts = {
    tsumo: true, winTileRed: st.drawn.r,
    haitei: st.wall.length === 0, rinshan: !!st.rinshanFlag,
    tenhou: firstTurn && seat === st.round.dealer, chihou: firstTurn && seat !== st.round.dealer,
  }
  const r = winResult(st, seat, st.drawn.k, opts)
  if (!r) return { error: '和了できません(役なし)' }
  return settleWin(st, [seat], { ...opts, winKind: st.drawn.k, winRed: st.drawn.r }, ev)
}

function doKan(st, seat, action, ev) {
  requireTurn(st, seat)
  const opts = getTurnOptions(st, seat)
  const kan = opts.kans.find((k) => k.kanType === action.kanType && k.kind === action.kind)
  if (!kan) return { error: 'カンできません' }
  const hand14 = st.drawn ? [...st.hands[seat], st.drawn] : [...st.hands[seat]]
  if (kan.kanType === 'ankan') {
    const tiles = hand14.filter((t) => t.k === kan.kind)
    st.hands[seat] = sortHand(hand14.filter((t) => t.k !== kan.kind))
    st.drawn = null
    st.melds[seat].push({ type: 'ankan', k: kan.kind, tiles, from: null })
    st.kanCount++
    st.kanBy.push(seat)
    if (st.doraRevealed < 5) st.doraRevealed++
    st.anyCalls = true
    for (let s = 0; s < st.players.length; s++) if (st.riichis[s]) st.riichis[s].ippatsu = false
    ev.push({ t: 'call', seat, what: 'カン' })
    const ab = checkSuukaikan(st, ev)
    if (ab) return ab
    // 国士無双の暗槓に対する槍槓(大明槓と同じくロンのみ受け付ける)
    const kokushiRon = st.players.some((p, s) => {
      if (s === seat || st.melds[s].length > 0) return false
      const cc = countsOf(st.hands[s]); cc[kan.kind]++
      return isWinningHand(cc, 0) && KOKUSHI_KINDS.includes(kan.kind)
    })
    if (kokushiRon) {
      st.kokushiAnkan = true
      const r = openClaims(st, seat, tiles[0], ev, true)
      st.kokushiAnkan = false
      // 誰もロンしなければ continueKokushiAnkan 経由で嶺上へ(kakanPendingで代用)
      if (r.state.await?.type === 'claims') {
        r.state.kakanPending = { seat, kind: kan.kind, tileId: tiles[0].id, tileRed: false, tile: tiles[0], ankan: true }
        return r
      }
    }
    st.turn = seat
    drawTile(st, seat, true)
    st.rinshanFlag = true
    return { state: st, events: ev }
  }
  // 加槓 → 槍槓チャンス
  const tileIdx = hand14.findIndex((t) => t.k === kan.kind)
  const tile = hand14[tileIdx]
  hand14.splice(tileIdx, 1)
  st.hands[seat] = sortHand(hand14)
  st.drawn = null
  st.kakanPending = { seat, kind: kan.kind, tileId: tile.id, tileRed: !!tile.r, tile }
  ev.push({ t: 'call', seat, what: 'カン' })
  return openClaims(st, seat, tile, ev, true)
}

function continueKakan(st, ev) {
  const { seat, kind, tile, ankan } = st.kakanPending
  st.kakanPending = null
  if (ankan) {
    // 国士の槍槓が起きなかった暗槓: 既に成立済みなので嶺上ツモへ進むだけ
    st.turn = seat
    drawTile(st, seat, true)
    st.rinshanFlag = true
    return { state: st, events: ev }
  }
  const meld = st.melds[seat].find((m) => m.type === 'pon' && m.k === kind)
  meld.type = 'kakan'
  meld.tiles = [...meld.tiles, tile]
  st.kanCount++
  st.kanBy.push(seat)
  if (st.doraRevealed < 5) st.doraRevealed++
  st.anyCalls = true
  for (let s = 0; s < st.players.length; s++) if (st.riichis[s]) st.riichis[s].ippatsu = false
  st.turn = seat
  drawTile(st, seat, true)
  st.rinshanFlag = true
  return { state: st, events: ev }
}

function doKita(st, seat, ev) {
  requireTurn(st, seat)
  const opts = getTurnOptions(st, seat)
  if (!opts.canKita) return { error: '北抜きできません' }
  const hand14 = st.drawn ? [...st.hands[seat], st.drawn] : [...st.hands[seat]]
  const idx = hand14.findIndex((t) => t.k === NORTH)
  hand14.splice(idx, 1)
  st.hands[seat] = sortHand(hand14)
  st.drawn = null
  st.kitaCounts[seat]++
  st.anyCalls = true
  ev.push({ t: 'call', seat, what: '北' })
  drawTile(st, seat, true)
  return { state: st, events: ev }
}

// ---- 和了精算 ----
function settleWin(st, winners, opts, ev) {
  const n = st.players.length
  const results = []
  for (const seat of winners) ev.push({ t: 'call', seat, what: opts.tsumo ? 'ツモ' : 'ロン' })
  // リーチ棒: 立直宣言牌ロンの場合は宣言不成立(supplied by pendingRiichi remains unpaid)
  st.pendingRiichi = null
  let sticks = st.round.sticks
  const honba = st.round.honba
  let first = true
  for (const seat of winners) {
    const winKind = opts.tsumo ? st.drawn.k : opts.winKind
    const r = winResult(st, seat, winKind, {
      tsumo: opts.tsumo, winTileRed: opts.tsumo ? st.drawn.r : opts.winRed,
      haitei: opts.haitei, houtei: st.wall.length === 0 && !opts.tsumo && !opts.chankan,
      rinshan: opts.rinshan, chankan: opts.chankan, tenhou: opts.tenhou, chihou: opts.chihou,
    })
    if (!r) continue
    const isDealer = seat === st.round.dealer
    const pay = calcPayments(r, isDealer, !!opts.tsumo, st.sanma)
    let gain = 0
    // パオ(責任払い): 役満をその鳴きで確定させた者が支払う
    //   ツモ和了 → 責任者が全額 / ロン和了 → 責任者と放銃者で折半
    const paoSeat = (r.yakuman > 0 && st.pao?.[seat] !== undefined && st.pao[seat] !== null) ? st.pao[seat] : null
    if (paoSeat !== null && paoSeat !== seat) {
      const full = (isDealer ? 6 : 4) * (r.yakuman > 0 ? 8000 * r.yakuman : 0)
      const honbaAll = honba * 300
      if (opts.tsumo) {
        const amount = full + honbaAll
        st.players[paoSeat].score -= amount
        gain += amount
      } else {
        const half = Math.ceil(full / 2 / 100) * 100
        st.players[paoSeat].score -= half + (first ? honbaAll / 2 : 0)
        st.players[opts.fromSeat].score -= (full - half) + (first ? honbaAll / 2 : 0)
        gain += full + (first ? honbaAll : 0)
      }
      ev.push({ t: 'pao', seat, paoSeat })
    } else if (opts.tsumo) {
      if (isDealer) {
        for (let s = 0; s < n; s++) {
          if (s === seat) continue
          st.players[s].score -= pay.each + honba * 100
          gain += pay.each + honba * 100
        }
      } else {
        for (let s = 0; s < n; s++) {
          if (s === seat) continue
          const amount = (s === st.round.dealer ? pay.fromDealer : pay.fromOthers) + honba * 100
          st.players[s].score -= amount
          gain += amount
        }
      }
    } else {
      const amount = pay.total + (first ? honba * 300 : 0)
      st.players[opts.fromSeat].score -= amount
      gain += amount
    }
    if (first) { gain += sticks * 1000; sticks = 0 }
    st.players[seat].score += gain
    results.push({
      seat, name: st.players[seat].name,
      yaku: r.yaku, han: r.han, dora: r.dora || 0, totalHan: r.totalHan, fu: r.fu,
      yakuman: r.yakuman, rank: pay.rank, gain,
      hand: st.hands[seat].map((t) => ({ k: t.k, r: t.r })),
      winTile: { k: opts.tsumo ? st.drawn.k : opts.winKind, r: opts.tsumo ? st.drawn.r : opts.winRed },
      melds: st.melds[seat],
      tsumo: !!opts.tsumo,
      ura: st.riichis[seat] ? st.uraTiles.slice(0, st.doraRevealed) : [],
    })
    first = false
  }
  st.round.sticks = sticks
  const dealerWon = winners.includes(st.round.dealer)
  st.roundResult = { type: 'win', results, dealerRepeat: dealerWon }
  return finishRound(st, dealerWon, !dealerWon, ev)
}

// ---- 途中流局(九種九牌/四風連打/四家立直/四槓散了/三家和) ----
// 点棒移動なし・親は流れない(連荘)・本場+1
const ABORT_LABEL = {
  kyuushu: '九種九牌', suufonrenda: '四風連打', suuchariichi: '四家立直',
  suukaikan: '四槓散了', sanchaho: '三家和',
}
// パオ(責任払い)判定: 鳴かせたことで大三元/大四喜の3つ目・4つ目を確定させた者は責任を負う
// meldsは鳴き適用後の状態。fromSeat=鳴かれた側
function checkPao(st, seat, fromSeat) {
  if (fromSeat === null || fromSeat === undefined || fromSeat === seat) return
  const open = st.melds[seat].filter((m) => m.type !== 'ankan')
  const dragons = open.filter((m) => m.k >= HAKU).length
  const winds = open.filter((m) => m.k >= EAST && m.k <= NORTH).length
  if (dragons === 3 || winds === 4) st.pao[seat] = fromSeat
}

// 四槓散了: 4つのカンが2人以上に分散していたら流局(1人で4つ=四槓子なので続行)
function checkSuukaikan(st, ev) {
  if (st.rules?.tochu === false) return null
  if (st.kanCount < 4) return null
  const uniq = new Set(st.kanBy)
  if (uniq.size <= 1) return null
  return abortiveDraw(st, 'suukaikan', ev)
}

function abortiveDraw(st, reason, ev) {
  st.roundResult = { type: 'abort', reason, label: ABORT_LABEL[reason] || '途中流局', dealerRepeat: true }
  ev.push({ t: 'abort', reason, label: ABORT_LABEL[reason] || '途中流局' })
  return finishRound(st, true, false, ev)
}

// ---- 流局 ----
function settleDraw(st, ev) {
  const n = st.players.length
  // 流し満貫: 自分の捨て牌が全て么九牌で1枚も鳴かれていない → 満貫のツモ和了相当
  if (st.rules?.nagashi !== false) {
    const nagashiSeats = []
    for (let s = 0; s < n; s++) {
      if (!st.nagashiAlive?.[s]) continue
      const d = st.discards[s]
      if (d.length > 0 && d.every((x) => isTermHonor(x.k) && !x.called)) nagashiSeats.push(s)
    }
    if (nagashiSeats.length > 0) {
      const results = []
      for (const seat of nagashiSeats) {
        const isDealer = seat === st.round.dealer
        const pay = calcPayments({ yakuman: 0, totalHan: 5, fu: 30 }, isDealer, true, st.sanma)
        let gain = 0
        for (let s = 0; s < n; s++) {
          if (s === seat) continue
          const amount = isDealer ? pay.each : (s === st.round.dealer ? pay.fromDealer : pay.fromOthers)
          st.players[s].score -= amount
          gain += amount
        }
        st.players[seat].score += gain
        results.push({ seat, name: st.players[seat].name, gain, rank: '流し満貫' })
      }
      const dealerNagashi = nagashiSeats.includes(st.round.dealer)
      st.roundResult = { type: 'nagashi', results, dealerRepeat: dealerNagashi }
      ev.push({ t: 'nagashi', seats: nagashiSeats })
      return finishRound(st, dealerNagashi, !dealerNagashi, ev)
    }
  }
  const tenpai = []
  for (let s = 0; s < n; s++) tenpai.push(seatWaits(st, s).length > 0)
  const tCount = tenpai.filter(Boolean).length
  const pool = st.sanma ? 2000 : 3000
  if (tCount > 0 && tCount < n) {
    const gain = pool / tCount
    const loss = pool / (n - tCount)
    for (let s = 0; s < n; s++) st.players[s].score += tenpai[s] ? gain : -loss
  }
  const dealerTenpai = tenpai[st.round.dealer]
  st.roundResult = {
    type: 'draw', tenpai,
    hands: st.hands.map((h, s) => (tenpai[s] ? h.map((t) => ({ k: t.k, r: t.r })) : null)),
    dealerRepeat: dealerTenpai,
  }
  return finishRound(st, dealerTenpai, !dealerTenpai, ev)
}

function finishRound(st, dealerRepeat, resetHonba, ev) {
  if (st.roundResult.type === 'draw' || !resetHonba) st.round.honba++
  else st.round.honba = 0
  st.await = null
  st.drawn = null
  const n = st.players.length
  const busted = st.players.some((p) => p.score < 0)
  const isLastRound = (st.round.wind || 0) >= st.maxWind && st.round.num >= st.maxRounds // オーラス
  let over = busted
  if (!over && isLastRound) {
    if (!dealerRepeat) over = true
    else if (st.rules?.agariyame !== false) {
      // アガリやめ/テンパイやめ: オーラス親が連荘条件を満たしてもトップなら終局
      const dScore = st.players[st.round.dealer].score
      const top = Math.max(...st.players.map((p) => p.score))
      if (dScore >= top) over = true
    }
    // 連荘上限(無限ループ防止): オーラスは本場が規定を超えたら強制終了
    if (!over && st.round.honba >= 8) over = true
  }
  st.roundResult.gameOver = over
  st.phase = 'roundEnd'
  return { state: st, events: ev }
}

function doNext(st, ev) {
  if (st.phase !== 'roundEnd') return { error: '局は進行中です' }
  if (st.roundResult.gameOver) {
    // 供託は1位へ
    const order = st.players.map((p, i) => ({ ...p, seat: i })).sort((a, b) => b.score - a.score || a.seat - b.seat)
    order[0].scoreWithSticks = true
    st.players[order[0].seat].score += st.round.sticks * 1000
    st.round.sticks = 0
    // ウマ・オカ(順位点): 素点を1000で割った差分 + 順位点。同点は上家優先
    const n = st.players.length
    const base = st.sanma ? 35000 : 25000
    const uma = st.sanma ? UMA_3 : UMA_4
    const ranked = st.players.map((p, i) => ({ seat: i, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score || a.seat - b.seat)
    st.finalStandings = ranked.map((r, i) => ({
      ...r,
      uma: st.rules?.uma !== false ? uma[i] ?? 0 : 0,
      pt: st.rules?.uma !== false
        ? Math.round(((r.score - base) / 1000 + (uma[i] ?? 0)) * 10) / 10
        : Math.round(((r.score - base) / 1000) * 10) / 10,
    }))
    st.phase = 'ended'
    st.roundResult = null
    return { state: st, events: ev }
  }
  if (!st.roundResult.dealerRepeat) {
    st.round.dealer = (st.round.dealer + 1) % st.players.length
    if (st.round.num >= st.maxRounds) { st.round.wind = (st.round.wind || 0) + 1; st.round.num = 1 }
    else st.round.num++
  }
  startRound(st)
  return { state: st, events: ev }
}

// ---- タイムアウト時の自動行動 ----
// 喰い替え禁止で打てない牌か
const banned = (st, seat, kind) =>
  st.rules?.kuikae === false && (st.kuikaeBan?.[seat] || []).includes(kind)

export function autoActionFor(st, seat) {
  if (st.await?.type === 'turn' && st.await.seat === seat) {
    const pool = st.drawn ? [st.drawn, ...st.hands[seat]] : [...st.hands[seat]]
    const tile = pool.find((t) => !banned(st, seat, t.k)) || pool[0]
    return { type: 'discard', tileId: tile.id }
  }
  if (st.await?.type === 'claims' && st.await.pending.includes(seat)) return { type: 'pass' }
  return null
}

// ---- NPC思考 ----
export function npcDecide(st, seat) {
  if (st.await?.type === 'claims' && st.await.pending.includes(seat)) {
    const o = getClaimOptions(st, seat)
    if (o.canRon) return { type: 'ron' }
    if (o.canPon && st.await.tileKind >= HAKU) return { type: 'pon' } // 役牌のみ鳴く
    if (o.canPon && st.await.tileKind === seatWindOf(st, seat)) return { type: 'pon' }
    return { type: 'pass' }
  }
  if (st.await?.type !== 'turn' || st.await.seat !== seat) return null
  const o = getTurnOptions(st, seat)
  if (o.canTsumo) return { type: 'tsumo' }
  if (o.canKita) return { type: 'kita' }
  const ankan = o.kans.find((k) => k.kanType === 'ankan')
  if (ankan && !st.riichis[seat]) return { type: 'kan', ...ankan }
  if (st.riichis[seat]) return { type: 'discard', tileId: st.drawn.id }
  const hand14 = st.drawn ? [...st.hands[seat], st.drawn] : [...st.hands[seat]]
  // リーチ判断: テンパイなら即リー
  if (o.riichiTiles.length > 0) {
    // 待ちが最も広い打牌を選ぶ
    let best = null, bestWaits = -1
    for (const k of o.riichiTiles) {
      const t = hand14.find((x) => x.k === k)
      const cc = countsOf(hand14.filter((x) => x.id !== t.id))
      const w = waitsOf(cc, st.melds[seat].length, st.sanma).length
      if (w > bestWaits) { bestWaits = w; best = t }
    }
    if (best) return { type: 'riichi', tileId: best.id }
  }
  // ---- 守備(ベタオリ): リーチ者がいて自分が2シャンテン以上なら現物を優先して切る ----
  {
    const riichiSeats = st.riichis.map((r, s) => (r ? s : -1)).filter((s) => s >= 0 && s !== seat)
    if (riichiSeats.length > 0) {
      const myShanten = shanten(countsOf(hand14), st.melds[seat].length)
      if (myShanten >= 2) {
        // 全リーチ者の河にある牌 = 完全な安牌
        const safe = hand14.filter((t) => !banned(st, seat, t.k)
          && riichiSeats.every((rs) => st.discards[rs].some((d) => d.k === t.k)))
        if (safe.length > 0) {
          // 同じ安牌なら手牌に多い牌から処理(重なりを崩さない範囲で)
          const c = countsOf(hand14)
          safe.sort((a, b) => c[a.k] - c[b.k])
          return { type: 'discard', tileId: safe[0].id }
        }
        // 安牌がなければ字牌 → 端牌の順で被害の小さそうな牌
        const risky = hand14.filter((t) => !banned(st, seat, t.k))
        risky.sort((a, b) => (isHonor(b.k) ? 2 : isTerminal(b.k) ? 1 : 0) - (isHonor(a.k) ? 2 : isTerminal(a.k) ? 1 : 0))
        if (risky.length > 0) return { type: 'discard', tileId: risky[0].id }
      }
    }
  }
  // 通常打牌: シャンテンが最小になる牌、同値なら孤立字牌/端牌から
  let best = null, bestKey = null
  const seen = new Set()
  for (const t of hand14) {
    if (banned(st, seat, t.k)) continue // 喰い替え禁止牌は選ばない
    if (seen.has(t.k + (t.r ? 100 : 0))) continue
    seen.add(t.k + (t.r ? 100 : 0))
    const cc = countsOf(hand14.filter((x) => x.id !== t.id))
    const sh = shanten(cc, st.melds[seat].length)
    // 使い勝手の低さ(高いほど捨てたい)
    const cnt = countsOf(hand14)
    let waste = 0
    if (isHonor(t.k)) waste = cnt[t.k] === 1 ? 30 : cnt[t.k] === 2 ? 5 : 0
    else {
      const near = (cnt[t.k - 1] || 0) + (cnt[t.k + 1] || 0) + (cnt[t.k - 2] || 0) + (cnt[t.k + 2] || 0)
      waste = (cnt[t.k] === 1 ? 10 : 2) - near * 3 + (isTerminal(t.k) ? 3 : 0)
    }
    if (t.r) waste -= 8 // 赤は残す
    const key = sh * 1000 - waste
    if (bestKey === null || key < bestKey) { bestKey = key; best = t }
  }
  if (!best) best = hand14.find((t) => !banned(st, seat, t.k)) || hand14[0] // 全部禁止の異常系
  return { type: 'discard', tileId: best.id }
}
