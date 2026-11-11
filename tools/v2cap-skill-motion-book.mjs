// ============================================================
// v2cap ATB の「技の種類ごとのモーション」のプロンプト帳（1枚の HTML）を作る
// ------------------------------------------------------------
// 【確定】2026-11-11 ユーザー選択「技の種類ごと」・マネキンは斜め前（決まりは tools/v2cap-mannequin/plan.mjs）
// 1行＝クラス×男女×技の種類（その職業が ATB で使う技＝系統の技ぜんぶの種類）。マネキンのシートと待機の1コマ目を並べ、
//   ChatGPT に渡す頼む文（plan.mjs の promptOf）とファイル名（<クラス名><男|女><物理|魔法|補助|回復>.png）を出す。
//   作成済み＝画面に入った絵（src/v2cap/lib/motionArtList.js にその動きがある）
// 使い方：node tools/v2cap-skill-motion-book.mjs [書き出す先.html]
//   マネキンのシート：tools/v2cap-mannequin/out/mannequin-<id>-A.png（node tools/v2cap-mannequin/mannequin.mjs で作る・git に入れない）
//   待機の1コマ目：public/V2newjob/gif/<ローマ字>-<m|f>.gif の1コマ目を2倍（ドットのまま）
// ★ffmpeg を使う
// ============================================================
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ART_BASE, GIF_OUT } from '../src/v2cap/lib/classArt.js'
import { CLASS_BY_ID, lineageOf } from '../src/v2cap/lib/jobs.js'
import { SKILLS } from '../src/v2cap/lib/skills.js'
import { MOTION_KEYS } from '../src/v2cap/lib/motionArt.js'
import { MOTION_ART } from '../src/v2cap/lib/motionArtList.js'
import { FAMILY, KIND_FILE, KIND_LABEL, familyOf, gearOf, promptOf } from './v2cap-mannequin/plan.mjs'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..')
const MANN_DIR = path.join(ROOT, 'tools', 'v2cap-mannequin', 'out')
const TEMPLATE = path.join(ROOT, 'tools', 'v2cap-mannequin', 'book.template.html')
const KIND_ORDER = ['phys', 'mag', 'buff', 'heal']
const INITIAL = new Set(Object.keys(CLASS_BY_ID).filter(c => !CLASS_BY_ID[c].req))

// その職業が ATB で使う技の種類（系統の技ぜんぶ・パッシブを除く）
export const kindsOf = (cls) => {
  const lin = lineageOf(cls)
  const have = new Set(SKILLS.filter(s => lin.includes(s.cls) && s.kind !== 'passive').map(s => s.kind))
  return KIND_ORDER.filter(k => have.has(k))
}
export const fileOf = (cls, g, kind) => `${cls}${g === 'm' ? '男' : '女'}${KIND_FILE[kind]}.png`

// 一覧の中身（絵は入れない）
export const bookRows = () => Object.keys(ART_BASE).map(cls => ({
  cls, group: INITIAL.has(cls) ? 'init' : 'upper',
  g: ['m', 'f'].map(g => ({
    g, w: gearOf(cls, g).w,
    kinds: kindsOf(cls).map(kind => ({
      kind, label: KIND_LABEL[kind], fam: familyOf(cls, g, kind), act: FAMILY[familyOf(cls, g, kind)].label,
      file: fileOf(cls, g, kind), prompt: promptOf(cls, g, kind), done: !!MOTION_ART[cls]?.[g]?.[MOTION_KEYS[KIND_FILE[kind]]],
    })),
  })),
}))

const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`
const idleFrame = (cls, g) => execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(ROOT, 'public', 'V2newjob', GIF_OUT, `${ART_BASE[cls]}-${g}.gif`),
  '-frames:v', '1', '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 1 << 26 })

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const out = path.resolve(process.argv[2] || path.join(MANN_DIR, 'skill-motion-book.html'))
  const rows = bookRows()
  const fams = [...new Set(rows.flatMap(c => c.g.flatMap(x => x.kinds.map(k => k.fam))))]
  const mann = {}
  for (const id of fams) {
    const f = path.join(MANN_DIR, `mannequin-${id}-A.png`)
    if (!existsSync(f)) throw new Error(`マネキンのシートが無い：${path.relative(ROOT, f)}（node tools/v2cap-mannequin/mannequin.mjs）`)
    mann[id] = { src: dataUrl(readFileSync(f)), label: FAMILY[id].label }
  }
  const data = rows.map(c => ({ ...c, g: c.g.map(x => ({ ...x, img: dataUrl(idleFrame(c.cls, x.g)) })) }))
  const html = readFileSync(TEMPLATE, 'utf8').replace('/*__DATA__*/null', JSON.stringify(data)).replace('/*__MANN__*/null', JSON.stringify(mann))
  writeFileSync(out, html)
  const n = rows.reduce((s, c) => s + c.g.reduce((t, x) => t + x.kinds.length, 0), 0)
  console.log(`ok ${rows.length}職・${n}枚ぶん・マネキン${fams.length}種 → ${out}（${Math.round(statSync(out).size / 1024)}KB）`)
}
