import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { RETRAINING_ENHANCEMENTS } from './Game'

const TYPE_COLORS = {
  '物理攻撃': '#ffcc00',
  '魔法攻撃': '#cc44ff',
  '回復':     '#44ff88',
  '強化':     '#44ccff',
  'パッシブ': '#ff8844',
}

// 状況別スキルセット。set_type は DB の skill_sets.set_type と対応
const SET_TYPES = [
  { key:'sortie',    label:'⚔ 出撃',        color:'#ffcc00' },
  { key:'papia',     label:'🌟 パピア限定',  color:'#ffaa00' },
  { key:'challenge', label:'🕯 挑戦',        color:'#ff6464' },
  { key:'raid',      label:'🐉 レイド',      color:'#ff66aa' },
  { key:'pvp',       label:'🥊 対人戦',      color:'#8ad0ff' },
]
const setTypeOf = (ss) => ss.set_type || 'sortie'

// スロット構成：パッシブ専用スロット(0)＝1個、通常スキル枠(1〜5)＝5個
const PASSIVE_SLOT = 0
const ACTIVE_SLOTS = [1, 2, 3, 4, 5]

export default function Skills() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [allSkills, setAllSkills] = useState([])
  const [playerSkills, setPlayerSkills] = useState([])
  const [skillSets, setSkillSets] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('current')
  const [setMessage, setSetMessage] = useState('')
  const [selectedSet, setSelectedSet] = useState('sortie')  // 編集中のセット種別
  const [bulkMode, setBulkMode] = useState(false)           // まとめて選択モード
  const [bulkIds, setBulkIds] = useState([])                // 一括反映で選んだスキルID（選択順）
  const [pvpClass, setPvpClass] = useState(null)            // 対人戦用クラス（null=現クラスで戦う）
  const [ownedClasses, setOwnedClasses] = useState([])      // 就いたことのあるクラス [{class_name, lv}]

  useEffect(() => { fetchAll() }, [])

  // 編集中クラス＝対人戦タブでPvPクラスが設定されていればそれ、それ以外は現クラス。
  //  このクラスのスキルを候補に出し、セット可否・再修練表示・自動習得もこのクラス基準で行う。
  useEffect(() => {
    if (!profile) return
    const ec = (selectedSet === 'pvp' && pvpClass) ? pvpClass : profile.class
    loadEditClassSkills(ec)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, selectedSet, pvpClass])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    setPvpClass(p?.pvp_class || null)

    // 就いたことのあるクラス（対人戦クラスの候補）
    const { data: cl } = await supabase.from('class_levels').select('class_name, lv').eq('player_id', user.id)
    setOwnedClasses((cl || []).filter(c => c.class_name))

    // 全習得済みスキル
    const { data: ps } = await supabase
      .from('player_skills').select('*, skills(*)')
      .eq('player_id', user.id)
    setPlayerSkills(ps || [])

    const { data: ss } = await supabase
      .from('skill_sets').select('*, skills(*)')
      .eq('player_id', user.id)
      .order('slot_order')
    setSkillSets(ss || [])
    // allSkills（候補プール）と未習得の自動習得は loadEditClassSkills（編集中クラス基準）が担当。
  }

  // 編集中クラスのスキルを候補プール(allSkills)へロードし、未習得を自動習得する。
  //  現クラス＝profile.lv でLVゲート、PvP選択クラス＝class_levelsのそのクラスLVでゲート（転職時と同じ解放）。
  //  再修練済みクラスはLV問わず全解放。
  const loadEditClassSkills = async (className) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !className || !profile) return
    const [{ data: skills }, { data: commonSkills }] = await Promise.all([
      supabase.from('skills').select('*').eq('class_name', className).order('required_lv'),
      supabase.from('skills').select('*').eq('class_name', '共通').order('required_lv'),
    ])
    setAllSkills([...(skills || [])])
    const { data: ps } = await supabase.from('player_skills').select('skill_id').eq('player_id', user.id)
    const learnedIds = (ps || []).map(s => s.skill_id)
    const rtCount = ((profile.retraining || {})[className] || 0)
    const clv = className === profile.class ? profile.lv : (ownedClasses.find(c => c.class_name === className)?.lv || 1)
    const toLearn = [...(commonSkills || []), ...(skills || [])].filter(s =>
      !learnedIds.includes(s.id) && (rtCount > 0 || s.required_lv <= clv)
    )
    for (const sk of toLearn) {
      await supabase.from('player_skills').insert({ player_id: user.id, skill_id: sk.id })
    }
    if (toLearn.length > 0) {
      const { data: ps2 } = await supabase.from('player_skills').select('*, skills(*)').eq('player_id', user.id)
      setPlayerSkills(ps2 || [])
    }
  }

  // 対人戦クラスを設定/解除（就いたことのあるクラスのみ・サーバ側で担保）。
  const changePvpClass = async (cls) => {
    setLoading(true); setSetMessage('')
    const val = cls || null
    const { data, error } = await supabase.rpc('set_pvp_class', { p_class: val })
    if (error || !data?.ok) {
      setSetMessage(data?.reason === 'class_not_owned' ? 'そのクラスにはまだ就いたことがありません。' : '対人戦クラスの設定に失敗しました。')
      setLoading(false); return
    }
    setPvpClass(val)
    setProfile(prev => prev ? { ...prev, pvp_class: val } : prev)
    setLoading(false)  // スキル候補は useEffect（pvpClass依存）が再ロード
  }

  const setSkillToSlot = async (skillId, slotOrder) => {
    // 編集中クラス（対人戦タブ＝PvPクラス／他＝現クラス）・共通・持ち越し以外のスキルはセット不可
    const ec = (selectedSet === 'pvp' && pvpClass) ? pvpClass : profile.class
    const playerSkillData = playerSkills.find(ps => ps.skill_id === skillId)
    const skillData = playerSkillData?.skills
    if (skillData && skillData.class_name !== ec && skillData.class_name !== '共通' && !playerSkillData?.is_carried_over) return
    // パッシブは専用スロット(0)のみ・1個。通常スキルはスロット1〜5のみ。
    const isPassive = skillData?.type === 'パッシブ'
    if (isPassive && slotOrder !== PASSIVE_SLOT) { setSetMessage('パッシブはパッシブ専用スロットにセットしてください。'); return }
    if (!isPassive && slotOrder === PASSIVE_SLOT) { setSetMessage('パッシブ専用スロットには通常スキルをセットできません。'); return }
    setSetMessage('')
    setLoading(true)
    // パッシブをセットするときは、旧仕様で通常スロットに残っている別パッシブも掃除（1個のみ保証）
    if (isPassive) {
      for (const op of curSets.filter(ss => ss.skills?.type === 'パッシブ' && ss.skill_id !== skillId)) {
        await supabase.from('skill_sets').delete().eq('player_id', profile.id).eq('set_type', selectedSet).eq('slot_order', op.slot_order)
      }
    }
    // 同じスキルが現在のセット内の他スロットにあれば外す（別セットには影響しない）
    await supabase.from('skill_sets').delete().eq('player_id', profile.id).eq('set_type', selectedSet).eq('skill_id', skillId)
    const existing = skillSets.find(ss => setTypeOf(ss) === selectedSet && ss.slot_order === slotOrder)
    if (existing) {
      await supabase.from('skill_sets').update({ skill_id: skillId, use_count: 1 }).eq('player_id', profile.id).eq('set_type', selectedSet).eq('slot_order', slotOrder)
    } else {
      await supabase.from('skill_sets').insert({ player_id: profile.id, set_type: selectedSet, skill_id: skillId, slot_order: slotOrder, use_count: 1 })
    }
    await fetchAll()
    setLoading(false)
  }

  const updateUseCount = async (slotOrder, useCount) => {
    setLoading(true)
    await supabase.from('skill_sets').update({ use_count: useCount }).eq('player_id', profile.id).eq('set_type', selectedSet).eq('slot_order', slotOrder)
    await fetchAll()
    setLoading(false)
  }

  const removeFromSlot = async (slotOrder) => {
    setLoading(true)
    await supabase.from('skill_sets').delete().eq('player_id', profile.id).eq('set_type', selectedSet).eq('slot_order', slotOrder)
    await fetchAll()
    setLoading(false)
  }

  // まとめて選択：スキルID のチェックをトグル（選択順を保持）
  const toggleBulk = (skillId) => {
    setSetMessage('')
    setBulkIds(prev => prev.includes(skillId) ? prev.filter(id => id !== skillId) : [...prev, skillId])
  }

  // 選択中スキルを現在のセットへ一括反映（パッシブ→専用スロット、通常→上から順に最大5枠）
  const applyBulk = async () => {
    const ec = (selectedSet === 'pvp' && pvpClass) ? pvpClass : profile.class
    const chosen = bulkIds
      .map(id => playerSkills.find(ps => ps.skill_id === id))
      .filter(Boolean)
      .filter(ps => ps.skills && (ps.skills.class_name === ec || ps.skills.class_name === '共通' || ps.is_carried_over))
    const passives = chosen.filter(ps => ps.skills.type === 'パッシブ')
    const actives = chosen.filter(ps => ps.skills.type !== 'パッシブ')
    if (passives.length > 1) { setSetMessage('パッシブは1個までです。1つだけ選んでください。'); return }
    if (actives.length > 5) { setSetMessage('通常スキルは最大5個までです。5個以内で選んでください。'); return }
    if (chosen.length === 0) { setSetMessage('反映するスキルを選んでください。'); return }
    setSetMessage('')
    setLoading(true)
    // 現在のセットを一旦クリアしてから入れ直す
    await supabase.from('skill_sets').delete().eq('player_id', profile.id).eq('set_type', selectedSet)
    const rows = []
    if (passives[0]) rows.push({ player_id: profile.id, set_type: selectedSet, skill_id: passives[0].skill_id, slot_order: PASSIVE_SLOT, use_count: 1 })
    actives.forEach((ps, i) => rows.push({ player_id: profile.id, set_type: selectedSet, skill_id: ps.skill_id, slot_order: ACTIVE_SLOTS[i], use_count: 1 }))
    if (rows.length) await supabase.from('skill_sets').insert(rows)
    setBulkIds([])
    setBulkMode(false)
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  const learnedIds = playerSkills.map(ps => ps.skill_id)
  const carriedSkillIds = playerSkills.filter(ps => ps.is_carried_over).map(ps => ps.skill_id)
  const curSets = skillSets.filter(ss => setTypeOf(ss) === selectedSet)  // 編集中セットの中身
  // 編集中クラス（対人戦タブ＝PvPクラス／他＝現クラス）。候補・セット可否・再修練表示の基準。
  const editClass = (selectedSet === 'pvp' && pvpClass) ? pvpClass : profile.class
  const editClassLv = editClass === profile.class ? profile.lv : (ownedClasses.find(c => c.class_name === editClass)?.lv || 1)
  const editRtCount = (profile.retraining || {})[editClass] || 0

  // まとめて選択中の各スキルが、どのスロットに入るか（パッシブ／通常①〜⑤）を事前計算
  const CIRCLED = ['①','②','③','④','⑤']
  const bulkLabels = {}
  {
    let activeIdx = 0
    for (const id of bulkIds) {
      const ps = playerSkills.find(p => p.skill_id === id)
      if (!ps?.skills) continue
      if (ps.skills.type === 'パッシブ') {
        bulkLabels[id] = { text: 'パッシブ', color: '#ff8844' }
      } else {
        bulkLabels[id] = { text: `通常${CIRCLED[activeIdx] || (activeIdx + 1)}`, color: activeIdx < 5 ? '#44ff88' : '#ff6464' }
        activeIdx++
      }
    }
  }

  // クラス別にグループ化
  const skillsByClass = {}
  for (const ps of playerSkills) {
    if (!ps.skills) continue
    const cls = ps.skills.class_name
    if (!skillsByClass[cls]) skillsByClass[cls] = []
    skillsByClass[cls].push(ps.skills)
  }

  // スロット1枠の表示（パッシブ専用スロット／通常スキル枠で共用）
  const renderSlot = (slot, isPassiveSlot) => {
    const set = curSets.find(ss => ss.slot_order === slot)
    return (
      <div key={slot} style={{ display:'flex', alignItems:'center', gap:'8px', border:`1px solid ${isPassiveSlot ? '#5a3a00' : '#002244'}`, background:'#000818', padding:'8px' }}>
        <span style={{ color: isPassiveSlot ? '#ff8844' : '#446688', fontSize:'11px', minWidth:'46px' }}>{isPassiveSlot ? 'パッシブ' : `セット${slot}`}</span>
        {set ? (
          <>
            <span style={{ color: TYPE_COLORS[set.skills.type] || '#88ccff', fontSize:'11px', flex:1 }}>{set.skills.name}</span>
            <span style={{ color:'#446688', fontSize:'10px' }}>{set.skills.class_name}</span>
            {set.skills.type !== 'パッシブ' ? (
              <>
                <span style={{ color:'#446688', fontSize:'10px' }}>MP{set.skills.mp_cost}</span>
                <select value={set.use_count || 1} onChange={e => updateUseCount(slot, Number(e.target.value))}
                  style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'2px' }}>
                  {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}回</option>)}
                </select>
              </>
            ) : (
              <span style={{ color:'#ff8844', fontSize:'10px' }}>常時発動</span>
            )}
            <button onClick={() => removeFromSlot(slot)} disabled={loading}
              style={{ padding:'2px 6px', background:'#001', border:'1px solid #446688', color:'#446688', cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>外す</button>
          </>
        ) : (
          <span style={{ color:'#334455', fontSize:'11px' }}>{isPassiveSlot ? 'パッシブ未設定' : '未設定'}</span>
        )}
      </div>
    )
  }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'700px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#000820' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'4px' }}>⚡ スキル</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
          クラス: <span style={{color:'#88ccff'}}>{editClass}</span>
          {editRtCount > 0 && <span style={{color:'#ffcc00'}}> {'★'.repeat(editRtCount)}</span>}
          {selectedSet === 'pvp' && pvpClass && <span style={{color:'#8ad0ff'}}>（対人戦用）</span>}
          　LV: <span style={{color:'#ffcc00'}}>{editClassLv}</span>
          <span style={{color:'#446688'}}>　再修練: <span style={{color:'#ffaa44'}}>{editRtCount}/5</span></span>
        </div>

        {/* スキルセット */}
        <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'6px' }}>スキルセット（通常スキル最大5個＋パッシブ1個）</div>
          {/* セット種別の選択 */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'8px' }}>
            {SET_TYPES.map(st => {
              const on = selectedSet === st.key
              const count = skillSets.filter(ss => setTypeOf(ss) === st.key).length
              return (
                <button key={st.key} onClick={()=>{ setSelectedSet(st.key); setSetMessage('') }}
                  style={{ flex:'1 1 auto', minWidth:'84px', padding:'6px 4px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
                    background:on?'#0a1630':'#000818', border:`1px solid ${on?st.color:'#223344'}`, color:on?st.color:'#557799' }}>
                  {st.label}{count>0?`(${count})`:''}
                </button>
              )
            })}
          </div>
          {/* 対人戦クラスの選択（対人戦タブのみ）。ステはそのまま・スキル/パッシブ/再修練がそのクラス扱いに。 */}
          {selectedSet === 'pvp' && (
            <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'8px', border:'1px solid #204a66', background:'#001526', padding:'8px' }}>
              <span style={{ color:'#8ad0ff', fontSize:'11px' }}>🥊 対人戦クラス</span>
              <select value={pvpClass || ''} onChange={e => changePvpClass(e.target.value)} disabled={loading}
                style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'11px', padding:'3px' }}>
                <option value="">現在のクラス（{profile.class}）</option>
                {ownedClasses.filter(c => c.class_name !== profile.class).map(c => {
                  const rt = (profile.retraining || {})[c.class_name] || 0
                  return <option key={c.class_name} value={c.class_name}>{c.class_name}{rt > 0 ? ` ★${rt}` : ''}</option>
                })}
              </select>
              <span style={{ color:'#557799', fontSize:'10px' }}>
                {pvpClass
                  ? `${pvpClass}として戦う（再修練 ${(profile.retraining || {})[pvpClass] || 0}/5・ステはそのまま）`
                  : '出撃と同じ現在のクラスで戦う'}
              </span>
            </div>
          )}
          <div style={{ color:'#336688', fontSize:'10px', marginBottom:'8px', lineHeight:'1.6' }}>
            パッシブは専用スロットに1個・常時発動。通常スキルは最大5個（上から順に発動）。<br/>
            <span style={{ color:'#557799' }}>状況ごとに別々のセットを組めます。</span>
            {selectedSet !== 'sortie' && <span style={{ color:'#cc9944' }}>　※このセットが空のときは「出撃」のスキルが使われます。</span>}
          </div>
          {setMessage && <div style={{ color:'#ff8844', fontSize:'10px', marginBottom:'8px', border:'1px solid #884422', padding:'6px' }}>{setMessage}</div>}
          {/* パッシブ専用スロット */}
          <div style={{ color:'#ff8844', fontSize:'10px', margin:'2px 0 4px' }}>🛡 パッシブ専用スロット（1個）</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'4px', marginBottom:'10px' }}>
            {renderSlot(PASSIVE_SLOT, true)}
          </div>
          {/* 通常スキル枠 */}
          <div style={{ color:'#88ccff', fontSize:'10px', margin:'2px 0 4px' }}>⚡ 通常スキル（最大5個・上から順に発動）</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'4px' }}>
            {ACTIVE_SLOTS.map(slot => renderSlot(slot, false))}
          </div>
        </div>

        {/* まとめて選択モード */}
        <div style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'8px', flexWrap:'wrap' }}>
          <button onClick={()=>{ setBulkMode(m=>!m); setBulkIds([]); setSetMessage('') }} disabled={loading}
            style={{ padding:'6px 12px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer',
              background:bulkMode?'#0a1630':'#000818', border:`1px solid ${bulkMode?'#44ff88':'#225544'}`, color:bulkMode?'#44ff88':'#557799' }}>
            {bulkMode ? '✓ まとめて選択中' : '☑ まとめて選択'}
          </button>
          {bulkMode && (
            <>
              <span style={{ color:'#557799', fontSize:'10px' }}>
                一覧でチェック→「{SET_TYPES.find(s=>s.key===selectedSet)?.label}」へ反映（パッシブ1＋通常5まで・選んだ順）
              </span>
              <button onClick={applyBulk} disabled={loading || bulkIds.length===0}
                style={{ padding:'6px 12px', fontFamily:'monospace', fontSize:'11px', cursor: bulkIds.length===0?'not-allowed':'pointer',
                  background:'#06220f', border:'1px solid #44ff88', color: bulkIds.length===0?'#335544':'#44ff88', opacity: bulkIds.length===0?0.6:1 }}>
                選択した{bulkIds.length}個を反映
              </button>
            </>
          )}
        </div>

        {/* タブ切り替え */}
        <div style={{ display:'flex', gap:'4px', marginBottom:'8px' }}>
          <button onClick={()=>setActiveTab('current')}
            style={{ padding:'6px 12px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer', background:activeTab==='current'?'#001840':'#000818', border:`1px solid ${activeTab==='current'?'#ffcc00':'#003366'}`, color:activeTab==='current'?'#ffcc00':'#446688' }}>
            現在のクラス
          </button>
          <button onClick={()=>setActiveTab('all')}
            style={{ padding:'6px 12px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer', background:activeTab==='all'?'#001840':'#000818', border:`1px solid ${activeTab==='all'?'#ffcc00':'#003366'}`, color:activeTab==='all'?'#ffcc00':'#446688' }}>
            全習得済みスキル
          </button>
        </div>

        {/* 現在のクラスのスキル（パッシブ含む） */}
        {activeTab === 'current' && (
          <div>
            {allSkills.map(skill => {
              const learned = learnedIds.includes(skill.id)
              const inSet = curSets.find(ss => ss.skill_id === skill.id)
              return (
                <SkillCard key={skill.id} skill={skill} learned={learned} inSet={inSet} skillSets={skillSets} loading={loading} onSet={setSkillToSlot} canSet={true}
                  bulkMode={bulkMode} bulkChecked={bulkIds.includes(skill.id)} onBulkToggle={toggleBulk} bulkLabel={bulkLabels[skill.id]} />
              )
            })}
          </div>
        )}

        {/* 全習得済みスキル（クラス別） */}
        {activeTab === 'all' && (
          <div>
            {Object.entries(skillsByClass).map(([className, skills]) => (
              <div key={className} style={{ marginBottom:'16px' }}>
                <div style={{ color:'#88ccff', fontSize:'12px', borderBottom:'1px solid #003366', paddingBottom:'4px', marginBottom:'8px' }}>
                  {className === '共通' ? '共通スキル' : className}
                  {className === '共通'
                    ? <span style={{ color:'#44ff88', fontSize:'10px', marginLeft:'8px' }}>（全クラス使用可能）</span>
                    : skills.some(s => carriedSkillIds.includes(s.id))
                      ? <span style={{ color:'#ffaa44', fontSize:'10px', marginLeft:'8px' }}>（再修練持ち越し）</span>
                      : className !== editClass && <span style={{ color:'#446688', fontSize:'10px', marginLeft:'8px' }}>（{selectedSet === 'pvp' && pvpClass ? `対人戦クラス(${editClass})` : '現在のクラス'}では使用不可）</span>
                  }
                </div>
                {skills.map(skill => {
                  const inSet = curSets.find(ss => ss.skill_id === skill.id)
                  return (
                    <SkillCard key={skill.id} skill={skill} learned={true} inSet={inSet} skillSets={skillSets} loading={loading} onSet={setSkillToSlot} canSet={className === editClass || className === '共通' || carriedSkillIds.includes(skill.id)}
                      bulkMode={bulkMode} bulkChecked={bulkIds.includes(skill.id)} onBulkToggle={toggleBulk} bulkLabel={bulkLabels[skill.id]} />
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {RETRAINING_ENHANCEMENTS[editClass] && (() => {
          const rtCount = editRtCount
          return (
            <div style={{ marginTop:'20px', border:'1px solid #443300', background:'#0a0800', padding:'12px' }}>
              <div style={{ color:'#ffaa44', fontSize:'12px', marginBottom:'8px' }}>⚡ {editClass}の再修練強化（{rtCount}/5 発動中）{selectedSet === 'pvp' && pvpClass && <span style={{ color:'#8ad0ff', fontSize:'10px', marginLeft:'6px' }}>※対人戦クラス</span>}</div>
              <div style={{ color:'#445566', fontSize:'10px', marginBottom:'8px', lineHeight:'1.6', textAlign:'left' }}>
                神殿で再修練するごとに、上から1つずつ永続強化されます。このクラスでプレイ中のみ有効。
              </div>
              {RETRAINING_ENHANCEMENTS[editClass].map((desc, i) => {
                const active = i < rtCount
                return (
                  <div key={i} style={{ fontSize:'11px', lineHeight:'1.9', color: active ? '#88ffaa' : '#556677', textAlign:'left' }}>
                    {active ? '✔' : '✖'} <span style={{ color:'#ccaa00' }}>{'★'.repeat(i+1)}</span> {desc}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function SkillCard({ skill, learned, inSet, _skillSets, loading, onSet, canSet, bulkMode, bulkChecked, onBulkToggle, bulkLabel }) {
  const bulkSelectable = bulkMode && learned && canSet
  return (
    <div onClick={bulkSelectable ? () => onBulkToggle(skill.id) : undefined}
      style={{ border:`1px solid ${bulkChecked ? '#44ff88' : (learned ? '#0044aa' : '#002244')}`, background: bulkChecked ? '#06220f' : (learned ? '#001028' : '#000818'), padding:'10px', marginBottom:'6px', opacity: learned ? 1 : 0.5, cursor: bulkSelectable ? 'pointer' : 'default' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          {bulkSelectable && (
            <input type="checkbox" checked={bulkChecked} readOnly
              style={{ accentColor:'#44ff88', width:'14px', height:'14px', cursor:'pointer' }} />
          )}
          <span style={{ fontSize:'9px', padding:'1px 4px', color: TYPE_COLORS[skill.type], border:`1px solid ${TYPE_COLORS[skill.type]}` }}>{skill.type}</span>
          <span style={{ color: learned ? '#88ccff' : '#446688', fontSize:'12px' }}>{skill.name}</span>
          {bulkChecked && bulkLabel && (
            <span style={{ fontSize:'10px', padding:'1px 6px', color:'#000', background:bulkLabel.color, fontWeight:'bold', borderRadius:'2px' }}>{bulkLabel.text}</span>
          )}
        </div>
        <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
          {skill.type !== 'パッシブ' && <span style={{ color:'#446688', fontSize:'10px' }}>MP{skill.mp_cost}</span>}
          {!bulkMode && learned && !inSet && canSet && (
            skill.type === 'パッシブ' ? (
              <button onClick={() => onSet(skill.id, PASSIVE_SLOT)} disabled={loading}
                style={{ background:'#1a0c00', border:'1px solid #ff8844', color:'#ff8844', fontFamily:'monospace', fontSize:'10px', padding:'3px 8px', cursor:'pointer' }}>パッシブにセット</button>
            ) : (
              <select onChange={e => { if (e.target.value) onSet(skill.id, Number(e.target.value)) }} defaultValue=""
                style={{ background:'#001028', border:'1px solid #0044aa', color:'#88ccff', fontFamily:'monospace', fontSize:'10px', padding:'2px' }}>
                <option value="">セットする</option>
                {[1,2,3,4,5].map(slot => <option key={slot} value={slot}>スロット{slot}</option>)}
              </select>
            )
          )}
          {inSet && <span style={{ color: skill.type === 'パッシブ' ? '#ff8844' : '#0088ff', fontSize:'10px' }}>
            {skill.type === 'パッシブ' ? `パッシブスロット（常時発動）` : `スロット${inSet.slot_order}（${inSet.use_count || 1}回）`}
          </span>}
          {!learned && <span style={{ color:'#446688', fontSize:'10px' }}>LV{skill.required_lv}で習得</span>}
        </div>
      </div>
      <div style={{ color:'#446688', fontSize:'10px', whiteSpace:'pre-line', textAlign:'left', lineHeight:'1.6' }}>{skill.description}</div>
    </div>
  )
}
