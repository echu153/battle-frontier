import {
  ALL, RANK_OPTIONS, TYPE_OPTIONS, plusOptions, SORTS, PAGE_SIZE, pageCount,
} from '../lib/browse.js'
import { miniBtn } from './v2ui.js'

// 装備一覧の「絞り込み・並べ替え」バーと「ページ送り」。倉庫と鍛冶屋で共通。
// ★見た目は v2ui のターミナル調に合わせる（選択肢は <select>。数が多いのでボタンだと並ばない）

const sel = {
  background:'#001028', border:'1px solid #0044aa', color:'#88ccff',
  padding:'3px 6px', fontFamily:'monospace', fontSize:'10px',
}
const label = { color:'#7fa6d0', fontSize:'9px', marginRight:'2px' }

export function V2Filter({ value, onChange, rows, showPlus = true, right = null }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const opts = plusOptions(rows)
  return (
    <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center', marginBottom:'8px' }}>
      <span>
        <span style={label}>ランク</span>
        <select value={value.rank} onChange={e => set({ rank: e.target.value })} style={sel}>
          {RANK_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </span>
      <span>
        <span style={label}>種類</span>
        <select value={value.type} onChange={e => set({ type: e.target.value })} style={sel}>
          {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </span>
      {showPlus && (
        <span>
          <span style={label}>強化値</span>
          <select value={String(value.plus)}
            onChange={e => set({ plus: e.target.value === ALL ? ALL : Number(e.target.value) })} style={sel}>
            {opts.map(p => <option key={String(p)} value={String(p)}>{p === ALL ? ALL : `+${p}`}</option>)}
          </select>
        </span>
      )}
      <span>
        <span style={label}>並べ替え</span>
        <select value={value.sort} onChange={e => set({ sort: e.target.value })} style={sel}>
          {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button onClick={() => set({ asc: !value.asc })} style={{ ...miniBtn('#7fa6d0'), marginLeft:'2px' }}>
          {value.asc ? '▲昇順' : '▼降順'}
        </button>
      </span>
      {(value.rank !== ALL || value.type !== ALL || value.plus !== ALL) && (
        <button onClick={() => set({ rank: ALL, type: ALL, plus: ALL })} style={miniBtn('#ff8888')}>絞り込み解除</button>
      )}
      {right && <span style={{ marginLeft:'auto', color:'#7fa6d0', fontSize:'10px' }}>{right}</span>}
    </div>
  )
}


export function V2Pager({ page, total, onPage, unit = '件' }) {
  const last = pageCount(total)
  if (total <= PAGE_SIZE) {
    return <div style={{ color:'#7fa6d0', fontSize:'10px', marginTop:'6px' }}>{total}{unit}</div>
  }
  // ページ番号は0始まりだが、表示は1始まり
  const nums = Array.from({ length: last }, (_, i) => i)
  return (
    <div style={{ display:'flex', gap:'3px', flexWrap:'wrap', alignItems:'center', marginTop:'8px' }}>
      <button onClick={() => onPage(page - 1)} disabled={page <= 0}
        style={{ ...miniBtn(page <= 0 ? '#223a5e' : '#88aaff'), cursor: page <= 0 ? 'not-allowed' : 'pointer' }}>◀</button>
      {nums.map(n => (
        <button key={n} onClick={() => onPage(n)}
          style={{ ...miniBtn(n === page ? '#00aaff' : '#7fa6d0'), background: n === page ? '#002850' : '#000818', minWidth:'22px' }}>
          {n + 1}
        </button>
      ))}
      <button onClick={() => onPage(page + 1)} disabled={page >= last - 1}
        style={{ ...miniBtn(page >= last - 1 ? '#223a5e' : '#88aaff'), cursor: page >= last - 1 ? 'not-allowed' : 'pointer' }}>▶</button>
      <span style={{ color:'#7fa6d0', fontSize:'10px', marginLeft:'4px' }}>
        {total}{unit}中 {page * PAGE_SIZE + 1}〜{Math.min(total, (page + 1) * PAGE_SIZE)}
      </span>
    </div>
  )
}
