import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { box, btn, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { STAT_DEFS } from '../../v2/lib/stats.js'
import { KIND_COLOR } from '../../v2/lib/skills.js'
import { V2SkillTip } from '../../v2/components/V2ItemTip.jsx'
import {
  CLASSES, CLASS_BY_ID, STAGES, STAGE_ORDER, JOB_LV_HPMP, jobOf, jobMaxOf, jobNeed, missingReqOf, canBecome, reqText, weaponsOf, canEquipType,
  classDescOf, mainStatsOf, stageOf, stageLabelOf, stageColorOf, learnOrderOf, learnAtOf, jobBonusText, nextClassesOf,
} from '../lib/jobs.js'
import { passiveOf } from '../lib/skills.js'
import { ITEM_BY_ID } from '../lib/equipment.js'

// ============================================================
// 「レベルキャップあり」版 — 神殿（転職）
//   【確定】2026-10-11 ユーザー指示：
//   ・一覧は「初期クラス」「一次クラス」の見出しの下にカード。1枚に 名前＋ClassLV（転職したことのないクラスも ClassLV1）／
//     装備できる武器種だけ（就けないクラスは条件も）。特徴の一言と上がりやすいステータスは詳細の画面で出す
//     （ユーザー「クラス選択するとき、上がりやすいステータスとクラスの詳細は乗せなくていいや、クラス詳細で説明するから」）
//   ・「そのクラス名を押してそのクラスの詳細が開かれてる画面で転職確定させるようにしたい。グラブルみたいなイメージ」：
//     カードを押すとそのクラスの詳細（イラスト・特徴の一言（スキル名・ステータス名を書かない＝jobs.js の desc）・武器種・
//     上がりやすいステータス（mainStatsOf）・ClassEXP・覚えるスキル・パッシブ・クラスのステ・この先のクラスや条件）。
//     一番下の「このクラスに転職する」で転職する（詳細の画面が確認の役＝確認のポップアップは出さない）
//   ・イラストは public/V2newjob/<クラス名>.png（.webp・.jpg・.jpeg も可）。無いあいだは「イラスト準備中」の枠（ユーザーがあとで入れる）
//   仕組み：いつでも無料・LVはそのまま・ClassLVは職業ごとに続きから・スキルセットは職業ごと（詳細の画面に添えて出す）
// ============================================================
const statText = (cls) => mainStatsOf(cls).map(k => STAT_DEFS[k]?.label || k).join('・')
const STAGE_TITLE = { shoki:'初期クラス', ichiji:'一次クラス' }
const label = { color: TEXT.label }

// クラスのイラスト。public/V2newjob/<クラス名>.<拡張子> を順に試し、どれも無ければ「イラスト準備中」の枠
const ART_DIR = '/V2newjob'
const ART_EXTS = ['png', 'webp', 'jpg', 'jpeg']
const ART_BOX = { width:'min(100%, 240px)', height:'300px', flexShrink:0 }
function ClassArt({ cls }) {
  const [i, setI] = useState(0)
  useEffect(() => { setI(0) }, [cls])
  if (i >= ART_EXTS.length) {
    return (
      <div style={{ ...ART_BOX, border:'1px dashed #223a5e', color: TEXT.empty, fontSize:'10px',
        display:'flex', alignItems:'center', justifyContent:'center', background:'#000818' }}>
        イラスト準備中
      </div>
    )
  }
  return (
    <img src={`${ART_DIR}/${encodeURIComponent(cls)}.${ART_EXTS[i]}`} alt={cls} onError={() => setI(n => n + 1)}
      style={{ ...ART_BOX, objectFit:'contain', background:'#000818' }} />
  )
}

export default function V2capTemple({ prof, inventory, onProfile }) {
  const [view, setView] = useState(null)    // 詳細を開いているクラス（null は一覧）
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const open = (cls) => { setView(cls); setMsg(''); setError('') }
  const change = async (cls) => {
    setBusy(true); setError(''); setMsg('')
    const { data, error: e } = await supabase.rpc('v2cap_change_class', { p_class: cls })
    if (e || !data?.ok) { setBusy(false); setError(e?.message || data?.error || '転職に失敗しました'); return }
    const got = data.learned || []
    setMsg(`${cls}になった！${got.length ? `　スキル「${got.join('」「')}」を覚えた` : ''}${data.unequipped ? '　装備できない武器を外した' : ''}`)
    await onProfile(null)
    setBusy(false)
  }

  if (view && CLASS_BY_ID[view]) {
    return (
      <ClassDetail cls={view} prof={prof} inventory={inventory} busy={busy} msg={msg} error={error}
        onChange={() => change(view)} onOpen={open} onBack={() => open(null)} />
    )
  }

  return (
    <div style={{ fontFamily:'monospace' }}>
      {STAGE_ORDER.map(stage => (
        <div key={stage} style={{ ...box, padding:'12px', marginBottom:'10px' }}>
          <div style={{ color: STAGES[stage].color, fontSize:'13px', marginBottom:'8px' }}>{STAGE_TITLE[stage] || `${STAGES[stage].label}クラス`}</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'6px' }}>
            {CLASSES.filter(c => c.stage === stage).map(c => {
              const job = jobOf(prof.jobs, c.id)
              const isNow = c.id === prof.class
              const miss = missingReqOf(c.id, prof.jobs)
              return (
                // ★カード全体を押すと、そのクラスの詳細が開く（転職はそこで決める）。
                //   一覧は 名前・ClassLV・装備できる武器種だけ（特徴と上がりやすいステータスは詳細で出す）
                <button key={c.id} onClick={() => open(c.id)}
                  style={{ textAlign:'left', background:'#000818', border:`1px solid ${isNow ? '#ff88cc' : '#002244'}`, padding:'8px 10px',
                    opacity: miss ? 0.55 : 1, cursor:'pointer', fontFamily:'monospace', color:'#88ccff' }}>
                  <div style={{ display:'flex', alignItems:'baseline', gap:'8px', marginBottom:'4px', flexWrap:'wrap' }}>
                    <span style={{ color: isNow ? '#ff88cc' : '#cfe2ff', fontSize:'14px' }}>{c.id}</span>
                    <span style={{ color: prof.jobs?.[c.id] ? '#ffcc00' : TEXT.sub, fontSize:'11px' }}>
                      ClassLV{job.lv}{job.lv >= jobMaxOf(c.id) && <span style={{ color:'#ff8844' }}> MAX</span>}
                    </span>
                    {isNow && <span style={{ color:'#ff88cc', fontSize:'10px', marginLeft:'auto' }}>いまのクラス</span>}
                  </div>
                  <div style={{ fontSize:'11px', lineHeight:1.7 }}>
                    <div><span style={label}>装備できる武器種：</span><span style={{ color:'#cfe2ff' }}>{weaponsOf(c.id).join('・')}</span></div>
                    {miss && <div style={{ color:'#ff8844' }}>条件：{reqText(c.id)}（いま{jobOf(prof.jobs, c.req.cls).lv}）</div>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// そのクラスの詳細。一番下の「このクラスに転職する」で転職する
function ClassDetail({ cls, prof, inventory, busy, msg, error, onChange, onOpen, onBack }) {
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
  const hpmp = JOB_LV_HPMP[cls] || { hp: 0, mp: 0 }
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

      {/* イラスト（左）＋ 名前・ClassLV・特徴（右）。狭い画面では縦に並ぶ */}
      <div style={{ ...section, borderColor: isNow ? '#ff88cc' : '#0044aa', display:'flex', gap:'14px', flexWrap:'wrap', alignItems:'flex-start' }}>
        <ClassArt cls={cls} />
        <div style={{ flex:'1 1 240px', minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:'10px', flexWrap:'wrap' }}>
          <span style={{ color, fontSize:'10px' }}>[{stageLabelOf(cls)}]</span>
          <span style={{ color: isNow ? '#ff88cc' : '#ffcc00', fontSize:'20px', letterSpacing:'2px' }}>{cls}</span>
          <span style={{ color: touched ? '#ffcc00' : TEXT.sub, fontSize:'12px' }}>
            ClassLV{job.lv}／{max}{isMax && <span style={{ color:'#ff8844' }}> MAX</span>}
          </span>
          {isNow && <span style={{ color:'#ff88cc', fontSize:'11px', marginLeft:'auto' }}>いまのクラス</span>}
        </div>
        {/* ClassEXP（転職したことのあるクラスだけ） */}
        {touched && !isMax && (
          <div style={{ marginTop:'6px' }}>
            <div style={{ fontSize:'10px', display:'flex', justifyContent:'space-between', color:'#7fa6d0', marginBottom:'1px' }}>
              <span>ClassEXP</span><span style={{ color:'#3399cc' }}>{job.exp.toLocaleString()}/{need.toLocaleString()}</span>
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

      {/* 覚えるスキル（押す／カーソルを合わせると効果） */}
      <div style={section}>
        <div style={head}>📖 スキル</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'3px' }}>
          {order.map((s, i) => {
            const has = learned.has(s.name)
            return (
              <div key={s.name} style={{ background:'#000818', border:'1px solid #002244', padding:'4px 7px', fontSize:'11px', display:'flex', gap:'6px', alignItems:'center' }}>
                <span style={{ color: has ? '#44ff88' : TEXT.label, fontSize:'10px', flexShrink:0, width:'64px' }}>ClassLV{at[i]}</span>
                <V2SkillTip skill={s} alignRight={i % 2 === 1} style={{ display:'block', flex:1, minWidth:0 }}>
                  <span style={{ color: has ? KIND_COLOR[s.kind] : TEXT.sub }}>{s.name}</span>
                </V2SkillTip>
                <span style={{ color: has ? '#44ff88' : TEXT.empty, fontSize:'9px', flexShrink:0 }}>{has ? '覚えた' : 'まだ'}</span>
              </div>
            )
          })}
        </div>
        {passive && (
          <div style={{ marginTop:'6px', fontSize:'11px', lineHeight:1.7 }}>
            <span style={label}>パッシブ：</span><span style={{ color:'#ffcc66' }}>{passive.name}</span>
            <span style={{ color: TEXT.sub }}>（{passive.desc}・就いている間ずっと効く）</span>
          </div>
        )}
      </div>

      {/* クラスのステ（就いている間だけ効く） */}
      <div style={section}>
        <div style={head}>📈 クラスのステ（このクラスに就いている間だけ）</div>
        <div style={{ fontSize:'11px', lineHeight:1.8 }}>
          <div><span style={label}>ClassLVが上がるたびに：</span><span style={{ color:'#cfe2ff' }}>必ず HP+{hpmp.hp}・MP+{hpmp.mp}、ほかに{STAGES[stage]?.perLv || 0}点</span></div>
          <div><span style={label}>いま（ClassLV{job.lv}）：</span><span style={{ color:'#44ff88' }}>{jobBonusText(cls, job.lv) || 'まだなし'}</span></div>
          {!isMax && <div><span style={label}>ClassLV{max}で：</span><span style={{ color:'#cfe2ff' }}>{jobBonusText(cls, max)}</span></div>}
        </div>
      </div>

      {/* 系統（この先のクラス・就く条件） */}
      {(nexts.length > 0 || c.req) && (
        <div style={section}>
          <div style={head}>🔀 系統</div>
          <div style={{ fontSize:'11px', lineHeight:1.8 }}>
            {c.req && (
              <div>
                <span style={label}>就く条件：</span>
                <span style={{ color: miss ? '#ff8844' : '#88ddaa' }}>{reqText(cls)}{miss ? `（いま${jobOf(prof.jobs, c.req.cls).lv}）` : '（達成）'}</span>
              </div>
            )}
            {nexts.length > 0 && (
              <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap' }}>
                <span style={label}>ClassLV30で就けるクラス：</span>
                {nexts.map(n => <button key={n} onClick={() => onOpen(n)} style={miniBtn(stageColorOf(n))}>{n}</button>)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 転職を決める（詳細の画面が確認の役＝確認のポップアップは出さない） */}
      <div style={{ ...section, borderColor: isNow ? '#0044aa' : '#ff88cc' }}>
        {!isNow && !miss && (
          <div style={{ color: TEXT.sub, fontSize:'10px', lineHeight:1.8, marginBottom:'8px' }}>
            LVはそのまま、ClassLVは{job.lv}から続きます。スキルセットは{cls}のものに切り替わります（{prof.class}の編成は残ります）。
            {dropWeapon && <span style={{ color:'#ff8844' }}> いま着けている{wornWeapon.name}（{wornWeapon.type}）は外れます。</span>}
          </div>
        )}
        {msg && <div style={{ color:'#44ff88', fontSize:'11px', marginBottom:'8px' }}>{msg}</div>}
        {error && <div style={{ color:'#ff4444', fontSize:'11px', marginBottom:'8px' }}>⚠ {error}</div>}
        <button onClick={onChange} disabled={busy || isNow || !canBecome(cls, prof.jobs)}
          style={{ ...btn(isNow || miss ? '#62789a' : '#ff88cc'), width:'100%', padding:'12px', fontSize:'14px', letterSpacing:'2px',
            cursor: busy || isNow || miss ? 'not-allowed' : 'pointer' }}>
          {busy ? '転職しています...' : isNow ? 'いまのクラスです' : miss ? `条件：${reqText(cls)}` : 'このクラスに転職する'}
        </button>
      </div>
    </div>
  )
}
