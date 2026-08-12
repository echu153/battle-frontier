// ============================================================
// バトルフロンティアⅡ（リメイク版）— ダメージと判定の正
// ------------------------------------------------------------
// あるけみすと準拠の考え方：
//   ・物理は STR、魔法は INT を素材にして「スキルの倍率」を掛ける
//   ・防御は引き算ではなく％軽減。しかも上限がある
//     （物理は最大 PHYS_REDUCTION_CAP、魔法は最大 MAG_REDUCTION_CAP しか減らない）
//     → 防御をいくら積んでもダメージが0にならない＝旧版で起きた
//        「硬すぎて削れない／柔らかすぎて溶ける」の二極化を構造的に防ぐ
//   ・クリティカルは倍率を上げ、さらに相手の防御力を割り引く（防御の一部を無視）
//   ・スキルは毎ターン「発動率」で抽選する（強い技ほど出にくい）
//
// ★あるけみすとの公表値があるのは
//     物理防御力 = VIT×1.0〜0.5 ／ 魔法防御力 = INT×1.0〜0.5 + VIT×0.15
//     物理ダメージ = STR×倍率×(1.0〜0.66) ／ 魔法ダメージ = INT×倍率×(1.0〜0.5)
//     クリティカル = 倍率を1.5倍し、相手の防御力を1.5で割る（≒防御の1/3を無視）
//   まで。命中・回避・クリティカル率の式は公表が無いためBF独自に決めた（下の定数）。
//   数値の調整はこのファイルの定数だけを触ること。
// ============================================================

// ===== 防御 =====
// 防御力そのもの。v2は防御専用ステータスを持たず VIT / INT から算出する。
//   あるけみすと：物理防御力 = VIT×1.0〜0.5 ／ 魔法防御力 = INT×1.0〜0.5 ＋ VIT×0.15
// 「1.0〜0.5」は主ステの係数が伸びるほど減る（逓減）ことを表していると解釈し、
// 係数の起点をどちらも 1.0 に揃えたうえで、逓減そのものは下の reductionRate が担う。
//   ※2026-08-12まで物理だけ1.0・魔法だけ0.5と取り違えていて、魔法防御が半分になっていた
export const PHYS_DEF_VIT = 1.0  // 物理防御に乗る VIT の係数
export const MAG_DEF_INT  = 1.0  // 魔法防御に乗る INT の係数
export const MAG_DEF_VIT  = 0.15 // 魔法防御に乗る VIT の係数（こちらはレンジなし）
export const physDefOf = (s) => (s?.vit || 0) * PHYS_DEF_VIT
export const magDefOf  = (s) => (s?.int_stat || 0) * MAG_DEF_INT + (s?.vit || 0) * MAG_DEF_VIT

// 軽減率の上限。物理は34%・魔法は50%までしか減らない（あるけみすとの 1.0〜0.66 / 1.0〜0.5 と対応）
export const PHYS_REDUCTION_CAP = 0.34
export const MAG_REDUCTION_CAP  = 0.50

// 攻撃力に対する防御力の比で軽減率が決まる。比が上がるほど上限へ近づくが超えない
//   def == atk なら上限の半分、def が atk の3倍なら上限の3/4
export const reductionRate = (def, atk, cap) => {
  const d = Math.max(0, def)
  const a = Math.max(1, atk)
  return cap * (d / (d + a))
}

// ===== クリティカル =====
// あるけみすとの公表分（いずれも先方はマスクデータ扱い・要検証と注記あり）：
//   ・威力  ：係数を1.5倍し、さらに1.5を足す ／ 相手の防御力を1.5で割る
//   ・命中  ：クリティカルの命中判定では DEX×1.5 ＋ LUK÷3 をDEXとして扱う
//   ・発生率：非公表（「まれに発生する」とだけ）→ LUK差で決めるのはBF独自
// ★判定の順番もあるけみすとに合わせる：先にクリティカルを決め、その後で
//   （クリなら補正したDEXで）命中判定する。＝クリティカルは通常より当たりやすい
export const CRIT_MULT     = 1.5 // クリ時にスキル倍率へ掛ける
export const CRIT_MULT_ADD = 1.5 // クリ時にスキル倍率へ足す
export const CRIT_DEF_DIV  = 1.5 // クリ時に相手の防御力を割る（≒防御の1/3を無視）
export const CRIT_ACC_DEX  = 1.5    // クリ時の命中判定で DEX に掛ける
export const CRIT_ACC_LUK  = 1 / 3  // クリ時の命中判定で LUK から足す
export const critAccuracyStats = (s) => ({ ...s, dex: (s?.dex || 0) * CRIT_ACC_DEX + (s?.luk || 0) * CRIT_ACC_LUK })
export const CRIT_BASE_PCT = 5   // 基礎クリティカル率(%)
export const CRIT_PER_LUK  = 100 // LUK差がこの値のときクリ率+10%（下のCRIT_DIFF_PCTと組）
export const CRIT_DIFF_PCT = 10
export const CRIT_MIN_PCT = 1
export const CRIT_MAX_PCT = 50
// 自分のLUKが相手より高いほど当たりやすい
export const critRate = (attacker, defender) => {
  const diff = (attacker?.luk || 0) - (defender?.luk || 0)
  const pct = CRIT_BASE_PCT + (diff / CRIT_PER_LUK) * CRIT_DIFF_PCT
  return clampPct(pct, CRIT_MIN_PCT, CRIT_MAX_PCT)
}

// ===== 命中・回避 =====
export const HIT_MAX_PCT = 95    // 命中率の上限（必中スキルを除く）
export const HIT_MIN_PCT = 40    // 命中率の下限
export const EVA_AGI = 1.0       // 回避に乗る AGI の係数
export const EVA_VIT = 0.1       // VIT はわずかに回避へ影響する
export const EVA_LUK = 0.1       // LUK もわずかに回避へ影響する
export const evasionScoreOf = (s) =>
  (s?.agi || 0) * EVA_AGI + (s?.vit || 0) * EVA_VIT + (s?.luk || 0) * EVA_LUK
// DEX と 回避スコアの綱引き。同値なら上限の中間あたりに落ち着く
export const hitRate = (attacker, defender) => {
  const dex = Math.max(0, attacker?.dex || 0)
  const eva = Math.max(0, evasionScoreOf(defender))
  if (dex + eva <= 0) return HIT_MAX_PCT
  const ratio = dex / (dex + eva)               // 0〜1
  return clampPct(HIT_MIN_PCT + (HIT_MAX_PCT - HIT_MIN_PCT) * (ratio * 2), HIT_MIN_PCT, HIT_MAX_PCT)
}

const clampPct = (v, min, max) => Math.min(max, Math.max(min, Math.round(v * 10) / 10))

// ===== 抽選 =====
// 発動率・命中率・クリティカル率（%）の判定。rng は 0〜1
export const roll = (pct, rng = Math.random) => rng() * 100 < pct

// ===== ダメージ =====
// kind: 'phys'（STR基準）/ 'mag'（INT基準）
// mult: スキルの倍率。crit: クリティカルかどうか
// defPen: 防御無視(0〜1)。スキル側で「防御を30%無視」のように指定する
// add: 副ステータス参照 [{ stat:'agi', rate:0.5 }]。あるけみすとの「STR×1.4＋LUK×0.8」に相当
//      ※軽減率の計算には主ステータス（STR/INT）だけを使う＝副ステで防御の効きが変わらない
export const attackStatOf = (s, kind) => (kind === 'mag' ? (s?.int_stat || 0) : (s?.str || 0))
export const damageOf = ({ attacker, defender, mult = 1, kind = 'phys', crit = false, defPen = 0, add = null }) => {
  const phys = kind !== 'mag'
  const atk = attackStatOf(attacker, kind)
  let base = atk * mult
  if (add) for (const a of add) base += (attacker?.[a.stat] || 0) * a.rate
  let def = phys ? physDefOf(defender) : magDefOf(defender)
  if (defPen > 0) def *= Math.max(0, 1 - Math.min(1, defPen))
  if (crit) def /= CRIT_DEF_DIV
  const cap = phys ? PHYS_REDUCTION_CAP : MAG_REDUCTION_CAP
  const red = reductionRate(def, atk, cap)
  // クリティカルは倍率そのものを持ち上げる（係数×1.5＋1.5）。副参照ぶんは倍率と同じ比率で伸ばす
  if (crit) base *= (mult * CRIT_MULT + CRIT_MULT_ADD) / Math.max(0.01, mult)
  return Math.max(1, Math.floor(base * (1 - red)))
}

// ===== 回復 =====
// HP回復もMP回復も INT を参照する（あるけみすとの「神聖なる手 INT×1.5」と同じ考え方）。
// 最大HP/MPの％では参照しない＝HPを積んだだけ回復量まで伸びる、という歪みを作らないため。
// ※あるけみすとの回復表記にある ×(1.0〜0.5) の揺れは入れていない（回復量は毎回同じ）
export const healOf = (actor, rate) => Math.max(1, Math.floor((actor?.int_stat || 0) * rate))

// 1回の攻撃を解決する。外れ／クリティカルもここで決める（戦闘ループから使う想定）
// ★順番はあるけみすと準拠：クリティカルを先に決め、クリならDEXを補正して命中判定する
// noCrit: クリティカルしないスキル。あるけみすとにも「クリティカルするスキルとしないスキル」がある。
//   クリの固定加算(＋1.5)は元の係数によらないため、多段スキルほど恩恵が大きい。
//   多段を noCrit にして、そのぶん素の倍率を上げるのがv2の方針（バランスが安定する）。
export const resolveAttack = ({ attacker, defender, mult = 1, kind = 'phys', defPen = 0, add = null, sureHit = false, sureCrit = false, noCrit = false }, rng = Math.random) => {
  const crit = !noCrit && (sureCrit || roll(critRate(attacker, defender), rng))
  const acc = crit ? critAccuracyStats(attacker) : attacker
  const hit = sureHit || roll(hitRate(acc, defender), rng)
  if (!hit) return { hit:false, crit, damage:0 }
  return { hit:true, crit, damage: damageOf({ attacker, defender, mult, kind, crit, defPen, add }) }
}
