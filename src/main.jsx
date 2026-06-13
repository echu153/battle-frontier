import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 新UIテーマ(ボタンの立体化など)。本番にも反映中。
// 旧UIに戻すときは下を `if (import.meta.env.DEV)` に戻せばよい。
import('./dev-ui.css')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
