// ============================================================
// バトルフロンティアⅡ（リメイク版）— 武器の進化：戦い方の軸と能力の名簿
// ------------------------------------------------------------
// ★**戦闘ログを細かく数え、そこから出た「戦い方の偏り」で能力が決まる**（2026-08-20 ユーザー指示）。
//   軸は26本、能力は159個。同じ「クリティカルが多い人」でも、そこから何が付くかは
//   もう1つの偏り（瀕死で勝ちがち／物理主体／被弾が多い…）で変わる。
//
// ★能力は「得1〜2個＋代償0〜1個」でできている（部品は evolveAtoms.js）。
//   代償を背負うものほど得の倍率(w)が大きい＝**噛み合う人にだけ強い**形にして、
//   数を増やしてもバランスが壊れないようにしてある。
//
// 付く値 ＝ 段階の上限(6/10/15%) × 偏りの強さ(0〜1) × 部品ごとの倍率(w)
//   ・無条件のもの（与ダメージ+%）は w が小さい（0.5〜0.8）
//   ・条件が狭いもの（HP30%以下・格上相手・かわした直後）は w が大きい（2.0〜3.6）
//   ・1回ごとの回復のように毎ターン積み上がるものは w を極端に小さくする（0.09〜0.3）
//
// ⚠**「その軸が立つ人にとってはほぼ無条件になる」条件に高い倍率を付けない**
//   （2026-08-20 2000戦×4型のシミュレーションで判明）。速攻型は3手で決着する＝
//   「最初の3回の行動」はほぼ常時／物理型は物理しか撃たない／長期戦型は6手目以降が本番。
//   この手の条件は 0.6〜2.1 に抑えてある。
//
// ⚠ w を触るとサーバー側の検証値も変わる。SQLの v2_evolve_traits は
//   このファイルから生成した種を流し込んでいるので、**必ず全文を流し直すこと**。
//   ズレたら落ちるテストが v2sql.test.js にある。
// ============================================================

// ===== 戦い方の軸 =====
// score … 戦績から出す生の比率 ／ norm … この値で1.0（振り切り）になる
// min   … この数だけ戦っていないと軸そのものが立たない（まぐれで決めない）
const A = (key, label, min, norm, score) => ({ key, label, min, norm, score })

export const AXES = [
  A('crit',     'クリティカルを取り続けてきた', (r) => r.hits >= 50,   0.25, (r) => r.crit / r.hits),
  A('eva',      '攻撃をかわし続けてきた',       (r) => r.taken >= 50,  0.30, (r) => r.dodged / r.taken),
  A('tank',     '殴られながら前に出てきた',     (r) => r.battles >= 30, 0.70, (r) => r.hurtPct / r.battles),
  A('ail',      '状態異常を撒いてきた',         (r) => r.hits >= 50,   0.20, (r) => r.ail / r.hits),
  A('ailed',    '状態異常を浴び続けてきた',     (r) => r.battles >= 30, 0.80, (r) => r.ailed / r.battles),
  A('heal',     '傷を癒しながら戦ってきた',     (r) => r.battles >= 30, 2.00, (r) => r.heals / r.battles),
  A('buff',     '構えを整えてから戦ってきた',   (r) => r.battles >= 30, 2.00, (r) => r.buffs / r.battles),
  A('mpBurn',   '魔力を絞り切ってきた',         (r) => r.battles >= 30, 0.50, (r) => r.mpEmpty / r.battles),
  A('thrift',   '素の一撃で戦ってきた',         (r) => r.hits >= 50,   0.50, (r) => r.normalHits / r.hits),
  A('phys',     '物理で押してきた',             (r) => r.hits >= 50,   0.90, (r) => r.physHits / r.hits),
  A('mag',      '魔法で押してきた',             (r) => r.hits >= 50,   0.90, (r) => r.magHits / r.hits),
  A('multi',    '手数で押してきた',             (r) => r.hits >= 50,   0.50, (r) => r.multiHits / r.hits),
  A('swift',    '短期決着で勝ってきた',         (r) => r.wins >= 20,   0.60, (r) => r.fastWin / r.wins),
  A('long',     '長い戦いを制してきた',         (r) => r.wins >= 20,   0.40, (r) => r.longWin / r.wins),
  A('lowHp',    'ぎりぎりで勝ってきた',         (r) => r.wins >= 20,   0.30, (r) => r.lowWin / r.wins),
  A('giant',    '格上に挑み続けてきた',         (r) => r.wins >= 20,   0.40, (r) => r.bigWin / r.wins),
  A('slayer',   '同じ相手を狩り続けてきた',     (r) => r.wins >= 20,   0.50, (r) => topFoe(r) / r.wins),
  A('boss',     'ボスを討ち続けてきた',         (r) => r.wins >= 20,   0.25, (r) => r.bossWin / r.wins),
  A('drain',    '奪いながら戦ってきた',         (r) => r.hits >= 50,   0.35, (r) => r.drains / r.hits),
  A('misfire',  '重い技を握り続けてきた',       (r) => r.battles >= 30, 2.00, (r) => r.misfires / r.battles),
  A('extra',    '相手より多く動いてきた',       (r) => r.battles >= 30, 2.00, (r) => r.extras / r.battles),
  A('first',    '先手を取り続けてきた',         (r) => r.battles >= 30, 0.75, (r) => r.firsts / r.battles),
  A('overkill', '過剰な力で叩き潰してきた',     (r) => r.wins >= 20,   0.35, (r) => r.overkill / r.wins),
  A('perfect',  '傷ひとつ負わず勝ってきた',     (r) => r.wins >= 20,   0.25, (r) => r.perfect / r.wins),
  A('comeback', '崖っぷちから巻き返してきた',   (r) => r.wins >= 20,   0.25, (r) => r.comeback / r.wins),
  A('tick',     'じわじわと削り殺してきた',     (r) => r.battles >= 30, 2.00, (r) => r.ailTicks / r.battles),
]
export const AXIS_BY_KEY = Object.fromEntries(AXES.map(a => [a.key, a]))

export const topFoe = (r) => {
  const vals = Object.values(r?.foes || {})
  return vals.length ? Math.max(...vals) : 0
}

// 軸の強さ（0〜1）。最低戦闘数に届いていなければ0
export const axisScore = (rec, axis) => {
  if (!rec || !axis?.min(rec)) return 0
  const raw = axis.score(rec)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.max(0, Math.min(1, raw / axis.norm))
}

// ===== 能力の名簿 =====
// T(キー, 軸, 名前, 得[[部品, 倍率]...], 代償[[部品, 倍率]...])
const T = (key, axis, name, gain, cost = []) => ({ key, axis, name, gain, cost })

export const TRAITS = [
  // ---- クリティカルを取り続けてきた ----
  T('crit_eye',      'crit', '見切りの冴え',   [['critRate', 0.9]]),
  T('crit_blood',    'crit', '紅蓮の一閃',     [['critDmg', 3.0]],                    [['critHpCost', 0.18]]),
  T('crit_fang',     'crit', '吸血の牙',       [['critHpHeal', 0.22], ['critDmg', 1.2]]),
  T('crit_mana',     'crit', '魔喰らいの刃',   [['critMpHeal', 0.45], ['critRate', 0.4]], [['mpCost', 0.7]]),
  T('crit_gash',     'crit', '裂傷の太刀',     [['critAil', 2.6], ['ailDmg', 1.2]]),
  T('crit_focus',    'crit', '一点集中',       [['critRate', 1.6]],                   [['hit', 0.9]]),
  T('crit_reckless', 'crit', '捨て身の閃き',   [['critDmg', 2.6]],                    [['taken', 0.9]]),
  T('crit_luck',     'crit', '幸運の刃',       [['st_luk', 0.8]]),
  T('crit_burn',     'crit', '魔焼きの刃',     [['critDmg', 2.2]],                    [['critMpCost', 0.5]]),

  // ---- 攻撃をかわし続けてきた ----
  T('eva_thin',    'eva', '紙一重',       [['eva', 0.8]]),
  T('eva_wind',    'eva', '風纏い',       [['eva', 0.5], ['st_agi', 0.6]]),
  T('eva_counter', 'eva', '見切り返し',   [['dmgDodge', 2.6]]),
  T('eva_breath',  'eva', '呼吸の間',     [['onDodgeHeal', 0.10], ['eva', 0.4]]),
  T('eva_accel',   'eva', '加速の舞',     [['onDodgeAgi', 0.5]]),
  T('eva_paper',   'eva', '薄紙の構え',   [['eva', 1.3]],  [['st_vit', 0.8]]),
  T('eva_last',    'eva', '際の見切り',   [['evaLow', 2.2]]),

  // ---- 殴られながら前に出てきた ----
  T('tank_iron',   'tank', '鉄壁の体',     [['cut', 0.7]]),
  T('tank_scale',  'tank', '逆鱗',         [['dmgHurt', 2.4]]),
  T('tank_rage',   'tank', '痛みの糧',     [['onHurtStr', 0.5]]),
  T('tank_mana',   'tank', '痛撃転化',     [['onHurtMp', 0.5]]),
  T('tank_guts',   'tank', '不屈',         [['guts', 2.2]]),
  T('tank_wall',   'tank', '重甲',         [['cut', 1.1]],  [['st_agi', 0.9]]),
  T('tank_endure', 'tank', '耐えの構え',   [['cutLow', 2.4]]),
  T('tank_flesh',  'tank', '肉厚',         [['st_hp', 0.9]],  [['st_agi', 0.5]]),

  // ---- 状態異常を撒いてきた ----
  T('ail_venom', 'ail', '蝕みの刃',   [['ailRate', 1.0]]),
  T('ail_rot',   'ail', '腐蝕',       [['ailDmg', 1.8]]),
  T('ail_hunt',  'ail', '病み狩り',   [['dmgAil', 2.2]]),
  T('ail_leech', 'ail', '疫の恵み',   [['ailDrain', 0.22]]),
  T('ail_plague','ail', '疫禍',       [['ailRate', 1.6]], [['heal', 0.9]]),
  T('ail_curse', 'ail', '呪詛返し',   [['ailRate', 0.7], ['ailDmg', 0.9]]),

  // ---- 状態異常を浴び続けてきた ----
  T('ailed_ward',  'ailed', '慣れた痛み',     [['ailResist', 1.2]]),
  T('ailed_will',  'ailed', '毒に慣れた体',   [['ailResist', 0.7], ['regen', 0.18]]),
  T('ailed_pain',  'ailed', '痛みを喰う',     [['dmgLow', 1.8]],  [['ailWeak', 0.8]]),
  T('ailed_sacr',  'ailed', '供物の刃',       [['dmg', 1.1]],     [['ailWeak', 1.0]]),
  T('ailed_purge', 'ailed', '浄化の呼吸',     [['heal', 1.4], ['ailResist', 0.5]]),
  T('ailed_blood', 'ailed', '毒血の巡り',     [['regen', 0.30]],  [['taken', 1.4]]),

  // ---- 傷を癒しながら戦ってきた ----
  T('heal_grace', 'heal', '癒しの手',     [['heal', 1.2]]),
  T('heal_light', 'heal', '治癒の光',     [['heal', 0.8], ['regen', 0.15]]),
  T('heal_pray',  'heal', '祈りの刃',     [['heal', 1.6]],  [['dmg', 0.5]]),
  T('heal_flow',  'heal', '生命の巡り',   [['regen', 0.30]]),
  T('heal_mend',  'heal', '手当ての心得', [['heal', 0.7], ['mpCost', 0.6]]),
  T('heal_zeal',  'heal', '献身',         [['heal', 1.0], ['st_int_stat', 0.5]], [['st_str', 0.8]]),

  // ---- 構えを整えてから戦ってきた ----
  T('buff_rite',  'buff', '高揚の儀',   [['proc', 0.7]]),
  T('buff_echo',  'buff', '重ねがけ',   [['dmgCombo', 0.35]]),
  T('buff_focus', 'buff', '集中の型',   [['st_str', 0.5], ['st_int_stat', 0.5]], [['st_vit', 0.8]]),
  T('buff_swift', 'buff', '疾走の型',   [['extra', 0.7]]),
  T('buff_rise',  'buff', '高まる刃',   [['dmgLate', 1.4]]),
  T('buff_ready', 'buff', '支度の妙',   [['mpCost', 0.8]]),

  // ---- 魔力を絞り切ってきた ----
  T('mp_font',   'mpBurn', '魔力の泉',     [['mpRegen', 0.5]]),
  T('mp_thrift', 'mpBurn', '節制',         [['mpCost', 1.0]]),
  T('mp_burst',  'mpBurn', '燃焼',         [['dmgSkill', 1.2]], [['mpCost', 0.8]]),
  T('mp_drain',  'mpBurn', '魔喰い',       [['onHitMp', 0.12]]),
  T('mp_last',   'mpBurn', '最後の一滴',   [['dmgLate', 1.5], ['mpRegen', 0.25]]),
  T('mp_over',   'mpBurn', '過負荷',       [['dmg', 1.2]],      [['st_mp', 1.2]]),

  // ---- 素の一撃で戦ってきた ----
  T('th_basic',  'thrift', '素振りの積み', [['dmgNormal', 1.8]]),
  T('th_flow',   'thrift', '淀みなき手',   [['dmgNormal', 1.2], ['hit', 0.5]]),
  T('th_sharp',  'thrift', '研ぎ澄まし',   [['dmgNormal', 2.4]], [['dmgSkill', 0.8]]),
  T('th_quick',  'thrift', '手数の妙',     [['extra', 0.6], ['dmgNormal', 0.8]]),
  T('th_read',   'thrift', '見切りの手',   [['critRate', 0.6], ['dmgNormal', 1.0]]),
  T('th_stance', 'thrift', '自然体',       [['cut', 0.5], ['dmgNormal', 1.0]]),
  T('th_hand',   'thrift', '手癖',         [['st_dex', 0.8]]),

  // ---- 物理で押してきた ----
  T('ph_edge',   'phys', '鋭刃',       [['dmgPhys', 1]]),
  T('ph_might',  'phys', '剛力',       [['st_str', 0.8]]),
  T('ph_pierce', 'phys', '貫き手',     [['defPen', 1.2]]),
  T('ph_heavy',  'phys', '重い一撃',   [['dmgPhys', 1.5]], [['dmgMag', 1.2]]),
  T('ph_grind',  'phys', '削りの型',   [['dmgPhys', 0.6], ['cutPhys', 0.8]]),
  T('ph_blood',  'phys', '血振り',     [['drain', 0.45]]),

  // ---- 魔法で押してきた ----
  T('mg_flow',  'mag', '魔導の理',     [['dmgMag', 1]]),
  T('mg_mind',  'mag', '深智',         [['st_int_stat', 0.8]]),
  T('mg_break', 'mag', '術式貫通',     [['defPen', 1.2]]),
  T('mg_burst', 'mag', '増幅術式',     [['dmgMag', 1.5]], [['dmgPhys', 1.2]]),
  T('mg_ward',  'mag', '魔よけ',       [['dmgMag', 0.6], ['cutMag', 0.8]]),
  T('mg_font',  'mag', '詠唱の巡り',   [['mpRegen', 0.4], ['dmgMag', 0.6]]),

  // ---- 手数で押してきた ----
  T('mu_storm',  'multi', '乱れ撃ち',   [['dmgMulti', 1.8]]),
  T('mu_rhythm', 'multi', '刻みの型',   [['dmgMulti', 1.1], ['hit', 0.5]]),
  T('mu_bleed',  'multi', '千の裂傷',   [['critAil', 2.0], ['dmgMulti', 0.9]]),
  T('mu_leech',  'multi', '削り取り',   [['onHitHeal', 0.09]]),
  T('mu_mana',   'multi', '連撃の余韻', [['onHitMp', 0.10]]),
  T('mu_press',  'multi', '手数の圧',   [['dmgMulti', 2.4]], [['hit', 0.8]]),

  // ---- 短期決着で勝ってきた ----
  T('sw_blitz',  'swift', '疾き刃',     [['dmgFirst', 1.5]]),
  T('sw_first',  'swift', '先の先',     [['first', 1.6]]),
  T('sw_rush',   'swift', '突撃',       [['dmgFirst', 2]], [['taken', 1.0]]),
  T('sw_edge',   'swift', '出足',       [['st_agi', 0.7]]),
  T('sw_open',   'swift', '初手の型',   [['dmgFull', 1.3]]),
  T('sw_finish', 'swift', '一気呵成',   [['dmgSmall', 1.3], ['extra', 0.5]]),

  // ---- 長い戦いを制してきた ----
  T('lg_grind', 'long', '持久の型',   [['dmgLate', 1.6]]),
  T('lg_stack', 'long', '積み重ね',   [['dmgCombo', 0.40]]),
  T('lg_root',  'long', '根を張る',   [['regen', 0.28]]),
  T('lg_calm',  'long', '静かな刃',   [['cut', 0.6], ['mpRegen', 0.3]]),
  T('lg_late',  'long', '遅咲き',     [['dmgLate', 2.1]], [['dmg', 0.5]]),
  T('lg_wear',  'long', '摩耗誘い',   [['ailDmg', 1.4], ['ailRate', 0.6]]),

  // ---- ぎりぎりで勝ってきた ----
  T('lw_ice',   'lowHp', '薄氷の勝者',     [['dmgLow', 2.4]]),
  T('lw_guts',  'lowHp', '死中に活',       [['guts', 2.4]]),
  T('lw_last',  'lowHp', '背水',           [['dmgLow', 3.4]], [['taken', 1.0]]),
  T('lw_veil',  'lowHp', '窮鼠の見切り',   [['evaLow', 2.0]]),
  T('lw_hard',  'lowHp', '火事場の硬さ',   [['cutLow', 2.2]]),
  T('lw_leech', 'lowHp', '命の削り合い',   [['drain', 0.40], ['dmgLow', 1.2]]),

  // ---- 格上に挑み続けてきた ----
  T('gi_slay',   'giant', '巨人殺し',       [['dmgBig', 2.6]]),
  T('gi_pierce', 'giant', '大物貫き',       [['defPen', 1.0], ['dmgBig', 1.0]]),
  T('gi_brave',  'giant', '蛮勇',           [['dmgBig', 3.6]], [['taken', 1.1]]),
  T('gi_read',   'giant', '力量差の見切り', [['evaLow', 1.4], ['dmgBig', 1.2]]),
  T('gi_grit',   'giant', '挑む者',         [['st_vit', 0.6], ['dmgBig', 1.4]]),
  T('gi_fell',   'giant', '討ち取り',       [['critRate', 0.6], ['dmgBig', 1.4]]),

  // ---- 同じ相手を狩り続けてきた ----
  T('sl_hunt',  'slayer', '宿敵狩り',   [['dmgFoe', 2.8]]),
  T('sl_know',  'slayer', '手の内',     [['dmgFoe', 1.6], ['hit', 0.5]]),
  T('sl_grudge','slayer', '執念',       [['dmgFoe', 3.8]], [['heal', 1.0]]),
  T('sl_habit', 'slayer', '型の記憶',   [['dmgFoe', 1.4], ['critRate', 0.5]]),
  T('sl_ward',  'slayer', '弱点看破',   [['dmgFoe', 1.6], ['defPen', 0.7]]),
  T('sl_scar',  'slayer', '積年の傷',   [['dmgFoe', 1.8], ['drain', 0.25]]),

  // ---- ボスを討ち続けてきた ----
  T('bo_slay',   'boss', '大敵斬り',       [['dmgBoss', 2.6]]),
  T('bo_long',   'boss', '長期戦の心得',   [['dmgBoss', 1.4], ['regen', 0.18]]),
  T('bo_pierce', 'boss', '巨躯貫き',       [['dmgBoss', 1.4], ['defPen', 0.8]]),
  T('bo_defy',   'boss', '王殺し',         [['dmgBoss', 3.6]], [['taken', 1.0]]),
  T('bo_focus',  'boss', '討伐の集中',     [['dmgBoss', 1.2], ['critRate', 0.5]]),
  T('bo_stand',  'boss', '踏み止まり',     [['dmgBoss', 1.2], ['cut', 0.5]]),

  // ---- 奪いながら戦ってきた ----
  T('dr_leech', 'drain', '血の恵み',       [['drain', 0.55]]),
  T('dr_hit',   'drain', '一撃ごとの糧',   [['onHitHeal', 0.11]]),
  T('dr_greed', 'drain', '貪食',           [['drain', 0.85]], [['heal', 1.0]]),
  T('dr_crit',  'drain', '牙の悦び',       [['critHpHeal', 0.25]]),
  T('dr_mana',  'drain', '生命転換',       [['onHitMp', 0.11], ['drain', 0.20]]),
  T('dr_cycle', 'drain', '循環',           [['regen', 0.20], ['drain', 0.25]]),

  // ---- 重い技を握り続けてきた ----
  T('mi_kata',  'misfire', '居合の心得',     [['misfireDmg', 3.0]]),
  T('mi_proc',  'misfire', '呼吸を合わせる', [['proc', 0.8]]),
  T('mi_wait',  'misfire', '溜めの型',       [['dmgSkill', 1.1]], [['proc', 0.6]]),
  T('mi_ready', 'misfire', '二の太刀',       [['misfireDmg', 2.0], ['dmgNormal', 1.0]]),
  T('mi_calm',  'misfire', '平常心',         [['proc', 0.5], ['mpCost', 0.5]]),
  T('mi_burst', 'misfire', '大振り',         [['dmgSkill', 1.6]], [['hit', 0.9]]),

  // ---- 相手より多く動いてきた ----
  T('ex_swift', 'extra', '疾風の足',     [['extra', 0.8]]),
  T('ex_agi',   'extra', '軽身',         [['st_agi', 0.8]]),
  T('ex_combo', 'extra', '連なる手',     [['dmgCombo', 0.40]]),
  T('ex_press', 'extra', '畳みかけ',     [['extra', 0.5], ['dmgNormal', 1.0]]),
  T('ex_reck',  'extra', '前のめり',     [['extra', 1.2]], [['eva', 0.8]]),
  T('ex_flow',  'extra', '途切れぬ手',   [['extra', 0.5], ['mpCost', 0.6]]),

  // ---- 先手を取り続けてきた ----
  T('fs_edge',  'first', '先手必勝',     [['first', 1.8]]),
  T('fs_open',  'first', '出会い頭',     [['dmgFirst', 1.4]]),
  T('fs_full',  'first', '満を持して',   [['dmgFull', 1.4]]),
  T('fs_agi',   'first', '疾さの証',     [['st_agi', 0.7], ['first', 0.8]]),
  T('fs_press', 'first', '先制の圧',     [['first', 1.0], ['dmgFirst', 0.9]]),
  T('fs_bold',  'first', '抜き打ち',     [['dmgFirst', 1.9]], [['taken', 0.9]]),

  // ---- 過剰な力で叩き潰してきた ----
  T('ov_might',  'overkill', '有り余る力',       [['dmg', 0.8]]),
  T('ov_crush',  'overkill', '打ち砕き',         [['dmgSmall', 1.5]]),
  T('ov_pierce', 'overkill', '力任せ',           [['defPen', 1.3]]),
  T('ov_burst',  'overkill', '出し惜しみなし',   [['dmgSkill', 1.2]], [['mpCost', 0.9]]),
  T('ov_wild',   'overkill', '大暴れ',           [['dmg', 1.5]],      [['taken', 1.0]]),
  T('ov_finish', 'overkill', '止めの一撃',       [['critDmg', 1.6], ['dmgSmall', 0.8]]),

  // ---- 傷ひとつ負わず勝ってきた ----
  T('pf_grace', 'perfect', '無傷の型',         [['dmgFull', 1.6]]),
  T('pf_calm',  'perfect', '静謐',             [['cut', 0.8]]),
  T('pf_eye',   'perfect', '完璧な見切り',     [['eva', 0.7], ['hit', 0.5]]),
  T('pf_high',  'perfect', '余裕',             [['dmgHigh', 1.1]]),
  T('pf_pure',  'perfect', '一分の隙もなく',   [['dmgFull', 2.1]], [['taken', 0.8]]),
  T('pf_keep',  'perfect', '崩さぬ構え',       [['cut', 0.5], ['regen', 0.18]]),

  // ---- 崖っぷちから巻き返してきた ----
  T('cb_rise',  'comeback', '巻き返し',   [['dmgLow', 2.2], ['regen', 0.15]]),
  T('cb_guts',  'comeback', '諦めの悪さ', [['guts', 2.6]]),
  T('cb_turn',  'comeback', '形勢逆転',   [['dmgHurt', 2.6]]),
  T('cb_bear',  'comeback', '耐え忍び',   [['cutLow', 2.0], ['heal', 0.6]]),
  T('cb_heart', 'comeback', '折れぬ心',   [['st_vit', 0.7], ['dmgLow', 1.2]]),
  T('cb_spite', 'comeback', '意地',       [['dmgLow', 3.2]], [['eva', 0.9]]),

  // ---- じわじわと削り殺してきた ----
  T('tk_rot',     'tick', '蝕みを深く',   [['ailDmg', 2.0]]),
  T('tk_spread',  'tick', '病巣拡大',     [['ailRate', 0.8], ['ailDmg', 0.9]]),
  T('tk_feed',    'tick', '病の恵み',     [['ailDrain', 0.25]]),
  T('tk_hunt',    'tick', '弱りを突く',   [['dmgAil', 2.0]]),
  T('tk_gash',    'tick', '傷口を開く',   [['critAil', 2.4]]),
  T('tk_patient', 'tick', '待ちの構え',   [['cut', 0.5], ['ailDmg', 1.2]]),
]

export const TRAIT_BY_KEY = Object.fromEntries(TRAITS.map(t => [t.key, t]))
export const TRAITS_OF_AXIS = (axis) => TRAITS.filter(t => t.axis === axis)

// 「特定の相手」を必要とする能力（宿敵狩りの系統）。相手の名前が決まらないと付けられない
export const needsFoe = (trait) =>
  [...(trait?.gain || []), ...(trait?.cost || [])].some(([a]) => a === 'dmgFoe')
