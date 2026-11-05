import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import V2capAtbMacros from './V2capAtbMacros.jsx'
import { box, btn, miniBtn, TEXT } from './v2ui.js'
import { KIND_COLOR, KIND_LABEL } from '../core/skills.js'
import { cdOfProc } from '../core/atb.js'
import { SKILL_BY_NAME } from '../lib/skills.js'
import { slotsOf } from '../lib/loadout.js'
import { lineageOf } from '../lib/jobs.js'
import { ascEffectsOf } from '../lib/ascension.js'
import { atbOffOf, atbUsableOf, saveErrText, validateAtbOff } from '../lib/atbSkills.js'
import { macrosOf, validateMacros } from '../lib/atbMacro.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— スキルセットの「挑戦（ATB）」
// ------------------------------------------------------------
// 【確定】2026-11-06 ユーザー指示「スキルセットでATBのマクロを作成できる場所とATB戦に持っていくスキルを設定できるように」
//   ＋選んだこと「数の上限なし」：
//   ・持っていく技：使える覚えた技を全部並べ、押すと持っていく／外すが切り替わる。保存は v2cap_set_atb_off（外した技を職業ごとに）
//     決まりは lib/atbSkills.js。挑戦も試し撃ちも、ここで持っていく技だけで戦う（lib/atbPlayer.js）
//   ・マクロ①〜③：前は試し撃ち（開発用）の準備の画面にだけあった。同じ部品（V2capAtbMacros.jsx）をここにも置く。
//     足せるのは持っていく技だけ（保存の確かめはサーバーと同じ「使える覚えた技」）
//   ・2つの欄は別々に保存する（片方を保存しても、もう片方の書きかけは消えない＝保存されている値が変わった欄だけ作り直す）
// クールダウンは発動率からの秒（core/atb.js の cdOfProc・アセンションで上がった発動率まで）。装備の発動率+は戦闘で縮む
// ============================================================
const mpLabel = (s) => (s.mpPct ? `MP 残りの${Math.round(Math.min(1, s.mpPct) * 100)}%` : `MP${s.mp}`)

export default function V2capSkillsAtb({ prof, onProfile }) {
  const cls = prof.class
  const usable = useMemo(() => atbUsableOf(prof), [prof])
  // アセンションで上がったあとの技（発動率＝クールダウン・消費MP）
  const ups = useMemo(() => ascEffectsOf(prof).ups, [prof])
  const skillOf = useMemo(() => Object.fromEntries(
    slotsOf(usable.map(name => ({ name, uses: 1 })), cls, lineageOf(cls), ups).map(sl => [sl.skill.name, sl.skill])), [usable, cls, ups])

  // ===== 持っていく技（外した技を覚える）=====
  const savedOffKey = JSON.stringify(atbOffOf(prof).filter(n => usable.includes(n)))
  const [off, setOff] = useState(() => JSON.parse(savedOffKey))
  useEffect(() => { setOff(JSON.parse(savedOffKey)) }, [savedOffKey])
  const offSet = new Set(off)
  const brought = usable.filter(n => !offSet.has(n))
  const offDirty = JSON.stringify([...off].sort()) !== JSON.stringify([...JSON.parse(savedOffKey)].sort())
  const [offBusy, setOffBusy] = useState(false)
  const [offMsg, setOffMsg] = useState(null)
  const toggle = (name) => { setOffMsg(null); setOff(o => (o.includes(name) ? o.filter(n => n !== name) : [...o, name])) }
  const saveOff = async () => {
    const names = usable.filter(n => offSet.has(n))   // 並びは名簿の順
    const err = validateAtbOff(names, usable)
    if (err) { setOffMsg({ ok: false, text: err }); return }
    setOffBusy(true)
    const { data, error } = await supabase.rpc('v2cap_set_atb_off', { p_names: names })
    setOffBusy(false)
    if (error || !data?.ok) { setOffMsg({ ok: false, text: saveErrText(error, data) }); return }
    setOffMsg({ ok: true, text: '保存しました' })
    onProfile(null)
  }

  // ===== マクロ①〜③ =====
  const savedMacroKey = JSON.stringify(macrosOf(prof))
  const [macros, setMacros] = useState(() => JSON.parse(savedMacroKey))
  useEffect(() => { setMacros(JSON.parse(savedMacroKey)) }, [savedMacroKey])
  const macroDirty = JSON.stringify(macros) !== savedMacroKey
  const [macroBusy, setMacroBusy] = useState(false)
  const [macroMsg, setMacroMsg] = useState(null)
  const editMacros = (next) => { setMacros(next); setMacroMsg(null) }
  const saveMacros = async () => {
    const err = validateMacros(macros, usable)
    if (err) { setMacroMsg({ ok: false, text: err }); return }
    setMacroBusy(true)
    const { data, error } = await supabase.rpc('v2cap_set_atb_macros', { p_macros: macros })
    setMacroBusy(false)
    if (error || !data?.ok) { setMacroMsg({ ok: false, text: saveErrText(error, data) }); return }
    setMacroMsg({ ok: true, text: `${cls}のマクロを保存しました` })
    onProfile(null)
  }

  return (
    <div style={{ fontFamily:'monospace' }}>
      <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px' }}>
          <span style={{ color:'#88ccff', fontSize:'12px', flex:1 }}>⏱ 挑戦に持っていく技（{cls}）</span>
          <span style={{ color: TEXT.label, fontSize:'11px' }}>{brought.length}/{usable.length}</span>
        </div>
        <div style={{ color:'#88ddaa', fontSize:'10px', marginBottom:'8px', lineHeight:'1.7' }}>
          挑戦（ATB戦闘）で使う技を選びます。いくつ持っていってもかまいません。外した技は戦闘のボタンに出ず、マクロに入っていても飛ばします。
          これから覚える技は、持っていく側に入ります。編成は職業ごとに保存されます。
        </div>
        {usable.length === 0 && <div style={{ color: TEXT.empty, fontSize:'11px', padding:'6px' }}>まだ覚えた技がありません</div>}
        <div style={{ display:'grid', gap:'3px' }}>
          {usable.map(name => {
            const s = skillOf[name] || SKILL_BY_NAME[name]
            const from = SKILL_BY_NAME[name]?.cls
            const on = !offSet.has(name)
            return (
              <button key={name} onClick={() => toggle(name)}
                style={{ background: on ? '#001838' : '#000610', border:`1px solid ${on ? '#0066cc' : '#0a2238'}`, padding:'6px 8px', display:'flex', alignItems:'center', gap:'6px',
                  fontFamily:'monospace', fontSize:'11px', cursor:'pointer', textAlign:'left', opacity: on ? 1 : 0.55 }}>
                <span style={{ width:'16px', color: on ? '#44ff88' : '#445566', fontSize:'12px' }}>{on ? '✓' : '－'}</span>
                <span style={{ flex:1, minWidth:0, color: on ? KIND_COLOR[s.kind] : '#7a8ea4', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {name}
                  <span style={{ color: TEXT.sub, fontSize:'9px', marginLeft:'5px' }}>{KIND_LABEL[s.kind]}</span>
                  {from && from !== cls && <span style={{ color:'#aaccff', fontSize:'9px', marginLeft:'5px' }}>{from}（下位職）</span>}
                </span>
                <span style={{ color: TEXT.label, fontSize:'10px', whiteSpace:'nowrap' }}>{`CD${cdOfProc(s.proc)}秒・${mpLabel(s)}`}</span>
              </button>
            )
          })}
        </div>
        <div style={{ display:'flex', gap:'6px', marginTop:'8px', alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={saveOff} disabled={offBusy || !offDirty} style={{ ...btn('#44aaff'), opacity: (offBusy || !offDirty) ? 0.4 : 1 }}>
            {offBusy ? '保存中...' : '保存'}
          </button>
          <button onClick={() => { setOff(JSON.parse(savedOffKey)); setOffMsg(null) }} disabled={offBusy || !offDirty} style={{ ...btn('#7fa6d0'), opacity: offDirty ? 1 : 0.4 }}>戻す</button>
          <button onClick={() => { setOff([]); setOffMsg(null) }} disabled={offBusy || off.length === 0} style={{ ...miniBtn('#7fa6d0'), padding:'6px 8px', fontSize:'11px', opacity: off.length ? 1 : 0.4 }}>全部持っていく</button>
          {offMsg && <span style={{ color: offMsg.ok ? '#44ff88' : '#ff6666', fontSize:'10px' }}>{offMsg.text}</span>}
        </div>
      </div>

      <div style={{ ...box, padding:'14px' }}>
        <V2capAtbMacros macros={macros} onChange={editMacros} usable={brought} framed={false}
          dirty={macroDirty} saving={macroBusy} msg={macroMsg} onSave={saveMacros} />
      </div>
    </div>
  )
}
