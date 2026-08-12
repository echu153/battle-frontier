// ============================================================
// バトルフロンティアⅡ（リメイク版）— スキル
// ------------------------------------------------------------
// ・名前は旧版（無印）から流用。倍率・発動率・消費MPはv2で新規に決めた
// ・参照するステータスはv2の8種（物理=STR / 魔法=INT、副参照でAGI・VIT等）
// ・スキルは毎ターン「発動率」で抽選する（あるけみすと式。強い技ほど出にくい）
// ・倍率はあるけみすとを基準にしつつ、初期職は少し低めに置いた
//     あるけみすと：通常 2.0〜2.6倍 ／ 大技 4.0倍前後 ／ 発動率 60〜95%
//     v2の初期職  ：物理は0.8〜1.65倍 ／ 魔法は1.3〜1.85倍 ／ 発動率85〜100%
//   → 上位職に伸びしろを残すため。ノーブルはさらに一段低い
// ・発動率はあるけみすとに合わせて85%以上に置く（向こうも75〜100%が大半で、
//   60%以下はメテオストライク60%・フルハウス20%くらい。旅人も95/85/80%）。
//   強さの調整は発動率を削るのではなく倍率で行う
// ・魔法の倍率が物理より高いのは、魔法のほうが軽減上限が高く(50% vs 34%)防御力も厚いから
//   （あるけみすとも魔法はINT×2.6〜3.55と物理STR×2.2〜2.4より高い）
//
// ★いまはこのファイルがスキルの正。戦闘をサーバー権威にするときに
//   v2_classes と同じくDBの表へ移す（それまでは調整の速さを優先してJSに置く）。
// ★状態異常（毒・出血・麻痺など）はまだ設計していないので入れていない。
//   入れるときは effect を足し、combat.js ではなく戦闘ループ側で消費する。
// ============================================================

// kind: phys=STR基準の物理 / mag=INT基準の魔法 / heal=回復 / buff=補助
export const KIND_LABEL = { phys:'物理', mag:'魔法', heal:'回復', buff:'補助' }
export const KIND_COLOR = { phys:'#ffcc00', mag:'#cc44ff', heal:'#44ff88', buff:'#44aaff' }

// mult   : 主ステータス（STR/INT）に掛ける倍率
// add    : 副ステータス参照 [{ stat, rate }]
// hits   : 多段の回数（命中・クリは1発ずつ判定する）
// proc   : 発動率(%)。毎ターン抽選する
// defPen : 防御無視(0〜1)
// sureHit: 必中
// noCrit : クリティカルしないスキル。あるけみすとにも「クリティカルするスキルとしないスキル」があり、
//          ゲーム内には表記されない。クリの固定加算(＋1.5)は元の係数によらないため
//          多段スキルほど恩恵が大きい＝v2では多段を noCrit にして素の倍率で調整する
// sureCrit: 確定クリティカル（あるけみすとの「破魔の一撃」「刺閃」に相当）。初期職では未使用
// priority: 行動順の優先度。0=通常（AGI順）／1以上=先制。
//           v2の割り当ての規則は「自分を守る・立て直す技（回復と防御バフ）は先制」。
//           攻撃バフ（気合い・精神統一・残心・駆け足）とMP回復は通常のAGI順のまま
// buff   : { self:{ステ:%}, enemy:{ステ:%} }
//          ステータスの増減は**戦闘中ずっと続き、重ねがけで加算される**（あるけみすと準拠。
//          向こうも「重ね掛け可能」「回避成功毎に+3%」と累積前提で、ターン数の記載が無い）
// heal   : { rate }                  …即時HP回復（INT×rate）
// regen  : { rate, turns }           …毎ターンHP回復（INT×rate）
// mpRegen: { rate, turns }           …毎ターンMP回復（INT×rate）
// ※回復は最大HP/MPの％ではなく INT を参照する（あるけみすと準拠。神聖なる手＝INT×1.5）。
//   最大HPを積むほど回復量まで伸びる歪みを作らないため。初期職はあるけみすとより低め
export const SKILLS = [
  // ===== ノーブル（開始時の職業。一段低い） =====
  { name:'はたく',     cls:'ノーブル', kind:'phys', mult:1.3, proc:95, mp:0,  desc:'素手で殴る。消費MPなし' },
  { name:'狙い撃ち',   cls:'ノーブル', kind:'phys', mult:1.35, proc:90, mp:5,  sureHit:true, desc:'必ず当たる一撃' },
  { name:'応急手当',   cls:'ノーブル', kind:'heal', proc:85, mp:8,  heal:{ rate:1.0 }, priority:1, desc:'INT×1.0を回復' },
  { name:'身構える',   cls:'ノーブル', kind:'buff', proc:100, mp:6, buff:{ self:{ vit:35 } }, priority:1, desc:'VIT+35%（重ねがけ可）' },
  { name:'気合い',     cls:'ノーブル', kind:'buff', proc:90, mp:8,  buff:{ self:{ str:15 } }, desc:'STR+15%（重ねがけ可）' },

  // ===== 戦士（物理・耐久） =====
  { name:'体当たり',       cls:'戦士', kind:'phys', mult:1.4, proc:95, mp:5,  desc:'素直な体当たり' },
  { name:'強撃',           cls:'戦士', kind:'phys', mult:1.65, proc:85, mp:12, desc:'力を込めた一撃' },
  { name:'防御崩し',       cls:'戦士', kind:'phys', mult:1.2, proc:90, mp:10, buff:{ enemy:{ vit:-15 } }, desc:'相手のVIT-15%（重ねがけ可）' },
  { name:'防御態勢',       cls:'戦士', kind:'buff', proc:100, mp:8, buff:{ self:{ vit:50 } }, priority:1, desc:'VIT+50%（重ねがけ可）' },
  { name:'シールドアタック', cls:'戦士', kind:'phys', mult:0.95, add:[{ stat:'vit', rate:0.5 }], proc:90, mp:10, desc:'盾で殴る。VITも威力になる' },

  // ===== 弓使い（命中・素早さ） =====
  { name:'狙撃',     cls:'弓使い', kind:'phys', mult:0.8, add:[{ stat:'agi', rate:0.6 }], proc:90, mp:8, sureHit:true, desc:'必中。AGIも威力になる' },
  { name:'剛射',     cls:'弓使い', kind:'phys', mult:1.65, proc:85, mp:11, desc:'強く引き絞って射る' },
  { name:'貫通射撃', cls:'弓使い', kind:'phys', mult:1.4, defPen:0.3, proc:85, mp:12, desc:'相手の防御を30%無視' },
  { name:'疾風矢',   cls:'弓使い', kind:'phys', mult:1, add:[{ stat:'agi', rate:0.5 }], proc:90, mp:8, desc:'速射。AGIも威力になる' },
  { name:'駆け足',   cls:'弓使い', kind:'buff', proc:100, mp:6, buff:{ self:{ agi:30 } }, desc:'AGI+30%（重ねがけ可）' },

  // ===== 魔法使い（火力特化） =====
  { name:'マジックアロー', cls:'魔法使い', kind:'mag', mult:1.5, proc:95, mp:5,  desc:'消費が軽い基本の魔法' },
  { name:'ファイア',       cls:'魔法使い', kind:'mag', mult:1.8, proc:85, mp:11, desc:'火の魔法' },
  { name:'サンダー',       cls:'魔法使い', kind:'mag', mult:1.85, proc:85, mp:15, desc:'初期職では最大級の威力。出にくい' },
  { name:'アイスランス',   cls:'魔法使い', kind:'mag', mult:1.3, proc:85, mp:12, buff:{ enemy:{ agi:-20 } }, desc:'相手のAGI-20%（重ねがけ可）' },
  { name:'精神統一',       cls:'魔法使い', kind:'buff', proc:100, mp:8, buff:{ self:{ int_stat:30 } }, desc:'INT+30%（重ねがけ可）' },

  // ===== 僧侶（回復・支援） =====
  { name:'ライト',       cls:'僧侶', kind:'mag', mult:1.5, proc:95, mp:6,  desc:'光の魔法' },
  { name:'ライトニング', cls:'僧侶', kind:'mag', mult:1.8, proc:85, mp:13, desc:'僧侶の攻撃手段の要' },
  { name:'ヒール',       cls:'僧侶', kind:'heal', proc:85, mp:12, heal:{ rate:1.4 }, priority:1, desc:'INT×1.4を回復' },
  { name:'祈祷',         cls:'僧侶', kind:'heal', proc:85, mp:15, regen:{ rate:0.5, turns:4 }, priority:1, desc:'4ターン毎ターンINT×0.5を回復' },
  { name:'プロテク',     cls:'僧侶', kind:'buff', proc:100, mp:10, buff:{ self:{ vit:25, int_stat:25 } }, priority:1, desc:'VIT・INT+25%（重ねがけ可）' },

  // ===== 格闘家（手数） =====
  { name:'打撃',   cls:'格闘家', kind:'phys', mult:1.4, proc:95, mp:4,  desc:'軽い打撃' },
  { name:'鉄拳',   cls:'格闘家', kind:'phys', mult:1.65, proc:85, mp:12, desc:'渾身の一撃' },
  { name:'連打',   cls:'格闘家', kind:'phys', mult:0.54, hits:3, proc:85, mp:10, noCrit:true, desc:'3連撃。1発ずつ命中判定。クリティカルしない' },
  { name:'爆裂拳', cls:'格闘家', kind:'phys', mult:0.42, hits:4, proc:85, mp:16, noCrit:true, desc:'4連撃。出にくいが手数で押す。クリティカルしない' },
  { name:'残心',   cls:'格闘家', kind:'buff', proc:100, mp:8, buff:{ self:{ dex:20, agi:20 } }, desc:'DEX・AGI+20%（重ねがけ可）' },

  // ===== サモナー（魔法・補助） =====
  { name:'オオカミ召喚',   cls:'サモナー', kind:'mag', mult:1.5, proc:90, mp:8,  desc:'狼を呼んで噛みつかせる' },
  { name:'小悪魔召喚',     cls:'サモナー', kind:'mag', mult:1.8, proc:85, mp:11, desc:'小悪魔を呼ぶ' },
  { name:'グリフォン召喚', cls:'サモナー', kind:'mag', mult:1.4, proc:85, mp:13, buff:{ self:{ agi:20 } }, desc:'AGI+20%（重ねがけ可）' },
  { name:'群れの号令',     cls:'サモナー', kind:'mag', mult:0.63, hits:3, proc:85, mp:14, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'魔力供給',       cls:'サモナー', kind:'heal', proc:85, mp:0, mpRegen:{ rate:0.3, turns:4 }, desc:'4ターン毎ターンINT×0.3のMPを回復。消費MPなし' },
]

export const SKILL_BY_NAME = Object.fromEntries(SKILLS.map(s => [s.name, s]))
export const skillsOf = (cls) => SKILLS.filter(s => s.cls === cls)
export const SKILL_CLASSES = [...new Set(SKILLS.map(s => s.cls))]

// ===== 習得中と習得済み =====
// あるけみすとのスキルは2段構え：
//   ・習得中   … LVアップ時に、いまの職業のスキルを確率で覚える。**転職すると失われる**
//   ・習得済み … 転職のとき、いまの職業の「習得中のスキル」から1つを永久に残せる。
//               全部習得済み／習得中が無いときは何も残らない
// 使えるスキル ＝ 習得中（その周回だけ）∪ 習得済み（ずっと）
//   → 周回するほど習得済みが増え、どの職業でもいろんなスキルを使えるようになる
export const SKILL_SET_SLOTS = 5   // 編成できる枠数
export const SKILL_USE_MAX   = 99  // 1枠あたりの使用回数の上限

// LVアップでの習得。基礎確率で抽選しつつ、LEARN_BY_LV までに全部そろうよう保証する
export const LEARN_BY_LV  = 50  // このLVまでに、その職業のスキルを全部習得できる
export const LEARN_PCT    = 15  // 1LVアップあたりの基礎習得率(%)

// そのLVで「確定で覚えなければならない数」。残りLV数が足りなくなったぶんだけ増える
export const forcedLearnCount = (lv, unlearned) =>
  Math.max(0, unlearned - Math.max(0, LEARN_BY_LV - lv))

// LVアップ1回で覚える数（確定ぶん＋基礎確率の抽選1回）。lv は上がったあとのLV
export const rollLearnCount = (lv, unlearned, rng = Math.random) => {
  if (unlearned <= 0) return 0
  const must = Math.min(unlearned, forcedLearnCount(lv, unlearned))
  const extra = (unlearned - must > 0 && rng() * 100 < LEARN_PCT) ? 1 : 0
  return Math.min(unlearned, must + extra)
}

export const usableSkillNames = (learning = [], learned = []) => [...new Set([...learning, ...learned])]
export const usableSkills = (learning = [], learned = []) => {
  const set = new Set(usableSkillNames(learning, learned))
  return SKILLS.filter(s => set.has(s.name))
}
// まだ覚えていない、いまの職業のスキル（一覧にグレーで出す用）
export const unlearnedSkills = (cls, learning = [], learned = []) => {
  const set = new Set(usableSkillNames(learning, learned))
  return skillsOf(cls).filter(s => !set.has(s.name))
}
// 転職で「習得済み」にできる候補＝いまの職業の「習得中だがまだ習得済みでない」スキル
export const keepableSkillNames = (cls, learning = [], learned = []) => {
  const has = new Set(learning)
  const done = new Set(learned)
  return skillsOf(cls).filter(s => has.has(s.name) && !done.has(s.name)).map(s => s.name)
}

// 想定利用MP＝編成を全部撃ち切ったときの消費MP合計（あるけみすとの表示と同じ考え方）。
// ★使用回数の上限はこれで決まる。最大MPを超える編成は保存できない
//   ＝MPを伸ばすほど強い技を多く積める＝MPがちゃんとステータスとして効く
export const setMpCost = (set) => (set || [])
  .reduce((t, e) => t + (SKILL_BY_NAME[e?.name]?.mp || 0) * (e?.uses || 0), 0)

// 編成の検証。問題があれば日本語のエラー文、無ければ null（サーバーの v2_set_skills と同じ規則）
export const validateSkillSet = (set, usableNames, maxMp = Infinity) => {
  if (!Array.isArray(set)) return '編成の形式が不正です'
  if (set.length > SKILL_SET_SLOTS) return `枠は${SKILL_SET_SLOTS}個までです`
  const usable = new Set(usableNames)
  const seen = new Set()
  for (const e of set) {
    if (!e?.name) return '枠にスキルが入っていません'
    if (!usable.has(e.name)) return `${e.name}はまだ使えません`
    if (seen.has(e.name)) return `${e.name}が重複しています`
    seen.add(e.name)
    const uses = Number(e.uses)
    if (!Number.isInteger(uses) || uses < 1 || uses > SKILL_USE_MAX) return `${e.name}の使用回数は1〜${SKILL_USE_MAX}です`
  }
  const cost = setMpCost(set)
  if (cost > maxMp) return `想定利用MPが最大MPを超えています（${cost} / ${maxMp}）`
  return null
}

// ===== 一覧の絞り込み・並べ替え（スキルが増えても探せるように） =====
export const KIND_TABS = [
  { key:'all',  label:'すべて' },
  { key:'phys', label:'物理' },
  { key:'mag',  label:'魔法' },
  { key:'buff', label:'補助' },
  { key:'heal', label:'回復' },
  { key:'fav',  label:'お気に入り' },
]
export const SORT_KEYS = ['name', 'mp', 'proc', 'cls']
export const filterSkills = (list, { tab = 'all', query = '', favorites = [] } = {}) => {
  const q = (query || '').trim()
  const fav = new Set(favorites)
  return list.filter(s => {
    if (tab === 'fav') { if (!fav.has(s.name)) return false }
    else if (tab !== 'all' && s.kind !== tab) return false
    if (q && !s.name.includes(q) && !s.cls.includes(q) && !(s.desc || '').includes(q)) return false
    return true
  })
}
export const sortSkills = (list, key = 'name', asc = true) => {
  const dir = asc ? 1 : -1
  return [...list].sort((a, b) => {
    if (key === 'mp' || key === 'proc') return (a[key] - b[key]) * dir || a.name.localeCompare(b.name, 'ja')
    if (key === 'cls') return a.cls.localeCompare(b.cls, 'ja') * dir || a.name.localeCompare(b.name, 'ja')
    return a.name.localeCompare(b.name, 'ja') * dir
  })
}

// 保存された編成（[{name, uses}]）を戦闘用の slots に変換する。知らない名前は捨てる
export const buildSlots = (set) => (set || [])
  .map(e => ({ skill: SKILL_BY_NAME[e.name], uses: e.uses }))
  .filter(s => s.skill)

// 表示用の効果テキスト（威力の出どころが一目で分かるように）
export const powerText = (s) => {
  if (s.kind === 'heal') {
    if (s.mpRegen) return `毎ターン MP INT×${s.mpRegen.rate}×${s.mpRegen.turns}T`
    if (s.regen)   return `毎ターン INT×${s.regen.rate}×${s.regen.turns}T`
    return `INT×${s.heal?.rate || 0}`
  }
  if (s.kind === 'buff') return s.desc
  const main = `${s.kind === 'mag' ? 'INT' : 'STR'}×${s.mult}`
  const sub = (s.add || []).map(a => ` ＋ ${a.stat === 'int_stat' ? 'INT' : a.stat.toUpperCase()}×${a.rate}`).join('')
  const hits = s.hits > 1 ? ` ×${s.hits}回` : ''
  return `${main}${sub}${hits}`
}

// 1ターンぶんの期待ダメージ（発動率と多段を込みにした概算。バランス確認用）
// 命中・クリティカルは含めない＝素の期待値
export const expectedDamage = (skill, attacker, defender, damageOf) => {
  if (!skill || (skill.kind !== 'phys' && skill.kind !== 'mag')) return 0
  const per = damageOf({
    attacker, defender, mult: skill.mult, kind: skill.kind,
    defPen: skill.defPen || 0, add: skill.add || null,
  })
  return Math.round(per * (skill.hits || 1) * (skill.proc / 100))
}

// 1回使ったときの期待回復量（持続系は全ターンの合計）。healOf は combat.js のもの
export const expectedHeal = (skill, actor, healOf) => {
  if (!skill || skill.kind !== 'heal') return 0
  const p = skill.proc / 100
  if (skill.mpRegen) return Math.round(healOf(actor, skill.mpRegen.rate) * skill.mpRegen.turns * p)
  if (skill.regen)   return Math.round(healOf(actor, skill.regen.rate) * skill.regen.turns * p)
  return Math.round(healOf(actor, skill.heal?.rate || 0) * p)
}
