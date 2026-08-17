// ============================================================
// バトルフロンティアⅡ（リメイク版）— アリーナ（対人）
// ------------------------------------------------------------
// あるけみすとの「天空闘技場」と同じ仕組み（2026-08-16 ユーザー指示）。
// 出典：https://wikiwiki.jp/alchemist-p/天空闘技場
//
//   ・各階に**階層守護者**（守る側）がいて、挑戦者は自分がいる階の階層守護者と戦う
//   ・勝つとその階の階層守護者になる。**守っているあいだは挑戦できない**
//   ・自分の階層守護者が破られると解放され、**1つ上の階**へ挑戦できるようになる
//   ・挑戦して負けると**1つ下**の階へ（**戦闘力に関係なく必ず落ちる**）
//   ・**挑戦者はHP/MPが毎回全回復、階層守護者は回復しない**（連続で守ると削れる）
//   ・n連勝中の階層守護者に挑むと、挑戦者の**HP/MP以外の全ステが +5n%**
//   ・EXPは勝敗によらず 9〜13。**装備も勝敗によらず**同じ確率で落ちる（2026-08-17 ユーザー決定）
//     ★ドロップ率は**出撃とまったく同じ**（sortie.js の DROP_RATE ＝ 10秒3%／20秒4%）。
//       2026-08-17まで独自の25%を持っていて、出撃の6〜8倍こぼれていた。
//       クールタイムを共有する以上、1行動あたりの旨みは揃っていないといけない。
//       ここに独自の数字を戻さないこと（arena.js からは定数ごと消してある）
//     ★落ちるランクは**どの階でも同じ表**（DROP_RANKS）。F〜Sまで出るが、
//       ランクが高いほど出にくい。階ごとに変えない（2026-08-17 ユーザー決定）
//   ・出撃（あるけみすとの「探索」）と**クールタイムを共有**する
//
// ★wikiに記載が無くこちらで決めたもの（2026-08-16）：
//   ・階層数＝50（ユーザー決定）
//   ・**席を降りても1つ上へ進める**（2026-08-17 ユーザー決定）。あるけみすとには
//     「降りる」自体が無く、破られるまで上へ行けない。人が少ないと詰むので足した
//   ・負けたときに落ちるのは**1つ下**（ユーザー決定）。wikiの記載は「2つ下」だが、
//     「上がった次で失敗したら元の階に戻る」形にそろえたいとの指示
//   ・階ごとの戦闘力の目安と、空き階に置くNPC階層守護者（ユーザー決定）
//     あるけみすとには無い仕組み。向こうは人が多いので空き階が出ない。
//
// ★戦闘そのものはクライアントの runBattle が回し、結果をサーバーへ申告する。
//   v2の戦闘は全部この形（出撃も同じ）。対人なので申告を信じる穴は残る＝
//   一般公開の前にサーバー権威化の判断が要る。
// ============================================================
import { STAT_KEYS } from './stats.js'
import { skillsOf, SKILLS } from './skills.js'
import { CLASS_BONUS } from './classBonus.js'

export const FLOORS = 50          // 最上階
export const EXP_MIN = 9          // 勝敗によらずもらえるEXP
export const EXP_MAX = 13
export const STREAK_PCT = 5       // n連勝中の相手に挑むと 5n%（HP/MPを除く）
export const LOSE_DROP = 1        // 負けたときに落ちる階数
export const LOW_FLOOR = 30       // ここ以下は連勝補正が強化される（wikiの「30階以下」）
export const LOW_FLOOR_MULT = 2   // 強化の倍率（wikiに数字が無いのでこちらで決めた）

// ===== 落ちるランク（2026-08-17 ユーザー決定）=====
// **どの階でも同じ表**。F〜Sまで全部出るが、ランクが高いほど出にくい。
// ★出撃はエリアごとに表が違う（エリア①はF〜Dだけ、など）。アリーナは階で変えない。
//   合計100なので、そのまま「落ちたうちの何%か」として読める。
export const DROP_RANKS = { F: 40, E: 25, D: 15, C: 10, B: 6, A: 3, S: 1 }

// ===== 階層守護者でいるあいだの恩恵（2026-08-17 ユーザー決定）=====
// **守っているあいだ、出撃のルーン素材と装備のドロップ率がわずかに上がる。**
//   守るとアリーナには挑戦できなくなる（KOTHの仕様）ので、その間は出撃が得になる、という置き方。
// ★倍率は**何階を守っていても同じ**（ユーザー決定「一律×1.1」）。
//   ルーンの特殊能力が素材ドロップ率×1.2〜×1.5 なので、それより控えめ＝「わずかに」。
// ⚠**この倍率はクライアント側の確率**（サーバーは1戦闘あたりの個数しか検証できない）。
//   ルーンの「素材ドロップ率up」と同じ扱い＝サーバー権威化するときは一緒に直すこと。
export const GUARD_DROP_MULT = 1.1
// defending … v2_arena_floors の自分の行（守っていなければ null）
export const guardDropMultOf = (defending) => (defending ? GUARD_DROP_MULT : 1)

// ===== 階ごとの戦闘力の目安 =====
// 1階＝はじめたて、50階＝エリア⑧のボス級（28,000前後）になるよう指数で並べる
export const FLOOR_BASE = 150
export const FLOOR_GROWTH = 1.114
export const powerOfFloor = (floor) =>
  Math.round(FLOOR_BASE * Math.pow(FLOOR_GROWTH, Math.max(1, Math.min(FLOORS, floor)) - 1))

// 負けたときに次に挑戦する階。**戦闘力に関係なく、負けたら必ず1つ落ちる**
// ⚠**「戦闘力が足りていれば落ちない」という下限は廃止した**（2026-08-17 ユーザー決定）。
//   もともと wiki の「戦力値」を真似て入れていたが、**サーバー（v2_arena_fight）は
//   その下限を実装しておらず必ず1つ落としていた**＝画面の「次は◯階から」だけがズレていた。
//   権威はサーバーなので、そちらの挙動（必ず落ちる）へ合わせる。
export const floorAfterLose = (floor) => Math.max(1, floor - LOSE_DROP)
// 階層守護者を破られたときに次に挑戦する階（1つ上。最上階なら据え置き）
export const floorAfterDefended = (floor) => Math.min(FLOORS, floor + 1)

// ===== 連勝補正 =====
// n連勝中の階層守護者に挑む側が強くなる（居座り続けられないようにするための仕組み）。
// 30階以下は戦闘力の差が開いているときだけ補正が強くなる＝下の階で詰まらせない
export const streakBonusPct = (streak, floor = FLOORS + 1, myPower = 0, foePower = 0) => {
  const n = Math.max(0, Math.floor(streak || 0))
  if (!n) return 0
  const low = floor <= LOW_FLOOR && foePower > myPower
  return n * STREAK_PCT * (low ? LOW_FLOOR_MULT : 1)
}

// 補正を乗せたステータス。★HPとMPには乗せない（居座り対策であって耐久勝負にしない）
export const applyStreakBonus = (stats, pct) => {
  if (!pct) return { ...stats }
  const out = {}
  for (const k of STAT_KEYS) {
    const v = stats?.[k] || 0
    out[k] = (k === 'hp' || k === 'mp') ? v : Math.round(v * (1 + pct / 100))
  }
  return out
}

// ===== NPC階層守護者 =====
// 空いている階に置く。人が少ないうちに中身が空にならないようにするための仕組みで、
// **本人が勝てば入れ替わる**（NPCは席が空いたときだけ戻ってくる）。
// ★一般公開のときに外すなら NPC_ENABLED を false にする
export const NPC_ENABLED = true

// 階ごとに就いている職業。上位職を順に回す（同じ階なら必ず同じ職業になる）
export const NPC_CLASSES = Object.keys(CLASS_BONUS)
export const npcClassOf = (floor) => NPC_CLASSES[(floor - 1) % NPC_CLASSES.length]

// 名前。階と職業で決まるので、見るたびに変わらない
export const NPC_TITLES = ['流浪の', '無名の', '古参の', '歴戦の', '不倒の', '天鳴の']
export const npcNameOf = (floor) =>
  `${NPC_TITLES[(floor - 1) % NPC_TITLES.length]}${npcClassOf(floor)}`

// 戦闘力の配り方。職業のメイン／サブへ厚くする（プレイヤーらしい形にする）
// HPは8・MPは3で戦闘力1ぶんなので、そのぶん量を増やす
const UNIT = { hp: 8, mp: 3 }
export const npcStatsOf = (floor) => {
  const cls = npcClassOf(floor)
  const b = CLASS_BONUS[cls] || {}
  const power = powerOfFloor(floor)
  // 8種へ配る割合(%)。HPを厚めにして、殴り合いが1発で終わらないようにする
  const dist = { hp: 26, mp: 8, str: 8, dex: 8, agi: 8, int_stat: 8, vit: 8, luk: 8 }
  if (b.main) dist[b.main] += 12
  if (b.sub)  dist[b.sub]  += 6
  const total = Object.values(dist).reduce((a, c) => a + c, 0)
  const out = {}
  for (const k of STAT_KEYS) out[k] = Math.max(1, Math.round(power * (dist[k] / total) * (UNIT[k] || 1)))
  return out
}

// 使うスキル。その職業のスキルから、パッシブでないものを上から4つ
export const npcSlotsOf = (floor) => {
  const cls = npcClassOf(floor)
  const list = skillsOf(cls).filter(s => s.kind !== 'passive')
  const use = (list.length ? list : SKILLS.filter(s => s.cls === 'ノーブル')).slice(0, 4)
  return use.map(s => ({ skill: s, uses: 3 }))
}

// runBattle に渡せる形。プレイヤーのスナップショットと同じ形にそろえてある
export const npcChampOf = (floor) => ({
  npc: true,
  name: npcNameOf(floor),
  cls: npcClassOf(floor),
  jobCount: 0,
  stats: npcStatsOf(floor),
  enchants: [],
  slots: npcSlotsOf(floor),
})

// ===== スナップショット =====
// 階層守護者は**その階に就いたときの姿**で戦う。あとで装備を外しても弱くならないし、
// 相手の今のデータを読みに行かなくて済む（他人の行を見ないで完結する）。
export const snapshotOf = (fighter) => ({
  npc: false,
  name: fighter.name,
  cls: fighter.cls,
  jobCount: fighter.jobCount || 0,
  stats: { ...fighter.stats },
  enchants: [...(fighter.enchants || [])],
  // スキルは名前と回数だけ持つ（実体は SKILL_BY_NAME で引き直す）
  slots: (fighter.slots || []).map(s => ({ name: s.skill?.name, uses: s.uses })),
})

// スナップショットを runBattle に渡せる形へ戻す
export const fromSnapshot = (snap, skillByName) => ({
  ...snap,
  slots: (snap.slots || [])
    .map(s => ({ skill: s.skill || skillByName?.[s.name], uses: s.uses || 1 }))
    .filter(s => s.skill),
})

// その階の階層守護者（空いていればNPC）
export const champOf = (floor, row, skillByName) => {
  if (row?.snapshot) return { ...fromSnapshot(row.snapshot, skillByName), hp: row.hp, mp: row.mp, streak: row.streak || 0 }
  if (!NPC_ENABLED) return null
  const npc = npcChampOf(floor)
  return { ...npc, hp: npc.stats.hp, mp: npc.stats.mp, streak: 0 }
}

// 挑戦できるか。守っているあいだは挑戦できない（wikiと同じ）
export const canChallenge = ({ defending = null } = {}) => (defending ? '守っているあいだは挑戦できません' : '')

export const expOf = (rng = Math.random) => EXP_MIN + Math.floor(rng() * (EXP_MAX - EXP_MIN + 1))
// ★装備が落ちるかどうかは出撃の rollHasDrop を使う（sortie.js）。ここには持たない
