// v2cap — 演出で使う絵（装備の形・金床・金槌）
//   ★装備ごとの絵はまだ無い（2026-10-13 ユーザー「具体的な装備のアイコンはないからそれを考慮して」）。
//     なので形は 武器・防具・装飾品 の3種だけにして、レア度の色と名前で見分ける。絵ができたらここを差し替える

// 装備の形（武器・防具・装飾品）。size は一辺の px
export function GearGlyph({ part, color, size = 58 }) {
  if (part === '武器') {
    return (
      <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true">
        <path d="M44 6 L54 6 L54 16 L26 44 L16 34 Z" fill="#e8eef8" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <path d="M48 10 L22 36" stroke="#ffffff99" strokeWidth="1.5" />
        <path d="M12 30 L30 48" stroke={color} strokeWidth="5" strokeLinecap="round" />
        <path d="M18 42 L8 52" stroke="#8a5a2b" strokeWidth="6" strokeLinecap="round" />
        <circle cx="7" cy="53" r="3.5" fill={color} />
      </svg>
    )
  }
  if (part === 'アクセ') {
    return (
      <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="36" r="16" fill="none" stroke="#f2d27a" strokeWidth="5" />
        <path d="M22 16 L30 6 L38 16 L30 24 Z" fill={color} stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M27 12 L30 9" stroke="#ffffffcc" strokeWidth="1.5" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true">
      <path d="M30 6 L50 14 L48 34 C46 44 38 51 30 55 C22 51 14 44 12 34 L10 14 Z" fill="#c8d2e2" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M30 12 L30 49 M17 22 L43 22" stroke="#ffffff88" strokeWidth="1.5" />
    </svg>
  )
}

// 金床（作成）
export function Anvil({ width = 170 }) {
  return (
    <svg width={width} height={width * 0.5} viewBox="0 0 170 85" aria-hidden="true">
      <defs>
        <linearGradient id="fxAnvil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6d7787" /><stop offset="0.35" stopColor="#3b424e" /><stop offset="1" stopColor="#1b1f26" />
        </linearGradient>
      </defs>
      <path d="M8 10 L132 10 C150 10 162 16 166 24 L120 26 L112 40 L58 40 L50 26 L8 26 Z" fill="url(#fxAnvil)" stroke="#9aa6b8" strokeWidth="1" />
      <path d="M62 40 L108 40 L114 62 L56 62 Z" fill="#2a2f38" />
      <path d="M36 62 L134 62 L142 80 L28 80 Z" fill="url(#fxAnvil)" stroke="#5a6372" strokeWidth="1" />
      <path d="M12 12 L128 12" stroke="#c9d3e3" strokeWidth="1.5" opacity="0.7" />
    </svg>
  )
}

// 金槌（作成）。rotate は持ち手の端を中心に回す
export function Hammer({ size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" style={{ overflow:'visible' }}>
      <defs>
        <linearGradient id="fxHammerHead" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9aa6b8" /><stop offset="1" stopColor="#3b424e" />
        </linearGradient>
      </defs>
      <rect x="54" y="30" width="10" height="84" rx="4" fill="#7a4a22" stroke="#4a2a10" strokeWidth="1.5" />
      <rect x="28" y="12" width="62" height="28" rx="5" fill="url(#fxHammerHead)" stroke="#1b1f26" strokeWidth="1.5" />
      <rect x="30" y="14" width="58" height="5" rx="2" fill="#dfe6f2" opacity="0.6" />
    </svg>
  )
}
