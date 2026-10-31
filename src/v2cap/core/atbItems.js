// ============================================================
// バトルフロンティアⅡ（v2cap）— ATB戦闘で飲む薬（商店で買う・挑戦で使う）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「挑戦とかで使用できるアイテムもここで販売してほしい
//   ・HPポーション 500・MPポーション 500・状態異常回復する薬 1000（いい名前案出して）」＋選んだこと：
//   ・状態異常を治す薬の名前は「清めの雫」（万能薬は薬師の技、聖水はアセンションの技と同じ名前になるので候補から外した）
//   ・HPとMPは最大の30%
//   ・押したらすぐ飲む（麻痺のあいだでも飲める）・ゲージは空になる（防御と同じ＝1回の行動のぶん）
//   ・3種類で共通の待ち時間30秒
// こちらで決めたこと：持てる数は種類ごとに99個・満タンや状態異常が無いときは飲めない（もったいない）・マクロには入れない
// ★値段は lib/shop.js・飲んだときの計算は core/atb.js の drinkItem・持っている数はサーバー（v2cap_profiles.items）
// ★値（ITEM_MAX）の写しは SQL の v2cap_shop_buy（shop.test.js が突き合わせる）
// ============================================================
export const ITEM_CD = 30         // どれかを飲んだあと、どの薬も飲めない長さ（秒）
export const ITEM_MAX = 99        // 種類ごとに持てる数
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
