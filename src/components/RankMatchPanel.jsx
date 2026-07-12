// 🏅 ランクマッチ — 対人戦のレート戦（is_admin限定の先行実装）。
// 初期レート1000・Elo変動(K=32)・マッチング=レート±100ランダム・挑戦は1時間1回。
// シーズン=月次(JST)。終了後に最終順位に応じてGold報酬（rank_claim_season_reward）。
// 戦闘エンジンは対人戦/組み手と共通(simulatePvpBattle・HP補正なし)。要SQL: supabase_rank_match.sql
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { BattleLogLine } from '../pages/Game'
import { simulatePvpBattle } from '../lib/pvp'
import { loadLoadout } from '../lib/pvpLoadout'

const fmtCd = (sec) => {
  const m = Math.floor(sec / 60), s = sec % 60
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`
}

export default function RankMatchPanel({ onClose, isAdmin = false }) {
  const [state, setState] = useState(null)      // rank_get_state の結果
  const [cd, setCd] = useState(0)               // CD残秒（クライアント側カウントダウン）
  const [opponent, setOpponent] = useState(null)
  const [result, setResult] = useState(null)    // { delta, newRating }
  const [logs, setLogs] = useState([])
  const [winner, setWinner] = useState(null)
  const [phase, setPhase] = useState('idle')    // idle | matching | battling
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const meRef = useRef(null)                    // 自分のロードアウト（対戦時に読込）

  const refresh = async () => {
    const { data, error: e } = await supabase.rpc('rank_get_state')
    if (e || data?.error) { setError(data?.error || e.message); return }
    setState(data)
    setCd(data.cd_remain || 0)
  }
  useEffect(() => { refresh() }, [])

  // CDカウントダウン
  useEffect(() => {
    if (cd <= 0) return
    const iv = setInterval(() => setCd((v) => Math.max(0, v - 1)), 1000)
    return () => clearInterval(iv)
  }, [cd > 0])

  const findMatch = async () => {
    if (phase !== 'idle') return
    setError(''); setNotice(''); setOpponent(null); setLogs([]); setWinner(null); setResult(null)
    setPhase('matching')
    try {
      const { data, error: e } = await supabase.rpc('rank_find_opponent')
      if (e) throw new Error(e.message)
      if (data?.error) {
        setError(data.error)
        if (data.cd_remain) setCd(data.cd_remain)
        return
      }
      setOpponent(data.opponent)
      setNotice(data.resumed
        ? '前回未消化のマッチを再開します。'
        : `マッチ成立！ レート${data.opponent.rating}の相手が見つかりました。`)
    } catch (e) {
      setError('マッチングに失敗: ' + e.message)
    } finally {
      setPhase('idle')
    }
  }

  const runBattle = async () => {
    if (!opponent || phase !== 'idle') return
    setPhase('battling'); setError(''); setLogs([]); setWinner(null); setResult(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!meRef.current) meRef.current = await loadLoadout(user.id, true)
      const oppLoadout = await loadLoadout(opponent.id, false)
      // ランクマッチはHP補正なし（組み手と同じ素のステ）。ルール行はパネル常設のためログから省く
      const { logs: blogs, winner: w, turns, aHpPct, bHpPct } = simulatePvpBattle(meRef.current, oppLoadout, { hideRuleLine: true })
      setLogs(blogs)
      setWinner(w)
      const { data, error: e } = await supabase.rpc('rank_report_result', {
        p_winner: w === 'A' ? 'challenger' : w === 'B' ? 'opponent' : 'draw',
        p_turns: turns,
        p_a_hp_pct: aHpPct,
        p_b_hp_pct: bHpPct,
      })
      if (e) throw new Error(e.message)
      if (data?.error) throw new Error(data.error)
      setResult({ delta: data.delta, newRating: data.new_rating })
      setOpponent(null)
      await refresh()
    } catch (e) {
      setError('結果の確定に失敗: ' + e.message)
    } finally {
      setPhase('idle')
    }
  }

  const claimReward = async () => {
    const prev = state?.prev_season
    if (!prev || prev.claimed) return
    setError(''); setNotice('')
    const { data, error: e } = await supabase.rpc('rank_claim_season_reward', { p_season: prev.season })
    if (e || data?.error) { setError(data?.error || e.message); return }
    setNotice(`🎁 ${prev.season}シーズン ${data.rank}位の報酬 ${data.reward}G を受け取りました！`)
    await refresh()
  }

  const devResetCd = async () => {
    await supabase.rpc('rank_dev_reset_cd')
    setError(''); setNotice('[開発] CDをリセットしました')
    await refresh()
  }

  const onCooldown = cd > 0
  const prev = state?.prev_season

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto', fontFamily: 'monospace' }}>
      <div style={{ background: '#0a0e06', border: '1px solid #9a8a3a', maxWidth: '680px', width: '100%', padding: '16px', marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #5a4f1f', paddingBottom: '8px' }}>
          <div style={{ color: '#ffd75e', fontSize: '15px', letterSpacing: '2px' }}>🏅 ランクマッチ <span style={{ color: '#997733', fontSize: '10px' }}>(開発者限定)</span></div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #8a7a44', color: '#ccaa77', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>✕ 閉じる</button>
        </div>

        <div style={{ border: '1px solid #4a4426', background: '#0c0e06', padding: '8px 10px', marginBottom: '10px', color: '#ccaa88', fontSize: '10px', lineHeight: '1.8' }}>
          <div style={{ color: '#ffd75e', marginBottom: '2px' }}>📜 ルール</div>
          ・初期レート<b>1000</b>。勝敗でレートが変動<br />
          ・マッチングは<b>レート±100</b>からランダム<br />
          ・挑戦は<b>1時間に1回</b><span style={{ color: '#998855' }}>（開発中はCDなし）</span><br />
          ・シーズン制。<span style={{ color: '#998855' }}>報酬などの詳細は後日発表</span><br />
          ・<b>50ターン</b>で強制終了＝与ダメージ総量で勝敗<br />
          ・防御で大きく軽減・回復は通常<br />
          ・素早さで回避・クリティカル最大<b>1.5倍</b>
        </div>

        {!state && !error && <div style={{ color: '#998866', fontSize: '12px' }}>データを読込中...</div>}

        {state && (
          <div style={{ border: '1px solid #5a4f1f', background: '#0e1206', padding: '10px', marginBottom: '10px', display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' }}>
            <span style={{ color: '#ffd75e' }}>シーズン {state.season}</span>
            <span style={{ color: '#ffee99' }}>レート <b style={{ fontSize: '15px' }}>{state.rating}</b>{state.my_rank ? <span style={{ color: '#bb9955', fontSize: '10px' }}>（{state.my_rank}位）</span> : null}</span>
            <span style={{ color: '#99cc88' }}>{state.wins}勝 {state.losses}敗{state.draws > 0 ? ` ${state.draws}分` : ''}</span>
            {onCooldown && <span style={{ color: '#ff9955' }}>⏳ 次の挑戦まで {fmtCd(cd)}</span>}
          </div>
        )}

        {/* 前シーズン報酬 */}
        {prev && (
          <div style={{ border: '1px solid #8a6a1a', background: '#140f02', padding: '10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ color: '#ffd75e', fontSize: '11px' }}>
              🎁 {prev.season}シーズン結果: <b>{prev.rank}位</b>（レート{prev.rating}）→ 報酬 <b>{prev.reward}G</b>
            </span>
            {prev.claimed
              ? <span style={{ color: '#667755', fontSize: '11px' }}>受け取り済み</span>
              : <button onClick={claimReward} style={{ background: '#1a1204', border: '1px solid #aa8833', color: '#ffd75e', padding: '5px 12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>受け取る</button>}
          </div>
        )}

        {/* マッチング */}
        {state && (
          <button onClick={findMatch} disabled={phase !== 'idle' || onCooldown || !!opponent}
            style={{ width: '100%', padding: '12px', marginBottom: '10px',
              background: onCooldown ? '#0c0e08' : '#141a06', border: `1px solid ${onCooldown ? '#3a3a2a' : '#c0a83a'}`,
              color: onCooldown ? '#555544' : '#ffd75e', cursor: (phase !== 'idle' || onCooldown || opponent) ? 'not-allowed' : 'pointer',
              fontFamily: 'monospace', fontSize: '13px', letterSpacing: '1px' }}>
            {onCooldown ? `⏳ クールダウン中（残り ${fmtCd(cd)}）` : phase === 'matching' ? 'マッチング中...' : '🎲 ランクマッチ開始（レート±100）'}
          </button>
        )}
        {/* 開発中はis_adminのCDが0秒（SQL側で免除）のためリセットボタンは通常出ない。万一の保険で残す */}
        {isAdmin && onCooldown && (
          <button onClick={devResetCd} style={{ width: '100%', padding: '6px', marginTop: '-4px', marginBottom: '10px', background: '#0a0a14', border: '1px dashed #445', color: '#778', cursor: 'pointer', fontFamily: 'monospace', fontSize: '10px' }}>🛠 [開発] CDリセット</button>
        )}

        {notice && <div style={{ color: '#ffcc66', fontSize: '11px', marginBottom: '8px' }}>{notice}</div>}
        {error && <div style={{ color: '#ff8899', fontSize: '11px', marginBottom: '8px' }}>{error}</div>}

        {/* 対戦相手＆対戦ボタン */}
        {opponent && (
          <div style={{ border: '1px solid #9a8a3a', background: '#12160a', padding: '10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ color: '#ffe699', fontSize: '13px' }}>
              対戦相手: <b>{opponent.username}</b> <span style={{ color: '#998855', fontSize: '10px' }}>LV{opponent.char_lv}・{opponent.class}・レート{opponent.rating}</span>
            </div>
            <button onClick={runBattle} disabled={phase !== 'idle'}
              style={{ background: phase !== 'idle' ? '#0c0e08' : '#241c04', border: `1px solid ${phase !== 'idle' ? '#3a3a2a' : '#e0c04a'}`, color: phase !== 'idle' ? '#555544' : '#ffe066', padding: '8px 18px', cursor: phase !== 'idle' ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '1px' }}>
              {phase === 'battling' ? '戦闘中...' : '⚔ 対戦する'}
            </button>
          </div>
        )}

        {/* 結果（レート変動） */}
        {result && (
          <div style={{ border: '1px solid #5a4f1f', background: '#10140a', padding: '10px', marginBottom: '10px', textAlign: 'center' }}>
            <span style={{ color: result.delta >= 0 ? '#88ff99' : '#ff8888', fontSize: '14px' }}>
              レート {result.delta >= 0 ? '+' : ''}{result.delta} → <b>{result.newRating}</b>
            </span>
          </div>
        )}

        {/* バトルログ */}
        {logs.length > 0 && (
          <div style={{ border: '1px solid #4a4426', background: '#0a0c06', padding: '10px', marginBottom: '10px' }}>
            {winner && (
              <div style={{ textAlign: 'center', marginBottom: '8px', color: winner === 'draw' ? '#aaaaaa' : '#ffcc44', fontSize: '14px' }}>
                {winner === 'A' ? '🏆 勝利！' : winner === 'B' ? '💀 敗北…' : '🤝 引き分け'}
              </div>
            )}
            <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
              {logs.map((l, i) => <BattleLogLine key={i} l={l} />)}
            </div>
          </div>
        )}

        {/* シーズンランキング */}
        {state?.leaderboard?.length > 0 && (
          <div style={{ border: '1px solid #4a4426', background: '#0a0c06', padding: '10px' }}>
            <div style={{ color: '#ccaa66', fontSize: '11px', marginBottom: '6px' }}>🏆 シーズンランキング（上位50）</div>
            <div style={{ display: 'grid', gap: '2px', maxHeight: '240px', overflowY: 'auto' }}>
              {state.leaderboard.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '3px 6px',
                  background: i < 3 ? '#141204' : 'transparent', color: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#aa9977' }}>
                  <span>{i + 1}. {r.username} <span style={{ color: '#665533', fontSize: '10px' }}>{r.wins}勝{r.losses}敗</span></span>
                  <span style={{ color: '#ffe699' }}>{r.rating}</span>
                </div>
              ))}
            </div>
            <div style={{ color: '#665533', fontSize: '9px', marginTop: '6px' }}>
              シーズン報酬の詳細は後日発表
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
