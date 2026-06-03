import { useState } from 'react'
import { supabase } from '../supabase'

const toJa = (msg = '') => {
  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) return 'メールアドレスまたはパスワードが違います'
  if (msg.includes('Email not confirmed')) return 'メールアドレスが確認されていません。確認メールをご確認ください'
  if (msg.includes('User already registered')) return 'このメールアドレスは既に登録されています'
  if (msg.includes('Password should be at least') || msg.includes('password should be at least')) return 'パスワードは6文字以上にしてください'
  if (msg.includes('same password') || msg.includes('different from the old') || msg.includes('New password should be different')) return '以前と同じパスワードは使用できません'
  if (msg.includes('Unable to validate email address') || msg.includes('invalid email')) return '無効なメールアドレスです'
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('over_email_send_rate_limit')) return 'しばらく時間をおいてから再試行してください'
  if (msg.includes('Token has expired') || msg.includes('token has expired')) return 'リンクの有効期限が切れています。もう一度リセットメールを送ってください'
  if (msg.includes('Auth session missing') || msg.includes('session_not_found')) return 'セッションが見つかりません。ログインしなおしてください'
  if (msg.includes('Email address cannot be used') || msg.includes('email address not authorized')) return 'このメールアドレスは使用できません'
  return 'エラーが発生しました: ' + msg
}

export default function Login({ isPasswordRecovery = false }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isRegister, setIsRegister] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [isForgot, setIsForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')

  const isReset = isPasswordRecovery

  const handleForgot = async (e) => {
    e.preventDefault()
    setLoading(true); setError(''); setMessage('')
    const siteUrl = window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: siteUrl + '/login',
    })
    if (error) setError(toJa(error.message))
    else setMessage('パスワードリセットメールを送りました！メールを確認してください。')
    setLoading(false)
  }

  const handleReset = async (e) => {
    e.preventDefault()
    if (newPassword !== newPassword2) { setError('パスワードが一致しません'); return }
    if (newPassword.length < 6) { setError('パスワードは6文字以上にしてください'); return }
    setLoading(true); setError('')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) { setError(toJa(error.message)) }
    else { setMessage('パスワードを変更しました！ログインしてください。'); await supabase.auth.signOut() }
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
      setError(toJa(err.message || ''))
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
        ) : isForgot ? (
          <>
            <div style={{ color:'#88ccff', textAlign:'center', marginBottom:'20px' }}>パスワードをリセット</div>
            <form onSubmit={handleForgot} style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              <input type="email" placeholder="登録したメールアドレス" value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)} style={inputStyle} required />
              {error && <div style={{ color:'#ff4444', fontSize:'12px' }}>⚠ {error}</div>}
              {message && <div style={{ color:'#44ff88', fontSize:'12px' }}>✓ {message}</div>}
              <button type="submit" disabled={loading}
                style={{ background:'#001840', border:'1px solid #ffcc00', color:'#ffcc00', padding:'10px', cursor:'pointer', fontFamily:'monospace' }}>
                {loading ? '送信中...' : 'リセットメールを送る'}
              </button>
            </form>
            <div style={{ marginTop:'16px', textAlign:'center', fontSize:'12px' }}>
              <span style={{ color:'#0088ff', cursor:'pointer' }}
                onClick={() => { setIsForgot(false); setError(''); setMessage('') }}>
                ← ログインに戻る
              </span>
            </div>
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
            <div style={{ marginTop:'12px', textAlign:'center', fontSize:'12px' }}>
              <span style={{ color:'#0088ff', cursor:'pointer' }}
                onClick={() => { setIsRegister(!isRegister); setError(''); setMessage('') }}>
                {isRegister ? '→ ログインはこちら' : '→ アカウント作成はこちら'}
              </span>
            </div>
            {!isRegister && (
              <div style={{ marginTop:'8px', textAlign:'center', fontSize:'12px' }}>
                <span style={{ color:'#446688', cursor:'pointer' }}
                  onClick={() => { setIsForgot(true); setError(''); setMessage('') }}>
                  パスワードを忘れた方はこちら
                </span>
              </div>
            )}
            <div style={{ marginTop:'16px', border:'1px solid #224400', background:'#0a1400', padding:'10px 12px', fontSize:'11px', color:'#88aa66', lineHeight:'1.8' }}>
              📩 トノサキ・ガルシアへ<br />
              パスワード再設定できるようにしたんで↑押して自分で再設定してください。これまで送ってた怪しいメールは無視してください。
            </div>
          </>
        )}
      </div>
    </div>
  )
}
