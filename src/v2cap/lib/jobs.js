// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 職業とクラスLV（ClassLV）
// ------------------------------------------------------------
// 設計は docs/v2cap-design.md §4・§11。ユーザー決定（2026-10-09）：
//   ・クラスLV（表記は **ClassLV**）は**職業ごと**に持ち、戻れば続きから。最大30
//   ・入るのは**いまの職業**のClassLVだけ（その戦闘で入ったEXPと同じ量）
//   ・ClassLVが上がると、スキルを覚える／ステが上がる（ステは職業ごとに決まっていて、その職業の間だけ）
//   ・職業補正（今のⅡの STR+5% など）は**一旦なし**
//   ・**初期職は10職**。職業ごとに**装備できる武器が3種**決まっている
//   ・ノーブル・サモナーはなくす。**一次職も見直すまで一旦なし**（二次・三次もこれから）
//   ・スキルは**その職業でだけ使える**。**上位職は下位職のスキルをそのまま使える**（lineageOf）
//
// ★権威はサーバー（supabase_v2cap_core.sql の v2cap_classes / v2cap_job_need / v2cap_apply_exp）。
//   ここは表示とシミュレーション用の写し。v2capsql.test.js が突き合わせる。
// ============================================================
import { STAT_KEYS, STAT_DEFS } from '../../v2/lib/stats.js'
import { SKILLS, skillsOf, isPassive } from './skills.js'

export const JOB_MAX = 30

// ===== 段階 =====
// mult … 必要ClassEXPの倍率（上の段階ほど重い）／perLv … ClassLVが1上がるごとのステの量（戦闘力換算）
// learnAt … スキルを覚えるClassLV（並び＝スキルの名簿の順）
// ★一次職は一旦なし（2026-10-09）。見直したらここへ段階を足す（前の案は 一次＝必要ClassEXP×3・ステ2ずつ）
export const STAGES = {
  shoki: { label:'初期', color:'#44aaff', mult:1, perLv:1, learnAt:[1, 5, 10, 15, 20] },
}
export const STAGE_ORDER = ['shoki']

// ===== 職業 =====
// weapons … 装備できる武器の種類（3つ）／kind … 通常攻撃が物理（STR）か魔法（INT）か
// desc … キャラ作成で出す特徴の説明（2026-10-09 ユーザー承認の文面）。技やクラスのステを変えたら合わせて直す
export const CLASS_INFO = {
  戦士:     { weapons:['両手剣', '斧', '鈍器'],   kind:'phys', desc:'STRとVITが伸びる頑丈な前衛。重い一撃と守りの構えで正面から戦う' },
  槍使い:   { weapons:['槍', '片手剣', '投擲'],   kind:'phys', desc:'STRとDEXが伸びるバランス型。必中の投げ槍や三段突きで着実に削る' },
  格闘家:   { weapons:['拳', '鈍器', '杖'],       kind:'phys', desc:'STRとAGIが伸びる拳の使い手。連打・爆裂拳の連撃で畳みかける' },
  盗賊:     { weapons:['短剣', '片手剣', '投擲'], kind:'phys', desc:'AGIも威力になる素早いアタッカー。毒や目つぶしで相手を崩す' },
  弓使い:   { weapons:['弓', '短剣', '片手剣'],   kind:'phys', desc:'AGIが大きく威力になる射手。必中の狙撃や、防御を貫く矢が得意' },
  銃士:     { weapons:['銃', '片手剣', '投擲'],   kind:'phys', desc:'DEXが大きく威力になる銃の名手。必中弾や、防御を無視する徹甲弾で撃ち抜く' },
  魔法使い: { weapons:['杖', '書', '短剣'],       kind:'mag',  desc:'INTで戦う攻撃魔法の使い手。火・雷・氷の魔法を撃ち分ける' },
  呪術師:   { weapons:['杖', '短剣', '投擲'],     kind:'mag',  desc:'呪いで相手を弱らせる魔法職。毒・鈍足・呪いを重ねて追い詰める' },
  僧侶:     { weapons:['鈍器', '杖', '書'],       kind:'mag',  desc:'回復と守りの魔法で粘り強く戦う。光の魔法で攻撃もこなす' },
  薬師:     { weapons:['短剣', '投擲', '書'],     kind:'mag',  desc:'薬で回復も強化もこなす。毒薬で削り、気付け薬でMPも戻す' },
}
export const START_CLASSES = Object.keys(CLASS_INFO)
export const CLASSES = START_CLASSES.map((id, i) => ({ id, stage:'shoki', sort: i, req: null, ...CLASS_INFO[id] }))
export const CLASS_BY_ID = Object.fromEntries(CLASSES.map(c => [c.id, c]))
export const stageOf = (cls) => CLASS_BY_ID[cls]?.stage || null
export const stageLabelOf = (cls) => STAGES[stageOf(cls)]?.label || ''
export const stageColorOf = (cls) => STAGES[stageOf(cls)]?.color || '#88ccff'
export const weaponsOf = (cls) => CLASS_BY_ID[cls]?.weapons || []
export const attackKindOf = (cls) => CLASS_BY_ID[cls]?.kind || 'phys'
export const classDescOf = (cls) => CLASS_BY_ID[cls]?.desc || ''
// その職業がその武器の種類を装備できるか
export const canEquipType = (cls, type) => weaponsOf(cls).includes(type)

// ===== 必要ClassEXP =====
// ClassLV² に比例。初期職は ClassLV30 まで**約2週間**（1日1時間・ユーザー決定「2週間くらい」）。
//   係数は tools/v2cap-progress.mjs --tune で回して決める
//   （2026-10-09 エリアの作り替えで1体のEXPが約1/4になったので測り直した。前は12.3）
// ⚠係数は10分率の整数で掛けてから10で割る（SQLの v2cap_job_need と同じ形）
// ★let なのは tools/v2cap-progress.mjs --tune が回しながら差し替えるため（ゲームの中では変えない）
export let JOB_NEED_TENTHS = 42
export const setJobNeedForTuning = (v) => { JOB_NEED_TENTHS = v }
export const jobNeed = (stage, jlv) =>
  (jlv >= JOB_MAX ? 0 : Math.max(1, Math.round(JOB_NEED_TENTHS * (STAGES[stage]?.mult || 1) * jlv * jlv / 10)))
export const jobTotalTo = (stage, jlv) => {
  let t = 0
  for (let j = 1; j < Math.min(jlv, JOB_MAX); j++) t += jobNeed(stage, j)
  return t
}

// 職業ごとのClassLV。jobs = { "戦士": { lv: 12, exp: 345 } }。まだ就いたことが無ければ1
export const jobOf = (jobs, cls) => ({ lv: jobs?.[cls]?.lv || 1, exp: jobs?.[cls]?.exp || 0 })

// ===== ステ（クラスのステ）=====
// 職業ごとの配分（戦闘力換算の点数）。合計29（ClassLV30まで1点ずつ）
export const JOB_BONUS = {
  戦士:     { str:12, vit:7, hp:5, dex:5 },
  槍使い:   { str:11, dex:9, vit:5, hp:4 },
  格闘家:   { str:10, agi:9, hp:5, vit:5 },
  盗賊:     { agi:12, dex:8, str:5, luk:4 },
  弓使い:   { dex:12, agi:8, str:5, luk:4 },
  銃士:     { dex:13, str:8, agi:4, luk:4 },
  魔法使い: { int_stat:14, mp:6, dex:5, agi:4 },
  呪術師:   { int_stat:13, mp:6, dex:5, luk:5 },
  僧侶:     { int_stat:10, vit:7, mp:6, hp:6 },
  薬師:     { int_stat:10, dex:7, mp:6, hp:6 },
}

// 配分を「何点目にどのステが上がるか」の並びにする（ランダムではなく固定）。
// 1点ずつ「配分に対して一番遅れているステ」を選ぶ＝どのClassLVで止めても配分どおりに近い。
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

// その職業のそのClassLVで入っている点数（戦闘力換算）
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
// 覚える順＝この版のスキルの名簿の順（skills.js）
export const learnOrderOf = (cls) => skillsOf(cls)
export const learnAtOf = (cls) => STAGES[stageOf(cls)]?.learnAt || []
// そのClassLVまでに覚えるスキル（名前の配列）
export const skillsLearnedBy = (cls, jlv) => {
  const at = learnAtOf(cls)
  return learnOrderOf(cls).filter((_, i) => at[i] !== undefined && at[i] <= (jlv || 1)).map(s => s.name)
}
// 次に覚えるスキルとそのClassLV（無ければ null）
export const nextSkillOf = (cls, jlv) => {
  const at = learnAtOf(cls)
  const list = learnOrderOf(cls)
  for (let i = 0; i < list.length; i++) if (at[i] > (jlv || 1)) return { skill: list[i], jlv: at[i] }
  return null
}

// ===== その職業で使えるスキル =====
// 【確定】スキルは**その職業でだけ使える**。**上位職は下位職のスキルをそのまま使える**（効果も消費MPも同じ）
//   （2026-10-09 ユーザー決定。今のⅡの「他職は0.8倍・MP2倍で使える」はやめた）
// 下位職＝就く条件（req）の職業をさかのぼったもの。先頭が自分＝[自分, 下位職, その下位職, …]
// ★いまは初期職だけ＝どの職業も自分だけ。一次職を入れると req からここが伸びる。
//   サーバーの v2cap_classes.lineage はこの出力を写したもの（tools/v2cap-sql.mjs が作る）
export const lineageOf = (cls, byId = CLASS_BY_ID) => {
  const out = []
  for (let c = cls; c && byId[c] && !out.includes(c); c = byId[c].req?.cls) out.push(c)
  return out
}
// その職業で枠に置ける技（覚えたもの・パッシブ以外）の名前。並び＝名簿の順
export const usableSkillNames = (cls, learned = [], lineage = lineageOf(cls)) => {
  const have = new Set(learned)
  return SKILLS.filter(s => lineage.includes(s.cls) && !isPassive(s) && have.has(s.name)).map(s => s.name)
}

// ===== 就けるか =====
// ★いまは初期職だけ＝条件なし。一次職を入れるときに req（{ cls, jlv }）を使う
//   （req の職業が「下位職」になり、そのスキルも使えるようになる＝ lineageOf）
export const reqOf = (cls) => CLASS_BY_ID[cls]?.req || null
export const missingReqOf = (cls, jobs) => {
  const r = reqOf(cls)
  if (!r) return null
  const have = jobOf(jobs, r.cls).lv
  return have >= r.jlv ? null : `${r.cls}のClassLV${r.jlv}（いま${have}）`
}
export const canBecome = (cls, jobs) => !!CLASS_BY_ID[cls] && !missingReqOf(cls, jobs)
export const reqText = (cls) => {
  const r = reqOf(cls)
  return r ? `${r.cls}のClassLV${r.jlv}` : '条件なし'
}

// ===== ClassEXPを入れる（純関数・表示とシミュレーション用）=====
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
