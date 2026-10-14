// 2026-10-14 の一次職の並び替えで無くなった重戦士・気功師の技（元の定義の写し）。テスト専用。
//   戦闘の仕組み（不動の状態異常よけ・受け止めの軽減・忍耐の反撃・気の溜め）は battleIchiji.js に残っているので、この写しで見張り続ける
//   ★ゲームの名簿（skills.js の SKILLS）には入れない
const P = 'phys'
const B = 'buff'
const H = 'heal'
export const RETIRED_ICHIJI_SKILLS = [
  { name:'不動', cls:'重戦士', kind:'passive', mp:0, passive:{ immune:['paralyze', 'slow'], statPct:{ vit:10 } }, desc:'麻痺・鈍足にかからない・VIT+10%' },
  { name:'重撃', cls:'重戦士', kind:P, mult:0.9, add:[{ stat:'vit', rate:0.6 }], proc:95, mp:6, desc:'物理 ×0.9＋VIT×0.6' },
  { name:'鉄壁', cls:'重戦士', kind:B, proc:100, mp:10, buff:{ self:{ vit:30 } }, priority:1, desc:'自分のVIT+30%' },
  { name:'受け止め', cls:'重戦士', kind:B, proc:100, mp:8, guard:{ cut:20, turns:3 }, priority:1, desc:'3ターンの間、受けるダメージ-20%' },
  { name:'グランドスラム', cls:'重戦士', kind:P, mult:1.0, add:[{ stat:'vit', rate:0.8 }], proc:85, mp:13, buff:{ enemy:{ vit:-15 } }, desc:'物理 ×1.0＋VIT×0.8・相手のVIT-15%' },
  { name:'報復の一撃', cls:'重戦士', kind:P, mult:1.0, proc:85, mp:12, revenge:0.5, desc:'物理 ×1.0＋直前に受けたダメージの50%' },
  { name:'忍耐', cls:'重戦士', kind:B, proc:100, mp:14, endure:{ turns:4, pct:40 }, priority:1, desc:'4ターンの間に受けたダメージの合計の40%を、終了時に相手へ与える' },
  { name:'地鳴らし', cls:'重戦士', kind:P, mult:0.8, add:[{ stat:'vit', rate:1.0 }], proc:85, mp:14, ail:{ key:'paralyze', chance:30 }, desc:'物理 ×0.8＋VIT×1.0・30%で麻痺' },
  { name:'城塞崩し', cls:'重戦士', kind:P, mult:1.0, add:[{ stat:'vit', rate:1.2 }], proc:80, mp:22, revenge:0.3, desc:'物理 ×1.0＋VIT×1.2＋直前に受けたダメージの30%' },
  { name:'丹田', cls:'気功師', kind:'passive', mp:0, passive:{ perStackDmg:{ key:'ki', pct:4 } }, desc:'気1つにつき与ダメージ+4%' },
  { name:'気弾', cls:'気功師', kind:P, mult:0.9, add:[{ stat:'dex', rate:0.4 }], proc:95, mp:6, gain:{ key:'ki', n:1, max:5 }, desc:'物理 ×0.9＋DEX×0.4・気+1' },
  { name:'練気', cls:'気功師', kind:B, proc:100, mp:8, buff:{ self:{ str:10 } }, gain:{ key:'ki', n:2, max:5 }, priority:1, desc:'気+2・自分のSTR+10%' },
  { name:'掌底波', cls:'気功師', kind:P, mult:1.0, add:[{ stat:'dex', rate:0.4 }], proc:88, mp:11, useOne:{ key:'ki', n:1, mult:1.4 }, desc:'物理 ×1.0＋DEX×0.4。気を1消費できれば威力×1.4' },
  { name:'浸透勁', cls:'気功師', kind:P, mult:1.4, proc:85, mp:12, defPen:0.4, gain:{ key:'ki', n:1, max:5 }, desc:'物理 ×1.4・相手の防御を40%無視・気+1' },
  { name:'内功', cls:'気功師', kind:H, proc:100, mp:10, needStack:{ key:'ki', n:1 }, healMax:8, desc:'気を1消費し、最大HPの8%を回復' },
  { name:'気の鎧', cls:'気功師', kind:B, proc:100, mp:10, needStack:{ key:'ki', n:2 }, guard:{ cut:25, turns:3 }, priority:1, desc:'気を2消費し、3ターンの間、受けるダメージ-25%' },
  { name:'闘気', cls:'気功師', kind:B, proc:100, mp:12, buff:{ self:{ str:20, dex:15 } }, gain:{ key:'ki', n:1, max:5 }, priority:1, desc:'自分のSTR+20%・DEX+15%・気+1' },
  { name:'天衝', cls:'気功師', kind:P, mult:1.2, proc:80, mp:20, useAll:{ key:'ki', addMult:0.25 }, desc:'気をすべて消費し、物理 ×1.2＋消費した気1つにつき×0.25' },
]
export const RETIRED_BY_NAME = Object.fromEntries(RETIRED_ICHIJI_SKILLS.map(s => [s.name, s]))
export const retiredPassiveOf = (cls) => RETIRED_ICHIJI_SKILLS.find(s => s.cls === cls && s.kind === 'passive') || null
