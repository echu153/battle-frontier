import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { box, miniBtn, TEXT } from './v2ui.js'
import V2Modal from './V2Modal.jsx'
import { AREA_LIST, SUB_MARK, spotOf } from '../lib/areas.js'
import { openUntilOf } from '../lib/sortie.js'
import { RARITY_COLOR, rarityLabel } from '../lib/equipment.js'
import { DEX_ROLES, DEX_ROLE, DEX_ALL, dexAreaOf, dropInfoOf, killsOf, isFound, dexProgressOf } from '../lib/dex.js'
import { enemyArtSrc, enemyArtBigSrc } from '../lib/enemyArt.js'
import { chip } from './v2capGearView.js'
import V2capIcon from './V2capIcon.jsx'
import { JP_BOLD } from './casinoStyle.js'

// ============================================================
// 「レベルキャップあり」版 — モンスター図鑑
//   【確定】2026-10-11 ユーザー指示：まずは見るだけ（ステが上がる要素はあとから足す）。仕組みの正は src/v2cap/lib/dex.js
//   ・行ったことのあるエリアごとのタブ。1エリア20体（通常→時間帯→レア→ボス）。倒すまでは名前もLVも「???」
//   ・1体ごとに：役割（時間帯の敵は朝・昼・晩）・出る場所（①②③）・LV・物理／魔法・討伐数・落とす装備（レア度）
//   ・討伐数はサーバーが数える（出撃の精算で勝ったとき）。ここは v2cap_kills を読むだけ
//   【確定】2026-10-12 ユーザー指示「モンスター図鑑にモンスターのアイコン載せるようにしてほしい」：
//     左にアイコン（戦闘ログと同じ絵＝enemyArt.js・同じ枠＝V2capIcon）。絵の無いモンスターは名前の1文字目の枠。
//     まだ倒していない敵は名前と同じく隠す（絵は黒い影・絵が無ければ「？」）
//   【確定】同じ日にユーザー指示「装備8%とかはいらない」：落とす確率（%）は出さない（落とすレア度だけ）
//   【確定】2026-10-24 ユーザー指示：
//     ・「ユニーク装備の情報はすべて削除」＝ボスの行のユニーク（名前・能力）を出さない（dex.js の dropInfoOf も持たない）
//     ・「モンスターのイラストタップしたらアップされるようにして」＝倒した敵の絵をタップすると大きく出す（大きい版 enemy-art-big）
//     ・説明の文は HELP の小窓へ。「残り◯エリアは、行くと載ります」はやめた
// ============================================================
const kindText = (k) => (k === 'mag' ? '魔法' : '物理')

export default function V2capDex({ prof }) {
  const [kills, setKills] = useState(null)   // { 敵の名前: 数 }。読み込み中は null
  const [error, setError] = useState('')
  const maxArea = Math.max(1, spotOf(openUntilOf(prof.cleared_spots))?.area || 1)
  const [area, setArea] = useState(maxArea)
  const [roles, setRoles] = useState(() => new Set(DEX_ROLES.map(r => r.key)))
  const [help, setHelp] = useState(false)    // HELP の小窓
  const [zoom, setZoom] = useState(null)     // 大きく出している敵（図鑑の1行）

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
      {help && (
        <V2Modal title="❓ HELP" color="#c0b0ff" onClose={() => setHelp(false)}>
          <div>出撃で倒した敵が載ります（倒すまでは名前もLVも ???）。</div>
          <div>討伐数は出撃で勝ったときに数えます。</div>
          <div>落とす装備はそのエリアの装備です。</div>
        </V2Modal>
      )}
      {zoom && <ZoomModal e={zoom} onClose={() => setZoom(null)} />}

      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        {/* 説明は HELP から（2026-10-24 ユーザー指示「←これはHELPに」） */}
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div style={{ color:'#c0b0ff', fontSize:'12px', flex:1 }}>
            見つけた敵 全体 <span style={{ color:'#ffcc00' }}>{total.done}</span> / {total.total}体
          </div>
          <button onClick={() => setHelp(true)} style={miniBtn('#88aaff')}>❓ HELP</button>
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
              const art = enemyArtSrc(e.name)
              // 絵をタップすると大きく出す（倒した敵で、絵があるものだけ）
              const canZoom = found && !!art
              return (
                <div key={e.name} style={{ background:'#000818', border:`1px solid ${found ? '#002244' : '#001428'}`, padding:'6px 8px',
                  display:'flex', gap:'8px', alignItems:'center' }}>
                  <div onClick={canZoom ? () => setZoom(e) : undefined} title={canZoom ? 'タップで大きく見る' : undefined}
                    style={{ cursor: canZoom ? 'zoom-in' : 'default', flexShrink:0 }}>
                    <V2capIcon key={`${art || 'none'}:${found}`} src={art} name={e.name} ring={role.color} size={44} hidden={!found} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', flexWrap:'wrap' }}>
                      <span style={{ color: role.color, fontSize:'9px', border:`1px solid ${role.color}`, padding:'0 4px', flexShrink:0 }}>
                        {role.label}{e.band ? `・${e.band}` : ''}
                      </span>
                      <span style={{ color: found ? '#cfe2ff' : TEXT.empty, flex:1, minWidth:0 }}>{found ? e.name : '???'}</span>
                      <span style={{ color: found ? '#cfe2ff' : TEXT.empty, fontSize:'11px' }}>LV{found ? lvText(e) : '??'}</span>
                      <span style={{ color: TEXT.label, fontSize:'10px' }}>{e.subs.map(s => SUB_MARK[s - 1]).join('')}</span>
                    </div>
                    <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', fontSize:'10px', marginTop:'3px', color: TEXT.sub }}>
                      <span>⚔ 討伐 <span style={{ color: found ? '#ffcc00' : TEXT.empty }}>{killsOf(kills, e.name).toLocaleString()}</span></span>
                      {found ? (
                        <>
                          <span>{kindText(e.kind)}</span>
                          {/* 落とす確率（%）は出さない（2026-10-12 ユーザー指示「装備8%とかはいらない」） */}
                          <span>
                            落とす装備：
                            {drop.rarities.map((r, i) => (
                              <span key={r}>{i ? '・' : ''}<span style={{ color: RARITY_COLOR[r] }}>{rarityLabel(r)}</span></span>
                            ))}
                          </span>
                        </>
                      ) : <span style={{ color: TEXT.empty }}>倒すと載ります</span>}
                    </div>
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

const lvText = (e) => (e.lvMax > e.lv ? `${e.lv}〜${e.lvMax}` : e.lv)

// 絵を大きく出す小窓。大きい版（512×512）が読めないときは小さい版（192×192）を広げて出す。絵を押しても閉じる
// 【確定】2026-10-24 ユーザー指示「モンスター名を大きく、通常LV1はモンスターの右に記載するようにして」：
//   上の帯に名前を大きく（日本語の太字は JP_BOLD）、その右に役割の札とLV。絵の下の行はやめた
function ZoomModal({ e, onClose }) {
  const role = DEX_ROLE[e.role]
  const [src, setSrc] = useState(() => enemyArtBigSrc(e.name) || enemyArtSrc(e.name))
  const title = (
    <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
      <span style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'20px', color:'#ffffff', textShadow:`0 0 8px ${role.color}88` }}>{e.name}</span>
      <span style={{ color: role.color, border:`1px solid ${role.color}`, padding:'0 5px', fontSize:'11px' }}>{role.label}{e.band ? `・${e.band}` : ''}</span>
      <span style={{ color:'#cfe2ff', fontSize:'13px' }}>LV{lvText(e)}</span>
    </div>
  )
  return (
    <V2Modal title={title} color={role.color} onClose={onClose}>
      <img src={src} alt={e.name} draggable={false} onClick={onClose}
        onError={() => { const small = enemyArtSrc(e.name); if (small && src !== small) setSrc(small) }}
        style={{ display:'block', width:'100%', maxWidth:'360px', aspectRatio:'1 / 1', objectFit:'contain', margin:'0 auto', cursor:'zoom-out',
          borderRadius:'8px', border:`1px solid ${role.color}55`, background:'radial-gradient(circle at 50% 40%, #1d3554 0%, #0b1a2e 75%)' }} />
    </V2Modal>
  )
}
