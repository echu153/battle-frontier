// ============================================================
// どの版で遊べるか／どの版のキャラクターを新しく作れるか
// ------------------------------------------------------------
// ★**切り替えるのはこのファイルだけ**（2026-08-26 ユーザー指示）。
//   画面のあちこちに判定を書くと、片方だけ直して食い違う。
//
// 予定している段取り：
//   ① いま        … CREATE_MODE='v1only'  V2_PUBLIC=false
//                    無印だけ作れる。Ⅱは開発中なので is_admin だけが入れる
//   ② Ⅱのリリース直後 … CREATE_MODE='v2only'  V2_PUBLIC=true
//                    新しく作れるのは**Ⅱだけ**。無印は作れない（既存のデータはそのまま遊べる）
//   ③ 後々        … CREATE_MODE='both'    V2_PUBLIC=true
//                    どちらも作れる。作るときに選ぶ
//
// ⚠**V2_PUBLIC を true にするまで CREATE_MODE に v2 を入れない**こと。
//   Ⅱを作らせたのに /v2 へ入れない、という行き止まりになる。テストで縛ってある。
// ============================================================

// バトルフロンティアⅡを一般公開したか。false のあいだは is_admin だけが /v2 に入れる
export const V2_PUBLIC = false

// 新しくキャラクターを作れる版。'v1only' | 'v2only' | 'both'
export const CREATE_MODE = 'v1only'

export const CREATE_MODES = ['v1only', 'v2only', 'both']

// ★is_admin はいつでも両方作れる（作れないと開発中の確認ができない）
export const canCreate = (version, isAdmin = false) => {
  if (isAdmin) return true
  if (version === 'v1') return CREATE_MODE === 'v1only' || CREATE_MODE === 'both'
  if (version === 'v2') return CREATE_MODE === 'v2only' || CREATE_MODE === 'both'
  return false
}

// 作れる版の一覧。2つあるときだけ「どちらではじめる？」を出す
export const creatableVersions = (isAdmin = false) =>
  ['v1', 'v2'].filter(v => canCreate(v, isAdmin))

// バトルフロンティアⅡに入れるか（/v2 のゲート）
// ★テスター … 公開前に「is_admin ではないがⅡには入れる」捨てアカウント。
//   取引所のように**2人いないと確かめられない**ものを試すために作る。
//   名簿はサーバー（v2_testers）が持っていて、足せるのは is_admin だけ。
//   ⚠これはゲートを**緩めていない**。名簿に載っている人だけが通る。
export const canPlayV2 = (isAdmin = false, isTester = false) => V2_PUBLIC || !!isAdmin || !!isTester
