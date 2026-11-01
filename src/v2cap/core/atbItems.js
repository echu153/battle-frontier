// ============================================================
// バトルフロンティアⅡ（v2cap）— ATB戦闘で飲む薬（商店で買う・挑戦で使う）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「挑戦とかで使用できるアイテムもここで販売してほしい
//   ・HPポーション 500・MPポーション 500・状態異常回復する薬 1000（いい名前案出して）」＋選んだこと：
//   ・状態異常を治す薬の名前は「清めの雫」（万能薬は薬師の技、聖水はアセンションの技と同じ名前になるので候補から外した）
//   ・HPとMPは最大の30%
//   ・押したらすぐ飲む（麻痺のあいだでも飲める）・ゲージは空になる（防御と同じ＝1回の行動のぶん）
//   ・3種類で共通の待ち時間30秒
// 【確定】同じ日 ユーザー「アイテムは4つまでしか持てないようにして、全部で合計4つ」「装備は挑戦タブから設定できるように」＋選択「戦闘に持ち込むのが4つ」：
//   商店では買いだめできる（持ち物）。戦闘に持ち込むのは3種類を合わせて4つまでで、挑戦のポップアップで選ぶ（画面 V2capItemLoadout.jsx・サーバー v2cap_profiles.item_loadout）。
//   飲むと持ち物から減る。選んだ数は残る＝次の挑戦も同じ数を持ち込む（足りなければあるぶんだけ）
// こちらで決めたこと：持てる数は種類ごとに99個・満タンや状態異常が無いときは飲めない（もったいない）・マクロには入れない
// ★値段は lib/shop.js・飲んだときの計算は core/atb.js の drinkItem・持っている数はサーバー（v2cap_profiles.items）
// ★値（ITEM_MAX・CARRY_MAX）の写しは SQL の v2cap_shop_buy・v2cap_set_item_loadout（shop.test.js が突き合わせる）
// ============================================================
export const ITEM_CD = 30         // どれかを飲んだあと、どの薬も飲めない長さ（秒）
export const ITEM_MAX = 99        // 種類ごとに持てる数
export const CARRY_MAX = 4        // 戦闘に持ち込める数（3種類を合わせて）
export const POTION_PCT = 30      // HP・MPの回復量（最大の%）

export const BATTLE_ITEMS = [
  { key:'hp',   name:'HPポーション', icon:'💚', color:'#44ff88', pct: POTION_PCT },
  { key:'mp',   name:'MPポーション', icon:'💙', color:'#66aaff', pct: POTION_PCT },
  { key:'cure', name:'清めの雫',     icon:'🌿', color:'#b6f06a' },
]
export const BATTLE_ITEM_BY_KEY = Object.fromEntries(BATTLE_ITEMS.map(i => [i.key, i]))
export const isBattleItem = (key) => BATTLE_ITEMS.some(i => i.key === key)

// サーバーの持っている数（v2cap_profiles.items）を形にそろえる。おかしい値は0
export const itemCountsOf = (items) =>
  Object.fromEntries(BATTLE_ITEMS.map(i => [i.key, Math.max(0, Math.min(ITEM_MAX, Math.floor(Number(items?.[i.key]) || 0)))]))
export const itemTotalOf = (counts) => BATTLE_ITEMS.reduce((sum, i) => sum + (Number(counts?.[i.key]) || 0), 0)

// 戦闘に持ち込む数：選んだ数（item_loadout）と持っている数（items）の少ないほう・合計 CARRY_MAX まで（サーバーが見ているが、念のためここでも切る）。
//   prof.items が無い＝薬の SQL を流す前の写し＝薬のボタンを出さない（null）
export const carriedItemsOf = (prof) => {
  if (!prof?.items) return null
  const chosen = itemCountsOf(prof.item_loadout)
  const have = itemCountsOf(prof.items)
  let room = CARRY_MAX
  return Object.fromEntries(BATTLE_ITEMS.map(({ key }) => {
    const n = Math.min(chosen[key], have[key], room)
    room -= n
    return [key, n]
  }))
}
