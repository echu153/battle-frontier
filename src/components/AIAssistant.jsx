import { useState, useRef, useEffect } from 'react'
import { askAssistant, QUICK_QUESTIONS, GAME_REFERENCE } from '../lib/aiAssistant'
import { llmChat } from '../lib/llmChat'

// 表示前の整形：句読点や文字の不自然な重複・余分な空白を機械的に取り除く（誤字脱字対策の最終チェック）
const tidy = (t) => (t || '')
  .replace(/[ \t\u3000]+/g, ' ')           // 連続スペース（全角含む）→1つ
  .replace(/ ?([。、！？!?]) ?/g, '$1')      // 句読点まわりの空白除去
  .replace(/([。、！？!?])\1+/g, '$1')       // 句読点の重複（。。→。）
  .replace(/(.)\1{3,}/g, '$1$1$1')          // 同じ文字の4連以上→3連（誤入力・連打対策）
  .replace(/[ \t]+\n/g, '\n')               // 行末の空白
  .replace(/\n{3,}/g, '\n\n')               // 過剰な空行
  .trim()

// ============================================================
// AI相談アシスタント「AI戦闘民族ジェミータ」
//   ☰メニューから開くチャットUI（open/onClose で親が開閉を制御）。
//   ルールベース(正確)＋会話LLMのハイブリッド。質問に回答し強化アドバイスもする。
// ============================================================
export default function AIAssistant({ ctx, open = false, onClose }) {
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'フン、来たか。俺は戦いの導き手「AI戦闘民族ジェミータ」だ。\nゲームのことなら何でも訊け。「○○とは」「○○になるには」、何でも答えてやる。\n強化に迷ったなら「おすすめの強化」と訊け。手加減はせん。' },
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
  // 本日のAI回答の残り回数（null=まだ不明 / 0=上限到達でテンプレのみ）と1日上限（サーバー値）
  const [aiRemaining, setAiRemaining] = useState(null)
  const [aiLimit, setAiLimit] = useState(null)
  const [aiUnlimited, setAiUnlimited] = useState(false) // 管理者=無制限（Edgeのunlimitedフラグ。センチネル値に依存しない）

  const send = async (textArg) => {
    const text = (textArg ?? input).trim()
    // busyRef は同期的に確定するため、state反映前の連打でも二重送信を防げる
    if (!text || busyRef.current) return
    busyRef.current = true
    setInput('')
    setBusy(true)
    setMessages((m) => [...m, { role: 'user', text }, { role: 'ai', text: '…見極めている。少し待て。' }])
    let answer
    let gotLLM = false // LLM生成文かどうか（tidy整形はLLM出力のみに適用＝ルール/DB本文は無加工）
    try {
      const res = await askAssistant(text, { ...ctx, lastQuery: lastQueryRef.current })
      answer = res.text
      // 事実質問はルールベース（正確）で確定。答えに詰まった質問だけ会話用LLM（1日上限つき）へ。
      // LLM未デプロイ/上限到達/エラー時は llmChat が null/allowed:false を返すのでルールの回答を表示。
      // 雑談/聞き取れず は丸ごとAIへ。強化相談(advice)は、ルールの正確な回答を“下書き”として渡し、
      // 質問に合わせて作り直させる（毎回テンプレにならないように）。AI不可時はルール回答を表示。
      if (res.kind === 'fallback' || res.kind === 'chat' || res.kind === 'advice') {
        const p = ctx?.profile
        const draft = res.kind === 'advice' ? res.text : ''
        // 直前までの会話履歴（このターン前のmessages）を文脈として渡す
        const history = messages
          .filter((m) => m.text && !m.text.startsWith('…見極めている'))
          .slice(-6)
          .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }))
        const llm = await llmChat({ question: text, draft, history, reference: GAME_REFERENCE, player: { name: p?.name, cls: p?.class, lv: p?.char_lv } })
        if (llm && llm.text) {
          answer = llm.text
          gotLLM = true
          if (llm.unlimited) setAiUnlimited(true) // 管理者＝無制限
          if (typeof llm.remaining === 'number') setAiRemaining(llm.remaining) // AI回答成功＝残り回数を更新
          if (typeof llm.limit === 'number') setAiLimit(llm.limit)
        } else if (llm && llm.allowed === false && llm.reason === 'daily_limit') {
          setAiRemaining(0) // 上限到達＝以降テンプレのみ
          if (typeof llm.limit === 'number') setAiLimit(llm.limit)
        }
      }
      // 直前話題として記憶：事実回答 or LLMが答えた自由質問（聞き返し「もっと詳しく」が続くように）
      const substantive = ['kb', 'db', 'class', 'advice', 'matchup'].includes(res.kind)
      if (substantive || (gotLLM && (res.kind === 'fallback' || res.kind === 'chat'))) lastQueryRef.current = text
    } catch {
      answer = '通信が乱れたか。もう一度言ってみろ。'
    }
    // 直前の「調べています…」プレースホルダを回答で置き換える。
    // tidy整形はLLM生成文のみ（誤字対策）。ルール/DB本文は正確なので無加工で表示する。
    const finalText = gotLLM ? tidy(answer) : (answer || '')
    setMessages((m) => {
      const next = m.slice()
      next[next.length - 1] = { role: 'ai', text: finalText }
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
      {/* チャットパネル（☰メニューから開く） */}
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
            <span style={{ color: '#44ddaa', fontSize: '13px' }}>⚔ AI戦闘民族ジェミータ（β版）</span>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: '#668899', fontSize: '16px', cursor: 'pointer',
            }}>✕</button>
          </div>

          {/* AI回答の残り回数ステータス（10回まではAIが考えて回答／以降はテンプレのみ） */}
          <div style={{
            padding: '5px 12px', borderBottom: '1px solid #06251d', background: '#00140f',
            fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px', lineHeight: 1.5,
            color: aiRemaining === 0 ? '#cc9944' : '#55bb99',
          }}>
            {aiUnlimited
              ? <span>⚔ ジェミータの本気：無制限（管理者）</span>
              : aiRemaining === 0
                ? <span>📋 現在テンプレ回答のみ<br />（本日分を使い切った・毎朝5時にリセット）</span>
                : aiRemaining === null
                  ? <span>⚔ ジェミータの本気：{aiLimit ? `1日${aiLimit}回まで` : '1日の上限あり'}<br />（毎朝5時リセット・超過後はテンプレ回答）</span>
                  : <span>⚔ ジェミータの本気：あと{aiRemaining}回<br />（毎朝5時リセット・超過後はテンプレ回答）</span>}
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
