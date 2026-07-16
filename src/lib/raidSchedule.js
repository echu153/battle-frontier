// ============================================================
// レイドボスの出現スケジュール
//  ・21時/22時の2枠のうち「必ず1枠」が閻魔（＝全出現の1/2）。
//    残り1枠を旧3体（ヴァルゼノク/雨摩座/ゼルギアス）が3日周期で回る。
//  ・時間帯が偏らないよう、閻魔の枠は日替わりで21時↔22時を入れ替える。
//
//  ★ サーバーの raid_boss_for_slot（supabase_raid_enma_20260717.sql）と必ず一致させること。
//    ズレると「本日の出現予告」と実際に出現するボスが食い違う。
//    一致は test/raidEnma.test.js が検証している。
// ============================================================

export const BOSS_VARUZENOKU = '黒龍ヴァルゼノク'
export const BOSS_AMAZA      = '雨摩座'
export const BOSS_ZERUGIASU  = '雷鋼機神ゼルギアス'
export const BOSS_ENMA       = '閻魔'

// 閻魔でない方の枠を回る旧3体
export const RAID_BOSS_CYCLE = [BOSS_VARUZENOKU, BOSS_AMAZA, BOSS_ZERUGIASU]

// epochDays/baseDays は「1970-01-01 からの日数」と「2000-01-01 からの日数」。差が SQL の
// (spawn_date - DATE '2000-01-01') と一致する。slot は 21 か 22。
export const raidBossForSlot = (epochDays, baseDays, slot) => {
  const d = epochDays - baseDays
  const enmaAt21 = (((d % 2) + 2) % 2) === 0   // 偶数日は21時が閻魔／奇数日は22時
  if ((slot === 21) === enmaAt21) return BOSS_ENMA
  return RAID_BOSS_CYCLE[(((d % 3) + 3) % 3)]
}

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
