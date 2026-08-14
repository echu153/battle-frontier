import { STAT_DEFS, MAX_LV, calcPower, expToNext } from '../lib/stats.js'
import { classBonusText } from '../lib/classBonus.js'
import { equippedItems, gearPower, totalStats } from '../lib/loadout.js'
import { RANK_COLOR } from './v2ui.js'

// ★あるけみすとのステータス画面と同じ作り：
//   見出しの帯 → 「項目名（色つき）｜値」を2列で並べる表。
//   ステータスも装備もスキルも1枚に収まっているので、ここを見れば全部わかる。
//   見出しを押すと折りたためる。
const HEAD = { background:'#1d2a52', color:'#aabbdd', fontSize:'11px', padding:'5px 8px', letterSpacing:'1px', textAlign:'center', cursor:'pointer', userSelect:'none' }
const KEY = { background:'#101c3c', color:'#7f95c4', fontSize:'11px', padding:'5px 8px', borderTop:'1px solid #0a1430' }
const VAL = { background:'#0a1330', color:'#cfe2ff', fontSize:'11px', padding:'5px 8px', borderTop:'1px solid #0a1430', wordBreak:'break-all' }

export default function V2Status({ prof, inventory, open, onToggle }) {
  const worn = equippedItems(prof, inventory)
  const total = totalStats(prof, inventory)
  const gear = gearPower(prof, inventory)
  const skills = prof?.skill_set || []

  // 「項目｜値」を2組ずつ並べる
  const Row = ({ k1, v1, k2, v2 }) => (
    <>
      <div style={KEY}>{k1}</div><div style={VAL}>{v1}</div>
      <div style={KEY}>{k2 ?? ''}</div><div style={VAL}>{k2 == null ? '' : v2}</div>
    </>
  )
  const eq = (slot) => {
    const w = worn[slot]
    if (!w) return <span style={{ color:'#44567e' }}>—</span>
    return (
      <span>
        <span style={{ color: RANK_COLOR[w.item.rank] }}>[{w.item.rank}]</span>{' '}
        {w.item.name}{w.inv.plus ? <span style={{ color:'#ffcc00' }}>+{w.inv.plus}</span> : ''}
      </span>
    )
  }
  const statCell = (k) => {
    const base = prof[k] || 0
    const add = (total[k] || 0) - base
    return <>{total[k].toLocaleString()}{add > 0 && <span style={{ color:'#44ff88', fontSize:'10px' }}> (+{add.toLocaleString()})</span>}</>
  }

  return (
    <div style={{ border:'1px solid #0044aa', marginBottom:'12px', fontFamily:'monospace' }}>
      <div style={HEAD} onClick={onToggle}>{open ? '▼' : '▶'} ステータス</div>
      {open && (
        <>
          <div style={{ ...HEAD, cursor:'default', background:'#16224a' }}>
            戦闘力: {(calcPower(prof) + gear).toLocaleString()}
            <span style={{ color:'#7f95c4', fontSize:'10px' }}>
              （本体{calcPower(prof).toLocaleString()}{gear ? ` ＋装備${gear.toLocaleString()}` : ''}）
            </span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'auto 1fr auto 1fr' }}>
            <Row k1="LV" v1={`${prof.lv}${prof.lv >= MAX_LV ? ' (MAX)' : ''}`}
              k2="EXP" v2={`${prof.exp} / ${expToNext(prof.lv, prof.job_changes) || '—'}`} />
            {[['hp', 'mp'], ['str', 'dex'], ['agi', 'int_stat'], ['vit', 'luk']].map(([a, b]) => (
              <Row key={a} k1={STAT_DEFS[a].label} v1={statCell(a)} k2={STAT_DEFS[b].label} v2={statCell(b)} />
            ))}
            <Row k1="武器（右手）" v1={eq('right')} k2="頭具" v2={eq('head')} />
            <Row k1="武器（左手）" v1={eq('left')} k2="防具" v2={eq('body')} />
            <Row k1="腕具" v1={eq('arm')} k2="足具" v2={eq('foot')} />
            <Row k1="アクセサリー" v1={eq('acc1')} k2="アクセサリー" v2={eq('acc2')} />
            {[0, 2, 4].map(i => (
              <Row key={i} k1={`スキル${i + 1}`} v1={skills[i]?.name || <span style={{ color:'#44567e' }}>—</span>}
                k2={i + 1 < 5 ? `スキル${i + 2}` : '職業'}
                v2={i + 1 < 5 ? (skills[i + 1]?.name || <span style={{ color:'#44567e' }}>—</span>) : prof.class} />
            ))}
            <Row k1="職業補正" v1={classBonusText(prof.class) || <span style={{ color:'#44567e' }}>なし</span>}
              k2="転職回数" v2={`${prof.job_changes}回`} />
            <Row k1="所持金" v1={`${(prof.gold || 0).toLocaleString()} Gold`}
              k2="解放エリア" v2={`${(prof.unlocked_areas || [1]).length} / 8`} />
          </div>
        </>
      )}
    </div>
  )
}

// 行動メニュー。あるけみすとと同じ「施設名｜ボタン」の2列
export function V2Menu({ items, open, onToggle, onPick }) {
  return (
    <div style={{ border:'1px solid #0044aa', marginBottom:'12px', fontFamily:'monospace' }}>
      <div style={HEAD} onClick={onToggle}>{open ? '▼' : '▶'} 行動メニュー</div>
      {open && (
        <div style={{ display:'grid', gridTemplateColumns:'auto 1fr auto 1fr' }}>
          {items.map(m => (
            <div key={m.key} style={{ display:'contents' }}>
              <div style={KEY}>{m.icon} {m.label}</div>
              <div style={{ ...VAL, padding:'4px 8px' }}>
                <button onClick={() => onPick(m.key)}
                  style={{ width:'100%', background:'#001840', border:`1px solid ${m.color}`, color:m.color,
                    padding:'5px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                  {m.action}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
