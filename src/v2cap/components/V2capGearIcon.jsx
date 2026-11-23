import { RARITY_COLOR } from '../lib/equipment.js'
import { gearArtSrcOf, gearFallbackOf, gearTierOf } from '../lib/gearArt.js'

// ============================================================
// 「レベルキャップあり」版 — 装備の絵の枠（決まりは lib/gearArt.js）
//   【確定】2026-11-23 ユーザー「枠の色を変えるのは当たり前、レジェンダリー以上はレアな装備ってわかるように豪華に」
//   ・枠の色は等級ごと（名前の色と同じ RARITY_COLOR）
//   ・ノーマル＝細い枠だけ／レア＝枠＋うっすら色の地／エピック＝枠＋内側の光
//   ・レジェンダリー＝太い金の枠・外へにじむ光・流れるハイライト
//   ・ユニーク＝太い赤の枠・後ろで回る光の輪・立ちのぼる粒・流れるハイライト
//   ⚠四隅の白い飾りは付けない（2026-11-23 ユーザー「四隅の白い枠いらない、」＝最初の版にあったのを外した）
//   ・動きは transform と opacity だけ（一覧に何十個も並ぶ）。「視差効果を減らす」の端末では止める
//   ・絵がまだ無い装備は種類ごとの仮のアイコン（色を抜いて薄く）
// item が無ければ空の枠（slotIcon＝その枠の印）
// ============================================================
const CSS = `
@keyframes v2gSweep { 0%, 62% { transform: translateX(-160%) skewX(-20deg) } 100% { transform: translateX(260%) skewX(-20deg) } }
@keyframes v2gSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
@keyframes v2gPulse { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
@keyframes v2gRise { 0% { transform: translateY(0) scale(1); opacity: 0 } 20% { opacity: 1 } 100% { transform: translateY(-115%) scale(.4); opacity: 0 } }
.v2g-sweep { animation: v2gSweep 3.6s ease-in-out infinite }
.v2g-spin { animation: v2gSpin 7s linear infinite }
.v2g-pulse { animation: v2gPulse 2.4s ease-in-out infinite }
.v2g-rise { animation: v2gRise 2.2s ease-out infinite }
@media (prefers-reduced-motion: reduce) { .v2g-sweep, .v2g-spin, .v2g-pulse, .v2g-rise { animation: none } .v2g-sweep, .v2g-rise { display: none } }
`
let cssDone = false
const ensureCss = () => {
  if (cssDone || typeof document === 'undefined') return
  cssDone = true
  const el = document.createElement('style')
  el.setAttribute('data-v2cap', 'gear-icon')
  el.textContent = CSS
  document.head.appendChild(el)
}

// 等級ごとの枠の作り
export const GEAR_FRAME = {
  N: { border: 1, tint: 0.00, inner: 0, outer: 0 },
  R: { border: 1, tint: 0.14, inner: 0, outer: 0 },
  E: { border: 1, tint: 0.22, inner: 7, outer: 3 },
  L: { border: 2, tint: 0.30, inner: 8, outer: 7, sweep: true },
  U: { border: 2, tint: 0.30, inner: 9, outer: 9, sweep: true, aura: true, sparks: true },
}
// 空の枠に出す部位の印（装備画面の「装備中」）
export const GEAR_SLOT_ICON = { weapon:'⚔', head:'🪖', body:'🛡', arm:'🧤', foot:'🥾', acc1:'💍', acc2:'💍' }
const hexA =(a) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
const SPARKS = [{ left: '18%', delay: '0s' }, { left: '52%', delay: '.8s' }, { left: '78%', delay: '1.5s' }]

export default function GearIcon({ item, size = 44, slotIcon = '', dim = false, style }) {
  ensureCss()
  const tier = item ? gearTierOf(item) : 'N'
  const f = GEAR_FRAME[tier]
  const color = item ? RARITY_COLOR[tier] : '#22334d'
  const src = item ? gearArtSrcOf(item) : null
  return (
    <span data-gear-tier={item ? tier : 'none'} style={{
      position:'relative', display:'inline-block', width: size, height: size, flexShrink: 0, boxSizing:'border-box', verticalAlign:'middle',
      border:`${f.border}px solid ${color}`, opacity: dim ? 0.6 : 1,
      background:`radial-gradient(circle at 50% 42%, ${color}${hexA(item ? f.tint : 0)} 0%, #000818 78%)`,
      boxShadow: item && (f.inner || f.outer) ? `inset 0 0 ${f.inner}px ${color}99, 0 0 ${f.outer}px ${color}aa` : 'none',
      ...style,
    }}>
      {/* 絵・光は枠の中で切る（外へにじむ光は外の箱の影） */}
      <span style={{ position:'absolute', inset: 0, overflow:'hidden', display:'block' }}>
        {item && f.aura && (
          <span className="v2g-spin" style={{ position:'absolute', inset:'-30%', display:'block',
            background:`conic-gradient(from 0deg, transparent 0 12%, ${color}88 20%, transparent 30% 45%, #ffd9a066 52%, transparent 60% 78%, ${color}77 86%, transparent 94%)` }} />
        )}
        {item && f.aura && (
          <span className="v2g-pulse" style={{ position:'absolute', inset: 0, display:'block', background:`radial-gradient(circle at 50% 55%, ${color}55 0%, transparent 62%)` }} />
        )}
        {src
          ? <img src={src} alt="" loading="lazy" draggable={false} style={{ position:'absolute', inset:'6%', width:'88%', height:'88%', objectFit:'contain', imageRendering:'auto' }} />
          : (
            <span aria-hidden="true" style={{ position:'absolute', inset: 0, display:'flex', alignItems:'center', justifyContent:'center',
              fontSize: Math.round(size * 0.5), lineHeight: 1, filter:'grayscale(1)', opacity: item ? 0.75 : 0.22 }}>
              {item ? gearFallbackOf(item) : slotIcon}
            </span>
          )}
        {item && f.sparks && SPARKS.map((s, i) => (
          <span key={i} className="v2g-rise" style={{ position:'absolute', bottom:'4%', left: s.left, width: 2, height: 2, display:'block',
            background:'#ffe9c4', boxShadow:`0 0 3px ${color}`, animationDelay: s.delay }} />
        ))}
        {item && f.sweep && (
          <span className="v2g-sweep" style={{ position:'absolute', top:'-20%', left: 0, width:'38%', height:'140%', display:'block',
            background:'linear-gradient(90deg, transparent, #ffffff66 45%, #ffffffaa 50%, #ffffff66 55%, transparent)' }} />
        )}
      </span>
    </span>
  )
}
