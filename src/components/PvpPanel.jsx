// ⚔ 対人戦（PvP）パネル — 開発者限定の先行実装。
// 街メニューのボタンから開く。相手を検索して選び、出撃スキルで殴り合う。
// 与ダメージ-70%／回復-50%／素早さ由来クリ・回避は上限2倍（simulatePvpBattle 側）。
import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { calcEffectiveStats } from '../lib/stats'
import { petPlayerBonus, charmPlayerBonus } from '../constants/pets'
import { BattleLogLine } from '../pages/Game'
import { simulatePvpBattle } from '../lib/pvp'

// 1プレイヤー分の戦闘ロードアウトを読み込む。
//  isSelf=true なら skill_sets を直接、false なら RPC(pvp_get_skillsets) で取得。
async function loadLoadout(playerId, isSelf) {
  const [{ data: profile }, { data: eq }, { data: prof }, { data: pets }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', playerId).single(),
    supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', playerId).eq('equipped', true),
    supabase.from('proficiency').select('player_id, equipment_id, prof_lv').eq('player_id', playerId),
    supabase.from('pets').select('owner_id, species, level, evolved, charm_id').eq('owner_id', playerId).eq('is_active', true),
  ])
  if (!profile) throw new Error('プロフィールが見つかりません')

  // ペット本体ステ(100%)＋装備チャームを反映（Ranking/街と同方式）
  let petStat = null, petCharm = null
  const pet = (pets || [])[0]
  if (pet) {
    petStat = petPlayerBonus(pet)
    if (pet.charm_id) {
      const { data: charm } = await supabase.from('player_charms').select('*').eq('id', pet.charm_id).maybeSingle()
      if (charm) petCharm = charmPlayerBonus(charm)
    }
  }

  // 称号ボーナス
  let titleBonus = null
  if (profile.ability_title_id) {
    const { data: at } = await supabase.from('titles').select('*').eq('id', profile.ability_title_id).maybeSingle()
    titleBonus = at || null
  }

  // 出撃スキルセット
  let skillSets
  if (isSelf) {
    const { data: ss } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', playerId).order('slot_order')
    skillSets = (ss || []).filter(r => (r.set_type || 'sortie') === 'sortie')
  } else {
    const { data: rpc } = await supabase.rpc('pvp_get_skillsets', { p_target: playerId })
    if (rpc?.error) throw new Error(rpc.error)
    skillSets = rpc?.skill_sets || []
  }

  const profileWithPet = { ...profile, petStat, petCharm }
  const eff = calcEffectiveStats(profileWithPet, eq || [], prof || [], titleBonus)
  return { eff, equipment: eq || [], skillSets, proficiency: prof || [], profile: profileWithPet, playerItem: null }
}

export default function PvpPanel({ onClose }) {
  const [meId, setMeId] = useState(null)
  const [myLoadout, setMyLoadout] = useState(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [opponent, setOpponent] = useState(null)   // { id, username, char_lv, class }
  const [logs, setLogs] = useState([])
  const [winner, setWinner] = useState(null)        // 'A'|'B'|'draw'
  const [battling, setBattling] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setMeId(user.id)
      try { setMyLoadout(await loadLoadout(user.id, true)) }
      catch (e) { setError('自分のデータ読込に失敗: ' + e.message) }
    })()
  }, [])

  const doSearch = async () => {
    const q = search.trim()
    if (!q) return
    setSearching(true); setError('')
    const { data } = await supabase.from('profiles')
      .select('id, username, char_lv, class')
      .ilike('username', `%${q}%`)
      .limit(20)
    setResults((data || []).filter(p => p.id !== meId))
    setSearching(false)
  }

  const runBattle = async () => {
    if (!opponent || !myLoadout || battling) return
    setBattling(true); setError(''); setLogs([]); setWinner(null)
    try {
      const oppLoadout = await loadLoadout(opponent.id, false)
      if (!oppLoadout.skillSets.length) {
        setError('相手の出撃スキルが未設定です（全て通常攻撃になります）')
      }
      const { logs: blogs, winner: w, turns, aHpPct, bHpPct } = simulatePvpBattle(myLoadout, oppLoadout)
      setLogs(blogs)
      setWinner(w)
      // 勝敗を一時記録（検証用・失敗は握りつぶす）
      try {
        await supabase.rpc('pvp_record_result', {
          p_opponent: opponent.id,
          p_winner: w === 'A' ? 'challenger' : w === 'B' ? 'opponent' : 'draw',
          p_turns: turns,
          p_a_hp_pct: aHpPct,
          p_b_hp_pct: bHpPct,
        })
      } catch { /* 記録失敗は無視 */ }
    } catch (e) {
      setError('対戦処理に失敗: ' + e.message)
    } finally {
      setBattling(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto', fontFamily: 'monospace' }}>
      <div style={{ background: '#0a0612', border: '1px solid #6a3a9a', maxWidth: '680px', width: '100%', padding: '16px', marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #2a1f5a', paddingBottom: '8px' }}>
          <div style={{ color: '#e0b0ff', fontSize: '15px', letterSpacing: '2px' }}>⚔ 対人戦 <span style={{ color: '#7766aa', fontSize: '10px' }}>(開発者限定)</span></div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #6644aa', color: '#9977cc', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>✕ 閉じる</button>
        </div>

        <div style={{ color: '#88aacc', fontSize: '10px', lineHeight: '1.7', marginBottom: '10px' }}>
          与ダメージ-70%／回復-50%／素早さによるクリ・回避は上限2倍。スキルはお互いの<b>出撃</b>セットを反映。素早さが速い方が先攻。
        </div>

        {!myLoadout && !error && <div style={{ color: '#9977aa', fontSize: '12px' }}>自分のデータを読込中...</div>}

        {/* 相手検索 */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="相手のユーザー名で検索"
            style={{ flex: 1, background: '#120a22', border: '1px solid #4a2a6a', color: '#e0d0ff', padding: '8px', fontFamily: 'monospace', fontSize: '12px' }} />
          <button onClick={doSearch} disabled={searching}
            style={{ background: '#2a1040', border: '1px solid #a060ff', color: '#d0a0ff', padding: '8px 14px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' }}>
            {searching ? '...' : '検索'}
          </button>
        </div>

        {results.length > 0 && (
          <div style={{ display: 'grid', gap: '4px', marginBottom: '10px', maxHeight: '140px', overflowY: 'auto' }}>
            {results.map(p => (
              <button key={p.id} onClick={() => { setOpponent(p); setResults([]); setSearch(p.username) }}
                style={{ textAlign: 'left', background: '#140c22', border: '1px solid #4a2a6a', color: '#c8a0ff', padding: '6px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>
                {p.username} <span style={{ color: '#7766aa' }}>Lv{p.char_lv}・{p.class}</span>
              </button>
            ))}
          </div>
        )}

        {opponent && (
          <div style={{ border: '1px solid #6a3a9a', background: '#140c22', padding: '10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: '#e0b0ff', fontSize: '13px' }}>
              対戦相手: <b>{opponent.username}</b> <span style={{ color: '#7766aa', fontSize: '10px' }}>Lv{opponent.char_lv}・{opponent.class}</span>
            </div>
            <button onClick={runBattle} disabled={battling || !myLoadout}
              style={{ background: battling ? '#140a1c' : '#2a1040', border: `1px solid ${battling ? '#3a2a4a' : '#a060ff'}`, color: battling ? '#5a4a6a' : '#d0a0ff', padding: '8px 18px', cursor: battling ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '1px' }}>
              {battling ? '戦闘中...' : '⚔ 対戦'}
            </button>
          </div>
        )}

        {error && <div style={{ color: '#ff8899', fontSize: '11px', marginBottom: '8px' }}>{error}</div>}

        {logs.length > 0 && (
          <div style={{ border: '1px solid #4a2a6a', background: '#0c0716', padding: '10px' }}>
            {winner && (
              <div style={{ textAlign: 'center', marginBottom: '8px', color: winner === 'draw' ? '#aaaaaa' : '#ffcc44', fontSize: '14px' }}>
                {winner === 'A' ? `🏆 ${myLoadout?.profile?.username} の勝利！`
                  : winner === 'B' ? `💀 ${opponent?.username} の勝利…`
                  : '🤝 引き分け'}
              </div>
            )}
            <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {logs.map((l, i) => <BattleLogLine key={i} l={l} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
