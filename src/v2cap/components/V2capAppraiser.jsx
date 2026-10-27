import { owlSrc, OWL_FACE_SIZE, OWL_FOCUS } from '../lib/appraiser.js'

// ============================================================
// 「レベルキャップあり」版 — 博物館の鑑定士テオドール（2026-10-27）
//   ・V2capAppraiser … 吹き出し＋床に座った全身の絵。絵を押すと onTap（セリフは呼ぶ側＝V2capMuseum が lib/appraiser.js で決める）
//   ・AppraiserSays … 寄贈の結果のポップアップの中の鑑定士（頭から胸までの絵＋吹き出し）。
//     看板娘のとき（2026-10-25）のユーザー指示「ポップアップの裏でセリフ出てるから、ポップアップ上でもイラスト出るようにしたい」と同じ考え
//   ・並べ方（OWL_CSS）は看板娘・親方・受付嬢と同じ：広い画面は左に博物館・右に鑑定士（スクロールしても右に残る）。
//     狭い画面（720px以下）は鑑定士（頭から胸）が上・吹き出しが右・博物館が下
//   ・ボタン全体の決まり（src/dev-ui.css の hover の明るさ1.3倍・button::after の光沢）は、親方・受付嬢と同じく絵にかけない
//   ・表情は1枚だけ＝話すたびに絵が少し跳ねる。動きは prefers-reduced-motion なら止める
// ============================================================
const ACCENT = '#d8b070'   // 博物館のタブと同じ金
const BUBBLE_BG = '#fbf3e2'
const BUBBLE_FG = '#2a1f10'
// 頭から胸までを w×h の枠に出すときの、絵の幅（imgW）と左へのずらし（left）。見せるところは lib/appraiser.js の OWL_FOCUS
const cropOf = (w, h) => {
  const k = h / (OWL_FACE_SIZE.h * OWL_FOCUS.top)
  return { w, h, imgW: Math.round(OWL_FACE_SIZE.w * k), left: Math.round(w / 2 - OWL_FOCUS.x * OWL_FACE_SIZE.w * k) }
}
// 枠は正方形（看板娘・親方・受付嬢は縦長）：フクロウは耳の飾り羽で頭が横に広く、縦長の枠だとどの高さでも飾り羽が左右で切れた（2026-10-27 見比べた）
const SAY = cropOf(108, 108)    // ポップアップの中
const THUMB = cropOf(132, 132)  // 狭い画面の上

export const OWL_CSS = `
.owl-cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 8px; align-items: start; }
.owl-main { grid-column: 1; grid-row: 1; min-width: 0; }
.owl-side { grid-column: 2; grid-row: 1; position: sticky; top: 44px; }
.owl { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.owl-bubble { position: relative; box-sizing: border-box; width: 100%; min-height: 64px; display: flex; align-items: center;
  background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT}; border-radius: 12px;
  padding: 10px 12px; font-family: monospace; font-size: 13px; line-height: 1.6; }
.owl-bubble::before, .owl-bubble::after { content: ''; position: absolute; left: 50%; transform: translateX(-50%); border: solid transparent; }
.owl-bubble::before { bottom: -12px; border-width: 12px 10px 0; border-top-color: ${ACCENT}; }
.owl-bubble::after { bottom: -8px; border-width: 9px 7px 0; border-top-color: ${BUBBLE_BG}; }
.owl-bubble span { animation: owlSay .22s ease-out; }
.owl-btn { display: block; width: 100%; background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; -webkit-tap-highlight-color: transparent;
  box-shadow: none; border-radius: 0; }
.owl-btn:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 4px; border-radius: 8px; }
/* 光り方は控えめに（看板娘・親方・受付嬢と同じ。ボタン全体の決まり＝src/dev-ui.css の hover の brightness(1.3)・active の 0.85 を、鑑定士の絵だけ弱める） */
.owl-btn:not(:disabled):hover { filter: brightness(1.05); }
.owl-btn:not(:disabled):active { filter: brightness(0.95); }
/* ボタン全体の光沢（src/dev-ui.css の button::after）は絵の上に重ねない（親方のとき、透明なところまで四角く色がついて箱の中に立って見えた） */
.owl-btn::after { content: none; }
.owl-btn img { display: block; width: 100%; height: auto; max-height: min(470px, 62vh); object-fit: contain; animation: owlHop .28s ease-out; }
@media (max-width: 720px) {
  .owl-cols { grid-template-columns: minmax(0, 1fr); }
  .owl-side { grid-column: 1; grid-row: 1; position: static; }
  .owl-main { grid-row: 2; }
  .owl { flex-direction: row-reverse; align-items: center; gap: 14px; }
  .owl-btn { flex: 0 0 auto; width: ${THUMB.w}px; height: ${THUMB.h}px; overflow: hidden; }
  .owl-btn img { width: ${THUMB.imgW}px; max-width: none; max-height: none; margin-left: ${THUMB.left}px; }
  .owl-bubble { flex: 1; min-width: 0; }
  .owl-bubble::before { left: -12px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 9px 12px 9px 0; border-color: transparent ${ACCENT} transparent transparent; }
  .owl-bubble::after { left: -8px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 7px 9px 7px 0; border-color: transparent ${BUBBLE_BG} transparent transparent; }
}
.owl-say { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; text-align: left; }
.owl-say-img { flex: 0 0 auto; width: ${SAY.w}px; height: ${SAY.h}px; overflow: hidden; }
.owl-say-img img { display: block; width: ${SAY.imgW}px; max-width: none; height: auto; margin-left: ${SAY.left}px; animation: owlHop .28s ease-out; }
.owl-say-bubble { position: relative; flex: 1; min-width: 0; background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT};
  border-radius: 12px; padding: 8px 10px; font-family: monospace; font-size: 12px; line-height: 1.6; }
.owl-say-bubble span { display: inline-block; animation: owlSay .22s ease-out; }
.owl-say-bubble::before, .owl-say-bubble::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); border: solid transparent; }
.owl-say-bubble::before { left: -12px; border-width: 9px 12px 9px 0; border-right-color: ${ACCENT}; }
.owl-say-bubble::after { left: -8px; border-width: 7px 9px 7px 0; border-right-color: ${BUBBLE_BG}; }
@keyframes owlSay { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
@keyframes owlHop { 0% { transform: translateY(0) } 40% { transform: translateY(-6px) } 100% { transform: translateY(0) } }
@media (prefers-reduced-motion: reduce) { .owl-bubble span, .owl-btn img, .owl-say-img img, .owl-say-bubble span { animation: none !important } }
`

// face＝表情のキー（lib/appraiser.js の OWL_FACES・いまは普通だけ）・line＝吹き出しの文・tick＝話すたびに変わる数（同じ絵でも跳ねさせる）
export default function V2capAppraiser({ face = 'normal', line = '', tick = 0, onTap }) {
  return (
    <div className="owl">
      <div className="owl-bubble" aria-live="polite"><span key={`${tick}-${line}`}>{line}</span></div>
      <button type="button" className="owl-btn" onClick={onTap} aria-label="鑑定士に話しかける">
        <img key={tick} src={owlSrc(face)} alt="" width={OWL_FACE_SIZE.w} height={OWL_FACE_SIZE.h} />
      </button>
    </div>
  )
}

// ポップアップの中の鑑定士（頭から胸までの絵＋吹き出し）
export function AppraiserSays({ face = 'normal', line = '' }) {
  return (
    <div className="owl-say">
      <div className="owl-say-img"><img src={owlSrc(face)} alt="" width={SAY.imgW} height={Math.round(SAY.imgW * OWL_FACE_SIZE.h / OWL_FACE_SIZE.w)} /></div>
      <div className="owl-say-bubble"><span key={line}>{line}</span></div>
    </div>
  )
}
