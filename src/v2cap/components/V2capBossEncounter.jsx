import { useState } from 'react'
import { JP_BOLD } from './casinoStyle.js'
import { BOSS_DEFS, bossAccentOf, bossEncounterOf, bossThumbOf } from '../lib/bossArt.js'
import { bossBgOf } from '../lib/bossBg.js'
import { DIFF_COLOR, DUNGEON_BOSSES, diffOf } from '../lib/dungeon.js'
import { ENCOUNTER_OUT_MS } from '../lib/useBossEncounter.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦を押した瞬間の遭遇のイラスト
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「そもそも遭遇絵を使用してなくない？挑戦したら遭遇のイラストがどん！って出るようにしてほしい」：
//   画面いっぱいに、ボスの背景を暗く敷いて、遭遇のイラストが手前へ叩きつけられる（大きく→行きすぎて→止まる）。
//   叩きつけた瞬間に白く光り・画面が揺れ・輪と集中線が走る。そのあとはゆっくり近づく（裏の準備を待つあいだも止まって見えない）。下にボスの名前と難易度。
//   決まり（いつ消えるか）は lib/useBossEncounter.js。押すまで出たまま（下に「タップで戦闘開始」）。押すと、サーバーの返事を待たずに戦闘の画面へ進む
//   【確定】同じ日 ユーザー「難易度選択のポップアップはただイラスト表示させるだけでいい、挑戦する押した後いつも通りの遭遇の演出はいるようにして」：出すのはポップアップ（V2capBossPick.jsx）の「挑戦する」を押した瞬間
//   ★CSS の動きだけ（transform と opacity）＝スマホでも軽い。大きな絵が届く前は一覧の小さい絵を出す（どちらも同じ切り抜き）
//   ★日本語の大きな文字は JP_BOLD＋bold（切り抜きのグラデーションにしない）
// ============================================================

const KF = `
@keyframes beOut { from { opacity: 1 } to { opacity: 0 } }
@keyframes beSlam { 0% { opacity: 0; transform: scale(1.7) } 18% { opacity: 1 } 42% { transform: scale(0.97) } 62% { transform: scale(1.015) } 100% { opacity: 1; transform: scale(1) } }
@keyframes beDrift { from { transform: scale(1) } to { transform: scale(1.06) } }
@keyframes beShake { 0%, 100% { transform: translate(0, 0) } 14% { transform: translate(-11px, 8px) } 30% { transform: translate(10px, -7px) } 46% { transform: translate(-7px, -4px) } 62% { transform: translate(5px, 4px) } 80% { transform: translate(-2px, 2px) } }
@keyframes beFlash { from { opacity: 0.9 } to { opacity: 0 } }
@keyframes beRing { from { opacity: 0.85; transform: translate(-50%, -50%) scale(0.2) } to { opacity: 0; transform: translate(-50%, -50%) scale(1.5) } }
@keyframes beLines { from { opacity: 0.8; transform: scale(1.2) } to { opacity: 0; transform: scale(1) } }
@keyframes beName { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
@keyframes beHint { 0%, 100% { opacity: 0.4 } 50% { opacity: 1 } }
`
const HIT = '0.13s'   // 叩きつける瞬間（beSlam の42%あたり）

export default function V2capBossEncounter({ bossKey, diffKey, out = false, onTap = null }) {
  const [big, setBig] = useState(false)
  const boss = DUNGEON_BOSSES[bossKey], d = diffOf(bossKey, diffKey)
  const src = bossEncounterOf(bossKey), thumb = bossThumbOf(bossKey), bg = bossBgOf(bossKey)
  const accent = bossAccentOf(bossKey)
  const image = { position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain' }
  return (
    <div onClick={onTap || undefined} style={{ position:'fixed', inset:0, zIndex: 1100, overflow:'hidden', background: bg?.under || '#000', cursor: onTap ? 'pointer' : undefined,
      animation: out ? `beOut ${ENCOUNTER_OUT_MS}ms ease-out forwards` : undefined }}>
      <style>{KF}</style>
      <div style={{ position:'absolute', inset:'-14px', animation:`beShake 0.46s linear ${HIT} both` }}>
        {bg && <div aria-hidden style={{ position:'absolute', inset:0, background:`url("${bg.src}") center / cover no-repeat`, opacity: 0.5 }} />}
        <div aria-hidden style={{ position:'absolute', inset:0, background:'radial-gradient(circle at 50% 44%, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.72) 72%)' }} />
        {/* 集中線と輪 */}
        <div aria-hidden style={{ position:'absolute', inset:'-20%', opacity: 0, background:'repeating-conic-gradient(from 0deg at 50% 46%, rgba(255,255,255,0.24) 0deg 1.3deg, transparent 1.3deg 7.5deg)',
          WebkitMaskImage:'radial-gradient(circle at 50% 46%, transparent 24%, #000 58%)', maskImage:'radial-gradient(circle at 50% 46%, transparent 24%, #000 58%)',
          animation:`beLines 0.5s ease-out ${HIT} forwards` }} />
        <div aria-hidden style={{ position:'absolute', left:'50%', top:'44%', width:'min(120vw, 120vh)', height:'min(120vw, 120vh)', borderRadius:'50%', border:`6px solid ${accent}`, opacity: 0,
          animation:`beRing 0.55s ease-out ${HIT} forwards` }} />
        {/* 遭遇のイラスト：叩きつける→ゆっくり近づく */}
        <div style={{ position:'absolute', left:'50%', top:'44%', width:'min(96vw, 76vh)', height:'min(96vw, 76vh)', marginLeft:'calc(min(96vw, 76vh) / -2)', marginTop:'calc(min(96vw, 76vh) / -2)',
          animation:'beSlam 0.34s cubic-bezier(0.2, 0.8, 0.3, 1) both', willChange:'transform' }}>
          <div style={{ position:'absolute', inset:0, animation:'beDrift 6s linear 0.34s forwards' }}>
            {thumb && !big && <img src={thumb} alt="" draggable={false} style={image} />}
            {src && <img src={src} alt="" draggable={false} onLoad={() => setBig(true)} style={{ ...image, opacity: big ? 1 : 0 }} />}
          </div>
        </div>
      </div>
      {/* ボスの名前と難易度 */}
      <div style={{ position:'absolute', left:0, right:0, bottom: 0, padding:'28px 12px max(4vh, 18px)', textAlign:'center', pointerEvents:'none',
        background:'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.78) 55%)', animation:'beName 0.3s ease-out 0.24s both' }}>
        {d && <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'clamp(12px, 3.4vw, 15px)', letterSpacing:'0.2em', paddingLeft:'0.2em', color: DIFF_COLOR[diffKey], textShadow:'0 1px 2px #000' }}>{d.label}</div>}
        <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'clamp(26px, 8vw, 44px)', lineHeight: 1.3, letterSpacing:'0.08em', paddingLeft:'0.08em', color:'#ffffff', whiteSpace:'nowrap',
          textShadow:`0 0 3px #000, 0 0 16px ${accent}, 0 2px 0 #000` }}>{boss?.name || BOSS_DEFS[bossKey]?.name}</div>
        {onTap && <div style={{ marginTop:'6px', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'clamp(12px, 3.4vw, 15px)', letterSpacing:'0.14em', paddingLeft:'0.14em', color:'#ffffff', textShadow:'0 1px 2px #000', animation:'beHint 1.6s ease-in-out 0.6s infinite both' }}>タップで戦闘開始</div>}
      </div>
      <div aria-hidden style={{ position:'absolute', inset:0, background:'#ffffff', opacity: 0, pointerEvents:'none', animation:`beFlash 0.32s ease-out ${HIT} forwards` }} />
    </div>
  )
}
