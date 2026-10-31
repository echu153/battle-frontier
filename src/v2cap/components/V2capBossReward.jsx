import { useEffect } from 'react'
import { box, miniBtn, TEXT } from './v2ui.js'
import { JP_BOLD } from './casinoStyle.js'
import { bossThumbOf } from '../lib/bossArt.js'
import { DIFF_COLOR, DUNGEON_BOSSES, diffOf } from '../lib/dungeon.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦の報酬画面（討伐完了のテロップのあと）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「戦闘開始と討伐後のテロップ的なのが欲しい、報酬画面も」：
//   ボスの絵と名前・難易度／この挑戦の時間とダメージ／みんなが入れたダメージ（救援があるとき）／報酬／入口へ戻る。
//   st … 戦闘の状態（core/atb.js）・result … 削った量を送った返事（V2capDungeon.jsx の report。まだなら null）・onBack … 入口へ
//   ★画面を切り替えたら上へ戻す（ポップアップのあとと同じ決まり）
// ============================================================

const KF = `
@keyframes brwUp { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
`
const GOLD = '#ffd27a'
const up = (i) => ({ animation:`brwUp 0.35s ease-out ${(i * 0.09).toFixed(2)}s both` })
const Row = ({ label, value }) => (
  <div style={{ display:'flex', justifyContent:'space-between', gap:'10px', padding:'5px 0', borderTop:'1px solid #001428', fontSize:'12px' }}>
    <span style={{ color: TEXT.label }}>{label}</span>
    <span style={{ color: TEXT.bright, fontWeight:'bold' }}>{value}</span>
  </div>
)

export default function V2capBossReward({ bossKey, diffKey, st, result: r, onBack }) {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const boss = DUNGEON_BOSSES[bossKey], d = diffOf(bossKey, diffKey), thumb = bossThumbOf(bossKey)
  const members = r?.ok ? r.run.members : []
  const hpMax = r?.ok ? r.run.hp_max : 1
  return (
    <div style={{ ...box, padding:'14px', borderColor:'#8a6a2a' }}>
      <style>{KF}</style>
      <div style={{ ...up(0), textAlign:'center', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'20px', letterSpacing:'0.24em', paddingLeft:'0.24em', color: GOLD, textShadow:'0 0 10px rgba(255,179,0,0.55), 0 2px 0 #000', marginBottom:'10px' }}>討伐報酬</div>
      <div style={{ ...up(1), display:'flex', alignItems:'center', gap:'12px', marginBottom:'8px' }}>
        {thumb && <img src={thumb} alt="" draggable={false} style={{ width:'88px', height:'88px', objectFit:'contain', flexShrink:0 }} />}
        <div style={{ minWidth:0 }}>
          <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'16px', color:'#ff8866' }}>{boss.name}</div>
          <div style={{ fontSize:'12px', fontWeight:'bold', color: DIFF_COLOR[diffKey], marginTop:'2px' }}>{d?.label}</div>
        </div>
      </div>

      {!r && <div style={{ ...up(2), color: TEXT.label, fontSize:'11px', padding:'8px 0' }}>結果を送っています…</div>}
      {r && !r.ok && <div style={{ ...up(2), color:'#ff8888', fontSize:'12px', padding:'8px 0' }}>{r.text}</div>}
      {r?.ok && (
        <>
          <div style={up(2)}>
            <Row label="この挑戦の時間" value={`${st.t.toFixed(1)}秒`} />
            <Row label="この挑戦のダメージ" value={r.damage.toLocaleString()} />
          </div>
          {/* みんなが入れたダメージ（救援があるときだけ） */}
          {members.length > 1 && (
            <div style={{ ...up(3), borderTop:'1px solid #001428', padding:'6px 0' }}>
              <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'4px' }}>みんなのダメージ</div>
              {members.map(m => (
                <div key={m.name} style={{ marginBottom:'4px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:'8px', fontSize:'11px', color: m.me ? TEXT.bright : TEXT.sub }}>
                    <span>{m.owner ? '👑' : '🤝'}{m.name}</span>
                    <span>{Number(m.damage).toLocaleString()}（{((m.damage / hpMax) * 100).toFixed(1)}%）</span>
                  </div>
                  <div style={{ height:'4px', background:'#000818' }}>
                    <div style={{ width:`${Math.min(100, (m.damage / hpMax) * 100)}%`, height:'100%', background: m.me ? GOLD : '#44688a' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ ...up(4), border:`1px solid #8a6a2a`, background:'#000818', padding:'10px', marginTop:'8px' }}>
            <div style={{ color: GOLD, fontSize:'12px', fontWeight:'bold', marginBottom:'6px' }}>報酬</div>
            <div style={{ color: TEXT.sub, fontSize:'11px' }}>報酬は準備中です</div>
          </div>
        </>
      )}

      <button onClick={onBack} disabled={!r} style={{ ...up(5), ...miniBtn('#44ddff'), width:'100%', padding:'10px', fontSize:'13px', marginTop:'12px' }}>← 入口へ戻る</button>
    </div>
  )
}
