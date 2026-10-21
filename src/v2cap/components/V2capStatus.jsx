import { useEffect, useState } from 'react'
import { STAT_DEFS, calcPower } from '../../v2/lib/stats.js'
import { mmss } from '../../v2/lib/stamina.js'
import { KIND_COLOR, SKILL_SET_SLOTS } from '../../v2/lib/skills.js'
import { V2Tip, V2SkillTip } from '../../v2/components/V2ItemTip.jsx'
import { MAX_LV, needExp, staminaMaxOf, rollStamina, msToNextStamina, POINTS_PER_LV, POINTS_ON_STEP, POINTS_STEP } from '../lib/level.js'
import { jobMaxOf, jobNeed, jobOf, stageOf, stageColorOf, weaponsOf, JOB_LV_HPMP } from '../lib/jobs.js'
import { passiveOf, SKILL_BY_NAME } from '../lib/skills.js'
import { SLOTS, SLOT_LABEL, ARMOR_LINES, ARMOR_EFFECT, kindLabel, RARITY_COLOR } from '../lib/equipment.js'
import { equippedItems, statBreakdown, currentSetOf } from '../lib/loadout.js'
import { syncLabelOf, powerAt, statsAt, armorEffectText, effectivePowerAt } from '../lib/gear.js'
import { needLvOf } from '../lib/equipment.js'
import { plusOf, plusLabel } from '../lib/smith.js'
import { myIconOf } from './v2capAvatarUrl.js'
import { avatarImgStyle, AVATAR_CUSTOM_ON } from '../lib/avatar.js'
import { StatGain } from './v2capGear.jsx'
import V2capPoints from './V2capPoints.jsx'
import V2capArmorSets from './V2capArmorSets.jsx'
import V2capUniqueFx from './V2capUniqueFx.jsx'
import { isUnique } from '../lib/equipment.js'

// ============================================================
// 「レベルキャップあり」版 — ステータス欄（ホームの左）
//   【確定】2026-10-11 ユーザー指示「UIはV2みたいにこんな感じにしてほしい」：見た目は今のⅡ（V2Status.jsx）と同じ数値にそろえる
//   （枠 #0044aa／背景 #001040／padding 10px、名前13px・行11px、升目9〜10px、EXPバー4px、折りたたみは上）。
//   この版だけのもの：
//   ・左上のアイコンは自分で設定する（プロフィール。無いときは点線の枠＝押すとプロフィールへ）
//   ・名前の下に「LV2/100」、その下に「クラス：盗賊　LV3/30」（ClassLV＝初期職30・上位職50で止まる）・EXPとClassEXPの2本のバー
//     （2026-10-12 ユーザー指示「この書き方にして」「クラス：盗賊　Lv3/30　にして」＝表記ルールどおり LV。前は「[初期] 盗賊 LV2／100」「ClassLV: 2／30」）
//   ・ステの升目は合計だけ（2026-10-12 ユーザー指示「ホーム画面の数値は最終値だけ」）。内訳（本体＋クラス＋装備＋軽装のAGI）は
//     カーソルで出す＋プロフィールに表で出す（V2capProfile）・まだ振っていないステータスポイントの「振る」
//   ・装備は7枠（武器1・頭・鎧・腕・足・装飾品2）。名前はレア度の色・強化値・必要LVに足りないときの「LV〇相当」（2026-10-18〜。前は効果%）。
//     カーソルで上がるステ・防具の効果も出す（2026-10-12 ユーザー指示「どの能力が上がってるのかわかるように」）
//   ・スキルは**いまの職業の編成**（スキルセットは職業ごと）。職業パッシブは上位職だけ
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
  const avatar = myIconOf(prof)
  const pickAvatar = AVATAR_CUSTOM_ON ? onAvatar : null   // 自分の画像を止めているあいだ（2026-10-22〜）はアイコンを押しても何もしない
  const classColor = stageColorOf(prof.class)

  // map の (値, 添字)。添字が奇数＝右の列（右端をそろえて左へ伸ばす）
  // ★升目の数は合計だけ（2026-10-12 ユーザー指示「ホーム画面の数値は最終値だけ」）。内訳はカーソルとプロフィールで見る
  const statCell = (k, i) => {
    const d = STAT_DEFS[k]
    const extra = k === 'agi' ? bd.armorAgi : 0
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
            {bd.set[k] > 0 && <> ＋ セット <span style={{ color:'#88ddaa' }}>{bd.set[k]}</span></>}
          </div>
        </>}>
        <span style={{ color: d.color, fontSize:'9px', flexShrink:0 }}>{d.label}</span>
        <span style={{ color:'#82a2c2', fontSize:'9px', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.desc}</span>
        <span style={{ color: d.color, fontSize:'10px', flexShrink:0 }}>{bd.total[k].toLocaleString()}</span>
      </V2Tip>
    )
  }

  // 装備の升目。カーソルを合わせる（スマホはタップ）と、上がるステ・防具の効果・レア度・強化値・アイテムLV・戦闘力が出る
  // ★上がるステは強化値と、必要LVに足りない装備のLV相当を入れたあとの数（2026-10-12 ユーザー指示「どの能力が上がってるのかわかるように」）
  const eqCell = (slot, i) => {
    const w = worn[slot]
    const sync = w ? syncLabelOf(w.item, w.inv.ilv, prof.lv) : ''
    const plus = w ? plusOf(w.inv) : 0
    const power = w ? powerAt(w.item, w.inv.ilv, plus) : 0
    const gain = w ? statsAt(w.item, w.inv.ilv, prof.lv, plus) : null
    return (
      <div key={slot} style={cell}>
        <span style={{ color:'#7fa6d0', fontSize:'9px', flexShrink:0 }}>{SLOT_LABEL[slot]}</span>
        {w ? (
          <V2Tip alignRight={i % 2 === 1} width="230px" style={{ display:'block', flex:1, minWidth:0 }}
            body={<>
              <div>
                <span style={{ color: RARITY_COLOR[w.item.rarity] }}>{w.item.name}</span>
                {plus > 0 && <span style={{ color:'#ffcc00' }}> {plusLabel(plus)}</span>}（{kindLabel(w.item)}）
              </div>
              <div style={{ fontSize:'11px' }}><StatGain s={gain} /></div>
              {w.item.line && <div style={{ color:'#88ddaa' }}>{w.item.line}：{armorEffectText(w.item)}</div>}
              <div>アイテムLV {w.inv.ilv}（必要LV {needLvOf(w.item, w.inv.ilv)}）{plus > 0 && <>・強化 {plusLabel(plus)}</>}</div>
              <div>戦闘力 {power}{sync && <span style={{ color:'#ff8844' }}> → {effectivePowerAt(w.item, w.inv.ilv, prof.lv, plus)}（{sync}）</span>}</div>
            </>}>
            <span style={{ ...valueCell, display:'block' }}>
              <span style={{ color: RARITY_COLOR[w.item.rarity] }}>{w.item.name}</span>
              {plus > 0 && <span style={{ color:'#ffcc00' }}>{plusLabel(plus)}</span>}
              {sync && <span style={{ color:'#ff8844' }}> {sync}</span>}
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
  // 防具の効果の内訳（何部位か）。カーソルで出す。必要LVに足りなくても弱めない（2026-10-18〜）
  const armorWorn = Object.values(worn).filter(w => w.item.line)
  const lineCount = (line) => armorWorn.filter(w => w.item.line === line).length

  return (
    <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'10px', marginBottom:'8px', fontFamily:'monospace' }}>
      {/* アイコン＋名前・職業とLV・ClassLV・戦闘力・Gold・スタミナ（今のⅡと同じ並び。画像に枠は無い） */}
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        {/* 横幅76pxで、縦長の画像（モーションのぶん縦に大きい GIF）は切らずに縦に伸ばす（2026-10-21・lib/avatar.js の avatarImgStyle） */}
        {/* 2026-10-22〜 クラスの待機の GIF（男女はキャラの性別・v2capAvatarUrl.js の myIconOf） */}
        {avatar ? (
          <img src={avatar} alt="avatar" onClick={pickAvatar || undefined} title={pickAvatar ? 'プロフィールでアイコンを変える' : prof.class}
            style={{ ...avatarImgStyle(76), cursor: pickAvatar ? 'pointer' : 'default' }}
            onError={e => { e.target.style.display = 'none' }} />
        ) : pickAvatar && (
          <button onClick={pickAvatar} title="プロフィールでアイコンを設定する"
            style={{ width:'76px', height:'76px', flexShrink:0, background:'transparent', border:'1px dashed #223a5e',
              color:'#62789a', fontSize:'9px', fontFamily:'monospace', cursor:'pointer', lineHeight:1.6 }}>
            アイコンを<br />設定する
          </button>
        )}
        <div style={{ flex:1, minWidth:0 }}>
          {/* ★名前の下は「LV2/100」「クラス：盗賊　LV3/30」の2行（2026-10-12 ユーザー指示・[初期] の印は出さない） */}
          <div style={{ color:'#ffcc00', fontSize:'13px' }}>{prof.username}</div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            {/* 上がり方の説明は長いので、LVに合わせたときだけ出す */}
            <V2Tip color="#ffcc00" width="250px" style={{ borderBottom:'1px dotted #ffcc00' }}
              body={`LVアップでステは上がらず、ステータスポイントが${POINTS_PER_LV}（${POINTS_STEP}の倍数のLVは${POINTS_ON_STEP}）入ります。ステータスの下の「振る」で好きなステに振れます。`}>
              <span style={{ color:'#ffcc00' }}>LV{prof.lv}</span>/{MAX_LV}
            </V2Tip>
            {lvMax && <span style={{ color:'#ff8844' }}> MAX</span>}
          </div>
          <div style={{ fontSize:'11px', color:'#9ec2e6' }}>
            CLASS：<span style={{ color: classColor }}>{prof.class}</span>
            <V2Tip color="#ffcc00" width="250px" style={{ borderBottom:'1px dotted #7fa6d0', marginLeft:'10px' }}
              body={`CLASS LV（クラスのレベル）は職業ごと。上がるとその職業のスキルを覚え、その職業のステが上がります（就いている間だけ）。HPとMPは毎回必ず上がります（${prof.class}はHP+${JOB_LV_HPMP[prof.class]?.hp || 0}・MP+${JOB_LV_HPMP[prof.class]?.mp || 0}）。`}>
              <span style={{ color:'#66ddff' }}>LV{job.lv}</span>/{jobMaxOf(prof.class)}
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
      <MiniBar label="CLASS EXP" val={jMax ? 'MAX' : `${job.exp.toLocaleString()}/${jNeed.toLocaleString()}`}
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
          {armorParts.length > 0 && (
            <V2Tip alignRight width="250px" color="#88ddaa" style={{ color:'#88ddaa', fontSize:'9px', borderBottom:'1px dotted #88ddaa' }}
              body={<>
                <div style={{ color:'#88ddaa' }}>防具の効果（1部位ごとに足す）</div>
                {ARMOR_LINES.filter(l => lineCount(l) > 0).map(l => (
                  <div key={l}>{l} {lineCount(l)}部位：1部位ごとに{ARMOR_EFFECT[l].label}</div>
                ))}
                {bd.armorAgi > 0 && <div>AGI+%は本体＋クラス＋装備のAGIに掛ける（いまは<span style={{ color:'#ff8844', whiteSpace:'nowrap' }}> AGI+{bd.armorAgi}</span>）</div>}              </>}>
              {armorParts.join('・')}
            </V2Tip>
          )}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px', marginBottom:'6px' }}>
          {SLOTS.map(eqCell)}
        </div>
        {/* 防具のセット能力（2026-10-14）。発動している組だけ（カーソルで2・3・4部位の中身） */}
        <V2capArmorSets sets={bd.sets} compact cell={cell} valueCell={valueCell} />
        {/* ユニークの固有の能力（2026-10-21）。着けているものだけ（カーソルで能力の文） */}
        <V2capUniqueFx items={Object.values(worn).map(w => w.item).filter(isUnique)} compact cell={cell} valueCell={valueCell} />

        <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'2px' }}>スキル編成</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px' }}>
          {Array.from({ length: SKILL_SET_SLOTS }, (_, i) => skillCell(i))}
        </div>
      </>)}
    </div>
  )
}
