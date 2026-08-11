// ============================================================
// 拠点（Basecamp）— 表示用ラベルの定義
// ------------------------------------------------------------
// ⚠ 数値（産出レート・保管上限・強化コスト・適性倍率・拠点LVボーナス）は
//   ここに書かないこと。サーバー（base_get / base_upgrade）が唯一の正。
//   JS側にも式や数値を持つと SQL と二重定義になり、片方だけ直してズレる事故になる
//   （レイドの出現予定をクライアントで再計算して食い違った件と同じ根）。
//   このファイルは「key → 日本語名・絵文字・画像」の変換だけに徹する。
//
// 用語: ゲーム内の「素材」は既存のお宝素材を指すため、拠点のものは必ず「資材」と呼ぶ。
// ============================================================

// 資材4種（base_get の materials / base_collect の gained のキー）
export const MATERIALS = {
  wood:  { name: '木材',       emoji: '🪵' },
  stone: { name: '石材',       emoji: '🪨' },
  herb:  { name: '薬草',       emoji: '🌿' },
  mana:  { name: '魔力の欠片', emoji: '💠' },
}

// 作業適性4種（施設の枠が要求する作業。base_get の slots[].apt / workers[].apt のキー）
export const APTITUDES = {
  chop:   { name: '伐採',   emoji: '🪓' },
  mine:   { name: '採掘',   emoji: '⛏' },
  gather: { name: '採集',   emoji: '🧺' },
  water:  { name: '水やり', emoji: '💧' },
}

// 施設5種。ここの並び順がそのまま画面の表示順になる（サーバーの配列順に依存させない）
export const FACILITIES = {
  lumber:     { name: '伐採所', emoji: '🌲' },
  quarry:     { name: '採石場', emoji: '⛰' },
  herbfield:  { name: '薬草畑', emoji: '🌱' },
  manaspring: { name: '魔力泉', emoji: '⛲' },
  warehouse:  { name: '倉庫',   emoji: '📦' },
}

// 拠点仲間の種族。画像は既存ペットのスプライトを流用している（新規素材なし）。
// 適性値（0〜3）は種族固定だが、正はサーバー（base_get の workers[].apt）なのでここには持たない。
// lavagolem / magmaslime は v2 の「証」ドロップ専用で、v1では加入しない（表示だけ用意しておく）。
export const SPECIES = {
  slime:      { name: 'スライム',       image: '/suraimu.png' },
  touzoku:    { name: '盗賊',           image: '/touzoku.png' },
  yeti:       { name: '雪男',           image: '/yukiotoko.png' },
  yukionna:   { name: '雪女',           image: '/yukionna.png' },
  lavagolem:  { name: '溶岩ゴーレム',   image: '/yougango-remu.png' },
  magmaslime: { name: 'マグマスライム', image: '/magumasuraimu.png' },
}
