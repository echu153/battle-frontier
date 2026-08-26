// ============================================================
// 自動成長NPCの伸び方を見る（node tools/v2-npc-curve.mjs）
// ------------------------------------------------------------
// 「速い人は何日で最上階に届くのか」「遅い人はどのあたりで止まっているのか」を出す。
// ★数字を勘で置かないための道具。強さの上限（POWER_CAP）や速度（SPEED_MIN/MAX）を
//   調整したくなったら npc.js を直してここを流し直し、この表を見て決める。
// ============================================================
import {
  seedListOf, powerOfExp, progressOf, EXP_CAP, POWER_CAP, SPEED_MIN, SPEED_MAX,
  arenaIntervalOf, NPC_COUNT,
} from '../src/v2/lib/npc.js'
import { FLOORS, powerOfFloor } from '../src/v2/lib/arena.js'

const floorOfPower = (p) => {
  let f = 1
  while (f < FLOORS && powerOfFloor(f + 1) <= p) f++
  return f
}
const fmtDays = (d) => (d >= 365 ? `${(d / 365).toFixed(1)}年` : d >= 30 ? `${(d / 30).toFixed(1)}か月` : `${Math.round(d)}日`)

console.log(`■ 前提：強さの上限 ${POWER_CAP.toLocaleString()}（アリーナ${FLOORS}階の目安）／そこに要る通算EXP ${EXP_CAP.toLocaleString()}`)
console.log(`　 参考：手で出撃を回し続けるプレイヤーはおよそ 3,420 EXP/時（10秒に1回 × 約9.5EXP）\n`)

// ★ときどき「1週間より1か月のほうが階が低い」ように見えるのは間違いではない。
//   転職するとステが初期値へ戻る（LV100ぶんの+495が消えて、代わりに転職ぶん+100が乗る）ので、
//   戦闘力は**のこぎり刃**に伸びる。転職した直後に見ると一時的に下がって見える。
//   ＝プレイヤーの成長とまったく同じ形（stats.js の applyJobChange）
console.log('■ 速度ごとの伸び方（0から始めたとして／転職の直後は一時的に下がる）')
console.log('速度EXP/時  1日で   1週間で   1か月で   3か月で   上限まで      挑戦の間隔')
for (const speed of [SPEED_MIN, 25, 50, 100, 200, 400, SPEED_MAX]) {
  const at = (days) => {
    const p = powerOfExp(speed * 24 * days)
    return `${floorOfPower(p)}階`.padStart(6)
  }
  const toCap = fmtDays(EXP_CAP / speed / 24)
  console.log(
    `${String(speed).padStart(8)}  ${at(1)}  ${at(7)}  ${at(30)}  ${at(90)}  ${toCap.padStart(8)}  ${String(arenaIntervalOf(speed)).padStart(4)}分`,
  )
}

console.log(`\n■ いま作られる${NPC_COUNT}体の顔ぶれ（10体ごと）`)
console.log(' ID 名前          職業              速度   いまの階  戦闘力   LV/転職    上限まで')
for (const n of seedListOf().filter((_, i) => i % 10 === 0)) {
  const p = progressOf(n.total_exp)
  const rest = Math.max(0, EXP_CAP - n.total_exp) / n.speed / 24
  console.log(
    `${String(n.idx + 1).padStart(3)} ${n.name.padEnd(12)} ${n.cls.padEnd(16)} ${String(n.speed).padStart(4)} ` +
    `${String(n.arena_floor).padStart(6)}階 ${String(n.power).padStart(7)} ${`LV${p.lv}/${p.jobs}回`.padEnd(11)} ${fmtDays(rest)}`,
  )
}

// 全体のばらつき（帯ごとに何体いるか）
const bands = [[0, 5], [5, 15], [15, 30], [30, 45], [45, 50]]
console.log('\n■ いまの階のばらつき')
for (const [a, b] of bands) {
  const n = seedListOf().filter(x => x.arena_floor > a && x.arena_floor <= b).length
  console.log(`  ${String(a + 1).padStart(2)}〜${String(b).padStart(2)}階  ${'#'.repeat(n)} ${n}体`)
}
console.log(`\n速度の幅：${SPEED_MIN}〜${SPEED_MAX} EXP/時（${(SPEED_MAX / SPEED_MIN).toFixed(0)}倍）`)
