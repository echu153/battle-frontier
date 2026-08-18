// ============================================================
// バトルフロンティアⅡ（v2）— スキル一覧表と「完全下位互換」の検出
// ------------------------------------------------------------
// 使い方: node scripts/v2_skill_table.mjs
//   → docs/v2-skill-compare.md を書き出す
//
// ★v2は「習得済み」で転職後もスキルが残る＝**職業をまたいで自由に組み合わせられる**。
//   なので「別の職業のスキルに全部の軸で負けている技」は、一度そちらを覚えたら
//   二度と編成されない＝**完全な死に技**になる。それを機械的に洗い出すための道具。
// ★数字を触ったら必ず流し直すこと（docs/v2-skill-compare.md は生成物）。
// ============================================================
import { writeFileSync } from 'node:fs'
import { SKILLS, isPassive, isBasicClass, powerText } from '../src/v2/lib/skills.js'

// ★ブリーダーは突き合わせから外す（2026-08-18 ユーザー決定）。
//   旧版はペット共闘の職業で、v2にペットが無いぶん効果をまるごと作り直す前提＝
//   いまの数字は仮置き。仮の数字を基準に他職を動かすと二度手間になる。
const EXCLUDE_CLASSES = ['ブリーダー']

const STATS = ['str','int_stat','agi','dex','vit','luk']
const LABEL = { str:'STR', int_stat:'INT', agi:'AGI', dex:'DEX', vit:'VIT', luk:'LUK' }
const num = (x) => (x === undefined || x === null ? 0 : x)
const tier = (s) => (s.cls === 'ノーブル' ? '開始' : isBasicClass(s.cls) ? '初期' : '上位')

// 威力の係数ベクトル（多段こみ）。物理はSTR・魔法はINTに主倍率が乗る
const vec = (s) => {
  const v = {}
  const hits = s.hits || 1
  if (s.kind === 'phys' || s.kind === 'mag') {
    const main = s.kind === 'mag' ? 'int_stat' : 'str'
    v[main] = (v[main] || 0) + s.mult * hits
    for (const a of s.add || []) v[a.stat] = (v[a.stat] || 0) + a.rate * hits
  }
  return v
}
const totalPower = (s) => STATS.reduce((t, k) => t + num(vec(s)[k]), 0)

// 付随効果を1つの列にまとめる
const extras = (s) => {
  const out = []
  if (s.defPen) out.push(`防御無視${Math.round(s.defPen * 100)}%`)
  if (s.drain) out.push(`吸収${Math.round(s.drain * 100)}%`)
  if (s.sureHit) out.push('必中')
  if (s.sureCrit) out.push('確定クリ')
  if (s.noCrit) out.push('クリ無')
  if (s.mpPct) out.push(`残MP${Math.round(s.mpPct * 100)}%消費`)
  if (s.priority) out.push('先制')
  for (const k of STATS) {
    const v = num(s.buff?.self?.[k]); if (v) out.push(`自${LABEL[k]}${v > 0 ? '+' : ''}${v}%`)
  }
  for (const k of STATS) {
    const v = num(s.buff?.enemy?.[k]); if (v) out.push(`敵${LABEL[k]}${v > 0 ? '+' : ''}${v}%`)
  }
  if (s.heal)    out.push(`即時回復 INT×${s.heal.rate}`)
  if (s.regen)   out.push(`継続回復 INT×${s.regen.rate}×${s.regen.turns}T`)
  if (s.mpRegen) out.push(`MP回復 INT×${s.mpRegen.rate}×${s.mpRegen.turns}T`)
  return out.join('・') || '—'
}

// A が B の完全上位互換か（全部の軸で A >= B、どこか1つで真に上）
const dominates = (A, B) => {
  if (A === B || A.kind !== B.kind) return false
  let strict = false
  const va = vec(A), vb = vec(B)
  const ge = (a, b) => { if (a < b - 1e-9) return false; if (a > b + 1e-9) strict = true; return true }
  const le = (a, b) => { if (a > b + 1e-9) return false; if (a < b - 1e-9) strict = true; return true }
  for (const k of STATS) if (!ge(num(va[k]), num(vb[k]))) return false
  if (!ge(A.proc ?? 100, B.proc ?? 100)) return false
  if (!!A.mpPct !== !!B.mpPct) return false            // 割合消費は比較不能
  if (!le(num(A.mp), num(B.mp))) return false
  for (const k of ['defPen','drain']) if (!ge(num(A[k]), num(B[k]))) return false
  for (const k of ['sureHit','sureCrit']) {
    if (!A[k] && B[k]) return false
    if (A[k] && !B[k]) strict = true
  }
  if (A.noCrit && !B.noCrit) return false              // クリ無は下位の要素
  if (!A.noCrit && B.noCrit) strict = true
  if ((A.hits || 1) > (B.hits || 1)) return false      // 多段は命中がばらける＝下位の要素
  if ((A.hits || 1) < (B.hits || 1)) strict = true
  for (const k of STATS) {
    if (!ge(num(A.buff?.self?.[k]),  num(B.buff?.self?.[k])))  return false
    if (!le(num(A.buff?.enemy?.[k]), num(B.buff?.enemy?.[k]))) return false
  }
  for (const k of ['heal','regen','mpRegen']) {
    const tot = (s) => num(s[k]?.rate) * (s[k] ? num(s[k].turns) || 1 : 0)
    if (!ge(tot(A), tot(B))) return false
  }
  if (!ge(num(A.priority), num(B.priority))) return false
  return strict
}

const list = SKILLS.filter(s => !isPassive(s) && !EXCLUDE_CLASSES.includes(s.cls))
const pairs = []
for (const B of list) for (const A of list) if (dominates(A, B)) pairs.push([A, B])

const KIND = { phys:'物理', mag:'魔法', heal:'回復', buff:'補助' }
const mpCell = (s) => (s.mpPct ? '割合' : String(s.mp))
const row = (s) => {
  const atk = s.kind === 'phys' || s.kind === 'mag'
  const p = totalPower(s)
  return `| ${s.name} | ${s.cls} | ${tier(s)} | ${KIND[s.kind]} | ${powerText(s)} | ${atk ? p.toFixed(2) : '—'} | ${s.proc}% | ${mpCell(s)} | ${atk ? (p * s.proc / 100).toFixed(2) : '—'} | ${extras(s)} |`
}

const HEAD = '| スキル | 職業 | 区分 | 種別 | 威力 | 合計係数 | 発動 | MP | 実質 | 付随効果 |\n|---|---|---|---|---|---|---|---|---|---|'
const section = (title, rows) => `### ${title}\n\n${HEAD}\n${rows.join('\n')}\n`

const byKind = (k) => list.filter(s => s.kind === k)
  .sort((a, b) => (totalPower(b) * b.proc) - (totalPower(a) * a.proc) || a.name.localeCompare(b.name, 'ja'))
  .map(row)
const bySup = (k) => list.filter(s => s.kind === k)
  .sort((a, b) => a.cls.localeCompare(b.cls, 'ja') || a.name.localeCompare(b.name, 'ja'))
  .map(row)

const tag = (s) => `${s.name}（${s.cls}・${tier(s)}）`
const same = pairs.filter(([A, B]) => tier(A) === tier(B))
const cross = pairs.filter(([A, B]) => tier(A) !== tier(B))
const groupBy = (ps) => {
  const m = new Map()
  for (const [A, B] of ps) {
    if (!m.has(B)) m.set(B, [])
    m.get(B).push(A)
  }
  return [...m.entries()].map(([B, as]) => `| ${tag(B)} | ${as.map(tag).join('<br>')} |`)
}
const PHEAD = '| 死んでいる技 | これに全部の軸で負けている |\n|---|---|'

const md = `# バトルフロンティアⅡ スキル効果の突き合わせ表

⚠**このファイルは生成物**。\`node scripts/v2_skill_table.mjs\` で作り直す。
数字の正は [\`src/v2/lib/skills.js\`](../src/v2/lib/skills.js)、職業別の一覧は [v2-skills.md](v2-skills.md)。

- **合計係数** … 主参照＋副参照を足して多段数を掛けたもの（物理はSTR・魔法はINTに主倍率が乗る）
- **実質** … 合計係数 × 発動率。物理と魔法は防御の効きが違うので**種別をまたいで比べない**
  （同格で物理×0.83／魔法×0.733＝**魔法は物理の1.13倍でようやく並ぶ**）
- パッシブは軸が違うので表から外してある（[v2-skills.md](v2-skills.md) を参照）
- ⚠**${EXCLUDE_CLASSES.join("・")}は表から外してある**（効果をまるごと作り直す前提＝いまの数字は仮置きのため）

## 完全下位互換

**全部の軸（威力の係数・発動率・消費MP・防御無視・吸収・必中・確定クリ・クリ無・多段・バフ・デバフ・回復・先制）で
別の技に負けている技**を機械的に洗い出したもの。v2は習得済みで転職後もスキルが残る＝**職業をまたいで自由に
組み合わせられる**ので、こうなっている技は一度相手を覚えたら二度と編成されない。

### ① 同じ区分どうし（${same.length}組）＝直す対象

${PHEAD}
${groupBy(same).join('\n')}

### ② 初期職 ← 上位職（${cross.length}組）＝設計どおりの上下関係

上位職が初期職を上回るのは意図した並びなので、そのままでよいかの判断用。

${PHEAD}
${groupBy(cross).join('\n')}

## 全スキル（実質の高い順）

${section('物理', byKind('phys'))}
${section('魔法', byKind('mag'))}
${section('回復', byKind('heal'))}
${section('補助', byKind('buff'))}

## 全スキル（職業順）

${section('物理', bySup('phys'))}
${section('魔法', bySup('mag'))}
${section('回復', bySup('heal'))}
${section('補助', bySup('buff'))}
`

writeFileSync(new URL('../docs/v2-skill-compare.md', import.meta.url), md)
console.log(`docs/v2-skill-compare.md を書き出した（完全下位互換 ${pairs.length}組 = 同区分 ${same.length} / 区分またぎ ${cross.length}）`)
