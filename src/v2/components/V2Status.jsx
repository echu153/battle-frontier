
import { useEffect, useState } from 'react'
import { STAT_DEFS, MAX_LV, ROLLS_PER_LV, calcPower, expToNext, expPerLv } from '../lib/stats.js'
import { staminaMax, rollStamina, msToNextStamina, mmss } from '../lib/stamina.js'
import { classBonusText, jobCountOf } from '../lib/classBonus.js'
import { TIER_COLOR } from '../lib/classes.js'
import { KIND_COLOR, SKILL_BY_NAME, SKILL_SET_SLOTS, passiveOf } from '../lib/skills.js'
import { equippedItems, totalStats } from '../lib/loadout.js'
import { SLOT_LABEL } from '../lib/equipment.js'
import { RANK_COLOR } from './v2ui.js'
import V2ItemTip, { V2SkillTip, V2Tip } from './V2ItemTip.jsx'

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

// 旧版の StatMini と同じ升目（v2にステータスランクは無いので、そこだけ持たない）。
// 名前と値のあいだが空くので、そこに短い説明（STAT_DEFS.desc）を入れてある。
// カーソルを合わせる／タップすると詳しい説明（STAT_DEFS.detail）が下に出る。
// ★右の列は「右端をそろえて左へ伸ばす」。左端そろえだと枠の外へはみ出して読めなくなる。
// ★開閉のふるまいは V2Tip に一本化してある（装備・スキルの説明と同じ仕組み）。
//   別々に持っていると、スマホでステの説明を出したまま装備の説明も出せてしまい、
//   画面が説明だらけになる。
function StatMini({ label, jp, val, add, color, short, detail, alignRight }) {
  return (
    <V2Tip alignRight={alignRight} color={color} width="max(100%, 230px)"
      style={{ ...cell, justifyContent:'flex-start' }}
      body={<>
        <span style={{ color }}>{label}</span>
        <span style={{ color:'#7fa6d0' }}>（{jp}）</span>
        <div style={{ marginTop:'2px' }}>{detail}</div>
      </>}>
      <span style={{ color, fontSize:'9px', flexShrink:0 }}>{label}</span>
      <span style={{ color:'#82a2c2', fontSize:'9px', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {short}
      </span>
      <span style={{ flexShrink:0 }}>
        <span style={{ color, fontSize:'10px' }}>{val}</span>
        {add > 0 && <span style={{ color:'#44ff88', fontSize:'9px', marginLeft:'2px' }}>+{add.toLocaleString()}</span>}
      </span>
    </V2Tip>
  )
}

export default function V2Status({ prof, inventory, runes, fishDex, classes, open, onToggle }) {
  const worn = equippedItems(prof, inventory)
  // ★エンチャントは**割合**なので装備の固定値とは別枠。totalStats に渡すと合計へ乗る
  const total = totalStats(prof, inventory, runes, fishDex)
  const power = calcPower(total)
  const tierColor = TIER_COLOR[classes?.find(c => c.id === prof.class)?.tier] || '#88ccff'
  const next = expToNext(prof.lv, prof.job_changes)
  const expPct = Math.min(100, (prof.exp / expPerLv(prof.job_changes)) * 100)
  // ★スタミナ（オート出撃の燃料）はここに出す。出撃の画面は戦闘中に隠れてしまうため。
  //   時間で戻る（5分に1）ので1秒ごとに数え直す。**増え方（転職回数）は出さない**（マスク）
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const stamMax = staminaMax(prof.job_changes)
  const stamNow = rollStamina(prof.stamina, prof.stamina_at, stamMax, now).n
  const stamNext = msToNextStamina(prof.stamina, prof.stamina_at, stamMax, now)
  // map の (値, 添字) をそのまま受ける。添字が奇数＝右の列（そちらは右端をそろえて左へ伸ばす）
  const statCell = (k, i) => {
    const d = STAT_DEFS[k]
    return (
      <StatMini key={k} label={d.label} jp={d.jp} short={d.desc} detail={d.detail} color={d.color}
        val={(total[k] || 0).toLocaleString()} add={(total[k] || 0) - (prof[k] || 0)}
        alignRight={i % 2 === 1} />
    )
  }

  // ★装備の升目はカーソルを合わせる（スマホはタップ）と、能力値と刻印が出る。
  //   右の列は右端をそろえて左へ伸ばす（左端そろえだと枠からはみ出す）
  const eq = (slot, label, i = 0) => {
    const w = worn[slot]
    const rn = w ? (runes || []).filter(e => String(e.inv_id) === String(w.inv.id)) : []
    return (
      <div style={cell}>
        <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>{label}</span>
        {/* ⚠切り詰め（overflow:hidden）は**内側**に置く。外側に置くと出した説明まで切れる */}
        {w ? (
          <V2ItemTip item={w.item} inv={w.inv} runes={rn} alignRight={i % 2 === 1}
            style={{ display:'block', flex:1, minWidth:0 }}>
            {/* ★ここはランクと名前だけ。刻印は幅が足りず切れるので、
                カーソルを合わせたとき（V2ItemTip の中）に出す */}
            <span style={{ ...valueCell, display:'block' }}>
              <span style={{ color: RANK_COLOR[w.item.rank] }}>[{w.item.rank}]</span>{' '}
              <span style={{ color:'#88ccff' }}>{w.item.name}</span>
              {w.inv.plus ? <span style={{ color:'#ffcc00' }}>+{w.inv.plus}</span> : ''}
            </span>
          </V2ItemTip>
        ) : <span style={{ ...valueCell, color:'#62789a' }}>—</span>}
      </div>
    )
  }

  // ★2026-08-23：職業パッシブは**枠を使わない**（その職業なら最初から効いている）。
  //   スキル編成に出てこないので、ここに出さないと持っていることに気づけない
  const passive = passiveOf(prof.class)

  // スキル編成。1行にまとめると読めないので、装備と同じ升目にして種別の色を付ける。
  // ★装備と同じで、カーソルを合わせる（スマホはタップ）と効果が出る
  const skillCell = (i) => {
    const e = (prof.skill_set || [])[i]
    const s = e && SKILL_BY_NAME[e.name]
    return (
      <div key={i} style={cell}>
        <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>スキル{i + 1}</span>
        {s ? (
          <V2SkillTip skill={s} uses={e.uses || 1} alignRight={i % 2 === 1}
            style={{ display:'block', flex:1, minWidth:0 }}>
            <span style={{ ...valueCell, display:'block' }}>
              <span style={{ color: KIND_COLOR[s.kind] }}>{s.name}</span>
              <span style={{ color:'#7fa6d0' }}>×{e.uses || 1}</span>
            </span>
          </V2SkillTip>
        ) : <span style={{ ...valueCell, color:'#62789a' }}>—</span>}
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
            <V2Tip color="#ffcc00" width="240px"
              style={{ borderBottom:'1px dotted #ffcc00' }}
              body={`LVアップごとに${ROLLS_PER_LV}回抽選し、当たったステータスが上がります（HPは+8・MPは+3・その他は+1）。どのステに当たっても戦闘力の上がり幅は同じです。`}>
              <span style={{ color:'#ffcc00' }}>LV{prof.lv}</span>／{MAX_LV}
            </V2Tip>
            {prof.lv >= MAX_LV && <span style={{ color:'#ff8844' }}> MAX</span>}
          </div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            転職回数: <span style={{ color:'#66ddff' }}>{prof.job_changes}</span>回
          </div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            総合力: <span style={{ color:'#44ff88' }}>{power.toLocaleString()}</span>
          </div>
          {/* ★スタミナ（オート出撃の燃料）はGoldの右へ並べる。
              入りきらない幅では下へ折り返す。**増え方は書かない**（マスク・stamina.js） */}
          <div style={{ fontSize:'11px', color:'#9ec2e6', display:'flex', flexWrap:'wrap', gap:'2px 14px' }}>
            <span>Gold: <span style={{ color:'#ffcc00' }}>{(prof.gold || 0).toLocaleString()}</span></span>
            <span>
              ⚡スタミナ: <span style={{ color: stamNow > 0 ? '#ffdd44' : '#ff8844' }}>{stamNow}</span>
              <span style={{ color:'#7fa6d0' }}>／{stamMax}</span>
              {stamNext > 0 && (
                <span style={{ color:'#4d6f92', fontSize:'10px' }}>{'　'}次まで {mmss(stamNext)}</span>
              )}
            </span>
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

        {classBonusText(prof.class, jobCountOf(prof)) && (
          <div style={{ ...cell, marginBottom:'6px' }}>
            <span style={{ color:'#7fa6d0', fontSize:'9px' }}>職業補正</span>
            <span style={{ color:'#88ddaa', fontSize:'10px' }}>{classBonusText(prof.class, jobCountOf(prof))}</span>
          </div>
        )}

        {/* ★2026-08-23：パッシブは枠を使わない＝スキル編成に出てこない。
            「持っていることに気づけない」ので、職業補正のとなりに常時の効果として出す */}
        {passive && (
          <div style={{ ...cell, marginBottom:'6px' }}>
            <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>職業パッシブ</span>
            <V2SkillTip skill={passive} alignRight style={{ display:'block', flex:1, minWidth:0 }}>
              <span style={{ ...valueCell, display:'block' }}>
                <span style={{ color: KIND_COLOR.passive }}>{passive.name}</span>
                <span style={{ color:'#7fa6d0' }}> 常時</span>
              </span>
            </V2SkillTip>
          </div>
        )}

        <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'2px' }}>装備</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {/* ★名前は equipment.js の SLOT_LABEL が正。ここでベタ書きしない */}
          {eq('right', SLOT_LABEL.right, 0)}{eq('head', SLOT_LABEL.head, 1)}
          {eq('left', SLOT_LABEL.left, 0)}{eq('body', SLOT_LABEL.body, 1)}
          {eq('arm', SLOT_LABEL.arm, 0)}{eq('foot', SLOT_LABEL.foot, 1)}
          {eq('acc1', SLOT_LABEL.acc1, 0)}{eq('acc2', SLOT_LABEL.acc2, 1)}
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
