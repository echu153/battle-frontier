// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— ホームの開け閉めを覚えておく
// ------------------------------------------------------------
// 【確定】2026-10-15 ユーザー指示「ホーム画面のステータスを表示、毎回開いてるから閉じたら閉じる、開いたら開くを継続させて」：
//   前は端末（localStorage の v2:capOpenStatus など）にだけ覚えていた。手元では続いていたが、ユーザーの所では毎回開いていた
//   （端末・ブラウザが変わる／閲覧データが消えると、最初の値に戻る）。
//   → **キャラのデータ（v2cap_profiles.ui_prefs）にも覚える**。どの端末で開いても前の開け閉めから始める。
//     端末の保存は、サーバーにまだ無いとき（SQLを流す前・一度も押していない）の控えとして残す
// ★サーバーが覚えるのはここに並べたキーだけ（SQLの v2cap_set_ui_pref。v2capsql.test.js が突き合わせる）
// ============================================================

// キー → 最初の値（true＝開いている）。ステータスとメニューは開いて始め、今日のミッションは畳んで始める（前と同じ）
export const FOLD_DEFAULTS = {
  openStatus: true,
  openMenu: true,
  openDaily: false,
}
export const FOLD_KEYS = Object.keys(FOLD_DEFAULTS)

// 端末に覚えるときの名前（v2/lib/prefs.js が頭に「v2:」を付ける）。前からの v2:capOpenStatus・v2:capOpenMenu をそのまま使う
export const foldLocalNameOf = (key) => `cap${key[0].toUpperCase()}${key.slice(1)}`

// いまの開け閉め：キャラのデータにあればそれ、無ければ端末の値（local）
export const foldOf = (prof, key, local) => {
  const v = prof?.ui_prefs?.[key]
  return typeof v === 'boolean' ? v : local
}
