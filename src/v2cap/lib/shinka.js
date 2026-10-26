// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 武器の真化
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「戦闘スタイルによって武器に特殊能力がつくシステムを導入したい」
//   （例：海洋モンスターを倒した割合が高かったら海洋キラー・クリティカル率が高いならクリティカルダメージ）。
//   案を出して、ユーザーが決めたこと：
//   ・記録は**武器ごと**。熟練度が **MAX（SHINKA_MAX＝1,800戦＝約5時間）** になったら、鍛冶屋で**真化**できる（1本につき1回）
//     （「記憶の抽出」のアイテム・効果のアイテム化はあとで作る予定＝能力は持ち物の行に別に持つ）
//   ・付く能力は**立っているフラグの中から抽選で1つ**（均等）。キラーはフラグの1つ
//     【確定】2026-10-26 ユーザー選択「キラーを出にくくする」：**キラーだけくじを半分**（KILLER_WEIGHT）。
//     真化のあとキラーの種族の敵に当たるのは中央値13%（真化は約8時間目＝蒼海の入り江あたりで、そのあと先のエリアへ進む）。
//     ユーザー指示「キラー対象は変えちゃダメ」＝真化したときの種族のまま（最近の種族についていく案・いまの場所に合わせる案はやめた）
//   ・キラー＝倒した敵の**種族の割合1位**（魔物も入れる・**魔物キラーは倍率半分**）＝いつも1つ立つ
//   ・代償つきの能力も**一部に入れる**（同じフラグに「得だけ」と「代償つきで得が大きい」があり、どちらが出るかも抽選）。
//     真化でデメリットが付くこともあるのは HELP に書く
//   ・強さは**真化1本で戦闘力+5%相当**（フラグが噛み合う人で）。敵は測り直さない
//   ・名簿は**今の仕様に合わせて作り直した**（前の V2 の約160種＝core/evolveTraits.js は使わない）
//
// 流れ：
//   ①装備している武器で出撃すると、1戦ごとに熟練度が1（勝ち負けとも・祠の戦闘も）。数えるのはサーバー（v2cap_sortie_settle）
//   ②同じ戦闘で、その武器の戦い方の記録（srec）も積む。
//     画面が戦闘ログから作った分（srecOfBattle）を送り、サーバーが1戦ぶんの上限（SREC_FIELDS の cap・le）を掛けて足す。
//     戦った数（n）・勝ち（w）・倒した敵の種族（race）・時間帯（band）は**サーバーが自分で数える**（画面の申告を使わない）
//   ③熟練度が MAX になったら鍛冶屋で真化（v2cap_shinka）。**抽選はサーバー**（画面は能力を選べない）
//   ④能力は戦闘エンジンの「武器の進化」の部品（core/evolveAtoms.js）で効く。toFighter（loadout.js）が着けている武器から渡す
//
// ★フラグの境目（th）と能力の値は tools/v2cap-shinka-sim.mjs で測って決める（33職のシミュレーション）。
// ★SQL は tools/v2cap-sql.mjs の種（shinka_fields・shinka_flags・monster_race）で JS から作る＝手で書き写さない
// ============================================================
import { RACES, RACE_BY_KEY, raceOf } from './monsterRace.js'
import { recordOfBattle } from '../core/evolve.js'
import { atomText } from '../core/evolveAtoms.js'

export const SHINKA_MAX = 1800        // 熟練度MAX（1戦で1・10秒に1戦で約5時間）
export const SHINKA_COST_PCT = 30     // 代償つきのあるフラグで、代償つきが出る確率（%）
export const MONSTER_RACE = 'monster' // 魔物（残り全部の受け皿）
export const MONSTER_KILLER_MULT = 0.5 // 魔物キラーは倍率半分（ユーザー指示）
export const SHINKA_MIN_DEN = 30      // 割合の分母（当てた数・勝った数など）がこれ未満のフラグは立たない
export const KILLER_WEIGHT = 0.5      // 抽選のキラーのくじ（ほかのフラグは1・2026-10-26 ユーザー選択「キラーを出にくくする」）
export const BANDS = ['朝', '昼', '晩']

// ===== 戦い方の記録（1本の武器ぶん） =====
// 画面が戦闘ログから作って送る項目。cap＝1戦で足せる上限・le＝同じ戦闘のその項目を超えない・winOnly＝勝ったときだけ（0か1）
// ★サーバー（v2cap_shinka_count）はこの表（種 shinka_fields）で上限を掛ける
export const SREC_FIELDS = [
  { key:'hit',    cap:300 },                     // 当てた回数
  { key:'crit',   cap:300, le:'hit' },           // そのうちクリティカル
  { key:'multi',  cap:300, le:'hit' },           // 多段技で当てた
  { key:'normal', cap:300, le:'hit' },           // 通常攻撃で当てた
  { key:'drain',  cap:300, le:'hit' },           // 吸収した
  { key:'ail',    cap:150 },                     // 状態異常を入れた
  { key:'dot',    cap:300 },                     // 継続ダメージ（出血・毒・火傷）が相手に入った
  { key:'ailed',  cap:150 },                     // 状態異常にかかった
  { key:'taken',  cap:300 },                     // 受けた攻撃（外れも）
  { key:'dodge',  cap:300, le:'taken' },         // そのうちかわした
  { key:'hurt',   cap:100 },                     // 失ったHPの割合（0〜100）
  { key:'fin',    cap:100 },                     // 相手を瀕死（HP30%以下）にしてから決着までのターン
  { key:'heal',   cap:100 },                     // 回復技を使った
  { key:'buff',   cap:100 },                     // 強化技を使った
  { key:'mpe',    cap:1 },                       // MPを使い切って終わった
  { key:'low',    cap:1, winOnly:true },         // 残りHP30%以下で勝った
  { key:'back',   cap:1, winOnly:true },         // 一度HP25%以下まで追い込まれてから勝った
  { key:'clean',  cap:1, winOnly:true },         // 無傷で勝った
  { key:'fast',   cap:1, winOnly:true },         // SHINKA_FAST_TURNS（2）ターン以内で勝った
  { key:'long',   cap:1, winOnly:true },         // SHINKA_LONG_TURNS（6）ターン以上かけて勝った
  { key:'big',    cap:1, winOnly:true },         // 自分より戦闘力が上の敵に勝った
]
export const SREC_KEYS = SREC_FIELDS.map(f => f.key)

// n＝戦った数・w＝勝ち・l＝負け（どれもサーバーが数える）
export const emptySrec = () => ({ n: 0, w: 0, l: 0, race: {}, band: {}, ...Object.fromEntries(SREC_KEYS.map(k => [k, 0])) })

// 「すぐに勝った」「長い戦い」のターン数。★v2cap の戦闘は短い（勝った戦闘の中央値3ターン・99%が8ターン以内＝
//   tools/v2cap-shinka-sim.mjs で測った）。前の V2 の 5／15 ターン（core/evolve.js）のままだと、すぐ＝ほぼ全員・長い＝誰もいなかった
export const SHINKA_FAST_TURNS = 2
export const SHINKA_LONG_TURNS = 6

// 1戦ぶん（画面が送る形）。r … runBattle の返り値・you … 自分の名前
export const srecOfBattle = (r, you) => {
  const x = recordOfBattle(r, you)
  const win = r?.winner === 'a'
  const turns = r?.turns || 0
  return {
    hit: x.hits, crit: x.crit, multi: x.multiHits, normal: x.normalHits, drain: x.drains,
    ail: x.ail, dot: x.ailTicks, ailed: x.ailed, taken: x.taken, dodge: x.dodged,
    hurt: Math.round(x.hurtPct * 100), fin: x.finishTurns, heal: x.heals, buff: x.buffs, mpe: x.mpEmpty,
    low: x.lowWin, back: x.comeback, clean: x.perfect, big: x.bigWin,
    fast: win && turns <= SHINKA_FAST_TURNS ? 1 : 0, long: win && turns >= SHINKA_LONG_TURNS ? 1 : 0,
  }
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)))

// 1戦ぶんを足す（サーバーの v2cap_shinka_count と同じ決まり。シミュレーションとテストのための写し）
// add … 画面が送った形（srecOfBattle）・win … 勝ったか・enemy … 敵の名前・band … その戦闘の時間帯（朝・昼・晩）
export const addSrec = (rec, add, { win = false, enemy = null, band = null } = {}) => {
  const out = { ...emptySrec(), ...(rec || {}) }
  out.race = { ...(rec?.race || {}) }
  out.band = { ...(rec?.band || {}) }
  out.n += 1
  if (win) out.w += 1; else out.l += 1
  const got = {}
  for (const f of SREC_FIELDS) {
    let v = clampInt(add?.[f.key], 0, f.cap)
    if (f.winOnly && !win) v = 0
    if (f.le) v = Math.min(v, got[f.le] ?? 0)
    got[f.key] = v
    out[f.key] = (Number(out[f.key]) || 0) + v
  }
  const race = win && enemy ? raceOf(enemy) : null
  if (race) out.race[race] = (out.race[race] || 0) + 1
  if (band && BANDS.includes(band)) out.band[band] = (out.band[band] || 0) + 1
  return out
}

// ===== フラグ =====
// num ÷ den（分母は記録の項目）。dir＝'ge'（境目以上で立つ）／'le'（境目以下で立つ＝少ないほどよいもの）。
// th はシミュレーション（tools/v2cap-shinka-sim.mjs）で決めた値。
// ★killer（種族）といつも立つ。band（時間帯）は「いちばん多い時間帯の割合」
export const FLAGS = [
  { key:'killer', special:'race', weight: KILLER_WEIGHT, label:(p) => `${raceLabelOf(p)}をいちばん多く倒した` },
  { key:'crit',   num:'crit',   den:'hit',   dir:'ge', th:0.35, label:() => 'クリティカルがよく出た' },
  { key:'multi',  num:'multi',  den:'hit',   dir:'ge', th:0.2, label:() => '多段技でよく当てた' },
  { key:'normal', num:'normal', den:'hit',   dir:'ge', th:0.16, label:() => '通常攻撃でよく当てた' },
  { key:'drain',  num:'drain',  den:'hit',   dir:'ge', th:0.03, label:() => '与えたダメージをよく吸収した' },
  { key:'ail',    num:'ail',    den:'hit',   dir:'ge', th:0.24, label:() => '状態異常をよく入れた' },
  { key:'dot',    num:'dot',    den:'n',     dir:'ge', th:0.3,  label:() => '出血・毒・火傷のダメージがよく入った' },
  { key:'ailed',  num:'ailed',  den:'n',     dir:'ge', th:0.2,  label:() => '状態異常によくかかった' },
  { key:'dodge',  num:'dodge',  den:'taken', dir:'ge', th:0.3, label:() => '敵の攻撃をよくかわした' },
  { key:'hurt',   num:'hurt',   den:'n',     dir:'ge', th:29,   label:() => 'HPを大きく削られることが多かった' },
  { key:'fin',    num:'fin',    den:'n',     dir:'le', th:0.42,  label:() => '追い込んでから倒すのが速かった' },
  { key:'heal',   num:'heal',   den:'n',     dir:'ge', th:0.1,  label:() => '回復技をよく使った' },
  { key:'buff',   num:'buff',   den:'n',     dir:'ge', th:2,  label:() => '強化技をよく使った' },
  // ★「MPを使い切った」は入れない（2026-10-26 測った）：v2cap は1戦ごとに全回復・戦闘は2〜3ターンなので、ほとんど誰も立たず、
  //   立っても「消費MP−%」はボス戦で0%相当だった。記録の mpe は数えるだけ（あとで使うとき用）
  { key:'low',    num:'low',    den:'w',     dir:'ge', th:0.03, label:() => 'HPが少ないまま勝つことが多かった' },
  { key:'back',   num:'back',   den:'w',     dir:'ge', th:0.02, label:() => '追い込まれてから勝つことがあった' },
  { key:'clean',  num:'clean',  den:'w',     dir:'ge', th:0.25, label:() => '無傷で勝つことが多かった' },
  { key:'fast',   num:'fast',   den:'w',     dir:'ge', th:0.28, label:() => 'すぐに勝つことが多かった' },
  { key:'long',   num:'long',   den:'w',     dir:'ge', th:0.13, label:() => '長い戦いが多かった' },
  // ★「自分より強い敵に勝った」（記録の big）は v2cap ではほぼ0（ボスを倒すとすぐ次の場所へ進む＝強い敵に勝つのは1回ずつ）。
  //   代わりに**負けの割合**（サーバーが数える l）＝先へ先へと挑み続けた人（2026-10-26 測った：中央値4.8%・上位2割5.3%）
  { key:'big',    num:'l',      den:'n',     dir:'ge', th:0.053, label:() => '負けても強い敵に挑み続けた' },
  { key:'band',   special:'band', dir:'ge',  th:0.75,  label:(p) => `${p}の時間帯によく戦った` },
]
export const FLAG_BY_KEY = Object.fromEntries(FLAGS.map(f => [f.key, f]))

const raceLabelOf = (key) => RACE_BY_KEY[key]?.label || key || '？'

// いちばん多く倒した種族（同じ数なら種族の並び順で前のもの）。1体も倒していなければ null
export const killerRaceOf = (rec) => {
  let best = null
  for (const r of RACES) {
    const n = Number(rec?.race?.[r.key]) || 0
    if (n > 0 && (!best || n > best.n)) best = { key: r.key, n }
  }
  return best?.key || null
}
// いちばん多く戦った時間帯とその割合
export const topBandOf = (rec) => {
  const n = Number(rec?.n) || 0
  let best = null
  for (const b of BANDS) {
    const v = Number(rec?.band?.[b]) || 0
    if (v > 0 && (!best || v > best.v)) best = { band: b, v }
  }
  return best ? { band: best.band, share: n > 0 ? best.v / n : 0 } : null
}

// フラグの値（割合）。分母が SHINKA_MIN_DEN 未満なら null（立たない）
export const flagValueOf = (rec, flag) => {
  if (flag.special === 'band') {
    const t = topBandOf(rec)
    return t && (Number(rec?.n) || 0) >= SHINKA_MIN_DEN ? t.share : null
  }
  if (flag.special) return null
  const den = Number(rec?.[flag.den]) || 0
  if (den < SHINKA_MIN_DEN) return null
  return (Number(rec?.[flag.num]) || 0) / den
}

// 立っているフラグ [{ key, param }]（param＝キラーの種族・時間帯）。並びは FLAGS の順
export const flagsOf = (rec) => {
  const out = []
  for (const f of FLAGS) {
    if (f.special === 'race') {
      const race = killerRaceOf(rec)
      if (race) out.push({ key: f.key, param: race })
      continue
    }
    const v = flagValueOf(rec, f)
    if (v === null) continue
    if (f.dir === 'le' ? v <= f.th : v >= f.th) out.push({ key: f.key, param: f.special === 'band' ? topBandOf(rec).band : null })
  }
  return out
}
export const flagLabelOf = (fl) => FLAG_BY_KEY[fl?.key]?.label(fl?.param) || ''

// ===== 能力 =====
// フラグ1つに能力1つ（gain＝得）。alt＝代償つき（得が大きい・SHINKA_COST_PCT% で出る）。
// 値は「その戦い方の人が着けたとき、戦闘力+5%相当」を目安に tools/v2cap-shinka-sim.mjs --value で測って決めた
//   （そのフラグが立っていたキャラが、その場所のボスに勝率5割になる強さの伸びを、ステ全部+5%の伸びと比べる）。
//   ★2026-10-26 1回目に測ったら、案のときの値（海洋キラー＝与ダメ+10% など）はどれも+5%相当より弱かった
//     （与ダメ+10%はボス戦で戦闘力+2.8%相当）。測った比で上げた。条件の狭いもの（通常攻撃・多段・とどめ・かわした次）は
//     当たる回数が少ないので、書いてある数字は大きくなる（ユーザーの決まり「技の威力は条件で決める」と同じ考え）
// ★キラーの dmgRace／dmgOtherRace は、魔物なら MONSTER_KILLER_MULT 倍（半分）
// ★band の dmg は「その時間帯に戦っているときだけ」乗る（shinkaEvolutionOf が時間帯を見て外す）
//   ★2回目：条件の狭いもの（多段・吸収・状態異常・かわした次・とどめ・回復）は倍率だけ上げると数字が極端になるので、
//     小さい2つ目の効果を足した（ユーザーの決まり「倍率は極端に上げ下げしない」）
//   ★4回目に測った中央値（n=150・各8人）：キラー4.8（当たったとき）・代償つきキラー7.9／ほかの種族−2.1・会心4.1・血染め5.7・
//     多段4.4・通常攻撃3.5・吸収5.6・状態異常4.0・継続ダメージ2.8・免疫3.6・紙一重4.2・軽身6.8・被ダメ5.6・とどめ3.4・
//     回復2.6・鼓舞5.0・背水4.4・捨て身5.0・不屈5.0・バリア5.0・すぐ勝つ2.9・長い戦い3.6・時間帯5.7（その時間帯）。
//     同じ能力でも人によって0.3〜13とばらつく。「負けても挑み続けた」（下剋上）は立つ人がまだ測れていない
//     （測った相手はその場所のボスだけ＝ふつうの敵と塔は測っていない）
export const ABILITIES = {
  killer: { name: (p) => `${raceLabelOf(p)}キラー`, gain: { dmgRace: 17 },
            alt: { name: (p) => `${raceLabelOf(p)}狩りの執念`, gain: { dmgRace: 26 }, cost: { dmgOtherRace: 7 } } },
  crit:   { name: '会心', gain: { critDmg: 30 },
            alt: { name: '血染めの会心', gain: { critDmg: 45 }, cost: { critHpCost: 1.5 } } },
  multi:  { name: '連ね打ち', gain: { dmgMulti: 40, dmgSkill: 4 } },
  normal: { name: '無骨', gain: { dmgNormal: 80, st_str: 4 } },
  drain:  { name: '吸命', gain: { drain: 10, st_hp: 3 } },
  ail:    { name: '搦め手', gain: { ailRate: 20, dmgAil: 12 } },
  dot:    { name: '蝕み', gain: { ailDmg: 50, dmgAil: 18 } },
  ailed:  { name: '免疫', gain: { ailResist: 50, cut: 5 } },
  dodge:  { name: '紙一重', gain: { dmgDodge: 50, eva: 4 },
            alt: { name: '軽身', gain: { dmgDodge: 80, eva: 5 }, cost: { st_vit: 5 } } },
  hurt:   { name: '打たれ強さ', gain: { cut: 14 } },
  fin:    { name: 'とどめ', gain: { dmgFinish: 50, critFinish: 15 } },
  heal:   { name: '癒し手', gain: { heal: 40, regen: 1.5 } },
  buff:   { name: '鼓舞', gain: { buffPow: 60 } },
  low:    { name: '背水', gain: { dmgLow: 40 },
            alt: { name: '捨て身', gain: { dmgLow: 60 }, cost: { taken: 5 } } },
  back:   { name: '不屈', gain: { guts: 55 } },
  clean:  { name: '無傷の誇り', gain: { shieldStart: 20 } },
  fast:   { name: '先駆け', gain: { dmgFirst: 30 } },
  long:   { name: '粘り腰', gain: { dmgLate: 20 } },
  big:    { name: '下剋上', gain: { dmgBig: 15 } },
  band:   { name: (p) => ({ 朝: '暁の刻', 昼: '白昼の刻', 晩: '月下の刻' }[p] || '刻'), gain: { dmg: 15 } },
}

// 真化の中身（持ち物の行の shinka 列）＝ { key, cost, param }。値は持たない（名簿から引く）
export const isShinka = (sh) => !!(sh && ABILITIES[sh.key])
// 能力の値（キラーが魔物なら半分）。{ name, gain, cost }
export const shinkaEffectOf = (sh) => {
  const ab = ABILITIES[sh?.key]
  if (!ab) return null
  const def = sh.cost && ab.alt ? ab.alt : ab
  const half = sh.key === 'killer' && sh.param === MONSTER_RACE ? MONSTER_KILLER_MULT : 1
  const scale = (t) => Object.fromEntries(Object.entries(t || {}).map(([a, v]) => [a, Math.round(v * half * 10) / 10]))
  const name = typeof def.name === 'function' ? def.name(sh.param) : def.name
  return { name, gain: scale(def.gain), cost: scale(def.cost) }
}
export const shinkaNameOf = (sh) => shinkaEffectOf(sh)?.name || ''

// 表示の1行ずつ [{ text, cost }]。キラーは種族の名前・時間帯はその時間帯を入れる
export const shinkaLines = (sh) => {
  const e = shinkaEffectOf(sh)
  if (!e) return []
  const race = raceLabelOf(sh.param)
  const textOf = (atom, v, cost) => {
    if (atom === 'dmgRace') return `${race}への与ダメージ+${v}%`
    if (atom === 'dmgOtherRace') return `${race}以外のモンスターへの与ダメージ-${v}%`
    if (sh.key === 'band' && atom === 'dmg') return `${sh.param}の時間帯は与ダメージ+${v}%`
    return atomText(atom, v, cost)
  }
  return [
    ...Object.entries(e.gain).map(([a, v]) => ({ text: textOf(a, v, false), cost: false })),
    ...Object.entries(e.cost).map(([a, v]) => ({ text: textOf(a, v, true), cost: true })),
  ].filter(l => l.text)
}

// 戦闘エンジンへ渡す形（core/evolve.js の collectEvolutions が読む { gain, cost, race }）。
// band … いまの時間帯。時間帯の能力は合っているときだけ乗る（合っていなければ null）
export const shinkaEvolutionOf = (sh, band = null) => {
  const e = shinkaEffectOf(sh)
  if (!e) return null
  if (sh.key === 'band' && sh.param !== band) return null
  return { gain: e.gain, cost: e.cost, race: sh.key === 'killer' ? sh.param : null }
}

// ===== 抽選（サーバーの v2cap_shinka と同じ決まり。シミュレーションとテストのための写し） =====
// 立っているフラグから1つ（くじはどれも1・キラーだけ KILLER_WEIGHT）→ 代償つきのあるフラグなら SHINKA_COST_PCT% で代償つき
// くじの重み（フラグの weight・無ければ1）。キラーだけ KILLER_WEIGHT
export const flagWeightOf = (key) => FLAG_BY_KEY[key]?.weight ?? 1
// 立っているフラグから重みどおりに1つ（サーバーの v2cap_shinka_pick と同じ）
export const pickFlag = (pool, rng = Math.random) => {
  const total = pool.reduce((t, p) => t + flagWeightOf(p.key), 0)
  let x = rng() * total
  return pool.find(p => (x -= flagWeightOf(p.key)) < 0) || pool[pool.length - 1]
}
export const rollShinka = (rec, rng = Math.random) => {
  const pool = flagsOf(rec)
  if (!pool.length) return null
  const pick = pickFlag(pool, rng)
  const cost = !!ABILITIES[pick.key]?.alt && rng() * 100 < SHINKA_COST_PCT
  return { key: pick.key, cost, param: pick.param ?? null }
}

// ===== 熟練度 =====
export const masteryOf = (row) => Math.max(0, Math.min(SHINKA_MAX, Math.floor(Number(row?.mastery) || 0)))
export const canShinka = (row) => !isShinka(row?.shinka) && masteryOf(row) >= SHINKA_MAX
export const masteryLeftOf = (row) => SHINKA_MAX - masteryOf(row)

// ===== 着けている武器から =====
// profile.equipped.weapon＝持ち物の id。持ち物の行の shinka を戦闘の形にして返す（無ければ []）
export const weaponRowOf = (profile, inventory) => {
  const id = profile?.equipped?.weapon
  return id == null ? null : (inventory || []).find(r => String(r.id) === String(id)) || null
}
export const shinkaEvolutionsOf = (profile, inventory, band = null) => {
  const ev = shinkaEvolutionOf(weaponRowOf(profile, inventory)?.shinka, band)
  return ev ? [ev] : []
}
