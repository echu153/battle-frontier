// ============================================================
// 初心者ビンゴミッション①（is_admin 開発限定・先行実装）
//   3×3ビンゴ（中央=ログイン1日目）。マス達成→マス報酬 / ライン成立→ライン報酬(横3+縦3+斜め2=8)。
//   ※フルコンプ報酬は無し（8ラインのクリア報酬がコンプ相当）。
//   達成判定・報酬付与はすべて SECURITY DEFINER RPC（get/claim_beginner_bingo）で行う。
//   ライン8報酬「初級ボス装備選択箱」は装備タブで redeem（redeem_beginner_boss_box）。
//   ※ 一般公開時はサーバー側RPCの is_admin チェックを外す。
// ============================================================
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// マス定義（index はビンゴ盤の row-major。サーバー _bingo_cells と一致させること）
const CELLS = [
  { label: '出撃10回',    hint: '出撃で通算10回戦う' },                    // 0
  { label: '出撃30回',    hint: '出撃で通算30回戦う' },                    // 1
  { label: '出撃50回',    hint: '出撃で通算50回戦う' },                    // 2
  { label: '出撃100回',   hint: '出撃で通算100回戦う' },                   // 3
  { label: 'ログイン1日目', hint: 'ゲームにログインする', center: true },   // 4（中央）
  { label: '強化1回',     hint: '鍛冶屋で装備を1回強化する' },             // 5
  { label: '強化5回',     hint: '鍛冶屋で装備を5回強化する' },             // 6
  { label: '強化10回',    hint: '鍛冶屋で装備を10回強化する' },            // 7
  { label: '始まりの森ボス', hint: 'エリア①「始まりの森」のボスを倒す' },   // 8
]

// ライン報酬は「達成したライン本数」で解放（idx = 必要本数 1〜8）。どのラインかは不問。
const LINE_TIERS = [1, 2, 3, 4, 5, 6, 7, 8]

// 報酬行 {kind,idx,rewards:[{type,name,qty}],label} → 表示テキスト
const fmtReward = (rw) => {
  if (rw?.label) return rw.label
  const arr = rw?.rewards || []
  const parts = arr.map(r => {
    if (r.type === 'gold') return `${Number(r.qty || 0).toLocaleString()}G`
    return `${r.name}${(r.qty || 1) > 1 ? `×${r.qty}` : ''}`
  })
  return parts.length ? parts.join(' ＋ ') : '（報酬未設定）'
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
    flash(`🎁 受け取りました！ ${fmtReward(res)}`)
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
  const doneCount = cells.filter(Boolean).length
  const lineCount = lines.filter(Boolean).length

  const box = { border: '1px solid #3a2a0a', background: '#120e04', padding: '12px', marginBottom: '12px', borderRadius: '2px' }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0812', padding: '16px', fontFamily: 'monospace' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #3a2a0a', paddingBottom: '8px', marginBottom: '12px', position: 'sticky', top: 0, zIndex: 30, paddingTop: '8px', background: '#0a0812' }}>
          <div style={{ color: '#ffcc44', fontSize: '15px', letterSpacing: '3px' }}>🎯 初心者ビンゴ①</div>
          <button onClick={() => nav('/game')} style={{ background: 'none', border: '1px solid #0088ff', color: '#0088ff', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>← 街に戻る</button>
        </div>

        {msg && (
          <div style={{ color: msg.c, fontSize: '12px', border: `1px solid ${msg.c}55`, background: '#1a1204', padding: '8px 12px', marginBottom: '10px' }}>{msg.t}</div>
        )}

        <div style={{ ...box, display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
          <div><div style={{ color: '#888', fontSize: '10px' }}>マス</div><div style={{ color: '#ffcc44', fontSize: '15px' }}>{doneCount}/9</div></div>
          <div><div style={{ color: '#888', fontSize: '10px' }}>ライン</div><div style={{ color: '#ffaa44', fontSize: '15px' }}>{lineCount}/8</div></div>
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
                borderRadius: '3px', padding: '8px 6px', minHeight: '104px',
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

        {/* ライン報酬（達成したライン本数で解放） */}
        <div style={{ color: '#ffaa44', fontSize: '12px', marginBottom: '6px', letterSpacing: '1px' }}>▍ライン報酬（揃えたライン本数で解放・最大8）</div>
        <div style={{ ...box, padding: '8px' }}>
          {LINE_TIERS.map((n, i) => {
            const done = lineCount >= n
            const claimed = claimedLines.includes(n)
            const rw = rewardOf('line', n)
            return (
              <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 4px', borderBottom: i < LINE_TIERS.length - 1 ? '1px solid #241c08' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px' }}>{claimed ? '🎁' : (done ? '✅' : '⬜')}</span>
                  <span style={{ color: done ? '#ffdd88' : '#998866', fontSize: '11px', minWidth: '56px' }}>{n}ライン</span>
                  <span style={{ color: '#6a5c3a', fontSize: '9.5px' }}>{fmtReward(rw)}</span>
                </div>
                {claimed ? (
                  <span style={{ color: '#66aa66', fontSize: '10px' }}>受取済</span>
                ) : done ? (
                  <button disabled={busy} onClick={() => doClaim('line', n)} style={{ background: '#3a2a06', border: '1px solid #ccaa44', color: '#ffdd88', padding: '3px 10px', cursor: busy ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: '10px', borderRadius: '2px' }}>受取</button>
                ) : (
                  <span style={{ color: '#4a4230', fontSize: '10px' }}>あと{n - lineCount}本</span>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ color: '#6a5c3a', fontSize: '10px', lineHeight: '1.6' }}>
          ※「初級ボス装備選択箱」は<span style={{ color: '#aa8844' }}>装備タブ</span>から使うと、エリア①〜②のボス装備1つと交換できます。
        </div>
      </div>
    </div>
  )
}
