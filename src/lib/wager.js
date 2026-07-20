// 娯楽ゲームのGold賭け(供託→過半数一致で精算)。supabase_game_wager.sql が必要
import { supabase } from '../supabase'

export const MAX_BET = 10000000

// 供託(参加)。成功: { ok } / 失敗: { error }
export async function wagerJoin(key, gameType, bet) {
  try {
    const { data, error } = await supabase.rpc('wager_join', { p_key: key, p_game_type: gameType, p_bet: bet })
    if (error) return { error: error.message.includes('function') ? '賭け機能は準備中です' : error.message }
    return data || { error: '不明なエラー' }
  } catch (e) {
    return { error: e.message }
  }
}

// 結果報告。winnerId=null は引き分け/NPC勝ち(返金)
export async function wagerReport(key, winnerId) {
  try {
    const { data, error } = await supabase.rpc('wager_report', { p_key: key, p_winner: winnerId })
    if (error) return { error: error.message }
    return data || { error: '不明なエラー' }
  } catch (e) {
    return { error: e.message }
  }
}

// 放置された賭けの返金(2時間後)
export async function wagerRefundStale(key) {
  try {
    const { data, error } = await supabase.rpc('wager_refund_stale', { p_key: key })
    if (error) return { error: error.message }
    return data || { error: '不明なエラー' }
  } catch (e) {
    return { error: e.message }
  }
}
