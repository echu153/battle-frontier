import { useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { KIND_COLOR } from '../../v2/lib/skills.js'
import {
  CLASSES, STAGES, STAGE_ORDER, JOB_LV_HPMP, jobOf, jobMaxOf, jobBonusText, missingReqOf, canBecome, reqText,
  learnOrderOf, learnAtOf, weaponsOf, canEquipType, classDescOf,
} from '../lib/jobs.js'
import { passiveOf } from '../lib/skills.js'
import { ITEM_BY_ID } from '../lib/equipment.js'

// ============================================================
// 「レベルキャップあり」版 — 神殿（転職）
//   ・いつでも無料。**LVはそのまま**、ClassLVは職業ごとに続きから（2026-10-09 ユーザー決定）
//   ・初期職は11職。職業ごとに装備できる武器が3〜4種決まっている（転職で装備できなくなった武器は外れる）
//   ・クラスのステはその職業に就いている間だけ効く。ClassLVが上がるたびに必ずHPとMPも上がる（量は職業ごと・2026-10-10）
//   ・スキルは**その職業でだけ使える**（覚えたものは消えず、戻れば使える）。スキルセットも**職業ごと**で、
//     転職すると新しい職業の編成に切り替わる（初めてなら覚えている技を入れた編成で始まる）
//   ・一次職（2026-10-10・20職）は、系統の初期職がClassLV30で就ける。ClassLVの上限は50。パッシブを1つ持つ（就いている間だけ効く）
// ============================================================
export default function V2capTemple({ prof, inventory, onProfile }) {
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const learned = new Set(prof.learned || [])

  // 転職すると外れる武器（いま着けている武器を、次の職業が装備できないとき）
  const wornWeapon = (() => {
    const inv = (inventory || []).find(i => String(i.id) === String(prof.equipped?.weapon))
    return inv ? ITEM_BY_ID[inv.base_id] : null
  })()

  const change = async () => {
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc('v2cap_change_class', { p_class: confirm })
    setBusy(false)
    if (e || !data?.ok) { setError(e?.message || data?.error || '転職に失敗しました'); setConfirm(null); return }
    const got = data.learned || []
    setMsg(`${confirm}になった！${got.length ? `　スキル「${got.join('」「')}」を覚えた` : ''}${data.unequipped ? '　装備できない武器を外した' : ''}`)
    setConfirm(null)
    onProfile(null)
  }

  return (
    <div style={{ fontFamily:'monospace' }}>
      {confirm && (
        <V2Modal title="転職する" color="#ff88cc" busy={busy} confirmLabel="転職する"
          onConfirm={change} onClose={() => setConfirm(null)}>
          <div><span style={{ color:'#cfe2ff' }}>{prof.class}</span> → <span style={{ color:'#ffcc00' }}>{confirm}</span></div>
          <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'6px' }}>
            LVはそのままです。{confirm}のClassLVは{jobOf(prof.jobs, confirm).lv}から続きます。
            クラスのステは{confirm}のものに入れ替わります。
            スキルセットは{confirm}の編成に切り替わり、使えるのは{confirm}のスキルだけになります
            （{prof.class}の編成とスキルは残り、戻れば元どおり使えます）。
            {!Array.isArray(prof.skill_sets?.[confirm]) && <span>{confirm}は初めてなので、覚えている技を入れた編成で始まります。</span>}
            {wornWeapon && !canEquipType(confirm, wornWeapon.type) && (
              <span style={{ color:'#ff8844' }}> いま着けている{wornWeapon.name}（{wornWeapon.type}）は{confirm}が装備できないので外れます。</span>
            )}
          </div>
        </V2Modal>
      )}
      <div style={{ ...box, padding:'14px', marginBottom:'10px' }}>
        <div style={{ color:'#ff88cc', fontSize:'12px', marginBottom:'6px' }}>🏛 神殿（転職）</div>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.8 }}>
          いつでも無料で転職できます。LVは下がらず、ClassLVは職業ごとに残ります（初期職は最大{STAGES.shoki.max}・一次職は最大{STAGES.ichiji.max}）。
          ClassLVが上がると、その職業のスキルを覚え、その職業のステが上がります（ステは就いている間だけ）。
          HPとMPは毎回必ず上がります（量は職業ごと）。
          スキルはその職業でだけ使え、スキルセットも職業ごとに保存されます。
          職業ごとに装備できる武器が決まっています。
        </div>
        {msg && <div style={{ color:'#44ff88', fontSize:'11px', marginTop:'8px' }}>{msg}</div>}
        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'8px' }}>⚠ {error}</div>}
      </div>

      {STAGE_ORDER.map(stage => (
        <div key={stage} style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color: STAGES[stage].color, fontSize:'12px', marginBottom:'8px' }}>{STAGES[stage].label}職</div>
          <div style={{ display:'grid', gap:'4px' }}>
            {CLASSES.filter(c => c.stage === stage).map(c => {
              const job = jobOf(prof.jobs, c.id)
              const touched = !!prof.jobs?.[c.id]
              const isNow = c.id === prof.class
              const miss = missingReqOf(c.id, prof.jobs)
              const order = learnOrderOf(c.id)
              const at = learnAtOf(c.id)
              return (
                <div key={c.id} style={{ background:'#000818', border:`1px solid ${isNow ? '#ff88cc' : '#002244'}`, padding:'6px 8px', opacity: miss ? 0.55 : 1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
                    <span style={{ color: STAGES[stage].color, flex:1 }}>
                      {c.id}
                      <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>{weaponsOf(c.id).join('・')}</span>
                      {isNow && <span style={{ color:'#ff88cc', fontSize:'10px', marginLeft:'6px' }}>いまの職業</span>}
                    </span>
                    <span style={{ color: touched ? '#ffcc00' : TEXT.empty, fontSize:'11px' }}>
                      ClassLV{job.lv}{job.lv >= jobMaxOf(c.id) ? '（上限）' : ''}
                    </span>
                    {!isNow && (
                      <button onClick={() => { setMsg(''); setConfirm(c.id) }} disabled={busy || !canBecome(c.id, prof.jobs)}
                        style={miniBtn(miss ? '#62789a' : '#ff88cc')}>転職する</button>
                    )}
                  </div>
                  <div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'3px', lineHeight:1.7 }}>
                    {stage !== 'shoki' && <div style={{ color:'#9fb8d0' }}>{classDescOf(c.id)}</div>}
                    <div>クラスのステ：{jobBonusText(c.id, job.lv) || 'まだなし'}
                      <span style={{ color: TEXT.label }}>（ClassLV{jobMaxOf(c.id)}で {jobBonusText(c.id, jobMaxOf(c.id))}）</span>
                    </div>
                    <div>ClassLVが上がるたびに必ず <span style={{ color:'#cfe2ff' }}>HP+{JOB_LV_HPMP[c.id]?.hp || 0}・MP+{JOB_LV_HPMP[c.id]?.mp || 0}</span>（ほかのステとは別）</div>
                    {passiveOf(c.id) && (
                      <div>パッシブ：<span style={{ color:'#ffcc66' }}>{passiveOf(c.id).name}</span>（{passiveOf(c.id).desc}）</div>
                    )}
                    <div>
                      {order.map((s, i) => (
                        <span key={s.name} style={{ marginRight:'8px', opacity: learned.has(s.name) ? 1 : 0.55 }}>
                          <span style={{ color: TEXT.label }}>ClassLV{at[i]}</span>{' '}
                          <span style={{ color: learned.has(s.name) ? KIND_COLOR[s.kind] : TEXT.sub }}>{s.name}</span>
                        </span>
                      ))}
                    </div>
                    {c.req && <div style={{ color: miss ? '#ff8844' : '#88ddaa' }}>条件：{reqText(c.id)}{miss ? `（いま${jobOf(prof.jobs, c.req.cls).lv}）` : '（達成）'}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
