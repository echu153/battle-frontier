// ============================================================
// 領地（国・建国）システム  ※is_admin限定で先行公開
//   ・9カ国構成（うち1つは固定の「非加盟国」）。最大8カ国をプレイヤーが建国できる。
//   ・建国: キャラクターLV100以上＆非加盟国に居ること。
//   ・亡命: 他国への加入/離脱は1週間に1回まで。
//   ・領地拡大: 1時間に1回・総合力に応じて獲得量が変わる。
//   ・階級は貢献度で自動決定（建国者=元帥固定）。
//   ・全ての時刻・操作は SECURITY DEFINER RPC 経由（supabase_territory.sql）。
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { calcEffectiveTotal } from '../lib/stats'
import { charmPlayerBonus, petPlayerBonus } from '../constants/pets'
import {
  FOUND_MIN_CHARLV, MAX_COUNTRIES, rankOrder, rankProgress,
  EXPAND_COOLDOWN_MS, fmtRemain, REGIONS,
  AREA_META, computeAreaControl, rankColor,
} from '../lib/territory'

const EMBLEMS = ['🏰','⚔','🦅','🐺','🌙','☀','🔥','❄','🐉','⭐','🛡','👑']
const MAP_IMG = '/ryouti.png'

export default function Territory() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState(null)            // profile（自分）
  const [power, setPower] = useState(0)         // 総合力
  const [countries, setCountries] = useState([])
  const [members, setMembers] = useState([])    // 全プレイヤーの所属/階級（軽量）
  const [catRows, setCatRows] = useState([])    // country_area_territory 全行
  const [powerMap, setPowerMap] = useState({})  // playerId -> 総合力
  const [npcMembers, setNpcMembers] = useState([])  // NPC国のダミー国民
  const [npcDetail, setNpcDetail] = useState(null)  // 詳細表示中のNPC国民
  const [expandArea, setExpandArea] = useState(null)  // 領地拡大の出撃エリア
  const [tab, setTab] = useState('home')        // 'home'(自国) | 'world'(世界地図)
  const [expandMsg, setExpandMsg] = useState(null)  // 領地拡大の結果（ボタン下に表示）
  const [openRosters, setOpenRosters] = useState({})  // 国一覧の国民展開状態 {countryId:true}
  const [descEdit, setDescEdit] = useState(false)     // 自国説明文の編集中
  const [descInput, setDescInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [, setTick] = useState(0)
  const offsetRef = useRef(0)
  const expandBusyRef = useRef(false)  // 領地拡大の連打ガード（state更新前の多重発火を同期的に弾く）
  // 建国フォーム
  const [fName, setFName] = useState('')
  const [fEmblem, setFEmblem] = useState('🏰')
  const [fDesc, setFDesc] = useState('')
  const [fRegion, setFRegion] = useState(null)  // 選択した大陸(region 1〜9)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { nav('/login'); return }
      const { data: prof } = await supabase.from('profiles')
        .select('*').eq('id', user.id).maybeSingle()
      if (!prof) { nav('/game'); return }
      try {
        await supabase.rpc('tick_npc_countries')  // NPC国の領地を経過時間ぶん加算（未適用でも続行）
      } catch { /* RPC未適用などは無視 */ }
      try {
        await loadAll(prof)
      } catch (e) {
        // 読み込み失敗でも画面は表示する（無限「読み込み中」を防ぐ）
        setMe(prof)
        flash(`一部の読み込みに失敗しました: ${e?.message || e}`, '#ff5555')
      } finally {
        setLoading(false)
      }
    })()
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // 自分の総合力を算出（街/ランキングと同じ calcEffectiveTotal）
  const computePower = async (prof) => {
    try {
      const [{ data: eq }, { data: pf }, { data: pets }] = await Promise.all([
        supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', prof.id).eq('equipped', true),
        supabase.from('proficiency').select('player_id, equipment_id, prof_lv').eq('player_id', prof.id),
        supabase.from('pets').select('owner_id, species, level, evolved, charm_id').eq('owner_id', prof.id).eq('is_active', true),
      ])
      const activePet = (pets || [])[0] || null
      const petStat = activePet ? petPlayerBonus(activePet) : null
      let petCharm = null
      const charmId = (pets || []).find(p => p.charm_id)?.charm_id
      if (charmId) {
        const { data: c } = await supabase.from('player_charms').select('*').eq('id', charmId).maybeSingle()
        if (c) petCharm = charmPlayerBonus(c)
      }
      let tb = null
      if (prof.ability_title_id) {
        const { data: t } = await supabase.from('titles').select('*').eq('id', prof.ability_title_id).maybeSingle()
        tb = t || null
      }
      return calcEffectiveTotal({ ...prof, petStat, petCharm }, eq || [], pf || [], tb)
    } catch { return 0 }
  }

  // 複数メンバーの総合力を一括算出（ランキングと同じ calcEffectiveTotal）
  const computePowers = async (list) => {
    const ids = list.map(m => m.id)
    if (!ids.length) return {}
    try {
      const [{ data: eqs }, { data: profs }, { data: pets }] = await Promise.all([
        supabase.from('player_equipment').select('*, weapons(*)').in('player_id', ids).eq('equipped', true),
        supabase.from('proficiency').select('player_id, equipment_id, prof_lv').in('player_id', ids),
        supabase.from('pets').select('owner_id, species, level, evolved, charm_id').in('owner_id', ids).eq('is_active', true),
      ])
      const charmIds = [...new Set((pets || []).map(p => p.charm_id).filter(Boolean))]
      const charmById = {}
      if (charmIds.length) {
        const { data: cr } = await supabase.from('player_charms').select('*').in('id', charmIds)
        for (const c of (cr || [])) charmById[c.id] = c
      }
      const charmMap = {}
      const petStatMap = {}
      for (const pet of (pets || [])) {
        petStatMap[pet.owner_id] = petPlayerBonus(pet)
        if (pet.charm_id && charmById[pet.charm_id]) charmMap[pet.owner_id] = charmPlayerBonus(charmById[pet.charm_id])
      }
      const titleIds = [...new Set(list.map(m => m.ability_title_id).filter(Boolean))]
      const titleMap = {}
      if (titleIds.length) {
        const { data: ts } = await supabase.from('titles').select('*').in('id', titleIds)
        for (const t of (ts || [])) titleMap[t.id] = t
      }
      const map = {}
      for (const m of list) {
        const eq = (eqs || []).filter(e => e.player_id === m.id)
        const pf = (profs || []).filter(x => x.player_id === m.id)
        const tb = m.ability_title_id ? titleMap[m.ability_title_id] : null
        map[m.id] = calcEffectiveTotal({ ...m, petStat: petStatMap[m.id] || null, petCharm: charmMap[m.id] || null }, eq, pf, tb)
      }
      return map
    } catch { return {} }
  }

  const loadAll = async (prof) => {
    const [{ data: cs }, { data: mem }, { data: cat }, { data: npc }] = await Promise.all([
      supabase.from('countries').select('*'),
      supabase.from('profiles').select('id, username, avatar_url, country_id, country_rank, country_contrib, lv, char_lv, class, hp_max, mp_max, atk, def, matk, mdef, spd, retraining, museum_atk, museum_def, museum_matk, museum_mdef, museum_spd, museum_hp, museum_mp, fishing_atk, fishing_def, fishing_matk, fishing_mdef, fishing_spd, fishing_hp, fishing_mp, ability_title_id'),
      supabase.from('country_area_territory').select('country_id, area_id, amount'),
      supabase.from('npc_country_members').select('id, country_id, name, rank, class, power, contrib, stats, sort'),
    ])
    setCountries(cs || [])
    setMembers(mem || [])
    setCatRows(cat || [])
    setNpcMembers(npc || [])
    setPowerMap(await computePowers((mem || []).filter(m => m.country_id)))
    const { data: fresh } = await supabase.from('profiles').select('*').eq('id', prof.id).maybeSingle()
    const p = fresh || prof
    setMe(p)
    setPower(await computePower(p))
    // 出撃エリアの初期選択（解放済みエリアの先頭）
    const unlocked = (p.unlocked_areas && p.unlocked_areas.length ? p.unlocked_areas : [1])
    setExpandArea(prev => (prev && unlocked.includes(prev)) ? prev : unlocked[0])
    offsetRef.current = 0
  }

  const flash = (t, c = '#ffcc44') => { setMsg({ t, c }); setTimeout(() => setMsg(null), 3200) }
  const reload = async () => { if (me) await loadAll(me) }

  const unaffiliated = countries.find(c => c.is_unaffiliated)
  const affiliated = countries.filter(c => !c.is_unaffiliated)
  const myCountry = me?.country_id ? countries.find(c => c.id === me.country_id) : null
  const inUnaffiliated = !myCountry || myCountry.is_unaffiliated
  const npcMembersOf = (cid) => npcMembers.filter(m => m.country_id === cid)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
  const memberCount = (cid) => members.filter(m => m.country_id === cid).length + npcMembersOf(cid).length
  const membersOf = (cid) => members.filter(m => m.country_id === cid)
    .sort((a, b) => rankOrder(b.country_rank) - rankOrder(a.country_rank))

  // 領地拡大クールダウン（is_admin は開発中CDなし）
  const lastExpand = me?.last_expand_at ? new Date(me.last_expand_at).getTime() : 0
  const expandRemain = Math.max(0, lastExpand + EXPAND_COOLDOWN_MS - Date.now())
  // 亡命後ロック（この時刻まで領地システム利用不可。is_admin は除外）
  const lockUntil = me?.territory_locked_until ? new Date(me.territory_locked_until).getTime() : 0
  const lockRemain = me?.is_admin ? 0 : Math.max(0, lockUntil - Date.now())
  const locked = lockRemain > 0
  // 到達済みエリア判定（未到達は名前を伏せる）
  const myUnlockedSet = new Set(me?.unlocked_areas?.length ? me.unlocked_areas : [1])
  const areaLabel = (id) => myUnlockedSet.has(id) ? (AREA_META.find(a => a.id === id)?.name || `エリア${id}`) : '？？？'

  const canFound = inUnaffiliated && (me?.char_lv || 0) >= FOUND_MIN_CHARLV && affiliated.length < MAX_COUNTRIES

  const countryByRegion = (rid) => countries.find(c => c.region === rid) || null

  const doFound = async () => {
    if (!fRegion) { flash('地図から建国する大陸を選んでください', '#ff5555'); return }
    if (!fName.trim()) { flash('国名を入力してください', '#ff5555'); return }
    setBusy(true)
    const { error } = await supabase.rpc('found_country', { p_name: fName.trim(), p_emblem: fEmblem, p_desc: fDesc.trim(), p_region: fRegion })
    setBusy(false)
    if (error) { flash(`建国失敗: ${error.message}`, '#ff5555'); return }
    flash(`👑 ${fName.trim()} を建国しました！あなたは元帥です`)
    setFName(''); setFDesc(''); setFRegion(null)
    await reload()
  }

  const doAsylum = async (cid, name) => {
    const warn = inUnaffiliated
      ? `「${name}」に亡命しますか？`
      : `「${name}」に亡命しますか？\n所属国を移ると、3日間は領地拡大・建国ができません。`
    if (!window.confirm(warn)) return
    setBusy(true)
    const { error } = await supabase.rpc('seek_asylum', { p_country_id: cid })
    setBusy(false)
    if (error) { flash(`亡命失敗: ${error.message}`, '#ff5555'); return }
    flash(`🏳 ${name} に亡命しました（二等兵から再スタート）`)
    await reload()
  }

  const doAppoint = async (targetId, rank) => {
    setBusy(true)
    const { error } = await supabase.rpc('appoint_rank', { p_target: targetId, p_rank: rank })
    setBusy(false)
    if (error) { flash(`任命失敗: ${error.message}`, '#ff5555'); return }
    flash(rank === '解任' ? '役職を解任しました' : `${rank}に任命しました`)
    await reload()
  }

  const doSaveDesc = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('update_country_desc', { p_desc: descInput })
    setBusy(false)
    if (error) { flash(`保存失敗: ${error.message}`, '#ff5555'); return }
    setDescEdit(false)
    flash('国の説明を更新しました')
    await reload()
  }

  const doExpand = async () => {
    if (!expandArea) { setExpandMsg({ t: '出撃エリアを選んでください', c: '#ff5555' }); return }
    if (expandBusyRef.current) return  // 連打ガード（state更新前の多重クリックを同期的に弾く）
    expandBusyRef.current = true
    setBusy(true)
    try {
      const { data: res, error } = await supabase.rpc('expand_territory', { p_power: power, p_area: expandArea })
      if (error) { setExpandMsg({ t: `領地拡大失敗: ${error.message}`, c: '#ff5555' }); setTimeout(() => setExpandMsg(null), 4000); return }
      const an = AREA_META.find(a => a.id === res.area)?.name || `エリア${res.area}`
      setExpandMsg({ t: `🗺 ${an} の領地を ${res.gain} 拡大！`, c: '#44ffaa' })
      setTimeout(() => setExpandMsg(null), 4000)
      await reload()
    } finally {
      setBusy(false)
      expandBusyRef.current = false
    }
  }

  // 解放済みエリア（領地拡大で選べる出撃先）
  // エリアごとの支配国・シェア
  const areaControl = computeAreaControl(catRows)
  // 自国のエリア別領地量
  const myAreaAmount = (areaId) => {
    const r = catRows.find(x => x.country_id === me?.country_id && x.area_id === areaId)
    return r ? Number(r.amount) : 0
  }
  const countryName = (cid) => countries.find(c => c.id === cid)?.name || '—'
  // 国ごとの色（横グラフ用）。加盟国の並び順で固定割り当て。
  const COUNTRY_PALETTE = ['#ffcc44','#44aaff','#ff6688','#66dd88','#cc88ff','#ff9944','#44dddd','#dddd44']
  const countryColor = (cid) => {
    const idx = affiliated.findIndex(c => c.id === cid)
    return idx < 0 ? '#888' : COUNTRY_PALETTE[idx % COUNTRY_PALETTE.length]
  }
  // エリアごとの「国→領地量」内訳（横グラフ用）
  const areaBreakdown = (areaId) => {
    const rows = catRows.filter(x => x.area_id === areaId && Number(x.amount) > 0)
    const total = rows.reduce((s, r) => s + Number(r.amount), 0)
    return { total, rows: rows.sort((a, b) => Number(b.amount) - Number(a.amount)) }
  }

  if (loading) return <div style={{ color:'#ffcc44', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  const box = { border:'1px solid #4a3a1a', background:'#140e02', padding:'12px', marginBottom:'10px', borderRadius:'2px' }
  const prog = myCountry && !myCountry.is_unaffiliated ? rankProgress(me?.country_contrib) : null
  const isTopRank = ['元帥','副元帥','参謀'].includes(me?.country_rank)  // 自動昇格しない任命枠

  return (
    <div style={{ minHeight:'100vh', background:'#0a0800', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'720px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #403010', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#0a0800' }}>
          <div style={{ color:'#ffcc44', fontSize:'15px', letterSpacing:'3px' }}>🏰 領地</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        {msg && (
          <div style={{ color:msg.c, fontSize:'12px', border:`1px solid ${msg.c}55`, background:'#1a1200', padding:'8px 12px', marginBottom:'10px' }}>{msg.t}</div>
        )}

        {locked && (
          <div style={{ color:'#ff9944', fontSize:'12px', border:'1px solid #aa552255', background:'#1a0e00', padding:'8px 12px', marginBottom:'10px' }}>
            🔒 所属国を移ったため、3日間は領地拡大・建国ができません（亡命は可能）。<br />解除まで残り {fmtRemain(lockRemain)}
          </div>
        )}

        {/* タブ切り替え */}
        <div style={{ display:'flex', gap:'6px', marginBottom:'10px' }}>
          {[['home','🏰 自国'],['world','🗺 世界地図']].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex:1, padding:'8px', fontFamily:'monospace', fontSize:'12px', cursor:'pointer',
                background: tab === k ? '#2a1e02' : '#0a0700', border:`1px solid ${tab === k ? '#ffcc44' : '#403010'}`,
                color: tab === k ? '#ffcc44' : '#88774a' }}>{lbl}</button>
          ))}
        </div>

        {/* ===== 自国タブ ===== */}
        {tab === 'home' && (<>
        {/* 非加盟国（未所属）の案内 */}
        {inUnaffiliated && (
          <div style={box}>
            <div style={{ color:'#ffcc44', fontSize:'12px', marginBottom:'6px' }}>あなたの所属</div>
            <div style={{ color:'#bbaa77', fontSize:'13px' }}>
              {unaffiliated?.emblem || '🏳'} 非加盟国（どこにも属していません）
              <div style={{ color:'#88774a', fontSize:'10px', marginTop:'4px' }}>キャラクターLV{FOUND_MIN_CHARLV}以上で建国できます。亡命は「🗺 世界地図」タブから行えます。</div>
            </div>
          </div>
        )}

        {/* ★自国ダッシュボード（所属中＝国専用ページ） */}
        {!inUnaffiliated && myCountry && (
          <div style={{ ...box, borderColor:'#ffcc44' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'8px', flexWrap:'wrap' }}>
              <div style={{ color:'#ffddaa', fontSize:'17px' }}>{myCountry.emblem} {myCountry.name}</div>
              <div style={{ fontSize:'13px', color:'#bbaa77' }}>あなたの階級：<b style={{ color: rankColor(me?.country_rank) }}>【{me?.country_rank}】</b></div>
            </div>
            {/* 国の説明文（元帥はいつでも編集可） */}
            {descEdit ? (
              <div style={{ marginTop:'6px' }}>
                <textarea value={descInput} onChange={e => setDescInput(e.target.value)} maxLength={200} rows={2}
                  placeholder="国の説明文（200文字以内）"
                  style={{ width:'100%', boxSizing:'border-box', padding:'6px 8px', background:'#020100', border:'1px solid #4a3a1a', color:'#ffe', fontFamily:'monospace', fontSize:'12px', resize:'vertical' }} />
                <div style={{ display:'flex', gap:'6px', marginTop:'4px' }}>
                  <button disabled={busy} onClick={doSaveDesc} style={{ padding:'4px 10px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer', background:'#2a1e02', border:'1px solid #ffcc44', color:'#ffcc44' }}>保存</button>
                  <button onClick={() => setDescEdit(false)} style={{ padding:'4px 10px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer', background:'#1a1000', border:'1px solid #885533', color:'#aa7755' }}>キャンセル</button>
                </div>
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'flex-start', gap:'8px', marginTop:'4px' }}>
                <div style={{ flex:1, color:'#88774a', fontSize:'11px', whiteSpace:'pre-wrap' }}>{myCountry.description || '（説明文は未設定）'}</div>
                {me?.country_rank === '元帥' && (
                  <button onClick={() => { setDescInput(myCountry.description || ''); setDescEdit(true) }}
                    style={{ padding:'2px 8px', fontFamily:'monospace', fontSize:'10px', cursor:'pointer', whiteSpace:'nowrap', background:'#020100', border:'1px solid #4a3a1a', color:'#bbaa77' }}>✎ 編集</button>
                )}
              </div>
            )}

            {/* 国の概況 */}
            <div style={{ display:'flex', gap:'16px', flexWrap:'wrap', marginTop:'10px', padding:'8px 10px', background:'#0a0700', borderRadius:'2px' }}>
              <span style={{ color:'#bbaa77', fontSize:'12px' }}>🗺 領地 <b style={{ color:'#ffe' }}>{Math.floor(myCountry.territory)}</b></span>
              <span style={{ color:'#bbaa77', fontSize:'12px' }}>👥 国民 <b style={{ color:'#ffe' }}>{memberCount(myCountry.id)}</b>人</span>
              <span style={{ color:'#bbaa77', fontSize:'12px' }}>👑 元帥 {members.find(m => m.id === myCountry.founder_id)?.username || '—'}</span>
            </div>

            {/* 自分の貢献度・階級進捗 */}
            <div style={{ color:'#bbaa77', fontSize:'11px', marginTop:'10px' }}>
              あなたの貢献度: <b style={{ color:'#ffe' }}>{Math.floor(me?.country_contrib || 0)}</b>
              {isTopRank
                ? <span style={{ color:'#88774a' }}>　（{me?.country_rank}は最高位です）</span>
                : prog?.next
                  ? <span style={{ color:'#88774a' }}>　次の階級「{prog.next}」まで あと {prog.remain}</span>
                  : <span style={{ color:'#88774a' }}>　（自動昇格の最高位・大将）</span>}
            </div>

            {/* 領地拡大（出撃エリア指定） */}
            <div style={{ marginTop:'10px', paddingTop:'10px', borderTop:'1px solid #2a2010' }}>
              <div style={{ color:'#ffcc44', fontSize:'12px', marginBottom:'4px' }}>🗺 領地を広げる（1時間に1回）</div>
              <div style={{ color:'#bbaa77', fontSize:'11px', marginBottom:'8px' }}>
                出撃エリアを選んで拡大すると、そのエリアの領地が増えます。国の総領地と貢献度にも同量加算されます。
              </div>
              {/* エリア選択（全7エリア。未到達は「？？？」で選択不可） */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:'5px', marginBottom:'8px' }}>
                {AREA_META.map(a => {
                  const unlocked = myUnlockedSet.has(a.id)
                  const sel = expandArea === a.id
                  return (
                    <button key={a.id} disabled={!unlocked} onClick={() => unlocked && setExpandArea(a.id)}
                      style={{ padding:'5px 8px', fontFamily:'monospace', fontSize:'11px', cursor: unlocked ? 'pointer' : 'default', textAlign:'left',
                        background: sel ? '#2a1e02' : '#020100', border:`1px solid ${sel ? '#ffcc44' : '#4a3a1a'}`, color: !unlocked ? '#5a4a2a' : (sel ? '#ffcc44' : '#bbaa77') }}>
                      {areaLabel(a.id)}
                    </button>
                  )
                })}
              </div>
              <button disabled={busy || locked || expandRemain > 0 || !expandArea} onClick={doExpand}
                style={{ padding:'8px 16px', fontFamily:'monospace', fontSize:'13px', cursor: (busy || locked || expandRemain > 0 || !expandArea) ? 'default' : 'pointer',
                  background: (locked || expandRemain > 0) ? '#1a1200' : '#2a1e02', border:`1px solid ${(locked || expandRemain > 0) ? '#403010' : '#ffcc44'}`,
                  color: (locked || expandRemain > 0) ? '#88774a' : '#ffcc44' }}>
                {locked
                  ? `亡命ロック中 残り ${fmtRemain(lockRemain)}`
                  : expandRemain > 0
                    ? `クールダウン中 残り ${fmtRemain(expandRemain)}`
                    : `${areaLabel(expandArea)}の領地を広げる`}
              </button>
              {expandMsg && (
                <div style={{ color:expandMsg.c, fontSize:'12px', marginTop:'8px', border:`1px solid ${expandMsg.c}55`, background:'#0a0700', padding:'6px 10px', borderRadius:'2px' }}>{expandMsg.t}</div>
              )}
              {/* 自国のエリア別領地 */}
              <div style={{ marginTop:'10px', display:'flex', flexWrap:'wrap', gap:'8px' }}>
                {AREA_META.map(a => {
                  const amt = myAreaAmount(a.id)
                  if (amt <= 0) return null
                  const ctrl = areaControl[a.id]
                  const mine = ctrl && ctrl.topCountryId === me?.country_id
                  return (
                    <span key={a.id} style={{ fontSize:'10px', color: mine ? '#44ff88' : '#bbaa77' }}>
                      {mine ? '👑' : ''}{areaLabel(a.id)} {Math.floor(amt)}{ctrl && ctrl.total > 0 ? `(${Math.round((amt/ctrl.total)*100)}%)` : ''}
                    </span>
                  )
                })}
              </div>
            </div>

            {/* 国民一覧（階級順） */}
            <div style={{ marginTop:'12px', paddingTop:'10px', borderTop:'1px solid #2a2010' }}>
              <div style={{ color:'#ffcc44', fontSize:'12px', marginBottom:'6px' }}>👥 国民一覧（{memberCount(myCountry.id)}人）</div>
              {me?.country_rank === '元帥' && <div style={{ color:'#88774a', fontSize:'10px', marginBottom:'4px' }}>※ 元帥は各国民を副元帥・参謀に任命できます（各1名）</div>}
              <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                {membersOf(myCountry.id).map(m => {
                  const isSelf = m.id === me?.id
                  const rk = m.country_rank || '二等兵'
                  const amMarshal = me?.country_rank === '元帥' && !isSelf && rk !== '元帥'
                  return (
                    <div key={m.id} style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'11px', flexWrap:'wrap',
                      padding:'4px 6px', background: isSelf ? '#1a1200' : 'transparent', borderRadius:'2px' }}>
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt="" style={{ width:'22px', height:'22px', borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
                        : <span style={{ width:'22px', height:'22px', borderRadius:'50%', background:'#2a2010', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', flexShrink:0 }}>👤</span>}
                      <span onClick={() => nav(`/profile/${m.id}`)} style={{ flex:1, cursor:'pointer', textDecoration:'underline' }}>
                        <b style={{ color: rankColor(rk) }}>【{rk}】</b><span style={{ color:'#bbddff' }}>{m.username}{isSelf && ' (あなた)'}</span>
                      </span>
                      <span style={{ color:'#88774a', whiteSpace:'nowrap' }}>総合力 {powerMap[m.id] ?? '—'}／貢献 {Math.floor(m.country_contrib || 0)}</span>
                      {amMarshal && (
                        <span style={{ display:'flex', gap:'3px' }}>
                          {['副元帥','参謀'].map(r => (
                            <button key={r} disabled={busy || rk === r} onClick={() => doAppoint(m.id, r)}
                              style={{ padding:'2px 6px', fontFamily:'monospace', fontSize:'10px', cursor: (busy || rk === r) ? 'default' : 'pointer',
                                background: rk === r ? '#2a1e02' : '#020100', border:`1px solid ${rk === r ? '#ffcc44' : '#4a3a1a'}`, color: rk === r ? '#ffcc44' : '#bbaa77' }}>{r}</button>
                          ))}
                          {(rk === '副元帥' || rk === '参謀') && (
                            <button disabled={busy} onClick={() => doAppoint(m.id, '解任')}
                              style={{ padding:'2px 6px', fontFamily:'monospace', fontSize:'10px', cursor:'pointer', background:'#1a1000', border:'1px solid #885533', color:'#aa7755' }}>解任</button>
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {inUnaffiliated && (
          <div style={{ color:'#88774a', fontSize:'11px', ...box }}>「🗺 世界地図」タブから建国・他国への亡命ができます。</div>
        )}
        </>)}

        {/* ===== 世界地図タブ ===== */}
        {tab === 'world' && (<>
        {/* 世界地図（9大陸＝9領域） */}
        <div style={{ ...box, padding:'8px' }}>
          <div style={{ color:'#ffcc44', fontSize:'12px', marginBottom:'6px', paddingLeft:'4px' }}>🗺 世界地図（{REGIONS.length}大陸）</div>
          <div style={{ position:'relative', width:'100%', aspectRatio:'1512 / 1000', backgroundImage:`url(${MAP_IMG})`, backgroundSize:'cover', backgroundPosition:'center', borderRadius:'2px', overflow:'hidden' }}>
            {REGIONS.map(rg => {
              const c = countryByRegion(rg.id)
              const isUnaff = !!c?.is_unaffiliated   // 非加盟国の位置はDB(region)に追従
              const isMine = c && c.id === me?.country_id
              const selectable = canFound && !c
              const selected = fRegion === rg.id
              let bg = 'rgba(10,8,2,0.78)', bd = '#5a4a2a', col = '#bbaa77'
              if (isUnaff) { bd = '#6a6a7a'; col = '#bbbbcc' }
              else if (isMine) { bd = '#ffcc44'; col = '#ffe'; bg = 'rgba(42,30,2,0.88)' }
              else if (c) { bd = '#aa7744'; col = '#ffddaa' }
              if (selected) { bd = '#44ff88'; col = '#bbffcc'; bg = 'rgba(2,26,12,0.9)' }
              return (
                <div key={rg.id}
                  onClick={selectable ? () => setFRegion(selected ? null : rg.id) : undefined}
                  style={{ position:'absolute', left:`${rg.x}%`, top:`${rg.y}%`, transform:'translate(-50%,-50%)',
                    background:bg, border:`1.5px solid ${bd}`, borderRadius:'3px', padding:'3px 6px',
                    textAlign:'center', minWidth:'48px', maxWidth:'30%',
                    cursor: selectable ? 'pointer' : 'default', boxShadow: selectable ? '0 0 6px rgba(68,255,136,0.4)' : 'none' }}>
                  <div style={{ fontSize:'13px', lineHeight:1 }}>{isUnaff ? '🏳' : (c ? c.emblem : (selectable ? (selected ? '✓' : '＋') : '·'))}</div>
                  <div style={{ fontSize:'9px', color:col, lineHeight:1.3, marginTop:'2px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {isUnaff ? '非加盟国' : (c ? c.name : (selectable ? (selected ? '選択中' : '空き') : '空き'))}
                  </div>
                </div>
              )
            })}
          </div>
          {canFound && (
            <div style={{ color:'#88cc99', fontSize:'10px', marginTop:'6px', paddingLeft:'4px' }}>
              地図の「＋」空き大陸をタップして建国地を選べます{fRegion ? `（選択中: ${REGIONS.find(r=>r.id===fRegion)?.name}）` : ''}
            </div>
          )}
        </div>

        {/* 建国フォーム */}
        {inUnaffiliated && (
          <div style={box}>
            <div style={{ color:'#ffcc44', fontSize:'12px', marginBottom:'8px' }}>👑 建国する</div>
            {!canFound ? (
              <div style={{ color:'#aa7755', fontSize:'11px', lineHeight:'1.8' }}>
                {(me?.char_lv || 0) < FOUND_MIN_CHARLV && <>・キャラクターLV{FOUND_MIN_CHARLV}以上が必要です（現在 LV{me?.char_lv || 0}）<br /></>}
                {affiliated.length >= MAX_COUNTRIES && <>・建国できる枠が空いていません（最大{MAX_COUNTRIES}カ国）<br /></>}
              </div>
            ) : (
              <div>
                <div style={{ marginBottom:'8px' }}>
                  <input value={fName} onChange={e => setFName(e.target.value)} maxLength={20} placeholder="国名（20文字以内）"
                    style={{ width:'100%', boxSizing:'border-box', padding:'6px 8px', background:'#020100', border:'1px solid #4a3a1a', color:'#ffe', fontFamily:'monospace', fontSize:'13px' }} />
                </div>
                <div style={{ marginBottom:'8px', display:'flex', flexWrap:'wrap', gap:'4px' }}>
                  {EMBLEMS.map(e => (
                    <button key={e} onClick={() => setFEmblem(e)}
                      style={{ width:'34px', height:'30px', fontSize:'15px', cursor:'pointer',
                        background: fEmblem === e ? '#2a1e02' : '#020100', border:`1px solid ${fEmblem === e ? '#ffcc44' : '#4a3a1a'}` }}>{e}</button>
                  ))}
                </div>
                <div style={{ marginBottom:'8px' }}>
                  <textarea value={fDesc} onChange={e => setFDesc(e.target.value)} maxLength={200} placeholder="国の説明文（任意・200文字以内）" rows={2}
                    style={{ width:'100%', boxSizing:'border-box', padding:'6px 8px', background:'#020100', border:'1px solid #4a3a1a', color:'#ffe', fontFamily:'monospace', fontSize:'12px', resize:'vertical' }} />
                </div>
                {!fRegion && <div style={{ color:'#aa7755', fontSize:'10px', marginBottom:'6px' }}>↑ 上の地図から建国する大陸（空き）を選んでください</div>}
                <button disabled={busy || !fRegion} onClick={doFound}
                  style={{ padding:'8px 16px', fontFamily:'monospace', fontSize:'13px', cursor: (busy || !fRegion) ? 'default' : 'pointer',
                    background: fRegion ? '#2a1e02' : '#1a1200', border:`1px solid ${fRegion ? '#ffcc44' : '#403010'}`, color: fRegion ? '#ffcc44' : '#88774a' }}>
                  {fEmblem} {fRegion ? `${REGIONS.find(r=>r.id===fRegion)?.name}に建国する` : '建国する'}</button>
              </div>
            )}
          </div>
        )}

        {/* 国一覧 */}
        <div style={{ color:'#ffcc44', fontSize:'12px', margin:'14px 0 8px' }}>
          🌍 国一覧（{affiliated.length} / {MAX_COUNTRIES} カ国）
        </div>
        {affiliated.length === 0 && (
          <div style={{ color:'#88774a', fontSize:'12px', ...box }}>まだ建国された国はありません。最初の建国者になりましょう。</div>
        )}
        {affiliated.sort((a, b) => b.territory - a.territory).map(c => {
          const isMine = c.id === me?.country_id
          const founder = members.find(m => m.id === c.founder_id)
          return (
            <div key={c.id} style={{ ...box, borderColor: isMine ? '#ffcc44' : '#4a3a1a' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'8px' }}>
                <div style={{ flex:1 }}>
                  <div style={{ color:'#ffddaa', fontSize:'14px' }}>
                    {c.emblem} {c.name}
                    {isMine && <span style={{ color:'#ffcc44', fontSize:'11px' }}>（所属中）</span>}
                    {c.is_npc && <span style={{ color:'#ff88cc', fontSize:'10px', marginLeft:'4px' }}>[NPC]</span>}
                  </div>
                  <div style={{ color:'#bbaa77', fontSize:'11px', marginTop:'4px' }}>
                    🗺 領地 <b style={{ color:'#ffe' }}>{Math.floor(c.territory)}</b>　👥 {memberCount(c.id)}人　元帥: {c.is_npc ? (npcMembersOf(c.id).find(m=>m.rank==='元帥')?.name || '—') : (founder?.username || '—')}
                  </div>
                  {c.description && <div style={{ color:'#88774a', fontSize:'11px', marginTop:'4px', whiteSpace:'pre-wrap' }}>{c.description}</div>}
                </div>
                {!isMine && !c.is_npc && me?.country_rank !== '元帥' && (
                  <button disabled={busy} onClick={() => doAsylum(c.id, c.name)}
                    style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:'11px', whiteSpace:'nowrap', cursor: busy ? 'default' : 'pointer',
                      background:'#2a1e02', border:'1px solid #ffaa44', color:'#ffaa44' }}>
                    亡命する
                  </button>
                )}
              </div>
              {/* 国民の階級一覧（展開式・実プレイヤー＋NPCダミー） */}
              {(membersOf(c.id).length > 0 || npcMembersOf(c.id).length > 0) && (
                <div style={{ marginTop:'8px', borderTop:'1px solid #2a2010', paddingTop:'6px' }}>
                  <button onClick={() => setOpenRosters(o => ({ ...o, [c.id]: !o[c.id] }))}
                    style={{ background:'none', border:'none', color:'#bbaa77', cursor:'pointer', fontFamily:'monospace', fontSize:'11px', padding:0 }}>
                    {openRosters[c.id] ? '▼' : '▶'} 👥 国民一覧（{memberCount(c.id)}人）
                  </button>
                  {openRosters[c.id] && (
                    <div style={{ marginTop:'6px', display:'flex', flexWrap:'wrap', gap:'8px' }}>
                      {membersOf(c.id).map(m => (
                        <span key={m.id} onClick={() => nav(`/profile/${m.id}`)} style={{ fontSize:'10px', cursor:'pointer', textDecoration:'underline' }}>
                          <b style={{ color: rankColor(m.country_rank || '二等兵') }}>【{m.country_rank || '二等兵'}】</b><span style={{ color:'#bbddff' }}>{m.username}（総合力{powerMap[m.id] ?? '—'}）</span>
                        </span>
                      ))}
                      {npcMembersOf(c.id).map(m => (
                        <span key={`npc-${m.id}`} onClick={() => setNpcDetail(m)}
                          style={{ fontSize:'10px', cursor:'pointer', textDecoration:'underline', color:'#bbaa77' }}>
                          <b style={{ color: rankColor(m.rank) }}>【{m.rank}】</b>{m.name}{m.class ? `・${m.class}` : ''}（総合力{m.power}）
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* 各エリアの占領割合（横グラフ） */}
        <div style={{ color:'#ffcc44', fontSize:'12px', margin:'14px 0 8px' }}>📊 エリア占領割合</div>
        <div style={box}>
          {/* 凡例 */}
          {affiliated.length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:'8px', marginBottom:'10px' }}>
              {affiliated.map(c => (
                <span key={c.id} style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'10px', color:'#bbaa77' }}>
                  <span style={{ width:'10px', height:'10px', background:countryColor(c.id), display:'inline-block', borderRadius:'2px' }} />
                  {c.emblem} {c.name}
                </span>
              ))}
            </div>
          )}
          {AREA_META.map(a => {
            const bd = areaBreakdown(a.id)
            return (
              <div key={a.id} style={{ marginBottom:'8px' }}>
                <div style={{ color:'#bbaa77', fontSize:'11px', marginBottom:'3px' }}>
                  {areaLabel(a.id)}{bd.total <= 0 && <span style={{ color:'#88774a' }}> （未開拓）</span>}
                </div>
                <div style={{ display:'flex', width:'100%', height:'16px', background:'#0a0700', border:'1px solid #2a2010', borderRadius:'2px', overflow:'hidden' }}>
                  {bd.total > 0 ? bd.rows.map(r => {
                    const pct = (Number(r.amount) / bd.total) * 100
                    return (
                      <div key={r.country_id} title={`${countryName(r.country_id)} ${Math.round(pct)}%`}
                        style={{ width:`${pct}%`, background:countryColor(r.country_id), display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                        {pct >= 12 && <span style={{ fontSize:'9px', color:'#000', fontWeight:'bold' }}>{Math.round(pct)}%</span>}
                      </div>
                    )
                  }) : null}
                </div>
              </div>
            )
          })}
        </div>

        {/* 非加盟国へ離脱（所属国があり元帥でない時） */}
        {!inUnaffiliated && me?.country_rank !== '元帥' && unaffiliated && (
          <div style={{ ...box, marginTop:'14px' }}>
            <div style={{ color:'#aa7755', fontSize:'11px', marginBottom:'6px' }}>所属国を抜けて非加盟国に戻る（亡命扱い・1週間に1回）</div>
            <button disabled={busy} onClick={() => doAsylum(unaffiliated.id, '非加盟国')}
              style={{ padding:'6px 12px', fontFamily:'monospace', fontSize:'11px', cursor: busy ? 'default' : 'pointer',
                background:'#1a1000', border:'1px solid #885533', color:'#aa7755' }}>
              非加盟国に戻る
            </button>
          </div>
        )}
        </>)}
      </div>

      {/* NPC国民の詳細（クラス・総合力・ステ内訳） */}
      {npcDetail && (
        <div onClick={() => setNpcDetail(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:'16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#140e02', border:'1px solid #ffcc44', borderRadius:'4px', padding:'16px', maxWidth:'320px', width:'100%', fontFamily:'monospace' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
              <div style={{ color:'#ffddaa', fontSize:'15px' }}>👤 {npcDetail.name}</div>
              <button onClick={() => setNpcDetail(null)} style={{ background:'none', border:'1px solid #885533', color:'#aa7755', padding:'2px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>×</button>
            </div>
            <div style={{ fontSize:'12px', marginBottom:'4px' }}><b style={{ color: rankColor(npcDetail.rank) }}>【{npcDetail.rank}】</b><span style={{ color:'#bbaa77' }}>{npcDetail.class || '—'}</span></div>
            <div style={{ color:'#bbaa77', fontSize:'12px', marginBottom:'10px' }}>総合力 <b style={{ color:'#ffe' }}>{npcDetail.power}</b></div>
            {npcDetail.stats && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 12px', fontSize:'12px' }}>
                {[['HP','hp'],['MP','mp'],['攻撃','atk'],['防御','def'],['特殊攻撃','matk'],['特殊防御','mdef'],['素早さ','spd']].map(([lbl, k]) => (
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', borderBottom:'1px solid #2a2010', padding:'2px 0' }}>
                    <span style={{ color:'#88774a' }}>{lbl}</span>
                    <span style={{ color:'#ddd' }}>{npcDetail.stats[k] ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ color:'#557755', fontSize:'10px', marginTop:'10px' }}>※ NPCキャラクター（{countryName(npcDetail.country_id)}所属）</div>
          </div>
        </div>
      )}
    </div>
  )
}
