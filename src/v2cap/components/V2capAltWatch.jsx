// v2cap：サブ垢の見張り（管理者だけ・2026-11-06）
// 同じ端末・同じIPを使ったことのあるキャラの組みを並べる（サーバーの v2cap_watch_pairs・supabase_v2cap_core.sql §4-2）。
// ★止めるかは人が決める（ユーザー選択「① 記録して見張る」）。この画面は見るだけで、何も書きこまない
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { box, miniBtn, TEXT } from './v2ui.js'
import { pairFacts, pairStrength, shortDate } from '../lib/altWatch.js'

const who = (c) => `${c?.name || '—'}（LV${c?.lv ?? '—'} ${c?.cls || '—'}）`

export default function V2capAltWatch() {
  const [res, setRes] = useState(null)   // { pairs, people }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('v2cap_watch_pairs', { p_limit: 200 })
    setBusy(false)
    if (error) {
      setErr(error.code === 'PGRST202' ? 'SQL（v2cap_watch_20261106.sql）を流すと使えます' : (error.message || String(error)))
      return
    }
    if (!data?.ok) { setErr(data?.error || '読めませんでした'); return }
    setRes(data)
  }, [])
  useEffect(() => { load() }, [load])

  const pairs = res?.pairs || []
  return (
    <div>
      <div style={{ ...box, padding:'8px 10px', marginBottom:'8px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap', fontSize:'11px' }}>
          <span style={{ color: TEXT.label }}>記録した人</span>
          <span style={{ color: TEXT.bright }}>{res ? `${res.people}人` : '—'}</span>
          <span style={{ color: TEXT.label }}>疑わしい組み</span>
          <span style={{ color: TEXT.bright }}>{res ? `${pairs.length}組` : '—'}</span>
          <button onClick={load} disabled={busy} style={{ ...miniBtn('#88aaff'), marginLeft:'auto' }}>{busy ? '読み込み中...' : '読み直す'}</button>
        </div>
        <div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'6px', lineHeight:1.6 }}>
          同じ端末＝同じ人の見込みが高い。同じIPだけ＝家族・スマホ回線・学校などの他人のこともある。IPも端末も元に戻せない形で残しているので、だれのIPかは分からない
        </div>
      </div>

      {err && <div style={{ color:'#ff8866', fontSize:'11px', marginBottom:'8px' }}>{err}</div>}
      {res && pairs.length === 0 && <div style={{ color: TEXT.empty, fontSize:'11px' }}>同じ端末や同じIPのキャラはいません</div>}

      {pairs.map((p) => {
        const s = pairStrength(p)
        return (
          <div key={`${p.a?.id}-${p.b?.id}`} style={{ ...box, borderLeft:`3px solid ${s.color}`, padding:'8px 10px', marginBottom:'6px', fontSize:'11px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
              <span style={{ color: s.color, border:`1px solid ${s.color}`, padding:'1px 4px', fontSize:'10px' }}>{s.label}</span>
              <span style={{ color: TEXT.bright }}>{who(p.a)}</span>
              <span style={{ color: TEXT.label }}>⇄</span>
              <span style={{ color: TEXT.bright }}>{who(p.b)}</span>
            </div>
            <div style={{ color: TEXT.body, marginTop:'4px' }}>{pairFacts(p).join('・')}</div>
            <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginTop:'4px', fontSize:'10px' }}>
              <span><span style={{ color: TEXT.label }}>作成</span> <span style={{ color: TEXT.sub }}>{shortDate(p.a?.made)}・{shortDate(p.b?.made)}</span></span>
              <span><span style={{ color: TEXT.label }}>最後に開いた</span> <span style={{ color: TEXT.sub }}>{shortDate(p.a?.seen)}・{shortDate(p.b?.seen)}</span></span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
