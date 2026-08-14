import { STAT_DEFS, MAX_LV, ROLLS_PER_LV, calcPower, expToNext, expPerLv } from '../lib/stats.js'
import { classBonusText } from '../lib/classBonus.js'
import { TIER_COLOR } from '../lib/classes.js'
import { equippedItems, gearPower, totalStats } from '../lib/loadout.js'
import { RANK_COLOR } from './v2ui.js'

// ★見え方は旧版（無印）の街のステータスに合わせてある。
//   名前／職業／LV → 総合力・Gold → EXPバー（オレンジ）→ ステータスの升目 →
//   「▲ ステータスを閉じる」で折りたためる。
const box = { border:'1px solid #0044aa', background:'#001040', fontFamily:'monospace' }
const cell = { background:'#000818', border:'1px solid #002244', padding:'7px 9px', display:'flex', alignItems:'baseline', justifyContent:'space-between' }
const foldBtn = {
  width:'100%', padding:'8px', background:'#000818', border:'1px solid #223a5e',
  color:'#7f95c4', cursor:'pointer', fontFamily:'monospace', fontSize:'11px',
}

export default function V2Status({ prof, inventory, classes, open, onToggle }) {
  const worn = equippedItems(prof, inventory)
  const total = totalStats(prof, inventory)
  const gear = gearPower(prof, inventory)
  const tierColor = TIER_COLOR[classes?.find(c => c.id === prof.class)?.tier] || '#88aaff'

  // ステータス1枠。旧版と同じで「名前（左・グレー）｜値（右・ステの色）」
  const statCell = (k) => {
    const d = STAT_DEFS[k]
    const add = (total[k] || 0) - (prof[k] || 0)
    return (
      <div key={k} title={d.desc} style={{ ...cell, padding:'6px 8px' }}>
        <span style={{ color:'#7f95c4', fontSize:'11px' }}>{d.label}</span>
        <span style={{ color:d.color, fontSize:'13px' }}>
          {(total[k] || 0).toLocaleString()}
          {add > 0 && <span style={{ color:'#44ff88', fontSize:'9px' }}> +{add.toLocaleString()}</span>}
        </span>
      </div>
    )
  }

  const eq = (slot, label) => {
    const w = worn[slot]
    return (
      <div style={{ ...cell, padding:'5px 8px' }}>
        <span style={{ color:'#446688', fontSize:'10px' }}>{label}</span>
        <span style={{ fontSize:'11px', textAlign:'right' }}>
          {w ? (<>
            <span style={{ color: RANK_COLOR[w.item.rank] }}>[{w.item.rank}]</span>{' '}
            <span style={{ color:'#88ccff' }}>{w.item.name}</span>
            {w.inv.plus ? <span style={{ color:'#ffcc00' }}>+{w.inv.plus}</span> : ''}
          </>) : <span style={{ color:'#334455' }}>—</span>}
        </span>
      </div>
    )
  }

  return (
    <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
      {/* 名前・職業・LV・総合力・Gold（旧版と同じで、枠を使わず行で積む） */}
      <div style={{ marginBottom:'12px', lineHeight:'1.7' }}>
        <div style={{ color:'#ffffff', fontSize:'15px' }}>{prof.username}</div>
        <div>
          <span style={{ color:tierColor, fontSize:'12px' }}>{prof.class}</span>
          <span style={{ color:'#cfe2ff', fontSize:'12px', marginLeft:'8px' }}>
            LV{prof.lv}／{MAX_LV}
          </span>
          {prof.lv >= MAX_LV && <span style={{ color:'#ff8844', fontSize:'10px', marginLeft:'4px' }}>MAX</span>}
        </div>
        <div style={{ color:'#7f95c4', fontSize:'12px' }}>
          転職回数: <span style={{ color:'#66ddff' }}>{prof.job_changes}回</span>
        </div>
        <div style={{ color:'#7f95c4', fontSize:'12px' }}>
          総合力: <span style={{ color:'#ffcc00' }}>{(calcPower(prof) + gear).toLocaleString()}</span>
          {gear > 0 && <span style={{ color:'#44ff88', fontSize:'10px' }}>（装備 +{gear.toLocaleString()}）</span>}
        </div>
        <div style={{ color:'#7f95c4', fontSize:'12px' }}>
          Gold: <span style={{ color:'#ffcc00' }}>{(prof.gold || 0).toLocaleString()}</span>
        </div>
      </div>

      {/* EXPバー（旧版と同じオレンジ） */}
      <div style={{ display:'flex', justifyContent:'space-between', color:'#446688', fontSize:'10px', marginBottom:'3px' }}>
        <span>EXP</span>
        <span style={{ color:'#ffcc00' }}>{prof.exp} / {expToNext(prof.lv, prof.job_changes) || '—'}</span>
      </div>
      <div style={{ height:'6px', background:'#001028', border:'1px solid #002244', marginBottom:'12px' }}>
        <div style={{ height:'100%', width:`${Math.min(100, (prof.exp / expPerLv(prof.job_changes)) * 100)}%`, background:'linear-gradient(90deg,#ff8800,#ffcc00)' }} />
      </div>

      {open && (
        <>
          {/* ステータス。旧版と同じで HP/MP は2列・残りは3列に並べる */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'4px', marginBottom:'4px' }}>
            {['hp', 'mp'].map(statCell)}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'4px' }}>
            {['str', 'dex', 'agi', 'int_stat', 'vit', 'luk'].map(statCell)}
          </div>

          {/* 職業補正 */}
          {classBonusText(prof.class) && (
            <div style={{ ...cell, marginTop:'6px' }}>
              <span style={{ color:'#446688', fontSize:'10px' }}>職業補正</span>
              <span style={{ color:'#88ddaa', fontSize:'11px' }}>{classBonusText(prof.class)}</span>
            </div>
          )}

          {/* 装備 */}
          <div style={{ color:'#446688', fontSize:'10px', margin:'10px 0 4px' }}>装備</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'4px' }}>
            {eq('right', '武器（右手）')}{eq('head', '頭')}
            {eq('left', '武器（左手）')}{eq('body', '鎧')}
            {eq('arm', '腕')}{eq('foot', '足')}
            {eq('acc1', 'アクセ①')}{eq('acc2', 'アクセ②')}
          </div>

          {/* スキル編成 */}
          <div style={{ color:'#446688', fontSize:'10px', margin:'10px 0 0' }}>
            スキル編成{' '}
            <span style={{ color:'#556677' }}>
              {(prof.skill_set || []).length ? (prof.skill_set || []).map(e => e.name).join(' → ') : '未設定'}
            </span>
          </div>

          <div style={{ color:'#446688', fontSize:'10px', marginTop:'10px', lineHeight:'1.8' }}>
            LVアップごとに{ROLLS_PER_LV}回抽選し、当たったステータスが上がります（HPは+8・MPは+3・その他は+1）。
            どのステに当たっても戦闘力の上がり幅は同じです。
          </div>
        </>
      )}

      <button onClick={onToggle} style={{ ...foldBtn, marginTop:'10px' }}>
        {open ? '▲ ステータスを閉じる' : '▼ ステータスを開く'}
      </button>
    </div>
  )
}

// 行動メニュー。旧版の街のボタン並びと同じ見た目で、こちらも折りたためる
export function V2Menu({ items, open, onToggle, onPick }) {
  return (
    <div style={{ ...box, padding:'12px', marginBottom:'12px' }}>
      {open && items.map(m => (
        <button key={m.key} onClick={() => onPick(m.key)}
          style={{ width:'100%', padding:'12px', background:'#001840', border:`1px solid ${m.color}`, color:m.color,
            cursor:'pointer', fontFamily:'monospace', fontSize:'13px', marginBottom:'8px' }}>
          {m.icon} {m.label}
          <span style={{ color:'#446688', fontSize:'10px', marginLeft:'8px' }}>{m.action}</span>
        </button>
      ))}
      <button onClick={onToggle} style={foldBtn}>
        {open ? '▲ メニューを閉じる' : '▼ メニューを開く'}
      </button>
    </div>
  )
}
