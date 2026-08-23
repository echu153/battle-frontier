// Artifact 用の1枚もののHTMLを組む（データは tools/v2-skills.json）
import fs from 'node:fs'
const data = JSON.parse(fs.readFileSync(new URL('./v2-skills.json', import.meta.url), 'utf8'))
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const KIND_KEY = { 物理:'phys', 特殊:'mag', 回復:'heal', 補助:'buff', パッシブ:'passive' }

const rows = (c) => c.skills.map((s, i) => {
  const mark = s.added && i === 6 ? ' data-firstadded="1"' : ''
  return `<tr class="row" data-kind="${KIND_KEY[s.kind]}" data-cls="${esc(c.name)}"${mark}
 data-q="${esc((s.name + ' ' + s.power + ' ' + s.note + ' ' + c.name).toLowerCase())}">
<th scope="row" class="nm">${esc(s.name)}${s.req ? `<span class="req" title="転職${s.req}回以上で覚える">転${s.req}</span>` : ''}${s.kindKey === 'passive' ? '<span class="req pas" title="枠を使わない・その職業だけ・最初から効いている">枠外</span>' : ''}</th>
<td><span class="kind k-${KIND_KEY[s.kind]}">${esc(s.kind)}</span></td>
<td class="pw">${esc(s.power)}</td>
<td class="num">${esc(s.proc)}</td>
<td class="num">${esc(s.mp)}</td>
<td class="note">${esc(s.note)}</td>
</tr>`
}).join('\n')

const section = (c) => `
<section class="cls" id="cls-${encodeURIComponent(c.name)}" data-cls="${esc(c.name)}">
  <header class="clshead">
    <h2>${esc(c.name)}</h2>
    <div class="meta">
      ${c.basic ? '<span class="tag basic">初期職</span>' : '<span class="tag adv">上位職</span>'}
      ${c.bonus ? `<span class="bonus">職業補正 ${esc(c.bonus)}</span>` : ''}
      ${c.main ? `<span class="ms">主 ${esc(c.main)}<i>/</i>副 ${esc(c.sub)}</span>` : ''}
      <span class="cnt"><b>${c.skills.length}</b>個</span>
    </div>
  </header>
  <div class="scroller">
    <table>
      <thead><tr><th>スキル</th><th>種別</th><th>威力・効果</th><th>発動</th><th>MP</th><th>備考</th></tr></thead>
      <tbody>
${rows(c)}
      </tbody>
    </table>
  </div>
</section>`

const jump = data.classes.map(c => `<option value="cls-${encodeURIComponent(c.name)}">${esc(c.name)}（${c.skills.length}）</option>`).join('')

const html = `<title>バトルフロンティアⅡ スキル台帳</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap">
<style>
:root{
  /* 顔料から採った配色（藍・朱・群青・緑青・山吹・鈍色） */
  --ai:#1E3A5F; --shu:#B03A2E; --gunjo:#3D5A96; --rokusho:#2E7D5B; --yamabuki:#8A6A16; --nibi:#5C5A63;
  --bg:#F7F5F0; --panel:#FFFFFF; --ink:#16181D; --dim:#61656F; --line:#E2DED4; --line2:#EFECE4;
  --chip:#FFFFFF; --shadow:0 1px 2px rgba(22,24,29,.05),0 8px 24px -18px rgba(22,24,29,.35);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ai:#8FB4DF; --shu:#E4796A; --gunjo:#8AA3DC; --rokusho:#63C39B; --yamabuki:#D6B25A; --nibi:#A6A3AE;
    --bg:#101319; --panel:#181B22; --ink:#E9E7E2; --dim:#9A9DA8; --line:#282C36; --line2:#20242C;
    --chip:#1E222B; --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -20px rgba(0,0,0,.9);
  }
}
:root[data-theme="dark"]{
  --ai:#8FB4DF; --shu:#E4796A; --gunjo:#8AA3DC; --rokusho:#63C39B; --yamabuki:#D6B25A; --nibi:#A6A3AE;
  --bg:#101319; --panel:#181B22; --ink:#E9E7E2; --dim:#9A9DA8; --line:#282C36; --line2:#20242C;
  --chip:#1E222B; --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -20px rgba(0,0,0,.9);
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:"Zen Kaku Gothic New","Hiragino Kaku Gothic ProN","Yu Gothic",system-ui,sans-serif;
  font-size:15px; line-height:1.7; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1180px; margin:0 auto; padding:0 20px 96px}

/* ===== 見出し ===== */
.top{padding:56px 0 28px; border-bottom:1px solid var(--line)}
h1{
  font-family:"Shippori Mincho",serif; font-weight:700; font-size:clamp(30px,4.4vw,46px);
  margin:0 0 10px; letter-spacing:.03em; text-wrap:balance;
}
.lede{margin:0; color:var(--dim); max-width:62ch}
.lede b{color:var(--ink); font-weight:700; font-variant-numeric:tabular-nums}
.src{margin:14px 0 0; font-size:12.5px; color:var(--dim)}
.src code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--line2); padding:1px 6px; border-radius:4px}

/* ===== 道具立て ===== */
.tools{
  position:sticky; top:0; z-index:20; background:var(--bg);
  border-bottom:1px solid var(--line); padding:12px 0; margin-bottom:8px;
  display:flex; flex-wrap:wrap; gap:10px; align-items:center;
}
.search{
  flex:1 1 260px; min-width:0; display:flex; align-items:center; gap:8px;
  background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 12px;
}
.search input{
  flex:1; min-width:0; border:0; outline:0; background:transparent; color:var(--ink);
  font:inherit; font-size:14px;
}
.search svg{flex:none; opacity:.55}
.filters{display:flex; flex-wrap:wrap; gap:6px}
.f{
  font:inherit; font-size:13px; cursor:pointer; padding:7px 13px; border-radius:999px;
  border:1px solid var(--line); background:var(--chip); color:var(--dim);
}
.f:hover{border-color:var(--ai); color:var(--ink)}
.f[aria-pressed="true"]{background:var(--ai); border-color:var(--ai); color:var(--bg); font-weight:700}
.f:focus-visible,.search:focus-within,select:focus-visible{outline:2px solid var(--ai); outline-offset:2px}
select{
  font:inherit; font-size:13px; padding:7px 11px; border-radius:8px; max-width:190px;
  border:1px solid var(--line); background:var(--chip); color:var(--ink); cursor:pointer;
}
.hits{margin-left:auto; font-size:13px; color:var(--dim); font-variant-numeric:tabular-nums; white-space:nowrap}

/* ===== 職ごと ===== */
.cls{margin-top:38px; scroll-margin-top:78px}
.clshead{border-left:3px solid var(--ai); padding-left:14px; margin-bottom:12px}
.clshead h2{font-family:"Shippori Mincho",serif; font-size:24px; font-weight:700; margin:0; letter-spacing:.04em}
.meta{display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; font-size:12.5px; color:var(--dim); margin-top:3px}
.tag{font-size:11px; font-weight:700; letter-spacing:.08em; padding:2px 8px; border-radius:4px}
.tag.basic{background:var(--line2); color:var(--dim)}
.tag.adv{background:color-mix(in srgb, var(--ai) 16%, transparent); color:var(--ai)}
.ms i{font-style:normal; opacity:.4; margin:0 4px}
.cnt b{color:var(--ink); font-variant-numeric:tabular-nums}

.scroller{overflow-x:auto; background:var(--panel); border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow)}
table{border-collapse:collapse; width:100%; min-width:760px}
thead th{
  text-align:left; font-size:11px; font-weight:700; letter-spacing:.1em; color:var(--dim);
  padding:11px 14px; border-bottom:1px solid var(--line); white-space:nowrap; background:var(--panel);
}
tbody th,tbody td{padding:10px 14px; border-bottom:1px solid var(--line2); vertical-align:top; text-align:left}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:color-mix(in srgb, var(--ai) 5%, transparent)}
.nm{font-weight:700; white-space:nowrap; font-size:14.5px}
.req.pas{color:var(--ai); border-color:color-mix(in srgb, var(--ai) 45%, transparent)}
.req{
  display:inline-block; margin-left:7px; font-size:10.5px; font-weight:700; letter-spacing:.04em;
  color:var(--yamabuki); border:1px solid color-mix(in srgb, var(--yamabuki) 45%, transparent);
  border-radius:4px; padding:0 5px; vertical-align:1px;
}
.pw{font-variant-numeric:tabular-nums; white-space:nowrap; font-size:14px}
.num{font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap; color:var(--dim); font-size:14px}
.note{color:var(--dim); font-size:13px; line-height:1.6; min-width:220px}
.kind{
  display:inline-block; font-size:11.5px; font-weight:700; padding:2px 9px; border-radius:999px; white-space:nowrap;
  border:1px solid currentColor;
}
.k-phys{color:var(--shu)} .k-mag{color:var(--gunjo)} .k-heal{color:var(--rokusho)}
.k-buff{color:var(--yamabuki)} .k-passive{color:var(--nibi)}
/* 6個目＝2026-08-19に足したぶんの区切り */
tr[data-firstadded]{border-top:1px dashed var(--line)}
tr[data-firstadded] .nm::before{
  content:"＋"; color:var(--ai); font-weight:700; margin-right:5px; opacity:.75;
}
.empty{display:none; padding:60px 0; text-align:center; color:var(--dim)}
.empty.on{display:block}
.cls.hide{display:none}
.row.hide{display:none}
@media (max-width:640px){
  .wrap{padding:0 14px 72px}
  .top{padding:38px 0 22px}
  .hits{margin-left:0; width:100%}
}
</style>

<div class="wrap">
  <header class="top">
    <h1>バトルフロンティアⅡ スキル台帳</h1>
    <p class="lede">初期職7職×5個 ＋ 上位職20職×10個 ＝ <b>${data.total}</b>スキル。
      各職の先頭は<b>パッシブ</b>（<b>枠外</b>マーク＝枠を使わず、その職業なら最初から効いている）。＋印から下は<b>転職5回以上</b>で覚えるぶん。</p>
    <p class="src">数値の正は <code>src/v2/lib/skills.js</code>。この表は <code>tools/v2-skills-doc.mjs</code> と同じ元データから作っている。</p>
  </header>

  <div class="tools">
    <label class="search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" type="search" placeholder="スキル名・効果・職業で絞り込む" autocomplete="off" aria-label="スキルを絞り込む">
    </label>
    <div class="filters" role="group" aria-label="種別で絞り込む">
      <button class="f" data-k="all" aria-pressed="true">すべて</button>
      <button class="f" data-k="phys" aria-pressed="false">物理</button>
      <button class="f" data-k="mag" aria-pressed="false">特殊</button>
      <button class="f" data-k="heal" aria-pressed="false">回復</button>
      <button class="f" data-k="buff" aria-pressed="false">補助</button>
      <button class="f" data-k="passive" aria-pressed="false">パッシブ</button>
    </div>
    <select id="jump" aria-label="職業へ移動"><option value="">職業へ移動…</option>${jump}</select>
    <span class="hits" id="hits">${data.total} / ${data.total} スキル</span>
  </div>

${data.classes.map(section).join('\n')}

  <p class="empty" id="empty">当てはまるスキルが無い。絞り込みを外してみて。</p>
</div>

<script>
(function(){
  var rows = Array.prototype.slice.call(document.querySelectorAll('.row'));
  var secs = Array.prototype.slice.call(document.querySelectorAll('.cls'));
  var q = document.getElementById('q');
  var hits = document.getElementById('hits');
  var empty = document.getElementById('empty');
  var kind = 'all';
  var total = rows.length;

  function apply(){
    var term = q.value.trim().toLowerCase();
    var n = 0;
    for (var i = 0; i < rows.length; i++){
      var r = rows[i];
      var ok = (kind === 'all' || r.dataset.kind === kind) &&
               (!term || r.dataset.q.indexOf(term) !== -1);
      r.classList.toggle('hide', !ok);
      if (ok) n++;
    }
    for (var j = 0; j < secs.length; j++){
      var any = secs[j].querySelector('.row:not(.hide)');
      secs[j].classList.toggle('hide', !any);
    }
    hits.textContent = n + ' / ' + total + ' スキル';
    empty.classList.toggle('on', n === 0);
  }

  q.addEventListener('input', apply);
  document.querySelectorAll('.f').forEach(function(b){
    b.addEventListener('click', function(){
      kind = b.dataset.k;
      document.querySelectorAll('.f').forEach(function(o){
        o.setAttribute('aria-pressed', String(o === b));
      });
      apply();
    });
  });
  document.getElementById('jump').addEventListener('change', function(e){
    var el = document.getElementById(e.target.value);
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
    e.target.selectedIndex = 0;
  });
})();
</script>
`

fs.writeFileSync(new URL('./v2-skills.html', import.meta.url), html)
console.log('bytes:', html.length)
