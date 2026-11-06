// v2cap：画面に出る文が表記ルール（docs/notation-rules.md）に合っているかを見張るテスト（node --test）
// 【確定】2026-11-07 ユーザー「毎回文言調整するの面倒だから、ちゃんとゲーム内の表記ルールは合わせて」
//   ＝新しく書いた文がルールからずれていたら、ここで落ちる（ユーザーに直してもらう前に気づく）。
//   見る所：components・pages・lib・core の文字列と JSX の文（コメント・テスト・確かめ用の fixture・AI への指示 jemitaPrompt は見ない）
//   見る決まり（機械で分かるものだけ。言葉づかいの決まりは docs/notation-rules.md の「v2cap の画面の言葉」）：
//     LV（Lv・Lv. を使わない）／Gold（「ゴールド」は固有名詞だけ）／% と数字の前の + は半角／三点リーダは「…」（「...」を使わない）／
//     矢印は「→」（⇒・-> を使わない）／日本語の文の ！？ は全角（??? は名前の伏せ字なので見ない）／
//     もらう量は「獲得できる◯◯」（「入るEXP」「入るGold」を使わない）／もらった量は項目名が先「Gold +N」（「+N Gold」にしない）／
//     画面の文で通貨を「金貨」と書かない（NPC のセリフは世界観の言葉なので lib の中は見ない）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JP = /[ぁ-んァ-ヶ一-龥]/
const SKIP = /\.test\.js$|\.fixture\.js$|jemitaPrompt\.js$/
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
const filesOf = (dirs) => dirs.flatMap(d => walk(path.join(V2, d))).filter(f => /\.(jsx?|mjs)$/.test(f) && !SKIP.test(f))
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
// 文字列リテラルと JSX の文（日本語か Gold・Lv・EXP を含むもの）
export const textsOf = (src0) => {
  const src = stripComments(src0.replace(/\r\n/g, '\n'))
  const out = []
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}]*)</g
  let m
  while ((m = re.exec(src))) {
    const s = m[1] ?? m[2] ?? m[3] ?? m[4]
    if (s && (JP.test(s) || /Gold|Lv|EXP/.test(s))) out.push({ s, line: src.slice(0, m.index).split(/\r?\n/).length })
  }
  return out
}
const RULES = [
  { name: 'LV（Lv・Lv. は使わない）', bad: (s) => /Lv\.?\s?\d|Lv\./.test(s) },
  { name: 'Gold（「ゴールド」は固有名詞だけ）', bad: (s) => /ゴールド(?!ブレード|ダンジョン)/.test(s) },
  { name: '% と数字の前の + は半角', bad: (s) => /％|＋(?=\s?\d)/.test(s) },
  { name: '三点リーダは「…」', bad: (s) => JP.test(s) && /\.\.\.(?![a-zA-Z_$])/.test(s) },
  { name: '矢印は「→」', bad: (s) => JP.test(s) && /⇒|->/.test(s) },
  { name: '日本語の文の ！？ は全角', bad: (s) => /[ぁ-んァ-ヶ一-龥ー）」]\s?[!?]/.test(s.replace(/\?\?\?/g, '')) },
  { name: 'もらう量は「獲得できる◯◯」', bad: (s) => /入る(EXP|Gold)/.test(s) },
  { name: 'もらった量は「Gold +N」', bad: (s) => /\+\$\{[^}]*\}\s?Gold|\+[\d,]+\s?Gold/.test(s) },
]
const SCREEN_RULES = [
  { name: '画面の文で通貨を「金貨」と書かない（Gold）', bad: (s) => /金貨/.test(s) },
]
const violationsOf = (files, rules) => files.flatMap(f => textsOf(readFileSync(f, 'utf8'))
  .flatMap(({ s, line }) => rules.filter(r => r.bad(s)).map(r => `${r.name}：${path.relative(V2, f)}:${line}「${s.replace(/\s+/g, ' ').slice(0, 60)}」`)))

test('【確定】2026-11-07 画面に出る文は表記ルールどおり（LV・Gold・半角の%+・…・→・全角の！？・獲得できる◯◯・Gold +N）', () => {
  const bad = violationsOf(filesOf(['components', 'pages', 'lib', 'core']), RULES)
  assert.deepEqual(bad, [], `表記ルールからずれた文（docs/notation-rules.md）：\n${bad.join('\n')}`)
})

test('【確定】2026-11-07 画面の文では通貨を「金貨」と書かない（NPC のセリフは世界観の言葉なので見ない）', () => {
  const bad = violationsOf(filesOf(['components', 'pages']), SCREEN_RULES)
  assert.deepEqual(bad, [], bad.join('\n'))
})

test('見張りの道具そのもの：ずれた文を見つけて、ルールどおりの文は通す', () => {
  const hit = (s) => RULES.concat(SCREEN_RULES).filter(r => r.bad(s)).map(r => r.name)
  for (const s of ['Lv30', '100ゴールド', '与ダメ＋15％', '読み込み中...', '強化⇒+5', '完成!', '入るEXP', '+${n} Gold', 'こぼれる金貨']) assert.ok(hit(s).length > 0, `見つける：${s}`)
  for (const s of ['LV30', 'ゴールドダンジョン', '与ダメ+15%', 'STR×0.3＋INT×0.3', '読み込み中…', '強化→+5', '完成！', '名前もLVも ???', '獲得できるEXP', 'Gold +${n}', '{...props}']) assert.deepEqual(hit(s), [], `通す：${s}`)
})
