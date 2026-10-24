// v2cap：ポップアップのあとに画面のいちばん上へ戻す決まり（node --test）
// 【確定】2026-10-25 ユーザー指示「ポップアップ後の操作が全部この仕様（その場のまま）になってるから、基本的に画面遷移したら画面上部に移動するようにして」
//   ・操作のポップアップ（確認で「実行」を押したもの・結果）が閉じたら上へ戻す（V2Modal）。「やめる」はその場のまま
//   ・見るだけのポップアップ（HELP・図鑑の詳しい情報・出撃オプション）は keepScroll で今の場所のまま
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const MODAL = read('components/V2Modal.jsx')

test('V2Modal：閉じたら上へ戻す（確認は「実行」を押したときだけ・keepScroll なら戻さない）', () => {
  assert.ok(MODAL.includes('keepScroll = false'), 'keepScroll を受け取る')
  assert.ok(MODAL.includes("if (!keep.current && (!isConfirm.current || acted.current)) window.scrollTo(0, 0)"), '消えるときに上へ')
  assert.ok(MODAL.includes('const confirm = () => { acted.current = true; onConfirm?.() }'), '「実行」を押したことを覚える')
  assert.ok(MODAL.includes('<button onClick={confirm}'), '実行のボタンは confirm を通す')
  assert.ok(!MODAL.includes('<button onClick={onConfirm}'), '直接 onConfirm を呼ばない（押したことが残らない）')
})

test('見るだけのポップアップは keepScroll（HELP は全部・図鑑の詳しい情報・出撃オプション）', () => {
  const dir = new URL('../components/', import.meta.url)
  const files = readdirSync(dir).filter(f => f.endsWith('.jsx'))
  let helps = 0
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n')
    for (const m of src.matchAll(/<V2Modal\b[^>]*>/g)) {
      if (m[0].includes('HELP')) { helps++; assert.ok(m[0].includes('keepScroll'), `${f}：${m[0].slice(0, 60)}`) }
    }
  }
  assert.ok(helps >= 3, 'HELP のポップアップが見つかる')
  assert.ok(/<V2Modal title=\{title\} color=\{role\.color\} keepScroll/.test(read('components/V2capDex.jsx')), '図鑑の詳しい情報')
  assert.ok(read('components/V2capSortie.jsx').includes('<V2Modal title="⚙ 出撃オプション" color="#7fa6d0" keepScroll'), '出撃オプション')
})

test('宝樹の天啓の演出も、閉じたら上へ戻す', () => {
  assert.ok(read('components/V2capTree.jsx').includes('onClose={() => { setFx(null); window.scrollTo(0, 0) }}'))
})

test('開発用の「いらっしゃいませーを見る」は管理者だけ（ニャーガーキング）', () => {
  assert.ok(read('pages/V2capHome.jsx').includes("{screen === 'burger' && <V2capBurger prof={prof} onProfile={refresh} dev={isAdmin} />}"))
  const burger = read('components/V2capBurger.jsx')
  assert.ok(burger.includes('{dev && ('), 'dev のときだけ出す')
  assert.ok(burger.includes("onClick={() => setWelcome(true)}"), '押すと全画面を出す（サーバーには聞かない）')
})
