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
  // 押した瞬間に変えて、サーバーには後ろで送る（同じ日 ユーザー指示「お気に入り押しても登録されるまでラグがある」）
  for (const code of [EQUIP, SMITH]) {
    assert.ok(code.includes('useFavToggle({ save: saveGearFav, refresh: () => onProfile(null), onError: setError })'), 'サーバーで覚える（待たない）')
    assert.ok(code.includes('withFavs(inventory, fav.over)'), '押したあとの値で一覧を作る')
    assert.ok(!code.includes("call('v2cap_gear_fav'"), '前の形（返事と読み直しを待つ）に戻さない')
  }
  assert.ok(codeOf('../components/v2capGearFav.js').includes("supabase.rpc('v2cap_gear_fav', { p_inv: id, p_fav: on })"))
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
  // 作成の確認の画面も「+0で持ち物に入ります。」は出さない（同じ日 ユーザー指示）。HELP の説明には残す
  assert.ok(SMITH.includes(">必ずできます。</div>") && !SMITH.includes('必ずできます。+0で持ち物に入ります。'))
  assert.ok(SMITH.includes('`続けて作成（あと${againTimes}個）`') && !SMITH.includes('続けて作る'))
})

test('【確定】2026-10-26 お気に入りの★は押した瞬間に変わる・サーバーには順番に送る・全部送ったら1回だけ読み直す・失敗したら戻す', async () => {
  // ユーザー指示「お気に入り押しても登録されるまでラグがある、この遅さはさすがに看過できん」
  const { makeFavSender, withFavs } = await import('../components/v2capGearView.js')
  const log = []
  let over = {}
  const fails = new Set()
  const sent = []
  const send = makeFavSender({
    apply: (id, v) => { over = { ...over, [id]: v }; log.push(`画面 ${id}=${v}`) },
    save: async (id, on) => { sent.push(`${id}=${on}`); await new Promise(r => setTimeout(r, 5)); return fails.has(`${id}=${on}`) ? 'だめ' : null },
    refresh: () => log.push('読み直し'),
    onError: (e) => log.push(`失敗 ${e}`),
  })
  const inv = (id) => ({ id, fav: over[id] ?? false })
  const p1 = send(inv(1))                 // ★を付ける
  assert.equal(over[1], true, '押した瞬間に画面が変わる（返事を待たない）')
  const p2 = send(inv(1))                 // すぐ外す（連打）
  const p3 = send(inv(2))
  assert.deepEqual([over[1], over[2]], [false, true])
  await Promise.all([p1, p2, p3])
  assert.deepEqual(sent.filter(s => s.startsWith('1=')), ['1=true', '1=false'], '同じ装備は押した順に送る（最後の値が残る）')
  assert.equal(log.filter(s => s === '読み直し').length, 1, '全部送ったら1回だけ読み直す')
  fails.add('3=true')
  await send(inv(3))
  assert.equal(over[3], false, '送れなかったら元に戻す')
  assert.ok(log.includes('失敗 だめ'))
  assert.deepEqual(withFavs([{ id: 1, fav: false }, { id: 9, fav: true }], { 1: true }), [{ id: 1, fav: true }, { id: 9, fav: true }])
})

test('【確定】2026-10-26 プルダウン：レア度のユニークは持っているときだけ・エリアは行ったことのあるところまで（装備画面と鍛冶屋の全部）', async () => {
  // ユーザー指示「レア度のところ、ユニーク武器1つも手に入れたことないときは表示されないようにして、これは鍛冶屋じゃなくて全部ね、
  //   あとすべてのエリアも行ったことのないエリアは表示されないようにして、これも鍛冶屋にかかわらず全部のプルダウンに適用して」
  const { areaChoicesOf, rarityChoicesOf } = await import('../components/v2capGearView.js')
  const { openAreaOf } = await import('./sortie.js')
  const rows = (...list) => list.map(([area, rarity]) => ({ item: { area, rarity } }))
  assert.deepEqual(rarityChoicesOf(rows([1, 'N'], [2, 'R'])), ['N', 'R', 'E', 'L'], 'ユニークを持っていなければ出さない')
  assert.deepEqual(rarityChoicesOf(rows([1, 'N'], [9, 'U'])), ['N', 'R', 'E', 'L', 'U'], '持っていれば出す')
  assert.deepEqual(rarityChoicesOf(rows([1, 'N']), 'U'), ['N', 'R', 'E', 'L', 'U'], '選んでいるあいだは残す')
  assert.deepEqual(areaChoicesOf(rows([0, 'N'], [1, 'N'], [3, 'R'], [9, 'U']), 3), [0, 1, 3], '行ったことのないエリア（9）は出さない・初期装備（0）は出す')
  assert.deepEqual(areaChoicesOf(rows([1, 'N']), 3, 9), [1, 9], '選んでいるあいだは残す')
  assert.equal(openAreaOf([]), 1)
  // 帯は選択肢を使う・装備画面と鍛冶屋は行ったことのあるエリアを渡す（作成のエリアも同じ数え方）
  assert.ok(GEAR.includes('{g.rarities.map(r =>') && GEAR.includes('{g.areas.map(a =>'))
  assert.ok(EQUIP.includes('useGearRows(all, prof.lv, openAreaOf(prof.cleared_spots))'))
  assert.ok(SMITH.includes('useGearRows(all, prof.lv, openAreaOf(prof.cleared_spots))'))
  assert.ok(SMITH.includes('const maxArea = openAreaOf(prof.cleared_spots)'), '作成のエリアのプルダウン')
})

test('【確定】2026-10-26 鍛冶屋と装備画面の一覧：★は右上・要求LV不足はいまの戦闘力だけ（ステも同じ色）・強化の一覧に「次は」の行なし・素材は1行ずつで Gold が上・失敗の文なし', () => {
  // ユーザー指示「お気に入りのボタンは右上にして」「要求レベル不足してるときはその時の戦闘力だけ書いて、STRとかのステータスも同じ色で表示」
  //   「次は←この行いらない、強化ボタン押したら成功率とか必要素材が表示されればいい」「強化素材は1行ずつ書いて、Goldが一番上になるように」
  //   「失敗すると残骸とGoldはなくなり、強化値はそのままです。←この文言はいらない、Helpにいれて」「強化値はそのまま（+8）←ここいらない」（同じ日 装備画面と作成もそろえる＝ユーザー選択）
  // （codeOf はコメントを外すので、JSX のコメントのあとに {} が残る）
  assert.ok(/要求レベル\{needLvOf\(item, inv\.ilv\)\}LV<\/span>\s*(\{\}\s*)?\{star\}/.test(SMITH), '鍛冶屋：★は要求レベルの右（右上）')
  assert.ok(/要求レベル\{needLvOf\(item, inv\.ilv\)\}LV<\/span>\s*(\{\}\s*)?<FavStar inv=\{inv\} busy=\{busy\} onToggle=\{toggleFav\} \/>/.test(EQUIP), '装備画面：★は右上')
  for (const code of [SMITH, EQUIP]) {
    assert.ok(!/→ \{effectivePowerAt/.test(code), '「288 → 119」の形にしない')
    assert.ok(code.includes("color: sync ? SHORT : TEXT.sub") || code.includes("color: sync ? '#ff8844' : TEXT.sub"), 'ステも同じ色')
  }
  assert.ok(!SMITH.includes('次は <span'), '強化の一覧に「次は」の行を出さない')
  assert.ok(/<Materials label="強化素材" list=\{\[\s*\{ name:'Gold'/.test(SMITH), '強化素材：Gold がいちばん上')
  assert.ok(/<Materials label="作成素材" list=\{\[\s*\{ name:'Gold'/.test(SMITH), '作成素材も Gold がいちばん上')
  assert.equal((SMITH.match(/失敗すると残骸とGoldはなくなり/g) || []).length, 1, '失敗の文は HELP の説明だけ（強化の画面には出さない）')
  assert.ok(!/\}\s*:\s*'ノーマルの装備は残骸を使いません/.test(SMITH))
  const fx = codeOf('../components/V2capEnhanceFx.jsx')
  assert.ok(!fx.includes('強化値はそのまま'), '失敗の結果に「強化値はそのまま（+N）」を出さない')
})
