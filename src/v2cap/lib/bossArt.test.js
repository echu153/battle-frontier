// v2cap のダンジョンのボスの絵（待機・技ごとの攻撃・遭遇のイラスト）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { BOSS_ART } from './bossArtList.js'
import { BOSS_DEFS, BOSS_ART_DIR, BOSS_HIT_OF, bossArtOf, bossFileOf, bossKeyOfName, bossMotionKeyOf, newBossMotionMemo } from './bossArt.js'
import { cellsOf, colsOf, dropGreen, alignCells } from '../../../tools/v2cap-boss-art.mjs'
import { componentsOf } from '../../../tools/v2cap-motion.mjs'

const OUT = new URL(`../../../public${BOSS_ART_DIR}/`, import.meta.url)

test('一覧の絵はぜんぶ public/v2cap-art/boss にあって軽い（待機・技は 200KB まで・イラストは 400KB まで）', () => {
  for (const [key, e] of Object.entries(BOSS_ART)) {
    const def = BOSS_DEFS[key]
    assert.ok(def, `${key} は BOSS_DEFS にある`)
    const kinds = ['idle', ...Object.keys(e.motions), ...(e.illust ? ['illust'] : [])]
    for (const k of kinds) {
      const file = new URL(bossFileOf(key, k), OUT)
      assert.ok(existsSync(file), `${def.name} ${k} の絵がある`)
      assert.ok(statSync(file).size < (k === 'illust' ? 400 : 200) * 1024, `${def.name} ${k} は軽い`)
    }
  }
})

test('public/v2cap-art/boss の絵はどれも一覧に載っている（名前を変えて残った絵がない）', () => {
  const known = new Set(Object.entries(BOSS_ART).flatMap(([key, e]) =>
    ['idle', ...Object.keys(e.motions), ...(e.illust ? ['illust'] : [])].map(k => bossFileOf(key, k))))
  for (const f of readdirSync(OUT)) assert.ok(known.has(f), `${f} は一覧に無い`)
})

test('待機は6か8コマ・技は最初と最後を除いた4か6コマ・待機の枠がまるごと入る・長さは決まりのまま', () => {
  for (const [key, e] of Object.entries(BOSS_ART)) {
    assert.ok(e.base >= 200 && e.base <= 320, '待機の枠は 200〜320px（竜が約250px）')
    assert.ok([6, 8].includes(e.idle.frames))
    assert.deepEqual(e.idle.ms, BOSS_DEFS[key].idleMs[e.idle.frames])
    for (const m of BOSS_DEFS[key].motions) {
      const a = e.motions[m.key]
      assert.ok(a, `${m.file} の絵がある`)
      assert.ok([4, 6].includes(a.frames))
      assert.deepEqual(a.ms, m.ms[a.frames])
      assert.equal(a.hit, BOSS_HIT_OF[a.frames])
      assert.ok(a.ox >= 0 && a.oy >= 0 && a.ox + e.base <= a.w && a.oy + e.base <= a.h, `${m.file}：待機の枠が1コマに収まる`)
    }
  }
})

// 動くWebP の各コマの長さ（ANMF の Duration）
const animMsOf = (file) => {
  const b = readFileSync(file), out = []
  for (let i = 12; i + 8 <= b.length;) {
    const id = b.toString('ascii', i, i + 4), sz = b.readUInt32LE(i + 4)
    if (id === 'ANMF') out.push(b.readUIntLE(i + 8 + 12, 3))
    i += 8 + sz + (sz & 1)
  }
  return out
}
test('【確定】2026-10-28 待機は力強く羽ばたく：振り下ろしは短く・上げきりと下ろしきりは長く（動くWebP のコマの長さが決まりのまま）', () => {
  for (const [key, e] of Object.entries(BOSS_ART)) {
    assert.deepEqual(animMsOf(new URL(bossFileOf(key, 'idle'), OUT)), e.idle.ms, `${key} の待機`)
  }
  for (const ms of Object.values(BOSS_DEFS.varuzenoku.idleMs)) {
    const top = ms[0], down = Math.max(...ms.slice(1, ms.length === 8 ? 4 : 3))
    assert.ok(down < top / 2, '振り下ろしは上げきりの半分より短い')
  }
})

test('【確定】2026-10-28 黒龍ヴァルゼノクの絵（ユーザーが ChatGPT で作った6枚）：待機・黒爪・焦熱の吐息・黒翼烈風・終焉の黒焔・イラスト', () => {
  const a = bossArtOf('varuzenoku')
  assert.ok(a)
  assert.equal(a.name, '黒龍ヴァルゼノク')
  assert.equal(bossKeyOfName('黒龍ヴァルゼノク'), 'varuzenoku')
  assert.deepEqual(Object.values(a.motions).map(m => m.label), ['黒爪', '焦熱の吐息', '黒翼烈風', '終焉の黒焔'])
  assert.ok(a.illust)
  assert.equal(a.idle.src, `${BOSS_ART_DIR}/varuzenoku-idle.webp`)
  // 当たる時刻＝当たるコマの頭
  const c = a.motions.claw
  assert.equal(c.hitMs, c.ms.slice(0, c.hit).reduce((s, v) => s + v, 0))
  assert.equal(c.totalMs, c.ms.reduce((s, v) => s + v, 0))
  assert.equal(c.base, a.base)
})

test('流す絵（仮）：通常攻撃＝黒爪／構えた大技＝終焉の黒焔／ほかの技＝焦熱の吐息と黒翼烈風を交互／技の名前が絵と同じならそれ', () => {
  const memo = newBossMotionMemo()
  assert.equal(bossMotionKeyOf('varuzenoku', { skill: null }, memo), 'claw')
  assert.equal(bossMotionKeyOf('varuzenoku', { skill: 'じわれ' }, memo), 'breath')
  assert.equal(bossMotionKeyOf('varuzenoku', { skill: 'さけび' }, memo), 'gale')
  assert.equal(bossMotionKeyOf('varuzenoku', { skill: 'じわれ' }, memo), 'breath')
  memo.casts.add('深淵咆哮')
  assert.equal(bossMotionKeyOf('varuzenoku', { skill: '深淵咆哮' }, memo), 'doom')
  assert.equal(bossMotionKeyOf('varuzenoku', { skill: '黒翼烈風' }, memo), 'gale')
  assert.equal(bossMotionKeyOf('varuzenoku', { skill: '終焉の黒焔' }, newBossMotionMemo()), 'doom')
  assert.equal(bossMotionKeyOf('nobody', { skill: null }, memo), null)
})

// 3列×2段の小さな絵：まとまりは真ん中があるマスのコマに入る（隣のマスへはみ出した体や炎も切れない）
test('コマ分け：まとまりの真ん中があるマスへ入れ、位置はマスの左上から', () => {
  const W = 30, H = 20, data = Buffer.alloc(W * H * 4)
  const dot = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[(y * W + x) * 4 + 3] = 255 }
  for (let k = 0; k < 6; k++) dot((k % 3) * 10 + 2, Math.floor(k / 3) * 10 + 2, (k % 3) * 10 + 6, Math.floor(k / 3) * 10 + 7)
  dot(3, 12, 10, 13)   // ④の体から⑤のマスへはみ出した炎（④の体につながっている）
  dot(10, 18, 10, 18)  // ⑤のマスの左はしの火の粉（浮いている）
  const { cells } = cellsOf({ W, H, data })
  assert.equal(cells.length, 6)
  assert.deepEqual(cells[3].box, { x0: 2, y0: 2, x1: 10, y1: 7 })
  assert.deepEqual(cells[4].box, { x0: 0, y0: 2, x1: 6, y1: 8 })
  assert.deepEqual(cells[0].box, { x0: 2, y0: 2, x1: 6, y1: 7 })
})

test('緑の無いボス：背景が映り込んだ緑がかった煙は灰色に、炎の赤と黄色はそのまま', () => {
  const px = [[80, 85, 34], [51, 139, 24], [230, 60, 20], [255, 220, 80], [20, 20, 20]]
  const data = Buffer.from(px.flatMap(([r, g, b]) => [r, g, b, 255]))
  dropGreen({ W: px.length, H: 1, data })
  const out = px.map((_, i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
  for (const k of [0, 1]) assert.ok(out[k][1] <= out[k][0] && out[k][2] <= out[k][1], `緑がかった色 ${px[k]} → ${out[k]}（緑が赤より強くない）`)
  assert.deepEqual(out[2], [230, 60, 20])
  assert.deepEqual(out[3], [255, 220, 80])
  assert.deepEqual(out[4], [20, 20, 20])
})

// 4列×2段（8コマ）の小さな絵：上の段の竜の数で列の数を数える。小さな火の粉は数えない
test('【確定】2026-10-28 8コマ（4列×2段）も読める：列の数は上の段の竜の数', () => {
  const sheet = (cols) => {
    const W = cols * 12, H = 24, data = Buffer.alloc(W * H * 4)
    const dot = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[(y * W + x) * 4 + 3] = 255 }
    for (let k = 0; k < cols * 2; k++) dot((k % cols) * 12 + 2, Math.floor(k / cols) * 12 + 2, (k % cols) * 12 + 8, Math.floor(k / cols) * 12 + 9)
    dot(1, 0, 1, 0)   // 火の粉
    return { W, H, data }
  }
  for (const cols of [3, 4]) {
    const img = sheet(cols)
    assert.equal(colsOf(img, componentsOf(img).comps), cols)
    assert.equal(cellsOf(img, cols).cells.length, cols * 2)
  }
})

test('待機のコマそろえ：①と同じ形が下にずれていたら、ずれを見つけて戻す', () => {
  const W = 120, H = 60, data = Buffer.alloc(W * H * 4)
  const dot = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[(y * W + x) * 4 + 3] = 255 }
  dot(4, 30, 20, 50); dot(44, 36, 60, 56); dot(84, 26, 100, 46)   // 3コマ：①・6px下・4px上
  dot(4, 0, 6, 2); dot(44, 0, 46, 2); dot(84, 0, 86, 2)           // 下の段の代わりの小さな印（2段にするため）
  const sh = { img: { W, H, data }, ...cellsOf({ W, H, data }, 3, 1) }
  const t = alignCells(sh, { x0: 0, x1: 1, y0: 0, y1: 1 })
  assert.deepEqual(t.map(v => v.dy), [0, 6, -4])
})
