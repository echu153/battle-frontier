import { STAT_DEFS, STAT_KEYS } from '../core/stats.js'
import { TEXT, miniBtn } from './v2ui.js'
import { PARTS, ALL_RARITIES, RARITY_COLOR, partLabel, rarityLabel } from '../lib/equipment.js'
import { plusOf, plusLabel } from '../lib/smith.js'
import { statChangeOf } from '../lib/gear.js'
import { PLUS_COLOR, chip, areaOptionLabel, filterSelect, optionStyle } from './v2capGearView.js'

// ============================================================
// 「レベルキャップあり」版 — 装備の見せ方の部品（装備画面と鍛冶屋で同じものを使う。上がるステはホームとプロフィールでも）
//   ・名前：名前だけをレア度の色で出す（【レア】のような頭の表記は付けない＝2026-10-13 ユーザー指示「【レジェンダリー】【レア】ここら辺の表記もいらない」）。強化値は名前の後ろに +3 のように出す
//   ・持ち物の絞り込みの帯（状態は v2capGearView.js の useGearRows）
// ============================================================
// 強化値の印（+0は付けない）
export const PlusTag = ({ inv }) => (plusOf(inv) > 0 ? <span style={{ color: PLUS_COLOR }}> {plusLabel(plusOf(inv))}</span> : null)
// お気に入りの★（2026-10-26 ユーザー指示「装備にお気に入りできるようにして」）。押すと onToggle(inv)。見た目はスキルのお気に入り（V2capSkills.jsx）と同じ
//   お気に入りの装備は分解も博物館への寄贈もできない（smith.js の bulkPickable・museum.js の donatablesOf・サーバー）
export const FavStar = ({ inv, busy, onToggle }) => (
  <button type="button" onClick={() => onToggle(inv)} disabled={busy} title={inv?.fav ? 'お気に入りを外す' : 'お気に入りにする'} aria-pressed={!!inv?.fav}
    style={{ ...miniBtn(inv?.fav ? '#ffcc00' : '#62789a'), color: inv?.fav ? '#ffcc00' : '#445566', padding:'2px 5px', flexShrink:0 }}>★</button>
)
// 上がるステ（「STR+3 DEX+2」をステの色で）。s = statsAt などの { ステ: 数 }
export const StatGain = ({ s }) => {
  const keys = STAT_KEYS.filter(k => s?.[k] > 0)
  if (!keys.length) return <span style={{ color: TEXT.empty }}>ステータスは上がらない</span>
  return keys.map(k => (
    <span key={k} style={{ color: STAT_DEFS[k].color, marginRight:'6px', whiteSpace:'nowrap' }}>{STAT_DEFS[k].label}+{s[k].toLocaleString()}</span>
  ))
}
// 強化の前と後のステ（「STR 12 → 13（+1）」をステの色で・鍛冶屋の強化と結果のポップアップ・強化券）。from・to = statsAt の { ステ: 数 }
export const StatChange = ({ from, to }) => {
  const rows = statChangeOf(from, to)
  if (!rows.length) return null
  return (
    <div style={{ display:'flex', flexWrap:'wrap', columnGap:'12px' }}>
      {rows.map(r => (
        <span key={r.key} style={{ whiteSpace:'nowrap' }}>
          <span style={{ color: STAT_DEFS[r.key].color }}>{STAT_DEFS[r.key].label}</span> {r.from.toLocaleString()} → <span style={{ color:'#44ff88' }}>{r.to.toLocaleString()}</span>
          {r.diff > 0 && <span style={{ color:'#44ff88' }}>（+{r.diff.toLocaleString()}）</span>}
        </span>
      ))}
    </div>
  )
}

// 絞り込み（部位・レア度・エリア）と並べ替えの帯。g = useGearRows の返り値
// 【確定】2026-10-14 ユーザー指示「全てプルダウンにして、部位 レア度 エリアを横並びにして」（前は部位とレア度がボタンの列）
export function GearFilterBar({ g }) {
  return (
    <>
      <div style={{ display:'flex', gap:'4px', marginBottom:'6px' }}>
        <select value={g.part} onChange={e => g.setPart(e.target.value)} style={filterSelect(g.part !== 'all')}>
          <option value="all" style={optionStyle(TEXT.sub)}>すべての部位</option>
          {PARTS.map(p => <option key={p} value={p} style={optionStyle()}>{partLabel(p)}</option>)}
        </select>
        <select value={g.rarity} onChange={e => g.setRarity(e.target.value)} style={filterSelect(g.rarity !== 'all', RARITY_COLOR[g.rarity])}>
          <option value="all" style={optionStyle(TEXT.sub)}>すべてのレア度</option>
          {/* ★ユニーク（2026-10-21）も選べる */}
          {ALL_RARITIES.map(r => <option key={r} value={r} style={optionStyle(RARITY_COLOR[r])}>{rarityLabel(r)}</option>)}
        </select>
        <select value={g.area} onChange={e => g.setArea(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={filterSelect(g.area !== 'all')}>
          <option value="all" style={optionStyle(TEXT.sub)}>すべてのエリア</option>
          {g.areas.map(a => <option key={a} value={a} style={optionStyle()}>{areaOptionLabel(a)}</option>)}
        </select>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'8px', fontSize:'10px', color: TEXT.label, flexWrap:'wrap' }}>
        <span>並べ替え</span>
        {/* 「お気に入り」＝お気に入り（★）を上に・そのあとは強い順（2026-10-26 ユーザー指示「お気に入りのソートもできるように」） */}
        {[['power', '強い順'], ['ilv', 'LVの高い順'], ['new', '新しい順'], ['fav', 'お気に入り']].map(([k, label]) => (
          <button key={k} onClick={() => g.setSort(k)} style={chip(g.sort === k)}>{label}</button>
        ))}
      </div>
    </>
  )
}
