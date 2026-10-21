import { TEXT } from '../../v2/components/v2ui.js'
import { GENDERS } from '../lib/gender.js'

// ============================================================
// 「レベルキャップあり」版 — 性別の2択（2026-10-21・決まりは lib/gender.js）
//   キャラ作成と、性別を持たない前からのキャラがホームで1回だけ選ぶ所で使う。
//   カードは「♂ 男性」と性能差の一言（与えるダメージ+2%／受けるダメージ−2%）。見た目はキャラ作成のクラスのカードと同じ
// ============================================================
export default function V2capGenderPick({ value, onChange, disabled = false }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:'6px' }}>
      {GENDERS.map(g => {
        const on = value === g.key
        return (
          <button type="button" key={g.key} disabled={disabled} onClick={() => onChange(g.key)}
            style={{ textAlign:'left', background: on ? '#001840' : '#000818', border:`1px solid ${on ? '#ffcc00' : '#002244'}`,
              color:'#88ccff', padding:'8px', cursor: disabled ? 'wait' : 'pointer', fontFamily:'monospace' }}>
            <div style={{ color: on ? '#ffcc00' : '#cfe2ff', fontSize:'12px', marginBottom:'4px' }}>
              <span style={{ color: g.color }}>{g.mark}</span> {g.label}
            </div>
            <div style={{ color: TEXT.sub, fontSize:'10px' }}>{g.text}</div>
          </button>
        )
      })}
    </div>
  )
}
