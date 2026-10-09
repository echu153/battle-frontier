import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabase'
import { validateName } from '../../lib/nameFilter'
import { reportDevAccess } from '../../lib/devAccess'
import V2Modal from '../../v2/components/V2Modal.jsx'
import { box, btn, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import V2capStatus from '../components/V2capStatus.jsx'
import V2capSortie from '../components/V2capSortie.jsx'
import V2capEquip from '../components/V2capEquip.jsx'
import V2capSkills from '../components/V2capSkills.jsx'
import V2capTemple from '../components/V2capTemple.jsx'
import { START_CLASSES, weaponsOf, attackKindOf, classDescOf } from '../lib/jobs.js'

// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版 — ホーム（開発限定）
// ------------------------------------------------------------
// 2026-10-09 着手。今のⅡ（/v2）は仮として残し、別のキャラ・別のデータで作る。
// 設計は docs/v2cap-design.md。入れるのは is_admin だけ（サーバーの v2cap_is_dev も同じ）。
// 土台で作ったのは：キャラ作成・ステータス・出撃・装備・神殿（転職）・スキルセット
// ============================================================
const MENU = [
  { key:'equip',  label:'装備',         icon:'🛡', color:'#88ccff', action:'着ける・外す・捨てる' },
  { key:'skills', label:'スキルセット', icon:'📖', color:'#44ff88', action:'編成する' },
  { key:'temple', label:'神殿',         icon:'🏛', color:'#ff88cc', action:'転職する' },
]
const SCREEN_TITLE = { equip:'🛡 装備', skills:'📖 スキルセット', temple:'🏛 神殿' }

export default function V2capHome() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [sqlError, setSqlError] = useState('')
  const [prof, setProf] = useState(null)
  const [inventory, setInventory] = useState([])
  const [screen, setScreen] = useState('home')
  const [inBattle, setInBattle] = useState(false)
  const [name, setName] = useState('')
  const [pick, setPick] = useState('戦士')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [devMsg, setDevMsg] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const [{ data: p, error: e1 }, { data: inv, error: e2 }] = await Promise.all([
      supabase.from('v2cap_profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('v2cap_inventory').select('*').order('id', { ascending:false }),
    ])
    if (e1 || e2) throw new Error((e1 || e2).message || String(e1 || e2))
    setProf(p || null)
    setInventory(inv || [])
    return p
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { nav('/login'); return }
        const { data: p } = await supabase.from('profiles').select('username, is_admin').eq('id', user.id).maybeSingle()
        // ★開発限定。管理者以外は旧版へ戻す（アクセスは管理者へ通知）
        if (!p?.is_admin) { reportDevAccess('v2cap', 'V2レベルキャップあり[開発]'); nav('/game'); return }
        if (!alive) return
        setName(p?.username || '')
        await load()
      } catch (err) {
        if (alive) setSqlError(err.message || String(err))
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [nav, load])

  // 子の画面から呼ぶ。サーバーから取り直す
  const refresh = useCallback(async () => {
    try { await load() } catch (err) { setError(err.message || String(err)) }
  }, [load])
  const onScene = useCallback((s) => setInBattle(s === 'battle'), [])

  const create = async (e) => {
    e.preventDefault()
    const nameErr = validateName(name)
    if (nameErr) { setError(nameErr); return }
    setBusy(true); setError('')
    const { data, error: rpcErr } = await supabase.rpc('v2cap_create_character', { p_username: name.trim(), p_class: pick })
    setBusy(false)
    if (rpcErr || !data?.ok) { setError(rpcErr?.message || data?.error || '作成に失敗しました'); return }
    setProf(data.profile)
    setInventory([])
  }

  const gainExp = async (amount) => {
    setBusy(true); setDevMsg('')
    const { data, error: rpcErr } = await supabase.rpc('v2cap_debug_gain_exp', { p_amount: amount })
    setBusy(false)
    if (rpcErr || !data?.ok) { setDevMsg(`⚠ ${rpcErr?.message || data?.error || '失敗しました'}`); return }
    setProf(data.profile)
    const parts = [`EXP+${amount.toLocaleString()}`]
    if (data.level_ups > 0) parts.push(`LV${data.lv}（+${data.level_ups}）`)
    if (data.job_ups > 0) parts.push(`JBLV${data.jlv}（+${data.job_ups}）`)
    if ((data.learned || []).length) parts.push(`スキル「${data.learned.join('」「')}」`)
    setDevMsg(parts.join('　'))
  }
  const resetChar = async () => {
    setBusy(true)
    const { data, error: rpcErr } = await supabase.rpc('v2cap_dev_reset')
    setBusy(false); setConfirmReset(false)
    if (rpcErr || !data?.ok) { setDevMsg(`⚠ ${rpcErr?.message || data?.error || '失敗しました'}`); return }
    setProf(null); setInventory([]); setScreen('home'); setDevMsg('')
  }

  const page = { minHeight:'100vh', background:'#000820', color:'#88ccff', fontFamily:'monospace', padding:'12px' }
  if (loading) return <div style={{ ...page, textAlign:'center', paddingTop:'40px', color:'#0088ff' }}>読み込み中...</div>

  const header = (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px', gap:'8px', flexWrap:'wrap' }}>
      <div>
        <div style={{ color:'#ffcc00', fontSize:'14px' }}>バトルフロンティアⅡ <span style={{ color:'#ff88cc' }}>レベルキャップあり</span></div>
        <div style={{ color: TEXT.label, fontSize:'10px' }}>開発中（is_admin だけが入れます）</div>
      </div>
      <button onClick={() => nav('/game')} style={miniBtn('#88aaff')}>← 旧版へ戻る</button>
    </div>
  )

  if (sqlError) {
    return (
      <div style={page}>
        <div style={{ maxWidth:'640px', margin:'0 auto' }}>
          {header}
          <div style={{ ...box, padding:'14px', borderColor:'#ff8844' }}>
            <div style={{ color:'#ff8844', marginBottom:'6px' }}>⚠ データを読み込めませんでした</div>
            <div style={{ color: TEXT.sub, fontSize:'11px', lineHeight:1.8 }}>
              supabase_v2cap_core.sql がまだ流されていない可能性があります。SupabaseのSQL Editorで全文を流してから開き直してください。
            </div>
            <div style={{ color: TEXT.empty, fontSize:'10px', marginTop:'6px' }}>{sqlError}</div>
          </div>
        </div>
      </div>
    )
  }

  // ===== キャラ作成 =====
  if (!prof) {
    return (
      <div style={page}>
        <div style={{ maxWidth:'760px', margin:'0 auto' }}>
          {header}
          {/* ★見せるのは「キャラクター名」と「クラス選択」だけ（2026-10-09 ユーザー指示）。
               カードは職業名・物理／魔法・武器・特徴の説明1行（ジョブのステや技の一覧は神殿で見る） */}
          <form onSubmit={create} style={{ ...box, padding:'14px' }}>
            <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>キャラクター名</div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={16} placeholder="名前（1〜16文字）"
              style={{ width:'100%', boxSizing:'border-box', background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace', fontSize:'12px', marginBottom:'14px' }} />
            <div style={{ color:'#88ccff', fontSize:'12px', marginBottom:'6px' }}>
              クラス選択<span style={{ color: TEXT.label, fontSize:'10px' }}>※いつでも変更可能</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'6px', marginBottom:'10px' }}>
              {START_CLASSES.map(c => {
                const on = pick === c
                return (
                  <button type="button" key={c} onClick={() => setPick(c)}
                    style={{ textAlign:'left', background: on ? '#001840' : '#000818', border:`1px solid ${on ? '#ffcc00' : '#002244'}`,
                      color:'#88ccff', padding:'8px', cursor:'pointer', fontFamily:'monospace' }}>
                    <div style={{ color: on ? '#ffcc00' : '#cfe2ff', fontSize:'12px', marginBottom:'4px' }}>
                      {c}
                      <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>{attackKindOf(c) === 'mag' ? '魔法' : '物理'}</span>
                    </div>
                    <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7 }}>
                      <div>武器：<span style={{ color:'#cfe2ff' }}>{weaponsOf(c).join('・')}</span></div>
                      <div style={{ color:'#9fb8d0', marginTop:'2px' }}>{classDescOf(c)}</div>
                    </div>
                  </button>
                )
              })}
            </div>
            {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}
            <button type="submit" disabled={busy} style={{ ...btn('#ffcc00'), width:'100%', padding:'10px' }}>
              {busy ? '作成中...' : `${pick}で始める`}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ===== ホーム =====
  return (
    <div style={page}>
      {confirmReset && (
        <V2Modal title="キャラクターを作り直す［開発］" color="#ff8844" danger busy={busy}
          confirmLabel="消して作り直す" onConfirm={resetChar} onClose={() => setConfirmReset(false)}>
          この版のキャラクターと装備を消します（今のⅡ・旧版のデータには触りません）。元には戻せません。
        </V2Modal>
      )}
      <div style={{ maxWidth:'980px', margin:'0 auto' }}>
        {header}
        <div style={{ display:'flex', flexWrap:'wrap', gap:'8px', alignItems:'flex-start' }}>
          <div style={{ flex:'1 1 340px', minWidth:0 }}>
            <V2capStatus prof={prof} inventory={inventory} />
          </div>
          <div style={{ flex:'999 1 340px', minWidth:0 }}>
            {screen === 'home' ? (
              <>
                <V2capSortie prof={prof} inventory={inventory} onProfile={refresh} onScene={onScene} />
                {!inBattle && (
                  <>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:'6px', marginTop:'8px' }}>
                      {MENU.map(m => (
                        <button key={m.key} onClick={() => setScreen(m.key)}
                          style={{ ...box, padding:'10px', textAlign:'left', cursor:'pointer', borderColor:'#003366' }}>
                          <div style={{ color: m.color, fontSize:'12px' }}>{m.icon} {m.label}</div>
                          <div style={{ color: TEXT.label, fontSize:'10px', marginTop:'2px' }}>{m.action}</div>
                        </button>
                      ))}
                    </div>
                    <div style={{ ...box, padding:'10px', marginTop:'8px', borderColor:'#553366' }}>
                      <div style={{ color:'#ff88cc', fontSize:'11px', marginBottom:'6px' }}>🧪 開発用</div>
                      <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
                        {[100, 10000, 1000000].map(n => (
                          <button key={n} onClick={() => gainExp(n)} disabled={busy} style={miniBtn('#44ff88')}>
                            EXP+{n.toLocaleString()}
                          </button>
                        ))}
                        <button onClick={() => setConfirmReset(true)} disabled={busy} style={miniBtn('#ff8844')}>キャラを作り直す</button>
                      </div>
                      <div style={{ color: TEXT.sub, fontSize:'9px', marginTop:'4px' }}>EXPは戦闘と同じ扱い（いまの職業のJBEXPにも同じ量が入る）</div>
                      {devMsg && <div style={{ color:'#cfe2ff', fontSize:'10px', marginTop:'4px' }}>{devMsg}</div>}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                  <button onClick={() => setScreen('home')} style={miniBtn('#88aaff')}>← ホームへ</button>
                  <span style={{ color:'#88ccff', fontSize:'12px' }}>{SCREEN_TITLE[screen]}</span>
                </div>
                {screen === 'equip' && <V2capEquip prof={prof} inventory={inventory} onProfile={refresh} />}
                {screen === 'skills' && <V2capSkills prof={prof} inventory={inventory} onProfile={refresh} />}
                {screen === 'temple' && <V2capTemple prof={prof} inventory={inventory} onProfile={refresh} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
