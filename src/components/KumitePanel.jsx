// 🥊 組み手 — 対人戦の準備施設（開発者限定の先行実装。正式な対人戦を実装したら削除予定）。
// 総合力±10%の相手とランダムマッチ（該当者なしならマッチ不可）、または総合力上位10人から選んで対戦。
// 報酬は無し。HP補正なし＝素のステで戦う。戦闘エンジンは対人戦と共通(simulatePvpBattle)。
import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { BattleLogLine } from '../pages/Game'
import { simulatePvpBattle } from '../lib/pvp'
import { loadLoadout, loadTotalCandidates } from '../lib/pvpLoadout'

const MATCH_RANGE = 0.10  // ランダムマッチの総合力許容幅（±10%）
const TOP_N = 10          // 選択対戦に出す総合力上位人数

// eff から総合力を算出（calcEffectiveTotal と同式）。自分の総合力表示・±判定に使う。
const totalFromEff = (eff) =>
  Math.floor((eff.hp_max / 10) + (eff.mp_max / 5) + eff.atk + eff.def + eff.matk + eff.mdef + eff.spd)

export default function KumitePanel({ onClose }) {
  const [, setMeId] = useState(null)
  const [myLoadout, setMyLoadout] = useState(null)
  const [myTotal, setMyTotal] = useState(null)
  const [candidates, setCandidates] = useState(null)  // null=読込中
  const [opponent, setOpponent] = useState(null)      // { id, username, char_lv, class, _total }
  const [logs, setLogs] = useState([])
  const [winner, setWinner] = useState(null)
  const [battling, setBattling] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setMeId(user.id)
      try {
        const [mine, cands] = await Promise.all([
          loadLoadout(user.id, true),
          loadTotalCandidates(user.id),
        ])
        setMyLoadout(mine)
        setMyTotal(totalFromEff(mine.eff))
        setCandidates(cands)
      } catch (e) {
        setError('データ読込に失敗: ' + e.message)
        setCandidates([])
      }
    })()
  }, [])

  const top10 = (candidates || []).slice(0, TOP_N)

  const pickRandom = () => {
    setError(''); setNotice(''); setOpponent(null); setLogs([]); setWinner(null)
    if (myTotal == null || !candidates) return
    const lo = myTotal * (1 - MATCH_RANGE), hi = myTotal * (1 + MATCH_RANGE)
    const pool = candidates.filter(c => c._total >= lo && c._total <= hi)
    if (pool.length === 0) {
      setNotice(`総合力±10%（${Math.floor(lo)}〜${Math.ceil(hi)}）の相手が見つかりませんでした。`)
      return
    }
    const pick = pool[Math.floor(Math.random() * pool.length)]
    setOpponent(pick)
    setNotice(`ランダムマッチ成立！ 候補${pool.length}人から選出。`)
  }

  const selectOpponent = (c) => {
    setError(''); setNotice(''); setLogs([]); setWinner(null); setOpponent(c)
  }

  const runBattle = async () => {
    if (!opponent || !myLoadout || battling) return
    setBattling(true); setError(''); setLogs([]); setWinner(null)
    try {
      const oppLoadout = await loadLoadout(opponent.id, false)
      if (!oppLoadout.skillSets.length) {
        setError('相手の出撃スキルが未設定です（全て通常攻撃になります）')
      }
      // 組み手はHP補正なし（素のステ）。エンジンは対人戦と共通。
      const { logs: blogs, winner: w, turns, aHpPct, bHpPct } = simulatePvpBattle(myLoadout, oppLoadout)
      setLogs(blogs)
      setWinner(w)
      // 勝敗を一時記録（検証用・失敗は握りつぶす。報酬は一切無し）
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
      <div style={{ background: '#06101a', border: '1px solid #3a6a9a', maxWidth: '680px', width: '100%', padding: '16px', marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #1f3a5a', paddingBottom: '8px' }}>
          <div style={{ color: '#8ad0ff', fontSize: '15px', letterSpacing: '2px' }}>🥊 組み手 <span style={{ color: '#667799', fontSize: '10px' }}>(開発者限定)</span></div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #44668a', color: '#77aacc', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>✕ 閉じる</button>
        </div>

        <div style={{ color: '#88aacc', fontSize: '10px', lineHeight: '1.7', marginBottom: '10px' }}>
          対人戦の練習施設。<b>総合力±10%</b>の相手とランダムマッチ、または<b>総合力上位{TOP_N}人</b>から選んで対戦できます。報酬はありません。お互いの<b>出撃</b>スキルで戦います。
        </div>

        {candidates === null && !error && <div style={{ color: '#7799aa', fontSize: '12px' }}>データを読込中...</div>}

        {myTotal != null && (
          <div style={{ color: '#aaccee', fontSize: '11px', marginBottom: '10px' }}>
            あなたの総合力: <b style={{ color: '#44ff88' }}>{myTotal}</b>
          </div>
        )}

        {/* ランダムマッチ */}
        {candidates !== null && (
          <button onClick={pickRandom} disabled={battling}
            style={{ width: '100%', padding: '12px', marginBottom: '10px', background: '#0a1a2a', border: '1px solid #3aa0e0', color: '#8ad0ff', cursor: 'pointer', fontFamily: 'monospace', fontSize: '13px', letterSpacing: '1px' }}>
            🎲 ランダムマッチ（総合力±10%）
          </button>
        )}

        {notice && <div style={{ color: '#ffcc66', fontSize: '11px', marginBottom: '8px' }}>{notice}</div>}

        {/* 総合力上位から選択 */}
        {top10.length > 0 && (
          <div style={{ marginBottom: '10px' }}>
            <div style={{ color: '#77aacc', fontSize: '11px', marginBottom: '6px' }}>総合力 上位{TOP_N}人から選ぶ</div>
            <div style={{ display: 'grid', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
              {top10.map((c, i) => (
                <button key={c.id} onClick={() => selectOpponent(c)}
                  style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: opponent?.id === c.id ? '#13304a' : '#0a1622',
                    border: `1px solid ${opponent?.id === c.id ? '#3aa0e0' : '#244a6a'}`,
                    color: '#a8d0ff', padding: '6px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>
                  <span><span style={{ color: '#667799' }}>{i + 1}.</span> {c.username} <span style={{ color: '#667799' }}>LV{c.char_lv}・{c.class}</span></span>
                  <span style={{ color: '#44ff88' }}>{c._total}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {candidates !== null && top10.length === 0 && (
          <div style={{ color: '#556677', fontSize: '11px', marginBottom: '10px' }}>対戦できる相手がいません。</div>
        )}

        {/* 対戦相手＆対戦ボタン */}
        {opponent && (
          <div style={{ border: '1px solid #3a6a9a', background: '#0a1622', padding: '10px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: '#8ad0ff', fontSize: '13px' }}>
              対戦相手: <b>{opponent.username}</b> <span style={{ color: '#667799', fontSize: '10px' }}>LV{opponent.char_lv}・{opponent.class}・総合力{opponent._total}</span>
            </div>
            <button onClick={runBattle} disabled={battling || !myLoadout}
              style={{ background: battling ? '#0a141c' : '#0a2a40', border: `1px solid ${battling ? '#2a3a4a' : '#3aa0e0'}`, color: battling ? '#445566' : '#8ad0ff', padding: '8px 18px', cursor: battling ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '1px' }}>
              {battling ? '戦闘中...' : '🥊 対戦'}
            </button>
          </div>
        )}

        {error && <div style={{ color: '#ff8899', fontSize: '11px', marginBottom: '8px' }}>{error}</div>}

        {logs.length > 0 && (
          <div style={{ border: '1px solid #244a6a', background: '#060e16', padding: '10px' }}>
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
