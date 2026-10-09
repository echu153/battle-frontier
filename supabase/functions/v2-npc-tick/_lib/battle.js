// ============================================================
// バトルフロンティアⅡ（リメイク版）— 戦闘ループ
// ------------------------------------------------------------
// スキルの回り方はあるけみすと準拠：
//   ・セットした枠を順に1巡し、それぞれの枠に設定した「使用回数」だけ使う（ABCDE→ABCDE…）
//   ・使用回数を使い切った枠・空の枠・MPが足りない枠は飛ばす
//   ・不発のときは MP も使用回数も減らず、**ポインタも進まない**（同じ枠を撃ち直す）
//     → 発動率の低い技を上に置くとそこで詰まる。並び順が戦術になる
//   ・不発のターンと、撃てる枠が無いときは通常攻撃（消費MP0）
//
// 行動順・追加行動・命中・クリティカル・ダメージは combat.js の関数をそのまま使う。
// ステータスの増減バフは**戦闘中ずっと続き、重ねがけで加算**される（あるけみすと準拠）。
// 状態異常は ailments.js、装備エンチャントの特殊能力は enchant.js が定義を持つ。
//
// ★純関数。rng を渡せば結果が再現する（テストとバランス検証のため）。
// ============================================================
import {
  resolveAttack, healOf, roll, goesFirst, rollExtraAction,
} from './combat.js'
import { STAT_KEYS, calcPower } from './stats.js'
import { skillsOf, isPassive, passiveOf, offClassMult, scaleTable, mpOf, mpPctOf } from './skills.js'
import { classBonusOf } from './classBonus.js'
import {
  createAilments, inflict, tickAilments, ailStatPct, healMultOf, consumeParalyze, hasAilment, AIL_LABEL, AIL_KEYS,
  ailAccPct, ailTakenMult, ailDealMult, isFrenzied,
  POISON_CAP_RATE, BLEED_CAP_RATE, BURN_CAP_RATE, tickBleed,
  isSealed, usesMp, procCutOf, diminishedChance, AIL_DIMINISH_KEYS,
} from './ailments.js'
import { collectEnchants, inflictChance } from './enchant.js'
import {
  collectEvolutions, evoDmgPct, evoCutPct, EVO_STACK_MAX,
  LOW_HP_PCT as EVO_LOW_HP, FOE_LOW_PCT,
} from './evolve.js'
// ★一次職（「レベルキャップあり」版の20職・2026-10-10）の仕組み。今のⅡの技・敵はこの項目を持たないので何も起きない
import {
  initIchiji, collectExPassives, passiveDealMult, ichijiSkip, ichijiSkillPrep, consumeDodgeBoost,
  incomingCut, guardHealPct, gainHp, ichijiAfterAction, tickIchiji, hpPctOf, STK_LABEL,
} from './battleIchiji.js'

export const NORMAL_ATTACK_MULT = 1.0 // 通常攻撃の倍率（消費MP0）
export const MAX_TURNS = 100          // これを超えたら引き分け

// 職業の攻撃型。攻撃スキルの種別から決める（通常攻撃がSTR参照かINT参照か）
export const attackKindOf = (cls) => {
  const atk = skillsOf(cls).filter(s => s.kind === 'phys' || s.kind === 'mag')
  return atk.some(s => s.kind === 'mag') && !atk.some(s => s.kind === 'phys') ? 'mag' : 'phys'
}

// ステータスの増減バフは**戦闘中ずっと続き、重ねがけで加算**される（あるけみすと準拠）。
//   あるけみすとのバフにはターン数の記載が無く、「重ね掛け可能」「回避成功毎に+3%」と
//   累積前提で書かれている（ターン数が明記されているのは麻痺1T・沈黙2Tなどのデバフ側）。
// 下限は -90%（デバフを重ねてもステータスが0以下にならないように）
export const BUFF_MIN_PCT = -90
const effectiveStats = (base, buffs) => {
  const out = {}
  for (const k of STAT_KEYS) {
    const pct = buffs[k] || 0
    out[k] = pct ? Math.max(0, Math.round((base[k] || 0) * (1 + pct / 100))) : (base[k] || 0)
  }
  return out
}

const applyBuff = (buffs, table) => {
  for (const [k, pct] of Object.entries(table || {})) {
    buffs[k] = Math.max(BUFF_MIN_PCT, (buffs[k] || 0) + pct)
  }
}

// ===== パッシブ =====
// セットしたパッシブを1つのまとめ（pa）に畳む。**パッシブは複数セットできる**ので、
// 数で書けるものは足し算、形のあるものは配列で持つ。
const collectPassives = (passives) => {
  const pa = {
    hitBonus: 0, evaBonus: 0, critBonus: 0, procBonus: 0, defPenBonus: 0, healBonus: 0,
    misfireAtkMult: 1, debuffGuard: 0,
    // ★2026-08-19 追加ぶん
    critDmg: 0,        // クリティカルのダメージ+%（隠身）
    mpCut: 0,          // 消費MP-%（天啓）
    defRed: 0,         // 受けるときの軽減率+%（聖騎士の心得）
    bleedMax: 0,       // 自分が付ける出血の上限スタック（隠身）
    hpSteps: [],       // [{ at, statPct }] HPが at% 以下で効く段（新しいバーサク）
    ailResist: 0,      // 受ける状態異常の付与率-%（武僧）
    ritualStart: 0,    // 戦闘を始めるときに持っている呪力（式神使い）
    formBoost: 0,      // 獣の型のステータス補正+%（ビーストレンジャーの野性の勘）
    repeat: null,      // { per, max } 同じ技を続けて撃つほど威力+%（精霊召喚士）
    hitMult: null,     // { mult, lowMult, at } 命中率に掛ける（鷹ノ目）
    hitStack: null,    // { critRate, critDmg, max } 当てるたびに積む（精密照準）
    perAct: [],        // [{ stats, per, max }] 行動するたびに積む（第六感）
    statPct: {}, converts: [], rages: [], switches: [], lowHps: [],
    wall: null, gamble: null, dodgeCut: null,
  }
  for (const s of passives) {
    const p = s?.passive
    if (!p) continue
    for (const k of ['hitBonus', 'evaBonus', 'critBonus', 'procBonus', 'defPenBonus', 'healBonus', 'debuffGuard',
      'critDmg', 'mpCut', 'defRed', 'ailResist', 'ritualStart', 'formBoost']) {
      if (p[k]) pa[k] += p[k]
    }
    if (p.bleedMax) pa.bleedMax = Math.max(pa.bleedMax, p.bleedMax)
    if (p.hitMult)  pa.hitMult = p.hitMult
    if (p.hitStack) pa.hitStack = p.hitStack
    if (p.perAct)   pa.perAct.push(p.perAct)
    if (p.hpSteps)  pa.hpSteps.push(...p.hpSteps)
    if (p.repeat)   pa.repeat = p.repeat
    if (p.misfireAtkMult) pa.misfireAtkMult = Math.max(pa.misfireAtkMult, p.misfireAtkMult)
    if (p.statPct) for (const [k, v] of Object.entries(p.statPct)) pa.statPct[k] = (pa.statPct[k] || 0) + v
    if (p.convert)    pa.converts.push(p.convert)
    if (p.rage)       pa.rages.push(p.rage)
    if (p.switchStat) pa.switches.push(p.switchStat)
    if (p.lowHp)      pa.lowHps.push(p.lowHp)
    if (p.wall)     pa.wall = p.wall
    if (p.gamble)   pa.gamble = p.gamble
    if (p.dodgeCut) pa.dodgeCut = p.dodgeCut
  }
  // ★一次職のパッシブ（battleIchiji.js の EX_PASSIVE_KEYS）
  pa.ex = collectExPassives(passives)
  return pa
}

// いまのステータス。土台のバフに、状況で変わるパッシブぶんを足してから計算する。
//   acting=true … 自分の行動を解決している最中（元素共鳴のような「その行動だけ」の補正を含める）
// ★ビーストレンジャー（2026-08-23 ユーザー選択のコンセプト）
//   いま呼んでいる獣で「型」が変わり、型のあいだステータス補正が乗る。
//   獣を呼ぶ技を使うとその型になり、**同じ獣を続けて呼ぶと威力が上がる**（型を合わせて撃つ）。
//   ＝型を張り替えるほど補正を失うので、「回すか・固めるか」を選ぶことになる
export const BEAST_FORMS = {
  hawk:  { label:'鷹', stats:{ agi:20, dex:15 } },
  bear:  { label:'熊', stats:{ str:20, vit:20 } },
  snake: { label:'蛇', stats:{ dex:15, luk:15 } },
}
// 型が合っているとき（同じ獣を続けて呼ぶ）の威力+%
export const BEAST_BONUS = 25
export const beastMultOf = (skill, prevForm) =>
  (skill?.form && prevForm === skill.form ? 1 + BEAST_BONUS / 100 : 1)

export const liveStats = (side, acting = false) => {
  const b = { ...side.buffs }
  const add = (k, pct) => { b[k] = Math.max(BUFF_MIN_PCT, (b[k] || 0) + pct) }
  // 状態異常「鈍足」＝AGI-20%
  const ap = ailStatPct(side.ail)
  if (ap) for (const [k, pct] of Object.entries(ap)) add(k, pct)
  // エンチャント：当てるたびに積むスタック（極夜のワイト・熾火のデーモン）
  for (const [k, pct] of Object.entries(side.enStacks || {})) add(k, pct)
  // バーサク・執行本能：ダメージを与えるたびに乗るスタック
  if (side.rage > 0) for (const r of side.pa.rages) add(r.stat, Math.min(r.max, r.per * side.rage))
  // 期限つきバフ（狂心のSTR+70%＝4ターンで切れる）
  for (const t of side.timedBuffs || []) {
    if (t.turns > 0) for (const [k, v] of Object.entries(t.table || {})) add(k, v)
  }
  // 第六感：行動するたびにステータスが上がる（上限つき）
  for (const t of side.pa.perAct || []) {
    const up = Math.min(t.max, t.per * (side.acts || 0))
    if (up > 0) for (const st of t.stats) add(st, up)
  }
  // ビーストレンジャー：いま呼んでいる獣の型（野性の勘があるとさらに効く）
  if (side.form && BEAST_FORMS[side.form]) {
    const k = 1 + (side.pa?.formBoost || 0) / 100
    for (const [st, pct] of Object.entries(BEAST_FORMS[side.form].stats)) add(st, pct * k)
  }
  // 新しいバーサク：HPの段階でステータスが上がる（重ならず、いちばん深い段だけが効く）
  if (side.pa.hpSteps?.length) {
    const hpPct = (side.hp / Math.max(1, side.base.hp)) * 100
    const hit = side.pa.hpSteps.filter(t => hpPct <= t.at).sort((x, y) => x.at - y.at)[0]
    if (hit) for (const [k, v] of Object.entries(hit.statPct || {})) add(k, v)
  }
  // 闘争本能：HPが減るほど上がる（at% まで下がると max% で頭打ち）
  for (const l of side.pa.lowHps) {
    const hpPct = (side.hp / Math.max(1, side.base.hp)) * 100
    const t = Math.min(1, Math.max(0, (100 - hpPct) / Math.max(1, 100 - l.at)))
    if (t > 0) add(l.stat, l.max * t)
  }
  // 元素共鳴：直前と違うスキルを使うときだけ（重複しない＝毎回同じ+10%）
  if (acting && side.switchOn) for (const s of side.pa.switches) add(s.stat, s.pct)
  // ★一次職：影の連携（忍者）＝分身がいない間はAGI+
  if (side.pa.ex?.noCloneAgi && !(side.stk?.clone > 0)) add('agi', side.pa.ex.noCloneAgi)
  // 武器の進化：かわすたびAGI＋／被弾するたびSTR＋（どちらも EVO_STACK_MAX 回まで）
  if (side.evo?.onDodge.agi && side.evoStacks?.dodge)
    add('agi', side.evo.onDodge.agi * Math.min(EVO_STACK_MAX, side.evoStacks.dodge))
  if (side.evo?.onHurt.str && side.evoStacks?.hurt)
    add('str', side.evo.onHurt.str * Math.min(EVO_STACK_MAX, side.evoStacks.hurt))
  // 合成の「ターンが経つごとにステータス+%」（重複の上限つき）。
  // ★side.turn は runBattle がターンの頭で入れる（1ターン目は0）
  for (const t of side.en.perTurnStats || []) {
    const n = Math.min(t.max || 0, side.turn || 0)
    if (n > 0) add(t.stat, t.pct * n)
  }
  // ★たかぶり（ramp）＝**ターンが進むほど火力と耐久が上がる**。
  //   いまのところレイドボスだけが持つ（fighter.ramp を渡したときにしか効かない＝
  //   ふつうの戦闘には一切影響しない）。turn は runBattle がターンの頭で入れる。
  //   docs/v2-raid-design.md §3
  if (side.ramp && side.ramp.turn > 0) {
    const n = side.ramp.turn
    if (side.ramp.atk) { add('str', side.ramp.atk * n); add('int_stat', side.ramp.atk * n) }
    if (side.ramp.def) add('vit', side.ramp.def * n)
  }
  const eff = effectiveStats(side.base, b)
  // 魔導剣術：INTの20%をSTRへ「変換」する。移した元は減る
  for (const c of side.pa.converts) {
    const moved = Math.round((eff[c.from] || 0) * (c.pct / 100))
    eff[c.from] = Math.max(0, (eff[c.from] || 0) - moved)
    eff[c.to] = (eff[c.to] || 0) + moved
  }
  // 雷鷲サンダーロック：AGIの5%をSTRへ「加算」する。★変換と違って元は減らない
  for (const c of side.en.convertAdds) {
    eff[c.to] = (eff[c.to] || 0) + Math.round((eff[c.from] || 0) * (c.pct / 100))
  }
  return eff
}

// 戦闘用の1サイドを作る。slots = [{ skill, uses }]（順番が発動順）
// ★パッシブは発動順のローテーションから外す。職業補正はスキルとは別枠で常時かかる
// fighter.enchants = 装備しているエンチャント（敵の名前の配列）。band は時間帯条件の判定に使う
export const createSide = (fighter, band = null) => {
  const stats = {}
  for (const k of STAT_KEYS) stats[k] = fighter.stats?.[k] ?? fighter[k] ?? 0
  const all = (fighter.slots || skillsOf(fighter.cls).map(s => ({ skill: s, uses: 3 })))
    .filter(s => s?.skill)
    .map(s => ({ skill: s.skill, uses: s.uses ?? 3 }))
  // ★パッシブは枠から取らない。**その職業のものが最初から効いている**（2026-08-23）
  //   ＝他職のパッシブは持ち込めない。枠に紛れ込んでいても無視する
  // ★fighter.passives を渡したときはそれを使う（「レベルキャップあり」版は自分の名簿のパッシブを渡す。
  //   狂戦士・竜騎士など今のⅡと同じ名前の職業に、今のⅡのパッシブが付かないように）
  const passives = (Array.isArray(fighter.passives) ? fighter.passives : [passiveOf(fighter.cls)]).filter(Boolean)
  const pa = collectPassives(passives)
  // ★noClassBonus … 「レベルキャップあり」版（src/v2cap）は職業補正を一旦なしにしている
  //   （2026-10-09 ユーザー決定）。渡さなければ今のⅡと同じ
  const bonus = fighter.noClassBonus ? null : classBonusOf(fighter.cls, fighter.jobCount)
  const en = collectEnchants(fighter.enchants, band)
  // 武器の進化（戦闘記憶）。刻印とは別枠で、装備している武器に付いているぶんが乗る
  const evo = collectEvolutions(fighter.evolutions)
  // ★ステータス%は**素の値**へ掛ける（バフ枠に入れると最大HP/MPが増えないため）
  for (const [k, p] of Object.entries(evo.stat)) {
    if (stats[k] !== undefined && p) stats[k] = Math.max(0, Math.round(stats[k] * (1 + p / 100)))
  }
  const buffs = {}
  if (bonus?.stats) applyBuff(buffs, bonus.stats)   // 職業補正（就いている職業だけ）
  applyBuff(buffs, pa.statPct)                      // パッシブの常時ステータス補正
  applyBuff(buffs, en.statPct)                      // エンチャントの常時ステータス補正（時間帯ぶんを含む）
  const side = {
    name: fighter.name || fighter.cls || '?',
    cls: fighter.cls,
    kind: fighter.kind || attackKindOf(fighter.cls),
    base: stats,
    // 戦闘力。「巨人殺し」が相手と比べるのに使う（ステータスから出すので敵にも要る）
    power: calcPower(stats),
    // ★startHp/startMp を渡すと、そこから始める（アリーナのチャンプは回復しないので使う）。
    //   最大値は base のままなので、回復もHPバーも正しく動く
    hp: Math.max(0, Math.min(stats.hp, fighter.startHp ?? stats.hp)),
    mp: Math.max(0, Math.min(stats.mp, fighter.startMp ?? stats.mp)),
    slots: all.filter(s => !isPassive(s.skill)),  // 発動順に回るのはパッシブ以外だけ
    passives,
    pa,
    healMult: bonus?.healMult ?? 1,   // 異端審問官は自身の回復量0.8倍
    offClassCut: bonus?.offClassCut ?? 0, // 賢者は他職スキルのペナルティが半分
    ptr: 0,
    // 経過したターン数（runBattle がターンの頭で入れる）。1ターン目は0。
    // ★たかぶりと「ターンが経つごとにステータス+%」がこれを見る
    turn: 0,
    // たかぶり。{ atk, def } を渡すと**1ターンごとにその%ずつ**STR/INTとVITが上がる。
    // ★渡さなければ null ＝ふつうの戦闘は今までどおり
    ramp: fighter.ramp ? { atk: fighter.ramp.atk || 0, def: fighter.ramp.def || 0, turn: 0 } : null,
    buffs,          // 自分にかかっているバフ（職業補正とパッシブぶんを最初から乗せておく）
    regen: null,    // { rate, turns }
    mpRegen: null,  // { rate, turns }
    rage: 0,        // バーサク・執行本能のスタック数
    acts: 0,        // 自分が行動した回数（骸の壁が5回ごとに見る・第六感が積み上げに使う）
    hitStacks: 0,   // 精密照準：当てるたびに積む（上限は passive.hitStack.max）
    repeatCount: 0, // 同じ技を続けて撃った回数（魔銃士・精霊召喚士）
    air: false,     // 空中にいるか（体術師）
    ritual: pa.ritualStart || 0,  // 呪力（式神使い）。溜めて切り札で全部使う
    charge: 0,      // 竜気（竜騎士）。溜めるほど硬く、切り札で全部使う
    form: null,     // いま呼んでいる獣の型（ビーストレンジャー）
    lastKind: null, // 直前に使った技の種別（魔法剣士の両刀ボーナスが見る）
    // ★侍（2026-08-19）
    stance: null,   // 納刀：{ proc, mult } 次に撃つスキルへ乗り、撃ったら消える
    foresight: null, // 見切り：{ turns, pct, perHit, byName } 受けた技ほど避けやすくなる
    frenzy: null,    // 狂乱：{ turns } 効果中は**出る技がランダムになる**（ステ補正は別枠のバフ）
    timedBuffs: [],  // 期限つきバフ：[{ table, turns }] ターンで切れる（狂心のSTR+70%など）
    wallPct: pa.wall ? pa.wall.pct : 0,  // 骸の壁は戦闘開始時から乗る（重複しない）
    guards: pa.debuffGuard,              // 心身一如：デバフを打ち消せる残り回数
    bigGuard: 0,                         // 大防御：受けるダメージ-% （1ターンで切れる・聖騎士）
    lastSkill: null,                     // 元素共鳴が見る「直前に使ったスキル」
    switchOn: false,
    // ===== エンチャント・状態異常 =====
    en,
    ail: createAilments(),
    // ★ailDiminish … 「レベルキャップあり」版（src/v2cap）は麻痺・封印を受けるたび次の確率が下がる
    //   （2026-10-10 ユーザー決定）。渡さなければ今のⅡと同じ。ailTimes はその戦闘でかかった回数
    ailDiminish: !!fighter.ailDiminish,
    ailTimes: {},
    enStacks: {},                        // 当てるたびに積むスタック（ステ名→合計%）
    enCut: en.startCut,                  // スケルトン：次に受けるダメージを軽減（受けるまで消えない）
    reflected: false,                    // ウラノス：跳ね返しは最初の1回だけ
    // ===== 武器の進化（戦闘記憶）=====
    evo,
    moves: 0,                            // 自分が行動した回数（疾き刃・遅咲き・積み重ねが見る）
    evoStacks: { dodge: 0, hurt: 0 },    // かわした回数・被弾した回数（liveStats が使う）
    justDodged: false,                   // 直前の相手の攻撃をかわした
    justHurt: false,                     // 直前の相手の攻撃を受けた
    ctx: { dodged: false, hurt: false }, // ★自分の行動を解決するあいだ固定する（1回だけ乗る）
    gutsUsed: false,                     // 不屈は1戦に1回だけ
    // ★エリアの相性（enemies.js の bias）。{ phys:1.1 } のように**受けるダメージへ掛ける**
    taken: fighter.taken || null,
    boss: !!fighter.boss,                // ボスか（「大敵斬り」が見る）
  }
  initIchiji(side, fighter)              // ★一次職の状態（溜め・期限つきの軽減・跳躍・召喚など）
  return side
}

// このスキルを撃つのに要るMP。mpPct を持つスキルは「そのときの残りMPの割合」を払う
// （マナボルト＝現在MPの20%。撃つほど1回の消費が減るので、実質的に撃ち切れない）
// ★他職のスキルは消費MPが2倍（skills.js の OFF_CLASS_MP_MULT）。
//   編成の想定利用MP（setMpCost）と同じ関数を通しているので、画面と戦闘でズレない
export const mpCostOf = (side, skill) => {
  const pct = mpPctOf(side?.cls, skill, side?.offClassCut)
  const raw = pct ? Math.floor((side?.mp || 0) * pct) : mpOf(side?.cls, skill, side?.offClassCut)
  // 武器の進化：消費MP−%（代償で付いた「消費MP+%」はマイナスの値で入っている）
  // ★天啓（賢者）の「消費MP-10%」も同じ枠で引く
  const cut = (side?.evo?.mpCost || 0) + (side?.pa?.mpCut || 0)
  return cut ? Math.max(0, Math.round(raw * Math.max(0.1, 1 - cut / 100))) : raw
}

// いま撃てる枠を ptr から探す。見つからなければ null（＝通常攻撃）
// ★封印中はMPを使う技を飛ばす（MP0の技は出せる）
const findSlot = (side) => {
  const n = side.slots.length
  const sealed = isSealed(side.ail)
  for (let i = 0; i < n; i++) {
    const idx = (side.ptr + i) % n
    const s = side.slots[idx]
    if (!s || !s.skill) continue
    if (s.uses <= 0) continue
    if (sealed && usesMp(s.skill)) continue
    if (ichijiSkip(side, s.skill)) continue   // ★一次職：溜めが足りない・続けて使えない・使い切った技
    // MP不足の枠は飛ばす（使用回数は減らない）。割合消費はMPが1でも残っていれば撃てる
    if (s.skill.mpPct) { if (side.mp <= 0) continue }
    else if (s.skill.mp > side.mp) continue
    return idx
  }
  return null
}

// このターンの行動順の優先度。★納刀中だけ先制になる技がある（侍の居合斬）
export const priorityOf = (side, skill) =>
  (skill?.priority || 0) + (skill ? (side?.stance?.priority || 0) : 0)

// このターン使うスキル（発動判定の前）。行動順の優先度を知るために先に覗く
export const peekSkill = (side) => {
  const idx = findSlot(side)
  return idx === null ? null : side.slots[idx].skill
}

// 見切り：効果中の回避率＋、その技を受けたぶんだけ上乗せ（同じ技ほど見切れる）
export const foresightEva = (side, skillName) => {
  const f = side?.foresight
  if (!f || f.turns <= 0) return 0
  return f.pct + (skillName ? (f.byName[skillName] || 0) : 0)
}
// 見切り：受けた技を覚える
const rememberSkill = (side, skillName) => {
  const f = side?.foresight
  if (!f || f.turns <= 0 || !skillName) return
  // ★同じ技につき max% まで（2026-08-19 ユーザー指定）。効果が切れると byName ごと消える
  f.byName[skillName] = Math.min(f.max ?? 20, (f.byName[skillName] || 0) + f.perHit)
}

// 受けるとき側の軽減。骸の壁（1回きり）と竜鱗の加護（確率）はここでまとめて掛ける
// me は攻撃した側（跳ね返しの戻り先）。kind は 'phys' | 'mag'
const applyIncoming = (me, foe, dmg, kind, rng, log) => {
  if (dmg <= 0) return 0
  let d = dmg
  // 衰弱：撃つ側が弱っていると、与えるダメージが減る（物理も魔法もまとめて）
  d *= ailDealMult(me.ail)
  // 呪い：受ける側が呪われていると、受けるダメージが増える
  d *= ailTakenMult(foe.ail)
  // エリアの相性：そのエリアの敵は片方の型が少し通りやすい（enemies.js の bias）
  if (foe.taken?.[kind]) d *= foe.taken[kind]
  // 武器の進化：被ダメージ−%（代償で付いた「被ダメージ+%」はここでマイナスに効く）
  const evoCut = evoCutPct(foe.evo, { hpPct: (foe.hp / Math.max(1, foe.base.hp)) * 100, kind })
  if (evoCut) d *= Math.max(0.1, 1 - evoCut / 100)
  // エンチャントの軽減（物理／魔法で別枠）
  const cut = kind === 'mag' ? foe.en.magCutPct : foe.en.physCutPct
  if (cut) d *= Math.max(0, 1 - cut / 100)
  // ATBの「防御」（atb.js が guardCut を立てる。オート戦闘では常に未設定＝素通り）
  if (foe.guardCut) d *= Math.max(0, 1 - foe.guardCut / 100)
  // 大防御（聖騎士）。ATBの防御と同じ枠で掛ける
  if (foe.bigGuard) d *= Math.max(0, 1 - foe.bigGuard / 100)
  // スケルトン：**1回ダメージを受けると消える**軽減バフ
  if (foe.enCut) { d *= (1 - foe.enCut / 100); foe.enCut = 0; log.push({ side: foe.name, type: 'enCut' }) }
  // 骸の壁：**1回ダメージを受けると消える**。取り直すまで効かない
  if (foe.wallPct) { d *= (1 - foe.wallPct / 100); foe.wallPct = 0; log.push({ side: foe.name, type: 'wall' }) }
  const dc = foe.pa.dodgeCut
  if (dc && roll(dc.pct, rng)) {
    d *= (1 - dc.cut / 100)
    log.push({ side: foe.name, type: 'dodgeCut' })
  }
  // ★一次職：期限つきの軽減（受け止め・気の鎧・結界）・砲台の構え・死者の盾。結界は減らしたぶんを回復
  let guardHeal = 0
  const gcut = incomingCut(foe)
  if (gcut > 0) {
    const before = d
    d *= (1 - gcut / 100)
    const hp = guardHealPct(foe)
    if (hp > 0) guardHeal = Math.floor((before - d) * hp / 100)
  }
  const out = Math.max(1, Math.floor(d))
  foe.hp -= out
  // ★一次職：受けたダメージを覚える（報復の一撃・忍耐・リワインド）
  foe.lastTaken = out
  if (foe.takenLog) {
    foe.takenLog.push({ turn: foe.turn || 0, dmg: out })
    if (foe.takenLog.length > 12) foe.takenLog.shift()
  }
  if (foe.endure) foe.endure.acc += out
  // 不屈：致命傷をHP1で耐える（1戦に1回・確率）
  if (foe.hp <= 0 && foe.evo.guts && !foe.gutsUsed && roll(foe.evo.guts, rng)) {
    foe.gutsUsed = true
    foe.hp = 1
    log.push({ side: foe.name, type: 'guts' })
  }
  checkRevive(foe, log)
  if (guardHeal > 0 && foe.hp > 0) {
    const got = gainHp(foe, guardHeal)
    if (got > 0) log.push({ side: foe.name, type: 'guardHeal', heal: got })
  }
  // 被弾したとき：STRが積み上がる／MPが回復する
  foe.evoStacks.hurt += 1
  if (foe.evo.onHurt.mpHeal) foe.mp = Math.min(foe.base.mp, foe.mp + pctHp(foe.base.mp, foe.evo.onHurt.mpHeal))
  // ウラノス：最初に受けたそのダメージを跳ね返す（跳ね返し自体は再度跳ね返らない）
  const rf = foe.en.reflectFirst
  if (me && rf && !foe.reflected && rf.kind === kind) {
    foe.reflected = true
    const back = Math.max(1, Math.floor(out * rf.pct / 100))
    me.hp -= back
    log.push({ side: foe.name, type: 'reflect', damage: back })
  }
  return out
}

// ★一次職：リザレクション（戦闘中1回、HPが0になったら立ち上がる）
const checkRevive = (side, log) => {
  if (side.hp > 0 || !side.reviveReady || side.reviveUsed) return
  side.reviveUsed = true
  side.hp = Math.max(1, Math.floor(side.base.hp * side.reviveReady / 100))
  side.reviveReady = 0
  log.push({ side: side.name, type: 'revive', hp: side.hp })
}

// 回復量。聖職者の「回復量+20%」と、異端審問官の「自身の回復量0.8倍」がここで効く
// エンチャントの回復量+%と、状態異常「回復阻害」もここで掛かる
const healAmount = (side, eff, rate) =>
  Math.max(1, Math.floor(
    healOf(eff, rate) * (1 + side.pa.healBonus / 100) * side.healMult
    * (1 + side.en.healPct / 100) * healMultOf(side.ail)
    * Math.max(0, 1 + side.evo.heal / 100)   // 武器の進化：受ける回復量±%
  ))

// ★一次職：最大HPの◯%を回復（内功・魂喰らい・奇跡・再生薬）。回復量の補正はふつうの回復と同じだけ掛ける
const healMaxAmount = (side, pct) =>
  Math.max(1, Math.floor(side.base.hp * pct / 100
    * (1 + side.pa.healBonus / 100) * side.healMult
    * (1 + side.en.healPct / 100) * healMultOf(side.ail)
    * Math.max(0, 1 + side.evo.heal / 100)))

// 「最大HPの◯%」のような割合の回復・消耗。最低1（0にすると付いていないのと同じになる）
const pctHp = (max, pct) => (pct > 0 ? Math.max(1, Math.floor(max * pct / 100)) : 0)

// 攻撃を当てたとき・かわしたときに走る、武器の進化のフック
const evoOnHit = (me) => {
  if (me.evo.onHit.hpHeal) me.hp = Math.min(me.base.hp, me.hp + pctHp(me.base.hp, me.evo.onHit.hpHeal))
  if (me.evo.onHit.mpHeal) me.mp = Math.min(me.base.mp, me.mp + pctHp(me.base.mp, me.evo.onHit.mpHeal))
}
const evoOnDodge = (foe, times = 1) => {
  if (times <= 0) return
  foe.evoStacks.dodge += 1
  if (foe.evo.onDodge.hpHeal) {
    foe.hp = Math.min(foe.base.hp, foe.hp + pctHp(foe.base.hp, foe.evo.onDodge.hpHeal) * Math.min(times, EVO_STACK_MAX))
  }
}
// クリティカルしたとき。★多段でも**1回の行動につき1回**だけ走る（得も代償も同じ扱い）
const evoOnCrit = (me, foe, rng, log) => {
  const e = me.evo.onCrit
  if (e.hpHeal) me.hp = Math.min(me.base.hp, me.hp + pctHp(me.base.hp, e.hpHeal))
  if (e.mpHeal) me.mp = Math.min(me.base.mp, me.mp + pctHp(me.base.mp, e.mpHeal))
  if (e.hpCost) me.hp = Math.max(1, me.hp - pctHp(me.base.hp, e.hpCost))
  if (e.mpCost) me.mp = Math.max(0, me.mp - pctHp(me.base.mp, e.mpCost))
  if (e.ail) tryInflict(me, foe, { key:'bleed', chance: e.ail }, rng, log)
}

// デバフを相手へ入れる。心身一如を持っていると1回だけ打ち消される
const applyDebuff = (foe, table, log) => {
  const isDebuff = Object.values(table || {}).some(v => v < 0)
  // ★一次職：狂信（その間、自分の能力低下を受けない）
  if (isDebuff && foe.debuffImmune > 0) {
    log.push({ side: foe.name, type: 'debuffImmune' })
    return
  }
  if (isDebuff && foe.guards > 0) {
    foe.guards -= 1
    log.push({ side: foe.name, type: 'debuffGuard' })
    return
  }
  applyBuff(foe.buffs, table)
}

// 状態異常を1つ試す。**相手のエンチャント抵抗（ailResist）を引いてから**判定する。
// エンチャント由来（onHitAils）とスキル由来（skill.ail）で同じ道を通す＝抵抗の効き方がズレない
// me は入れる側。武器の進化は**入れる側の付与率＋**と**受ける側の抵抗**の両方が効く
const tryInflict = (me, foe, a, rng, log) => {
  // ★一次職：不動（麻痺・鈍足にかからない）
  if (foe?.pa?.ex?.immune?.includes(a.key)) {
    log.push({ side: foe.name, type: 'immune', ail: AIL_LABEL[a.key] })
    return
  }
  const base = a.chance + (me?.evo?.ail?.rate || 0)
  const raw = inflictChance(base, foe.en, a.key)
    - (foe?.evo?.ail?.resist || 0) + (foe?.evo?.ail?.weak || 0)
    - (foe?.pa?.ailResist || 0)   // ★武僧：状態異常が効きづらい
  // ★v2cap：麻痺・封印は受けた回数ぶん下がる（抵抗を引いたあとの確率に掛ける）
  const pct = foe.ailDiminish ? diminishedChance(raw, a.key, foe.ailTimes) : raw
  if (!roll(pct, rng)) return
  // ★隠身（暗殺者）：自分が付ける出血はスタック上限が伸びる
  // ★ドットの1刻み上限は**付けた側の攻撃力**から決める（HPが桁違いの相手で壊れないように）
  const eAtk = liveStats(me, true)
  const atk = Math.max(eAtk.str || 0, eAtk.int_stat || 0)
  const cap = a.key === 'poison' ? atk * POISON_CAP_RATE
    : a.key === 'bleed' ? atk * BLEED_CAP_RATE
    : a.key === 'burn' ? atk * BURN_CAP_RATE : undefined
  const opt = { ...a, cap, ...(me?.pa?.bleedMax ? { max: me.pa.bleedMax } : {}) }
  if (inflict(foe.ail, a.key, opt)) {
    if (foe.ailDiminish && AIL_DIMINISH_KEYS.includes(a.key)) foe.ailTimes[a.key] = (foe.ailTimes[a.key] || 0) + 1
    log.push({ side: foe.name, type: 'ailment', ail: AIL_LABEL[a.key] })
  }
}

// 攻撃が当たったときのエンチャント。状態異常の付与と、積み上がるステータス補正
const onHit = (me, foe, kind, rng, log) => {
  for (const a of me.en.onHitAils) {
    if (a.kind !== 'any' && a.kind !== kind) continue
    tryInflict(me, foe, a, rng, log)
  }
  // 雪男・氷河ドラゴン・フロストバーン：当てるたびに相手のステータスを下げる（重複上限つき）
  for (const f of me.en.onHitFoeStats) {
    for (const st of f.stats) {
      const cap = f.pct * f.max
      const next = (foe.enStacks[st] || 0) + f.pct
      foe.enStacks[st] = f.pct < 0 ? Math.max(cap, next) : Math.min(cap, next)
    }
  }
  // 極夜のワイト・熾火のデーモン：当てるたびに自分のステータスを上げる（重複上限つき）
  for (const s of me.en.onHitSelfStats) {
    if (s.kind !== 'any' && s.kind !== kind) continue
    me.enStacks[s.stat] = Math.min(s.pct * s.max, (me.enStacks[s.stat] || 0) + s.pct)
  }
}

// 武器の進化ぶんの与ダメージ倍率。乗る条件を満たしていないものは1のまま
// ★条件はここで**全部**そろえて渡す。片方の呼び出しだけ条件が抜けると、
//   通常攻撃とスキルで挙動が変わってしまう
const evoMult = (me, foe, { kind = 'phys', skill = false, multi = false } = {}) => {
  const pct = evoDmgPct(me.evo, {
    kind, skill, multi,
    hpPct: (me.hp / Math.max(1, me.base.hp)) * 100,
    // ★仕留め際は**相手の**HPを見る。倒しきる一撃にも乗るよう、攻撃を解決する前の値で判定する
    foeHpPct: (foe.hp / Math.max(1, foe.base.hp)) * 100,
    foeBigger:  (foe.power || 0) > (me.power || 0),
    foeSmaller: (foe.power || 0) < (me.power || 0),
    foeBoss: !!foe.boss,
    foeAiled: Object.keys(foe.ail || {}).length > 0,
    moves: me.moves,
    combo: Math.max(0, me.moves - 1),
    justDodged: me.ctx.dodged,
    justHurt: me.ctx.hurt,
  })
  return pct ? Math.max(0.1, 1 + pct / 100) : 1
}

// 聖職者：自分のHPが高いほど威力が上がる（満タンで最大）
export const highHpMultOf = (skill, me) => {
  const h = skill?.highHpBonus
  if (!h) return 1
  const pct = (Math.max(0, me.hp) / Math.max(1, me.base.hp)) * 100
  const t = Math.min(1, Math.max(0, (pct - (h.at ?? 50)) / Math.max(1, 100 - (h.at ?? 50))))
  return 1 + (h.max / 100) * t
}
// 異端審問官：相手に乗っているバフ（プラスのステータス補正）の数で威力が上がる
export const buffCountOf = (side) =>
  Object.values(side?.buffs || {}).filter(v => v > 0).length
export const vsBuffMultOf = (skill, foe) => {
  const v = skill?.vsBuff
  if (!v) return 1
  return 1 + (v.per / 100) * Math.min(v.max ?? 3, buffCountOf(foe))
}
// ★2026-08-23：職業ごとのコンセプト（バッチ2）
// 溜め（式神使いの呪力・竜騎士の竜気）は最大3つまで
export const STACK_MAX = 3
// 竜気1つにつき、受けるダメージの軽減率がこれだけ上がる
export const CHARGE_GUARD = 12
// 空中にいるあいだの回避+%
export const AIR_EVA = 10
// 元素使い：直前に使った技との組み合わせで威力が上がる
export const comboMultOf = (skill, prevSkill) => {
  const c = skill?.combo
  if (!c || !prevSkill) return 1
  return c.after.includes(prevSkill) ? 1 + c.mult / 100 : 1
}
// 体術師：地上にいるときだけ乗る（足を着いていないと出せない技）
export const groundMultOf = (skill, wasAir) => {
  const g = skill?.whileGround
  if (!g || wasAir) return 1
  return 1 + (g.mult || 0) / 100
}
// 体術師：空中にいるときだけ乗る（叩きつけて着地する技）
export const airMultOf = (skill, wasAir) => {
  const a = skill?.whileAir
  if (!a || !wasAir) return 1
  return 1 + a.mult / 100
}
// 式神使い・竜騎士：溜めた数だけ乗る（撃つと全部使う）
export const stackMultOf = (use, stacks) => (use && stacks > 0 ? 1 + (use.per / 100) * stacks : 1)
// 竜気を溜めているあいだは硬い（軽減率が上がる）
export const chargeGuardOf = (side) => 1 + ((side?.charge || 0) * CHARGE_GUARD) / 100

// ★2026-08-23：**軸そのものの技**だけでなく、**軸につながる技**を書けるようにする（ユーザー指定）
//   溜め（呪力・竜気）や獣の型は、それを作る技と使い切る技の2本だけだと流れが細い。
//   「溜まっていると効く」「型が乗っていると効く」技を混ぜられるようにして、軸を太くする。

// 式神使い・竜騎士：溜めが**残っているあいだ**効く（消費はしない）
export const whileStackMultOf = (skill, me) => {
  const w = skill?.whileStack
  if (!w || !w.mult) return 1
  const n = w.key === 'charge' ? (me?.charge || 0) : (me?.ritual || 0)
  return n > 0 ? 1 + w.mult / 100 : 1
}
export const whileStackOn = (skill, me) => {
  const w = skill?.whileStack
  if (!w) return false
  return (w.key === 'charge' ? (me?.charge || 0) : (me?.ritual || 0)) > 0
}
// ビーストレンジャー：獣を呼んでいるあいだ効く（どの型でもよい）
export const whileFormMultOf = (skill, prevForm) =>
  (skill?.whileForm && prevForm ? 1 + skill.whileForm.mult / 100 : 1)
// 賢者：相手にかかっている状態異常の数だけ効く（自分で撒かなくても噛み合う＝何でも屋）
export const ailCountOf = (side) => AIL_KEYS.filter(k => hasAilment(side?.ail || {}, k)).length
export const vsAilMultOf = (skill, foe) => {
  const v = skill?.vsAil
  if (!v) return 1
  return 1 + (v.per / 100) * Math.min(v.max ?? 3, ailCountOf(foe))
}

// 魔法剣士：直前に使った技と種別（物理／魔法）が違えば威力+%
export const switchKindMultOf = (skill, prevKind) => {
  if (!skill?.switchKind || !prevKind) return 1
  return prevKind !== skill.kind ? 1 + skill.switchKind / 100 : 1
}
// ギャンブラー：威力が lo%〜hi% のあいだで振れる
export const varianceMultOf = (skill, rng) => {
  const v = skill?.variance
  if (!v) return 1
  return (v.lo + (v.hi - v.lo) * rng()) / 100
}

// 魔銃士・精霊召喚士：同じ技を続けて撃つほど威力が上がる（別の技を挟むと戻る）
export const repeatMultOf = (skill, me) => {
  const r = skill?.repeat || me?.pa?.repeat
  if (!r || !skill) return 1
  return 1 + (r.per / 100) * Math.min(r.max, me.repeatCount || 0)
}

// 追い討ち：相手のHPが低いほど威力が上がる。at% 以下で最大（狩人）
//   HP100%で+0%、at%以下で+max%。あいだは直線で伸びる
export const lowHpMultOf = (skill, foe) => {
  const l = skill?.lowHpBonus
  if (!l) return 1
  const pct = (Math.max(0, foe.hp) / Math.max(1, foe.base.hp)) * 100
  const t = Math.min(1, Math.max(0, (100 - pct) / Math.max(1, 100 - (l.at ?? 20))))
  return 1 + (l.max / 100) * t
}

// 鷹ノ目：最終命中率に掛ける倍率。相手が瀕死（HPが at% 以下）ならさらに伸びる
export const hitMultOf = (me, foe) => {
  const h = me.pa.hitMult
  if (!h) return 1
  const pct = (Math.max(0, foe.hp) / Math.max(1, foe.base.hp)) * 100
  return pct <= (h.at ?? 30) ? (h.lowMult ?? h.mult) : h.mult
}
// 隠身のクリダメ+% ＋ 精密照準の積み上げぶん
export const critDmgOf = (me) => {
  const st = me.pa.hitStack
  return me.pa.critDmg + (st ? Math.min(st.max, me.hitStacks) * (st.critDmg || 0) : 0)
}
// 精密照準の積み上げぶん（クリティカル率）
export const critRateStackOf = (me) => {
  const st = me.pa.hitStack
  return st ? Math.min(st.max, me.hitStacks) * (st.critRate || 0) : 0
}
// 当てたら積む（精密照準）
const bumpHitStack = (me, hits) => {
  if (me.pa.hitStack && hits > 0) me.hitStacks = Math.min(me.pa.hitStack.max, me.hitStacks + 1)
}

// 1回の行動を解決する。戻り値はログ用の1件
// ★opt はATB戦闘（atb.js）のためのもの。オート戦闘（runBattle）は opt を渡さないので挙動は変わらない
//     idx        … 撃つ枠を指定する（null＝通常攻撃・省略＝いままで通り findSlot が自動で選ぶ）
//     noProc     … 発動率の抽選をしない（ATBは不発の代わりに「必要ゲージ」で重さを表す）
//     noParalyze … 麻痺の判定をしない（ATBは麻痺＝ゲージが止まる、で表現する）
export const takeAction = (me, foe, rng, log, opt = {}) => {
  me.moves += 1   // 疾き刃・遅咲き・積み重ねが見る。麻痺で動けなくても1回と数える
  // ★「かわした次の攻撃」「被弾した次の攻撃」は**1回の行動にだけ**乗る。
  //   ここで読み取って消しておかないと、一度かわしただけで最後まで乗り続ける
  me.ctx = { dodged: me.justDodged, hurt: me.justHurt }
  me.justDodged = false
  me.justHurt = false
  // ★一次職：フルバーストの反動（このターンは動けない）
  if (me.stunned > 0) {
    me.stunned -= 1
    log.push({ side: me.name, type: 'stunned' })
    return
  }
  // ★一次職：跳躍中（竜騎士）。残りがあれば空中で待ち、最後の行動で着地して斬る
  if (me.jumping) { airborneTurn(me, foe, rng, log); return }
  // 麻痺：このターンは動けない（見た時点で1ターンぶん消える）
  if (!opt.noParalyze && consumeParalyze(me.ail)) {
    log.push({ side: me.name, type: 'paralyzed' })
    return
  }
  let idx = opt.idx !== undefined ? opt.idx : findSlot(me)
  // ★狂乱：自分では技を選べない。撃てる攻撃スキルからランダムに出る
  //   狂戦士の「狂心」（自分でなる）と、相手にかけられる状態異常の「狂乱」は同じ状態
  const sealed = isSealed(me.ail)
  if (me.frenzy?.turns > 0 || isFrenzied(me.ail)) {
    const wild = me.slots
      .map((sl, i) => ({ sl, i }))
      .filter(({ sl }) => sl?.skill && sl.uses > 0 && (sl.skill.kind === 'phys' || sl.skill.kind === 'mag')
        && !(sealed && usesMp(sl.skill))
        && (sl.skill.mpPct ? me.mp > 0 : mpCostOf(me, sl.skill) <= me.mp))
    if (wild.length) idx = wild[Math.floor(rng() * wild.length)].i
  }
  // ★封印：MPを使う技は出せない。外から枠を指定されても（opt.idx）通常攻撃へ落とす
  if (idx !== null && sealed && usesMp(me.slots[idx]?.skill)) idx = null
  const slot = idx === null ? null : me.slots[idx]
  const skill = slot?.skill || null
  // 封印のせいで技が出せないときは、通常攻撃の前に1行出す（MPが尽きただけのときは出さない）
  //   （findSlot と同じ見方：封印が無ければ撃てた枠があるか）
  if (!skill && sealed && me.slots.some(s => s?.skill && s.uses > 0 && usesMp(s.skill)
    && (s.skill.mpPct ? me.mp > 0 : s.skill.mp <= me.mp))) {
    log.push({ side: me.name, type: 'sealed' })
  }

  // 発動判定。不発ならMPも使用回数も減らず、ポインタも進めない
  //   ★不発はバーサク・執行本能のスタックをリセットする
  // ★納刀（侍）：次に撃つスキルの発動率+・威力×。不発では消えない（撃てるまで構えたまま）
  const stance = skill ? me.stance : null
  // ★サイレンス・恐怖：スキルの発動率-20%（ATBでは atb.js が必要ゲージへ読み替える）
  const silenced = procCutOf(me.ail)
  if (skill && !opt.noProc && !roll(skill.proc + me.pa.procBonus + me.en.procBonus + me.evo.proc + (stance?.proc || 0) - silenced, rng)) {
    log.push({ side: me.name, type: 'misfire', skill: skill.name })
    me.rage = 0
    // 居合の構えはここで威力2倍。武器の進化「居合の心得」も同じ枠で乗る
    normalAttack(me, foe, rng, log, me.pa.misfireAtkMult * (1 + me.evo.misfireDmg / 100))
    return
  }
  if (!skill) { me.rage = 0; normalAttack(me, foe, rng, log); return }

  // 納刀を使う：この行動だけ威力×mult。条件つきの効果（whileStance）もここで開く
  const ws = stance ? (skill.whileStance || null) : null
  if (stance) me.stance = null
  me.mp -= mpCostOf(me, skill)
  // ★すてみ（狂戦士）：現在HPの n% を払って撃つ。払っても死なない（1は残る）
  if (skill.hpCostPct) {
    const pay = Math.min(Math.max(0, me.hp - 1), Math.floor(me.hp * skill.hpCostPct / 100))
    if (pay > 0) {
      me.hp -= pay
      log.push({ side: me.name, type: 'hpCost', skill: skill.name, damage: pay })
    }
  }
  // ★一次職：最大HPの割合を払う（マッドラッシュはHP50%以上のときだけ・血の誓い）。払っても死なない
  if (skill.hpCostMax && hpPctOf(me) >= (skill.hpCostMax.ifAbove ?? 0)) {
    const pay = Math.min(Math.max(0, me.hp - 1), Math.floor(me.base.hp * skill.hpCostMax.pct / 100))
    if (pay > 0) {
      me.hp -= pay
      log.push({ side: me.name, type: 'hpCost', skill: skill.name, damage: pay })
    }
  }
  // ★一次職：溜めを使って出す技（内功・気の鎧・魂喰らい）。足りることは findSlot が確かめてある
  if (skill.needStack) {
    me.stk[skill.needStack.key] -= skill.needStack.n
    log.push({ side: me.name, type: 'stackUse', stack: STK_LABEL[skill.needStack.key], n: skill.needStack.n, left: me.stk[skill.needStack.key] })
  }
  slot.uses -= 1
  me.ptr = (idx + 1) % me.slots.length

  // 元素共鳴：直前に使ったスキルと違えば、この行動だけ補正が乗る
  const prevSkill = me.lastSkill        // 元素使いのコンボが見る「直前に使った技」
  const wasAir = !!me.air               // 体術師：この行動を始めた時点で空中だったか
  const prevForm = me.form              // ビーストレンジャー：撃つ前に呼んでいた獣
  const ritualUsed = skill.useRitual ? (me.ritual || 0) : 0
  const chargeUsed = skill.useCharge ? (me.charge || 0) : 0
  // 同じ技を続けて撃った回数（魔銃士・精霊召喚士）。違う技を挟むと0へ戻る
  me.repeatCount = me.lastSkill === skill.name ? (me.repeatCount || 0) + 1 : 0
  me.switchOn = me.lastSkill !== null && me.lastSkill !== skill.name
  me.lastSkill = skill.name
  const prevKind = me.lastKind
  me.lastKind = (skill.kind === 'phys' || skill.kind === 'mag') ? skill.kind : me.lastKind
  me.acts += 1

  const eMe = liveStats(me, true)
  const eFoe = liveStats(foe)
  // ★他職のスキルは効果が落ちる（skills.js の OFF_CLASS_MULT）。ダメージ・回復・バフ幅・
  //   状態異常の付与確率に掛かる。発動率・消費MP・防御無視・必中などには掛からない
  const off = offClassMult(me.cls, skill, me.offClassCut)

  // ★一次職：跳躍（竜騎士）。この行動は跳ぶだけ。次の行動（ハイジャンプは2つ先）で着地して斬る
  if (skill.jump) {
    me.jumping = { left: skill.jump.turns, mult: skill.jump.mult * off, name: skill.name }
    log.push({ side: me.name, type: 'jump', skill: skill.name, turns: skill.jump.turns })
    return
  }

  if (skill.kind === 'phys' || skill.kind === 'mag') {
    // ★一次職：跳躍中の相手には当たらない／分身が1回ぶん肩代わりする（どちらもダメージなし）
    if (foe.jumping) {
      log.push({ side: me.name, type: 'airEvade', skill: skill.name })
      foe.justDodged = true
      foe.justHurt = false
    } else if (foe.stk?.clone > 0) {
      foe.stk.clone -= 1
      log.push({ side: foe.name, type: 'cloneTaken', skill: skill.name, left: foe.stk.clone })
    } else {
      let raw = 0
      let crit = false
      let hits = 0
      let missed = 0
      // 第六感の「貫通+10%」はスキルの防御貫通に足す。武器の進化ぶんも同じ枠
      const defPen = Math.min(1, (skill.defPen || 0) + (ws?.defPen || 0) + me.pa.defPenBonus / 100 + me.evo.defPen / 100
        + (whileStackOn(skill, me) ? (skill.whileStack.defPen || 0) : 0))
      // ★条件つき吸収（狂戦士の血啜り）：**撃つ前から**相手がその状態異常なら吸える
      //   （この技自身が付けた出血では吸えない＝先に撒いてから吸う流れになる）
      const drainIf = skill.drainIfAil && hasAilment(foe.ail, skill.drainIfAil.key)
      // ★出血スタックの起爆（暗殺者の急所突き）。**相手に積んだ出血を全部消費して威力を上げる**
      //   ＝「出血を撒く技」と「刈り取る技」で1つの流れになる（消費するので撒き直しが要る）
      let burst = 1
      if (skill.consumeAil) {
        const c = skill.consumeAil
        const st = c.key === 'bleed' ? (foe.ail.bleed?.stacks || 0) : (hasAilment(foe.ail, c.key) ? 1 : 0)
        if (st > 0) {
          burst = 1 + c.perStack * st
          delete foe.ail[c.key]
          log.push({ side: foe.name, type: 'consumeAil', ail: AIL_LABEL[c.key], stacks: st, mult: burst })
        }
      }
      const varMult = varianceMultOf(skill, rng)   // ギャンブラー：1行動につき1回だけ振る
      // ★一次職：倍率・連撃数・クリティカル率・上乗せダメージ・溜めの消費（1行動につき1回）
      const ip = ichijiSkillPrep(me, foe, skill, eMe, eFoe, log)
      const dealMult = passiveDealMult(me, foe)
      // ★一次職の「威力+％」「与ダメージ+％」は、AGI・DEXなど副参照のぶんも含めたダメージ全体に掛ける
      //   （今のⅡの倍率は主のステにだけ掛かる＝damageOf の base。そちらは変えない）
      const ichijiK = ip.mult * dealMult
      const nHits = ip.hits ?? (skill.hitMults ? skill.hitMults.length : (skill.hits || 1))
      // ★「撃った」行より後ろに流したいログを貯める（1発ごとの状態異常）
      const afterAil = []
      for (let h = 0; h < nHits; h++) {
        // ★多段で1発ごとに威力が上がる（体術師の飛天三角蹴り）。1発目は素のまま
        const ramp = skill.rampHit ? 1 + (skill.rampHit / 100) * h : 1
        const r = resolveAttack({
          attacker: eMe, defender: eFoe, mult: ramp * baseMultOf(skill, h, ip) * burst * (stance?.mult || 1) * lowHpMultOf(skill, foe)
            * highHpMultOf(skill, me) * vsBuffMultOf(skill, foe) * repeatMultOf(skill, me)
            * switchKindMultOf(skill, prevKind) * varMult
            * comboMultOf(skill, prevSkill) * airMultOf(skill, wasAir)
            * stackMultOf(skill.useRitual, ritualUsed) * stackMultOf(skill.useCharge, chargeUsed)
            * beastMultOf(skill, prevForm) * whileStackMultOf(skill, me)
            * whileFormMultOf(skill, prevForm) * vsAilMultOf(skill, foe) * groundMultOf(skill, wasAir),
          kind: skill.kind, atkStat: skill.src || null,
          defPen, add: skill.add || null,
          sureHit: !!skill.sureHit, sureCrit: !!skill.sureCrit || ip.sureCrit, noCrit: !!skill.noCrit,
          acc: skill.acc ?? 100,
          // ★スキル自身の命中補正（skill.hitBonus）もここで足す＝「必中ではないが当てやすい技」を作れる
          hitBonus: me.pa.hitBonus + me.en.hitBonus + evoHit(me, foe) + (skill.hitBonus || 0)
            + ailAccPct(me.ail)   // 暗闇：命中-25%
            + (wasAir ? (skill.whileAir?.hitBonus || 0) : 0),   // 空中からは狙いが通る（体術師）
          evaBonus: foe.pa.evaBonus + foe.en.evaBonus + evoEva(foe) + foresightEva(foe, skill.name)
            + (foe.air ? AIR_EVA : 0),
          critBonus: me.pa.critBonus + evoCrit(me, foe) + critRateStackOf(me) + ip.crit + (me.critUp || 0),
          hitMult: hitMultOf(me, foe),
          critDmg: critDmgOf(me),
          redMult: (1 + (foe.pa.defRed || 0) / 100) * chargeGuardOf(foe),
        }, rng)
        // ★一次職：物理と魔法の両方で殴る技（魔銃士）。魔法のぶんは同じ当たり・クリティカルのまま INT 同士で計算する
        if (skill.hybrid && r.hit) {
          const r2 = resolveAttack({
            attacker: eMe, defender: eFoe, mult: skill.hybrid.mag * vsAilMultOf(skill, foe),
            kind: 'mag', defPen, sureHit: true, sureCrit: !!r.crit, noCrit: !r.crit, acc: 100,
            hitBonus: 0, evaBonus: 0, critBonus: 0, hitMult: 1, critDmg: critDmgOf(me),
            redMult: 1 + (foe.pa.defRed || 0) / 100,
          }, rng)
          r.damage += r2.damage
        }
        if (r.hit && ichijiK !== 1) r.damage = Math.max(1, Math.floor(r.damage * ichijiK))
        // ★一次職：クリティカルしたときだけ伸びる技（絶影狙撃）・当てるたびコンボ（槍の型）
        if (skill.critMult && r.hit && r.crit) r.damage = Math.floor(r.damage * skill.critMult)
        if (r.hit && me.pa.ex?.combo) me.combo = Math.min(me.pa.ex.combo.max, (me.combo || 0) + 1)
        // ★クリティカルの与ダメージ+%は**1発ずつ**掛ける（多段でクリした発だけ伸びる）
        // ★ヒットごとに状態異常を試す技（連撃で少しずつ積む）
        if (r.hit && skill.ailPerHit && skill.ail) {
          tryInflict(me, foe, { ...skill.ail, chance: skill.ail.chance * off }, rng, afterAil)
        }
        raw += r.hit && r.crit && me.evo.critDmg
          ? Math.floor(r.damage * (1 + me.evo.critDmg / 100))
          : r.damage
        if (r.hit) hits++; else missed++
        if (r.crit && r.hit) crit = true
      }
      // ★一次職：上乗せダメージ（報復の一撃・城塞崩し＝直前に受けたダメージ／セイクリッドノヴァ＝回復したHP）
      if (hits > 0 && ip.flat > 0) raw += ip.flat
      // かわされたぶん／当てたぶんは、相手側の「かわすたび」フックと次の行動の条件になる
      evoOnDodge(foe, missed)
      foe.justDodged = hits === 0
      foe.justHurt = hits > 0
      // ★一次職：流水の構え（回避するたび、次の攻撃の威力+）
      if (hits === 0 && foe.dodgeBoost?.turns > 0) foe.dodgeStacks = Math.min(foe.dodgeBoost.max, (foe.dodgeStacks || 0) + 1)
      if (crit) evoOnCrit(me, foe, rng, log)
      // ギャンブルボディ：当たったとき、確率で威力が振れる
      const g = me.pa.gamble
      if (g && hits > 0) {
        const v = rng() * 100
        if (v < g.up) raw = Math.floor(raw * g.upMult)
        else if (v < g.up + g.down) raw = Math.floor(raw * g.downMult)
      }
      // エンチャントの与ダメージ+%（物理／魔法で別枠。時間帯ぶんも畳み込み済み）
      raw = Math.floor(raw * (1 + (skill.kind === 'mag' ? me.en.magDmgPct : me.en.physDmgPct) / 100))
      if (off !== 1) raw = Math.floor(raw * off)
      // 武器の進化（条件つきの与ダメージ+%をまとめて）
      raw = Math.floor(raw * evoMult(me, foe, { kind: skill.kind, skill: true, multi: nHits > 1 }))
      rememberSkill(foe, skill.name)
      // 受け手の反応（骸の壁・エンチャントの軽減・跳ね返し）も撃った行より後ろに出す
      const afterHurt = []
      const dmg = applyIncoming(me, foe, raw, skill.kind, rng, afterHurt)
      // ★先に「撃った」行を置く（状態異常やスタックの行より前に出す）。吸収の額は後で埋める
      const entry = { side: me.name, type: 'skill', skill: skill.name, kind: skill.kind,
        damage: dmg, crit, hits, of: nHits, drain: 0 }
      log.push(entry)
      for (const l of afterHurt) log.push(l)
      for (const l of afterAil) log.push(l)
      if (hits > 0) {
        bumpHitStack(me, hits)
        onHit(me, foe, skill.kind, rng, log)
        evoOnHit(me)   // 武器の進化：当てるたびHP/MPが戻る
        // ★スキル自身が持つ状態異常（どくのほうし＝毒、電撃＝麻痺 など）。**当たったときだけ**。
        //   敵もプレイヤーと同じ takeAction を通るので、これで**敵→こちら**にも状態異常が飛ぶ
        //   ＝エンチャントの抵抗（毒キノコ・払暁のワイバーン）が意味を持つ
        if (skill.ail && !skill.ailPerHit) {
          // 納刀ぶんで確率が上がる技がある（月影＝納刀中は出血100%）
          // ★溜め（呪力・竜気）や獣の型が乗っていれば、状態異常が入りやすくなる技がある
          const bonus = (whileStackOn(skill, me) ? (skill.whileStack.ailChance || 0) : 0)
            + (skill.whileForm && prevForm ? (skill.whileForm.ailChance || 0) : 0)
          const chance = ws?.ailChance ?? (skill.ail.chance * off + bonus)
          tryInflict(me, foe, { ...skill.ail, chance }, rng, log)
        }
        // ★一次職：状態異常を2つ以上持つ技（毒霧の術）。それぞれ判定する
        if (skill.ails) for (const a of skill.ails) tryInflict(me, foe, { ...a, chance: a.chance * off }, rng, log)
      }
      // バーサク・執行本能：ダメージを与えたら+1スタック、全部外れたらリセット
      if (me.pa.rages.length) me.rage = hits > 0 ? me.rage + 1 : 0
      // 吸収：与えたダメージの一定割合を自分のHPへ（ソウルドレイン・ブラッティロアなど）
      // ★吸収は全部いったん足してから、自分の最大HPの割合で頭を打つ
      let drained = 0
      // 条件つき吸収（血啜り）：相手が出血しているときだけ吸う
      if (drainIf && dmg > 0) drained += Math.max(1, Math.floor(dmg * skill.drainIfAil.pct / 100))
      // 武器の進化の吸収(%)はスキル自身の吸収と同じ枠で足す
      const drainRate = (skill.drain || 0) + me.evo.drain / 100 + (ip.drainAdd || 0)
      if (drainRate > 0 && dmg > 0) drained += Math.max(1, Math.floor(dmg * drainRate))
      // コウモリ・暁のフレイムバット：物理で与えたダメージの一部を回復
      if (skill.kind === 'phys' && me.en.drainPhysPct > 0 && dmg > 0) {
        drained += Math.max(1, Math.floor(dmg * me.en.drainPhysPct / 100))
      }
      // 合成「閻魔」：**種別を問わず**与えたダメージの一部を回復
      if (me.en.drainPct > 0 && dmg > 0) drained += Math.max(1, Math.floor(dmg * me.en.drainPct / 100))
      // ★一次職：ブラッディロア（その間、攻撃のたびに与えたダメージの一部を回復）
      if (me.lifeSteal?.turns > 0 && dmg > 0) drained += Math.max(1, Math.floor(dmg * me.lifeSteal.pct / 100))
      if (drained > 0) {
        drained = Math.min(drained, drainCapOf(me, crit))
        gainHp(me, drained)
      }
      entry.drain = drained
      // ★一次職：反動（狂撃＝与えたダメージの一部を自分も受ける・死なない）
      if (skill.recoil && dmg > 0) {
        const back = Math.min(Math.max(0, me.hp - 1), Math.floor(dmg * skill.recoil))
        if (back > 0) {
          me.hp -= back
          log.push({ side: me.name, type: 'recoil', damage: back })
        }
      }
      // ★一次職：反撃（心眼）・追撃（狙撃手の勘・影の連携）
      afterAttack(me, foe, hits, crit, rng, log)
    }
  } else if (skill.kind === 'heal') {
    if (skill.heal) {
      const amt = healAmount(me, eMe, skill.heal.rate * off)
      gainHp(me, amt)
      log.push({ side: me.name, type: 'heal', skill: skill.name, heal: amt })
    }
    if (skill.regen)   { me.regen   = { ...skill.regen,   rate: skill.regen.rate * off };   log.push({ side: me.name, type: 'regen', skill: skill.name }) }
    if (skill.mpRegen) { me.mpRegen = { ...skill.mpRegen, rate: skill.mpRegen.rate * off }; log.push({ side: me.name, type: 'mpRegen', skill: skill.name }) }
    // ★一次職：最大HPの割合で回復（内功・魂喰らい）・MP回復（魂喰らい・霊薬）・
    //   毎ターン最大HPの割合で回復（奇跡・再生薬）・受けたダメージを戻す（リワインド）
    if (skill.healMax) {
      const got = gainHp(me, healMaxAmount(me, skill.healMax * off))
      log.push({ side: me.name, type: 'heal', skill: skill.name, heal: got })
    }
    if (skill.mpGain || skill.mpHeal) {
      const add = (skill.mpGain || 0) + (skill.mpHeal ? Math.max(1, Math.floor((eMe.int_stat || 0) * skill.mpHeal.rate * off)) : 0)
      const before = me.mp
      me.mp = Math.min(me.base.mp, me.mp + add)
      log.push({ side: me.name, type: 'mpGain', skill: skill.name, mp: me.mp - before })
    }
    if (skill.regenMax) {
      me.regenMax = { pct: skill.regenMax.pct * off, turns: skill.regenMax.turns }
      log.push({ side: me.name, type: 'regen', skill: skill.name })
    }
    if (skill.rewind) {
      const from = (me.turn || 0) - (skill.rewind.turns - 1)
      const taken = (me.takenLog || []).filter(t => t.turn >= from).reduce((t, x) => t + x.dmg, 0)
      const got = taken > 0 ? gainHp(me, Math.floor(taken * skill.rewind.pct / 100 * off)) : 0
      log.push({ side: me.name, type: 'heal', skill: skill.name, heal: got })
    }
  }

  // 骸の壁：戦闘開始時と自分の行動5回ごとに得る（重複しないので、掛け直すだけ）
  if (me.pa.wall && me.acts % me.pa.wall.every === 0) me.wallPct = me.pa.wall.pct

  // ★バフ消去（異端審問官）：相手に乗っているプラス補正を確率で1つ消す
  if (skill.dispel && roll(skill.dispel.chance, rng)) {
    const ups = Object.entries(foe.buffs).filter(([, v]) => v > 0)
    if (ups.length) {
      const [k] = ups[Math.floor(rng() * ups.length)]
      delete foe.buffs[k]
      // 期限つきバフ側にも同じステが乗っていたら一緒に落とす
      foe.timedBuffs = (foe.timedBuffs || []).filter(t => !(k in (t.table || {})))
      // ★ATB：秒で切れる枠からも落とす。ここを消さないと buffs を作り直したときに戻ってくる
      if (foe.timed) {
        for (const e of foe.timed) delete e.table[k]
        foe.timed = foe.timed.filter(e => Object.keys(e.table).length > 0)
      }
      // 消したことを覚えておく（ATBが「デバフが入った」と読み違えないように）
      ;(foe.dispelled ||= {})[k] = true
      log.push({ side: foe.name, type: 'dispel', skill: skill.name, stat: k })
    }
  }
  // ★聖騎士：大防御。1ターンのあいだ大きく軽減する代わりに、追加行動が出なくなる
  if (skill.bigGuard) {
    me.bigGuard = skill.bigGuard.cut
    // opt.bigGuardSec が来るのはATB（ターンが無いので秒で出す）
    log.push({ side: me.name, type: 'bigGuard', skill: skill.name, cut: skill.bigGuard.cut, sec: opt.bigGuardSec || 0 })
  }
  // ★武僧：自分にかかっている状態異常を払う（効きづらいだけでなく、抜け出せる）
  if (skill.cure) {
    let left = skill.cure
    for (const k of AIL_KEYS) {
      if (left <= 0) break
      if (!hasAilment(me.ail, k)) continue
      delete me.ail[k]
      left -= 1
      log.push({ side: me.name, type: 'cure', skill: skill.name, ail: AIL_LABEL[k] })
    }
  }
  // ★体術師：跳び上がる技で空中へ。叩きつける技や、ふつうに殴る技を出すと着地する
  if (skill.airUp) {
    me.air = true
    log.push({ side: me.name, type: 'air', skill: skill.name })
  } else if ((skill.kind === 'phys' || skill.kind === 'mag') && !skill.keepAir) {
    // keepAir を持つ技は蹴り続けて空中に留まる（体術師）
    // ★降りたことも必ずログに出す。空中かどうかで威力が変わるので、黙って戻ると分からない
    if (me.air) log.push({ side: me.name, type: 'land', skill: skill.name })
    me.air = false
  }
  // ★ビーストレンジャー：獣を呼ぶ技を使うと、その獣の型になる
  if (skill.form && me.form !== skill.form) {
    me.form = skill.form
    log.push({ side: me.name, type: 'form', skill: skill.name, form: BEAST_FORMS[skill.form]?.label || skill.form })
  }
  // ★式神使い：儀式で呪力を練る／竜騎士：竜気を溜める（溜めるほど硬い）
  if (skill.ritual) {
    me.ritual = Math.min(STACK_MAX, (me.ritual || 0) + skill.ritual)
    log.push({ side: me.name, type: 'ritual', skill: skill.name, stacks: me.ritual })
  }
  if (skill.chargeUp) {
    me.charge = Math.min(STACK_MAX, (me.charge || 0) + (skill.chargeUp === true ? 1 : skill.chargeUp))
    log.push({ side: me.name, type: 'charge', skill: skill.name, stacks: me.charge })
  }
  // 切り札は溜めを全部使う（当たっても外れても消える＝撃ち直しが要る）
  if (skill.useRitual) me.ritual = 0
  if (skill.useCharge) me.charge = 0
  // ★納刀：構えるだけの技（次のスキルへ乗る）
  if (skill.stance) {
    me.stance = { ...skill.stance }
    log.push({ side: me.name, type: 'stance', skill: skill.name })
  }
  // ★狂乱（狂心）：出る技がランダムになる状態
  if (skill.frenzy) {
    me.frenzy = { ...skill.frenzy }
    log.push({ side: me.name, type: 'frenzy', skill: skill.name, turns: skill.frenzy.turns })
  }
  // ★見切り：一定ターンのあいだ回避が上がり、受けた技ほど見切れる
  if (skill.foresight) {
    me.foresight = { ...skill.foresight, byName: me.foresight?.byName || {} }
    log.push({ side: me.name, type: 'foresight', skill: skill.name, turns: skill.foresight.turns })
  }
  // バフ・デバフ（攻撃スキルに付いていることもある）
  // ★buffTurns を持つ技は「期限つき」＝そのターン数で切れる（狂心）
  // ★ビーストレンジャー：いま呼んでいる獣に合わせて中身が変わるバフ
  const formBuff = skill.formBuff ? { self: skill.formBuff[me.form || 'none'] } : null
  const spec = formBuff || skill.buff
  if (spec && skill.buffTurns) {
    if (spec.self) me.timedBuffs.push({ table: scaleTable(spec.self, off), turns: skill.buffTurns })
    if (spec.enemy) {
      if (foe.debuffImmune > 0 && Object.values(spec.enemy).some(v => v < 0)) log.push({ side: foe.name, type: 'debuffImmune' })
      else foe.timedBuffs.push({ table: scaleTable(spec.enemy, off), turns: skill.buffTurns })
    }
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  } else if (spec) {
    if (spec.self)  applyBuff(me.buffs, scaleTable(spec.self, off))
    if (spec.enemy) applyDebuff(foe, scaleTable(spec.enemy, off), log)
    log.push({ side: me.name, type: 'buff', skill: skill.name })
  }
  // ★補助スキルの状態異常。攻撃スキルは「当たったとき」だけだが、
  //   補助は当たり判定が無いので発動した時点で確率判定する（イカサマ・威圧など）
  if (skill.kind === 'buff' && skill.ail) {
    // 状態異常だけの補助技（v2cap の封印の呪文・咆哮）は、外れても使ったことが分かるように1行出す
    if (!spec) log.push({ side: me.name, type: 'buff', skill: skill.name })
    tryInflict(me, foe, { ...skill.ail, chance: skill.ail.chance * off }, rng, log)
  }
  // ★一次職：溜め・召喚・期限つきの効果（攻撃・補助・回復のどれでも）
  ichijiAfterAction(me, foe, skill, log)
  // ★一次職：クイック（このターン、もう一度行動する・戦闘中max回まで）
  if (skill.extraTurn && (me.quickUsed || 0) < skill.extraTurn.max && me.hp > 0 && foe.hp > 0) {
    me.quickUsed = (me.quickUsed || 0) + 1
    log.push({ side: me.name, type: 'quick', skill: skill.name })
    takeAction(me, foe, rng, log, opt)
  }
}

// ★一次職：技の1発ぶんの倍率。物理と魔法の両方の技は物理のぶん・1発ごとに倍率が変わる技はその発の値
//   （天衝のように溜めで倍率そのものが伸びる技は addMult を足す）
const baseMultOf = (skill, h, ip) => (skill.hybrid ? skill.hybrid.phys
  : skill.hitMults ? (skill.hitMults[h] ?? skill.hitMults[skill.hitMults.length - 1])
  : (skill.mult || 0)) + (ip?.addMult || 0)

// ★一次職：着地・反撃・追撃・召喚の攻撃。1回だけ殴る（反撃や追撃をさらに呼ばない）
//   跳躍中の相手には当たらない。分身は肩代わりしない（行動の攻撃だけを肩代わりする）
const strike = (me, foe, { mult, kind = 'phys', label, hits = 1 }, rng, log) => {
  if (foe.hp <= 0 || me.hp <= 0) return 0
  if (foe.jumping) { log.push({ side: me.name, type: 'airEvade', skill: label }); return 0 }
  const eMe = liveStats(me, true)
  const eFoe = liveStats(foe)
  const dm = passiveDealMult(me, foe)   // 与ダメージ+％はダメージ全体に掛ける
  let raw = 0
  let hit = 0
  let crit = false
  for (let h = 0; h < hits; h++) {
    const r = resolveAttack({
      attacker: eMe, defender: eFoe, mult, kind,
      defPen: me.pa.defPenBonus / 100 + me.evo.defPen / 100,
      hitBonus: me.pa.hitBonus + me.en.hitBonus + ailAccPct(me.ail),
      evaBonus: foe.pa.evaBonus + foe.en.evaBonus + (foe.air ? AIR_EVA : 0),
      critBonus: me.pa.critBonus + (me.critUp || 0),
      hitMult: hitMultOf(me, foe),
      critDmg: critDmgOf(me),
      redMult: 1 + (foe.pa.defRed || 0) / 100,
    }, rng)
    if (r.hit) { raw += Math.max(1, Math.floor(r.damage * dm)); hit++ }
    if (r.hit && r.crit) crit = true
  }
  const after = []
  const dmg = hit > 0 ? applyIncoming(me, foe, raw, kind, rng, after) : 0
  log.push({ side: me.name, type: 'strike', label, damage: dmg, hit: hit > 0, crit })
  for (const l of after) log.push(l)
  return dmg
}

// ★一次職：攻撃のあと（スキルでも通常攻撃でも）。かわされたら相手の反撃、クリティカルなら追撃、分身がいれば追撃
const afterAttack = (me, foe, hits, crit, rng, log) => {
  if (hits === 0 && foe.pa.ex?.counterOnDodge && foe.hp > 0 && me.hp > 0) {
    strike(foe, me, { mult: foe.pa.ex.counterOnDodge, kind: 'phys', label: '反撃' }, rng, log)
  }
  if (crit && me.pa.ex?.critFollow && foe.hp > 0) {
    strike(me, foe, { mult: me.pa.ex.critFollow, kind: 'phys', label: '追撃' }, rng, log)
  }
  const n = me.stk?.clone || 0
  if (n > 0 && me.pa.ex?.cloneFollow && foe.hp > 0) {
    strike(me, foe, { mult: me.pa.ex.cloneFollow * n, kind: 'phys', label: `分身の追撃（${n}体）` }, rng, log)
  }
}

// ★一次職：跳躍中の行動。残りがあれば空中で待ち、最後に着地して斬る（竜の血で着地ダメージ+）
const airborneTurn = (me, foe, rng, log) => {
  const j = me.jumping
  if (j.left > 1) {
    j.left -= 1
    log.push({ side: me.name, type: 'airborne' })
    return
  }
  me.jumping = null
  me.landedTurn = me.turn || 0
  const landPct = me.pa.ex?.landPct || 0
  strike(me, foe, { mult: j.mult * (1 + landPct / 100), kind: 'phys', label: `${j.name}（着地）` }, rng, log)
}

// ★一次職：召喚（死霊・式神）の攻撃。毎ターン、両方の行動のあとに殴る（死霊は数ぶん・死の行軍／鬼神降ろしで強くなる）
const summonAttacks = (me, foe, rng, log) => {
  for (const key of ['undead', 'shiki']) {
    const n = me.stk?.[key] || 0
    if (n <= 0 || me.hp <= 0 || foe.hp <= 0) continue
    const boost = 1 + (me.summonBoost?.[key]?.pct || 0) / 100
    const hits = me.summonHits?.[key]?.hits || 1
    strike(me, foe, { mult: (me.summonMult?.[key] || 0) * n * boost, kind: 'mag', hits,
      label: `${STK_LABEL[key]}${n > 1 ? `${n}体` : ''}の攻撃` }, rng, log)
  }
}

// 通常攻撃。mult は居合の構え（不発時2倍）のための倍率
const normalAttack = (me, foe, rng, log, multScale = 1) => {
  // ★一次職：跳躍中の相手には当たらない／分身が1回ぶん肩代わりする
  if (foe.jumping) {
    log.push({ side: me.name, type: 'airEvade', skill: null })
    foe.justDodged = true
    foe.justHurt = false
    return
  }
  if (foe.stk?.clone > 0) {
    foe.stk.clone -= 1
    log.push({ side: foe.name, type: 'cloneTaken', skill: null, left: foe.stk.clone })
    return
  }
  const eMe = liveStats(me, true)
  const eFoe = liveStats(foe)
  const r = resolveAttack({
    attacker: eMe, defender: eFoe, mult: NORMAL_ATTACK_MULT * multScale, kind: me.kind,
    defPen: me.pa.defPenBonus / 100 + me.evo.defPen / 100,
    hitBonus: me.pa.hitBonus + me.en.hitBonus + evoHit(me, foe) + ailAccPct(me.ail),
    evaBonus: foe.pa.evaBonus + foe.en.evaBonus + evoEva(foe) + foresightEva(foe, null),
    critBonus: me.pa.critBonus + evoCrit(me, foe) + critRateStackOf(me) + (me.critUp || 0),
    hitMult: hitMultOf(me, foe),
    critDmg: critDmgOf(me),
    redMult: 1 + (foe.pa.defRed || 0) / 100,
  }, rng)
  evoOnDodge(foe, r.hit ? 0 : 1)
  foe.justDodged = !r.hit
  foe.justHurt = !!r.hit
  // ★一次職：流水の構え（回避するたび次の攻撃+）・槍の型（当てるたびコンボ）
  if (!r.hit && foe.dodgeBoost?.turns > 0) foe.dodgeStacks = Math.min(foe.dodgeBoost.max, (foe.dodgeStacks || 0) + 1)
  if (r.hit && me.pa.ex?.combo) me.combo = Math.min(me.pa.ex.combo.max, (me.combo || 0) + 1)
  if (r.hit && r.crit) evoOnCrit(me, foe, rng, log)
  // ★一次職：与ダメージ+％（パッシブ）・流水の構えの溜め。ダメージ全体に掛ける
  const ichijiK = passiveDealMult(me, foe) * consumeDodgeBoost(me)
  if (r.hit && ichijiK !== 1) r.damage = Math.max(1, Math.floor(r.damage * ichijiK))
  // 通常攻撃も「物理攻撃」なのでエンチャントの与ダメージ+%とヒット時効果が乗る
  const critMult = r.hit && r.crit && me.evo.critDmg ? 1 + me.evo.critDmg / 100 : 1
  const raw = Math.floor(r.damage * (1 + (me.kind === 'mag' ? me.en.magDmgPct : me.en.physDmgPct) / 100)
    * critMult * evoMult(me, foe, { kind: me.kind, skill: false }))
  // 撃った行を先に出すため、受け手の反応と当てたときの効果はいったん貯める
  const after = []
  const dmg = applyIncoming(me, foe, raw, me.kind, rng, after)
  if (r.hit) { bumpHitStack(me, 1); onHit(me, foe, me.kind, rng, after); evoOnHit(me) }
  const drainRate = me.evo.drain / 100
  if (drainRate > 0 && dmg > 0) me.hp = Math.min(me.base.hp, me.hp + Math.max(1, Math.floor(dmg * drainRate)))
  if (me.kind === 'phys' && me.en.drainPhysPct > 0 && dmg > 0) {
    me.hp = Math.min(me.base.hp, me.hp + Math.max(1, Math.floor(dmg * me.en.drainPhysPct / 100)))
  }
  if (me.en.drainPct > 0 && dmg > 0) {
    me.hp = Math.min(me.base.hp, me.hp + Math.max(1, Math.floor(dmg * me.en.drainPct / 100)))
  }
  // ★一次職：ブラッディロア（その間、攻撃のたびに回復）
  if (me.lifeSteal?.turns > 0 && dmg > 0) gainHp(me, Math.min(drainCapOf(me, !!r.crit), Math.max(1, Math.floor(dmg * me.lifeSteal.pct / 100))))
  log.push({ side: me.name, type: 'normal', kind: me.kind, damage: dmg, crit: r.crit, hit: r.hit, mult: multScale })
  for (const l of after) log.push(l)
  afterAttack(me, foe, r.hit ? 1 : 0, !!(r.hit && r.crit), rng, log)
}

// 回避率。HPが減っているときだけ乗る「際の見切り」をここで足す
const evoEva = (side) => side.evo.eva
  + ((side.hp / Math.max(1, side.base.hp)) * 100 <= EVO_LOW_HP ? side.evo.evaLow : 0)
// 相手が瀕死のとき、命中率とクリティカル率に乗る「仕留め際」ぶん
const foeIsLow = (foe) => (foe.hp / Math.max(1, foe.base.hp)) * 100 <= FOE_LOW_PCT
const evoHit  = (me, foe) => me.evo.hit      + (foeIsLow(foe) ? me.evo.hitFinish : 0)
const evoCrit = (me, foe) => me.evo.critRate + (foeIsLow(foe) ? me.evo.critFinish : 0)

// ターン終了時の持続ダメージ（出血・毒）と、ターン数の減り
// ★出血・毒は割合ダメージなのでVITでは軽減されない（旧版と同じ）
export const tickAil = (side, log, foe = null) => {
  // ★倍率は**入れた側**の武器の進化を見る（受けた側ではない）
  const boost = 1 + (foe?.evo?.ail?.dmg || 0) / 100
  for (const t of tickAilments(side.ail, { hp: side.hp, maxHp: side.base.hp })) {
    t.damage = Math.max(1, Math.floor(t.damage * boost))
    side.hp -= t.damage
    log.push({ side: side.name, type: 'ailTick', ail: AIL_LABEL[t.key], damage: t.damage, stacks: t.stacks })
    checkRevive(side, log)
    if (side.hp <= 0) return
  }
}

// ★吸収の上限（2026-08-23 ユーザー指定）：1回の行動で戻せるのは自分の最大HPの DRAIN_CAP_PCT%。
//   クリティカルが出た行動だけ DRAIN_CAP_CRIT_PCT% まで伸びる。
//   ＝HPが桁違いの相手を殴っても「一撃で全快」にならない
export const DRAIN_CAP_PCT = 10
export const DRAIN_CAP_CRIT_PCT = 15
export const drainCapOf = (me, crit) =>
  Math.max(1, Math.floor(me.base.hp * (crit ? DRAIN_CAP_CRIT_PCT : DRAIN_CAP_PCT) / 100))

// ★出血は「出血している側が行動した直後」に刻む（2026-08-23 ユーザー指定）
//   倍率は**入れた側**の武器の進化を見るので、相手（foe）を渡す
export const tickBleedAfterAct = (side, log, foe = null) => {
  const t = tickBleed(side.ail, side.hp)
  if (!t) return
  const boost = 1 + (foe?.evo?.ail?.dmg || 0) / 100
  const dmg = Math.max(1, Math.floor(t.damage * boost))
  side.hp -= dmg
  log.push({ side: side.name, type: 'ailTick', ail: AIL_LABEL.bleed, damage: dmg, stacks: t.stacks })
  checkRevive(side, log)
}

// 見切りの残りターン（ターン終わりに1つ減る）
export const tickForesight = (side) => {
  if (side.foresight?.turns > 0) {
    side.foresight.turns -= 1
    if (side.foresight.turns <= 0) side.foresight = null
  }
  if (side.frenzy?.turns > 0) {
    side.frenzy.turns -= 1
    if (side.frenzy.turns <= 0) side.frenzy = null
  }
  if (side.timedBuffs?.length) {
    for (const t of side.timedBuffs) t.turns -= 1
    side.timedBuffs = side.timedBuffs.filter(t => t.turns > 0)
  }
}

// ターン終了時の持続効果（回復）
export const tickRegen = (side, log, foe = null) => {
  const eff = liveStats(side)
  // 武器の進化：毎ターンの自動回復（スキルの継続回復とは別枠）
  if (side.evo?.regen) {
    const amt = Math.max(1, Math.floor(side.base.hp * side.evo.regen / 100))
    side.hp = Math.min(side.base.hp, side.hp + amt)
    log.push({ side: side.name, type: 'regenTick', heal: amt })
  }
  if (side.evo?.mpRegen) {
    side.mp = Math.min(side.base.mp, side.mp + Math.max(1, Math.floor(side.base.mp * side.evo.mpRegen / 100)))
  }
  // 相手が状態異常のときだけ効く回復
  if (side.evo?.ail.drain && foe && Object.keys(foe.ail || {}).length > 0) {
    const amt = Math.max(1, Math.floor(side.base.hp * side.evo.ail.drain / 100))
    side.hp = Math.min(side.base.hp, side.hp + amt)
    log.push({ side: side.name, type: 'regenTick', heal: amt })
  }
  if (side.regen?.turns > 0) {
    const amt = healAmount(side, eff, side.regen.rate)
    side.hp = Math.min(side.base.hp, side.hp + amt)
    side.regen.turns -= 1
    log.push({ side: side.name, type: 'regenTick', heal: amt })
  }
  if (side.mpRegen?.turns > 0) {
    const amt = healAmount(side, eff, side.mpRegen.rate)
    side.mp = Math.min(side.base.mp, side.mp + amt)
    side.mpRegen.turns -= 1
    log.push({ side: side.name, type: 'mpRegenTick', mp: amt })
  }
  // ★一次職：毎ターン最大HPの割合で回復（奇跡・再生薬）
  if (side.regenMax?.turns > 0) {
    const got = gainHp(side, healMaxAmount(side, side.regenMax.pct))
    side.regenMax.turns -= 1
    log.push({ side: side.name, type: 'regenTick', heal: got })
    if (side.regenMax.turns <= 0) side.regenMax = null
  }
}

// 戦闘を最後まで回す。fighters は createSide に渡せる形
// band は '朝' | '昼' | '晩'。時間帯条件つきのエンチャントがここで有効／無効になる
export const runBattle = (fighterA, fighterB, { rng = Math.random, maxTurns = MAX_TURNS, band = null } = {}) => {
  const a = createSide(fighterA, band)
  const b = createSide(fighterB, band)
  const log = []
  let turn = 1

  for (; turn <= maxTurns; turn++) {
    // 「経過したターン数」で効くもの（1ターン目は素の値）
    a.turn = turn - 1
    b.turn = turn - 1
    if (a.ramp) a.ramp.turn = a.turn
    if (b.ramp) b.ramp.turn = b.turn
    // 行動順：このターン撃つ予定のスキルの優先度 → AGI → ランダム
    const eA = liveStats(a)
    const eB = liveStats(b)
    const pA = priorityOf(a, peekSkill(a))
    const pB = priorityOf(b, peekSkill(b))
    // 武器の進化「先手必勝」：確率でそのターンの先攻を取る（両方が引いたら通常どおり）
    const fA = a.evo.first > 0 && roll(a.evo.first, rng)
    const fB = b.evo.first > 0 && roll(b.evo.first, rng)
    const aFirst = fA !== fB ? fA : goesFirst(eA, eB, pA, pB, rng)
    const order = aFirst ? [[a, b], [b, a]] : [[b, a], [a, b]]

    for (const [me, foe] of order) {
      if (a.hp <= 0 || b.hp <= 0) break
      takeAction(me, foe, rng, log)
      tickBleedAfterAct(me, log, foe)          // ★出血は行動した直後に刻む
      if (foe.hp <= 0 || me.hp <= 0) break
      // 追加行動（相手よりAGIが高いときだけ・上限50%）
      const em = liveStats(me)
      const ef = liveStats(foe)
      // 武器の進化「疾風の足」ぶんは追加行動率へ素直に足す
      // ★一次職：跳躍中・反動で動けないときは出ない／刻の加護（AGIが相手より高いと確率で）
      if (!me.bigGuard && !me.jumping && !(me.stunned > 0) && (rollExtraAction(em, ef, rng) || (me.evo.extra > 0 && roll(me.evo.extra, rng))
        || (me.pa.ex?.extraIfFaster && em.agi > ef.agi && roll(me.pa.ex.extraIfFaster, rng)))) {
        log.push({ side: me.name, type: 'extra' })
        takeAction(me, foe, rng, log)
        tickBleedAfterAct(me, log, foe)
      }
    }

    if (a.hp <= 0 || b.hp <= 0) break
    // ★一次職：召喚（死霊・式神）の攻撃。両方の行動のあと
    summonAttacks(a, b, rng, log)
    summonAttacks(b, a, rng, log)
    if (a.hp <= 0 || b.hp <= 0) break
    a.bigGuard = 0   // 大防御は1ターンで切れる
    b.bigGuard = 0
    tickAil(a, log, b)
    tickAil(b, log, a)
    if (a.hp <= 0 || b.hp <= 0) break
    tickRegen(a, log, b)
    tickRegen(b, log, a)
    tickForesight(a)
    tickForesight(b)
    // ★一次職：期限つきの効果を減らす。忍耐が終わったら、溜めたダメージを相手へ
    for (const [me, foe] of [[a, b], [b, a]]) {
      const rel = tickIchiji(me)
      if (rel > 0 && foe.hp > 0 && me.hp > 0) {
        const after = []
        const dmg = applyIncoming(me, foe, rel, 'phys', rng, after)
        log.push({ side: me.name, type: 'endureRelease', damage: dmg })
        for (const l of after) log.push(l)
      }
    }
    if (a.hp <= 0 || b.hp <= 0) break
    // 画面でHPバーを出すための、ターン終わりのスナップショット（戦闘の結果には影響しない）
    log.push({ type:'hp', turn, a: Math.max(0, a.hp), aMax: a.base.hp, b: Math.max(0, b.hp), bMax: b.base.hp })
  }

  // 決着した時点のHPも1件出す（倒したときに 0 のバーが出るように。旧版と同じ）
  log.push({ type:'hp', turn: Math.min(turn, maxTurns), a: Math.max(0, a.hp), aMax: a.base.hp, b: Math.max(0, b.hp), bMax: b.base.hp })
  const winner = a.hp <= 0 && b.hp <= 0 ? 'draw' : a.hp <= 0 ? 'b' : b.hp <= 0 ? 'a' : 'draw'
  return { winner, turns: Math.min(turn, maxTurns), log, a, b }
}
