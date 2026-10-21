// ============================================================
// v2cap 賭博場（2026-10-13）— スロット・ハイ&ロー・ルーレット・両替所
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示「V2capに無印の時みたいに賭博場を設置したい、新たにルーレットも追加したい。
//   交換所はあと設置するからまずは土台を」。決めたことは src/v2cap/lib/casino.js の頭に書いた
// ★抽選と払い出しはサーバー（SQL §11）。どのRPCも残高（medals）と当日の収支（day_net）を返すので、
//   遊ぶたびにプロフィールを読み直さない（前作は1回ごとに4〜5回読み込んでいて重かった）
// ============================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { useStored } from '../core/prefs.js'
import { GOLD_PER_MEDAL, maxExchangeOf } from '../lib/casino.js'
import { setSoundOn, sfx, fx } from './casinoFx.js'
import { CASINO, panel, pill, bigBtn, fmt, signed } from './casinoStyle.js'
import { CountUp } from './casinoParts.jsx'
import CasinoFxLayer from './CasinoFxLayer.jsx'
import V2capSlot from './V2capSlot.jsx'
import V2capHilo from './V2capHilo.jsx'
import V2capRoulette from './V2capRoulette.jsx'

const TABS = [
  { key:'slot',     label:'🎰 スロット' },
  { key:'hilo',     label:'🃏 ハイ&ロー' },
  { key:'roulette', label:'🎡 ルーレット' },
  { key:'exchange', label:'💱 両替所' },
]
const EXCHANGE_PRESETS = [1, 10, 100, 1000]

// SQL がまだ流されていないときの見え方
const sqlMissing = (msg) => /v2cap_casino_state|v2cap_slot|v2cap_hilo|v2cap_roulette|Could not find the function/i.test(msg || '')

export default function V2capCasino({ prof, onProfile }) {
  const [tab, setTab] = useStored('capCasinoTab', 'slot')
  const [sound, setSound] = useStored('capCasinoSound', true)
  const [state, setState] = useState(null)       // v2cap_casino_state の返事（開いたときだけ）
  const [money, setMoney] = useState({ medals: Number(prof?.medals) || 0, gold: Number(prof?.gold) || 0, day_net: 0 })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [exAmount, setExAmount] = useState(10)
  const [exMsg, setExMsg] = useState('')

  useEffect(() => { setSoundOn(sound) }, [sound])

  // どのRPCの返事からでも残高を受け取る
  const onMoney = useCallback((d) => {
    if (!d) return
    setMoney(m => ({
      medals: d.medals != null ? Number(d.medals) : m.medals,
      gold: d.gold != null ? Number(d.gold) : m.gold,
      day_net: d.day_net != null ? Number(d.day_net) : m.day_net,
    }))
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase.rpc('v2cap_casino_state')
      if (!alive) return
      if (err || !data?.ok) {
        const msg = err?.message || data?.error || '読み込めませんでした'
        setError(sqlMissing(msg) ? '賭博場のSQL（supabase_v2cap_core.sql の §11）がまだ流されていません' : msg)
        return
      }
      setState(data)
      onMoney(data)
      // 途中の勝負があれば、そのゲームを開く
      if (data.hilo?.active) setTab('hilo')
      else if (data.slot?.mode && data.slot.mode !== 'normal') setTab('slot')
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに1回だけ
  }, [])

  const exchange = async (n) => {
    if (busy || !(n > 0)) return
    setBusy(true); setExMsg('')
    const { data, error: err } = await supabase.rpc('v2cap_casino_exchange', { p_medals: n })
    setBusy(false)
    if (err || !data?.ok) { setExMsg(`⚠ ${err?.message || data?.error || '両替できませんでした'}`); return }
    onMoney(data)
    sfx.coin(0); setTimeout(() => sfx.coin(4), 90)
    fx('coins', { n: Math.min(40, 6 + Math.round(Math.log10(n + 1) * 8)), from: 'bottom' })
    setExMsg(`💰 ${fmt(data.spent)} Gold → 🪙 ${fmt(data.got)}枚`)
    await onProfile?.(null)
  }

  const maxEx = maxExchangeOf(money.gold)
  const netColor = money.day_net > 0 ? CASINO.green : money.day_net < 0 ? CASINO.red : CASINO.label
  return (
    <CasinoFxLayer>
      {/* ===== 上：残高・当日の収支・音 ===== */}
      <div style={{ ...panel(), display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap', marginBottom:'8px' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:'14px', flexWrap:'wrap' }}>
          <div>
            <span style={{ color:CASINO.label, fontSize:'11px' }}>メダル </span>
            <span style={{ color:CASINO.gold, fontSize:'22px', fontWeight:'bold', textShadow:'0 0 8px #ffcc0066' }}>🪙 <CountUp value={money.medals} ms={700} /></span>
          </div>
          <div style={{ fontSize:'11px', color:CASINO.label }}>
            今日の収支 <span style={{ color: netColor, fontWeight:'bold' }}>{signed(money.day_net)}</span>
          </div>
          <div style={{ fontSize:'11px', color:CASINO.label }}>Gold <span style={{ color:'#ffcc00' }}>{fmt(money.gold)}</span></div>
        </div>
        <button onClick={() => setSound(v => !v)} style={pill(sound ? CASINO.cyan : CASINO.dim, false)} aria-label="効果音">
          {sound ? '🔊 音あり' : '🔇 音なし'}
        </button>
      </div>

      {/* ===== タブ ===== */}
      <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={pill(t.key === 'exchange' ? CASINO.gold : CASINO.pink, tab === t.key)}>{t.label}</button>
        ))}
      </div>

      {error && <div style={{ color:'#ff6666', fontSize:'12px', marginBottom:'8px' }}>⚠ {error}</div>}

      {!error && !state && <div style={{ color:CASINO.label, fontSize:'12px', padding:'20px', textAlign:'center' }}>読み込み中...</div>}

      {/* ★3つとも開いたままにして、見えていないものは隠す（タブを行き来しても、ATの残りや勝負の途中が開いたときの古い状態に戻らない） */}
      {state && (
        <>
          <div style={{ display: tab === 'slot' ? 'block' : 'none' }}><V2capSlot init={state.slot} medals={money.medals} onMoney={onMoney} active={tab === 'slot'} /></div>
          <div style={{ display: tab === 'hilo' ? 'block' : 'none' }}><V2capHilo init={state.hilo} medals={money.medals} onMoney={onMoney} /></div>
          <div style={{ display: tab === 'roulette' ? 'block' : 'none' }}><V2capRoulette init={state.roulette} medals={money.medals} onMoney={onMoney} /></div>
        </>
      )}
      {state && tab === 'exchange' && (
        <div style={panel(CASINO.goldDeep)}>
          <div style={{ color:CASINO.gold, fontSize:'13px', fontWeight:'bold', marginBottom:'4px' }}>💱 両替所</div>
          <div style={{ color:CASINO.label, fontSize:'11px', marginBottom:'10px' }}>
            {GOLD_PER_MEDAL} Gold で メダル1枚。メダルを Gold に戻すことはできません。
          </div>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'10px' }}>
            {EXCHANGE_PRESETS.map(n => (
              <button key={n} onClick={() => setExAmount(n)} style={pill(CASINO.gold, exAmount === n)}>{fmt(n)}枚</button>
            ))}
            <button onClick={() => setExAmount(maxEx)} disabled={maxEx < 1} style={pill(CASINO.gold, exAmount === maxEx && maxEx > 0)}>全部（{fmt(maxEx)}枚）</button>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'10px', fontSize:'12px', color:CASINO.body }}>
            <input type="number" min={1} max={Math.max(1, maxEx)} value={exAmount}
              onChange={e => setExAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              style={{ width:'110px', background:'#000', color:CASINO.gold, border:`1px solid ${CASINO.goldDeep}`, padding:'6px', fontFamily:'monospace', fontSize:'13px' }} />
            <span>枚 ＝ <span style={{ color:'#ffcc00' }}>{fmt(exAmount * GOLD_PER_MEDAL)} Gold</span></span>
          </div>
          <button onClick={() => exchange(exAmount)} disabled={busy || exAmount < 1 || exAmount > maxEx}
            style={bigBtn(CASINO.gold, !busy && exAmount >= 1 && exAmount <= maxEx)}>
            🪙 {fmt(exAmount)}枚に両替する
          </button>
          {exAmount > maxEx && <div style={{ color:CASINO.red, fontSize:'11px', marginTop:'6px' }}>Goldが足りません</div>}
          {exMsg && <div style={{ color: exMsg.startsWith('⚠') ? '#ff6666' : CASINO.green, fontSize:'12px', marginTop:'8px' }}>{exMsg}</div>}
          <div style={{ color:CASINO.dim, fontSize:'10px', marginTop:'12px' }}>※ 景品の交換所はあとで作ります</div>
        </div>
      )}
    </CasinoFxLayer>
  )
}
