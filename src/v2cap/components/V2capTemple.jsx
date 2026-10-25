import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { box, btn, miniBtn, TEXT } from './v2ui.js'
import V2Modal from './V2Modal.jsx'
import { STAT_DEFS, STAT_KEYS } from '../core/stats.js'
import { KIND_COLOR } from '../core/skills.js'
import { V2SkillTip } from './V2ItemTip.jsx'
import {
  CLASSES, CLASS_BY_ID, STAGES, STAGE_ORDER, jobOf, jobMaxOf, jobNeed, missingReqOf, canBecome, reqText, weaponsOf, canEquipType,
  classDescOf, mainStatsOf, stageOf, stageLabelOf, stageColorOf, learnOrderOf, learnAtOf, nextClassesOf,
} from '../lib/jobs.js'
import { passiveOf } from '../lib/skills.js'
import { ITEM_BY_ID } from '../lib/equipment.js'
import { statBreakdown, statBreakdownAs } from '../lib/loadout.js'
import { ART_GENDERS, artSrcOf, hasArt } from '../lib/classArt.js'
import { useStored } from '../core/prefs.js'
import { artGenderOf } from '../lib/gender.js'

// ============================================================
// 「レベルキャップあり」版 — 神殿（転職）
//   【確定】2026-10-11 ユーザー指示：
//   ・一覧は「初期クラス」「上位クラス」の見出しの下にカード。1枚に 名前＋ClassLV（転職したことのないクラスも ClassLV1）／
//     装備できる武器種だけ（就けないクラスは条件も）。特徴の一言と上がりやすいステータスは詳細の画面で出す
//     （ユーザー「クラス選択するとき、上がりやすいステータスとクラスの詳細は乗せなくていいや、クラス詳細で説明するから」）
//   ・「そのクラス名を押してそのクラスの詳細が開かれてる画面で転職確定させるようにしたい。グラブルみたいなイメージ」：
//     カードを押すとそのクラスの詳細（イラスト・特徴の一言（スキル名・ステータス名を書かない＝jobs.js の desc）・武器種・
//     上がりやすいステータス（mainStatsOf）・ClassEXP・パッシブ・覚えるスキル・この先のクラスや転職条件）。
//     一番下の「このクラスに転職する」で転職する
//   【確定】2026-10-26 ユーザー指示「転職したとき分かりづらいから、このクラスに転職するを押したら確認のポップアップで確認出るようにして」：
//   ・「このクラスに転職する」→ **確認のポップアップ**（ChangeConfirm）。転職の前後のステ（戦闘力と8つのステ）と増減（＋／−／±0）を出す
//     （数え方は loadout.js の statBreakdownAs＝クラスのステ・アセンション・外れる武器まで入れた、ステータス画面と同じ合計）
//   ・転職し終わったら画面のいちばん上へ（V2Modal が「実行」のあと閉じたときに戻す）。「〇〇になった！」は詳細の画面のいちばん上に出す
//   ・クラスのステ（CLASS LVごとに入る量）はここに書かない（ユーザー「ステータスの情報はここに書かなくていい」）
//   ・「就く条件」→「転職条件」。パッシブはスキルの欄の先頭に、目立つ枠で（ユーザー「パッシブスキルはスキルの初めに、もっとわかりやすく」）
//   ・イラストは男女それぞれ（ユーザー「男女それぞれのイラストを用意してるから、良い感じに見えるようにして」）。
//     対応表と軽い版の場所は src/v2cap/lib/classArt.js（作るのは tools/v2cap-art.mjs）。
//     詳細は全身をクラスの色の淡い光の背景＋足元の影に大きく。一覧はカードの左に顔のまわりだけのアップ
//     （ユーザー「職業選択するときは顔の周りだけアップするだけでいい」）。「♂ 男性／♀ 女性」で切り替え・端末で覚えておく。
//     絵が無いクラスは「イラスト準備中」。並びは剣士が先頭（ユーザー「剣士の位置は一番上にして」＝jobs.js の CLASS_INFO の順）
//   仕組み：いつでも無料・LVはそのまま・ClassLVは職業ごとに続きから・スキルセットは職業ごと（詳細の画面に添えて出す）
// ============================================================
const statText = (cls) => mainStatsOf(cls).map(k => STAT_DEFS[k]?.label || k).join('・')
const STAGE_TITLE = { shoki:'初期クラス', ichiji:'上位クラス' }
const label = { color: TEXT.label }

// クラスの色の淡い光（絵の後ろ）
const glowOf = (cls, strength = '38') => `radial-gradient(ellipse at 50% 40%, ${stageColorOf(cls)}${strength} 0%, #001030 55%, #000818 100%)`

// 「♂ 男性／♀ 女性」の切り替え（一覧と詳細で同じ設定）。
// ★絵の上には重ねない（どの絵も上から下まで使い、斧・槍・弓・杖が四隅まで届くので、重ねると隠れる）
function GenderToggle({ value, onChange, style }) {
  return (
    <div style={{ display:'flex', gap:'4px', ...style }}>
      {ART_GENDERS.map(g => {
        const on = value === g.key
        return (
          <button key={g.key} onClick={() => onChange(g.key)} aria-pressed={on}
            style={{ ...miniBtn(on ? g.color : '#2a4466'), color: on ? g.color : TEXT.label, background: on ? '#00163a' : '#000818',
              padding:'5px 10px', fontSize:'11px' }}>
            {g.mark} {g.label}
          </button>
        )
      })}
    </div>
  )
}

// 詳細の大きい絵（全身）。クラスの色の淡い光の背景＋足元の影。読み込めたらふわっと出す。男女の切り替えは絵の下
const ART_COL = { width:'min(100%, 300px)', flexShrink:0 }
function ArtPanel({ cls, gender, onGender }) {
  const src = artSrcOf(cls, gender, 'web')
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setLoaded(false); setFailed(false) }, [src])
  const show = src && !failed
  return (
    <div style={ART_COL}>
      <div style={{ position:'relative', width:'100%', aspectRatio:'3 / 4', overflow:'hidden', background: glowOf(cls), border:`1px solid ${stageColorOf(cls)}55` }}>
        {/* 足元の影 */}
        <div style={{ position:'absolute', left:'18%', right:'18%', bottom:'2%', height:'6%', borderRadius:'50%',
          background:'radial-gradient(ellipse at center, rgba(0,0,0,0.75), rgba(0,0,0,0) 70%)' }} />
        {show ? (
          <img src={src} alt={`${cls}（${ART_GENDERS.find(g => g.key === gender)?.label || ''}）`}
            onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
            style={{ position:'absolute', top:'3%', left:'3%', width:'94%', height:'93%', objectFit:'contain', objectPosition:'center bottom',
              opacity: loaded ? 1 : 0, transition:'opacity .35s ease', filter:'drop-shadow(0 6px 12px rgba(0,0,0,0.55))' }} />
        ) : (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color: TEXT.empty, fontSize:'11px' }}>
            イラスト準備中
          </div>
        )}
      </div>
      {hasArt(cls) && <GenderToggle value={gender} onChange={onGender} style={{ justifyContent:'center', marginTop:'6px' }} />}
    </div>
  )
}

// 一覧の小さい絵＝顔のまわりだけのアップ（ユーザー「職業選択するときは顔の周りだけアップするだけでいい」）。
// 切り取りは tools/v2cap-art.mjs が classArt.js の ART_FACE で作る。絵の無いクラスは同じ大きさの空き枠
function ArtFace({ cls, gender }) {
  const src = artSrcOf(cls, gender, 'face')
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  return (
    <div style={{ width:'60px', height:'60px', flexShrink:0, overflow:'hidden', background: glowOf(cls, '30'), border:'1px solid #002244',
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
      ) : (
        <span style={{ color: TEXT.empty, fontSize:'9px' }}>準備中</span>
      )}
    </div>
  )
}

export default function V2capTemple({ prof, inventory, onProfile }) {
  const [view, setView] = useState(null)    // 詳細を開いているクラス（null は一覧）
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [ask, setAsk] = useState(false)     // 転職の確認のポップアップを出している
  // イラストを男女どちらで見せるか（端末で覚えておく・見るだけの切り替え）。はじめはキャラの性別（2026-10-21・gender.js）
  const [gender, setGender] = useStored('capArtGender', artGenderOf(prof))

  // 一覧⇔詳細は画面の切り替え＝いちばん上へ（2026-10-25 ユーザー指示「画面遷移したら画面上部に移動」）
  const open = (cls) => { setView(cls); setMsg(''); setError(''); setAsk(false); window.scrollTo(0, 0) }
  // 確認のポップアップで「転職する」を押したとき。終わったらポップアップを閉じる＝画面のいちばん上へ戻り（V2Modal）、
  // 詳細の画面のいちばん上に結果を出す。★プロフィールを読み直す前に閉じる（読み直したあとは前後が同じ職業になり、増減が全部±0に見える）
  const change = async (cls) => {
    setBusy(true); setError(''); setMsg('')
    const { data, error: e } = await supabase.rpc('v2cap_change_class', { p_class: cls })
    if (e || !data?.ok) { setAsk(false); setBusy(false); setError(e?.message || data?.error || '転職に失敗しました'); return }
    const got = data.learned || []
    setMsg(`${cls}になった！${got.length ? `　スキル「${got.join('」「')}」を覚えた` : ''}${data.unequipped ? '　装備できない武器を外した' : ''}`)
    setAsk(false)
    await onProfile(null)
    setBusy(false)
  }

  if (view && CLASS_BY_ID[view]) {
    return (
      <ClassDetail cls={view} prof={prof} inventory={inventory} busy={busy} msg={msg} error={error} gender={gender} onGender={setGender}
        asking={ask} onAsk={() => { setMsg(''); setError(''); setAsk(true) }} onCancel={() => setAsk(false)}
        onChange={() => change(view)} onOpen={open} onBack={() => open(null)} />
    )
  }

  return (
    <div style={{ fontFamily:'monospace' }}>
      <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:'6px', marginBottom:'8px' }}>
        <span style={{ color: TEXT.label, fontSize:'11px' }}>イラスト：</span>
        <GenderToggle value={gender} onChange={setGender} />
      </div>
      {STAGE_ORDER.map(stage => {
        const list = CLASSES.filter(c => c.stage === stage)
        const thumbs = list.some(c => hasArt(c.id))   // 絵が1枚も無い段（いまは上位クラス）は小さい絵の枠を出さない
        return (
          <div key={stage} style={{ ...box, padding:'12px', marginBottom:'10px' }}>
            <div style={{ color: STAGES[stage].color, fontSize:'13px', marginBottom:'8px' }}>{STAGE_TITLE[stage] || `${STAGES[stage].label}クラス`}</div>
            <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fill, minmax(${thumbs ? 250 : 220}px, 1fr))`, gap:'6px' }}>
              {list.map(c => {
                const job = jobOf(prof.jobs, c.id)
                const isNow = c.id === prof.class
                const miss = missingReqOf(c.id, prof.jobs)
                return (
                  // ★カード全体を押すと、そのクラスの詳細が開く（転職はそこで決める）。
                  //   一覧は 小さい絵・名前・ClassLV・装備できる武器種だけ（特徴と上がりやすいステータスは詳細で出す）
                  <button key={c.id} onClick={() => open(c.id)}
                    style={{ textAlign:'left', background:'#000818', border:`1px solid ${isNow ? '#ff88cc' : '#002244'}`, padding: thumbs ? '6px 10px 6px 6px' : '8px 10px',
                      opacity: miss ? 0.55 : 1, cursor:'pointer', fontFamily:'monospace', color:'#88ccff', display:'flex', gap:'10px', alignItems:'center' }}>
                    {thumbs && <ArtFace cls={c.id} gender={gender} />}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'baseline', gap:'8px', marginBottom:'4px', flexWrap:'wrap' }}>
                        <span style={{ color: isNow ? '#ff88cc' : '#cfe2ff', fontSize:'14px' }}>{c.id}</span>
                        <span style={{ color: prof.jobs?.[c.id] ? '#ffcc00' : TEXT.sub, fontSize:'11px' }}>
                          CLASS LV{job.lv}{job.lv >= jobMaxOf(c.id) && <span style={{ color:'#ff8844' }}> MAX</span>}
                        </span>
                        {isNow && <span style={{ color:'#ff88cc', fontSize:'10px', marginLeft:'auto' }}>いまのクラス</span>}
                      </div>
                      <div style={{ fontSize:'11px', lineHeight:1.7 }}>
                        <div><span style={label}>装備できる武器種：</span><span style={{ color:'#cfe2ff' }}>{weaponsOf(c.id).join('・')}</span></div>
                        {miss && <div style={{ color:'#ff8844' }}>転職条件：{reqText(c.id)}（いま{jobOf(prof.jobs, c.req.cls).lv}）</div>}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// そのクラスの詳細。一番下の「このクラスに転職する」→ 確認のポップアップで転職する
function ClassDetail({ cls, prof, inventory, busy, msg, error, gender, onGender, asking, onAsk, onCancel, onChange, onOpen, onBack }) {
  const c = CLASS_BY_ID[cls]
  const stage = stageOf(cls)
  const job = jobOf(prof.jobs, cls)
  const max = jobMaxOf(cls)
  const isMax = job.lv >= max
  const need = jobNeed(stage, job.lv)
  const touched = !!prof.jobs?.[cls]
  const isNow = cls === prof.class
  const miss = missingReqOf(cls, prof.jobs)
  const learned = new Set(prof.learned || [])
  const order = learnOrderOf(cls)
  const at = learnAtOf(cls)
  const passive = passiveOf(cls)
  const nexts = nextClassesOf(cls)
  const color = stageColorOf(cls)
  // 転職すると外れる武器（いま着けている武器を、このクラスが装備できないとき）
  const wornWeapon = (() => {
    const inv = (inventory || []).find(i => String(i.id) === String(prof.equipped?.weapon))
    return inv ? ITEM_BY_ID[inv.base_id] : null
  })()
  const dropWeapon = !isNow && wornWeapon && !canEquipType(cls, wornWeapon.type)
  const section = { ...box, padding:'12px', marginBottom:'10px' }
  const head = { color:'#88ccff', fontSize:'12px', marginBottom:'6px' }

  return (
    <div style={{ fontFamily:'monospace' }}>
      <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← クラス一覧へ</button>

      {/* 転職の結果（転職し終わると画面のいちばん上へ戻るので、ここに出す） */}
      {msg && <div style={{ ...section, borderColor:'#44ff88', color:'#44ff88', fontSize:'13px', lineHeight:1.7 }}>✨ {msg}</div>}
      {error && <div style={{ ...section, borderColor:'#ff4444', color:'#ff4444', fontSize:'12px' }}>⚠ {error}</div>}

      {/* イラスト（左）＋ 名前・ClassLV・特徴（右）。狭い画面では縦に並ぶ */}
      <div style={{ ...section, borderColor: isNow ? '#ff88cc' : '#0044aa', display:'flex', gap:'14px', flexWrap:'wrap', alignItems:'flex-start' }}>
        <ArtPanel cls={cls} gender={gender} onGender={onGender} />
        <div style={{ flex:'1 1 240px', minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:'10px', flexWrap:'wrap' }}>
          <span style={{ color, fontSize:'10px' }}>[{stageLabelOf(cls)}]</span>
          <span style={{ color: isNow ? '#ff88cc' : '#ffcc00', fontSize:'20px', letterSpacing:'2px' }}>{cls}</span>
          <span style={{ color: touched ? '#ffcc00' : TEXT.sub, fontSize:'12px' }}>
            CLASS LV{job.lv}／{max}{isMax && <span style={{ color:'#ff8844' }}> MAX</span>}
          </span>
          {isNow && <span style={{ color:'#ff88cc', fontSize:'11px', marginLeft:'auto' }}>いまのクラス</span>}
        </div>
        {/* ClassEXP（転職したことのあるクラスだけ） */}
        {touched && !isMax && (
          <div style={{ marginTop:'6px' }}>
            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#7fa6d0', marginBottom:'1px' }}>
              <span>CLASS EXP</span><span style={{ color:'#3399cc' }}>{job.exp.toLocaleString()}/{need.toLocaleString()}</span>
            </div>
            <div style={{ background:'#001028', height:'4px', border:'1px solid #002244' }}>
              <div style={{ height:'100%', width:`${Math.min(100, (job.exp / Math.max(1, need)) * 100)}%`, background:'linear-gradient(90deg,#001,#3399cc)' }} />
            </div>
          </div>
        )}
        <div style={{ color:'#9fb8d0', fontSize:'12px', lineHeight:1.7, marginTop:'8px' }}>{classDescOf(cls)}</div>
        <div style={{ fontSize:'11px', lineHeight:1.8, marginTop:'6px' }}>
          <div><span style={label}>装備できる武器種：</span><span style={{ color:'#cfe2ff' }}>{weaponsOf(cls).join('・')}</span></div>
          <div><span style={label}>上がりやすいステータス：</span><span style={{ color:'#44ff88' }}>{statText(cls)}</span></div>
          <div><span style={label}>通常攻撃：</span><span style={{ color:'#cfe2ff' }}>{c.kind === 'mag' ? '魔法' : '物理'}</span></div>
        </div>
        </div>
      </div>

      {/* パッシブ（先頭・目立つ枠）＋ 覚えるスキル（押す／カーソルを合わせると効果） */}
      <div style={section}>
        <div style={head}>📖 スキル</div>
        {passive && (
          <div style={{ border:'1px solid #ffcc66', background:'linear-gradient(90deg, #2a2000 0%, #000818 85%)', padding:'8px 10px', marginBottom:'10px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'4px' }}>
              <span style={{ background:'#ffcc66', color:'#1a1000', fontSize:'10px', padding:'1px 6px', letterSpacing:'1px' }}>パッシブ</span>
              <span style={{ color:'#ffcc66', fontSize:'14px', letterSpacing:'1px' }}>{passive.name}</span>
            </div>
            <div style={{ color:'#cfe2ff', fontSize:'11px', lineHeight:1.7 }}>{passive.desc}</div>
            <div style={{ color: TEXT.sub, fontSize:'10px', marginTop:'4px' }}>※ 編成しなくても、{cls}でいる間ずっと効く</div>
          </div>
        )}
        {passive && <div style={{ ...label, fontSize:'11px', marginBottom:'4px' }}>覚える技</div>}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'3px' }}>
          {order.map((s, i) => {
            const has = learned.has(s.name)
            return (
              <div key={s.name} style={{ background:'#000818', border:'1px solid #002244', padding:'4px 7px', fontSize:'11px', display:'flex', gap:'6px', alignItems:'center' }}>
                <span style={{ color: has ? '#44ff88' : TEXT.label, fontSize:'10px', flexShrink:0, width:'72px' }}>CLASS LV{at[i]}</span>
                <V2SkillTip skill={s} alignRight={i % 2 === 1} style={{ display:'block', flex:1, minWidth:0 }}>
                  <span style={{ color: has ? KIND_COLOR[s.kind] : TEXT.sub }}>{s.name}</span>
                </V2SkillTip>
                <span style={{ color: has ? '#44ff88' : TEXT.empty, fontSize:'9px', flexShrink:0 }}>{has ? '覚えた' : 'まだ'}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 系統（この先のクラス・転職条件） */}
      {(nexts.length > 0 || c.req) && (
        <div style={section}>
          <div style={head}>🔀 系統</div>
          <div style={{ fontSize:'11px', lineHeight:1.8 }}>
            {c.req && (
              <div>
                <span style={label}>転職条件：</span>
                <span style={{ color: miss ? '#ff8844' : '#88ddaa' }}>{reqText(cls)}{miss ? `（いま${jobOf(prof.jobs, c.req.cls).lv}）` : '（達成）'}</span>
              </div>
            )}
            {nexts.length > 0 && (
              <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap' }}>
                <span style={label}>CLASS LV30で就けるクラス：</span>
                {nexts.map(n => <button key={n} onClick={() => onOpen(n)} style={miniBtn(stageColorOf(n))}>{n}</button>)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 転職を決める（押すと確認のポップアップ） */}
      <div style={{ ...section, borderColor: isNow ? '#0044aa' : '#ff88cc' }}>
        <button onClick={onAsk} disabled={busy || isNow || !canBecome(cls, prof.jobs)}
          style={{ ...btn(isNow || miss ? '#62789a' : '#ff88cc'), width:'100%', padding:'12px', fontSize:'14px', letterSpacing:'2px',
            cursor: busy || isNow || miss ? 'not-allowed' : 'pointer' }}>
          {busy ? '転職しています...' : isNow ? 'いまのクラスです' : miss ? `転職条件：${reqText(cls)}` : 'このクラスに転職する'}
        </button>
      </div>

      {asking && !isNow && !miss && (
        <ChangeConfirm cls={cls} prof={prof} inventory={inventory} busy={busy}
          dropWeapon={dropWeapon ? wornWeapon : null} onConfirm={onChange} onClose={onCancel} />
      )}
    </div>
  )
}

// 転職の確認のポップアップ。転職の前後のステ（戦闘力＋8つのステ）と増減を並べる（2026-10-26 ユーザー指示
// 「確認画面では転職前後でステータスがどう変わるのか、±とかも表示されるように」）。
// 前後とも、ステータス画面と同じ合計（本体＋クラスのステ＋装備＋アセンション＋防具・セット・食事）。外れる武器のぶんも入る
const signed = (n) => (n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `−${Math.abs(n).toLocaleString()}` : '±0')
const signColor = (n) => (n > 0 ? '#44ff88' : n < 0 ? '#ff6b6b' : TEXT.empty)
function ChangeConfirm({ cls, prof, inventory, busy, dropWeapon, onConfirm, onClose }) {
  const before = statBreakdown(prof, inventory)
  const after = statBreakdownAs(prof, inventory, cls)
  const rows = [
    { key:'power', label:'戦闘力', color:'#ffcc00', a: before.power, b: after.power },
    ...STAT_KEYS.map(k => ({ key:k, label: STAT_DEFS[k].label, color: STAT_DEFS[k].color, a: before.total[k], b: after.total[k] })),
  ]
  const fromLv = jobOf(prof.jobs, prof.class).lv
  const toLv = jobOf(prof.jobs, cls).lv
  const pFrom = passiveOf(prof.class)
  const pTo = passiveOf(cls)
  const grid = { display:'grid', gridTemplateColumns:'52px 1fr 1fr 64px', gap:'0 8px', alignItems:'baseline' }
  const num = { textAlign:'right', fontVariantNumeric:'tabular-nums' }
  return (
    <V2Modal title="⛪ 転職の確認" color="#ff88cc" confirmLabel="転職する" busy={busy} onConfirm={onConfirm} onClose={onClose}>
      <div style={{ textAlign:'center', marginBottom:'10px', lineHeight:1.6 }}>
        <span style={{ color:'#cfe2ff' }}>{prof.class}</span>
        <span style={{ color: TEXT.sub, fontSize:'10px' }}>（CLASS LV{fromLv}）</span>
        <span style={{ color: TEXT.label, margin:'0 6px' }}>→</span>
        <span style={{ color:'#ff88cc', fontSize:'14px' }}>{cls}</span>
        <span style={{ color: TEXT.sub, fontSize:'10px' }}>（CLASS LV{toLv}）</span>
      </div>
      <div style={{ ...grid, fontSize:'10px', color: TEXT.label, borderBottom:'1px solid #002a55', paddingBottom:'3px', marginBottom:'3px' }}>
        <span>ステ</span>
        <span style={{ ...num, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>いま</span>
        <span style={{ ...num, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>転職後</span>
        <span style={num}>増減</span>
      </div>
      {rows.map(r => {
        const d = r.b - r.a
        return (
          <div key={r.key} style={{ ...grid, fontSize: r.key === 'power' ? '13px' : '12px', lineHeight:1.9,
            ...(r.key === 'power' ? { borderBottom:'1px solid #002a55', marginBottom:'2px' } : null) }}>
            <span style={{ color: r.color }}>{r.label}</span>
            <span style={{ ...num, color: TEXT.sub }}>{r.a.toLocaleString()}</span>
            <span style={{ ...num, color:'#cfe2ff' }}>{r.b.toLocaleString()}</span>
            <span style={{ ...num, color: signColor(d) }}>{signed(d)}</span>
          </div>
        )
      })}
      <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.8, marginTop:'10px' }}>
        {(pFrom || pTo) && (
          <div>パッシブ：<span style={{ color: pFrom ? '#ffcc66' : TEXT.empty }}>{pFrom?.name || 'なし'}</span> → <span style={{ color: pTo ? '#ffcc66' : TEXT.empty }}>{pTo?.name || 'なし'}</span></div>
        )}
        <div>LVはそのまま、CLASS LVは{toLv}から続きます。スキルセットは{cls}のものに切り替わります（{prof.class}の編成は残ります）。</div>
        {dropWeapon && <div style={{ color:'#ff8844' }}>いま着けている{dropWeapon.name}（{dropWeapon.type}）は外れます（上の数字はこの武器を外した形）。</div>}
      </div>
    </V2Modal>
  )
}
