// ============================================================
// v2cap ジェミータの資料を作り直す
//   node tools/v2cap-jemita-kb.mjs
// ・supabase_v2cap_jemita_kb.sql（サーバーの表 v2cap_jemita_kb へ入れる SQL・ユーザーが流す）
// ・src/v2cap/lib/jemitaKbVersion.js（画面が知っている資料の版。サーバーの版と違えば管理者に「資料が古い」と出す）
// を書く。ゲームのデータ（職業・技・エリア・敵・装備・施設）か、ジェミータの決まり（jemitaPrompt.js）を変えたら流す
// （流さないと src/v2cap/lib/jemitaKb.test.js が落ちる）
// ============================================================
import { writeFileSync } from 'node:fs'
import { buildJemitaKb, buildJemitaSql, jemitaVersionOf } from '../src/v2cap/lib/jemitaKb.js'
import { JEMITA_RULES } from '../src/v2cap/lib/jemitaPrompt.js'

const body = buildJemitaKb()
const version = jemitaVersionOf(JEMITA_RULES, body)
const sqlUrl = new URL('../supabase_v2cap_jemita_kb.sql', import.meta.url)
const verUrl = new URL('../src/v2cap/lib/jemitaKbVersion.js', import.meta.url)
writeFileSync(sqlUrl, buildJemitaSql(JEMITA_RULES, body))
writeFileSync(verUrl, [
  '// 自動で作ったファイル（node tools/v2cap-jemita-kb.mjs）。手で直さない',
  '// ジェミータの資料と決まりの版。サーバーの表 v2cap_jemita_kb の version と同じなら、資料の SQL は流してある',
  `export const JEMITA_KB_VERSION = '${version}'`,
  '',
].join('\n'))
console.log(`版 ${version}・決まり ${JEMITA_RULES.length.toLocaleString()}字・資料 ${body.length.toLocaleString()}字`)
console.log('→ supabase_v2cap_jemita_kb.sql と src/v2cap/lib/jemitaKbVersion.js を書いた（SQL はユーザーが流す）')
