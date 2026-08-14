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
export const RANK_COLOR = { F:'#667788', E:'#88aa99', D:'#88bbdd', C:'#66ddaa', B:'#88ddff', A:'#ffcc00', S:'#ff88cc' }
export const PART_ICON = { 武器:'⚔', 頭:'🪖', 鎧:'🛡', 腕:'🧤', 足:'👢', アクセ:'💍' }
