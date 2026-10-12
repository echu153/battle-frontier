// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— アセンション（スキルツリー）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示（AION2 のダエバニオンを参考に）＋選んだこと（設計 §4-2）：
//   ・CLASS LVが1上がるごとに **AP を1** もらう（職業ごと）。初期職はCLASS LV30で29・一次職はCLASS LV50で49
//   ・**どのマスも1AP**。盤面は**職業ごと**で、効くのは**その職業でいる間だけ**（クラスのステと同じ）
//   ・形は**枝分かれの木**：真ん中の起点から4本の道。道は起点の側から順に開く。先へ行くほど強いマス
//   ・全部は埋まらない（**半分くらい**）：初期職 1本14マス×4本＝56マス／一次職 1本24マス×4本＝96マス
//   ・道のテーマはその職業で伸びるステの上位4つ（クラスのステの配分 JOB_BONUS の多い順）
//   ・小マス：道のステ。初期職 +2→+3→+4・一次職 +3→+4→+5（HPは×8・MPは×3＝戦闘力が同じ）
//   ・スキルマス：**技1つにつき1マス**（パッシブには作らない）。攻撃の技＝威力+20%・回復の技＝回復量+10%・
//     バフの技＝上がり幅を**合計で+10**（剣の構え STR+10%・DEX+9%・AGI+8% → STR+14%・DEX+12%・AGI+11%）。
//     %で書けないバフ（クイック・分身の術・装填・鬼神降ろし・狂信）は回数・ターンを+1。
//     ★上がり幅は**技ごとに変える予定**（ユーザー）＝ ASC_SKILL_UP に技の名前で書けば差し替わる
//   ・道の終わりの大マス：道のステ+5%（初期職・一次職とも）
//   ・振り直しは **LV×100 Gold**。その職業の盤面を全部戻してAPを返す
//   ・敵の強さの測り直し（tools/v2cap-progress.mjs）には入れない（ユーザー決定）
//
// ★権威はサーバー（supabase_v2cap_core.sql §12 の v2cap_ascend／v2cap_ascend_reset と、v2cap_asc_roads の種）。
//   ここが木の形と効果の正。種は tools/v2cap-sql.mjs がここから作る（v2capsql.test.js が突き合わせる）
// ★サーバーが数えるのは「APが足りるか」と「スキル編成の最大MP」（MPの道のマス）だけ。ほかの効果は戦闘（この写し）で効く
// ============================================================
import { STAT_KEYS, STAT_DEFS } from '../../v2/lib/stats.js'
import { SKILL_BY_NAME, skillsOf, isPassive } from './skills.js'
import { JOB_BONUS, CLASSES, stageOf, jobOf, jobLevelsGained, ASC_AP_PER_JLV } from './jobs.js'

export const ASC_ROADS = 4
// 段階ごとの木の形。len … 1本のマスの数（道の終わりの大マスを含む）／tiers … 小マスの値（起点の側から3段）／bigPct … 大マス
export const ASC_SHAPE = {
  shoki:  { len: 14, tiers: [2, 3, 4], bigPct: 5 },
  ichiji: { len: 24, tiers: [3, 4, 5], bigPct: 5 },
}
// 振り直しの費用（LV×これ Gold）
export const ASC_RESET_GOLD_PER_LV = 100
export const ascResetGoldOf = (lv) => Math.max(1, lv || 1) * ASC_RESET_GOLD_PER_LV

// 道の名前（ステの和名：腕力の道・知性の道・生命の道 …）
export const roadNameOf = (stat) => `${STAT_DEFS[stat]?.jp || stat}の道`

// ===== スキルマスの上がり幅 =====
// 【確定】2026-10-13 ユーザー指示「一旦1マス威力20%UP、回復のスキルは10%、バフスキルは合計10%上昇」
export const ASC_UP_DEFAULT = { attack: 20, heal: 10, buff: 10, count: 1 }
// 技ごとの上がり幅（ユーザーがあとで決める）。{ 袈裟斬り: 25 } のように書くと、その技だけ差し替わる
export const ASC_SKILL_UP = {}

// %で書けないバフは回数・ターンを+1（2026-10-13 ユーザーが選んだ）。key.field の数を足す
export const ASC_COUNT_UP = {
  クイック:   { key: 'extraTurn',    field: 'max',   label: '戦闘中に使える回数', unit: '回' },
  分身の術:   { key: 'gain',         field: 'n',     label: '1回で出す分身',     unit: '体' },
  装填:       { key: 'gain',         field: 'n',     label: '1回で増える装填',   unit: '' },
  鬼神降ろし: { key: 'summonHits',   field: 'turns', label: '続くターン',        unit: 'ターン' },
  狂信:       { key: 'debuffImmune', field: 'turns', label: '続くターン',        unit: 'ターン' },
}
// ステの表を持たないバフの「上がり幅」（%の数）。上から見て最初に持っているものに足す。
// scale … 1点の大きさ（召喚の倍率は ×0.25＝25% の形なので 0.01）
export const ASC_BUFF_PARAMS = [
  { key: 'guard',       field: 'cut',  label: '受けるダメージ', sign: -1, scale: 1 },    // 受け止め・気の鎧・陰陽結界・祈りの結界
  { key: 'lifeSteal',   field: 'pct',  label: '与えたダメージの吸収', sign: 1, scale: 1 }, // ブラッディロア
  { key: 'endure',      field: 'pct',  label: '返すダメージ',   sign: 1, scale: 1 },     // 忍耐
  { key: 'dodgeBoost',  field: 'pct',  label: '回避したあとの威力', sign: 1, scale: 1 }, // 流水の構え
  { key: 'summonBoost', field: 'pct',  label: '召喚の攻撃力',   sign: 1, scale: 1 },     // 死の行軍
  { key: 'revive',      field: 'pct',  label: '復活したときのHP', sign: 1, scale: 1 },   // リザレクション
  { key: 'nextBoost',   field: 'per',  label: '溜め1つの威力',  sign: 1, scale: 1 },     // 照準・詠唱
  { key: 'summon',      field: 'mult', label: '召喚の攻撃',     sign: 1, scale: 0.01 },  // 骸骨召喚・式神召喚（魔法×0.25→×0.35）
]

// スキルマスの種類（攻撃・回復・バフ・回数）。パッシブと知らない種類は null（マスを作らない）
export const ascKindOf = (skill) => {
  if (!skill || isPassive(skill)) return null
  if (skill.kind === 'phys' || skill.kind === 'mag') return 'attack'
  if (skill.kind === 'heal') return 'heal'
  if (skill.kind === 'buff') return ASC_COUNT_UP[skill.name] ? 'count' : 'buff'
  return null
}
export const ascUpOf = (name) => {
  const k = ascKindOf(SKILL_BY_NAME[name])
  return k ? (ASC_SKILL_UP[name] ?? ASC_UP_DEFAULT[k]) : 0
}

// 合計 total を表の値の大きさの割合で分ける（整数・端数は余りの大きい順＝同じなら表の並びの先）。符号は元の値に合わせる
export const splitUp = (table, total) => {
  const keys = Object.keys(table || {}).filter(k => table[k])
  const sum = keys.reduce((t, k) => t + Math.abs(table[k]), 0)
  if (!keys.length || sum <= 0) return {}
  const raw = keys.map(k => (total * Math.abs(table[k])) / sum)
  const got = raw.map(v => Math.floor(v + 1e-9))
  let left = total - got.reduce((a, b) => a + b, 0)
  const order = keys.map((_, i) => i).sort((a, b) => (raw[b] - got[b]) - (raw[a] - got[a]) || a - b)
  for (const i of order) {
    if (left <= 0) break
    got[i] += 1
    left -= 1
  }
  return Object.fromEntries(keys.map((k, i) => [k, Math.sign(table[k]) * got[i]]))
}

// バフの表（自分＋相手）をひとまとめに見る（今の技はどちらか一方だけ）
const buffEntries = (skill) => ['self', 'enemy'].flatMap(side =>
  Object.entries(skill?.buff?.[side] || {}).filter(([, v]) => v).map(([k, v]) => ({ side, k, v })))
const round3 = (v) => Math.round(v * 1000) / 1000

// その技にスキルマスを当てた形を返す（元の技は書き換えない）。up は上がり幅（ascUpOf）
//   攻撃 … ascDmg（%）＝戦闘エンジン（src/v2/lib/battle.js）がその技のダメージ全体に掛ける
//   回復 … ascHeal（%）＝同じく回復量（HP・MP・毎ターンの回復）に掛ける
//   バフ … 表の上がり幅を合計 up だけ足す／表が無ければ ASC_BUFF_PARAMS の最初の項目に up 足す
//   回数 … ASC_COUNT_UP の数に up 足す
export const ascendSkill = (skill, up = ascUpOf(skill?.name)) => {
  const kind = ascKindOf(skill)
  if (!kind || !up) return skill
  if (kind === 'attack') return { ...skill, ascDmg: (skill.ascDmg || 0) + up }
  if (kind === 'heal') return { ...skill, ascHeal: (skill.ascHeal || 0) + up }
  if (kind === 'count') {
    const c = ASC_COUNT_UP[skill.name]
    return { ...skill, [c.key]: { ...skill[c.key], [c.field]: (skill[c.key]?.[c.field] || 0) + up } }
  }
  const ents = buffEntries(skill)
  if (ents.length) {
    const flat = Object.fromEntries(ents.map((e, i) => [i, e.v]))
    const add = splitUp(flat, up)
    const buff = { ...skill.buff }
    ents.forEach((e, i) => { buff[e.side] = { ...buff[e.side], [e.k]: e.v + (add[i] || 0) } })
    return { ...skill, buff }
  }
  const p = ASC_BUFF_PARAMS.find(x => skill[x.key]?.[x.field] !== undefined)
  if (!p) return skill
  return { ...skill, [p.key]: { ...skill[p.key], [p.field]: round3(skill[p.key][p.field] + up * p.scale) } }
}

// ===== 文 =====
const STAT_LABEL = (k) => STAT_DEFS[k]?.label || k
const signed = (v) => (v < 0 ? `−${-v}` : `+${v}`)
// スキルマスの短い文（木のマスに出す2行目）
export const ascSkillShort = (name) => {
  const kind = ascKindOf(SKILL_BY_NAME[name])
  const up = ascUpOf(name)
  if (kind === 'attack') return `威力+${up}%`
  if (kind === 'heal') return `回復量+${up}%`
  if (kind === 'count') return `${ASC_COUNT_UP[name].unit === 'ターン' ? 'ターン' : '回数'}+${up}`
  // バフは上がり幅を合計で足す（ユーザーの言い方「合計10%上昇」。1.1倍と読み違えないように「効果+」にはしない）
  if (kind === 'buff') return `合計+${up}%`
  return ''
}
// スキルマスのくわしい文（前 → 後）。例「STR+10%→+14%・DEX+9%→+12%・AGI+8%→+11%」
export const ascSkillDetail = (name) => {
  const s = SKILL_BY_NAME[name]
  const kind = ascKindOf(s)
  const up = ascUpOf(name)
  if (!kind) return ''
  if (kind === 'attack') return `威力+${up}%（ダメージ全体）`
  if (kind === 'heal') return `回復量+${up}%`
  const a = ascendSkill(s, up)
  if (kind === 'count') {
    const c = ASC_COUNT_UP[name]
    return `${c.label} ${s[c.key][c.field]}${c.unit}→${a[c.key][c.field]}${c.unit}`
  }
  const ents = buffEntries(s)
  if (ents.length) {
    const after = buffEntries(a)
    return ents.map((e, i) => `${e.side === 'enemy' ? '相手の' : ''}${STAT_LABEL(e.k)}${signed(e.v)}%→${signed(after[i].v)}%`).join('・')
  }
  const p = ASC_BUFF_PARAMS.find(x => s[x.key]?.[x.field] !== undefined)
  if (!p) return ''
  const fmt = (v) => (p.scale === 1 ? `${signed(p.sign * v)}%` : `×${v}`)
  return `${p.label} ${fmt(s[p.key][p.field])}→${fmt(a[p.key][p.field])}`
}

// ===== 木の形 =====
// 道のテーマ＝クラスのステの配分の多い順に4つ（同じ数ならステの並び STAT_KEYS の先）
export const roadStatsOf = (cls) => Object.entries(JOB_BONUS[cls] || {})
  .filter(([, v]) => v > 0)
  .sort((a, b) => b[1] - a[1] || STAT_KEYS.indexOf(a[0]) - STAT_KEYS.indexOf(b[0]))
  .slice(0, ASC_ROADS)
  .map(([k]) => k)

// その技がどのステをよく使うか（道に置くときの目安。数が大きいほどその道に置きたい）
export const skillAffinity = (skill) => {
  const a = {}
  const add = (k, v) => { if (k && v > 0) a[k] = (a[k] || 0) + v }
  if (skill?.kind === 'phys') add(skill.src || 'str', 1)
  if (skill?.kind === 'mag' || skill?.kind === 'heal') add(skill.src || 'int_stat', 1)
  for (const x of skill?.add || []) add(x.stat, x.rate)
  for (const [k, v] of Object.entries(skill?.buff?.self || {})) add(k, v / 100)
  return a
}

// n 個を4本へ（なるべく同じ数・余りは前の道から）
const capacityOf = (n) => Array.from({ length: ASC_ROADS }, (_, r) => Math.floor(n / ASC_ROADS) + (r < n % ASC_ROADS ? 1 : 0))

// 技を道へ置く。覚える順に、その技がよく使うステの道（空きがあるところ）へ。
// 同じなら空きの多い道・前の道。返すのは道ごとの技の名前（覚える順）
export const placeSkillsOf = (cls, stats = roadStatsOf(cls)) => {
  const names = skillsOf(cls).filter(s => ascKindOf(s)).map(s => s.name)
  const cap = capacityOf(names.length)
  const out = stats.map(() => [])
  for (const name of names) {
    const aff = skillAffinity(SKILL_BY_NAME[name])
    let best = -1
    for (let r = 0; r < stats.length; r++) {
      if (cap[r] <= 0) continue
      if (best < 0) { best = r; continue }
      const d = (aff[stats[r]] || 0) - (aff[stats[best]] || 0)
      if (d > 1e-9 || (Math.abs(d) <= 1e-9 && cap[r] > cap[best])) best = r
    }
    if (best < 0) break
    out[best].push(name)
    cap[best] -= 1
  }
  return out
}

// 小マスの3段の数（n マスを3つに。余り1は真ん中・余り2は前と真ん中）
export const tierSizesOf = (n) => {
  const b = Math.floor(n / 3)
  const rem = n % 3
  return rem === 0 ? [b, b, b] : rem === 1 ? [b, b + 1, b] : [b + 1, b + 1, b]
}
// k 個のスキルマスの位置（1始まり・n マスの中に等間隔）
export const skillPositionsOf = (n, k) => Array.from({ length: k }, (_, i) => Math.ceil((n * (i + 1)) / (k + 1)))

// その職業の木。roads[r].nodes[i]（i は0始まり・起点の側から）＝
//   { type:'stat', stat, amount（ステの値。HPは×8）, pts（戦闘力） } ／ { type:'skill', skill, up } ／ { type:'big', stat, pct }
const TREE_CACHE = {}
const buildTree = (cls) => {
  const stage = stageOf(cls)
  const shape = ASC_SHAPE[stage]
  if (!shape) return null
  const stats = roadStatsOf(cls)
  const placed = placeSkillsOf(cls, stats)
  const slots = shape.len - 1
  const sizes = tierSizesOf(slots)
  const tierAt = (pos) => (pos <= sizes[0] ? 0 : pos <= sizes[0] + sizes[1] ? 1 : 2)
  const roads = stats.map((stat, r) => {
    const names = placed[r]
    const at = Object.fromEntries(skillPositionsOf(slots, names.length).map((p, i) => [p, names[i]]))
    const nodes = []
    for (let pos = 1; pos <= slots; pos++) {
      if (at[pos]) nodes.push({ type: 'skill', skill: at[pos], up: ascUpOf(at[pos]) })
      else {
        const pts = shape.tiers[tierAt(pos)]
        nodes.push({ type: 'stat', stat, amount: pts * STAT_DEFS[stat].unit, pts })
      }
    }
    nodes.push({ type: 'big', stat, pct: shape.bigPct })
    return { road: r, stat, name: roadNameOf(stat), nodes }
  })
  return { cls, stage, len: shape.len, roads }
}
export const treeOf = (cls) => (cls in TREE_CACHE ? TREE_CACHE[cls] : (TREE_CACHE[cls] = buildTree(cls)))
// 全部のマスの数（＝全部開くのに要るAP）
export const treeSizeOf = (cls) => (treeOf(cls)?.roads || []).reduce((t, r) => t + r.nodes.length, 0)

// マスの文（木に出す）。1行目と2行目
export const nodeLines = (node) => {
  if (!node) return ['', '']
  if (node.type === 'stat') return [`${STAT_LABEL(node.stat)}+${node.amount}`, '']
  if (node.type === 'big') return [`${STAT_LABEL(node.stat)}+${node.pct}%`, '']
  return [node.skill, ascSkillShort(node.skill)]
}
export const nodeText = (node) => {
  if (!node) return ''
  if (node.type === 'skill') return `${node.skill}：${ascSkillDetail(node.skill)}`
  return nodeLines(node)[0]
}

// ===== 持っている状態 =====
// profile.ascension ＝ { "剣士": [5, 3, 0, 12] }＝道ごとに起点の側から何マス開いたか
export const ascStateOf = (profile, cls = profile?.class) => {
  const t = treeOf(cls)
  const raw = profile?.ascension?.[cls]
  return (t?.roads || []).map((road, r) => {
    const n = Math.floor(Number(Array.isArray(raw) ? raw[r] : 0) || 0)
    return Math.max(0, Math.min(road.nodes.length, n))
  })
}
// AP（その職業のCLASS LVが上がった回数×1）・使ったAP・残り
export const apTotalOf = (cls, jlv) => jobLevelsGained(cls, jlv) * ASC_AP_PER_JLV
export const apSpentOf = (state) => (state || []).reduce((a, b) => a + (b || 0), 0)
export const apLeftOf = (profile, cls = profile?.class) =>
  apTotalOf(cls, jobOf(profile?.jobs, cls).lv) - apSpentOf(ascStateOf(profile, cls))

// 開いたマス
export const ownedNodesOf = (cls, state) =>
  (treeOf(cls)?.roads || []).flatMap((road, r) => road.nodes.slice(0, state?.[r] || 0))

// 効果のまとめ。flat … 小マスのステ（ステの値）／pct … 大マスのステ+%／ups … スキルマス { 技の名前: 上がり幅 }
export const ascEffectsOf = (profile, cls = profile?.class) => {
  const flat = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  const pct = {}
  const ups = {}
  for (const n of ownedNodesOf(cls, ascStateOf(profile, cls))) {
    if (n.type === 'stat') flat[n.stat] += n.amount
    else if (n.type === 'big') pct[n.stat] = (pct[n.stat] || 0) + n.pct
    else if (n.type === 'skill') ups[n.skill] = (ups[n.skill] || 0) + n.up
  }
  return { flat, pct, ups }
}
// 大マスの「+%」で増える量（base＝本体＋クラス＋装備＋小マスのステ。四捨五入＝サーバーの v2cap_asc_mp と同じ）
export const ascPctGain = (base, pct) =>
  Object.fromEntries(STAT_KEYS.map(k => [k, pct?.[k] ? Math.round(((base?.[k] || 0) * pct[k]) / 100) : 0]))

// ===== 開けるか（サーバーの v2cap_ascend と同じ順・同じ文言）=====
// road の道を to マス目まで開く（いまより先・残りのAPで足りるぶん）
export const ascendError = (profile, cls, road, to) => {
  const t = treeOf(cls)
  if (!t) return 'その職業にはアセンションがありません'
  const r = t.roads[road]
  if (!r) return 'その道はありません'
  const cur = ascStateOf(profile, cls)[road]
  if (!Number.isInteger(to) || to <= cur) return 'もう開いています'
  if (to > r.nodes.length) return 'その道はそこまでありません'
  if (to - cur > apLeftOf(profile, cls)) return 'APが足りません'
  return null
}

// どの職業にも木があるか（テストと種で使う）
export const ASC_CLASSES = CLASSES.map(c => c.id).filter(id => treeOf(id))
