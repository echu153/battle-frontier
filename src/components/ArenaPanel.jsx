// 🏛 アリーナ — 梯子型の対人コンテンツ（一般公開）。
// 全20階。守護者を倒して席を奪う king-of-the-hill 型。
//  ・自由挑戦者は「自分の目標階」だけに挑める。空席なら着席（EXP/CDなし）、占有なら戦闘（1hCD・EXP+20）。
//  ・勝ち→その階に着席／負け→目標が1つ下へ。守護中は挑戦不可。
//  ・持続HP/MP（街とは別・回復なし）: 削れるのは挑戦された守護者のみ。挑戦者は毎回フル。
//  ・いずれかの階を守護中は出撃Gold×1.1（サーバー付与）。
// 戦闘エンジンは対人戦と共通(simulatePvpBattle)。位置/報酬/CDはサーバー権威(arena_* RPC)。
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { BattleLogLine } from '../pages/Game'
import { simulatePvpBattle } from '../lib/pvp'
import { loadLoadout } from '../lib/pvpLoadout'

const FLOORS = 20

export default function ArenaPanel({ onClose }) {
  const [meId, setMeId] = useState(null)
  const [myLoadout, setMyLoadout] = useState(null)   // 自分の戦闘ロードアウト（eff.hp_max等）
  const [board, setBoard] = useState(null)           // null=読込中 / [{floor,...}]
  const [myFloor, setMyFloor] = useState(null)       // 着席中の階（null=非着席）
  const [targetFloor, setTargetFloor] = useState(1)
  const [lastAt, setLastAt] = useState(null)
  const [cdSeconds, setCdSeconds] = useState(3600)
  const [now, setNow] = useState(Date.now())
  const [logs, setLogs] = useState([])
  const [winner, setWinner] = useState(null)
  const [oppName, setOppName] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const listRef = useRef(null)

  // 1秒ごとに現在時刻を更新（CDカウントダウン用）
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const reloadBoard = async () => {
    const { data, error: e } = await supabase.rpc('arena_get_board')
    if (e || !data || data.ok === false) {
      setError('盤面の取得に失敗: ' + (data?.reason || e?.message || 'unknown'))
      setBoard([])
      return
    }
    setBoard(data.board || [])
    setMyFloor(data.my_floor ?? null)
    setTargetFloor(data.target_floor || 1)
    setLastAt(data.last_challenge_at || null)
    setCdSeconds(data.cooldown_seconds || 3600)
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setMeId(user.id)
      try {
        const [mine] = await Promise.all([loadLoadout(user.id, true), reloadBoard()])
        setMyLoadout(mine)
      } catch (e) {
        setError('データ読込に失敗: ' + e.message)
      }
    })()
  }, [])

  const cdLeft = (() => {
    if (!lastAt) return 0
    const elapsed = (now - new Date(lastAt).getTime()) / 1000
    return Math.max(0, Math.ceil(cdSeconds - elapsed))
  })()
  const fmtCd = (s) => `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`

  const myEff = myLoadout?.eff
  const targetSlot = (board || []).find(s => s.floor === targetFloor) || null
  const targetOccupied = !!targetSlot?.holder_id

  // 空席に着席
  const claimEmpty = async () => {
    if (busy || !myEff) return
    setBusy(true); setError(''); setNotice(''); setLogs([]); setWinner(null)
    try {
      const { data, error: e } = await supabase.rpc('arena_claim_empty', {
        p_floor: targetFloor, p_hp_max: Math.floor(myEff.hp_max), p_mp_max: Math.floor(myEff.mp_max),
      })
      if (e || data?.ok === false) {
        setError('着席に失敗: ' + (data?.reason || e?.message || 'unknown'))
      } else {
        setNotice(`${targetFloor}階に着席しました！ 守護中は挑戦できません（負けると次の階へ）。`)
      }
      await reloadBoard()
    } catch (e) {
      setError('着席処理に失敗: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  // 占有階へ挑戦（戦闘）
  const challenge = async () => {
    if (busy || !myLoadout || !myEff || !targetSlot?.holder_id) return
    if (cdLeft > 0) { setError(`クールダウン中です（あと${fmtCd(cdLeft)}）`); return }
    setBusy(true); setError(''); setNotice(''); setLogs([]); setWinner(null)
    setOppName(targetSlot.username || '守護者')
    try {
      const oppLoadout = await loadLoadout(targetSlot.holder_id, false)
      if (!oppLoadout.skillSets.length) {
        setNotice('相手の出撃スキルが未設定です（相手は通常攻撃のみ）')
      }
      // 挑戦者(A)は満タン。守護者(B)は持続HP/MPで開始。
      const res = simulatePvpBattle(myLoadout, oppLoadout, {
        startHpB: targetSlot.hp_current, startMpB: targetSlot.mp_current,
      })
      setLogs(res.logs)
      setWinner(res.winner)
      const won = res.winner === 'A'
      const { data, error: e } = await supabase.rpc('arena_battle_result', {
        p_floor: targetFloor,
        p_opponent: targetSlot.holder_id,
        p_won: won,
        p_def_end_hp: Math.floor(res.endHpB),
        p_def_end_mp: Math.floor(res.endMpB),
        p_my_hp_max: Math.floor(myEff.hp_max),
        p_my_mp_max: Math.floor(myEff.mp_max),
      })
      if (e || data?.ok === false) {
        setError('結果の反映に失敗: ' + (data?.reason || e?.message || 'unknown') + '（盤面を再取得します）')
      } else if (won) {
        setNotice(`勝利！ ${targetFloor}階を獲得しました！${data.level_ups ? ` ★LV UP×${data.level_ups}！` : ''} EXP+${data.exp_gained ?? 0}`)
      } else {
        setNotice(`敗北… 目標を${Math.max(1, targetFloor - 1)}階に下げました。 EXP+${data.exp_gained ?? 0}`)
      }
      await reloadBoard()
    } catch (e) {
      setError('挑戦処理に失敗: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const classColor = '#c8a0ff'
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto', fontFamily: 'monospace' }}>
      <div style={{ background: '#0a0616', border: '1px solid #6a3a9a', maxWidth: '720px', width: '100%', padding: '16px', marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #3a1f5a', paddingBottom: '8px' }}>
          <div style={{ color: classColor, fontSize: '15px', letterSpacing: '2px' }}>🏛 アリーナ</div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #6a44a0', color: '#aa77cc', padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px' }}>✕ 閉じる</button>
        </div>

        <div style={{ color: '#aa88cc', fontSize: '10px', lineHeight: '1.7', marginBottom: '10px' }}>
          全<b>{FLOORS}階</b>の梯子。<b>目標の階</b>に挑戦し、空席なら着席・占有なら戦闘（<b>1時間に1回</b>・EXP+20）。勝てばその階を守護、負ければ目標が1つ下へ。守護中は挑戦できません。<b>持続HP</b>は挑戦されるたびに削れます（回復なし）。
        </div>

        {board === null && !error && <div style={{ color: '#8877aa', fontSize: '12px' }}>データを読込中...</div>}

        {/* 自分の状態＆アクション */}
        {board !== null && (
          <div style={{ border: '1px solid #6a3a9a', background: '#120a24', padding: '10px', marginBottom: '10px' }}>
            {myFloor != null ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                <div style={{ color: '#d0a0ff', fontSize: '13px' }}>
                  🛡 <b>{myFloor}階</b>を守護中
                </div>
                <div style={{ color: '#8877aa', fontSize: '10px' }}>守護中は挑戦できません（負けると次の階へ）</div>
              </div>
            ) : (
              <div>
                <div style={{ color: '#c8a0ff', fontSize: '12px', marginBottom: '8px' }}>
                  次の目標: <b style={{ color: '#ffcc66' }}>{targetFloor}階</b>
                  {targetOccupied
                    ? <span style={{ color: '#aa88cc' }}>（守護者: {targetSlot.username || '???'}）</span>
                    : <span style={{ color: '#66aa88' }}>（空席）</span>}
                </div>
                {targetOccupied ? (
                  <button onClick={challenge} disabled={busy || cdLeft > 0 || !myEff}
                    style={{ width: '100%', padding: '12px', background: (busy || cdLeft > 0) ? '#160a1e' : '#2a0a2a', border: `1px solid ${(busy || cdLeft > 0) ? '#3a2a4a' : '#c060e0'}`, color: (busy || cdLeft > 0) ? '#665577' : '#ff9aff', cursor: (busy || cdLeft > 0) ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '13px', letterSpacing: '1px' }}>
                    {busy ? '戦闘中...' : cdLeft > 0 ? `⏳ クールダウン中（あと${fmtCd(cdLeft)}）` : `⚔ ${targetFloor}階に挑戦する`}
                  </button>
                ) : (
                  <button onClick={claimEmpty} disabled={busy || !myEff}
                    style={{ width: '100%', padding: '12px', background: '#0a2a1a', border: '1px solid #3aa060', color: '#66dd99', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontSize: '13px', letterSpacing: '1px' }}>
                    {busy ? '処理中...' : `🪑 ${targetFloor}階に着席する（空席・EXPなし）`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {notice && <div style={{ color: '#ffcc66', fontSize: '11px', marginBottom: '8px' }}>{notice}</div>}
        {error && <div style={{ color: '#ff8899', fontSize: '11px', marginBottom: '8px' }}>{error}</div>}

        {/* 戦闘ログ */}
        {logs.length > 0 && (
          <div style={{ border: '1px solid #4a2a6a', background: '#0a0612', padding: '10px', marginBottom: '10px' }}>
            {winner && (
              <div style={{ textAlign: 'center', marginBottom: '8px', color: winner === 'A' ? '#ffcc44' : '#ff6699', fontSize: '14px' }}>
                {winner === 'A' ? `🏆 ${myLoadout?.profile?.username} の勝利！` : `💀 ${oppName} の防衛成功…`}
              </div>
            )}
            <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
              {logs.map((l, i) => <BattleLogLine key={i} l={l} />)}
            </div>
          </div>
        )}

        {/* 梯子（上の階＝格上。20階を上に表示） */}
        {board !== null && (
          <div ref={listRef} style={{ display: 'grid', gap: '4px', maxHeight: '46vh', overflowY: 'auto' }}>
            {[...board].sort((a, b) => b.floor - a.floor).map((s) => {
              const isMine = s.holder_id && s.holder_id === meId
              const isTarget = myFloor == null && s.floor === targetFloor
              const hpPct = s.holder_id && s.hp_max ? Math.max(0, Math.min(1, s.hp_current / s.hp_max)) : 0
              return (
                <div key={s.floor} style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
                  background: isMine ? '#1a2a12' : isTarget ? '#2a1a0a' : '#0e0a18',
                  border: `1px solid ${isMine ? '#4a8a3a' : isTarget ? '#c08a3a' : '#2a1f3a'}`,
                }}>
                  <div style={{ width: '42px', flexShrink: 0, color: '#b088e0', fontSize: '11px', textAlign: 'center' }}>
                    <b>{s.floor}</b>階
                  </div>
                  {s.holder_id ? (
                    <>
                      {s.avatar_url
                        ? <img src={s.avatar_url} alt="" style={{ width: '26px', height: '26px', objectFit: 'cover', border: '1px solid #3a2f5a', flexShrink: 0 }} />
                        : <div style={{ width: '26px', height: '26px', background: '#1a1230', border: '1px solid #3a2f5a', flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: isMine ? '#a8ff88' : '#d8c0ff', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.username || '???'} {isMine && <span style={{ color: '#66dd88' }}>(あなた)</span>}
                          <span style={{ color: '#6a5a8a', fontSize: '9px' }}> LV{s.char_lv}・{s.class}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                          <div style={{ flex: 1, height: '5px', background: '#1a1228', border: '1px solid #2a1f3a', maxWidth: '120px' }}>
                            <div style={{ width: `${hpPct * 100}%`, height: '100%', background: hpPct > 0.4 ? '#44cc66' : hpPct > 0.15 ? '#ccaa33' : '#cc4444' }} />
                          </div>
                          <span style={{ color: '#7a6a9a', fontSize: '8px' }}>HP {s.hp_current}/{s.hp_max}</span>
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ color: '#ffcc66', fontSize: '9px' }}>{s.streak > 0 ? `${s.streak}連勝中` : '守護中'}</div>
                        {s.defeated_name && <div style={{ color: '#6a5a8a', fontSize: '8px' }}>{s.defeated_name}に勝利</div>}
                      </div>
                    </>
                  ) : (
                    <div style={{ flex: 1, color: '#4a4060', fontSize: '10px' }}>― 空席 ―{isTarget && <span style={{ color: '#66aa88' }}>（挑戦で着席）</span>}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
