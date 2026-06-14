// ============================================================
// 錬金部屋（Alchemy Room）  ※is_admin限定で先行公開
//   ・時間経過で強化石(F〜A)を生成（最大4枠）
//   ・錬金用素材で時間短縮(各-30分) / 時の結晶で-1時間
//   ・全ての時刻はサーバー(now())基準。状態取得・操作は SECURITY DEFINER RPC 経由。
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const RANKS = ['F', 'E', 'D', 'C', 'B', 'A']
const RANK_MIN = { F: 60, E: 120, D: 300, C: 720, B: 1800, A: 4800 } // 生成時間(分)
const RANK_COLOR = { F: '#88aa88', E: '#88ccaa', D: '#66ccff', C: '#aa88ff', B: '#ffaa44', A: '#ff5566' }

// 各枠の解放条件テキスト（slotは1始まり）
const SLOT_COND = {
  1: 'エリア③のボスを撃破すると開放',
  2: '追憶の遺跡（30F）を踏破すると開放',
  3: '奈落闘技場を10回踏破すると開放',
  4: 'エリア⑤のボスを撃破すると開放',
}

const fmtDur = (min) => {
  if (min >= 60) {
    const h = Math.floor(min / 60), m = min % 60
    return m > 0 ? `${h}時間${m}分` : `${h}時間`
  }
  return `${min}分`
}
const fmtRemain = (sec) => {
  if (sec <= 0) return '錬金完成！'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `残り ${h}時間${String(m).padStart(2, '0')}分`
  if (m > 0) return `残り ${m}分${String(s).padStart(2, '0')}秒`
  return `残り ${s}秒`
}

export default function Alchemy() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [pickRank, setPickRank] = useState({}) // slot -> rank（開始前の選択）
  const [, setTick] = useState(0)
  const offsetRef = useRef(0) // serverNow(ms) - Date.now()

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data: p } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
      if (!p?.is_admin) { nav('/game'); return } // 先行公開＝管理者限定
      await load()
      setLoading(false)
    })()
    // 1秒ごとに残り時間を再描画
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const load = async () => {
    const { data: res, error } = await supabase.rpc('alchemy_get')
    if (error || !res?.ok) { setMsg({ t: `読み込み失敗: ${error?.message || res?.reason || ''}`, c: '#ff5555' }); return }
    if (res.server_now) offsetRef.current = new Date(res.server_now).getTime() - Date.now()
    setData(res)
  }

  const flash = (t, c = '#44ffaa') => { setMsg({ t, c }); setTimeout(() => setMsg(null), 2600) }

  const serverNowMs = () => Date.now() + offsetRef.current

  const jobBySlot = (slot) => (data?.jobs || []).find(j => j.slot === slot) || null
  const remainSec = (job) => job?.finish_at ? Math.max(0, Math.round((new Date(job.finish_at).getTime() - serverNowMs()) / 1000)) : 0

  const doStart = async (slot) => {
    const rank = pickRank[slot] || 'F'
    setBusy(true)
    const { data: res, error } = await supabase.rpc('alchemy_start', { p_slot: slot, p_rank: rank })
    setBusy(false)
    if (error || !res?.ok) { flash(`開始失敗: ${error?.message || res?.reason || ''}`, '#ff5555'); return }
    flash(`🧪 強化石(${rank}) の錬金を開始しました`)
    await load()
  }
  const doClaim = async (slot) => {
    setBusy(true)
    const { data: res, error } = await supabase.rpc('alchemy_claim', { p_slot: slot })
    setBusy(false)
    if (error || !res?.ok) { flash(`受取失敗: ${error?.message || res?.reason || ''}`, '#ff5555'); return }
    flash(`🎁 ${res.item} を受け取りました！`)
    await load()
  }
  const doCrystal = async (slot) => {
    setBusy(true)
    const { data: res, error } = await supabase.rpc('alchemy_use_crystal', { p_slot: slot, p_count: 1 })
    setBusy(false)
    if (error || !res?.ok) { flash(`使用失敗: ${error?.message || res?.reason || ''}`, '#ff5555'); return }
    flash('⏳ 時の結晶で1時間短縮しました')
    await load()
  }

  if (loading) return <div style={{ color:'#44ffaa', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  const slots = data?.slots || 0   // 達成した解放条件の数ぶん 錬金部屋1→4 が順に開く（順不同）
  const crystal = data?.crystal || 0
  // まだ達成していない解放条件（エリア③ボスはページ自体のゲート）
  const remainConds = []
  if (data) {
    if (!data.cleared_d30) remainConds.push('追憶の遺跡(30F)踏破')
    if ((data.abyss_clears || 0) < 10) remainConds.push('奈落闘技場10回踏破')
    if (!data.area5_boss) remainConds.push('エリア⑤ボス撃破')
  }

  const box = { border:'1px solid #1a5a3a', background:'#021410', padding:'12px', marginBottom:'10px', borderRadius:'2px' }

  return (
    <div style={{ minHeight:'100vh', background:'#000a08', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'680px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #0a4030', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#44ffaa', fontSize:'15px', letterSpacing:'3px' }}>🧪 錬金部屋 <span style={{ fontSize:'10px', color:'#558877' }}>[開発]</span></div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        {msg && (
          <div style={{ color:msg.c, fontSize:'12px', border:`1px solid ${msg.c}55`, background:'#001810', padding:'8px 12px', marginBottom:'10px' }}>{msg.t}</div>
        )}

        {slots === 0 ? (
          <div style={{ ...box, textAlign:'center', padding:'32px 16px' }}>
            <div style={{ fontSize:'30px', marginBottom:'10px' }}>🔒</div>
            <div style={{ color:'#88ccaa', fontSize:'13px', marginBottom:'6px' }}>錬金部屋はまだ開放されていません</div>
            <div style={{ color:'#557777', fontSize:'11px', lineHeight:'1.8' }}>
              {SLOT_COND[1]}されます。<br />
              ※ すでにエリア③のボスを倒している場合は自動で開放されます
            </div>
          </div>
        ) : (
          <>
            {/* 所持アイテム */}
            <div style={{ ...box, display:'flex', gap:'16px', alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ color:'#88ccaa', fontSize:'12px' }}>⏳ 時の結晶 <b style={{ color:'#cceeff' }}>{crystal}</b> <span style={{ color:'#557777', fontSize:'10px' }}>(各 -1時間)</span></span>
            </div>
            <div style={{ color:'#557777', fontSize:'10px', marginBottom:'10px', lineHeight:'1.7' }}>
              ※ 戦闘勝利で1%「時の結晶」を入手できます。錬金中の枠に使うと完成時間を1時間短縮できます。
            </div>

            {/* 錬金部屋4つ（達成条件数ぶん 1→4 が順に開放） */}
            {[1, 2, 3, 4].map(slot => {
              const unlocked = slot <= slots
              const job = jobBySlot(slot)
              const title = (
                <div style={{ color:'#88ccaa', fontSize:'12px', marginBottom:'8px', textAlign:'left' }}>
                  錬金部屋 {slot}{!job && unlocked && <span style={{ color:'#557777' }}> （空き）</span>}
                </div>
              )
              if (!unlocked) {
                return (
                  <div key={slot} style={{ ...box, opacity:0.7 }}>
                    <div style={{ color:'#557777', fontSize:'12px', textAlign:'left' }}>🔒 錬金部屋 {slot}（未開放）</div>
                    <div style={{ color:'#446666', fontSize:'10px', marginTop:'4px', textAlign:'left' }}>
                      解放条件を1つ達成すると開きます{remainConds.length ? `：${remainConds.join(' / ')}` : ''}
                    </div>
                  </div>
                )
              }
              if (!job) {
                // 空き：ランク選択＋開始
                const rank = pickRank[slot] || 'F'
                return (
                  <div key={slot} style={box}>
                    {title}
                    <div style={{ display:'flex', flexWrap:'wrap', gap:'5px', marginBottom:'8px', justifyContent:'center' }}>
                      {RANKS.map(r => (
                        <button key={r} onClick={() => setPickRank(q => ({ ...q, [slot]: r }))}
                          style={{ padding:'6px 10px', fontFamily:'monospace', fontSize:'12px', cursor:'pointer',
                            background: rank === r ? '#0a2a1e' : '#020e0a',
                            border:`1px solid ${rank === r ? RANK_COLOR[r] : '#1a3a2a'}`,
                            color: rank === r ? RANK_COLOR[r] : '#557777' }}>
                          {r}
                        </button>
                      ))}
                    </div>
                    <div style={{ color:'#557777', fontSize:'11px', marginBottom:'8px', textAlign:'center' }}>
                      強化石({rank}) ／ 所要 <span style={{ color:RANK_COLOR[rank] }}>{fmtDur(RANK_MIN[rank])}</span>
                    </div>
                    <div style={{ textAlign:'center' }}>
                      <button onClick={() => doStart(slot)} disabled={busy}
                        style={{ padding:'8px 16px', background:'#0a2a1e', border:'1px solid #44ffaa', color:'#44ffaa', cursor: busy?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                        🧪 錬金開始
                      </button>
                    </div>
                  </div>
                )
              }
              // 稼働中
              const sec = remainSec(job)
              const ready = sec <= 0
              return (
                <div key={slot} style={{ ...box, border:`1px solid ${ready ? '#ffcc44' : '#1a5a3a'}` }}>
                  {title}
                  <div style={{ color:RANK_COLOR[job.rank], fontSize:'15px', fontWeight:'bold', textAlign:'center', marginBottom:'6px' }}>強化石({job.rank})</div>
                  <div style={{ color: ready ? '#ffcc44' : '#aaffdd', fontSize:'13px', marginBottom:'10px', textAlign:'center' }}>
                    {ready ? '🎉 錬金完成！受け取れます' : fmtRemain(sec)}
                  </div>
                  <div style={{ textAlign:'center' }}>
                    {ready ? (
                      <button onClick={() => doClaim(slot)} disabled={busy}
                        style={{ padding:'8px 16px', background:'#2a2200', border:'1px solid #ffcc44', color:'#ffcc44', cursor: busy?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px' }}>
                        🎁 受け取る
                      </button>
                    ) : (
                      <button onClick={() => doCrystal(slot)} disabled={busy || crystal < 1}
                        style={{ padding:'7px 14px', background: crystal>=1?'#04141a':'#020a08', border:`1px solid ${crystal>=1?'#66ccff':'#1a3a2a'}`, color: crystal>=1?'#66ccff':'#445555', cursor: (busy||crystal<1)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                        ⏳ 結晶で-1時間 ({crystal})
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
