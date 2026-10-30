// v2cap：モンスターのイラストの決まりを固定するテスト（node --test）
// 【確定】2026-10-12 ユーザー指示「V2capではモンスター全てにイラストを設定する。public/エネミー に画像を入れていくから、反映していって」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import {
  ENEMY_ART_ALIAS, ENEMY_ART_DIR, ENEMY_ART_SIZE, ENEMY_ART_BIG_DIR, ENEMY_ART_BIG_SIZE, enemyArtBigSrc, ENEMY_NAMES, ENEMY_NAMES_BY_AREA, SPECIAL_ENEMY_NAMES, ART_NAMES, normalizeArtName, enemyNameOfFile, enemyArtId, enemyArtSrc, hasEnemyArt,
  artFileNoOf, enemyNameOfFileNo,
} from './enemyArt.js'
import { ENEMY_ART_IDS } from './enemyArtList.js'
import { AREA_LIST } from './areas.js'
import { bgModelOf, keyBackground, transparentBorderRatio } from '../../../tools/v2cap-art-lib.mjs'

const PUBLIC = fileURLToPath(new URL('../../../public', import.meta.url))
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

// WebP の大きさと透明（アルファ）。VP8X の見出し（拡張形式）だけを読む＝ツールは透明つきで書くので必ず VP8X
const webpInfo = (file) => {
  const b = readFileSync(file)
  assert.equal(b.toString('ascii', 0, 4), 'RIFF', file)
  assert.equal(b.toString('ascii', 8, 12), 'WEBP', file)
  assert.equal(b.toString('ascii', 12, 16), 'VP8X', `${file} は透明の無い WebP`)
  return { alpha: (b[20] & 0x10) !== 0, w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
}

test('モンスターは15エリア×20体で、名前は全部ちがう（絵のファイル名が名前で決まるので）', () => {
  assert.equal(ENEMY_NAMES_BY_AREA.length, AREA_LIST.length)
  for (const names of ENEMY_NAMES_BY_AREA) assert.equal(names.length, 20)
  assert.equal(new Set(ENEMY_NAMES).size, ENEMY_NAMES.length)
  // 比べ方をそろえても重ならない（ひらがな／カタカナ違いの2体がいると、どちらの絵か決められない）
  assert.equal(new Set(ENEMY_NAMES.map(normalizeArtName)).size, ENEMY_NAMES.length)
  // 絵のファイル名（id）も重ならない
  assert.equal(new Set(ENEMY_NAMES.map(enemyArtId)).size, ENEMY_NAMES.length)
})

test('ファイル名の読み方：ひらがな／カタカナ・記号の違いは見ない。別名は本当にいるモンスターを指す', () => {
  assert.equal(enemyNameOfFile('つるへび'), 'つるヘビ')
  assert.equal(enemyNameOfFile('ヒナタトカゲ'), 'ひなたトカゲ')
  assert.equal(enemyNameOfFile('ｽﾗｲﾑ'), 'スライム')
  assert.equal(enemyNameOfFile('yonakikoorogi['), 'ヨナキコオロギ')
  assert.equal(enemyNameOfFile('だれでもない'), null)
  for (const [file, name] of Object.entries(ENEMY_ART_ALIAS)) {
    assert.ok(ENEMY_NAMES.includes(name), `${file} の行き先 ${name} はモンスターの一覧にいない`)
    // 別名は、ふつうに読むと名前にならないものだけ
    assert.notEqual(normalizeArtName(file), normalizeArtName(name), `${file} は別名にしなくても読める`)
  }
})

test('【確定】2026-10-26 頭の番号つきのファイル名「05-01_砂喰いワーム」：番号を外して名前で読む。番号はエリアの一覧の並びを指す', () => {
  assert.equal(enemyNameOfFile('05-01_砂喰いワーム'), '砂喰いワーム')
  assert.equal(enemyNameOfFile('06-20_雷鷲サンダーロック'), '雷鷲サンダーロック')
  assert.equal(enemyNameOfFile('０５－０１＿砂喰いワーム'), '砂喰いワーム', '全角の番号も読む')
  assert.deepEqual(artFileNoOf('06-20_雷鷲サンダーロック'), { area: 6, index: 20, rest: '雷鷲サンダーロック' })
  assert.equal(artFileNoOf('砂喰いワーム'), null, '番号が無ければ null')
  assert.equal(enemyNameOfFile('砂喰いワーム'), '砂喰いワーム', '番号が無くても今までどおり読む')
  // 番号が指すモンスター（名前と違えばツールが知らせる。名前が読めないときの手がかりにもする）
  assert.equal(enemyNameOfFileNo('05-01_砂喰いワーム'), ENEMY_NAMES_BY_AREA[4][0])
  assert.equal(enemyNameOfFileNo('05-03_だれでもない'), ENEMY_NAMES_BY_AREA[4][2])
  assert.equal(enemyNameOfFile('05-03_だれでもない'), null)
  assert.equal(enemyNameOfFileNo('16-01_砂喰いワーム'), null, '一覧の外')
  // ユーザーの番号はエリアの一覧の並び（ENEMY_NAMES_BY_AREA）と同じ＝並びを変えると番号がずれる
  assert.equal(ENEMY_NAMES_BY_AREA[4][0], '砂喰いワーム')
  assert.equal(ENEMY_NAMES_BY_AREA[5][19], '雷鷲サンダーロック')
})

test('一覧（enemyArtList.js）のモンスターは本当にいて、id は名前どおり。絵は 192×192 の透明つき WebP', () => {
  for (const [name, id] of Object.entries(ENEMY_ART_IDS)) {
    assert.ok(ART_NAMES.includes(name), `${name} はモンスターの一覧にいない`)
    assert.equal(id, enemyArtId(name), name)
    assert.equal(enemyArtSrc(name), `${ENEMY_ART_DIR}/${id}.webp`)
    const file = `${PUBLIC}${ENEMY_ART_DIR}/${id}.webp`
    assert.ok(existsSync(file), `${name} の絵（${file}）が無い`)
    const info = webpInfo(file)
    assert.ok(info.alpha, `${name} の絵に透明が無い`)
    assert.deepEqual([info.w, info.h], [ENEMY_ART_SIZE, ENEMY_ART_SIZE], name)
  }
  // 絵の無いモンスターは null（画面は代わりの枠を出す）
  const without = ENEMY_NAMES.find(n => !ENEMY_ART_IDS[n])
  if (without) { assert.equal(enemyArtSrc(without), null); assert.equal(hasEnemyArt(without), false) }
})

test('public/enemy-art の WebP はどれも一覧に載っている（載せ忘れ・名前を変えて残った絵がない）', () => {
  const listed = new Set(Object.values(ENEMY_ART_IDS).map(id => `${id}.webp`))
  for (const f of readdirSync(`${PUBLIC}${ENEMY_ART_DIR}`)) assert.ok(listed.has(f), `${f} が一覧に無い`)
  for (const f of readdirSync(`${PUBLIC}${ENEMY_ART_BIG_DIR}`)) assert.ok(listed.has(f), `大きい版 ${f} が一覧に無い`)
})

test('【確定】2026-10-24 図鑑でタップしたときの大きい版：一覧のどのモンスターにも 512×512 の透明つき WebP がある', () => {
  // ユーザー指示「モンスターのイラストタップしたらアップされるようにして」。192 を広げるとぼやけるので、同じツールが一緒に作る
  assert.equal(ENEMY_ART_BIG_SIZE, 512)
  for (const [name, id] of Object.entries(ENEMY_ART_IDS)) {
    assert.equal(enemyArtBigSrc(name), `${ENEMY_ART_BIG_DIR}/${id}.webp`)
    const file = `${PUBLIC}${ENEMY_ART_BIG_DIR}/${id}.webp`
    assert.ok(existsSync(file), `${name} の大きい版（${file}）が無い＝ node tools/v2cap-enemy-art.mjs`)
    const info = webpInfo(file)
    assert.ok(info.alpha, `${name} の大きい版に透明が無い`)
    assert.deepEqual([info.w, info.h], [ENEMY_ART_BIG_SIZE, ENEMY_ART_BIG_SIZE], name)
  }
  const without = ENEMY_NAMES.find(n => !ENEMY_ART_IDS[n])
  if (without) assert.equal(enemyArtBigSrc(without), null)
})

test('【確定】2026-10-13 安息の祠のハピネスフェアリー：エリアの一覧（15×20体）には入れず、絵は特別なモンスターとして持つ', () => {
  assert.deepEqual(SPECIAL_ENEMY_NAMES, ['ハピネスフェアリー', 'ちびパピア', 'パピア', 'キングパピア'])   // パピアは 2026-10-30
  for (const n of SPECIAL_ENEMY_NAMES) assert.ok(!ENEMY_NAMES.includes(n), `${n} はエリアの敵ではない`)
  // 比べ方をそろえても、エリアの敵と重ならない（ファイル名から1体に決められる）
  assert.equal(new Set(ART_NAMES.map(normalizeArtName)).size, ART_NAMES.length)
  assert.equal(new Set(ART_NAMES.map(enemyArtId)).size, ART_NAMES.length)
  assert.equal(enemyNameOfFile('ハピネスフェアリー'), 'ハピネスフェアリー')
  assert.ok(hasEnemyArt('ハピネスフェアリー'), 'ユーザーの絵（public/エネミー/特別）から作った WebP がある')
})

test('★エリア①〜⑥の120体は全部絵がある（①② 2026-10-12・③ 10-14・④ 10-24・⑤⑥ 10-26 ユーザーが置いた分）', () => {
  for (const name of ENEMY_NAMES_BY_AREA.slice(0, 6).flat()) assert.ok(hasEnemyArt(name), `${name} の絵が無い`)
})

// ===== 背景の抜き方（tools/v2cap-art-lib.mjs）=====
// 【確定】2026-10-14 エリア③で2つ取りこぼした：
//   ・透明つきの PNG（20枚中17枚）の透明を捨てて灰色を抜いていた → 半透明のもやが白い塊・縁に隠れた色がにじむ
//     → 透明つき（縁の半分以上が透明）はその透明をそのまま使う（transparentBorderRatio で見分ける）
//   ・背景に「透明」のチェック模様（白と薄い灰色の升目）が描き込まれた2枚が、1色の灰色のつもりで抜けなかった
//     → 縁の色が2色の灰色の升目なら、その2色とあいだの色を背景とみなす（bgModelOf の checker）
// 合成の絵：size×size・1画素3バイト（rgb）。fill(x, y) が [r,g,b] を返す
const synth = (size, fill) => {
  const data = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(fill(x, y), (y * size + x) * 3)
  return { data, W: size, H: size }
}
// AIが描く「透明」のチェック模様：8px の升目・明るさ214と253・升目の境は1px ぼかす（升目は縁から3pxずらす＝本物の絵と同じく縁は升目の中）
const checker = (x, y) => {
  const [u, w] = [x + 3, y + 3]
  const t = (Math.floor(u / 8) + Math.floor(w / 8)) % 2
  const edge = u % 8 === 0 || w % 8 === 0
  const v = edge ? 233 : t ? 253 : 214
  return [v, v, v]
}
const alphaAt = (r, x, y) => r.img.data[(y * r.img.W + x) * 4 + 3]

test('背景の見立て：灰色1色は flat、2色の灰色の升目は checker。暗い灰色の体が縁にかかっても checker にしない', () => {
  assert.equal(bgModelOf(synth(64, () => [120, 120, 119])).mode, 'flat')
  assert.equal(bgModelOf(synth(64, checker)).mode, 'checker')
  // 灰色の背景で、黒っぽい体（灰色）が縁の4分の1にかかっている（ツキミミズクの耳のような絵）
  assert.equal(bgModelOf(synth(64, (x, y) => (y < 2 && x < 64) || x < 2 ? [40, 40, 42] : [120, 120, 119])).mode, 'flat')
  // 色のある升目（灰色ではない）は checker にしない
  assert.equal(bgModelOf(synth(64, (x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? [250, 200, 200] : [200, 250, 200]))).mode, 'flat')
})

test('チェック模様の背景を抜く：縁からの背景も、体に囲まれた升目のすき間も透明。体の中の白（1色のかたまり）は残す', () => {
  // 96×96。茶色の体（16〜80）の中に、白い光（36〜44・1色）と、升目のすき間（52〜72・2色の升目）
  const img = synth(96, (x, y) => {
    const inBody = x >= 16 && x < 80 && y >= 16 && y < 80
    if (!inBody) return checker(x, y)
    if (x >= 36 && x < 44 && y >= 36 && y < 44) return [253, 253, 253]
    if (x >= 52 && x < 72 && y >= 52 && y < 72) return checker(x, y)
    return [120, 70, 40]
  })
  const r = keyBackground(img)
  assert.equal(r.mode, 'checker')
  for (const [x, y] of [[0, 0], [95, 0], [5, 50], [90, 90], [10, 10]]) assert.equal(alphaAt(r, x, y), 0, `背景 (${x},${y})`)
  assert.equal(alphaAt(r, 62, 62), 0, '体に囲まれた升目のすき間')
  assert.equal(alphaAt(r, 24, 24), 255, '体')
  assert.equal(alphaAt(r, 40, 40), 255, '体の中の白い光は残す')
  assert.equal(r.edgeLeft, 0)
})

test('灰色1色の背景の抜き方は前のまま（エリア①②の絵が変わらない）：縁から・囲まれたすき間を透明・体は残す', () => {
  const img = synth(96, (x, y) => {
    const inBody = x >= 16 && x < 80 && y >= 16 && y < 80
    if (inBody && !(x >= 52 && x < 72 && y >= 52 && y < 72)) return [120, 70, 40]
    return [120, 120, 119]
  })
  const r = keyBackground(img)
  assert.equal(r.mode, 'flat')
  assert.equal(alphaAt(r, 0, 0), 0)
  assert.equal(alphaAt(r, 62, 62), 0, '体に囲まれたすき間')
  assert.equal(alphaAt(r, 30, 30), 255)
})

test('【確定】2026-10-26 ゆるいすき間（目で確かめた絵だけ）：背景よりわずかに明るいなめらかなすき間も抜く。布の模様のようなばらつきのある灰色は残す', () => {
  // 茶色の体の中に、すき間A（背景+8・なめらか＝煙の渦に囲まれた背景）と、すき間B（背景±8が1画素ごと＝ズボンの布のような灰色）
  const img = synth(96, (x, y) => {
    const inBody = x >= 16 && x < 80 && y >= 16 && y < 80
    if (!inBody) return [120, 120, 119]
    if (x >= 22 && x < 46 && y >= 22 && y < 46) return [128, 128, 127]
    if (x >= 52 && x < 76 && y >= 52 && y < 76) return (x + y) % 2 ? [128, 128, 127] : [112, 112, 111]
    return [120, 70, 40]
  })
  const strict = keyBackground(img)
  assert.equal(alphaAt(strict, 34, 34), 255, 'ふだんの条件では、背景+8のすき間は残す（エリア①〜④の絵が変わらない）')
  assert.equal(alphaAt(strict, 64, 64), 255)
  const loose = keyBackground(img, undefined, { loosePockets: true })
  assert.equal(alphaAt(loose, 34, 34), 0, 'ゆるい条件なら、なめらかなすき間は抜く')
  assert.equal(alphaAt(loose, 64, 64), 255, 'ばらつきのある灰色（海賊砲手のズボンのようなもの）は抜かない')
  assert.equal(alphaAt(loose, 0, 0), 0)
  assert.equal(alphaAt(loose, 18, 18), 255, '体')
})

test('透明つきの見分け：縁がほとんど透明なら透明つき（抜かずにその透明を使う）・縁が不透明なら背景を抜く', () => {
  const rgba = (a) => ({ data: Buffer.alloc(32 * 32 * 4, a), W: 32, H: 32 })
  assert.equal(transparentBorderRatio(rgba(0)), 1)
  assert.equal(transparentBorderRatio(rgba(255)), 0)
})

test('元の絵（public/エネミー）は git に入れない（300枚で約500MBになるため）', () => {
  const ignore = readFileSync(`${ROOT}.gitignore`, 'utf8').split(/\r?\n/)
  assert.ok(ignore.includes('/public/エネミー/'), '.gitignore に /public/エネミー/ が無い')
})
