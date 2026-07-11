import { useState, useRef, useCallback } from 'react'

// アプリ内の確認ポップアップ（window.confirm 代替）。
//  window.confirm はインストール済みPWA/一部モバイルで無反応(常にfalse)になり、
//  「操作できない」不具合の原因になるため、ゲーム内モーダルで確認を取る。
//  使い方: const [confirmEl, confirm] = useConfirm()
//          if (!(await confirm('本当に？', { okLabel: 'OK' }))) return
//          return (<>... {confirmEl}</>)
export function useConfirm() {
  const [box, setBox] = useState(null) // { msg, okLabel, cancelLabel }
  const resolveRef = useRef(null)

  const confirm = useCallback((msg, opts = {}) => new Promise((resolve) => {
    resolveRef.current = resolve
    setBox({ msg, okLabel: opts.okLabel || 'OK', cancelLabel: opts.cancelLabel || 'やめる' })
  }), [])

  const close = useCallback((val) => {
    setBox(null)
    const r = resolveRef.current
    resolveRef.current = null
    if (r) r(val)
  }, [])

  const el = box ? (
    <div onClick={() => close(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,2,8,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'monospace' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#00060f', border: '1px solid #1d3a5c', maxWidth: 360, width: '100%', padding: 18, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}>
        <div style={{ color: '#cfe4ff', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 16 }}>{box.msg}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => close(false)}
            style={{ background: '#0a1220', border: '1px solid #33455c', color: '#7f95ad', padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>{box.cancelLabel}</button>
          <button onClick={() => close(true)}
            style={{ background: '#001840', border: '1px solid #0088ff', color: '#00aaff', padding: '8px 18px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>{box.okLabel}</button>
        </div>
      </div>
    </div>
  ) : null

  return [el, confirm]
}
