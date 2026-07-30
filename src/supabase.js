import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://jxbcuqwqtstxgmpiruuu.supabase.co'
const supabaseKey = 'sb_publishable_vlexKdF2oJrIIwMFEA81OA_1XyShoIt'

// Realtime: モバイルで画面を離れても切断判定が早すぎないよう、
// ハートビートを短めにして復帰時の再接続も速くする(既定30秒→15秒)
export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { params: { heartbeatIntervalMs: 15000 } },
})