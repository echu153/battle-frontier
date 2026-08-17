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

// ★ランクの色は**旧版（無印）と同じ**（2026-08-17 ユーザー指示）。
//   出どころは src/pages/Equipment.jsx の RARITY_COLORS（f〜sss）。v2はF〜Sまで
export const RANK_COLOR = { F:'#888888', E:'#6699cc', D:'#ff8844', C:'#44bb44', B:'#4488ff', A:'#ff4444', S:'#ffcc00' }
// ⚠**部位のアイコンは使わない**（2026-08-16 ユーザー指示）。環境によっては豆腐（□）になって
//   装備名の頭に読めない字が並ぶ。部位は文字（武器・頭・鎧…）でそのまま出すこと

// ===== 戦闘ログの「入手！」の1行 =====
// ★色を付けるのは**ランクと装備名だけ**（2026-08-17 ユーザー指示）。
//   行全体を塗ると読みにくいので、🎁・かぎかっこ・「を入手！」は地の色のままにする。
//   parts を描くのは V2LogLine.jsx。出撃とアリーナで同じ見た目にするためここに置いている
export const LOG_PLAIN = '#7fa6d0'
export const dropLine = (item, color) => ({
  color: LOG_PLAIN,
  parts: [
    { text:'🎁 ' },
    { text:`${item.rank}級`, color },
    { text:'「' },
    { text: item.name, color },
    { text:'」を入手！' },
  ],
})
