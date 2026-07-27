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

// 在室ハートビート(切断者だけを離脱指定できるようにするためのプレゼンス更新)
export async function wagerPing(key) {
  try {
    const { data, error } = await supabase.rpc('wager_ping', { p_key: key })
    if (error) return { error: error.message }
    return data || { error: '不明なエラー' }
  } catch (e) {
    return { error: e.message }
  }
}

// 無効試合(切断)処理: 落ちた人(loserId)を負け扱いにし、残った人へポットを払い出す
export async function wagerForfeit(key, loserId) {
  try {
    const { data, error } = await supabase.rpc('wager_forfeit', { p_key: key, p_loser: loserId })
    if (error) return { error: error.message }
    return data || { error: '不明なエラー' }
  } catch (e) {
    return { error: e.message }
  }
}

// 順位に応じた分配精算(複数人ゲーム・1位60%以上)。rankingIds=賭け参加者を順位順に
export async function wagerSettleRanked(key, rankingIds) {
  try {
    const { data, error } = await supabase.rpc('wager_settle_ranked', { p_key: key, p_ranking: rankingIds })
    if (error) return { error: error.message.includes('function') ? '賭け機能のSQL更新が必要です' : error.message }
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
