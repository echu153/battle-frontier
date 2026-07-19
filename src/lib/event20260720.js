// かかし修練場＋奈落闘技場イベント (JST 2026/7/20 5:00 〜 2026/8/3 4:59)
// ・かかし修練場: 獲得EXP 2倍 / チャージ必要出撃回数 50→10回
// ・奈落闘技場 : フロア報酬(Gold/強化石/宝石/秘伝書) 2倍
// サーバー側の正: supabase_event_20260720_scarecrow_abyss.sql（期間自動判定・終了後は自動で通常値に戻る）
export const EVENT_20260720_START = new Date('2026-07-20T05:00:00+09:00').getTime()
export const EVENT_20260720_END = new Date('2026-08-03T05:00:00+09:00').getTime()

export const isEvent20260720Active = (now = Date.now()) =>
  now >= EVENT_20260720_START && now < EVENT_20260720_END

// かかしチャージに必要な出撃回数（イベント中10回・通常50回）
export const scarecrowChargeNeed = (now = Date.now()) => (isEvent20260720Active(now) ? 10 : 50)
