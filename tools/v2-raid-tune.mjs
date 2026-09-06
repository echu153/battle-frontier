// ============================================================
// v2 レイドボスのHPを「想定人数で1時間で削り切れる」ところへ合わせる
// ------------------------------------------------------------
//   ① 帯ごとに「その頃のプレイヤー」を作る（tools/v2-progress.mjs の実測から）
//      ★戦闘力だけでなく、**戦闘力に出てこない伸び**も乗せる（2026-09-06 ユーザー指摘）
//        ・転職回数ぶんの職業補正（classBonus）
//        ・ルーンの刻印（ステータス%）と、その特殊能力（enchant）
//        ・釣り図鑑・モンスター図鑑・ペットぶんの上乗せ
//   ② ボスは **エリアボスの戦闘力 × RAID_POWER_MULT**（攻撃力だけ × RAID_ATK_MULT）
//   ③ **30ターン・たかぶり付き**で runBattle を回し、1回の挑戦で入るダメージを測る
//   ④ HP ＝ 1回の与ダメ × 1時間ぶんの回数（360回）× **想定人数 RAID_PARTY**
//
// ★これで「ソロでは1時間かけても RAID_PARTY 分の1しか削れない」＝**救援を出す前提**になる。
//   自分の帯より下のレイドを手伝うぶんには、上振れぶんそのまま速く削れる。
//
//   node tools/v2-raid-tune.mjs
// ============================================================
const B = new URL('../src/v2/lib/', import.meta.url).href
const { statsOf, areasOfTier, TIER_MAX, markOf } = await import(B + 'enemies.js')
const { runBattle } = await import(B + 'battle.js')
const { skillsOf } = await import(B + 'skills.js')
const { CLASS_BONUS } = await import(B + 'classBonus.js')
const { STAT_KEYS } = await import(B + 'stats.js')
const { SORTIE_CD } = await import(B + 'sortie.js')
const {
  RAID_BOSSES, RAID_TURNS, RAID_HP, RAID_MINUTES, RAMP_ATK, RAMP_DEF, RAID_PARTY,
  raidPowerOfTier, raidHpOfTier, toRaidFighter,
} = await import(B + 'raid.js')
const { simulate, GOAL_DAYS } = await import('./v2-progress.mjs')

const rngOf = (s0) => { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
const kindOf = (cls) => (CLASS_BONUS[cls]?.main === 'int_stat' ? 'mag' : 'phys')
const distFor = (cls) => {
  const b = CLASS_BONUS[cls] || {}
  const d = { hp: 22, mp: 6 }
  for (const k of ['str', 'dex', 'agi', 'int_stat', 'vit', 'luk']) d[k] = 8
  d[b.main || 'str'] += 16
  d[b.sub || 'agi'] += 8
  return d
}

// ===== その帯で普通に組める編成（v2-boss-tune.mjs と同じ）=====
const CLASSES_BY_TIER = {
  1: ['ノーブル'], 2: ['ノーブル', '戦士'], 3: ['戦士', '魔法使い'], 4: ['戦士', '魔法使い', '僧侶'],
  5: ['侍', '暗殺者', '元素使い'], 6: ['侍', '暗殺者', '元素使い'],
  7: ['侍', '暗殺者', '元素使い'], 8: ['侍', '暗殺者', '元素使い'],
}
const SLOTS_BY_TIER = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 }

// ===== 戦闘力に出てこない伸び（2026-09-06 ユーザー指摘）=====
// ★戦闘力（＝ステータスの合計）には出ないが、実際の与ダメには効くものたち。
//   pct      … ルーンの刻印・釣り図鑑・モンスター図鑑・ペットぶんを合わせた全ステ上乗せ(%)
//              （釣り図鑑だけで最大+54%・図鑑は最大3,705pt。埋まり具合を帯で見積もった）
//   enchants … 武器のソケットに刻んだルーンの特殊能力（enchant.js のキー＝敵の名前）
// ⚠ここは**見積り**。実際の埋まり具合は人によるので、
//   「そこそこ作り込んだ人」を想定して置いてある。甘く見るとレイドが一瞬で溶ける。
const EXTRA = {
  1: { pct: 0,  enchants: [] },
  2: { pct: 3,  enchants: ['ひなたトカゲ'] },
  3: { pct: 8,  enchants: ['ひなたトカゲ', 'スケルトン'] },
  4: { pct: 12, enchants: ['陽炎リザード', 'スケルトン'] },
  5: { pct: 25, enchants: ['山岳ゴブリン', '雷鷲サンダーロック', 'グリフォン'] },
  6: { pct: 35, enchants: ['霜の精霊', '雷鷲サンダーロック', '氷霊フロストバーン'] },
  7: { pct: 45, enchants: ['炎の精霊', '深紅のサラマンダー', '熾火のデーモン'] },
  8: { pct: 60, enchants: ['天空騎士グリフィオン', '深紅のサラマンダー', '白昼のペガサス'] },
}

// v2-progress.mjs の実測から「その帯に入る日」のプレイヤーを取る
const tierOfDay = (d) => { let t = 1; for (const [k, v] of Object.entries(GOAL_DAYS)) if (d >= v) t = Number(k); return t }
const PROGRESS = simulate(400, { seed: 1, areaOf: () => 1, tierOfDay })
const buildOfTier = (tier) => PROGRESS.find(r => r.day === GOAL_DAYS[tier])

const fighterOf = (cls, power, nSlots, tier, jobChanges) => {
  const all = skillsOf(cls)
  const atk = all.filter(s => s.kind === 'phys' || s.kind === 'mag')
    .sort((a, b) => (b.mult || 0) - (a.mult || 0)).slice(0, nSlots - 1)
  const buff = all.find(s => s.kind === 'buff')
  const slots = [...(buff ? [buff] : []), ...atk].slice(0, nSlots).map(s => ({ skill: s, uses: 99 }))
  const ex = EXTRA[tier]
  const base = statsOf({ power, dist: distFor(cls) })
  // 戦闘力に出てこない伸びを全ステへ乗せる
  const stats = {}
  for (const k of STAT_KEYS) stats[k] = Math.max(1, Math.round(base[k] * (1 + ex.pct / 100)))
  return {
    name: cls, cls, kind: kindOf(cls), stats, slots,
    // ★同じ職業への転職回数。全体の転職回数を「主職に3分の1」と見積もる
    jobCount: Math.max(0, Math.round(jobChanges / 3)),
    enchants: ex.enchants,
  }
}
// HPだけ「削り切れない大きさ」にして、1回の挑戦で何点入るかだけを測る
const dummyBoss = (boss, tier) => toRaidFighter(boss, tier, 9_000_000_000)

const TRIES = 120
const attacks = Math.floor((RAID_MINUTES * 60) / SORTIE_CD)

console.log(`1挑戦=${RAID_TURNS}ターン（たかぶり 火力+${RAMP_ATK}%／耐久+${RAMP_DEF}% ・1ターンごと）`)
console.log(`1時間で殴れる回数=${attacks}回（${SORTIE_CD}秒CD）／想定人数=${RAID_PARTY}人\n`)
console.log(['帯', 'レイド戦闘力', '挑戦力', '転職', '上乗せ', '1回の与ダメ', 'いまのHP', 'ソロ必要回数', '狙いのHP'].join('\t'))

const want = {}
for (let tier = 1; tier <= TIER_MAX; tier++) {
  const b = buildOfTier(tier)
  const power = Math.round(b.peak ?? b.power)
  const classes = CLASSES_BY_TIER[tier]
  const nSlots = SLOTS_BY_TIER[tier]
  let dmg = 0
  let n = 0
  for (const cls of classes) {
    for (let i = 0; i < TRIES; i++) {
      const r = runBattle(
        fighterOf(cls, power, nSlots, tier, b.jc),
        dummyBoss(RAID_BOSSES[i % RAID_BOSSES.length], tier),
        { rng: rngOf(i * 7919 + tier * 131), maxTurns: RAID_TURNS },
      )
      dmg += (r.b.base.hp - r.b.hp)
      n++
    }
  }
  const per = Math.round(dmg / n)
  const hp = raidHpOfTier(tier)
  // 「想定人数で1時間フルに殴ってちょうど削り切れる」HP。読みやすい桁に丸める
  const raw = per * attacks * RAID_PARTY
  const unit = Math.pow(10, Math.max(3, String(Math.round(raw)).length - 2))
  want[tier] = Math.round(raw / unit) * unit
  console.log([
    markOf(tier), raidPowerOfTier(tier).toLocaleString(), power.toLocaleString(), b.jc,
    `+${EXTRA[tier].pct}%`, per.toLocaleString(), hp.toLocaleString(),
    per > 0 ? Math.ceil(hp / per) : '∞', want[tier].toLocaleString(),
  ].join('\t'))
}
console.log('\nいまの RAID_HP =', JSON.stringify(RAID_HP))
console.log('狙いの RAID_HP =', JSON.stringify(want))
console.log(`★「ソロ必要回数」が ${attacks * RAID_PARTY} 回の前後なら狙いどおり`)
console.log(`　（＝ソロでは1時間で ${Math.round(100 / RAID_PARTY)}% ほどしか削れず、${RAID_PARTY}人でちょうど討伐）`)
console.log('★ズレていたら「狙いの RAID_HP」を src/v2/lib/raid.js の RAID_HP へそのまま貼る')
