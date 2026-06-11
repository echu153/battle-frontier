import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// かかし修練中（時間経過前）の制限対象ページ用ガード
// 賭博場・釣り・挑戦(奈落/天穹)・ダンジョン(ペット) で使用
export function useScarecrowBlock() {
  const [block, setBlock] = useState(null)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('scarecrow_sessions')
        .select('id, ends_at, duration_hours')
        .eq('player_id', user.id)
        .eq('status', 'active')
        .maybeSingle()
      // 時間経過後（報酬受け取り待ち）は制限解除
      if (data && new Date(data.ends_at) > new Date()) setBlock(data)
    })()
  }, [])
  return block
}

export function ScarecrowBlockScreen({ endsAt }) {
  const nav = useNavigate()
  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ border:'1px solid #886600', background:'#0a0800', padding:'30px', textAlign:'center', maxWidth:'400px' }}>
        <div style={{ fontSize:'40px', marginBottom:'12px' }}>🌾</div>
        <div style={{ color:'#ffcc44', fontSize:'14px', marginBottom:'10px' }}>かかし修練中です</div>
        <div style={{ color:'#aaaaaa', fontSize:'12px', lineHeight:'1.8', marginBottom:'8px' }}>
          修練中は 出撃・賭博場・釣り・挑戦・ダンジョン を利用できません。
        </div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'16px' }}>
          終了予定: {new Date(endsAt).toLocaleString('ja-JP')}
        </div>
        <div style={{ display:'flex', gap:'8px', justifyContent:'center' }}>
          <button onClick={() => nav('/scarecrow')}
            style={{ padding:'8px 16px', background:'#0a0800', border:'1px solid #886600', color:'#ffcc44', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🌾 修練場へ
          </button>
          <button onClick={() => nav('/game')}
            style={{ padding:'8px 16px', background:'none', border:'1px solid #0088ff', color:'#0088ff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            ← 街に戻る
          </button>
        </div>
      </div>
    </div>
  )
}
