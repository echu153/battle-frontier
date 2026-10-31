/* global process */
// ============================================================
// バトルフロンティアⅡ（v2cap）— 挑戦の結果を確かめる関数（Vercel）
// ------------------------------------------------------------
// 【確定】2026-10-31 ユーザー選択「pushだけで揃う」：画面と同じ戦闘のコードを読むので、push すれば画面と同じ版になる（貼り直しの手間なし）。
// 中身は src/v2cap/lib/dungeonVerifyApi.js。ここは HTTP の受け渡しだけ。
// 環境変数（Vercel の Settings → Environment Variables）：BF_DUNGEON_SECRET（合い言葉・無いと確かめられない）
// ⚠api/ の下に置いたファイルは全部 Vercel の関数になる＝テストはここに置かない
// ⚠GET は sw.js がキャッシュするので POST だけ（画面も手元の開発から呼べるように、どのオリジンからでも受ける。合い言葉は画面に出ない）
// ============================================================
import { verifyRequest } from '../src/v2cap/lib/dungeonVerifyApi.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST だけです' })
  let body = null
  try { body = req.body } catch { /* 形の悪い JSON は「どの挑戦か分かりません」へ */ }
  const { status, body: out } = await verifyRequest({ body, secret: process.env.BF_DUNGEON_SECRET, sha: process.env.VERCEL_GIT_COMMIT_SHA || '' })
  return res.status(status).json(out)
}
