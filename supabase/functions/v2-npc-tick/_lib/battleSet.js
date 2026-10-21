// ============================================================
// 戦闘 — 防具のセット能力（「レベルキャップあり」版 src/v2cap・2026-10-14）
// ------------------------------------------------------------
// fighter.setFx（src/v2cap/lib/armorSets.js の setFxOf が作る）を side.setFx に持たせ、battle.js が決まった場所でここを呼ぶ。
// ★今のⅡのキャラ・敵は setFx を持たないので、ここは何もしない（今のⅡの戦闘は変わらない・乱数も引かない）
// 項目（どれも省略可。確率は倍率・回避とクリティカル率は%ポイント）：
//   resist {key: 倍率} ・resistAll 倍率 … 受ける状態異常の確率に掛ける（2部位：0.7・深淵の海溝 0.8）
//   inflictUp {key: 倍率}・inflictUpAll 倍率 … 自分が付ける状態異常の確率に掛ける（夜霧・瘴気・蜘蛛の糸・深淵の力）
//   poisonDmgPct     自分が付けた毒の1刻み+%（瘴気）
//   ailTurnsCut      自分が受けた状態異常の持続−（遺物の加護・深淵の加護。1ターンのものは1ターンのまま）
//   regenPct         ターンの終わりに最大HPの%を回復（森の恵み）
//   mpStartPct       戦闘開始時にMP+最大MPの%（若葉の息吹。MPは満タンで始まるので最大を超えてよい）
//   lowHpCut {at, cut}   HPがat%以下のとき受けるダメージ−cut%（古兵の意地）
//   vsAilDmg [{key, pct}] 相手がその状態異常なら与ダメージ+pct%（群狼の牙・業火・蜘蛛の糸）
//   gutsOnce         戦闘中1回、倒れるダメージ（毒・出血・火傷も）をHP1で耐える（番人の守り）
//   physCut          受ける物理ダメージ−%（珊瑚の甲殻＝エンチャントの物理軽減の枠に足す）
//   evaBonus         回避+（砂嵐の帳の「相手の命中-8%」と天翼の「回避+8%」。命中率＝100−回避率なのでどちらも同じ枠）
//   dodgeOnce        戦闘中1回、攻撃を完全に回避（蜃気楼。最初に受ける攻撃＝スキル・通常攻撃・追撃のどれでも）
//   convertAdds [{from, to, pct}]  fromのpct%をtoに足す・元は減らない（巨人の剛力＝エンチャントの加算の枠に足す）
//   fasterDmg        自分のAGIが相手より高いとき与ダメージ+%（峰風）
//   rootHealPct      そのターンに攻撃で受けたダメージの%を、ターンの終わりに回復（根を張る）
//   mpCut            スキルの消費MP−%（霊峰の加護＝天啓の枠に足す）
//   vsSlowCut        鈍足の相手から受けるダメージ−%（氷河の守り）
//   counterAil [{key, chance}]  攻撃を受けると確率で相手に状態異常（帯電装甲・炎獄の鎧。相手の抵抗・0.8倍は通る）
//   earlyBuff {turns, table}    戦闘開始から turns ターンのあいだステ+%（迅雷＝期限つきバフの枠）
//   whileAilStat {stat: pct}    自分が状態異常の間ステ+%（毒龍の鱗）
//   critTakenCut     受けるクリティカルダメージ−%（大地の守り）
//   lowHpHealOnce {at, pct}     戦闘中1回、HPがat%以下になったら最大HPのpct%を回復（天騎士の誓い）
//   buffTurnsUp      自分にかける期限つきの効果の持続+（悠久の守り）
//   critBonus        クリティカル率+（星詠み）
//   takenCut         受けるダメージ−%（深淵の加護）
//   dealPct          与ダメージ+%（深淵の力）
//   rareDropMult     レア以上が落ちる確率の倍率（海賊の嗅覚。戦闘ではなく出撃のドロップ＝src/v2cap/lib/sortie.js が読む）
//   sexDeal          与えるダメージ+%（性別：男性・2026-10-21＝src/v2cap/lib/gender.js）。端数は確率で丸める（下の sexAdjust）
//   sexCut           受けるダメージ−%（性別：女性）。同じ
//   names {項目: 能力の名前}  ログに出す名前
//
// ★ユニーク装備の能力（「レベルキャップあり」版・2026-10-21）も同じ入れ物に入る（src/v2cap/lib/fxMerge.js が防具のセット能力と1つにまとめる）。
//   上の項目はそのまま使い、足りないものを足した（どれも省略可。持っていなければ今までどおり＝今のⅡは何も変わらない）：
//   earlyBuffs [{turns, table}]  earlyBuff の配列の形（セットとユニークの両方を持てる）
//   magCut           受ける魔法ダメージ−%（エンチャントの魔法軽減の枠に足す）
//   statPct {stat: pct}          いつもステ+%（バフではないので消されない）
//   procBonus・hitBonus          スキルの発動率+・命中+（%ポイント。マイナスもある）
//   onHitAils [{key, chance}]    攻撃（スキル・通常攻撃）を当てたとき、確率で状態異常（エンチャントの onHitAils の枠に足す）
//   onHitAilIf [{if, key, chance}]  相手が if の状態異常なら、当てたとき確率で key
//   onHitStack [{stat, pct, chance, cap}]  当てたとき確率で相手のステ−%（重なる・cap まで）
//   onHitTimed [{chance, turns, table}]    当てたとき確率で相手のステ−%（turns ターン）
//   drainIfAil [{key, pct}]      その状態異常の相手を攻撃したとき、与ダメの%を回復（吸収の上限は今と同じ）
//   lowHpDeal [{at, pct}]        自分のHPが at% 以下のとき与ダメージ+%
//   hpDeal [{at, hi, lo}]        自分のHPが at% 以上なら与ダメージ+hi%・未満なら+lo%
//   kindDeal {phys, mag}         物理／魔法の与ダメージ+%
//   skillDeal        スキルの与ダメージ+%（通常攻撃には乗らない）
//   firstSkill       その戦闘で初めて使う攻撃スキルの与ダメージ+%
//   hitStreak {per, max}         攻撃を当てるたび与ダメージ+per%（max まで）・全部外れたら0へ
//   burstEvery {every, pct}      every ターンごとに、次の攻撃の与ダメージ+pct%
//   tide {odd, even}             奇数ターンは与ダメージ+odd%・偶数ターンは受けるダメージ−even%
//   defIgnore {phys, mag}        相手の物理／魔法防御を%無視（防御無視の枠に足す）
//   turnGrow [{stat, per, max}]  ターンが進むたびステ+per%（max まで）
//   hitGrow [{stat, per, max}]   攻撃を当てるたびステ+per%（max まで）
//   critGrow {stats, per, max}   クリティカルを出すたびステ+per%（max まで）
//   critDmgStack {per, max}      攻撃を当てるたびクリティカルのダメージ+per%（max まで）
//   allSkillsBuff {stat: pct}    スキルの枠を5つ全部うめて、全部を1回ずつ使ったら、その戦闘中ステ+%
//   chaseIfAil [{key, chance, mult}]  その状態異常の相手に当てたとき、確率でもう1回（威力 mult 倍・必ず当たる）
//   addDmg [{stat, rate, kind}]  当てたとき、stat×rate の追加ダメージ（kind の防御で受ける）
//   dispelTurns [n…]             そのターンの頭に、相手の強化（プラスの補正）をすべて消す
//   echo {every, pct}            every ターンごとに、その間に与えたダメージの pct% をもう一度与える
//   agiSteal         戦闘開始時、相手のAGIを%奪う（相手−%・自分は奪った値を足す）
//   ward {every}     戦闘開始時と every ターンごとに、状態異常を1回防ぐ（重ならない）
//   immune [key…]    その状態異常にかからない
//   nextSameCut      物理（魔法）ダメージを受けたら、次の物理（魔法）ダメージ−%
//   calmCut          状態異常にかかっていないとき受けるダメージ−%
//   earlyCut {turns, pct}        戦闘開始から turns ターン、受けるダメージ−%
//   reflect          受けたダメージの%を相手に返す
//   counterAilIf [{if, key, chance}]  if の状態異常の相手から攻撃を受けたら、確率で key
//   counterSeal {chance}         スキルで攻撃されたら、確率で相手を封印（相手の次のターン・MPを使う技が出せない）
//   maxHpPct         最大HP+%（戦闘の始めに足す）
//   regenLow {at, add}           HPが at% 以下なら毎ターン回復を+add%
//   dodgeHeal        攻撃をかわしたとき最大HPの%を回復
//   revive           戦闘中1回、倒れるダメージを受けてもHP%で復活
//   cureHeal         状態異常が治るたび最大HPの%を回復
// ★装備とセットの毎ターン回復（regenPct・regenLow）は合計 REGEN_CAP_PCT まで（2026-10-21 ユーザー選択「合計6%までにする」）
// ============================================================
import { hasAilment, AIL_KEYS, BLEED_TURNS } from './ailments.js'

// 【確定】2026-10-21 ユーザー選択：装備とセットの毎ターン回復（最大HPの%）は重ねても合計6%まで（技の継続回復は別）
export const REGEN_CAP_PCT = 6
// 【確定】2026-10-21 ユーザー選択「5つの枠をうめたときだけ」：allSkillsBuff はスキルの枠がこの数そろっているときだけ
export const ALL_SKILLS_SLOTS = 5

// createSide が呼ぶ。今あるパッシブ・エンチャントの枠に足せるものは、ここで足しておく（どの攻撃の道でも同じに効く）
export const initSet = (side, fighter) => {
  const fx = fighter?.setFx || null
  side.setFx = fx
  side.setUsed = { guts: false, dodge: false, heal: false, revive: false }
  side.rootAcc = 0   // そのターンに受けたダメージ（根を張る）
  if (!fx) return
  if (fx.evaBonus) side.pa.evaBonus += fx.evaBonus
  if (fx.critBonus) side.pa.critBonus += fx.critBonus
  if (fx.mpCut) side.pa.mpCut += fx.mpCut
  if (fx.procBonus) side.pa.procBonus += fx.procBonus
  if (fx.hitBonus) side.pa.hitBonus += fx.hitBonus
  if (fx.physCut) side.en.physCutPct = (side.en.physCutPct || 0) + fx.physCut
  if (fx.magCut) side.en.magCutPct = (side.en.magCutPct || 0) + fx.magCut
  if (fx.convertAdds?.length) side.en.convertAdds = [...(side.en.convertAdds || []), ...fx.convertAdds]
  if (fx.onHitAils?.length) side.en.onHitAils = [...(side.en.onHitAils || []), ...fx.onHitAils.map(a => ({ ...a, kind: 'any' }))]
  if (fx.mpStartPct) side.mp += Math.floor(side.base.mp * fx.mpStartPct / 100)
  if (fx.earlyBuff) side.timedBuffs.push({ table: { ...fx.earlyBuff.table }, turns: fx.earlyBuff.turns })
  for (const b of fx.earlyBuffs || []) side.timedBuffs.push({ table: { ...b.table }, turns: b.turns })
  // 最大HP+%（満タンで始まるなら、増えた最大HPまで満たす）
  if (fx.maxHpPct) {
    const full = side.hp >= side.base.hp
    side.base.hp = Math.max(1, Math.round(side.base.hp * (1 + fx.maxHpPct / 100)))
    if (full) side.hp = side.base.hp
  }
  // ユニークの能力の状態（積み上がるもの・1回だけのもの）
  side.uq = {
    streak: 0, grow: {}, critStacks: 0, critDmg: 0, used: new Set(), allOn: false,
    firstDone: false, burst: false, ward: 0, seen: { phys: false, mag: false }, echoAcc: 0, ails: [], flat: {},
  }
}

export const setName = (side, key, fallback = '') => side?.setFx?.names?.[key] || fallback
const hpPct = (side) => (Math.max(0, side.hp) / Math.max(1, side.base.hp)) * 100

// ===== 状態異常 =====
// 受ける側のかかりにくさ（倍率）
export const setResistMult = (side, key) => {
  const fx = side?.setFx
  if (!fx) return 1
  return (fx.resist?.[key] ?? 1) * (fx.resistAll ?? 1)
}
// 付ける側の付けやすさ（倍率）
export const setInflictMult = (side, key) => {
  const fx = side?.setFx
  if (!fx) return 1
  return (fx.inflictUp?.[key] ?? 1) * (fx.inflictUpAll ?? 1)
}
// 毒の1刻みの倍率（付ける側の瘴気）
export const setPoisonMult = (side) => 1 + (side?.setFx?.poisonDmgPct || 0) / 100
// 受けた状態異常の持続を縮める（入った直後に呼ぶ）。1ターンしかないもの（麻痺）は縮めない＝かかることは変わらない
export const shortenAil = (side, key) => {
  const cut = side?.setFx?.ailTurnsCut || 0
  const a = cut ? side.ail?.[key] : null
  if (!a) return
  if (key === 'bleed') a.age = Math.min(BLEED_TURNS - 1, (a.age || 0) + cut)
  else if (a.turns > 1) a.turns = Math.max(1, a.turns - cut)
}
export const ailCountOfSide = (side) => AIL_KEYS.filter(k => hasAilment(side?.ail || {}, k)).length

// ===== ダメージ =====
// 受けるダメージの倍率（attacker＝撃った側・side＝受ける側）
// ★ユニーク：亀甲の大兜（状態異常でないとき）・地潜りの鉄靴（はじめの数ターン）・海王の潮汐ペンダント（偶数ターン）
//   side.turn は「経過したターン数」（1ターン目は0）＝偶数ターンは side.turn が奇数のとき
export const setTakenMult = (attacker, side) => {
  const fx = side?.setFx
  if (!fx) return 1
  let m = 1
  if (fx.takenCut) m *= 1 - fx.takenCut / 100
  if (fx.lowHpCut && hpPct(side) <= fx.lowHpCut.at) m *= 1 - fx.lowHpCut.cut / 100
  if (fx.vsSlowCut && hasAilment(attacker?.ail || {}, 'slow')) m *= 1 - fx.vsSlowCut / 100
  if (fx.calmCut && ailCountOfSide(side) === 0) m *= 1 - fx.calmCut / 100
  if (fx.earlyCut && (side.turn || 0) < fx.earlyCut.turns) m *= 1 - fx.earlyCut.pct / 100
  if (fx.tide?.even && (side.turn || 0) % 2 === 1) m *= 1 - fx.tide.even / 100
  return m
}
// クリティカルを受けたときの倍率（1発ごとに掛ける）
export const setCritTakenMult = (side) => 1 - (side?.setFx?.critTakenCut || 0) / 100
// 与ダメージの倍率（ダメージ全体に掛ける＝一次職の「与ダメージ+％」と同じ）。eMe・eFoe は liveStats のステ
// kind … この攻撃の種別（'phys'／'mag'）。ユニークの「物理ダメージ+%」が見る（渡さなければ種別で変わるものは乗らない）
export const setDealMult = (me, foe, eMe, eFoe, kind = null) => {
  const fx = me?.setFx
  if (!fx) return 1
  let pct = fx.dealPct || 0
  for (const v of fx.vsAilDmg || []) if (hasAilment(foe?.ail || {}, v.key)) pct += v.pct
  if (fx.fasterDmg && (eMe?.agi || 0) > (eFoe?.agi || 0)) pct += fx.fasterDmg
  // ★ユニーク：ケイヴキーパー（HPが低いとき）・ソリスティス（HPが高いとき）・サンダーフォール（物理）・海王の潮汐ペンダント（奇数ターン）
  for (const l of fx.lowHpDeal || []) if (hpPct(me) <= l.at) pct += l.pct
  for (const h of fx.hpDeal || []) pct += hpPct(me) >= h.at ? h.hi : h.lo
  if (kind && fx.kindDeal?.[kind]) pct += fx.kindDeal[kind]
  if (fx.tide?.odd && (me.turn || 0) % 2 === 0) pct += fx.tide.odd
  return 1 + pct / 100
}
// ★性別（v2cap・2026-10-21・src/v2cap/lib/gender.js）：sexDeal＝撃つ側の与えるダメージ+%（男性）・sexCut＝受ける側の受けるダメージ−%（女性）。
//   1発のダメージ（切り捨てたあとの整数 out）に掛け、**端数は確率で丸める**＝どの大きさのダメージでも平均でちょうど±%。
//   （ほかの能力と同じに切り捨ての前で掛けると、1発が数ダメージの序盤は 2→1.96→1 のように−2%が−27%（LV5で測った）になり、
//     +2%は 37→37.74→37 のように消える）
//   どちらも持たなければ何もしない（乱数も引かない＝今のⅡや性別の無いキャラ・敵の戦闘は1つも変わらない）
export const sexAdjust = (me, foe, out, rng) => {
  const up = me?.setFx?.sexDeal || 0
  const cut = foe?.setFx?.sexCut || 0
  if (!up && !cut) return out
  const x = out * (1 + up / 100) * (1 - cut / 100)
  const n = Math.floor(x)
  return Math.max(1, n + (rng() < x - n ? 1 : 0))
}
// ★ユニーク：防御無視（虚葬の錫杖＝魔法・パンツァーブレッヒャー＝物理）。防御無視の枠に足す割合（0〜1）
export const setDefPen = (me, kind) => (me?.setFx?.defIgnore?.[kind] || 0) / 100
// ★ユニーク：ウラノスの天砲（当てるたびクリティカルのダメージ+）。critDmgOf に足す%
export const setCritDmg = (me) => me?.uq?.critDmg || 0
// ★ユニーク：その状態異常にかからないか（炎竜鱗の手甲・九頭の鱗衣・深淵歩きの脚甲）
export const setImmune = (side, key) => !!side?.setFx?.immune?.includes(key)
// ★ユニーク：その状態異常の相手を攻撃したときに吸収する%（簒奪の刃）。攻撃を始める前の相手の状態で見る
export const setDrainPct = (me, foe) =>
  (me?.setFx?.drainIfAil || []).reduce((t, d) => t + (hasAilment(foe?.ail || {}, d.key) ? d.pct : 0), 0)

// ★ユニーク：liveStats が足すステ+%（statPct・turnGrow・hitGrow・critGrow・allSkillsBuff）。add(k, pct) を呼ぶ
//   ★バフ（side.buffs）に入れないので、相手の「強化を消す」では消えない（装備の能力）
export const addSetStats = (side, add) => {
  const fx = side?.setFx
  if (!fx || !side.uq) return
  for (const [k, v] of Object.entries(fx.statPct || {})) add(k, v)
  for (const g of fx.turnGrow || []) { const n = Math.min(g.max, g.per * (side.turn || 0)); if (n > 0) add(g.stat, n) }
  for (const [k, v] of Object.entries(side.uq.grow)) if (v > 0) add(k, v)
  if (fx.critGrow && side.uq.critStacks > 0) {
    const n = Math.min(fx.critGrow.max, fx.critGrow.per * side.uq.critStacks)
    for (const k of fx.critGrow.stats) add(k, n)
  }
  if (side.uq.allOn) for (const [k, v] of Object.entries(fx.allSkillsBuff || {})) add(k, v)
}
// ★ユニーク：liveStats が最後に足す固定の値（影縫いのブーツで奪ったAGI）
export const addSetFlat = (side, eff) => {
  for (const [k, v] of Object.entries(side?.uq?.flat || {})) eff[k] = Math.max(0, (eff[k] || 0) + v)
}
// 能力の名前（ログに出す）。無ければ fallback
export const fxName = (side, key, fallback = '') => side?.setFx?.names?.[key] || fallback

// ===== 1回だけのもの =====
// 蜃気楼：最初に受ける攻撃を完全にかわす。かわしたら true（ログも出す）
export const useSetDodge = (side, log) => {
  if (!side?.setFx?.dodgeOnce || side.setUsed.dodge) return false
  side.setUsed.dodge = true
  log.push({ side: side.name, type: 'setFx', name: setName(side, 'dodgeOnce', '蜃気楼'), text: '攻撃を完全にかわした！' })
  return true
}
// ダメージを受けたあと（攻撃でも毒・出血・火傷でも）。番人の守り（HP1で耐える）と天騎士の誓い（HP30%以下で回復）
// healMax … battle.js の healMaxAmount（回復量の補正を通した量を返す）・gain … HPを足す関数
export const setAfterDamage = (side, log, healMax, gain) => {
  const fx = side?.setFx
  if (!fx) return
  if (side.hp <= 0 && fx.gutsOnce && !side.setUsed.guts) {
    side.setUsed.guts = true
    side.hp = 1
    log.push({ side: side.name, type: 'setFx', name: setName(side, 'gutsOnce', '番人の守り'), text: 'HP1で踏みとどまった！' })
  }
  // ★ユニーク：常若の手甲（戦闘中1回、倒れるダメージを受けてもHP%で復活）。HP1で耐える能力が先
  if (side.hp <= 0 && fx.revive && !side.setUsed.revive) {
    side.setUsed.revive = true
    side.hp = Math.max(1, Math.floor(side.base.hp * fx.revive / 100))
    log.push({ side: side.name, type: 'uniqueFx', name: fxName(side, 'revive'), text: `HP${fx.revive}%で立ち上がった！（HP${side.hp.toLocaleString()}）` })
  }
  if (side.hp > 0 && fx.lowHpHealOnce && !side.setUsed.heal && hpPct(side) <= fx.lowHpHealOnce.at) {
    side.setUsed.heal = true
    const got = gain(side, healMax(side, fx.lowHpHealOnce.pct))
    log.push({ side: side.name, type: 'setFx', name: setName(side, 'lowHpHealOnce', '天騎士の誓い'), text: `HPが${got.toLocaleString()}回復した！` })
  }
}

// ===== 期限つきの効果 =====
// 自分にかける期限つきの効果（バフ・継続回復・受け止め など）のターン数に足すぶん（悠久の守り）
export const setTurnsUp = (side) => side?.setFx?.buffTurnsUp || 0

// いまの毎ターン回復（最大HPの%）。装備とセットを足して REGEN_CAP_PCT まで
export const regenPctOf = (side) => {
  const fx = side?.setFx
  if (!fx) return 0
  let p = fx.regenPct || 0
  if (fx.regenLow && hpPct(side) <= fx.regenLow.at) p += fx.regenLow.add
  return Math.min(REGEN_CAP_PCT, p)
}

// ===== ターンの終わり（tickRegen が呼ぶ）=====
// 森の恵み（最大HPの%）・根を張る（そのターンに受けたダメージの%）
export const tickSet = (side, log, healMax, gain, healMult = 1) => {
  const fx = side?.setFx
  if (!fx || side.hp <= 0) { if (side) side.rootAcc = 0; return }
  // ★装備とセットの毎ターン回復は合計 REGEN_CAP_PCT% まで（九頭の鱗衣のHPが低いときの上乗せも入れて数える）
  const regen = regenPctOf(side)
  if (regen > 0) {
    const got = gain(side, healMax(side, regen))
    log.push({ side: side.name, type: 'regenTick', heal: got, name: setName(side, 'regenPct', '森の恵み') })
  }
  if (fx.rootHealPct && side.rootAcc > 0) {
    const amt = Math.max(1, Math.floor(side.rootAcc * fx.rootHealPct / 100 * healMult))
    const got = gain(side, amt)
    log.push({ side: side.name, type: 'regenTick', heal: got, name: setName(side, 'rootHealPct', '根を張る') })
  }
  side.rootAcc = 0
}
