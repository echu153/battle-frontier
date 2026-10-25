import { useEffect } from 'react'
import { masterSrc, MASTER_FACE_KEYS, MASTER_FACE_SIZE, MASTER_FOCUS } from '../lib/smithMaster.js'

// ============================================================
// 「レベルキャップあり」版 — 鍛冶屋の親方トルステン（2026-10-26）
//   ・V2capSmithMaster … 吹き出し＋腰から上の絵。絵を押すと onTap（セリフと表情は呼ぶ側＝V2capSmith が lib/smithMaster.js で決める）
//   ・MasterSays … ポップアップの中の親方（頭から胸までの絵＋吹き出し）。強化・作成の結果と、足りなくて強化できないとき
//   ・並べ方（MASTER_CSS）は看板娘（V2capClerk.jsx）と同じ：広い画面は左に鍛冶屋・右に親方（スクロールしても右に残る）。
//     狭い画面（720px以下）は親方が上・鍛冶屋が下で、絵は頭から胸までを小さく、吹き出しは右
//   ・動きは prefers-reduced-motion なら止める
// ============================================================
const ACCENT = '#ffaa44'   // 鍛冶屋のタブと同じ橙
const BUBBLE_BG = '#fff1e0'
const BUBBLE_FG = '#2b1a0e'
// 頭から胸までを w×h の枠に出すときの、絵の幅（imgW）と左へのずらし（left）。見せるところは lib/smithMaster.js の MASTER_FOCUS
const cropOf = (w, h) => {
  const k = h / (MASTER_FACE_SIZE.h * MASTER_FOCUS.top)
  return { w, h, imgW: Math.round(MASTER_FACE_SIZE.w * k), left: Math.round(w / 2 - MASTER_FOCUS.x * MASTER_FACE_SIZE.w * k) }
}
const SAY = cropOf(92, 124)     // ポップアップの中
const THUMB = cropOf(112, 150)  // 狭い画面の上

export const MASTER_CSS = `
.smm-cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 8px; align-items: start; }
.smm-main { grid-column: 1; grid-row: 1; min-width: 0; }
.smm-side { grid-column: 2; grid-row: 1; position: sticky; top: 44px; }
.smm { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.smm-bubble { position: relative; box-sizing: border-box; width: 100%; min-height: 64px; display: flex; align-items: center;
  background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT}; border-radius: 12px;
  padding: 10px 12px; font-family: monospace; font-size: 13px; line-height: 1.6; }
.smm-bubble::before, .smm-bubble::after { content: ''; position: absolute; left: 50%; transform: translateX(-50%); border: solid transparent; }
.smm-bubble::before { bottom: -12px; border-width: 12px 10px 0; border-top-color: ${ACCENT}; }
.smm-bubble::after { bottom: -8px; border-width: 9px 7px 0; border-top-color: ${BUBBLE_BG}; }
.smm-bubble span { animation: smmSay .22s ease-out; }
.smm-btn { display: block; width: 100%; background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; -webkit-tap-highlight-color: transparent;
  box-shadow: none; border-radius: 0; }
.smm-btn:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 4px; border-radius: 8px; }
/* 光り方は控えめに（看板娘と同じ。ボタン全体の決まり＝src/dev-ui.css の hover の brightness(1.3)・active の 0.85 を、親方の絵だけ弱める） */
.smm-btn:not(:disabled):hover { filter: brightness(1.05); }
.smm-btn:not(:disabled):active { filter: brightness(0.95); }
/* ボタン全体の光沢（src/dev-ui.css の button::after＝上を明るく下を暗くするグラデーション）は、親方の絵の上には重ねない。
   重ねると、絵の透明なところまで四角く色がつき、親方が箱の中に立って見えた（2026-10-26） */
.smm-btn::after { content: none; }
.smm-btn img { display: block; width: 100%; height: auto; max-height: min(470px, 62vh); object-fit: contain; animation: smmHop .28s ease-out; }
@media (max-width: 720px) {
  .smm-cols { grid-template-columns: minmax(0, 1fr); }
  .smm-side { grid-column: 1; grid-row: 1; position: static; }
  .smm-main { grid-row: 2; }
  .smm { flex-direction: row-reverse; align-items: center; gap: 14px; }
  .smm-btn { flex: 0 0 auto; width: ${THUMB.w}px; height: ${THUMB.h}px; overflow: hidden; }
  .smm-btn img { width: ${THUMB.imgW}px; max-width: none; max-height: none; margin-left: ${THUMB.left}px; }
  .smm-bubble { flex: 1; min-width: 0; }
  .smm-bubble::before { left: -12px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 9px 12px 9px 0; border-color: transparent ${ACCENT} transparent transparent; }
  .smm-bubble::after { left: -8px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 7px 9px 7px 0; border-color: transparent ${BUBBLE_BG} transparent transparent; }
}
.smm-say { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; text-align: left; }
.smm-say-img { flex: 0 0 auto; width: ${SAY.w}px; height: ${SAY.h}px; overflow: hidden; }
.smm-say-img img { display: block; width: ${SAY.imgW}px; max-width: none; height: auto; margin-left: ${SAY.left}px; animation: smmHop .28s ease-out; }
.smm-say-bubble { position: relative; flex: 1; min-width: 0; background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT};
  border-radius: 12px; padding: 8px 10px; font-family: monospace; font-size: 12px; line-height: 1.6; }
.smm-say-bubble span { display: inline-block; animation: smmSay .22s ease-out; }
.smm-say-bubble::before, .smm-say-bubble::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); border: solid transparent; }
.smm-say-bubble::before { left: -12px; border-width: 9px 12px 9px 0; border-right-color: ${ACCENT}; }
.smm-say-bubble::after { left: -8px; border-width: 7px 9px 7px 0; border-right-color: ${BUBBLE_BG}; }
@keyframes smmSay { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
@keyframes smmHop { 0% { transform: translateY(0) } 40% { transform: translateY(-6px) } 100% { transform: translateY(0) } }
@media (prefers-reduced-motion: reduce) { .smm-bubble span, .smm-btn img, .smm-say-img img, .smm-say-bubble span { animation: none !important } }
`

// 表情を切り替えたときに待たないように、3枚とも先に読んでおく
const preloadMaster = () => {
  for (const k of MASTER_FACE_KEYS) { const img = new Image(); img.src = masterSrc(k) }
}

// face＝表情のキー（lib/smithMaster.js の MASTER_FACES）・line＝吹き出しの文・tick＝話すたびに変わる数（同じ表情でも跳ねさせる）
export default function V2capSmithMaster({ face = 'normal', line = '', tick = 0, onTap }) {
  useEffect(preloadMaster, [])
  return (
    <div className="smm">
      <div className="smm-bubble" aria-live="polite"><span key={`${tick}-${line}`}>{line}</span></div>
      <button type="button" className="smm-btn" onClick={onTap} aria-label="親方に話しかける">
        <img key={tick} src={masterSrc(face)} alt="" width={MASTER_FACE_SIZE.w} height={MASTER_FACE_SIZE.h} />
      </button>
    </div>
  )
}

// ポップアップの中の親方（頭から胸までの絵＋吹き出し）。
// 看板娘のとき（2026-10-25）のユーザー指示「スマホ画面で…ポップアップ出るとこまで行くとイラスト見えない」「ポップアップの裏でセリフ出てるから、ポップアップ上でもイラスト出るようにしたい」と同じ考え
export function MasterSays({ face = 'normal', line = '' }) {
  return (
    <div className="smm-say">
      <div className="smm-say-img"><img src={masterSrc(face)} alt="" width={SAY.imgW} height={Math.round(SAY.imgW * MASTER_FACE_SIZE.h / MASTER_FACE_SIZE.w)} /></div>
      <div className="smm-say-bubble"><span key={line}>{line}</span></div>
    </div>
  )
}
