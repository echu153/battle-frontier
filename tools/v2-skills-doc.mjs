// docs/v2-skills.md の「職業別」を skills.js から作り直す（正はJS・ドキュメントは写し）
import fs from 'node:fs'
const { SKILL_CLASSES, skillsOf, passiveOf, powerText, isPassive, SKILLS } = await import(new URL('../src/v2/lib/skills.js', import.meta.url).href)
const { classBonusText } = await import(new URL('../src/v2/lib/classBonus.js', import.meta.url).href)

const AIL = { bleed:'出血', poison:'毒', slow:'鈍足', paralyze:'麻痺', healCut:'回復阻害' }
const KIND = { phys:'物理', mag:'魔法', heal:'回復', buff:'補助', passive:'パッシブ' }

const noteOf = (s) => {
  const n = []
  if (s.sureHit) n.push('必中')
  if (s.sureCrit) n.push('確定クリ')
  if (s.noCrit) n.push('クリ無')
  if (s.defPen) n.push(`軽減${Math.round(s.defPen * 100)}%カット`)
  if (s.drain) n.push(`吸収${Math.round(s.drain * 100)}%`)
  if (s.drainIfAil) n.push(`相手が${AIL[s.drainIfAil.key]}なら吸収${s.drainIfAil.pct}%`)
  if (s.lowHpBonus) n.push(`**相手が弱るほど威力+**（HP${s.lowHpBonus.at}%以下で最大+${s.lowHpBonus.max}%）`)
  if (s.ail) n.push(`${s.ail.chance}%で${AIL[s.ail.key] || s.ail.key}`)
  if (s.hitBonus) n.push(`命中+${s.hitBonus}%`)
  if (s.consumeAil) n.push(`${AIL[s.consumeAil.key]}を全消費・1スタックにつき威力+${Math.round(s.consumeAil.perStack * 100)}%`)
  if (s.mpPct) n.push(`MP${Math.round(s.mpPct * 100)}%消費`)
  // 攻撃技に付くバフ・デバフも備考へ出す（これが無いと「どちらが上位互換か」が表から読めない）
  const ST = { hp:'HP', mp:'MP', str:'STR', dex:'DEX', agi:'AGI', int_stat:'INT', vit:'VIT', luk:'LUK' }
  const tbl = (t) => Object.entries(t).map(([k, v]) => `${ST[k] || k}${v >= 0 ? '+' : ''}${v}%`).join('・')
  if (s.kind !== 'buff') {
    if (s.buff?.enemy) n.push('相手の' + tbl(s.buff.enemy))
    if (s.buff?.self) n.push('自分の' + tbl(s.buff.self))
  }
  if (s.priority) n.push('先制')
  if (s.stance) n.push(`**納刀**：次のスキルが発動率+${s.stance.proc}%・威力${s.stance.mult}倍${s.stance.priority ? '・先制' : ''}`)
  if (s.foresight) n.push(`**見切り**：${s.foresight.turns}ターン回避+${s.foresight.pct}%・受けた技へさらに+${s.foresight.perHit}%（${s.foresight.max}%まで）`)
  if (s.whileStance) {
    const w = s.whileStance
    const t = []
    if (w.priority) t.push('先制になる')
    if (w.defPen) t.push(`防御無視+${Math.round(w.defPen * 100)}%`)
    if (w.ailChance) t.push(`状態異常${w.ailChance}%`)
    n.push(`納刀中は${t.join('・')}`)
  }
  if (s.ailPerHit) n.push('**1発ごとに判定**')
  if (s.hpCostPct) n.push(`**現在HPの${s.hpCostPct}%を払う**`)
  if (s.frenzy) n.push(`**狂乱**：${s.frenzy.turns}ターン、出る技がランダムな攻撃スキルになる`)
  if (s.buffTurns) n.push(`**${s.buffTurns}ターンで切れる**`)
  // ★2026-08-23：職業ごとのコンセプトで足した軸
  const FORM = { none:'未召喚', hawk:'鷹', bear:'熊', snake:'蛇' }
  if (s.highHpBonus) n.push(`**自分のHPが高いほど威力+**（満タンで最大+${s.highHpBonus.max}%）`)
  if (s.vsBuff) n.push(`**相手のバフ1つにつき威力+${s.vsBuff.per}%**（${s.vsBuff.max}つまで）`)
  if (s.dispel) n.push(`${s.dispel.chance}%で相手のバフを1つ消す`)
  if (s.repeat) n.push(`**同じ技を続けて撃つほど威力+${s.repeat.per}%**（${s.repeat.max}回まで）`)
  if (s.switchKind) n.push(`**直前と種別が違えば威力+${s.switchKind}%**`)
  if (s.variance) n.push(`**威力が${s.variance.lo / 100}〜${s.variance.hi / 100}倍に振れる**`)
  if (s.combo) n.push(`**直前が「${s.combo.after.join('／')}」なら威力+${s.combo.mult}%**`)
  if (s.airUp) n.push('**跳び上がって空中へ**（空中は回避+10%）')
  if (s.whileAir) n.push(`**空中なら威力+${s.whileAir.mult}%**（叩きつけて着地）`)
  // 攻撃しながら練る技と、練るだけの技（陰陽結界）で書き分ける
  if (s.ritual) n.push(s.kind === 'buff'
    ? `**呪力+${s.ritual}**（最大3・この行動では攻撃しない）`
    : `**撃ちながら呪力+${s.ritual}**（最大3）`)
  if (s.useRitual) n.push(`**呪力を全部使う**（1つにつき威力+${s.useRitual.per}%）`)
  if (s.chargeUp) n.push(s.kind === 'buff'
    ? '**竜気+1**（最大3・溜めているあいだ軽減率+12%×個数）'
    : '**撃ちながら竜気+1**（最大3・溜めているあいだ軽減率+12%×個数）')
  if (s.useCharge) n.push(`**竜気を全部使う**（1つにつき威力+${s.useCharge.per}%）`)
  if (s.form) n.push(`**${FORM[s.form]}を呼ぶ**（同じ型なら威力+25%）`)
  if (s.formBuff) {
    const parts = Object.entries(s.formBuff).map(([k, t]) => {
      const body = Object.entries(t).map(([st, v]) => `${ST[st] || st}+${v}%`).join('・')
      return `${FORM[k]}＝${body}`
    })
    n.push('**呼んでいる獣で中身が変わる**：' + parts.join(' ／ '))
  }
  if (s.whileStack) {
    const w = s.whileStack, key = w.key === 'charge' ? '竜気' : '呪力'
    const t = []
    if (w.mult) t.push(`威力+${w.mult}%`)
    if (w.defPen) t.push(`防御を${Math.round(w.defPen * 100)}%さらに無視`)
    if (w.ailChance) t.push(`状態異常+${w.ailChance}%`)
    n.push(`**${key}があるあいだ${t.join('・')}**（消費はしない）`)
  }
  if (s.whileForm) {
    const t = []
    if (s.whileForm.mult) t.push(`威力+${s.whileForm.mult}%`)
    if (s.whileForm.ailChance) t.push(`状態異常+${s.whileForm.ailChance}%`)
    n.push(`**獣を連れていれば${t.join('・')}**`)
  }
  if (s.vsAil) n.push(`**相手の状態異常1つにつき威力+${s.vsAil.per}%**（${s.vsAil.max}つまで）`)
  if (s.cure) n.push(`**自分の状態異常を${s.cure}つ払う**`)
  return n.join('・')
}

const rowOf = (s) => {
  const mp = s.mpPct ? '割合' : String(s.mp ?? 0)
  const proc = isPassive(s) ? '常時' : `${s.proc}%`
  return `| ${s.name} | ${KIND[s.kind]} | ${powerText(s)} | ${proc} | ${mp} | ${noteOf(s)} |`
}

const out = ['## 職業別', '']
out.push('★上の5つが元からあるもの、下の5つが**2026-08-19に足したぶん**（区切り線から下）。',
  '**追加ぶんは全部「転職5回以上」で覚える**（2026-08-23）。', '')
for (const cls of SKILL_CLASSES) {
  const list = skillsOf(cls)
  const bonus = classBonusText(cls)
  out.push(bonus ? `### ${cls}（職業補正 ${bonus}）` : `### ${cls}`, '')
  out.push('| スキル | 種別 | 威力・効果 | 発動 | MP | 備考 |')
  out.push('|---|---|---|---|---|---|')
  const pas = passiveOf(cls)
  if (pas) out.push(`| ${pas.name} | パッシブ | ${pas.desc} | 常時 | 0 | **枠を使わない・その職業だけ・最初から** |`)
  list.forEach((s, i) => {
    if (i === 5) out.push('| — | | **↓ 2026-08-19 追加（転職5回以上）** | | | |')
    out.push(rowOf(s))
  })
  out.push('')
}

const p = 'docs/v2-skills.md'
let md = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const i = md.indexOf('## 職業別')
if (i < 0) throw new Error('職業別 が無い')
md = md.slice(0, i) + out.join('\n')
md = md.replace(/全28職 × 10個 = 280スキル。正は `src\/v2\/lib\/skills\.js`。\n\*\*2026-08-19に各職\+5\*\*（[^\n]*\n/,
  `初期職7職 × 5個 ＋ 上位職21職 × 10個 = ${SKILLS.length}スキル。正は \`src/v2/lib/skills.js\`。\n**2026-08-19に上位職だけ+5**（枠は5つのままなので「候補10個から5つ選ぶ」形になった・[ATB設計](v2-atb-design.md) §3-3）。\n**追加ぶんは職業補正の main/sub に合ったステータスも威力に乗る**（例：侍の抜刀＝STR×1.5 ＋ DEX×0.3）。\n`)
fs.writeFileSync(p, md)
console.log('classes:', SKILL_CLASSES.length, 'skills:', SKILLS.length)
