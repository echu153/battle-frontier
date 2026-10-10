import { supabase } from '../../supabase'

// アイコンの場所（avatars バケットの中・src/v2cap/lib/avatar.js）を表示用のURLに直す。無ければ null
export const avatarUrlOf = (path) => (path ? supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl : null)
