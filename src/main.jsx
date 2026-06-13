import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 開発環境(npm run dev)のときだけ新UIテーマを適用。本番ビルドには含まれない
if (import.meta.env.DEV) {
  import('./dev-ui.css')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
