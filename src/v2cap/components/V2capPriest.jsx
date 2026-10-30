import { priestSrc, PRIEST_FACE_SIZE, PRIEST_FOCUS } from '../lib/priest.js'

// ============================================================
// 「レベルキャップあり」版 — 神殿の神官（2026-10-31）
//   ・V2capPriest … 吹き出し＋腰から上の絵。絵を押すと onTap（セリフは呼ぶ側＝V2capTemple が lib/priest.js で決める）
//   ・PriestSays … 転職の結果の中の神官（頭から胸までの絵＋吹き出し）。
//     看板娘のとき（2026-10-25）のユーザー指示「ポップアップの裏でセリフ出てるから、ポップアップ上でもイラスト出るようにしたい」と同じ考え
//   ・並べ方（PRIEST_CSS）は看板娘・親方・アレア・テオドールと同じ：広い画面は左にクラス一覧・右に神官（スクロールしても右に残る）。
//     狭い画面（720px以下）は神官（頭から胸）が上・吹き出しが右・クラス一覧が下
//   ・ボタン全体の決まり（src/dev-ui.css の hover の明るさ1.3倍・button::after の光沢）は、親方・テオドールと同じく絵にかけない
//   ・絵は1枚だけ＝話すたびに絵が少し跳ねる。動きは prefers-reduced-motion なら止める
// ============================================================
const ACCENT = '#ff88cc'   // 神殿のタブと同じ桃色
const BUBBLE_BG = '#fff2f9'
const BUBBLE_FG = '#2b1a26'
// 頭から胸までを w×h の枠に出すときの、絵の幅（imgW）と左へのずらし（left）。見せるところは lib/priest.js の PRIEST_FOCUS
const cropOf = (w, h) => {
  const k = h / (PRIEST_FACE_SIZE.h * PRIEST_FOCUS.top)
  return { w, h, imgW: Math.round(PRIEST_FACE_SIZE.w * k), left: Math.round(w / 2 - PRIEST_FOCUS.x * PRIEST_FACE_SIZE.w * k) }
}
const SAY = cropOf(92, 124)     // 転職の結果の中
const THUMB = cropOf(112, 150)  // 狭い画面の上

export const PRIEST_CSS = `
.pst-cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 8px; align-items: start; }
.pst-main { grid-column: 1; grid-row: 1; min-width: 0; }
.pst-side { grid-column: 2; grid-row: 1; position: sticky; top: 44px; }
.pst { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.pst-bubble { position: relative; box-sizing: border-box; width: 100%; min-height: 64px; display: flex; align-items: center;
  background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT}; border-radius: 12px;
  padding: 10px 12px; font-family: monospace; font-size: 13px; line-height: 1.6; }
.pst-bubble::before, .pst-bubble::after { content: ''; position: absolute; left: 50%; transform: translateX(-50%); border: solid transparent; }
.pst-bubble::before { bottom: -12px; border-width: 12px 10px 0; border-top-color: ${ACCENT}; }
.pst-bubble::after { bottom: -8px; border-width: 9px 7px 0; border-top-color: ${BUBBLE_BG}; }
.pst-bubble span { animation: pstSay .22s ease-out; }
.pst-btn { display: block; width: 100%; background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; -webkit-tap-highlight-color: transparent;
  box-shadow: none; border-radius: 0; }
.pst-btn:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 4px; border-radius: 8px; }
/* 光り方は控えめに（看板娘・親方・テオドールと同じ。ボタン全体の決まり＝src/dev-ui.css の hover の brightness(1.3)・active の 0.85 を、神官の絵だけ弱める） */
.pst-btn:not(:disabled):hover { filter: brightness(1.05); }
.pst-btn:not(:disabled):active { filter: brightness(0.95); }
/* ボタン全体の光沢（src/dev-ui.css の button::after）は絵の上に重ねない（親方のとき、透明なところまで四角く色がついて箱の中に立って見えた） */
.pst-btn::after { content: none; }
.pst-btn img { display: block; width: 100%; height: auto; max-height: min(470px, 62vh); object-fit: contain; animation: pstHop .28s ease-out; }
@media (max-width: 720px) {
  .pst-cols { grid-template-columns: minmax(0, 1fr); }
  .pst-side { grid-column: 1; grid-row: 1; position: static; }
  .pst-main { grid-row: 2; }
  .pst { flex-direction: row-reverse; align-items: center; gap: 14px; }
  .pst-btn { flex: 0 0 auto; width: ${THUMB.w}px; height: ${THUMB.h}px; overflow: hidden; }
  .pst-btn img { width: ${THUMB.imgW}px; max-width: none; max-height: none; margin-left: ${THUMB.left}px; }
  .pst-bubble { flex: 1; min-width: 0; }
  .pst-bubble::before { left: -12px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 9px 12px 9px 0; border-color: transparent ${ACCENT} transparent transparent; }
  .pst-bubble::after { left: -8px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 7px 9px 7px 0; border-color: transparent ${BUBBLE_BG} transparent transparent; }
}
.pst-say { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; text-align: left; }
.pst-say-img { flex: 0 0 auto; width: ${SAY.w}px; height: ${SAY.h}px; overflow: hidden; }
.pst-say-img img { display: block; width: ${SAY.imgW}px; max-width: none; height: auto; margin-left: ${SAY.left}px; animation: pstHop .28s ease-out; }
.pst-say-bubble { position: relative; flex: 1; min-width: 0; background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT};
  border-radius: 12px; padding: 8px 10px; font-family: monospace; font-size: 12px; line-height: 1.6; }
.pst-say-bubble span { display: inline-block; animation: pstSay .22s ease-out; }
.pst-say-bubble::before, .pst-say-bubble::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); border: solid transparent; }
.pst-say-bubble::before { left: -12px; border-width: 9px 12px 9px 0; border-right-color: ${ACCENT}; }
.pst-say-bubble::after { left: -8px; border-width: 7px 9px 7px 0; border-right-color: ${BUBBLE_BG}; }
@keyframes pstSay { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
@keyframes pstHop { 0% { transform: translateY(0) } 40% { transform: translateY(-6px) } 100% { transform: translateY(0) } }
@media (prefers-reduced-motion: reduce) { .pst-bubble span, .pst-btn img, .pst-say-img img, .pst-say-bubble span { animation: none !important } }
`

// face＝絵のキー（lib/priest.js の PRIEST_FACES・いまは普通だけ）・line＝吹き出しの文・tick＝話すたびに変わる数（同じ絵でも跳ねさせる）
export default function V2capPriest({ face = 'normal', line = '', tick = 0, onTap }) {
  return (
    <div className="pst">
      <div className="pst-bubble" aria-live="polite"><span key={`${tick}-${line}`}>{line}</span></div>
      <button type="button" className="pst-btn" onClick={onTap} aria-label="神官に話しかける">
        <img key={tick} src={priestSrc(face)} alt="" width={PRIEST_FACE_SIZE.w} height={PRIEST_FACE_SIZE.h} />
      </button>
    </div>
  )
}

// 転職の結果の中の神官（頭から胸までの絵＋吹き出し）
export function PriestSays({ face = 'normal', line = '' }) {
  return (
    <div className="pst-say">
      <div className="pst-say-img"><img src={priestSrc(face)} alt="" width={SAY.imgW} height={Math.round(SAY.imgW * PRIEST_FACE_SIZE.h / PRIEST_FACE_SIZE.w)} /></div>
      <div className="pst-say-bubble"><span key={line}>{line}</span></div>
    </div>
  )
}
