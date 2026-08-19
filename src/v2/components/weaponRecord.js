import { supabase } from '../../supabase'
import { recordOfBattle } from '../lib/evolve.js'
import { recordingWeaponIds } from '../lib/loadout.js'

// バトルフロンティアⅡ（リメイク版）— 戦闘のあとに武器へ戦績を積む
// ------------------------------------------------------------
// ★**戦闘の画面はここだけを呼ぶ**（出撃・アリーナで同じ関数を通す）。
//   1戦ぶんの戦績の作り方は evolve.js、どこへ積むかは loadout.js が正なので、
//   画面側には「呼ぶ」以外の判断を持たせない＝片方の画面だけ挙動がズレない。
//
// 戻り値 … 進化を受け取れる武器の配列（無ければ空）。画面はこれでポップアップを出す
export const pushWeaponRecord = async (prof, inventory, r, you, foe, opt = {}) => {
  const ids = recordingWeaponIds(prof, inventory)
  if (!ids.length) return []
  const { data, error } = await supabase.rpc('v2_weapon_record', {
    p_ids: ids, p_rec: recordOfBattle(r, you, foe, opt),
  })
  if (error || !data?.ok) return []
  return (data.weapons || []).filter(w => (w.pending || 0) > 0)
}
