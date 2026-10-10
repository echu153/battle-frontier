import { useEffect, useState } from 'react'
import { STAT_DEFS, calcPower } from '../../v2/lib/stats.js'
import { mmss } from '../../v2/lib/stamina.js'
import { KIND_COLOR, SKILL_SET_SLOTS } from '../../v2/lib/skills.js'
import { V2Tip, V2SkillTip } from '../../v2/components/V2ItemTip.jsx'
import { MAX_LV, needExp, staminaMaxOf, rollStamina, msToNextStamina, POINTS_PER_LV, POINTS_ON_STEP, POINTS_STEP } from '../lib/level.js'
import { jobMaxOf, jobNeed, jobOf, stageOf, stageLabelOf, stageColorOf, weaponsOf, JOB_LV_HPMP } from '../lib/jobs.js'
import { passiveOf, SKILL_BY_NAME } from '../lib/skills.js'
import { SLOTS, SLOT_LABEL, kindLabel, itemLabel, RARITY_COLOR } from '../lib/equipment.js'
import { equippedItems, statBreakdown, currentSetOf } from '../lib/loadout.js'
import { effectPct, powerAt } from '../lib/gear.js'
import { plusOf, plusLabel } from '../lib/smith.js'
import { avatarUrlOf } from './v2capAvatarUrl.js'
import V2capPoints from './V2capPoints.jsx'

// ============================================================
// 「レベルキャップあり」版 — ステータス欄（ホームの左）
//   【確定】2026-10-11 ユーザー指示「UIはV2みたいにこんな感じにしてほしい」：見た目は今のⅡ（V2Status.jsx）と同じ数値にそろえる
//   （枠 #0044aa／背景 #001040／padding 10px、名前13px・行11px、升目9〜10px、EXPバー4px、折りたたみは上）。
//   この版だけのもの：
//   ・左上のアイコンは自分で設定する（プロフィール。無いときは点線の枠＝押すとプロフィールへ）
//   ・LVの下に ClassLV（初期職30・一次職50で止まる）・EXPとClassEXPの2本のバー
//   ・ステの内訳（本体＋クラス＋装備＋軽装のAGI）をカーソルで出す・まだ振っていないステータスポイントの「振る」
//   ・装備は7枠（武器1・頭・鎧・腕・足・装飾品2）。名前はレア度の色・強化値・必要LV不足の効果%
//   ・スキルは**いまの職業の編成**（スキルセットは職業ごと）。職業パッシブは一次職だけ
// ============================================================
const cell = {
  background:'#000818', border:'1px solid #002244', padding:'3px 6px',
  display:'flex', alignItems:'center', justifyContent:'space-between', gap:'6px',
}
const foldBtn = {
  width:'100%', padding:'4px', background:'#000e1a', border:'1px solid #003366',
  color:'#7fa6d0', cursor:'pointer', fontFamily:'monospace', fontSize:'10px',
}
const valueCell = { fontSize:'10px', textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }

// 今のⅡの MiniBar と同じ
function MiniBar({ label, val, pct, color }) {
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

export default function V2capStatus({ prof, inventory, onProfile, open = true, onToggle, onAvatar }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  const bd = statBreakdown(prof, inventory)
  const worn = equippedItems(prof, inventory)
  const job = jobOf(prof.jobs, prof.class)
  const stage = stageOf(prof.class)
  const lvMax = prof.lv >= MAX_LV
  const lvNeed = needExp(prof.lv)
  const jMax = job.lv >= jobMaxOf(prof.class)
  const jNeed = jobNeed(stage, job.lv)
  const stamMax = staminaMaxOf(prof.lv)
  const stamNow = rollStamina(prof.stamina, prof.stamina_at, stamMax, now).n
  const stamNext = msToNextStamina(prof.stamina, prof.stamina_at, stamMax, now)
  const avatar = avatarUrlOf(prof.avatar)
  const classColor = stageColorOf(prof.class)

  // map の (値, 添字)。添字が奇数＝右の列（右端をそろえて左へ伸ばす）
  const statCell = (k, i) => {
    const d = STAT_DEFS[k]
    const extra = k === 'agi' ? bd.armorAgi : 0
    const add = bd.job[k] + bd.gear[k] + extra
    return (
      <V2Tip key={k} alignRight={i % 2 === 1} color={d.color} width="max(100%, 230px)"
        style={{ ...cell, justifyContent:'flex-start' }}
        body={<>
          <span style={{ color: d.color }}>{d.label}</span>
          <span style={{ color:'#7fa6d0' }}>（{d.jp}）</span>
          <div style={{ marginTop:'2px' }}>{d.detail}</div>
          <div style={{ marginTop:'4px', color:'#cfe2ff' }}>
            本体 {bd.body[k]}
            {bd.job[k] > 0 && <> ＋ クラス <span style={{ color:'#ffcc00' }}>{bd.job[k]}</span></>}
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

  // 装備の升目。カーソルを合わせる（スマホはタップ）と、レア度・強化値・アイテムLV・戦闘力が出る
  const eqCell = (slot, i) => {
    const w = worn[slot]
    const pct = w ? effectPct(w.inv.ilv, prof.lv) : 100
    const plus = w ? plusOf(w.inv) : 0
    const power = w ? powerAt(w.item, w.inv.ilv, plus) : 0
    return (
      <div key={slot} style={cell}>
        <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>{SLOT_LABEL[slot]}</span>
        {w ? (
          <V2Tip alignRight={i % 2 === 1} width="230px" style={{ display:'block', flex:1, minWidth:0 }}
            body={<>
              <div>
                <span style={{ color: RARITY_COLOR[w.item.rarity] }}>{itemLabel(w.item)}</span>
                {plus > 0 && <span style={{ color:'#ffcc00' }}> {plusLabel(plus)}</span>}（{kindLabel(w.item)}）
              </div>
              <div>アイテムLV {w.inv.ilv}（必要LV {w.inv.ilv}）{plus > 0 && <>・強化 {plusLabel(plus)}（強さ{100 + plus * 10}%）</>}</div>
              <div>戦闘力 {power}{pct < 100 && <span style={{ color:'#ff8844' }}> → {Math.round(power * pct / 100)}（効果{pct}%）</span>}</div>
            </>}>
            <span style={{ ...valueCell, display:'block' }}>
              <span style={{ color: RARITY_COLOR[w.item.rarity] }}>{w.item.name}</span>
              {plus > 0 && <span style={{ color:'#ffcc00' }}>{plusLabel(plus)}</span>}
              {pct < 100 && <span style={{ color:'#ff8844' }}> {pct}%</span>}
            </span>
          </V2Tip>
        ) : <span style={{ ...valueCell, color:'#62789a' }}>—</span>}
      </div>
    )
  }

  // スキル編成（いまの職業の編成）。カーソルを合わせると効果が出る
  const skillCell = (i) => {
    const e = currentSetOf(prof)[i]
    const s = e && SKILL_BY_NAME[e.name]
    return (
      <div key={i} style={cell}>
        <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>スキル{i + 1}</span>
        {s ? (
          <V2SkillTip skill={s} uses={e.uses || 1} alignRight={i % 2 === 1} style={{ display:'block', flex:1, minWidth:0 }}>
            <span style={{ ...valueCell, display:'block' }}>
              <span style={{ color: KIND_COLOR[s.kind] }}>{s.name}</span>
              <span style={{ color:'#7fa6d0' }}>×{e.uses || 1}</span>
            </span>
          </V2SkillTip>
        ) : <span style={{ ...valueCell, color:'#62789a' }}>—</span>}
      </div>
    )
  }

  const passive = passiveOf(prof.class)
  const armorParts = []
  if (bd.armor.takenPct) armorParts.push(`受けるダメージ${bd.armor.takenPct}%`)
  if (bd.armor.agiPct) armorParts.push(`AGI+${bd.armor.agiPct}%`)

  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'10px', marginBottom:'8px', fontFamily:'monospace' }}>
      {/* アイコン＋名前・職業とLV・ClassLV・戦闘力・Gold・スタミナ（今のⅡと同じ並び。画像に枠は無い） */}
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        {avatar ? (
          <img src={avatar} alt="avatar" onClick={onAvatar} title="プロフィールでアイコンを変える"
            style={{ width:'76px', height:'76px', objectFit:'cover', flexShrink:0, cursor: onAvatar ? 'pointer' : 'default' }}
            onError={e => { e.target.style.display = 'none' }} />
        ) : onAvatar && (
          <button onClick={onAvatar} title="プロフィールでアイコンを設定する"
            style={{ width:'76px', height:'76px', flexShrink:0, background:'transparent', border:'1px dashed #223a5e',
              color:'#62789a', fontSize:'9px', fontFamily:'monospace', cursor:'pointer', lineHeight:1.6 }}>
            アイコンを<br />設定する
          </button>
        )}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#ffcc00', fontSize:'13px' }}>{prof.username}</div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            <span style={{ color: classColor, fontSize:'9px', marginRight:'3px' }}>[{stageLabelOf(prof.class)}]</span>
            <span style={{ color: classColor }}>{prof.class}</span>{' '}
            {/* 上がり方の説明は長いので、LVに合わせたときだけ出す */}
            <V2Tip color="#ffcc00" width="250px" style={{ borderBottom:'1px dotted #ffcc00' }}
              body={`LVアップでステは上がらず、ステータスポイントが${POINTS_PER_LV}（${POINTS_STEP}の倍数のLVは${POINTS_ON_STEP}）入ります。ステータスの下の「振る」で好きなステに振れます。`}>
              <span style={{ color:'#ffcc00' }}>LV{prof.lv}</span>／{MAX_LV}
            </V2Tip>
            {lvMax && <span style={{ color:'#ff8844' }}> MAX</span>}
          </div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            <V2Tip color="#ffcc00" width="250px" style={{ borderBottom:'1px dotted #7fa6d0' }}
              body={`ClassLVは職業ごと。上がるとその職業のスキルを覚え、その職業のステが上がります（就いている間だけ）。HPとMPは毎回必ず上がります（${prof.class}はHP+${JOB_LV_HPMP[prof.class]?.hp || 0}・MP+${JOB_LV_HPMP[prof.class]?.mp || 0}）。`}>
              ClassLV: <span style={{ color:'#66ddff' }}>{job.lv}</span>／{jobMaxOf(prof.class)}
            </V2Tip>
            {jMax && <span style={{ color:'#ff8844' }}> MAX</span>}
          </div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            <V2Tip color="#44ff88" width="230px" style={{ borderBottom:'1px dotted #44ff88' }}
              body={`本体${calcPower(bd.body)}・クラス${calcPower(bd.job)}・装備${calcPower(bd.gear)}`}>
              戦闘力: <span style={{ color:'#44ff88' }}>{bd.power.toLocaleString()}</span>
            </V2Tip>
          </div>
          {/* Goldの右にスタミナ（入りきらない幅では下へ折り返す） */}
          <div style={{ fontSize:'11px', color:'#9ec2e6', display:'flex', flexWrap:'wrap', gap:'2px 14px' }}>
            <span>Gold: <span style={{ color:'#ffcc00' }}>{Number(prof.gold || 0).toLocaleString()}</span></span>
            <span>
              ⚡スタミナ: <span style={{ color: stamNow > 0 ? '#ffdd44' : '#ff8844' }}>{stamNow}</span>
              <span style={{ color:'#7fa6d0' }}>／{stamMax}</span>
              {stamNow < stamMax && stamNext > 0 && <span style={{ color:'#4d6f92', fontSize:'10px' }}>{'　'}次まで {mmss(stamNext)}</span>}
            </span>
          </div>
        </div>
      </div>

      {/* EXP と ClassEXP は閉じていても常に見せる */}
      <MiniBar label="EXP" val={lvMax ? 'MAX' : `${prof.exp.toLocaleString()}/${lvNeed.toLocaleString()}`}
        pct={lvMax ? 100 : (prof.exp / lvNeed) * 100} color="#cc8800" />
      <MiniBar label="ClassEXP" val={jMax ? 'MAX' : `${job.exp.toLocaleString()}/${jNeed.toLocaleString()}`}
        pct={jMax ? 100 : (job.exp / jNeed) * 100} color="#3399cc" />

      {/* ★折りたたみは上（今のⅡと同じ）。中身が長いので、下に置くと閉じるたびに端まで送られる */}
      <button onClick={onToggle} style={{ ...foldBtn, marginTop:'4px', marginBottom: open ? '6px' : 0 }}>
        {open ? '▲ ステータスを閉じる' : '▼ ステータスを表示'}
      </button>
      {/* 振っていないポイントがあるときは、閉じていても気づけるように出す */}
      {!open && <V2capPoints prof={prof} onProfile={onProfile} />}

      {open && (<>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {['hp', 'mp'].map(statCell)}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {['str', 'dex', 'agi', 'int_stat', 'vit', 'luk'].map(statCell)}
        </div>
        <V2capPoints prof={prof} onProfile={onProfile} />

        {passive && (
          <div style={{ ...cell, marginBottom:'6px' }}>
            <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>職業パッシブ</span>
            <V2Tip alignRight width="240px" color="#ffcc66" style={{ display:'block', flex:1, minWidth:0 }}
              body={<><span style={{ color:'#ffcc66' }}>{passive.name}</span><div style={{ marginTop:'2px' }}>{passive.desc}</div><div style={{ color:'#88ddaa', marginTop:'2px' }}>就いている間ずっと効く（枠は使わない）</div></>}>
              <span style={{ ...valueCell, display:'block' }}>
                <span style={{ color:'#ffcc66' }}>{passive.name}</span>
                <span style={{ color:'#7fa6d0' }}> 常時</span>
              </span>
            </V2Tip>
          </div>
        )}

        <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'2px', display:'flex', justifyContent:'space-between', gap:'6px', flexWrap:'wrap' }}>
          <span>装備<span style={{ fontSize:'9px' }}>（{prof.class}の武器：{weaponsOf(prof.class).join('・')}）</span></span>
          {armorParts.length > 0 && <span style={{ color:'#88ddaa', fontSize:'9px' }}>{armorParts.join('・')}</span>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {SLOTS.map(eqCell)}
        </div>

        <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'2px' }}>スキル編成</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px' }}>
          {Array.from({ length: SKILL_SET_SLOTS }, (_, i) => skillCell(i))}
        </div>
      </>)}
    </div>
  )
}
