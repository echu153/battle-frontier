import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { box, btn, miniBtn, TEXT } from './v2ui.js'
import V2Help from './V2Help.jsx'
import { FRIEND_MAX, splitRows, checkRequest } from '../lib/friends.js'

// ============================================================
// フレンド（docs/v2-raid-design.md §4）
// ------------------------------------------------------------
// レイドの**救援信号の宛先**として作った画面。
//   名前で探して申請 → 相手が承認すると成立。どちらからでも解除できる。
// ★権威はサーバー（v2_friend_request / v2_friend_accept / v2_friend_remove）。
// ============================================================
export default function V2Friends({ prof, onBack }) {
  const [rows, setRows] = useState([])
  const [names, setNames] = useState({})   // id → 名前・LV
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const meId = prof?.id

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('v2_friends').select('*')
    const list = data || []
    setRows(list)
    const ids = [...new Set(list.map(r => (String(r.requester) === String(meId) ? r.addressee : r.requester)))]
    if (ids.length) {
      const { data: profs } = await supabase.from('v2_profiles').select('id,username,lv').in('id', ids)
      setNames(Object.fromEntries((profs || []).map(p => [String(p.id), p])))
    } else setNames({})
  }, [meId])

  useEffect(() => { refresh() }, [refresh])

  const call = async (fn, args) => {
    setBusy(true)
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error || !data?.ok) { setMsg(`⚠ ${error?.message || data?.error}`); return false }
    await refresh()
    return data
  }

  const request = async () => {
    const e = checkRequest(name, prof?.username, rows, meId)
    if (e) { setMsg(`⚠ ${e}`); return }
    const r = await call('v2_friend_request', { p_username: name.trim() })
    if (r) {
      setMsg(r.status === 'accepted' ? '🤝 フレンドになりました' : '📨 申請を送りました')
      setName('')
    }
  }

  const split = splitRows(rows, meId)
  const nameOf = (id) => names[String(id)]?.username || '???'
  const lvOf = (id) => names[String(id)]?.lv

  const Row = ({ v, actions }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px',
      borderTop:'1px solid #002244', padding:'6px 0', flexWrap:'wrap' }}>
      <span style={{ color: TEXT.body, fontSize:'11px' }}>
        {nameOf(v.otherId)}
        {lvOf(v.otherId) != null && <span style={{ color: TEXT.label }}>　LV{lvOf(v.otherId)}</span>}
      </span>
      <span style={{ display:'flex', gap:'4px' }}>{actions}</span>
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
        <V2Help id="friends" />
      </div>

      {msg && <div style={{ color:'#ffcc00', fontSize:'11px', marginBottom:'8px' }}>{msg}</div>}

      {/* 申請する */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'6px' }}>名前で探して申請する</div>
        <div style={{ display:'flex', gap:'6px' }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="相手の名前"
            onKeyDown={e => { if (e.key === 'Enter') request() }}
            style={{ flex:1, background:'#000818', border:'1px solid #0044aa', color:'#88ccff',
              fontFamily:'monospace', fontSize:'12px', padding:'8px' }} />
          <button onClick={request} disabled={busy} style={btn('#44ff88')}>申請する</button>
        </div>
      </div>

      {/* 届いている申請 */}
      {split.incoming.length > 0 && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px' }}>📨 届いている申請（{split.incoming.length}件）</div>
          {split.incoming.map(v => (
            <Row key={v.id} v={v} actions={<>
              <button onClick={() => call('v2_friend_accept', { p_id: v.id })} disabled={busy}
                style={miniBtn('#44ff88')}>承認する</button>
              <button onClick={() => call('v2_friend_remove', { p_id: v.id })} disabled={busy}
                style={miniBtn('#ff8844')}>断る</button>
            </>} />
          ))}
        </div>
      )}

      {/* 送った申請 */}
      {split.outgoing.length > 0 && (
        <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color: TEXT.label, fontSize:'12px' }}>📤 送った申請（{split.outgoing.length}件）</div>
          {split.outgoing.map(v => (
            <Row key={v.id} v={v} actions={
              <button onClick={() => call('v2_friend_remove', { p_id: v.id })} disabled={busy}
                style={miniBtn('#ff8844')}>取り消す</button>
            } />
          ))}
        </div>
      )}

      {/* フレンド */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px' }}>
          🤝 フレンド（{split.friend.length}／{FRIEND_MAX}人）
        </div>
        {split.friend.length === 0 && (
          <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'6px' }}>
            まだいません。名前で探して申請してください。
          </div>
        )}
        {split.friend.map(v => (
          <Row key={v.id} v={v} actions={
            <button onClick={() => call('v2_friend_remove', { p_id: v.id })} disabled={busy}
              style={miniBtn('#ff8844')}>解除する</button>
          } />
        ))}
      </div>
    </div>
  )
}
