import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import V2Modal from './V2Modal.jsx'
import { box, btn, TEXT } from './v2ui.js'
import { GENDER_BY_KEY, genderOf } from '../lib/gender.js'
import { leftText } from '../lib/burger.js'
import {
  SHOP_ITEMS, SHOP_ITEM_BY_KEY, FLIP_COLOR, FLIP_MINUTES, FLIP_HOURS,
  flipLeftMsOf, flipPreviewOf, encounterBandOf, otherGenderOf,
} from '../lib/shop.js'

// ============================================================
// 「レベルキャップあり」版 — 商店（2026-10-31）
//   品物を選ぶ → 確かめのポップアップ（何がどう変わるか）→ 買ったらその場で飲む → 結果のポップアップ
//   ★決まりの正は src/v2cap/lib/shop.js。買う・Gold はサーバー（v2cap_shop_buy）
// ============================================================
const gold = (n) => `${Number(n || 0).toLocaleString()}G`
const BAND_STYLE = { color: FLIP_COLOR, fontSize:'13px' }

// ♂ 男性（色つき）と性能差の一言
function GenderLine({ g }) {
  const d = GENDER_BY_KEY[g]
  return <><span style={{ color: d.color }}>{d.mark} {d.label}</span><span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>{d.text}</span></>
}

// 性別変更薬：いまの性別 → 飲んだあと
function GenderChange({ g }) {
  if (!g) return <div style={{ color:'#ff8844' }}>先にホームで性別を選んでください</div>
  return (
    <>
      <div>いま：<GenderLine g={g} /></div>
      <div>飲むと：<GenderLine g={otherGenderOf(g)} /></div>
    </>
  )
}

// 日月反転の秘薬：いまの時間帯 → 飲んだあと（効いているあいだは残り時間が延びる）
function FlipChange({ prof, now }) {
  const left = flipLeftMsOf(prof, now)
  const p = flipPreviewOf(prof, now)
  return (
    <>
      {left > 0
        ? <div>いま：<span style={BAND_STYLE}>{encounterBandOf(prof, now)}</span><span style={{ marginLeft:'8px' }}>{leftText(left)} → {leftText(p.leftMs)}</span></div>
        : <div>いま：<span style={BAND_STYLE}>{encounterBandOf(prof, now)}</span> → 飲むと：<span style={BAND_STYLE}>{p.to}</span></div>}
      {p.change && <div style={{ color: TEXT.sub, fontSize:'10px' }}>※{p.change.minutes}分後に「{p.change.band}」へ変わります</div>}
    </>
  )
}

const ITEM_TEXT = {
  gender: '飲むと、男女が入れ替わります。',
  flip: `${FLIP_MINUTES}分のあいだ、時間帯が${FLIP_HOURS}時間ずれて、いまとは違う時間帯の敵に出会えます。`,
}

export default function V2capShop({ prof, onProfile }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const [confirm, setConfirm] = useState(null)   // 確かめている品物の key
  const [bought, setBought] = useState(null)     // 結果のポップアップ（サーバーの返事）
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const have = Number(prof?.gold || 0)
  const sex = genderOf(prof)

  const buy = async () => {
    setBusy(true); setError('')
    try {
      const { data, error: e } = await supabase.rpc('v2cap_shop_buy', { p_item: confirm })
      if (e || !data?.ok) { setError(e?.message || data?.error || '買えませんでした'); return }
      setBought(data)
      setNow(new Date())
      await onProfile?.()
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }
  const asking = SHOP_ITEM_BY_KEY[confirm]
  const got = SHOP_ITEM_BY_KEY[bought?.item]
  const newSex = GENDER_BY_KEY[bought?.gender]

  return (
    <div style={{ maxWidth:'760px' }}>
      {asking && (
        <V2Modal title={`${asking.icon} ${asking.name}を飲みますか？`} color={asking.color} busy={busy} confirmLabel={`${gold(asking.gold)}で買う`}
          onConfirm={buy} onClose={() => setConfirm(null)}>
          {asking.key === 'gender' ? <GenderChange g={sex} /> : <FlipChange prof={prof} now={now} />}
        </V2Modal>
      )}
      {got && (
        <V2Modal title={`${got.icon} ${got.name}を飲みました`} color={got.color} onClose={() => setBought(null)}>
          {got.key === 'gender' ? (
            <>
              <div><span style={{ color: newSex?.color }}>{newSex?.mark} {newSex?.label}</span>になりました</div>
              <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'6px' }}>{newSex?.text}</div>
            </>
          ) : (
            <>
              <div>いまの時間帯：<span style={BAND_STYLE}>{encounterBandOf({ flip_until: bought.flip_until }, now)}</span></div>
              <div style={{ color: TEXT.sub, fontSize:'11px', marginTop:'6px' }}>効果時間：{leftText(flipLeftMsOf({ flip_until: bought.flip_until }, now))}</div>
            </>
          )}
        </V2Modal>
      )}

      <div style={{ ...box, padding:'8px 12px', marginBottom:'8px', fontSize:'11px', color: TEXT.label }}>
        持っているGold <span style={{ color:'#ffcc00', fontSize:'13px' }}>{gold(have)}</span>
      </div>
      {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'8px' }}>
        {SHOP_ITEMS.map(it => {
          const short = have < it.gold
          const noSex = it.key === 'gender' && !sex
          const off = busy || short || noSex
          return (
            <div key={it.key} style={{ ...box, padding:'10px 12px', display:'flex', flexDirection:'column', gap:'6px', minWidth:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:'8px' }}>
                <span style={{ color: it.color, fontSize:'13px' }}>{it.icon} {it.name}</span>
                <span style={{ color:'#ffcc00', fontSize:'12px', whiteSpace:'nowrap' }}>{gold(it.gold)}</span>
              </div>
              <div style={{ color: TEXT.sub, fontSize:'11px', lineHeight:1.6 }}>{ITEM_TEXT[it.key]}</div>
              <div style={{ color: TEXT.body, fontSize:'11px', lineHeight:1.8 }}>
                {it.key === 'gender' ? <GenderChange g={sex} /> : <FlipChange prof={prof} now={now} />}
              </div>
              <button onClick={() => { setError(''); setConfirm(it.key) }} disabled={off}
                style={{ ...btn(it.color), width:'100%', padding:'8px', marginTop:'auto', opacity: off ? 0.5 : 1 }}>
                {short ? 'Goldが足りません' : '買う'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
