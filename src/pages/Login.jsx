import { useState, useEffect } from 'react'
import { supabase } from '../supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  // パスワードリセットモード
  const [isReset, setIsReset] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')

  useEffect(() => {
    // リセットリンクからの遷移を検知
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsReset(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleReset = async (e) => {
    e.preventDefault()
    if (newPassword !== newPassword2) { setError('パスワードが一致しません'); return }
    if (newPassword.length < 6) { setError('パスワードは6文字以上にしてください'); return }
    setLoading(true); setError('')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) { setError(error.message) }
    else { setMessage('パスワードを変更しました！ログインしてください。'); setIsReset(false) }
    setLoading(false)
  }

  const handle = async (e) => {
    e.preventDefault()
    setLoading(true); setError(''); setMessage('')
    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMessage('確認メールを送りました！メールのリンクをクリックしてください。')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const inputStyle = { background:'#001028', border:'1px solid #0044aa', color:'#88ccff', padding:'8px', fontFamily:'monospace' }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#000820' }}>
      <div style={{ border:'1px solid #0044aa', background:'#001040', padding:'30px', width:'320px' }}>
        <div style={{ color:'#ffcc00', textAlign:'center', fontSize:'20px', marginBottom:'20px', letterSpacing:'3px' }}>
          BATTLE FRONTIER
        </div>

        {/* パスワードリセットフォーム */}
        {isReset ? (
          <>
            <div style={{ color:'#88ccff', textAlign:'center', marginBottom:'20px' }}>新しいパスワードを設定</div>
            <form onSubmit={handleReset} style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              <input type="password" placeholder="新しいパスワード" value={newPassword}
                onChange={e => setNewPassword(e.target.value)} style={inputStyle} required />
              <input type="password" placeholder="パスワードをもう一度" value={newPassword2}
                onChange={e => setNewPassword2(e.target.value)} style={inputStyle} required />
              {error && <div style={{ color:'#ff4444', fontSize:'12px' }}>⚠ {error}</div>}
              {message && <div style={{ color:'#44ff88', fontSize:'12px' }}>✓ {message}</div>}
              <button type="submit" disabled={loading}
                style={{ background:'#001840', border:'1px solid #ffcc00', color:'#ffcc00', padding:'10px', cursor:'pointer', fontFamily:'monospace' }}>
                {loading ? '処理中...' : 'パスワードを変更する'}
              </button>
            </form>
          </>
        ) : (
          <>
            <div style={{ color:'#88ccff', textAlign:'center', marginBottom:'20px' }}>
              {isRegister ? '新規登録' : 'ログイン'}
            </div>
            <form onSubmit={handle} style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              <input type="email" placeholder="メールアドレス" value={email}
                onChange={e => setEmail(e.target.value)} style={inputStyle} required />
              <input type="password" placeholder="パスワード" value={password}
                onChange={e => setPassword(e.target.value)} style={inputStyle} required />
              {error && <div style={{ color:'#ff4444', fontSize:'12px' }}>⚠ {error}</div>}
              {message && <div style={{ color:'#44ff88', fontSize:'12px' }}>✓ {message}</div>}
              <button type="submit" disabled={loading}
                style={{ background:'#001840', border:'1px solid #ffcc00', color:'#ffcc00', padding:'10px', cursor:'pointer', fontFamily:'monospace' }}>
                {loading ? '処理中...' : (isRegister ? '登録する' : 'ログイン')}
              </button>
            </form>
            <div style={{ marginTop:'16px', textAlign:'center', fontSize:'12px' }}>
              <span style={{ color:'#0088ff', cursor:'pointer' }}
                onClick={() => { setIsRegister(!isRegister); setError(''); setMessage('') }}>
                {isRegister ? '→ ログインはこちら' : '→ アカウント作成はこちら'}
              </span>
            </div>
            <div style={{ marginTop:'16px', border:'1px solid #224400', background:'#0a1400', padding:'10px 12px', fontSize:'11px', color:'#88aa66', lineHeight:'1.8' }}>
              📩 トノサキ・ガルシアへ<br />
              登録したメアド（jgから始まるやつ）にパスワード再発行メールを送りました。メールを確認して登録しなおしてください。
            </div>
          </>
        )}
      </div>
    </div>
  )
}
