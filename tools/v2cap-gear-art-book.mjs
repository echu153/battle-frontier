// ============================================================
// v2cap 装備の絵のプロンプト帳（1枚の HTML）を作る
// ------------------------------------------------------------
// 【確定】2026-11-23 ユーザー「まあOK、他の装備もお願い」（1枚目 U01 を見たあと）＝同じ頼み方で残りのシートも頼めるように、
//   107枚ぶんの頼む文（src/v2cap/lib/gearArt.js の gearSheetPromptOf）とファイル名を1ページにまとめる
// 1行＝シート1枚（16個）。入ったシート（src/v2cap/lib/gearArtList.js に全部の絵がある）には印を付ける
// 使い方：node tools/v2cap-gear-art-book.mjs <書き出す先.html>
//   公開＝作り直したら同じ url へ（url は docs/v2cap-design.md 6-22）
// ============================================================
import { writeFileSync } from 'node:fs'
import { GEAR_ART } from '../src/v2cap/lib/gearArtList.js'
import { GEAR_SHEETS, gearArtKeyOf, gearSheetFileOf, gearSheetPromptOf, gearArtProgress } from '../src/v2cap/lib/gearArt.js'

const out = process.argv[2]
if (!out) { console.log('使い方：node tools/v2cap-gear-art-book.mjs <書き出す先.html>'); process.exit(1) }

const GROUPS = [['U', 'ユニーク'], ['C', '四凶の専用装備'], ['L', 'レジェンダリー'], ['E', 'エピック'], ['R', 'レア'], ['N', 'ノーマル'], ['S', '初期装備']]
const data = GEAR_SHEETS.map(s => ({
  id: s.id, file: gearSheetFileOf(s), label: s.label, group: s.id.replace(/[-0-9].*$/, ''),
  names: s.items.map(i => i.name), done: s.items.every(i => GEAR_ART[gearArtKeyOf(i)]), prompt: gearSheetPromptOf(s),
}))
const p = gearArtProgress(GEAR_ART)
const esc = (t) => JSON.stringify(t).replace(/</g, '\\u003c')

const html = `<title>装備の絵 プロンプト帳</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* 配置：上に進み具合と使い方、等級の切り替え、下にシートの札を1列で。札は名前の一覧＋コピーのボタン、開くと頼む文 */
:root {
  --bg: #0b1020; --panel: #121a30; --line: #26324f; --fg: #e6ecf8; --sub: #93a3c2; --accent: #ffd24a; --ok: #58d39a;
  --U: #ff6b82; --C: #ffb25e; --L: #ffe033; --E: #c68bff; --R: #6aa5ff; --N: #aab4be; --S: #8fb6a8;
  --sans: "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", system-ui, sans-serif;
  --mono: "Cascadia Mono", "Consolas", "Menlo", monospace;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) {
  --bg: #f3f5fa; --panel: #ffffff; --line: #d3dae8; --fg: #1a2238; --sub: #5a6784; --accent: #9a6a00; --ok: #17804f;
  --U: #c92846; --C: #a85a00; --L: #8a7300; --E: #7a3fc4; --R: #2360c4; --N: #5c6672; --S: #3f7564; color-scheme: light } }
:root[data-theme="light"] {
  --bg: #f3f5fa; --panel: #ffffff; --line: #d3dae8; --fg: #1a2238; --sub: #5a6784; --accent: #9a6a00; --ok: #17804f;
  --U: #c92846; --C: #a85a00; --L: #8a7300; --E: #7a3fc4; --R: #2360c4; --N: #5c6672; --S: #3f7564; color-scheme: light }
body { background: var(--bg); color: var(--fg); font-family: var(--sans); font-size: 14px; line-height: 1.7 }
.wrap { max-width: 860px; margin: 0 auto; padding-block: 28px 60px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)) }
h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: .04em; text-wrap: balance }
.lead { color: var(--sub); margin: 0 0 16px }
.meter { height: 8px; background: var(--line); margin: 6px 0 4px }
.meter i { display: block; height: 100%; background: var(--ok) }
.count { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--sub); font-size: 12px }
ol.how { margin: 14px 0 20px; padding-left: 1.4em; color: var(--fg) }
ol.how code, .file { font-family: var(--mono); font-size: 12px; background: var(--panel); border: 1px solid var(--line); padding: 1px 6px }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px }
.tabs button { font: inherit; font-size: 12px; background: var(--panel); color: var(--sub); border: 1px solid var(--line); padding: 5px 10px; cursor: pointer }
.tabs button[aria-pressed="true"] { color: var(--fg); border-color: var(--fg) }
.tabs button:focus-visible, .card button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.list { display: grid; gap: 8px }
.card { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--tier); padding: 10px 12px; min-width: 0 }
.head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px }
.head b { color: var(--tier); font-size: 14px }
.head .sp { flex: 1 }
.done { color: var(--ok); font-size: 12px; border: 1px solid var(--ok); padding: 0 6px }
.card.isdone { opacity: .62 }
.names { color: var(--sub); font-size: 12px; margin: 4px 0 6px; overflow-wrap: anywhere }
.card button.copy { font: inherit; font-size: 12px; background: transparent; color: var(--accent); border: 1px solid var(--accent); padding: 3px 12px; cursor: pointer }
.card button.copy.ok { color: var(--ok); border-color: var(--ok) }
details summary { cursor: pointer; color: var(--sub); font-size: 12px }
pre { font-family: var(--mono); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line); padding: 10px; margin: 6px 0 0; user-select: all }
</style>
<div class="wrap">
  <h1>装備の絵 プロンプト帳</h1>
  <p class="lead">バトルフロンティアⅡの装備1,655個を、16個ずつ1枚のシートで描いてもらうための頼む文です。上から珍しい順に並んでいます。</p>
  <div class="meter"><i style="width:${(p.done / p.total * 100).toFixed(2)}%"></i></div>
  <div class="count">絵が入った装備 ${p.done.toLocaleString()} / ${p.total.toLocaleString()}　・　シート ${data.filter(d => d.done).length} / ${data.length} 枚</div>
  <ol class="how">
    <li>「コピー」を押して、ChatGPT の画像生成にそのまま貼る（絵の手本は添えない）</li>
    <li>できた絵が 4列×4段・マゼンタの背景・装備がマスからはみ出していない、を見る</li>
    <li>絵を Claude の会話に貼って、シートの名前（例 <code>U02</code>）を伝える。こちらで切り分けて画面に入れます</li>
  </ol>
  <div class="tabs" id="tabs"></div>
  <div class="list" id="list"></div>
</div>
<script>
const DATA = ${esc(data)}
const GROUPS = ${esc(GROUPS)}
const tabs = document.getElementById('tabs'), list = document.getElementById('list')
let group = 'todo'
try { group = localStorage.getItem('gearBookGroup') || 'todo' } catch (e) {}
const tabDefs = [['todo', 'まだのシート'], ...GROUPS, ['all', '全部']]
const show = (d) => group === 'all' || (group === 'todo' ? !d.done : d.group === group)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const copy = async (btn, text, pre) => {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'コピーしました'; btn.classList.add('ok') }
  catch (e) {
    pre.closest('details').open = true
    const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    btn.textContent = '選びました（Ctrl+C）'
  }
  setTimeout(() => { btn.textContent = 'コピー'; btn.classList.remove('ok') }, 1800)
}
const render = () => {
  tabs.replaceChildren(...tabDefs.map(([k, label]) => {
    const n = DATA.filter(d => k === 'all' || (k === 'todo' ? !d.done : d.group === k)).length
    const b = el('button', '', label + ' ' + n)
    b.type = 'button'; b.setAttribute('aria-pressed', String(group === k))
    b.onclick = () => { group = k; try { localStorage.setItem('gearBookGroup', k) } catch (e) {} ; render() }
    return b
  }))
  const rows = DATA.filter(show)
  list.replaceChildren(...(rows.length ? rows.map(d => {
    const card = el('div', 'card' + (d.done ? ' isdone' : '')); card.style.setProperty('--tier', 'var(--' + d.group + ')')
    const head = el('div', 'head')
    head.append(el('b', '', d.label), el('span', 'file', d.file.replace('.png', '')))
    if (d.done) head.append(el('span', 'done', '入った'))
    head.append(el('span', 'sp'))
    const pre = el('pre', '', d.prompt)
    const btn = el('button', 'copy', 'コピー'); btn.type = 'button'; btn.onclick = () => copy(btn, d.prompt, pre)
    head.append(btn)
    const det = el('details'); det.append(el('summary', '', '頼む文を見る'), pre)
    card.append(head, el('div', 'names', d.names.join('・')), det)
    return card
  }) : [el('div', 'names', 'このまとまりのシートは全部入りました')]))
}
render()
</script>
`
writeFileSync(out, html)
console.log(`書いた ${out}（シート ${data.length} 枚・入った ${data.filter(d => d.done).length} 枚・${Math.round(html.length / 1024)}KB）`)
