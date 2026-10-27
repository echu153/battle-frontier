import { useEffect, useState } from 'react'
import { aleaSrc, ALEA_FACE_KEYS, ALEA_FACE_SIZE, ALEA_FOCUS, ALEA_WELCOME, ALEA_THUMB, ALEA_SIDE_MIN_W } from '../lib/alea.js'

// ============================================================
// 「レベルキャップあり」版 — 賭博場のカクテルウェイトレス、アレア（2026-10-27）
//   ・V2capAlea … 吹き出し＋腰から上の絵。絵を押すと onTap（セリフと表情は呼ぶ側＝V2capCasino が lib/alea.js で決める）
//   ・AleaSays … 当たりの演出（BIG WIN など・画面いっぱいに暗くして出る）の上のアレア（頭から胸までの絵＋吹き出し）。
//     看板娘のとき（2026-10-25）のユーザー指示「ポップアップの裏でセリフ出てるから、ポップアップ上でもイラスト出るようにしたい」と同じ考え
//   ・V2capAleaWelcome … その日はじめて賭博場に入るときの全身の「いらっしゃい」。画面いっぱい・どこを押しても閉じる（Escでも）。
//     賭博場の画面を出す前に、ホームの上で出す（V2capHome）＝閉じたら賭博場の画面へ（看板娘と同じ）
//   ・並べ方（ALEA_CSS）：広い画面は左に賭博場・右にアレア（スクロールしても右に残る＝看板娘・親方と同じ）。
//     【2026-10-27 直した】ユーザー指示「イラスト作ったせいでスクロールしないとルーレットとかできなくなったから画像の部分調整したい」：
//     右に立たせるのは ALEA_SIDE_MIN_W（1081px）以上だけ（ゲームが横いっぱいを使えるように）。それより狭いときは
//     アレア（頭から胸・ALEA_THUMB）を上の細い帯にして、吹き出しは右（前は 720px で切り替え・絵は 112×150）。開発用のボタンも帯のときは出さない
//   ・ボタン全体の決まり（src/dev-ui.css の hover の明るさ1.3倍・button::after の光沢）は、親方と同じく絵にかけない
//   ・動きは prefers-reduced-motion なら止める
// ============================================================
const ACCENT = '#e0457b'   // ワインレッドを暗い画面で見えるように明るくした色
const BUBBLE_BG = '#fdf0f5'
const BUBBLE_FG = '#2a0f1c'
// 頭から胸までを w×h の枠に出すときの、絵の幅（imgW）と左へのずらし（left）。見せるところは lib/alea.js の ALEA_FOCUS
const cropOf = (w, h) => {
  const k = h / (ALEA_FACE_SIZE.h * ALEA_FOCUS.top)
  return { w, h, imgW: Math.round(ALEA_FACE_SIZE.w * k), left: Math.round(w / 2 - ALEA_FOCUS.x * ALEA_FACE_SIZE.w * k) }
}
const SAY = cropOf(92, 124)     // 当たりの演出の上
const THUMB = cropOf(ALEA_THUMB.w, ALEA_THUMB.h)  // 幅が足りないときの上の帯

export const ALEA_CSS = `
.al-cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 8px; align-items: start; }
.al-main { grid-column: 1; grid-row: 1; min-width: 0; }
.al-side { grid-column: 2; grid-row: 1; position: sticky; top: 44px; }
.al { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.al-bubble { position: relative; box-sizing: border-box; width: 100%; min-height: 64px; display: flex; align-items: center;
  background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT}; border-radius: 12px;
  padding: 10px 12px; font-family: monospace; font-size: 13px; line-height: 1.6; }
.al-bubble::before, .al-bubble::after { content: ''; position: absolute; left: 50%; transform: translateX(-50%); border: solid transparent; }
.al-bubble::before { bottom: -12px; border-width: 12px 10px 0; border-top-color: ${ACCENT}; }
.al-bubble::after { bottom: -8px; border-width: 9px 7px 0; border-top-color: ${BUBBLE_BG}; }
.al-bubble span { animation: alSay .22s ease-out; }
.al-btn { display: block; width: 100%; background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; -webkit-tap-highlight-color: transparent;
  box-shadow: none; border-radius: 0; }
.al-btn:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 4px; border-radius: 8px; }
/* 光り方は控えめに（看板娘・親方と同じ。ボタン全体の決まり＝src/dev-ui.css の hover の brightness(1.3)・active の 0.85 を、アレアの絵だけ弱める） */
.al-btn:not(:disabled):hover { filter: brightness(1.05); }
.al-btn:not(:disabled):active { filter: brightness(0.95); }
/* ボタン全体の光沢（src/dev-ui.css の button::after）は絵の上に重ねない（親方のとき、透明なところまで四角く色がついて箱の中に立って見えた） */
.al-btn::after { content: none; }
.al-btn img { display: block; width: 100%; height: auto; max-height: min(470px, 62vh); object-fit: contain; animation: alHop .28s ease-out; }
@media (max-width: ${ALEA_SIDE_MIN_W - 1}px) {
  .al-cols { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .al-side { grid-column: 1; grid-row: 1; position: static; }
  .al-main { grid-row: 2; }
  .al-dev { display: none; }
  .al { flex-direction: row-reverse; align-items: center; gap: 12px; }
  .al-btn { flex: 0 0 auto; width: ${THUMB.w}px; height: ${THUMB.h}px; overflow: hidden; }
  .al-btn img { width: ${THUMB.imgW}px; max-width: none; max-height: none; margin-left: ${THUMB.left}px; }
  .al-bubble { flex: 1; min-width: 0; min-height: 0; padding: 7px 10px; font-size: 12px; line-height: 1.5; }
  .al-bubble::before { left: -12px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 9px 12px 9px 0; border-color: transparent ${ACCENT} transparent transparent; }
  .al-bubble::after { left: -8px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 7px 9px 7px 0; border-color: transparent ${BUBBLE_BG} transparent transparent; }
}
.al-say { display: flex; align-items: center; gap: 14px; text-align: left; max-width: 380px; margin: 14px auto 0; }
.al-say-img { flex: 0 0 auto; width: ${SAY.w}px; height: ${SAY.h}px; overflow: hidden; }
.al-say-img img { display: block; width: ${SAY.imgW}px; max-width: none; height: auto; margin-left: ${SAY.left}px; animation: alHop .28s ease-out; }
.al-say-bubble { position: relative; flex: 1; min-width: 0; background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT};
  border-radius: 12px; padding: 8px 10px; font-family: monospace; font-size: 12px; line-height: 1.6; }
.al-say-bubble span { display: inline-block; animation: alSay .22s ease-out; }
.al-say-bubble::before, .al-say-bubble::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); border: solid transparent; }
.al-say-bubble::before { left: -12px; border-width: 9px 12px 9px 0; border-right-color: ${ACCENT}; }
.al-say-bubble::after { left: -8px; border-width: 7px 9px 7px 0; border-right-color: ${BUBBLE_BG}; }
@keyframes alSay { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
@keyframes alHop { 0% { transform: translateY(0) } 40% { transform: translateY(-6px) } 100% { transform: translateY(0) } }
@media (prefers-reduced-motion: reduce) { .al-bubble span, .al-btn img, .al-say-img img, .al-say-bubble span { animation: none !important } }
`

// 全身の「いらっしゃい」の見た目。賭博場の画面を出す前（ホームの上）に出すので、ALEA_CSS とは分けて自分で持つ。
// 絵が届くまでは隠しておき（al-welcome-wait）、届いたら出す（吹き出しだけ先に出ないように）。後ろのゲーム画面は暗くする（看板娘と同じ）
const WELCOME_CSS = `
.al-welcome { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; cursor: pointer;
  background: radial-gradient(circle at 50% 45%, rgba(130, 28, 72, 0.35) 0%, rgba(130, 28, 72, 0) 60%), rgba(4, 2, 6, 0.92); animation: alFade .3s ease-out; }
.al-welcome-in { position: relative; display: flex; flex-direction: column; align-items: center; animation: alRise .7s cubic-bezier(.2, .9, .3, 1); }
.al-welcome-wait { visibility: hidden; animation: none; }
.al-welcome-img { display: block; height: min(76vh, 860px); width: auto; max-width: 94vw; object-fit: contain; }
.al-welcome-bubble { position: relative; z-index: 1; align-self: flex-end; margin: 0 6% -3% 0; white-space: nowrap;
  background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 3px solid ${ACCENT}; border-radius: 16px; padding: 8px 18px;
  font-family: monospace; font-weight: bold; font-size: clamp(15px, 3.4vmin, 26px); line-height: 1.4; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); }
.al-welcome-bubble::before, .al-welcome-bubble::after { content: ''; position: absolute; left: 22%; border: solid transparent; }
.al-welcome-bubble::before { bottom: -16px; border-width: 16px 14px 0 0; border-top-color: ${ACCENT}; }
.al-welcome-bubble::after { bottom: -10px; left: calc(22% + 3px); border-width: 11px 9px 0 0; border-top-color: ${BUBBLE_BG}; }
.al-welcome-hint { position: fixed; left: 0; right: 0; bottom: max(16px, env(safe-area-inset-bottom, 0px)); text-align: center;
  color: #f3c6d8; font-family: monospace; font-size: 12px; opacity: .85; }
@keyframes alFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes alRise { 0% { opacity: 0; transform: translateY(40px) } 100% { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .al-welcome, .al-welcome-in { animation: none !important } }
`

// 表情を切り替えたときに待たないように、5枚とも先に読んでおく
const preloadAlea = () => {
  for (const k of ALEA_FACE_KEYS) { const img = new Image(); img.src = aleaSrc(k) }
}

// face＝表情のキー（lib/alea.js の ALEA_FACES）・line＝吹き出しの文・tick＝話すたびに変わる数（同じ表情でも跳ねさせる）
export default function V2capAlea({ face = 'normal', line = '', tick = 0, onTap }) {
  useEffect(preloadAlea, [])
  return (
    <div className="al">
      <div className="al-bubble" aria-live="polite"><span key={`${tick}-${line}`}>{line}</span></div>
      <button type="button" className="al-btn" onClick={onTap} aria-label="店員さんに話しかける">
        <img key={tick} src={aleaSrc(face)} alt="" width={ALEA_FACE_SIZE.w} height={ALEA_FACE_SIZE.h} />
      </button>
    </div>
  )
}

// 当たりの演出の上のアレア（頭から胸までの絵＋吹き出し）
export function AleaSays({ face = 'normal', line = '' }) {
  return (
    <div className="al-say">
      <div className="al-say-img"><img src={aleaSrc(face)} alt="" width={SAY.imgW} height={Math.round(SAY.imgW * ALEA_FACE_SIZE.h / ALEA_FACE_SIZE.w)} /></div>
      <div className="al-say-bubble"><span key={line}>{line}</span></div>
    </div>
  )
}

// 全身の絵を先に読んでおく（ホームで、その日の「いらっしゃい」がまだのときに呼ぶ）
export const preloadAleaWelcome = () => { const img = new Image(); img.src = aleaSrc(ALEA_WELCOME.key) }

export function V2capAleaWelcome({ line, onClose }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="al-welcome" role="dialog" aria-modal="true" aria-label={line} onClick={onClose}>
      <style>{WELCOME_CSS}</style>
      <div className={ready ? 'al-welcome-in' : 'al-welcome-in al-welcome-wait'}>
        <div className="al-welcome-bubble">{line}</div>
        <img className="al-welcome-img" src={aleaSrc(ALEA_WELCOME.key)} alt=""
          onLoad={() => setReady(true)} onError={() => setReady(true)} />
      </div>
      <div className="al-welcome-hint">タップで閉じる</div>
    </div>
  )
}
