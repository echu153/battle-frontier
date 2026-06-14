import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { calcEffectiveTotal, getTotalRank } from '../lib/stats'
import { charmPlayerBonus, petStats, applyCharmStats, speciesLabel, speciesEmoji, getCharm, charmDisplayName, petImage } from '../constants/pets'

// ペット1体の能力合計（チャーム込み）。プレイヤー総合力と同じ重み付け。
const petTotalPower = (pet, charm) => {
  const st = applyCharmStats(petStats(pet), charm || null)
  return Math.floor(st.maxHp / 10) + st.atk + st.def + st.mdef
}

export default function Ranking() {
  const nav = useNavigate()
  const [players, setPlayers] = useState([])
  const [museumPlayers, setMuseumPlayers] = useState([])
  const [medalPlayers, setMedalPlayers] = useState([])
  const [abyssPlayers, setAbyssPlayers] = useState([])
  const [petRanking, setPetRanking] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [tab, setTab] = useState('total')

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setCurrentUserId(user.id)
      // ランキング集計除外アカウント（dev/テスト用）。列が無い環境でも落ちないよう握りつぶす。
      let excluded = new Set()
      try {
        const { data: exRows } = await supabase.from('profiles').select('id').eq('exclude_from_ranking', true)
        excluded = new Set((exRows || []).map(r => r.id))
      } catch { /* 列未追加なら除外なし */ }
      const { data } = await supabase
        .from('profiles')
        .select('id, username, lv, char_lv, class, hp_max, mp_max, atk, def, matk, mdef, spd, avatar_url, retraining, museum_atk, museum_def, museum_matk, museum_mdef, museum_spd, museum_hp, museum_mp, fishing_atk, fishing_def, fishing_matk, fishing_mdef, fishing_spd, fishing_hp, fishing_mp, ability_title_id')
        .order('char_lv', { ascending: false })
        .limit(50)
      const list = (data || []).filter(p => !excluded.has(p.id))
      const ids = list.map(p => p.id)
      let eqs = [], profs = [], titleMap = {}, charmMap = {}
      if (ids.length > 0) {
        const [{ data: eqData }, { data: profData }, { data: petData }] = await Promise.all([
          supabase.from('player_equipment').select('*, weapons(*)').in('player_id', ids).eq('equipped', true),
          supabase.from('proficiency').select('player_id, equipment_id, prof_lv').in('player_id', ids),
          // 街と同じくアクティブペットの装備チャームを総合力に反映
          supabase.from('pets').select('owner_id, charm_id').in('owner_id', ids).eq('is_active', true),
        ])
        eqs = eqData || []
        profs = profData || []
        const charmIds = [...new Set((petData || []).map(p => p.charm_id).filter(Boolean))]
        if (charmIds.length > 0) {
          const { data: charmRows } = await supabase.from('player_charms').select('*').in('id', charmIds)
          const charmById = {}
          for (const c of (charmRows || [])) charmById[c.id] = c
          for (const pet of (petData || [])) {
            if (pet.charm_id && charmById[pet.charm_id]) charmMap[pet.owner_id] = charmPlayerBonus(charmById[pet.charm_id])
          }
        }
      }
      const titleIds = [...new Set(list.map(p => p.ability_title_id).filter(Boolean))]
      if (titleIds.length > 0) {
        const { data: titlesData } = await supabase.from('titles').select('*').in('id', titleIds)
        for (const t of (titlesData || [])) titleMap[t.id] = t
      }
      const withTotal = list.map(p => {
        const eq = eqs.filter(e => e.player_id === p.id)
        const pf = profs.filter(x => x.player_id === p.id)
        const tb = p.ability_title_id ? titleMap[p.ability_title_id] : null
        const pProfile = { ...p, petCharm: charmMap[p.id] || null }
        return { ...p, _total: calcEffectiveTotal(pProfile, eq, pf, tb) }
      })
      const sorted = withTotal.sort((a, b) => b._total - a._total)
      setPlayers(sorted)

      // 博物館寄贈数ランキング
      const { data: dons } = await supabase.from('museum_donations').select('player_id')
      const counts = {}
      for (const d of (dons || [])) counts[d.player_id] = (counts[d.player_id] || 0) + 1
      const topIds = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 50)
      const mIds = topIds.map(([id]) => id)
      let mMap = {}
      if (mIds.length > 0) {
        const { data: mProfs } = await supabase
          .from('profiles')
          .select('id, username, lv, char_lv, class, avatar_url, retraining')
          .in('id', mIds)
        for (const p of (mProfs || [])) mMap[p.id] = p
      }
      const museumList = topIds
        .map(([id, count]) => ({ ...(mMap[id] || { id, username: '???' }), _count: count }))
        .filter(p => p.username && !excluded.has(p.id))
      setMuseumPlayers(museumList)

      // メダルランキング：1日の最高ネット収支（勝ち負けを差し引いた額・両替除く。マイナスも集計）
      const { data: medalData } = await supabase
        .from('profiles')
        .select('id, username, lv, char_lv, class, avatar_url, retraining, gambling_medal_max_daily')
        .not('gambling_medal_max_daily', 'is', null)
        .order('gambling_medal_max_daily', { ascending: false })
        .limit(50)
      setMedalPlayers((medalData || []).filter(p => !excluded.has(p.id)))

      // 奈落闘技場 踏破ランキング（到達階の深い順）
      const { data: abyssData } = await supabase.rpc('get_abyss_ranking')
      setAbyssPlayers((Array.isArray(abyssData) ? abyssData : []).filter(p => !excluded.has(p.id)))

      // ペット能力合計ランキング（チャーム込み・1体ごと）
      const { data: allPets } = await supabase.from('pets').select('id, owner_id, name, species, level, evolved, image_url, charm_id')
      const petList = (allPets || []).filter(p => !excluded.has(p.owner_id))
      // チャーム読み込み
      const petCharmIds = [...new Set(petList.map(p => p.charm_id).filter(Boolean))]
      let petCharmById = {}
      if (petCharmIds.length > 0) {
        const { data: pcRows } = await supabase.from('player_charms').select('*').in('id', petCharmIds)
        for (const c of (pcRows || [])) petCharmById[c.id] = c
      }
      // 飼い主名
      const ownerIds = [...new Set(petList.map(p => p.owner_id).filter(Boolean))]
      let ownerById = {}
      if (ownerIds.length > 0) {
        const { data: ownerRows } = await supabase.from('profiles').select('id, username, avatar_url').in('id', ownerIds)
        for (const o of (ownerRows || [])) ownerById[o.id] = o
      }
      const petsWithPower = petList.map(p => {
        const charm = p.charm_id ? petCharmById[p.charm_id] : null
        return { ...p, _charm: charm, _owner: ownerById[p.owner_id] || null, _power: petTotalPower(p, charm) }
      }).sort((a, b) => b._power - a._power).slice(0, 50)
      setPetRanking(petsWithPower)

      setLoading(false)
    }
    init()
  }, [])

  const getStars = (p) => {
    const count = (p.retraining || {})[p.class] || 0
    return '★'.repeat(count)
  }

  // 奈落ランキングの順位（到達階＋撃破ターンが同じなら同順位）
  const abyssRanks = []
  for (let i = 0; i < abyssPlayers.length; i++) {
    const p = abyssPlayers[i], prev = abyssPlayers[i - 1]
    const sameAsPrev = i > 0 && prev.cleared_floor === p.cleared_floor && (prev.last_clear_turns ?? -1) === (p.last_clear_turns ?? -1)
    abyssRanks.push(sameAsPrev ? abyssRanks[i - 1] : i + 1)
  }

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'12px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'14px', letterSpacing:'2px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/game')}
            style={{ background:'none', border:'1px solid #0088ff', color:'#0088ff', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
            ← 戻る
          </button>
        </div>

        {/* タブ切り替え */}
        <div style={{ display:'flex', gap:'6px', marginBottom:'12px' }}>
          {[{ id:'total', label:'🏆 総合力' }, { id:'abyss', label:'🕯 奈落' }, { id:'museum', label:'🏛 寄贈数' }, { id:'medal', label:'🎫 メダル' }, { id:'pet', label:'🐾 ペット' }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                flex:1, padding:'8px', fontFamily:'monospace', fontSize:'12px', cursor:'pointer',
                background: tab === t.id ? '#1a1000' : '#000e1a',
                border:`1px solid ${tab === t.id ? '#ffcc00' : '#003366'}`,
                color: tab === t.id ? '#ffcc00' : '#446688',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 見出し */}
        <div style={{ color:'#ffcc00', fontSize:'13px', marginBottom:'10px', textAlign:'center', letterSpacing:'2px' }}>
          {tab === 'total' ? '🏆 総合力ランキング' : tab === 'pet' ? '🐾 ペット能力ランキング（チャーム込み）' : tab === 'abyss' ? '🕯 奈落闘技場 踏破ランキング' : tab === 'museum' ? '🏛 寄贈数ランキング' : '🎫 1日最高収支メダルランキング'}
        </div>

        {loading ? (
          <div style={{ color:'#446688', textAlign:'center' }}>読み込み中...</div>
        ) : tab === 'total' ? (
          <div>
            {players.map((p, i) => {
              const total = p._total
              const totalRank = getTotalRank(total)
              const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
              const isMe = p.id === currentUserId
              const stars = getStars(p)
              return (
                <div key={p.id}
                  onClick={() => nav(`/profile/${p.id}`)}
                  style={{
                    display:'flex', alignItems:'center', gap:'8px',
                    padding:'8px 10px',
                    marginBottom:'4px',
                    border:`1px solid ${isMe ? '#0066cc' : '#001a33'}`,
                    background: isMe ? '#001830' : i === 0 ? '#1a1000' : '#000e1a',
                    cursor:'pointer',
                    borderRadius:'2px',
                  }}
                >
                  {/* 順位 */}
                  <div style={{ minWidth:'28px', textAlign:'center' }}>
                    {medal
                      ? <span style={{ fontSize:'16px' }}>{medal}</span>
                      : <span style={{ color:'#446688', fontSize:'11px' }}>{i+1}</span>
                    }
                  </div>

                  {/* アバター */}
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="avatar" style={{ width:'36px', height:'36px', objectFit:'cover', flexShrink:0 }} />
                    : <div style={{ width:'36px', height:'36px', background:'#001428', border:'1px solid #003366', flexShrink:0 }} />
                  }

                  {/* 名前・クラス */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color: isMe ? '#44ff88' : '#88ccff', fontSize:'12px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {p.username}{isMe && <span style={{color:'#44ff88', fontSize:'10px'}}> (自分)</span>}
                    </div>
                    <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>
                      {p.class}<span style={{color:'#ffcc00'}}>{stars}</span> <span style={{color:'#ffcc00'}}>LV{p.char_lv || p.lv}</span>
                    </div>
                  </div>

                  {/* 総合力・ランク */}
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ color:'#44ff88', fontSize:'13px', fontWeight:'bold' }}>{total}</div>
                    <div style={{ color: totalRank.color, fontSize:'11px', fontWeight:'bold' }}>{totalRank.rank}</div>
                  </div>
                </div>
              )
            })}

            {players.length === 0 && (
              <div style={{ color:'#334455', padding:'20px', textAlign:'center', fontSize:'12px' }}>
                まだプレイヤーがいません
              </div>
            )}
          </div>
        ) : tab === 'pet' ? (
          <div>
            {petRanking.map((p, i) => {
              const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
              const isMe = p.owner_id === currentUserId
              const charmName = p._charm ? charmDisplayName(p._charm) : null
              return (
                <div key={p.id}
                  onClick={() => p._owner && nav(`/profile/${p.owner_id}`)}
                  style={{
                    display:'flex', alignItems:'center', gap:'8px',
                    padding:'8px 10px', marginBottom:'4px',
                    border:`1px solid ${isMe ? '#0066cc' : '#1a2a33'}`,
                    background: isMe ? '#001830' : i === 0 ? '#0a1a14' : '#0a1410',
                    cursor:'pointer', borderRadius:'2px',
                  }}
                >
                  {/* 順位 */}
                  <div style={{ minWidth:'28px', textAlign:'center' }}>
                    {medal ? <span style={{ fontSize:'16px' }}>{medal}</span> : <span style={{ color:'#558866', fontSize:'11px' }}>{i+1}</span>}
                  </div>

                  {/* ペットアイコン（設定画像優先・無ければ絵文字） */}
                  {petImage(p)
                    ? <img src={petImage(p)} alt="" style={{ width:'36px', height:'36px', objectFit:'cover', background:'#0c1a12', border:'1px solid #1a3322', flexShrink:0 }} />
                    : <div style={{ width:'36px', height:'36px', display:'flex', alignItems:'center', justifyContent:'center', background:'#0c1a12', border:'1px solid #1a3322', flexShrink:0, fontSize:'20px' }}>{speciesEmoji(p)}</div>
                  }

                  {/* ペット名・種族・飼い主 */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color: isMe ? '#44ff88' : '#88ffcc', fontSize:'12px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {p.name || speciesLabel(p)}{p.evolved && <span style={{ color:'#ffcc00', fontSize:'10px' }}> ✦</span>}
                    </div>
                    <div style={{ color:'#558866', fontSize:'10px', marginTop:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {speciesLabel(p)} Lv{p.level || 1}
                      {charmName && <span style={{ color:'#ff88cc' }}> ・{charmName}</span>}
                    </div>
                    <div style={{ color:'#446688', fontSize:'9px', marginTop:'1px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      👤 {p._owner?.username || '???'}{isMe && <span style={{ color:'#44ff88' }}> (自分)</span>}
                    </div>
                  </div>

                  {/* 能力合計 */}
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ color:'#44ffaa', fontSize:'15px', fontWeight:'bold' }}>{p._power}</div>
                    <div style={{ color:'#558866', fontSize:'10px' }}>能力合計</div>
                  </div>
                </div>
              )
            })}

            {petRanking.length === 0 && (
              <div style={{ color:'#334455', padding:'20px', textAlign:'center', fontSize:'12px' }}>
                まだペットがいません
              </div>
            )}
          </div>
        ) : tab === 'museum' ? (
          <div>
            {museumPlayers.map((p, i) => {
              const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
              const isMe = p.id === currentUserId
              const stars = getStars(p)
              return (
                <div key={p.id}
                  onClick={() => nav(`/profile/${p.id}`)}
                  style={{
                    display:'flex', alignItems:'center', gap:'8px',
                    padding:'8px 10px',
                    marginBottom:'4px',
                    border:`1px solid ${isMe ? '#0066cc' : '#001a33'}`,
                    background: isMe ? '#001830' : i === 0 ? '#1a1000' : '#000e1a',
                    cursor:'pointer',
                    borderRadius:'2px',
                  }}
                >
                  {/* 順位 */}
                  <div style={{ minWidth:'28px', textAlign:'center' }}>
                    {medal
                      ? <span style={{ fontSize:'16px' }}>{medal}</span>
                      : <span style={{ color:'#446688', fontSize:'11px' }}>{i+1}</span>
                    }
                  </div>

                  {/* アバター */}
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="avatar" style={{ width:'36px', height:'36px', objectFit:'cover', flexShrink:0 }} />
                    : <div style={{ width:'36px', height:'36px', background:'#001428', border:'1px solid #003366', flexShrink:0 }} />
                  }

                  {/* 名前・クラス */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color: isMe ? '#44ff88' : '#88ccff', fontSize:'12px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {p.username}{isMe && <span style={{color:'#44ff88', fontSize:'10px'}}> (自分)</span>}
                    </div>
                    <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>
                      {p.class}<span style={{color:'#ffcc00'}}>{stars}</span> <span style={{color:'#ffcc00'}}>LV{p.char_lv || p.lv}</span>
                    </div>
                  </div>

                  {/* 寄贈数 */}
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ color:'#ffaa44', fontSize:'15px', fontWeight:'bold' }}>{p._count}</div>
                    <div style={{ color:'#886644', fontSize:'10px' }}>寄贈</div>
                  </div>
                </div>
              )
            })}

            {museumPlayers.length === 0 && (
              <div style={{ color:'#334455', padding:'20px', textAlign:'center', fontSize:'12px' }}>
                まだ寄贈したプレイヤーがいません
              </div>
            )}
          </div>
        ) : tab === 'medal' ? (
          <div>
            {medalPlayers.map((p, i) => {
              const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
              const isMe = p.id === currentUserId
              const stars = getStars(p)
              return (
                <div key={p.id}
                  onClick={() => nav(`/profile/${p.id}`)}
                  style={{
                    display:'flex', alignItems:'center', gap:'8px',
                    padding:'8px 10px',
                    marginBottom:'4px',
                    border:`1px solid ${isMe ? '#0066cc' : '#001a33'}`,
                    background: isMe ? '#001830' : i === 0 ? '#1a1000' : '#000e1a',
                    cursor:'pointer',
                    borderRadius:'2px',
                  }}
                >
                  {/* 順位 */}
                  <div style={{ minWidth:'28px', textAlign:'center' }}>
                    {medal
                      ? <span style={{ fontSize:'16px' }}>{medal}</span>
                      : <span style={{ color:'#446688', fontSize:'11px' }}>{i+1}</span>
                    }
                  </div>

                  {/* アバター */}
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="avatar" style={{ width:'36px', height:'36px', objectFit:'cover', flexShrink:0 }} />
                    : <div style={{ width:'36px', height:'36px', background:'#001428', border:'1px solid #003366', flexShrink:0 }} />
                  }

                  {/* 名前・クラス */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color: isMe ? '#44ff88' : '#88ccff', fontSize:'12px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {p.username}{isMe && <span style={{color:'#44ff88', fontSize:'10px'}}> (自分)</span>}
                    </div>
                    <div style={{ color:'#446688', fontSize:'10px', marginTop:'2px' }}>
                      {p.class}<span style={{color:'#ffcc00'}}>{stars}</span> <span style={{color:'#ffcc00'}}>LV{p.char_lv || p.lv}</span>
                    </div>
                  </div>

                  {/* 1日の最高ネット収支（マイナスもあり） */}
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ color:(p.gambling_medal_max_daily||0) < 0 ? '#ff6666' : '#ffaa00', fontSize:'15px', fontWeight:'bold' }}>🎫 {(p.gambling_medal_max_daily || 0).toLocaleString()}</div>
                    <div style={{ color:'#886644', fontSize:'10px' }}>1日最高収支</div>
                  </div>
                </div>
              )
            })}

            {medalPlayers.length === 0 && (
              <div style={{ color:'#334455', padding:'20px', textAlign:'center', fontSize:'12px' }}>
                まだメダルを獲得したプレイヤーがいません
              </div>
            )}
          </div>
        ) : (
          <div>
            {abyssPlayers.map((p, i) => {
              const rank = abyssRanks[i]
              const medal = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
              const isMe = p.id === currentUserId
              const stars = getStars(p)
              return (
                <div key={p.id}
                  onClick={() => nav(`/profile/${p.id}`)}
                  style={{
                    display:'flex', alignItems:'center', gap:'8px',
                    padding:'8px 10px', marginBottom:'4px',
                    border:`1px solid ${isMe ? '#0066cc' : '#2a1840'}`,
                    background: isMe ? '#001830' : rank === 1 ? '#160c26' : '#0d0a18',
                    cursor:'pointer', borderRadius:'2px',
                  }}
                >
                  <div style={{ minWidth:'28px', textAlign:'center' }}>
                    {medal ? <span style={{ fontSize:'16px' }}>{medal}</span> : <span style={{ color:'#7766aa', fontSize:'11px' }}>{rank}</span>}
                  </div>
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="avatar" style={{ width:'36px', height:'36px', objectFit:'cover', flexShrink:0 }} />
                    : <div style={{ width:'36px', height:'36px', background:'#100a1c', border:'1px solid #2a1840', flexShrink:0 }} />
                  }
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color: isMe ? '#44ff88' : '#c8a8ff', fontSize:'12px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {p.username}{isMe && <span style={{color:'#44ff88', fontSize:'10px'}}> (自分)</span>}
                    </div>
                    <div style={{ color:'#7766aa', fontSize:'10px', marginTop:'2px' }}>
                      {p.class}<span style={{color:'#ffcc00'}}>{stars}</span> <span style={{color:'#ffcc00'}}>LV{p.char_lv || p.lv}</span>
                    </div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ color:'#d0a0ff', fontSize:'15px', fontWeight:'bold' }}>地下{p.cleared_floor}階</div>
                    <div style={{ color:'#7766aa', fontSize:'10px' }}>{p.last_clear_turns ? `${p.last_clear_turns}ターン撃破` : '到達'}</div>
                  </div>
                </div>
              )
            })}

            {abyssPlayers.length === 0 && (
              <div style={{ color:'#334455', padding:'20px', textAlign:'center', fontSize:'12px' }}>
                まだ奈落に挑んだプレイヤーがいません
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
