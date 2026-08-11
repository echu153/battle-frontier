import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, useRef, lazy, Suspense } from 'react'
import { supabase } from './supabase'
import Login from './pages/Login' // 最初に出る画面は即時読み込み（チラつき防止）
import ErrorBoundary from './components/ErrorBoundary'
import { InviteListener } from './components/InviteListener'
// 動的import(コード分割)の失敗を自動リカバリ。多くは新デプロイで旧タブのチャンクハッシュが変わり、
// ページ遷移の import が404して「クリックしても何も起きない(空白)」になるケース。
// 直近10秒以内に未リロードなら1回だけ強制リロードして最新版を取り直す（リロードループ防止）。
function lazyReload(factory) {
  return lazy(() => factory().catch((err) => {
    try {
      const now = Date.now()
      const last = Number(sessionStorage.getItem('bf_chunk_reload_at') || 0)
      if (now - last > 10000) {
        sessionStorage.setItem('bf_chunk_reload_at', String(now))
        window.location.reload()
        return new Promise(() => {}) // リロード中は解決させない
      }
    } catch { /* sessionStorage不可でも下でthrow */ }
    throw err
  }))
}
// 以下はページを開いた時に読み込む（コード分割＝初回ロードを軽く）
const CharCreate = lazyReload(() => import('./pages/CharCreate'))
const Game = lazyReload(() => import('./pages/Game'))
const Ranking = lazyReload(() => import('./pages/Ranking'))
const Equipment = lazyReload(() => import('./pages/Equipment'))
const Skills = lazyReload(() => import('./pages/Skills'))
const Shop = lazyReload(() => import('./pages/Shop'))
const Smithy = lazyReload(() => import('./pages/Smithy'))
const Profile = lazyReload(() => import('./pages/Profile'))
const Barber = lazyReload(() => import('./pages/Barber'))
const Fishing = lazyReload(() => import('./pages/Fishing'))
const Casino = lazyReload(() => import('./pages/Casino'))
const Museum = lazyReload(() => import('./pages/Museum'))
const RaidBoss = lazyReload(() => import('./pages/RaidBoss'))
const Exchange = lazyReload(() => import('./pages/Exchange'))
const Titles = lazyReload(() => import('./pages/Titles'))
const Admin = lazyReload(() => import('./pages/Admin'))
const Moderation = lazyReload(() => import('./pages/Moderation'))
const Scarecrow = lazyReload(() => import('./pages/Scarecrow'))
const Dungeon = lazyReload(() => import('./pages/Dungeon'))
const Pets = lazyReload(() => import('./pages/Pets'))
const Charms = lazyReload(() => import('./pages/Charms'))
const PetStorage = lazyReload(() => import('./pages/PetStorage'))
const StatusDetail = lazyReload(() => import('./pages/StatusDetail'))
const Abyss = lazyReload(() => import('./pages/Abyss'))
const Tower = lazyReload(() => import('./pages/Tower'))
const Tenkyuu = lazyReload(() => import('./pages/Tenkyuu'))
const Hachigoku = lazyReload(() => import('./pages/Hachigoku')) // 八獄(開発限定・紋章育成コンテンツ)
const Emblem = lazyReload(() => import('./pages/Emblem')) // 紋章(開発限定・第5の装備枠)
const Alchemy = lazyReload(() => import('./pages/Alchemy'))
const Basecamp = lazyReload(() => import('./pages/Basecamp')) // 拠点(開発限定・仲間を配置する放置コンテンツ)
const Idle = lazyReload(() => import('./pages/Idle'))
const Territory = lazyReload(() => import('./pages/Territory'))
const War = lazyReload(() => import('./pages/War'))
const Marketplace = lazyReload(() => import('./pages/Marketplace'))
const Event = lazyReload(() => import('./pages/Event'))
const ActionRpg = lazyReload(() => import('./action-rpg/ActionRpgPage')) // アクションRPGプロト(認証不要・独立)
const CardGame = lazyReload(() => import('./pages/CardGame')) // 幻札バトル(開発限定・カードゲーム)
const Othello = lazyReload(() => import('./pages/Othello')) // オセロ(開発限定・ミニゲーム)
const Mahjong = lazyReload(() => import('./pages/Mahjong')) // 麻雀(開発限定・ミニゲーム)
const Cards = lazyReload(() => import('./pages/Cards')) // トランプ広場(開発限定・大富豪/スピード/7ならべ/ババ抜き)
const BeginnerBingo = lazyReload(() => import('./pages/BeginnerBingo')) // 初心者ビンゴ(開発限定・ミッション)

// ページ遷移時の「読み込み中」(Suspense fallback)。チャンク取得がハング/失敗して一定時間
// 解決しない＝固まった場合の保険として、1回だけ最新版を取り直す(強制リロード)。
// lazyReloadはimportがreject時のみ効くため、ハングや直近リロード済みで固まったケースをここで救う。
// 30秒ガードでリロードループを防止(リロード後も固まるなら再リロードせず表示のまま)。
function LoadingFallback() {
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const now = Date.now()
        const last = Number(sessionStorage.getItem('bf_stuck_reload_at') || 0)
        if (now - last > 30000) {
          sessionStorage.setItem('bf_stuck_reload_at', String(now))
          window.location.reload()
        }
      } catch { /* sessionStorage不可なら何もしない */ }
    }, 10000)
    return () => clearTimeout(t)
  }, [])
  return <div style={{ minHeight: '100vh', background: '#000820', color: '#0088ff', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>読み込み中...</div>
}

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
    }).catch(() => {
      // getSession失敗時もロード画面(session/hasChar=undefined)で固まらせない＝ログインへ
      setSession(null); setHasChar(false)
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

  // ルートのプリフェッチ：ログイン後のアイドル時間に主要ページのJSを先読みする。
  // 遷移時に出る「読み込み中」(チャンク取得待ち)を消し、SWの資産キャッシュも温める。
  // lazy() と同じ動的importなのでバンドラがdedupe＝二重取得にならない。
  useEffect(() => {
    if (!session || !hasChar) return
    const thunks = [
      () => import('./pages/Pets'),
      () => import('./pages/Dungeon'),
      () => import('./pages/Shop'),
      () => import('./pages/Equipment'),
      () => import('./pages/Skills'),
      () => import('./pages/Smithy'),
      () => import('./pages/Fishing'),
      () => import('./pages/Casino'),
      () => import('./pages/RaidBoss'),
      () => import('./pages/Exchange'),
      () => import('./pages/Ranking'),
      () => import('./pages/Profile'),
      () => import('./pages/Alchemy'),
      () => import('./pages/Titles'),
      () => import('./pages/Museum'),
      () => import('./pages/Abyss'),
      () => import('./pages/Tenkyuu'),
      () => import('./pages/Territory'),
    ]
    let i = 0
    let cancelled = false
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300))
    const cancel = window.cancelIdleCallback || clearTimeout
    let handle
    const run = () => {
      if (cancelled || i >= thunks.length) return
      thunks[i++]().catch(() => {})
      handle = idle(run)
    }
    handle = idle(run)
    return () => { cancelled = true; if (handle != null) cancel(handle) }
  }, [session, hasChar])

  // キャラ有無の判定。profilesクエリがネット瞬断/ハングで失敗すると hasChar が undefined の
  // まま「読み込み中」で永久に固まる穴があったため、タイムアウト＋リトライ＋最終フォールバックで
  // 必ず hasChar を確定させる(リロード時の固まりの主因)。
  const checkChar = async (userId, attempt = 0) => {
    const withTimeout = (p, ms) => Promise.race([
      p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ])
    try {
      const { data, error } = await withTimeout(
        supabase.from('profiles').select('id, is_suspended, suspension_reason').eq('id', userId).maybeSingle(),
        8000,
      )
      if (error) throw error
      if (data?.is_suspended) {
        setSuspended(true)
        await supabase.auth.signOut()
        return
      }
      setHasChar(!!data)  // 行なし(新規)=false→/create、行あり=true
    } catch {
      // 取得失敗(瞬断/タイムアウト)。数回リトライし、それでもダメなら固まらせず先へ進める
      // (セッションあり=作成済みとみなす。誤判定でも各ページが/createへ誘導する)。
      if (attempt < 3) { setTimeout(() => checkChar(userId, attempt + 1), 1500); return }
      setHasChar(true)
    }
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
      {session && <InviteListener userId={session.user.id} />}
      <Suspense fallback={<LoadingFallback />}>
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
        <Route path="/tower" element={session ? <Tower /> : <Navigate to="/login" />} />
        <Route path="/tenkyuu" element={session ? <Tenkyuu /> : <Navigate to="/login" />} />
        <Route path="/hachigoku" element={session ? <Hachigoku /> : <Navigate to="/login" />} />
        <Route path="/emblem" element={session ? <Emblem /> : <Navigate to="/login" />} />
        <Route path="/alchemy" element={session ? <Alchemy /> : <Navigate to="/login" />} />
        <Route path="/basecamp" element={session ? <Basecamp /> : <Navigate to="/login" />} />
        <Route path="/idle" element={session ? <Idle /> : <Navigate to="/login" />} />
        <Route path="/territory" element={session ? <Territory /> : <Navigate to="/login" />} />
        <Route path="/war" element={session ? <War /> : <Navigate to="/login" />} />
        <Route path="/marketplace" element={session ? <Marketplace /> : <Navigate to="/login" />} />
        <Route path="/event" element={session ? <Event /> : <Navigate to="/login" />} />
        <Route path="/action-rpg" element={session ? <ActionRpg /> : <Navigate to="/login" />} />
        <Route path="/card-battle" element={session ? <CardGame /> : <Navigate to="/login" />} />
        <Route path="/othello" element={session ? <Othello /> : <Navigate to="/login" />} />
        <Route path="/mahjong" element={session ? <Mahjong /> : <Navigate to="/login" />} />
        <Route path="/cards" element={session ? <Cards /> : <Navigate to="/login" />} />
        <Route path="/bingo" element={session ? <BeginnerBingo /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
