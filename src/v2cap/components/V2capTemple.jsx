import { useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { passiveOf } from '../../v2/lib/skills.js'
import {
  CLASSES, STAGES, STAGE_ORDER, JOB_MAX, jobOf, jobBonusText, missingReqOf, canBecome, reqText,
  learnOrderOf, nextSkillOf,
} from '../lib/jobs.js'

// ============================================================
// 「レベルキャップあり」版 — 神殿（転職）
//   ・いつでも無料。**LVはそのまま**、ジョブLVは職業ごとに続きから（2026-10-09 ユーザー決定）
//   ・一次職は元の初期職のジョブLV30で就ける
//   ・ジョブのステはその職業に就いている間だけ効く。覚えたスキルはずっと残る
// ============================================================
export default function V2capTemple({ prof, onProfile }) {
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const learned = new Set(prof.learned || [])

  const change = async () => {
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc('v2cap_change_class', { p_class: confirm })
    setBusy(false)
    if (e || !data?.ok) { setError(e?.message || data?.error || '転職に失敗しました'); setConfirm(null); return }
    const got = data.learned || []
    setMsg(`${confirm}になった！${got.length ? `　スキル「${got.join('」「')}」を覚えた` : ''}`)
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
            LVはそのままです。{confirm}のジョブLVは{jobOf(prof.jobs, confirm).lv}から続きます。
            ジョブのステは{confirm}のものに入れ替わります。覚えたスキルはなくなりません。
          </div>
        </V2Modal>
      )}
      <div style={{ ...box, padding:'14px', marginBottom:'10px' }}>
        <div style={{ color:'#ff88cc', fontSize:'12px', marginBottom:'6px' }}>🏛 神殿（転職）</div>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.8 }}>
          いつでも無料で転職できます。LVは下がらず、ジョブLVは職業ごとに残ります（最大{JOB_MAX}）。
          ジョブLVが上がると、その職業のスキルを覚え、その職業のステが上がります（ステは就いている間だけ）。
        </div>
        {msg && <div style={{ color:'#44ff88', fontSize:'11px', marginTop:'8px' }}>{msg}</div>}
        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'8px' }}>⚠ {error}</div>}
      </div>

      {STAGE_ORDER.map(stage => (
        <div key={stage} style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color: STAGES[stage].color, fontSize:'12px', marginBottom:'8px' }}>
            {STAGES[stage].label}職
            <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'8px' }}>
              {stage === 'shoki' ? '条件なし' : '元の初期職のジョブLV30で就ける'}・必要ジョブEXP×{STAGES[stage].mult}
            </span>
          </div>
          <div style={{ display:'grid', gap:'4px' }}>
            {CLASSES.filter(c => c.stage === stage).map(c => {
              const job = jobOf(prof.jobs, c.id)
              const touched = !!prof.jobs?.[c.id]
              const isNow = c.id === prof.class
              const miss = missingReqOf(c.id, prof.jobs)
              const order = learnOrderOf(c.id)
              const got = order.filter(s => learned.has(s.name)).length
              const next = nextSkillOf(c.id, job.lv)
              const passive = passiveOf(c.id)
              return (
                <div key={c.id} style={{ background:'#000818', border:`1px solid ${isNow ? '#ff88cc' : '#002244'}`, padding:'6px 8px', opacity: miss ? 0.55 : 1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px' }}>
                    <span style={{ color: STAGES[stage].color, flex:1 }}>
                      {c.id}
                      {isNow && <span style={{ color:'#ff88cc', fontSize:'10px', marginLeft:'6px' }}>いまの職業</span>}
                    </span>
                    <span style={{ color: touched ? '#ffcc00' : TEXT.empty, fontSize:'11px' }}>
                      ジョブLV{job.lv}{job.lv >= JOB_MAX ? '（上限）' : ''}
                    </span>
                    {!isNow && (
                      <button onClick={() => { setMsg(''); setConfirm(c.id) }} disabled={busy || !canBecome(c.id, prof.jobs)}
                        style={miniBtn(miss ? '#62789a' : '#ff88cc')}>転職する</button>
                    )}
                  </div>
                  <div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'3px', lineHeight:1.7 }}>
                    <div>ジョブのステ：{jobBonusText(c.id, job.lv) || 'まだなし'}
                      <span style={{ color: TEXT.label }}>（JLV30で {jobBonusText(c.id, JOB_MAX)}）</span>
                    </div>
                    <div>スキル {got}/{order.length}{next ? `（次はジョブLV${next.jlv}で「${next.skill.name}」）` : ''}
                      {passive && <span style={{ color:'#88aacc' }}>　パッシブ「{passive.name}」</span>}
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
