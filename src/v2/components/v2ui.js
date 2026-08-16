// バトルフロンティアⅡ（リメイク版）— 画面で使い回すスタイル
// 旧版の見た目に寄せたターミナル調。色は用途で決める（青=枠、黄=Gold、緑=EXP）
export const box = { border:'1px solid #0044aa', background:'#001040', fontFamily:'monospace' }
export const btn = (color) => ({
  background:'#001840', border:`1px solid ${color}`, color, padding:'8px 12px',
  cursor:'pointer', fontFamily:'monospace', fontSize:'12px',
})
export const miniBtn = (color) => ({
  background:'#000818', border:`1px solid ${color}`, color, padding:'3px 6px',
  cursor:'pointer', fontFamily:'monospace', fontSize:'10px', lineHeight:1,
})
// ===== 文字の色 =====
// ⚠**暗い色を使わない**（2026-08-16 ユーザー指摘「通常の文字が見づらい」）。
//   背景が #001040 の濃紺なので、#446688 あたりだと読めない。新しく書くときはここから選ぶ。
export const TEXT = {
  label: '#7fa6d0',   // 小さい見出し・項目名
  sub:   '#93a9be',   // 補足の文章
  body:  '#88ccff',   // ふつうの文字
  bright:'#cfe2ff',   // 目立たせたい文字
  empty: '#62789a',   // 「—」や押せないボタン
}

export const RANK_COLOR = { F:'#94a7bb', E:'#88aa99', D:'#88bbdd', C:'#66ddaa', B:'#88ddff', A:'#ffcc00', S:'#ff88cc' }
export const PART_ICON = { 武器:'⚔', 頭:'🪖', 鎧:'🛡', 腕:'🧤', 足:'👢', アクセ:'💍' }
