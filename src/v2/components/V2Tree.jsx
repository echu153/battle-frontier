import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { FORTUNES, FORTUNE_BY_NAME, chanceOf, canPray, remainUntilPray } from '../lib/tree.js'
import { box, btn, miniBtn } from './v2ui.js'

// 施設「ユグレシアの宝樹」。1日1回だけ祈れて、大凶〜大吉が引かれる。
// ★引くのはサーバー（v2_pray）。ここは結果を見せるだけで、抽選も回数の管理もしない。
//   日付が変わるのは日本時間の5時（旧版の日課と同じ）。
//
// ★報酬は未定（2026-08-16）。いまは結果だけ出して何も配っていない。
export default function V2Tree({ prof, onProfile, onBack }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // 祈った直後の結果
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [showRates, setShowRates] = useState(false)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const at = new Date(now)
  const ready = canPray(prof.last_pray_at, at)
  const remain = remainUntilPray(prof.last_pray_at, at)
  const last = prof.last_fortune ? FORTUNE_BY_NAME[prof.last_fortune] : null
  const shown = result ? FORTUNE_BY_NAME[result.fortune] : null

  const pray = async () => {
    if (!ready || busy) return
    setBusy(true); setError(''); setResult(null)
    const { data, error: err } = await supabase.rpc('v2_pray')
    setBusy(false)
    if (err || !data?.ok) { setError(err?.message || data?.error || '祈れませんでした'); return }
    setResult(data)
    onProfile(null)   // last_pray_at / last_fortune を取り直す
  }

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'8px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
        <span style={{ color:'#44dd99', fontSize:'13px' }}>🌳 ユグレシアの宝樹</span>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
      </div>
      <div style={{ color:'#446688', fontSize:'10px', lineHeight:'1.8', marginBottom:'10px' }}>
        1日1回だけ祈れます。宝樹の返す言葉（大凶〜大吉）で、もらえるものが変わります。
        <br />日付が変わるのは日本時間の5時です。
      </div>

      {/* 祈った結果 */}
      {shown && (
        <div style={{ border:`1px solid ${shown.color}`, background:'#000c1c', padding:'14px', marginBottom:'10px', textAlign:'center' }}>
          <div style={{ color:shown.color, fontSize:'24px', letterSpacing:'6px', marginBottom:'6px' }}>{shown.name}</div>
          <div style={{ color:'#88aabb', fontSize:'11px', lineHeight:'1.8' }}>{shown.text}</div>
          {/* ★報酬が決まったらここに出す */}
          <div style={{ color:'#446688', fontSize:'10px', marginTop:'8px' }}>
            {result?.reward ? result.reward : '（報酬は準備中です）'}
          </div>
        </div>
      )}

      {error && <div style={{ color:'#ff6666', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}

      <button onClick={pray} disabled={!ready || busy}
        style={{ width:'100%', padding:'14px', background: ready ? '#03201a' : '#000e1a',
          border:`1px solid ${ready ? '#44dd99' : '#003366'}`, color: ready ? '#44dd99' : '#446688',
          cursor: ready ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
        {busy ? '祈っています...'
          : ready ? '🙏 祈る'
          : `次に祈れるまで ${String(remain.h).padStart(2, '0')}:${String(remain.m).padStart(2, '0')}:${String(remain.s).padStart(2, '0')}`}
      </button>

      {/* 前回の結果 */}
      {last && !shown && (
        <div style={{ color:'#446688', fontSize:'10px', marginTop:'8px', textAlign:'right' }}>
          前回：<span style={{ color:last.color }}>{last.name}</span>
          {prof.pray_count > 0 && <span>　これまで{prof.pray_count}回</span>}
        </div>
      )}

      {/* 出る確率 */}
      <button onClick={() => setShowRates(v => !v)}
        style={{ ...btn('#446688'), width:'100%', padding:'4px', marginTop:'8px', fontSize:'10px' }}>
        {showRates ? '▲ 出る確率を閉じる' : '▼ 出る確率を見る'}
      </button>
      {showRates && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginTop:'6px' }}>
          {FORTUNES.map(f => (
            <div key={f.id} style={{ background:'#000818', border:'1px solid #002244', padding:'3px 6px',
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ color:f.color, fontSize:'10px' }}>{f.name}</span>
              <span style={{ color:'#7f95c4', fontSize:'10px' }}>{chanceOf(f)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
