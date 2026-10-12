import { useState } from 'react'

// ============================================================
// 「レベルキャップあり」版 — アイコンの枠（戦闘ログ・モンスター図鑑で同じものを使う）
//   ・絵があれば絵、無い（読めない）ときは名前の1文字目を入れた枠（2026-10-12 戦闘ログで決めた形）
//   ・ring … 枠と文字の色（戦闘ログは味方の緑／敵の赤、図鑑は役割の色）
//   ・down … 倒れた側（戦闘ログの決着）。白黒にして薄く
//   ・hidden … 図鑑でまだ倒していない敵（名前もLVも ??? のあいだ）。絵は影（灰色）だけ、絵が無ければ「？」
//   ★key に src を付けて使うと、絵が変わったときに「読めなかった」を持ち越さない
// ============================================================
export default function V2capIcon({ src, name, ring = '#7fa6d0', size, down = false, hidden = false }) {
  const [broken, setBroken] = useState(false)
  const showArt = src && !broken
  return (
    <div style={{ width: size, height: size, flexShrink: 0, borderRadius: '6px', border: `1px solid ${ring}55`,
      background: 'radial-gradient(circle at 50% 40%, #1d3554 0%, #0b1a2e 75%)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', filter: down ? 'grayscale(1)' : undefined, opacity: down ? 0.45 : 1 }}>
      {showArt
        ? <img src={src} alt={hidden ? '' : name} width={size} height={size} draggable={false} onError={() => setBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block',
              // 影は真っ黒だと濃紺の背景に沈むので、少し明るい灰色にする（黒にしてから少し反転）
              filter: hidden ? 'brightness(0) invert(0.3)' : undefined, opacity: hidden ? 0.75 : 1 }} />
        : <span style={{ color: hidden ? '#4d6f92' : ring, fontSize: Math.round(size * 0.42), fontWeight: 'bold', lineHeight: 1 }}>
            {hidden ? '？' : [...(name || '？')][0]}
          </span>}
    </div>
  )
}
