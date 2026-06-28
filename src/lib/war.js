// ============================================================
// 戦争システムの戦闘計算（M1）
// ------------------------------------------------------------
// コア攻撃は「実効 攻撃力＋特攻」をもとにしたシンプルなダメージ（±10%乱数あり）。
//   power = eff.atk + eff.matk（装備/ペット/称号/熟練 込みの実効値）
//   raw   = floor(power × WAR_CORE_DMG_MULT × 乱数)   ← サーバ送信用の生ダメ
// 攻撃と特攻を両方足すので、物理型・魔法型・両刀型のいずれも公平に評価される。
// ※サーバ(war_attack_core)がこの生ダメージをさらに90%軽減して敵コアへ適用する。
//   （10ターン戦闘シミュ方式は出血等のDoTがコアの巨大HPで膨張するため廃止）
// ============================================================

import { simulatePvpBattle } from './pvp'

export const WAR_CORE_HP = 300000        // サーバ war_tick と一致（表示用）
export const WAR_CORE_REDUCTION = 0.9    // サーバ war_attack_core が適用（表示用）
export const WAR_TURN_CAP = 15           // 1回の交戦のターン上限（消耗戦＝15ターンで強制終了＝決着つかず）
// 戦争の戦闘調整（ここの3つで「DoT/回復が直接ダメを食う」問題をならす）。
//  DoT・回復はHP割合かつ防御無視で巨大HP環境だと過剰になりがち→下げる。直接ダメは圧縮が強い→上げる。
export const WAR_DOT_MULT  = 0.35        // 状態異常DoT(出血/毒/やけど等)の倍率。小さいほどDoTが弱い
export const WAR_DMG_MULT  = 1.5         // 通常/スキル与ダメの倍率。大きいほど直接ダメが通る
export const WAR_HEAL_MULT = 0.4         // 回復(スキル回復/リジェネ/血の狂気等)の倍率。小さいほど回復で粘れない
// per-hitの最低ダメージ保証（ターンが続かないと効きにくいので既定0=無効）。
export const WAR_MIN_DMG_PCT = 0
// ★終了時の最低保証ダメージ：仕掛けた側は最終的に「相手の開始HPのこの割合」を必ず与える。
//   交戦終了時に届いていなければ不足分を上乗せ＝戦闘力差があっても必ず一矢報いる（無双対策）。
//   例: 0.10 → 相手の開始HPが10000なら最低1000ダメージ保証。
export const WAR_MIN_END_DMG_PCT = 0.10
// 戦争中の最大HP補正（HPのみ・MPは据え置き）。開戦seed(war_tick)で現在HPにも+この値を
// 加算＝「満タンで参戦」。街と共有のまま戦争中だけ上限が広がる（終戦で通常上限に自然収束）。
// ※Game.jsx 側にも同値のローカル定数 WAR_HP_BONUS=10000 がある（循環import回避のため）。
export const WAR_HP_BONUS = 10000
// 全体スケールの最終つまみ。(攻撃力+特攻) に掛ける。サーバ側でさらに×0.1(90%軽減)。
// 較正(2026-06-28): 実測 power=6,619 → 6,619×7.55×0.1 ≒ 約5,000/発(目標)。
//   実効スケール = WAR_CORE_DMG_MULT × 0.1。CD20秒・コアHP30万で単独約20分。
export const WAR_CORE_DMG_MULT = 7.55

// コア攻撃（M1）。実効「攻撃力＋特攻」から ±10% の乱数込みでダメージを算出。
//  loadout: loadLoadout の戻り（自分の eff/equipment/skillSets 等）。
//  戻り: { raw=サーバ送信用の生ダメ(90%軽減前)・atk・matk・power=atk+matk }
export function simulateCoreAttack(loadout) {
  if (!loadout?.eff) return { raw: 1, atk: 0, matk: 0, power: 0 }
  const atk = Math.max(0, Math.floor(loadout.eff.atk || 0))
  const matk = Math.max(0, Math.floor(loadout.eff.matk || 0))
  const power = atk + matk
  const variance = 0.9 + Math.random() * 0.2  // ±10%（他の戦闘と同方針）
  const raw = Math.max(1, Math.floor(power * WAR_CORE_DMG_MULT * variance))
  return { raw, atk, matk, power }
}

// ============================================================
// 相互戦闘（M2-2）。1回の交戦＝最大HP+20000・20ターンで強制終了の消耗戦。
//   両者の持続HP/MPを開始値にして simulatePvpBattle を回し、終了値を返す。
//   攻撃側も削れる（攻撃したら自分も消耗する）。
//   ※ダメージ較正(防御レバレッジ撤廃/compressWarDmg)は実機の数値感を見てから（コアと同様）。
// ============================================================
//  attacker / target: loadLoadout（または dummyCombatInput）の戻り。
//  start: { atkHp, atkMp, tgtHp, tgtMp } 持続HP/MPの開始値。
//  戻り: { logs, atkEndHp, atkEndMp, tgtEndHp, tgtEndMp }
export function simulateWarBattle(attacker, target, start) {
  const res = simulatePvpBattle(attacker, target, {
    hpBonus: WAR_HP_BONUS, turnCap: WAR_TURN_CAP,   // 戦争中は最大HP+10000（満タン参戦の上限）
    warMode: true,                                  // ターン上限で両者生存なら「決着がつかなかった」表示
    atkDmgMult: WAR_DMG_MULT, dotMult: WAR_DOT_MULT, healMult: WAR_HEAL_MULT, // 直接ダメ↑/DoT↓/回復↓
    minDmgPct: WAR_MIN_DMG_PCT,                     // 防御無視の最低ダメージ保証（無双対策）
    startHpA: start?.atkHp, startMpA: start?.atkMp,
    startHpB: start?.tgtHp, startMpB: start?.tgtMp,
  })
  const logs = res.logs || []
  let tgtEndHp = res.endHpB
  // ★終了時の最低保証: 仕掛けた側は相手の開始HPの WAR_MIN_END_DMG_PCT 以上を必ず与える。
  //   届いていなければ終了時に不足分を上乗せ（一矢報いた！）。戦闘力差があっても無双させない。
  if (start?.tgtHp != null && WAR_MIN_END_DMG_PCT > 0) {
    const cap = Math.max(0, Math.floor(start.tgtHp * (1 - WAR_MIN_END_DMG_PCT)))  // 開始HPの(1-割合)
    if (tgtEndHp > cap) {
      const extra = tgtEndHp - cap
      tgtEndHp = cap
      logs.push({ text: `🏹 一矢報いた！ 最低保証ダメージ +${extra.toLocaleString()}（相手の開始HPの${Math.round(WAR_MIN_END_DMG_PCT * 100)}%保証）`, color: '#ffcc44' })
    }
  }
  return {
    logs,
    atkEndHp: res.endHpA, atkEndMp: res.endMpA,
    tgtEndHp, tgtEndMp: res.endMpB,
  }
}

// NPCダミー参加者の戦闘入力（実プロフィールを持たないため hp_max から簡易ステを合成）。
//  まずは「殴れば削れて殴り返しも来る」程度の的。数値は実機で調整。
export function dummyCombatInput(row) {
  const hp = Math.max(1, row?.hp_max || 50000)
  return {
    eff: { hp_max: hp, mp_max: 0, atk: 4000, def: 1500, matk: 0, mdef: 1500, spd: 120 },
    equipment: [], skillSets: [], proficiency: [],
    profile: { username: 'ダミー兵', class: 'ダミー', retraining: {}, activePet: null },
    playerItem: null,
  }
}
