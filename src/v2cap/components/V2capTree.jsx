import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { TEXT } from './v2ui.js'
import { FORTUNE_BY_NAME, canPray, remainUntilPray, prayDayOf } from '../lib/tree.js'
import { jobUpHead, jobUpNote } from '../lib/jobs.js'
import { gainedExpOf } from '../lib/settleLines.js'
import V2capRevelationFx from './V2capRevelationFx.jsx'
import { JP_BOLD } from './casinoStyle.js'
import { TREE_ART, MINCHO, revelationStyleOf, stageArtOf, artFilterOf } from '../lib/fxStyle.js'

// ============================================================
// 「レベルキャップあり」版 — ユグレシアの宝樹（1日1回祈る）
//   ・ごほうびは経験値だけ（祈った時点のLVの推奨の場所で10回出撃したくらい × 運勢の倍率 × 連続日数の倍率）
//   ・【確定】2026-10-14 毎日祈ったときのボーナス（1日目1.0 → 毎日+0.1 → 10日目2.0・11日目からも2.0・空くと1日目に戻る・AM5時区切り）。
//     【確定】同じ日にユーザー指示「説明以外に信仰心の文言いらない、連続ボーナスの詳細な記載もいらない」＝画面に出すのは説明文の
//     「毎日祈ることで信仰心が上がっていきます。」だけ（連続日数・倍率・10日ぶんの印・「連続◯日目のボーナス」は出さない。EXPには掛かっている）
//   ★出る確率は画面に出さない（今のⅡと同じ）。抽選と経験値はサーバー（v2cap_pray）。仕組みの正は src/v2cap/lib/tree.js
// 【確定】2026-10-13 ユーザー指示「ユグレシアの宝樹、今こんな感じでパッとしないから、良い感じにしてほしい」：見た目を作り直した
//   ・上に宝樹の絵（天啓の演出と同じ TREE_ART）を大きく敷く。ゆっくり寄る・根元から光の粒が昇る・葉から光がしたたる・きらめき
//     今日の運勢で絵の明るさと光を変える（lib/fxStyle.js の stageArtOf・大吉は金の光の筋／凶と大凶は紫・赤黒く沈む）
//   ・説明文はユーザーの文（2026-10-14 の4行）。前の「LV10なら 吉で EXP +30…」は消した
//   ・結果は「─ 今日の天啓 ─」の札。祈ったあとに画面を開き直しても、今日の運勢（last_fortune）を札で出す（EXPは祈った直後だけ）
//   ・祈るボタンは光る祭壇風。祈れないときは「次に祈れるまで」と残り時間を大きく
//   ・これまでの結果（直近10回）は運勢の札を並べる（開け閉めのボタンはやめた）
//   ・動きは prefers-reduced-motion なら止める
// 【確定】2026-10-13 ユーザーが用意した絵（public/V2ホーム の元の絵 → 画面で使う WebP・まわりは透明）：
//   ・祈るアイコン.png → PRAY_ICON（金の手と葉・192×192）＝祈るボタンの 🙏 の代わり
//   ・ユグレシアUI.png → ORACLE_FRAME（金のつるの石板・石板の縁で切って 1040×594）＝「今日の天啓」の札。
//     石板の縦横の比のまま広がる（最大520px）。中の文字は石板の幅に合わせて大きさを変える（cqw）。
//     LEVEL UP などの行と「演出をもう一度見る」は石板の下に出す（石板の中に収まらないので）
// ============================================================
const PRAY_ICON = '/v2cap-art/pray-icon.webp'
const ORACLE_FRAME = '/v2cap-art/oracle-frame.webp'
// 石板の内側（金の線の内側。上の飾りとつるをよける）＝ padding。% は幅に対する割合（高さ594 ÷ 幅1040 を掛けて直す）
const FRAME_RATIO = '1040 / 594'
const FRAME_PAD = '10.5% 10% 7%'
const pad = (n) => String(n).padStart(2, '0')
const seeded = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

const KF = `
@keyframes ytBreath { from { transform: scale(1.02) } to { transform: scale(1.09) translateY(-1.5%) } }
@keyframes ytMote { 0% { transform: translate(0,0) scale(0.5); opacity: 0 } 15% { opacity: 1 } 75% { opacity: 0.85 } 100% { transform: translate(var(--dx), var(--rise)) scale(1); opacity: 0 } }
@keyframes ytDrip { 0% { transform: translateY(0); opacity: 0 } 20% { opacity: 1 } 100% { transform: translateY(48px); opacity: 0 } }
@keyframes ytGlint { 0%,100% { transform: scale(0.2) rotate(0deg); opacity: 0 } 50% { transform: scale(1) rotate(45deg); opacity: 1 } }
@keyframes ytGlow { 0%,100% { opacity: 0.55 } 50% { opacity: 1 } }
@keyframes ytRays { from { transform: translate(-50%,-50%) rotate(0deg) } to { transform: translate(-50%,-50%) rotate(360deg) } }
@keyframes ytPulse { 0%,100% { box-shadow: 0 0 10px #44dd9944, inset 0 0 14px #44dd9922 } 50% { box-shadow: 0 0 26px #6fffc077, inset 0 0 24px #44dd9944 } }
@keyframes ytSheen { 0% { transform: translateX(-130%) skewX(-18deg) } 60%,100% { transform: translateX(380%) skewX(-18deg) } }
@keyframes ytIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
@media (prefers-reduced-motion: reduce) { .yt-anim { animation: none !important } }
`

// 光の粒（毎回同じ並び）。delay を負にして、開いた瞬間から途中の粒が見えるようにする
const MOTES = (() => { const r = seeded(11); return Array.from({ length: 30 }, () => ({ x: 14 + r() * 72, y: 4 + r() * 30, s: 1.5 + r() * 2.5, dur: 4.5 + r() * 4, delay: -r() * 8, dx: Math.round((r() - 0.5) * 40), rise: -Math.round(70 + r() * 90) })) })()
const DRIPS = (() => { const r = seeded(23); return Array.from({ length: 14 }, () => ({ x: 12 + r() * 76, y: 24 + r() * 22, dur: 2.6 + r() * 2, delay: -r() * 4 })) })()
const GLINTS = (() => { const r = seeded(37); return Array.from({ length: 10 }, () => ({ x: 14 + r() * 72, y: 6 + r() * 34, s: 9 + r() * 7, dur: 2.6 + r() * 2.4, delay: -r() * 5 })) })()

// 宝樹の絵の舞台。fortune＝今日の運勢（まだなら null）
function TreeStage({ fortune }) {
  const mood = fortune ? revelationStyleOf(fortune) : null
  const bad = !!mood && mood.level < 0
  const glow = mood ? mood.glow : '#ffd75e'
  const mote = bad ? '#c9b3e6' : '#fff1bf'
  const moteN = !mood ? 22 : bad ? 8 : 12 + mood.level * 3
  const rays = !mood ? 0.1 : mood.level >= 4 ? 0.2 : mood.level >= 2 ? 0.08 : 0
  return (
    <div style={{ position:'relative', width:'100%', aspectRatio:'16 / 9', maxHeight:'400px', minHeight:'200px', overflow:'hidden', background:'#020a10' }}>
      {TREE_ART && (
        <div className="yt-anim" style={{ position:'absolute', inset:0, backgroundImage:`url(${TREE_ART})`, backgroundSize:'cover', backgroundPosition:'50% 30%',
          transformOrigin:'50% 35%', filter: artFilterOf(stageArtOf(fortune)), transition:'filter 1.2s ease', animation:'ytBreath 28s ease-in-out infinite alternate' }} />
      )}
      {/* 光の筋（祈る前と吉以上） */}
      {rays > 0 && (
        <div className="yt-anim" style={{ position:'absolute', left:'50%', top:'30%', width:'200%', aspectRatio:'1 / 1', pointerEvents:'none', mixBlendMode:'screen', opacity: rays,
          background:`repeating-conic-gradient(${glow} 0deg 6deg, transparent 6deg 16deg)`,
          maskImage:'radial-gradient(circle, #000 0%, transparent 45%)', WebkitMaskImage:'radial-gradient(circle, #000 0%, transparent 45%)',
          animation:'ytRays 60s linear infinite' }} />
      )}
      {/* 葉の光（運勢の色） */}
      <div className="yt-anim" style={{ position:'absolute', inset:0, pointerEvents:'none', mixBlendMode:'screen', opacity: bad ? 0.25 : 1,
        background:`radial-gradient(ellipse 46% 40% at 50% 30%, ${glow}55 0%, transparent 70%)`, animation:'ytGlow 5s ease-in-out infinite' }} />
      {bad && <div style={{ position:'absolute', inset:0, pointerEvents:'none', mixBlendMode:'multiply', background: mood.storm ? 'rgba(90,0,30,0.4)' : 'rgba(40,20,90,0.34)' }} />}
      {/* きらめき（葉のあたり） */}
      {!bad && GLINTS.map((g, i) => (
        <div key={`g${i}`} className="yt-anim" style={{ position:'absolute', left:`${g.x}%`, top:`${g.y}%`, width:g.s, height:g.s, marginLeft:-g.s / 2, marginTop:-g.s / 2, pointerEvents:'none', opacity:0,
          background:'radial-gradient(circle, #ffffff 0 14%, transparent 16%), linear-gradient(0deg, transparent 46%, #ffffffcc 50%, transparent 54%), linear-gradient(90deg, transparent 46%, #ffffffcc 50%, transparent 54%)',
          filter:`drop-shadow(0 0 3px ${glow})`, animation:`ytGlint ${g.dur.toFixed(2)}s ease-in-out ${g.delay.toFixed(2)}s infinite` }} />
      ))}
      {/* 葉からしたたる光 */}
      {!bad && DRIPS.map((d, i) => (
        <div key={`d${i}`} className="yt-anim" style={{ position:'absolute', left:`${d.x}%`, top:`${d.y}%`, width:2, height:2, borderRadius:'50%', pointerEvents:'none', opacity:0,
          background: mote, boxShadow:`0 0 6px ${glow}`, animation:`ytDrip ${d.dur.toFixed(2)}s ease-in ${d.delay.toFixed(2)}s infinite` }} />
      ))}
      {/* 根元から昇る光の粒 */}
      {MOTES.slice(0, moteN).map((m, i) => (
        <div key={`m${i}`} className="yt-anim" style={{ position:'absolute', left:`${m.x}%`, bottom:`${m.y}%`, width:m.s, height:m.s, borderRadius:'50%', pointerEvents:'none', opacity:0,
          background: mote, boxShadow:`0 0 ${Math.round(m.s * 3)}px ${bad ? '#8a6ab8' : glow}`, '--dx':`${m.dx}px`, '--rise':`${m.rise}px`,
          animation:`ytMote ${m.dur.toFixed(2)}s ease-out ${m.delay.toFixed(2)}s infinite` }} />
      ))}
      {/* 上下を暗くして、下の名前を読めるように */}
      <div style={{ position:'absolute', inset:0, pointerEvents:'none',
        background:'linear-gradient(180deg, rgba(2,10,16,0.35) 0%, transparent 16%, transparent 52%, rgba(2,10,16,0.72) 82%, #020a10 100%)' }} />
      <div style={{ position:'absolute', left:0, right:0, bottom:'10px', textAlign:'center', pointerEvents:'none' }}>
        <div style={{ fontFamily: MINCHO, fontWeight:'bold', fontSize:'clamp(20px, 5.4vw, 30px)', letterSpacing:'0.3em', paddingLeft:'0.3em', color:'#fff4d6',
          textShadow:'0 0 3px #000, 0 0 12px #000, 0 0 20px #f5c84288, 0 2px 0 #000' }}>ユグレシアの宝樹</div>
        <Ornament color="#e9d39a" />
      </div>
    </div>
  )
}

// ── ◆ ── の飾り（記号の字は環境で豆腐になることがあるので、ひし形は四角を回して描く）
function Ornament({ color, width = 64 }) {
  return (
    <div aria-hidden="true" style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', marginTop:'4px' }}>
      <span style={{ width, height:1, background:`linear-gradient(90deg, transparent, ${color})` }} />
      <span style={{ width:5, height:5, background: color, transform:'rotate(45deg)', boxShadow:`0 0 6px ${color}` }} />
      <span style={{ width, height:1, background:`linear-gradient(90deg, ${color}, transparent)` }} />
    </div>
  )
}

// 【確定】2026-10-13 ユーザー指示「開発中祈りは何回でもできるようにして」：管理者（unlimited）は何回でも祈れる（サーバーも is_admin なら日付を見ない）
export default function V2capTree({ prof, onProfile, unlimited = false }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // 祈った直後の結果
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { const img = new Image(); img.src = ORACLE_FRAME }, [])   // 祈ったあとの札を先に読み込む

  const at = new Date(now)
  const ready = unlimited || canPray(prof.last_pray_at, at)
  const remain = remainUntilPray(prof.last_pray_at, at)
  // 今日の運勢＝祈った直後の結果 → なければ今日もう祈っていればその運勢（日付の区切りは日本時間の5時）
  const todayFortune = prof.last_pray_at && prof.last_fortune && prayDayOf(prof.last_pray_at) === prayDayOf(at) ? prof.last_fortune : null
  const shown = FORTUNE_BY_NAME[result?.fortune || todayFortune] || null
  const bad = !!shown && revelationStyleOf(shown.name).level < 0
  const log = prof.pray_log || []          // 新しい順に最大10件（サーバーが積む）

  // 【確定】2026-10-13 ユーザー指示「ユグレシアの祈りにも演出加えてほしい」→ 同じ日に「木に『祈る』って感じだから神から天啓をもらう感じの演出に」
  //   祈ると すぐ 天啓の演出（V2capRevelationFx.jsx）が始まり、結果が届くまで光の粒が宝樹へ昇る。閉じたあと「演出をもう一度見る」
  const [fx, setFx] = useState(null)   // { key, result }
  const pray = async () => {
    if (!ready || busy) return
    setBusy(true); setError(''); setResult(null)
    const key = Date.now()
    setFx({ key, result: null })
    const { data, error: err } = await supabase.rpc('v2cap_pray')
    if (err || !data?.ok) { setBusy(false); setFx(null); setError(err?.message || data?.error || '祈れませんでした'); return }
    setFx(f => (f && f.key === key ? { ...f, result: data } : f))
    setResult(data)
    await onProfile(null)   // last_pray_at / last_fortune / pray_log / LV を取り直す
    setBusy(false)
  }

  const canPress = ready && !busy
  return (
    <div style={{ maxWidth:'760px', margin:'0 auto 8px', border:'1px solid #1f5a44', background:'linear-gradient(180deg, #020a10 0%, #03120e 100%)',
      fontFamily:'monospace', overflow:'hidden', boxShadow:'0 0 24px #0a3a2a55' }}>
      <style>{KF}</style>
      {fx && <V2capRevelationFx key={fx.key} result={fx.result} onClose={() => setFx(null)} />}

      <TreeStage fortune={shown?.name || null} />

      <div style={{ padding:'10px 12px 14px' }}>
        {/* 説明（【確定】2026-10-14 ユーザーの文・改行もユーザーのとおり。「天啓で（大凶〜大吉）で」の「で」の重なりはユーザーの選んだ形に直した） */}
        <div style={{ textAlign:'center', color:'#b9cbd6', fontSize:'11px', lineHeight:'1.9' }}>
          1日1回だけ祈れます。
          <br />宝樹の返す天啓（大凶〜大吉）で、もらえる経験値が変わります。
          <br />毎日祈ることで信仰心が上がっていきます。
          <br />（AM 5：00更新）
          {unlimited && <div style={{ color:'#ff88cc', fontSize:'10px', marginTop:'2px' }}>🧪 開発中：管理者は何回でも祈れます</div>}
        </div>

        {/* 今日の天啓（ユーザーの石板の絵） */}
        {shown && (
          <div key={`${prof.pray_count ?? 0}-${shown.name}`} style={{ marginTop:'12px', textAlign:'center', animation:'ytIn 0.5s ease-out both' }}>
            <div style={{ position:'relative', maxWidth:'520px', margin:'0 auto', aspectRatio: FRAME_RATIO, boxSizing:'border-box', padding: FRAME_PAD,
              containerType:'inline-size', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
              <div aria-hidden="true" style={{ position:'absolute', inset:0, backgroundImage:`url(${ORACLE_FRAME})`, backgroundSize:'100% 100%',
                filter: bad ? `brightness(0.8) saturate(0.6) drop-shadow(0 0 10px ${shown.color}44)` : `drop-shadow(0 0 12px ${shown.color}55)` }} />
              <div style={{ position:'relative', fontFamily: MINCHO, fontSize:'max(10px, 2.3cqw)', letterSpacing:'0.45em', paddingLeft:'0.45em', color:'#ecd9a0',
                textShadow:'0 0 3px #000, 0 1px 0 #000' }}>─ 今日の天啓 ─</div>
              <div style={{ position:'relative', fontFamily: MINCHO, fontWeight:'bold', fontSize:'clamp(30px, 10.5cqw, 54px)', letterSpacing:'0.25em', paddingLeft:'0.25em',
                lineHeight:1.2, color: shown.color,
                textShadow: bad ? `0 0 3px #000, 0 0 12px ${shown.color}66, 0 2px 0 #000` : `0 0 3px #000, 0 0 10px ${shown.color}, 0 0 24px ${shown.color}88, 0 2px 0 #000` }}>{shown.name}</div>
              <div style={{ position:'relative', fontFamily: MINCHO, fontSize:'clamp(10.5px, 3cqw, 15px)', lineHeight:'1.7', color: bad ? '#d2c4e2' : '#f3ead2',
                textShadow:'0 0 4px #000, 0 1px 0 #000' }}>「{shown.text}」</div>
              {/* 経験値はサーバーが決めて返す（画面では計算しない）。祈った直後だけ出す */}
              {result && (
                <div style={{ position:'relative', marginTop:'1.6cqw', padding:'0.3em 1.1em', border:'1px solid #ffcc0077', background:'rgba(0,0,0,0.45)',
                  color:'#ffcc00', fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'clamp(12px, 3.2cqw, 16px)', textShadow:'0 0 8px #ffb30066' }}>
                  EXP +{gainedExpOf(result).toLocaleString()}
                </div>
              )}
            </div>
            {/* 石板の下：LEVEL UP など・演出をもう一度 */}
            {result && (<>
              {result.level?.level_ups > 0 && (
                <div style={{ color:'#44ff88', fontSize:'11px', marginTop:'6px' }}>
                  🆙 LEVEL UP！ LV{result.level.lv}{typeof result.level.points === 'number' ? `（ステータスポイント+${result.level.points}）` : ''}
                </div>
              )}
              {/* 上がったクラスのステも書く（2026-10-12 ユーザー指示・出撃のログと同じ） */}
              {result.level?.job_ups > 0 && (
                <div style={{ color:'#ffcc00', fontSize:'11px', marginTop:'4px' }}>
                  <div>{jobUpHead(prof.class, result.level)}</div>
                  <div>{jobUpNote(prof.class, result.level)}</div>
                </div>
              )}
              {(result.level?.learned || []).map(n => <div key={n} style={{ color:'#44ddff', fontSize:'11px', marginTop:'4px' }}>📖 スキル「{n}」を覚えた！{(result.level?.set_added || []).includes(n) ? '（スキルセットの空き枠に入れた）' : ''}</div>)}
              <div>
                <button onClick={() => setFx({ key: Date.now(), result })} disabled={!!fx}
                  style={{ marginTop:'10px', padding:'4px 12px', background:'transparent', border:'1px solid #4f6f86', color:'#9fb8cc',
                    cursor:'pointer', fontFamily:'monospace', fontSize:'10px' }}>▶ 演出をもう一度見る</button>
              </div>
            </>)}
          </div>
        )}

        {error && <div style={{ color:'#ff6666', fontSize:'11px', marginTop:'10px' }}>⚠ {error}</div>}

        {/* 祈る */}
        <button onClick={pray} disabled={!canPress} className={canPress ? 'yt-anim' : undefined} aria-label={busy ? '祈っています' : ready ? '祈る' : undefined}
          style={{ position:'relative', overflow:'hidden', display:'block', width:'100%', marginTop:'12px', padding: ready ? '14px' : '9px 14px',
            background: ready ? 'linear-gradient(180deg, #0f4532 0%, #06261b 55%, #03140e 100%)' : '#030c12',
            border:`1px solid ${ready ? '#6fe0a8' : '#1d3346'}`, color: ready ? '#eafff3' : '#7f95a6',
            cursor: canPress ? 'pointer' : 'not-allowed', fontFamily: MINCHO, fontWeight:'bold', fontSize:'18px', letterSpacing:'0.4em',
            textShadow: ready ? '0 0 8px #44dd99' : 'none', animation: canPress ? 'ytPulse 2.6s ease-in-out infinite' : 'none' }}>
          {canPress && (
            <span aria-hidden="true" className="yt-anim" style={{ position:'absolute', top:0, bottom:0, left:0, width:'28%', pointerEvents:'none',
              background:'linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)', animation:'ytSheen 3.8s ease-in-out infinite' }} />
          )}
          {ready || busy ? (
            <span style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center', gap:'10px' }}>
              <img src={PRAY_ICON} alt="" width={34} height={34} style={{ display:'block', filter:'drop-shadow(0 0 6px #ffd75e99)' }} />
              {busy ? '祈っています...' : '祈る'}
            </span>
          ) : (
            <>
              <span style={{ display:'block', fontFamily:'monospace', fontWeight:'normal', fontSize:'10px', letterSpacing:'0.1em', color: TEXT.label }}>次に祈れるまで</span>
              <span style={{ display:'block', fontFamily:'monospace', fontSize:'22px', letterSpacing:'0.12em', color:'#a8d8c0', marginTop:'2px' }}>
                {pad(remain.h)}:{pad(remain.m)}:{pad(remain.s)}
              </span>
            </>
          )}
        </button>

        {/* これまでの結果（直近10回・新しい順） */}
        {log.length > 0 && (
          <div style={{ marginTop:'14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', color: TEXT.label, fontSize:'10px', marginBottom:'6px' }}>
              <span style={{ flex:1, height:1, background:'linear-gradient(90deg, transparent, #2f6f58)' }} />
              これまでの結果（直近{log.length}回）
              <span style={{ flex:1, height:1, background:'linear-gradient(90deg, #2f6f58, transparent)' }} />
            </div>
            {/* 1列に並べて真ん中へ（狭い画面では札が縮む） */}
            <div style={{ display:'grid', gridTemplateColumns:`repeat(${log.length}, minmax(0, 46px))`, justifyContent:'center', gap:'4px' }}>
              {log.map((e, i) => {
                const c = FORTUNE_BY_NAME[e.fortune]?.color || '#7f95c4'
                const [day, time] = String(e.at || '').split(' ')
                return (
                  <div key={i} title={`${e.at}　${e.fortune}`} style={{ border:`1px solid ${c}55`, background:`${c}12`, padding:'4px 0 3px', textAlign:'center' }}>
                    <div style={{ fontFamily: MINCHO, fontWeight:'bold', fontSize:'clamp(10px, 2.9vw, 13px)', lineHeight:1.3, whiteSpace:'nowrap', color: c }}>{e.fortune}</div>
                    <div style={{ fontSize:'8px', lineHeight:1.3, whiteSpace:'nowrap', color: TEXT.label }}>{day}</div>
                    {time && <div style={{ fontSize:'8px', lineHeight:1.2, whiteSpace:'nowrap', color: TEXT.empty }}>{time}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
