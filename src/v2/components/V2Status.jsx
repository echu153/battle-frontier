import { useState } from 'react'
import { STAT_DEFS, MAX_LV, ROLLS_PER_LV, calcPower, expToNext, expPerLv } from '../lib/stats.js'
import { classBonusText } from '../lib/classBonus.js'
import { TIER_COLOR } from '../lib/classes.js'
import { equippedItems, gearPower, totalStats } from '../lib/loadout.js'
import { RANK_COLOR } from './v2ui.js'

// ★見た目は旧版（無印）の街のステータスと同じ値にそろえてある。
//   枠 border:#0044aa／背景 #001040／padding:10px／marginBottom:8px、
//   名前13px・行11px・升目は9px/10px、EXPバーは高さ4px。画像に枠は付けない。
//   旧版と違うのは指示ぶんの2点だけ＝「ステは2列」「項目名も値と同じ色」。

// 旧版の MiniBar と同じ
function MiniBar({ label, val, pct, color }) {
  return (
    <>
      <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#446688', marginBottom:'1px' }}>
        <span>{label}</span><span style={{ color }}>{val}</span>
      </div>
      <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'4px' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,#001,${color})` }} />
      </div>
    </>
  )
}

// 旧版の StatMini と同じ升目（v2にステータスランクは無いので、そこだけ持たない）。
// 名前と値のあいだが空くので、そこに短い説明（STAT_DEFS.desc）を入れてある。
// カーソルを合わせる／タップすると詳しい説明（STAT_DEFS.detail）が下に出る。
function StatMini({ label, jp, val, add, color, short, detail }) {
  const [show, setShow] = useState(false)
  return (
    <div
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onClick={() => setShow(v => !v)}   // スマホはカーソルが無いのでタップでも出す
      style={{ position:'relative', background:'#000818', border:'1px solid #002244', padding:'3px 6px',
        display:'flex', alignItems:'center', gap:'6px', cursor:'help' }}>
      <span style={{ color, fontSize:'9px', flexShrink:0 }}>{label}</span>
      <span style={{ color:'#3d5a7a', fontSize:'9px', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {short}
      </span>
      <span style={{ flexShrink:0 }}>
        <span style={{ color, fontSize:'10px' }}>{val}</span>
        {add > 0 && <span style={{ color:'#44ff88', fontSize:'9px', marginLeft:'2px' }}>+{add.toLocaleString()}</span>}
      </span>
      {show && (
        <div style={{ position:'absolute', left:'-1px', top:'100%', marginTop:'2px', zIndex:120,
          width:'max(100%, 220px)', background:'#000c1c', border:`1px solid ${color}`, padding:'6px 8px',
          fontSize:'10px', lineHeight:'1.7', color:'#88aabb', textAlign:'left', pointerEvents:'none',
          boxShadow:'0 4px 12px rgba(0,0,0,0.7)' }}>
          <span style={{ color }}>{label}</span>
          <span style={{ color:'#446688' }}>（{jp}）</span>
          <div style={{ marginTop:'2px' }}>{detail}</div>
        </div>
      )}
    </div>
  )
}

export default function V2Status({ prof, inventory, classes, open, onToggle }) {
  const worn = equippedItems(prof, inventory)
  const total = totalStats(prof, inventory)
  const gear = gearPower(prof, inventory)
  const tierColor = TIER_COLOR[classes?.find(c => c.id === prof.class)?.tier] || '#88ccff'
  const next = expToNext(prof.lv, prof.job_changes)
  const expPct = Math.min(100, (prof.exp / expPerLv(prof.job_changes)) * 100)

  const statCell = (k) => {
    const d = STAT_DEFS[k]
    return (
      <StatMini key={k} label={d.label} jp={d.jp} short={d.desc} detail={d.detail} color={d.color}
        val={(total[k] || 0).toLocaleString()} add={(total[k] || 0) - (prof[k] || 0)} />
    )
  }

  const eq = (slot, label) => {
    const w = worn[slot]
    return (
      <div style={{ background:'#000818', border:'1px solid #002244', padding:'3px 6px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ color:'#446688', fontSize:'9px', flexShrink:0 }}>{label}</span>
        <span style={{ fontSize:'10px', textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
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
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'10px', marginBottom:'8px' }}>
      {/* 画像＋名前・職業・LV・転職回数・総合力・Gold（旧版と同じ。画像に枠は無い） */}
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        {prof.avatar_url && (
          <img src={prof.avatar_url} alt="avatar"
            style={{ width:'76px', height:'76px', objectFit:'cover', flexShrink:0 }}
            onError={e => { e.target.style.display = 'none' }} />
        )}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#ffcc00', fontSize:'13px' }}>{prof.username}</div>
          <div style={{ fontSize:'11px', color:'#6688aa' }}>
            <span style={{ color:tierColor }}>{prof.class}</span>{' '}
            <span style={{ color:'#ffcc00' }}>LV{prof.lv}</span>／{MAX_LV}
            {prof.lv >= MAX_LV && <span style={{ color:'#ff8844' }}> MAX</span>}
          </div>
          <div style={{ fontSize:'11px', color:'#6688aa' }}>
            転職回数: <span style={{ color:'#66ddff' }}>{prof.job_changes}</span>回
          </div>
          <div style={{ fontSize:'11px', color:'#6688aa' }}>
            総合力: <span style={{ color:'#44ff88' }}>{(calcPower(prof) + gear).toLocaleString()}</span>
            {gear > 0 && <span style={{ color:'#446688' }}>（装備 +{gear.toLocaleString()}）</span>}
          </div>
          <div style={{ fontSize:'11px', color:'#6688aa' }}>
            Gold: <span style={{ color:'#ffcc00' }}>{(prof.gold || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* EXPは閉じていても常に見せる（旧版と同じ） */}
      <MiniBar label="EXP" val={`${prof.exp}/${next || '—'}`} pct={expPct} color="#cc8800" />

      {open && (<>
        {/* 上の列はHP/MPだけ。枠は下のステータスと同じ幅にそろえる（旧版と同じ考え方） */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {['hp', 'mp'].map(statCell)}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {['str', 'dex', 'agi', 'int_stat', 'vit', 'luk'].map(statCell)}
        </div>

        {classBonusText(prof.class) && (
          <div style={{ background:'#000818', border:'1px solid #002244', padding:'3px 6px', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
            <span style={{ color:'#446688', fontSize:'9px' }}>職業補正</span>
            <span style={{ color:'#88ddaa', fontSize:'10px' }}>{classBonusText(prof.class)}</span>
          </div>
        )}

        <div style={{ color:'#446688', fontSize:'10px', marginBottom:'2px' }}>装備</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {eq('right', '武器（右手）')}{eq('head', '頭')}
          {eq('left', '武器（左手）')}{eq('body', '鎧')}
          {eq('arm', '腕')}{eq('foot', '足')}
          {eq('acc1', 'アクセ①')}{eq('acc2', 'アクセ②')}
        </div>

        <div style={{ color:'#446688', fontSize:'10px' }}>
          スキル編成{' '}
          <span style={{ color:'#556677' }}>
            {(prof.skill_set || []).length ? (prof.skill_set || []).map(e => e.name).join(' → ') : '未設定'}
          </span>
        </div>

        <div style={{ color:'#446688', fontSize:'10px', marginTop:'6px', lineHeight:'1.8' }}>
          LVアップごとに{ROLLS_PER_LV}回抽選し、当たったステータスが上がります（HPは+8・MPは+3・その他は+1）。
          どのステに当たっても戦闘力の上がり幅は同じです。
        </div>
      </>)}

      <button onClick={onToggle}
        style={{ width:'100%', padding:'4px', marginTop:'6px', background:'#000e1a', border:'1px solid #003366', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
        {open ? '▲ ステータスを閉じる' : '▼ ステータスを表示'}
      </button>
    </div>
  )
}

// 行動メニュー。旧版の街のボタン（padding:8px／fontSize:12px）と同じ大きさにそろえてある
export function V2Menu({ items, open, onToggle, onPick }) {
  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'10px', marginBottom:'8px' }}>
      {open && items.map(m => (
        <button key={m.key} onClick={() => onPick(m.key)}
          style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#001840', border:`1px solid ${m.color}`, color:m.color,
            cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>
          {m.icon} {m.label}
          <span style={{ color:'#446688', fontSize:'10px', marginLeft:'8px' }}>{m.action}</span>
        </button>
      ))}
      <button onClick={onToggle}
        style={{ width:'100%', padding:'4px', background:'#000e1a', border:'1px solid #003366', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>
        {open ? '▲ メニューを閉じる' : '▼ メニューを表示'}
      </button>
    </div>
  )
}
