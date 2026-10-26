import { useEffect, useState } from 'react'
import { MEAL_COLOR } from '../lib/burger.js'
import { clerkSrc, CLERK_FACE_KEYS, CLERK_FACE_SIZE, CLERK_WELCOME } from '../lib/clerk.js'

// ============================================================
// 「レベルキャップあり」版 — ニャーガーキングの看板娘（2026-10-25）
//   ・V2capClerk … 吹き出し＋腰から上の絵。絵を押すと onTap（セリフと表情は呼ぶ側＝V2capBurger が lib/clerk.js で決める）
//   ・V2capClerkWelcome … その日はじめて店に入るときの全身の「いらっしゃいませー！」。画面いっぱい・どこを押しても閉じる（Escでも）。
//     【2026-10-26】店の画面を出す前に、ホームの上で出す（V2capHome）＝閉じたら店の画面へ
//   ・並べ方（CLERK_CSS）：広い画面は左にメニュー・右に看板娘（スクロールしても右に残る）。狭い画面（720px以下）は看板娘が上・メニューが下で、
//     絵は頭から胸までを小さく、吹き出しは右
//   ・動きは prefers-reduced-motion なら止める
// ============================================================
const BUBBLE_BG = '#fff4e2'
const BUBBLE_FG = '#3a1d0c'

export const CLERK_CSS = `
.nk-cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 8px; align-items: start; max-width: 980px; }
.nk-menu { grid-column: 1; grid-row: 1; min-width: 0; }
.nk-side { grid-column: 2; grid-row: 1; position: sticky; top: 44px; }
.nk-clerk { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.nk-bubble { position: relative; box-sizing: border-box; width: 100%; min-height: 64px; display: flex; align-items: center;
  background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${MEAL_COLOR}; border-radius: 12px;
  padding: 10px 12px; font-family: monospace; font-size: 13px; line-height: 1.6; }
.nk-bubble::before, .nk-bubble::after { content: ''; position: absolute; left: 50%; transform: translateX(-50%); border: solid transparent; }
.nk-bubble::before { bottom: -12px; border-width: 12px 10px 0; border-top-color: ${MEAL_COLOR}; }
.nk-bubble::after { bottom: -8px; border-width: 9px 7px 0; border-top-color: ${BUBBLE_BG}; }
.nk-bubble span { animation: nkSay .22s ease-out; }
.nk-clerk-btn { background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; -webkit-tap-highlight-color: transparent;
  box-shadow: none; border-radius: 0; }
.nk-clerk-btn:focus-visible { outline: 2px solid ${MEAL_COLOR}; outline-offset: 4px; border-radius: 8px; }
/* 光り方は控えめに（2026-10-25 ユーザー指示「タップするとき発光しすぎ…枠の白枠はそのままでいい」）。
   ボタン全体の決まり（src/dev-ui.css の hover＝brightness(1.3)・active＝0.85）を、看板娘の絵だけ弱める。枠（影の光）はそのまま */
.nk-clerk-btn:not(:disabled):hover { filter: brightness(1.05); }
.nk-clerk-btn:not(:disabled):active { filter: brightness(0.95); }
.nk-clerk-btn img { display: block; height: min(470px, 62vh); width: auto; max-width: 100%; animation: nkHop .28s ease-out; }
@media (max-width: 720px) {
  .nk-cols { grid-template-columns: minmax(0, 1fr); }
  .nk-side { grid-column: 1; grid-row: 1; position: static; }
  .nk-menu { grid-row: 2; }
  .nk-clerk { flex-direction: row-reverse; align-items: center; gap: 14px; }
  .nk-clerk-btn { flex: 0 0 auto; width: 112px; height: 150px; overflow: hidden; }
  .nk-clerk-btn img { width: 112px; height: auto; }
  .nk-bubble { flex: 1; min-width: 0; }
  .nk-bubble::before { left: -12px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 9px 12px 9px 0; border-color: transparent ${MEAL_COLOR} transparent transparent; }
  .nk-bubble::after { left: -8px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 7px 9px 7px 0; border-color: transparent ${BUBBLE_BG} transparent transparent; }
}
.nk-say { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; }
.nk-say-img { flex: 0 0 auto; width: 92px; height: 124px; overflow: hidden; }
.nk-say-img img { display: block; width: 92px; height: auto; animation: nkHop .28s ease-out; }
.nk-say-bubble { position: relative; flex: 1; min-width: 0; background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${MEAL_COLOR};
  border-radius: 12px; padding: 8px 10px; font-family: monospace; font-size: 12px; line-height: 1.6; }
.nk-say-bubble span { display: inline-block; animation: nkSay .22s ease-out; }
.nk-say-bubble::before, .nk-say-bubble::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); border: solid transparent; }
.nk-say-bubble::before { left: -12px; border-width: 9px 12px 9px 0; border-right-color: ${MEAL_COLOR}; }
.nk-say-bubble::after { left: -8px; border-width: 7px 9px 7px 0; border-right-color: ${BUBBLE_BG}; }
@keyframes nkSay { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
@keyframes nkHop { 0% { transform: translateY(0) } 40% { transform: translateY(-6px) } 100% { transform: translateY(0) } }
@media (prefers-reduced-motion: reduce) { .nk-bubble span, .nk-clerk-btn img, .nk-say-img img, .nk-say-bubble span { animation: none !important } }
`

// 全身の「いらっしゃいませー！」の見た目。店の画面を出す前（ホームの上）にも出すので、CLERK_CSS とは分けて自分で持つ。
// 絵が届くまでは隠しておき（nk-welcome-wait）、届いたら跳ねて出す（吹き出しだけ先に出ないように）
const WELCOME_CSS = `
.nk-welcome { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; cursor: pointer;
  background: radial-gradient(circle at 50% 45%, rgba(120, 52, 10, 0.55) 0%, rgba(8, 4, 2, 0.9) 70%); animation: nkFade .25s ease-out; }
.nk-welcome-in { position: relative; display: flex; flex-direction: column; align-items: center; animation: nkPop .55s cubic-bezier(.2, 1.4, .4, 1); }
.nk-welcome-wait { visibility: hidden; animation: none; }
.nk-welcome-img { display: block; height: min(76vh, 860px); width: auto; max-width: 94vw; object-fit: contain; }
.nk-welcome-bubble { position: relative; z-index: 1; align-self: flex-end; margin: 0 6% -3% 0; white-space: nowrap;
  background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 3px solid ${MEAL_COLOR}; border-radius: 16px; padding: 8px 18px;
  font-family: monospace; font-weight: bold; font-size: clamp(16px, 3.8vmin, 28px); line-height: 1.4; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); }
.nk-welcome-bubble::before, .nk-welcome-bubble::after { content: ''; position: absolute; left: 22%; border: solid transparent; }
.nk-welcome-bubble::before { bottom: -16px; border-width: 16px 14px 0 0; border-top-color: ${MEAL_COLOR}; }
.nk-welcome-bubble::after { bottom: -10px; left: calc(22% + 3px); border-width: 11px 9px 0 0; border-top-color: ${BUBBLE_BG}; }
.nk-welcome-hint { position: fixed; left: 0; right: 0; bottom: max(16px, env(safe-area-inset-bottom, 0px)); text-align: center;
  color: #ffd9a8; font-family: monospace; font-size: 12px; opacity: .85; }
@keyframes nkFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes nkPop { 0% { opacity: 0; transform: translateY(60px) scale(.7) } 60% { opacity: 1; transform: translateY(-8px) scale(1.03) } 100% { transform: none } }
@media (prefers-reduced-motion: reduce) { .nk-welcome, .nk-welcome-in { animation: none !important } }
`

// 表情を切り替えたときに待たないように、全部の絵を先に読んでおく
const preloadClerk = () => {
  for (const k of [...CLERK_FACE_KEYS, CLERK_WELCOME.key]) { const img = new Image(); img.src = clerkSrc(k) }
}

// face＝表情のキー（lib/clerk.js の CLERK_FACES）・line＝吹き出しの文・tick＝押すたびに変わる数（同じ表情でも跳ねさせる）
export default function V2capClerk({ face = 'normal', line = '', tick = 0, onTap }) {
  useEffect(preloadClerk, [])
  return (
    <div className="nk-clerk">
      <div className="nk-bubble" aria-live="polite"><span key={`${tick}-${line}`}>{line}</span></div>
      <button type="button" className="nk-clerk-btn" onClick={onTap} aria-label="店員さんに話しかける">
        <img key={tick} src={clerkSrc(face)} alt="" width={CLERK_FACE_SIZE.w} height={CLERK_FACE_SIZE.h} />
      </button>
    </div>
  )
}

// ポップアップの中の看板娘（頭から胸までの絵＋吹き出し）。
// 【確定】2026-10-25 ユーザー指示「スマホ画面で注文画面のポップアップ出るとこまで行くと店員のイラスト見えないからポップアップに画像を追加」
//   「ポップアップの裏でセリフ出てるから、ポップアップ上でもイラスト出るようにしたい」＝食べ直しの確かめと、出したときのポップアップに出す
export function ClerkSays({ face = 'normal', line = '' }) {
  return (
    <div className="nk-say">
      <div className="nk-say-img"><img src={clerkSrc(face)} alt="" width={92} height={Math.round(92 * CLERK_FACE_SIZE.h / CLERK_FACE_SIZE.w)} /></div>
      <div className="nk-say-bubble"><span key={line}>{line}</span></div>
    </div>
  )
}

// 全身の絵を先に読んでおく（ホームで、その日の「いらっしゃいませー！」がまだのときに呼ぶ）
export const preloadClerkWelcome = () => { const img = new Image(); img.src = clerkSrc(CLERK_WELCOME.key) }

export function V2capClerkWelcome({ line, onClose }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="nk-welcome" role="dialog" aria-modal="true" aria-label={line} onClick={onClose}>
      <style>{WELCOME_CSS}</style>
      <div className={ready ? 'nk-welcome-in' : 'nk-welcome-in nk-welcome-wait'}>
        <div className="nk-welcome-bubble">{line}</div>
        <img className="nk-welcome-img" src={clerkSrc(CLERK_WELCOME.key)} alt=""
          onLoad={() => setReady(true)} onError={() => setReady(true)} />
      </div>
      <div className="nk-welcome-hint">タップで閉じる</div>
    </div>
  )
}
