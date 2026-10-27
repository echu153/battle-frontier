// v2cap：賭博場の画面の並び（スクロールしないで遊べる）を固定するテスト（node --test）
// 【2026-10-27】ユーザー指示「スマホのルーレットも、スクロールなしで回せるように詰めて」
//   （同じ日の「イラスト作ったせいでスクロールしないとルーレットとかできなくなった」の続き。アレアの帯の決まりは alea.test.js）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const ROULETTE = read('components/V2capRoulette.jsx')

test('スマホのルーレット：ホイールは回している間だけ画面の真ん中に大きく出す（前は盤の上に 260px で置いていた）', () => {
  assert.ok(read('components/casinoParts.jsx').includes("export const NARROW_QUERY = '(max-width: 620px)'") && ROULETTE.includes('const narrow = useNarrow()'), 'スマホの並びに切り替える幅（2026-10-28 ポーカーと共通の useNarrow へ移した）')
  assert.ok(ROULETTE.includes('if (narrow) setWheelOpen(true)\n    await spinWheel(data.result, 5200)'), '雷のあと、回し始めるときに出す')
  assert.ok(ROULETTE.includes('if (narrow) setTimeout(() => setWheelOpen(false), 1400)'), '出た数字を少し見せてから閉じる')
  assert.ok(ROULETTE.includes("onClick={() => { if (!busy) setWheelOpen(false) }}"), '止まったあとは押しても閉じる')
  // 当たりの演出（CasinoFxLayer の banner＝zIndex 420）より下に出す＝大当たりのときは演出が上に来る
  assert.ok(ROULETTE.includes("position:'fixed', inset:0, zIndex:380"))
  assert.ok(read('components/CasinoFxLayer.jsx').includes("position:'fixed', inset:0, zIndex:420"))
})

test('スマホのルーレット：盤の行は枠ごと26px・出た数字と合計は盤の上の1行・チップと SPIN は1行・ほかのボタンはその下の1行', () => {
  assert.ok(ROULETTE.includes('minHeight: narrow ? 26 : 38,') && ROULETTE.includes("boxSizing: narrow ? 'border-box' : undefined,"), '盤のマスの高さ（前は 30px＋枠）')
  const phone = ROULETTE.slice(ROULETTE.indexOf('if (narrow) {\n    const big'), ROULETTE.indexOf('const wheelSize = 300'))
  assert.ok(phone.includes('{histDots(10, 17)}') && phone.includes('{totalText}'), '上の1行')
  assert.ok(/\{chipBtns\(32\)\}\s*\{spinBtn\(\{ flex:'1 1 auto'/.test(phone), 'チップと SPIN は同じ行')
  assert.ok(phone.includes('{actionBtns}</div>'), '1つ戻す・クリア・前回と同じ・×2 はその下の1行')
  assert.ok(!phone.includes('<Wheel wheelDeg={wheel.w} ballDeg={wheel.b} ballR={wheel.r} result={busy ? null : result} lucky={lucky} size={wheelSize} />'), 'ふだんの並びにホイールを置かない')
})

test('【2026-10-27】ルーレットの決まりの説明は ❓ HELP（ユーザー指示「ここはHELPで」）：盤の下には出さない・見るだけのポップアップ', () => {
  assert.ok(ROULETTE.includes('<V2Modal title="❓ HELP" color={CASINO.gold} keepScroll onClose={() => setHelp(false)}>'))
  assert.equal(ROULETTE.split('1点 {ROULETTE_STRAIGHT}倍').length - 1, 1, '説明の文は HELP の中の1か所だけ')
  const notes = ROULETTE.slice(ROULETTE.indexOf('const notes = ('), ROULETTE.indexOf('const helpBtn'))
  assert.ok(!/倍|雷|右クリック/.test(notes), '盤の下（notes）に決まりの説明を出さない')
  // ボタンは合計の横（スマホは盤の上の1行・広い画面はチップの行の右端）
  assert.ok(ROULETTE.includes('{totalText}\n          {helpBtn}'))
  assert.ok(ROULETTE.includes("<span style={{ marginLeft:'auto' }}>{helpBtn}</span>"))
})

test('【2026-10-27】スロットの遊び方も ❓ HELP（ユーザー指示「スロットの『▼ 遊び方』も HELP にして」）：上の段の右端・開いている間はキーで回さない', () => {
  const slot = read('components/V2capSlot.jsx')
  assert.ok(slot.includes('<V2Modal title="❓ HELP" color={CASINO.gold} keepScroll onClose={() => setHelp(false)}>'))
  assert.ok(!slot.includes("{help ? '▲ 遊び方を閉じる' : '▼ 遊び方'}") && !slot.includes("useStored('capSlotHelp'"), '前の開け閉めの説明は外した')
  assert.ok(slot.includes("<button type=\"button\" onClick={() => setHelp(true)} style={miniBtn('#88aaff')}>❓ HELP</button>"))
  assert.ok(slot.includes('handlers.current = { lever, stop: stopReel, active: active && !help }'), 'HELP を開いている間はスペースキーでレバーを引かない')
  // 中身は前の「▼ 遊び方」と同じ（払い出しの表・CZ・AT・中段チェリー・予告・キーボード）
  for (const s of ['払い出し（×1のとき）', 'SLOT_ROLES.filter(r => r.key !== \'miss\')', '上乗せ特化ゾーン', 'フリーズ＝AT確定', '虹（AT確定）', 'スペース＝レバー']) assert.ok(slot.includes(s), s)
})

test('広い画面のルーレットは前のまま（ホイール300pxと盤を横に並べる・チップ38px・SPIN は横いっぱい）', () => {
  const wide = ROULETTE.slice(ROULETTE.indexOf('const wheelSize = 300'))
  assert.ok(wide.includes('size={wheelSize} />') && wide.includes('{histDots(15, 20)}'))
  assert.ok(wide.includes('{chipBtns(38)}') && wide.includes("{spinBtn({ width:'100%', marginTop:'10px' })}"))
  assert.ok(wide.includes("<div style={{ flex:'1 1 360px', minWidth:0 }}>"), '盤のほうは 360px から（ホイールと横に並ぶのは約680px から）')
})

test('【2026-10-28】タブはスマホでも1段（480px 以下は頭の絵文字を外す・🔒 は残す）・ディーラーと勝負するゲームは「テーブル」の中で切り替える', () => {
  const casino = read('components/V2capCasino.jsx')
  // ポーカーを足して6つにすると 375px で2段になり、ルーレットが画面の下へ押される＝ブラックジャックとポーカーは「テーブル」にまとめた
  const tabs = casino.slice(casino.indexOf('const TABS = ['), casino.indexOf('// テーブルの中の卓'))
  assert.equal((tabs.match(/\{ key:'/g) || []).length, 5, 'タブは5つ')
  assert.ok(tabs.includes("{ key:'table',    icon:'♠',  label:'テーブル' },"))
  assert.ok(casino.includes("{ key:'bj',    icon:'♠', label:'ブラックジャック' },") && casino.includes("{ key:'poker', icon:'♦', label:'ポーカー' },"))
  assert.ok(casino.includes("const TAB_CSS = '@media (max-width: 480px) { .cs-tab-ico { display: none } }'"))
  assert.ok(casino.includes(`{locked ? '🔒 ' : <span className="cs-tab-ico">{t.icon} </span>}{t.label}`), '🔒 は狭い画面でも外さない')
  assert.ok(casino.includes("const tab = tabStored === 'bj' ? 'table' : tabStored"), '前に「BJ」タブを開いていた端末はテーブルへ')
  assert.ok(casino.includes("{tab === 'table' && !isUnlocked(table, money.won) && lockedPanel(unlockOf(table))}"), 'まだ遊べない卓は何枚で遊べるか')
  assert.ok(casino.includes("{isUnlocked('bj', money.won) && (") && casino.includes('<V2capBlackjack init={state.bj}'), '解禁してから卓を置く')
  assert.ok(casino.includes("{isUnlocked('poker', money.won) && (") && casino.includes('<V2capPoker init={state.poker}'))
})

test('【2026-10-28】ポーカー：決まりの説明は ❓ HELP・ディーラーの2〜5枚目は伏せて置く・勝負したら1枚ずつめくる', () => {
  const poker = read('components/V2capPoker.jsx')
  assert.ok(poker.includes('<V2Modal title="❓ HELP" color={CASINO.gold} keepScroll onClose={() => setHelp(false)}>'))
  assert.ok(poker.includes('await place(setDealer, k === 0 ? data.dealer[0] : null, k > 0)'), 'ディーラーは1枚目だけ表（サーバーも1枚目しか返さない）')
  assert.ok(poker.includes("await reveal(data.dealer, action === 'raise')"))
  assert.ok(poker.includes('if (medals < ante * (1 + POKER_RAISE_MULT))'), '配るときにアンティの3倍が要る（サーバーと同じ）')
})

test('【2026-10-28】ポーカーの1枚交換とディーラーの7枚（ユーザー選択「7枚から5枚」「参加料」）：タップでえらんで交換・使わない2枚は暗く・画面ではアンティを「参加料」', () => {
  const poker = read('components/V2capPoker.jsx')
  assert.ok(poker.includes("onClick={canPick ? () => setSel(s => (s === k ? null : k)) : undefined}"), '自分のカードをタップでえらぶ（もう一度で外す）')
  assert.ok(poker.includes("const canPick = round.active && !round.swapped && !busy"), '交換は1回だけ')
  assert.ok(poker.includes("supabase.rpc('v2cap_poker_swap', { p_index: sel })"))
  assert.ok(poker.includes('dim={best ? !best.includes(x.c) : false}'), 'いちばん強い5枚に入らない2枚は暗く')
  assert.ok(poker.includes("const DEALER_W = { narrow: 42, wide: 52 }") && poker.includes('const narrow = useNarrow()'), 'スマホはディーラーの7枚を小さく')
  // 画面の文字に「アンティ」を出さない（HELP の「アンティともいう」だけ）
  const shown = poker.replace(/\/\/[^\n]*/g, '').replace('参加料（アンティともいう）', '')
  assert.ok(!/アンティ/.test(shown.replace(/ante|Ante|ANTE/g, '')), '画面の言い方は参加料')
  assert.ok(poker.includes('🃏 参加料 {fmt(anteSel)}枚 賭けて配る'))
  // 配っている途中（2〜4枚）で役を数えない（ペアの途中で pkScoreOf が止まって画面が落ちた）
  assert.ok(poker.includes('const openCards = (cards, n) => (cards.length === n &&'))
  assert.ok(poker.includes('openCards(dealer, POKER_DEALER_CARDS)') && poker.includes('openCards(player, 5)'))
})

test('【2026-10-28】ブラックジャック：決まりの説明は ❓ HELP・アレアの2枚目は伏せて置く・解禁の演出は当たりの演出を閉じてから', () => {
  const bj = read('components/V2capBlackjack.jsx')
  assert.ok(bj.includes('<V2Modal title="❓ HELP" color={CASINO.gold} keepScroll onClose={() => setHelp(false)}>'))
  assert.ok(bj.includes('await place(setDealer, data.dealer[1] ?? null, true)'), '伏せたカード（決着したときだけ中身が来る）')
  const layer = read('components/CasinoFxLayer.jsx')
  assert.ok(layer.includes('if (d.wait && bannerOn.current) waiting.current.push({ ...d, key })'))
  assert.ok(layer.includes('{banner.amount != null && ('), '解禁の演出には枚数を出さない')
  assert.ok(read('components/casinoFx.js').includes("tier: UNLOCK_TIER, amount: null, title, sub, say, wait: true,"))
})
