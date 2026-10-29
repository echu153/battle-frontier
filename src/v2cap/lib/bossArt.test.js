// v2cap のダンジョンのボスの絵（待機・技ごとの攻撃・遭遇のイラスト）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { BOSS_ART } from './bossArtList.js'
import { BOSS_DEFS, BOSS_ART_DIR, BOSS_HIT_OF, bossArtOf, bossFileOf, bossFxKindOf, bossKeyOfName, bossMotionKeyOf, newBossMotionMemo } from './bossArt.js'
import { cellsOf, colsOf, dropGreen, alignCells, tipOf } from '../../../tools/v2cap-boss-art.mjs'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'
import { BOSS_ILLUST } from './bossIllustList.js'
import { illustPartsOf, illustKindOf, illustFxKindOf, illustBendKindOf, illustPoseKindOf } from './bossIllust.js'
import { componentsOf } from '../../../tools/v2cap-motion.mjs'

const OUT = new URL(`../../../public${BOSS_ART_DIR}/`, import.meta.url)
// 一覧に載っている絵（待機・技・エフェクト・イラスト）
const kindsOf = (e) => ['idle', ...Object.keys(e.motions), ...(e.illust ? ['illust'] : []),
  ...Object.entries(e.fx || {}).flatMap(([mk, f]) => Object.keys(f).map(kind => bossFxKindOf(mk, kind)))]

test('一覧の絵はぜんぶ public/v2cap-art/boss にあって軽い（待機・技は 200KB まで・イラストは 400KB まで）', () => {
  for (const [key, e] of Object.entries(BOSS_ART)) {
    const def = BOSS_DEFS[key]
    assert.ok(def, `${key} は BOSS_DEFS にある`)
    for (const k of kindsOf(e)) {
      const file = new URL(bossFileOf(key, k), OUT)
      assert.ok(existsSync(file), `${def.name} ${k} の絵がある`)
      assert.ok(statSync(file).size < (k === 'illust' ? 400 : 200) * 1024, `${def.name} ${k} は軽い`)
    }
  }
})

test('public/v2cap-art/boss の絵はどれも一覧に載っている（名前を変えて残った絵がない・イラスト版の一覧も見る）', () => {
  const known = new Set(Object.entries(BOSS_ART).flatMap(([key, e]) => kindsOf(e).map(k => bossFileOf(key, k))))
  for (const [key, e] of Object.entries(BOSS_ILLUST)) {
    for (const p of illustPartsOf(key)) if (e.parts[p]) known.add(bossFileOf(key, illustKindOf(p)))
    for (const p of illustPartsOf(key)) if (e.parts[p]?.bend) known.add(bossFileOf(key, illustBendKindOf(p)))   // 曲げた絵を並べた1枚
    for (const [mk, ps] of Object.entries(e.poses || {})) for (const n of Object.keys(ps)) known.add(bossFileOf(key, illustPoseKindOf(mk, n)))   // 技のポーズの絵
    for (const [mk, fx] of Object.entries(e.fx || {})) for (const kind of Object.keys(fx)) known.add(bossFileOf(key, illustFxKindOf(mk, kind)))
  }
  for (const f of readdirSync(OUT)) assert.ok(known.has(f), `${f} は一覧に無い`)
})

test('【確定】2026-10-28 絵のアドレスに中身の印（?v=）：一覧の印は public の絵の中身と同じ（描き直したら道具をやり直す＝古い絵がキャッシュから出てコマがずれない）', () => {
  for (const [key, e] of Object.entries(BOSS_ART)) {
    for (const k of kindsOf(e)) {
      assert.equal(e.v?.[k], versionOf(new URL(bossFileOf(key, k), OUT)), `${key} ${k} の印（node tools/v2cap-boss-art.mjs をやり直す）`)
    }
    assert.deepEqual(Object.keys(e.v).sort(), kindsOf(e).sort(), '印は一覧の絵の分だけ')
  }
  const a = bossArtOf('varuzenoku')
  for (const src of [a.idle.src, a.illust, ...Object.values(a.motions).flatMap(m => [m.src, ...Object.values(m.fx || {}).map(f => f.src)])]) {
    assert.match(src, /\.webp\?v=[0-9a-f]{8}$/, src)
  }
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
      // 竜のいちばん前（飛ぶエフェクトが出るところ）は、待機の枠の左半分
      assert.ok(a.front && a.front[0] >= -a.ox && a.front[0] < e.base / 2 && a.front[1] >= -a.oy && a.front[1] < a.h - a.oy, `${m.file}：竜のいちばん前 ${a.front}`)
    }
  }
})

test('【確定】2026-10-28 エフェクト（7枚）：3列×2段の6コマ・長さは決まりのまま・飛ぶは先がいちばん左・当たるは真ん中', () => {
  for (const [key, e] of Object.entries(BOSS_ART)) {
    for (const d of BOSS_DEFS[key].effects) {
      const a = e.fx?.[d.motion]?.[d.kind]
      assert.ok(a, `${d.file} の絵がある`)
      assert.equal(a.frames, 6)
      if (d.kind === 'fly') {
        assert.ok(typeof d.ms === 'number' && d.flyMs >= 200 && d.flyMs <= 600, `${d.file}：くり返す1コマの長さと飛ぶ時間`)
        assert.ok(a.ax <= 4 && a.ay > a.h * 0.25 && a.ay < a.h * 0.75, `${d.file}：先は左はしの真ん中あたり（${a.ax},${a.ay}）`)
      } else {
        assert.equal(d.ms.length, a.frames)
        assert.equal(a.ax, Math.round(a.w / 2))
        assert.equal(a.ay, Math.round(a.h / 2))
      }
      assert.ok(a.w <= e.base * 1.2 && a.h <= e.base * 1.2, `${d.file}：竜より大きすぎない`)
    }
  }
})

test('エフェクトの時刻：飛ぶ絵は当たるコマで出て flyMs で届く（届いたときがダメージ）・飛ぶ絵の無い黒爪は当たるコマで当たる', () => {
  const a = bossArtOf('varuzenoku')
  assert.equal(a.motions.claw.fx.fly, undefined)
  assert.ok(a.motions.claw.fx.hit)
  assert.equal(a.motions.claw.impactMs, a.motions.claw.hitMs)
  for (const k of ['breath', 'gale', 'doom']) {
    const m = a.motions[k], d = BOSS_DEFS.varuzenoku.effects.find(e => e.motion === k && e.kind === 'fly')
    assert.equal(m.flyMs, d.flyMs)
    assert.equal(m.impactMs, m.hitMs + d.flyMs)
    assert.equal(m.fx.fly.src, `${BOSS_ART_DIR}/varuzenoku-fx-${k}-fly.webp?v=${BOSS_ART.varuzenoku.v[`fx-${k}-fly`]}`)
    assert.deepEqual(m.fx.hit.ms, BOSS_DEFS.varuzenoku.effects.find(e => e.motion === k && e.kind === 'hit').ms)
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
  assert.equal(a.idle.src, `${BOSS_ART_DIR}/varuzenoku-idle.webp?v=${BOSS_ART.varuzenoku.v.idle}`)
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

test('【確定】2026-10-28 隣のコマの竜がくっついていても（黒翼烈風の②③）、列は多い段で数え、くっついた所のいちばん細い列で切り分ける', () => {
  const W = 48, H = 24, data = Buffer.alloc(W * H * 4)
  const dot = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[(y * W + x) * 4 + 3] = 255 }
  for (let k = 0; k < 8; k++) dot((k % 4) * 12 + 2, Math.floor(k / 4) * 12 + 2, (k % 4) * 12 + 9, Math.floor(k / 4) * 12 + 9)
  dot(22, 3, 25, 3)   // ②の翼の先が③につながる（細い1px）
  const img = { W, H, data }
  const cc = componentsOf(img)
  assert.equal(colsOf(img, cc.comps), 4, '上の段は3つに見えるが、下の段の4つで数える')
  const { cells } = cellsOf(img, 4, 2, cc)
  assert.ok(cells.every(c => c.box), 'どのコマも空でない')
  assert.ok(cells[1].box.x1 - cells[1].box.x0 <= 12 && cells[2].box.x1 - cells[2].box.x0 <= 12, `②③は1つずつ（${JSON.stringify([cells[1].box, cells[2].box])}）`)
})

test('先（いちばん左）：小さな火の粉は数えず、縦に4px以上ある列から', () => {
  const W = 20, H = 10, data = Buffer.alloc(W * H * 4)
  const dot = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[(y * W + x) * 4 + 3] = 255 }
  dot(1, 1, 1, 1)      // 火の粉
  dot(5, 3, 15, 7)     // 炎
  assert.deepEqual(tipOf([{ W, H, data }]), { x: 5, y: 5 })
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

test('【確定】2026-10-29 雨摩座はイラスト版だけ（ドット絵版は作らない）・技4つ（通常攻撃＝雨礫・構えた大技＝水天葬・技の名前が同じならその動き）', () => {
  assert.equal(BOSS_DEFS.amaza.pixel, false)
  assert.equal(bossArtOf('amaza'), null)
  assert.deepEqual(BOSS_DEFS.amaza.motions.map(m => m.file), ['雨礫', '氷雨', '水縛の帯', '水天葬'])
  const memo = newBossMotionMemo()
  assert.equal(bossMotionKeyOf('amaza', { skill: null }, memo), 'shot')
  assert.equal(bossMotionKeyOf('amaza', { skill: '氷雨' }, memo), 'sleet')
  assert.equal(bossMotionKeyOf('amaza', { skill: '水天葬' }, memo), 'deluge')
  // 技がまだ仮（この場所のボスの技）のあいだ：構えた技＝水天葬・ほかの技＝氷雨と水縛の帯を交互
  assert.deepEqual([bossMotionKeyOf('amaza', { skill: 'まりょくため' }, memo), bossMotionKeyOf('amaza', { skill: 'まりょくため' }, memo)], ['sleet', 'bind'])
  memo.casts.add('おおわざ')
  assert.equal(bossMotionKeyOf('amaza', { skill: 'おおわざ' }, memo), 'deluge')
  assert.equal(bossMotionKeyOf('nobody', { skill: null }, memo), null)
})
