import { useState } from 'react'
import { supabase } from '../../supabase'
import { box, miniBtn, TEXT } from './v2ui.js'
import { BATTLE_ITEMS, CARRY_MAX, itemCountsOf, itemTotalOf } from '../core/atbItems.js'
import { SHOP_COLOR } from '../lib/shop.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 戦闘に持ち込む薬を選ぶ（挑戦のポップアップ・V2capBossPick.jsx）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「アイテムは4つまでしか持てないようにして、全部で合計4つ」「装備は挑戦タブから設定できるように」＋選択「戦闘に持ち込むのが4つ」：
//   3種類を合わせて4つまで。持っている数より多くは選べない。選んだ数はサーバーに残る＝次の挑戦も同じ数（足りなければあるぶんだけ＝core/atbItems.js の carriedItemsOf）
//   押すたびに保存する。saveRef＝送っている途中の保存（親が挑戦を始める前に待つ＝押してすぐ挑戦しても、選んだ数で始まる）
// 【確定】同じ日 ユーザー「ここもっとコンパクトにして」：1種類を1行にして、商店へのボタンは見出しの行へ（×の数が持っている数）
// ============================================================
export default function V2capItemLoadout({ prof, onProfile, onGo, saveRef }) {
  const [local, setLocal] = useState(null)   // 送った数（プロフィールの読み直しが届くまでの表示）
  const [err, setErr] = useState('')
  if (prof?.item_loadout === undefined) return null   // SQL を流すまで出さない
  const chosen = local || itemCountsOf(prof.item_loadout)
  const have = itemCountsOf(prof.items)
  const total = itemTotalOf(chosen)
  const change = (key, d) => {
    const next = { ...chosen, [key]: chosen[key] + d }
    setLocal(next)
    setErr('')
    saveRef.current = saveRef.current
      .then(() => supabase.rpc('v2cap_set_item_loadout', { p_loadout: next }))
      .then(({ data, error }) => {
        if (error || !data?.ok) { setLocal(null); setErr(data?.error || '保存できませんでした') }
        else onProfile?.()
      })
  }
  const short = BATTLE_ITEMS.some(it => chosen[it.key] > have[it.key])   // 選んだ数より持っている数が少ない薬がある
  return (
    <div style={{ ...box, padding:'6px 10px', marginBottom:'10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'3px' }}>
        <span style={{ color: SHOP_COLOR, fontSize:'13px', fontWeight:'bold', whiteSpace:'nowrap' }}>持ち込む薬</span>
        <span style={{ flex:1, color: total >= CARRY_MAX ? '#ffcc66' : TEXT.label, fontSize:'11px', whiteSpace:'nowrap' }}>合計 {total}/{CARRY_MAX}</span>
        <button type="button" onClick={() => onGo?.('shop')} style={{ ...miniBtn(SHOP_COLOR), padding:'4px 8px', whiteSpace:'nowrap' }}>🏪 商店で買う</button>
      </div>
      {BATTLE_ITEMS.map(it => (
        <div key={it.key} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'2px 0' }}>
          <span style={{ flex:1, minWidth:0, fontSize:'12px', whiteSpace:'nowrap' }}>
            <span style={{ color: it.color }}>{it.icon} {it.name}</span>
            <span style={{ color: chosen[it.key] > have[it.key] ? '#ff8844' : TEXT.label, fontSize:'10px' }}> ×{have[it.key]}</span>
          </span>
          <button type="button" onClick={() => change(it.key, -1)} disabled={chosen[it.key] <= 0} aria-label={`${it.name}を1つへらす`}
            style={{ ...miniBtn(SHOP_COLOR), width:'36px', padding:'5px 0', fontSize:'13px', opacity: chosen[it.key] <= 0 ? 0.35 : 1 }}>−</button>
          <span style={{ color: TEXT.body, fontSize:'13px', width:'16px', textAlign:'center' }}>{chosen[it.key]}</span>
          <button type="button" onClick={() => change(it.key, 1)} disabled={total >= CARRY_MAX || chosen[it.key] >= have[it.key]} aria-label={`${it.name}を1つふやす`}
            style={{ ...miniBtn(SHOP_COLOR), width:'36px', padding:'5px 0', fontSize:'13px', opacity: total >= CARRY_MAX || chosen[it.key] >= have[it.key] ? 0.35 : 1 }}>＋</button>
        </div>
      ))}
      {short && <div style={{ color:'#ff8844', fontSize:'10px', marginTop:'2px' }}>足りないぶんは持ち込めません</div>}
      {err && <div style={{ color:'#ff8888', fontSize:'10px', marginTop:'2px' }}>{err}</div>}
    </div>
  )
}
