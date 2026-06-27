// ============================================================
// 戦争システムの戦闘計算（M1）
// ------------------------------------------------------------
// コア攻撃は「実際にスキルを撃って10ターン戦う」シミュレーション。
// 既存のPvP戦闘エンジン(simulatePvpBattle)を再利用し、コアを
// 「無反撃・超高HP・防御0のダミー」として殴り、与えた合計ダメージを測る。
// → 物理/魔法どちらのスキルも実発動するので、両刀(atk+matk)ビルドも正当に評価される。
// ※サーバ(war_attack_core)がこの生ダメージをさらに90%軽減して敵コアへ適用する。
// ============================================================
import { simulatePvpBattle } from './pvp'

export const WAR_CORE_HP = 300000        // サーバ war_tick と一致（表示用）
export const WAR_CORE_REDUCTION = 0.9    // サーバ war_attack_core が適用（表示用）
export const WAR_CORE_TURNS = 10         // コア戦のターン数（強制終了）
export const WAR_CORE_DMG_MULT = 1.0     // 全体スケールの最終つまみ（数値感の調整用）

const CORE_DUMMY_HP = 100000000          // コアダミーのHP（10ターンで絶対に落ちない大きさ）

// コア（ダミー防御側）の戦闘入力。ステ0・スキル無し・無反撃に近い。
//  simulatePvpBattle の inputB として渡す。
function coreInput() {
  return {
    eff: { hp_max: CORE_DUMMY_HP, mp_max: 0, atk: 0, def: 0, matk: 0, mdef: 0, spd: 1 },
    equipment: [],
    skillSets: [],
    proficiency: [],
    profile: { username: '敵コア', class: 'コア', retraining: {}, activePet: null },
    playerItem: null,
  }
}

// コア攻撃の生ダメージ（M1）。
//  loadout: loadLoadout の戻り（自分の eff/equipment/skillSets 等）。
//  自分の出撃/対人スキルで10ターン殴り、コアに与えた合計ダメージを返す。
//  戻り値はサーバ war_attack_core に渡す「90%軽減前」の生ダメージ。
export function simulateCoreAttackRaw(loadout) {
  if (!loadout) return 1
  const res = simulatePvpBattle(loadout, coreInput(), { hpBonus: 0, turnCap: WAR_CORE_TURNS })
  const dealt = CORE_DUMMY_HP - (res.endHpB ?? CORE_DUMMY_HP)
  return Math.max(1, Math.floor(dealt * WAR_CORE_DMG_MULT))
}
