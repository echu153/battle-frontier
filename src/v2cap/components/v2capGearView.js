import { useMemo, useRef, useState } from 'react'
import { STAT_DEFS, STAT_KEYS } from '../core/stats.js'
import { miniBtn } from './v2ui.js'
import { RARITY_COLOR, ALL_RARITIES } from '../lib/equipment.js'
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

// 絞り込みのエリアの選択肢：持っている装備のエリアのうち、行ったことのあるエリア（areaMax まで）だけ。初期装備（0）はいつも。選んでいるエリアは残す
//   【確定】2026-10-26 ユーザー指示「すべてのエリアも行ったことのないエリアは表示されないようにして、これも鍛冶屋にかかわらず全部のプルダウンに適用して」
//   （V1からの引き継ぎや開発用でもらったユニークは、まだ行っていないエリアの装備のことがある）
export const areaChoicesOf = (all, areaMax, selected = 'all') =>
  [...new Set([...all.map(r => r.item.area).filter(a => a <= areaMax), ...(selected === 'all' ? [] : [selected])])].sort((a, b) => a - b)
// 絞り込みのレア度の選択肢：ユニークは持ち物にあるときだけ（選んでいるときは残す）
//   【確定】2026-10-26 ユーザー指示「レア度のところ、ユニーク武器1つも手に入れたことないときは表示されないようにして、これは鍛冶屋じゃなくて全部ね」。
//   ユニークを手に入れた記録はサーバーに無いので、いま持っているかで見る（分解して無くなったら出さない）
export const rarityChoicesOf = (all, selected = 'all') =>
  ALL_RARITIES.filter(r => r !== 'U' || selected === 'U' || all.some(x => x.item.rarity === 'U'))

// 持ち物の絞り込み（部位・レア度・エリア）と並べ替え（gearSorter）。all = [{ inv, item }]・lv = いまのLV・areaMax = 行ったことのあるエリアの一番先（sortie.js の openAreaOf）。
// 返すのは 並べたあとの行（rows）・エリアとレア度の選択肢（areas・rarities）・選んでいる条件と変える関数（帯は v2capGear.jsx の GearFilterBar）
export const useGearRows = (all, lv, areaMax = Infinity) => {
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
  // 選択肢（選んでいるものは、持ち物から消えても選択肢に残す）
  const areas = useMemo(() => areaChoicesOf(all, areaMax, area), [all, area, areaMax])
  const rarities = useMemo(() => rarityChoicesOf(all, rarity), [all, rarity])
  return { rows, areas, rarities, part, setPart, rarity, setRarity, area, setArea, sort, setSort }
}

// ===== お気に入りの★（【確定】2026-10-26 ユーザー指示「お気に入り押しても登録されるまでラグがある、この遅さはさすがに看過できん」）=====
//   前は押すたびにサーバーの返事と持ち物の読み直しを待っていた（そのあいだ全部のボタンも押せなかった）。
//   いまは押した瞬間に画面を変え（over＝持ち物IDごとの押したあとの値）、サーバー（save）には後ろで送る。
//   同じ装備は順番に送る（連打しても最後に押した値が残る）。全部送り終わったら持ち物を読み直す（refresh・待たない）。
//   送れなかったら元に戻して onError（save は失敗の文か null を返す）
export const withFavs = (inventory, over) => (inventory || []).map(inv => (inv.id in over ? { ...inv, fav: over[inv.id] } : inv))
// 送り役（hook から分けた＝テストできるように）。apply(id, value) で画面の値を変える。返すのは押す関数（送り終わりの Promise を返す）
export const makeFavSender = ({ save, refresh, onError, apply }) => {
  const chain = {}
  let sending = 0
  return (inv) => {
    const id = inv.id, next = !inv.fav
    apply(id, next)
    sending++
    chain[id] = (chain[id] || Promise.resolve())
      .then(() => save(id, next))
      .then(err => { if (err) { apply(id, !next); onError?.(err) } }, e => { apply(id, !next); onError?.(e?.message || String(e)) })
      .finally(() => { if (--sending === 0) refresh?.() })
    return chain[id]
  }
}
export const useFavToggle = ({ save, refresh, onError }) => {
  const [over, setOver] = useState({})
  const cbs = useRef({ save, refresh, onError })
  cbs.current = { save, refresh, onError }
  const [toggle] = useState(() => makeFavSender({
    save: (id, on) => cbs.current.save(id, on),
    refresh: () => cbs.current.refresh?.(),
    onError: (e) => cbs.current.onError?.(e),
    apply: (id, v) => setOver(o => ({ ...o, [id]: v })),
  }))
  return { over, toggle }
}
