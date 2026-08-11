// ============================================================
// バトルフロンティアⅡ（リメイク版）— ステータス定義と成長の正
// ------------------------------------------------------------
// 成長方式は「あるけみすと」準拠：
//   ・LVアップ1回につき ROLLS_PER_LV 回の抽選を行い、当たったステータスが上がる
//   ・当たりが HP なら +8 / MP なら +3 / それ以外は +1
//     （＝どのステに当たっても戦闘力換算では +1。unit がその換算値）
//   ・どのステが当たりやすいかを決める「手相」は未採用＝8種すべて均等 1/8
//   ・LV上限に達したら「転職」でLV1に戻り、初期ステータスに
//     「転職回数×JOB_CHANGE_POWER」戦闘力分をランダムに振り分けて周回する
//     （あるけみすとの「転生」に相当。BFでは転職と呼ぶ）
// ★ このファイルはクライアント側の表示・シミュレーション用。
//   実際のステ更新の権威はサーバー（supabase_v2_core.sql の v2_apply_exp / v2_change_job）。
//   数式を変えるときは必ず両方を同時に直すこと（片方だけだと表示と実値がズレる）。
//   SQL側は int[] の並びで抽選するため、STAT_KEYS の順序＝SQLの配列の並び。
// ============================================================

// 抽選の並び。SQL側 v_gain/v_unit/v_stat 配列の 1〜8 と一致させること
export const STAT_KEYS = ['hp', 'mp', 'str', 'dex', 'agi', 'int_stat', 'vit', 'luk']

// unit = 抽選1回で上がる量。戦闘力1あたりの必要量でもある（HP8＝戦闘力1）
export const STAT_DEFS = {
  hp:       { label:'HP',  jp:'生命', unit:8, color:'#44ff88', desc:'0になると戦闘不能' },
  mp:       { label:'MP',  jp:'魔力', unit:3, color:'#4488ff', desc:'スキル使用で消費する' },
  str:      { label:'STR', jp:'腕力', unit:1, color:'#ffcc00', desc:'通常攻撃と物理スキルの威力' },
  dex:      { label:'DEX', jp:'器用', unit:1, color:'#88ddaa', desc:'命中率' },
  agi:      { label:'AGI', jp:'敏捷', unit:1, color:'#ff8844', desc:'行動順・行動回数・回避' },
  int_stat: { label:'INT', jp:'知性', unit:1, color:'#cc44ff', desc:'魔法攻撃の威力と魔法防御' },
  vit:      { label:'VIT', jp:'耐久', unit:1, color:'#88aaff', desc:'被ダメージ（回避・魔法防御にも軽微に影響）' },
  luk:      { label:'LUK', jp:'幸運', unit:1, color:'#ffdd66', desc:'クリティカル率・回避率' },
}

// ===== 成長の定数（調整するときはSQL側の同名定数も直す） =====
export const MAX_LV = 100        // LV上限。到達後はEXPが入らず、転職でLV1に戻る
export const ROLLS_PER_LV = 5    // LVアップ1回あたりの抽選回数

// LVアップに必要なEXP。転職を重ねるほど重くなる（あるけみすとの 60→70→80→90→100）
// 区切りはBF独自：転職 EXP_STEP_PER_JOBS 回ごとに +EXP_STEP、EXP_PER_LV_MAX で打ち止め
export const EXP_PER_LV_BASE = 60
export const EXP_PER_LV_MAX  = 100
export const EXP_STEP_PER_JOBS = 10
export const EXP_STEP = 10
export const expPerLv = (jobChanges = 0) =>
  Math.min(EXP_PER_LV_MAX, EXP_PER_LV_BASE + Math.floor(Math.max(0, jobChanges) / EXP_STEP_PER_JOBS) * EXP_STEP)

// ===== 転職（あるけみすとの転生に相当） =====
// LV上限で転職するとLV1に戻り、ステータスは初期値へリセットされる。
// そこへ「転職回数×JOB_CHANGE_POWER」戦闘力分をランダムに振り分ける（＝毎回引き直し）。
// 100戦闘力＝20LV分。1回目の転職後は戦闘力139からのスタートになる。
export const JOB_CHANGE_POWER = 100

// LV1の初期ステータス。※あるけみすとの公表値が見つからなかったため暫定値
//   （戦闘力39スタート → LV100で約534）。調整はここだけ直せばよい
export const INITIAL_STATS = { hp:40, mp:12, str:5, dex:5, agi:5, int_stat:5, vit:5, luk:5 }

export const emptyGains = () => ({ hp:0, mp:0, str:0, dex:0, agi:0, int_stat:0, vit:0, luk:0 })

// 次のLVまでに必要なEXP。LV上限なら0（＝もう溜まらない。転職待ち）
export const expToNext = (lv, jobChanges = 0) => (lv >= MAX_LV ? 0 : expPerLv(jobChanges))

// 戦闘力。HPは8、MPは3で戦闘力1に換算し、他6ステはそのまま加算する
export const calcPower = (s) =>
  Math.floor(STAT_KEYS.reduce((t, k) => t + (s[k] || 0) / STAT_DEFS[k].unit, 0))

// 戦闘力 points 回ぶんの抽選。8種から均等に引き、当たったステを unit だけ上げる
export const rollAllocate = (points, rng = Math.random) => {
  const gains = emptyGains()
  for (let i = 0; i < points; i++) {
    const k = STAT_KEYS[Math.floor(rng() * STAT_KEYS.length)]
    gains[k] += STAT_DEFS[k].unit
  }
  return gains
}

// LVアップ1回分の抽選
export const rollLevelUp = (rng = Math.random) => rollAllocate(ROLLS_PER_LV, rng)

// EXPを与えてLVアップまで処理した結果を返す純関数（プレビュー／サーバー実装の検証用）。
// 実際の保存は必ずRPC経由。state は書き換えず新しいオブジェクトを返す。
export const applyExp = (state, amount, rng = Math.random) => {
  const jobChanges = state.job_changes || 0
  const need = expPerLv(jobChanges)
  let lv = state.lv
  let exp = state.exp
  const stats = {}
  for (const k of STAT_KEYS) stats[k] = state[k] ?? state.stats?.[k] ?? 0
  const levelUps = []
  const total = emptyGains()
  if (lv < MAX_LV && amount > 0) {
    exp += amount
    while (lv < MAX_LV && exp >= need) {
      exp -= need
      lv += 1
      const gains = rollLevelUp(rng)
      for (const k of STAT_KEYS) { stats[k] += gains[k]; total[k] += gains[k] }
      levelUps.push({ lv, gains })
    }
    if (lv >= MAX_LV) exp = 0  // 上限到達＝あふれたEXPは捨てる（転職待ち）
  }
  return { lv, exp, stats, levelUps, gains: total, power: calcPower(stats), job_changes: jobChanges }
}

export const canJobChange = (lv) => lv >= MAX_LV

// 転職1回分の処理（純関数。実際の保存は v2_change_job）。
// ステを初期値に戻し、転職回数×JOB_CHANGE_POWER 戦闘力分を引き直して配る。
export const applyJobChange = (state, rng = Math.random) => {
  const jobChanges = (state.job_changes || 0) + 1
  const alloc = rollAllocate(jobChanges * JOB_CHANGE_POWER, rng)
  const stats = {}
  for (const k of STAT_KEYS) stats[k] = INITIAL_STATS[k] + alloc[k]
  return { lv:1, exp:0, job_changes: jobChanges, stats, alloc, power: calcPower(stats) }
}
