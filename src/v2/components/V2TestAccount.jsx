import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../../supabase'
import { box, btn, TEXT } from './v2ui.js'

// バトルフロンティアⅡ（リメイク版）— テスト用アカウントを作る［開発］
// ------------------------------------------------------------
// 取引所のように**2人いないと確かめられない**ものを試すための捨てアカウント。
//   ① 別のクライアントで signUp（★下を見よ）
//   ② v2_dev_create_tester でテスター名簿へ足し、Ⅱのキャラクターと動作確認用のGoldを用意
//
// ★★signUp を **別のクライアント**で叩くのが肝。
//   いつもの supabase で signUp すると、そのタブのセッションが新しい人に入れ替わり、
//   **自分がログアウトされる**。persistSession:false の使い捨てを1つ作って避ける。
//
// ★メールの確認が要る設定なので、**受け取れるアドレス**を入れること。
//   Gmailなら `自分+v2test1@gmail.com` のように + を付ければ自分の受信箱に届く。
//
// ⚠テスターは is_admin ではない（旧版の管理者権限は渡らない）。
//   名簿に足せるのは is_admin だけ＝テスターがテスターを増やすことはできない。

const SUPA_URL = 'https://jxbcuqwqtstxgmpiruuu.supabase.co'
const SUPA_KEY = 'sb_publishable_vlexKdF2oJrIIwMFEA81OA_1XyShoIt'

// 覚えなくていいので長くする。記号は入れない（コピーで事故らないように）
const makePassword = () => {
  const c = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const a = new Uint32Array(24)
  crypto.getRandomValues(a)
  return [...a].map(n => c[n % c.length]).join('')
}

export default function V2TestAccount() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('テスター1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState(null)

  const create = async () => {
    const addr = email.trim()
    if (!addr.includes('@')) { setError('受け取れるメールアドレスを入れてください'); return }
    setBusy(true); setError('')
    const password = makePassword()
    try {
      // ★使い捨てのクライアント。ここで作らないと自分のセッションが飛ぶ
      const tmp = createClient(SUPA_URL, SUPA_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
      const { data, error: upErr } = await tmp.auth.signUp({ email: addr, password })
      if (upErr) { setError(upErr.message); setBusy(false); return }
      const uid = data?.user?.id
      if (!uid) { setError('アカウントは作れたが id が取れなかった'); setBusy(false); return }

      // テスター名簿＋Ⅱのキャラクター＋動作確認用のGold（ここは自分＝管理者の権限で呼ぶ）
      const { data: r, error: rpcErr } = await supabase.rpc('v2_dev_create_tester', {
        p_user_id: uid, p_username: name.trim(),
      })
      if (rpcErr) { setError(rpcErr.message); setBusy(false); return }
      if (!r?.ok) { setError(r?.error || '名簿に足せませんでした'); setBusy(false); return }
      setMade({ email: addr, password, name: name.trim(), gold: r.profile?.gold })
    } catch (err) {
      setError(err.message || String(err))
    }
    setBusy(false)
  }

  return (
    <div style={{ ...box, padding:'14px', marginBottom:'12px' }}>
      <div style={{ color:'#ffaa44', fontSize:'11px', marginBottom:'8px' }}>
        🧪 テスト用アカウント <span style={{ color:'#a89ccc', fontSize:'9px' }}>[開発]</span>
      </div>
      <div style={{ color:TEXT.sub, fontSize:'10px', lineHeight:1.8, marginBottom:'8px' }}>
        取引所のように2人いないと試せないもの用の捨てアカウントです。
        Ⅱには入れますが、旧版の管理者にはなりません。<br />
        ★確認メールが届くので<b>受け取れるアドレス</b>を入れてください（Gmailなら
        <code style={{ color:'#ffcc88' }}>自分+v2test1@gmail.com</code> で自分に届きます）。
      </div>
      <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'8px' }}>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="メールアドレス" type="email"
          style={{ flex:'2 1 220px', background:'#001028', border:'1px solid #0044aa', color:TEXT.body,
            padding:'7px', fontFamily:'monospace', fontSize:'11px' }} />
        <input value={name} onChange={e => setName(e.target.value)} maxLength={16} placeholder="冒険者名"
          style={{ flex:'1 1 120px', background:'#001028', border:'1px solid #0044aa', color:TEXT.body,
            padding:'7px', fontFamily:'monospace', fontSize:'11px' }} />
      </div>
      <button onClick={create} disabled={busy} style={{ ...btn('#ffaa44'), opacity: busy ? 0.4 : 1 }}>
        {busy ? '作成中...' : '＋ テスト用アカウントを作る'}
      </button>
      {error && <div style={{ color:'#ff4444', fontSize:'11px', marginTop:'8px' }}>⚠ {error}</div>}
      {made && (
        <div style={{ marginTop:'10px', padding:'10px', background:'#000818', border:'1px solid #443300',
          fontSize:'11px', lineHeight:1.9, wordBreak:'break-all' }}>
          <div style={{ color:'#ffcc00' }}>作成しました（{made.name}・{(made.gold || 0).toLocaleString()} Gold）</div>
          <div style={{ color:TEXT.label }}>メール</div>
          <div style={{ color:TEXT.bright }}>{made.email}</div>
          <div style={{ color:TEXT.label }}>パスワード</div>
          <div style={{ color:TEXT.bright }}>{made.password}</div>
          <div style={{ color:'#ff8844', marginTop:'6px' }}>
            ★このパスワードは<b>ここにしか出ません</b>。控えてから閉じてください。<br />
            確認メールのリンクを開いたあと、別のブラウザでログインすると2人めとして遊べます。
          </div>
        </div>
      )}
    </div>
  )
}
