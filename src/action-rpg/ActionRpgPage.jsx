import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'
import MainScene from './MainScene'

// アクションRPG プロト：Phaserのcanvas + ReactのHUD。
// 役割分担 → ゲーム本体=Phaser / UI(バー・コンボ表示)=React。
export default function ActionRpgPage() {
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

      {/* 操作ヒント */}
      <div style={{ position: 'absolute', bottom: 10, width: '100%', textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: '#9fb', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>
        移動: WASD/矢印 or ドラッグ ・ 攻撃: 敵の近くでタップ/クリック or スペースキー
      </div>
    </div>
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
