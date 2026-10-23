import { box, TEXT } from './v2ui.js'
import { carryLines, multLabel, ticketOf, v1BoostOn, UNIQUE_NAME_COLOR } from '../lib/v1carry.js'

// ============================================================
// 「レベルキャップあり」版 — V1からの引き継ぎ（2026-10-23・数の正は lib/v1carry.js・入れるのはサーバーの v2cap_v1_carry）
//   ・CarryLines … 作成したときに受け取ったものの行（ホームの作成直後の知らせと、プロフィールで同じものを出す）
//   ・既定 … プロフィールの欄。いまの様子（EXPの倍率が続いているか・強化券を使ったか）＋受け取ったもの。引き継ぎが無いキャラには出さない
// ============================================================
export function CarryLines({ carry }) {
  return carryLines(carry).map((l, i) => (
    <div key={i} style={{ color: l.color, fontSize:'11px', lineHeight:1.8 }}>
      {l.text}{l.name && <span style={{ color: UNIQUE_NAME_COLOR }}>{l.name}</span>}{l.tail}
    </div>
  ))
}

export default function V2capV1Carry({ prof }) {
  const carry = prof?.v1_carry
  if (!carry) return null
  const until = Number(carry.exp_until) || 0
  const ticket = ticketOf(prof)
  return (
    <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
      <div style={{ color:'#88aaff', fontSize:'12px', marginBottom:'6px' }}>🔁 V1からの引き継ぎ</div>
      <div style={{ fontSize:'11px', lineHeight:1.8, marginBottom:'6px' }}>
        {until > 0 && (v1BoostOn(prof)
          ? <div style={{ color:'#44ff88' }}>EXP{multLabel(prof.v1_exp_mult)}：LV{until}になるまで続きます</div>
          : <div style={{ color: TEXT.sub }}>EXP{multLabel(carry.exp_mult)}：LV{until}に着いたので終わりました</div>)}
        {(Number(carry.ticket) || 0) > 0 && (ticket > 0
          ? <div style={{ color:'#ffcc00' }}>強化券（+{ticket}）：まだ使っていません（鍛冶屋の強化で、ユニークの装備1つに使えます）</div>
          : <div style={{ color: TEXT.sub }}>強化券（+{carry.ticket}）：使いました</div>)}
      </div>
      <div style={{ color: TEXT.label, fontSize:'10px', marginBottom:'2px' }}>キャラクターを作成したときに受け取ったもの</div>
      <CarryLines carry={carry} />
    </div>
  )
}
