import { JP_BOLD } from './casinoStyle.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘のテロップ（戦闘開始・討伐完了）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「戦闘開始と討伐後のテロップ的なのが欲しい、報酬画面も」。出す時刻と長さは lib/atbTelop.js。
//   舞台の上に横の帯：帯が上下に開く → 金の線が真ん中から左右へ → 文字が右から入って止まる → 光が横切る（討伐完了だけ）→ 文字は左へ抜ける
//   ★CSS の動きだけ（transform と opacity）＝舞台を描き直さない。ぼかしや重ね方は使わない（スマホで重い）
//   ★日本語の大きな文字は JP_BOLD＋bold（切り抜きのグラデーションにしない）
//   sub … 上の小さい文字（ボスの名前）・ms … 出ている長さ
// ============================================================

const KF = `
@keyframes atbTlBand { 0% { opacity: 0; transform: translateY(-50%) scaleY(0.15) } 10% { opacity: 1; transform: translateY(-50%) scaleY(1) } 86% { opacity: 1; transform: translateY(-50%) scaleY(1) } 100% { opacity: 0; transform: translateY(-50%) scaleY(0.5) } }
@keyframes atbTlLine { 0% { transform: scaleX(0) } 22% { transform: scaleX(1) } 100% { transform: scaleX(1) } }
@keyframes atbTlWord { 0% { opacity: 0; transform: translateX(44px) } 14% { opacity: 0; transform: translateX(44px) } 26% { opacity: 1; transform: translateX(0) } 84% { opacity: 1; transform: translateX(0) } 100% { opacity: 0; transform: translateX(-44px) } }
@keyframes atbTlSweep { 0%, 26% { transform: translateX(-160%) skewX(-24deg) } 56%, 100% { transform: translateX(420%) skewX(-24deg) } }
`
const LOOK = {
  start: { color:'#ffffff', glow:'#6fb4ff', line:'#9fd0ff', word: '戦闘開始' },
  clear: { color:'#ffe9a8', glow:'#ffb300', line:'#ffd27a', word: '討伐完了' },
}

export default function V2capAtbTelop({ kind, sub = null, ms }) {
  const c = LOOK[kind]
  const anim = (name, ease = 'ease-out') => `${name} ${ms}ms ${ease} both`
  return (
    <div style={{ position:'absolute', inset:0, zIndex: 2, overflow:'hidden', pointerEvents:'none' }}>
      <style>{KF}</style>
      <div style={{ position:'absolute', left:0, right:0, top:'42%', padding:'8px 0', overflow:'hidden', textAlign:'center', transformOrigin:'50% 50%', animation: anim('atbTlBand'),
        background:'linear-gradient(90deg, rgba(0,4,16,0) 0%, rgba(0,4,16,0.86) 16%, rgba(0,4,16,0.86) 84%, rgba(0,4,16,0) 100%)' }}>
        <div aria-hidden style={{ position:'absolute', left:0, right:0, top:0, height:'1px', background:`linear-gradient(90deg, transparent, ${c.line} 30%, ${c.line} 70%, transparent)`, animation: anim('atbTlLine') }} />
        <div aria-hidden style={{ position:'absolute', left:0, right:0, bottom:0, height:'1px', background:`linear-gradient(90deg, transparent, ${c.line} 30%, ${c.line} 70%, transparent)`, animation: anim('atbTlLine') }} />
        <div style={{ animation: anim('atbTlWord') }}>
          {sub && <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'clamp(11px, 3vw, 13px)', letterSpacing:'0.2em', paddingLeft:'0.2em', color:'#d8e6ff', textShadow:'0 1px 2px #000', whiteSpace:'nowrap' }}>{sub}</div>}
          <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'clamp(28px, 9vw, 44px)', lineHeight: 1.25, letterSpacing:'0.28em', paddingLeft:'0.28em', color: c.color, whiteSpace:'nowrap',
            textShadow:`0 0 3px #000, 0 0 14px ${c.glow}, 0 2px 0 #000` }}>{c.word}</div>
        </div>
        {kind === 'clear' && <div aria-hidden style={{ position:'absolute', top:0, bottom:0, left:0, width:'24%', background:'linear-gradient(90deg, transparent, rgba(255,245,210,0.32), transparent)', animation: anim('atbTlSweep', 'linear') }} />}
      </div>
    </div>
  )
}
