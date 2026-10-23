// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— V1からの引き継ぎ
// ------------------------------------------------------------
// 【確定】2026-10-23 ユーザーが決めたこと（設計 docs/v2cap-design.md §6-11）：
//   ・引き継ぐのは **v2cap のキャラクターを作成したとき**（その時点の V1 の値で1回だけ）。作成はいまは管理者だけ＝
//     一般の人には V2 を公開するまで入らない（ユーザー指示「作ってもV2サービス開始するまでは一般の人たちには適用されないように」）
//   ①EXP：V1 のキャラLV÷10（切り捨て・最大LV50）のLVに着くまで EXP×1.5。V1 のLV500から200ごとに +0.1（LV700で×1.6）
//   ②装備：V1 でいちばん強化値の高い装備（同じならレア度の高いほう）。V1 のボス装備なら同じボスのユニーク、
//     v2cap に同じものが無い装備は同じ種類（武器は武器種・防具は防具・装飾品は装飾品）のユニークからランダム。
//     ＋「ユニークをその強化値にする券」1枚（最大+16＝V1 の強化の上限・smith.js の PLUS_CAP）
//   ③箱：不思議な箱1つ＝残骸1〜3個・奇妙な箱1つ＝残骸5〜10個。エリアは15エリアからランダム。数の上限なし
// ★入れるのはサーバー（supabase_v2cap_core.sql の v2cap_v1_carry・倍率は v2cap_apply_exp・券は v2cap_v1_ticket_use）。
//   ここは表示とテストのための写し（v1carry.test.js が SQL と突き合わせる）
// ============================================================
import { PLUS_CAP, scrapNameOf } from './smith.js'

// ===== ① EXP =====
export const V1_EXP_BASE = 15    // ×1.5（10分率）
export const V1_EXP_FROM = 500   // V1 のこのLVから
export const V1_EXP_STEP = 200   // 200ごとに +0.1
export const V1_EXP_MAX_LV = 50  // v2cap のLV50に着くまで
// V1 のキャラLV → { mult（10分率・0＝なし）, until（このLVに着くまで掛ける・0＝なし）}
//   until が1だと「LV1に着くまで」＝掛からないので、V1 のLV20（until 2）から
export const v1ExpBoostOf = (charLv) => {
  const clv = Math.max(0, Math.floor(Number(charLv) || 0))
  const until = Math.min(V1_EXP_MAX_LV, Math.floor(clv / 10))
  if (until < 2) return { mult: 0, until: 0 }
  return { mult: V1_EXP_BASE + (clv >= V1_EXP_FROM ? Math.floor((clv - V1_EXP_FROM) / V1_EXP_STEP) : 0), until }
}
// 倍率が掛かっているか（いまのLVが until より下）
export const v1BoostOn = (prof) =>
  (Number(prof?.v1_exp_mult) || 0) > 10 && (Number(prof?.lv) || 1) < (Number(prof?.v1_exp_until) || 0)
// 入るEXP（サーバーの v2cap_apply_exp と同じ式＝四捨五入）。倍率が無ければそのまま
export const v1BoostedExp = (amount, prof) => {
  const a = Math.max(0, Math.floor(Number(amount) || 0))
  if (a <= 0 || !v1BoostOn(prof)) return a
  return Math.min(2000000000, Math.floor((a * Number(prof.v1_exp_mult) + 5) / 10))
}
// 「×1.6」
export const multLabel = (mult) => `×${(Math.max(0, Number(mult) || 0) / 10).toFixed(1)}`

// ===== ② 装備 =====
// V1 のボス装備（src/constants/bossEvolution.js）→ v2cap の同じボスのユニーク（uniqueDefs.js）。並びは SQL の c_v1／c_v2 と同じ
//   v2cap に当たるものが無い V1 のボス装備は2つ（インフェルノバスティオン・覇龍の聖鎧）＝同じ種類からランダム
export const V1_BOSS_UNIQUE = [
  ['スライムの指輪', 'ビッグスライムの指輪'], ['蒼粘剣', '蒼蝕の魔剣'],
  ['略奪者の短剣', '簒奪の刃'], ['影踏みのブーツ', '影縫いのブーツ'],
  ['古代魔導コア', '番人の心核'], ['虚無の杖', '虚葬の錫杖'],
  ['海竜の鱗', '海竜の蒼鱗'], ['アクアクラウン', 'タイダルクラウン'],
  ['雷鷲の爪牙', '嵐鷲の爪牙'], ['嵐の重装甲', '嵐纏の重鎧'],
  ['絶零の魔導砲', '絶零の魔導砲'], ['フロストバーンの聖鎧', 'フロストバーンの聖鎧'],
  ['深紅の牙輪', '深紅の牙輪'], ['深紅の魔眼石', '深紅の魔眼石'],
  ['ウラノスの天砲', 'ウラノスの天砲'], ['蒼天龍の指輪', '蒼天龍の指輪'],
]
// V1 の武器種（weapons.weapon_type）→ v2cap のユニークの武器種。ここに無い武器種は武器のユニーク全部から
//   （V1 の wand・rod は staff にまとめた名残・book は魔導書の別名として拾う）
export const V1_WEAPON_KINDS = {
  sword: ['片手剣', '両手剣'], katana: ['刀'], axe: ['斧'], spear: ['槍'], bow: ['弓'], dagger: ['短剣'],
  knuckle: ['拳'], gun: ['銃'], staff: ['杖'], wand: ['杖'], rod: ['杖'], tome: ['書'], book: ['書'], orb: ['宝珠'],
}
// 防具・装飾品は部位を問わない（V1 は防具・装飾品が1枠ずつ）
export const V1_ARMOR_PARTS = ['頭', '鎧', '腕', '足']
export const V1_ACC_PART = 'アクセ'
// 券の上限（V1 の強化の上限 +16）
export const V1_TICKET_MAX = PLUS_CAP
// いま持っている券の強化値（0＝持っていない）
export const ticketOf = (prof) => Math.max(0, Math.min(V1_TICKET_MAX, Math.floor(Number(prof?.v1_ticket) || 0)))
// 券を使えるか（ユニークで、いまの強化値が券より下）
export const canUseTicket = (item, plus, prof) => item?.rarity === 'U' && ticketOf(prof) > 0 && (Number(plus) || 0) < ticketOf(prof)

// ===== ③ 箱 =====
export const V1_BOX_SCRAP = { mystery: [1, 3], strange: [5, 10] }   // 1つで出る残骸の数（最小・最大）
export const V1_BOX_NAMES = { mystery: '不思議な箱', strange: '奇妙な箱' }

// ===== 画面の文（作成したあとの知らせ・プロフィール）=====
// carry＝サーバーの v1_carry（v2cap_v1_carry の返り値）。無ければ []
//   行は { text, color, name?（ユニークの名前・赤で出す）}
export const UNIQUE_NAME_COLOR = '#ff6b82'   // ユニークが落ちたときのログと同じ色（ユーザー指定）
export const carryLines = (carry) => {
  if (!carry) return []
  const out = []
  if ((Number(carry.exp_until) || 0) > 0) {
    out.push({ text: `📈 V1のキャラLV${Number(carry.char_lv).toLocaleString()} → LV${carry.exp_until}になるまで、もらえるEXPが${multLabel(carry.exp_mult)}`, color: '#44ff88' })
  }
  if (carry.unique) {
    const it = carry.item || {}
    const from = it.name ? `V1の「${it.name}」${Number(it.plus) > 0 ? `+${it.plus}` : ''} → ` : ''
    out.push({ text: `💎 ${from}ユニーク「`, name: carry.unique.name, tail: '」を入手！', color: '#cfe2ff' })
    if ((Number(carry.ticket) || 0) > 0) {
      out.push({ text: `🎫 強化券（+${carry.ticket}）を入手！ ユニークの装備1つを、鍛冶屋の強化ですぐ+${carry.ticket}にできます（1回だけ・失敗なし）`, color: '#ffcc00' })
    }
  }
  const b = carry.boxes || {}
  const nBox = (Number(b.mystery) || 0) + (Number(b.strange) || 0)
  if (nBox > 0) {
    const parts = [['mystery', b.mystery], ['strange', b.strange]].filter(([, n]) => Number(n) > 0)
      .map(([k, n]) => `${V1_BOX_NAMES[k]}×${Number(n).toLocaleString()}`)
    out.push({ text: `🎁 ${parts.join('・')} を開けた！`, color: '#ffcc66' })
    const scraps = Object.entries(carry.scraps || {}).map(([a, n]) => [Number(a), Number(n) || 0]).filter(([, n]) => n > 0).sort((x, y) => x[0] - y[0])
    for (const [a, n] of scraps) out.push({ text: `　${scrapNameOf(a)}×${n.toLocaleString()} を獲得した！`, color: '#cfe2ff' })
  }
  return out
}
