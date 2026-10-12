// v2cap：モンスターのイラストの決まりを固定するテスト（node --test）
// 【確定】2026-10-12 ユーザー指示「V2capではモンスター全てにイラストを設定する。public/エネミー に画像を入れていくから、反映していって」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ENEMY_ART_ALIAS, ENEMY_ART_DIR, ENEMY_ART_SIZE, ENEMY_NAMES, ENEMY_NAMES_BY_AREA, normalizeArtName, enemyNameOfFile, enemyArtId, enemyArtSrc, hasEnemyArt,
} from './enemyArt.js'
import { ENEMY_ART_IDS } from './enemyArtList.js'
import { AREA_LIST } from './areas.js'

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

test('一覧（enemyArtList.js）のモンスターは本当にいて、id は名前どおり。絵は 192×192 の透明つき WebP', () => {
  for (const [name, id] of Object.entries(ENEMY_ART_IDS)) {
    assert.ok(ENEMY_NAMES.includes(name), `${name} はモンスターの一覧にいない`)
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
})

test('★エリア①②の40体は全部絵がある（2026-10-12 ユーザーが置いた分）', () => {
  for (const name of ENEMY_NAMES_BY_AREA.slice(0, 2).flat()) assert.ok(hasEnemyArt(name), `${name} の絵が無い`)
})

test('元の絵（public/エネミー）は git に入れない（300枚で約500MBになるため）', () => {
  const ignore = readFileSync(`${ROOT}.gitignore`, 'utf8').split(/\r?\n/)
  assert.ok(ignore.includes('/public/エネミー/'), '.gitignore に /public/エネミー/ が無い')
})
