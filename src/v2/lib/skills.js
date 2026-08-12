// ============================================================
// バトルフロンティアⅡ（リメイク版）— スキル
// ------------------------------------------------------------
// ・名前は旧版（無印）から流用。倍率・発動率・消費MPはv2で新規に決めた
// ・参照するステータスはv2の8種（物理=STR / 魔法=INT、副参照でAGI・VIT等）
// ・スキルは毎ターン「発動率」で抽選する（あるけみすと式。強い技ほど出にくい）
// ・倍率はあるけみすとを基準にしつつ、初期職は少し低めに置いた
//     あるけみすと：通常 2.0〜2.6倍 ／ 大技 4.0倍前後 ／ 発動率 60〜95%
//     v2の初期職  ：通常 1.0〜1.4倍 ／ 主力 1.6〜2.0倍 ／ 発動率 75〜100%
//   → 上位職に伸びしろを残すため。ノーブルはさらに一段低い
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
// buff   : { self:{ステ:%}, enemy:{ステ:%}, turns }
// heal   : { rate }                  …即時HP回復（INT×rate）
// regen  : { rate, turns }           …毎ターンHP回復（INT×rate）
// mpRegen: { rate, turns }           …毎ターンMP回復（INT×rate）
// ※回復は最大HP/MPの％ではなく INT を参照する（あるけみすと準拠。神聖なる手＝INT×1.5）。
//   最大HPを積むほど回復量まで伸びる歪みを作らないため。初期職はあるけみすとより低め
export const SKILLS = [
  // ===== ノーブル（開始時の職業。一段低い） =====
  { name:'はたく',     cls:'ノーブル', kind:'phys', mult:1.1, proc:95, mp:0,  desc:'素手で殴る。消費MPなし' },
  { name:'狙い撃ち',   cls:'ノーブル', kind:'phys', mult:1.0, proc:90, mp:5,  sureHit:true, desc:'必ず当たる一撃' },
  { name:'応急手当',   cls:'ノーブル', kind:'heal', proc:80, mp:8,  heal:{ rate:1.0 }, desc:'INT×1.0を回復' },
  { name:'身構える',   cls:'ノーブル', kind:'buff', proc:100, mp:6, buff:{ self:{ vit:20 }, turns:3 }, desc:'3ターンVIT+20%' },
  { name:'気合い',     cls:'ノーブル', kind:'buff', proc:90, mp:8,  buff:{ self:{ str:15 }, turns:3 }, desc:'3ターンSTR+15%' },

  // ===== 戦士（物理・耐久） =====
  { name:'体当たり',       cls:'戦士', kind:'phys', mult:1.4, proc:95, mp:5,  desc:'素直な体当たり' },
  { name:'強撃',           cls:'戦士', kind:'phys', mult:1.9, proc:85, mp:12, desc:'力を込めた一撃' },
  { name:'防御崩し',       cls:'戦士', kind:'phys', mult:1.2, proc:90, mp:10, buff:{ enemy:{ vit:-15 }, turns:3 }, desc:'3ターン相手のVIT-15%' },
  { name:'防御態勢',       cls:'戦士', kind:'buff', proc:100, mp:8, buff:{ self:{ vit:30 }, turns:3 }, desc:'3ターンVIT+30%' },
  { name:'シールドアタック', cls:'戦士', kind:'phys', mult:1.0, add:[{ stat:'vit', rate:0.5 }], proc:90, mp:10, desc:'盾で殴る。VITも威力になる' },

  // ===== 弓使い（命中・素早さ） =====
  { name:'狙撃',     cls:'弓使い', kind:'phys', mult:1.0, add:[{ stat:'agi', rate:0.6 }], proc:90, mp:8, sureHit:true, desc:'必中。AGIも威力になる' },
  { name:'剛射',     cls:'弓使い', kind:'phys', mult:1.8, proc:85, mp:11, desc:'強く引き絞って射る' },
  { name:'貫通射撃', cls:'弓使い', kind:'phys', mult:1.5, defPen:0.3, proc:85, mp:12, desc:'相手の防御を30%無視' },
  { name:'疾風矢',   cls:'弓使い', kind:'phys', mult:1.1, add:[{ stat:'agi', rate:0.5 }], proc:90, mp:8, desc:'速射。AGIも威力になる' },
  { name:'駆け足',   cls:'弓使い', kind:'buff', proc:100, mp:6, buff:{ self:{ agi:30 }, turns:3 }, desc:'3ターンAGI+30%' },

  // ===== 魔法使い（火力特化） =====
  { name:'マジックアロー', cls:'魔法使い', kind:'mag', mult:1.2, proc:95, mp:5,  desc:'消費が軽い基本の魔法' },
  { name:'ファイア',       cls:'魔法使い', kind:'mag', mult:1.7, proc:90, mp:11, desc:'火の魔法' },
  { name:'サンダー',       cls:'魔法使い', kind:'mag', mult:2.0, proc:80, mp:15, desc:'初期職では最大級の威力。出にくい' },
  { name:'アイスランス',   cls:'魔法使い', kind:'mag', mult:1.4, proc:85, mp:12, buff:{ enemy:{ agi:-20 }, turns:3 }, desc:'3ターン相手のAGI-20%' },
  { name:'精神統一',       cls:'魔法使い', kind:'buff', proc:100, mp:8, buff:{ self:{ int_stat:30 }, turns:3 }, desc:'3ターンINT+30%' },

  // ===== 僧侶（回復・支援） =====
  { name:'ライト',       cls:'僧侶', kind:'mag', mult:1.3, proc:95, mp:6,  desc:'光の魔法' },
  { name:'ライトニング', cls:'僧侶', kind:'mag', mult:1.8, proc:85, mp:13, desc:'僧侶の攻撃手段の要' },
  { name:'ヒール',       cls:'僧侶', kind:'heal', proc:80, mp:12, heal:{ rate:1.4 }, desc:'INT×1.4を回復' },
  { name:'祈祷',         cls:'僧侶', kind:'heal', proc:80, mp:15, regen:{ rate:0.5, turns:4 }, desc:'4ターン毎ターンINT×0.5を回復' },
  { name:'プロテク',     cls:'僧侶', kind:'buff', proc:100, mp:10, buff:{ self:{ vit:20, int_stat:20 }, turns:3 }, desc:'3ターンVIT・INT+20%' },

  // ===== 格闘家（手数） =====
  { name:'打撃',   cls:'格闘家', kind:'phys', mult:1.3, proc:95, mp:4,  desc:'軽い打撃' },
  { name:'鉄拳',   cls:'格闘家', kind:'phys', mult:1.9, proc:85, mp:12, desc:'渾身の一撃' },
  { name:'連打',   cls:'格闘家', kind:'phys', mult:0.55, hits:3, proc:90, mp:10, desc:'3連撃。1発ずつ命中判定' },
  { name:'爆裂拳', cls:'格闘家', kind:'phys', mult:0.55, hits:4, proc:75, mp:16, desc:'4連撃。出にくいが手数で押す' },
  { name:'残心',   cls:'格闘家', kind:'buff', proc:100, mp:8, buff:{ self:{ dex:20, agi:20 }, turns:3 }, desc:'3ターンDEX・AGI+20%' },

  // ===== サモナー（魔法・補助） =====
  { name:'オオカミ召喚',   cls:'サモナー', kind:'mag', mult:1.3, proc:90, mp:8,  desc:'狼を呼んで噛みつかせる' },
  { name:'小悪魔召喚',     cls:'サモナー', kind:'mag', mult:1.7, proc:90, mp:11, desc:'小悪魔を呼ぶ' },
  { name:'グリフォン召喚', cls:'サモナー', kind:'mag', mult:1.4, proc:85, mp:13, buff:{ self:{ agi:20 }, turns:2 }, desc:'2ターンAGI+20%' },
  { name:'群れの号令',     cls:'サモナー', kind:'mag', mult:0.5, hits:3, proc:85, mp:14, desc:'3連撃' },
  { name:'魔力供給',       cls:'サモナー', kind:'heal', proc:80, mp:0, mpRegen:{ rate:0.3, turns:4 }, desc:'4ターン毎ターンINT×0.3のMPを回復。消費MPなし' },
]

export const SKILL_BY_NAME = Object.fromEntries(SKILLS.map(s => [s.name, s]))
export const skillsOf = (cls) => SKILLS.filter(s => s.cls === cls)
export const SKILL_CLASSES = [...new Set(SKILLS.map(s => s.cls))]

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
