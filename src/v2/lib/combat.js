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
// critBonus はパッシブの「最終クリティカル率+5%」ぶん（上限 CRIT_MAX_PCT には従う）
export const critRate = (attacker, defender, critBonus = 0) => {
  const diff = (attacker?.luk || 0) - (defender?.luk || 0)
  const pct = CRIT_BASE_PCT + (diff / CRIT_PER_LUK) * CRIT_DIFF_PCT + critBonus
  return clampPct(pct, CRIT_MIN_PCT, CRIT_MAX_PCT)
}

// ===== 命中・回避 =====
// ★あるけみすとは命中・回避の式を公表していない（マスクデータ）。ただし
//   忍者「影縫い：回避成功毎に回避率+3%」／デバフ「閃光：10%の確率で攻撃が外れる」
//   という書き方から、向こうは**「回避率」を独立した%で持っている**と読める。
//   そこでv2も「命中率 = 100% − 回避率」という形にする（式そのものはBF独自）。
//   ・回避率はステータスから出し、EVA_RATE_CAP に漸近する（防御の軽減率と同じ考え方）
//   ・パッシブの「最終命中率+5%」「回避率+5%」は、この回避率へ素直に足し引きする
//   ・DEXを伸ばすほど回避率が0へ近づく＝**命中に頭打ちが無い**
//     （旧実装はDEXが相手の回避スコアの1.2倍で95%に張り付き、それ以上DEXが死にステだった）
// ★曲線の狙い（2026-08-14 再較正）：
//   **同格ではほぼ当たる（95%）が、DEXとAGIに差がつくと一気に当たらなくなる**。
//   装備でステータスを狙って伸ばせるので、AGI型・DEX型を作った意味が出るようにする。
//   ・EVA_COEF は「上限」ではなく係数。実際の上限は EVA_RATE_MAX
//   ・EVA_CURVE=5 で急峻。相手AGI3倍で命中73.4%・10倍で35.1%（旧式は79.7%・71.0%）
//   ・DEXを3倍積めば相手AGI10倍でも71.5%まで戻せる（取り返し幅は最大+36ポイント）
//   ・CURVE=6まで立てると、AGI20倍あたりで下限に張り付いてDEXを積んでも取り返せない
//     区間ができるので5で止めている
export const EVA_AGI = 1.0       // 回避に乗る AGI の係数
export const EVA_VIT = 0.1       // VIT はわずかに回避へ影響する
export const EVA_LUK = 0.1       // LUK もわずかに回避へ影響する
export const EVA_COEF = 104      // 回避率の係数（同格の回避率が5%＝命中95%になる値）
export const EVA_RATE_MAX = 75   // 補正込みでの回避率の上限(%)＝命中は最低25%
export const EVA_CURVE = 5       // 大きいほど「同格では避けにくく、AGI差で急に伸びる」
export const evasionScoreOf = (s) =>
  (s?.agi || 0) * EVA_AGI + (s?.vit || 0) * EVA_VIT + (s?.luk || 0) * EVA_LUK

// 回避率(%)。hitBonus は攻撃側の命中補正、evaBonus は防御側の回避補正（どちらもポイント）
export const evasionRate = (attacker, defender, hitBonus = 0, evaBonus = 0) => {
  const eva = Math.max(0, evasionScoreOf(defender))
  const dex = Math.max(1, attacker?.dex || 0)
  const base = EVA_COEF * Math.pow(eva / (eva + dex), EVA_CURVE)
  return clampPct(base + evaBonus - hitBonus, 0, EVA_RATE_MAX)
}
export const hitRate = (attacker, defender, hitBonus = 0, evaBonus = 0) =>
  clampPct(100 - evasionRate(attacker, defender, hitBonus, evaBonus), 100 - EVA_RATE_MAX, 100)

const clampPct = (v, min, max) => Math.min(max, Math.max(min, Math.round(v * 10) / 10))

// ===== 行動順・行動回数（AGI）=====
// あるけみすと側は「AGIは行動順・行動回数・回避に影響」としか公表していないので、
// ここは旧版（無印バトルフロンティア）の考え方を踏襲しつつ、上限だけ付け直している。
//   旧版：追加行動率 =(自SPD−敵SPD)/敵SPD×50。上限なしで、2倍差で50%・3倍差で75%…と伸び続ける
//        → 転生（転職）で差がつくほど一方的になる＝インフレの温床だった
//   v2  ：AGI比 1倍→0%、EXTRA_ACTION_MAX_RATIO 倍で EXTRA_ACTION_MAX_PCT に到達して打ち止め
//        → 転職で大差がついても追加行動だけで壊れない
export const EXTRA_ACTION_MAX_PCT   = 50 // 追加行動の上限(%)
export const EXTRA_ACTION_MAX_RATIO = 10 // この倍率で上限に到達する
// 相手よりAGIが高いときだけ発生する
export const extraActionRate = (myAgi, foeAgi) => {
  const mine = Math.max(0, myAgi || 0)
  const foe  = Math.max(1, foeAgi || 0)
  if (mine <= foe) return 0
  const t = Math.min(1, (mine / foe - 1) / (EXTRA_ACTION_MAX_RATIO - 1))
  return Math.round(EXTRA_ACTION_MAX_PCT * t * 10) / 10
}
export const rollExtraAction = (me, foe, rng = Math.random) =>
  roll(extraActionRate(me?.agi, foe?.agi), rng)

// 行動順。スキルの優先度が最優先、次にAGI、同値ならランダム。
// priority はスキル側の値（0=通常・1以上=先制）。防御や回復を先に置けるようにするための枠。
export const goesFirst = (me, foe, myPriority = 0, foePriority = 0, rng = Math.random) => {
  if (myPriority !== foePriority) return myPriority > foePriority
  const a = me?.agi || 0
  const b = foe?.agi || 0
  if (a !== b) return a > b
  return rng() < 0.5
}

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
  if (crit) def /= CRIT_DEF_DIV
  const cap = phys ? PHYS_REDUCTION_CAP : MAG_REDUCTION_CAP
  // ★防御無視は「防御力」ではなく「軽減率」に掛ける。
  //   防御力を割る形だと、相手が防御を積むほど軽減率が上限に張り付いて
  //   貫通の効果が消える（＝硬い相手に効かない）という逆の挙動になっていた。
  //   軽減率に掛ければ「50%無視＝軽減が半分」で、硬い相手にほどよく効く。
  const red = reductionRate(def, atk, cap) * (1 - Math.max(0, Math.min(1, defPen)))
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
// ===== ダメージの振れ幅（DEXの担当）=====
// ★DEXに「命中」以外の仕事をもう1つ持たせるための仕組み（2026-08-14）。
//   命中には100%という天井があるので、DEXは命中だけでは伸びしろが+11%しかなく、
//   しかも相手が鈍いと文字通り無価値だった（実測で戦闘力+150をDEXに全振りしても勝率62.9%。
//   同じ戦闘力をSTRに振れば75.4%）。
//   そこで **ダメージを「下限〜1.00倍」の幅にして、DEXが下限を持ち上げる** ことにした。
//   ラグナロクオンラインの「DEXが最小攻撃力を底上げする」と同じ発想。
//   あるけみすとの表記 `STR×倍率×(1.0〜0.66)` も幅を持っているので、そちらにも寄る。
//
// ★安定度は **DEX と「自分の主ステータス(STR/INT)」** で測る。相手と比べる形にすると、
//   AGI型が相手のときに下限が上がらず、一番必要な場面で効かなくなる（実測済み）。
//   自分基準なら**相手が誰でも効く無条件の仕事**になり、かつスケール不変も保てる。
export const DMG_SPREAD = 0.65             // 安定度0のときにここまで下がる（同格は0.68〜1.00倍）
export const DMG_COMP = 1 / (1 - DMG_SPREAD / 4)  // 幅を入れたぶん平均が下がるので戻す係数
// 下限(0〜1)。DEXが主ステより大きいほど1.00へ近づく＝振れ幅が縮む
export const damageFloor = (attacker, kind = 'phys') => {
  const dex = Math.max(1, attacker?.dex || 0)
  const main = Math.max(1, attackStatOf(attacker, kind))
  return 1 - DMG_SPREAD * (1 - dex / (dex + main))
}

// hitBonus/evaBonus/critBonus はパッシブぶんの補正（ポイント）。
//   hitBonus … 攻撃側の「最終命中率+n%」 ／ evaBonus … 防御側の「回避率+n%」
//   critBonus … 攻撃側の「最終クリティカル率+n%」
export const resolveAttack = ({ attacker, defender, mult = 1, kind = 'phys', defPen = 0, add = null, sureHit = false, sureCrit = false, noCrit = false, hitBonus = 0, evaBonus = 0, critBonus = 0 }, rng = Math.random) => {
  const crit = !noCrit && (sureCrit || roll(critRate(attacker, defender, critBonus), rng))
  const acc = crit ? critAccuracyStats(attacker) : attacker
  const hit = sureHit || roll(hitRate(acc, defender, hitBonus, evaBonus), rng)
  if (!hit) return { hit:false, crit, damage:0 }
  // ダメージの振れ幅。DEXが高いほど下限が1.00へ寄って安定する
  const lo = damageFloor(attacker, kind)
  const scale = (lo + (1 - lo) * rng()) * DMG_COMP
  const dmg = Math.max(1, Math.floor(damageOf({ attacker, defender, mult, kind, crit, defPen, add }) * scale))
  return { hit:true, crit, damage: dmg }
}
