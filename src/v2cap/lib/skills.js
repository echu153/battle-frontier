// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— スキルの名簿
// ------------------------------------------------------------
// 2026-10-09 ユーザー決定（docs/v2cap-design.md §11）：初期職は11職（剣士を同じ日に足した）。
//   ・戦士・弓使い・魔法使い・僧侶・格闘家 … 今のⅡのスキルをそのまま使う（中身は src/v2/lib/skills.js）
//   ・槍使い・盗賊・銃士・剣士・呪術師・薬師 … 新しく作った5個ずつ（下の NEW_SKILLS・ユーザー承認済み）
//   ・ノーブル・サモナーと一次職は**一旦なし**
// 新しい技は今のⅡの値段の付け方（発動率ごとの価値 skillValue・消費MPの帯）で初期職の帯に合わせてある。
//
// 【確定】スキルは**その職業でだけ使える**（2026-10-09 ユーザー決定・今のⅡの「他職は0.8倍・MP2倍」はやめた）。
//   代わりに**上位職は下位職のスキルをそのまま使える**（効果も消費MPも同じ）。下位職のたどり方は jobs.js の lineageOf。
//   スキルセットも**職業ごと**に持つ（転職して戻ると前の編成に戻る）。
//
// ★戦闘（battle.js）はスキルの中身を受け取って動くので、名簿をこの版で持てば足りる。
// ★サーバーの v2cap_skills はこの名簿から tools/v2cap-sql.mjs が作る（手で書き写さない）
// ============================================================
import { SKILLS as V2_SKILLS, isPassive, SKILL_SET_SLOTS, SKILL_USE_MAX } from '../../v2/lib/skills.js'
import { ICHIJI_SKILLS } from './skillsIchiji.js'

export { isPassive, SKILL_SET_SLOTS, SKILL_USE_MAX }

// 今のⅡから持ってくる職業
export const KEEP_FROM_V2 = ['戦士', '弓使い', '魔法使い', '僧侶', '格闘家']

// 新しい6職（ClassLV1／5／10／15／20 で上から順に覚える）
export const NEW_SKILLS = [
  // 槍使い（物理・STR）
  { name:'突き',       cls:'槍使い', kind:'phys', mult:1.25, proc:95, mp:4,  desc:'槍で突く' },
  { name:'薙ぎ払い',   cls:'槍使い', kind:'phys', mult:1.31, proc:90, mp:8,  buff:{ enemy:{ agi:-15 } }, desc:'足元を払う。相手のAGI-15%（重ねがけ可）' },
  { name:'投げ槍',     cls:'槍使い', kind:'phys', mult:1.0, add:[{ stat:'dex', rate:0.3 }], proc:88, mp:9, sureHit:true, desc:'必中。DEXも威力になる' },
  { name:'三段突き',   cls:'槍使い', kind:'phys', mult:0.52, hits:3, proc:85, mp:11, noCrit:true, desc:'3連撃。1発ずつ命中判定。クリティカルしない' },
  { name:'槍衾',       cls:'槍使い', kind:'buff', proc:100, mp:8, buff:{ self:{ str:15, vit:12 } }, priority:1, desc:'STR+15%・VIT+12%（重ねがけ可）' },
  // 盗賊（物理・AGIも威力に乗る）
  { name:'切りつけ',   cls:'盗賊', kind:'phys', mult:0.85, add:[{ stat:'agi', rate:0.4 }], proc:95, mp:4, desc:'素早く切る。AGIも威力になる' },
  { name:'早業',       cls:'盗賊', kind:'phys', mult:0.4, add:[{ stat:'agi', rate:0.3 }], hits:2, proc:90, mp:8, noCrit:true, desc:'2連撃。AGIも威力になる。クリティカルしない' },
  { name:'毒塗りの刃', cls:'盗賊', kind:'phys', mult:0.85, add:[{ stat:'agi', rate:0.4 }], proc:88, mp:9, ail:{ key:'poison', chance:40 }, desc:'40%で毒' },
  { name:'目つぶし',   cls:'盗賊', kind:'phys', mult:0.95, add:[{ stat:'agi', rate:0.4 }], proc:85, mp:11, ail:{ key:'blind', chance:40 }, desc:'40%で暗闇（命中-25%）' },
  { name:'影走り',     cls:'盗賊', kind:'buff', proc:100, mp:8, buff:{ self:{ agi:15, dex:12 } }, priority:1, desc:'AGI+15%・DEX+12%（重ねがけ可）' },
  // 銃士（物理・DEXが大きく威力に乗る）
  { name:'早撃ち',     cls:'銃士', kind:'phys', mult:0.65, add:[{ stat:'dex', rate:0.6 }], proc:95, mp:4, desc:'すばやく撃つ。DEXが大きく威力になる' },
  { name:'連射',       cls:'銃士', kind:'phys', mult:0.2, add:[{ stat:'dex', rate:0.27 }], hits:3, proc:90, mp:8, noCrit:true, desc:'3連射。DEXが大きく威力になる。クリティカルしない' },
  { name:'精密射撃',   cls:'銃士', kind:'phys', mult:0.6, add:[{ stat:'dex', rate:0.7 }], proc:88, mp:9, sureHit:true, desc:'必中。DEXが大きく威力になる' },
  { name:'徹甲弾',     cls:'銃士', kind:'phys', mult:0.67, add:[{ stat:'dex', rate:0.7 }], proc:85, mp:11, defPen:0.3, desc:'相手の防御を30%無視。DEXが大きく威力になる' },
  { name:'狙いを定める', cls:'銃士', kind:'buff', proc:100, mp:8, buff:{ self:{ dex:27 } }, priority:1, desc:'DEX+27%（重ねがけ可）' },
  // 剣士（物理・STRにDEXやAGIも乗る・2026-10-09 ユーザー承認）
  { name:'袈裟斬り',   cls:'剣士', kind:'phys', mult:0.95, add:[{ stat:'dex', rate:0.3 }], proc:95, mp:4, desc:'肩口から斬り下ろす。DEXも威力になる' },
  { name:'燕返し',     cls:'剣士', kind:'phys', mult:0.55, add:[{ stat:'dex', rate:0.15 }], hits:2, proc:90, mp:8, noCrit:true, desc:'2連撃。DEXも威力になる。クリティカルしない' },
  { name:'兜割り',     cls:'剣士', kind:'phys', mult:1.0, add:[{ stat:'dex', rate:0.27 }], proc:88, mp:9, defPen:0.3, desc:'相手の防御を30%無視。DEXも威力になる' },
  { name:'一閃',       cls:'剣士', kind:'phys', mult:1.15, add:[{ stat:'agi', rate:0.25 }], proc:85, mp:11, ail:{ key:'bleed', chance:40 }, desc:'AGIも威力になる。40%で出血' },
  { name:'剣の構え',   cls:'剣士', kind:'buff', proc:100, mp:8, buff:{ self:{ str:10, dex:9, agi:8 } }, priority:1, desc:'STR+10%・DEX+9%・AGI+8%（重ねがけ可）' },
  // 呪術師（魔法・状態異常）
  { name:'呪弾',       cls:'呪術師', kind:'mag', mult:1.45, proc:95, mp:5, desc:'呪いを込めた弾を放つ' },
  { name:'呪縛',       cls:'呪術師', kind:'mag', mult:1.44, proc:90, mp:9, ail:{ key:'slow', chance:40 }, desc:'40%で鈍足' },
  { name:'毒の呪い',   cls:'呪術師', kind:'mag', mult:1.45, proc:88, mp:10, ail:{ key:'poison', chance:50 }, desc:'50%で毒' },
  { name:'災いの呪い', cls:'呪術師', kind:'mag', mult:1.56, proc:85, mp:13, ail:{ key:'curse', chance:40 }, desc:'40%で呪い（受けるダメージ+15%）' },
  { name:'衰弱の呪詛', cls:'呪術師', kind:'buff', proc:100, mp:9, buff:{ enemy:{ str:-15, int_stat:-15 } }, priority:1, desc:'相手のSTR-15%・INT-15%（重ねがけ可）' },
  // 薬師（魔法・回復と補助）
  { name:'薬瓶投げ',   cls:'薬師', kind:'mag', mult:1.45, proc:95, mp:5, desc:'薬瓶を投げつける' },
  { name:'傷薬',       cls:'薬師', kind:'heal', proc:85, mp:12, heal:{ rate:1.2 }, desc:'傷薬でHPを戻す' },
  { name:'毒薬',       cls:'薬師', kind:'mag', mult:1.4, proc:88, mp:10, ail:{ key:'poison', chance:60 }, desc:'60%で毒' },
  { name:'強壮剤',     cls:'薬師', kind:'buff', proc:100, mp:9, buff:{ self:{ str:15, int_stat:15 } }, priority:1, desc:'STR+15%・INT+15%（重ねがけ可）' },
  { name:'気付け薬',   cls:'薬師', kind:'heal', proc:85, mp:8, mpRegen:{ rate:0.2, turns:4 }, desc:'しばらく毎ターンMPが戻る' },
]

// 魔法の属性（魔導士の元素共鳴が「直前と違う属性」を見る）。今のⅡの魔法使いの技は今のⅡの名簿を書き換えず、写しに付ける
export const ELEM_OF_V2 = { ファイア:'fire', サンダー:'thunder', アイスランス:'ice' }

// この版のスキル全部。今のⅡの5職ぶんは、今のⅡの並び（＝覚える順）のまま。一次職20職は skillsIchiji.js（2026-10-10）
export const SKILLS = [
  ...V2_SKILLS.filter(s => KEEP_FROM_V2.includes(s.cls)).map(s => (ELEM_OF_V2[s.name] ? { ...s, elem: ELEM_OF_V2[s.name] } : s)),
  ...NEW_SKILLS,
  ...ICHIJI_SKILLS,
]
export const SKILL_BY_NAME = Object.fromEntries(SKILLS.map(s => [s.name, s]))
// 枠に置ける技（パッシブ以外）。並び＝覚える順
export const skillsOf = (cls) => SKILLS.filter(s => s.cls === cls && !isPassive(s))
// その職業のパッシブ（一次職だけ・1つ）。★今のⅡの passiveOf は今のⅡの名簿を職業名で引くので使わない
//   （狂戦士・竜騎士など今のⅡと同じ名前の職業に、今のⅡのパッシブが付いてしまう）
export const passiveOf = (cls) => SKILLS.find(s => s.cls === cls && isPassive(s)) || null

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
    if (!Number.isInteger(uses) || uses < 1 || uses > SKILL_USE_MAX) return `${e.name}の使用回数は1〜${SKILL_USE_MAX}です`
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
export const defaultSetOf = (cls, learned = [], maxMp = 0) => {
  const have = new Set(learned)
  const names = skillsOf(cls).filter(s => have.has(s.name)).slice(0, SKILL_SET_SLOTS).map(s => s.name)
  const set = names.map(name => ({ name, uses: 1 }))
  while (set.length > 0 && setMpCost(set) > maxMp) set.pop()
  for (let grew = true; grew;) {
    grew = false
    for (const e of set) {
      if (e.uses >= DEFAULT_USES_MAX) continue
      e.uses += 1
      if (setMpCost(set) > maxMp) e.uses -= 1
      else grew = true
    }
  }
  return set
}
