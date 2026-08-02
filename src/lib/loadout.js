// ============================================================
// 複数の敵が同時に出るときの「狙う相手」の設定
//  ・単位はスキルセットごと（出撃／挑戦／レイド／八獄／パピア限定／対人戦）
//  ・保存先は skill_set_options(player_id, set_type, target_mode)
//  ・初期値は top（上から順番）＝単体戦と挙動が変わらず予測しやすいため
// ============================================================
export const TARGET_MODES = [
  { key: 'top',     label: '上から順番' },
  { key: 'random',  label: 'ランダム' },
  { key: 'hp_high', label: 'HPが高い敵から' },
  { key: 'hp_low',  label: 'HPが低い敵から' },
]
export const DEFAULT_TARGET_MODE = 'top'
export const isTargetMode = (m) => TARGET_MODES.some(t => t.key === m)

// skill_set_options の行から、指定セットの狙い方を取り出す
export function pickTargetMode(optionRows, setType) {
  const row = (Array.isArray(optionRows) ? optionRows : []).find(r => r.set_type === setType)
  return isTargetMode(row?.target_mode) ? row.target_mode : DEFAULT_TARGET_MODE
}

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
