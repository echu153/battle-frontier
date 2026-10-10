import { useMemo, useState } from 'react'
import { STAT_DEFS, STAT_KEYS } from '../../v2/lib/stats.js'
import { miniBtn } from '../../v2/components/v2ui.js'
import { RARITY_COLOR } from '../lib/equipment.js'
import { AREA_LIST } from '../lib/areas.js'
import { powerAt, effectPct } from '../lib/gear.js'
import { plusOf, scrapNameOf } from '../lib/smith.js'

// ============================================================
// 「レベルキャップあり」版 — 装備の見せ方の関数（装備画面と鍛冶屋で同じものを使う）
//   画面の部品（レア度・強化値の印・絞り込みの帯）は v2capGear.jsx
// ============================================================
export const statLine = (s) => STAT_KEYS.filter(k => s[k] > 0).map(k => `${STAT_DEFS[k].label}+${s[k]}`).join(' ')
// 名前の色はレア度の色（ノーマル灰色・レア青・エピック紫・レジェンダリー黄色＝2026-10-10 ユーザー指示）
export const nameColor = (item) => RARITY_COLOR[item?.rarity] || '#88ccff'
export const PLUS_COLOR = '#ffcc00'
// 選んでいる／いないの小さいボタン
export const chip = (on) => ({ ...miniBtn(on ? '#44aaff' : '#62789a'), color: on ? '#88ccff' : '#93a9be' })
// 手に入る残骸の一覧の文（{エリアの番号: 個数} → 「新緑の残骸 +3・荒野の残骸 +1」）
export const gainText = (gain) => Object.entries(gain).sort((a, b) => a[0] - b[0])
  .map(([a, n]) => `${scrapNameOf(Number(a))} +${n}`).join('・')
// エリアの選択肢の名前
export const areaOptionLabel = (a) => `${a} ${AREA_LIST[a - 1]?.name || ''}`

// 持ち物の絞り込み（部位・レア度・エリア）と並べ替え（強い順・LVの高い順・新しい順）。
// all = [{ inv, item }]・lv = いまのLV（強い順は強化値と必要LV不足の効果%込み）。
// 返すのは 並べたあとの行（rows）・エリアの選択肢（areas）・選んでいる条件と変える関数（帯は v2capGear.jsx の GearFilterBar）
export const useGearRows = (all, lv) => {
  const [part, setPart] = useState('all')
  const [rarity, setRarity] = useState('all')
  const [area, setArea] = useState('all')
  const [sort, setSort] = useState('power')   // power / ilv / new
  const rows = useMemo(() => {
    const list = all.filter(r => (part === 'all' || r.item.part === part)
      && (rarity === 'all' || r.item.rarity === rarity)
      && (area === 'all' || r.item.area === area))
    const pw = (r) => Math.round(powerAt(r.item, r.inv.ilv, plusOf(r.inv)) * effectPct(r.inv.ilv, lv) / 100)
    if (sort === 'power') list.sort((a, b) => pw(b) - pw(a) || b.inv.ilv - a.inv.ilv)
    else if (sort === 'ilv') list.sort((a, b) => b.inv.ilv - a.inv.ilv || pw(b) - pw(a))
    else list.sort((a, b) => b.inv.id - a.inv.id)
    return list
  }, [all, part, rarity, area, sort, lv])
  // 持っている装備のエリア（選んでいるエリアは、持ち物から消えても選択肢に残す）
  const areas = useMemo(() => [...new Set([...all.map(r => r.item.area), ...(area === 'all' ? [] : [area])])].sort((a, b) => a - b), [all, area])
  return { rows, areas, part, setPart, rarity, setRarity, area, setArea, sort, setSort }
}
