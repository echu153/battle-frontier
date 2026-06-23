import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Phaser from 'phaser'
import MainScene from './MainScene'
import { setMove, action } from './controls'

// アクションRPG プロト：Phaserのcanvas + ReactのHUD。
// 役割分担 → ゲーム本体=Phaser / UI(バー・コンボ表示)=React。
export default function ActionRpgPage() {
  const navigate = useNavigate()
  const containerRef = useRef(null)
  const gameRef = useRef(null)
  const [hud, setHud] = useState({ level: 1, exp: 0, expNext: 20, hp: 100, hpMax: 100, combo: 0 })

  useEffect(() => {
    const onHud = (e) => setHud(e.detail)
    window.addEventListener('arpg-hud', onHud)

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 800,
      height: 600,
      backgroundColor: '#1d3b1d',
      pixelArt: true, // ドット絵をぼかさない
      physics: { default: 'arcade', arcade: { debug: false } },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [MainScene],
    })

    return () => {
      window.removeEventListener('arpg-hud', onHud)
      gameRef.current?.destroy(true)
      gameRef.current = null
    }
  }, [])

  const expPct = Math.min(100, (hud.exp / hud.expNext) * 100)
  const hpPct = Math.min(100, (hud.hp / hud.hpMax) * 100)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* 街に戻る */}
      <button onClick={() => navigate('/game')} style={{ position: 'absolute', top: 12, right: 12, padding: '8px 14px', background: 'rgba(0,16,32,0.85)', border: '1px solid #2b6cff', color: '#9cf', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, borderRadius: 4 }}>← 街に戻る</button>

      {/* === React製HUD（canvasの上に重ねる） === */}
      <div style={{ position: 'absolute', top: 12, left: 12, fontFamily: 'monospace', color: '#fff', pointerEvents: 'none', width: 220 }}>
        <div style={{ fontSize: 13, marginBottom: 4, textShadow: '0 1px 2px #000' }}>ハル ⟨Lv {hud.level}⟩</div>
        {/* HPバー */}
        <Bar pct={hpPct} color="#37d36b" bg="#0c3a1c" label={`HP ${hud.hp}/${hud.hpMax}`} />
        {/* EXPバー */}
        <Bar pct={expPct} color="#46a9ff" bg="#0c2440" label={`EXP ${hud.exp}/${hud.expNext}`} />
      </div>

      {/* コンボ表示 */}
      {hud.combo > 1 && (
        <div style={{ position: 'absolute', left: 16, top: '42%', fontFamily: 'monospace', color: '#ffd23f', fontWeight: 'bold', textShadow: '0 2px 4px #000', pointerEvents: 'none' }}>
          <span style={{ fontSize: 30 }}>{hud.combo}</span>
          <span style={{ fontSize: 16, marginLeft: 4 }}>HIT</span>
          <div style={{ fontSize: 11, opacity: 0.85 }}>連鎖討伐</div>
        </div>
      )}

      {/* === 左半分：移動バーチャルパッド === */}
      <VirtualPad />

      {/* === 右半分：攻撃／スキルボタン === */}
      <div style={{ position: 'absolute', right: 24, bottom: 28, display: 'flex', alignItems: 'flex-end', gap: 14, userSelect: 'none' }}>
        {/* スキル枠(未実装・近日) */}
        <SkillButton label="近日" />
        <SkillButton label="近日" />
        {/* 攻撃(大ボタン)：押している間くり返し攻撃(実際の発動はクールタイムで制御) */}
        <AttackButton />
      </div>

      {/* 操作ヒント */}
      <div style={{ position: 'absolute', top: 8, width: '100%', textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: '#9fb', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>
        左：移動パッド ／ 右：攻撃ボタン（PCは WASD/矢印＋スペースも可）
      </div>
    </div>
  )
}

// 左半分のどこを触っても、その点を中心にスティックが出る方式
function VirtualPad() {
  const baseRef = useRef(null)
  const MAX = 55 // スティックの最大振り幅(px)
  const [vis, setVis] = useState(null) // 表示用 {bx,by,kx,ky}

  const onDown = (e) => {
    baseRef.current = { x: e.clientX, y: e.clientY }
    setVis({ bx: e.clientX, by: e.clientY, kx: e.clientX, ky: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e) => {
    const b = baseRef.current
    if (!b) return
    let dx = e.clientX - b.x, dy = e.clientY - b.y
    const d = Math.hypot(dx, dy)
    if (d > MAX) { dx = (dx / d) * MAX; dy = (dy / d) * MAX }
    setVis({ bx: b.x, by: b.y, kx: b.x + dx, ky: b.y + dy })
    setMove(dx / MAX, dy / MAX)
  }
  const onUp = () => { baseRef.current = null; setVis(null); setMove(0, 0) }

  return (
    <div
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', touchAction: 'none', zIndex: 5 }}
    >
      {vis && (
        <>
          <div style={{ position: 'fixed', left: vis.bx, top: vis.by, width: 110, height: 110, marginLeft: -55, marginTop: -55, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.2)', pointerEvents: 'none' }} />
          <div style={{ position: 'fixed', left: vis.kx, top: vis.ky, width: 52, height: 52, marginLeft: -26, marginTop: -26, borderRadius: '50%', background: 'rgba(120,180,255,0.7)', border: '2px solid #cfe', pointerEvents: 'none' }} />
        </>
      )}
    </div>
  )
}

function AttackButton() {
  const timer = useRef(null)
  const start = (e) => {
    e.preventDefault()
    action('attack')
    timer.current = setInterval(() => action('attack'), 120) // 押しっぱなしで連打(発動はCTで制御)
  }
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }
  useEffect(() => stop, [])
  return (
    <button
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      style={{ width: 92, height: 92, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #ff8a5c, #c93a1e)', border: '3px solid #ffd0b0', color: '#fff', fontFamily: 'monospace', fontSize: 16, fontWeight: 'bold', cursor: 'pointer', touchAction: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }}
    >攻撃</button>
  )
}

function SkillButton({ label }) {
  return (
    <button disabled style={{ width: 58, height: 58, borderRadius: '50%', background: 'rgba(20,30,50,0.7)', border: '2px solid #335', color: '#668', fontFamily: 'monospace', fontSize: 11, cursor: 'not-allowed', touchAction: 'none' }}>{label}</button>
  )
}

function Bar({ pct, color, bg, label }) {
  return (
    <div style={{ position: 'relative', height: 16, background: bg, borderRadius: 3, marginBottom: 4, border: '1px solid rgba(0,0,0,0.4)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.2s' }} />
      <span style={{ position: 'absolute', inset: 0, fontSize: 10, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', textShadow: '0 1px 1px #000' }}>{label}</span>
    </div>
  )
}
