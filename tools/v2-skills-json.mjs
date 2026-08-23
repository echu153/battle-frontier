// スキル一覧をJSONで吐く（Artifactの表に埋め込む用）。正は src/v2/lib/skills.js
import fs from 'node:fs'
const { SKILL_CLASSES, skillsOf, passiveOf, powerText, isPassive } = await import(new URL('../src/v2/lib/skills.js', import.meta.url).href)
const { CLASS_BONUS, classBonusText } = await import(new URL('../src/v2/lib/classBonus.js', import.meta.url).href)

// docs 生成と同じ備考を使う（二重定義しないよう、生成器から noteOf を取り出す）
const src = fs.readFileSync(new URL('./v2-skills-doc.mjs', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('const noteOf'), src.indexOf('const rowOf'))
const AIL = { bleed:'出血', poison:'毒', slow:'鈍足', paralyze:'麻痺', healCut:'回復阻害' }
const noteOf = new Function('AIL', `${body}; return noteOf`)(AIL)

const KIND = { phys:'物理', mag:'特殊', heal:'回復', buff:'補助', passive:'パッシブ' }
const STAT = { str:'STR', dex:'DEX', agi:'AGI', int_stat:'INT', vit:'VIT', luk:'LUK' }

const classes = SKILL_CLASSES.map(cls => {
  const b = CLASS_BONUS[cls] || {}
  const pas = passiveOf(cls)
  const list = [...(pas ? [pas] : []), ...skillsOf(cls)]
  return {
    name: cls,
    basic: list.length === 5,
    bonus: classBonusText ? (classBonusText(cls) || '') : '',
    main: STAT[b.main] || '',
    sub: STAT[b.sub] || '',
    skills: list.map(s => ({
      name: s.name,
      kind: KIND[s.kind],
      kindKey: s.kind,
      power: powerText(s),
      proc: isPassive(s) ? '常時' : `${s.proc}%`,
      mp: s.mpPct ? '割合' : String(s.mp ?? 0),
      note: noteOf(s).replace(/\*\*/g, ''),
      added: !!s.added,
      req: s.reqJobs || 0,
      src: STAT[s.src] || '',
    })),
  }
})
// 「2026-08-19 追加」の6〜10個目に印を付ける（初期職は5個のまま）
for (const c of classes) if (!c.basic) c.skills.forEach((s, i) => { s.added = i >= 6 })   // 先頭はパッシブ

const out = { classes, total: classes.reduce((t, c) => t + c.skills.length, 0) }
fs.writeFileSync(new URL('./v2-skills.json', import.meta.url), JSON.stringify(out))
console.log('classes:', classes.length, 'skills:', out.total)
