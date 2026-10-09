import { useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { STAT_DEFS, STAT_KEYS } from '../../v2/lib/stats.js'
import { POINT_UNIT, validateAllocation } from '../lib/level.js'

// ============================================================
// 「レベルキャップあり」版 — ステータスポイントを振る（ステータス欄の下）
//   【確定】2026-10-09 ユーザー指示：LVアップでステは上がらず、ポイント（3・5の倍数のLVは5）を自分で振る。
//   ・8種すべてに振れる。1ポイントで HP+8・MP+3・ほか+1（どれも戦闘力+1）
//   ・振り直しはいまはできない（ユーザー決定）＝「決定」の前に、戻せないことを出す
//   ・決めるのはサーバー（v2cap_allocate_points）。確かめ方は level.js の validateAllocation と同じ
// ============================================================
const rowStyle = {
  display:'grid', gridTemplateColumns:'auto 1fr auto auto auto auto auto', alignItems:'center', gap:'4px',
  padding:'3px 0', borderBottom:'1px solid #002244', fontSize:'11px',
}
const btn = (color, disabled) => ({
  background:'#000818', border:`1px solid ${disabled ? '#2a3a55' : color}`, color: disabled ? '#4a5a75' : color,
  fontSize:'10px', padding:'1px 6px', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily:'monospace',
})

export default function V2capPoints({ prof, onProfile }) {
  const have = prof?.stat_points || 0
  const [open, setOpen] = useState(false)
  const [add, setAdd] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (have <= 0 && !open) return null

  const used = Object.values(add).reduce((a, b) => a + b, 0)
  const left = have - used
  const bump = (k, n) => {
    setError('')
    setAdd(a => {
      const room = have - Object.values(a).reduce((x, y) => x + y, 0)
      const next = Math.max(0, (a[k] || 0) + Math.min(n, room))
      return { ...a, [k]: next }
    })
  }
  const close = () => { if (busy) return; setOpen(false); setAdd({}); setError('') }
  const decide = async () => {
    const picked = Object.fromEntries(Object.entries(add).filter(([, v]) => v > 0))
    const err = validateAllocation(picked, have)
    if (err) { setError(err); return }
    setBusy(true)
    setError('')
    const { data, error: e } = await supabase.rpc('v2cap_allocate_points', { p_add: picked })
    setBusy(false)
    if (e || !data?.ok) { setError(e?.message || data?.error || '振れませんでした'); return }
    setOpen(false)
    setAdd({})
    onProfile?.(null)
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        style={{ width:'100%', margin:'0 0 6px', padding:'5px', background:'#1a1400', border:'1px solid #ffcc00',
          color:'#ffcc00', fontSize:'11px', cursor:'pointer', fontFamily:'monospace' }}>
        🔺 ステータスポイントが {have} あります（振る）
      </button>
      {open && (
        <V2Modal title="ステータスポイントを振る" color="#ffcc00" busy={busy}
          confirmLabel={`決定（${used}）`} cancelLabel="やめる" onConfirm={decide} onClose={close}>
          <div style={{ marginBottom:'6px' }}>
            残り <span style={{ color:'#ffcc00' }}>{left}</span> / {have}
            <span style={{ color:'#7fa6d0', fontSize:'10px', marginLeft:'6px' }}>1ポイントで HP+8・MP+3・ほか+1。振ったら戻せません</span>
          </div>
          {STAT_KEYS.map(k => {
            const d = STAT_DEFS[k]
            const n = add[k] || 0
            return (
              <div key={k} style={rowStyle}>
                <span style={{ color: d.color, width:'34px' }}>{d.label}</span>
                <span style={{ color:'#82a2c2', fontSize:'10px', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.desc}</span>
                <span style={{ color:'#cfe2ff', textAlign:'right', minWidth:'64px' }}>
                  {prof[k]}{n > 0 && <span style={{ color:'#44ff88' }}> → {prof[k] + n * POINT_UNIT[k]}</span>}
                </span>
                <button onClick={() => bump(k, -1)} disabled={busy || n <= 0} style={btn('#88aaff', busy || n <= 0)}>−</button>
                <span style={{ color: n > 0 ? '#ffcc00' : '#62789a', minWidth:'22px', textAlign:'center' }}>{n}</span>
                <button onClick={() => bump(k, 1)} disabled={busy || left <= 0} style={btn('#ffcc00', busy || left <= 0)}>+1</button>
                <button onClick={() => bump(k, 5)} disabled={busy || left <= 0} style={btn('#ffcc00', busy || left <= 0)}>+5</button>
              </div>
            )
          })}
          {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'6px' }}>⚠ {error}</div>}
        </V2Modal>
      )}
    </>
  )
}
