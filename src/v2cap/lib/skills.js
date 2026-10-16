// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— スキルの名簿
// ------------------------------------------------------------
// 2026-10-09 ユーザー決定（docs/v2cap-design.md §11）：初期職は11職（剣士を同じ日に足した）。
//   ・戦士・弓使い・魔法使い・僧侶・格闘家 … 今のⅡのスキルをそのまま使う（中身は src/v2/lib/skills.js）
//   ・槍使い・盗賊・銃士・剣士・呪術師・薬師 … 新しく作った5個ずつ（下の NEW_SKILLS・ユーザー承認済み）
//   ・ノーブル・サモナーと上位職は**一旦なし**（上位職は 2026-10-10 に skillsIchiji.js で足した）
//   ・2026-10-14：11職とも CLASS LV25・30 で1つずつ足した（下の LATE_SKILLS＝技7つから5枠を選ぶ）
// 新しい技は今のⅡの値段の付け方（発動率ごとの価値 skillValue・消費MPの帯）で初期職の帯に合わせてある。
//
// 【確定】スキルは**その職業でだけ使える**（2026-10-09 ユーザー決定・今のⅡの「他職は0.8倍・MP2倍」はやめた）。
//   代わりに**上位職は下位職のスキルをそのまま使える**（効果も消費MPも同じ）。下位職のたどり方は jobs.js の lineageOf。
//   スキルセットも**職業ごと**に持つ（転職して戻ると前の編成に戻る）。
//
// ★戦闘（battle.js）はスキルの中身を受け取って動くので、名簿をこの版で持てば足りる。
// ★サーバーの v2cap_skills はこの名簿から tools/v2cap-sql.mjs が作る（手で書き写さない）
// ============================================================
import { SKILLS as V2_SKILLS, isPassive, SKILL_SET_SLOTS, SKILL_USE_MAX, powerText, statLabel } from '../../v2/lib/skills.js'
import { ICHIJI_SKILLS } from './skillsIchiji.js'

export { isPassive, SKILL_SET_SLOTS, SKILL_USE_MAX }

// 今のⅡから持ってくる職業
export const KEEP_FROM_V2 = ['戦士', '弓使い', '魔法使い', '僧侶', '格闘家']

// 新しい6職（ClassLV1／5／10／15／20 で上から順に覚える）
export const NEW_SKILLS = [
  // 槍使い（物理・STR）
  { name:'突き',       cls:'槍使い', kind:'phys', mult:1.25, proc:95, mp:4,  desc:'槍で突く' },
  { name:'薙ぎ払い',   cls:'槍使い', kind:'phys', mult:1.31, proc:90, mp:8,  buff:{ enemy:{ agi:-15 } }, desc:'足元を払う。相手のAGI-15%（重ねがけ可）' },
  { name:'投げ槍',     cls:'槍使い', kind:'phys', mult:1.0, add:[{ stat:'dex', rate:0.3 }], proc:88, mp:9, sureHit:true, desc:'必中' },
  { name:'三段突き',   cls:'槍使い', kind:'phys', mult:0.52, hits:3, proc:85, mp:11, noCrit:true, desc:'3連撃。1発ずつ命中判定。クリティカルしない' },
  // 【確定】2026-10-14 ユーザー承認：槍衾を STR+15%・VIT+12% → STR+12%・AGI+15%（合計27%のまま・槍使いのHP・配分の直しと一緒）
  { name:'槍衾',       cls:'槍使い', kind:'buff', proc:100, mp:8, buff:{ self:{ str:12, agi:15 } }, priority:1, desc:'STR+12%・AGI+15%（重ねがけ可）' },
  // 盗賊（物理・AGIも威力に乗る）
  { name:'切りつけ',   cls:'盗賊', kind:'phys', mult:0.85, add:[{ stat:'agi', rate:0.4 }], proc:95, mp:4, desc:'素早く切る' },
  { name:'早業',       cls:'盗賊', kind:'phys', mult:0.4, add:[{ stat:'agi', rate:0.3 }], hits:2, proc:90, mp:8, noCrit:true, desc:'2連撃。クリティカルしない' },
  { name:'毒塗りの刃', cls:'盗賊', kind:'phys', mult:0.85, add:[{ stat:'agi', rate:0.4 }], proc:88, mp:9, ail:{ key:'poison', chance:40 }, desc:'40%で毒' },
  { name:'目つぶし',   cls:'盗賊', kind:'phys', mult:0.95, add:[{ stat:'agi', rate:0.4 }], proc:85, mp:11, ail:{ key:'blind', chance:40 }, desc:'40%で暗闇（命中-25%）' },
  { name:'影走り',     cls:'盗賊', kind:'buff', proc:100, mp:8, buff:{ self:{ agi:15, dex:12 } }, priority:1, desc:'AGI+15%・DEX+12%（重ねがけ可）' },
  // 銃士（物理・DEXが大きく威力に乗る）
  { name:'早撃ち',     cls:'銃士', kind:'phys', mult:0.65, add:[{ stat:'dex', rate:0.6 }], proc:95, mp:4, desc:'すばやく撃つ' },
  { name:'連射',       cls:'銃士', kind:'phys', mult:0.2, add:[{ stat:'dex', rate:0.27 }], hits:3, proc:90, mp:8, noCrit:true, desc:'3連射。クリティカルしない' },
  { name:'精密射撃',   cls:'銃士', kind:'phys', mult:0.6, add:[{ stat:'dex', rate:0.7 }], proc:88, mp:9, sureHit:true, desc:'必中' },
  { name:'徹甲弾',     cls:'銃士', kind:'phys', mult:0.67, add:[{ stat:'dex', rate:0.7 }], proc:85, mp:11, defPen:0.3, desc:'相手の防御を30%無視' },
  { name:'狙いを定める', cls:'銃士', kind:'buff', proc:100, mp:8, buff:{ self:{ dex:27 } }, priority:1, desc:'DEX+27%（重ねがけ可）' },
  // 剣士（物理・STRにDEXやAGIも乗る・2026-10-09 ユーザー承認）
  // 【確定】2026-10-14 ユーザー承認：威力をSTR寄りにした（価値は同じ）。副参照（DEX・AGI）はSTRより低いのに値段はSTRと同じに数えるので、
  //   副参照が多いほど実際の威力が下がっていた（剣士がボス戦で平均の約9割）。剣の構えは STR+10%・DEX+9%・AGI+8% → STR+15%・AGI+12%
  { name:'袈裟斬り',   cls:'剣士', kind:'phys', mult:1.15, add:[{ stat:'dex', rate:0.1 }], proc:95, mp:4, desc:'肩口から斬り下ろす' },
  { name:'燕返し',     cls:'剣士', kind:'phys', mult:0.65, add:[{ stat:'dex', rate:0.05 }], hits:2, proc:90, mp:8, noCrit:true, desc:'2連撃。クリティカルしない' },
  { name:'兜割り',     cls:'剣士', kind:'phys', mult:1.17, add:[{ stat:'dex', rate:0.1 }], proc:88, mp:9, defPen:0.3, desc:'相手の防御を30%無視' },
  { name:'一閃',       cls:'剣士', kind:'phys', mult:1.3, add:[{ stat:'agi', rate:0.1 }], proc:85, mp:11, ail:{ key:'bleed', chance:40 }, desc:'40%で出血' },
  { name:'剣の構え',   cls:'剣士', kind:'buff', proc:100, mp:8, buff:{ self:{ str:15, agi:12 } }, priority:1, desc:'STR+15%・AGI+12%（重ねがけ可）' },
  // 呪術師（魔法・状態異常）
  { name:'呪弾',       cls:'呪術師', kind:'mag', mult:1.45, proc:95, mp:5, desc:'呪いを込めた弾を放つ' },
  { name:'呪縛',       cls:'呪術師', kind:'mag', mult:1.44, proc:90, mp:9, ail:{ key:'slow', chance:40 }, desc:'40%で鈍足' },
  { name:'毒の呪い',   cls:'呪術師', kind:'mag', mult:1.45, proc:88, mp:10, ail:{ key:'poison', chance:50 }, desc:'50%で毒' },
  { name:'災いの呪い', cls:'呪術師', kind:'mag', mult:1.56, proc:85, mp:13, ail:{ key:'curse', chance:40 }, desc:'40%で呪い（受けるダメージ+15%）' },
  { name:'衰弱の呪詛', cls:'呪術師', kind:'buff', proc:100, mp:9, buff:{ enemy:{ str:-15, int_stat:-15 } }, priority:1, desc:'相手のSTR-15%・INT-15%（重ねがけ可）' },
  // 薬師（魔法・回復と補助）
  { name:'薬瓶投げ',   cls:'薬師', kind:'mag', mult:1.45, proc:95, mp:5, desc:'薬瓶を投げつける' },
  // 2026-10-16 回復1.2→0.8（能力表：倒れにくさ146・ボス戦108で強めだった。元は傷薬の回復）
  { name:'傷薬',       cls:'薬師', kind:'heal', proc:85, mp:12, heal:{ rate:0.8 }, desc:'傷薬でHPを戻す' },
  { name:'毒薬',       cls:'薬師', kind:'mag', mult:1.4, proc:88, mp:10, ail:{ key:'poison', chance:60 }, desc:'60%で毒' },
  // 【確定】2026-10-14 ユーザー承認：魔法職にSTRは要らないので STR+15% → VIT+12%
  { name:'強壮剤',     cls:'薬師', kind:'buff', proc:100, mp:9, buff:{ self:{ int_stat:15, vit:12 } }, priority:1, desc:'INT+15%・VIT+12%（重ねがけ可）' },
  { name:'気付け薬',   cls:'薬師', kind:'heal', proc:85, mp:8, mpRegen:{ rate:0.2, turns:4 }, desc:'しばらく毎ターンMPが戻る' },
]

// ===== 初期職11職の CLASS LV25・30 の技（各職2つ・覚える順に上から）=====
// 【確定】2026-10-14 ユーザー承認（案「初期職に技を足す」）。前は技5つ＝枠5つで、初期職のうちは「どの技を入れるか」を選べなかった
//   （CLASS LV21〜30は何も覚えなかった）。7つから5枠を選ぶ。どれも初期職の帯（価値・消費MP）どおり＝強さは同じで中身が違う。
//   中身は職業の弱点を埋めるもの（DEXが低い職業に必中・AGIを下げる、回復の無い職業に吸収、など）。
//   ★名前が重なるものは替えた：焼夷弾・火炎瓶（上位職）→炸裂弾・発火薬／峰打ち（今のⅡの侍）→霞斬り／
//     足払い（上位職の槍術士）→水面蹴り／乱れ撃ち（今のⅡの武器の進化）→五月雨撃ち
export const LATE_SKILLS = [
  { name:'霞斬り',     cls:'剣士', kind:'phys', mult:1.31, buff:{ enemy:{ dex:-15 } }, proc:90, mp:8, desc:'相手のDEX-15%（重ねがけ可）' },
  { name:'乱れ斬り',   cls:'剣士', kind:'phys', mult:0.35, add:[{ stat:'agi', rate:0.17 }], hits:3, proc:85, mp:11, noCrit:true, desc:'3連撃。クリティカルしない' },
  { name:'叩きつけ',   cls:'戦士', kind:'phys', mult:1.4, proc:85, mp:11, sureHit:true, desc:'必中の重い一撃' },
  { name:'雄叫び',     cls:'戦士', kind:'buff', proc:100, mp:5, buff:{ self:{ str:12 }, enemy:{ agi:-5 } }, priority:1, desc:'STR+12%・相手のAGI-5%（重ねがけ可）' },
  { name:'鎧通し',     cls:'槍使い', kind:'phys', mult:1.25, proc:85, mp:11, defPen:0.5, desc:'相手の防御を50%無視' },
  { name:'穿ち',       cls:'槍使い', kind:'phys', mult:1.24, proc:90, mp:8, ail:{ key:'bleed', chance:40 }, desc:'40%で出血' },
  { name:'水面蹴り',   cls:'格闘家', kind:'phys', mult:1.31, buff:{ enemy:{ agi:-15 } }, proc:90, mp:8, desc:'相手のAGI-15%（重ねがけ可）' },
  { name:'百裂拳',     cls:'格闘家', kind:'phys', mult:0.31, hits:5, proc:85, mp:11, noCrit:true, desc:'5連撃。1発ずつ命中判定。クリティカルしない' },
  { name:'投げナイフ', cls:'盗賊', kind:'phys', mult:1.0, add:[{ stat:'agi', rate:0.25 }], proc:90, mp:8, sureHit:true, desc:'必中' },
  { name:'盗み取る',   cls:'盗賊', kind:'phys', mult:0.85, add:[{ stat:'agi', rate:0.4 }], proc:90, mp:8, dispel:{ chance:40 }, desc:'40%で相手のバフを1つ消す' },
  { name:'足止めの矢', cls:'弓使い', kind:'phys', mult:0.65, add:[{ stat:'agi', rate:0.45 }], proc:95, mp:4, ail:{ key:'slow', chance:40 }, desc:'40%で鈍足' },
  { name:'五月雨撃ち', cls:'弓使い', kind:'phys', mult:0.3, add:[{ stat:'agi', rate:0.22 }], hits:3, proc:85, mp:11, noCrit:true, desc:'3連射。クリティカルしない' },
  { name:'しびれ弾',   cls:'銃士', kind:'phys', mult:0.55, add:[{ stat:'dex', rate:0.65 }], proc:88, mp:9, ail:{ key:'paralyze', chance:12 }, desc:'12%で麻痺' },
  { name:'炸裂弾',     cls:'銃士', kind:'phys', mult:0.6, add:[{ stat:'dex', rate:0.8 }], proc:85, mp:11, ail:{ key:'burn', chance:40 }, desc:'40%で火傷' },
  { name:'ウインド',   cls:'魔法使い', kind:'mag', mult:1.6, proc:90, mp:9, elem:'wind', desc:'風の魔法' },
  { name:'ディスペル', cls:'魔法使い', kind:'mag', mult:1.25, proc:95, mp:5, dispel:{ chance:50 }, desc:'50%で相手のバフを1つ消す' },
  { name:'封印の呪い', cls:'呪術師', kind:'mag', mult:1.45, proc:88, mp:10, ail:{ key:'seal', chance:25 }, desc:'25%で封印' },
  { name:'生命吸収',   cls:'呪術師', kind:'mag', mult:1.4, proc:90, mp:9, drain:0.25, desc:'与えたダメージの25%をHP回復' },
  { name:'ホーリー',   cls:'僧侶', kind:'mag', mult:1.33, proc:95, mp:5, cure:1, desc:'自分の状態異常を1つ治す' },
  { name:'神罰',       cls:'僧侶', kind:'mag', mult:1.62, proc:85, mp:13, ail:{ key:'weaken', chance:30 }, desc:'30%で衰弱' },
  { name:'発火薬',     cls:'薬師', kind:'mag', mult:1.44, proc:90, mp:9, ail:{ key:'burn', chance:40 }, desc:'40%で火傷' },
  { name:'万能薬',     cls:'薬師', kind:'heal', proc:85, mp:10, heal:{ rate:0.8 }, cure:2, desc:'HPを戻し、自分の状態異常を2つ治す' },
]

// 魔法の属性（魔導士の元素共鳴が「直前と違う属性」を見る）。今のⅡの魔法使いの技は今のⅡの名簿を書き換えず、写しに付ける
export const ELEM_OF_V2 = { ファイア:'fire', サンダー:'thunder', アイスランス:'ice' }

// ★初期職の攻撃の技の倍率（SHOKI_TUNE・弓使い1.08・槍使い1.05）は 2026-10-16 にやめた（ユーザー「倍率かけないで×1」）。
//   弓使い・槍使いの差はクラスのステの配分で付けた（jobs.js の JOB_BONUS）

// ★技の説明に威力のステ（「DEXも威力になる」「AGIが大きく威力になる」など）を書かない（2026-10-16 ユーザー「○○も威力になるみたいな説明文いらない」
//   「21個とも消す」）。威力はスキル画面の威力の行（capPowerText）が出す。この版の技は説明文そのものから消した。
//   今のⅡから持ってきた技（シールドアタック・狙撃・疾風矢）は、写しの説明だけここで消す（今のⅡの名簿は書き換えない）
const POWER_WORDS = /(?:STR|INT|DEX|AGI|VIT|LUK)(?:も|が大きく)威力になる/g
export const withoutPowerWords = (desc) => String(desc || '').replace(POWER_WORDS, '').replace(/。{2,}/g, '。').replace(/^。/, '').replace(/。$/, '')
const copyOfV2 = (s) => {
  const desc = withoutPowerWords(s.desc)
  if (!ELEM_OF_V2[s.name] && desc === s.desc) return s
  return { ...s, ...(ELEM_OF_V2[s.name] ? { elem: ELEM_OF_V2[s.name] } : {}), ...(desc !== s.desc ? { desc } : {}) }
}

// この版のスキル全部。今のⅡの5職ぶんは、今のⅡの並び（＝覚える順）のまま。上位職20職は skillsIchiji.js（2026-10-10）
// ★職業ごとの並び＝覚える順（CLASS LV1・5・10・15・20 の5つ → CLASS LV25・30 の LATE_SKILLS）
export const SKILLS = [
  ...V2_SKILLS.filter(s => KEEP_FROM_V2.includes(s.cls)).map(copyOfV2),
  ...NEW_SKILLS,
  ...LATE_SKILLS,
  ...ICHIJI_SKILLS,
]
export const SKILL_BY_NAME = Object.fromEntries(SKILLS.map(s => [s.name, s]))
// 枠に置ける技（パッシブ以外）。並び＝覚える順
export const skillsOf = (cls) => SKILLS.filter(s => s.cls === cls && !isPassive(s))
// その職業のパッシブ（上位職だけ・1つ）。★今のⅡの passiveOf は今のⅡの名簿を職業名で引くので使わない
//   （狂戦士・竜騎士など今のⅡと同じ名前の職業に、今のⅡのパッシブが付いてしまう）
export const passiveOf = (cls) => SKILLS.find(s => s.cls === cls && isPassive(s)) || null

// ===== スキル画面の威力の行 =====
// ★今のⅡの powerText は上位クラスの項目（物理＋魔法の両方・1発ずつ強くなる連撃・跳躍・最大HPの割合の回復など）を知らず、
//   「STR×undefined」「HPを INT×0 回復」と出ていた（2026-10-16 に見つけた）。この版の項目だけここで書き、ほかは今のⅡの powerText のまま。
//   技の説明には威力のステを書かない（ユーザー「○○も威力になるみたいな説明文いらない」）＝威力はこの行だけが出す
export const capPowerText = (s) => {
  if (!s) return ''
  if (s.kind === 'phys' || s.kind === 'mag') {
    if (s.hybrid) return `物理 STR×${s.hybrid.phys} ＋ 魔法 INT×${s.hybrid.mag}${s.hits > 1 ? ` ×${s.hits}回` : ''}`
    if (s.hitMults) {
      const main = statLabel(s.src || (s.kind === 'mag' ? 'int_stat' : 'str'))
      const sub = (s.add || []).map(a => ` ＋ ${statLabel(a.stat)}×${a.rate}`).join('')
      return `${main}×${s.hitMults.join('→')}${sub}（${s.hitMults.length}連撃・1発ずつ強くなる）`
    }
    if (s.jump) return `着地で ${powerText({ ...s, mult: s.jump.mult })}`
    return powerText(s)
  }
  if (s.kind === 'heal' && (s.healMax || s.regenMax || s.mpHeal || s.mpGain || s.rewind)) {
    const p = []
    if (s.heal) p.push(`HPを INT×${s.heal.rate} 回復`)
    if (s.healMax) p.push(`最大HPの${s.healMax}%回復`)
    if (s.regen) p.push(`毎ターン HPを INT×${s.regen.rate} 回復 ×${s.regen.turns}T`)
    if (s.regenMax) p.push(`毎ターン 最大HPの${s.regenMax.pct}%回復 ×${s.regenMax.turns}T`)
    if (s.mpHeal) p.push(`MPを INT×${s.mpHeal.rate} 回復`)
    if (s.mpGain) p.push(`MP+${s.mpGain}`)
    if (s.rewind) p.push(`直前${s.rewind.turns}ターンに受けたダメージの${s.rewind.pct}%回復`)
    return p.join('・')
  }
  return powerText(s)
}

// ===== 編成の想定利用MP・検証 =====
// ★今のⅡの setMpCost／validateSkillSet は今のⅡの名簿で名前を引くうえ、他職の技を0.8倍・MP2倍で数える。
//   この版は「その職業（と下位職）の技しか置けない」ので、消費MPは名簿の値のまま数える
//   （サーバーの v2cap_set_cost／v2cap_set_skills と同じ規則・同じ文言）
export const setMpCost = (set) => (set || []).reduce((t, e) => {
  const s = SKILL_BY_NAME[e?.name]
  return t + (!s || isPassive(s) || s.mpPct ? 0 : s.mp * (e?.uses || 0))
}, 0)
// lineage … その職業で使える技の職業（自分＋下位職。jobs.js の lineageOf）。先頭が自分の職業
// learned … 覚えたスキル名／maxMp … 最大MP
// ★確かめる順（文言も）はサーバーの v2cap_set_skills と同じ
export const validateSkillSet = (set, { lineage = [], learned = [], maxMp = Infinity } = {}) => {
  if (!Array.isArray(set)) return '編成の形式が不正です'
  if (set.length > SKILL_SET_SLOTS) return `枠は${SKILL_SET_SLOTS}個までです`
  const have = new Set(learned)
  for (const e of set) {
    if (!e?.name) return '枠にスキルが入っていません'
    const s = SKILL_BY_NAME[e.name]
    if (!s) return `${e.name}というスキルはありません`
    if (isPassive(s)) return `${e.name}はパッシブなので枠に置けません`
    if (!lineage.includes(s.cls)) return `${e.name}は${lineage[0] || 'いまの職業'}では使えません（${s.cls}のスキル）`
    if (!have.has(e.name)) return `${e.name}はまだ覚えていません`
    const uses = Number(e.uses)
    // ★回数の上限がある技（usesMax・狂鬼化＝1回まで など・2026-10-15）はその数まで（サーバーの v2cap_set_skills と同じ文言）
    const max = s.usesMax ?? SKILL_USE_MAX
    if (!Number.isInteger(uses) || uses < 1 || uses > max) return `${e.name}の使用回数は1〜${max}です`
  }
  const cost = setMpCost(set)
  if (cost > maxMp) return `想定利用MPが最大MPを超えています（${cost} / ${maxMp}）`
  return null
}

// ===== 初めて就いた職業の編成 =====
// 【確定】スキルセットは職業ごと。初めて就く職業は「覚えている技（その職業のもの）」を入れて始まる。
// 覚えた順に最大5枠・回数は1回ずつから、最大MPに収まるだけ前の枠から1回ずつ足す（1枠最大5回）。
// 1回ずつでも収まらなければ後ろの枠から外す。
// ★サーバーの v2cap_default_set と同じ規則（キャラ作成と、初めての転職で使う）
export const DEFAULT_USES_MAX = 5
// その技に足せる回数の上限（1枠最大5回・回数の上限がある技はその数まで）
export const usesCapOf = (name) => Math.min(DEFAULT_USES_MAX, SKILL_BY_NAME[name]?.usesMax ?? DEFAULT_USES_MAX)
export const defaultSetOf = (cls, learned = [], maxMp = 0) => {
  const have = new Set(learned)
  const names = skillsOf(cls).filter(s => have.has(s.name)).slice(0, SKILL_SET_SLOTS).map(s => s.name)
  const set = names.map(name => ({ name, uses: 1 }))
  while (set.length > 0 && setMpCost(set) > maxMp) set.pop()
  for (let grew = true; grew;) {
    grew = false
    for (const e of set) {
      if (e.uses >= usesCapOf(e.name)) continue
      e.uses += 1
      if (setMpCost(set) > maxMp) e.uses -= 1
      else grew = true
    }
  }
  return set
}

// ===== 覚えた技を編成の空き枠へ入れる =====
// 【確定】2026-10-12 ユーザー指示「スキルスロット余ってる場合はうめるようにして」：
//   names（覚えた順）のうち、その職業で使える技で、まだ編成に無いものを、空き枠（5枠）に入る数だけ・最大MPに収まるなら1回で入れる
//   （収まらない技はとばして次へ）。そのあと残りのMPで、入れた技に前から1回ずつ足す（1枠最大5回＝ defaultSetOf と同じ）。
//   前から入っている技にはさわらない
//   ⚠最初は「入れた技に残りのMPで使えるだけ回数を付ける」形で、1つ目の技がMPを使い切って次の技が入らなかった（PGlite で見つけた）
// lineage … その職業で使える技の職業（jobs.js の lineageOf）／maxMp … 最大MP
// ★サーバーの v2cap_fill_set と同じ規則（覚えたとき＝v2cap_apply_exp と、今いるキャラを一度だけ埋める移行で使う）
export const fillSetOf = (set, names = [], { lineage = [], maxMp = 0 } = {}) => {
  const out = (Array.isArray(set) ? set : []).map(e => ({ ...e }))
  const added = []
  let cost = setMpCost(out)
  for (const name of names) {
    if (out.length >= SKILL_SET_SLOTS) break
    const s = SKILL_BY_NAME[name]
    if (!s || isPassive(s) || !lineage.includes(s.cls) || out.some(e => e.name === name)) continue
    if (cost + s.mp > maxMp) continue
    const e = { name, uses: 1 }
    out.push(e)
    added.push(e)
    cost += s.mp
  }
  for (let grew = true; grew;) {
    grew = false
    for (const e of added) {
      const mp = SKILL_BY_NAME[e.name].mp
      if (e.uses >= usesCapOf(e.name) || cost + mp > maxMp) continue
      e.uses += 1
      cost += mp
      grew = true
    }
  }
  return out
}
