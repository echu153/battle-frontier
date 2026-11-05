import { useEffect, useState } from 'react'
import V2capItemLoadout from './V2capItemLoadout.jsx'
import { JP_BOLD } from './casinoStyle.js'
import { miniBtn, TEXT } from './v2ui.js'
import { bossAccentOf, bossEncounterOf, bossThumbOf } from '../lib/bossArt.js'
import { bossBgOf } from '../lib/bossBg.js'
import { CIRCLED, DIFF_COLOR, DIFF_KEYS, DUNGEON_BOSSES, diffOf, firstDiffOf, isDiffReady, isDiffUnlocked } from '../lib/dungeon.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— 挑戦するボスを選んだときのポップアップ（遭遇のイラスト・難易度・持ち込む薬）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「挑戦するキャラを選択したらそこでポップアップが出て難易度選択して挑戦するようにして」「持っていくアイテムも表示されるように」：
//   難易度は押して選ぶ（挑戦できない難易度も押せる＝わけが読める）。はじめに選んでおくのは挑戦できるいちばん低い難易度（ボスごとに1日1回なので、うっかり難しいほうで始めない）。
//   run＝もう入っているボス（難易度は決まっている・HPは持ち越し）。薬は選び直せる
//   下の欄が画面に入らないときは、下の欄だけスクロールする（後ろの画面は動かさない＝touchAction）
//   ⚠背景を押しても閉じない（V2Modal と同じ）。Esc と「やめる」で閉じる。「やめる」はその場のまま（画面の上へ戻さない）
// 【確定】同じ日 ユーザー「難易度選択のポップアップはただイラスト表示させるだけでいい、挑戦する押した後いつも通りの遭遇の演出はいるようにして」：
//   ここのイラストは出すだけ（動きを付けない）。どん！と出すのは「挑戦する」のあとの全画面（V2capBossEncounter.jsx）
//   大きな絵が届く前は一覧の小さい絵を出す（どちらも同じ切り抜き）
// 【確定】2026-11-05 ユーザー「あと敵のHPの数値は見れないようにして」：入っているボスの残りHPはバーだけ（数字も割合も出さない）
//   ★日本語の大きな文字は JP_BOLD＋bold（切り抜きのグラデーションにしない）
// ============================================================

const ART_H = 'min(46vh, 92vw, 440px)'
const IMAGE = { position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'contain' }

// block … 新しく挑戦できないわけ（summonBlockOf）・cost … 使うスタミナ・stam … いまのスタミナ
// prof / onProfile / onGo / saveRef … 持ち込む薬の欄（V2capItemLoadout.jsx）・onStart(diff) … 「挑戦する」・onClose … 「やめる」
export default function V2capBossPick({ bossKey, run = null, reached, myPower, block = null, cost = 0, stam = 0, busy = false, prof, onProfile, onGo, saveRef, onStart, onClose }) {
  const [big, setBig] = useState(false)
  const [diff, setDiff] = useState(() => run?.diff || firstDiffOf(bossKey, reached))
  // Esc で閉じる（「やめる」と同じ）
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const boss = DUNGEON_BOSSES[bossKey], d = diffOf(bossKey, diff)
  const src = bossEncounterOf(bossKey), thumb = bossThumbOf(bossKey), bg = bossBgOf(bossKey)
  const accent = bossAccentOf(bossKey)
  const ready = isDiffReady(bossKey, diff)
  const unlocked = isDiffUnlocked(bossKey, diff, reached)
  const short = stam < cost
  const canGo = !busy && !short && (run ? true : unlocked && !block)
  const color = DIFF_COLOR[diff]
  return (
    <div role="dialog" aria-modal="true" aria-label={`${boss.name}に挑戦する`} style={{ position:'fixed', inset:0, zIndex: 1000, background:'rgba(0,4,16,0.82)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:'10px', boxSizing:'border-box', touchAction:'none' }}>
      <div style={{ width:'min(440px, 100%)', maxHeight:'100%', display:'flex', flexDirection:'column', border:`1px solid ${accent}`, background:'#001040', fontFamily:'monospace',
        boxShadow:`0 0 24px ${accent}66` }}>
        {/* 遭遇のイラスト。下にボスの名前 */}
        <div style={{ position:'relative', flexShrink: 0, height: ART_H, overflow:'hidden', background: bg?.under || '#000' }}>
          {bg && <div aria-hidden style={{ position:'absolute', inset:0, background:`url("${bg.src}") center / cover no-repeat`, opacity: 0.5 }} />}
          <div aria-hidden style={{ position:'absolute', inset:0, background:'radial-gradient(circle at 50% 44%, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.72) 72%)' }} />
          {thumb && !big && <img src={thumb} alt="" draggable={false} style={IMAGE} />}
          {src && <img src={src} alt="" draggable={false} onLoad={() => setBig(true)} style={{ ...IMAGE, opacity: big ? 1 : 0 }} />}
          <div style={{ position:'absolute', left:0, right:0, bottom:0, padding:'22px 8px 4px', textAlign:'center', background:'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.78) 62%)' }}>
            <div style={{ fontFamily: JP_BOLD, fontWeight:'bold', fontSize:'clamp(20px, 6.2vw, 30px)', lineHeight: 1.25, letterSpacing:'0.08em', paddingLeft:'0.08em', color:'#ffffff', whiteSpace:'nowrap',
              textShadow:`0 0 3px #000, 0 0 16px ${accent}, 0 2px 0 #000` }}>{boss.name}</div>
          </div>
        </div>

        {/* 難易度と持ち込む薬（画面に入らないときは、ここだけスクロール） */}
        <div style={{ flex:'1 1 auto', minHeight: 0, overflowY:'auto', touchAction:'pan-y', overscrollBehavior:'contain', padding:'8px 10px 0', borderTop:`1px solid ${accent}66` }}>
          {run ? (
            <div style={{ fontSize:'11px', color: TEXT.sub, marginBottom:'8px' }}>
              <b style={{ color, fontSize:'12px' }}>［{d?.label}］</b>
              {!run.mine && <span> {run.owner}さんの救援</span>}
              {/* 残りHPはバーだけ（数字を出さない） */}
              <div style={{ display:'flex', alignItems:'center', gap:'6px', marginTop:'4px', fontSize:'10px', color: TEXT.label }}>
                <span style={{ flexShrink: 0 }}>残りHP</span>
                <div style={{ flex: 1, height:'8px', background:'#000818', border:'1px solid #13405f' }}>
                  <div style={{ width:`${Math.max(0, Math.min(100, (run.hp / run.hp_max) * 100))}%`, height:'100%', background:'#cc3344' }} />
                </div>
              </div>
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

        <div style={{ flexShrink: 0, padding:'0 10px 10px' }}>
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
