import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const PRESET_AVATARS = [
  { id:'warrior1',  label:'戦士①',     url:`${SUPABASE_URL}/storage/v1/object/public/avatars/warrior1.png` },
  { id:'knight1',   label:'騎士',       url:`${SUPABASE_URL}/storage/v1/object/public/avatars/knight1.png` },
  { id:'samurai',   label:'侍',         url:`${SUPABASE_URL}/storage/v1/object/public/avatars/samurai.png` },
  { id:'hunter1',   label:'狩人①',     url:`${SUPABASE_URL}/storage/v1/object/public/avatars/hunter1.png` },
  { id:'hunter2',   label:'狩人②',     url:`${SUPABASE_URL}/storage/v1/object/public/avatars/hunter2.png` },
  { id:'wizard1',   label:'魔法使い①', url:`${SUPABASE_URL}/storage/v1/object/public/avatars/wizard1.png` },
  { id:'wizard2',   label:'魔法使い②', url:`${SUPABASE_URL}/storage/v1/object/public/avatars/wizard2.png` },
  { id:'priest',    label:'僧侶',       url:`${SUPABASE_URL}/storage/v1/object/public/avatars/priest.png` },
]

const UPLOAD_COST = 100

export default function Barber() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [selectedAvatar, setSelectedAvatar] = useState(null)
  const [uploadedAvatars, setUploadedAvatars] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageColor, setMessageColor] = useState('#44ff88')
  const [uploadFile, setUploadFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(p)
    setSelectedAvatar(p.avatar_url)

    // アップロード済み画像を取得
    const { data: files } = await supabase.storage.from('avatars').list(`${user.id}/`)
    if (files) {
      const urls = files.map(f => ({
        name: f.name,
        url: `${SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}/${f.name}`,
      }))
      setUploadedAvatars(urls)
    }
  }

  const showMessage = (msg, color = '#44ff88') => {
    setMessage(msg)
    setMessageColor(color)
    setTimeout(() => setMessage(''), 3000)
  }

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const doUpload = async () => {
    if (!uploadFile) return
    if (profile.gold < UPLOAD_COST) {
      showMessage('ゴールドが足りません！（100G必要）', '#ff4444')
      return
    }
    setLoading(true)
    const ext = uploadFile.name.split('.').pop()
    const fileName = `${Date.now()}.${ext}`
    const filePath = `${profile.id}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, uploadFile, { upsert: true })

    if (uploadError) {
      showMessage('アップロードに失敗しました', '#ff4444')
      setLoading(false)
      return
    }

    const newUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${filePath}`

    // ゴールド消費・アバター更新
    await supabase.from('profiles').update({
      gold: profile.gold - UPLOAD_COST,
      avatar_url: newUrl,
    }).eq('id', profile.id)

    setUploadFile(null)
    setPreviewUrl(null)
    showMessage('アップロード完了！アイコンを変更しました！')
    await fetchAll()
    setLoading(false)
  }

  const saveAvatar = async () => {
    if (!selectedAvatar) return
    setLoading(true)
    await supabase.from('profiles').update({ avatar_url: selectedAvatar }).eq('id', profile.id)
    showMessage('アイコンを変更しました！')
    await fetchAll()
    setLoading(false)
  }

  if (!profile) return (
    <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'#000820', padding:'16px', fontFamily:'monospace' }}>
      <div style={{ maxWidth:'600px', margin:'0 auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #003366', paddingBottom:'8px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'16px', letterSpacing:'3px' }}>BATTLE FRONTIER</div>
          <button onClick={() => nav('/profile')}
            style={{ background:'none', border:'1px solid #446688', color:'#446688', padding:'4px 10px', cursor:'pointer', fontFamily:'monospace', fontSize:'11px' }}>
            ← プロフィールへ
          </button>
        </div>

        <div style={{ color:'#ff88cc', fontSize:'14px', marginBottom:'4px' }}>✂ 美容院</div>
        <div style={{ color:'#446688', fontSize:'11px', marginBottom:'12px' }}>
          所持金: <span style={{color:'#ffcc00'}}>{profile.gold}G</span>
        </div>

        {message && (
          <div style={{ color: messageColor, fontSize:'12px', padding:'8px', border:`1px solid ${messageColor}`, marginBottom:'12px', textAlign:'center' }}>
            {message}
          </div>
        )}

        {/* 現在のアイコン */}
        <div style={{ border:'1px solid #003366', background:'#001028', padding:'12px', marginBottom:'12px', textAlign:'center' }}>
          <div style={{ color:'#446688', fontSize:'11px', marginBottom:'8px' }}>現在のアイコン</div>
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="current"
              style={{ width:'80px', height:'80px', objectFit:'cover', border:'2px solid #ffcc00' }} />
          ) : (
            <div style={{ width:'80px', height:'80px', border:'2px solid #446688', background:'#001028', display:'flex', alignItems:'center', justifyContent:'center', color:'#446688', fontSize:'24px', margin:'0 auto' }}>
              👤
            </div>
          )}
        </div>

        {/* プリセット選択 */}
        <div style={{ border:'1px solid #003366', background:'#001028', padding:'12px', marginBottom:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'8px' }}>プリセットから選ぶ（無料）</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'6px', marginBottom:'10px' }}>
            {PRESET_AVATARS.map(a => (
              <div key={a.id} onClick={() => setSelectedAvatar(a.url)}
                style={{ cursor:'pointer', border:`2px solid ${selectedAvatar === a.url ? '#ffcc00' : '#003366'}`,
                  background: selectedAvatar === a.url ? '#1a1000' : '#000818', padding:'4px', textAlign:'center' }}>
                <img src={a.url} alt={a.label}
                  style={{ width:'100%', aspectRatio:'1', objectFit:'cover' }}
                  onError={e => { e.target.style.display='none' }} />
                <div style={{ color: selectedAvatar === a.url ? '#ffcc00' : '#446688', fontSize:'9px', marginTop:'2px' }}>{a.label}</div>
              </div>
            ))}
          </div>

          {/* アップロード済み画像 */}
          {uploadedAvatars.length > 0 && (
            <>
              <div style={{ color:'#446688', fontSize:'11px', marginBottom:'6px' }}>アップロード済み画像</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'6px', marginBottom:'10px' }}>
                {uploadedAvatars.map(a => (
                  <div key={a.name} onClick={() => setSelectedAvatar(a.url)}
                    style={{ cursor:'pointer', border:`2px solid ${selectedAvatar === a.url ? '#ffcc00' : '#003366'}`,
                      background: selectedAvatar === a.url ? '#1a1000' : '#000818', padding:'4px' }}>
                    <img src={a.url} alt={a.name}
                      style={{ width:'100%', aspectRatio:'1', objectFit:'cover' }} />
                  </div>
                ))}
              </div>
            </>
          )}

          <button onClick={saveAvatar} disabled={loading || selectedAvatar === profile.avatar_url}
            style={{ width:'100%', padding:'8px', background:'#1a1000', border:'1px solid #ffcc00', color:'#ffcc00', cursor:'pointer', fontFamily:'monospace', fontSize:'12px', opacity: selectedAvatar === profile.avatar_url ? 0.4 : 1 }}>
            このアイコンに変更する
          </button>
        </div>

        {/* 画像アップロード */}
        <div style={{ border:'1px solid #003366', background:'#001028', padding:'12px' }}>
          <div style={{ color:'#ffcc00', fontSize:'12px', marginBottom:'4px' }}>画像をアップロードする</div>
          <div style={{ color:'#446688', fontSize:'10px', marginBottom:'8px' }}>
            100Gで自分の画像をアップロードできます。アップロード後は無料で切り替え可能。
          </div>

          {previewUrl && (
            <div style={{ textAlign:'center', marginBottom:'8px' }}>
              <img src={previewUrl} alt="preview"
                style={{ width:'80px', height:'80px', objectFit:'cover', border:'1px solid #446688' }} />
              <div style={{ color:'#446688', fontSize:'10px', marginTop:'4px' }}>プレビュー</div>
            </div>
          )}

          <input type="file" accept="image/*" onChange={handleFileSelect}
            style={{ color:'#88ccff', fontSize:'11px', marginBottom:'8px', width:'100%' }} />

          <button onClick={doUpload} disabled={!uploadFile || loading || profile.gold < UPLOAD_COST}
            style={{ width:'100%', padding:'8px', background: uploadFile && profile.gold >= UPLOAD_COST ? '#001830' : '#001',
              border:`1px solid ${uploadFile && profile.gold >= UPLOAD_COST ? '#ff88cc' : '#003366'}`,
              color: uploadFile && profile.gold >= UPLOAD_COST ? '#ff88cc' : '#334455',
              cursor: uploadFile && profile.gold >= UPLOAD_COST ? 'pointer' : 'not-allowed',
              fontFamily:'monospace', fontSize:'12px' }}>
            📤 アップロードする（100G）
          </button>
          {profile.gold < UPLOAD_COST && (
            <div style={{ color:'#ff4444', fontSize:'10px', marginTop:'4px', textAlign:'center' }}>ゴールドが足りません</div>
          )}
        </div>
      </div>
    </div>
  )
}