import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabase'
import { box, btn, miniBtn, TEXT } from '../../v2/components/v2ui.js'
import { AVATAR_PRESETS, AVATAR_MAX_BYTES, uploadPathOf } from '../lib/avatar.js'
import { stageColorOf } from '../lib/jobs.js'
import { avatarUrlOf } from './v2capAvatarUrl.js'

// ============================================================
// 「レベルキャップあり」版 — プロフィール（アイコンを設定する）
//   【確定】2026-10-11 ユーザー指示「自分で設定できるように」：
//   ・用意された8枚（旧版・今のⅡと同じ）から選ぶ／前にアップロードした画像から選ぶ／新しくアップロードする（無料・2MBまで）
//   ・画像の置き場は avatars バケット（自分のフォルダ <ユーザーID>/）。サーバーは「8枚か自分のフォルダ」だけ通す
//   作りは今のⅡの V2Profile のアイコン選びと同じ（アップロードした画像は旧版・今のⅡと同じフォルダに並ぶ）
// ============================================================
const THUMB = { width:'64px', height:'64px', objectFit:'cover', display:'block' }

export default function V2capProfile({ prof, onProfile }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)          // { text, ok }
  const [uploaded, setUploaded] = useState([])  // 自分のフォルダの画像（新しい順）
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const uploading = useRef(false)               // 連打での二重アップロード対策
  const fileRef = useRef(null)

  // 自分のフォルダの画像を読む（旧版・今のⅡでアップロードしたものも並ぶ）
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.storage.from('avatars').list(user.id, { limit: 60, sortBy: { column:'created_at', order:'desc' } })
      if (!alive || !data) return
      setUploaded(data.filter(f => f.name && !f.name.startsWith('.')).map(f => `${user.id}/${f.name}`))
    })()
    return () => { alive = false }
  }, [prof.avatar])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const setAvatar = async (path, done) => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('v2cap_set_avatar', { p_path: path })
    if (error || !data?.ok) { setBusy(false); setMsg({ text: error?.message || data?.error || '変更できませんでした' }); return false }
    await onProfile(null)
    setBusy(false)
    setMsg({ text: done || (path ? 'アイコンを変えました' : 'アイコンを外しました'), ok: true })
    return true
  }

  const chooseFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) { setMsg({ text:'画像ファイルを選んでください' }); return }
    if (f.size > AVATAR_MAX_BYTES) { setMsg({ text:'2MBまでの画像にしてください' }); return }
    setFile(f); setPreview(URL.createObjectURL(f)); setMsg(null)
  }
  const upload = async () => {
    if (!file || uploading.current) return
    uploading.current = true; setBusy(true); setMsg(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const path = uploadPathOf(user.id, file.name)
      const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (error) { setMsg({ text:`アップロードできませんでした（${error.message}）` }); return }
      const ok = await setAvatar(path, 'アップロードしてアイコンにしました')
      if (ok) { setFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = '' }
    } finally { setBusy(false); uploading.current = false }
  }

  const current = avatarUrlOf(prof.avatar)
  const pick = (path) => { if (!busy && path !== prof.avatar) setAvatar(path) }
  const thumbBox = (on) => ({ padding:'3px', background:'#000818', border:`1px solid ${on ? '#ffcc00' : '#002244'}`, cursor: busy ? 'wait' : 'pointer' })

  return (
    <div style={{ fontFamily:'monospace' }}>
      <div style={{ ...box, padding:'12px', marginBottom:'10px', display:'flex', alignItems:'center', gap:'12px' }}>
        {current
          ? <img src={current} alt="" style={{ width:'96px', height:'96px', objectFit:'cover', flexShrink:0 }} onError={e => { e.target.style.display = 'none' }} />
          : <div style={{ width:'96px', height:'96px', flexShrink:0, border:'1px dashed #223a5e', color: TEXT.empty, fontSize:'10px', display:'flex', alignItems:'center', justifyContent:'center' }}>画像なし</div>}
        <div style={{ minWidth:0 }}>
          <div style={{ color:'#ffcc00', fontSize:'14px' }}>{prof.username}</div>
          <div style={{ fontSize:'11px', color:'#9ec2e6', marginTop:'2px' }}>
            <span style={{ color: stageColorOf(prof.class) }}>{prof.class}</span>　LV{prof.lv}
          </div>
          {prof.avatar && (
            <button onClick={() => setAvatar(null)} disabled={busy} style={{ ...miniBtn('#aa5566'), marginTop:'8px' }}>アイコンを外す</button>
          )}
        </div>
      </div>

      <div style={{ ...box, padding:'12px', marginBottom:'10px' }}>
        <div style={{ color:'#88aaff', fontSize:'12px', marginBottom:'8px' }}>🖼 用意されたアイコン</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
          {AVATAR_PRESETS.map(p => (
            <button key={p.file} onClick={() => pick(p.file)} title={p.label} style={thumbBox(prof.avatar === p.file)}>
              <img src={avatarUrlOf(p.file)} alt={p.label} style={THUMB} />
              <div style={{ color: TEXT.sub, fontSize:'9px', marginTop:'2px', textAlign:'center' }}>{p.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color:'#88aaff', fontSize:'12px', marginBottom:'6px' }}>📤 自分の画像</div>
        <div style={{ color: TEXT.sub, fontSize:'10px', marginBottom:'8px', lineHeight:1.7 }}>
          画像をアップロードしてアイコンにできます（無料・2MBまで）。前にアップロードした画像は下から選べます（旧版・今のⅡで上げたものも並びます）。
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap', marginBottom:'8px' }}>
          <input ref={fileRef} type="file" accept="image/*" onChange={chooseFile} disabled={busy}
            style={{ color: TEXT.sub, fontSize:'11px', maxWidth:'100%' }} />
          {preview && <img src={preview} alt="" style={{ width:'48px', height:'48px', objectFit:'cover' }} />}
          {file && (
            <button onClick={upload} disabled={busy} style={btn('#ffcc00')}>{busy ? 'アップロード中...' : 'アップロードしてアイコンにする'}</button>
          )}
        </div>
        {uploaded.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
            {uploaded.map(path => (
              <button key={path} onClick={() => pick(path)} style={thumbBox(prof.avatar === path)}>
                <img src={avatarUrlOf(path)} alt="" style={THUMB} onError={e => { e.target.parentElement.style.display = 'none' }} />
              </button>
            ))}
          </div>
        )}
      </div>
      {msg && <div style={{ color: msg.ok ? '#44ff88' : '#ff8844', fontSize:'11px', marginTop:'8px' }}>{msg.ok ? '' : '⚠ '}{msg.text}</div>}
    </div>
  )
}
