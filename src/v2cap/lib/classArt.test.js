// v2cap：クラスのイラスト（男女）の決まりを固定するテスト（node --test）
// 【確定】2026-10-11 ユーザー指示「男女それぞれのイラストを用意してるから、良い感じに見えるようにして」
//   「職業選択するときは顔の周りだけアップするだけでいい」（一覧は顔のアップ）
//   「剣士のイラストだけ背景おかしい、他と合わせて」（剣士の絵も透明な背景のまま使う）
//   「男のイラストの顔アップの大きさが統一されてなくて空白が気になる。もっと全体統一して」（顔の大きさに合わせて切り取る）
// 【確定】2026-10-17 ユーザー「上位職のイラスト用意した」（上位クラス22職×男女・元の絵は public/V2newjob/上位職）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CLASS_BY_ID } from './jobs.js'
import {
  ART_BASE, ART_FACE, FACE_FIT, ART_GENDERS, ART_DIR, ART_SIZES, hasArt, artSrcOf, faceCropOf,
  ART_UPPER_DIR, ART_SRC_ALIAS, ART_KEYED, artSrcFilesOf,
  ART_SD, SD_DIR, SD_OUT, SD_ALIAS, sdTargetOf, sdSrcOf, battleIconOf,
  ART_GIF, GIF_DIR, GIF_OUT, GIF_ALIAS, gifTargetOf, gifSrcOf, homeIconOf,
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

// 詳細の全身（web の WebP・VP8X）の幅と高さ。元の絵と縦横比が同じ（幅だけ合わせて縮めた）なので、目印の割合の見張りに使える。
// ★元の絵で見ないのは、上位クラスの元の絵（public/V2newjob/上位職）を git に入れないため（2026-10-17）
const webSize = (file) => {
  const b = readFileSync(file)
  assert.equal(b.toString('ascii', 12, 16), 'VP8X', file)
  return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
}

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
      const web = `${PUBLIC}${ART_DIR}/web/${key}.webp`
      assert.ok(existsSync(web), `${key} の全身の絵`)
      const { w, h } = webSize(web)
      // 目〜あごは全身の絵の高さの2.5〜7%（いまは2.9〜5.8%。いちばん小さいのは聖騎士の女性＝剣と光輪で体が小さく描かれている）。
      // 外れたら目印の打ち間違い
      const len = Math.hypot((cx - ex) * w, (cy - ey) * h)
      assert.ok(len / h > 0.025 && len / h < 0.07, `${key}：目〜あご ${(len / h * 100).toFixed(1)}%`)
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
        // ★背景の色が出てしまった版（2026-10-11 剣士で起きた）をここで止める。全身の絵は必ずまわりが透明。
        //   顔のアップは髪が四隅まで埋めると透明が1画素も無く、WebP が透明なしで保存する（2026-10-17 狂戦士の女性）＝
        //   同じ元の絵から作る全身の絵の透明で見張る
        if (size === 'web') assert.ok(webpHasAlpha(file), `${cls}（${g.label}・${size}）に透明が無い：public${src}`)
      }
    }
  }
})

test('使っていない大きさのフォルダが残っていない（一覧の全身の小さい絵 thumb/ はやめた）', () => {
  // SD/ はユーザーが置くSDの元の絵・上位職/ は上位クラスの元の絵（どちらも git に入れない）・icon/ はSDから作る戦闘ログのアイコン
  const dirs = readdirSync(PUBLIC + ART_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== SD_DIR && d.name !== ART_UPPER_DIR && d.name !== GIF_DIR).map(d => d.name).sort()
  assert.deepEqual(dirs, [...ART_SIZES, SD_OUT, GIF_OUT].sort())
})

test('全クラス（初期・上位）に絵がある（2026-10-17 上位クラスの44枚を足した）', () => {
  for (const cls of Object.keys(CLASS_BY_ID)) assert.ok(hasArt(cls), `${cls} の絵が無い`)
  assert.equal(Object.keys(ART_BASE).length, Object.keys(CLASS_BY_ID).length)
})

test('元の絵の探し方：初期は <ローマ字><otoko|onna>.png・上位は 上位職/<クラス名><男|女>.png・読めない名前は ART_SRC_ALIAS', () => {
  assert.deepEqual(artSrcFilesOf('剣士', 'm').slice(0, 1), ['kensiotoko.png'])
  assert.deepEqual(artSrcFilesOf('剣士', 'f').slice(0, 2), ['kensionna.png', 'kensionnna.png'])
  assert.ok(artSrcFilesOf('侍', 'm').includes(`${ART_UPPER_DIR}/侍男.png`))
  assert.ok(artSrcFilesOf('侍', 'f').includes(`${ART_UPPER_DIR}/侍女.png`))
  // ユーザーのファイル名「霊薬師otoko.png」「体術師.png」（男女の字が無い＝男性・顔を見て確かめた）
  assert.ok(artSrcFilesOf('霊薬師', 'm').includes(`${ART_UPPER_DIR}/霊薬師otoko.png`))
  assert.ok(artSrcFilesOf('体術師', 'm').includes(`${ART_UPPER_DIR}/体術師.png`))
  assert.ok(!artSrcFilesOf('体術師', 'f').includes(`${ART_UPPER_DIR}/体術師.png`))
  assert.deepEqual(artSrcFilesOf('ないクラス', 'm'), [])
  for (const [k, paths] of Object.entries(ART_SRC_ALIAS)) {
    const [cls, g] = k.split(':')
    assert.ok(ART_BASE[cls] && ['m', 'f'].includes(g), k)
    assert.ok(paths.length > 0, k)
  }
})

test('背景を抜いて使う絵（ART_KEYED）は、絵のあるクラスと男女。抜いた全身の絵も透明つき', () => {
  for (const k of ART_KEYED) {
    const [cls, g] = k.split(':')
    assert.ok(ART_BASE[cls] && ['m', 'f'].includes(g), k)
    assert.ok(webpHasAlpha(PUBLIC + artSrcOf(cls, g, 'web')), k)
  }
  assert.equal(new Set(ART_KEYED).size, ART_KEYED.length)
})

test('上位クラスの元の絵（public/V2newjob/上位職・44枚で約120MB）は git に入れない', () => {
  const ignore = readFileSync(fileURLToPath(new URL('../../../.gitignore', import.meta.url)), 'utf8').split(/\r?\n/)
  assert.ok(ignore.includes(`/public${ART_DIR}/${ART_UPPER_DIR}/`))
})

test('絵の無いクラスは null（画面は「イラスト準備中」）。知らない性別は男性・知らない大きさは全身の絵にする', () => {
  assert.equal(hasArt('戦士'), true)
  assert.equal(hasArt('剣士'), true)
  assert.equal(hasArt('狂戦士'), true)
  assert.equal(hasArt('ないクラス'), false)
  assert.equal(artSrcOf('狂戦士', 'f', 'face'), `${ART_DIR}/face/kyousensi-f.webp`)
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
  assert.equal(battleIconOf('ないクラス', 'm'), null)
  // 上位クラスはSDがまだ無い＝顔のアップ（2026-10-17 から。それまでは絵が無く null＝名前の1文字目の枠）
  assert.equal(battleIconOf('狂戦士', 'f'), `${ART_DIR}/face/kyousensi-f.webp`)
  assert.equal(battleIconOf(cls, 'x'), battleIconOf(cls, 'm'))
})

test('SDの元の絵（public/V2newjob/SD）は git に入れない（1枚約2.5MB）', () => {
  const ignore = readFileSync(fileURLToPath(new URL('../../../.gitignore', import.meta.url)), 'utf8').split(/\r?\n/)
  assert.ok(ignore.includes(`/public${ART_DIR}/${SD_DIR}/`))
})

// 2026-10-22 ユーザー指示「初期クラスのギフ画像全員分作った、ホーム画面の画像はすべて対応するgif画像になるようにして、自分の画像は一旦廃止」
test('ホームの待機の GIF：初期11職は男女とも・載せたものは全部ファイルがある（tools/v2cap-art.mjs が写す）', () => {
  for (const cls of Object.values(CLASS_BY_ID).filter(c => !c.req).map(c => c.id)) {
    assert.deepEqual(ART_GIF[cls], ['m', 'f'], `${cls} の GIF`)
  }
  for (const [cls, gs] of Object.entries(ART_GIF)) {
    assert.ok(ART_BASE[cls], `${cls} のローマ字`)
    for (const g of gs) {
      assert.ok(existsSync(PUBLIC + gifSrcOf(cls, g)), `${cls}（${g}）の GIF が無い：${gifSrcOf(cls, g)}`)
      assert.equal(readFileSync(PUBLIC + gifSrcOf(cls, g)).subarray(0, 6).toString(), 'GIF89a', `${cls}（${g}）は GIF`)
    }
  }
})

test('GIF のファイル名の読み方（ユーザーのファイル名そのまま）', () => {
  assert.deepEqual(gifTargetOf('僧侶女待機'), { cls: '僧侶', g: 'f' })
  assert.deepEqual(gifTargetOf('呪術師男'), { cls: '呪術師', g: 'm' }, '「待機」が無くてもよい')
  assert.deepEqual(gifTargetOf('銃使い男待機'), { cls: '銃士', g: 'm' }, '銃使い＝銃士')
  assert.deepEqual(gifTargetOf('暗殺者女待機'), { cls: '暗殺者', g: 'f' }, '上位クラス')
  assert.deepEqual(gifTargetOf('戦士待機'), { cls: '戦士', g: 'm' }, '男女の字が無い＝GIF_ALIAS')
  assert.deepEqual(gifTargetOf('槍使い待機'), { cls: '槍使い', g: 'm' })
  assert.deepEqual(gifTargetOf('剣士待機'), { cls: '剣士', g: null }, '男女が分からないものは使わない（ツールが知らせる）')
  assert.equal(gifTargetOf('謎の男'), null)
  for (const [stem, [cls]] of Object.entries(GIF_ALIAS)) assert.ok(ART_BASE[cls], stem)
})

test('ホームのアイコン：そのクラスの GIF → 系統の初期クラスの GIF → 戦闘ログのアイコン', () => {
  assert.equal(homeIconOf('戦士', 'f'), '/V2newjob/gif/sensi-f.gif')
  const base = CLASS_BY_ID['暗殺者'].req.cls
  assert.equal(homeIconOf('暗殺者', 'f', base), '/V2newjob/gif/ansatusya-f.gif', '暗殺者の女性は自分の GIF')
  assert.equal(homeIconOf('暗殺者', 'm', base), gifSrcOf(base, 'm'), '暗殺者の男性は系統の初期クラスの GIF')
  for (const c of Object.values(CLASS_BY_ID)) {
    for (const g of ['m', 'f']) assert.match(homeIconOf(c.id, g, c.req?.cls) || '', /.gif$/, `${c.id}（${g}）も GIF になる`)
  }
  assert.equal(homeIconOf('戦士', 'x'), '/V2newjob/gif/sensi-m.gif', '性別が読めなければ男性')
})
