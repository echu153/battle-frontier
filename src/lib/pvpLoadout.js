// ============================================================
// 対人戦／組み手 共通：戦闘ロードアウト読み込み & 総合力候補取得
// ------------------------------------------------------------
// loadLoadout()        : 1プレイヤー分の戦闘ロードアウト（simulatePvpBattle 入力）。
// loadTotalCandidates(): 総合力ランキング上位候補（組み手のマッチング用）。
//   どちらも Ranking.jsx / 街と同じ計算方式（ペット本体ステ100%＋チャーム＋称号）。
// ============================================================
import { supabase } from '../supabase'
import { calcEffectiveStats, calcEffectiveTotal } from './stats'
import { computeClassBaseStats } from '../pages/Game'
import { petPlayerBonus, charmPlayerBonus } from '../constants/pets'

// 1プレイヤー分の戦闘ロードアウトを読み込む。
//  isSelf=true なら skill_sets を直接、false なら RPC(pvp_get_skillsets) で取得。
//  opts.previewClass: 指定クラスとして eff を計算（スキル画面のステ確認用。usingPvpSetゲートを無視して強制再計算）。
export async function loadLoadout(playerId, isSelf, opts = {}) {
  const [{ data: profile }, { data: eq }, { data: prof }, { data: pets }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', playerId).single(),
    supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', playerId).eq('equipped', true),
    supabase.from('proficiency').select('player_id, equipment_id, prof_lv').eq('player_id', playerId),
    supabase.from('pets').select('owner_id, species, level, evolved, charm_id').eq('owner_id', playerId).eq('is_active', true),
  ])
  if (!profile) throw new Error('プロフィールが見つかりません')

  // ペット本体ステ(100%)＋装備チャームを反映（Ranking/街と同方式）
  let petStat = null, petCharm = null
  const pet = (pets || [])[0]
  if (pet) {
    petStat = petPlayerBonus(pet)
    if (pet.charm_id) {
      const { data: charm } = await supabase.from('player_charms').select('*').eq('id', pet.charm_id).maybeSingle()
      if (charm) petCharm = charmPlayerBonus(charm)
    }
  }

  // 称号ボーナス
  let titleBonus = null
  if (profile.ability_title_id) {
    const { data: at } = await supabase.from('titles').select('*').eq('id', profile.ability_title_id).maybeSingle()
    titleBonus = at || null
  }

  // 紋章の割り振り（未導入/未付与なら無視）
  let emblemAlloc = null
  try {
    const { data: em } = await supabase.from('player_emblem').select('alloc').eq('player_id', playerId).maybeSingle()
    if (em?.alloc && Object.keys(em.alloc).length > 0) emblemAlloc = em.alloc
  } catch { /* 紋章未導入時は無視 */ }

  // PvPスキルセット（無ければ出撃を流用）＋クラスレベル（PvPクラスのステ再計算用）
  let skillSets, classLevels
  if (isSelf) {
    const { data: ss } = await supabase.from('skill_sets').select('*, skills(*)').eq('player_id', playerId).order('slot_order')
    const all = ss || []
    const pvp = all.filter(r => (r.set_type || 'sortie') === 'pvp')
    // PvPセットにアクティブスキルが無ければ出撃を流用（パッシブのみ/空だと全部通常攻撃になるため。他セットと同方針）
    const pvpHasActive = pvp.some(r => r.skills?.type !== 'パッシブ')
    skillSets = pvpHasActive ? pvp : all.filter(r => (r.set_type || 'sortie') === 'sortie')
    const { data: cl } = await supabase.from('class_levels').select('class_name, lv').eq('player_id', playerId)
    classLevels = cl || []
  } else {
    const { data: rpc } = await supabase.rpc('pvp_get_skillsets', { p_target: playerId })
    if (rpc?.error) throw new Error(rpc.error)
    skillSets = rpc?.skill_sets || []
    classLevels = rpc?.class_levels || []  // SECURITY DEFINER RPCが相手のclass_levelsも返す（RLS回避）
  }

  const profileWithPet = { ...profile, petStat, petCharm, activePet: pet || null, emblemAlloc }
  // PvP専用クラス: profiles.pvp_class があり、かつ実際に「PvPスキルセット」を使う場合のみ、
  //   そのクラスとして戦う（＝そのクラスに転職したときと同じ扱い）。
  //   ※ pvpセットが空でsortie流用のときは差し替えない（クラスとスキルの不整合を防ぐ）。
  const usingPvpSet = (skillSets || []).some(r => (r.set_type || 'sortie') === 'pvp')
  //  ・opts.previewClass 指定時は無条件でそのクラスとして計算（ステ確認用）。
  //  ・通常は pvp_class があり実際にPvPセットを使うときのみ差し替え（空でsortie流用時は不整合防止のため据え置き）。
  const overrideClass = opts.previewClass || (profile.pvp_class && usingPvpSet ? profile.pvp_class : null)
  if (overrideClass) {
    profileWithPet.class = overrideClass
    // 基礎ステ列(hp_max/atk/...)を「そのクラスに転職した値」に再計算して上書き。
    //   calcEffectiveStats が装備/宝石/紋章/ペット等をこの上に乗せる。再修練は retraining[overrideClass] を内部参照。
    Object.assign(profileWithPet, computeClassBaseStats(profile, classLevels, overrideClass))
  }
  const eff = calcEffectiveStats(profileWithPet, eq || [], prof || [], titleBonus)
  return { eff, equipment: eq || [], skillSets, proficiency: prof || [], profile: profileWithPet, playerItem: null }
}

// 総合力ランキング候補を取得（組み手のマッチング用）。
//  excludeId: 自分自身を除外。集計除外アカウント(exclude_from_ranking)も除外。
//  戻り値: [{ id, username, char_lv, class, avatar_url, _total }] を総合力降順でソート。
// ※ Ranking.jsx と同方式：char_lv 上位200を候補に取り、総合力で再ソート。
export async function loadTotalCandidates(excludeId) {
  let excluded = new Set()
  try {
    const { data: exRows } = await supabase.from('profiles').select('id').eq('exclude_from_ranking', true)
    excluded = new Set((exRows || []).map(r => r.id))
  } catch { /* 列未追加なら除外なし */ }

  const { data } = await supabase
    .from('profiles')
    .select('id, username, lv, char_lv, class, hp_max, mp_max, atk, def, matk, mdef, spd, avatar_url, retraining, museum_atk, museum_def, museum_matk, museum_mdef, museum_spd, museum_hp, museum_mp, fishing_atk, fishing_def, fishing_matk, fishing_mdef, fishing_spd, fishing_hp, fishing_mp, ability_title_id')
    .order('char_lv', { ascending: false })
    .limit(200)
  const list = (data || []).filter(p => !excluded.has(p.id) && p.id !== excludeId)
  const ids = list.map(p => p.id)
  if (ids.length === 0) return []

  const [{ data: eqData }, { data: profData }, { data: petData }] = await Promise.all([
    supabase.from('player_equipment').select('*, weapons(*)').in('player_id', ids).eq('equipped', true),
    supabase.from('proficiency').select('player_id, equipment_id, prof_lv').in('player_id', ids),
    supabase.from('pets').select('owner_id, species, level, evolved, charm_id').in('owner_id', ids).eq('is_active', true),
  ])
  const eqs = eqData || [], profs = profData || []

  const petStatMap = {}, charmMap = {}
  for (const pet of (petData || [])) petStatMap[pet.owner_id] = petPlayerBonus(pet)
  const charmIds = [...new Set((petData || []).map(p => p.charm_id).filter(Boolean))]
  if (charmIds.length > 0) {
    const { data: charmRows } = await supabase.from('player_charms').select('*').in('id', charmIds)
    const charmById = {}
    for (const c of (charmRows || [])) charmById[c.id] = c
    for (const pet of (petData || [])) {
      if (pet.charm_id && charmById[pet.charm_id]) charmMap[pet.owner_id] = charmPlayerBonus(charmById[pet.charm_id])
    }
  }

  const titleMap = {}
  const titleIds = [...new Set(list.map(p => p.ability_title_id).filter(Boolean))]
  if (titleIds.length > 0) {
    const { data: titlesData } = await supabase.from('titles').select('*').in('id', titleIds)
    for (const t of (titlesData || [])) titleMap[t.id] = t
  }

  return list.map(p => {
    const eq = eqs.filter(e => e.player_id === p.id)
    const pf = profs.filter(x => x.player_id === p.id)
    const tb = p.ability_title_id ? titleMap[p.ability_title_id] : null
    const pProfile = { ...p, petStat: petStatMap[p.id] || null, petCharm: charmMap[p.id] || null }
    return {
      id: p.id, username: p.username, char_lv: p.char_lv || p.lv, class: p.class, avatar_url: p.avatar_url,
      _total: calcEffectiveTotal(pProfile, eq, pf, tb),
    }
  }).sort((a, b) => b._total - a._total)
}
