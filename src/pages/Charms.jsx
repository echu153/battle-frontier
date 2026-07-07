import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { getCharm, CHARM_TOTAL_MAX, CHARM_HP_PER, charmDisplayName, charmTotal, petItemImg, isRibbonType, charmIcon } from '../constants/pets'

// チャーム/リボンの共通アイコン
function CIcon({ ctype, size = 14 }) {
  return <img src={charmIcon(ctype)} alt="" style={{ width: size, height: size, objectFit: 'contain', verticalAlign: -2, marginRight: 3 }} />
}

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
// 凝縮された素の絵文字（丸=通常素 / 四角=凝縮）
const CEMOJI = { hp: '🟨', atk: '🟥', spatk: '🟪', def: '🟦', spdef: '🟩' }

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
  const [fuseBase, setFuseBase] = useState(null) // 合成：残す側
  const [fuseMat, setFuseMat] = useState(null)   // 合成：吸収して消える側
  const [fuseDone, setFuseDone] = useState(null) // 合成完了演出（結果名）
  const [confirm, setConfirm] = useState(false)
  const [shredSel, setShredSel] = useState({})  // 裁断で選択中 { id: true }
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  useEffect(() => { load() }, [])
  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: chs } = await supabase.from('player_charms').select('*').eq('owner_id', user.id).order('created_at')
    setCharms(chs || [])
    const { data: ps } = await supabase.from('pets').select('id, name, charm_id, ribbon_id').eq('owner_id', user.id)
    setPets(ps || [])
    // 素は倉庫(pet_storage)に入る
    const { data: its } = await supabase.from('pet_storage').select('item_key, qty').eq('owner_id', user.id)
    const m = {}; (its || []).forEach((r) => { m[r.item_key] = r.qty }); setSeeds(m)
    if (chs && chs.length && !chs.find((c) => c.id === selId)) setSelId(chs[0].id)
  }

  const equippedBy = (charmId) => pets.find((p) => p.charm_id === charmId || p.ribbon_id === charmId)?.name

  // リボンは「凝縮された素」(*_seed_c)で強化する（RPCも別）
  const seedKeyFor = (charm, stat) => isRibbonType(charm?.ctype) ? `${STAT_META[stat].seed}_c` : STAT_META[stat].seed
  const enhance = async (charm, stat, times) => {
    if (times < 1) return
    setLoading(true)
    const rpc = isRibbonType(charm.ctype) ? 'pet_ribbon_enhance' : 'pet_charm_enhance'
    const idParam = isRibbonType(charm.ctype) ? { p_ribbon_id: charm.id } : { p_charm_id: charm.id }
    const { error } = await supabase.rpc(rpc, { ...idParam, p_stat: stat, p_times: times })
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
      const have = seeds[seedKeyFor(charm, stat)] || 0
      if (have > 0) {
        const rpc = isRibbonType(charm.ctype) ? 'pet_ribbon_enhance' : 'pet_charm_enhance'
        const idParam = isRibbonType(charm.ctype) ? { p_ribbon_id: charm.id } : { p_charm_id: charm.id }
        await supabase.rpc(rpc, { ...idParam, p_stat: stat, p_times: have })
      }
    }
    setLoading(false)
    await load()
    flash('まとめて強化した')
  }
  // 裁断：チャーム/リボンを分解してランダムな素を1個につき3個入手（一括可）
  const doShred = async () => {
    const ids = Object.keys(shredSel).filter((k) => shredSel[k])
    if (!ids.length) { flash('裁断するチャーム/リボンを選んでください'); return }
    if (!window.confirm(ids.length + '個を裁断してランダムな素×' + ids.length * 3 + 'に還元します。元に戻せません。よろしいですか？')) return
    setLoading(true)
    const { data, error } = await supabase.rpc('pet_charm_shred', { p_ids: ids })
    setLoading(false)
    if (error) { flash('裁断に失敗: ' + error.message); return }
    setShredSel({})
    await load()
    flash('裁断完了！ランダムな素を' + (data?.total ?? ids.length * 3) + '個入手した')
  }
  // 凝縮：○○の素10個 → 凝縮された○○の素1個
  const condense = async (stat, times = 1) => {
    setLoading(true)
    const { error } = await supabase.rpc('pet_seed_condense', { p_stat: stat, p_times: times })
    setLoading(false)
    if (error) { flash('凝縮できません（素が10個未満）'); return }
    await load()
    flash(`凝縮された${STAT_META[stat].label}の素を作った`)
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

  const doFuse = async () => {
    if (!fuseBase || !fuseMat || fuseBase === fuseMat) { flash('残す側と素材を選んでください'); return }
    if ((seeds.shard || 0) < 1) { flash('神秘の欠片が足りません'); return }
    setLoading(true)
    const { error } = await supabase.rpc('pet_charm_fuse', { p_base: fuseBase, p_mat: fuseMat })
    setLoading(false)
    if (error) { flash('合成に失敗: ' + error.message); return }
    const b = charms.find((c) => c.id === fuseBase); const m = charms.find((c) => c.id === fuseMat)
    const resultName = b && m ? `${getCharm(b.ctype).short}と${getCharm(m.ctype).short}のチャーム` : 'チャーム'
    setFuseBase(null); setFuseMat(null)
    await load()
    setFuseDone(resultName)
    setTimeout(() => setFuseDone(null), 2200)
  }

  const doUnfuse = async (id) => {
    if ((seeds.shard || 0) < 1) { flash('神秘の欠片が足りません'); return }
    setLoading(true)
    const { error } = await supabase.rpc('pet_charm_unfuse', { p_charm: id })
    setLoading(false)
    if (error) { flash('解除に失敗: ' + error.message); return }
    setFuseBase(null); setFuseMat(null)
    await load()
    flash('合成を解除しました（2つ目の効果が外れました）')
  }

  const Btn = ({ children, onClick, dim }) => (
    <button onClick={onClick} style={{ background: dim ? '#0a1424' : '#001840', border: `1px solid ${dim ? '#335588' : '#0088ff'}`, color: dim ? '#88aacc' : '#0088ff', padding: '5px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>{children}</button>
  )

  const Bar = ({ value, max }) => (
    <div style={{ flex: 1, height: 8, background: '#0a1424', border: '1px solid #223a55', position: 'relative' }}>
      <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: '100%', background: value >= max ? '#ffcc44' : '#44aaff' }} />
    </div>
  )

  const pures = charms.filter((c) => !isRibbonType(c.ctype))
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, marginBottom: 6, color: '#cce6ff' }}>
          {STAT_KEYS.map((k) => <span key={k}><SeedIcon seed={STAT_META[k].seed} emoji={STAT_META[k].emoji} />{STAT_META[k].label}の素×{seeds[STAT_META[k].seed] || 0}</span>)}
        </div>
        <div style={{ fontSize: 12, marginBottom: 10, color: '#c8a0ff' }}>🔮 神秘の欠片×{seeds.shard || 0}</div>

        {/* タブ */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <Btn onClick={() => setTab('enhance')} dim={tab !== 'enhance'}>強化</Btn>
          <Btn onClick={() => setTab('inherit')} dim={tab !== 'inherit'}>継承</Btn>
          <Btn onClick={() => setTab('fuse')} dim={tab !== 'fuse'}>合成</Btn>
          <Btn onClick={() => setTab('condense')} dim={tab !== 'condense'}>凝縮</Btn>
          <Btn onClick={() => setTab('shred')} dim={tab !== 'shred'}>裁断</Btn>
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
                    <CIcon ctype={c.ctype} />{charmDisplayName(c)}{equippedBy(c.id) ? `（${equippedBy(c.id)}）` : ''}
                  </button>
                )
              })}
            </div>
            {sel && (() => {
              const total = charmTotal(sel); const cap = sel.fused ? 300 : CHARM_TOTAL_MAX; const full = total >= cap
              return (
              <div style={{ border: '1px solid #335588', background: '#00102a', padding: 12 }}>
                <div style={{ color: '#cce6ff', fontSize: 14, marginBottom: 2 }}><CIcon ctype={sel.ctype} size={16} />{charmDisplayName(sel)}</div>
                <div style={{ color: '#6699cc', fontSize: 10, marginBottom: 8 }}>{getCharm(sel.ctype).desc}</div>
                {/* 強化ゲージ（全能力の合計／150） */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 64, fontSize: 11, color: '#aa88ff' }}>強化合計</span>
                  <Bar value={total} max={cap} />
                  <span style={{ width: 52, fontSize: 11, textAlign: 'right', color: full ? '#ffcc44' : '#88bbee' }}>{total}/{cap}</span>
                </div>
                {STAT_KEYS.map((stat) => {
                  const meta = STAT_META[stat]; const cnt = sel[stat] || 0; const have = seeds[seedKeyFor(sel, stat)] || 0
                  const shown = cnt * meta.per // 表示上の上昇値（HPは×5）
                  const dis = full || have === 0
                  return (
                    <div key={stat} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                      <input type="checkbox" checked={!!checked[stat]} onChange={(e) => setChecked((c) => ({ ...c, [stat]: e.target.checked }))} disabled={dis} />
                      <span style={{ width: 64, fontSize: 11, color: '#cce6ff' }}><SeedIcon seed={seedKeyFor(sel, stat)} emoji={isRibbonType(sel.ctype) ? CEMOJI[stat] : meta.emoji} size={14} />{meta.label}</span>
                      <span style={{ flex: 1, fontSize: 11, color: '#88bbee' }}>+{shown}{stat === 'hp' && cnt > 0 ? `（${cnt}個）` : ''}</span>
                      <span style={{ fontSize: 10, color: '#557799', display: 'inline-flex', alignItems: 'center', gap: 2 }}><SeedIcon seed={seedKeyFor(sel, stat)} emoji={isRibbonType(sel.ctype) ? CEMOJI[stat] : meta.emoji} size={12} />{have}</span>
                      <button onClick={() => !loading && enhance(sel, stat, 1)} disabled={dis}
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

        {tab === 'inherit' && pures.length > 0 && (
          <div style={{ border: '1px solid #335588', background: '#00102a', padding: 12 }}>
            <div style={{ color: '#88aacc', fontSize: 11, marginBottom: 8 }}>継承元の能力を継承先へ移します。<span style={{ color: '#ff8866' }}>継承元のチャームは消えます。</span></div>
            {[['from', '継承元（消える）', fromId, setFromId], ['to', '継承先（残る）', toId, setToId]].map(([key, label, val, setter]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ color: '#6699cc', fontSize: 11, marginBottom: 4 }}>{label}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {pures.map((c) => {
                    const d = getCharm(c.ctype); const on = c.id === val
                    return (
                      <button key={c.id} onClick={() => setter(c.id)}
                        style={{ background: on ? '#170f2a' : '#000a18', border: `1px solid ${on ? '#aa88ff' : '#224466'}`, color: '#cce6ff', padding: '5px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                        {on ? '✓ ' : ''}<CIcon ctype={c.ctype} />{charmDisplayName(c)}（HP+{(c.hp || 0) * CHARM_HP_PER}/攻+{c.atk}/特攻+{c.spatk}/防+{c.def}/特防+{c.spdef}）
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <Btn onClick={() => (fromId && toId && fromId !== toId ? setConfirm(true) : flash('継承元と継承先を選んでください'))}>継承する</Btn>
          </div>
        )}

        {tab === 'fuse' && pures.length > 0 && (
          <div style={{ border: '1px solid #663388', background: '#0e0820', padding: 12 }}>
            <div style={{ color: '#c8a0ff', fontSize: 11, marginBottom: 8 }}>🔮 神秘の欠片1つで2つの素材を1つのチャームに（効果も両方引継ぎ・成長は合算で合計300まで）。<span style={{ color: '#ff8866' }}>素材2つは無くなり1つにまとまります。合成済みは再合成不可。</span></div>
            {[['base', '素材①', fuseBase, setFuseBase], ['mat', '素材②', fuseMat, setFuseMat]].map(([key, label, val, setter]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ color: '#9977cc', fontSize: 11, marginBottom: 4 }}>{label}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {pures.map((c) => {
                    const d = getCharm(c.ctype); const on = c.id === val
                    const other = key === 'base' ? fuseMat : fuseBase
                    return (
                      <button key={c.id} onClick={() => !c.fused && c.id !== other && setter(c.id)} disabled={c.fused || c.id === other}
                        style={{ background: on ? '#241640' : '#000a18', border: `1px solid ${on ? '#aa88ff' : '#224466'}`, color: (c.fused || c.id === other) ? '#556' : '#cce6ff', padding: '5px 8px', cursor: (c.fused || c.id === other) ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                        {on ? '✓ ' : ''}<CIcon ctype={c.ctype} />{charmDisplayName(c)}{c.fused ? '（合成済）' : ''}（計{(c.hp || 0) + (c.atk || 0) + (c.spatk || 0) + (c.def || 0) + (c.spdef || 0)}）
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {/* 合成結果のプレビュー */}
            {(() => {
              const b = charms.find((c) => c.id === fuseBase); const m = charms.find((c) => c.id === fuseMat)
              if (!b || !m || b.id === m.id) return <div style={{ color: '#557799', fontSize: 11, marginBottom: 8 }}>素材①②を選ぶと合成結果が表示されます</div>
              // 成長合算（合計300上限・HP→特防→防→特攻→攻 の順に切り捨て）
              let st = { atk: b.atk + m.atk, spatk: b.spatk + m.spatk, def: b.def + m.def, spdef: b.spdef + m.spdef, hp: b.hp + m.hp }
              let over = (st.atk + st.spatk + st.def + st.spdef + st.hp) - 300
              for (const k of ['hp', 'spdef', 'def', 'spatk', 'atk']) { if (over <= 0) break; const cut = Math.min(st[k], over); st[k] -= cut; over -= cut }
              const name = `${getCharm(b.ctype).short}と${getCharm(m.ctype).short}のチャーム`
              const effs = [getCharm(b.ctype).desc, getCharm(m.ctype).desc].filter((x) => x && x !== '追加能力なし')
              return (
                <div style={{ border: '1px solid #aa88ff', background: '#160e2a', padding: 10, marginBottom: 10, fontSize: 11, color: '#cce6ff' }}>
                  <div style={{ color: '#ffcc66', marginBottom: 4 }}>➡ 合成結果</div>
                  <div>🧿 {name}＋{st.atk + st.spatk + st.def + st.spdef + st.hp}</div>
                  <div style={{ color: '#88bbee', marginTop: 2 }}>HP+{st.hp * CHARM_HP_PER} / 攻+{st.atk} / 特攻+{st.spatk} / 防+{st.def} / 特防+{st.spdef}</div>
                  {effs.length > 0 && <div style={{ color: '#aaffaa', marginTop: 2 }}>効果: {effs.join(' ／ ')}</div>}
                </div>
              )
            })()}
            <Btn onClick={() => !loading && doFuse()}>🔮 合成する（欠片×{seeds.shard || 0}）</Btn>

            {/* 合成解除 */}
            {pures.some((c) => c.fused) && (
              <div style={{ marginTop: 14, borderTop: '1px solid #442266', paddingTop: 10 }}>
                <div style={{ color: '#c8a0ff', fontSize: 11, marginBottom: 8 }}>🔓 神秘の欠片1つで合成を解除できます（2つ目の効果が外れ、再び合成できるようになります）。<span style={{ color: '#ff8866' }}>成長値はそのまま残ります。</span></div>
                {pures.filter((c) => c.fused).map((c) => {
                  const d = getCharm(c.ctype); const can = (seeds.shard || 0) >= 1
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <span style={{ color: '#cce6ff', fontSize: 11 }}><CIcon ctype={c.ctype} />{charmDisplayName(c)}{equippedBy(c.id) ? `（${equippedBy(c.id)}）` : ''}</span>
                      <button onClick={() => !loading && doUnfuse(c.id)} disabled={loading || !can}
                        style={{ background: can ? '#1a0e2a' : '#0a0a14', border: `1px solid ${can ? '#aa66ff' : '#332244'}`, color: can ? '#c8a0ff' : '#556', padding: '4px 8px', cursor: can ? 'pointer' : 'not-allowed', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>
                        🔓 合成解除（欠片×1）
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {tab === 'shred' && (
          <div style={{ border: '1px solid #885533', background: '#1a0e04', padding: 12 }}>
            <div style={{ color: '#ddaa77', fontSize: 11, marginBottom: 8 }}>
              ✂️ チャーム/リボンを裁断すると、1個につき<span style={{ color: '#88ffaa' }}>ランダムな素×3</span>に還元されます。<span style={{ color: '#ff8866' }}>元に戻せません。装備中のものは裁断できません。</span>
            </div>
            {(() => {
              const shreddable = charms.filter((c) => !equippedBy(c.id))
              if (!shreddable.length) return <div style={{ color: '#557799', fontSize: 11 }}>裁断できるチャーム/リボンがありません</div>
              const selCount = shreddable.filter((c) => shredSel[c.id]).length
              return (
                <>
                  <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
                    <Btn dim onClick={() => setShredSel(Object.fromEntries(shreddable.map((c) => [c.id, true])))}>すべて選択</Btn>
                    <Btn dim onClick={() => setShredSel({})}>選択解除</Btn>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {shreddable.map((c) => {
                      const d = getCharm(c.ctype); const on = !!shredSel[c.id]
                      return (
                        <button key={c.id} onClick={() => setShredSel((s2) => ({ ...s2, [c.id]: !s2[c.id] }))}
                          style={{ background: on ? '#2a1204' : '#000a18', border: `1px solid ${on ? '#ff9955' : '#224466'}`, color: on ? '#ffcc99' : '#cce6ff', padding: '5px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>
                          {on ? '✂️ ' : ''}<CIcon ctype={c.ctype} />{charmDisplayName(c)}
                        </button>
                      )
                    })}
                  </div>
                  {charms.some((c) => equippedBy(c.id)) && (
                    <div style={{ color: '#557799', fontSize: 10, marginBottom: 8 }}>※装備中（{charms.filter((c) => equippedBy(c.id)).map((c) => `${getCharm(c.ctype).short}=${equippedBy(c.id)}`).join('・')}）は表示されません</div>
                  )}
                  <Btn onClick={() => !loading && doShred()}>✂️ 選択した{selCount}個を裁断（素×{selCount * 3}）</Btn>
                </>
              )
            })()}
          </div>
        )}

        {tab === 'condense' && (
          <div style={{ border: '1px solid #338866', background: '#001a12', padding: 12 }}>
            <div style={{ color: '#88ddaa', fontSize: 11, marginBottom: 10 }}>
              💠 ○○の素10個を「凝縮された○○の素」1個に合成します。凝縮された素は<span style={{ color: '#ff88bb' }}>リボンの強化</span>に使います（リボンも強化合計150まで）。
            </div>
            {STAT_KEYS.map((stat) => {
              const meta = STAT_META[stat]
              const have = seeds[meta.seed] || 0
              const haveC = seeds[`${meta.seed}_c`] || 0
              const canOne = have >= 10
              const maxTimes = Math.floor(have / 10)
              return (
                <div key={stat} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11 }}>
                  <span style={{ width: 40, color: '#cce6ff' }}>{meta.label}</span>
                  <span style={{ width: 78, color: '#88bbee' }}><SeedIcon seed={meta.seed} emoji={meta.emoji} size={13} />素×{have}</span>
                  <span style={{ color: '#557799' }}>→</span>
                  <span style={{ width: 86, color: '#88ddaa', display: 'inline-flex', alignItems: 'center', gap: 2 }}><SeedIcon seed={`${meta.seed}_c`} emoji={CEMOJI[stat]} size={15} />凝縮×{haveC}</span>
                  <button onClick={() => !loading && canOne && condense(stat, 1)} disabled={!canOne}
                    style={{ background: canOne ? '#00281a' : '#0a0f1a', border: `1px solid ${canOne ? '#33aa77' : '#223344'}`, color: canOne ? '#66ddaa' : '#445', padding: '3px 8px', cursor: canOne ? 'pointer' : 'default', fontFamily: 'monospace', fontSize: 11 }}>
                    10→1
                  </button>
                  <button onClick={() => !loading && maxTimes > 1 && condense(stat, maxTimes)} disabled={maxTimes < 2}
                    style={{ background: maxTimes > 1 ? '#00281a' : '#0a0f1a', border: `1px solid ${maxTimes > 1 ? '#33aa77' : '#223344'}`, color: maxTimes > 1 ? '#66ddaa' : '#445', padding: '3px 8px', cursor: maxTimes > 1 ? 'pointer' : 'default', fontFamily: 'monospace', fontSize: 11 }}>
                    まとめて×{Math.max(maxTimes, 0)}
                  </button>
                </div>
              )
            })}
            <div style={{ color: '#557799', fontSize: 10, marginTop: 6 }}>※リボンは五霊の大峡谷の37F以降でドロップ。強化は「強化」タブでリボンを選ぶと凝縮された素を消費します</div>
          </div>
        )}
      </div>

      {/* 合成完了の演出 */}
      {fuseDone && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', fontFamily: 'monospace', pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center', animation: 'bf-fuse-pop 0.5s ease-out' }}>
            <div style={{ fontSize: 52, marginBottom: 6 }}>✨🔮✨</div>
            <div style={{ color: '#ffe680', fontSize: 20, letterSpacing: 2, textShadow: '0 0 12px #aa77ff' }}>合成完了！</div>
            <div style={{ color: '#c9b6ff', fontSize: 15, marginTop: 8 }}>🧿 {fuseDone}</div>
          </div>
          <style>{`@keyframes bf-fuse-pop{0%{transform:scale(0.5);opacity:0}40%{transform:scale(1.15);opacity:1}100%{transform:scale(1);opacity:1}}`}</style>
        </div>
      )}

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
