// ============================================================
// 出撃中ペットのプレイヤー反映分（チャーム＋リボン）の共通ローダー
// ------------------------------------------------------------
// リボン（pets.ribbon_id）はチャームとは別枠の装備で、
//   ・特殊能力（フェイトコア抽選）／ステ成長（凝縮された素）… プレイヤー本体にも反映する
//   ・基礎効果（物理+5%等）… ペット専用（チャームの atkup/wall 等と同じ扱い）
// という扱い。charm_id しか読まないと回避3%+3%が+3%にしかならないため、
// プレイヤー実効ステを出す全画面はここを経由して両方を読むこと。
// ============================================================
import { supabase } from '../supabase'
import { charmPlayerBonus } from '../constants/pets'

// pets テーブルの選択列（プレイヤー実効ステ用。ribbon_id を落とさないこと）
export const PET_STAT_SELECT = 'owner_id, species, level, evolved, charm_id, ribbon_id'

// ペット1匹分のチャーム＋リボンを読み、プレイヤーへの反映分を返す（未装備なら null）
export async function loadCharmBonus(pet) {
  if (!pet?.charm_id && !pet?.ribbon_id) return null
  const ids = [pet.charm_id, pet.ribbon_id].filter(Boolean)
  const { data: rows } = await supabase.from('player_charms').select('*').in('id', ids)
  const byId = {}
  for (const c of (rows || [])) byId[c.id] = c
  return charmPlayerBonus(byId[pet.charm_id] || null, byId[pet.ribbon_id] || null)
}

// 複数ペット分をまとめて読む（ランキング/組み手/領地の一括計算用）。owner_id → 反映分
export async function loadCharmBonusMap(petRows) {
  const pets = petRows || []
  const ids = [...new Set(pets.flatMap(p => [p.charm_id, p.ribbon_id]).filter(Boolean))]
  const map = {}
  if (ids.length === 0) return map
  const { data: rows } = await supabase.from('player_charms').select('*').in('id', ids)
  const byId = {}
  for (const c of (rows || [])) byId[c.id] = c
  for (const pet of pets) {
    const bonus = charmPlayerBonus(byId[pet.charm_id] || null, byId[pet.ribbon_id] || null)
    if (bonus) map[pet.owner_id] = bonus
  }
  return map
}
