// v2cap：画面の文言をゲームらしく保つテスト（node --test）
// 【確定】2026-11-06 ユーザー指示「割り振れるステータスポイントが〇あります見たいにしてほしい
//   あとたまにこういう機械的な内容あるから、ちゃんとゲームぽく作成、落とし込んで」
//   ・「〜が N あります（振る）」のように、押すと何が起きるかをかっこで添える書き方はしない（ボタンの枠で押せると分かる）
//   ・作り手のメモ（「あとで作ります」など）を画面に出さない
//   ・ユーザーが選んだ言い方（「恒久的に反映されます」「食事適用中」「（AM 5：00更新）」など）はそのまま＝ここでは見張らない
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const dirOf = (rel) => new URL(`../${rel}/`, import.meta.url)
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// 画面のファイル（components と pages）を、コメントを外して読む
const screens = () => ['components', 'pages'].flatMap(d => readdirSync(dirOf(d))
  .filter(f => /\.jsx?$/.test(f) && !/test/.test(f))
  .map(f => ({ f: `${d}/${f}`, src: read(`${d}/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1') })))

test('【確定】2026-11-06 ステータスポイントのボタンは「割り振れるステータスポイントが N あります」', () => {
  const pt = screens().find(s => s.f === 'components/V2capPoints.jsx').src
  assert.ok(pt.includes('🔺 割り振れるステータスポイントが {have} あります'), 'ユーザーの言い方')
  assert.ok(pt.includes('title="ステータスポイントを割り振る"'), '小窓の題も同じ言葉')
  assert.ok(!pt.includes('あります（振る）'), '前の機械的な書き方')
})

test('【確定】2026-11-06 画面の文に「（振る）」のような押したときの動きのかっこ書きを付けない', () => {
  for (const { f, src } of screens()) {
    assert.ok(!/あります（[^）]{1,6}）/.test(src), `${f}：「〜あります（動き）」の書き方`)
    assert.ok(!src.includes('（振る）'), `${f}：（振る）`)
  }
})

test('【確定】2026-11-06 作り手のメモや処理の言葉を画面に出さない', () => {
  for (const { f, src } of screens()) {
    assert.ok(!src.includes('あとで作ります'), `${f}：あとで作ります`)
  }
  assert.ok(!read('components/V2Modal.jsx').includes("'処理中...'") && read('components/V2Modal.jsx').includes("'通信中…'"), '確かめの小窓の待ち時間は「通信中…」')
})
