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
  const [hud, setHud] = useState({ level: 1, exp: 0, expNext: 20, hp: 100, hpMax: 100, mp: 30, mpMax: 30, combo: 0 })
  const [notice, setNotice] = useState(true)

  useEffect(() => {
    const onHud = (e) => setHud(e.detail)
    window.addEventListener('arpg-hud', onHud)

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      backgroundColor: '#1d3b1d',
      pixelArt: true, // ドット絵をぼかさない
      physics: { default: 'arcade', arcade: { debug: false } },
      // RESIZE＝画面いっぱいに描画(レターボックスの黒帯を出さない)
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
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
  const mpPct = Math.min(100, (hud.mp / hud.mpMax) * 100)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* === 左上：アイコン＋ステータスバー（HP/MP/EXP） === */}
      <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'flex-start', gap: 8, fontFamily: 'monospace', color: '#fff', pointerEvents: 'none' }}>
        {/* 円形ポートレート＋Lvバッジ */}
        <div style={{ position: 'relative', width: 46, height: 46, flexShrink: 0 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', border: '2px solid #cfe', background: "#243 url('/syoumen.png') center/cover no-repeat", boxShadow: '0 1px 3px rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'absolute', left: -4, top: -4, minWidth: 18, height: 18, padding: '0 3px', borderRadius: 9, background: '#1a3a6a', border: '1px solid #6bf', color: '#cfe', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{hud.level}</div>
        </div>
        <div style={{ width: 180 }}>
          <div style={{ fontSize: 12, marginBottom: 3, textShadow: '0 1px 2px #000' }}>ハル <span style={{ color:'#9cf', fontSize: 10 }}>ソルジャー</span></div>
          <Bar pct={hpPct} color="#37d36b" bg="#0c3a1c" label={`HP ${hud.hp}/${hud.hpMax}`} />
          <Bar pct={mpPct} color="#3aa0ff" bg="#0c2440" label={`MP ${hud.mp}/${hud.mpMax}`} h={11} />
          <Bar pct={expPct} color="#ffd23f" bg="#3a2c08" label={`EXP ${hud.exp}/${hud.expNext}`} h={8} />
        </div>
      </div>

      {/* === 右上：ミニマップ＋街に戻る === */}
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <Minimap />
        <button onClick={() => navigate('/game')} style={{ padding: '6px 12px', background: 'rgba(0,16,32,0.85)', border: '1px solid #2b6cff', color: '#9cf', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, borderRadius: 4 }}>← 街に戻る</button>
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

      {/* === 右半分：オート／スキル／攻撃ボタン === */}
      <div style={{ position: 'absolute', right: 24, bottom: 28, display: 'flex', alignItems: 'flex-end', gap: 12, userSelect: 'none' }}>
        <AutoButton />
        <SkillButton label="近日" />
        <SkillButton label="近日" />
        {/* 攻撃(大ボタン)：押している間くり返し攻撃(実際の発動はクールタイムで制御) */}
        <AttackButton />
      </div>

      {/* 趣味制作の注意書き(閉じれる) */}
      {notice && (
        <div style={{ position: 'absolute', top: 90, left: '50%', transform: 'translateX(-50%)', maxWidth: '90%', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.7)', border: '1px solid #555', borderRadius: 6, padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, color: '#ddd' }}>
          <span>🛠 趣味で制作中のお試し版です。プレイしても報酬等はありません。</span>
          <button onClick={() => setNotice(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
        </div>
      )}
    </div>
  )
}

// オート：ON中はゲーム側が自動で敵を探して接近＋攻撃
function AutoButton() {
  const [on, setOn] = useState(false)
  const toggle = () => {
    const next = !on
    setOn(next)
    action(next ? 'auto:on' : 'auto:off')
  }
  return (
    <button onClick={toggle} style={{ width: 64, height: 64, borderRadius: '50%', background: on ? 'radial-gradient(circle at 35% 30%, #ffe27a, #e0a019)' : 'rgba(20,30,50,0.75)', border: `2px solid ${on ? '#fff3c0' : '#446'}`, color: on ? '#3a2a00' : '#9ab', fontFamily: 'monospace', fontSize: 12, fontWeight: 'bold', cursor: 'pointer', touchAction: 'none', boxShadow: on ? '0 0 10px rgba(255,210,80,0.7)' : 'none' }}>AUTO</button>
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

function Bar({ pct, color, bg, label, h = 14 }) {
  return (
    <div style={{ position: 'relative', height: h, background: bg, borderRadius: 3, marginBottom: 3, border: '1px solid rgba(0,0,0,0.4)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.2s' }} />
      <span style={{ position: 'absolute', inset: 0, fontSize: 9, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', textShadow: '0 1px 1px #000' }}>{label}</span>
    </div>
  )
}

// 右上ミニマップ：'arpg-map'(150ms毎)を受けて canvas に自分(青)/敵(赤)を描く
function Minimap() {
  const canvasRef = useRef(null)
  const W = 104, H = 78 // ワールド比 1600:1200 = 4:3

  useEffect(() => {
    const onMap = (e) => {
      const cv = canvasRef.current
      if (!cv) return
      const ctx = cv.getContext('2d')
      const { worldW, worldH, player, enemies } = e.detail
      ctx.clearRect(0, 0, W, H)
      // 背景
      ctx.fillStyle = '#16301a'; ctx.fillRect(0, 0, W, H)
      const sx = W / worldW, sy = H / worldH
      // 敵(赤)
      ctx.fillStyle = '#ff4d4d'
      for (const en of enemies) {
        ctx.beginPath(); ctx.arc(en.x * sx, en.y * sy, 2, 0, Math.PI * 2); ctx.fill()
      }
      // 自分(青・少し大きめ＋白枠)
      ctx.fillStyle = '#4da6ff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(player.x * sx, player.y * sy, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    }
    window.addEventListener('arpg-map', onMap)
    return () => window.removeEventListener('arpg-map', onMap)
  }, [])

  return (
    <div style={{ background: 'rgba(0,16,24,0.8)', border: '2px solid #2b6cff', borderRadius: 6, padding: 3, pointerEvents: 'none' }}>
      <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#9cf', textAlign: 'center', marginBottom: 2 }}>エメリア平原</div>
      <canvas ref={canvasRef} width={W} height={H} style={{ display: 'block', borderRadius: 3 }} />
    </div>
  )
}
