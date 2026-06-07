// ============================================================
// 釣りデータ／ボーナス計算 共通モジュール（草案）
// ------------------------------------------------------------
// ⚠ 現状、FISH_DATA とボーナス規則は Fishing.jsx 内にも同じ定義がある。
//   本実装時は Fishing.jsx を本ファイルの import に置き換え、重複を解消すること
//   （stats.js と同じ「表示と実効果のズレ防止」方針）。
// ------------------------------------------------------------
// sumClaimedFishingBonus(records) で「受取済み魚ボーナス」の合計を
// ステータス別に算出する。ステータス詳細ページの釣り内訳表示に使用。
// ============================================================

export const FISH_RANK_BONUS_STATS = {
  f:   ['atk','def','matk','mdef','spd'],
  e:   ['atk','def','matk','mdef','spd'],
  d:   ['atk','def','matk','mdef','spd'],
  c:   ['def','mdef','spd'],
  b:   ['atk','matk','spd'],
  a:   ['hp','mp'],
  s:   ['def','mdef'],
  ss:  ['atk','matk','spd'],
  sss: ['hp'],
}
export const FISH_RANK_BONUS_AMOUNT = { f:1, e:1, d:1, c:1, b:1, a:null, s:3, ss:3, sss:100 }
export const FISH_A_BONUS = { hp_max:10, mp_max:5 }
export const FISH_SSS_BONUS = { hp_max:100 }

export const FISH_DATA = {
  日本海: [
    { rank:'f', name:'アジ', statIdx:0 },
    { rank:'f', name:'イワシ', statIdx:1 },
    { rank:'f', name:'サバ', statIdx:2 },
    { rank:'f', name:'カタクチイワシ', statIdx:3 },
    { rank:'f', name:'キス', statIdx:4 },
    { rank:'e', name:'カサゴ', statIdx:0 },
    { rank:'e', name:'メバル', statIdx:1 },
    { rank:'e', name:'ベラ', statIdx:2 },
    { rank:'e', name:'コノシロ', statIdx:3 },
    { rank:'e', name:'小ダイ', statIdx:4 },
    { rank:'d', name:'クロダイ', statIdx:0 },
    { rank:'d', name:'シーバス', statIdx:1 },
    { rank:'d', name:'ヒラメ', statIdx:2 },
    { rank:'d', name:'ホウボウ', statIdx:3 },
    { rank:'d', name:'アイナメ', statIdx:4 },
    { rank:'c', name:'真鯛', statIdx:0 },
    { rank:'c', name:'ワラサ', statIdx:1 },
    { rank:'c', name:'アオリイカ', statIdx:2 },
    { rank:'b', name:'ブリ', statIdx:0 },
    { rank:'b', name:'カンパチ', statIdx:1 },
    { rank:'b', name:'石鯛', statIdx:2 },
    { rank:'a', name:'マグロ', statIdx:0 },
    { rank:'a', name:'巨大真鯛', statIdx:1 },
    { rank:'s', name:'リュウグウノツカイ', statIdx:0 },
    { rank:'ss', name:'ダイオウイカ', statIdx:0 },
    { rank:'sss', name:'シロナガスクジラ', statIdx:0 },
  ],
  カリブ海: [
    { rank:'f', name:'ブルータン', statIdx:0 },
    { rank:'f', name:'クイーンエンゼル', statIdx:1 },
    { rank:'f', name:'サージェントメジャー', statIdx:2 },
    { rank:'f', name:'フレンチグラント', statIdx:3 },
    { rank:'f', name:'パロットフィッシュ幼魚', statIdx:4 },
    { rank:'e', name:'カマス', statIdx:0 },
    { rank:'e', name:'フエダイ', statIdx:1 },
    { rank:'e', name:'ハタ', statIdx:2 },
    { rank:'e', name:'カサゴ系', statIdx:3 },
    { rank:'e', name:'グルーパー', statIdx:4 },
    { rank:'d', name:'シイラ', statIdx:0 },
    { rank:'d', name:'バラクーダ', statIdx:1 },
    { rank:'d', name:'カンパチ', statIdx:2 },
    { rank:'d', name:'ロウニンアジ', statIdx:3 },
    { rank:'d', name:'ターポン', statIdx:4 },
    { rank:'c', name:'キングフィッシュ', statIdx:0 },
    { rank:'c', name:'シロカジキ', statIdx:1 },
    { rank:'c', name:'マヒマヒ', statIdx:2 },
    { rank:'b', name:'ナポレオンフィッシュ', statIdx:0 },
    { rank:'b', name:'ハンマーヘッドシャーク', statIdx:1 },
    { rank:'b', name:'タイガーシャーク', statIdx:2 },
    { rank:'a', name:'ブルーマーリン', statIdx:0 },
    { rank:'a', name:'ホホジロザメ', statIdx:1 },
    { rank:'s', name:'ジンベエザメ', statIdx:0 },
    { rank:'ss', name:'マッコウクジラ', statIdx:0 },
    { rank:'sss', name:'ダイオウホウズキイカ', statIdx:0 },
  ],
  ミミミッミ川: [
    { rank:'f', name:'ミハゼ', statIdx:0 },
    { rank:'f', name:'カワピヨ', statIdx:1 },
    { rank:'f', name:'チビナマ', statIdx:2 },
    { rank:'f', name:'ミミコイ', statIdx:3 },
    { rank:'f', name:'ハネビレ', statIdx:4 },
    { rank:'e', name:'シマミミウオ', statIdx:0 },
    { rank:'e', name:'ミミマス', statIdx:1 },
    { rank:'e', name:'青ヒレナマズ', statIdx:2 },
    { rank:'e', name:'ミズハネ', statIdx:3 },
    { rank:'e', name:'カワツノ魚', statIdx:4 },
    { rank:'d', name:'銀鱗ミミマス', statIdx:0 },
    { rank:'d', name:'オオヒレナマズ', statIdx:1 },
    { rank:'d', name:'双尾ゴイ', statIdx:2 },
    { rank:'d', name:'水晶魚', statIdx:3 },
    { rank:'d', name:'月光アユ', statIdx:4 },
    { rank:'c', name:'深川ナマズ', statIdx:0 },
    { rank:'c', name:'雷光ウナギ', statIdx:1 },
    { rank:'c', name:'蒼水龍魚', statIdx:2 },
    { rank:'b', name:'金鱗龍魚', statIdx:0 },
    { rank:'b', name:'古代ナマズ', statIdx:1 },
    { rank:'b', name:'深淵ウナギ', statIdx:2 },
    { rank:'a', name:'奈落ナマズ', statIdx:0 },
    { rank:'a', name:'神雷ウナギ', statIdx:1 },
    { rank:'s', name:'ミミミ龍魚', statIdx:0 },
    { rank:'ss', name:'超巨大奈落ナマズ', statIdx:0 },
    { rank:'sss', name:'ミミミッミ神龍', statIdx:0 },
  ],
}

export const COMPLETE_BONUS = {
  日本海:      { atk:30, matk:30, spd:30 },
  カリブ海:    { def:30, mdef:30 },
  ミミミッミ川: { hp_max:500, mp_max:250 },
}

export const FISHING_LOCATIONS = Object.keys(FISH_DATA)

// fish.statIdx と rank から、付与されるボーナスを { hp_max:.. } 等のキーで返す
export const calcFishBonus = (fish, rank) => {
  const stats = FISH_RANK_BONUS_STATS[rank] || []
  const stat = stats[fish.statIdx]
  if (!stat) return null
  if (rank === 'a') return { ...FISH_A_BONUS }
  if (rank === 'sss') return { ...FISH_SSS_BONUS }
  const amount = FISH_RANK_BONUS_AMOUNT[rank] || 1
  const statMap = { atk:'atk', def:'def', matk:'matk', mdef:'mdef', spd:'spd', hp:'hp_max', mp:'mp_max' }
  return { [statMap[stat] || stat]: amount }
}

const STAT_KEYS = ['atk','def','matk','mdef','spd','hp_max','mp_max']
const emptyTotals = () => Object.fromEntries(STAT_KEYS.map(k => [k, 0]))

// ボーナスキー → profiles の永続列名（museum_* と同方式の fishing_*）
export const FISHING_STAT_COLUMN = {
  atk:'fishing_atk', def:'fishing_def', matk:'fishing_matk', mdef:'fishing_mdef',
  spd:'fishing_spd', hp_max:'fishing_hp', mp_max:'fishing_mp',
}
// { atk:1, hp_max:10 } 形式のボーナスを { fishing_atk:1, fishing_hp:10 } へ変換
export const toFishingColumns = (bonus) => {
  const out = {}
  for (const [k, v] of Object.entries(bonus)) {
    const col = FISHING_STAT_COLUMN[k]
    if (col) out[col] = v
  }
  return out
}

// fishing_records（{ fish_name, fish_rank, location, bonus_claimed }）から
// 「受取済み」釣りボーナスをステータス別に合計する。
// ※ コンプリートボーナスは DB に受取フラグが無いため、
//   「その釣り場の全魚を受取済み」なら加算する推定値（注意書きを併記すること）。
export const sumClaimedFishingBonus = (records = []) => {
  const totals = emptyTotals()
  let perFishCount = 0
  // 受取済み魚ボーナス
  for (const r of records) {
    if (!r.bonus_claimed) continue
    const loc = FISH_DATA[r.location]
    if (!loc) continue
    const fish = loc.find(f => f.name === r.fish_name)
    if (!fish) continue
    const bonus = calcFishBonus(fish, (r.fish_rank || '').toLowerCase())
    if (!bonus) continue
    for (const [k, v] of Object.entries(bonus)) totals[k] = (totals[k] || 0) + v
    perFishCount++
  }
  // コンプリートボーナス（推定）
  const claimedByLoc = {}
  for (const r of records) {
    if (!r.bonus_claimed) continue
    ;(claimedByLoc[r.location] ||= new Set()).add(r.fish_name)
  }
  const completed = {}
  let completeCount = 0
  for (const loc of FISHING_LOCATIONS) {
    const fishes = FISH_DATA[loc]
    const claimed = claimedByLoc[loc] || new Set()
    const isComplete = fishes.every(f => claimed.has(f.name))
    completed[loc] = isComplete
    if (isComplete) {
      completeCount++
      for (const [k, v] of Object.entries(COMPLETE_BONUS[loc] || {})) totals[k] = (totals[k] || 0) + v
    }
  }
  return { totals, completed, perFishCount, completeCount }
}
