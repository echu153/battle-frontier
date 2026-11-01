import { useEffect, useState } from 'react'
import V2capItemLoadout from './V2capItemLoadout.jsx'
import { JP_BOLD } from './casinoStyle.js'
import { miniBtn, TEXT } from './v2ui.js'
import { bossEncounterOf, bossThumbOf } from '../lib/bossArt.js'
import { bossBgOf } from '../lib/bossBg.js'
import { CIRCLED, DIFF_COLOR, DIFF_KEYS, DUNGEON_BOSSES, diffOf, firstDiffOf, isDiffReady, isDiffUnlocked } from '../lib/dungeon.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦するボスを選んだときのポップアップ（遭遇のイラスト・難易度・持ち込む薬）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「挑戦するキャラを選択したらそこでポップアップが出て難易度選択して挑戦するようにして」「そこでイラストばっと出るようにして、持っていくアイテムも表示されるように」：
//   開いた瞬間に、遭遇のイラストが手前へ叩きつけられる（大きく→行きすぎて→止まる）。叩きつけた瞬間に絵の窓が白く光り・ポップアップが揺れ・輪と集中線が走る。そのあとはゆっくり近づく。
//   イラストは窓より大きく出てから収まる＝いちばん外は overflow:hidden（スクロールバーを出さない）。下の欄が画面に入らないときは、下の欄だけスクロールする（後ろの画面は動かさない＝touchAction）
//   難易度は押して選ぶ（挑戦できない難易度も押せる＝わけが読める）。はじめに選んでおくのは挑戦できるいちばん低い難易度（ボスごとに1日1回なので、うっかり難しいほうで始めない）。
//   run＝もう入っているボス（難易度は決まっている・HPは持ち越し）。薬は選び直せる
//   ⚠背景を押しても閉じない（V2Modal と同じ）。Esc と「やめる」で閉じる。「やめる」はその場のまま（画面の上へ戻さない）
//   ★CSS の動きだけ（transform と opacity）＝スマホでも軽い。大きな絵が届く前は一覧の小さい絵を出す（どちらも同じ切り抜き）
//   ★日本語の大きな文字は JP_BOLD＋bold（切り抜きのグラデーションにしない）
// ============================================================

export const PICK_OUT_MS = 240   // 「挑戦する」を押したあと、戦闘の画面の上で消える長さ

const KF = `
@keyframes bpBack { from { opacity: 0 } to { opacity: 1 } }
@keyframes bpOut { from { opacity: 1 } to { opacity: 0 } }
@keyframes bpSlam { 0% { opacity: 0; transform: scale(1.7) } 18% { opacity: 1 } 42% { transform: scale(0.97) } 62% { transform: scale(1.015) } 100% { opacity: 1; transform: scale(1) } }
@keyframes bpDrift { from { transform: scale(1) } to { transform: scale(1.04) } }
@keyframes bpShake { 0%, 100% { transform: translate(0, 0) } 14% { transform: translate(-9px, 7px) } 30% { transform: translate(8px, -6px) } 46% { transform: translate(-6px, -3px) } 62% { transform: translate(4px, 3px) } 80% { transform: translate(-2px, 2px) } }
@keyframes bpFlash { from { opacity: 0.9 } to { opacity: 0 } }
@keyframes bpRing { from { opacity: 0.85; transform: translate(-50%, -50%) scale(0.2) } to { opacity: 0; transform: translate(-50%, -50%) scale(1.5) } }
@keyframes bpLines { from { opacity: 0.8; transform: scale(1.2) } to { opacity: 0; transform: scale(1) } }
@keyframes bpUp { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
`
const HIT = '0.13s'   // 叩きつける瞬間（bpSlam の42%あたり）
const ACCENT = { varuzenoku: '#ff7a3a', amaza: '#7ad0ff', zerugiasu: '#8ab4ff', enma: '#b98aff' }
const ART_H = 'min(46vh, 92vw, 440px)'
const IMAGE = { position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain' }

// block … 新しく挑戦できないわけ（summonBlockOf）・cost … 使うスタミナ・stam … いまのスタミナ・out … 消えている途中
// prof / onProfile / onGo / saveRef … 持ち込む薬の欄（V2capItemLoadout.jsx）・onStart(diff) … 「挑戦する」・onClose … 「やめる」
export default function V2capBossPick({ bossKey, run = null, reached, myPower, block = null, cost = 0, stam = 0, busy = false, out = false, prof, onProfile, onGo, saveRef, onStart, onClose }) {
  const [big, setBig] = useState(false)
  const [diff, setDiff] = useState(() => run?.diff || firstDiffOf(bossKey, reached))
  // Esc で閉じる（「やめる」と同じ）
  useEffect(() => {
    if (out) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [out, onClose])

  const boss = DUNGEON_BOSSES[bossKey], d = diffOf(bossKey, diff)
  const src = bossEncounterOf(bossKey), thumb = bossThumbOf(bossKey), bg = bossBgOf(bossKey)
  const accent = ACCENT[bossKey] || '#ffd27a'
  const ready = isDiffReady(bossKey, diff)
  const unlocked = isDiffUnlocked(bossKey, diff, reached)
  const short = stam < cost
  const canGo = !busy && !short && (run ? true : unlocked && !block)
  const color = DIFF_COLOR[diff]
  return (
    <div role="dialog" aria-modal="true" aria-label={`${boss.name}に挑戦する`} style={{ position:'fixed', inset:0, zIndex: 1000, overflow:'hidden', background:'rgba(0,4,16,0.82)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:'10px', boxSizing:'border-box', touchAction:'none', pointerEvents: out ? 'none' : undefined,
      animation: out ? `bpOut ${PICK_OUT_MS}ms ease-out forwards` : 'bpBack 0.12s ease-out both' }}>
      <style>{KF}</style>
      <div style={{ width:'min(440px, 100%)', maxHeight:'100%', display:'flex', flexDirection:'column', border:`1px solid ${accent}`, background:'#001040', fontFamily:'monospace',
        boxShadow:`0 0 24px ${accent}66`, animation:`bpShake 0.46s linear ${HIT} both` }}>
        {/* 遭遇のイラスト：叩きつける→ゆっくり近づく。下にボスの名前 */}
        <div style={{ position:'relative', zIndex: 1, flexShrink: 0, height: ART_H, pointerEvents:'none' }}>
          <div aria-hidden style={{ position:'absolute', inset:0, overflow:'hidden', background: bg?.under || '#000' }}>
            {bg && <div style={{ position:'absolute', inset:0, background:`url("${bg.src}") center / cover no-repeat`, opacity: 0.5 }} />}
            <div style={{ position:'absolute', inset:0, background:'radial-gradient(circle at 50% 44%, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.72) 72%)' }} />
            <div style={{ position:'absolute', inset:'-20%', opacity: 0, background:'repeating-conic-gradient(from 0deg at 50% 46%, rgba(255,255,255,0.24) 0deg 1.3deg, transparent 1.3deg 7.5deg)',
              WebkitMaskImage:'radial-gradient(circle at 50% 46%, transparent 24%, #000 58%)', maskImage:'radial-gradient(circle at 50% 46%, transparent 24%, #000 58%)',
              animation:`bpLines 0.5s ease-out ${HIT} forwards` }} />
          </div>
          <div aria-hidden style={{ position:'absolute', left:'50%', top:'46%', width:'min(120vw, 120vh)', height:'min(120vw, 120vh)', borderRadius:'50%', border:`6px solid ${accent}`, opacity: 0,
            animation:`bpRing 0.55s ease-out ${HIT} forwards` }} />
          <div style={{ position:'absolute', inset:0, animation:'bpSlam 0.34s cubic-bezier(0.2, 0.8, 0.3, 1) both', willChange:'transform' }}>
            <div style={{ position:'absolute', inset:0, animation:'bpDrift 6s linear 0.34s forwards' }}>
              {thumb && !big && <img src={thumb} alt="" draggable={false} style={IMAGE} />}
              {src && <img src={src} alt="" draggable={false} onLoad={() => setBig(true)} style={{ ...IMAGE, opacity: big ? 1 : 0 }} />}
            </div>
          </div>
          <div style={{ position:'absolute', left:0, right:0, bottom:0, padding:'22px 8px 4px', textAlign:'center', background:'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.78) 62%)' }}>
            <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'clamp(20px, 6.2vw, 30px)', lineHeight: 1.25, letterSpacing:'0.08em', paddingLeft:'0.08em', color:'#ffffff', whiteSpace:'nowrap',
              textShadow:`0 0 3px #000, 0 0 16px ${accent}, 0 2px 0 #000` }}>{boss.name}</div>
          </div>
          <div aria-hidden style={{ position:'absolute', inset:0, background:'#ffffff', opacity: 0, animation:`bpFlash 0.32s ease-out ${HIT} forwards` }} />
        </div>

        {/* 難易度と持ち込む薬（画面に入らないときは、ここだけスクロール） */}
        <div style={{ flex:'1 1 auto', minHeight: 0, overflowY:'auto', touchAction:'pan-y', overscrollBehavior:'contain', padding:'8px 10px 0', borderTop:`1px solid ${accent}66`, animation:'bpUp 0.22s ease-out 0.16s both' }}>
          {run ? (
            <div style={{ fontSize:'11px', color: TEXT.sub, marginBottom:'8px' }}>
              <b style={{ color, fontSize:'12px' }}>［{d?.label}］</b> 残りHP {run.hp.toLocaleString()} / {run.hp_max.toLocaleString()}（{((run.hp / run.hp_max) * 100).toFixed(1)}%）
              {!run.mine && <span>・{run.owner}さんの救援</span>}
            </div>
          ) : (
            <div style={{ marginBottom:'8px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'4px' }}>
                {DIFF_KEYS.map(k => {
                  const on = k === diff, c = DIFF_COLOR[k]
                  return (
                    <button key={k} type="button" onClick={() => setDiff(k)} aria-pressed={on}
                      style={{ ...miniBtn(c), padding:'8px 0', fontSize:'min(12px, 3.1vw)', fontWeight: on ? 'bold' : 'normal', whiteSpace:'nowrap', background: on ? `${c}33` : '#000818',
                        boxShadow: on ? `inset 0 0 0 1px ${c}` : undefined, opacity: isDiffUnlocked(bossKey, k, reached) ? 1 : 0.5 }}>{diffOf(bossKey, k).label}</button>
                  )
                })}
              </div>
              <div style={{ fontSize:'11px', color: TEXT.sub, marginTop:'5px' }}>
                推奨LV{d.recLv}
                {ready && <>・推奨戦闘力 <span style={{ color: myPower >= d.recPower ? '#88ffaa' : '#ff8888' }}>{d.recPower.toLocaleString()}</span></>}
                {!ready ? '・準備中' : !unlocked ? `・エリア${CIRCLED[d.area - 1]}に着くと挑戦できます` : ''}
              </div>
            </div>
          )}
          {/* 戦闘に持ち込む薬（合計4つまで） */}
          <V2capItemLoadout prof={prof} onProfile={onProfile} onGo={onGo} saveRef={saveRef} />
        </div>

        <div style={{ flexShrink: 0, padding:'0 10px 10px', animation:'bpUp 0.22s ease-out 0.16s both' }}>
          {!run && unlocked && block && <div style={{ color:'#ff8888', fontSize:'11px', marginBottom:'6px' }}>{block}</div>}
          {short && <div style={{ color:'#ff8888', fontSize:'11px', marginBottom:'6px' }}>スタミナが足りません</div>}
          <div style={{ display:'flex', gap:'8px' }}>
            <button type="button" onClick={onClose} style={{ ...miniBtn('#88aaff'), flex: 1, padding:'11px 0', fontSize:'12px' }}>やめる</button>
            <button type="button" onClick={() => onStart(diff)} disabled={!canGo}
              style={{ ...miniBtn(color), flex: 2, padding:'11px 0', fontSize:'14px', fontWeight:'bold', whiteSpace:'nowrap', opacity: canGo ? 1 : 0.35 }}>⚔ 挑戦する{cost > 0 ? `（スタミナ${cost}）` : ''}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
