// v2cap：装備画面の見せ方（2026-10-14 ユーザー指示）が戻らないように：node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// コメント（/* */ と //）を外した中身
const codeOf = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const EQUIP = codeOf('../components/V2capEquip.jsx')
const GEAR = codeOf('../components/v2capGear.jsx')
const SMITH = codeOf('../components/V2capSmith.jsx')
const HOME = codeOf('../pages/V2capHome.jsx')

test('【確定】装備中の説明文（装備できる武器・重鎧と軽装・必要LV・強化の説明）は出さない', () => {
  assert.ok(!/装備できる武器は/.test(EQUIP), '装備できる武器の説明は出さない')
  assert.ok(!/を部位ごとに選べます/.test(EQUIP), '重鎧と軽装の説明は出さない')
  assert.ok(!/鍛冶屋で行います/.test(EQUIP), '強化・分解・作成の説明は出さない')
})

test('【確定】装備中の行にLVは出さない・持っている装備の右は「要求レベル〇LV」', () => {
  assert.ok(!/needLvOf\(w\.item/.test(EQUIP), '装備中の行（w.item）に必要LVを出さない')
  assert.ok(/>要求レベル\{needLvOf\(item, inv\.ilv\)\}LV</.test(EQUIP), '持っている装備の右は「要求レベル〇LV」')
  assert.ok(!/>LV\{needLvOf/.test(EQUIP), '「LV〇」の書き方は使わない')
})

test('【確定】鍛冶屋の一覧（強化・分解・作成）の右も「要求レベル〇LV」（ユーザーが装備画面にそろえるを選んだ・確認の画面の「（LV〇）」はそのまま）', () => {
  assert.ok(/>要求レベル\{needLvOf\(item, inv\.ilv\)\}LV</.test(SMITH), '強化・分解の一覧（ItemHead）')
  assert.ok(/>要求レベル\{needLvOf\(item\)\}LV</.test(SMITH), '作成の一覧')
  assert.ok(!/>LV\{needLvOf/.test(SMITH), '一覧の右に「LV〇」の書き方は使わない')
})

test('【確定】絞り込みは 部位・レア度・エリア の3つのプルダウンを横並び（ボタンの列に戻さない）', () => {
  const bar = GEAR.slice(GEAR.indexOf('export function GearFilterBar'))
  const selects = [...bar.matchAll(/<select value=\{g\.(\w+)\}/g)].map(m => m[1])
  assert.deepEqual(selects, ['part', 'rarity', 'area'])
  assert.ok(!/onClick=\{\(\) => g\.set(Part|Rarity)\(/.test(bar), '部位・レア度はボタンにしない')
})

test('【確定】鍛冶屋の作成の選び方も 部位・レア度・エリア の3つのプルダウンを横並び（2026-10-14 ユーザー指示「作成もプルダウンの横並びで」）', () => {
  const start = SMITH.indexOf('function CraftTab')
  const craft = SMITH.slice(start, SMITH.indexOf('\nfunction ', start + 1))
  const selects = [...craft.matchAll(/<select value=\{(\w+)\}/g)].map(m => m[1])
  assert.deepEqual(selects, ['part', 'rarity', 'area'])
  assert.ok(!/onClick=\{\(\) => set(Part|Rarity|Area)\(/.test(craft), '部位・レア度・エリアはボタンにしない')
})

test('【確定】画面を切り替えたら一番上から見せる（2026-10-14 ユーザー指示「装備押すと中途半端なところで遷移する、一番上で遷移するようにして」）', () => {
  assert.ok(/useLayoutEffect\(\(\) => \{ window\.scrollTo\(0, 0\) \}, \[screen\]\)/.test(HOME),
    'V2capHome：screen が変わったら描く前に window を一番上へ戻す')
})

test('【確定】2026-10-26 装備のお気に入り：★で付け外し（装備画面と鍛冶屋）・並べ替えの「お気に入り」で上に・分解できない', async () => {
  // ユーザー指示「装備にお気に入りできるようにして、お気に入りのソートもできるように。お気に入りされた武器は分解できないように」
  const { gearSorter } = await import('../components/v2capGearView.js')
  const { ITEMS } = await import('./equipment.js')
  const weak = ITEMS.find(i => i.area === 1 && i.rarity === 'N'), strong = ITEMS.find(i => i.area === 5 && i.rarity === 'E')
  const row = (id, item, fav) => ({ inv: { id, ilv: item.lv, plus: 0, fav }, item })
  const rows = [row(1, strong, false), row(2, weak, true), row(3, strong, true), row(4, weak, false)]
  assert.deepEqual([...rows].sort(gearSorter('fav', 99)).map(r => r.inv.id), [3, 2, 1, 4], 'お気に入りを上に・その中は強い順')
  assert.deepEqual([...rows].sort(gearSorter('power', 99)).map(r => r.inv.id), [1, 3, 2, 4], '強い順はお気に入りと関係なし')
  assert.ok(GEAR.includes("['fav', 'お気に入り']"), '並べ替えの帯に「お気に入り」')
  assert.ok(GEAR.includes("style={{ ...miniBtn(inv?.fav ? '#ffcc00' : '#62789a'), color: inv?.fav ? '#ffcc00' : '#445566', padding:'2px 5px', flexShrink:0 }}>★</button>"), 'スキルのお気に入りと同じ★')
  assert.ok(EQUIP.includes('<FavStar inv={inv} busy={busy} onToggle={toggleFav} />'), '装備画面の持ち物')
  assert.equal((SMITH.match(/star=\{<FavStar inv=\{inv\} busy=\{busy\} onToggle=\{toggleFav\} \/>\}/g) || []).length, 2, '鍛冶屋の強化と分解の一覧')
  for (const code of [EQUIP, SMITH]) assert.ok(code.includes("call('v2cap_gear_fav', { p_inv: inv.id, p_fav: !inv.fav })"), 'サーバーで覚える')
  // 分解：お気に入りはチェックも分解のボタンも出さない・選んだ行からも外す
  assert.ok(SMITH.includes('disabled={isWorn || isFav || busy}'))
  assert.ok(SMITH.includes('お気に入りは分解できない'))
  assert.ok(SMITH.includes('&& !r.inv.fav)'))
})

test('【確定】2026-10-26 鍛冶屋の説明はタブの下に出さず ❓ HELP にまとめる・作成の結果の言葉', () => {
  // ユーザー指示「ここの説明はHELPにまとめて、強化分解作成すべてここの部分いらない」
  assert.ok(!SMITH.includes('TABS.find(t => t.key === tab)'), 'タブの下の説明は出さない')
  assert.ok(/<V2Modal title="❓ HELP" color="#ffaa44" keepScroll onClose=\{\(\) => setHelp\(false\)\}>/.test(SMITH), 'HELP は見るだけのポップアップ（keepScroll）')
  assert.ok(SMITH.includes('{TABS.map((t, i) => (') && SMITH.includes('<div>{t.help}</div>'), '強化・分解・作成の説明を全部')
  assert.ok(SMITH.includes('<div>{FAV_HELP}</div>'), 'お気に入りの説明も')
  // 作成の結果（ユーザー指示「今は要求レベル不足⇒要求Lv不足・+0で持ち物に入りました←この部分いらない・続けて作る⇒続けて作成」。LV は表記ルールどおり大文字）
  const fx = codeOf('../components/V2capCraftFx.jsx')
  assert.ok(fx.includes('（{job.sync}）') && !fx.includes('いまは'))
  assert.ok(!fx.includes('+0で持ち物に入りました'))
  assert.ok(SMITH.includes('`続けて作成（あと${againTimes}個）`') && !SMITH.includes('続けて作る'))
})
