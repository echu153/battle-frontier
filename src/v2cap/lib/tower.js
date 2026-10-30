// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 塔（あるけみすと型の対人）
// ------------------------------------------------------------
// 【確定】2026-10-14 ユーザー指示「普通にあるケミ風のPVPも用意しておく・○○の塔みたいな感じで1層～100層くらいまで
//   どんどん塔に上る感じ」「該当者は画像みたいに現在の職業のアイコンが表示されるように」
//   「仕様はあるケミと一緒、階層守護者になっている間はドロップ率1%増加」
//   ＋選択式で決めたこと：今から作る／負けたら2つ下（あるけみと同じ）／空き層にNPC＋席を降りられる（今のⅡと同じ）／
//   報酬は出撃と同じ旨み（勝ち負けによらず）
// 仕組みは あるけみすとの「天空闘技場」（https://wikiwiki.jp/alchemist-p/天空闘技場）＝今のⅡのアリーナ（src/v2/lib/arena.js（V2 初期構成・2026-10-22 に消した））と同じ形：
//   ・1〜100層。各層に**階層守護者**がいて、挑戦する人は自分のいる層の守護者と戦う
//   ・勝つとその層の守護者になる。**守っているあいだは挑戦できない**
//   ・守っている層を破られると、**1つ上の層**へ挑戦できるようになる。**自分から席を降りても1つ上へ**（今のⅡと同じ）
//   ・挑戦して負けると **2つ下** の層へ（あるけみと同じ）
//   ・**挑戦する側はHP/MPが毎回満タン、守護者は回復しない**（守るたびに減る）
//   ・n連勝中の守護者に挑むと、挑戦する側の **HP/MP以外のステが +5n%**（30層以下で相手のほうが強いときは2倍＝今のⅡと同じ）
//   ・**勝ち負けによらず**、出撃と同じ旨み：開いている一番先の場所の「ふつうの敵1体ぶん」のEXP・Gold＋装備（落ちる確率もレア度も同じ）
//   ・出撃と**待ち時間を共有**する（10秒・サーバーの last_sortie_at）
//   ・**守護者でいるあいだ、出撃の装備のドロップ率+1%**（ふつうの敵 8→9%・レアとボス 10→11%）
//   ・空いている層には**NPCの守護者**（n層＝LVnの標準の強さ。ただし挑戦する人の戦闘力×NPC_MIN_RATIO より弱くしない）
//   ・一覧は守護者の**職業のアイコン（デフォルメの絵）・LV・名前**（ユーザーの画像の形）。上位職はデフォルメの絵がまだ無いので系統の初期職の絵
// こちらで決めた既定（報告済み）：
//   ・対人のHPは pvp.js の倍率（LV25 ×3.5・LV50 ×5・LV80以上 ×6・2人のうち高いほうのLV）
//   ・守護者の残りHPは「最大HPの千分率」で持つ（相手のLVで倍率が変わっても割合で引き継ぐ）。MPはそのままの値
//   ・あるけみの「階ごとの戦力値を超えていれば落ちない」は入れない（今のⅡでもやめた。負けたら必ず2つ下）
// ★戦闘は画面の runBattle で回し、結果をサーバー（v2cap_tower_fight）へ申告する（出撃と同じ形＝申告を信じる穴は残る。
//   公開の前に、出撃と一緒にサーバーで戦闘を回すか決める＝設計書 §10）
// ⚠数を変えたら SQL（supabase_v2cap_core.sql の §13）の c_… も直す（v2capsql.test.js が突き合わせる）
// ============================================================
import { STAT_KEYS, INITIAL_STATS, calcPower, totalPointsTo, POINT_UNIT } from './level.js'
import {
  START_CLASSES, ICHIJI_CLASSES, ICHIJI_RENAMED, CLASS_BY_ID, JOB_BONUS, attackKindOf, lineageOf, skillsLearnedBy,
  jobMaxOf, bonusSeqOf, jobBonusStats, stageOf,
} from './jobs.js'
import { defaultSetOf, fillSetOf, passiveOf, SKILL_BY_NAME, SKILL_RENAMED } from './skills.js'
import { slotsOf } from './loadout.js'
import { CAP_RULES, CAP_STR_PHYS_DEF } from './rules.js'
import { stdPowerAt, spotOf } from './areas.js'
import { openUntilOf, rollEquipDrop, bandAt } from './sortie.js'
import { SHINKA_ON, isShinka, shinkaEvolutionOf } from './shinka.js'
import { ART_SD, battleIconOf } from './classArt.js'
import { pvpHpMultFor, withPvpHp } from './pvp.js'

// 【確定】2026-10-14 ユーザーが決めた名前（「○○の塔みたいな感じ」→ 仮の「天空の塔」から選び直した）。画面の名前はここだけ
export const TOWER_NAME = 'ジークヴァルトの覇天塔'
// 【確定】2026-10-31 ホームのメニューの札だけ短く（ユーザー指示「ジークヴァルトのはてんとうは覇天塔だけにして」）。塔の画面の題などは TOWER_NAME のまま
export const TOWER_SHORT_NAME = '覇天塔'
export const FLOORS = 100        // 最上層
export const LOSE_DROP = 2       // 挑戦して負けたら何層下がるか（あるけみと同じ）
export const STREAK_PCT = 5      // n連勝中の守護者に挑むと 5n%（HP/MPを除く）
export const LOW_FLOOR = 30      // ここ以下は、相手のほうが強いときだけ連勝補正を強くする（あるけみの「30階以下」）
export const LOW_FLOOR_MULT = 2  // 強くする倍率（今のⅡと同じ）
export const GUARD_DROP_BONUS = 1   // 守護者でいるあいだ、出撃の装備のドロップ率に足す%（ユーザー指示「1%増加」）

export const floorLabel = (f) => `${f}層`
export const clampFloor = (f) => Math.min(FLOORS, Math.max(1, Math.floor(Number(f) || 1)))
// 負けたら2つ下（1層より下には行かない）
export const floorAfterLose = (f) => Math.max(1, clampFloor(f) - LOSE_DROP)
// 守っている層を破られた・自分から降りた → 1つ上（最上層ならそのまま）
export const floorAfterDefended = (f) => Math.min(FLOORS, clampFloor(f) + 1)
// 挑戦できるか（守っているあいだはできない）。できなければ理由の文
export const canChallenge = ({ guarding = false } = {}) => (guarding ? '守っているあいだは挑戦できません' : '')

// 守護者でいるあいだの出撃の装備のドロップ率の上乗せ（%）。tower_guard＝守っている層（守っていなければ null）
export const guardDropBonusOf = (prof) => (prof?.tower_guard ? GUARD_DROP_BONUS : 0)

// ===== 連勝補正（今のⅡの arena.js と同じ）=====
export const streakBonusPct = (streak, floor = FLOORS + 1, myPower = 0, foePower = 0) => {
  const n = Math.max(0, Math.floor(streak || 0))
  if (!n) return 0
  const low = floor <= LOW_FLOOR && foePower > myPower
  return n * STREAK_PCT * (low ? LOW_FLOOR_MULT : 1)
}
// 補正を乗せたステータス。★HPとMPには乗せない（居座り対策であって耐久勝負にしない）
export const applyStreakBonus = (stats, pct) => {
  if (!pct) return { ...stats }
  return Object.fromEntries(STAT_KEYS.map(k => {
    const v = stats?.[k] || 0
    return [k, (k === 'hp' || k === 'mp') ? v : Math.round(v * (1 + pct / 100))]
  }))
}

// ===== アイコン =====
// デフォルメの絵（SD）があるクラスはその絵。上位職はSDがまだ無いので系統の初期職のSD（classArt.js の battleIconOf）。
// ★2026-10-17 上位職の全身の絵（顔のアップ）が入ったが、塔はデフォルメの絵でそろえるので ART_SD で決める（ART_BASE ではない）
export const iconClassOf = (cls) => {
  if (ART_SD[cls]) return cls
  const base = CLASS_BY_ID[cls]?.req?.cls
  return base && ART_SD[base] ? base : cls
}
export const towerIconSrc = (icon) => (icon?.cls ? battleIconOf(icon.cls, icon.g === 'f' ? 'f' : 'm') : null)

// ===== 空いている層のNPC =====
// n層のNPCは LVn・強さは LVn の標準の戦闘力（areas.js の stdPowerAt）。
// ★ただし挑戦する人の戦闘力×NPC_MIN_RATIO より弱くはしない（今のⅡと同じ考え方：下の層でも歯ごたえを出す）。
//   **負けたら2つ下**なので、3回に2回より多く勝てないと上がれない（1戦あたり 勝率×3−2 層ずつ上がる）。
//   → **×0.8**（今のⅡのアリーナと同じ値）。2026-10-14 に測って決めた（node tools/v2cap-progress.mjs --tower --hours 450・
//     初期職11職×2人・NPCの層は1〜自分のLV）：×0.7 98%・×0.8 89%・×0.9 77%・×1.0 60%・×1.2 37%（ターン数の中央値6〜12）。
//     ×1.0（同じ強さ）だと勝率6割＝上がれない。人が座っている層には効かない（本人の実力そのもの）
//   ★上位職などを調整したあとに測り直した値は、**設計書 §6-8 にだけ**並べる（ここには最初の値だけ。2か所に書くとずれる）
//   ⚠職業や技の数字を変えたら --tower で測り直し、×0.8で勝率（職業ごとでいちばん低いものも）が3分の2を割らないかを見る
export const NPC_MIN_RATIO = 0.8
export const floorPowerOf = (floor) => stdPowerAt(clampFloor(floor))
export const npcPowerFor = (floor, myPower = 0) =>
  Math.max(floorPowerOf(floor), Math.round((myPower || 0) * NPC_MIN_RATIO))

// 職業：25層より下は初期職、25層からは上位職を順に回す（上位職に就けるのはCLASS LV30＝LV24ごろ）
export const NPC_ICHIJI_FROM = 25
export const npcClassOf = (floor) => {
  const f = clampFloor(floor)
  return f < NPC_ICHIJI_FROM
    ? START_CLASSES[(f - 1) % START_CLASSES.length]
    : ICHIJI_CLASSES[(f - NPC_ICHIJI_FROM) % ICHIJI_CLASSES.length]
}
export const NPC_TITLES = ['流浪の', '無名の', '古参の', '歴戦の', '不倒の', '天鳴の']
export const npcNameOf = (floor) => `${NPC_TITLES[(clampFloor(floor) - 1) % NPC_TITLES.length]}${npcClassOf(floor)}`
export const npcGenderOf = (floor) => (clampFloor(floor) % 2 ? 'm' : 'f')

// NPCのCLASS LV。初期職はLVの1.2倍（最大30）＝最初の職業の進み方。上位職はシミュの進み方（LV24でCLASS LV10・27で20・34で30・43で40・53で50）
const ICHIJI_JLV_AT = [[24, 10], [27, 20], [34, 30], [43, 40], [53, 50]]
export const npcJlvOf = (cls, lv) => {
  const L = Math.max(1, Math.floor(lv || 1))
  if (stageOf(cls) !== 'ichiji') return Math.min(jobMaxOf(cls), Math.max(1, Math.round(L * 1.2)))
  if (L <= ICHIJI_JLV_AT[0][0]) return Math.max(1, Math.round(ICHIJI_JLV_AT[0][1] * L / ICHIJI_JLV_AT[0][0]))
  for (let i = 1; i < ICHIJI_JLV_AT.length; i++) {
    const [l1, j1] = ICHIJI_JLV_AT[i]
    if (L <= l1) {
      const [l0, j0] = ICHIJI_JLV_AT[i - 1]
      return Math.round(j0 + (j1 - j0) * (L - l0) / (l1 - l0))
    }
  }
  return jobMaxOf(cls)
}

// ステの形：本体（ステータスポイントをクラスのステと同じ割合で振る＝シミュと同じ）＋クラスのステ
const shapeOf = (cls, lv) => {
  const seq = bonusSeqOf(cls)
  const body = { ...INITIAL_STATS }
  for (let i = 0; i < totalPointsTo(lv); i++) {
    const k = seq[i % seq.length]
    body[k] += POINT_UNIT[k]
  }
  const job = jobBonusStats(cls, npcJlvOf(cls, lv))
  return Object.fromEntries(STAT_KEYS.map(k => [k, (body[k] || 0) + (job[k] || 0)]))
}
// 戦闘力が power になるステ。足りないぶんは装備の代わりとして、HP・MP以外へクラスのステの割合で足す
// （装備にHPは付かない＝プレイヤーと同じ形にする）。形のほうが強ければ全部を同じ割合で縮める
export const npcStatsOf = (cls, lv, power) => {
  const shape = shapeOf(cls, lv)
  const base = calcPower(shape)
  if (power <= base) {
    const m = power / Math.max(1, base)
    return Object.fromEntries(STAT_KEYS.map(k => [k, Math.max(1, Math.round(shape[k] * m))]))
  }
  const w = Object.entries(JOB_BONUS[cls] || {}).filter(([k]) => k !== 'hp' && k !== 'mp')
  const total = w.reduce((t, [, v]) => t + v, 0) || 1
  const out = { ...shape }
  for (const [k, v] of w) out[k] += Math.round((power - base) * v / total)
  return out
}
// 覚えている技（上位職は系統の初期職の技も）
const npcLearnedOf = (cls, lv) => {
  const jlv = npcJlvOf(cls, lv)
  return lineageOf(cls).flatMap(c => skillsLearnedBy(c, c === cls ? jlv : jobMaxOf(c)))
}
// 戦闘用のキャラ（プレイヤーの toFighter と同じ形）。編成は自分の職業の技を覚えた順に5枠（defaultSetOf）、空いた枠は系統の初期職の技
export const npcFighterOf = (floor, myPower = 0) => npcFighterAt(floor, npcPowerFor(floor, myPower))
// 強さ（戦闘力）を決めて作る（npcFighterOf と、強さを測る tools/v2cap-progress.mjs --tower が使う）
export const npcFighterAt = (floor, power) => {
  const f = clampFloor(floor)
  const cls = npcClassOf(f)
  const stats = npcStatsOf(cls, f, Math.max(1, Math.round(power || 1)))
  const learned = npcLearnedOf(cls, f)
  const lineage = lineageOf(cls)
  const set = fillSetOf(defaultSetOf(cls, learned, stats.mp), learned, { lineage, maxMp: stats.mp })
  const passive = passiveOf(cls)
  return {
    ...CAP_RULES,
    strDef: CAP_STR_PHYS_DEF,   // プレイヤーと同じ（STR を物理防御にも足す割合・rules.js）
    npc: true,
    name: npcNameOf(f),
    cls,
    lv: f,
    kind: attackKindOf(cls),
    stats,
    taken: null,
    enchants: [],
    evolutions: [],
    slots: slotsOf(set, cls, lineage),
    passives: passive ? [passive] : [],
    setFx: null,
    icon: { cls: iconClassOf(cls), g: npcGenderOf(f) },
  }
}

// ===== 守護者の姿（守護者になったときのまま戦う）=====
// ステ・防具の耐性とセット能力・LV・アイコンは、守護者になったときの値のまま。
// ★技は**名前・回数・アセンションの上がり幅（ups）だけ**持ち、戦うときに今の名簿から引き直す（今のⅡのアリーナと同じ）。
//   【2026-10-15 直した】最初の版（v:1）は技の中身ごと持っていた＝あとで技の数字を直しても守護者は古い数字のまま戦い、
//   名簿から消えた技も使い続けた（別セッションの上位クラスの作り直しで技の中身と名前が変わったときに指摘をもらった）。
//   いまは名簿に無い技は外れ、下位職の技を自分の職業の技として渡す形・アセンションの強化は loadout.js の slotsOf で付け直す。
//   v:1 の姿も読める（名前と回数だけ使う＝アセンションの上がり幅は持っていないので付かない）
// パッシブも職業から引き直す。前の名前の職業（上位クラスの並び替え・jobs.js の ICHIJI_RENAMED）は今の名前で読む
export const SNAPSHOT_V = 2
// ups … アセンションの技のマス（{ 技の名前: 上がり幅 }・ascension.js の ascEffectsOf(profile).ups）
export const snapshotOf = (fighter, { lv = 1, gender = 'm', ups = {} } = {}) => {
  const set = (fighter?.slots || []).filter(s => s?.skill?.name)
    .map(s => ({ name: s.skill.name, uses: Math.max(1, Math.floor(s.uses || 1)) }))
  return {
    v: SNAPSHOT_V,
    name: fighter?.name || '？',
    cls: fighter?.cls || null,
    kind: fighter?.kind || attackKindOf(fighter?.cls),
    lv: Math.max(1, Math.floor(lv || 1)),
    stats: Object.fromEntries(STAT_KEYS.map(k => [k, fighter?.stats?.[k] || 0])),
    taken: fighter?.taken || null,
    setFx: fighter?.setFx || null,
    shinka: isShinka(fighter?.shinka) ? fighter.shinka : null,   // 武器の真化（2026-10-26・shinka.js）。値は持たず名簿から引き直す
    set,
    ups: Object.fromEntries(set.filter(e => Number(ups?.[e.name]) > 0).map(e => [e.name, Number(ups[e.name])])),
    icon: { cls: iconClassOf(fighter?.cls), g: gender === 'f' ? 'f' : 'm' },
  }
}
// 姿の職業（前の名前なら今の名前）
export const snapClassOf = (cls) => (CLASS_BY_ID[cls] ? cls : ICHIJI_RENAMED[cls] || cls || null)
// 姿の技（名前と回数）。v:1 は技の中身ごと持っていた＝名前と回数だけ使う
const snapSetOf = (snap) => (Array.isArray(snap?.set)
  ? snap.set
  : (snap?.slots || []).map(s => ({ name: s?.skill?.name, uses: s?.uses })))
  .filter(e => e?.name)
  .map(e => ({ name: SKILL_RENAMED[e.name] || e.name, uses: Math.max(1, Math.floor(e.uses || 1)) }))
export const fromSnapshot = (snap) => {
  const cls = snapClassOf(snap?.cls)
  const passive = passiveOf(cls)
  const stats = Object.fromEntries(STAT_KEYS.map(k => [k, Math.max(0, Number(snap?.stats?.[k]) || 0)]))
  stats.hp = Math.max(1, stats.hp)
  const set = snapSetOf(snap)
  // 使える技の職業（自分と下位職）。名簿から消えた職業なら、技の職業で絞らない（名簿にある技はそのまま使う）
  const lineage = CLASS_BY_ID[cls] ? lineageOf(cls) : [...new Set(set.map(e => SKILL_BY_NAME[e.name]?.cls).filter(Boolean))]
  // アセンションの上がり幅も、前の名前の技は今の名前で読む
  const ups = snap?.ups && typeof snap.ups === 'object'
    ? Object.fromEntries(Object.entries(snap.ups).map(([k, v]) => [SKILL_RENAMED[k] || k, v])) : {}
  return {
    ...CAP_RULES,
    strDef: CAP_STR_PHYS_DEF,   // プレイヤーと同じ（STR を物理防御にも足す割合・rules.js）
    npc: false,
    name: snap?.name || '？',
    cls,
    kind: snap?.kind || attackKindOf(cls),
    lv: Math.max(1, Math.floor(snap?.lv || 1)),
    stats,
    taken: snap?.taken || null,
    enchants: [],
    // 武器の真化：時間帯の能力は**戦ういま**の時間帯で効くかを決める
    evolutions: SHINKA_ON ? [shinkaEvolutionOf(snap?.shinka, bandAt(new Date()))].filter(Boolean) : [],   // お蔵入りなら効かせない
    shinka: isShinka(snap?.shinka) ? snap.shinka : null,
    slots: slotsOf(set, cls, lineage, ups),
    passives: passive ? [passive] : [],
    setFx: snap?.setFx || null,
    icon: snap?.icon?.cls ? snap.icon : { cls: iconClassOf(cls), g: 'm' },
  }
}

// 残りHPの千分率（1〜1000）
export const clampPm = (v) => Math.min(1000, Math.max(1, Math.round(Number(v) || 0)))
// 戦い終わったときの残りHPの千分率（runBattle の a / b）
export const hpPmOf = (side) => clampPm(((side?.hp || 0) / Math.max(1, side?.base?.hp || 1)) * 1000)

// その層の守護者（空いていればNPC）。row＝v2cap_tower_floors の行（空いていれば undefined）
// ★myPower を渡すと、空いている層のNPCだけが「自分×NPC_MIN_RATIO」まで底上げされる
export const champOf = (floor, row, myPower = 0) => {
  if (row?.snapshot) {
    return {
      ...fromSnapshot(row.snapshot),
      playerId: row.player_id,
      since: row.since,
      hpPm: clampPm(row.hp_pm ?? 1000),
      mpNow: Math.max(0, Math.floor(row.mp ?? 0)),
      streak: Math.max(0, Math.floor(row.streak || 0)),
    }
  }
  const npc = npcFighterOf(floor, myPower)
  return { ...npc, playerId: null, since: null, hpPm: 1000, mpNow: npc.stats.mp, streak: 0 }
}
// 一覧の1行ぶん（名前・職業・LV・アイコン・連勝・残りHP）。NPCは戦闘用のキャラを作らずに出す
export const floorInfoOf = (floor, row) => {
  if (row?.snapshot) {
    const s = row.snapshot
    const cls = snapClassOf(s.cls)
    return {
      npc: false, playerId: row.player_id, name: s.name || '？', cls, lv: Math.max(1, Math.floor(s.lv || 1)),
      icon: s.icon?.cls ? s.icon : { cls: iconClassOf(cls), g: 'm' },
      streak: Math.max(0, Math.floor(row.streak || 0)), hpPm: clampPm(row.hp_pm ?? 1000),
    }
  }
  const cls = npcClassOf(floor)
  return {
    npc: true, playerId: null, name: npcNameOf(floor), cls, lv: clampFloor(floor),
    icon: { cls: iconClassOf(cls), g: npcGenderOf(floor) }, streak: 0, hpPm: 1000,
  }
}

// ===== 戦う =====
// me … 自分の戦闘用キャラ（loadout.js の toFighter）／myLv … 自分のLV／champ … champOf の守護者
// myPower … 連勝補正で比べる自分の戦闘力（省くと me から数える。ニャーガーキングの食事は入れない＝画面が食事なしの値を渡す）
// 返すもの：a（自分）・b（守護者）＝ runBattle にそのまま渡せる形、bonus（連勝補正の%）、mult（対人のHP倍率）
export const towerBattleOf = ({ me, myLv, champ, floor, myPower = calcPower(me.stats) }) => {
  const foePower = calcPower(champ.stats)
  const bonus = streakBonusPct(champ.streak, floor, myPower, foePower)
  const mult = pvpHpMultFor(myLv, champ.lv)
  const a = withPvpHp({ ...me, stats: applyStreakBonus(me.stats, bonus) }, mult)
  const b0 = withPvpHp(champ, mult)
  // ★守護者は前の防衛で減ったHP/MPのまま始まる（挑戦する側は満タン）
  const b = {
    ...b0,
    startHp: Math.max(1, Math.round(b0.stats.hp * clampPm(champ.hpPm) / 1000)),
    startMp: Math.min(b0.stats.mp, Math.max(0, champ.mpNow ?? b0.stats.mp)),
  }
  return { a, b, bonus, mult }
}

// ===== 報酬（出撃と同じ旨み・勝ち負けによらず）=====
// 開いている一番先の場所（出撃で選べるいちばん先）
export const rewardSpotOf = (cleared) => spotOf(openUntilOf(cleared))
// 装備：その場所の「ふつうの敵」と同じ（落ちる確率・レア度・部位・武器はいまの職業の種類から）。サーバーも同じ条件で見る
// rareMult … 防具のセット能力「海賊の嗅覚」（出撃と同じに効かせる）
export const rollTowerDrop = (cleared, cls, at = new Date(), rng = Math.random, rareMult = 1) =>
  rollEquipDrop({ role: 'normal', spot: rewardSpotOf(cleared) }, cls, at, rng, rareMult)
