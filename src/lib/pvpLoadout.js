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
import { petPlayerBonus } from '../constants/pets'
import { loadCharmBonus, loadCharmBonusMap, PET_STAT_SELECT } from './petBonus'

// 1プレイヤー分の戦闘ロードアウトを読み込む。
//  isSelf=true なら skill_sets を直接、false なら RPC(pvp_get_skillsets) で取得。
//  opts.previewClass: 指定クラスとして eff を計算（スキル画面のステ確認用。usingPvpSetゲートを無視して強制再計算）。
export async function loadLoadout(playerId, isSelf, opts = {}) {
  const [{ data: profile }, { data: eq }, { data: prof }, { data: pets }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', playerId).single(),
    supabase.from('player_equipment').select('*, weapons(*)').eq('player_id', playerId).eq('equipped', true),
    supabase.from('proficiency').select('player_id, equipment_id, prof_lv').eq('player_id', playerId),
    supabase.from('pets').select(PET_STAT_SELECT).eq('owner_id', playerId).eq('is_active', true),
  ])
  if (!profile) throw new Error('プロフィールが見つかりません')

  // ペット本体ステ(100%)＋装備チャーム／リボンを反映（Ranking/街と同方式。リボンの基礎効果のみペット専用）
  let petStat = null, petCharm = null
  const pet = (pets || [])[0]
  if (pet) {
    petStat = petPlayerBonus(pet)
    petCharm = await loadCharmBonus(pet)
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
    .select('id, username, lv, char_lv, class, pvp_class, stat_point_spent, hp_max, mp_max, atk, def, matk, mdef, spd, avatar_url, retraining, museum_atk, museum_def, museum_matk, museum_mdef, museum_spd, museum_hp, museum_mp, fishing_atk, fishing_def, fishing_matk, fishing_mdef, fishing_spd, fishing_hp, fishing_mp, ability_title_id')
    .order('char_lv', { ascending: false })
    .limit(200)
  const list = (data || []).filter(p => !excluded.has(p.id) && p.id !== excludeId)
  const ids = list.map(p => p.id)
  if (ids.length === 0) return []

  const [{ data: eqData }, { data: profData }, { data: petData }, { data: metaRes }] = await Promise.all([
    supabase.from('player_equipment').select('*, weapons(*)').in('player_id', ids).eq('equipped', true),
    supabase.from('proficiency').select('player_id, equipment_id, prof_lv').in('player_id', ids),
    supabase.from('pets').select(PET_STAT_SELECT).in('owner_id', ids).eq('is_active', true),
    supabase.rpc('pvp_list_meta', { p_ids: ids }),  // 相手のPvPアクティブ有無＆class_levels（RLS回避）
  ])
  const eqs = eqData || [], profs = profData || []
  // 対人戦メタ: player_id → { has_pvp_active, class_levels }
  const metaMap = {}
  for (const m of (metaRes?.meta || [])) metaMap[m.player_id] = m

  const petStatMap = {}
  for (const pet of (petData || [])) petStatMap[pet.owner_id] = petPlayerBonus(pet)
  const charmMap = await loadCharmBonusMap(petData)  // チャーム＋リボン（リボンの基礎効果のみペット専用）

  const titleMap = {}
  const titleIds = [...new Set(list.map(p => p.ability_title_id).filter(Boolean))]
  if (titleIds.length > 0) {
    const { data: titlesData } = await supabase.from('titles').select('*').in('id', titleIds)
    for (const t of (titlesData || [])) titleMap[t.id] = t
  }

  // 紋章の割り振り（候補者側の総合力にも反映＝自分の総合力と対称にしてマッチングのズレを防ぐ）
  const emblemMap = {}
  try {
    const { data: emRows } = await supabase.from('player_emblem').select('player_id, alloc').in('player_id', ids)
    for (const e of (emRows || [])) if (e.alloc && Object.keys(e.alloc).length > 0) emblemMap[e.player_id] = e.alloc
  } catch { /* 紋章未導入時は無視 */ }

  return list.map(p => {
    const eq = eqs.filter(e => e.player_id === p.id)
    const pf = profs.filter(x => x.player_id === p.id)
    const tb = p.ability_title_id ? titleMap[p.ability_title_id] : null
    // 対人戦で実際に戦うクラス＝pvp_class設定あり かつ PvPセットにアクティブスキルあり のとき。
    //  そのとき基礎ステを「そのクラスに転職した値」に再計算（loadLoadoutの戦闘時と同一ロジック）。
    const m = metaMap[p.id] || {}
    const effClass = (p.pvp_class && m.has_pvp_active) ? p.pvp_class : p.class
    const baseStats = effClass !== p.class ? computeClassBaseStats(p, m.class_levels || [], effClass) : null
    const pProfile = { ...p, ...(baseStats || {}), class: effClass, petStat: petStatMap[p.id] || null, petCharm: charmMap[p.id] || null, emblemAlloc: emblemMap[p.id] || null }
    return {
      id: p.id, username: p.username, char_lv: p.char_lv || p.lv, class: effClass, avatar_url: p.avatar_url,
      _total: calcEffectiveTotal(pProfile, eq, pf, tb),
    }
  }).sort((a, b) => b._total - a._total)
}
