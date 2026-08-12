import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { validateName } from '../../lib/nameFilter'
import { reportDevAccess } from '../../lib/devAccess'
import {
  STAT_KEYS, STAT_DEFS, MAX_LV, ROLLS_PER_LV, JOB_CHANGE_POWER,
  calcPower, expToNext, expPerLv, canJobChange,
} from '../lib/stats.js'
import { TIER_LABEL, TIER_ORDER, TIER_COLOR, missingReqs, canBecome, reqText, proofCount } from '../lib/classes.js'
import {
  powerText, expectedDamage, expectedHeal, KIND_LABEL, KIND_COLOR, SKILL_BY_NAME,
  usableSkills, usableSkillNames, validateSkillSet, setMpCost,
  KIND_TABS, filterSkills, sortSkills,
  SKILL_SET_SLOTS, SKILL_USE_MAX,
} from '../lib/skills.js'
import { damageOf, healOf } from '../lib/combat.js'

// 編成の下書きを「5枠ぶんの配列」に揃える（空き枠も持つ）
const normalizeSet = (set) => {
  const out = Array.from({ length: SKILL_SET_SLOTS }, () => ({ name:'', uses:1 }))
  ;(set || []).slice(0, SKILL_SET_SLOTS).forEach((e, i) => { out[i] = { name: e?.name || '', uses: e?.uses || 1 } })
  return out
}

// ============================================================
// バトルフロンティアⅡ（リメイク版）ホーム — 開発限定
//  現時点の中身は「ステータスと成長」だけ。EXPを入れて上がり方を確かめるための画面。
//  ステの更新は必ずサーバー（v2_apply_exp）が行い、ここは結果を表示するだけ。
// ============================================================

const box = { border:'1px solid #0044aa', background:'#001040', fontFamily:'monospace' }
const btn = (color) => ({
  background:'#001840', border:`1px solid ${color}`, color, padding:'8px 12px',
  cursor:'pointer', fontFamily:'monospace', fontSize:'12px',
})
const miniBtn = (color) => ({
  background:'#000818', border:`1px solid ${color}`, color, padding:'3px 6px',
  cursor:'pointer', fontFamily:'monospace', fontSize:'10px', lineHeight:1,
})

export default function V2Home() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [sqlError, setSqlError] = useState('')   // supabase_v2_core.sql 未適用の案内用
  const [prof, setProf] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [classes, setClasses] = useState([])           // 職業マスタ（正はDBの v2_classes）
  const [confirmJob, setConfirmJob] = useState(null)   // 転職はステが初期値に戻るので1段確認する（選んだ職業を保持）
  const [showJobList, setShowJobList] = useState(false)
  const [draft, setDraft] = useState(() => normalizeSet([]))  // スキル編成の下書き
  const [query, setQuery] = useState('')       // スキル一覧の検索
  const [tab, setTab] = useState('all')        // 種別タブ
  const [sortKey, setSortKey] = useState('name')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { nav('/login'); return }
        const { data: p } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).maybeSingle()
        // 開発限定。非管理者は旧BFへ戻す（アクセスは管理者へ通知）
        if (!p?.is_admin) { reportDevAccess('v2_remake', 'リメイク版[開発]'); nav('/game'); return }
        if (!alive) return
        setName(p.username || '')
        const [{ data: v2, error: e2 }, { data: cls, error: e3 }] = await Promise.all([
          supabase.from('v2_profiles').select('*').eq('id', user.id).maybeSingle(),
          supabase.from('v2_classes').select('*').order('sort'),
        ])
        if (!alive) return
        if (e2 || e3) { setSqlError((e2 || e3).message || String(e2 || e3)); setLoading(false); return }
        setProf(v2 || null)
        setClasses(cls || [])
      } catch (err) {
        setSqlError(err.message || String(err))
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [nav])

  const create = async (e) => {
    e.preventDefault()
    const nameErr = validateName(name)
    if (nameErr) { setError(nameErr); return }
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_create_character', { p_username: name.trim() })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || '作成に失敗しました'); return }
    setProf(data.profile)
  }

  const gainExp = async (amount) => {
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_debug_gain_exp', { p_amount: amount })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || 'EXPの付与に失敗しました'); return }
    const before = prof
    setProf(data.profile)
    const gains = data.gains || {}
    setLog(l => [{
      id: `${Date.now()}-${Math.random()}`,
      amount,
      ups: data.level_ups,
      lvFrom: before?.lv, lvTo: data.profile.lv,
      gains: STAT_KEYS.filter(k => gains[k] > 0).map(k => `${STAT_DEFS[k].label}+${gains[k]}`).join(' / ') || 'なし',
    }, ...l].slice(0, 12))
  }

  const changeJob = async (classId) => {
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_change_job', { p_class: classId })
    setBusy(false); setConfirmJob(null)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || '転職に失敗しました'); return }
    setProf(data.profile)
    setShowJobList(false)
    const alloc = data.alloc || {}
    setLog(l => [{
      id: `${Date.now()}-${Math.random()}`,
      job: data.job_changes,
      className: data.class,
      points: data.points,
      usedProof: data.used_proof,
      learned: data.learned,
      gains: STAT_KEYS.filter(k => alloc[k] > 0).map(k => `${STAT_DEFS[k].label}+${alloc[k]}`).join(' / ') || 'なし',
    }, ...l].slice(0, 12))
  }

  const grantProofs = async () => {
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_debug_grant_proofs')
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || '証の付与に失敗しました'); return }
    setProf(data.profile)
  }

  // 転職条件の判定に使う状態（サーバー側 v2_change_job と同じ条件を画面にも出す）
  const jobState = { jobCounts: prof?.job_counts || {}, proofs: prof?.proofs || {} }

  // ===== スキル編成 =====
  // 使えるスキル ＝ いまの職業のスキル ∪ 習得済み（転職のたびに1つ増える）
  const learned = prof?.skills || []
  const usable = prof ? usableSkills(prof.class, learned) : []
  const usableNames = prof ? usableSkillNames(prof.class, learned) : []
  const favorites = prof?.favorites || []
  const compact = draft.filter(d => d.name).map(d => ({ name: d.name, uses: d.uses }))
  const mpCost = setMpCost(compact)                    // 想定利用MP（Σ 消費MP×回数）
  const setErr = prof ? validateSkillSet(compact, usableNames, prof.mp) : null
  const shownSkills = sortSkills(filterSkills(usable, { tab, query, favorites }), sortKey, sortAsc)

  // 保存済みの編成が変わったときだけ下書きへ反映する（EXP付与などで下書きを消さない）
  const savedSetKey = JSON.stringify(prof?.skill_set || [])
  useEffect(() => { setDraft(normalizeSet(JSON.parse(savedSetKey))) }, [savedSetKey])

  const setSlot = (i, patch) => setDraft(d => {
    const next = normalizeSet(d)
    // 同じスキルが別の枠にあれば、そちらは空ける（重複は保存できないため）
    if (patch.name) next.forEach((e, j) => { if (j !== i && e.name === patch.name) next[j] = { name:'', uses:1 } })
    next[i] = { ...next[i], ...patch }
    if (patch.name === '') next[i].uses = 1
    return next
  })

  // 発動順の入れ替え（↑↓）
  const moveSlot = (i, dir) => setDraft(d => {
    const next = normalizeSet(d)
    const j = i + dir
    if (j < 0 || j >= next.length) return next
    const t = next[i]; next[i] = next[j]; next[j] = t
    return next
  })

  const toggleFavorite = async (name) => {
    const next = favorites.includes(name) ? favorites.filter(n => n !== name) : [...favorites, name]
    setProf(p => ({ ...p, favorites: next }))   // 先に画面へ反映（保存は裏で）
    const { data, error: rpcErr } = await supabase.rpc('v2_set_favorites', { p_names: next })
    if (rpcErr || !data?.ok) { setError(rpcErr?.message || data?.error || 'お気に入りの保存に失敗しました'); return }
    setProf(data.profile)
  }

  const saveSkills = async () => {
    if (setErr) return
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2_set_skills', { p_set: compact })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    if (!data?.ok) { setError(data?.error || '保存に失敗しました'); return }
    setProf(data.profile)
    setDraft(normalizeSet(data.profile.skill_set))
  }

  if (loading) {
    return <div style={{ minHeight:'100vh', background:'#000820', color:'#0088ff', fontFamily:'monospace', padding:'40px', textAlign:'center' }}>読み込み中...</div>
  }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'560px', margin:'0 auto' }}>

        {/* ヘッダ */}
        <div style={{ ...box, padding:'12px 14px', marginBottom:'12px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
          <div>
            <div style={{ color:'#ffcc00', fontSize:'15px', letterSpacing:'2px' }}>BATTLE FRONTIER Ⅱ</div>
            <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>リメイク版 <span style={{ color:'#8877aa' }}>[開発]</span></div>
          </div>
          <button onClick={() => nav('/game')} style={btn('#446688')}>← 旧版へ戻る</button>
        </div>

        {/* SQL未適用の案内 */}
        {sqlError && (
          <div style={{ ...box, borderColor:'#aa4400', background:'#1a0a00', padding:'14px', color:'#ffaa66', fontSize:'12px', lineHeight:'1.9' }}>
            <div style={{ color:'#ff8844', marginBottom:'6px' }}>⚠ v2のテーブルが見つかりません</div>
            <div><code style={{ color:'#ffcc88' }}>supabase_v2_core.sql</code> をSupabaseで実行してください。</div>
            <div style={{ color:'#886644', fontSize:'10px', marginTop:'8px', wordBreak:'break-all' }}>{sqlError}</div>
          </div>
        )}

        {/* キャラクター作成 */}
        {!sqlError && !prof && (
          <form onSubmit={create} style={{ ...box, padding:'16px' }}>
            <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'10px' }}>キャラクターを作成</div>
            <div style={{ color:'#446688', fontSize:'11px', marginBottom:'4px' }}>冒険者名</div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={16} required
              style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', boxSizing:'border-box', marginBottom:'10px' }} />
            {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}
            <button type="submit" disabled={busy} style={{ ...btn('#ffcc00'), width:'100%', padding:'10px' }}>
              {busy ? '作成中...' : '▶ はじめる'}
            </button>
            <div style={{ color:'#446688', fontSize:'10px', marginTop:'10px', lineHeight:'1.8' }}>
              旧版のキャラクターとは完全に別のデータです（同じアカウントで両方遊べます）。
            </div>
          </form>
        )}

        {/* ステータス */}
        {prof && (
          <>
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:'10px' }}>
                <div>
                  <span style={{ color:'#88ccff', fontSize:'14px' }}>{prof.username}</span>
                  <span style={{ color:TIER_COLOR[classes.find(c => c.id === prof.class)?.tier] || '#88aaff', fontSize:'11px', marginLeft:'8px' }}>{prof.class}</span>
                  {prof.job_changes > 0 && <span style={{ color:'#ff88cc', fontSize:'10px', marginLeft:'6px' }}>転職{prof.job_changes}回</span>}
                </div>
                <div style={{ color:'#ffcc00', fontSize:'13px' }}>LV {prof.lv}{prof.lv >= MAX_LV && <span style={{ color:'#ff8844', fontSize:'10px', marginLeft:'4px' }}>MAX</span>}</div>
              </div>

              {/* EXPバー。必要EXPは転職回数で重くなる */}
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'3px' }}>
                EXP {prof.exp} / {expToNext(prof.lv, prof.job_changes) || '—'}
              </div>
              <div style={{ height:'6px', background:'#001028', border:'1px solid #002244', marginBottom:'12px' }}>
                <div style={{ height:'100%', width:`${Math.min(100, (prof.exp / expPerLv(prof.job_changes)) * 100)}%`, background:'#44aaff' }} />
              </div>

              {/* 戦闘力 */}
              <div style={{ background:'#000818', border:'1px solid #002244', padding:'8px 10px', marginBottom:'12px', display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'#446688', fontSize:'11px' }}>戦闘力</span>
                <span style={{ color:'#ffcc00', fontSize:'14px' }}>{calcPower(prof)}</span>
              </div>

              {/* ステータス8種 */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'6px' }}>
                {STAT_KEYS.map(k => {
                  const d = STAT_DEFS[k]
                  return (
                    <div key={k} title={d.desc} style={{ background:'#000818', border:'1px solid #002244', padding:'7px 9px', display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                      <span style={{ color:'#446688', fontSize:'11px' }}>
                        <span style={{ color:d.color }}>{d.label}</span>
                        <span style={{ fontSize:'9px', marginLeft:'4px' }}>{d.jp}</span>
                      </span>
                      <span style={{ color:d.color, fontSize:'13px' }}>{prof[k]}</span>
                    </div>
                  )
                })}
              </div>

              <div style={{ color:'#446688', fontSize:'10px', marginTop:'10px', lineHeight:'1.8' }}>
                LVアップごとに{ROLLS_PER_LV}回抽選し、当たったステータスが上がります（HPは+8・MPは+3・その他は+1）。
                どのステに当たっても戦闘力の上がり幅は同じです。
              </div>
            </div>

            {/* スキル編成（並び順＝発動順・使用回数を配る） */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🎯 スキルセット</div>
              <div style={{ color:'#446688', fontSize:'10px', marginBottom:'8px', lineHeight:'1.8' }}>
                あなたの最大MPは<span style={{ color:'#4488ff' }}>{prof.mp}MP</span>です。
                いまの編成の想定利用MPは<span style={{ color: mpCost > prof.mp ? '#ff4444' : '#44ffaa' }}>{mpCost}MP</span>です。
              </div>
              <div style={{ display:'grid', gap:'3px' }}>
                {Array.from({ length: SKILL_SET_SLOTS }).map((_, i) => {
                  const row = draft[i] || { name:'', uses:1 }
                  const s = SKILL_BY_NAME[row.name]
                  const cost = (s?.mp || 0) * (row.uses || 0)
                  return (
                    <div key={i} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 7px', display:'flex', alignItems:'center', gap:'5px', fontSize:'11px' }}>
                      <span style={{ color:'#8866cc', width:'42px' }}>スキル{i + 1}</span>
                      <span style={{ flex:1, color: s ? KIND_COLOR[s.kind] : '#334455', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {s ? s.name : '（空き）'}
                      </span>
                      <span style={{ color: cost > prof.mp ? '#ff4444' : '#446688', width:'56px', textAlign:'right' }}>
                        {s ? `MP${s.mp}×${row.uses}` : ''}
                      </span>
                      <span style={{ color:'#446688', width:'34px', textAlign:'right' }}>{s ? `${s.proc}%` : ''}</span>
                      <input type="number" min={1} max={SKILL_USE_MAX} value={row.uses} disabled={!row.name}
                        onChange={e => setSlot(i, { uses: Math.max(1, Math.min(SKILL_USE_MAX, Number(e.target.value) || 1)) })}
                        style={{ width:'42px', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'11px', padding:'3px', textAlign:'center' }} />
                      <button onClick={() => moveSlot(i, -1)} disabled={i === 0 || !row.name} style={miniBtn('#446688')}>↑</button>
                      <button onClick={() => moveSlot(i, 1)} disabled={i === SKILL_SET_SLOTS - 1 || !row.name} style={miniBtn('#446688')}>↓</button>
                      <button onClick={() => setSlot(i, { name:'', uses:1 })} disabled={!row.name} style={miniBtn('#aa5566')}>外す</button>
                    </div>
                  )
                })}
              </div>
              {setErr && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'8px' }}>⚠ {setErr}</div>}
              <div style={{ display:'flex', gap:'6px', marginTop:'8px' }}>
                <button onClick={saveSkills} disabled={busy || !!setErr} style={{ ...btn('#44aaff'), opacity: (busy || setErr) ? 0.4 : 1 }}>
                  {busy ? '保存中...' : '保存'}
                </button>
                <button onClick={() => setDraft(normalizeSet(prof.skill_set || []))} disabled={busy} style={btn('#446688')}>戻す</button>
              </div>
              <div style={{ color:'#446688', fontSize:'9px', marginTop:'8px', lineHeight:'1.8' }}>
                上から順に発動し、1周ごとに次の枠へ回ります（1→2→3→4→5→1…）。回数はその枠を使える総回数です。
                <span style={{ color:'#ffaa66' }}>不発のターンは通常攻撃になり、その枠に留まります</span>（使用回数もMPも減りません）。
                空き枠・使用回数切れ・MP不足の枠は飛ばします。
              </div>
            </div>

            {/* 習得スキル（検索・絞り込み・お気に入り） */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px' }}>
                📖 習得スキル <span style={{ color:'#446688', fontSize:'10px' }}>{prof.class}のスキル{learned.length > 0 ? ` ＋ 習得${learned.length}個` : ''}</span>
              </div>

              {/* 検索 */}
              <div style={{ display:'flex', gap:'5px', marginBottom:'6px' }}>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="スキル名・職業・説明で検索"
                  style={{ flex:1, background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'5px 7px', fontFamily:'monospace', fontSize:'11px', boxSizing:'border-box' }} />
                <button onClick={() => setQuery('')} style={miniBtn('#446688')}>クリア</button>
              </div>

              {/* 種別タブ */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'6px' }}>
                {KIND_TABS.map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    style={{ ...miniBtn(tab === t.key ? '#44aaff' : '#334455'), color: tab === t.key ? '#88ccff' : '#556677', background: tab === t.key ? '#001840' : '#000818' }}>
                    {t.label}{t.key === 'fav' && favorites.length > 0 ? `(${favorites.length})` : ''}
                  </button>
                ))}
              </div>

              {/* 並べ替え */}
              <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'6px', fontSize:'10px', color:'#446688' }}>
                <span>並べ替え</span>
                {[['name', 'スキル名'], ['mp', 'MP'], ['proc', '発動'], ['cls', '職業']].map(([k, label]) => (
                  <button key={k} onClick={() => { if (sortKey === k) setSortAsc(a => !a); else { setSortKey(k); setSortAsc(true) } }}
                    style={{ ...miniBtn(sortKey === k ? '#44aaff' : '#334455'), color: sortKey === k ? '#88ccff' : '#556677' }}>
                    {label}{sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : ''}
                  </button>
                ))}
              </div>

              {/* 一覧 */}
              <div style={{ display:'grid', gap:'4px', maxHeight:'420px', overflowY:'auto' }}>
                {shownSkills.length === 0 && <div style={{ color:'#446688', fontSize:'11px', padding:'8px' }}>該当するスキルがありません</div>}
                {shownSkills.map(s => {
                  const dmg = expectedDamage(s, prof, prof, damageOf)
                  const heal = expectedHeal(s, prof, healOf)
                  const fav = favorites.includes(s.name)
                  const inSet = draft.findIndex(d => d?.name === s.name)
                  return (
                    <div key={s.name} style={{ background:'#000818', border:`1px solid ${inSet >= 0 ? '#0055aa' : '#002244'}`, padding:'6px 8px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                        <button onClick={() => toggleFavorite(s.name)} title="お気に入り"
                          style={{ ...miniBtn(fav ? '#ffcc00' : '#334455'), color: fav ? '#ffcc00' : '#445566', padding:'2px 5px' }}>★</button>
                        <span style={{ flex:1, color:KIND_COLOR[s.kind], fontSize:'12px', minWidth:0 }}>
                          {s.name}
                          <span style={{ color:'#556677', fontSize:'9px', marginLeft:'5px' }}>{KIND_LABEL[s.kind]}</span>
                          {s.cls !== prof.class && <span style={{ color:'#ff88cc', fontSize:'9px', marginLeft:'5px' }}>{s.cls}</span>}
                        </span>
                        <span style={{ color:'#446688', fontSize:'10px' }}>MP{s.mp} ／ {s.proc}%</span>
                      </div>
                      <div style={{ color:'#556677', fontSize:'9px', margin:'3px 0' }}>
                        {s.priority > 0 && <span style={{ color:'#8866cc', marginRight:'5px' }}>先制</span>}
                        {s.noCrit && <span style={{ color:'#886644', marginRight:'5px' }}>クリ無</span>}
                        {s.sureHit && <span style={{ color:'#448866', marginRight:'5px' }}>必中</span>}
                        {powerText(s)}
                        {dmg > 0 && <span style={{ color:'#88ddaa', marginLeft:'6px' }}>期待{dmg}</span>}
                        {heal > 0 && <span style={{ color:'#44ff88', marginLeft:'6px' }}>期待{heal}{s.mpRegen ? 'MP' : '回復'}</span>}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                        <span style={{ color:'#334455', fontSize:'9px', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.desc}</span>
                        {Array.from({ length: SKILL_SET_SLOTS }).map((_, i) => (
                          <button key={i} onClick={() => setSlot(i, { name: s.name, uses: draft[i]?.name === s.name ? draft[i].uses : 1 })}
                            disabled={inSet >= 0 && inSet !== i}
                            style={{ ...miniBtn(inSet === i ? '#44aaff' : '#334455'), color: inSet === i ? '#88ccff' : '#556677', opacity: (inSet >= 0 && inSet !== i) ? 0.3 : 1 }}>
                            {i + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ color:'#446688', fontSize:'9px', marginTop:'8px', lineHeight:'1.8' }}>
                右の1〜5のボタンでその枠に入れます。「期待」は自分と同じステータスの相手に対する1ターンの概算です。
              </div>
            </div>

            {/* 転職（LV上限で周回する） */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px', borderColor: canJobChange(prof.lv) ? '#aa4488' : '#0044aa' }}>
              <div style={{ color:'#ff88cc', fontSize:'12px', marginBottom:'8px' }}>🔄 転職</div>
              <div style={{ color:'#446688', fontSize:'10px', lineHeight:'1.9', marginBottom:'10px' }}>
                LV{MAX_LV}で転職できます。LV1に戻り、ステータスは初期値へリセットされたうえで
                <span style={{ color:'#ff88cc' }}> 転職回数×{JOB_CHANGE_POWER}</span>（＝{JOB_CHANGE_POWER / ROLLS_PER_LV}LV分）の戦闘力がランダムに振り分けられます。
                振り分けは毎回引き直しです。転職を重ねるほどLVアップに必要なEXPも重くなります。
              </div>
              {!canJobChange(prof.lv) && (
                <div style={{ color:'#446688', fontSize:'11px', marginBottom:'8px' }}>LV{MAX_LV}まであと{MAX_LV - prof.lv}</div>
              )}

              {/* 転職先の一覧。LV100未満でも条件の確認用に開ける */}
              <button onClick={() => { setShowJobList(v => !v); setConfirmJob(null) }} style={btn(canJobChange(prof.lv) ? '#ff88cc' : '#446688')}>
                {showJobList ? '▼ 職業一覧を閉じる' : `▶ 職業一覧（${classes.filter(c => canBecome(c, jobState)).length}職が選択可）`}
              </button>

              {showJobList && (
                <div style={{ marginTop:'10px' }}>
                  {TIER_ORDER.map(tier => {
                    const list = classes.filter(c => c.tier === tier)
                    if (list.length === 0) return null
                    return (
                      <div key={tier} style={{ marginBottom:'10px' }}>
                        <div style={{ color:TIER_COLOR[tier], fontSize:'10px', letterSpacing:'2px', marginBottom:'4px' }}>{TIER_LABEL[tier]}</div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'4px' }}>
                          {list.map(c => {
                            const ok = canBecome(c, jobState)
                            const miss = missingReqs(c, jobState)
                            const selectable = ok && canJobChange(prof.lv)
                            return (
                              <div key={c.id} style={{ background:'#000818', border:`1px solid ${ok ? TIER_COLOR[tier] : '#002244'}`, padding:'7px 9px' }}>
                                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
                                  <span style={{ color: ok ? TIER_COLOR[tier] : '#446688', fontSize:'12px' }}>
                                    {c.id}{prof.job_counts?.[c.id] > 0 && <span style={{ color:'#556677', fontSize:'9px', marginLeft:'5px' }}>×{prof.job_counts[c.id]}</span>}
                                    {c.req_proof && <span style={{ color: proofCount(jobState.proofs, c.req_proof) > 0 ? '#ffaa44' : '#664433', fontSize:'9px', marginLeft:'6px' }}>証{proofCount(jobState.proofs, c.req_proof)}個</span>}
                                  </span>
                                  {selectable && confirmJob !== c.id && (
                                    <button onClick={() => setConfirmJob(c.id)} disabled={busy} style={{ ...btn(TIER_COLOR[tier]), padding:'4px 8px', fontSize:'11px' }}>転職</button>
                                  )}
                                </div>
                                <div style={{ color: ok ? '#556677' : '#775544', fontSize:'9px', marginTop:'3px' }}>
                                  {ok ? reqText(c) : `未達：${miss.join(' ／ ')}`}
                                </div>
                                {confirmJob === c.id && (
                                  <div style={{ marginTop:'6px' }}>
                                    <div style={{ color:'#ffaa66', fontSize:'10px', marginBottom:'6px' }}>
                                      いま育てたステータスは失われます。{c.id}に転職しますか？（{prof.job_changes + 1}回目・戦闘力{(prof.job_changes + 1) * JOB_CHANGE_POWER}分）
                                    </div>
                                    <div style={{ display:'flex', gap:'6px' }}>
                                      <button onClick={() => changeJob(c.id)} disabled={busy} style={{ ...btn('#ff88cc'), padding:'4px 10px', fontSize:'11px' }}>{busy ? '転職中...' : 'はい'}</button>
                                      <button onClick={() => setConfirmJob(null)} disabled={busy} style={{ ...btn('#446688'), padding:'4px 10px', fontSize:'11px' }}>やめる</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ color:'#446688', fontSize:'9px', lineHeight:'1.8' }}>
                    ×N＝その職業で転職した回数。上位職の条件はこの回数を見ます。
                    証は転職のときに1個消費します（同じ職業に戻るにはもう1個要ります）。
                    職業による能力差はまだありません（スキルを実装するときに付けます）。
                  </div>
                </div>
              )}
            </div>

            {/* 動作確認用のEXP付与 */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ color:'#ffaa44', fontSize:'11px', marginBottom:'8px' }}>🧪 EXP付与 <span style={{ color:'#8877aa', fontSize:'9px' }}>[開発]</span></div>
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                {[60, 600, 6000].map(a => (
                  <button key={a} onClick={() => gainExp(a)} disabled={busy || prof.lv >= MAX_LV} style={{ ...btn('#44ffaa'), opacity: (busy || prof.lv >= MAX_LV) ? 0.4 : 1 }}>
                    EXP +{a}
                  </button>
                ))}
                {/* 証の入手手段がまだ無いので、条件確認用にまとめて配る */}
                <button onClick={grantProofs} disabled={busy} style={btn('#ffaa44')}>証をすべて入手</button>
              </div>
              {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'8px' }}>⚠ {error}</div>}
              {prof.lv >= MAX_LV && <div style={{ color:'#ff8844', fontSize:'10px', marginTop:'8px' }}>LV{MAX_LV}に到達しています。EXPは入りません（転職してください）。</div>}
            </div>

            {/* 上昇ログ */}
            {log.length > 0 && (
              <div style={{ ...box, padding:'14px' }}>
                <div style={{ color:'#88ccff', fontSize:'11px', marginBottom:'8px' }}>成長ログ</div>
                {log.map(l => (
                  <div key={l.id} style={{ borderBottom:'1px solid #002244', padding:'6px 0', fontSize:'11px', lineHeight:'1.7' }}>
                    {l.job ? (
                      <>
                        <span style={{ color:'#ff88cc' }}>🔄 転職{l.job}回目 → {l.className}</span>
                        <span style={{ color:'#446688', marginLeft:'8px', fontSize:'10px' }}>戦闘力{l.points}分を振り分け</span>
                        {l.usedProof && <span style={{ color:'#ffaa44', marginLeft:'6px', fontSize:'9px' }}>{l.usedProof}を1個消費</span>}
                        {l.learned && <div style={{ color:'#44aaff', fontSize:'10px' }}>📖 {l.learned}を習得した！</div>}
                      </>
                    ) : (
                      <>
                        <span style={{ color:'#446688' }}>EXP+{l.amount}</span>
                        <span style={{ color:'#ffcc00', marginLeft:'8px' }}>LV {l.lvFrom} → {l.lvTo}</span>
                        <span style={{ color:'#446688', marginLeft:'6px', fontSize:'10px' }}>（{l.ups}回）</span>
                      </>
                    )}
                    <div style={{ color:'#88ddaa', fontSize:'10px' }}>{l.gains}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
