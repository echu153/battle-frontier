// 🏳 戦争パネル — M1（NPC core-only・is_admin先行テスト）。
// 領地画面から開く。建国者(元帥)が宣戦布告→開戦→敵コアを攻撃→勝利/領地総取り を検証する。
// ※M1はコア戦のみ（持続HP/瀕死/相互戦闘はM2）。war_tickはこのパネル内だけで呼ぶ（領地本体に影響させない）。
import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { loadLoadout } from '../lib/pvpLoadout'
import { simulateCoreAttack, WAR_CORE_HP } from '../lib/war'
import { BattleLogLine } from '../pages/Game'

const ATTACK_CD_MS = 20000  // 疑似CD（サーバーCDはM2）

const overlay = { position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:2000, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'16px', overflowY:'auto', fontFamily:'monospace' }
const box = { background:'#140802', border:'1px solid #e05a62', maxWidth:'560px', width:'100%', padding:'16px', marginTop:'24px' }
const fmt = (ms) => { const s=Math.floor(ms/1000); const m=Math.floor(s/60); return m>0?`${m}分${s%60}秒`:`${s}秒` }

function CoreBar({ label, hp, color }) {
  const pct = Math.max(0, Math.min(100, (hp ?? 0) / WAR_CORE_HP * 100))
  return (
    <div style={{ marginBottom:'8px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#ddbbaa', marginBottom:'2px' }}>
        <span>{label}</span><span>{Math.max(0, hp ?? 0).toLocaleString()} / {WAR_CORE_HP.toLocaleString()}</span>
      </div>
      <div style={{ height:'12px', background:'#2a1408', border:'1px solid #5a2a1a' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color }} />
      </div>
    </div>
  )
}

export default function WarPanel({ onClose, me, myCountry, countries }) {
  const [loadout, setLoadout] = useState(null)
  const [war, setWar] = useState(null)
  const [target, setTarget] = useState('')
  const [testMode, setTestMode] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [cdUntil, setCdUntil] = useState(0)
  const [, setTick] = useState(0)
  const [battleLog, setBattleLog] = useState([])     // 直近のコア攻撃の戦闘ログ
  const [lastInfo, setLastInfo] = useState(null)      // { dealt, raw, applied } 直近の数値

  const nameOf = (cid) => (countries || []).find(c => c.id === cid)?.name || '???'

  const refreshWar = async () => {
    if (!myCountry) { setWar(null); return }
    try { await supabase.rpc('war_tick') } catch { /* 戦争SQL未適用なら無視 */ }
    const { data } = await supabase.from('wars')
      .select('*')
      .or(`attacker_country_id.eq.${myCountry.id},defender_country_id.eq.${myCountry.id}`)
      .order('created_at', { ascending: false })
      .limit(1)
    setWar((data || [])[0] || null)
  }

  useEffect(() => {
    (async () => {
      if (me?.id) { try { setLoadout(await loadLoadout(me.id, true)) } catch (e) { setErr('自分のデータ読込に失敗: ' + e.message) } }
      await refreshWar()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 残時間・CD表示のための1秒更新
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id) }, [])

  const declare = async () => {
    if (!target || busy) return
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.rpc('declare_war', { p_target_country: target, p_test: testMode })
    if (error) setErr(error.message); else { setMsg(`${nameOf(target)} に宣戦布告！`); await refreshWar() }
    setBusy(false)
  }

  const attack = async () => {
    if (!war || !loadout || busy || Date.now() < cdUntil) return
    setBusy(true); setErr('')
    const { raw, dealt, logs } = simulateCoreAttack(loadout)
    const { data, error } = await supabase.rpc('war_attack_core', { p_war_id: war.id, p_raw_damage: raw })
    if (error) { setErr(error.message) }
    else {
      setCdUntil(Date.now() + ATTACK_CD_MS)
      setBattleLog(logs)
      setLastInfo({ dealt, raw, applied: data?.damage ?? null })
      await refreshWar()
    }
    setBusy(false)
  }

  const forceEnd = async () => {
    if (!war || busy) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('war_admin_end', { p_war_id: war.id })
    if (error) setErr(error.message); else await refreshWar()
    setBusy(false)
  }

  const isAttacker = war && myCountry && war.attacker_country_id === myCountry.id
  const enemyCid   = war ? (isAttacker ? war.defender_country_id : war.attacker_country_id) : null
  const myCoreHp   = war ? (isAttacker ? war.attacker_core_hp : war.defender_core_hp) : null
  const enemyCoreHp= war ? (isAttacker ? war.defender_core_hp : war.attacker_core_hp) : null
  const ongoing    = war && ['declared','active','resolving'].includes(war.status)
  const remainMs   = war?.ends_at ? Math.max(0, new Date(war.ends_at).getTime() - Date.now()) : 0
  const startInMs  = war?.starts_at ? Math.max(0, new Date(war.starts_at).getTime() - Date.now()) : 0
  const cdRemain   = Math.max(0, cdUntil - Date.now())
  const targetOptions = (countries || []).filter(c => c.id !== myCountry?.id && !c.is_unaffiliated)
  const enemyIsNpc = (countries || []).find(c => c.id === enemyCid)?.is_npc

  const resultText = war?.status === 'done'
    ? (war.result === 'draw' ? '🤝 引き分け（領地移動なし）'
      : (war.winner_country_id === myCountry?.id ? `🏆 ${myCountry?.name} の勝利！ ${nameOf(enemyCid)} を併合`
        : `💀 ${nameOf(war.winner_country_id)} の勝利…`))
    : null

  return (
    <div style={overlay}>
      <div style={box}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', borderBottom:'1px solid #5a2a1a', paddingBottom:'8px' }}>
          <div style={{ color:'#ff8a6a', fontSize:'15px', letterSpacing:'2px' }}>🏳 戦争 <span style={{ color:'#aa6655', fontSize:'10px' }}>(M1・開発者限定)</span></div>
          <button onClick={onClose} style={{ background:'none', border:'1px solid #aa5544', color:'#cc8866', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>✕ 閉じる</button>
        </div>

        {!myCountry && <div style={{ color:'#ddaa88', fontSize:'12px' }}>国に所属していません。領地画面で建国または加入してください。</div>}

        {myCountry && (
          <div style={{ color:'#bb9977', fontSize:'11px', marginBottom:'10px' }}>
            自国: <b style={{ color:'#ffcc88' }}>{myCountry.name}</b>（あなた: {me?.country_rank || '—'}）
          </div>
        )}

        {/* 結果バナー（直近の戦争が done のとき） */}
        {resultText && (
          <div style={{ textAlign:'center', color: war.result === 'draw' ? '#aaaaaa' : '#ffcc44', fontSize:'14px', border:'1px solid #5a2a1a', background:'#1a0c04', padding:'10px', marginBottom:'10px' }}>{resultText}</div>
        )}

        {/* 進行中の戦争 */}
        {ongoing && war.status === 'declared' && (
          <div style={{ border:'1px solid #5a2a1a', background:'#1a0c04', padding:'10px', marginBottom:'10px' }}>
            <div style={{ color:'#ffcc88', fontSize:'13px', marginBottom:'4px' }}>⏳ 開戦待ち：vs {nameOf(enemyCid)}</div>
            <div style={{ color:'#bb9977', fontSize:'11px' }}>開戦まで {startInMs > 0 ? fmt(startInMs) : 'まもなく'}。下のボタンで反映。</div>
            <button onClick={refreshWar} disabled={busy} style={{ marginTop:'8px', background:'#2a1008', border:'1px solid #e05a62', color:'#ff8a6a', padding:'6px 14px', cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>🔄 状態を更新（war_tick）</button>
          </div>
        )}

        {ongoing && war.status === 'active' && (
          <div style={{ border:'1px solid #5a2a1a', background:'#1a0c04', padding:'10px', marginBottom:'10px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:'8px' }}>
              <div style={{ color:'#ff8a6a', fontSize:'13px' }}>⚔ 交戦中：vs {nameOf(enemyCid)}{enemyIsNpc ? '（NPC）' : ''}</div>
              <div style={{ color:'#ddbb88', fontSize:'11px' }}>残り {fmt(remainMs)}</div>
            </div>
            <CoreBar label={`敵コア（${nameOf(enemyCid)}）`} hp={enemyCoreHp} color="#ff5544" />
            <CoreBar label={`自国コア（${myCountry?.name}）`} hp={myCoreHp} color="#44aaff" />
            {enemyIsNpc && <div style={{ color:'#88aa66', fontSize:'10px', marginBottom:'8px' }}>※NPC国は防衛参加者ゼロ＝全員瀕死扱い。コアを直接攻撃できます。</div>}
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
              <button onClick={attack} disabled={busy || cdRemain > 0}
                style={{ flex:1, minWidth:'160px', background: cdRemain>0?'#1a0c06':'#3a1208', border:`1px solid ${cdRemain>0?'#5a3a2a':'#ff6644'}`, color: cdRemain>0?'#7a5a4a':'#ff9977', padding:'10px', cursor: cdRemain>0?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'13px', letterSpacing:'1px' }}>
                {cdRemain > 0 ? `⏱ ${Math.ceil(cdRemain/1000)}秒` : '🗡 敵コアを攻撃'}
              </button>
              <button onClick={forceEnd} disabled={busy}
                style={{ background:'#1a0c06', border:'1px solid #886644', color:'#bb9966', padding:'10px 12px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>⏹ 即決着（テスト）</button>
            </div>
          </div>
        )}

        {/* 宣戦布告（進行中の戦争が無いとき） */}
        {myCountry && !ongoing && (
          <div style={{ border:'1px solid #5a2a1a', background:'#160a04', padding:'10px', marginBottom:'10px' }}>
            <div style={{ color:'#ffcc88', fontSize:'12px', marginBottom:'8px' }}>宣戦布告（元帥のみ）</div>
            <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center' }}>
              <select value={target} onChange={e => setTarget(e.target.value)}
                style={{ flex:1, minWidth:'180px', background:'#120a04', border:'1px solid #5a2a1a', color:'#e0c0a0', padding:'8px', fontFamily:'monospace', fontSize:'12px' }}>
                <option value="">対象の国を選択…</option>
                {targetOptions.map(c => <option key={c.id} value={c.id}>{c.emblem || ''} {c.name}{c.is_npc ? '（NPC）' : ''}</option>)}
              </select>
              <button onClick={declare} disabled={busy || !target}
                style={{ background:'#3a1208', border:'1px solid #ff6644', color:'#ff9977', padding:'8px 16px', cursor:(busy||!target)?'not-allowed':'pointer', fontFamily:'monospace', fontSize:'12px' }}>宣戦布告</button>
            </div>
            <label style={{ display:'flex', alignItems:'center', gap:'6px', color:'#bb9977', fontSize:'11px', marginTop:'8px', cursor:'pointer' }}>
              <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} />
              テスト即時開戦（管理者・3日待たずに開戦）
            </label>
          </div>
        )}

        {msg && <div style={{ color:'#ffcc66', fontSize:'11px', marginBottom:'6px' }}>{msg}</div>}
        {err && <div style={{ color:'#ff8899', fontSize:'11px', marginBottom:'6px' }}>{err}</div>}

        {/* 直近のコア攻撃の数値＋戦闘ログ */}
        {(lastInfo || battleLog.length > 0) && (
          <div style={{ border:'1px solid #4a2a1a', background:'#0c0604', padding:'10px', marginTop:'4px' }}>
            {lastInfo && (
              <div style={{ color:'#ddbb88', fontSize:'11px', marginBottom:'6px', lineHeight:'1.6' }}>
                前回の攻撃: 10ターン素ダメ合計 <b style={{ color:'#ffcc66' }}>{lastInfo.dealt.toLocaleString()}</b>
                <span style={{ color:'#88775a' }}> → 送信 {lastInfo.raw.toLocaleString()} → </span>
                コア実ダメ <b style={{ color:'#ff8866' }}>{(lastInfo.applied ?? 0).toLocaleString()}</b>
                <span style={{ color:'#88775a' }}>（90%軽減後）</span>
              </div>
            )}
            {battleLog.length > 0 && (
              <div style={{ maxHeight:'40vh', overflowY:'auto', borderTop:'1px solid #3a2418', paddingTop:'6px' }}>
                {battleLog
                  .filter(l => l.type !== 'hp' && !/対人戦開始|与ダメージは防御力|^✦|引き分け/.test(l.text || ''))
                  .map((l, i) => <BattleLogLine key={i} l={l} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
