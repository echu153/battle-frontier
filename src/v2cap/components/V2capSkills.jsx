import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import {
  KIND_COLOR, KIND_LABEL, KIND_TABS, isPassive, powerText, mpOf,
  filterSkills, sortSkills, SKILL_SET_SLOTS, SKILL_USE_MAX, OFF_CLASS_MULT, OFF_CLASS_MP_MULT,
} from '../../v2/lib/skills.js'
// ★名前で引くもの（名簿・想定利用MP・検証）はこの版の名簿で引く。今のⅡの名簿には新しい5職の技が無い
import { SKILL_BY_NAME, setMpCost, validateSkillSet } from '../lib/skills.js'
import { box, btn, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { totalStats } from '../lib/loadout.js'
import { learnOrderOf, learnAtOf, jobOf } from '../lib/jobs.js'

// ============================================================
// 「レベルキャップあり」版 — スキルセット
//   ・置けるのは**覚えたスキル**（どの職業で覚えたものでもよい）
//   ・いまの職業以外の技は効果0.8倍・消費MP2倍（今のⅡと同じ）
//   ・想定利用MP（Σ 消費MP×回数）が最大MPを超える編成は保存できない（サーバーも同じ判定）
//   ・一覧には、いまの職業の**まだ覚えていない技**も「JBLV◯で習得」と出す
// ============================================================
const normalize = (set) => {
  const out = Array.from({ length: SKILL_SET_SLOTS }, () => ({ name:'', uses:1 }))
  ;(set || []).slice(0, SKILL_SET_SLOTS).forEach((e, i) => { out[i] = { name: e?.name || '', uses: e?.uses || 1 } })
  return out
}
const ROW_INDENT = '28px'

export default function V2capSkills({ prof, inventory, onProfile }) {
  const [draft, setDraft] = useState(() => normalize(prof.skill_set))
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('cls')
  const [sortAsc, setSortAsc] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const learned = prof.learned || []
  const favorites = prof.favorites || []
  const savedKey = JSON.stringify(prof.skill_set || [])
  useEffect(() => { setDraft(normalize(JSON.parse(savedKey))) }, [savedKey])

  const cls = prof.class
  const jlv = jobOf(prof.jobs, cls).lv
  const maxMp = totalStats(prof, inventory).mp
  const compact = draft.filter(d => d.name).map(d => ({ name: d.name, uses: d.uses }))
  const mpCost = setMpCost(compact, cls)
  const setErr = validateSkillSet(compact, learned, maxMp, cls)

  // 一覧：覚えたスキル＋いまの職業でまだ覚えていない技（いつ覚えるかを出す）
  const order = learnOrderOf(cls)
  const at = learnAtOf(cls)
  const lockedAt = Object.fromEntries(order.map((s, i) => [s.name, at[i]]).filter(([n]) => !learned.includes(n)))
  const known = learned.map(n => SKILL_BY_NAME[n]).filter(Boolean)
  const locked = order.filter(s => lockedAt[s.name] !== undefined)
  const shown = sortSkills(filterSkills([...known, ...locked], { tab, query, favorites }), sortKey, sortAsc)

  const setSlot = (i, patch) => setDraft(d => {
    const next = normalize(d)
    next[i] = { ...next[i], ...patch }
    if (patch.name === '') next[i].uses = 1
    return next
  })
  const moveSlot = (i, dir) => setDraft(d => {
    const next = normalize(d)
    const j = i + dir
    if (j < 0 || j >= next.length) return next
    const t = next[i]; next[i] = next[j]; next[j] = t
    return next
  })
  const save = async () => {
    if (setErr) return
    setBusy(true); setError('')
    const { data, error: e } = await supabase.rpc('v2cap_set_skills', { p_set: compact })
    setBusy(false)
    if (e || !data?.ok) { setError(e?.message || data?.error || '保存に失敗しました'); return }
    onProfile(null)
  }
  const toggleFavorite = async (name) => {
    const next = favorites.includes(name) ? favorites.filter(n => n !== name) : [...favorites, name]
    const { data, error: e } = await supabase.rpc('v2cap_set_favorites', { p_names: next })
    if (e || !data?.ok) { setError(e?.message || data?.error || 'お気に入りの保存に失敗しました'); return }
    onProfile(null)
  }
  const mpLabel = (s) => (s.mpPct
    ? `MP 残りの${Math.round(Math.min(1, s.mpPct * (s.cls === cls ? 1 : OFF_CLASS_MP_MULT)) * 100)}%`
    : `MP${mpOf(cls, s)}`)

  return (
    <div style={{ fontFamily:'monospace' }}>
      <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🎯 スキルセット</div>
        <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'8px', lineHeight:'1.8' }}>
          あなたの最大MPは<span style={{ color:'#4488ff' }}>{maxMp}MP</span>です。
          いまの編成の想定利用MPは<span style={{ color: mpCost > maxMp ? '#ff4444' : '#44ffaa' }}>{mpCost}MP</span>です。
        </div>
        <div style={{ color:'#ff88cc', fontSize:'10px', marginBottom:'5px', lineHeight:'1.6' }}>
          いまの職業（{cls}）以外のスキルは、ダメージ・回復・バフ・状態異常の効果が{OFF_CLASS_MULT}倍・消費MPが{OFF_CLASS_MP_MULT}倍になります。
        </div>
        <div style={{ display:'grid', gap:'3px' }}>
          {Array.from({ length: SKILL_SET_SLOTS }).map((_, i) => {
            const row = draft[i] || { name:'', uses:1 }
            const s = SKILL_BY_NAME[row.name]
            return (
              <div key={i} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 7px', display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', flexWrap:'wrap' }}>
                <span style={{ color:'#8866cc', width:'42px' }}>スキル{i + 1}</span>
                <span style={{ flex:1, color: s ? KIND_COLOR[s.kind] : '#62789a', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {s ? s.name : '（空き）'}
                  {s && s.cls !== cls && <span style={{ color:'#ff88cc', fontSize:'9px', marginLeft:'4px' }}>×{OFF_CLASS_MULT}</span>}
                </span>
                <span style={{ color: TEXT.label, width:'62px', textAlign:'right' }}>{s ? (s.mpPct ? mpLabel(s) : `MP${mpOf(cls, s)}×${row.uses}`) : ''}</span>
                <span style={{ color: TEXT.label, width:'34px', textAlign:'right' }}>{s ? `${s.proc}%` : ''}</span>
                <input type="number" min={1} max={SKILL_USE_MAX} value={row.uses} disabled={!row.name}
                  onChange={e => setSlot(i, { uses: Math.max(1, Math.min(SKILL_USE_MAX, Number(e.target.value) || 1)) })}
                  style={{ width:'42px', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'11px', padding:'3px', textAlign:'center' }} />
                <button onClick={() => moveSlot(i, -1)} disabled={i === 0 || !row.name} style={miniBtn('#7fa6d0')}>↑</button>
                <button onClick={() => moveSlot(i, 1)} disabled={i === SKILL_SET_SLOTS - 1 || !row.name} style={miniBtn('#7fa6d0')}>↓</button>
                <button onClick={() => setSlot(i, { name:'', uses:1 })} disabled={!row.name} style={miniBtn('#aa5566')}>外す</button>
              </div>
            )
          })}
        </div>
        {(setErr || error) && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'8px' }}>⚠ {setErr || error}</div>}
        <div style={{ display:'flex', gap:'6px', marginTop:'8px' }}>
          <button onClick={save} disabled={busy || !!setErr} style={{ ...btn('#44aaff'), opacity: (busy || setErr) ? 0.4 : 1 }}>
            {busy ? '保存中...' : '保存'}
          </button>
          <button onClick={() => setDraft(normalize(prof.skill_set || []))} disabled={busy} style={btn('#7fa6d0')}>戻す</button>
        </div>
        <div style={{ color: TEXT.label, fontSize:'9px', marginTop:'8px', lineHeight:'1.8' }}>
          上から順に発動し、1周ごとに次の枠へ回ります（1→2→3→4→5→1…）。回数はその枠を使える総回数です。
          <span style={{ color:'#ffaa66' }}>不発のターンは通常攻撃になり、その枠に留まります</span>（使用回数もMPも減りません）。
          空き枠・使用回数切れ・MP不足の枠は飛ばします。
        </div>
      </div>

      <div style={{ ...box, padding:'14px' }}>
        <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'4px' }}>📖 スキル</div>
        <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'8px', lineHeight:1.7 }}>
          スキルはJBLVで覚え、職業を変えても残ります。いまの職業（{cls}・JBLV{jlv}）でまだ覚えていない技は、覚えるJBLVを出しています。
        </div>
        <div style={{ display:'flex', gap:'5px', marginBottom:'6px' }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="スキル名・職業・説明で検索"
            style={{ flex:1, background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'5px 7px', fontFamily:'monospace', fontSize:'11px', boxSizing:'border-box' }} />
          <button onClick={() => setQuery('')} style={miniBtn('#7fa6d0')}>クリア</button>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'6px' }}>
          {KIND_TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ ...miniBtn(tab === t.key ? '#44aaff' : '#62789a'), color: tab === t.key ? '#88ccff' : '#93a9be', background: tab === t.key ? '#001840' : '#000818' }}>
              {t.label}{t.key === 'fav' && favorites.length > 0 ? `(${favorites.length})` : ''}
            </button>
          ))}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'6px', fontSize:'10px', color: TEXT.label }}>
          <span>並べ替え</span>
          {[['name', 'スキル名'], ['mp', 'MP'], ['proc', '発動'], ['cls', '職業']].map(([k, label]) => (
            <button key={k} onClick={() => { if (sortKey === k) setSortAsc(a => !a); else { setSortKey(k); setSortAsc(true) } }}
              style={{ ...miniBtn(sortKey === k ? '#44aaff' : '#62789a'), color: sortKey === k ? '#88ccff' : '#93a9be' }}>
              {label}{sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : ''}
            </button>
          ))}
        </div>
        <div style={{ display:'grid', gap:'4px', maxHeight:'420px', overflowY:'auto' }}>
          {shown.length === 0 && <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px' }}>該当するスキルがありません</div>}
          {shown.map(s => {
            const fav = favorites.includes(s.name)
            const has = learned.includes(s.name)
            const pas = isPassive(s)
            return (
              <div key={s.name} style={{ background:'#000818', border:`1px solid ${draft.some(d => d.name === s.name) ? '#0055aa' : '#002244'}`, padding:'6px 8px', opacity: has || pas ? 1 : 0.5 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                  <button onClick={() => toggleFavorite(s.name)} title="お気に入り"
                    style={{ ...miniBtn(fav ? '#ffcc00' : '#62789a'), color: fav ? '#ffcc00' : '#445566', padding:'2px 5px' }}>★</button>
                  <span style={{ flex:1, color: has || pas ? KIND_COLOR[s.kind] : '#93a9be', fontSize:'12px', minWidth:0 }}>
                    {s.name}
                    <span style={{ color: TEXT.sub, fontSize:'9px', marginLeft:'5px' }}>{KIND_LABEL[s.kind]}</span>
                    <span style={{ color: s.cls === cls ? '#88ddaa' : '#ff88cc', fontSize:'9px', marginLeft:'5px' }}>
                      {s.cls}{s.cls !== cls && !pas ? `・効果${OFF_CLASS_MULT}倍/MP${OFF_CLASS_MP_MULT}倍` : ''}
                    </span>
                    {!has && !pas && <span style={{ color:'#c69a5c', fontSize:'9px', marginLeft:'5px' }}>JBLV{lockedAt[s.name]}で習得</span>}
                  </span>
                  <span style={{ color: TEXT.label, fontSize:'10px' }}>{pas ? '常時' : `${mpLabel(s)} ／ ${s.proc}%`}</span>
                </div>
                <div style={{ color:'#7fa6c0', fontSize:'10px', margin:'3px 0', lineHeight:'1.6', paddingLeft:ROW_INDENT }}>
                  {s.priority > 0 && <span style={{ color:'#a888e0', marginRight:'5px' }}>先制{s.priority >= 2 ? `+${s.priority}` : ''}</span>}
                  {s.noCrit && <span style={{ color:'#c09060', marginRight:'5px' }}>クリ無</span>}
                  {s.sureHit && <span style={{ color:'#66bb99', marginRight:'5px' }}>必中</span>}
                  {powerText(s)}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:'4px', paddingLeft:ROW_INDENT }}>
                  <span style={{ color:'#8fa8bb', fontSize:'10px', flex:1, minWidth:0, lineHeight:'1.6' }}>
                    {powerText(s) === s.desc ? '' : s.desc}
                  </span>
                  {pas && <span style={{ color:'#88ddaa', fontSize:'9px', whiteSpace:'nowrap' }}>常時・枠を使わない（{s.cls}のあいだ）</span>}
                  {has && !pas && Array.from({ length: SKILL_SET_SLOTS }).map((_, i) => {
                    const here = draft[i]?.name === s.name
                    return (
                      <button key={i} onClick={() => setSlot(i, { name: s.name, uses: here ? draft[i].uses : 1 })}
                        style={{ ...miniBtn(here ? '#44aaff' : '#62789a'), color: here ? '#88ccff' : '#93a9be' }}>{i + 1}</button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
