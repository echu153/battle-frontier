// ============================================================
// 称号 共通モジュール
// Titles.jsx（称号ページ）/ Game.jsx（街の獲得可能バナー）で共通利用
// 条件判定ロジックの二重実装によるズレを防ぐため一元管理
// ============================================================
import { supabase } from '../supabase'

const BASE_CLASSES = ['戦士','弓使い','魔法使い','僧侶','格闘家']

// 称号条件の判定に必要なデータを一括取得
export const fetchTitleData = async (userId) => {
  const [
    { data: p },
    { data: titles },
    { data: pt },
    { data: classLevels },
    { data: donations },
    { data: raidRows },
    { data: hpPotItems },
    { data: mpPotItems },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('titles').select('*').order('id'),
    supabase.from('player_titles').select('*').eq('player_id', userId),
    supabase.from('class_levels').select('lv, class_name').eq('player_id', userId),
    supabase.from('museum_donations').select('id').eq('player_id', userId),
    supabase.from('raid_participants').select('id').eq('player_id', userId),
    supabase.from('player_items').select('id, items!inner(effect)').eq('player_id', userId).eq('items.effect', 'hp_pct_infinite'),
    supabase.from('player_items').select('id, items!inner(effect)').eq('player_id', userId).eq('items.effect', 'mp_pct_infinite'),
  ])

  const classLevelTotal = (classLevels || []).reduce((s, cl) => s + (cl.lv || 0), 0)
  const advancedClassCount = (classLevels || []).filter(cl => !BASE_CLASSES.includes(cl.class_name)).length
  const retrainingTotal = Object.values(p?.retraining || {}).reduce((s, v) => s + v, 0)
  const maxUnlockedArea = Math.max(...(p?.unlocked_areas || [1]))

  const condData = {
    classLevelTotal,
    advancedClassCount,
    retrainingTotal,
    maxUnlockedArea,
    jobChangeCount: p?.job_change_count || 0,
    bossKillCount: p?.boss_kill_count || 0,
    raidCount: (raidRows || []).length,
    donationCount: (donations || []).length,
    enhanceSuccessCount: p?.enhance_success_count || 0,
    enhanceFailCount: p?.enhance_fail_count || 0,
    gamblingMedalMax: p?.gambling_medal_max_daily || 0,
    gamblingGoldMax: p?.gambling_gold_max_single || 0,
    hasHpPotion: (hpPotItems || []).length > 0,
    hasMpPotion: (mpPotItems || []).length > 0,
  }

  return { profile: p, titles: titles || [], playerTitles: pt || [], condData }
}

// 称号の獲得条件を満たしているか
export const checkTitleCondition = (title, profile, condData) => {
  if (!condData || !profile) return false
  const v = title.condition_value
  switch (title.condition_type) {
    case 'class_level_total': return condData.classLevelTotal >= v
    case 'char_lv':           return (profile.char_lv || profile.lv || 0) >= v
    case 'job_change':        return condData.jobChangeCount >= v
    case 'advanced_class_count': return condData.advancedClassCount >= v
    case 'retraining':        return condData.retrainingTotal >= v
    case 'area':              return condData.maxUnlockedArea >= v
    case 'boss_kill':         return condData.bossKillCount >= v
    case 'raid':              return condData.raidCount >= v
    case 'enhance_success':   return condData.enhanceSuccessCount >= v
    case 'enhance_fail':      return condData.enhanceFailCount >= v
    case 'donation':          return condData.donationCount >= v
    case 'gambling_medal':    return condData.gamblingMedalMax >= v
    case 'gambling_gold':     return condData.gamblingGoldMax >= v
    case 'treasure_hp_or_mp': return condData.hasHpPotion || condData.hasMpPotion
    case 'treasure_both':     return condData.hasHpPotion && condData.hasMpPotion
    case 'class_retraining':  return ((profile.retraining || {})[title.condition_extra] || 0) >= title.condition_value
    case 'generic':           return true
    default:                  return false
  }
}

// 未獲得かつ条件達成済みの称号数（街のバナー用）
export const countClaimableTitles = async (userId) => {
  try {
    const { profile, titles, playerTitles, condData } = await fetchTitleData(userId)
    const acquiredIds = new Set(playerTitles.map(pt => pt.title_id))
    return titles.filter(t =>
      t.condition_type !== 'generic' &&
      !acquiredIds.has(t.id) &&
      checkTitleCondition(t, profile, condData)
    ).length
  } catch {
    return 0
  }
}
