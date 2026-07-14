// ============================================================
// 初心者ビンゴミッション（is_admin 限定・先行実装）
//   3×3ビンゴ（中央=出撃100回で固定）。
//   マス達成→マス報酬 / ライン成立→ライン報酬(横3+縦3+斜め2=最大8) / 全9マス→フルコンプ報酬。
//   達成判定・報酬付与はすべて SECURITY DEFINER RPC（get/claim_beginner_bingo）で行う。
//   ※ 一般公開時はサーバー側RPCの is_admin チェックを外す。
// ============================================================
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// マス定義（index はビンゴ盤の row-major。サーバー _bingo_cells と一致させること）
const CELLS = [
  { label: '強化10回',        hint: '鍛冶屋で装備を10回強化する' },              // 0
  { label: 'かかし修練3時間',  hint: 'かかし修練場で3時間以上の修練を完了する' },  // 1
  { label: 'レイド参加1回',    hint: 'レイドボスに1回参加する' },                 // 2
  { label: '博物館に5個寄贈',  hint: '博物館に装備を5個寄贈する' },               // 3
  { label: '出撃100回',        hint: '出撃で通算100回戦う', center: true },       // 4（中央固定）
  { label: '上位職に転職',     hint: '上位クラスへ転職する' },                    // 5
  { label: '始まりの森ボス',   hint: 'エリア①「始まりの森」のボスを倒す' },       // 6
  { label: '釣り放置3時間',    hint: '釣りを3時間以上放置してから回収する' },      // 7
  { label: '初級の洞窟を踏破', hint: 'ダンジョン「初級の洞窟」を踏破する' },       // 8
]

// ライン定義（サーバー _bingo_lines と一致させること）
const LINES = [
  { cells: [0, 1, 2], label: '横 ①' },
  { cells: [3, 4, 5], label: '横 ②' },
  { cells: [6, 7, 8], label: '横 ③' },
  { cells: [0, 3, 6], label: '縦 ①' },
  { cells: [1, 4, 7], label: '縦 ②' },
  { cells: [2, 5, 8], label: '縦 ③' },
  { cells: [0, 4, 8], label: '斜め ＼' },
  { cells: [2, 4, 6], label: '斜め ／' },
]

const fmtReward = (r) => {
  const parts = []
  if (r && r.gold > 0) parts.push(`${Number(r.gold).toLocaleString()}G`)
  ;(r?.items || []).forEach(it => parts.push(`${it.name}×${it.qty || 1}`))
  return parts.length ? parts.join(' / ') : '（報酬未設定）'
}

export default function BeginnerBingo() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [devOnly, setDevOnly] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      await load()
      setLoading(false)
    })()
  }, [])

  const load = async () => {
    const { data: res, error } = await supabase.rpc('get_beginner_bingo')
    if (error) { setMsg({ t: `読み込み失敗: ${error.message}`, c: '#ff5555' }); return }
    if (res?.dev_only) { setDevOnly(true); return }
    setData(res)
  }

  const flash = (t, c = '#ffcc44') => { setMsg({ t, c }); setTimeout(() => setMsg(null), 2800) }

  const rewardOf = (kind, idx) => (data?.rewards || []).find(r => r.kind === kind && r.idx === idx) || null

  const doClaim = async (kind, idx) => {
    setBusy(true)
    const { data: res, error } = await supabase.rpc('claim_beginner_bingo', { p_kind: kind, p_idx: idx })
    setBusy(false)
    if (error) { flash(`受取失敗: ${error.message}`, '#ff5555'); return }
    if (!res?.ok) {
      const map = { already: 'すでに受取済みです', not_completed: 'まだ達成していません', dev_only: '開発限定機能です' }
      flash(map[res?.error] || `受取失敗: ${res?.error || ''}`, '#ff5555')
      return
    }
    const gained = fmtReward({ gold: res.gold, items: res.items })
    flash(`🎁 受け取りました！ ${gained}`)
    await load()
  }

  if (loading) return <div style={{ color: '#ffcc44', textAlign: 'center', marginTop: '40vh', fontFamily: 'monospace' }}>読み込み中...</div>

  if (devOnly) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0812', padding: '16px', fontFamily: 'monospace' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #3a2a0a', paddingBottom: '8px', marginBottom: '12px' }}>
            <div style={{ color: '#ffcc44', fontSize: '15px', letterSpacing: '3px' }}>🎯 初心者ビンゴ</div>
            <button onClick={() => nav('/game')} style={{ background: 'none', border: '1px solid #0088ff', color: '#0088ff', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>← 街に戻る</button>
          </div>
          <div style={{ textAlign: 'center', padding: '40px 16px', color: '#cc9944' }}>この機能は現在 開発限定 で調整中です。</div>
        </div>
      </div>
    )
  }

  const cells = data?.cells || []
  const lines = data?.lines || []
  const claimedCells = data?.claimed_cells || []
  const claimedLines = data?.claimed_lines || []
  const claimedFull = !!data?.claimed_full
  const doneCount = cells.filter(Boolean).length
  const lineCount = lines.filter(Boolean).length
  const allDone = doneCount === 9

  const box = { border: '1px solid #3a2a0a', background: '#120e04', padding: '12px', marginBottom: '12px', borderRadius: '2px' }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0812', padding: '16px', fontFamily: 'monospace' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #3a2a0a', paddingBottom: '8px', marginBottom: '12px', position: 'sticky', top: 0, zIndex: 30, paddingTop: '8px', background: '#0a0812' }}>
          <div style={{ color: '#ffcc44', fontSize: '15px', letterSpacing: '3px' }}>🎯 初心者ビンゴ</div>
          <button onClick={() => nav('/game')} style={{ background: 'none', border: '1px solid #0088ff', color: '#0088ff', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>← 街に戻る</button>
        </div>

        {msg && (
          <div style={{ color: msg.c, fontSize: '12px', border: `1px solid ${msg.c}55`, background: '#1a1204', padding: '8px 12px', marginBottom: '10px' }}>{msg.t}</div>
        )}

        <div style={{ ...box, display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
          <div><div style={{ color: '#888', fontSize: '10px' }}>マス</div><div style={{ color: '#ffcc44', fontSize: '15px' }}>{doneCount}/9</div></div>
          <div><div style={{ color: '#888', fontSize: '10px' }}>ライン</div><div style={{ color: '#ffaa44', fontSize: '15px' }}>{lineCount}/8</div></div>
          <div><div style={{ color: '#888', fontSize: '10px' }}>フルコンプ</div><div style={{ color: allDone ? '#44ff88' : '#666', fontSize: '15px' }}>{allDone ? '達成' : '未'}</div></div>
        </div>

        {/* 3×3 ビンゴ盤 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '14px' }}>
          {CELLS.map((c, i) => {
            const done = !!cells[i]
            const claimed = claimedCells.includes(i)
            const rw = rewardOf('cell', i)
            return (
              <div key={i} style={{
                border: `1px solid ${done ? '#7a6a1a' : '#2a2418'}`,
                background: c.center ? '#1a1404' : (done ? '#161002' : '#0e0b04'),
                borderRadius: '3px', padding: '8px 6px', minHeight: '96px',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                boxShadow: c.center ? 'inset 0 0 0 1px #7a5a1a' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: '15px', textAlign: 'center', marginBottom: '2px' }}>{claimed ? '🎁' : (done ? '✅' : '⬜')}</div>
                  <div style={{ color: done ? '#ffdd88' : '#998866', fontSize: '10.5px', textAlign: 'center', lineHeight: '1.3' }}>{c.label}</div>
                  <div style={{ color: '#6a5c3a', fontSize: '8.5px', textAlign: 'center', lineHeight: '1.25', marginTop: '3px' }}>{c.hint}</div>
                </div>
                <div style={{ marginTop: '4px' }}>
                  {claimed ? (
                    <div style={{ color: '#66aa66', fontSize: '9px', textAlign: 'center' }}>受取済</div>
                  ) : done ? (
                    <button disabled={busy} onClick={() => doClaim('cell', i)} style={{
                      width: '100%', background: '#3a2a06', border: '1px solid #ccaa44', color: '#ffdd88',
                      padding: '3px', cursor: busy ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: '9.5px', borderRadius: '2px',
                    }}>報酬受取</button>
                  ) : (
                    <div style={{ color: '#5a5038', fontSize: '8.5px', textAlign: 'center' }}>{fmtReward(rw)}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* ライン報酬 */}
        <div style={{ color: '#ffaa44', fontSize: '12px', marginBottom: '6px', letterSpacing: '1px' }}>▍ライン報酬（横3・縦3・斜め2 = 最大8）</div>
        <div style={{ ...box, padding: '8px' }}>
          {LINES.map((ln, i) => {
            const done = !!lines[i]
            const claimed = claimedLines.includes(i)
            const rw = rewardOf('line', i)
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 4px', borderBottom: i < LINES.length - 1 ? '1px solid #241c08' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px' }}>{claimed ? '🎁' : (done ? '✅' : '⬜')}</span>
                  <span style={{ color: done ? '#ffdd88' : '#998866', fontSize: '11px', minWidth: '52px' }}>{ln.label}</span>
                  <span style={{ color: '#6a5c3a', fontSize: '9.5px' }}>{fmtReward(rw)}</span>
                </div>
                {claimed ? (
                  <span style={{ color: '#66aa66', fontSize: '10px' }}>受取済</span>
                ) : done ? (
                  <button disabled={busy} onClick={() => doClaim('line', i)} style={{ background: '#3a2a06', border: '1px solid #ccaa44', color: '#ffdd88', padding: '3px 10px', cursor: busy ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: '10px', borderRadius: '2px' }}>受取</button>
                ) : (
                  <span style={{ color: '#4a4230', fontSize: '10px' }}>未成立</span>
                )}
              </div>
            )
          })}
        </div>

        {/* フルコンプ報酬 */}
        <div style={{ color: '#44ff88', fontSize: '12px', marginBottom: '6px', letterSpacing: '1px' }}>▍フルコンプ報酬（全9マス達成）</div>
        <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderColor: allDone ? '#2a6a3a' : '#3a2a0a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>{claimedFull ? '🎁' : (allDone ? '🏆' : '🔒')}</span>
            <span style={{ color: allDone ? '#88ffaa' : '#998866', fontSize: '11px' }}>{fmtReward(rewardOf('full', 0))}</span>
          </div>
          {claimedFull ? (
            <span style={{ color: '#66aa66', fontSize: '10px' }}>受取済</span>
          ) : allDone ? (
            <button disabled={busy} onClick={() => doClaim('full', 0)} style={{ background: '#0a3a1a', border: '1px solid #44cc77', color: '#88ffaa', padding: '4px 14px', cursor: busy ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: '11px', borderRadius: '2px' }}>受取</button>
          ) : (
            <span style={{ color: '#4a4230', fontSize: '10px' }}>あと{9 - doneCount}マス</span>
          )}
        </div>
      </div>
    </div>
  )
}
