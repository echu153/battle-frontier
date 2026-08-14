import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { AREAS, toFighter as enemyFighter } from '../lib/enemies.js'
import {
  pickEncounter, bandAt, enemyPoolAt, expOf, goldOf, isAreaUnlocked,
  nextBossRate, COOLDOWNS, cooldownOf, dropRateOf, rollHasDrop, rollDrop,
  featuredPartAt, featuredSchedule, nextSwitchAt, BOSS_RATE_STEP,
} from '../lib/sortie.js'
import { runBattle } from '../lib/battle.js'
import { toFighter as playerFighter } from '../lib/loadout.js'
import { powerOf } from '../lib/equipment.js'
import { box, btn, miniBtn, RANK_COLOR, PART_ICON } from './v2ui.js'

// 旧版の出撃とほぼ同じ流れ：エリアを選ぶ → 出撃（1戦）→ 貯まった取り分をまとめて清算。
// 戦闘そのものはクライアントで runBattle が回し、清算のときにサーバーへ送る
// （サーバーは「その回数で取り得る上限」を超えていないかを検証する）。
export default function V2Sortie({ prof, inventory, onProfile, onBack }) {
  const [area, setArea] = useState(1)
  const [logs, setLogs] = useState([])
  const [pending, setPending] = useState({ normals:0, bossWins:0, bossSeen:0, exp:0, gold:0, drops:[] })
  const [bossRate, setBossRate] = useState(prof?.boss_rate || 0)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [cd, setCd] = useState(cooldownOf(prof?.sortie_cd))
  const lastAt = useRef(0)
  const logRef = useRef(null)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t) }, [])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [logs])

  const unlocked = prof?.unlocked_areas || [1]
  const remain = Math.max(0, Math.ceil((lastAt.current + cd * 1000 - now) / 1000))
  const at = new Date(now)
  const band = bandAt(at)
  const hotPart = featuredPartAt(at)
  const me = playerFighter(prof, inventory)

  const setCooldown = async (sec) => {
    setCd(sec)
    const { data } = await supabase.rpc('v2_set_cooldown', { p_sec: sec })
    if (data?.ok) onProfile(p => ({ ...p, sortie_cd: sec }))
  }

  const go = () => {
    if (remain > 0 || busy) return
    if (!isAreaUnlocked(unlocked, area)) { setMsg('このエリアはまだ解放されていません'); return }
    lastAt.current = Date.now(); setMsg('')
    const enc = pickEncounter(area, bossRate, at)
    const r = runBattle(me, enemyFighter(enc.enemy, 8))
    const win = r.winner === 'a'
    const exp = win ? expOf(enc.isBoss) : 0
    const gold = win ? goldOf(enc.enemy) : 0
    const drop = win && rollHasDrop(cd) ? rollDrop(area, at) : null

    setBossRate(nextBossRate(bossRate, enc.isBoss))
    setPending(p => ({
      normals: p.normals + (enc.isBoss ? 0 : 1),
      bossWins: p.bossWins + (enc.isBoss && win ? 1 : 0),
      bossSeen: p.bossSeen + (enc.isBoss ? 1 : 0),
      exp: p.exp + exp, gold: p.gold + gold,
      drops: drop ? [...p.drops, drop] : p.drops,
    }))
    setLogs(l => [...l.slice(-40), {
      key: Date.now() + Math.random(), boss: enc.isBoss, win, name: enc.enemy.name,
      band: enc.enemy.band || null, turns: r.turns, exp, gold, drop,
    }])
  }

  const settle = async () => {
    if (busy || (pending.normals + pending.bossSeen) === 0) return
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2_sortie_settle', {
      p_area: area, p_normals: pending.normals, p_boss_wins: pending.bossWins,
      p_boss_seen: pending.bossSeen, p_exp: pending.exp, p_gold: pending.gold,
      p_drops: pending.drops.map(d => d.id),
    })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    if (!data?.ok) { setMsg(data?.error || '清算に失敗しました'); return }
    setMsg(`清算しました　EXP+${data.exp}　Gold+${data.gold.toLocaleString()}${data.drops ? `　装備${data.drops}個` : ''}`)
    setPending({ normals:0, bossWins:0, bossSeen:0, exp:0, gold:0, drops:[] })
    onProfile(null)   // プロフィールを取り直す
  }

  const areaObj = AREAS.find(a => a.id === area)
  const pool = areaObj ? enemyPoolAt(areaObj, at) : []
  const has = pending.normals + pending.bossSeen

  return (
    <div>
      <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>

      {/* エリア選択 */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#446688', fontSize:'10px', marginBottom:'6px' }}>エリア（ボスを倒すと次が解放されます）</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:'4px' }}>
          {AREAS.map(a => {
            const ok = isAreaUnlocked(unlocked, a.id)
            return (
              <button key={a.id} onClick={() => ok && setArea(a.id)} disabled={!ok}
                style={{ ...miniBtn(a.id === area ? '#00aaff' : ok ? '#446688' : '#223344'),
                  padding:'6px', fontSize:'11px', textAlign:'left', cursor: ok ? 'pointer' : 'default',
                  background: a.id === area ? '#002850' : '#000818' }}>
                {ok ? '' : '🔒'}{a.id}. {a.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* いまの状況 */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px', fontSize:'11px', color:'#88aaff' }}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'14px', marginBottom:'8px' }}>
          <span>時間帯 <b style={{ color:'#ffcc00' }}>{band}</b></span>
          <span>落ちやすい部位 <b style={{ color:'#ffcc00' }}>{PART_ICON[hotPart]}{hotPart}</b></span>
          <span>ボス遭遇率 <b style={{ color:'#ff88cc' }}>{bossRate.toFixed(1)}%</b>（1戦ごと+{BOSS_RATE_STEP}）</span>
          <span>ドロップ率 <b>{dropRateOf(cd)}%</b></span>
        </div>
        <div style={{ color:'#446688', fontSize:'10px' }}>
          出現する敵：{pool.map(e => e.name).join(' / ')}　＋　ボス「{areaObj?.boss.name}」
        </div>
        <div style={{ color:'#446688', fontSize:'10px', marginTop:'4px' }}>
          落ちやすい部位の予定：{featuredSchedule(at, 5).map(s =>
            `${new Date(s.at).getHours()}時 ${s.part}`).join(' → ')}
          （次の切替 {nextSwitchAt(at).getHours()}:00）
        </div>
      </div>

      {/* 出撃 */}
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
          <span style={{ color:'#446688', fontSize:'10px' }}>クールタイム</span>
          {COOLDOWNS.map(sec => (
            <button key={sec} onClick={() => setCooldown(sec)}
              style={{ ...miniBtn(cd === sec ? '#00aaff' : '#446688'), background: cd === sec ? '#002850' : '#000818' }}>
              {sec}秒{sec === 10 ? '（ドロップ3%）' : '（ドロップ4%）'}
            </button>
          ))}
        </div>
        <button onClick={go} disabled={remain > 0 || busy || !isAreaUnlocked(unlocked, area)}
          style={{ ...btn(remain > 0 ? '#446688' : '#00aaff'), width:'100%', padding:'12px', fontSize:'14px',
            cursor: remain > 0 ? 'default' : 'pointer' }}>
          {remain > 0 ? `⏳ 次の出撃まで ${remain}秒` : `⚔ 出撃する（エリア${area}）`}
        </button>
      </div>

      {/* 戦闘ログ */}
      <div ref={logRef} style={{ ...box, padding:'10px', marginBottom:'10px', height:'190px', overflowY:'auto', fontSize:'11px' }}>
        {logs.length === 0 && <div style={{ color:'#446688' }}>出撃するとここに結果が出ます</div>}
        {logs.map(l => (
          <div key={l.key} style={{ marginBottom:'3px', color: l.win ? '#88ccff' : '#ff6666' }}>
            {l.boss ? '👑' : l.band ? '🕓' : '　'}
            <span style={{ color: l.boss ? '#ffcc00' : l.band ? '#66ddaa' : '#88ccff' }}>{l.name}</span>
            {l.win ? ` を倒した（${l.turns}T）` : ` に敗北（${l.turns}T）`}
            {l.win && <span style={{ color:'#446688' }}>　EXP+{l.exp} Gold+{l.gold.toLocaleString()}</span>}
            {l.drop && <span style={{ color: RANK_COLOR[l.drop.rank] }}>　🎁{l.drop.rank}級「{l.drop.name}」</span>}
          </div>
        ))}
      </div>

      {/* 清算 */}
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ fontSize:'11px', color:'#88aaff', marginBottom:'8px' }}>
          未清算：{has}戦（ボス{pending.bossSeen}）
          <span style={{ color:'#44ff88' }}>EXP {pending.exp}</span>
          <span style={{ color:'#ffcc00' }}>Gold {pending.gold.toLocaleString()}</span>
          <span style={{ color:'#ff88cc' }}>装備 {pending.drops.length}個</span>
        </div>
        {pending.drops.length > 0 && (
          <div style={{ fontSize:'10px', color:'#446688', marginBottom:'8px' }}>
            {pending.drops.map((d, i) => (
              <span key={i} style={{ color: RANK_COLOR[d.rank], marginRight:'8px' }}>
                {PART_ICON[d.part]}{d.name}(+0/戦闘力{powerOf(d)})
              </span>
            ))}
          </div>
        )}
        <button onClick={settle} disabled={busy || has === 0} style={{ ...btn(has ? '#44ff88' : '#446688'), width:'100%' }}>
          {busy ? '清算中...' : '💰 まとめて清算する'}
        </button>
        {msg && <div style={{ marginTop:'8px', fontSize:'11px', color:'#ffcc66' }}>{msg}</div>}
        <div style={{ marginTop:'8px', fontSize:'9px', color:'#334455' }}>
          ⚠清算するまで反映されません。画面を離れると未清算ぶんは消えます。
        </div>
      </div>
    </div>
  )
}
