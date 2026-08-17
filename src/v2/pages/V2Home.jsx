import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { validateName } from '../../lib/nameFilter'
import { reportDevAccess } from '../../lib/devAccess'
import {
  STAT_KEYS, STAT_DEFS, MAX_LV, ROLLS_PER_LV, JOB_CHANGE_POWER,
  canJobChange,
} from '../lib/stats.js'
import { TIER_LABEL, TIER_ORDER, TIER_COLOR, missingReqs, canBecome, reqText, proofCount } from '../lib/classes.js'
import { classBonusText, jobCountOf } from '../lib/classBonus.js'
import { useStored } from '../lib/prefs.js'
import { totalStats } from '../lib/loadout.js'
import V2Sortie from '../components/V2Sortie.jsx'
import V2Storage from '../components/V2Storage.jsx'
import V2Smith from '../components/V2Smith.jsx'
import V2Status, { V2Menu } from '../components/V2Status.jsx'
import V2Profile from '../components/V2Profile.jsx'
import V2Tree from '../components/V2Tree.jsx'
import V2Arena from '../components/V2Arena.jsx'
import {
  powerText, isPassive, KIND_LABEL, KIND_COLOR, SKILL_BY_NAME,
  usableSkills, usableSkillNames, unlearnedSkills, validateSkillSet, setMpCost,
  KIND_TABS, filterSkills, sortSkills,
  SKILL_SET_SLOTS, SKILL_USE_MAX,
} from '../lib/skills.js'

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
// スキル一覧の2行目以降を、1行目のスキル名と同じ位置から始めるための字下げ（★ボタンのぶん）
// 消費MPの表示。割合消費（マナボルト）は「残りMPの20%」
const mpLabel = (s) => (s.mpPct ? `MP 残りの${Math.round(s.mpPct * 100)}%` : `MP${s.mp}`)
const ROW_INDENT = '28px'

// ホームから行ける先。旧版の街と同じ並びの考え方（出撃が主役、あとは施設）
const MENU = [
  { key:'profile', label:'プロフィール', icon:'👤', color:'#88aaff', action:'確認する' },
  { key:'temple',  label:'神殿',        icon:'🏛', color:'#ff88cc', action:'転職する' },
  { key:'smith',   label:'鍛冶屋',      icon:'🔨', color:'#ffcc00', action:'強化・エンチャント' },
  { key:'skills',  label:'スキルセット', icon:'📖', color:'#44ff88', action:'編成する' },
  { key:'storage', label:'倉庫',        icon:'🎒', color:'#88ccff', action:'倉庫に行く' },
  { key:'tree',    label:'ユグレシアの宝樹', icon:'🌳', color:'#44dd99', action:'祈る' },
]

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
  const [screen, setScreen] = useState('home')     // home / sortie / temple / smith / skills / storage
  const [inventory, setInventory] = useState([])   // 所持している装備（v2_inventory）
  const [materials, setMaterials] = useState([])   // 持っている素材（v2_player_materials）
  const [runes, setRunes] = useState([])     // 持っているルーン（v2_essences）
  // ★アリーナで守っている階（v2_arena_floors の自分の行。守っていなければ null）。
  //   守護中は出撃のドロップ率が上がるので、出撃の画面でも要る
  const [guard, setGuard] = useState(null)
  const [inBattle, setInBattle] = useState(false)  // 戦闘中はメニューを隠す（旧版と同じ）
  // ★開閉は覚えておく（毎回閉じ直さなくてよいように）
  const [openStatus, setOpenStatus] = useStored('openStatus', true)
  const [openMenu, setOpenMenu] = useStored('openMenu', true)
  const [act, setAct] = useStored('homeAct', 'sortie')   // ホームの行動タブ（出撃／アリーナ）
  const [isAdmin, setIsAdmin] = useState(false)       // 開発限定の緩和（宝樹の回数制限なしなど）

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
        setIsAdmin(!!p.is_admin)
        const [{ data: v2, error: e2 }, { data: cls, error: e3 }] = await Promise.all([
          supabase.from('v2_profiles').select('*').eq('id', user.id).maybeSingle(),
          supabase.from('v2_classes').select('*').order('sort'),
        ])
        if (!alive) return
        if (e2 || e3) { setSqlError((e2 || e3).message || String(e2 || e3)); setLoading(false); return }
        setProf(v2 || null)
        setClasses(cls || [])
        const [{ data: inv }, { data: mats }, { data: ess }, { data: grd }] = await Promise.all([
          supabase.from('v2_inventory').select('*').order('id', { ascending:false }),
          supabase.from('v2_player_materials').select('*'),
          supabase.from('v2_essences').select('*').order('id', { ascending:false }),
          supabase.from('v2_arena_floors').select('*').eq('player_id', user.id).maybeSingle(),
        ])
        setInventory(inv || [])
        setMaterials(mats || [])
        setRunes(ess || [])
        setGuard(grd || null)
      } catch (err) {
        setSqlError(err.message || String(err))
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [nav])

  // 子の画面から呼ぶ。null を渡すとサーバーから取り直す（装備の着脱・合成・清算のあと）
  const refresh = async (updater) => {
    if (typeof updater === 'function') { setProf(updater); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: v2 }, { data: inv }, { data: mats }, { data: ess }, { data: grd }] = await Promise.all([
      supabase.from('v2_profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('v2_inventory').select('*').order('id', { ascending:false }),
      supabase.from('v2_player_materials').select('*'),
      supabase.from('v2_essences').select('*').order('id', { ascending:false }),
      // ★守っている階は他人に破られて消えることがある＝毎回取り直す（ドロップ率に効くため）
      supabase.from('v2_arena_floors').select('*').eq('player_id', user.id).maybeSingle(),
    ])
    if (v2) setProf(v2)
    setInventory(inv || [])
    setMaterials(mats || [])
    setRunes(ess || [])
    setGuard(grd || null)
  }

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
      learnedSkills: data.learned || [],
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
      kept: data.kept,
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
  // 使えるスキル ＝ 習得中（この周回だけ）∪ 習得済み（ずっと残る）
  const learning = prof?.skills || []    // 習得中（この周回だけ。転職で失う）
  const learned  = prof?.learned || []   // 習得済み（ずっと残る）
  const usable = usableSkills(learning, learned)
  const usableNames = usableSkillNames(learning, learned)
  const stillLocked = prof ? unlearnedSkills(prof.class, learning, learned) : []  // いまの職業のまだ覚えていない技
  const favorites = prof?.favorites || []
  const compact = draft.filter(d => d.name).map(d => ({ name: d.name, uses: d.uses }))
  const mpCost = setMpCost(compact)                    // 想定利用MP（Σ 消費MP×回数）
  // ★最大MPは**ルーンのMP+%を乗せたぶん**で見る（サーバー v2_set_skills と同じ計算）。
  //   素の prof.mp のままだと蒼ルーンのMPがどこにも効かない
  //   （戦闘はHP/MP満タン開始で5〜13ターン＝MPが枯れないため）。
  const maxMp = prof ? totalStats(prof, inventory, runes).mp : 0
  const setErr = prof ? validateSkillSet(compact, usableNames, maxMp) : null
  // 一覧には、まだ覚えていない「いまの職業のスキル」もグレーで出す（何を狙えるか分かるように）
  const shownSkills = sortSkills(filterSkills([...usable, ...stillLocked], { tab, query, favorites }), sortKey, sortAsc)

  // 保存済みの編成が変わったときだけ下書きへ反映する（EXP付与などで下書きを消さない）。
  // 転職で使えなくなったスキルはサーバー側でも外れるが、画面側でも念のため落とす。
  const savedSetKey = JSON.stringify(prof?.skill_set || [])
  const usableKey = usableNames.join('|')
  useEffect(() => {
    const ok = new Set(usableKey ? usableKey.split('|') : [])
    setDraft(normalizeSet(JSON.parse(savedSetKey).filter(e => ok.has(e?.name))))
  }, [savedSetKey, usableKey])

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

  // index.css の #root が text-align:center なので、v2の中は左揃えに戻す（旧版には触らない）
  return (
    <div style={{ minHeight:'100vh', background:'#000820', fontFamily:'monospace', textAlign:'left' }}>
      {/* ヘッダ。旧版の街と同じで、上に貼り付く細いバー（枠では囲まない） */}
      <div style={{ background:'#000820', borderBottom:'1px solid #003366', padding:'6px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div style={{ color:'#ffcc00', fontSize:'13px', letterSpacing:'2px' }}>BATTLE FRONTIER Ⅱ</div>
          <span style={{ color:'#a89ccc', fontSize:'10px' }}>[開発]</span>
        </div>
        <button onClick={() => nav('/game')}
          style={{ background:'none', border:'1px solid #7fa6d0', color:'#7fa6d0', padding:'4px 8px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
          ← 旧版へ戻る
        </button>
      </div>

      {/* 中身の余白も旧版と同じ（幅は決め打ちせず画面いっぱい） */}
      <div style={{ padding:'8px 12px' }}>

        {/* SQL未適用の案内 */}
        {sqlError && (
          <div style={{ ...box, borderColor:'#aa4400', background:'#1a0a00', padding:'14px', color:'#ffaa66', fontSize:'12px', lineHeight:'1.9' }}>
            <div style={{ color:'#ff8844', marginBottom:'6px' }}>⚠ v2のテーブルが見つかりません</div>
            <div><code style={{ color:'#ffcc88' }}>supabase_v2_core.sql</code> をSupabaseで実行してください。</div>
            <div style={{ color:'#c69a5c', fontSize:'10px', marginTop:'8px', wordBreak:'break-all' }}>{sqlError}</div>
          </div>
        )}

        {/* キャラクター作成 */}
        {!sqlError && !prof && (
          <form onSubmit={create} style={{ ...box, padding:'16px' }}>
            <div style={{ color:'#88ccff', fontSize:'13px', marginBottom:'10px' }}>キャラクターを作成</div>
            <div style={{ color:'#7fa6d0', fontSize:'11px', marginBottom:'4px' }}>冒険者名</div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={16} required
              style={{ width:'100%', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', boxSizing:'border-box', marginBottom:'10px' }} />
            {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}
            <button type="submit" disabled={busy} style={{ ...btn('#ffcc00'), width:'100%', padding:'10px' }}>
              {busy ? '作成中...' : '▶ はじめる'}
            </button>
            <div style={{ color:'#7fa6d0', fontSize:'10px', marginTop:'10px', lineHeight:'1.8' }}>
              旧版のキャラクターとは完全に別のデータです（同じアカウントで両方遊べます）。
            </div>
          </form>
        )}

        {/* ステータス */}
        {prof && (
          <>
            {/* ★ステータスはホームだけに出す。施設は別の画面として開く
                （施設の一覧を見るのに、毎回ステータスぶんスクロールさせられていた） */}
            {screen === 'home' && (
              <V2Status prof={prof} inventory={inventory} runes={runes} classes={classes} open={openStatus} onToggle={() => setOpenStatus(v => !v)} />
            )}

            {/* ===== 出撃とアリーナ（旧版と同じで、街のブロックがそのままホームに載る） =====
                ★あるけみすとも「探索する」の下にタブで闘技場がぶら下がっている。
                  クールタイムも共有なので、同じ場所にまとめて置く */}
            {screen === 'home' && (
              <div style={{ marginBottom:'8px' }}>
                {!inBattle && (
                  <div style={{ display:'flex', gap:'4px', marginBottom:'6px' }}>
                    {[{ key:'sortie', label:'⚔ 出撃', color:'#ffcc00' }, { key:'arena', label:'🏛 アリーナ', color:'#ff88cc' }].map(t => (
                      <button key={t.key} onClick={() => setAct(t.key)}
                        style={{ ...miniBtn(act === t.key ? t.color : '#7fa6d0'), padding:'7px 14px', fontSize:'12px',
                          background: act === t.key ? '#002850' : '#000818' }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
                {act === 'sortie'
                  ? <V2Sortie prof={prof} inventory={inventory} runes={runes} guard={guard} onProfile={refresh} onScene={sc => setInBattle(sc === 'battle')} />
                  : <V2Arena prof={prof} inventory={inventory} runes={runes} onProfile={refresh} onBack={() => setAct('sortie')} embedded />}
              </div>
            )}

            {/* ===== 行動メニュー（あるけみすと式の「施設名｜ボタン」）===== */}
            {screen === 'home' && !inBattle && (
              <V2Menu items={MENU} open={openMenu} onToggle={() => setOpenMenu(v => !v)} onPick={setScreen} />
            )}

            {screen === 'profile' && <V2Profile prof={prof} inventory={inventory} runes={runes} onProfile={refresh} onBack={() => setScreen('home')} />}
            {screen === 'storage' && <V2Storage prof={prof} inventory={inventory} runes={runes} onProfile={refresh} onBack={() => setScreen('home')} />}
            {screen === 'smith'   && <V2Smith   prof={prof} inventory={inventory} materials={materials} runes={runes} isAdmin={isAdmin} onProfile={refresh} onBack={() => setScreen('home')} />}
            {screen === 'tree'    && <V2Tree    prof={prof} isAdmin={isAdmin} onProfile={refresh} onBack={() => setScreen('home')} />}

            {(screen === 'skills' || screen === 'temple') && (
              <button onClick={() => setScreen('home')} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>
            )}
            <div style={{ display: screen === 'skills' ? 'block' : 'none' }}>
            {/* スキル編成（並び順＝発動順・使用回数を配る） */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>🎯 スキルセット</div>
              <div style={{ color:'#7fa6d0', fontSize:'10px', marginBottom:'8px', lineHeight:'1.8' }}>
                あなたの最大MPは<span style={{ color:'#4488ff' }}>{maxMp}MP</span>です。
                いまの編成の想定利用MPは<span style={{ color: mpCost > maxMp ? '#ff4444' : '#44ffaa' }}>{mpCost}MP</span>です。
              </div>
              <div style={{ display:'grid', gap:'3px' }}>
                {Array.from({ length: SKILL_SET_SLOTS }).map((_, i) => {
                  const row = draft[i] || { name:'', uses:1 }
                  const s = SKILL_BY_NAME[row.name]
                  const cost = (s?.mp || 0) * (row.uses || 0)
                  return (
                    <div key={i} style={{ background:'#000818', border:'1px solid #002244', padding:'5px 7px', display:'flex', alignItems:'center', gap:'5px', fontSize:'11px' }}>
                      <span style={{ color:'#8866cc', width:'42px' }}>スキル{i + 1}</span>
                      <span style={{ flex:1, color: s ? KIND_COLOR[s.kind] : '#62789a', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {s ? s.name : '（空き）'}
                      </span>
                      <span style={{ color: cost > maxMp ? '#ff4444' : '#7fa6d0', width:'62px', textAlign:'right' }}>
                        {s ? (s.mpPct ? `MP残${Math.round(s.mpPct * 100)}%` : `MP${s.mp}×${row.uses}`) : ''}
                      </span>
                      <span style={{ color:'#7fa6d0', width:'34px', textAlign:'right' }}>{s ? `${s.proc}%` : ''}</span>
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
              {setErr && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'8px' }}>⚠ {setErr}</div>}
              <div style={{ display:'flex', gap:'6px', marginTop:'8px' }}>
                <button onClick={saveSkills} disabled={busy || !!setErr} style={{ ...btn('#44aaff'), opacity: (busy || setErr) ? 0.4 : 1 }}>
                  {busy ? '保存中...' : '保存'}
                </button>
                <button onClick={() => setDraft(normalizeSet(prof.skill_set || []))} disabled={busy} style={btn('#7fa6d0')}>戻す</button>
              </div>
              <div style={{ color:'#7fa6d0', fontSize:'9px', marginTop:'8px', lineHeight:'1.8' }}>
                上から順に発動し、1周ごとに次の枠へ回ります（1→2→3→4→5→1…）。回数はその枠を使える総回数です。
                <span style={{ color:'#ffaa66' }}>不発のターンは通常攻撃になり、その枠に留まります</span>（使用回数もMPも減りません）。
                空き枠・使用回数切れ・MP不足の枠は飛ばします。
              </div>
            </div>

            {/* 習得スキル（検索・絞り込み・お気に入り） */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'8px' }}>
                📖 スキル
              </div>

              {/* 検索 */}
              <div style={{ display:'flex', gap:'5px', marginBottom:'6px' }}>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="スキル名・職業・説明で検索"
                  style={{ flex:1, background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'5px 7px', fontFamily:'monospace', fontSize:'11px', boxSizing:'border-box' }} />
                <button onClick={() => setQuery('')} style={miniBtn('#7fa6d0')}>クリア</button>
              </div>

              {/* 種別タブ */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'6px' }}>
                {KIND_TABS.map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    style={{ ...miniBtn(tab === t.key ? '#44aaff' : '#62789a'), color: tab === t.key ? '#88ccff' : '#93a9be', background: tab === t.key ? '#001840' : '#000818' }}>
                    {t.label}{t.key === 'fav' && favorites.length > 0 ? `(${favorites.length})` : ''}
                  </button>
                ))}
              </div>

              {/* 並べ替え */}
              <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'6px', fontSize:'10px', color:'#7fa6d0' }}>
                <span>並べ替え</span>
                {[['name', 'スキル名'], ['mp', 'MP'], ['proc', '発動'], ['cls', '職業']].map(([k, label]) => (
                  <button key={k} onClick={() => { if (sortKey === k) setSortAsc(a => !a); else { setSortKey(k); setSortAsc(true) } }}
                    style={{ ...miniBtn(sortKey === k ? '#44aaff' : '#62789a'), color: sortKey === k ? '#88ccff' : '#93a9be' }}>
                    {label}{sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : ''}
                  </button>
                ))}
              </div>

              {/* 一覧 */}
              <div style={{ display:'grid', gap:'4px', maxHeight:'420px', overflowY:'auto' }}>
                {shownSkills.length === 0 && <div style={{ color:'#7fa6d0', fontSize:'11px', padding:'8px' }}>該当するスキルがありません</div>}
                {shownSkills.map(s => {
                  const fav = favorites.includes(s.name)
                  const inSet = draft.findIndex(d => d?.name === s.name)
                  const has = usableNames.includes(s.name)   // 習得中 or 習得済み
                  const isKept = learned.includes(s.name)
                  return (
                    <div key={s.name} style={{ background:'#000818', border:`1px solid ${inSet >= 0 ? '#0055aa' : '#002244'}`, padding:'6px 8px', opacity: has ? 1 : 0.45 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                        <button onClick={() => toggleFavorite(s.name)} title="お気に入り"
                          style={{ ...miniBtn(fav ? '#ffcc00' : '#62789a'), color: fav ? '#ffcc00' : '#445566', padding:'2px 5px' }}>★</button>
                        <span style={{ flex:1, color: has ? KIND_COLOR[s.kind] : '#93a9be', fontSize:'12px', minWidth:0 }}>
                          {s.name}
                          <span style={{ color:'#93a9be', fontSize:'9px', marginLeft:'5px' }}>{KIND_LABEL[s.kind]}</span>
                          {isKept && <span style={{ color:'#ffcc00', fontSize:'9px', marginLeft:'5px' }}>習得済み</span>}
                          {!has && <span style={{ color:'#c69a5c', fontSize:'9px', marginLeft:'5px' }}>未習得</span>}
                          {s.cls !== prof.class && <span style={{ color:'#ff88cc', fontSize:'9px', marginLeft:'5px' }}>{s.cls}</span>}
                        </span>
                        <span style={{ color:'#7fa6d0', fontSize:'10px' }}>
                          {isPassive(s) ? '常時' : `${mpLabel(s)} ／ ${s.proc}%`}
                        </span>
                      </div>
                      <div style={{ color:'#7fa6c0', fontSize:'10px', margin:'3px 0', lineHeight:'1.6', paddingLeft:ROW_INDENT }}>
                        {s.priority > 0 && <span style={{ color:'#a888e0', marginRight:'5px' }}>先制{s.priority >= 2 ? `+${s.priority}` : ''}</span>}
                        {s.noCrit && <span style={{ color:'#c09060', marginRight:'5px' }}>クリ無</span>}
                        {s.sureHit && <span style={{ color:'#66bb99', marginRight:'5px' }}>必中</span>}
                        {powerText(s)}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'4px', paddingLeft:ROW_INDENT }}>
                        {/* 説明。powerText と同じ文言になる補助スキルは重ねて出さない */}
                        <span style={{ color:'#8fa8bb', fontSize:'10px', flex:1, minWidth:0, lineHeight:'1.6' }}>
                          {powerText(s) === s.desc ? '' : s.desc}
                        </span>
                        {has && Array.from({ length: SKILL_SET_SLOTS }).map((_, i) => (
                          <button key={i} onClick={() => setSlot(i, { name: s.name, uses: draft[i]?.name === s.name ? draft[i].uses : 1 })}
                            disabled={inSet >= 0 && inSet !== i}
                            style={{ ...miniBtn(inSet === i ? '#44aaff' : '#62789a'), color: inSet === i ? '#88ccff' : '#93a9be', opacity: (inSet >= 0 && inSet !== i) ? 0.3 : 1 }}>
                            {i + 1}
                          </button>
                        ))}
                        {!has && <span style={{ color:'#c69a5c', fontSize:'9px' }}>LVアップで習得</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            </div>

            <div style={{ display: screen === 'temple' ? 'block' : 'none' }}>
            {/* 転職（LV上限で周回する） */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px', borderColor: canJobChange(prof.lv) ? '#aa4488' : '#0044aa' }}>
              <div style={{ color:'#ff88cc', fontSize:'12px', marginBottom:'8px' }}>🔄 転職</div>
              <div style={{ color:'#7fa6d0', fontSize:'10px', lineHeight:'1.9', marginBottom:'10px' }}>
                LV{MAX_LV}で転職できます。LV1に戻り、ステータスは初期値へリセットされたうえで
                <span style={{ color:'#ff88cc' }}> 転職回数×{JOB_CHANGE_POWER}</span>（＝{JOB_CHANGE_POWER / ROLLS_PER_LV}LV分）の戦闘力がランダムに振り分けられます。
                振り分けは毎回引き直しです。転職を重ねるほどLVアップに必要なEXPも重くなります。
              </div>
              {!canJobChange(prof.lv) && (
                <div style={{ color:'#7fa6d0', fontSize:'11px', marginBottom:'8px' }}>LV{MAX_LV}まであと{MAX_LV - prof.lv}</div>
              )}

              {/* 転職先の一覧。LV100未満でも条件の確認用に開ける */}
              <button onClick={() => { setShowJobList(v => !v); setConfirmJob(null) }} style={btn(canJobChange(prof.lv) ? '#ff88cc' : '#7fa6d0')}>
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
                                  <span style={{ color: ok ? TIER_COLOR[tier] : '#7fa6d0', fontSize:'12px' }}>
                                    {c.id}{prof.job_counts?.[c.id] > 0 && <span style={{ color:'#93a9be', fontSize:'9px', marginLeft:'5px' }}>×{prof.job_counts[c.id]}</span>}
                                    {c.req_proof && <span style={{ color: proofCount(jobState.proofs, c.req_proof) > 0 ? '#ffaa44' : '#664433', fontSize:'9px', marginLeft:'6px' }}>証{proofCount(jobState.proofs, c.req_proof)}個</span>}
                                  </span>
                                  {selectable && confirmJob !== c.id && (
                                    <button onClick={() => setConfirmJob(c.id)} disabled={busy} style={{ ...btn(TIER_COLOR[tier]), padding:'4px 8px', fontSize:'11px' }}>転職</button>
                                  )}
                                </div>
                                <div style={{ color: ok ? '#93a9be' : '#775544', fontSize:'9px', marginTop:'3px' }}>
                                  {ok ? reqText(c) : `未達：${miss.join(' ／ ')}`}
                                </div>
                                {classBonusText(c.id, jobCountOf(prof, c.id)) && (
                                  <div style={{ color:'#88ddaa', fontSize:'9px', marginTop:'2px' }}>職業補正 {classBonusText(c.id, jobCountOf(prof, c.id))}</div>
                                )}
                                {confirmJob === c.id && (
                                  <div style={{ marginTop:'6px' }}>
                                    <div style={{ color:'#ffaa66', fontSize:'10px', marginBottom:'6px' }}>
                                      いま育てたステータスは失われます。{c.id}に転職しますか？（{prof.job_changes + 1}回目・戦闘力{(prof.job_changes + 1) * JOB_CHANGE_POWER}分）
                                    </div>
                                    <div style={{ display:'flex', gap:'6px' }}>
                                      <button onClick={() => changeJob(c.id)} disabled={busy} style={{ ...btn('#ff88cc'), padding:'4px 10px', fontSize:'11px' }}>{busy ? '転職中...' : 'はい'}</button>
                                      <button onClick={() => setConfirmJob(null)} disabled={busy} style={{ ...btn('#7fa6d0'), padding:'4px 10px', fontSize:'11px' }}>やめる</button>
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
                  <div style={{ color:'#7fa6d0', fontSize:'9px', lineHeight:'1.8' }}>
                    ×N＝その職業で転職した回数。上位職の条件はこの回数を見ます。
                    ★証が要るのは特殊職（ギャンブラー・竜騎士・ブリーダー）の3職だけです。転職のときに1個消費します。
                    上位職には「職業補正」（その職業でいる間だけ常時かかる能力）が付きます。スキル枠は使いません。
                  </div>
                </div>
              )}
            </div>

            </div>

            {/* 動作確認用のEXP付与 */}
            <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
              <div style={{ color:'#ffaa44', fontSize:'11px', marginBottom:'8px' }}>🧪 EXP付与 <span style={{ color:'#a89ccc', fontSize:'9px' }}>[開発]</span></div>
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
                        <span style={{ color:'#7fa6d0', marginLeft:'8px', fontSize:'10px' }}>戦闘力{l.points}分を振り分け</span>
                        {l.usedProof && <span style={{ color:'#ffaa44', marginLeft:'6px', fontSize:'9px' }}>{l.usedProof}を1個消費</span>}
                        {l.kept && <div style={{ color:'#ffcc00', fontSize:'10px' }}>★ {l.kept}が習得済みになった！</div>}
                        {l.kept === null && <div style={{ color:'#c69a5c', fontSize:'10px' }}>習得済みにできるスキルがなかった</div>}
                      </>
                    ) : (
                      <>
                        <span style={{ color:'#7fa6d0' }}>EXP+{l.amount}</span>
                        <span style={{ color:'#ffcc00', marginLeft:'8px' }}>LV {l.lvFrom} → {l.lvTo}</span>
                        <span style={{ color:'#7fa6d0', marginLeft:'6px', fontSize:'10px' }}>（{l.ups}回）</span>
                      </>
                    )}
                    <div style={{ color:'#88ddaa', fontSize:'10px' }}>{l.gains}</div>
                    {l.learnedSkills?.length > 0 && (
                      <div style={{ color:'#44aaff', fontSize:'10px' }}>📖 {l.learnedSkills.join('・')}を習得した！</div>
                    )}
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
