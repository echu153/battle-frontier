import { useEffect } from 'react'
import { box, miniBtn, TEXT } from './v2ui.js'
import { JP_BOLD } from './casinoStyle.js'
import { bossThumbOf } from '../lib/bossArt.js'
import { DIFF_COLOR, DUNGEON_BOSSES, HELPER_REWARD_MIN_PCT, contributionPctOf, diffOf } from '../lib/dungeon.js'
import { CORRECTED_TEXT } from '../lib/dungeonVerifyCall.js'
import { gainedExpOf, levelUpLines } from '../lib/settleLines.js'
import { chDropsOf } from '../lib/challenge.js'
import { RARITY_COLOR, kindLabel, needLvOf } from '../lib/equipment.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦の報酬画面（討伐完了のテロップのあと）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー「戦闘開始と討伐後のテロップ的なのが欲しい、報酬画面も」：
//   ボスの絵と名前・難易度／討伐時間と与えたダメージ（この挑戦の分）／みんなが入れたダメージ（救援があるとき）／報酬／入口へ戻る。
//   【確定】同じ日 ユーザー選択「EXPとGoldを渡す」：報酬の欄に EXP と Gold（渡すのはサーバー・EXP は実際に入った量＝gainedExpOf）とLVアップの行。救援の人は割合も出す
//   st … 戦闘の状態（core/atb.js・入口で受け取ったときは無い）・result … 削った量を送った返事か受け取りの返事（V2capDungeon.jsx。まだなら null）
//   cls … いまの職業（LVアップの行）・onBack … 入口へ
//   【確定】2026-11-01 ユーザー「プレイヤーが敗北したときのテロップも欲しい、画面遷移も」「貢献度もわかるようにしてほしい、ダメージ与えた割合ね」：
//     倒せなかったときも同じ画面（見出しが「敗北」「時間切れ」・報酬の欄の代わりにボスの残りHP・残り時間）。貢献度はいつも出す（1人でも）
//     【確定】同じ日 ユーザー「これ完全ソロ討伐成功！にして、報酬3倍とか具体的な内容は言わないでほしい」＝ソロの行に倍率を書かない
//     onRetry … もう一度挑戦する（倒せなかったときだけ・null なら出さない）・retryCost … そのスタミナ・leftText … 討伐の残り時間・busy … 押している最中
//   【確定】2026-11-05 ユーザー「あと敵のHPの数値は見れないようにして」：ボスの残りHPはバーだけ（数字も割合も出さない）。貢献度はそのまま
//   【確定】2026-11-06 ユーザー「討伐時間 与えたダメージ 貢献度 にして」（前は「この挑戦の時間」「この挑戦のダメージ」「貢献度（与えたダメージの割合）」）。
//     倒せなかったとき（敗北・時間切れ）は「討伐」と言えないので時間の行は「戦闘時間」（こちらの判断）
//   【確定】同じ日 ユーザー「無駄改行入れないで」（「貢献度」の見出しだけの行の下に、自分の名前と%の行・バーの行が続いていた）：
//     貢献度は上の行と同じ1行（自分の分）。救援の人がいればその下に1人1行（名前と%だけ・バーと（ダメージ）はやめた）。
//     倒せなかったときのボスの残りHP（見出しの横にバー）と討伐の残り時間も1行ずつ
//   【確定】同じ日 ユーザー「これ討伐時間とかイラストの行の右側に移動できない？」：結果の行（討伐時間・与えたダメージ・残りHP・残り時間・貢献度）は
//     ボスの絵の右（名前と難易度の下）に置く。報酬の欄とボタンはその下の横いっぱいのまま
//   【確定】2026-11-06 ユーザー「4強の報酬を決めたい」→案に全部「推奨」：報酬の欄の Gold の下に、落としたもの（エリアの装備・特別な素材・専用装備）を1つ1行で出す
//     （渡すのはサーバーの v2cap_dungeon_pay_reward・表は lib/challengeDefs.js）。ソロ討伐の素材3倍も倍率は書かない（上の「具体的な内容は言わないで」と同じ）
//   ★画面を切り替えたら上へ戻す（ポップアップのあとと同じ決まり）
// ============================================================

const KF = `
@keyframes brwUp { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
`
const GOLD = '#ffd27a'
const up = (i) => ({ animation:`brwUp 0.35s ease-out ${(i * 0.09).toFixed(2)}s both` })
// 行は「見出し 値」の表：見出しは左から（書き出しをそろえる）・値は見出しのすぐ右の欄で右揃え
//   【確定】2026-11-06 ユーザー「討伐時間 ○○秒みたいに右揃えにして」「今の感じで先頭のスタートは同じ所で」（前は値が枠の右はしで、PC の幅だと見出しと離れていた）
// 落としたものの札（装備・素材・専用装備）
const DROP_TAG = { fontSize:'9px', border:'1px solid', padding:'0 4px', flexShrink: 0, lineHeight: 1.6 }
const LABEL_W = '96px'   // 見出しの欄（いちばん長い「与えたダメージ」「討伐の残り時間」が12pxで入る）
const VALUE_W = '60px'   // 値の欄（右揃え・「165.7秒」「30,000」「100.0%」が入る）。ボスの残りHPのバーもこの幅
const Row = ({ label, value }) => (
  <div style={{ display:'flex', alignItems:'baseline', padding:'5px 0', borderTop:'1px solid #001428', fontSize:'12px' }}>
    <span style={{ color: TEXT.label, width: LABEL_W, flexShrink: 0 }}>{label}</span>
    <span style={{ color: TEXT.bright, fontWeight:'bold', width: VALUE_W, flexShrink: 0, textAlign:'right', whiteSpace:'nowrap' }}>{value}</span>
  </div>
)

export default function V2capBossReward({ bossKey, diffKey, cls, st = null, result: r, busy = false, leftText = null, onRetry = null, retryCost = 0, onBack }) {
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const boss = DUNGEON_BOSSES[bossKey], d = diffOf(bossKey, diffKey), thumb = bossThumbOf(bossKey)
  const members = r?.ok ? r.run.members : []
  // 貢献度（%）：自分（me）とほかの人
  const pctOf = (m) => contributionPctOf(m?.damage || 0, hpMax).toFixed(1)
  const mine = members.find(m => m.me) || null, others = members.filter(m => !m.me)
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
      {/* ボスの絵の右に、名前・難易度と結果の行（ユーザー「これ討伐時間とかイラストの行の右側に移動できない？」） */}
      <div style={{ ...up(1), display:'flex', alignItems:'flex-start', gap:'12px', marginBottom:'8px' }}>
        {thumb && <img src={thumb} alt="" draggable={false} style={{ width:'88px', height:'88px', objectFit:'contain', flexShrink:0 }} />}
        <div style={{ minWidth:0, flex: 1 }}>
          <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'16px', color:'#ff8866' }}>{boss.name}</div>
          <div style={{ fontSize:'12px', fontWeight:'bold', color: DIFF_COLOR[diffKey], margin:'2px 0 4px' }}>{d?.label}</div>
          {!r && <div style={{ ...up(2), color: TEXT.label, fontSize:'11px', padding:'8px 0' }}>結果を確かめています…</div>}
          {r && !r.ok && <div style={{ ...up(2), color:'#ff8888', fontSize:'12px', padding:'8px 0' }}>{r.text}</div>}
          {r?.ok && st && (
            <div style={up(2)}>
              {/* 倒せなかったときは「討伐」と言えないので「戦闘時間」 */}
              <Row label={cleared ? '討伐時間' : '戦闘時間'} value={`${st.t.toFixed(1)}秒`} />
              <Row label="与えたダメージ" value={r.damage.toLocaleString()} />
              {r.corrected && <div style={{ color: TEXT.sub, fontSize:'10px', padding:'2px 0 4px' }}>{CORRECTED_TEXT}</div>}
            </div>
          )}
          {/* 倒せなかったとき：ボスの残りHP（バーだけ＝数字を出さない）・討伐の残り時間。どちらもほかの行と同じ1行（見出しだけの行を作らない） */}
          {r?.ok && !cleared && (
            <div style={up(3)}>
              <div style={{ display:'flex', alignItems:'center', padding:'5px 0', borderTop:'1px solid #001428', fontSize:'12px' }}>
                <span style={{ color: TEXT.label, width: LABEL_W, flexShrink: 0 }}>ボスの残りHP</span>
                <div style={{ width: VALUE_W, flexShrink: 0, boxSizing:'border-box', height:'8px', background:'#000818', border:'1px solid #13405f' }}>
                  <div style={{ width:`${Math.min(100, (r.run.hp / hpMax) * 100)}%`, height:'100%', background:'#cc3344' }} />
                </div>
              </div>
              {leftText && <Row label="討伐の残り時間" value={leftText} />}
            </div>
          )}
          {/* 貢献度：与えたダメージがボスの全体のHPの何割か（1人でも出す）。自分の分は上の行と同じ1行・救援の人がいればその下に1人1行 */}
          {members.length > 0 && (
            <div style={up(3)}>
              <Row label="貢献度" value={`${pctOf(mine)}%`} />
              {others.map(m => (
                <div key={m.name} style={{ display:'flex', alignItems:'baseline', padding:'0 0 5px', fontSize:'11px', color: TEXT.sub }}>
                  <span style={{ width: LABEL_W, flexShrink: 0, boxSizing:'border-box', paddingLeft:'12px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.owner ? '👑' : '🤝'}{m.name}</span>
                  <b style={{ width: VALUE_W, flexShrink: 0, textAlign:'right' }}>{pctOf(m)}%</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {r?.ok && (
        <>
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
                {/* 落としたもの（2026-11-06・lib/challenge.js の chDropsOf）：エリアの装備・特別な素材・専用装備。1つ1行（札と中身を同じ行に） */}
                {chDropsOf(reward).map((x, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'baseline', gap:'6px', fontSize:'12px', lineHeight: 1.8 }}>
                    <span style={{ ...DROP_TAG, color: x.kind === 'own' ? RARITY_COLOR.L : TEXT.label, borderColor: x.kind === 'own' ? RARITY_COLOR.L : '#33506e' }}>
                      {x.kind === 'gear' ? '装備' : x.kind === 'mat' ? '素材' : '専用装備'}
                    </span>
                    {x.kind === 'mat'
                      ? <span style={{ color:'#cfe2ff' }}>{x.name} ×{x.n}</span>
                      : <span style={{ minWidth: 0 }}>
                          <span style={{ color: RARITY_COLOR[x.item.rarity], fontWeight:'bold' }}>{x.item.name}</span>
                          <span style={{ color: TEXT.sub, fontSize:'10px' }}>（{kindLabel(x.item)}・LV{needLvOf(x.item, x.ilv)}）</span>
                        </span>}
                  </div>
                ))}
                {reward.pct < 100 &&<div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'2px' }}>救援のぶん：削った割合で{reward.pct}%（最低{HELPER_REWARD_MIN_PCT}%）</div>}
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
