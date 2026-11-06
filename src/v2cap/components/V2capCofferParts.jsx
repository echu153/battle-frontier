// ============================================================
// 「レベルキャップあり」版（v2cap）— タカラモチの待機の動き（部品を重ねて描く）
// ------------------------------------------------------------
// 【確定】2026-11-07 ユーザー「タカラモチの待機モーション欲しい」→ ふたの開け閉め・金貨の腕とコイントス・目と口の光とまばたき
//   動きは lib/cofferMotion.js（純関数）、部品と切る位置は lib/cofferArt.js（COFFER_CUTS・cofferPartsOf）
//   部品の絵はどれも立ち絵と同じ正方形＝枠いっぱいに重ねる。位置は元の絵の px を枠の割合（%）にして使う（sq＝立ち絵の切り取り）
//   重ね順：動かない所 → ふた（＋右手）→ 目と口の光 → まぶた（まばたきのときだけ）→ 左腕（金貨・きらめき）
//   ★使うのは transform と opacity とマスクだけ（軽い表示でも同じ・ぼかしは使わない）
//   2026-11-07 ユーザー「攻撃ヒットしたとき、コインが落ちるエフェクトもつけてほしいね」：hits（当たった印・ミリ秒）ごとに金貨がこぼれる（coinDropsAt）。
//     いちばん手前に描き、殴られて傾く動き（upright＝傾きの度）を打ち消す＝床に落ちた金貨は傾かない。軽い表示は半分の枚数
// ============================================================
import { cofferIdleAt, coinDropsAt } from '../lib/cofferMotion.js'
import { COFFER_DROP_BOX } from '../lib/cofferArt.js'

const FULL = { position:'absolute', left:0, top:0, width:'100%', height:'100%', userSelect:'none', pointerEvents:'none', maxWidth:'none' }

export default function V2capCofferParts({ parts, tMs, hits = [], upright = 0, lite = false }) {
  const m = cofferIdleAt(tMs)
  const drops = coinDropsAt(hits, tMs, { lite })
  const { src, sq, cuts } = parts
  const X = (x) => (x - sq.x0) / sq.S * 100, Y = (y) => (y - sq.y0) / sq.S * 100
  const at = (p) => `${X(p[0]).toFixed(2)}% ${Y(p[1]).toFixed(2)}%`
  const img = (s, style) => <img src={s} alt="" draggable={false} style={{ ...FULL, ...style }} />
  // まばたき：まぶたの絵を上から下へ見せていく（目ごとに、目の上のはしから下のはしまで・ふちはぼかす）
  const lids = m.blink > 0.01 ? cuts.eyes.map((e, i) => {
    const top = Y(e.at[1] - e.ry - 8), bot = Y(e.at[1] + e.ry + 8)
    const edge = top + (bot - top) * Math.min(1, m.blink * 1.05)
    const mask = `linear-gradient(to bottom, #000 ${(edge - 1.2).toFixed(2)}%, transparent ${(edge + 1.2).toFixed(2)}%)`
    const clip = `inset(${top.toFixed(2)}% ${(100 - X(e.at[0] + e.rx + 12)).toFixed(2)}% ${(100 - bot).toFixed(2)}% ${X(e.at[0] - e.rx - 12).toFixed(2)}%)`
    return <img key={i} src={src.lids} alt="" draggable={false} style={{ ...FULL, clipPath: clip, WebkitMaskImage: mask, maskImage: mask }} />
  }) : null
  // 閉じた目：光る細い線（下にふくらんだ弧＝にんまり）。閉じきる少し前から出る
  const shut = Math.max(0, Math.min(1, (m.blink - 0.55) / 0.35))
  return (
    // 立ち絵の img（object-fit: contain）と同じ置き方：枠の幅いっぱいの正方形を、縦のまん中に
    <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', pointerEvents:'none' }}>
      <div style={{ position:'relative', width:'100%', aspectRatio:'1 / 1' }}>
        {img(src.base)}
        {img(src.lid, { transform:`scaleY(${m.lid.toFixed(4)})`, transformOrigin:`50% ${Y(cuts.lid.pivotY).toFixed(2)}%` })}
        {img(src.glow, { opacity: Math.min(1, m.glow).toFixed(3) })}
        {lids}
        {shut > 0.01 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ ...FULL, overflow:'visible', opacity: shut.toFixed(3) }}>
            {cuts.eyes.map((e, i) => {
              const cx = X(e.at[0]), cy = Y(e.at[1] + e.ry * 0.2), w = X(e.at[0] + e.rx * 0.8) - cx, dip = (Y(e.at[1] + e.ry) - Y(e.at[1])) * 0.55
              const d = `M ${(cx - w).toFixed(2)} ${cy.toFixed(2)} Q ${cx.toFixed(2)} ${(cy + dip).toFixed(2)} ${(cx + w).toFixed(2)} ${cy.toFixed(2)}`
              return (
                <g key={i} fill="none" strokeLinecap="round">
                  <path d={d} stroke="rgba(255,150,40,0.3)" strokeWidth="1.3" />
                  <path d={d} stroke="#ffe08a" strokeWidth="0.55" />
                </g>
              )
            })}
          </svg>
        )}
        <div style={{ ...FULL, transform:`rotate(${m.arm.toFixed(3)}deg)`, transformOrigin: at(cuts.larm.pivot) }}>
          {img(src.larm)}
          {img(src.coin, { transform:`translateY(${(m.coin.dy * 100).toFixed(3)}%) rotate(${m.coin.rot.toFixed(2)}deg) scaleX(${m.coin.sx.toFixed(4)})`, transformOrigin: at(cuts.coin.at) })}
          {m.glint.op > 0.01 && img(src.glint, { opacity: m.glint.op.toFixed(3), transform:`scale(${m.glint.s.toFixed(4)})`, transformOrigin: at(cuts.glint.at) })}
        </div>
      </div>
      {/* こぼれる金貨：枠ごとの傾きを打ち消して（Fighter の傾きと同じ中心 50% 92%）、同じ正方形に置く */}
      {drops.length > 0 && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', pointerEvents:'none', transform: upright ? `rotate(${(-upright).toFixed(2)}deg)` : undefined, transformOrigin:'50% 92%' }}>
          <div style={{ position:'relative', width:'100%', aspectRatio:'1 / 1' }}>
            {drops.map(c => (
              <img key={c.key} src={src.drop} alt="" draggable={false} style={{ position:'absolute', left:`${X(c.x).toFixed(2)}%`, top:`${Y(c.y).toFixed(2)}%`,
                width:`${(COFFER_DROP_BOX * 0.8 / sq.S * 100 * c.s).toFixed(2)}%`, maxWidth:'none', pointerEvents:'none', userSelect:'none',
                transform:`translate(-50%, -50%) scale(${c.sx.toFixed(3)}, ${c.sy.toFixed(3)})`, opacity: c.op.toFixed(3) }} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
