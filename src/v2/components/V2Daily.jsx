import { useState } from 'react'
import { supabase } from '../../supabase'
import {
  TASKS, LEVELS, levelOf, pickedLevelOf, progressOf, doneCountOf,
  isComplete, isClaimed, canClaim,
} from '../lib/daily.js'
import { box, btn, miniBtn } from './v2ui.js'
import V2Modal from './V2Modal.jsx'
import V2Help from './V2Help.jsx'

// デイリーミッション。1日1組で、難易度を2つから選ぶ。
// ★数えるのも達成の判定も報酬もサーバー（v2_daily_pick / v2_daily_claim）。
//   ここは進み具合を出して、選ぶ・受け取るを送るだけ。仕組みの正は src/v2/lib/daily.js。
//
// embedded  … ホームに載せるとき。畳んだ見出しだけ出す
// showPanel … 選び終えたあとの枠を出すか（ホーム以外では出さない）。
//             ★難易度を選ぶポップアップは showPanel に関係なく出る＝どの画面でも通さない
export default function V2Daily({ prof, onProfile, embedded = false, showPanel = true }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [got, setGot] = useState(null)     // 受け取った結果のポップアップ
  const [open, setOpen] = useState(!embedded)

  const picked = pickedLevelOf(prof)
  const lv = levelOf(picked)
  const done = picked ? isComplete(prof, picked) : false
  const claimed = isClaimed(prof)
  const claimErr = canClaim(prof)

  const pick = async (key) => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2_daily_pick', { p_level: key })
    setBusy(false)
    if (error || !data?.ok) { setMsg(error?.message || data?.error || '選べませんでした'); return }
    onProfile(null)
  }

  const claim = async () => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2_daily_claim')
    setBusy(false)
    if (error || !data?.ok) { setMsg(error?.message || data?.error || '受け取れませんでした'); return }
    setGot(data)
    onProfile(null)
  }

  // ★難易度を選ぶ前。毎日の最初のログインで**閉じられないポップアップ**として出る。
  //   選ぶまで先へ進めない（閉じるボタンなし・Escも効かない・背景も反応しない）。
  //   画面を移っても出したいので、V2Home 側では screen に関係なくこの部品を置いてある。
  if (!picked) {
    return (
      <V2Modal title="📋 今日のミッション" color="#ffcc00" noClose>
        <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'10px', lineHeight:1.8 }}>
          難易度を選んでください。<b style={{ color:'#ff8844' }}>選んだあとは今日のうちは変えられません</b>。<br />
          日付が変わるのは日本時間の5時です。
        </div>
        <div style={{ display:'grid', gap:'6px' }}>
          {LEVELS.map(l => (
            <button key={l.key} onClick={() => pick(l.key)} disabled={busy}
              style={{ textAlign:'left', padding:'10px 12px', background:'#000818',
                border:`1px solid ${l.color}`, color:l.color, cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily:'monospace', fontSize:'13px' }}>
              {l.label}
              <span style={{ color:'#ffcc00', fontSize:'10px', marginLeft:'8px' }}>
                EXP+{l.reward.exp}・{l.reward.gold}G
              </span>
              <div style={{ color:'#7fa6d0', fontSize:'10px', marginTop:'3px', lineHeight:1.7 }}>
                {TASKS.map(t => `${t.label}${l.goals[t.key]}${t.unit}${t.note ? `（${t.note}）` : ''}`).join('／')}
              </div>
            </button>
          ))}
        </div>
        {busy && <div style={{ color:'#7fa6d0', fontSize:'11px', marginTop:'8px' }}>選んでいます...</div>}
        {msg && <div style={{ color:'#ff6666', fontSize:'11px', marginTop:'8px' }}>⚠ {msg}</div>}
      </V2Modal>
    )
  }

  // 難易度を選び終えたあとは、ホームのときだけ折りたたみの枠を出す
  if (!showPanel) return null

  // ★畳んでいても進み具合が分かるように「2/4」を出す（開かないと分からないのを避ける）
  const doneCount = doneCountOf(prof, picked)
  const head = (
    <span>
      📋 今日のミッション
      <span style={{ marginLeft:'8px' }}><V2Help id="daily" auto={false} /></span>
      <span style={{ color:lv.color, fontSize:'10px', marginLeft:'6px' }}>{lv.label}</span>
      <span style={{ color: done ? '#44ff88' : '#ffcc00', fontSize:'11px', marginLeft:'6px' }}>
        {doneCount}/{TASKS.length}
      </span>
      {claimed
        ? <span style={{ color:'#44ff88', fontSize:'10px', marginLeft:'6px' }}>受け取り済み</span>
        : done && <span style={{ color:'#ffcc00', fontSize:'10px', marginLeft:'6px' }}>達成！受け取れます</span>}
    </span>
  )

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'8px',
      borderColor: claimed ? '#0044aa' : done ? '#ffcc00' : '#0044aa' }}>
      {embedded ? (
        <button onClick={() => setOpen(v => !v)}
          style={{ ...miniBtn(done && !claimed ? '#ffcc00' : '#7fa6d0'), width:'100%', padding:'5px', textAlign:'left' }}>
          {open ? '▲ ' : '▼ '}{head}
        </button>
      ) : <div style={{ color:'#ffcc00', fontSize:'13px', marginBottom:'6px' }}>{head}</div>}

      {open && (<>
        <div style={{ display:'grid', gap:'2px', marginTop:'8px' }}>
          {TASKS.map(t => {
            const p = progressOf(prof, picked, t.key)
            return (
              <div key={t.key} style={{ background:'#000818', border:'1px solid #002244', padding:'4px 7px',
                display:'flex', alignItems:'center', gap:'6px', fontSize:'11px' }}>
                <span style={{ color: p.done ? '#44ff88' : '#62789a', flexShrink:0 }}>{p.done ? '✔' : '□'}</span>
                <span style={{ color: p.done ? '#44ff88' : '#a8c4d6', flex:1 }}>
                  {t.label}
                  {/* ★出撃はクールタイムで数え方が変わるので、その旨をここに出す */}
                  {t.note && <span style={{ color:'#7fa6d0', fontSize:'9px' }}>（{t.note}）</span>}
                </span>
                <span style={{ color: p.done ? '#44ff88' : '#ffcc00' }}>{p.now}</span>
                <span style={{ color:'#62789a' }}>/ {p.goal}{t.unit}</span>
              </div>
            )
          })}
        </div>
        <div style={{ color:'#7fa6d0', fontSize:'10px', margin:'6px 0' }}>
          報酬　<span style={{ color:'#ffcc00' }}>EXP+{lv.reward.exp}・{lv.reward.gold}G</span>
        </div>
        <button onClick={claim} disabled={!!claimErr || busy}
          style={{ ...btn(claimErr ? '#334455' : '#ffcc00'), width:'100%',
            color: claimErr ? '#445566' : '#ffcc00', cursor: claimErr ? 'not-allowed' : 'pointer' }}>
          {busy ? '受け取り中...' : claimed ? '受け取り済み' : done ? '🎁 報酬を受け取る' : '達成すると受け取れます'}
        </button>
        {msg && <div style={{ color:'#ff6666', fontSize:'11px', marginTop:'8px' }}>⚠ {msg}</div>}
      </>)}

      {got && (
        <V2Modal title="🎁 ミッション達成！" color="#ffcc00" onClose={() => setGot(null)}>
          <div style={{ color:'#ffcc00', fontSize:'14px' }}>
            EXP +{got.exp}　{got.gold}G を受け取った！
          </div>
          {got.level_up?.ups > 0 && (
            <div style={{ color:'#44ff88', marginTop:'4px' }}>🆙 レベルアップ！ LV{got.level_up.lv}</div>
          )}
          <div style={{ color:'#7fa6d0', fontSize:'10px', marginTop:'6px' }}>
            次のミッションは日本時間の5時に切り替わります。
          </div>
        </V2Modal>
      )}
    </div>
  )
}
