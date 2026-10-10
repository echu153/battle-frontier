import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { box, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { AREA_LIST, SUB_MARK, spotOf } from '../lib/areas.js'
import { openUntilOf } from '../lib/sortie.js'
import { RARITY_COLOR, rarityLabel } from '../lib/equipment.js'
import { DEX_ROLES, DEX_ROLE, DEX_ALL, DEX_AREA_COUNT, dexAreaOf, dropInfoOf, killsOf, isFound, dexProgressOf } from '../lib/dex.js'
import { chip } from './v2capGearView.js'

// ============================================================
// 「レベルキャップあり」版 — モンスター図鑑
//   【確定】2026-10-11 ユーザー指示：まずは見るだけ（ステが上がる要素はあとから足す）。仕組みの正は src/v2cap/lib/dex.js
//   ・行ったことのあるエリアごとのタブ。1エリア20体（通常→時間帯→レア→ボス）。倒すまでは名前もLVも「???」
//   ・1体ごとに：役割（時間帯の敵は朝・昼・晩）・出る場所（①②③）・LV・物理／魔法・討伐数・落とす装備（確率とレア度）
//   ・討伐数はサーバーが数える（出撃の精算で勝ったとき）。ここは v2cap_kills を読むだけ
// ============================================================
const kindText = (k) => (k === 'mag' ? '魔法' : '物理')

export default function V2capDex({ prof }) {
  const [kills, setKills] = useState(null)   // { 敵の名前: 数 }。読み込み中は null
  const [error, setError] = useState('')
  const maxArea = Math.max(1, spotOf(openUntilOf(prof.cleared_spots))?.area || 1)
  const [area, setArea] = useState(maxArea)
  const [roles, setRoles] = useState(() => new Set(DEX_ROLES.map(r => r.key)))

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error: e } = await supabase.from('v2cap_kills').select('enemy, n')
      if (!alive) return
      if (e) { setError(e.message); setKills({}); return }
      setKills(Object.fromEntries((data || []).map(r => [r.enemy, r.n])))
    })()
    return () => { alive = false }
  }, [])

  const areaRows = useMemo(() => dexAreaOf(area), [area])
  const rows = areaRows.filter(e => roles.has(e.role))
  const prog = dexProgressOf(areaRows, kills || {})
  const total = dexProgressOf(DEX_ALL, kills || {})
  const toggleRole = (key) => setRoles(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next.size ? next : new Set(DEX_ROLES.map(r => r.key))   // 全部外したら全部に戻す（今のⅡと同じ）
  })

  return (
    <div style={{ fontFamily:'monospace' }}>
      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.8 }}>
          出撃で倒した敵が載ります（倒すまでは名前もLVも ???）。討伐数は出撃で勝ったときに数えます。
          落とす装備はそのエリアの装備で、ふつうの敵と時間帯の敵は{dropInfoOf('normal').chance}%、レアとボスは{dropInfoOf('boss').chance}%です。
        </div>
        <div style={{ color:'#c0b0ff', fontSize:'12px', marginTop:'6px' }}>
          見つけた敵 全体 <span style={{ color:'#ffcc00' }}>{total.done}</span> / {total.total}体
        </div>
        {error && <div style={{ color:'#ff8844', fontSize:'10px', marginTop:'4px' }}>⚠ 討伐数を読めませんでした（{error}）</div>}
      </div>

      <div style={{ ...box, padding:'12px' }}>
        {/* エリアのタブ（行ったことのあるエリアだけ） */}
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'6px' }}>
          {Array.from({ length: maxArea }, (_, i) => i + 1).map(a => (
            <button key={a} onClick={() => setArea(a)} style={chip(area === a)}>{a} {AREA_LIST[a - 1]?.name}</button>
          ))}
        </div>
        {maxArea < DEX_AREA_COUNT && (
          <div style={{ color: TEXT.empty, fontSize:'9px', marginBottom:'6px' }}>残り{DEX_AREA_COUNT - maxArea}エリアは、行くと載ります</div>
        )}
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', alignItems:'center', marginBottom:'8px' }}>
          {DEX_ROLES.map(r => (
            <button key={r.key} onClick={() => toggleRole(r.key)}
              style={roles.has(r.key) ? { ...miniBtn(r.color), color: r.color } : chip(false)}>{r.label}</button>
          ))}
          <span style={{ color: TEXT.label, fontSize:'10px', marginLeft:'auto' }}>
            {AREA_LIST[area - 1]?.name}：見つけた敵 <span style={{ color:'#ffcc00' }}>{prog.done}</span> / {prog.total}（{prog.pct}%）
          </span>
        </div>

        {kills === null ? <div style={{ color: TEXT.label, fontSize:'11px', padding:'8px' }}>読み込み中...</div> : (
          <div style={{ display:'grid', gap:'3px' }}>
            {rows.map(e => {
              const found = isFound(kills, e.name)
              const role = DEX_ROLE[e.role]
              const drop = dropInfoOf(e.role)
              return (
                <div key={e.name} style={{ background:'#000818', border:`1px solid ${found ? '#002244' : '#001428'}`, padding:'6px 8px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', flexWrap:'wrap' }}>
                    <span style={{ color: role.color, fontSize:'9px', border:`1px solid ${role.color}`, padding:'0 4px', flexShrink:0 }}>
                      {role.label}{e.band ? `・${e.band}` : ''}
                    </span>
                    <span style={{ color: found ? '#cfe2ff' : TEXT.empty, flex:1, minWidth:0 }}>{found ? e.name : '???'}</span>
                    <span style={{ color: found ? '#cfe2ff' : TEXT.empty, fontSize:'11px' }}>LV{found ? e.lv : '??'}</span>
                    <span style={{ color: TEXT.label, fontSize:'10px' }}>{e.subs.map(s => SUB_MARK[s - 1]).join('')}</span>
                  </div>
                  <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', fontSize:'10px', marginTop:'3px', color: TEXT.sub }}>
                    <span>⚔ 討伐 <span style={{ color: found ? '#ffcc00' : TEXT.empty }}>{killsOf(kills, e.name).toLocaleString()}</span></span>
                    {found ? (
                      <>
                        <span>{kindText(e.kind)}</span>
                        <span>
                          装備 {drop.chance}%：
                          {drop.rarities.map((r, i) => (
                            <span key={r}>{i ? '・' : ''}<span style={{ color: RARITY_COLOR[r] }}>{rarityLabel(r)}</span></span>
                          ))}
                        </span>
                      </>
                    ) : <span style={{ color: TEXT.empty }}>倒すと載ります</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
