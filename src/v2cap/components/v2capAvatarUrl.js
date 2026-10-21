import { supabase } from '../../supabase'
import { loadPref } from '../core/prefs.js'
import { AVATAR_CUSTOM_ON } from '../lib/avatar.js'
import { homeIconOf } from '../lib/classArt.js'
import { artGenderOf } from '../lib/gender.js'
import { CLASS_BY_ID } from '../lib/jobs.js'

// アイコンの場所（avatars バケットの中・src/v2cap/lib/avatar.js）を表示用のURLに直す。無ければ null
export const avatarUrlOf = (path) => (path ? supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl : null)

// ホーム・プロフィールの自分のアイコン（2026-10-22〜 クラスの待機の GIF・lib/avatar.js の AVATAR_CUSTOM_ON）。
//   男女はキャラの性別（決めていないキャラは神殿の切り替え capArtGender＝戦闘ログと同じ）。GIF の無い上位クラスは系統の初期クラスの GIF
export const myIconOf = (prof) => (AVATAR_CUSTOM_ON && prof.avatar
  ? avatarUrlOf(prof.avatar)
  : homeIconOf(prof.class, artGenderOf(prof, loadPref('capArtGender', 'm')), CLASS_BY_ID[prof.class]?.req?.cls))
