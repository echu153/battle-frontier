// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 職業とジョブLV
// ------------------------------------------------------------
// 設計は docs/v2cap-design.md §4。2026-10-09 ユーザー決定：
//   ・ジョブLVは**職業ごと**に持ち、戻れば続きから。最大30
//   ・入るのは**いまの職業**のジョブLVだけ（その戦闘で入ったEXPと同じ量）
//   ・ジョブLVが上がると、スキルを覚える／上位職が開く／ステが上がる
//   ・ステ（ジョブボーナス）は**職業ごとに決まったステ**で、**その職業に就いている間だけ**効く
//   ・職業補正（今のⅡの STR+5% など）は**一旦なし**。職業の差はパッシブで付ける
//   ・職業の段階：初期（ノーブル＋戦士など6職）→ 一次（侍など12職）→ 二次・三次（これから）。
//     上の段階ほどジョブLVが上がりにくい
//
// ★スキルの中身（倍率・発動率・消費MP）は今のⅡと同じ＝ src/v2/lib/skills.js を使う。
// ★権威はサーバー（supabase_v2cap_core.sql の v2cap_classes / v2cap_job_need /
//   v2cap_apply_exp）。ここは表示とシミュレーション用の写し。v2capsql.test.js が突き合わせる。
// ============================================================
import { STAT_KEYS, STAT_DEFS } from '../../v2/lib/stats.js'
import { SKILLS, isPassive, passiveOf } from '../../v2/lib/skills.js'

export const JOB_MAX = 30

// ===== 段階 =====
// mult … 必要ジョブEXPの倍率（上の段階ほど重い）／perLv … ジョブLVが1上がるごとのステの量（戦闘力換算）
// learnAt … その段階の職業がスキルを覚えるジョブLV（並びはスキル一覧の順・転職5回が要った技は後ろ）
export const STAGES = {
  shoki:  { label:'初期', color:'#44aaff', mult:1, perLv:1, learnAt:[1, 5, 10, 15, 20] },
  ichiji: { label:'一次', color:'#ffcc00', mult:3, perLv:2, learnAt:[1, 4, 7, 10, 13, 16, 19, 22, 25, 28] },
}
export const STAGE_ORDER = ['shoki', 'ichiji']

// ===== 職業 =====
// req … その職業に就くのに要るジョブLV（{ cls, jlv }）。初期職は条件なし
// ★複合上位職・特殊職は**二次・三次を作るときに置き場を決める**（2026-10-09）＝ここには載せない
export const START_CLASSES = ['ノーブル', '戦士', '弓使い', '魔法使い', '僧侶', '格闘家', 'サモナー']
const ICHIJI_FROM = {
  戦士:     ['侍', '狂戦士'],
  弓使い:   ['狩人', '暗殺者'],
  魔法使い: ['元素使い', '死霊使い'],
  僧侶:     ['聖職者', '異端審問官'],
  格闘家:   ['サイキッカー', '体術師'],
  サモナー: ['精霊召喚士', '式神使い'],
}
export const CLASSES = [
  ...START_CLASSES.map((id, i) => ({ id, stage:'shoki', sort: i, req: null })),
  ...Object.entries(ICHIJI_FROM).flatMap(([from, list], i) =>
    list.map((id, j) => ({ id, stage:'ichiji', sort: 10 + i * 2 + j, req: { cls: from, jlv: JOB_MAX } }))),
]
export const CLASS_BY_ID = Object.fromEntries(CLASSES.map(c => [c.id, c]))
export const stageOf = (cls) => CLASS_BY_ID[cls]?.stage || null
export const stageLabelOf = (cls) => STAGES[stageOf(cls)]?.label || ''
export const stageColorOf = (cls) => STAGES[stageOf(cls)]?.color || '#88ccff'

// ===== 必要ジョブEXP =====
// ジョブLV² に比例。初期職は JLV30 まで**約2週間**（1日1時間・ユーザー決定「2週間くらい」）。一次職は3倍。
//   係数は tools/v2cap-progress.mjs で回して決めた（2026-10-09 実測：初めての一次職は中央値13日目・
//   一次職のJLV30は35日目）。最初の机上の18.4だと19日目だった
// ⚠係数12.3は10分率の整数（123）で掛けてから10で割る（SQLの v2cap_job_need と同じ形）
export const JOB_NEED_TENTHS = 123
export const jobNeed = (stage, jlv) =>
  (jlv >= JOB_MAX ? 0 : Math.max(1, Math.round(JOB_NEED_TENTHS * (STAGES[stage]?.mult || 1) * jlv * jlv / 10)))
export const jobTotalTo = (stage, jlv) => {
  let t = 0
  for (let j = 1; j < Math.min(jlv, JOB_MAX); j++) t += jobNeed(stage, j)
  return t
}

// 職業ごとのジョブLV。jobs = { "戦士": { lv: 12, exp: 345 } }。まだ就いたことが無ければLV1
export const jobOf = (jobs, cls) => ({ lv: jobs?.[cls]?.lv || 1, exp: jobs?.[cls]?.exp || 0 })

// ===== ステ（ジョブボーナス）=====
// 職業ごとの配分（戦闘力換算の点数）。合計は 初期 29（JLV30まで1点ずつ）／一次 58（2点ずつ）
// 一次職は今のⅡの main／sub（classBonus.js）から作る：主24・副16・HP10・残り8（物理はVIT／魔法はMP）
export const JOB_BONUS = {
  ノーブル:     { hp:4, mp:3, str:4, dex:4, agi:4, int_stat:4, vit:3, luk:3 },
  戦士:         { str:12, vit:7, hp:5, dex:5 },
  弓使い:       { dex:12, agi:8, str:5, luk:4 },
  魔法使い:     { int_stat:14, mp:6, dex:5, agi:4 },
  僧侶:         { int_stat:10, vit:7, mp:6, hp:6 },
  格闘家:       { str:10, agi:9, hp:5, vit:5 },
  サモナー:     { int_stat:12, mp:6, agi:6, luk:5 },
  侍:           { str:24, dex:16, hp:10, vit:8 },
  狂戦士:       { str:24, agi:16, hp:10, vit:8 },
  狩人:         { str:24, dex:16, hp:10, vit:8 },
  暗殺者:       { str:24, agi:16, hp:10, vit:8 },
  元素使い:     { int_stat:24, dex:16, hp:10, mp:8 },
  死霊使い:     { int_stat:24, vit:16, hp:10, mp:8 },
  聖職者:       { int_stat:24, vit:16, hp:10, mp:8 },
  異端審問官:   { int_stat:24, luk:16, hp:10, mp:8 },
  サイキッカー: { str:24, int_stat:16, hp:10, vit:8 },
  体術師:       { str:24, agi:16, hp:10, vit:8 },
  精霊召喚士:   { int_stat:24, agi:16, hp:10, mp:8 },
  式神使い:     { int_stat:24, dex:16, hp:10, mp:8 },
}

// 配分を「何点目にどのステが上がるか」の並びにする（ランダムではなく固定）。
// 1点ずつ「配分に対して一番遅れているステ」を選ぶ＝どのジョブLVで止めても配分どおりに近い。
// 同点はステの並び（STAT_KEYS）の先を取る。★SQLの v2cap_classes.bonus_seq はこの出力を写したもの
export const bonusSeqOf = (cls) => {
  const w = JOB_BONUS[cls] || {}
  const total = Object.values(w).reduce((a, b) => a + b, 0)
  const got = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  const seq = []
  for (let i = 1; i <= total; i++) {
    let best = null
    let bestLag = -Infinity
    for (const k of STAT_KEYS) {
      if (!w[k] || got[k] >= w[k]) continue
      const lag = (w[k] * i) / total - got[k]
      if (lag > bestLag + 1e-9) { best = k; bestLag = lag }
    }
    got[best] += 1
    seq.push(best)
  }
  return seq
}
const SEQ_CACHE = {}
const seqOf = (cls) => (SEQ_CACHE[cls] ||= bonusSeqOf(cls))

// その職業のそのジョブLVで入っている点数（戦闘力換算）
export const bonusPointsAt = (cls, jlv) =>
  Math.max(0, Math.min(JOB_MAX, jlv || 1) - 1) * (STAGES[stageOf(cls)]?.perLv || 0)

// ステの値に直したもの（HPなら1点＝+8・MPなら+3・ほかは+1）
export const jobBonusStats = (cls, jlv) => {
  const out = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  for (const k of seqOf(cls).slice(0, bonusPointsAt(cls, jlv))) out[k] += STAT_DEFS[k].unit
  return out
}
// 表示用。「STR+12・VIT+7」のように多い順
export const jobBonusText = (cls, jlv) => {
  const s = jobBonusStats(cls, jlv)
  return STAT_KEYS.filter(k => s[k] > 0).sort((a, b) => s[b] / STAT_DEFS[b].unit - s[a] / STAT_DEFS[a].unit)
    .map(k => `${STAT_DEFS[k].label}+${s[k]}`).join('・')
}

// ===== スキル =====
// 覚える順。**転職5回が要った技（reqJobs）は後ろ**、同じ組の中はスキル一覧の順。パッシブは入れない
export const learnOrderOf = (cls) => {
  const list = SKILLS.filter(s => s.cls === cls && !isPassive(s))
  return [...list.filter(s => !s.reqJobs), ...list.filter(s => s.reqJobs)]
}
export const learnAtOf = (cls) => STAGES[stageOf(cls)]?.learnAt || []
// そのジョブLVまでに覚えるスキル（名前の配列）
export const skillsLearnedBy = (cls, jlv) => {
  const at = learnAtOf(cls)
  return learnOrderOf(cls).filter((_, i) => at[i] !== undefined && at[i] <= (jlv || 1)).map(s => s.name)
}
// 次に覚えるスキルとそのジョブLV（無ければ null）
export const nextSkillOf = (cls, jlv) => {
  const at = learnAtOf(cls)
  const list = learnOrderOf(cls)
  for (let i = 0; i < list.length; i++) if (at[i] > (jlv || 1)) return { skill: list[i], jlv: at[i] }
  return null
}
export { passiveOf }

// ===== 就けるか =====
export const reqOf = (cls) => CLASS_BY_ID[cls]?.req || null
export const missingReqOf = (cls, jobs) => {
  const r = reqOf(cls)
  if (!r) return null
  const have = jobOf(jobs, r.cls).lv
  return have >= r.jlv ? null : `${r.cls}のジョブLV${r.jlv}（いま${have}）`
}
export const canBecome = (cls, jobs) => !!CLASS_BY_ID[cls] && !missingReqOf(cls, jobs)
export const reqText = (cls) => {
  const r = reqOf(cls)
  return r ? `${r.cls}のジョブLV${r.jlv}` : '条件なし'
}

// ===== ジョブEXPを入れる（純関数・表示とシミュレーション用）=====
// jobs を書き換えず新しいオブジェクトを返す。learned は今回新しく覚えたスキル名
export const applyJobExp = (jobs, cls, amount, known = []) => {
  const stage = stageOf(cls)
  const cur = jobOf(jobs, cls)
  let { lv, exp } = cur
  const ups = []
  if (stage && lv < JOB_MAX && amount > 0) {
    exp += amount
    while (lv < JOB_MAX && exp >= jobNeed(stage, lv)) {
      exp -= jobNeed(stage, lv)
      lv += 1
      ups.push(lv)
    }
    if (lv >= JOB_MAX) exp = 0
  }
  const have = new Set(known)
  const learned = skillsLearnedBy(cls, lv).filter(n => !have.has(n))
  return { jobs: { ...(jobs || {}), [cls]: { lv, exp } }, lv, exp, ups, learned }
}
