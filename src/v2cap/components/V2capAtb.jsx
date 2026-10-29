import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import V2capAtbMacros from './V2capAtbMacros.jsx'
import V2capAtbFight from './V2capAtbFight.jsx'
import { box, miniBtn, TEXT } from './v2ui.js'
import { createAtb, MAX_SEC } from '../core/atb.js'
import { macrosOf, validateMacros } from '../lib/atbMacro.js'
import { loadPref, savePref } from '../core/prefs.js'
import { motionOf } from '../lib/motionArt.js'
import { homeIconOf } from '../lib/classArt.js'
import { artGenderOf } from '../lib/gender.js'
import { BOSS_DEFS, bossArtOf } from '../lib/bossArt.js'
import { dungeonFighter, diffOf, isDiffReady, DIFF_KEYS } from '../lib/dungeon.js'
import { bossIllustOf } from '../lib/bossIllust.js'
import { AREA_LIST, SPOTS, SUB_NAMES, toFighter as enemyFighter, enemyPowerOf } from '../lib/areas.js'
import { CLASS_BY_ID } from '../lib/jobs.js'
import { atbPlayerOf } from '../lib/atbPlayer.js'

// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の試し撃ち［開発］
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「ATBのエンジンと試し撃ち画面（開発専用・報酬なし）を作って。細かい数字は試しながら決める」
//   ・レイドボス・IDダンジョンに載せる前の、手触りと数字を見るための場所。**報酬なし・サーバーへ何も送らない**
//   ・相手はエリアの敵（ボス・ふつう・朝昼晩・レア）。HPの倍率で長い戦い（レイドのボスの代わり）も見られる
//   ・自分は持っている技を全部使える（ATBの決まり）。技を押すと割り込みの列の後ろに入り、ゲージが満タンになると先頭から出る
//   ・自分が左・モンスターが右（2026-10-26 ユーザー指示・舞台は V2capAtbStage.jsx・動きは lib/atbFx.js）
//   ・マクロ①〜③（2026-10-26 ユーザー指示）：準備の画面で登録・保存（サーバーに職業ごと）、戦闘中に押すとその順に出る。
//     いま画面に出ている形（保存前でも）で戦う＝試しながら組み替えられる
//   ・ダンジョンのボス（lib/bossArt.js・2026-10-28 黒龍ヴァルゼノク）：ドット絵（待機・技ごとの攻撃）を見るための相手。
//     ★2026-10-29〜 強さと技は IDダンジョンと同じ（lib/dungeon.js・難易度を選べる・HPは持ち越さない）。流す絵は技の名前で選ぶ
//     （bossMotionKeyOf）。戦闘中は「動きを見る」のボタンで、どの技の絵も流せる
//   ・戦闘の画面は V2capAtbFight.jsx（2026-10-29 IDダンジョンと同じ部品にした）
//     ★絵は「イラスト版（lib/bossIllust.js・パーツを動かす）」と「ドット絵版（lib/bossArt.js）」を選べる（はじめはイラスト版・選んだ方を覚える）
//     （2026-10-28 ユーザー「イラスト版も作ったからドット絵版は別バージョンで作っておいて」）
// 中身（進み方）は src/v2cap/core/atb.js。つまみ（秒・倍率）もそちらの冒頭。マクロの決まりは src/v2cap/lib/atbMacro.js
// ============================================================

const HP_MULTS = [1, 10, 50]
const sel = { background:'#000818', color: TEXT.body, border:'1px solid #0044aa', fontFamily:'monospace', fontSize:'12px', padding:'6px' }

export default function V2capAtb({ prof, inventory, onProfile }) {
  const [macros, setMacros] = useState(() => macrosOf(prof))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [macroMsg, setMacroMsg] = useState(null)
  const [area, setArea] = useState(1)
  const [sub, setSub] = useState(1)
  const [foeName, setFoeName] = useState('')
  const [hpMult, setHpMult] = useState(1)
  const [bossDiff, setBossDiff] = useState('normal')   // ダンジョンのボスの難易度（lib/dungeon.js）
  const [phase, setPhase] = useState('setup')   // setup | fight
  const [runKey, setRunKey] = useState(0)        // 新しい戦闘を始めるたびに変える（戦闘の部品がログと動きを空にする）
  const st = useRef(null)

  const spot = SPOTS.find(s => s.area === area && s.sub === sub) || SPOTS[0]
  const foes = useMemo(() => [
    // ダンジョンのボス（絵があるものだけ・イラスト版だけのボスも＝雨摩座）。強さと技はダンジョンの決まり（無ければ仮＝この場所のボスのもの）
    ...Object.entries(BOSS_DEFS).filter(([key]) => bossArtOf(key) || bossIllustOf(key)).map(([key, d]) => ({ ...spot.roster.boss, name: d.name, role:'ダンジョン', bossArt: key })),
    { ...spot.roster.boss, role:'ボス' },
    ...spot.roster.enemies.map(e => ({ ...e, role:'ふつう' })),
    ...spot.roster.timed.map(e => ({ ...e, role:'朝昼晩' })),
    ...spot.roster.rares.map(e => ({ ...e, role:'レア' })),
  ], [spot])
  const foe = foes.find(e => e.name === foeName) || foes[0]

  // 自分：いまの装備・ステのまま、持っている技（下位職のぶんも）を全部持たせる＝ATBの決まり
  const myFighter = useMemo(() => atbPlayerOf(prof, inventory), [prof, inventory])

  // 絵：自分はクラスの待機GIF（ホームのアイコンと同じ・男女はキャラの性別）／相手は図鑑と同じ絵（ドット絵が届いたら差し替える）
  const myGender = artGenderOf(prof, loadPref('capArtGender', 'm'))
  const playerSrc = homeIconOf(prof?.class, myGender, CLASS_BY_ID[prof?.class]?.req?.cls)
  // 攻撃の絵（あるクラスだけ・lib/motionArt.js）。無ければ踏み込み
  const playerMotion = useMemo(() => motionOf(prof?.class, myGender, 'attack', CLASS_BY_ID[prof?.class]?.req?.cls), [prof?.class, myGender])
  // 攻撃の絵は先に読んでおく（はじめて殴った瞬間に絵が間に合わないと、1回目だけ消えて見える）
  useEffect(() => { if (playerMotion) { const im = new Image(); im.src = playerMotion.src } }, [playerMotion])
  // ダンジョンのボスの絵（イラスト版かドット絵版・技ごとの絵とエフェクト）。絵は先に読んでおく
  const bossKey = foe?.bossArt || null
  const [artVer, setArtVer] = useState(() => loadPref('capBossArtVer', 'illust'))
  const pickArtVer = (v) => { setArtVer(v); savePref('capBossArtVer', v) }
  // 両方の版があるボスだけ選べる（雨摩座はイラスト版だけ）
  const hasBoth = useMemo(() => !!(bossKey && bossIllustOf(bossKey) && bossArtOf(bossKey)), [bossKey])
  const bossArt = useMemo(() => (bossKey ? (artVer === 'illust' && bossIllustOf(bossKey)) || bossArtOf(bossKey) || bossIllustOf(bossKey) : null), [bossKey, artVer])
  useEffect(() => {
    if (!bossArt) return
    for (const src of bossArt.srcs) { const im = new Image(); im.src = src }
  }, [bossArt])
  // 絵の版を選ぶボタン（イラスト版とドット絵版の両方があるボスだけ）
  const verPicker = hasBoth && (
    <span style={{ display:'inline-flex', gap:'4px', alignItems:'center' }}>
      <span style={{ color: TEXT.label, fontSize:'10px' }}>絵</span>
      {[['illust', 'イラスト版'], ['pixel', 'ドット絵版']].map(([v, label]) => (
        <button key={v} onClick={() => pickArtVer(v)}
          style={{ ...miniBtn(bossArt?.kind === v ? '#44ddff' : TEXT.label), padding:'4px 8px', fontSize:'11px', background: bossArt?.kind === v ? '#002850' : '#000818' }}>
          {label}
        </button>
      ))}
    </span>
  )

  const start = () => {
    // ダンジョンのボスは IDダンジョンと同じ強さと技（lib/dungeon.js・2026-10-29〜）。HPは持ち越さない（1回で全部）。
    //   ダンジョンの決まりが無いボスは、強さ（戦闘力）をこの場所のボスのものにする（名前が場所の顔ぶれに無いので、渡さないと1になる）
    const dun = foe.bossArt ? dungeonFighter(foe.bossArt, bossDiff) : null
    const base = dun || { ...enemyFighter(foe, 8, foe.bossArt ? enemyPowerOf(spot.roster.boss) : undefined), boss: foe.role === 'ボス' || !!foe.bossArt }
    const enemy = hpMult === 1 ? base : { ...base, stats: { ...base.stats, hp: base.stats.hp * hpMult } }
    st.current = createAtb(myFighter, enemy, { maxSec: MAX_SEC })
    setRunKey(k => k + 1)
    setPhase('fight')
  }

  // ===== マクロ =====
  const usable = useMemo(() => myFighter.slots.map(s => s.skill.name), [myFighter])
  const editMacros = (next) => { setMacros(next); setDirty(true); setMacroMsg(null) }
  const saveMacros = async () => {
    const err = validateMacros(macros, usable)
    if (err) { setMacroMsg({ ok: false, text: err }); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('v2cap_set_atb_macros', { p_macros: macros })
    setSaving(false)
    if (error || !data?.ok) {
      // サーバーに保存の関数がまだ無い（SQL §19 を流す前）ときは、英語のまま出さずに案内する
      const missing = /could not find the function/i.test(error?.message || '')
      setMacroMsg({ ok: false, text: missing ? 'サーバーにまだ保存の仕組みがありません（SQLを流すと保存できます）' : (error?.message || data?.error || '保存できませんでした') })
      return
    }
    setDirty(false)
    setMacroMsg({ ok: true, text: `${prof?.class}のマクロを保存しました` })
    onProfile?.()
  }
  // ===== 準備 =====
  if (phase !== 'fight' || !st.current) {
    return (
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color: TEXT.sub, fontSize:'11px', lineHeight:1.7, marginBottom:'10px' }}>
          レイドボス・IDダンジョンで使うATB戦闘の試し撃ちです。<b style={{ color: TEXT.bright }}>報酬なし・戦闘の結果はサーバーへ送りません</b>（送るのはマクロの保存だけ）。<br />
          ゲージはふだん5秒で満タン。AGIが相手を上回るほど速くなります（相手の4倍で2倍速まで）。技は全部使えて、使うとクールダウンに入ります（MPは回復しません）。
        </div>
        <V2capAtbMacros macros={macros} onChange={editMacros} usable={usable} dirty={dirty} saving={saving} msg={macroMsg} onSave={saveMacros} />
        <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px' }}>
          <select value={area} onChange={e => { setArea(Number(e.target.value)); setFoeName('') }} style={sel}>
            {AREA_LIST.map((a, i) => <option key={a.name} value={i + 1}>{i + 1}. {a.name}</option>)}
          </select>
          <select value={sub} onChange={e => { setSub(Number(e.target.value)); setFoeName('') }} style={sel}>
            {[1, 2, 3].map(n => <option key={n} value={n}>{SUB_NAMES[n - 1]} {SPOTS.find(s => s.area === area && s.sub === n)?.name}</option>)}
          </select>
          <select value={foe?.name || ''} onChange={e => setFoeName(e.target.value)} style={sel}>
            {foes.map(e => <option key={`${e.role}${e.name}`} value={e.name}>［{e.role}］{e.name}</option>)}
          </select>
        </div>
        {bossArt && (() => {
          const diffs = DIFF_KEYS.filter(k => isDiffReady(bossArt.key, k))
          return (
            <div style={{ display:'flex', gap:'10px', alignItems:'center', border:'1px solid #5a1a1a', background:'#140608', padding:'8px', marginBottom:'8px' }}>
              {bossArt.illust && <img src={bossArt.illust} alt="" draggable={false} style={{ width:'96px', height:'96px', objectFit:'contain', flexShrink:0 }} />}
              <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7, minWidth:0 }}>
                <b style={{ color:'#ff8866' }}>{bossArt.name}</b>（IDダンジョンのボス）<br />
                {diffs.length > 0
                  ? '強さと技はIDダンジョンと同じです（HPは持ち越さず、1回で全部）。'
                  : '技の動きはできましたが、数字はまだです。強さと技は仮で、この場所のボスのものです（構えた大技は最後の技の動き）。'}
                戦闘中の「動きを見る」で技の動きをどれでも流せます
                {diffs.length > 0 && (
                  <div style={{ display:'flex', gap:'4px', alignItems:'center', marginTop:'4px', flexWrap:'wrap' }}>
                    <span style={{ color: TEXT.label }}>難易度</span>
                    {diffs.map(k => (
                      <button key={k} onClick={() => setBossDiff(k)}
                        style={{ ...miniBtn(bossDiff === k ? '#ffaa44' : TEXT.label), padding:'4px 8px', fontSize:'11px', background: bossDiff === k ? '#3a1a00' : '#000818' }}>
                        {diffOf(bossArt.key, k).label}（推奨戦闘力{diffOf(bossArt.key, k).recPower}）
                      </button>
                    ))}
                  </div>
                )}
                {verPicker && <div style={{ marginTop:'4px' }}>{verPicker}</div>}
              </div>
            </div>
          )
        })()}
        <div style={{ display:'flex', gap:'4px', alignItems:'center', marginBottom:'10px', flexWrap:'wrap' }}>
          <span style={{ color: TEXT.label, fontSize:'11px' }}>相手のHP</span>
          {HP_MULTS.map(m => (
            <button key={m} onClick={() => setHpMult(m)}
              style={{ ...miniBtn(hpMult === m ? '#44ddff' : TEXT.label), padding:'5px 9px', fontSize:'11px', background: hpMult === m ? '#002850' : '#000818' }}>
              ×{m}
            </button>
          ))}
          <span style={{ color: TEXT.sub, fontSize:'10px' }}>（大きくするとレイドのボスのような長い戦いになります）</span>
        </div>
        <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.7, marginBottom:'10px' }}>
          自分は今の装備・ステータスのまま、覚えている技を{myFighter.slots.length}個すべて持って戦います。制限時間{MAX_SEC}秒。
        </div>
        <button onClick={start} style={{ ...miniBtn('#44ddff'), width:'100%', padding:'10px', fontSize:'13px' }}>⏱ ATBで戦う</button>
      </div>
    )
  }

  // ===== 戦闘（画面は V2capAtbFight.jsx・ダンジョンと同じ）=====
  return (
    <div style={{ ...box, padding:'12px' }}>
      <V2capAtbFight st={st.current} runKey={runKey} macros={macros} playerSrc={playerSrc} playerMotion={playerMotion}
        bossArt={bossArt} verPicker={verPicker} dev
        footer={<>
          <button onClick={start} style={{ ...miniBtn('#44ddff'), flex:1, padding:'8px' }}>↻ もう一度</button>
          <button onClick={() => { setPhase('setup'); st.current = null }} style={{ ...miniBtn('#88aaff'), flex:1, padding:'8px' }}>← 相手を選び直す</button>
        </>} />
    </div>
  )
}
