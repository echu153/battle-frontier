// 戦闘用スキルセットの選択（全エンジン共通）
//  ・アクティブスキルは指定 set_type のセットを使う（アクティブが1つも無ければ sortie にフォールバック）
//  ・パッシブは「1セットにつき1個」の仕様。1戦闘で発動するパッシブも【1つだけ】。
//    → 指定セットのパッシブを最優先で使い、無い場合のみ sortie セットのパッシブを流用する
//      （「レイド/挑戦セットにパッシブを入れ忘れると発動しない」問題への救済。ここでも1個だけ）。
//    ※以前は全セットのパッシブをユニオンしていたが、別セットに違うパッシブを入れていると
//      複数パッシブが同時発動してしまう不具合になっていたため単一化。
export function selectBattleSkillSets(allRows, setType) {
  const all = Array.isArray(allRows) ? allRows : []
  const isPassive = (r) => r?.skills?.type === 'パッシブ'
  const target = all.filter((r) => (r.set_type || 'sortie') === setType)
  const sortie = all.filter((r) => (r.set_type || 'sortie') === 'sortie')
  // 指定セットにアクティブスキルが無ければ未設定扱いで sortie を使う
  const base = target.some((r) => !isPassive(r)) ? target : sortie
  const active = base.filter((r) => !isPassive(r))
  // パッシブは1個のみ：指定セットのもの → 無ければ sortie セットのもの
  const passive = target.find(isPassive) || sortie.find(isPassive)
  return passive ? [...active, passive] : [...active]
}
