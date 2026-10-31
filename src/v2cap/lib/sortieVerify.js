// ============================================================
// 「レベルキャップあり」版（v2cap）— 出撃と塔の結果をサーバーが決める
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー選択「全部無効・無料で約1,400人」（経緯は docs/v2cap-design.md §10・SQL は §26）：
//   前はブラウザを書き換えれば「ボスに勝った」「レジェンダリーが落ちた」を8秒ごとに申告できた。いまは敵・勝ち負け・装備を画面から受け取らない。
//   ・出撃：Vercel の関数（api/v2cap-sortie.js）が SORTIE_BATCH 戦ぶんを先に決めて、画面から読めない表に入れておく（fillSortie）。
//     精算のたびに1つ取り出し、そのあとで種を画面へ渡す。画面は同じ種で再生してログを出す（decideSortie）
//   ・塔：相手が変わるので1戦ごと（decideTower）。勝ち負け・残りHP・守護者の姿もここで決める
//   ★先の結果は画面に見えない＝悪い結果だけを捨てて引き直すことはできない（種も1つずつ別に引く。前の種から次は分からない）
//   ★重さ：1戦0.2ミリ秒ほど・30戦で数ミリ秒。呼び出しは1人1日480戦として月720回ほど（無料枠の月100万回で約1,400人）
//   ★自分は毎回作り直す（前の戦闘の影響を残さない）。時刻は写しの at だけを見る（いまの時計を見ない＝画面とサーバーで同じ）
// ⚠戦闘が読むプロフィールの列を増やしたら SQL の v2cap_sortie_sig にも足す（sortieVerify.test.js が突き合わせる）
// ============================================================
import { seedRng } from '../core/atb.js'
import { runBattle } from '../core/battle.js'
import { calcPower } from '../core/stats.js'
import { toFighter as enemyFighter } from './areas.js'
import { ascEffectsOf } from './ascension.js'
import { activeMealOf } from './burger.js'
import { artGenderOf } from './gender.js'
import { toFighter as playerFighter } from './loadout.js'
import { SHINKA_ON, srecOfBattle } from './shinka.js'
import { encounterClockOf } from './shop.js'
import { shrineEncounterOf } from './shrine.js'
import { nextBossRate, pickEncounter, rollEquipDrop } from './sortie.js'
import { champOf, guardDropBonusOf, hpPmOf, rollTowerDrop, snapshotOf, towerBattleOf } from './tower.js'

export const SORTIE_BATCH = 30   // まとめて決める戦闘の数（10秒に1戦で約5分ぶん）

// 種を1つ引く（前の種から次を当てられないように、毎回別に引く）
export const randomSeed = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0]

// 写しから決まるもの：at＝写しを取った時刻・meal＝そのとき効いている食事
const clockOf = (snap) => new Date(Number(snap.at))
const fedFighterOf = (snap, at) => playerFighter(snap.prof, snap.inv, { meal: activeMealOf(snap.prof, at), at })

// 出撃の1戦を種から決める（画面もサーバーも同じ関数）。shrineSpot＝安息の祠の中ならその場所・rate＝このときのボスの出やすさ
export const decideSortie = ({ snap, spot, shrineSpot = null, rate = 0, seed, forcePapia = false }) => {
  const at = clockOf(snap)
  const me = fedFighterOf(snap, at)
  const rng = seedRng(seed)
  // ★日月反転の秘薬が効いているあいだは時間帯が12時間ずれる（lib/shop.js）。ドロップの時刻（落ちやすい部位）は本当の時刻のまま
  const enc = shrineSpot ? shrineEncounterOf(shrineSpot) : pickEncounter(spot, rate, encounterClockOf(snap.prof, at), rng, forcePapia)
  const r = runBattle(me, { ...enemyFighter(enc.enemy, 8, enc.power), boss: enc.isBoss }, { rng })
  const win = r.winner === 'a'
  // ★防具のセット能力「海賊の嗅覚」・塔の階層守護者のドロップ率+1%もここで効かせる（祠の中は装備が落ちない）
  const drop = win && !shrineSpot
    ? rollEquipDrop(enc, snap.prof.class, at, rng, me.setFx?.rareDropMult || 1, guardDropBonusOf(snap.prof))
    : null
  return { me, enc, r, win, drop }
}

// 次の n 戦をまとめて決める。{ seed, rate, enemy, win, drop } の並び（精算は enemy・win・drop を使い、画面は seed と rate で再生する）
export const fillSortie = ({ snap, spot, shrineSpot = null, rate = 0, forcePapia = false, n = SORTIE_BATCH }) => {
  let now = Number(rate) || 0
  return Array.from({ length: n }, (_, i) => {
    const seed = randomSeed()
    const force = forcePapia && i === 0
    const d = decideSortie({ snap, spot, shrineSpot, rate: now, seed, forcePapia: force })
    const entry = { seed, rate: now, enemy: d.enc.enemy.name, win: d.win, drop: d.drop ? d.drop.item.id : null }
    if (force) entry.force = true
    if (SHINKA_ON) entry.rec = srecOfBattle(d.r, d.me.name)   // お蔵入りのあいだは持たない
    if (!shrineSpot) now = nextBossRate(now, d.enc.isBoss)    // 祠の中ではボスの出やすさを変えない（サーバーと同じ）
    return entry
  })
}

// 塔の1戦を種から決める（画面もサーバーも同じ関数）。row＝守護者の行の写し（空きの層＝NPCなら null）
// ★ニャーガーキングの食事は戦うときだけ足す。NPCの底上げ・連勝補正の比べ合い・守護者として残す姿は食事なし
export const decideTower = ({ snap, floor, row = null, seed }) => {
  const at = clockOf(snap)
  const prof = snap.prof
  const me = playerFighter(prof, snap.inv, { meal: null, at })
  const myPower = calcPower(me.stats)
  const champ = champOf(floor, row || undefined, myPower)
  const { a, b, bonus } = towerBattleOf({ me: fedFighterOf(snap, at), myLv: prof.lv, champ, floor, myPower })
  const rng = seedRng(seed)
  const r = runBattle(a, b, { rng })
  // 装備は出撃のふつうの敵と同じ（開いている一番先の場所・勝ち負けによらず）
  const drop = rollTowerDrop(prof.cleared_spots, prof.class, at, rng, me.setFx?.rareDropMult || 1)
  return { me, champ, b, bonus, r, win: r.winner === 'a', drop }
}

// 塔の結果（v2cap_tower_try に入れて、v2cap_tower_fight が使う形）
export const towerResultOf = ({ snap, floor, row, seed }) => {
  const d = decideTower({ snap, floor, row, seed })
  return {
    seed, win: d.win,
    my_hp_pm: hpPmOf(d.r.a), my_mp: Math.max(0, Math.round(d.r.a.mp)),
    foe_hp_pm: hpPmOf(d.r.b), foe_mp: Math.max(0, Math.round(d.r.b.mp)),
    drop: d.drop ? d.drop.item.id : null,
    snapshot: snapshotOf(d.me, { lv: snap.prof.lv, gender: artGenderOf(snap.prof, 'm'), ups: ascEffectsOf(snap.prof).ups }),
  }
}
