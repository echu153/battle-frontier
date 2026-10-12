import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { box, btn } from '../../v2/components/v2ui.js'
import { FORTUNE_BY_NAME, canPray, remainUntilPray, prayExpOf } from '../lib/tree.js'
import { jobUpHead, jobUpNote } from '../lib/jobs.js'
import { recSpotOfLv, spotLabel } from '../lib/areas.js'
import V2capOmikujiFx from './V2capOmikujiFx.jsx'

// ============================================================
// 「レベルキャップあり」版 — ユグレシアの宝樹（1日1回祈る）
//   見た目は今のⅡの V2Tree と同じ（結果は大きな文字で出し、ひとことを添える・直近10回の履歴）。違うのは（2026-10-11 ユーザー決定）：
//   ・ごほうびは経験値だけ（祈った時点のLVの必要EXP × 2／1／0.5／0.1% × 運勢の倍率）
//   ・管理者だけ何回でも祈れる、はしない（この版は管理者しか入れないため）
//   ★出る確率は画面に出さない（今のⅡと同じ）。抽選と経験値はサーバー（v2cap_pray）。仕組みの正は src/v2cap/lib/tree.js
// ============================================================
const pad = (n) => String(n).padStart(2, '0')

export default function V2capTree({ prof, onProfile }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // 祈った直後の結果
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [showLog, setShowLog] = useState(false)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const at = new Date(now)
  const ready = canPray(prof.last_pray_at, at)
  const remain = remainUntilPray(prof.last_pray_at, at)
  const shown = result ? FORTUNE_BY_NAME[result.fortune] : null
  const log = prof.pray_log || []          // 新しい順に最大10件（サーバーが積む）
  const kichi = prayExpOf(prof.lv, FORTUNE_BY_NAME['吉'])
  const daikichi = prayExpOf(prof.lv, FORTUNE_BY_NAME['大吉'])

  // 【確定】2026-10-13 ユーザー指示「ユグレシアの祈りにも演出加えてほしい、結果が出る過程の、おみくじみたいな感じで」
  //   祈ると すぐ おみくじの演出（V2capOmikujiFx.jsx）が始まり、結果が届くまで箱を振る。閉じたあと「演出をもう一度見る」
  const [fx, setFx] = useState(null)   // { key, result }
  const pray = async () => {
    if (!ready || busy) return
    setBusy(true); setError(''); setResult(null)
    const key = Date.now()
    setFx({ key, result: null })
    const { data, error: err } = await supabase.rpc('v2cap_pray')
    if (err || !data?.ok) { setBusy(false); setFx(null); setError(err?.message || data?.error || '祈れませんでした'); return }
    setFx(f => (f && f.key === key ? { ...f, result: data } : f))
    setResult(data)
    await onProfile(null)   // last_pray_at / pray_log / LV を取り直す
    setBusy(false)
  }

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'8px' }}>
      {fx && <V2capOmikujiFx key={fx.key} result={fx.result} onClose={() => setFx(null)} />}
      <div style={{ color:'#44dd99', fontSize:'13px', marginBottom:'8px' }}>🌳 ユグレシアの宝樹</div>
      <div style={{ color:'#7fa6d0', fontSize:'10px', lineHeight:'1.8', marginBottom:'10px' }}>
        1日1回だけ祈れます。宝樹の返す言葉（大凶〜大吉）で、もらえる経験値が変わります
        （LV{prof.lv}なら 吉で <span style={{ color:'#ffcc00' }}>EXP +{kichi.toLocaleString()}</span>・
        大吉で <span style={{ color:'#ffcc00' }}>EXP +{daikichi.toLocaleString()}</span>。吉はLV{prof.lv}の推奨の場所「{spotLabel(recSpotOfLv(prof.lv))}」で10回出撃したくらい）。
        <br />日付が変わるのは日本時間の5時です。
      </div>

      {/* 祈った結果 */}
      {shown && (
        <div style={{ border:`1px solid ${shown.color}`, background:'#000c1c', padding:'14px', marginBottom:'10px', textAlign:'center' }}>
          <div style={{ color: shown.color, fontSize:'24px', letterSpacing:'6px', marginBottom:'6px' }}>{shown.name}</div>
          <div style={{ color:'#a8c4d6', fontSize:'11px', lineHeight:'1.8' }}>{shown.text}</div>
          {/* 経験値はサーバーが決めて返す（画面では計算しない） */}
          <div style={{ color:'#ffcc00', fontSize:'12px', marginTop:'8px' }}>EXP +{Number(result.exp).toLocaleString()}</div>
          {result.level?.level_ups > 0 && (
            <div style={{ color:'#44ff88', fontSize:'11px', marginTop:'4px' }}>
              🆙 LEVEL UP！ LV{result.level.lv}{typeof result.level.points === 'number' ? `（ステータスポイント+${result.level.points}）` : ''}
            </div>
          )}
          {/* 上がったクラスのステも書く（2026-10-12 ユーザー指示・出撃のログと同じ） */}
          {result.level?.job_ups > 0 && (
            <div style={{ color:'#ffcc00', fontSize:'11px', marginTop:'4px' }}>
              <div>{jobUpHead(prof.class, result.level)}</div>
              <div>{jobUpNote(prof.class, result.level)}</div>
            </div>
          )}
          {(result.level?.learned || []).map(n => <div key={n} style={{ color:'#44ddff', fontSize:'11px', marginTop:'4px' }}>📖 スキル「{n}」を覚えた！{(result.level?.set_added || []).includes(n) ? '（スキルセットの空き枠に入れた）' : ''}</div>)}
          <button onClick={() => setFx({ key: Date.now(), result })} disabled={!!fx}
            style={{ ...btn('#7fa6d0'), marginTop:'10px', padding:'4px 10px', fontSize:'10px' }}>▶ 演出をもう一度見る</button>
        </div>
      )}

      {error && <div style={{ color:'#ff6666', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}

      <button onClick={pray} disabled={!ready || busy}
        style={{ width:'100%', padding:'14px', background: ready ? '#03201a' : '#000e1a',
          border:`1px solid ${ready ? '#44dd99' : '#003366'}`, color: ready ? '#44dd99' : '#7fa6d0',
          cursor: ready ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'14px', letterSpacing:'2px' }}>
        {busy ? '祈っています...' : !ready ? `次に祈れるまで ${pad(remain.h)}:${pad(remain.m)}:${pad(remain.s)}` : '🙏 祈る'}
      </button>

      {/* 直近10回 */}
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
