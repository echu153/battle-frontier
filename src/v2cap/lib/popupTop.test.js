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
  assert.ok(burger.includes("onClick={() => setWelcome(pickLine('welcome').text)}"), '押すと全画面を出す（サーバーには聞かない）')
})

test('その日の「いらっしゃいませー！」は店の画面より先（ホームの上）に出し、閉じたら店の画面へ', () => {
  // 【確定】2026-10-26 ユーザー指示「先に通常の画面開いてから演出入るから少し違和感、しっかり演出入ってからページ遷移するようにしてほしい」
  const home = read('pages/V2capHome.jsx')
  assert.ok(home.includes('onPick={pickScreen}'), 'メニューは pickScreen を通す')
  assert.ok(home.includes("if (key === 'burger' && burgerWelcomeDue(prof)) { markBurgerWelcome(); setBurgerWelcome(pickLine('welcome').text); return }"),
    'その日はじめてなら店の画面へ行かずに先に出す（返事は待たない）')
  assert.ok(home.includes("const closeBurgerWelcome = () => { setBurgerWelcome(null); setScreen('burger') }"), '閉じたら店の画面へ')
  assert.ok(home.includes('{burgerWelcome && <V2capClerkWelcome line={burgerWelcome} onClose={closeBurgerWelcome} />}'), 'ホームの上に出す')
  const burger = read('components/V2capBurger.jsx')
  assert.equal(burger.match(/rpc\('v2cap_burger_welcome'\)/g).length, 1, '印を付けるのは markBurgerWelcome だけ（店を開いてから聞き直さない）')
  assert.ok(!/welcomeAsker|setWelcome\(true\)/.test(burger), '店の画面が開いてから重ねない')
  // ホームの上でも見た目が崩れないように、全身の絵の CSS は V2capClerkWelcome が自分で持つ
  const clerk = read('components/V2capClerk.jsx')
  assert.ok(clerk.includes('<style>{WELCOME_CSS}</style>'))
  assert.ok(!clerk.slice(0, clerk.indexOf('const WELCOME_CSS')).includes('.nk-welcome {'), 'CLERK_CSS には入れない')
})
