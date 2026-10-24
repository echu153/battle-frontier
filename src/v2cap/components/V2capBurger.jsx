import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from './V2Modal.jsx'
import { box, btn, TEXT } from './v2ui.js'
import { STAT_DEFS } from '../core/stats.js'
import { AIL_LABEL } from '../core/ailments.js'
import {
  SHOP_NAME, MEAL_COLOR, MEAL_MINUTES, BURGERS, BURGER_BY_STAT, TOPPING_GROUPS, TOPPING_BY_AIL, BURGER_GOLD, TOPPING_GOLD,
  TOPPING_RESIST_PCT, toppingsOf, mealCostOf, activeMealOf, leftText, burgerEffectText, toppingText,
} from '../lib/burger.js'

// ============================================================
// 「レベルキャップあり」版 — ハンバーガー屋「ニャーガーキング」（2026-10-25）
//   ・バーガーを1つ選ぶ（STR・DEX・AGI・INT・VIT・LUK のどれか+10%）→ トッピングを頼むか選ぶ（メジャー／マイナー・各500G）→ 注文
//   ・トッピングは頼んだ組の中から1つがサーバーでランダムに決まる（何が乗るかは出てくるまで分からない）
//   ・効くのは60分。食べ直すと前の食事は消える（効いている間に注文するときは確かめる）
//   ★決まりの正は src/v2cap/lib/burger.js。買う・抽選・Goldはサーバー（v2cap_burger_buy）
// ============================================================
const card = (on) => ({
  textAlign:'left', background: on ? '#2a1606' : '#000818', border:`1px solid ${on ? MEAL_COLOR : '#002244'}`,
  color: TEXT.body, padding:'8px', cursor:'pointer', fontFamily:'monospace', minWidth:0,
})
const gold = (n) => `${Number(n || 0).toLocaleString()}G`

// 組の中身（トマト＝出血 など）
function GroupList({ group }) {
  return (
    <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7 }}>
      {toppingsOf(group).map(t => (
        <span key={t.ail} style={{ whiteSpace:'nowrap', marginRight:'8px' }}>
          <span style={{ color: TEXT.bright }}>{t.name}</span>＝{AIL_LABEL[t.ail]}
        </span>
      ))}
    </div>
  )
}

export default function V2capBurger({ prof, onProfile }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t) }, [])
  const [pick, setPick] = useState(BURGERS[0].stat)
  const [tops, setTops] = useState({ major: false, minor: false })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [served, setServed] = useState(null)
  const [error, setError] = useState('')

  const meal = activeMealOf(prof, now)
  const cost = mealCostOf(tops)
  const have = Number(prof?.gold || 0)
  const short = have < cost

  const order = async () => {
    setBusy(true); setError('')
    try {
      const { data, error: e } = await supabase.rpc('v2cap_burger_buy', { p_burger: pick, p_major: tops.major, p_minor: tops.minor })
      if (e || !data?.ok) { setError(e?.message || data?.error || '注文できませんでした'); return }
      setServed(data)
      setNow(Date.now())
      await onProfile?.(null)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  const tryOrder = () => { if (meal) setConfirm(true); else order() }

  return (
    <div style={{ maxWidth:'760px' }}>
      {confirm && meal && (
        <V2Modal title="🍔 食べ直しますか？" color={MEAL_COLOR} busy={busy} confirmLabel={`${gold(cost)}で注文する`}
          onConfirm={order} onClose={() => setConfirm(false)}>
          いま効いている「{meal.burger.name}」（{leftText(meal.leftMs)}）は消えて、新しく食べたものが{MEAL_MINUTES}分効きます。
        </V2Modal>
      )}
      {served && (
        <V2Modal title="🍔 お待たせしましたニャ！" color={MEAL_COLOR} onClose={() => setServed(null)}>
          <div style={{ color: MEAL_COLOR, fontSize:'14px', marginBottom:'4px' }}>{BURGER_BY_STAT[served.meal_burger]?.name}</div>
          <div>{burgerEffectText(served.meal_burger)}</div>
          {[served.meal_major, served.meal_minor].filter(Boolean).map(a => (
            <div key={a}>＋ <span style={{ color: TEXT.bright }}>{TOPPING_BY_AIL[a]?.name}</span>：{AIL_LABEL[a]}にかかる確率−{TOPPING_RESIST_PCT}%</div>
          ))}
          <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'6px' }}>{MEAL_MINUTES}分効きます（{gold(served.spent)}）</div>
        </V2Modal>
      )}

      {/* 看板 */}
      <div style={{ ...box, padding:'14px', marginBottom:'8px', borderColor: MEAL_COLOR,
        background:'linear-gradient(180deg, #2a1206 0%, #001040 100%)' }}>
        <div style={{ color: MEAL_COLOR, fontSize:'18px', letterSpacing:'2px' }}>🍔 {SHOP_NAME}</div>
        <div style={{ color:'#ffd9a8', fontSize:'11px', marginTop:'2px' }}>直火焼きのにゃんこバーガー</div>
        <div style={{ color: TEXT.bright, fontSize:'12px', marginTop:'10px', lineHeight:1.7 }}>
          🐱👑「いらっしゃいませニャ！ 食べると{MEAL_MINUTES}分、力がわいてくるニャ」
        </div>
      </div>

      {/* いま食べているもの */}
      <div style={{ ...box, padding:'10px 12px', marginBottom:'8px' }}>
        <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'4px' }}>いま効いている食事</div>
        {meal ? (
          <div style={{ fontSize:'12px', lineHeight:1.8 }}>
            <span style={{ color: MEAL_COLOR }}>{meal.burger.name}</span>：{burgerEffectText(meal.stat)}
            <span style={{ color: TEXT.label, marginLeft:'8px' }}>{leftText(meal.leftMs)}</span>
            {[meal.major, meal.minor].filter(Boolean).map(a => <div key={a} style={{ fontSize:'11px' }}>＋ {toppingText(a)}</div>)}
          </div>
        ) : <div style={{ color: TEXT.empty, fontSize:'12px' }}>なし</div>}
      </div>

      {/* ① バーガー */}
      <div style={{ ...box, padding:'10px 12px', marginBottom:'8px' }}>
        <div style={{ color: MEAL_COLOR, fontSize:'12px', marginBottom:'6px' }}>① バーガーを選ぶ<span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>{gold(BURGER_GOLD)}</span></div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:'6px' }}>
          {BURGERS.map(b => {
            const on = pick === b.stat
            const d = STAT_DEFS[b.stat]
            return (
              <button key={b.stat} type="button" onClick={() => setPick(b.stat)} style={card(on)}>
                <div style={{ color: on ? MEAL_COLOR : TEXT.bright, fontSize:'12px', marginBottom:'3px' }}>{b.name}</div>
                <div style={{ fontSize:'11px' }}><span style={{ color: d.color }}>{burgerEffectText(b.stat)}</span>
                  <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'4px' }}>{d.desc}</span></div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ② トッピング */}
      <div style={{ ...box, padding:'10px 12px', marginBottom:'8px' }}>
        <div style={{ color: MEAL_COLOR, fontSize:'12px', marginBottom:'2px' }}>② トッピング<span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>各{gold(TOPPING_GOLD)}・頼まなくてもよい</span></div>
        <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'6px' }}>
          頼んだ組の中から1つが乗ります（何が乗るかはお楽しみ）。乗ったものの状態異常にかかる確率−{TOPPING_RESIST_PCT}%
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:'6px' }}>
          {TOPPING_GROUPS.map(g => {
            const on = tops[g.key]
            return (
              <button key={g.key} type="button" onClick={() => setTops(t => ({ ...t, [g.key]: !t[g.key] }))} style={card(on)}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:'6px', marginBottom:'3px' }}>
                  <span style={{ color: on ? MEAL_COLOR : TEXT.bright, fontSize:'12px' }}>{on ? '☑' : '☐'} {g.label}</span>
                  <span style={{ color:'#ffcc00', fontSize:'11px' }}>+{gold(TOPPING_GOLD)}</span>
                </div>
                <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'2px' }}>{g.note}</div>
                <GroupList group={g.key} />
              </button>
            )
          })}
        </div>
      </div>

      {/* 注文 */}
      <div style={{ ...box, padding:'10px 12px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:'4px 12px', marginBottom:'8px', fontSize:'12px' }}>
          <span>合計 <span style={{ color:'#ffcc00', fontSize:'15px' }}>{gold(cost)}</span></span>
          <span style={{ color: TEXT.label, fontSize:'11px' }}>持っているGold <span style={{ color: short ? '#ff8844' : '#ffcc00' }}>{gold(have)}</span></span>
        </div>
        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'6px' }}>⚠ {error}</div>}
        <button onClick={tryOrder} disabled={busy || short} style={{ ...btn(MEAL_COLOR), width:'100%', padding:'10px', opacity: busy || short ? 0.5 : 1 }}>
          {busy ? '焼いています…' : short ? 'Goldが足りません' : `${BURGER_BY_STAT[pick].name}を注文する`}
        </button>
        <div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'8px', lineHeight:1.7 }}>
          <div>・効くのは{MEAL_MINUTES}分（ログインしていない間も減ります）。出撃・ボス・覇天塔への挑戦で効きます</div>
          <div>・食べ直すと前の食事は消えます</div>
        </div>
      </div>
    </div>
  )
}
