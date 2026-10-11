// v2cap：クラスのイラスト（男女）の決まりを固定するテスト（node --test）
// 【確定】2026-10-11 ユーザー指示「男女それぞれのイラストを用意してるから、良い感じに見えるようにして」
//   「職業選択するときは顔の周りだけアップするだけでいい」（一覧は顔のアップ）
//   「剣士のイラストだけ背景おかしい、他と合わせて」（剣士の絵も透明な背景のまま使う）
//   「男のイラストの顔アップの大きさが統一されてなくて空白が気になる。もっと全体統一して」（顔の大きさに合わせて切り取る）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CLASS_BY_ID } from './jobs.js'
import {
  ART_BASE, ART_FACE, FACE_FIT, ART_GENDERS, ART_DIR, ART_SIZES, hasArt, artSrcOf, faceCropOf,
  ART_SD, SD_DIR, SD_OUT, SD_ALIAS, sdTargetOf, sdSrcOf, battleIconOf,
} from './classArt.js'

const PUBLIC = fileURLToPath(new URL('../../../public', import.meta.url))

// WebP に透明（アルファ）が入っているか。VP8X の旗の 0x10、または VP8L（可逆）の見出しのアルファの印
const webpHasAlpha = (file) => {
  const b = readFileSync(file)
  assert.equal(b.toString('ascii', 0, 4), 'RIFF', file)
  assert.equal(b.toString('ascii', 8, 12), 'WEBP', file)
  const kind = b.toString('ascii', 12, 16)
  if (kind === 'VP8X') return (b[20] & 0x10) !== 0
  if (kind === 'VP8L') return ((b[24] >> 4) & 1) === 1
  return false   // 'VP8 '（不可逆・アルファなし）
}

test('絵のあるクラスはどれも本当にあるクラス。ローマ字の名前はかぶらない', () => {
  for (const cls of Object.keys(ART_BASE)) assert.ok(CLASS_BY_ID[cls], `${cls}はクラスの一覧にない`)
  const bases = Object.values(ART_BASE)
  assert.equal(new Set(bases).size, bases.length)
  for (const b of bases) assert.match(b, /^[a-z]+$/)
})

test('男女の2つ。キーは m と f。大きさは 詳細の全身（web）と一覧の顔のアップ（face）', () => {
  assert.deepEqual(ART_GENDERS.map(g => g.key), ['m', 'f'])
  for (const g of ART_GENDERS) assert.ok(g.label && g.mark && g.color && g.src.length > 0)
  assert.deepEqual(ART_SIZES, ['web', 'face'])
})

// 元の絵（PNG）の幅と高さ（IHDR）
const pngSize = (file) => {
  const b = readFileSync(file)
  assert.equal(b.toString('ascii', 12, 16), 'IHDR', file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
const srcOf = (base, g) => g.src.map(s => `${PUBLIC}${ART_DIR}/${base}${s}.png`).find(existsSync)

test('顔の目印（両目のまんなか・あご）は、絵のあるクラスの男女すべてにあり、ありえる大きさ（測り間違いの見張り）', () => {
  assert.deepEqual(Object.keys(ART_FACE).sort(), Object.values(ART_BASE).sort())
  for (const [base, byG] of Object.entries(ART_FACE)) {
    for (const g of ART_GENDERS) {
      const f = byG[g.key]
      const key = `${base}-${g.key}`
      assert.ok(Array.isArray(f) && f.length === 4 && f.every(v => v > 0 && v < 1), key)
      const [ex, ey, cx, cy] = f
      assert.ok(cy > ey, `${key}：あごは目より下`)
      assert.ok(Math.abs(cx - ex) < 0.05, `${key}：あごは目のほぼ真下`)
      const src = srcOf(base, g)
      assert.ok(src, `${key} の元の絵`)
      const { w, h } = pngSize(src)
      // 目〜あごは全身の絵の高さの3〜7%（いまは4.1〜5.4%）。外れたら目印の打ち間違い
      const len = Math.hypot((cx - ex) * w, (cy - ey) * h)
      assert.ok(len / h > 0.03 && len / h < 0.07, `${key}：目〜あご ${(len / h * 100).toFixed(1)}%`)
      // 切り取る正方形は絵からはみ出しすぎない（はみ出しは透明で足すが、顔のまわりは絵の中）
      const c = faceCropOf(f, w, h)
      assert.ok(c.size > 0.1 * w && c.size < 0.3 * w, `${key}：一辺 ${Math.round(c.size)}px`)
      assert.ok(c.x > -0.1 * c.size && c.x + c.size < w + 0.1 * c.size, `${key}：横`)
    }
  }
})

test('顔のアップの写し方：どの顔も目の高さと目〜あごの長さが同じになる（ユーザー「顔アップの大きさが統一されてなくて…もっと全体統一して」）', () => {
  assert.deepEqual(FACE_FIT, { eyeAt: 0.40, eyeToChin: 0.38 })
  // 目が (500,300)・あごが (500,376) の絵（1000×1000）→ 目〜あご 76px＝一辺の38%＝一辺200px・目は上から40%
  const c = faceCropOf([0.5, 0.3, 0.5, 0.376], 1000, 1000)
  assert.ok(Math.abs(c.size - 200) < 1e-6)
  assert.ok(Math.abs(c.x - 400) < 1e-6)
  assert.ok(Math.abs(c.y - (300 - 0.40 * 200)) < 1e-6)
  // 顔が倍の大きさなら、切り取りも倍（＝写る顔の大きさは同じ）
  const big = faceCropOf([0.5, 0.3, 0.5, 0.452], 1000, 1000)
  assert.ok(Math.abs(big.size - 400) < 1e-6)
})

test('絵のあるクラスは、男女とも 全身と顔のアップの軽い版が置いてあり、どれも透明な背景（tools/v2cap-art.mjs で作る）', () => {
  for (const cls of Object.keys(ART_BASE)) {
    for (const g of ART_GENDERS) {
      for (const size of ART_SIZES) {
        const src = artSrcOf(cls, g.key, size)
        assert.ok(src.startsWith(`${ART_DIR}/${size}/`), src)
        const file = PUBLIC + src
        assert.ok(existsSync(file), `${cls}（${g.label}・${size}）が無い：public${src}。node tools/v2cap-art.mjs を回す`)
        // ★背景の色が出てしまった版（2026-10-11 剣士で起きた）をここで止める
        assert.ok(webpHasAlpha(file), `${cls}（${g.label}・${size}）に透明が無い：public${src}`)
      }
    }
  }
})

test('使っていない大きさのフォルダが残っていない（一覧の全身の小さい絵 thumb/ はやめた）', () => {
  // SD/ はユーザーが置くSDの元の絵（git に入れない）・icon/ はそこから作る戦闘ログのアイコン
  const dirs = readdirSync(PUBLIC + ART_DIR, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== SD_DIR).map(d => d.name).sort()
  assert.deepEqual(dirs, [...ART_SIZES, SD_OUT].sort())
})

test('絵の無いクラスは null（画面は「イラスト準備中」）。知らない性別は男性・知らない大きさは全身の絵にする', () => {
  assert.equal(hasArt('戦士'), true)
  assert.equal(hasArt('剣士'), true)
  assert.equal(hasArt('狂戦士'), false)
  assert.ok(CLASS_BY_ID['狂戦士'])
  assert.equal(artSrcOf('狂戦士', 'm'), null)
  assert.equal(artSrcOf('ないクラス', 'f'), null)
  assert.equal(artSrcOf('戦士', 'x'), artSrcOf('戦士', 'm'))
  assert.equal(artSrcOf('戦士'), `${ART_DIR}/web/sensi-m.webp`)
  assert.equal(artSrcOf('剣士', 'f', 'face'), `${ART_DIR}/face/kensi-f.webp`)
  assert.equal(artSrcOf('剣士', 'f', 'thumb'), `${ART_DIR}/web/kensi-f.webp`)
})

// ===== デフォルメ（SD）の絵＝戦闘ログの自分のアイコン =====
// 【確定】2026-10-12 ユーザー指示「自分のアイコンは職業イラストをデフォルメしたキャラを入れる予定」
test('SDのファイル名の読み方：SD<クラス名><男|女>。男女が無い・知らないクラスは使わない。確かめ中の名前は使わない', () => {
  assert.deepEqual(sdTargetOf('SD呪術師男'), { cls:'呪術師', g:'m' })
  assert.deepEqual(sdTargetOf('SD魔法使い女'), { cls:'魔法使い', g:'f' })
  assert.deepEqual(sdTargetOf('SD盗賊'), { cls:'盗賊', g:null })
  assert.equal(sdTargetOf('SDないクラス男'), null)
  assert.equal(sdTargetOf('呪術師男'), null)
  for (const [stem, to] of Object.entries(SD_ALIAS)) {
    if (to === null) { assert.deepEqual(sdTargetOf(stem), { hold: true }); continue }
    assert.ok(ART_BASE[to[0]] && ['m', 'f'].includes(to[1]), stem)
  }
  // 男女の字が無い「SD剣士.png」は剣士の男性（絵を見て確かめた）
  assert.deepEqual(sdTargetOf('SD剣士'), { cls:'剣士', g:'m' })
  assert.deepEqual(sdTargetOf('SD剣士女'), { cls:'剣士', g:'f' })
})

test('ART_SD のクラスと男女には、アイコン（192×192・透明な背景）がある。icon/ の絵はどれも ART_SD に載っている', () => {
  const listed = new Set()
  for (const [cls, gs] of Object.entries(ART_SD)) {
    assert.ok(ART_BASE[cls], `${cls}は絵のあるクラスではない`)
    for (const g of gs) {
      const src = sdSrcOf(cls, g)
      assert.equal(src, `${ART_DIR}/${SD_OUT}/${ART_BASE[cls]}-${g}.webp`)
      assert.ok(existsSync(PUBLIC + src), `${cls}（${g}）のアイコンが無い：public${src}。node tools/v2cap-art.mjs を回す`)
      assert.ok(webpHasAlpha(PUBLIC + src), `${cls}（${g}）のアイコンに透明が無い`)
      const b = readFileSync(PUBLIC + src)
      assert.deepEqual([1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)], [192, 192], src)
      listed.add(`${ART_BASE[cls]}-${g}.webp`)
    }
  }
  for (const f of readdirSync(`${PUBLIC}${ART_DIR}/${SD_OUT}`)) assert.ok(listed.has(f), `${f} が ART_SD に無い`)
})

test('戦闘ログの自分のアイコン：SDの絵 → 無ければ顔のアップ → 絵の無いクラスは null。知らない性別は男性', () => {
  const [cls, gs] = Object.entries(ART_SD)[0]
  assert.equal(battleIconOf(cls, gs[0]), sdSrcOf(cls, gs[0]))
  const noSd = Object.keys(ART_BASE).find(c => !ART_SD[c])
  if (noSd) assert.equal(battleIconOf(noSd, 'f'), artSrcOf(noSd, 'f', 'face'))
  assert.equal(battleIconOf('狂戦士', 'm'), null)
  assert.equal(battleIconOf(cls, 'x'), battleIconOf(cls, 'm'))
})

test('SDの元の絵（public/V2newjob/SD）は git に入れない（1枚約2.5MB）', () => {
  const ignore = readFileSync(fileURLToPath(new URL('../../../.gitignore', import.meta.url)), 'utf8').split(/\r?\n/)
  assert.ok(ignore.includes(`/public${ART_DIR}/${SD_DIR}/`))
})
