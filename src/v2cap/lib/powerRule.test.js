// 【確定】2026-10-21 ユーザー「溜め技の威力が高くなるのはいいんだけど、ほかの職に比べて無条件で高くないかって話、しかもこっからパッシブとかで火力上がるでしょ」
//   「暗殺者の出血5状態への攻撃をMAX火力5だとして、竜騎士は無条件なんだから3.5とかの威力にしてほしい、他もそんな感じで調整してほしい」（node --test）
//   上位クラスの攻撃の技の威力＝書いてある倍率の合計（ステ2つの技は2つの合計・連撃は回数ぶん・1回で撃つぶん）。
//   ・条件の無い技は 3.5 まで（跳躍は着地の1回。3ターンかかるハイジャンプはパッシブ込みで5まで）
//   ・条件を満たしたとき（溜め・状態異常・HPなどが最大）の最大は 5 まで（パッシブ込み）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SKILL_BY_NAME, passiveOf } from './skills.js'
import { ICHIJI_CLASSES, learnOrderOf } from './jobs.js'

const S = (n) => { const s = SKILL_BY_NAME[n]; assert.ok(s, `${n}がある`); return s }
const UNCOND_MAX = 3.5
const MAX = 5
const TOL = 0.05   // 端数（フルバースト 2.64×1.9＝5.02）
// 溜めの最大（スキルの決まりの上限）・相手の状態異常は4つまで数える
const MAXSTK = { load: 5, undead: 4, clone: 3, potion: 20, aim: 3, bleed: 5, sin: 5, reso: 4 }
const NAILS = 4

// 1回で撃つ威力：{ U＝条件の無いとき, C＝条件を満たしたとき（技の条件だけ）}
const powerOf = (s) => {
  const hits = s.hitMults ? 1 : (s.hits || 1)
  const main = s.hybrid ? (s.hybrid.phys + s.hybrid.mag) : (s.hitMults ? s.hitMults.reduce((a, b) => a + b, 0) : (s.jump ? s.jump.mult : s.mult))
  const add = (s.add || []).reduce((a, x) => a + x.rate, 0)
  let U = (main + add) * hits
  let C = U
  if (s.stanceMult) { U = (main * s.noStanceMult + add) * hits; C = (main * s.stanceMult + add) * hits }
  if (s.afterStance) C *= s.afterStance.mult
  if (s.whileImbue) C *= s.whileImbue.mult
  if (s.consumeImbue) C *= s.consumeImbue.mult
  if (s.foeLowHp) C *= s.foeLowHp.mult
  if (s.selfLowHp) C *= s.selfLowHp.mult
  if (s.burstAil) C *= 1 + s.burstAil.perStack * MAXSTK.bleed
  if (s.useAll?.per) C *= 1 + s.useAll.per * MAXSTK[s.useAll.key]
  if (s.useAll?.addMult) C += s.useAll.addMult * MAXSTK[s.useAll.key]
  if (s.perStack) C *= 1 + Math.min(s.perStack.max ?? Infinity, MAXSTK[s.perStack.key] * s.perStack.pct) / 100
  if (s.perStackAdd) C += s.perStackAdd.addMult * MAXSTK[s.perStackAdd.key]
  if (s.hitsPerStack) C = C / hits * (hits + s.hitsPerStack.n * MAXSTK[s.hitsPerStack.key])
  if (s.hitsPerStackUse) C = C / hits * (hits + s.hitsPerStackUse.n * Math.min(s.hitsPerStackUse.max, MAXSTK[s.hitsPerStackUse.key]))
  if (s.comboPower) C *= 1 + s.comboPower.max / 100
  if (s.comboHits) C = C / hits * s.comboHits.hits
  if (s.agitPower) C *= 1 + s.agitPower.max / 100
  if (s.agiDiff) C *= 1 + s.agiDiff.max / 100
  if (s.extraCountPower) C *= 1 + s.extraCountPower.max / 100
  if (s.mpRatioPower) C *= 1 + s.mpRatioPower.max / 100
  if (s.mpAbove) C *= s.mpAbove.mult
  if (s.mpUsedPower) C *= 1 + s.mpUsedPower.max / 100
  if (s.vsAil) C *= 1 + Math.min(s.vsAil.max, s.vsAil.per * NAILS) / 100
  if (s.vsAilMult) C *= s.vsAilMult.mult
  if (s.consumeAllAil) C *= 1 + Math.min(s.consumeAllAil.max, s.consumeAllAil.per * NAILS) / 100
  if (s.useReso) C *= 1 + s.useReso.max / 100
  if (s.useSin) C *= 1 + s.useSin.per * MAXSTK.sin / 100
  if (s.vsRace) C *= s.vsRace.mult
  if (s.whileBarrier) C *= s.whileBarrier.mult
  if (s.afterLand) C *= s.afterLand
  if (s.firstTurn) C *= s.firstTurn.mult
  if (s.dodgeCountPower) C *= 1 + s.dodgeCountPower.max / 100
  if (s.hitsByAil) C = C / hits * (hits + s.hitsByAil.filter(h => NAILS >= h.at).reduce((a, h) => Math.max(a, h.n), 0))
  if (s.inAir?.mult) C *= 1 + s.inAir.mult / 100
  if (s.inAir?.hits) C = C / hits * (hits + s.inAir.hits)
  return { U, C }
}
// いつも効くパッシブ（跳躍の着地・魔弾）と、条件つきのパッシブ（溜め・状態異常などが最大のとき）
const alwaysOf = (pa, s) => (s.jump && pa.landPct ? 1 + pa.landPct / 100 : 1)
  * (pa.mpPower ? 1 + Math.min(pa.mpPower.max, (s.mpPct ? 30 : s.mp) * pa.mpPower.per) / 100 : 1)
const condPassiveOf = (pa) => [
  pa.combo ? 1 + pa.combo.max * pa.combo.pct / 100 : 1,
  pa.perFoeBleed ? 1 + pa.perFoeBleed * MAXSTK.bleed / 100 : 1,
  pa.perFoeAil ? 1 + Math.min(pa.perFoeAil.max, pa.perFoeAil.pct * NAILS) / 100 : 1,
  pa.reso ? 1 + pa.reso.max * pa.reso.pct / 100 : 1,
  pa.sin ? 1 + pa.sin.max * pa.sin.pct / 100 : 1,
  pa.perStackDmg ? 1 + Math.min(pa.perStackDmg.max ?? Infinity, MAXSTK[pa.perStackDmg.key] * pa.perStackDmg.pct) / 100 : 1,
  pa.whileSummonOrGuard ? 1 + pa.whileSummonOrGuard / 100 : 1,
  pa.lowHpDmg ? 1 + Math.max(...pa.lowHpDmg.map(x => x.pct)) / 100 : 1,
  pa.bothAil ? 1 + pa.bothAil.pct / 100 : 1,
].reduce((a, b) => a * b, 1)

test('【確定】2026-10-21 条件の無い技は3.5まで・条件を満たしたときの最大は5まで（上位クラスの攻撃の技すべて・パッシブ込み）', () => {
  let n = 0
  for (const c of ICHIJI_CLASSES) {
    const pa = passiveOf(c)?.passive || {}
    for (const s of learnOrderOf(c)) {
      if (s.kind !== 'phys' && s.kind !== 'mag') continue
      n++
      const { U, C } = powerOf(s)
      const k = alwaysOf(pa, s)
      if (s.jump && s.jump.turns >= 2) {
        assert.ok(U * k <= MAX + TOL, `${c}の${s.name}：${s.jump.turns + 1}ターンの溜めはパッシブ込みで5まで（${(U * k).toFixed(2)}）`)
      } else {
        assert.ok(U <= UNCOND_MAX + TOL, `${c}の${s.name}：条件の無い威力は3.5まで（${U.toFixed(2)}）`)
      }
      assert.ok(C * k * condPassiveOf(pa) <= MAX + TOL, `${c}の${s.name}：条件を満たしたときの最大は5まで（${(C * k * condPassiveOf(pa)).toFixed(2)}）`)
    }
  }
  assert.ok(n > 150, `上位クラスの攻撃の技（${n}）`)
})

test('【確定】2026-10-21 竜騎士の跳躍は3.5（ハイジャンプは3ターンで4.3）・天墜竜閃は着地の次に×2.5・フルバーストは装填1つにつき+18%', () => {
  for (const [n, m, t] of [['ジャンプ', 3.5, 1], ['天竜落とし', 3.5, 1], ['ハイジャンプ', 4.3, 2]]) {
    assert.deepEqual([S(n).mult, S(n).jump.mult, S(n).jump.turns], [m, m, t], n)
  }
  assert.equal(S('天墜竜閃').afterLand, 2.5)
  assert.ok(S('天墜竜閃').desc.includes('×2.5'))
  assert.deepEqual(S('フルバースト').useAll, { key: 'load', per: 0.18 })
  assert.ok(S('フルバースト').desc.includes('+18%'))
  // 暗殺者の「出血5への攻撃」（ユーザーの言うMAX）：絶命（相手HP20%以下）＋血の匂い（出血5）＝ 4.69
  const z = powerOf(S('絶命')).C * condPassiveOf(passiveOf('暗殺者').passive)
  assert.ok(Math.abs(z - 4.69) < 0.01, `絶命 ${z.toFixed(2)}`)
})

test('シミュレーターは組み方の例を書いた並び（仕組みが回る並び）のまま使う（竜騎士の跳躍→天墜竜閃）', () => {
  const sim = readFileSync(new URL('../../../tools/v2cap-progress.mjs', import.meta.url), 'utf8')
  assert.ok(sim.includes('const ownInOrder = build.map(n => own.find(sk => sk.name === n)).filter(Boolean)'))
  assert.ok(sim.includes('const merged = [...ownInOrder, ...fill]'))
})
