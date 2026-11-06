// v2cap：サブ垢の見張り（2026-11-06）
// 【確定】2026-11-06 ユーザー「複数アカウント作れないようにしたい・同じIPアドレスからアカウント作成は1個しかできないみたいなことできる？」→
//   選んだのは「① 記録して見張る」だけ（同じIPで作れなくする・24時間に1キャラ・救援の穴をふさぐ は選ばなかった）。
//   ・止めない。ホームを開いたときとキャラを作った直後に、端末の印をサーバーへ送る（IPはサーバーが頼みの見出しから読む）
//   ・サーバーは IP も端末の印も元に戻せない形（塩を混ぜた sha256）で残す＝supabase_v2cap_core.sql §4-2
//   ・管理者は開発用の「サブ垢の見張り」（V2capAltWatch.jsx）で、同じ端末・同じIPのキャラの組みを見て、止めるかを人が決める

// 端末の印を覚えておくキー。消されたら次に開いたときに作り直す（＝別の端末に見える。見張りなのでそれでよい）
export const DEVICE_KEY = 'v2cap:device'
// サーバーが受け取る形（これ以外の形は残さない）と同じ
export const DEVICE_RE = /^[A-Za-z0-9-]{8,64}$/

const randomId = () => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID() } catch { /* 古いブラウザ */ }
  let s = ''
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

// この端末の印。無ければ作って覚える。覚えられない（シークレットモードなど）ときは null＝送らない
export function deviceMark(storage = globalThis.localStorage) {
  try {
    const have = storage?.getItem(DEVICE_KEY)
    if (have && DEVICE_RE.test(have)) return have
    const id = randomId()
    storage.setItem(DEVICE_KEY, id)
    return storage.getItem(DEVICE_KEY) === id ? id : null
  } catch {
    return null
  }
}

// ===== 管理者の一覧（v2cap_watch_pairs の1組）=====
// 強さ：同じ端末＝同じ人の見込みが高い。同じIPだけ＝家族やスマホ回線の他人のこともある
export function pairStrength(p) {
  if (p?.device) return { key: 'strong', label: '同じ端末', color: '#ff6666' }
  if ((p?.rescue || 0) > 0) return { key: 'mid', label: '同じIP＋救援', color: '#ffaa44' }
  return { key: 'weak', label: '同じIPだけ', color: '#c8b46a' }
}

// 「11/06」の形（日本時間）。無ければ「—」
export function shortDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const j = new Date(d.getTime() + 9 * 3600000)
  return `${String(j.getUTCMonth() + 1).padStart(2, '0')}/${String(j.getUTCDate()).padStart(2, '0')}`
}

// 組みの中で分かったこと（並びは強い順）
export function pairFacts(p) {
  const out = []
  if (p?.device) out.push(p.atCreate ? '同じ端末（作ったときから）' : '同じ端末')
  if ((p?.ip || 0) > 0) out.push(p.ip > 1 ? `同じIP ${p.ip}か所` : '同じIP')
  if ((p?.rescue || 0) > 0) out.push(`救援で一緒 ${p.rescue}回`)
  return out
}
