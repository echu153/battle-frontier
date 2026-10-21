import { useState } from 'react'
import { supabase } from '../../supabase'
import { useStored } from '../core/prefs.js'
import { FOLD_DEFAULTS, foldLocalNameOf, foldOf } from '../lib/uiPrefs.js'

// ============================================================
// 「レベルキャップあり」版 — ホームの開け閉め（ステータス・メニュー・今日のミッション）
//   【確定】2026-10-15 ユーザー指示「閉じたら閉じる、開いたら開くを継続させて」。決まりは src/v2cap/lib/uiPrefs.js
//   ・キャラのデータ（ui_prefs）にあればそれ、無ければ端末の値から始める
//   ・押したら、端末とキャラのデータ（v2cap_set_ui_pref）の両方に覚える。押したあとはこの画面の値を使う
//     （サーバーへ書いたあとプロフィールを読み直すまで、前の値に戻って見えないように）
//   ★ホーム（V2capHome）で持つ＝施設の画面へ行って戻っても、戦闘中に今日のミッションが隠れても、押した値のまま
// ============================================================
export const useCapFold = (prof, key) => {
  const [local, setLocal] = useStored(foldLocalNameOf(key), FOLD_DEFAULTS[key])
  const [mine, setMine] = useState(null)
  const open = mine ?? foldOf(prof, key, local)
  const toggle = () => {
    const next = !open
    setMine(next)
    setLocal(next)
    // 覚えられなくても（SQLを流す前など）画面はそのまま動く＝端末には覚えている
    supabase.rpc('v2cap_set_ui_pref', { p_key: key, p_open: next }).then(() => {}, () => {})
  }
  return [open, toggle]
}
