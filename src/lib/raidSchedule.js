// ============================================================
// レイドボスの表示リソース（名前→画像／色）
//
//  ★ 出現スケジュール（どの枠に何が出るか・昼枠が何時か）はここで計算しない。
//    サーバーの spawn_raid_boss_if_needed が返す 'schedule' をそのまま表示すること。
//    以前はクライアントにも同じ式を置いていたが、サーバーとズレると
//    「本日の予告」と実際の出現が食い違うため、算出はSQL側の一箇所に寄せた。
//    定義: supabase_raid_day_20260717.sql（raid_boss_for_slot / raid_day_slot）
// ============================================================

export const BOSS_VARUZENOKU = '黒龍ヴァルゼノク'
export const BOSS_AMAZA      = '雨摩座'
export const BOSS_ZERUGIASU  = '雷鋼機神ゼルギアス'
export const BOSS_ENMA       = '閻魔'

// ボス名 → 表示画像
export const RAID_IMG_VER = '2'  // 画像差し替え時に上げるとキャッシュを無効化
export const bossImage = (name) => (
  name === BOSS_AMAZA ? '/amaza.png'
  : name === BOSS_ZERUGIASU ? '/zerugiasu.png'
  : name === BOSS_ENMA ? '/enma.png'
  : '/varuzenoku.png'
) + `?v=${RAID_IMG_VER}`

// ボス名 → 表示色（スケジュール表・戦闘ログ共通）
export const bossColor = (name) => (
  name === BOSS_AMAZA ? '#66bbff'
  : name === BOSS_ZERUGIASU ? '#ffdd44'
  : name === BOSS_ENMA ? '#cc66ff'
  : '#ff6666'
)
