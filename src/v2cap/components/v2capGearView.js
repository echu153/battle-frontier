import { useMemo, useState } from 'react'
import { STAT_DEFS, STAT_KEYS } from '../core/stats.js'
import { miniBtn } from './v2ui.js'
import { RARITY_COLOR } from '../lib/equipment.js'
import { AREA_LIST } from '../lib/areas.js'
import { effectivePowerAt } from '../lib/gear.js'
import { needLvOf } from '../lib/equipment.js'
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
// 絞り込みのプルダウン（横並びで同じ幅になる）。選んでいる（すべて以外）ときは枠と文字を明るく。color＝その色にする（レア度の色）
//   持ち物の絞り込み（v2capGear.jsx の GearFilterBar）と鍛冶屋の作成の選び方で同じものを使う（2026-10-14 ユーザー指示でどちらもプルダウンの横並び）
export const filterSelect = (on, color) => ({
  flex:'1 1 0', minWidth:0, background:'#000818', border:`1px solid ${on ? color || '#44aaff' : '#62789a'}`,
  color: on ? color || '#88ccff' : '#93a9be', fontFamily:'monospace', fontSize:'11px', padding:'3px 4px', cursor:'pointer',
})
// 選択肢の色（開いた一覧はプルダウンの色を引き継ぐので、1つずつ決める）
export const optionStyle = (color) => ({ background:'#000818', color: color || '#cfe2ff' })
// 手に入る残骸の一覧の文（{エリアの番号: 個数} → 「新緑の残骸 +3・荒野の残骸 +1」）
export const gainText = (gain) => Object.entries(gain).sort((a, b) => a[0] - b[0])
  .map(([a, n]) => `${scrapNameOf(Number(a))} +${n}`).join('・')
// エリアの選択肢の名前
// ★エリア0＝初期装備（キャラ作成で配る・2026-10-12）
export const areaOptionLabel = (a) => (a === 0 ? '初期装備' : `${a} ${AREA_LIST[a - 1]?.name || ''}`)

// 並べ替えの比べ方：power＝強い順・ilv＝LVの高い順・new＝新しい順・fav＝お気に入り（★）を上に、そのあとは強い順
//   （fav は 2026-10-26 ユーザー指示「お気に入りのソートもできるように」）。lv＝いまのLV（強い順は強化値と、必要LVに足りない装備のLV相当込み）
export const gearSorter = (sort, lv) => {
  const pw = (r) => effectivePowerAt(r.item, r.inv.ilv, lv, plusOf(r.inv))
  const need = (r) => needLvOf(r.item, r.inv.ilv)   // 「LVの高い順」は画面に出す必要LVで並べる
  const strong = (a, b) => pw(b) - pw(a) || need(b) - need(a)
  if (sort === 'power') return strong
  if (sort === 'ilv') return (a, b) => need(b) - need(a) || pw(b) - pw(a)
  if (sort === 'fav') return (a, b) => (b.inv.fav ? 1 : 0) - (a.inv.fav ? 1 : 0) || strong(a, b)
  return (a, b) => b.inv.id - a.inv.id
}

// 持ち物の絞り込み（部位・レア度・エリア）と並べ替え（gearSorter）。all = [{ inv, item }]・lv = いまのLV。
// 返すのは 並べたあとの行（rows）・エリアの選択肢（areas）・選んでいる条件と変える関数（帯は v2capGear.jsx の GearFilterBar）
export const useGearRows = (all, lv) => {
  const [part, setPart] = useState('all')
  const [rarity, setRarity] = useState('all')
  const [area, setArea] = useState('all')
  const [sort, setSort] = useState('power')   // power / ilv / new / fav
  const rows = useMemo(() => {
    const list = all.filter(r => (part === 'all' || r.item.part === part)
      && (rarity === 'all' || r.item.rarity === rarity)
      && (area === 'all' || r.item.area === area))
    return list.sort(gearSorter(sort, lv))
  }, [all, part, rarity, area, sort, lv])
  // 持っている装備のエリア（選んでいるエリアは、持ち物から消えても選択肢に残す）
  const areas = useMemo(() => [...new Set([...all.map(r => r.item.area), ...(area === 'all' ? [] : [area])])].sort((a, b) => a - b), [all, area])
  return { rows, areas, part, setPart, rarity, setRarity, area, setArea, sort, setSort }
}
