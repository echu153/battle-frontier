// ============================================================
// 戦闘ログの色分け（表示だけの処理）
// ------------------------------------------------------------
// 1行がまるごと同じ色だと、スキル名とダメージ量が文章に埋もれて読みにくい。
// ここで文字列を見て「スキル名」「ダメージ」「回復量」「クリティカル」だけ
// 色と太さを変えたセグメントに切り分ける。
//
// ⚠戦闘エンジン側は一切変えない＝出撃・タワー・奈落・八獄・天穹・対人戦・
//   敵の行動ログまで、同じ規則で自動的に色が付く。
// ============================================================

// スキル名の書式は2通り。
//  ・味方/効果: 「⚔ 体当たり！ 〜」（絵文字のあとに名前＋！）
//  ・敵:        「牛頭の斧兵の斧撃！ 〜」（〜の＋名前＋！）
const RE_SKILL_EMOJI = /([←-⇿⌀-➿⬀-⯿\u{1F300}-\u{1FAFF}]️?)(\s?)([^！\s]{2,20})！/gu
const RE_SKILL_NO = /の([^！\s の]{2,20})！/gu
// 「〜！」の手前が文章（技名ではない）なら色を付けない。
// 技名は名詞なので助詞・数字・「〜した」などを含まないことを手掛かりにする。
const NOT_A_SKILL = /[をにはがへも0-9０-９、。…（）]|ダメージ|回復|した|しかし|ターン|倒れ|勝利|敗北/
const RE_DAMAGE = /(\d[\d,]*)(?=\s*の?(?:物理|特殊)?ダメージ)/gu
const RE_HEAL = /(\d[\d,]*)(?=\s*(?:HP)?回復)/gu
const RE_CRIT = /💥\s?クリティカル！?/gu

export const RICH = {
  skill: { color: '#ffcc44', fontWeight: 'bold' },
  damage: { color: '#ff5544', fontWeight: 'bold', fontSize: '14px' },
  heal: { color: '#55ee88', fontWeight: 'bold', fontSize: '14px' },
  crit: { color: '#ffee00', fontWeight: 'bold' },
}

// 見つけた範囲を [start, end) で集める。先に入れたものを優先し、重なる範囲は捨てる。
const collect = (text) => {
  const spans = []
  const add = (start, end, kind) => {
    if (start < 0 || end <= start) return
    for (const s of spans) if (start < s.end && end > s.start) return
    spans.push({ start, end, kind })
  }
  let m
  // クリティカルを先に確保する（技名の規則にも引っかかるため）
  RE_CRIT.lastIndex = 0
  while ((m = RE_CRIT.exec(text)) !== null) add(m.index, m.index + m[0].length, 'crit')
  RE_SKILL_EMOJI.lastIndex = 0
  while ((m = RE_SKILL_EMOJI.exec(text)) !== null) {
    if (NOT_A_SKILL.test(m[3])) continue
    const start = m.index + m[1].length + m[2].length
    add(start, start + m[3].length, 'skill')
  }
  RE_SKILL_NO.lastIndex = 0
  while ((m = RE_SKILL_NO.exec(text)) !== null) {
    if (NOT_A_SKILL.test(m[1])) continue
    add(m.index + 1, m.index + 1 + m[1].length, 'skill')
  }
  RE_DAMAGE.lastIndex = 0
  while ((m = RE_DAMAGE.exec(text)) !== null) add(m.index, m.index + m[1].length, 'damage')
  RE_HEAL.lastIndex = 0
  while ((m = RE_HEAL.exec(text)) !== null) add(m.index, m.index + m[1].length, 'heal')
  return spans.sort((a, b) => a.start - b.start)
}

// 文字列 → [{ text, kind }] （kind が null の部分は行の元の色のまま出す）
export const richSegments = (text) => {
  const src = String(text ?? '')
  if (!src) return []
  const spans = collect(src)
  if (spans.length === 0) return [{ text: src, kind: null }]
  const out = []
  let pos = 0
  for (const s of spans) {
    if (s.start > pos) out.push({ text: src.slice(pos, s.start), kind: null })
    out.push({ text: src.slice(s.start, s.end), kind: s.kind })
    pos = s.end
  }
  if (pos < src.length) out.push({ text: src.slice(pos), kind: null })
  return out
}
