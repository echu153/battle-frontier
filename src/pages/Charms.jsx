import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { getCharm, CHARM_TOTAL_MAX, CHARM_HP_PER, charmDisplayName, charmTotal, petItemImg } from '../constants/pets'

// 素アイコン（画像があれば画像、無ければ絵文字）
function SeedIcon({ seed, emoji, size = 16 }) {
  const src = petItemImg(seed)
  return src
    ? <img src={src} alt="" style={{ width: size, height: size, objectFit: 'contain', verticalAlign: 'middle', marginRight: 2 }} />
    : <span>{emoji}</span>
}

// チャームの能力と、対応する素アイテムキー・1個あたりの上昇量（HPのみ+5、消費は全て1）
const STAT_META = {
  hp:    { label: 'HP',   seed: 'hp_seed',    emoji: '🟡', per: CHARM_HP_PER },
  atk:   { label: '攻撃', seed: 'atk_seed',   emoji: '🔴', per: 1 },
  spatk: { label: '特攻', seed: 'spatk_seed', emoji: '🟣', per: 1 },
  def:   { label: '防御', seed: 'def_seed',   emoji: '🔵', per: 1 },
  spdef: { label: '特防', seed: 'spdef_seed', emoji: '🟢', per: 1 },
}
const STAT_KEYS = ['hp', 'atk', 'spatk', 'def', 'spdef']

export default function Charms() {
  const nav = useNavigate()
  const [charms, setCharms] = useState([])
  const [seeds, setSeeds] = useState({})      // { atk_seed: n, ... }
  const [pets, setPets] = useState([])
  const [tab, setTab] = useState('enhance')   // enhance | inherit
  const [selId, setSelId] = useState(null)    // 強化対象チャーム
  const [checked, setChecked] = useState({})  // 一括強化で選択中の能力
  const [fromId, setFromId] = useState(null)  // 継承元
  const [toId, setToId] = useState(null)      // 継承先
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  useEffect(() => { load() }, [])
  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: chs } = await supabase.from('player_charms').select('*').eq('owner_id', user.id).order('created_at')
    setCharms(chs || [])
    const { data: ps } = await supabase.from('pets').select('id, name, charm_id').eq('owner_id', user.id)
    setPets(ps || [])
    // 素は倉庫(pet_storage)に入る
    const { data: its } = await supabase.from('pet_storage').select('item_key, qty').eq('owner_id', user.id)
    const m = {}; (its || []).forEach((r) => { m[r.item_key] = r.qty }); setSeeds(m)
    if (chs && chs.length && !chs.find((c) => c.id === selId)) setSelId(chs[0].id)
  }

  const equippedBy = (charmId) => pets.find((p) => p.charm_id === charmId)?.name

  const enhance = async (charmId, stat, times) => {
    if (times < 1) return
    setLoading(true)
    const { error } = await supabase.rpc('pet_charm_enhance', { p_charm_id: charmId, p_stat: stat, p_times: times })
    setLoading(false)
    if (error) { flash('強化できません（素が無い／上限）'); return }
    await load()
  }
  // 選択中の能力を、所持している素の分だけまとめて強化
  const bulkEnhance = async (charm) => {
    const targets = STAT_KEYS.filter((k) => checked[k])
    if (!targets.length) { flash('強化する能力を選んでください'); return }
    setLoading(true)
    for (const stat of targets) {
      const have = seeds[STAT_META[stat].seed] || 0
      if (have > 0) await supabase.rpc('pet_charm_enhance', { p_charm_id: charm.id, p_stat: stat, p_times: have })
    }
    setLoading(false)
    await load()
    flash('まとめて強化した')
  }

  const doInherit = async () => {
    setConfirm(false)
    if (!fromId || !toId || fromId === toId) { flash('継承元と継承先を選んでください'); return }
    setLoading(true)
    const { error } = await supabase.rpc('pet_charm_inherit', { p_from: fromId, p_to: toId })
    setLoading(false)
    if (error) { flash('継承に失敗: ' + error.message); return }
    setFromId(null); setToId(null)
    await load()
    flash('継承しました（継承元のチャームは消えました）')
  }

  const Btn = ({ children, onClick, dim }) => (
    <button onClick={onClick} style={{ background: dim ? '#0a1424' : '#001840', border: `1px solid ${dim ? '#335588' : '#0088ff'}`, color: dim ? '#88aacc' : '#0088ff', padding: '5px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>{children}</button>
  )

  const Bar = ({ value, max }) => (
    <div style={{ flex: 1, height: 8, background: '#0a1424', border: '1px solid #223a55', position: 'relative' }}>
      <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: '100%', background: value >= max ? '#ffcc44' : '#44aaff' }} />
    </div>
  )

  const sel = charms.find((c) => c.id === selId)

  return (
    <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', padding: 16 }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #003366', paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ color: '#ffcc00', fontSize: 16, letterSpacing: 3 }}>BATTLE FRONTIER</div>
          <Btn onClick={() => nav('/pets')} dim>← ペット</Btn>
        </div>
        <div style={{ color: '#aa88ff', letterSpacing: 2, marginBottom: 8 }}>🧿 チャーム</div>
        {msg && <div style={{ background: '#101a30', border: '1px solid #335588', color: '#aaddff', padding: 8, fontSize: 12, marginBottom: 10 }}>{msg}</div>}

        {/* 所持素 */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, marginBottom: 10, color: '#cce6ff' }}>
          {STAT_KEYS.map((k) => <span key={k}><SeedIcon seed={STAT_META[k].seed} emoji={STAT_META[k].emoji} />{STAT_META[k].label}の素×{seeds[STAT_META[k].seed] || 0}</span>)}
        </div>

        {/* タブ */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <Btn onClick={() => setTab('enhance')} dim={tab !== 'enhance'}>強化</Btn>
          <Btn onClick={() => setTab('inherit')} dim={tab !== 'inherit'}>継承</Btn>
        </div>

        {charms.length === 0 && <div style={{ color: '#557799', fontSize: 12 }}>チャームを持っていません（ダンジョンで拾えます）</div>}

        {tab === 'enhance' && charms.length > 0 && (
          <>
            {/* チャーム選択 */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {charms.map((c) => {
                const on = c.id === selId
                return (
                  <button key={c.id} onClick={() => setSelId(c.id)}
                    style={{ background: on ? '#170f2a' : '#000a18', border: `1px solid ${on ? '#aa88ff' : '#224466'}`, color: '#cce6ff', padding: '5px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                    {getCharm(c.ctype).emoji} {charmDisplayName(c)}{equippedBy(c.id) ? `（${equippedBy(c.id)}）` : ''}
                  </button>
                )
              })}
            </div>
            {sel && (() => {
              const total = charmTotal(sel); const full = total >= CHARM_TOTAL_MAX
              return (
              <div style={{ border: '1px solid #335588', background: '#00102a', padding: 12 }}>
                <div style={{ color: '#cce6ff', fontSize: 14, marginBottom: 2 }}>{getCharm(sel.ctype).emoji} {charmDisplayName(sel)}</div>
                <div style={{ color: '#6699cc', fontSize: 10, marginBottom: 8 }}>{getCharm(sel.ctype).desc}</div>
                {/* 強化ゲージ（全能力の合計／150） */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 64, fontSize: 11, color: '#aa88ff' }}>強化合計</span>
                  <Bar value={total} max={CHARM_TOTAL_MAX} />
                  <span style={{ width: 52, fontSize: 11, textAlign: 'right', color: full ? '#ffcc44' : '#88bbee' }}>{total}/{CHARM_TOTAL_MAX}</span>
                </div>
                {STAT_KEYS.map((stat) => {
                  const meta = STAT_META[stat]; const cnt = sel[stat] || 0; const have = seeds[meta.seed] || 0
                  const shown = cnt * meta.per // 表示上の上昇値（HPは×5）
                  const dis = full || have === 0
                  return (
                    <div key={stat} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                      <input type="checkbox" checked={!!checked[stat]} onChange={(e) => setChecked((c) => ({ ...c, [stat]: e.target.checked }))} disabled={dis} />
                      <span style={{ width: 64, fontSize: 11, color: '#cce6ff' }}><SeedIcon seed={meta.seed} emoji={meta.emoji} size={14} />{meta.label}</span>
                      <span style={{ flex: 1, fontSize: 11, color: '#88bbee' }}>+{shown}{stat === 'hp' && cnt > 0 ? `（${cnt}個）` : ''}</span>
                      <span style={{ fontSize: 10, color: '#557799', display: 'inline-flex', alignItems: 'center', gap: 2 }}><SeedIcon seed={meta.seed} emoji={meta.emoji} size={12} />{have}</span>
                      <button onClick={() => !loading && enhance(sel.id, stat, 1)} disabled={dis}
                        style={{ background: dis ? '#0a0f1a' : '#001830', border: `1px solid ${dis ? '#223344' : '#0088cc'}`, color: dis ? '#445' : '#00aaff', padding: '3px 8px', cursor: dis ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                        +{meta.per}
                      </button>
                    </div>
                  )
                })}
                <div style={{ marginTop: 6 }}>
                  <Btn onClick={() => !loading && bulkEnhance(sel)}>✅ 選択した能力をまとめて強化</Btn>
                </div>
              </div>
              )
            })()}
          </>
        )}

        {tab === 'inherit' && charms.length > 0 && (
          <div style={{ border: '1px solid #335588', background: '#00102a', padding: 12 }}>
            <div style={{ color: '#88aacc', fontSize: 11, marginBottom: 8 }}>継承元の能力を継承先へ移します。<span style={{ color: '#ff8866' }}>継承元のチャームは消えます。</span></div>
            {[['from', '継承元（消える）', fromId, setFromId], ['to', '継承先（残る）', toId, setToId]].map(([key, label, val, setter]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ color: '#6699cc', fontSize: 11, marginBottom: 4 }}>{label}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {charms.map((c) => {
                    const d = getCharm(c.ctype); const on = c.id === val
                    return (
                      <button key={c.id} onClick={() => setter(c.id)}
                        style={{ background: on ? '#170f2a' : '#000a18', border: `1px solid ${on ? '#aa88ff' : '#224466'}`, color: '#cce6ff', padding: '5px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                        {on ? '✓ ' : ''}{d.emoji} {charmDisplayName(c)}（HP+{(c.hp || 0) * CHARM_HP_PER}/攻+{c.atk}/特攻+{c.spatk}/防+{c.def}/特防+{c.spdef}）
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <Btn onClick={() => (fromId && toId && fromId !== toId ? setConfirm(true) : flash('継承元と継承先を選んでください'))}>継承する</Btn>
          </div>
        )}
      </div>

      {/* 継承の確認 */}
      {confirm && (() => {
        const f = charms.find((c) => c.id === fromId); const t = charms.find((c) => c.id === toId)
        return (
          <div onClick={() => !loading && setConfirm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#0a0820', border: '1px solid #aa88ff', padding: 20, maxWidth: 340, width: '100%', textAlign: 'center', fontFamily: 'monospace' }}>
              <div style={{ color: '#cce6ff', fontSize: 14, marginBottom: 12 }}>
                {f && charmDisplayName(f)} の能力を<br />{t && charmDisplayName(t)} へ継承します。<br /><span style={{ color: '#ff8866' }}>{f && charmDisplayName(f)} は消えます。</span><br />よろしいですか？
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <Btn onClick={() => !loading && setConfirm(false)} dim>やめる</Btn>
                <Btn onClick={() => !loading && doInherit()}>継承する</Btn>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
