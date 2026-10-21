import { V2Tip } from './V2ItemTip.jsx'
import { SET_TIERS, setTierText, setLabel } from '../lib/armorSets.js'

// ============================================================
// 「レベルキャップあり」版 — 防具のセット能力の一覧（2026-10-14・armorSets.js）
//   sets … loadout.js の setsOf／statBreakdown の sets（発動している組だけ：2部位以上）
//   ・compact（ホームのステータス欄）… 1組1行「始まりの森・重鎧 2部位 発動中」。カーソルで2・3・4部位の中身（届いた段に✔）
//   ・ふつう（プロフィール）… 1組ずつ、2・3・4部位の中身を全部書く（届いていない段は薄く）
// ============================================================
const SET_COLOR = '#88ddaa'
const OFF = '#4d6f92'

const tierRows = (s) => SET_TIERS.map(n => {
  const on = s.tiers.includes(n)
  return (
    <div key={n} style={{ color: on ? '#cfe2ff' : OFF }}>
      <span style={{ color: on ? SET_COLOR : OFF }}>{on ? '✔' : '・'} {n}部位</span>：{setTierText(s.def, n, s.line)}
    </div>
  )
})
const NOTE = '同じエリア・同じ系統（重鎧／軽装）のレア以上の防具で数える。必要LVに足りない防具も数える'

export default function V2capArmorSets({ sets, compact = false, cell = null, valueCell = null }) {
  if (!sets?.length) return null
  if (compact) {
    return (
      <div style={{ display:'grid', gap:'2px', marginBottom:'6px' }}>
        {sets.map(s => (
          <V2Tip key={`${s.area}|${s.line}`} width="270px" color={SET_COLOR} style={{ ...cell, justifyContent:'flex-start' }}
            body={<>
              <div style={{ color: SET_COLOR }}>セット能力：{setLabel(s.area, s.line)}（{s.count}部位）</div>
              {tierRows(s)}
              <div style={{ color:'#7fa6d0', marginTop:'3px' }}>{NOTE}</div>
            </>}>
            <span style={{ color: SET_COLOR, fontSize:'9px', flexShrink:0 }}>セット</span>
            <span style={{ ...valueCell, flex:1, minWidth:0, textAlign:'left', color:'#cfe2ff' }}>{setLabel(s.area, s.line)} {s.count}部位</span>
            <span style={{ color: SET_COLOR, fontSize:'9px', flexShrink:0 }}>発動中</span>
          </V2Tip>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display:'grid', gap:'4px' }}>
      {sets.map(s => (
        <div key={`${s.area}|${s.line}`} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 8px', fontSize:'11px', lineHeight:1.7 }}>
          <div style={{ color: SET_COLOR }}>{setLabel(s.area, s.line)}（{s.count}部位）</div>
          {tierRows(s)}
        </div>
      ))}
      <div style={{ color:'#7fa6d0', fontSize:'10px' }}>{NOTE}</div>
    </div>
  )
}
