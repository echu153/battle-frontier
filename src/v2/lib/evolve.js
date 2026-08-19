// ============================================================
// バトルフロンティアⅡ（リメイク版）— 武器の進化（戦闘記憶）
// ------------------------------------------------------------
// シャングリラ・フロンティアの武器進化を下敷きにした仕組み（2026-08-18 ユーザー提案）。
// **その武器を装備して戦い続けると熟練度が貯まり、節目でその個体だけの能力が付く。**
// 何が付くかは**どう戦ってきたか**で決まるので、同じ武器でも人によって別物になる。
//
// ★ユーザー決定（2026-08-18）
//   ・ルーンの刻印とは**別枠**。ソケットは食わない
//     （ルーン＝運で集める／進化＝使い込んで得る、と役割を分ける）
//   ・**段階的に複数回**進化する（STAGES の節目ごとに1つ増える）
//   ・付く能力は**戦績から自動で決まる**（候補から選ばせない）
//
// ★ここが既存と違うところ：ルーンの特殊能力56種は何度引いても同じ表から出るだけで、
//   プレイの履歴を一切見ていない。進化は**記録の偏り**だけが入力になる。
//
// ⚠戦績を作るのはクライアント（戦闘自体がクライアントで回るため）。
//   サーバーは1戦闘あたりの増分に上限を掛けて受け取る＝でたらめな値は積めない。
//   戦闘のサーバー権威化をするときは、ここも一緒に移すこと。
// ============================================================

import { calcPower } from './stats.js'

// 熟練度の節目。ここに達すると能力が1つ増える
// ★出撃のクールタイムは10〜20秒なので、100戦で17〜33分ぶん。
//   「1本を使い込む」感を出すために、上の段はかなり遠くに置いてある。
export const STAGES = [100, 500, 2000]
export const MAX_STAGE = STAGES.length

// いまの段階（0＝まだ進化していない）
export const stageOf = (battles = 0) => STAGES.filter(n => (battles || 0) >= n).length
// 次の節目までの残り。最後まで行っていたら null
export const nextStageAt = (battles = 0) => STAGES.find(n => (battles || 0) < n) ?? null

// ===== 戦績 =====
// 1戦ごとにこの形で積む。キーを増やすときは SQL 側の上限表も一緒に直すこと
export const emptyRecord = () => ({
  battles: 0,     // 戦った回数（＝熟練度）
  hits: 0,        // こちらが当てた回数
  crit: 0,        // そのうちクリティカル
  taken: 0,       // 相手から受けた攻撃の回数（外れ含む）
  dodged: 0,      // そのうちかわした回数
  ail: 0,         // 状態異常を入れた回数
  wins: 0,        // 勝った回数
  lowWin: 0,      // 残りHP30%以下で勝った回数
  bigWin: 0,      // 自分より戦闘力が上の相手に勝った回数
  turns: 0,       // 決着までのターンの合計（平均を出すのに使う）
  foes: {},       // 倒した敵の名前ごとの回数
})

export const LOW_HP_PCT = 30    // 「薄氷の勝ち」と数える残HPの割合
export const FOES_KEEP = 12     // 敵の記録は上位いくつまで持つか（際限なく増やさない）

// 1戦ぶんの戦績を戦闘ログから作る。r … runBattle の返り値
export const recordOfBattle = (r, you, foe, opt = {}) => {
  // 戦闘力は runBattle の返り値から出せる（呼び出し側に計算させない＝入れ忘れが起きない）
  const myPower  = opt.myPower  ?? calcPower(r?.a?.base || {})
  const foePower = opt.foePower ?? calcPower(r?.b?.base || {})
  const rec = emptyRecord()
  rec.battles = 1
  const win = r?.winner === 'a'
  rec.turns = r?.turns || 0
  for (const l of r?.log || []) {
    const mine = l.side === you
    if (l.type === 'skill' || l.type === 'normal') {
      const hit = l.type === 'skill' ? l.hits > 0 : l.hit
      if (mine) {
        if (hit) { rec.hits++; if (l.crit) rec.crit++ }
      } else {
        rec.taken++
        if (!hit) rec.dodged++
      }
    } else if (l.type === 'ailment' && !mine) {
      // side は「かかった側」。相手にかかった＝こちらが入れた
      rec.ail++
    }
  }
  if (win) {
    rec.wins = 1
    if (foe) rec.foes[foe] = 1
    const hpPct = (r?.a?.hp ?? 0) / Math.max(1, r?.a?.base?.hp ?? 1) * 100
    if (hpPct <= LOW_HP_PCT) rec.lowWin = 1
    if (foePower > myPower) rec.bigWin = 1
  }
  return rec
}

// 戦績を足し合わせる。敵の記録は上位 FOES_KEEP 件だけ残す
export const mergeRecord = (base, add) => {
  const out = { ...emptyRecord(), ...(base || {}) }
  for (const k of Object.keys(emptyRecord())) {
    if (k === 'foes') continue
    out[k] = (Number(out[k]) || 0) + (Number(add?.[k]) || 0)
  }
  const foes = { ...(out.foes || {}) }
  for (const [name, n] of Object.entries(add?.foes || {})) foes[name] = (foes[name] || 0) + n
  out.foes = Object.fromEntries(
    Object.entries(foes).sort((a, b) => b[1] - a[1]).slice(0, FOES_KEEP))
  return out
}

// ===== 能力 =====
// key … 効果のキー（battle.js が読む）。score … 戦績から出す0〜1の「偏りの強さ」
// ★どれも「その戦い方をどれだけ続けたか」を 0〜1 にして返す。
//   1に近いほど極端＝その能力が強く付く。
export const TRAITS = [
  {
    key:'crit', name:'見切りの冴え', text:'クリティカル率',
    score: (r) => (r.hits >= 50 ? r.crit / r.hits : 0),
    // 素のクリ率は5%前後なので、25%も出ていれば相当な偏り
    norm: 0.25,
  },
  {
    key:'eva', name:'紙一重', text:'回避率',
    score: (r) => (r.taken >= 50 ? r.dodged / r.taken : 0),
    norm: 0.30,
  },
  {
    key:'ail', name:'蝕みの刃', text:'状態異常の付与率',
    score: (r) => (r.hits >= 50 ? r.ail / r.hits : 0),
    norm: 0.20,
  },
  {
    key:'endure', name:'薄氷の勝者', text:'HP30%以下のときの与ダメージ',
    score: (r) => (r.wins >= 20 ? r.lowWin / r.wins : 0),
    norm: 0.30,
  },
  {
    key:'giant', name:'巨人殺し', text:'自分より戦闘力が上の相手への与ダメージ',
    score: (r) => (r.wins >= 20 ? r.bigWin / r.wins : 0),
    norm: 0.40,
  },
  {
    key:'swift', name:'疾き刃', text:'最初の3回の行動の与ダメージ',
    // 平均決着ターンが短いほど高い。5ターン以下で1.0、12ターンで0
    score: (r) => (r.battles >= 20 ? Math.max(0, (12 - r.turns / r.battles) / 7) : 0),
    norm: 1,
  },
  {
    key:'slayer', name:'宿敵狩り', text:'特定の敵への与ダメージ',
    // いちばん多く倒した敵が、勝ちのうちどれだけを占めるか
    score: (r) => {
      const top = Math.max(0, ...Object.values(r.foes || {}))
      return r.wins >= 20 ? top / r.wins : 0
    },
    norm: 0.50,
  },
]
export const TRAIT_BY_KEY = Object.fromEntries(TRAITS.map(t => [t.key, t]))

// 段階ごとに乗る値の上限(%)。★偏りが最大でもここまで
export const STAGE_CAP = [6, 10, 15]

// 0〜1に丸めた偏りの強さ
export const strengthOf = (rec, trait) =>
  Math.max(0, Math.min(1, (trait.score(rec) || 0) / trait.norm))

// その戦績で、いま何が付くか。already は既に付いているキーの配列
// ★偏りがいちばん強いものが選ばれる。同点なら TRAITS の並び順で決める（毎回同じ結果になる）
export const pickTrait = (rec, already = []) => {
  const cand = TRAITS
    .filter(t => !already.includes(t.key))
    .map(t => ({ trait: t, s: strengthOf(rec, t) }))
    .filter(c => c.s > 0)
  if (!cand.length) return null
  cand.sort((a, b) => (b.s - a.s) || (TRAITS.indexOf(a.trait) - TRAITS.indexOf(b.trait)))
  return cand[0]
}

// 進化1つぶんの中身を作る。stage は1始まり
export const makeEvolution = (rec, stage, already = []) => {
  const picked = pickTrait(rec, already)
  if (!picked) return null
  const cap = STAGE_CAP[Math.min(STAGE_CAP.length, Math.max(1, stage)) - 1]
  // 偏りが弱くても最低1%は乗る（節目まで使ったのに0%だと report が空になる）
  const value = Math.max(1, Math.round(cap * picked.s * 10) / 10)
  const out = { stage, key: picked.trait.key, value }
  // 宿敵狩りだけは相手の名前まで決まる
  if (picked.trait.key === 'slayer') {
    const top = Object.entries(rec.foes || {}).sort((a, b) => b[1] - a[1])[0]
    if (!top) return null
    out.foe = top[0]
  }
  return out
}

// いま付けられる進化があるか。evolutions は既に付いている配列
export const pendingStage = (rec, evolutions = []) => {
  const have = (evolutions || []).length
  const can = stageOf(rec?.battles || 0)
  return can > have ? have + 1 : 0
}

// 表示用の1行。「見切りの冴え：クリティカル率+3.4%」
export const evolutionText = (ev) => {
  const t = TRAIT_BY_KEY[ev?.key]
  if (!t) return ''
  const target = ev.foe ? `${ev.foe}への与ダメージ` : t.text
  return `${t.name}：${target}+${ev.value}%`
}

// ============================================================
// ここから下は「戦闘に効かせる側」。battle.js から使う
// ============================================================

// 装備している武器に付いている進化を1つのまとめに畳む。
// ★複数の武器（右手・左手）に付いていれば**足し算**になる
export const collectEvolutions = (list) => {
  const out = { crit:0, eva:0, ail:0, endure:0, giant:0, swift:0, slayer:{} }
  for (const ev of list || []) {
    if (!TRAIT_BY_KEY[ev?.key]) continue
    const v = Number(ev.value) || 0
    if (!v) continue
    if (ev.key === 'slayer') {
      if (ev.foe) out.slayer[ev.foe] = (out.slayer[ev.foe] || 0) + v
    } else {
      out[ev.key] += v
    }
  }
  return out
}

// 疾き刃が乗る「最初の◯回の行動」
// ★ターン数ではなく**自分が行動した回数**で数える。オート戦闘とATBで数え方を揃えるため
//   （ATBには「ターン」が無い。時間でゲージが溜まって行動が回ってくる）
export const EVO_SWIFT_MOVES = 3

// 状況で乗る与ダメージ+%の合計。乗らない条件のものは0
//   hpPct     … いまの自分のHPの割合
//   foeBigger … 相手のほうが戦闘力が上か
//   moves     … 自分が行動した回数（1始まり）
//   foeName   … 相手の名前（宿敵狩り）
export const evoDmgPct = (evo, { hpPct = 100, foeBigger = false, moves = 999, foeName = null } = {}) => {
  if (!evo) return 0
  let pct = 0
  if (evo.endure && hpPct <= LOW_HP_PCT) pct += evo.endure
  if (evo.giant && foeBigger) pct += evo.giant
  if (evo.swift && moves <= EVO_SWIFT_MOVES) pct += evo.swift
  if (foeName && evo.slayer?.[foeName]) pct += evo.slayer[foeName]
  return pct
}
