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
//   names {項目: 能力の名前}  ログに出す名前
// ============================================================
import { hasAilment, AIL_KEYS, BLEED_TURNS } from './ailments.js'

// createSide が呼ぶ。今あるパッシブ・エンチャントの枠に足せるものは、ここで足しておく（どの攻撃の道でも同じに効く）
export const initSet = (side, fighter) => {
  const fx = fighter?.setFx || null
  side.setFx = fx
  side.setUsed = { guts: false, dodge: false, heal: false }
  side.rootAcc = 0   // そのターンに受けたダメージ（根を張る）
  if (!fx) return
  if (fx.evaBonus) side.pa.evaBonus += fx.evaBonus
  if (fx.critBonus) side.pa.critBonus += fx.critBonus
  if (fx.mpCut) side.pa.mpCut += fx.mpCut
  if (fx.physCut) side.en.physCutPct = (side.en.physCutPct || 0) + fx.physCut
  if (fx.convertAdds?.length) side.en.convertAdds = [...(side.en.convertAdds || []), ...fx.convertAdds]
  if (fx.mpStartPct) side.mp += Math.floor(side.base.mp * fx.mpStartPct / 100)
  if (fx.earlyBuff) side.timedBuffs.push({ table: { ...fx.earlyBuff.table }, turns: fx.earlyBuff.turns })
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
export const setTakenMult = (attacker, side) => {
  const fx = side?.setFx
  if (!fx) return 1
  let m = 1
  if (fx.takenCut) m *= 1 - fx.takenCut / 100
  if (fx.lowHpCut && hpPct(side) <= fx.lowHpCut.at) m *= 1 - fx.lowHpCut.cut / 100
  if (fx.vsSlowCut && hasAilment(attacker?.ail || {}, 'slow')) m *= 1 - fx.vsSlowCut / 100
  return m
}
// クリティカルを受けたときの倍率（1発ごとに掛ける）
export const setCritTakenMult = (side) => 1 - (side?.setFx?.critTakenCut || 0) / 100
// 与ダメージの倍率（ダメージ全体に掛ける＝一次職の「与ダメージ+％」と同じ）。eMe・eFoe は liveStats のステ
export const setDealMult = (me, foe, eMe, eFoe) => {
  const fx = me?.setFx
  if (!fx) return 1
  let pct = fx.dealPct || 0
  for (const v of fx.vsAilDmg || []) if (hasAilment(foe?.ail || {}, v.key)) pct += v.pct
  if (fx.fasterDmg && (eMe?.agi || 0) > (eFoe?.agi || 0)) pct += fx.fasterDmg
  return 1 + pct / 100
}

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
  if (side.hp > 0 && fx.lowHpHealOnce && !side.setUsed.heal && hpPct(side) <= fx.lowHpHealOnce.at) {
    side.setUsed.heal = true
    const got = gain(side, healMax(side, fx.lowHpHealOnce.pct))
    log.push({ side: side.name, type: 'setFx', name: setName(side, 'lowHpHealOnce', '天騎士の誓い'), text: `HPが${got.toLocaleString()}回復した！` })
  }
}

// ===== 期限つきの効果 =====
// 自分にかける期限つきの効果（バフ・継続回復・受け止め など）のターン数に足すぶん（悠久の守り）
export const setTurnsUp = (side) => side?.setFx?.buffTurnsUp || 0

// ===== ターンの終わり（tickRegen が呼ぶ）=====
// 森の恵み（最大HPの%）・根を張る（そのターンに受けたダメージの%）
export const tickSet = (side, log, healMax, gain, healMult = 1) => {
  const fx = side?.setFx
  if (!fx || side.hp <= 0) { if (side) side.rootAcc = 0; return }
  if (fx.regenPct) {
    const got = gain(side, healMax(side, fx.regenPct))
    log.push({ side: side.name, type: 'regenTick', heal: got, name: setName(side, 'regenPct', '森の恵み') })
  }
  if (fx.rootHealPct && side.rootAcc > 0) {
    const amt = Math.max(1, Math.floor(side.rootAcc * fx.rootHealPct / 100 * healMult))
    const got = gain(side, amt)
    log.push({ side: side.name, type: 'regenTick', heal: got, name: setName(side, 'rootHealPct', '根を張る') })
  }
  side.rootAcc = 0
}
