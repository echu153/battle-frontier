import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { miniBtn, TEXT } from './v2ui.js'
import { useCapFold } from './useCapFold.js'
import {
  NAVI_NAME, NAVI_FACE_SIZE, NAVI_END_KEY, NAVI_SCROLL_ID, naviSrc, naviMarkedOf, naviStateOf, naviViewOf, naviFarewellView,
  naviPreviewViews, pickNaviTap, nextStreak, tapKindOf,
} from '../lib/navi.js'

// ============================================================
// 「レベルキャップあり」版 — 案内役ナハトの枠（ホームのステータスとメニューの上）
//   【確定】2026-11-02 ユーザー選択「ホームの上に細い枠」：絵＋ひとこと＋やること＋その画面へ飛ぶボタン。戦闘中は隠す・画面に重ねない。決まりとセリフは lib/navi.js
//   ・精霊を押すとセリフが変わる（看板娘たちと同じ・続けて押したときも）
//   ・たたむと、やることの1行だけ（開け閉めはほかの枠と同じ useCapFold）
//   ・終えた印はサーバー（v2cap_navi_mark）に残す。読み直すまでの間も戻らないように、この画面でも覚える（ホームから施設へ行って戻っても消えないよう、枠は隠すだけで外さない）
//   ・preview … 開発用「案内を最初から見る」の何枚目か（null＝ふつう）。サーバーに何も書かない
//   ・ボタン全体の決まり（src/dev-ui.css の hover の明るさ1.3倍・button::after の光沢）は、神官と同じく絵にかけない
// ============================================================
const ACCENT = '#b79bff'
const TASK = '#ffdd55'
const BUBBLE_BG = '#f3eeff'
const BUBBLE_FG = '#1e1636'
const ART = 72

const NAVI_CSS = `
.nvi { max-width: 980px; margin: 0 auto 8px; box-sizing: border-box; border: 1px solid ${ACCENT}; background: #0a0c30; padding: 8px 10px; font-family: monospace; }
.nvi-top { display: flex; align-items: center; gap: 12px; }
.nvi-art { flex: 0 0 auto; width: ${ART}px; height: ${ART}px; padding: 0; border: 0; cursor: pointer; line-height: 0; box-shadow: none; border-radius: 50%;
  background: radial-gradient(circle at 50% 55%, rgba(183,155,255,0.3), rgba(183,155,255,0) 70%); -webkit-tap-highlight-color: transparent; }
.nvi-art:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 2px; }
.nvi-art:not(:disabled):hover { filter: brightness(1.05); }
.nvi-art:not(:disabled):active { filter: brightness(0.95); }
.nvi-art::after { content: none; }
.nvi-art svg, .nvi-art img { display: block; width: 100%; height: 100%; animation: nviFloat 3.2s ease-in-out infinite; }
.nvi-bubble { position: relative; flex: 1; min-width: 0; background: ${BUBBLE_BG}; color: ${BUBBLE_FG}; border: 2px solid ${ACCENT}; border-radius: 12px; padding: 7px 10px; font-size: 12px; line-height: 1.6; }
.nvi-bubble::before, .nvi-bubble::after { content: ''; position: absolute; top: 50%; transform: translateY(-50%); border: solid transparent; }
.nvi-bubble::before { left: -12px; border-width: 9px 12px 9px 0; border-right-color: ${ACCENT}; }
.nvi-bubble::after { left: -8px; border-width: 7px 9px 7px 0; border-right-color: ${BUBBLE_BG}; }
.nvi-bubble span { display: inline-block; animation: nviSay .22s ease-out; }
.nvi-name { display: block; color: #6a4fc0; font-size: 10px; line-height: 1.3; }
.nvi-task { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px 8px; margin-top: 6px; }
.nvi-task-text { flex: 1 1 200px; min-width: 0; color: ${TASK}; font-size: 12px; line-height: 1.5; }
.nvi-task-label { color: ${TEXT.label}; font-size: 10px; margin-right: 6px; }
.nvi-btns { display: flex; align-items: center; gap: 6px; }
.nvi-go { background: #001840; border: 1px solid ${TASK}; color: ${TASK}; padding: 6px 10px; cursor: pointer; font-family: monospace; font-size: 12px; white-space: nowrap; }
.nvi-mini { display: flex; align-items: center; gap: 8px; }
.nvi-mini-art { flex: 0 0 auto; width: 30px; height: 30px; }
.nvi-mini-art svg, .nvi-mini-art img { display: block; width: 100%; height: 100%; }
@keyframes nviFloat { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
@keyframes nviSay { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .nvi-art svg, .nvi-art img, .nvi-bubble span { animation: none !important } }
`

// 絵は lib/navi.js の naviSrc（まだ描いていない表情は「普通」の絵）。大きさは道具が作る正方形
function Spirit({ face }) {
  return <img src={naviSrc(face)} alt="" width={NAVI_FACE_SIZE.w} height={NAVI_FACE_SIZE.h} />
}

export default function V2capNavi({ prof, inventory, hidden = false, onGo, onPoints, onDaily, preview = null, onPreview }) {
  const [mine, setMine] = useState(() => new Set())   // この画面で付けた印（読み直すまでの間も戻らないように）
  const [page, setPage] = useState(0)                 // 名乗りの何枚目か
  const [said, setSaid] = useState(null)              // 精霊を押したときのセリフ（{ forKey, face, text }）
  const streak = useRef(null)
  const [open, toggleOpen] = useCapFold(prof, 'openNavi')

  const marked = new Set([...naviMarkedOf(prof), ...mine])
  const state = naviStateOf(prof, inventory, marked)
  const markKey = state.toMark.join(',')
  const mark = (keys) => {
    setMine(m => new Set([...m, ...keys]))
    // 残せなくても（SQLを流す前など）画面はそのまま動く＝キャラのデータで分かるところは次に開いたときも進む
    supabase.rpc('v2cap_navi_mark', { p_keys: keys }).then(() => {}, () => {})
  }
  // キャラのデータで終わったと分かったものを残す（ミッションのように、あとで条件が外れても戻らないように）
  useEffect(() => {
    if (markKey) mark(markKey.split(','))
  }, [markKey])

  const views = preview == null ? null : naviPreviewViews()
  const view = views
    ? views[Math.min(preview, views.length - 1)]
    : state.kind === 'step' ? naviViewOf(state.step, state.ctx, page)
    : state.kind === 'farewell' ? naviFarewellView()
    : null
  if (hidden || !view) return null

  const showSaid = said?.forKey === view.key
  const face = showSaid ? said.face : view.face
  const line = showSaid ? said.text : view.line

  const tap = () => {
    const s = nextStreak(streak.current, Date.now())
    streak.current = s
    const l = pickNaviTap(tapKindOf(s.n), { last: said?.text })
    setSaid({ forKey: view.key, face: l.face, text: l.text })
  }
  const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const act = (a) => {
    if (views) return   // 開発用の見本では何もしない
    if (a.kind === 'page') { setPage(p => p + 1); return }
    if (a.kind === 'ack') { mark([state.step.key]); return }
    if (a.kind === 'end') { mark([NAVI_END_KEY]); return }
    if (a.kind === 'points') { onPoints?.(); return }
    if (a.kind === 'sortie') { scrollToId(NAVI_SCROLL_ID.sortie); return }
    if (a.kind === 'daily') { onDaily?.(); scrollToId(NAVI_SCROLL_ID.daily); return }
    if (a.kind === 'screen') {
      if (a.mark) mark([state.step.key])
      onGo?.(a.screen)
    }
  }
  const goBtn = view.action && <button type="button" className="nvi-go" onClick={() => act(view.action)}>{view.action.label}</button>
  const previewBar = views && (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', color: '#ff88cc', fontSize: '10px' }}>
      <span>［開発］見本 {preview + 1}/{views.length}</span>
      <button type="button" onClick={() => onPreview?.(Math.max(0, preview - 1))} disabled={preview <= 0} style={miniBtn('#ff88cc')}>◀ 前</button>
      <button type="button" onClick={() => onPreview?.(Math.min(views.length - 1, preview + 1))} disabled={preview >= views.length - 1} style={miniBtn('#ff88cc')}>次 ▶</button>
      <button type="button" onClick={() => onPreview?.(null)} style={miniBtn('#ff88cc')}>閉じる</button>
    </div>
  )

  // たたんだとき：やることの1行だけ（名乗りと最後のセリフは短くないので、そのときは名前だけ）
  if (!open && !views) {
    return (
      <div className="nvi">
        <style>{NAVI_CSS}</style>
        <div className="nvi-mini">
          <div className="nvi-mini-art"><Spirit face={view.face} /></div>
          <div className="nvi-task-text">{view.task || NAVI_NAME}</div>
          <div className="nvi-btns">
            {goBtn}
            <button type="button" onClick={toggleOpen} aria-label={`${NAVI_NAME}の案内を開く`} style={miniBtn(ACCENT)}>▼</button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="nvi" role="region" aria-label={`${NAVI_NAME}の案内`}>
      <style>{NAVI_CSS}</style>
      <div className="nvi-top">
        <button type="button" className="nvi-art" onClick={tap} aria-label={`${NAVI_NAME}に話しかける`}><Spirit face={face} /></button>
        <div className="nvi-bubble" aria-live="polite">
          <b className="nvi-name">{NAVI_NAME}</b>
          <span key={`${view.key}-${line}`}>{line}</span>
        </div>
      </div>
      <div className="nvi-task">
        {view.task && <div className="nvi-task-text"><span className="nvi-task-label">やること</span>{view.task}</div>}
        <div className="nvi-btns">
          {goBtn}
          <button type="button" onClick={toggleOpen} aria-label={`${NAVI_NAME}の案内をたたむ`} style={miniBtn(ACCENT)}>▲</button>
        </div>
      </div>
      {previewBar}
    </div>
  )
}
