// ============================================================
// 領地（国・建国）システム  ※is_admin限定で先行公開
//   ・9カ国構成（うち1つは固定の「非加盟国」）。最大8カ国をプレイヤーが建国できる。
//   ・建国: キャラクターLV500以上＆非加盟国に居ること。
//   ・亡命: 他国への加入/離脱は1週間に1回まで。
//   ・領地拡大: 1時間に1回・総合力に応じて獲得量が変わる。
//   ・階級は貢献度で自動決定（建国者=元帥固定）。
//   ・全ての時刻・操作は SECURITY DEFINER RPC 経由（supabase_territory.sql）。
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { calcEffectiveTotal } from '../lib/stats'
import { charmPlayerBonus } from '../constants/pets'
import {
  FOUND_MIN_CHARLV, MAX_COUNTRIES, rankOrder, rankProgress,
  expandGain, EXPAND_COOLDOWN_MS, fmtRemain, REGIONS,
  AREA_META, computeAreaControl,
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
  const [expandArea, setExpandArea] = useState(null)  // 領地拡大の出撃エリア
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [, setTick] = useState(0)
  const offsetRef = useRef(0)
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
      if (!prof.is_admin) { nav('/game'); return }   // ★is_admin限定の先行公開
      await loadAll(prof)
      setLoading(false)
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
        supabase.from('pets').select('owner_id, charm_id').eq('owner_id', prof.id).eq('is_active', true),
      ])
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
      return calcEffectiveTotal({ ...prof, petCharm }, eq || [], pf || [], tb)
    } catch { return 0 }
  }

  const loadAll = async (prof) => {
    const [{ data: cs }, { data: mem }, { data: cat }] = await Promise.all([
      supabase.from('countries').select('*'),
      supabase.from('profiles').select('id, username, country_id, country_rank, country_contrib'),
      supabase.from('country_area_territory').select('country_id, area_id, amount'),
    ])
    setCountries(cs || [])
    setMembers(mem || [])
    setCatRows(cat || [])
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
  const memberCount = (cid) => members.filter(m => m.country_id === cid).length
  const membersOf = (cid) => members.filter(m => m.country_id === cid)
    .sort((a, b) => rankOrder(b.country_rank) - rankOrder(a.country_rank))

  // 領地拡大クールダウン
  const lastExpand = me?.last_expand_at ? new Date(me.last_expand_at).getTime() : 0
  const expandRemain = Math.max(0, lastExpand + EXPAND_COOLDOWN_MS - Date.now())
  // 亡命クールダウン
  const lastAsylum = me?.last_asylum_at ? new Date(me.last_asylum_at).getTime() : 0
  const asylumRemain = Math.max(0, lastAsylum + 7 * 24 * 60 * 60 * 1000 - Date.now())

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
    if (!window.confirm(`「${name}」に亡命しますか？\n亡命は1週間に1回までです。`)) return
    setBusy(true)
    const { error } = await supabase.rpc('seek_asylum', { p_country_id: cid })
    setBusy(false)
    if (error) { flash(`亡命失敗: ${error.message}`, '#ff5555'); return }
    flash(`🏳 ${name} に亡命しました（二等兵から再スタート）`)
    await reload()
  }

  const doExpand = async () => {
    if (!expandArea) { flash('出撃エリアを選んでください', '#ff5555'); return }
    setBusy(true)
    const { data: res, error } = await supabase.rpc('expand_territory', { p_power: power, p_area: expandArea })
    setBusy(false)
    if (error) { flash(`領地拡大失敗: ${error.message}`, '#ff5555'); return }
    const an = AREA_META.find(a => a.id === res.area)?.name || `エリア${res.area}`
    flash(`🗺 ${an} の領地を ${res.gain} 拡大！（階級 ${res.rank}）`)
    await reload()
  }

  // 解放済みエリア（領地拡大で選べる出撃先）
  const myUnlockedAreas = AREA_META.filter(a => (me?.unlocked_areas && me.unlocked_areas.length ? me.unlocked_areas : [1]).includes(a.id))
  // エリアごとの支配国・シェア
  const areaControl = computeAreaControl(catRows)
  // 自国のエリア別領地量
  const myAreaAmount = (areaId) => {
    const r = catRows.find(x => x.country_id === me?.country_id && x.area_id === areaId)
    return r ? Number(r.amount) : 0
  }
  const countryName = (cid) => countries.find(c => c.id === cid)?.name || '—'

  if (loading) return <div style={{ color:'#ffcc44', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  const box = { border:'1px solid #4a3a1a', background:'#140e02', padding:'12px', marginBottom:'10px', borderRadius:'2px' }
  const prog = myCountry && !myCountry.is_unaffiliated ? rankProgress(me?.country_contrib) : null
  const isTopRank = ['元帥','副元帥','参謀'].includes(me?.country_rank)  // 自動昇格しない任命枠

  return (
    <div style={{ minHeight:'100vh', background:'#0a0800', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'720px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #403010', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc44', fontSize:'15px', letterSpacing:'3px' }}>🏰 領地</div>
          <button onClick={() => nav('/game')} style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>← 街に戻る</button>
        </div>

        <div style={{ color:'#aa8844', fontSize:'10px', marginBottom:'10px' }}>※ is_admin限定で先行公開中。調整完了後に一般公開予定。</div>

        {msg && (
          <div style={{ color:msg.c, fontSize:'12px', border:`1px solid ${msg.c}55`, background:'#1a1200', padding:'8px 12px', marginBottom:'10px' }}>{msg.t}</div>
        )}

        {/* 非加盟国（未所属）の案内 */}
        {inUnaffiliated && (
          <div style={box}>
            <div style={{ color:'#ffcc44', fontSize:'12px', marginBottom:'6px' }}>あなたの所属</div>
            <div style={{ color:'#bbaa77', fontSize:'13px' }}>
              {unaffiliated?.emblem || '🏳'} 非加盟国（どこにも属していません）
              <div style={{ color:'#88774a', fontSize:'10px', marginTop:'4px' }}>キャラクターLV{FOUND_MIN_CHARLV}以上で建国、または下記の国へ亡命できます。</div>
            </div>
          </div>
        )}

        {/* ★自国ダッシュボード（所属中＝国専用ページ） */}
        {!inUnaffiliated && myCountry && (
          <div style={{ ...box, borderColor:'#ffcc44' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'8px', flexWrap:'wrap' }}>
              <div style={{ color:'#ffddaa', fontSize:'17px' }}>{myCountry.emblem} {myCountry.name}</div>
              <div style={{ color:'#ffcc44', fontSize:'13px' }}>あなたの階級：【{me?.country_rank}】</div>
            </div>
            {myCountry.description && <div style={{ color:'#88774a', fontSize:'11px', marginTop:'4px', whiteSpace:'pre-wrap' }}>{myCountry.description}</div>}

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
                出撃エリアを選んで拡大すると、そのエリアの領地が増えます。次の拡大で <b style={{ color:'#ffe' }}>+{expandGain(power)}</b>（総合力 {power} 依存）。国の総領地と貢献度にも同量加算。
              </div>
              {/* エリア選択 */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:'5px', marginBottom:'8px' }}>
                {myUnlockedAreas.map(a => {
                  const sel = expandArea === a.id
                  const ctrl = areaControl[a.id]
                  const mine = ctrl && ctrl.topCountryId === me?.country_id
                  return (
                    <button key={a.id} onClick={() => setExpandArea(a.id)}
                      style={{ padding:'5px 8px', fontFamily:'monospace', fontSize:'11px', cursor:'pointer', textAlign:'left',
                        background: sel ? '#2a1e02' : '#020100', border:`1px solid ${sel ? '#ffcc44' : '#4a3a1a'}`, color: sel ? '#ffcc44' : '#bbaa77' }}>
                      {a.name}
                      <span style={{ color: mine ? '#44ff88' : '#88774a', fontSize:'9px', marginLeft:'4px' }}>
                        {ctrl && ctrl.total > 0 ? `支配:${countryName(ctrl.topCountryId)}(${Math.round(ctrl.share*100)}%)` : '未開拓'}
                      </span>
                    </button>
                  )
                })}
              </div>
              <button disabled={busy || expandRemain > 0 || !expandArea} onClick={doExpand}
                style={{ padding:'8px 16px', fontFamily:'monospace', fontSize:'13px', cursor: (busy || expandRemain > 0 || !expandArea) ? 'default' : 'pointer',
                  background: expandRemain > 0 ? '#1a1200' : '#2a1e02', border:`1px solid ${expandRemain > 0 ? '#403010' : '#ffcc44'}`,
                  color: expandRemain > 0 ? '#88774a' : '#ffcc44' }}>
                {expandRemain > 0
                  ? `クールダウン中 残り ${fmtRemain(expandRemain)}`
                  : `${AREA_META.find(a=>a.id===expandArea)?.name || 'エリア'}の領地を広げる`}
              </button>
              {/* 自国のエリア別領地 */}
              <div style={{ marginTop:'10px', display:'flex', flexWrap:'wrap', gap:'8px' }}>
                {AREA_META.map(a => {
                  const amt = myAreaAmount(a.id)
                  if (amt <= 0) return null
                  const ctrl = areaControl[a.id]
                  const mine = ctrl && ctrl.topCountryId === me?.country_id
                  return (
                    <span key={a.id} style={{ fontSize:'10px', color: mine ? '#44ff88' : '#bbaa77' }}>
                      {mine ? '👑' : ''}{a.name} {Math.floor(amt)}{ctrl && ctrl.total > 0 ? `(${Math.round((amt/ctrl.total)*100)}%)` : ''}
                    </span>
                  )
                })}
              </div>
            </div>

            {/* 国民一覧（階級順） */}
            <div style={{ marginTop:'12px', paddingTop:'10px', borderTop:'1px solid #2a2010' }}>
              <div style={{ color:'#ffcc44', fontSize:'12px', marginBottom:'6px' }}>👥 国民一覧（{memberCount(myCountry.id)}人）</div>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                {membersOf(myCountry.id).map(m => {
                  const isSelf = m.id === me?.id
                  return (
                    <div key={m.id} style={{ display:'flex', justifyContent:'space-between', fontSize:'11px',
                      padding:'3px 6px', background: isSelf ? '#1a1200' : 'transparent', borderRadius:'2px',
                      color: m.country_rank === '元帥' ? '#ffcc44' : '#bbaa77' }}>
                      <span>【{m.country_rank || '二等兵'}】{m.username}{isSelf && ' (あなた)'}</span>
                      <span style={{ color:'#88774a' }}>貢献 {Math.floor(m.country_contrib || 0)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

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
                  <div style={{ color:'#ffddaa', fontSize:'14px' }}>{c.emblem} {c.name} {isMine && <span style={{ color:'#ffcc44', fontSize:'11px' }}>（所属中）</span>}</div>
                  <div style={{ color:'#bbaa77', fontSize:'11px', marginTop:'4px' }}>
                    🗺 領地 <b style={{ color:'#ffe' }}>{Math.floor(c.territory)}</b>　👥 {memberCount(c.id)}人　元帥: {founder?.username || '—'}
                  </div>
                  {c.description && <div style={{ color:'#88774a', fontSize:'11px', marginTop:'4px', whiteSpace:'pre-wrap' }}>{c.description}</div>}
                </div>
                {!isMine && me?.country_rank !== '元帥' && (
                  <button disabled={busy || asylumRemain > 0} onClick={() => doAsylum(c.id, c.name)}
                    style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:'11px', whiteSpace:'nowrap', cursor:(busy || asylumRemain > 0) ? 'default' : 'pointer',
                      background: asylumRemain > 0 ? '#1a1200' : '#2a1e02', border:`1px solid ${asylumRemain > 0 ? '#403010' : '#ffaa44'}`, color: asylumRemain > 0 ? '#88774a' : '#ffaa44' }}>
                    {asylumRemain > 0 ? `亡命 ${fmtRemain(asylumRemain)}` : '亡命する'}
                  </button>
                )}
              </div>
              {/* 国民の階級一覧 */}
              {membersOf(c.id).length > 0 && (
                <div style={{ marginTop:'8px', borderTop:'1px solid #2a2010', paddingTop:'6px', display:'flex', flexWrap:'wrap', gap:'6px' }}>
                  {membersOf(c.id).map(m => (
                    <span key={m.id} style={{ fontSize:'10px', color: m.country_rank === '元帥' ? '#ffcc44' : '#bbaa77' }}>
                      【{m.country_rank || '二等兵'}】{m.username}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* 非加盟国へ離脱（所属国があり元帥でない時） */}
        {!inUnaffiliated && me?.country_rank !== '元帥' && unaffiliated && (
          <div style={{ ...box, marginTop:'14px' }}>
            <div style={{ color:'#aa7755', fontSize:'11px', marginBottom:'6px' }}>所属国を抜けて非加盟国に戻る（亡命扱い・1週間に1回）</div>
            <button disabled={busy || asylumRemain > 0} onClick={() => doAsylum(unaffiliated.id, '非加盟国')}
              style={{ padding:'6px 12px', fontFamily:'monospace', fontSize:'11px', cursor:(busy || asylumRemain > 0) ? 'default' : 'pointer',
                background:'#1a1000', border:'1px solid #885533', color:'#aa7755' }}>
              {asylumRemain > 0 ? `離脱まで 残り ${fmtRemain(asylumRemain)}` : '非加盟国に戻る'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
