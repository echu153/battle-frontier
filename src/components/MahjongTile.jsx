// 麻雀牌のSVG描画(画像ファイル不使用・自前ベクター)
// 筒=丸の並び / 索=竹(1索は鳥) / 萬=漢数字+萬 / 字牌=漢字
import { KIND_NAMES } from '../lib/mahjong'

const MAN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

// 筒の丸配置 [x, y, r]
const PIN_LAYOUT = {
  1: [[30, 40, 15]],
  2: [[30, 23, 11], [30, 57, 11]],
  3: [[17, 19, 10], [30, 40, 10], [43, 61, 10]],
  4: [[19, 23, 10], [41, 23, 10], [19, 57, 10], [41, 57, 10]],
  5: [[18, 21, 9], [42, 21, 9], [30, 40, 9], [18, 59, 9], [42, 59, 9]],
  6: [[19, 18, 9], [41, 18, 9], [19, 40, 9], [41, 40, 9], [19, 62, 9], [41, 62, 9]],
  7: [[14, 15, 8], [30, 21, 8], [46, 27, 8], [19, 48, 8], [41, 48, 8], [19, 66, 8], [41, 66, 8]],
  8: [[19, 14, 8], [41, 14, 8], [19, 31, 8], [41, 31, 8], [19, 49, 8], [41, 49, 8], [19, 66, 8], [41, 66, 8]],
  9: [[16, 18, 8], [30, 18, 8], [44, 18, 8], [16, 40, 8], [30, 40, 8], [44, 40, 8], [16, 62, 8], [30, 62, 8], [44, 62, 8]],
}
// 索の竹配置 [x, y](中心)
const SOU_LAYOUT = {
  2: [[30, 22], [30, 58]],
  3: [[30, 20], [18, 58], [42, 58]],
  4: [[19, 22], [41, 22], [19, 58], [41, 58]],
  5: [[17, 20], [43, 20], [30, 40], [17, 60], [43, 60]],
  6: [[16, 22], [30, 22], [44, 22], [16, 58], [30, 58], [44, 58]],
  7: [[30, 16], [16, 42], [30, 42], [44, 42], [16, 66], [30, 66], [44, 66]],
  8: [[16, 20], [30, 20], [44, 20], [23, 40], [37, 40], [16, 60], [30, 60], [44, 60]],
  9: [[16, 20], [30, 20], [44, 20], [16, 40], [30, 40], [44, 40], [16, 60], [30, 60], [44, 60]],
}

const GREEN = '#1a7a3a', RED = '#c02020', BLUE = '#22409c', INK = '#222a33'

function Circle({ x, y, r, red }) {
  const c = red ? RED : BLUE
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="none" stroke={c} strokeWidth={r * 0.32} />
      <circle cx={x} cy={y} r={r * 0.38} fill={red ? RED : GREEN} />
    </g>
  )
}

function Stick({ x, y, red, h = 24 }) {
  const c = red ? RED : GREEN
  const w = h / 3
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={2.5} fill={c} />
      <rect x={x - w / 2} y={y - 2} width={w} height={4} fill="#faf7ef" opacity={0.55} />
      <circle cx={x} cy={y - h / 2 + 2.5} r={h / 11} fill="#faf7ef" opacity={0.6} />
      <circle cx={x} cy={y + h / 2 - 2.5} r={h / 11} fill="#faf7ef" opacity={0.6} />
    </g>
  )
}

// 1索の鳥
function Bird() {
  return (
    <g>
      <ellipse cx={30} cy={46} rx={12} ry={15} fill={GREEN} />
      <circle cx={30} cy={24} r={7} fill={GREEN} />
      <circle cx={32.5} cy={22.5} r={1.6} fill="#fff" />
      <path d="M36 22 L44 24 L36 27 Z" fill={RED} />
      <path d="M22 50 Q10 58 14 68 Q22 64 26 58 Z" fill={RED} />
      <path d="M38 50 Q50 58 46 68 Q38 64 34 58 Z" fill={GREEN} />
      <rect x={26} y={60} width={3} height={10} fill={RED} />
      <rect x={32} y={60} width={3} height={10} fill={RED} />
    </g>
  )
}

function Face({ k, r }) {
  // 萬子
  if (k < 9) {
    return (
      <g>
        <text x={30} y={36} textAnchor="middle" fontSize={30} fontWeight="bold"
          fontFamily="'Hiragino Mincho ProN','Yu Mincho',serif" fill={r ? RED : INK}>{MAN_NUM[k]}</text>
        <text x={30} y={68} textAnchor="middle" fontSize={27} fontWeight="bold"
          fontFamily="'Hiragino Mincho ProN','Yu Mincho',serif" fill={RED}>萬</text>
      </g>
    )
  }
  // 筒子
  if (k < 18) {
    const n = k - 9 + 1
    return <g>{PIN_LAYOUT[n].map(([x, y, rad], i) => <Circle key={i} x={x} y={y} r={rad} red={r || (n === 1)} />)}</g>
  }
  // 索子
  if (k < 27) {
    const n = k - 18 + 1
    if (n === 1) return <Bird />
    const h = n >= 7 ? 17 : 24 // 3段組は短い竹で重なり防止
    return <g>{SOU_LAYOUT[n].map(([x, y], i) => (
      <Stick key={i} x={x} y={y} h={h} red={r || (n === 5 && i === 2) || (n === 7 && i === 0) || (n === 9 && i === 4)} />
    ))}</g>
  }
  // 字牌
  const label = KIND_NAMES[k]
  const color = k === 32 ? GREEN : k === 33 ? RED : INK // 發=緑 中=赤
  if (k === 31) return null // 白=真っ白
  return (
    <text x={30} y={53} textAnchor="middle" fontSize={40} fontWeight="bold"
      fontFamily="'Hiragino Mincho ProN','Yu Mincho',serif" fill={color}>{label}</text>
  )
}

// 牌の表面(w×hピクセル)。r=赤ドラ
export function TileFace({ k, r, w = 34, h = 46 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 60 80" style={{ display: 'block' }}>
      <rect x={1} y={1} width={58} height={78} rx={7} fill={r ? '#fdeaea' : '#faf7ef'} stroke="#8a8578" strokeWidth={2} />
      <rect x={1} y={71} width={58} height={8} rx={4} fill="#d8d2c2" opacity={0.6} />
      <Face k={k} r={!!r} />
      {r && <circle cx={51} cy={9} r={4} fill={RED} />}
    </svg>
  )
}

// 牌の裏面
export function TileBackFace({ w = 34, h = 46 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 60 80" style={{ display: 'block' }}>
      <rect x={1} y={1} width={58} height={78} rx={7} fill="#2c5f8a" stroke="#1a3a55" strokeWidth={2} />
      <rect x={8} y={10} width={44} height={60} rx={4} fill="none" stroke="#4a80ab" strokeWidth={2} />
    </svg>
  )
}
