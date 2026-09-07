// ペットのミニゲームの試し撃ち（開発用・コミットしない）
import { createRoot } from 'react-dom/client'
import V2Pet from './src/v2/components/V2Pet.jsx'

// ★検証用の時計の差し替え（?pump を付けたときだけ）。
//   ブラウザペインを表示していないタブは document.hidden になり、
//   requestAnimationFrame が一度も呼ばれない＝積み上げ耐久が進まない。
//   setTimeout も hidden だと1秒に丸められるので、MessageChannel で回す。
//   時刻は**最初の呼び出しで performance.now() に合わせてから**進める
//   （呼び出し側は last = performance.now() で始めるので、ズレていると dt が負になる）。
if (new URLSearchParams(location.search).has('pump')) {
  const ch = new MessageChannel()
  const queue = []
  let t = null
  let id = 0
  const cancelled = new Set()
  ch.port1.onmessage = () => {
    const job = queue.shift()
    if (!job) return
    if (cancelled.has(job.id)) { cancelled.delete(job.id); return }
    if (t === null) t = performance.now()
    t += 16
    job.cb(t)
  }
  window.requestAnimationFrame = (cb) => {
    const my = ++id
    queue.push({ id: my, cb })
    ch.port2.postMessage(0)
    return my
  }
  window.cancelAnimationFrame = (x) => cancelled.add(x)
}

createRoot(document.getElementById('root')).render(
  <V2Pet onBack={() => {}} />
)
