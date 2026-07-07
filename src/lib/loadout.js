// 戦闘用スキルセットの選択（全エンジン共通）
//  ・アクティブスキルは指定 set_type のセットを使う（アクティブが1つも無ければ sortie にフォールバック）
//  ・パッシブ（クラスの常時能力）はロードアウトに関わらず【常に全戦闘で有効】。
//    → どのセットに入れていても、全セットのパッシブをユニオンして必ず反映する（重複はスキル名で除去）。
//  これにより「レイド/挑戦セットにパッシブを入れ忘れると発動しない」問題を解消する。
export function selectBattleSkillSets(allRows, setType) {
  const all = Array.isArray(allRows) ? allRows : []
  const isPassive = (r) => r?.skills?.type === 'パッシブ'
  const target = all.filter((r) => (r.set_type || 'sortie') === setType)
  const sortie = all.filter((r) => (r.set_type || 'sortie') === 'sortie')
  // 指定セットにアクティブスキルが無ければ未設定扱いで sortie を使う
  const base = target.some((r) => !isPassive(r)) ? target : sortie
  const active = base.filter((r) => !isPassive(r))
  // 全セットのパッシブをスキル名で重複除去して集約（＝常に全戦闘で有効）
  const seen = new Set()
  const passives = all.filter((r) => isPassive(r) && r.skills?.name && !seen.has(r.skills.name) && seen.add(r.skills.name))
  return [...active, ...passives]
}
