import { useEffect } from 'react'
import { box, miniBtn, TEXT } from './v2ui.js'
import { JP_BOLD } from './casinoStyle.js'
import { bossThumbOf } from '../lib/bossArt.js'
import { DIFF_COLOR, DUNGEON_BOSSES, HELPER_REWARD_MIN_PCT, contributionPctOf, diffOf } from '../lib/dungeon.js'
import { CORRECTED_TEXT } from '../lib/dungeonVerifyCall.js'
import { gainedExpOf, levelUpLines } from '../lib/settleLines.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦の報酬画面（討伐完了のテロップのあと）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「戦闘開始と討伐後のテロップ的なのが欲しい、報酬画面も」：
//   ボスの絵と名前・難易度／この挑戦の時間とダメージ／みんなが入れたダメージ（救援があるとき）／報酬／入口へ戻る。
//   【確定】同じ日 ユーザー選択「EXPとGoldを渡す」：報酬の欄に EXP と Gold（渡すのはサーバー・EXP は実際に入った量＝gainedExpOf）とLVアップの行。救援の人は割合も出す
//   st … 戦闘の状態（core/atb.js・入口で受け取ったときは無い）・result … 削った量を送った返事か受け取りの返事（V2capDungeon.jsx。まだなら null）
//   cls … いまの職業（LVアップの行）・onBack … 入口へ
//   【確定】2026-11-01 ユーザー「プレイヤーが敗北したときのテロップも欲しい、画面遷移も」「貢献度もわかるようにしてほしい、ダメージ与えた割合ね」：
//     倒せなかったときも同じ画面（見出しが「敗北」「時間切れ」・報酬の欄の代わりにボスの残りHP・残り時間）。貢献度はいつも出す（1人でも）
//     【確定】同じ日 ユーザー「これ完全ソロ討伐成功！にして、報酬3倍とか具体的な内容は言わないでほしい」＝ソロの行に倍率を書かない
//     onRetry … もう一度挑戦する（倒せなかったときだけ・null なら出さない）・retryCost … そのスタミナ・leftText … 討伐の残り時間・busy … 押している最中
//   【確定】2026-11-05 ユーザー「あと敵のHPの数値は見れないようにして」：ボスの残りHPはバーだけ（数字も割合も出さない）。貢献度はそのまま
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

export default function V2capBossReward({ bossKey, diffKey, cls, st = null, result: r, busy = false, leftText = null, onRetry = null, retryCost = 0, onBack }) {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const boss = DUNGEON_BOSSES[bossKey], d = diffOf(bossKey, diffKey), thumb = bossThumbOf(bossKey)
  const members = r?.ok ? r.run.members : []
  const hpMax = r?.ok ? r.run.hp_max : 1
  const reward = r?.reward
  // 倒せたか（届くまでは手元の戦闘で）。見出しと色
  const cleared = r?.ok ? r.run.cleared : (!st || st.b.hp <= 0)
  const head = cleared ? { text:'討伐報酬', color: GOLD, glow:'rgba(255,179,0,0.55)', border:'#8a6a2a' }
    : st?.winner === 'b' ? { text:'敗北', color:'#ff9a9a', glow:'rgba(255,34,68,0.6)', border:'#8a3a3a' }
    : st?.over && st.winner !== 'a' ? { text:'時間切れ', color:'#ffc46a', glow:'rgba(255,154,48,0.55)', border:'#8a6a2a' }
    : { text:'挑戦結果', color: TEXT.bright, glow:'rgba(120,160,255,0.45)', border:'#0044aa' }
  return (
    <div style={{ ...box, padding:'14px', borderColor: head.border }}>
      <style>{KF}</style>
      <div style={{ ...up(0), textAlign:'center', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'20px', letterSpacing:'0.24em', paddingLeft:'0.24em', color: head.color, textShadow:`0 0 10px ${head.glow}, 0 2px 0 #000`, marginBottom:'10px' }}>{head.text}</div>
      <div style={{ ...up(1), display:'flex', alignItems:'center', gap:'12px', marginBottom:'8px' }}>
        {thumb && <img src={thumb} alt="" draggable={false} style={{ width:'88px', height:'88px', objectFit:'contain', flexShrink:0 }} />}
        <div style={{ minWidth:0 }}>
          <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'16px', color:'#ff8866' }}>{boss.name}</div>
          <div style={{ fontSize:'12px', fontWeight:'bold', color: DIFF_COLOR[diffKey], marginTop:'2px' }}>{d?.label}</div>
        </div>
      </div>

      {!r && <div style={{ ...up(2), color: TEXT.label, fontSize:'11px', padding:'8px 0' }}>結果を確かめています…</div>}
      {r && !r.ok && <div style={{ ...up(2), color:'#ff8888', fontSize:'12px', padding:'8px 0' }}>{r.text}</div>}
      {r?.ok && (
        <>
          {st && (
            <div style={up(2)}>
              <Row label="この挑戦の時間" value={`${st.t.toFixed(1)}秒`} />
              <Row label="この挑戦のダメージ" value={r.damage.toLocaleString()} />
              {r.corrected && <div style={{ color: TEXT.sub, fontSize:'10px', padding:'2px 0 4px' }}>{CORRECTED_TEXT}</div>}
            </div>
          )}
          {/* 倒せなかったとき：ボスの残りHP（バーだけ＝数字を出さない） */}
          {!cleared && (
            <div style={{ ...up(3), borderTop:'1px solid #001428', padding:'6px 0' }}>
              <div style={{ fontSize:'11px', color: TEXT.label, marginBottom:'3px' }}>ボスの残りHP</div>
              <div style={{ height:'8px', background:'#000818', border:'1px solid #13405f' }}>
                <div style={{ width:`${Math.min(100, (r.run.hp / hpMax) * 100)}%`, height:'100%', background:'#cc3344' }} />
              </div>
              {leftText && <div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'4px', textAlign:'right' }}>討伐の残り時間 {leftText}</div>}
            </div>
          )}
          {/* 貢献度：与えたダメージがボスの全体のHPの何割か（1人でも出す） */}
          {members.length > 0 && (
            <div style={{ ...up(3), borderTop:'1px solid #001428', padding:'6px 0' }}>
              <div style={{ color: TEXT.label, fontSize:'11px', marginBottom:'4px' }}>貢献度（与えたダメージの割合）</div>
              {members.map(m => (
                <div key={m.name} style={{ marginBottom:'4px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:'8px', fontSize:'11px', color: m.me ? TEXT.bright : TEXT.sub }}>
                    <span>{m.owner ? '👑' : '🤝'}{m.name}</span>
                    <span><b>{contributionPctOf(m.damage, hpMax).toFixed(1)}%</b>（{Number(m.damage).toLocaleString()}）</span>
                  </div>
                  <div style={{ height:'4px', background:'#000818' }}>
                    <div style={{ width:`${contributionPctOf(m.damage, hpMax)}%`, height:'100%', background: m.me ? GOLD : '#44688a' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {cleared && <div style={{ ...up(4), border:`1px solid #8a6a2a`, background:'#000818', padding:'10px', marginTop:'8px' }}>
            <div style={{ color: GOLD, fontSize:'12px', fontWeight:'bold', marginBottom:'6px' }}>報酬</div>
            {/* undefined＝サーバーがまだ前の版（SQL を流す前）・null＝渡せるものが無い（ダメージ0など） */}
            {reward === undefined && <div style={{ color: TEXT.sub, fontSize:'11px' }}>報酬は準備中です</div>}
            {reward === null && <div style={{ color: TEXT.sub, fontSize:'11px' }}>この討伐の報酬はありません</div>}
            {reward && (
              <>
                {reward.solo && <div style={{ color: GOLD, fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'12px', marginBottom:'4px' }}>完全ソロ討伐成功！</div>}
                <div style={{ color:'#ffcc00', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'16px', lineHeight: 1.6 }}>EXP +{gainedExpOf(reward).toLocaleString()}</div>
                <div style={{ color:'#ffcc00', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'16px', lineHeight: 1.6 }}>Gold +{Number(reward.gold).toLocaleString()}</div>
                {reward.pct < 100 && <div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'2px' }}>救援のぶん：削った割合で{reward.pct}%（最低{HELPER_REWARD_MIN_PCT}%）</div>}
                {levelUpLines(cls, reward.level).map((l, i) => <div key={i} style={{ color: l.color, fontSize:'12px', marginTop:'4px' }}>{l.text}</div>)}
              </>
            )}
          </div>}
        </>
      )}

      {onRetry && <button onClick={onRetry} disabled={busy} style={{ ...up(5), ...miniBtn('#ff8866'), width:'100%', padding:'10px', fontSize:'13px', marginTop:'12px' }}>⚔ もう一度挑戦する（スタミナ{retryCost}）</button>}
      <button onClick={onBack} disabled={!r} style={{ ...up(5), ...miniBtn('#44ddff'), width:'100%', padding:'10px', fontSize:'13px', marginTop:'12px' }}>← 入口へ戻る</button>
    </div>
  )
}
