// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— アセンション（スキルツリー）
// ------------------------------------------------------------
// 【確定】2026-10-13 ユーザー指示（AION2 のダエバニオンを参考に）＋選んだこと（設計 §4-2）：
//   ・CLASS LVが1上がるごとに **AP を1** もらう（職業ごと）。初期職はCLASS LV30で29・上位職はCLASS LV50で49
//   ・**どのマスも1AP**。盤面は**職業ごと**で、効くのは**その職業でいる間だけ**（クラスのステと同じ）
//   ・形は**まばらに枝分かれした木**（同じ日にユーザー「もっとツリーっぽく」「アイオン2みたいにまばらに配置
//     （○○の道みたいに決まった道がなく、欲しい能力までどのルートで届かせるか）」で、4本の道から作り直した）：
//     真ん中の起点から4方向に枝分かれ。**起点か開いたマスにつながったマスだけ開ける**。
//     形は段階（初期職・上位職）ごとに1つ（tools/v2cap-asc-layout.mjs が作る ascLayout.js）。中身は職業ごと
//   ・全部は埋まらない（**半分くらい**）：初期職 56マス（1方向14）／上位職 96マス（1方向24）
//   ・小マスのステは**盤面全体に混ぜる**（ユーザーが選んだ「どの方向にもいろいろなステ。通るルートで取れるステが変わる」）：
//     ステごとの数はクラスのステの配分（JOB_BONUS）の割合・置き場は職業ごとに決まった順で散らす（mixStatsOf）。
//     起点から遠いほど強い：初期職 +2→+3→+4・上位職 +3→+4→+5（HPは×8・MPは×3＝戦闘力が同じ）
//   ・スキルマス：**技1つにつき1マス**（パッシブには作らない）。枝の先に置く。攻撃の技＝威力+20%・回復の技＝回復量+10%・
//     バフの技＝上がり幅を**合計で+10**（剣の構え STR+15%・AGI+12% → STR+21%・AGI+16%）。
//     %で書けないバフ（クイック・分身の術・装填・鬼神降ろし・狂信）は回数・ターンを+1。
//     ★上がり幅は**技ごとに変える予定**（ユーザー）＝ ASC_SKILL_UP に技の名前で書けば差し替わる
//     【確定】2026-10-15 ユーザー選択「技ごとに型を決める」「+15ポイント」：**状態異常を付ける攻撃の技は、威力の代わりに状態異常の確率+15ポイント**
//     （上限100%・下の ascTypeOf）。状態異常の無い攻撃の技は威力+か追加効果を技ごとに決める（追加効果の案はユーザーと決める＝まだ無い）
//   ・大マス：4方向のいちばん遠い枝の先・伸びるステの上位4つ（JOB_BONUS の多い順・上→右→下→左）の+5%（初期職・上位職とも）。
//     スキルマスは、その技がよく使うステの大マスと同じ方向の枝の先に置く
//   ・振り直しは **LV×100 Gold**。その職業の盤面を全部戻してAPを返す
//   ・敵の強さの測り直し（tools/v2cap-progress.mjs）には入れない（ユーザー決定）
//
// ★権威はサーバー（supabase_v2cap_core.sql §12 の v2cap_ascend／v2cap_ascend_reset と、盤面の種 v2cap_asc_nodes・v2cap_asc_mp）。
//   ここが盤面の中身と効果の正。種は tools/v2cap-sql.mjs がここから作る（v2capsql.test.js が突き合わせる）
// ★サーバーが数えるのは「つながっているか」「APが足りるか」と「スキル編成の最大MP」（MPのマス）だけ。ほかの効果は戦闘（この写し）で効く
// ============================================================
import { STAT_KEYS, STAT_DEFS } from '../../v2/lib/stats.js'
import { AIL_LABEL } from '../../v2/lib/ailments.js'
import { SKILL_BY_NAME, skillsOf, isPassive } from './skills.js'
import { JOB_BONUS, CLASSES, stageOf, jobOf, jobLevelsGained, ASC_AP_PER_JLV } from './jobs.js'
import { ASC_LAYOUT } from './ascLayout.js'

export const ASC_DIRS = 4
// 段階ごとの中身。tiers … 小マスの値（起点から近い順に3段）／bigPct … 大マス
export const ASC_SHAPE = {
  shoki:  { tiers: [2, 3, 4], bigPct: 5 },
  ichiji: { tiers: [3, 4, 5], bigPct: 5 },
}
// ★盤面のステの色（2026-10-14）。ステータス画面の色（STAT_DEFS）は STR/LUK・HP/DEX・MP/VIT が似ていて
//   色だけでは見分けにくいので、盤面だけ8色をはっきり分ける（画面 V2capAscension.jsx・画像を作るときもこの色に合わせる＝設計 §4-2）
export const ASC_STAT_COLOR = {
  hp: '#ff5a6e',       // 赤
  mp: '#4f8dff',       // 青
  str: '#ffc933',      // 金
  dex: '#3fe07f',      // 緑
  agi: '#ff8a3d',      // 橙
  int_stat: '#b866ff', // 紫
  vit: '#c6d2e4',      // 銀
  luk: '#ff7fd0',      // 桃
}
// 振り直しの費用（LV×これ Gold）
export const ASC_RESET_GOLD_PER_LV = 100
export const ascResetGoldOf = (lv) => Math.max(1, lv || 1) * ASC_RESET_GOLD_PER_LV


// ===== スキルマスの上がり幅 =====
// 【確定】2026-10-13 ユーザー指示「一旦1マス威力20%UP、回復のスキルは10%、バフスキルは合計10%上昇」
export const ASC_UP_DEFAULT = { attack: 20, heal: 10, buff: 10, count: 1 }
// 技ごとの上がり幅（ユーザーがあとで決める）。{ 袈裟斬り: 25 } のように書くと、その技だけ差し替わる
export const ASC_SKILL_UP = {}

// %で書けないバフは回数・ターンを+1（2026-10-13 ユーザーが選んだ）。key.field の数を足す
export const ASC_COUNT_UP = {
  クイック:   { key: 'extraTurn',    field: 'max',   label: '戦闘中に使える回数', unit: '回' },
  分身の術:   { key: 'gain',         field: 'n',     label: '1回で出す分身',     unit: '体' },
  装填:       { key: 'gain',         field: 'n',     label: '1回で増える装填',   unit: '' },
  鬼神降ろし: { key: 'summonHits',   field: 'turns', label: '続くターン',        unit: 'ターン' },
  狂信:       { key: 'debuffImmune', field: 'turns', label: '続くターン',        unit: 'ターン' },
  // 2026-10-15 上位クラスの作り直し（チャット版の設計）で入った技。field: null は技の項目そのものが数
  照準:       { key: 'gain',         field: 'n',     label: '1回で増える照準',   unit: '' },
  弾帯換装:   { key: 'gain',         field: 'n',     label: '1回で増える装填',   unit: '' },
  詠唱:       { key: 'resoGain',     field: null,    label: '1回で増える共鳴',   unit: '' },
  // 2026-10-16 ユーザーがスキル一覧のシートで書いた（ブラッディロア「4ターン→5ターン」・狂鬼化「3ターン→4ターン」）
  ブラッディロア: { key: 'lifeSteal', field: 'turns', label: '続くターン',      unit: 'ターン' },
  狂鬼化:         { key: 'berserk',   field: 'turns', label: '続くターン',      unit: 'ターン' },
}
// ステの表を持たないバフの「上がり幅」（%の数）。上から見て最初に持っているものに足す。
// scale … 1点の大きさ（召喚の倍率は ×0.25＝25% の形なので 0.01）
export const ASC_BUFF_PARAMS = [
  { key: 'guard',       field: 'cut',  label: '受けるダメージ', sign: -1, scale: 1 },    // 受け止め・気の鎧・陰陽結界・祈りの結界
  // ★ブラッディロア（吸収+10%）と狂鬼化（払うHP−10%）は 2026-10-16 に「続くターン+1」へ（ASC_COUNT_UP・ユーザーがシートで書いた）
  { key: 'endure',      field: 'pct',  label: '返すダメージ',   sign: 1, scale: 1 },     // 忍耐
  { key: 'dodgeBoost',  field: 'pct',  label: '回避したあとの威力', sign: 1, scale: 1 }, // 流水の構え
  { key: 'summonBoost', field: 'pct',  label: '召喚の攻撃力',   sign: 1, scale: 1 },     // 死の行軍
  { key: 'revive',      field: 'pct',  label: '復活したときのHP', sign: 1, scale: 1 },   // リザレクション
  { key: 'nextBoost',   field: 'per',  label: '溜め1つの威力',  sign: 1, scale: 1 },     // 照準・詠唱
  { key: 'summon',      field: 'mult', label: '召喚の攻撃',     sign: 1, scale: 0.01 },  // 骸骨召喚・式神召喚（魔法×0.25→×0.35）
  // 2026-10-14 上位職の並び替えで入った技（今のⅡの侍・聖騎士から）
  { key: 'stance',      field: 'proc', label: '次の技の発動率', sign: 1, scale: 1 },     // 納刀（+20%→+30%）
  { key: 'bigGuard',    field: 'cut',  label: '1ターンの受けるダメージ', sign: -1, scale: 1 }, // 大防御（−60%→−70%）
  // 2026-10-15 上位クラスの作り直し（チャット版の設計）で入った技。neg … 値を小さくする向きに足す（相手のAGI−20%→−30%・MP×0.5→×0.4）
  { key: 'vow',         field: 'cut',  label: '受けるダメージ', sign: -1, scale: 1 },     // 不動の誓い（−15%→−25%）
  { key: 'soar',        field: 'land', label: '着地ダメージ',   sign: 1, scale: 1 },      // 竜翔（+20%→+30%）
  { key: 'counterBoost', field: 'pct', label: '回避したときの反撃の威力', sign: 1, scale: 1 }, // 後の先（+60%→+70%）
  { key: 'ailUp',       field: 'pct',  label: '状態異常を付ける確率', sign: 1, scale: 1 }, // 死の刻印（+25%→+35%）
  { key: 'trap',        field: 'mult', label: '罠の威力',       sign: 1, scale: 0.01 },   // くくり罠・トラバサミ（×1.54→×1.64）
  { key: 'lockOn',      field: 'critDmg', label: 'クリティカルのダメージ', sign: 1, scale: 1 }, // ロックオン（+10%→+20%）
  { key: 'repeatLast',  field: 'mpMult', label: '繰り返す技のMP', sign: 1, scale: 0.01, neg: true }, // リピート（×0.5→×0.4）
  { key: 'bind',        field: 'foeAgi', label: '相手のAGI',    sign: 1, scale: 1, neg: true },  // 封縛結界（−20%→−30%）
  { key: 'shieldGain',  field: 'pct',  label: 'バリア（最大HPの）', sign: 1, scale: 1 },  // 光の帳（12%→22%）
  { key: 'gospel',      field: 'healMult', label: '回復量',     sign: 1, scale: 0.01 },   // ゴスペル（×1.5→×1.6）
  { key: 'philo',       field: 'ailUp', label: '状態異常を付ける確率', sign: 1, scale: 1 }, // 賢者の石（+20%→+30%）
]

// スキルマスの種類（攻撃・回復・バフ・回数）。パッシブと知らない種類は null（マスを作らない）
export const ascKindOf = (skill) => {
  if (!skill || isPassive(skill)) return null
  if (skill.kind === 'phys' || skill.kind === 'mag') return 'attack'
  if (skill.kind === 'heal') return 'heal'
  if (skill.kind === 'buff') return ASC_COUNT_UP[skill.name] ? 'count' : 'buff'
  return null
}
// ===== 攻撃の技のマスの型（2026-10-15 ユーザー選択「技ごとに型を決める」）=====
//   power … 威力+（ASC_UP_DEFAULT.attack＝20%）
//   ail   … 状態異常を付ける攻撃の技は、威力の代わりに**状態異常の確率+**（上限100%）。2026-10-15 は一律+15ポイント→
//           2026-10-16 から状態異常ごと（下の ASC_AIL_UP_BY：毒+15〜麻痺+3）。
//           付ける所＝ail・ails（1発ごとも）・跳躍の着地（天竜落とし）・宿りを消したときの付与（マナバースト）。
//   custom … 技ごとの特別なマス（下の ASC_CUSTOM・ユーザーがシートで書いたもの）。どの型より先に見る
//           もう100%の技（火刑・裂傷）は上げても変わらないので威力のまま。補助の技（罠・ストップなど）はバフのマスのまま
//   【確定】2026-10-16 ユーザー「案の通りいれる」（状態異常の無い攻撃の技は、今ある効果を伸ばす。ほかはこれまで通り威力+20%）：
//   defPen … 防御無視+10%（例：鎧通し 50%→60%）／debuff … 相手の能力ダウンの下げ幅+5%（薙ぎ払い AGI−15%→−20%）／
//   drain … 吸収+10%（生命吸収 25%→35%）／dispel … 相手の強化を消す確率+15%（盗み取る 40%→55%・もう100%の聖水・異端の烙印は威力）／
//   critMult … クリティカル時のダメージ+0.1（絶影狙撃 ×1.3→×1.4）。同じ技に2つあるときは上の並び（状態異常が先）
// 【確定】2026-10-16 ユーザー「麻痺とか8%でしょう？それに+15%はおかしいから状態異常によって増える%変えて」：
//   上がる確率は状態異常ごと。もとの確率が高くて効き目の軽いもの（毒・火傷・出血・鈍足）は大きく、
//   低くて重いもの（1ターン止める麻痺・技を封じる封印・技がでたらめになる狂乱）は小さく
export const ASC_AIL_UP_BY = { poison: 15, burn: 15, bleed: 15, slow: 15, blind: 10, curse: 10, weaken: 10, fear: 10, seal: 5, frenzy: 5, paralyze: 3 }
export const ASC_AIL_UP_OTHER = 10   // 表に無い状態異常・宿りを消したときの付与（マナバースト＝属性で火傷・麻痺・鈍足が変わるので真ん中）
export const ASC_AIL_UP = Math.max(...Object.values(ASC_AIL_UP_BY))   // いちばん大きい上がり幅（前の一律の+15と同じ）
export const ASC_EFFECT_UP = { ail: ASC_AIL_UP, defPen: 10, debuff: 5, drain: 10, dispel: 15, critMult: 10 }
const ailChancesOf = (s) => [
  ...(s?.ail ? [s.ail.chance] : []),
  ...((s?.ails || []).map(a => a.chance)),
  ...(s?.jump?.ail ? [s.jump.ail.chance] : []),
  ...(s?.consumeImbue?.ailChance ? [s.consumeImbue.ailChance] : []),
]
// その技の状態異常ごとの上がり幅（ail・ails・跳躍の着地・宿りの付与の並び）。ASC_SKILL_UP に書いた技は全部その値
const ailUpOf = (key, name) => ASC_SKILL_UP[name] ?? ASC_AIL_UP_BY[key] ?? ASC_AIL_UP_OTHER
const ailUpsOf = (s) => [
  ...(s?.ail ? [ailUpOf(s.ail.key, s.name)] : []),
  ...((s?.ails || []).map(a => ailUpOf(a.key, s.name))),
  ...(s?.jump?.ail ? [ailUpOf(s.jump.ail.key, s.name)] : []),
  ...(s?.consumeImbue?.ailChance ? [ASC_SKILL_UP[s.name] ?? ASC_AIL_UP_OTHER] : []),
]

// ===== 技ごとの特別なマス（2026-10-16 ユーザーがスキル一覧のシートで書いた）=====
//   ユーザー「こんなかんじにがっつり能力追加変える効果とかもあって欲しい」。威力や確率の代わりに、その技の効果を足す・変える。
//   apply … マスを開いた技の形（開いていれば1回だけ効く＝上がり幅の数は見ない）／short・detail … 文
const round3x = (v) => Math.round(v * 1000) / 1000
export const ASC_CUSTOM = {
  // 侍
  居合斬: {
    short: '納刀中のクリ率+20%',
    detail: (s) => `納刀中のクリティカル率 +${s.whileStance?.crit || 0}%→+${(s.whileStance?.crit || 0) + 20}%`,
    apply: (s) => ({ ...s, whileStance: { ...s.whileStance, crit: (s.whileStance?.crit || 0) + 20 } }),
  },
  納刀: {
    short: '回避+10%',
    detail: () => '納刀状態のあいだ（次にスキルを撃つまで）回避率+10%',
    apply: (s) => ({ ...s, stance: { ...s.stance, eva: (s.stance?.eva || 0) + 10 } }),
  },
  明鏡止水: {
    // ★ユーザーの書いた形：合計+10%を STR と DEX に半分ずつ（大きさの割合で分ける ASC の決まりではなく）
    short: '合計+10%',
    detail: (s) => `STR+${s.buff.self.str}%→+${s.buff.self.str + 5}%・DEX+${s.buff.self.dex}%→+${s.buff.self.dex + 5}%`,
    apply: (s) => ({ ...s, buff: { ...s.buff, self: { ...s.buff.self, str: s.buff.self.str + 5, dex: s.buff.self.dex + 5 } } }),
  },
  桜花一閃: {
    short: '納刀中の威力+30%',
    detail: () => '納刀中に撃つと威力+30%（ダメージ全体）',
    apply: (s) => ({ ...s, whileStance: { ...s.whileStance, dmg: (s.whileStance?.dmg || 0) + 30 } }),
  },
  二の太刀: {
    short: '発動率+10%',
    detail: (s) => `発動率 ${s.proc}%→${Math.min(100, s.proc + 10)}%`,
    apply: (s) => ({ ...s, proc: Math.min(100, s.proc + 10) }),
  },
  '秘剣・叢雲': {
    short: '納刀中の倍率+0.2',
    detail: (s) => `納刀中の威力 ×${s.stanceMult}→×${round3x(s.stanceMult + 0.2)}`,
    apply: (s) => ({ ...s, stanceMult: round3x((s.stanceMult ?? 1.5) + 0.2) }),
  },
  // 狂戦士
  ブラッドサクリファイス: {
    short: '払うHP+3%・追加+10%',
    detail: (s) => `払うHP 最大HPの${s.hpCostMax.pct}%→${s.hpCostMax.pct + 3}%・追加ダメージ 払ったHPの${Math.round(s.paidDmg * 100)}%→${Math.round(s.paidDmg * 100) + 10}%`,
    apply: (s) => ({ ...s, hpCostMax: { ...s.hpCostMax, pct: s.hpCostMax.pct + 3 }, paidDmg: round3x(s.paidDmg + 0.1) }),
  },
}

export const ascTypeOf = (skill) => {
  if (ascKindOf(skill) !== 'attack') return null
  if (ASC_CUSTOM[skill.name]) return 'custom'
  if (ailChancesOf(skill).some(c => c < 100)) return 'ail'
  if (skill.defPen > 0 && skill.defPen < 1) return 'defPen'
  if (Object.values(skill.buff?.enemy || {}).some(v => v)) return 'debuff'
  if (skill.drain > 0) return 'drain'
  if (skill.dispel && (skill.dispel.chance ?? 100) < 100) return 'dispel'
  if (skill.critMult > 0) return 'critMult'
  return 'power'
}
export const ascUpOf = (name) => {
  const s = SKILL_BY_NAME[name]
  const k = ascKindOf(s)
  if (!k) return 0
  if (ASC_CUSTOM[name]) return 1
  const type = ascTypeOf(s)
  // 状態異常の型は、その技の状態異常の上がり幅のいちばん大きい値（1つずつの値は ascendSkill が状態異常ごとに見る）
  if (type === 'ail') return Math.max(...ailUpsOf(s))
  return ASC_SKILL_UP[name] ?? (type && type !== 'power' ? ASC_EFFECT_UP[type] : ASC_UP_DEFAULT[k])
}
// 状態異常の確率を状態異常ごとの上がり幅だけ上げた形（上限100%）。cap … マスの上がり幅（塔の守護者の姿が前の+15・威力20を持っていても、状態異常ごとの値まで）
const plusPct = (c, n) => Math.min(100, c + n)
const raiseAil = (s, cap = Infinity) => {
  const n = (key) => Math.min(cap, ailUpOf(key, s.name))
  return {
    ...s,
    ...(s.ail ? { ail: { ...s.ail, chance: plusPct(s.ail.chance, n(s.ail.key)) } } : {}),
    ...(s.ails ? { ails: s.ails.map(a => ({ ...a, chance: plusPct(a.chance, n(a.key)) })) } : {}),
    ...(s.jump?.ail ? { jump: { ...s.jump, ail: { ...s.jump.ail, chance: plusPct(s.jump.ail.chance, n(s.jump.ail.key)) } } } : {}),
    ...(s.consumeImbue?.ailChance ? { consumeImbue: { ...s.consumeImbue, ailChance: plusPct(s.consumeImbue.ailChance, Math.min(cap, ASC_SKILL_UP[s.name] ?? ASC_AIL_UP_OTHER)) } } : {}),
  }
}

// 合計 total を表の値の大きさの割合で分ける（整数・端数は余りの大きい順＝同じなら表の並びの先）。符号は元の値に合わせる
export const splitUp = (table, total) => {
  const keys = Object.keys(table || {}).filter(k => table[k])
  const sum = keys.reduce((t, k) => t + Math.abs(table[k]), 0)
  if (!keys.length || sum <= 0) return {}
  const raw = keys.map(k => (total * Math.abs(table[k])) / sum)
  const got = raw.map(v => Math.floor(v + 1e-9))
  let left = total - got.reduce((a, b) => a + b, 0)
  const order = keys.map((_, i) => i).sort((a, b) => (raw[b] - got[b]) - (raw[a] - got[a]) || a - b)
  for (const i of order) {
    if (left <= 0) break
    got[i] += 1
    left -= 1
  }
  return Object.fromEntries(keys.map((k, i) => [k, Math.sign(table[k]) * got[i]]))
}

// バフの表（自分＋相手）をひとまとめに見る（今の技はどちらか一方だけ）
const buffEntries = (skill) => ['self', 'enemy'].flatMap(side =>
  Object.entries(skill?.buff?.[side] || {}).filter(([, v]) => v).map(([k, v]) => ({ side, k, v })))
const round3 = (v) => Math.round(v * 1000) / 1000

// その技にスキルマスを当てた形を返す（元の技は書き換えない）。up は上がり幅（ascUpOf）
//   攻撃 … ascDmg（%）＝戦闘エンジン（src/v2/lib/battle.js）がその技のダメージ全体に掛ける
//   回復 … ascHeal（%）＝同じく回復量（HP・MP・毎ターンの回復）に掛ける
//   バフ … 表の上がり幅を合計 up だけ足す／表が無ければ ASC_BUFF_PARAMS の最初の項目に up 足す
//   回数 … ASC_COUNT_UP の数に up 足す
export const ascendSkill = (skill, up = ascUpOf(skill?.name)) => {
  const kind = ascKindOf(skill)
  if (!kind || !up) return skill
  // ★技ごとの特別なマス（2026-10-16）：開いていれば1回だけ（前の型の上がり幅を持つ塔の守護者の姿でも同じ形）
  if (ASC_CUSTOM[skill.name]) return ASC_CUSTOM[skill.name].apply(skill)
  if (kind === 'attack') {
    const type = ascTypeOf(skill)
    if (type === 'power') return { ...skill, ascDmg: (skill.ascDmg || 0) + up }
    // ★状態異常は状態異常ごとの上がり幅（up は上限として見る＝塔の守護者の姿が前の+15・威力20を持っていても今の値まで）
    if (type === 'ail') return raiseAil(skill, up)
    // ★効果の型は今の上がり幅より大きくしない（塔の守護者の姿が、型を変える前の上がり幅＝威力20を持っていても型の値に収める）
    const n = Math.min(up, ASC_SKILL_UP[skill.name] ?? ASC_EFFECT_UP[type])
    if (type === 'defPen') return { ...skill, defPen: round3(Math.min(1, skill.defPen + n / 100)) }
    if (type === 'debuff') return { ...skill, buff: { ...skill.buff, enemy: Object.fromEntries(Object.entries(skill.buff.enemy).map(([k, v]) => [k, v < 0 ? v - n : v + n])) } }
    if (type === 'drain') return { ...skill, drain: round3(skill.drain + n / 100) }
    if (type === 'dispel') return { ...skill, dispel: { ...skill.dispel, chance: plusPct(skill.dispel.chance ?? 100, n) } }
    if (type === 'critMult') return { ...skill, critMult: round3(skill.critMult + n / 100) }
    return skill
  }
  if (kind === 'heal') return { ...skill, ascHeal: (skill.ascHeal || 0) + up }
  if (kind === 'count') {
    const c = ASC_COUNT_UP[skill.name]
    // ★回数・ターンは今の上がり幅まで（ブラッディロア・狂鬼化は 2026-10-16 にバフの「合計+10」から変わった＝塔の守護者の姿の10を+10ターンにしない）
    const n = Math.min(up, ASC_SKILL_UP[skill.name] ?? ASC_UP_DEFAULT.count)
    if (c.field == null) return { ...skill, [c.key]: (skill[c.key] || 0) + n }
    return { ...skill, [c.key]: { ...skill[c.key], [c.field]: (skill[c.key]?.[c.field] || 0) + n } }
  }
  const ents = buffEntries(skill)
  if (ents.length) {
    const flat = Object.fromEntries(ents.map((e, i) => [i, e.v]))
    const add = splitUp(flat, up)
    const buff = { ...skill.buff }
    ents.forEach((e, i) => { buff[e.side] = { ...buff[e.side], [e.k]: e.v + (add[i] || 0) } })
    return { ...skill, buff }
  }
  const p = ASC_BUFF_PARAMS.find(x => skill[x.key]?.[x.field] !== undefined)
  if (!p) return skill
  return { ...skill, [p.key]: { ...skill[p.key], [p.field]: round3(skill[p.key][p.field] + up * p.scale * (p.neg ? -1 : 1)) } }
}

// ===== 文 =====
const STAT_LABEL = (k) => STAT_DEFS[k]?.label || k
const signed = (v) => (v < 0 ? `−${-v}` : `+${v}`)
// 攻撃の技のマスの型ごとの短い文
const ASC_SHORT = {
  power: (up) => `威力+${up}%`, ail: (up) => `確率+${up}%`, defPen: (up) => `防御無視+${up}%`, debuff: (up) => `下げ幅+${up}%`,
  drain: (up) => `吸収+${up}%`, dispel: (up) => `解除+${up}%`, critMult: (up) => `クリダメ+${up}%`,
}
// スキルマスの短い文（木のマスに出す2行目）
export const ascSkillShort = (name) => {
  const kind = ascKindOf(SKILL_BY_NAME[name])
  const up = ascUpOf(name)
  if (kind && ASC_CUSTOM[name]) return ASC_CUSTOM[name].short
  if (kind === 'attack' && ascTypeOf(SKILL_BY_NAME[name]) === 'ail') {
    // 状態異常ごとの上がり幅（同じなら1つ。違えば並べる＝毒霧の術「確率+15%・+10%」）
    const ns = [...new Set(ailUpsOf(SKILL_BY_NAME[name]))]
    return `確率${ns.map(n => `+${n}%`).join('・')}`
  }
  if (kind === 'attack') return ASC_SHORT[ascTypeOf(SKILL_BY_NAME[name])](up)
  if (kind === 'heal') return `回復量+${up}%`
  if (kind === 'count') return `${ASC_COUNT_UP[name].unit === 'ターン' ? 'ターン' : '回数'}+${up}`
  // バフは上がり幅を合計で足す（ユーザーの言い方「合計10%上昇」。1.1倍と読み違えないように「効果+」にはしない）
  if (kind === 'buff') return `合計+${up}%`
  return ''
}
// スキルマスのくわしい文（前 → 後）。例「STR+10%→+14%・DEX+9%→+12%・AGI+8%→+11%」
export const ascSkillDetail = (name) => {
  const s = SKILL_BY_NAME[name]
  const kind = ascKindOf(s)
  const up = ascUpOf(name)
  if (!kind) return ''
  if (ASC_CUSTOM[name]) return ASC_CUSTOM[name].detail(s)
  if (kind === 'attack' && ascTypeOf(s) === 'ail') {
    // 例「毒 70%→85%・暗闇 20%→35%」（宿りの付与は属性で変わるので「宿りの属性の状態異常」）
    const a = ascendSkill(s, up)
    const pairs = [
      ...(s.ail ? [[AIL_LABEL[s.ail.key], s.ail.chance, a.ail.chance]] : []),
      ...((s.ails || []).map((x, i) => [AIL_LABEL[x.key], x.chance, a.ails[i].chance])),
      ...(s.jump?.ail ? [[AIL_LABEL[s.jump.ail.key], s.jump.ail.chance, a.jump.ail.chance]] : []),
      ...(s.consumeImbue?.ailChance ? [['宿りの属性の状態異常', s.consumeImbue.ailChance, a.consumeImbue.ailChance]] : []),
    ]
    return pairs.map(([l, b, c]) => `${l} ${b}%→${c}%`).join('・') + (s.ailPerHit ? '（1発ごと）' : '')
  }
  if (kind === 'attack') {
    const type = ascTypeOf(s)
    const a = ascendSkill(s, up)
    const pct = (v) => `${Math.round(v * 100)}%`
    if (type === 'defPen') return `防御無視 ${pct(s.defPen)}→${pct(a.defPen)}`
    if (type === 'debuff') return Object.entries(s.buff.enemy).map(([k, v]) => `相手の${STAT_LABEL(k)}${signed(v)}%→${signed(a.buff.enemy[k])}%`).join('・')
    if (type === 'drain') return `吸収 ${pct(s.drain)}→${pct(a.drain)}`
    if (type === 'dispel') return `相手の強化を消す ${s.dispel.chance ?? 100}%→${a.dispel.chance}%`
    if (type === 'critMult') return `クリティカル時のダメージ ×${s.critMult}→×${a.critMult}`
    return `威力+${up}%（ダメージ全体）`
  }
  if (kind === 'heal') return `回復量+${up}%`
  const a = ascendSkill(s, up)
  if (kind === 'count') {
    const c = ASC_COUNT_UP[name]
    const v = (x) => (c.field == null ? x[c.key] : x[c.key][c.field])
    return `${c.label} ${v(s)}${c.unit}→${v(a)}${c.unit}`
  }
  const ents = buffEntries(s)
  if (ents.length) {
    const after = buffEntries(a)
    return ents.map((e, i) => `${e.side === 'enemy' ? '相手の' : ''}${STAT_LABEL(e.k)}${signed(e.v)}%→${signed(after[i].v)}%`).join('・')
  }
  const p = ASC_BUFF_PARAMS.find(x => s[x.key]?.[x.field] !== undefined)
  if (!p) return ''
  const fmt = (v) => (p.scale === 1 ? `${signed(p.sign * v)}%` : `×${v}`)
  return `${p.label} ${fmt(s[p.key][p.field])}→${fmt(a[p.key][p.field])}`
}

// ===== 盤面の中身 =====
// 4つの大マスのステ＝クラスのステの配分の多い順に4つ（同じ数ならステの並び STAT_KEYS の先）。並び＝上・右・下・左
export const areaStatsOf = (cls) => Object.entries(JOB_BONUS[cls] || {})
  .filter(([, v]) => v > 0)
  .sort((a, b) => b[1] - a[1] || STAT_KEYS.indexOf(a[0]) - STAT_KEYS.indexOf(b[0]))
  .slice(0, ASC_DIRS)
  .map(([k]) => k)

// その技がどのステをよく使うか（どの方向に置くかの目安。数が大きいほどその方向に置きたい）
export const skillAffinity = (skill) => {
  const a = {}
  const add = (k, v) => { if (k && v > 0) a[k] = (a[k] || 0) + v }
  if (skill?.kind === 'phys') add(skill.src || 'str', 1)
  if (skill?.kind === 'mag' || skill?.kind === 'heal') add(skill.src || 'int_stat', 1)
  for (const x of skill?.add || []) add(x.stat, x.rate)
  for (const [k, v] of Object.entries(skill?.buff?.self || {})) add(k, v / 100)
  return a
}

// 【確定】2026-10-15 ユーザー決定（上位クラスの技が10個になった）：上位クラスは技10個すべてにマスを作る。
//   盤面の形とマスの数（96）は変えず、方向0・1（上・右）の i 番目の小マス（起点から12・枝の先）を3つ目のスキルマス（skill3）にする
//   ★ascLayout.js（形）は書き換えない＝保存してある番号はそのまま。上位クラスの盤面の中身は変わるので、2026-10-15 の移し替えで一度戻す
export const ASC_EXTRA_SKILL = { ichiji: { i: 18, dirs: [0, 1] } }
// n 個を4方向へ（なるべく同じ数・余りは上の方向から）。どの方向もスキルマスの置き場は2つまで（ascLayout の skill1・skill2）＋上位クラスは方向0・1に3つ目
const capacityOf = (n) => Array.from({ length: ASC_DIRS }, (_, r) => Math.floor(n / ASC_DIRS) + (r < n % ASC_DIRS ? 1 : 0))

// 技を方向へ置く。覚える順に、その技がよく使うステの方向（空きがあるところ）へ。
// 同じなら空きの多い方向・上の方向。返すのは方向ごとの技の名前（覚える順）
export const placeSkillsOf = (cls, stats = areaStatsOf(cls)) => {
  const names = skillsOf(cls).filter(s => ascKindOf(s)).map(s => s.name)
  const cap = capacityOf(names.length)
  const out = stats.map(() => [])
  for (const name of names) {
    const aff = skillAffinity(SKILL_BY_NAME[name])
    let best = -1
    for (let r = 0; r < stats.length; r++) {
      if (cap[r] <= 0) continue
      if (best < 0) { best = r; continue }
      const d = (aff[stats[r]] || 0) - (aff[stats[best]] || 0)
      if (d > 1e-9 || (Math.abs(d) <= 1e-9 && cap[r] > cap[best])) best = r
    }
    if (best < 0) break
    out[best].push(name)
    cap[best] -= 1
  }
  return out
}

// ===== 小マスのステを混ぜる =====
// 数＝クラスのステの配分（JOB_BONUS）の割合で n マスを分ける（最大剰余・同じなら配分の多いステ→ステの並びの先）。
// 置き場＝職業の名前から作った決まった順（乱数の種）で並べ替える＝いつ開いても同じ盤面。
// ★この決め方を変えると、開いたマス（番号）のステが変わる＝変えるときはユーザーに聞く
const hashOf = (str) => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
const rngOf = (seed) => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
export const statCountsOf = (cls, n) => {
  const w = Object.entries(JOB_BONUS[cls] || {}).filter(([, v]) => v > 0)
  const sum = w.reduce((t, [, v]) => t + v, 0)
  if (!w.length || sum <= 0 || n <= 0) return {}
  const raw = w.map(([k, v]) => ({ k, v, x: (n * v) / sum }))
  for (const r of raw) r.c = Math.floor(r.x + 1e-9)
  let left = n - raw.reduce((t, r) => t + r.c, 0)
  const order = [...raw].sort((a, b) => (b.x - b.c) - (a.x - a.c) || b.v - a.v || STAT_KEYS.indexOf(a.k) - STAT_KEYS.indexOf(b.k))
  for (const r of order) { if (left <= 0) break; r.c += 1; left -= 1 }
  return Object.fromEntries(raw.filter(r => r.c > 0).map(r => [r.k, r.c]))
}
// 小マスの番号（並び順）→ステ
export const mixStatsOf = (cls, ids) => {
  const counts = statCountsOf(cls, ids.length)
  const pool = STAT_KEYS.flatMap(k => Array(counts[k] || 0).fill(k))
  const rng = rngOf(hashOf(`asc:${cls}`))
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return Object.fromEntries(ids.map((id, i) => [id, pool[i]]))
}

// その職業の盤面。nodes[i] ＝ 形（id・q・x・y・d・links＝ ascLayout.js）＋中身：
//   { type:'start' } ／ { type:'stat', stat, amount（ステの値。HPは×8）, pts（戦闘力） } ／ { type:'skill', skill, up } ／ { type:'big', stat, pct }
//   スキルマスの置き場（skill1・skill2）に技が無い方向は、その置き場も小マスにする
const BOARD_CACHE = {}
const buildBoard = (cls) => {
  const stage = stageOf(cls)
  const layout = ASC_LAYOUT[stage]
  const shape = ASC_SHAPE[stage]
  if (!layout || !shape) return null
  const stats = areaStatsOf(cls)
  if (stats.length < ASC_DIRS) return null
  const placed = placeSkillsOf(cls, stats)
  const ex = ASC_EXTRA_SKILL[stage]
  const isSkill3 = (n) => !!ex && n.role === 'stat' && ex.dirs.includes(n.q) && n.id - 1 - n.q * layout.perQuad === ex.i
  const skillOf = (n) => (n.role === 'skill1' ? placed[n.q][0] : n.role === 'skill2' ? placed[n.q][1] : isSkill3(n) ? placed[n.q][2] : null) || null
  // 小マス（技の入らなかったスキルの置き場も小マス）の番号の順にステを混ぜて置く
  const statIds = layout.nodes.filter(n => n.role !== 'start' && n.role !== 'big' && !skillOf(n)).map(n => n.id)
  const mixed = mixStatsOf(cls, statIds)
  const nodes = layout.nodes.map(n => {
    const base = { id: n.id, q: n.q, x: n.x, y: n.y, d: n.d, links: n.links }
    if (n.role === 'start') return { ...base, type: 'start' }
    if (n.role === 'big') return { ...base, type: 'big', stat: stats[n.q], pct: shape.bigPct }
    const skill = skillOf(n)
    if (skill) return { ...base, type: 'skill', skill, up: ascUpOf(skill) }
    const stat = mixed[n.id]
    const pts = shape.tiers[n.tier]
    return { ...base, type: 'stat', stat, amount: pts * STAT_DEFS[stat].unit, pts }
  })
  return { cls, stage, R: layout.R, stats, nodes, byId: Object.fromEntries(nodes.map(n => [n.id, n])) }
}
export const treeOf = (cls) => (cls in BOARD_CACHE ? BOARD_CACHE[cls] : (BOARD_CACHE[cls] = buildBoard(cls)))
// 全部のマスの数（起点を除く＝全部開くのに要るAP）
export const treeSizeOf = (cls) => Math.max(0, (treeOf(cls)?.nodes.length || 1) - 1)

// マスの文（盤に出す）。1行目と2行目
export const nodeLines = (node) => {
  if (!node) return ['', '']
  if (node.type === 'start') return ['起点', '']
  if (node.type === 'stat') return [`${STAT_LABEL(node.stat)}+${node.amount}`, '']
  if (node.type === 'big') return [`${STAT_LABEL(node.stat)}+${node.pct}%`, '']
  return [node.skill, ascSkillShort(node.skill)]
}
export const nodeText = (node) => {
  if (!node) return ''
  if (node.type === 'skill') return `${node.skill}：${ascSkillDetail(node.skill)}`
  return nodeLines(node)[0]
}

// ===== 持っている状態 =====
// profile.ascension ＝ { "剣士": [3, 7, 12] }＝開いたマスの番号（起点の0は入れない）。
// 盤面に無い番号・数でないもの（"3" のような文字も）・重なりは捨てる（サーバーの v2cap_asc_state と同じ）
export const ascStateOf = (profile, cls = profile?.class) => {
  const t = treeOf(cls)
  const raw = profile?.ascension?.[cls]
  if (!t || !Array.isArray(raw)) return []
  const out = new Set()
  for (const v of raw) {
    if (typeof v === 'number' && Number.isInteger(v) && v > 0 && t.byId[v]) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}
// AP（その職業のCLASS LVが上がった回数×1）・使ったAP（開いたマスの数）・残り
export const apTotalOf = (cls, jlv) => jobLevelsGained(cls, jlv) * ASC_AP_PER_JLV
export const apSpentOf = (state) => (state || []).length
export const apLeftOf = (profile, cls = profile?.class) =>
  apTotalOf(cls, jobOf(profile?.jobs, cls).lv) - apSpentOf(ascStateOf(profile, cls))

// 開いたマス
export const ownedNodesOf = (cls, state) => {
  const have = new Set(state || [])
  return (treeOf(cls)?.nodes || []).filter(n => have.has(n.id))
}

// 効果のまとめ。flat … 小マスのステ（ステの値）／pct … 大マスのステ+%／ups … スキルマス { 技の名前: 上がり幅 }
export const ascEffectsOf = (profile, cls = profile?.class) => {
  const flat = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  const pct = {}
  const ups = {}
  for (const n of ownedNodesOf(cls, ascStateOf(profile, cls))) {
    if (n.type === 'stat') flat[n.stat] += n.amount
    else if (n.type === 'big') pct[n.stat] = (pct[n.stat] || 0) + n.pct
    else if (n.type === 'skill') ups[n.skill] = (ups[n.skill] || 0) + n.up
  }
  return { flat, pct, ups }
}
// 大マスの「+%」で増える量（base＝本体＋クラス＋装備＋小マスのステ。四捨五入＝サーバーの v2cap_asc_mp と同じ）
export const ascPctGain = (base, pct) =>
  Object.fromEntries(STAT_KEYS.map(k => [k, pct?.[k] ? Math.round(((base?.[k] || 0) * pct[k]) / 100) : 0]))

// ===== 開けるか（サーバーの v2cap_ascend と同じ順・同じ文言）=====
// ids を順に開く。どのマスも、起点・開いたマス・この中で先に開くマスのどれかにつながっていること
export const ascendError = (profile, cls, ids) => {
  const t = treeOf(cls)
  if (!t) return 'その職業にはアセンションがありません'
  if (!Array.isArray(ids) || ids.length === 0) return 'マスを選んでください'
  const open = new Set([0, ...ascStateOf(profile, cls)])
  for (const raw of ids) {
    const id = Number(raw)
    const n = Number.isInteger(id) && id > 0 ? t.byId[id] : null
    if (!n) return 'そのマスはありません'
    if (open.has(id)) return 'もう開いています'
    if (!n.links.some(l => open.has(l))) return 'つながっていないマスは開けません'
    open.add(id)
  }
  if (ids.length > apLeftOf(profile, cls)) return 'APが足りません'
  return null
}

// いちばん近いルート：起点と開いたマスから target まで、まだ開いていないマスだけを通る最短の並び（近い順・target が最後）。
// 開いていれば []・無いマスなら null。同じ長さのルートが2つ以上あるときは、番号の小さいほうから広げて先に届いたもの
export const routeTo = (cls, state, target) => {
  const t = treeOf(cls)
  if (!t?.byId[target] || target === 0) return null
  const open = new Set([0, ...(state || [])])
  if (open.has(target)) return []
  const prev = new Map()
  const queue = []
  for (const id of [...open].sort((a, b) => a - b)) {
    for (const nb of t.byId[id].links) {
      if (!open.has(nb) && !prev.has(nb)) { prev.set(nb, -1); queue.push(nb) }
    }
  }
  for (let i = 0; i < queue.length && !prev.has(target); i++) {
    for (const nb of t.byId[queue[i]].links) {
      if (!open.has(nb) && !prev.has(nb)) { prev.set(nb, queue[i]); queue.push(nb) }
    }
  }
  if (!prev.has(target)) return null
  const path = []
  for (let id = target; id !== -1; id = prev.get(id)) path.unshift(id)
  return path
}

// スキル編成の最大MPに入るマス（MPの小マス・MPの大マス）。SQLの種 v2cap_asc_mp
export const mpNodesOf = (cls) => (treeOf(cls)?.nodes || [])
  .filter(n => n.stat === 'mp' && (n.type === 'stat' || n.type === 'big'))
  .map(n => ({ id: n.id, mp: n.type === 'stat' ? n.amount : 0, pct: n.type === 'big' ? n.pct : 0 }))

// どの職業にも盤面があるか（テストと種で使う）
export const ASC_CLASSES = CLASSES.map(c => c.id).filter(id => treeOf(id))
