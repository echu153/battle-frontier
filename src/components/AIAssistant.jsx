import { useState, useRef, useEffect } from 'react'
import { askAssistant, QUICK_QUESTIONS } from '../lib/aiAssistant'
import { llmChat } from '../lib/llmChat'

// ============================================================
// AI相談アシスタント（ルールベース・LLM不使用）
//   フローティングのチャットUI。質問に自動回答し、強化アドバイスもする。
//   ※現在 is_admin 限定で先行公開（Game.jsx 側でゲート）。
// ============================================================
export default function AIAssistant({ ctx }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'やあ！バトルフロンティアの案内役だよ。\n「○○ってなに？」「○○するには？」と聞いてね。\n強化に迷ったら「おすすめ強化を教えて」もどうぞ。' },
  ])
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open])

  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  // 直前に実のある回答ができた質問を覚えておき、「もっと詳しく」等のフォロー発話に文脈で応える
  const lastQueryRef = useRef('')

  const send = async (textArg) => {
    const text = (textArg ?? input).trim()
    // busyRef は同期的に確定するため、state反映前の連打でも二重送信を防げる
    if (!text || busyRef.current) return
    busyRef.current = true
    setInput('')
    setBusy(true)
    setMessages((m) => [...m, { role: 'user', text }, { role: 'ai', text: '🔎 調べています…' }])
    let answer
    try {
      const res = await askAssistant(text, { ...ctx, lastQuery: lastQueryRef.current })
      answer = res.text
      // 事実質問はルールベース（正確）で確定。答えに詰まった質問だけ会話用LLM（1日上限つき）へ。
      // LLM未デプロイ/上限到達/エラー時は llmChat が null/allowed:false を返すのでルールの回答を表示。
      if (res.kind === 'fallback') {
        const p = ctx?.profile
        const llm = await llmChat({ question: text, player: { name: p?.name, cls: p?.class, lv: p?.char_lv } })
        if (llm && llm.text) answer = llm.text
      }
      // 実のある回答（雑談/聞き取れず/拒否 以外）のときだけ直前話題として記憶
      if (res.kind && res.kind !== 'meta' && res.kind !== 'fallback' && res.kind !== 'refused') lastQueryRef.current = text
    } catch {
      answer = '通信エラーが発生しました。もう一度お試しください。'
    }
    // 直前の「調べています…」プレースホルダを回答で置き換える
    setMessages((m) => {
      const next = m.slice()
      next[next.length - 1] = { role: 'ai', text: answer }
      return next
    })
    busyRef.current = false
    setBusy(false)
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      {/* フローティング起動ボタン */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', right: '16px', bottom: '16px', zIndex: 9998,
            width: '56px', height: '56px', borderRadius: '50%',
            background: '#0a1530', border: '2px solid #44ddaa', color: '#44ddaa',
            fontSize: '24px', cursor: 'pointer', fontFamily: 'monospace',
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
          }}
          title="AI相談"
        >🤖</button>
      )}

      {/* チャットパネル */}
      {open && (
        <div style={{
          position: 'fixed', right: '16px', bottom: '16px', zIndex: 9999,
          width: 'min(360px, calc(100vw - 32px))', height: 'min(520px, calc(100vh - 32px))',
          background: '#000a1c', border: '1px solid #44ddaa', borderRadius: '8px',
          display: 'flex', flexDirection: 'column', fontFamily: 'monospace',
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        }}>
          {/* ヘッダー */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 12px', borderBottom: '1px solid #0a3a30', background: '#001520',
          }}>
            <span style={{ color: '#44ddaa', fontSize: '13px' }}>🤖 AI相談（β・管理者先行）</span>
            <button onClick={() => setOpen(false)} style={{
              background: 'none', border: 'none', color: '#668899', fontSize: '16px', cursor: 'pointer',
            }}>✕</button>
          </div>

          {/* メッセージ一覧 */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: m.role === 'user' ? '85%' : '92%',
                background: m.role === 'user' ? '#10325a' : '#06121f',
                border: `1px solid ${m.role === 'user' ? '#2a6aa0' : '#1a4a40'}`,
                color: m.role === 'user' ? '#cce4ff' : '#bfe8d8',
                padding: '8px 11px', borderRadius: '6px',
                fontSize: '12px', lineHeight: '1.8', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                textAlign: 'left',
              }}>{m.text}</div>
            ))}
          </div>

          {/* クイック質問 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '6px 8px', borderTop: '1px solid #0a2a20' }}>
            {QUICK_QUESTIONS.map((q) => (
              <button key={q} onClick={() => send(q)} style={{
                background: '#06141f', border: '1px solid #1a4a40', color: '#66bba0',
                fontSize: '10px', padding: '3px 6px', borderRadius: '10px', cursor: 'pointer', fontFamily: 'monospace',
              }}>{q}</button>
            ))}
          </div>

          {/* 入力欄 */}
          <div style={{ display: 'flex', gap: '6px', padding: '8px', borderTop: '1px solid #0a2a20' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              maxLength={300}
              placeholder="質問を入力…"
              style={{
                flex: 1, background: '#000a14', border: '1px solid #143a30', color: '#cfe',
                padding: '7px 9px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px', outline: 'none',
              }}
            />
            <button onClick={() => send()} disabled={busy} style={{
              background: '#0a2a22', border: '1px solid #44ddaa', color: busy ? '#2a6a58' : '#44ddaa',
              padding: '0 14px', borderRadius: '4px', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '13px',
            }}>送信</button>
          </div>
        </div>
      )}
    </>
  )
}
