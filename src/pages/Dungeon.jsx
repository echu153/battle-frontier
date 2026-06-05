import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// ============================================================
// 不思議のダンジョン風プロトタイプ（Phase 1：クライアントのみ・報酬なし）
// 開発者(is_admin)だけが入れる隠しコンテンツ。
// マップは固定5フロア。クリック/ボタンで1歩移動、ターン制で敵も動く。
// 接触で簡易戦闘、階段(>)で次フロア、5階クリアで脱出。
// ※報酬付与は Phase 3 で RPC を介してサーバー検証してから実装する。
// ============================================================

// タイル凡例:  # 壁 / . 床 / > 階段 / E 敵 / i アイテム / P 開始位置
const FLOOR_MAPS = [
  [
    '#########',
    '#P..#..i#',
    '#.#.#.#.#',
    '#.#...#.#',
    '#.#E#.#.#',
    '#.#.#.#.#',
    '#...#..>#',
    '#########',
  ],
  [
    '#########',
    '#P....E.#',
    '#.###.#.#',
    '#.#i#.#.#',
    '#.#.#.#.#',
    '#.#.#...#',
    '#E....>.#',
    '#########',
  ],
  [
    '#########',
    '#P.#..i.#',
    '#..#.#E.#',
    '##.#.#.##',
    '#..E.#..#',
    '#.##.##.#',
    '#i...#.>#',
    '#########',
  ],
  [
    '#########',
    '#P..E..i#',
    '#.#####.#',
    '#.#...#.#',
    '#.#.E.#.#',
    '#.#i..#.#',
    '#.....E>#',
    '#########',
  ],
  [
    '#########',
    '#P..#..E#',
    '#.#.#.#.#',
    '#.#.i.#.#',
    '#E#.#.#.#',
    '#.#.#.#i#',
    '#...E.#>#',
    '#########',
  ],
]

// 仮ペットステータス（Phase 2 で pets テーブルから取得する）
const TEMP_PET = { name: 'ペット', maxHp: 40, atk: 12, def: 4 }
// フロアごとの敵ステータス（簡易）
const enemyStatsFor = (floor) => ({ maxHp: 14 + floor * 6, atk: 5 + floor * 2, def: floor })

function parseMap(rows) {
  const grid = rows.map((r) => r.split(''))
  let player = null
  const enemies = []
  const items = []
  let stairs = null
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const c = grid[y][x]
      if (c === 'P') { player = { x, y }; grid[y][x] = '.' }
      else if (c === 'E') { enemies.push({ x, y, id: `e${x}-${y}` }); grid[y][x] = '.' }
      else if (c === 'i') { items.push({ x, y, id: `i${x}-${y}` }); grid[y][x] = '.' }
      else if (c === '>') { stairs = { x, y } }
    }
  }
  return { grid, player, enemies, items, stairs }
}

export default function Dungeon() {
  const nav = useNavigate()
  const [allowed, setAllowed] = useState(undefined)
  const [floorIdx, setFloorIdx] = useState(0)
  const [state, setState] = useState(null) // { grid, player, enemies, items, stairs }
  const [petHp, setPetHp] = useState(TEMP_PET.maxHp)
  const [log, setLog] = useState([])
  const [status, setStatus] = useState('exploring') // exploring | cleared | dead

  // 開発者ガード
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data } = await supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
      setAllowed(!!data?.is_admin)
    })()
  }, [nav])

  const loadFloor = useCallback((idx) => {
    setState(parseMap(FLOOR_MAPS[idx]))
  }, [])

  useEffect(() => { if (allowed) loadFloor(0) }, [allowed, loadFloor])

  const addLog = (msg) => setLog((l) => [msg, ...l].slice(0, 30))

  // 簡易戦闘：その場で決着（ペットと敵が殴り合う）
  const fight = (enemyStat, curPetHp) => {
    let eHp = enemyStat.maxHp
    let pHp = curPetHp
    const lines = []
    while (eHp > 0 && pHp > 0) {
      const dmgToE = Math.max(1, TEMP_PET.atk - enemyStat.def)
      eHp -= dmgToE
      if (eHp <= 0) { lines.push(`→ 敵に${dmgToE}ダメージ。撃破！`); break }
      const dmgToP = Math.max(1, enemyStat.atk - TEMP_PET.def)
      pHp -= dmgToP
      lines.push(`→ 敵に${dmgToE} / 被弾${dmgToP}`)
    }
    return { petHp: pHp, win: eHp <= 0, lines }
  }

  const tryMove = (dx, dy) => {
    if (!state || status !== 'exploring') return
    const nx = state.player.x + dx
    const ny = state.player.y + dy
    if (ny < 0 || ny >= state.grid.length || nx < 0 || nx >= state.grid[ny].length) return
    if (state.grid[ny][nx] === '#') return

    let next = { ...state, player: { ...state.player } }
    let curPetHp = petHp

    // 敵との接触＝戦闘
    const enemyHere = state.enemies.find((e) => e.x === nx && e.y === ny)
    if (enemyHere) {
      const res = fight(enemyStatsFor(floorIdx + 1), curPetHp)
      res.lines.forEach(addLog)
      curPetHp = res.petHp
      if (!res.win) {
        setPetHp(curPetHp)
        setStatus('dead')
        addLog('💀 ペットは力尽きた…')
        return
      }
      next.enemies = state.enemies.filter((e) => e.id !== enemyHere.id)
      setPetHp(curPetHp)
    } else {
      next.player = { x: nx, y: ny }
    }

    // アイテム取得（Phase1 はログだけ）
    const itemHere = next.items.find((it) => it.x === next.player.x && it.y === next.player.y)
    if (itemHere) {
      next.items = next.items.filter((it) => it.id !== itemHere.id)
      addLog('✨ アイテムを見つけた（※報酬は未実装）')
    }

    // 階段
    if (state.stairs && next.player.x === state.stairs.x && next.player.y === state.stairs.y) {
      if (floorIdx + 1 >= FLOOR_MAPS.length) {
        setState(next)
        setStatus('cleared')
        addLog('🏁 最深部を踏破！ダンジョンクリア！')
        return
      }
      addLog(`⬇ ${floorIdx + 2}階へ降りた`)
      setFloorIdx(floorIdx + 1)
      loadFloor(floorIdx + 1)
      return
    }

    // 敵の移動（プレイヤーへ1歩近づく簡易AI）
    next.enemies = next.enemies.map((e) => {
      const tx = next.player.x, ty = next.player.y
      const stepX = Math.sign(tx - e.x), stepY = Math.sign(ty - e.y)
      // 横優先で動けるなら動く
      const cand = []
      if (stepX !== 0) cand.push({ x: e.x + stepX, y: e.y })
      if (stepY !== 0) cand.push({ x: e.x, y: e.y + stepY })
      for (const c of cand) {
        if (next.grid[c.y]?.[c.x] === '.' &&
            !next.enemies.some((o) => o !== e && o.x === c.x && o.y === c.y) &&
            !(c.x === tx && c.y === ty)) {
          return { ...e, x: c.x, y: c.y }
        }
      }
      return e
    })

    setState(next)
  }

  const restart = () => {
    setFloorIdx(0)
    setPetHp(TEMP_PET.maxHp)
    setLog([])
    setStatus('exploring')
    loadFloor(0)
  }

  if (allowed === undefined) return <Center>読み込み中...</Center>
  if (!allowed) return <Center>このページは開発中です（権限がありません）<br /><Btn onClick={() => nav('/game')}>🏰 街に戻る</Btn></Center>
  if (!state) return <Center>生成中...</Center>

  // 描画用グリッド合成
  const render = state.grid.map((row, y) => row.map((cell, x) => {
    if (state.player.x === x && state.player.y === y) return { ch: '🐾', kind: 'player' }
    if (state.enemies.some((e) => e.x === x && e.y === y)) return { ch: '👹', kind: 'enemy' }
    if (state.items.some((it) => it.x === x && it.y === y)) return { ch: '✨', kind: 'item' }
    if (state.stairs && state.stairs.x === x && state.stairs.y === y) return { ch: '▼', kind: 'stairs' }
    if (cell === '#') return { ch: '', kind: 'wall' }
    return { ch: '', kind: 'floor' }
  }))

  const adj = (x, y) => Math.abs(x - state.player.x) + Math.abs(y - state.player.y) === 1

  return (
    <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', padding: '16px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ color: '#aa88ff', letterSpacing: 2 }}>🕳 不思議のダンジョン <span style={{ fontSize: 11, color: '#4466aa' }}>[開発中]</span></div>
          <Btn onClick={() => nav('/game')}>🏰 街</Btn>
        </div>

        <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 8 }}>
          <span>B{floorIdx + 1}F</span>
          <span style={{ color: petHp > TEMP_PET.maxHp * 0.3 ? '#44ff88' : '#ff5555' }}>
            {TEMP_PET.name} HP {petHp}/{TEMP_PET.maxHp}
          </span>
        </div>

        {/* マップ */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${state.grid[0].length}, 1fr)`, gap: 2, background: '#001030', padding: 6, border: '1px solid #113355' }}>
          {render.map((row, y) => row.map((c, x) => {
            const bg = c.kind === 'wall' ? '#0a1530' : '#0c2a55'
            const clickable = status === 'exploring' && c.kind !== 'wall' && adj(x, y)
            return (
              <div key={`${x}-${y}`}
                onClick={() => { if (clickable) tryMove(x - state.player.x, y - state.player.y) }}
                style={{
                  aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, background: bg,
                  outline: clickable ? '1px solid #2266bb' : 'none',
                  cursor: clickable ? 'pointer' : 'default',
                }}>
                {c.ch}
              </div>
            )
          }))}
        </div>

        {/* 方向ボタン */}
        {status === 'exploring' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 48px)', gap: 4, justifyContent: 'center', marginTop: 12 }}>
            <span />
            <Btn onClick={() => tryMove(0, -1)}>▲</Btn>
            <span />
            <Btn onClick={() => tryMove(-1, 0)}>◀</Btn>
            <span />
            <Btn onClick={() => tryMove(1, 0)}>▶</Btn>
            <span />
            <Btn onClick={() => tryMove(0, 1)}>▼</Btn>
            <span />
          </div>
        )}

        {status === 'cleared' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#ffcc44' }}>
            🏁 ダンジョンクリア！<br /><Btn onClick={restart}>もう一度</Btn> <Btn onClick={() => nav('/game')}>街に戻る</Btn>
          </div>
        )}
        {status === 'dead' && (
          <div style={{ textAlign: 'center', marginTop: 16, color: '#ff5555' }}>
            💀 ペットは力尽きた…<br /><Btn onClick={restart}>再挑戦</Btn> <Btn onClick={() => nav('/game')}>街に戻る</Btn>
          </div>
        )}

        {/* ログ */}
        <div style={{ marginTop: 16, background: '#000610', border: '1px solid #113355', padding: 8, height: 140, overflowY: 'auto', fontSize: 11 }}>
          {log.length === 0 ? <span style={{ color: '#335577' }}>マスをクリック、または矢印で移動。👹に触れると戦闘、▼で次の階へ。</span>
            : log.map((l, i) => <div key={i} style={{ color: i === 0 ? '#aaddff' : '#5588bb' }}>{l}</div>)}
        </div>
      </div>
    </div>
  )
}

function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>{children}</div>
}
function Btn({ children, onClick }) {
  return <button onClick={onClick} style={{ background: '#001840', border: '1px solid #0088ff', color: '#0088ff', padding: '6px 12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13 }}>{children}</button>
}
