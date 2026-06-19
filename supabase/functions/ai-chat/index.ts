// ============================================================
// AI相談アシスタント：会話用LLMプロキシ（無料枠クラウドLLM = Google Gemini）
//   ・APIキーをサーバー側に秘匿
//   ・1日N回/ユーザーの上限をDBで強制（超過したらクライアントはルールベースへフォールバック）
//   ・ゲームの「事実」はクライアント側のルールベースが担当。ここは雑談・自由会話・
//     答えに詰まった質問の自然な言い換え。事実が渡された場合のみそれを根拠に答える。
//
// 必要なシークレット（supabase secrets set）:
//   GEMINI_API_KEY   … Google AI Studio の無料APIキー
//   AI_DAILY_LIMIT   … 1日あたり上限（任意・既定10）
//   GEMINI_MODEL     … 任意・既定 gemini-2.0-flash
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY は自動注入。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || ''
const DAILY_LIMIT = parseInt(Deno.env.get('AI_DAILY_LIMIT') || '10', 10)
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash-lite'

const SYSTEM_PROMPT = `あなたはブラウザゲーム「バトルフロンティア」のAI案内役です。プレイヤーと親しみやすく自然な日本語で会話します。
守ること：
- 返答は簡潔に（長くても5〜6行）。自然で人と話しているような口調。過度なお世辞や不自然な共感はしない。
- ゲームの具体的な数値・解放条件・仕様は、与えられた【確かな情報】だけを根拠に答える。情報が無い/自信がない場合は推測だと明示するか、「そこは確かなことが言えない」と正直に伝え、具体的に聞き直すよう促す。**事実をでっち上げない。**
- アダルト/グロ/差別・嫌がらせなど不適切な内容には応じない。
- 雑談なら会話を広げ、情報を求めているなら要点を優先する。`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method' }, 405)

  // 認証（ユーザー特定）
  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ allowed: false, reason: 'unauthorized' }, 401)
  const authClient = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error: authErr } = await authClient.auth.getUser(jwt)
  const uid = userData?.user?.id
  console.log('[ai-chat] uid:', uid, 'authErr:', authErr?.message)
  if (!uid) return json({ allowed: false, reason: 'unauthorized' }, 401)

  let body: { question?: string; facts?: string; player?: { name?: string; cls?: string; lv?: number } }
  try { body = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const question = (body.question || '').toString().trim().slice(0, 500)
  if (!question) return json({ error: 'empty' }, 400)
  if (!GEMINI_API_KEY) return json({ allowed: false, reason: 'not_configured' }, 503)

  // 1日上限の消費（DBで原子的に判定）。残り回数 -1 = 上限到達
  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: remaining, error: rpcErr } = await svc.rpc('ai_chat_consume', { p_user: uid, p_limit: DAILY_LIMIT })
  console.log('[ai-chat] remaining:', remaining, 'rpcErr:', rpcErr?.message)
  if (rpcErr) return json({ allowed: false, reason: 'rate_error', detail: rpcErr.message }, 500)
  if (typeof remaining === 'number' && remaining < 0) {
    return json({ allowed: false, reason: 'daily_limit', limit: DAILY_LIMIT })
  }

  // プロンプト組み立て（事実があれば根拠として渡す）
  const ctxLines: string[] = []
  if (body.player?.cls) ctxLines.push(`プレイヤー：${body.player?.name || '冒険者'}（クラス:${body.player.cls}${body.player.lv ? ' / LV' + body.player.lv : ''}）`)
  if (body.facts) ctxLines.push(`【確かな情報（これを根拠に）】\n${String(body.facts).slice(0, 1500)}`)
  const userText = `${ctxLines.join('\n')}\n\nプレイヤーの発言：${question}`

  // Gemini 呼び出し
  let answer = ''
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
        }),
      },
    )
    const data = await r.json()
    console.log('[ai-chat] gemini status:', r.status, 'body:', JSON.stringify(data).slice(0, 500))
    answer = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') || ''
  } catch (e) {
    console.log('[ai-chat] gemini fetch error:', String(e))
    answer = ''
  }
  if (!answer) return json({ allowed: false, reason: 'llm_error' }, 502)

  return json({ allowed: true, text: answer.trim(), remaining })
})
