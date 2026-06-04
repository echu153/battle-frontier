import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const S = {
  page:   { minHeight:'100vh', background:'#000820', padding:'20px', fontFamily:'monospace', color:'#88ccff' },
  title:  { color:'#ffcc00', fontSize:'18px', letterSpacing:'3px', marginBottom:'20px' },
  tabs:   { display:'flex', gap:'8px', marginBottom:'20px' },
  tab:    (active) => ({ padding:'8px 16px', cursor:'pointer', border:`1px solid ${active?'#ffcc00':'#003366'}`, background: active?'#1a1000':'#001028', color: active?'#ffcc00':'#446688', fontSize:'12px' }),
  card:   { border:'1px solid #003366', background:'#001028', padding:'12px', marginBottom:'8px' },
  label:  { color:'#446688', fontSize:'10px', marginBottom:'2px' },
  value:  { color:'#88ccff', fontSize:'12px' },
  warn:   { color:'#ff4444', fontSize:'12px' },
  btn:    (color) => ({ background:'none', border:`1px solid ${color}`, color, padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', marginRight:'6px' }),
  input:  { background:'#001028', border:'1px solid #003366', color:'#88ccff', padding:'6px', fontFamily:'monospace', fontSize:'12px', width:'240px' },
  grid:   { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'8px', fontSize:'11px', color:'#446688', marginBottom:'4px' },
}

export default function Admin() {
  const nav = useNavigate()
  const [tab, setTab] = useState('suspicious')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')

  const [suspicious, setSuspicious] = useState([])
  const [badLogs, setBadLogs] = useState([])
  const [allPlayers, setAllPlayers] = useState([])

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: me, error } = await supabase.from('profiles').select('id, is_admin').eq('id', user.id).maybeSingle()
    if (!me?.is_admin) { nav('/game'); return }
    await fetchAll()
    setLoading(false)
  }

  const fetchAll = async () => {
    const [{ data: sus }, { data: logs }, { data: players }] = await Promise.all([
      supabase.from('profiles')
        .select('id,username,suspicious_flag,exp_frozen_until,exp_frozen,is_suspended,gold,lv,class,created_at')
        .eq('suspicious_flag', true).order('created_at', { ascending: false }),
      supabase.from('battle_logs')
        .select('*, profiles(username)')
        .eq('suspicious', true).order('created_at', { ascending: false }).limit(100),
      supabase.from('profiles')
        .select('id,username,suspicious_flag,exp_frozen_until,exp_frozen,is_suspended,gold,lv,class,created_at')
        .order('created_at', { ascending: false }).limit(200),
    ])
    setSuspicious(sus || [])
    setBadLogs(logs || [])
    setAllPlayers(players || [])
  }

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000) }

  const freezeExp = async (id, hours = 12) => {
    await supabase.from('profiles').update({
      exp_frozen_until: new Date(Date.now() + hours * 3600000).toISOString()
    }).eq('id', id)
    flash(`EXP凍結（${hours}h）`)
    fetchAll()
  }

  const unfreezeExp = async (id) => {
    await supabase.from('profiles').update({ exp_frozen_until: null, exp_frozen: false }).eq('id', id)
    flash('EXP凍結解除')
    fetchAll()
  }

  const clearFlag = async (id) => {
    await supabase.from('profiles').update({ suspicious_flag: false }).eq('id', id)
    flash('フラグ解除')
    fetchAll()
  }

  const banPlayer = async (id) => {
    if (!confirm('このプレイヤーを停止しますか？')) return
    await supabase.from('profiles').update({ is_suspended: true, suspension_reason: '管理者による停止' }).eq('id', id)
    flash('停止しました')
    fetchAll()
  }

  const unbanPlayer = async (id) => {
    await supabase.from('profiles').update({ is_suspended: false, suspension_reason: null }).eq('id', id)
    flash('停止解除しました')
    fetchAll()
  }

  const PlayerCard = ({ p }) => (
    <div style={S.card}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ color: p.suspicious_flag ? '#ff8844' : '#88ccff', fontSize:'13px', marginBottom:'4px' }}>
            {p.suspicious_flag ? '⚠ ' : ''}{p.username}
            {p.is_suspended && <span style={{ color:'#ff4444', marginLeft:'8px' }}>⛔停止中</span>}
          </div>
          <div style={S.grid}>
            <span>LV {p.lv} / {p.class}</span>
            <span>Gold {(p.gold||0).toLocaleString()}</span>
            <span style={{ color: isExpFrozen(p) ? '#ff8844' : '#446688' }}>
              {isExpFrozen(p) ? `EXP停止中 ${frozenUntilStr(p)}` : 'EXP通常'}
            </span>
          </div>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', justifyContent:'flex-end' }}>
          {isExpFrozen(p)
            ? <button style={S.btn('#44ff88')} onClick={() => unfreezeExp(p.id)}>EXP解除</button>
            : <button style={S.btn('#ff8844')} onClick={() => freezeExp(p.id, 12)}>EXP停止12h</button>
          }
          {p.suspicious_flag && <button style={S.btn('#aaaaaa')} onClick={() => clearFlag(p.id)}>フラグ解除</button>}
          {p.is_suspended
            ? <button style={S.btn('#44ff88')} onClick={() => unbanPlayer(p.id)}>停止解除</button>
            : <button style={S.btn('#ff4444')} onClick={() => banPlayer(p.id)}>停止</button>
          }
        </div>
      </div>
    </div>
  )

  const isExpFrozen = (p) =>
    p.exp_frozen || (p.exp_frozen_until && new Date(p.exp_frozen_until) > new Date())

  const frozenUntilStr = (p) => {
    if (!p.exp_frozen_until) return ''
    const d = new Date(p.exp_frozen_until)
    return `〜${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  const filteredPlayers = allPlayers.filter(p =>
    !search || p.username?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <div style={{ ...S.page, display:'flex', alignItems:'center', justifyContent:'center' }}>読み込み中...</div>

  return (
    <div style={S.page}>
      <div style={{ maxWidth:'900px', margin:'0 auto' }}>
        <div style={S.title}>⚙ 管理者パネル</div>

        {msg && <div style={{ background:'#001a40', border:'1px solid #0044aa', padding:'8px', marginBottom:'12px', color:'#88ccff', fontSize:'12px' }}>{msg}</div>}

        <div style={S.tabs}>
          {[['suspicious','⚠ 不審プレイヤー'], ['logs','不正ログ'], ['all','全プレイヤー']].map(([key, label]) => (
            <button key={key} style={S.tab(tab===key)} onClick={() => setTab(key)}>{label}</button>
          ))}
          <button style={S.btn('#446688')} onClick={() => nav('/game')}>← ゲームに戻る</button>
        </div>

        {tab === 'suspicious' && (
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>不審フラグ: {suspicious.length}件</div>
            {suspicious.length === 0
              ? <div style={{ color:'#446688' }}>現在不審なプレイヤーはいません</div>
              : suspicious.map(p => <PlayerCard key={p.id} p={p} />)
            }
          </div>
        )}

        {tab === 'logs' && (
          <div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>不正バトルログ（直近100件）</div>
            {badLogs.length === 0
              ? <div style={{ color:'#446688' }}>不正ログなし</div>
              : badLogs.map(log => (
                <div key={log.id} style={{ ...S.card, borderColor:'#440000' }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ color:'#ff8844' }}>{log.profiles?.username}</span>
                    <span style={{ color:'#446688', fontSize:'10px' }}>{new Date(log.created_at).toLocaleString('ja-JP')}</span>
                  </div>
                  <div style={{ ...S.grid, marginTop:'6px' }}>
                    <span>エリア{log.area_id} {log.is_boss?'ボス':log.is_papia?'パピア':'通常'}</span>
                    <span style={{ color: log.gold_gained > 1000 ? '#ff4444' : '#88ccff' }}>Gold +{log.gold_gained}</span>
                    <span style={{ color: log.exp_gained > 200 ? '#ff4444' : '#88ccff' }}>EXP +{log.exp_gained}</span>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {tab === 'all' && (
          <div>
            <input style={{ ...S.input, marginBottom:'12px' }} placeholder="名前で検索..."
              value={search} onChange={e => setSearch(e.target.value)} />
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'8px' }}>{filteredPlayers.length}件</div>
            {filteredPlayers.map(p => <PlayerCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </div>
  )
}
