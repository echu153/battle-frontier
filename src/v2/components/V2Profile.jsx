import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { STAT_KEYS, STAT_DEFS, MAX_LV, calcPower, expToNext } from '../lib/stats.js'
import { classBonusText, jobCountOf } from '../lib/classBonus.js'
import { attackKindOf } from '../lib/battle.js'
import { equippedItems, totalStats } from '../lib/loadout.js'
import { SKILL_BY_NAME, KIND_LABEL, KIND_COLOR } from '../lib/skills.js'
import { RANK_COLOR, miniBtn } from './v2ui.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
// 旧版と同じ avatars バケットの画像をそのまま使う（v2で増やす必要はない）
const PRESET_AVATARS = [
  { id:'warrior1', label:'戦士①',     url:`${SUPABASE_URL}/storage/v1/object/public/avatars/warrior1.png` },
  { id:'knight1',  label:'騎士',       url:`${SUPABASE_URL}/storage/v1/object/public/avatars/knight1.png` },
  { id:'samurai',  label:'侍',         url:`${SUPABASE_URL}/storage/v1/object/public/avatars/samurai.png` },
  { id:'hunter1',  label:'狩人①',     url:`${SUPABASE_URL}/storage/v1/object/public/avatars/hunter1.png` },
  { id:'hunter2',  label:'狩人②',     url:`${SUPABASE_URL}/storage/v1/object/public/avatars/hunter2.png` },
  { id:'wizard1',  label:'魔法使い①', url:`${SUPABASE_URL}/storage/v1/object/public/avatars/wizard1.png` },
  { id:'wizard2',  label:'魔法使い②', url:`${SUPABASE_URL}/storage/v1/object/public/avatars/wizard2.png` },
  { id:'priest',   label:'僧侶',       url:`${SUPABASE_URL}/storage/v1/object/public/avatars/priest.png` },
]

const UPLOAD_COST = 100   // 旧版の美容整形と同じ
const HEAD = { background:'#1d2a52', color:'#cfe2ff', fontSize:'12px', padding:'6px 8px', textAlign:'center', letterSpacing:'1px' }
const KEY = { background:'#101c3c', fontSize:'11px', padding:'6px 8px', borderTop:'1px solid #07102a' }
const VAL = { background:'#0a1330', color:'#cfe2ff', fontSize:'11px', padding:'6px 8px', borderTop:'1px solid #07102a', wordBreak:'break-all' }

// ステータスの並び。あるけみすとのプロフィールと同じ「項目｜値」を2組ずつ
export default function V2Profile({ prof, inventory, runes, onProfile, onBack }) {
  const [detail, setDetail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgColor, setMsgColor] = useState('#ff8844')
  const [uploaded, setUploaded] = useState([])   // 自分がアップロード済みの画像
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const uploading = useRef(false)                // 連打での二重アップロード対策
  const fileRef = useRef(null)
  const worn = equippedItems(prof, inventory)
  // ★エンチャントは割合なので totalStats に渡して合計へ乗せる
  const total = totalStats(prof, inventory, runes)
  const power = calcPower(total)
  const skills = prof.skill_set || []
  const kind = attackKindOf(prof.class) === 'mag' ? '魔法型' : '物理型'

  const say = (text, color = '#ff8844') => { setMsg(text); setMsgColor(color) }

  // 自分がアップロード済みの画像を読む（旧版と同じ avatars/{uid}/ の下）
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.storage.from('avatars').list(user.id, { limit: 60, sortBy:{ column:'created_at', order:'desc' } })
      if (!alive || !data) return
      setUploaded(data.filter(f => f.name).map(f => ({
        name: f.name, url:`${SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}/${f.name}`,
      })))
    })()
    return () => { alive = false }
  }, [prof.avatar_url])

  const pickAvatar = async (url) => {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('v2_set_avatar', { p_url: url })
    setBusy(false)
    if (error || !data?.ok) { say(error?.message || data?.error || '変更に失敗しました'); return }
    onProfile(p => ({ ...p, avatar_url: url }))
    say('アイコンを変更しました', '#44ff88')
  }

  const chooseFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) { say('画像ファイルを選んでください'); return }
    if (f.size > 2 * 1024 * 1024) { say('2MBまでの画像にしてください'); return }
    setFile(f); setPreview(URL.createObjectURL(f)); setMsg('')
  }

  const doUpload = async () => {
    if (!file || uploading.current) return
    if ((prof.gold || 0) < UPLOAD_COST) { say(`Goldが足りません（${UPLOAD_COST}G必要）`); return }
    uploading.current = true; setBusy(true); setMsg('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `${user.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert:true })
      if (upErr) { say(`アップロードに失敗しました（${upErr.message}）`); return }
      const url = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`
      // ★Goldの引き落としとアイコンの差し替えはサーバー側で1回のUPDATEにまとめてある
      const { data, error } = await supabase.rpc('v2_upload_avatar', { p_url: url })
      if (error || !data?.ok) { say(error?.message || data?.error || '変更に失敗しました'); return }
      setFile(null); setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
      onProfile(null)
      say(`アップロードしてアイコンにしました（-${UPLOAD_COST}G）`, '#44ff88')
    } finally { setBusy(false); uploading.current = false }
  }

  const Row = ({ k1, v1, c1, k2, v2, c2 }) => (
    <>
      <div style={{ ...KEY, color:c1 || '#7f95c4' }}>{k1}</div><div style={VAL}>{v1}</div>
      <div style={{ ...KEY, color:c2 || '#7f95c4' }}>{k2 ?? ''}</div><div style={VAL}>{k2 == null ? '' : v2}</div>
    </>
  )
  const eq = (slot) => {
    const w = worn[slot]
    if (!w) return <span style={{ color:'#7b8fb8' }}>—</span>
    return (<>
      <span style={{ color: RANK_COLOR[w.item.rank] }}>[{w.item.rank}]</span>{' '}
      {w.item.name}{w.inv.plus ? <span style={{ color:'#ffcc00' }}>+{w.inv.plus}</span> : ''}
    </>)
  }
  const stat = (k) => (total[k] || 0).toLocaleString()

  return (
    <div>
      <button onClick={onBack} style={{ ...miniBtn('#88aaff'), marginBottom:'10px' }}>← ホームへ</button>

      <div style={{ border:'1px solid #0044aa', marginBottom:'12px', fontFamily:'monospace' }}>
        <div style={HEAD}>ステータス</div>
        <div style={{ background:'#0a1330', padding:'10px', textAlign:'center' }}>
          {prof.avatar_url
            ? <img src={prof.avatar_url} alt="" style={{ width:'72px', height:'72px', objectFit:'cover' }} onError={e => { e.target.style.display = 'none' }} />
            : <div style={{ width:'72px', height:'72px', margin:'0 auto', border:'1px dashed #223a5e', color:'#7b8fb8', fontSize:'10px', display:'flex', alignItems:'center', justifyContent:'center' }}>画像なし</div>}
          <div style={{ color:'#cfe2ff', fontSize:'13px', marginTop:'4px' }}>{prof.username}</div>
        </div>
        <div style={HEAD}>戦闘力: {power.toLocaleString()}　（{kind}）</div>

        <div style={{ display:'grid', gridTemplateColumns:'auto 1fr auto 1fr' }}>
          <Row k1="LV" v1={`${prof.lv}${prof.lv >= MAX_LV ? '（MAX）' : ''}`}
            k2="EXP" v2={`${prof.exp} / ${expToNext(prof.lv, prof.job_changes) || '—'}`} />
          {[['hp', 'mp'], ['str', 'dex'], ['agi', 'int_stat'], ['vit', 'luk']].map(([a, b]) => (
            <Row key={a} k1={STAT_DEFS[a].label} c1={STAT_DEFS[a].color} v1={stat(a)}
              k2={STAT_DEFS[b].label} c2={STAT_DEFS[b].color} v2={stat(b)} />
          ))}
          <Row k1="武器（右手）" v1={eq('right')} k2="頭具" v2={eq('head')} />
          <Row k1="武器（左手）" v1={eq('left')} k2="防具" v2={eq('body')} />
          <Row k1="腕具" v1={eq('arm')} k2="足具" v2={eq('foot')} />
          <Row k1="アクセサリー" v1={eq('acc1')} k2="アクセサリー" v2={eq('acc2')} />
          {[0, 2].map(i => (
            <Row key={i} k1={`スキル${i + 1}`} v1={skills[i]?.name || <span style={{ color:'#7b8fb8' }}>—</span>}
              k2={`スキル${i + 2}`} v2={skills[i + 1]?.name || <span style={{ color:'#7b8fb8' }}>—</span>} />
          ))}
          <Row k1="スキル5" v1={skills[4]?.name || <span style={{ color:'#7b8fb8' }}>—</span>} k2="職業" v2={prof.class} />
          <Row k1="所持金" v1={`${(prof.gold || 0).toLocaleString()} Gold`} k2="転職回数" v2={`${prof.job_changes}回`} />
          <Row k1="職業補正" v1={classBonusText(prof.class, jobCountOf(prof)) || <span style={{ color:'#7b8fb8' }}>なし</span>}
            k2="解放エリア" v2={`${(prof.unlocked_areas || [1]).length} / 8`} />
        </div>

        <div style={{ background:'#0a1330', padding:'8px' }}>
          <button onClick={() => setDetail(true)}
            style={{ width:'100%', padding:'8px', background:'#1d2a52', border:'1px solid #4a5f9e', color:'#cfe2ff',
              cursor:'pointer', fontFamily:'monospace', fontSize:'12px' }}>
            📊 ステータス詳細
          </button>
        </div>
      </div>

      {/* アイコンを選ぶ */}
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'12px', fontFamily:'monospace' }}>
        <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'8px' }}>アイコンを選ぶ</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'6px' }}>
          {PRESET_AVATARS.map(a => (
            <div key={a.id} onClick={() => !busy && pickAvatar(a.url)}
              style={{ cursor:'pointer', border:`2px solid ${prof.avatar_url === a.url ? '#ffcc00' : '#003366'}`,
                background: prof.avatar_url === a.url ? '#1a1000' : '#000818', padding:'4px', textAlign:'center' }}>
              <img src={a.url} alt={a.label} style={{ width:'100%', aspectRatio:'1', objectFit:'cover' }}
                onError={e => { e.target.style.display = 'none' }} />
              <div style={{ color: prof.avatar_url === a.url ? '#ffcc00' : '#7fa6d0', fontSize:'9px', marginTop:'2px' }}>{a.label}</div>
            </div>
          ))}
        </div>
        <button onClick={() => pickAvatar(null)} disabled={busy || !prof.avatar_url}
          style={{ ...miniBtn('#7fa6d0'), marginTop:'8px' }}>画像なしに戻す</button>

        {/* アップロード済みの画像 */}
        {uploaded.length > 0 && (
          <>
            <div style={{ color:'#7fa6d0', fontSize:'11px', margin:'12px 0 6px' }}>アップロード済み</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'6px' }}>
              {uploaded.map(u => (
                <div key={u.name} onClick={() => !busy && pickAvatar(u.url)}
                  style={{ cursor:'pointer', border:`2px solid ${prof.avatar_url === u.url ? '#ffcc00' : '#003366'}`,
                    background: prof.avatar_url === u.url ? '#1a1000' : '#000818', padding:'4px' }}>
                  <img src={u.url} alt="" style={{ width:'100%', aspectRatio:'1', objectFit:'cover' }}
                    onError={e => { e.target.style.display = 'none' }} />
                </div>
              ))}
            </div>
          </>
        )}

        {/* 画像をアップロードする（旧版の美容整形と同じで100G） */}
        <div style={{ borderTop:'1px solid #002244', marginTop:'12px', paddingTop:'10px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'6px' }}>
            画像をアップロードする
            <span style={{ color:'#7fa6d0', fontSize:'10px', marginLeft:'6px' }}>{UPLOAD_COST}G</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={chooseFile} disabled={busy}
            style={{ color:'#88ccff', fontFamily:'monospace', fontSize:'11px', width:'100%', marginBottom:'8px' }} />
          {preview && (
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
              <img src={preview} alt="" style={{ width:'64px', height:'64px', objectFit:'cover', border:'1px solid #0044aa' }} />
              <button onClick={doUpload} disabled={busy || (prof.gold || 0) < UPLOAD_COST}
                style={{ flex:1, padding:'8px', background:'#1a1000', border:'1px solid #ffcc00', color:'#ffcc00',
                  cursor: busy ? 'default' : 'pointer', fontFamily:'monospace', fontSize:'12px',
                  opacity: (prof.gold || 0) < UPLOAD_COST ? 0.4 : 1 }}>
                {busy ? 'アップロード中...' : `この画像にする（-${UPLOAD_COST}G）`}
              </button>
            </div>
          )}
          <div style={{ color:'#7fa6d0', fontSize:'9px' }}>
            2MBまでの画像。Goldの引き落としとアイコンの差し替えはサーバー側でまとめて行うので、
            連打しても二重に取られません。
          </div>
        </div>

        {msg && <div style={{ color: msgColor, fontSize:'11px', marginTop:'8px' }}>{msg}</div>}
        <div style={{ color:'#7fa6d0', fontSize:'9px', marginTop:'8px' }}>
          プリセットは旧版（無印）の美容整形と同じ画像です。アップロードした画像も共通で使えます。
        </div>
      </div>

      {detail && <StatusDetail prof={prof} total={total} power={power} onClose={() => setDetail(false)} />}
    </div>
  )
}

// ===== ステータス詳細（レーダーチャート＋升目＋スキル）=====
function StatusDetail({ prof, total, power, onClose }) {
  const R = 78, CX = 110, CY = 110
  // 戦闘力に直した値で比べる（HPは8で1、MPは3で1）。一番大きいものを外周にする
  const unit = { hp:8, mp:3 }
  const pt = STAT_KEYS.map(k => (total[k] || 0) / (unit[k] || 1))
  const max = Math.max(1, ...pt)
  const angle = (i) => (Math.PI * 2 * i) / STAT_KEYS.length - Math.PI / 2
  const xy = (i, r) => [CX + Math.cos(angle(i)) * r, CY + Math.sin(angle(i)) * r]
  const poly = pt.map((v, i) => xy(i, (v / max) * R).join(',')).join(' ')

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,4,16,0.85)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#001040', border:'1px solid #0088ff',
        maxWidth:'520px', width:'100%', maxHeight:'90vh', overflowY:'auto', fontFamily:'monospace' }}>
        <div style={{ ...HEAD, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span>{prof.username} のステータス確認</span>
          <span onClick={onClose} style={{ cursor:'pointer', color:'#88aaff' }}>✕</span>
        </div>

        <div style={{ padding:'12px' }}>
          <div style={{ textAlign:'center', color:'#cfe2ff', fontSize:'13px', marginBottom:'8px' }}>
            戦闘力: {power.toLocaleString()}
          </div>

          <div style={{ display:'flex', flexWrap:'wrap', gap:'10px', alignItems:'center', justifyContent:'center' }}>
            {/* レーダーチャート */}
            <svg width="220" height="220" style={{ flexShrink:0 }}>
              {[0.25, 0.5, 0.75, 1].map(f => (
                <polygon key={f} fill="none" stroke="#223a5e" strokeWidth="1"
                  points={STAT_KEYS.map((_, i) => xy(i, R * f).join(',')).join(' ')} />
              ))}
              {STAT_KEYS.map((k, i) => {
                const [x, y] = xy(i, R)
                const [lx, ly] = xy(i, R + 16)
                return (
                  <g key={k}>
                    <line x1={CX} y1={CY} x2={x} y2={y} stroke="#223a5e" strokeWidth="1" />
                    <text x={lx} y={ly} fill={STAT_DEFS[k].color} fontSize="10" textAnchor="middle" dominantBaseline="middle">
                      {STAT_DEFS[k].label}
                    </text>
                  </g>
                )
              })}
              <polygon points={poly} fill="rgba(68,170,255,0.30)" stroke="#44aaff" strokeWidth="2" />
              {pt.map((v, i) => {
                const [x, y] = xy(i, (v / max) * R)
                return <circle key={i} cx={x} cy={y} r="2.5" fill="#88ccff" />
              })}
            </svg>

            {/* 升目 */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'6px', flex:'1 1 200px' }}>
              {STAT_KEYS.map(k => (
                <div key={k} style={{ background:'#000818', border:'1px solid #223a5e', padding:'8px', textAlign:'center' }}>
                  <div style={{ color:STAT_DEFS[k].color, fontSize:'11px' }}>{STAT_DEFS[k].label}</div>
                  <div style={{ color:'#cfe2ff', fontSize:'14px' }}>{(total[k] || 0).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          {/* スキル */}
          <div style={{ color:'#cfe2ff', fontSize:'12px', margin:'14px 0 6px' }}>スキル</div>
          {Array.from({ length: 5 }).map((_, i) => {
            const e = (prof.skill_set || [])[i]
            const s = e && SKILL_BY_NAME[e.name]
            return (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'3px' }}>
                <span style={{ background:'#1d2a52', color:'#cfe2ff', fontSize:'10px', padding:'3px 6px', minWidth:'54px', textAlign:'center' }}>
                  スキル{i + 1}
                </span>
                {s ? (
                  <span style={{ fontSize:'11px' }}>
                    <span style={{ color:'#cfe2ff' }}>{s.name}</span>
                    <span style={{ color: KIND_COLOR[s.kind], fontSize:'9px', marginLeft:'6px' }}>{KIND_LABEL[s.kind]}</span>
                    {e.uses > 1 && <span style={{ color:'#7f95c4', fontSize:'9px', marginLeft:'6px' }}>×{e.uses}回</span>}
                  </span>
                ) : <span style={{ color:'#7b8fb8', fontSize:'11px' }}>—</span>}
              </div>
            )
          })}
          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'6px' }}>
            <span style={{ background:'#1d2a52', color:'#cfe2ff', fontSize:'10px', padding:'3px 6px', minWidth:'54px', textAlign:'center' }}>職業</span>
            <span style={{ color:'#cfe2ff', fontSize:'11px' }}>{prof.class}</span>
          </div>
        </div>

        <div style={{ padding:'10px', textAlign:'right', borderTop:'1px solid #113' }}>
          <button onClick={onClose} style={{ background:'#000818', border:'1px solid #223a5e', color:'#7f95c4',
            padding:'6px 16px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>閉じる</button>
        </div>
      </div>
    </div>
  )
}
