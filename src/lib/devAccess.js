import { supabase } from '../supabase'

// 開発限定機能への非管理者アクセスを記録し、管理者（おれおれお）へ個別お知らせで通知する。
// サーバー側RPC: log_dev_access（supabase_dev_access_watch.sql）
// 失敗・RPC未適用は握りつぶす＝アクセスした本人の画面には一切影響させない。
export function reportDevAccess(feature, detail) {
  try {
    supabase.rpc('log_dev_access', { p_feature: feature, p_detail: detail || null }).then(() => {}, () => {})
  } catch { /* RPC未適用時は無視 */ }
}
