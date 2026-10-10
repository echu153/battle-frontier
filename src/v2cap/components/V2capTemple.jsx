import { useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { STAT_DEFS } from '../../v2/lib/stats.js'
import {
  CLASSES, STAGES, STAGE_ORDER, jobOf, jobMaxOf, missingReqOf, canBecome, reqText, weaponsOf, canEquipType, classDescOf, mainStatsOf,
} from '../lib/jobs.js'
import { ITEM_BY_ID } from '../lib/equipment.js'

// ============================================================
// 「レベルキャップあり」版 — 神殿（転職）
//   【確定】2026-10-11 ユーザー指示「神殿がめちゃくちゃ見づらい…細かな説明いらない…今の書き方詳細に書きすぎ」：
//   ・上の説明は出さない。「初期クラス」「一次クラス」の見出しの下に、職業ごとに次の4行だけ
//       職業名
//       特徴を一言（jobs.js の classDescOf）
//       装備できる武器種：両手剣・斧・鈍器・刀
//       上がりやすいステータス：STR・VIT（jobs.js の mainStatsOf＝配分の高い2〜3種）
//   ・スキルの一覧・クラスのステの数・パッシブは出さない（ステータス欄・スキルセットで見る）
//   ・右に ClassLV と「転職する」（いまの職業は「いまのクラス」）。一次クラスはまだ就けないときだけ条件を出す
//   仕組み：いつでも無料・LVはそのまま・ClassLVは職業ごとに続きから・スキルセットは職業ごと（転職の確認に出す）
// ============================================================
const statText = (cls) => mainStatsOf(cls).map(k => STAT_DEFS[k]?.label || k).join('・')
const STAGE_TITLE = { shoki:'初期クラス', ichiji:'一次クラス' }

export default function V2capTemple({ prof, inventory, onProfile }) {
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  // 転職すると外れる武器（いま着けている武器を、次の職業が装備できないとき）
  const wornWeapon = (() => {
    const inv = (inventory || []).find(i => String(i.id) === String(prof.equipped?.weapon))
    return inv ? ITEM_BY_ID[inv.base_id] : null
  })()

  const change = async () => {
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc('v2cap_change_class', { p_class: confirm })
    if (e || !data?.ok) { setBusy(false); setError(e?.message || data?.error || '転職に失敗しました'); setConfirm(null); return }
    const got = data.learned || []
    setMsg(`${confirm}になった！${got.length ? `　スキル「${got.join('」「')}」を覚えた` : ''}${data.unequipped ? '　装備できない武器を外した' : ''}`)
    setConfirm(null)
    await onProfile(null)
    setBusy(false)
  }

  return (
    <div style={{ fontFamily:'monospace' }}>
      {confirm && (
        <V2Modal title="転職する" color="#ff88cc" busy={busy} confirmLabel="転職する"
          onConfirm={change} onClose={() => setConfirm(null)}>
          <div><span style={{ color:'#cfe2ff' }}>{prof.class}</span> → <span style={{ color:'#ffcc00' }}>{confirm}</span></div>
          <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'6px', lineHeight:1.8 }}>
            LVはそのまま、{confirm}のClassLVは{jobOf(prof.jobs, confirm).lv}から続きます。
            スキルセットは{confirm}のものに切り替わります（{prof.class}の編成は残ります）。
            {wornWeapon && !canEquipType(confirm, wornWeapon.type) && (
              <span style={{ color:'#ff8844' }}> いま着けている{wornWeapon.name}（{wornWeapon.type}）は外れます。</span>
            )}
          </div>
        </V2Modal>
      )}
      {msg && <div style={{ color:'#44ff88', fontSize:'11px', marginBottom:'8px' }}>{msg}</div>}
      {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}

      {STAGE_ORDER.map(stage => (
        <div key={stage} style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color: STAGES[stage].color, fontSize:'13px', marginBottom:'8px' }}>{STAGE_TITLE[stage] || `${STAGES[stage].label}クラス`}</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'6px' }}>
            {CLASSES.filter(c => c.stage === stage).map(c => {
              const job = jobOf(prof.jobs, c.id)
              const isNow = c.id === prof.class
              const miss = missingReqOf(c.id, prof.jobs)
              return (
                <div key={c.id} style={{ background:'#000818', border:`1px solid ${isNow ? '#ff88cc' : '#002244'}`, padding:'8px 10px', opacity: miss ? 0.55 : 1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'4px' }}>
                    <span style={{ color: isNow ? '#ff88cc' : '#cfe2ff', fontSize:'14px', flex:1, minWidth:0 }}>{c.id}</span>
                    {prof.jobs?.[c.id] && (
                      <span style={{ color:'#ffcc00', fontSize:'10px' }}>ClassLV{job.lv}{job.lv >= jobMaxOf(c.id) ? '（上限）' : ''}</span>
                    )}
                    {isNow
                      ? <span style={{ color:'#ff88cc', fontSize:'10px' }}>いまのクラス</span>
                      : <button onClick={() => { setMsg(''); setConfirm(c.id) }} disabled={busy || !canBecome(c.id, prof.jobs)}
                          style={miniBtn(miss ? '#62789a' : '#ff88cc')}>転職する</button>}
                  </div>
                  <div style={{ color:'#9fb8d0', fontSize:'11px', lineHeight:1.6, marginBottom:'4px' }}>{classDescOf(c.id)}</div>
                  <div style={{ fontSize:'11px', lineHeight:1.7 }}>
                    <div><span style={{ color: TEXT.label }}>装備できる武器種：</span><span style={{ color:'#cfe2ff' }}>{weaponsOf(c.id).join('・')}</span></div>
                    <div><span style={{ color: TEXT.label }}>上がりやすいステータス：</span><span style={{ color:'#44ff88' }}>{statText(c.id)}</span></div>
                    {miss && (
                      <div style={{ color:'#ff8844' }}>条件：{reqText(c.id)}（いま{jobOf(prof.jobs, c.req.cls).lv}）</div>
                    )}
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
