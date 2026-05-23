import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Login from './pages/Login'
import CharCreate from './pages/CharCreate'
import Game from './pages/Game'

function App() {
  const [session, setSession] = useState(undefined)
  const [hasChar, setHasChar] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) checkChar(session.user.id)
      else setHasChar(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) checkChar(s.user.id)
      else setHasChar(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const checkChar = async (userId) => {
    const { data } = await supabase.from('profiles').select('id').eq('id', userId).single()
    setHasChar(!!data)
  }

  if (session === undefined || hasChar === undefined) {
    return <div style={{ color:'#0088ff', textAlign:'center', marginTop:'40vh' }}>読み込み中...</div>
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to={hasChar ? '/game' : '/create'} />} />
        <Route path="/create" element={session && !hasChar ? <CharCreate /> : <Navigate to={!session ? '/login' : '/game'} />} />
        <Route path="/game" element={session && hasChar ? <Game /> : <Navigate to={!session ? '/login' : '/create'} />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App