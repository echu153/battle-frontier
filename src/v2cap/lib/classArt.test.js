// v2cap：クラスのイラスト（男女）の決まりを固定するテスト（node --test）
// 【確定】2026-10-11 ユーザー指示「男女それぞれのイラストを用意してるから、良い感じに見えるようにして」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CLASS_BY_ID } from './jobs.js'
import { ART_BASE, ART_FULL, ART_GENDERS, ART_DIR, hasArt, isFullArt, artSrcOf } from './classArt.js'

const PUBLIC = fileURLToPath(new URL('../../../public', import.meta.url))

test('絵のあるクラスはどれも本当にあるクラス。ローマ字の名前はかぶらない', () => {
  for (const cls of Object.keys(ART_BASE)) assert.ok(CLASS_BY_ID[cls], `${cls}はクラスの一覧にない`)
  const bases = Object.values(ART_BASE)
  assert.equal(new Set(bases).size, bases.length)
  for (const b of bases) assert.match(b, /^[a-z]+$/)
})

test('男女の2つ。キーは m と f', () => {
  assert.deepEqual(ART_GENDERS.map(g => g.key), ['m', 'f'])
  for (const g of ART_GENDERS) assert.ok(g.label && g.mark && g.color && g.src.length > 0)
})

test('絵のあるクラスは、男女とも 詳細用（web）と一覧用（thumb）の軽い版が置いてある（tools/v2cap-art.mjs で作る）', () => {
  for (const cls of Object.keys(ART_BASE)) {
    for (const g of ART_GENDERS) {
      for (const size of ['web', 'thumb']) {
        const src = artSrcOf(cls, g.key, size)
        assert.ok(src.startsWith(`${ART_DIR}/${size}/`), src)
        assert.ok(existsSync(PUBLIC + src), `${cls}（${g.label}・${size}）が無い：public${src}。node tools/v2cap-art.mjs を回す`)
      }
    }
  }
})

test('背景つきの絵（枠いっぱいに出す）は、絵のあるクラスだけ。いまは剣士だけ（ユーザー「戦士男とsennsionnnaは剣士用」）', () => {
  for (const cls of ART_FULL) assert.ok(ART_BASE[cls], `${cls}は ART_BASE にない`)
  assert.deepEqual([...ART_FULL], ['剣士'])
  assert.equal(isFullArt('剣士'), true)
  assert.equal(isFullArt('戦士'), false)
})

test('絵の無いクラスは null（画面は「イラスト準備中」）。知らない性別は男性の絵にする', () => {
  assert.equal(hasArt('戦士'), true)
  assert.equal(hasArt('剣士'), true)
  assert.equal(hasArt('狂戦士'), false)
  assert.ok(CLASS_BY_ID['狂戦士'])
  assert.equal(artSrcOf('狂戦士', 'm'), null)
  assert.equal(artSrcOf('ないクラス', 'f'), null)
  assert.equal(artSrcOf('戦士', 'x'), artSrcOf('戦士', 'm'))
  assert.equal(artSrcOf('戦士'), `${ART_DIR}/web/sensi-m.webp`)
  assert.equal(artSrcOf('戦士', 'f', 'thumb'), `${ART_DIR}/thumb/sensi-f.webp`)
})
