// ============================================================
// 🏳 戦争ページ（/war）  ※is_admin限定で先行公開
//   国(領地)同士の戦争。宣戦布告→開戦→敵コアを削る→勝利で敗国領地を総取り。
//   データ(自分のprofile・全countries)を読み込み、本体UI(WarPanel)へ渡す。
//   戦闘ロジックは war.js→pvp.js→Game の循環import回避のためページ自体を遅延ロード(App.jsx)。
// ============================================================
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import WarPanel from '../components/WarPanel'

export default function War() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState(null)
  const [countries, setCountries] = useState([])

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const [{ data: prof }, { data: cs }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('countries').select('*'),
      ])
      setMe(prof || null)
      setCountries(cs || [])
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const myCountry = me?.country_id ? (countries.find(c => c.id === me.country_id) || null) : null

  return (
    <div style={{ minHeight:'100vh', background:'#0a0800', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'720px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #5a2a1a', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#0a0800' }}>
          <div style={{ color:'#ff8a6a', fontSize:'15px', letterSpacing:'3px' }}>🏳 戦争 <span style={{ color:'#aa6655', fontSize:'10px' }}>(開発者限定)</span></div>
          <button onClick={() => nav('/territory')} style={{ background:'none', border:'1px solid #e05a62', color:'#ff6464', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 領地へ</button>
        </div>

        {loading ? (
          <div style={{ color:'#bb9977', fontSize:'12px', padding:'24px', textAlign:'center' }}>読み込み中…</div>
        ) : !me?.is_admin ? (
          <div style={{ color:'#ddaa88', fontSize:'12px', border:'1px solid #5a2a1a', background:'#1a0c04', padding:'16px', textAlign:'center' }}>
            戦争機能は開発中です（管理者限定）。
          </div>
        ) : (
          <WarPanel me={me} myCountry={myCountry} countries={countries} />
        )}
      </div>
    </div>
  )
}
