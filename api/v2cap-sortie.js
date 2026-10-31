/* global process */
// ============================================================
// バトルフロンティアⅡ（v2cap）— 出撃と塔の結果を決める関数（Vercel）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー選択「全部無効・無料で約1,400人」。画面と同じ戦闘のコードを読むので、push すれば画面と同じ版になる。
// 中身は src/v2cap/lib/sortieVerifyApi.js。ここは HTTP の受け渡しだけ（入口の決まりは api/v2cap-dungeon-verify.js と同じ）。
// 環境変数：BF_DUNGEON_SECRET（挑戦の確かめと同じ合い言葉）
// ============================================================
import { sortieRequest } from '../src/v2cap/lib/sortieVerifyApi.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST だけです' })
  let body = null
  try { body = req.body } catch { /* 形の悪い JSON は「どの頼みか分かりません」へ */ }
  const { status, body: out } = await sortieRequest({ body, secret: process.env.BF_DUNGEON_SECRET })
  return res.status(status).json(out)
}
