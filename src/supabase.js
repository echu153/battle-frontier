import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://jxbcuqwqtstxgmpiruuu.supabase.co'
const supabaseKey = 'sb_publishable_vlexKdF2oJrIIwMFEA81OA_1XyShoIt'

// Realtime: モバイルで画面を離れても切断判定が早すぎないよう、
// ハートビートを短めにして復帰時の再接続も速くする(既定30秒→15秒)
// auth.lockAcquireTimeout: ログイン情報の鍵(ブラウザ全体で1つ・タブをまたいで共有)を待つ上限。
// supabase-js 2.106 は auth を渡さないと既定の5秒が undefined で上書きされて「無期限に待つ」に
// なる(SupabaseClient が lockAcquireTimeout: undefined を明示で渡し、GoTrueClient が
// Object.assign で既定値を消す)。どこかのタブが鍵を握ったまま止まると、ほかのタブも
// 開き直したタブも全部「読み込み中...」で固まった(2026-11-05)。5秒で鍵を奪って先へ進める。
// 消すと固まりが戻る＝src/supabaseClient.test.js が落ちる。
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { lockAcquireTimeout: 5000 },
  realtime: { params: { heartbeatIntervalMs: 15000 } },
})