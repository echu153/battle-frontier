// ============================================================
// バトルフロンティアⅡ（v2cap）— AI案内役「ジェミータ」（Claude）
// ------------------------------------------------------------
// 2026-10-26 ユーザー指示「V2でClaude Consoleを用いてジェミータを作りたい」「1人1日10回制限で」
//   「BFに関係ないことは基本答えない（エログロなど特に）」「プレイヤーに関する情報も答えないように」
//   ＋ユーザー選択：モデルは Claude Haiku 5.5・管理者は無制限・会話は記録する（管理者だけ読める・30日で消す）
//
// ・鍵（ANTHROPIC_API_KEY）はここの秘密の設定にだけ置く。画面には出さない
// ・回数は DB で数える（v2cap_jemita_consume）。管理者は数えない。Claude が失敗したら1回戻す
// ・ゲームの資料と決まりは DB の表 v2cap_jemita_kb（画面からは読めない）。画面から送られた資料は使わない
// ・文脈（これまでの会話）は、画面から送られたものではなく、サーバーが記録した本人の直近の会話（30分以内・Claude が答えたものだけ）を使う
//   ＝画面から偽の会話を差し込まれても効かない
// ・画面が送るのは「質問」と「本人の今の状態」（名前は入っていない）だけ。どちらも長さを切り、不適切な言葉は Claude へ送る前に断る
//
// 秘密の設定（Supabase の Edge Functions → Secrets）：
//   ANTHROPIC_API_KEY（必須・Claude Console で作る）
//   JEMITA_MODEL（任意・既定 claude-haiku-5-5）／JEMITA_EFFORT（任意・既定 medium）／JEMITA_ADMIN_ONLY（任意・既定 true＝v2cap が開発中のあいだ管理者だけ）
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY は自動で入る
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const MODEL = Deno.env.get('JEMITA_MODEL') || 'claude-haiku-5-5'
const EFFORT = (['low', 'medium', 'high'].includes(Deno.env.get('JEMITA_EFFORT') || '') ? Deno.env.get('JEMITA_EFFORT') : 'medium') as 'low' | 'medium' | 'high'
const ADMIN_ONLY = (Deno.env.get('JEMITA_ADMIN_ONLY') || 'true') !== 'false'

// 画面（src/v2cap/lib/jemita.js・jemitaPrompt.js）と同じ数と見出し
const MAX_CHARS = 200
const STATUS_MAX = 2000
const THREAD_MS = 30 * 60 * 1000
const HISTORY_PAIRS = 4
const STATUS_HEAD = '【このプレイヤー本人の今の状態（ゲームの画面が自動で付けたもの）】'
const QUESTION_HEAD = '【プレイヤーの発言】'

// 断るときの返事（Claude へ送らない・回数も使わない）
const BLOCKED = 'くだらん。そんな話に付き合う気はない。このゲームのことなら相手をしてやる。'
const REFUSED = 'フン、その話には乗らん。このゲームのことを訊け。'

// 不適切な言葉（V1 の clever-api と同じ一覧）。Claude へ送る前と、Claude の答えの両方で見る
const NG = /(セックス|せっくす|sex|エロ|アダルト|adult|童貞|処女|射精|挿入|オナニー|自慰|まんこ|マンコ|ちんこ|チンコ|ちんぽ|チンポ|ペニス|性器|レイプ|強姦|ヌード|全裸|風俗|ポルノ|porn|18禁|r-?18|性行為|fuck|グロ画像|グロ動画|内臓|死体|惨殺|バラバラ死体|リョナ|死ね|殺すぞ|ぶっ殺|きちがい|キチガイ|気違い|池沼|知障|くたばれ)/i
const ngNorm = (s: string) => (s || '')
  .normalize('NFKC')
  .replace(/[​-‍﻿]/g, '')
  .toLowerCase()
  .replace(/[\s.\-_、。・,]/g, '')
const isNG = (s: string) => NG.test(ngNorm(s))
// 制御文字を消す（改行とタブは残す）
const clean = (s: unknown) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()

// 資料は数分ごとに読み直す（SQL を流したら遅くとも5分で切り替わる）
let kbCache: { at: number; version: string; rules: string; body: string } | null = null
const KB_TTL_MS = 5 * 60 * 1000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)

  // だれか（ログインの確かめ）
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ allowed: false, reason: 'unauthorized' }, 401)
  const { data: userData } = await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(jwt)
  const uid = userData?.user?.id
  if (!uid) return json({ allowed: false, reason: 'unauthorized' }, 401)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: prof, error: profErr } = await svc.from('profiles').select('is_admin').eq('id', uid).single()
  if (profErr) { console.error('[v2cap-jemita] profile lookup error'); return json({ allowed: false, reason: 'profile_error' }, 500) }
  const isAdmin = !!prof?.is_admin
  if (ADMIN_ONLY && !isAdmin) return json({ allowed: false, reason: 'admin_only' }, 403)

  let body: { question?: string; status?: string; since?: string }
  try { body = await req.json() } catch { return json({ allowed: false, reason: 'bad_json' }, 400) }
  const question = clean(body.question)
  const status = clean(body.status).slice(0, STATUS_MAX)
  if (!question) return json({ allowed: false, reason: 'empty' }, 400)
  if (question.length > MAX_CHARS) return json({ allowed: false, reason: 'too_long' }, 400)

  const log = async (row: Record<string, unknown>) => {
    const { error } = await svc.from('v2cap_jemita_log').insert({ user_id: uid, question, model: MODEL, ...row })
    if (error) console.error('[v2cap-jemita] log failed')
  }

  // 送る前に断る（回数は使わない）
  if (isNG(question) || isNG(status)) {
    await log({ answer: BLOCKED, source: 'blocked', model: null })
    return json({ allowed: true, text: BLOCKED, blocked: true })
  }
  if (!API_KEY) return json({ allowed: false, reason: 'not_configured' }, 503)

  // 資料
  if (!kbCache || Date.now() - kbCache.at > KB_TTL_MS) {
    const { data: kb, error: kbErr } = await svc.from('v2cap_jemita_kb').select('version, rules, body').eq('id', 1).maybeSingle()
    if (kbErr || !kb) { console.error('[v2cap-jemita] kb missing'); return json({ allowed: false, reason: 'no_kb' }, 503) }
    kbCache = { at: Date.now(), version: kb.version, rules: kb.rules, body: kb.body }
  }
  const kb = kbCache

  // 1回ぶん使う（-1＝今日の分は終わり・999999＝管理者）
  const { data: left, error: rpcErr } = await svc.rpc('v2cap_jemita_consume', { p_user: uid })
  if (rpcErr) { console.error('[v2cap-jemita] consume error'); return json({ allowed: false, reason: 'rate_error' }, 500) }
  if (typeof left === 'number' && left < 0) return json({ allowed: false, reason: 'daily_limit' })
  const refund = async () => {
    const { error } = await svc.rpc('v2cap_jemita_refund', { p_user: uid })
    if (error) console.error('[v2cap-jemita] refund failed')
  }
  const unlimited = left === 999999

  // これまでの会話（サーバーの記録から・本人の30分以内・Claude が答えたものだけ・古い順）
  const sinceAsked = Date.parse(body.since || '')
  const since = new Date(Math.max(Date.now() - THREAD_MS, Number.isFinite(sinceAsked) ? sinceAsked : 0)).toISOString()
  const { data: past } = await svc.from('v2cap_jemita_log')
    .select('question, answer')
    .eq('user_id', uid).eq('source', 'llm').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(HISTORY_PAIRS)
  const history = (past || []).reverse().flatMap((h) => [
    { role: 'user' as const, content: `${QUESTION_HEAD}\n${h.question}` },
    { role: 'assistant' as const, content: h.answer },
  ])
  const userText = (status ? `${STATUS_HEAD}\n${status}\n\n` : '') + `${QUESTION_HEAD}\n${question}`

  const client = new Anthropic({ apiKey: API_KEY, timeout: 30_000, maxRetries: 1 })
  let res: Anthropic.Message
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: EFFORT },
      // 決まり＋資料は毎回同じ＝キャッシュ（1時間）。ここまでが同じなら2回目からは安い
      system: [
        { type: 'text', text: kb.rules },
        { type: 'text', text: `# ゲーム資料（版 ${kb.version}）\n${kb.body}`, cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      messages: [...history, { role: 'user', content: userText }],
    })
  } catch (err) {
    const st = err instanceof Anthropic.APIError ? err.status : 0
    console.error('[v2cap-jemita] claude error', st)   // 本文や uid は記録しない
    await refund()
    return json({ allowed: false, reason: st === 429 || st === 529 ? 'busy_server' : 'llm_error' }, 502)
  }

  const usage = {
    input_tokens: res.usage?.input_tokens ?? null,
    output_tokens: res.usage?.output_tokens ?? null,
    cache_read_tokens: res.usage?.cache_read_input_tokens ?? null,
    cache_write_tokens: res.usage?.cache_creation_input_tokens ?? null,
  }
  const reply = (extra: Record<string, unknown>) => json({
    allowed: true, left: unlimited ? null : left, unlimited, kb_version: kb.version, ...extra,
  })

  // Claude が断った（安全のための判断）。回数はそのまま使う
  if (res.stop_reason === 'refusal') {
    await log({ answer: REFUSED, source: 'refusal', ...usage })
    return reply({ text: REFUSED })
  }
  const text = res.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('').trim()
  if (!text) {
    await refund()
    console.error('[v2cap-jemita] empty answer', res.stop_reason)
    return json({ allowed: false, reason: 'llm_error' }, 502)
  }
  // 答えに不適切な言葉が出たら出さない（Claude の失敗なので回数を戻す）
  if (isNG(text)) {
    await refund()
    await log({ answer: text, source: 'guard', ...usage })
    return reply({ text: REFUSED, left: unlimited ? null : left + 1 })
  }
  await log({ answer: text, source: 'llm', ...usage })
  return reply({ text })
})
