// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 精算のあとのログの行（出撃・塔で同じものを使う）
// ------------------------------------------------------------
// 文面はユーザーの指示どおり（V2capSortie.jsx にあったものをそのまま移した・2026-10-14 塔を作るとき）：
//   ・EXPの行に「（ClassEXP +◯）」は付けない（2026-10-12 ユーザー指示「この表記なくして（経験値はどっちにも入る）」）。
//     LV100のぶんは入らないので、そう出す
//   ・「🆙 LEVEL UP！ LV6（ステータスポイント+3）」（2026-10-12 ユーザー指示「レベルアップするとき英語表記で」）
//   ・「⭐ CLASS LEVEL UP！盗賊　LV3 → 4」の次の行に「（HP+14・…）」＝上がったクラスのステ（2026-10-12 ユーザー指示）
//   ・覚えた技は空き枠に入ったかどうかも書く（2026-10-12 ユーザー指示「スキルスロット余ってる場合はうめるようにして」）
//   ・落ちた装備は「🎁 「◯◯」を入手！」だけ・名前をレア度の色で（【レア】の頭の表記・必要LV・効果%は出さない＝2026-10-12〜13 ユーザー指示）
// ============================================================
import { MAX_LV } from './level.js'
import { jobUpHead, jobUpNote } from './jobs.js'
import { RARITY_COLOR } from './equipment.js'
import { LOG_PLAIN } from '../components/v2ui.js'

// 「EXP +12」（LV上限なら「（LV上限のため入らない）」を添える）
export const expText = (exp, lvBefore) => `EXP +${exp}${lvBefore >= MAX_LV ? '（LV上限のため入らない）' : ''}`

// LVアップ・CLASS LVアップ・覚えた技の行。cls＝精算した時点の職業／level＝サーバーの v2cap_apply_exp の返り値
// LVアップではステは上がらず、ステータスポイントが入る。サーバーが前の版（points を返さない）のあいだは数を出さない
export const levelUpLines = (cls, level) => {
  const lv = level || {}
  const out = []
  if (lv.level_ups > 0) {
    const pts = typeof lv.points === 'number' ? `（ステータスポイント+${lv.points}）` : ''
    out.push({ text:`🆙 LEVEL UP！ LV${lv.lv}${pts}`, color:'#44ff88' })
  }
  if (lv.job_ups > 0) {
    out.push({ text: jobUpHead(cls, lv), color:'#ffcc00' })
    const note = jobUpNote(cls, lv)
    if (note) out.push({ text: note, color:'#ffcc00' })
  }
  for (const name of lv.learned || []) {
    const into = (lv.set_added || []).includes(name)
    out.push({ text:`📖 スキル「${name}」を覚えた！${into ? '（スキルセットの空き枠に入れた）' : '（スキルセットで編成できる）'}`, color:'#44ddff' })
  }
  return out
}

// 落ちた装備の行（名前だけをレア度の色で）
// ★ユニークも同じ形（名前はユニークの赤）。【確定】2026-10-21 ユーザー指示「ドロップしたときユニークの文言いらない、普通の赤文字でいい」
//   ＝「💎 ユニーク「◯◯」を入手！」（大きな字）はやめた
export const dropLineOf = (item) => ({ color: LOG_PLAIN, parts: [
  { text:'🎁 「' }, { text: item.name, color: RARITY_COLOR[item.rarity] },
  { text:'」を入手！' },
] })
