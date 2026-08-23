// ============================================================
// バトルフロンティアⅡ（リメイク版）— ATBの仮想敵（試し撃ち用）
// ------------------------------------------------------------
// ★**開発用のかかし**。ゲームには出てこない（報酬も無い）。
//   エリアの雑魚では弱すぎて、ATBの駆け引き（大技を溜める・バフを撒く・
//   状態異常を切らさない）が何も起きないまま終わってしまうので、
//   **ユニークボスを想定した強さの相手**をその場で組み立てる。
//
// 強さは**挑む本人のステータスから**決める（戦闘力に比例）。
//   ・HPは[ユニークボス設計](../../../docs/v2-unique-boss-design.md)の式  HP = 96 × P × (P/2000)^0.22
//     ＝**与ダメージが戦闘力に対して超線形に伸びる**ぶんを吸うので、強い人でも短く終わらない
//   ・AGIは**プレイヤーとの比**で置く（1.0＝等速／2.0＝相手が倍速）。
//     ATBのつまみ（atb.js の AGI_EFFECT）がどう効くかを、この比を変えて確かめられる
//   ・MPは切らさない（かかしなので、技を撃ち続けてもらわないと意味がない）
// ============================================================
import { ENEMY_SKILLS as S, statsOf } from './enemies.js'
import { calcPower } from './stats.js'

// ユニークボスのHP式（docs/v2-unique-boss-design.md §3）
export const bossHpOf = (power) => Math.round(96 * power * Math.pow(Math.max(1, power) / 2000, 0.22))

// 戦闘力の配分（%）。**HPもここに含める**＝挑む本人と同じ土俵で組み立てる。
// ★2026-08-23：以前は HP だけ bossHpOf（ユニークボスの式）で別置きしていたので、
//   同じ戦闘力を名乗りながらHPが本人の90倍あり、**どの職も30秒で全滅**して測定にならなかった。
//   いまは「同じ戦闘力のキャラ」を作って、HPだけ hpMult 倍にする（長さのつまみ）。
const DIST = { hp:22, mp:8, str:20, dex:10, agi:10, int_stat:8, vit:16, luk:6 }
// 仮想ボスのHPを何倍にするか（1挑戦がだいたい1〜2分で終わる長さ）
export const BOSS_HP_MULT = 3

// 何もしない行動。かかし（木人）が殴り返さないために使う
const IDLE = { name:'ぼんやり', kind:'buff', proc:100, mp:0, buff:{ self:{} }, priority:1, desc:'何もしない' }

// 技の組み合わせ。**大技（proc 55〜60＝必要ゲージ180〜190）を混ぜてある**ので、
// 「相手のゲージがもうすぐ満タン＝大技が来る」という読み合いが起きる
export const KITS = {
  balanced: [S.こんぼう, S.ちからため, S.ほねきり, S.いわなげ, S.天穿雷撃],
  ail:      [S.かみつく, S.どくのほうし, S.つらら, S.でんげき, S.氷棺葬送],
  heavy:    [S.ようがんけん, S.かたくなる, S.いわなげ, S.略奪, S.炎獄の審判],
  fast:     [S.れっぷうそう, S.すばやくなる, S.ひっかく, S.しおのやり, S.天墜滅撃],
}

// 仮想敵1体を組み立てる
//   power … 戦闘力 ／ agi … AGIの実数（プレイヤー比で外から決める）
//   hp … 上書きするHP（省略すると DIST どおり×BOSS_HP_MULT）
const build = ({ name, power, agi, hp, kit, kind = 'phys', uses = 99 }) => {
  const stats = statsOf({ power, dist: DIST })
  stats.hp = hp ?? Math.round(stats.hp * BOSS_HP_MULT)
  stats.agi = Math.max(1, Math.round(agi))
  stats.mp = Math.max(stats.mp, Math.round(power * 2))   // MPは切らさない
  return { name, kind, stats, slots: kit.map(skill => ({ skill, uses })) }
}

// プレイヤーの fighter（loadout.js の toFighter が返す形）から仮想敵を並べる。
// 戻り値は { key, name, desc, power, hp, make() } の配列。make() が createAtb に渡せる形を返す
export const dummyFoes = (me) => {
  const s = me?.stats || {}
  const p = Math.max(100, calcPower(s))
  const agi = Math.max(1, s.agi || 1)
  const bossHp = Math.round(statsOf({ power: p, dist: DIST }).hp * BOSS_HP_MULT)
  const list = [
    { key:'mokujin', name:'木人', power:p, hp: 9999999, agi: agi, kit:[IDLE], kind:'phys',
      desc:'殴り返してこない。時間あたりどれだけ削れるかを測る用' },
    { key:'even', name:'仮想ボス【等速】', power:p, hp: bossHp, agi: agi, kit:KITS.balanced, kind:'phys',
      desc:'戦闘力もAGIも自分と同じ。ATBの基準になる相手' },
    { key:'fast', name:'仮想ボス【俊足】', power:p, hp: bossHp, agi: agi * 2, kit:KITS.fast, kind:'phys',
      desc:'AGIが自分の2倍。相手のほうが手数で上回る' },
    { key:'slow', name:'仮想ボス【鈍重】', power:Math.round(p * 1.3), hp: Math.round(bossHp * 1.3), agi: agi * 0.5, kit:KITS.heavy, kind:'phys',
      desc:'AGIは自分の半分だが硬くて重い。一発が痛い' },
    { key:'ail', name:'仮想ボス【状態異常】', power:p, hp: bossHp, agi: agi, kit:KITS.ail, kind:'mag',
      desc:'毒・出血・麻痺・鈍足を撒いてくる。状態異常の秒数を見る用' },
    { key:'x2', name:'仮想ボス【格上×2】', power:p * 2, hp: Math.round(statsOf({ power: p * 2, dist: DIST }).hp * BOSS_HP_MULT), agi: agi * 1.5, kit:KITS.balanced, kind:'phys',
      desc:'戦闘力が自分の2倍。まず勝てない相手' },
  ]
  return list.map(d => ({
    key: d.key, name: d.name, desc: d.desc, power: d.power, hp: d.hp,
    make: () => build(d),
  }))
}
