import { V2Tip } from '../../v2/components/V2ItemTip.jsx'
import { RARITY_COLOR } from '../lib/equipment.js'

// ============================================================
// 「レベルキャップあり」版 — 着けているユニークの固有の能力（2026-10-21・uniqueDefs.js）
//   items … 着けているユニーク（loadout.js の wornUniquesOf）
//   ・compact（ホームのステータス欄）… 1つ1行「ユニーク 蝕毒の牙」。カーソルで能力の文
//   ・ふつう（プロフィール・装備）… 1つずつ、能力の文を全部書く
// ============================================================
const U = RARITY_COLOR.U
const NOTE = '同じユニークは1つまで。LV80より低いLVでも能力は全部効く（ステだけLV相当）。装備とセットの毎ターン回復は合わせて6%まで'

// 能力の文（改行はそのまま行にする）
export const UniqueText = ({ item, style = null }) => (
  <div style={{ whiteSpace:'pre-line', color:'#ffd6dd', lineHeight:1.6, ...style }}>{item?.text || ''}</div>
)

export default function V2capUniqueFx({ items, compact = false, cell = null, valueCell = null }) {
  if (!items?.length) return null
  if (compact) {
    return (
      <div style={{ display:'grid', gap:'2px', marginBottom:'6px' }}>
        {items.map(u => (
          <V2Tip key={u.id} width="270px" color={U} style={{ ...cell, justifyContent:'flex-start' }}
            body={<>
              <div style={{ color: U }}>ユニーク：{u.name}</div>
              <UniqueText item={u} />
              <div style={{ color:'#7fa6d0', marginTop:'3px' }}>{u.boss}が落とす。{NOTE}</div>
            </>}>
            <span style={{ color: U, fontSize:'9px', flexShrink:0 }}>ユニーク</span>
            <span style={{ ...valueCell, flex:1, minWidth:0, textAlign:'left', color:'#cfe2ff' }}>{u.name}</span>
            <span style={{ color: U, fontSize:'9px', flexShrink:0 }}>発動中</span>
          </V2Tip>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display:'grid', gap:'4px' }}>
      {items.map(u => (
        <div key={u.id} style={{ background:'#000818', border:'1px solid #3a1c23', padding:'5px 8px', fontSize:'11px', lineHeight:1.7 }}>
          <div style={{ color: U }}>{u.name}<span style={{ color:'#7fa6d0', fontSize:'10px', marginLeft:'6px' }}>{u.boss}が落とす</span></div>
          <UniqueText item={u} />
        </div>
      ))}
      <div style={{ color:'#7fa6d0', fontSize:'10px' }}>{NOTE}</div>
    </div>
  )
}
