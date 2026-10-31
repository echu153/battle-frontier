import { box, miniBtn } from './v2ui.js'

// 新しい版が出ているときの知らせ（挑戦・出撃・塔）。画面が古いまま戦うと、サーバーの計算とずれる（lib/dungeonVerifyCall.js の isStaleBuild）
export default function V2capReloadNote({ what = '挑戦' }) {
  return (
    <div style={{ ...box, padding:'10px', marginBottom:'10px', borderColor:'#8a6a2a' }}>
      <div style={{ fontSize:'12px', color:'#ffd27a', marginBottom:'6px' }}>新しい版が出ています。読み直してから{what}してください</div>
      <button onClick={() => window.location.reload()} style={{ ...miniBtn('#44ddff'), width:'100%', padding:'8px' }}>読み直す</button>
    </div>
  )
}
