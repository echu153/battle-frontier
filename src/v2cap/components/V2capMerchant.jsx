import { useEffect } from 'react'
import { merchantSrc, MERCHANT_FACE_KEYS, MERCHANT_FACE_SIZE, MERCHANT_FOCUS } from '../lib/merchant.js'
import { SHOP_COLOR } from '../lib/shop.js'

// ============================================================
// 「レベルキャップあり」版 — 商店の商人ソルド（2026-10-31）
//   ・V2capMerchant … 吹き出し＋腰から上の絵。絵を押すと onTap（セリフと表情は呼ぶ側＝V2capShop が lib/merchant.js で決める）
//   ・MerchantSays … 買う確かめと買った結果のポップアップの中の商人（頭から胸までの絵＋吹き出し）。
//     看板娘のとき（2026-10-25）のユーザー指示「ポップアップの裏でセリフ出てるから、ポップアップ上でもイラスト出るようにしたい」と同じ考え
//   ・並べ方（MERCHANT_CSS）は看板娘・親方・アレア・テオドールと同じ：広い画面は左に品物・右に商人（スクロールしても右に残る）。
//     狭い画面（720px以下）は商人（頭から胸）が上・吹き出しが右・品物が下
//   ・ボタン全体の決まり（src/dev-ui.css の hover の明るさ1.3倍・button::after の光沢）は、親方・テオドールと同じく絵にかけない
//   ・動きは prefers-reduced-motion なら止める
// ============================================================
const ACCENT = SHOP_COLOR   // 商店の札と同じ青緑
const BUBBLE_BG = '#effbf9'
const BUBBLE_FG = '#0e2b28'
// 頭から胸までを w×h の枠に出すときの、絵の幅（imgW）と左へのずらし（left）。見せるところは lib/merchant.js の MERCHANT_FOCUS
const cropOf = (w, h) => {
  const k = h / (MERCHANT_FACE_SIZE.h * MERCHANT_FOCUS.top)
  return { w, h, imgW: Math.round(MERCHANT_FACE_SIZE.w * k), left: Math.round(w / 2 - MERCHANT_FOCUS.x * MERCHANT_FACE_SIZE.w * k) }
}
const SAY = cropOf(92, 124)     // ポップアップの中
const THUMB = cropOf(112, 150)  // 狭い画面の上

export const MERCHANT_CSS = `
.mer-cols { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 8px; align-items: start; }
.mer-main { grid-column: 1; grid-row: 1; min-width: 0; }
.mer-side { grid-column: 2; grid-row: 1; position: sticky; top: 44px; }
.mer { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.mer-bubble { position: relative; box-sizing: border-box; width: 100%; min-height: 64px; display: flex; align-items: center;
  background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT}; border-radius: 12px;
  padding: 10px 12px; font-family: monospace; font-size: 13px; line-height: 1.6; }
.mer-bubble::before, .mer-bubble::after { content: ''; position: absolute; left: 50%; transform: translateX(-50%); border: solid transparent; }
.mer-bubble::before { bottom: -12px; border-width: 12px 10px 0; border-top-color: ${ACCENT}; }
.mer-bubble::after { bottom: -8px; border-width: 9px 7px 0; border-top-color: ${BUBBLE_BG}; }
.mer-bubble span { animation: merSay .22s ease-out; }
.mer-btn { display: block; width: 100%; background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; -webkit-tap-highlight-color: transparent;
  box-shadow: none; border-radius: 0; }
.mer-btn:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 4px; border-radius: 8px; }
/* 光り方は控えめに（看板娘・親方・テオドールと同じ。ボタン全体の決まり＝src/dev-ui.css の hover の brightness(1.3)・active の 0.85 を、商人の絵だけ弱める） */
.mer-btn:not(:disabled):hover { filter: brightness(1.05); }
.mer-btn:not(:disabled):active { filter: brightness(0.95); }
/* ボタン全体の光沢（src/dev-ui.css の button::after）は絵の上に重ねない（親方のとき、透明なところまで四角く色がついて箱の中に立って見えた） */
.mer-btn::after { content: none; }
.mer-btn img { display: block; width: 100%; height: auto; max-height: min(470px, 62vh); object-fit: contain; animation: merHop .28s ease-out; }
@media (max-width: 720px) {
  .mer-cols { grid-template-columns: minmax(0, 1fr); }
  .mer-side { grid-column: 1; grid-row: 1; position: static; }
  .mer-main { grid-row: 2; }
  .mer { flex-direction: row-reverse; align-items: center; gap: 14px; }
  .mer-btn { flex: 0 0 auto; width: ${THUMB.w}px; height: ${THUMB.h}px; overflow: hidden; }
  .mer-btn img { width: ${THUMB.imgW}px; max-width: none; max-height: none; margin-left: ${THUMB.left}px; }
  .mer-bubble { flex: 1; min-width: 0; }
  .mer-bubble::before { left: -12px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 9px 12px 9px 0; border-color: transparent ${ACCENT} transparent transparent; }
  .mer-bubble::after { left: -8px; top: 50%; bottom: auto; transform: translateY(-50%); border-width: 7px 9px 7px 0; border-color: transparent ${BUBBLE_BG} transparent transparent; }
}
.mer-say { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; text-align: left; }
.mer-say-img { flex: 0 0 auto; width: ${SAY.w}px; height: ${SAY.h}px; overflow: hidden; }
.mer-say-img img { display: block; width: ${SAY.imgW}px; max-width: none; height: auto; margin-left: ${SAY.left}px; animation: merHop .28s ease-out; }
.mer-say-bubble { position: relative; flex: 1; min-width: 0; background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT};
  border-radius: 12px; padding: 8px 10px; font-family: monospace; font-size: 12px; line-height: 1.6; }
.mer-say-bubble span { display: inline-block; animation: merSay .22s ease-out; }
.mer-say-bubble::before, .mer-say-bubble::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); border: solid transparent; }
.mer-say-bubble::before { left: -12px; border-width: 9px 12px 9px 0; border-right-color: ${ACCENT}; }
.mer-say-bubble::after { left: -8px; border-width: 7px 9px 7px 0; border-right-color: ${BUBBLE_BG}; }
@keyframes merSay { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
@keyframes merHop { 0% { transform: translateY(0) } 40% { transform: translateY(-6px) } 100% { transform: translateY(0) } }
@media (prefers-reduced-motion: reduce) { .mer-bubble span, .mer-btn img, .mer-say-img img, .mer-say-bubble span { animation: none !important } }
`

// 表情を切り替えたときに待たないように、3枚とも先に読んでおく
const preloadMerchant = () => {
  for (const k of MERCHANT_FACE_KEYS) { const img = new Image(); img.src = merchantSrc(k) }
}

// face＝表情のキー（lib/merchant.js の MERCHANT_FACES）・line＝吹き出しの文・tick＝話すたびに変わる数（同じ表情でも跳ねさせる）
export default function V2capMerchant({ face = 'normal', line = '', tick = 0, onTap }) {
  useEffect(preloadMerchant, [])
  return (
    <div className="mer">
      <div className="mer-bubble" aria-live="polite"><span key={`${tick}-${line}`}>{line}</span></div>
      <button type="button" className="mer-btn" onClick={onTap} aria-label="商人に話しかける">
        <img key={tick} src={merchantSrc(face)} alt="" width={MERCHANT_FACE_SIZE.w} height={MERCHANT_FACE_SIZE.h} />
      </button>
    </div>
  )
}

// ポップアップの中の商人（頭から胸までの絵＋吹き出し）
export function MerchantSays({ face = 'normal', line = '' }) {
  return (
    <div className="mer-say">
      <div className="mer-say-img"><img src={merchantSrc(face)} alt="" width={SAY.imgW} height={Math.round(SAY.imgW * MERCHANT_FACE_SIZE.h / MERCHANT_FACE_SIZE.w)} /></div>
      <div className="mer-say-bubble"><span key={line}>{line}</span></div>
    </div>
  )
}
