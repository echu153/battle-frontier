import { V2Tip } from './V2ItemTip.jsx'
import { RARITY_COLOR } from '../lib/equipment.js'
import { DUNGEON_BOSSES } from '../lib/dungeon.js'

// ============================================================
// 「レベルキャップあり」版 — 挑戦（四凶）の専用装備の能力（2026-11-06・lib/challengeDefs.js）
//   ユニークの V2capUniqueFx と同じ形。色はレジェンダリーの黄色（専用装備のレア度はレジェンダリー）
//   ・ChallengeText … 能力の文（改行はそのまま行にする）
//   ・ChallengeNote … 装備の行の下の枠（能力の文と、落とすボス）
//   ・V2capChallengeFx … 着けている専用装備の一覧（compact＝ホームのステータス欄の1行・ふつう＝プロフィールの全文）
// ★2026-11-06 ユーザー「レジェンダリーは必要レベル70」＝ノーマルでもハードでも同じ装備（前は難易度ごとに別で「（ノーマル）」を付けていた）
// ============================================================
const L = RARITY_COLOR.L
const NOTE = '同じ専用装備は1つまで。鍛冶屋の作成「挑戦装備」で作れる'

// 「黒龍ヴァルゼノク」（落とすボスの名前。どの難易度でも落とす）
export const challengeFromOf = (item) => item?.boss || DUNGEON_BOSSES[item?.bossKey]?.name || ''

export const ChallengeText = ({ item, style = null }) => (
  <div style={{ whiteSpace:'pre-line', color:'#fff2b0', lineHeight:1.6, ...style }}>{item?.text || ''}</div>
)

export const ChallengeNote = ({ item }) => (
  <div style={{ fontSize:'10px', margin:'2px 0 4px', padding:'3px 6px', border:'1px solid #3a3216', background:'#100d04' }}>
    <ChallengeText item={item} />
    <div style={{ color:'#7fa6d0' }}>{challengeFromOf(item)}が落とす・同じものは1つまで着けられる</div>
  </div>
)

export default function V2capChallengeFx({ items, compact = false, cell = null, valueCell = null }) {
  if (!items?.length) return null
  if (compact) {
    return (
      <div style={{ display:'grid', gap:'2px', marginBottom:'6px' }}>
        {items.map(u => (
          <V2Tip key={u.id} width="270px" color={L} style={{ ...cell, justifyContent:'flex-start' }}
            body={<>
              <div style={{ color: L }}>専用装備：{u.name}</div>
              <ChallengeText item={u} />
              <div style={{ color:'#7fa6d0', marginTop:'3px' }}>{challengeFromOf(u)}が落とす。{NOTE}</div>
            </>}>
            <span style={{ color: L, fontSize:'9px', flexShrink:0 }}>専用装備</span>
            <span style={{ ...valueCell, flex:1, minWidth:0, textAlign:'left', color:'#cfe2ff' }}>{u.name}</span>
            <span style={{ color: L, fontSize:'9px', flexShrink:0 }}>発動中</span>
          </V2Tip>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display:'grid', gap:'4px' }}>
      {items.map(u => (
        <div key={u.id} style={{ background:'#000818', border:'1px solid #3a3216', padding:'5px 8px', fontSize:'11px', lineHeight:1.7 }}>
          <div style={{ color: L }}>{u.name}<span style={{ color:'#7fa6d0', fontSize:'10px', marginLeft:'6px' }}>{challengeFromOf(u)}が落とす</span></div>
          <ChallengeText item={u} />
        </div>
      ))}
      <div style={{ color:'#7fa6d0', fontSize:'10px' }}>{NOTE}</div>
    </div>
  )
}
