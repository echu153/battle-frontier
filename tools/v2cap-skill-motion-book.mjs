// ============================================================
// v2cap ATB の「技の種類ごとのモーション」のプロンプト帳（1枚の HTML）を作る
// ------------------------------------------------------------
// 【確定】2026-11-11 ユーザー選択「技の種類ごと」・ユーザー「マネキンいらないだろ」＝待機の1コマ目1枚＋言葉で頼む（決まりは tools/v2cap-skill-motion/plan.mjs）
// 1行＝クラス×男女×技の種類（その職業が ATB で使う技＝系統の技ぜんぶの種類）。頼む文（plan.mjs の promptOf）と
//   ファイル名（<クラス名><男|女><物理|魔法|補助|回復>.png）を出す。作成済み＝画面に入った絵（src/v2cap/lib/motionArtList.js にその動きがある）
// 使い方：node tools/v2cap-skill-motion-book.mjs [書き出す先.html]（既定は scratchpad など手元の好きな所を渡す）
//   公開＝ https://claude.ai/artifact/5oHR7qdGx3xgn6XpFt6pKq（作り直したら同じ url へ）
//   待機の1コマ目：public/V2newjob/gif/<ローマ字>-<m|f>.gif の1コマ目を2倍（ドットのまま）
// ★ffmpeg を使う
// ============================================================
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ART_BASE, GIF_OUT } from '../src/v2cap/lib/classArt.js'
import { CLASS_BY_ID, lineageOf } from '../src/v2cap/lib/jobs.js'
import { SKILLS } from '../src/v2cap/lib/skills.js'
import { MOTION_KEYS } from '../src/v2cap/lib/motionArt.js'
import { MOTION_ART } from '../src/v2cap/lib/motionArtList.js'
import { KIND_FILE, KIND_LABEL, gearOf, kindMotionOf, promptOf } from './v2cap-skill-motion/plan.mjs'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..')
const TEMPLATE = path.join(ROOT, 'tools', 'v2cap-skill-motion', 'book.template.html')
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
      kind, label: KIND_LABEL[kind], act: kindMotionOf(cls, g, kind).b,
      file: fileOf(cls, g, kind), prompt: promptOf(cls, g, kind), done: !!MOTION_ART[cls]?.[g]?.[MOTION_KEYS[KIND_FILE[kind]]],
    })),
  })),
}))

const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`
const idleFrame = (cls, g) => execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(ROOT, 'public', 'V2newjob', GIF_OUT, `${ART_BASE[cls]}-${g}.gif`),
  '-frames:v', '1', '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 1 << 26 })

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  if (!process.argv[2]) { console.log('書き出す先の .html を渡してください'); process.exit(1) }
  const out = path.resolve(process.argv[2])
  const rows = bookRows()
  const data = rows.map(c => ({ ...c, g: c.g.map(x => ({ ...x, img: dataUrl(idleFrame(c.cls, x.g)) })) }))
  writeFileSync(out, readFileSync(TEMPLATE, 'utf8').replace('/*__DATA__*/null', JSON.stringify(data)))
  const n = rows.reduce((s, c) => s + c.g.reduce((t, x) => t + x.kinds.length, 0), 0)
  console.log(`ok ${rows.length}職・${n}枚ぶん → ${out}（${Math.round(statSync(out).size / 1024)}KB）`)
}
