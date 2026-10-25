import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { TEXT } from './v2ui.js'
import {
  jemitaStatusText, jemitaReasonText, JEMITA_NAME, JEMITA_HELLO, JEMITA_MAX_CHARS, JEMITA_DAILY_LIMIT,
} from '../lib/jemita.js'
import { JEMITA_KB_VERSION } from '../lib/jemitaKbVersion.js'

// ============================================================
// バトルフロンティアⅡ（v2cap）— AI案内役「ジェミータ」のボタンと会話の窓
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「ジェミータは出撃同様右下にボタンを付けてチャットボットを出すことができるように」：
//   ・右下の出撃ボタン（V2capSortie の fab・64px）のすぐ上に丸いボタン。街でも戦闘中でも施設の画面でも出す（App.jsx の /v2cap に置く）
//   ・押すと右下に会話の窓（スマホは横いっぱい）。閉じても会話は残る（ページを開き直すと消える）。「新しく話す」で最初から
//   ・送るたびに、本人のキャラと持ち物をサーバーから読み直して「今の状態」を付ける（名前は付けない・lib/jemita.js）
//   ・残りの回数はサーバー（v2cap_jemita_left）。管理者は無制限
//   ・見るだけの窓なので、閉じても画面の位置は動かさない
// ============================================================
const RING = '#ff8844'
const FAB_GAP = 92   // 出撃ボタン（下から16px・高さ64px）の上に12px あける

const fetchMine = async () => {
  const uid = (await supabase.auth.getSession()).data.session?.user?.id
  if (!uid) return { prof: null, inventory: [] }
  const [{ data: prof }, { data: inventory }] = await Promise.all([
    supabase.from('v2cap_profiles').select('*').eq('id', uid).maybeSingle(),
    supabase.from('v2cap_inventory').select('*'),
  ])
  return { prof: prof || null, inventory: inventory || [] }
}

// Edge Function の返事（2xx 以外でも中の reason を読む）
const callJemita = async (body) => {
  const { data, error } = await supabase.functions.invoke('v2cap-jemita', { body })
  if (!error) return data || {}
  // 届かない（関数がまだ置かれていないと、ブラウザの確かめ［CORS］で止まってこちらになる）・置かれていない（404）
  if (error.name === 'FunctionsFetchError') return { reason: 'unreachable' }
  if (error.context?.status === 404) return { reason: 'not_configured' }
  try { return (await error.context?.json?.()) || {} } catch { return {} }
}

export default function V2capJemita() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState(() => [{ who: 'j', text: JEMITA_HELLO }])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(null)        // { left, limit, unlimited }
  const [stale, setStale] = useState(false)     // サーバーの資料が画面より古い（管理者にだけ出す）
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 560)
  const since = useRef(new Date().toISOString())
  const listRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 560)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // 開いたら残りの回数を聞く（開くたび1回）
  useEffect(() => {
    if (!open) return
    let alive = true
    supabase.rpc('v2cap_jemita_left').then(({ data }) => { if (alive && data) setLeft(data) })
    setTimeout(() => inputRef.current?.focus(), 0)
    return () => { alive = false }
  }, [open])
  // 新しい発言が来たら下まで送る
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, open, busy])

  const send = useCallback(async () => {
    const q = text.trim()
    if (!q || busy) return
    if (q.length > JEMITA_MAX_CHARS) { setMsgs(m => [...m, { who: 'sys', text: jemitaReasonText('too_long') }]); return }
    setBusy(true)
    setText('')
    setMsgs(m => [...m, { who: 'me', text: q }])
    // 読めなくても質問だけは送る（状態の欄が空になるだけ）
    const status = await fetchMine().then(({ prof, inventory }) => jemitaStatusText(prof, inventory)).catch(() => '')
    const data = await callJemita({ question: q, status, since: since.current })
    setBusy(false)
    if (data?.allowed && data?.text) {
      setMsgs(m => [...m, { who: 'j', text: data.text }])
      if (data.unlimited) setLeft(l => ({ ...(l || {}), unlimited: true }))
      else if (typeof data.left === 'number') setLeft(l => ({ ...(l || {}), left: data.left, limit: l?.limit ?? JEMITA_DAILY_LIMIT, unlimited: false }))
      if (data.unlimited && data.kb_version && data.kb_version !== JEMITA_KB_VERSION) setStale(true)
      return
    }
    if (data?.reason === 'daily_limit') setLeft(l => ({ ...(l || {}), left: 0 }))
    setMsgs(m => [...m, { who: 'sys', text: jemitaReasonText(data?.reason) }])
  }, [text, busy])

  const restart = () => {
    since.current = new Date().toISOString()
    setMsgs([{ who: 'j', text: JEMITA_HELLO }])
  }
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  const leftText = !left ? '' : left.unlimited ? '管理者：回数無制限' : `今日あと${left.left}回（1日${left.limit ?? JEMITA_DAILY_LIMIT}回）`
  const outOfTurns = left && !left.unlimited && left.left <= 0

  const fab = (
    <button onClick={() => setOpen(o => !o)} aria-label={JEMITA_NAME} title={`${JEMITA_NAME}に相談する（β）`}
      style={{ position:'fixed', right:'16px', bottom:`calc(${FAB_GAP}px + env(safe-area-inset-bottom, 0px))`, zIndex:300,
        width:'56px', height:'56px', borderRadius:'50%', padding:0, fontFamily:'monospace', lineHeight:1.1,
        background:'#1a0c00', border:`2px solid ${RING}`, color: RING, cursor:'pointer',
        boxShadow:`0 0 10px rgba(255,136,68,0.35), 0 4px 12px rgba(0,0,0,0.6)` }}>
      <span style={{ fontSize:'20px' }}>🤖</span><br /><span style={{ fontSize:'10px' }}>相談</span>
    </button>
  )
  if (!open) return fab

  const panelPos = narrow
    ? { left:'8px', right:'8px', bottom:'calc(8px + env(safe-area-inset-bottom, 0px))', height:'min(78vh, 620px)' }
    : { right:'16px', bottom:'calc(16px + env(safe-area-inset-bottom, 0px))', width:'380px', height:'min(600px, calc(100vh - 32px))' }
  return (
    <div role="dialog" aria-label={JEMITA_NAME}
      style={{ position:'fixed', zIndex:400, ...panelPos, display:'flex', flexDirection:'column',
        background:'#000c22', border:`1px solid ${RING}`, boxShadow:'0 6px 24px rgba(0,0,0,0.7)', fontFamily:'monospace' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 10px', borderBottom:'1px solid #3a2410', background:'#1a0c00' }}>
        <span style={{ fontSize:'18px' }}>🤖</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color: RING, fontSize:'13px', fontWeight:'bold' }}>{JEMITA_NAME}<span style={{ color: TEXT.label, fontSize:'10px', fontWeight:'normal' }}>（β）</span></div>
          <div style={{ color: TEXT.sub, fontSize:'10px' }}>{leftText || ' '}</div>
        </div>
        <button onClick={restart} disabled={busy} title="会話を最初から"
          style={{ background:'none', border:`1px solid ${TEXT.label}`, color: TEXT.label, fontFamily:'monospace', fontSize:'10px', padding:'3px 6px', cursor: busy ? 'not-allowed' : 'pointer' }}>
          新しく話す
        </button>
        <button onClick={() => setOpen(false)} aria-label="閉じる"
          style={{ background:'none', border:'none', color: TEXT.bright, fontSize:'18px', cursor:'pointer', padding:'0 4px', lineHeight:1 }}>✕</button>
      </div>
      {stale && (
        <div style={{ color:'#ffcc00', fontSize:'10px', padding:'4px 10px', background:'#2a2000' }}>
          ⚠ サーバーの資料が古い版です（supabase_v2cap_jemita_kb.sql を流すと今のゲームに合います）［管理者にだけ表示］
        </div>
      )}
      <div ref={listRef} style={{ flex:1, overflowY:'auto', padding:'10px', display:'flex', flexDirection:'column', gap:'8px' }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.who === 'me' ? 'flex-end' : 'flex-start', maxWidth:'88%',
            background: m.who === 'me' ? '#002a55' : m.who === 'sys' ? '#1a1a1a' : '#24120a',
            border:`1px solid ${m.who === 'me' ? '#0066cc' : m.who === 'sys' ? '#555' : '#5a3418'}`,
            color: m.who === 'me' ? TEXT.bright : m.who === 'sys' ? TEXT.sub : '#ffe2cc',
            padding:'6px 9px', fontSize:'12px', lineHeight:1.6, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
            {m.text}
          </div>
        ))}
        {busy && <div style={{ alignSelf:'flex-start', color: TEXT.label, fontSize:'11px' }}>ジェミータが考えている…</div>}
      </div>
      <div style={{ borderTop:'1px solid #3a2410', padding:'8px 10px', display:'grid', gap:'6px' }}>
        <div style={{ display:'flex', gap:'6px', alignItems:'flex-end' }}>
          <textarea ref={inputRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
            maxLength={JEMITA_MAX_CHARS} rows={2} disabled={busy || outOfTurns}
            placeholder={outOfTurns ? '今日の分は終わり（朝5時に戻る）' : 'ゲームのことを訊く（Enterで送る・Shift+Enterで改行）'}
            style={{ flex:1, minWidth:0, resize:'none', background:'#000818', border:'1px solid #0044aa', color: TEXT.bright,
              fontFamily:'monospace', fontSize:'12px', padding:'6px', outline:'none' }} />
          <button onClick={send} disabled={busy || outOfTurns || !text.trim()}
            style={{ background:'#1a0c00', border:`1px solid ${RING}`, color: RING, fontFamily:'monospace', fontSize:'12px', padding:'8px 12px',
              cursor: busy || outOfTurns || !text.trim() ? 'not-allowed' : 'pointer', opacity: busy || outOfTurns || !text.trim() ? 0.5 : 1 }}>
            送る
          </button>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', gap:'8px', color: TEXT.label, fontSize:'9px' }}>
          <span>このゲームのことだけ答えます。会話は見直しのため30日間記録します。</span>
          <span style={{ flexShrink:0 }}>{text.length}/{JEMITA_MAX_CHARS}</span>
        </div>
      </div>
    </div>
  )
}
