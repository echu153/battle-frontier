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

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight:'100vh', background:'#000820', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'monospace', padding:'20px' }}>
          <div style={{ textAlign:'center', maxWidth:'360px' }}>
            <div style={{ color:'#ffcc00', fontSize:'15px', marginBottom:'12px', letterSpacing:'2px' }}>読み込みに失敗しました</div>
            <div style={{ color:'#88aacc', fontSize:'12px', lineHeight:'1.8', marginBottom:'20px' }}>
              一時的な問題が発生しました。<br />再読み込みすると回復します。
            </div>
            <button onClick={() => window.location.reload()}
              style={{ background:'#001840', border:'1px solid #ffcc00', color:'#ffcc00', padding:'10px 24px', cursor:'pointer', fontFamily:'monospace', fontSize:'13px' }}>
              🔄 再読み込み
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
