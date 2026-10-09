import { miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { PARTS, RARITIES, RARITY_COLOR, partLabel, rarityLabel } from '../lib/equipment.js'
import { plusOf, plusLabel } from '../lib/smith.js'
import { PLUS_COLOR, chip, areaOptionLabel } from './v2capGearView.js'

// ============================================================
// 「レベルキャップあり」版 — 装備の見せ方の部品（装備画面と鍛冶屋で同じものを使う）
//   ・名前：ノーマルは名前だけ、ほかは【レア】のように頭に付けてレア度の色。強化値は名前の後ろに +3 のように出す
//   ・持ち物の絞り込みの帯（状態は v2capGearView.js の useGearRows）
// ============================================================
// レア度の印（ノーマルは付けない）
export const RarityTag = ({ item }) => (item.rarity === 'N' ? null
  : <span style={{ color: RARITY_COLOR[item.rarity] }}>【{rarityLabel(item.rarity)}】</span>)
// 強化値の印（+0は付けない）
export const PlusTag = ({ inv }) => (plusOf(inv) > 0 ? <span style={{ color: PLUS_COLOR }}> {plusLabel(plusOf(inv))}</span> : null)

// 絞り込み（部位・レア度・エリア）と並べ替えの帯。g = useGearRows の返り値
export function GearFilterBar({ g }) {
  return (
    <>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'4px' }}>
        {['all', ...PARTS].map(p => (
          <button key={p} onClick={() => g.setPart(p)} style={chip(g.part === p)}>{p === 'all' ? 'すべて' : partLabel(p)}</button>
        ))}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'4px', alignItems:'center' }}>
        {['all', ...RARITIES].map(r => (
          <button key={r} onClick={() => g.setRarity(r)}
            style={r !== 'all' && g.rarity === r ? { ...miniBtn(RARITY_COLOR[r]), color: RARITY_COLOR[r] } : chip(g.rarity === r)}>
            {r === 'all' ? 'すべてのレア度' : rarityLabel(r)}
          </button>
        ))}
        <select value={g.area} onChange={e => g.setArea(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          style={{ background:'#000818', border:'1px solid #62789a', color:'#93a9be', fontFamily:'monospace', fontSize:'10px', padding:'2px 4px' }}>
          <option value="all">すべてのエリア</option>
          {g.areas.map(a => <option key={a} value={a}>{areaOptionLabel(a)}</option>)}
        </select>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'8px', fontSize:'10px', color: TEXT.label, flexWrap:'wrap' }}>
        <span>並べ替え</span>
        {[['power', '強い順'], ['ilv', 'LVの高い順'], ['new', '新しい順']].map(([k, label]) => (
          <button key={k} onClick={() => g.setSort(k)} style={chip(g.sort === k)}>{label}</button>
        ))}
      </div>
    </>
  )
}
