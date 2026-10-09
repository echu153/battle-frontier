import { useEffect, useState } from 'react'
import { STAT_DEFS, STAT_KEYS, calcPower } from '../../v2/lib/stats.js'
import { rollStamina, msToNextStamina, mmss } from '../../v2/lib/stamina.js'
import { KIND_COLOR, SKILL_SET_SLOTS } from '../../v2/lib/skills.js'
import { V2Tip } from '../../v2/components/V2ItemTip.jsx'
import { RANK_COLOR } from '../../v2/components/v2ui.js'
import { MAX_LV, needExp, staminaMaxOf } from '../lib/level.js'
import { JOB_MAX, jobNeed, jobOf, stageOf, stageLabelOf, stageColorOf, weaponsOf } from '../lib/jobs.js'
import { SKILL_BY_NAME } from '../lib/skills.js'
import { SLOTS, SLOT_LABEL, kindLabel } from '../lib/equipment.js'
import { equippedItems, statBreakdown } from '../lib/loadout.js'
import { effectPct, powerAt } from '../lib/gear.js'

// ============================================================
// 「レベルキャップあり」版 — ステータス欄（ホームの左）
//   見た目は今のⅡ（V2Status.jsx）にそろえる。違うのは
//   ・LVとJBLVの2本のバー（LV100・JBLV30で止まる）
//   ・ステの内訳（本体＋ジョブ＋装備＋軽装のAGI）をカーソルで出す
//   ・装備は7枠（武器1・頭・鎧・腕・足・アクセ2）。アイテムLVと、必要LVに足りないときの効果%
//   ・防具のメリット（重鎧＝受けるダメージ−%／軽装＝AGI+%）の合計
// ============================================================
const cell = {
  background:'#000818', border:'1px solid #002244', padding:'3px 6px',
  display:'flex', alignItems:'center', justifyContent:'space-between', gap:'6px',
}
const valueCell = { fontSize:'10px', textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }

function Bar({ label, val, pct, color }) {
  return (
    <>
      <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#7fa6d0', marginBottom:'1px' }}>
        <span>{label}</span><span style={{ color }}>{val}</span>
      </div>
      <div style={{ background:'#001028', height:'4px', border:'1px solid #002244', marginBottom:'4px' }}>
        <div style={{ height:'100%', width:`${Math.max(0, Math.min(100, pct))}%`, background:`linear-gradient(90deg,#001,${color})` }} />
      </div>
    </>
  )
}

export default function V2capStatus({ prof, inventory }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const bd = statBreakdown(prof, inventory)
  const worn = equippedItems(prof, inventory)
  const job = jobOf(prof.jobs, prof.class)
  const stage = stageOf(prof.class)
  const lvNeed = needExp(prof.lv)
  const jNeed = jobNeed(stage, job.lv)
  const stamMax = staminaMaxOf(prof.lv)
  const stamNow = rollStamina(prof.stamina, prof.stamina_at, stamMax, now).n
  const stamNext = msToNextStamina(prof.stamina, prof.stamina_at, stamMax, now)

  const statCell = (k, i) => {
    const d = STAT_DEFS[k]
    const extra = k === 'agi' ? bd.armorAgi : 0
    const add = bd.job[k] + bd.gear[k] + extra
    return (
      <V2Tip key={k} alignRight={i % 2 === 1} color={d.color} width="max(100%, 220px)"
        style={{ ...cell, justifyContent:'flex-start' }}
        body={<>
          <span style={{ color: d.color }}>{d.label}</span>
          <span style={{ color:'#7fa6d0' }}>（{d.jp}）</span>
          <div style={{ marginTop:'2px' }}>{d.detail}</div>
          <div style={{ marginTop:'4px', color:'#cfe2ff' }}>
            本体 {bd.body[k]}
            {bd.job[k] > 0 && <> ＋ ジョブ <span style={{ color:'#ffcc00' }}>{bd.job[k]}</span></>}
            {bd.gear[k] > 0 && <> ＋ 装備 <span style={{ color:'#44ff88' }}>{bd.gear[k]}</span></>}
            {extra > 0 && <> ＋ 軽装 <span style={{ color:'#88ddaa' }}>{extra}</span></>}
          </div>
        </>}>
        <span style={{ color: d.color, fontSize:'9px', flexShrink:0 }}>{d.label}</span>
        <span style={{ color:'#82a2c2', fontSize:'9px', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.desc}</span>
        <span style={{ flexShrink:0 }}>
          <span style={{ color: d.color, fontSize:'10px' }}>{bd.total[k].toLocaleString()}</span>
          {add > 0 && <span style={{ color:'#44ff88', fontSize:'9px', marginLeft:'2px' }}>+{add.toLocaleString()}</span>}
        </span>
      </V2Tip>
    )
  }

  const eqCell = (slot, i) => {
    const w = worn[slot]
    const pct = w ? effectPct(w.inv.ilv, prof.lv) : 100
    return (
      <div key={slot} style={cell}>
        <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>{SLOT_LABEL[slot]}</span>
        {w ? (
          <V2Tip alignRight={i % 2 === 1} width="230px" style={{ display:'block', flex:1, minWidth:0 }}
            body={<>
              <div><span style={{ color: RANK_COLOR[w.inv.rank] }}>[{w.inv.rank}]</span> {w.item.name}（{kindLabel(w.item)}）</div>
              <div>アイテムLV {w.inv.ilv}（必要LV {w.inv.ilv}）</div>
              <div>戦闘力 {powerAt(w.item, w.inv.rank, w.inv.ilv)}{pct < 100 && <span style={{ color:'#ff8844' }}> → {Math.round(powerAt(w.item, w.inv.rank, w.inv.ilv) * pct / 100)}（効果{pct}%）</span>}</div>
            </>}>
            <span style={{ ...valueCell, display:'block' }}>
              <span style={{ color: RANK_COLOR[w.inv.rank] }}>[{w.inv.rank}]</span>{' '}
              <span style={{ color:'#88ccff' }}>{w.item.name}</span>
              <span style={{ color:'#93a9be' }}> LV{w.inv.ilv}</span>
              {pct < 100 && <span style={{ color:'#ff8844' }}> {pct}%</span>}
            </span>
          </V2Tip>
        ) : <span style={{ ...valueCell, color:'#62789a' }}>—</span>}
      </div>
    )
  }

  const skillCell = (i) => {
    const e = (prof.skill_set || [])[i]
    const s = e && SKILL_BY_NAME[e.name]
    return (
      <div key={i} style={cell}>
        <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>スキル{i + 1}</span>
        {s ? (
          <span style={{ ...valueCell }}>
            <span style={{ color: KIND_COLOR[s.kind] }}>{s.name}</span>
            <span style={{ color:'#7fa6d0' }}>×{e.uses || 1}</span>
          </span>
        ) : <span style={{ ...valueCell, color:'#62789a' }}>—</span>}
      </div>
    )
  }

  const armorParts = []
  if (bd.armor.takenPct) armorParts.push(`受けるダメージ${bd.armor.takenPct}%`)
  if (bd.armor.agiPct) armorParts.push(`AGI+${bd.armor.agiPct}%`)

  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'10px', marginBottom:'8px', fontFamily:'monospace' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'4px' }}>
        <span style={{ color:'#cfe2ff', fontSize:'13px' }}>{prof.username}</span>
        <span style={{ fontSize:'11px' }}>
          <span style={{ color: stageColorOf(prof.class), fontSize:'9px', marginRight:'4px' }}>[{stageLabelOf(prof.class)}]</span>
          <span style={{ color: stageColorOf(prof.class) }}>{prof.class}</span>
        </span>
      </div>
      <div style={{ color:'#ffcc00', fontSize:'11px', marginBottom:'6px' }}>
        戦闘力 {bd.power.toLocaleString()}
        <span style={{ color:'#7fa6d0', fontSize:'9px', marginLeft:'6px' }}>
          （本体{calcPower(bd.body)}・ジョブ{calcPower(bd.job)}・装備{calcPower(bd.gear)}）
        </span>
      </div>

      <Bar label={`LV ${prof.lv}${prof.lv >= MAX_LV ? '（上限）' : ''}`}
        val={prof.lv >= MAX_LV ? 'MAX' : `${prof.exp.toLocaleString()} / ${lvNeed.toLocaleString()}`}
        pct={prof.lv >= MAX_LV ? 100 : (prof.exp / lvNeed) * 100} color="#44ff88" />
      <Bar label={`JBLV ${job.lv}${job.lv >= JOB_MAX ? '（上限）' : ''}`}
        val={job.lv >= JOB_MAX ? 'MAX' : `${job.exp.toLocaleString()} / ${jNeed.toLocaleString()}`}
        pct={job.lv >= JOB_MAX ? 100 : (job.exp / jNeed) * 100} color="#ffcc00" />
      <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#7fa6d0', marginBottom:'6px' }}>
        <span>⚡ スタミナ</span>
        <span style={{ color: stamNow > 0 ? '#44ff88' : '#ff8844' }}>
          {stamNow} / {stamMax}
          {stamNow < stamMax && <span style={{ color:'#7fa6d0' }}>（次まで {mmss(stamNext)}）</span>}
        </span>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
        {STAT_KEYS.map(statCell)}
      </div>

      <div style={{ color:'#7fa6d0', fontSize:'9px', margin:'6px 0 2px', display:'flex', justifyContent:'space-between', gap:'6px' }}>
        <span>装備（{prof.class}の武器：{weaponsOf(prof.class).join('・')}）</span>
        {armorParts.length > 0 && <span style={{ color:'#88ddaa' }}>{armorParts.join('・')}</span>}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
        {SLOTS.map(eqCell)}
      </div>

      <div style={{ color:'#7fa6d0', fontSize:'9px', margin:'6px 0 2px' }}>スキルセット</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px' }}>
        {Array.from({ length: SKILL_SET_SLOTS }, (_, i) => skillCell(i))}
      </div>
    </div>
  )
}
