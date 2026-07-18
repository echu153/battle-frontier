import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { reportDevAccess } from '../lib/devAccess'
import {
  EMBLEM_CRYSTALS, EMBLEM_ALLOC_MAX, EMBLEM_MAX_LEVEL,
  getEmblemRank, EMBLEM_RANK_COLOR, emblemLevelCap, EMBLEM_CAP_UNLOCK_COST,
  emblemLevelUpCost, emblemAllocTotal, calcEmblemBonus, EMBLEM_SHARD_NAME,
} from '../lib/emblem'
import { HACHIGOKU_HELLS } from '../lib/hachigoku'

const fmt = (n) => Number(n).toLocaleString()

export default function Emblem() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [emblem, setEmblem] = useState(null)   // { level, cap_stage, alloc }
  const [items, setItems] = useState({})       // name -> quantity
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!prof) { nav('/create'); return }
    if (!prof.is_admin) reportDevAccess('emblem', '紋章(/emblem)')
    setProfile(prof)
    if (prof.is_admin) await refresh()
  }

  const refresh = async () => {
    try {
      const { data } = await supabase.rpc('emblem_get')
      if (data?.ok) setEmblem({ level: data.level, cap_stage: data.cap_stage, alloc: data.alloc || {} })
      else if (data?.error) setMsg(`紋章の取得に失敗（${data.error}）。SQL未実行の可能性: supabase_emblem_hachigoku.sql`)
    } catch { setMsg('紋章の取得に失敗。SQL未実行の可能性: supabase_emblem_hachigoku.sql') }
    // 素材所持数（結晶/欠片/魂/記憶）
    const { data: { user } } = await supabase.auth.getUser()
    const { data: pi } = await supabase.from('player_items').select('quantity, items(name)').eq('player_id', user.id)
    const map = {}
    for (const row of (pi || [])) { if (row.items?.name) map[row.items.name] = (map[row.items.name] || 0) + (row.quantity || 0) }
    setItems(map)
  }

  const doLevelUp = async (times) => {
    if (busy) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('emblem_level_up', { p_times: times })
    if (error || data?.error) {
      const code = data?.error || error?.message
      setMsg(code === 'not_enough_shards' ? `紋章の成長石が足りません（必要: ${data?.cost}個）`
        : code === 'cap_reached' ? `レベル上限です（上限開放が必要）` : `失敗しました（${code}）`)
    } else {
      setMsg(`✨ 紋章がLV${data.level}になった！（成長石${data.used_shards}個消費）`)
    }
    await refresh(); setBusy(false)
  }

  const doUnlockCap = async () => {
    if (busy) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('emblem_unlock_cap')
    if (error || data?.error) {
      const code = data?.error || error?.message
      setMsg(code === 'not_enough_souls' ? `魂が足りません（${data?.missing} が各${data?.need}個必要）`
        : code === 'not_enough_memories' ? `記憶が足りません（${data?.missing}）。各地獄のHell初回クリアで獲得できます`
        : code === 'not_at_cap' ? `まだ上限に達していません（LV${data?.cap}で開放可能）` : `失敗しました（${code}）`)
    } else {
      setMsg(`🔓 上限開放！ レベル上限がLV${data.new_cap}になった！`)
    }
    await refresh(); setBusy(false)
  }

  const doAllocate = async (key, count) => {
    if (busy) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('emblem_allocate', { p_key: key, p_count: count })
    if (error || data?.error) {
      const code = data?.error || error?.message
      setMsg(code === 'not_enough_crystals' ? `${data?.item}が足りません`
        : code === 'alloc_max' ? `この項目はMAX${EMBLEM_ALLOC_MAX}まで振れます`
        : code === 'level_limit' ? `上限値が足りません（合計${data?.total}／LV${data?.level}）。紋章レベルを上げましょう` : `失敗しました（${code}）`)
    }
    await refresh(); setBusy(false)
  }

  if (!profile) return <div style={{ color:'#66ddff', textAlign:'center', marginTop:'40vh', fontFamily:'monospace' }}>読み込み中...</div>

  // 開発アカウント限定
  if (!profile.is_admin) {
    return (
      <div style={{ minHeight:'100vh', background:'#050a18', padding:'12px', fontFamily:'monospace' }}>
        <div style={{ maxWidth:'640px', margin:'0 auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #1f3a5a', paddingBottom:'8px', marginBottom:'12px', paddingTop:'8px' }}>
            <div style={{ color:'#88bbff', fontSize:'16px', letterSpacing:'3px' }}>💠 紋章</div>
            <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #4466aa', color:'#7799cc', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
          </div>
          <div style={{ border:'1px solid #2a3a6a', background:'#0a1022', padding:'24px', textAlign:'center', color:'#88aadd', fontSize:'13px', lineHeight:'1.9' }}>
            🚧 紋章は現在【開発中】です。<br/>調整が完了するまでお待ちください。
          </div>
        </div>
      </div>
    )
  }

  const level = emblem?.level || 1
  const capStage = emblem?.cap_stage || 0
  const alloc = emblem?.alloc || {}
  const cap = emblemLevelCap(capStage)
  const rank = getEmblemRank(level)
  const total = emblemAllocTotal(alloc)
  const freePoints = Math.max(0, level - total)
  const shards = items[EMBLEM_SHARD_NAME] || 0
  const nextCost = level < cap ? emblemLevelUpCost(level + 1) : null
  const atCap = level >= cap
  const canUnlock = atCap && capStage < 4
  const unlockCost = canUnlock ? EMBLEM_CAP_UNLOCK_COST[capStage] : null
  const bonus = calcEmblemBonus(alloc)
  // 上昇しているステータスだけをチップ化
  const effChips = [
    bonus.flat.atk  > 0 && `攻撃+${bonus.flat.atk}`,
    bonus.flat.def  > 0 && `防御+${bonus.flat.def}`,
    bonus.flat.matk > 0 && `特攻+${bonus.flat.matk}`,
    bonus.flat.mdef > 0 && `特防+${bonus.flat.mdef}`,
    bonus.physDmg   > 0 && `物理ダメ+${bonus.physDmg}%`,
    bonus.specialDmg> 0 && `特殊ダメ+${bonus.specialDmg}%`,
    bonus.defPen    > 0 && `物防貫通+${bonus.defPen}%`,
    bonus.mdefPen   > 0 && `特防貫通+${bonus.mdefPen}%`,
    bonus.dotUp.bleed  > 0 && `出血ダメ+${bonus.dotUp.bleed}%`,
    bonus.dotUp.burn   > 0 && `やけどダメ+${bonus.dotUp.burn}%`,
    bonus.dotUp.poison > 0 && `毒ダメ+${bonus.dotUp.poison}%`,
    bonus.physDrain > 0 && `物理吸収+${bonus.physDrain}%`,
    bonus.specialDrain > 0 && `特殊吸収+${bonus.specialDrain}%`,
    bonus.evasion   > 0 && `回避+${bonus.evasion}%`,
    bonus.crit      > 0 && `クリ率+${bonus.crit}%`,
    bonus.critDmg   > 0 && `クリ威力+${bonus.critDmg}%`,
    bonus.critResist> 0 && `クリ抵抗+${bonus.critResist}%`,
    bonus.ailRes.poison    > 0 && `毒耐性+${bonus.ailRes.poison}%`,
    bonus.ailRes.paralysis > 0 && `麻痺耐性+${bonus.ailRes.paralysis}%`,
    bonus.ailRes.burn      > 0 && `やけど耐性+${bonus.ailRes.burn}%`,
    bonus.ailRes.bleed     > 0 && `出血耐性+${bonus.ailRes.bleed}%`,
    bonus.ailRes.stun      > 0 && `スタン耐性+${bonus.ailRes.stun}%`,
  ].filter(Boolean)

  return (
    <div style={{ minHeight:'100vh', background:'#050a18', padding:'12px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'680px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #1f3a5a', paddingBottom:'8px', marginBottom:'12px', position:'sticky', top:0, zIndex:30, paddingTop:'8px', background:'#050a18' }}>
          <div style={{ color:'#88bbff', fontSize:'16px', letterSpacing:'3px' }}>💠 紋章</div>
          <div style={{ display:'flex', gap:'6px' }}>
            <button onClick={()=>nav('/hachigoku')} style={{ background:'none', border:'1px solid #aa5544', color:'#ff9977', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🔥 八獄へ</button>
            <button onClick={()=>nav('/game')} style={{ background:'none', border:'1px solid #4466aa', color:'#7799cc', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>🏰 街に戻る</button>
          </div>
        </div>

        {/* 紋章本体 */}
        <div style={{ border:'1px solid #2a3a6a', background:'#0a1022', padding:'12px', marginBottom:'10px' }}>
          <div>
            <div style={{ display:'flex', alignItems:'baseline', gap:'10px', flexWrap:'wrap' }}>
              <span style={{ color:'#aaccff', fontSize:'15px', fontWeight:'bold' }}>LV {level}</span>
              <span style={{ color: EMBLEM_RANK_COLOR[rank], fontSize:'14px', fontWeight:'bold' }}>ランク {rank}</span>
              <span style={{ color:'#667799', fontSize:'10px' }}>上限 LV{cap}{capStage < 4 ? '（開放可能: 最大200）' : '（最大）'}</span>
            </div>
            <div style={{ color:'#8899bb', fontSize:'11px', marginTop:'4px' }}>
              上限値: <span style={{ color:'#ffcc66' }}>{total}</span> ／ {level} 使用中
              （残り <span style={{ color: freePoints > 0 ? '#66ff99' : '#667799' }}>{freePoints}</span>）
            </div>
            <div style={{ color:'#667799', fontSize:'10px', marginTop:'2px' }}>
              🧩 紋章の成長石: <span style={{ color:'#ffcc66' }}>{fmt(shards)}</span>個
            </div>
          </div>
          {/* 現在の上昇ステータス（チップ表示） */}
          <div style={{ marginTop:'8px', paddingTop:'8px', borderTop:'1px solid #1a2540' }}>
            <div style={{ color:'#88aadd', fontSize:'10px', marginBottom:'5px' }}>現在の上昇ステータス</div>
            {effChips.length > 0 ? (
              <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
                {effChips.map((c, i) => (
                  <span key={i} style={{ fontSize:'10px', color:'#66dd99', background:'#02201a', border:'1px solid #1a4a3a', borderRadius:'3px', padding:'2px 6px' }}>{c}</span>
                ))}
              </div>
            ) : <div style={{ fontSize:'10px', color:'#556677' }}>結晶を割り振ると効果が表示されます</div>}
          </div>
          <div style={{ color:'#556688', fontSize:'10px', marginTop:'8px', lineHeight:'1.7' }}>
            第5の装備枠。レベルが上がるごとに「上限値」が+1され、八獄で得た結晶を振って能力を強化できる（1項目MAX{EMBLEM_ALLOC_MAX}）。<br/>
            レベルアップには八獄でドロップする「紋章の成長石」を使う（LV2〜50: 1個／〜100: 2個／〜150: 3個／〜200: 4個）。
          </div>
          {/* レベルアップ・上限開放 */}
          <div style={{ display:'flex', gap:'6px', marginTop:'10px', flexWrap:'wrap' }}>
            {!atCap && (
              <>
                <button disabled={busy || shards < (nextCost||1)} onClick={()=>doLevelUp(1)}
                  style={{ padding:'8px 12px', background:'#102040', border:'1px solid #4488ff', color: shards >= (nextCost||1) ? '#88bbff' : '#445577', cursor: shards >= (nextCost||1) ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'11px' }}>
                  ⬆ LVアップ（成長石{nextCost}個）
                </button>
                <button disabled={busy || shards <= 0} onClick={()=>doLevelUp(10)}
                  style={{ padding:'8px 12px', background:'#102040', border:'1px solid #4488ff', color: shards > 0 ? '#88bbff' : '#445577', cursor: shards > 0 ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'11px' }}>
                  ⬆ まとめて+10
                </button>
              </>
            )}
            {canUnlock && (
              <button disabled={busy} onClick={doUnlockCap}
                style={{ padding:'8px 12px', background:'#2a1a00', border:'1px solid #ffcc44', color:'#ffcc66', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
                🔓 上限開放（魂 各{unlockCost.souls}個{unlockCost.memories ? '＋記憶 各1個' : ''}）
              </button>
            )}
          </div>
          {canUnlock && (
            <div style={{ color:'#997744', fontSize:'10px', marginTop:'6px' }}>
              ※開放には八獄8体すべての魂が各{unlockCost.souls}個必要{unlockCost.memories ? '。さらに各地獄Hell初回クリアの「記憶」8種も必要' : ''}。
            </div>
          )}
        </div>

        {msg && <div style={{ border:'1px solid #4466aa', background:'#0c1430', padding:'10px', marginBottom:'10px', color:'#aaccff', fontSize:'11px' }}>{msg}</div>}

        {/* 結晶割り振り（地獄ごとにグループ） */}
        {HACHIGOKU_HELLS.map(h => (
          <div key={h.key} style={{ border:'1px solid #2a3a6a', background:'#0a1022', padding:'10px', marginBottom:'8px' }}>
            <div style={{ color:'#88aadd', fontSize:'11px', marginBottom:'6px' }}>
              {h.name}（{h.boss}）<span style={{ color:'#556688', fontSize:'9px', marginLeft:'6px' }}>{h.theme}</span>
            </div>
            {h.crystals.map(key => {
              const c = EMBLEM_CRYSTALS[key]
              const cur = alloc[key] || 0
              const owned = items[c.name] || 0
              const maxed = cur >= EMBLEM_ALLOC_MAX
              const canPlus = !busy && !maxed && owned > 0 && freePoints > 0
              const plus10 = Math.min(10, EMBLEM_ALLOC_MAX - cur, owned, freePoints)
              return (
                <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderTop:'1px solid #16203a' }}>
                  <div style={{ fontSize:'11px' }}>
                    <span style={{ color:'#aaccff' }}>{c.name}</span>
                    <span style={{ color:'#667799', fontSize:'9px', marginLeft:'6px' }}>{c.label} +{c.per}{c.unit}/1振り</span>
                    <div style={{ fontSize:'9px', color:'#556688', marginTop:'1px' }}>
                      振り: <span style={{ color: maxed ? '#ffcc66' : '#88bbff' }}>{cur}</span>/{EMBLEM_ALLOC_MAX}
                      　効果: <span style={{ color:'#66ff99' }}>+{Math.round(c.per * cur * 10) / 10}{c.unit}</span>
                      　所持: <span style={{ color: owned > 0 ? '#ffcc66' : '#556688' }}>{owned}</span>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:'4px' }}>
                    <button disabled={!canPlus} onClick={()=>doAllocate(key, 1)}
                      style={{ padding:'4px 10px', background: canPlus ? '#102040' : '#0a0e1c', border:`1px solid ${canPlus ? '#4488ff' : '#223355'}`, color: canPlus ? '#88bbff' : '#445577', cursor: canPlus ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'11px' }}>+1</button>
                    <button disabled={!canPlus || plus10 < 2} onClick={()=>doAllocate(key, plus10)}
                      style={{ padding:'4px 8px', background: canPlus && plus10 >= 2 ? '#102040' : '#0a0e1c', border:`1px solid ${canPlus && plus10 >= 2 ? '#4488ff' : '#223355'}`, color: canPlus && plus10 >= 2 ? '#88bbff' : '#445577', cursor: canPlus && plus10 >= 2 ? 'pointer' : 'not-allowed', fontFamily:'monospace', fontSize:'11px' }}>+{plus10 >= 2 ? plus10 : 'n'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        {/* 魂・記憶の所持状況 */}
        <div style={{ border:'1px solid #2a3a6a', background:'#0a1022', padding:'10px', marginBottom:'20px' }}>
          <div style={{ color:'#88aadd', fontSize:'11px', marginBottom:'6px' }}>👹 魂・📿 記憶（上限開放素材）</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px', fontSize:'10px', color:'#8899bb' }}>
            {HACHIGOKU_HELLS.map(h => (
              <div key={h.key}>
                {h.boss}: 魂×<span style={{ color:'#ffcc66' }}>{items[h.soul] || 0}</span>
                ／記憶×<span style={{ color:'#cc88ff' }}>{items[h.memory] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
