import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { reportDevAccess } from '../lib/devAccess'
import {
  BLACK, WHITE, EMPTY, SIZE,
  createBoard, validMoves, applyMove, countStones, isGameOver, cpuChooseMove, opponent,
} from '../lib/othello'

// ============================================================
// オセロ — 開発限定のミニゲーム(娯楽・ステ影響なし・SQL不要)
// プレイヤー=黒(先手) vs CPU=白。DBには一切書き込まない
// ============================================================

const CPU_DELAY_MS = 600

export default function Othello() {
  const nav = useNavigate()
  const [blocked, setBlocked] = useState(false)
  const [loading, setLoading] = useState(true)

  const [board, setBoard] = useState(createBoard)
  const [turn, setTurn] = useState(BLACK) // 手番(BLACK=プレイヤー)
  const [message, setMessage] = useState('あなたの番です(黒)')
  const [lastMove, setLastMove] = useState(null)
  const [over, setOver] = useState(false)
  const cpuTimerRef = useRef(null)

  // ---- 認証 + is_adminゲート ----
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      if (cancelled) return
      if (!prof?.is_admin) {
        reportDevAccess('othello', 'オセロ(/othello)')
        setBlocked(true)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [nav])

  useEffect(() => () => { if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current) }, [])

  const finish = (b) => {
    setOver(true)
    const { black, white } = countStones(b)
    if (black > white) setMessage(`あなたの勝ち！ ${black} - ${white}`)
    else if (white > black) setMessage(`CPUの勝ち… ${black} - ${white}`)
    else setMessage(`引き分け ${black} - ${white}`)
  }

  // 手番処理: 打った後の盤面から次の手番を決める(パス処理込み)
  const advance = (b, mover) => {
    const next = opponent(mover)
    if (isGameOver(b)) { finish(b); return }
    if (validMoves(b, next).length > 0) {
      setTurn(next)
      setMessage(next === BLACK ? 'あなたの番です(黒)' : 'CPU思考中…')
      if (next === WHITE) scheduleCpu(b)
    } else {
      // 相手はパス → moverが続行
      setTurn(mover)
      setMessage(mover === BLACK ? 'CPUはパス！ 続けてあなたの番です' : 'あなたはパス！ CPUの番です')
      if (mover === WHITE) scheduleCpu(b)
    }
  }

  const scheduleCpu = (b) => {
    if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current)
    cpuTimerRef.current = setTimeout(() => {
      const mv = cpuChooseMove(b, WHITE)
      if (mv === null) { advance(b, WHITE); return }
      const nb = applyMove(b, mv, WHITE)
      setBoard(nb)
      setLastMove(mv)
      advance(nb, WHITE)
    }, CPU_DELAY_MS)
  }

  const handleCell = (idx) => {
    if (over || turn !== BLACK) return
    const nb = applyMove(board, idx, BLACK)
    if (!nb) return
    setBoard(nb)
    setLastMove(idx)
    advance(nb, BLACK)
  }

  const reset = () => {
    if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current)
    setBoard(createBoard())
    setTurn(BLACK)
    setMessage('あなたの番です(黒)')
    setLastMove(null)
    setOver(false)
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#000a14', color: '#88ccff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>読み込み中…</div>
  }
  if (blocked) {
    return (
      <div style={{ minHeight: '100vh', background: '#000a14', color: '#ff6644', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
        <div>この機能は現在開発中です</div>
        <button onClick={() => nav('/game')} style={{ background: 'none', border: '1px solid #88ccff', color: '#88ccff', padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace' }}>街に戻る</button>
      </div>
    )
  }

  const hints = !over && turn === BLACK ? new Set(validMoves(board, BLACK)) : new Set()
  const { black, white } = countStones(board)

  return (
    <div style={{ minHeight: '100vh', background: '#000a14', color: '#cde', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px' }}>
      <div style={{ width: '100%', maxWidth: '480px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <button onClick={() => nav('/game')} style={{ background: 'none', border: '1px solid #446688', color: '#88ccff', padding: '6px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' }}>← 街に戻る</button>
        <div style={{ color: '#ffcc44', fontSize: '14px' }}>⚫ オセロ[開発]</div>
        <button onClick={reset} style={{ background: 'none', border: '1px solid #446688', color: '#88ccff', padding: '6px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' }}>はじめから</button>
      </div>

      <div style={{ width: '100%', maxWidth: '480px', display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
        <div style={{ color: turn === BLACK && !over ? '#ffcc44' : '#cde' }}>⚫ あなた: {black}</div>
        <div style={{ color: turn === WHITE && !over ? '#ffcc44' : '#cde' }}>⚪ CPU: {white}</div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gap: '2px',
        background: '#0a3320', border: '3px solid #1a5535', borderRadius: '4px', padding: '4px',
        width: '100%', maxWidth: '480px', aspectRatio: '1',
      }}>
        {board.map((cell, i) => (
          <button
            key={i}
            onClick={() => handleCell(i)}
            style={{
              background: i === lastMove ? '#1e7a48' : '#146038',
              border: 'none', borderRadius: '2px', cursor: hints.has(i) ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              position: 'relative',
            }}
          >
            {cell !== EMPTY && (
              <div style={{
                width: '78%', height: '78%', borderRadius: '50%',
                background: cell === BLACK ? 'radial-gradient(circle at 35% 30%, #555, #000)' : 'radial-gradient(circle at 35% 30%, #fff, #bbb)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }} />
            )}
            {cell === EMPTY && hints.has(i) && (
              <div style={{ width: '26%', height: '26%', borderRadius: '50%', background: 'rgba(255, 220, 80, 0.45)' }} />
            )}
          </button>
        ))}
      </div>

      <div style={{ marginTop: '12px', fontSize: '14px', color: over ? '#ffcc44' : '#9fd', minHeight: '20px' }}>{message}</div>
      {over && (
        <button onClick={reset} style={{ marginTop: '10px', background: 'none', border: '1px solid #ffcc44', color: '#ffcc44', padding: '8px 20px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '13px' }}>もう一度あそぶ</button>
      )}
    </div>
  )
}
