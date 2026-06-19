import { supabase } from '../supabase'

// 会話用LLM（Edge Function ai-chat）を呼ぶ。
// 戻り値:
//   { text }                … LLMの回答（成功・残回数 remaining）
//   { allowed:false, reason }… 上限到達/未設定など（呼び出し側はルールベースへフォールバック）
//   null                    … 通信失敗・未デプロイ（同上フォールバック）
// ※Edge Functionが未デプロイ/未設定でも null を返すだけで、UIは従来どおり動く。
// draft … ルールベースが用意した正確な草案。AIはこれを土台に質問へ合わせて作り直す。
export const llmChat = async ({ question, draft, player } = {}) => {
  if (!question) return null
  try {
    const { data, error } = await supabase.functions.invoke('clever-api', {
      body: { question, draft: draft || '', player: player || {} },
    })
    if (error) return null
    if (data?.allowed && data?.text) return { text: data.text, remaining: data.remaining, limit: data.limit }
    return { allowed: false, reason: data?.reason, limit: data?.limit }
  } catch {
    return null
  }
}
