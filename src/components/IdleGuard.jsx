import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

// ============================================================
// 放置系コンテンツの排他ガード
//
// ルール: 釣り と かかし修練 は同時に片方だけ。両方向を必ず塞ぐこと。
//   ・かかし修練中 → 釣り/賭博場/挑戦(奈落/天穹)/ダンジョン を制限 … useScarecrowBlock
//   ・釣り中       → かかし修練の開始を制限                        … useFishingBlock
// 片方向だけ実装して、逆から入れてしまう不具合が実際に起きた(2026-07-16)。
// 権威はサーバー側(supabase_idle_exclusive.sql のトリガー)。ここは案内用。
//
// ※釣り×ペットダンジョンの並行は仕様(排他にしない)。
// ※自動遠征(idle_camp)は is_admin 限定のため現状は対象外。一般公開時に排他へ加えること。
// ============================================================

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

// 釣り中のガード（かかし修練場で使用）＝ useScarecrowBlock の逆方向
export function useFishingBlock() {
  const [block, setBlock] = useState(null)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('is_fishing, fishing_location')
        .eq('id', user.id)
        .maybeSingle()
      if (data?.is_fishing) setBlock(data)
    })()
  }, [])
  return block
}

export function FishingBlockScreen({ location }) {
  const nav = useNavigate()
  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ border:'1px solid #006688', background:'#000a10', padding:'30px', textAlign:'center', maxWidth:'400px' }}>
        <div style={{ fontSize:'40px', marginBottom:'12px' }}>🎣</div>
        <div style={{ color:'#44ccff', fontSize:'14px', marginBottom:'10px' }}>釣り中です</div>
        <div style={{ color:'#aaaaaa', fontSize:'12px', lineHeight:'1.8', marginBottom:'8px' }}>
          放置は釣りとかかし修練のどちらか片方だけです。<br />
          釣りを終了してから修練を開始してください。
        </div>
        {location && (
          <div style={{ color:'#446688', fontSize:'11px', marginBottom:'16px' }}>
            釣り場: {location}
          </div>
        )}
        <div style={{ display:'flex', gap:'8px', justifyContent:'center' }}>
          <button onClick={() => nav('/fishing')}
            style={{ padding:'8px 16px', background:'#000a10', border:'1px solid #006688', color:'#44ccff', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            🎣 釣り場へ
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
