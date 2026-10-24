import { useEffect, useRef } from 'react'

// バトルフロンティアⅡ（リメイク版）— 画面の真ん中に出すポップアップ
// ------------------------------------------------------------
// 使い道は2つ。**確認**（消えるもの・戻せないものの前に1段挟む）と
// **結果**（強化が成功した・何かを手に入れた）。見た目は v2ui のターミナル調に合わせる。
//   ・確認 … onConfirm を渡すと「やめる／実行」の2ボタンになる
//   ・結果 … onConfirm を渡さなければ「閉じる」だけ
// ⚠**背景をクリックしても閉じない**（結果を読む前に消えると何が起きたか分からなくなる）。
//   Escでは閉じる。
// 【確定】2026-10-25 ユーザー指示「ポップアップ後の操作が全部この仕様（その場のまま）になってるから、基本的に画面遷移したら画面上部に移動するようにして」：
//   **ポップアップが閉じたら画面のいちばん上へ戻す**。確認は「実行」を押したあとに閉じたときだけ（「やめる」はその場のまま）。
//   ★見るだけのポップアップ（HELP・図鑑の詳しい情報・出撃オプション）は keepScroll を渡して今の場所のまま（src/v2cap/lib/popupTop.test.js が見張る）
export default function V2Modal({
  title, color = '#88ccff', children,
  confirmLabel = '実行する', cancelLabel = 'やめる', closeLabel = '閉じる',
  danger = false, busy = false, onConfirm, onClose, noClose = false, keepScroll = false,
}) {
  // 閉じたとき（このポップアップが消えたとき）に上へ戻すか。いまの値はそのつど控える（消えるときに見る）
  const acted = useRef(false)   // 確認で「実行」を押した
  const keep = useRef(keepScroll)
  const isConfirm = useRef(!!onConfirm)
  keep.current = keepScroll
  isConfirm.current = !!onConfirm
  useEffect(() => () => {
    if (!keep.current && (!isConfirm.current || acted.current)) window.scrollTo(0, 0)
  }, [])
  const confirm = () => { acted.current = true; onConfirm?.() }
  // ★noClose … **閉じられないポップアップ**。閉じるボタンを出さず、Escも効かない。
  //   中で操作を1つ選ばせるまで通さない用（デイリーミッションの難易度選択）。
  //   背景は元々クリックしても閉じないので、これで抜け道が無くなる。
  // Escで閉じる（確認のときは「やめる」と同じ扱い）
  useEffect(() => {
    if (noClose) return
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose, noClose])

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:1000, background:'rgba(0,4,16,0.82)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:'16px',
    }}>
      <div style={{
        width:'min(420px, 100%)', maxHeight:'80vh', overflowY:'auto',
        border:`1px solid ${color}`, background:'#001040', fontFamily:'monospace',
        boxShadow:'0 0 24px rgba(0,0,0,0.6)',
      }}>
        <div style={{ padding:'10px 12px', borderBottom:'1px solid #002a55', color, fontSize:'13px' }}>
          {title}
        </div>
        <div style={{ padding:'12px', fontSize:'12px', color:'#88ccff', lineHeight:1.8 }}>
          {children}
        </div>
        {!noClose && (
        <div style={{ padding:'10px 12px', borderTop:'1px solid #002a55', display:'flex', gap:'8px' }}>
          {onConfirm ? (
            <>
              <button onClick={onClose} disabled={busy} style={modalBtn('#88aaff', busy)}>{cancelLabel}</button>
              <button onClick={confirm} disabled={busy} style={modalBtn(danger ? '#ff8844' : '#ffcc00', busy)}>
                {busy ? '処理中...' : confirmLabel}
              </button>
            </>
          ) : (
            <button onClick={onClose} style={{ ...modalBtn('#00aaff', false), flex:1 }}>{closeLabel}</button>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

const modalBtn = (color, busy) => ({
  flex:1, background:'#001840', border:`1px solid ${busy ? '#62789a' : color}`,
  color: busy ? '#445566' : color, padding:'10px', cursor: busy ? 'not-allowed' : 'pointer',
  fontFamily:'monospace', fontSize:'12px',
})
