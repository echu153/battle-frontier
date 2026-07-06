import { Component } from 'react'

// ページ遷移時の未処理エラー（特にデプロイ後の動的チャンク取得失敗）で
// アプリ全体が真っ暗になるのを防ぐ。チャンク取得失敗は自動で1回リロードして回復し、
// それ以外のエラーは復旧UI（再読み込みボタン）を表示する。
const isChunkLoadError = (err) => {
  const msg = String(err?.message || err || '')
  return /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch dynamically|ChunkLoadError/i.test(msg)
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error) {
    // デプロイでチャンクのハッシュが変わった古いタブ対策：1回だけ自動リロード（ループ防止）
    if (isChunkLoadError(error)) {
      const KEY = 'bf_chunkReloadedAt'
      const last = Number(sessionStorage.getItem(KEY) || 0)
      if (Date.now() - last > 10000) {
        sessionStorage.setItem(KEY, String(Date.now()))
        window.location.reload()
      }
    }
    // 開発時の調査用
    console.error('ErrorBoundary caught:', error)
  }

  // 直らないとき用の完全リセット：SWとキャッシュを破棄して再読み込み（ゲームデータには触れない）
  async hardReset() {
    try {
      const regs = await (navigator.serviceWorker?.getRegistrations?.() || [])
      for (const r of regs) { try { await r.unregister() } catch { /* ignore */ } }
    } catch { /* ignore */ }
    try {
      const keys = await (window.caches?.keys?.() || [])
      for (const k of keys) { try { await caches.delete(k) } catch { /* ignore */ } }
    } catch { /* ignore */ }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const emsg = String(this.state.error?.message || this.state.error || '').slice(0, 300)
      const estack = String(this.state.error?.stack || '').split('\n').slice(0, 3).join('\n').slice(0, 400)
      return (
        <div style={{ minHeight:'100vh', background:'#000820', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'monospace', padding:'20px' }}>
          <div style={{ textAlign:'center', maxWidth:'380px' }}>
            <div style={{ color:'#ffcc00', fontSize:'15px', marginBottom:'12px', letterSpacing:'2px' }}>読み込みに失敗しました</div>
            <div style={{ color:'#88aacc', fontSize:'12px', lineHeight:'1.8', marginBottom:'14px' }}>
              一時的な問題が発生しました。<br />再読み込みすると回復します。
            </div>
            <button onClick={() => window.location.reload()}
              style={{ background:'#001840', border:'1px solid #ffcc00', color:'#ffcc00', padding:'10px 24px', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
              🔄 再読み込み
            </button>
            <div style={{ marginTop:10 }}>
              <button onClick={() => this.hardReset()}
                style={{ background:'#180818', border:'1px solid #aa66cc', color:'#cc99ee', padding:'8px 18px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                ⚡ キャッシュを消して再読み込み（直らないとき）
              </button>
            </div>
            {/* 原因調査用のエラー詳細（お問い合わせ時にスクショしてもらう） */}
            {emsg && (
              <div style={{ marginTop:16, textAlign:'left', background:'#050a14', border:'1px solid #223344', padding:8 }}>
                <div style={{ color:'#556677', fontSize:10, marginBottom:4 }}>エラー詳細（お問い合わせ時はこの部分のスクショを添付してください）</div>
                <div style={{ color:'#7788aa', fontSize:10, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>{emsg}{estack ? '\n' + estack : ''}</div>
              </div>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
