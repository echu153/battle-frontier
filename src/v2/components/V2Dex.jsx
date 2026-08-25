import { useMemo, useState } from 'react'
import V2Help from './V2Help.jsx'
import { AREAS_SORTED, areaLabel, statsOf } from '../lib/enemies.js'
import { materialsOfEnemy, RARITY_COLOR, RARITY_LABEL } from '../lib/material.js'
import { ENCHANTS } from '../lib/enchant.js'
import { MATERIAL_RATE, RARE_MATERIAL_RATE, RARE_RATE } from '../lib/sortie.js'
import { STAT_DEFS } from '../lib/stats.js'
import { box, miniBtn, TEXT } from './v2ui.js'

// バトルフロンティアⅡ（リメイク版）— モンスター図鑑
// ------------------------------------------------------------
// 出撃で会う敵と、その敵が落とすルーン素材をエリアごとに並べる。
// ★数字はぜんぶ enemies.js / material.js / enchant.js / sortie.js から引くだけ。
//   ここに数字を書き写さないこと（直したときにズレる）。
// ★**まだ解放していないエリアは出さない**（先の敵の名前が見えると出撃の楽しみが減る）。

const SLOT_COLOR = { 通常:'#7fa6d0', 時間帯:'#c0b0ff', レア:'#ffcc44', ボス:'#ff4444' }
const KIND_LABEL = { phys:'物理', mag:'魔法' }
const BAND_MARK = { 朝:'🌅', 昼:'☀', 晩:'🌙' }
const SLOTS = ['通常', '時間帯', 'レア', 'ボス']

const rowsOf = (area) => [
  ...area.enemies.map(e => ({ slot:'通常', e })),
  ...area.timed.map(e => ({ slot:'時間帯', e })),
  ...(area.rares || []).map(e => ({ slot:'レア', e })),
  { slot:'ボス', e: area.boss },
]

export default function V2Dex({ prof, onBack }) {
  const open = useMemo(() => {
    const unlocked = prof?.unlocked_areas || [1]
    return AREAS_SORTED.filter(a => unlocked.includes(a.id))
  }, [prof?.unlocked_areas])
  const [area, setArea] = useState(() => open[open.length - 1]?.id || 1)
  const [slots, setSlots] = useState(() => new Set(SLOTS))
  const [q, setQ] = useState('')

  const cur = open.find(a => a.id === area) || open[0]
  const locked = AREAS_SORTED.length - open.length

  const rows = useMemo(() => {
    if (!cur) return []
    const t = q.trim()
    return rowsOf(cur).filter(({ slot, e }) => {
      if (!slots.has(slot)) return false
      if (!t) return true
      const key = [e.name, ENCHANTS[e.name]?.text || '', ...materialsOfEnemy(e.name).map(m => m.name)].join(' ')
      return key.includes(t)
    })
  }, [cur, slots, q])

  const toggle = (s) => setSlots(prev => {
    const next = new Set(prev)
    if (next.has(s)) next.delete(s); else next.add(s)
    return next.size ? next : new Set(SLOTS)   // 全部消すと何も見えないので戻す
  })

  return (
    <div style={{ ...box, padding:'12px', marginBottom:'8px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
        <span style={{ color:'#88ccff', fontSize:'13px' }}>📖 モンスター図鑑</span>
        <V2Help id="dex" />
        <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
      </div>

      <div style={{ color: TEXT.label, fontSize:'10px', lineHeight:'1.8', marginBottom:'10px' }}>
        ふつうの敵は倒しても素材を落とさないことがあります（通常{MATERIAL_RATE.normal}%／レア{MATERIAL_RATE.rare}%／激レア{MATERIAL_RATE.ultra}%）。
        <br />レアモンスターは出現率{RARE_RATE}%で、素材はかならず落とします
        （通常{RARE_MATERIAL_RATE.normal}%／レア{RARE_MATERIAL_RATE.rare}%／激レア{RARE_MATERIAL_RATE.ultra}%・上がり幅は1.5倍）。
      </div>

      {/* エリア */}
      <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', marginBottom:'6px' }}>
        {open.map(a => (
          <button key={a.id} onClick={() => setArea(a.id)} title={a.name}
            style={{ ...miniBtn(area === a.id ? '#00aaff' : '#7fa6d0'), background: area === a.id ? '#002850' : '#000818' }}>
            {areaLabel(a)}
          </button>
        ))}
        {locked > 0 && (
          <span style={{ color: TEXT.empty, fontSize:'10px', alignSelf:'center' }}>
            ／ 残り{locked}エリアは解放すると載ります
          </span>
        )}
      </div>

      {/* 枠としぼり込み */}
      <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', alignItems:'center', marginBottom:'8px' }}>
        {SLOTS.map(s => (
          <button key={s} onClick={() => toggle(s)}
            style={{ ...miniBtn(slots.has(s) ? SLOT_COLOR[s] : '#62789a'),
              background: slots.has(s) ? '#001840' : '#000818' }}>
            {s}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="名前・能力でしぼる"
          style={{ flex:'1 1 120px', minWidth:0, background:'#000818', border:'1px solid #0044aa',
            color: TEXT.bright, padding:'4px 6px', fontFamily:'monospace', fontSize:'10px' }} />
      </div>

      {cur && (
        <div style={{ color: TEXT.body, fontSize:'12px', marginBottom:'6px' }}>
          {areaLabel(cur)} {cur.name}
          <span style={{ color: TEXT.empty, fontSize:'10px', marginLeft:'8px' }}>{rows.length}体</span>
        </div>
      )}

      {rows.map(({ slot, e }) => {
        const ench = ENCHANTS[e.name]
        const st = statsOf(e)
        return (
          <div key={e.name} style={{ border:'1px solid #002356', background:'#000c30', padding:'7px 8px', marginBottom:'6px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
              <span style={{ border:`1px solid ${SLOT_COLOR[slot]}`, color: SLOT_COLOR[slot],
                fontSize:'9px', padding:'1px 4px', fontFamily:'monospace' }}>{slot}</span>
              {e.band && <span style={{ color: TEXT.empty, fontSize:'10px' }}>{BAND_MARK[e.band]}{e.band}だけ</span>}
              <span style={{ color: TEXT.bright, fontSize:'12px', fontWeight:'bold' }}>{e.name}</span>
              <span style={{ color: TEXT.empty, fontSize:'10px', marginLeft:'auto', fontFamily:'monospace' }}>
                {KIND_LABEL[e.kind] || e.kind}　戦闘力 {e.power.toLocaleString()}　HP {st.hp.toLocaleString()}
              </span>
            </div>
            {ench && (
              <div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'3px' }}>⚗ {ench.text}</div>
            )}
            <div style={{ marginTop:'4px' }}>
              {materialsOfEnemy(e.name).map(m => (
                <div key={m.id} style={{ display:'flex', gap:'6px', fontSize:'10px', fontFamily:'monospace', lineHeight:'1.7' }}>
                  <span style={{ color: RARITY_COLOR[m.rarity], minWidth:'42px' }}>{RARITY_LABEL[m.rarity]}</span>
                  <span style={{ color: RARITY_COLOR[m.rarity] }}>{m.name}</span>
                  <span style={{ color: TEXT.empty, marginLeft:'auto', whiteSpace:'nowrap' }}>
                    {m.stats.map(k => STAT_DEFS[k]?.label || k).join('・')} {m.lo.toFixed(1)}〜{m.hi.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {!rows.length && (
        <div style={{ color: TEXT.empty, fontSize:'11px', padding:'10px 0' }}>あてはまる敵がいません。</div>
      )}
    </div>
  )
}
