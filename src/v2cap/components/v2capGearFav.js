import { supabase } from '../../supabase'

// 装備のお気に入りの★をサーバーに覚えさせる（2026-10-26・v2capGearView.js の useFavToggle の save）。失敗の文か null を返す
export const saveGearFav = async (id, on) => {
  const { data, error } = await supabase.rpc('v2cap_gear_fav', { p_inv: id, p_fav: on })
  return error || !data?.ok ? (error?.message || data?.error || 'お気に入りの保存に失敗しました') : null
}
