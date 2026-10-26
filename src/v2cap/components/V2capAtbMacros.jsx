import { miniBtn, TEXT } from './v2ui.js'
import { MACRO_STEPS, MACRO_MARK, STEP_NORMAL, STEP_GUARD, stepLabel } from '../lib/atbMacro.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘のマクロ①〜③の登録
// ------------------------------------------------------------
// 決まりと保存の形は src/v2cap/lib/atbMacro.js（1つ8個まで・サーバーに職業ごと）。
// 【確定】2026-10-26 ユーザー指示「マクロは選択したらループするようにして」＝くり返しの切り替えは出さない（いつも最後まで出たら頭に戻る）
// 手を押すと外れる。「＋ 足す」から技・通常攻撃・防御を後ろに足す。保存は親（V2capAtb.jsx）が v2cap_set_atb_macros を呼ぶ
// ============================================================
const sel = { background:'#000818', color: TEXT.body, border:'1px solid #0044aa', fontFamily:'monospace', fontSize:'11px', padding:'4px' }

export default function V2capAtbMacros({ macros, onChange, usable, dirty, saving, msg, onSave }) {
  const edit = (i, next) => onChange(macros.map((m, j) => (j === i ? { ...m, ...next } : m)))
  return (
    <div style={{ border:'1px solid #13405f', padding:'8px', marginBottom:'10px' }}>
      <div style={{ color: TEXT.bright, fontSize:'12px', marginBottom:'4px' }}>マクロ（①〜③）</div>
      <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7, marginBottom:'6px' }}>
        戦闘中に①〜③を押すと、登録した順にゲージが溜まりしだい出て、最後まで出たら頭に戻ってくり返します（1つ{MACRO_STEPS}個まで）。
        技が使えないあいだ（クールダウン中・MP不足）は、通常攻撃でつないで待ちます。戦闘中に技を押すと、次の1回だけ割り込みます。
      </div>
      {macros.map((m, i) => (
        <div key={i} style={{ borderTop: i ? '1px solid #0a2a44' : 'none', padding:'6px 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'4px' }}>
            <span style={{ color:'#ffee44', fontSize:'13px' }}>{MACRO_MARK[i]}</span>
            <span style={{ color: TEXT.label, fontSize:'10px' }}>{m.steps.length}/{MACRO_STEPS}</span>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', alignItems:'center' }}>
            {m.steps.map((s, k) => (
              <button key={k} onClick={() => edit(i, { steps: m.steps.filter((_, x) => x !== k) })} title="押すと外す"
                style={{ ...miniBtn(s === STEP_GUARD ? '#66ccff' : s === STEP_NORMAL ? TEXT.body : '#44aaff'), padding:'4px 6px', fontSize:'11px' }}>
                {k + 1}. {stepLabel(s)} ✕
              </button>
            ))}
            {m.steps.length < MACRO_STEPS && (
              <select value="" onChange={e => { if (e.target.value) edit(i, { steps: [...m.steps, e.target.value] }) }} style={sel}>
                <option value="">＋ 足す</option>
                {usable.map(n => <option key={n} value={n}>{n}</option>)}
                <option value={STEP_NORMAL}>通常攻撃</option>
                <option value={STEP_GUARD}>🛡 防御</option>
              </select>
            )}
            {!m.steps.length && <span style={{ color: TEXT.empty, fontSize:'10px' }}>まだ何も入っていません</span>}
          </div>
        </div>
      ))}
      <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', marginTop:'4px' }}>
        <button onClick={onSave} disabled={!dirty || saving}
          style={{ ...miniBtn(dirty ? '#44ff88' : TEXT.empty), padding:'6px 12px', fontSize:'11px', cursor: dirty && !saving ? 'pointer' : 'default' }}>
          {saving ? '保存中...' : dirty ? '💾 マクロを保存' : '保存済み'}
        </button>
        {msg && <span style={{ color: msg.ok ? '#44ff88' : '#ff6666', fontSize:'10px' }}>{msg.text}</span>}
      </div>
    </div>
  )
}
