import { useEffect, useState } from 'react'
import { STAT_DEFS, MAX_LV, ROLLS_PER_LV, calcPower, expToNext, expPerLv } from '../lib/stats.js'
import { classBonusText } from '../lib/classBonus.js'
import { TIER_COLOR } from '../lib/classes.js'
import { KIND_COLOR, SKILL_BY_NAME, SKILL_SET_SLOTS } from '../lib/skills.js'
import { equippedItems, totalStats } from '../lib/loadout.js'
import { RANK_COLOR } from './v2ui.js'

// ★見た目は旧版（無印）の街のステータスと同じ値にそろえてある。
//   枠 border:#0044aa／背景 #001040／padding:10px／marginBottom:8px、
//   名前13px・行11px・升目は9px/10px、EXPバーは高さ4px。画像に枠は付けない。
//   旧版と違うのは指示ぶんだけ＝「ステは2列」「項目名も値と同じ色」「折りたたみボタンは上」。

const cell = {
  background:'#000818', border:'1px solid #002244', padding:'3px 6px',
  display:'flex', alignItems:'center', justifyContent:'space-between', gap:'6px',
}
const foldBtn = {
  width:'100%', padding:'4px', background:'#000e1a', border:'1px solid #003366',
  color:'#7fa6d0', cursor:'pointer', fontFamily:'monospace', fontSize:'10px',
}
// 升目の右側（値や装備名）。長いときは切って、枠を広げない
const valueCell = { fontSize:'10px', textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }
// カーソルを合わせたとき／タップしたときに出す説明の枠
const tipBox = (color) => ({
  position:'absolute', top:'100%', marginTop:'2px', zIndex:120,
  background:'#000c1c', border:`1px solid ${color}`, padding:'6px 8px',
  fontSize:'10px', lineHeight:'1.7', color:'#a8c4d6', textAlign:'left',
  pointerEvents:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.7)', whiteSpace:'normal',
})

// 旧版の MiniBar と同じ
function MiniBar({ label, val, pct, color }) {
  return (
    <>
      <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#7fa6d0', marginBottom:'1px' }}>
        <span>{label}</span><span style={{ color }}>{val}</span>
      </div>
      <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'4px' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,#001,${color})` }} />
      </div>
    </>
  )
}

// 文章に添える小さな説明。画面に書くと邪魔なものはこちらへ逃がす
function Tip({ children, text, color, show, onShow, onHide, onToggle }) {
  return (
    <span
      onMouseEnter={onShow} onMouseLeave={onHide}
      onClick={e => { e.stopPropagation(); onToggle() }}
      style={{ position:'relative', cursor:'help', borderBottom:`1px dotted ${color}` }}>
      {children}
      {show && <span style={{ ...tipBox(color), left:0, display:'block', width:'240px', maxWidth:'80vw' }}>{text}</span>}
    </span>
  )
}

// 旧版の StatMini と同じ升目（v2にステータスランクは無いので、そこだけ持たない）。
// 名前と値のあいだが空くので、そこに短い説明（STAT_DEFS.desc）を入れてある。
// カーソルを合わせる／タップすると詳しい説明（STAT_DEFS.detail）が下に出る。
// ★右の列は「右端をそろえて左へ伸ばす」。左端そろえだと枠の外へはみ出して読めなくなる。
// ★開いているかどうかは親が1つだけ持つ＝同時に2つ出ない（スマホでタップして回ったとき用）。
function StatMini({ label, jp, val, add, color, short, detail, show, alignRight, onShow, onHide, onToggle }) {
  return (
    <div
      onMouseEnter={onShow} onMouseLeave={onHide}
      onClick={e => { e.stopPropagation(); onToggle() }}  // スマホはカーソルが無いのでタップで出す
      style={{ ...cell, position:'relative', justifyContent:'flex-start', cursor:'help' }}>
      <span style={{ color, fontSize:'9px', flexShrink:0 }}>{label}</span>
      <span style={{ color:'#82a2c2', fontSize:'9px', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {short}
      </span>
      <span style={{ flexShrink:0 }}>
        <span style={{ color, fontSize:'10px' }}>{val}</span>
        {add > 0 && <span style={{ color:'#44ff88', fontSize:'9px', marginLeft:'2px' }}>+{add.toLocaleString()}</span>}
      </span>
      {show && (
        <div style={{ ...tipBox(color), [alignRight ? 'right' : 'left']: '-1px', width:'max(100%, 230px)', maxWidth:'80vw' }}>
          <span style={{ color }}>{label}</span>
          <span style={{ color:'#7fa6d0' }}>（{jp}）</span>
          <div style={{ marginTop:'2px' }}>{detail}</div>
        </div>
      )}
    </div>
  )
}

export default function V2Status({ prof, inventory, essences, classes, open, onToggle }) {
  const worn = equippedItems(prof, inventory)
  // ★エンチャントは**割合**なので装備の固定値とは別枠。totalStats に渡すと合計へ乗る
  const total = totalStats(prof, inventory, essences)
  const power = calcPower(total)
  const tierColor = TIER_COLOR[classes?.find(c => c.id === prof.class)?.tier] || '#88ccff'
  const next = expToNext(prof.lv, prof.job_changes)
  const expPct = Math.min(100, (prof.exp / expPerLv(prof.job_changes)) * 100)
  const [openTip, setOpenTip] = useState('')  // 説明を出している場所（同時に1つだけ）

  // スマホはタップで出すので、どこか別の場所をタップしたら閉じる
  // （升目側は stopPropagation しているので、升目のタップでは閉じない）
  useEffect(() => {
    if (!openTip) return
    const close = () => setOpenTip('')
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openTip])

  const tipProps = (key) => ({
    show: openTip === key,
    onShow: () => setOpenTip(key),
    onHide: () => setOpenTip(s => (s === key ? '' : s)),
    onToggle: () => setOpenTip(s => (s === key ? '' : key)),
  })

  // map の (値, 添字) をそのまま受ける。添字が奇数＝右の列（そちらは右端をそろえて左へ伸ばす）
  const statCell = (k, i) => {
    const d = STAT_DEFS[k]
    return (
      <StatMini key={k} label={d.label} jp={d.jp} short={d.desc} detail={d.detail} color={d.color}
        val={(total[k] || 0).toLocaleString()} add={(total[k] || 0) - (prof[k] || 0)}
        alignRight={i % 2 === 1} {...tipProps(k)} />
    )
  }

  const eq = (slot, label) => {
    const w = worn[slot]
    return (
      <div style={cell}>
        <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>{label}</span>
        <span style={valueCell}>
          {w ? (<>
            <span style={{ color: RANK_COLOR[w.item.rank] }}>[{w.item.rank}]</span>{' '}
            <span style={{ color:'#88ccff' }}>{w.item.name}</span>
            {w.inv.plus ? <span style={{ color:'#ffcc00' }}>+{w.inv.plus}</span> : ''}
          </>) : <span style={{ color:'#62789a' }}>—</span>}
        </span>
      </div>
    )
  }

  // スキル編成。1行にまとめると読めないので、装備と同じ升目にして種別の色を付ける
  const skillCell = (i) => {
    const e = (prof.skill_set || [])[i]
    const s = e && SKILL_BY_NAME[e.name]
    return (
      <div key={i} style={cell}>
        <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>スキル{i + 1}</span>
        <span style={valueCell}>
          {s ? (<>
            <span style={{ color: KIND_COLOR[s.kind] }}>{s.name}</span>
            <span style={{ color:'#7fa6d0' }}>×{e.uses || 1}</span>
          </>) : <span style={{ color:'#62789a' }}>—</span>}
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
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            <span style={{ color:tierColor }}>{prof.class}</span>{' '}
            {/* 上がり方の説明は画面に書くと長いので、LVに合わせたときだけ出す */}
            <Tip text={`LVアップごとに${ROLLS_PER_LV}回抽選し、当たったステータスが上がります（HPは+8・MPは+3・その他は+1）。どのステに当たっても戦闘力の上がり幅は同じです。`}
              color="#ffcc00" {...tipProps('lv')}>
              <span style={{ color:'#ffcc00' }}>LV{prof.lv}</span>／{MAX_LV}
            </Tip>
            {prof.lv >= MAX_LV && <span style={{ color:'#ff8844' }}> MAX</span>}
          </div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            転職回数: <span style={{ color:'#66ddff' }}>{prof.job_changes}</span>回
          </div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            総合力: <span style={{ color:'#44ff88' }}>{power.toLocaleString()}</span>
          </div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            Gold: <span style={{ color:'#ffcc00' }}>{(prof.gold || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* EXPは閉じていても常に見せる（旧版と同じ） */}
      <MiniBar label="EXP" val={`${prof.exp}/${next || '—'}`} pct={expPct} color="#cc8800" />

      {/* ★折りたたみは上に置く。中身が長いので、下に置くと閉じるたびに端まで送られる */}
      <button onClick={onToggle} style={{ ...foldBtn, marginTop:'4px', marginBottom: open ? '6px' : 0 }}>
        {open ? '▲ ステータスを閉じる' : '▼ ステータスを表示'}
      </button>

      {open && (<>
        {/* 上の列はHP/MPだけ。枠は下のステータスと同じ幅にそろえる（旧版と同じ考え方） */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {['hp', 'mp'].map(statCell)}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {['str', 'dex', 'agi', 'int_stat', 'vit', 'luk'].map(statCell)}
        </div>

        {classBonusText(prof.class) && (
          <div style={{ ...cell, marginBottom:'6px' }}>
            <span style={{ color:'#7fa6d0', fontSize:'9px' }}>職業補正</span>
            <span style={{ color:'#88ddaa', fontSize:'10px' }}>{classBonusText(prof.class)}</span>
          </div>
        )}

        <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'2px' }}>装備</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {eq('right', '武器（右手）')}{eq('head', '頭')}
          {eq('left', '武器（左手）')}{eq('body', '鎧')}
          {eq('arm', '腕')}{eq('foot', '足')}
          {eq('acc1', 'アクセ①')}{eq('acc2', 'アクセ②')}
        </div>

        <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'2px' }}>スキル編成</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px' }}>
          {Array.from({ length: SKILL_SET_SLOTS }, (_, i) => skillCell(i))}
        </div>
      </>)}
    </div>
  )
}

// 行動メニュー。旧版の街のボタン（padding:8px／fontSize:12px）と同じ大きさにそろえてある
export function V2Menu({ items, open, onToggle, onPick }) {
  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'10px', marginBottom:'8px' }}>
      {/* ★こちらも折りたたみは上（ステータスとそろえる） */}
      <button onClick={onToggle} style={{ ...foldBtn, marginBottom: open ? '8px' : 0 }}>
        {open ? '▲ メニューを閉じる' : '▼ メニューを表示'}
      </button>
      {open && items.map(m => (
        <button key={m.key} onClick={() => onPick(m.key)}
          style={{ width:'100%', padding:'8px', marginBottom:'8px', background:'#001840', border:`1px solid ${m.color}`, color:m.color,
            cursor:'pointer', fontFamily:'monospace', fontSize:'12px', textAlign:'left' }}>
          {m.icon} {m.label}
          <span style={{ color:'#7fa6d0', fontSize:'10px', marginLeft:'8px' }}>{m.action}</span>
        </button>
      ))}
    </div>
  )
}
