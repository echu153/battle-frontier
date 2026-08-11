import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { validateName } from '../../lib/nameFilter'
import { reportDevAccess } from '../../lib/devAccess'
import { STAT_KEYS, STAT_DEFS, MAX_LV, EXP_PER_LV, ROLLS_PER_LV, calcPower, expToNext } from '../lib/stats.js'

// ============================================================
// バトルフロンティアⅡ（リメイク版）ホーム — 開発限定
//  現時点の中身は「ステータスと成長」だけ。EXPを入れて上がり方を確かめるための画面。
//  ステの更新は必ずサーバー（v2_apply_exp）が行い、ここは結果を表示するだけ。
// ============================================================

const box = { border:'1px solid #0044aa', background:'#001040', fontFamily:'monospace' }
const btn = (color) => ({
  background:'#001840', border:`1px solid ${color}`, color, padding:'8px 12px',
  cursor:'pointer', fontFamily:'monospace', fontSize:'12px',
})

export default function V2Home() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [sqlError, setSqlError] = useState('')   // supabase_v2_core.sql 未適用の案内用
  const [prof, setProf] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { nav('/login'); return }
        const { data: p } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).maybeSingle()
        // 開発限定。非管理者は旧BFへ戻す（アクセスは管理者へ通知）
        if (!p?.is_admin) { reportDevAccess('v2_remake', 'リメイク版[開発]'); nav('/game'); return }
        if (!alive) return
        setName(p.username || '')
        const { data: v2, error: e2 } = await supabase.from('v2_profiles').select('*').eq('id', user.id).maybeSingle()
        if (!alive) return
        if (e2) { setSqlError(e2.message || String(e2)); setLoading(false); return }
        setProf(v2 || null)
      } catch (err) {
        setSqlError(err.message || String(err))
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [nav])

  const create = async (e) => {
    e.preventDefault()
    const nameErr = validateName(name)
    if (nameErr) { setError(nameErr); return }
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_create_character', { p_username: name.trim() })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || '作成に失敗しました'); return }
    setProf(data.profile)
  }

  const gainExp = async (amount) => {
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_debug_gain_exp', { p_amount: amount })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || 'EXPの付与に失敗しました'); return }
    const before = prof
    setProf(data.profile)
    const gains = data.gains || {}
    setLog(l => [{
      id: `${Date.now()}-${Math.random()}`,
      amount,
      ups: data.level_ups,
      lvFrom: before?.lv, lvTo: data.profile.lv,
      gains: STAT_KEYS.filter(k => gains[k] > 0).map(k => `${STAT_DEFS[k].label}+${gains[k]}`).join(' / ') || 'なし',
    }, ...l].slice(0, 12))
  }

  if (loading) {
    return <div style={{ minHeight:'100vh', background:'#000820', color:'#0088ff', fontFamily:'monospace', padding:'40px', textAlign:'center' }}>読み込み中...</div>
  }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'560px', margin:'0 auto' }}>

        {/* ヘッダ */}
        <div style={{ ...box, padding:'12px 14px', marginBottom:'12px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
          <div>
            <div style={{ color:'#ffcc00', fontSize:'15px', letterSpacing:'2px' }}>BATTLE FRONTIER Ⅱ</div>
            <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>リメイク版 <span style={{ color:'#8877aa' }}>[開発]</span></div>
          </div>
          <button onClick={() => nav('/game')} style={btn('#446688')}>← 旧版へ戻る</button>
        </div>

        {/* SQL未適用の案内 */}
        {sqlError && (
          <div style={{ ...box, borderColor:'#aa4400', background:'#1a0a00', padding:'14px', color:'#ffaa66', fontSize:'12px', lineHeight:'1.9' }}>
            <div style={{ color:'#ff8844', marginBottom:'6px' }}>⚠ v2のテーブルが見つかりません</div>
            <div><code style={{ color:'#ffcc88' }}>supabase_v2_core.sql</code> をSupabaseで実行してください。</div>
            <div style={{ color:'#886644', fontSize:'10px', marginTop:'8px', wordBreak:'break-all' }}>{sqlError}</div>
          </div>
        )}

        {/* キャラクター作成 */}
        {!sqlError && !prof && (
          <form onSubmit={create} style={{ ...box, padding:'16px' }}>
            <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'10px' }}>キャラクターを作成</div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>冒険者名</div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={16} required
              style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', boxSizing:'border-box', marginBottom:'10px' }} />
            {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}
            <button type="submit" disabled={busy} style={{ ...btn('#ffcc00'), width:'100%', padding:'10px' }}>
              {busy ? '作成中...' : '▶ はじめる'}
            </button>
            <div style={{ color:'#446688', fontSize:'10px', marginTop:'10px', lineHeight:'1.8' }}>
              旧版のキャラクターとは完全に別のデータです（同じアカウントで両方遊べます）。
            </div>
          </form>
        )}

        {/* ステータス */}
        {prof && (
          <>
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:'10px' }}>
                <div style={{ color:'#88ccff', fontSize:'14px' }}>{prof.username}</div>
                <div style={{ color:'#ffcc00', fontSize:'13px' }}>LV {prof.lv}{prof.lv >= MAX_LV && <span style={{ color:'#ff8844', fontSize:'10px', marginLeft:'4px' }}>MAX</span>}</div>
              </div>

              {/* EXPバー */}
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'3px' }}>
                EXP {prof.exp} / {expToNext(prof.lv) || '—'}
              </div>
              <div style={{ height:'6px', background:'#001028', border:'1px solid #002244', marginBottom:'12px' }}>
                <div style={{ height:'100%', width:`${Math.min(100, (prof.exp / EXP_PER_LV) * 100)}%`, background:'#44aaff' }} />
              </div>

              {/* 戦闘力 */}
              <div style={{ background:'#000818', border:'1px solid #002244', padding:'8px 10px', marginBottom:'12px', display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'#446688', fontSize:'11px' }}>戦闘力</span>
                <span style={{ color:'#ffcc00', fontSize:'14px' }}>{calcPower(prof)}</span>
              </div>

              {/* ステータス8種 */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'6px' }}>
                {STAT_KEYS.map(k => {
                  const d = STAT_DEFS[k]
                  return (
                    <div key={k} title={d.desc} style={{ background:'#000818', border:'1px solid #002244', padding:'7px 9px', display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                      <span style={{ color:'#446688', fontSize:'11px' }}>
                        <span style={{ color:d.color }}>{d.label}</span>
                        <span style={{ fontSize:'9px', marginLeft:'4px' }}>{d.jp}</span>
                      </span>
                      <span style={{ color:d.color, fontSize:'13px' }}>{prof[k]}</span>
                    </div>
                  )
                })}
              </div>

              <div style={{ color:'#446688', fontSize:'10px', marginTop:'10px', lineHeight:'1.8' }}>
                LVアップごとに{ROLLS_PER_LV}回抽選し、当たったステータスが上がります（HPは+8・MPは+3・その他は+1）。
                どのステに当たっても戦闘力の上がり幅は同じです。
              </div>
            </div>

            {/* 動作確認用のEXP付与 */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ color:'#ffaa44', fontSize:'11px', marginBottom:'8px' }}>🧪 EXP付与 <span style={{ color:'#8877aa', fontSize:'9px' }}>[開発]</span></div>
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                {[60, 600, 6000].map(a => (
                  <button key={a} onClick={() => gainExp(a)} disabled={busy || prof.lv >= MAX_LV} style={{ ...btn('#44ffaa'), opacity: (busy || prof.lv >= MAX_LV) ? 0.4 : 1 }}>
                    EXP +{a}
                  </button>
                ))}
              </div>
              {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'8px' }}>⚠ {error}</div>}
              {prof.lv >= MAX_LV && <div style={{ color:'#ff8844', fontSize:'10px', marginTop:'8px' }}>LV{MAX_LV}に到達しています（転生は未実装）。</div>}
            </div>

            {/* 上昇ログ */}
            {log.length > 0 && (
              <div style={{ ...box, padding:'14px' }}>
                <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'8px' }}>成長ログ</div>
                {log.map(l => (
                  <div key={l.id} style={{ borderBottom:'1px solid #002244', padding:'6px 0', fontSize:'11px', lineHeight:'1.7' }}>
                    <span style={{ color:'#446688' }}>EXP+{l.amount}</span>
                    <span style={{ color:'#ffcc00', marginLeft:'8px' }}>LV {l.lvFrom} → {l.lvTo}</span>
                    <span style={{ color:'#446688', marginLeft:'6px', fontSize:'10px' }}>（{l.ups}回）</span>
                    <div style={{ color:'#88ddaa', fontSize:'10px' }}>{l.gains}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
