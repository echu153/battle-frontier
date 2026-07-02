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
  const [hud, setHud] = useState({
    level: 1, exp: 0, expNext: 20, hp: 100, hpMax: 100, mp: 30, mpMax: 30, combo: 0,
    skills: { wave: { cdLeft: 0, cdTotal: 3000, mp: 8 }, dash: { cdLeft: 0, cdTotal: 5000, mp: 12 } },
    boss: null,
  })
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
          <div style={{ width: 46, height: 46, borderRadius: '50%', border: '2px solid #cfe', background: "#243 url('/hero_front.webp') center/cover no-repeat", boxShadow: '0 1px 3px rgba(0,0,0,0.6)' }} />
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

      {/* === ボスHPバー(アグロ中のみ表示) === */}
      {hud.boss && (
        <div style={{ position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)', width: 'min(420px, 70%)', fontFamily: 'monospace', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center', color: '#ffb3b3', fontSize: 13, textShadow: '0 1px 2px #000', marginBottom: 2 }}>👑 {hud.boss.name}</div>
          <div style={{ height: 14, background: '#3a0c0c', borderRadius: 4, border: '1px solid rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(0, (hud.boss.hp / hud.boss.hpMax) * 100)}%`, height: '100%', background: 'linear-gradient(180deg,#ff6a5c,#c92a1e)', transition: 'width 0.15s' }} />
          </div>
        </div>
      )}

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
      {/* zIndex=10：左半分の移動パッド(zIndex5)より上に置き、ボタンを確実にタップできるように */}
      <div style={{ position: 'absolute', right: 24, bottom: 28, display: 'flex', alignItems: 'flex-end', gap: 12, userSelect: 'none', zIndex: 10 }}>
        <AutoButton />
        {/* スキル：向いている方向に発動。CT中は暗転＋残り秒数を表示 */}
        <SkillButton label="衝撃波" hotkey="1" skill={hud.skills?.wave} mpNow={hud.mp} color="#57c7ff" onFire={() => action('skill:wave')} />
        <SkillButton label="疾風斬" hotkey="2" skill={hud.skills?.dash} mpNow={hud.mp} color="#ffd23f" onFire={() => action('skill:dash')} />
        {/* 攻撃(大ボタン)：押している間くり返し攻撃(実際の発動はクールタイムで制御) */}
        <AttackButton />
      </div>

      {/* PC向け操作ヒント */}
      <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.45)', pointerEvents: 'none', textShadow: '0 1px 2px #000', whiteSpace: 'nowrap' }}>
        WASD移動／SPACE攻撃／1・2スキル
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

// スキルボタン：CT中は下から暗転(残り割合)＋中央に残り秒数。MP不足はコスト表示が赤くなる。
function SkillButton({ label, hotkey, skill, mpNow, color, onFire }) {
  const sk = skill || { cdLeft: 0, cdTotal: 1, mp: 0 }
  const cdPct = sk.cdTotal > 0 ? Math.min(1, sk.cdLeft / sk.cdTotal) : 0
  const noMp = mpNow < sk.mp
  const ready = cdPct <= 0 && !noMp
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); onFire() }}
      style={{ position: 'relative', width: 62, height: 62, borderRadius: '50%', overflow: 'hidden', background: 'rgba(15,25,45,0.85)', border: `2px solid ${ready ? color : '#445'}`, color: ready ? '#fff' : '#88a', fontFamily: 'monospace', fontSize: 11, fontWeight: 'bold', cursor: 'pointer', touchAction: 'none', boxShadow: ready ? `0 0 8px ${color}88` : 'none' }}
    >
      <div>{label}</div>
      <div style={{ fontSize: 9, color: noMp ? '#ff8080' : '#7fb6ff' }}>MP{sk.mp}</div>
      {cdPct > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${cdPct * 100}%`, background: 'rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
      )}
      {cdPct > 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#fff', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>{Math.ceil(sk.cdLeft / 1000)}</div>
      )}
      <div style={{ position: 'absolute', top: 3, right: 8, fontSize: 9, color: '#89a' }}>{hotkey}</div>
    </button>
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
      const { worldW, worldH, player, enemies, boss, zone } = e.detail
      ctx.clearRect(0, 0, W, H)
      // 背景
      ctx.fillStyle = '#16301a'; ctx.fillRect(0, 0, W, H)
      const sx = W / worldW, sy = H / worldH
      // ボス区画(赤く塗る)
      if (zone) {
        ctx.fillStyle = 'rgba(255,60,60,0.20)'
        ctx.fillRect(zone.x * sx, zone.y * sy, zone.w * sx, zone.h * sy)
        ctx.strokeStyle = 'rgba(255,90,90,0.55)'; ctx.lineWidth = 1
        ctx.strokeRect(zone.x * sx, zone.y * sy, zone.w * sx, zone.h * sy)
      }
      // 敵(赤)
      ctx.fillStyle = '#ff4d4d'
      for (const en of enemies) {
        ctx.beginPath(); ctx.arc(en.x * sx, en.y * sy, 2, 0, Math.PI * 2); ctx.fill()
      }
      // ボス(オレンジ・大きめ)
      if (boss) {
        ctx.fillStyle = '#ffae42'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(boss.x * sx, boss.y * sy, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
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
