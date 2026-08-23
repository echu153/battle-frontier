import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { FORTUNE_BY_NAME, canPray, remainUntilPray, rewardText, PRAY_GOLD, PRAY_EXP } from '../lib/tree.js'
import { box, btn, miniBtn } from './v2ui.js'

// 施設「ユグレシアの宝樹」。1日1回だけ祈れて、大凶〜大吉が引かれる。
// ★引くのはサーバー（v2_pray）。ここは結果を見せるだけで、抽選も回数の管理もしない。
//   日付が変わるのは日本時間の5時（旧版の日課と同じ）。
// ★出る確率は画面に出さない（指示による）。正は src/v2/lib/tree.js の FORTUNES。
// ★開発（is_admin）は回数制限なしで祈れる。一般公開時もこのゲートは外さないこと。
//
// ★報酬は未定（2026-08-16）。いまは結果だけ出して何も配っていない。
export default function V2Tree({ prof, isAdmin, onProfile, onBack }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // 祈った直後の結果
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [showLog, setShowLog] = useState(false)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const at = new Date(now)
  const ready = isAdmin || canPray(prof.last_pray_at, at)
  const remain = remainUntilPray(prof.last_pray_at, at)
  const shown = result ? FORTUNE_BY_NAME[result.fortune] : null
  const log = prof.pray_log || []          // 新しい順に最大10件（サーバーが積む）

  const pray = async () => {
    if (!ready || busy) return
    setBusy(true); setError(''); setResult(null)
    const { data, error: err } = await supabase.rpc('v2_pray')
    setBusy(false)
    if (err || !data?.ok) { setError(err?.message || data?.error || '祈れませんでした'); return }
    setResult(data)
    onProfile(null)   // last_pray_at / pray_log を取り直す
  }

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'8px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
        <span style={{ color:'#44dd99', fontSize:'13px' }}>🌳 ユグレシアの宝樹</span>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
      </div>
      <div style={{ color:'#7fa6d0', fontSize:'10px', lineHeight:'1.8', marginBottom:'10px' }}>
        1日1回だけ祈れます。宝樹の返す言葉（大凶〜大吉）で、もらえる Gold と EXP が変わります（吉で {PRAY_GOLD}G・EXP+{PRAY_EXP}）。
        <br />日付が変わるのは日本時間の5時です。
      </div>

      {/* 祈った結果 */}
      {shown && (
        <div style={{ border:`1px solid ${shown.color}`, background:'#000c1c', padding:'14px', marginBottom:'10px', textAlign:'center' }}>
          <div style={{ color:shown.color, fontSize:'24px', letterSpacing:'6px', marginBottom:'6px' }}>{shown.name}</div>
          <div style={{ color:'#a8c4d6', fontSize:'11px', lineHeight:'1.8' }}>{shown.text}</div>
          {/* 報酬はサーバーが決めて文字列で返す（画面では計算しない） */}
          <div style={{ color:'#7fa6d0', fontSize:'10px', marginTop:'8px' }}>
            {result?.reward || (shown ? rewardText(shown) : '')}
          </div>
        </div>
      )}

      {error && <div style={{ color:'#ff6666', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}

      <button onClick={pray} disabled={!ready || busy}
        style={{ width:'100%', padding:'14px', background: ready ? '#03201a' : '#000e1a',
          border:`1px solid ${ready ? '#44dd99' : '#003366'}`, color: ready ? '#44dd99' : '#7fa6d0',
          cursor: ready ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
        {busy ? '祈っています...'
          : !ready ? `次に祈れるまで ${String(remain.h).padStart(2, '0')}:${String(remain.m).padStart(2, '0')}:${String(remain.s).padStart(2, '0')}`
          : isAdmin && !canPray(prof.last_pray_at, at) ? '🙏 祈る（開発：回数制限なし）'
          : '🙏 祈る'}
      </button>

      {/* 過去10回 */}
      {log.length > 0 && (<>
        <button onClick={() => setShowLog(v => !v)}
          style={{ ...btn('#7fa6d0'), width:'100%', padding:'4px', marginTop:'8px', fontSize:'10px' }}>
          {showLog ? '▲ これまでの結果を閉じる' : `▼ これまでの結果を見る（${log.length}件）`}
        </button>
        {showLog && (
          <div style={{ display:'grid', gap:'2px', marginTop:'6px' }}>
            {log.map((e, i) => {
              const f = FORTUNE_BY_NAME[e.fortune]
              return (
                <div key={i} style={{ background:'#000818', border:'1px solid #002244', padding:'3px 6px',
                  display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ color:'#7fa6d0', fontSize:'9px' }}>{e.at}</span>
                  <span style={{ color: f?.color || '#7f95c4', fontSize:'10px' }}>{e.fortune}</span>
                </div>
              )
            })}
          </div>
        )}
      </>)}
    </div>
  )
}
