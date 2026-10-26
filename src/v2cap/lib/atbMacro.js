// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘のマクロ（登録・保存の形）
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「マクロ（①〜③に技の順番を登録して、押したらゲージが溜まりしだい順に出る）」＋選んだこと：
//   ・1つのマクロに**8個まで**（同じ技を何回入れてもよい・通常攻撃と防御も入れられる）
//   ・**くり返すかはマクロごとに選べる**（くり返さないマクロは最後まで出たら止まる＝あとは通常攻撃）
//   ・**サーバーに保存**（職業ごと）＝ v2cap_profiles.atb_macros ＝ { 職業: [①, ②, ③] }・保存は v2cap_set_atb_macros（SQL §19）
//   ・戦闘中に技を押したら**次の1回だけ割り込む**（core/atb.js の割り込みの列）
//   ・手の技がクールダウン中・MP不足なら**使えるまで待つ**（core/atb.js）
// 1つのマクロ＝{ steps: [技の名前｜'@normal'｜'@guard'], loop: true/false }。
// ★技は名前で持つ（並びが変わっても同じ技を指す）。覚えていない・その職業で使えない技はサーバーが弾き、戦闘では飛ばす
// ============================================================
export const MACRO_COUNT = 3
export const MACRO_STEPS = 8
export const STEP_NORMAL = '@normal'
export const STEP_GUARD = '@guard'
export const MACRO_MARK = ['①', '②', '③']

export const emptyMacros = () => Array.from({ length: MACRO_COUNT }, () => ({ steps: [], loop: false }))

// 保存されている形を、いつも3つ・手は8個までの形にそろえる
export const normalizeMacros = (raw) => emptyMacros().map((m, i) => {
  const r = Array.isArray(raw) ? raw[i] : null
  return {
    steps: (Array.isArray(r?.steps) ? r.steps : []).filter(s => typeof s === 'string').slice(0, MACRO_STEPS),
    loop: !!r?.loop,
  }
})
// その職業のマクロ（キャラのデータ）
export const macrosOf = (prof, cls = prof?.class) => normalizeMacros(prof?.atb_macros?.[cls])

export const stepLabel = (s) => (s === STEP_NORMAL ? '通常攻撃' : s === STEP_GUARD ? '🛡 防御' : s)

// 保存の前の確かめ（サーバーの v2cap_set_atb_macros と同じ決まり・同じ文言）。usable＝その職業で使える覚えた技の名前
export const validateMacros = (macros, usable = []) => {
  if (!Array.isArray(macros) || macros.length !== MACRO_COUNT) return `マクロは${MACRO_COUNT}つです`
  const have = new Set(usable)
  for (const [i, m] of macros.entries()) {
    const steps = m?.steps
    if (!Array.isArray(steps)) return 'マクロの形式が不正です'
    if (steps.length > MACRO_STEPS) return `マクロ${MACRO_MARK[i]}は${MACRO_STEPS}個までです`
    for (const s of steps) {
      if (s === STEP_NORMAL || s === STEP_GUARD) continue
      if (!have.has(s)) return `${s}はいまのクラスで使える覚えた技ではありません`
    }
  }
  return null
}

// 戦闘に渡す形（core/atb.js の startMacro）。slots の並びで技を探す。見つからない技は飛ばす
export const macroEntriesOf = (macro, slots = []) => (macro?.steps || []).flatMap(s => {
  if (s === STEP_NORMAL) return [{ idx: null }]
  if (s === STEP_GUARD) return [{ guard: true }]
  const idx = slots.findIndex(sl => sl?.skill?.name === s)
  return idx >= 0 ? [{ idx }] : []
})
