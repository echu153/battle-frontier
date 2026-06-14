import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, useRef, lazy, Suspense } from 'react'
import { supabase } from './supabase'
import Login from './pages/Login' // 最初に出る画面は即時読み込み（チラつき防止）
import ErrorBoundary from './components/ErrorBoundary'
// 以下はページを開いた時に読み込む（コード分割＝初回ロードを軽く）
const CharCreate = lazy(() => import('./pages/CharCreate'))
const Game = lazy(() => import('./pages/Game'))
const Ranking = lazy(() => import('./pages/Ranking'))
const Equipment = lazy(() => import('./pages/Equipment'))
const Skills = lazy(() => import('./pages/Skills'))
const Shop = lazy(() => import('./pages/Shop'))
const Smithy = lazy(() => import('./pages/Smithy'))
const Profile = lazy(() => import('./pages/Profile'))
const Barber = lazy(() => import('./pages/Barber'))
const Fishing = lazy(() => import('./pages/Fishing'))
const Casino = lazy(() => import('./pages/Casino'))
const Museum = lazy(() => import('./pages/Museum'))
const RaidBoss = lazy(() => import('./pages/RaidBoss'))
const Exchange = lazy(() => import('./pages/Exchange'))
const Titles = lazy(() => import('./pages/Titles'))
const Admin = lazy(() => import('./pages/Admin'))
const Moderation = lazy(() => import('./pages/Moderation'))
const Scarecrow = lazy(() => import('./pages/Scarecrow'))
const Dungeon = lazy(() => import('./pages/Dungeon'))
const Pets = lazy(() => import('./pages/Pets'))
const Charms = lazy(() => import('./pages/Charms'))
const PetStorage = lazy(() => import('./pages/PetStorage'))
const StatusDetail = lazy(() => import('./pages/StatusDetail'))
const Abyss = lazy(() => import('./pages/Abyss'))
const Tenkyuu = lazy(() => import('./pages/Tenkyuu'))
const Alchemy = lazy(() => import('./pages/Alchemy'))

function App() {
  const [session, setSession] = useState(undefined)
  const [hasChar, setHasChar] = useState(undefined)
  const [suspended, setSuspended] = useState(false)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const recoveryRef = useRef(false)

  // 強制リロード機構：app_config.reload_tokenが変わったら全員のページを1回リロード
  useEffect(() => {
    const KEY = 'bf_reloadToken'
    const check = async () => {
      const { data } = await supabase.from('app_config').select('reload_token').eq('id', 1).single()
      if (!data) return
      const token = String(data.reload_token)
      const stored = localStorage.getItem(KEY)
      if (stored === null) { localStorage.setItem(KEY, token); return }
      if (stored !== token) {
        localStorage.setItem(KEY, token)
        window.location.reload()
      }
    }
    check()
    const id = setInterval(check, 60000)
    return () => clearInterval(id)
  }, [])

  // 同時接続数カウント用ハートビート：ログイン中＆タブ表示中のみ2分おきに記録
  useEffect(() => {
    if (!session) return
    const beat = () => {
      if (document.hidden) return
      supabase.rpc('heartbeat').then(() => {}, () => {})
    }
    beat()
    const id = setInterval(beat, 120000)
    const onVisible = () => { if (!document.hidden) beat() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) checkChar(session.user.id)
      else setHasChar(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryRef.current = true
        setIsPasswordRecovery(true)
        setSession(s)
        return
      }
      if (event === 'SIGNED_OUT') {
        recoveryRef.current = false
        setIsPasswordRecovery(false)
        setSession(null)
        setHasChar(false)
        return
      }
      // PASSWORD_RECOVERY後のSIGNED_INなどは無視
      if (recoveryRef.current) return
      setSession(s)
      if (s) checkChar(s.user.id)
      else setHasChar(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const checkChar = async (userId) => {
    const { data } = await supabase.from('profiles').select('id, is_suspended, suspension_reason').eq('id', userId).single()
    if (data?.is_suspended) {
      setSuspended(true)
      await supabase.auth.signOut()
      return
    }
    setHasChar(!!data)
  }

  if (session === undefined || hasChar === undefined) {
    return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  }

  if (suspended) {
    return (
      <div style={{ minHeight:'100vh', background:'#000820', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'monospace' }}>
        <div style={{ border:'1px solid #880000', background:'#1a0000', padding:'32px', maxWidth:'400px', textAlign:'center' }}>
          <div style={{ color:'#ff4444', fontSize:'18px', letterSpacing:'2px', marginBottom:'16px' }}>⛔ アカウント停止</div>
          <div style={{ color:'#cc4444', fontSize:'13px', lineHeight:'1.8' }}>
            不正行為を確認したため現在アカウントを停止しています。<br />管理者までご連絡ください。
          </div>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <ErrorBoundary>
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#000820', color: '#0088ff', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>読み込み中...</div>}>
      <Routes>
        <Route path="/login" element={isPasswordRecovery || !session ? <Login isPasswordRecovery={isPasswordRecovery} /> : <Navigate to={hasChar ? '/game' : '/create'} />} />
        <Route path="/create" element={session && !hasChar ? <CharCreate /> : <Navigate to={!session ? '/login' : '/game'} />} />
        <Route path="/game" element={session && hasChar ? <Game /> : <Navigate to={!session ? '/login' : '/create'} />} />
        <Route path="/ranking" element={session ? <Ranking /> : <Navigate to="/login" />} />
        <Route path="/equipment" element={session ? <Equipment /> : <Navigate to="/login" />} />
        <Route path="/skills" element={session ? <Skills /> : <Navigate to="/login" />} />
        <Route path="/shop" element={session ? <Shop /> : <Navigate to="/login" />} />
        <Route path="/smithy" element={session ? <Smithy /> : <Navigate to="/login" />} />
        <Route path="/profile" element={session ? <Profile /> : <Navigate to="/login" />} />
        <Route path="/profile/:playerId" element={session ? <Profile /> : <Navigate to="/login" />} />
        <Route path="/barber" element={session ? <Barber /> : <Navigate to="/login" />} />
        <Route path="/fishing" element={session ? <Fishing /> : <Navigate to="/login" />} />
        <Route path="/casino" element={session ? <Casino /> : <Navigate to="/login" />} />
        <Route path="/museum" element={session ? <Museum /> : <Navigate to="/login" />} />
        <Route path="/raid" element={session ? <RaidBoss /> : <Navigate to="/login" />} />
        <Route path="/exchange" element={session ? <Exchange /> : <Navigate to="/login" />} />
        <Route path="/titles" element={session ? <Titles /> : <Navigate to="/login" />} />
        <Route path="/admin" element={session ? <Admin /> : <Navigate to="/login" />} />
        <Route path="/moderation" element={session ? <Moderation /> : <Navigate to="/login" />} />
        <Route path="/scarecrow" element={session ? <Scarecrow /> : <Navigate to="/login" />} />
        <Route path="/dungeon" element={session ? <Dungeon /> : <Navigate to="/login" />} />
        <Route path="/pets" element={session ? <Pets /> : <Navigate to="/login" />} />
        <Route path="/charms" element={session ? <Charms /> : <Navigate to="/login" />} />
        <Route path="/pet-storage" element={session ? <PetStorage /> : <Navigate to="/login" />} />
        <Route path="/status" element={session ? <StatusDetail /> : <Navigate to="/login" />} />
        <Route path="/abyss" element={session ? <Abyss /> : <Navigate to="/login" />} />
        <Route path="/tenkyuu" element={session ? <Tenkyuu /> : <Navigate to="/login" />} />
        <Route path="/alchemy" element={session ? <Alchemy /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
